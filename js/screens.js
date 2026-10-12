import { audio, sfx, startTune, stopTune } from './audio.js';
import { $, COUNTDOWN, G, GO_TIME, MODES, PRIZE_COST, SCORES_URL, WIPE_MS } from './core.js';
import { keepAwake } from './device.js';
import { reduceMotion, resetFrameWatch, touchQuery } from './gfx.js';
import { CHARACTERS, PIX, PRIZES, drawPix, isOwned } from './models.js';
import { charOf, despawn, players, spawn } from './players.js';
import { BEST_KEY, DAILY_KEY, HOWTO_KEY, MODE_KEY, OWNED_KEY, PICK_KEY, dayKey, load, owned, refreshBests, save, setBank } from './storage.js';
import { resetWorld } from './world.js';

// Screens and flow: join cards and the shop, countdown, results, restart, pause, first-run help, online scores.
// ---------- screens ----------
let bannerKey = '';
const banner = $('banner'), bannerH = banner.querySelector('h2'), bannerP = banner.querySelector('p');
const resultsEl = $('results');
function setBanner(h, sub = '') {
  const key = h + '|' + sub;
  if (key === bannerKey) return;      // only touch the DOM when the text changes
  bannerKey = key;
  banner.hidden = !h;
  bannerH.textContent = h; bannerP.textContent = sub;
}
const pads = document.querySelectorAll('.pad');
const joinText = () => touchQuery.matches ? 'TAP THIS\nSIDE TO JOIN' : 'PRESS TAP\nTO JOIN';
function setCard(i) {
  const c = $('card' + (i + 1)), p = players[i], ch = charOf(p), locked = !isOwned(ch);
  pads[i].classList.toggle('idle', (G.state === 'play' || G.state === 'over') && !p.joined);
  c.classList.toggle('ready', p.joined && G.state === 'countdown');
  c.classList.toggle('locked', locked && !p.joined);
  c.style.visibility = G.state === 'play' || G.state === 'over' ? 'hidden' : 'visible';
  if (p.shownChar !== ch.key) { drawPix($('pic' + (i + 1)), PIX[ch.key]); p.shownChar = ch.key; }
  const head = c.querySelector('.head'), st = c.querySelector('.state');
  if (p.joined) { head.textContent = 'READY!'; st.textContent = 'PLAYER ' + (i + 1); }
  else if (locked) { head.textContent = G.bank >= ch.price ? 'TAP TO BUY' : 'NEED ' + ch.price + ' COINS'; st.textContent = ch.name + ' · ' + ch.price + ' COINS'; }
  else { head.textContent = joinText(); st.textContent = ch.name; }
  for (const b of c.querySelectorAll('.cyc')) b.disabled = p.joined;
}
function cycleChar(i, d) {
  const p = players[i];
  if (p.joined || G.state === 'play' || G.state === 'over') return;
  p.charIndex = (p.charIndex + d + CHARACTERS.length) % CHARACTERS.length;
  save(PICK_KEY + i, charOf(p).key);
  sfx.tick();
  setCard(i);
}
function shakeCard(i) {
  const c = $('card' + (i + 1));
  c.classList.remove('shake');
  void c.offsetWidth;   // restart the animation
  c.classList.add('shake');
}
const menu = $('menu');
const setCards = () => { setCard(0); setCard(1); menu.hidden = G.state !== 'attract'; };

