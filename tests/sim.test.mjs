// Fast tests for js/gen.js and js/sim.js (no browser): the world as data and the run without a screen.
// Run: node tests/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGen, railStep, trafficX } from '../js/gen.js';
import { createSim, simulate } from '../js/sim.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { STEP } from '../js/rules.js';

// what the browser built for seed 42 (window.hopLanes.laneKinds()) before world generation moved to gen.js
const KINDS_42 = ['grass', 'grass', 'grass', 'grass', 'river', 'river', 'river', 'road', 'road', 'road', 'road', 'river', 'river', 'grass',
  'road', 'road', 'lily', 'lily', 'grass', 'road', 'river', 'road', 'grass', 'river', 'river', 'grass', 'road', 'road', 'road', 'road', 'road'];

// Replays played in the browser (index.html#debug-replay-<code>, before the rules moved to sim.js) and what the
// browser reported at game over: play ticks, the first joined player's row and cause, and the scores.
// They cover logs, lily pads, mud, cars, police, trains, the eagle, falling behind, the handicap shield, two players and race mode.
const BROWSER_RUNS = [
  {"code":"MnwxNzI3MDE3NTQzfHJhY2V8ZnJvZyxmb3h8M3wxfDQ0MHw1YVUyMmJVMzJhVTM0YlUyOWFVMjJiVTI0YVUzMmJVMzVhVTEzYlUzMGFSMzFiVThhUjI3YlUxMWFVMjFiRDE0YVUyMWJSMTFhVTI5YkQyM2FVMzdiUjI2YVUxNGJVMTRhVTI1YlUyNWFVMTJiVTlhUjE3YkQyMmFE","endTick":748,"row":10,"cause":"squash","scores":[11,8]},
  {"code":"MnwxMjA1NjkwMjUwfGNsYXNzaWN8ZnJvZyxmb3h8MXwxfDY2Mnw1YVUyMWFVMTZhVTM2YVUyNGFVMzNhVTMyYVUyNWFVMTBhVTEyYVUxNWFVMzNhVTM3YVUyOGFVMzBhUjhhVTI5YVUxM2FVOGFVMTNhVTMyYVUzN2FVMzVhVTE5YVUxNWFVMjlhVTE4YVUxMWFVMzJhVTMxYVUyOGFVMjlhVTM0YVU5YVUzM2FV","endTick":907,"row":17,"cause":"train","scores":[17,0]},
  {"code":"MnwxOTcxNjQ3MzAwfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDU2NXw1YVUzMWFVMzJhVTExYUQyMWFVMTlhUjEzYVIzMmFVOWFVMTJhUjM1YUQzN2FVMjRhUjIwYVIyN2FMMTFhUjEzYVIzN2FEMTZhVTI1YVIyM2FSMzVhVTIxYVUyMWFEMTVhVTExYVIyMWFEMzdhVTMxYVUxOGFVMjlhVTEwYVUxNGFVMTZhVTI0YVUzMGFEMThhVTIwYVUyM2FEMzVhVTM0YUQyOGFVOWFSMjZhVTEyYVUzM2FVMTFhVTM0YUQxM2FVMjZhRDI5YVUzNWFMMTlhTDIyYVUzNGFSMjZhRDMyYVUzNGFMMzZhVTIzYVUxNGFVMTNhVTE3YVUxN2FVMTdhVTIzYUwzMmFVMjFhVThhVTI5YVU5YVUyN2FVMjJhVTE2YVUxN2FVMTRhVTMyYVUyOGFVMzVhRDE1YUwzNGFEMTVhVTI5YUwzNWFMMjlhTDM0YUwxNWFMMTBhUjM0YUQyMWFVMjJhVTIxYVUyMWFVMTJhVThhVTM1YVUxMWFMMjVhTDE3YVIyOGFSMzNhTDI0YVUxOGFVMjdhUjM1YUwyN2FVMTFhVTIwYVUxNmFSMTNhTDE5YVIzNmFMMjVhVTI3YVUxN2FVMzZhTDEyYUwxNWFSMTdhVTI2YVUzNGFMMjZhTDIyYVIyNmFVMTRhRDE3YVUyNmFVMzRhVTE0YVUxNWFVMTNhRDIwYUQxN2FVOGFMMTRhRDExYVUxOWFEMjVhVTEwYVUzNGFSMzVhUjE0YVUyNWFVMTJhRDlhVTlhRDExYVIyM2FSMjhhRDE0YUQxMWFVMjFhRDIyYVUyNGFEMTZhVTMyYVUxMGFEMzZhVTE4YVUxNWFMMTRhUjE4YVUxM2FSMTBhVTM1YVUyMWFVMjlhRDE1YVUyNmFEMzdhVTMxYUwxMGFVMzJhRDM0YVUzNGFEMzdhVTEwYUQyNmFVMTRhRDMyYVUzMmFEMTVhVTI5YUQxOWFVOGFEMTJhVTI0YUQzMGFVMTFhVTE5YVIyNmFMOGFSMzFhRDMzYUQyNmFVMThhRDIyYVUzNGFEMjFhVTMxYUQxMGFVMjJhRDMwYVUzNGFEMjZhVTE0YUQyNGFVMzJhRDI4YVUxN2FVMzRhVTEyYVUyNGFSMzNhTDIzYVIxMmFSMzNhTDI3YVU4YVUxOWFVMjBhVTMzYUwyMWFSMjBhTDIyYVIyNWFMMTNhUjI2YVUxNWFMMjVhUjMxYVUxMGFSMzRhTDIyYUwyM2FSMTBhUjIwYVUzMGFVMTdhRDEwYVUzNGFMMjdhUjlhTDM1YUQyN2FVMjZhTDEyYUwzNGFMMjJhTDMwYVIyNGFMMjFhTDI5YUwyNGFMMzFhRDEzYVUxNWFEMzFhTDE1YUQzNWFVMTZhTDI5YVUxMGFVMjFhTDIwYUQ4YVUyMWFSOWFSMzFhRDEwYUwzNWFVMTBhRDEyYUwzNGFV","endTick":6153,"row":76,"cause":"swept","scores":[76,0]},
  {"code":"Mnw5MDQyMDQ3N3xjbGFzc2ljfGZyb2csZm94fDN8MHwzODg4fDVhVTMxYlUxNGFVMjBiVTM1YVUxN2JVMTlhVTMyYkwzN2FVMzdiRDlhVTE1YlUzNmFVMTRiUjI2YVUzMmJSMzBhUjEyYkwzMGFMMTFiVTMyYVIxOWJVMTZhRDI4YkQyMmFVOGJVMTdhVTEyYlUxMGFMMTdiVTM3YVUzMWJVMzFhVTMzYkQyMGFEMjViVTMxYVUzNmJVMjlhUjI2YlUzNWFVMzZiVTE1YVUxOGJSMjRhVTM0YlIyOWFMMTNiTDMyYVIxMGJEOGFMMTViVTI4YUwxN2JMOWFSMzBiTDhhUjliTDIyYUQyMmJMOWFVMThiTDE2YVIxM2JSMTVhTDI1YlIzNmFVMjhiTDEyYUwzN2JSMzFhUjEzYlUyNmFVMTBiVThhVTM2YlUzN2FVMjRiRDMyYUQxN2JVMjFhVTEwYlIxMWFVMTliUjIzYVUzM2JMMThhRDEzYkwyMGFMMjZiRDE4YUwyN2JMMjJhVTMwYlUzMGFVMzNiTDMxYUQxOWJMMjNhVTMwYlI2NDBhRDE1YUQxNWFEMTVhRDE1YUQxNWFE","endTick":2958,"row":21,"cause":"eagle","scores":[21,15]},
  {"code":"Mnw0MjEyNzcyODI0fGRhaWx5fGZyb2csZm94fDF8MHwzNjgzfDVhVTM0YVUyMGFVMjNhTDIwYVIzMWFEMTJhVTE4YUQxOGFVMzRhTDIwYVUxMWFVMzJhTDI5YVUyOGFVMjBhUjIyYVUzM2FMMzRhUjIyYUQzNGFVMThhRDMyYVUxMGFSMjBhRDIwYUQxMGFMMTNhVTE2YUQyMWFVMTlhRDE5YVUyMWFMMjlhVThhTDlhVTMxYVUzM2FVMzRhVTEwYUwxMWFSMTFhTDE1YUwxOWFSMTNhVTEzYVUyNWFVMTRhRDEwYVUyNmFEOWFVMTNhRDMyYVUxM2FMMTZhUjMzYVUyM2FVMjhhVTMwYVUxNWFVMTVhTDM3YUwyMmFSMjdhTDI1YUwyOWFSMTlhVTEyYVUxN2FVMTVhVTEzYVUxMWFVMzJhVTIzYVUyOGFVMjNhVTI4YVUxMWFVMTVhVTM0YVUxNmFMMjBhVTM1YUwxOGFMMTJhUjI3YVIzNGFSMzVhUjMwYVUzNmFVMjFhRDI4YVUxN2FMMjBhRDM1YUwzN2FMMTNhUjE4YUwxNGFEMTVhVTM1YUwyMGFVMzNhVTE2YVUxMGFVMzdhTDE1YUQzNWFSMzZhUjI4YUQyNGFVMThhVTMyYUQyNmFVMzVhVTIwYVUyNWFVMTdhVTlhVTIwYVUxN2FVMzBhVTEzYVUxNmFVMjRhVTE1YVUzM2FVMTJhVTI4YVUzM2FVMjNhVTI3YVUzNWFVMjBhVTIzYVUyMGFVMzFhVTI3YVUyN2FVMTBhVTlhVTEwYVUxMWFVMTVhVTlhVTIyYVUyN2FVMjhhVTE5YVUxMmFVMjVhVTI3YVUyM2FVMzZhVTIxYVUyOWFVMjlhVTlhVThhVTE4YVUyNWFSOGFVMzNhUjM3YUwxMWFSMjBhTDEzYVI4YUwyOGFVMzRhRDE5YVUzMmFVOGFVMzdhVTEyYUQxMmFVMTlhTDhhRDhhTDMwYUQzMWFVMTVhTDIwYVIyN2FEMzZhTDMwYVIyOGFSMTBhUjlhVTIxYVU5YUQxMWFVMzRhRDM2YUwyN2FVMzZhVTMzYUw4YUQyNWFEMzNhTDMyYUwyOGFEMzFhUjhhUjhhVTM3YUwyM2FSMTdhRDI0YVUzMmFVMzBhRDMxYVUxNmFEMjhhVTM0YVIxN2FMMzBhTDMzYVUzMmFVMzFhVTE5YVUyOWFVMTlhVTEwYVUxM2FEMjZhRDE3YVUyOWFMMTNhTDE0YUwyMGFMMjBhVTIwYUQyNmFVMzNhTDEyYUwyOWFMMzVhTDE1YUwyM2FMOWFSMTZhVTMwYVUzM2FVMzZhVTI5YUQyOWFVMjJhRDI4YVIxN2FVMjRhUjMyYUwzNmFEMTBhTDMyYVIzNmFSMjFhTDMwYUwzMGFMMThhTDI4YVIxNGFSMjJhUjEyYUwyMmFVMTJhVTMxYUwzNmFVMjhhTDE2YVIxNWFMMjZhVTE0YVUxMWFVMzBhVTMyYVUxOGFVMzFhVTExYVUxNWFVMTlhVTI3YVUxMmFVMjVhVTEzYVUxOWFVMzZhVTMyYVIzNWFVOGFSMjZhUjE1YVUyM2FSMjZhRDIxYVU4YUwzNGFMMzdhVTI2YVUyOGFEMjJhVThhUjIxYVIxNGFEMzNhVTI2YUwzNmFSMTVhTDE3YUwzNWFVMjhhVTEyYUwzNGFSMTFhUjI3YUwzNGFSMzBhTDM0YUwyNWFMMTlhTDI2YUwyNWFVMTFhVTMyYVIyMGFVMjdhTDIxYUQyOWFVMzVhTDEzYUwyM2FEOWFSMzZhUjIxYVIzMGFVMzRhUjE4YUwzMmFMMjlhVTlhUjMxYUwyMWFSMjJhVTMyYVUyMmFMMTVhUjIyYUwxMmFSMjNhRDE2YVU4YUQzMWFVMzJhVTE0YVU4YVUxOWFVMjRhVThhVTE2YUQ4YVUzM2FVMjhhVTM3YUQxMWFVMjFhRDE2YVUyMWFEMjFhRDE2YVUxOWFEMTVhRDIxYVUyOGFMMzBhRDI3YVUxNWFMMzVhUjhhTDMyYVIzNWFSMjhhTDI0YUQyMGFVMzdhTDM3YUwzNGFSMTZhUjIyYVUxOWFVMjVhTDI3YUQzNWFMMTVhTDE4YUQxOWFVMTdhUjI3YUwxNGFMOWFEMzRhUjE4YUwxNmFE","endTick":9143,"row":78,"cause":"slow","scores":[79,0]},
  {"code":"MnwxNzMxNzY1NjUyfGNsYXNzaWN8ZnJvZyxmb3h8M3wxfDYzNHwyNWJMM2FVMTliUjI2YVUxOGJVMjFiTDQ0YlI2YlUzN2JSNDlhVTIyYVUyMWFVOGFVMTdhVTEwYVUyOWFMMjdhVTMwYVUxNWFVMzdhVThhUjI0YlUxMWFSMjRiVTE3YVUxOWJMMjNhVTEyYUQzYlUzMGFVM2JVMzdiTDVhUjI3YVU3YkQyNWJVNGFVMjZhVTRiUjIyYUwxNGFVMjgzYVIzMGJMMTJiRDliVTI1NGFSMTlhTDEwYVU3YVUyNGFVN2FSMTVhVTM0YUQyNmFMNDNhVTMwYVUxOWFVMTRiTDI1YVIxOWJSNGFVMTFiTDE1YUwxNGFVMTFhVTBiTDEwYVI4YlUxMmJSMTJhRDE4Ykw1YVUyMWJEMTBhRDZhVTI3YVUzNmFVMzVhVTQxYVUxNmFEMThhVTEzYUwwYlUzNGJVMTFhVTE3YVU0YlUxN2FVNWJMMjdhTDlhVTI0YVUyNmFVMThhVTQwYVIyMmFVMTIzYlUzOGJVMzFiVTI4YlUzNWJSMzhiVTEyYlUyNWJVNDNiRDQzYkwyNGJVMjJhTDE0YlIyNmFVOGJSMThhVTE0YlUxNWFSN2JVMjFhVTExYlUyM2FVMTJhVTBiVTIxYlIxOGFVMjJiVTlhVTE3YlUyN2FVN2JVMTdiVTNhUjE0YVUxNWJVMTVhUjExYVIzYlUzMGFVMTJhVTJiVTQxYUwwYlUyM2FSOGJMN2FVMTVhVTE4MGFVNDFhVTExYVI0NWFVMzJhRDIyYVU4YVUyOWFM","endTick":1460,"row":11,"cause":"splash","scores":[11,4]}

];

