import { sfx } from './audio.js';
import { $, COUNTDOWN, G, GO_TIME, SCORES_URL, WIPE_MS } from './core.js';
import { keepAwake } from './device.js';
import { reduceMotion, resetFrameWatch, touchQuery } from './gfx.js';
import { CHARACTERS, PIX, drawPix, isOwned } from './models.js';
import { charOf, despawn, players, spawn } from './players.js';
import { BEST_KEY, HOWTO_KEY, OWNED_KEY, PICK_KEY, dayKey, load, owned, refreshBests, save, setBank } from './storage.js';
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
const setCards = () => { setCard(0); setCard(1); };

function toAttract() {
  G.state = 'attract'; G.stateT = 0; G.camRow = 0;
  players.forEach(p => { p.joined = false; despawn(p); });
  resetWorld();
  refreshBests();
  resultsEl.hidden = true; $('logo').hidden = false;
  $('score1').hidden = $('score2').hidden = true;
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
  if (G.state !== 'play' || players.some(p => p.joined && p.alive)) return;
  G.state = 'over'; G.stateT = 0;
  $('app').classList.remove('playing');
  keepAwake(false);
  setBanner('');
  const [p1, p2] = players;
  const top = Math.max(p1.joined ? p1.score : 0, p2.joined ? p2.score : 0);
  let note = '';
  if (top > G.bestAll) { G.bestAll = top; save(BEST_KEY, top); note = 'NEW ALL TIME BEST!'; }
  if (top > load(dayKey())) { save(dayKey(), top); note = note || 'NEW BEST TODAY!'; }
  refreshBests();
  $('resTitle').textContent = !(p1.joined && p2.joined) ? 'GAME OVER'
    : p1.score === p2.score ? 'TIE GAME!'
    : charOf(p1.score > p2.score ? p1 : p2).name + ' WINS!';
  $('res1').hidden = !p1.joined; $('res2').hidden = !p2.joined;
  $('res1').querySelector('span').textContent = charOf(p1).name;
  $('res2').querySelector('span').textContent = charOf(p2).name;
  $('world').hidden = true;
  postScore(charOf(p1.joined && (!p2.joined || p1.score >= p2.score) ? p1 : p2).name, top);
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

export { banner, bannerH, bannerKey, bannerP, checkOver, cycleChar, hideHowto, howto, join, joinText, pads, pauseGame, pausedFrom, postScore, restart, resultsEl, resumeGame, setBanner, setCard, setCards, shakeCard, showHowto, startPlay, toAttract, wipe };
