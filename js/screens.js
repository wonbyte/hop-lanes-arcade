import { audio, isMuted, setMuted, sfx, startPlayLoop, stopPlayLoop, stopTune } from './audio.js';
import { $, COUNTDOWN, G, GO_TIME, JOIN_COUNTDOWN, MODES, PRIZE_COST, RETRY_AFTER, SOLO_COUNTDOWN, WIPE_MS } from './core.js';
import { nextLang, setLang, t } from './i18n.js';
import { comebackBonus, emptyStats } from './missions.js';
import { showMissions } from './missions-ui.js';
import { RULES, dailySeedFor, dayBefore, streakAfter, traitOf } from './rules.js';
import { keepAwake } from './device.js';
import { fitTopBar, reduceMotion, resetFrameWatch, touchQuery } from './gfx.js';
import { CHARACTERS, PRIZES, drawPix, isOwned, paintedPix } from './models.js';
import { charOf, despawn, players, resetRules, restorePicks, spawn } from './players.js';
import { HANDICAP_KEY, HINT_KEY, HOWTO_KEY, INSTALL_KEY, MODE_KEY, OWNED_KEY, PICK_KEY, ROOM_KEY, VISIT_KEY, flushBank, loadText, owned, paintOf, refreshBests, save, savedMode, setBank, today } from './storage.js';
import { getSeed, refreshPowerLooks, resetWorld } from './world.js';
import { startGhost, stopGhost } from './ghost.js';

// Screens and flow: join cards and the shop, the title menu, the come-back bonus, countdown, restart, pause, first-run
// help. The results and the online post are results.js; the missions' texts and payouts missions-ui.js.
// ---------- screens ----------
let bannerKey = '';
const banner = $('banner'), bannerH = banner.querySelector('h2'), bannerP = banner.querySelector('p');
const resultsEl = $('results'), app = $('app');
function setBanner(h, sub = '') {
  const key = h + '|' + sub;
  if (key === bannerKey) return;      // only touch the DOM when the text changes
  bannerKey = key;
  banner.hidden = !h;
  banner.classList.remove('note');
  bannerH.textContent = h; bannerP.textContent = sub;
}
// a state class on #app for the CSS: playing, over (the run has ended), results (the panel shows); the top bar is
// slimmer during play, so its height is measured again (gfx.js fitTopBar)
function setAppState(playing, over, results) {
  app.classList.toggle('playing', playing);
  app.classList.toggle('over', over);
  app.classList.toggle('results', results);
  fitTopBar();
}
const pads = document.querySelectorAll('.pad');
// the join line: a touch screen joins by a tap on that side; a keyboard by the player's own key
const joinText = i => t(touchQuery.matches ? 'TAP THIS\nSIDE TO JOIN' : i ? 'PRESS ↑\nTO JOIN' : 'PRESS W\nTO JOIN');
function setCard(i) {
  const c = $('card' + (i + 1)), p = players[i], ch = charOf(p), locked = !isOwned(ch);
  pads[i].classList.toggle('idle', (G.state === 'play' || G.state === 'over') && !p.joined);
  c.classList.toggle('ready', p.joined && G.state === 'countdown');
  c.classList.toggle('locked', locked && !p.joined);
  c.classList.toggle('open', !p.joined && !locked);   // the join line pulses (player 1)
  c.style.visibility = G.state === 'play' || G.state === 'over' ? 'hidden' : 'visible';
  const look = ch.key + '/' + paintOf(ch.key);   // the animal in its paint (paint.js changes it)
  if (p.shownChar !== look) { drawPix($('pic' + (i + 1)), paintedPix(ch.key, paintOf(ch.key))); p.shownChar = look; }
  const head = c.querySelector('.head'), st = c.querySelector('.state');
  if (p.joined) { head.textContent = t('READY!'); st.textContent = t('PLAYER {n}', { n: i + 1 }); }
  else if (locked) { const [h, sub] = lockedText(ch); head.textContent = h; st.textContent = sub; }
  else { head.textContent = joinText(i); st.textContent = t(ch.name) + ' · ' + t(traitOf(ch.key).text || 'BALANCED'); }
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (c.querySelectorAll('.cyc'))) b.disabled = p.joined;
}
// a locked card: a prize animal comes only from the prize machine; the others are bought with coins
function lockedText(ch) {
  if (ch.prize) return [t('PRIZE MACHINE\nONLY'), t('{name} · A PRIZE', { name: t(ch.name) })];
  return [G.bank >= ch.price ? t('TAP TO BUY') : t('NEED {n} COINS', { n: ch.price }), t('{name} · {n} COINS', { name: t(ch.name), n: ch.price })];
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
  if (c.getAnimations) for (const a of c.getAnimations()) a.cancel();   // restart the animation without a layout read
  c.classList.add('shake');
}
const menu = $('menu');
const setCards = () => { setCard(0); setCard(1); menu.hidden = G.state !== 'attract'; };

