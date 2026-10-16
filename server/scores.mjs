// Hop Lanes optional online high-score server. Dependency-free, Node 20+.
// Run: node server/scores.mjs
// Env: PORT (8787), DATA_FILE (./scores.json next to this script), ALLOW_ORIGIN ('*'), POST_TOKEN ('' = none), MAX_SCORE (5000), RATE_MAX (10),
//      TRUST_PROXY ('1' when a reverse proxy sits in front: the rate limit then keys on the client in X-Forwarded-For),
//      VERIFY ('1': every POST must carry its replay, and the score must be what the replay plays to; see README.md), VERIFY_MS (300),
//      VERIFY_BUDGET_MS (20000: simulation wall time allowed per minute over all clients; past it POSTs get 503), GET_RATE_MAX (60).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, MAX_RUN_TICKS, TICKS_PER_S, dailySeedFor, isoWeek } from '../js/rules.js';
import { decodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(HERE, 'scores.json');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const POST_TOKEN = process.env.POST_TOKEN || ''; // when set, POSTs must send it as X-Hop-Token (an anti-bot gate, not a secret: the page ships it)
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERIFY = process.env.VERIFY === '1';
const SAVE_DELAY_MS = Number(process.env.SAVE_DELAY_MS ?? 1000); // POSTs are written to disk at most this often (0 = at once)

const MAX_PER_BUCKET = 200;    // entries kept per bucket (mode|day), so a flood in one bucket cannot evict the rest
const MAX_SCORE = Number(process.env.MAX_SCORE ?? 5000); // highest accepted score (env override is for tests)
const DAY_KEEP = 14;           // day buckets older than this many days behind the newest day are dropped
const TOP_N = 10;              // entries returned
const MAX_BODY = 40 * 1024;    // bytes (a replay code is at most MAX_REPLAY)
const MAX_REPLAY = 32768;      // characters of a replay code: about 6000 hops, far past any real run
const SIM_MS = Number(process.env.VERIFY_MS ?? 300); // wall-clock budget for replaying one run (about 1 us per tick once warm; replaying blocks the event loop, so keep it short)
const TICKS_PER_ROW = TICKS_PER_S * 20;  // a claimed score of n must play out within (n + 10) rows x 20 s (MAX_RUN_TICKS at most)
const VERIFY_BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS ?? 20_000); // simulation wall time allowed per RATE_WINDOW_MS over all clients
const RATE_MAX = Number(process.env.RATE_MAX ?? 10); // POSTs per window per IP (env override is for tests)
const GET_RATE_MAX = Number(process.env.GET_RATE_MAX ?? 60); // GETs per window per IP
const RATE_WINDOW_MS = 60_000;

// ---- storage -------------------------------------------------------------
// One flat array on disk (old files stay readable), kept sorted by score, highest first. byKey finds the entry of a
// name in a bucket; e.dayN (not saved) caches the parsed day so compact() never parses a date twice.
let scores = [];
const byKey = new Map(); // `${bucket}|${name}` -> entry
const getCache = new Map(); // GET reply strings by (day, week, mode), cleared on every change
let newestDay = -Infinity; // newest day number any entry carries (far-future junk ignored)

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(data)) return data.filter(e => e && typeof e.name === 'string' && Number.isInteger(e.score));
  } catch { /* missing or corrupt file: start empty */ }
  return [];
}

// Write to a temp file then rename, so readers never see a half-written file. The save timer writes asynchronously;
// exit writes synchronously (nothing else gets to run). A write in flight is never overlapped: a change that lands
// meanwhile sets `dirty`, and the write runs again when the first is done.
const tmpFile = () => `${DATA_FILE}.${process.pid}.tmp`;
let writing = false, dirty = false;
function writeSync() {
  fs.writeFileSync(tmpFile(), JSON.stringify(scores));
  fs.renameSync(tmpFile(), DATA_FILE);
}
async function writeAsync() {
  if (writing) { dirty = true; return; }
  writing = true;
  try {
    do {
      dirty = false;
      const text = JSON.stringify(scores);
      await fs.promises.writeFile(tmpFile(), text);
      await fs.promises.rename(tmpFile(), DATA_FILE);
    } while (dirty);
  } catch (err) { console.error('scores: write failed', err); dirty = true; }
  finally { writing = false; }
}
// A burst of POSTs is one write: the table is compacted and written a moment after the last change (and on exit).
let saveTimer = null;
function save() {
  if (!SAVE_DELAY_MS) { rebuild(); try { writeSync(); } catch (err) { console.error('scores: write failed', err); } return; }
  if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  rebuild();
  writeAsync();
}
function flushSync() { // on exit: whatever is pending, or a change that landed while an async write was running
  const pending = !!saveTimer || dirty || writing;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pending) return;
  rebuild();
  try { writeSync(); } catch (err) { console.error('scores: write failed', err); }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushSync(); process.exit(0); });
