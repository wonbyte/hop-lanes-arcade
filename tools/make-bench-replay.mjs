#!/usr/bin/env node
// Makes the bench replay (tests/bench-replay.txt): one long run on a fixed seed, found by a search over the real
// rules (sim.js createSim / simulate), so it plays the same in the browser. The run crosses every lane kind, the night,
// a biome change and a boss moment, then stops hopping (the eagle ends it). docs/budgets.md says what it is for.
// Run: node tools/make-bench-replay.mjs [--seed 21] [--target 160] [--out tests/bench-replay.txt]
import fs from 'node:fs';
import { createSim, simulate } from '../js/sim.js';
import { encodeReplay, decodeReplay } from '../js/replay.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 21)), TARGET = Number(arg('--target', 160)), OUT = arg('--out', 'tests/bench-replay.txt');
const START_TICK = 600, LOOK = 40, WAIT = 6, MAX_SIMS = 60000;
const MOVES = { U: [0, 1], L: [-1, 0], R: [1, 0], D: [0, -1] };

const base = { seed: SEED, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: START_TICK };
const events = [];
let sims = 0;
// the short future of a choice at play tick T: a move must start a hop (a tree or the edge refuses it), and the
// player must still be alive LOOK ticks on
function survives(evs, T, move) {
  sims++;
  const s = createSim({ ...base, events: evs });
  while (s.state !== 'play' || s.tick < T + LOOK) {
    if (!s.step()) return false;
    if (move && s.state === 'play' && s.tick === T + 1 && !s.players[0].hop) return false;
  }
  return s.players[0].alive;
}

// the live run: steps the committed events; restarted from scratch after a back-up
let sim;
function restart(toTick) {
  sim = createSim({ ...base, events });
  while (sim.state !== 'play' || sim.tick < toTick) if (!sim.step()) break;
}
// choices at an idle tick: every move whose short future survives, best first (forward, then toward the middle, then wait, back)
function choices(T) {
  const p = sim.players[0];
  const side = p.x > 0 ? ['L', 'R'] : ['R', 'L'];
  const out = [];
  for (const m of ['U', ...side, 'wait', 'D']) {
    const evs = m === 'wait' ? events : [...events, [T + 1, 0, ...MOVES[m]]];
    if (survives(evs, T, m !== 'wait')) out.push(m);
  }
  return out;
}

const stack = [];   // [{ T, opts, k, n }]: n = events before this choice
let best = { score: -1, events: [] };
restart(0);
while (sims < MAX_SIMS) {
  // run on until the player stands still (or the run ended)
  while (sim.state === 'play' && sim.players[0].alive && sim.players[0].hop) sim.step();
  const p = sim.players[0];
  if (p.score > best.score) best = { score: p.score, events: events.slice() };
  if (p.score >= TARGET) break;
  if (sim.state !== 'play' || !p.alive) {   // dead: back up to the newest choice that has another way
    while (stack.length && stack[stack.length - 1].k + 1 >= stack[stack.length - 1].opts.length) stack.pop();
    if (!stack.length) break;
    const c = stack[stack.length - 1];
    c.k++;
    events.length = c.n;
    if (c.opts[c.k] !== 'wait') events.push([c.T + 1, 0, ...MOVES[c.opts[c.k]]]);
    restart(c.T);
    for (let i = 0; i < (c.opts[c.k] === 'wait' ? WAIT : 1); i++) sim.step();
    continue;
  }
  const T = sim.tick, opts = choices(T);
  if (!opts.length) { for (let i = 0; i < 2 && sim.step(); i++); if (!sim.players[0].alive || sim.state !== 'play') continue; continue; }
  stack.push({ T, opts, k: 0, n: events.length });
  if (stack.length % 50 === 0) process.stderr.write(`row ${p.score} tick ${T} sims ${sims}\n`);
  if (opts[0] !== 'wait') events.push([T + 1, 0, ...MOVES[opts[0]]]);
  for (let i = 0; i < (opts[0] === 'wait' ? WAIT : 1); i++) sim.step();
}
const code = encodeReplay({ ...base, events: best.events });
const end = simulate(decodeReplay(code));
if (!end || !end.over) throw new Error('the bench run does not end');
fs.writeFileSync(OUT, code + '\n');
console.log(JSON.stringify({ seed: SEED, score: end.score, row: end.row, cause: end.cause, ticks: end.endTick, seconds: +(end.endTick / 120).toFixed(1), hops: best.events.length, sims, chars: code.length, out: OUT }));
