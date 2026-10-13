import { sfx } from './audio.js';
import { COIN_CHANCE, FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty } from './core.js';
import { mulberry32, nextLaneKind } from './rules.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { CAR_COLORS, LIGHT_OFF, LIGHT_ON, POLICE_BLUE, POLICE_RED, TRAIN_LEN, coinBoxes, lightGeo, logBoxes, policeBoxes, trainBoxes, vehicleBoxes } from './models.js';
import { dailySeed } from './storage.js';
import { cachedGeo, mergeBoxes, voxelMat, voxelMesh } from './voxel.js';

// Lanes: building, scrolling, traffic, trains and coins. Seeded, so a seed always gives the same world.
// ---------- random ----------
// The world is built from a seeded generator (rules.js), so a seed always gives the same lanes.
// Effects (particles, train timing after the first train) use Math.random and never shift the world.
let worldSeed = 0, worldRng = Math.random;
const rand = (a, b, r = worldRng) => a + r() * (b - a);
const pick = (arr, r = worldRng) => arr[Math.floor(r() * arr.length)];
const fxRand = (a, b) => rand(a, b, Math.random);

// ---------- world ----------
const lanes = new Map();
let maxRow = FIRST_ROW - 1;
const worldGroup = new THREE.Group();
scene.add(worldGroup);
let lastKind = 'grass', streak = 0;

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
  drop() { this.set(0, 0, 0, 0, false); this.f.free.push(this.i); }
}

// moving things in a lane share one wrap span so their gaps never drift
function fillTraffic(lane, count, z, makeObj) {
  const spacing = lane.span / count;
  const x0 = rand(-lane.span / 2, -lane.span / 2 + 3);
  for (let i = 0; i < count; i++) {
    const o = makeObj(spacing);
    o.x = x0 + i * spacing + (o.jitter || 0);
    o.z = z;
    o.inst.set(o.x, 0, z, o.rot || 0);
    lane.objs.push(o);
  }
}

// a coin on one free column of the lane; collected when a player lands on it
const coinMeshes = new Set();
function placeCoin(lane, z, cols) {
  if (!cols.length) return;
  const x = pick(cols);
  const m = voxelMesh(cachedGeo('coin', coinBoxes), false);
  m.position.set(x, 0, z);
  lane.group.add(m);
  lane.coins.set(x, m);
  coinMeshes.add(m);
}
const playColumns = () => Array.from({ length: PLAY_HALF * 2 + 1 }, (_, i) => i - PLAY_HALF);

// One builder per lane type. Each adds its static boxes to `ground` (merged into one mesh later)
// and its moving parts to lane.group / lane.objs.
const LANE_BUILDERS = {
  grass(lane, { r, z, diff, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0xb7e05a : 0xaedb4f, 0, -0.3, z]);
    let inPlay = 0;
    for (let x = -12; x <= 12; x++) {
      const out = Math.abs(x) > PLAY_HALF;
      // column 0 never gets a tree, so there is always a way forward
      const tree = out ? worldRng() < 0.85
        : r > 1 && x !== 0 && inPlay < 4 && worldRng() < 0.16 + diff * 0.08;
      if (!tree) continue;
      if (!out) inPlay++;
      lane.trees.add(x);
      ground.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.72, pick([0.6, 0.9, 1.2, 1.5]), 0.72, 0xa9cf3a, x, 0.3, z]);
    }
    if (r >= 1 && worldRng() < COIN_CHANCE.grass) placeCoin(lane, z, playColumns().filter(x => !lane.trees.has(x)));
  },
  road(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x4a4f5c, 0, -0.3, z]);
    if (prev && prev.kind === 'road')
      for (let x = -12; x <= 12; x += 2) ground.push([0.8, 0.02, 0.08, 0xe8e8e8, x, 0, z + 0.5]);
    lane.speed = rand(1.6, 2.8) + diff * 2.4;
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
  },
  river(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z]);
    if (prev && prev.kind === 'river') lane.dir = -prev.dir;
    lane.speed = rand(1.0, 1.9) + diff * 1.0;
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
  },
  rail(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x7b6f6a, 0, -0.3, z]);
    for (let x = -14; x <= 14; x += 0.7) ground.push([0.18, 0.06, 0.9, 0x5a3d2a, x, 0, z]);
    const poleX = PLAY_HALF + 0.6;
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28],
                [0.12, 1.3, 0.12, 0xeeeeee, poleX, 0, z + 0.45]);
    lane.light = new THREE.Mesh(lightGeo, LIGHT_OFF);
    lane.light.position.set(poleX, 1.2, z + 0.45);
    lane.group.add(lane.light);
    Object.assign(lane, { timer: rand(2, 6), warned: false, lastBell: -1 });
    lane.train = { inst: new Inst('train' + lane.dir, () => trainBoxes(lane.dir), true), len: TRAIN_LEN, x: 99, active: false };
  }
};

