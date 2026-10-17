// Hop Lanes optional online high-score server. Dependency-free, Node 20+.
// Run: node server/scores.mjs
// Env: PORT (8787), DATA_FILE (./scores.json next to this script: the entries without a day), DAYS_DIR (DATA_FILE without
//      .json, plus .days: one file per day), ALLOW_ORIGIN ('*'; set it to the game's origin in production: POSTs from
//      another Origin get 403), POST_TOKEN ('' = none), MAX_SCORE (5000), RATE_MAX (10),
//      TRUST_PROXY ('1' when a reverse proxy sits in front: the rate limit then keys on the client in X-Forwarded-For),
//      VERIFY (on unless '0': every POST must carry its replay, and the score must be what the replay plays to; see README.md), VERIFY_MS (300),
//      VERIFY_BUDGET_MS (20000: simulation wall time allowed per minute over all clients; past it POSTs get 503),
//      VERIFY_CLIENT_MS (5000: the same per client, an IPv6 /56; past it 429), MIN_RULES (rules.js RULES: older replays
//      are refused on POST), GET_RATE_MAX (60).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, MAX_RUN_TICKS, RULES, TICKS_PER_S, TRAITS, dailySeedFor, isoWeek, traitOf } from '../js/rules.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(HERE, 'scores.json');
const DAYS_DIR = process.env.DAYS_DIR || DATA_FILE.replace(/\.json$/i, '') + '.days';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const POST_TOKEN = process.env.POST_TOKEN || ''; // when set, POSTs must send it as X-Hop-Token (an anti-bot gate, not a secret: the page ships it)
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERIFY = process.env.VERIFY !== '0';   // on by default: without it a posted score is only a claim (docs/threat-model.md)
const SAVE_DELAY_MS = Number(process.env.SAVE_DELAY_MS ?? 1000); // POSTs are written to disk at most this often (0 = at once)
const MIN_RULES = Number(process.env.MIN_RULES ?? RULES); // a replay played with older rules is refused on POST (links and ghosts still play it)

const MAX_PER_BUCKET = 200;    // entries kept per bucket (mode|day), so a flood in one bucket cannot evict the rest
const MAX_SCORE = Number(process.env.MAX_SCORE ?? 5000); // highest accepted score (env override is for tests)
const DAY_KEEP = 14;           // day buckets older than this many days behind the newest day are dropped
const SEEN_DAYS = 60;          // the fingerprints of a day's runs are kept this long behind the newest day (a dropped run stays refused)
const GONE_MAX = 5_000;        // fingerprints of dropped runs kept per day, the oldest go first (61 days of them: at most ~0.4 M strings)
const TOP_N = 10;              // entries returned
const MAX_BODY = 40 * 1024;    // bytes (a replay code is at most MAX_REPLAY)
const MAX_REPLAY = 32768;      // characters of a replay code: about 6000 hops, far past any real run
const SIM_MS = Number(process.env.VERIFY_MS ?? 300); // wall-clock budget for replaying one run (about 1.2 us per tick once warm; replaying blocks the event loop, so keep it short)
const TICKS_PER_ROW = TICKS_PER_S * 20;  // a claimed score of n must play out within (n + 10) rows x 20 s (MAX_RUN_TICKS at most)
const VERIFY_BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS ?? 20_000); // simulation wall time allowed per RATE_WINDOW_MS over all clients
const VERIFY_CLIENT_MS = Number(process.env.VERIFY_CLIENT_MS ?? 5_000);  // the same for one client (an IPv6 /56)
const RATE_MAX = Number(process.env.RATE_MAX ?? 10); // POSTs per window per IP (env override is for tests)
const GET_RATE_MAX = Number(process.env.GET_RATE_MAX ?? 60); // GETs per window per IP
const RATE_WINDOW_MS = 60_000;
const BUSY_RETRY_S = 30;       // Retry-After of a replay check that ran out of VERIFY_MS
// classic, race, coin war and tag take any seed: one memorized world keeps at most one place per board
const SEED_MODES = new Set(['classic', 'race', 'coinwar', 'tag']);

