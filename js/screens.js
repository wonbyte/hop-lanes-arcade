import { audio, isMuted, setMuted, sfx, startPlayLoop, stopPlayLoop, stopTune } from './audio.js';
import { $, COUNTDOWN, FIXED_SEED, G, GO_TIME, MODES, PRIZE_COST, RETRY_AFTER, SCORES_TOKEN, SCORES_URL, SOLO_COUNTDOWN, WIPE_MS } from './core.js';
import { nextLang, setLang, t } from './i18n.js';
import { DAILY, DAILY_REWARD, MISSION_REWARD, advanceMissions, carriedText, carryCoins, dailyDoneText, dailyMissions, doneCarried, doneDaily, emptyStats, missionAt, missionValue, missionsText, newMissions, parseCarried, parseDailyDone, parseMissions } from './missions.js';
import { encodeReplay } from './replay.js';
import { DAY_PREFIX, RULES, dailySeedFor, dayBefore, hatFor, streakAfter, traitOf } from './rules.js';
import { runOver, topScore, winnerOf } from './sim.js';
import { keepAwake } from './device.js';
import { marquee, reduceMotion, resetFrameWatch, stage, touchQuery } from './gfx.js';
import { CHARACTERS, PIX, PRIZES, drawPix, isOwned } from './models.js';
import { charOf, despawn, onGameOver, players, resetRules, restorePicks, spawn } from './players.js';
import { BEST_KEY, DAILYDONE_KEY, DAILY_KEY, HANDICAP_KEY, HINT_KEY, HOWTO_KEY, INITIALS_KEY, LOCAL_KEY, MCOINS_KEY, MDONE_KEY, STREAK_KEY, INSTALL_KEY, MISSIONS_KEY, MODE_KEY, OWNED_KEY, PICK_KEY, ROOM_KEY, TIPS_KEY, cleanInitials, dayKey, deviceTag, entersLocal, flushBank, load, loadText, localTop, owned, parseLocal, refreshBests, save, savedMode, setBank, today } from './storage.js';
import { getSeed, refreshPowerLooks, resetWorld } from './world.js';
import { saveGhost, startGhost, stopGhost } from './ghost.js';

// Screens and flow: join cards and the shop, countdown, results, restart, pause, first-run help, online scores.
// ---------- screens ----------
let bannerKey = '';
const banner = $('banner'), bannerH = banner.querySelector('h2'), bannerP = banner.querySelector('p');
const resultsEl = $('results'), app = $('app');
function setBanner(h, sub = '') {
  const key = h + '|' + sub;
  if (key === bannerKey) return;      // only touch the DOM when the text changes
  bannerKey = key;
  banner.hidden = !h;
  bannerH.textContent = h; bannerP.textContent = sub;
}
// the top bar is slimmer during play: the score chips and the logo sit under it, whatever its height (one layout read
// per state change)
const fitTopBar = () => stage.style.setProperty('--marquee-h', marquee.offsetHeight + 'px');
// a state class on #app for the CSS: playing, over (the run has ended), results (the panel shows)
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
  if (p.shownChar !== ch.key) { drawPix($('pic' + (i + 1)), PIX[ch.key]); p.shownChar = ch.key; }
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
  void c.offsetWidth;   // restart the animation
  c.classList.add('shake');
}
const menu = $('menu');
const setCards = () => { setCard(0); setCard(1); menu.hidden = G.state !== 'attract'; };

// ---------- in-page questions: the room code and the initials (panels.js shows the letter slots) ----------
// done(code) gets the letters, or null when the question was closed
const askCode = (title, len, value, done) => document.dispatchEvent(new CustomEvent('hoplanes:ask', { detail: { title, len, value, done } }));

