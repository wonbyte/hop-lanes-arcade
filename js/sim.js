// The run itself, without a screen: hops, logs, cars, trains, water, the eagle, the shield and the scroll line.
// No DOM, no Three.js. players.js plays these rules in the browser (makeRules with effect hooks that move meshes and
// make sounds); simulate() plays a replay with no effects, so the score server can check a posted score.
// Everything here is step-driven (fixed STEP), so the browser and simulate() give the same run tick for tick.
import { BEHIND_LIMIT, COMBO_EVERY, COUNTDOWN, COMBO_GAP, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, HIT_PAD, HOP_TIME, MAGNET_REACH, MAGNET_TIME, PLAY_HALF, SHIELD_TIME, SLIDE_TIME, STEP, PLANK_BACK, PLANK_BREAK, hopTarget, hopTime, isWater, plankState } from './rules.js';
import { createWorldGen, railStep, trafficX } from './gen.js';

const START_X = [-2, 2];   // the columns the two players start on
const RULE_HOOKS = ['hop', 'combo', 'kill', 'rescue', 'shield', 'power', 'coin', 'land', 'hopPose', 'stand', 'warn', 'eagle', 'swoop', 'label'];
// a player's run state, as it is when the animal appears on row 0
function resetPlayer(p) {
  Object.assign(p, {
    x: START_X[p.id], row: 0, alive: true, hop: null, queue: null, score: 0, idleT: 0, warned: false, eagle: null,
    facing: 0, cause: '', log: null, logOff: 0, trainDir: 0, combo: 0, lastHop: -9, shield: false, safeT: 0, magnetT: 0
  });
}
// the camera's scroll line: it creeps forward on its own, and catches up fast to a player who runs ahead.
// (app.js updateCamera does the same in the browser; smoke test 5c checks the two agree.)
function creepCamera(camRow, playT, lead, dt) {
  camRow += Math.min(1.1, 0.3 + playT * 0.006) * dt;
  if (lead - 2 > camRow) camRow += (lead - 2 - camRow) * Math.min(1, dt * 3);
  return camRow;
}
// the rows whose lanes a player can touch this step (collisions and landings read cars, logs and trains only there)
function touchRows(players, into) {
  into.clear();
  for (const p of players) {
    if (!p.joined) continue;
    for (let r = p.row - 1; r <= p.row + 1; r++) into.add(r);
    if (p.hop) into.add(p.hop.fromRow);
  }
  return into;
}
// the replay feed: every hop due by this play tick, in order
function feedReplay(rp, playTick, move) {
  while (rp.i < rp.events.length && rp.events[rp.i][0] <= playTick) { const [, i, dx, dr] = rp.events[rp.i++]; move(i, dx, dr); }
}

