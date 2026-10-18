import { sfx, stopPlayLoop } from './audio.js';
import { $, BEST_MIN, FIXED_SEED, G, SCORES_TOKEN, SCORES_URL, fetchJson } from './core.js';
import { t } from './i18n.js';
import { encodeReplay } from './replay.js';
import { DAY_PREFIX, dayBefore, hatFor, streakAfter } from './rules.js';
import { runOver, topScore, winnerOf } from './sim.js';
import { keepAwake } from './device.js';
import { reduceMotion, touchQuery } from './gfx.js';
import { charOf, onGameOver, players } from './players.js';
import { BEST_KEY, DAILY_KEY, INITIALS_KEY, LOCAL_KEY, STREAK_KEY, TIPS_KEY, cleanInitials, deviceTag, entersLocal, flushBank, load, loadText, localTop, parseLocal, refreshBests, save } from './storage.js';
import { getSeed } from './world.js';
import { saveGhost } from './ghost.js';
import { missionProgress, payDaily, payMissions } from './missions-ui.js';
import { askCode, resultsEl, runDay, setAppState, setBanner } from './screens.js';

// The end of a run: the records, the results panel (the cause, a tip, the stats, the notes), the share text and the
// replay link, confetti, the local top 10 (and its initials question), the online post. players.js calls checkOver
// when the rules end the game (onGameOver); app.js reveals the panel after RESULTS_DELAY (revealResults).
// the best 10 runs on this device (panels.js lists them): the first run that makes it asks for the player's initials
// (never inside a game step: the question opens with the results panel, so the death plays out first)
let askedInitials = false;
const waitingLocal = [];   // entries that wait for the initials
function saveLocal(entry, initials) {
  const list = parseLocal(loadText(LOCAL_KEY));
  if (entersLocal(list, entry.score)) save(LOCAL_KEY, JSON.stringify(localTop(list, { ...entry, name: initials + ' ' + entry.name })));
}
function enterLocal(name, score) {
  if (!entersLocal(parseLocal(loadText(LOCAL_KEY)), score)) return;
  const entry = { name, score, day: runDay(), mode: G.mode }, initials = cleanInitials(loadText(INITIALS_KEY));
  if (initials) saveLocal(entry, initials); else waitingLocal.push(entry);
}
const saveWaiting = initials => { for (const e of waitingLocal.splice(0)) saveLocal(e, initials || deviceTag.slice(0, 3)); };
// when the results show: ask for the initials once a session (a closed question is not saved, so it comes again
// another day; the device tag stands in), then save every entry that waited for them
function askInitials() {
  if (!waitingLocal.length) return;
  const initials = cleanInitials(loadText(INITIALS_KEY));
  if (initials || askedInitials) { saveWaiting(initials); return; }
  askedInitials = true;
  askCode(t('YOUR INITIALS'), 3, deviceTag.slice(0, 3), code => {
    const ini = cleanInitials(code);
    if (ini) save(INITIALS_KEY, ini);
    saveWaiting(ini);
  });
}

// ---------- share, replay link and confetti ----------
let shareText = '', replayText = '';
// Share sheet where it works, clipboard where it does not, and as a last resort the text itself, selected.
// Both the share call and the clipboard write must happen in the tap itself (Safari refuses them a moment later),
// so the clipboard write starts at once and its result is used only if the share sheet is refused.
function shareOut(b, text, sheet) {
  let copied;
  try { copied = navigator.clipboard.writeText(text).then(() => true, () => false); }
  catch (e) { copied = Promise.resolve(false); }
  const n = overN;   // a restart during the wait: the label belongs to the old results, so leave the new button alone
  const finish = async shared => {
    if (shared) { if (n === overN) b.textContent = t('SHARED!'); return; }
    if (await copied) { if (n === overN) b.textContent = t(sheet ? 'COPIED!' : 'REPLAY LINK COPIED!'); return; }
    if (n !== overN) return;
    const box = /** @type {HTMLTextAreaElement} */ ($('shareText'));                     // nothing automatic works here: let the player copy by hand
    box.value = text; box.hidden = false; box.focus(); box.select();
    b.textContent = t('SELECT AND COPY');
  };
  if (sheet && navigator.share) navigator.share({ text }).then(() => finish(true), e => { if (!e || e.name !== 'AbortError') finish(false); });
  else finish(false);
}
const shareScore = () => shareOut($('share'), shareText, true);
$('share').addEventListener('click', shareScore);
$('replayBtn').addEventListener('click', () => shareOut($('replayBtn'), replayText, false));
const confettiBox = $('confetti');
let confettiTimer = 0;
function confetti() {
  if (reduceMotion) return;
  const colors = ['#ffd84a', '#4fb8ff', '#ff6f5a', '#4cbf3f', '#f7b9c4', '#ffffff'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('i');
    el.className = 'confetti';
    el.style.left = Math.random() * 100 + '%';
    el.style.background = colors[i % colors.length];
    el.style.animationDelay = Math.random() * 0.6 + 's';
    el.style.animationDuration = 1.8 + Math.random() * 1.2 + 's';
    confettiBox.appendChild(el);
  }
  clearTimeout(confettiTimer);   // a quick second game keeps its own confetti
  confettiTimer = setTimeout(() => { confettiBox.textContent = ''; }, 6000);
}

