// Layout tests for Hop Lanes across viewports. Run: node tests/layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import { ROOT, launch, open, waitState } from './browser.mjs';

let INDEX = '';   // served over http (set in before): module scripts do not load from file://

let browser, site;

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
    const { context, page } = await open(browser, INDEX + '#debug-seed-3', { context: {
      viewport: { width: vp.width, height: vp.height },
      ...(vp.touch ? { isMobile: true, hasTouch: true } : {}),
    } });
    try {
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
