import { idleAudio, isMuted, playLayers, playLoopOn, sfx, startTune, stopTune, tuneOn } from './audio.js';
import { $, BENCH, BIOME_ROWS, COUNTDOWN, DEBUG, G, LAND_DIP, OVER_SLOW, OVER_SLOW_T, OVER_ZOOM, REPLAY_CODE, RESULTS_DELAY, STEP, TUTORIAL_SEED } from './core.js';
import { pollGamepads } from './input.js';   // also sets up every input listener
import { decodeReplay } from './replay.js';
import { creepCamera } from './sim.js';
import { ghostInfo, ghostMat, ghostWarmGeo, placeGhost, primeGhost, stepGhost } from './ghost.js';
import { CHARACTERS } from './models.js';
import { CAM_OFF, SUN_OFF, camera, focus, getPixelRatio, holdFrameWatch, reduceMotion, renderer, scene, setNight, setZoom, shadowCadence, sun, touchQuery, viewInfo, viewSize, watchFrameTime } from './gfx.js';
import { announceFrame } from './panels.js';   // also sets up the settings, pause and top-10 panels
import { keepAwake } from './device.js';
import { flushBank } from './storage.js';
import { applyMoves, blobGeo, blobMat, bubbleGeo, bubbleMat, charOf, giveShield, kill, players, dressPlayer, updateParts, updatePlayer } from './players.js';
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
  setBanner(String(n), (G.replay ? t('REPLAY') : both ? t('{a} VS {b}', { a: t(charOf(players[0]).name), b: t(charOf(players[1]).name) }) : t('OTHER PLAYER: TAP TO JOIN'))
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
const hintEl = $('hint'), hintSpan = hintEl.firstElementChild;
const hintPos = new THREE.Vector3();
let hintX = -1, hintY = -1;
const HINT_ROWS = 12;
const LANE_HINT = { road: 'WAIT FOR A GAP', river: 'HOP ON A LOG', rail: 'MIND THE TRAIN', lily: 'PADS ONLY' };
function hintText(p) {
  const plain = (touchQuery.matches ? t('TAP') : p.id ? '\u2191' : 'W') + ' \u25b2';
  if (getSeed() !== TUTORIAL_SEED) return plain;
  const next = lanes.get(p.row + 1), key = next && LANE_HINT[next.kind];
  if (key) return t(key);
  if (p.score >= 2 && !G.hintTurn) return t(touchQuery.matches ? 'SWIPE TO TURN' : p.id ? '\u2190 \u2192 TO TURN' : 'A D TO TURN');
  return plain;
}
function placeHint() {
  if (!G.hint) { if (!hintEl.hidden) hintEl.hidden = true; return; }
  const p = players.find(q => q.joined && q.alive);
  if (G.state !== 'play' || !p || !p.mesh) { hintEl.hidden = true; return; }
  if (p.score >= (getSeed() === TUTORIAL_SEED ? HINT_ROWS : 5)) { G.hint = false; save(HINT_KEY, 1); hintEl.hidden = true; return; }
  hintPos.set(p.x, 1.5, p.mesh.position.z).project(camera);
  const x = Math.round((hintPos.x + 1) / 2 * viewSize.w), y = Math.round((1 - hintPos.y) / 2 * viewSize.h);
  if (x !== hintX || y !== hintY) { hintX = x; hintY = y; hintEl.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }   // transform only: no layout
  const text = hintText(p);
  if (hintSpan.textContent !== text) hintSpan.textContent = text;
  hintEl.hidden = false;
}
// game over: the world slows for a moment and the view closes in on the fallen player; the title puts it back
const OVER_FX_T = 2;   // seconds the game-over view keeps moving
let seenState = '';
function overFx(dt) {
  if (G.state !== seenState) {
    seenState = G.state;
    if (G.state === 'over') { G.slowT = OVER_SLOW_T; G.overT = 0; }
    else { G.overX = 0; G.lastDead = null; G.slowT = 0; setZoom(1); }   // a restart may skip the title (over -> countdown): put the view back whenever the results end
    if (G.state === 'attract') G.biomeBlock = 0;
  }
  if (G.state !== 'over' || reduceMotion || G.overT > OVER_FX_T) return;   // the view settles in a moment; then nothing moves per frame
  G.overT += dt;
  const k = Math.min(1, dt * 4), d = G.lastDead;
  setZoom(G.overT > OVER_FX_T ? OVER_ZOOM : camera.zoom + (OVER_ZOOM - camera.zoom) * k);
  if (d && d.mesh) G.overX += (Math.max(-3, Math.min(3, d.mesh.position.x)) * 0.5 - G.overX) * k;
}
// one fixed step of the game: the same hops on the same ticks give the same run (replays)
function step(dt) {
  if (DEBUG && G.boom) { G.boom = false; throw new Error('test crash'); }   // hopLanes.boom(): the crash notice test
  G.tick++; G.worldTick++; G.stateT += dt;
  if (G.shakeT > 0) G.shakeT = Math.max(0, G.shakeT - dt);
  if (G.state === 'countdown') { updateCountdown(dt); primeGhost(); }
  else if (G.state === 'play') { G.playTick++; applyMoves(); updateCamera(dt); stepGhost(); }
  else if (G.state === 'over' && G.stateT > RESULTS_DELAY && resultsEl.hidden) resultsEl.hidden = false;
  ensureLanes();
  updateLanes(players);   // only the lanes a player can touch; the rest move once per drawn frame
  for (const p of players) updatePlayer(p, dt);
}
const MAX_STEPS = 6;   // after a long stall, time is dropped rather than caught up
let lastT = performance.now(), lastDraw = 0, acc = 0;
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
  const work0 = DEBUG ? performance.now() : 0;
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
  for (const p of players) dressPlayer(p, dt);   // the animals' turns, blinks and shadow blobs: looks only

  const idle = G.state === 'attract' || (G.state === 'over' && G.stateT > RESULTS_DELAY);
  if (shouldDraw(now, rawDt, idle)) drawFrame(now, idle, work0);
  if (BENCH) benchStep();
  if (G.state === 'attract') { if (G.stateT < 0.5) startTune(); else if (G.stateT > 14) idleAudio(); }
  requestAnimationFrame(frame);
}

