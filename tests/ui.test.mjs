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
import { RULES, STEP, dailySeedFor, isoDay } from '../js/rules.js';
import { dailyMissions } from '../js/missions.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';

const SLOW = 120000; // whole-test budget for tests that wait through a game

let browser, site, INDEX = '';

// New context + page on the game (browser.mjs open): storage, clipboard, scale, noShare, phone. The initials are set
// (a first local top-10 entry would ask for them over the results) unless a test sets 'hoplanes.initials' itself
const open = (url, opts = {}) => openPage(browser, url, { ...opts, storage: { 'hoplanes.initials': 'TST', ...(opts.storage || {}) } });
const hop = (page, fn) => page.evaluate(fn);
// the results show, and a tap or key plays again now (they wait RETRY_AFTER first)
const resultsVisible = async page => {
  await page.locator('#results').waitFor({ state: 'visible', timeout: T });
  await page.waitForFunction(() => window.hopLanes.canRetry, null, { timeout: T });
};
// the results' MENU (Escape): back to the title
const toTitle = page => page.keyboard.press('Escape');

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
    assert.deepEqual(lines, ['REACH ROW 15', 'RIDE 2 LOGS', '1 NEAR MISS'], 'a new player starts with the easy three');
    assert.equal(await page.locator('#missions').isVisible(), false, 'the lists live in a dialog');
    assert.match(await page.locator('#missionChip').textContent(), /MISSIONS 0\/3 · TODAY 0\/3/);
    await page.click('#missionChip');
    await page.locator('#missionsBox').waitFor({ state: 'visible', timeout: T });
    assert.equal(await page.locator('#missions li').first().isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#missionsBox').isHidden(), true, 'Escape closes the missions');
    assert.match(await page.locator('#modeText').textContent(), /^MODE: /);
    assert.match(await page.locator('#modeNote').textContent(), /HOP AS FAR AS YOU CAN/);
    await page.click('#settings');   // language and handicap live in the settings panel
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'ES');
    assert.match(await page.locator('#modeText').textContent(), /^MODO: /);
    assert.match(await page.locator('#missions h3').textContent(), /MISIONES/);
    assert.match(await page.locator('#start').textContent(), /EMPEZAR/);
    assert.equal(await page.locator('#tap1').textContent(), 'TOCA');
    assert.equal(await page.locator('#tap1').getAttribute('aria-label'), 'JUGADOR 1: SALTAR', 'aria labels follow the language');
    assert.equal(await page.locator('#card1 .cyc[data-d="1"]').getAttribute('aria-label'), 'JUGADOR 1: ANIMAL SIGUIENTE');
    assert.match(await page.locator('canvas').getAttribute('aria-label'), /^VISTA DEL JUEGO/);
    assert.equal(await page.locator('#mute').getAttribute('aria-label'), 'SONIDO');
    assert.match(await page.locator('#settingsTitle').textContent(), /AJUSTES/);
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'DE');
    assert.equal(await page.locator('#tap1').textContent(), 'TIPPEN');
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'EN');
    assert.match(await page.locator('#modeText').textContent(), /^MODE: /);
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
  const today = isoDay();
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
    assert.match(await page.locator('#chipToday').textContent(), /TODAY 1\/3/, 'the chip counts the paid one');
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

