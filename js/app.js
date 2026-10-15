import { idleAudio, isMuted, playLayers, playLoopOn, sfx, startTune, stopTune, tuneOn } from './audio.js';
import { $, BIOME_ROWS, COUNTDOWN, DEBUG, G, OVER_SLOW, OVER_SLOW_T, OVER_ZOOM, REPLAY_CODE, RESULTS_DELAY, STEP, TUTORIAL_SEED } from './core.js';
import { pollGamepads } from './input.js';   // also sets up every input listener
import { decodeReplay } from './replay.js';
import { creepCamera } from './sim.js';
import { ghostInfo, ghostMat, ghostWarmGeo, placeGhost, stepGhost } from './ghost.js';
import { CHARACTERS, LIGHT_OFF, lightGeo } from './models.js';
import { CAM_OFF, SUN_OFF, camera, focus, getPixelRatio, reduceMotion, renderer, scene, setNight, setZoom, shadowCadence, sun, touchQuery, viewInfo, watchFrameTime } from './gfx.js';
import { announceFrame } from './panels.js';   // also sets up the settings, pause and top-10 panels
import { keepAwake } from './device.js';
import { flushBank } from './storage.js';
import { applyMoves, blobGeo, blobMat, bubbleGeo, bubbleMat, giveShield, kill, players, updateParts, updatePlayer } from './players.js';
import { join, resultsEl, setBanner, setModeLabel, showHowto, startPlay, toAttract } from './screens.js';
import { HINT_KEY, HOWTO_KEY, dailySeed, loadText, owned, save } from './storage.js';
import { biomeAt, biomeIndex, ensureLanes, getSeed, laneCoins, laneKinds, lanes, showLane, spinAll, updateFarLanes, updateLanes, weatherAt } from './world.js';
import { t } from './i18n.js';

// The game loop and boot. main.js loads this once Three.js is present.
// ---------- loop ----------
function updateCountdown(dt) {
  const before = Math.ceil(G.countdown);
  G.countdown -= dt;
  const n = Math.ceil(G.countdown);
  if (n !== before && n > 0) sfx.tick();
  if (G.countdown <= 0) { G.countKey = ''; startPlay(); return; }
  // the banner text is built only when the number or the players change
  const both = players[0].joined && players[1].joined, key = n + '|' + both;
  if (key === G.countKey) return;
  G.countKey = key;
  setBanner(String(n), (G.replay ? t('REPLAY') : both ? t('FROG VS FOX') : t('OTHER PLAYER: TAP TO JOIN'))
    + (touchQuery.matches && !G.replay ? '\n' + t('TAP TO HOP · SWIPE TO TURN') : ''));
}
function updateCamera(dt) {
  G.playT += dt;
  if (G.goT > 0 && (G.goT -= dt) <= 0) setBanner('');
  // a new land every BIOME_ROWS rows: its name shows for a moment
  const block = Math.floor(G.camRow / BIOME_ROWS);
  if (block > G.biomeBlock) { G.biomeBlock = block; if (block > 0) { setBanner(t(biomeAt(G.camRow).name)); G.goT = 1.6; sfx.cheer(); } }
  let lead = -Infinity;
  for (const p of players) if (p.joined && p.alive) lead = Math.max(lead, p.row);
  G.camRow = creepCamera(G.camRow, G.playT, lead, dt);   // the one copy of the creep rule (sim.js)
}
function placeCamera() {
  focus.set(G.overX, 0, -(G.camRow + G.camLead));
  if (G.shakeT > 0) focus.x += Math.sin(G.shakeT * 90) * G.shakeT * 0.5;   // a near miss nudges the view
  if (G.landT > 0) focus.y -= Math.sin(G.landT / LAND_DIP * Math.PI) * 0.07;   // a landing dips the view a hair
  camera.position.copy(focus).add(CAM_OFF);
  camera.lookAt(focus);
  sun.position.copy(focus).add(SUN_OFF);
  sun.target.position.copy(focus);
  const focusRow = G.camRow + G.camLead;
  G.weather = weatherAt(Math.round(focusRow));
  setNight(G.camRow, G.weather, biomeAt(focusRow).sky);
  for (const lane of lanes.values()) showLane(lane, Math.abs(lane.r - focusRow) < G.visRows);
}

