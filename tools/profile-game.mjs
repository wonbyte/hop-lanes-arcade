#!/usr/bin/env node
// Frame-time profile of the real page under a throttled CPU (what a mid-range phone feels like), as JSON.
// Headless Chromium draws with SwiftShader (software), so the numbers are only comparable with each other on the
// same machine: run it before and after a change. Scenes: the title at rows 0, 60 and 150 (the view jumps there),
// and 20 s of play. Run: node tools/profile-game.mjs [--cpu 4] [--out file.json]
import { serve } from '../tests/serve.mjs';
import { ROOT, launch, open, waitState, settle, hopKey } from '../tests/browser.mjs';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CPU = Number(arg('--cpu', 4)), OUT = arg('--out', '');
const SAMPLE_MS = 8000;

// drawn frames per second and draw calls, read from the game's own counter (#fps, debug mode) over SAMPLE_MS
async function sample(page, name) {
  const t0 = await page.evaluate(() => performance.now());
  const frames = await page.evaluate(ms => new Promise(res => {
    const times = []; let last = performance.now();
    const tick = now => { times.push(now - last); last = now; if (now - times[0] < 0 || times.length < 5 || performance.now() - start < ms) requestAnimationFrame(tick); else res(times); };
    const start = performance.now();
    requestAnimationFrame(tick);
  }), SAMPLE_MS);
  const draws = await page.evaluate(() => window.hopLanes.drawCalls);
  const sorted = frames.slice(1).sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const elapsed = (await page.evaluate(() => performance.now())) - t0;
  return { scene: name, frames: frames.length, fps: +(frames.length * 1000 / elapsed).toFixed(1), p50ms: +q(0.5).toFixed(1), p95ms: +q(0.95).toFixed(1), worstMs: +sorted[sorted.length - 1].toFixed(1), draws };
}

const browser = await launch(), site = await serve(ROOT);
const out = { cpuThrottle: CPU, node: process.version, scenes: [] };
try {
  const { context, page } = await open(browser, site.url + '/index.html#debug-seed-42', { phone: true, scale: 2 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await waitState(page, 'attract');
  await settle(page, 1000);
  out.pixelRatio = await page.evaluate(() => window.hopLanes.pixelRatio);
  for (const row of [0, 60, 150]) {
    await page.evaluate(r => { window.hopLanes.camRow = r; }, row);
    await settle(page, 1500);   // the rows there get built
    out.scenes.push(await sample(page, 'title row ' + row));
  }
  await page.evaluate(() => { window.hopLanes.camRow = 0; });
  await settle(page, 500);
  await page.keyboard.press('KeyW');
  await waitState(page, 'play');
  const playing = sample(page, 'play');
  for (let i = 0; i < 30 && (await page.evaluate(() => window.hopLanes.state)) === 'play'; i++) await hopKey(page, i % 5 === 2 ? 'KeyD' : 'KeyW');
  out.scenes.push(await playing);
  out.ladder = await page.evaluate(() => ({ ratio: window.hopLanes.ladder.ratio, shadow: window.hopLanes.ladder.shadow, shadowHalf: window.hopLanes.ladder.shadowHalf }));
  await context.close();
} finally { await browser.close(); await site.close(); }
const text = JSON.stringify(out, null, 1);
if (OUT) fs.writeFileSync(OUT, text);
console.log(text);
