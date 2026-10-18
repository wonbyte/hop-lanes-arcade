import { MOTION_KEY, loadText } from './storage.js';
import { $, G, NIGHT_FULL, NIGHT_START, SHADOW_BASIC, fail } from './core.js';
import { glowU } from './voxel.js';

// Three.js renderer, camera, light, resize handling and the adaptive quality ladder.
// ---------- three.js setup ----------
const coarsePointer = matchMedia('(pointer: coarse)').matches;      // a touch screen (phones, tablets): cheaper shadows and resolution
const touchQuery = matchMedia('(pointer: coarse)');                  // touch hints follow the current input
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || loadText(MOTION_KEY) === '1';   // the settings panel can ask for less
const BLINK_STEPS = reduceMotion ? 2.5 : 8;                          // rail light on/off changes per second
const stage = $('stage'), marquee = $('marquee');
let renderer;
// on high-density phone screens edges are already fine, and multisampling costs a lot of fill
try { renderer = new THREE.WebGLRenderer({ antialias: !(coarsePointer && (window.devicePixelRatio || 1) >= 2) }); }
catch (e) { fail('This browser can not show 3D graphics. Turn on WebGL or try another browser.'); throw new Error('no-webgl'); }
// dense phone screens start at 2 (no multisampling there, so the resolution is what makes edges sharp); the ladder
// drops to 1.5 first if frames get slow. Elsewhere 1.5 is enough for voxels: 2 would draw almost twice the pixels
// A tablet at 2 would draw 4 Mpx a frame: only a phone-sized screen starts there. A ratio the ladder settled on
// is kept for the next load (RATIO_KEY), so a slow phone does not pay the slow first seconds every time.
const phoneSized = window.innerWidth * window.innerHeight * 4 < 3.5e6;
const RATIO_KEY = 'hoplanes.ratio';
const saved = Number(loadText(RATIO_KEY));
const savedRatio = saved >= 1 && saved <= 2 ? saved : Infinity;   // only a ratio the ladder could have set
let pixelRatio = Math.min(coarsePointer && phoneSized ? 2 : 1.5, window.devicePixelRatio || 1, savedRatio);
const startRatio = pixelRatio;   // a ratio under it was lowered by the ladder
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
// PCF everywhere: the GPU compares and filters the shadow depth (r186 stores it in a depth texture). The one-sample
// BasicShadowMap, which phones used, reads that depth texture as a plain texture, and on an iPhone that drew stair-
// stepped shadow edges and a mottled, self-shadowed ground (17 Oct 2026): #shadow-basic keeps it for an A/B check.
// Set once at boot: changing the type later rebuilds every shader.
renderer.shadowMap.type = SHADOW_BASIC ? THREE.BasicShadowMap : THREE.PCFShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Game view: roads, rivers and train tracks to hop across');

const scene = new THREE.Scene();
const sceneSky = new THREE.Color(0x74d3f2);   // kept typed: scene.background could also be a texture
scene.background = sceneSky;
// a light haze toward the top of the screen, in the sky's color (set in resize, recolored in setNight)
const sceneFog = new THREE.Fog(0x74d3f2, 30, 60);
scene.fog = sceneFog;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const CAM_OFF = new THREE.Vector3(3.2, 12, 7.5);
const focus = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65 * Math.PI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(coarsePointer ? 512 : 1024);   // phone screens are small: 512 looks the same there and costs a quarter
Object.assign(sun.shadow.camera, { top: 15, bottom: -15, near: 1, far: 50 });   // fitted to the view in resize()
// Against self-shadowing (acne): a surface's own depth, read back from the map, is only as exact as a map texel, and
// the depth pass keeps the back faces, so a flat lane is covered by its own far edge. The receiver is lifted along its
// normal by about a texel and a half (normalBias follows the map size and the fitted box: fitShadowBias) and compared
// a hair closer (bias, in the 0..1 depth of the fitted box: about 0.02 units). Neither moves a shadow visibly.
sun.shadow.bias = -0.0004;
const NORMAL_BIAS_TEXELS = 1.5;
function fitShadowBias() {
  const sc = sun.shadow.camera;
  sun.shadow.normalBias = NORMAL_BIAS_TEXELS * Math.max(sc.right - sc.left, sc.top - sc.bottom) / sun.shadow.mapSize.x;
}
scene.add(sun, sun.target);

