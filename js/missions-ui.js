import { $, G } from './core.js';
import { t } from './i18n.js';
import { ACTIVE, DAILY, DAILY_COUNT, DAILY_REWARD, MISSION_REWARD, advanceMissions, carriedText, carryCoins, dailyDoneText, dailyMissions, doneCarried, doneDaily, missionAt, missionValue, missionsText, newMissions, parseCarried, parseDailyDone, parseMissions } from './missions.js';
import { DAILYDONE_KEY, MCOINS_KEY, MDONE_KEY, MISSIONS_KEY, loadText, save, setBank, today } from './storage.js';

// The missions on screen: the active three and today's three (missions.js decides them), their texts, the progress
// line on the results and the payouts at game over (results.js checkOver). The title's chip opens the lists (panels.js).
// ---------- missions ----------
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
const doneToday = () => { const [d, n] = loadText(MDONE_KEY).split('|'); return d === today() ? Math.min(ACTIVE, Number(n) || 0) : 0; };
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
  let daily = 0;
  for (let k = 0; k < DAILY_COUNT; k++) if (mask & (1 << k)) daily++;
  $('chipMissions').textContent = t('MISSIONS {n}/3', { n: doneToday() });
  $('chipToday').textContent = t('TODAY {n}/3', { n: daily });
}
function payDaily(day) {   // at game over: which of the day's missions this run finished for the first time; returns the note text
  const picks = dailyMissions(day);   // day: the run's day (results.js runDay: a daily run on a world built before midnight pays that day's missions)
  let mask = parseDailyDone(loadText(DAILYDONE_KEY), day);
  const done = doneDaily(picks, mask, G.run);
  if (!done.length) return '';
  for (const k of done) mask |= 1 << k;
  save(DAILYDONE_KEY, dailyDoneText(day, mask));
  setBank(G.bank + DAILY_REWARD * done.length);
  showDailyMissions();
  return t('DAILY MISSION DONE +{n}', { n: DAILY_REWARD * done.length }) + ': ' + done.map(k => missionLabel(DAILY[picks[k]])).join(' + ') + '. ';
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
// before the payout: how far this run took each active mission, one row each on the results ("ROW 30", 22 of 30).
// results.js draws them as a short list with a bar, so the panel reads at a glance instead of one long line
const missionRows = () => missions.active.map(i => {
  const m = missionAt(i);
  return { label: t(MISSION_SHORT[m.stat], { n: m.goal }), have: Math.min(m.goal, missionValue(i, G.run, carried)), goal: m.goal };
});

export { missionRows, payDaily, payMissions, showMissions };
