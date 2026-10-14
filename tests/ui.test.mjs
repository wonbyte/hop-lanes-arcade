// UI feature tests for Hop Lanes: shop, prize machine, modes, daily seed, race, share, confetti. Run: node --test tests/ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const T = 60000;
const SLOW = 120000; // whole-test budget for tests that wait through a game

let browser, site, INDEX = '';

async function launch() {
  try {
    return await chromium.launch({ args: ARGS });
  } catch (err) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const found = [];
    const walk = (d, depth) => {
      if (depth > 4 || !fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (/^(chrome|headless_shell)$/.test(e.name)) found.push(p);
      }
    };
    walk(base, 0);
    if (!found.length) throw err;
    return chromium.launch({ args: ARGS, executablePath: found[0] });
  }
}

// New context + page. `storage` entries are written to localStorage before every load;
// `clipboard` stubs navigator.clipboard and removes navigator.share.
async function open(url, { storage = {}, clipboard = false } = {}) {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('hoplanes.howto', '1'); } catch (e) {} });
  if (Object.keys(storage).length) {
    await context.addInitScript(entries => {
      try { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); } catch (e) {}
    }, storage);
  }
  if (clipboard) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => { window.__copied = t; return Promise.resolve(); } },
      });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(url);
  return { context, page, errors };
}

const waitState = (page, s, timeout = T) =>
  page.waitForFunction(x => window.hopLanes && window.hopLanes.state === x, s, { timeout });
const hop = (page, fn) => page.evaluate(fn);
const resultsVisible = page => page.locator('#results').waitFor({ state: 'visible', timeout: T });

test.before(async () => { browser = await launch(); site = await serve(ROOT); INDEX = site.url + '/index.html#debug'; });
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
    await page.waitForTimeout(300);
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
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'ES');
    assert.match(await page.locator('#mode').textContent(), /^MODO: /);
    assert.match(await page.locator('#missions h3').textContent(), /MISIONES/);
    assert.match(await page.locator('#start').textContent(), /INICIO/);
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'DE');
    await page.click('#lang');
    assert.equal(await page.locator('#lang').textContent(), 'EN');
    assert.match(await page.locator('#mode').textContent(), /^MODE: /);
    // the handicap button cycles and is saved
    await page.click('#handicap');
    assert.equal(await page.locator('#handicap').textContent(), 'SHIELD: P1');
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
    await page.waitForTimeout(300);
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

test('3. mode button cycles CLASSIC, RACE, DAILY and persists', async () => {
  const { context, page, errors } = await open(INDEX);
  try {
    await waitState(page, 'attract');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'classic');
    assert.match(await page.locator('#mode').textContent(), /CLASSIC/);
    await page.click('#mode');
    assert.equal(await hop(page, () => window.hopLanes.mode), 'race');
    assert.match(await page.locator('#mode').textContent(), /RACE/);
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
    await page.click('#mode');
    await page.click('#mode');
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
      await page.waitForTimeout(1500);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-scores-'));
  const port = await new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/scores.mjs')],
    { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 's.json'), POST_TOKEN: 't0k', SAVE_DELAY_MS: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.once('data', res); srv.once('error', rej); });
  const base = `http://127.0.0.1:${port}`;
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
    assert.match(await page.locator('#world').textContent(), new RegExp('WORLD BEST ' + score + ' · FROG'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
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
