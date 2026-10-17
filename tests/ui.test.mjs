// UI feature tests for Hop Lanes: shop, prize machine, modes, daily seed, race, share, confetti. Run: node --test tests/ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { ROOT, T, launch, open as openPage, waitState, settle, waitTicks } from './browser.mjs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import net from 'node:net';
import { STEP, dailySeedFor } from '../js/rules.js';
import { dailyMissions } from '../js/missions.js';
import { decodeReplay } from '../js/replay.js';

const SLOW = 120000; // whole-test budget for tests that wait through a game

let browser, site, INDEX = '';

// New context + page on the game (browser.mjs open): storage, clipboard, scale, noShare, phone
const open = (url, opts) => openPage(browser, url, opts);
const hop = (page, fn) => page.evaluate(fn);
const resultsVisible = page => page.locator('#results').waitFor({ state: 'visible', timeout: T });

test.before(async () => { browser = await launch({ autoplay: true }); site = await serve(ROOT); INDEX = site.url + '/index.html#debug'; });
test.after(async () => { await browser?.close(); await site?.close(); });

test('1a. shop: buy BUNNY with coins through the card arrow and TAP', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '45' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.bank), 45);
    await page.click('#card1 .cyc[data-d="1"]');
    await page.click('#card1 .cyc[data-d="1"]');
    assert.match(await page.locator('#card1 .state').textContent(), /BUNNY/);
    await page.click('#tap1');
    await page.waitForFunction(() => window.hopLanes.players[0].joined, null, { timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.bank), 15);
    assert.ok((await hop(page, () => window.hopLanes.owned)).includes('bunny'), 'bunny owned');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1b. shop: cannot afford BUNNY, does not join, card shakes', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '10' } });
  try {
    await waitState(page, 'attract');
    await page.click('#card1 .cyc[data-d="1"]');
    await page.click('#card1 .cyc[data-d="1"]');
    const stateText = await page.locator('#card1 .state').textContent();
    assert.match(stateText, /BUNNY/);
    assert.match(stateText, /30/, 'locked state shows the price');
    // watch for the transient 'shake' class so the check is not timing sensitive
    await page.evaluate(() => {
      window.__shook = false;
      const card = document.getElementById('card1');
      if (card.classList.contains('shake')) window.__shook = true;
      new MutationObserver(() => { if (card.classList.contains('shake')) window.__shook = true; })
        .observe(card, { attributes: true, attributeFilter: ['class'] });
    });
    await page.click('#tap1');
    await page.waitForFunction(() => window.__shook, null, { timeout: T });
    await settle(page, 300);   // then the page runs on: a late join would show
    assert.equal(await hop(page, () => window.hopLanes.players[0].joined), false, 'did not join');
    assert.equal(await hop(page, () => window.hopLanes.bank), 10, 'bank unchanged');
    assert.equal(await hop(page, () => window.__shook), true, 'card got the shake class');
    assert.equal(await hop(page, () => window.hopLanes.owned.includes('bunny')), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1c. missions show on the title; the language button switches the texts', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    const lines = await page.locator('#missions li').allTextContents();
    assert.equal(lines.length, 3);
    assert.match(lines[0], /COLLECT 10 COINS/);
    assert.match(await page.locator('#mode').textContent(), /^MODE: /);
    await page.click('#settings');   // language and handicap live in the settings panel
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'ES');
    assert.match(await page.locator('#mode').textContent(), /^MODO: /);
    assert.match(await page.locator('#missions h3').textContent(), /MISIONES/);
    assert.match(await page.locator('#start').textContent(), /INICIO/);
    assert.match(await page.locator('#settingsTitle').textContent(), /AJUSTES/);
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'DE');
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'EN');
    assert.match(await page.locator('#mode').textContent(), /^MODE: /);
    // the handicap button cycles and is saved
    await page.click('#handicap');
    assert.equal(await page.locator('#handicap').textContent(), 'SHIELD: P1');
    // the other settings switch and are saved; Escape closes the panel
    await page.click('#buzz');
    assert.equal(await page.locator('#buzz').textContent(), 'VIBRATION: OFF');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.buzz')), '0');
    await page.click('#motion');
    assert.equal(await page.locator('#motion').textContent(), 'MOTION: LESS');
    await page.click('#sound');
    assert.equal(await page.locator('#sound').textContent(), 'SOUND: OFF');
    assert.equal(await hop(page, () => window.hopLanes.muted), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settingsBox').isHidden(), true, 'Escape closes the settings');
    assert.equal(await hop(page, () => window.hopLanes.state), 'attract');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1d. daily missions show on the title: three a day, a paid one is checked', async () => {
  const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.dailydone': today + '|2' } });   // the second one is paid
  try {
    await waitState(page, 'attract');
    assert.match(await page.locator('#dayMissions h3').textContent(), /TODAY'S MISSIONS/);
    const lines = await page.locator('#dayMissions li').allTextContents();
    assert.equal(lines.length, 3);
    assert.ok(lines.every(l => /COINS|ROW|RIVERS|HOP|LOGS|COMBO|NEAR|POWER-UP/.test(l)), 'mission texts: ' + lines.join(' | '));
    assert.equal(new Set(lines).size, 3, 'three different missions');
    const done = await page.locator('#dayMissions li').evaluateAll(els => els.map(li => li.classList.contains('done')));
    assert.deepEqual(done, [false, true, false]);
    assert.equal(await page.locator('#missions li').count(), 3, 'the regular missions stay as they are');
    await page.click('#settings');
    await page.click('#lang');
    assert.match(await page.locator('#dayMissions h3').textContent(), /MISIONES DE HOY/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('2a. prize machine: buy a prize with 120 coins', async () => {
  const POOL = ['pig', 'penguin', 'turtle'];
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '120' } });
  try {
    await waitState(page, 'attract');
    const before = await hop(page, () => window.hopLanes.owned.slice());
    assert.match(await page.locator('#prize').textContent(), /50/);
    await page.click('#prize');
    await page.locator('#banner').waitFor({ state: 'visible', timeout: T });
    assert.match((await page.locator('#banner h2').textContent()).trim(), /^YOU GOT/);
    assert.equal(await hop(page, () => window.hopLanes.bank), 70);
    const after = await hop(page, () => window.hopLanes.owned.slice());
    const gained = after.filter(k => !before.includes(k));
    assert.equal(gained.length, 1, 'exactly one new character');
    assert.ok(POOL.includes(gained[0]), 'prize comes from the pool: ' + gained[0]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('2b. prize machine: a second pull with too few coins leaves the bank alone', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '70' } });
  try {
    await waitState(page, 'attract');
    await page.click('#prize');
    await page.locator('#banner').waitFor({ state: 'visible', timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.bank), 20);
    const owned = await hop(page, () => window.hopLanes.owned.length);
    await page.evaluate(() => document.getElementById('prize').click()); // no-op if disabled
    await settle(page, 300);
    assert.equal(await hop(page, () => window.hopLanes.bank), 20, 'bank unchanged');
    assert.equal(await hop(page, () => window.hopLanes.owned.length), owned, 'nothing new owned');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('2c. prize machine: disabled once every prize is owned', async () => {
  const { context, page, errors } = await open(INDEX, {
    storage: { 'hoplanes.coins': '120', 'hoplanes.owned': 'pig,penguin,turtle' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('#prize').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('3. mode button cycles CLASSIC, RACE, COIN WAR, TAG, DAILY and persists', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'classic');
    assert.match(await page.locator('#mode').textContent(), /CLASSIC/);
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'race');
    assert.match(await page.locator('#mode').textContent(), /RACE/);
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'coinwar');
    assert.match(await page.locator('#mode').textContent(), /COIN WAR/);
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'tag');
    assert.match(await page.locator('#mode').textContent(), /TAG/);
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    assert.match(await page.locator('#mode').textContent(), /DAILY/);
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily', 'mode survives reload');
    assert.match(await page.locator('#mode').textContent(), /DAILY/);
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.mode')), 'daily');
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'classic');
    assert.match(await page.locator('#mode').textContent(), /CLASSIC/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4. daily mode uses the daily seed in attract and in play', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    for (let i = 0; i < 4; i++) await page.click('#mode');   // race, coin war, tag, daily
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    const daily = await hop(page, () => window.hopLanes.dailySeed);
    assert.equal(typeof daily, 'number');
    await page.waitForFunction(d => window.hopLanes.seed === d, daily, { timeout: T });
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    assert.equal(await hop(page, () => window.hopLanes.seed), daily, 'seed still the daily seed in play');
    assert.equal(await hop(page, () => window.hopLanes.dailySeed), daily);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('5. race mode: idle P1 is taken by the eagle, P2 wins', { timeout: 180000 }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.mode': 'race' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'race');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window.hopLanes.players[0].joined && window.hopLanes.players[1].joined, null, { timeout: T });
    await waitState(page, 'play');
    // P1 stays idle; P2 keeps hopping so it is never idle long enough for the eagle
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && (await hop(page, () => window.hopLanes.state)) !== 'over') {
      await page.keyboard.press('ArrowUp');
      await waitTicks(page, Math.round(1.5 / STEP));   // 1.5 s of game steps between hops
    }
    assert.equal(await hop(page, () => window.hopLanes.state), 'over');
    const p2alive = await hop(page, () => window.hopLanes.players[1].alive);
    await page.locator('#resTitle').waitFor({ state: 'visible', timeout: T });
    const title = await page.locator('#resTitle').textContent();
    if (p2alive) assert.match(title, /WINS/);
    else assert.match(title, /WINS|TIE/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('6. share button copies the score text and says COPIED!', async () => {
  const { context, page, errors } = await open(INDEX, { clipboard: true });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await waitState(page, 'over', 90000);
    await resultsVisible(page);
    await page.locator('#results #share').waitFor({ state: 'visible', timeout: T });
    const score = await hop(page, () => window.hopLanes.players[0].score);
    assert.equal(typeof score, 'number');
    await page.click('#share');
    await page.waitForFunction(() => typeof window.__copied === 'string', null, { timeout: T });
    const copied = await hop(page, () => window.__copied);
    assert.match(copied, /Hop Lanes/);
    assert.ok(copied.includes(String(score)), `copied text has score ${score}: ${copied}`);
    await page.waitForFunction(() => /COPIED!/.test(document.getElementById('share').textContent), null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// the score server (server/scores.mjs) on a free port with its own data file; env: extra settings (VERIFY=0...)
async function startScores(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-scores-'));
  const port = await new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/scores.mjs')],
    { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 's.json'), POST_TOKEN: 't0k', SAVE_DELAY_MS: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.once('data', res); srv.once('error', rej); });
  return { base: `http://127.0.0.1:${port}`, stop: () => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
// the served index.html with a score server wired in (the meta and its origin in connect-src)
async function openWithScores(scoresBase, opts) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace("connect-src 'none'", `connect-src ${scoresBase}`)
    .replace('<meta name="hop-lanes-scores" content="">', `<meta name="hop-lanes-scores" content="${scoresBase}/scores">`)
    .replace('<meta name="hop-lanes-token" content="">', '<meta name="hop-lanes-token" content="t0k">');
  assert.ok(html.includes(`${scoresBase}/scores`) && html.includes('t0k'), 'the metas were found');
  // served by a real server, not a route stub: Chrome refuses fetches to 127.0.0.1 from a page with no address
  const site2 = await serve(ROOT, { '/index.html': html });
  const out = await open(site2.url + '/index.html#debug', opts);
  out.context.once('close', () => site2.close());
  return out;
}
test('6b. a finished game posts its score (today, mode) and the world best shows', { timeout: SLOW }, async () => {
  const { base, stop } = await startScores();
  const { context, page, errors } = await openWithScores(base);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await waitState(page, 'over', 90000);
    await page.locator('#world').waitFor({ state: 'visible', timeout: T });
    const score = await hop(page, () => window.hopLanes.players[0].score);
    const top = (await (await fetch(base + '/scores')).json()).top;
    assert.equal(top.length, 1, 'one score was posted');
    assert.equal(top[0].score, score);
    assert.match(top[0].name, /^FROG [A-Z2-9]{4}$/, 'character plus device tag');
    assert.equal(top[0].mode, 'classic');
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    assert.equal(top[0].day, today, 'the day is a plain YYYY-MM-DD');
    assert.match(await page.locator('#world').textContent(), new RegExp('WORLD BEST ' + score + ' · FROG')); // eslint-disable-line security/detect-non-literal-regexp -- the score is a number
    // back on the title the TOP 10 button lists the same score
    await page.keyboard.press('Space');
    await waitState(page, 'attract');
    await page.click('#board');
    await page.waitForFunction(() => document.querySelectorAll('#boardList li').length === 1, null, { timeout: T });
    assert.match(await page.locator('#boardList li').textContent(), new RegExp('FROG [A-Z2-9]{4}' + score)); // eslint-disable-line security/detect-non-literal-regexp -- the score is a number
    await page.click('#closeBoard');
    assert.equal(await page.locator('#boardBox').isHidden(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); stop(); }
});

test('6c. without a score server a finished run enters the local top 10 and the TOP 10 button lists it', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('#board').isVisible(), true, 'the TOP 10 button shows without a server');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.players[0].row >= 1, null, { timeout: T });
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'test'));   // the initials prompt is dismissed by Playwright: the device tag stands in
    await waitState(page, 'over');
    await resultsVisible(page);
    const score = await hop(page, () => window.hopLanes.players[0].score);
    assert.ok(score >= 1, 'scored ' + score);
    // the question waits until the results are up (never inside a game step); dismissed, the device tag stands in and nothing is saved
    await page.waitForFunction(() => !!localStorage.getItem('hoplanes.local'), null, { timeout: T });
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local')));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].score, score);
    assert.match(saved[0].name, /^[A-Z2-9]{3} FROG$/, 'initials (the device tag) plus the animal');
    assert.equal(saved[0].mode, 'classic');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.initials')), null, 'a cancelled question is asked again another day');
    await page.keyboard.press('Space');
    await waitState(page, 'attract');
    await page.click('#board');
    await page.locator('#boardBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#boardTitle').textContent(), /THIS DEVICE/);
    assert.equal(await page.locator('#boardList li').count(), 1);
    assert.match(await page.locator('#boardList li').textContent(), new RegExp('^[A-Z2-9]{3} FROG' + score + '$')); // eslint-disable-line security/detect-non-literal-regexp -- the score is a number
    assert.equal(await page.locator('#boardList li .watch').count(), 0, 'no watch button on a local row');
    assert.equal(await page.locator('#boardScope').isHidden(), true, 'only one scope: no scope button');
    await page.click('#closeBoard');
    assert.equal(await page.locator('#boardBox').isHidden(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('7. new all-time best shows confetti and a note', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.players[0].row >= 1, null, { timeout: T });
    await waitState(page, 'over', 90000);
    await resultsVisible(page);
    await page.waitForFunction(() => {
      const c = document.getElementById('confetti');
      return (c && c.children.length > 0) || document.querySelectorAll('.confetti').length > 0;
    }, null, { timeout: T });
    assert.match(await page.locator('#resBest').textContent(), /NEW ALL TIME BEST/);
    assert.equal(await page.locator('#resBest').isVisible(), true, 'the best line shows');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// ---- regression tests for the review fixes ----
test('8a. a tap on the copy-by-hand text box does not restart the game', async () => {
  const { context, page, errors } = await open(INDEX, { noShare: true });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await waitState(page, 'over', 90000);
    await resultsVisible(page);
    await page.locator('#share').waitFor({ state: 'visible', timeout: T });
    await page.click('#share');
    await page.locator('#shareText').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#share').textContent(), /SELECT AND COPY/);
    await page.click('#shareText');
    await page.keyboard.press('Space');
    await settle(page, 600);
    assert.equal(await hop(page, () => window.hopLanes.state), 'over', 'still on the results');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8b. pause during the countdown: the number shows again on resume; the pause menu restarts', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'countdown');
    await page.waitForFunction(() => /^\d$/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    await page.keyboard.press('KeyP');
    await waitState(page, 'paused');
    await page.locator('#pauseBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#banner h2').textContent(), /PAUSED/);
    await page.keyboard.press('KeyP');
    await waitState(page, 'countdown');
    await page.waitForFunction(() => /^\d$/.test(document.querySelector('#banner h2').textContent), null, { timeout: 3000 });
    assert.equal(await page.locator('#pauseBox').isHidden(), true);
    await waitState(page, 'play');
    assert.match(await page.locator('#live').textContent(), /GO!/, 'the announcer said go');
    await page.keyboard.press('KeyP');
    await waitState(page, 'paused');
    await page.click('#restartBtn');
    await waitState(page, 'attract');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8c. the title tune starts with the first tap on the title', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await settle(page, 800);   // past the old 0.5 s window
    assert.equal(await hop(page, () => window.hopLanes.tune), false);
    await page.click('#mute'); await page.click('#mute');   // two gestures, sound back on
    await page.waitForFunction(() => window.hopLanes.tune === true, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8d. the quality ladder lowers the pixel ratio twice when it helps, and keeps it', { timeout: 240000 }, async () => {
  const { context, page, errors } = await open(INDEX, { scale: 1.5 });   // a dense screen: the software renderer is slow here, so the waits are long
  try {
    await waitState(page, 'attract');
    await hop(page, () => window.hopLanes.ladder.hold());   // only the frames fed below count (real SwiftShader frames are slow)
    assert.equal(await hop(page, () => window.hopLanes.ladder.ratio), 1.5);
    await page.keyboard.press('KeyW');
    await waitState(page, 'play', 120000);
    // slow frames: the first rung (pixel ratio -0.25); then faster ones: the rung helped, so it is taken again
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 60; i++) L.feed(0.05); return L.ratio; }), 1.25);
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 90; i++) L.feed(0.03); return L.ratio; }), 1);
    // still slow with nothing left on the pixel ratio: the shadow map rung is tried (no gain here, so put back),
    // then the last rung draws the shadows every other frame; faster frames keep it
    const half = await hop(page, () => {
      const L = window.hopLanes.ladder;
      for (let i = 0; i < 40; i++) L.feed(0.02);   // fast frames first: the step to 1.0 is judged a gain and kept
      for (let n = 0; n < 8 && !L.shadowHalf; n++) for (let i = 0; i < 40; i++) L.feed(0.05);
      return { half: L.shadowHalf, shadow: L.shadow, ratio: L.ratio };
    });
    assert.deepEqual(half, { half: true, shadow: 1024, ratio: 1 });
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 40; i++) L.feed(0.03); return L.shadowHalf; }), true, 'the rung helped: it stays');
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); });
    await waitState(page, 'over', 60000);
    await resultsVisible(page);   // a restart counts only once the results are up
    await page.keyboard.press('Space');
    await waitState(page, 'attract', 120000);
    assert.equal(await hop(page, () => window.hopLanes.ladder.ratio), 1, 'a slow device keeps the lower setting for the next game');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8d2. a dense phone screen starts at 2x and the ladder drops it to 1.5 first', { timeout: 240000 }, async () => {
  const { context, page, errors } = await open(INDEX, { scale: 2, phone: true });
  try {
    await waitState(page, 'attract');
    await hop(page, () => window.hopLanes.ladder.hold());   // only the frames fed below count (real SwiftShader frames are slow)
    assert.equal(await hop(page, () => window.hopLanes.ladder.ratio), 2);
    const box = await page.locator('#stage').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await waitState(page, 'play', 120000);
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 60; i++) L.feed(0.05); return L.ratio; }), 1.5);
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 90; i++) L.feed(0.03); return L.ratio; }), 1.25);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8f. biomes: the land changes every 100 rows; an unlocked look starts the world in a far biome', async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42', { storage: { 'hoplanes.best': '250' } });
  try {
    await waitState(page, 'attract');
    assert.deepEqual(await hop(page, () => [0, 120, 230, 330, 430].map(r => window.hopLanes.biomeIndex(r))), [0, 1, 2, 3, 0]);
    assert.equal(await hop(page, () => window.hopLanes.biome), 'MEADOW');
    await page.click('#settings');
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#lookNote').textContent(), /REACH ROW 300 TO UNLOCK SWAMP/, 'a best of 250 leaves the swamp locked');
    await page.click('#look');
    assert.match(await page.locator('#look').textContent(), /LOOK: DESERT/);
    assert.equal(await hop(page, () => window.hopLanes.biome), 'DESERT', 'the title world is built again as a desert');
    await page.click('#look'); await page.click('#look');   // night, tundra
    assert.match(await page.locator('#look').textContent(), /LOOK: TUNDRA/);
    await page.click('#look');
    assert.match(await page.locator('#look').textContent(), /LOOK: AUTO/, 'the locked swamp is skipped');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8g. the first classic game is the tutorial world with guided hints; game over slows and zooms', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.seed), 197, 'the tutorial seed (the hint is not done yet)');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.hint, null, { timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.hintText), 'W \u25b2');
    for (let n = 0; n < 3; n++) { await page.keyboard.press('KeyW'); await page.waitForFunction(() => !window.hopLanes.players[0].hop, null, { timeout: T }); }
    assert.equal(await hop(page, () => window.hopLanes.players[0].row), 3);
    await page.waitForFunction(() => /WAIT FOR A GAP/.test(window.hopLanes.hintText), null, { timeout: T });   // the road is next
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); });
    await waitState(page, 'over', T);
    assert.ok(await hop(page, () => window.hopLanes.slowT) > 0, 'slow motion runs at game over');
    await page.waitForFunction(() => window.hopLanes.zoom > 1.1, null, { timeout: T });
    await resultsVisible(page);
    await page.keyboard.press('Space');
    await waitState(page, 'attract', T);
    assert.equal(await hop(page, () => window.hopLanes.zoom), 1, 'the title view is back to normal');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8e. a script error shows the crash notice instead of a frozen screen', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await hop(page, () => window.hopLanes.boom());
    await page.waitForFunction(() => /SOMETHING BROKE/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    assert.equal(await page.locator('#deck').isHidden(), true);
    assert.equal(errors.length, 1, 'the error is logged once, not thrown to the page');
    assert.match(errors[0], /^console: Error: test crash/);
  } finally { await context.close(); }
});

