#!/usr/bin/env node
// The device bench (docs/budgets.md): the budgets measured on a real browser with the standard test load, the bench
// replay (tests/bench-replay.txt). Writes the raw evidence and a summary to --out (default bench/):
//   load.json            Slow 4G load: navigation to the first drawn title frame, bytes on the wire
//   trace.json           a raw Chrome trace of --trace-s seconds of play (open in DevTools > Performance or ui.perfetto.dev)
//   spector.json         a Spector.js capture of one play frame (every WebGL call), and spector-summary.json
//   heap-first.heapsnapshot, heap-last.heapsnapshot   after the first and the last run (DevTools > Memory > Load)
//   summary.json         every number the budgets need, per run
// Runs on the headless browser here (SwiftShader: a proxy, see docs/budgets.md) or on an Android phone over USB.
//
//   node tools/device-bench.mjs                          headless, CPU throttled 4x, one run
//   node tools/device-bench.mjs --soak 30                and play the run again and again for 30 minutes
//   node tools/device-bench.mjs --android --soak 30      Chrome on the phone (adb devices must list it; see docs/budgets.md)
//   node tools/device-bench.mjs --url https://wonbyte.github.io/hop-lanes-arcade/   the live site instead of this checkout
//   node tools/device-bench.mjs --check tools/bench-budgets.json   exit 1 when a proxy limit is missed (CI)
//   --cpu N (CPU throttle, headless only; 0 = none), --trace-s N (0 = no trace), --no-spector, --no-load, --no-heap-files,
//   --print-url (the bench link for any browser, iPhone included), --load-only (only the Slow 4G load), --http1 (serve this checkout over HTTP/1.1 instead of HTTP/2), --root DIR (serve another checkout of the game)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import http2 from 'node:http2';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { _android } from 'playwright';
import { ROOT, launch } from '../tests/browser.mjs';

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const ANDROID = flag('--android');
const CPU = Number(arg('--cpu', ANDROID ? 0 : 4));
const SOAK_MIN = Number(arg('--soak', 0));
const TRACE_S = Number(arg('--trace-s', 10));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'bench')));
const CHECK = arg('--check', '');
const SITE = path.resolve(arg('--root', ROOT));   // the checkout to serve (another one: a before/after comparison)
const CODE = fs.readFileSync(path.join(ROOT, 'tests/bench-replay.txt'), 'utf8').trim();
// Slow 4G as Lighthouse defines it: 150 ms RTT (x3.75 request latency), 1.6 Mbit/s x0.9 down, 750 kbit/s x0.9 up
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: 1474.56 * 1024 / 8, uploadThroughput: 675 * 1024 / 8 };
const MIN = 60_000;
if (flag('--print-url')) { console.log(arg('--url', 'https://wonbyte.github.io/hop-lanes-arcade/') + '#debug-bench-replay-' + CODE); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.error('[bench]', ...a);
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

// ---- the site: this checkout served with gzip over HTTP/2 (like GitHub Pages: every request at once), or --url ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
// HTTP/2 needs TLS in a browser: a throwaway self-signed certificate (the headless browser ignores that it is not trusted).
// The phone cannot ignore it, so --android serves HTTP/1.1 (6 requests at once: slower than the live site).
function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-bench-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const pair = { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return pair;
}
// one open file, checked and read through the same handle (a check by name, then a read by name, could see two files)
function readFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('not a file');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function serveGzip(root, h2) {
  const handler = (req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (rel === '/') rel = '/index.html';
    const file = path.join(root, rel), out = path.relative(root, file);
    if (out.startsWith('..') || path.isAbsolute(out)) { res.writeHead(404); res.end(); return; }
    let body;
    try { body = readFile(file); } catch { res.writeHead(404); res.end(); return; }   // missing, or a folder
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (/text|json|manifest/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
    res.writeHead(200, headers); res.end(body);
  };
  const server = h2 ? http2.createSecureServer({ ...selfSigned(), allowHTTP1: true }, handler) : http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, scheme: h2 ? 'https' : 'http', close: () => new Promise(r => server.close(r)) })));
}

