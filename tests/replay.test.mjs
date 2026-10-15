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
