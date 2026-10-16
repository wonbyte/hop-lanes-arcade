// Fast tests for js/rules.js (no browser). Run: node tests/rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_FROM, CLIFF_FROM, ICE_FROM, PORTAL_FROM, ROCKS_FROM, SPRING_FROM, LANE_KINDS, MUD_SLOW, STREAK_MAX, difficultyAt, hashString, hopTarget, hopTime, isBombRow, isWater, mulberry32, nextLaneKind } from '../js/rules.js';

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
      if (r < ICE_FROM) assert.notEqual(ks[r], 'ice');
      if (r < BRIDGE_FROM) assert.notEqual(ks[r], 'bridge');
      if (r < ROCKS_FROM) assert.notEqual(ks[r], 'rocks');
      if (r < SPRING_FROM) assert.notEqual(ks[r], 'spring');
      if (r < PORTAL_FROM) assert.notEqual(ks[r], 'portal');
      if (r < CLIFF_FROM) assert.notEqual(ks[r], 'cliff');
    }
  }
  const all = new Set(Array.from({ length: 20 }, (_, i) => world(i + 1, 400)).flat());
  for (const k of LANE_KINDS) assert.ok(all.has(k), `${k} appears in some world`);
});

test('nextLaneKind: a run is kept on purpose only up to its cap', () => {
  const always = () => 0.1;   // below 0.55: keep the run while allowed; then the weighted pick lands on grass
  for (const kind of ['road', 'river', 'lily', 'mud', 'rail', 'ice', 'bridge', 'rocks', 'spring', 'portal', 'cliff']) {
    for (let streak = 1; streak < STREAK_MAX[kind]; streak++) assert.equal(nextLaneKind(50, 0.3, { kind, streak }, always), kind);
    assert.equal(nextLaneKind(50, 0.3, { kind, streak: STREAK_MAX[kind] }, always), 'grass', `${kind} stops at ${STREAK_MAX[kind]}`);
  }
});

test('the latest kinds weigh nothing below their first row, so the kinds below SPRING_FROM are as they always were', () => {
  assert.ok(SPRING_FROM >= 95 && PORTAL_FROM > SPRING_FROM && CLIFF_FROM > PORTAL_FROM);
  // every draw at the row before a first row gives an old kind; at the first row some draw gives the new one
  const prev = { kind: 'road', streak: 4 };
  const kindsAt = r => new Set(Array.from({ length: 1000 }, (_, i) => nextLaneKind(r, difficultyAt(r, 140), prev, () => i / 1000)));
  for (const [kind, from] of [['spring', SPRING_FROM], ['portal', PORTAL_FROM], ['cliff', CLIFF_FROM]]) {
    assert.ok(!kindsAt(from - 1).has(kind), `no ${kind} at row ${from - 1}`);
    assert.ok(kindsAt(from).has(kind), `${kind} at row ${from}`);
  }
  assert.ok(isWater('cliff') && !isWater('spring') && !isWater('portal'), 'a rescue never goes back onto a cliff');
  assert.deepEqual([isBombRow(20), isBombRow(24), isBombRow(26), isBombRow(100)], [false, true, false, true]);
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
  assert.equal(hopTarget({ kind: 'ice', trees: new Set([1]) }, 0, 1, 4), null, 'trees block on ice too');
});

test('hopTime: mud is slow', () => {
  assert.equal(hopTime('grass', 0.12), 0.12);
  assert.equal(hopTime('mud', 0.12), 0.12 * MUD_SLOW);
  assert.ok(MUD_SLOW > 1.5 && MUD_SLOW < 3);
});

