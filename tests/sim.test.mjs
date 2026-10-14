// Fast tests for js/gen.js and js/sim.js (no browser): the world as data and the run without a screen.
// Run: node tests/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGen, railStep, trafficX } from '../js/gen.js';
import { createSim, makeRules, resetPlayer, simulate, winnerOf } from '../js/sim.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { BRIDGE_FROM, ICE_FROM, PLANK_BACK, PLANK_BREAK, ROCKS_FROM, STEP, plankState, traitOf } from '../js/rules.js';

// what the browser built for seed 42 (window.hopLanes.laneKinds()) before world generation moved to gen.js
const KINDS_42 = ['grass', 'grass', 'grass', 'grass', 'river', 'river', 'river', 'road', 'road', 'road', 'road', 'river', 'river', 'grass',
  'road', 'road', 'lily', 'lily', 'grass', 'road', 'river', 'road', 'grass', 'river', 'river', 'grass', 'road', 'road', 'road', 'road', 'road'];

// Replays played in the browser (index.html#debug-replay-<code>, before the rules moved to sim.js) and what the
// browser reported at game over: play ticks, the first joined player's row and cause, and the scores.
// They cover logs, lily pads, mud, cars, police, trains, the eagle, falling behind, the handicap shield, two players and race mode,
// and (the last eight) ice slides, bridges (two runs end on a plank that broke under the player) and boulders on rocks rows.
const BROWSER_RUNS = [
  {"code":"MnwxNzI3MDE3NTQzfHJhY2V8ZnJvZyxmb3h8M3wxfDQ0MHw1YVUyMmJVMzJhVTM0YlUyOWFVMjJiVTI0YVUzMmJVMzVhVTEzYlUzMGFSMzFiVThhUjI3YlUxMWFVMjFiRDE0YVUyMWJSMTFhVTI5YkQyM2FVMzdiUjI2YVUxNGJVMTRhVTI1YlUyNWFVMTJiVTlhUjE3YkQyMmFE","endTick":748,"row":10,"cause":"squash","scores":[11,8]},
  {"code":"MnwxMjA1NjkwMjUwfGNsYXNzaWN8ZnJvZyxmb3h8MXwxfDY2Mnw1YVUyMWFVMTZhVTM2YVUyNGFVMzNhVTMyYVUyNWFVMTBhVTEyYVUxNWFVMzNhVTM3YVUyOGFVMzBhUjhhVTI5YVUxM2FVOGFVMTNhVTMyYVUzN2FVMzVhVTE5YVUxNWFVMjlhVTE4YVUxMWFVMzJhVTMxYVUyOGFVMjlhVTM0YVU5YVUzM2FV","endTick":907,"row":17,"cause":"train","scores":[17,0]},
  {"code":"MnwxOTcxNjQ3MzAwfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDU2NXw1YVUzMWFVMzJhVTExYUQyMWFVMTlhUjEzYVIzMmFVOWFVMTJhUjM1YUQzN2FVMjRhUjIwYVIyN2FMMTFhUjEzYVIzN2FEMTZhVTI1YVIyM2FSMzVhVTIxYVUyMWFEMTVhVTExYVIyMWFEMzdhVTMxYVUxOGFVMjlhVTEwYVUxNGFVMTZhVTI0YVUzMGFEMThhVTIwYVUyM2FEMzVhVTM0YUQyOGFVOWFSMjZhVTEyYVUzM2FVMTFhVTM0YUQxM2FVMjZhRDI5YVUzNWFMMTlhTDIyYVUzNGFSMjZhRDMyYVUzNGFMMzZhVTIzYVUxNGFVMTNhVTE3YVUxN2FVMTdhVTIzYUwzMmFVMjFhVThhVTI5YVU5YVUyN2FVMjJhVTE2YVUxN2FVMTRhVTMyYVUyOGFVMzVhRDE1YUwzNGFEMTVhVTI5YUwzNWFMMjlhTDM0YUwxNWFMMTBhUjM0YUQyMWFVMjJhVTIxYVUyMWFVMTJhVThhVTM1YVUxMWFMMjVhTDE3YVIyOGFSMzNhTDI0YVUxOGFVMjdhUjM1YUwyN2FVMTFhVTIwYVUxNmFSMTNhTDE5YVIzNmFMMjVhVTI3YVUxN2FVMzZhTDEyYUwxNWFSMTdhVTI2YVUzNGFMMjZhTDIyYVIyNmFVMTRhRDE3YVUyNmFVMzRhVTE0YVUxNWFVMTNhRDIwYUQxN2FVOGFMMTRhRDExYVUxOWFEMjVhVTEwYVUzNGFSMzVhUjE0YVUyNWFVMTJhRDlhVTlhRDExYVIyM2FSMjhhRDE0YUQxMWFVMjFhRDIyYVUyNGFEMTZhVTMyYVUxMGFEMzZhVTE4YVUxNWFMMTRhUjE4YVUxM2FSMTBhVTM1YVUyMWFVMjlhRDE1YVUyNmFEMzdhVTMxYUwxMGFVMzJhRDM0YVUzNGFEMzdhVTEwYUQyNmFVMTRhRDMyYVUzMmFEMTVhVTI5YUQxOWFVOGFEMTJhVTI0YUQzMGFVMTFhVTE5YVIyNmFMOGFSMzFhRDMzYUQyNmFVMThhRDIyYVUzNGFEMjFhVTMxYUQxMGFVMjJhRDMwYVUzNGFEMjZhVTE0YUQyNGFVMzJhRDI4YVUxN2FVMzRhVTEyYVUyNGFSMzNhTDIzYVIxMmFSMzNhTDI3YVU4YVUxOWFVMjBhVTMzYUwyMWFSMjBhTDIyYVIyNWFMMTNhUjI2YVUxNWFMMjVhUjMxYVUxMGFSMzRhTDIyYUwyM2FSMTBhUjIwYVUzMGFVMTdhRDEwYVUzNGFMMjdhUjlhTDM1YUQyN2FVMjZhTDEyYUwzNGFMMjJhTDMwYVIyNGFMMjFhTDI5YUwyNGFMMzFhRDEzYVUxNWFEMzFhTDE1YUQzNWFVMTZhTDI5YVUxMGFVMjFhTDIwYUQ4YVUyMWFSOWFSMzFhRDEwYUwzNWFVMTBhRDEyYUwzNGFV","endTick":1852,"row":35,"cause":"splash","scores":[38,0]},
  {"code":"Mnw5MDQyMDQ3N3xjbGFzc2ljfGZyb2csZm94fDN8MHwzODg4fDVhVTMxYlUxNGFVMjBiVTM1YVUxN2JVMTlhVTMyYkwzN2FVMzdiRDlhVTE1YlUzNmFVMTRiUjI2YVUzMmJSMzBhUjEyYkwzMGFMMTFiVTMyYVIxOWJVMTZhRDI4YkQyMmFVOGJVMTdhVTEyYlUxMGFMMTdiVTM3YVUzMWJVMzFhVTMzYkQyMGFEMjViVTMxYVUzNmJVMjlhUjI2YlUzNWFVMzZiVTE1YVUxOGJSMjRhVTM0YlIyOWFMMTNiTDMyYVIxMGJEOGFMMTViVTI4YUwxN2JMOWFSMzBiTDhhUjliTDIyYUQyMmJMOWFVMThiTDE2YVIxM2JSMTVhTDI1YlIzNmFVMjhiTDEyYUwzN2JSMzFhUjEzYlUyNmFVMTBiVThhVTM2YlUzN2FVMjRiRDMyYUQxN2JVMjFhVTEwYlIxMWFVMTliUjIzYVUzM2JMMThhRDEzYkwyMGFMMjZiRDE4YUwyN2JMMjJhVTMwYlUzMGFVMzNiTDMxYUQxOWJMMjNhVTMwYlI2NDBhRDE1YUQxNWFEMTVhRDE1YUQxNWFE","endTick":2958,"row":21,"cause":"eagle","scores":[21,15]},
  {"code":"Mnw0MjEyNzcyODI0fGRhaWx5fGZyb2csZm94fDF8MHwzNjgzfDVhVTM0YVUyMGFVMjNhTDIwYVIzMWFEMTJhVTE4YUQxOGFVMzRhTDIwYVUxMWFVMzJhTDI5YVUyOGFVMjBhUjIyYVUzM2FMMzRhUjIyYUQzNGFVMThhRDMyYVUxMGFSMjBhRDIwYUQxMGFMMTNhVTE2YUQyMWFVMTlhRDE5YVUyMWFMMjlhVThhTDlhVTMxYVUzM2FVMzRhVTEwYUwxMWFSMTFhTDE1YUwxOWFSMTNhVTEzYVUyNWFVMTRhRDEwYVUyNmFEOWFVMTNhRDMyYVUxM2FMMTZhUjMzYVUyM2FVMjhhVTMwYVUxNWFVMTVhTDM3YUwyMmFSMjdhTDI1YUwyOWFSMTlhVTEyYVUxN2FVMTVhVTEzYVUxMWFVMzJhVTIzYVUyOGFVMjNhVTI4YVUxMWFVMTVhVTM0YVUxNmFMMjBhVTM1YUwxOGFMMTJhUjI3YVIzNGFSMzVhUjMwYVUzNmFVMjFhRDI4YVUxN2FMMjBhRDM1YUwzN2FMMTNhUjE4YUwxNGFEMTVhVTM1YUwyMGFVMzNhVTE2YVUxMGFVMzdhTDE1YUQzNWFSMzZhUjI4YUQyNGFVMThhVTMyYUQyNmFVMzVhVTIwYVUyNWFVMTdhVTlhVTIwYVUxN2FVMzBhVTEzYVUxNmFVMjRhVTE1YVUzM2FVMTJhVTI4YVUzM2FVMjNhVTI3YVUzNWFVMjBhVTIzYVUyMGFVMzFhVTI3YVUyN2FVMTBhVTlhVTEwYVUxMWFVMTVhVTlhVTIyYVUyN2FVMjhhVTE5YVUxMmFVMjVhVTI3YVUyM2FVMzZhVTIxYVUyOWFVMjlhVTlhVThhVTE4YVUyNWFSOGFVMzNhUjM3YUwxMWFSMjBhTDEzYVI4YUwyOGFVMzRhRDE5YVUzMmFVOGFVMzdhVTEyYUQxMmFVMTlhTDhhRDhhTDMwYUQzMWFVMTVhTDIwYVIyN2FEMzZhTDMwYVIyOGFSMTBhUjlhVTIxYVU5YUQxMWFVMzRhRDM2YUwyN2FVMzZhVTMzYUw4YUQyNWFEMzNhTDMyYUwyOGFEMzFhUjhhUjhhVTM3YUwyM2FSMTdhRDI0YVUzMmFVMzBhRDMxYVUxNmFEMjhhVTM0YVIxN2FMMzBhTDMzYVUzMmFVMzFhVTE5YVUyOWFVMTlhVTEwYVUxM2FEMjZhRDE3YVUyOWFMMTNhTDE0YUwyMGFMMjBhVTIwYUQyNmFVMzNhTDEyYUwyOWFMMzVhTDE1YUwyM2FMOWFSMTZhVTMwYVUzM2FVMzZhVTI5YUQyOWFVMjJhRDI4YVIxN2FVMjRhUjMyYUwzNmFEMTBhTDMyYVIzNmFSMjFhTDMwYUwzMGFMMThhTDI4YVIxNGFSMjJhUjEyYUwyMmFVMTJhVTMxYUwzNmFVMjhhTDE2YVIxNWFMMjZhVTE0YVUxMWFVMzBhVTMyYVUxOGFVMzFhVTExYVUxNWFVMTlhVTI3YVUxMmFVMjVhVTEzYVUxOWFVMzZhVTMyYVIzNWFVOGFSMjZhUjE1YVUyM2FSMjZhRDIxYVU4YUwzNGFMMzdhVTI2YVUyOGFEMjJhVThhUjIxYVIxNGFEMzNhVTI2YUwzNmFSMTVhTDE3YUwzNWFVMjhhVTEyYUwzNGFSMTFhUjI3YUwzNGFSMzBhTDM0YUwyNWFMMTlhTDI2YUwyNWFVMTFhVTMyYVIyMGFVMjdhTDIxYUQyOWFVMzVhTDEzYUwyM2FEOWFSMzZhUjIxYVIzMGFVMzRhUjE4YUwzMmFMMjlhVTlhUjMxYUwyMWFSMjJhVTMyYVUyMmFMMTVhUjIyYUwxMmFSMjNhRDE2YVU4YUQzMWFVMzJhVTE0YVU4YVUxOWFVMjRhVThhVTE2YUQ4YVUzM2FVMjhhVTM3YUQxMWFVMjFhRDE2YVUyMWFEMjFhRDE2YVUxOWFEMTVhRDIxYVUyOGFMMzBhRDI3YVUxNWFMMzVhUjhhTDMyYVIzNWFSMjhhTDI0YUQyMGFVMzdhTDM3YUwzNGFSMTZhUjIyYVUxOWFVMjVhTDI3YUQzNWFMMTVhTDE4YUQxOWFVMTdhUjI3YUwxNGFMOWFEMzRhUjE4YUwxNmFE","endTick":3798,"row":44,"cause":"splash","scores":[44,0]},
  {"code":"MnwxNzMxNzY1NjUyfGNsYXNzaWN8ZnJvZyxmb3h8M3wxfDYzNHwyNWJMM2FVMTliUjI2YVUxOGJVMjFiTDQ0YlI2YlUzN2JSNDlhVTIyYVUyMWFVOGFVMTdhVTEwYVUyOWFMMjdhVTMwYVUxNWFVMzdhVThhUjI0YlUxMWFSMjRiVTE3YVUxOWJMMjNhVTEyYUQzYlUzMGFVM2JVMzdiTDVhUjI3YVU3YkQyNWJVNGFVMjZhVTRiUjIyYUwxNGFVMjgzYVIzMGJMMTJiRDliVTI1NGFSMTlhTDEwYVU3YVUyNGFVN2FSMTVhVTM0YUQyNmFMNDNhVTMwYVUxOWFVMTRiTDI1YVIxOWJSNGFVMTFiTDE1YUwxNGFVMTFhVTBiTDEwYVI4YlUxMmJSMTJhRDE4Ykw1YVUyMWJEMTBhRDZhVTI3YVUzNmFVMzVhVTQxYVUxNmFEMThhVTEzYUwwYlUzNGJVMTFhVTE3YVU0YlUxN2FVNWJMMjdhTDlhVTI0YVUyNmFVMThhVTQwYVIyMmFVMTIzYlUzOGJVMzFiVTI4YlUzNWJSMzhiVTEyYlUyNWJVNDNiRDQzYkwyNGJVMjJhTDE0YlIyNmFVOGJSMThhVTE0YlUxNWFSN2JVMjFhVTExYlUyM2FVMTJhVTBiVTIxYlIxOGFVMjJiVTlhVTE3YlUyN2FVN2JVMTdiVTNhUjE0YVUxNWJVMTVhUjExYVIzYlUzMGFVMTJhVTJiVTQxYUwwYlUyM2FSOGJMN2FVMTVhVTE4MGFVNDFhVTExYVI0NWFVMzJhRDIyYVU4YVUyOWFM","endTick":1460,"row":11,"cause":"splash","scores":[11,4]},
  {"code":"MnwzODcyNzY5MTd8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NDg1fDVhVTE3YVUzMmFVMjhhVTMwYVUxMWFVMzJhVTMyYVUyOGFVMTBhVTMzYUQzM2FVMTlhTDI2YUwyN2FSMjZhRDE3YVUxMGFVMTBhUjE0YUQzMGFVMTlhTDlhVTI2YUQxMGFVMTJhTDE4YUwxNGFMMTBhUjEzYVUyOGFVMTJhVTExYUwxNGFVMjFhVTEzYUwyMWFEMzJhVTI1YVIzM2FVMzFhVTMxYUwxNmFSMzFhTDMwYUQxNmFVMTBhRDI4YVUxOWFSMjVhTDIwYUwyNWFVMjlhVTMxYUQyNmFVMjhhVTI1YUQyMWFVMTJhVTIwYUwxM2FMMjlhRDExYVU5YUQxN2FMMjBhTDE3YVIzMWFVMTlhRDhhTDI3YVIxNWFMMTNhUjI1YUwyMWFSMjZhRDMzYUw5YVIxNWFMMTBhTDI2YVIyMmFEMjJhVTMzYUwyNmFVMjRhRDIxYVUyOGFVMjhhRDI5YVUxNmFEMTBhVTE5YVIzMWFEMjRhVTE0YUwxOWFSMjZhRDE0YVUyMGFVMTZhVTE5YVUyN2FVMTBhVTEwYVUxOGFMMjRhVTI3YVUxM2FVMThhUjE2YUQyNmFVMzBhTDEzYUwyMWFSMTVhUjIyYUQyM2FVMzFhVTI0YVUxOWFVMTVhVTI1YUQzMGFVMjJhTDlhUjIzYUwyNWFMMTlhVTMwYVUyOWFVMjJhRDI0YVUxOWFEMTNhVTE2YUwzMGFSMzNhVTEwYVUyN2FVMThhVTI5YVUyMWFSMTRhUjIwYVUyM2FSMTRhVTIwYUwzM2FEMzBhVTIyYUQyN2FVMjJhTDIwYVI4YUwxMmFMMTBhUjI1YUw5YVIxMmFVMjBhVTIyYVUxMmFVMjRhTDIyYVIzM2FVMjFhUjE2YVIxMWFEMTlhVTIwYUwzMGFSMjhhTDMwYUwxMGFSMzFhTDI1YVIxN2FSMjJhRDEwYVUzMmFVMTNhUjE4YVIyM2FEMzBhRDIwYVUxMGFSMjNhRDI4YVUxNmFEMTlhTDI0YUwxMmFMMTlhUjE2YVIyNWFMMzJhTDIwYUwyM2FVMzNhRDlhVTEyYVIxNmFEMjBhVTEyYVIyMWFEMjVhVTI2YUwxMmFEMjBhVTI5YUQxM2FVOGFVMTNhUjE5YUwyNGFVMTlhVTIyYUwyNWFMMjVhTDE2YVUyNWFMMTJhUjMwYUwyMWFMMzFhUjI0YVIyOWFSMzNhUjI4YVI5YVIyNmFSMTdhUjI1YUQyMmFVOGFEMzJhUjE2YVIzMWFMMjNhTDE2YVUxNmFVMzJhVTE3YUQxNGFVMTlhVTIxYUwyNWFMMTVhUjEzYUQyMGFVMjBhTDE3YUQzMGFVMjRhVTIxYVU5YUwzMWFSMTdhTDI0YUwxNmFVMTBhVTE1YUw4YVUyNmFVMjNhRDI1YVUyN2FSOGFMMTJhUjExYUwxNmFVOWFVMjFhVTI5YVUxMmFVMzFhVTE1YUQzMmFVMjFhRDI4YVUyMGFMMzFhRDI0YVUxMmFVMzBhVTI0YVUxNWFEMzNhVTIwYVUyMWFEMjhhVTMxYVIxNWFVMjNhVTI3YVU5YVUzMGFVMjRhRDEwYVIzMWFMMTdhUjI0YUwzM2FSMjFhVTMxYVIzMGFMMThhUjlhTDIwYVIxOGFMMTdhVTI0YVUyNmFVOWFSMjVhUjIzYVU4YVIyOWFVMTZhVTE4YVUyN2FVMzJhVTI3YUwxNWFMMTVhUjI1YVIyMGFSMTJhTDIyYVIyNmFVMThhVTI1YUwxOWFEMzJhVTE2YVUxNWFSMTFhRDEyYVUyNWFEMzJhVTI2YUwxNGFSMjlhTDMwYVUxN2FEMjlhUjI3YUQ5YVIyNGFSMjNhRDI5YVUyMGFSMTFhUjEzYUwyMWFSMTRhRDExYVUxOGFEMTVhVTEyYVUyN2FSMTdhTDE0YVIyMmFSMjNhTDI3YVUxM2FVMjJhRDE3YVIxN2FMMjFhUjI3YUw","endTick":7900,"row":85,"cause":"swept","scores":[86,0]},
  {"code":"Mnw3NzQ1NTM4MzR8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NjcwfDVhVTI3YVUyMWFVMjRhUjI0YUQxNmFMMTRhTDhhUjEwYUQzMmFVMTdhRDMyYVUxN2FMMzBhRDI1YVUxMmFMMjdhTDE2YUQyNmFVMTZhUjExYUwyMWFMMjBhUjMxYVIxOGFVMzJhVTEyYUQyN2FVMTBhVTIwYVUyMWFVOWFVMTlhVTEzYVUyOWFVMTdhVTMzYVUxNGFVMjdhVTE5YVUxNGFVMjRhVTIyYVUxN2FVMjhhVTE3YVUxMWFSMjJhUjE3YUQxMWFVMjJhRDEwYVUyMmFEMTdhVTEzYVUyM2FVMzNhRDI3YVUyOWFVMTBhVTI0YVUxMWFVMjlhVTE5YVIxOGFVMjdhVTE0YVUyMGFEMThhVTE3YUQyM2FVMTdhRDE5YVUxNmFMOWFVMzBhVTI0YVUyOWFMMzBhRDMxYVUyMmFMMTJhRDMzYVUxM2FVMjVhVTMxYVUyM2FVMTFhVTMyYVIyMmFSMjZhUjEwYVIyOWFMMjRhTDMwYVUyMWFVMzFhVTE1YVIxM2FSMjZhTDIzYUwzMWFSMjRhVTI2YVUxMWFVMTNhVTI1YVU5YVUxN2FSMjZhTDI4YVUyNmFSMjhhVTE5YUw4YVIyOWFEOGFVMjJhUjMwYUQxN2FVMzNhUjI0YVIxNGFSMThhUjIwYVI5YUwxM2FMMjVhVTI3YUwxNmFSMjVhVThhRDI5YVUxMWFMMTRhVTIzYVUxMmFVMjJhRDEyYVU5YVU4YVUyNGFVMjZhVTIxYUwyNmFVMjVhUjEyYVIxNGFVMTFhVTIzYUQzM2FEMzBhVTE4YVIxNWFSMTRhTDMxYUQzMGFMMzFhVTI5YVUxN2FSMjFhRDI0YVU4YVUyM2FEMjlhVTIzYUwyMmFVMjhhVTI5YVUxM2FSMjBhRDEwYVUyNWFMMjVhVTlhVTEyYVUxNGFVMjBhVTE2YVUyNWFSMjNhUjE4YUwyN2FSOWFSMTlhTDE0YUwxMWFVMThhRDMzYVUxNmFMMTNhRDE4YVUzMGFVMTdhRDIxYVUyN2FMMTVhTDMyYVIzM2FVMTJhVTI1YUQxOWFEMzBhUjMwYUQ5YVUyOGFMMjlhRDI1YVIxMWFMMTFhTDI0YUQyMGFVMTJhRDEzYVUyNWFMMTZhUjlhUjE2YUQzMWFVMjZhTDEzYVIxMWFEMjRhVTMxYUQxOWFSOWFVOWFSMTRhRDE1YUQyOWFEMTBhUjI2YVIxMWFSMTFhTDI5YVUyM2FMMTJhTDIyYUwxMmFSMjNhUjMyYVIyN2FSMjhhUjI0YUw","endTick":5082,"row":75,"cause":"slow","scores":[78,0]},
  {"code":"MnwyMzIzNjYxNTAyfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDE0MTB8NWFVMTJhVTEyYVUyMGFMMTlhRDIwYVUxMGFSMzNhTDIwYVIyOWFVMzNhUjE1YVIyOWFSMzBhRDE3YVUyNmFMOGFEMjBhVTI4YUQ4YVUxOGFMMjlhUjMyYUQyN2FVMTBhVTE4YVUyM2FEOWFVMzJhTDEyYVIzMmFMMTJhTDE3YVUyOWFEMzBhVTI1YUwyMWFVMjhhVTMxYVUxN2FVMjdhTDExYVUyNWFSMThhRDlhVTIzYVIxMmFMMTdhRDI1YVUxM2FEMjRhVTI0YUQxMmFSMTRhTDI1YUwzMWFSMTVhUjI5YVUzM2FSMjRhTDE4YVUxOWFVMTFhVTE3YVUxNWFVMjNhVTE4YVUyMGFVMjFhVTMxYVUyMGFVMjdhVTE2YVIxM2FMMjVhUjI3YUwxOWFEMThhVTMzYUwyMGFMMjVhUjIwYUwzMWFMMjBhUjE4YVUxN2FVOWFVMTVhUjEyYUwyNmFSMjRhTDIyYVIzMWFVMjlhVTE5YUwxMWFEMTVhVTE0YUQyM2FVMjBhRDI4YVUxNGFVOWFVMjRhVTI3YVUyMWFMMjRhRDI0YVUxMGFSMjNhUjIxYVUyM2FVMzFhVTIyYUwyOWFVMjVhVTMyYUQxOWFVMTRhTDI1YVIzM2FMMTFhUjIxYVIxMWFVMjFhVTMwYUQxN2FSMTBhUjI5YUwxMWFSMzBhTDI0YVIyOGFVMzJhVTEzYUwxNmFSMjBhTDMwYVIxNmFSMTlhRDE5YVUxOGFVMTlhVTE1YVUyMmFVMTdhTDMwYVIyNWFSMjZhVTMzYVUyNWFMMzNhRDEwYVU5YUQ4YVIxMWFEMjlhVTIzYUQyMGFVMjJhUjI0YUQyM2FVMjhhUjIyYUQyMGFVMjNhUjE0YVIxMGFSMjZhUjMzYUwxOGFEMzNhTDhhUjE4YVIxOWFMMjZhTDE0YUw4YUwyNmFEMTBhRDIyYVUxOGFSMTFhTDE0YUQyMGFVMzBhTDIyYVIyNGFVMjFhVTMwYVU4YVIxNmFMMTlhRDI1YVUyN2FSOWFEMTZhVTMzYVUyNmFSMTJhUjI3YVIyNmFVMjhhVTI5YVU4YVUxN2FMMTVhTDE4YVIzMmFSOWFSMTZhTDE2YUwxMWFMMTZhVTMzYVU4YVUxNmFVMjNhVTlhVTE0YUQxN2FMMjBhTDI4YVIxMGFMMzJhTDMyYVIxMGFEMjBhVTE1YUwzMmFEMjdhVTMzYUwxOGFSMTdhRDMzYVUyN2FMMjFhUjI2YVIxN2FMMTVhRDlhVTMyYUwyNGFEMjFhVTE3YVIyNmFSMjJhUjI3YUQzMGFVOWFVMTRhRDI0YUwyOGFEMjZhVThhVTIyYUwyNmFEMTlhRDE3YVUyMGFEMTBhTDE2YUQyNWFVMTRhUjE4YUwxMGFEMjFhVTI0YUwyMmFSMjdhTDIzYUwzMmFMMzNhUjE1YUQxNWFMMTZhUjExYVI","endTick":5858,"row":49,"cause":"slow","scores":[50,0]},
  {"code":"MnwzODcyNzY5MTd8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NDg1fDVhVTE3YVUzMmFVMjhhVTMwYVUxMWFVMzJhVTMyYVUyOGFVMTBhVTMzYUQzM2FVMTlhTDI2YUwyN2FSMjZhRDE3YVUxMGFVMTBhUjE0YUQzMGFVMTlhTDlhVTI2YUQxMGFVMTJhTDE4YUwxNGFMMTBhUjEzYVUyOGFVMTJhVTExYUwxNGFVMjFhVTEzYUwyMWFEMzJhVTI1YVIzM2FVMzFhVTMxYUwxNmFSMzFhTDMwYUQxNmFVMTBhRDI4YVUxOWFSMjVhTDIwYUwyNWFVMjlhVTMxYUQyNmFVMjhhVTI1YUQyMWFVMTJhVTIwYUwxM2FMMjlhRDExYVU5YUQxN2FMMjBhTDE3YVIzMWFVMTlhRDhhTDI3YVIxNWFMMTNhUjI1YUwyMWFSMjZhRDMzYUw5YVIxNWFMMTBhTDI2YVIyMmFEMjJhVTMzYUwyNmFVMjRhRDIxYVUyOGFVMjhhRDI5YVUxNmFEMTBhVTE5YVIzMWFEMjRhVTE0YUwxOWFSMjZhRDE0YVUyMGFVMTZhVTE5YVUyN2FVMTBhVTEwYVUxOGFMMjRhVTI3YVUxM2FVMThhUjE2YUQyNmFVMzBhTDEzYUwyMWFSMTVhUjIyYUQyM2FVMzFhVTI0YVUxOWFVMTVhVTI1YUQzMGFVMjJhTDlhUjIzYUwyNWFMMTlhVTMwYVUyOWFVMjJhRDI0YVUxOWFEMTNhVTE2YUwzMGFSMzNhVTEwYVUyN2FVMThhVTI5YVUyMWFSMTRhUjIwYVUyM2FSMTRhVTIwYUwzM2FEMzBhVTIyYUQyN2FVMjJhTDIwYVI4YUwxMmFMMTBhUjI1YUw5YVIxMmFVMjBhVQ","endTick":3472,"row":42,"cause":"splash","scores":[42,0]},
  {"code":"MnwzODcyNzY5MTd8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NDg1fDVhVTE3YVUzMmFVMjhhVTMwYVUxMWFVMzJhVTMyYVUyOGFVMTBhVTMzYUQzM2FVMTlhTDI2YUwyN2FSMjZhRDE3YVUxMGFVMTBhUjE0YUQzMGFVMTlhTDlhVTI2YUQxMGFVMTJhTDE4YUwxNGFMMTBhUjEzYVUyOGFVMTJhVTExYUwxNGFVMjFhVTEzYUwyMWFEMzJhVTI1YVIzM2FVMzFhVTMxYUwxNmFSMzFhTDMwYUQxNmFVMTBhRDI4YVUxOWFSMjVhTDIwYUwyNWFVMjlhVTMxYUQyNmFVMjhhVTI1YUQyMWFVMTJhVTIwYUwxM2FMMjlhRDExYVU5YUQxN2FMMjBhTDE3YVIzMWFVMTlhRDhhTDI3YVIxNWFMMTNhUjI1YUwyMWFSMjZhRDMzYUw5YVIxNWFMMTBhTDI2YVIyMmFEMjJhVTMzYUwyNmFVMjRhRDIxYVUyOGFVMjhhRDI5YVUxNmFEMTBhVTE5YVIzMWFEMjRhVTE0YUwxOWFSMjZhRDE0YVUyMGFVMTZhVTE5YVUyN2FVMTBhVTEwYVUxOGFMMjRhVTI3YVUxM2FVMThhUjE2YUQyNmFVMzBhTDEzYUwyMWFSMTVhUjIyYUQyM2FVMzFhVTI0YVUxOWFVMTVhVTI1YUQzMGFVMjJhTDlhUjIzYUwyNWFMMTlhVTMwYVUyOWFVMjJhRDI0YVUxOWFEMTNhVTE2YUwzMGFSMzNhVTEwYVUyN2FVMThhVTI5YVUyMWFSMTRhUjIwYVUyM2FSMTRhVTIwYUwzM2FEMzBhVTIyYUQyN2FVMjJhTDIwYVI4YUwxMmFMMTBhUjI1YUw5YVIxMmFVMjBhVTIyYVUxMmFVMjRhTDIyYVIzM2FVMjFhUjE2YVIxMWFEMTlhVTIwYUwzMGFSMjhhTDMwYUwxMGFSMzFhTDI1YVIxN2FSMjJhRDEwYVUzMmFVMTNhUjE4YVIyM2FEMzBhRDIwYVUxMGFSMjNhRDI4YVUxNmFEMTlhTDI0YUwxMmFMMTlhUjE2YVIyNWFMMzJhTDIwYUwyM2FVMzNhRDlhVTEyYVIxNmFEMjBhVTEyYVIyMWFEMjVhVTI2YUwxMmFEMjBhVTI5YUQxM2FVOGFVMTNhUjE5YUwyNGFVMTlhVTIyYUwyNWFMMjVhTDE2YVUyNWFMMTJhUjMwYUwyMWFMMzFhUjI0YVIyOWFSMzNhUjI4YVI5YVIyNmFSMTdhUjI1YUQyMmFVOGFEMzJhUjE2YVIzMWFMMjNhTDE2YVUxNmFVMzJhVTE3YUQxNGFVMTlhVTIxYUwyNWFMMTVhUjEzYUQyMGFVMjBhTDE3YUQzMGFVMjRhVTIxYVU5YUwzMWFSMTdhTDI0YUwxNmFVMTBhVTE1YUw4YVUyNmFVMjNhRDI1YVUyN2FSOGFMMTJhUjExYUwxNmFVOWFVMjFhVTI5YVUxMmFV","endTick":6428,"row":61,"cause":"eagle","scores":[61,0]},
  {"code":"Mnw3NzQ1NTM4MzR8Y2xhc3NpY3xmcm9nLGZveHwxfDB8NjcwfDVhVTI3YVUyMWFVMjRhUjI0YUQxNmFMMTRhTDhhUjEwYUQzMmFVMTdhRDMyYVUxN2FMMzBhRDI1YVUxMmFMMjdhTDE2YUQyNmFVMTZhUjExYUwyMWFMMjBhUjMxYVIxOGFVMzJhVTEyYUQyN2FVMTBhVTIwYVUyMWFVOWFVMTlhVTEzYVUyOWFVMTdhVTMzYVUxNGFVMjdhVTE5YVUxNGFVMjRhVTIyYVUxN2FVMjhhVTE3YVUxMWFSMjJhUjE3YUQxMWFVMjJhRDEwYVUyMmFEMTdhVTEzYVUyM2FVMzNhRDI3YVUyOWFVMTBhVTI0YVUxMWFVMjlhVQ","endTick":1987,"row":30,"cause":"eagle","scores":[30,0]},
  {"code":"MnwyMzIzNjYxNTAyfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDE0MTB8NWFVMTJhVTEyYVUyMGFMMTlhRDIwYVUxMGFSMzNhTDIwYVIyOWFVMzNhUjE1YVIyOWFSMzBhRDE3YVUyNmFMOGFEMjBhVTI4YUQ4YVUxOGFMMjlhUjMyYUQyN2FVMTBhVTE4YVUyM2FEOWFVMzJhTDEyYVIzMmFMMTJhTDE3YVUyOWFEMzBhVTI1YUwyMWFVMjhhVTMxYVUxN2FVMjdhTDExYVUyNWFSMThhRDlhVTIzYVIxMmFMMTdhRDI1YVUxM2FEMjRhVTI0YUQxMmFSMTRhTDI1YUwzMWFSMTVhUjI5YVUzM2FSMjRhTDE4YVUxOWFVMTFhVTE3YVUxNWFVMjNhVTE4YVUyMGFVMjFhVTMxYVUyMGFVMjdhVTE2YVIxM2FMMjVhUjI3YUwxOWFEMThhVTMzYUwyMGFMMjVhUjIwYUwzMWFMMjBhUjE4YVUxN2FVOWFVMTVhUjEyYUwyNmFSMjRhTDIyYVIzMWFVMjlhVTE5YUwxMWFEMTVhVTE0YUQyM2FVMjBhRDI4YVUxNGFVOWFVMjRhVTI3YVUyMWFMMjRhRDI0YVUxMGFSMjNhUjIxYVUyM2FVMzFhVTIyYUwyOWFVMjVhVTMyYUQxOWFVMTRhTDI1YVIzM2FMMTFhUjIxYVIxMWFVMjFhVTMwYUQxN2FSMTBhUjI5YUwxMWFSMzBhTDI0YVIyOGFVMzJhVTEzYUwxNmFSMjBhTDMwYVIxNmFSMTlhRDE5YVUxOGFVMTlhVTE1YVUyMmFVMTdhTDMwYVIyNWFSMjZhVTMzYVUyNWFMMzNhRDEwYVU5YUQ4YVIxMWFEMjlhVTIzYUQyMGFVMjJhUjI0YUQyM2FVMjhhUjIyYUQyMGFVMjNhUjE0YVIxMGFSMjZhUjMzYUwxOGFEMzNhTDhhUjE4YVIxOWFMMjZhTDE0YUw4YUwyNmFEMTBhRDIyYVUxOGFSMTFhTDE0YUQyMGFVMzBhTDIyYVIyNGFVMjFhVTMwYVU4YVIxNmFMMTlhRDI1YVUyN2FSOWFEMTZhVTMzYVUyNmFSMTJhUjI3YVIyNmFVMjhhVTI5YVU4YVUxN2FMMTVhTDE4YVIzMmFSOWFSMTZhTDE2YUwxMWFMMTZhVTMzYVU4YVUxNmFV","endTick":4607,"row":50,"cause":"splash","scores":[50,0]},
  {"code":"MnwxNDAxMTgxMTQzfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDU1OXw1YVUxMGFVMjBhVTE4YVIyMmFSMjBhUjI2YVUxNmFVMjhhVTI4YVUxMmFSMTBhTDIzYUQxOWFVMTlhVTMxYUQyNWFEMjhhVTIwYUQyMGFVMThhTDIxYVUyN2FVMTlhTDEyYVIzM2FEMTNhVTIyYUQxOWFVMzNhVTEzYUwyM2FSMTlhTDMxYVU5YVUzM2FVMzJhVTIyYVUyNWFVMjJhVTE3YVUxMmFVMTZhVTEwYVUyNGFVMjJhVTIxYVUxNmFVOGFVMjhhVTI2YVUxOGFVMjZhTDE5YVUxMGFMMjdhUjIxYUwyMmFSMTNhUjE0YUwyNmFSMTNhTDIwYVI5YVIyN2FMMjVhVTMzYVUyNmFVMTBhVTIwYVUzMWFEMjVhVTMzYVIyMmFSMjdhRDI3YVUxOGFMMjdhRDI1YVUxMGFVMTZhRDMxYVUxMGFSMjhhUjIyYVUzMWFEMThhVTE0YVIyNWFSMjRhTDIzYVIxMmFMMzNhUjEzYUwzM2FVMjNhVTI5YUQxNWFVMTVhRDI1YVUyNmFEMjNhVTI0YVUyOGFVOWFVMTdhTDI5YVUxMWFVMTRhVTIwYVUzMmFMMjZhUjExYVIyMWFEMzJhVTEzYVIzMmFMMjVhRDMyYVUxOGFVMTJhRDlhVTI2YUQyN2FVMzJhVTIwYVIxMWFMMjZhUjE3YUwxOWFVMThhVTMzYVUyMWFVMTFhUjI4YUQyN2FVMjBhVTIyYVUyMWFVMjdhVTMxYVUzM2FVMzNhVTI3YVIyOWFMMzFhUjI3YVIxN2FVMjNhVTE5YVUyOGFVMTVhVTIzYVUzM2FVMjNhVTEwYUQxOWFVOGFEMTBhVTExYVUxOWFEMTJhVTIyYUQxNWFVMzJhRDMxYVU4OGFVMjBhVTE0YVUzMGFVMTRhVQ","endTick":3966,"row":55,"cause":"squash","scores":[55,0]}
];

