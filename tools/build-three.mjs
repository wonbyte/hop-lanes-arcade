// Builds a tree-shaken, self-hosted Three.js: vendor/three.min.js (window.THREE with only the names the game uses).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(ROOT, 'vendor/three.min.js');

await build({
  entryPoints: [path.join(ROOT, 'tools/three-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'inline',
  mainFields: ['module', 'main'],
  outfile
});
console.log(`vendor/three.min.js: ${(fs.statSync(outfile).size / 1024).toFixed(1)} KB`);
