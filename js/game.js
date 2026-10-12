// Hop Lanes game logic. Needs Three.js r128 (window.THREE) loaded first.
(() => {
'use strict';
// show one clear message and hide the controls that would do nothing
function fail(why) {
  for (const id of ['cards', 'deck', 'logo']) document.getElementById(id).hidden = true;
  const b = document.getElementById('banner');
  b.hidden = false;
  b.querySelector('h2').textContent = 'CAN NOT LOAD';
  b.querySelector('p').textContent = why;
}
if (!window.THREE) {
  fail('The 3D library did not load. Connect to the internet, or open hop-lanes-standalone.html.');
  return;
}

// ---------- tuning ----------
const PLAY_HALF = 4;          // playable columns: -4..4
const EDGE_DEATH = 5.4;       // carried this far on a log = swept away
const WRAP = 15;              // traffic wraps at +-WRAP
const HOP_TIME = 0.12;
const HIT_PAD = 0.28;         // extra hit width around cars and trains
const TRAIN_SPEED = 26;
const TRAIN_WARN = 1.3;       // seconds the signal flashes before a train
const LANES_AHEAD = 22, LANES_BEHIND = 12;
const FIRST_ROW = -8;         // rows behind the start line that are built for scenery
let camLead = 4.2;            // camera looks this many rows past the scroll line (less on wide screens)
const BEHIND_LIMIT = 4.5;     // fall this far behind the scroll line and you are out
const COUNTDOWN = 3;
const RESULTS_DELAY = 1.1;    // seconds from last death to the results panel (and restart)
const GO_TIME = 0.6;
const WIPE_MS = 130;          // restart fade; the new world is built while the screen is covered
const DIFF_ROWS = 140;        // rows until the game reaches full difficulty
const difficulty = r => Math.min(1, Math.max(0, r) / DIFF_ROWS);
const TAU = Math.PI * 2;
const $ = id => document.getElementById(id);

// ---------- game state ----------
let state = 'attract', stateT = 0, camRow = 0, playT = 0, countdown = 0, goT = 0;
let visRows = 14;      // lanes further than this from the camera focus are not drawn
let frameN = 0;
let bannerKey = '';

// ---------- test hooks and seeds ----------
// #debug exposes window.hopLanes; #seed-42 or #debug-seed-42 builds the same world every game
const hashMatch = /^#(debug)?(?:-?seed-(\d+))?$/.exec(location.hash) || [];
const DEBUG = hashMatch[1] === 'debug';
const FIXED_SEED = hashMatch[2] !== undefined ? Number(hashMatch[2]) >>> 0 : null;

// ---------- shared colors (3D models and the pixel portraits use the same ones) ----------
const COLORS = {
  frog: { body: 0x4cbf3f, belly: 0xa6e37a, mouth: 0xe0453a, eye: 0xffffff, pupil: 0x111111, leg: 0x2d7a25 },
  fox: { fur: 0xf07a2a, cream: 0xfff4e6, dark: 0x1a1a1a }
};
const css = hex => '#' + hex.toString(16).padStart(6, '0');

// ---------- storage (best effort) ----------
const BEST_KEY = 'hoplanes.best', DAY_PREFIX = 'hoplanes.day.';
const dayKey = () => DAY_PREFIX + new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD
// stored scores are only ever whole, non-negative numbers; anything else reads as 0
function load(k) {
  try {
    const n = Math.floor(Number(localStorage.getItem(k)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) { return 0; }
}
function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
function dropOldDays() {
  try {
    const keep = dayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DAY_PREFIX) && k !== keep) localStorage.removeItem(k);
    }
  } catch (e) {}
}
let bestAll = load(BEST_KEY);
let bestDay = 0, shownDay = '';
function refreshBests() {
  shownDay = dayKey();
  bestDay = load(shownDay);
  $('best').textContent = bestAll;
  $('daily').textContent = bestDay;
}
dropOldDays();
// a game left open past midnight starts a new "today"
setInterval(() => { if (dayKey() !== shownDay) { dropOldDays(); refreshBests(); } }, 60000);

// ---------- pixel portraits for the join cards ----------
const PIX = {
  frog: { rows: [
    '............',
    '..WWW..WWW..',
    '..WKW..WKW..',
    '.GGGGGGGGGG.',
    '.GGGGGGGGGG.',
    '.GRRRRRRRRG.',
    '.GGGGGGGGGG.',
    '.GLLLLLLLLG.',
    '.GLLLLLLLLG.',
    '.DD.DD.DD.DD',
    '............',
    '............'],
    pal: { W: COLORS.frog.eye, K: COLORS.frog.pupil, G: COLORS.frog.body, R: COLORS.frog.mouth, L: COLORS.frog.belly, D: COLORS.frog.leg } },
  fox: { rows: [
    '.K........K.',
    '.OO......OO.',
    '.OOOOOOOOOO.',
    '.OOKOOOOKOO.',
    '.OOOOOOOOOO.',
    '.OOWWWWWWOO.',
    '.OWWWKKWWWO.',
    '.OOWWWWWWOO.',
    '.OOOWWWWOOO.',
    '.OOOOOOOOOO.',
    '..KK....KK..',
    '............'],
    pal: { O: COLORS.fox.fur, W: COLORS.fox.cream, K: COLORS.fox.dark } }
};
function drawPix(svg, art) {
  let s = '';
  art.rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c !== '.') s += `<rect x="${x}" y="${y}" width="1" height="1" fill="${css(art.pal[c])}"/>`;
  }));
  svg.innerHTML = s;
}
drawPix($('pic1'), PIX.frog);
drawPix($('pic2'), PIX.fox);