test('gen: seed 42 gives the lane kinds the browser built', () => {
  const g = createWorldGen(42);
  assert.deepEqual(Array.from({ length: 31 }, (_, r) => g.lane(r).kind), KINDS_42);
  assert.deepEqual(Array.from({ length: 31 }, (_, r) => g.kind(r)), KINDS_42, 'the chain alone agrees');
});

test('gen: a row is the same whatever was asked before it, and fresh each time', () => {
  const a = createWorldGen(7), b = createWorldGen(7);
  for (let r = 300; r >= -12; r--) a.lane(r);   // backwards: the chain is walked once, in order
  for (const r of [0, 5, 37, 120, 250]) {
    const x = a.lane(r), y = b.lane(r);
    assert.deepEqual({ ...x, rng: null }, { ...y, rng: null }, 'row ' + r);
    assert.notEqual(x.objs, a.lane(r).objs, 'each call owns its moving state');
  }
  assert.notDeepEqual(createWorldGen(8).lane(30), createWorldGen(7).lane(30));
});

test('gen: rows below 4 are grass, one boss train per 100 rows, traffic wraps inside the span', () => {
  const g = createWorldGen(3);
  for (let r = -12; r < 4; r++) assert.equal(g.lane(r).kind, 'grass');
  const bosses = [];
  for (let r = 0; r < 600; r++) { const l = g.lane(r); if (l.boss) bosses.push(Math.floor(r / 100)); }
  assert.ok(bosses.length >= 3, 'boss trains: ' + bosses);
  assert.equal(new Set(bosses).size, bosses.length, 'at most one per hundred');
  for (let r = 4; r < 80; r++) {
    const l = g.lane(r);
    if (l.kind === 'road' || l.kind === 'river') for (const o of l.objs) for (const w of [0, 3.3, 1000]) {
      const x = trafficX(l, o, w);
      assert.ok(x >= -l.span / 2 && x < l.span / 2, `row ${r} x ${x}`);
    }
    if (l.kind === 'rail') {   // the schedule only moves forward and trains do not overlap
      let last = l.nextEnd;
      for (let w = 0; w < 200; w += 0.5) { railStep(l, w); assert.ok(l.nextStart >= last - l.pass - 1e-9); last = l.nextEnd; }
    }
  }
});

