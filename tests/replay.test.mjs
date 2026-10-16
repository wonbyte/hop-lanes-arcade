// Fast tests for js/replay.js, js/missions.js and the pure list helpers of js/storage.js (no browser). Run: node tests/replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { DAILY, DAILY_COUNT, advanceMissions, dailyDoneText, dailyMissions, doneDaily, doneMissions, emptyStats, MISSIONS, missionsText, parseDailyDone, parseMissions } from '../js/missions.js';

// storage.js touches the page at import (the coin counter, the marquee, storage events): stub just enough of a browser
const el = () => ({ textContent: '', hidden: false });
globalThis.document = { getElementById: el, querySelector: () => null, addEventListener() {}, documentElement: {} };
globalThis.localStorage = { length: 0, getItem: () => null, setItem() {}, removeItem() {}, key: () => null };
globalThis.location = { hash: '' };
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
const { cleanInitials, entersLocal, localTop, parseLocal } = await import('../js/storage.js');

test('replay: encode then decode gives the run back', () => {
  const run = { seed: 4022250974, mode: 'daily', chars: ['frog', 'robot'], joined: [true, true], handicap: 2, startTick: 1234,
    events: [[12, 0, 0, 1], [12, 1, 0, 1], [40, 0, -1, 0], [41, 0, 1, 0], [300, 1, 0, -1]] };
  const code = encodeReplay(run);
  assert.match(code, /^[\w-]+$/, 'url safe');
  assert.deepEqual(decodeReplay(code), run);
});

test('replay: bad input is null, not a crash', () => {
  assert.equal(decodeReplay('***'), null);
  assert.equal(decodeReplay(''), null);
  assert.equal(decodeReplay(btoa('9|1|classic|frog,fox|1|0|0|')), null, 'wrong version');
  assert.equal(decodeReplay(btoa('2|x|classic|frog,fox|1|0|0|')), null, 'bad seed');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|zzzzzzzz')), null, 'junk events');
  assert.equal(decodeReplay(btoa('2|1|zzz|frog,fox|1|0|0|')), null, 'unknown mode');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|0|0|0|')), null, 'nobody joined');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|7|0|')), null, 'bad handicap');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|999999999aU')), null, 'tick past an hour');
  assert.deepEqual(decodeReplay(btoa('2|1|race|frog,fox|3|1|50|5aU')).events, [[5, 0, 0, 1]]);
});

test('missions: parse, done, advance, never repeat an active one', () => {
  const m = parseMissions('');
  assert.deepEqual(m, { next: 3, active: [0, 1, 2] });
  assert.deepEqual(parseMissions('bad'), m);
  assert.deepEqual(parseMissions(missionsText(m)), m);
  const stats = { ...emptyStats(), coins: 10, row: 31 };
  const done = doneMissions(m, stats);
  assert.deepEqual(done, [0, 1]);
  const next = advanceMissions(m, done);
  assert.deepEqual(next, { next: 5, active: [3, 4, 2] });
  // wrap around the whole list many times: the three active missions stay distinct
  let cur = m;
  for (let i = 0; i < 100; i++) cur = advanceMissions(cur, [cur.active[i % 3]]);
  assert.equal(new Set(cur.active).size, 3);
  assert.ok(cur.active.every(i => i >= 0 && i < MISSIONS.length));
});

