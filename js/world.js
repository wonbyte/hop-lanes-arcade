import { sfx } from './audio.js';
import { COIN_CHANCE, FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, POWER_CHANCE, STEP, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty } from './core.js';
import { hashString, mulberry32, nextLaneKind } from './rules.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { CAR_COLORS, LIGHT_OFF, LIGHT_ON, POLICE_BLUE, POLICE_RED, TRAIN_CARS, coinBoxes, lightGeo, logBoxes, magnetBoxes, policeBoxes, shieldBoxes, trainBoxes, trainLen, vehicleBoxes } from './models.js';
import { dailySeed } from './storage.js';
import { cachedGeo, mergeBoxes, voxelMat, voxelMesh } from './voxel.js';

// Lanes: building, scrolling, traffic, trains and coins. Seeded, so a seed always gives the same world.
// ---------- random ----------
// The world is built from a seeded generator (rules.js), so a seed always gives the same lanes.
// Traffic and trains are a function of the world clock (G.worldTick), not of frames: a lane built late, on a
// bigger screen or in a replay is exactly where it would be anyway. Effects (particles) use Math.random.
let worldSeed = 0, worldRng = Math.random;
const rand = (a, b, r = worldRng) => a + r() * (b - a);
const pick = (arr, r = worldRng) => arr[Math.floor(r() * arr.length)];
const fxRand = (a, b) => rand(a, b, Math.random);

// ---------- world ----------
const lanes = new Map();
let maxRow = FIRST_ROW - 1;
const worldGroup = new THREE.Group();
scene.add(worldGroup);
let lastKind = 'grass', streak = 0, bossChunk = 0;

function laneKind(r) {
  const k = nextLaneKind(r, difficulty(r), { kind: lastKind, streak }, worldRng);
  streak = k === lastKind ? streak + 1 : 1;
  lastKind = k;
  return k;
}

// ---------- the fleet: every car, log and train of one model is one instanced draw call ----------
// A plain mesh per vehicle meant ~100 draw calls (x2 with the shadow pass). An InstancedMesh draws all
// vehicles of one model at once; each lane only writes its instances' matrices when they move.
const fleet = new Map();   // model key -> { mesh, top, free }
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
function fleetMesh(geo, cap, cast) {
  const mesh = new THREE.InstancedMesh(geo, voxelMat, cap);
  // every fleet mesh carries instance colors (white = no tint): r128 picks the shader per material, not per
  // mesh, so a mesh without them would get a shader that expects them. Sized for cap, not count.
  mesh.instanceColor = new THREE.BufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  mesh.castShadow = cast; mesh.receiveShadow = true;
  mesh.frustumCulled = false;   // instances spread over many rows; the camera decides per vertex
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}
// an instance handle: set(x, y, z, rotY, visible) writes its matrix; drop() frees the slot.
// color (optional) tints the model's pure white boxes for this instance only.
const tint = new THREE.Color();
class Inst {
  constructor(key, build, cast, color) {
    let f = fleet.get(key);
    if (!f) { f = { mesh: fleetMesh(cachedGeo(key, build), 32, cast), top: 0, free: [] }; fleet.set(key, f); }
    if (!f.free.length && f.top === f.mesh.instanceMatrix.count) {   // full: a bigger mesh takes over the slots
      const big = fleetMesh(f.mesh.geometry, f.top * 2, f.mesh.castShadow);
      big.instanceMatrix.array.set(f.mesh.instanceMatrix.array);
      big.instanceColor.array.set(f.mesh.instanceColor.array);
      scene.remove(f.mesh); f.mesh.dispose();
      f.mesh = big;
    }
    this.f = f;
    this.i = f.free.length ? f.free.pop() : f.top++;
    f.mesh.count = f.top;
    if (color !== undefined) { f.mesh.setColorAt(this.i, tint.setHex(color)); f.mesh.instanceColor.needsUpdate = true; }
    this.set(0, 0, 0, 0, false);
  }
  set(x, y, z, rotY = 0, visible = true) {
    tmpP.set(x, y, z); tmpQ.setFromAxisAngle(Y_AXIS, rotY); tmpS.setScalar(visible ? 1 : 0);
    this.f.mesh.setMatrixAt(this.i, tmpM.compose(tmpP, tmpQ, tmpS));
    this.f.mesh.instanceMatrix.needsUpdate = true;
  }
  // move only: rotation and scale stay as the last set() left them (cheap: no matrix compose)
  move(x, y, z) {
    const a = this.f.mesh.instanceMatrix.array, k = this.i * 16;
    a[k + 12] = x; a[k + 13] = y; a[k + 14] = z;
    this.f.mesh.instanceMatrix.needsUpdate = true;
  }
  paint(color) { this.f.mesh.setColorAt(this.i, tint.setHex(color)); this.f.mesh.instanceColor.needsUpdate = true; }
  drop() { this.set(0, 0, 0, 0, false); this.f.free.push(this.i); }
}

