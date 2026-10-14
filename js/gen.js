// World generation as data: no DOM, no Three.js. For a world seed and a row this gives everything about that row
// that decides a run (kind, direction, speed, cars, logs, pads, trees, coins, power-ups, the train schedule) plus the
// looks that use the same generator (tree heights, puddles, car paint), so the rng draws stay in one order.
// world.js turns this data into meshes; sim.js (and the score server) play a run on it without a browser.
import { COIN_CHANCE, PLAY_HALF, POWER_CHANCE, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty, mulberry32, nextLaneKind } from './rules.js';

const CAR_COLORS = [0xe8513a, 0x3a8ee8, 0xf2c33a, 0x8f5ae0, 0x3ac27a, 0xf27fb0];
const TRAIN_CARS = 4, TRAIN_CAR_LEN = 3, TRAIN_GAP = 0.15;
const trainLen = cars => cars * TRAIN_CAR_LEN + (cars - 1) * TRAIN_GAP;
const LANE_SPAN = WRAP * 2 + 4;   // moving things in a lane wrap over this width
const genRand = (r, a, b) => a + r() * (b - a);
const genPick = (r, arr) => arr[Math.floor(r() * arr.length)];
const playColumns = () => Array.from({ length: PLAY_HALF * 2 + 1 }, (_, i) => i - PLAY_HALF);

// every row has its own generator from the seed and the row: a row is the same whatever rows were built before it
const rowRng = (seed, r) => mulberry32((seed ^ Math.imul(r + 4096, 0x9e3779b1)) >>> 0);
// the train schedule of a rail row has a generator of its own (it runs on world time, see railStep)
const railSeed = (seed, r) => (seed ^ Math.imul(r + 1000, 0x9e3779b1)) >>> 0;
// rain or snow, by 40-row chunk from row 20 on (world.js picks snow or rain; either makes traffic faster)
function wetAt(seed, r) {
  if (r < 20) return false;
  const chunk = Math.floor(r / 40);
  return mulberry32((seed ^ Math.imul(chunk + 7, 0x85ebca6b)) >>> 0)() < 0.25;
}

function placeCoin(rng, lane, cols) {
  if (!cols.length) return;
  lane.coins.set(genPick(rng, cols), true);
}
// a power-up (shield or magnet) on a free column, now and then past row 10
function placePower(rng, lane, cols) {
  if (lane.r <= 10 || !cols.length || rng() >= POWER_CHANCE) return;
  const kind = rng() < 0.5 ? 'shield' : 'magnet';
  const x = genPick(rng, cols.filter(c => !lane.coins.has(c)));
  if (x === undefined) return;
  lane.power = { x, kind };
}
// moving things in a lane share one wrap span so their gaps never drift; x0 is where one is at world time 0
function fillObjs(rng, lane, count, make) {
  const spacing = lane.span / count;
  const x0 = genRand(rng, -lane.span / 2, -lane.span / 2 + 3);
  for (let i = 0; i < count; i++) {
    const o = make(spacing);
    o.x = o.x0 = x0 + i * spacing + (o.jitter || 0);
    lane.objs.push(o);
  }
}

// One builder per lane kind. The order of the rng draws here IS the world: never reorder or add a draw before
// another one, or every seed (and every saved replay) changes.
const ROW_BUILDERS = {
  grass(rng, lane) {
    const { r, diff } = lane;
    // now and then a hidden column just past the edge holds a coin worth three
    lane.secret = r > 5 && rng() < 0.12 ? (rng() < 0.5 ? -1 : 1) * (PLAY_HALF + 1) : null;
    lane.treeH = [];
    let inPlay = 0;
    for (let x = -12; x <= 12; x++) {
      const out = Math.abs(x) > PLAY_HALF;
      // column 0 never gets a tree, so there is always a way forward
      const tree = out ? x !== lane.secret && rng() < 0.85
        : r > 1 && x !== 0 && inPlay < 4 && rng() < 0.16 + diff * 0.08;
      if (!tree) continue;
      if (!out) inPlay++;
      lane.trees.add(x);
      lane.treeH.push([x, genPick(rng, [0.6, 0.9, 1.2, 1.5])]);
    }
    const free = playColumns().filter(x => !lane.trees.has(x));
    if (r >= 1 && rng() < COIN_CHANCE.grass) placeCoin(rng, lane, free);
    if (lane.secret !== null) placeCoin(rng, lane, [lane.secret]);
    placePower(rng, lane, free);
  },
  road(rng, lane) {
    const diff = lane.diff;
    lane.speed = (genRand(rng, 1.6, 2.8) + diff * 2.4) * (lane.wet ? 1.1 : 1);   // rain or snow: drivers hurry
    // further out, some roads are police chases: faster, with flashing lights
    lane.police = diff > 0.3 && rng() < 0.22;
    if (lane.police) lane.speed += 1.6;
    const truck = !lane.police && rng() < 0.3, len = truck ? 2.4 : 1.4;
    lane.truck = truck;
    const rot = lane.dir > 0 ? Math.PI : 0;   // vehicle models face -x; turn them to face where they drive
    fillObjs(rng, lane, Math.floor(genRand(rng, 2, 4) + diff * 1.5), spacing => {
      const color = genPick(rng, CAR_COLORS);
      return { rot, len, color, jitter: genRand(rng, 0, spacing * 0.35) };
    });
    if (rng() < COIN_CHANCE.road) placeCoin(rng, lane, playColumns());
    placePower(rng, lane, playColumns());
  },
  river(rng, lane) {   // a river after a river flows the other way (the chain sets lane.dir)
    const diff = lane.diff;
    lane.speed = (genRand(rng, 1.0, 1.9) + diff * 1.0) * (lane.wet ? 1.2 : 1);   // rain or snow: faster water
    fillObjs(rng, lane, Math.max(3, Math.floor(genRand(rng, 4, 6) - diff * 2)), () => {
      const len = genPick(rng, [2, 3, 3, 4]) - (diff > 0.6 && rng() < 0.5 ? 1 : 0);
      return { len };
    });
  },
  // lily pads: still water with pads at a few columns; land on water and you sink
  lily(rng, lane) {
    lane.pads = new Set();
    const cols = playColumns();
    const count = Math.floor(genRand(rng, 3, 6));
    while (lane.pads.size < count) lane.pads.add(genPick(rng, cols));
    if (rng() < COIN_CHANCE.lily) placeCoin(rng, lane, [...lane.pads]);
  },
  // mud: safe, but a hop out of it is slow (rules.js hopTime). Puddles and reeds are looks, drawn from the same rng.
  mud(rng, lane) {
    lane.mudLooks = [];   // in draw order: { w, x, dz } a puddle, { reed: height, x } a reed
    for (let x = -12; x <= 12; x++) {
      if (rng() < 0.35) { const w = genPick(rng, [0.5, 0.7, 0.9]), dx = genRand(rng, -0.3, 0.3); lane.mudLooks.push({ w, x: x + dx, dz: genRand(rng, -0.25, 0.25) }); }
      if (Math.abs(x) > PLAY_HALF && rng() < 0.5) lane.mudLooks.push({ reed: genPick(rng, [0.3, 0.5]), x });
    }
    if (rng() < COIN_CHANCE.mud) placeCoin(rng, lane, playColumns());
    placePower(rng, lane, playColumns());
  },
  rail(rng, lane, seed) {
    // the first rail past each 100 rows carries the boss train: twice as long, faster, more warning (set by the chain)
    lane.cars = lane.boss ? TRAIN_CARS * 2 : TRAIN_CARS;
    const len = trainLen(lane.cars);
    lane.speed = TRAIN_SPEED * (lane.boss ? 1.25 : 1);
    const first = genRand(rng, 2, 6);
    // the schedule is seeded per lane and runs on world time: trains come at the same moments in a replay
    Object.assign(lane, { timer: first, warned: false, rng: mulberry32(railSeed(seed, lane.r)), warn: TRAIN_WARN * (lane.boss ? 1.7 : 1),
      pass: (2 * WRAP + len + 5) / lane.speed, nextStart: first });   // pass: seconds a train is on the track
    lane.nextEnd = lane.nextStart + lane.pass;
    lane.train = { len, x: 99, active: false };
  }
};

