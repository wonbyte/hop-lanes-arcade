#!/usr/bin/env node
// Fuzzer for js/replay.js decodeReplay and js/sim.js simulate (pure node, no browser).
// Run: node tools/fuzz-replay.mjs [--seconds N] [--seed N] [--quiet]
// Inputs: valid codes from encodeReplay (random seed, mode, animals, joined mask, handicap, startTick, up to 3000
// events), mutations of those (byte flips, truncation, insertion, repetition, huge length, digits only, alphabet noise)
// and random strings. Findings: decodeReplay throws, decode over 50 ms, simulate over 1000 ms (the maxMs: 300 run
// should stop near 300 ms), a simulate result that is not a plain object of finite numbers, a round trip that differs.
// The PRNG is seeded, so a finding is reproduced by --seed <seed> (the case index is printed too).
import { performance } from 'node:perf_hooks';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';
import { MAX_RUN_TICKS, MODES, RULES } from '../js/rules.js';
import { ANIMALS, DIRS, flagArg, seededRng } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => Number(flagArg(name, def));
const SECONDS = flag('--seconds', 60);
const SEED = flag('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const QUIET = args.includes('--quiet');
const DECODE_MS = 50, SIM_MS = 1000, BUDGET_MS = 300, BUDGET_SLACK_MS = 400;

// ---- seeded PRNG (mulberry32, tools/lib.mjs) ----
const { int, pick, chance } = seededRng(SEED);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// ---- generators ----
function validRun() {
  const n = chance(0.1) ? 0 : int(1, chance(0.8) ? 400 : 3000);
  const joined = [chance(0.85), chance(0.5)];
  if (!joined[0] && !joined[1]) joined[int(0, 1)] = true;
  const events = [];
  let t = 0;
  const survivor = chance(0.4);   // hops spaced under the eagle's patience (6 s), mostly forward: longer runs
  const span = survivor ? n * int(20, 700) : pick([30, 200, 2000, 100000, MAX_RUN_TICKS]);
  for (let i = 0; i < n; i++) {
    t += survivor ? int(1, Math.max(1, Math.floor(span / n))) : chance(0.3) ? 0 : int(0, Math.max(1, Math.floor(span / n)));
    if (t > MAX_RUN_TICKS) break;
    const p = joined[1] && (!joined[0] || chance(0.5)) ? 1 : 0;
    const d = chance(survivor ? 0.8 : 0.6) ? DIRS[0] : pick(DIRS);
    events.push([t, p, d[0], d[1]]);
  }
  return {
    version: int(2, RULES),   // every rules version a link can carry
    seed: chance(0.1) ? pick([0, 1, 42, 197, 4294967295, 2 ** 32]) : int(0, 4294967295),
    mode: pick(MODES), chars: [pick(ANIMALS), pick(ANIMALS)], joined,
    handicap: int(0, 2), startTick: chance(0.2) ? 0 : int(0, 10000), events
  };
}
function randomString(len) {
  const kind = int(0, 4);
  let s = '';
  for (let i = 0; i < len; i++) {
    if (kind === 0) s += B64[int(0, 63)];
    else if (kind === 1) s += String.fromCharCode(int(0, 127));
    else if (kind === 2) s += String.fromCharCode(int(0, 0xffff));
    else if (kind === 3) s += pick(['|', '2', 'a', 'b', 'U', 'D', 'L', 'R', '0', '9', ',', 'classic', 'frog', '=', '-', '_', '\n', ' ']);
    else s += String.fromCharCode(int(32, 126));
  }
  return s;
}
function mutate(code) {
  const kind = int(0, 9);
  switch (kind) {
    case 0: { // byte flips
      const a = code.split('');
      for (let k = int(1, 8); k > 0 && a.length; k--) a[int(0, a.length - 1)] = B64[int(0, 63)];
      return a.join('');
    }
    case 1: return code.slice(0, int(0, code.length));                               // truncation
    case 2: { const i = int(0, code.length); return code.slice(0, i) + randomString(int(1, 20)) + code.slice(i); } // insertion
    case 3: { const i = int(0, code.length), j = int(i, code.length); return code.slice(0, i) + code.slice(i, j).repeat(int(2, 50)) + code.slice(j); } // repetition
    case 4: return code.repeat(Math.ceil(65536 / Math.max(1, code.length))).slice(0, int(1024, 65536));   // huge length
    case 5: { const n = int(1, 65536); let s = ''; while (s.length < n) s += int(0, 9); return s; }         // digits only
    case 6: return randomString(int(1, 65536));                                                             // alphabet noise
    case 7: { // the plain text form with a field changed, re-encoded (reaches the field checks)
      const text = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
      const f = text.split('|');
      const i = int(0, Math.max(0, f.length - 1));
      const r = int(0, 6);
      if (r === 0) f[i] = randomString(int(0, 30));
      else if (r === 1) f[i] = String(pick([-1, 0, 1e10, 2 ** 32, MAX_RUN_TICKS, MAX_RUN_TICKS + 1, 1e300, NaN, 'constructor', '__proto__', 'toString']));
      else if (r === 2) f.splice(i, 1);
      else if (r === 3) f.splice(i, 0, randomString(int(0, 10)));
      else if (r === 4) f[7] = (f[7] || '') + pick(['0aU', '999999aU', '9999999aU', '0bX', 'aU', '1a', '1aUU']).repeat(int(1, 2000));
      else if (r === 5) { let s = ''; for (let k = int(1, 3000); k > 0; k--) s += int(0, 999999) + pick(['a', 'b']) + pick(['U', 'D', 'L', 'R']); f[7] = s; }
      else f[3] = pick(['frog', 'constructor', '__proto__', 'hasOwnProperty', 'a'.repeat(int(1, 5000)), 'frog,fox,cat', '', 'FROG,fox']) + (chance(0.5) ? ',' + pick(ANIMALS) : '');
      return Buffer.from(f.join('|'), 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    case 8: return code + pick(['=', '==', '===', '\n', ' ', '%20', '#', '?x=1']);
    default: { const a = code.split(''); for (let k = int(1, 4); k > 0 && a.length; k--) a.splice(int(0, a.length - 1), 1); return a.join(''); } // deletions
  }
}

// ---- checks ----
const findings = [];
let cases = 0, decoded = 0, simulated = 0, slowBudget = 0, maxDecode = 0, maxSim = 0, maxBudgetSim = 0, slowestDecode = '', slowestSim = '', stalls = 0;   // stalls: one slow timing that three more runs did not repeat (GC, scheduler)
const show = s => (typeof s === 'string' ? JSON.stringify(s.length > 120 ? s.slice(0, 120) + `...(${s.length} chars)` : s) : String(s));
function finding(kind, input, extra = {}) {
  findings.push({ kind, input, ...extra });
  console.log(`FINDING ${kind} seed=${SEED} case=${cases} input=${show(input)} ${JSON.stringify(extra)}`);
}
function finiteObject(res) {
  if (res === null) return true;   // null is the documented "did not end" answer
  if (!res || typeof res !== 'object' || Object.getPrototypeOf(res) !== Object.prototype) return false;
  const num = v => typeof v === 'number' && Number.isFinite(v);
  if (!num(res.score) || !num(res.endTick) || !num(res.row) || typeof res.over !== 'boolean' || typeof res.cause !== 'string') return false;
  if (!Array.isArray(res.scores) || !res.scores.every(num)) return false;
  if (!Array.isArray(res.players) || !res.players.every(p => p && typeof p === 'object' && num(p.row) && num(p.x) && num(p.score) && num(p.coins) && typeof p.alive === 'boolean' && typeof p.cause === 'string')) return false;
  return true;
}
function check(input, origin) {
  cases++;
  let rp, t0 = performance.now();
  try { rp = decodeReplay(input); } catch (e) { finding('decode-throws', input, { origin, error: String(e && e.stack || e).slice(0, 300) }); return; }
  const dt = performance.now() - t0;
  if (dt > maxDecode) { maxDecode = dt; slowestDecode = `${origin} ${show(input)}`; }
  if (dt > DECODE_MS) {   // a GC pause or the scheduler? the best of three more runs is what the decoder itself costs
    const again = Math.min(...[0, 1, 2].map(() => { const a = performance.now(); decodeReplay(input); return performance.now() - a; }));
    if (again > DECODE_MS) finding('decode-slow', input, { origin, ms: +dt.toFixed(1), retimedMs: +again.toFixed(1) });
    else stalls++;
  }
  if (rp === undefined || (rp !== null && (typeof rp !== 'object'))) finding('decode-bad-return', input, { origin, got: typeof rp });
  if (!rp) return;
  decoded++;
  // round trip
  try {
    const again = decodeReplay(encodeReplay(rp));
    if (JSON.stringify(again) !== JSON.stringify(rp)) finding('round-trip', input, { origin, first: show(JSON.stringify(rp)), second: show(JSON.stringify(again)) });
  } catch (e) { finding('round-trip-throws', input, { origin, error: String(e && e.stack || e).slice(0, 300) }); }
  // simulate with the server's budget
  let res;
  t0 = performance.now();
  try { res = simulate(rp, { maxMs: BUDGET_MS }); } catch (e) { finding('simulate-throws', input, { origin, budget: BUDGET_MS, error: String(e && e.stack || e).slice(0, 300) }); return; }
  const bt = performance.now() - t0;
  maxBudgetSim = Math.max(maxBudgetSim, bt);
  if (bt > BUDGET_MS + BUDGET_SLACK_MS) { slowBudget++; finding('simulate-budget-overrun', input, { origin, ms: +bt.toFixed(1), budget: BUDGET_MS }); }
  if (!finiteObject(res)) finding('simulate-bad-result', input, { origin, got: show(JSON.stringify(res)) });
  // simulate with the default (unbounded) budget
  t0 = performance.now();
  try { res = simulate(rp); } catch (e) { finding('simulate-throws', input, { origin, budget: 'default', error: String(e && e.stack || e).slice(0, 300) }); return; }
  const st = performance.now() - t0;
  simulated++;
  if (st > maxSim) { maxSim = st; slowestSim = `${origin} events=${rp.events.length} endTick=${res && res.endTick} ${show(input)}`; }
  if (st > SIM_MS) {
    const again = Math.min(...[0, 1].map(() => { const a = performance.now(); simulate(rp); return performance.now() - a; }));
    if (again > SIM_MS) finding('simulate-slow', input, { origin, ms: +st.toFixed(1), retimedMs: +again.toFixed(1), events: rp.events.length, endTick: res && res.endTick });
    else stalls++;
  }
  if (!finiteObject(res)) finding('simulate-bad-result', input, { origin, got: show(JSON.stringify(res)) });
}

// ---- main loop ----
console.log(`fuzz-replay: seed=${SEED} seconds=${SECONDS}`);
const start = Date.now();
let lastReport = start;
while (Date.now() - start < SECONDS * 1000) {
  const run = validRun();
  let code;
  try { code = encodeReplay(run); } catch (e) { finding('encode-throws', JSON.stringify(run).slice(0, 200), { error: String(e).slice(0, 200) }); continue; }
  check(code, 'valid');
  const m = int(1, 4);
  for (let i = 0; i < m; i++) check(mutate(code), 'mutated');
  check(randomString(int(0, chance(0.9) ? 200 : 65536)), 'random');
  if (chance(0.3)) check(pick([null, undefined, 1, {}, [], ''].map(v => v)), 'non-string');
  if (!QUIET && Date.now() - lastReport > 30_000) {
    lastReport = Date.now();
    console.log(`... ${cases} cases, ${decoded} decoded, ${simulated} simulated, ${findings.length} findings, max decode ${maxDecode.toFixed(1)} ms, max sim ${maxSim.toFixed(1)} ms (budget run ${maxBudgetSim.toFixed(1)} ms)`);
  }
}
const secs = ((Date.now() - start) / 1000).toFixed(0);
console.log(`fuzz-replay done: seed=${SEED} ${secs}s cases=${cases} decoded=${decoded} simulated=${simulated} findings=${findings.length} maxDecodeMs=${maxDecode.toFixed(1)} maxSimMs=${maxSim.toFixed(1)} maxBudgetSimMs=${maxBudgetSim.toFixed(1)} budgetOverruns=${slowBudget} stalls=${stalls}`);
console.log(`slowest decode: ${slowestDecode}\nslowest simulate: ${slowestSim}`);
const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
if (findings.length) console.log('findings by kind: ' + JSON.stringify(byKind));
process.exitCode = findings.length ? 1 : 0;
