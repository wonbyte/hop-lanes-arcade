// Shared helpers for the browser tests (smoke, layout, ui): the headless browser, a page on the game and waits on
// the game's own clock. The server comes from serve.mjs; each test file starts its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
export const T = 60000;   // generous per-wait timeout: SwiftShader is slow

// `autoplay` lets the title tune start without a gesture (the ui tests check it plays).
export async function launch({ autoplay = false } = {}) {
  const args = autoplay ? [...ARGS, '--autoplay-policy=no-user-gesture-required'] : ARGS;
  try {
    return await chromium.launch({ args });
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
    return chromium.launch({ args, executablePath: found[0] });
  }
}

// A new context and page on `url`, with fonts blocked and page errors collected ({ context, page, errors, requests }).
// context: extra browser context options (viewport, touch...). phone: a touch screen the size of a phone.
// scale: the device pixel ratio. network: 'cdn' blocks the fonts; 'offline' aborts and lists every http(s) request.
// fresh: do not mark the first-run help as seen (it would swallow the first tap otherwise).
// storage: localStorage entries written before every load. clipboard: stubs navigator.clipboard (the text lands
// in window.__copied) and removes navigator.share. noShare: removes both (the copy-by-hand fallback).
export async function open(browser, url, {
  context: ctxOpts = {}, phone = false, scale = 0, network = 'cdn', fresh = false,
  storage = {}, clipboard = false, noShare = false
} = {}) {
  const context = await browser.newContext({
    ...(scale ? { deviceScaleFactor: scale } : {}),
    ...(phone ? { isMobile: true, hasTouch: true, viewport: { width: 390, height: 760 } } : {}),
    ...ctxOpts
  });
  if (noShare) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
  }
  if (!fresh) await context.addInitScript(() => { try { localStorage.setItem('hoplanes.howto', '1'); } catch (e) {} });
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
  const requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  // blocked fonts/CDN requests log "Failed to load resource"; that is expected
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (network === 'cdn') {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  } else {
    await page.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  }
  await page.goto(url);
  return { context, page, errors, requests };
}

export const waitState = (page, s, timeout = T) =>
  page.waitForFunction(x => window.hopLanes && window.hopLanes.state === x, s, { timeout });

// Waits `ms` of the page's own time (performance.now), plus one drawn frame after it, so a negative check
// ("nothing changed") is made after the page really ran, however slow SwiftShader is.
export async function settle(page, ms) {
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(([t, d]) => performance.now() - t >= d, [t0, ms], { timeout: T + ms });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
}

// Waits until `n` more play ticks ran (fixed steps of the game clock), or the game left play.
export async function waitTicks(page, n) {
  const t0 = await page.evaluate(() => window.hopLanes.playTick);
  await page.waitForFunction(([t, k]) => window.hopLanes.state !== 'play' || window.hopLanes.playTick >= t + k, [t0, n], { timeout: T });
}

// Presses a move key for player 1 and waits until that hop was taken up (recorded) and landed, or the game ended.
export async function hopKey(page, key) {
  const n = await page.evaluate(() => window.hopLanes.record.length);
  await page.keyboard.press(key);
  await page.waitForFunction(k => window.hopLanes.state !== 'play' || window.hopLanes.record.length > k, n, { timeout: T });
  await page.waitForFunction(() => window.hopLanes.state !== 'play' || !window.hopLanes.players[0].hop, null, { timeout: T });
}