// ---------- audio ----------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && actx && actx.state === 'running') actx.suspend().catch(() => {});
});
const sfx = {
  hop: id => beep(id ? 520 : 440, 0.07, 'square', 0.04, 200),
  squash: () => beep(160, 0.25, 'sawtooth', 0.08, -120),
  splash: () => beep(900, 0.3, 'triangle', 0.06, -800),
  fall: () => beep(300, 0.4, 'triangle', 0.06, -220),
  bell: () => beep(1250, 0.08, 'square', 0.025),
  horn: () => { beep(220, 0.5, 'sawtooth', 0.05); beep(277, 0.5, 'sawtooth', 0.04); },
  join: () => { beep(660, 0.08); setTimeout(() => beep(990, 0.12), 80); },
  go: () => beep(880, 0.25, 'square', 0.06),
  tick: () => beep(440, 0.1, 'square', 0.05)
};

// ---------- phone extras: buzz and keep the screen on (both optional) ----------
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
let wakeLock = null, wakePending = false, wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && !wakePending && navigator.wakeLock) {
      wakePending = true;   // one request at a time, or an orphaned lock keeps the screen on
      const lock = await navigator.wakeLock.request('screen').finally(() => { wakePending = false; });
      if (!wantAwake) { lock.release(); return; }   // the game ended while we waited
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!on && wakeLock) await wakeLock.release();
  } catch (e) { wakeLock = null; }
}
// the browser drops the lock when the tab is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (wantAwake && document.visibilityState === 'visible') keepAwake(true);
});

// ---------- three.js setup ----------
const lowGpu = matchMedia('(pointer: coarse)').matches;              // phones/tablets: cheaper shadows and resolution
const touchQuery = matchMedia('(pointer: coarse)');                  // touch hints follow the current input
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BLINK_STEPS = reduceMotion ? 2.5 : 8;                          // rail light on/off changes per second
const stage = $('stage'), marquee = $('marquee');
let renderer;
// on high-density phone screens edges are already fine, and multisampling costs a lot of fill
try { renderer = new THREE.WebGLRenderer({ antialias: !(lowGpu && (window.devicePixelRatio || 1) >= 2) }); }
catch (e) { fail('This browser can not show 3D graphics. Turn on WebGL or try another browser.'); return; }
let pixelRatio = Math.min(lowGpu ? 1.5 : 2, window.devicePixelRatio || 1);
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(lowGpu ? 1024 : 2048);
Object.assign(sun.shadow.camera, { top: 15, bottom: -15, near: 1, far: 50 });   // left/right set in resize()
scene.add(sun, sun.target);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  // the score and the logo sit just under the top bar, whatever its height
  stage.style.setProperty('--marquee-h', marquee.offsetHeight + 'px');
  const aspect = w / h;
  // wide screens (a phone held sideways) zoom out so enough rows stay visible,
  // and aim lower so the players sit above the floating buttons
  const wide = aspect > 1.3;
  const halfW = wide ? Math.max(7.2, 6.5 * aspect) : aspect < 0.8 ? 6.2 : 7.2;
  camLead = wide ? 2.5 : 4.2;
  Object.assign(camera, { left: -halfW, right: halfW, top: halfW / aspect, bottom: -halfW / aspect });
  camera.updateProjectionMatrix();
  // rows on screen (the ground is seen at an angle, so one screen unit covers ~1.35 rows) + a margin for shadows
  visRows = camera.top * 1.35 + 2;
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

// Slow device? Lower the resolution, then the shadow detail, then the shadow filter, one step at a time.
// A step that does not help (a phone capped at 30 fps in power-saving mode) is undone, and the ladder stops.
const perf = { ema: 1 / 60, t: 0, undo: null, before: 0, done: false };
function resetFrameWatch() { perf.ema = 1 / 60; perf.t = 0; perf.undo = null; }
function setRatio(r) { pixelRatio = r; renderer.setPixelRatio(r); resize(); }
function setShadowMapSize(n) {
  sun.shadow.mapSize.setScalar(n);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // rebuilt at the new size
}
function setShadowType(type) {
  renderer.shadowMap.type = type;
  for (const m of [voxelMat, LIGHT_ON, LIGHT_OFF, splashMat, dustMat]) m.needsUpdate = true;
}
// takes one step down and returns how to undo it, or null when nothing is left to lower
function lowerQuality() {
  if (pixelRatio > 1) { const r = pixelRatio; setRatio(Math.max(1, r - 0.25)); return () => setRatio(r); }
  if (sun.shadow.mapSize.x > 512) { const n = sun.shadow.mapSize.x; setShadowMapSize(n / 2); return () => setShadowMapSize(n); }
  if (renderer.shadowMap.type !== THREE.BasicShadowMap) {
    const t = renderer.shadowMap.type; setShadowType(THREE.BasicShadowMap); return () => setShadowType(t);
  }
  return null;
}
function watchFrameTime(rawDt) {
  if (perf.done || state !== 'play' || rawDt > 0.1) return;   // ignore menus and tab switches
  perf.ema += (rawDt - perf.ema) * 0.05;
  if ((perf.t += rawDt) < 2) return;
  perf.t = 0;
  if (perf.undo) {                                       // judge the last step
    if (perf.ema > perf.before * 0.9) { perf.undo(); perf.done = true; return; }
    perf.undo = null;
  }
  if (perf.ema < 0.022) return;                          // ~45 fps or better: keep quality
  perf.before = perf.ema;
  perf.undo = lowerQuality();
  if (!perf.undo) perf.done = true;
}

