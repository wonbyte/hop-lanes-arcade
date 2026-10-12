# Hop Lanes Arcade

A two-player, arcade-style lane-crossing game (Three.js voxel graphics).
Frog (Player 1, blue) vs Fox (Player 2, red). Hop across roads, rivers and train tracks.
Go too slow and the screen leaves you behind.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: markup only |
| `css/style.css` | All styles |
| `js/game.js` | All game logic (needs Three.js r128 loaded first) |
| `fonts/` | Press Start 2P and Rubik (Latin subset) with their licenses |
| `hop-lanes-standalone.html` | Generated: everything above plus Three.js and fonts in one offline file |

## Play

- `index.html` loads Three.js from a CDN, so it needs internet. The fonts come from `fonts/`.
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

## Offline build

`hop-lanes-standalone.html` is generated. Rebuild it after every change to `index.html`, `css/`, `js/` or `fonts/`
(needs `npm`, `python3` and access to the npm registry):

```sh
./tools/build-standalone.sh
```

## Tests

```sh
npm install
npm test        # Playwright smoke tests (about 3 minutes; Three.js is served from node_modules)
```

GitHub Actions runs the tests on every push and checks that `hop-lanes-standalone.html` is up to date.

## Seeds and debug

- `index.html#seed-42` builds the same world every game (any whole number works).
- `index.html#debug` exposes `window.hopLanes` for tests; `#debug-seed-42` does both.

Third-party licenses: see `THIRD_PARTY_NOTICES.md`.
