// Phone extras: vibration and keeping the screen awake. Both are optional.
// ---------- phone extras: buzz and keep the screen on (both optional) ----------
// browsers refuse to vibrate before the first touch or key (and log an error), so wait for one
let gestured = false;
const noteGesture = () => { gestured = true; };
window.addEventListener('pointerdown', noteGesture, { capture: true, once: true });
window.addEventListener('keydown', noteGesture, { capture: true, once: true });
function buzz(ms) { try { if (gestured && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
let wakeLock = null, wakePending = false, wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && !wakePending && navigator.wakeLock) {
      wakePending = true;   // one request at a time, or an orphaned lock keeps the screen on
      const lock = await navigator.wakeLock.request('screen').finally(() => { wakePending = false; });
      if (!wantAwake) { lock.release(); return; }   // the game ended while we waited
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!on && wakeLock) await wakeLock.release();
  } catch (e) { wakeLock = null; }
}
// the browser drops the lock when the tab is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (wantAwake && document.visibilityState === 'visible') keepAwake(true);
});

export { buzz, keepAwake };
