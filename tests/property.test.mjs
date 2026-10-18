// Property tests for the one promise the game cannot break: a run plays out the same everywhere.
// Part 1 (node, thousands of cases): random replays through the codec and the simulator.
// Part 2 (browser, a few cases; PROP_RUNS=n for more): random play in the real page, then the same replay
// through sim.js (what the score server runs) must end on the same tick, row, cause, score and x.
// Run: node tests/property.test.mjs        PROP_RUNS=20 node tests/property.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { serve } from './serve.mjs';
import { ROOT, T, launch, open as openPage, waitState, settle, hopKey, snapP1, waitTicks } from './browser.mjs';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';
import { EDGE_DEATH, MAX_RUN_TICKS, MODES, RULES, TRAITS } from '../js/rules.js';

const ANIMALS = ['frog', ...Object.keys(TRAITS)];
const NODE_RUNS = Number(process.env.PROP_NODE_RUNS || 2000);
const BROWSER_RUNS = Number(process.env.PROP_RUNS || 3);
const BROWSER_RUNS2 = Number(process.env.PROP_RUNS2 || 2);   // two-player cases (P5)

// a random replay: the shape the codec accepts (events as [tick, player, dx, dr], ticks going up)
const arbReplay = fc.record({
  version: fc.integer({ min: 2, max: RULES }),   // every rules version a link can carry
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  mode: fc.constantFrom(...MODES),
  chars: fc.tuple(fc.constantFrom(...ANIMALS), fc.constantFrom(...ANIMALS)),
  joined: fc.constantFrom([true, false], [false, true], [true, true]),
  handicap: fc.constantFrom(0, 1, 2),
  startTick: fc.integer({ min: 0, max: 120 * 60 }),
  gaps: fc.array(fc.tuple(fc.integer({ min: 0, max: 400 }), fc.constantFrom(0, 1), fc.constantFrom([0, 1], [0, -1], [1, 0], [-1, 0])), { maxLength: 300 })
}).map(r => {
  let t = 0;
  const events = r.gaps.map(([gap, who, [dx, dr]]) => { t += gap; return [t, r.joined[who] ? who : r.joined.indexOf(true), dx, dr]; });
  return { version: r.version, seed: r.seed, mode: r.mode, chars: r.chars, joined: r.joined, handicap: r.handicap, startTick: r.startTick, events };
});

const finite = n => typeof n === 'number' && Number.isFinite(n);

test('P1. codec round trip: encode then decode gives back the same replay', () => {
  fc.assert(fc.property(arbReplay, rp => {
    const back = decodeReplay(encodeReplay(rp));
    assert.ok(back, 'decodes');
    assert.deepEqual({ ...back, events: undefined }, { ...rp, events: undefined });
    assert.deepEqual(back.events, rp.events);
    assert.equal(encodeReplay(back), encodeReplay(rp), 'encoding is stable');
  }), { numRuns: NODE_RUNS });
});

test('P2. the simulator is deterministic, bounded and total on random replays', () => {
  fc.assert(fc.property(arbReplay, rp => {
    const a = simulate(rp), b = simulate(decodeReplay(encodeReplay(rp)));
    assert.ok(a, 'a run of at most 300 events ends within the tick budget');
    assert.deepEqual(a, b, 'the same replay gives the same run, through the codec too');
    assert.ok(a.over, 'the run ends in a game over');
    assert.ok(finite(a.endTick) && a.endTick >= 0 && a.endTick <= MAX_RUN_TICKS, 'end tick (play ticks) in range');
    assert.ok(finite(a.score) && a.score >= 0, 'score');
    const hops = rp.events.length;
    for (const [i, p] of a.players.entries()) {
      if (!p.joined) { assert.equal(a.scores[i], 0); continue; }
      assert.ok(finite(p.row) && finite(p.x) && finite(p.score) && finite(p.coins), 'player numbers');
      assert.ok(p.score <= hops * 2, 'a score needs hops (a spring hop counts two rows)');   // never more rows than hops can give
      assert.ok(Math.abs(p.x) <= EDGE_DEATH + 0.6, 'inside the field, or just swept off it on a log');
      assert.ok(!p.alive || (rp.mode === 'race'), 'at game over everyone is dead, except the survivor of a race');
    }
    assert.ok(a.score === Math.max(...a.scores), 'the run score is the best player score');
  }), { numRuns: NODE_RUNS });
});

