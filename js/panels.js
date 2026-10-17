import { audio, isMuted, setMuted, sfx } from './audio.js';
import { $, G, LOOKS, SCORES_URL } from './core.js';
import { buzzIsOn, setBuzz } from './device.js';
import { t } from './i18n.js';
import { charOf, players } from './players.js';
import { camera, renderer, scene } from './gfx.js';
import { isoWeek } from './rules.js';
import { restart, resumeGame, setLook } from './screens.js';
import { LOCAL_KEY, LOOK_KEY, MOTION_KEY, loadText, parseLocal, save, today } from './storage.js';

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
  answerCode(null);   // a question closed without OK (Escape, a join) answers nothing
  return true;
}
const dialogOpen = () => !!openBox && !openBox.hidden;
document.addEventListener('hoplanes:join', closeDialog);   // screens.js join: the game starts, a panel left open goes

// ---------- settings: sound, vibration, language, handicap, motion ----------
const motionLess = () => loadText(MOTION_KEY) === '1';
function labelSettings() {
  $('sound').textContent = t(isMuted() ? 'SOUND: OFF' : 'SOUND: ON');
  $('buzz').textContent = t(buzzIsOn() ? 'VIBRATION: ON' : 'VIBRATION: OFF');
  $('motion').textContent = t(motionLess() ? 'MOTION: LESS' : 'MOTION: AUTO');
  labelLook();
  $('settingsBox').querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n); });
  $('settings').textContent = t('SETTINGS');
  $('motionNote').textContent = t('MOTION CHANGES AFTER A RELOAD');
}
$('settings').addEventListener('click', () => { audio(); sfx.tick(); labelSettings(); openDialog('settingsBox'); });
$('closeSettings').addEventListener('click', () => { sfx.tick(); closeDialog(); });
$('sound').addEventListener('click', () => { audio(); setMuted(!isMuted()); labelSettings(); });
$('buzz').addEventListener('click', () => { sfx.tick(); setBuzz(!buzzIsOn()); labelSettings(); });
$('motion').addEventListener('click', () => { sfx.tick(); save(MOTION_KEY, motionLess() ? 0 : 1); labelSettings(); });
// looks: the land can start as a far biome, or at night, once the all-time best has reached that far (core.js LOOKS)
const LOOK_TEXT = { auto: 'LOOK: AUTO', desert: 'LOOK: DESERT', night: 'LOOK: NIGHT', tundra: 'LOOK: TUNDRA', swamp: 'LOOK: SWAMP' };
const unlockedLooks = () => LOOKS.filter(l => G.bestAll >= l.at);
function labelLook() {
  const next = LOOKS.find(l => G.bestAll < l.at);
  $('look').textContent = t(LOOK_TEXT[G.look]);
  $('lookNote').textContent = next ? t('REACH ROW {n} TO UNLOCK {name}', { n: next.at, name: t(next.key.toUpperCase()) }) : t('EVERY LOOK IS YOURS');
}
$('look').addEventListener('click', () => {
  sfx.tick();
  const open = unlockedLooks(), k = open.findIndex(l => l.key === G.look);
  setLook(open[(k + 1) % open.length].key);
  save(LOOK_KEY, G.look);
  labelLook();
});
document.addEventListener('hoplanes:lang', labelSettings);

// ---------- missions: the title's chip opens both lists (screens.js fills them) ----------
$('missionChip').addEventListener('click', () => { audio(); sfx.tick(); openDialog('missionsBox'); });
$('closeMissions').addEventListener('click', () => { sfx.tick(); closeDialog(); });

// ---------- a question in letters: the room code, the initials (screens.js asks with a hoplanes:ask event) ----------
// Each slot has a 44px up and down button; letters and digits typed on a keyboard fill the slots in turn.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let codeDone = null, codeAt = 0;
const codeLetters = [];
const codeText = () => codeLetters.map(k => ALPHA[k]).join('');
function answerCode(code) {
  if (!codeDone) return;
  const done = codeDone;
  codeDone = null;
  done(code);
}
function showSlots() {
  $('slots').querySelectorAll('.slot').forEach((el, k) => {
    el.querySelector('b').textContent = ALPHA[codeLetters[k]];
    el.classList.toggle('cur', k === codeAt);
  });
}
function turnSlot(k, d) {
  codeAt = k;
  codeLetters[k] = (codeLetters[k] + d + ALPHA.length) % ALPHA.length;
  sfx.tick();
  showSlots();
}
function slotButton(text, label, k, d) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
  b.addEventListener('click', () => turnSlot(k, d));
  return b;
}
function buildSlots(len, value) {
  const box = $('slots');
  box.textContent = '';
  codeLetters.length = 0; codeAt = 0;
  for (let k = 0; k < len; k++) {
    codeLetters.push(Math.max(0, ALPHA.indexOf(value[k] || 'A')));
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.append(slotButton('\u25b2', t('LETTER {n}: NEXT', { n: k + 1 }), k, 1), document.createElement('b'), slotButton('\u25bc', t('LETTER {n}: BACK', { n: k + 1 }), k, -1));
    box.appendChild(slot);
  }
  showSlots();
}
document.addEventListener('hoplanes:ask', e => {
  const { title, len, value, done } = /** @type {CustomEvent} */ (e).detail;
  $('codeTitle').textContent = title;
  buildSlots(len, String(value || '').toUpperCase());
  $('codeOk').textContent = t('OK'); $('codeCancel').textContent = t('CANCEL');
  openDialog('codeBox');
  try { $('codeOk').focus({ preventScroll: true }); } catch (err) {}
  codeDone = done;
});
function finishCode(ok) {
  const code = codeText(), done = codeDone;
  codeDone = null;
  closeDialog();
  if (done) done(ok ? code : null);
}
$('codeOk').addEventListener('click', () => { sfx.tick(); finishCode(true); });
$('codeCancel').addEventListener('click', () => { sfx.tick(); finishCode(false); });
// typing: a letter or digit fills the current slot and moves on; Backspace goes back; Enter is OK
$('codeBox').addEventListener('keydown', e => {
  const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(e.code);
  if (m) { codeLetters[codeAt] = ALPHA.indexOf(m[1]); codeAt = Math.min(codeLetters.length - 1, codeAt + 1); showSlots(); }
  else if (e.code === 'Backspace') { codeAt = Math.max(0, codeAt - 1); showSlots(); }
  else if (e.code === 'Enter' && e.target !== $('codeCancel')) finishCode(true);
  else return;
  e.preventDefault(); e.stopPropagation();
});

