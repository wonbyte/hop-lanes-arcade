// Hop Lanes optional online high-score server. Dependency-free, Node 20+.
// Run: node server/scores.mjs
// Env: PORT (8787), DATA_FILE (./scores.json next to this script), ALLOW_ORIGIN ('*'), POST_TOKEN ('' = none), MAX_SCORE (5000), RATE_MAX (10).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(HERE, 'scores.json');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const POST_TOKEN = process.env.POST_TOKEN || ''; // when set, POSTs must send it as X-Hop-Token

const MAX_PER_BUCKET = 200;    // entries kept per bucket (mode|day), so a flood in one bucket cannot evict the rest
const MAX_SCORE = Number(process.env.MAX_SCORE ?? 5000); // highest accepted score (env override is for tests)
const DAY_KEEP = 14;           // day buckets older than this many days behind the newest day are dropped
const TOP_N = 10;              // entries returned
const MAX_BODY = 1024;         // bytes
const RATE_MAX = Number(process.env.RATE_MAX ?? 10); // POSTs per window per IP (env override is for tests)
const RATE_WINDOW_MS = 60_000;

// ---- storage -------------------------------------------------------------
// One flat array on disk (old files stay readable), kept sorted by score, highest first.
let scores = [];

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(data)) return data.filter(e => e && typeof e.name === 'string' && Number.isInteger(e.score));
  } catch { /* missing or corrupt file: start empty */ }
  return [];
}

// Write to a temp file then rename, so readers never see a half-written file.
function save() {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scores));
  fs.renameSync(tmp, DATA_FILE);
}

const MODES = ['classic', 'race', 'daily', 'room'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const bucketOf = e => `${e.mode ?? 'classic'}|${e.day ?? ''}`;
const dayNum = d => Date.parse(`${d}T00:00:00Z`) / DAY_MS; // NaN for impossible dates

// Newest day an entry may carry: tomorrow UTC (clock skew); later days are refused on POST.
const latestDay = () => new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);

// Sort, keep one entry per (name, bucket) (the highest), cap each bucket, drop expired day buckets.
function compact(list) {
  const limit = dayNum(latestDay());
  let newest = -Infinity; // newest day seen, ignoring far-future junk
  for (const e of list) { const n = e.day ? dayNum(e.day) : NaN; if (n <= limit && n > newest) newest = n; }
  const sorted = list.slice().sort((a, b) => b.score - a.score); // stable: earlier entries win ties
  const seen = new Set(), count = new Map(), out = [];
  for (const e of sorted) {
    if (e.day) { const n = dayNum(e.day); if (!(n >= newest - DAY_KEEP)) continue; }
    const b = bucketOf(e), who = `${b}|${e.name}`;
    if (seen.has(who)) continue;
    const c = count.get(b) ?? 0;
    if (c >= MAX_PER_BUCKET) continue;
    seen.add(who); count.set(b, c + 1); out.push(e);
  }
  return out;
}

scores = compact(load());

// Top entries, optionally only those with a given day and/or mode. Entries saved before
// day/mode existed read as day null, mode 'classic'.
function top(day, mode) {
  const out = [];
  for (const e of scores) {
    const d = e.day ?? null, m = e.mode ?? 'classic';
    if (day && d !== day) continue;
    if (mode && m !== mode) continue;
    out.push({ name: e.name, score: e.score, at: e.at, day: d, mode: m });
    if (out.length >= TOP_N) break;
  }
  return out;
}

function add(name, score, day, mode) {
  const probe = { name, day, mode };
  const old = scores.find(e => e.name === name && bucketOf(e) === bucketOf(probe));
  if (old && old.score >= score) return; // keep the higher score
  if (old) scores.splice(scores.indexOf(old), 1);
  scores.push({ name, score, at: new Date().toISOString(), day, mode });
  scores = compact(scores);
  save();
}

// ---- rate limit (in memory) ---------------------------------------------
const hits = new Map(); // ip -> [timestamps]

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
// Drop stale IPs periodically so the map cannot grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (!ts.some(t => now - t < RATE_WINDOW_MS)) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

// ---- http ----------------------------------------------------------------
function send(res, status, body) {
  res.writeHead(status, {
    ...(status === 400 ? { Connection: 'close' } : {}),
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Hop-Token',
    'Access-Control-Max-Age': '86400',
    ...(ALLOW_ORIGIN !== '*' ? { Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
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
  return { name, score, day, mode };
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
      const day = url.searchParams.get('day'), mode = url.searchParams.get('mode');
      if (day !== null && !DAY_RE.test(day)) return send(res, 400, { error: 'invalid day' });
      if (mode !== null && !MODES.includes(mode)) return send(res, 400, { error: 'invalid mode' });
      return send(res, 200, { top: top(day, mode) });
    }
    if (req.method === 'POST') {
      if (POST_TOKEN && req.headers['x-hop-token'] !== POST_TOKEN) return send(res, 401, { error: 'bad token' });
      if (limited(req.socket.remoteAddress || 'unknown')) return send(res, 429, { error: 'rate limited' });
      let parsed;
      try { parsed = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
      const entry = validate(parsed);
      if (!entry) return send(res, 400, { error: 'invalid name, score, day or mode' });
      add(entry.name, entry.score, entry.day, entry.mode);
      return send(res, 200, { top: top() });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? 'bad request' : 'server error' });
  }
});

server.listen(PORT, () => console.log(`hop-lanes scores on :${server.address().port} (data: ${DATA_FILE})`));
