import { difficultyAt } from './rules.js';

// Shared constants, the game state object and the one "can not load" screen.
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
const BEHIND_LIMIT = 4.5;     // fall this far behind the scroll line and you are out
const COUNTDOWN = 3;
const RESULTS_DELAY = 1.1;    // seconds from last death to the results panel (and restart)
const GO_TIME = 0.6;
const WIPE_MS = 130;          // restart fade; the new world is built while the screen is covered
const EAGLE_IDLE = 6;         // seconds without a hop before the eagle comes for you
const EAGLE_SWOOP = 0.9;      // seconds the eagle takes to reach the player
const EAGLE_WARN = 1.5;       // seconds before the swoop a warning sounds
const COIN_CHANCE = { grass: 0.28, road: 0.18, lily: 0.4, mud: 0.3 };   // chance of a coin on a lane
const PRIZE_COST = 50;        // coins for one turn of the prize machine
const NIGHT_START = 90, NIGHT_FULL = 150;   // rows over which day turns into night
const MODES = ['classic', 'race', 'daily'];
const DIFF_ROWS = 140;        // rows until the game reaches full difficulty
const difficulty = r => difficultyAt(r, DIFF_ROWS);
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
  bestAll: 0           // all-time best score (set by storage.js)
};

// ---------- test hooks and seeds ----------
// #debug exposes window.hopLanes; #seed-42 or #debug-seed-42 builds the same world every game
const hashMatch = /^#(debug)?(?:-?seed-(\d+))?$/.exec(location.hash) || [];
const DEBUG = hashMatch[1] === 'debug';
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

export { $, BEHIND_LIMIT, COIN_CHANCE, COUNTDOWN, DEBUG, DIFF_ROWS, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, FIRST_ROW, FIXED_SEED, G, GO_TIME, HIT_PAD, HOP_TIME, LANES_AHEAD, LANES_BEHIND, MODES, NIGHT_FULL, NIGHT_START, PLAY_HALF, PRIZE_COST, RESULTS_DELAY, SCORES_TOKEN, SCORES_URL, TAU, TRAIN_SPEED, TRAIN_WARN, WIPE_MS, WRAP, difficulty, fail, hashMatch };
