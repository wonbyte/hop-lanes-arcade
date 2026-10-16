import { sfx } from './audio.js';
import { $, G, HOP_TIME, LAND_DIP, TAU, TRAIN_SPEED } from './core.js';
import { t } from './i18n.js';
import { hatFor, isWater, traitOf } from './rules.js';
import { feedReplay, makeRules, resetPlayer } from './sim.js';
import { buzz } from './device.js';
import { ONE, reduceMotion, scene } from './gfx.js';
import { CHARACTERS, COLORS, eagleBoxes, makeCharacter } from './models.js';
import { checkOver } from './screens.js';
import { PICK_KEY, loadText, setBank } from './storage.js';
import { cachedGeo, voxelMesh } from './voxel.js';
import { Inst, blockColumn, dropSpinner, fxRand, lanes, unblockColumn } from './world.js';

// The two players: spawning, meshes, sounds and effects. The rules of a run (hops, logs, hazards, the shield, the
// eagle) are sim.js makeRules, the same code the score server replays; the hooks below only draw and play sounds.
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
// a soft dark spot on the ground under an animal in the air: it shows where the hop lands
const blobGeo = new THREE.BoxGeometry(0.62, 0.02, 0.62);
const blobMat = new THREE.MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
function spawn(p) {
  despawn(p);
  const ch = charOf(p), hat = hatFor(G.bestAll);
  p.mesh = makeCharacter(ch.boxes, ch.key, hat ? hat.key : '');
  scene.add(p.mesh);
  p.blob = new THREE.Mesh(blobGeo, blobMat);
  p.blob.visible = false;
  scene.add(p.blob);
  p.trait = traitOf(ch.key);   // the animal's edge (rules.js TRAITS)
  resetPlayer(p);
  p.breath = p.id * 1.7; p.label = '';
  p.mesh.position.set(p.x, 0, 0);
  p.scoreEl.textContent = '0';
  setLabel(p);
  if ((G.replay ? G.replay.handicap : G.handicap) === p.id + 1) giveShield(p);   // the handicap: a shield to start with
}
// the score number bounces when it grows; a combo of five or more bounces bigger (Web Animations: no layout work)
// (transform only: it stays on the compositor; the gold tint of a hot combo is a class)
const POP = [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.3 }, { transform: 'scale(1)' }];
const POP_BIG = [{ transform: 'scale(1)' }, { transform: 'scale(1.7) rotate(-4deg)', offset: 0.3 }, { transform: 'scale(1)' }];
function popScore(p) {
  const el = p.scoreEl, hot = p.combo >= 5;
  el.textContent = p.score;
  if (p.hot !== hot) { p.hot = hot; el.classList.toggle('hot', hot); }
  if (reduceMotion || !el.animate || (p.pop && p.pop.playState === 'running')) return;   // a pop still running keeps going
  p.pop = el.animate(hot ? POP_BIG : POP, { duration: hot ? 320 : 220, easing: 'ease-out' });
}
// the name over the score, plus the combo and the magnet while they last
function setLabel(p) {
  const text = t('P' + (p.id + 1)) + ' ' + t(charOf(p).name) + (p.combo >= 3 ? ' x' + p.combo : '') + (p.magnetT > 0 ? ' ' + t('MAGNET') : '') + (p.lead ? ' ' + t('SLOW') : '');
  if (text !== p.label) { p.label = text; $('score' + (p.id + 1)).querySelector('span').textContent = text; }
}
// ---------- power-ups ----------
const bubbleMat = new THREE.MeshLambertMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.35 });
const bubbleGeo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
function showBubble(p) {
  if (!p.mesh.userData.bubble) { const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.y = 0.5; p.mesh.add(b); p.mesh.userData.bubble = b; }
  p.mesh.userData.bubble.visible = true;
}
function despawn(p) {
  if (p.mesh) { scene.remove(p.mesh); p.mesh = null; }
  if (p.blob) { scene.remove(p.blob); p.blob = null; }
  if (p.eagle) { scene.remove(p.eagle.mesh); p.eagle = null; }
  p.alive = false;
}