// ---------- in-page questions: the room code and the initials (panels.js shows the letter slots) ----------
// done(code) gets the letters, or null when the question was closed
const askCode = (title, len, value, done) => document.dispatchEvent(new CustomEvent('hoplanes:ask', { detail: { title, len, value, done } }));

// ---------- title menu: game mode, room code, prize machine, handicap, language, missions ----------
const MODE_NAME = { classic: 'CLASSIC', race: 'RACE', coinwar: 'COIN WAR', tag: 'TAG', daily: 'DAILY', room: 'ROOM' };
// one short line under the button (and in the picker): what the mode is
const MODE_NOTE = { classic: 'HOP AS FAR AS YOU CAN', race: 'FIRST TO FALL LOSES', coinwar: 'MOST COINS WINS', tag: 'THE ONE BEHIND HOPS FASTER', daily: 'ONE WORLD FOR ALL TODAY', room: 'SAME CODE, SAME WORLD' };
const TWO_UP_MODES = ['race', 'coinwar', 'tag'];   // modes made for two players (the picker says so)
function setModeLabel() {
  $('modeText').textContent = G.mode === 'room' ? t('ROOM: {code}', { code: G.room }) : t('MODE: {name}', { name: t(MODE_NAME[G.mode]) });
  $('modeNote').textContent = t(MODE_NOTE[G.mode]);
}
function setMode(mode) {
  G.mode = mode;
  save(MODE_KEY, mode);
  setModeLabel();
  if (G.state === 'attract') buildWorld();   // daily and room modes have their own seeds
}
// a new world, and the day its daily seed was made for ('' when it is not a daily world): a daily run started on a
// title world built before midnight belongs to that day (the score server checks the seed against the posted day)
function buildWorld() {
  resetWorld();
  const seed = getSeed();
  G.worldDay = G.mode !== 'daily' ? '' : [today(), dayBefore()].find(d => dailySeedFor(d) === seed) || '';
}
const runDay = () => G.worldDay || today();
// the day changed (storage.js): today's missions are new, and a daily title world is rebuilt as the new day's world
document.addEventListener('hoplanes:day', () => {
  showMissions();
  if (G.state === 'attract' && !G.restarting && G.mode === 'daily' && G.worldDay && G.worldDay !== today()) buildWorld();
});
// an unlocked look (settings): the land starts as a far biome or at night; the title world is built again in it
function setLook(key) {
  G.look = key;
  if (G.state === 'attract') buildWorld();
}
// room mode: two phones that enter the same code play the same world (seed = the code)
const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
// the mode picker (panels.js) chose a mode; room mode asks for its code first (closed: the mode stays as it was)
function pickMode(mode) {
  if (G.state !== 'attract' || !MODES.includes(mode)) return;
  sfx.tick();
  if (mode !== 'room') { setMode(mode); return; }
  askCode(t('ROOM CODE'), 4, (G.room || randomCode()).slice(0, 4), code => {
    if (G.state !== 'attract' || !code) return;
    G.room = code; save(ROOM_KEY, code);
    setMode('room');
  });
}
function updatePrize() {
  const left = PRIZES.filter(k => !owned.has(k));
  const b = /** @type {HTMLButtonElement} */ ($('prize'));
  b.disabled = !left.length;
  b.textContent = left.length ? t('PRIZE · {n} COINS', { n: PRIZE_COST }) : t('ALL PRIZES WON');
}
const HANDICAP_TEXT = ['HANDICAP: OFF', 'SHIELD: P1', 'SHIELD: P2'];
function setHandicap(n) { G.handicap = n; save(HANDICAP_KEY, n); $('handicap').textContent = t(HANDICAP_TEXT[n]); }
$('handicap').addEventListener('click', () => { audio(); sfx.tick(); setHandicap((G.handicap + 1) % 3); });
$('lang').addEventListener('click', () => { audio(); sfx.tick(); setLang(nextLang()); refreshTexts(); });
// everything that shows text in the current language
function refreshTexts() {
  setModeLabel(); updatePrize(); setHandicap(G.handicap); showMissions(); setCards(); setMuted(isMuted());
  document.dispatchEvent(new Event('hoplanes:lang'));   // panels.js relabels its buttons
}
let menuNote = 0;
// a note on the title (a prize, the come-back bonus, the install hint): smaller than the countdown, on a panel
function flashBanner(h, sub, ms) {
  setBanner(h, sub);
  banner.classList.add('note');
  document.dispatchEvent(new CustomEvent('hoplanes:say', { detail: h + ' ' + sub }));   // the announcer (panels.js): the banner is not a live region
  clearTimeout(menuNote);
  menuNote = setTimeout(() => { if (G.state === 'attract') setBanner(''); }, ms);
}
function prizeMachine() {
  if (G.state !== 'attract') return;
  const left = PRIZES.filter(k => !owned.has(k));
  if (!left.length) return;
  if (G.bank < PRIZE_COST) { sfx.nope(); flashBanner(t('NEED {n} COINS', { n: PRIZE_COST }), t('COLLECT THEM ON THE ROAD'), 1400); return; }
  setBank(G.bank - PRIZE_COST);
  const key = left[Math.floor(Math.random() * left.length)];
  owned.add(key); save(OWNED_KEY, [...owned].join(','));
  const idx = CHARACTERS.findIndex(c => c.key === key);
  players[0].charIndex = idx; save(PICK_KEY + 0, key);
  sfx.prize();
  flashBanner(t('YOU GOT {name}!', { name: t(CHARACTERS[idx].name) }), t('IT IS NOW PLAYER 1'), 2200);
  updatePrize();
  setCards();
}
$('prize').addEventListener('click', () => { audio(); prizeMachine(); });
setModeLabel();   // the world is built once, by toAttract at boot
updatePrize();
setHandicap(G.handicap);
showMissions();


