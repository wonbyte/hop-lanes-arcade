// Fast tests for js/replay.js and js/missions.js (no browser). Run: node tests/replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { MISSIONS, advanceMissions, doneMissions, emptyStats, missionsText, parseMissions } from '../js/missions.js';

test('replay: encode then decode gives the run back', () => {
  const run = { seed: 4022250974, mode: 'daily', chars: ['frog', 'robot'], joined: [true, true], handicap: 2, startTick: 1234,
    events: [[12, 0, 0, 1], [12, 1, 0, 1], [40, 0, -1, 0], [41, 0, 1, 0], [300, 1, 0, -1]] };
  const code = encodeReplay(run);
  assert.match(code, /^[\w-]+$/, 'url safe');
  assert.deepEqual(decodeReplay(code), run);
});

test('replay: bad input is null, not a crash', () => {
  assert.equal(decodeReplay('***'), null);
  assert.equal(decodeReplay(''), null);
  assert.equal(decodeReplay(btoa('9|1|classic|frog,fox|1|0|0|')), null, 'wrong version');
  assert.equal(decodeReplay(btoa('2|x|classic|frog,fox|1|0|0|')), null, 'bad seed');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|zzzzzzzz')), null, 'junk events');
  assert.equal(decodeReplay(btoa('2|1|zzz|frog,fox|1|0|0|')), null, 'unknown mode');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|0|0|0|')), null, 'nobody joined');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|7|0|')), null, 'bad handicap');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|999999999aU')), null, 'tick past an hour');
  assert.deepEqual(decodeReplay(btoa('2|1|race|frog,fox|3|1|50|5aU')).events, [[5, 0, 0, 1]]);
});

test('missions: parse, done, advance, never repeat an active one', () => {
  const m = parseMissions('');
  assert.deepEqual(m, { next: 3, active: [0, 1, 2] });
  assert.deepEqual(parseMissions('bad'), m);
  assert.deepEqual(parseMissions(missionsText(m)), m);
  const stats = { ...emptyStats(), coins: 10, row: 31 };
  const done = doneMissions(m, stats);
  assert.deepEqual(done, [0, 1]);
  const next = advanceMissions(m, done);
  assert.deepEqual(next, { next: 5, active: [3, 4, 2] });
  // wrap around the whole list many times: the three active missions stay distinct
  let cur = m;
  for (let i = 0; i < 100; i++) cur = advanceMissions(cur, [cur.active[i % 3]]);
  assert.equal(new Set(cur.active).size, 3);
  assert.ok(cur.active.every(i => i >= 0 && i < MISSIONS.length));
});