// first run: a floating hint follows the first player. On the tutorial world (TUTORIAL_SEED) it is a short guided
// walk, one line per lane ahead, until row HINT_ROWS; on any other world a plain TAP (or key) hint until row 5.
const hintEl = $('hint');
const hintPos = new THREE.Vector3();
const HINT_ROWS = 12;
const LANE_HINT = { road: 'WAIT FOR A GAP', river: 'HOP ON A LOG', rail: 'MIND THE TRAIN', lily: 'PADS ONLY' };
function hintText(p) {
  const next = lanes.get(p.row + 1), key = next && LANE_HINT[next.kind];
  if (key) return t(key);
  if (p.score >= 2 && !G.hintTurn) return t(touchQuery.matches ? 'SWIPE TO TURN' : p.id ? '\u2190 \u2192 TO TURN' : 'A D TO TURN');
  return (touchQuery.matches ? t('TAP') : p.id ? '\u2191' : 'W') + ' \u25b2';
}
function placeHint() {
  if (!G.hint) { if (!hintEl.hidden) hintEl.hidden = true; return; }
  const p = players.find(q => q.joined && q.alive);
  if (G.state !== 'play' || !p || !p.mesh) { hintEl.hidden = true; return; }
  if (p.score >= (getSeed() === TUTORIAL_SEED ? HINT_ROWS : 5)) { G.hint = false; save(HINT_KEY, 1); hintEl.hidden = true; return; }
  hintPos.set(p.x, 1.5, p.mesh.position.z).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  hintEl.style.left = (hintPos.x + 1) / 2 * r.width + 'px';
  hintEl.style.top = (1 - hintPos.y) / 2 * r.height + 'px';
  const text = hintText(p);
  if (hintEl.textContent !== text) hintEl.textContent = text;
  hintEl.hidden = false;
}
// game over: the world slows for a moment and the view closes in on the fallen player; the title puts it back
const LAND_DIP = 0.14;
let seenState = '';
function overFx(dt) {
  if (G.state !== seenState) {
    seenState = G.state;
    if (G.state === 'over') { G.slowT = OVER_SLOW_T; }
    else if (G.state === 'attract') { G.overX = 0; G.lastDead = null; G.biomeBlock = 0; setZoom(1); }
  }
  if (G.state !== 'over' || reduceMotion) return;
  const k = Math.min(1, dt * 4);
  setZoom(camera.zoom + (OVER_ZOOM - camera.zoom) * k);
  const d = G.lastDead;
  if (d && d.mesh) G.overX += (Math.max(-3, Math.min(3, d.mesh.position.x)) * 0.5 - G.overX) * k;
}
// one fixed step of the game: the same hops on the same ticks give the same run (replays)
function step(dt) {
  if (DEBUG && G.boom) { G.boom = false; throw new Error('test crash'); }   // hopLanes.boom(): the crash notice test
  G.tick++; G.worldTick++; G.stateT += dt;
  if (G.shakeT > 0) G.shakeT = Math.max(0, G.shakeT - dt);
  if (G.state === 'countdown') updateCountdown(dt);
  else if (G.state === 'play') { G.playTick++; applyMoves(); updateCamera(dt); stepGhost(); }
  else if (G.state === 'over' && G.stateT > RESULTS_DELAY && resultsEl.hidden) resultsEl.hidden = false;
  ensureLanes();
  updateLanes(players);   // only the lanes a player can touch; the rest move once per drawn frame
  for (const p of players) updatePlayer(p, dt);
}
const DRAW_INTERVAL = 1000 / 60, MAX_STEPS = 6;   // after a long stall, time is dropped rather than caught up
let lastT = performance.now(), nextDraw = 0, lastDraw = 0, acc = 0;
// A script error must not leave a frozen screen: say so, and the next tap or key reloads the page.
let crashed = false;
function crash(err) {
  if (crashed) return;
  crashed = true;
  try { console.error(err); } catch (e) {}
  try { stopTune(); keepAwake(false); flushBank(); } catch (e) {}
  for (const id of ['cards', 'deck', 'menu', 'results', 'howto', 'settingsBox', 'boardBox', 'pauseBox']) { const el = $(id); if (el) el.hidden = true; }
  setBanner(t('SOMETHING BROKE'), t('TAP TO RESTART'));
  const again = () => location.reload();
  window.addEventListener('pointerdown', again, { once: true, capture: true });
  window.addEventListener('keydown', again, { once: true, capture: true });
}
window.addEventListener('error', e => crash(e.error || e.message));
window.addEventListener('unhandledrejection', e => crash(e.reason));
function frame(now) {
  if (crashed) return;
  try { frameBody(now); } catch (err) { crash(err); }
}
function frameBody(now) {
  const rawDt = (now - lastT) / 1000;
  const dt = Math.max(0, Math.min(0.05, rawDt));
  lastT = now;
  pollGamepads();
  overFx(dt);
  if (G.landT > 0) G.landT = Math.max(0, G.landT - dt);

  if (G.state === 'paused') {                       // nothing moves: draw only when asked (pausing, a resize)
    if (G.redraw) { G.redraw = false; renderer.render(scene, camera); }
    requestAnimationFrame(frame);
    return;
  }
  // game over: slow motion for a moment (real time runs on; the fixed steps just come slower, so nothing in a run changes)
  if (G.slowT > 0) { G.slowT = Math.max(0, G.slowT - dt); acc += dt * OVER_SLOW; } else acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) { step(STEP); acc -= STEP; steps++; }
  if (steps === MAX_STEPS) acc = 0;
  updateParts(dt);   // effects: once per frame, not per step

  // draw at most ~60 fps while playing (90-144 Hz screens), and every other frame on menus, to save battery
  const idle = G.state === 'attract' || (G.state === 'over' && G.stateT > RESULTS_DELAY);
  let draw;
  // a screen already at 30 Hz (iOS Low Power Mode) draws every frame; faster ones skip every other on the menus
  if (idle) draw = rawDt > 0.025 || (G.frameN++ & 1) === 0;
  else {
    draw = now >= nextDraw - 2;   // 2 ms tolerance: timestamps land a hair early or late
    // keep a steady schedule: 60 draws/s on any refresh rate; after a stall, start the schedule again
    if (draw) nextDraw = now - nextDraw > DRAW_INTERVAL * 2 ? now + DRAW_INTERVAL : nextDraw + DRAW_INTERVAL;
  }
  if (draw) {
    spinAll(now);
    updateFarLanes();
    placeCamera();
    placeGhost();
    placeHint();
    announceFrame();
    shadowCadence(idle);
    renderer.render(scene, camera);
    if (lastDraw) watchFrameTime((now - lastDraw) / 1000);   // judge drawn frames only
    lastDraw = now;
    if (DEBUG) countFrame(now);
  }
  if (G.state === 'attract') { if (G.stateT < 0.5) startTune(); else if (G.stateT > 14) idleAudio(); }
  requestAnimationFrame(frame);
}