// The rules of a player. W = { G, lane(r), coins(n), over(), fx }: G holds state, camRow, playT, worldTick and run (stats or null);
// lane(r) is the lane data of row r (gen.js plus the moving state: o.x, train.x/active, coins, power);
// fx holds optional effect hooks (meshes, sounds, particles), called at the points where the old code made them.
function makeRules(W) {
  const G = W.G, fx = {};
  for (const k of RULE_HOOKS) fx[k] = (W.fx && W.fx[k]) || (() => {});

  function giveShield(p) { p.shield = true; fx.shield(p); }
  function pickPower(p, lane) {
    const pw = lane.power;
    lane.power = null;
    if (pw.kind === 'shield') giveShield(p); else p.magnetT = MAGNET_TIME;
    if (G.run) G.run.powers++;
    fx.power(p, lane, pw);
  }
  function collectCoin(p, lane, x, coin) {
    lane.coins.delete(x);
    const secret = lane.secret === x;
    W.coins(secret ? 3 : 1);
    if (secret && G.run) G.run.secrets++;
    fx.coin(p, lane, x, coin, secret);
  }
  // the shield takes one hit: the player hops back to the nearest solid row behind and can not be hit for a moment.
  // Returns false (the hit kills after all) when there is no solid row behind.
  function rescue(p) {
    let r = null;
    for (let k = p.row - 1; k >= G.camRow - BEHIND_LIMIT; k--) {
      const l = W.lane(k);
      if (l && !isWater(l.kind)) { r = k; break; }
    }
    if (r === null) return false;
    p.shield = false;
    p.safeT = SHIELD_TIME;
    const tx = Math.max(-PLAY_HALF, Math.min(PLAY_HALF, Math.round(p.x)));
    p.hop = { t: 0, dur: HOP_TIME * 2, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -r, carry: null, carryX0: 0, span: 0 };
    fx.rescue(p);   // before the row changes: the effect starts where the animal was
    p.queue = null; p.log = null; p.row = r;
    return true;
  }
  function updateMagnet(p, dt) {
    p.magnetT = Math.max(0, p.magnetT - dt);
    if (!p.magnetT) return;
    for (let r = p.row - 1; r <= p.row + 1; r++) {
      const lane = W.lane(r);
      if (!lane) continue;
      for (const [x, coin] of lane.coins) if (Math.abs(x - p.x) <= MAGNET_REACH) collectCoin(p, lane, x, coin);
    }
  }
  function tryMove(p, dx, dr) {
    if (!p.alive || p.eagle) return;   // once the eagle is coming there is no escape
    if (p.hop) { p.queue = [dx, dr]; return; }
    // facing: 0 = forward (-z), PI = back, +PI/2 = left, -PI/2 = right
    p.facing = dr > 0 ? 0 : dr < 0 ? Math.PI : (dx > 0 ? -Math.PI / 2 : Math.PI / 2);
    const tx = hopTarget(W.lane(p.row + dr), p.x, dx, PLAY_HALF);
    if (tx === null) return;
    if (p.row + dr < G.camRow - BEHIND_LIMIT) return;
    const from = W.lane(p.row);
    p.hop = {
      t: 0, dur: hopTime(from && from.kind, HOP_TIME), fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -(p.row + dr),
      carry: p.log, carryX0: p.log ? p.log.x : 0, span: p.log ? from.span : 0, dx, dr
    };
    p.row += dr;
    p.idleT = 0; p.warned = false;
    if (p.row > p.score) { p.score = p.row; if (G.run) G.run.row = Math.max(G.run.row, p.score); }
    if (G.run) G.run.hops++;
    // quick hops in a row build a combo; every COMBO_EVERY hops of it pay a coin
    p.combo = G.playT - p.lastHop < COMBO_GAP ? p.combo + 1 : 1;
    p.lastHop = G.playT;
    if (G.run) G.run.combo = Math.max(G.run.combo, p.combo);
    if (p.combo >= COMBO_EVERY && p.combo % COMBO_EVERY === 0) { W.coins(1); fx.combo(p); }
    fx.hop(p);
  }
  function kill(p, cause) {
    if (!p.alive) return;
    // just after a rescue cars and trains pass through you, but water still does not hold you up
    if ((cause === 'squash' || cause === 'train') && p.safeT > 0) return;
    if ((cause === 'squash' || cause === 'train' || cause === 'splash') && p.shield && rescue(p)) return;
    p.alive = false; p.cause = cause; p.hop = null;
    fx.kill(p, cause);
    W.over();
  }
  // returns false if the landing killed the player
  function land(p, lane) {
    const h = p.hop, from = W.lane(h.fromRow);
    p.hop = null;
    p.log = null;
    if (lane && lane.kind === 'river') {
      const log = lane.objs.find(o => Math.abs(o.x - p.x) < o.len / 2 + 0.05);
      if (!log) { kill(p, 'splash'); return p.alive; }
      // snap to the centre of the nearest log segment so standing feels solid
      const k = (log.len - 1) / 2;
      p.logOff = Math.max(-k, Math.min(k, Math.round(p.x - log.x + k) - k));
      p.log = log;
      if (G.run) G.run.logs++;
    } else {
      p.x = Math.round(p.x);
      if (lane && lane.kind === 'lily' && !lane.pads.has(p.x)) { kill(p, 'splash'); return p.alive; }
      if (lane && lane.kind === 'bridge') {   // a plank holds you for PLANK_BREAK steps, then it drops
        const st = plankState(lane, p.x, G.worldTick);
        if (st === 'down') { kill(p, 'splash'); return p.alive; }
        if (st === 'up') { const pl = lane.planks.get(p.x); pl.breakAt = G.worldTick + PLANK_BREAK; pl.backAt = pl.breakAt + PLANK_BACK; }
      }
      if (G.run && from && from.kind === 'river' && lane && lane.r > from.r) G.run.rivers++;   // crossed a river
      const coin = lane && lane.coins.get(p.x);
      if (coin) collectCoin(p, lane, p.x, coin);
      if (lane && lane.power && lane.power.x === p.x) pickPower(p, lane);
    }
    fx.land(p, lane);
    // ice: a sideways hop slides one more column the same way, unless a tree or the edge is there (a queued hop waits)
    if (lane && lane.kind === 'ice' && h.dr === 0 && h.dx) {
      const tx = hopTarget(lane, p.x, h.dx, PLAY_HALF);
      if (tx !== null) {
        p.hop = { t: 0, dur: SLIDE_TIME, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -p.row, carry: null, carryX0: 0, span: 0, dx: 0, dr: 0, slide: true };
        return true;
      }
    }
    if (p.queue) { const [qx, qr] = p.queue; p.queue = null; tryMove(p, qx, qr); }
    return true;
  }
  function stepHop(p, lane, dt) {
    const h = p.hop;
    h.t += dt / h.dur;
    const t = Math.min(1, h.t);
    let drift = 0;
    if (h.carry) {   // a hop that starts on a log moves with the log
      drift = h.carry.x - h.carryX0;
      if (Math.abs(drift) > h.span / 2) drift -= Math.sign(drift) * h.span;   // the log wrapped around
    }
    p.x = h.fx + (h.tx - h.fx) * t + drift;
    fx.hopPose(p, t);
    return t < 1 || land(p, lane);
  }
  // standing still (or riding a log); returns false if the log carried the player off the edge
  function stand(p, dt) {
    if (p.log) p.x = p.log.x + p.logOff;
    fx.stand(p, dt);
    if (p.log && Math.abs(p.x) > EDGE_DEATH) { kill(p, 'swept'); return false; }
    return true;
  }
  function checkHazards(p, lane) {
    // until mid-hop the player is still over the row they left
    const hz = p.hop && p.hop.t < 0.5 ? W.lane(p.hop.fromRow) : lane;
    if (hz && hz.kind === 'bridge' && (!p.hop || p.hop.t < 0.5) && plankState(hz, Math.round(p.x), G.worldTick) === 'down') { kill(p, 'splash'); return; }
    if (hz && (hz.kind === 'road' || hz.kind === 'rocks')) {
      for (const o of hz.objs) if (Math.abs(o.x - p.x) < o.len / 2 + HIT_PAD) { kill(p, 'squash'); return; }
    } else if (hz && hz.kind === 'rail' && hz.train.active) {
      if (Math.abs(hz.train.x - p.x) < hz.train.len / 2 + HIT_PAD) { p.trainDir = hz.dir; kill(p, 'train'); return; }
    }
    if (p.row < G.camRow - BEHIND_LIMIT) kill(p, 'slow');
  }
  // one fixed step of a live player (the browser calls it from updatePlayer, simulate() directly)
  function stepPlayer(p, dt) {
    if (p.safeT > 0) p.safeT = Math.max(0, p.safeT - dt);
    const ok = p.hop ? stepHop(p, W.lane(p.row), dt) : stand(p, dt);
    if (ok && p.alive && !p.safeT) checkHazards(p, W.lane(p.row));
    if (!p.alive || G.state !== 'play') return;
    if (p.magnetT) { updateMagnet(p, dt); if (!p.magnetT) fx.label(p); }
    if (p.combo && !p.hop && G.playT - p.lastHop > COMBO_GAP + 0.2) { p.combo = 0; fx.label(p); }
    if (!p.hop) p.idleT += dt;
    if (!p.warned && p.idleT > EAGLE_IDLE - EAGLE_SWOOP - EAGLE_WARN) { p.warned = true; fx.warn(p); }   // move, or the eagle comes
    if (!p.eagle && p.idleT > EAGLE_IDLE - EAGLE_SWOOP) { p.eagle = { t: 0 }; fx.eagle(p); }
    if (p.eagle) {   // the eagle swoops down; when it arrives it carries the player away
      p.eagle.t = Math.min(1, p.eagle.t + dt / EAGLE_SWOOP);
      fx.swoop(p);
      if (p.eagle.t >= 1) kill(p, 'eagle');
    }
  }
  return { giveShield, kill, stepPlayer, tryMove };
}

