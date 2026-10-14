import { sfx } from './audio.js';
import { FIRST_ROW, FIXED_SEED, G, LANES_AHEAD, LANES_BEHIND, PLAY_HALF, STEP, WRAP } from './core.js';
import { hashString, plankState } from './rules.js';
import { createWorldGen, railStep, trafficX, wetAt } from './gen.js';
import { touchRows } from './sim.js';
import { BLINK_STEPS, scene } from './gfx.js';
import { LIGHT_TINT, boulderBoxes, coinBoxes, lightBoxes, logBoxes, magnetBoxes, plankBoxes, policeBoxes, shieldBoxes, trainBoxes, vehicleBoxes } from './models.js';
import { dailySeed } from './storage.js';
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
  for (const s of spinners) if (s.lane.shown) s.inst.set(s.x, 0, s.z, rot);
}
// the coins (and a power-up) gen.js put on the lane: lane.coins maps a column to its spinner
function placeCoins(lane, z) {
  for (const x of lane.coins.keys()) lane.coins.set(x, spinner(lane, 'coin', coinBoxes, x, z));
  const pw = lane.power;
  if (pw) pw.s = spinner(lane, pw.kind, pw.kind === 'shield' ? shieldBoxes : magnetBoxes, pw.x, z);   // turns like a coin
}
const rippleBoxes = () => [[0.5, 0.02, 0.07, 0xd8f3ff, 0, -0.15, 0], [0.22, 0.02, 0.07, 0xd8f3ff, 0.5, -0.15, 0]];
// weather by 40-row chunk, seeded (gen.js wetAt): rain (snow in December) from row 20 on; it changes the look and the traffic
let snowSeason = new Date().getMonth() === 11;
const weatherCache = new Map();   // 40-row chunk -> weather (asked every drawn frame; cleared with the world)
function weatherAt(r) {
  if (r < 20) return '';
  const chunk = Math.floor(r / 40);
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
// One builder per lane type: the look of a row gen.js made. Each adds its static boxes to `ground` (merged into one
// mesh later) and its moving parts to lane.objs. No random draws here: everything random is in the lane data.
const LANE_BUILDERS = {
  grass(lane, { r, z, ground }) {
    const snow = weatherAt(r) === 'snow';
    ground.push([40, 0.3, 1, snow ? (r % 2 ? 0xe6eef7 : 0xdbe6f2) : r % 2 ? 0xb7e05a : 0xaedb4f, 0, -0.3, z]);
    for (const [x, h] of lane.treeH) ground.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.72, h, 0.72, snow ? 0xd4e6ec : 0xa9cf3a, x, 0.3, z]);
  },
  road(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x4a4f5c, 0, -0.3, z]);
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
  river(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z], [40, 0.02, 0.16, 0x74d3f5, 0, -0.16, z + 0.3]);   // a lighter streak: depth
    edgeLines(ground, z, FOAM, -0.16);   // pale foam on both banks
    placeTraffic(lane, z, o => new Inst('log' + o.len, () => logBoxes(o.len), false));   // flat on the water, no shadow
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
    edgeLines(ground, z, FOAM, -0.16);
    for (const x of lane.pads) ground.push([0.78, 0.08, 0.78, 0x3f9f4a, x, -0.12, z], [0.2, 0.09, 0.2, 0xe66d8c, x + 0.2, -0.12, z - 0.2]);
  },
  // mud: safe, but a hop out of it is slow (rules.js hopTime), so the scroll line catches up
  mud(lane, { r, z, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0x7a5536 : 0x74502f, 0, -0.3, z]);
    for (const m of lane.mudLooks)
      if (m.reed) ground.push([0.3, m.reed, 0.3, 0x8a7a3a, m.x, 0, z]);   // reeds
      else ground.push([m.w, 0.02, 0.5, 0x5e3f24, m.x, 0, z + m.dz]);      // puddles
  },
  // ice: pale blue, with light sheen stripes (so it differs from grass by shape too) and snowy trees
  ice(lane, { r, z, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0xd3ecf7 : 0xc8e5f3, 0, -0.3, z]);
    for (let x = -12; x <= 12; x += 2.5) ground.push([1.1, 0.02, 0.07, 0xf6fcff, x + (r % 3) * 0.6, 0, z - 0.22], [0.6, 0.02, 0.07, 0xf6fcff, x + 0.4 + (r % 3) * 0.6, 0, z + 0.12]);
    for (const [x, h] of lane.treeH) ground.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.6, h, 0.6, 0xe3f0f5, x, 0.3, z]);
  },
  // a bridge: water with a run of planks (instances: a plank drops when it breaks), posts at both ends and rope rails
  bridge(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z], [40, 0.02, 0.16, 0x74d3f5, 0, -0.16, z + 0.3]);
    edgeLines(ground, z, FOAM, -0.16);
    const cols = [...lane.planks.keys()], a = cols[0] - 0.5, b = cols[cols.length - 1] + 0.5;
    for (const x of [a, b]) for (const dz of [-0.42, 0.42]) ground.push([0.12, 0.62, 0.12, 0x6e4826, x, -0.3, z + dz]);
    for (const dz of [-0.42, 0.42]) ground.push([b - a, 0.04, 0.04, 0xc9a77a, (a + b) / 2, 0.26, z + dz]);
    lane.plankInst = cols.map(x => { const i = new Inst('plank', plankBoxes, false); i.set(x, 0, z); return { x, i, y: 0 }; });
  },
  // rocks: dusty ground with pebbles; boulders roll across like slow traffic
  rocks(lane, { r, z, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0x9b9182 : 0x958b7c, 0, -0.3, z]);
    for (let x = -12; x <= 12; x += 3) ground.push([0.22, 0.08, 0.18, 0x7a7266, x + (r % 4) * 0.7, 0, z + ((x + r) % 2 ? 0.3 : -0.3)]);
    placeTraffic(lane, z, () => new Inst('boulder', boulderBoxes, true));
  },
  rail(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x7b6f6a, 0, -0.3, z]);
    // the first rail past each 100 rows carries the boss train (lane.boss): twice as long, faster, more warning
    for (let x = -14; x <= 14; x += 0.7) ground.push([0.18, 0.06, 0.9, 0x5a3d2a, x, 0, z]);
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28],
                [0.12, 1.3, 0.12, 0xeeeeee, POLE_X, 0, z + POLE_DZ]);
    lane.light = newLight('off'); lane.lightOn = false; lane.lightWant = false;   // lightOn: as painted; lightWant: the schedule's state
    lane.light.set(POLE_X, LIGHT_Y_RAIL, z + POLE_DZ);
    lane.lastBell = -1;
    // the train schedule (gen.js) is seeded per lane and runs on world time: trains come at the same moments in a replay
    lane.train.inst = new Inst('train' + lane.dir + lane.cars, () => trainBoxes(lane.dir, lane.cars), true);
  }
};

