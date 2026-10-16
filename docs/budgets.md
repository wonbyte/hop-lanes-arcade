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
| GPU objects are flat | `renderer.info.memory` geometries and textures, minute 30 against minute 1; `renderer.info.programs` count equal | +-5% | +-5% |
| No slow-down over time | p95 frame time of minute 30 against minute 1 of the soak (thermal throttling and leaks show here) | within 10% | within 10% |

## The standard test load

- **The bench replay** (`tests/bench-replay.txt`): one fixed run on a fixed seed, made by `tools/make-bench-replay.mjs`
  with the real rules (`createSim`). It is the same keys on the same ticks every time, so two measurements differ only
  by the device or the code. It crosses every lane kind, the night, a biome change and a boss moment.
- **The soak**: the bench replay, played again and again in one page for 30 minutes (`hopLanes.playReplay`).

## Tools

- `node tools/device-bench.mjs` runs the bench on the headless browser here, or on an Android phone over USB
  (`--android`), and writes the raw Chrome trace, a Spector.js capture of one play frame, heap snapshots and a JSON
  summary to `bench/`.
- Any browser, iPhone included: open `#debug-bench` on the live site. The game plays the bench replay and shows the
  p50 / p95 / worst frame times on the screen at the end. Safari Web Inspector (Timelines) records the raw trace.

## The headless proxy

CI and this repository's own machine have no GPU: Chromium draws with SwiftShader on the CPU. Its frame times are
compared only with its own earlier runs on the same machine, and a change that makes them worse is a regression. They
do not say if a phone meets its budget. `tools/bench-budgets.json` holds the proxy limits that CI enforces.
