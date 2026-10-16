#!/usr/bin/env node
// Hazard audit: random play with the real rules (sim.js makeRules, gen.js worlds), every death and every refused hop
// classified, and the fairness invariants checked:
//   - no hazard moves farther in one step than its hit width (no car or train can skip through a player)
//   - a rider moves exactly with the log, no jump (only the snap on landing)
//   - every death has a cause the player could see: a swept rider was past the drawn rapids line, a car touched the
//     body, a plank or tile had been cracking for its whole PLANK_BREAK
// and the near calls that are within the rules but look unfair are counted (a landing in the water that missed a log
// by less than half a body, a swept rider who pressed a hop the edge refused).
//   - rules 3: a forward or back hop from a log is never refused for the edge, every swept rider was warned (fx.edge), a
//     landing within LOG_SLACK_BODY of a log's end rides it, a plank drops nobody who is in the air
// Run: node tools/hazard-audit.mjs [--runs 4000] [--seed 1] [--rules 3] [--json out.json]; exit 1 when an invariant breaks.
import fs from 'node:fs';
import { makeRules, resetPlayer, touchRows, creepCamera } from '../js/sim.js';
import { createWorldGen, railStep, trafficX } from '../js/gen.js';
import { EDGE_DEATH, HIT_PAD, HOP_MID, LOG_SLACK, LOG_SLACK_BODY, PLANK_BREAK, PLAY_HALF, RULES, STEP, mulberry32, traitOf } from '../js/rules.js';
import { flagArg } from './lib.mjs';

const RUNS = Number(flagArg('--runs', 4000)), SEED = Number(flagArg('--seed', 1)), OUT = flagArg('--json', '');
const VERSION = Number(flagArg('--rules', RULES)), SLACK = VERSION >= 3 ? LOG_SLACK_BODY : LOG_SLACK;
const BODY_HALF = 0.31;          // half the width of the animals' bodies (models.js: frog 0.62, fox ~0.6)
const MAX_TICKS = 120 * 240;     // 4 minutes of play at most per run
const rnd = mulberry32(SEED);

const stats = { rules: VERSION, runs: 0, ticks: 0, deaths: {}, deathsByKind: {}, refused: { edge: 0, tree: 0, other: 0 },
  swept: { total: 0, refusedForwardLast1s: 0, refusedSideLast1s: 0, warned: 0, warnedSecondsMin: Infinity, warnedSeconds: [] },
  edgeWarnings: 0,
  splashLanding: { total: 0, bodyOnLog: 0, missBy: [] },   // missBy: from the middle of the body to the log's end
  squash: { total: 0, overlapLessThan0_05: 0 },
  planks: { falls: 0, inTheAir: 0, crackedTicksMin: Infinity },
  maxStepMove: { car: 0, log: 0, train: 0 }, minHitWidth: { car: Infinity, train: Infinity },
  riderJumps: 0, broken: [] };
const breakInv = (what, detail) => { if (stats.broken.length < 20) stats.broken.push({ what, ...detail }); };