// ---- storage -------------------------------------------------------------
// In memory: days (key 'YYYY-MM-DD', or '' for the entries without a day) -> { day, n (day number), week, buckets
// (mode -> bucket), gone (fingerprints of the runs this day dropped), expired, dirty }. A bucket keeps its entries
// sorted by score, highest first (ties: the earlier entry first), with its names and seeds indexed, so a POST costs a
// binary search and one splice of at most MAX_PER_BUCKET. fps maps every kept fingerprint to the day that holds it.
// On disk: one file per day in DAYS_DIR, and DATA_FILE for the entries without a day; a save rewrites only the days that
// changed. An old DATA_FILE (one flat array of every entry) is read and split into the day files on start.
const days = new Map();
const fps = new Map();      // fingerprint -> day key
const doomed = new Set();   // day keys whose files go at the next write (past SEEN_DAYS)
const getCache = new Map(); // GET reply strings by (day, week, mode), cleared on every change
const GET_CACHE_MAX = 64;   // entries; the key comes from the query, so a client asking for ever new days could otherwise grow it without end
let newestDay = -Infinity;  // newest day number any entry carries (far-future junk ignored)

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DAY_MS = 86_400_000;
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const dayNum = d => Date.parse(`${d}T00:00:00Z`) / DAY_MS; // NaN for impossible dates
const todayNum = () => Math.floor(Date.now() / DAY_MS);    // the server's UTC date
const latestNum = () => todayNum() + 1;                    // newest day an entry may carry: tomorrow UTC (time zones)
const seedOf = e => (SEED_MODES.has(e.mode) && Number.isInteger(e.seed) ? e.seed : null);

// the ISO week of a day (rules.js isoWeek), re-exported for the tests; topJson, addrKey and the cache's size are for the tests too
export { addrKey, isoWeek, topJson, getCacheSize };
const getCacheSize = () => getCache.size;

function dayRec(key) {
  let rec = days.get(key);
  if (!rec) {
    rec = { day: key || null, n: key ? dayNum(key) : NaN, week: key ? isoWeek(key) : null, buckets: new Map(), gone: [], expired: false, dirty: false };
    days.set(key, rec);
  }
  return rec;
}
function bucketIn(rec, mode) {
  let b = rec.buckets.get(mode);
  if (!b) { b = { mode, list: [], names: new Map(), seeds: new Map() }; rec.buckets.set(mode, b); }
  return b;
}
// first index whose score is below `score` (entries of the same score stay ahead: earlier entries win ties)
function insertAt(list, score) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].score >= score) lo = mid + 1; else hi = mid; }
  return lo;
}
function insert(key, b, e) {
  const i = insertAt(b.list, e.score);
  b.list.splice(i, 0, e);
  if (i < TOP_N && b.list.length > TOP_N) b.list[TOP_N].replay = null; // pushed to rank 11: it can never be in a top 10 of its bucket again
  b.names.set(e.name, e);
  if (seedOf(e) !== null) b.seeds.set(seedOf(e), e);
  if (e.fp) fps.set(e.fp, key);
}
function remember(key, rec, fp) { // a dropped run stays refused (its fingerprint is kept with the day)
  rec.gone.push(fp);
  fps.set(fp, key);
  while (rec.gone.length > GONE_MAX) { const old = rec.gone.shift(); if (fps.get(old) === key) fps.delete(old); }
}
function drop(key, rec, b, e) {
  b.list.splice(b.list.indexOf(e), 1);
  if (b.names.get(e.name) === e) b.names.delete(e.name);
  if (seedOf(e) !== null && b.seeds.get(seedOf(e)) === e) b.seeds.delete(seedOf(e));
  if (e.fp) remember(key, rec, e.fp);
}
// The bucket rules: one entry per name, and (SEED_MODES) one per seed, each the highest; at most MAX_PER_BUCKET entries
// (the lowest goes). Returns false when the entry is not kept (a higher or equal score holds its place).
function place(key, e) {
  const rec = dayRec(key), b = bucketIn(rec, e.mode);
  const rivals = [b.names.get(e.name), seedOf(e) === null ? undefined : b.seeds.get(seedOf(e))].filter(Boolean);
  if (rivals.some(o => o.score >= e.score)) return false;
  for (const o of new Set(rivals)) drop(key, rec, b, o);
  if (b.list.length >= MAX_PER_BUCKET) {
    const last = b.list[b.list.length - 1];
    if (last.score >= e.score) return false; // the bucket is full of higher scores
    drop(key, rec, b, last);
  }
  insert(key, b, e);
  rec.dirty = true;
  return true;
}
function* fpsOf(rec) {
  yield* rec.gone;
  for (const b of rec.buckets.values()) for (const e of b.list) if (e.fp) yield e.fp;
}
// Expiry, when the newest day changes (and at load): a day DAY_KEEP behind loses its entries but keeps their
// fingerprints; SEEN_DAYS behind it is forgotten and its file goes.
function expire() {
  for (const [key, rec] of days) {
    if (!key || rec.n >= newestDay - DAY_KEEP) continue;
    if (!(rec.n >= newestDay - SEEN_DAYS)) {
      for (const fp of fpsOf(rec)) if (fps.get(fp) === key) fps.delete(fp);
      days.delete(key); doomed.add(key);
    } else if (!rec.expired) {
      if (rec.buckets.size) rec.dirty = true;   // a day read back already expired is not written again
      rec.gone = [...fpsOf(rec)].slice(-GONE_MAX);
      rec.buckets.clear(); rec.expired = true;
    }
  }
  getCache.clear();
}
function noteDay(rec) { // a newer day: older days may expire
  if (rec.n > newestDay && rec.n <= latestNum()) { newestDay = rec.n; expire(); }
}

