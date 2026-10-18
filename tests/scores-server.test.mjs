// Tests for server/scores.mjs. Run: node tests/scores-server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { freePort } from '../tools/lib.mjs';
import { RULES, dailySeedFor, hashString } from '../js/rules.js';
import { createSim, simulate } from '../js/sim.js';
import { addrKey, getCacheSize, isoWeek, topJson } from '../server/scores.mjs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/scores.mjs');
let base, dir;
const procs = [];

// VERIFY is on by default; the tests turn it off unless they ask for it (VERIFY: null leaves it unset: the default)
async function start(extraEnv = {}) {
  const port = await freePort();
  // MIN_RULES 3: the saved browser runs below are rules 3 runs (null: the server's default, rules.js RULES)
  const env = { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, `s${port}.json`), VERIFY: '0', MIN_RULES: '3', ...extraEnv };
  if (env.VERIFY === null) delete env.VERIFY;
  if (env.MIN_RULES === null) delete env.MIN_RULES;
  const p = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(p);
  const line = await new Promise((res, rej) => { p.stdout.once('data', d => res(String(d))); p.once('error', rej); });
  return { port, base: `http://127.0.0.1:${port}`, file: env.DATA_FILE, line, proc: p };
}
const stop = p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); });
// the server's UTC date and the days either side (a POST's day must be one of these three)
const utcDay = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const TODAY = utcDay(0), YESTERDAY = utcDay(-1), TOMORROW = utcDay(1);

const post = (body, raw) => fetch(base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scores-'));
  ({ base } = await start({ RATE_MAX: '1000', SAVE_DELAY_MS: '0' }));   // written at once: the tests read the file
});
test.after(async () => {
  await Promise.all(procs.map(p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); })));   // each flushes on exit
  fs.rmSync(dir, { recursive: true, force: true });
});

test('empty list, CORS, 404, preflight', async () => {
  const r = await fetch(base + '/scores');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await r.json(), { top: [] });
  assert.equal((await fetch(base + '/nope')).status, 404);
  const o = await fetch(base + '/scores', { method: 'OPTIONS' });
  assert.equal(o.status, 204);
  assert.match(o.headers.get('access-control-allow-methods'), /POST/);
});

test('valid scores are ordered; invalid are rejected', async () => {
  for (const [name, score] of [['Ann', 50], ['  Bob 2  ', 90], ['Cy', 70]]) assert.equal((await post({ name, score })).status, 200);
  const bad = [{ name: '', score: 1 }, { name: 'x'.repeat(17), score: 1 }, { name: 'a!b', score: 1 },
    { name: 'Ok', score: -1 }, { name: 'Ok', score: 1.5 }, { name: 'Ok', score: '5' }, { name: 'Ok', score: 5001 }, { name: 5, score: 1 }];
  for (const b of bad) assert.equal((await post(b)).status, 400, JSON.stringify(b));
  assert.equal((await post(null, 'not json')).status, 400);
  assert.equal((await post({ name: 'Big', score: 1, pad: 'x'.repeat(45000) })).status, 400, 'body limit (40 KB)');
  const { top } = await (await fetch(base + '/scores')).json();
  assert.deepEqual(top.map(e => [e.name, e.score]), [['Bob 2', 90], ['Cy', 70], ['Ann', 50]]);
  assert.ok(top[0].at);
  assert.ok(fs.existsSync(path.join(dir, `s${new URL(base).port}.json`)), 'persisted');
});

test('per-day boards: day and mode on POST, filters on GET', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const get = q => fetch(srv.base + '/scores' + q);
  assert.equal((await sp({ name: 'A', score: 10, day: YESTERDAY, mode: 'daily' })).status, 200);
  assert.equal((await sp({ name: 'B', score: 30, day: YESTERDAY, mode: 'classic' })).status, 200);
  assert.equal((await sp({ name: 'C', score: 20, day: TODAY, mode: 'daily' })).status, 200);
  assert.equal((await sp({ name: 'D', score: 5, day: '2026-1-1' })).status, 400);
  assert.equal((await sp({ name: 'D', score: 5, mode: 'x' })).status, 400);
  const d1 = (await (await get('?day=' + YESTERDAY)).json()).top;
  assert.deepEqual(d1.map(e => e.name), ['B', 'A']);
  assert.deepEqual(d1.map(e => [e.day, e.mode]), [[YESTERDAY, 'classic'], [YESTERDAY, 'daily']]);
  const dd = (await (await get(`?day=${YESTERDAY}&mode=daily`)).json()).top;
  assert.deepEqual(dd.map(e => e.name), ['A']);
  assert.equal((await (await get('')).json()).top.length, 3);
  assert.equal((await get('?day=bad')).status, 400);
  assert.equal((await get('?mode=x')).status, 400);
});

test('rate limit: 429 after 10 POSTs per minute', async () => {
  const srv = await start({});
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rl', score: i }) });
    codes.push(r.status);
  }
  assert.deepEqual(codes, [...Array(10).fill(200), 429, 429]);
  assert.equal((await fetch(srv.base + '/scores')).status, 200, 'GET not limited');
});

test('POST_TOKEN: required on POST only, allowed in preflight', async () => {
  const srv = await start({ POST_TOKEN: 'abc', RATE_MAX: '1000' });
  const url = srv.base + '/scores';
  const send = headers => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'Tk', score: 5 }) });
  const none = await send({});
  assert.equal(none.status, 401);
  assert.deepEqual(await none.json(), { error: 'bad token' });
  assert.equal((await send({ 'X-Hop-Token': 'nope' })).status, 401);
  assert.equal((await send({ 'X-Hop-Token': 'abc' })).status, 200);
  assert.equal((await fetch(url)).status, 200, 'GET needs no token');
  const o = await fetch(url, { method: 'OPTIONS' });
  assert.equal(o.status, 204);
  assert.match(o.headers.get('access-control-allow-headers'), /X-Hop-Token/);
});

test('TRUST_PROXY: the limit keys on X-Forwarded-For; without it the socket address', async () => {
  const srv = await start({ RATE_MAX: '2', TRUST_PROXY: '1' });
  const sp = (fwd, b) => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwd }, body: JSON.stringify(b) });
  assert.equal((await sp('10.0.0.1', { name: 'A', score: 1 })).status, 200);
  assert.equal((await sp('10.0.0.1', { name: 'A', score: 2 })).status, 200);
  assert.equal((await sp('10.0.0.1', { name: 'A', score: 3 })).status, 429, 'third post from one client');
  assert.equal((await sp('10.0.0.2', { name: 'B', score: 1 })).status, 200, 'another client has its own budget');
  assert.equal((await sp('2001:db8:1:2:aaaa::1', { name: 'C', score: 1 })).status, 200);
  assert.equal((await sp('2001:db8:1:2:bbbb::9', { name: 'C', score: 2 })).status, 200);
  assert.equal((await sp('2001:db8:1:2:cccc::1', { name: 'C', score: 3 })).status, 429, 'one IPv6 /64 is one client');
  assert.equal((await sp('2001:db8:1:3::1', { name: 'D', score: 1 })).status, 200, 'another /64');
  const plain = await start({ RATE_MAX: '1' });
  const pp = fwd => fetch(plain.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwd }, body: JSON.stringify({ name: 'E', score: 1 }) });
  assert.equal((await pp('10.0.0.1')).status, 200);
  assert.equal((await pp('10.0.0.2')).status, 429, 'without TRUST_PROXY the header is ignored');
});

test('POST_TOKEN of another length is rejected; the file is written after a burst and on exit', async () => {
  const srv = await start({ RATE_MAX: '1000', POST_TOKEN: 'abc', SAVE_DELAY_MS: '60000' });
  const sp = (tok, b) => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hop-Token': tok }, body: JSON.stringify(b) });
  assert.equal((await sp('abcd', { name: 'A', score: 1 })).status, 401);
  assert.equal((await sp('ab', { name: 'A', score: 1 })).status, 401);
  assert.equal((await sp('abc', { name: 'A', score: 7 })).status, 200);
  assert.equal(fs.existsSync(srv.file), false, 'not written yet (debounced)');
  const p = procs[procs.length - 1];
  const gone = new Promise(r => p.once('exit', r));
  p.kill('SIGTERM');
  await gone;
  assert.deepEqual(JSON.parse(fs.readFileSync(srv.file, 'utf8')).entries.map(e => [e.name, e.score]), [['A', 7]], 'flushed on exit');
});

