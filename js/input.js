import { audio, muted, setMuted } from './audio.js';
import { $, G } from './core.js';
import { stage } from './gfx.js';
import { crouch, players, queueMove } from './players.js';
import { cycleChar, hideHowto, join, pauseGame, playAgain, resumeGame, toMenu } from './screens.js';
import { closeDialog, dialogOpen } from './panels.js';

// Input: keyboard, the on-screen buttons, and taps and swipes on the field.
// ---------- input ----------
// the countdown ends at once (a joined player's tap or key, or START): the world clock goes on from here, and the
// replay code keeps the tick play began on, so the run is the same however long the countdown was
const goNow = () => { G.countdown = Math.min(G.countdown, 0.01); };
function press(i, dx, dr) {
  audio();
  if (G.restarting || hideHowto()) return;
  if (G.state === 'paused') { resumeGame(); return; }
  if (G.state === 'over') { playAgain(i); return; }   // once the results have shown a moment (screens.js canRetry)
  if (G.replay) return;   // a replay plays itself: no joins, no hops, until it is over
  if (G.state === 'countdown' && players[i].joined) goNow();
  else if (G.state === 'attract' || G.state === 'countdown') join(i);
  else if (G.state === 'play') { if (players[i].joined) queueMove(i, dx, dr); }
}
function pressStart() {
  audio();
  if (G.restarting || hideHowto()) return;
  if (G.state === 'paused') { resumeGame(); return; }
  if (G.state === 'over') playAgain();
  else if (G.replay) return;
  else if (G.state === 'attract') join(0);
  else if (G.state === 'countdown') goNow();
}