function playRun(seed, far) {
  const gen = createWorldGen(seed), lanes = new Map();
  const lane = r => lanes.get(r) || lanes.set(r, gen.lane(r)).get(r);
  const G = { mode: 'classic', rules: VERSION, state: 'play', camRow: 0, playT: 0, worldTick: 600, run: null };
  const p = { id: 0, joined: true, trait: traitOf('frog') };
  const players = [p, { id: 1, joined: false, alive: false, trait: {} }];
  const last = { refusedForwardTick: -1e9, refusedSideTick: -1e9, landTick: 0, edgeTick: -1e9 };
  let tick = 0, prevX = 0, prevLog = null, prevLogX = 0, hopBefore = null, hopTwoBefore = null;
  const fx = {
    kill(q, cause) {
      stats.deaths[cause] = (stats.deaths[cause] || 0) + 1;
      // kill() clears the hop: hopBefore says if this step lands it, or if the player is still over the row left
      const t = hopBefore ? hopBefore.t + STEP / hopBefore.dur : 0, landing = !!hopBefore && t >= 1 - 1e-9;
      const deathRow = hopBefore && !landing && t < HOP_MID ? hopBefore.fromRow : q.row;
      const kind = lane(deathRow).kind;
      stats.deathsByKind[kind + ' ' + cause] = (stats.deathsByKind[kind + ' ' + cause] || 0) + 1;
      if (cause === 'swept') {
        stats.swept.total++;
        if (tick - last.refusedForwardTick <= 120) stats.swept.refusedForwardLast1s++;
        if (tick - last.refusedSideTick <= 120) stats.swept.refusedSideLast1s++;
        if (Math.abs(q.x) <= EDGE_DEATH) breakInv('swept inside the line', { x: q.x });
        if (last.edgeTick > last.landTick) {
          stats.swept.warned++;
          const s = (tick - last.edgeTick) * STEP;
          stats.swept.warnedSeconds.push(s);
          stats.swept.warnedSecondsMin = Math.min(stats.swept.warnedSecondsMin, s);
        } else if (VERSION >= 3) breakInv('swept with no edge warning on this ride', { x: q.x, tick });
      }
      if (cause === 'squash' || cause === 'twister') {
        stats.squash.total++;
        // kill() clears the hop, and this step may have passed HOP_MID: the hazard is on the row left or the row reached
        const rows = hopBefore ? [hopBefore.fromRow, q.row] : [q.row];
        const gaps = rows.flatMap(r => lane(r).objs.map(o => Math.abs(o.x - q.x) - o.len / 2));
        const g = Math.min(...gaps);
        if (g > HIT_PAD + 1e-9) breakInv('hit with no car near', { gap: g });
        if (g > BODY_HALF) breakInv('a car hit that does not touch the body', { gap: g });
        if (g > BODY_HALF - 0.05) stats.squash.overlapLessThan0_05++;
      }
      const here = lane(deathRow);
      if (cause === 'splash' && here.kind === 'river' && landing) {   // a landing in the water (land() kills before fx.land)
        const missBy = Math.min(...here.objs.map(o => Math.abs(o.x - q.x) - o.len / 2));
        stats.splashLanding.total++;
        stats.splashLanding.missBy.push(+missBy.toFixed(3));
        if (missBy < BODY_HALF) stats.splashLanding.bodyOnLog++;   // part of the body was over the log
        if (missBy < SLACK - 1e-9) breakInv('a landing within the slack fell in the water', { missBy });
      }
      if ((cause === 'fall' || cause === 'splash') && (here.kind === 'bridge' || here.kind === 'cliff')) {
        const pl = here.planks.get(Math.round(q.x));
        if (pl && Number.isFinite(pl.breakAt) && pl.breakAt > 0) {   // a plank that broke under the player (not a landing in a gap)
          stats.planks.falls++;
          if (hopBefore && !landing) stats.planks.inTheAir++;
          if (hopBefore && !landing && VERSION >= 3) breakInv('a plank dropped a player in the air', { x: q.x, t, tick });
          const stood = G.worldTick - (pl.breakAt - PLANK_BREAK);
          stats.planks.crackedTicksMin = Math.min(stats.planks.crackedTicksMin, stood);
          if (stood < PLANK_BREAK) breakInv('a plank broke sooner than PLANK_BREAK', { stood });
        }
      }
    },
    land() { last.landTick = tick; },
    edge() { last.edgeTick = tick; stats.edgeWarnings++; }
  };
  const rules = makeRules({ G, lane, coins() {}, over() { G.state = 'over'; }, players, fx });
  resetPlayer(p);
  if (far) {   // a far start: on a grass row of a random far stretch, the view with it
    let r = far;
    while (lane(r).kind !== 'grass' || lane(r).trees.has(0)) r++;
    p.row = p.score = r; p.x = 0; G.camRow = r - 1;
  }
  const hot = new Set();
  let nextMove = 30;
  while (G.state === 'play' && tick < MAX_TICKS) {
    tick++; G.worldTick++;
    // the player: a move every few ticks, mostly forward, sometimes sideways or back
    if (tick >= nextMove && !p.hop) {
      const r = rnd(), [dx, dr] = r < 0.62 ? [0, 1] : r < 0.8 ? [-1, 0] : r < 0.98 ? [1, 0] : [0, -1];
      const before = p.hop, onLog = p.log;
      rules.tryMove(p, dx, dr);
      if (!p.hop && !before && p.alive) {   // refused: why? (rules 3 starts a forward or back hop from a log that the edge refused at the last column)
        const target = lane(p.row + dr);
        const fromX = onLog && dx === 0 && VERSION >= 3 ? Math.max(-PLAY_HALF, Math.min(PLAY_HALF, p.x)) : p.x;
        const tx = Math.round(fromX + dx);
        const why = Math.abs(tx) > PLAY_HALF ? 'edge' : target && target.trees && target.trees.has(tx) ? 'tree' : 'other';
        stats.refused[why]++;
        if (onLog && why === 'edge') {
          if (dr !== 0) last.refusedForwardTick = tick; else last.refusedSideTick = tick;
          if (dr !== 0 && VERSION >= 3) breakInv('a forward or back hop from a log refused for the edge', { x: p.x, dr, tick });
        }
      }
      nextMove = tick + 6 + Math.floor(rnd() * (rnd() < 0.2 ? 120 : 40));
    }
    G.playT += STEP;
    G.camRow = creepCamera(G.camRow, G.playT, p.row, STEP);
    const w = G.worldTick * STEP;
    const fresh = new Set(hot);   // the rows that were moved on the step before (a row that was not is moved here by many steps at once)
    for (const r of touchRows(players, hot)) {
      const l = lane(r), wasHot = fresh.has(r);
      if (l.kind === 'rail') {
        const wasX = l.train.x, wasActive = l.train.active;
        l.train.active = railStep(l, w);
        if (wasHot && l.train.active && wasActive && wasX !== undefined) {
          stats.maxStepMove.train = Math.max(stats.maxStepMove.train, Math.abs(l.train.x - wasX));
          stats.minHitWidth.train = Math.min(stats.minHitWidth.train, 2 * (l.train.len / 2 + HIT_PAD));
        }
      } else for (const o of l.objs) {
        const was = o.x;
        o.x = trafficX(l, o, w);
        if (wasHot && was !== undefined && Math.abs(o.x - was) < l.span / 2) {
          const k = l.kind === 'river' ? 'log' : 'car';
          stats.maxStepMove[k] = Math.max(stats.maxStepMove[k], Math.abs(o.x - was));
          if (k === 'car') stats.minHitWidth.car = Math.min(stats.minHitWidth.car, 2 * (o.len / 2 + HIT_PAD));
        }
      }
    }
    prevX = p.x;
    hopTwoBefore = hopBefore;
    hopBefore = p.hop ? { ...p.hop } : null;
    rules.stepPlayer(p, STEP);
    // a rider moves with its log, exactly (the wrap of the log aside); the first step after a landing snaps the rider to
    // the middle of a log segment instead (sim.js landOnRiver sets logOff; stand() applies it on the next step)
    if (p.alive && p.log && prevLog === p.log && !p.hop && !hopBefore && !hopTwoBefore) {
      const dl = p.log.x - prevLogX, dp = p.x - prevX;
      if (Math.abs(dl) < 1 && Math.abs(dp - dl) > 1e-9) {
        stats.riderJumps++;
        breakInv('rider not with its log', { dl, dp, x: p.x, logX: p.log.x, logOff: p.logOff, magnet: p.magnetT || 0, safeT: p.safeT || 0, kind: lane(p.row).kind, inRow: lane(p.row).objs.includes(p.log), tick });
      }
    }
    prevLog = p.log; prevLogX = p.log ? p.log.x : 0;
  }
  stats.runs++; stats.ticks += tick;
}

