#!/usr/bin/env node
// The live site's HTTP headers, graded by the MDN HTTP Observatory (its scan of the game's page, host and path). CI runs it
// after each deploy (deploy.yml, Node 24: the Observatory's own requirement).
// A failed test passes the check only when docs/threat-model.md accepts it (ACCEPTED below names the section).
//   npm ci --prefix tools/observatory   (its own lockfile; OBSERVATORY_DIR points elsewhere)
//   node tools/check-live-site.mjs [--site https://host/path/] [--host wonbyte.github.io] [--path /hop-lanes-arcade/] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { flagArg } from './lib.mjs';

const SITE = flagArg('--site', '') ? new URL(flagArg('--site', '')) : null;   // deploy.yml: the page GitHub Pages deployed (a fork audits its own site)
const HOST = flagArg('--host', SITE ? SITE.host : 'wonbyte.github.io'), PAGE = flagArg('--path', SITE ? SITE.pathname : '/hop-lanes-arcade/'), OUT = flagArg('--out', '');
const DIR = process.env.OBSERVATORY_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), 'observatory/node_modules/@mdn/mdn-http-observatory');
// failed tests that docs/threat-model.md accepts (GitHub Pages lets a site set no header)
const ACCEPTED = {
  'strict-transport-security': 'section 6: Pages sends no HSTS and github.io is not preloaded; the http -> https redirect is the control',
  'x-content-type-options': 'section 6: Pages sends no nosniff; every file is the game\'s own with its right type, nothing is uploaded',
  'x-frame-options': 'section 6: a meta CSP cannot set frame-ancestors and Pages sends no X-Frame-Options; a framed game can only be played'
};

const load = rel => import(pathToFileURL(path.join(DIR, rel)).href);
const { scan } = await load('src/scanner/index.js');
const { Site } = await load('src/site.js');

const res = await scan(Site.fromSiteString(HOST + PAGE), {});
let bad = 0;
const rows = Object.entries(res.tests).map(([name, t]) => {
  const ok = t.pass || Object.hasOwn(ACCEPTED, name);
  if (!ok) bad++;
  return { test: name, pass: t.pass, result: t.result, modifier: t.scoreModifier, accepted: !t.pass && ok ? ACCEPTED[name] : undefined };
});
const out = { url: `https://${HOST}${PAGE}`, status: res.scan.statusCode, grade: res.scan.grade, score: res.scan.score, tests: rows, headers: res.scan.responseHeaders };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const row of rows) console.log(`${row.pass ? 'PASS' : row.accepted ? 'ACCEPTED' : 'FAIL'}  ${row.test}: ${row.result}${row.accepted ? ' (' + row.accepted + ')' : ''}`);
console.log(`grade ${out.grade} (${out.score}) for ${out.url}, status ${out.status}`);
if (bad) { console.error(`check-live-site: ${bad} failed test(s) that docs/threat-model.md does not accept`); process.exit(1); }
