import { sfx } from './audio.js';
import { $, G, LAND_DIP, PLAY_HALF, TAU, TRAIN_SPEED } from './core.js';
import { t } from './i18n.js';
import { hatFor, isWater, traitOf } from './rules.js';
import { feedReplay, makeRules, resetPlayer } from './sim.js';
import { buzz } from './device.js';
import { ONE, camera, reduceMotion, scene, stage, viewSize } from './gfx.js';
import { CHARACTERS, COLORS, eagleBoxes, makeCharacter } from './models.js';
import { PICK_KEY, loadText, paintOf, setBank } from './storage.js';
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
// the score chip of player n: the name, the number, and the pills (OUT, the combo, the magnet with its time bar, SLOW)
function chipOf(n) {
  const el = $('score' + n), q = sel => /** @type {HTMLElement} */ (el.querySelector(sel));
  return { el, lbl: q('.lbl'), out: q('.out'), combo: q('.combo'), mag: q('.mag'), magText: q('.mag span'), bar: q('.mag s'), slow: q('.slow'), barW: -1 };
}
// a replay picks its own animals; after it each slot goes back to its saved pick
function restorePicks() { players.forEach((p, i) => { p.charIndex = pickIndex(i, i); }); }
const players = [
  { id: 0, charIndex: pickIndex(0, 0), startX: -2, joined: false, scoreEl: $('score1').querySelector('b'), chip: chipOf(1) },
  { id: 1, charIndex: pickIndex(1, 1), startX: 2, joined: false, scoreEl: $('score2').querySelector('b'), chip: chipOf(2) }
];
const charOf = p => CHARACTERS[p.charIndex];
// a soft dark spot on the ground under an animal in the air: it shows where the hop lands
const blobGeo = new THREE.BoxGeometry(0.62, 0.02, 0.62);
const blobMat = new THREE.MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
function spawn(p) {
  despawn(p);
  const ch = charOf(p), hat = hatFor(G.bestAll);
  p.mesh = makeCharacter(ch.boxes, ch.key, hat ? hat.key : '', paintOf(ch.key));
  scene.add(p.mesh);
  p.blob = new THREE.Mesh(blobGeo, blobMat);
  p.blob.visible = false;
  scene.add(p.blob);
  p.trait = traitOf(ch.key);   // the animal's edge (rules.js TRAITS)
  resetPlayer(p);
  p.breath = p.id * 1.7; p.label = '';
  p.mesh.position.set(p.x, 0, 0);
  p.scoreEl.textContent = '0';
  p.hot = false; p.scoreEl.classList.remove('hot'); p.restT = 0;   // the gold tint of the last game's combo goes
  p.crouchT = 0; p.magMax = 0;
  p.chip.el.classList.remove('dead', 'alarm', 'steady');
  setLabel(p);
  if (G.runHandicap === p.id + 1) giveShield(p);   // the handicap of this run (screens.js join): a shield to start with
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
// the name over the score, and the pills: the combo, the magnet while it lasts, SLOW for a two-player leader, OUT for
// a fallen player while the other plays on (the DOM is touched only when something changed)
function setLabel(p) {
  const out = !p.alive && G.twoUp && G.state === 'play';
  const text = t('P' + (p.id + 1)) + ' ' + t(charOf(p).name) + '|' + (p.combo >= 3 ? p.combo : '') + '|' + (p.magnetT > 0) + '|' + !!p.lead + '|' + out;
  if (text === p.label) return;
  p.label = text;
  const c = p.chip;
  c.lbl.textContent = text.split('|')[0];
  c.combo.hidden = p.combo < 3; c.combo.textContent = 'x' + p.combo;
  if (p.magnetT > 0 && c.mag.hidden) { p.magMax = p.magnetT; c.magText.textContent = t('MAGNET'); }
  c.mag.hidden = !(p.magnetT > 0);
  c.slow.hidden = !p.lead; c.slow.textContent = t('SLOW');
  c.out.hidden = !out; c.out.textContent = t('OUT');
  c.el.classList.toggle('dead', out);
}
// per drawn frame: the magnet's time bar shrinks (a transform, in 2% steps)
function magnetBar(p) {
  const c = p.chip;
  if (c.mag.hidden || !p.magMax) return;
  const w = Math.round(Math.max(0, p.magnetT / p.magMax) * 50) / 50;
  if (w !== c.barW) { c.barW = w; c.bar.style.transform = 'scaleX(' + w + ')'; }
}
// a warning for one player (the eagle is coming, the rapids are near): a red ring flashes on the chip twice (steady
// under reduced motion) and the screen reader says who must move
function alarm(p) {
  const el = p.chip.el, cls = reduceMotion ? 'steady' : 'alarm';
  el.classList.remove('alarm', 'steady');
  void el.offsetWidth;   // restart the flash
  el.classList.add(cls);
  clearTimeout(p.alarmT);
  p.alarmT = setTimeout(() => el.classList.remove(cls), reduceMotion ? 1200 : 400);
  document.dispatchEvent(new CustomEvent('hoplanes:say', { detail: t('PLAYER {n}: MOVE!', { n: p.id + 1 }) }));
}
// a finger on the field: the animal crouches for a moment (looks only); the hop comes when the finger lifts
const CROUCH_T = 0.06;
function crouch(i) {
  const p = players[i];
  if (p.joined && p.alive && p.mesh) p.crouchT = CROUCH_T;
}
// ---------- words over the animals: WAIT FOR P2, +LIFE (DOM, placed once per drawn frame) ----------
const bubbles = [];
const bubblePos = new THREE.Vector3();
function say(p, text, kind) {
  let b = bubbles.find(q => q.p === p && q.kind === kind);
  if (!b) {
    const el = document.createElement('div');
    el.className = 'say ' + kind;
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(document.createElement('span'));
    stage.appendChild(el);
    b = { p, kind, el, t: 0, x: -1, y: -1 };
    bubbles.push(b);
  }
  b.el.firstChild.textContent = text; b.t = kind === 'pop' ? 1.2 : 1;
}
// the rope between the two animals: a thin box stretched from one to the other, for a second
const ropeMat = new THREE.MeshLambertMaterial({ color: 0xffd84a });
let ropeM = null, ropeT = 0, ropeA = null, ropeB = null;
function rope(a, b) {
  if (!a.mesh || !b.mesh) return;
  if (!ropeM) { ropeM = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.05), ropeMat); scene.add(ropeM); }
  ropeA = a; ropeB = b; ropeT = 1; ropeM.visible = true;
}
function placeRope(dt) {
  if (!ropeM || !ropeM.visible) return;
  ropeT -= dt;
  if (ropeT <= 0 || !ropeA.mesh || !ropeB.mesh) { ropeM.visible = false; return; }
  const a = ropeA.mesh.position, b = ropeB.mesh.position, dx = b.x - a.x, dz = b.z - a.z;
  ropeM.position.set((a.x + b.x) / 2, 0.45, (a.z + b.z) / 2);
  ropeM.scale.x = Math.max(0.01, Math.hypot(dx, dz));
  ropeM.rotation.y = -Math.atan2(dz, dx);
}
// an eagle the robot shook off flies away on its own
const leaving = [];
function flyAway(dt) {
  for (let i = leaving.length - 1; i >= 0; i--) {
    const m = leaving[i];
    m.position.y += dt * 6; m.position.z -= dt * 6;
    if (m.position.y > 14) { scene.remove(m); leaving.splice(i, 1); }
  }
}
// once per drawn frame (app.js): the words follow their animal and fade; the rope and a leaving eagle move
function placeBubbles(dt) {
  placeRope(dt); flyAway(dt);
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.t -= dt;
    if (b.t <= 0 || !b.p.mesh) { b.el.remove(); bubbles.splice(i, 1); continue; }
    bubblePos.copy(b.p.mesh.position); bubblePos.y += 1.4 + (b.kind === 'pop' ? (1.2 - b.t) * 0.8 : 0);
    bubblePos.project(camera);
    const x = Math.round((bubblePos.x + 1) / 2 * viewSize.w), y = Math.round((1 - bubblePos.y) / 2 * viewSize.h);
    if (x !== b.x || y !== b.y) { b.x = x; b.y = y; b.el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  }
}
// rules 4: a fallen player hops back in (sim.js chose the place and the safe time): a new animal, a pop and a sound,
// and the chip lights up again. eagle: the one that carried it off (its mesh goes)
function comeBack(p, eagle) {
  if (eagle && eagle.mesh) scene.remove(eagle.mesh);
  if (p.mesh) scene.remove(p.mesh);
  const ch = charOf(p), hat = hatFor(G.bestAll);
  p.mesh = makeCharacter(ch.boxes, ch.key, hat ? hat.key : '', paintOf(ch.key));
  p.mesh.position.set(p.x, 0, -p.row);
  p.mesh.userData.body.scale.set(1.3, 0.62, 1.3);   // lands with a squash; stand() eases it back
  scene.add(p.mesh);
  if (p.blob) p.blob.visible = false;
  p.restT = 0;
  sfx.join(); buzz(30);
  if (!reduceMotion) burst(p.x, -p.row, NEAR_FX, 10, 0.7);
  say(p, t('BACK IN!'), 'pop');
  setLabel(p);
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
const NEAR_FX = 0xfff2a8, PORTAL_FX = 0xd9a5ff, EDGE_FX = 0xff5a4a;

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
// the end of a game: screens.js registers its results (checkOver) here, so the two modules need no cycle
let overHook = () => {};
const onGameOver = fn => { overHook = fn; };
// what the rules do, shown: meshes, sounds, particles. Called by sim.js makeRules at the points where things happen.
const fx = {
  leashed(p, other) {   // rules 4: a two-player hop too far ahead of the partner is refused
    say(p, t('WAIT FOR {who}', { who: t('P' + (other.id + 1)) }), 'wait');
    rope(p, other);
    sfx.nope();
  },
  rejoin: comeBack,
  trait(p, kind) {   // an animal's edge did its job: the cat's extra life, the robot shaking off the eagle
    if (kind === 'robot' && p.eagle && p.eagle.mesh) { leaving.push(p.eagle.mesh); sfx.eagle(); }
    say(p, t(kind === 'cat' ? '+LIFE' : 'SHOOK OFF THE EAGLE!'), 'pop');
  },
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
    setLabel(p);   // OUT on the chip while the other player plays on
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
    setLabel(p);   // the magnet pill
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
    if (lane && (lane.kind === 'bridge' || lane.kind === 'cliff')) sfx.crack();   // the plank or tile starts to give
  },
  edge(p) {   // a log carried the rider past the last column: the rapids are near, hop
    sfx.warn(); buzz(30); alarm(p);
    if (!reduceMotion) burst(p.x, -p.row, EDGE_FX, 6, 0.5);
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
  warn(p) { sfx.warn(); alarm(p); },   // move, or the eagle comes
  eagle: sendEagle,
  swoop,
  label: setLabel
};
const playRules = makeRules({ G, lane: r => lanes.get(r), coins: addCoins, over: () => overHook(), players, fx });
const { giveShield, kill, tryMove } = playRules;
const resetRules = playRules.reset;   // screens.js toAttract: no bomb carries into the next game

// one fixed step: the rules (sim.js) move the player; a dead one is carried off by its death animation.
// The rules run in the countdown and in play, and to the end of the step the run ended in (sim.js steps every player
// in that step too); after that a survivor only stands: no log carries it off, no car or coin counts in the results.
function updatePlayer(p, dt) {
  if (!p.mesh) return;
  if (!p.alive) { if (p.eagle) flyOff(p, dt); else animateDeath(p, dt); return; }
  if (G.state === 'play' || G.state === 'countdown' || G.tick === G.overTick) playRules.stepPlayer(p, dt);
  else restAfterRun(p, dt);
}
// a survivor at game over (looks only, the run is decided): a hop in the air lands, a rider drifts on with its log
// as far as the edge of the field, and it breathes
const REST_EDGE = PLAY_HALF + 0.5;
function restAfterRun(p, dt) {
  const h = p.hop;
  if (h && p.restT < 1) { p.restT = Math.min(1, Math.max(p.restT, h.t) + dt / h.dur); fx.hopPose(p, p.restT); return; }
  fx.stand(p, dt);
  if (p.log && !h) p.mesh.position.x = Math.max(-REST_EDGE, Math.min(REST_EDGE, p.log.x + p.logOff));
}
// once per drawn frame, looks only: the turn toward the way it faces, the idle look-around, the safe-time blink
// and the shadow blob under a hop (nothing here changes the run)
function dressPlayer(p, dt) {
  if (!p.mesh) return;
  magnetBar(p);
  if (p.crouchT > 0) { p.crouchT = Math.max(0, p.crouchT - dt); if (p.alive && !p.hop) p.mesh.userData.body.scale.y = 0.8; }
  const look = p.alive && !p.hop && !p.eagle && p.idleT > 1.2 ? Math.sin((p.idleT - 1.2) * 1.8) * 0.4 : 0;
  turnToward(p.mesh, p.facing + look, dt);
  if (!p.alive) return;
  p.mesh.visible = !p.safeT || Math.floor(p.safeT * 12) % 2 === 0;
  const air = p.hop && p.mesh.position.y > 0.08;   // the blob shows only while the animal is up
  p.blob.visible = !!air;
  if (air) p.blob.position.set(p.mesh.position.x, 0.02, p.mesh.position.z);
}

export { blobGeo, blobMat, bubbleGeo, bubbleMat, charOf, crouch, despawn, fx, placeBubbles, dressPlayer, onGameOver, restorePicks, giveShield, kill, players, queueMove, applyMoves, resetRules, spawn, tryMove, updateParts, updatePlayer };