// The rows of one world. A row depends on the row before it (runs of one kind, rivers that alternate, one boss train
// per 100 rows), so the chain is walked from row 3 (rows below 4 are always grass) and remembered.
// lane(r) returns a new data object every call: the caller owns its moving state (o.x, coins, the train schedule).
function createWorldGen(seed) {
  const heads = [];   // heads[r - 3]: { kind, streak, dir, bossChunk } after row r
  const GRASS = { kind: 'grass', streak: 1, dir: 1, bossChunk: 0 };
  const headOf = r => {
    if (r < 3) return GRASS;
    while (heads.length <= r - 3) {
      const row = heads.length + 3;
      heads.push(row === 3 ? GRASS : build(row, heads[heads.length - 1], true));
    }
    return heads[r - 3];
  };
  // headOnly: just the chain state (the kind and the direction are the first draws of a row)
  function build(r, prev, headOnly) {
    const rng = rowRng(seed, r);
    const diff = difficulty(r);
    const kind = nextLaneKind(r, diff, prev, rng);
    let dir = rng() < 0.5 ? 1 : -1;
    if (kind === 'river' && prev.kind === 'river') dir = -prev.dir;
    const boss = kind === 'rail' && r >= 100 && Math.floor(r / 100) > prev.bossChunk;
    if (headOnly) return { kind, streak: kind === prev.kind ? prev.streak + 1 : 1, dir, bossChunk: boss ? Math.floor(r / 100) : prev.bossChunk };
    const lane = {
      r, kind, diff, dir, speed: 0, span: LANE_SPAN, wet: wetAt(seed, r), prevKind: prev.kind, boss,
      objs: [], trees: new Set(), coins: new Map(), secret: null, power: null
    };
    ROW_BUILDERS[kind](rng, lane, seed);
    return lane;
  }
  return {
    seed,
    lane: r => build(r, headOf(r - 1), false),
    kind: r => headOf(r).kind
  };
}

// ---------- moving things: a function of the world clock (w = worldTick * STEP seconds) ----------
// traffic and logs at world time w: where it started plus speed x time, wrapped
function trafficX(lane, o, w) {
  const half = lane.span / 2, x = o.x0 + lane.dir * lane.speed * w + half;
  return x - Math.floor(x / lane.span) * lane.span - half;
}
// the rail at world time w: walk the seeded schedule forward (its draws depend on w only, so it is the same however
// often this runs), then the train is either waiting or passing. Sets lane.train.x while passing; returns whether it is.
function railStep(lane, w) {
  while (w >= lane.nextEnd) {   // trains that have passed; far out, trains come twice as often
    lane.nextStart = lane.nextEnd + genRand(lane.rng, 3.5 - lane.diff * 2, 8 - lane.diff * 4);
    lane.nextEnd = lane.nextStart + lane.pass;
    lane.warned = false;
  }
  const active = w >= lane.nextStart;
  if (active) lane.train.x = -lane.dir * (WRAP + lane.train.len / 2 + 2) + lane.dir * lane.speed * (w - lane.nextStart);
  return active;
}

export { CAR_COLORS, LANE_SPAN, TRAIN_CARS, TRAIN_CAR_LEN, TRAIN_GAP, createWorldGen, playColumns, railStep, trafficX, trainLen, wetAt };