const KEYS = {
  KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [0, -1, 0], KeyD: [0, 1, 0],
  ArrowUp: [1, 0, 1], ArrowDown: [1, 0, -1], ArrowLeft: [1, -1, 0], ArrowRight: [1, 1, 0]
};
window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser shortcuts alone
  if (ownKey(e)) return;
  const k = KEYS[e.code], start = e.code === 'Space' || e.code === 'Enter';
  if (panelKey(e, k || start)) return;
  if (k) { e.preventDefault(); press(...k); }
  else if (start) { e.preventDefault(); pressStart(); }
  else if (e.code === 'Escape' && G.state === 'over') toMenu();   // the results: back to the title
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  else if (e.code === 'KeyM') setMuted(!muted);
});
// a key the page leaves alone: a focused on-screen button handles its own Enter/Space (as a click), and typing in the
// share text is not a restart
function ownKey(e) {
  const el = /** @type {HTMLElement} */ (e.target);
  if ((e.code === 'Enter' || e.code === 'Space') && el.closest && el.closest('button')) return true;
  return el.tagName === 'TEXTAREA';
}
// a panel (settings, top 10) is open over the game: the field and the gamepads do nothing until it closes (the pause
// menu is the exception: any press goes on with the game)
const panelUp = () => dialogOpen() && G.state !== 'paused';
// the first-run help and the dialogs take a key first; true when the key is theirs
function panelKey(e, gameKey) {
  // the first-run help closes on a game key (Tab and Shift still reach its button)
  if ((gameKey || e.code === 'Escape') && hideHowto()) { e.preventDefault(); return true; }
  if (e.code === 'Escape' && G.state !== 'paused' && closeDialog()) { e.preventDefault(); return true; }   // settings, top 10
  return panelUp();   // a panel is open: keys go to its buttons
}
$('mute').addEventListener('click', () => { audio(); setMuted(!muted); });
$('pauseBtn').addEventListener('click', () => { audio(); pauseGame(); });   // the II button of the slim top bar in play
setMuted(muted);
// character picker arrows on the join cards (they sit on the field, so the field must not also get the touch)
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.cyc')).forEach(btn => {
  const go = () => { audio(); cycleChar(+btn.dataset.p, +btn.dataset.d); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); go(); });
  btn.addEventListener('click', e => { if (e.detail === 0) go(); });
});
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tap')).forEach(btn => {
  const i = +btn.dataset.p;
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('down'); press(i, 0, 1); });
  btn.addEventListener('click', e => { if (e.detail === 0) press(i, 0, 1); });   // keyboard activation only
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, () => btn.classList.remove('down')));
});
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.side')).forEach(btn => {
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
// The rings are pooled (a few taps a second during play): a hidden one is shown again, which restarts its animation
const rings = [], ringT = new Map();
function touchRing(clientX, clientY, i, r) {
  let el = rings.find(e => e.hidden);
  if (!el) {
    if (rings.length >= 6) el = rings[0]; else { el = document.createElement('div'); rings.push(el); stage.appendChild(el); }
    el.hidden = true;
  }
  el.className = 'ring p' + (i + 1);
  el.style.left = (clientX - r.left) + 'px';
  el.style.top = (clientY - r.top) + 'px';
  el.hidden = false;
  // a ring taken while it still shows (the 7th quick tap) was hidden and shown in the same task, which restarts nothing:
  // it stayed at its last keyframe (opacity 0) and that tap had no ring. Restart its animation without a layout read
  if (el.getAnimations) for (const a of el.getAnimations()) { a.cancel(); a.play(); }
  clearTimeout(ringT.get(el));
  ringT.set(el, setTimeout(() => { el.hidden = true; }, 500));   // after the animation (also without one: reduced motion)
}
stage.addEventListener('pointerdown', e => {
  if (e.button > 0 || panelUp() || /** @type {HTMLElement} */ (e.target).closest('#cards, #howto, #menu, #results button, #results textarea, #marquee button, .dialog .box')) return;
  const r = stage.getBoundingClientRect();   // one layout read per touch
  const i = fieldPlayer(e.clientX, r);
  if (G.state === 'play' && !G.replay) crouch(i);   // the animal crouches; the hop (or the swipe) comes on release
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, i, done: false });
  touchRing(e.clientX, e.clientY, i, r);
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}   // release lands here even off the field
});
stage.addEventListener('pointermove', e => {
  const t = pointers.get(e.pointerId);
  if (!t || t.done || panelUp()) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  if (Math.hypot(dx, dy) < SWIPE_MIN) return;
  t.done = true;   // fire the swipe now, not on release, so it feels instant
  if (Math.abs(dx) > Math.abs(dy)) press(t.i, Math.sign(dx), 0);
  else press(t.i, 0, dy < 0 ? 1 : -1);
});
function endTouch(e) {
  const t = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (t && !t.done && e.type === 'pointerup' && !panelUp()) press(t.i, 0, 1);
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
    if (g && g.buttons) try { readPad(n, g, panelUp()); } catch (e) {}
  }
}
// pad n is player n: the d-pad, the left stick or A hops; Start / Select starts; B / X pauses.
// With a panel open the edges are still tracked (a button held as it closes does not fire) but nothing happens.
function readPad(n, g, panel) {
  const b = k => !!(g.buttons[k] && g.buttons[k].pressed);
  const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
  // sticks use hysteresis: pressed past 0.5, released under 0.3
  const st = (k, v, dir) => padPrev.get(k) ? v * dir > 0.3 : v * dir > 0.5;
  const sl = st(n + 'l', ax, -1), sr = st(n + 'r', ax, 1), su = st(n + 'u', ay, -1), sd = st(n + 'd', ay, 1);
  const edges = [padEdge(n + 'u', b(12) || su || b(0)), padEdge(n + 'd', b(13) || sd), padEdge(n + 'l', b(14) || sl), padEdge(n + 'r', b(15) || sr),
    padEdge(n + 's', b(9) || b(8)), padEdge(n + 'p', b(1) || b(2))];
  if (panel) return;
  PAD_ACTS.forEach((act, k) => { if (edges[k]) act(n); });
}
const PAD_ACTS = [n => press(n, 0, 1), n => press(n, 0, -1), n => press(n, -1, 0), n => press(n, 1, 0), () => pressStart(), () => togglePause()];
function togglePause() { if (G.state === 'paused') { audio(); resumeGame(); } else pauseGame(); }
$('app').addEventListener('contextmenu', e => e.preventDefault());

export { pollGamepads };
