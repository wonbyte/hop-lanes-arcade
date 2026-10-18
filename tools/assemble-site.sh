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

# Version every script and style URL with a hash of their content (?v=<hash>). Pages lets a browser keep each file for
# 10 minutes, and iOS Safari kept old modules next to new ones after two deploys close together: a new module then
# imported a name an old one did not export, the module graph did not link, and the game never started. With the
# hash in every URL a deploy is a new set of URLs, so the browser never mixes two. The same URL must be used for a
# module everywhere (the page's modulepreload and script tags and every import), or the browser loads it twice as
# two separate modules: so every relative import in _site/js and every js/, css/ and vendor/ URL in index.html
# gets the same tag.
ver=$(cat js/*.js css/*.css vendor/*.js | sha256sum | cut -c1-12)
perl -pi -e 's{(["\x27])(\./[\w-]+\.js)\1}{$1$2?v='"$ver"'$1}g' _site/js/*.js
perl -pi -e 's{((?:href|src)=")((?:js|css|vendor)/[\w./-]+\.(?:js|css))"}{$1$2?v='"$ver"'"}g' _site/index.html
# check: no relative import and no page URL of a script or style is left without the tag
if grep -qE "[\"']\./[A-Za-z0-9_-]+\.js[\"']" _site/js/*.js \
  || grep -qE '(href|src)="(js|css|vendor)/[^"?]+"' _site/index.html; then
  echo 'a script or style URL has no version tag' >&2; exit 1
fi
echo "_site: js $(cat js/*.js | gzip -9 | wc -c) -> $(cat _site/js/*.js | gzip -9 | wc -c) bytes gzipped"
