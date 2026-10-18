// Helpers shared by the fuzzers and the load test (tools/fuzz-replay.mjs, tools/fuzz-server.mjs, tools/load-server.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import fs from 'node:fs';
import { TRAITS, dayBefore, isoDay, mulberry32 } from '../js/rules.js';

export const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/scores.mjs');

// `--name value` from the command line, or def
export function flagArg(name, def) { const args = process.argv.slice(2), i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

// the game's seeded PRNG (rules.js mulberry32): the same seed gives the same cases, so a failure can be run again
export function seededRng(seed) {
  const rnd = mulberry32(seed >>> 0);
  return {
    rnd,
    int: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),   // inclusive
    pick: arr => arr[Math.floor(rnd() * arr.length)],
    chance: p => rnd() < p
  };
}

export const ANIMALS = [...new Set(['frog', ...Object.keys(TRAITS)])];
export const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]];
// the game's local day (rules.js isoDay): what the page posts (the server takes the UTC day plus or minus one)
export const today = () => isoDay();
export const dayAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
export { dayBefore };
// a free TCP port for a server under test
export const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port; s.close(() => r(p)); }); });
// the resident memory of a process in MB (Linux: /proc), or null
export function rssMB(pid) {
  try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? +(m[1] / 1024).toFixed(1) : null; } catch { return null; }
}