test('one entry per name per bucket: lower post ignored, higher replaces; 5001 rejected', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const names = async q => (await (await fetch(srv.base + '/scores' + q)).json()).top.map(e => [e.name, e.score]);
  assert.equal((await sp({ name: 'Dup', score: 100 })).status, 200);
  assert.equal((await sp({ name: 'Dup', score: 50 })).status, 200);
  assert.deepEqual(await names(''), [['Dup', 100]]);
  assert.equal((await sp({ name: 'Dup', score: 150 })).status, 200);
  assert.deepEqual(await names(''), [['Dup', 150]]);
  assert.equal((await sp({ name: 'Dup', score: 10, mode: 'race' })).status, 200, 'other bucket is separate');
  assert.deepEqual(await names('?mode=race'), [['Dup', 10]]);
  assert.deepEqual(await names(''), [['Dup', 150]], 'a view of several buckets keeps one entry per name, its best');
  assert.equal((await sp({ name: 'Max', score: 5000 })).status, 200);
  assert.equal((await sp({ name: 'Max', score: 5001 })).status, 400);
});

test('old flat scores.json loads; day buckets older than 14 days expire, at load and when the newest day changes', async () => {
  const file = path.join(dir, 'old.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'Old', score: 9, at: 'x' }, { name: 'A', score: 1, day: utcDay(-16) }, { name: 'B', score: 1, day: YESTERDAY }, { name: 'C', score: 5, day: utcDay(-14) },
    { name: 'Junk', score: 3, day: '../../x' }]));
  const srv = await start({ RATE_MAX: '1000', DATA_FILE: file });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const all = async () => (await (await fetch(srv.base + '/scores')).json()).top.map(e => e.name).sort();
  assert.deepEqual(await all(), ['B', 'C', 'Old'], 'the newest day is yesterday: 16 days behind it expired, 13 behind did not; a junk day is dropped');
  assert.equal((await sp({ name: 'D', score: 2, day: TOMORROW })).status, 200);
  assert.deepEqual(await all(), ['B', 'D', 'Old'], 'tomorrow is the newest day now: C is 15 days behind it');
});