test('P3. a replay cut short ends no later, and the same way up to the cut', () => {
  fc.assert(fc.property(arbReplay, fc.integer({ min: 0, max: 300 }), (rp, cut) => {
    const full = simulate(rp);
    const part = simulate({ ...rp, events: rp.events.slice(0, cut) });
    assert.ok(full && part);
    if (cut >= rp.events.length) { assert.deepEqual(part, full); return; }
    const cutTick = rp.events[cut][0];   // play ticks, like endTick
    // the two runs are identical until the first dropped hop: if the full run ended before it, the short one is the same run
    if (full.endTick < cutTick) assert.deepEqual(part, full);
  }), { numRuns: Math.min(NODE_RUNS, 500) });
});

// ---------- part 2: the real page against sim.js ----------
let browser, site, INDEX = '';
test.before(async () => { if (BROWSER_RUNS + BROWSER_RUNS2 > 0) { browser = await launch(); site = await serve(ROOT); INDEX = site.url + '/index.html'; } });
test.after(async () => { await browser?.close(); await site?.close(); });

// a small seeded generator for the key sequence, so a failing case prints its seed and can be run again
const lcg = s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const KEYS = ['KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyA', 'KeyD', 'KeyS', 'wait'];
const snap = snapP1;

for (let n = 0; n < BROWSER_RUNS; n++) {
  test(`P4.${n + 1} random play in the browser ends as sim.js says it does`, { timeout: 300000 }, async () => {
    const caseSeed = (Number(process.env.PROP_SEED || 7) + n * 7919) >>> 0;
    const rnd = lcg(caseSeed);
    const worldSeed = Math.floor(rnd() * 1e6);
    const phone = rnd() < 0.5;
    const { context, page, errors } = await openPage(browser, `${INDEX}#debug-seed-${worldSeed}`, phone ? { phone: true } : { context: { viewport: { width: 1280, height: 800 } } });
    try {
      await waitState(page, 'attract');
      await settle(page, Math.round(rnd() * 1500));   // a random wait on the title: the world clock must not matter
      await page.keyboard.press('KeyW');
      await waitState(page, 'play');
      const plan = [];
      for (let i = 0; i < 60 && (await page.evaluate(() => window.hopLanes.state)) === 'play'; i++) {
        const k = KEYS[Math.floor(rnd() * KEYS.length)];
        plan.push(k);
        if (k === 'wait') await waitTicks(page, 60 + Math.floor(rnd() * 300));   // stand still: logs drift, the eagle comes
        else await hopKey(page, k);
      }
      await page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 120000 });
      const end = await snap(page);
      const run = await page.evaluate(() => ({ record: window.hopLanes.record, startTick: window.hopLanes.startTick }));
      const rp = { seed: end.seed, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: run.startTick, events: run.record };
      const sim = simulate(decodeReplay(encodeReplay(rp)));
      const info = `case seed ${caseSeed}, world ${worldSeed}, ${phone ? 'phone' : 'desktop'}, keys ${plan.join(' ')}`;
      assert.ok(sim, 'sim.js finishes the run (' + info + ')');
      assert.deepEqual(
        { tick: sim.endTick, row: sim.row, cause: sim.cause, score: sim.scores[0], x: Math.round(sim.players[0].x * 1000) },
        { tick: end.tick, row: end.row, cause: end.cause, score: end.score, x: end.x },
        'sim.js plays the run as the browser did (' + info + ')');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

// ---------- part 3: two players, the two-player modes ----------
// The leader slowdown, the versus bomb, race, coin war and tag only exist with both players joined.
const MODES2 = ['classic', 'race', 'coinwar', 'tag'];
const CHAR_KEYS = ['frog', 'fox', 'bunny', 'cat', 'robot', 'pig', 'penguin', 'turtle'];   // models.js CHARACTERS order (charIndex)
const KEYS2 = [
  ['KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyA', 'KeyD', 'KeyS', 'wait'],
  ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'wait']
];
// Presses a move key for player i and waits until that hop was recorded and landed, or the player died, or the game ended.
async function hopKey2(page, i, key) {
  const n = await page.evaluate(() => window.hopLanes.record.length);
  await page.keyboard.press(key);
  await page.waitForFunction(([j, k]) => window.hopLanes.state !== 'play' || !window.hopLanes.players[j].alive || window.hopLanes.record.length > k, [i, n], { timeout: T });
  await page.waitForFunction(([j]) => window.hopLanes.state !== 'play' || !window.hopLanes.players[j].alive || !window.hopLanes.players[j].hop, [i], { timeout: T });
}
const snap2 = page => page.evaluate(() => {
  const h = window.hopLanes;
  return {
    tick: h.playTick, seed: h.seed, mode: h.mode, title: document.getElementById('resTitle').textContent,
    players: h.players.map(p => ({ joined: p.joined, alive: p.alive, row: p.row, score: p.score, cause: p.cause, x: Math.round(p.x * 1000), coins: p.coins, charIndex: p.charIndex }))
  };
});

for (let n = 0; n < BROWSER_RUNS2; n++) {
  test(`P5.${n + 1} two-player random play in the browser ends as sim.js says it does`, { timeout: 300000 }, async () => {
    const caseSeed = (Number(process.env.PROP_SEED2 || 11) + n * 7919) >>> 0;
    const rnd = lcg(caseSeed);
    const worldSeed = Math.floor(rnd() * 1e6);
    const mode = MODES2[Math.floor(rnd() * MODES2.length)];
    const phone = rnd() < 0.5;
    const { context, page, errors } = await openPage(browser, `${INDEX}#debug-seed-${worldSeed}`, {
      storage: { 'hoplanes.mode': mode },
      ...(phone ? { phone: true } : { context: { viewport: { width: 1280, height: 800 } } })
    });
    const plan = [];
    const info = () => `case seed ${caseSeed}, world ${worldSeed}, mode ${mode}, ${phone ? 'phone' : 'desktop'}, keys ${plan.join(' ')}`;
    try {
      await waitState(page, 'attract');
      assert.equal(await page.evaluate(() => window.hopLanes.mode), mode, 'the saved mode is the mode (' + info() + ')');
      await settle(page, Math.round(rnd() * 1500));   // a random wait on the title: the world clock must not matter
      await page.keyboard.press('KeyW');       // player 1 joins (attract -> countdown)
      await page.keyboard.press('ArrowUp');    // player 2 joins during the countdown
      await waitState(page, 'play');
      assert.deepEqual(await page.evaluate(() => window.hopLanes.players.map(p => p.joined)), [true, true], 'both joined (' + info() + ')');
      for (let i = 0; i < 90 && (await page.evaluate(() => window.hopLanes.state)) === 'play'; i++) {
        const who = rnd() < 0.5 ? 0 : 1;
        const k = KEYS2[who][Math.floor(rnd() * KEYS2[who].length)];
        if (k === 'wait') { plan.push('wait'); await waitTicks(page, 60 + Math.floor(rnd() * 300)); continue; }
        if (!(await page.evaluate(j => window.hopLanes.players[j].alive, who))) { plan.push(`(${k})`); continue; }   // a dead player's keys do nothing
        plan.push(k);
        await hopKey2(page, who, k);
      }
      await page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 120000 });
      const end = await snap2(page);
      const run = await page.evaluate(() => ({ record: window.hopLanes.record, startTick: window.hopLanes.startTick }));
      const chars = end.players.map(p => CHAR_KEYS[p.charIndex]);
      const rp = { seed: end.seed, mode, chars, joined: [true, true], handicap: 0, startTick: run.startTick, events: run.record };
      const sim = simulate(decodeReplay(encodeReplay(rp)));
      assert.ok(sim, 'sim.js finishes the run (' + info() + ')');
      assert.deepEqual(
        { tick: sim.endTick, row: sim.row, cause: sim.cause },
        { tick: end.tick, row: end.players[0].row, cause: end.players[0].cause },
        'sim.js ends the run as the browser did (' + info() + ')');
      for (const i of [0, 1]) {
        assert.deepEqual(
          { score: sim.players[i].score, x: Math.round(sim.players[i].x * 1000), coins: sim.players[i].coins },
          { score: end.players[i].score, x: end.players[i].x, coins: end.players[i].coins },
          `sim.js plays player ${i + 1} as the browser did (` + info() + ')');
      }
      // sim.winner is decided the moment the run ends, like the page's results (in a race the other player can still
      // die to the same car later in that step, so the players after the step cannot tell who survived)
      const title = sim.winner !== null ? `${chars[sim.winner].toUpperCase()} WINS!` : 'TIE GAME!';
      const states = `sim ${JSON.stringify(sim.players)} page ${JSON.stringify(end.players)} replay ${encodeReplay(rp)}`;
      assert.equal(end.title, title, 'the results name the winner sim.js picks (' + info() + '; ' + states + ')');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
