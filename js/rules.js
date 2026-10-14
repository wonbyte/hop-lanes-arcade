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

export { LANE_KINDS, MODES, isoDay, MUD_SLOW, STREAK_MAX, difficultyAt, hashString, hopTarget, hopTime, mulberry32, nextLaneKind };