// ---- files ----
const fileOf = key => (key ? path.join(DAYS_DIR, key + '.json') : DATA_FILE);
function serialize(rec) {
  const entries = [];
  for (const b of rec.buckets.values()) entries.push(...b.list);
  return JSON.stringify({ format: 2, day: rec.day, entries, gone: rec.gone });
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } // missing or corrupt: nothing
}
// an entry as read from a file (either format), or null: a junk day never names a file
function cleanEntry(e, key) {
  if (!e || typeof e.name !== 'string' || !Number.isInteger(e.score)) return null;
  const day = e.day ?? null;
  if (day !== null && (typeof day !== 'string' || !DAY_RE.test(day) || Number.isNaN(dayNum(day)))) return null;
  if (key !== undefined && day !== (key || null)) return null;
  const mode = MODES.includes(e.mode) ? e.mode : 'classic';
  return { name: e.name, score: e.score, at: e.at, day, mode, week: day ? isoWeek(day) : null, replay: typeof e.replay === 'string' ? e.replay : null,
    fp: typeof e.fp === 'string' ? e.fp : undefined, seed: Number.isInteger(e.seed) ? e.seed : undefined };
}
function readDays(into) {
  let names = [];
  try { names = fs.readdirSync(DAYS_DIR); } catch { /* no day files yet */ }
  for (const f of names) {
    const m = DAY_FILE_RE.exec(f), data = m && readJson(path.join(DAYS_DIR, f));
    if (!data || !Array.isArray(data.entries)) continue;
    for (const e of data.entries) into.push(cleanEntry(e, m[1]));
    if (Array.isArray(data.gone)) for (const fp of data.gone) if (typeof fp === 'string') remember(m[1], dayRec(m[1]), fp);
  }
}
// Load both formats: the old flat array (every entry in DATA_FILE) is split into the day files at once.
function load() {
  const main = readJson(DATA_FILE), legacy = Array.isArray(main), list = [];
  for (const e of legacy ? main : Array.isArray(main?.entries) ? main.entries : []) list.push(cleanEntry(e));
  if (!legacy && Array.isArray(main?.gone)) for (const fp of main.gone) if (typeof fp === 'string') remember('', dayRec(''), fp);
  readDays(list);
  const sorted = list.filter(Boolean).sort((a, b) => b.score - a.score); // stable: earlier entries win ties
  for (const e of sorted) place(e.day ?? '', e);
  dayRec('');
  for (const rec of days.values()) { rec.dirty = legacy; if (rec.n > newestDay && rec.n <= latestNum()) newestDay = rec.n; }
  expire();
  if (legacy) writeNowSync();
}