// is the game over? race: the first to die loses, at once; otherwise the game ends when nobody is left
function runOver(players, mode) {
  const both = players[0].joined && players[1].joined;
  const race = mode === 'race' && both && players.some(p => p.joined && !p.alive);
  return race || !players.some(p => p.joined && p.alive);
}
const topScore = players => Math.max(players[0].joined ? players[0].score : 0, players[1].joined ? players[1].score : 0);

// A replay as a stepping simulation, from the countdown on, exactly as the browser plays it (app.js step()).
// step() advances one fixed STEP and returns false once the game is over. players[i] are the live player states
// (row, x, alive, score, hop { t, dur, fromRow, fx, fz, tx, tz } or null, log, cause): a renderer can draw a ghost
// from them. end is set at game over: { score (the higher score, as posted), scores, endTick (play ticks) }.
function createSim(rp) {
  const gen = createWorldGen(rp.seed);
  const lanes = new Map();
  const lane = r => {
    let l = lanes.get(r);
    if (!l) { l = gen.lane(r); lanes.set(r, l); }
    return l;
  };
  // the browser starts the world clock so the countdown ends on the recorded tick (startPlay then sets it exactly)
  const S = { state: 'countdown', countdown: COUNTDOWN, camRow: 0, playT: 0, run: null, worldTick: Math.max(0, rp.startTick - Math.ceil(COUNTDOWN / STEP)) };
  let playTick = 0, end = null;
  const players = [0, 1].map(id => ({ id, joined: !!rp.joined[id], alive: false, row: 0, x: 0, score: 0, hop: null, cause: '' }));
  const rules = makeRules({
    G: S, lane, coins() {},
    over() {
      if (S.state !== 'play' || !runOver(players, rp.mode)) return;
      S.state = 'over';
      end = { score: topScore(players), scores: players.map(p => (p.joined ? p.score : 0)), endTick: playTick };
    }
  });
  for (const p of players) if (p.joined) { resetPlayer(p); if (rp.handicap === p.id + 1) rules.giveShield(p); }
  const hot = new Set();
  const feed = { events: rp.events, i: 0 };
  function step() {
    if (S.state === 'over') return false;
    S.worldTick++;
    if (S.state === 'countdown') {
      S.countdown -= STEP;
      if (S.countdown <= 0) { S.state = 'play'; S.playT = 0; playTick = 0; S.worldTick = rp.startTick; }   // screens.js startPlay
    } else {
      playTick++;
      feedReplay(feed, playTick, (i, dx, dr) => rules.tryMove(players[i], dx, dr));
      S.playT += STEP;
      let lead = -Infinity;
      for (const p of players) if (p.joined && p.alive) lead = Math.max(lead, p.row);
      S.camRow = creepCamera(S.camRow, S.playT, lead, STEP);
    }
    const w = S.worldTick * STEP;
    for (const r of touchRows(players, hot)) {
      const l = lane(r);
      if (l.kind === 'rail') l.train.active = railStep(l, w);
      else if (l.kind === 'road' || l.kind === 'river' || l.kind === 'rocks') for (const o of l.objs) o.x = trafficX(l, o, w);
    }
    for (const p of players) if (p.joined && p.alive) rules.stepPlayer(p, STEP);
    return S.state !== 'over';
  }
  return {
    step, players, lane,
    get tick() { return playTick; }, get worldTick() { return S.worldTick; }, get state() { return S.state; },
    get camRow() { return S.camRow; }, get end() { return end; }
  };
}

