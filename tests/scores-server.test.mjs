// Tests for server/scores.mjs. Run: node tests/scores-server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

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
  ({ base } = await start({ RATE_MAX: '1000' }));
});
test.after(() => { procs.forEach(p => p.kill()); fs.rmSync(dir, { recursive: true, force: true }); });

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
  assert.equal((await post({ name: 'Big', score: 1, pad: 'x'.repeat(2000) })).status, 400, 'body limit');
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