// ---------- merged voxel meshes ----------
// Every model is a list of boxes [w, h, d, color, x, y, z] (y = bottom of the box).
// Each list becomes ONE mesh with vertex colors, so a lane or a car is a single draw call.
const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const UP = UNIT.attributes.position.array, UN = UNIT.attributes.normal.array, UI = UNIT.index.array;
const UV = UP.length / 3;
const tmpColor = new THREE.Color();

function mergeBoxes(boxes) {
  const n = boxes.length;
  const pos = new Float32Array(n * UV * 3), nor = new Float32Array(n * UV * 3), col = new Float32Array(n * UV * 3);
  const idx = new (n * UV > 65535 ? Uint32Array : Uint16Array)(n * UI.length);
  boxes.forEach(([w, h, d, color, x, y, z], k) => {
    tmpColor.setHex(color);
    const o = k * UV * 3;
    for (let i = 0; i < UV * 3; i += 3) {
      pos[o + i] = UP[i] * w + x;
      pos[o + i + 1] = UP[i + 1] * h + y + h / 2;
      pos[o + i + 2] = UP[i + 2] * d + z;
      col[o + i] = tmpColor.r; col[o + i + 1] = tmpColor.g; col[o + i + 2] = tmpColor.b;
    }
    nor.set(UN, o);
    for (let i = 0; i < UI.length; i++) idx[k * UI.length + i] = UI[i] + k * UV;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
function voxelMesh(geo, cast = true) {
  const m = new THREE.Mesh(geo, voxelMat);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}
// shared geometries for models that repeat (never disposed)
const geoCache = new Map();
const cachedGeo = (key, build) => geoCache.get(key) || geoCache.set(key, mergeBoxes(build())).get(key);

// ---------- random ----------
// The world is built from a seeded generator, so a seed always gives the same lanes.
// Effects (particles, train timing after the first train) use Math.random and never shift the world.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let worldSeed = 0, worldRng = Math.random;
const rand = (a, b, r = worldRng) => a + r() * (b - a);
const pick = (arr, r = worldRng) => arr[Math.floor(r() * arr.length)];
const fxRand = (a, b) => rand(a, b, Math.random);

// ---------- models (all face -z, which is "forward") ----------
function frogBoxes() {
  const c = COLORS.frog;
  const b = [
    [0.62, 0.36, 0.62, c.body, 0, 0.08, 0],
    [0.5, 0.06, 0.5, c.belly, 0, 0.02, 0],
    [0.5, 0.05, 0.04, c.mouth, 0, 0.22, -0.31]
  ];
  for (const s of [-1, 1]) b.push(
    [0.2, 0.2, 0.2, c.eye, s * 0.17, 0.42, -0.16],
    [0.08, 0.1, 0.06, c.pupil, s * 0.17, 0.48, -0.27],
    [0.16, 0.12, 0.3, c.leg, s * 0.33, 0, 0.12],      // back legs
    [0.1, 0.1, 0.12, c.leg, s * 0.22, 0, -0.32]);     // front feet
  return b;
}
function foxBoxes() {
  const c = COLORS.fox;
  const b = [
    [0.5, 0.5, 0.56, c.fur, 0, 0.1, 0],
    [0.36, 0.3, 0.06, c.cream, 0, 0.12, -0.29],       // chest
    [0.26, 0.16, 0.22, c.cream, 0, 0.3, -0.36],       // snout
    [0.08, 0.07, 0.06, c.dark, 0, 0.42, -0.47],       // nose
    [0.18, 0.18, 0.34, c.fur, 0, 0.25, 0.42],         // tail
    [0.16, 0.16, 0.12, c.cream, 0, 0.26, 0.64]
  ];
  for (const s of [-1, 1]) b.push(
    [0.07, 0.09, 0.04, c.dark, s * 0.15, 0.46, -0.28],  // eyes
    [0.14, 0.18, 0.1, c.fur, s * 0.16, 0.6, -0.05],     // ears
    [0.14, 0.06, 0.1, c.dark, s * 0.16, 0.78, -0.05],
    [0.1, 0.12, 0.1, c.dark, s * 0.14, 0, -0.12]);      // legs
  return b;
}
const CAR_COLORS = [0xe8513a, 0x3a8ee8, 0xf2c33a, 0x8f5ae0, 0x3ac27a, 0xf27fb0];
function vehicleBoxes(truck, c) {
  const len = truck ? 2.4 : 1.4;
  const b = truck ? [
    [1.7, 0.75, 0.8, 0xeeeeee, 0.3, 0.12, 0],
    [0.6, 0.6, 0.78, c, -0.85, 0.12, 0],
    [0.12, 0.3, 0.66, 0x223344, -1.12, 0.38, 0]
  ] : [
    [1.4, 0.42, 0.78, c, 0, 0.12, 0],
    [0.75, 0.3, 0.66, 0xffffff, 0.08, 0.54, 0],
    [0.06, 0.2, 0.6, 0x223344, -0.3, 0.58, 0]
  ];
  for (const wx of [-len / 2 + 0.3, len / 2 - 0.3]) for (const wz of [-0.38, 0.38])
    b.push([0.3, 0.26, 0.1, 0x222222, wx, 0, wz]);
  return b;
}
const logBoxes = len => [
  [len, 0.26, 0.78, 0x8a5130, 0, -0.16, 0],
  [0.12, 0.27, 0.7, 0xc08a5a, -len / 2 + 0.05, -0.16, 0],
  [0.12, 0.27, 0.7, 0xc08a5a, len / 2 - 0.05, -0.16, 0]
];
const TRAIN_CARS = 4, TRAIN_CAR_LEN = 3, TRAIN_GAP = 0.15;
const TRAIN_LEN = TRAIN_CARS * TRAIN_CAR_LEN + (TRAIN_CARS - 1) * TRAIN_GAP;
function trainBoxes(dir) {
  const b = [];
  for (let i = 0; i < TRAIN_CARS; i++) {
    const x = -TRAIN_LEN / 2 + TRAIN_CAR_LEN / 2 + i * (TRAIN_CAR_LEN + TRAIN_GAP);
    const front = dir > 0 ? i === TRAIN_CARS - 1 : i === 0;
    b.push([TRAIN_CAR_LEN, 0.9, 0.84, front ? 0xd83a3a : 0x3a6fd8, x, 0.12, 0],
           [TRAIN_CAR_LEN - 0.3, 0.2, 0.86, 0xdde6ff, x, 0.62, 0]);
  }
  const wheels = TRAIN_CARS * 2;
  for (let i = 0; i < wheels; i++)
    b.push([0.4, 0.15, 0.9, 0x222222, -TRAIN_LEN / 2 + 0.6 + i * (TRAIN_LEN - 1.2) / (wheels - 1), 0, 0]);
  return b;
}
function makeCharacter(boxesFn, key) {
  const g = new THREE.Group();
  const body = voxelMesh(cachedGeo(key, boxesFn));
  g.add(body); g.userData.body = body;
  return g;
}

// rail signal light: two shared materials, swapped instead of edited
const LIGHT_OFF = new THREE.MeshLambertMaterial({ color: 0x331111 });
const LIGHT_ON = new THREE.MeshLambertMaterial({ color: 0x331111, emissive: 0xff2222 });
const lightGeo = new THREE.BoxGeometry(0.38, 0.2, 0.14);

// ---------- world ----------
const lanes = new Map();
let maxRow = FIRST_ROW - 1;
const worldGroup = new THREE.Group();
scene.add(worldGroup);
let lastKind = 'grass', streak = 0;

function laneKind(r) {
  if (r < 4) return 'grass';
  const diff = difficulty(r);
  let k;
  // keep runs of the same type together, like real roads and rivers
  if (lastKind !== 'grass' && streak < (lastKind === 'road' ? 4 : 3) && worldRng() < 0.55) k = lastKind;
  else {
    const w = { grass: 0.32 - diff * 0.12, road: 0.36, river: 0.2 + diff * 0.06, rail: 0.12 + diff * 0.06 };
    let x = worldRng() * (w.grass + w.road + w.river + w.rail);
    k = 'rail';
    for (const key of ['grass', 'road', 'river']) { if ((x -= w[key]) < 0) { k = key; break; } }
    if (k === 'grass' && lastKind === 'grass') k = pick(['road', 'river']);
  }
  streak = k === lastKind ? streak + 1 : 1;
  lastKind = k;
  return k;
}

// moving things in a lane share one wrap span so their gaps never drift
function fillTraffic(lane, count, z, makeObj) {
  const spacing = lane.span / count;
  const x0 = rand(-lane.span / 2, -lane.span / 2 + 3);
  for (let i = 0; i < count; i++) {
    const o = makeObj(spacing);
    o.x = x0 + i * spacing + (o.jitter || 0);
    o.mesh.position.set(o.x, 0, z);
    lane.group.add(o.mesh); lane.objs.push(o);
  }
}

// One builder per lane type. Each adds its static boxes to `ground` (merged into one mesh later)
// and its moving parts to lane.group / lane.objs.
const LANE_BUILDERS = {
  grass(lane, { r, z, diff, ground }) {
    ground.push([40, 0.3, 1, r % 2 ? 0xb7e05a : 0xaedb4f, 0, -0.3, z]);
    let inPlay = 0;
    for (let x = -12; x <= 12; x++) {
      const out = Math.abs(x) > PLAY_HALF;
      // column 0 never gets a tree, so there is always a way forward
      const tree = out ? worldRng() < 0.85
        : r > 1 && x !== 0 && inPlay < 4 && worldRng() < 0.16 + diff * 0.08;
      if (!tree) continue;
      if (!out) inPlay++;
      lane.trees.add(x);
      ground.push([0.3, 0.3, 0.3, 0x7a4b2a, x, 0, z], [0.72, pick([0.6, 0.9, 1.2, 1.5]), 0.72, 0xa9cf3a, x, 0.3, z]);
    }
  },
  road(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x4a4f5c, 0, -0.3, z]);
    if (prev && prev.kind === 'road')
      for (let x = -12; x <= 12; x += 2) ground.push([0.8, 0.02, 0.08, 0xe8e8e8, x, 0, z + 0.5]);
    lane.speed = rand(1.6, 2.8) + diff * 2.4;
    const truck = worldRng() < 0.3, len = truck ? 2.4 : 1.4;
    const rot = lane.dir > 0 ? Math.PI : 0;   // vehicle models face -x; turn them to face where they drive
    fillTraffic(lane, Math.floor(rand(2, 4) + diff * 1.5), z, spacing => {
      const c = pick(CAR_COLORS);
      const mesh = voxelMesh(cachedGeo(`car${truck}${c}`, () => vehicleBoxes(truck, c)));
      mesh.rotation.y = rot;
      return { mesh, len, jitter: rand(0, spacing * 0.35) };
    });
  },
  river(lane, { z, diff, prev, ground }) {
    ground.push([40, 0.3, 1, 0x5ec8f0, 0, -0.45, z]);
    if (prev && prev.kind === 'river') lane.dir = -prev.dir;
    lane.speed = rand(1.0, 1.9) + diff * 1.0;
    fillTraffic(lane, Math.max(3, Math.floor(rand(4, 6) - diff * 2)), z, () => {
      const len = pick([2, 3, 3, 4]) - (diff > 0.6 && worldRng() < 0.5 ? 1 : 0);
      return { mesh: voxelMesh(cachedGeo('log' + len, () => logBoxes(len)), false), len };   // flat on the water
    });
  },
  rail(lane, { z, ground }) {
    ground.push([40, 0.3, 1, 0x7b6f6a, 0, -0.3, z]);
    for (let x = -14; x <= 14; x += 0.7) ground.push([0.18, 0.06, 0.9, 0x5a3d2a, x, 0, z]);
    const poleX = PLAY_HALF + 0.6;
    ground.push([40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z - 0.28], [40, 0.06, 0.08, 0x9aa3b5, 0, 0.05, z + 0.28],
                [0.12, 1.3, 0.12, 0xeeeeee, poleX, 0, z + 0.45]);
    lane.light = new THREE.Mesh(lightGeo, LIGHT_OFF);
    lane.light.position.set(poleX, 1.2, z + 0.45);
    lane.group.add(lane.light);
    Object.assign(lane, { timer: rand(2, 6), warned: false, lastBell: -1 });
    lane.train = { mesh: voxelMesh(cachedGeo('train' + lane.dir, () => trainBoxes(lane.dir))), len: TRAIN_LEN, x: 99, active: false };
    lane.train.mesh.position.set(99, 0, z);
    lane.train.mesh.visible = false;
    lane.group.add(lane.train.mesh);
  }
};

function addLane(r) {
  const kind = laneKind(r);
  const lane = {
    r, kind, group: new THREE.Group(), objs: [], trees: new Set(),
    dir: worldRng() < 0.5 ? 1 : -1, speed: 0, span: WRAP * 2 + 4
  };
  const ground = [];
  LANE_BUILDERS[kind](lane, { r, z: -r, diff: difficulty(r), prev: lanes.get(r - 1), ground });
  // unique per lane, disposed with the lane; flat ground does not cast shadows, trees and the rail pole do
  lane.ground = voxelMesh(mergeBoxes(ground), kind === 'grass' ? lane.trees.size > 0 : kind === 'rail');
  lane.ground.matrixAutoUpdate = false;
  lane.ground.updateMatrix();
  lane.group.add(lane.ground);
  worldGroup.add(lane.group);
  lanes.set(r, lane);
  maxRow = Math.max(maxRow, r);
}

function dropLane(lane) {
  worldGroup.remove(lane.group);
  lane.ground.geometry.dispose();
  lanes.delete(lane.r);
}

const near = r => state === 'play' && Math.abs(r - (camRow + camLead)) < visRows;   // rails on screen

function moveTraffic(lane, dt, now) {
  const half = lane.span / 2, step = lane.dir * lane.speed * dt, river = lane.kind === 'river';
  for (const o of lane.objs) {
    o.x += step;
    if (o.x > half) o.x -= lane.span;
    else if (o.x < -half) o.x += lane.span;
    o.mesh.position.x = o.x;
    if (river) o.mesh.position.y = Math.sin(now / 400 + o.x) * 0.02;
  }
}
function updateRail(lane, dt, now) {
  const tr = lane.train;
  let on;
  if (!tr.active) {
    lane.timer -= dt;
    const blink = Math.floor(lane.timer * BLINK_STEPS);
    on = lane.timer < TRAIN_WARN && blink % 2 === 0;
    if (lane.timer < TRAIN_WARN && !lane.warned) { lane.warned = true; if (near(lane.r)) sfx.horn(); }
    if (on && blink !== lane.lastBell && near(lane.r)) { lane.lastBell = blink; sfx.bell(); }
    if (lane.timer <= 0) {
      tr.active = true; tr.mesh.visible = true;
      tr.x = -lane.dir * (WRAP + tr.len / 2 + 2);
    }
  } else {
    tr.x += lane.dir * TRAIN_SPEED * dt;
    tr.mesh.position.x = tr.x;
    on = Math.floor(now * BLINK_STEPS / 1000) % 2 === 1;
    if (Math.abs(tr.x) > WRAP + tr.len / 2 + 3) {
      tr.active = false; tr.mesh.visible = false; lane.warned = false;
      lane.timer = fxRand(3.5, 8);
    }
  }
  lane.light.material = on ? LIGHT_ON : LIGHT_OFF;
}
function updateLanes(dt, now) {
  for (const lane of lanes.values()) {
    if (lane.kind === 'road' || lane.kind === 'river') moveTraffic(lane, dt, now);
    else if (lane.kind === 'rail') updateRail(lane, dt, now);
  }
}

// Visible rows are built at once; rows further ahead are added one per frame, so a restart
// or a fast run never builds many lanes in a single frame.
const lastNeededRow = () => Math.ceil(camRow + camLead + visRows);
const firstNeededRow = () => Math.min(camRow - LANES_BEHIND, Math.floor(camRow + camLead - visRows));
function resetWorld() {
  for (const lane of [...lanes.values()]) dropLane(lane);
  worldSeed = FIXED_SEED !== null ? FIXED_SEED : (Math.random() * 4294967296) >>> 0;
  worldRng = mulberry32(worldSeed);
  maxRow = Math.min(FIRST_ROW, firstNeededRow()) - 1; lastKind = 'grass'; streak = 0;
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
}
function ensureLanes() {
  while (maxRow < lastNeededRow()) addLane(maxRow + 1);
  // keep a few rows built ahead of the screen edge, so a lane is never built in the frame it appears
  if (maxRow < Math.max(camRow + LANES_AHEAD, lastNeededRow() + 6)) addLane(maxRow + 1);
  const first = firstNeededRow();
  for (const lane of lanes.values()) if (lane.r < first) dropLane(lane);
}

// ---------- players ----------
const players = [
  { id: 0, boxes: frogBoxes, key: 'frog', startX: -2, joined: false, scoreEl: $('score1').querySelector('b') },
  { id: 1, boxes: foxBoxes, key: 'fox', startX: 2, joined: false, scoreEl: $('score2').querySelector('b') }
];
function spawn(p) {
  if (p.mesh) scene.remove(p.mesh);
  p.mesh = makeCharacter(p.boxes, p.key);
  scene.add(p.mesh);
  Object.assign(p, {
    x: p.startX, row: 0, alive: true, hop: null, queue: null, score: 0,
    facing: 0, cause: '', log: null, logOff: 0, trainDir: 0
  });
  p.mesh.position.set(p.x, 0, 0);
  p.scoreEl.textContent = '0';
}
function despawn(p) { if (p.mesh) { scene.remove(p.mesh); p.mesh = null; } p.alive = false; }

function tryMove(p, dx, dr) {
  if (!p.alive) return;
  if (p.hop) { p.queue = [dx, dr]; return; }
  // rotation.y: 0 = forward (-z), PI = back, +PI/2 = left, -PI/2 = right
  p.facing = dr > 0 ? 0 : dr < 0 ? Math.PI : (dx > 0 ? -Math.PI / 2 : Math.PI / 2);
  const lane = lanes.get(p.row + dr);
  if (!lane) return;
  let tx = p.x + dx;
  if (lane.kind === 'river') { if (Math.abs(tx) > PLAY_HALF + 0.5) return; }
  else {
    tx = Math.round(tx);
    if (Math.abs(tx) > PLAY_HALF) return;
    if (lane.kind === 'grass' && lane.trees.has(tx)) return;
  }
  if (p.row + dr < camRow - BEHIND_LIMIT) return;
  p.hop = {
    t: 0, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -(p.row + dr),
    carry: p.log, carryX0: p.log ? p.log.x : 0, span: p.log ? lanes.get(p.row).span : 0
  };
  p.row += dr;
  if (p.row > p.score) { p.score = p.row; p.scoreEl.textContent = p.score; }
  sfx.hop(p.id);
  buzz(8);
}

const DEATH_SOUND = { splash: sfx.splash, slow: sfx.fall };
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
  } else p.x = Math.round(p.x);
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
  m.userData.body.scale.copy(ONE);
  return t < 1 || land(p, lane);
}
// standing still (or riding a log); returns false if the log carried the player off the edge
function stand(p, dt) {
  const m = p.mesh;
  m.userData.body.scale.lerp(ONE, Math.min(1, dt * 14));
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
  if (p.row < camRow - BEHIND_LIMIT) kill(p, 'slow');
}
function updatePlayer(p, dt) {
  if (!p.mesh) return;
  turnToward(p.mesh, p.facing, dt);
  if (!p.alive) { animateDeath(p, dt); return; }
  const lane = lanes.get(p.row);
  const ok = p.hop ? stepHop(p, lane, dt) : stand(p, dt);
  if (ok && p.alive) checkHazards(p, lanes.get(p.row));
}

