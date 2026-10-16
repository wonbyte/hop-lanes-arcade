#!/usr/bin/env node
// Load test for server/scores.mjs (autocannon, programmatic). Starts the server on a free port with VERIFY=1 and a
// temp data file, seeds 200 verified scores, then: (1) 60 s at 200 req/s, 70% GET /scores with random filters and 30%
// POST with a fresh valid replay; (2) 30 s of pure POST at 50 req/s (the verify path). Prints p50/p99 latency, req/s,
// errors, the 429/503 counts and the server's RSS before and after each run.
// Run: node tools/load-server.mjs [--seed N] [--out file.json] [--short] [--token T]
// The rate limits are raised (one client IP), the verify budget stays at its default so 503s show up when it is spent.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import { encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';
import { MODES, TRAITS, dailySeedFor } from '../js/rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '../server/scores.mjs');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SEED = Number(flag('--seed', 7));
const OUT = flag('--out', '');
const TOKEN = flag('--token', process.env.POST_TOKEN || '');
const SHORT = args.includes('--short');   // a quick check of the tool itself
const RUN1_S = SHORT ? 5 : 60, RUN1_RATE = 200, RUN2_S = SHORT ? 5 : 30, RUN2_RATE = 50;

// ---- seeded PRNG ----
let rngState = SEED >>> 0;
function rnd() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const ANIMALS = [...new Set(['frog', ...Object.keys(TRAITS)])];
const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]];
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// A valid POST body: a random run that simulate() plays to game over, with the score it plays to.
let built = 0;
function validBody(name) {
  for (;;) {
    const mode = pick(MODES), day = int(0, 2) ? dayAgo(int(0, 10)) : undefined;
    const seed = mode === 'daily' ? dailySeedFor(day || today()) : int(0, 4294967295);
    const joined = [true, rnd() < 0.4];
    const events = [];
    let t = 0;
    for (let i = int(5, 120); i > 0; i--) {
      t += int(10, 500);
      const d = rnd() < 0.8 ? DIRS[0] : pick(DIRS);
      events.push([t, joined[1] && rnd() < 0.5 ? 1 : 0, d[0], d[1]]);
    }
    const rp = { seed, mode, chars: [pick(ANIMALS), pick(ANIMALS)], joined, handicap: int(0, 2), startTick: int(0, 2000), events };
    const run = simulate(rp, { maxMs: 300 });
    built++;
    if (!run || !run.over || run.score > 5000) continue;
    const body = { name, score: run.score, mode, replay: encodeReplay(rp) };
    if (mode === 'daily') body.day = day || today(); else if (day) body.day = day;
    return JSON.stringify(body);
  }
}

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
function rssMB(pid) {
  try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? +(m[1] / 1024).toFixed(1) : null; } catch { return null; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-load-'));
const port = await freePort();
const env = { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'scores.json'), VERIFY: '1', RATE_MAX: '1000000000', GET_RATE_MAX: '1000000000' };
if (TOKEN) env.POST_TOKEN = TOKEN;
const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
proc.stdout.on('data', d => { serverLog += d; });
proc.stderr.on('data', d => { serverLog += d; });
await new Promise((res, rej) => { proc.stdout.once('data', res); proc.once('error', rej); proc.once('exit', c => rej(new Error('server exited ' + c))); });
const base = `http://127.0.0.1:${port}`;
const headers = { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Hop-Token': TOKEN } : {}) };
console.log(`server pid ${proc.pid} on ${base}, data ${dir}, RSS at start ${rssMB(proc.pid)} MB`);

// ---- seed 200 verified scores ----
let t0 = Date.now();
let seeded = 0, seedFail = 0;
for (let i = 0; i < 200; i++) {
  const r = await fetch(base + '/scores', { method: 'POST', headers, body: validBody(`Seed${i}`) });
  if (r.status === 200) seeded++; else { seedFail++; if (seedFail < 4) console.log('seed POST', r.status, await r.text()); }
}
console.log(`seeded ${seeded} scores (${seedFail} failed) in ${Date.now() - t0} ms; RSS ${rssMB(proc.pid)} MB`);

// ---- pre-build the POST bodies the runs will send (building them during the run would skew the client) ----
t0 = Date.now();
const pool1 = [], pool2 = [];
const n1 = Math.ceil(RUN1_S * RUN1_RATE * 0.3 * 1.15), n2 = Math.ceil(RUN2_S * RUN2_RATE * 1.15);
for (let i = 0; i < n1; i++) pool1.push(validBody(`Mix${i}`));
for (let i = 0; i < n2; i++) pool2.push(validBody(`Post${i}`));
console.log(`built ${n1 + n2} POST bodies (${built} runs simulated) in ${Date.now() - t0} ms`);

const QUERIES = ['', '?mode=classic', '?mode=daily', '?mode=race', '?mode=coinwar', '?mode=tag', '?mode=room', () => `?day=${dayAgo(int(0, 12))}`, () => `?day=${dayAgo(int(0, 12))}&mode=daily`, () => `?week=${isoWeekOf(dayAgo(int(0, 12)))}`, () => `?week=${isoWeekOf(dayAgo(int(0, 12)))}&mode=classic`];
function isoWeekOf(day) {   // ISO week of a YYYY-MM-DD (the same as rules.js isoWeek)
  const d = new Date(day + 'T00:00:00Z'), dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4)), wk = 1 + Math.round(((d - jan4) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

function summarize(label, res, rssBefore, rssAfter) {
  const codes = Object.fromEntries(Object.entries(res.statusCodeStats || {}).map(([k, v]) => [k, v.count]));
  const out = {
    label, durationS: res.duration, requestsTotal: res.requests.total, reqPerSec: res.requests.average,
    p50ms: res.latency.p50, p99ms: res.latency.p99, maxMs: res.latency.max, errors: res.errors, timeouts: res.timeouts,
    non2xx: res.non2xx, status: codes, s429: codes[429] || 0, s503: codes[503] || 0, rssBeforeMB: rssBefore, rssAfterMB: rssAfter
  };
  console.log(`\n== ${label}\n` + JSON.stringify(out, null, 1));
  return out;
}

// ---- run 1: 60 s at 200 req/s, 70% GET / 30% POST ----
const rss1 = rssMB(proc.pid);
let gets = 0, posts = 0, p1 = 0;
const byMethod = {};   // status counts per method, from onResponse
let busy = 0;   // the server's own 503 {"error":"busy"} (the verify budget), as opposed to node's 503 past maxRequestsPerSocket
const count = (m, status, body) => { const k = `${m} ${status}`; byMethod[k] = (byMethod[k] || 0) + 1; if (status === 503 && /busy/.test(body)) busy++; };
console.log(`\nrun 1: ${RUN1_S} s at ${RUN1_RATE} req/s, 70% GET, 30% POST ...`);
const run1 = await autocannon({
  url: base, connections: 20, duration: RUN1_S, overallRate: RUN1_RATE, timeout: 10, reconnectRate: 90,   // under server.maxRequestsPerSocket (100): past it node answers 503 on a socket autocannon keeps using
  requests: [{
    setupRequest(req, context) {
      if (rnd() < 0.7) {
        const q = pick(QUERIES);
        gets++; context.method = 'GET';
        return { ...req, method: 'GET', path: '/scores' + (typeof q === 'function' ? q() : q), headers: {}, body: undefined };
      }
      posts++; context.method = 'POST';
      return { ...req, method: 'POST', path: '/scores', headers, body: pool1[p1++ % pool1.length] };
    },
    onResponse(status, body, context) { count(context.method, status, body); }
  }]
});
const sum1 = summarize('run 1: mixed 70% GET / 30% POST', run1, rss1, rssMB(proc.pid));
sum1.gets = gets; sum1.posts = posts; sum1.byMethod = { ...byMethod }; sum1.busy503 = busy;
console.log(`sent ${gets} GET, ${posts} POST; by method: ${JSON.stringify(byMethod)}; 503 busy (the verify budget): ${busy}`);

// ---- run 2: 30 s of pure POST at 50 req/s ----
const rss2 = rssMB(proc.pid);
let p2 = 0;
console.log(`\nrun 2: ${RUN2_S} s of POST at ${RUN2_RATE} req/s ...`);
const run2 = await autocannon({
  url: base, connections: 10, duration: RUN2_S, overallRate: RUN2_RATE, timeout: 10, reconnectRate: 90,
  requests: [{ setupRequest(req) { return { ...req, method: 'POST', path: '/scores', headers, body: pool2[p2++ % pool2.length] }; }, onResponse(status, body) { count('POST2', status, body); } }]
});
const sum2 = summarize('run 2: pure POST (verify path)', run2, rss2, rssMB(proc.pid));
sum2.busy503 = busy - sum1.busy503; console.log(`503 busy (the verify budget): ${sum2.busy503}`);

const final = await fetch(base + '/scores');
console.log(`\nGET after the runs: ${final.status}; server RSS ${rssMB(proc.pid)} MB; server log: ${serverLog.trim().split('\n').length} line(s)`);
if (/error|warn|unhandled/i.test(serverLog)) console.log('SERVER LOG:\n' + serverLog);
proc.kill();
await new Promise(r => proc.once('exit', r));
const report = { seed: SEED, node: process.version, cpus: os.cpus().length, seeded, run1: sum1, run2: sum2, serverLog: serverLog.trim() };
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(report, null, 1)); console.log('saved ' + OUT); }
fs.rmSync(dir, { recursive: true, force: true });