// the come-back bonus: the first title of a day pays coins, more for days in a row (missions.js comebackBonus; the
// count is kept like the daily streak). A brand new player (no best yet) only starts the count; a replay link waits
function payComeback() {
  const day = today(), saved = loadText(VISIT_KEY);
  if (G.replay || saved.split('|')[0] === day) return;
  const visit = streakAfter(saved, day, dayBefore());
  save(VISIT_KEY, visit);
  if (!G.bestAll) return;
  const days = Number(visit.split('|')[1]) || 1, coins = comebackBonus(days);
  setBank(G.bank + coins);
  sfx.prize();
  flashBanner(t('WELCOME BACK!'), days > 1 ? t('+{n} COINS · DAY {d} IN A ROW', { n: coins, d: days }) : t('+{n} COINS', { n: coins }), 3200);
}
function toAttract() {
  G.state = 'attract'; G.stateT = 0; G.camRow = 0; G.biomeBlock = 0;
  // a restart from the pause menu skips endPlay: the run's coins are saved and the play look ends here too
  flushBank(); stopPlayLoop(); keepAwake(false); G.hint = false;
  players.forEach(p => { p.joined = false; despawn(p); });
  G.twoUp = false;
  resetRules();   // no bomb carries over (its rocks go before the lanes do)
  stopGhost();
  buildWorld();
  refreshBests();
  resultsEl.hidden = true; $('logo').hidden = false;
  setAppState(false, false, false);
  $('score1').hidden = $('score2').hidden = true;
  $('share').textContent = t('SHARE');
  $('replayBtn').textContent = t('REPLAY LINK');
  $('replayBtn').hidden = true;
  $('shareText').hidden = true;
  $('resBest').hidden = true;
  $('replayTag').hidden = !G.replay;
  setBanner('');
  setCards();
  payComeback();
}
// cover the screen, build the new world under the cover, then fade back in. who: the players who join at once (a
// retry); a retry of a one-player game counts down quickly
const wipe = $('wipe');
function restart(who = []) {
  if (G.restarting) return;
  const solo = players.filter(p => p.joined).length === 1;
  if (G.replay) {   // the replay has played: the next game is a normal one, in the player's own mode and animals
    G.replay = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    G.mode = savedMode(); setModeLabel();
    restorePicks();
  }
  G.restarting = true;
  wipe.classList.add('on');
  setTimeout(() => {
    toAttract();
    G.quickStart = solo && who.length === 1;
    who.forEach(join);
    G.quickStart = false;
    requestAnimationFrame(() => { wipe.classList.remove('on'); G.restarting = false; });
  }, reduceMotion ? 0 : WIPE_MS);
}
// on the results: PLAY AGAIN (the same players join again), or a tap or key of one player (that one joins); MENU goes
// to the title. A tap counts once the results have shown for RETRY_AFTER (no accidental retry)
const canRetry = () => G.state === 'over' && G.resultsT >= RETRY_AFTER && !G.restarting;
function playAgain(i) {
  if (!canRetry()) return false;
  const again = G.replay ? [] : players.filter(p => p.joined).map(p => p.id);
  restart(G.replay || i === undefined ? again : [i]);   // after a replay nobody rejoins: the button says MENU
  return true;
}
function toMenu() {
  if (G.state !== 'over' || G.resultsT < 0 || G.restarting) return;
  sfx.tick();
  restart();
}
$('again').addEventListener('click', () => { audio(); playAgain(); });
$('toMenu').addEventListener('click', () => { audio(); toMenu(); });
function join(i) {
  const p = players[i];
  if (p.joined) return;
  const ch = charOf(p);
  if (!isOwned(ch) && !G.replay) {                      // a locked character: buy it with coins, or no join
    if (ch.prize || G.bank < ch.price) { sfx.nope(); shakeCard(i); return; }   // a prize comes only from the prize machine
    setBank(G.bank - ch.price);
    owned.add(ch.key); save(OWNED_KEY, [...owned].join(','));
    sfx.buy();
  }
  p.joined = true; sfx.join();
  stopTune();
  // the handicap of this run is fixed at the first join: a later change in the settings is for the next game
  if (G.state === 'attract') G.runHandicap = G.replay ? G.replay.handicap : G.handicap;
  document.dispatchEvent(new Event('hoplanes:join'));   // panels.js closes an open dialog
  spawn(p);
  if (players[0].joined && players[1].joined) { G.twoUp = true; refreshPowerLooks(); }
  // from the title 3 s (a second player may still join); a retry of a one-player game READY, GO! in 1 s; a second
  // player joining gives both at least JOIN_COUNTDOWN
  if (G.state === 'attract') { G.state = 'countdown'; G.countdown = G.quickStart ? SOLO_COUNTDOWN : COUNTDOWN; G.countFrom = G.countdown; }
  else { G.countdown = Math.max(G.countdown, JOIN_COUNTDOWN); G.countFrom = COUNTDOWN; }
  $('logo').hidden = true;
  setCards();
}
function startPlay() {
  G.state = 'play'; G.playT = 0; G.playTick = 0; G.goT = GO_TIME; G.biomeBlock = 0; sfx.go();
  G.run = emptyStats(); G.record = []; G.moves = 0;
  // the world clock at the start is part of the run: a replay starts on the same tick
  if (G.replay) { G.replay.i = 0; G.worldTick = G.replay.startTick; }
  G.rules = G.replay ? G.replay.version : RULES;   // a replay plays with the rules it was played with
  G.startTick = G.worldTick;
  setAppState(true, false, false);
  resetFrameWatch();
  keepAwake(true);
  startGhost();
  startPlayLoop();
  G.hint = !G.replay && loadText(HINT_KEY) !== '1';   // first run: the guided hints (app.js draws them)
  G.hintTurn = false;
  setBanner(t('GO!'));
  players.forEach((p, i) => { $('score' + (i + 1)).hidden = !p.joined; });
  setCards();
}