test('isoWeek, streaks and hats', async () => {
  const { HATS, hatFor, isoWeek, streakAfter, streakCount, traitOf } = await import('../js/rules.js');
  assert.equal(isoWeek('2027-01-01'), '2026-W53');
  assert.equal(isoWeek('2024-12-30'), '2025-W01');
  assert.equal(isoWeek('2026-10-14'), '2026-W42');
  assert.equal(isoWeek('2026-02-30'), null);
  assert.equal(isoWeek('junk'), null);
  assert.equal(streakAfter('', '2026-10-14', '2026-10-13'), '2026-10-14|1', 'first daily run');
  assert.equal(streakAfter('2026-10-13|2', '2026-10-14', '2026-10-13'), '2026-10-14|3', 'a day after the last: one more');
  assert.equal(streakAfter('2026-10-14|3', '2026-10-14', '2026-10-13'), '2026-10-14|3', 'the same day again: no change');
  assert.equal(streakAfter('2026-10-01|9', '2026-10-14', '2026-10-13'), '2026-10-14|1', 'a gap starts over');
  assert.equal(streakCount('2026-10-13|2', '2026-10-14', '2026-10-13'), 2, 'yesterday still counts until today is played');
  assert.equal(streakCount('2026-10-01|9', '2026-10-14', '2026-10-13'), 0);
  assert.equal(hatFor(99), null);
  assert.equal(hatFor(100).key, 'cap');
  assert.equal(hatFor(499).key, 'crown');
  assert.equal(hatFor(500).key, 'halo');
  assert.ok(HATS.every((h, i) => !i || h.at < HATS[i - 1].at), 'hats are listed from the top');
  assert.deepEqual(traitOf('frog'), { text: 'BALANCED' });
  assert.deepEqual(traitOf('constructor'), {}, 'nothing from Object.prototype');
  assert.deepEqual(traitOf('nobody'), {});
  assert.equal(traitOf('bunny').hop, 0.8);
});

test('dailySeedFor: one seed per day, stable, and hashString of DAY_PREFIX + day (what the score server verifies)', async () => {
  const { DAY_PREFIX, dailySeedFor } = await import('../js/rules.js');
  assert.equal(DAY_PREFIX, 'hoplanes.day.');
  assert.equal(dailySeedFor('2026-10-16'), dailySeedFor('2026-10-16'));
  assert.equal(dailySeedFor('2026-10-16'), hashString('hoplanes.day.2026-10-16'));
  assert.equal(dailySeedFor('2026-10-16'), hashString(DAY_PREFIX + '2026-10-16'));
  assert.notEqual(dailySeedFor('2026-10-16'), dailySeedFor('2026-10-17'));
  assert.notEqual(dailySeedFor('2026-10-16'), hashString('2026-10-16'), 'not the bare day');
  const s = dailySeedFor('2026-10-16');
  assert.ok(Number.isInteger(s) && s >= 0 && s < 4294967296, 'a 32-bit seed');
});

test('hashString is FNV-1a: the published value for "a", and every character counts', () => {
  assert.equal(hashString('a'), 0xe40c292c, 'the FNV-1a 32-bit test vector');
  assert.equal(hashString('ab'), 1294271946);
  assert.notEqual(hashString('ab'), hashString('ba'), 'order matters');
  assert.notEqual(hashString('a'), hashString('aa'));
});

