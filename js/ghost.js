import { COUNTDOWN, G, STEP } from './core.js';
import { scene } from './gfx.js';
import { CHARACTERS, makeCharacter } from './models.js';
import { decodeReplay } from './replay.js';
import { createSim } from './sim.js';
import { loadText, save } from './storage.js';
import { cachedGeo, voxelMat } from './voxel.js';
import { getSeed } from './world.js';

// The ghost: a see-through animal that repeats your best run on this world (daily and room modes, where the
// world is the same every time). It is driven by the pure simulator (sim.js) on the saved replay code, one
// step per game step, so it hops exactly as the run did. Its traffic is its own run's, so it may pass through
// today's cars: it shows the path, not a collision.
const GHOST_KEY = 'hoplanes.ghost.';   // + world seed: score|hero|time|replay code
const GHOST_KEEP = 6;                  // worlds remembered (the newest)
const ghostMat = voxelMat.clone();
ghostMat.onBeforeCompile = voxelMat.onBeforeCompile;   // clone() does not copy the shader hook
ghostMat.transparent = true; ghostMat.opacity = 0.42; ghostMat.depthWrite = false;
const ghostWarmGeo = () => cachedGeo('ghostwarm', () => [[0.5, 0.5, 0.5, 0xffffff, 0, 0, 0]]);

const ghostModes = () => G.mode === 'daily' || G.mode === 'room';
const parseGhost = text => {
  const m = /^(\d+)\|([01])\|(\d+)\|([A-Za-z0-9_-]+)$/.exec(text || '');
  return m ? { score: Number(m[1]), hero: Number(m[2]), time: Number(m[3]), code: m[4] } : null;
};
const ghostFor = seed => parseGhost(loadText(GHOST_KEY + seed));
// at game over (screens.js): keep the run when it beats the saved one for this world
function saveGhost(code, score, hero) {
  if (!ghostModes() || G.replay || !code || score < 1) return;
  const seed = getSeed(), old = ghostFor(seed);
  if (old && old.score >= score) return;
  save(GHOST_KEY + seed, score + '|' + hero + '|' + Date.now() + '|' + code);
  try {   // forget the oldest worlds
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(GHOST_KEY)) keys.push(k); }
    keys.sort((a, b) => (parseGhost(localStorage.getItem(b))?.time || 0) - (parseGhost(localStorage.getItem(a))?.time || 0));
    for (const k of keys.slice(GHOST_KEEP)) localStorage.removeItem(k);
  } catch (e) {}
}

let ghost = null;   // { sim, p, mesh }
let primed = null;   // during the countdown: { g, rp, sim } (sim null: no ghost for this world)
// the saved best run on this world, decoded, with its sim made: null when there is none
function ghostRun() {
  if (!ghostModes() || G.replay) return null;
  const g = ghostFor(getSeed());
  if (!g) return null;
  const rp = decodeReplay(g.code);
  return rp && rp.joined[g.hero] ? { g, rp, sim: createSim(rp) } : null;
}
// each countdown step (app.js step): the ghost's own countdown (always COUNTDOWN long, as sim.js plays it) runs along,
// spread over the steps our countdown has left (a quick one-second countdown takes three ghost steps a step), so the
// GO step has no catch-up of hundreds of steps to do (a hitch on a slow phone)
const GHOST_COUNT_STEPS = Math.ceil(COUNTDOWN / STEP);
function primeGhost() {
  if (G.state !== 'countdown') return;   // the step that started play (startGhost has taken the primed run)
  if (!primed) primed = { ...(ghostRun() || { sim: null }), n: 0 };
  if (!primed.sim) return;
  const left = Math.max(1, Math.ceil(G.countdown / STEP));
  for (let k = Math.ceil((GHOST_COUNT_STEPS - primed.n) / left); k > 0 && primed.sim.state === 'countdown'; k--) { primed.sim.step(); primed.n++; }
}
// at the start of play (screens.js startPlay): the saved best run on this world, if any
function startGhost() {
  const run = primed && primed.sim ? primed : ghostRun();
  stopGhost();
  if (!run) return;
  const { g, rp, sim } = run;
  const ch = CHARACTERS.find(c => c.key === rp.chars[g.hero]) || CHARACTERS[0];
  for (let n = 0; n < 2000 && sim.state === 'countdown'; n++) sim.step();   // its countdown is over: play starts now
  if (sim.state !== 'play') return;
  const mesh = makeCharacter(ch.boxes, ch.key);
  mesh.userData.body.material = ghostMat;
  mesh.userData.body.castShadow = false;   // see-through: no solid shadow (and one shadow draw less)
  scene.add(mesh);
  ghost = { sim, p: sim.players[g.hero], mesh, score: g.score };
  placeGhost();
}
// one game step (app.js step, while playing)
function stepGhost() {
  if (!ghost) return;
  if (!ghost.sim.step() || !ghost.p.alive) { ghost.mesh.visible = false; ghost.done = true; }
  else if ((ghost.sim.tick & 255) === 0) ghost.sim.prune();
}
// per drawn frame (app.js)
function placeGhost() {
  if (!ghost || ghost.done) return;
  const p = ghost.p, h = p.hop, m = ghost.mesh;
  if (h) { const t = Math.min(1, h.t); m.position.set(p.x, h.slide ? 0 : Math.sin(t * Math.PI) * 0.45, h.fz + (h.tz - h.fz) * t); }   // h.t runs 0..1; a slide stays on the ice
  else m.position.set(p.x, p.log ? 0.1 : 0, -p.row);
  m.rotation.y = p.facing || 0;
}
function stopGhost() {
  primed = null;
  if (!ghost) return;
  scene.remove(ghost.mesh);
  ghost = null;
}
const ghostInfo = () => ghost ? { row: ghost.p.row, x: ghost.p.x, alive: ghost.p.alive && !ghost.done, score: ghost.score } : null;

export { ghostInfo, ghostMat, ghostWarmGeo, placeGhost, primeGhost, saveGhost, startGhost, stepGhost, stopGhost };
