#!/usr/bin/env node
// Fails when a js/ module exports a name that no other file (js, server, tests, tools) mentions: the offline build
// concatenates the modules into one scope, so a stray export costs nothing at run time but hides what the API is.
// rules.js is the tested rule API and is exempt. Run: node tools/check-exports.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const list = d => fs.readdirSync(path.join(ROOT, d)).filter(f => /\.(m?js|json|sh)$/.test(f)).map(f => d + '/' + f);
const files = list('js'), others = ['server', 'tests', 'tools'].flatMap(list);
const src = Object.fromEntries([...files, ...others].map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const EXEMPT = new Set(['js/rules.js']);
let bad = 0;
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const m = /export \{([^}]*)\}/.exec(src[f]); if (!m) continue;
  for (const n of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
    if (n === '$') continue;
    const re = new RegExp('\\b' + n + '\\b');   // eslint-disable-line security/detect-non-literal-regexp -- n is an exported identifier (word characters and $)
    if (![...files, ...others].some(g => g !== f && re.test(src[g]))) { console.log(`${f}: export "${n}" is used by no other file`); bad++; }
  }
}
if (bad) { console.log(`${bad} unused export(s)`); process.exit(1); }
console.log('exports: every exported name is used somewhere');