// Write each changed day to a temp file then rename, so readers never see a half-written file. The save timer writes
// asynchronously; exit writes synchronously (nothing else gets to run). A write in flight is never overlapped: a change
// that lands meanwhile sets `again`, and the writes run again when the first are done. The day files go first,
// DATA_FILE last (after a migration the old flat file stays whole until every day is on disk).
const tmpOf = (file, sync) => `${file}.${process.pid}${sync ? '.sync' : ''}.tmp`;
let writing = false, again = false, inFlight = null;
function jobs() {
  const out = [...doomed].map(key => ({ key, file: fileOf(key), text: null }));
  doomed.clear();
  const keys = [...days.keys()].filter(k => days.get(k).dirty).sort().reverse(); // '' sorts first: reversed, it goes last
  for (const key of keys) { const rec = days.get(key); rec.dirty = false; out.push({ key, file: fileOf(key), text: serialize(rec) }); }
  return out;
}
function failed(job, err) {
  console.error('scores: write failed', err);
  const rec = days.get(job.key);
  if (rec && job.text !== null) rec.dirty = true;
}
function writeJobSync(job) {
  try {
    if (job.text === null) return fs.rmSync(job.file, { force: true });
    fs.mkdirSync(path.dirname(job.file), { recursive: true });
    fs.writeFileSync(tmpOf(job.file, true), job.text);
    fs.renameSync(tmpOf(job.file, true), job.file);
  } catch (err) { failed(job, err); }
}
function writeNowSync() { for (const job of jobs()) writeJobSync(job); }
async function writeJob(job) {
  inFlight = job;
  try {
    if (job.text === null) return await fs.promises.rm(job.file, { force: true });
    await fs.promises.mkdir(path.dirname(job.file), { recursive: true });
    await fs.promises.writeFile(tmpOf(job.file, false), job.text);
    await fs.promises.rename(tmpOf(job.file, false), job.file);
  } catch (err) { failed(job, err); } finally { inFlight = null; }
}
async function writeAsync() {
  if (writing) { again = true; return; }
  writing = true;
  try {
    do { again = false; for (const job of jobs()) await writeJob(job); } while (again);
  } finally { writing = false; }
}
// A burst of POSTs is one write: the changed days are written a moment after the last change (and on exit).
let saveTimer = null;
function save() {
  if (!SAVE_DELAY_MS) { writeNowSync(); return; }
  if (!saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  writeAsync();
}
function flushSync() { // on exit: whatever is pending, and the day an async write was busy with (it never finishes)
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (inFlight && inFlight.text !== null && days.has(inFlight.key)) days.get(inFlight.key).dirty = true;
  writeNowSync();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushSync(); process.exit(0); });
process.on('exit', flushSync);

// ---- views ----
// The buckets a view reads: one day or ISO week, or all; one mode or all.
function viewBuckets(day, mode, week) {
  const out = [];
  for (const rec of days.values()) {
    if ((day && rec.day !== day) || (week && rec.week !== week)) continue;
    for (const b of rec.buckets.values()) if ((!mode || b.mode === mode) && b.list.length) out.push(b);
  }
  return out;
}
// the bucket whose next entry is the highest (ties: the earlier entry), or -1
function bestHead(bs, at) {
  let k = -1, best = null;
  for (let i = 0; i < bs.length; i++) {
    const e = bs[i].list[at[i]];
    if (e && (!best || e.score > best.score || (e.score === best.score && String(e.at) < String(best.at)))) { k = i; best = e; }
  }
  return k;
}
// Top entries, optionally only those with a given day or ISO week and/or mode. Entries saved before
// day/mode existed read as day null, mode 'classic'. A view of several buckets (a week, all days, all modes) keeps
// one entry per name and one per seed of SEED_MODES, each the highest. Each carries its replay code (or null): top
// entries only, so a response holds at most TOP_N replays (withReplay false leaves them out: the POST reply).
function top(day, mode, week, withReplay = true) {
  const bs = viewBuckets(day, mode, week), at = bs.map(() => 0), names = new Set(), seeds = new Set(), out = [];
  for (let k = bestHead(bs, at); k >= 0 && out.length < TOP_N; k = bestHead(bs, at)) {
    const e = bs[k].list[at[k]++], seed = seedOf(e);
    if (names.has(e.name) || (seed !== null && seeds.has(seed))) continue;
    names.add(e.name);
    if (seed !== null) seeds.add(seed);
    out.push({ name: e.name, score: e.score, at: e.at, day: e.day ?? null, mode: e.mode, ...(withReplay ? { replay: e.replay ?? null } : {}) });
  }
  return out;
}

