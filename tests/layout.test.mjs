// Layout tests for Hop Lanes across viewports. Run: node tests/layout.test.mjs
// For each screen size: the title, SETTINGS, TOP 10, play (the HUD) and the results. Every button that shows is fully
// on screen, big enough to hit, and not covered by anything; no text is under 8px; no sideways scroll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import { ROOT, T, launch, open, waitState, settle } from './browser.mjs';

let INDEX = '';   // served over http (set in before): module scripts do not load from file://

let browser, site;

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, touch: false },
  { name: '390x844', width: 390, height: 844, touch: true },
  { name: '844x390', width: 844, height: 390, touch: true },
  { name: '844x300', width: 844, height: 300, touch: true },
  { name: '591x230', width: 591, height: 230, touch: true },   // the Claude app's frame on a phone held sideways
  { name: '1280x800', width: 1280, height: 800, touch: false },
];

// Runs in the page: returns a list of human-readable problems.
// The touch targets: the card arrows, the sound button and the title menu's buttons at least 44x44, the side buttons
// at least 40 (they shrink with a narrow screen), everything else 32.
function collectProblems() {
  const out = [];
  const W = window.innerWidth, H = window.innerHeight;
  if (document.documentElement.scrollWidth > W)
    out.push(`horizontal scroll: scrollWidth ${document.documentElement.scrollWidth} > innerWidth ${W}`);
  const desc = b => `${b.tagName.toLowerCase()}${b.id ? '#' + b.id : ''}${b.className && typeof b.className === 'string' ? '.' + b.className.trim().split(/\s+/).join('.') : ''} "${(b.textContent || '').trim().slice(0, 20)}"`;
  const floor = b => (b.matches('.cyc, #mute, #pauseBtn, #menu button, #again') ? 44 : b.matches('.side') ? 40 : 32);
  const dialog = document.querySelector('.dialog:not([hidden])');
  for (const b of document.querySelectorAll('button')) {
    if (b.offsetParent === null) continue;
    if (getComputedStyle(b).visibility !== 'visible') continue;
    if (dialog && !dialog.contains(b)) continue;   // a dialog covers the rest on purpose
    const r = b.getBoundingClientRect();
    const box = `[x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} r=${r.right.toFixed(1)} b=${r.bottom.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)}]`;
    if (r.x < 0 || r.y < 0 || r.right > W || r.bottom > H) { out.push(`button outside viewport ${W}x${H}: ${desc(b)} ${box}`); continue; }
    const min = floor(b);
    if (r.width < min - 0.5 || r.height < min - 0.5) out.push(`button smaller than ${min}x${min}: ${desc(b)} ${box}`);
    // not covered: the middle and four points toward the corners (inside the rounded shape) hit the button itself
    const at = (fx, fy) => [r.x + r.width * fx, r.y + r.height * fy];
    for (const [x, y] of [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)]) {
      const top = document.elementFromPoint(x, y);
      if (top && !b.contains(top)) { out.push(`button covered at ${x.toFixed(0)},${y.toFixed(0)}: ${desc(b)} by ${desc(top)}`); break; }
    }
  }
  // text: nothing under 8px
  const walker = document.createTreeWalker(document.body, 4);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement;
    if (!n.textContent.trim() || seen.has(el) || el.closest('.sr-only, #fps')) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.offsetParent === null && getComputedStyle(el).position !== 'fixed' || getComputedStyle(el).visibility !== 'visible') continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 8) out.push(`text under 8px (${fs}px): ${desc(el)}`);
  }
  const stage = document.getElementById('stage');
  const canvas = document.querySelector('canvas');
  if (!stage || !canvas) out.push('missing #stage or canvas');
  else if (canvas.clientWidth !== stage.clientWidth)
    out.push(`canvas.clientWidth ${canvas.clientWidth} !== stage.clientWidth ${stage.clientWidth}`);
  return out;
}

// the score chips sit clear of the top bar; the results panel clear of the top bar and the deck
function overlaps() {
  const out = [];
  const box = id => { const el = document.getElementById(id); return el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility === 'visible' ? el.getBoundingClientRect() : null; };
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const m = box('marquee'), deck = box('deck');
  for (const id of ['score1', 'score2', 'results']) {
    const b = box(id);
    if (b && m && hit(b, m)) out.push(`#${id} overlaps the top bar`);
  }
  const res = box('results');
  if (res && deck) for (const b of document.querySelectorAll('#deck button')) {
    const r = b.offsetParent && getComputedStyle(b).visibility === 'visible' ? b.getBoundingClientRect() : null;
    if (r && hit(res, r)) out.push('#results overlaps the deck button ' + (b.id || b.className));
  }
  return out;
}

test.before(async () => { browser = await launch(); site = await serve(ROOT); INDEX = site.url + '/index.html'; });
test.after(async () => { await browser?.close(); await site?.close(); });

for (const vp of VIEWPORTS) {
  test(`layout ${vp.name}`, { timeout: 240000 }, async () => {
    const { context, page, errors } = await open(browser, INDEX + '#debug-seed-3', {
      context: { viewport: { width: vp.width, height: vp.height }, ...(vp.touch ? { isMobile: true, hasTouch: true } : {}) },
      storage: { 'hoplanes.initials': 'TST', 'hoplanes.hint': '1' }
    });
    const check = async label => {
      await settle(page, 250);   // the panel's slide-up is over
      assert.deepEqual(await page.evaluate(collectProblems), [], `${label} @ ${vp.name}`);
      assert.deepEqual(await page.evaluate(overlaps), [], `${label} overlaps @ ${vp.name}`);
    };
    try {
      await waitState(page, 'attract');
      await check('attract');
      for (const [btn, close] of [['settings', 'closeSettings'], ['board', 'closeBoard'], ['missionChip', 'closeMissions'], ['mode', 'closeModes'], ['paintBtn', 'closePaint']]) {
        await page.evaluate(id => document.getElementById(id).click(), btn);
        await check(btn);
        await page.evaluate(id => document.getElementById(id).click(), close);
      }

      await page.keyboard.press('KeyW');
      await page.keyboard.press('ArrowUp');
      await waitState(page, 'play');
      // the combo, MAGNET and SLOW pills show (the effect hook that relabels the chip)
      await page.evaluate(() => { const h = window.hopLanes, p = h.players[0]; p.combo = 4; p.lastHop = 1e9; p.magnetT = 3; p.lead = true; h.fx.label(p); });
      await page.waitForFunction(() => !document.querySelector('#score1 .combo').hidden, null, { timeout: T });
      await check('play');

      await page.evaluate(() => { const h = window.hopLanes; h.kill(h.players[0], 'test'); h.kill(h.players[1], 'test'); });
      await waitState(page, 'over');
      await page.waitForFunction(() => window.hopLanes.canRetry, null, { timeout: T });
      await check('results');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