// ---------- screens ----------
const banner = $('banner'), bannerH = banner.querySelector('h2'), bannerP = banner.querySelector('p');
const resultsEl = $('results');
function setBanner(h, sub = '') {
  const key = h + '|' + sub;
  if (key === bannerKey) return;      // only touch the DOM when the text changes
  bannerKey = key;
  banner.hidden = !h;
  bannerH.textContent = h; bannerP.textContent = sub;
}
const pads = document.querySelectorAll('.pad');
const joinText = () => touchQuery.matches ? 'TAP THIS\nSIDE TO JOIN' : 'PRESS TAP\nTO JOIN';
function setCard(i) {
  const c = $('card' + (i + 1)), p = players[i];
  pads[i].classList.toggle('idle', (state === 'play' || state === 'over') && !p.joined);
  c.classList.toggle('ready', p.joined && state === 'countdown');
  c.style.visibility = state === 'play' || state === 'over' ? 'hidden' : 'visible';
  c.firstElementChild.textContent = p.joined ? 'READY!' : joinText();
  c.lastElementChild.textContent = p.joined ? 'PLAYER ' + (i + 1) : 'FREE PLAY';
}
const setCards = () => { setCard(0); setCard(1); };

function toAttract() {
  state = 'attract'; stateT = 0; camRow = 0;
  players.forEach(p => { p.joined = false; despawn(p); });
  resetWorld();
  refreshBests();
  resultsEl.hidden = true; $('logo').hidden = false;
  $('score1').hidden = $('score2').hidden = true;
  setBanner('');
  setCards();
}
// cover the screen, build the new world under the cover, then fade back in
const wipe = $('wipe');
let restarting = false;
function restart(joinPlayer) {
  if (restarting) return;
  restarting = true;
  wipe.classList.add('on');
  setTimeout(() => {
    toAttract();
    if (joinPlayer !== undefined) join(joinPlayer);
    requestAnimationFrame(() => { wipe.classList.remove('on'); restarting = false; });
  }, reduceMotion ? 0 : WIPE_MS);
}
function join(i) {
  const p = players[i];
  if (p.joined) return;
  p.joined = true; sfx.join();
  spawn(p);
  if (state === 'attract') { state = 'countdown'; countdown = COUNTDOWN; countdownKey = ''; }
  else countdown = Math.max(countdown, 2.5);
  $('logo').hidden = true;
  setCards();
}
function startPlay() {
  state = 'play'; playT = 0; goT = GO_TIME; sfx.go();
  resetFrameWatch();
  keepAwake(true);
  setBanner('GO!');
  players.forEach((p, i) => { $('score' + (i + 1)).hidden = !p.joined; });
  setCards();
}
function checkOver() {
  if (state !== 'play' || players.some(p => p.joined && p.alive)) return;
  state = 'over'; stateT = 0;
  keepAwake(false);
  setBanner('');
  const [p1, p2] = players;
  const top = Math.max(p1.joined ? p1.score : 0, p2.joined ? p2.score : 0);
  let note = '';
  if (top > bestAll) { bestAll = top; save(BEST_KEY, top); note = 'NEW ALL TIME BEST!'; }
  if (top > load(dayKey())) { save(dayKey(), top); note = note || 'NEW BEST TODAY!'; }
  refreshBests();
  $('resTitle').textContent = !(p1.joined && p2.joined) ? 'GAME OVER'
    : p1.score === p2.score ? 'TIE GAME!'
    : p1.score > p2.score ? 'FROG WINS!' : 'FOX WINS!';
  $('res1').hidden = !p1.joined; $('res2').hidden = !p2.joined;
  $('res1').querySelector('b').textContent = p1.score;
  $('res2').querySelector('b').textContent = p2.score;
  $('resNote').textContent = (note ? note + ' ' : '') + 'PRESS TAP TO PLAY AGAIN';
}

