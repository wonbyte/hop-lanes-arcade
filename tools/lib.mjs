// Helpers shared by the fuzzers and the load test (tools/fuzz-replay.mjs, tools/fuzz-server.mjs, tools/load-server.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAITS, mulberry32 } from '../js/rules.js';

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
export const today = () => new Date().toISOString().slice(0, 10);
export const dayAgo = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