// the mode picker: MODE opens a dialog with every mode; a tap on one picks it and closes the dialog
const pickMode = async (page, mode) => {
  await page.click('#mode');
  await page.locator('#modeBox').waitFor({ state: 'visible', timeout: T });
  await page.click('#modeList button[data-mode="' + mode + '"]');
};
test('3. the mode picker lists every mode with a line on it; a pick persists; a closed room code keeps the mode', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'classic');
    assert.match(await page.locator('#mode').textContent(), /CLASSIC/);
    await page.click('#mode');
    await page.locator('#modeBox').waitFor({ state: 'visible', timeout: T });
    const names = await page.locator('#modeList button b').allTextContents();
    assert.deepEqual(names, ['CLASSIC', 'RACE', 'COIN WAR', 'TAG', 'DAILY', 'ROOM']);
    assert.match(await page.locator('#modeList button[data-mode="race"] small').textContent(), /FIRST TO FALL LOSES/);
    assert.equal(await page.locator('#modeList button[data-mode="race"] i').textContent(), '2 PLAYERS', 'the two-player modes say so');
    assert.equal(await page.locator('#modeList button[data-mode="daily"] i').count(), 0);
    assert.equal(await page.locator('#modeList button[aria-checked="true"]').getAttribute('data-mode'), 'classic', 'the current mode is marked');
    await page.click('#modeList button[data-mode="race"]');
    assert.equal(await page.locator('#modeBox').isHidden(), true, 'a pick closes the dialog');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'race');
    assert.match(await page.locator('#mode').textContent(), /RACE/);
    assert.match(await page.locator('#modeNote').textContent(), /FIRST TO FALL LOSES/);
    await pickMode(page, 'coinwar');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'coinwar');
    assert.match(await page.locator('#mode').textContent(), /COIN WAR/);
    await pickMode(page, 'tag');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'tag');
    await pickMode(page, 'daily');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    assert.match(await page.locator('#mode').textContent(), /DAILY/);
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily', 'mode survives reload');
    assert.match(await page.locator('#mode').textContent(), /DAILY/);
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.mode')), 'daily');
    await page.click('#mode');
    await page.locator('#modeBox').waitFor({ state: 'visible', timeout: T });
    assert.equal(await page.locator('#modeList button[aria-checked="true"]').getAttribute('data-mode'), 'daily');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modeBox').isHidden(), true, 'Escape closes the picker');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily', 'and changes nothing');
    await pickMode(page, 'room');   // room mode asks for its code first; closed, the mode stays
    await page.locator('#codeBox').waitFor({ state: 'visible', timeout: T });
    await page.click('#codeCancel');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    assert.match(await page.locator('#mode').textContent(), /DAILY/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('4. daily mode uses the daily seed in attract and in play', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await pickMode(page, 'daily');
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
    // P1 stays idle; P2 keeps hopping so it is never idle long enough for the eagle.
    // P2 hops side to side on row 0, not forward: a forward hop can land in a car or the river and P2 then dies
    // before the eagle takes P1 (the flake this test had). gen.js puts no tree in play on rows 0 and 1, and the
    // scroll line needs far longer than the eagle's EAGLE_IDLE to catch row 0, so these hops are always safe.
    const deadline = Date.now() + 90000;
    let side = 'ArrowLeft';
    while (Date.now() < deadline && (await hop(page, () => window.hopLanes.state)) !== 'over') {
      await page.keyboard.press(side);
      side = side === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
      await waitTicks(page, Math.round(1.5 / STEP));   // 1.5 s of game steps between hops
    }
    assert.equal(await hop(page, () => window.hopLanes.state), 'over');
    const p2alive = await hop(page, () => window.hopLanes.players[1].alive);
    await page.locator('#resTitle').waitFor({ state: 'visible', timeout: T });
    const title = await page.locator('#resTitle').textContent();
    assert.equal(p2alive, true, 'the hopping fox outlives the idle frog');
    assert.match(title, /FOX WINS/);
    assert.equal(await hop(page, () => window.hopLanes.players[0].cause), 'eagle', 'the idle frog went to the eagle');
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
    const today = isoDay();
    assert.equal(top[0].day, today, 'the day is a plain YYYY-MM-DD');
    assert.match(await page.locator('#world').textContent(), new RegExp('WORLD BEST ' + score + ' · FROG')); // eslint-disable-line security/detect-non-literal-regexp -- the score is a number
    // back on the title the TOP 10 button lists the same score
    await resultsVisible(page);
    await toTitle(page);
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
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.initials': '' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await page.locator('#board').isVisible(), true, 'the TOP 10 button shows without a server');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.players[0].row >= 1, null, { timeout: T });
    await hop(page, () => window.hopLanes.kill(window.hopLanes.players[0], 'test'));
    await waitState(page, 'over');
    // the question for the initials opens with the results (never inside a game step); closed, the device tag stands
    // in and nothing is saved
    await page.locator('#codeBox').waitFor({ state: 'visible', timeout: T });
    assert.equal(await page.locator('#results').isVisible(), true, 'over the results');
    assert.equal(await page.locator('#slots .slot').count(), 3);
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.local')), null, 'the entry waits for the answer');
    await page.click('#codeCancel');
    const score = await hop(page, () => window.hopLanes.players[0].score);
    assert.ok(score >= 1, 'scored ' + score);
    assert.equal(await page.locator('#resBest').isHidden(), true, 'a best under 10 gets no ribbon');
    assert.equal(await page.locator('#confetti').evaluate(el => el.children.length), 0, 'and no confetti');
    await page.waitForFunction(() => !!localStorage.getItem('hoplanes.local'), null, { timeout: T });
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local')));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].score, score);
    assert.match(saved[0].name, /^[A-Z2-9]{3} FROG$/, 'initials (the device tag) plus the animal');
    assert.equal(saved[0].mode, 'classic');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.initials')), '', 'a cancelled question is asked again another day');
    await resultsVisible(page);
    await toTitle(page);
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

test('7. new all-time best (10 or more) shows confetti and a ribbon', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.players[0].row >= 1 && !window.hopLanes.players[0].hop, null, { timeout: T });
    await hop(page, () => { const h = window.hopLanes; h.players[0].score = 12; h.kill(h.players[0], 'test'); });   // a run of 12 rows, as far as the results know
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
    await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 40; i++) L.feed(0.05); });   // the first 2 s window of a game is warm-up: not judged
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
    await toTitle(page);
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
    await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.62);
    await waitState(page, 'play', 120000);
    await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 40; i++) L.feed(0.05); });   // the warm-up window
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 60; i++) L.feed(0.05); return L.ratio; }), 1.5);
    assert.equal(await hop(page, () => { const L = window.hopLanes.ladder; for (let i = 0; i < 90; i++) L.feed(0.03); return L.ratio; }), 1.25);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('8f. biomes: the land changes every 50 rows; an unlocked look starts the world in a far biome', async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42', { storage: { 'hoplanes.best': '120' } });
  try {
    await waitState(page, 'attract');
    assert.deepEqual(await hop(page, () => [0, 60, 110, 160, 210].map(r => window.hopLanes.biomeIndex(r))), [0, 1, 2, 3, 0]);
    assert.equal(await hop(page, () => window.hopLanes.biome), 'MEADOW');
    await page.click('#settings');
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#lookNote').textContent(), /REACH ROW 150 TO UNLOCK SWAMP/, 'a best of 120 leaves the swamp locked');
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
    assert.equal(await hop(page, () => window.hopLanes.seed), 21216, 'the tutorial seed (the hint is not done yet)');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.waitForFunction(() => window.hopLanes.hint, null, { timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.hintText), 'W \u25b2');
    for (let n = 0; n < 3; n++) { await page.keyboard.press('KeyW'); await page.waitForFunction(() => !window.hopLanes.players[0].hop, null, { timeout: T }); }
    assert.equal(await hop(page, () => window.hopLanes.players[0].row), 3);
    await page.waitForFunction(() => /MIND THE TRAIN/.test(window.hopLanes.hintText), null, { timeout: T });   // the rail is next (row 4 of the tutorial world)
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); });
    await waitState(page, 'over', T);
    assert.ok(await hop(page, () => window.hopLanes.slowT) > 0, 'slow motion runs at game over');
    await page.waitForFunction(() => window.hopLanes.zoom > 1.1, null, { timeout: T });
    await resultsVisible(page);
    await toTitle(page);
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
    await toTitle(page);
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
      await toTitle(b.page);
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