// ---------- title menu: game mode, room code, prize machine, handicap, language, missions ----------
const MODE_TEXT = { classic: 'MODE: CLASSIC', race: 'MODE: RACE', coinwar: 'MODE: COIN WAR', tag: 'MODE: TAG', daily: 'MODE: DAILY' };
// one short line under the button: what the mode is
const MODE_NOTE = { classic: 'HOP AS FAR AS YOU CAN', race: 'FIRST TO FALL LOSES', coinwar: 'MOST COINS WINS', tag: 'THE ONE BEHIND HOPS FASTER', daily: 'ONE WORLD FOR ALL TODAY', room: 'SAME CODE, SAME WORLD' };
function setModeLabel() {
  $('modeText').textContent = G.mode === 'room' ? t('ROOM: {code}', { code: G.room }) : t(MODE_TEXT[G.mode]);
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
const modeAfter = (mode, d) => MODES[(MODES.indexOf(mode) + d + MODES.length) % MODES.length];
// d: +1 the next mode, -1 the one before; room mode asks for its code first (closed: the mode after it)
function cycleMode(d) {
  sfx.tick();
  const mode = modeAfter(G.mode, d);
  if (mode !== 'room') { setMode(mode); return; }
  askCode(t('ROOM CODE'), 4, (G.room || randomCode()).slice(0, 4), code => {
    if (G.state !== 'attract') return;
    if (!code) { setMode(modeAfter('room', d)); return; }
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
// missions: three small goals; a done one pays coins and the next one takes its place. A new player (no missions saved,
// no best yet) starts with three easy ones; coin missions add up over runs (carried)
let missions = loadText(MISSIONS_KEY) || G.bestAll ? parseMissions(loadText(MISSIONS_KEY)) : newMissions();
let carried = parseCarried(loadText(MCOINS_KEY));
const MISSION_TEXT = { coins: 'COLLECT {n} COINS', row: 'REACH ROW {n}', rivers: 'CROSS {n} RIVERS', hops: 'HOP {n} TIMES', logs: 'RIDE {n} LOGS', combo: 'COMBO OF {n}', powers: 'GRAB A POWER-UP', secrets: 'FIND A HIDDEN COIN', nears: '{n} NEAR MISSES' };
// the short name of a mission for the progress line on the results ("ROW 30: 22/30")
const MISSION_SHORT = { coins: 'COINS {n}', row: 'ROW {n}', rivers: 'RIVERS {n}', hops: 'HOPS {n}', logs: 'LOGS {n}', combo: 'COMBO {n}', powers: 'POWER-UP', secrets: 'HIDDEN COIN', nears: 'NEAR MISSES {n}' };
const missionLabel = m => t(m.goal === 1 && m.stat === 'nears' ? '1 NEAR MISS' : MISSION_TEXT[m.stat], { n: m.goal });
// a coin mission says how far it has come over the runs before
const missionLine = i => missionLabel(missionAt(i)) + (carried[i] ? ' · ' + carried[i] + '/' + missionAt(i).goal : '');
// missions done today (the chip on the title counts up to 3 a day)
const doneToday = () => { const [d, n] = loadText(MDONE_KEY).split('|'); return d === today() ? Math.min(3, Number(n) || 0) : 0; };
function showMissions() {
  const box = $('missions');
  box.querySelector('h3').textContent = t('MISSIONS');
  box.querySelectorAll('li').forEach((li, k) => { li.textContent = missionLine(missions.active[k]); });
  showDailyMissions();
}
// daily missions: the same three for everyone on a day (missions.js picks them from the date); a done one gets a check mark
function showDailyMissions() {
  const day = today(), picks = dailyMissions(day), mask = parseDailyDone(loadText(DAILYDONE_KEY), day);
  const box = $('dayMissions');
  box.querySelector('h3').textContent = t("TODAY'S MISSIONS");
  box.querySelectorAll('li').forEach((li, k) => { li.textContent = missionLabel(DAILY[picks[k]]); li.classList.toggle('done', !!(mask & (1 << k))); });
  const daily = [0, 1, 2].filter(k => mask & (1 << k)).length;
  $('chipMissions').textContent = t('MISSIONS {n}/3', { n: doneToday() });
  $('chipToday').textContent = t('TODAY {n}/3', { n: daily });
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
function payMissions() {   // at game over: which missions this run finished (coins carried over runs); returns the note text
  const done = doneCarried(missions, G.run, carried);
  carried = carryCoins(missions, G.run, carried);
  save(MCOINS_KEY, carriedText(carried));
  if (!done.length) return '';
  const text = done.map(i => missionLabel(missionAt(i))).join(' + ');
  missions = advanceMissions(missions, done);
  save(MISSIONS_KEY, missionsText(missions));
  save(MDONE_KEY, today() + '|' + (doneToday() + done.length));
  setBank(G.bank + MISSION_REWARD * done.length);
  showMissions();
  return t('MISSION DONE +{n}', { n: MISSION_REWARD * done.length }) + ': ' + text + '. ';
}
// before the payout: how far this run took each active mission ("ROW 30: 22/30")
const missionProgress = () => missions.active.map(i => {
  const m = missionAt(i);
  return t(MISSION_SHORT[m.stat], { n: m.goal }) + ': ' + Math.min(m.goal, missionValue(i, G.run, carried)) + '/' + m.goal;
}).join(' · ');
// everything that shows text in the current language
function refreshTexts() {
  setModeLabel(); updatePrize(); setHandicap(G.handicap); showMissions(); setCards(); setMuted(isMuted());
  document.dispatchEvent(new Event('hoplanes:lang'));   // panels.js relabels its buttons
  if (G.state === 'over') { $('share').textContent = t('SHARE'); setRetryHint(); }
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
// the mode button has its arrows inside: a click on the left third goes back, anywhere else on
$('mode').addEventListener('click', e => {
  audio();
  const r = $('mode').getBoundingClientRect();
  cycleMode(e.detail && e.clientX < r.left + r.width / 3 ? -1 : 1);
});
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
  restart(i === undefined ? again : [i]);
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
  // player joining gives both at least 2.5 s
  if (G.state === 'attract') { G.state = 'countdown'; G.countdown = G.quickStart ? SOLO_COUNTDOWN : COUNTDOWN; G.countFrom = G.countdown; }
  else { G.countdown = Math.max(G.countdown, 2.5); G.countFrom = COUNTDOWN; }
  $('logo').hidden = true;
  setCards();
}
function startPlay() {
  G.state = 'play'; G.playT = 0; G.playTick = 0; G.goT = GO_TIME; G.biomeBlock = 0; sfx.go();
  G.run = emptyStats(); G.record = [];
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
// this run as a replay code: the seed, the mode, the animals, the handicap, the start tick and every hop
const runCode = () => encodeReplay({ version: G.rules, seed: getSeed(), mode: G.mode, chars: players.map(q => charOf(q).key), joined: players.map(q => q.joined), handicap: G.runHandicap, startTick: G.startTick, events: G.record });
let overN = 0;   // which game over this is: a server answer that comes late must not label the next game's results
// the records this run set: the all-time best, today's best, the daily challenge best, the streak; returns the note
function saveRecords(top) {
  let note = '';
  {
    if (top > G.bestAll) { G.bestAll = top; save(BEST_KEY, top); note = 'NEW ALL TIME BEST!'; }
    const day = runDay();   // a daily run counts for the day of its world
    if (G.mode === 'daily') save(STREAK_KEY, streakAfter(loadText(STREAK_KEY), day, dayBefore(new Date(day + 'T12:00:00'))));
    if (top > load(dayKey())) { save(dayKey(), top); note = note || 'NEW BEST TODAY!'; }
    if (G.mode === 'daily') {
      const k = DAILY_KEY + DAY_PREFIX + day;
      if (top > load(k)) { save(k, top); if (!note.includes('ALL TIME')) note = 'NEW DAILY CHALLENGE BEST!'; }   // an all-time best keeps its confetti
      else note = t('DAILY CHALLENGE BEST {n}.', { n: load(k) }) + ' ' + note;
    }
  }
  refreshBests();
  return note;
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
const BEST_MIN = 10;   // a new best below this gets no ribbon and no confetti (a first run of 2 rows is no party)
// a new best gets its own ribbon, a jingle and (all time) confetti; returns the note without it
function showBest(note, top) {
  const best = /^NEW .*BEST!/.exec(note.replace(/^.*\. /, ''));
  $('resBest').hidden = !best || top < BEST_MIN;
  if (!best) { sfx.over(); return note; }
  const rest = note.replace(best[0], '').replace(/^ +| +$/g, '');
  if (top < BEST_MIN) { sfx.over(); return rest; }
  $('resBest').textContent = t(best[0]);
  if (best[0].includes('ALL TIME')) { party = true; sfx.best(); } else sfx.cheer();
  return rest;
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
  try { seen = JSON.parse(loadText(TIPS_KEY) || '{}') || {}; } catch (e) {}
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
  let note = replay ? '' : saveRecords(top);
  // who wins: in a race the one still standing (or the higher score), otherwise the higher score
  const winner = winnerOf(players, G.mode);   // sim.js: race, coin war or the higher score
  note = modeNote(note, both, winner);
  $('resTitle').textContent = resultTitle(replay, both, winner);
  const scorer = scorerOf(players, top, winner);
  const code = shareTexts(scorer, top, replay);   // the replay code: the seed, the animals and every hop of this run
  saveGhost(code, top, scorer.id);   // daily and room worlds: the best run comes back as a ghost
  note = showBest(note, top);
  const info = { cause: causeLine(both), tip: tipLine(replay), stats: statsLine(replay) };
  if (!replay) note = payMissions() + payDaily() + note;
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
async function postScore(name, score, code, gameN) {
  if (!SCORES_URL || !window.fetch) return;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const daily = G.mode === 'daily', day = runDay();   // a daily run is posted with the day of its world
    const res = await fetch(SCORES_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(SCORES_TOKEN ? { 'X-Hop-Token': SCORES_TOKEN } : {}) },
      // the run's replay code (the one in the replay link): a server with VERIFY=1 plays it again to check the score
      body: JSON.stringify({ name, score, day, mode: G.mode, replay: code }), signal: ctrl.signal
    });
    if (!res.ok) return;
    let top = (await res.json()).top;
    // daily mode compares with everyone who played today's world
    if (daily) {
      const u = new URL(SCORES_URL, location.href);   // the server address may carry a query of its own
      u.searchParams.set('day', day); u.searchParams.set('mode', 'daily');
      top = (await (await fetch(u, { signal: ctrl.signal })).json()).top;
    }
    if (Array.isArray(top) && top.length && G.state === 'over' && gameN === overN) {   // still the game that posted
      // nosemgrep: no-stringify-keys -- $ is getElementById here; nothing is stringified
      $('world').textContent = t(daily ? 'TODAY TOP {n} · {name}' : 'WORLD BEST {n} · {name}', { n: top[0].score, name: top[0].name });
      $('world').hidden = false;
    }
  } catch (e) { /* offline, blocked by the page policy, or no server: nothing to show */ }
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

onGameOver(checkOver);   // players.js calls it when the rules end the game

export { setLook, setModeLabel, banner, canRetry, confetti, cycleChar, hideHowto, howto, join, menu, pads, pauseGame, playAgain, restart, resultsEl, resumeGame, revealResults, setBanner, showHowto, startPlay, toAttract, toMenu, wipe };
