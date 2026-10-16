// Replays: a run is its seed, mode, characters, handicap, the world tick play began on, and every hop
// with the tick it happened on. The game steps at a fixed rate (app.js STEP) and traffic and trains are a
// function of the world tick, so the same hops on the same ticks give the same run. Pure: no DOM, tested by node.
import { MAX_RUN_TICKS, MODES, RULES } from './rules.js';

const REPLAY_VERSION = RULES;   // the replay's version is the rules version it was played with
const OLDEST = 2;              // version 1 had no start tick
const MAX_TICK = MAX_RUN_TICKS;   // anything later in a link is junk
const DIRS = { '0,1': 'U', '0,-1': 'D', '-1,0': 'L', '1,0': 'R' };
const DIR_MOVE = { U: [0, 1], D: [0, -1], L: [-1, 0], R: [1, 0] };
// run = { version (rules.js RULES, the current one when left out), seed, mode, chars: [key, key], joined: [bool, bool], handicap: 0..2, startTick, events: [[tick, player, dx, dr], ...] }
function encodeReplay(run) {
  let last = 0;
  const ev = run.events.map(([t, p, dx, dr]) => { const d = t - last; last = t; return d + (p ? 'b' : 'a') + DIRS[dx + ',' + dr]; }).join('');
  const text = [run.version || REPLAY_VERSION, run.seed, run.mode, run.chars.join(','), (run.joined[0] ? 1 : 0) + (run.joined[1] ? 2 : 0), run.handicap || 0, run.startTick, ev].join('|');
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeReplay(code) {
  try {
    const text = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const [v, seed, mode, chars, joined, handicap, startTick, ev = ''] = text.split('|');
    if (!/^\d$/.test(v) || Number(v) < OLDEST || Number(v) > REPLAY_VERSION || !/^\d{1,10}$/.test(seed) || !MODES.includes(mode)) return null;
    if (!/^[12]$/.test(handicap) && handicap !== '0') return null;
    if (!/^\d{1,9}$/.test(startTick) || Number(startTick) > MAX_TICK) return null;
    if (!/^[123]$/.test(joined)) return null;   // at least one player
    const keys = chars.split(',');
    if (keys.length !== 2 || !keys.every(k => /^[a-z]+$/.test(k))) return null;
    // the shape first, anchored and bounded: the scan below backtracks (slow) on long junk such as digits only
    // nosemgrep: detect-redos -- bounded digits, each repeat ends in a letter: linear (measured 1 M chars in 15 ms; tools/fuzz-replay.mjs)
    if (!/^(\d{1,6}[ab][UDLR])*$/.test(ev)) return null;   // eslint-disable-line security/detect-unsafe-regex -- bounded digits, each repeat ends in a letter: linear (measured 1 M chars in 15 ms)
    const events = [];
    let t = 0;
    for (const m of ev.matchAll(/(\d+)([ab])([UDLR])/g)) {
      t += Number(m[1]);
      if (t > MAX_TICK) return null;
      const [dx, dr] = DIR_MOVE[m[3]];
      events.push([t, m[2] === 'b' ? 1 : 0, dx, dr]);
    }
    const mask = Number(joined);
    return { version: Number(v), seed: Number(seed) >>> 0, mode, chars: keys, joined: [!!(mask & 1), !!(mask & 2)], handicap: Number(handicap), startTick: Number(startTick), events };
  } catch (e) { return null; }
}

export { decodeReplay, encodeReplay };
