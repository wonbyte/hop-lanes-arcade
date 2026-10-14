import { audio, isMuted, setMuted, sfx } from './audio.js';
import { $, G, SCORES_URL } from './core.js';
import { buzzIsOn, setBuzz } from './device.js';
import { t } from './i18n.js';
import { charOf, players } from './players.js';
import { camera, renderer, scene } from './gfx.js';
import { isoWeek } from './rules.js';
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

// ---------- photo mode: a PNG of the field with the score on it, shared or saved ----------
// The scene is drawn again right before the pixels are read (the canvas buffer is not kept between frames).
function snapshotBlob() {
  renderer.render(scene, camera);
  const src = renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const px = Math.max(14, Math.round(c.width / 22));
  g.font = 'bold ' + px + 'px sans-serif'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, c.width, px * 2.2);
  g.fillStyle = '#ffd84a';
  const line = players.filter(p => p.joined).map(p => t(charOf(p).name) + ' ' + p.score).join('   ');
  g.fillText('HOP LANES  ' + line, px * 0.6, px * 0.6);
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function snapshot() {
  const b = $('snapBtn');
  sfx.snap();
  try {
    const blob = await snapshotBlob();
    if (!blob) throw new Error('no image');
    const file = new File([blob], 'hop-lanes.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: 'Hop Lanes' }); b.textContent = t('SHARED!'); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'hop-lanes.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    b.textContent = t('SAVED!');
  } catch (e) { b.textContent = t('COULD NOT SAVE'); }
}
$('snapBtn').addEventListener('click', snapshot);
document.addEventListener('hoplanes:pause', () => { $('snapBtn').textContent = t('SNAPSHOT'); });

// ---------- online top 10 (only when a score server is set) ----------
const boardBtn = $('board');
boardBtn.hidden = !SCORES_URL;
// the list shows all time, today or this week; the button under it cycles the three
const SCOPES = ['all', 'day', 'week'];
const SCOPE_TITLE = { all: 'TOP 10', day: 'TODAY TOP 10', week: 'THIS WEEK TOP 10' };
let scope = '';   // '' until the first open: daily mode starts on today, the rest on all time
async function openBoard() {
  audio(); sfx.tick();
  const daily = G.mode === 'daily';
  if (!scope) scope = daily ? 'day' : 'all';
  $('boardBox').querySelector('h2').textContent = t(SCOPE_TITLE[scope]);
  $('boardScope').textContent = t(SCOPE_TITLE[SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length]]);
  $('closeBoard').textContent = t('CLOSE');
  const list = $('boardList');
  list.textContent = '';
  const note = $('boardNote');
  note.textContent = '…'; note.hidden = false;
  openDialog('boardBox');
  try {
    const u = new URL(SCORES_URL, location.href);
    if (scope === 'day') u.searchParams.set('day', today()); else if (scope === 'week') u.searchParams.set('week', isoWeek(today()));
    if (daily && scope !== 'all') u.searchParams.set('mode', 'daily');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const top = (await (await fetch(u, { signal: ctrl.signal })).json()).top;
    if (!Array.isArray(top)) throw new Error('bad list');
    list.textContent = '';
    for (const e of top.slice(0, 10)) {
      const li = document.createElement('li');
      const name = document.createElement('span'), score = document.createElement('b');
      name.textContent = String(e.name); score.textContent = String(e.score);
      li.append(name, score);
      if (typeof e.replay === 'string' && e.replay && location.protocol !== 'file:') {   // watch that run: the page reloads as a replay
        const watch = document.createElement('button');
        watch.type = 'button'; watch.className = 'watch'; watch.textContent = '\u25b6'; watch.setAttribute('aria-label', t('WATCH'));
        watch.addEventListener('click', () => { sfx.tick(); location.hash = '#replay-' + e.replay; location.reload(); });
        li.appendChild(watch);
      }
      list.appendChild(li);
    }
    note.hidden = top.length > 0;
    note.textContent = t('NO SCORES YET');
  } catch (e) { note.textContent = t('COULD NOT LOAD THE LIST'); note.hidden = false; }
}
boardBtn.addEventListener('click', openBoard);
$('boardScope').addEventListener('click', () => { scope = SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length]; openBoard(); });
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