// Play a decoded replay (replay.js) to game over. Returns { score (the higher score, as posted), scores, endTick
// (play ticks), row, cause (of the first joined player), over, players: [{ joined, row, x, score, alive, cause }] },
// or null when the run does not end within maxTicks play ticks or takes longer than maxMs of wall-clock time.
// until: stop at that play tick if the run is still on (over: false).
function simulate(rp, { maxTicks = 120 * 60 * 61, maxMs = Infinity, until = Infinity } = {}) {
  const sim = createSim(rp);
  const t0 = maxMs < Infinity ? Date.now() : 0;
  let res;
  for (let n = 1; ; n++) {
    if (!sim.step()) { res = { ...sim.end, over: true }; break; }
    if (sim.state !== 'play') continue;
    if (sim.tick >= until) { res = { score: topScore(sim.players), scores: sim.players.map(p => (p.joined ? p.score : 0)), endTick: sim.tick, over: false }; break; }
    if (sim.tick >= maxTicks || (t0 && (n & 1023) === 0 && Date.now() - t0 > maxMs)) return null;
  }
  const players = sim.players, first = players[0].joined ? players[0] : players[1];
  return {
    ...res, row: first.row, cause: first.cause,
    players: players.map(p => ({ joined: p.joined, row: p.row, x: p.x, score: p.score, alive: p.alive, cause: p.cause }))
  };
}

export { createSim, creepCamera, feedReplay, makeRules, resetPlayer, runOver, simulate, topScore, touchRows };
