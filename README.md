# Hop Lanes Arcade

A two-player, arcade-style lane-crossing game in one HTML file (Three.js voxel graphics).
Frog (Player 1, blue) vs Fox (Player 2, red). Hop across roads, rivers and train tracks.
Go too slow and the screen leaves you behind.

## Play

Open `index.html` in a browser. It needs internet once to load Three.js and the font.

| Action | Player 1 | Player 2 |
|---|---|---|
| Hop forward | `W` or blue **TAP** | `↑` or red **TAP** |
| Left / right | `A` / `D` or ◀ ▶ | `←` / `→` or ◀ ▶ |
| Back | `S` | `↓` |

- Press a player's TAP to join. A 3-second countdown starts; the other player can join during it.
- `Space` / **START** skips the countdown.
- Score = rows advanced. All-time and daily best scores are saved in the browser.

## Offline / single file

`hop-lanes-standalone.html` has Three.js and the fonts built in, so it plays with no internet
(for example in a phone's file viewer). Rebuild it after changing `index.html`:

```sh
./tools/build-standalone.sh
```
