import { $ } from './core.js';
import { MUTE_KEY, loadText } from './storage.js';

// Sound effects made with the Web Audio API, and the mute switch.
// ---------- audio ----------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
let muted = loadText(MUTE_KEY) === '1';
function setMuted(on) {
  muted = on;
  try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (e) {}
  const b = $('mute');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'SOUND OFF' : 'SOUND ON';
}
function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && actx && actx.state === 'running') actx.suspend().catch(() => {});
});
const sfx = {
  hop: id => beep(id ? 520 : 440, 0.07, 'square', 0.04, 200),
  squash: () => beep(160, 0.25, 'sawtooth', 0.08, -120),
  splash: () => beep(900, 0.3, 'triangle', 0.06, -800),
  fall: () => beep(300, 0.4, 'triangle', 0.06, -220),
  bell: () => beep(1250, 0.08, 'square', 0.025),
  horn: () => { beep(220, 0.5, 'sawtooth', 0.05); beep(277, 0.5, 'sawtooth', 0.04); },
  join: () => { beep(660, 0.08); setTimeout(() => beep(990, 0.12), 80); },
  go: () => beep(880, 0.25, 'square', 0.06),
  tick: () => beep(440, 0.1, 'square', 0.05),
  coin: () => { beep(1320, 0.06, 'square', 0.04); setTimeout(() => beep(1760, 0.1, 'square', 0.04), 60); },
  buy: () => { beep(660, 0.08); setTimeout(() => beep(880, 0.08), 80); setTimeout(() => beep(1320, 0.14), 160); },
  nope: () => beep(140, 0.2, 'sawtooth', 0.06),
  eagle: () => { beep(1500, 0.18, 'sawtooth', 0.05, -500); setTimeout(() => beep(1300, 0.25, 'sawtooth', 0.05, -600), 180); }
};

const isMuted = () => muted;
// let the audio device sleep on long idle screens; audio() wakes it on the next input
function idleAudio() { if (actx && actx.state === 'running') actx.suspend().catch(() => {}); }

export { actx, audio, beep, idleAudio, isMuted, muted, setMuted, sfx };
