#!/usr/bin/env bash
# Builds hop-lanes-standalone.html: index.html with css/style.css, js/game.js, the fonts in fonts/
# and Three.js inlined, so it plays with no internet (file viewers, offline phones).
set -euo pipefail
for tool in npm python3 tar; do
  command -v "$tool" >/dev/null || { echo "build-standalone: needs $tool (and network access to the npm registry)" >&2; exit 1; }
done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm pack --silent three@0.128.0 >/dev/null
mkdir three && tar xzf three-0.128.0.tgz -C three
# -I: isolated mode, so no PYTHON* variable (such as PYTHONOPTIMIZE) can change or skip the checks
python3 -I - "$ROOT" "$WORK" <<'PY'
import base64, hashlib, pathlib, re, sys

# must match the integrity= hash on the CDN script tag in index.html
THREE_SHA512 = 'dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ=='

def need(ok, msg):
    if not ok:
        sys.exit('build-standalone: ' + msg)

def b64(data):
    return base64.b64encode(data).decode()

root, work = map(pathlib.Path, sys.argv[1:])
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
game = (root / 'js/game.js').read_text(encoding='utf-8')
three_bytes = (work / 'three/package/build/three.min.js').read_bytes()
need(b64(hashlib.sha512(three_bytes).digest()) == THREE_SHA512, 'three.min.js hash mismatch')
three = three_bytes.decode('utf-8')

# nothing may end or confuse an inline <script>/<style> block early
for name, code in (('three.min.js', three), ('js/game.js', game)):
    need(not re.search(r'</script|<!--|<script', code, re.I), f'{name} contains script-breaking markup')
need(not re.search(r'</style', css, re.I), 'css/style.css contains </style')

# fonts: url("../fonts/x.woff2") -> data URI (the files are in the repo, so git tracks their integrity)
def font_uri(m):
    path = root / 'fonts' / m.group(1)
    need(path.is_file(), f'missing font {path}')
    return f'url(data:font/woff2;base64,{b64(path.read_bytes())})'
css, n = re.subn(r'url\("\.\./fonts/([\w.-]+\.woff2)"\)', font_uri, css)
need(n == 3, f'expected 3 font files in css/style.css, found {n}')

def swap(pattern, repl, text, label):
    out, n = re.subn(pattern, lambda m: repl, text, count=1)
    need(n == 1, f'could not find {label} in index.html')
    return out

blocks = {'script': [three, game], 'style': [css]}
html = swap(r'<link rel="stylesheet" href="css/style\.css">', '<style>\n' + css + '</style>', html, 'the css link')
html = swap(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"[^>]*></script>',
            '<script>\n' + three + '</script>', html, 'the Three.js tag')
html = swap(r'<script src="js/game\.js"></script>', '<script>\n' + game + '</script>', html, 'the game script tag')
html = re.sub(r'<link rel="(?:preconnect|preload)"[^>]*>\n', '', html)

# allow exactly these inline blocks and nothing else (hash of the text between the tags)
def csp_hash(body):
    # the browser hashes the exact text between the tags, which starts with the newline written above
    return "'sha256-" + b64(hashlib.sha256(('\n' + body).encode('utf-8')).digest()) + "'"
def hashes(kind):
    return ' '.join(csp_hash(body) for body in blocks[kind])
policy = (f"default-src 'none'; script-src {hashes('script')}; style-src {hashes('style')}; font-src data:; "
          "img-src data:; connect-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'")
html = swap(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">',
            f'<meta http-equiv="Content-Security-Policy" content="{policy}">', html, 'the CSP meta tag')

out = root / 'hop-lanes-standalone.html'
out.write_text(html, encoding='utf-8')
print(f'{out} {out.stat().st_size // 1024} KB')
PY
