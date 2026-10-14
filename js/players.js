import { sfx } from './audio.js';
import { $, BEHIND_LIMIT, COMBO_EVERY, COMBO_GAP, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, G, HIT_PAD, HOP_TIME, MAGNET_REACH, MAGNET_TIME, PLAY_HALF, SHIELD_TIME, TAU, TRAIN_SPEED } from './core.js';
import { t } from './i18n.js';
import { hopTarget, hopTime } from './rules.js';
import { buzz } from './device.js';
import { ONE, reduceMotion, scene } from './gfx.js';
import { CHARACTERS, COLORS, eagleBoxes, makeCharacter } from './models.js';
import { checkOver } from './screens.js';
import { PICK_KEY, loadText, setBank } from './storage.js';
import { cachedGeo, voxelMesh } from './voxel.js';
import { Inst, dropSpinner, fxRand, lanes } from './world.js';

// The two players: spawning, hopping, riding logs, coins, deaths and the eagle.
// ---------- players ----------
// the character each player picked last time (saved per player slot)
function pickIndex(i, fallback) {
  const k = CHARACTERS.findIndex(c => c.key === loadText(PICK_KEY + i));
  return k >= 0 ? k : fallback;
}
// a replay picks its own animals; after it each slot goes back to its saved pick
function restorePicks() { players.forEach((p, i) => { p.charIndex = pickIndex(i, i); }); }
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
    x: p.startX, row: 0, alive: true, hop: null, queue: null, score: 0, idleT: 0, warned: false, eagle: null, breath: p.id * 1.7,
    facing: 0, cause: '', log: null, logOff: 0, trainDir: 0,
    combo: 0, lastHop: -9, shield: false, safeT: 0, magnetT: 0, label: ''
  });
  p.mesh.position.set(p.x, 0, 0);
  p.scoreEl.textContent = '0';
  setLabel(p);
  if ((G.replay ? G.replay.handicap : G.handicap) === p.id + 1) giveShield(p);   // the handicap: a shield to start with
}
// the name over the score, plus the combo and the magnet while they last
function setLabel(p) {
  const text = 'P' + (p.id + 1) + ' ' + t(charOf(p).name) + (p.combo >= 3 ? ' x' + p.combo : '') + (p.magnetT > 0 ? ' ' + t('MAGNET') : '');
  if (text !== p.label) { p.label = text; $('score' + (p.id + 1)).querySelector('span').textContent = text; }
}
// ---------- power-ups ----------
const bubbleMat = new THREE.MeshLambertMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.35 });
const bubbleGeo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
function giveShield(p) {
  p.shield = true;
  if (!p.mesh.userData.bubble) { const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.y = 0.5; p.mesh.add(b); p.mesh.userData.bubble = b; }
  p.mesh.userData.bubble.visible = true;
}
function pickPower(p, lane) {
  const pw = lane.power;
  lane.power = null;
  dropSpinner(pw.s);
  if (pw.kind === 'shield') giveShield(p); else p.magnetT = MAGNET_TIME;
  if (G.run) G.run.powers++;
  sfx.prize(); buzz(20);
  burst(p.x, -p.row, pw.kind === 'shield' ? SPLASH : COIN_FX, 8);
}
// the shield takes one hit: the player hops back to the nearest solid row behind and can not be hit for a moment.
// Returns false (the hit kills after all) when there is no solid row behind.
function rescue(p) {
  let r = null;
  for (let k = p.row - 1; k >= G.camRow - BEHIND_LIMIT; k--) {
    const l = lanes.get(k);
    if (l && l.kind !== 'river' && l.kind !== 'lily') { r = k; break; }
  }
  if (r === null) return false;
  p.shield = false;
  p.mesh.userData.bubble.visible = false;
  p.safeT = SHIELD_TIME;
  sfx.eagle(); buzz(40);
  burst(p.mesh.position.x, p.mesh.position.z, SPLASH, 10);
  const tx = Math.max(-PLAY_HALF, Math.min(PLAY_HALF, Math.round(p.x)));
  p.hop = { t: 0, dur: HOP_TIME * 2, fromRow: p.row, fx: p.x, fz: p.mesh.position.z, tx, tz: -r, carry: null, carryX0: 0, span: 0 };
  p.queue = null; p.log = null; p.row = r;
  return true;
}
function updateMagnet(p, dt) {
  p.magnetT = Math.max(0, p.magnetT - dt);
  if (!p.magnetT) return;
  for (let r = p.row - 1; r <= p.row + 1; r++) {
    const lane = lanes.get(r);
    if (!lane) continue;
    for (const [x, coin] of lane.coins) if (Math.abs(x - p.x) <= MAGNET_REACH) collectCoin(p, lane, x, coin);
  }
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

// hops are queued and applied at the start of the next fixed step, so a replay can play them on the same ticks
const moveQ = [];
function queueMove(i, dx, dr) { moveQ.push([i, dx, dr]); }
function applyMoves() {
  const rp = G.replay;
  if (rp) {   // a replay drives the players; the queue is dropped
    while (rp.i < rp.events.length && rp.events[rp.i][0] <= G.playTick) { const [, i, dx, dr] = rp.events[rp.i++]; tryMove(players[i], dx, dr); }
    moveQ.length = 0;
    return;
  }
  for (const [i, dx, dr] of moveQ) {
    const p = players[i];
    if (!p.joined || !p.alive) continue;
    G.record.push([G.playTick, i, dx, dr]);
    tryMove(p, dx, dr);
  }
  moveQ.length = 0;
}
function tryMove(p, dx, dr) {
  if (!p.alive || p.eagle) return;   // once the eagle is coming there is no escape
  if (p.hop) { p.queue = [dx, dr]; return; }
  // rotation.y: 0 = forward (-z), PI = back, +PI/2 = left, -PI/2 = right
  p.facing = dr > 0 ? 0 : dr < 0 ? Math.PI : (dx > 0 ? -Math.PI / 2 : Math.PI / 2);
  const tx = hopTarget(lanes.get(p.row + dr), p.x, dx, PLAY_HALF);
  if (tx === null) return;
  if (p.row + dr < G.camRow - BEHIND_LIMIT) return;
  const from = lanes.get(p.row);
  p.hop = {
    t: 0, dur: hopTime(from && from.kind, HOP_TIME), fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -(p.row + dr),
    carry: p.log, carryX0: p.log ? p.log.x : 0, span: p.log ? from.span : 0
  };
  p.row += dr;
  p.idleT = 0; p.warned = false;
  if (p.row > p.score) { p.score = p.row; p.scoreEl.textContent = p.score; if (G.run) G.run.row = Math.max(G.run.row, p.score); }
  if (G.run) G.run.hops++;
  // quick hops in a row build a combo; every COMBO_EVERY hops of it pay a coin
  p.combo = G.playT - p.lastHop < COMBO_GAP ? p.combo + 1 : 1;
  p.lastHop = G.playT;
  if (G.run) G.run.combo = Math.max(G.run.combo, p.combo);
  if (p.combo >= COMBO_EVERY && p.combo % COMBO_EVERY === 0) { addCoins(1); sfx.coin(); burst(p.x, -p.row, COIN_FX, 4); }
  setLabel(p);
  if (p.hop.dur > HOP_TIME) sfx.mud(); else sfx.hop(p.id);
  buzz(8);
}

const DEATH_SOUND = { splash: sfx.splash, slow: sfx.fall, eagle: sfx.fall };
function kill(p, cause) {
  if (!p.alive) return;
  // just after a rescue cars and trains pass through you, but water still does not hold you up
  if ((cause === 'squash' || cause === 'train') && p.safeT > 0) return;
  if ((cause === 'squash' || cause === 'train' || cause === 'splash') && p.shield && rescue(p)) return;
  p.alive = false; p.cause = cause; p.hop = null;
  buzz(70);
  (DEATH_SOUND[cause] || sfx.squash)();
  const { x, z } = p.mesh.position;
  if (cause === 'squash') { p.mesh.position.y = 0; p.mesh.userData.body.scale.set(1.35, 0.15, 1.35); }
  else if (cause === 'splash') burst(x, z, SPLASH, 12);
  else if (cause === 'slow') burst(x, z, DUST, 8);
  checkOver();
}

// small particle bursts: water for splashes, dust when a player is left behind
// the meshes are pooled: a death makes no garbage, so no collector pause
// Every particle is an instance of one small white box, tinted per particle: one draw call for all of them.
// The handles are pooled, so a burst makes no garbage.
const parts = [], partPool = [];
const SPLASH = 0xffffff, DUST = 0xd8d2c4, MUD_FX = 0x6b4a2c, COIN_FX = COLORS.coin.face;
const partBoxes = () => [[0.14, 0.14, 0.14, 0xffffff, 0, -0.07, 0]];
function burst(x, z, color, count, power = 1) {
  for (let i = 0; i < count; i++) {
    const q = partPool.pop() || { inst: new Inst('part', partBoxes, false), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    q.inst.paint(color);
    q.x = x; q.y = 0.1; q.z = z;
    q.vx = fxRand(-2, 2) * power; q.vy = fxRand(3, 5) * power; q.vz = fxRand(-2, 2) * power;
    q.inst.set(x, 0.1, z);
    parts.push(q);
  }
}
// effects only: runs once per drawn frame, not per game step
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.vy -= 14 * dt;
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    if (q.y < -1) { q.inst.set(0, 0, 0, 0, false); parts[i] = parts[parts.length - 1]; parts.pop(); partPool.push(q); }
    else q.inst.move(q.x, q.y, q.z);
  }
}
// coins from play go to the bank (saved at game over); a replay pays nothing
function addCoins(n) {
  if (G.run) G.run.coins += n;
  if (!G.replay) setBank(G.bank + n, true);
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
function collectCoin(p, lane, x, coin) {
  lane.coins.delete(x);
  dropSpinner(coin);
  const secret = lane.secret === x;
  addCoins(secret ? 3 : 1);
  if (secret && G.run) G.run.secrets++;
  sfx.coin();
  buzz(15);
  burst(x, -lane.r, COIN_FX, secret ? 14 : 6);
}
// returns false if the landing killed the player
function land(p, lane) {
  const from = lanes.get(p.hop.fromRow);
  p.hop = null;
  p.log = null;
  if (lane && lane.kind === 'river') {
    const log = lane.objs.find(o => Math.abs(o.x - p.x) < o.len / 2 + 0.05);
    if (!log) { kill(p, 'splash'); return p.alive; }
    // snap to the centre of the nearest log segment so standing feels solid
    const k = (log.len - 1) / 2;
    p.logOff = THREE.MathUtils.clamp(Math.round(p.x - log.x + k) - k, -k, k);
    p.log = log;
    if (G.run) G.run.logs++;
  } else {
    p.x = Math.round(p.x);
    if (lane && lane.kind === 'lily' && !lane.pads.has(p.x)) { kill(p, 'splash'); return p.alive; }
    if (G.run && from && from.kind === 'river' && lane && lane.r > from.r) G.run.rivers++;   // crossed a river
    const coin = lane && lane.coins.get(p.x);
    if (coin) collectCoin(p, lane, p.x, coin);
    if (lane && lane.power && lane.power.x === p.x) pickPower(p, lane);
  }
  p.mesh.userData.body.scale.set(1.15, 0.8, 1.15);
  // a small puff where the feet land: dust on land, mud in mud, a splash on a log or a pad
  const wet = lane && (lane.kind === 'river' || lane.kind === 'lily');
  if (!reduceMotion) burst(p.x, -p.row, wet ? SPLASH : lane && lane.kind === 'mud' ? MUD_FX : DUST, 3, 0.4);
  if (p.queue) { const [qx, qr] = p.queue; p.queue = null; tryMove(p, qx, qr); }
  return true;
}
function stepHop(p, lane, dt) {
  const h = p.hop, m = p.mesh;
  h.t += dt / h.dur;
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
  // standing a while, the animal looks around
  const look = p.alive && !p.hop && !p.eagle && p.idleT > 1.2 ? Math.sin((p.idleT - 1.2) * 1.8) * 0.4 : 0;
  turnToward(p.mesh, p.facing + look, dt);
  if (!p.alive) { if (p.eagle) updateEagle(p, dt); else animateDeath(p, dt); return; }
  if (p.safeT > 0) { p.safeT = Math.max(0, p.safeT - dt); p.mesh.visible = !p.safeT || Math.floor(p.safeT * 12) % 2 === 0; }
  const lane = lanes.get(p.row);
  const ok = p.hop ? stepHop(p, lane, dt) : stand(p, dt);
  if (ok && p.alive && !p.safeT) checkHazards(p, lanes.get(p.row));
  if (!p.alive || G.state !== 'play') return;
  if (p.magnetT) { updateMagnet(p, dt); if (!p.magnetT) setLabel(p); }
  if (p.combo && !p.hop && G.playT - p.lastHop > COMBO_GAP + 0.2) { p.combo = 0; setLabel(p); }
  if (!p.hop) p.idleT += dt;
  if (!p.warned && p.idleT > EAGLE_IDLE - EAGLE_SWOOP - EAGLE_WARN) { p.warned = true; sfx.warn(); }   // move, or the eagle comes
  if (!p.eagle && p.idleT > EAGLE_IDLE - EAGLE_SWOOP) sendEagle(p);
  if (p.eagle) updateEagle(p, dt);
}

export { charOf, despawn, restorePicks, giveShield, kill, players, queueMove, applyMoves, spawn, tryMove, updateParts, updatePlayer };
