import { sfx } from './audio.js';
import { BEST_MIN, BIOME_ROWS, FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, STEP, TUTORIAL_SEED } from './core.js';
import { EDGE_DEATH, PLANK_BREAK, RULES, hashString, isBombPower, isBombRow, plankState } from './rules.js';
import { createWorldGen, railStep, trafficX, wetAt, wetChunk, standGroups } from './gen.js';
import { touchRows } from './sim.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { LIGHT_TINT, blockBoxes, bombBoxes, boulderBoxes, coinBoxes, lightBoxes, logBoxes, magnetBoxes, plankBoxes, policeBoxes, shieldBoxes, tileBoxes, trainBoxes, twisterBoxes, vehicleBoxes } from './models.js';
import { HINT_KEY, dailySeed, loadText } from './storage.js';
import { cachedGeo, mergeBoxes, voxelMat, voxelMesh } from './voxel.js';

// Lanes: building, scrolling, traffic, trains and coins: the meshes of the world gen.js describes.
// ---------- random ----------
// What is in a row comes from gen.js (seeded per row), so a seed always gives the same lanes; this file only draws them.
// Traffic and trains are a function of the world clock (G.worldTick), not of frames: a lane built late, on a
// bigger screen or in a replay is exactly where it would be anyway. Effects (particles) use Math.random.
let worldSeed = 0, worldGen = createWorldGen(0);
const fxRand = (a, b) => a + Math.random() * (b - a);

// ---------- world ----------
const lanes = new Map();
let maxRow = FIRST_ROW - 1;
const worldGroup = new THREE.Group();
scene.add(worldGroup);

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
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();   // the mesh itself never moves (its instances do)
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
    f.mesh.visible = true;   // an empty fleet is hidden: no setup in the color and shadow passes for nothing
    this.paint(color);
    this.set(0, 0, 0, 0, false);
  }
  set(x, y, z, rotY = 0, visible = true) {
    tmpP.set(x, y, z); tmpQ.setFromAxisAngle(Y_AXIS, rotY); tmpS.setScalar(visible ? 1 : 0);
    this.f.mesh.setMatrixAt(this.i, tmpM.compose(tmpP, tmpQ, tmpS));
    this.f.mesh.instanceMatrix.needsUpdate = true;
  }
  // position and a turn about y, scale 1 (visible): the eight cells written directly, no compose (coins spin every frame)
  spin(x, y, z, rotY) {
    const a = this.f.mesh.instanceMatrix.array, k = this.i * 16, c = Math.cos(rotY), s = Math.sin(rotY);
    a[k] = c; a[k + 2] = -s; a[k + 5] = 1; a[k + 8] = s; a[k + 10] = c;
    a[k + 12] = x; a[k + 13] = y; a[k + 14] = z;
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
    if (this.i < 0) return;   // dropped already: a second drop would cut a live instance
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
    if (!f.top) m.visible = false;
    this.i = -1;
  }
}

