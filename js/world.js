import { sfx } from './audio.js';
import { COIN_CHANCE, FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, POWER_CHANCE, STEP, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty } from './core.js';
import { hashString, mulberry32, nextLaneKind } from './rules.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { CAR_COLORS, LIGHT_TINT, TRAIN_CARS, coinBoxes, lightBoxes, logBoxes, magnetBoxes, policeBoxes, shieldBoxes, trainBoxes, trainLen, vehicleBoxes } from './models.js';
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
  // every fleet mesh carries instance colors (white = no tint), so all of them share one shader. Sized for cap, not count.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  mesh.castShadow = cast; mesh.receiveShadow = true;
  mesh.frustumCulled = false;   // instances spread over many rows; the camera decides per vertex
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}
// an instance handle: set(x, y, z, rotY, visible) writes its matrix; drop() frees the slot.
// color (optional) tints the model's pure white boxes for this instance only.
// Slots stay packed: drop() moves the last instance into the freed slot, so the GPU only runs live instances.
const tint = new THREE.Color();
class Inst {
  constructor(key, build, cast, color = 0xffffff) {
    let f = fleet.get(key);
    if (!f) { f = { mesh: fleetMesh(cachedGeo(key, build), 32, cast), top: 0, handles: [] }; fleet.set(key, f); }
    if (f.top === f.mesh.instanceMatrix.count) {   // full: a bigger mesh takes over the slots
      const big = fleetMesh(f.mesh.geometry, f.top * 2, f.mesh.castShadow);
      big.instanceMatrix.array.set(f.mesh.instanceMatrix.array);
      big.instanceColor.array.set(f.mesh.instanceColor.array);
      scene.remove(f.mesh); f.mesh.dispose();
      f.mesh = big;
    }
    this.f = f;
    this.i = f.top++;
    f.handles[this.i] = this;
    f.mesh.count = f.top;
    this.paint(color);
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
  drop() {
    const f = this.f, last = --f.top, m = f.mesh;
    if (this.i !== last) {   // the last instance takes this slot
      m.instanceMatrix.array.copyWithin(this.i * 16, last * 16, last * 16 + 16);
      m.instanceColor.array.copyWithin(this.i * 3, last * 3, last * 3 + 3);
      const moved = f.handles[last];
      moved.i = this.i; f.handles[this.i] = moved;
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    }
    f.handles[last] = undefined;
    m.count = f.top;
    this.i = -1;
  }
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
const rippleBoxes = () => [[0.5, 0.02, 0.07, 0xd8f3ff, 0, -0.15, 0], [0.22, 0.02, 0.07, 0xd8f3ff, 0.5, -0.15, 0]];
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
const weatherCache = new Map();   // 40-row chunk -> weather (asked every drawn frame; cleared with the world)
function weatherAt(r) {
  if (r < 20) return '';
  const chunk = Math.floor(r / 40);
  let w = weatherCache.get(chunk);
  if (w === undefined) {
    const roll = mulberry32((worldSeed ^ Math.imul(chunk + 7, 0x85ebca6b)) >>> 0)();
    weatherCache.set(chunk, w = roll < 0.25 ? (snowSeason ? 'snow' : 'rain') : '');
  }
  return w;
}
// signal lights (rail crossing, police) are instances of one light model, painted per instance (LIGHT_TINT)
const LIGHT_Y_CAR = 0.88, LIGHT_Y_RAIL = 1.1, POLE_X = PLAY_HALF + 0.6, POLE_DZ = 0.45;
const newLight = tintKey => new Inst('light', lightBoxes, false, LIGHT_TINT[tintKey]);
const carLightX = (lane, o) => o.x + (lane.dir > 0 ? -0.08 : 0.08);

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
      if (lane.police) { o.light = newLight('red'); o.lightRed = true; }
      return o;
    });
    for (const o of lane.objs) if (o.light) o.light.set(carLightX(lane, o), LIGHT_Y_CAR, z);
    if (worldRng() < COIN_CHANCE.road) placeCoin(lane, z, playColumns());
    placePower(lane, lane.r, z, playColumns());
  },
  river(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z], [40, 0.02, 0.16, 0x74d3f5, 0, -0.16, z + 0.3]);   // a lighter streak: depth
    if (prev && prev.kind === 'river') lane.dir = -prev.dir;
    lane.speed = (rand(1.0, 1.9) + diff * 1.0) * (weatherAt(lane.r) ? 1.2 : 1);   // rain or snow: faster water
    fillTraffic(lane, Math.max(3, Math.floor(rand(4, 6) - diff * 2)), z, () => {
      const len = pick([2, 3, 3, 4]) - (diff > 0.6 && worldRng() < 0.5 ? 1 : 0);
      return { inst: new Inst('log' + len, () => logBoxes(len), false), len };   // flat on the water, no shadow
    });
    // light ripples drift with the current (looks only: placed without the world generator, so seeds stay the same)
    lane.ripples = [0, 1, 2].map(i => {
      const q = { inst: new Inst('ripple', rippleBoxes, false), x0: -lane.span / 2 + (i + (lane.r * 0.37) % 1) * lane.span / 3, x: 0, z: z + (i - 1) * 0.24 };
      q.inst.set(0, 0, q.z);
      return q;
    });
  },
  // lily pads: still water with pads at a few columns; land on water and you sink
  lily(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z], [40, 0.02, 0.16, 0x74d3f5, 0, -0.16, z + 0.3]);
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
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28],
                [0.12, 1.3, 0.12, 0xeeeeee, POLE_X, 0, z + POLE_DZ]);
    lane.light = newLight('off'); lane.lightOn = false; lane.lightWant = false;   // lightOn: as painted; lightWant: the schedule's state
    lane.light.set(POLE_X, LIGHT_Y_RAIL, z + POLE_DZ);
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
  // every row has its own generator from the seed and the row: a row is the same whatever rows were built
  // before it (the first built row depends on the screen size), so a replay or a shared seed never drifts
  worldRng = mulberry32((worldSeed ^ Math.imul(r + 4096, 0x9e3779b1)) >>> 0);
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
  mergeChunk(Math.floor(r / CHUNK));
}