// this run as a replay code: the seed, the mode, the animals, the handicap, the start tick and every hop
const runCode = () => encodeReplay({ version: G.rules, seed: getSeed(), mode: G.mode, chars: players.map(q => charOf(q).key), joined: players.map(q => q.joined), handicap: G.runHandicap, startTick: G.startTick, events: G.record });
let overN = 0;   // which game over this is: a server answer that comes late must not label the next game's results
// the records this run set: the all-time best, today's best, the daily challenge best, the streak. best: the line for
// the ribbon ('NEW ALL TIME BEST!', 'NEW BEST TODAY!', 'NEW DAILY CHALLENGE BEST!' or ''); note: the rest, for the note
function saveRecords(top) {
  let best = '', note = '';
  if (top > G.bestAll) { G.bestAll = top; save(BEST_KEY, top); best = 'NEW ALL TIME BEST!'; }
  const day = runDay(), dayBest = DAY_PREFIX + day;   // a daily run counts for the day of its world
  if (G.mode === 'daily') save(STREAK_KEY, streakAfter(loadText(STREAK_KEY), day, dayBefore(new Date(day + 'T12:00:00'))));
  if (top > load(dayBest)) { save(dayBest, top); best = best || 'NEW BEST TODAY!'; }
  if (G.mode === 'daily') {
    const k = DAILY_KEY + DAY_PREFIX + day;
    if (top > load(k)) { save(k, top); if (best !== 'NEW ALL TIME BEST!') best = 'NEW DAILY CHALLENGE BEST!'; }   // an all-time best keeps its confetti
    else note = t('DAILY CHALLENGE BEST {n}.', { n: load(k) });
  }
  refreshBests();
  return { best, note };
}
// the share text and the replay link for this run (the link only where a page can carry a hash)
function shareTexts(hero, top, replay) {
  const page = location.origin + location.pathname;
  shareText = t('I scored {n} in Hop Lanes as {name}!', { n: top, name: t(charOf(hero).name) }) + (G.mode === 'room' ? ' ' + t('Room {code}', { code: G.room }) + '.' : '') + ' ' + page;
  const code = !replay && G.record.length ? runCode() : '';
  const canReplay = !!code && location.protocol !== 'file:';
  replayText = canReplay ? page + '#replay-' + code : '';
  $('replayBtn').hidden = !canReplay;
  return code;
}
// the run has ended: play stops (the results come after RESULTS_DELAY of real time, app.js revealResults)
function endPlay() {
  G.state = 'over'; G.stateT = 0; overN++;
  G.overRT = 0; G.resultsT = -1;
  G.overTick = G.tick;   // players.js: the rest of this step still runs the rules, as sim.js does
  flushBank();
  stopPlayLoop();
  G.hint = false;
  setAppState(false, true, false);
  keepAwake(false);
  setBanner('');
}
// app.js, once the death has played out: the panel slides up and PLAY AGAIN takes the focus; a first local top-10
// entry asks for the initials now
function revealResults() {
  resultsEl.hidden = false; G.resultsT = 0;
  setAppState(false, true, true);
  try { $('again').focus({ preventScroll: true }); } catch (e) {}
  if (party) { party = false; confetti(); }
  askInitials();
}
let party = false;   // a new all-time best: confetti when the results show
// a new best gets its own ribbon, a jingle and (all time) confetti; a best under BEST_MIN gets none of it
function showBest(best, top) {
  const show = !!best && top >= BEST_MIN;
  $('resBest').hidden = !show;
  if (!show) { sfx.over(); return; }
  $('resBest').textContent = t(best);
  if (best === 'NEW ALL TIME BEST!') { party = true; sfx.best(); } else sfx.cheer();
}
const resultTitle = (replay, both, winner) => replay ? t('REPLAY OVER') : !both ? t('GAME OVER') : !winner ? t('TIE GAME!') : t('{name} WINS!', { name: t(charOf(winner).name) });
// the player who set the posted score (sim.js topScore: the higher score, also when the other one won a coin war or a
// race): the online name, the share text, the local top 10 and the ghost credit that animal with those rows
function scorerOf(players, top, winner) {
  if (winner && winner.score === top) return winner;
  return players.find(p => p.joined && p.score === top) || players[0];
}
// the results texts that depend on the mode: the coin count of a coin war, the gap of a race
function modeNote(note, both, winner) {
  const [p1, p2] = players;
  if (both && G.mode === 'coinwar') note = t('COINS {a} - {b}.', { a: p1.coins, b: p2.coins }) + ' ' + note;
  if (G.mode === 'race' && winner) note = t('BY {n} ROWS.', { n: Math.abs(p1.score - p2.score) }) + ' ' + note;
  return note;
}
// what ended each run, in plain words, and a tip for the first few deaths of each kind
const CAUSE_TEXT = { squash: 'HIT BY A CAR', splash: 'FELL IN THE WATER', train: 'HIT BY A TRAIN', eagle: 'TAKEN BY THE EAGLE', fall: 'FELL THROUGH A TILE', twister: 'CAUGHT BY THE TWISTER', swept: 'SWEPT AWAY', slow: 'LEFT BEHIND' };
const CAUSE_TIP = { squash: 'WAIT FOR A GAP', splash: 'HOP ONLY ONTO LOGS AND PADS', train: 'WATCH THE RED LIGHT', eagle: 'THE EAGLE COMES IF YOU STAND STILL', fall: 'CRACKED TILES NEVER COME BACK', twister: 'THE TWISTER CROSSES LIKE A CAR', swept: 'HOP OFF BEFORE THE RAPIDS', slow: 'KEEP UP: THE VIEW MOVES ON' };
const TIP_TIMES = 3;
function causeLine(both) {
  return players.filter(p => p.joined && CAUSE_TEXT[p.cause])
    .map(p => (both ? t('P' + (p.id + 1)) + ': ' : '') + t(CAUSE_TEXT[p.cause]) + ' · ' + t('ROW {n}', { n: p.row })).join('\n');
}
function tipLine(replay) {
  const p = players.find(q => q.joined && CAUSE_TIP[q.cause]);
  if (replay || !p) return '';
  let seen = {};
  try { seen = JSON.parse(loadText(TIPS_KEY) || '{}'); } catch (e) {}
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};   // a tampered value is no reason to crash a game step
  const n = Number(seen[p.cause]) || 0;
  if (n >= TIP_TIMES) return '';
  seen[p.cause] = n + 1;
  save(TIPS_KEY, JSON.stringify(seen));
  return t(CAUSE_TIP[p.cause]);
}
const setRetryHint = () => { $('resHint').textContent = t(touchQuery.matches ? 'TAP TO PLAY AGAIN' : 'SPACE TO PLAY AGAIN'); };
function showResults(note, info) {
  const [p1, p2] = players;
  $('res1').hidden = !p1.joined; $('res2').hidden = !p2.joined;
  $('res1').querySelector('span').textContent = t(charOf(p1).name);
  $('res2').querySelector('span').textContent = t(charOf(p2).name);
  $('res1').querySelector('b').textContent = p1.score;
  $('res2').querySelector('b').textContent = p2.score;
  $('resCause').textContent = info.cause;
  $('resTip').textContent = info.tip; $('resTip').hidden = !info.tip;
  $('resStats').textContent = info.stats;
  $('resNote').textContent = note;
  $('again').textContent = t(G.replay ? 'MENU' : 'PLAY AGAIN');
  $('toMenu').hidden = !!G.replay;
  setRetryHint();
}
// the stats line: the coins of this run and the missions' progress (before the payout moves them on)
function statsLine(replay) {
  if (replay || !G.run) return '';
  return (G.run.coins ? (G.run.coins === 1 ? t('+1 COIN') : t('+{n} COINS', { n: G.run.coins })) + ' · ' : '') + missionProgress();
}
function checkOver() {
  if (G.state !== 'play') return;
  if (!runOver(players, G.mode)) return;   // sim.js: a race ends at the first death, otherwise when nobody is left
  endPlay();
  const [p1, p2] = players;
  const both = p1.joined && p2.joined;
  const top = topScore(players);
  const replay = !!G.replay;   // a replay changes no records and pays nothing
  const hatBefore = hatFor(G.bestAll);
  const records = replay ? { best: '', note: '' } : saveRecords(top);   // a replay changes no records
  // who wins: in a race the one still standing (or the higher score), otherwise the higher score
  const winner = winnerOf(players, G.mode);   // sim.js: race, coin war or the higher score
  let note = modeNote(records.note, both, winner);
  $('resTitle').textContent = resultTitle(replay, both, winner);
  const scorer = scorerOf(players, top, winner);
  const code = shareTexts(scorer, top, replay);   // the replay code: the seed, the animals and every hop of this run
  saveGhost(code, top, scorer.id);   // daily and room worlds: the best run comes back as a ghost
  showBest(records.best, top);
  const info = { cause: causeLine(both), tip: tipLine(replay), stats: statsLine(replay) };
  if (!replay) note = payMissions() + payDaily(runDay()) + note;
  if (!replay) enterLocal(charOf(scorer).name, top);
  const hat = hatFor(G.bestAll);
  if (!replay && hat && hat !== hatBefore) note = t('NEW HAT: {name}!', { name: t(hat.name) }) + ' ' + note;
  $('world').hidden = true;
  if (!replay && canPost()) postScore(charOf(scorer).name + ' ' + deviceTag, top, code || runCode(), overN);   // the server keeps one entry per name
  showResults(note, info);
}

