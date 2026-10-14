import { BEHIND_LIMIT, COIN_CHANCE, COMBO_EVERY, COMBO_GAP, COUNTDOWN, DIFF_ROWS, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, FIRST_ROW, HIT_PAD, HOP_TIME, MAGNET_REACH, MAGNET_TIME, MODES, PLAY_HALF, POWER_CHANCE, SHIELD_TIME, STEP, TRAIN_SPEED, TRAIN_WARN, WRAP, difficulty } from './rules.js';

// Shared constants, the game state object and the one "can not load" screen.
// ---------- tuning ----------
// what decides a run lives in rules.js (pure: sim.js and the score server use it too); the rest is here
const LANES_AHEAD = 22, LANES_BEHIND = 12;
const RESULTS_DELAY = 1.1;    // seconds from last death to the results panel (and restart)
const GO_TIME = 0.6;
const WIPE_MS = 130;          // restart fade; the new world is built while the screen is covered
const PRIZE_COST = 50;        // coins for one turn of the prize machine
const NIGHT_START = 90, NIGHT_FULL = 150;   // rows over which day turns into night
const TAU = Math.PI * 2;
const $ = id => document.getElementById(id);

// ---------- game state (one object, so every module sees the same values) ----------
const G = {
  state: 'attract', stateT: 0, camRow: 0, playT: 0, countdown: 0, goT: 0,
  camLead: 4.2,        // camera looks this many rows past the scroll line (less on wide screens)
  visRows: 14,         // lanes further than this from the camera focus are not drawn
  frameN: 0,
  restarting: false,
  mode: 'classic',     // classic | race (first to die loses) | daily (one shared seed per day)
  bank: 0,             // coins collected over all games (set by storage.js)
  bestAll: 0,          // all-time best score (set by storage.js)
  tick: 0,             // fixed steps since boot
  worldTick: 0,        // fixed steps since the world was built: traffic and trains run on this
  startTick: 0,        // worldTick when play began (saved in replays)
  boom: false,         // #debug: hopLanes.boom() makes the next step throw (the crash notice test)
  countKey: '',        // the countdown banner that is showing (cleared to redraw it, e.g. after a pause)
  redraw: false,       // paused: draw one frame (the pause banner, a resize)
  playTick: 0,         // fixed steps since play began (replay time base)
  record: [],          // this run's hops: [playTick, player, dx, dr]
  replay: null,        // a decoded replay being played back, or null
  run: null,           // this run's stats (missions)
  handicap: 0,         // 0 = off, 1 / 2 = that player starts with a shield
  room: '',            // room code (room mode: a shared world for two phones)
  weather: '',         // '', 'rain' or 'snow' at the camera
  shakeT: 0,           // seconds left of the small view nudge (a near miss)
  hint: false          // first run: the floating TAP hint follows the first player until row 5
};

// ---------- test hooks and seeds ----------
// #debug exposes window.hopLanes; #seed-42 or #debug-seed-42 builds the same world every game
const hashMatch = /^#(debug)?(?:-?seed-(\d+))?$/.exec(location.hash) || [];
const replayMatch = /^#(debug-)?replay-([\w-]+)$/.exec(location.hash) || [];
const DEBUG = hashMatch[1] === 'debug' || replayMatch[1] === 'debug-';
const REPLAY_CODE = replayMatch[2] || '';
const FIXED_SEED = hashMatch[2] !== undefined ? Number(hashMatch[2]) >>> 0 : null;
// optional online score list: <meta name="hop-lanes-scores" content="https://.../scores"> (see server/README.md)
const meta = name => (document.querySelector('meta[name="' + name + '"]') || {}).content || '';
const SCORES_URL = meta('hop-lanes-scores');
const SCORES_TOKEN = meta('hop-lanes-token');   // sent as X-Hop-Token when the server asks for one

// show one clear message and hide the controls that would do nothing
function fail(why) {
  for (const id of ['cards', 'deck', 'logo']) document.getElementById(id).hidden = true;
  const b = document.getElementById('banner');
  b.hidden = false;
  b.querySelector('h2').textContent = 'CAN NOT LOAD';
  b.querySelector('p').textContent = why;
}

export { $, BEHIND_LIMIT, COIN_CHANCE, COMBO_EVERY, COMBO_GAP, COUNTDOWN, DEBUG, DIFF_ROWS, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, FIRST_ROW, FIXED_SEED, G, GO_TIME, HIT_PAD, HOP_TIME, LANES_AHEAD, LANES_BEHIND, MAGNET_REACH, MAGNET_TIME, MODES, POWER_CHANCE, REPLAY_CODE, NIGHT_FULL, NIGHT_START, PLAY_HALF, PRIZE_COST, RESULTS_DELAY, SCORES_TOKEN, SCORES_URL, SHIELD_TIME, STEP, TAU, TRAIN_SPEED, TRAIN_WARN, WIPE_MS, WRAP, difficulty, fail };