// The GET reply, serialized once per (day, week, mode) until the table changes.
function topJson(day, mode, week) {
  const k = `${day ?? ''}|${week ?? ''}|${mode ?? ''}`;
  let text = getCache.get(k);
  if (text === undefined) {
    text = JSON.stringify({ top: top(day, mode, week) });
    if (getCache.size >= GET_CACHE_MAX) getCache.clear();
    getCache.set(k, text);
  }
  return text;
}

// A posted entry into its bucket (fingerprint first: the same run twice is refused). 'dup', or whether it was kept.
function add(entry) {
  if (entry.fp && fps.has(entry.fp)) return 'dup';
  const key = entry.day ?? '', rec = dayRec(key);
  if (key && (rec.expired || rec.n < newestDay - DAY_KEEP)) return false; // an expired day bucket
  const e = { name: entry.name, score: entry.score, at: new Date().toISOString(), day: entry.day, mode: entry.mode, week: entry.day ? isoWeek(entry.day) : null,
    replay: entry.replay, fp: entry.fp, seed: entry.rp ? entry.rp.seed : undefined };
  if (!place(key, e)) return false;
  noteDay(rec);
  getCache.clear();
  save();
  return true;
}

// ---- rate limit (in memory) ---------------------------------------------
const hits = new Map(); // ip -> [timestamps]

// An IPv6 address as its 8 groups, or null. Handles '::' anywhere, an IPv4 tail (::ffff:1.2.3.4) and a zone (%eth0).
function groups6(ip) {
  let s = ip.split('%')[0];
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) { const [a, b, c, d] = v4.slice(1).map(Number); s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail].map(x => (/^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN));
  return g.length === 8 && !g.some(Number.isNaN) ? g : null;
}
// The key of a client address: IPv4 as is (an IPv4-mapped IPv6 address too); IPv6 by its /64 (what one subscriber
// usually holds) or, for the verify budget, its /56 (what one subscriber may hold).
function addrKey(ip, bits = 64) {
  if (!ip.includes(':')) return ip;
  const g = groups6(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  const head = bits === 56 ? [g[0], g[1], g[2], g[3] & 0xff00] : g.slice(0, 4);
  return head.map(n => n.toString(16)).join(':') + '::/' + bits;
}
// The client address: behind a trusted proxy the last X-Forwarded-For hop (the one the proxy added), else the socket.
function clientIp(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!TRUST_PROXY) return ip;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return net.isIP(fwd) ? fwd : ip; // anything that is not an address (a spoofed header) keys on the socket
}
const clientKey = (req, bits = 64) => addrKey(clientIp(req), bits);
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

// ---- verify budget --------------------------------------------------------
// Replaying blocks the event loop, so the wall time spent simulating over the last RATE_WINDOW_MS is capped for the
// whole server (VERIFY_BUDGET_MS, past it 503) and for each client (VERIFY_CLIENT_MS, an IPv6 /56, past it 429).
const simSpent = { all: [], by: new Map() }; // [{ t, ms }] of the last window, oldest first
function waitOf(list, cap) { // seconds until the window frees enough, 0 = go
  const now = Date.now();
  while (list.length && now - list[0].t >= RATE_WINDOW_MS) list.shift();
  let spent = 0;
  for (const s of list) spent += s.ms;
  return spent > cap ? Math.max(1, Math.ceil((list[0].t + RATE_WINDOW_MS - now) / 1000)) : 0;
}
function spend(ms, who) {
  const s = { t: Date.now(), ms };
  simSpent.all.push(s);
  if (!simSpent.by.has(who)) simSpent.by.set(who, []);
  simSpent.by.get(who).push(s);
}
// Drop stale clients periodically so the maps cannot grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (!ts.some(t => now - t < RATE_WINDOW_MS)) hits.delete(ip);
  for (const [who, list] of simSpent.by) { waitOf(list, Infinity); if (!list.length) simSpent.by.delete(who); }   // waitOf drops the old spends
}, RATE_WINDOW_MS).unref();

