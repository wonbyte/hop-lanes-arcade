// Fast tests for js/gen.js (no browser): the world as data, rule by rule. Run: node tests/gen.test.mjs
// (tests/sim.test.mjs holds the saved browser runs and the way-forward check; here each builder's own facts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGen, railStep, standColumns, standGroups, trafficX, trainLen, wetAt, wetChunk, TRAIN_CARS, TRAIN_CAR_LEN, TRAIN_GAP } from '../js/gen.js';
import { BARE_MAX, BOMB_POWER_BOOST, COIN_CHANCE, PLAY_HALF, POWER_CHANCE, RULES, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty, isBombRow, isStill, kindFrom } from '../js/rules.js';

const near = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} ~ ${b}`);
const COLS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
// every lane of the first `rows` rows of `seeds` worlds, with its world (version: the rules version of the worlds;
// 3, the worlds every saved run was played on, unless a test says otherwise)
function* lanes(seeds, rows, from = 0, version = 3) {
  for (let seed = 1; seed <= seeds; seed++) { const g = createWorldGen(seed, version); for (let r = from; r < rows; r++) yield [g.lane(r), seed, g]; }
}

test('trafficX: a thing moves at lane speed in the lane direction and wraps inside the span', () => {
  const lane = { span: 34, dir: 1, speed: 2 };
  assert.equal(trafficX(lane, { x0: 0 }, 0), 0);
  assert.equal(trafficX(lane, { x0: 0 }, 1), 2);
  assert.equal(trafficX(lane, { x0: 1 }, 1), 3);
  assert.equal(trafficX({ ...lane, dir: -1 }, { x0: 0 }, 1), -2);
  assert.equal(trafficX({ ...lane, speed: 3 }, { x0: 0 }, 2), 6);
  assert.equal(trafficX(lane, { x0: 16 }, 1), -16, 'past the edge: back on the other side');
  assert.equal(trafficX(lane, { x0: 16 }, 0.5), -17, 'the span runs from -17 up to (not including) 17');
  near(trafficX(lane, { x0: 16 }, 0.4), 16.8, 'just short of the edge');
  assert.equal(trafficX({ ...lane, dir: -1 }, { x0: -17 }, 0.5), 16);
  assert.equal(trafficX(lane, { x0: 0 }, 17), 0, 'a full span later: the same place');
  assert.equal(trafficX({ span: 10, dir: 1, speed: 1 }, { x0: 0 }, 5), -5, 'a narrower span wraps sooner');
});

test('the chain: streaks count rows of one kind, prevKind is the row before, rivers alternate, dir is +-1', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = createWorldGen(seed, 3);
    let prev = null;
    for (let r = 0; r < 150; r++) {
      const l = g.lane(r);
      assert.equal(l.r, r); assert.equal(l.diff, difficulty(r)); assert.equal(l.span, 2 * WRAP + 4);
      assert.ok(l.dir === 1 || l.dir === -1);
      if (prev && r >= 2) {   // rows 1 and below follow a fixed grass head, not the row before
        assert.equal(l.prevKind, prev.kind);
        assert.equal(l.streak, l.kind === prev.kind ? prev.streak + 1 : 1, `seed ${seed} row ${r} streak`);
        if (l.kind === 'river' && prev.kind === 'river') assert.equal(l.dir, -prev.dir, 'a river after a river flows the other way');
        assert.ok(l.bossChunk >= prev.bossChunk && l.twisterChunk >= prev.twisterChunk && l.floodChunk >= prev.floodChunk);
      }
      if (l.boss) assert.ok(l.kind === 'rail' && r >= 100 && l.bossChunk === Math.floor(r / 100));
      if (l.twister) assert.equal(l.twisterChunk, Math.floor(r / 100));
      if (l.flood) assert.equal(l.floodChunk, Math.floor(r / 100));
      assert.equal(g.kind(r), l.kind);
      if (r >= 1) prev = l;
    }
  }
  const g = createWorldGen(9, 3);
  assert.deepEqual([g.lane(0).streak, g.lane(0).prevKind, g.lane(-3).kind, g.lane(-3).streak, g.lane(1).streak], [2, 'grass', 'grass', 2, 2], 'rows 1 and below follow a grass head of streak 1');
  // both directions happen on roads
  const dirs = new Set(); for (const [l] of lanes(10, 60)) if (l.kind === 'road') dirs.add(l.dir);
  assert.deepEqual([...dirs].sort(), [-1, 1]);
});

test('rain or snow: by 40-row chunk from row 20, about a quarter of the chunks, the same for every row of a chunk', () => {
  assert.deepEqual([19, 20, 39, 40, 59, 79, 80].map(wetChunk), [-1, 0, 0, 1, 1, 1, 2]);
  assert.equal(wetChunk(0), -1);
  let wet = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) for (let c = 0; c < 5; c++) {
    const a = wetAt(seed, c * 40 + 20), b = wetAt(seed, c * 40 + 39);
    assert.equal(a, b, `seed ${seed}: one answer per chunk`);
    if (c > 0) assert.equal(wetAt(seed, c * 40), a);
    wet += a ? 1 : 0; n++;
  }
  assert.ok(wet / n > 0.2 && wet / n < 0.3, 'about a quarter: ' + wet / n);
  assert.deepEqual([20, 39, 40, 41, 60, 79, 80, 89, 100, 119].map(r => wetAt(1, r)), [false, false, false, false, false, false, true, true, true, true], 'seed 1');
  assert.deepEqual([20, 39, 40, 41, 60, 79, 80, 89, 100, 119].map(r => wetAt(3, r)), [true, true, false, false, false, false, false, false, false, false], 'seed 3');
  assert.equal(wetAt(1, 19), false);
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(seed => wetAt(seed, 80))).size === 2, 'the seed decides too');
});

test('grass: trees outside the play columns, at most 4 inside, never on column 0 or on rows 0 and 1; the hidden column', () => {
  const secrets = new Set(), heights = new Set();
  let grassPast5 = 0, withSecret = 0, outTrees = 0, outCols = 0;
  for (const [l, seed] of lanes(60, 100)) {
    if (l.kind !== 'grass') continue;
    const inPlay = [...l.trees].filter(x => Math.abs(x) <= PLAY_HALF);
    assert.ok(inPlay.length <= 4, `seed ${seed} row ${l.r}: ${inPlay.length} trees in play`);
    assert.ok(!l.trees.has(0), 'column 0 is open');
    if (l.r <= 1) assert.equal(inPlay.length, 0, 'rows 0 and 1 have no trees in play');
    for (const x of l.trees) assert.ok(Number.isInteger(x) && Math.abs(x) <= 12);
    assert.deepEqual(l.treeH.map(t => t[0]), [...l.trees], 'one height per tree, in column order');
    for (const t of l.treeH) heights.add(t[1]);
    if (l.r > 5) { grassPast5++; if (l.secret !== null) withSecret++; }
    if (l.secret !== null) {
      assert.ok(l.r > 5, 'no hidden column before row 6');
      secrets.add(l.secret);
      assert.ok(!l.trees.has(l.secret), 'no tree on the hidden column');
      assert.equal(l.coins.get(l.secret), true, 'the hidden column holds a coin');
    }
    for (const [x] of l.coins) { assert.ok(!l.trees.has(x), 'no coin on a tree'); assert.ok(Math.abs(x) <= PLAY_HALF || x === l.secret); }
    if (l.r < 1) assert.equal(l.coins.size, 0, 'no coin on row 0');
    for (let x = PLAY_HALF + 1; x <= 12; x++) for (const s of [1, -1]) { outCols++; if (l.trees.has(s * x)) outTrees++; }
    if (l.power) assert.ok(!l.trees.has(l.power.x) && !l.coins.has(l.power.x) && Math.abs(l.power.x) <= PLAY_HALF);
  }
  assert.deepEqual([...secrets].sort((a, b) => a - b), [-(PLAY_HALF + 1), PLAY_HALF + 1], 'the hidden column is just past either edge');
  assert.ok(withSecret / grassPast5 > 0.08 && withSecret / grassPast5 < 0.16, 'about 12% of grass rows: ' + withSecret / grassPast5);
  assert.deepEqual([...heights].sort(), [0.6, 0.9, 1.2, 1.5]);
  assert.ok(outTrees / outCols > 0.8 && outTrees / outCols < 0.9, 'outside the play columns about 85% are trees: ' + outTrees / outCols);
  // the trees in play get denser with difficulty
  const density = (lo, hi) => { let t = 0, n = 0; for (const [l] of lanes(60, hi, lo)) if (l.kind === 'grass') { n++; t += [...l.trees].filter(x => Math.abs(x) <= PLAY_HALF).length; } return t / n; };
  assert.ok(density(2, 30) < density(100, 140), 'more trees further out');
});

test('coins and power-ups: a coin on a lane about COIN_CHANCE of the time, a power-up past row 10 about POWER_CHANCE', () => {
  const coins = {}, rows = {}, powers = { shield: 0, magnet: 0 };
  let eligible = 0;
  for (const [l] of lanes(150, 200, 11)) {
    rows[l.kind] = (rows[l.kind] || 0) + 1;
    if (l.coins.size - (l.secret !== null ? 1 : 0)) coins[l.kind] = (coins[l.kind] || 0) + 1;   // the hidden coin is not a draw
    if (l.kind === 'river' || l.kind === 'rail') assert.equal(l.coins.size, 0, 'no coin on water or rails');
    else assert.ok(l.coins.size <= 1 + (l.secret !== null ? 1 : 0), 'at most one coin (plus the hidden one)');
    if (l.power) {
      assert.ok(['grass', 'road', 'mud', 'ice', 'rocks', 'spring', 'portal'].includes(l.kind), 'a power-up only on ground: ' + l.kind);
      assert.ok(!l.coins.has(l.power.x), 'never on the coin');
      powers[l.power.kind]++;
    }
    if (['grass', 'road', 'mud', 'ice', 'rocks', 'spring', 'portal'].includes(l.kind)) eligible++;
  }
  for (const kind of Object.keys(COIN_CHANCE)) {
    if (!rows[kind] || rows[kind] < 150) continue;
    const share = (coins[kind] || 0) / rows[kind];
    assert.ok(Math.abs(share - COIN_CHANCE[kind]) < 0.06, `${kind}: a coin on ${share} of ${rows[kind]} rows, chance ${COIN_CHANCE[kind]}`);
  }
  const total = powers.shield + powers.magnet;
  assert.ok(Math.abs(total / eligible - POWER_CHANCE) < 0.015, `power-ups on ${total / eligible} of the ground rows past 10`);
  assert.ok(powers.shield > total * 0.4 && powers.magnet > total * 0.4, 'shields and magnets alike: ' + JSON.stringify(powers));
  for (const [l] of lanes(150, 11)) assert.equal(l.power, null, 'no power-up up to row 10');
  let at11 = 0; for (const [l] of lanes(300, 12, 11)) if (l.power) at11++;
  assert.ok(at11 > 0, 'row 11 can hold one');
});

test('road: speed, police past difficulty 0.3, trucks, the count of cars and their spacing', () => {
  let police = 0, trucks = 0, cars = 0, roads = 0;
  for (const [l, seed] of lanes(40, 140)) {
    if (l.kind !== 'road') continue;
    roads++;
    assert.equal(l.rot, undefined);
    assert.equal(l.objs[0].rot, l.dir > 0 ? Math.PI : 0, 'cars face where they drive');
    if (l.police) { police++; assert.ok(l.diff > 0.3, `seed ${seed} row ${l.r}: police only past difficulty 0.3`); assert.equal(l.truck, false, 'a chase has no trucks'); }
    if (l.truck) trucks++;
    const len = l.truck ? 2.4 : 1.4;
    assert.ok(l.objs.every(o => o.len === len), 'a truck row is all trucks, else all cars');
    const n = l.objs.length, lo = Math.floor(2 + l.diff * 1.5), hi = Math.floor(4 + l.diff * 1.5);
    assert.ok(n >= lo && n <= hi, `seed ${seed} row ${l.r}: ${n} cars, ${lo}..${hi}`);
    cars += n;
    // cars share the span: spacing span / n, each shifted by its own jitter of at most 0.35 spacing
    const spacing = l.span / n, base = l.objs[0].x0 - l.objs[0].jitter;
    assert.ok(base >= -l.span / 2 && base < -l.span / 2 + 3, 'the first car starts near the left end: ' + base);
    l.objs.forEach((o, i) => {
      near(o.x0 - o.jitter - base, i * spacing, `seed ${seed} row ${l.r} car ${i}`);
      assert.ok(o.jitter >= 0 && o.jitter < spacing * 0.35, 'jitter ' + o.jitter);
      assert.equal(o.x, o.x0, 'at rest where it starts');
      assert.ok([0xe8513a, 0x3a8ee8, 0xf2c33a, 0x8f5ae0, 0x3ac27a, 0xf27fb0].includes(o.color));
    });
  }
  assert.ok(police > roads * 0.05 && trucks > roads * 0.15, `police ${police}, trucks ${trucks} of ${roads}`);
  assert.ok(cars / roads > 2.5 && cars / roads < 4, 'about three cars a road: ' + cars / roads);
  for (const [l] of lanes(40, 43)) if (l.kind === 'road') assert.equal(l.police, false, 'no police up to row 42');
});

test('river: the count of logs falls with difficulty, logs are 2..4 long, short ones past difficulty 0.6, evenly spaced', () => {
  let shortLate = 0, lens = new Set();
  for (const [l, seed] of lanes(40, 140)) {
    if (l.kind !== 'river') continue;
    const n = l.objs.length, lo = Math.max(3, Math.floor(4 - l.diff * 2)), hi = Math.max(3, Math.floor(6 - l.diff * 2));
    assert.ok(n >= lo && n <= hi, `seed ${seed} row ${l.r}: ${n} logs, ${lo}..${hi}`);
    const spacing = l.span / n;
    l.objs.forEach((o, i) => { near(o.x0 - l.objs[0].x0, i * spacing, 'logs share the span evenly'); assert.equal(o.jitter, undefined); });
    assert.ok(l.objs[0].x0 >= -l.span / 2 && l.objs[0].x0 < -l.span / 2 + 3);
    for (const o of l.objs) {
      lens.add(o.len);
      if (l.diff <= 0.6) assert.ok(o.len >= 2 && o.len <= 4, `seed ${seed} row ${l.r}: a log of ${o.len}`);
      else { assert.ok(o.len >= 1 && o.len <= 4); if (o.len === 1) shortLate++; }
    }
  }
  assert.deepEqual([...lens].sort(), [1, 2, 3, 4]);
  assert.ok(shortLate > 10, 'past difficulty 0.6 some logs are a single piece: ' + shortLate);
  // three is the commonest length (it is listed twice)
  let three = 0, two = 0; for (const [l] of lanes(40, 80)) if (l.kind === 'river') for (const o of l.objs) { if (o.len === 3) three++; if (o.len === 2) two++; }
  assert.ok(three > two * 1.5, `3: ${three}, 2: ${two}`);
});

test('lily pads: 3 to 5 pads after a row that stands anywhere, the coin on a pad; mud is plain ground with looks', () => {
  const sizes = new Set();
  for (const [l, seed] of lanes(80, 120)) {
    if (l.kind === 'lily') {
      assert.ok([...l.pads].every(x => COLS.includes(x)));
      if (l.prevKind === 'road' || l.prevKind === 'river' || l.prevKind === 'mud' || l.prevKind === 'rail') { sizes.add(l.pads.size); assert.ok(l.pads.size >= 3 && l.pads.size <= 5, `seed ${seed} row ${l.r}: ${l.pads.size} pads`); }
      for (const [x] of l.coins) assert.ok(l.pads.has(x), 'the coin sits on a pad');
      assert.equal(l.power, null);
    }
    if (l.kind === 'mud') {
      assert.ok(l.r > 12);
      assert.ok(l.mudLooks.length > 5, 'puddles and reeds');
      for (const m of l.mudLooks) if (m.reed) { assert.ok(Math.abs(m.x) > PLAY_HALF, 'reeds grow outside the play columns'); assert.ok(m.reed === 0.3 || m.reed === 0.5); } else assert.ok([0.5, 0.7, 0.9].includes(m.w) && Math.abs(m.dz) <= 0.25);
      assert.equal(l.trees.size, 0);
      assert.equal(standColumns(l), null);
    }
  }
  assert.deepEqual([...sizes].sort(), [3, 4, 5]);
});

test('ice: at most 2 snowy trees in play, never on column 0, about 60% outside; its heights', () => {
  const heights = new Set();
  let out = 0, outCols = 0, ices = 0;
  for (const [l, seed] of lanes(60, 140, 25)) {
    if (l.kind !== 'ice') continue;
    ices++;
    assert.ok([...l.trees].filter(x => Math.abs(x) <= PLAY_HALF).length <= 2, `seed ${seed} row ${l.r}`);
    assert.ok(!l.trees.has(0));
    assert.deepEqual(l.treeH.map(t => t[0]), [...l.trees]);
    for (const t of l.treeH) heights.add(t[1]);
    for (let x = PLAY_HALF + 1; x <= 12; x++) for (const s of [1, -1]) { outCols++; if (l.trees.has(s * x)) out++; }
    for (const [x] of l.coins) assert.ok(!l.trees.has(x) && Math.abs(x) <= PLAY_HALF);
    if (l.power) assert.ok(!l.trees.has(l.power.x));
  }
  assert.ok(ices > 50);
  assert.deepEqual([...heights].sort(), [0.9, 1.2, 1.5]);
  assert.ok(out / outCols > 0.55 && out / outCols < 0.65, 'about 60% outside: ' + out / outCols);
});

test('bridge: a run of 3 to 6 planks inside the play columns, the coin on a plank; cliff: a tile per play column', () => {
  const lens = new Set();
  for (const [l, seed, g] of lanes(80, 160, 40)) {
    if (l.kind === 'bridge') {
      const xs = [...l.planks.keys()].sort((a, b) => a - b);
      assert.ok(xs.every(x => COLS.includes(x)), `seed ${seed} row ${l.r}: planks ${xs}`);
      // the builder's own run is contiguous; connectRow adds planks only after a row with groups (pads, planks, trees)
      if (standColumns(g.lane(l.r - 1)) === null) {
        assert.ok(xs.length >= 3 && xs.length <= 6 && xs.every((x, i) => !i || x === xs[i - 1] + 1), `seed ${seed} row ${l.r}: ${xs}`);
        lens.add(xs.length);
      }
      for (const pl of l.planks.values()) assert.deepEqual(pl, { breakAt: -1, backAt: -1 }, 'whole');
      for (const [x] of l.coins) assert.ok(l.planks.has(x), 'the coin on a plank');
      assert.equal(l.power, null);
    }
    if (l.kind === 'cliff') {
      assert.deepEqual([...l.planks.keys()].sort((a, b) => a - b), COLS);
      for (const [x] of l.coins) assert.ok(COLS.includes(x));
      assert.equal(l.power, null);
    }
  }
  assert.deepEqual([...lens].sort(), [3, 4, 5, 6]);
});

test('rocks: 1 to 3 boulders (one more at full difficulty) of length 0.9, spaced with a jitter of at most 0.4 spacing', () => {
  let rocks = 0;
  for (const [l, seed] of lanes(40, 160, 55)) {
    if (l.kind !== 'rocks') continue;
    rocks++;
    const n = l.objs.length;
    assert.ok(n >= Math.floor(1 + l.diff) && n <= Math.floor(3 + l.diff), `seed ${seed} row ${l.r}: ${n} boulders`);
    const spacing = l.span / n, base = l.objs[0].x0 - l.objs[0].jitter;
    l.objs.forEach((o, i) => { assert.equal(o.len, 0.9); near(o.x0 - o.jitter - base, i * spacing, 'spacing'); assert.ok(o.jitter >= 0 && o.jitter < spacing * 0.4); });
    assert.ok(base >= -l.span / 2 && base < -l.span / 2 + 3);
  }
  assert.ok(rocks > 30);
});

test('portal and spring: the two portal columns differ and hold nothing; a spring is empty ground; both may hold a coin or power', () => {
  let portals = 0, springs = 0, coins = 0, powers = 0;
  for (const [l] of lanes(60, 200, 95)) {
    if (l.kind === 'portal') { portals++; const [a, b] = l.portals; assert.ok(COLS.includes(a) && COLS.includes(b) && a !== b); if (l.coins.size) { coins++; assert.ok(!l.coins.has(a) && !l.coins.has(b)); } if (l.power) { powers++; assert.ok(l.power.x !== a && l.power.x !== b); } }
    if (l.kind === 'spring') { springs++; assert.equal(l.objs.length, 0); assert.equal(l.trees.size, 0); if (l.coins.size) coins++; if (l.power) powers++; }
  }
  assert.ok(portals > 20 && springs > 20 && coins > 10 && powers > 3, `${portals} ${springs} ${coins} ${powers}`);
});

test('rail: the train, its schedule and its warning; a boss train is twice as long, faster, with more warning', () => {
  assert.deepEqual([TRAIN_CARS, TRAIN_CAR_LEN, TRAIN_GAP], [4, 3, 0.15]);
  near(trainLen(4), 12.45, 'four cars');
  near(trainLen(8), 24.9 + 0.15, 'eight cars: one more gap');
  let rails = 0, bosses = 0;
  for (const [l, , g] of lanes(30, 250)) {
    if (l.kind !== 'rail') continue;
    rails++;
    const cars = l.boss ? 8 : 4, speed = TRAIN_SPEED * (l.boss ? 1.25 : 1);
    assert.equal(l.cars, cars);
    assert.equal(l.speed, speed);
    near(l.train.len, trainLen(cars), 'the train is as long as its cars');
    assert.deepEqual([l.train.x, l.train.active, l.warned], [99, false, false]);
    near(l.warn, TRAIN_WARN * (l.boss ? 1.7 : 1), 'warning');
    near(l.pass, (2 * WRAP + l.train.len + 5) / speed, 'seconds on the track');
    assert.ok(l.nextStart >= 2 && l.nextStart < 6, 'the first train comes 2 to 6 s in: ' + l.nextStart);
    near(l.nextEnd, l.nextStart + l.pass, 'nextEnd');
    assert.equal(typeof l.rng, 'function');
    if (l.boss) bosses++;
    // another lane's schedule draws differ; the same lane gives the same draws every time
    const again = g.lane(l.r);
    assert.equal(again.rng(), l.rng(), 'the schedule is seeded by the lane');
    assert.equal(l.coins.size, 0);
  }
  assert.ok(rails > 50 && bosses >= 20, `${rails} rails, ${bosses} boss trains`);
  // seed 42: the rails of the first 80 rows and their first draws (pinned from the current generator)
  const g = createWorldGen(42, 3), seen = [];
  for (let r = 0; r < 80; r++) { const l = g.lane(r); if (l.kind === 'rail') seen.push([r, Math.round(l.nextStart * 1e6) / 1e6, Math.round(l.rng() * 1e6) / 1e6]); }
  assert.deepEqual(seen, [[38, 2.806245, 0.033943], [41, 3.726006, 0.743125], [64, 4.263274, 0.117131], [65, 5.368614, 0.041583], [66, 4.821153, 0.512645]]);
  assert.notEqual(createWorldGen(42, 3).lane(38).rng(), createWorldGen(43, 3).lane(38).rng(), 'the seed is in the schedule too');
});

test('railStep: trains come on the schedule, cross from the far side at lane speed, and the gaps shrink with difficulty', () => {
  const g = createWorldGen(42, 3), l = g.lane(38);
  const start = l.nextStart, pass = l.pass;
  assert.equal(railStep(l, start - 0.01), false, 'waiting');
  assert.equal(l.train.x, 99, 'not moved');
  assert.equal(railStep(l, start), true);
  near(l.train.x, -l.dir * (WRAP + l.train.len / 2 + 2), 'it enters from the far side');
  assert.equal(railStep(l, start + 1), true);
  near(l.train.x, -l.dir * (WRAP + l.train.len / 2 + 2) + l.dir * l.speed, 'a second later: lane speed');
  assert.equal(l.nextStart, start, 'the schedule did not move');
  assert.equal(railStep(l, start + pass - 0.001), true, 'still on the track');
  l.warned = true;
  assert.equal(railStep(l, start + pass), false, 'gone: the next is scheduled');
  assert.equal(l.warned, false, 'the next train has not warned yet');
  const gap = l.nextStart - (start + pass);
  assert.ok(gap >= 3.5 - l.diff * 2 && gap < 8 - l.diff * 4, 'the gap between trains: ' + gap);
  near(l.nextEnd, l.nextStart + pass, 'nextEnd follows');
  // far ahead in time the schedule is walked train by train: every gap fits the formula
  let prevEnd = l.nextEnd;
  for (let i = 0; i < 50; i++) { railStep(l, prevEnd); const gp = l.nextStart - prevEnd; assert.ok(gp >= 3.5 - l.diff * 2 && gp < 8 - l.diff * 4); prevEnd = l.nextEnd; }
  // at full difficulty the gaps are 1.5 to 4 s
  let farRow = 200; while (g.lane(farRow).kind !== 'rail') farRow++;
  const far = g.lane(farRow);
  railStep(far, 1000);
  for (let i = 0, e = far.nextEnd; i < 30; i++) { railStep(far, e); const gp = far.nextStart - e; assert.ok(gp >= 1.5 && gp < 4, 'far out: ' + gp); e = far.nextEnd; }
  // the same world time gives the same answer however often it runs (a replay)
  const a = g.lane(41), b = g.lane(41);
  for (let w = 0; w < 60; w += 0.37) railStep(a, w);
  const wa = railStep(a, 59.94), wb = railStep(b, 59.94);
  assert.deepEqual([a.nextStart, a.nextEnd, wa], [b.nextStart, b.nextEnd, wb]);
  const on = b.nextStart + 0.5;   // while the next train is on the track its place is the same from both
  assert.deepEqual([railStep(a, on), a.train.x], [railStep(b, on), b.train.x]);
  assert.equal(railStep(b, on), true);
});

test('standColumns: pads and planks sorted, grass and ice without trees, null elsewhere; standGroups', () => {
  assert.deepEqual(standColumns({ kind: 'lily', pads: new Set([3, -3, -4, 2, 0]) }), [-4, -3, 0, 2, 3], 'sorted as numbers, not text');
  assert.deepEqual(standColumns({ kind: 'bridge', planks: new Map([[2, 1], [-3, 1], [-4, 1], [1, 1]]) }), [-4, -3, 1, 2]);
  assert.deepEqual(standColumns({ kind: 'grass', trees: new Set([-4, 0, 9]) }), [-3, -2, -1, 1, 2, 3, 4]);
  assert.deepEqual(standColumns({ kind: 'ice', trees: new Set([2]) }), [-4, -3, -2, -1, 0, 1, 3, 4]);
  for (const kind of ['road', 'river', 'mud', 'rail', 'rocks', 'spring', 'portal', 'cliff']) assert.equal(standColumns({ kind }), null, kind);
  assert.deepEqual(standGroups([]), []);
  assert.deepEqual(standGroups([1]), [[1]]);
  assert.deepEqual(standGroups([1, 2]), [[1, 2]]);
  assert.deepEqual(standGroups([1, 3]), [[1], [3]]);
  assert.deepEqual(standGroups([-4, -3, -2, -1, 0, 1, 2, 3, 4]), [COLS]);
});

test('connectRow: a lily row after lily pads gets a pad over every group; a tree over a pad is felled; nothing changes behind a road', () => {
  // seeds where a lily row follows a lily row, or grass follows lily: the pads / felled trees of the row after
  let padOverPad = 0, felled = 0, plankAdded = 0;
  for (const [l, seed, g] of lanes(120, 120, 2)) {
    const before = g.lane(l.r - 1), prevStand = standColumns(before);
    if (prevStand === null) continue;
    const groups = standGroups(prevStand);
    if (l.kind === 'lily') { for (const gr of groups) assert.ok(gr.some(x => l.pads.has(x)), `seed ${seed} row ${l.r}: a pad over ${gr}`); if (before.kind === 'lily') padOverPad++; }
    if (l.kind === 'bridge') { for (const gr of groups) assert.ok(gr.some(x => l.planks.has(x))); if (groups.length > 1) plankAdded++; }
    if (l.kind === 'grass' || l.kind === 'ice') { for (const gr of groups) assert.ok(gr.some(x => !l.trees.has(x)), `seed ${seed} row ${l.r}: ${gr} walled off`); if (before.kind === 'lily' && groups.length >= 3) felled++; }
  }
  assert.ok(padOverPad > 20 && felled > 5 && plankAdded > 3, `${padOverPad} ${felled} ${plankAdded}`);
  // a lily row after a lily row: the pads of the row before each get a pad over them (the groups are single pads mostly)
  const g = createWorldGen(42), a = g.lane(16), b = g.lane(17);
  assert.deepEqual([a.kind, b.kind], ['lily', 'lily']);
  for (const gr of standGroups(standColumns(a))) assert.ok(gr.some(x => b.pads.has(x)));
});

test('a flood is the river 1.5x faster; the twister row moves at 1.4 + difficulty with one thing of length 0.9', () => {
  let floods = 0, twisters = 0;
  for (const [l, seed] of lanes(30, 300, 100)) {
    if (l.flood) {
      floods++;
      const d = l.diff, f = l.wet ? 1.2 : 1;
      assert.ok(l.speed >= (1.0 + d) * f * 1.5 - 1e-9 && l.speed <= (1.9 + d) * f * 1.5 + 1e-9, `seed ${seed} row ${l.r}: flood speed ${l.speed}`);
      assert.ok(l.speed > (1.9 + d) * f || l.speed >= (1.0 + d) * f * 1.5, 'faster than the river');
    } else if (l.kind === 'river') { const d = l.diff, f = l.wet ? 1.2 : 1; assert.ok(l.speed <= (1.9 + d) * f + 1e-9); }
    if (l.twister) {
      twisters++;
      near(l.speed, 1.4 + l.diff, `seed ${seed} row ${l.r}: twister speed`);
      assert.deepEqual([l.objs.length, l.objs[0].len, l.objs[0].twister], [1, 0.9, true]);
      assert.ok(l.objs[0].x0 >= -l.span / 2 && l.objs[0].x0 < -l.span / 2 + 3);
      assert.equal(l.objs[0].x, l.objs[0].x0);
    } else if (l.kind === 'grass') assert.equal(l.speed, 0);
  }
  assert.ok(floods >= 40 && twisters >= 40, `${floods} floods, ${twisters} twisters`);
});

test('mud looks and other draws that shift the coins after them: pinned for one row, and their shares', () => {
  // seed 42 row 39 is the first mud row: its puddles ({ w, x, dz }) and reeds ({ reed, x }) in draw order
  const g = createWorldGen(42, 3);
  let r = 13; while (g.lane(r).kind !== 'mud') r++;
  assert.equal(r, 39);
  const looks = g.lane(r).mudLooks.map(m => (m.reed ? [m.reed, m.x] : [m.w, +m.x.toFixed(4), +m.dz.toFixed(4)]));
  assert.deepEqual(looks, [[0.3, -12], [0.5, -10.9716, -0.0456], [0.5, -8.9709, -0.1088], [0.5, -9], [0.5, -7], [0.9, -5.7256, 0.0349], [0.5, -6], [0.5, -5], [0.5, -3.7733, -0.2461], [0.5, 0.2707, 0.0921], [0.5, 2.1703, -0.1356], [0.5, 7], [0.3, 8], [0.9, 9.2723, 0.0331], [0.3, 9], [0.3, 11], [0.3, 12]]);
  // over many mud rows: a puddle on about 35% of the 25 columns, a reed on about half of the 16 outside ones
  let reeds = 0, puddles = 0, muds = 0, reedAt12 = 0, puddleLeft = 0, puddleRight = 0;
  for (const [l] of lanes(60, 140, 13)) {
    if (l.kind !== 'mud') continue;
    muds++;
    for (const m of l.mudLooks) {
      if (m.reed) { reeds++; if (m.x === 12) reedAt12++; } else { puddles++; if (m.x - Math.round(m.x) < -0.05) puddleLeft++; if (m.x - Math.round(m.x) > 0.05) puddleRight++; }
    }
  }
  assert.ok(reeds / (muds * 16) > 0.45 && reeds / (muds * 16) < 0.55, 'reeds on about half the outside columns: ' + reeds / (muds * 16));
  assert.ok(puddles / (muds * 25) > 0.3 && puddles / (muds * 25) < 0.4, 'a puddle on about 35% of the columns: ' + puddles / (muds * 25));
  assert.ok(reedAt12 > 0 && puddleLeft > 0 && puddleRight > 0, 'the last column gets reeds; puddles sit left and right of their column');
  // trees reach the last outside column on grass and ice
  let grass12 = 0, ice12 = 0;
  for (const [l] of lanes(60, 140)) { if (l.kind === 'grass' && l.trees.has(-12)) grass12++; if (l.kind === 'ice' && l.trees.has(12)) ice12++; }
  assert.ok(grass12 > 100 && ice12 > 50, `${grass12} ${ice12}`);
  // ice trees in play get denser with difficulty
  const density = (lo, hi) => { let t = 0, n = 0; for (const [l] of lanes(80, hi, lo)) if (l.kind === 'ice') { n++; t += [...l.trees].filter(x => Math.abs(x) <= PLAY_HALF).length; } return t / n; };
  assert.ok(density(25, 60) < density(110, 140), 'more trees on the ice further out');
  // a coin is possible on row 1 (not row 0); every coin is set to true
  let row1 = 0;
  for (let seed = 1; seed <= 60; seed++) { const w = createWorldGen(seed, 3); if (w.lane(1).coins.size) row1++; assert.equal(w.lane(0).coins.size, 0); }
  assert.ok(row1 > 5, 'coins on row 1: ' + row1);
  for (const [l] of lanes(20, 100)) for (const v of l.coins.values()) assert.equal(v, true);
  // bridges start anywhere from the left edge up to where they still end inside the play columns
  let toFour = 0, fromMinusFour = 0;
  for (const [l, , w] of lanes(80, 160, 40)) if (l.kind === 'bridge' && standColumns(w.lane(l.r - 1)) === null) { if (l.planks.has(4)) toFour++; if (l.planks.has(-4)) fromMinusFour++; }
  assert.ok(toFour > 10 && fromMinusFour > 10, `bridges reaching 4: ${toFour}, starting at -4: ${fromMinusFour}`);
  // spring and portal rows each draw their own coin and power-up
  const n = { spring: 0, portal: 0 }, coin = { spring: 0, portal: 0 }, power = { spring: 0, portal: 0 };
  for (const [l] of lanes(100, 220, 95)) if (l.kind in n) { n[l.kind]++; if (l.coins.size) coin[l.kind]++; if (l.power) power[l.kind]++; }
  for (const k of ['spring', 'portal']) {
    assert.ok(n[k] > 150, `${k}: ${n[k]} rows`);
    assert.ok(Math.abs(coin[k] / n[k] - COIN_CHANCE[k]) < 0.06, `${k}: a coin on ${coin[k] / n[k]}`);
    assert.ok(Math.abs(power[k] / n[k] - POWER_CHANCE) < 0.03, `${k}: a power-up on ${power[k] / n[k]}`);
  }
  // the cliff tiles are whole; row 100 itself carries the boss train when it is a rail
  let cliffs = 0, rail100 = 0;
  for (const [l] of lanes(40, 200, 125)) if (l.kind === 'cliff') { cliffs++; for (const t of l.planks.values()) assert.deepEqual(t, { breakAt: -1, backAt: -1 }); }
  for (let seed = 1; seed <= 40; seed++) { const l = createWorldGen(seed, 3).lane(100); if (l.kind === 'rail') { rail100++; assert.equal(l.boss, true, 'seed ' + seed); } }
  assert.ok(cliffs > 30 && rail100 > 0, `${cliffs} ${rail100}`);
});

// ---------- rules 4 worlds ----------
const plain = l => JSON.stringify({ ...l, rng: null }, (k, v) => (v instanceof Set || v instanceof Map ? [...v] : v));
test('rules 4: createWorldGen takes the rules version (the current one by default); rules 2 and 3 build the same worlds, rules 4 others', () => {
  assert.equal(createWorldGen(5).version, RULES);
  assert.equal(createWorldGen(5, 3).version, 3);
  let same = 0, differ = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a = createWorldGen(seed, 2), b = createWorldGen(seed, 3), c = createWorldGen(seed, 4), d = createWorldGen(seed);
    for (let r = -8; r < 160; r++) {
      assert.equal(plain(a.lane(r)), plain(b.lane(r)), `seed ${seed} row ${r}: rules 2 = rules 3`);
      assert.equal(plain(c.lane(r)), plain(d.lane(r)), 'the default is rules 4');
      if (plain(b.lane(r)) === plain(c.lane(r))) same++; else differ++;
    }
  }
  assert.ok(differ > same, `rules 4 worlds are other worlds: ${differ} rows differ, ${same} alike`);
});

test('rules 4: the late kinds from rows 20/30/40/50/60/75, a boss moment per 50 rows from row 50, still ground at least every 7 rows', () => {
  const first = {};
  for (let seed = 1; seed <= 40; seed++) {
    const g = createWorldGen(seed, 4);
    let prev = null, bare = 0;
    const boss = new Set(), tw = new Set(), fl = new Set();
    for (let r = 0; r < 300; r++) {
      const l = g.lane(r);
      if (!(l.kind in first) || r < first[l.kind]) first[l.kind] = r;
      bare = isStill(l.kind) ? 0 : bare + 1;
      assert.ok(bare <= BARE_MAX, `seed ${seed} row ${r}: ${bare} rows without still ground`);
      if (l.boss) { assert.ok(l.kind === 'rail' && r >= 50 && l.bossChunk === Math.floor(r / 50) && !boss.has(l.bossChunk)); boss.add(l.bossChunk); }
      if (l.twister) { assert.ok(l.kind === 'grass' && r >= 50 && l.twisterChunk === Math.floor(r / 50) && !tw.has(l.twisterChunk) && l.objs.length === 1); tw.add(l.twisterChunk); }
      if (l.flood) { assert.ok(l.kind === 'river' && r >= 50 && l.floodChunk === Math.floor(r / 50) && !fl.has(l.floodChunk)); fl.add(l.floodChunk); }
      if (prev && r >= 2) assert.equal(l.streak, l.kind === prev.kind ? prev.streak + 1 : 1);
      if (r >= 1) prev = l;
    }
    // the first grass and river rows of every 50-row block from 50 carry the twister and the flood
    for (let r = 50; r < 300; r++) {
      const l = g.lane(r), k = Math.floor(r / 50);
      if (l.kind === 'grass' && !tw.has(-k)) { assert.ok(l.twister, `seed ${seed}: the first grass of block ${k} (row ${r})`); tw.add(-k); }
      if (l.kind === 'river' && !fl.has(-k)) { assert.ok(l.flood, `seed ${seed}: the first river of block ${k} (row ${r})`); fl.add(-k); }
    }
    assert.ok(boss.size >= 3, `seed ${seed}: boss trains in blocks ${[...boss]}`);
  }
  for (const [kind, from] of Object.entries(kindFrom(4))) assert.ok(first[kind] >= from && first[kind] < from + 25, `${kind} first at ${first[kind]} (from ${from})`);
});

test('rules 4: a power-up on a bomb row (12, 16, 20...) BOMB_POWER_BOOST times as often; other rows as before', () => {
  const n = { bomb: 0, bombRows: 0, other: 0, otherRows: 0 };
  for (const [l] of lanes(400, 120, 11, 4)) {
    if (!['grass', 'road', 'mud', 'ice', 'rocks', 'spring', 'portal'].includes(l.kind)) continue;
    if (isBombRow(l.r, 4)) { n.bombRows++; if (l.power) n.bomb++; } else { n.otherRows++; if (l.power) n.other++; }
  }
  assert.ok(Math.abs(n.bomb / n.bombRows - POWER_CHANCE * BOMB_POWER_BOOST) < 0.03, 'bomb rows: ' + JSON.stringify(n));
  assert.ok(Math.abs(n.other / n.otherRows - POWER_CHANCE) < 0.012, 'other rows: ' + JSON.stringify(n));
  // rules 3 (and the rows of a rules 3 world past 20): no boost
  let p3 = 0, r3 = 0;
  for (const [l] of lanes(400, 120, 21, 3)) if (isBombRow(l.r, 3) && ['grass', 'road', 'mud', 'ice', 'rocks'].includes(l.kind)) { r3++; if (l.power) p3++; }
  assert.ok(Math.abs(p3 / r3 - POWER_CHANCE) < 0.025, `rules 3 bomb rows: ${p3} / ${r3}`);
});