test('daily missions: three distinct picks per day, the same for everyone; done bits are paid once', () => {
  const a = dailyMissions('2026-10-15'), b = dailyMissions('2026-10-16');
  assert.equal(a.length, DAILY_COUNT);
  assert.equal(new Set(a).size, DAILY_COUNT, 'distinct');
  assert.ok(a.every(i => i >= 0 && i < DAILY.length));
  assert.deepEqual(dailyMissions('2026-10-15'), a, 'the day decides');
  assert.notDeepEqual(a, b, 'another day, other missions');
  assert.equal(parseDailyDone('', '2026-10-15'), 0);
  assert.equal(parseDailyDone('2026-10-14|7', '2026-10-15'), 0, 'yesterday does not count');
  assert.equal(parseDailyDone('2026-10-15|5', '2026-10-15'), 5);
  assert.equal(parseDailyDone('2026-10-15|9', '2026-10-15'), 0, 'out of range');
  assert.equal(dailyDoneText('2026-10-15', 5), '2026-10-15|5');
  // a run that beats every goal finishes the ones not paid yet
  const stats = { ...emptyStats(), coins: 99, row: 999, rivers: 99, hops: 999, logs: 99, combo: 99, nears: 99, powers: 9 };
  assert.deepEqual(doneDaily(a, 0, stats), [0, 1, 2]);
  assert.deepEqual(doneDaily(a, 5, stats), [1]);
  assert.deepEqual(doneDaily(a, 0, emptyStats()), []);
  // one goal exactly reached
  const m = DAILY[a[1]], one = { ...emptyStats(), [m.stat]: m.goal };
  assert.deepEqual(doneDaily(a, 0, one), [1]);
});

test('local top 10: parse, enter, keep 10, ties go after, initials are 3 clean letters', () => {
  assert.deepEqual(parseLocal(''), []);
  assert.deepEqual(parseLocal('junk'), []);
  assert.deepEqual(parseLocal('[{"name":"ABC FROG","score":0},{"name":5,"score":3},{"name":"X","score":3.5},{"name":"OK","score":7,"day":"2026-10-15","mode":"classic"}]'),
    [{ name: 'OK', score: 7, day: '2026-10-15', mode: 'classic' }]);
  let list = [];
  assert.equal(entersLocal(list, 0), false, 'a zero score never enters');
  assert.equal(entersLocal(list, 1), true);
  const e = (score, name = 'AAA FROG') => ({ name, score, day: '2026-10-15', mode: 'classic' });
  for (let i = 1; i <= 10; i++) list = localTop(list, e(i * 10));
  assert.equal(list.length, 10);
  assert.equal(list[0].score, 100); assert.equal(list[9].score, 10);
  assert.equal(entersLocal(list, 10), false, 'equal to the 10th: no');
  assert.equal(localTop(list, e(10)), list, 'the same list back');
  assert.equal(entersLocal(list, 11), true);
  list = localTop(list, e(50, 'BBB FOX'));
  assert.equal(list.length, 10);
  assert.equal(list[5].score, 50); assert.equal(list[5].name, 'AAA FROG', 'the older equal score stays first');
  assert.equal(list[6].name, 'BBB FOX');
  assert.equal(list[9].score, 20, 'the 10 fell off');
  assert.equal(JSON.parse(JSON.stringify(list)).length, 10);
  assert.deepEqual(parseLocal(JSON.stringify(list)), list);
  assert.equal(cleanInitials('ab-1x'), 'AB1');
  assert.equal(cleanInitials(null), '');
  assert.equal(cleanInitials('   '), '');
});

