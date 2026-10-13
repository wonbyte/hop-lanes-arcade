import { $, G, NIGHT_FULL, NIGHT_START, fail } from './core.js';

// Three.js renderer, camera, light, resize handling and the adaptive quality ladder.
// ---------- three.js setup ----------
const lowGpu = matchMedia('(pointer: coarse)').matches;              // phones/tablets: cheaper shadows and resolution
const touchQuery = matchMedia('(pointer: coarse)');                  // touch hints follow the current input
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BLINK_STEPS = reduceMotion ? 2.5 : 8;                          // rail light on/off changes per second
const stage = $('stage'), marquee = $('marquee');
let renderer;
// on high-density phone screens edges are already fine, and multisampling costs a lot of fill
try { renderer = new THREE.WebGLRenderer({ antialias: !(lowGpu && (window.devicePixelRatio || 1) >= 2) }); }
catch (e) { fail('This browser can not show 3D graphics. Turn on WebGL or try another browser.'); throw new Error('no-webgl'); }
// 1.5 is enough for voxels on any screen; 2 draws almost twice the pixels for no visible gain
let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = lowGpu ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Game view: roads, rivers and train tracks to hop across');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x74d3f2);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const CAM_OFF = new THREE.Vector3(3.2, 12, 7.5);
const focus = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(1024);   // at this camera angle 2048 looks the same and costs 4x the shadow pass
Object.assign(sun.shadow.camera, { top: 15, bottom: -15, near: 1, far: 50 });   // left/right set in resize()
scene.add(sun, sun.target);

// day turns into night as the players get far: sky, ambient and sun blend toward a blue dusk
const DAY = { sky: new THREE.Color(0x74d3f2), sun: new THREE.Color(0xffffff), hemi: 0.65, sunI: 0.6 };
const NIGHT = { sky: new THREE.Color(0x1b2242), sun: new THREE.Color(0x9fb3ff), hemi: 0.28, sunI: 0.42 };
const RAIN_SKY = new THREE.Color(0x6b8294), SNOW_SKY = new THREE.Color(0xd6e2ec);
let nightT = -1, wetT = 0, shownWeather = '';
const weatherEl = $('weather');
// sky and light by row (night) and weather at the camera; the weather tint fades over a second
function setNight(row, weather = '') {
  const t = Math.min(1, Math.max(0, (row - NIGHT_START) / (NIGHT_FULL - NIGHT_START)));
  const wet = weather ? 1 : 0;
  if (weather !== shownWeather) { shownWeather = weather; weatherEl.className = weather; }
  if (t === nightT && wet === wetT) return;
  nightT = t; wetT += (wet - wetT) * 0.03; if (Math.abs(wet - wetT) < 0.01) wetT = wet;
  scene.background.copy(DAY.sky).lerp(NIGHT.sky, t).lerp(weather === 'snow' ? SNOW_SKY : RAIN_SKY, wetT * (weather === 'snow' ? 0.5 : 0.6));
  sun.color.copy(DAY.sun).lerp(NIGHT.sun, t);
  hemi.intensity = (DAY.hemi + (NIGHT.hemi - DAY.hemi) * t) * (1 - wetT * 0.15);
  sun.intensity = (DAY.sunI + (NIGHT.sunI - DAY.sunI) * t) * (1 - wetT * 0.3);
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
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
  const sc = sun.shadow.camera;
  sc.left = -(halfW + 2); sc.right = halfW + 2;
  sc.updateProjectionMatrix();
}
if ('ResizeObserver' in window) {
  // the stage and the top bar both change size when fonts load or the phone turns
  const ro = new ResizeObserver(resize);
  ro.observe(stage); ro.observe(marquee);
} else window.addEventListener('resize', resize);
resize();

// Slow device? Lower the resolution, then the shadow detail, one step at a time.
// Only steps that need no shader rebuild are used (a rebuild mid-game is a hitch of its own).
// Each step is judged after 2 s of play: a step that does not help is undone and the next one is tried;
// once every step has been tried, the ladder stops (a phone capped at 30 fps keeps its quality).
const perf = { ema: 1 / 60, t: 0, undo: null, before: 0, tried: 0 };
function resetFrameWatch() {
  perf.undo = null;    // a step taken just before game over stays: it was never judged, and it is cheap
  perf.ema = 1 / 60; perf.t = 0;
}
function setRatio(r) { pixelRatio = r; renderer.setPixelRatio(r); resize(); }
function setShadowMapSize(n) {
  sun.shadow.mapSize.setScalar(n);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // rebuilt at the new size
}
// the ladder: each rung lowers one thing and returns how to undo it, or null if it has nothing left to lower
const LADDER = [
  () => {
    if (pixelRatio <= 1) return null;
    const was = pixelRatio;
    setRatio(Math.max(1, was - 0.25));
    return () => setRatio(was);
  },
  () => {
    if (sun.shadow.mapSize.x <= 512) return null;
    const was = sun.shadow.mapSize.x;
    setShadowMapSize(was / 2);
    return () => setShadowMapSize(was);
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
    if (perf.ema > perf.before * 0.9) perf.undo();       // no real gain: put it back, try the next rung
    perf.undo = null;
  }
  if (perf.ema < BAD_FRAME) return;
  while (perf.tried < LADDER.length && !perf.undo) perf.undo = LADDER[perf.tried++]();
  perf.before = perf.ema;
}

const getPixelRatio = () => pixelRatio;

export { BAD_FRAME, BLINK_STEPS, CAM_OFF, LADDER, ONE, camera, focus, getPixelRatio, hemi, lowGpu, marquee, perf, pixelRatio, reduceMotion, renderer, resetFrameWatch, resize, scene, setNight, setRatio, setShadowMapSize, stage, sun, touchQuery, watchFrameTime };