test('9. daily mode: the best run comes back as a ghost in the next game on the same world', { timeout: 240000 }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.mode': 'daily' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    assert.equal(await hop(page, () => window.hopLanes.ghost), null, 'no ghost before a run is saved');
    for (let i = 0; i < 3; i++) {   // a few rows, so the run scores (a hop lands before the next)
      await page.keyboard.press('KeyW');
      await page.waitForFunction(() => !window.hopLanes.players[0].hop, null, { timeout: T });
    }
    await waitState(page, 'over', 90000);
    await resultsVisible(page);
    const first = await hop(page, () => window.hopLanes.players[0].score);
    assert.ok(first >= 1, 'the first run scored');
    const seed = await hop(page, () => window.hopLanes.seed);
    assert.match(await page.evaluate(k => localStorage.getItem(k) || '', 'hoplanes.ghost.' + seed), /^\d+\|0\|\d+\|[A-Za-z0-9_-]+$/, 'the run is saved for this world');
    await page.keyboard.press('Space');
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.ghost !== null, null, { timeout: T });
    const g = await hop(page, () => window.hopLanes.ghost);
    assert.equal(g.score, first, 'the ghost is the saved run');
    await page.waitForFunction(() => { const g = window.hopLanes.ghost; return g && g.row >= 1; }, null, { timeout: 60000 });   // it hops
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('10. first run: the floating TAP hint follows the player, the play loop runs, a snapshot saves a PNG', { timeout: SLOW }, async () => {
  // seed 28: rows 1-3 grass, 4-6 rail, no trees on column -2, so P1 can hop straight to row 5 (a shield covers a train)
  const { context, page, errors } = await open(INDEX + '-seed-28');
  try {
    await waitState(page, 'attract');
    assert.match(await page.locator('#card1 .state').textContent(), /FROG · BALANCED/, 'the card names the trait');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.hint, null, { timeout: T });
    assert.match(await page.locator('#hint').textContent(), /W/, 'a keyboard player sees the key');
    await page.waitForFunction(() => window.hopLanes.playLoop, null, { timeout: T });   // the play loop runs
    for (let n = 0; n < 40 && await hop(page, () => window.hopLanes.players[0].score) < 5; n++) {   // hop to row 5
      await hop(page, () => window.hopLanes.giveShield(window.hopLanes.players[0]));
      await page.keyboard.press('KeyW');
      await page.waitForFunction(() => !window.hopLanes.players[0].hop, null, { timeout: T });
    }
    assert.equal(await hop(page, () => window.hopLanes.players[0].alive), true, 'still alive');
    await page.waitForFunction(() => !window.hopLanes.hint, null, { timeout: T });
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.hint')), '1', 'row 5: the hint is done for good');
    await page.keyboard.press('KeyP');
    await waitState(page, 'paused');
    assert.equal(await hop(page, () => window.hopLanes.playLoop), false, 'the loop stops on pause');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('#snapBtn')]);
    assert.equal(download.suggestedFilename(), 'hop-lanes.png');
    await page.waitForFunction(() => /SAVED!/.test(document.getElementById('snapBtn').textContent), null, { timeout: T });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('11. daily mode: a finished run starts a streak that shows on the title', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.mode': 'daily' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('#streakBox').isHidden(), true, 'no streak yet');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'test'));
    await waitState(page, 'over');
    await page.locator('#results').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.evaluate(() => localStorage.getItem('hoplanes.streak')), /^\d{4}-\d{2}-\d{2}\|1$/);
    assert.equal(await hop(page, () => window.hopLanes.streak), '1');
    assert.equal(await page.locator('#streakBox').isHidden(), false, 'the streak shows');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('12. the cat survives one fall into water in the real game (no shield bubble yet, no crash)', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42', { storage: { 'hoplanes.owned': 'cat', 'hoplanes.pick0': 'cat' } });   // seed 42: rows 4-6 are river
  try {
    await waitState(page, 'attract');
    assert.match(await page.locator('#card1 .state').textContent(), /CAT · ONE EXTRA LIFE/);
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'splash'));   // the first fall: the extra life
    await page.waitForFunction(() => !window.hopLanes.players[0].hop, null, { timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.players[0].alive), true, 'still alive');
    assert.equal(await hop(page, () => window.hopLanes.players[0].lives), 0);
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'splash'));
    await waitState(page, 'over');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// ---- regression tests for the second review ----