// day turns into night as the players get far: sky, ambient and sun blend toward a blue dusk
// light strengths are in physical units since Three.js r155: the old values times PI give the same picture
const DAY = { sky: new THREE.Color(0x74d3f2), sun: new THREE.Color(0xffffff), hemi: 0.65 * Math.PI, sunI: 0.6 * Math.PI };
const NIGHT = { sky: new THREE.Color(0x1b2242), sun: new THREE.Color(0x9fb3ff), hemi: 0.28 * Math.PI, sunI: 0.42 * Math.PI };
const RAIN_SKY = new THREE.Color(0x6b8294), SNOW_SKY = new THREE.Color(0xd6e2ec);
let nightT = -1, wetT = 0, shownWeather = '', skyHex = -1, skyT = 1;
const skyFrom = new THREE.Color(0x74d3f2), skyTo = new THREE.Color(0x74d3f2);
const weatherEl = $('weather');
// sky and light by row (night) and weather at the camera; the weather tint fades over a second.
// sky: the day sky of the biome at the camera (world.js biomeAt). The 'night' look starts the world at full night.
function setNight(row, weather = '', sky = 0x74d3f2) {
  const t = Math.min(1, Math.max(0, (row + (G.look === 'night' ? NIGHT_FULL : 0) - NIGHT_START) / (NIGHT_FULL - NIGHT_START)));
  const wet = weather ? 1 : 0;
  if (weather !== shownWeather) { shownWeather = weather; weatherEl.className = weather; }
  if (t === nightT && wet === wetT && sky === skyHex && skyT === 1) return;
  nightT = t; wetT += (wet - wetT) * 0.03; if (Math.abs(wet - wetT) < 0.01) wetT = wet;
  if (sky !== skyHex) { skyHex = sky; skyFrom.copy(DAY.sky); skyTo.setHex(sky); skyT = 0; }   // a new biome: the sky fades over
  if (skyT < 1) { skyT = Math.min(1, skyT + 0.02); DAY.sky.copy(skyFrom).lerp(skyTo, skyT); }
  glowU.value = Math.min(1, t * 1.5 + wetT * 0.4);   // headlights come on with the dusk, and a little in rain
  sceneSky.copy(DAY.sky).lerp(NIGHT.sky, t).lerp(weather === 'snow' ? SNOW_SKY : RAIN_SKY, wetT * (weather === 'snow' ? 0.5 : 0.6));
  sun.color.copy(DAY.sun).lerp(NIGHT.sun, t);
  hemi.intensity = (DAY.hemi + (NIGHT.hemi - DAY.hemi) * t) * (1 - wetT * 0.15);
  sun.intensity = (DAY.sunI + (NIGHT.sunI - DAY.sunI) * t) * (1 - wetT * 0.3);
  sceneFog.color.copy(sceneSky);
}

// The sun and the camera keep the same offsets from the focus point, so the visible ground is a fixed shape
// around it. fitView() measures that shape once per resize: the shadow box is fitted to it (no texels spent
// off screen, so shadows are sharper), and the haze starts a few rows below the top edge.
const probe = new THREE.OrthographicCamera(), SUN_OFF = new THREE.Vector3(-6, 14, 6);
const ray = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), dir = new THREE.Vector3(), pt = new THREE.Vector3();
function fitView(halfW, halfH) {
  probe.position.copy(CAM_OFF); probe.lookAt(0, 0, 0); probe.updateMatrixWorld();
  dir.set(0, 0, -1).applyQuaternion(probe.quaternion);
  up.set(0, 1, 0).applyQuaternion(probe.quaternion);
  right.set(1, 0, 0).applyQuaternion(probe.quaternion);
  // where the screen corners meet the ground (y = 0) and the tree tops (y = 1.6)
  const corners = [];
  let topDepth = 0;
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) for (const h of [0, 1.6]) {
    ray.copy(CAM_OFF).addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
    const t = (h - ray.y) / dir.y;
    corners.push(pt.copy(ray).addScaledVector(dir, t).clone());
    if (sy > 0 && h === 0) topDepth = t;
  }
  sceneFog.near = topDepth - 6; sceneFog.far = topDepth + 14;   // about a third of the sky color at the top edge
  // the same corners seen from the sun: their bounds (plus room for shadows cast from just off screen)
  probe.position.copy(SUN_OFF); probe.lookAt(0, 0, 0); probe.updateMatrixWorld();
  const inv = probe.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of corners) {
    c.applyMatrix4(inv);
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z);
  }
  const sc = sun.shadow.camera, m = 1.5;
  Object.assign(sc, { left: x0 - m, right: x1 + m, bottom: y0 - m, top: y1 + m, near: Math.max(0.1, -z1 - 4), far: -z0 + 4 });
  sc.updateProjectionMatrix();
  fitShadowBias();
}