// ---------- ground chunks: 8 rows of ground drawn as one mesh (two: one that casts shadows, one that does not) ----------
// Each lane keeps its own ground mesh; once all 8 rows of a chunk exist their ground is joined into chunk meshes and
// the lane meshes leave the scene. A dropped row (always off screen, behind the players) stays in the chunk meshes;
// the chunk is freed once every one of its rows is dropped, so dropping rows never rebuilds meshes.
const CHUNK = 8;
const chunks = new Map();   // chunk index -> { meshes, rows }
function joinGeos(geos) {
  let verts = 0, idx = 0;
  for (const g of geos) { verts += g.attributes.position.count; idx += g.index.count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3), ao = new Float32Array(verts);
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(idx);
  let v = 0, i = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3);
    ao.set(g.attributes.ao.array, v);
    const src = g.index.array;
    for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v;
    v += g.attributes.position.count; i += src.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
function mergeChunk(k) {
  if (chunks.has(k)) return;
  const rows = [];
  for (let r = k * CHUNK; r < (k + 1) * CHUNK; r++) { const l = lanes.get(r); if (!l) return; rows.push(l); }
  const meshes = [];
  for (const cast of [true, false]) {
    const part = rows.filter(l => l.ground.castShadow === cast);
    if (!part.length) continue;
    const m = voxelMesh(joinGeos(part.map(l => l.ground.geometry)), cast);
    m.matrixAutoUpdate = false; m.updateMatrix();
    worldGroup.add(m); meshes.push(m);
  }
  for (const l of rows) { l.group.remove(l.ground); l.chunk = k; }
  chunks.set(k, { meshes, rows });
  showChunk(k);
}
// a row was dropped: the chunk stays while any of its rows is still built, and is freed with the last one
function releaseChunk(k) {
  const c = chunks.get(k);
  if (!c) return;
  if (c.rows.some(l => lanes.get(l.r) === l)) { showChunk(k); return; }
  for (const m of c.meshes) { worldGroup.remove(m); m.geometry.dispose(); }
  chunks.delete(k);
}
// a chunk is drawn while any of its (still built) rows is
function showChunk(k) {
  const c = chunks.get(k);
  const on = c.rows.some(l => l.shown);
  for (const m of c.meshes) m.visible = on;
}