// ---- http ----------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Hop-Token',
  'Access-Control-Max-Age': '86400',
};
// a JSON reply is never a page: the browser must not sniff it as one, run anything in it, or frame it
const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...SAFE, ...CORS, ...(ALLOW_ORIGIN !== '*' ? { Vary: 'Origin' } : {}) };
function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...(status === 400 ? { Connection: 'close' } : {}), ...extra, ...JSON_HEADERS });
  res.end(JSON.stringify(body));
}
function sendText(res, status, text) { // an already serialized JSON body
  res.writeHead(status, JSON_HEADERS);
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

// The fields of a POST body. Each returns the clean value, or BAD.
const BAD = Symbol('bad');
function nameOf(v) {
  if (typeof v !== 'string') return BAD;
  const name = v.trim();
  return name.length >= 1 && name.length <= 16 && /^[A-Za-z0-9 ]+$/.test(name) ? name : BAD;
}
const scoreOf = v => (Number.isInteger(v) && v >= 0 && v <= MAX_SCORE ? v : BAD);
function dayOfPost(v) {
  if (v === undefined) return null;
  return typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(dayNum(v)) ? v : BAD;
}
const modeOf = v => (v === undefined ? 'classic' : MODES.includes(v) ? v : BAD);
// the replay link code of the run (screens.js): checked with VERIFY, else only its shape; stored either way
function replayOf(v) {
  if (v === undefined) return null;
  if (typeof v !== 'string' || v.length > MAX_REPLAY || !/^[\w-]+$/.test(v)) return BAD;
  return !VERIFY && !decodeReplay(v) ? null : v;   // not a replay: do not store the junk
}
function validate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const entry = { name: nameOf(obj.name), score: scoreOf(obj.score), day: dayOfPost(obj.day), mode: modeOf(obj.mode), replay: replayOf(obj.replay) };
  if (Object.values(entry).includes(BAD)) return null;
  return { ...entry, rp: entry.replay ? decodeReplay(entry.replay) : null };
}
// What any posted run must be, VERIFY or not: [status, error] or null. The day is the player's date: the server's
// UTC date, the day before or the day after (time zones); the rules no older than MIN_RULES; no handicap shield (it
// is a help for a younger player, not a ranked run); every joined animal one the game has.
function runRefused(entry) {
  if (entry.day && Math.abs(dayNum(entry.day) - todayNum()) > 1) return [400, 'day out of range: today (UTC) or a day either side'];
  const rp = entry.rp;
  if (!rp) return null;
  if (rp.version < MIN_RULES) return [400, `old rules: replay version ${rp.version}, this server takes ${MIN_RULES} or newer`];
  if (rp.handicap !== 0) return [400, 'handicap runs are not ranked'];
  if (rp.chars.some((k, i) => rp.joined[i] && !Object.hasOwn(TRAITS, k))) return [400, 'unknown animal'];
  return null;
}

