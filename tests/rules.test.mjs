// Fast tests for js/rules.js (no browser). Run: node tests/rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_KINDS, MUD_SLOW, STREAK_MAX, difficultyAt, hashString, hopTarget, hopTime, mulberry32, nextLaneKind } from '../js/rules.js';

test('mulberry32: same seed, same numbers, all in [0, 1)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(7);
  const xs = Array.from({ length: 1000 }, a), ys = Array.from({ length: 1000 }, b), zs = Array.from({ length: 1000 }, c);
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every(x => x >= 0 && x < 1));
  assert.ok(new Set(xs).size > 990, 'no obvious repeats');
});

test('hashString is stable and differs by day', () => {
  assert.equal(hashString('2026-01-01'), hashString('2026-01-01'));
  assert.notEqual(hashString('2026-01-01'), hashString('2026-01-02'));
  assert.equal(hashString(''), 2166136261);
});

test('difficultyAt ramps from 0 to 1', () => {
  assert.equal(difficultyAt(-5, 140), 0);
  assert.equal(difficultyAt(0, 140), 0);
  assert.equal(difficultyAt(70, 140), 0.5);
  assert.equal(difficultyAt(1000, 140), 1);
});

function world(seed, rows) {
  const rng = mulberry32(seed);
  const out = [];
  let prev = { kind: 'grass', streak: 0 };
  for (let r = 0; r <= rows; r++) {
    const k = nextLaneKind(r, difficultyAt(r, 140), prev, rng);
    prev = { kind: k, streak: k === prev.kind ? prev.streak + 1 : 1 };
    out.push(k);
  }
  return out;
}

test('nextLaneKind: safe start, known kinds, deterministic', () => {
  const a = world(42, 400), b = world(42, 400), c = world(7, 400);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.slice(0, 4), ['grass', 'grass', 'grass', 'grass']);
  assert.ok(a.every(k => LANE_KINDS.includes(k)));
});

test('nextLaneKind: no two grass rows after the start, runs stay short, late kinds come late', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const ks = world(seed, 400);
    for (let r = 4; r < ks.length; r++) {
      if (ks[r] === 'grass') assert.notEqual(ks[r - 1], 'grass', `seed ${seed} row ${r}: grass after grass`);
      if (r <= 8) assert.notEqual(ks[r], 'lily');
      if (r <= 12) assert.notEqual(ks[r], 'mud');
    }
  }
  const all = new Set(Array.from({ length: 20 }, (_, i) => world(i + 1, 400)).flat());
  for (const k of LANE_KINDS) assert.ok(all.has(k), `${k} appears in some world`);
});

test('nextLaneKind: a run is kept on purpose only up to its cap', () => {
  const always = () => 0.1;   // below 0.55: keep the run while allowed; then the weighted pick lands on grass
  for (const kind of ['road', 'river', 'lily', 'mud', 'rail']) {
    for (let streak = 1; streak < STREAK_MAX[kind]; streak++) assert.equal(nextLaneKind(50, 0.3, { kind, streak }, always), kind);
    assert.equal(nextLaneKind(50, 0.3, { kind, streak: STREAK_MAX[kind] }, always), 'grass', `${kind} stops at ${STREAK_MAX[kind]}`);
  }
});

test('hopTarget: edges, trees, lily pads and river half steps', () => {
  const grass = { kind: 'grass', trees: new Set([2]) };
  assert.equal(hopTarget(grass, 0, 1, 4), 1);
  assert.equal(hopTarget(grass, 1, 1, 4), null, 'a tree blocks');
  assert.equal(hopTarget(grass, 4, 1, 4), null, 'the edge blocks');
  assert.equal(hopTarget(grass, -4, -1, 4), null);
  assert.equal(hopTarget(grass, 1.4, 0, 4), 1, 'off a log, a hop snaps to a column');
  assert.equal(hopTarget({ kind: 'road', trees: new Set() }, 3, 1, 4), 4);
  assert.equal(hopTarget({ kind: 'river' }, 1.4, 1, 4), 2.4, 'on the river any x is fine');
  assert.equal(hopTarget({ kind: 'river' }, 4.2, 1, 4), null, 'but not past the bank');
  assert.equal(hopTarget(null, 0, 1, 4), null, 'no lane, no hop');
});

test('hopTime: mud is slow', () => {
  assert.equal(hopTime('grass', 0.12), 0.12);
  assert.equal(hopTime('mud', 0.12), 0.12 * MUD_SLOW);
  assert.ok(MUD_SLOW > 1.5 && MUD_SLOW < 3);
});