// #debug: drawn frames per second and draw calls, in the corner, once a second
const fpsEl = $('fps');
let fpsN = 0, fpsT0 = 0;
function countFrame(now) {
  fpsN++;
  if (now - fpsT0 < 1000) return;
  if (fpsT0) fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT0)) + ' FPS \u00b7 ' + renderer.info.render.calls + ' DRAWS \u00b7 ' + getPixelRatio() + 'x';
  fpsT0 = now; fpsN = 0;
}
if (DEBUG) {
  fpsEl.hidden = false;
  window.hopLanes = {
    players, renderer, laneCoins, laneKinds, kill, giveShield,
    get state() { return G.state; },
    get camRow() { return G.camRow; },
    set camRow(r) { G.camRow = r; },   // tests: look at a far part of the world without playing there
    get seed() { return getSeed(); },
    get pixelRatio() { return getPixelRatio(); },
    get drawCalls() { return renderer.info.render.calls; },   // of the last drawn frame
    get bank() { return G.bank; },
    get muted() { return isMuted(); },
    get owned() { return [...owned]; },
    get mode() { return G.mode; },
    get dailySeed() { return dailySeed(); },
    get run() { return G.run; },
    get record() { return G.record.slice(); },
    get playTick() { return G.playTick; },
    get startTick() { return G.startTick; },
    get replay() { return G.replay; },
    get weather() { return G.weather; },
    get view() { return viewInfo(); },
    get tune() { return tuneOn(); },
    get ghost() { return ghostInfo(); },
    get hint() { return !hintEl.hidden; },
    get playLoop() { return playLoopOn(); },
    get playLayers() { return playLayers(); },
    get streak() { return $('streak').textContent; },
    get biome() { return biomeAt(G.camRow + G.camLead).name; },
    biomeIndex,
    get zoom() { return camera.zoom; },
    get slowT() { return G.slowT; },
    get hintText() { return hintEl.textContent; },
    boom() { G.boom = true; },   // throw inside the next step: the crash notice
    ladder: { feed: watchFrameTime, get ratio() { return getPixelRatio(); }, get shadow() { return sun.shadow.mapSize.x; } }
  };
}
// a replay link: the same world, the same animals, the same hops (a link with an unknown animal is ignored)
if (REPLAY_CODE) {
  const rp = decodeReplay(REPLAY_CODE);
  const idx = rp ? rp.chars.map(key => CHARACTERS.findIndex(c => c.key === key)) : [];
  if (rp && idx.every(k => k >= 0)) {
    G.replay = { ...rp, i: 0 };
    G.mode = rp.mode;
    setModeLabel();
    idx.forEach((k, i) => { players[i].charIndex = k; });
  }
}
toAttract();
if (G.replay) {
  // start the world clock so the countdown ends on the tick the recorded run began (startPlay sets it exactly)
  G.worldTick = Math.max(0, G.replay.startTick - Math.ceil(COUNTDOWN / STEP));
  G.replay.joined.forEach((on, i) => { if (on) join(i); });
}
if (loadText(HOWTO_KEY) !== '1' && !G.replay) showHowto();
// build the other shaders now (rail lights; the see-through landing spot and shield bubble): built on the first
// join or train, each one stutters the game
const warm = [new THREE.Mesh(lightGeo, LIGHT_OFF), new THREE.Mesh(blobGeo, blobMat), new THREE.Mesh(bubbleGeo, bubbleMat), new THREE.Mesh(ghostWarmGeo(), ghostMat)];
warm.forEach(m => scene.add(m));
renderer.compile(scene, camera);
warm.forEach(m => scene.remove(m));
requestAnimationFrame(frame);