test('replay: every field of a code is checked, and the joined mask and the moves read back exactly', () => {
  const ok = (ev = '') => btoa('2|1|classic|frog,fox|1|0|0|' + ev);
  assert.deepEqual(decodeReplay(ok()).events, []);
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0')).events, [], 'no event field at all');
  assert.deepEqual(decodeReplay(ok('3aU2bD1aL0bR')).events, [[3, 0, 0, 1], [5, 1, 0, -1], [6, 0, -1, 0], [6, 1, 1, 0]], 'ticks add up; a, b are the players; U D L R the moves');
  assert.equal(decodeReplay(ok('3aX')), null, 'no such move');
  assert.equal(decodeReplay(ok('3cU')), null, 'no third player');
  assert.equal(decodeReplay(ok('aU')), null, 'a move needs its tick');
  assert.equal(decodeReplay(ok('1234567aU')), null, 'a gap of more than six digits');
  assert.deepEqual(decodeReplay(ok('123456aU')).events, [[123456, 0, 0, 1]], 'six digits are fine');
  assert.equal(decodeReplay(ok('400000aU400000aU')), null, 'ticks that add up past an hour');
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|1aU|extra')).events, [[1, 0, 0, 1]], 'a field past the events is ignored');
  assert.equal(decodeReplay(btoa('2|12345678901|classic|frog,fox|1|0|0|')), null, 'a seed of 11 digits');
  assert.equal(decodeReplay(btoa('2|4294967295|classic|frog,fox|1|0|0|')).seed, 4294967295, 'ten digits are fine');
  assert.equal(decodeReplay(btoa('2|9999999999|classic|frog,fox|1|0|0|')).seed, 9999999999 >>> 0, 'and read as a 32-bit number');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|1234567890|')), null, 'a start tick of 10 digits');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|439201|')), null, 'a start tick past an hour and a minute');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|439200|')).startTick, 439200, 'the last tick allowed');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0||')), null, 'no start tick');
  assert.equal(decodeReplay(btoa('2|1|classic|frog|1|0|0|')), null, 'two animals, always');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox,cat|1|0|0|')), null);
  assert.equal(decodeReplay(btoa('2|1|classic|Frog,fox|1|0|0|')), null, 'lower-case keys');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,|1|0|0|')), null, 'an empty key');
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|')).chars, ['frog', 'fox']);
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|2|0|0|')).joined, [false, true], 'mask 2: player 2 alone');
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|3|0|0|')).joined, [true, true]);
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|4|0|0|')), null, 'no such mask');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|12|0|0|')), null);
  assert.deepEqual([1, 2].map(h => decodeReplay(btoa(`2|1|classic|frog,fox|3|${h}|0|`)).handicap), [1, 2]);
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|3|3|0|')), null, 'handicap 0..2 only');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|3||0|')), null);
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|3|00|0|')), null);
  assert.equal(decodeReplay(btoa('1|1|classic|frog,fox|1|0|0|')), null, 'an old version');
  assert.equal(decodeReplay(btoa('2|1|Classic|frog,fox|1|0|0|')), null, 'modes are exact');
  for (const mode of ['classic', 'race', 'coinwar', 'tag', 'daily', 'room']) assert.equal(decodeReplay(btoa(`2|1|${mode}|frog,fox|1|0|0|`)).mode, mode);
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|') + '!!'), null, 'not base64');
  assert.equal(decodeReplay(null), null);
});

test('replay: the code is the run as text, base64 made url safe', () => {
  const run = { seed: 7, mode: 'race', chars: ['cat', 'pig'], joined: [false, true], handicap: 0, startTick: 42, events: [[10, 1, 0, 1], [10, 1, 1, 0], [25, 0, -1, 0], [30, 1, 0, -1]] };
  const code = encodeReplay(run);
  assert.equal(atob(code.replace(/-/g, '+').replace(/_/g, '/')), '2|7|race|cat,pig|2|0|42|10bU0bR15aL5bD', 'gaps between ticks, a/b the player, the move letter');
  assert.equal(encodeReplay({ ...run, joined: [true, true], handicap: 2, events: [] }), btoa('2|7|race|cat,pig|3|2|42|').replace(/=+$/, ''));
  assert.equal(encodeReplay({ ...run, joined: [true, false], handicap: undefined }).includes('|1|0|42|'), false, 'encoded, not plain');
  assert.equal(atob(encodeReplay({ ...run, joined: [true, false], handicap: undefined })), '2|7|race|cat,pig|1|0|42|10bU0bR15aL5bD', 'no handicap reads as 0');
  assert.ok(!/[+/=]/.test(encodeReplay({ ...run, seed: 4022250974, events: Array.from({ length: 40 }, (_, i) => [i * 7, i & 1, 0, 1]) })), 'no +, / or = in a link');
  assert.deepEqual(decodeReplay(code), run);
});