for (let i = 0; i < RUNS; i++) playRun((SEED * 7919 + i * 104729) >>> 0, i % 2 ? 30 + Math.floor(rnd() * 150) : 0);

// the invariants that hold by construction must hold
if (stats.maxStepMove.car >= stats.minHitWidth.car) breakInv('a car can skip through a player in one step', stats.maxStepMove);
if (stats.maxStepMove.train >= stats.minHitWidth.train) breakInv('a train can skip through a player in one step', stats.maxStepMove);
const ws = stats.swept.warnedSeconds.sort((a, b) => a - b);
stats.swept.warnedSeconds = ws.length ? { n: ws.length, p10: +ws[Math.floor(ws.length * 0.1)].toFixed(3), median: +ws[Math.floor(ws.length / 2)].toFixed(3) } : { n: 0 };
const miss = stats.splashLanding.missBy;
stats.splashLanding.missBy = { n: miss.length, under0_1: miss.filter(m => m < 0.1).length, under0_2: miss.filter(m => m < 0.2).length, under0_31: miss.filter(m => m < BODY_HALF).length, under0_5: miss.filter(m => m < 0.5).length };
console.log(JSON.stringify(stats, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(stats, null, 1));
if (stats.broken.length) { console.error('hazard-audit: ' + stats.broken.length + ' invariant(s) broken'); process.exit(1); }
