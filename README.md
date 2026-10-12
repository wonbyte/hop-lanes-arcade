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
- Modes (button on the title screen): CLASSIC, RACE (two players; the first to die loses) and DAILY (one world
  for everyone each day, with its own best score).
- Far out the road turns to night, police cars chase, and lily pads cross still water.

## Develop

```sh
npm install
npm test       # about 5 minutes
npm run build  # rebuilds hop-lanes-standalone.html (do this after every change)
npm run build:three  # rebuilds vendor/three.min.js (only when tools/three-entry.js changes)
```

See `CLAUDE.md` for how the code is organized. Licenses of the bundled library and fonts: `THIRD_PARTY_NOTICES.md`.