// ---------- input ----------
const canRestart = () => state === 'over' && stateT > RESULTS_DELAY && !restarting;
function press(i, dx, dr) {
  audio();
  if (restarting) return;
  if (state === 'attract' || state === 'countdown') join(i);
  else if (state === 'play') { if (players[i].joined) tryMove(players[i], dx, dr); }
  else if (canRestart()) restart(i);
}
function pressStart() {
  audio();
  if (restarting) return;
  if (state === 'attract') join(0);
  else if (state === 'countdown') countdown = Math.min(countdown, 0.01);
  else if (canRestart()) restart();
}

const KEYS = {
  KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [0, -1, 0], KeyD: [0, 1, 0],
  ArrowUp: [1, 0, 1], ArrowDown: [1, 0, -1], ArrowLeft: [1, -1, 0], ArrowRight: [1, 1, 0]
};
window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser shortcuts alone
  // a focused on-screen button handles its own Enter/Space (as a click)
  if ((e.code === 'Enter' || e.code === 'Space') && e.target.closest && e.target.closest('button')) return;
  const k = KEYS[e.code];
  if (k) { e.preventDefault(); press(...k); }
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); pressStart(); }
});
document.querySelectorAll('.tap').forEach(btn => {
  const i = +btn.dataset.p;
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('down'); press(i, 0, 1); });
  btn.addEventListener('click', e => { if (e.detail === 0) press(i, 0, 1); });   // keyboard activation only
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, () => btn.classList.remove('down')));
});
document.querySelectorAll('.side').forEach(btn => {
  btn.addEventListener('pointerdown', e => { e.preventDefault(); press(+btn.dataset.p, +btn.dataset.dx, 0); });
  btn.addEventListener('click', e => { if (e.detail === 0) press(+btn.dataset.p, +btn.dataset.dx, 0); });
});
$('start').addEventListener('click', pressStart);

