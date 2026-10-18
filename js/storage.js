import { $, G, LOOKS, PAINT_KEYS } from './core.js';
import { DAY_PREFIX, MODES, dailySeedFor, dayBefore, isoDay, streakCount } from './rules.js';

// Saved data: best scores, coins, owned characters. Everything is best effort (private mode, blocked storage).
// ---------- storage (best effort) ----------
const BEST_KEY = 'hoplanes.best';
const today = isoDay;                            // local YYYY-MM-DD (what the score server expects as `day`)
const dayKey = () => DAY_PREFIX + today();
// stored scores are only ever whole, non-negative numbers; anything else reads as 0
function load(k) {
  try {
    const n = Math.floor(Number(localStorage.getItem(k)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) { return 0; }
}
function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
// yesterday's day best and daily-challenge best are not needed any more
function dropOldDays() {
  try {
    const keep = dayKey(), keepDaily = DAILY_KEY + keep;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && ((k.startsWith(DAY_PREFIX) && k !== keep) || (k.startsWith(DAILY_KEY) && k !== keepDaily))) localStorage.removeItem(k);
    }
  } catch (e) {}
}
const DAILY_KEY = 'hoplanes.dailychal.';
const COINS_KEY = 'hoplanes.coins', OWNED_KEY = 'hoplanes.owned', PICK_KEY = 'hoplanes.pick';
const HOWTO_KEY = 'hoplanes.howto', MUTE_KEY = 'hoplanes.mute', MODE_KEY = 'hoplanes.mode', INSTALL_KEY = 'hoplanes.install';
const MISSIONS_KEY = 'hoplanes.missions', HANDICAP_KEY = 'hoplanes.handicap', ROOM_KEY = 'hoplanes.room';
const MOTION_KEY = 'hoplanes.motion';   // '1': less motion, whatever the system setting says
const STREAK_KEY = 'hoplanes.streak';   // 'YYYY-MM-DD|n': the last daily run and the days in a row
const HINT_KEY = 'hoplanes.hint';       // '1' once the floating TAP hint has done its job
const DAILYDONE_KEY = 'hoplanes.dailydone';   // 'YYYY-MM-DD|bitmask': the daily missions paid today (missions.js)
const LOCAL_KEY = 'hoplanes.local';     // JSON list of { name, score, day, mode }: the best 10 runs on this device
const INITIALS_KEY = 'hoplanes.initials';   // the 3 letters in front of the animal's name on the local list
const MCOINS_KEY = 'hoplanes.mcoins';   // 'i:n,...': the coins each active coin mission has collected in earlier runs
const MDONE_KEY = 'hoplanes.mdone';     // 'YYYY-MM-DD|n': missions done today (the title's mission chip)
const TIPS_KEY = 'hoplanes.tips';       // JSON { cause: n }: how many results have shown the tip for that cause
const PAINTS_KEY = 'hoplanes.paints';   // 'frog:gold,fox:sky': the paint jobs bought (paint.js)
const PAINTED_KEY = 'hoplanes.painted'; // 'frog=gold,fox=classic': the paint each animal wears
const VISIT_KEY = 'hoplanes.visit';     // 'YYYY-MM-DD|n': the last day the come-back bonus was paid and the days in a row
// ---------- the local top 10 (pure: tests/replay.test.mjs) ----------
const LOCAL_MAX = 10, LOCAL_MAX_SCORE = 100000;   // a tampered list can not freeze the board with absurd scores
const cleanInitials = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
// the saved list, checked entry by entry, best first, at most 10
function parseLocal(text) {
  let list = [];
  try { list = JSON.parse(text || '[]'); } catch (e) {}
  if (!Array.isArray(list)) return [];
  return list.filter(e => e && typeof e.name === 'string' && Number.isInteger(e.score) && e.score > 0 && e.score <= LOCAL_MAX_SCORE)
    .map(e => ({ name: e.name.slice(0, 24), score: e.score, day: String(e.day || ''), mode: String(e.mode || '') }))
    .sort((a, b) => b.score - a.score).slice(0, LOCAL_MAX);
}
// a score makes the list when it is a real score and there is room, or it beats the last one
const entersLocal = (list, score) => score > 0 && (list.length < LOCAL_MAX || score > list[list.length - 1].score);
// the list with the entry in its place (after equal scores), still at most 10; the same list when it does not make it
function localTop(list, entry) {
  if (!entersLocal(list, entry.score)) return list;
  const out = list.slice();
  let at = out.findIndex(e => e.score < entry.score);
  if (at < 0) at = out.length;
  out.splice(at, 0, entry);
  return out.slice(0, LOCAL_MAX);
}
function loadText(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
G.bank = load(COINS_KEY);   // coins collected over all games
const owned = new Set(loadText(OWNED_KEY).split(',').filter(Boolean));
// ---------- paint jobs (models.js PAINTS): bought once per animal, one worn per animal ----------
const paints = new Set(loadText(PAINTS_KEY).split(',').filter(Boolean));   // 'animal:paint'
const painted = new Map();   // animal -> the paint it wears
for (const part of loadText(PAINTED_KEY).split(',')) { const [a, k] = part.split('='); if (a && k) painted.set(a, k); }
const hasPaint = (animal, paint) => paint === 'classic' || (PAINT_KEYS.includes(paint) && paints.has(animal + ':' + paint));
// the paint an animal wears: a bought one the game knows (core.js PAINT_KEYS), or classic
const paintOf = animal => { const k = painted.get(animal) || 'classic'; return hasPaint(animal, k) ? k : 'classic'; };
function wearPaint(animal, paint) {
  painted.set(animal, paint);
  save(PAINTED_KEY, [...painted].map(([a, k]) => a + '=' + k).join(','));
}
function addPaint(animal, paint) {
  paints.add(animal + ':' + paint);
  save(PAINTS_KEY, [...paints].join(','));
}
// later = true during play: the count shows at once but is written to storage at game over (flushBank),
// so a run of coins is not a run of synchronous storage writes
let bankDirty = false;
function setBank(n, later = false) {
  G.bank = Math.max(0, n);
  $('bank').textContent = String(G.bank);
  if (later) bankDirty = true; else { bankDirty = false; save(COINS_KEY, G.bank); }
}
function flushBank() { if (bankDirty) setBank(G.bank); }
// a closed or hidden tab keeps its coins
addEventListener('pagehide', flushBank);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushBank(); });
G.bestAll = load(BEST_KEY);
G.handicap = Math.min(2, load(HANDICAP_KEY));
const LOOK_KEY = 'hoplanes.look';   // an unlocked look (core.js LOOKS): 'auto', 'desert', 'night', 'tundra', 'swamp'
G.look = LOOKS.some(l => l.key === loadText(LOOK_KEY) && G.bestAll >= l.at) ? loadText(LOOK_KEY) : 'auto';
G.room = loadText(ROOM_KEY).replace(/[^A-Z0-9]/g, '').slice(0, 6);
// the saved mode; room mode needs a code, and a replay may have shown another mode
const savedMode = () => MODES.includes(loadText(MODE_KEY)) && (loadText(MODE_KEY) !== 'room' || G.room) ? loadText(MODE_KEY) : 'classic';
G.mode = savedMode();
// a short tag that tells this device's scores from everyone else's FROG on the online list
const TAG_KEY = 'hoplanes.tag';
let deviceTag = loadText(TAG_KEY).replace(/[^A-Z0-9]/g, '').slice(0, 4);
if (deviceTag.length !== 4) {
  deviceTag = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  try { localStorage.setItem(TAG_KEY, deviceTag); } catch (e) {}
}
// the daily challenge: one seed for everyone, made from today's date
const dailySeed = () => dailySeedFor(today());
let bestDay = 0, shownDay = '';
function refreshBests() {
  shownDay = dayKey();
  bestDay = load(shownDay);
  $('best').textContent = String(G.bestAll);
  $('daily').textContent = String(bestDay);
  const streak = streakCount(loadText(STREAK_KEY), today(), dayBefore());   // daily runs on days in a row
  $('streak').textContent = String(streak);
  $('streakBox').hidden = !streak;
}
dropOldDays();
setBank(G.bank);
// a game left open past midnight starts a new "today" (screens.js hears it: new daily missions, a new daily world)
let checkedDay = today();
function checkDay() {
  if (today() === checkedDay) return;
  checkedDay = today();
  dropOldDays(); refreshBests();
  document.dispatchEvent(new Event('hoplanes:day'));
}
setInterval(checkDay, 60000);

export { BEST_KEY, LOOK_KEY, DAILY_KEY, DAILYDONE_KEY, HANDICAP_KEY, HINT_KEY, HOWTO_KEY, INITIALS_KEY, LOCAL_KEY, MCOINS_KEY, MDONE_KEY, STREAK_KEY, TIPS_KEY, VISIT_KEY, INSTALL_KEY, MISSIONS_KEY, MOTION_KEY, ROOM_KEY, MODE_KEY, MUTE_KEY, OWNED_KEY, PICK_KEY, addPaint, cleanInitials, dailySeed, deviceTag, entersLocal, flushBank, hasPaint, load, loadText, localTop, owned, paintOf, parseLocal, refreshBests, save, savedMode, setBank, today, wearPaint };