function dropLane(lane) {
  lanes.delete(lane.r);
  lane.shown = false;   // a dropped row counts as off screen for its chunk
  worldGroup.remove(lane.group);
  for (const o of lane.objs) { o.inst.drop(); if (o.light) o.light.drop(); }
  if (lane.ripples) for (const q of lane.ripples) q.inst.drop();
  if (lane.train) lane.train.inst.drop();
  if (lane.light) lane.light.drop();
  if (lane.power) dropSpinner(lane.power.s);
  for (const s of lane.coins.values()) dropSpinner(s);
  lane.ground.geometry.dispose();   // a merged chunk holds its own copy of this ground
  if (lane.chunk != null) releaseChunk(lane.chunk);
}

const near = r => G.state === 'play' && Math.abs(r - (G.camRow + G.camLead)) < G.visRows;   // rails on screen

// traffic at world time w (seconds): where it started plus speed x time, wrapped
function moveTraffic(lane, w) {
  const half = lane.span / 2, travel = lane.dir * lane.speed * w, river = lane.kind === 'river', now = w * 1000;
  for (const o of lane.objs) {
    const x = o.x0 + travel + half;
    o.x = x - Math.floor(x / lane.span) * lane.span - half;
    o.inst.move(o.x, river ? Math.sin(now / 400 + o.x) * 0.02 : 0, o.z);
    if (o.light) {
      o.light.move(carLightX(lane, o), LIGHT_Y_CAR, o.z);
      const red = Math.floor(now / 140) % 2 === 1;
      if (red !== o.lightRed) { o.lightRed = red; o.light.paint(red ? LIGHT_TINT.red : LIGHT_TINT.blue); }
    }
  }
  if (lane.ripples) {
    const flow = travel * 0.6;
    for (const q of lane.ripples) {
      const x = q.x0 + flow + half;
      q.x = x - Math.floor(x / lane.span) * lane.span - half;
      q.inst.move(q.x, 0, q.z);
    }
  }
}
// the rail at world time w: walk the seeded schedule forward, then the train is either waiting or passing.
// The schedule (and its rng draws) depends on w only, so it is the same however often this runs.
// draw = false (a hidden lane): the schedule and the sounds still advance, nothing is written to the instances.
function updateRail(lane, w, draw = true) {
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
  lane.lightWant = on;
  if (!draw) { tr.active = active; return; }   // showLane() writes the train and the light when the lane comes back
  if (active !== tr.active) { tr.active = active; tr.inst.set(tr.x, 0, -lane.r, 0, active && lane.shown); }
  else if (active) tr.inst.move(tr.x, 0, -lane.r);
  paintSignal(lane);
}
function paintSignal(lane) {
  if (lane.lightOn === lane.lightWant) return;
  lane.lightOn = lane.lightWant;
  lane.light.paint(lane.lightOn ? LIGHT_TINT.on : LIGHT_TINT.off);
}
function updateLane(lane, w, draw) {
  if (lane.kind === 'rail') updateRail(lane, w, draw);
  else if (draw && (lane.kind === 'road' || lane.kind === 'river')) moveTraffic(lane, w);
}
// Every step: only the lanes a player can touch (collisions and landings read o.x and train.x there), so the
// outcome is exact whatever the screen or the frame rate. The rest of the lanes move once per drawn frame
// (updateFarLanes); positions are a function of the world clock, so they are where they would be anyway.
// `players`: the player objects (joined, row, hop.fromRow); without them every lane steps, as before.
const hot = new Set();   // rows stepped by updateLanes
function updateLanes(players = null) {
  const w = G.worldTick * STEP;
  if (!players) { for (const lane of lanes.values()) updateLane(lane, w, true); return; }
  hot.clear();
  for (const p of players) {
    if (!p.joined) continue;
    for (let r = p.row - 1; r <= p.row + 1; r++) hot.add(r);
    if (p.hop) hot.add(p.hop.fromRow);
  }
  for (const r of hot) { const lane = lanes.get(r); if (lane) updateLane(lane, w, true); }
}
// once per drawn frame, before placeCamera(): the lanes no player can touch. A hidden lane gets no position
// writes (its rail schedule still advances, so a train is not announced late when the lane scrolls in).
function updateFarLanes() {
  const w = G.worldTick * STEP;
  for (const lane of lanes.values()) if (!hot.has(lane.r)) updateLane(lane, w, lane.shown);
}
// lanes far from the camera are not drawn; their instances (cars, logs, train, coins, lights) are hidden too
function showLane(lane, on) {
  if (lane.shown === on) return;
  lane.shown = on;
  lane.group.visible = on;
  if (lane.chunk != null) showChunk(lane.chunk);
  if (on) updateLane(lane, G.worldTick * STEP, true);   // a hidden lane was not moved: catch up before it shows
  for (const o of lane.objs) { o.inst.set(o.x, 0, o.z, o.rot || 0, on); if (o.light) o.light.set(carLightX(lane, o), LIGHT_Y_CAR, o.z, 0, on); }
  if (lane.ripples) for (const q of lane.ripples) q.inst.set(q.x, 0, q.z, 0, on);
  if (lane.train) lane.train.inst.set(lane.train.x, 0, -lane.r, 0, on && lane.train.active);
  if (lane.light) { lane.light.set(POLE_X, LIGHT_Y_RAIL, -lane.r + POLE_DZ, 0, on); paintSignal(lane); }
  for (const s of lane.coins.values()) s.inst.set(s.x, 0, s.z, 0, on);
  if (lane.power) lane.power.s.inst.set(lane.power.x, 0, -lane.r, 0, on);
}