// moving things in a lane share one wrap span so their gaps never drift
function fillTraffic(lane, count, z, makeObj) {
  const spacing = lane.span / count;
  const x0 = rand(-lane.span / 2, -lane.span / 2 + 3);
  for (let i = 0; i < count; i++) {
    const o = makeObj(spacing);
    o.x = o.x0 = x0 + i * spacing + (o.jitter || 0);   // x0: where it is at world time 0
    o.z = z;
    o.inst.set(o.x, 0, z, o.rot || 0);
    lane.objs.push(o);
  }
}

// a coin on one free column of the lane; collected when a player lands on it.
// Coins and power-ups are instanced too; `spinners` turns them once per drawn frame.
const spinners = new Set();
function spinner(lane, key, build, x, z) {
  const s = { inst: new Inst(key, build, false), lane, x, z };
  s.inst.set(x, 0, z);
  spinners.add(s);
  return s;
}
function dropSpinner(s) { s.inst.drop(); spinners.delete(s); }
function spinAll(now) {
  const rot = now / 300;
  for (const s of spinners) if (s.lane.shown) s.inst.set(s.x, 0, s.z, rot);
}
function placeCoin(lane, z, cols) {
  if (!cols.length) return;
  const x = pick(cols);
  lane.coins.set(x, spinner(lane, 'coin', coinBoxes, x, z));
}
const playColumns = () => Array.from({ length: PLAY_HALF * 2 + 1 }, (_, i) => i - PLAY_HALF);
// a power-up (shield or magnet) on a free column, now and then past row 10
function placePower(lane, r, z, cols) {
  if (r <= 10 || !cols.length || worldRng() >= POWER_CHANCE) return;
  const kind = worldRng() < 0.5 ? 'shield' : 'magnet';
  const x = pick(cols.filter(c => !lane.coins.has(c)));
  if (x === undefined) return;
  lane.power = { x, kind, s: spinner(lane, kind, kind === 'shield' ? shieldBoxes : magnetBoxes, x, z) };   // turns like a coin
}
// weather by 40-row chunk, seeded: rain (snow in December) from row 20 on; it changes the look and the traffic
let snowSeason = new Date().getMonth() === 11;
function weatherAt(r) {
  if (r < 20) return '';
  const chunk = Math.floor(r / 40);
  const roll = mulberry32((worldSeed ^ Math.imul(chunk + 7, 0x85ebca6b)) >>> 0)();
  return roll < 0.25 ? (snowSeason ? 'snow' : 'rain') : '';
}