// Drawn frames: on a screen faster than 60 Hz, play draws every n-th screen frame, the largest n that still draws
// at least 60 times a second (120 Hz: every 2nd; 144 and 165 Hz: every 2nd; 240 Hz: every 4th; 90 and 100 Hz: every
// frame). Every n-th frame keeps the frames even (a 60/s clock on a 90 Hz screen gave 11 and 22 ms in turn), and the
// cap saves battery. The menus draw half as often again, unless the screen is already at 30 Hz (iOS Low Power Mode).
const PACE_N = 32, PACE_MAX = 1000 / 60 * 1.05;   // screen frames measured; the longest drawn interval (5% for jitter)
const paceDt = new Float32Array(PACE_N);
let paceI = 0, every = 1, screenN = 0;
function measurePace(rawDt) {
  if (rawDt <= 0 || rawDt > 0.05) return;   // a stall says nothing about the screen
  paceDt[paceI++] = rawDt * 1000;
  if (paceI < PACE_N) return;
  paceI = 0;
  const median = paceDt.slice().sort()[PACE_N >> 1];
  every = Math.max(1, Math.floor(PACE_MAX / median));
}
function shouldDraw(now, rawDt, idle) {
  measurePace(rawDt);
  screenN++;
  if (idle) return rawDt > 0.025 || screenN % (every * 2) === 0;
  return screenN % every === 0;
}
// the per-frame looks (never the rules), then the render; work0: when the frame began (#debug frame times)
function drawFrame(now, idle, work0) {
  spinAll(now);
  updateFarLanes();
  placeCamera();
  placeGhost();
  placeHint();
  announceFrame();
  shadowCadence(idle);
  renderer.render(scene, camera);
  if (lastDraw) watchFrameTime((now - lastDraw) / 1000);   // judge drawn frames only
  if (DEBUG) { if (lastDraw) recordFrame(now - lastDraw, performance.now() - work0); countFrame(now); }
  lastDraw = now;
}

