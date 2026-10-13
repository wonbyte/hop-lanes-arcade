import { idleAudio, isMuted, muted, sfx, startTune } from './audio.js';
import { DEBUG, G, RESULTS_DELAY } from './core.js';
import { CAM_OFF, camera, focus, getPixelRatio, pixelRatio, renderer, scene, setNight, sun, touchQuery, watchFrameTime } from './gfx.js';
import { partGeo, players, splashMat, updateParts, updatePlayer } from './players.js';
import { resultsEl, setBanner, showHowto, startPlay, toAttract } from './screens.js';
import { HOWTO_KEY, dailySeed, loadText, owned } from './storage.js';
import { coinMeshes, ensureLanes, getSeed, laneCoins, laneKinds, lanes, updateLanes } from './world.js';
import './input.js';   // only adds event listeners, so nothing else imports it

// The game loop and boot. main.js loads this once Three.js is present.
// ---------- loop ----------
function updateCountdown(dt) {
  const before = Math.ceil(G.countdown);
  G.countdown -= dt;
  const n = Math.ceil(G.countdown);
  if (n !== before && n > 0) sfx.tick();
  if (G.countdown <= 0) { startPlay(); return; }
  // setBanner only touches the DOM when the text changes
  setBanner(String(n), (players.every(p => p.joined) ? 'FROG VS FOX' : 'OTHER PLAYER: TAP TO JOIN')
    + (touchQuery.matches ? '\nTAP TO HOP · SWIPE TO TURN' : ''));
}
function updateCamera(dt) {
  G.playT += dt;
  if (G.goT > 0 && (G.goT -= dt) <= 0) setBanner('');
  let lead = -Infinity;
  for (const p of players) if (p.joined && p.alive) lead = Math.max(lead, p.row);
  // the camera creeps forward on its own, and catches up fast to a player who runs ahead
  G.camRow += Math.min(1.1, 0.3 + G.playT * 0.006) * dt;
  if (lead - 2 > G.camRow) G.camRow += (lead - 2 - G.camRow) * Math.min(1, dt * 3);
}
function placeCamera() {
  focus.set(0, 0, -(G.camRow + G.camLead));
  camera.position.copy(focus).add(CAM_OFF);
  camera.lookAt(focus);
  sun.position.set(focus.x - 6, 14, focus.z + 6);
  sun.target.position.copy(focus);
  setNight(G.camRow);
  const focusRow = G.camRow + G.camLead;
  for (const lane of lanes.values()) lane.group.visible = Math.abs(lane.r - focusRow) < G.visRows;
}

const DRAW_INTERVAL = 1000 / 60;
let lastT = performance.now(), nextDraw = 0, lastDraw = 0;
function frame(now) {
  const rawDt = (now - lastT) / 1000;
  const dt = Math.max(0, Math.min(0.05, rawDt));
  lastT = now; G.stateT += dt;

  if (G.state === 'paused') {                       // nothing moves; draw now and then so the screen stays fresh
    if ((G.frameN++ & 3) === 0) renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  if (G.state === 'countdown') updateCountdown(dt);
  else if (G.state === 'play') updateCamera(dt);
  else if (G.state === 'over' && G.stateT > RESULTS_DELAY && resultsEl.hidden) resultsEl.hidden = false;

  ensureLanes();
  updateLanes(dt, now);
  for (const p of players) updatePlayer(p, dt);
  updateParts(dt);
  for (const m of coinMeshes) m.rotation.y = now / 300;
  placeCamera();

  // draw at most ~60 fps while playing (90-144 Hz screens), and every other frame on menus, to save battery
  const idle = G.state === 'attract' || (G.state === 'over' && G.stateT > RESULTS_DELAY);
  let draw;
  if (idle) draw = (G.frameN++ & 1) === 0;
  else {
    draw = now >= nextDraw - 2;   // 2 ms tolerance: timestamps land a hair early or late
    // keep a steady schedule: 60 draws/s on any refresh rate; after a stall, start the schedule again
    if (draw) nextDraw = now - nextDraw > DRAW_INTERVAL * 2 ? now + DRAW_INTERVAL : nextDraw + DRAW_INTERVAL;
  }
  if (draw) {
    renderer.render(scene, camera);
    if (lastDraw) watchFrameTime((now - lastDraw) / 1000);   // judge drawn frames only
    lastDraw = now;
  }
  if (G.state === 'attract') { if (G.stateT < 0.5) startTune(); else if (G.stateT > 14) idleAudio(); }
  requestAnimationFrame(frame);
}

if (DEBUG) {
  window.hopLanes = {
    players, renderer, laneCoins, laneKinds,
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
    get dailySeed() { return dailySeed(); }
  };
}
toAttract();
if (loadText(HOWTO_KEY) !== '1') showHowto();
// build the plain shader (rail lights, particles) now; built mid-game, it stutters on the first train or death
const warm = new THREE.Mesh(partGeo, splashMat);
scene.add(warm);
renderer.compile(scene, camera);
scene.remove(warm);
requestAnimationFrame(frame);

export { DRAW_INTERVAL, frame, lastDraw, lastT, nextDraw, placeCamera, updateCamera, updateCountdown, warm };
