import { sfx } from './audio.js';
import { COIN_CHANCE, FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty } from './core.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { CAR_COLORS, LIGHT_OFF, LIGHT_ON, POLICE_BLUE, POLICE_RED, TRAIN_LEN, coinBoxes, lightGeo, logBoxes, policeBoxes, trainBoxes, vehicleBoxes } from './models.js';
import { dailySeed } from './storage.js';
import { cachedGeo, mergeBoxes, voxelMesh } from './voxel.js';

// Lanes: building, scrolling, traffic, trains and coins. Seeded, so a seed always gives the same world.
// ---------- random ----------
// The world is built from a seeded generator, so a seed always gives the same lanes.
// Effects (particles, train timing after the first train) use Math.random and never shift the world.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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
  if (r < 4) return 'grass';
  const diff = difficulty(r);
  let k;
  // keep runs of the same type together, like real roads and rivers
  if (lastKind !== 'grass' && streak < (lastKind === 'road' ? 4 : lastKind === 'lily' ? 2 : 3) && worldRng() < 0.55) k = lastKind;
  else {
    const w = { grass: 0.32 - diff * 0.12, road: 0.36, river: 0.2 + diff * 0.06, lily: r > 8 ? 0.1 : 0, rail: 0.12 + diff * 0.06 };
    let x = worldRng() * (w.grass + w.road + w.river + w.lily + w.rail);
    k = 'rail';
    for (const key of ['grass', 'road', 'river', 'lily']) { if ((x -= w[key]) < 0) { k = key; break; } }
    if (k === 'grass' && lastKind === 'grass') k = pick(['road', 'river']);
  }
  streak = k === lastKind ? streak + 1 : 1;
  lastKind = k;
  return k;
}

// moving things in a lane share one wrap span so their gaps never drift
function fillTraffic(lane, count, z, makeObj) {
  const spacing = lane.span / count;
  const x0 = rand(-lane.span / 2, -lane.span / 2 + 3);
  for (let i = 0; i < count; i++) {
    const o = makeObj(spacing);
    o.x = x0 + i * spacing + (o.jitter || 0);
    o.mesh.position.set(o.x, 0, z);
    lane.group.add(o.mesh); lane.objs.push(o);
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
      const mesh = lane.police ? voxelMesh(cachedGeo('police', policeBoxes)) : voxelMesh(cachedGeo(`car${truck}${c}`, () => vehicleBoxes(truck, c)));
      mesh.rotation.y = rot;
      const o = { mesh, len, jitter: rand(0, spacing * 0.35) };
      if (lane.police) { o.light = new THREE.Mesh(lightGeo, POLICE_RED); o.light.position.set(0.08, 0.98, 0); mesh.add(o.light); }
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
      return { mesh: voxelMesh(cachedGeo('log' + len, () => logBoxes(len)), false), len };   // flat on the water
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
    lane.train = { mesh: voxelMesh(cachedGeo('train' + lane.dir, () => trainBoxes(lane.dir))), len: TRAIN_LEN, x: 99, active: false };
    lane.train.mesh.position.set(99, 0, z);
    lane.train.mesh.visible = false;
    lane.group.add(lane.train.mesh);
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
    o.mesh.position.x = o.x;
    if (river) o.mesh.position.y = Math.sin(now / 400 + o.x) * 0.02;
    if (o.light) o.light.material = Math.floor(now / 140) % 2 ? POLICE_RED : POLICE_BLUE;
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
      tr.active = true; tr.mesh.visible = true;
      tr.x = -lane.dir * (WRAP + tr.len / 2 + 2);
    }
  } else {
    tr.x += lane.dir * TRAIN_SPEED * dt;
    tr.mesh.position.x = tr.x;
    on = Math.floor(now * BLINK_STEPS / 1000) % 2 === 1;
    if (Math.abs(tr.x) > WRAP + tr.len / 2 + 3) {
      tr.active = false; tr.mesh.visible = false; lane.warned = false;
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

export { LANE_BUILDERS, addLane, coinMeshes, dropLane, ensureLanes, fillTraffic, firstNeededRow, fxRand, getSeed, laneCoins, laneKind, laneKinds, lanes, lastKind, lastNeededRow, maxRow, moveTraffic, mulberry32, near, pick, placeCoin, playColumns, rand, resetWorld, streak, updateLanes, updateRail, worldGroup, worldRng, worldSeed };