test('sim: recorded runs end where the browser ended them', () => {
  for (const run of BROWSER_RUNS) {
    const s = simulate(decodeReplay(run.code));
    assert.deepEqual({ endTick: s.endTick, row: s.row, cause: s.cause, scores: s.scores }, { endTick: run.endTick, row: run.row, cause: run.cause, scores: run.scores });
    assert.equal(s.score, Math.max(...run.scores));
    assert.equal(s.over, true);
  }
});

test('sim: createSim steps the countdown, then play, and exposes the live players', () => {
  const rp = decodeReplay(BROWSER_RUNS[0].code);
  const sim = createSim(rp);
  assert.equal(sim.state, 'countdown');
  let steps = 0, sawHop = false;
  while (sim.state === 'countdown') { sim.step(); steps++; }
  assert.ok(steps >= 359 && steps <= 361, 'about COUNTDOWN / STEP steps: ' + steps);
  assert.equal(sim.worldTick, rp.startTick);
  assert.equal(sim.tick, 0);
  while (sim.step()) {
    const p = sim.players[0];
    if (p.hop) { sawHop = true; assert.ok('t' in p.hop && 'fromRow' in p.hop && 'tz' in p.hop); }
  }
  assert.ok(sawHop);
  assert.equal(sim.end.endTick, simulate(rp).endTick);
  assert.equal(sim.step(), false, 'over stays over');
});

