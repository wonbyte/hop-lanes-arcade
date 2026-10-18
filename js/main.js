// Hop Lanes entry point: makes sure Three.js is there, then starts the game (js/app.js and the modules it imports).
import { fail } from './core.js';

// The page loads vendor/three.min.js with a plain script tag before this module. On a phone that load can fail (a
// mobile network that drops the ~140 KB download, or Safari keeping a broken copy in its cache): the live page then
// showed "The 3D library did not load" on an iPhone that ran the same build fine a moment before. So try once more,
// with a fresh URL (no cached copy), before giving up, and when that fails too, say why (the load failed, or the
// script ran and threw), so a report says what happened.
function loadThreeAgain() {
  /** @type {HTMLScriptElement | null} */
  const tag = document.querySelector('script[src*="three.min.js"]');
  if (!tag) return Promise.reject(new Error('no script tag'));   // the offline build inlines Three.js: nothing to fetch
  const url = new URL(tag.src, document.baseURI);
  url.searchParams.set('retry', String(Date.now()));
  return new Promise((resolve, reject) => {
    let thrown = '';
    // a script error inside three.min.js reaches window, not the script element: keep its text for the message
    const onError = e => { if (e.filename && e.filename.includes('three.min.js')) thrown = e.message; };
    window.addEventListener('error', onError);
    const s = document.createElement('script');
    s.src = url.href;
    s.onload = () => { window.removeEventListener('error', onError); window.THREE ? resolve() : reject(new Error(thrown || 'it ran but set nothing')); };
    s.onerror = () => { window.removeEventListener('error', onError); reject(new Error('the download failed')); };
    document.head.append(s);
  });
}

function start() {
  return import('./app.js').catch(e => {
    // gfx.js already showed its own message for a browser without WebGL
    if (e && e.message === 'no-webgl') return;
    // Any other error here means the game code never started: a module that did not load, did not link (a mix of old
    // and new files from two deploys did that once on iOS Safari) or threw while it ran. Without this the page kept
    // the static title with no game and no hint, so say so on screen, with the reason for a bug report.
    fail('The game did not start (' + (e && e.message ? e.message : String(e)) + '). Pull down to reload the page.');
    throw e;
  });
}

if (window.THREE) start();
else loadThreeAgain().then(start, e => fail('The 3D library did not load (' + e.message + '). Check the connection and pull down to reload the page.'));