test('missions: the saved text is checked field by field; done is the goal reached; advance skips active ones', () => {
  assert.deepEqual(parseMissions('3,0,1,2'), { next: 3, active: [0, 1, 2] });
  assert.deepEqual(parseMissions('15,14,13,12'), { next: 15, active: [14, 13, 12] });
  const fallback = { next: 3, active: [0, 1, 2] };
  assert.deepEqual(parseMissions('16,0,1,2'), fallback, 'past the list');
  assert.deepEqual(parseMissions('-1,0,1,2'), fallback, 'negative');
  assert.deepEqual(parseMissions('1.5,0,1,2'), fallback, 'not whole');
  assert.deepEqual(parseMissions('3,0,1'), fallback, 'too short');
  assert.deepEqual(parseMissions('3,0,1,2,4'), fallback, 'too long');
  assert.deepEqual(parseMissions(null), fallback);
  assert.equal(missionsText({ next: 7, active: [4, 5, 6] }), '7,4,5,6');
  assert.equal(MISSIONS.length, 16);
  assert.deepEqual(MISSIONS.map(m => m.key), ['coins10', 'row30', 'rivers5', 'hops100', 'logs3', 'combo10', 'row60', 'coins20', 'power1', 'rivers10', 'hops200', 'row100', 'coins30', 'secret1', 'combo20', 'nears3']);
  assert.ok(MISSIONS.every(m => m.key === m.stat.replace(/s$/, '') + m.goal || m.key.endsWith(String(m.goal))), 'the key names the goal');
  const m = { next: 3, active: [0, 1, 2] };
  assert.deepEqual(doneMissions(m, { ...emptyStats(), coins: 9 }), [], 'one short');
  assert.deepEqual(doneMissions(m, { ...emptyStats(), coins: 10 }), [0], 'exactly the goal');
  assert.deepEqual(doneMissions(m, { ...emptyStats(), rivers: 5, row: 30 }), [1, 2]);
  assert.deepEqual(doneMissions(m, {}), [], 'missing stats are 0');
  assert.deepEqual(doneMissions({ next: 0, active: [13, 15, 8] }, { ...emptyStats(), secrets: 1, nears: 3, powers: 1 }), [13, 15, 8]);
  assert.deepEqual(advanceMissions(m, []), m, 'nothing done: as it was');
  assert.deepEqual(advanceMissions(m, [2]), { next: 4, active: [0, 1, 3] }, 'the done one is replaced in its slot');
  // next 15 is active, 0 (wrapping) is active too, so 1 fills the slot and next moves on to 2
  assert.deepEqual(advanceMissions({ next: 15, active: [0, 15, 2] }, [0]), { next: 2, active: [1, 15, 2] }, 'next wraps past the end and skips the active ones');
  // two done: 15 takes 1 (15 and 0 are active); 0 then takes 3 (2 is active), and next ends at 4
  assert.deepEqual(advanceMissions({ next: 15, active: [0, 15, 2] }, [15, 0]), { next: 4, active: [3, 1, 2] });
  assert.deepEqual(emptyStats(), { coins: 0, row: 0, rivers: 0, hops: 0, logs: 0, combo: 0, powers: 0, secrets: 0, nears: 0 });
  assert.notEqual(emptyStats(), emptyStats(), 'a fresh object every time');
});