// touch (or click) on the field itself: tap = hop forward, swipe = move that way.
// With one player in the game the whole field is theirs; otherwise left half = P1, right half = P2.
const SWIPE_MIN = 24;   // px of travel before a touch counts as a swipe
const pointers = new Map();
function fieldPlayer(clientX) {
  if (state === 'play' || state === 'over') {   // a solo player owns the whole field, also for "play again"
    const solo = players.filter(p => p.joined);
    if (solo.length === 1) return solo[0].id;
  }
  const r = stage.getBoundingClientRect();
  return clientX < r.left + r.width / 2 ? 0 : 1;
}
stage.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, i: fieldPlayer(e.clientX), done: false });
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}   // release lands here even off the field
});
stage.addEventListener('pointermove', e => {
  const t = pointers.get(e.pointerId);
  if (!t || t.done) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  if (Math.hypot(dx, dy) < SWIPE_MIN) return;
  t.done = true;   // fire the swipe now, not on release, so it feels instant
  if (Math.abs(dx) > Math.abs(dy)) press(t.i, Math.sign(dx), 0);
  else press(t.i, 0, dy < 0 ? 1 : -1);
});
function endTouch(e) {
  const t = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (t && !t.done && e.type === 'pointerup') press(t.i, 0, 1);
}
stage.addEventListener('pointerup', endTouch);
stage.addEventListener('pointercancel', endTouch);
$('app').addEventListener('contextmenu', e => e.preventDefault());