test('tests/serve.mjs: bad escape gives 400, traversal is not served', async () => {
  const { serve } = await import('./serve.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const s = await serve(root);
  try {
    assert.equal((await fetch(s.url + '/%E0%A4%A')).status, 400);
    assert.equal((await fetch(s.url + '/package.json')).status, 200);
    assert.ok([403, 404].includes((await fetch(s.url + '/%2e%2e/%2e%2e/etc/passwd')).status));
  } finally { await s.close(); }
});

// two runs the browser played (tests/sim.test.mjs has more): a classic run (score 17) and a daily one (score 44 since the late lane kinds; 79 before)
const CLASSIC_RUN = 'MnwxMjA1NjkwMjUwfGNsYXNzaWN8ZnJvZyxmb3h8MXwxfDY2Mnw1YVUyMWFVMTZhVTM2YVUyNGFVMzNhVTMyYVUyNWFVMTBhVTEyYVUxNWFVMzNhVTM3YVUyOGFVMzBhUjhhVTI5YVUxM2FVOGFVMTNhVTMyYVUzN2FVMzVhVTE5YVUxNWFVMjlhVTE4YVUxMWFVMzJhVTMxYVUyOGFVMjlhVTM0YVU5YVUzM2FV';
const DAILY_RUN = 'Mnw0MjEyNzcyODI0fGRhaWx5fGZyb2csZm94fDF8MHwzNjgzfDVhVTM0YVUyMGFVMjNhTDIwYVIzMWFEMTJhVTE4YUQxOGFVMzRhTDIwYVUxMWFVMzJhTDI5YVUyOGFVMjBhUjIyYVUzM2FMMzRhUjIyYUQzNGFVMThhRDMyYVUxMGFSMjBhRDIwYUQxMGFMMTNhVTE2YUQyMWFVMTlhRDE5YVUyMWFMMjlhVThhTDlhVTMxYVUzM2FVMzRhVTEwYUwxMWFSMTFhTDE1YUwxOWFSMTNhVTEzYVUyNWFVMTRhRDEwYVUyNmFEOWFVMTNhRDMyYVUxM2FMMTZhUjMzYVUyM2FVMjhhVTMwYVUxNWFVMTVhTDM3YUwyMmFSMjdhTDI1YUwyOWFSMTlhVTEyYVUxN2FVMTVhVTEzYVUxMWFVMzJhVTIzYVUyOGFVMjNhVTI4YVUxMWFVMTVhVTM0YVUxNmFMMjBhVTM1YUwxOGFMMTJhUjI3YVIzNGFSMzVhUjMwYVUzNmFVMjFhRDI4YVUxN2FMMjBhRDM1YUwzN2FMMTNhUjE4YUwxNGFEMTVhVTM1YUwyMGFVMzNhVTE2YVUxMGFVMzdhTDE1YUQzNWFSMzZhUjI4YUQyNGFVMThhVTMyYUQyNmFVMzVhVTIwYVUyNWFVMTdhVTlhVTIwYVUxN2FVMzBhVTEzYVUxNmFVMjRhVTE1YVUzM2FVMTJhVTI4YVUzM2FVMjNhVTI3YVUzNWFVMjBhVTIzYVUyMGFVMzFhVTI3YVUyN2FVMTBhVTlhVTEwYVUxMWFVMTVhVTlhVTIyYVUyN2FVMjhhVTE5YVUxMmFVMjVhVTI3YVUyM2FVMzZhVTIxYVUyOWFVMjlhVTlhVThhVTE4YVUyNWFSOGFVMzNhUjM3YUwxMWFSMjBhTDEzYVI4YUwyOGFVMzRhRDE5YVUzMmFVOGFVMzdhVTEyYUQxMmFVMTlhTDhhRDhhTDMwYUQzMWFVMTVhTDIwYVIyN2FEMzZhTDMwYVIyOGFSMTBhUjlhVTIxYVU5YUQxMWFVMzRhRDM2YUwyN2FVMzZhVTMzYUw4YUQyNWFEMzNhTDMyYUwyOGFEMzFhUjhhUjhhVTM3YUwyM2FSMTdhRDI0YVUzMmFVMzBhRDMxYVUxNmFEMjhhVTM0YVIxN2FMMzBhTDMzYVUzMmFVMzFhVTE5YVUyOWFVMTlhVTEwYVUxM2FEMjZhRDE3YVUyOWFMMTNhTDE0YUwyMGFMMjBhVTIwYUQyNmFVMzNhTDEyYUwyOWFMMzVhTDE1YUwyM2FMOWFSMTZhVTMwYVUzM2FVMzZhVTI5YUQyOWFVMjJhRDI4YVIxN2FVMjRhUjMyYUwzNmFEMTBhTDMyYVIzNmFSMjFhTDMwYUwzMGFMMThhTDI4YVIxNGFSMjJhUjEyYUwyMmFVMTJhVTMxYUwzNmFVMjhhTDE2YVIxNWFMMjZhVTE0YVUxMWFVMzBhVTMyYVUxOGFVMzFhVTExYVUxNWFVMTlhVTI3YVUxMmFVMjVhVTEzYVUxOWFVMzZhVTMyYVIzNWFVOGFSMjZhUjE1YVUyM2FSMjZhRDIxYVU4YUwzNGFMMzdhVTI2YVUyOGFEMjJhVThhUjIxYVIxNGFEMzNhVTI2YUwzNmFSMTVhTDE3YUwzNWFVMjhhVTEyYUwzNGFSMTFhUjI3YUwzNGFSMzBhTDM0YUwyNWFMMTlhTDI2YUwyNWFVMTFhVTMyYVIyMGFVMjdhTDIxYUQyOWFVMzVhTDEzYUwyM2FEOWFSMzZhUjIxYVIzMGFVMzRhUjE4YUwzMmFMMjlhVTlhUjMxYUwyMWFSMjJhVTMyYVUyMmFMMTVhUjIyYUwxMmFSMjNhRDE2YVU4YUQzMWFVMzJhVTE0YVU4YVUxOWFVMjRhVThhVTE2YUQ4YVUzM2FVMjhhVTM3YUQxMWFVMjFhRDE2YVUyMWFEMjFhRDE2YVUxOWFEMTVhRDIxYVUyOGFMMzBhRDI3YVUxNWFMMzVhUjhhTDMyYVIzNWFSMjhhTDI0YUQyMGFVMzdhTDM3YUwzNGFSMTZhUjIyYVUxOWFVMjVhTDI3YUQzNWFMMTVhTDE4YUQxOWFVMTdhUjI3YUwxNGFMOWFEMzRhUjE4YUwxNmFE';
const dailyDay = code => { const seed = decodeReplay(code).seed; for (let d = 1; d <= 31; d++) { const day = '2026-10-' + String(d).padStart(2, '0'); if (hashString('hoplanes.day.' + day) === seed) return day; } return null; };
// more browser runs (tests/sim.test.mjs BROWSER_RUNS 2, 7 and 11): one player, no handicap; 7 and 11 share a seed
const RUN38 = 'MnwxOTcxNjQ3MzAwfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDU2NXw1YVUzMWFVMzJhVTExYUQyMWFVMTlhUjEzYVIzMmFVOWFVMTJhUjM1YUQzN2FVMjRhUjIwYVIyN2FMMTFhUjEzYVIzN2FEMTZhVTI1YVIyM2FSMzVhVTIxYVUyMWFEMTVhVTExYVIyMWFEMzdhVTMxYVUxOGFVMjlhVTEwYVUxNGFVMTZhVTI0YVUzMGFEMThhVTIwYVUyM2FEMzVhVTM0YUQyOGFVOWFSMjZhVTEyYVUzM2FVMTFhVTM0YUQxM2FVMjZhRDI5YVUzNWFMMTlhTDIyYVUzNGFSMjZhRDMyYVUzNGFMMzZhVTIzYVUxNGFVMTNhVTE3YVUxN2FVMTdhVTIzYUwzMmFVMjFhVThhVTI5YVU5YVUyN2FVMjJhVTE2YVUxN2FVMTRhVTMyYVUyOGFVMzVhRDE1YUwzNGFEMTVhVTI5YUwzNWFMMjlhTDM0YUwxNWFMMTBhUjM0YUQyMWFVMjJhVTIxYVUyMWFVMTJhVThhVTM1YVUxMWFMMjVhTDE3YVIyOGFSMzNhTDI0YVUxOGFVMjdhUjM1YUwyN2FVMTFhVTIwYVUxNmFSMTNhTDE5YVIzNmFMMjVhVTI3YVUxN2FVMzZhTDEyYUwxNWFSMTdhVTI2YVUzNGFMMjZhTDIyYVIyNmFVMTRhRDE3YVUyNmFVMzRhVTE0YVUxNWFVMTNhRDIwYUQxN2FVOGFMMTRhRDExYVUxOWFEMjVhVTEwYVUzNGFSMzVhUjE0YVUyNWFVMTJhRDlhVTlhRDExYVIyM2FSMjhhRDE0YUQxMWFVMjFhRDIyYVUyNGFEMTZhVTMyYVUxMGFEMzZhVTE4YVUxNWFMMTRhUjE4YVUxM2FSMTBhVTM1YVUyMWFVMjlhRDE1YVUyNmFEMzdhVTMxYUwxMGFVMzJhRDM0YVUzNGFEMzdhVTEwYUQyNmFVMTRhRDMyYVUzMmFEMTVhVTI5YUQxOWFVOGFEMTJhVTI0YUQzMGFVMTFhVTE5YVIyNmFMOGFSMzFhRDMzYUQyNmFVMThhRDIyYVUzNGFEMjFhVTMxYUQxMGFVMjJhRDMwYVUzNGFEMjZhVTE0YUQyNGFVMzJhRDI4YVUxN2FVMzRhVTEyYVUyNGFSMzNhTDIzYVIxMmFSMzNhTDI3YVU4YVUxOWFVMjBhVTMzYUwyMWFSMjBhTDIyYVIyNWFMMTNhUjI2YVUxNWFMMjVhUjMxYVUxMGFSMzRhTDIyYUwyM2FSMTBhUjIwYVUzMGFVMTdhRDEwYVUzNGFMMjdhUjlhTDM1YUQyN2FVMjZhTDEyYUwzNGFMMjJhTDMwYVIyNGFMMjFhTDI5YUwyNGFMMzFhRDEzYVUxNWFEMzFhTDE1YUQzNWFVMTZhTDI5YVUxMGFVMjFhTDIwYUQ4YVUyMWFSOWFSMzFhRDEwYUwzNWFVMTBhRDEyYUwzNGFV';
const SEED78 = 'Mnw3NzQ1NTM4MzR8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NjcwfDVhVTI3YVUyMWFVMjRhUjI0YUQxNmFMMTRhTDhhUjEwYUQzMmFVMTdhRDMyYVUxN2FMMzBhRDI1YVUxMmFMMjdhTDE2YUQyNmFVMTZhUjExYUwyMWFMMjBhUjMxYVIxOGFVMzJhVTEyYUQyN2FVMTBhVTIwYVUyMWFVOWFVMTlhVTEzYVUyOWFVMTdhVTMzYVUxNGFVMjdhVTE5YVUxNGFVMjRhVTIyYVUxN2FVMjhhVTE3YVUxMWFSMjJhUjE3YUQxMWFVMjJhRDEwYVUyMmFEMTdhVTEzYVUyM2FVMzNhRDI3YVUyOWFVMTBhVTI0YVUxMWFVMjlhVTE5YVIxOGFVMjdhVTE0YVUyMGFEMThhVTE3YUQyM2FVMTdhRDE5YVUxNmFMOWFVMzBhVTI0YVUyOWFMMzBhRDMxYVUyMmFMMTJhRDMzYVUxM2FVMjVhVTMxYVUyM2FVMTFhVTMyYVIyMmFSMjZhUjEwYVIyOWFMMjRhTDMwYVUyMWFVMzFhVTE1YVIxM2FSMjZhTDIzYUwzMWFSMjRhVTI2YVUxMWFVMTNhVTI1YVU5YVUxN2FSMjZhTDI4YVUyNmFSMjhhVTE5YUw4YVIyOWFEOGFVMjJhUjMwYUQxN2FVMzNhUjI0YVIxNGFSMThhUjIwYVI5YUwxM2FMMjVhVTI3YUwxNmFSMjVhVThhRDI5YVUxMWFMMTRhVTIzYVUxMmFVMjJhRDEyYVU5YVU4YVUyNGFVMjZhVTIxYUwyNmFVMjVhUjEyYVIxNGFVMTFhVTIzYUQzM2FEMzBhVTE4YVIxNWFSMTRhTDMxYUQzMGFMMzFhVTI5YVUxN2FSMjFhRDI0YVU4YVUyM2FEMjlhVTIzYUwyMmFVMjhhVTI5YVUxM2FSMjBhRDEwYVUyNWFMMjVhVTlhVTEyYVUxNGFVMjBhVTE2YVUyNWFSMjNhUjE4YUwyN2FSOWFSMTlhTDE0YUwxMWFVMThhRDMzYVUxNmFMMTNhRDE4YVUzMGFVMTdhRDIxYVUyN2FMMTVhTDMyYVIzM2FVMTJhVTI1YUQxOWFEMzBhUjMwYUQ5YVUyOGFMMjlhRDI1YVIxMWFMMTFhTDI0YUQyMGFVMTJhRDEzYVUyNWFMMTZhUjlhUjE2YUQzMWFVMjZhTDEzYVIxMWFEMjRhVTMxYUQxOWFSOWFVOWFSMTRhRDE1YUQyOWFEMTBhUjI2YVIxMWFSMTFhTDI5YVUyM2FMMTJhTDIyYUwxMmFSMjNhUjMyYVIyN2FSMjhhUjI0YUw';
const SEED30 = 'Mnw3NzQ1NTM4MzR8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NjcwfDVhVTI3YVUyMWFVMjRhUjI0YUQxNmFMMTRhTDhhUjEwYUQzMmFVMTdhRDMyYVUxN2FMMzBhRDI1YVUxMmFMMjdhTDE2YUQyNmFVMTZhUjExYUwyMWFMMjBhUjMxYVIxOGFVMzJhVTEyYUQyN2FVMTBhVTIwYVUyMWFVOWFVMTlhVTEzYVUyOWFVMTdhVTMzYVUxNGFVMjdhVTE5YVUxNGFVMjRhVTIyYVUxN2FVMjhhVTE3YVUxMWFSMjJhUjE3YUQxMWFVMjJhRDEwYVUyMmFEMTdhVTEzYVUyM2FVMzNhRDI3YVUyOWFVMTBhVTI0YVUxMWFVMjlhVQ';
// A run as the game posted it: rules 3 (the worlds these hops were played on; start() sets MIN_RULES 3), no handicap;
// the score is what it plays to.
function asNow(code, over = {}) {
  const rp = { ...decodeReplay(code), version: 3, handicap: 0, ...over };
  const run = simulate(rp);
  assert.ok(run && run.over, 'the run ends');
  return { code: encodeReplay(rp), score: run.score, run, rp };
}
const CLASSIC = asNow(CLASSIC_RUN), DAILY = asNow(DAILY_RUN, { seed: dailySeedFor(TODAY) }), LONG = asNow(RUN38), HI = asNow(SEED78), LO = asNow(SEED30);
const BENCH = asNow(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bench-replay.txt'), 'utf8').trim());
// The same run with junk around it: hops for the player who never joined, hops after the end, and before every move
// fed while the player is in the air (it waits in the queue) another move at the same tick that it replaces.
function padded(run) {
  const rp = decodeReplay(run.code), sim = createSim(rp), air = new Set();
  while (sim.step()) if (sim.state === 'play' && sim.players[0].hop) air.add(sim.tick);
  const events = [], end = run.run.endTick;
  for (const e of rp.events) { if (air.has(e[0] - 1)) events.push([e[0], 0, -e[2] || 1, 0]); events.push(e); }
  for (let t = 10; t < end; t += 97) events.push([t, 1, 0, 1]);
  events.push([end + 1, 0, 0, 1], [end + 400, 0, 1, 0], [end + 401, 1, 0, 1]);
  events.sort((a, b) => a[0] - b[0]);   // stable: each replaced move stays just before its own
  const code = encodeReplay({ ...rp, events });
  return { code, rp: { ...rp, events }, replaced: events.length - rp.events.length - 3 - Math.ceil((end - 10) / 97) };
}
const json = { 'Content-Type': 'application/json' };
const poster = srv => (b, headers = {}) => fetch(srv.base + '/scores', { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(b) });
const board = async (srv, q = '') => (await (await fetch(srv.base + '/scores' + q)).json()).top;
// a POST through node:http, which sends exactly the headers given (fetch adds a Content-Type of its own)
const rawPost = (srv, headers, body) => new Promise((resolve, reject) => {
  const r = http.request(srv.base + '/scores', { method: 'POST', headers }, res => { let t = ''; res.on('data', d => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: t })); });
  r.on('error', reject); r.end(body);
});

