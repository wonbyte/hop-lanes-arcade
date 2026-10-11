# Hop Lanes Arcade

A two-player, arcade-style lane-crossing game in one HTML file (Three.js voxel graphics).
Frog (Player 1, blue) vs Fox (Player 2, red). Hop across roads, rivers and train tracks.
Go too slow and the screen leaves you behind.

## Play

- `index.html` loads Three.js and two fonts from a CDN each time, so it needs internet.
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

`hop-lanes-standalone.html` is generated. Rebuild it after every change to `index.html`
(needs `npm`, `python3` and access to the npm registry):

```sh
./tools/build-standalone.sh
```

Third-party licenses: see `THIRD_PARTY_NOTICES.md`.
