# Hop Lanes: notes for Claude Code and other contributors

A two-player voxel lane-crossing game. Plain HTML, CSS and ES modules on Three.js r128. No framework, no bundler
except the small offline build script. Keep it that way.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs Playwright and Three.js (test and build only; the game itself has no dependencies) |
| `npm test` | Syntax check, `tests/rules.test.mjs` (pure rules, instant), then the browser tests `smoke`, `layout`, `ui` and `scores-server` (~5 min) |
| `npm run check` | Syntax check only (fast) |
| `npm run build` | Regenerates `hop-lanes-standalone.html` (python3, no network). Fails over 800 KB. CI fails if this file is stale |
| `npm run build:three` | Regenerates `vendor/three.min.js` with esbuild from `tools/three-entry.js` (the Three.js names the game uses). CI fails if stale |
| `npm run icons` | Regenerates `icons/` from the frog pixel art (needs Pillow) |
| `npm run scores` | Starts the optional score server (`server/`) |

Run `npm test` and `npm run build` before every commit. Commit the rebuilt `hop-lanes-standalone.html` with the change.

## Layout

| Path | Role |
|---|---|
| `index.html` | Markup only. The Content-Security-Policy meta is strict: `script-src 'self'`, no inline scripts or styles |
| `vendor/three.min.js` | Generated: a tree-shaken Three.js r128 (501 KB) exposing only the names the game uses as `window.THREE`. Add a name to `tools/three-entry.js` before using a new THREE class |
| `css/style.css` | All styles. Media queries: `max-width: 520px` (phones), `max-width: 340px` (tiny phones), `orientation: landscape` (phone held sideways) |
| `js/main.js` | Entry. Checks `window.THREE`, then `import('./app.js')` |
| `js/rules.js` | Pure rules with no DOM or Three.js: seeded RNG, `nextLaneKind`, `hopTarget`, `hopTime` (mud). Tested by node directly: put logic here when it needs no scene |
| `js/missions.js` | Pure: the mission list and the done/advance logic (`tests/replay.test.mjs`) |
| `js/replay.js` | Pure: `encodeReplay` / `decodeReplay` for `#replay-<code>` links |
| `js/i18n.js` | `t(key, args)`: English keys, Spanish and German tables; `data-i18n` for static markup; `#lang` cycles |
| `js/core.js` | Tuning constants, the shared state object `G`, `fail()`, `#debug` / `#seed-N` hash parsing |
| `js/storage.js` | localStorage: best scores, coins (`G.bank`), owned characters, picks. Always best effort (try/catch) |
| `js/audio.js` | Web Audio beeps (`sfx.*`), mute |
| `js/device.js` | Vibration, wake lock |
| `js/voxel.js` | `mergeBoxes`: a list of boxes becomes one vertex-colored mesh (one draw call). `cachedGeo` for repeated models |
| `js/models.js` | Colors, pixel portraits (`PIX`), box lists for every model, `CHARACTERS` (name, price) |
| `js/gfx.js` | Renderer, camera, light, `resize()`, the adaptive quality ladder (`watchFrameTime`) |
| `js/world.js` | Lanes: `LANE_BUILDERS` per kind, traffic, trains, coins, the instanced fleet (`Inst`). Lanes are a `Map` by row |
| `js/players.js` | Spawn, queued moves (`queueMove` / `applyMoves`, the replay feed), `tryMove`, hop/land/stand, hazards, deaths, coins, combo, shield and magnet power-ups, the eagle |
| `js/screens.js` | Join cards and shop, title menu (modes incl. room code, prize machine, handicap, language, missions), countdown, results (share, replay link, confetti), restart, pause, first-run help, online score post |
| `js/input.js` | Keyboard, on-screen buttons, taps and swipes on the field, `pollGamepads()`. Side-effect only (imported by `app.js` for that) |
| `js/app.js` | The frame loop (fixed `STEP` of 1/120 s), the `window.hopLanes` test hook, replay boot |
| `tools/build-standalone.sh` | Inlines CSS, the modules (in `tools/bundle-order.json` order), `vendor/three.min.js` and fonts into one offline HTML with a hash-based CSP |
| `.github/workflows/deploy.yml` | Deploys `main` to GitHub Pages after the tests pass (Settings → Pages → Source: GitHub Actions, once) |
| `tests/serve.mjs` | Tiny static server for the tests: browsers refuse ES modules from `file://` |
| `server/` | Optional dependency-free score server; wired by `<meta name="hop-lanes-scores">` (and `hop-lanes-token` for its `POST_TOKEN`) |