// the score chips and the logo sit just under the top bar, whatever its height (one layout read: on a resize and when
// the bar changes with the state, screens.js)
const fitTopBar = () => stage.style.setProperty('--marquee-h', marquee.offsetHeight + 'px');
const viewSize = { w: 1, h: 1 };   // the canvas size in CSS pixels, as of the last resize
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  viewSize.w = w; viewSize.h = h;   // read here once, so no frame needs a layout read
  renderer.setSize(w, h, false);
  fitTopBar();
  const aspect = w / h;
  // wide screens (a phone held sideways) zoom out so enough rows stay visible,
  // and aim lower so the players sit above the floating buttons
  // sideways: fix the visible height (about 11 rows) and let the width follow, so the animals stay big
  const wide = aspect > 1.3;
  const halfW = wide ? Math.max(8, 4.3 * aspect) : aspect < 0.8 ? 6.2 : 7.2;
  G.camLead = wide ? 2.2 : 4.2;
  Object.assign(camera, { left: -halfW, right: halfW, top: halfW / aspect, bottom: -halfW / aspect });
  camera.updateProjectionMatrix();
  // rows on screen (the ground is seen at an angle, so one screen unit covers ~1.35 rows) + a margin for shadows
  G.visRows = camera.top * 1.35 + 2;
  fitView(halfW, halfW / aspect);
  G.redraw = true;   // a paused game draws one new frame at the new size
}
if (typeof ResizeObserver === 'function') {
  // the stage and the top bar both change size when fonts load or the phone turns
  const ro = new ResizeObserver(resize);
  ro.observe(stage); ro.observe(marquee);
} else window.addEventListener('resize', resize);
resize();