// ---- the browser: headless here, or Chrome on the phone ----
let browser = null, device = null, site = null, BASE = arg('--url', '');
async function newContext(opts = {}) {
  if (ANDROID) return device.launchBrowser({ ...opts });
  return browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, ...opts });
}
async function newPage(context, { cpu = CPU, net = null } = {}) {
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (net) await cdp.send('Network.emulateNetworkConditions', net);
  await context.addInitScript(() => { try { localStorage.setItem('hoplanes.howto', '1'); } catch (e) { /* private mode */ } });
  return { page, cdp };
}
const waitFor = (page, fn, arg0, timeout = 10 * MIN) => page.waitForFunction(fn, arg0, { timeout, polling: 250 });

// ---- 1. load on Slow 4G ----
async function measureLoad() {
  const context = await newContext();
  const { page, cdp } = await newPage(context, { net: SLOW_4G });
  let bytes = 0, requests = 0;
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; requests++; });
  await page.goto(BASE + 'index.html#debug', { waitUntil: 'commit', timeout: 2 * MIN });
  await waitFor(page, () => window.hopLanes && window.hopLanes.state === 'attract', null, 2 * MIN);
  const ms = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(performance.now()))));
  // the waterfall: every request's start and end (ms after navigation) and bytes, and when the HTML was parsed
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return { proto: nav.nextHopProtocol || '', domInteractive: Math.round(nav.domInteractive || 0), domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      waterfall: performance.getEntriesByType('resource').map(e => ({ url: e.name.replace(location.origin, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd), bytes: e.encodedBodySize }))
        .sort((a, b) => a.end - b.end) };
  });
  const res = { playableMs: Math.round(ms), bytes, requests, protocol: t.proto, domInteractive: t.domInteractive, domContentLoaded: t.domContentLoaded,
    lastByte: Math.max(0, ...t.waterfall.map(w => w.end)), network: 'Slow 4G (Lighthouse)', cpuThrottle: CPU, waterfall: t.waterfall };
  await context.close();
  return res;
}

// ---- 2. Spector.js: every WebGL call of one play frame (its own page: the spy slows every call) ----
async function captureSpector() {
  const context = await newContext({ bypassCSP: true });
  // the bundle needs document.head, so it runs when parsing ends: after that and before the game's modules (they run
  // before DOMContentLoaded), so the spy is on the canvas before the game asks for its WebGL context
  const bundle = fs.readFileSync(path.join(ROOT, 'node_modules/spectorjs/dist/spector.bundle.js'), 'utf8');
  await context.addInitScript(src => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      try {
        const el = document.createElement('script');
        el.textContent = src;
        document.head.appendChild(el);
        window.__spector = new window.SPECTOR.Spector();
        window.__spector.spyCanvases();
      } catch (e) { window.__spectorError = String((e && e.stack) || e); }
    });
  }, bundle);
  const { page } = await newPage(context, { cpu: 0 });
  await page.goto(BASE + 'index.html#debug-bench-replay-' + CODE);
  await waitFor(page, () => window.hopLanes && window.hopLanes.state === 'play' && window.hopLanes.playTick > 120 * 20);
  const err = await page.evaluate(() => window.__spectorError || (window.SPECTOR ? '' : 'SPECTOR not loaded'));
  if (err) throw new Error('Spector.js did not start: ' + err);
  const text = await page.evaluate(() => new Promise(res => {
    const s = window.__spector;
    s.onCapture.add(c => res(JSON.stringify(c)));
    s.captureCanvas(document.querySelector('canvas'), 0, false, false);
  }));
  await context.close();
  write('spector.json', text);
  const cap = JSON.parse(text), byName = {};
  for (const c of cap.commands || []) byName[c.name] = (byName[c.name] || 0) + 1;
  const draws = Object.entries(byName).filter(([n]) => /^draw/.test(n)).reduce((a, [, k]) => a + k, 0);
  const summary = { commands: (cap.commands || []).length, draws, useProgram: byName.useProgram || 0, bindTexture: byName.bindTexture || 0,
    uniformCalls: Object.entries(byName).filter(([n]) => /^uniform/.test(n)).reduce((a, [, k]) => a + k, 0), byName };
  write('spector-summary.json', summary);
  return summary;
}

