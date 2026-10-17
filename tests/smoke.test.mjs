// Smoke tests for Hop Lanes. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from './serve.mjs';
import { ROOT, T, launch, open as openPage, waitState, settle, hopKey } from './browser.mjs';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { simulate } from '../js/sim.js';

let INDEX = '';   // served over http (set in before): module scripts do not load from file://
const STANDALONE = pathToFileURL(path.join(ROOT, 'hop-lanes-standalone.html')).href;

let browser, site;

// New page with CDN three.js served locally and fonts blocked; collects errors.
const open = (ctxOpts, url, opts = {}) => openPage(browser, url, { context: ctxOpts, ...opts });
const state = page => page.evaluate(() => window.hopLanes.state);

test.before(async () => { browser = await launch(); site = await serve(ROOT); INDEX = site.url + '/index.html'; });
test.after(async () => { await browser?.close(); await site?.close(); });

test('1. loads with no page errors and reaches attract', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('canvas').count() > 0, true, 'canvas exists');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('2. keyboard: join P1, hop forward', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.players[0].row === 1, null, { timeout: T });
    const p = await page.evaluate(() => { const q = window.hopLanes.players[0]; return { row: q.row, alive: q.alive, joined: q.joined }; });
    assert.deepEqual(p, { row: 1, alive: true, joined: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('3. touch: tap left half to join and hop', async () => {
  const { context, page, errors } = await open(
    { isMobile: true, hasTouch: true, viewport: { width: 390, height: 760 } }, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    const box = await page.locator('#stage').boundingBox();
    assert.ok(box, 'stage has a box');
    const x = box.x + box.width * 0.25, y = box.y + box.height * 0.5;
    await page.touchscreen.tap(x, y);
    await waitState(page, 'play');
    assert.equal(await page.evaluate(() => window.hopLanes.players[0].joined), true);
    const before = await page.evaluate(() => window.hopLanes.players[0].row);
    await page.touchscreen.tap(x, y);
    await page.waitForFunction(b => window.hopLanes.players[0].row > b, before, { timeout: T });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4. game over when idle', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 90000 });
    assert.equal(await state(page), 'over');
    assert.equal(await page.evaluate(() => window.hopLanes.players[0].cause), 'eagle', 'an idle player is taken by the eagle');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4b. restart after game over covers the screen, then counts down', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 90000 });
    await page.waitForFunction(() => !document.getElementById('results').hidden, null, { timeout: T });
    await page.keyboard.press('KeyW');
    await waitState(page, 'countdown');
    await page.waitForFunction(() => !document.getElementById('wipe').classList.contains('on'), null, { timeout: T });
    assert.equal(await page.evaluate(() => window.hopLanes.players[0].joined), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4c. first-run help shows once, then never again', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug', { fresh: true });
  try {
    await waitState(page, 'attract');
    assert.equal(await page.evaluate(() => document.getElementById('howto').hidden), false, 'help is shown on first run');
    await page.click('#gotit');
    assert.equal(await page.evaluate(() => document.getElementById('howto').hidden), true);
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await page.evaluate(() => document.getElementById('howto').hidden), true, 'help stays hidden after reload');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4d. coins: landing on a coin adds one to the bank', async () => {
  // find a seed whose row 1 (never has trees) holds a coin, then walk onto it
  for (let seed = 1; seed <= 40; seed++) {
    const { context, page, errors } = await open({}, `${INDEX}#debug-seed-${seed}`);
    try {
      await waitState(page, 'attract');
      const cols = await page.evaluate(() => window.hopLanes.laneCoins(1));
      if (!cols.length) continue;
      const col = cols[0];
      await page.keyboard.press('KeyW');
      await waitState(page, 'play');
      const bank0 = await page.evaluate(() => window.hopLanes.bank);
      await page.keyboard.press('KeyW');   // row 0 -> 1 (start column is -2)
      await page.waitForFunction(() => window.hopLanes.players[0].row === 1, null, { timeout: T });
      for (let x = -2; x !== col; x += Math.sign(col - x)) {
        await page.keyboard.press(col > x ? 'KeyD' : 'KeyA');
        await page.waitForFunction(v => window.hopLanes.players[0].x === v && !window.hopLanes.players[0].hop, x + Math.sign(col - x), { timeout: T });
      }
      assert.equal(await page.evaluate(() => window.hopLanes.bank), bank0 + 1, 'bank grew by one coin');
      assert.equal(await page.evaluate(() => window.hopLanes.laneCoins(1).length), cols.length - 1, 'the coin is gone');
      assert.deepEqual(errors, []);
      return;
    } finally { await context.close(); }
  }
  assert.fail('no seed in 1..40 put a coin on row 1');
});

test('4e. pause with P, mute with M', async () => {
  const { context, page, errors } = await open({}, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyP');
    assert.equal(await state(page), 'paused');
    await page.keyboard.press('KeyP');
    assert.equal(await state(page), 'play');
    assert.equal(await page.evaluate(() => window.hopLanes.muted), false);
    await page.keyboard.press('KeyM');
    assert.equal(await page.evaluate(() => window.hopLanes.muted), true);
    assert.equal(await page.evaluate(() => document.getElementById('mute').getAttribute('aria-pressed')), 'true');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('5. seeded worlds are deterministic', async () => {
  const kinds = async seed => {
    const { context, page } = await open({}, `${INDEX}#debug-seed-${seed}`);
    try {
      await waitState(page, 'attract');
      return await page.evaluate(() => ({ seed: window.hopLanes.seed, kinds: window.hopLanes.laneKinds() }));
    } finally { await context.close(); }
  };
  const a = await kinds(42), b = await kinds(42), c = await kinds(7);
  assert.equal(a.seed, 42);
  assert.equal(c.seed, 7);
  assert.equal(a.kinds.length >= 31, true, 'laneKinds covers rows 0..30');
  assert.deepEqual(a.kinds, b.kinds);
  assert.notDeepEqual(a.kinds, c.kinds);
});

test('5b. draw calls stay low far into the world (instanced traffic)', async () => {
  const { context, page, errors } = await open({ viewport: { width: 1280, height: 800 } }, `${INDEX}#debug-seed-42`);
  try {
    await waitState(page, 'attract');
    await page.evaluate(() => { window.hopLanes.camRow = 120; });   // dense traffic, night
    await page.waitForFunction(() => window.hopLanes.laneKinds && window.hopLanes.camRow === 120, null, { timeout: T });
    // lanes build one per frame; wait for a few drawn frames, then read the last frame's count
    await page.waitForFunction(() => new Promise(r => { let n = 0; const f = () => (++n > 40 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), null, { timeout: T });
    const calls = await page.evaluate(() => window.hopLanes.drawCalls);
    assert.ok(calls > 8 && calls < 40, `draw calls per frame: ${calls} (ground in 8-row chunks plus one per instanced model)`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('5c. a replay link plays the same run again, across traffic, on another screen size', async () => {
  const { context, page, errors } = await open({ viewport: { width: 1280, height: 800 } }, `${INDEX}#debug-seed-42`);
  const snap = () => page.evaluate(() => { const h = window.hopLanes, p = h.players[0]; return { row: p.row, score: p.score, cause: p.cause, x: Math.round(p.x * 1000), seed: h.seed, tick: h.playTick }; });
  let first, code, bank;
  try {
    await waitState(page, 'attract');
    await settle(page, 1500);   // traffic runs on the title screen: the replay must not depend on how long
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    // run forward into roads, rivers and rails until something ends the run
    // (each hop is waited to land before the next, so no hop is queued behind another)
    for (let i = 0; i < 40 && (await page.evaluate(() => window.hopLanes.state)) === 'play'; i++) {
      await hopKey(page, i % 7 === 3 ? 'KeyD' : i % 7 === 6 ? 'KeyA' : 'KeyW');
    }
    await page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 90000 });
    first = await snap();
    const run = await page.evaluate(() => ({ record: window.hopLanes.record, startTick: window.hopLanes.startTick }));
    assert.ok(run.record.length >= 3, 'hops recorded');
    assert.ok(run.startTick > 0, 'the world ran before play began');
    assert.ok(first.row >= 4, 'the run left the starting grass: row ' + first.row);
    code = encodeReplay({ seed: first.seed, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: run.startTick, events: run.record });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  // a phone-sized screen builds lanes in another order and at other times: the run must not change
  const again = await open({ viewport: { width: 390, height: 760 } }, `${INDEX}#debug-replay-${code}`);
  try {
    await again.page.waitForFunction(() => window.hopLanes && window.hopLanes.state === 'countdown', null, { timeout: T });
    bank = await again.page.evaluate(() => window.hopLanes.bank);
    await again.page.keyboard.press('ArrowUp');   // a key press must not add a player to a replay
    await again.page.waitForFunction(() => window.hopLanes.state === 'over', null, { timeout: 120000 });
    const second = await again.page.evaluate(() => { const h = window.hopLanes, p = h.players[0]; return { row: p.row, score: p.score, cause: p.cause, x: Math.round(p.x * 1000), seed: h.seed, tick: h.playTick }; });
    assert.deepEqual(second, first, 'the replay ends where and when the run ended');
    // the same replay without a browser (sim.js, what the score server runs) ends on the same tick, row, cause and score
    const sim = simulate(decodeReplay(code));
    assert.deepEqual({ tick: sim.endTick, row: sim.row, cause: sim.cause, score: sim.scores[0], x: Math.round(sim.players[0].x * 1000) },
      { tick: second.tick, row: second.row, cause: second.cause, score: second.score, x: second.x }, 'sim.js plays the run as the browser did');
    assert.equal(await again.page.evaluate(() => window.hopLanes.players[1].joined), false, 'no extra player');
    assert.equal(await again.page.evaluate(() => window.hopLanes.bank), bank, 'a replay pays no coins');
    assert.match(await again.page.locator('#resTitle').textContent(), /REPLAY OVER/);
    assert.deepEqual(again.errors, []);
  } finally { await again.context.close(); }
});

// Links made with the rules of version 2 (tests/sim.test.mjs BROWSER_RUNS: a race with the P1 shield, a classic run):
// the browser plays them with their own rules and ends them where sim.js does
const V2_RUNS = [
  'MnwxNzI3MDE3NTQzfHJhY2V8ZnJvZyxmb3h8M3wxfDQ0MHw1YVUyMmJVMzJhVTM0YlUyOWFVMjJiVTI0YVUzMmJVMzVhVTEzYlUzMGFSMzFiVThhUjI3YlUxMWFVMjFiRDE0YVUyMWJSMTFhVTI5YkQyM2FVMzdiUjI2YVUxNGJVMTRhVTI1YlUyNWFVMTJiVTlhUjE3YkQyMmFE',
  'MnwxMjA1NjkwMjUwfGNsYXNzaWN8ZnJvZyxmb3h8MXwxfDY2Mnw1YVUyMWFVMTZhVTM2YVUyNGFVMzNhVTMyYVUyNWFVMTBhVTEyYVUxNWFVMzNhVTM3YVUyOGFVMzBhUjhhVTI5YVUxM2FVOGFVMTNhVTMyYVUzN2FVMzVhVTE5YVUxNWFVMjlhVTE4YVUxMWFVMzJhVTMxYVUyOGFVMjlhVTM0YVU5YVUzM2FV'
];
test('5c2. an old link (rules version 2) plays in the browser as sim.js plays it', { timeout: 240000 }, async () => {
  for (const code of V2_RUNS) {
    const rp = decodeReplay(code);
    assert.equal(rp.version, 2, 'a version 2 code');
    const sim = simulate(rp);
    const { context, page, errors } = await open({ viewport: { width: 1280, height: 800 } }, `${INDEX}#debug-replay-${code}`);
    try {
      await page.waitForFunction(() => window.hopLanes && window.hopLanes.state === 'over', null, { timeout: 120000 });
      const end = await page.evaluate(() => { const h = window.hopLanes; return { rules: h.replay.version, tick: h.playTick, players: h.players.map(p => ({ row: p.row, score: p.score, cause: p.cause, alive: p.alive })) }; });
      assert.equal(end.rules, 2);
      assert.deepEqual({ tick: end.tick, row: end.players[0].row, cause: end.players[0].cause },
        { tick: sim.endTick, row: sim.row, cause: sim.cause }, 'the browser ends the old run where sim.js does (' + rp.mode + ')');
      for (const [i, p] of sim.players.entries()) if (p.joined) assert.equal(end.players[i].score, p.score, 'player ' + (i + 1) + ' score');
      assert.match(await page.locator('#resTitle').textContent(), /REPLAY OVER/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('5d. shield and safe time: one free hit, but water never holds you', async () => {
  const { context, page, errors } = await open({}, `${INDEX}#debug-seed-42`);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    const r = await page.evaluate(() => {
      const h = window.hopLanes, p = h.players[0];
      h.giveShield(p);
      h.kill(p, 'squash');
      const saved = { alive: p.alive, shield: p.shield, safe: p.safeT > 0 };
      h.kill(p, 'squash');                    // in the safe time a car passes through
      const passed = p.alive;
      h.kill(p, 'splash');                    // but water does not hold you up
      return { saved, passed, drowned: !p.alive, cause: p.cause };
    });
    assert.deepEqual(r, { saved: { alive: true, shield: false, safe: true }, passed: true, drowned: true, cause: 'splash' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('5e. the shadow box and the haze follow the screen shape', async () => {
  const { context, page, errors } = await open({ viewport: { width: 390, height: 760 } }, INDEX + '#debug');
  try {
    await waitState(page, 'attract');
    const tall = await page.evaluate(() => window.hopLanes.view);
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.waitForFunction(w => window.hopLanes.view.shadowW !== w, tall.shadowW, { timeout: T });
    const wide = await page.evaluate(() => window.hopLanes.view);
    for (const v of [tall, wide]) {
      assert.ok(v.shadowW > 8 && v.shadowW < 80, 'shadow box width ' + v.shadowW);
      assert.ok(v.shadowH > 8 && v.shadowH < 80, 'shadow box height ' + v.shadowH);
      assert.ok(v.fogNear > 0 && v.fogFar > v.fogNear + 10, 'haze from ' + v.fogNear + ' to ' + v.fogFar);
      assert.ok([256, 512, 1024].includes(v.mapSize));
    }
    assert.notEqual(wide.shadowW * wide.shadowH, tall.shadowW * tall.shadowH, 'the shadow box is refitted to the new screen shape');
    assert.equal(await page.locator('#fps').isVisible(), true, 'the debug frame counter shows');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('6. standalone works fully offline', async () => {
  const { context, page, errors, requests } = await open({}, STANDALONE + '#debug', { network: 'offline' });
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('canvas').count() > 0, true, 'canvas exists');
    assert.deepEqual(requests, [], 'no http(s) requests attempted');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
