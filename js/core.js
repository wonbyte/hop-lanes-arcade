import { COUNTDOWN, FIRST_ROW, HOP_TIME, MODES, PLAY_HALF, STEP, TRAIN_SPEED, WRAP } from './rules.js';

// Shared constants, the game state object and the one "can not load" screen.
// ---------- tuning ----------
// what decides a run lives in rules.js (pure: sim.js and the score server use it too); the rest is here
const LANES_AHEAD = 22, LANES_BEHIND = 12;
const RESULTS_DELAY = 1.1;    // seconds from last death to the results panel (and restart)
const GO_TIME = 0.6;
const WIPE_MS = 130;          // restart fade; the new world is built while the screen is covered
const PRIZE_COST = 50;        // coins for one turn of the prize machine
const NIGHT_START = 90, NIGHT_FULL = 150;   // rows over which day turns into night
const TUTORIAL_SEED = 197;    // the very first classic game: three clear grass rows, a slow road, a rest, a river with long logs
const BIOME_ROWS = 100;       // the look of the land changes every this many rows (world.js biomeAt)
const OVER_SLOW = 0.35, OVER_SLOW_T = 0.6;   // game over: the world runs this much slower for this long (real seconds)
const OVER_ZOOM = 1.22;       // and the view closes in on the fallen player
const LAND_DIP = 0.14;        // seconds of the small view dip after a landing (players.js sets G.landT, app.js draws it)
// looks a player can unlock with the all-time best (screens.js): the land starts as that biome, or at night
const LOOKS = [{ key: 'auto', at: 0 }, { key: 'desert', at: 100 }, { key: 'night', at: 150 }, { key: 'tundra', at: 200 }, { key: 'swamp', at: 300 }];
const TAU = Math.PI * 2;
const $ = id => document.getElementById(id);

// ---------- game state (one object, so every module sees the same values) ----------
const G = {
  state: 'attract', stateT: 0, camRow: 0, playT: 0, countdown: 0, goT: 0,
  camLead: 4.2,        // camera looks this many rows past the scroll line (less on wide screens)
  visRows: 14,         // lanes further than this from the camera focus are not drawn
  frameN: 0,
  restarting: false,
  mode: 'classic',     // one of MODES (rules.js): classic, race, coinwar, tag, daily, room
  bank: 0,             // coins collected over all games (set by storage.js)
  bestAll: 0,          // all-time best score (set by storage.js)
  tick: 0,             // fixed steps since boot
  worldTick: 0,        // fixed steps since the world was built: traffic and trains run on this
  startTick: 0,        // worldTick when play began (saved in replays)
  rules: 0,            // the rules version of this run (rules.js RULES; a replay's own): set by startPlay
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
  hint: false,         // first run: the floating hints follow the first player (app.js placeHint) until row 12
  hintTurn: false,     // first run: the player has hopped sideways once (the SWIPE TO TURN hint is done)
  landT: 0,            // seconds left of the small view dip after a landing
  slowT: 0,            // real seconds left of the game-over slow motion
  overX: 0,            // game over: how far the view has moved toward the fallen player
  overT: 0,            // seconds since game over (the view settles, then stops moving)
  lastDead: null,      // the player whose death ended the game (the view closes in on it)
  twoUp: false,        // both players are in the game (screens.js join; world.js draws a bomb-row magnet as a bomb then)
  look: 'auto',        // an unlocked look (LOOKS): which biome the land starts as, or 'night'
  biomeBlock: 0        // the BIOME_ROWS block the camera is in (a new one shows its name)
};

// ---------- test hooks and seeds ----------
// #debug exposes window.hopLanes; #seed-42 or #debug-seed-42 builds the same world every game
const hashMatch = /^#(debug)?(?:-?seed-(\d+))?$/.exec(location.hash) || [];   // eslint-disable-line security/detect-unsafe-regex -- anchored, one optional group
// #debug-bench-replay-<code>: the device bench (docs/budgets.md): the replay plays again and again, and the frame times show
const replayMatch = /^#(debug-|debug-bench-)?replay-([\w-]+)$/.exec(location.hash) || [];
const BENCH = replayMatch[1] === 'debug-bench-';
const DEBUG = hashMatch[1] === 'debug' || !!replayMatch[1];
const REPLAY_CODE = replayMatch[2] || '';
const FIXED_SEED = hashMatch[2] !== undefined ? Number(hashMatch[2]) >>> 0 : null;
// optional online score list: <meta name="hop-lanes-scores" content="https://.../scores"> (see server/README.md)
const meta = name => /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="' + name + '"]'))?.content || '';
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

export { $, BENCH, BIOME_ROWS, LAND_DIP, LOOKS, OVER_SLOW, OVER_SLOW_T, OVER_ZOOM, TUTORIAL_SEED, COUNTDOWN, DEBUG, FIRST_ROW, FIXED_SEED, G, GO_TIME, HOP_TIME, LANES_AHEAD, LANES_BEHIND, MODES, REPLAY_CODE, NIGHT_FULL, NIGHT_START, PLAY_HALF, PRIZE_COST, RESULTS_DELAY, SCORES_TOKEN, SCORES_URL, STEP, TAU, TRAIN_SPEED, WIPE_MS, WRAP, fail };