// ---- 3. the bench run, a trace of it, then the soak ----
// The JS heap after a forced garbage collection, from a heap snapshot: all of it, and split into the compiled code
// (V8's bytecode and optimized machine code: it grows while the engine optimizes more functions, which is not a leak)
// and everything else (the game's objects: a leak shows here). The snapshot is written to `file` when one is named.
async function heapSample(page, cdp, file) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const gpu = await page.evaluate(() => { const i = window.hopLanes.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: (i.programs || []).length }; });
  const chunks = [];
  const onChunk = e => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const text = chunks.join('');
  if (file && !flag('--no-heap-files')) fs.writeFileSync(path.join(OUT, file), text);
  return { heapBytes: usedSize, ...splitHeap(JSON.parse(text)), ...gpu };
}
function splitHeap(snap) {
  const m = snap.snapshot.meta, F = m.node_fields.length, types = m.node_types[0];
  const ti = m.node_fields.indexOf('type'), si = m.node_fields.indexOf('self_size');
  let code = 0, other = 0;
  for (let i = 0; i < snap.nodes.length; i += F) { if (types[snap.nodes[i + ti]] === 'code') code += snap.nodes[i + si]; else other += snap.nodes[i + si]; }
  return { codeBytes: code, objectBytes: other };
}
// the heap after a forced garbage collection, without a snapshot (cheap: after every run of the soak)
async function heapUsed(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}
async function trace(cdp, seconds) {
  const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: [
    'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8.execute', 'blink.user_timing', 'gpu', 'viz', 'loading'] } });
  await new Promise(r => setTimeout(r, seconds * 1000));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  const fd = fs.openSync(path.join(OUT, 'trace.json'), 'w');
  for (;;) { const { data, eof, base64Encoded } = await cdp.send('IO.read', { handle: stream }); fs.writeSync(fd, base64Encoded ? Buffer.from(data, 'base64') : data); if (eof) break; }
  fs.closeSync(fd);
  await cdp.send('IO.close', { handle: stream });
}
async function bench() {
  const context = await newContext();
  const { page, cdp } = await newPage(context);
  await page.goto(BASE + 'index.html#debug-bench-replay-' + CODE);
  await waitFor(page, () => window.hopLanes && window.hopLanes.state === 'play', null, 2 * MIN);
  const info = await page.evaluate(() => ({ ua: navigator.userAgent, ratio: window.hopLanes.pixelRatio, size: [window.innerWidth, window.innerHeight], gpu: (() => {
    const gl = window.hopLanes.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() }));
  log('playing on', info.gpu);
  if (TRACE_S > 0) { await new Promise(r => setTimeout(r, 15_000)); await trace(cdp, TRACE_S); log('trace written'); }
  const runs = [];
  const nextRun = async () => {
    const n = runs.length;
    await waitFor(page, k => window.hopLanes.benchRuns.length > k, n, 20 * MIN);
    const run = (await page.evaluate(() => window.hopLanes.benchRuns)).at(-1);
    if (runs.length) run.heapBytes = await heapUsed(cdp);   // the first run's comes with the full sample below
    runs.push(run);
    log(`run ${runs.length}: p50 ${run.p50} p95 ${run.p95} worst ${run.worst} ms, ${run.frames} frames`);
    return run;
  };
  await nextRun();
  const first = await heapSample(page, cdp, SOAK_MIN ? 'heap-first.heapsnapshot' : '');
  runs[0].heapBytes = first.heapBytes;
  const frames1 = await page.evaluate(() => window.hopLanes.frames);
  let last = first;
  const t0 = Date.now();
  if (SOAK_MIN) {
    while (Date.now() - t0 < SOAK_MIN * MIN - 30_000) await nextRun();
    last = await heapSample(page, cdp, 'heap-last.heapsnapshot');
  }
  const ladder = await page.evaluate(() => ({ ratio: window.hopLanes.ladder.ratio, shadow: window.hopLanes.ladder.shadow, shadowHalf: window.hopLanes.ladder.shadowHalf }));
  await context.close();
  write('frames-run1.json', frames1);
  const pct = (a, b) => +((b - a) / a * 100).toFixed(1);
  return { info, ladder, runs, soakMinutes: SOAK_MIN, first, last,
    drift: { heapPct: pct(first.heapBytes, last.heapBytes), objectPct: pct(first.objectBytes, last.objectBytes), codePct: pct(first.codeBytes, last.codeBytes), geometriesPct: pct(first.geometries, last.geometries), texturesPct: pct(first.textures || 1, last.textures || 1),
      programs: last.programs - first.programs, p95Pct: pct(runs[0].p95, runs.at(-1).p95) } };
}

// ---- the budgets ----
function check(summary, limits) {
  const fails = [];
  const want = (ok, what) => { if (!ok) fails.push(what); };
  const run1 = summary.bench ? summary.bench.runs[0] : null;
  if (limits.p95Ms !== undefined && run1) want(run1.p95 <= limits.p95Ms, `p95 ${run1.p95} ms > ${limits.p95Ms}`);
  if (limits.worstMs !== undefined && run1) want(run1.worst <= limits.worstMs, `worst frame ${run1.worst} ms > ${limits.worstMs}`);
  if (limits.loadMs !== undefined && summary.load) want(summary.load.playableMs <= limits.loadMs, `Slow 4G load ${summary.load.playableMs} ms > ${limits.loadMs}`);
  if (limits.loadBytes !== undefined && summary.load) want(summary.load.bytes <= limits.loadBytes, `load ${summary.load.bytes} bytes > ${limits.loadBytes}`);
  if (limits.draws !== undefined && summary.spector) want(summary.spector.draws <= limits.draws, `${summary.spector.draws} draw calls > ${limits.draws}`);
  if (limits.useProgram !== undefined && summary.spector) want(summary.spector.useProgram <= limits.useProgram, `${summary.spector.useProgram} program switches > ${limits.useProgram}`);
  const d = summary.bench ? summary.bench.drift : null;
  if (d && summary.bench.runs.length > 1) {
    if (limits.heapGrowthPct !== undefined) want(d.heapPct <= limits.heapGrowthPct, `heap grew ${d.heapPct}% > ${limits.heapGrowthPct}%`);
    if (limits.objectGrowthPct !== undefined) want(d.objectPct <= limits.objectGrowthPct, `the game's objects grew ${d.objectPct}% > ${limits.objectGrowthPct}% (compiled code excluded)`);
    if (limits.gpuDriftPct !== undefined) want(Math.abs(d.geometriesPct) <= limits.gpuDriftPct && Math.abs(d.texturesPct) <= limits.gpuDriftPct, `GPU objects drifted ${d.geometriesPct}% / ${d.texturesPct}%`);
    want(d.programs === 0, `${d.programs} more shader programs`);
    if (limits.p95DriftPct !== undefined) want(d.p95Pct <= limits.p95DriftPct, `p95 drifted ${d.p95Pct}% > ${limits.p95DriftPct}%`);
  }
  return fails;
}

try {
  if (ANDROID) {
    [device] = await _android.devices();
    if (!device) throw new Error('no Android device: connect the phone over USB, turn on USB debugging, check `adb devices`');
    await device.shell('am force-stop com.android.chrome');
  } else browser = await launch();
  if (!BASE) {
    site = await serveGzip(SITE, !ANDROID && !flag('--http1'));
    if (ANDROID) execFileSync('adb', ['reverse', `tcp:${site.port}`, `tcp:${site.port}`]);   // the phone's localhost is this machine
    BASE = `${site.scheme}://127.0.0.1:${site.port}/`;
  }
  if (!BASE.endsWith('/')) BASE += '/';
  const summary = { when: new Date().toISOString(), device: ANDROID ? device.model() : 'headless', base: BASE, cpuThrottle: CPU, replay: { chars: CODE.length } };
  if (!flag('--no-load')) { summary.load = await measureLoad(); log('load', summary.load); write('load.json', summary.load); }
  if (!flag('--no-spector')) { summary.spector = await captureSpector(); log('spector', { draws: summary.spector.draws, useProgram: summary.spector.useProgram, commands: summary.spector.commands }); }
  if (!flag('--load-only')) summary.bench = await bench();
  write('summary.json', summary);
  console.log(JSON.stringify(summary, null, 1));
  if (CHECK) {
    const fails = check(summary, JSON.parse(fs.readFileSync(CHECK, 'utf8')));
    for (const f of fails) console.error('BUDGET MISSED: ' + f);
    if (fails.length) process.exitCode = 1;
    else console.error('[bench] every limit in ' + CHECK + ' is met');
  }
} finally {
  if (browser) await browser.close();
  if (device) await device.close();
  if (site) await site.close();
}