test('gen: seed 42 gives the lane kinds the browser built', () => {
  const g = createWorldGen(42);
  assert.deepEqual(Array.from({ length: 31 }, (_, r) => g.lane(r).kind), KINDS_42);
  assert.deepEqual(Array.from({ length: 31 }, (_, r) => g.kind(r)), KINDS_42, 'the chain alone agrees');
});

test('gen: a row is the same whatever was asked before it, and fresh each time', () => {
  const a = createWorldGen(7), b = createWorldGen(7);
  for (let r = 300; r >= -12; r--) a.lane(r);   // backwards: the chain is walked once, in order
  for (const r of [0, 5, 37, 120, 250]) {
    const x = a.lane(r), y = b.lane(r);
    assert.deepEqual({ ...x, rng: null }, { ...y, rng: null }, 'row ' + r);
    assert.notEqual(x.objs, a.lane(r).objs, 'each call owns its moving state');
  }
  assert.notDeepEqual(createWorldGen(8).lane(30), createWorldGen(7).lane(30));
});

test('gen: rows below 4 are grass, one boss train per 100 rows, traffic wraps inside the span', () => {
  const g = createWorldGen(3);
  for (let r = -12; r < 4; r++) assert.equal(g.lane(r).kind, 'grass');
  const bosses = [];
  for (let r = 0; r < 600; r++) { const l = g.lane(r); if (l.boss) bosses.push(Math.floor(r / 100)); }
  assert.ok(bosses.length >= 3, 'boss trains: ' + bosses);
  assert.equal(new Set(bosses).size, bosses.length, 'at most one per hundred');
  for (let r = 4; r < 80; r++) {
    const l = g.lane(r);
    if (l.kind === 'road' || l.kind === 'river') for (const o of l.objs) for (const w of [0, 3.3, 1000]) {
      const x = trafficX(l, o, w);
      assert.ok(x >= -l.span / 2 && x < l.span / 2, `row ${r} x ${x}`);
    }
    if (l.kind === 'rail') {   // the schedule only moves forward and trains do not overlap
      let last = l.nextEnd;
      for (let w = 0; w < 200; w += 0.5) { railStep(l, w); assert.ok(l.nextStart >= last - l.pass - 1e-9); last = l.nextEnd; }
    }
  }
});