// One builder per lane type. Each adds its static boxes to `ground` (merged into one mesh later)
// and its moving parts to lane.group / lane.objs.
const LANE_BUILDERS = {
  grass(lane, { r, z, diff, ground }) {
    const snow = weatherAt(r) === 'snow';
    ground.push([40, 0.3, 1, snow ? (r % 2 ? 0xe6eef7 : 0xdbe6f2) : r % 2 ? 0xb7e05a : 0xaedb4f, 0, -0.3, z]);
    // now and then a hidden column just past the edge holds a coin worth three
    lane.secret = r > 5 && worldRng() < 0.12 ? (worldRng() < 0.5 ? -1 : 1) * (PLAY_HALF + 1) : null;
    let inPlay = 0;
    for (let x = -12; x <= 12; x++) {
      const out = Math.abs(x) > PLAY_HALF;
      // column 0 never gets a tree, so there is always a way forward
      const tree = out ? x !== lane.secret && worldRng() < 0.85
        : r > 1 && x !== 0 && inPlay < 4 && worldRng() < 0.16 + diff * 0.08;
      if (!tree) continue;
      if (!out) inPlay++;
      lane.trees.add(x);
      ground.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.72, pick([0.6, 0.9, 1.2, 1.5]), 0.72, snow ? 0xd4e6ec : 0xa9cf3a, x, 0.3, z]);
    }
    const free = playColumns().filter(x => !lane.trees.has(x));
    if (r >= 1 && worldRng() < COIN_CHANCE.grass) placeCoin(lane, z, free);
    if (lane.secret !== null) placeCoin(lane, z, [lane.secret]);
    placePower(lane, r, z, free);
  },
  road(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x4a4f5c, 0, -0.3, z]);
    if (prev && prev.kind === 'road')
      for (let x = -12; x <= 12; x += 2) ground.push([0.8, 0.02, 0.08, 0xe8e8e8, x, 0, z + 0.5]);
    lane.speed = (rand(1.6, 2.8) + diff * 2.4) * (weatherAt(lane.r) ? 1.1 : 1);   // rain or snow: drivers hurry (same in any month)
    // further out, some roads are police chases: faster, with flashing lights
    lane.police = diff > 0.3 && worldRng() < 0.22;
    if (lane.police) lane.speed += 1.6;
    const truck = !lane.police && worldRng() < 0.3, len = truck ? 2.4 : 1.4;
    const rot = lane.dir > 0 ? Math.PI : 0;   // vehicle models face -x; turn them to face where they drive
    fillTraffic(lane, Math.floor(rand(2, 4) + diff * 1.5), z, spacing => {
      const c = pick(CAR_COLORS);
      const inst = lane.police ? new Inst('police', policeBoxes, true) : new Inst(truck ? 'truck' : 'car', () => vehicleBoxes(truck), true, c);
      const o = { inst, rot, len, jitter: rand(0, spacing * 0.35) };
      if (lane.police) { o.light = new THREE.Mesh(lightGeo, POLICE_RED); o.light.position.set(0, 0.98, z); lane.group.add(o.light); }
      return o;
    });
    if (worldRng() < COIN_CHANCE.road) placeCoin(lane, z, playColumns());
    placePower(lane, lane.r, z, playColumns());
  },
  river(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z]);
    if (prev && prev.kind === 'river') lane.dir = -prev.dir;
    lane.speed = (rand(1.0, 1.9) + diff * 1.0) * (weatherAt(lane.r) ? 1.2 : 1);   // rain or snow: faster water
    fillTraffic(lane, Math.max(3, Math.floor(rand(4, 6) - diff * 2)), z, () => {
      const len = pick([2, 3, 3, 4]) - (diff > 0.6 && worldRng() < 0.5 ? 1 : 0);
      return { inst: new Inst('log' + len, () => logBoxes(len), false), len };   // flat on the water, no shadow
    });
  },
  // lily pads: still water with pads at a few columns; land on water and you sink
  lily(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z]);
    lane.pads = new Set();
    const cols = playColumns();
    const count = Math.floor(rand(3, 6));
    while (lane.pads.size < count) lane.pads.add(pick(cols));
    for (const x of lane.pads) ground.push([0.78, 0.08, 0.78, 0x3f9f4a, x, -0.12, z], [0.2, 0.09, 0.2, 0xe66d8c, x + 0.2, -0.12, z - 0.2]);
    if (worldRng() < COIN_CHANCE.lily) placeCoin(lane, z, [...lane.pads]);
  },
  // mud: safe, but a hop out of it is slow (rules.js hopTime), so the scroll line catches up
  mud(lane, { r, z, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0x7a5536 : 0x74502f, 0, -0.3, z]);
    for (let x = -12; x <= 12; x++) {
      if (worldRng() < 0.35) ground.push([pick([0.5, 0.7, 0.9]), 0.02, 0.5, 0x5e3f24, x + rand(-0.3, 0.3), 0, z + rand(-0.25, 0.25)]);   // puddles
      if (Math.abs(x) > PLAY_HALF && worldRng() < 0.5) ground.push([0.3, pick([0.3, 0.5]), 0.3, 0x8a7a3a, x, 0, z]);   // reeds
    }
    if (worldRng() < COIN_CHANCE.mud) placeCoin(lane, z, playColumns());
    placePower(lane, r, z, playColumns());
  },
  rail(lane, { r, z, ground }) {
    ground.push([40, 0.3, 1, 0x7b6f6a, 0, -0.3, z]);
    // the first rail past each 100 rows carries the boss train: twice as long, faster, more warning
    lane.boss = r >= 100 && Math.floor(r / 100) > bossChunk;
    if (lane.boss) bossChunk = Math.floor(r / 100);
    const cars = lane.boss ? TRAIN_CARS * 2 : TRAIN_CARS;
    for (let x = -14; x <= 14; x += 0.7) ground.push([0.18, 0.06, 0.9, 0x5a3d2a, x, 0, z]);
    const poleX = PLAY_HALF + 0.6;
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28],
                [0.12, 1.3, 0.12, 0xeeeeee, poleX, 0, z + 0.45]);
    lane.light = new THREE.Mesh(lightGeo, LIGHT_OFF);
    lane.light.position.set(poleX, 1.2, z + 0.45);
    lane.group.add(lane.light);
    // the train schedule is seeded per lane and runs on world time: trains come at the same moments in a replay
    const rng = mulberry32((worldSeed ^ Math.imul(r + 1000, 0x9e3779b1)) >>> 0);
    const speed = TRAIN_SPEED * (lane.boss ? 1.25 : 1), len = trainLen(cars);
    const first = rand(2, 6);
    Object.assign(lane, { timer: first, warned: false, lastBell: -1, rng, speed, warn: TRAIN_WARN * (lane.boss ? 1.7 : 1),
      pass: (2 * WRAP + len + 5) / speed, nextStart: first });   // pass: seconds a train is on the track
    lane.nextEnd = lane.nextStart + lane.pass;
    lane.train = { inst: new Inst('train' + lane.dir + cars, () => trainBoxes(lane.dir, cars), true), len, x: 99, active: false };
  }
};