process.on('exit', flushSync);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const bucketOf = e => `${e.mode ?? 'classic'}|${e.day ?? ''}`;
const keyOf = e => `${bucketOf(e)}|${e.name}`;
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const dayNum = d => Date.parse(`${d}T00:00:00Z`) / DAY_MS; // NaN for impossible dates
// the cached day number of an entry (NaN without a day); not enumerable, so it never reaches the file
function dayOf(e) {
  if (e.dayN === undefined) Object.defineProperty(e, 'dayN', { value: e.day ? dayNum(e.day) : NaN, writable: true });
  return e.dayN;
}

// the ISO week of a day (rules.js isoWeek), re-exported for the tests
export { isoWeek };

// Newest day an entry may carry: tomorrow UTC (clock skew); later days are refused on POST.
const latestDay = () => new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);

// Sort, keep one entry per (name, bucket) (the highest), cap each bucket, drop expired day buckets.
function compact(list) {
  const limit = dayNum(latestDay());
  let newest = -Infinity; // newest day seen, ignoring far-future junk
  for (const e of list) { const n = dayOf(e); if (n <= limit && n > newest) newest = n; }
  const sorted = list.slice().sort((a, b) => b.score - a.score); // stable: earlier entries win ties
  const seen = new Set(), count = new Map(), out = [];
  for (const e of sorted) {
    if (e.day) { const n = dayOf(e); if (!(n >= newest - DAY_KEEP)) continue; }
    const b = bucketOf(e), who = `${b}|${e.name}`;
    if (seen.has(who)) continue;
    const c = count.get(b) ?? 0;
    if (c >= MAX_PER_BUCKET) continue;
    if (c >= TOP_N) e.replay = null; // rank 11+ can never be in a top 10 view: drop its replay
    if (e.week === undefined) e.week = e.day ? isoWeek(e.day) : null;
    seen.add(who); count.set(b, c + 1); out.push(e);
  }
  return out;
}

// The full compact(), then the index and the GET cache again (at load, before a write, and when a newer day arrives).
function rebuild() {
  scores = compact(scores);
  byKey.clear();
  newestDay = -Infinity;
  const limit = dayNum(latestDay());
  for (const e of scores) { byKey.set(keyOf(e), e); const n = dayOf(e); if (n <= limit && n > newestDay) newestDay = n; }
  getCache.clear();
}

scores = load();
rebuild();

// Top entries, optionally only those with a given day or ISO week and/or mode. Entries saved before
// day/mode existed read as day null, mode 'classic'. Each carries its replay code (or null): top entries only,
// so a response holds at most TOP_N replays (withReplay false leaves them out: the POST reply).
function top(day, mode, week, withReplay = true) {
  const out = [];
  for (const e of scores) {
    const d = e.day ?? null, m = e.mode ?? 'classic';
    if (day && d !== day) continue;
    if (week && e.week !== week) continue;
    if (mode && m !== mode) continue;
    out.push({ name: e.name, score: e.score, at: e.at, day: d, mode: m, ...(withReplay ? { replay: typeof e.replay === 'string' ? e.replay : null } : {}) });
    if (out.length >= TOP_N) break;
  }
  return out;
}

// The GET reply, serialized once per (day, week, mode) until the table changes.
function topJson(day, mode, week) {
  const k = `${day ?? ''}|${week ?? ''}|${mode ?? ''}`;
  let text = getCache.get(k);
  if (text === undefined) { text = JSON.stringify({ top: top(day, mode, week) }); getCache.set(k, text); }
  return text;
}