// Visible rows are built at once; rows further ahead are added one per frame, so a restart
// or a fast run never builds many lanes in a single frame.
// the window of built rows follows how many are visible: a sideways phone sees fewer rows and builds fewer
const lastNeededRow = () => Math.ceil(G.camRow + G.camLead + G.visRows);
const rowsBehind = () => Math.min(LANES_BEHIND, Math.ceil(G.visRows));   // always more than BEHIND_LIMIT
const firstNeededRow = () => Math.min(G.camRow - rowsBehind(), Math.floor(G.camRow + G.camLead - G.visRows));
function resetWorld() {
  for (const lane of [...lanes.values()]) dropLane(lane);
  worldSeed = G.replay ? G.replay.seed : FIXED_SEED !== null ? FIXED_SEED
    : G.mode === 'daily' ? dailySeed() : G.mode === 'room' ? hashString('room:' + G.room) : (Math.random() * 4294967296) >>> 0;
  for (const k of [...chunks.keys()]) releaseChunk(k);   // nothing should be left; frees any chunk that is
  hot.clear();
  G.worldTick = 0;
  snowSeason = new Date().getMonth() === 11;
  weatherCache.clear();
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1; lastKind = 'grass'; streak = 0; bossChunk = 0;
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
}
function ensureLanes() {
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
  // keep a few rows built ahead of the screen edge, so a lane is never built in the frame it appears
  if (maxRow < Math.max(G.camRow + Math.min(LANES_AHEAD, G.visRows + 8), lastNeededRow() + 6)) addLane(maxRow + 1);
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

export { CHUNK, Inst, LANE_BUILDERS, addLane, chunks, dropLane, dropSpinner, ensureLanes, fillTraffic, firstNeededRow, fleet, fxRand, getSeed, laneCoins, laneKind, laneKinds, lanes, lastNeededRow, moveTraffic, near, pick, placeCoin, placePower, playColumns, rand, resetWorld, showLane, spinAll, spinners, updateFarLanes, updateLanes, updateRail, weatherAt, worldGroup };
