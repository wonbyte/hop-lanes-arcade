import { $, G } from './core.js';
import { t } from './i18n.js';
import { MUTE_KEY, loadText } from './storage.js';

// Sound effects made with the Web Audio API, and the mute switch.
// ---------- audio ----------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (!actx) return;
  // the title tune needs a running context, which needs a gesture: start it with the first one on the title
  const onTitle = () => { if (G.state === 'attract') startTune(); };
  if (actx.state === 'suspended') actx.resume().then(onTitle).catch(() => {}); else onTitle();
}
let muted = loadText(MUTE_KEY) === '1';
function setMuted(on) {
  muted = on;
  if (on) stopTune();
  try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (e) {}
  const b = $('mute');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = t(on ? 'SOUND OFF' : 'SOUND ON');
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
  mud: () => beep(180, 0.22, 'triangle', 0.06, 90),
  warn: () => { beep(1100, 0.07, 'square', 0.05); setTimeout(() => beep(1100, 0.07, 'square', 0.05), 120); setTimeout(() => beep(1400, 0.1, 'square', 0.05), 240); },
  cheer: () => [659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, i === 2 ? 0.3 : 0.1, 'square', 0.05), i * 90)),
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
  eagle: () => { beep(1500, 0.18, 'sawtooth', 0.05, -500); setTimeout(() => beep(1300, 0.25, 'sawtooth', 0.05, -600), 180); },
  best: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, i === 6 ? 0.4 : 0.12, 'square', 0.05), i * 90)),
  over: () => [659, 587, 523, 392].forEach((f, i) => setTimeout(() => beep(f, i === 3 ? 0.5 : 0.14, 'triangle', 0.06), i * 140)),
  prize: () => [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.06), i * 70))
};

// ---------- the title tune: a short chip loop while the title screen shows ----------
// (browsers allow sound only after a touch or key, so it starts after the first input)
// 32 steps of [lead, bass]: C - G - A - F, eight steps each (bass on every other step)
const LEAD = [523, 659, 784, 659, 523, 659, 784, 1047, 988, 784, 587, 784, 988, 784, 587, 784,
  880, 1047, 880, 659, 523, 659, 880, 659, 698, 880, 1047, 880, 698, 784, 659, 523];
const ROOTS = [131, 98, 110, 87];
const TUNE = LEAD.map((f, i) => [f, i % 2 ? 0 : ROOTS[i >> 3]]);
const TUNE_STEP = 170, TUNE_LOOPS = 2;
let tuneTimer = 0, tuneStep = 0;
function startTune() {
  if (tuneTimer || !actx || actx.state !== 'running' || muted) return;
  tuneStep = 0;
  const next = () => {
    if (tuneStep >= TUNE.length * TUNE_LOOPS || muted) { tuneTimer = 0; return; }
    const [lead, bass] = TUNE[tuneStep % TUNE.length];
    beep(lead, 0.13, 'square', 0.035);
    if (bass) beep(bass, 0.15, 'triangle', 0.025);
    tuneStep++;
    tuneTimer = setTimeout(next, TUNE_STEP);
  };
  next();
}
function stopTune() { if (tuneTimer) { clearTimeout(tuneTimer); tuneTimer = 0; } }

const isMuted = () => muted;
// let the audio device sleep on long idle screens; audio() wakes it on the next input
function idleAudio() { if (actx && actx.state === 'running') actx.suspend().catch(() => {}); }

export { actx, audio, beep, idleAudio, isMuted, muted, setMuted, sfx, startTune, stopTune };