// first index whose score is below `score` (entries of the same score stay ahead: earlier entries win ties)
function insertAt(score) {
  let lo = 0, hi = scores.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (scores[mid].score >= score) lo = mid + 1; else hi = mid; }
  return lo;
}

// One insert at the sorted spot; the full compact() waits for the save timer. The bucket cap is kept here (the
// lowest entry of a full bucket goes), so a flood cannot grow the table between two saves.
function add(name, score, day, mode, replay = null) {
  const entry = { name, score, at: new Date().toISOString(), day, mode, week: day ? isoWeek(day) : null, replay };
  const n = dayOf(entry);
  if (day && n > newestDay) { newestDay = n; scores.push(entry); byKey.set(keyOf(entry), entry); rebuild(); save(); return; } // a newer day: older buckets may expire
  if (day && !(n >= newestDay - DAY_KEEP)) return; // an expired day bucket
  const k = keyOf(entry), old = byKey.get(k);
  if (old && old.score >= score) return; // keep the higher score
  if (old) scores.splice(scores.indexOf(old), 1);
  else {
    const b = bucketOf(entry);
    let c = 0, last = -1;
    for (let i = 0; i < scores.length; i++) if (bucketOf(scores[i]) === b) { c++; last = i; }
    if (c >= MAX_PER_BUCKET) {
      if (scores[last].score >= score) return; // the bucket is full of higher scores
      byKey.delete(keyOf(scores[last])); scores.splice(last, 1);
    }
  }
  scores.splice(insertAt(score), 0, entry);
  byKey.set(k, entry);
  getCache.clear();
  save();
}

// ---- rate limit (in memory) ---------------------------------------------
const hits = new Map(); // ip -> [timestamps]

// The client address for the rate limit: behind a trusted proxy the last X-Forwarded-For hop (the one the
// proxy added), else the socket; an IPv6 client is keyed by its /64, which is what one subscriber usually holds.
function clientKey(req) {
  let ip = req.socket.remoteAddress || 'unknown';
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (net.isIP(fwd)) ip = fwd; // anything that is not an address (a spoofed header) keys on the socket
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes(':')) {
    const full = ip.split('::'), head = full[0].split(':').filter(Boolean);
    while (head.length < 4) head.push('0');
    return head.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}
// constant-time token check (equal-length buffers only; lengths differ: reject)
function tokenOk(got) {
  const a = Buffer.from(String(got ?? '')), b = Buffer.from(POST_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function limited(ip, max = RATE_MAX) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= max) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
// Drop stale IPs periodically so the map cannot grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (!ts.some(t => now - t < RATE_WINDOW_MS)) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

// ---- verify budget (global) ---------------------------------------------
// Replaying blocks the event loop, so the wall time spent simulating over the last RATE_WINDOW_MS is capped for the
// whole server, whatever the client: past VERIFY_BUDGET_MS a POST gets 503 with Retry-After instead of a replay.
const simSpent = []; // [{ t, ms }] of the last window, oldest first
function budgetLeft() {
  const now = Date.now();
  while (simSpent.length && now - simSpent[0].t >= RATE_WINDOW_MS) simSpent.shift();
  let spent = 0;
  for (const s of simSpent) spent += s.ms;
  return spent > VERIFY_BUDGET_MS ? Math.max(1, Math.ceil((simSpent[0].t + RATE_WINDOW_MS - now) / 1000)) : 0; // seconds to wait, 0 = go
}
function spend(ms) { simSpent.push({ t: Date.now(), ms }); }

// ---- http ----------------------------------------------------------------
function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    ...(status === 400 ? { Connection: 'close' } : {}),
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Hop-Token',
    'Access-Control-Max-Age': '86400',
    ...(ALLOW_ORIGIN !== '*' ? { Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}
function sendText(res, status, text) { // an already serialized JSON body
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Hop-Token',
    'Access-Control-Max-Age': '86400',
    ...(ALLOW_ORIGIN !== '*' ? { Vary: 'Origin' } : {}),
  });
  res.end(text);
}