// ---------- the eagle: stand still too long and it carries you away (sim.js sends it; this draws it) ----------
function sendEagle(p) {
  const mesh = voxelMesh(cachedGeo('eagle', eagleBoxes));
  const from = new THREE.Vector3(p.x, 6, -p.row - 5);
  mesh.position.copy(from);
  scene.add(mesh);
  Object.assign(p.eagle, { mesh, from });
  sfx.eagle();
}
function swoop(p) {   // swoop down to the player
  const e = p.eagle, m = e.mesh, pm = p.mesh;
  const k = e.t * e.t;
  m.position.set(e.from.x + (pm.position.x - e.from.x) * k, e.from.y + (0.55 - e.from.y) * k, e.from.z + (pm.position.z - e.from.z) * k);
  m.rotation.x = -0.5 * (1 - e.t);
}
function flyOff(p, dt) {   // fly off with the player in its claws
  const m = p.eagle.mesh, pm = p.mesh;
  m.position.y += dt * 5; m.position.z -= dt * 7;
  pm.position.set(m.position.x, m.position.y - 0.5, m.position.z);
  pm.rotation.z += dt * 2;
}

// hops are queued and applied at the start of the next fixed step, so a replay can play them on the same ticks
const moveQ = [];
function queueMove(i, dx, dr) { moveQ.push([i, dx, dr]); }
function applyMoves() {
  const rp = G.replay;
  if (rp) {   // a replay drives the players; the queue is dropped
    feedReplay(rp, G.playTick, (i, dx, dr) => tryMove(players[i], dx, dr));
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
const DEATH_SOUND = { splash: sfx.splash, slow: sfx.fall, eagle: sfx.fall, fall: sfx.fall, twister: sfx.fall };
const NEAR_FX = 0xfff2a8, PORTAL_FX = 0xd9a5ff;

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
// coins from play go to the bank (saved at game over); a replay pays nothing (the stats count them)
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
  else if (p.cause === 'fall') m.position.y = Math.max(-1.6, m.position.y - dt * 5);   // down the chasm
  else if (p.cause === 'twister') { m.position.y += dt * 3; m.rotation.y += dt * 14; }   // spun up into the sky
}
// what the rules do, shown: meshes, sounds, particles. Called by sim.js makeRules at the points where things happen.
const playRules = makeRules({
  G, lane: r => lanes.get(r), coins: addCoins, over: () => checkOver(), players,
  fx: {
    near(p) {   // a car just missed: a whoosh, a nudge of the view and a flash of dust
      sfx.whoosh(); buzz(12);
      G.shakeT = 0.18;
      if (!reduceMotion) burst(p.x, -p.row, NEAR_FX, 5, 0.5);
      setLabel(p);
    },
    lives(p) { sfx.cheer(); },   // the cat's extra life
    hop(p) {
      popScore(p);
      setLabel(p);
      if (p.hop.dx) G.hintTurn = true;   // the first-run TURN hint is done
      if (p.hop.high) sfx.bounce(); else if (p.hop.mud) sfx.mud(); else sfx.hop(p.id);
      buzz(8);
    },
    teleport(p, lane, fromX) {   // in one ring, out of the other
      sfx.teleport(); buzz(20);
      burst(fromX, -lane.r, PORTAL_FX, 8, 0.6); burst(p.x, -lane.r, PORTAL_FX, 8, 0.6);
      p.mesh.position.x = p.x;
    },
    bomb(p, other, lane, x) {   // the picker's bomb drops a rock in front of the other player
      sfx.bomb(); buzz(60);
      blockColumn(lane, x);
      burst(x, -lane.r, DUST, 12, 0.8);
      G.shakeT = 0.25;
    },
    unbomb: unblockColumn,
    combo(p) { sfx.coin(); burst(p.x, -p.row, COIN_FX, 4); },
    kill(p, cause) {
      buzz(70);
      G.lastDead = p;   // the game-over view closes in on it (app.js)
      (DEATH_SOUND[cause] || sfx.squash)();
      const { x, z } = p.mesh.position;
      if (cause === 'squash') { p.mesh.position.y = 0; p.mesh.userData.body.scale.set(1.35, 0.15, 1.35); }
      else if (cause === 'splash') burst(x, z, SPLASH, 12);
      else if (cause === 'slow' || cause === 'twister') burst(x, z, DUST, 8);
      if (cause === 'twister') sfx.wind();
      else if (cause === 'fall') sfx.crack();
    },
    rescue(p) {   // the hop back starts where the animal is drawn
      const bubble = p.mesh.userData.bubble;   // none yet when the cat's extra life saves it
      if (bubble) bubble.visible = false;
      p.hop.fz = p.mesh.position.z;
      sfx.eagle(); buzz(40);
      burst(p.mesh.position.x, p.mesh.position.z, SPLASH, 10);
    },
    shield: showBubble,
    power(p, lane, pw) {
      dropSpinner(pw.s);
      sfx.prize(); buzz(20);
      burst(p.x, -p.row, pw.kind === 'shield' ? SPLASH : COIN_FX, 8);
    },
    coin(p, lane, x, coin, secret) {
      dropSpinner(coin);
      sfx.coin();
      buzz(15);
      burst(x, -lane.r, COIN_FX, secret ? 14 : 6);
    },
    land(p, lane) {
      p.mesh.userData.body.scale.set(1.3, 0.62, 1.3);   // a squash on landing; stand() eases it back
      // a small puff where the feet land: dust on land, mud in mud, a splash on a log or a pad; the view dips a hair
      const wet = lane && isWater(lane.kind) && lane.kind !== 'cliff';   // a cliff counts as water for rescues, but it is stone
      if (!reduceMotion) { burst(p.x, -p.row, wet ? SPLASH : lane && lane.kind === 'mud' ? MUD_FX : DUST, 4, 0.45); G.landT = LAND_DIP; }
    },
    hopPose(p, t) {
      const h = p.hop, m = p.mesh;
      m.position.set(p.x, h.slide ? 0 : Math.sin(t * Math.PI) * (h.high ? 1.1 : 0.45), h.fz + (h.tz - h.fz) * t);   // an ice slide stays on the ground; a spring hop flies high
      const stretch = h.slide ? 0 : Math.sin(t * Math.PI) * 0.16;   // taller in the air, a little thinner
      m.userData.body.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
    },
    stand(p, dt) {   // standing still (or riding a log)
      const m = p.mesh;
      m.userData.body.scale.lerp(ONE, Math.min(1, dt * 16));
      p.breath += dt;
      m.userData.body.scale.y += Math.sin(p.breath * 5) * 0.02;   // a slow breath while standing
      if (!p.log) { m.position.y = 0; return; }
      m.position.x = p.x; m.position.y = 0.1;
    },
    warn() { sfx.warn(); },   // move, or the eagle comes
    eagle: sendEagle,
    swoop,
    label: setLabel
  }
});
const { giveShield, kill, tryMove } = playRules;
const resetRules = playRules.reset;   // screens.js toAttract: no bomb carries into the next game

// one fixed step: the rules (sim.js) move the player; a dead one is carried off by its death animation
function updatePlayer(p, dt) {
  if (!p.mesh) return;
  if (!p.alive) { if (p.eagle) flyOff(p, dt); else animateDeath(p, dt); return; }
  playRules.stepPlayer(p, dt);
}
// once per drawn frame, looks only: the turn toward the way it faces, the idle look-around, the safe-time blink
// and the shadow blob under a hop (nothing here changes the run)
function dressPlayer(p, dt) {
  if (!p.mesh) return;
  const look = p.alive && !p.hop && !p.eagle && p.idleT > 1.2 ? Math.sin((p.idleT - 1.2) * 1.8) * 0.4 : 0;
  turnToward(p.mesh, p.facing + look, dt);
  if (!p.alive) return;
  p.mesh.visible = !p.safeT || Math.floor(p.safeT * 12) % 2 === 0;
  const air = p.hop && p.mesh.position.y > 0.08;   // the blob shows only while the animal is up
  p.blob.visible = !!air;
  if (air) p.blob.position.set(p.mesh.position.x, 0.02, p.mesh.position.z);
}

export { blobGeo, blobMat, bubbleGeo, bubbleMat, charOf, despawn, dressPlayer, restorePicks, giveShield, kill, players, queueMove, applyMoves, resetRules, spawn, tryMove, updateParts, updatePlayer };
