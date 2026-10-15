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
const COIN_CHANCE = { grass: 0.28, road: 0.18, lily: 0.4, mud: 0.3, ice: 0.25, bridge: 0.35, rocks: 0.2, spring: 0.3, portal: 0.3, cliff: 0.25 };   // chance of a coin on a lane
const STEP = 1 / 120;         // the game steps at a fixed rate, so a replay plays back the same run
const POWER_CHANCE = 0.05;    // chance of a power-up (shield or magnet) on a lane past row 10
const COMBO_GAP = 0.45;       // seconds between hops that keep a combo alive
const COMBO_EVERY = 5;        // hops of combo per bonus coin
const SHIELD_TIME = 1.2;      // seconds a rescued player can not be hit
const MAGNET_TIME = 8;        // seconds the magnet pulls coins
const MAGNET_REACH = 1.6;     // columns the magnet reaches
const DIFF_ROWS = 140;        // rows until the game reaches full difficulty
const NEAR_MISS = 0.5;        // a car or boulder that passes within this of a hit is a near miss (+1 combo)
const TAG_BOOST = 0.7;        // tag mode: the player behind hops this much faster
// two players (not race or tag): from LEAD_FROM on, a leader LEAD_GAP or more rows ahead hops LEAD_SLOW times slower
const LEAD_FROM = 30, LEAD_GAP = 5, LEAD_SLOW = 1.3;
// two players: a magnet on a bomb row is a bomb instead, blocking a column ahead of the other player for BOMB_TICKS steps
const BOMB_TICKS = 360;       // 3 s at STEP
const isBombRow = r => r > 20 && r % 4 === 0;
// a magnet on a bomb row is a versus bomb when two play (sim.js pickPower and world.js placeCoins use this one rule)
const isBombPower = (kind, r, twoPlayers) => kind === 'magnet' && twoPlayers && isBombRow(r);
// boss moments: the first grass row past each 100 rows carries a twister, the first river a flood (gen.js sets them)
const TWISTER_LEN = 0.9, FLOOD_SPEED = 1.5;
const difficulty = r => difficultyAt(r, DIFF_ROWS);

// ---------- lanes ----------
const LANE_KINDS = ['grass', 'road', 'river', 'lily', 'mud', 'rail', 'ice', 'bridge', 'rocks', 'spring', 'portal', 'cliff'];
const STREAK_MAX = { road: 4, river: 3, lily: 2, mud: 2, rail: 3, ice: 2, bridge: 1, rocks: 2, spring: 1, portal: 1, cliff: 2 };   // longest run of one kind
// the late kinds start at these rows (they draw nothing before, so rows below ICE_FROM are as they always were)
const ICE_FROM = 25, BRIDGE_FROM = 40, ROCKS_FROM = 55;
// the latest kinds weigh 0 below these rows: the saved runs reach row 86 and must stay the same worlds
const SPRING_FROM = 95, PORTAL_FROM = 110, CLIFF_FROM = 125;
// the kind of row r, given the row before it ({ kind, streak }) and the world generator
function nextLaneKind(r, diff, prev, rng) {
  if (r < 4) return 'grass';
  // keep runs of the same type together, like real roads and rivers
  if (prev.kind !== 'grass' && prev.streak < STREAK_MAX[prev.kind] && rng() < 0.55) return prev.kind;
  const w = {
    grass: 0.32 - diff * 0.12, road: 0.36, river: 0.2 + diff * 0.06,
    lily: r > 8 ? 0.1 : 0, mud: r > 12 ? 0.07 : 0, rail: 0.12 + diff * 0.06,
    ice: r >= ICE_FROM ? 0.05 + diff * 0.04 : 0, bridge: r >= BRIDGE_FROM ? 0.04 + diff * 0.04 : 0, rocks: r >= ROCKS_FROM ? 0.04 + diff * 0.06 : 0,
    spring: r >= SPRING_FROM ? 0.05 : 0, portal: r >= PORTAL_FROM ? 0.04 : 0, cliff: r >= CLIFF_FROM ? 0.04 + diff * 0.03 : 0
  };
  // the new kinds come last in the sum and the walk, so a world below SPRING_FROM lands on the same kind as before
  let x = rng() * (w.grass + w.road + w.river + w.lily + w.mud + w.rail + w.ice + w.bridge + w.rocks + w.spring + w.portal + w.cliff);
  let k = 'rail';
  for (const key of ['grass', 'road', 'river', 'lily', 'mud', 'ice', 'bridge', 'rocks', 'spring', 'portal', 'cliff']) { if ((x -= w[key]) < 0) { k = key; break; } }
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
  if (lane.trees && lane.trees.has(tx)) return null;   // grass and ice
  return tx;
}
// mud is sticky: a hop that starts in mud takes longer
const MUD_SLOW = 2.2;
// ice: a sideways hop that lands on ice slides one more column the same way (stopped by a tree or the edge)
const SLIDE_TIME = 0.12;
// bridges: a plank breaks this many steps after a player lands on it, and is back this many steps after that
const PLANK_BREAK = 72, PLANK_BACK = 360;   // 0.6 s and 3 s at STEP
// the plank of a bridge row at column x: 'up', 'cracking' (someone stood on it) or 'down' (water), at world tick wt
function plankState(lane, x, wt) {
  const pl = lane.planks.get(x);
  if (!pl) return 'down';
  return wt < pl.breakAt ? 'cracking' : wt < pl.backAt ? 'down' : 'up';
}
// a spring row: a forward hop that starts on one lands two rows on, in the air this much longer
const SPRING_HOP = 1.6;
// a cliff row: a ledge of stone tiles (lane.planks, like a bridge) that break for good; a fall is a death
// water rows: a hop that lands off a log, pad, plank or tile sinks or falls; a rescue never goes back to one
const isWater = kind => kind === 'river' || kind === 'lily' || kind === 'bridge' || kind === 'cliff';
const hopTime = (fromKind, base) => fromKind === 'mud' ? base * MUD_SLOW : base;

