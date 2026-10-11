#!/usr/bin/env bash
# Builds hop-lanes-standalone.html: index.html with Three.js and the fonts inlined,
# so it plays with no internet (file viewers, offline phones).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm pack --silent three@0.128.0 @fontsource/press-start-2p@5.0.20 @fontsource/rubik@5.0.20 >/dev/null
for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
python3 - "$ROOT" "$WORK" <<'PY'
import base64, pathlib, re, sys
root, work = map(pathlib.Path, sys.argv[1:])
html = (root / 'index.html').read_text()
three = (work / 'three-0.128.0/package/build/three.min.js').read_text()
assert '</script' not in three

def face(family, weight, pkg, file):
    data = base64.b64encode((work / pkg / 'package/files' / file).read_bytes()).decode()
    return (f'@font-face {{ font-family: "{family}"; font-weight: {weight}; font-display: swap; '
            f'src: url(data:font/woff2;base64,{data}) format("woff2"); }}')

fonts = '\n'.join([
    face('Press Start 2P', 400, 'fontsource-press-start-2p-5.0.20', 'press-start-2p-latin-400-normal.woff2'),
    face('Rubik', 500, 'fontsource-rubik-5.0.20', 'rubik-latin-500-normal.woff2'),
    face('Rubik', 800, 'fontsource-rubik-5.0.20', 'rubik-latin-800-normal.woff2'),
])
link = re.compile(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^"]*">\n')
cdn = re.compile(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"></script>')
assert link.search(html) and cdn.search(html)
html = link.sub(lambda m: '<style>\n/* Press Start 2P and Rubik: SIL Open Font License 1.1 */\n' + fonts + '\n</style>\n', html, count=1)
html = cdn.sub(lambda m: '<script>\n' + three + '\n</script>', html, count=1)
out = root / 'hop-lanes-standalone.html'
out.write_text(html)
print(f'{out} {out.stat().st_size // 1024} KB')
PY
