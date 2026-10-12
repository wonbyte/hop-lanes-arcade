import { sfx } from './audio.js';
import { $, BEHIND_LIMIT, EAGLE_IDLE, EAGLE_SWOOP, EDGE_DEATH, G, HIT_PAD, HOP_TIME, PLAY_HALF, TAU, TRAIN_SPEED } from './core.js';
import { buzz } from './device.js';
import { ONE, scene } from './gfx.js';
import { CHARACTERS, COLORS, eagleBoxes, makeCharacter } from './models.js';
import { checkOver } from './screens.js';
import { PICK_KEY, loadText, setBank } from './storage.js';
import { cachedGeo, voxelMesh } from './voxel.js';
import { coinMeshes, fxRand, lanes } from './world.js';

// The two players: spawning, hopping, riding logs, coins, deaths and the eagle.
// ---------- players ----------
// the character each player picked last time (saved per player slot)
function pickIndex(i, fallback) {
  const k = CHARACTERS.findIndex(c => c.key === loadText(PICK_KEY + i));
  return k >= 0 ? k : fallback;
}
const players = [
  { id: 0, charIndex: pickIndex(0, 0), startX: -2, joined: false, scoreEl: $('score1').querySelector('b') },
  { id: 1, charIndex: pickIndex(1, 1), startX: 2, joined: false, scoreEl: $('score2').querySelector('b') }
];
const charOf = p => CHARACTERS[p.charIndex];
function spawn(p) {
  despawn(p);
  const ch = charOf(p);
  p.mesh = makeCharacter(ch.boxes, ch.key);
  scene.add(p.mesh);
  Object.assign(p, {
    x: p.startX, row: 0, alive: true, hop: null, queue: null, score: 0, coins: 0, idleT: 0, eagle: null, breath: p.id * 1.7,
    facing: 0, cause: '', log: null, logOff: 0, trainDir: 0
  });
  p.mesh.position.set(p.x, 0, 0);
  p.scoreEl.textContent = '0';
  $('score' + (p.id + 1)).querySelector('span').textContent = 'P' + (p.id + 1) + ' ' + ch.name;
}
function despawn(p) {
  if (p.mesh) { scene.remove(p.mesh); p.mesh = null; }
  if (p.eagle) { scene.remove(p.eagle.mesh); p.eagle = null; }
  p.alive = false;
}

// ---------- the eagle: stand still too long and it carries you away ----------
function sendEagle(p) {
  const mesh = voxelMesh(cachedGeo('eagle', eagleBoxes));
  const from = new THREE.Vector3(p.x, 6, -p.row - 5);
  mesh.position.copy(from);
  scene.add(mesh);
  p.eagle = { mesh, from, t: 0 };
  sfx.eagle();
}
function updateEagle(p, dt) {
  const e = p.eagle, m = e.mesh, pm = p.mesh;
  if (p.alive) {                                 // swoop down to the player
    e.t = Math.min(1, e.t + dt / EAGLE_SWOOP);
    const k = e.t * e.t;
    m.position.set(e.from.x + (pm.position.x - e.from.x) * k, e.from.y + (0.55 - e.from.y) * k, e.from.z + (pm.position.z - e.from.z) * k);
    m.rotation.x = -0.5 * (1 - e.t);
    if (e.t >= 1) kill(p, 'eagle');
  } else {                                       // fly off with the player in its claws
    m.position.y += dt * 5; m.position.z -= dt * 7;
    pm.position.set(m.position.x, m.position.y - 0.5, m.position.z);
    pm.rotation.z += dt * 2;
  }
}