test('sim: a different run gives a different result; limits stop a run that will not end', () => {
  const rp = decodeReplay(BROWSER_RUNS[1].code);
  const s = simulate(rp);
  const cut = simulate({ ...rp, events: rp.events.slice(0, Math.floor(rp.events.length / 2)) });
  assert.ok(cut.score < s.score, `half the hops, fewer rows: ${cut.score} < ${s.score}`);
  assert.equal(simulate(rp, { maxTicks: 100 }), null);
  const part = simulate(rp, { until: 300 });
  assert.equal(part.over, false);
  assert.equal(part.endTick, 300);
  // an idle player is taken by the eagle (EAGLE_IDLE = 6 s after play begins, plus the swoop)
  const idle = simulate({ seed: 1, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 500, events: [] });
  assert.equal(idle.cause, 'eagle');
  assert.ok(Math.abs(idle.endTick * STEP - 6) < 0.05, 'eagle at ' + idle.endTick * STEP);
});

test('sim: a replay round-trips through its code', () => {
  const rp = decodeReplay(BROWSER_RUNS[2].code);
  assert.deepEqual(simulate(decodeReplay(encodeReplay(rp))), simulate(rp));
});

// the new kinds, rule by rule, on hand-made lanes (makeRules is what the browser and simulate() both run)
function bench(rows) {
  const G = { state: 'play', camRow: 0, playT: 0, worldTick: 1000, run: null };
  const lanes = new Map(rows.map((l, r) => [r, { r, coins: new Map(), trees: new Set(), objs: [], span: 34, secret: null, power: null, ...l }]));
  const rules = makeRules({ G, lane: r => lanes.get(r), coins() {}, over() {} });
  const p = { id: 0, joined: true };
  resetPlayer(p);
  const run = (n = 1) => { for (let i = 0; i < n; i++) { G.worldTick++; rules.stepPlayer(p, STEP); } };
  const settle = () => { for (let i = 0; i < 200 && p.hop; i++) run(); };
  return { G, lanes, rules, p, run, settle };
}

