// World generation as data: no DOM, no Three.js. For a world seed and a row this gives everything about that row
// that decides a run (kind, direction, speed, cars, logs, pads, trees, coins, power-ups, the train schedule) plus the
// looks that use the same generator (tree heights, puddles, car paint), so the rng draws stay in one order.
// world.js turns this data into meshes; sim.js (and the score server) play a run on it without a browser.
import { BOMB_POWER_BOOST, COIN_CHANCE, FLOOD_SPEED, PLAY_HALF, POWER_CHANCE, RULES, TRAIN_SPEED, TRAIN_WARN, TWISTER_LEN, WRAP, bossRows, difficulty, isBombRow, isStill, mulberry32, nextLaneKind } from './rules.js';

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
const WET_FROM = 20, WET_CHUNK = 40;
const wetChunk = r => r < WET_FROM ? -1 : Math.floor(r / WET_CHUNK);   // -1: never wet
function wetAt(seed, r) {
  const chunk = wetChunk(r);
  if (chunk < 0) return false;
  return mulberry32((seed ^ Math.imul(chunk + 7, 0x85ebca6b)) >>> 0)() < 0.25;
}

function placeCoin(rng, lane, cols) {
  if (!cols.length) return;
  lane.coins.set(genPick(rng, cols), true);
}
// a power-up (shield or magnet) on a free column, now and then past row 10; rules 4: more often on a bomb row (the
// same one draw, so a world's draws stay in order)
function placePower(rng, lane, cols, version) {
  const chance = version >= 4 && isBombRow(lane.r, version) ? POWER_CHANCE * BOMB_POWER_BOOST : POWER_CHANCE;
  if (lane.r <= 10 || !cols.length || rng() >= chance) return;
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
  grass(rng, lane, seed, version) {
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
    placePower(rng, lane, free, version);
  },
  road(rng, lane, seed, version) {
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
    placePower(rng, lane, playColumns(), version);
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
  mud(rng, lane, seed, version) {
    lane.mudLooks = [];   // in draw order: { w, x, dz } a puddle, { reed: height, x } a reed
    for (let x = -12; x <= 12; x++) {
      if (rng() < 0.35) { const w = genPick(rng, [0.5, 0.7, 0.9]), dx = genRand(rng, -0.3, 0.3); lane.mudLooks.push({ w, x: x + dx, dz: genRand(rng, -0.25, 0.25) }); }
      if (Math.abs(x) > PLAY_HALF && rng() < 0.5) lane.mudLooks.push({ reed: genPick(rng, [0.3, 0.5]), x });
    }
    if (rng() < COIN_CHANCE.mud) placeCoin(rng, lane, playColumns());
    placePower(rng, lane, playColumns(), version);
  },
  // ice (from rules.js ICE_FROM): like grass, fewer (snowy) trees; a sideways hop that lands here slides one more column
  ice(rng, lane, seed, version) {
    const diff = lane.diff;
    lane.treeH = [];
    let inPlay = 0;
    for (let x = -12; x <= 12; x++) {
      const out = Math.abs(x) > PLAY_HALF;
      const tree = out ? rng() < 0.6 : x !== 0 && inPlay < 2 && rng() < 0.08 + diff * 0.06;
      if (!tree) continue;
      if (!out) inPlay++;
      lane.trees.add(x);
      lane.treeH.push([x, genPick(rng, [0.9, 1.2, 1.5])]);
    }
    const free = playColumns().filter(x => !lane.trees.has(x));
    if (rng() < COIN_CHANCE.ice) placeCoin(rng, lane, free);
    placePower(rng, lane, free, version);
  },
  // a bridge (from BRIDGE_FROM) over water: a run of planks, the only safe columns. A plank breaks PLANK_BREAK steps
  // after a player lands on it and is back PLANK_BACK steps later (rules.js plankState; breakAt/backAt in world ticks)
  bridge(rng, lane) {
    const len = Math.floor(genRand(rng, 3, 7));
    const start = -PLAY_HALF + Math.floor(rng() * (PLAY_HALF * 2 + 2 - len));
    lane.planks = new Map();
    for (let i = 0; i < len; i++) lane.planks.set(start + i, { breakAt: -1, backAt: -1 });
    if (rng() < COIN_CHANCE.bridge) placeCoin(rng, lane, [...lane.planks.keys()]);
  },
  // rocks (from ROCKS_FROM): no cars, but a few slow boulders roll across; a hit squashes like a car
  rocks(rng, lane, seed, version) {
    const diff = lane.diff;
    lane.speed = (genRand(rng, 0.8, 1.5) + diff * 1.2) * (lane.wet ? 1.1 : 1);
    fillObjs(rng, lane, Math.floor(genRand(rng, 1, 3) + diff), spacing => ({ len: 0.9, jitter: genRand(rng, 0, spacing * 0.4) }));
    if (rng() < COIN_CHANCE.rocks) placeCoin(rng, lane, playColumns());
    placePower(rng, lane, playColumns(), version);
  },
  // a spring (from SPRING_FROM): a trampoline row; a forward hop out of it lands two rows on (sim.js). Still ground.
  spring(rng, lane, seed, version) {
    if (rng() < COIN_CHANCE.spring) placeCoin(rng, lane, playColumns());
    placePower(rng, lane, playColumns(), version);
  },
  // a portal (from PORTAL_FROM): still ground with two linked columns; landing on one puts you on the other (sim.js)
  portal(rng, lane, seed, version) {
    const cols = playColumns();
    const a = genPick(rng, cols), b = genPick(rng, cols.filter(x => x !== a));
    lane.portals = [a, b];
    const free = cols.filter(x => x !== a && x !== b);
    if (rng() < COIN_CHANCE.portal) placeCoin(rng, lane, free);
    placePower(rng, lane, free, version);
  },
  // a cliff (from CLIFF_FROM): a ledge of stone tiles over a chasm, one per play column. A tile breaks PLANK_BREAK
  // steps after a landing like a plank (rules.js plankState) and never comes back (sim.js sets backAt to Infinity)
  cliff(rng, lane) {
    lane.planks = new Map();
    for (const x of playColumns()) lane.planks.set(x, { breakAt: -1, backAt: -1 });
    if (rng() < COIN_CHANCE.cliff) placeCoin(rng, lane, playColumns());
  },
  rail(rng, lane, seed) {
    // the first rail of each boss block (bossRows: 100 rows, rules 4: 50) carries the boss train: twice as long, faster, more warning (set by the chain)
    lane.cars = lane.boss ? TRAIN_CARS * 2 : TRAIN_CARS;
    const len = trainLen(lane.cars);
    lane.speed = TRAIN_SPEED * (lane.boss ? 1.25 : 1);
    const first = genRand(rng, 2, 6);
    // the schedule is seeded per lane and runs on world time: trains come at the same moments in a replay
    Object.assign(lane, { warned: false, rng: mulberry32(railSeed(seed, lane.r)), warn: TRAIN_WARN * (lane.boss ? 1.7 : 1),
      pass: (2 * WRAP + len + 5) / lane.speed, nextStart: first });   // pass: seconds a train is on the track
    lane.nextEnd = lane.nextStart + lane.pass;
    lane.train = { len, x: 99, active: false };
  }
};

// ---------- a way forward ----------
// The columns of a row a player can stand on (null: every column, or logs that drift anywhere), and the groups of
// them a player can walk between with sideways hops. The row after must give every group a straight hop onto
// something solid, or a player who came in on that group is stuck (pads over pads, planks, trees over pads).
function standColumns(lane) {
  if (lane.kind === 'lily') return [...lane.pads].sort((a, b) => a - b);
  if (lane.kind === 'bridge') return [...lane.planks.keys()].sort((a, b) => a - b);
  if (lane.kind === 'grass' || lane.kind === 'ice') return playColumns().filter(x => !lane.trees.has(x));
  return null;
}
function standGroups(cols) {
  if (!cols) return [playColumns()];
  const groups = [];
  for (const x of cols) {
    const g = groups[groups.length - 1];
    if (g && x === g[g.length - 1] + 1) g.push(x); else groups.push([x]);
  }
  return groups;
}
// make sure every group of the row before meets this row: a pad, a plank or a felled tree on one of its columns
function connectRow(rng, lane, prevStand) {
  if (prevStand === null && lane.kind !== 'lily' && lane.kind !== 'bridge') return;   // anything goes
  const stand = standColumns(lane);
  if (stand === null) return;
  const here = new Set(stand);
  for (const group of standGroups(prevStand)) {
    if (group.some(x => here.has(x))) continue;
    const x = genPick(rng, group);
    if (lane.kind === 'lily') lane.pads.add(x);
    else if (lane.kind === 'bridge') lane.planks.set(x, { breakAt: -1, backAt: -1 });
    else { lane.trees.delete(x); lane.treeH = lane.treeH.filter(t => t[0] !== x); }
    here.add(x);
  }
}

// The rows of one world. A row depends on the row before it (runs of one kind, rivers that alternate, one boss train
// per 100 rows, the columns a player can stand on), so the chain is walked from row 1 and remembered.
// lane(r) returns a new data object every call: the caller owns its moving state (o.x, coins, the train schedule).
// version: the rules version of the run (rules.js RULES when left out): rules 4 builds other worlds (the late kinds
// sooner, a boss moment every 50 rows, a still row at least every BARE_MAX + 1 rows, more bomb rows with power-ups);
// a world of an older version is built with exactly the old draws.
function createWorldGen(seed, version = RULES) {
  const heads = [];   // heads[r - 1]: { kind, streak, dir, bossChunk, twisterChunk, floodChunk, stand, bare } after row r
  const GRASS = { kind: 'grass', streak: 1, dir: 1, bossChunk: 0, twisterChunk: 0, floodChunk: 0, stand: null, bare: 0 };
  const BOSS_ROWS = bossRows(version);
  // the chain state after a row: what the next row's draws depend on
  const headFrom = (lane, prev) => ({ kind: lane.kind, streak: lane.streak, dir: lane.dir, bossChunk: lane.bossChunk, twisterChunk: lane.twisterChunk, floodChunk: lane.floodChunk, stand: standColumns(lane),
    bare: isStill(lane.kind) ? 0 : prev.bare + 1 });   // rows in a row without still ground (rules 4 caps it)
  const headOf = r => {
    if (r < 1) return GRASS;
    while (heads.length < r) {
      const prev = heads.length ? heads[heads.length - 1] : GRASS;
      heads.push(headFrom(build(heads.length + 1, prev), prev));
    }
    return heads[r - 1];
  };
  function build(r, prev) {
    const rng = rowRng(seed, r);
    const diff = difficulty(r);
    const kind = nextLaneKind(r, diff, prev, rng, version);
    let dir = rng() < 0.5 ? 1 : -1;
    if (kind === 'river' && prev.kind === 'river') dir = -prev.dir;
    // boss moments, decided by the chain (no draw): past each BOSS_ROWS rows (100; rules 4: 50) the first rail carries
    // the boss train, the first grass row a twister (one slow thing crossing like traffic) and the first river a flood
    const chunk = Math.floor(r / BOSS_ROWS);
    const boss = kind === 'rail' && r >= BOSS_ROWS && chunk > prev.bossChunk;
    const twister = kind === 'grass' && r >= BOSS_ROWS && chunk > prev.twisterChunk;
    const flood = kind === 'river' && r >= BOSS_ROWS && chunk > prev.floodChunk;
    const lane = {
      r, kind, diff, dir, speed: 0, span: LANE_SPAN, wet: wetAt(seed, r), prevKind: prev.kind, boss, twister, flood,
      streak: kind === prev.kind ? prev.streak + 1 : 1, bossChunk: boss ? chunk : prev.bossChunk,
      twisterChunk: twister ? chunk : prev.twisterChunk, floodChunk: flood ? chunk : prev.floodChunk,
      objs: [], trees: new Set(), coins: new Map(), secret: null, power: null
    };
    ROW_BUILDERS[kind](rng, lane, seed, version);   // nosemgrep: unsafe-dynamic-method -- kind comes from nextLaneKind, a fixed set of lane names
    if (flood) lane.speed *= FLOOD_SPEED;   // no draw: the river's logs are where they always were, only faster
    if (r >= 1) connectRow(rng, lane, prev.stand);   // the draws come after the row's own, so rows before stay as they were
    if (twister) {   // after every other draw of the row (rows below BOSS_ROWS never get here)
      lane.speed = 1.4 + diff;
      fillObjs(rng, lane, 1, () => ({ len: TWISTER_LEN, twister: true }));
    }
    return lane;
  }
  return {
    seed, version,
    // a row built in order records its own head: the next row's chain needs no second build of it (build is pure in
    // seed, r and prev, so the head is the one headOf would make)
    lane: r => { const prev = headOf(r - 1), lane = build(r, prev); if (r === heads.length + 1) heads.push(headFrom(lane, prev)); return lane; },
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

export { wetChunk, TRAIN_CARS, TRAIN_CAR_LEN, TRAIN_GAP, createWorldGen, railStep, standColumns, standGroups, trafficX, trainLen, wetAt };