// Slow device? Lower the resolution, then the shadow detail, one step at a time.
// Only steps that need no shader rebuild are used (a rebuild mid-game is a hitch of its own).
// Each step is judged after 2 s of play: a step that helped is kept and its rung is tried again (the pixel ratio
// can go 1.5 -> 1.25 -> 1); a step that did not help is undone and the next rung is tried; a rung with nothing
// left to lower is passed over. Once past every rung, the ladder stops (a phone capped at 30 fps keeps its quality).
// Each 2 s window is judged by the mean of its frames without the slowest tenth (a trimmed mean): the first second of
// play holds a few long frames (the fleets' first uploads, the chunk joins), and a plain mean of them took a step on a
// device that was fine, judged the next clean window a gain against that baseline, and kept it. The first window of a
// game is not judged at all (the same warm-up). (It was a moving average that starts at 1/60 s: on a device that draws
// 7 frames a second a window holds about 15 frames, the average was still climbing when a step was judged, so every
// step looked like no gain and was undone; tools/device-bench.mjs showed the ladder ending where it began.)
const WINDOW_MAX = 512;   // frames a 2 s window can hold (240 Hz at most)
const perf = { frames: new Float32Array(WINDOW_MAX), n: 0, t: 0, undo: null, before: 0, tried: 0, skip: true, kept: false, rest: 0, lastRatio: 0 };   // tried: the rung being tried next
const holdFrameWatch = () => { perf.held = true; };   // tests: the drawn frames stop feeding the ladder
// at the start of a game (screens.js startPlay)
function resetFrameWatch() {
  perf.undo = null;    // a step taken just before game over stays: it was never judged, and it is cheap
  perf.n = 0; perf.t = 0;
  perf.skip = true;    // the first window of a game is warm-up: not judged
  // a lowered pixel ratio is saved for the next load only once two games in a row ended on it (one noisy game is no verdict)
  if (perf.lastRatio === pixelRatio && pixelRatio < startRatio) try { localStorage.setItem(RATIO_KEY, String(pixelRatio)); } catch (e) {}
  perf.lastRatio = pixelRatio;
  // a game that tried every rung and kept none (a CPU-bound device: no rung helps) rests two games before trying again,
  // instead of flipping the resolution and the shadow map for 12 s at the start of every game
  if (perf.tried >= LADDER.length && !perf.kept) perf.rest = 2;
  if (perf.rest > 0) perf.rest--; else perf.tried = 0;   // the next game climbs the ladder again from the first rung
  perf.kept = false;
}
function setRatio(r) { pixelRatio = r; renderer.setPixelRatio(r); resize(); }
function setShadowMapSize(n) {
  sun.shadow.mapSize.setScalar(n);
  fitShadowBias();
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // rebuilt at the new size
}
// the ladder: each rung lowers one thing and returns how to undo it, or null if it has nothing left to lower
const LADDER = [
  () => {
    if (pixelRatio <= 1) return null;
    const was = pixelRatio;
    setRatio(was > 1.5 ? 1.5 : Math.max(1, was - 0.25));   // 2 → 1.5 → 1.25 → 1
    return () => setRatio(was);
  },
  () => {
    if (sun.shadow.mapSize.x <= 256) return null;
    const was = sun.shadow.mapSize.x;
    setShadowMapSize(was / 2);
    return () => setShadowMapSize(was);
  },
  () => {   // last: shadows every other drawn frame while playing (a moving shadow lags one frame: hard to see)
    if (shadowHalf) return null;
    shadowHalf = true;
    return () => { shadowHalf = false; };
  }
];
const BAD_FRAME = 0.022;   // slower than ~45 fps: lower quality
// the mean of the frames without the slowest tenth (a hitch or two says nothing about the device)
function trimmedMean(frames, n) {
  const sorted = frames.subarray(0, n).slice().sort(), keep = Math.max(1, n - Math.floor(n / 10));
  let sum = 0;
  for (let i = 0; i < keep; i++) sum += sorted[i];
  return sum / keep;
}
// A frame longer than this is a tab switch or a stall, not the speed of the device. (It was 0.1 s: a device that drew
// under 10 frames a second was never judged, so the slowest devices kept the highest quality; tools/device-bench.mjs.)
const STALL = 0.5;
// frameT: seconds since the previous drawn frame (only drawn frames count, so a skipped frame on a 120 Hz screen is not "fast")
// fed: from the test hook (hopLanes.ladder.feed); after holdFrameWatch() only those count
function watchFrameTime(frameT, fed = false) {
  if (perf.held && !fed) return;
  if (perf.tried >= LADDER.length && !perf.undo) return;
  if (G.state !== 'play' || frameT > STALL) return;       // ignore menus, tab switches and stalls
  if (perf.n < WINDOW_MAX) perf.frames[perf.n++] = frameT;
  if ((perf.t += frameT) < 2) return;
  const mean = trimmedMean(perf.frames, perf.n);
  perf.t = 0; perf.n = 0;
  if (perf.skip) { perf.skip = false; return; }         // the first window of a game: warm-up, not a verdict
  if (perf.undo) {                                       // judge the last step
    if (mean > perf.before * 0.9) { perf.undo(); perf.tried++; }   // no real gain: put it back, move on to the next rung
    else perf.kept = true;                               // a step that helped keeps its rung: it is tried again
    perf.undo = null;
  }
  if (mean < BAD_FRAME) return;
  // the first rung with something left to lower takes a step; a rung that returns null is passed over
  while (perf.tried < LADDER.length && !(perf.undo = LADDER[perf.tried]())) perf.tried++;   // nosemgrep: unsafe-dynamic-method -- an index into a fixed array
  perf.before = mean;
}

const getPixelRatio = () => pixelRatio;
// the view closes in a little at game over (app.js); 1 is the normal view
function setZoom(z) { if (camera.zoom !== z) { camera.zoom = z; camera.updateProjectionMatrix(); } }
// shadows are redrawn with every frame while playing; on the menus and the results every other drawn frame
// is enough (the title traffic moves slowly), which saves about a third of each frame there
let shadowSkip = false, shadowHalf = false;   // shadowHalf: the ladder's last rung (every other frame in play too)
function shadowCadence(idle) {
  if (!idle && !shadowHalf) { renderer.shadowMap.autoUpdate = true; return; }
  renderer.shadowMap.autoUpdate = false;
  shadowSkip = !shadowSkip;
  if (!shadowSkip) renderer.shadowMap.needsUpdate = true;
}
// test hook: how the view was fitted
const viewInfo = () => { const sc = sun.shadow.camera; return { shadowW: sc.right - sc.left, shadowH: sc.top - sc.bottom, fogNear: sceneFog.near, fogFar: sceneFog.far, mapSize: sun.shadow.mapSize.x, shadowHalf, shadowType: renderer.shadowMap.type === THREE.PCFShadowMap ? 'pcf' : 'basic', normalBias: sun.shadow.normalBias, bias: sun.shadow.bias }; };

export { BLINK_STEPS, CAM_OFF, SUN_OFF, ONE, camera, fitTopBar, focus, getPixelRatio, holdFrameWatch, reduceMotion, renderer, resetFrameWatch, scene, setNight, setZoom, shadowCadence, stage, sun, touchQuery, viewInfo, viewSize, watchFrameTime };
