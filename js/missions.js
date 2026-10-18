import { hashString, mulberry32 } from './rules.js';

// Missions: small goals that pay coins. Three are active; a finished one is replaced by the next.
// Pure: the list and the checks. screens.js shows them and pays out.
const MISSION_REWARD = 20;
// stat: a field of the run stats (players.js G.run); goal: the value to reach in one run
const MISSIONS = [
  { key: 'coins10', stat: 'coins', goal: 10 },
  { key: 'row30', stat: 'row', goal: 30 },
  { key: 'rivers5', stat: 'rivers', goal: 5 },
  { key: 'hops100', stat: 'hops', goal: 100 },
  { key: 'logs3', stat: 'logs', goal: 3 },
  { key: 'combo10', stat: 'combo', goal: 10 },
  { key: 'row60', stat: 'row', goal: 60 },
  { key: 'coins20', stat: 'coins', goal: 20 },
  { key: 'power1', stat: 'powers', goal: 1 },
  { key: 'rivers10', stat: 'rivers', goal: 10 },
  { key: 'hops200', stat: 'hops', goal: 200 },
  { key: 'row100', stat: 'row', goal: 100 },
  { key: 'coins30', stat: 'coins', goal: 30 },
  { key: 'secret1', stat: 'secrets', goal: 1 },
  { key: 'combo20', stat: 'combo', goal: 20 },
  { key: 'nears3', stat: 'nears', goal: 3 }
];
// easy ones for a new player only: they come after the list (index MISSIONS.length + k), so the indexes saved before
// stay valid, and they are never drawn again once done (next only walks MISSIONS)
const STARTER = [
  { key: 'row15', stat: 'row', goal: 15 },
  { key: 'logs2', stat: 'logs', goal: 2 },
  { key: 'nears1', stat: 'nears', goal: 1 }
];
const missionAt = i => (i < MISSIONS.length ? MISSIONS[i] : STARTER[i - MISSIONS.length]);
const ACTIVE = 3;
// saved as "next,a,b,c": the index the next new mission comes from, then the active indexes
function parseMissions(text) {
  const n = String(text || '').split(',').map(Number);
  const ok = (x, max) => Number.isInteger(x) && x >= 0 && x < max;
  if (n.length === ACTIVE + 1 && ok(n[0], MISSIONS.length) && n.slice(1).every(x => ok(x, MISSIONS.length + STARTER.length))) return { next: n[0], active: n.slice(1) };
  return { next: ACTIVE % MISSIONS.length, active: [0, 1, 2] };
}
// a player with no saved missions starts with the easy three, then the list from its start
const newMissions = () => ({ next: 0, active: STARTER.map((_, k) => MISSIONS.length + k) });
const missionsText = m => [m.next, ...m.active].join(',');
// the stats of a run: which active missions are now done
const doneMissions = (m, stats) => m.active.filter(i => (stats[missionAt(i).stat] || 0) >= missionAt(i).goal);
// coin missions add up over runs: carried[i] holds the coins mission i collected in earlier runs. The value of mission
// i after a run with these stats (for the progress line and the done check)
const missionValue = (i, stats, carried = {}) => (stats[missionAt(i).stat] || 0) + (missionAt(i).stat === 'coins' ? carried[i] || 0 : 0);
// the active missions done by this run, counting the coins carried from earlier runs
const doneCarried = (m, stats, carried) => m.active.filter(i => missionValue(i, stats, carried) >= missionAt(i).goal);
// the carried coins after a run: each active coin mission keeps its total, a done or no longer active one is dropped
function carryCoins(m, stats, carried) {
  const out = {};
  for (const i of m.active) if (missionAt(i).stat === 'coins' && missionValue(i, stats, carried) < missionAt(i).goal) out[i] = missionValue(i, stats, carried);
  return out;
}
// the saved carried coins ("i:n,i:n"), checked field by field
function parseCarried(text) {
  const out = {};
  for (const part of String(text || '').split(',')) {
    const [i, n] = part.split(':').map(Number);
    if (Number.isInteger(i) && i >= 0 && i < MISSIONS.length + STARTER.length && Number.isInteger(n) && n > 0 && n < 1e6) out[i] = n;
  }
  return out;
}
const carriedText = c => Object.entries(c).map(([i, n]) => i + ':' + n).join(',');
// replace the done ones with the next ones in the list (it wraps, so missions never run out)
function advanceMissions(m, done) {
  const active = m.active.slice();
  let next = m.next;
  for (const i of done) {
    while (active.includes(next)) next = (next + 1) % MISSIONS.length;
    active[active.indexOf(i)] = next;
    next = (next + 1) % MISSIONS.length;
  }
  return { next, active };
}
const emptyStats = () => ({ coins: 0, row: 0, rivers: 0, hops: 0, logs: 0, combo: 0, powers: 0, secrets: 0, nears: 0 });

// ---------- daily missions: three a day, the same three for everyone, each paid once ----------
const DAILY_REWARD = 30;
const DAILY = [
  { key: 'dcoins15', stat: 'coins', goal: 15 },
  { key: 'drow40', stat: 'row', goal: 40 },
  { key: 'drivers6', stat: 'rivers', goal: 6 },
  { key: 'dhops120', stat: 'hops', goal: 120 },
  { key: 'dlogs4', stat: 'logs', goal: 4 },
  { key: 'dcombo12', stat: 'combo', goal: 12 },
  { key: 'dnears2', stat: 'nears', goal: 2 },
  { key: 'dpowers1', stat: 'powers', goal: 1 }
];
const DAILY_COUNT = 3;
// the day (local YYYY-MM-DD) picks three distinct missions from the pool
function dailyMissions(day) {
  const rng = mulberry32(hashString('daily:' + day));
  const pool = DAILY.map((_, i) => i), out = [];
  for (let k = 0; k < DAILY_COUNT; k++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
// saved as "YYYY-MM-DD|bitmask" (bit k: the k-th mission of that day is paid); another day reads as nothing done
function parseDailyDone(text, day) {
  const [d, m] = String(text || '').split('|');
  const n = Number(m);
  return d === day && Number.isInteger(n) && n >= 0 && n < (1 << DAILY_COUNT) ? n : 0;
}
const dailyDoneText = (day, mask) => day + '|' + mask;
// the stats of a run: which slots (0..2) of the day's missions are done now and were not paid before
const doneDaily = (picks, mask, stats) => [...picks.keys()].filter(k => !(mask & (1 << k)) && (stats[DAILY[picks[k]].stat] || 0) >= DAILY[picks[k]].goal);

// ---------- the come-back bonus: coins for the first visit of a day, more for days in a row ----------
const COMEBACK = [10, 15, 20, 25, 30];   // day 1, 2, 3, 4, 5 and more in a row
const comebackBonus = days => COMEBACK[Math.min(COMEBACK.length, Math.max(1, Math.floor(days) || 1)) - 1];

export { comebackBonus, DAILY, DAILY_COUNT, DAILY_REWARD, MISSIONS, MISSION_REWARD, advanceMissions, carriedText, carryCoins, doneCarried, missionAt, missionValue, newMissions, parseCarried, dailyDoneText, dailyMissions, doneDaily, doneMissions, emptyStats, missionsText, parseDailyDone, parseMissions };
