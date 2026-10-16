// Types for npm run typecheck only (tsconfig.json); nothing here ships.
declare const THREE: typeof import('three');
interface Window {
  THREE: typeof import('three');
  hopLanes?: unknown;   // #debug test hooks (app.js)
  webkitAudioContext?: typeof AudioContext;
}
interface Navigator { standalone?: boolean }   // iOS: started from the home screen