// a fixed world (#seed-N) or a handicap shield is not a fair run for the online list: it stays on this device
const canPost = () => FIXED_SEED === null && G.runHandicap === 0;
// optional online score list: silent when no server is set or it can not be reached
const FETCH_MS = 4000;   // a post or a list waits this long at most
async function postScore(name, score, code, gameN) {
  if (!SCORES_URL || !window.fetch) return;
  try {
    const daily = G.mode === 'daily', day = runDay();   // a daily run is posted with the day of its world
    let { top } = await fetchJson(SCORES_URL, FETCH_MS, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(SCORES_TOKEN ? { 'X-Hop-Token': SCORES_TOKEN } : {}) },
      // the run's replay code (the one in the replay link): a server with VERIFY=1 plays it again to check the score
      body: JSON.stringify({ name, score, day, mode: G.mode, replay: code })
    });
    // daily mode compares with everyone who played today's world
    if (daily) {
      const u = new URL(SCORES_URL, location.href);   // the server address may carry a query of its own
      u.searchParams.set('day', day); u.searchParams.set('mode', 'daily');
      top = (await fetchJson(u, FETCH_MS)).top;
    }
    if (Array.isArray(top) && top.length && G.state === 'over' && gameN === overN) {   // still the game that posted
      // nosemgrep: no-stringify-keys -- $ is getElementById here; nothing is stringified
      $('world').textContent = t(daily ? 'TODAY TOP {n} · {name}' : 'WORLD BEST {n} · {name}', { n: top[0].score, name: top[0].name });
      $('world').hidden = false;
    }
  } catch (e) { /* offline, blocked by the page policy, or no server: nothing to show */ }
}

// the language changed (screens.js refreshTexts): the results' own labels
document.addEventListener('hoplanes:lang', () => { if (G.state === 'over') { $('share').textContent = t('SHARE'); setRetryHint(); } });

onGameOver(checkOver);   // players.js calls it when the rules end the game

export { revealResults };