// ---------- pause menu ----------
document.addEventListener('hoplanes:pause', () => { labelPause(); openDialog('pauseBox'); });   // screens.js pauseGame() shows the box
function labelPause() {
  $('pauseBox').querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n); });
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

// ---------- top 10: the best runs on this device, and the online list when a score server is set ----------
const boardBtn = $('board');
// the list shows this device, and with a server all time, today or this week; the button under it cycles them
const SCOPES = SCORES_URL ? ['local', 'all', 'day', 'week'] : ['local'];
const SCOPE_TITLE = { local: 'THIS DEVICE', all: 'TOP 10', day: 'TODAY TOP 10', week: 'THIS WEEK TOP 10' };
let scope = '';   // '' until the first open: with a server daily mode starts on today and the rest on all time; without one, this device
const boardRow = (name, score) => {
  const li = document.createElement('li');
  const a = document.createElement('span'), b = document.createElement('b');
  a.textContent = String(name); b.textContent = String(score);
  li.append(a, b);
  return li;
};
let boardReq = 0;   // the newest request wins: a scope change while a fetch is in flight must not show the old list
async function openBoard() {
  audio(); sfx.tick();
  const req = ++boardReq;
  const daily = G.mode === 'daily';
  if (!scope) scope = !SCORES_URL ? 'local' : daily ? 'day' : 'all';
  $('boardBox').querySelector('h2').textContent = t(SCOPE_TITLE[scope]);
  $('boardScope').textContent = t(SCOPE_TITLE[SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length]]);
  $('boardScope').hidden = SCOPES.length < 2;
  $('closeBoard').textContent = t('CLOSE');
  const list = $('boardList');
  list.textContent = '';
  const note = $('boardNote');
  note.textContent = '…'; note.hidden = false;
  openDialog('boardBox');
  if (scope === 'local') {   // saved on this device: no watch button (the runs are not kept)
    const local = parseLocal(loadText(LOCAL_KEY));
    for (const e of local) list.appendChild(boardRow(e.name, e.score));
    note.hidden = local.length > 0;
    note.textContent = t('NO SCORES YET');
    return;
  }
  try {
    const u = new URL(SCORES_URL, location.href);
    if (scope === 'day') u.searchParams.set('day', today()); else if (scope === 'week') u.searchParams.set('week', isoWeek(today()));
    if (daily && scope !== 'all') u.searchParams.set('mode', 'daily');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const top = (await (await fetch(u, { signal: ctrl.signal })).json()).top;
    if (req !== boardReq) return;   // a newer request (another scope, a reopen) owns the list now
    if (!Array.isArray(top)) throw new Error('bad list');
    list.textContent = '';
    for (const e of top.slice(0, 10)) {
      const li = boardRow(e.name, e.score);
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
  } catch (e) { if (req !== boardReq) return; note.textContent = t('COULD NOT LOAD THE LIST'); note.hidden = false; }
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
    const from = lastState;
    lastState = G.state;
    if (G.state === 'play') { if (from === 'countdown') { lastRows = [0, 0]; announce(t('GO!')); } }   // a resume from pause goes on counting
    else if (G.state === 'over') {
      const parts = players.filter(p => p.joined).map(p => t('PLAYER {n}', { n: p.id + 1 }) + ' ' + p.score);
      announce(t('GAME OVER') + '. ' + parts.join(', ') + '. ' + $('resCause').textContent + ' ' + $('resNote').textContent);
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

// a warning for one player (players.js: the eagle, the rapids): said at once
document.addEventListener('hoplanes:say', e => announce(String(/** @type {CustomEvent} */ (e).detail)));

export { announceFrame, closeDialog, dialogOpen };
