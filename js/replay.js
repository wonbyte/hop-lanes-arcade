// Replays: a run is its seed, mode, characters and every hop with the tick it happened on.
// The game steps at a fixed rate (app.js STEP), the world is seeded and the train timers are too,
// so playing the same hops on the same ticks gives the same run. Pure: no DOM, tested by node.
const REPLAY_VERSION = 1;
const DIRS = { '0,1': 'U', '0,-1': 'D', '-1,0': 'L', '1,0': 'R' };
const DIR_MOVE = { U: [0, 1], D: [0, -1], L: [-1, 0], R: [1, 0] };
// run = { seed, mode, chars: [key, key], joined: [bool, bool], events: [[tick, player, dx, dr], ...] }
function encodeReplay(run) {
  let last = 0;
  const ev = run.events.map(([t, p, dx, dr]) => { const d = t - last; last = t; return d + (p ? 'b' : 'a') + DIRS[dx + ',' + dr]; }).join('');
  const text = [REPLAY_VERSION, run.seed, run.mode, run.chars.join(','), (run.joined[0] ? 1 : 0) + (run.joined[1] ? 2 : 0), ev].join('|');
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeReplay(code) {
  try {
    const text = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const [v, seed, mode, chars, joined, ev] = text.split('|');
    if (Number(v) !== REPLAY_VERSION || !/^\d+$/.test(seed) || !/^[a-z]+$/.test(mode)) return null;
    const keys = chars.split(',');
    if (keys.length !== 2 || !keys.every(k => /^[a-z]+$/.test(k))) return null;
    const events = [];
    let t = 0;
    for (const m of ev.matchAll(/(\d+)([ab])([UDLR])/g)) {
      t += Number(m[1]);
      const [dx, dr] = DIR_MOVE[m[3]];
      events.push([t, m[2] === 'b' ? 1 : 0, dx, dr]);
    }
    if (events.length * 6 < ev.length - 2) return null;   // junk in the event text
    const mask = Number(joined);
    return { seed: Number(seed) >>> 0, mode, chars: keys, joined: [!!(mask & 1), !!(mask & 2)], events };
  } catch (e) { return null; }
}

export { DIRS, DIR_MOVE, REPLAY_VERSION, decodeReplay, encodeReplay };
