# Evidence

What was measured against `docs/budgets.md` and `docs/threat-model.md`, before and after the work of 16 Oct 2026, and
by which tool. Raw files (traces, Spector captures, heap snapshots, scanner reports) are the CI artifacts of each run
(`bench`, `soak`, `live`, `zap-report`) or come from the command named in each section.

## Performance

### Real devices

Not measured yet: the repository's machine has no phone and no GPU. Each budget below is still open for the three
floor devices. `docs/budgets.md` says how to run the bench on them (Android over USB, iPhone by the bench link).

### The headless proxy (SwiftShader, 390 x 760 at 2x, CPU throttled 4x)

`node tools/device-bench.mjs`, the bench replay, one run each; before = the code at `9107f8c`, after = `main`.

| Measure | Before | After | Budget (floor phone) |
|---|---|---|---|
| p50 frame in play | 116.7 ms | 66.7 ms | |
| p95 frame in play | 150.1 ms | 83.4 ms | <= 33.3 ms (device only) |
| Worst frame in play | 416.7 ms | 216.6 ms | <= 100 ms (device only) |
| Frames over 100 ms | 1129 of 1241 | 30 of 1254 | 0 |
| The quality ladder at the end | pixel ratio 2, shadow map 512 (no step kept) | pixel ratio 1, shadow map 512 | |
| Script time per frame, p95 | 10.6 ms | 13.0 ms | |
| Draw calls in one play frame (Spector.js) | 33 | 33 | |
| Program switches in one frame | 7 | 7 | |

The slow frames that are left are the first second of play, before the ladder has judged a window (rows 0 and 1).

Why it changed: the ladder (`js/gfx.js`) never kept a step on a device this slow. Frames over 0.1 s were not counted,
and each step was judged on a moving average that starts at 1/60 s: with about 15 frames in a 2 s window the average
was still climbing when the step was judged, so every step looked like no gain and was undone. Now each window is
judged by its mean frame time and frames up to 0.5 s count.

### Slow 4G load (the same proxy: HTTP/2, gzip, Lighthouse Slow 4G, CPU 4x)

Five loads of each version, in turns on one machine (`--load-only`):

| Version | Playable (ms, sorted) | Median | Bytes |
|---|---|---|---|
| Before | 3798, 3885, 3948, 4033, 4094 | 3948 | 264 504 |
| After | 3752, 3846, 3983, 4031, 4072 | 3983 | 266 273 |