function tryMove(p, dx, dr) {
  if (!p.alive || p.eagle) return;   // once the eagle is coming there is no escape
  if (p.hop) { p.queue = [dx, dr]; return; }
  // rotation.y: 0 = forward (-z), PI = back, +PI/2 = left, -PI/2 = right
  p.facing = dr > 0 ? 0 : dr < 0 ? Math.PI : (dx > 0 ? -Math.PI / 2 : Math.PI / 2);
  const lane = lanes.get(p.row + dr);
  if (!lane) return;
  let tx = p.x + dx;
  if (lane.kind === 'river') { if (Math.abs(tx) > PLAY_HALF + 0.5) return; }   // lily pads: any column (water kills on landing)
  else {
    tx = Math.round(tx);
    if (Math.abs(tx) > PLAY_HALF) return;
    if (lane.kind === 'grass' && lane.trees.has(tx)) return;
  }
  if (p.row + dr < G.camRow - BEHIND_LIMIT) return;
  p.hop = {
    t: 0, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -(p.row + dr),
    carry: p.log, carryX0: p.log ? p.log.x : 0, span: p.log ? lanes.get(p.row).span : 0
  };
  p.row += dr;
  p.idleT = 0;
  if (p.row > p.score) { p.score = p.row; p.scoreEl.textContent = p.score; }
  sfx.hop(p.id);
  buzz(8);
}

const DEATH_SOUND = { splash: sfx.splash, slow: sfx.fall, eagle: sfx.fall };
function kill(p, cause) {
  if (!p.alive) return;
  p.alive = false; p.cause = cause; p.hop = null;
  buzz(70);
  (DEATH_SOUND[cause] || sfx.squash)();
  const { x, z } = p.mesh.position;
  if (cause === 'squash') { p.mesh.position.y = 0; p.mesh.userData.body.scale.set(1.35, 0.15, 1.35); }
  else if (cause === 'splash') burst(x, z, splashMat, 12);
  else if (cause === 'slow') burst(x, z, dustMat, 8);
  checkOver();
}

// small particle bursts: water for splashes, dust when a player is left behind
const parts = [];
const partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const splashMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const dustMat = new THREE.MeshLambertMaterial({ color: 0xd8d2c4 });
const coinMat = new THREE.MeshLambertMaterial({ color: COLORS.coin.face });
function burst(x, z, material, count) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(partGeo, material);
    m.position.set(x, 0.1, z);
    m.userData.v = new THREE.Vector3(fxRand(-2, 2), fxRand(3, 5), fxRand(-2, 2));
    scene.add(m); parts.push(m);
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i];
    m.userData.v.y -= 14 * dt;
    m.position.addScaledVector(m.userData.v, dt);
    if (m.position.y < -1) { scene.remove(m); parts.splice(i, 1); }
  }
}

function turnToward(m, target, dt) {
  let d = (target - m.rotation.y) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  m.rotation.y += d * Math.min(1, dt * 25);
}