function addLane(r) {
  const kind = laneKind(r);
  const lane = {
    r, kind, group: new THREE.Group(), objs: [], trees: new Set(), coins: new Map(),
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
  for (const m of lane.coins.values()) coinMeshes.delete(m);
  lane.ground.geometry.dispose();
  lanes.delete(lane.r);
}

const near = r => G.state === 'play' && Math.abs(r - (G.camRow + G.camLead)) < G.visRows;   // rails on screen

function moveTraffic(lane, dt, now) {
  const half = lane.span / 2, step = lane.dir * lane.speed * dt, river = lane.kind === 'river';
  for (const o of lane.objs) {
    o.x += step;
    if (o.x > half) o.x -= lane.span;
    else if (o.x < -half) o.x += lane.span;
    o.inst.set(o.x, river ? Math.sin(now / 400 + o.x) * 0.02 : 0, o.z, o.rot || 0);
    if (o.light) { o.light.position.x = o.x + (lane.dir > 0 ? -0.08 : 0.08); o.light.material = Math.floor(now / 140) % 2 ? POLICE_RED : POLICE_BLUE; }
  }
}
function updateRail(lane, dt, now) {
  const tr = lane.train;
  let on;
  if (!tr.active) {
    lane.timer -= dt;
    const blink = Math.floor(lane.timer * BLINK_STEPS);
    on = lane.timer < TRAIN_WARN && blink % 2 === 0;
    if (lane.timer < TRAIN_WARN && !lane.warned) { lane.warned = true; if (near(lane.r)) sfx.horn(); }
    if (on && blink !== lane.lastBell && near(lane.r)) { lane.lastBell = blink; sfx.bell(); }
    if (lane.timer <= 0) {
      tr.active = true;
      tr.x = -lane.dir * (WRAP + tr.len / 2 + 2);
    }
  } else {
    tr.x += lane.dir * TRAIN_SPEED * dt;
    tr.inst.set(tr.x, 0, -lane.r);
    on = Math.floor(now * BLINK_STEPS / 1000) % 2 === 1;
    if (Math.abs(tr.x) > WRAP + tr.len / 2 + 3) {
      tr.active = false; tr.inst.set(0, 0, 0, 0, false); lane.warned = false;
      const diff = difficulty(lane.r);
      lane.timer = fxRand(3.5 - diff * 2, 8 - diff * 4);   // far out, trains come twice as often
    }
  }
  lane.light.material = on ? LIGHT_ON : LIGHT_OFF;
}
function updateLanes(dt, now) {
  for (const lane of lanes.values()) {
    if (lane.kind === 'road' || lane.kind === 'river') moveTraffic(lane, dt, now);
    else if (lane.kind === 'rail') updateRail(lane, dt, now);
  }
}

// Visible rows are built at once; rows further ahead are added one per frame, so a restart
// or a fast run never builds many lanes in a single frame.
const lastNeededRow = () => Math.ceil(G.camRow + G.camLead + G.visRows);
const firstNeededRow = () => Math.min(G.camRow - LANES_BEHIND, Math.floor(G.camRow + G.camLead - G.visRows));
function resetWorld() {
  for (const lane of [...lanes.values()]) dropLane(lane);
  worldSeed = FIXED_SEED !== null ? FIXED_SEED : G.mode === 'daily' ? dailySeed() : (Math.random() * 4294967296) >>> 0;
  worldRng = mulberry32(worldSeed);
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1; lastKind = 'grass'; streak = 0;
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

export { Inst, LANE_BUILDERS, addLane, fleet, coinMeshes, dropLane, ensureLanes, fillTraffic, firstNeededRow, fxRand, getSeed, laneCoins, laneKind, laneKinds, lanes, lastKind, lastNeededRow, maxRow, moveTraffic, near, pick, placeCoin, playColumns, rand, resetWorld, streak, updateLanes, updateRail, worldGroup, worldRng, worldSeed };
