# Hop Lanes: notes for Claude Code and other contributors

A two-player voxel lane-crossing game. Plain HTML, CSS and ES modules on Three.js r186. No framework, no bundler
except the small offline build script. Keep it that way.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs Playwright, Three.js and the check tools (test, build and CI only; the game itself has no dependencies). Node 22 |
| `npm test` | Syntax check, lint, the pure tests (`rules`, `replay`, `sim`, `gen`, instant), the property tests (`tests/property.test.mjs`: 2000 random replays through the codec and `simulate()`, then 3 random runs in the real page checked against `simulate()`), then the browser tests `smoke`, `layout`, `ui` and `scores-server` (~8 min) |
| `npm run lint` | ESLint (recommended + security plugin, no unused variables, no warnings; in `js/` and `server/` a function has at most 20 paths, nesting 4, 5 parameters) and `tools/check-exports.mjs` (no export that nothing imports) |
| `npm run typecheck` | TypeScript checks the JavaScript with no build (`tsconfig.json`: the game, DOM types, `THREE` from `@types/three` via `types/globals.d.ts`; `tsconfig.server.json`: the server). Zero errors |
| `npm run deps` | dependency-cruiser (`.dependency-cruiser.cjs`): no import cycle, rules/gen/sim/replay/missions import only each other, the server imports only those, no orphan module |
| `npm run dupes` | jscpd (`.jscpd.json`): no copied block of 50 tokens or more in `js/`, `server/`, `tools/`, `css/` |
| `npm run scan` | `tools/security-scan.sh`: actionlint, zizmor, gitleaks (whole history), OSV-Scanner, npm audit, Semgrep, CSP Evaluator, all pinned (installed into `.scan-tools/`; needs go >= 1.27). A false positive is suppressed on its line with the reason (`nosemgrep: rule -- why`) |
| `node tools/device-bench.mjs` | The budgets of `docs/budgets.md` measured with the bench replay: Slow 4G load (HTTP/2 and gzip, like Pages), a raw Chrome trace, a Spector.js capture of one frame, the frame times, heap snapshots. `--soak 30`, `--android` (a phone over USB), `--url` (the live site), `--check tools/bench-budgets*.json` (CI), `--print-url` (the bench link for any browser) |
| `npm run test:property` | The property tests with 20 browser runs (`PROP_RUNS=n`, `PROP_SEED=n` to pick the cases; a failure prints its seed and keys) |
| `npm run mutate` | Stryker mutation testing of the pure rules files (`stryker.config.json`, about an hour on 4 cores; `--mutate js/sim.js` for one file); the score says how well the tests pin the rules. Measured (Stryker 10, 16 Oct 2026): rules 98.4%, sim 93.0% (the code before that day's refactor: 93.1% with the same Stryker), gen 92.9% (Stryker 8). Survivors are equivalent mutants (float boundaries, unreachable guards); a proven one is marked `// Stryker disable next-line <mutator>: <proof>`. Keep each above 80% |
| `npm run audit:hazards` | `tools/hazard-audit.mjs`: 20000 random runs on the real rules and worlds; every death and refused hop classified, and the fairness invariants checked (no car or train skips through a player in one step, a rider moves exactly with its log, a hit touches the body, a plank cracks for its whole `PLANK_BREAK`; rules 3: no forward hop from a log refused for the edge, every swept rider warned, a landing within `LOG_SLACK_BODY` rides, no plank drops a player in the air). `--rules 2` audits the old rules. CI runs both; exit 1 on a broken invariant |
| `npm run fuzz` | `tools/fuzz-replay.mjs`: random and mutated replay codes through `decodeReplay` and `simulate` with a time budget (CI runs 2 minutes of it) |
| `npm run profile` | `tools/profile-game.mjs`: frame times of the real page under a 4x CPU throttle (SwiftShader: compare runs on one machine only) |
| `npm run load` | `tools/load-server.mjs`: the score server under autocannon load, with VERIFY on (`tools/fuzz-server.mjs` fuzzes its HTTP surface: bodies, headers, targets) |
| `npm run check` | Syntax check only (fast) |
| `npm run build` | Regenerates `hop-lanes-standalone.html` (python3 + the pinned esbuild, minified, no network). Fails over 800 KB. CI fails if this file is stale |
| `npm run build:three` | Regenerates `vendor/three.min.js` with esbuild from `tools/three-entry.js` (the Three.js names the game uses). CI fails if stale |
| `npm run icons` | Regenerates `icons/` from the frog pixel art (needs Pillow) |
| `npm run scores` | Starts the optional score server (`server/`) |

Run `npm test` and `npm run build` before every commit (CI also lints, type-checks, scans, fuzzes and runs the bench). Commit the rebuilt `hop-lanes-standalone.html` with the change.

`docs/budgets.md` holds the performance budgets per device and `docs/threat-model.md` every door with its accepted risk: a
budget a device misses, or a risk not written there, is a bug. `docs/evidence.md` holds the measured before/after numbers
and every scanner's result.

## Layout

| Path | Role |
|---|---|
| `index.html` | Markup only. The Content-Security-Policy meta is strict: `script-src 'self'`, no inline scripts or styles. A `modulepreload` link per module (add one for a new module) |
| `vendor/three.min.js` | Generated: a tree-shaken Three.js r186 (about 530 KB) exposing only the names the game uses as `window.THREE`. Add a name to `tools/three-entry.js` before using a new THREE class |
| `css/style.css` | All styles. Media queries: `max-width: 520px` (phones), `max-width: 340px` (tiny phones), `orientation: landscape` (phone held sideways; under 700px wide the mission box hides and the menu keeps between the join cards). The title menu's buttons and mission boxes share `--panel` / `--panel-edge` (nearly solid: the field must not show through). `--logo-size` shrinks with a short screen, and the menu sits about 3 logo sizes under the logo, so neither overlaps the logo nor the join cards |
| `js/main.js` | Entry. Checks `window.THREE`, then `import('./app.js')` |
| `js/rules.js` | Pure rules with no DOM or Three.js: the tuning constants that decide a run (`STEP`, `TICKS_PER_S`, `MAX_RUN_TICKS`, `HOP_TIME`, `PLAY_HALF`, `CAM_CREEP*`, `LEAD_*`, `BOMB_TICKS`, `SPRING_HOP`...), `RULES` (the rules version, see Conventions), seeded RNG, `dailySeedFor(day)` (the daily world's seed, shared with the score server), `nextLaneKind`, `hopTarget`, `hopTime` (mud), `isBombRow`, `MODES`, `TRAITS` (each animal's edge, `traitOf`), `HATS` (`hatFor(best)`), `isoDay` (the local YYYY-MM-DD), `isoWeek`, the daily streak (`streakAfter`). Tested by node directly: put logic here when it needs no scene |
| `js/gen.js` | Pure: the world as data. `createWorldGen(seed).lane(r)`: kind (the chain of `nextLaneKind`), direction, speed, cars and logs (`x0`), trees, pads, coins, power-ups, the train schedule (`railStep`), plus the looks drawn from the same rng. `trafficX` (where a car or log is at world time w). `connectRow` makes sure every row gives a way forward (`standColumns` / `standGroups`: each group of columns a player can stand on in the row before gets a straight hop: a pad over a pad, a plank, a felled tree); its draws come after the row's own. The rng draw order here is the world: never reorder a draw |
| `js/sim.js` | Pure: the rules of a run. `makeRules(W)` (hops, logs, hazards, shield, eagle, near misses, the traits, tag mode, the leader slowdown `p.lead`, spring hops `p.hop.high`, portals, cliff tiles, the twister, the versus bomb; players.js calls it with effect hooks), `createSim(replay)` (stepping, countdown included), `simulate(replay)` (to game over: score, ticks, row, cause, coins, `winner` decided the moment the run ends) and `winnerOf(players, mode)`. The score server runs it (`VERIFY`, on by default) |
| `js/missions.js` | Pure: the mission list and the done/advance logic, plus the daily missions (`DAILY`, `dailyMissions(day)`: three a day seeded from the date, paid once, `hoplanes.dailydone`) (`tests/replay.test.mjs`) |
| `js/replay.js` | Pure: `encodeReplay` / `decodeReplay` for `#replay-<code>` links. The first field is the rules version (2 to 4; `decodeReplay` returns it as `version`) |
| `js/i18n.js` | `t(key, args)`: English keys, Spanish and German tables; `data-i18n` for static markup; `#lang` cycles |
| `js/core.js` | Tuning constants, the shared state object `G`, `fail()`, `#debug` / `#seed-N` hash parsing |
| `js/storage.js` | localStorage: best scores, coins (`G.bank`), owned characters, picks, `savedMode()`, the look (`hoplanes.look`), `deviceTag` (4 chars; the online score name is `<CHARACTER> <tag>`), the local top 10 (`hoplanes.local`, `localTop`/`entersLocal`/`parseLocal`; names are `<initials> <CHARACTER>`, `hoplanes.initials` asked once with `window.prompt`, after the results show, never inside a game step). Always best effort (try/catch) |
| `js/audio.js` | Web Audio beeps (`sfx.*`), mute, the title tune (`startTune`) and the play loop (`startPlayLoop`, stopped at game over and on pause): bass, plus an arpeggio from row 25 and drums from row 60 (`playLayers()`, read from `G.camRow`) |
| `js/device.js` | Vibration, wake lock |
| `js/voxel.js` | `mergeBoxes`: a list of boxes becomes one vertex-colored mesh (one draw call). `cachedGeo` for repeated models |
| `js/models.js` | Colors, pixel portraits (`PIX`), box lists for every model, `CHARACTERS` (name, price), `hatBoxes` (`makeCharacter(boxes, key, hat)` draws the hat the all-time best unlocked) |
| `js/gfx.js` | Renderer, camera, light, `resize()`, the adaptive quality ladder (`watchFrameTime`) |
| `js/world.js` | Lanes: `LANE_BUILDERS` per kind, traffic, trains, coins, the instanced fleet (`Inst`), ground chunks (`mergeChunk`), the biomes (`BIOMES`, `biomeAt(r)`: colors only, a new one every `BIOME_ROWS`; an unlocked look `G.look` shifts the start), the tutorial seed on the first classic game. Lanes are a `Map` by row |
| `js/players.js` | Spawn, queued moves (`queueMove` / `applyMoves`, the replay feed), and the effect hooks `makeRules` calls (meshes, sounds, particles) for hops, landings, hazards, deaths, coins, combos, power-ups and the eagle |
| `js/ghost.js` | The ghost: in daily and room modes the best run on this world (`hoplanes.ghost.<seed>`: score, hero, time, replay code; newest 6 worlds kept) is replayed by `createSim` one step per game step and drawn see-through (`ghostMat`); `saveGhost` at game over, `primeGhost` each countdown step (the ghost's own countdown runs along, so GO has nothing to catch up), `startGhost` at play, `stopGhost` on the title |
| `js/screens.js` | Join cards and shop, title menu (modes incl. room code, prize machine, handicap, language, missions), countdown, results (share, replay link, confetti), restart, pause, first-run help, online score post |
| `js/panels.js` | The dialogs (`.dialog` in CSS, one open at a time: `openDialog`/`closeDialog`, Escape closes): SETTINGS (sound, vibration `hoplanes.buzz`, language, handicap, less motion `hoplanes.motion`, read at boot by `gfx.js`, the look `#look`: cycles the looks the all-time best unlocked, `LOOKS` in core.js), the pause menu (`#pauseBox`, shown by `pauseGame`), TOP 10 (`#board`; `#boardScope` cycles this device / all time / today / this week; the online scopes only with a score server; a `.watch` button reloads the page as that entry's replay), photo mode (`#snapBtn` in the pause menu: the field with the score drawn on it, shared as a file or downloaded as `hop-lanes.png`), and the screen-reader announcer (`#live`, `announceFrame` per frame). Listens for `hoplanes:lang` and `hoplanes:pause` events from screens.js |
| `js/input.js` | Keyboard, on-screen buttons, taps and swipes on the field, `pollGamepads()`. Side-effect only (imported by `app.js` for that) |
| `js/app.js` | The frame loop (fixed `STEP` of 1/120 s), the `window.hopLanes` test hook, replay boot, the first-run guided hints (`placeHint`, `hintText`, `hoplanes.hint`), the near-miss view nudge (`G.shakeT`), the landing dip (`G.landT`), the game-over show (`overFx`: slow motion `G.slowT`, zoom, the view slides to `G.lastDead`), the biome banner |
| `tools/build-standalone.sh` | Inlines CSS, the modules (in `tools/bundle-order.json` order, minified with esbuild), `vendor/three.min.js` and fonts into one offline HTML with a hash-based CSP |
| `.github/workflows/ci.yml` | On every push and pull request (Node 22; on `main` it runs as the first job of `deploy.yml`): the tests, lint + types + module graph + copies, the security scanners, CodeQL (security-extended, fails on any result), an OWASP ZAP API scan of the score server (`server/openapi.yaml`, accepted alerts in `server/zap-rules.tsv`), the device bench against `tools/bench-budgets.json`, the fuzzer, the stale-build checks |
| `.github/workflows/deploy.yml` | Runs all of `ci.yml`, and deploys `main` to GitHub Pages only when every job passed (Settings → Pages → Source: GitHub Actions, once); the site is `tools/assemble-site.sh` (an include list, each module minified by the pinned esbuild, imports kept); then checks the live page: the MDN HTTP Observatory (`tools/check-live-site.mjs`, its own lockfile in `tools/observatory/`) and the Slow 4G load (`tools/bench-budgets-live.json`) |
| `.github/workflows/soak.yml` | Nightly: 30 minutes of the bench replay in one page against `tools/bench-budgets-soak.json` (the game's objects, GPU objects, frame times must not drift) |
| `tools/assemble-site.sh` | Builds `_site/` as Pages serves it (deploy.yml); run it to check the minified modules locally |
| `tools/device-bench.mjs` | The device bench (see Commands). `tools/make-bench-replay.mjs` made `tests/bench-replay.txt` by a search over `createSim` (never edit the file by hand: `tests/replay.test.mjs` pins it and the link in `docs/budgets.md`) |
| `tools/lib.mjs` | Helpers the fuzzers and the load test share (the flag parser, the game's seeded rng, the animals) |
| `tests/serve.mjs` | Tiny static server for the tests: browsers refuse ES modules from `file://` |
| `tests/property.test.mjs` | Property tests with fast-check: the codec round trip, a deterministic, bounded, total `simulate()` on random replays, a cut replay, and random play in the real page against `simulate()` (part 2 needs the browser) |
| `tests/browser.mjs` | The shared browser-test helpers: `launch`, `open(browser, url, opts)`, `waitState`, and the waits on the game's own clock (`settle`, `waitTicks`, `hopKey`): never a fixed sleep |
| `server/` | Optional dependency-free score server (every posted score is replayed unless `VERIFY=0`; every reply sends `nosniff` and a CSP that allows nothing); wired by `<meta name="hop-lanes-scores">` (and `hop-lanes-token` for its `POST_TOKEN`). Set `TRUST_PROXY=1` behind a proxy (only a real IP in `X-Forwarded-For` is trusted). `VERIFY_BUDGET_MS` caps the replay CPU per minute (503 past it), `GET_RATE_MAX` throttles reads; the top lists are cached (at most `GET_CACHE_MAX` keys) until the next post; a request target the URL parser rejects is a 400. One run, one place: a fingerprint of the applied hops (`simulate(rp, { onHop })`) refuses the same run again (409), and only those hops are stored; a POST's day is the UTC date ±1; `MIN_RULES` (default `RULES`); no handicap runs; one place per seed in classic, race, coinwar and tag; POST needs `application/json`, and a foreign `Origin` is 403 when `ALLOW_ORIGIN` is set (production: the game's origin); `VERIFY_CLIENT_MS` caps replay CPU per /56; one file per day in `DAYS_DIR`. UI test 6b runs it against the real page (`tests/serve.mjs` overrides `/index.html` with the meta and `connect-src` filled in) |

## Conventions

- Game rules live in rules/gen/sim; world.js and players.js only render them. Anything that changes the outcome of a
  run goes there (tested by node), so the score server's `simulate()` and the browser can never disagree. Smoke test 5c
  checks a browser replay against `simulate()`; `tests/sim.test.mjs` holds runs the browser played.
- A change that decides a run differently (a hit, a landing, a refused hop) goes in a new rules version: bump `RULES`
  in rules.js, and gate the new behavior in sim.js on `rules3()`-style checks of `G.rules`. A replay stores its version,
  `createSim` and the browser (`startPlay` sets `G.rules`) play it with those rules, so old links, ghosts, posted
  scores and the saved runs in `tests/sim.test.mjs` play the same. Version 3: the log slack is the body
  (`LOG_SLACK_BODY` 0.3, was `LOG_SLACK` 0.05), a forward or back hop from a log that the edge refused (|x| > 4.5) goes to
  the last column, and a broken plank or tile drops only a player standing on it (not one in the first half of
  a hop off it). Version 4 (`rules4()`): the couch leash (`camLead`: the camera follows min(leader - 2, trailing + 4)
  with two alive, not race; a forward hop more than 9 rows past the partner is refused, `fx.leashed`), hop back in (a
  first death with the partner alive, not race: back 600 ticks later on still ground next to the partner with a
  shield blink, `p.rejoinT`, `fx.rejoin`), fairer hits (`HIT_PAD_BODY` 0.2, was 0.28; the near-miss band
  `NEAR_MISS_BODY` keeps its outer edge), the world by version (`createWorldGen(seed, version)`, `nextLaneKind(...,
  version)`: earlier kinds, a boss every 50 rows from 50, at most `BARE_MAX` 6 rows without still ground; worlds of
  version < 4 are built with the old tables and draws), more bombs (bomb rows from 10, 3x the power chance there),
  and the robot shakes off its first eagle (`fx.trait`). Run `npm run audit:hazards` after any rule change.
- Shared mutable state goes in `G` (`js/core.js`). Modules never assign to an imported binding. A run's own settings
  are fixed when it starts: `G.runHandicap` (the first join; the replay code and spawn use it, not the live
  `G.handicap`), `G.worldDay` (the day the daily seed was made for: posts, bests and the streak use it), `G.overTick`
  (the play tick the run ended on: players.js steps the rules only in countdown and play, plus the rest of that step,
  as sim.js does). Events: `hoplanes:join` (a join closes any open dialog), `hoplanes:day` (the date changed: today's
  missions, and a daily title world is rebuilt). While SETTINGS or TOP 10 is open, field taps, swipes and pads do not join.
- The game posts online only a run with handicap 0 on a world that is not fixed (`#seed-N`) (`canPost` in screens.js);
  a prize animal joins only once won (`lockedText`); the online name, share text and local top 10 name the animal that
  set the posted score (`scorerOf`).
- Every model is a list of `[w, h, d, color, x, y, z]` boxes (y = bottom). Characters face `-z` (forward).
- World generation uses `rowRng` (gen.js), seeded from the world seed and the row number, so a row is the same
  whatever rows were built before it (only the chain state of the row before feeds in). Effects use `fxRand` /
  `Math.random`, so seeds stay stable.
- The game steps at a fixed rate (`STEP`) and hops are queued to step boundaries, so replays are exact. Anything that
  changes the outcome of a run must be deterministic: seeded (`rowRng`, per-lane `lane.rng` for trains) or step-driven.
  Traffic and trains are a function of the world clock `G.worldTick` (reset when the world is built), never of frames
  or build time; a replay stores `startTick` (the world tick play began on) and the handicap.
- `updateLanes(players)` steps only the lanes a player can touch (row ±1 and the hop's `fromRow`); the other lanes
  are moved once per drawn frame by `updateFarLanes()` (before `placeCamera`). Anything in `players.js` that reads a
  car, log or train position (`o.x`, `train.x`) must stay inside that window, or widen it in `updateLanes`.
- A replay pays no coins, sets no records and takes no input except restart (`G.replay` checks in players, screens, input).
- Coins during play go through `setBank(n, true)` and are saved at game over or when the tab hides (`flushBank`).
- Per-frame (not per-step) work: `placeCamera`, `spinAll` (coins), `updateParts` (particles), `dressPlayer` (the animal's turn, blink and shadow blob). Gameplay never goes there.
- User-facing text goes through `t()` (keys are the English strings). Add new strings to the ES and DE tables in `js/i18n.js`.
- New module names must be unique across all modules: the offline build concatenates them into one scope.
  A module with only side effects must be imported explicitly in `js/app.js`.
- No inline `style=` or `on*=` attributes in `index.html` (CSP). Set styles through classes or `el.style`.
- Text sizes: nothing below 8px; buttons at least 32x32 (the layout test enforces this).
- A function in `js/` or `server/` that grows past 20 paths is split into named steps (ESLint fails it). Do it as in
  `sim.js` `land()`: the same checks in the same order, helpers that say when the caller returns at once.
- Two modules never import each other (`npm run deps`): pass a hook instead (players.js `onGameOver`, set by screens.js).
- Every GitHub Action is pinned to a full commit SHA (zizmor checks it); a `${{ }}` value reaches a `run:` line only
  through `env:`.
- Characters are original (Frog, Fox, Bunny, Cat, Robot). Do not copy characters from existing games.
- Keep the game playable from `hop-lanes-standalone.html` with no network: the build strips every outbound link and tag.

## Testing hooks

- `#debug-bench-replay-<code>`: the device bench in any browser: the replay plays again and again (`hopLanes.playReplay`),
  each run's frame times go to `hopLanes.benchRuns` and the corner. In any `#debug` page `hopLanes.frames` / `work` are
  the drawn-frame intervals and script times of the current play, `hopLanes.frameSummary` their p50 / p95 / worst and the
  slowest frames with their row. `hopLanes.ladder.hold()` stops the drawn frames feeding the quality ladder (the ladder
  tests feed it by hand).
- `index.html#debug` exposes `window.hopLanes` (`players`, `state`, `camRow` (settable: jump the view to a far row), `seed`, `bank`, `muted`, `drawCalls`, `view` (shadow box, haze, map size), `run` (mission stats), `record` (this run's hops), `replay`, `weather`, `laneCoins(r)`, `laneKinds()`, `kill`, `giveShield`) and shows `#fps` (drawn frames per second, draw calls, pixel ratio).
- `#replay-<code>` (or `#debug-replay-<code>`) plays a run back; smoke test 5c runs into traffic after waiting on the title, then replays it on a phone-sized screen and checks it ends on the same tick, row and cause. 5d checks the shield and the water rule (`hopLanes.kill`, `hopLanes.giveShield`).
- `#seed-42` or `#debug-seed-42` makes the world deterministic. `#shadow-basic` (alone, or after `#debug` or a seed: `#debug-shadow-basic`) draws with the old one-sample shadow map (`hopLanes.view.shadowType`).
- Tests set `localStorage['hoplanes.howto'] = '1'` before load so the first-run help does not swallow the first tap.
- Headless runs use SwiftShader; it is slow. Wait on state with `waitForFunction`, not fixed sleeps.
- `KeyW` joins / moves Player 1, `ArrowUp` Player 2. Row 1 never has trees.
- `tests/ui.test.mjs` drives the shop, prize machine, modes, share and confetti through the real DOM (ids: `#mode`, `#prize`, `#share`, `#card1 .cyc`, `#tap1`).
- Modes (`MODES`): classic, race (first to die loses), coinwar (most coins wins; `p.coins` per player), tag (the player behind hops `TAG_BOOST` faster), daily, room. `winnerOf` in sim.js decides the results screen.
- Traits (`TRAITS`, each with a `text` key for the join card): fox longer combos, bunny faster hops, cat one extra life in water (`p.lives`), robot 3 s more before the eagle (rules 4: and it shakes off its first eagle catch, `fx.trait(p, 'robot')`), pig longer magnet, penguin no ice slide, turtle one more row behind the scroll line. A replay stores the animals, so `simulate()` applies them (`p.trait` is set before `resetPlayer`). The frog has none: the saved test runs use frog and fox.
- A near miss (a car or boulder whose edge passes within `NEAR_MISS` of a hit, once per car per visit of the row: `p.nearSeen`) adds one combo, a whoosh, a view nudge and counts in `G.run.nears` (mission `nears3`).
- Hats (`HATS`): cap at an all-time best of 50, crown at 150, halo at 300, drawn on both animals from the next spawn. The daily streak (`hoplanes.streak`, `YYYY-MM-DD|n`) counts daily-mode runs on days in a row and shows in the marquee (`#streakBox`) while it is alive.
- `hopLanes.hint` (the floating hint shows), `hopLanes.hintText`, `hopLanes.playLoop` (the play loop runs), `hopLanes.playLayers`, `hopLanes.streak`, `hopLanes.biome` (the name at the camera), `hopLanes.biomeIndex(r)`, `hopLanes.zoom`, `hopLanes.slowT`.
- Lane kinds: grass, road (police variant past difficulty 0.3), river, lily (pads; water kills; no diagonal hops, so gen.js `connectRow` lines pads up with the row before), mud (from row 13; a hop out of it is slow), rail, ice (from row 25, rules 4 row 20: a sideways hop that lands on ice slides one more column the same way, unless a tree or the edge is there), bridge (from row 40, rules 4 row 30: planks over water; a plank breaks 0.6 s after a landing and is back 3 s later, `plankState`; it sinks, tilts and shakes more as it cracks, world.js `placePlanks`), rocks (from row 55, rules 4 row 40: slow boulders, a hit is a squash), spring (from row 95, rules 4 row 50: a forward hop from it flies two rows, `p.hop.high`), portal (from row 110, rules 4 row 60: `lane.portals` [a, b], land in one and you are in the other), cliff (from row 125, rules 4 row 75: stone tiles that break like planks but never come back, cause `fall`). Night fades in from row 90.
- Boss moments past row 100, one per 100-row block (rules 4: from row 50, one per 50-row block, `bossRows`), set by the chain: the boss train (first rail), the twister (first grass: `lane.twister`, one object in `lane.objs` that crosses like a car, cause `twister`) and the flood (first river: `lane.flood`, 1.5x water speed).
- Biomes (world.js `BIOMES`, colors only): meadow, desert, tundra, swamp, one per `BIOME_ROWS` (100) rows; the banner names a new one. Looks (`LOOKS` in core.js, `G.look`): desert from an all-time best of 100, night 150, tundra 200, swamp 300; they only shift the colors (or start the night), never the rules.
- Two players: the leader (row >= `LEAD_FROM`, `LEAD_GAP` rows ahead, not race or tag) hops `LEAD_SLOW` slower (`p.lead`, the label says SLOW). A magnet on a bomb row (`isBombRow`: past row 20, every 4th row; rules 4: from row 10, with 3x the power chance) is a versus bomb when both play (`isBombPower`; world.js reads `G.twoUp`, set by screens.js at join): it blocks the column in front of the other player for `BOMB_TICKS` (`fx.bomb` / `fx.unbomb`, world.js `blockColumn`). sim.js keeps the live bombs; `makeRules().reset()` (players.js `resetRules`, called on the way to the title) lifts them all.
- The first classic game is the tutorial world (`TUTORIAL_SEED` 21216: chosen for rules 4 by a search over `createWorldGen` and a look-ahead bot, at most 3 hazard rows in a row up to row 25; it was 197) with guided hints per lane ahead (app.js `hintText`) until row 20; the hint key `hoplanes.hint` ends it. Game over: slow motion (`OVER_SLOW`), a zoom (`OVER_ZOOM`) and the view slides to the fallen player; the title puts the view back.
- River edges: past `EDGE_DEATH` (5.4) a log's rider is swept away. world.js `rapids` draws that water darker with a
  white line at the edge and foam flecks; the rider gets one warning per ride past column 4.5 (the `edge` rule hook:
  `sfx.warn`, a buzz, red sparks).
- The eagle warns (`sfx.warn`) 1.5 s before it swoops; a new best shows in `#resBest`; the install hint `#install` shows only on the served page, once.
- A script error in the frame loop (or an uncaught one) shows SOMETHING BROKE / TAP TO RESTART (`crash` in app.js; the next tap or key reloads). `hopLanes.boom()` throws in the next step; `hopLanes.tune` says if the title tune plays; `hopLanes.ladder` feeds frame times to the quality ladder; `hopLanes.ghost` is the ghost's row, x and score.
- The countdown banner is keyed by `G.countKey`; clear it to force a redraw (resume from pause does). The title tune starts with the first gesture on the title (`audio()`), and the pause keys call `audio()` so a suspended context wakes.
- Power-ups: `lane.power` (shield or magnet) on grass, road and mud past row 10. A hidden coin column is `lane.secret` on grass. The boss train is `lane.boss` (first rail past each 100 rows). Weather is `weatherAt(r)` per 40-row chunk (rain; snow in December, which only changes the look).

## Gotchas

- Vehicle and character models face `-x` / `-z`; rotations were inverted once. Check the screenshot, not the math.
- The draw loop measures the screen (the median of 32 frame intervals) and in play draws every n-th screen frame, the largest n that still draws at least 60 a second (90 and 100 Hz: every frame; 120, 144, 165 Hz: every 2nd; 240 Hz: every 4th), so drawn frames stay even; the menus draw half as often again unless the screen is already at 30 Hz (iOS Low Power Mode); judge performance from drawn frames only (`watchFrameTime`).
- The quality ladder must not change `renderer.shadowMap.type`: that rebuilds every shader mid-game (a visible hitch).
  It judges each 2 s window by its mean frame time and counts frames up to 0.5 s (a longer one is a stall): a device that
  draws under 10 frames a second must still step down (the bench showed it never did).
- Vehicles, logs, trains, coins, power-ups and particles are instanced (`Inst` in `world.js`): one draw call per model.
  `inst.move()` writes only the position; `showLane()` hides a far lane's instances; `drop()` moves the last instance
  into the freed slot (slots stay packed), so never use a handle after dropping it. The paint color is a per-instance
  tint that applies only to pure white (`0xffffff`) boxes, so no other box in an instanced model may be pure white.
  Every fleet mesh carries `instanceColor` (an `InstancedBufferAttribute`), so all fleet meshes share one shader.
- `voxelMat.onBeforeCompile` sees the shader before `#include` parts are expanded: replace whole `#include <...>` lines,
  never text from inside a part (that silently matched nothing once, and every box of a car got the paint). The
  replacement mirrors r186's `color_vertex` (`vColor` is a vec4): check it again after a Three.js upgrade.
- Light intensities are physical (r155+): the values are the old ones times PI.
- Every geometry drawn with `voxelMat` needs the `ao` attribute (bottom-of-box shade); `mergeBoxes` and `joinGeos` add
  it. A geometry without it reads 0 and draws black. A box's 8th value is a night glow (headlights): `ao` above 1,
  scaled by the `glow` uniform that `setNight` sets.
- The shadow box and the haze (`scene.fog`) are fitted to the visible ground in `fitView()` on every resize.
- Lane ground is joined into 8-row chunks (`CHUNK`) once all 8 rows exist, in the next drawn frame (`mergePending`, one chunk a frame, never in a game step; `resetWorld` joins all at once): one mesh that casts shadows, one that does not.
  The lane keeps its own ground mesh (out of the scene while merged); a dropped row stays in the chunk (it is off
  screen) and the chunk is freed with its last row (`releaseChunk`), so no mesh is rebuilt while scrolling.
  Anything added to `lane.ground` after the lane is built will not show while the chunk is merged.
- Rail signals and police lights are one `light` fleet (`newLight`), painted per instance (`LIGHT_TINT`); repaint only
  on a state change (`paintSignal`, `o.lightRed`).
- Every device uses `PCFShadowMap` (the GPU compares and filters the depth texture r186 keeps shadows in; r186 removed
  `PCFSoftShadowMap`), a 512 shadow map on phones and 1024 on desktops, `sun.shadow.bias` -0.0004 and a `normalBias` of
  1.5 shadow texels (`fitShadowBias`, refitted with the view and the map size). Phones used `BasicShadowMap` (one plain
  read of the depth texture): on an iPhone that drew stair-stepped shadow edges and a mottled, self-shadowed ground;
  `#shadow-basic` brings it back for an A/B check. Chosen once at boot. The quality ladder retries a rung that helped
  (pixel ratio 2 → 1.5 → 1.25 → 1.0; phones with a dense screen start at 2, everything else at 1.5; then the shadow map size; last, shadows every other drawn frame in play too, `shadowHalf`); the lowered setting stays for the next game (`hoplanes.ratio`), and every rung may be tried again (`resetFrameWatch`). On the menus the shadow map is redrawn every other frame (`shadowCadence`).
- The window of built rows follows `visRows` (fewer rows on a sideways phone): `rowsBehind()` and the ahead limit in
  `ensureLanes`.
- `near()`, `visRows` and `firstNeededRow()` decide which rows exist and sound; keep them in step with the camera.
- Bridge planks keep `breakAt` / `backAt` in world ticks on the lane (rules.js `plankState`), so their state is a function of
  `G.worldTick` like traffic: never step them per frame. New late kinds must weigh 0 below their first row in `nextLaneKind`, or
  every existing world (and saved replay) changes.
- Don't add a service worker: the CSP has `worker-src 'none'` and the PWA installs without one.
