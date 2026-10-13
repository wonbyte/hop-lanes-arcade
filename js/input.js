import { audio, muted, setMuted } from './audio.js';
import { $, G, RESULTS_DELAY } from './core.js';
import { stage } from './gfx.js';
import { players, queueMove } from './players.js';
import { cycleChar, hideHowto, join, pauseGame, restart, resumeGame } from './screens.js';

// Input: keyboard, the on-screen buttons, and taps and swipes on the field.
// ---------- input ----------
const canRestart = () => G.state === 'over' && G.stateT > RESULTS_DELAY && !G.restarting;
function press(i, dx, dr) {
  audio();
  if (G.restarting || hideHowto()) return;
  if (G.state === 'paused') { resumeGame(); return; }
  if (canRestart()) restart(i);
  else if (G.replay) return;   // a replay plays itself: no joins, no hops, until it is over
  else if (G.state === 'attract' || G.state === 'countdown') join(i);
  else if (G.state === 'play') { if (players[i].joined) queueMove(i, dx, dr); }
}
function pressStart() {
  audio();
  if (G.restarting || hideHowto()) return;
  if (G.state === 'paused') { resumeGame(); return; }
  if (canRestart()) restart();
  else if (G.replay) return;
  else if (G.state === 'attract') join(0);
  else if (G.state === 'countdown') G.countdown = Math.min(G.countdown, 0.01);
}

const KEYS = {
  KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [0, -1, 0], KeyD: [0, 1, 0],
  ArrowUp: [1, 0, 1], ArrowDown: [1, 0, -1], ArrowLeft: [1, -1, 0], ArrowRight: [1, 1, 0]
};
window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser shortcuts alone
  // a focused on-screen button handles its own Enter/Space (as a click)
  if ((e.code === 'Enter' || e.code === 'Space') && e.target.closest && e.target.closest('button')) return;
  if (hideHowto()) return;
  const k = KEYS[e.code];
  if (k) { e.preventDefault(); press(...k); }
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); pressStart(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') { if (G.state === 'paused') resumeGame(); else pauseGame(); }
  else if (e.code === 'KeyM') setMuted(!muted);
});
$('mute').addEventListener('click', () => { audio(); setMuted(!muted); });
setMuted(muted);
// character picker arrows on the join cards (they sit on the field, so the field must not also get the touch)
document.querySelectorAll('.cyc').forEach(btn => {
  const go = () => { audio(); cycleChar(+btn.dataset.p, +btn.dataset.d); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); go(); });
  btn.addEventListener('click', e => { if (e.detail === 0) go(); });
});
document.querySelectorAll('.tap').forEach(btn => {
  const i = +btn.dataset.p;
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('down'); press(i, 0, 1); });
  btn.addEventListener('click', e => { if (e.detail === 0) press(i, 0, 1); });   // keyboard activation only
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, () => btn.classList.remove('down')));
});
document.querySelectorAll('.side').forEach(btn => {
  btn.addEventListener('pointerdown', e => { e.preventDefault(); press(+btn.dataset.p, +btn.dataset.dx, 0); });
  btn.addEventListener('click', e => { if (e.detail === 0) press(+btn.dataset.p, +btn.dataset.dx, 0); });
});
$('start').addEventListener('click', pressStart);

// touch (or click) on the field itself: tap = hop forward, swipe = move that way.
// With one player in the game the whole field is theirs; otherwise left half = P1, right half = P2.
const SWIPE_MIN = 24;   // px of travel before a touch counts as a swipe
const pointers = new Map();
function fieldPlayer(clientX, r) {
  if (G.state === 'play' || G.state === 'over') {   // a solo player owns the whole field, also for "play again"
    const solo = players.filter(p => p.joined);
    if (solo.length === 1) return solo[0].id;
  }
  return clientX < r.left + r.width / 2 ? 0 : 1;
}
// a short ring where the field was touched, in the player's color, so the field reads as a control
function touchRing(clientX, clientY, i, r) {
  const el = document.createElement('div');
  el.className = 'ring p' + (i + 1);
  el.style.left = (clientX - r.left) + 'px';
  el.style.top = (clientY - r.top) + 'px';
  stage.appendChild(el);
  const gone = () => el.remove();
  el.addEventListener('animationend', gone);
  setTimeout(gone, 500);   // also without animations (reduced motion)
}
stage.addEventListener('pointerdown', e => {
  if (e.button > 0 || e.target.closest('#cards, #howto, #menu, #results button, #mute')) return;
  const r = stage.getBoundingClientRect();   // one layout read per touch
  const i = fieldPlayer(e.clientX, r);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, i, done: false });
  touchRing(e.clientX, e.clientY, i, r);
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}   // release lands here even off the field
});
stage.addEventListener('pointermove', e => {
  const t = pointers.get(e.pointerId);
  if (!t || t.done) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  if (Math.hypot(dx, dy) < SWIPE_MIN) return;
  t.done = true;   // fire the swipe now, not on release, so it feels instant
  if (Math.abs(dx) > Math.abs(dy)) press(t.i, Math.sign(dx), 0);
  else press(t.i, 0, dy < 0 ? 1 : -1);
});
function endTouch(e) {
  const t = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (t && !t.done && e.type === 'pointerup') press(t.i, 0, 1);
}
stage.addEventListener('pointerup', endTouch);
stage.addEventListener('pointercancel', endTouch);
// gamepads (standard mapping): pad 0 drives player 1, pad 1 player 2; polled every frame, edge-triggered
const padPrev = new Map();
function padEdge(key, on) {
  const was = padPrev.get(key) || false;
  padPrev.set(key, on);
  return on && !was;
}
// nothing to read until a pad has said hello (browsers fire this on its first button press)
let padSeen = false;
window.addEventListener('gamepadconnected', () => { padSeen = true; });
function pollGamepads() {
  if (!padSeen) return;
  let pads;
  try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { return; }
  if (!pads) return;
  for (let n = 0; n < pads.length && n < 2; n++) {
    const g = pads[n];
    if (!g || !g.buttons) continue;
    const b = k => !!(g.buttons[k] && g.buttons[k].pressed);
    const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
    // sticks use hysteresis: pressed past 0.5, released under 0.3
    const st = (k, v, dir) => padPrev.get(k) ? v * dir > 0.3 : v * dir > 0.5;
    const sl = st(n + 'l', ax, -1), sr = st(n + 'r', ax, 1), su = st(n + 'u', ay, -1), sd = st(n + 'd', ay, 1);
    try {
      if (padEdge(n + 'u', b(12) || su || b(0))) press(n, 0, 1);
      if (padEdge(n + 'd', b(13) || sd)) press(n, 0, -1);
      if (padEdge(n + 'l', b(14) || sl)) press(n, -1, 0);
      if (padEdge(n + 'r', b(15) || sr)) press(n, 1, 0);
      if (padEdge(n + 's', b(9) || b(8))) pressStart();
      if (padEdge(n + 'p', b(1) || b(2))) { if (G.state === 'paused') resumeGame(); else pauseGame(); }
    } catch (e) {}
  }
}
$('app').addEventListener('contextmenu', e => e.preventDefault());

export { KEYS, SWIPE_MIN, canRestart, endTouch, fieldPlayer, pointers, pollGamepads, press, pressStart, touchRing };
