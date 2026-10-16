#!/usr/bin/env node
// HTTP fuzzer for server/scores.mjs. Starts the server (VERIFY=1, TRUST_PROXY=1, a temp data file, rate limits
// raised) and throws random and mutated requests at it: JSON bodies with wrong types, huge numbers, unicode, deep
// nesting, 40 KB bodies, invalid UTF-8, slow chunked bodies, duplicate headers, odd Content-Length, bad
// X-Forwarded-For, random query strings, random paths and methods. Findings: a 5xx other than the documented 503
// busy, a crash or an unhandled rejection in the server log, a response over 2 s, memory growth over 50 MB.
// Run: node tools/fuzz-server.mjs [--seconds N (600)] [--seed N] [--url http://host:port (fuzz a running server; no RSS or log)]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';
import { MODES, TRAITS, dailySeedFor } from '../js/rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '../server/scores.mjs');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SECONDS = Number(flag('--seconds', 600));
const SEED = Number(flag('--seed', (Date.now() ^ (process.pid << 8)) >>> 0));
const EXTERNAL = flag('--url', '');
const SLOW_MS = 2000, GROW_MB = 50, CONCURRENCY = 8;

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
const chance = p => rnd() < p;
const enc = s => { try { return encodeURIComponent(s); } catch { return encodeURIComponent(s.replace(/[\ud800-\udfff]/g, '')); } };   // lone surrogates
const ANIMALS = [...new Set(['frog', ...Object.keys(TRAITS)])];
const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]];
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function randomString(len) {
  const kind = int(0, 5);
  let s = '';
  for (let i = 0; i < len; i++) {
    if (kind === 0) s += String.fromCharCode(int(32, 126));
    else if (kind === 1) s += String.fromCharCode(int(0, 0xffff));
    else if (kind === 2) s += pick(['\u0000', '\ud800', '\udfff', ' ', '﻿', 'é', '\u{1f438}', '\\', '"', '\n', '\r', ' ', 'a', '1']);
    else if (kind === 3) s += pick('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
    else if (kind === 4) s += String.fromCharCode(int(0, 255));
    else s += pick(['%', '%2', '%zz', '%00', '&', '=', '?', '#', '/', '..', ' ', '+', 'é', '\t']);
  }
  return s;
}
const oddNumber = () => pick([0, -0, -1, 1e308, -1e308, 2 ** 53, 2 ** 53 + 1, 4294967296, 5000, 5001, 1.5, 0.1, 1e-300, Number('999999999999999999999')]);
const oddValue = (depth = 0) => {
  const r = int(0, depth > 2 ? 6 : 9);
  switch (r) {
    case 0: return null; case 1: return true; case 2: return oddNumber(); case 3: return randomString(int(0, 40));
    case 4: return ''; case 5: return 'a'.repeat(int(0, 5000)); case 6: return randomString(int(0, 2000));
    case 7: return Array.from({ length: int(0, 5) }, () => oddValue(depth + 1));
    case 8: return Object.fromEntries(Array.from({ length: int(0, 5) }, () => [randomString(int(0, 8)), oddValue(depth + 1)]));
    default: return { constructor: 'x', ['__proto__']: { polluted: 1 } };   // an own __proto__ key, as JSON.parse would make
  }
};

let valid = 0;
function validBody() {
  for (;;) {
    const mode = pick(MODES), day = chance(0.6) ? dayAgo(int(0, 10)) : undefined;
    const seed = mode === 'daily' ? dailySeedFor(day || today()) : int(0, 4294967295);
    const joined = [true, chance(0.4)];
    const events = [];
    let t = 0;
    for (let i = int(3, 60); i > 0; i--) { t += int(10, 500); const d = chance(0.8) ? DIRS[0] : pick(DIRS); events.push([t, joined[1] && chance(0.5) ? 1 : 0, d[0], d[1]]); }
    const rp = { seed, mode, chars: [pick(ANIMALS), pick(ANIMALS)], joined, handicap: int(0, 2), startTick: int(0, 2000), events };
    const run = simulate(rp, { maxMs: 300 });
    if (!run || !run.over || run.score > 5000) continue;
    valid++;
    const body = { name: 'Fz' + int(0, 99999), score: run.score, mode, replay: encodeReplay(rp) };
    if (mode === 'daily') body.day = day || today(); else if (day) body.day = day;
    return body;
  }
}
function mutateBody(b) {
  const o = { ...b };
  const k = int(0, 11);
  switch (k) {
    case 0: o[pick(['name', 'score', 'mode', 'day', 'replay'])] = oddValue(); break;
    case 1: o.score = oddNumber(); break;
    case 2: o.name = randomString(int(0, 64)); break;
    case 3: o.day = pick(['2026-13-45', '0000-00-00', '9999-12-31', '2026-02-30', today(), new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), randomString(10), '2026-10-1', '2026-10-100']); break;
    case 4: o.replay = pick(['', 'A', 'x'.repeat(32768), 'x'.repeat(32769), 'A'.repeat(int(1, 40000)), randomString(int(1, 500)), b.replay + '=', b.replay.slice(0, -5)]); break;
    case 5: o.mode = pick(['', 'CLASSIC', 'constructor', '__proto__', randomString(8), 'daily']); break;
    case 6: delete o[pick(['name', 'score', 'mode', 'day', 'replay'])]; break;
    case 7: o[randomString(int(1, 10))] = oddValue(); break;
    case 8: return oddValue();
    case 9: return [o];
    case 10: return { ...o, __proto__: { score: 1 } };
    default: for (let i = 0; i < 3; i++) o[pick(['name', 'score', 'mode', 'day', 'replay'])] = oddValue(); break;
  }
  return o;
}
function rawBody() {   // a body that is not a JSON object built from values
  switch (int(0, 9)) {
    case 0: return Buffer.from('['.repeat(int(1, 100000)));                                     // deep nesting, unclosed
    case 1: { const n = int(1, 50000); return Buffer.from('['.repeat(n) + ']'.repeat(n)); }    // deep nesting, closed
    case 2: { const n = int(1, 20000); return Buffer.from('{"a":'.repeat(n) + '1' + '}'.repeat(n)); }
    case 3: return Buffer.from(JSON.stringify({ name: 'A', score: 1, pad: 'x'.repeat(40 * 1024 - 60) }));   // just under 40 KB
    case 4: return Buffer.from(JSON.stringify({ name: 'A', score: 1, pad: 'x'.repeat(40 * 1024 + int(0, 2000)) }));   // over 40 KB
    case 5: return Buffer.from(Array.from({ length: int(1, 300) }, () => int(0, 255)));          // invalid UTF-8 bytes
    case 6: return Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80]), Buffer.from('","score":1}')]);
    case 7: return Buffer.from(pick(['', ' ', 'null', 'true', '1', '"x"', '{', '}', '{"score":1e999,"name":"A"}', '{"name":"A","score":-0}', '{"name":"A","score":1,"name":"B"}', '﻿{"name":"A","score":1}', '{"name":"A\\u0000","score":1}']));
    case 8: return Buffer.from(randomString(int(0, 3000)));
    default: return Buffer.from(JSON.stringify(validBody()).replace(/"/g, pick(['"', "'", '"', '\\"'])));
  }
}