test('VERIFY: a posted score must be what its replay plays to', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const send = body => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const day = TODAY;
  assert.ok(dailyDay(DAILY_RUN), 'the daily run was played on an October day (its hops are moved to today\'s world)');
  assert.equal((await send({ name: 'Ann', score: CLASSIC.score, mode: 'classic', replay: CLASSIC.code })).status, 200, 'the true score');
  assert.equal((await send({ name: 'Dee', score: DAILY.score, mode: 'daily', day, replay: DAILY.code })).status, 200, 'the daily run on its day');
  const reject = async (body, why) => {
    const r = await send(body);
    assert.equal(r.status, 400, why);
    return (await r.json()).error;
  };
  assert.equal(await reject({ name: 'Bob', score: CLASSIC.score + 5, mode: 'classic', replay: CLASSIC.code }, 'a higher score than the run'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: CLASSIC.score - 1, mode: 'classic', replay: CLASSIC.code }, 'a lower score'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: CLASSIC.score, mode: 'classic' }, 'no replay'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: CLASSIC.score, mode: 'race', replay: CLASSIC.code }, 'another mode'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: DAILY.score, mode: 'daily', day: YESTERDAY, replay: DAILY.code }, 'another day'), 'replay mismatch');
  // the same daily hops on a classic seed are not a daily run
  const moved = encodeReplay({ ...DAILY.rp, seed: 42 });
  assert.equal(await reject({ name: 'Bob', score: DAILY.score, mode: 'daily', day, replay: moved }, 'a daily run on another seed'), 'replay mismatch');
  // tampered hops: an extra hop forward changes the run, so the claimed score no longer fits
  const forged = encodeReplay({ ...LONG.rp, events: LONG.rp.events.map(([t, p, dx, dr]) => [t, p, 0, 1]) });
  assert.equal(await reject({ name: 'Bob', score: LONG.score, mode: 'classic', replay: forged }, 'forged hops'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 1, mode: 'classic', replay: 'x'.repeat(33000) }, 'replay too long'), 'invalid name, score, day or mode');
  assert.equal(await reject({ name: 'Bob', score: 1, mode: 'classic', replay: 'no spaces!' }, 'replay not a code'), 'invalid name, score, day or mode');
  const { top } = await (await fetch(srv.base + '/scores')).json();
  assert.deepEqual(top.map(e => [e.name, e.score]).sort(), [['Ann', CLASSIC.score], ['Dee', DAILY.score]].sort());
});

test('without VERIFY a replay is checked for shape, stored and returned', async () => {
  const r = await post({ name: 'Rex', score: 3, mode: 'classic', replay: CLASSIC.code });
  assert.equal(r.status, 200);
  assert.equal((await post({ name: 'Rex', score: 3, replay: 7 })).status, 400);
  assert.equal((await post({ name: 'Pat', score: 2 })).status, 200);
  const { top } = await (await fetch(base + '/scores')).json();
  assert.equal(top.find(e => e.name === 'Rex').replay, CLASSIC.code);
  assert.equal(top.find(e => e.name === 'Pat').replay, null);
  assert.ok(top.every(e => e.replay === null || typeof e.replay === 'string'));
});

test('every reply says it is not a page: nosniff and a CSP that allows nothing', async () => {
  for (const r of [await fetch(base + '/scores'), await fetch(base + '/nope'), await fetch(base + '/scores', { method: 'OPTIONS' })]) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
  }
});

test('VERIFY is on by default: a score without its replay, or with a replay it does not play to, is refused', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: null });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await sp({ name: 'Eve', score: 4000 })).status, 400, 'a bare claim');
  assert.equal((await sp({ name: 'Eve', score: CLASSIC.score + 1, mode: 'classic', replay: CLASSIC.code })).status, 400, 'more than the run reached');
  assert.equal((await sp({ name: 'Ann', score: CLASSIC.score, mode: 'classic', replay: CLASSIC.code })).status, 200, 'the run as it played');
  assert.deepEqual((await (await fetch(srv.base + '/scores')).json()).top.map(e => [e.name, e.score]), [['Ann', CLASSIC.score]]);
});

test('VERIFY: the verified replay is stored and returned: the hops the run applied, playing to the same end', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const r = await poster(srv)({ name: 'Ann', score: LONG.score, mode: 'classic', replay: LONG.code });
  assert.equal(r.status, 200);
  const stored = (await board(srv))[0].replay;
  assert.ok(stored.length <= LONG.code.length, 'never longer than the posted code');
  const again = simulate(decodeReplay(stored));
  assert.deepEqual([again.score, again.endTick, again.cause, again.players], [LONG.run.score, LONG.run.endTick, LONG.run.cause, LONG.run.players]);
});

test('without VERIFY a junk replay is stored as null; the POST reply carries no replays', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const a = await sp({ name: 'Rex', score: 3, mode: 'classic', replay: CLASSIC.code });
  const reply = (await a.json()).top;
  assert.ok(reply.length && reply.every(e => !('replay' in e) || e.replay == null), 'POST reply has no replay strings');
  assert.equal((await sp({ name: 'Junk', score: 2, mode: 'classic', replay: 'abcdefgh' })).status, 200);
  const { top } = await (await fetch(srv.base + '/scores')).json();
  assert.equal(top.find(e => e.name === 'Rex').replay, CLASSIC.code, 'GET keeps it');
  assert.equal(top.find(e => e.name === 'Junk').replay, null, 'junk stored as null');
});

