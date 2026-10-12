// Smoke tests for Hop Lanes. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = pathToFileURL(path.join(ROOT, 'index.html')).href;
const STANDALONE = pathToFileURL(path.join(ROOT, 'hop-lanes-standalone.html')).href;
const THREE = path.join(ROOT, 'node_modules/three/build/three.min.js');
const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const T = 60000; // generous per-wait timeout

let browser;

async function launch() {
  try {
    return await chromium.launch({ args: ARGS });
  } catch (err) {
    // Installed playwright may not match the preinstalled browser build: look for one.
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

// New page with CDN three.js served locally and fonts blocked; collects errors.
async function open(ctxOpts, url, { network = 'cdn' } = {}) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  // blocked fonts/CDN requests log "Failed to load resource"; that is expected
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (network === 'cdn') {
    await page.route('**/three.min.js', r => r.fulfill({
      path: THREE, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
    }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  } else {
    await page.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  }
  await page.goto(url);
  return { context, page, errors, requests };
}

const state = page => page.evaluate(() => window.hopLanes.state);
const waitState = (page, s) =>
  page.waitForFunction(x => window.hopLanes && window.hopLanes.state === x, s, { timeout: T });

test.before(async () => { browser = await launch(); });
test.after(async () => { await browser?.close(); });

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

test('5. seeded worlds are deterministic', async () => {
  const kinds = async seed => {
    const { context, page } = await open({}, `${INDEX}#debug-seed-${seed}`);
    try {
      const ok = await page.waitForFunction(() => !!window.hopLanes, null, { timeout: 15000 }).then(() => true, () => false);
      assert.ok(ok, `FAIL: window.hopLanes missing for #debug-seed-${seed} (seed hash not supported by index.html yet)`);
      await waitState(page, 'attract');
      const r = await page.evaluate(() => {
        const h = window.hopLanes;
        if (typeof h.laneKinds !== 'function') return { missing: true };
        return { seed: h.seed, kinds: h.laneKinds() };
      });
      assert.ok(!r.missing, 'FAIL: window.hopLanes.laneKinds is not defined (seed feature missing from index.html)');
      return r;
    } finally { await context.close(); }
  };
  const a = await kinds(42), b = await kinds(42), c = await kinds(7);
  assert.equal(a.seed, 42);
  assert.equal(c.seed, 7);
  assert.equal(a.kinds.length >= 31, true, 'laneKinds covers rows 0..30');
  assert.deepEqual(a.kinds, b.kinds);
  assert.notDeepEqual(a.kinds, c.kinds);
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