// ---------- title menu: game mode and the prize machine ----------
const MODE_TEXT = { classic: 'MODE: CLASSIC', race: 'MODE: RACE', daily: 'MODE: DAILY' };
function setMode(mode) {
  G.mode = mode;
  save(MODE_KEY, mode);
  $('mode').textContent = MODE_TEXT[mode];
  if (G.state === 'attract') resetWorld();   // daily mode uses today's seed
}
function cycleMode() { sfx.tick(); setMode(MODES[(MODES.indexOf(G.mode) + 1) % MODES.length]); }
function updatePrize() {
  const left = PRIZES.filter(k => !owned.has(k));
  const b = $('prize');
  b.disabled = !left.length;
  b.textContent = left.length ? 'PRIZE \u00b7 ' + PRIZE_COST + ' COINS' : 'ALL PRIZES WON';
}
let menuNote = 0;
function flashBanner(h, sub, ms) {
  setBanner(h, sub);
  clearTimeout(menuNote);
  menuNote = setTimeout(() => { if (G.state === 'attract') setBanner(''); }, ms);
}
function prizeMachine() {
  if (G.state !== 'attract') return;
  const left = PRIZES.filter(k => !owned.has(k));
  if (!left.length) return;
  if (G.bank < PRIZE_COST) { sfx.nope(); flashBanner('NEED ' + PRIZE_COST + ' COINS', 'COLLECT THEM ON THE ROAD', 1400); return; }
  setBank(G.bank - PRIZE_COST);
  const key = left[Math.floor(Math.random() * left.length)];
  owned.add(key); save(OWNED_KEY, [...owned].join(','));
  const idx = CHARACTERS.findIndex(c => c.key === key);
  players[0].charIndex = idx; save(PICK_KEY + 0, key);
  sfx.prize();
  flashBanner('YOU GOT ' + CHARACTERS[idx].name + '!', 'IT IS NOW PLAYER 1', 2200);
  updatePrize();
  setCards();
}
$('mode').addEventListener('click', () => { audio(); cycleMode(); });
$('prize').addEventListener('click', () => { audio(); prizeMachine(); });
setMode(G.mode);
updatePrize();

// ---------- share and confetti ----------
let shareText = '';
async function shareScore() {
  const b = $('share');
  try {
    if (navigator.share) { await navigator.share({ text: shareText }); b.textContent = 'SHARED!'; }
    else { await navigator.clipboard.writeText(shareText); b.textContent = 'COPIED!'; }
  } catch (e) { b.textContent = 'COPY FAILED'; }
}
$('share').addEventListener('click', shareScore);
const confettiBox = $('confetti');
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
  setTimeout(() => { confettiBox.textContent = ''; }, 6000);
}

function toAttract() {
  G.state = 'attract'; G.stateT = 0; G.camRow = 0;
  players.forEach(p => { p.joined = false; despawn(p); });
  resetWorld();
  refreshBests();
  resultsEl.hidden = true; $('logo').hidden = false;
  $('score1').hidden = $('score2').hidden = true;
  $('share').textContent = 'SHARE';
  setBanner('');
  setCards();
}
// cover the screen, build the new world under the cover, then fade back in
const wipe = $('wipe');
function restart(joinPlayer) {
  if (G.restarting) return;
  G.restarting = true;
  wipe.classList.add('on');
  setTimeout(() => {
    toAttract();
    if (joinPlayer !== undefined) join(joinPlayer);
    requestAnimationFrame(() => { wipe.classList.remove('on'); G.restarting = false; });
  }, reduceMotion ? 0 : WIPE_MS);
}
function join(i) {
  const p = players[i];
  if (p.joined) return;
  const ch = charOf(p);
  if (!isOwned(ch)) {                                   // a locked character: buy it with coins, or no join
    if (G.bank < ch.price) { sfx.nope(); shakeCard(i); return; }
    setBank(G.bank - ch.price);
    owned.add(ch.key); save(OWNED_KEY, [...owned].join(','));
    sfx.buy();
  }
  p.joined = true; sfx.join();
  stopTune();
  spawn(p);
  if (G.state === 'attract') { G.state = 'countdown'; G.countdown = COUNTDOWN; }
  else G.countdown = Math.max(G.countdown, 2.5);
  $('logo').hidden = true;
  setCards();
}
function startPlay() {
  G.state = 'play'; G.playT = 0; G.goT = GO_TIME; sfx.go();
  $('app').classList.add('playing');
  resetFrameWatch();
  keepAwake(true);
  setBanner('GO!');
  players.forEach((p, i) => { $('score' + (i + 1)).hidden = !p.joined; });
  setCards();
}
function checkOver() {
  if (G.state !== 'play') return;
  const [p1, p2] = players;
  const both = p1.joined && p2.joined;
  // race: the first to die loses, at once; otherwise the game ends when nobody is left
  const race = G.mode === 'race' && both && players.some(p => p.joined && !p.alive);
  if (!race && players.some(p => p.joined && p.alive)) return;
  G.state = 'over'; G.stateT = 0;
  $('app').classList.remove('playing');
  keepAwake(false);
  setBanner('');
  const top = Math.max(p1.joined ? p1.score : 0, p2.joined ? p2.score : 0);
  let note = '';
  if (top > G.bestAll) { G.bestAll = top; save(BEST_KEY, top); note = 'NEW ALL TIME BEST!'; }
  if (top > load(dayKey())) { save(dayKey(), top); note = note || 'NEW BEST TODAY!'; }
  if (G.mode === 'daily') {
    const k = DAILY_KEY + dayKey();
    if (top > load(k)) { save(k, top); note = 'NEW DAILY CHALLENGE BEST!'; }
    else note = 'DAILY CHALLENGE BEST ' + load(k) + '. ' + note;
  }
  refreshBests();
  // who wins: in a race the one still standing (or the higher score), otherwise the higher score
  let winner = null;
  if (both) winner = race && (p1.alive !== p2.alive) ? (p1.alive ? p1 : p2) : p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2);
  $('resTitle').textContent = !both ? 'GAME OVER' : !winner ? 'TIE GAME!' : charOf(winner).name + ' WINS!';
  if (race && winner) note = 'BY ' + Math.abs(p1.score - p2.score) + ' ROWS. ' + note;
  const hero = winner || (p1.joined ? p1 : p2);
  shareText = 'I scored ' + top + ' in Hop Lanes as ' + charOf(hero).name + '! ' + location.origin + location.pathname;
  if (note.includes('ALL TIME') && top >= 1) { confetti(); sfx.best(); }
  $('res1').hidden = !p1.joined; $('res2').hidden = !p2.joined;
  $('res1').querySelector('span').textContent = charOf(p1).name;
  $('res2').querySelector('span').textContent = charOf(p2).name;
  $('world').hidden = true;
  postScore(charOf(hero).name, top);
  $('res1').querySelector('b').textContent = p1.score;
  $('res2').querySelector('b').textContent = p2.score;
  $('resNote').textContent = (note ? note + ' ' : '') + 'PRESS TAP TO PLAY AGAIN';
}