test('ice: a sideways hop slides one more column, stopped by a tree or the edge; forward hops do not slide', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'ice', trees: new Set([3]) }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1); b.settle();
  assert.deepEqual([b.p.row, b.p.x], [1, 0], 'onto ice: no slide');
  b.rules.tryMove(b.p, -1, 0); b.settle();
  assert.equal(b.p.x, -2, 'one hop left, one column of slide');
  b.rules.tryMove(b.p, 1, 0); b.settle();
  assert.equal(b.p.x, 0);
  b.rules.tryMove(b.p, 1, 0); b.settle();
  assert.equal(b.p.x, 2, 'hop to 1, slide to 2');
  b.p.x = 1; b.rules.tryMove(b.p, 1, 0); b.settle();
  assert.equal(b.p.x, 2, 'the tree at 3 stops the slide');
  b.p.x = 3.0; b.lanes.get(1).trees.clear(); b.rules.tryMove(b.p, 1, 0); b.settle();
  assert.equal(b.p.x, 4, 'the edge stops the slide');
  assert.equal(b.p.score, 1, 'a slide is not a row');
});

test('bridge: a plank holds for PLANK_BREAK steps, then you splash; it is back PLANK_BACK steps later', () => {
  const planks = new Map([[0, { breakAt: -1, backAt: -1 }], [1, { breakAt: -1, backAt: -1 }]]);
  const b = bench([{ kind: 'grass' }, { kind: 'bridge', planks }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1); b.settle();
  const landed = b.G.worldTick;
  assert.equal(plankState(b.lanes.get(1), 0, landed), 'cracking');
  b.run(PLANK_BREAK - 1);
  assert.equal(b.p.alive, true, 'still holding');
  b.run(1);
  assert.deepEqual([b.p.alive, b.p.cause], [false, 'splash']);
  assert.equal(plankState(b.lanes.get(1), 0, landed + PLANK_BREAK + PLANK_BACK - 1), 'down');
  assert.equal(plankState(b.lanes.get(1), 0, landed + PLANK_BREAK + PLANK_BACK), 'up');
  assert.equal(plankState(b.lanes.get(1), 1, landed), 'up', 'the next plank is fine');
  assert.equal(plankState(b.lanes.get(1), 3, landed), 'down', 'no plank: water');
  // hopping on in time is safe; landing on water sinks
  const c = bench([{ kind: 'grass' }, { kind: 'bridge', planks: new Map([[0, { breakAt: -1, backAt: -1 }], [1, { breakAt: -1, backAt: -1 }]]) }, { kind: 'grass' }]);
  c.p.x = 0; c.rules.tryMove(c.p, 0, 1); c.settle(); c.run(30); c.rules.tryMove(c.p, 1, 0); c.settle(); c.run(30); c.rules.tryMove(c.p, 0, 1); c.settle(); c.run(200);
  assert.deepEqual([c.p.alive, c.p.row], [true, 2]);
  const d = bench([{ kind: 'grass' }, { kind: 'bridge', planks: new Map([[0, { breakAt: -1, backAt: -1 }]]) }]);
  d.p.x = 2; d.rules.tryMove(d.p, 0, 1); d.settle();
  assert.equal(d.p.cause, 'splash');
});

test('rocks: a boulder squashes like a car; a shield rescues', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'rocks', objs: [{ x: 0, len: 0.9 }] }]);
  b.p.x = 0; b.rules.tryMove(b.p, 0, 1); b.settle(); b.run();
  assert.deepEqual([b.p.alive, b.p.cause], [false, 'squash']);
  const c = bench([{ kind: 'grass' }, { kind: 'rocks', objs: [{ x: 0, len: 0.9 }] }]);
  c.rules.giveShield(c.p);
  c.p.x = 0; c.rules.tryMove(c.p, 0, 1); c.settle(); c.run();
  assert.deepEqual([c.p.alive, c.p.row, c.p.shield], [true, 0, false], 'back to the grass, shield used');
  const d = bench([{ kind: 'grass' }, { kind: 'rocks', objs: [{ x: 3, len: 0.9 }] }]);
  d.p.x = 0; d.rules.tryMove(d.p, 0, 1); d.settle(); d.run(10);
  assert.equal(d.p.alive, true, 'a boulder three columns off misses');
});