// the first hop of player 1, then the rules end the run at once (hopLanes.kill): a run with a score of 1
async function hopThenDie(page, cause = 'splash') {
  await page.keyboard.press('KeyW');
  await page.waitForFunction(() => window.hopLanes.players[0].row >= 1 && !window.hopLanes.players[0].hop, null, { timeout: T });
  await page.evaluate(c => { const h = window.hopLanes, p = h.players[0]; h.kill(p, c); if (p.alive) h.kill(p, c); }, cause);   // twice: a shield takes the first
  await waitState(page, 'over');
}

test('13a. a prize animal is not for sale on the join card: it comes only from the prize machine', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '500' } });
  try {
    await waitState(page, 'attract');
    for (let k = 0; k < 5; k++) await page.click('#card1 .cyc[data-d="1"]');   // frog -> fox, bunny, cat, robot, pig
    assert.match(await page.locator('#card1 .state').textContent(), /PIG · A PRIZE/);
    assert.match(await page.locator('#card1 .head').textContent(), /PRIZE MACHINE/);
    assert.doesNotMatch(await page.locator('#card1 .head').textContent(), /BUY/);
    await page.click('#tap1');
    await settle(page, 300);
    assert.equal(await hop(page, () => window.hopLanes.players[0].joined), false, 'did not join');
    assert.equal(await hop(page, () => window.hopLanes.bank), 500, 'nothing paid');
    assert.equal(await hop(page, () => window.hopLanes.owned.includes('pig')), false, 'not owned');
    await page.evaluate(() => document.getElementById('lang').click());   // the card says it in every language
    assert.match(await page.locator('#card1 .head').textContent(), /MÁQUINA DE PREMIOS/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13b. the handicap is the one the run began with; a dialog takes no field taps and closes on a join', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { clipboard: true });
  try {
    await waitState(page, 'attract');
    await page.click('#settings');
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.click(box.x + 12, box.y + box.height * 0.6);   // the dimmed backdrop, not the box
    await settle(page, 300);
    assert.equal(await hop(page, () => window.hopLanes.state), 'attract', 'a tap on the backdrop does not join');
    await page.evaluate(() => document.getElementById('tap1').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })));   // a join from outside the dialog
    await waitState(page, 'countdown');
    assert.equal(await page.locator('#settingsBox').isHidden(), true, 'the join closed the dialog');
    await page.evaluate(() => document.getElementById('handicap').click());   // HANDICAP during the countdown: SHIELD: P1
    await waitState(page, 'play');
    assert.equal(await hop(page, () => window.hopLanes.players[0].shield), false, 'the run began without the handicap');
    await hopThenDie(page, 'squash');
    await resultsVisible(page);
    await page.click('#replayBtn');
    await page.waitForFunction(() => typeof window.__copied === 'string', null, { timeout: T });
    const link = await hop(page, () => window.__copied);
    const rp = decodeReplay(link.split('#replay-')[1]);
    assert.equal(rp.handicap, 0, 'the replay link has the handicap of the run');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.handicap')), '1', 'the setting is kept for the next game');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13c. no online post for a fixed world or a handicap run; a normal run posts', { timeout: 240000 }, async () => {
  const { base, stop } = await startScores({ VERIFY: '0' });   // the kill hook is not in the replay: no replay check here
  const posts = page => { const n = { posts: 0 }; page.on('request', r => { if (r.method() === 'POST') n.posts++; }); return n; };
  try {
    const a = await openWithScores(base);
    try {   // #debug-seed-N: the same world every game
      await a.page.goto(a.page.url().replace('#debug', '#debug-seed-18'));
      await a.page.reload();
      await waitState(a.page, 'attract');
      assert.equal(await a.page.evaluate(() => window.hopLanes.seed), 18);
      const n = posts(a.page);
      await a.page.keyboard.press('KeyW');
      await waitState(a.page, 'play');
      await hopThenDie(a.page);
      await resultsVisible(a.page);
      await settle(a.page, 800);
      assert.equal(n.posts, 0, 'a fixed world is not posted');
      assert.equal(await a.page.locator('#world').isHidden(), true, 'no online line');
      assert.deepEqual(a.errors, []);
    } finally { await a.context.close(); }
    const b = await openWithScores(base, { storage: { 'hoplanes.handicap': '1' } });
    try {
      await waitState(b.page, 'attract');
      const n = posts(b.page);
      await b.page.keyboard.press('KeyW');
      await waitState(b.page, 'play');
      assert.equal(await b.page.evaluate(() => window.hopLanes.players[0].shield), true, 'the handicap shield');
      await hopThenDie(b.page);
      await resultsVisible(b.page);
      await settle(b.page, 800);
      assert.equal(n.posts, 0, 'a handicap run is not posted');
      assert.equal(await b.page.locator('#world').isHidden(), true, 'no online line');
      assert.ok(JSON.parse(await b.page.evaluate(() => localStorage.getItem('hoplanes.local') || '[]')).length <= 1, 'the local list still works');
      // the handicap off (SHIELD: P1 -> SHIELD: P2 -> OFF): the next run posts
      await b.page.keyboard.press('Space');
      await waitState(b.page, 'attract');
      await b.page.evaluate(() => { const h = document.getElementById('handicap'); h.click(); h.click(); });
      await b.page.keyboard.press('KeyW');
      await waitState(b.page, 'play');
      await hopThenDie(b.page);
      await b.page.locator('#world').waitFor({ state: 'visible', timeout: T });
      assert.equal(n.posts, 1, 'the normal run was posted');
      assert.deepEqual(b.errors, []);
    } finally { await b.context.close(); }
  } finally { stop(); }
});