function addLane(r) {
  // every row has its own generator from the seed and the row: a row is the same whatever rows were built
  // before it (the first built row depends on the screen size)
  // (gen.js), so a replay or a shared seed never drifts
  const lane = worldGen.lane(r), kind = lane.kind;
  lane.group = new THREE.Group(); lane.shown = true;
  const ground = [];
  LANE_BUILDERS[kind](lane, { r, z: -r, ground });
  placeCoins(lane, -r);
  // unique per lane, disposed with the lane; flat ground does not cast shadows, trees and the rail pole do
  lane.ground = voxelMesh(mergeBoxes(ground), kind === 'grass' || kind === 'ice' ? lane.trees.size > 0 : kind === 'rail');
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
  if (lane.plankInst) for (const q of lane.plankInst) q.i.drop();
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
    o.x = trafficX(lane, o, w);   // gen.js: the one formula (sim.js reads the same positions)
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
    if (lane.timer < lane.warn && !lane.warned) { lane.warned = true; if (near(lane.r)) { sfx.horn(); if (lane.boss) setTimeout(sfx.horn, 600); } }
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
  else if (draw && (lane.kind === 'road' || lane.kind === 'river' || lane.kind === 'rocks')) moveTraffic(lane, w);
  else if (draw && lane.kind === 'bridge') placePlanks(lane);
}
// planks follow the bridge's state (rules.js plankState, world ticks): shaking while cracking, sunk while down
function placePlanks(lane) {
  for (const q of lane.plankInst) {
    const st = plankState(lane, q.x, G.worldTick);
    const y = st === 'down' ? -0.7 : st === 'cracking' ? Math.sin(G.worldTick * 1.7) * 0.03 : 0;
    if (y !== q.y) { q.y = y; q.i.move(q.x, y, -lane.r); }
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
  if (lane.plankInst) for (const q of lane.plankInst) q.i.set(q.x, q.y, -lane.r, 0, on);
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
  worldGen = createWorldGen(worldSeed);
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1;
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

export { CHUNK, Inst, LANE_BUILDERS, addLane, chunks, dropLane, dropSpinner, ensureLanes, firstNeededRow, fleet, fxRand, getSeed, laneCoins, laneKinds, lanes, lastNeededRow, moveTraffic, near, resetWorld, showLane, spinAll, spinners, updateFarLanes, updateLanes, updateRail, weatherAt, worldGroup };
