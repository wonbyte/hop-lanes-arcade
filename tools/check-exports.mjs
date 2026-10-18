#!/usr/bin/env node
// Fails when a js/ module exports a name that no other file imports: the offline build concatenates the modules into one
// scope, so a stray export costs nothing at run time but hides what the API is. A use is an import of that name from
// that module (`import { name } from '.../module.js'`) in any other file (js, server, tests, tools); a word that merely
// appears in a comment or another module's code does not count. rules.js is the tested rule API and is exempt.
// Run: node tools/check-exports.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const list = d => fs.readdirSync(path.join(ROOT, d)).filter(f => /\.m?js$/.test(f)).map(f => d + '/' + f);
const files = list('js'), others = ['server', 'tests', 'tools'].flatMap(list);
const src = Object.fromEntries([...files, ...others].map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const EXEMPT = new Set(['js/rules.js']);
// imported[module basename] = the names every other file imports from it
const imported = new Map();
for (const [f, text] of Object.entries(src)) {
  for (const m of text.matchAll(/import \{([^}]*)\} from '([^']+)'/g)) {
    const mod = path.basename(m[2]);
    if (!imported.has(mod)) imported.set(mod, new Set());
    for (const n of m[1].split(',')) { const name = n.trim().split(/\s+as\s+/)[0]; if (name) imported.get(mod).add(name + '@' + f); }
  }
}
let bad = 0;
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const m = /export \{([^}]*)\}/.exec(src[f]); if (!m) continue;
  const uses = imported.get(path.basename(f)) || new Set();
  for (const n of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
    if (![...uses].some(u => u.startsWith(n + '@') && !u.endsWith('@' + f))) { console.log(`${f}: export "${n}" is imported by no other file`); bad++; }
  }
}
if (bad) { console.log(`${bad} unused export(s)`); process.exit(1); }
console.log('exports: every exported name is imported somewhere');