test('an entry pushed past rank 10 loses its replay', async () => {
  const srv = await start({ RATE_MAX: '1000', SAVE_DELAY_MS: '0' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await sp({ name: 'Low', score: 1, mode: 'classic', replay: CLASSIC.code });
  for (let i = 0; i < 10; i++) await sp({ name: 'P' + i, score: 10 + i, mode: 'classic' });
  const stored = JSON.parse(fs.readFileSync(srv.file, 'utf8')).entries;
  assert.equal(stored.find(e => e.name === 'Low').replay, null, 'rank 11 has no replay');
});

test('VERIFY: a daily run is accepted on its day\'s seed (dailySeedFor) and rejected on another day\'s', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const send = body => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const day = YESTERDAY, other = TODAY;   // a POST's day is the server's date or a day either side
  const rp = { ...DAILY.rp, seed: dailySeedFor(day) };   // the recorded hops on another day's world: some run, whatever it scores
  const run = simulate(rp);
  assert.ok(run && run.over, 'the moved run ends');
  const code = encodeReplay(rp);
  assert.equal((await send({ name: 'Day', score: run.score, mode: 'daily', day, replay: code })).status, 200, 'on its day');
  const wrong = await send({ name: 'Off', score: run.score, mode: 'daily', day: other, replay: code });
  assert.equal(wrong.status, 400, 'the same run claimed for another day');
  assert.equal((await wrong.json()).error, 'replay mismatch');
  const otherRun = simulate({ ...rp, seed: dailySeedFor(other) });
  const otherCode = encodeReplay({ ...rp, seed: dailySeedFor(other) });
  assert.equal((await send({ name: 'Off', score: otherRun.score, mode: 'daily', day, replay: otherCode })).status, 400, 'another day\'s seed for this day');
  assert.equal((await send({ name: 'Off', score: otherRun.score, mode: 'daily', day: other, replay: otherCode })).status, 200, 'that seed on its own day');
  const { top } = await (await fetch(srv.base + '/scores?mode=daily')).json();
  assert.deepEqual(top.map(e => [e.name, e.day]).sort(), [['Day', day], ['Off', other]]);
});

test('VERIFY budget: past the simulation time allowed per minute a POST gets 503 with Retry-After', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1', VERIFY_BUDGET_MS: '0' });   // 0: one replay per minute, then busy
  const send = body => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ name: 'Ann', score: CLASSIC.score, mode: 'classic', replay: CLASSIC.code })).status, 200, 'the first replay is simulated');
  const busy = await send({ name: 'Bob', score: CLASSIC.score, mode: 'classic', replay: CLASSIC.code });
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), { error: 'busy' });
  const retry = Number(busy.headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 60, 'Retry-After in seconds: ' + retry);
  assert.equal((await send({ name: 'Bad', score: 1, mode: 'classic', replay: 'no spaces!' })).status, 400, 'validation still comes first');
  assert.equal((await fetch(srv.base + '/scores')).status, 200, 'GET is not budgeted');
  const { top } = await (await fetch(srv.base + '/scores')).json();
  assert.deepEqual(top.map(e => e.name), ['Ann']);
});

test('GET cache: a POST invalidates it, so no GET returns stale data', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const names = async q => (await (await fetch(srv.base + '/scores' + q)).json()).top.map(e => [e.name, e.score]);
  assert.deepEqual(await names(''), []);
  assert.deepEqual(await names('?mode=race'), []);
  assert.equal((await sp({ name: 'A', score: 10, mode: 'race', day: TODAY })).status, 200);
  assert.deepEqual(await names(''), [['A', 10]]);
  assert.deepEqual(await names('?mode=race'), [['A', 10]]);
  assert.deepEqual(await names('?mode=race'), [['A', 10]], 'served from the cache');
  assert.equal((await sp({ name: 'B', score: 20, mode: 'race', day: TODAY })).status, 200);
  assert.deepEqual(await names('?mode=race'), [['B', 20], ['A', 10]], 'the cache was dropped');
  assert.deepEqual(await names('?week=' + isoWeek(TODAY)), [['B', 20], ['A', 10]]);
  assert.equal((await sp({ name: 'A', score: 30, mode: 'race', day: TODAY })).status, 200, 'a higher score replaces');
  assert.deepEqual(await names('?week=' + isoWeek(TODAY)), [['A', 30], ['B', 20]]);
  assert.deepEqual(await names(`?day=${TODAY}&mode=race`), [['A', 30], ['B', 20]]);
  assert.deepEqual(await names('?day=' + YESTERDAY), []);
  assert.equal((await sp({ name: 'A', score: 5, mode: 'race', day: TODAY })).status, 200, 'a lower score is ignored');
  assert.deepEqual(await names(''), [['A', 30], ['B', 20]]);
});

test('GET is rate limited too, with its own higher cap', async () => {
  const srv = await start({ RATE_MAX: '1', GET_RATE_MAX: '3' });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(srv.base + '/scores')).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal((await fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'G', score: 1 }) })).status, 200, 'POST has its own budget');
});

test('TRUST_PROXY: an X-Forwarded-For that is not an IP falls back to the socket address', async () => {
  const srv = await start({ RATE_MAX: '1', TRUST_PROXY: '1' });
  const sp = (fwd, b) => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwd }, body: JSON.stringify(b) });
  assert.equal((await sp('not an ip', { name: 'A', score: 1 })).status, 200);
  assert.equal((await sp('another junk value', { name: 'B', score: 1 })).status, 429, 'both key on the socket');
  assert.equal((await sp('1.2.3.4, <script>', { name: 'C', score: 1 })).status, 429, 'the last hop is junk: the socket again');
  assert.equal((await sp('10.0.0.9', { name: 'D', score: 1 })).status, 200, 'a real address is its own client');
  assert.equal((await sp('2001:db8::1', { name: 'E', score: 1 })).status, 200, 'IPv6 too');
});

test('isoWeek: edges', () => {
  assert.equal(isoWeek('2027-01-01'), '2026-W53');
  assert.equal(isoWeek('2024-12-30'), '2025-W01');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(isoWeek('2026-10-12'), '2026-W42');
  assert.equal(isoWeek('2026-10-18'), '2026-W42');
  assert.equal(isoWeek('2026-10-19'), '2026-W43');
  assert.equal(isoWeek('2021-01-03'), '2020-W53');
  assert.equal(isoWeek('2024-02-29'), '2024-W09');
  assert.equal(isoWeek('2026-02-30'), null);
  assert.equal(isoWeek('2026-1-1'), null);
  assert.equal(isoWeek(null), null);
});

test('weekly board: ?week= covers Monday to Sunday, any mode', async () => {
  // 2026-10-05 is a Monday, 2026-10-11 the Sunday after, 2026-10-12 the next Monday, 2026-10-04 the Sunday before
  // (past days: a POST may only carry today's date, so the board is a stored file; none of its days is 14 behind the newest)
  const file = path.join(dir, 'week.json');
  fs.writeFileSync(file, JSON.stringify([
    { name: 'Mon', score: 10, day: '2026-10-05', mode: 'daily' },
    { name: 'Sun', score: 20, day: '2026-10-11', mode: 'classic' },
    { name: 'Next', score: 99, day: '2026-10-12', mode: 'daily' },
    { name: 'Prev', score: 98, day: '2026-10-04', mode: 'daily' },
    { name: 'NoDay', score: 97 },
  ]));
  const srv = await start({ RATE_MAX: '1000', DATA_FILE: file });
  const get = q => fetch(srv.base + '/scores' + q);
  const names = async q => (await (await get(q)).json()).top.map(e => e.name);
  assert.deepEqual(await names('?week=2026-W41'), ['Sun', 'Mon']);
  assert.deepEqual(await names('?week=2026-W41&mode=daily'), ['Mon']);
  assert.deepEqual(await names('?week=2026-W42'), ['Next']);
  assert.deepEqual(await names('?week=2026-W10'), []);
  for (const q of ['?week=2026-42', '?week=bad', '?week=2026-W00', '?week=2026-W54', '?week=2026-W4', '?week=', '?week=2026-W41&day=2026-10-05', '?week=2026-W41&mode=x'])
    assert.equal((await get(q)).status, 400, q);
});

