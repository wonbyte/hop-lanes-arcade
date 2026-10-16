#!/usr/bin/env node
// The page's Content-Security-Policy (the meta tag in index.html and in the offline file), checked by Google's CSP
// Evaluator and against the directives docs/threat-model.md relies on. Fails on any finding it does not accept.
// Run: node tools/check-csp.mjs (npm run lint runs it)
import fs from 'node:fs';
import path from 'node:path';
import { CspParser } from 'csp_evaluator/dist/parser.js';
import { CspEvaluator } from 'csp_evaluator/dist/evaluator.js';
import { Severity } from 'csp_evaluator/dist/finding.js';
import { ROOT } from '../tests/browser.mjs';

const SEVERITY = Object.fromEntries(Object.entries(Severity).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
// findings docs/threat-model.md accepts: "'self' can be problematic if you host JSONP, AngularJS or user uploaded files"
// (section 6: the site is static game files only, nothing uploaded, no JSONP, no AngularJS)
const ACCEPTED = [{ directive: 'script-src', severity: 'MEDIUM_MAYBE', value: "'self'" }];
// what the threat model relies on, in both files
const REQUIRED = { 'default-src': ["'none'"], 'base-uri': ["'none'"], 'form-action': ["'none'"], 'connect-src': ["'none'"], 'worker-src': ["'none'"] };
const FORBIDDEN = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', '*', 'http:', 'https:'];

let bad = 0;
for (const file of ['index.html', 'hop-lanes-standalone.html']) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]*)"/i.exec(html);
  if (!m) { console.error(`${file}: no CSP meta tag`); bad++; continue; }
  const csp = new CspParser(m[1]).csp;
  for (const f of new CspEvaluator(csp).evaluate()) {
    const sev = SEVERITY[f.severity] ?? String(f.severity);
    const ok = ACCEPTED.some(a => a.directive === f.directive && a.severity === sev && (a.value === undefined || a.value === f.value));
    console.log(`${ok ? 'ACCEPTED' : 'FAIL'}  ${file} ${f.directive} [${sev}] ${f.description}`);
    if (!ok) bad++;
  }
  for (const [dir, want] of Object.entries(REQUIRED)) {
    const got = csp.directives[dir];
    if (!got || want.some(w => !got.includes(w)) || got.length !== want.length) { console.log(`FAIL  ${file} ${dir} must be ${want.join(' ')} (is ${got ? got.join(' ') : 'missing'})`); bad++; }
  }
  for (const [dir, vals] of Object.entries(csp.directives)) {
    for (const v of vals) if (FORBIDDEN.includes(v) && !(dir === 'img-src' && v === 'data:') && !(dir === 'font-src' && v === 'data:')) { console.log(`FAIL  ${file} ${dir} allows ${v}`); bad++; }
  }
}
if (bad) { console.error(`check-csp: ${bad} problem(s)`); process.exit(1); }
console.log('check-csp: both policies pass');
