// Tests for server/scores.mjs. Run: node tests/scores-server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { dailySeedFor, hashString } from '../js/rules.js';
import { simulate } from '../js/sim.js';
import { isoWeek } from '../server/scores.mjs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/scores.mjs');
let proc, base, dir;
const procs = [];

async function start(extraEnv) {
  const port = await freePort();
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, `s${port}.json`), ...extraEnv }, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(p);
  await new Promise((res, rej) => { p.stdout.once('data', res); p.once('error', rej); });
  return { port, base: `http://127.0.0.1:${port}`, file: path.join(dir, `s${port}.json`) };
}

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
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
  assert.ok(fs.existsSync(path.join(dir, new URL(base).port ? `s${new URL(base).port}.json` : 's.json')), 'persisted');
});

test('per-day boards: day and mode on POST, filters on GET', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const get = q => fetch(srv.base + '/scores' + q);
  assert.equal((await sp({ name: 'A', score: 10, day: '2026-01-01', mode: 'daily' })).status, 200);
  assert.equal((await sp({ name: 'B', score: 30, day: '2026-01-01', mode: 'classic' })).status, 200);
  assert.equal((await sp({ name: 'C', score: 20, day: '2026-01-02', mode: 'daily' })).status, 200);
  assert.equal((await sp({ name: 'D', score: 5, day: '2026-1-1' })).status, 400);
  assert.equal((await sp({ name: 'D', score: 5, mode: 'x' })).status, 400);
  const d1 = (await (await get('?day=2026-01-01')).json()).top;
  assert.deepEqual(d1.map(e => e.name), ['B', 'A']);
  assert.deepEqual(d1.map(e => [e.day, e.mode]), [['2026-01-01', 'classic'], ['2026-01-01', 'daily']]);
  const dd = (await (await get('?day=2026-01-01&mode=daily')).json()).top;
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
  assert.deepEqual(JSON.parse(fs.readFileSync(srv.file, 'utf8')).map(e => [e.name, e.score]), [['A', 7]], 'flushed on exit');
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
  assert.equal((await names('')).length, 2);
  assert.equal((await sp({ name: 'Max', score: 5000 })).status, 200);
  assert.equal((await sp({ name: 'Max', score: 5001 })).status, 400);
});

test('old flat scores.json loads; day buckets older than 14 days expire', async () => {
  const file = path.join(dir, 'old.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'Old', score: 9, at: 'x' }]));
  const srv = await start({ RATE_MAX: '1000', DATA_FILE: file });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await (await fetch(srv.base + '/scores')).json()).top[0].name, 'Old');
  await sp({ name: 'A', score: 1, day: '2026-01-01' });
  await sp({ name: 'B', score: 1, day: '2026-01-20' });
  const all = (await (await fetch(srv.base + '/scores')).json()).top.map(e => e.name).sort();
  assert.deepEqual(all, ['B', 'Old']);
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

test('VERIFY: a posted score must be what its replay plays to', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const send = body => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const day = dailyDay(DAILY_RUN);
  assert.ok(day, 'the daily run was played on an October day');
  assert.equal((await send({ name: 'Ann', score: 17, mode: 'classic', replay: CLASSIC_RUN })).status, 200, 'the true score');
  assert.equal((await send({ name: 'Dee', score: 44, mode: 'daily', day, replay: DAILY_RUN })).status, 200, 'the daily run on its day');
  const reject = async (body, why) => {
    const r = await send(body);
    assert.equal(r.status, 400, why);
    return (await r.json()).error;
  };
  assert.equal(await reject({ name: 'Bob', score: 22, mode: 'classic', replay: CLASSIC_RUN }, 'a higher score than the run'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 16, mode: 'classic', replay: CLASSIC_RUN }, 'a lower score'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 17, mode: 'classic' }, 'no replay'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 17, mode: 'race', replay: CLASSIC_RUN }, 'another mode'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 44, mode: 'daily', day: '2026-10-01', replay: DAILY_RUN }, 'another day'), 'replay mismatch');
  // the same daily hops on a classic seed are not a daily run
  const moved = encodeReplay({ ...decodeReplay(DAILY_RUN), seed: 42 });
  assert.equal(await reject({ name: 'Bob', score: 44, mode: 'daily', day, replay: moved }, 'a daily run on another seed'), 'replay mismatch');
  // tampered hops: an extra hop forward changes the run, so the claimed score no longer fits
  const rp = decodeReplay(CLASSIC_RUN);
  const forged = encodeReplay({ ...rp, events: rp.events.map(([t, p, dx, dr]) => [t, p, 0, 1]) });
  assert.equal(await reject({ name: 'Bob', score: 17, mode: 'classic', replay: forged }, 'forged hops'), 'replay mismatch');
  assert.equal(await reject({ name: 'Bob', score: 1, mode: 'classic', replay: 'x'.repeat(33000) }, 'replay too long'), 'invalid name, score, day or mode');
  assert.equal(await reject({ name: 'Bob', score: 1, mode: 'classic', replay: 'no spaces!' }, 'replay not a code'), 'invalid name, score, day or mode');
  const { top } = await (await fetch(srv.base + '/scores')).json();
  assert.deepEqual(top.map(e => [e.name, e.score]).sort(), [['Ann', 17], ['Dee', 44]].sort());
});