test('gen: the late kinds start where rules.js says and keep their data', () => {
  const first = {};
  for (let seed = 1; seed <= 30; seed++) {
    const g = createWorldGen(seed);
    for (let r = 0; r < 300; r++) {
      const l = g.lane(r);
      if (!(l.kind in first) || r < first[l.kind]) first[l.kind] = r;
      if (l.kind === 'bridge') { assert.ok(l.planks.size >= 3 && [...l.planks.keys()].every(x => Math.abs(x) <= 4)); }
      if (l.kind === 'rocks') assert.ok(l.objs.length >= 1 && l.speed > 0 && l.speed < 4);
      if (l.kind === 'ice') assert.ok(!l.trees.has(0), 'column 0 is always open');
    }
  }
  assert.ok(first.ice >= ICE_FROM && first.bridge >= BRIDGE_FROM && first.rocks >= ROCKS_FROM, JSON.stringify(first));
  assert.ok(first.ice < 40 && first.bridge < 70 && first.rocks < 90, 'and they do come: ' + JSON.stringify(first));
});

// the animals' edges (rules.js TRAITS) and the versus modes, on hand-made lanes
function benchWith(rows, chars, mode = 'classic') {
  const G = { state: 'play', mode, camRow: 0, playT: 0, worldTick: 1000, run: null };
  const lanes = new Map(rows.map((l, r) => [r, { r, coins: new Map(), trees: new Set(), objs: [], span: 34, secret: null, power: null, ...l }]));
  const players = chars.map((key, id) => ({ id, joined: true, trait: traitOf(key) }));
  const rules = makeRules({ G, lane: r => lanes.get(r), coins() {}, over() {}, players });
  players.forEach(resetPlayer);
  const run = (n = 1) => { for (let i = 0; i < n; i++) { G.worldTick++; G.playT += STEP; for (const p of players) if (p.alive) rules.stepPlayer(p, STEP); } };
  const hopTicks = p => { let n = 0; while (p.hop && n < 500) { run(); n++; } return n; };
  // every player hops at once: the tick each one lands on (run() steps them all, so one at a time would not do)
  const landTicks = () => { const t = players.map(() => 0); for (let n = 1; players.some(p => p.hop) && n < 500; n++) { run(); players.forEach((p, i) => { if (!t[i] && !p.hop) t[i] = n; }); } return t; };
  return { G, lanes, rules, players, run, hopTicks, landTicks };
}
const grassRows = n => Array.from({ length: n }, () => ({ kind: 'grass' }));

