// Hop Lanes entry point: checks for Three.js, then starts the game (js/app.js and the modules it imports).
import { fail } from './core.js';
if (!window.THREE) fail('The 3D library did not load. Connect to the internet, or open hop-lanes-standalone.html.');
else import('./app.js').catch(e => {
  // gfx.js already showed its own message for a browser without WebGL
  if (e && e.message === 'no-webgl') return;
  // Any other error here means the game code never started: a module that did not load, did not link (a mix of old
  // and new files from two deploys did that once on iOS Safari) or threw while it ran. Without this the page kept
  // the static title with no game and no hint, so say so on screen, with the reason for a bug report.
  fail('The game did not start (' + (e && e.message ? e.message : String(e)) + '). Pull down to reload the page.');
  throw e;
});