test('mulberry32: the first draws of a seed are what they always were (the worlds depend on them)', () => {
  const r = mulberry32(42);
  const first = [r(), r(), r()];
  assert.deepEqual(first.map(x => Math.round(x * 1e6) / 1e6), [0.601104, 0.448291, 0.852466]);
  // a seed is a 32-bit number: the same seed plus 2^32 is the same stream
  assert.equal(mulberry32(1 + 4294967296)(), mulberry32(1)());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('difficulty: full at DIFF_ROWS, never below 0 or above 1', async () => {
  const { DIFF_ROWS, difficulty } = await import('../js/rules.js');
  assert.equal(DIFF_ROWS, 140);
  assert.equal(difficulty(0), 0);
  assert.equal(difficulty(-3), 0);
  assert.equal(difficulty(35), 0.25);
  assert.equal(difficulty(140), 1);
  assert.equal(difficulty(141), 1);
  assert.equal(difficultyAt(10, 100), 0.1);
  assert.equal(difficultyAt(100, 100), 1);
  assert.equal(difficultyAt(101, 100), 1, 'capped at 1');
});

test('the tuning constants that decide a run are what the saved runs were played with', async () => {
  const R = await import('../js/rules.js');
  assert.equal(R.STEP, 1 / 120);
  assert.equal(R.TICKS_PER_S, 120);
  assert.equal(R.MAX_RUN_TICKS, 120 * 60 * 61, 'an hour and a minute of play');
  assert.deepEqual(R.START_X, [-2, 2]);
  assert.equal(R.PLAY_HALF, 4);
  assert.equal(R.BOMB_TICKS, 360);
  assert.equal(R.PLANK_BREAK, 72);
  assert.equal(R.PLANK_BACK, 360);
  assert.deepEqual([R.LEAD_FROM, R.LEAD_GAP, R.LEAD_SLOW], [30, 5, 1.3]);
  assert.deepEqual([R.ICE_FROM, R.BRIDGE_FROM, R.ROCKS_FROM, R.SPRING_FROM, R.PORTAL_FROM, R.CLIFF_FROM], [25, 40, 55, 95, 110, 125]);
  assert.deepEqual(R.LANE_KINDS, ['grass', 'road', 'river', 'lily', 'mud', 'rail', 'ice', 'bridge', 'rocks', 'spring', 'portal', 'cliff']);
  assert.deepEqual(R.MODES, ['classic', 'race', 'coinwar', 'tag', 'daily', 'room']);
  assert.deepEqual(Object.keys(R.COIN_CHANCE).sort(), ['bridge', 'cliff', 'grass', 'ice', 'lily', 'mud', 'portal', 'road', 'rocks', 'spring'], 'river and rail never hold a coin');
  assert.ok(Object.values(R.COIN_CHANCE).every(c => c > 0 && c < 1));
  assert.deepEqual(R.STREAK_MAX, { road: 4, river: 3, lily: 2, mud: 2, rail: 3, ice: 2, bridge: 1, rocks: 2, spring: 1, portal: 1, cliff: 2 });
  assert.deepEqual(Object.keys(R.TRAITS), ['frog', 'fox', 'bunny', 'cat', 'robot', 'pig', 'penguin', 'turtle']);
  assert.ok(R.TRAITS.cat.lives === 1 && R.TRAITS.robot.idle === 3 && R.TRAITS.penguin.noSlide === true && R.TRAITS.turtle.behind === 1);
  assert.ok(Object.values(R.TRAITS).every(t => typeof t.text === 'string' && t.text), 'every animal has a join card text');
  assert.deepEqual(R.HATS.map(h => [h.key, h.name, h.at]), [['halo', 'HALO', 500], ['crown', 'CROWN', 250], ['cap', 'CAP', 100]]);
  assert.deepEqual([R.TWISTER_LEN, R.FLOOD_SPEED, R.SPRING_HOP, R.SLIDE_TIME, R.TAG_BOOST, R.NEAR_MISS], [0.9, 1.5, 1.6, 0.12, 0.7, 0.5]);
});

test('isBombRow and isBombPower: past row 20, every 4th row, a magnet, only with two players', async () => {
  const { isBombPower } = await import('../js/rules.js');
  assert.deepEqual([isBombRow(16), isBombRow(21), isBombRow(22), isBombRow(23), isBombRow(24), isBombRow(28), isBombRow(-4)], [false, false, false, false, true, true, false]);
  assert.equal(isBombPower('magnet', 24, true), true);
  assert.equal(isBombPower('magnet', 24, false), false, 'alone a magnet is a magnet');
  assert.equal(isBombPower('shield', 24, true), false, 'a shield is never a bomb');
  assert.equal(isBombPower('magnet', 23, true), false, 'not a bomb row');
});

test('hopTarget: the hidden column past the edge, rounding, and the river bank', () => {
  const secret = { kind: 'grass', secret: 5, trees: new Set() };
  assert.equal(hopTarget(secret, 4, 1, 4), 5, 'the secret column is reachable');
  assert.equal(hopTarget({ ...secret, secret: -5 }, -4, -1, 4), -5);
  assert.equal(hopTarget(secret, 4, -1, 4), 3);
  assert.equal(hopTarget({ ...secret, kind: 'road' }, 4, 1, 4), null, 'only grass has a hidden column');
  assert.equal(hopTarget({ kind: 'grass', secret: null, trees: new Set() }, 4, 1, 4), null);
  assert.equal(hopTarget({ kind: 'mud', trees: new Set() }, 0.5, 0, 4), 1, 'rounds up from the half');
  assert.equal(hopTarget({ kind: 'mud', trees: new Set() }, -0.4, 1, 4), 1);
  assert.equal(hopTarget({ kind: 'mud', trees: new Set() }, -0.6, 1, 4), 0);
  assert.equal(hopTarget({ kind: 'grass', trees: new Set([4]) }, 3, 1, 4), null);
  assert.equal(hopTarget({ kind: 'mud' }, 3, 1, 4), 4, 'a lane without trees');
  assert.equal(hopTarget({ kind: 'river' }, 3.6, 1, 4), null, '4.6 is past the bank');
  assert.equal(hopTarget({ kind: 'river' }, 3.4, 1, 4), 4.4, '4.4 is on it');
  assert.equal(hopTarget({ kind: 'river' }, 4.5, 0, 4), 4.5, 'the bank itself');
  assert.equal(hopTarget({ kind: 'river' }, -4.5, -0.1, 4), null);
  assert.equal(hopTarget({ kind: 'river', trees: new Set([2]) }, 1, 1, 4), 2, 'trees mean nothing on a river');
});

test('isWater: river, lily, bridge and cliff; the rest is ground', () => {
  for (const k of ['river', 'lily', 'bridge', 'cliff']) assert.equal(isWater(k), true, k);
  for (const k of ['grass', 'road', 'mud', 'rail', 'ice', 'rocks', 'spring', 'portal']) assert.equal(isWater(k), false, k);
});

test('plankState: cracking until breakAt, down until backAt, up after; no plank is water', async () => {
  const { plankState } = await import('../js/rules.js');
  const lane = { planks: new Map([[0, { breakAt: 100, backAt: 200 }], [1, { breakAt: -1, backAt: -1 }]]) };
  assert.equal(plankState(lane, 0, 99), 'cracking');
  assert.equal(plankState(lane, 0, 100), 'down');
  assert.equal(plankState(lane, 0, 199), 'down');
  assert.equal(plankState(lane, 0, 200), 'up');
  assert.equal(plankState(lane, 1, 0), 'up', 'never stepped on');
  assert.equal(plankState(lane, 2, 0), 'down', 'no plank');
});

test('nextLaneKind: the weights of the kinds, row by row (the chance of each at a fixed draw)', () => {
  const prev = { kind: 'road', streak: 4 };   // the run is at its cap: the weighted pick decides
  const share = (r, kind) => { let n = 0; for (let i = 0; i < 2000; i++) if (nextLaneKind(r, difficultyAt(r, 140), prev, () => i / 2000) === kind) n++; return n / 2000; };
  // row 4: grass 0.32, road 0.36, river 0.2, rail 0.12 (diff about 0.03)
  const d4 = difficultyAt(4, 140), sum4 = 0.32 - d4 * 0.12 + 0.36 + 0.2 + d4 * 0.06 + 0.12 + d4 * 0.06;
  assert.ok(Math.abs(share(4, 'grass') - (0.32 - d4 * 0.12) / sum4) < 0.01, 'grass ' + share(4, 'grass'));
  assert.ok(Math.abs(share(4, 'road') - 0.36 / sum4) < 0.01, 'road ' + share(4, 'road'));
  assert.ok(Math.abs(share(4, 'river') - (0.2 + d4 * 0.06) / sum4) < 0.01, 'river ' + share(4, 'river'));
  assert.ok(Math.abs(share(4, 'rail') - (0.12 + d4 * 0.06) / sum4) < 0.01, 'rail ' + share(4, 'rail'));
  assert.equal(share(8, 'lily'), 0, 'no lily pads at row 8'); assert.ok(share(9, 'lily') > 0.05, 'lily pads from row 9');
  assert.equal(share(12, 'mud'), 0); assert.ok(share(13, 'mud') > 0.03, 'mud from row 13');
  // at full difficulty: grass 0.2, river 0.26, rail 0.18, ice 0.09, bridge 0.08, rocks 0.1, spring 0.05, portal 0.04, cliff 0.07
  const w = { grass: 0.2, road: 0.36, river: 0.26, lily: 0.1, mud: 0.07, rail: 0.18, ice: 0.09, bridge: 0.08, rocks: 0.1, spring: 0.05, portal: 0.04, cliff: 0.07 };
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(w)) assert.ok(Math.abs(share(200, k) - w[k] / sum) < 0.01, `${k} at full difficulty: ${share(200, k)} ~ ${w[k] / sum}`);
  // a run is kept with a draw below 0.55, not at it
  assert.equal(nextLaneKind(50, 0.3, { kind: 'road', streak: 1 }, () => 0.549), 'road');
  assert.notEqual(nextLaneKind(50, 0.3, { kind: 'road', streak: 1 }, () => 0.55), 'road');
  // grass never starts a run on purpose; after grass a grass pick turns into a road (draw < 0.5) or a river
  const draws = seq => { let i = 0; return () => seq[i++]; };
  assert.equal(nextLaneKind(50, 0.3, { kind: 'grass', streak: 1 }, draws([0.0, 0.49])), 'road');
  assert.equal(nextLaneKind(50, 0.3, { kind: 'grass', streak: 1 }, draws([0.0, 0.5])), 'river');
  assert.equal(nextLaneKind(50, 0.3, { kind: 'grass', streak: 9 }, draws([0.0, 0.5])), 'river', 'grass runs are never kept');
  assert.equal(nextLaneKind(50, 0.3, { kind: 'road', streak: 4 }, draws([0.0, 0.5])), 'grass', 'after a road a grass pick stays grass');
  assert.equal(nextLaneKind(3, 0.3, { kind: 'road', streak: 1 }, draws([0.0])), 'grass', 'rows 0..3 are grass');
});

test('streaks: a junk count reads as 1 (today) or 0 (before); the day boundary is the string given', async () => {
  const { streakAfter, streakCount } = await import('../js/rules.js');
  assert.equal(streakAfter('2026-10-14|x', '2026-10-14', '2026-10-13'), '2026-10-14|1');
  assert.equal(streakAfter('2026-10-13|x', '2026-10-14', '2026-10-13'), '2026-10-14|1', 'junk yesterday: 0 + 1');
  assert.equal(streakAfter(null, '2026-10-14', '2026-10-13'), '2026-10-14|1');
  assert.equal(streakAfter('2026-10-13|2', '2026-10-14', '2026-10-12'), '2026-10-14|1', 'the caller says what yesterday is');
  assert.equal(streakCount('2026-10-14|3', '2026-10-14', '2026-10-13'), 3);
  assert.equal(streakCount('2026-10-14|x', '2026-10-14', '2026-10-13'), 0);
  assert.equal(streakCount('', '2026-10-14', '2026-10-13'), 0);
  assert.equal(streakCount('2026-10-12|5', '2026-10-14', '2026-10-13'), 0, 'two days ago: lost');
});

test('isoWeek: Sundays belong to the week before, bad months and days are null; isoDay pads', async () => {
  const { dayBefore, isoDay, isoWeek } = await import('../js/rules.js');
  assert.equal(isoWeek('2026-10-18'), '2026-W42', 'a Sunday is the end of its week');
  assert.equal(isoWeek('2026-10-19'), '2026-W43', 'Monday starts the next');
  assert.equal(isoWeek('2027-01-03'), '2026-W53', 'the Sunday after New Year is still week 53');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(isoWeek('2026-12-31'), '2026-W53');
  assert.equal(isoWeek('2026-13-01'), null, 'no month 13');
  assert.equal(isoWeek('2026-10-00'), null, 'no day 0');
  assert.equal(isoWeek('2026-10-32'), null);
  assert.equal(isoWeek('2026-1-5'), null, 'two digits each');
  assert.equal(isoWeek(' 2026-10-14'), null);
  assert.equal(isoWeek(null), null);
  assert.equal(isoDay(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(isoDay(new Date(2026, 11, 25)), '2026-12-25');
  assert.equal(dayBefore(new Date(2026, 2, 1)), '2026-02-28');
  assert.equal(dayBefore(new Date(2026, 0, 1)), '2025-12-31');
  assert.equal(dayBefore(new Date(2026, 0, 10)), '2026-01-09');
  assert.match(isoDay(), /^\d{4}-\d{2}-\d{2}$/, 'today, by default');
});

test('hatFor: the first hat from the top whose score is reached; hopTime only slows a hop out of mud', async () => {
  const { hatFor } = await import('../js/rules.js');
  assert.equal(hatFor(0), null);
  assert.equal(hatFor(249).key, 'cap');
  assert.equal(hatFor(250).key, 'crown');
  assert.equal(hatFor(9999).key, 'halo');
  assert.equal(hopTime('river', 0.12), 0.12);
  assert.equal(hopTime(undefined, 0.12), 0.12, 'no lane: a plain hop');
  assert.ok(Math.abs(hopTime('mud', 0.1) - 0.22) < 1e-12);
});

test('the first rows of ice, bridges and rocks, and odd inputs to isoWeek', async () => {
  const { FIRST_ROW, isoWeek } = await import('../js/rules.js');
  assert.equal(FIRST_ROW, -8, 'eight rows of scenery behind the start');
  const prev = { kind: 'road', streak: 4 };
  const kindsAt = r => new Set(Array.from({ length: 1000 }, (_, i) => nextLaneKind(r, difficultyAt(r, 140), prev, () => i / 1000)));
  for (const [kind, from] of [['ice', ICE_FROM], ['bridge', BRIDGE_FROM], ['rocks', ROCKS_FROM]]) {
    assert.ok(!kindsAt(from - 1).has(kind), `no ${kind} at row ${from - 1}`);
    assert.ok(kindsAt(from).has(kind), `${kind} at row ${from}`);
  }
  assert.equal(isoWeek('2026-10-14x'), null, 'nothing after the day');
  assert.equal(isoWeek('x2026-10-14'), null);
});