test('traits: the bunny hops faster, the robot waits longer for the eagle, the penguin does not slide', () => {
  const b = benchWith(grassRows(6), ['frog', 'bunny']);
  const [frog, bunny] = b.players;
  b.rules.tryMove(frog, 0, 1); b.rules.tryMove(bunny, 0, 1);
  const [tf, tb] = b.landTicks();
  assert.ok(tb < tf, `bunny ${tb} ticks < frog ${tf}`);
  assert.ok(Math.abs(tb / tf - 0.8) < 0.1, 'about 0.8 of a frog hop');
  const r = benchWith(grassRows(6), ['frog', 'robot']);
  r.run(Math.round(6 / STEP) + 5);   // the frog's eagle has arrived; the robot's has not
  assert.ok(r.players[0].eagle && !r.players[1].eagle, 'the robot has 3 s more');
  r.run(Math.round(3 / STEP) + 5);
  assert.ok(r.players[1].eagle, 'then the eagle comes for the robot too');
  const ice = benchWith([{ kind: 'grass' }, { kind: 'ice' }], ['penguin', 'frog']);
  for (const p of ice.players) { p.x = 0; ice.rules.tryMove(p, 0, 1); ice.hopTicks(p); ice.rules.tryMove(p, 1, 0); ice.hopTicks(p); }
  assert.deepEqual(ice.players.map(p => p.x), [1, 2], 'penguin stops at 1, frog slides to 2');
});