test('13d. the first initials question never opens over the next game: a quick restart leaves it for the next results', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX);
  await context.addInitScript(() => {
    window.__asked = [];
    window.prompt = () => { window.__asked.push(window.hopLanes.state); return 'ABC'; };
    window.__later = [];   // the question's wait (1.9 s after game over) runs when the test says
    const timer = window.setTimeout;
    window.setTimeout = (f, ms, ...a) => { if (ms === 1900) { window.__later.push(f); return 0; } return timer(f, ms, ...a); };
  });
  try {
    await page.reload();
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hopThenDie(page);
    await resultsVisible(page);
    await page.keyboard.press('KeyW');   // play again at once
    await waitState(page, 'countdown');
    await hop(page, () => window.__later.splice(0).forEach(f => f()));   // the first question's time comes in the countdown
    assert.deepEqual(await hop(page, () => window.__asked), [], 'no question over the next game');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.local')), null, 'the entry waits for the initials');
    await waitState(page, 'play');
    await hopThenDie(page);
    await hop(page, () => window.__later.splice(0).forEach(f => f()));
    assert.deepEqual(await hop(page, () => window.__asked), ['over'], 'asked once, on the results');
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local')));
    assert.deepEqual(saved.map(e => e.name), ['ABC FROG', 'ABC FROG'], 'both runs saved with the initials');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13e. play again after a run past row 100 shows the biome banner again; the combo tint resets', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42');
  // every banner text that shows (the view jump leaves the player behind: the banner is cleared again in that step)
  const banners = () => page.evaluate(() => window.__banners.join('|'));
  try {
    await waitState(page, 'attract');
    await page.evaluate(() => {
      window.__banners = [];
      const h2 = document.querySelector('#banner h2');
      new MutationObserver(list => list.forEach(r => r.addedNodes.forEach(n => window.__banners.push(n.textContent)))).observe(h2, { childList: true });
    });
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.evaluate(step => {   // a combo of 6 in the making, and the hop that makes it 7 (queued before the next step)
      const h = window.hopLanes, p = h.players[0];
      p.combo = 6; p.lastHop = h.playTick * step;
      window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
    }, STEP);
    await page.waitForFunction(() => document.querySelector('#score1 b').classList.contains('hot'), null, { timeout: T });
    await hop(page, () => { window.hopLanes.camRow = 101; });
    await waitState(page, 'over');   // left behind by the jump of the view
    assert.match(await banners(), /DESERT/, 'the new land was named');
    await resultsVisible(page);
    await hop(page, () => { window.__banners = []; });
    await page.keyboard.press('KeyW');   // over -> countdown, no title frame in between
    await waitState(page, 'play');
    assert.equal(await page.locator('#score1 b').evaluate(el => el.classList.contains('hot')), false, 'a new game starts without the gold tint');
    await hop(page, () => { window.hopLanes.camRow = 101; });
    await waitState(page, 'over');
    assert.match(await banners(), /DESERT/, 'named again in the next game');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13f. pause -> RESTART in play ends the play look and saves the coins; resume does not say GO! again', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-18');   // seed 18: a coin right in front of P1
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => /GO!/.test(document.getElementById('live').textContent), null, { timeout: T });
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.bank === 1, null, { timeout: T });
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.coins')), '0', 'coins of a run are saved at its end');
    const said = await page.locator('#live').textContent();
    await page.keyboard.press('KeyP');
    await waitState(page, 'paused');
    await page.keyboard.press('KeyP');
    await waitState(page, 'play');
    await settle(page, 400);
    assert.equal(await page.locator('#live').textContent(), said, 'a resume is not a new game: no second GO!');
    await page.keyboard.press('KeyP');
    await waitState(page, 'paused');
    await page.click('#restartBtn');
    await waitState(page, 'attract');
    assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('playing')), false, 'the title shows its START button again');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.coins')), '1', 'the coin is saved');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13g. race: the survivor stands still during the results (the rules stop at game over)', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42', { storage: { 'hoplanes.mode': 'race' } });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('ArrowUp');
    await waitState(page, 'play');
    await waitTicks(page, Math.round(1 / STEP));
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'splash'));
    await waitState(page, 'over');
    const before = await hop(page, () => { const p = window.hopLanes.players[1]; return { alive: p.alive, idleT: p.idleT, x: p.x, row: p.row, eagle: !!p.eagle }; });
    assert.equal(before.alive, true);
    await settle(page, 1500);
    const after = await hop(page, () => { const p = window.hopLanes.players[1]; return { alive: p.alive, idleT: p.idleT, x: p.x, row: p.row, eagle: !!p.eagle }; });
    assert.deepEqual(after, before, 'no eagle clock, no log, no hazard after the end');
    assert.match(await page.locator('#resTitle').textContent(), /FOX WINS!/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13h. a daily run on a world built before midnight counts for that day; at midnight the title builds the new day', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.mode': 'daily' }, context: { timezoneId: 'UTC' } });
  await context.addInitScript(() => {   // a clock the test moves (Date only: the game's frame clock runs on)
    const Real = Date;
    let shift = Date.parse('2026-10-17T23:59:00Z') - Real.now();
    window.__setNow = iso => { shift = Real.parse(iso) - Real.now(); };
    window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } };
    const every = window.setInterval;   // the minute check of the day, every 0.3 s here
    window.setInterval = (f, ms, ...a) => every(f, ms === 60000 ? 300 : ms, ...a);
  });
  try {
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.seed), dailySeedFor('2026-10-17'));
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hop(page, () => window.__setNow('2026-10-18T00:00:20Z'));   // midnight passes during the run
    await settle(page, 600);
    await hopThenDie(page);
    await resultsVisible(page);
    assert.match(await page.evaluate(() => localStorage.getItem('hoplanes.streak')), /^2026-10-17\|1$/, 'the streak counts the day of the world');
    await page.waitForFunction(() => !!localStorage.getItem('hoplanes.local'), null, { timeout: T });
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local')))[0].day, '2026-10-17');
    await page.keyboard.press('Space');
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.seed), dailySeedFor('2026-10-18'), 'the title after the run is the new day');
    const listed = () => page.locator('#dayMissions').textContent();
    const before = await listed();
    await hop(page, () => window.__setNow('2026-10-19T00:00:20Z'));   // midnight passes on the title
    await page.waitForFunction(s => window.hopLanes.seed === s, dailySeedFor('2026-10-19'), { timeout: T });
    if (String(dailyMissions('2026-10-18')) !== String(dailyMissions('2026-10-19'))) assert.notEqual(await listed(), before, "today's missions are the new day's");
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
