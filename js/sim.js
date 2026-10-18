// The run itself, without a screen: hops, logs, cars, trains, water, the eagle, the shield and the scroll line.
// No DOM, no Three.js. players.js plays these rules in the browser (makeRules with effect hooks that move meshes and
// make sounds); simulate() plays a replay with no effects, so the score server can check a posted score.
// Everything here is step-driven (fixed STEP), so the browser and simulate() give the same run tick for tick.
import { HIT_PAD_BODY, LEASH_CAM, LEASH_ROWS, NEAR_MISS_BODY, REJOIN_TICKS, isStill, BEHIND_LIMIT, BOMB_TICKS, CAM_CATCH_RATE, CAM_CATCH_ROWS, CAM_CREEP, CAM_CREEP_GAIN, CAM_CREEP_MAX, COMBO_EVERY, HOP_MID, LOG_SLACK, LOG_SLACK_BODY, MAX_RUN_TICKS, RULES, RESCUE_HOP, START_X, COUNTDOWN, COMBO_GAP, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, EDGE_DEATH, HIT_PAD, HOP_TIME, LEAD_FROM, LEAD_GAP, LEAD_SLOW, MAGNET_REACH, MAGNET_TIME, NEAR_MISS, PLAY_HALF, SHIELD_TIME, SLIDE_TIME, SPRING_HOP, STEP, PLANK_BACK, PLANK_BREAK, TAG_BOOST, hopTarget, hopTime, isBombPower, isWater, plankState, traitOf } from './rules.js';
import { createWorldGen, railStep, trafficX } from './gen.js';

// rules 4 added: leashed(p, other) a forward hop refused by the couch leash; rejoin(p, eagle) a dead player is back
// (eagle: the eagle that carried it off, or null); trait(p, key) an animal's edge saved it ('robot': it shook off the
// eagle, still in p.eagle during the call; 'cat': its extra life)
const RULE_HOOKS = ['hop', 'combo', 'kill', 'rescue', 'shield', 'power', 'coin', 'land', 'hopPose', 'stand', 'warn', 'eagle', 'swoop', 'label', 'near', 'lives', 'teleport', 'bomb', 'unbomb', 'edge', 'leashed', 'rejoin', 'trait'];
// a player's run state, as it is when the animal appears on row 0. p.trait (rules.js traitOf) is set by the caller first.
function resetPlayer(p) {
  p.trait = p.trait || {};
  Object.assign(p, {
    x: START_X[p.id], row: 0, alive: true, hop: null, queue: null, score: 0, idleT: 0, warned: false, eagle: null,
    facing: 0, cause: '', log: null, logOff: 0, trainDir: 0, combo: 0, lastHop: -9, shield: false, safeT: 0, magnetT: 0,
    coins: 0, lives: p.trait.lives || 0, nearSeen: new Set(), nearRow: null, lead: false, edgeWarned: false,
    rejoinT: 0, rejoined: false, shook: false   // rules 4: steps until the hop back in (0: none due), once per run; the robot's one shake
  });
}
// the camera's scroll line: it creeps forward on its own, and catches up fast to a player who runs ahead.
// (app.js updateCamera does the same in the browser; smoke test 5c checks the two agree.)
function creepCamera(camRow, playT, lead, dt) {
  camRow += Math.min(CAM_CREEP_MAX, CAM_CREEP + playT * CAM_CREEP_GAIN) * dt;
  if (lead - CAM_CATCH_ROWS > camRow) camRow += (lead - CAM_CATCH_ROWS - camRow) * Math.min(1, dt * CAM_CATCH_RATE);
  return camRow;
}
// the row the scroll line follows (creepCamera's lead): the front player's row. Rules 4, two players alive, not race:
// the couch leash, at most LEASH_CAM rows past the trailing player's scroll target (creepCamera follows lead - CAM_CATCH_ROWS).
// version: the rules version of the run. (app.js updateCamera calls this too.)
function camLead(players, mode, version) {
  let lead = -Infinity, trail = Infinity, alive = 0;
  for (const p of players) if (p.joined && p.alive) { lead = Math.max(lead, p.row); trail = Math.min(trail, p.row); alive++; }
  if ((version || RULES) < 4 || alive < 2 || mode === 'race') return lead;
  return Math.min(lead, trail + LEASH_CAM + CAM_CATCH_ROWS);
}
// facing: 0 = forward (-z), PI = back, +PI/2 = left, -PI/2 = right
const facingOf = (dx, dr) => (dr > 0 ? 0 : dr < 0 ? Math.PI : (dx > 0 ? -Math.PI / 2 : Math.PI / 2));
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