// the game modes, shared by core.js (the DOM side), replay.js and the score server
// race: the first to die loses. coinwar: most coins wins. tag: the player behind hops faster.
const MODES = ['classic', 'race', 'coinwar', 'tag', 'daily', 'room'];
// each animal has one small edge (a replay stores the animals, so a run stays the same run)
// text: what the join card says (an i18n key)
const TRAITS = {
  frog: { text: 'BALANCED' },
  fox: { comboGap: 1.5, text: 'LONG COMBOS' },        // combos stay alive longer (more coins; the run itself is the same)
  bunny: { hop: 0.8, text: 'FAST HOPS' },             // faster hops
  cat: { lives: 1, text: 'ONE EXTRA LIFE' },          // survives one fall into water
  robot: { idle: 3, text: 'PATIENT EAGLE' },          // the eagle waits 3 s longer
  pig: { magnet: 1.5, text: 'LONG MAGNET' },          // the magnet lasts longer
  penguin: { noSlide: true, text: 'NO ICE SLIDE' },   // at home on ice: no slide
  turtle: { behind: 1, text: 'MORE SLACK' }           // one more row of slack behind the scroll line
};
const traitOf = key => (Object.hasOwn(TRAITS, key) ? TRAITS[key] : {});   // hasOwn: a replay could name 'constructor'
// hats: unlocked by the all-time best score on this device (the first whose `at` is reached, from the top)
const HATS = [{ key: 'halo', name: 'HALO', at: 500 }, { key: 'crown', name: 'CROWN', at: 250 }, { key: 'cap', name: 'CAP', at: 100 }];
const hatFor = best => HATS.find(h => best >= h.at) || null;
// the daily streak: days in a row with a daily run, saved as "YYYY-MM-DD|n"; today's run returns the new text
function streakAfter(saved, day, yesterday) {
  const [last, n] = String(saved || '').split('|');
  const count = last === day ? Number(n) || 1 : last === yesterday ? (Number(n) || 0) + 1 : 1;
  return day + '|' + count;
}
const streakCount = (saved, day, yesterday) => { const [last, n] = String(saved || '').split('|'); return last === day || last === yesterday ? Number(n) || 0 : 0; };
// the ISO week of a YYYY-MM-DD day, as YYYY-Www (Monday first; week 1 holds the first Thursday); null if malformed
function isoWeek(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));   // the Thursday of this week decides the year
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + '-W' + String(week).padStart(2, '0');
}
// a local calendar day as YYYY-MM-DD, built by hand (locale date formats are not stable across browsers)
const pad2 = n => String(n).padStart(2, '0');
const isoDay = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dayBefore = (d = new Date()) => { const y = new Date(d); y.setDate(y.getDate() - 1); return isoDay(y); };

export { BOMB_TICKS, BRIDGE_FROM, CLIFF_FROM, FLOOD_SPEED, HATS, ICE_FROM, LEAD_FROM, LEAD_GAP, LEAD_SLOW, NEAR_MISS, PORTAL_FROM, SPRING_FROM, SPRING_HOP, TAG_BOOST, TWISTER_LEN, isBombPower, isBombRow, TRAITS, dayBefore, hatFor, isoWeek, streakAfter, streakCount, traitOf, PLANK_BACK, PLANK_BREAK, ROCKS_FROM, SLIDE_TIME, isWater, plankState,
  BEHIND_LIMIT, COIN_CHANCE, COMBO_EVERY, COMBO_GAP, COUNTDOWN, DIFF_ROWS, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, FIRST_ROW, HIT_PAD, HOP_TIME,
  LANE_KINDS, MAGNET_REACH, MAGNET_TIME, MODES, MUD_SLOW, PLAY_HALF, POWER_CHANCE, SHIELD_TIME, STEP, STREAK_MAX, TRAIN_SPEED, TRAIN_WARN, WRAP,
  difficulty, difficultyAt, hashString, hopTarget, hopTime, isoDay, mulberry32, nextLaneKind };