test('without VERIFY a replay is checked for shape, stored and returned', async () => {
  const r = await post({ name: 'Rex', score: 3, mode: 'classic', replay: CLASSIC_RUN });
  assert.equal(r.status, 200);
  assert.equal((await post({ name: 'Rex', score: 3, replay: 7 })).status, 400);
  assert.equal((await post({ name: 'Pat', score: 2 })).status, 200);
  const { top } = await (await fetch(base + '/scores')).json();
  assert.equal(top.find(e => e.name === 'Rex').replay, CLASSIC_RUN);
  assert.equal(top.find(e => e.name === 'Pat').replay, null);
  assert.ok(top.every(e => e.replay === null || typeof e.replay === 'string'));
});

test('VERIFY: the verified replay is stored and returned', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const r = await fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ann', score: 17, mode: 'classic', replay: CLASSIC_RUN }) });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(srv.base + '/scores')).json()).top[0].replay, CLASSIC_RUN);
});

test('without VERIFY a junk replay is stored as null; the POST reply carries no replays', async () => {
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const a = await sp({ name: 'Rex', score: 3, mode: 'classic', replay: CLASSIC_RUN });
  const reply = (await a.json()).top;
  assert.ok(reply.length && reply.every(e => !('replay' in e) || e.replay == null), 'POST reply has no replay strings');
  assert.equal((await sp({ name: 'Junk', score: 2, mode: 'classic', replay: 'abcdefgh' })).status, 200);
  const { top } = await (await fetch(srv.base + '/scores')).json();
  assert.equal(top.find(e => e.name === 'Rex').replay, CLASSIC_RUN, 'GET keeps it');
  assert.equal(top.find(e => e.name === 'Junk').replay, null, 'junk stored as null');
});

test('an entry pushed past rank 10 loses its replay', async () => {
  const srv = await start({ RATE_MAX: '1000', SAVE_DELAY_MS: '0' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await sp({ name: 'Low', score: 1, mode: 'classic', replay: CLASSIC_RUN });
  for (let i = 0; i < 10; i++) await sp({ name: 'P' + i, score: 10 + i, mode: 'classic' });
  const stored = JSON.parse(fs.readFileSync(srv.file, 'utf8'));
  assert.equal(stored.find(e => e.name === 'Low').replay, null, 'rank 11 has no replay');
});

test('VERIFY: a daily run is accepted on its day\'s seed (dailySeedFor) and rejected on another day\'s', async () => {
  const srv = await start({ RATE_MAX: '1000', VERIFY: '1' });
  const send = body => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const day = '2026-10-10', other = '2026-10-11';   // past days: a future day is refused on POST
  const rp = { ...decodeReplay(DAILY_RUN), seed: dailySeedFor(day) };   // the recorded hops on another day's world: some run, whatever it scores
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
  assert.equal((await send({ name: 'Ann', score: 17, mode: 'classic', replay: CLASSIC_RUN })).status, 200, 'the first replay is simulated');
  const busy = await send({ name: 'Bob', score: 17, mode: 'classic', replay: CLASSIC_RUN });
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
  assert.equal((await sp({ name: 'A', score: 10, mode: 'race', day: '2026-10-05' })).status, 200);
  assert.deepEqual(await names(''), [['A', 10]]);
  assert.deepEqual(await names('?mode=race'), [['A', 10]]);
  assert.deepEqual(await names('?mode=race'), [['A', 10]], 'served from the cache');
  assert.equal((await sp({ name: 'B', score: 20, mode: 'race', day: '2026-10-05' })).status, 200);
  assert.deepEqual(await names('?mode=race'), [['B', 20], ['A', 10]], 'the cache was dropped');
  assert.deepEqual(await names('?week=2026-W41'), [['B', 20], ['A', 10]]);
  assert.equal((await sp({ name: 'A', score: 30, mode: 'race', day: '2026-10-05' })).status, 200, 'a higher score replaces');
  assert.deepEqual(await names('?week=2026-W41'), [['A', 30], ['B', 20]]);
  assert.deepEqual(await names('?day=2026-10-05&mode=race'), [['A', 30], ['B', 20]]);
  assert.deepEqual(await names('?day=2026-10-06'), []);
  assert.equal((await sp({ name: 'A', score: 5, mode: 'race', day: '2026-10-05' })).status, 200, 'a lower score is ignored');
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
  const srv = await start({ RATE_MAX: '1000' });
  const sp = b => fetch(srv.base + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const get = q => fetch(srv.base + '/scores' + q);
  const names = async q => (await (await get(q)).json()).top.map(e => e.name);
  // 2026-10-05 is a Monday, 2026-10-11 the Sunday after, 2026-10-12 the next Monday, 2026-10-04 the Sunday before
  for (const b of [
    { name: 'Mon', score: 10, day: '2026-10-05', mode: 'daily' },
    { name: 'Sun', score: 20, day: '2026-10-11', mode: 'classic' },
    { name: 'Next', score: 99, day: '2026-10-12', mode: 'daily' },
    { name: 'Prev', score: 98, day: '2026-10-04', mode: 'daily' },
    { name: 'NoDay', score: 97 },
  ]) assert.equal((await sp(b)).status, 200);
  assert.deepEqual(await names('?week=2026-W41'), ['Sun', 'Mon']);
  assert.deepEqual(await names('?week=2026-W41&mode=daily'), ['Mon']);
  assert.deepEqual(await names('?week=2026-W42'), ['Next']);
  assert.deepEqual(await names('?week=2026-W10'), []);
  for (const q of ['?week=2026-42', '?week=bad', '?week=2026-W00', '?week=2026-W54', '?week=2026-W4', '?week=', '?week=2026-W41&day=2026-10-05', '?week=2026-W41&mode=x'])
    assert.equal((await get(q)).status, 400, q);
});
