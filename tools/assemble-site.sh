#!/usr/bin/env bash
# Assembles the site GitHub Pages serves into _site/ (deploy.yml): only what the page needs (an include list, so a
# stray new file is never published), with each module in js/ minified by the pinned esbuild (one file each, imports
# kept: the page loads the same modules, about 37 KB less over gzip). Run it locally to check the result:
#   ./tools/assemble-site.sh && node -e "import('./tests/serve.mjs').then(m => m.serve('_site')).then(s => console.log(s.url))"
set -euo pipefail
cd "$(dirname "$0")/.."
esbuild=node_modules/.bin/esbuild
[ -x "$esbuild" ] || { echo 'esbuild is missing: run `npm ci` first' >&2; exit 1; }
rm -rf _site
mkdir _site
cp -r index.html manifest.webmanifest hop-lanes-standalone.html css vendor fonts icons _site/
"$esbuild" js/*.js --minify --target=es2020 --charset=utf8 --log-level=warning --outdir=_site/js
# every module is there, and nothing else
[ "$(ls js/*.js | wc -l)" -eq "$(ls _site/js/*.js | wc -l)" ] || { echo 'a module is missing from _site/js' >&2; exit 1; }
echo "_site: js $(cat js/*.js | gzip -9 | wc -c) -> $(cat _site/js/*.js | gzip -9 | wc -c) bytes gzipped"