// the HTTP fuzzer (tools/fuzz-server.mjs) found these two
test('a request target the URL parser rejects is 400, not 500; the server goes on', async () => {
  const raw = head => new Promise(resolve => {
    const s = net.connect(new URL(base).port, '127.0.0.1');
    let data = '';
    s.on('connect', () => s.write(head)); s.on('data', d => { data += d; }); s.on('close', () => resolve(data)); s.on('error', () => resolve(data));
    s.setTimeout(3000, () => s.destroy());
  });
  for (const target of ['http://[::1/scores', 'http://x:99999/scores', 'http://user@/scores']) {
    const reply = await raw(`GET ${target} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(reply, /^HTTP\/1\.1 400 /, target);
    assert.ok(reply.includes('{"error":"bad url"}'), target + ': ' + reply.slice(-60));   // chunked: the body ends with 0\r\n\r\n
  }
  assert.equal((await raw('GET http://x/scores HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).split('\r\n')[0], 'HTTP/1.1 200 OK', 'a valid absolute-form target still works');
  assert.equal((await fetch(base + '/scores')).status, 200);
});

test('GET cache: bounded, whatever days and weeks the queries ask for', () => {
  const day = i => `${1000 + (i % 9000)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
  assert.equal(topJson(day(0), 'classic', null), '{"top":[]}');
  for (let i = 1; i < 5000; i++) topJson(day(i), MODES_ALL[i % 6], null);
  for (let i = 0; i < 500; i++) topJson(null, null, `${1000 + i}-W${String(1 + (i % 52)).padStart(2, '0')}`);
  assert.ok(getCacheSize() > 0 && getCacheSize() <= 64, 'cache entries after 5500 distinct queries: ' + getCacheSize());
  assert.equal(topJson(day(0), 'classic', null), '{"top":[]}', 'an evicted query is answered again');
});
const MODES_ALL = ['classic', 'race', 'coinwar', 'tag', 'daily', 'room'];

// ---- finding 1: replay theft and board flooding --------------------------------------------------------------
// the hops the rules apply for a code, as the server fingerprints them: a relabel that keeps them is the same run
const appliedHops = code => { const hops = []; simulate(decodeReplay(code), { onHop: (...h) => hops.push(h) }); return JSON.stringify(hops); };
test('fingerprint: the same run again is 409, under another name, on another day, padded, relabelled or with another coat', async () => {
  const sameHops = code => appliedHops(code) === appliedHops(LONG.code);
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const sp = poster(srv);
  assert.equal((await sp({ name: 'Ann', score: LONG.score, mode: 'classic', day: TODAY, replay: LONG.code })).status, 200);
  const pad = padded(LONG);
  assert.ok(pad.replaced > 0, 'the run has moves made in the air: ' + pad.replaced);
  const same = simulate(decodeReplay(pad.code));
  assert.deepEqual([same.score, same.endTick, same.cause], [LONG.score, LONG.run.endTick, LONG.run.cause], 'the padding changes nothing in the run');
  const copies = [
    [{ day: TODAY, replay: LONG.code }, 'the same code under another name'],
    [{ day: YESTERDAY, replay: LONG.code }, 'on another day'],
    [{ replay: LONG.code }, 'without a day'],
    [{ day: TODAY, replay: pad.code }, 'padded: hops for the absent player, after the end, replaced in the queue'],
    [{ day: TODAY, replay: encodeReplay({ ...LONG.rp, chars: ['frog', 'cat'] }) }, 'another animal for the player who never joined'],
    [{ day: TODAY, replay: encodeReplay({ ...LONG.rp, chars: ['fox', 'fox'] }) }, 'the fox: its trait pays coins only, the run is the same'],
    // a stolen one-player code relabelled: every mode plays the same alone, a trait that never fired changed nothing
    ...['race', 'coinwar', 'tag', 'room'].map(mode => [{ day: TODAY, mode, replay: encodeReplay({ ...LONG.rp, mode }) }, 'the same run posted as ' + mode]),
    ...['robot', 'cat', 'penguin', 'turtle'].map(k => [{ day: TODAY, mode: 'room', replay: encodeReplay({ ...LONG.rp, mode: 'room', chars: [k, 'fox'] }) }, 'the same run as the ' + k + ' on the room board']),
  ].filter(([b]) => sameHops(b.replay));
  for (const [b, why] of copies) {
    const r = await sp({ name: 'Thief', score: LONG.score, mode: 'classic', ...b });
    assert.equal(r.status, 409, why);
    assert.deepEqual(await r.json(), { error: 'this run is already on the boards' });
  }
  // a trait that fires makes another run by the rules' own records (the cat lives through LONG's splash): its hops differ, so it is not a copy
  const cat = encodeReplay({ ...LONG.rp, mode: 'room', chars: ['cat', 'fox'] });
  assert.equal(sameHops(cat), LONG.run.cause !== 'splash', 'the cat changes a run that ended in the water, and only that');
  assert.equal((await sp({ name: 'Bo', score: HI.score, mode: 'classic', day: TODAY, replay: HI.code })).status, 200, 'another run is welcome');
  assert.deepEqual((await board(srv)).map(e => e.name).sort(), ['Ann', 'Bo']);
});

test('fingerprint: a run that left the board stays refused, also after a restart', async () => {
  const file = path.join(dir, 'fp.json');
  let srv = await start({ RATE_MAX: '1000', VERIFY: '1', DATA_FILE: file, SAVE_DELAY_MS: '0' });
  assert.equal((await poster(srv)({ name: 'Cy', score: LO.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LO.rp, mode: 'room' }) })).status, 200);
  const hiRoom = encodeReplay({ ...HI.rp, mode: 'room' });
  assert.equal((await poster(srv)({ name: 'Cy', score: HI.score, mode: 'room', day: TODAY, replay: hiRoom })).status, 200, 'a higher run replaces the name\'s entry');
  await stop(srv.proc);
  srv = await start({ RATE_MAX: '1000', VERIFY: '1', DATA_FILE: file });
  assert.equal((await poster(srv)({ name: 'Dan', score: HI.score, mode: 'room', day: TODAY, replay: hiRoom })).status, 409, 'kept on disk');
  assert.equal((await poster(srv)({ name: 'Dan', score: LO.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LO.rp, mode: 'room' }) })).status, 409, 'the replaced run too');
});

test('a POST day is the server\'s UTC date or a day either side', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = poster(srv);
  for (const day of [YESTERDAY, TODAY, TOMORROW]) assert.equal((await sp({ name: 'Ok', score: 1, day, mode: 'daily' })).status, 200, day);
  for (const day of [utcDay(-2), utcDay(2), '2026-01-01', '2999-01-01']) {
    const r = await sp({ name: 'Old', score: 1, day, mode: 'classic' });
    assert.equal(r.status, 400, day);
    assert.match((await r.json()).error, /^day out of range/);
  }
});

test('the week view and the other views of several buckets keep one entry per name, its best', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = poster(srv);
  const [d1, d2] = [YESTERDAY, TODAY, TOMORROW].filter((d, i, all) => all.some((o, j) => j !== i && isoWeek(o) === isoWeek(d)));   // two days of one week
  for (const b of [{ name: 'Wk', score: 5, day: d1 }, { name: 'Wk', score: 9, day: d2 }, { name: 'Ot', score: 7, day: d1 }, { name: 'Wk', score: 8, day: d1, mode: 'daily' }])
    assert.equal((await sp(b)).status, 200);
  const names = async q => (await board(srv, q)).map(e => [e.name, e.score]);
  assert.deepEqual(await names('?week=' + isoWeek(d1)), [['Wk', 9], ['Ot', 7]]);
  assert.deepEqual(await names(''), [['Wk', 9], ['Ot', 7]]);
  assert.deepEqual(await names('?day=' + d1), [['Wk', 8], ['Ot', 7]], 'a day of all modes too');
  assert.deepEqual(await names(`?day=${d1}&mode=classic`), [['Ot', 7], ['Wk', 5]], 'one bucket: its own entries');
});

