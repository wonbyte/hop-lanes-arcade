import { $, G } from './core.js';

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
function dropOldDays() {
  try {
    const keep = dayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DAY_PREFIX) && k !== keep) localStorage.removeItem(k);
    }
  } catch (e) {}
}
const COINS_KEY = 'hoplanes.coins', OWNED_KEY = 'hoplanes.owned', PICK_KEY = 'hoplanes.pick';
const HOWTO_KEY = 'hoplanes.howto', MUTE_KEY = 'hoplanes.mute';
function loadText(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
G.bank = load(COINS_KEY);   // coins collected over all games
const owned = new Set(loadText(OWNED_KEY).split(',').filter(Boolean));
function setBank(n) { G.bank = Math.max(0, n); save(COINS_KEY, G.bank); $('bank').textContent = G.bank; }
G.bestAll = load(BEST_KEY);
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

export { BEST_KEY, COINS_KEY, DAY_PREFIX, HOWTO_KEY, MUTE_KEY, OWNED_KEY, PICK_KEY, bestDay, dayKey, dropOldDays, load, loadText, owned, refreshBests, save, setBank, shownDay };