test('13d. the initials are asked in the page, once, over the results: letter slots with up and down buttons, or typed', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.initials': '' } });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hopThenDie(page);
    await page.locator('#codeBox').waitFor({ state: 'visible', timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.state), 'over', 'asked on the results, never over a game');
    assert.match(await page.locator('#codeTitle').textContent(), /YOUR INITIALS/);
    const ups = page.locator('#slots .slot button:first-child');
    assert.equal(await ups.count(), 3);
    const box = await ups.first().boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, 'the letter buttons are 44px');
    await page.keyboard.press('KeyA'); await page.keyboard.press('KeyB'); await page.keyboard.press('KeyC');   // typed: the slots fill in turn
    await ups.nth(2).click();   // C -> D
    assert.equal((await page.locator('#slots b').allTextContents()).join(''), 'ABD');
    await page.click('#codeOk');
    assert.equal(await page.locator('#codeBox').isHidden(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.initials')), 'ABD');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local'))).map(e => e.name), ['ABD FROG']);
    await resultsVisible(page);
    await page.keyboard.press('KeyW');   // play again: no second question, the next entry has the initials
    await waitState(page, 'play');
    await hopThenDie(page);
    await resultsVisible(page);
    assert.equal(await page.locator('#codeBox').isHidden(), true, 'asked once');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('hoplanes.local'))).map(e => e.name), ['ABD FROG', 'ABD FROG']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('13e. play again after a run past row 50 shows the biome banner again; the combo tint resets', { timeout: SLOW }, async () => {
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
    await hop(page, () => { window.hopLanes.camRow = 51; });
    await waitState(page, 'over');   // left behind by the jump of the view
    assert.match(await banners(), /DESERT/, 'the new land was named');
    await resultsVisible(page);
    await hop(page, () => { window.__banners = []; });
    await page.keyboard.press('KeyW');   // over -> countdown, no title frame in between
    await waitState(page, 'play');
    assert.equal(await page.locator('#score1 b').evaluate(el => el.classList.contains('hot')), false, 'a new game starts without the gold tint');
    await hop(page, () => { window.hopLanes.camRow = 51; });
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
    await toTitle(page);
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

// ---- Wave 1: the results, fast retry, the HUD, the title ----
test('14a. the results: PLAY AGAIN first and focused, the cause and a tip, the stats; MENU and Escape go to the title', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42', { storage: { 'hoplanes.tips': JSON.stringify({ squash: 2 }) } });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hopThenDie(page, 'squash');
    await resultsVisible(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'again', 'PLAY AGAIN has the focus');
    const order = await page.evaluate(() => [...document.querySelectorAll('#results button, #results textarea')].filter(b => !b.hidden).map(b => b.id));
    assert.deepEqual(order, ['again', 'share', 'replayBtn', 'toMenu'], 'focus order');
    const h = (await page.locator('#again').boundingBox()).height;
    assert.ok(h >= 48, 'PLAY AGAIN is at least 48px high: ' + h);
    assert.equal(await page.locator('#resCause').textContent(), 'HIT BY A CAR · ROW 1');
    assert.equal(await page.locator('#resTip').textContent(), 'WAIT FOR A GAP', 'the third death of a kind still has its tip');
    assert.match(await page.locator('#resStats').textContent(), /ROW 15: 1\/15/, 'the missions\' progress');
    assert.equal(await page.locator('#resHint').textContent(), 'SPACE TO PLAY AGAIN', 'a keyboard plays again with Space');
    assert.equal(await page.locator('#score1').isVisible(), false, 'the live score chips hide');
    assert.equal(await page.locator('#start').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'START hides at game over');
    await page.click('#toMenu');
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hopThenDie(page, 'squash');
    await resultsVisible(page);
    assert.equal(await page.locator('#resTip').isHidden(), true, 'three tips of a kind, then no more');
    await page.keyboard.press('Escape');
    await waitState(page, 'attract');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14b. fast retry: PLAY AGAIN rejoins a two-player game with a full countdown; a joined player\'s key starts at once', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('ArrowUp');
    await waitState(page, 'play');
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); h.kill(h.players[1], 'test'); });
    await resultsVisible(page);
    await page.click('#again');
    await waitState(page, 'countdown');
    assert.deepEqual(await hop(page, () => window.hopLanes.players.map(p => p.joined)), [true, true], 'both play again');
    await page.waitForFunction(() => /^\d$/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    await page.keyboard.press('ArrowUp');   // player 2 is in: the key starts the game now
    await waitState(page, 'play', 3000);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14c. the room code is asked in the page; the picker names the room by its code', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await pickMode(page, 'room');   // classic -> room
    await page.locator('#codeBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#codeTitle').textContent(), /ROOM CODE/);
    assert.equal(await page.locator('#slots .slot').count(), 4);
    for (const k of ['KeyZ', 'KeyZ', 'Digit1', 'Digit2']) await page.keyboard.press(k);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#codeBox').isHidden(), true);
    assert.equal(await hop(page, () => window.hopLanes.mode), 'room');
    assert.equal(await page.locator('#modeText').textContent(), 'ROOM: ZZ12');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.room')), 'ZZ12');
    await page.click('#mode');
    await page.locator('#modeBox').waitFor({ state: 'visible', timeout: T });
    assert.equal(await page.locator('#modeList button[data-mode="room"] b').textContent(), 'ROOM: ZZ12', 'the picker shows the code');
    await page.click('#modeList button[data-mode="daily"]');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    await pickMode(page, 'room');   // room again: asked again; closed, the mode stays
    await page.locator('#codeBox').waitFor({ state: 'visible', timeout: T });
    await page.keyboard.press('Escape');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'daily');
    assert.equal(await hop(page, () => window.hopLanes.state), 'attract', 'nothing joined');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14d. coin missions add up over runs; missions done today count on the chip', { timeout: SLOW }, async () => {
  // seed 18: a coin right in front of P1; mission 0 (10 coins) has 9 from earlier runs
  const { context, page, errors } = await open(INDEX + '-seed-18', { storage: { 'hoplanes.missions': '3,0,1,2', 'hoplanes.mcoins': '0:9' } });
  try {
    await waitState(page, 'attract');
    assert.match(await page.locator('#missions li').first().textContent(), /COLLECT 10 COINS · 9\/10/);
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.keyboard.press('KeyW');
    await page.waitForFunction(() => window.hopLanes.run.coins === 1, null, { timeout: T });
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); });
    await resultsVisible(page);
    assert.match(await page.locator('#resNote').textContent(), /MISSION DONE \+20: COLLECT 10 COINS/);
    assert.match(await page.locator('#resStats').textContent(), /^\+1 COIN · COINS 10: 10\/10/);
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.missions')), '4,3,1,2');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.mcoins')), '', 'the done mission takes its coins with it');
    assert.match(await page.locator('#chipMissions').textContent(), /MISSIONS 1\/3/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14e. the HUD: chips with pills, OUT in two-player games, a red ring and a spoken warning before the eagle', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('ArrowUp');
    await waitState(page, 'play');
    assert.equal(await page.locator('#marquee .hs').first().isVisible(), false, 'the top bar is a slim strip in play');
    assert.equal(await page.locator('#bank').isVisible(), true, 'with the coins');
    await page.evaluate(() => { window.__alarm = false; new MutationObserver(() => { if (document.getElementById('score1').classList.contains('alarm')) window.__alarm = true; }).observe(document.getElementById('score1'), { attributes: true }); });
    await page.keyboard.press('ArrowUp');   // player 2 moves; player 1 stands still until the eagle warning
    await page.waitForFunction(() => window.hopLanes.players[0].warned, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__alarm, null, { timeout: T });
    assert.match(await page.locator('#live').textContent(), /PLAYER 1: MOVE!/);
    // player 2 falls: its chip says OUT at 45% (rules 4 may bring it back soon, so the change is caught as it happens)
    const out = await hop(page, () => {
      const h = window.hopLanes, el = document.getElementById('score2');
      h.kill(h.players[1], 'squash');
      return { dead: el.classList.contains('dead'), text: el.querySelector('.out').textContent, shown: !el.querySelector('.out').hidden, opacity: getComputedStyle(el).opacity };
    });
    assert.deepEqual(out, { dead: true, text: 'OUT', shown: true, opacity: '0.45' });
    const size = await page.locator('#score1 .lbl').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 8, 'the label is at least 8px: ' + size);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14f. the rules-4 hooks draw: WAIT FOR P2 and a rope, +LIFE, the comeback from OUT', async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('ArrowUp');
    await waitState(page, 'play');
    await hop(page, () => { const h = window.hopLanes, [a, b] = h.players; h.fx.leashed(a, b); h.fx.trait(b, 'cat'); });
    await page.waitForFunction(() => document.querySelectorAll('.say').length === 2, null, { timeout: T });
    assert.deepEqual(await page.locator('.say').allTextContents(), ['WAIT FOR P2', '+LIFE']);
    await page.waitForFunction(() => document.querySelectorAll('.say').length === 0, null, { timeout: T });   // gone after a moment
    await hop(page, () => { const h = window.hopLanes, b = h.players[1]; h.kill(b, 'squash'); });
    await page.waitForFunction(() => document.getElementById('score2').classList.contains('dead'), null, { timeout: T });
    await hop(page, () => { const h = window.hopLanes, b = h.players[1]; b.alive = true; b.safeT = 1; h.fx.rejoin(b, null); });
    assert.equal(await page.locator('#score2').evaluate(el => el.classList.contains('dead')), false, 'the chip is back');
    assert.equal(await hop(page, () => !!window.hopLanes.players[1].mesh), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('14g. a finger on the field: the animal crouches at once, the hop comes on release', async () => {
  const { context, page, errors } = await open(INDEX + '-seed-42');
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62);
    await page.mouse.down();
    await page.waitForFunction(() => window.hopLanes.players[0].mesh.userData.body.scale.y < 0.85, null, { timeout: T });
    assert.equal(await hop(page, () => window.hopLanes.record.length), 0, 'no hop yet');
    await page.mouse.up();
    await page.waitForFunction(() => window.hopLanes.record.length === 1, null, { timeout: T });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// ---- the leftovers of the design review: the paint shop, the BEST ribbon, the come-back bonus ----
test('15a. the paint shop: a paint is bought once per animal with coins, worn at once, and shows on the card and in play', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.coins': '40' } });
  try {
    await waitState(page, 'attract');
    await page.click('#paintBtn');
    await page.locator('#paintBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#paintName').textContent(), /FROG · CLASSIC/, 'opens on player 1\'s animal');
    assert.equal(await page.locator('#swatches button').count(), 7);
    assert.equal(await page.locator('#swatches button[aria-checked="true"]').getAttribute('data-i'), '0', 'classic is worn');
    assert.match(await page.locator('#swatches button[data-i="1"]').textContent(), /GOLD · 25/, 'a locked paint shows its price');
    assert.match(await page.locator('#paintNote').textContent(), /YOU HAVE 40 COINS/);
    await page.click('#swatches button[data-i="5"]');   // LAVA costs 40: the whole bank
    assert.equal(await hop(page, () => window.hopLanes.bank), 0, 'LAVA cost 40');
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'lava');
    assert.match(await page.locator('#paintName').textContent(), /FROG · LAVA/);
    assert.equal(await page.locator('#swatches button[aria-checked="true"]').getAttribute('data-i'), '5');
    assert.doesNotMatch(await page.locator('#swatches button[data-i="5"]').textContent(), /40/, 'a bought paint shows no price');
    await page.click('#swatches button[data-i="6"]');   // NIGHT: no coins left
    assert.match(await page.locator('#paintNote').textContent(), /NEED 40 COINS/);
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'lava', 'still lava');
    await page.click('#swatches button[data-i="0"]');   // back to classic: free
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'classic');
    await page.click('#swatches button[data-i="5"]');   // lava again: bought already, no coins asked
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'lava');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.paints')), 'frog:lava');
    assert.equal(await page.evaluate(() => localStorage.getItem('hoplanes.painted')), 'frog=lava');
    await page.click('#paintNext');   // the fox (owned): classic, its own paints
    assert.match(await page.locator('#paintName').textContent(), /FOX · CLASSIC/);
    assert.match(await page.locator('#swatches button[data-i="5"]').textContent(), /LAVA · 40/, 'a paint is bought per animal');
    await page.click('#paintNext');   // bunny is not owned: back to the frog
    assert.match(await page.locator('#paintName').textContent(), /FROG · LAVA/);
    await page.click('#closePaint');
    assert.equal(await page.locator('#paintBox').isHidden(), true);
    // the join card draws the frog in lava, and the animal in play is built in it (a reload keeps it)
    const lava = await page.evaluate(() => [...document.querySelectorAll('#pic1 rect')].filter(r => r.getAttribute('fill') === '#ff5a2a').length);
    assert.ok(lava > 10, 'the portrait is painted: ' + lava);
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'lava', 'the paint is kept');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    const body = await page.evaluate(() => { const g = window.hopLanes.players[0].mesh.userData.body.geometry.attributes.color.array; let n = 0; for (let i = 0; i < g.length; i += 3) if (g[i] > 0.9 && g[i + 1] < 0.5 && g[i + 2] < 0.3) n++; return n; });
    assert.ok(body > 0, 'the frog\'s body is lava red in play: ' + body);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// the ribbon's row as built: on a wide screen the title builds rows to about 11 at once and the rest one a frame, so the