// ---- transport ----
const findings = [];
let sent = 0, answered = 0, noReply = 0, maxMs = 0, slowest = '';
const statusCount = {};
function finding(kind, detail) { findings.push({ kind, detail }); console.log(`FINDING ${kind} seed=${SEED} req#${sent} ${detail}`); }
const describe = r => `${r.method} ${String(r.path).slice(0, 80)} headers=${JSON.stringify(r.headers).slice(0, 200)} body=${r.body ? JSON.stringify(Buffer.isBuffer(r.body) ? r.body.toString('latin1').slice(0, 120) : String(r.body).slice(0, 120)) + ` (${r.body.length} bytes)` : 'none'}`;
function note(r, status, ms, expectSlow) {
  answered++;
  statusCount[status] = (statusCount[status] || 0) + 1;
  if (ms > maxMs) { maxMs = ms; slowest = `${status} in ${ms.toFixed(0)} ms: ${describe(r)}`; }
  if (status >= 500 && status !== 503) finding('5xx', `${status}: ${describe(r)}`);
  if (ms > SLOW_MS && !expectSlow) finding('slow', `${ms.toFixed(0)} ms: ${describe(r)}`);
}
// a normal request through node:http (headers may repeat: arrays)
function viaHttp(r, base) {
  return new Promise(resolve => {
    const t0 = performance.now();
    // node:http refuses control and non-latin1 characters in headers (the raw socket path sends those): keep it printable
    const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.replace(/[^\x21-\x7e]/g, '') || 'x', String(v).replace(/[^\x20-\x7e]/g, '')]));
    let req;
    try {
      req = http.request(base + r.path.replace(/[^\x21-\x7e]/g, c => encodeURIComponent(c)), { method: r.method, headers, timeout: 15000 }, res => {
      res.resume();
      res.on('end', () => { note(r, res.statusCode, performance.now() - t0, r.expectSlow); resolve(); });
      res.on('error', () => resolve());
      });
    } catch (e) { noReply++; return resolve(); }   // a method or path the client itself refuses
    req.on('timeout', () => { noReply++; if (!r.expectSlow) finding('no-reply', 'timeout after 15 s: ' + describe(r)); req.destroy(); resolve(); });
    req.on('error', () => { noReply++; resolve(); });   // the server closed the connection (a 400 closes it; node refuses junk itself)
    if (r.body && r.slow) { // chunked, dribbled
      const b = Buffer.from(r.body), n = int(2, 8), size = Math.ceil(b.length / n);
      let i = 0;
      const tick = () => { if (i * size >= b.length) return req.end(); req.write(b.subarray(i * size, (i + 1) * size)); i++; setTimeout(tick, r.slow); };
      tick();
    } else req.end(r.body);
  });
}
// a raw request over a socket for what node:http refuses to send (odd Content-Length, duplicated headers, bad methods)
function viaSocket(raw, r, host, port) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const s = net.connect(port, host);
    let data = '';
    const done = () => { s.destroy(); const m = /^HTTP\/1\.[01] (\d{3})/.exec(data); if (m) note(r, Number(m[1]), performance.now() - t0, r.expectSlow); else noReply++; resolve(); };
    s.setTimeout(r.expectSlow ? 15000 : 12000, () => { if (!r.expectSlow) finding('no-reply', 'socket timeout: ' + describe(r)); done(); });
    s.on('connect', () => s.write(raw));
    s.on('data', d => { data += d; if (/\r\n\r\n/.test(data)) setTimeout(done, 20); });
    s.on('error', done); s.on('close', done);
  });
}

