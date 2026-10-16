import { MOTION_KEY, loadText } from './storage.js';
import { $, G, NIGHT_FULL, NIGHT_START, fail } from './core.js';
import { glowU } from './voxel.js';

// Three.js renderer, camera, light, resize handling and the adaptive quality ladder.
// ---------- three.js setup ----------
const lowGpu = matchMedia('(pointer: coarse)').matches;              // phones/tablets: cheaper shadows and resolution
const touchQuery = matchMedia('(pointer: coarse)');                  // touch hints follow the current input
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || loadText(MOTION_KEY) === '1';   // the settings panel can ask for less
const BLINK_STEPS = reduceMotion ? 2.5 : 8;                          // rail light on/off changes per second
const stage = $('stage'), marquee = $('marquee');
let renderer;
// on high-density phone screens edges are already fine, and multisampling costs a lot of fill
try { renderer = new THREE.WebGLRenderer({ antialias: !(lowGpu && (window.devicePixelRatio || 1) >= 2) }); }
catch (e) { fail('This browser can not show 3D graphics. Turn on WebGL or try another browser.'); throw new Error('no-webgl'); }
// dense phone screens start at 2 (no multisampling there, so the resolution is what makes edges sharp); the ladder
// drops to 1.5 first if frames get slow. Elsewhere 1.5 is enough for voxels: 2 would draw almost twice the pixels
// A tablet at 2 would draw 4 Mpx a frame: only a phone-sized screen starts there. A ratio the ladder settled on
// is kept for the next load (RATIO_KEY), so a slow phone does not pay the slow first seconds every time.
const phoneSized = window.innerWidth * window.innerHeight * 4 < 3.5e6;
const RATIO_KEY = 'hoplanes.ratio';
const savedRatio = Number(loadText(RATIO_KEY)) || Infinity;
let pixelRatio = Math.min(lowGpu && phoneSized ? 2 : 1.5, window.devicePixelRatio || 1, savedRatio);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
// phones: hard-edged shadows (one shadow-map read per pixel instead of several); they suit the voxel look.
// Set once at boot: changing the type later rebuilds every shader.
renderer.shadowMap.type = lowGpu ? THREE.BasicShadowMap : THREE.PCFShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Game view: roads, rivers and train tracks to hop across');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x74d3f2);
// a light haze toward the top of the screen, in the sky's color (set in resize, recolored in setNight)
scene.fog = new THREE.Fog(0x74d3f2, 30, 60);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const CAM_OFF = new THREE.Vector3(3.2, 12, 7.5);
const focus = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65 * Math.PI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(lowGpu ? 512 : 1024);   // phone screens are small: 512 looks the same there and costs a quarter
Object.assign(sun.shadow.camera, { top: 15, bottom: -15, near: 1, far: 50 });   // fitted to the view in resize()
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
  scene.background.copy(DAY.sky).lerp(NIGHT.sky, t).lerp(weather === 'snow' ? SNOW_SKY : RAIN_SKY, wetT * (weather === 'snow' ? 0.5 : 0.6));
  sun.color.copy(DAY.sun).lerp(NIGHT.sun, t);
  hemi.intensity = (DAY.hemi + (NIGHT.hemi - DAY.hemi) * t) * (1 - wetT * 0.15);
  sun.intensity = (DAY.sunI + (NIGHT.sunI - DAY.sunI) * t) * (1 - wetT * 0.3);
  scene.fog.color.copy(scene.background);
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
  scene.fog.near = topDepth - 6; scene.fog.far = topDepth + 14;   // about a third of the sky color at the top edge
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
}

const viewSize = { w: 1, h: 1 };   // the canvas size in CSS pixels, as of the last resize
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  viewSize.w = w; viewSize.h = h;   // read here once, so no frame needs a layout read
  renderer.setSize(w, h, false);
  // the score and the logo sit just under the top bar, whatever its height
  stage.style.setProperty('--marquee-h', marquee.offsetHeight + 'px');
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
if ('ResizeObserver' in window) {
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
const perf = { ema: 1 / 60, t: 0, undo: null, before: 0, tried: 0 };   // tried: the rung being tried next
function resetFrameWatch() {
  perf.undo = null;    // a step taken just before game over stays: it was never judged, and it is cheap
  perf.ema = 1 / 60; perf.t = 0;
  perf.tried = 0;      // the next game climbs the ladder again from the first rung
}
function setRatio(r) { pixelRatio = r; renderer.setPixelRatio(r); resize(); try { localStorage.setItem(RATIO_KEY, String(r)); } catch (e) {} }
function setShadowMapSize(n) {
  sun.shadow.mapSize.setScalar(n);
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
// frameT: seconds since the previous drawn frame (only drawn frames count, so a skipped frame on a 120 Hz screen is not "fast")
function watchFrameTime(frameT) {
  if (perf.tried >= LADDER.length && !perf.undo) return;
  if (G.state !== 'play' || frameT > 0.1) return;         // ignore menus and tab switches
  perf.ema += (frameT - perf.ema) * 0.05;
  if ((perf.t += frameT) < 2) return;
  perf.t = 0;
  if (perf.undo) {                                       // judge the last step
    if (perf.ema > perf.before * 0.9) { perf.undo(); perf.tried++; }   // no real gain: put it back, move on to the next rung
    perf.undo = null;                                    // (a step that helped keeps its rung: it is tried again)
  }
  if (perf.ema < BAD_FRAME) return;
  // the first rung with something left to lower takes a step; a rung that returns null is passed over
  while (perf.tried < LADDER.length && !(perf.undo = LADDER[perf.tried]())) perf.tried++;
  perf.before = perf.ema;
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
const viewInfo = () => { const sc = sun.shadow.camera; return { shadowW: sc.right - sc.left, shadowH: sc.top - sc.bottom, fogNear: scene.fog.near, fogFar: scene.fog.far, mapSize: sun.shadow.mapSize.x, shadowHalf }; };

export { BLINK_STEPS, CAM_OFF, SUN_OFF, ONE, camera, focus, getPixelRatio, marquee, reduceMotion, renderer, resetFrameWatch, resize, scene, setNight, setZoom, shadowCadence, stage, sun, touchQuery, viewInfo, viewSize, watchFrameTime };