// ---- finding 2: the rules version -----------------------------------------------------------------------------
test('MIN_RULES: a replay played with older rules is refused (400), unless the server allows it', async () => {
  for (const version of [2, 3]) {
    const old = { ...decodeReplay(CLASSIC_RUN), version, handicap: 0 }, score = simulate(old).score, code = encodeReplay(old);
    for (const VERIFY of ['1', '0']) {
      const srv = await start({ RATE_MAX: '1000', VERIFY, MIN_RULES: null });   // the default: rules.js RULES
      const r = await poster(srv)({ name: 'Old', score, mode: 'classic', replay: code });
      assert.equal(r.status, 400, 'VERIFY=' + VERIFY);
      assert.equal((await r.json()).error, `old rules: replay version ${version}, this server takes ${RULES} or newer`);
    }
    const two = await start({ RATE_MAX: '1000', VERIFY: '1', MIN_RULES: '2' });
    assert.equal((await poster(two)({ name: 'Old', score, mode: 'classic', replay: code })).status, 200, 'MIN_RULES=2: rules ' + version);
  }
  // a run of today's rules is taken by default (the same hops on a rules 4 world: another run, checked as one)
  const now = { ...decodeReplay(CLASSIC_RUN), version: RULES, handicap: 0 }, srv = await start({ RATE_MAX: '1000', VERIFY: '1', MIN_RULES: null });
  assert.equal((await poster(srv)({ name: 'New', score: simulate(now).score, mode: 'classic', replay: encodeReplay(now) })).status, 200, 'rules ' + RULES);
});

// ---- finding 3: cross-site posts ------------------------------------------------------------------------------
test('POST must be application/json (415); with ALLOW_ORIGIN set, another Origin is 403', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const body = JSON.stringify({ name: 'Ct', score: 1 });
  for (const type of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'application/json-patch+json']) {
    const r = await rawPost(srv, { 'Content-Type': type }, body);
    assert.equal(r.status, 415, type);
    assert.deepEqual(JSON.parse(r.body), { error: 'content type must be application/json' });
  }
  assert.equal((await rawPost(srv, {}, body)).status, 415, 'no content type');
  for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8'])
    assert.equal((await rawPost(srv, { 'Content-Type': type }, body)).status, 200, type);
  assert.equal((await rawPost(srv, { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body)).status, 200, 'ALLOW_ORIGIN * takes any origin');
  const site = 'https://wonbyte.github.io';
  const locked = await start({ RATE_MAX: '1000', ALLOW_ORIGIN: site });
  const evil = await rawPost(locked, { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body);
  assert.equal(evil.status, 403);
  assert.deepEqual(JSON.parse(evil.body), { error: 'origin not allowed' });
  assert.equal((await rawPost(locked, { 'Content-Type': 'application/json', Origin: 'null' }, body)).status, 403, 'a sandboxed page');
  const ok = await rawPost(locked, { 'Content-Type': 'application/json', Origin: site }, body);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], site);
  assert.equal((await rawPost(locked, { 'Content-Type': 'application/json' }, body)).status, 200, 'no Origin: not a browser');
});

// ---- finding 4: the handicap shield ---------------------------------------------------------------------------
test('a run with the handicap shield is not ranked (400), VERIFY or not', async () => {
  for (const VERIFY of ['1', '0']) {
    const srv = await start({ RATE_MAX: '1000', VERIFY });
    for (const handicap of [1, 2]) {
      const rp = { ...LONG.rp, handicap }, r = await poster(srv)({ name: 'Hc', score: simulate(rp).score, mode: 'classic', replay: encodeReplay(rp) });
      assert.equal(r.status, 400, `VERIFY=${VERIFY} handicap ${handicap}`);
      assert.equal((await r.json()).error, 'handicap runs are not ranked');
    }
    const fake = await poster(srv)({ name: 'Hc', score: LONG.score, mode: 'classic', replay: encodeReplay({ ...LONG.rp, chars: ['dragon', 'fox'] }) });
    assert.equal(fake.status, 400, 'an animal the game does not have');
    assert.equal((await fake.json()).error, 'unknown animal');
  }
});

// ---- finding 5: padded replays ---------------------------------------------------------------------------------
test('a padded replay is stored as only the hops the run applied, and plays the same', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const pad = padded(LONG);
  assert.equal((await poster(srv)({ name: 'Pad', score: LONG.score, mode: 'classic', day: TODAY, replay: pad.code })).status, 200);
  const stored = (await board(srv))[0].replay, rp = decodeReplay(stored);
  assert.ok(stored.length < pad.code.length * 0.8, `stored ${stored.length} chars of the ${pad.code.length} posted`);
  assert.ok(rp.events.every(([t, p]) => p === 0 && t <= LONG.run.endTick), 'no hop for the absent player or after the end');
  assert.ok(rp.events.length < LONG.rp.events.length, 'and no move that never started a hop');
  const a = simulate(rp), b = simulate(decodeReplay(pad.code));
  assert.deepEqual(a, b, 'the stored code plays exactly as the posted one');
});

// ---- finding 6: the client keys -------------------------------------------------------------------------------
test('addrKey: IPv6 expanded to 8 groups before the /64 (or /56); IPv4-mapped is IPv4', () => {
  assert.equal(addrKey('2001::7:1:2:3:4'), '2001:0:0:7::/64');
  assert.equal(addrKey('2001::8:1:2:3:4'), '2001:0:0:8::/64');
  assert.equal(addrKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(addrKey('2001:DB8:0001:0002::'), '2001:db8:1:2::/64');
  assert.equal(addrKey('::1'), '0:0:0:0::/64');
  assert.equal(addrKey('::'), '0:0:0:0::/64');
  assert.equal(addrKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(addrKey('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(addrKey('::ffff:a01:203'), '10.1.2.3');
  assert.equal(addrKey('64:ff9b::1.2.3.4'), '64:ff9b:0:0::/64');
  assert.equal(addrKey('10.1.2.3'), '10.1.2.3');
  assert.equal(addrKey('2001:db8:1:2ff::1', 56), '2001:db8:1:200::/56');
  assert.equal(addrKey('2001:db8:1:200::1', 56), '2001:db8:1:200::/56');
  assert.equal(addrKey('2001:db8:1:300::1', 56), '2001:db8:1:300::/56');
});

test('TRUST_PROXY: an IPv6 /64 with :: early is its own client; ::ffff:a.b.c.d is the IPv4 client', async () => {
  const srv = await start({ RATE_MAX: '1', TRUST_PROXY: '1' });
  const sp = (fwd, b) => poster(srv)(b, { 'X-Forwarded-For': fwd });
  assert.equal((await sp('2001::7:1:2:3:4', { name: 'A', score: 1 })).status, 200);
  assert.equal((await sp('2001::8:1:2:3:4', { name: 'B', score: 1 })).status, 200, 'another /64 (both keyed 2001:0:0:0 before)');
  assert.equal((await sp('2001:0:0:7:ffff::9', { name: 'C', score: 1 })).status, 429, 'the first /64 again');
  assert.equal((await sp('::ffff:10.9.9.9', { name: 'D', score: 1 })).status, 200);
  const r = await sp('10.9.9.9', { name: 'E', score: 1 });
  assert.equal(r.status, 429, 'the same IPv4 client');
  assert.equal(r.headers.get('retry-after'), '60');
});

test('VERIFY_CLIENT_MS: one client (an IPv6 /56) has its own share of the replay time (429 past it)', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1', TRUST_PROXY: '1', VERIFY_CLIENT_MS: '0' });
  const sp = (fwd, run, name) => poster(srv)({ name, score: run.score, mode: 'classic', replay: run.code }, { 'X-Forwarded-For': fwd });
  assert.equal((await sp('2001:db8:1:100::1', LONG, 'A')).status, 200, 'the first replay of the client');
  const r = await sp('2001:db8:1:1ff::1', HI, 'B');
  assert.equal(r.status, 429, 'another /64 of the same /56');
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  assert.equal((await sp('2001:db8:1:200::1', HI, 'C')).status, 200, 'the next /56');
});

// ---- finding 7: memorized worlds ------------------------------------------------------------------------------
test('classic, race, coin war and tag keep one entry per seed per board; daily and room do not', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const sp = (name, run, mode) => poster(srv)({ name, score: simulate({ ...run.rp, mode }).score, mode, day: TODAY, replay: encodeReplay({ ...run.rp, mode }) });
  assert.ok(HI.score > LO.score && HI.rp.seed === LO.rp.seed, 'two runs on one world');
  assert.equal((await sp('Lo', LO, 'classic')).status, 200);
  assert.equal((await sp('Hi', HI, 'classic')).status, 200);
  const names = async q => (await board(srv, q)).map(e => e.name);
  assert.deepEqual(await names(`?day=${TODAY}&mode=classic`), ['Hi'], 'the better run of the world holds its one place');
  assert.equal((await sp('Lo2', LO, 'classic')).status, 409, 'the dropped run stays refused under another name');
  assert.equal((await sp('Rc', HI, 'race')).status, 409, 'the same run on another board is a copy: one run, one place');
  // other runs on the same world: the HI run cut short (it ends in traffic there), two per board
  const cut = n => asNow(HI.code, { events: HI.rp.events.slice(0, n) });
  const [r40, r80, r120, r160] = [40, 80, 120, 160].map(cut);
  assert.ok(r40.score < r80.score && r80.score < r120.score && r120.score < r160.score && r160.score < HI.score, 'four other runs on one world, each a different score');
  assert.equal((await sp('Rc', r40, 'race')).status, 200, 'race is another board');
  assert.equal((await sp('Rc2', r80, 'race')).status, 200);
  assert.deepEqual(await names(`?day=${TODAY}&mode=race`), ['Rc2'], 'one place per world on the race board too');
  assert.equal((await sp('R1', r120, 'room')).status, 200);
  assert.equal((await sp('R2', r160, 'room')).status, 200);
  assert.deepEqual(await names(`?day=${TODAY}&mode=room`), ['R2', 'R1'], 'a room world is shared on purpose: every run counts');
  assert.deepEqual(await names('?day=' + TODAY), ['Hi', 'R2', 'R1'], 'a view of several boards: the world still holds one place among classic, race, coin war and tag (Rc2 is the same seed as Hi)');
  assert.deepEqual(await names(''), ['Hi', 'R2', 'R1']);
});

// ---- finding 8: a cold replay check -----------------------------------------------------------------------------
test('warm-up before listening; a replay check that runs out of VERIFY_MS is 503 with Retry-After, not a mismatch', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  assert.match(srv.line, /warm-up \d+ ms/, 'the start line: ' + srv.line);
  assert.equal((await poster(srv)({ name: 'Bn', score: BENCH.score, mode: 'classic', replay: BENCH.code })).status, 200, 'the 62 s bench run, right after start');
  const slow = await start({ RATE_MAX: '1000', VERIFY: '1', VERIFY_MS: '1' });
  const r = await poster(slow)({ name: 'Bn', score: BENCH.score, mode: 'classic', replay: BENCH.code });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'busy: the replay check ran out of time' });
  assert.equal(r.headers.get('retry-after'), '30');
  const plain = await start({ RATE_MAX: '1000' });
  assert.doesNotMatch(plain.line, /warm-up/, 'no warm-up without VERIFY');
});