function addLane(r) {
  const kind = laneKind(r);
  const lane = {
    r, kind, group: new THREE.Group(), objs: [], trees: new Set(), coins: new Map(), shown: true,
    dir: worldRng() < 0.5 ? 1 : -1, speed: 0, span: WRAP * 2 + 4
  };
  const ground = [];
  LANE_BUILDERS[kind](lane, { r, z: -r, diff: difficulty(r), prev: lanes.get(r - 1), ground });
  // unique per lane, disposed with the lane; flat ground does not cast shadows, trees and the rail pole do
  lane.ground = voxelMesh(mergeBoxes(ground), kind === 'grass' ? lane.trees.size > 0 : kind === 'rail');
  lane.ground.matrixAutoUpdate = false;
  lane.ground.updateMatrix();
  lane.group.add(lane.ground);
  worldGroup.add(lane.group);
  lanes.set(r, lane);
  maxRow = Math.max(maxRow, r);
}

function dropLane(lane) {
  worldGroup.remove(lane.group);
  for (const o of lane.objs) o.inst.drop();
  if (lane.train) lane.train.inst.drop();
  if (lane.power) dropSpinner(lane.power.s);
  for (const s of lane.coins.values()) dropSpinner(s);
  lane.ground.geometry.dispose();
  lanes.delete(lane.r);
}

const near = r => G.state === 'play' && Math.abs(r - (G.camRow + G.camLead)) < G.visRows;   // rails on screen