function animateDeath(p, dt) {
  const m = p.mesh;
  if (p.cause === 'splash') m.position.y = Math.max(-1.2, m.position.y - dt * 2.5);
  else if (p.cause === 'swept') { m.position.y -= dt * 4; m.position.x += Math.sign(m.position.x) * dt * 2; }
  else if (p.cause === 'train') { m.position.x += p.trainDir * dt * TRAIN_SPEED; m.rotation.z += dt * 12; }
  else if (p.cause === 'slow') {   // tips over backwards and sinks out of view
    m.rotation.x = Math.max(-Math.PI / 2, m.rotation.x - dt * 6);
    m.position.y = Math.max(-0.6, m.position.y - dt * 0.8);
  }
}
function collectCoin(p, lane, coin) {
  lane.group.remove(coin);
  lane.coins.delete(p.x);
  coinMeshes.delete(coin);
  p.coins++;
  setBank(G.bank + 1);
  sfx.coin();
  buzz(15);
  burst(p.x, -p.row, coinMat, 6);
}
// returns false if the landing killed the player
function land(p, lane) {
  p.hop = null;
  p.log = null;
  if (lane && lane.kind === 'river') {
    const log = lane.objs.find(o => Math.abs(o.x - p.x) < o.len / 2 + 0.05);
    if (!log) { kill(p, 'splash'); return false; }
    // snap to the centre of the nearest log segment so standing feels solid
    const k = (log.len - 1) / 2;
    p.logOff = THREE.MathUtils.clamp(Math.round(p.x - log.x + k) - k, -k, k);
    p.log = log;
  } else {
    p.x = Math.round(p.x);
    if (lane && lane.kind === 'lily' && !lane.pads.has(p.x)) { kill(p, 'splash'); return false; }
    const coin = lane && lane.coins.get(p.x);
    if (coin) collectCoin(p, lane, coin);
  }
  p.mesh.userData.body.scale.set(1.15, 0.8, 1.15);
  if (p.queue) { const [qx, qr] = p.queue; p.queue = null; tryMove(p, qx, qr); }
  return true;
}
function stepHop(p, lane, dt) {
  const h = p.hop, m = p.mesh;
  h.t += dt / HOP_TIME;
  const t = Math.min(1, h.t);
  let drift = 0;
  if (h.carry) {   // a hop that starts on a log moves with the log
    drift = h.carry.x - h.carryX0;
    if (Math.abs(drift) > h.span / 2) drift -= Math.sign(drift) * h.span;   // the log wrapped around
  }
  p.x = h.fx + (h.tx - h.fx) * t + drift;
  m.position.set(p.x, Math.sin(t * Math.PI) * 0.45, h.fz + (h.tz - h.fz) * t);
  const stretch = Math.sin(t * Math.PI) * 0.16;   // taller in the air, a little thinner
  m.userData.body.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
  return t < 1 || land(p, lane);
}
// standing still (or riding a log); returns false if the log carried the player off the edge
function stand(p, dt) {
  const m = p.mesh;
  m.userData.body.scale.lerp(ONE, Math.min(1, dt * 14));
  p.breath += dt;
  m.userData.body.scale.y += Math.sin(p.breath * 5) * 0.02;   // a slow breath while standing
  if (!p.log) { m.position.y = 0; return true; }
  p.x = p.log.x + p.logOff;
  m.position.x = p.x; m.position.y = 0.1;
  if (Math.abs(p.x) > EDGE_DEATH) { kill(p, 'swept'); return false; }
  return true;
}
function checkHazards(p, lane) {
  // until mid-hop the player is still over the row they left
  const hz = p.hop && p.hop.t < 0.5 ? lanes.get(p.hop.fromRow) : lane;
  if (hz && hz.kind === 'road') {
    for (const o of hz.objs) if (Math.abs(o.x - p.x) < o.len / 2 + HIT_PAD) { kill(p, 'squash'); return; }
  } else if (hz && hz.kind === 'rail' && hz.train.active) {
    if (Math.abs(hz.train.x - p.x) < hz.train.len / 2 + HIT_PAD) { p.trainDir = hz.dir; kill(p, 'train'); return; }
  }
  if (p.row < G.camRow - BEHIND_LIMIT) kill(p, 'slow');
}
function updatePlayer(p, dt) {
  if (!p.mesh) return;
  turnToward(p.mesh, p.facing, dt);
  if (!p.alive) { if (p.eagle) updateEagle(p, dt); else animateDeath(p, dt); return; }
  const lane = lanes.get(p.row);
  const ok = p.hop ? stepHop(p, lane, dt) : stand(p, dt);
  if (ok && p.alive) checkHazards(p, lanes.get(p.row));
  if (!p.alive || G.state !== 'play') return;
  if (!p.hop) p.idleT += dt;
  if (!p.eagle && p.idleT > EAGLE_IDLE - EAGLE_SWOOP) sendEagle(p);
  if (p.eagle) updateEagle(p, dt);
}

export { DEATH_SOUND, animateDeath, burst, charOf, checkHazards, coinMat, collectCoin, despawn, dustMat, kill, land, partGeo, parts, pickIndex, players, sendEagle, spawn, splashMat, stand, stepHop, tryMove, turnToward, updateEagle, updateParts, updatePlayer };
