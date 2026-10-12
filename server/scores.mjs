// Hop Lanes optional online high-score server. Dependency-free, Node 20+.
// Run: node server/scores.mjs
// Env: PORT (8787), DATA_FILE (./scores.json next to this script), ALLOW_ORIGIN ('*').
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(HERE, 'scores.json');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const MAX_ENTRIES = 1000;      // entries kept on disk
const TOP_N = 10;              // entries returned
const MAX_BODY = 1024;         // bytes
const RATE_MAX = Number(process.env.RATE_MAX ?? 10); // POSTs per window per IP (env override is for tests)
const RATE_WINDOW_MS = 60_000;

// ---- storage -------------------------------------------------------------
let scores = load();

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

const top = () => scores.slice(0, TOP_N).map(({ name, score, at }) => ({ name, score, at }));

function add(name, score) {
  scores.push({ name, score, at: new Date().toISOString() });
  // Highest score first; earlier entries win ties (sort is stable).
  scores.sort((a, b) => b.score - a.score);
  if (scores.length > MAX_ENTRIES) scores.length = MAX_ENTRIES;
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
    'Access-Control-Allow-Headers': 'Content-Type',
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
  if (!Number.isInteger(score) || score < 0 || score > 100000) return null;
  return { name, score };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/scores') return send(res, 404, { error: 'not found' });
    if (req.method === 'OPTIONS') { res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }); return res.end(); }
    if (req.method === 'GET') return send(res, 200, { top: top() });
    if (req.method === 'POST') {
      if (limited(req.socket.remoteAddress || 'unknown')) return send(res, 429, { error: 'rate limited' });
      let parsed;
      try { parsed = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
      const entry = validate(parsed);
      if (!entry) return send(res, 400, { error: 'invalid name or score' });
      add(entry.name, entry.score);
      return send(res, 200, { top: top() });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? 'bad request' : 'server error' });
  }
});

server.listen(PORT, () => console.log(`hop-lanes scores on :${server.address().port} (data: ${DATA_FILE})`));