// #debug: drawn frames per second and draw calls, in the corner, once a second
const fpsEl = $('fps');
let fpsN = 0, fpsT0 = 0;
function countFrame(now) {
  fpsN++;
  if (now - fpsT0 < 1000 || benchRuns.length) return;   // the bench result stays once there is one
  if (fpsT0) fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT0)) + ' FPS \u00b7 ' + renderer.info.render.calls + ' DRAWS \u00b7 ' + getPixelRatio() + 'x';
  fpsT0 = now; fpsN = 0;
}
// #debug: every drawn frame of the current play: the interval since the frame before (what the player sees) and the
// script time of the frame (ms). The device bench (tools/device-bench.mjs, docs/budgets.md) reads them.
let frames = [], work = [], frameRows = [], frameState = '';
const MAX_FRAMES = 1 << 20;
function recordFrame(ms, workMs) {
  if (G.state === 'play' && frameState !== 'play') { frames = []; work = []; frameRows = []; }   // a new game
  frameState = G.state;
  if (G.state !== 'play' || frames.length >= MAX_FRAMES) return;
  frames.push(ms); work.push(workMs); frameRows.push(Math.round(G.camRow));
}
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
function frameSummary() {
  const s = frames.slice().sort((a, b) => a - b), w = work.slice().sort((a, b) => a - b), r = x => Math.round(x * 10) / 10;
  // the slowest frames and the row the view was on: where a first-time cost (a new model, a shader) shows
  const slow = frames.map((ms, i) => [ms, i]).sort((a, b) => b[0] - a[0]).slice(0, 8).map(([ms, i]) => ({ ms: r(ms), work: r(work[i]), row: frameRows[i], frame: i }));
  return { frames: s.length, p50: r(quantile(s, 0.5)), p95: r(quantile(s, 0.95)), worst: r(s[s.length - 1] || 0), over33: s.filter(x => x > 33.4).length, over100: s.filter(x => x > 100).length, workP95: r(quantile(w, 0.95)), slow };
}
// #debug-bench-replay-<code>: at each game over the run's frame times are kept and shown, and the replay plays again
const benchRuns = [];
let benchOver = false;
function benchStep() {
  if (G.state !== 'over') { benchOver = false; return; }
  if (benchOver || resultsEl.hidden) return;   // once per game over, when the results show
  benchOver = true;
  benchRuns.push({ ...frameSummary(), at: Math.round(performance.now() / 1000) });
  const first = benchRuns[0], last = benchRuns[benchRuns.length - 1];
  fpsEl.textContent = 'BENCH RUN ' + benchRuns.length + ' \u00b7 P50 ' + last.p50 + ' \u00b7 P95 ' + last.p95 + ' \u00b7 WORST ' + last.worst + ' MS'
    + (benchRuns.length > 1 ? ' \u00b7 P95 RUN 1 ' + first.p95 : '');
  playReplay(REPLAY_CODE);
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
    get frames() { return frames.slice(); },
    get work() { return work.slice(); },
    get frameSummary() { return frameSummary(); },
    get benchRuns() { return benchRuns.slice(); },
    playReplay,   // the soak: the same run again without a reload
    ladder: { feed: t => watchFrameTime(t, true), hold: holdFrameWatch, get ratio() { return getPixelRatio(); }, get shadow() { return sun.shadow.mapSize.x; }, get shadowHalf() { return viewInfo().shadowHalf; } }
  };
}
// a replay link: the same world, the same animals, the same hops (a link with an unknown animal is ignored)
function playReplay(code) {
  const rp = code ? decodeReplay(code) : null;
  const idx = rp ? rp.chars.map(key => CHARACTERS.findIndex(c => c.key === key)) : [];
  if (rp && idx.every(k => k >= 0)) {
    G.replay = { ...rp, i: 0 };
    G.mode = rp.mode;
    setModeLabel();
    idx.forEach((k, i) => { players[i].charIndex = k; });
  }
  toAttract();
  if (!G.replay) return;
  // start the world clock so the countdown ends on the tick the recorded run began (startPlay sets it exactly)
  G.worldTick = Math.max(0, G.replay.startTick - Math.ceil(COUNTDOWN / STEP));
  G.replay.joined.forEach((on, i) => { if (on) join(i); });
}
playReplay(REPLAY_CODE);
if (loadText(HOWTO_KEY) !== '1' && !G.replay) showHowto();
// build the other shaders (the see-through landing spot, shield bubble and ghost) after the first title frame, so
// they do not delay it: built on the first join or ghost instead, each one would stutter the game. compileAsync
// builds them in the background where the browser can (KHR_parallel_shader_compile), with the scene's lights.
function warmShaders() {
  const warm = new THREE.Group();
  warm.add(new THREE.Mesh(blobGeo, blobMat), new THREE.Mesh(bubbleGeo, bubbleMat), new THREE.Mesh(ghostWarmGeo(), ghostMat));
  renderer.compileAsync(warm, camera, scene).catch(() => {});
}
requestAnimationFrame(now => { frame(now); setTimeout(warmShaders, 0); });