## Conventions

- Shared mutable state goes in `G` (`js/core.js`). Modules never assign to an imported binding.
- Every model is a list of `[w, h, d, color, x, y, z]` boxes (y = bottom). Characters face `-z` (forward).
- World generation uses `worldRng` (seeded). Effects use `fxRand` / `Math.random`, so seeds stay stable.
- The game steps at a fixed rate (`STEP`) and hops are queued to step boundaries, so replays are exact. Anything that
  changes the outcome of a run must be deterministic: seeded (`worldRng`, per-lane `lane.rng` for trains) or step-driven.
- User-facing text goes through `t()` (keys are the English strings). Add new strings to the ES and DE tables in `js/i18n.js`.
- New module names must be unique across all modules: the offline build concatenates them into one scope.
  A module with only side effects must be imported explicitly in `js/app.js`.
- No inline `style=` or `on*=` attributes in `index.html` (CSP). Set styles through classes or `el.style`.
- Text sizes: nothing below 8px; buttons at least 32x32 (the layout test enforces this).
- Characters are original (Frog, Fox, Bunny, Cat, Robot). Do not copy characters from existing games.
- Keep the game playable from `hop-lanes-standalone.html` with no network: the build strips every outbound link and tag.

## Testing hooks

- `index.html#debug` exposes `window.hopLanes` (`players`, `state`, `camRow` (settable: jump the view to a far row), `seed`, `bank`, `muted`, `drawCalls`, `run` (mission stats), `record` (this run's hops), `replay`, `weather`, `laneCoins(r)`, `laneKinds()`).
- `#replay-<code>` (or `#debug-replay-<code>`) plays a run back; smoke test 5c checks the replay ends where the run did.
- `#seed-42` or `#debug-seed-42` makes the world deterministic.
- Tests set `localStorage['hoplanes.howto'] = '1'` before load so the first-run help does not swallow the first tap.
- Headless runs use SwiftShader; it is slow. Wait on state with `waitForFunction`, not fixed sleeps.
- `KeyW` joins / moves Player 1, `ArrowUp` Player 2. Row 1 never has trees.
- `tests/ui.test.mjs` drives the shop, prize machine, modes, share and confetti through the real DOM (ids: `#mode`, `#prize`, `#share`, `#card1 .cyc`, `#tap1`).
- Lane kinds: grass, road (police variant past difficulty 0.3), river, lily (pads; water kills), mud (from row 13; a hop out of it is slow), rail. Night fades in from row 90.
- The eagle warns (`sfx.warn`) 1.5 s before it swoops; a new best shows in `#resBest`; the install hint `#install` shows only on the served page, once.
- Power-ups: `lane.power` (shield or magnet) on grass, road and mud past row 10. A hidden coin column is `lane.secret` on grass. The boss train is `lane.boss` (first rail past each 100 rows). Weather is `weatherAt(r)` per 40-row chunk (rain; snow in December).

## Gotchas

- Vehicle and character models face `-x` / `-z`; rotations were inverted once. Check the screenshot, not the math.
- The draw loop caps at 60 draws/s on fast screens; judge performance from drawn frames only (`watchFrameTime`).
- The quality ladder must not change `renderer.shadowMap.type`: that rebuilds every shader mid-game (a visible hitch).
- Vehicles, logs and trains are instanced (`Inst` in `world.js`): one draw call per model. The paint color is a per-instance
  tint that applies only to pure white (`0xffffff`) boxes, so no other box in an instanced model may be pure white.
  Every fleet mesh carries `instanceColor`: r128 picks the shader per material, so a mesh without it would crash.
- `near()`, `visRows` and `firstNeededRow()` decide which rows exist and sound; keep them in step with the camera.
- Don't add a service worker: the CSP has `worker-src 'none'` and the PWA installs without one.
