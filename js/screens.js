import { audio, isMuted, setMuted, sfx, startPlayLoop, startTune, stopPlayLoop, stopTune } from './audio.js';
import { $, COUNTDOWN, G, GO_TIME, MODES, PRIZE_COST, SCORES_TOKEN, SCORES_URL, WIPE_MS } from './core.js';
import { nextLang, setLang, t } from './i18n.js';
import { DAILY, DAILY_REWARD, MISSIONS, MISSION_REWARD, advanceMissions, dailyDoneText, dailyMissions, doneDaily, doneMissions, emptyStats, missionsText, parseDailyDone, parseMissions } from './missions.js';
import { encodeReplay } from './replay.js';
import { dayBefore, hatFor, streakAfter, traitOf } from './rules.js';
import { runOver, topScore, winnerOf } from './sim.js';
import { keepAwake } from './device.js';
import { reduceMotion, resetFrameWatch, touchQuery } from './gfx.js';
import { CHARACTERS, PIX, PRIZES, drawPix, isOwned } from './models.js';
import { charOf, despawn, players, restorePicks, spawn } from './players.js';
import { BEST_KEY, DAILYDONE_KEY, DAILY_KEY, HANDICAP_KEY, HINT_KEY, HOWTO_KEY, INITIALS_KEY, LOCAL_KEY, STREAK_KEY, INSTALL_KEY, MISSIONS_KEY, MODE_KEY, OWNED_KEY, PICK_KEY, ROOM_KEY, cleanInitials, dayKey, deviceTag, entersLocal, flushBank, load, loadText, localTop, owned, parseLocal, refreshBests, save, savedMode, setBank, today } from './storage.js';
import { getSeed, resetWorld } from './world.js';
import { saveGhost, startGhost, stopGhost } from './ghost.js';

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
const joinText = () => t(touchQuery.matches ? 'TAP THIS\nSIDE TO JOIN' : 'PRESS TAP\nTO JOIN');
function setCard(i) {
  const c = $('card' + (i + 1)), p = players[i], ch = charOf(p), locked = !isOwned(ch);
  pads[i].classList.toggle('idle', (G.state === 'play' || G.state === 'over') && !p.joined);
  c.classList.toggle('ready', p.joined && G.state === 'countdown');
  c.classList.toggle('locked', locked && !p.joined);
  c.style.visibility = G.state === 'play' || G.state === 'over' ? 'hidden' : 'visible';
  if (p.shownChar !== ch.key) { drawPix($('pic' + (i + 1)), PIX[ch.key]); p.shownChar = ch.key; }
  const head = c.querySelector('.head'), st = c.querySelector('.state');
  if (p.joined) { head.textContent = t('READY!'); st.textContent = t('PLAYER {n}', { n: i + 1 }); }
  else if (locked) { head.textContent = G.bank >= ch.price ? t('TAP TO BUY') : t('NEED {n} COINS', { n: ch.price }); st.textContent = t('{name} · {n} COINS', { name: t(ch.name), n: ch.price }); }
  else { head.textContent = joinText(); st.textContent = t(ch.name) + ' \u00b7 ' + t(traitOf(ch.key).text || 'BALANCED'); }
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

// ---------- title menu: game mode, room code, prize machine, handicap, language, missions ----------
const MODE_TEXT = { classic: 'MODE: CLASSIC', race: 'MODE: RACE', coinwar: 'MODE: COIN WAR', tag: 'MODE: TAG', daily: 'MODE: DAILY' };
const setModeLabel = () => { $('mode').textContent = G.mode === 'room' ? t('ROOM: {code}', { code: G.room }) : t(MODE_TEXT[G.mode]); };
function setMode(mode) {
  G.mode = mode;
  save(MODE_KEY, mode);
  setModeLabel();
  if (G.state === 'attract') resetWorld();   // daily and room modes have their own seeds
}
// an unlocked look (settings): the land starts as a far biome or at night; the title world is built again in it
function setLook(key) {
  G.look = key;
  if (G.state === 'attract') resetWorld();
}
// room mode: two phones that enter the same code play the same world (seed = the code)
const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
function askRoom() {
  let code = null;
  try { code = window.prompt(t('ROOM CODE (4 LETTERS)'), G.room || randomCode()); } catch (e) {}
  code = code === null ? '' : code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) return false;
  G.room = code; save(ROOM_KEY, code);
  return true;
}
function cycleMode() {
  sfx.tick();
  let mode = MODES[(MODES.indexOf(G.mode) + 1) % MODES.length];
  if (mode === 'room' && !askRoom()) mode = MODES[0];
  setMode(mode);
}
function updatePrize() {
  const left = PRIZES.filter(k => !owned.has(k));
  const b = $('prize');
  b.disabled = !left.length;
  b.textContent = left.length ? t('PRIZE · {n} COINS', { n: PRIZE_COST }) : t('ALL PRIZES WON');
}
const HANDICAP_TEXT = ['HANDICAP: OFF', 'SHIELD: P1', 'SHIELD: P2'];
function setHandicap(n) { G.handicap = n; save(HANDICAP_KEY, n); $('handicap').textContent = t(HANDICAP_TEXT[n]); }
$('handicap').addEventListener('click', () => { audio(); sfx.tick(); setHandicap((G.handicap + 1) % 3); });
$('lang').addEventListener('click', () => { audio(); sfx.tick(); setLang(nextLang()); refreshTexts(); });
// missions: three small goals; a done one pays coins and the next one takes its place
let missions = parseMissions(loadText(MISSIONS_KEY));
const MISSION_TEXT = { coins: 'COLLECT {n} COINS IN ONE RUN', row: 'REACH ROW {n}', rivers: 'CROSS {n} RIVERS', hops: 'HOP {n} TIMES', logs: 'RIDE {n} LOGS', combo: 'COMBO OF {n}', powers: 'GRAB A POWER-UP', secrets: 'FIND A HIDDEN COIN', nears: '{n} NEAR MISSES' };
const missionLabel = m => t(MISSION_TEXT[m.stat], { n: m.goal });
const missionText = i => missionLabel(MISSIONS[i]);
function showMissions() {
  const box = $('missions');
  box.querySelector('h3').textContent = t('MISSIONS');
  box.querySelectorAll('li').forEach((li, k) => { li.textContent = missionText(missions.active[k]); });
  showDailyMissions();
}
// daily missions: the same three for everyone on a day (missions.js picks them from the date); a done one gets a check mark
function showDailyMissions() {
  const day = today(), picks = dailyMissions(day), mask = parseDailyDone(loadText(DAILYDONE_KEY), day);
  const box = $('dayMissions');
  box.querySelector('h3').textContent = t("TODAY'S MISSIONS");
  box.querySelectorAll('li').forEach((li, k) => { li.textContent = missionLabel(DAILY[picks[k]]); li.classList.toggle('done', !!(mask & (1 << k))); });
}
function payDaily() {   // at game over: which of today's missions this run finished for the first time; returns the note text
  const day = today(), picks = dailyMissions(day);
  let mask = parseDailyDone(loadText(DAILYDONE_KEY), day);
  const done = doneDaily(picks, mask, G.run);
  if (!done.length) return '';
  for (const k of done) mask |= 1 << k;
  save(DAILYDONE_KEY, dailyDoneText(day, mask));
  setBank(G.bank + DAILY_REWARD * done.length);
  showDailyMissions();
  return t('DAILY MISSION DONE +{n}', { n: DAILY_REWARD * done.length }) + ': ' + done.map(k => missionLabel(DAILY[picks[k]])).join(' + ') + '. ';
}
// the best 10 runs on this device (panels.js lists them): the first run that makes it asks for the player's initials
function enterLocal(name, score) {
  const list = parseLocal(loadText(LOCAL_KEY));
  if (!entersLocal(list, score)) return;
  let initials = cleanInitials(loadText(INITIALS_KEY));
  if (!initials) {
    try { initials = cleanInitials(window.prompt(t('YOUR INITIALS (3 LETTERS)'), deviceTag.slice(0, 3))); } catch (e) {}
    if (!initials) initials = deviceTag.slice(0, 3);
    save(INITIALS_KEY, initials);
  }
  save(LOCAL_KEY, JSON.stringify(localTop(list, { name: initials + ' ' + name, score, day: today(), mode: G.mode })));
}
function payMissions() {   // at game over: which missions this run finished; returns the note text
  const done = doneMissions(missions, G.run);
  if (!done.length) return '';
  const text = done.map(i => missionText(i)).join(' + ');
  missions = advanceMissions(missions, done);
  save(MISSIONS_KEY, missionsText(missions));
  setBank(G.bank + MISSION_REWARD * done.length);
  showMissions();
  return t('MISSION DONE +{n}', { n: MISSION_REWARD * done.length }) + ': ' + text + '. ';
}
// everything that shows text in the current language
function refreshTexts() {
  setModeLabel(); updatePrize(); setHandicap(G.handicap); showMissions(); setCards(); setMuted(isMuted());
  document.dispatchEvent(new Event('hoplanes:lang'));   // panels.js relabels its buttons
  if (G.state === 'over') $('share').textContent = t('SHARE');
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
$('mode').addEventListener('click', () => { audio(); cycleMode(); });
$('prize').addEventListener('click', () => { audio(); prizeMachine(); });
setModeLabel();   // the world is built once, by toAttract at boot
updatePrize();
setHandicap(G.handicap);
showMissions();

// ---------- share, replay link and confetti ----------
let shareText = '', replayText = '';
// Share sheet where it works, clipboard where it does not, and as a last resort the text itself, selected.
// Both the share call and the clipboard write must happen in the tap itself (Safari refuses them a moment later),
// so the clipboard write starts at once and its result is used only if the share sheet is refused.
function shareOut(b, text, sheet) {
  let copied;
  try { copied = navigator.clipboard.writeText(text).then(() => true, () => false); }
  catch (e) { copied = Promise.resolve(false); }
  const finish = async shared => {
    if (shared) { b.textContent = t('SHARED!'); return; }
    if (await copied) { b.textContent = t(sheet ? 'COPIED!' : 'REPLAY LINK COPIED!'); return; }
    const box = $('shareText');                     // nothing automatic works here: let the player copy by hand
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

function toAttract() {
  G.state = 'attract'; G.stateT = 0; G.camRow = 0;
  players.forEach(p => { p.joined = false; despawn(p); });
  stopGhost();
  resetWorld();
  refreshBests();
  resultsEl.hidden = true; $('logo').hidden = false;
  $('score1').hidden = $('score2').hidden = true;
  $('share').textContent = t('SHARE');
  $('replayBtn').textContent = t('COPY REPLAY LINK');
  $('replayBtn').hidden = true;
  $('shareText').hidden = true;
  $('resBest').hidden = true;
  $('replayTag').hidden = !G.replay;
  setBanner('');
  setCards();
}
// cover the screen, build the new world under the cover, then fade back in
const wipe = $('wipe');
function restart(joinPlayer) {
  if (G.restarting) return;
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
    if (joinPlayer !== undefined) join(joinPlayer);
    requestAnimationFrame(() => { wipe.classList.remove('on'); G.restarting = false; });
  }, reduceMotion ? 0 : WIPE_MS);
}
function join(i) {
  const p = players[i];
  if (p.joined) return;
  const ch = charOf(p);
  if (!isOwned(ch) && !G.replay) {                      // a locked character: buy it with coins, or no join
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
  G.state = 'play'; G.playT = 0; G.playTick = 0; G.goT = GO_TIME; sfx.go();
  G.run = emptyStats(); G.record = [];
  // the world clock at the start is part of the run: a replay starts on the same tick
  if (G.replay) { G.replay.i = 0; G.worldTick = G.replay.startTick; }
  G.startTick = G.worldTick;
  $('app').classList.add('playing');
  resetFrameWatch();
  keepAwake(true);
  startGhost();
  startPlayLoop();
  G.hint = !G.replay && loadText(HINT_KEY) !== '1';   // first run: the floating TAP hint (app.js draws it)
  setBanner(t('GO!'));
  players.forEach((p, i) => { $('score' + (i + 1)).hidden = !p.joined; });
  setCards();
}
// this run as a replay code: the seed, the mode, the animals, the handicap, the start tick and every hop
const runCode = () => encodeReplay({ seed: getSeed(), mode: G.mode, chars: players.map(q => charOf(q).key), joined: players.map(q => q.joined), handicap: G.handicap, startTick: G.startTick, events: G.record });
function checkOver() {
  if (G.state !== 'play') return;
  const [p1, p2] = players;
  const both = p1.joined && p2.joined, race = G.mode === 'race';
  if (!runOver(players, G.mode)) return;   // sim.js: a race ends at the first death, otherwise when nobody is left
  G.state = 'over'; G.stateT = 0;
  flushBank();
  stopPlayLoop();
  G.hint = false;
  $('app').classList.remove('playing');
  keepAwake(false);
  setBanner('');
  const top = topScore(players);
  let note = '';
  const replay = !!G.replay;   // a replay changes no records and pays nothing
  const hatBefore = hatFor(G.bestAll);
  if (!replay) {
    if (top > G.bestAll) { G.bestAll = top; save(BEST_KEY, top); note = 'NEW ALL TIME BEST!'; }
    if (G.mode === 'daily') save(STREAK_KEY, streakAfter(loadText(STREAK_KEY), today(), dayBefore()));
    if (top > load(dayKey())) { save(dayKey(), top); note = note || 'NEW BEST TODAY!'; }
    if (G.mode === 'daily') {
      const k = DAILY_KEY + dayKey();
      if (top > load(k)) { save(k, top); note = 'NEW DAILY CHALLENGE BEST!'; }
      else note = t('DAILY CHALLENGE BEST {n}.', { n: load(k) }) + ' ' + note;
    }
  }
  refreshBests();
  // who wins: in a race the one still standing (or the higher score), otherwise the higher score
  const winner = winnerOf(players, G.mode);   // sim.js: race, coin war or the higher score
  if (both && G.mode === 'coinwar') note = t('COINS {a} - {b}.', { a: p1.coins, b: p2.coins }) + ' ' + note;
  $('resTitle').textContent = replay ? t('REPLAY OVER') : !both ? t('GAME OVER') : !winner ? t('TIE GAME!') : t('{name} WINS!', { name: t(charOf(winner).name) });
  if (race && winner) note = t('BY {n} ROWS.', { n: Math.abs(p1.score - p2.score) }) + ' ' + note;
  const hero = winner || (p1.joined ? p1 : p2);
  const page = location.origin + location.pathname;
  shareText = t('I scored {n} in Hop Lanes as {name}!', { n: top, name: t(charOf(hero).name) }) + (G.mode === 'room' ? ' ' + t('Room {code}', { code: G.room }) + '.' : '') + ' ' + page;
  // the replay link: the seed, the animals and every hop of this run
  const code = !replay && G.record.length ? runCode() : '';
  const canReplay = !!code && location.protocol !== 'file:';
  if (canReplay) replayText = page + '#replay-' + code;
  saveGhost(code, top, hero.id);   // daily and room worlds: the best run comes back as a ghost
  $('replayBtn').hidden = !canReplay;
  // a new best gets its own big line, a jingle and (all time) confetti
  const best = top >= 1 && /^NEW .*BEST!/.exec(note.replace(/^.*\. /, ''));
  $('resBest').hidden = !best;
  if (best) {
    $('resBest').textContent = t(best[0]);
    note = note.replace(best[0], '').replace(/^ +| +$/g, '');
    if (best[0].includes('ALL TIME')) { confetti(); sfx.best(); } else sfx.cheer();
  } else sfx.over();
  if (!replay) note = payMissions() + payDaily() + note;
  if (!replay) enterLocal(charOf(hero).name, top);
  const hat = hatFor(G.bestAll);
  if (!replay && hat && hat !== hatBefore) note = t('NEW HAT: {name}!', { name: t(hat.name) }) + ' ' + note;
  $('res1').hidden = !p1.joined; $('res2').hidden = !p2.joined;
  $('res1').querySelector('span').textContent = t(charOf(p1).name);
  $('res2').querySelector('span').textContent = t(charOf(p2).name);
  $('world').hidden = true;
  if (!replay) postScore(charOf(hero).name + ' ' + deviceTag, top);   // the server keeps one entry per name
  $('res1').querySelector('b').textContent = p1.score;
  $('res2').querySelector('b').textContent = p2.score;
  $('resNote').textContent = (note ? note + ' ' : '') + t('PRESS TAP TO PLAY AGAIN');
}

// optional online score list: silent when no server is set or it can not be reached
async function postScore(name, score) {
  if (!SCORES_URL || !window.fetch) return;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const daily = G.mode === 'daily';
    const res = await fetch(SCORES_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(SCORES_TOKEN ? { 'X-Hop-Token': SCORES_TOKEN } : {}) },
      // the run's replay code (the one in the replay link): a server with VERIFY=1 plays it again to check the score
      body: JSON.stringify({ name, score, day: today(), mode: G.mode, replay: runCode() }), signal: ctrl.signal
    });
    if (!res.ok) return;
    let top = (await res.json()).top;
    // daily mode compares with everyone who played today's world
    if (daily) {
      const u = new URL(SCORES_URL, location.href);   // the server address may carry a query of its own
      u.searchParams.set('day', today()); u.searchParams.set('mode', 'daily');
      top = (await (await fetch(u, { signal: ctrl.signal })).json()).top;
    }
    if (Array.isArray(top) && top.length && G.state === 'over') {
      $('world').textContent = t(daily ? 'TODAY TOP {n} · {name}' : 'WORLD BEST {n} · {name}', { n: top[0].score, name: top[0].name });
      $('world').hidden = false;
    }
  } catch (e) { /* offline, blocked by the page policy, or no server: nothing to show */ }
}

// ---------- pause (phone call, app switch, or the P key) ----------
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

export { setLook, setModeLabel, askRoom, enterLocal, payDaily, showDailyMissions, banner, bannerH, bannerKey, bannerP, checkOver, confetti, cycleChar, cycleMode, hideHowto, howto, join, joinText, menu, pads, pauseGame, pausedFrom, payMissions, postScore, prizeMachine, refreshTexts, restart, resultsEl, resumeGame, setBanner, setCard, setCards, setHandicap, setMode, shakeCard, shareOut, shareScore, showHowto, showMissions, startPlay, toAttract, updatePrize, wipe };
