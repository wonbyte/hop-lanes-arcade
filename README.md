# Hop Lanes Arcade

A two-player voxel lane-crossing arcade game for the browser. Hop across roads, rivers, train tracks, ice and
bridges. Go too slow and the screen leaves you behind.

**Play now:** https://wonbyte.github.io/hop-lanes-arcade/

Plain HTML, CSS and ES modules on [Three.js](https://threejs.org/). No framework, no build step to run it, no
account, no tracking. One file plays the whole game offline.

[![CI](https://github.com/wonbyte/hop-lanes-arcade/actions/workflows/ci.yml/badge.svg)](https://github.com/wonbyte/hop-lanes-arcade/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- **Two players on one screen or one phone.** Keyboard, touch, swipe and gamepad.
- **Endless world.** Grass, roads (police past a point), rivers with logs, lily pads, mud, rails with trains, ice that
  slides you, bridges with breaking planks and rolling boulders. Night falls far out. Rain speeds traffic up; it snows
  in December.
- **Modes.** Classic, race (first to die loses), coin war (most coins wins), tag (the player behind hops faster),
  daily (one world for everyone today) and room (type a code; two phones get the same world).
- **Every animal has an edge.** Faster hops, a longer magnet, an extra life in water, a patient eagle. The card says
  which. Hats unlock at an all-time best of 100, 250 and 500. Daily runs on days in a row build a streak.
- **Ghost.** Daily and room worlds remember your best run and replay it as a see-through ghost. Beat it.
- **New lands and boss moments.** Every 100 rows the look changes: meadow, desert, tundra, swamp. Past row 100 each
  block has a boss train, a twister on the grass and a river in flood. Springs fly you two rows, portals swap you
  across the row, cliff tiles crumble for good. Unlock looks (desert, night, tundra, swamp) with your best score.
- **Daily missions and a local top 10.** Three missions a day, the same for everyone, 30 coins each. The best 10 runs
  on this device, with your initials, with or without a server.
- **Feel.** Squash on every landing, a score that pops, slow motion and a zoom when you fall, music that adds layers
  as you go deeper, a guided first run.
- **Coins, shop and prize machine.** Buy five original animals (Frog, Fox, Bunny, Cat, Robot). Combos, hidden coins,
  shield and magnet power-ups, three missions at a time, a boss train every 100 rows.
- **Replays.** Every run is deterministic. Share a link and it plays back the exact same run.
- **Optional online top 10.** All time, today or this week. A tiny dependency-free score server verifies posted
  scores by replaying them, and a tap on an entry plays that run back.
- **Accessible.** Screen-reader announcements, a less-motion switch, vibration toggle, lanes readable without colour,
  English, Spanish and German.
- **Installable.** Works as a PWA on phones. The standalone HTML file runs with no network at all.

## Play

### Online

Open https://wonbyte.github.io/hop-lanes-arcade/. On a phone, add it to the home screen.

### Offline

Download [`hop-lanes-standalone.html`](hop-lanes-standalone.html) and open it. Everything is inside the one file.

### Self-hosted

Serve the repository folder with any static server, for example:

```sh
npx serve .
```

Browsers refuse ES modules from `file://`, so `index.html` needs a server. The standalone file does not.

### Controls

| Action | Player 1 | Player 2 | Touch | Gamepad |
|---|---|---|---|---|
| Join | `W` or blue **TAP** | `↑` or red **TAP** | tap your half of the screen | Start |
| Hop forward | `W` | `↑` | tap | A or up |
| Move | `A` / `D` / `S` | `←` / `→` / `↓` | swipe | d-pad or stick |
| Pause | `P` or `Esc` | | | B |
| Sound | `M` or the SOUND button | | | |

### How it works

- Score is the number of rows crossed. Best scores are saved in the browser.
- Stand still too long and the eagle gets you. Hear the beeps? Move.
- Quick hops in a row make a combo. Every 5 pay a coin. A hidden coin sometimes sits one step past the edge of a grass
  row and is worth 3.
- The blue gem gives a shield (one free hit). The red magnet pulls coins in.
- Finish a mission for 20 coins. The prize machine gives a random animal for 50.
- There is no diagonal hop, so the world is built with a way forward: lily pads and planks always line up with
  something you can stand on in the row before.
- On ice, a sideways hop slides one more step. A bridge plank breaks 0.6 s after you land on it and comes back 3 s later.
- A car that just misses you is a near miss: +1 combo and a whoosh.
- Two players: the one far ahead hops a little slower, so nobody is left behind. Past row 20 some magnets are bombs
  when two play: the pick drops a rock in front of the other player for three seconds.
- Game over: share your score, copy a replay link, or try again. Pause → SNAPSHOT saves a picture of the field with
  the score on it.
- SETTINGS on the title has sound, vibration, language, a handicap (a starting shield for the weaker player) and a
  less-motion switch.

## Development

Requirements: Node 20 or newer. Python 3 for the offline build. Pillow only for the icons.

```sh
npm install          # Playwright, Three.js and esbuild (test and build only)
npm test             # syntax check, node unit tests, then browser tests (about 6 minutes)
npm run check        # syntax check only
npm run build        # rebuilds the minified hop-lanes-standalone.html (do this after every change)
npm run build:three  # rebuilds vendor/three.min.js (only when tools/three-entry.js changes)
npm run scores       # starts the optional score server
npm run icons        # regenerates icons/ from the frog pixel art
```

The code is organized as pure rules (`js/rules.js`, `js/gen.js`, `js/sim.js`) that both the browser and the score
server run, with the rest of `js/` only drawing them. [`CLAUDE.md`](CLAUDE.md) is the full map of the modules, the
conventions and the gotchas. Read it before changing anything.

Testing hooks: open `index.html#debug` for `window.hopLanes` and an FPS counter, `#seed-42` for a fixed world,
`#replay-<code>` to play a run back.

### Score server

The score server in [`server/`](server/README.md) is optional. Run it, then point the game at it with a
`<meta name="hop-lanes-scores">` tag in `index.html`. The title then shows a TOP 10 button and the results show the
world best. Set `VERIFY=1` so every posted score is checked by replaying the run.

### Deploy

Pushes to `main` run the tests and deploy the site to GitHub Pages (`.github/workflows/deploy.yml`). Set
Settings → Pages → Source to GitHub Actions once.

## Contributing

Issues and pull requests are welcome.

1. Fork and branch from `main`.
2. Run `npm test` and `npm run build`, and commit the rebuilt `hop-lanes-standalone.html` with your change.
   CI fails when the standalone file or `vendor/three.min.js` is stale.
3. Anything that changes the outcome of a run belongs in `rules.js`, `gen.js` or `sim.js`, with a node test.
4. User-facing text goes through `t()`; add the Spanish and German strings in `js/i18n.js`.
5. Keep the characters original. Do not copy characters from existing games.

## License

[MIT](LICENSE). The bundled Three.js build and fonts have their own licenses, listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