// optional online score list: silent when no server is set or it can not be reached
async function postScore(name, score) {
  if (!SCORES_URL || !window.fetch) return;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(SCORES_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score }), signal: ctrl.signal
    });
    if (!res.ok) return;
    const top = (await res.json()).top;
    if (Array.isArray(top) && top.length && G.state === 'over') {
      $('world').textContent = 'WORLD BEST ' + top[0].score + ' \u00b7 ' + top[0].name;
      $('world').hidden = false;
    }
  } catch (e) { /* offline, blocked by the page policy, or no server: nothing to show */ }
}

// ---------- pause (phone call, app switch, or the P key) ----------
let pausedFrom = '';
function pauseGame() {
  if (G.state !== 'play' && G.state !== 'countdown') return;
  pausedFrom = G.state; G.state = 'paused';
  keepAwake(false);
  setBanner('PAUSED', touchQuery.matches ? 'TAP TO CONTINUE' : 'PRESS ANY KEY');
}
function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = pausedFrom; G.goT = 0;
  setBanner('');
  if (G.state === 'play') keepAwake(true);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------- first-run help ----------
const howto = $('howto');
function showHowto() {
  howto.querySelector('p').textContent = touchQuery.matches
    ? 'Tap the game to hop forward.\nSwipe to move left, right or back.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!'
    : 'Player 1: W A S D.  Player 2: arrow keys.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!';
  howto.hidden = false;
}
function hideHowto() {
  if (howto.hidden) return false;
  howto.hidden = true;
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch (e) {}
  return true;
}
$('gotit').addEventListener('click', hideHowto);

export { banner, bannerH, bannerKey, bannerP, checkOver, confetti, cycleChar, cycleMode, hideHowto, howto, join, joinText, menu, pads, pauseGame, pausedFrom, postScore, prizeMachine, restart, resultsEl, resumeGame, setBanner, setCard, setCards, setMode, shakeCard, shareScore, showHowto, startPlay, toAttract, updatePrize, wipe };
