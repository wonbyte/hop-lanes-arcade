import { $, G, MODES } from './core.js';
import { hashString } from './rules.js';

// Saved data: best scores, coins, owned characters. Everything is best effort (private mode, blocked storage).
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
function loadText(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
G.bank = load(COINS_KEY);   // coins collected over all games
const owned = new Set(loadText(OWNED_KEY).split(',').filter(Boolean));
// later = true during play: the count shows at once but is written to storage at game over (flushBank),
// so a run of coins is not a run of synchronous storage writes
let bankDirty = false;
function setBank(n, later = false) {
  G.bank = Math.max(0, n);
  $('bank').textContent = G.bank;
  if (later) bankDirty = true; else { bankDirty = false; save(COINS_KEY, G.bank); }
}
function flushBank() { if (bankDirty) setBank(G.bank); }
// a closed or hidden tab keeps its coins
addEventListener('pagehide', flushBank);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushBank(); });
G.bestAll = load(BEST_KEY);
G.mode = MODES.includes(loadText(MODE_KEY)) ? loadText(MODE_KEY) : 'classic';
G.handicap = Math.min(2, load(HANDICAP_KEY));
G.room = loadText(ROOM_KEY).replace(/[^A-Z0-9]/g, '').slice(0, 6);
if (G.mode === 'room' && !G.room) G.mode = 'classic';
// the daily challenge: one seed for everyone, made from today's date
const dailySeed = () => hashString(dayKey());
let bestDay = 0, shownDay = '';
function refreshBests() {
  shownDay = dayKey();
  bestDay = load(shownDay);
  $('best').textContent = G.bestAll;
  $('daily').textContent = bestDay;
}
dropOldDays();
setBank(G.bank);
// a game left open past midnight starts a new "today"
setInterval(() => { if (dayKey() !== shownDay) { dropOldDays(); refreshBests(); } }, 60000);

export { BEST_KEY, COINS_KEY, DAILY_KEY, DAY_PREFIX, HANDICAP_KEY, HOWTO_KEY, INSTALL_KEY, MISSIONS_KEY, ROOM_KEY, MODE_KEY, MUTE_KEY, OWNED_KEY, PICK_KEY, bestDay, dailySeed, dayKey, dropOldDays, flushBank, load, loadText, owned, refreshBests, save, setBank, shownDay };
