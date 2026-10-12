# Hop Lanes Arcade

A two-player, arcade-style lane-crossing game (Three.js voxel graphics).
Frog (Player 1, blue) vs Fox (Player 2, red). Hop across roads, rivers and train tracks.
Go too slow and the screen leaves you behind.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: markup only |
| `css/style.css` | All styles |
| `js/main.js` | Entry point: checks for Three.js, then loads `js/app.js` |
| `js/*.js` | ES modules: `core` (constants, shared state), `storage`, `audio`, `device`, `voxel`, `models`, `gfx`, `world`, `players`, `screens`, `input`, `app` (loop) |
| `fonts/` | Press Start 2P and Rubik (Latin subset) with their licenses |
| `hop-lanes-standalone.html` | Generated: everything above plus Three.js and fonts in one offline file |

## Play

- `index.html` loads Three.js from a CDN, so it needs internet, and it must be served by a web server
  (browsers do not load ES modules from a file opened directly). For a quick local server: `npx serve .` or `python3 -m http.server`.
- `hop-lanes-standalone.html` has everything built in and plays offline (for example in a phone's file viewer).

| Action | Player 1 | Player 2 |
|---|---|---|
| Hop forward | `W` or blue **TAP** | `↑` or red **TAP** |
| Left / right | `A` / `D` or ◀ ▶ | `←` / `→` or ◀ ▶ |
| Back | `S` | `↓` |

On a touch screen, tap the game to hop and swipe to move. With two players, the left half
of the screen is Player 1 and the right half is Player 2.

- Join: press your TAP (or tap your half of the screen). A 3-second countdown starts; the other player can join during it.
- `Space` / `Enter` / **START**: join as Player 1, or skip the countdown.
- Game over: press TAP (or tap the screen) to play again.
- Score = rows advanced. All-time and daily best scores are saved in the browser.

## Coins, animals and the eagle

- Coins lie on the grass and the roads. Land on one to collect it. Coins are kept between games.
- Each join card has ◀ ▶ arrows to pick an animal. Frog and Fox are free; Bunny (30), Cat (60) and Robot (100)
  are bought with coins: pick one and press TAP.
- Stand still for 6 seconds and the eagle carries you away.
- `P` or `Escape` pauses; the game also pauses by itself when you switch apps. `M` or the SOUND button mutes.
- The first visit shows a short how-to-play card.

## Install as an app

Served from a web server (not opened as a file), the page can be added to a phone's home screen
(`manifest.webmanifest`, icons in `icons/`). Regenerate the icons with `npm run icons`.

## Online best scores (optional)

`server/scores.mjs` is a small dependency-free score server (`npm run scores`). To use it, put its URL in
`<meta name="hop-lanes-scores" content="https://your-server/scores">` in `index.html` and add the server origin
to `connect-src` in the Content-Security-Policy meta. See `server/README.md`. The offline build never sends scores.

## Offline build

`hop-lanes-standalone.html` is generated. It bundles the modules in the order of `tools/bundle-order.json`. Rebuild it after every change to `index.html`, `css/`, `js/` or `fonts/`
(needs `npm`, `python3` and access to the npm registry):

```sh
./tools/build-standalone.sh
```

## Tests

```sh
npm install
npm test        # syntax check, Playwright smoke + layout tests, score-server tests (about 5 minutes)
```

GitHub Actions runs the tests on every push and checks that `hop-lanes-standalone.html` is up to date.

## Seeds and debug

- `index.html#seed-42` builds the same world every game (any whole number works).
- `index.html#debug` exposes `window.hopLanes` for tests; `#debug-seed-42` does both.

Third-party licenses: see `THIRD_PARTY_NOTICES.md`.