// The rules of a player. W = { G, lane(r), coins(n), over(), players, fx }: G holds state, mode, camRow, playT, worldTick, run (stats or null)
// and rules (the rules version the run is played with: rules.js RULES when left out);
// lane(r) is the lane data of row r (gen.js plus the moving state: o.x, train.x/active, coins, power);
// fx holds optional effect hooks (meshes, sounds, particles), called at the points where the old code made them.
function makeRules(W) {
  const G = W.G, fx = {};
  for (const k of RULE_HOOKS) fx[k] = (W.fx && W.fx[k]) || (() => {});

  const players = W.players || [];
  const rules3 = () => (G.rules || RULES) >= 3;
  const rules4 = () => (G.rules || RULES) >= 4;
  const others = p => players.filter(q => q !== p && q.joined && q.alive);
  const bothJoined = () => players.length === 2 && players[0].joined && players[1].joined;
  const partnerOf = p => (players[0] === p ? players[1] : players[0]);   // only with bothJoined()
  // rules 4, two players, not race: the leash and the hop back in
  const couch = () => rules4() && G.mode !== 'race' && bothJoined();
  const behindLimit = p => BEHIND_LIMIT + (p.trait.behind || 0);
  // two players (not race or tag): far out, a leader well ahead hops slower so the other can catch up
  // (runs every step for both players: no arrays here)
  function leading(p) {
    if (G.mode === 'race' || G.mode === 'tag' || p.row < LEAD_FROM || !bothJoined()) return false;
    const q = players[0] === p ? players[1] : players[0];
    return q.alive && p.row - q.row >= LEAD_GAP;
  }
  function giveShield(p) { p.shield = true; fx.shield(p); }
  function payCoins(p, n) { p.coins += n; W.coins(n); }
  // the bombs in play: a blocked column (a tree the other player can not hop onto) until a world tick
  // (kept by row: the lane is looked up again when the bomb goes, so a row that was dropped and rebuilt is no trouble;
  // a bomb on water blocks nothing, hopTarget lets logs decide there, so the picker gets a shield instead)
  const bombs = [];
  function dropBomb(p, other) {
    const r = other.row + 1, lane = W.lane(r);
    if (!lane || isWater(lane.kind)) return false;
    const x = Math.max(-PLAY_HALF, Math.min(PLAY_HALF, Math.round(other.x)));
    const same = bombs.find(b => b.r === r && b.x === x);
    if (same) { same.until = G.worldTick + BOMB_TICKS; fx.bomb(p, other, lane, x); return true; }   // the rock stays longer
    const own = !lane.trees.has(x);   // a tree already there stays a tree when the bomb goes
    if (own) lane.trees.add(x);
    bombs.push({ r, x, own, until: G.worldTick + BOMB_TICKS });
    fx.bomb(p, other, lane, x);
    return true;
  }
  function liftBomb(b) {
    const lane = W.lane(b.r);
    if (!lane) return;
    if (b.own) lane.trees.delete(b.x);
    fx.unbomb(lane, b.x);
  }
  function stepBombs() {
    for (let i = bombs.length - 1; i >= 0; i--) {
      if (G.worldTick < bombs[i].until) continue;
      liftBomb(bombs.splice(i, 1)[0]);
    }
  }
  // a new game: no bomb carries over (the browser keeps one rules object for every game)
  function reset() { for (const b of bombs) liftBomb(b); bombs.length = 0; }
  function pickPower(p, lane) {
    const pw = lane.power;
    lane.power = null;
    let kind = pw.kind;
    if (isBombPower(kind, lane.r, bothJoined(), G.rules || RULES)) {   // two players: this magnet is a bomb (world.js draws it so)
      const other = others(p)[0];
      kind = other && dropBomb(p, other) ? 'bomb' : 'shield';   // nobody to bomb, or water ahead of them: a shield for the picker
    }
    if (kind === 'shield') giveShield(p); else if (kind === 'magnet') p.magnetT = MAGNET_TIME * (p.trait.magnet || 1);
    if (G.run) G.run.powers++;
    fx.power(p, lane, { ...pw, kind });
  }
  function collectCoin(p, lane, x, coin) {
    lane.coins.delete(x);
    const secret = lane.secret === x;
    payCoins(p, secret ? 3 : 1);
    if (secret && G.run) G.run.secrets++;
    fx.coin(p, lane, x, coin, secret);
  }
  // the shield takes one hit: the player hops back to the nearest solid row behind and can not be hit for a moment.
  // Returns false (the hit kills after all) when there is no solid row behind.
  function rescue(p) {
    let r = null;
    for (let k = p.row - 1; k >= G.camRow - behindLimit(p); k--) {
      const l = W.lane(k);
      if (l && !isWater(l.kind)) { r = k; break; }
    }
    if (r === null) return false;
    p.shield = false;
    p.safeT = SHIELD_TIME;
    const tx = Math.max(-PLAY_HALF, Math.min(PLAY_HALF, Math.round(p.x)));
    p.hop = { t: 0, dur: HOP_TIME * RESCUE_HOP, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -r, carry: null, carryX0: 0, span: 0 };
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
    p.facing = facingOf(dx, dr);
    const from = W.lane(p.row);
    const spring = dr === 1 && !!from && from.kind === 'spring';   // a spring throws a forward hop two rows on
    if (spring) dr = 2;
    const tx = hopTo(p, dx, dr);
    if (tx === null) return;
    if (p.row + dr < G.camRow - behindLimit(p) || leashed(p, dr)) return;
    const dur = hopDuration(p, from, spring);
    p.hop = {
      t: 0, dur, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -(p.row + dr),
      carry: p.log, carryX0: p.log ? p.log.x : 0, span: p.log ? from.span : 0, dx, dr, high: spring,
      mud: !!from && from.kind === 'mud'   // for the sound: a slow hop is not always a muddy one (the leader is slowed too)
    };
    p.row += dr;
    p.idleT = 0; p.warned = false;
    if (p.row > p.score) { p.score = p.row; if (G.run) G.run.row = Math.max(G.run.row, p.score); }
    if (G.run) G.run.hops++;
    // quick hops in a row build a combo; every COMBO_EVERY hops of it pay a coin
    p.combo = G.playT - p.lastHop < COMBO_GAP * (p.trait.comboGap || 1) ? p.combo + 1 : 1;
    p.lastHop = G.playT;
    comboStep(p);
    fx.hop(p);
  }
  // where a hop lands (rules.js hopTarget), or null. Rules 3: a log can carry the rider past the last column; a forward
  // or back hop from there goes to the last column (rules 2 refused it, and the rider was swept away)
  function hopTo(p, dx, dr) {
    const lane = W.lane(p.row + dr);
    const tx = hopTarget(lane, p.x, dx, PLAY_HALF);
    if (tx !== null || !p.log || dx !== 0 || !rules3()) return tx;
    return hopTarget(lane, Math.max(-PLAY_HALF, Math.min(PLAY_HALF, p.x)), dx, PLAY_HALF);
  }
  // rules 4, the couch leash: a forward hop that would put this player more than LEASH_ROWS rows past the other
  // (alive) one is refused
  function leashed(p, dr) {
    if (dr <= 0 || !couch()) return false;
    const q = partnerOf(p);
    if (!q.alive || p.row + dr - q.row <= LEASH_ROWS) return false;
    fx.leashed(p, q);
    return true;
  }
  // how long a hop from `from` takes: mud is slow, the bunny quick; tag, a spring and the two-player leader change it
  function hopDuration(p, from, spring) {
    let dur = hopTime(from && from.kind, HOP_TIME) * (p.trait.hop || 1);
    if (G.mode === 'tag' && others(p).some(q => q.row > p.row)) dur *= TAG_BOOST;   // tag: the one behind is faster
    if (spring) dur *= SPRING_HOP;
    if (leading(p)) dur *= LEAD_SLOW;
    return dur;
  }
  function comboStep(p) {
    if (G.run) G.run.combo = Math.max(G.run.combo, p.combo);
    if (p.combo >= COMBO_EVERY && p.combo % COMBO_EVERY === 0) { payCoins(p, 1); fx.combo(p); }
  }
  // a car or boulder that passes just short of a hit: +1 combo (coins only; the run itself is the same)
  function nearMiss(p, o) {
    p.nearSeen.add(o);
    p.combo = Math.max(1, p.combo) + 1;
    p.lastHop = G.playT;
    if (G.run) G.run.nears++;
    comboStep(p);
    fx.near(p);
  }
  function kill(p, cause) {
    if (!p.alive) return;
    // just after a rescue cars and trains pass through you, but water still does not hold you up
    if ((cause === 'squash' || cause === 'train' || cause === 'twister') && p.safeT > 0) return;
    if ((cause === 'squash' || cause === 'train' || cause === 'twister' || cause === 'splash' || cause === 'fall') && p.shield && rescue(p)) return;
    if (cause === 'splash' && p.lives > 0 && rescue(p)) { p.lives--; fx.lives(p); fx.trait(p, 'cat'); return; }   // the cat's extra life
    p.alive = false; p.cause = cause; p.hop = null;
    // rules 4, two players (not race): the first death comes back in REJOIN_TICKS steps if the partner lives on
    if (couch() && !p.rejoined && G.state === 'play' && partnerOf(p).alive) p.rejoinT = REJOIN_TICKS;
    fx.kill(p, cause);
    W.over();
  }
  // rules 4: the hop back in, counted down by the partner's steps (the partner is alive, or no rejoin comes). It lands
  // on still ground at the partner's row, the row ahead of it or the row behind, on the nearest free column, and
  // blinks (safe) for SHIELD_TIME; with no such place yet it tries again the next step. The score goes on from there.
  function stepRejoin(p) {
    const q = partnerOf(p);
    if (q.alive || !q.rejoinT || --q.rejoinT > 0) return;
    const spot = rejoinSpot(q, p);
    if (!spot) { q.rejoinT = 1; return; }
    const eagle = q.eagle;
    Object.assign(q, { alive: true, cause: '', row: spot.r, x: spot.x, hop: null, queue: null, log: null, logOff: 0, eagle: null, facing: 0,
      idleT: 0, warned: false, combo: 0, safeT: SHIELD_TIME, magnetT: 0, nearRow: null, lead: false, edgeWarned: false, rejoined: true });
    q.nearSeen.clear();
    fx.rejoin(q, eagle);
  }
  function rejoinSpot(q, p) {
    for (const r of [p.row, p.row + 1, p.row - 1]) {
      const lane = W.lane(r);
      if (!lane || !isStill(lane.kind) || r < G.camRow - behindLimit(q) + 1) continue;
      const x = freeColumn(lane, p, r === p.row);
      if (x !== null) return { r, x };
    }
    return null;
  }
  // the free column nearest the partner (not the partner's own one on its row): no tree or bomb, no portal
  function freeColumn(lane, p, sameRow) {
    const px = Math.max(-PLAY_HALF, Math.min(PLAY_HALF, Math.round(p.x)));
    const taken = sameRow ? [px, p.hop ? Math.round(p.hop.tx) : px] : [];
    for (let d = 0; d <= 2 * PLAY_HALF; d++) {
      for (const x of d ? [px + d, px - d] : [px]) {
        if (Math.abs(x) > PLAY_HALF || lane.trees.has(x) || taken.includes(x) || (lane.portals && lane.portals.includes(x))) continue;
        return x;
      }
    }
    return null;
  }
  // The landing helpers return undefined when the landing goes on, or the value land() returns at once: after a fall
  // into water (or off a tile) that is p.alive, which a shield or the cat's extra life can keep true.
  // a river row: on a log, snapped to the centre of the nearest segment so standing feels solid, or in the water
  function landOnRiver(p, lane) {
    const slack = rules3() ? LOG_SLACK_BODY : LOG_SLACK;
    const log = lane.objs.find(o => Math.abs(o.x - p.x) < o.len / 2 + slack);
    if (!log) { kill(p, 'splash'); return p.alive; }
    const k = (log.len - 1) / 2;
    p.logOff = Math.max(-k, Math.min(k, Math.round(p.x - log.x + k) - k));
    p.log = log;
    if (G.run) G.run.logs++;
  }
  // a bridge plank or a cliff tile holds you for PLANK_BREAK steps, then it drops; a broken cliff tile is gone for good
  function landOnPlank(p, lane) {
    const cliff = lane.kind === 'cliff', st = plankState(lane, p.x, G.worldTick);
    if (st === 'down') { kill(p, cliff ? 'fall' : 'splash'); return p.alive; }
    if (st === 'up') { const pl = lane.planks.get(p.x); pl.breakAt = G.worldTick + PLANK_BREAK; pl.backAt = cliff ? Infinity : pl.breakAt + PLANK_BACK; }
  }
  // any other row (lane is undefined past the built rows): pads, planks, portals, then the stats, the coin and the power-up
  function landOnGround(p, lane, from) {
    p.x = Math.round(p.x);
    if (!lane) return;
    if (lane.kind === 'lily' && !lane.pads.has(p.x)) { kill(p, 'splash'); return p.alive; }
    if (lane.kind === 'bridge' || lane.kind === 'cliff') { const stop = landOnPlank(p, lane); if (stop !== undefined) return stop; }
    if (lane.kind === 'portal' && lane.portals.includes(p.x)) {   // a portal column: out of the other one, at once
      const fromX = p.x;
      p.x = lane.portals[lane.portals[0] === p.x ? 1 : 0];
      fx.teleport(p, lane, fromX);
    }
    if (G.run && from && from.kind === 'river' && lane.r > from.r) G.run.rivers++;   // crossed a river
    const coin = lane.coins.get(p.x);
    if (coin) collectCoin(p, lane, p.x, coin);
    if (lane.power && lane.power.x === p.x) pickPower(p, lane);
  }
  // ice: a sideways hop slides one more column the same way, unless a tree or the edge is there (a queued hop waits)
  function startSlide(p, lane, h) {
    if (!(lane && lane.kind === 'ice' && h.dr === 0 && h.dx && !p.trait.noSlide)) return false;
    const tx = hopTarget(lane, p.x, h.dx, PLAY_HALF);
    if (tx === null) return false;
    p.hop = { t: 0, dur: SLIDE_TIME, fromRow: p.row, fx: p.x, fz: -p.row, tx, tz: -p.row, carry: null, carryX0: 0, span: 0, dx: 0, dr: 0, slide: true };
    return true;
  }
  // returns false if the landing killed the player
  function land(p, lane) {
    const h = p.hop, from = W.lane(h.fromRow);
    p.hop = null;
    p.log = null; p.edgeWarned = false;
    const stop = lane && lane.kind === 'river' ? landOnRiver(p, lane) : landOnGround(p, lane, from);
    if (stop !== undefined) return stop;
    fx.land(p, lane);
    if (startSlide(p, lane, h)) return true;
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
  // standing still (or riding a log); returns false if the log carried the player off the edge. Past the last column
  // the rider is warned once (fx.edge: the rapids are near); effects only, the run is the same.
  function stand(p, dt) {
    if (p.log) p.x = p.log.x + p.logOff;
    fx.stand(p, dt);
    if (p.log && Math.abs(p.x) > EDGE_DEATH) { kill(p, 'swept'); return false; }
    const past = !!p.log && Math.abs(p.x) > PLAY_HALF + 0.5;
    if (past && !p.edgeWarned) fx.edge(p);
    p.edgeWarned = past;
    return true;
  }
  // what moves across the row under the player: cars, boulders or the twister (a near miss counts once per car), a
  // train. Returns true if it hit.
  // rules 4: the hit width is smaller (HIT_PAD_BODY: the body overlaps the car), the near-miss band ends where it did
  function hitByTraffic(p, hz) {
    const pad = rules4() ? HIT_PAD_BODY : HIT_PAD, nearBand = rules4() ? NEAR_MISS_BODY : NEAR_MISS;
    if (hz.kind === 'road' || hz.kind === 'rocks' || hz.twister) {   // the twister crosses a grass row
      for (const o of hz.objs) {
        const gap = Math.abs(o.x - p.x) - o.len / 2 - pad;
        // Stryker disable next-line BooleanLiteral: equivalent: after the kill the caller's slow check does nothing (kill() returns at once for a dead player; a shield rescue lands on a row inside the limit)
        if (gap < 0) { kill(p, o.twister ? 'twister' : 'squash'); return true; }
        if (gap < nearBand && !o.twister && !p.nearSeen.has(o)) nearMiss(p, o);
      }
    } else if (hz.kind === 'rail' && hz.train.active) {
      // Stryker disable next-line BooleanLiteral: equivalent: after the kill the caller's slow check does nothing (kill() returns at once for a dead player; a shield rescue lands on a row inside the limit)
      if (Math.abs(hz.train.x - p.x) < hz.train.len / 2 + pad) { p.trainDir = hz.dir; kill(p, 'train'); return true; }
    }
    return false;
  }
  // the plank or tile under the player broke. Rules 3: only under a player who stands on it (one who hopped off is in
  // the air); rules 2 dropped a player in the first half of a hop off it too
  function plankGone(p, hz) {
    if (hz.kind !== 'bridge' && hz.kind !== 'cliff') return false;
    if (p.hop && (p.hop.t >= HOP_MID || rules3())) return false;
    return plankState(hz, Math.round(p.x), G.worldTick) === 'down';
  }
  function checkHazards(p, lane) {
    // until mid-hop the player is still over the row they left
    const hz = p.hop && p.hop.t < HOP_MID ? W.lane(p.hop.fromRow) : lane;
    if (hz) {
      if (plankGone(p, hz)) { kill(p, hz.kind === 'cliff' ? 'fall' : 'splash'); return; }
      if (hz.r !== p.nearRow) { p.nearRow = hz.r; p.nearSeen.clear(); }   // a new row under the player: its cars can each count once
      if (hitByTraffic(p, hz)) return;
    }
    if (p.row < G.camRow - behindLimit(p)) kill(p, 'slow');
  }
  // one fixed step of a live player (the browser calls it from updatePlayer, simulate() directly)
  function stepPlayer(p, dt) {
    if (bombs.length) stepBombs();   // whoever steps first frees a spent bomb
    // first: a partner due back this step is back before anything can kill p (p's death then finds a live partner
    // and gets its own hop back in, instead of a game over with the partner back on the field)
    if (couch() && G.state === 'play') stepRejoin(p);
    if (p.safeT > 0) p.safeT = Math.max(0, p.safeT - dt);
    const ok = p.hop ? stepHop(p, W.lane(p.row), dt) : stand(p, dt);
    if (ok && p.alive && !p.safeT) checkHazards(p, W.lane(p.row));
    if (!p.alive || G.state !== 'play') return;
    if (p.magnetT) { updateMagnet(p, dt); if (!p.magnetT) fx.label(p); }
    const lead = leading(p);
    if (lead !== p.lead) { p.lead = lead; fx.label(p); }
    if (p.combo && !p.hop && G.playT - p.lastHop > COMBO_GAP * (p.trait.comboGap || 1) + 0.2) { p.combo = 0; fx.label(p); }
    stepEagle(p, dt);
  }
  // standing still too long: a warning, then the eagle swoops down; when it arrives it carries the player away
  function stepEagle(p, dt) {
    if (!p.hop) p.idleT += dt;
    const idle = EAGLE_IDLE + (p.trait.idle || 0);
    if (!p.warned && p.idleT > idle - EAGLE_SWOOP - EAGLE_WARN) { p.warned = true; fx.warn(p); }   // move, or the eagle comes
    if (!p.eagle && p.idleT > idle - EAGLE_SWOOP) { p.eagle = { t: 0 }; fx.eagle(p); }
    if (!p.eagle) return;
    p.eagle.t = Math.min(1, p.eagle.t + dt / EAGLE_SWOOP);
    fx.swoop(p);
    if (p.eagle.t >= 1 && !shakeOff(p)) kill(p, 'eagle');
  }
  // rules 4: the robot shakes off its first eagle of the run (fx.trait sees the eagle still in p.eagle), then it waits
  // a whole idle time again
  function shakeOff(p) {
    if (!rules4() || !p.trait.shake || p.shook) return false;
    p.shook = true;
    fx.trait(p, 'robot');
    p.eagle = null; p.idleT = 0; p.warned = false;
    return true;
  }
  return { giveShield, kill, reset, stepPlayer, tryMove };
}

// is the game over? race: the first to die loses, at once; otherwise the game ends when nobody is left
function runOver(players, mode) {
  const both = players[0].joined && players[1].joined;
  const race = mode === 'race' && both && players.some(p => p.joined && !p.alive);
  return race || !players.some(p => p.joined && p.alive);
}
const topScore = players => Math.max(players[0].joined ? players[0].score : 0, players[1].joined ? players[1].score : 0);
// who wins when both played: race, the one still standing; coin war, the most coins; otherwise the higher score. null = tie
function winnerOf(players, mode) {
  const [p1, p2] = players;
  if (!(p1.joined && p2.joined)) return null;
  if (mode === 'race' && p1.alive !== p2.alive) return p1.alive ? p1 : p2;
  const key = mode === 'coinwar' ? 'coins' : 'score';
  return p1[key] === p2[key] ? null : (p1[key] > p2[key] ? p1 : p2);
}

// A replay as a stepping simulation, from the countdown on, exactly as the browser plays it (app.js step()).
// step() advances one fixed STEP and returns false once the game is over. players[i] are the live player states
// (row, x, alive, score, hop { t, dur, fromRow, fx, fz, tx, tz } or null, log, cause): a renderer can draw a ghost
// from them. end is set at game over: { score (the higher score, as posted), scores, coins, endTick (play ticks), winner (index or null) }.
// onHop(tick, player, dx, dr), optional: told of every hop the rules started from a move (fx.hop: not a refused or
// overwritten move, not an ice slide or a rescue), at the play tick it started; dr is the move (1 for a spring's
// two-row hop). The score server stores only these. It changes nothing in the run.
function createSim(rp, { onHop = null } = {}) {
  const gen = createWorldGen(rp.seed, rp.version || RULES);   // the world of the run's rules version
  const lanes = new Map();
  const lane = r => {
    let l = lanes.get(r);
    if (!l) { l = gen.lane(r); lanes.set(r, l); }
    return l;
  };
  // forget the rows nobody can reach any more (a long ghost run would keep every row it saw)
  const prune = () => { for (const r of lanes.keys()) if (r < S.camRow - BEHIND_LIMIT - 3) lanes.delete(r); };   // -3: the turtle stands one row further back
  // the browser starts the world clock so the countdown ends on the recorded tick (startPlay then sets it exactly)
  const S = { state: 'countdown', countdown: COUNTDOWN, mode: rp.mode, rules: rp.version || RULES, camRow: 0, playT: 0, run: null, worldTick: Math.max(0, rp.startTick - Math.ceil(COUNTDOWN / STEP)) };
  let playTick = 0, end = null;
  const players = [0, 1].map(id => ({ id, joined: !!rp.joined[id], alive: false, row: 0, x: 0, score: 0, coins: 0, hop: null, cause: '', trait: traitOf(rp.chars[id]) }));
  const rules = makeRules({
    G: S, lane, coins() {}, players,
    fx: onHop ? { hop: p => onHop(playTick, p.id, p.hop.dx, p.hop.high ? 1 : p.hop.dr) } : null,
    over() {
      if (S.state !== 'play' || !runOver(players, rp.mode)) return;
      S.state = 'over';
      // the winner is decided now, like the results screen: the other player may still die to the same car later in
      // this very step, so the players' alive flags after the step cannot tell who survived a race
      const w = winnerOf(players, rp.mode);
      end = { score: topScore(players), scores: players.map(p => (p.joined ? p.score : 0)), coins: players.map(p => p.coins), endTick: playTick, winner: w ? players.indexOf(w) : null };
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
      S.camRow = creepCamera(S.camRow, S.playT, camLead(players, rp.mode, S.rules), STEP);
    }
    const w = S.worldTick * STEP;
    for (const r of touchRows(players, hot)) {
      const l = lane(r);
      if (l.kind === 'rail') l.train.active = railStep(l, w);
      else for (const o of l.objs) o.x = trafficX(l, o, w);   // cars, logs, boulders, the twister
    }
    for (const p of players) if (p.joined && p.alive) rules.stepPlayer(p, STEP);
    return S.state !== 'over';
  }
  return {
    step, players, lane, prune,
    get tick() { return playTick; }, get worldTick() { return S.worldTick; }, get state() { return S.state; },
    get camRow() { return S.camRow; }, get end() { return end; }
  };
}

// Play a decoded replay (replay.js) to game over. Returns { score (the higher score, as posted), scores, endTick
// (play ticks), row, cause (of the first joined player), over, players: [{ joined, row, x, score, alive, cause }] },
// or null when the run does not end within maxTicks play ticks or takes longer than maxMs of wall-clock time.
// until: stop at that play tick if the run is still on (over: false). onHop: as for createSim.
function simulate(rp, { maxTicks = MAX_RUN_TICKS, maxMs = Infinity, until = Infinity, onHop = null } = {}) {
  const sim = createSim(rp, { onHop });
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
    players: players.map(p => ({ joined: p.joined, row: p.row, x: p.x, score: p.score, coins: p.coins, alive: p.alive, cause: p.cause }))
  };
}

export { camLead, createSim, creepCamera, feedReplay, makeRules, resetPlayer, runOver, simulate, topScore, touchRows, winnerOf };
