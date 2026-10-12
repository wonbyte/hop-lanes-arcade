# Hop Lanes: notes for Claude Code and other contributors

A two-player voxel lane-crossing game. Plain HTML, CSS and ES modules on Three.js r128. No framework, no bundler
except the small offline build script. Keep it that way.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs Playwright and Three.js (test and build only; the game itself has no dependencies) |
| `npm test` | Syntax check, then `tests/smoke.test.mjs`, `tests/layout.test.mjs`, `tests/scores-server.test.mjs` (~5 min) |
| `npm run check` | Syntax check only (fast) |
| `npm run build` | Regenerates `hop-lanes-standalone.html`. Needs `python3` and npm registry access. CI fails if this file is stale |
| `npm run icons` | Regenerates `icons/` from the frog pixel art (needs Pillow) |
| `npm run scores` | Starts the optional score server (`server/`) |

Run `npm test` and `npm run build` before every commit. Commit the rebuilt `hop-lanes-standalone.html` with the change.

## Layout

| Path | Role |
|---|---|
| `index.html` | Markup only. The Content-Security-Policy meta is strict: no inline scripts or styles, Three.js only from its exact CDN URL |
| `css/style.css` | All styles. Media queries: `max-width: 520px` (phones), `max-width: 340px` (tiny phones), `orientation: landscape` (phone held sideways) |
| `js/main.js` | Entry. Checks `window.THREE`, then `import('./app.js')` |
| `js/core.js` | Tuning constants, the shared state object `G`, `fail()`, `#debug` / `#seed-N` hash parsing |
| `js/storage.js` | localStorage: best scores, coins (`G.bank`), owned characters, picks. Always best effort (try/catch) |
| `js/audio.js` | Web Audio beeps (`sfx.*`), mute |
| `js/device.js` | Vibration, wake lock |
| `js/voxel.js` | `mergeBoxes`: a list of boxes becomes one vertex-colored mesh (one draw call). `cachedGeo` for repeated models |
| `js/models.js` | Colors, pixel portraits (`PIX`), box lists for every model, `CHARACTERS` (name, price) |
| `js/gfx.js` | Renderer, camera, light, `resize()`, the adaptive quality ladder (`watchFrameTime`) |
| `js/world.js` | Lanes: `LANE_BUILDERS` per kind, traffic, trains, coins, seeded RNG. Lanes are a `Map` by row |
| `js/players.js` | Spawn, `tryMove`, hop/land/stand, hazards, deaths, coin pickup, the eagle |
| `js/screens.js` | Join cards and shop, countdown, results, restart, pause, first-run help, online score post |
| `js/input.js` | Keyboard, on-screen buttons, taps and swipes on the field. Side-effect only (imported by `app.js` for that) |
| `js/app.js` | The frame loop, the `window.hopLanes` test hook, boot |
| `tools/build-standalone.sh` | Inlines CSS, the modules (in `tools/bundle-order.json` order), Three.js and fonts into one offline HTML with a hash-based CSP |
| `tests/serve.mjs` | Tiny static server for the tests: browsers refuse ES modules from `file://` |
| `server/` | Optional dependency-free score server; wired by `<meta name="hop-lanes-scores">` |

## Conventions

- Shared mutable state goes in `G` (`js/core.js`). Modules never assign to an imported binding.
- Every model is a list of `[w, h, d, color, x, y, z]` boxes (y = bottom). Characters face `-z` (forward).
- World generation uses `worldRng` (seeded). Effects use `fxRand` / `Math.random`, so seeds stay stable.
- New module names must be unique across all modules: the offline build concatenates them into one scope.
  A module with only side effects must be imported explicitly in `js/app.js`.
- No inline `style=` or `on*=` attributes in `index.html` (CSP). Set styles through classes or `el.style`.
- Text sizes: nothing below 8px; buttons at least 32x32 (the layout test enforces this).
- Characters are original (Frog, Fox, Bunny, Cat, Robot). Do not copy characters from existing games.
- Keep the game playable from `hop-lanes-standalone.html` with no network: the build strips every outbound link and tag.

## Testing hooks

- `index.html#debug` exposes `window.hopLanes` (`players`, `state`, `camRow`, `seed`, `bank`, `muted`, `laneCoins(r)`, `laneKinds()`).
- `#seed-42` or `#debug-seed-42` makes the world deterministic.
- Tests set `localStorage['hoplanes.howto'] = '1'` before load so the first-run help does not swallow the first tap.
- Headless runs use SwiftShader; it is slow. Wait on state with `waitForFunction`, not fixed sleeps.
- `KeyW` joins / moves Player 1, `ArrowUp` Player 2. Row 1 never has trees.

## Gotchas

- Vehicle and character models face `-x` / `-z`; rotations were inverted once. Check the screenshot, not the math.
- The draw loop caps at 60 draws/s on fast screens; judge performance from drawn frames only (`watchFrameTime`).
- The quality ladder must not change `renderer.shadowMap.type`: that rebuilds every shader mid-game (a visible hitch).
- `near()`, `visRows` and `firstNeededRow()` decide which rows exist and sound; keep them in step with the camera.
- Don't add a service worker: the CSP has `worker-src 'none'` and the PWA installs without one.