function randomRequest() {
  const kind = int(0, 13);
  const h = { 'Content-Type': 'application/json' };
  if (chance(0.3)) h['X-Forwarded-For'] = pick(['1.2.3.4', '::1', '2001:db8::1, 10.0.0.1', '', 'not an ip', '999.999.999.999', '::ffff:1.2.3.4', ',,,', 'a'.repeat(4000), `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`, '1.2.3.4, 5.6.7.8, 9.9.9.9', '::', '1::', 'fe80::1%eth0', 'é']);
  if (chance(0.1)) h['X-Hop-Token'] = randomString(int(0, 100));
  if (chance(0.1)) h.Origin = randomString(int(1, 50));
  switch (kind) {
    case 0: case 1: return { method: 'POST', path: '/scores', headers: h, body: JSON.stringify(validBody()) };
    case 2: case 3: case 4: return { method: 'POST', path: '/scores', headers: h, body: JSON.stringify(mutateBody(validBody())) };
    case 5: case 6: return { method: 'POST', path: '/scores', headers: h, body: rawBody() };
    case 7: return { method: 'POST', path: '/scores', headers: h, body: JSON.stringify(chance(0.5) ? validBody() : mutateBody(validBody())), slow: int(50, 400), expectSlow: true };
    case 8: { // GET with a random query
      const q = Array.from({ length: int(0, 6) }, () => {
        const k = pick(['day', 'week', 'mode', 'day', 'week', 'mode', randomString(int(0, 10))]);
        const v = k === 'day' ? pick([dayAgo(int(0, 20)), '2026-99-99', randomString(10), `${int(0, 9999)}-${int(0, 99)}-${int(0, 99)}`.replace(/\b(\d)\b/g, '0$1')]) :
          k === 'week' ? pick([`2026-W${String(int(0, 60)).padStart(2, '0')}`, '2026-W1', randomString(8)]) :
            k === 'mode' ? pick([...MODES, 'CLASSIC', '', randomString(6)]) : randomString(int(0, 2000));
        return enc(k) + (chance(0.9) ? '=' + (chance(0.8) ? enc(v) : v) : '');
      }).join(pick(['&', ';', '&&', '&amp;']));
      return { method: 'GET', path: '/scores' + (q || chance(0.5) ? '?' + q : ''), headers: {} };
    }
    case 9: return { method: pick(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND', 'BREW']), path: pick(['/scores', '/', '/scores/', '/SCORES', '//scores', '/scores/../scores', '/x', '/scores%2f', '/scores?', '/scores#frag', '/' + randomString(int(1, 60)), '/scores' + '/'.repeat(int(1, 500)), '/' + 'a'.repeat(int(1000, 8000))]), headers: h, body: chance(0.5) ? JSON.stringify(validBody()) : undefined };
    case 10: return { method: 'GET', path: '/scores', headers: { ...h, Accept: randomString(int(0, 100)), 'Accept-Encoding': randomString(int(0, 20)), [randomString(int(1, 20)).replace(/[^a-z]/gi, 'x') || 'x']: randomString(int(0, 100)).replace(/[\r\n\0]/g, '') } };
    case 11: return { method: 'OPTIONS', path: pick(['/scores', '*', '/x']), headers: { Origin: randomString(int(0, 60)), 'Access-Control-Request-Method': pick(['POST', 'GET', 'DELETE', randomString(5)]), 'Access-Control-Request-Headers': randomString(int(0, 50)) } };
    case 12: return { method: 'POST', path: '/scores', headers: { ...h, 'Content-Type': pick(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '', 'application/json; charset=utf-16']) }, body: JSON.stringify(validBody()) };
    default: return { raw: true };
  }
}
function rawRequest(host, port) {   // what node:http will not send
  const body = chance(0.5) ? JSON.stringify(validBody()) : JSON.stringify(mutateBody(validBody()));
  const k = int(0, 11);
  let r, head;
  const hostLine = `Host: ${host}:${port}\r\n`;
  switch (k) {
    case 0: r = { method: 'POST', path: '/scores', headers: { cl: body.length + int(1, 5000) }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Content-Type: application/json\r\nContent-Length: ${r.headers.cl}\r\n\r\n${body}`; r.expectSlow = true; break;   // too long: waits for the rest, then the request times out
    case 1: r = { method: 'POST', path: '/scores', headers: { cl: Math.max(0, body.length - int(1, 20)) }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Content-Type: application/json\r\nContent-Length: ${r.headers.cl}\r\n\r\n${body}`; break;   // too short: the tail is junk for the next request
    case 2: r = { method: 'POST', path: '/scores', headers: { cl: pick(['-1', 'abc', '1e3', '0x10', '', '99999999999999999999', '1, 2']) }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Content-Length: ${r.headers.cl}\r\n\r\n${body}`; break;
    case 3: r = { method: 'POST', path: '/scores', headers: { dup: 'Content-Length' }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Content-Length: ${body.length}\r\nContent-Length: ${body.length}\r\n\r\n${body}`; break;
    case 4: r = { method: 'POST', path: '/scores', headers: { dup: 'X-Forwarded-For + Content-Type + Host' }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Host: evil\r\nX-Forwarded-For: 1.2.3.4\r\nX-Forwarded-For: not-ip\r\nContent-Type: a\r\nContent-Type: b\r\nContent-Length: ${body.length}\r\n\r\n${body}`; break;
    case 5: r = { method: 'POST', path: '/scores', headers: { te: 'chunked + content-length' }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Transfer-Encoding: chunked\r\nContent-Length: ${body.length}\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`; break;
    case 6: r = { method: 'POST', path: '/scores', headers: { te: 'chunked bad sizes' }, body }; head = `POST /scores HTTP/1.1\r\n${hostLine}Transfer-Encoding: chunked\r\n\r\n${pick(['zz', '-1', 'ffffffffffffffff', '10;ext=1', ''])}\r\n${body}\r\n0\r\n\r\n`; r.expectSlow = true; break;   // a chunk size that never completes: the 10 s request timeout (408) is the documented answer
    case 7: r = { method: pick(['GET', 'POST']), path: 'http://[::1/scores', headers: { absolute: 1 } }; head = `${r.method} ${pick(['http://[::1/scores', 'http://x:99999/scores', 'http://user@/scores', '*', 'scores', '/scores?%', 'http:///scores', '//evil/scores', '/scores?day=%E0%A4%A', 'HTTP://X/SCORES'])} HTTP/1.1\r\n${hostLine}Content-Length: 0\r\n\r\n`; r.path = head.split(' ')[1]; break;
    case 8: r = { method: 'GET', path: '/scores', headers: { version: 'HTTP/1.0 / 0.9 / 2' } }; head = pick([`GET /scores HTTP/1.0\r\n\r\n`, `GET /scores\r\n\r\n`, `GET /scores HTTP/2.0\r\n${hostLine}\r\n`, `GET /scores HTTP/1.1\r\n\r\n`, `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`]); break;
    case 9: r = { method: 'POST', path: '/scores', headers: { pipelined: 3 }, body }; head = Array.from({ length: 3 }, () => `POST /scores HTTP/1.1\r\n${hostLine}Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`).join(''); break;
    case 10: r = { method: 'GET', path: '/scores', headers: { huge: 'header' } }; head = `GET /scores HTTP/1.1\r\n${hostLine}X-Junk: ${'a'.repeat(int(100, 20000))}\r\n\r\n`; break;
    default: r = { method: 'GARBAGE', path: '', headers: {} }; head = Buffer.from(Array.from({ length: int(1, 2000) }, () => int(0, 255))); break;
  }
  return { raw: head, r };
}

// ---- server ----
let proc = null, serverLog = '', base = EXTERNAL, host = '127.0.0.1', port = 0, dir = '';
const rssMB = () => { try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${proc.pid}/status`, 'utf8')); return m ? +(m[1] / 1024).toFixed(1) : null; } catch { return null; } };
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
if (!EXTERNAL) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-fuzz-'));
  port = await freePort();
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'scores.json'), VERIFY: '1', TRUST_PROXY: '1', RATE_MAX: '1000000000', GET_RATE_MAX: '1000000000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => { serverLog += d; });
  proc.stderr.on('data', d => { serverLog += d; });
  proc.on('exit', (code, sig) => { if (running) finding('crash', `server exited code=${code} signal=${sig}`); });
  await new Promise((res, rej) => { proc.stdout.once('data', res); proc.once('error', rej); });
  base = `http://127.0.0.1:${port}`;
} else { const u = new URL(EXTERNAL); host = u.hostname; port = Number(u.port || 80); }
let running = true;
console.log(`fuzz-server: seed=${SEED} seconds=${SECONDS} target=${base}${proc ? ` pid=${proc.pid} RSS=${rssMB()} MB` : ''}`);

// memory and log watch
let rssStart = null, rssMax = 0, logSeen = 0;
const rssSamples = [];
const watch = setInterval(() => {
  if (proc) {
    const m = rssMB();
    if (m !== null) { rssSamples.push(m); if (rssStart === null && rssSamples.length >= 3) rssStart = Math.min(...rssSamples); rssMax = Math.max(rssMax, m); }
  }
  if (serverLog.length > logSeen) {
    const fresh = serverLog.slice(logSeen); logSeen = serverLog.length;
    if (/error|unhandled|rejection|warning|trace/i.test(fresh)) finding('server-log', fresh.trim().slice(0, 500));
  }
}, 2000);

// ---- loop ----
const start = Date.now();
let lastReport = start;
async function worker() {
  while (Date.now() - start < SECONDS * 1000) {
    const r = randomRequest();
    sent++;
    if (r.raw) { const { raw, r: rr } = rawRequest(host, port); await viaSocket(raw, rr, host, port); }
    else await viaHttp(r, base);
    if (Date.now() - lastReport > 30_000) {
      lastReport = Date.now();
      console.log(`... ${sent} sent, ${answered} answered, ${noReply} no reply, ${findings.length} findings, max ${maxMs.toFixed(0)} ms, RSS ${proc ? rssMB() : '?'} MB, status ${JSON.stringify(statusCount)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
running = false;
clearInterval(watch);
// one last check that the server still answers
try {
  const r = await fetch(base + '/scores');
  if (r.status !== 200) finding('final-get', 'GET /scores after the run: ' + r.status);
} catch (e) { finding('final-get', 'GET /scores after the run failed: ' + e); }
if (proc) {
  const grow = rssStart !== null ? rssMax - rssStart : 0;
  if (grow > GROW_MB) finding('memory', `RSS grew ${grow.toFixed(1)} MB (${rssStart} -> ${rssMax} MB)`);
  console.log(`RSS: start ${rssStart} MB, max ${rssMax} MB, end ${rssMB()} MB`);
  proc.kill();
  await new Promise(r => proc.once('exit', r));
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`fuzz-server done: seed=${SEED} ${((Date.now() - start) / 1000).toFixed(0)}s sent=${sent} answered=${answered} noReply=${noReply} validReplays=${valid} findings=${findings.length} maxMs=${maxMs.toFixed(0)} status=${JSON.stringify(statusCount)}`);
console.log('slowest: ' + slowest);
if (serverLog.trim()) console.log('server log:\n' + serverLog.trim().slice(0, 2000));
process.exitCode = findings.length ? 1 : 0;
