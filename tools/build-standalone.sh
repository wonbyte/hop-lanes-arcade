#!/usr/bin/env bash
# Builds hop-lanes-standalone.html: index.html with Three.js and the fonts inlined,
# so it plays with no internet (file viewers, offline phones).
set -euo pipefail
for tool in npm python3 tar; do
  command -v "$tool" >/dev/null || { echo "build-standalone: needs $tool (and network access to the npm registry)" >&2; exit 1; }
done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm pack --silent three@0.128.0 @fontsource/press-start-2p@5.0.20 @fontsource/rubik@5.0.20 >/dev/null
for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
python3 - "$ROOT" "$WORK" <<'PY'
import base64, hashlib, pathlib, re, sys
# must match the integrity= hash on the CDN script tag in index.html
THREE_SHA512 = 'dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ=='
root, work = map(pathlib.Path, sys.argv[1:])
html = (root / 'index.html').read_text(encoding='utf-8')
three_bytes = (work / 'three-0.128.0/package/build/three.min.js').read_bytes()
assert base64.b64encode(hashlib.sha512(three_bytes).digest()).decode() == THREE_SHA512, 'three.min.js hash mismatch'
three = three_bytes.decode('utf-8')
# anything that could end or confuse the inline <script> block
assert not re.search(r'</script|<!--|<script', three, re.I)

def face(family, weight, pkg, file):
    data = base64.b64encode((work / pkg / 'package/files' / file).read_bytes()).decode()
    return (f'@font-face {{ font-family: "{family}"; font-weight: {weight}; font-display: swap; '
            f'src: url(data:font/woff2;base64,{data}) format("woff2"); }}')

# Latin subset only: the game shows English text and digits
fonts = '\n'.join([
    face('Press Start 2P', 400, 'fontsource-press-start-2p-5.0.20', 'press-start-2p-latin-400-normal.woff2'),
    face('Rubik', 500, 'fontsource-rubik-5.0.20', 'rubik-latin-500-normal.woff2'),
    face('Rubik', 800, 'fontsource-rubik-5.0.20', 'rubik-latin-800-normal.woff2'),
])
link = re.compile(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^"]*">\n')
cdn = re.compile(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"[^>]*></script>')
assert link.search(html) and cdn.search(html)
html = re.sub(r'<link rel="preconnect"[^>]*>\n', '', html)
html = link.sub(lambda m: '<style>\n/* Press Start 2P and Rubik: SIL Open Font License 1.1 */\n' + fonts + '\n</style>\n', html, count=1)
html = cdn.sub(lambda m: '<script>\n' + three + '\n</script>', html, count=1)
out = root / 'hop-lanes-standalone.html'
out.write_text(html, encoding='utf-8')
print(f'{out} {out.stat().st_size // 1024} KB')
PY