// the cars or logs of a lane (gen.js placed them: x0 is where one is at world time 0)
function placeTraffic(lane, z, makeInst) {
  for (const o of lane.objs) {
    o.inst = makeInst(o);
    o.z = z;
    o.inst.set(o.x, 0, z, o.rot || 0);
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
  for (const s of spinners) if (s.lane.shown) s.inst.spin(s.x, 0, s.z, rot);
}
// the coins (and a power-up) gen.js put on the lane: lane.coins maps a column to its spinner
function placeCoins(lane, z) {
  for (const x of lane.coins.keys()) lane.coins.set(x, spinner(lane, 'coin', coinBoxes, x, z));
  if (lane.power) placePower(lane);
}
// the power-up's look: with two players a magnet on a bomb row is a bomb (rules.js isBombPower, the rule sim.js plays)
function placePower(lane) {
  const pw = lane.power, bomb = isBombPower(pw.kind, lane.r, G.twoUp, worldGen.version);
  if (pw.s) dropSpinner(pw.s);
  pw.s = spinner(lane, bomb ? 'bomb' : pw.kind, bomb ? bombBoxes : pw.kind === 'shield' ? shieldBoxes : magnetBoxes, pw.x, -lane.r);   // turns like a coin
  pw.s.bomb = bomb;
}
// the second player joined during the countdown: bomb rows already built show their magnets as bombs now
function refreshPowerLooks() {
  for (const lane of lanes.values()) if (lane.power && isBombRow(lane.r, worldGen.version) && lane.power.s.bomb !== isBombPower(lane.power.kind, lane.r, G.twoUp, worldGen.version)) placePower(lane);
}
// the rock a bomb drops: one column blocked for BOMB_TICKS (sim.js calls block/unblock through players.js)
function blockColumn(lane, x) {
  unblockColumn(lane, x);   // a second bomb on the same column keeps one rock
  const i = new Inst('block', blockBoxes, true);
  i.set(x, 0, -lane.r);
  (lane.blocks || (lane.blocks = new Map())).set(x, i);
}
function unblockColumn(lane, x) {
  const i = lane.blocks && lane.blocks.get(x);
  if (i) { i.drop(); lane.blocks.delete(x); }
}
const rippleBoxes = () => [[0.5, 0.02, 0.07, 0xd8f3ff, 0, -0.15, 0], [0.22, 0.02, 0.07, 0xd8f3ff, 0.5, -0.15, 0]];
// ---------- biomes: the look of the land changes every BIOME_ROWS rows (colors only: the rules are the same) ----------
// grass/mud/rocks/ice: [even row, odd row]; tree: [width, height scale]; sky: the day sky (gfx.js blends night and weather over it)
const BIOMES = [
  { name: 'MEADOW', grass: [0xb7e05a, 0xaedb4f], leaf: 0xa9cf3a, trunk: 0x7a4b2a, tree: [0.72, 1], road: 0x4a4f5c, water: 0x5ec8f0, streak: 0x74d3f5,
    mud: [0x7a5536, 0x74502f], rail: 0x7b6f6a, rocks: [0x9b9182, 0x958b7c], ice: [0xd3ecf7, 0xc8e5f3], sky: 0x74d3f2 },
  { name: 'DESERT', grass: [0xe8cf7a, 0xe2c86f], leaf: 0x5faa4a, trunk: 0x4f8f3d, tree: [0.42, 1.3], road: 0x5a4f48, water: 0x3fb7c9, streak: 0x5fcfdd,   // cactus, oasis
    mud: [0xa0703f, 0x986a3a], rail: 0x9a8470, rocks: [0xc9a06a, 0xc29860], ice: [0xd3ecf7, 0xc8e5f3], sky: 0xf2c98c },
  { name: 'TUNDRA', grass: [0xe6eef7, 0xdbe6f2], leaf: 0xd4e6ec, trunk: 0x5a4432, tree: [0.6, 1.1], road: 0x3e4450, water: 0x4fa8d8, streak: 0x6fc0e8,     // snow, firs
    mud: [0x6b5a4a, 0x655445], rail: 0x6c6a70, rocks: [0xb9bcc4, 0xb0b3bb], ice: [0xd3ecf7, 0xc8e5f3], sky: 0xcfe3f1 },
  { name: 'SWAMP', grass: [0x6f9a3a, 0x679234], leaf: 0x4f7f2e, trunk: 0x4a3322, tree: [0.8, 0.9], road: 0x3f4440, water: 0x4f8f7a, streak: 0x66a68e,     // murky water
    mud: [0x5a4a2c, 0x544528], rail: 0x6a6358, rocks: [0x7f8a72, 0x78836b], ice: [0xc3dde8, 0xb8d4e2], sky: 0x9fc8a0 }
];
const LOOK_OFFSET = { desert: 1, tundra: 2, swamp: 3 };   // an unlocked look (G.look) starts the land as that biome
const biomeIndex = r => (Math.floor(Math.max(0, r) / BIOME_ROWS) + (LOOK_OFFSET[G.look] || 0)) % BIOMES.length;
const biomeAt = r => BIOMES[biomeIndex(r)];
// weather by 40-row chunk, seeded (gen.js wetAt): rain (snow in December) from row 20 on; it changes the look and the traffic
let snowSeason = new Date().getMonth() === 11;
const weatherCache = new Map();   // 40-row chunk -> weather (asked every drawn frame; cleared with the world)
function weatherAt(r) {
  const chunk = wetChunk(r);   // gen.js owns the thresholds (the rule that makes traffic faster)
  if (chunk < 0) return '';
  let w = weatherCache.get(chunk);
  if (w === undefined) weatherCache.set(chunk, w = wetAt(worldSeed, r) ? (snowSeason ? 'snow' : 'rain') : '');
  return w;
}
// signal lights (rail crossing, police) are instances of one light model, painted per instance (LIGHT_TINT)
const LIGHT_Y_CAR = 0.88, LIGHT_Y_RAIL = 1.1, POLE_X = PLAY_HALF + 0.6, POLE_DZ = 0.45;
const newLight = tintKey => new Inst('light', lightBoxes, false, LIGHT_TINT[tintKey]);
const carLightX = (lane, o) => o.x + (lane.dir > 0 ? -0.08 : 0.08);

// thin lines along both edges of a row (looks only, no random draws): road edges, river foam
const FOAM = 0xeaf8ff;
function edgeLines(ground, z, color, y) { ground.push([40, 0.02, 0.05, color, 0, y, z - 0.47], [40, 0.02, 0.05, color, 0, y, z + 0.47]); }
const darker = (c, f) => (((c >> 16 & 255) * f) << 16) | (((c >> 8 & 255) * f) << 8) | ((c & 255) * f);   // f in 0..1: no channel carries over
// the rapids: past EDGE_DEATH a log's rider is swept away (sim.js stand), so that water is darker, with a white line and
// white water on it (a hair above the river's top, so the two do not flicker)
function rapids(ground, z, water) {
  for (const s of [-1, 1]) {
    ground.push([20 - EDGE_DEATH, 0.3, 1, darker(water, 0.8), s * (EDGE_DEATH + (20 - EDGE_DEATH) / 2), -0.435, z], [0.12, 0.02, 1, FOAM, s * EDGE_DEATH, -0.135, z]);
    // white water: small foam flecks, not lines (lines read as a road)
    for (let x = EDGE_DEATH + 0.35, i = 0; x < 12; x += 0.55, i++) ground.push([0.2 + (i % 3) * 0.06, 0.02, 0.16, FOAM, s * x, -0.135, z - 0.36 + ((i * 5) % 7) * 0.12]);
  }
}
// One builder per lane type: the look of a row gen.js made. Each adds its static boxes to `ground` (merged into one
// mesh later) and its moving parts to lane.objs. No random draws here: everything random is in the lane data.
const LANE_BUILDERS = {
  grass(lane, { r, z, ground, cast, B }) {
    const snow = weatherAt(r) === 'snow';
    // r & 1, not r % 2: a row behind the start (r < 0) gives -1 there, no color, and drew black
    ground.push([40, 0.3, 1, snow ? (r & 1 ? 0xe6eef7 : 0xdbe6f2) : B.grass[r & 1], 0, -0.3, z]);
    const [tw, th] = B.tree;
    for (const [x, h] of lane.treeH) cast.push([0.3, 0.3, 0.3, B.trunk, x, 0, z], [tw, h * th, tw, snow ? 0xd4e6ec : B.leaf, x, 0.3, z]);
    // the grass boss: a twister wanders across (gen.js lane.twister); darker, torn ground under its path
    if (lane.twister) { edgeLines(ground, z, 0x6a6a5a, 0.01); placeTraffic(lane, z, () => new Inst('twister', twisterBoxes, true)); }
  },
  road(lane, { z, ground, B }) {
    ground.push([40, 0.3, 1, B.road, 0, -0.3, z]);
    edgeLines(ground, z, 0xdedede, 0);   // a light line on both edges: a road reads as a road without its colour
    if (lane.prevKind === 'road')
      for (let x = -12; x <= 12; x += 2) ground.push([0.8, 0.02, 0.08, 0xe8e8e8, x, 0, z + 0.5]);
    // further out, some roads are police chases: faster, with flashing lights
    placeTraffic(lane, z, o => {
      const inst = lane.police ? new Inst('police', policeBoxes, true) : new Inst(lane.truck ? 'truck' : 'car', () => vehicleBoxes(lane.truck), true, o.color);
      if (lane.police) { o.light = newLight('red'); o.lightRed = true; }
      return inst;
    });
    for (const o of lane.objs) if (o.light) o.light.set(carLightX(lane, o), LIGHT_Y_CAR, z);
  },
  river(lane, { z, ground, B }) {
    // the river boss (gen.js lane.flood): darker, faster water with foam streaks across it
    ground.push([40, 0.3, 1, lane.flood ? 0x3a86b8 : B.water, 0, -0.45, z], [40, 0.02, 0.16, lane.flood ? 0x8fd4ff : B.streak, 0, -0.16, z + 0.3]);   // a lighter streak: depth
    edgeLines(ground, z, FOAM, -0.16);   // pale foam on both banks
    rapids(ground, z, lane.flood ? 0x3a86b8 : B.water);
    if (lane.flood) for (let x = -12; x <= 12; x += 1.5) ground.push([0.7, 0.02, 0.06, FOAM, x, -0.15, z - 0.1 + (x % 3) * 0.1]);
    placeTraffic(lane, z, o => new Inst('log' + o.len, () => logBoxes(o.len), false));   // flat on the water, no shadow
    // light ripples drift with the current (looks only: placed without the world generator, so seeds stay the same)
    lane.ripples = [0, 1, 2].map(i => {
      const q = { inst: new Inst('ripple', rippleBoxes, false), x0: -lane.span / 2 + (i + (lane.r * 0.37) % 1) * lane.span / 3, x: 0, z: z + (i - 1) * 0.24 };
      q.inst.set(0, 0, q.z);
      return q;
    });
  },
  // lily pads: still water with pads at a few columns; land on water and you sink
  lily(lane, { z, ground, B }) {
    ground.push([40, 0.3, 1, B.water, 0, -0.45, z], [40, 0.02, 0.16, B.streak, 0, -0.16, z + 0.3]);
    edgeLines(ground, z, FOAM, -0.16);
    for (const x of lane.pads) ground.push([0.78, 0.08, 0.78, 0x3f9f4a, x, -0.12, z], [0.2, 0.09, 0.2, 0xe66d8c, x + 0.2, -0.12, z - 0.2]);
  },
  // mud: safe, but a hop out of it is slow (rules.js hopTime), so the scroll line catches up
  mud(lane, { r, z, ground, B }) {
    ground.push([40, 0.3, 1, B.mud[r & 1], 0, -0.3, z]);
    for (const m of lane.mudLooks)
      if (m.reed) ground.push([0.3, m.reed, 0.3, 0x8a7a3a, m.x, 0, z]);   // reeds
      else ground.push([m.w, 0.02, 0.5, 0x5e3f24, m.x, 0, z + m.dz]);      // puddles
  },
  // ice: pale blue, with light sheen stripes (so it differs from grass by shape too) and snowy trees
  ice(lane, { r, z, ground, cast, B }) {
    ground.push([40, 0.3, 1, B.ice[r & 1], 0, -0.3, z]);
    for (let x = -12; x <= 12; x += 2.5) ground.push([1.1, 0.02, 0.07, 0xf6fcff, x + (r % 3) * 0.6, 0, z - 0.22], [0.6, 0.02, 0.07, 0xf6fcff, x + 0.4 + (r % 3) * 0.6, 0, z + 0.12]);
    for (const [x, h] of lane.treeH) cast.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.6, h, 0.6, 0xe3f0f5, x, 0.3, z]);
  },
  // a bridge: water with a run of planks (instances: a plank drops when it breaks), posts at both ends and rope rails
  bridge(lane, { z, ground, B }) {
    ground.push([40, 0.3, 1, B.water, 0, -0.45, z], [40, 0.02, 0.16, B.streak, 0, -0.16, z + 0.3]);
    edgeLines(ground, z, FOAM, -0.16);
    const cols = [...lane.planks.keys()].sort((p, q) => p - q);
    for (const run of standGroups(cols)) {   // posts and rope rails per run of planks (gen.js may add a lone plank)
      const a = run[0] - 0.5, b = run[run.length - 1] + 0.5;
      for (const x of [a, b]) for (const dz of [-0.42, 0.42]) ground.push([0.12, 0.62, 0.12, 0x6e4826, x, -0.3, z + dz]);
      for (const dz of [-0.42, 0.42]) ground.push([b - a, 0.04, 0.04, 0xc9a77a, (a + b) / 2, 0.26, z + dz]);
    }
    lane.plankInst = cols.map(x => { const i = new Inst('plank', plankBoxes, false); i.set(x, 0, z); return { x, i, y: 0, rot: 0 }; });
  },
  // rocks: dusty ground with pebbles; boulders roll across like slow traffic
  rocks(lane, { r, z, ground, B }) {
    ground.push([40, 0.3, 1, B.rocks[r & 1], 0, -0.3, z]);
    for (let x = -12; x <= 12; x += 3) ground.push([0.22, 0.08, 0.18, 0x7a7266, x + (r % 4) * 0.7, 0, z + ((x + r) % 2 ? 0.3 : -0.3)]);
    placeTraffic(lane, z, () => new Inst('boulder', boulderBoxes, true));
  },
  // a spring row: grass with a trampoline on every play column; a forward hop from here flies two rows (sim.js)
  spring(lane, { r, z, ground, cast, B }) {
    ground.push([40, 0.3, 1, B.grass[r & 1], 0, -0.3, z]);
    for (let x = -PLAY_HALF; x <= PLAY_HALF; x++) ground.push([0.8, 0.08, 0.8, 0xe05a3a, x, 0, z], [0.56, 0.05, 0.56, 0xffd84a, x, 0.08, z], [0.3, 0.05, 0.3, 0xe05a3a, x, 0.13, z]);
    for (let x = -12; x <= 12; x++) if (Math.abs(x) > PLAY_HALF && (x + r) % 3 === 0) cast.push([0.3, 0.3, 0.3, B.trunk, x, 0, z], [0.6, 0.9, 0.6, B.leaf, x, 0.3, z]);
  },
  // a portal row: stone ground with two glowing rings; landing in one puts you in the other (sim.js lane.portals)
  portal(lane, { z, ground, cast }) {
    ground.push([40, 0.3, 1, 0x5c5670, 0, -0.3, z]);
    for (const x of lane.portals) {
      for (const [dx, dz, w, d] of [[0, -0.4, 0.9, 0.1], [0, 0.4, 0.9, 0.1], [-0.4, 0, 0.1, 0.9], [0.4, 0, 0.1, 0.9]]) ground.push([w, 0.12, d, 0xb455ff, x + dx, 0, z + dz, 0.8]);
      ground.push([0.6, 0.02, 0.6, 0xe0b8ff, x, 0, z, 1.2]);
    }
    for (let x = -12; x <= 12; x += 2) if (Math.abs(x) > PLAY_HALF) cast.push([0.5, 0.6 + (x % 3) * 0.2, 0.5, 0x7c75a0, x, 0, z]);   // standing stones
  },
  // a cliff row: stone tiles over a dark chasm; a tile drops for good once it breaks (plank instances, placePlanks)
  cliff(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x2a2622, 0, -1.1, z]);   // the chasm floor, far below
    for (const x of [-PLAY_HALF - 1, PLAY_HALF + 1]) ground.push([0.9, 0.2, 0.92, 0x8d8a84, x, -0.2, z]);   // the banks
    for (let x = -12; x <= 12; x++) if (Math.abs(x) > PLAY_HALF + 1) ground.push([1, 0.2, 1, 0x7f7b74, x, -0.2, z]);
    const cols = [...lane.planks.keys()].sort((p, q) => p - q);
    lane.plankInst = cols.map(x => { const i = new Inst('tile', tileBoxes, true); i.set(x, 0, z); return { x, i, y: 0, rot: 0 }; });
  },
  rail(lane, { z, ground, cast, B }) {
    ground.push([40, 0.3, 1, B.rail, 0, -0.3, z]);
    // the first rail of each boss block (rules.js bossRows: 100 rows, rules 4: 50) carries the boss train (lane.boss): twice as long, faster, more warning
    for (let x = -14; x <= 14; x += 0.7) ground.push([0.18, 0.06, 0.9, 0x5a3d2a, x, 0, z]);
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28]);
    cast.push([0.12, 1.3, 0.12, 0xeeeeee, POLE_X, 0, z + POLE_DZ]);   // the signal pole
    lane.light = newLight('off'); lane.lightOn = false; lane.lightWant = false;   // lightOn: as painted; lightWant: the schedule's state
    lane.light.set(POLE_X, LIGHT_Y_RAIL, z + POLE_DZ);
    lane.lastBell = -1;
    // the train schedule (gen.js) is seeded per lane and runs on world time: trains come at the same moments in a replay
    lane.train.inst = new Inst('train' + lane.dir + lane.cars, () => trainBoxes(lane.dir, lane.cars), true);
  }
};