No change between the versions, and both sit at the 4 s budget: 2 of 5 loads miss it on this machine. On GitHub's
runners, the same measurement gave 3571 ms against this checkout (the CI bench job) and 3588 ms against the live page on
GitHub Pages itself (271 744 bytes; the deploy job's live check, which gates on 4 s). The waterfall shows
the last byte at about 2.7 s (264 KB at 1.47 Mbit/s; `vendor/three.min.js` is 136 KB of it) and about 1 s of CPU after
it. A CPU profile of that second: 802 ms native browser work (parsing, WebGL shader compiles, which SwiftShader does on
the CPU), 511 ms in Three.js, about 200 ms in the game's own code. A preload of `vendor/three.min.js` with high fetch
priority changed nothing measurable (the network is bandwidth-bound), so it was not kept.

### 30-minute soak (the same proxy, no CPU throttle)

| Measure | Before (26 runs) | After (27 runs) | Budget |
|---|---|---|---|
| Heap after GC, minute 30 vs minute 1 | +10.4% | +11.8% | <= +5% |
| The game's objects (heap without compiled code) | +0.6% | +1.4% | <= +5% |
| Compiled code (V8) | +21.2% | +22.3% | (not a budget) |
| Geometries / textures / shader programs | 32 / 2 / 7, then 32 / 2 / 7 | 32 / 2 / 7, then 32 / 2 / 7 | +-5%, programs equal |
| p95 frame, last run vs first | -25% | -24.9% (66.6 -> 50 ms) | within 10% |

The heap budget as written was missed before the work, and the heap snapshots showed the cause: 381 more `code`
objects (V8 optimizing more functions as the game runs), not the game's objects. `docs/budgets.md` now also has the
row without compiled code, and the nightly soak gates on it. The heap after each run of the second soak (KB):
5160, 5315, 5472, 5512 ... 5733 at run 15 ... 5770 at run 27: it climbs while V8 warms up and is flat from about run 20.
The first run of each soak is slower because the ladder is still stepping down during it (it ended at pixel ratio 1,
shadow map 256, shadows every other frame).

## Hazards and fairness (rules 3)

A player reported an animal that fell into the water while riding a wooden board. `tools/hazard-audit.mjs` (random
play on the real rules and worlds, 20000 runs, seed 1; `npm run audit:hazards`) found three causes, all within the
rules but unfair: nothing on screen showed the line past which a log sweeps its rider away, the edge refused the hop
that would have saved the rider, and a bridge plank that broke just after a hop off it still dropped the animal in the
air. Rules 3 fixes them; old replays keep rules 2 (`js/replay.js` stores the version).

| Measure (20000 runs) | Rules 2 | Rules 3 |
|---|---|---|
| Riders swept off a log | 108 | 41 |
| ... with a refused forward or back hop in the last second | 80 | 0 |
| ... warned first (sound, buzz, sparks); time from the warning, min / median | (no warning) | 41 of 41; 0.24 s / 0.53 s |
| Water landings where part of the body was over a log | 786 of 9079 | 32 of 8952 (all within 0.01 of the body's edge) |
| Plank or tile falls | 208 | 184 |
| ... of a player in the air (the first half of a hop off it) | 22 | 0 |
| Shortest time a plank cracked before it dropped | 72 ticks (0.6 s) | 72 ticks (0.6 s) |
| Largest move of a car / log / train in one step | 0.061 / 0.041 / 0.27 | the same |
| Narrowest hit width of a car / train | 1.46 / 13.01 | the same: nothing can skip through a player |
| A rider not moving exactly with its log | 0 | 0 |
| Car hits that touch the body by less than 0.05 | 1946 of 7806 | 2055 of 8039 (a touch, kept: `HIT_PAD` unchanged) |

The view: the water past the line is darker, with a white line and foam flecks (world.js `rapids`), and a cracking
plank sinks, tilts and shakes more until it drops, with a crack sound on the landing (world.js `placePlanks`). The
audit with `--rules 2` gives the same deaths, cause by cause, as the code before the change, so the old rules are unchanged; the
saved browser runs in `tests/sim.test.mjs` and the bench replay still play the same.

## Security

| Tool | Before | After |
|---|---|---|
| npm audit (dev packages; the game ships none) | 13 advisories: 7 low, 5 moderate, 1 high (`tmp` path traversal) | 0 |
| OSV-Scanner (both lock files) | 6 advisories in 5 packages | 0 |
| Semgrep (community rules at a fixed commit) | 13 findings, all checked: none exploitable | 0: 6 suppressed on their 5 lines with the reason, the 7 jQuery hits left out with the jQuery rules (there is no jQuery: `$` is `getElementById`); 1 more, in new code, fixed |
| CodeQL (security-extended) | not run | 1 found in new code (a check-then-read file race in the bench's file server, also in the test server): fixed; 0 |
| OWASP ZAP API scan of the score server | not run | 0 alerts (the CORS `*` default is accepted in the threat model) |
| zizmor (workflows) | 0 (8 informational with the auditor persona) | 2 found in new workflow steps (a template injection, a package installed without a lock file): fixed; 0 |
| actionlint + shellcheck | 0 | 1 found in a new step (an unused loop variable): fixed; 0 |
| gitleaks (every commit) | 0 | 0 |
| Google CSP Evaluator | 1 accepted (`'self'` in `script-src`: no JSONP, no uploads) | the same; both pages |
| MDN HTTP Observatory (the live page) | not run | grade C (55): CSP, cookies, CORS, COEP, COOP, CORP, redirection, referrer policy and SRI pass; HSTS, `nosniff` and framing fail and are accepted in `docs/threat-model.md` section 6 (GitHub Pages lets a site set no header) |

Fixed in the design, not only the code:
- The score server accepted any claimed score unless `VERIFY=1` was set: replay checking is now on by default. Every
  JSON reply sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- CI ran on Node 20, past its end of life (April 2026), with actions that run on Node 20: Node 22, and the actions moved
  to releases that run on Node 24.
- The threat model said `github.io` was on the HSTS preload list. The Observatory showed it is not, and Pages sends no
  HSTS header: the claim is corrected and the risk accepted in writing, with the fix (a host that sends HSTS) named.

## Code

| Tool | Before | After |
|---|---|---|
| TypeScript `--checkJs` on `js/` and `server/` | 43 errors (DOM and Three.js types the checker could not see; no runtime bug) | 0 |
| dependency-cruiser | 1 import cycle (`players.js` <-> `screens.js`) | 0; the rules files import only each other |
| ESLint complexity (paths per function) | worst 36 (`sim.js` `land`); 10 functions over 20 | worst 20; 0 over 20 |
| jscpd (50 tokens or more) in `js/`, `server/`, `tools/`, `css/` | 4 clones (the tools' rng and flag parser) | 0 |
| Mutation score, sim.js (Stryker 10 on both versions) | 93.09% (75 survivors) | 93.03% (76 survivors) |
| Mutation score, rules.js (Stryker 10) | 98.4% (Stryker 8) | 98.38% |

The refactor of `sim.js` first left 7 more surviving mutants. Four were real gaps, and three new tests in
`tests/sim.test.mjs` kill them: a hop queued on ice when a tree stops the slide, a coin and a queued hop on a whole
bridge plank, and a row dropped under a hop. Two are proven equivalent (after a kill, the slow check cannot fire) and
are marked on their line with the proof. One is left: a slide that starts one step before the camera limit would be
checked one step later.

The tests (`npm test`): 9 suites, all green, after every change. The saved runs in `tests/sim.test.mjs` and the
property tests did not change.
