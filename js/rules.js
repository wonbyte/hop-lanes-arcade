// Pure game rules: no DOM, no Three.js. Node runs tests/rules.test.mjs against this file in milliseconds.
// ---------- random ----------
// The world is built from a seeded generator, so a seed always gives the same lanes.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a over a string (the daily seed comes from the date)
function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const difficultyAt = (r, rows) => Math.min(1, Math.max(0, r) / rows);

// ---------- tuning: everything that decides a run (core.js re-exports these for the browser modules) ----------
const PLAY_HALF = 4;          // playable columns: -4..4
const EDGE_DEATH = 5.4;       // carried this far on a log = swept away
const WRAP = 15;              // traffic wraps at +-WRAP
const HOP_TIME = 0.12;
const HIT_PAD = 0.28;         // extra hit width around cars and trains
const TRAIN_SPEED = 26;
const TRAIN_WARN = 1.3;       // seconds the signal flashes before a train
const FIRST_ROW = -8;         // rows behind the start line that are built for scenery
const BEHIND_LIMIT = 4.5;     // fall this far behind the scroll line and you are out
const COUNTDOWN = 3;
const EAGLE_IDLE = 6;         // seconds without a hop before the eagle comes for you
const EAGLE_SWOOP = 0.9;      // seconds the eagle takes to reach the player
const EAGLE_WARN = 1.5;       // seconds before the swoop a warning sounds
const COIN_CHANCE = { grass: 0.28, road: 0.18, lily: 0.4, mud: 0.3 };   // chance of a coin on a lane
const STEP = 1 / 120;         // the game steps at a fixed rate, so a replay plays back the same run
const POWER_CHANCE = 0.05;    // chance of a power-up (shield or magnet) on a lane past row 10
const COMBO_GAP = 0.45;       // seconds between hops that keep a combo alive
const COMBO_EVERY = 5;        // hops of combo per bonus coin
const SHIELD_TIME = 1.2;      // seconds a rescued player can not be hit
const MAGNET_TIME = 8;        // seconds the magnet pulls coins
const MAGNET_REACH = 1.6;     // columns the magnet reaches
const DIFF_ROWS = 140;        // rows until the game reaches full difficulty
const difficulty = r => difficultyAt(r, DIFF_ROWS);

// ---------- lanes ----------
const LANE_KINDS = ['grass', 'road', 'river', 'lily', 'mud', 'rail'];
const STREAK_MAX = { road: 4, river: 3, lily: 2, mud: 2, rail: 3 };   // longest run of one kind
// the kind of row r, given the row before it ({ kind, streak }) and the world generator
function nextLaneKind(r, diff, prev, rng) {
  if (r < 4) return 'grass';
  // keep runs of the same type together, like real roads and rivers
  if (prev.kind !== 'grass' && prev.streak < STREAK_MAX[prev.kind] && rng() < 0.55) return prev.kind;
  const w = {
    grass: 0.32 - diff * 0.12, road: 0.36, river: 0.2 + diff * 0.06,
    lily: r > 8 ? 0.1 : 0, mud: r > 12 ? 0.07 : 0, rail: 0.12 + diff * 0.06
  };
  let x = rng() * (w.grass + w.road + w.river + w.lily + w.mud + w.rail);
  let k = 'rail';
  for (const key of ['grass', 'road', 'river', 'lily', 'mud']) { if ((x -= w[key]) < 0) { k = key; break; } }
  if (k === 'grass' && prev.kind === 'grass') k = rng() < 0.5 ? 'road' : 'river';   // two grass rows in a row are dull
  return k;
}

// ---------- hops ----------
// where a hop from column x by dx lands in `lane`, or null when the move is not allowed
function hopTarget(lane, x, dx, half) {
  if (!lane) return null;
  if (lane.kind === 'river') { const tx = x + dx; return Math.abs(tx) > half + 0.5 ? null : tx; }   // any column: logs decide
  const tx = Math.round(x + dx);
  if (lane.kind === 'grass' && lane.secret === tx) return tx;   // a hidden column past the edge
  if (Math.abs(tx) > half) return null;
  if (lane.kind === 'grass' && lane.trees.has(tx)) return null;
  return tx;
}
// mud is sticky: a hop that starts in mud takes longer
const MUD_SLOW = 2.2;
const hopTime = (fromKind, base) => fromKind === 'mud' ? base * MUD_SLOW : base;

// the game modes, shared by core.js (the DOM side), replay.js and the score server's own copy
const MODES = ['classic', 'race', 'daily', 'room'];
// a local calendar day as YYYY-MM-DD, built by hand (locale date formats are not stable across browsers)
const pad2 = n => String(n).padStart(2, '0');
const isoDay = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

export { BEHIND_LIMIT, COIN_CHANCE, COMBO_EVERY, COMBO_GAP, COUNTDOWN, DIFF_ROWS, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, FIRST_ROW, HIT_PAD, HOP_TIME,
  LANE_KINDS, MAGNET_REACH, MAGNET_TIME, MODES, MUD_SLOW, PLAY_HALF, POWER_CHANCE, SHIELD_TIME, STEP, STREAK_MAX, TRAIN_SPEED, TRAIN_WARN, WRAP,
  difficulty, difficultyAt, hashString, hopTarget, hopTime, isoDay, mulberry32, nextLaneKind };
