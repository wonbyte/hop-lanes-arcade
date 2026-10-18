import { COUNTDOWN, FIRST_ROW, MODES, PLAY_HALF, STEP, TRAIN_SPEED } from './rules.js';

// Shared constants, the game state object and the one "can not load" screen.
// ---------- tuning ----------
// what decides a run lives in rules.js (pure: sim.js and the score server use it too); the rest is here
const LANES_AHEAD = 22, LANES_BEHIND = 12;
const RESULTS_DELAY = 0.7;    // real seconds from the last death to the results panel (the slow motion does not stretch it)
const RETRY_AFTER = 0.5;      // real seconds the results show before a tap or key plays again (no accidental retry)
const SOLO_COUNTDOWN = 1;     // a quick retry of a one-player game counts down READY, GO! (rules.js COUNTDOWN: 3 s from the title)
const JOIN_COUNTDOWN = 2.5;   // a second player joining during the countdown gives both at least this long
const GO_TIME = 0.6;
const WIPE_MS = 130;          // restart fade; the new world is built while the screen is covered
const PRIZE_COST = 50;        // coins for one turn of the prize machine
const NIGHT_START = 90, NIGHT_FULL = 150;   // rows over which day turns into night
const TUTORIAL_SEED = 21216;  // the very first classic game (rules 4 worlds): at most 3 danger rows in a row to row 25 (docs/evidence.md; it was 197)
const BIOME_ROWS = 50;        // the look of the land changes every this many rows (world.js biomeAt; looks only)
const OVER_SLOW = 0.35, OVER_SLOW_T = 0.6;   // game over: the world runs this much slower for this long (real seconds)
const OVER_ZOOM = 1.22;       // and the view closes in on the fallen player
const BEST_MIN = 10;          // a best below this gets no ribbon on the results and none on the ground (a first run of 2 rows is no party)
const LAND_DIP = 0.14;        // seconds of the small view dip after a landing (players.js sets G.landT, app.js draws it)
// the paint jobs' keys (models.js PAINTS has their names, prices and colors in this order): storage.js wears only these
const PAINT_KEYS = ['classic', 'gold', 'sky', 'pink', 'mint', 'lava', 'night'];
// looks a player can unlock with the all-time best (screens.js): the land starts as that biome, or at night
const LOOKS = [{ key: 'auto', at: 0 }, { key: 'desert', at: 40 }, { key: 'night', at: 70 }, { key: 'tundra', at: 100 }, { key: 'swamp', at: 150 }];
const TAU = Math.PI * 2;
const $ = id => document.getElementById(id);

// ---------- game state (one object, so every module sees the same values) ----------
const G = {
  state: 'attract', stateT: 0, camRow: 0, playT: 0, countdown: 0, goT: 0,
  camLead: 4.2,        // camera looks this many rows past the scroll line (less on wide screens)
  visRows: 14,         // lanes further than this from the camera focus are not drawn
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
  record: [],          // this run's hops as the rules applied them: [playTick, player, dx, dr] (the replay code)
  moves: 0,            // moves taken from the queue this run, applied or refused (a test hook: tests/browser.mjs hopKey)
  replay: null,        // a decoded replay being played back, or null
  run: null,           // this run's stats (missions)
  handicap: 0,         // 0 = off, 1 / 2 = that player starts with a shield
  room: '',            // room code (room mode: a shared world for two phones)
  weather: '',         // '', 'rain' or 'snow' at the camera
  shakeT: 0,           // seconds left of the small view nudge (a near miss)
  hint: false,         // first run: the floating hints follow the first player (app.js placeHint) until row 20
  hintTurn: false,     // first run: the player has hopped sideways once (the SWIPE TO TURN hint is done)
  landT: 0,            // seconds left of the small view dip after a landing
  slowT: 0,            // real seconds left of the game-over slow motion
  overX: 0,            // game over: how far the view has moved toward the fallen player
  overT: 0,            // seconds since game over (the view settles, then stops moving)
  lastDead: null,      // the player whose death ended the game (the view closes in on it)
  twoUp: false,        // both players are in the game (screens.js join; world.js draws a bomb-row magnet as a bomb then)
  look: 'auto',        // an unlocked look (LOOKS): which biome the land starts as, or 'night'
  biomeBlock: 0,       // the BIOME_ROWS block the camera is in (a new one shows its name)
  runHandicap: 0,      // the handicap of this run, fixed at the first join (screens.js join; spawn and the replay code use it)
  worldDay: '',        // the day the daily world's seed was made for ('' for any other world; screens.js buildWorld)
  overTick: -1,        // G.tick of the step the run ended in (players.js finishes that step's rules, as sim.js does)
  overRT: 0,           // real seconds since game over (app.js: the results come after RESULTS_DELAY of it)
  resultsT: -1,        // real seconds the results panel has shown (-1: not yet); a retry needs RETRY_AFTER of it
  quickStart: false,   // the next join is a retry of a one-player game: a short countdown (screens.js restart)
  countFrom: 0         // the length the countdown started with (a short one says READY, not a number)
};

// ---------- test hooks and seeds ----------
// #debug exposes window.hopLanes; #seed-42 or #debug-seed-42 builds the same world every game
// #shadow-basic (alone or after #debug / a seed): the old one-sample shadow map, an A/B switch for a phone that draws
// shadows wrong (gfx.js)
const SHADOW_BASIC = /-?shadow-basic$/.test(location.hash);
const hashText = location.hash.replace(/-?shadow-basic$/, '');
const hashMatch = /^#(debug)?(?:-?seed-(\d+))?$/.exec(hashText) || [];   // eslint-disable-line security/detect-unsafe-regex -- anchored, one optional group
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

// a JSON request that gives up after ms (the score server: a post, the top lists); throws on a bad status
async function fetchJson(url, ms, init = {}) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// show one clear message and hide the controls that would do nothing
function fail(why) {
  // the title menu too: the message sat on top of its buttons and neither could be read
  for (const id of ['cards', 'deck', 'logo', 'menu']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  const b = document.getElementById('banner');
  b.hidden = false;
  b.classList.add('fail');
  b.querySelector('h2').textContent = 'CAN NOT LOAD';
  b.querySelector('p').textContent = why;
}

export { $, BENCH, BEST_MIN, BIOME_ROWS, JOIN_COUNTDOWN, LAND_DIP, LOOKS, PAINT_KEYS, OVER_SLOW, OVER_SLOW_T, OVER_ZOOM, TUTORIAL_SEED, COUNTDOWN, DEBUG, FIRST_ROW, FIXED_SEED, SHADOW_BASIC, G, GO_TIME, LANES_AHEAD, LANES_BEHIND, MODES, REPLAY_CODE, NIGHT_FULL, NIGHT_START, PLAY_HALF, PRIZE_COST, RESULTS_DELAY, RETRY_AFTER, SCORES_TOKEN, SOLO_COUNTDOWN, SCORES_URL, STEP, TAU, TRAIN_SPEED, WIPE_MS, fail, fetchJson };