// ---- finding 9: the store ---------------------------------------------------------------------------------------
test('store: an old flat file is split into one file per day; a POST rewrites only its day; a restart reads it back', async () => {
  const file = path.join(dir, 'split.json'), daysDir = path.join(dir, 'split.days');
  fs.writeFileSync(file, JSON.stringify([{ name: 'Old', score: 9, at: 'x' }, { name: 'Yd', score: 3, day: YESTERDAY, mode: 'classic' }, { name: 'Td', score: 4, day: TODAY, mode: 'daily' }]));
  let srv = await start({ RATE_MAX: '1000', DATA_FILE: file, SAVE_DELAY_MS: '0' });
  const main = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(main.format, 2, 'DATA_FILE is the new format at once');
  assert.deepEqual(main.entries.map(e => e.name), ['Old'], 'it holds the entries without a day');
  assert.deepEqual(fs.readdirSync(daysDir).sort(), [TODAY + '.json', YESTERDAY + '.json'].sort());
  const yFile = path.join(daysDir, YESTERDAY + '.json'), yText = fs.readFileSync(yFile, 'utf8'), yTime = fs.statSync(yFile).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  assert.equal((await poster(srv)({ name: 'New', score: 5, day: TODAY })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(daysDir, TODAY + '.json'), 'utf8')).entries.map(e => e.name).sort(), ['New', 'Td']);
  assert.equal(fs.statSync(yFile).mtimeMs, yTime, 'yesterday\'s file is not rewritten');
  assert.equal(fs.readFileSync(yFile, 'utf8'), yText);
  const before = (await board(srv)).map(e => [e.name, e.score, e.day, e.mode]);
  await stop(srv.proc);
  srv = await start({ RATE_MAX: '1000', DATA_FILE: file });
  assert.deepEqual((await board(srv)).map(e => [e.name, e.score, e.day, e.mode]), before, 'the same board after a restart');
  assert.deepEqual(before.map(e => e[0]), ['Old', 'New', 'Td', 'Yd']);
  assert.ok(!fs.readdirSync(daysDir).some(f => f.endsWith('.tmp')), 'no temp file left');
});

test('store: a full bucket costs one insert, and the lowest entry goes', async () => {
  const file = path.join(dir, 'full.json');
  fs.writeFileSync(file, JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ name: 'F' + i, score: 1000 - i, day: TODAY, mode: 'classic' }))));
  const srv = await start({ RATE_MAX: '1000', DATA_FILE: file, SAVE_DELAY_MS: '0' });
  const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'full.days', TODAY + '.json'), 'utf8')).entries;
  assert.equal((await poster(srv)({ name: 'Low', score: 700, day: TODAY })).status, 200, 'lower than the whole full bucket: ignored');
  assert.ok(!stored().some(e => e.name === 'Low'));
  assert.equal((await poster(srv)({ name: 'Mid', score: 900, day: TODAY })).status, 200);
  const list = stored();
  assert.equal(list.length, 200);
  assert.ok(list.some(e => e.name === 'Mid') && !list.some(e => e.name === 'F199'), 'the lowest went');
  assert.ok(list.slice(10).every(e => e.replay === null) && list.every((e, i) => i === 0 || list[i - 1].score >= e.score), 'sorted; no replay past rank 10');
});

// ---- the fingerprint memory: SEEN_DAYS (60) behind the newest day a run is forgotten; a day remembers GONE_MAX (5000) dropped runs ----
import crypto from 'node:crypto';
// the server's fingerprint of a code (scores.mjs fingerprint): what decides the run, and the hops the rules applied
function fpOf(code) {
  const rp = decodeReplay(code), hops = [];
  simulate(rp, { onHop: (...h) => hops.push(h) });
  return crypto.createHash('sha256').update(JSON.stringify([rp.seed, rp.startTick, rp.joined, rp.handicap, hops])).digest('base64url').slice(0, 22);
}
const dayFile = (daysDir, day, gone) => fs.writeFileSync(path.join(daysDir, day + '.json'), JSON.stringify({ format: 2, day, entries: [], gone }));
test('fingerprint memory: a run dropped 30 days ago is still refused, one dropped 61 days ago is not', async () => {
  const file = path.join(dir, 'seen.json'), daysDir = file.replace(/\.json$/, '.days');
  fs.mkdirSync(daysDir, { recursive: true });
  dayFile(daysDir, utcDay(-61), [fpOf(LO.code)]);
  dayFile(daysDir, utcDay(-30), [fpOf(LONG.code)]);
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1', DATA_FILE: file });
  const sp = poster(srv);
  assert.equal((await sp({ name: 'Ann', score: HI.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...HI.rp, mode: 'room' }) })).status, 200, 'today becomes the newest day');
  assert.equal((await sp({ name: 'Bo', score: LONG.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LONG.rp, mode: 'room' }) })).status, 409, '30 days: remembered');
  assert.equal((await sp({ name: 'Cy', score: LO.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LO.rp, mode: 'room' }) })).status, 200, '61 days: forgotten');
});
test('fingerprint memory: a day keeps the newest 5000 dropped runs, the oldest go first', async () => {
  const file = path.join(dir, 'gone.json'), daysDir = file.replace(/\.json$/, '.days');
  fs.mkdirSync(daysDir, { recursive: true });
  const junk = Array.from({ length: 5000 }, (_, i) => 'junk' + String(i).padStart(18, '0'));
  dayFile(daysDir, utcDay(-2), [fpOf(LO.code), ...junk, fpOf(LONG.code)]);   // 5002: the oldest two must go
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1', DATA_FILE: file });
  const sp = poster(srv);
  assert.equal((await sp({ name: 'Bo', score: LONG.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LONG.rp, mode: 'room' }) })).status, 409, 'the newest is remembered');
  assert.equal((await sp({ name: 'Cy', score: LO.score, mode: 'room', day: TODAY, replay: encodeReplay({ ...LO.rp, mode: 'room' }) })).status, 200, 'the oldest was let go');
});