// VERIFY: play the posted run again (sim.js, the same rules as the game) and accept only the score it plays to.
// Daily runs must be on that day's world; classic, race and room runs may be on any seed.
// The run as the server keeps it: only the hops the rules started (sim.js onHop), so a padded code (hops for a player
// who never joined, after the end, refused or overwritten moves) is stored at its true size and fingerprinted as the
// run it is. Coins-only traits (fox, pig) fingerprint as the frog: the same hops are the same run.
const COIN_ONLY = new Set(['text', 'comboGap', 'magnet']);
const runAnimal = k => (Object.keys(traitOf(k)).every(f => COIN_ONLY.has(f)) ? 'frog' : k);
function fingerprint(rp, hops) {
  const who = rp.chars.map((k, i) => (rp.joined[i] ? runAnimal(k) : '-'));
  return crypto.createHash('sha256').update(JSON.stringify([rp.seed, rp.mode, rp.startTick, who, rp.handicap, hops])).digest('base64url').slice(0, 22);
}
// one timed replay; TIMEOUT when VERIFY_MS ran out (the server is slow, not the run wrong)
const TIMEOUT = Symbol('timeout');
function timedSim(rp, maxTicks, who, onHop) {
  const t0 = performance.now();
  const run = simulate(rp, { maxMs: SIM_MS, maxTicks, onHop });
  const ms = performance.now() - t0;
  spend(ms, who);
  return !run && ms >= SIM_MS ? TIMEOUT : run;
}
// the code to store: the fresh code of the applied hops when it plays to the same end (it always has: tests), else the
// posted hops of the joined players up to the end tick (the same run by construction: the replay feed skips the rest)
function cleanCode(entry, hops, run, who) {
  const rp = entry.rp, chars = rp.chars.map((k, i) => (rp.joined[i] || Object.hasOwn(TRAITS, k) ? k : 'frog'));
  const code = encodeReplay({ ...rp, chars, events: hops });
  if (code === entry.replay) return code;
  const again = timedSim(decodeReplay(code), run.endTick + 1, who);
  if (again && again !== TIMEOUT && again.score === run.score && again.endTick === run.endTick) return code;
  console.log('scores: kept the posted hops (the fresh code played to another end)');
  return encodeReplay({ ...rp, chars, events: rp.events.filter(([t, p]) => rp.joined[p] && t <= run.endTick) });
}
const DUP = [409, 'this run is already on the boards'];
// [status, error, headers] or null; sets entry.fp and entry.replay (the clean code)
function verify(entry, who) {
  const rp = entry.rp;
  if (!rp || rp.mode !== entry.mode) return [400, 'replay mismatch'];
  if (rp.mode === 'daily' && (!entry.day || rp.seed !== dailySeedFor(entry.day))) return [400, 'replay mismatch'];
  const hops = [];
  const run = timedSim(rp, Math.min(MAX_RUN_TICKS, (entry.score + 10) * TICKS_PER_ROW), who, (...h) => hops.push(h));
  if (run === TIMEOUT) return [503, 'busy: the replay check ran out of time', { 'Retry-After': String(BUSY_RETRY_S) }];
  if (!run || !run.over || run.score !== entry.score) return [400, 'replay mismatch'];
  entry.fp = fingerprint(rp, hops);
  if (fps.has(entry.fp)) return DUP; // before the second replay: a copy costs one
  entry.replay = cleanCode(entry, hops, run, who);
  return null;
}
// the budgets first: a replay is only played while there is time for it
function budgetRefused(who) {
  const all = waitOf(simSpent.all, VERIFY_BUDGET_MS);
  if (all) return [503, 'busy', { 'Retry-After': String(all) }];
  const mine = waitOf(simSpent.by.get(who) || [], VERIFY_CLIENT_MS);
  return mine ? [429, 'rate limited', { 'Retry-After': String(mine) }] : null;
}

// GET /scores?day=YYYY-MM-DD | week=YYYY-Www, &mode=: the top 10, from the cache
function getScores(req, res, url) {
  const day = url.searchParams.get('day'), mode = url.searchParams.get('mode'), week = url.searchParams.get('week');
  if (day !== null && !DAY_RE.test(day)) return send(res, 400, { error: 'invalid day' });
  if (week !== null && !WEEK_RE.test(week)) return send(res, 400, { error: 'invalid week' });
  if (day !== null && week !== null) return send(res, 400, { error: 'day and week cannot be combined' });
  if (mode !== null && !MODES.includes(mode)) return send(res, 400, { error: 'invalid mode' });
  if (limited('get:' + clientKey(req), GET_RATE_MAX)) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': '60' });
  sendText(res, 200, topJson(day, mode, week));
}
// A POST must be JSON (a text/plain or form POST is a CORS simple request any page can send, with no preflight) and,
// when ALLOW_ORIGIN names the game, come from it (a browser always sends Origin on a cross-site POST; a script
// without one gains nothing it could not do anyway). Then the token and the rate limit: [status, error, headers] or null.
const JSON_TYPE = /^application\/json\s*(;|$)/i;
function requestRefused(req) {
  if (!JSON_TYPE.test(String(req.headers['content-type'] ?? ''))) return [415, 'content type must be application/json'];
  if (ALLOW_ORIGIN !== '*' && req.headers.origin !== undefined && req.headers.origin !== ALLOW_ORIGIN) return [403, 'origin not allowed'];
  if (POST_TOKEN && !tokenOk(req.headers['x-hop-token'])) return [401, 'bad token'];
  if (limited(clientKey(req))) return [429, 'rate limited', { 'Retry-After': '60' }];
  return null;
}
// POST /scores { name, score, day?, mode?, replay? }: content type, origin, token, rate limit, shape, run rules,
// then (VERIFY) the budgets and the replay, then the fingerprint (409 for a run already on the boards)
async function postScore(req, res) {
  const refused = requestRefused(req);
  if (refused) return send(res, refused[0], { error: refused[1] }, refused[2]);
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
  const entry = validate(parsed);
  if (!entry) return send(res, 400, { error: 'invalid name, score, day or mode' });
  const who = clientKey(req, 56);
  const bad = runRefused(entry) || (VERIFY && (budgetRefused(who) || verify(entry, who)));
  if (bad) return send(res, bad[0], { error: bad[1] }, bad[2]);
  if (add(entry) === 'dup') return send(res, DUP[0], { error: DUP[1] });
  send(res, 200, { top: top(null, null, null, false) });
}
const ROUTES = { GET: getScores, POST: postScore, OPTIONS: (req, res) => { res.writeHead(204, { ...SAFE, ...CORS }); res.end(); } };