// Read the body, refusing anything over MAX_BODY bytes.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { // stop buffering; the 400 reply closes the connection
        if (size - c.length <= MAX_BODY) { req.pause(); reject(Object.assign(new Error('too large'), { status: 400 })); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.name !== 'string') return null;
  const name = obj.name.trim();
  if (name.length < 1 || name.length > 16 || !/^[A-Za-z0-9 ]+$/.test(name)) return null;
  const score = obj.score;
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return null;
  let day = null, mode = 'classic';
  if (obj.day !== undefined) {
    if (typeof obj.day !== 'string' || !DAY_RE.test(obj.day)) return null;
    if (!(dayNum(obj.day) <= dayNum(latestDay()))) return null; // impossible or far-future date
    day = obj.day;
  }
  if (obj.mode !== undefined) {
    if (!MODES.includes(obj.mode)) return null;
    mode = obj.mode;
  }
  let replay = null;
  if (obj.replay !== undefined) {   // the replay link code of the run (screens.js): checked with VERIFY, else only its shape; stored either way
    if (typeof obj.replay !== 'string' || obj.replay.length > MAX_REPLAY || !/^[\w-]+$/.test(obj.replay)) return null;
    replay = obj.replay;
  }
  if (replay && !VERIFY && !decodeReplay(replay)) replay = null; // not a replay: do not store the junk
  return { name, score, day, mode, replay };
}

// VERIFY: play the posted run again (sim.js, the same rules as the game) and accept only the score it plays to.
// Daily runs must be on that day's world; classic, race and room runs may be on any seed.
function replayOk(entry) {
  if (!entry.replay) return false;
  const rp = decodeReplay(entry.replay);
  if (!rp || rp.mode !== entry.mode) return false;
  if (rp.mode === 'daily' && (!entry.day || rp.seed !== dailySeedFor(entry.day))) return false;
  const t0 = performance.now();
  const run = simulate(rp, { maxMs: SIM_MS, maxTicks: Math.min(MAX_RUN_TICKS, (entry.score + 10) * TICKS_PER_ROW) });
  spend(performance.now() - t0);
  return !!run && run.over && run.score === entry.score;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/scores') return send(res, 404, { error: 'not found' });
    if (req.method === 'OPTIONS') { res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Hop-Token',
      'Access-Control-Max-Age': '86400',
    }); return res.end(); }
    if (req.method === 'GET') {
      const day = url.searchParams.get('day'), mode = url.searchParams.get('mode'), week = url.searchParams.get('week');
      if (day !== null && !DAY_RE.test(day)) return send(res, 400, { error: 'invalid day' });
      if (week !== null && !WEEK_RE.test(week)) return send(res, 400, { error: 'invalid week' });
      if (day !== null && week !== null) return send(res, 400, { error: 'day and week cannot be combined' });
      if (mode !== null && !MODES.includes(mode)) return send(res, 400, { error: 'invalid mode' });
      if (limited('get:' + clientKey(req), GET_RATE_MAX)) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': '60' });
      return sendText(res, 200, topJson(day, mode, week));
    }
    if (req.method === 'POST') {
      if (POST_TOKEN && !tokenOk(req.headers['x-hop-token'])) return send(res, 401, { error: 'bad token' });
      if (limited(clientKey(req))) return send(res, 429, { error: 'rate limited' });
      let parsed;
      try { parsed = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
      const entry = validate(parsed);
      if (!entry) return send(res, 400, { error: 'invalid name, score, day or mode' });
      if (VERIFY) {
        const wait = budgetLeft();
        if (wait) return send(res, 503, { error: 'busy' }, { 'Retry-After': String(wait) });
        if (!replayOk(entry)) return send(res, 400, { error: 'replay mismatch' });
      }
      add(entry.name, entry.score, entry.day, entry.mode, entry.replay);
      return send(res, 200, { top: top(null, null, null, false) });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? 'bad request' : 'server error' });
  }
});

server.requestTimeout = 10_000;      // a whole request (headers and body) within 10 s
server.headersTimeout = 5_000;       // the headers within 5 s
server.maxRequestsPerSocket = 100;   // then the keep-alive connection is closed

// Start only when run as a script (node server/scores.mjs), so tests can import isoWeek.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
server.listen(PORT, () => console.log(`hop-lanes scores on :${server.address().port} (data: ${DATA_FILE})${VERIFY ? ' (verifying replays)' : ''}`));
