# Hop Lanes: notes for Claude Code and other contributors

A two-player voxel lane-crossing game. Plain HTML, CSS and ES modules on Three.js r186. No framework, no bundler
except the small offline build script. Keep it that way.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs Playwright and Three.js (test and build only; the game itself has no dependencies) |
| `npm test` | Syntax check, `tests/rules.test.mjs`, `tests/replay.test.mjs` and `tests/sim.test.mjs` (pure code, instant), then the browser tests `smoke`, `layout`, `ui` and `scores-server` (~6 min) |
| `npm run check` | Syntax check only (fast) |
| `npm run build` | Regenerates `hop-lanes-standalone.html` (python3 + the pinned esbuild, minified, no network). Fails over 800 KB. CI fails if this file is stale |
| `npm run build:three` | Regenerates `vendor/three.min.js` with esbuild from `tools/three-entry.js` (the Three.js names the game uses). CI fails if stale |
| `npm run icons` | Regenerates `icons/` from the frog pixel art (needs Pillow) |
| `npm run scores` | Starts the optional score server (`server/`) |

Run `npm test` and `npm run build` before every commit. Commit the rebuilt `hop-lanes-standalone.html` with the change.

## Layout

| Path | Role |
|---|---|
| `index.html` | Markup only. The Content-Security-Policy meta is strict: `script-src 'self'`, no inline scripts or styles. A `modulepreload` link per module (add one for a new module) |
| `vendor/three.min.js` | Generated: a tree-shaken Three.js r186 (about 530 KB) exposing only the names the game uses as `window.THREE`. Add a name to `tools/three-entry.js` before using a new THREE class |
| `css/style.css` | All styles. Media queries: `max-width: 520px` (phones), `max-width: 340px` (tiny phones), `orientation: landscape` (phone held sideways) |
| `js/main.js` | Entry. Checks `window.THREE`, then `import('./app.js')` |
| `js/rules.js` | Pure rules with no DOM or Three.js: the tuning constants that decide a run (`STEP`, `TICKS_PER_S`, `MAX_RUN_TICKS`, `HOP_TIME`, `PLAY_HALF`, `CAM_CREEP*`, `LEAD_*`, `BOMB_TICKS`, `SPRING_HOP`...), seeded RNG, `dailySeedFor(day)` (the daily world's seed, shared with the score server), `nextLaneKind`, `hopTarget`, `hopTime` (mud), `isBombRow`, `MODES`, `TRAITS` (each animal's edge, `traitOf`), `HATS` (`hatFor(best)`), `isoDay` (the local YYYY-MM-DD), `isoWeek`, the daily streak (`streakAfter`). Tested by node directly: put logic here when it needs no scene |
| `js/gen.js` | Pure: the world as data. `createWorldGen(seed).lane(r)`: kind (the chain of `nextLaneKind`), direction, speed, cars and logs (`x0`), trees, pads, coins, power-ups, the train schedule (`railStep`), plus the looks drawn from the same rng. `trafficX` (where a car or log is at world time w). `connectRow` makes sure every row gives a way forward (`standColumns` / `standGroups`: each group of columns a player can stand on in the row before gets a straight hop: a pad over a pad, a plank, a felled tree); its draws come after the row's own. The rng draw order here is the world: never reorder a draw |
| `js/sim.js` | Pure: the rules of a run. `makeRules(W)` (hops, logs, hazards, shield, eagle, near misses, the traits, tag mode, the leader slowdown `p.lead`, spring hops `p.hop.high`, portals, cliff tiles, the twister, the versus bomb; players.js calls it with effect hooks), `createSim(replay)` (stepping, countdown included), `simulate(replay)` (to game over: score, ticks, row, cause, coins) and `winnerOf(players, mode)`. The score server runs it (`VERIFY=1`) |
| `js/missions.js` | Pure: the mission list and the done/advance logic, plus the daily missions (`DAILY`, `dailyMissions(day)`: three a day seeded from the date, paid once, `hoplanes.dailydone`) (`tests/replay.test.mjs`) |
| `js/replay.js` | Pure: `encodeReplay` / `decodeReplay` for `#replay-<code>` links |
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
| `js/ghost.js` | The ghost: in daily and room modes the best run on this world (`hoplanes.ghost.<seed>`: score, hero, time, replay code; newest 6 worlds kept) is replayed by `createSim` one step per game step and drawn see-through (`ghostMat`); `saveGhost` at game over, `startGhost` at play, `stopGhost` on the title |
| `js/screens.js` | Join cards and shop, title menu (modes incl. room code, prize machine, handicap, language, missions), countdown, results (share, replay link, confetti), restart, pause, first-run help, online score post |
| `js/panels.js` | The dialogs (`.dialog` in CSS, one open at a time: `openDialog`/`closeDialog`, Escape closes): SETTINGS (sound, vibration `hoplanes.buzz`, language, handicap, less motion `hoplanes.motion`, read at boot by `gfx.js`, the look `#look`: cycles the looks the all-time best unlocked, `LOOKS` in core.js), the pause menu (`#pauseBox`, shown by `pauseGame`), TOP 10 (`#board`; `#boardScope` cycles this device / all time / today / this week; the online scopes only with a score server; a `.watch` button reloads the page as that entry's replay), photo mode (`#snapBtn` in the pause menu: the field with the score drawn on it, shared as a file or downloaded as `hop-lanes.png`), and the screen-reader announcer (`#live`, `announceFrame` per frame). Listens for `hoplanes:lang` and `hoplanes:pause` events from screens.js |
| `js/input.js` | Keyboard, on-screen buttons, taps and swipes on the field, `pollGamepads()`. Side-effect only (imported by `app.js` for that) |
| `js/app.js` | The frame loop (fixed `STEP` of 1/120 s), the `window.hopLanes` test hook, replay boot, the first-run guided hints (`placeHint`, `hintText`, `hoplanes.hint`), the near-miss view nudge (`G.shakeT`), the landing dip (`G.landT`), the game-over show (`overFx`: slow motion `G.slowT`, zoom, the view slides to `G.lastDead`), the biome banner |
| `tools/build-standalone.sh` | Inlines CSS, the modules (in `tools/bundle-order.json` order, minified with esbuild), `vendor/three.min.js` and fonts into one offline HTML with a hash-based CSP |
| `.github/workflows/ci.yml` | Runs the tests and the stale-build checks on every push and pull request |
| `.github/workflows/deploy.yml` | Deploys `main` to GitHub Pages after the tests pass (Settings → Pages → Source: GitHub Actions, once) |
| `tests/serve.mjs` | Tiny static server for the tests: browsers refuse ES modules from `file://` |
| `tests/browser.mjs` | The shared browser-test helpers: `launch`, `open(browser, url, opts)`, `waitState`, and the waits on the game's own clock (`settle`, `waitTicks`, `hopKey`): never a fixed sleep |
| `server/` | Optional dependency-free score server; wired by `<meta name="hop-lanes-scores">` (and `hop-lanes-token` for its `POST_TOKEN`). Set `TRUST_PROXY=1` behind a proxy (only a real IP in `X-Forwarded-For` is trusted). `VERIFY_BUDGET_MS` caps the replay CPU per minute (503 past it), `GET_RATE_MAX` throttles reads; the top lists are cached until the next post. UI test 6b runs it against the real page (`tests/serve.mjs` overrides `/index.html` with the meta and `connect-src` filled in) |

## Conventions

- Game rules live in rules/gen/sim; world.js and players.js only render them. Anything that changes the outcome of a
  run goes there (tested by node), so the score server's `simulate()` and the browser can never disagree. Smoke test 5c
  checks a browser replay against `simulate()`; `tests/sim.test.mjs` holds runs the browser played.
- Shared mutable state goes in `G` (`js/core.js`). Modules never assign to an imported binding.
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
- Characters are original (Frog, Fox, Bunny, Cat, Robot). Do not copy characters from existing games.
- Keep the game playable from `hop-lanes-standalone.html` with no network: the build strips every outbound link and tag.

## Testing hooks

- `index.html#debug` exposes `window.hopLanes` (`players`, `state`, `camRow` (settable: jump the view to a far row), `seed`, `bank`, `muted`, `drawCalls`, `view` (shadow box, haze, map size), `run` (mission stats), `record` (this run's hops), `replay`, `weather`, `laneCoins(r)`, `laneKinds()`, `kill`, `giveShield`) and shows `#fps` (drawn frames per second, draw calls, pixel ratio).
- `#replay-<code>` (or `#debug-replay-<code>`) plays a run back; smoke test 5c runs into traffic after waiting on the title, then replays it on a phone-sized screen and checks it ends on the same tick, row and cause. 5d checks the shield and the water rule (`hopLanes.kill`, `hopLanes.giveShield`).
- `#seed-42` or `#debug-seed-42` makes the world deterministic.
- Tests set `localStorage['hoplanes.howto'] = '1'` before load so the first-run help does not swallow the first tap.
- Headless runs use SwiftShader; it is slow. Wait on state with `waitForFunction`, not fixed sleeps.
- `KeyW` joins / moves Player 1, `ArrowUp` Player 2. Row 1 never has trees.
- `tests/ui.test.mjs` drives the shop, prize machine, modes, share and confetti through the real DOM (ids: `#mode`, `#prize`, `#share`, `#card1 .cyc`, `#tap1`).
- Modes (`MODES`): classic, race (first to die loses), coinwar (most coins wins; `p.coins` per player), tag (the player behind hops `TAG_BOOST` faster), daily, room. `winnerOf` in sim.js decides the results screen.
- Traits (`TRAITS`, each with a `text` key for the join card): fox longer combos, bunny faster hops, cat one extra life in water (`p.lives`), robot 3 s more before the eagle, pig longer magnet, penguin no ice slide, turtle one more row behind the scroll line. A replay stores the animals, so `simulate()` applies them (`p.trait` is set before `resetPlayer`). The frog has none: the saved test runs use frog and fox.
- A near miss (a car or boulder whose edge passes within `NEAR_MISS` of a hit, once per car per visit of the row: `p.nearSeen`) adds one combo, a whoosh, a view nudge and counts in `G.run.nears` (mission `nears3`).
- Hats (`HATS`): cap at an all-time best of 100, crown at 250, halo at 500, drawn on both animals from the next spawn. The daily streak (`hoplanes.streak`, `YYYY-MM-DD|n`) counts daily-mode runs on days in a row and shows in the marquee (`#streakBox`) while it is alive.
- `hopLanes.hint` (the floating hint shows), `hopLanes.hintText`, `hopLanes.playLoop` (the play loop runs), `hopLanes.playLayers`, `hopLanes.streak`, `hopLanes.biome` (the name at the camera), `hopLanes.biomeIndex(r)`, `hopLanes.zoom`, `hopLanes.slowT`.
- Lane kinds: grass, road (police variant past difficulty 0.3), river, lily (pads; water kills; no diagonal hops, so gen.js `connectRow` lines pads up with the row before), mud (from row 13; a hop out of it is slow), rail, ice (from row 25: a sideways hop that lands on ice slides one more column the same way, unless a tree or the edge is there), bridge (from row 40: planks over water; a plank breaks 0.6 s after a landing and is back 3 s later, `plankState`), rocks (from row 55: slow boulders, a hit is a squash), spring (from row 95: a forward hop from it flies two rows, `p.hop.high`), portal (from row 110: `lane.portals` [a, b], land in one and you are in the other), cliff (from row 125: stone tiles that break like planks but never come back, cause `fall`). Night fades in from row 90.
- Boss moments past row 100, one per 100-row block, set by the chain: the boss train (first rail), the twister (first grass: `lane.twister`, one object in `lane.objs` that crosses like a car, cause `twister`) and the flood (first river: `lane.flood`, 1.5x water speed).
- Biomes (world.js `BIOMES`, colors only): meadow, desert, tundra, swamp, one per `BIOME_ROWS` (100) rows; the banner names a new one. Looks (`LOOKS` in core.js, `G.look`): desert from an all-time best of 100, night 150, tundra 200, swamp 300; they only shift the colors (or start the night), never the rules.
- Two players: the leader (row >= `LEAD_FROM`, `LEAD_GAP` rows ahead, not race or tag) hops `LEAD_SLOW` slower (`p.lead`, the label says SLOW). A magnet on a bomb row (`isBombRow`: past row 20, every 4th row) is a versus bomb when both play (`isBombPower`; world.js reads `G.twoUp`, set by screens.js at join): it blocks the column in front of the other player for `BOMB_TICKS` (`fx.bomb` / `fx.unbomb`, world.js `blockColumn`). sim.js keeps the live bombs; `makeRules().reset()` (players.js `resetRules`, called on the way to the title) lifts them all.
- The first classic game is the tutorial world (`TUTORIAL_SEED` 197) with guided hints per lane ahead (app.js `hintText`) until row 12; the hint key `hoplanes.hint` ends it. Game over: slow motion (`OVER_SLOW`), a zoom (`OVER_ZOOM`) and the view slides to the fallen player; the title puts the view back.
- The eagle warns (`sfx.warn`) 1.5 s before it swoops; a new best shows in `#resBest`; the install hint `#install` shows only on the served page, once.
- A script error in the frame loop (or an uncaught one) shows SOMETHING BROKE / TAP TO RESTART (`crash` in app.js; the next tap or key reloads). `hopLanes.boom()` throws in the next step; `hopLanes.tune` says if the title tune plays; `hopLanes.ladder` feeds frame times to the quality ladder; `hopLanes.ghost` is the ghost's row, x and score.
- The countdown banner is keyed by `G.countKey`; clear it to force a redraw (resume from pause does). The title tune starts with the first gesture on the title (`audio()`), and the pause keys call `audio()` so a suspended context wakes.
- Power-ups: `lane.power` (shield or magnet) on grass, road and mud past row 10. A hidden coin column is `lane.secret` on grass. The boss train is `lane.boss` (first rail past each 100 rows). Weather is `weatherAt(r)` per 40-row chunk (rain; snow in December, which only changes the look).

## Gotchas

- Vehicle and character models face `-x` / `-z`; rotations were inverted once. Check the screenshot, not the math.
- The draw loop caps at 60 draws/s on fast screens and skips every other frame on the menus unless the screen is already at 30 Hz (iOS Low Power Mode); judge performance from drawn frames only (`watchFrameTime`).
- The quality ladder must not change `renderer.shadowMap.type`: that rebuilds every shader mid-game (a visible hitch).
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
- Lane ground is joined into 8-row chunks (`CHUNK`) once all 8 rows exist: one mesh that casts shadows, one that does not.
  The lane keeps its own ground mesh (out of the scene while merged); a dropped row stays in the chunk (it is off
  screen) and the chunk is freed with its last row (`releaseChunk`), so no mesh is rebuilt while scrolling.
  Anything added to `lane.ground` after the lane is built will not show while the chunk is merged.
- Rail signals and police lights are one `light` fleet (`newLight`), painted per instance (`LIGHT_TINT`); repaint only
  on a state change (`paintSignal`, `o.lightRed`).
- Phones use `BasicShadowMap` (hard edges, one shadow read per pixel) and a 512 shadow map; desktops `PCFShadowMap`
  (r186 removed `PCFSoftShadowMap`) and 1024. Chosen once at boot. The quality ladder retries a rung that helped
  (pixel ratio 2 → 1.5 → 1.25 → 1.0; phones with a dense screen start at 2, everything else at 1.5; then the shadow map size; last, shadows every other drawn frame in play too, `shadowHalf`); the lowered setting stays for the next game (`hoplanes.ratio`), and every rung may be tried again (`resetFrameWatch`). On the menus the shadow map is redrawn every other frame (`shadowCadence`).
- The window of built rows follows `visRows` (fewer rows on a sideways phone): `rowsBehind()` and the ahead limit in
  `ensureLanes`.
- `near()`, `visRows` and `firstNeededRow()` decide which rows exist and sound; keep them in step with the camera.
- Bridge planks keep `breakAt` / `backAt` in world ticks on the lane (rules.js `plankState`), so their state is a function of
  `G.worldTick` like traffic: never step them per frame. New late kinds must weigh 0 below their first row in `nextLaneKind`, or
  every existing world (and saved replay) changes.
- Don't add a service worker: the CSP has `worker-src 'none'` and the PWA installs without one.