const server = http.createServer(async (req, res) => {
  try {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: 'bad url' }); } // an absolute-form target the parser rejects (http://[::1/x) is the client's fault, not a 500
    const route = url.pathname === '/scores' && Object.hasOwn(ROUTES, req.method) ? ROUTES[req.method] : null;
    if (!route) return send(res, 404, { error: 'not found' });
    await route(req, res, url);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? 'bad request' : 'server error' });
  }
});

server.requestTimeout = 10_000;      // a whole request (headers and body) within 10 s
server.headersTimeout = 5_000;       // the headers within 5 s
server.maxRequestsPerSocket = 100;   // then the keep-alive connection is closed

// Warm-up before listening: the first replays in a fresh process run 4-5x slower (the JIT has not compiled the rules
// yet), so a long honest run checked cold could pass VERIFY_MS. The bench replay (tests/bench-replay.txt, 62 s of play
// over every lane kind) is built in, so the warm-up needs no test files.
const WARM_RUN = 'MnwyMXxjbGFzc2ljfGZyb2csZm94fDF8MHw2MDB8MWFVMTVhUjE1YVUxNWFVMTVhUjE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YUwxNWFVMTVhUjE1YUwxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTM3YVUxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFMMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUzMmFVMzJhVTE1YVUxNWFVMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFSMTVhVTE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhTDE1YUwxNWFVMTVhVTE1YVUxNWFMMTVhUjE1YUwxNWFVMTVhVTE1YVUxNWFSMTVhVTE1YVUxNWFVMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhVTE1YVUxNWFVMTVhUjE1YVUxNWFVMTVhUjE1YVUxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhVTI3YUQxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhTDE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YVUxNWFVMTVhUjE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YUwxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhUjI3YUQxNWFMMTVhTDE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhVTE1YVUxNWFMMTVhTDE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVUxNWFVMTVhVTI0YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFVMTVhVTE1YVUzMmFVMzJhVTE1YVUxNWFVMTVhTDE1YUwxNWFMMTVhVTE1YUwxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFSMTVhTDE1YVIxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFMMTVhTDE1YUwzM2FEMjFhRDE1YVIxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFVMTVhVTE1YVIxNWFSMTVhTDE1YVUxNWFSMTVhTDE1YVUxNWFVMTVhVTE1YVUxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YVIxNWFMMTVhUjE1YVUxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhVTI3YVIxNWFMMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFVMTVhVTE1YUwxNWFMMTVhVTE1YVUxNWFVMTVhVQ';
const WARM_TIMES = 10;
function warmUp() {
  const rp = decodeReplay(WARM_RUN), t0 = performance.now();
  for (let i = 0; rp && i < WARM_TIMES; i++) { const hops = []; simulate({ ...rp, version: i & 1 ? 2 : RULES }, { onHop: (...h) => hops.push(h) }); encodeReplay({ ...rp, events: hops }); }
  return Math.round(performance.now() - t0);
}

// Start only when run as a script (node server/scores.mjs), so tests can import isoWeek.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  load();
  const warm = VERIFY ? warmUp() : 0;
  server.listen(PORT, () => {
    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    console.log(`hop-lanes scores on :${addr.port} (data: ${DATA_FILE}, days: ${DAYS_DIR})${VERIFY ? ` (verifying replays, rules ${MIN_RULES}+; warm-up ${warm} ms)` : ''}`);
  });
}