// ---------- loop ----------
let countdownKey = '';
function updateCountdown(dt) {
  const before = Math.ceil(countdown);
  countdown -= dt;
  const n = Math.ceil(countdown);
  if (n !== before && n > 0) sfx.tick();
  if (countdown <= 0) { startPlay(); return; }
  const both = players.every(p => p.joined);
  const key = n + (both ? 'b' : 's');
  if (key === countdownKey) return;                     // the text only changes each second or on a join
  countdownKey = key;
  setBanner(String(n), (both ? 'FROG VS FOX' : 'OTHER PLAYER: TAP TO JOIN')
    + (touchQuery.matches ? '\nTAP TO HOP · SWIPE TO TURN' : ''));
}
function updateCamera(dt) {
  playT += dt;
  if (goT > 0 && (goT -= dt) <= 0) setBanner('');
  let lead = -Infinity;
  for (const p of players) if (p.joined && p.alive) lead = Math.max(lead, p.row);
  // the camera creeps forward on its own, and catches up fast to a player who runs ahead
  camRow += Math.min(1.1, 0.3 + playT * 0.006) * dt;
  if (lead - 2 > camRow) camRow += (lead - 2 - camRow) * Math.min(1, dt * 3);
}
function placeCamera() {
  focus.set(0, 0, -(camRow + camLead));
  camera.position.copy(focus).add(CAM_OFF);
  camera.lookAt(focus);
  sun.position.set(focus.x - 6, 14, focus.z + 6);
  sun.target.position.copy(focus);
  const focusRow = camRow + camLead;
  for (const lane of lanes.values()) lane.group.visible = Math.abs(lane.r - focusRow) < visRows;
}

