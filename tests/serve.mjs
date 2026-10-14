// A small static file server for the tests: browsers refuse ES module imports from file:// pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

// serves `root` on 127.0.0.1 at a free port; returns { url, close }
// `overrides` maps a path ('/index.html') to a body served instead of the file (a test page with a server wired in)
export function serve(root, overrides = {}) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (rel === '/') rel = '/index.html';
    if (Object.hasOwn(overrides, rel)) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'text/plain' }); res.end(overrides[rel]); return; }
    const file = path.join(root, rel === '/' ? 'index.html' : rel);
    const out = path.relative(root, file);
    if (out.startsWith('..') || path.isAbsolute(out)) { res.writeHead(403); res.end(); return; }
    if ( !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) });
  }));
}