// ---------- the BEST ribbon: a gold line on the ground across the row of the all-time best ----------
// Drawn with the row (part of its ground, so it costs no draw call): hop past it and the run is a new best. A look only:
// no rng draw, nothing the rules see. On water it floats; a cliff row gets the two flags on its banks only
const RIBBON = 0xffd84a, RIBBON_INK = 0x7a3a10, PX = 0.14;
const LETTERS = { B: ['111', '101', '110', '101', '111'], E: ['111', '100', '111', '100', '111'], S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'] };
const WATER_KINDS = new Set(['river', 'lily', 'bridge']);
let ribbonAt = -1;   // the row this world's ribbon lies on (-1: none yet); a test hook
const ribbonRow = () => ribbonAt;
function ribbonBoxes(ground, kind, z) {
  const y = WATER_KINDS.has(kind) ? -0.15 : kind === 'rail' ? 0.12 : 0;
  for (const s of [-1, 1]) {   // a flag post on each side of the play area
    ground.push([0.08, 0.9, 0.08, 0x6e4826, s * (PLAY_HALF + 1.3), kind === 'cliff' ? -0.2 : y, z], [0.4, 0.26, 0.05, RIBBON, s * (PLAY_HALF + 1.3) + s * 0.22, (kind === 'cliff' ? -0.2 : y) + 0.6, z]);
  }
  if (kind === 'cliff') return;
  ground.push([PLAY_HALF * 2 + 1.6, 0.03, 0.56, RIBBON, 0, y + 0.005, z]);
  // BEST in pixel letters, read from the camera (forward is -z, so the top of a letter is the far side)
  let x = -(4 * 3 + 3) / 2 * PX + PX / 2;
  for (const ch of 'BEST') {
    LETTERS[ch].forEach((row, k) => [...row].forEach((on, c) => { if (on === '1') ground.push([PX, 0.02, PX, RIBBON_INK, x + c * PX, y + 0.035, z + (k - 2) * PX]); }));
    x += 4 * PX;
  }
}
function addLane(r) {
  // every row has its own generator from the seed and the row: a row is the same whatever rows were built
  // before it (the first built row depends on the screen size)
  // (gen.js), so a replay or a shared seed never drifts
  const lane = worldGen.lane(r), kind = lane.kind;
  lane.group = new THREE.Group(); lane.shown = true;
  lane.group.matrixAutoUpdate = false;   // never moves (identity): Three.js skips it in the per-draw matrix walk
  const ground = [], cast = [];   // cast: what stands on the row (trees, the signal pole, standing stones): the only shadow casters
  LANE_BUILDERS[kind](lane, { r, z: -r, ground, cast, B: biomeAt(r) });   // nosemgrep: unsafe-dynamic-method -- kind is a gen.js lane kind (a fixed set)
  if (r === G.bestAll && r >= BEST_MIN) { ribbonBoxes(ground, kind, -r); ribbonAt = r; }
  placeCoins(lane, -r);
  // unique per lane, disposed with the lane: the flat ground (never a caster: the depth pass skips the 40-unit slab,
  // and no slab shadows a slab) and, when the row has any, its casters
  lane.ground = voxelMesh(mergeBoxes(ground), false);
  lane.ground.matrixAutoUpdate = false;
  lane.ground.updateMatrix();
  lane.group.add(lane.ground);
  lane.casters = cast.length ? voxelMesh(mergeBoxes(cast), true) : null;
  if (lane.casters) { lane.casters.matrixAutoUpdate = false; lane.casters.updateMatrix(); lane.group.add(lane.casters); }
  worldGroup.add(lane.group);
  lanes.set(r, lane);
  maxRow = Math.max(maxRow, r);
  if (r - Math.floor(r / CHUNK) * CHUNK === CHUNK - 1) pendingChunks.add(Math.floor(r / CHUNK));   // the chunk's last row: join it
}

// ---------- ground chunks: 8 rows of ground drawn as one mesh (two: the casters, and the ground that casts no shadow) ----------
// Each lane keeps its own meshes; once all 8 rows of a chunk exist they are joined into the chunk meshes and
// the lane meshes leave the scene. A dropped row (always off screen, behind the players) stays in the chunk meshes;
// the chunk is freed once every one of its rows is dropped, so dropping rows never rebuilds meshes.
const CHUNK = 8;
const chunks = new Map();   // chunk index -> { meshes, rows }
// A chunk is joined in drawn frames, never in the game step that built its last row (a step may run several times in
// one frame). The copy of the rows' vertices is spread over the frames (JOIN_ROWS source geometries a frame: a whole
// 8-row join is about 2 ms in node, more on a floor phone), and the chunk's meshes are made once the copy is complete.
const pendingChunks = new Set();
const JOIN_ROWS = 2;
let joinJob = null;   // the chunk being joined, or null
function mergePending(all) {
  for (;;) {
    if (!joinJob) {
      const first = pendingChunks.values().next();
      if (first.done) return;
      pendingChunks.delete(first.value);
      joinJob = startJoin(first.value);
      if (!joinJob) continue;
    }
    if (joinStep(joinJob, all)) joinJob = null;
    if (!all) return;
  }
}
// the rows of chunk k and the arrays their geometries are copied into (one part per cast flag), or null if a row is gone
function startJoin(k) {
  if (chunks.has(k)) return null;
  const rows = [];
  for (let r = k * CHUNK; r < (k + 1) * CHUNK; r++) { const l = lanes.get(r); if (!l) return null; rows.push(l); }
  const parts = [];
  const casters = rows.map(l => l.casters).filter(Boolean).map(m => m.geometry);
  if (casters.length) parts.push(joinArrays(casters, true));
  parts.push(joinArrays(rows.map(l => l.ground.geometry), false));
  return { k, rows, parts };
}
function joinArrays(geos, cast) {
  let verts = 0, idx = 0;
  for (const g of geos) { verts += g.attributes.position.count; idx += g.index.count; }
  return { cast, geos, next: 0, v: 0, i: 0, pos: new Float32Array(verts * 3), nor: new Float32Array(verts * 3), col: new Float32Array(verts * 3), ao: new Float32Array(verts),
    index: new (verts > 65535 ? Uint32Array : Uint16Array)(idx) };
}
// one source geometry into the part's arrays
function joinCopy(j) {
  const g = j.geos[j.next++];
  j.pos.set(g.attributes.position.array, j.v * 3); j.nor.set(g.attributes.normal.array, j.v * 3); j.col.set(g.attributes.color.array, j.v * 3);
  j.ao.set(g.attributes.ao.array, j.v);
  const src = g.index.array;
  for (let k = 0; k < src.length; k++) j.index[j.i + k] = src[k] + j.v;
  j.v += g.attributes.position.count; j.i += src.length;
}
function joinMesh(j) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(j.pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(j.nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(j.col, 3));
  out.setAttribute('ao', new THREE.BufferAttribute(j.ao, 1));
  out.setIndex(new THREE.BufferAttribute(j.index, 1));
  const m = voxelMesh(out, j.cast);
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}
// advances a join by JOIN_ROWS source geometries (all of them when `all`); true once the job is over: the chunk's
// meshes are in the scene, or a row of it was dropped meanwhile (the rows keep their own meshes then)
function joinStep(job, all) {
  if (job.rows.some(l => lanes.get(l.r) !== l)) return true;
  let n = all ? Infinity : JOIN_ROWS;
  for (const part of job.parts) {
    while (part.next < part.geos.length && n-- > 0) joinCopy(part);
    if (part.next < part.geos.length) return false;
  }
  const meshes = job.parts.map(joinMesh);
  for (const m of meshes) worldGroup.add(m);
  // the chunk holds a copy: the row's own geometries (and its empty group, which the per-draw walk would still visit) can go
  for (const l of job.rows) {
    l.group.remove(l.ground); l.ground.geometry.dispose();
    if (l.casters) { l.group.remove(l.casters); l.casters.geometry.dispose(); }
    worldGroup.remove(l.group); l.chunk = job.k;
  }
  chunks.set(job.k, { meshes, rows: job.rows });
  showChunk(job.k);
  return true;
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
  if (lane.r === ribbonAt) ribbonAt = -1;
  lane.shown = false;   // a dropped row counts as off screen for its chunk
  worldGroup.remove(lane.group);
  for (const o of lane.objs) { o.inst.drop(); if (o.light) o.light.drop(); }
  if (lane.ripples) for (const q of lane.ripples) q.inst.drop();
  if (lane.plankInst) for (const q of lane.plankInst) q.i.drop();
  if (lane.blocks) { for (const i of lane.blocks.values()) i.drop(); lane.blocks = null; }   // a bomb that goes later finds nothing
  if (lane.train) lane.train.inst.drop();
  if (lane.light) lane.light.drop();
  if (lane.power) dropSpinner(lane.power.s);
  for (const s of lane.coins.values()) dropSpinner(s);
  lane.ground.geometry.dispose();   // a merged chunk holds its own copy of this ground
  if (lane.casters) lane.casters.geometry.dispose();
  if (lane.chunk != null) releaseChunk(lane.chunk);
}

const near = r => G.state === 'play' && Math.abs(r - (G.camRow + G.camLead)) < G.visRows;   // rails on screen

// traffic at world time w (seconds): where it started plus speed x time, wrapped
function moveTraffic(lane, w) {
  const half = lane.span / 2, travel = lane.dir * lane.speed * w, river = lane.kind === 'river', now = w * 1000;
  for (const o of lane.objs) {
    o.x = trafficX(lane, o, w);   // gen.js: the one formula (sim.js reads the same positions)
    if (lane.twister) { o.inst.set(o.x, Math.sin(now / 150) * 0.05, o.z, now / 90); continue; }   // the twister turns as it goes
    o.inst.move(o.x, river ? Math.sin(now / 400 + o.x) * 0.02 : lane.kind === 'rocks' ? Math.abs(Math.sin(o.x * 3)) * 0.06 : 0, o.z);
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
// the rail at world time w: gen.js railStep walks the seeded schedule forward (it depends on w only, so it is the
// same however often this runs) and places a passing train; this adds the signal, the sounds and the meshes.
// draw = false (a hidden lane): the schedule and the sounds still advance, nothing is written to the instances.
function updateRail(lane, w, draw = true) {
  const tr = lane.train;
  const active = railStep(lane, w);
  let on;
  if (!active) {
    lane.timer = lane.nextStart - w;
    const blink = Math.floor(lane.timer * BLINK_STEPS);
    on = lane.timer < lane.warn && blink % 2 === 0;
    if (lane.timer < lane.warn && !lane.warned) { lane.warned = true; if (near(lane.r)) { sfx.horn(); if (lane.boss) { sfx.boss(); lane.horn2 = lane.timer - 0.6; } } }
    if (lane.horn2 !== undefined && lane.timer < lane.horn2) { lane.horn2 = undefined; if (near(lane.r)) sfx.horn(); }   // the boss's second horn, from the schedule (no timer to outlive a pause)
    if (on && blink !== lane.lastBell && near(lane.r)) { lane.lastBell = blink; sfx.bell(); }
  } else {
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
  else if (draw && (lane.kind === 'road' || lane.kind === 'river' || lane.kind === 'rocks' || lane.twister)) moveTraffic(lane, w);
  else if (draw && lane.plankInst) placePlanks(lane);   // bridge planks and cliff tiles
}
// planks follow the bridge's state (rules.js plankState, world ticks): while cracking a plank sinks, tilts and shakes
// more and more until it drops (PLANK_BREAK after the landing); sunk while down
function placePlanks(lane) {
  for (const q of lane.plankInst) {
    const st = plankState(lane, q.x, G.worldTick);
    let y = 0, rot = 0;
    if (st === 'down') y = lane.kind === 'cliff' ? -1.3 : -0.7;
    else if (st === 'cracking') {
      const k = 1 - (lane.planks.get(q.x).breakAt - G.worldTick) / PLANK_BREAK;   // 0 at the landing, 1 as it drops
      const shake = Math.sin(G.worldTick * 1.7) * (0.02 + 0.05 * k);
      y = -0.12 * k * k + shake;
      rot = shake * 1.6;
    }
    if (y !== q.y || rot !== q.rot) { q.y = y; q.rot = rot; q.i.set(q.x, y, -lane.r, rot, lane.shown !== false); }
  }
}
// Every step: only the lanes a player can touch (collisions and landings read o.x and train.x there), so the
// outcome is exact whatever the screen or the frame rate. The rest of the lanes move once per drawn frame
// (updateFarLanes); positions are a function of the world clock, so they are where they would be anyway.
// `players`: the player objects (joined, row, hop.fromRow); without them every lane steps, as before.
const hot = new Set();   // rows stepped by updateLanes (sim.js touchRows: the same rows the simulation steps)
function updateLanes(players = null) {
  const w = G.worldTick * STEP;
  if (!players) { for (const lane of lanes.values()) updateLane(lane, w, true); return; }
  touchRows(players, hot);
  for (const r of hot) { const lane = lanes.get(r); if (lane) updateLane(lane, w, true); }
}
// once per drawn frame, before placeCamera(): the lanes no player can touch. A hidden lane gets no position
// writes (its rail schedule still advances, so a train is not announced late when the lane scrolls in).
function updateFarLanes() {
  mergePending(false);
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
  if (lane.plankInst) for (const q of lane.plankInst) q.i.set(q.x, q.y, -lane.r, q.rot, on);
  if (lane.blocks) for (const [x, i] of lane.blocks) i.set(x, 0, -lane.r, 0, on);
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
  // the very first classic game is a gentle, known world (the guided hints in app.js fit it)
  worldSeed = G.replay ? G.replay.seed : FIXED_SEED !== null ? FIXED_SEED
    : G.mode === 'daily' ? dailySeed() : G.mode === 'room' ? hashString('room:' + G.room)
    : G.mode === 'classic' && loadText(HINT_KEY) !== '1' ? TUTORIAL_SEED : (Math.random() * 4294967296) >>> 0;
  for (const k of [...chunks.keys()]) releaseChunk(k);   // nothing should be left; frees any chunk that is
  pendingChunks.clear(); joinJob = null;   // a join of the old world's rows goes with them
  hot.clear();
  ribbonAt = -1;
  G.worldTick = 0;
  snowSeason = new Date().getMonth() === 11;
  weatherCache.clear();
  worldGen = createWorldGen(worldSeed, G.replay ? G.replay.version : RULES);   // a replay's world is built by its own rules (G.rules is set later, in startPlay)
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1;
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
  mergePending(true);   // a new world: join what is built now
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

export { Inst, biomeAt, biomeIndex, blockColumn, refreshPowerLooks, unblockColumn, dropSpinner, ensureLanes, fxRand, getSeed, laneCoins, laneKinds, lanes, resetWorld, ribbonRow, showLane, spinAll, updateFarLanes, updateLanes, weatherAt };
