// Layout tests for Hop Lanes across viewports. Run: node tests/layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let INDEX = '';   // served over http (set in before): module scripts do not load from file://
const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const T = 60000;

let browser, site;

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

const waitState = (page, s) =>
  page.waitForFunction(x => window.hopLanes && window.hopLanes.state === x, s, { timeout: T });

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, touch: false },
  { name: '390x844', width: 390, height: 844, touch: true },
  { name: '844x390', width: 844, height: 390, touch: true },
  { name: '844x300', width: 844, height: 300, touch: true },
  { name: '1280x800', width: 1280, height: 800, touch: false },
];

// Runs in the page: returns a list of human-readable problems.
function collectProblems() {
  const out = [];
  const W = window.innerWidth, H = window.innerHeight;
  if (document.documentElement.scrollWidth > W)
    out.push(`horizontal scroll: scrollWidth ${document.documentElement.scrollWidth} > innerWidth ${W}`);
  const desc = b => `${b.tagName.toLowerCase()}${b.id ? '#' + b.id : ''}${b.className && typeof b.className === 'string' ? '.' + b.className.trim().split(/\s+/).join('.') : ''} "${(b.textContent || '').trim().slice(0, 20)}"`;
  for (const b of document.querySelectorAll('button')) {
    if (b.offsetParent === null) continue;
    if (getComputedStyle(b).visibility !== 'visible') continue;
    const r = b.getBoundingClientRect();
    const box = `[x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} r=${r.right.toFixed(1)} b=${r.bottom.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)}]`;
    if (r.x < 0 || r.y < 0 || r.right > W || r.bottom > H) out.push(`button outside viewport ${W}x${H}: ${desc(b)} ${box}`);
    if (r.width < 32 || r.height < 32) out.push(`button smaller than 32x32: ${desc(b)} ${box}`);
  }
  const stage = document.getElementById('stage');
  const canvas = document.querySelector('canvas');
  if (!stage || !canvas) out.push('missing #stage or canvas');
  else if (canvas.clientWidth !== stage.clientWidth)
    out.push(`canvas.clientWidth ${canvas.clientWidth} !== stage.clientWidth ${stage.clientWidth}`);
  return out;
}

function scoreOverlaps() {
  const out = [];
  const m = document.getElementById('marquee');
  if (!m) return ['missing #marquee'];
  const a = m.getBoundingClientRect();
  for (const id of ['score1', 'score2']) {
    const el = document.getElementById(id);
    if (!el) { out.push('missing #' + id); continue; }
    const b = el.getBoundingClientRect();
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 0.5 && oy > 0.5)
      out.push(`#${id} overlaps #marquee by ${ox.toFixed(1)}x${oy.toFixed(1)} (score ${JSON.stringify([b.x, b.y, b.right, b.bottom])}, marquee ${JSON.stringify([a.x, a.y, a.right, a.bottom])})`);
  }
  return out;
}

test.before(async () => { browser = await launch(); site = await serve(ROOT); INDEX = site.url + '/index.html'; });
test.after(async () => { await browser?.close(); await site?.close(); });

for (const vp of VIEWPORTS) {
  test(`layout ${vp.name}`, async () => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.touch ? { isMobile: true, hasTouch: true } : {}),
    });
    await context.addInitScript(() => {
      try { localStorage.setItem('hoplanes.howto', '1'); } catch {}
    });
    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    try {
      await page.goto(INDEX + '#debug-seed-3');
      await waitState(page, 'attract');
      assert.deepEqual(await page.evaluate(collectProblems), [], `attract @ ${vp.name}`);

      await page.keyboard.press('KeyW');
      await page.keyboard.press('ArrowUp');
      await waitState(page, 'play');
      assert.deepEqual(await page.evaluate(collectProblems), [], `play @ ${vp.name}`);
      assert.deepEqual(await page.evaluate(scoreOverlaps), [], `score/marquee @ ${vp.name}`);
    } finally { await context.close(); }
  });
}