// traffic at world time w (seconds): where it started plus speed x time, wrapped
function moveTraffic(lane, w) {
  const half = lane.span / 2, travel = lane.dir * lane.speed * w, river = lane.kind === 'river', now = w * 1000;
  for (const o of lane.objs) {
    const x = o.x0 + travel + half;
    o.x = x - Math.floor(x / lane.span) * lane.span - half;
    o.inst.move(o.x, river ? Math.sin(now / 400 + o.x) * 0.02 : 0, o.z);
    if (o.light) { o.light.position.x = o.x + (lane.dir > 0 ? -0.08 : 0.08); o.light.material = Math.floor(now / 140) % 2 ? POLICE_RED : POLICE_BLUE; }
  }
}
// the rail at world time w: walk the seeded schedule forward, then the train is either waiting or passing
function updateRail(lane, w) {
  const tr = lane.train;
  while (w >= lane.nextEnd) {   // trains that have passed; far out, trains come twice as often
    const diff = difficulty(lane.r);
    lane.nextStart = lane.nextEnd + rand(3.5 - diff * 2, 8 - diff * 4, lane.rng);
    lane.nextEnd = lane.nextStart + lane.pass;
    lane.warned = false;
  }
  const active = w >= lane.nextStart;
  let on;
  if (!active) {
    lane.timer = lane.nextStart - w;
    const blink = Math.floor(lane.timer * BLINK_STEPS);
    on = lane.timer < lane.warn && blink % 2 === 0;
    if (lane.timer < lane.warn && !lane.warned) { lane.warned = true; if (near(lane.r)) { sfx.horn(); if (lane.boss) setTimeout(sfx.horn, 600); } }
    if (on && blink !== lane.lastBell && near(lane.r)) { lane.lastBell = blink; sfx.bell(); }
  } else {
    tr.x = -lane.dir * (WRAP + tr.len / 2 + 2) + lane.dir * lane.speed * (w - lane.nextStart);
    on = Math.floor(w * BLINK_STEPS) % 2 === 1;
  }
  if (active !== tr.active) { tr.active = active; tr.inst.set(tr.x, 0, -lane.r, 0, active && lane.shown); }
  else if (active) tr.inst.move(tr.x, 0, -lane.r);
  lane.light.material = on ? LIGHT_ON : LIGHT_OFF;
}
function updateLanes() {
  const w = G.worldTick * STEP;
  for (const lane of lanes.values()) {
    if (lane.kind === 'road' || lane.kind === 'river') moveTraffic(lane, w);
    else if (lane.kind === 'rail') updateRail(lane, w);
  }
}
// lanes far from the camera are not drawn; their instances (cars, logs, train, coins) are hidden too
function showLane(lane, on) {
  if (lane.shown === on) return;
  lane.shown = on;
  lane.group.visible = on;
  for (const o of lane.objs) o.inst.set(o.x, 0, o.z, o.rot || 0, on);
  if (lane.train) lane.train.inst.set(lane.train.x, 0, -lane.r, 0, on && lane.train.active);
  for (const s of lane.coins.values()) s.inst.set(s.x, 0, s.z, 0, on);
  if (lane.power) lane.power.s.inst.set(lane.power.x, 0, -lane.r, 0, on);
}

// Visible rows are built at once; rows further ahead are added one per frame, so a restart
// or a fast run never builds many lanes in a single frame.
const lastNeededRow = () => Math.ceil(G.camRow + G.camLead + G.visRows);
const firstNeededRow = () => Math.min(G.camRow - LANES_BEHIND, Math.floor(G.camRow + G.camLead - G.visRows));
function resetWorld() {
  for (const lane of [...lanes.values()]) dropLane(lane);
  worldSeed = G.replay ? G.replay.seed : FIXED_SEED !== null ? FIXED_SEED
    : G.mode === 'daily' ? dailySeed() : G.mode === 'room' ? hashString('room:' + G.room) : (Math.random() * 4294967296) >>> 0;
  worldRng = mulberry32(worldSeed);
  G.worldTick = 0;
  snowSeason = new Date().getMonth() === 11;
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1; lastKind = 'grass'; streak = 0; bossChunk = 0;
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
}
function ensureLanes() {
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
  // keep a few rows built ahead of the screen edge, so a lane is never built in the frame it appears
  if (maxRow < Math.max(G.camRow + LANES_AHEAD, lastNeededRow() + 6)) addLane(maxRow + 1);
  const first = firstNeededRow();
  for (const lane of lanes.values()) if (lane.r < first) dropLane(lane);
}

const getSeed = () => worldSeed;
// test hooks
function laneCoins(r) { const l = lanes.get(r); return l ? [...l.coins.keys()] : []; }
function laneKinds() {   // lane types for rows 0..30 (builds missing rows ahead first)
  while (maxRow < 30) addLane(maxRow + 1);
  const out = [];
  for (let r = 0; r <= 30; r++) out.push(lanes.get(r).kind);
  return out;
}

export { Inst, LANE_BUILDERS, addLane, dropLane, dropSpinner, ensureLanes, fillTraffic, firstNeededRow, fleet, fxRand, getSeed, laneCoins, laneKind, laneKinds, lanes, lastNeededRow, moveTraffic, near, pick, placeCoin, placePower, playColumns, rand, resetWorld, showLane, spinAll, spinners, updateLanes, updateRail, weatherAt, worldGroup };