test('traits: the cat survives one fall into water; the turtle has one more row of slack', () => {
  const b = benchWith([{ kind: 'grass' }, { kind: 'lily', pads: new Set([3]) }], ['cat', 'frog']);
  for (const p of b.players) { p.x = 0; b.rules.tryMove(p, 0, 1); b.hopTicks(p); }
  const [cat, frog] = b.players;
  assert.ok(!frog.alive && frog.cause === 'splash');
  assert.ok(cat.alive && cat.lives === 0, 'the cat used its life');
  assert.equal(cat.row, 0, 'and hopped back to the grass');
  b.hopTicks(cat); cat.x = 0; b.rules.tryMove(cat, 0, 1); b.hopTicks(cat);
  assert.ok(!cat.alive, 'the second fall counts');
  const t = benchWith(grassRows(3), ['turtle', 'frog']);
  t.G.camRow = 5;   // 5 rows ahead of row 0: a frog is out (limit 4.5), a turtle is not (5.5)
  t.run();
  assert.deepEqual(t.players.map(p => p.alive), [true, false]);
});

test('modes: tag speeds up the player behind; coin war counts coins per player; winnerOf picks by mode', () => {
  const b = benchWith(grassRows(8), ['frog', 'frog'], 'tag');
  const [a, c] = b.players;
  c.row = 3;   // c is ahead
  b.rules.tryMove(a, 0, 1); b.rules.tryMove(c, 0, 1);
  const [ta, tc] = b.landTicks();
  assert.ok(ta < tc, `behind ${ta} ticks < ahead ${tc}`);
  const w = benchWith([{ kind: 'grass' }, { kind: 'grass', coins: new Map([[0, {}], [1, {}]]) }], ['frog', 'fox'], 'coinwar');
  const [p1, p2] = w.players;
  p1.x = 0; p2.x = 1;
  w.rules.tryMove(p1, 0, 1); w.rules.tryMove(p2, 0, 1); w.hopTicks(p1); w.hopTicks(p2);
  assert.deepEqual([p1.coins, p2.coins], [1, 1]);
  p2.coins = 3;
  assert.equal(winnerOf(w.players, 'coinwar'), p2, 'most coins wins the coin war');
  p1.score = 9;
  assert.equal(winnerOf(w.players, 'classic'), p1, 'the higher score wins otherwise');
  p2.alive = false;
  assert.equal(winnerOf(w.players, 'race'), p1, 'in a race the one still standing');
  assert.equal(winnerOf([{ joined: true }, { joined: false }], 'classic'), null, 'one player: nobody wins');
});

test('near miss: a car that passes just short of a hit adds one combo, once per car', () => {
  const b = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 3, len: 1.4 }] }], ['frog']);
  const p = b.players[0];
  p.x = 0; b.rules.tryMove(p, 0, 1); b.hopTicks(p);
  assert.equal(p.combo, 1);
  b.lanes.get(1).objs[0].x = 0 + 0.7 + 0.28 + 0.3;   // the car's edge 0.3 from a hit
  b.run();
  assert.equal(p.combo, 2, 'one near miss');
  b.run(5);
  assert.equal(p.combo, 2, 'the same car does not count again');
  assert.ok(p.alive);
});