let last = performance.now(), lastDraw = 0;
function frame(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.max(0, Math.min(0.05, rawDt));
  last = now; stateT += dt;

  if (state === 'countdown') updateCountdown(dt);
  else if (state === 'play') updateCamera(dt);
  else if (state === 'over' && stateT > RESULTS_DELAY && resultsEl.hidden) resultsEl.hidden = false;

  ensureLanes();
  updateLanes(dt, now);
  for (const p of players) updatePlayer(p, dt);
  updateParts(dt);
  placeCamera();
  watchFrameTime(rawDt);

  // draw at most ~60 fps while playing (120 Hz phones), and every other frame on menus, to save battery
  const idle = state === 'attract' || (state === 'over' && stateT > RESULTS_DELAY);
  if (idle ? (frameN++ & 1) === 0 : now - lastDraw >= 14) { renderer.render(scene, camera); lastDraw = now; }
  if (state === 'attract' && stateT > 5 && actx && actx.state === 'running') actx.suspend().catch(() => {});
  requestAnimationFrame(frame);
}

if (DEBUG) {
  window.hopLanes = {
    players, renderer,
    get state() { return state; },
    get camRow() { return camRow; },
    get seed() { return worldSeed; },
    get pixelRatio() { return pixelRatio; },
    // lane types for rows 0..30 (builds missing rows ahead first)
    laneKinds() {
      while (maxRow < 30) addLane(maxRow + 1);
      const out = [];
      for (let r = 0; r <= 30; r++) out.push(lanes.get(r).kind);
      return out;
    }
  };
}
toAttract();
// build the plain shader (rail lights, particles) now; built mid-game, it stutters on the first train or death
const warm = new THREE.Mesh(partGeo, splashMat);
scene.add(warm);
renderer.compile(scene, camera);
scene.remove(warm);
requestAnimationFrame(frame);
})();