// rows to 30 are built first (laneKinds builds the missing ones), whatever the frame timing (CI once read it too early)
const ribbonBuilt = page => hop(page, () => { window.hopLanes.laneKinds(); return window.hopLanes.ribbonRow; });
test('15b. the BEST ribbon lies on the row of the all-time best (10 or more), in every world built', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.best': '15' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await ribbonBuilt(page), 15);
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    assert.equal(await ribbonBuilt(page), 15, 'the game world has it too');
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await ribbonBuilt(page), 15);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const low = await open(INDEX, { storage: { 'hoplanes.best': '7' } });
  try {
    await waitState(low.page, 'attract');
    assert.equal(await ribbonBuilt(low.page), -1, 'a best under 10 gets no ribbon');
    assert.deepEqual(low.errors, []);
  } finally { await low.context.close(); }
});

test('15c. the come-back bonus: the first title of a day pays coins, more for days in a row, once a day; a new player only starts the count', async () => {
  const day = d => d.toISOString().slice(0, 10);   // the page runs in UTC
  const today = day(new Date()), yesterday = day(new Date(Date.now() - 86400000));
  const back = await open(INDEX, { storage: { 'hoplanes.best': '20', 'hoplanes.coins': '5', 'hoplanes.visit': yesterday + '|2' }, context: { timezoneId: 'UTC' } });
  try {
    await waitState(back.page, 'attract');
    await back.page.waitForFunction(() => /WELCOME BACK/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    assert.match(await back.page.locator('#banner p').textContent(), /\+20 COINS · DAY 3 IN A ROW/);
    assert.equal(await hop(back.page, () => window.hopLanes.bank), 25);
    assert.equal(await back.page.evaluate(() => localStorage.getItem('hoplanes.visit')), today + '|3');
    // back on the title the same day (a game played to its end, then MENU): nothing more
    await back.page.keyboard.press('KeyW');
    await waitState(back.page, 'play');
    await hop(back.page, () => { const h = window.hopLanes; h.kill(h.players[0], 'test'); });
    await waitState(back.page, 'over');
    await resultsVisible(back.page);
    await toTitle(back.page);
    await waitState(back.page, 'attract');
    await settle(back.page, 300);
    assert.equal(await hop(back.page, () => window.hopLanes.bank), 25, 'paid once a day');
    assert.doesNotMatch(await back.page.locator('#banner h2').textContent(), /WELCOME/);
    assert.equal(await back.page.evaluate(() => localStorage.getItem('hoplanes.visit')), today + '|3');
    assert.deepEqual(back.errors, []);
  } finally { await back.context.close(); }
  const gap = await open(INDEX, { storage: { 'hoplanes.best': '20', 'hoplanes.visit': '2026-01-01|4' }, context: { timezoneId: 'UTC' } });
  try {
    await waitState(gap.page, 'attract');
    await gap.page.waitForFunction(() => /WELCOME BACK/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    assert.match(await gap.page.locator('#banner p').textContent(), /^\+10 COINS$/, 'a gap starts over at day 1');
    assert.equal(await hop(gap.page, () => window.hopLanes.bank), 10);
    assert.deepEqual(gap.errors, []);
  } finally { await gap.context.close(); }
  const fresh = await open(INDEX, { context: { timezoneId: 'UTC' } });
  try {
    await waitState(fresh.page, 'attract');
    await settle(fresh.page, 300);
    assert.equal(await hop(fresh.page, () => window.hopLanes.bank), 0, 'a new player gets no bonus yet');
    assert.equal(await fresh.page.evaluate(() => localStorage.getItem('hoplanes.visit')), today + '|1', 'but the count starts');
    assert.deepEqual(fresh.errors, []);
  } finally { await fresh.context.close(); }
});

// ---- the review's gaps (18 Oct 2026) ----
test('16a. NEW BEST TODAY gets its ribbon and jingle, in the player\'s language', { timeout: SLOW }, async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.best': '50', 'hoplanes.lang': 'es' } });
  try {
    await waitState(page, 'attract');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hop(page, () => { const h = window.hopLanes; h.players[0].score = 12; h.kill(h.players[0], 'test'); });
    await waitState(page, 'over');
    await resultsVisible(page);
    assert.equal(await page.locator('#resBest').isVisible(), true, 'today\'s best has the ribbon');
    assert.equal(await page.locator('#resBest').textContent(), '¡MEJOR DE HOY!', 'translated, not the English key');
    assert.doesNotMatch(await page.locator('#resNote').textContent(), /BEST/, 'and it is not in the note');
    assert.equal(await page.locator('#confetti').evaluate(c => c.children.length), 0, 'no confetti: not an all-time best');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('16b. a paint the game does not know reads as classic; two animals keep their paints over a reload', async () => {
  const { context, page, errors } = await open(INDEX, { storage: { 'hoplanes.paints': 'frog:zzz,fox:sky', 'hoplanes.painted': 'frog=zzz,fox=sky', 'hoplanes.tips': '5' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.paintOf('frog')), 'classic', 'an unknown paint is not worn');
    assert.equal(await hop(page, () => window.hopLanes.paintOf('fox')), 'sky');
    await page.click('#paintBtn');
    await page.locator('#paintBox').waitFor({ state: 'visible', timeout: T });
    assert.match(await page.locator('#paintName').textContent(), /FROG · CLASSIC/);
    await page.click('#paintNext');
    assert.match(await page.locator('#paintName').textContent(), /FOX · SKY/);
    await page.keyboard.press('Escape');
    await page.reload();
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.paintOf('fox')), 'sky', 'kept');
    // a tampered tips value does not stop a game over (it is read in the game step that ends the run)
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await hop(page, () => { const h = window.hopLanes; h.kill(h.players[0], 'squash'); });
    await waitState(page, 'over');
    await resultsVisible(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('16c. a replay link: no come-back bonus while it plays; a key on its results goes to the title, where the bonus is paid', { timeout: SLOW }, async () => {
  const day = d => d.toISOString().slice(0, 10), yesterday = day(new Date(Date.now() - 86400000));
  const code = encodeReplay({ version: RULES, seed: 42, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 0, events: [[12, 0, 0, 1]] });
  const { context, page, errors } = await open(INDEX + '-replay-' + code, { storage: { 'hoplanes.best': '20', 'hoplanes.visit': yesterday + '|1' }, context: { timezoneId: 'UTC' } });
  try {
    await waitState(page, 'play', 120000);
    assert.equal(await hop(page, () => !!window.hopLanes.replay), true);
    assert.equal(await hop(page, () => window.hopLanes.bank), 0, 'nothing paid while the replay runs');
    await waitState(page, 'over', 120000);   // one hop, then the eagle
    await resultsVisible(page);
    assert.equal(await page.locator('#again').textContent(), 'MENU');
    await page.keyboard.press('KeyW');   // a player's key: the title, not a new game
    await waitState(page, 'attract');
    await settle(page, 300);
    assert.equal(await hop(page, () => window.hopLanes.state), 'attract', 'no join from the replay\'s results');
    assert.equal(await hop(page, () => !!window.hopLanes.replay), false);
    assert.equal(await hop(page, () => window.hopLanes.bank), 15, 'the bonus came with the title: day 2');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('16d. the mode button and the paint shop do nothing in play; a saved pixel ratio outside the ladder is ignored', async () => {
  const { context, page, errors } = await open(INDEX, { scale: 1.5, storage: { 'hoplanes.ratio': '0.3' } });
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.pixelRatio), 1.5, 'not 0.3');
    await page.keyboard.press('KeyW');
    await waitState(page, 'play');
    await page.evaluate(() => { document.getElementById('mode').click(); document.getElementById('paintBtn').click(); });
    await settle(page, 200);
    assert.equal(await page.locator('#modeBox').isHidden(), true);
    assert.equal(await page.locator('#paintBox').isHidden(), true);
    assert.equal(await hop(page, () => window.hopLanes.state), 'play');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('16e. a crash with a dialog open hides the dialog under the notice; Tab stays inside an open dialog', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    await page.click('#settings');
    await page.locator('#settingsBox').waitFor({ state: 'visible', timeout: T });
    for (let i = 0; i < 12; i++) {   // more Tabs than buttons: the focus never leaves the box
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#settingsBox')), true, 'Tab ' + i);
    }
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#settingsBox')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings', 'the focus goes back to the button that opened it');
    await page.click('#settings');
    await hop(page, () => window.hopLanes.boom());
    await page.waitForFunction(() => /SOMETHING BROKE/.test(document.querySelector('#banner h2').textContent), null, { timeout: T });
    assert.equal(await page.locator('#settingsBox').isHidden(), true);
    assert.equal(errors.length, 1);
  } finally { await context.close(); }
});