// ---------- pause (phone call, app switch, the P key or the II button) ----------
let pausedFrom = '';
function pauseGame() {
  if (G.state !== 'play' && G.state !== 'countdown') return;
  pausedFrom = G.state; G.state = 'paused'; G.redraw = true;
  keepAwake(false);
  stopPlayLoop();
  setBanner(t('PAUSED'), t(touchQuery.matches ? 'TAP TO CONTINUE' : 'PRESS ANY KEY'));
  $('pauseBox').hidden = false;   // the pause menu (panels.js labels it)
  document.dispatchEvent(new Event('hoplanes:pause'));
}
function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = pausedFrom; G.goT = 0; G.countKey = '';   // the countdown number is drawn again
  setBanner('');
  $('pauseBox').hidden = true;
  if (G.state === 'play') { keepAwake(true); startPlayLoop(); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------- install hint (home screen) ----------
// Android fires beforeinstallprompt; iPhone has no event, so Safari gets a one-time text hint instead.
// Only on the served page (the offline file has no manifest) and not once installed.
const installBtn = $('install');
let installEvent = null;
function canHint() {
  return !!document.querySelector('link[rel="manifest"]') && !matchMedia('(display-mode: standalone)').matches
    && !navigator.standalone && loadText(INSTALL_KEY) !== '1';
}
function hintDone() { installBtn.hidden = true; save(INSTALL_KEY, 1); }
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (!canHint()) return;
  installEvent = e; installBtn.hidden = false;
});
const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
if (iosSafari && canHint()) installBtn.hidden = false;
installBtn.addEventListener('click', () => {
  sfx.tick();
  if (installEvent) { installEvent.prompt(); installEvent = null; hintDone(); return; }
  flashBanner(t('ADD TO HOME SCREEN'), t('TAP SHARE IN SAFARI, THEN "ADD TO HOME SCREEN"'), 4000);
  hintDone();
});

// ---------- first-run help ----------
const howto = $('howto');
function showHowto() {
  howto.querySelector('p').textContent = t(touchQuery.matches
    ? 'Tap the game to hop forward.\nSwipe to move left, right or back.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!'
    : 'Player 1: W A S D.  Player 2: arrow keys.\nCollect coins to unlock animals.\nStand still too long and the eagle gets you!');
  howto.hidden = false;
  try { $('gotit').focus({ preventScroll: true }); } catch (e) {}   // keyboard users land on the button
}
function hideHowto() {
  if (howto.hidden) return false;
  howto.hidden = true;
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch (e) {}
  return true;
}
$('gotit').addEventListener('click', hideHowto);


export { MODE_NAME, MODE_NOTE, TWO_UP_MODES, askCode, pickMode, runDay, setAppState, setCards, setLook, setModeLabel, canRetry, cycleChar, hideHowto, join, pauseGame, playAgain, restart, resultsEl, resumeGame, setBanner, showHowto, startPlay, toAttract, toMenu };
