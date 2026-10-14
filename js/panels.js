import { audio, isMuted, setMuted, sfx } from './audio.js';
import { $, G, SCORES_URL } from './core.js';
import { buzzIsOn, setBuzz } from './device.js';
import { t } from './i18n.js';
import { players } from './players.js';
import { restart, resumeGame } from './screens.js';
import { MOTION_KEY, loadText, save, today } from './storage.js';

// Small panels over the field: settings, the pause menu, the online top 10, and the screen-reader announcer.
// ---------- dialogs (one open at a time; Escape and the close button close it) ----------
let openBox = null;
function openDialog(id) {
  closeDialog();
  openBox = $(id); openBox.hidden = false;
  const first = openBox.querySelector('button');
  if (first) try { first.focus({ preventScroll: true }); } catch (e) {}
}
function closeDialog() {
  if (!openBox) return false;
  openBox.hidden = true; openBox = null;
  return true;
}
const dialogOpen = () => !!openBox && !openBox.hidden;

// ---------- settings: sound, vibration, language, handicap, motion ----------
const motionLess = () => loadText(MOTION_KEY) === '1';
function labelSettings() {
  $('sound').textContent = t(isMuted() ? 'SOUND: OFF' : 'SOUND: ON');
  $('buzz').textContent = t(buzzIsOn() ? 'VIBRATION: ON' : 'VIBRATION: OFF');
  $('motion').textContent = t(motionLess() ? 'MOTION: LESS' : 'MOTION: AUTO');
  $('settingsBox').querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('settings').textContent = t('SETTINGS');
  $('motionNote').textContent = t('MOTION CHANGES AFTER A RELOAD');
}
$('settings').addEventListener('click', () => { audio(); sfx.tick(); labelSettings(); openDialog('settingsBox'); });
$('closeSettings').addEventListener('click', () => { sfx.tick(); closeDialog(); });
$('sound').addEventListener('click', () => { audio(); setMuted(!isMuted()); labelSettings(); });
$('buzz').addEventListener('click', () => { sfx.tick(); setBuzz(!buzzIsOn()); labelSettings(); });
$('motion').addEventListener('click', () => { sfx.tick(); save(MOTION_KEY, motionLess() ? 0 : 1); labelSettings(); });
$('lang').addEventListener('click', labelSettings);   // after screens.js has switched the language
document.addEventListener('hoplanes:lang', labelSettings);

// ---------- pause menu ----------
document.addEventListener('hoplanes:pause', () => { labelPause(); openDialog('pauseBox'); });   // screens.js pauseGame() shows the box
function labelPause() {
  $('pauseBox').querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('pauseMute').textContent = t(isMuted() ? 'SOUND: OFF' : 'SOUND: ON');
}
$('resumeBtn').addEventListener('click', () => { audio(); resumeGame(); });
$('restartBtn').addEventListener('click', () => { audio(); sfx.tick(); closeDialog(); restart(); });
$('pauseMute').addEventListener('click', () => { audio(); setMuted(!isMuted()); labelPause(); });

// ---------- online top 10 (only when a score server is set) ----------
const boardBtn = $('board');
boardBtn.hidden = !SCORES_URL;
async function openBoard() {
  audio(); sfx.tick();
  const daily = G.mode === 'daily';
  $('boardBox').querySelector('h2').textContent = t(daily ? 'TODAY TOP 10' : 'TOP 10');
  $('closeBoard').textContent = t('CLOSE');
  const list = $('boardList');
  list.textContent = '';
  const note = $('boardNote');
  note.textContent = '…'; note.hidden = false;
  openDialog('boardBox');
  try {
    const u = new URL(SCORES_URL, location.href);
    if (daily) { u.searchParams.set('day', today()); u.searchParams.set('mode', 'daily'); }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const top = (await (await fetch(u, { signal: ctrl.signal })).json()).top;
    if (!Array.isArray(top)) throw new Error('bad list');
    list.textContent = '';
    for (const e of top.slice(0, 10)) {
      const li = document.createElement('li');
      const name = document.createElement('span'), score = document.createElement('b');
      name.textContent = String(e.name); score.textContent = String(e.score);
      li.append(name, score); list.appendChild(li);
    }
    note.hidden = top.length > 0;
    note.textContent = t('NO SCORES YET');
  } catch (e) { note.textContent = t('COULD NOT LOAD THE LIST'); note.hidden = false; }
}
boardBtn.addEventListener('click', openBoard);
$('closeBoard').addEventListener('click', () => { sfx.tick(); closeDialog(); });
boardBtn.textContent = t('TOP 10');
document.addEventListener('hoplanes:lang', () => { boardBtn.textContent = t('TOP 10'); });

// ---------- screen reader announcer: the state changes and every 10 rows ----------
const live = $('live');
let liveText = '';
function announce(text) {
  if (text === liveText) text += ' ';   // the same text again is still an update
  liveText = text; live.textContent = text;
}
let lastState = '', lastRows = [0, 0];
function announceFrame() {
  if (G.state !== lastState) {
    lastState = G.state;
    if (G.state === 'play') { lastRows = [0, 0]; announce(t('GO!')); }
    else if (G.state === 'over') {
      const parts = players.filter(p => p.joined).map(p => t('PLAYER {n}', { n: p.id + 1 }) + ' ' + p.score);
      announce(t('GAME OVER') + '. ' + parts.join(', ') + '. ' + $('resNote').textContent);
    } else if (G.state === 'paused') announce(t('PAUSED'));
    return;
  }
  if (G.state !== 'play') return;
  for (const p of players) {
    if (!p.joined) continue;
    const tens = Math.floor(p.score / 10);
    if (tens > lastRows[p.id]) { lastRows[p.id] = tens; announce(t('PLAYER {n} ROW {m}', { n: p.id + 1, m: tens * 10 })); }
  }
}

export { announce, announceFrame, closeDialog, dialogOpen, labelSettings, openBoard, openDialog };
