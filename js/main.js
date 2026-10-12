// Hop Lanes entry point: checks for Three.js, then starts the game (js/app.js and the modules it imports).
import { fail } from './core.js';
if (!window.THREE) fail('The 3D library did not load. Connect to the internet, or open hop-lanes-standalone.html.');
else import('./app.js').catch(e => { if (!e || e.message !== 'no-webgl') throw e; });