test('sim: recorded runs end where the browser ended them', () => {
  for (const run of BROWSER_RUNS) {
    const s = simulate(decodeReplay(run.code));
    assert.deepEqual({ endTick: s.endTick, row: s.row, cause: s.cause, scores: s.scores }, { endTick: run.endTick, row: run.row, cause: run.cause, scores: run.scores });
    assert.equal(s.score, Math.max(...run.scores));
    assert.equal(s.over, true);
  }
});

test('sim: createSim steps the countdown, then play, and exposes the live players', () => {
  const rp = decodeReplay(BROWSER_RUNS[0].code);
  const sim = createSim(rp);
  assert.equal(sim.state, 'countdown');
  let steps = 0, sawHop = false;
  while (sim.state === 'countdown') { sim.step(); steps++; }
  assert.ok(steps >= 359 && steps <= 361, 'about COUNTDOWN / STEP steps: ' + steps);
  assert.equal(sim.worldTick, rp.startTick);
  assert.equal(sim.tick, 0);
  while (sim.step()) {
    const p = sim.players[0];
    if (p.hop) { sawHop = true; assert.ok('t' in p.hop && 'fromRow' in p.hop && 'tz' in p.hop); }
  }
  assert.ok(sawHop);
  assert.equal(sim.end.endTick, simulate(rp).endTick);
  assert.equal(sim.step(), false, 'over stays over');
});

test('sim: a different run gives a different result; limits stop a run that will not end', () => {
  const rp = decodeReplay(BROWSER_RUNS[1].code);
  const s = simulate(rp);
  const cut = simulate({ ...rp, events: rp.events.slice(0, Math.floor(rp.events.length / 2)) });
  assert.ok(cut.score < s.score, `half the hops, fewer rows: ${cut.score} < ${s.score}`);
  assert.equal(simulate(rp, { maxTicks: 100 }), null);
  const part = simulate(rp, { until: 300 });
  assert.equal(part.over, false);
  assert.equal(part.endTick, 300);
  // an idle player is taken by the eagle (EAGLE_IDLE = 6 s after play begins, plus the swoop)
  const idle = simulate({ seed: 1, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 500, events: [] });
  assert.equal(idle.cause, 'eagle');
  assert.ok(Math.abs(idle.endTick * STEP - 6) < 0.05, 'eagle at ' + idle.endTick * STEP);
});

test('sim: a replay round-trips through its code', () => {
  const rp = decodeReplay(BROWSER_RUNS[2].code);
  assert.deepEqual(simulate(decodeReplay(encodeReplay(rp))), simulate(rp));
});