test('daily missions: the pool, the rewards, the pick draws from the day, and the done bits', async () => {
  const { DAILY_REWARD, MISSION_REWARD } = await import('../js/missions.js');
  assert.deepEqual([DAILY_REWARD, MISSION_REWARD, DAILY_COUNT, DAILY.length], [30, 20, 3, 8]);
  assert.deepEqual(DAILY.map(m => [m.stat, m.goal]), [['coins', 15], ['row', 40], ['rivers', 6], ['hops', 120], ['logs', 4], ['combo', 12], ['nears', 2], ['powers', 1]]);
  // over many days every mission comes up, and the picks are spread (seeded from "daily:" + the day)
  const seen = new Set();
  for (let d = 1; d <= 28; d++) for (const i of dailyMissions('2026-02-' + String(d).padStart(2, '0'))) seen.add(i);
  assert.equal(seen.size, DAILY.length, 'every mission is picked some day');
  assert.deepEqual(dailyMissions('2026-10-15'), [5, 7, 0], 'pinned: the picks of 2026-10-15 (the day decides, and everyone agrees)');
  assert.notDeepEqual(dailyMissions('2026-10-15'), dailyMissions('2026-10-15 '), 'the text of the day, exactly');
  assert.equal(parseDailyDone('2026-10-15|0', '2026-10-15'), 0);
  assert.equal(parseDailyDone('2026-10-15|7', '2026-10-15'), 7, 'all three paid');
  assert.equal(parseDailyDone('2026-10-15|8', '2026-10-15'), 0, 'past three bits');
  assert.equal(parseDailyDone('2026-10-15|-1', '2026-10-15'), 0);
  assert.equal(parseDailyDone('2026-10-15|1.5', '2026-10-15'), 0);
  assert.equal(parseDailyDone('2026-10-15|x', '2026-10-15'), 0);
  assert.equal(parseDailyDone('2026-10-15', '2026-10-15'), 0, 'no mask');
  assert.equal(parseDailyDone(null, '2026-10-15'), 0);
  assert.equal(dailyDoneText('2026-10-15', 0), '2026-10-15|0');
  const picks = [5, 7, 0];   // combo 12, powers 1, coins 15
  assert.deepEqual(doneDaily(picks, 0, { ...emptyStats(), combo: 12 }), [0], 'the goal exactly');
  assert.deepEqual(doneDaily(picks, 0, { ...emptyStats(), combo: 11 }), []);
  assert.deepEqual(doneDaily(picks, 1, { ...emptyStats(), combo: 50, powers: 1 }), [1], 'slot 0 was paid');
  assert.deepEqual(doneDaily(picks, 2, { ...emptyStats(), combo: 50, powers: 1, coins: 15 }), [0, 2]);
  assert.deepEqual(doneDaily(picks, 7, { ...emptyStats(), combo: 50, powers: 1, coins: 15 }), [], 'all paid');
  assert.deepEqual(doneDaily(picks, 0, {}), []);
});

test('replay: more shapes a code may not have', () => {
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|3|12|0|')), null, 'handicap is one digit');
  assert.equal(decodeReplay(btoa('2|1|classic|Frog,Fox|1|0|0|')), null, 'no key may have a capital');
  assert.equal(decodeReplay(btoa('2|1|classic|frog1,fox|1|0|0|')), null, 'letters only');
  assert.equal(decodeReplay(btoa('2|1|classic|1frog,fox|1|0|0|')), null);
  assert.equal(decodeReplay(btoa('2|a1|classic|frog,fox|1|0|0|')), null, 'the seed is digits only');
  assert.equal(decodeReplay(btoa('2|1a|classic|frog,fox|1|0|0|')), null);
  assert.deepEqual(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|439200aU')).events, [[439200, 0, 0, 1]], 'a hop on the last tick allowed');
  assert.equal(decodeReplay(btoa('2|1|classic|frog,fox|1|0|0|439201aU')), null, 'one past it');
});

test('the bench replay (docs/budgets.md) plays to row 160 on seed 21, and the doc links that very run', async () => {
  const fs = await import('node:fs');
  const { simulate } = await import('../js/sim.js');
  const code = fs.readFileSync(new URL('./bench-replay.txt', import.meta.url), 'utf8').trim();
  const rp = decodeReplay(code);
  assert.equal(rp.seed, 21);
  const end = simulate(rp);
  assert.ok(end.over);
  assert.equal(end.score, 160);
  const doc = fs.readFileSync(new URL('../docs/budgets.md', import.meta.url), 'utf8');
  assert.ok(doc.includes('#debug-bench-replay-' + code + '\n'), 'docs/budgets.md links the current bench replay');
});
