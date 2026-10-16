# Performance budgets

These are the targets. They were written before the work that measures them. A budget that a real device misses is a
bug, also when every test passes. A number from the headless browser in CI is a proxy (see the end), never a pass.

## Devices

| Device | Class | Browser | Frame budget |
|---|---|---|---|
| Low-end Android: Mali-G52 class GPU, 3 GB RAM (for example Galaxy A13 / A14 4G, Redmi 10) | floor | current Chrome | floor |
| iPhone SE 2 (A13) | floor | current Safari | floor |
| Laptop with Intel UHD graphics (UHD 620 class), 1080p screen | mid | current Chrome | mid |

## Budgets per device

| Budget | How it is measured | Floor | Mid |
|---|---|---|---|
| p95 frame time in play | interval between drawn frames (`requestAnimationFrame` to `requestAnimationFrame`) over the whole bench replay | <= 33.3 ms | <= 16.7 ms |
| Worst play frame | the longest drawn-frame interval in play, over the whole bench replay | <= 100 ms | <= 100 ms |
| Playable on Slow 4G | navigation start to the first drawn title frame (`hopLanes.state` is `attract`), empty cache, Slow 4G: 150 ms RTT (562.5 ms request latency), 1.47 Mbit/s down, 675 kbit/s up, gzip like GitHub Pages | <= 4 s | <= 4 s |
| Heap is flat | JS heap after a forced garbage collection, minute 30 against minute 1 of the soak | <= +5% | <= +5% |
| The game's objects are flat (added, see the note) | the same heap without V8's compiled code (`code` nodes of the heap snapshot) | <= +5% | <= +5% |
| GPU objects are flat | `renderer.info.memory` geometries and textures, minute 30 against minute 1; `renderer.info.programs` count equal | +-5% | +-5% |
| No slow-down over time | p95 frame time of minute 30 against minute 1 of the soak (thermal throttling and leaks show here) | within 10% | within 10% |

Note, added after the first soak (16 Oct 2026). The first 30-minute soak missed the heap budget: +10.4%. Two heap
snapshots showed why: the compiled code grew 21.2% (381 more `code` objects: V8 optimizes more functions the longer the
game runs), while everything else grew 0.6%. A leak shows in the game's objects, so that row was added, and the nightly
soak gates on it. The original heap row stays, and the summary keeps reporting it.

## The standard test load

- **The bench replay** (`tests/bench-replay.txt`): one fixed run on seed 21, made by `tools/make-bench-replay.mjs` with
  the real rules (`createSim`): 437 hops to row 160 in 62 s. It is the same keys on the same ticks every time, so two
  measurements differ only by the device or the code. It crosses every lane kind (all twelve), the night, a biome change
  and three boss moments (the flood, the boss train, the twister).
- **The soak**: the bench replay, played again and again in one page for 30 minutes (`hopLanes.playReplay`).

## Tools

- `node tools/device-bench.mjs` runs the bench on the headless browser here, or on an Android phone over USB
  (`--android`), and writes the raw Chrome trace, a Spector.js capture of one play frame, heap snapshots and a JSON
  summary to `bench/`.
- Any browser, iPhone included: open the bench link below on the live site. The game plays the bench replay again and
  again and shows the p50 / p95 / worst frame times of the last run (and the p95 of the first) in the bottom corner.
  Safari Web Inspector (Timelines) records the raw trace. `node tools/device-bench.mjs --print-url` prints the link.

The bench link (`tests/replay.test.mjs` checks that it is the bench replay):

https://wonbyte.github.io/hop-lanes-arcade/#debug-bench-replay-MnwyMXxjbGFzc2ljfGZyb2csZm94fDF8MHw2MDB8MWFVMTVhUjE1YVUxNWFVMTVhUjE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YUwxNWFVMTVhUjE1YUwxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTM3YVUxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFMMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUzMmFVMzJhVTE1YVUxNWFVMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFSMTVhVTE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhTDE1YUwxNWFVMTVhVTE1YVUxNWFMMTVhUjE1YUwxNWFVMTVhVTE1YVUxNWFSMTVhVTE1YVUxNWFVMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhVTE1YVUxNWFVMTVhUjE1YVUxNWFVMTVhUjE1YVUxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhVTI3YUQxNWFSMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhTDE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YVUxNWFVMTVhUjE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YUwxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhUjI3YUQxNWFMMTVhTDE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhVTE1YVUxNWFMMTVhTDE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhTDE1YVUxNWFVMTVhVTI0YVUxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFVMTVhVTE1YVUzMmFVMzJhVTE1YVUxNWFVMTVhTDE1YUwxNWFMMTVhVTE1YUwxNWFMMTVhUjE1YUwxNWFSMTVhVTE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFVMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFSMTVhTDE1YVIxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YVUxNWFMMTVhUjE1YUwxNWFSMTVhTDE1YUwxNWFMMTVhTDE1YUwzM2FEMjFhRDE1YVIxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFVMTVhVTE1YVIxNWFSMTVhTDE1YVUxNWFSMTVhTDE1YVUxNWFVMTVhVTE1YVUxNWFSMTVhVTE1YVUxNWFVMTVhUjE1YVIxNWFMMTVhUjE1YVUxNWFSMTVhTDE1YVIxNWFMMTVhVTE1YVUxNWFVMTVhVTE1YVUxNWFVMTVhUjE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YVIxNWFSMTVhTDE1YVIxNWFSMTVhVTI3YVIxNWFMMTVhVTE1YUwxNWFSMTVhTDE1YVIxNWFMMTVhUjE1YUwxNWFVMTVhVTE1YUwxNWFMMTVhVTE1YVUxNWFVMTVhVQ

## The headless proxy

CI and this repository's own machine have no GPU: Chromium draws with SwiftShader on the CPU. Its frame times are
compared only with its own earlier runs on the same machine, and a change that makes them worse is a regression. They
do not say if a phone meets its budget. `tools/bench-budgets.json` holds the proxy limits that CI enforces.
