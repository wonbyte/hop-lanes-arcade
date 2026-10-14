# Hop Lanes Arcade

A two-player arcade game. Hop across roads, rivers and train tracks. Go too slow and the screen leaves you behind.

## Play

- **Offline:** open `hop-lanes-standalone.html`. Everything is inside it, no internet needed.
- **Online:** https://wonbyte.github.io/hop-lanes-arcade/ (deployed from `main` by GitHub Actions), or serve the folder
  yourself (for example `npx serve .`). On a phone you can then add the game to the home screen.

| Action | Player 1 | Player 2 | Touch |
|---|---|---|---|
| Join | `W` or blue **TAP** | `↑` or red **TAP** | tap your half of the screen |
| Hop forward | `W` | `↑` | tap |
| Move | `A` / `D` / `S` | `←` / `→` / `↓` | swipe |
| Pause | `P` or `Esc` | | |
| Sound | `M` or the SOUND button | | |

- Score = rows crossed. Best scores are saved in the browser.
- Coins lie on the road. Collect them to buy new animals (arrows on the join cards).
- Stand still too long and the eagle gets you.
- Prize machine: 50 coins for a random surprise animal.
- Far out the road turns to night, police cars chase, lily pads cross still water, and mud makes you slow.
- Hear the beeps? Move. The eagle is on its way.
- Quick hops in a row make a combo. Every 5 pay a coin.
- Grab the blue gem for a shield (one free hit) and the red magnet to pull coins in.
- Three missions show on the title screen. Finish one and it pays 20 coins.
- A hidden coin sometimes sits one step past the edge of a grass row. It is worth 3.
- Every 100 rows a boss train comes: twice as long and faster.
- Rain speeds the traffic up. In December it snows.
- Modes (button on the title screen): classic, race (first to die loses), daily (the same world for everyone today, with its own best score), room (type a code; two phones get the same world).
- Handicap: give the weaker player a shield to start with.
- Game over: SHARE your score, or copy a replay link that plays your run again.
- Gamepads work: d-pad or stick to move, A to hop, Start to start, B to pause.
- Languages: English, Spanish, German (the EN button on the title).

## Develop

```sh
npm install
npm test       # about 5 minutes
npm run build  # rebuilds hop-lanes-standalone.html (do this after every change)
npm run build:three  # rebuilds vendor/three.min.js (only when tools/three-entry.js changes)
```

See `CLAUDE.md` for how the code is organized. Licenses of the bundled library and fonts: `THIRD_PARTY_NOTICES.md`.
