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
    { name: 'Ok', score: -1 }, { name: 'Ok', score: 1.5 }, { name: 'Ok', score: '5' }, { name: 'Ok', score: 100001 }, { name: 5, score: 1 }];
  for (const b of bad) assert.equal((await post(b)).status, 400, JSON.stringify(b));
  assert.equal((await post(null, 'not json')).status, 400);
  assert.equal((await post({ name: 'Big', score: 1, pad: 'x'.repeat(2000) })).status, 400, 'body limit');
  const { top } = await (await fetch(base + '/scores')).json();
  assert.deepEqual(top.map(e => [e.name, e.score]), [['Bob 2', 90], ['Cy', 70], ['Ann', 50]]);
  assert.ok(top[0].at);
  assert.ok(fs.existsSync(path.join(dir, new URL(base).port ? `s${new URL(base).port}.json` : 's.json')), 'persisted');
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
