// Fast tests for js/gen.js and js/sim.js (no browser): the world as data and the run without a screen.
// Run: node tests/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGen, railStep, standColumns, standGroups, trafficX } from '../js/gen.js';
import { createSim, makeRules, resetPlayer, simulate, winnerOf } from '../js/sim.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { BOMB_TICKS, BRIDGE_FROM, CLIFF_FROM, HOP_TIME, ICE_FROM, LEAD_FROM, LEAD_GAP, LEAD_SLOW, PLANK_BACK, PLANK_BREAK, PORTAL_FROM, ROCKS_FROM, SPRING_FROM, SPRING_HOP, STEP, plankState, traitOf } from '../js/rules.js';

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
      if (l.kind === 'portal') { const [a, b] = l.portals; assert.ok(a !== b && Math.abs(a) <= 4 && Math.abs(b) <= 4 && !l.coins.has(a) && !l.coins.has(b) && !(l.power && l.portals.includes(l.power.x))); }
      if (l.kind === 'cliff') assert.ok(l.planks.size === 9 && [...l.planks.values()].every(t => t.breakAt === -1));
      if (l.kind === 'spring') assert.ok(standColumns(l) === null && l.objs.length === 0);
    }
  }
  assert.ok(first.ice >= ICE_FROM && first.bridge >= BRIDGE_FROM && first.rocks >= ROCKS_FROM, JSON.stringify(first));
  assert.ok(first.spring >= SPRING_FROM && first.portal >= PORTAL_FROM && first.cliff >= CLIFF_FROM, JSON.stringify(first));
  assert.ok(first.ice < 40 && first.bridge < 70 && first.rocks < 90 && first.spring < 130 && first.portal < 150 && first.cliff < 170, 'and they do come: ' + JSON.stringify(first));
});

test('gen: boss moments: one twister (grass) and one flood (river) per 100 rows past row 100, by the chain', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = createWorldGen(seed), tw = [], fl = [];
    let plainRiver = null;
    for (let r = 0; r < 400; r++) {
      const l = g.lane(r);
      if (l.twister) {
        assert.ok(l.kind === 'grass' && r >= 100, `seed ${seed} row ${r}`);
        assert.ok(l.objs.length === 1 && l.objs[0].twister && l.objs[0].len === 0.9 && l.speed > 1 && Math.abs(l.dir) === 1);
        for (const w of [0, 7.5, 1000]) assert.ok(Math.abs(trafficX(l, l.objs[0], w)) <= l.span / 2, 'it crosses like traffic');
        tw.push(Math.floor(r / 100));
      } else if (l.kind === 'grass') assert.equal(l.objs.length, 0, 'other grass rows stay still');
      if (l.flood) { assert.ok(l.kind === 'river' && r >= 100); fl.push(Math.floor(r / 100)); }
      else if (l.kind === 'river' && r >= 100 && !plainRiver) plainRiver = l;
    }
    assert.ok(tw.length >= 2 && new Set(tw).size === tw.length, `twisters once per hundred: ${tw}`);
    assert.ok(fl.length >= 2 && new Set(fl).size === fl.length, `floods once per hundred: ${fl}`);
    // the first grass / river rows of the block carry them
    const firstGrass = [], firstRiver = [];
    for (let r = 100; r < 400; r++) { const l = g.lane(r); if (l.kind === 'grass' && !firstGrass[Math.floor(r / 100)]) firstGrass[Math.floor(r / 100)] = l; if (l.kind === 'river' && !firstRiver[Math.floor(r / 100)]) firstRiver[Math.floor(r / 100)] = l; }
    for (const l of firstGrass) if (l) assert.ok(l.twister, 'first grass row of the block: ' + l.r);
    for (const l of firstRiver) if (l) assert.ok(l.flood, 'first river row of the block: ' + l.r);
  }
  // a flood is the same river, 1.5 times faster: no draw moved
  const g = createWorldGen(5);
  let flood = null;
  for (let r = 100; r < 300 && !flood; r++) { const l = g.lane(r); if (l.flood) flood = l; }
  assert.ok(flood && flood.objs.length >= 3 && flood.speed > 1.5, 'a flood holds its logs and is fast');
  // rows below 100 are what they were before boss moments existed: the saved runs still check that; here the chain fields
  for (let r = 0; r < 100; r++) { const l = g.lane(r); assert.ok(!l.twister && !l.flood && l.twisterChunk === 0 && l.floodChunk === 0); }
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

test('gen: every world has a way forward (pads over pads, planks reachable, no tree wall after a lily row)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = createWorldGen(seed);
    let prev = null;
    for (let r = 1; r <= 220; r++) {
      const lane = g.lane(r), stand = standColumns(lane), here = stand && new Set(stand);
      if (here) for (const group of standGroups(prev)) assert.ok(group.some(x => here.has(x)), `seed ${seed} row ${r} (${lane.kind}): the group ${group} of row ${r - 1} has no straight hop`);
      if (lane.kind === 'lily') assert.ok(lane.pads.size >= 3 && lane.pads.size <= 9);
      prev = stand;
    }
  }
  assert.deepEqual(standGroups([-4, -3, 0, 1, 2, 4]), [[-4, -3], [0, 1, 2], [4]]);
  assert.deepEqual(standGroups(null), [[-4, -3, -2, -1, 0, 1, 2, 3, 4]]);
});

test('near miss: a new visit of a row counts its cars again; the same visit does not', () => {
  const b = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 3, len: 1.4 }] }, { kind: 'grass' }], ['frog']);
  const p = b.players[0];
  b.G.run = { coins: 0, row: 0, rivers: 0, hops: 0, logs: 0, combo: 0, powers: 0, secrets: 0, nears: 0 };
  p.x = 0; b.rules.tryMove(p, 0, 1); b.hopTicks(p);
  b.lanes.get(1).objs[0].x = 0.7 + 0.28 + 0.3;
  b.run(5);
  assert.equal(b.G.run.nears, 1, 'one near miss while standing by the car');
  b.rules.tryMove(p, 0, 1); b.hopTicks(p);    // up (the car is still near while leaving: no second count)
  assert.equal(b.G.run.nears, 1);
  b.rules.tryMove(p, 0, -1); b.hopTicks(p);   // and back: a fresh visit, the same car counts again
  b.run(5);
  assert.equal(b.G.run.nears, 2, 'the car counts again on the next visit, once');
});

test('spring: a forward hop out of a spring row lands two rows on, higher and slower; other hops are normal', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'spring' }, { kind: 'grass', trees: new Set([2]) }, { kind: 'grass', coins: new Map([[0, {}]]) }, { kind: 'grass' }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1); b.settle();
  assert.deepEqual([b.p.row, b.p.hop], [1, null], 'onto the spring: one row');
  b.rules.tryMove(b.p, 0, 1);
  assert.ok(b.p.hop.high && b.p.hop.dr === 2 && Math.abs(b.p.hop.dur - HOP_TIME * SPRING_HOP) < 1e-9, 'a high, long hop');
  let n = 0; while (b.p.hop) { b.run(); n++; }
  assert.deepEqual([b.p.row, b.p.score, b.p.coins], [3, 3, 1], 'two rows on, both scored, the coin there picked');
  assert.ok(n > HOP_TIME / STEP + 2, 'longer than a plain hop: ' + n);
  b.rules.tryMove(b.p, 0, -1); b.settle();
  assert.equal(b.p.row, 2, 'a hop back from grass is one row');
  b.rules.tryMove(b.p, 0, -1); b.settle(); b.rules.tryMove(b.p, 1, 0); b.settle();
  assert.deepEqual([b.p.row, b.p.x, b.p.hop], [1, 1, null], 'sideways on the spring: no spring');
  b.rules.tryMove(b.p, 0, -1); b.settle();
  assert.equal(b.p.row, 0, 'back off the spring: one row');
  b.p.x = 2; b.rules.tryMove(b.p, 0, 1); b.settle();
  assert.equal(b.p.row, 1);
  b.rules.tryMove(b.p, 0, 1); b.settle();
  assert.equal(b.p.row, 3, 'the tree on the row between is hopped over');
  b.p.row = 1; b.lanes.get(3).trees.add(2);
  b.rules.tryMove(b.p, 0, 1); b.settle();
  assert.equal(b.p.row, 1, 'a tree on the landing row blocks the spring hop');
});

test('portal: landing on a portal column puts you on the other one at once; the other columns are plain ground', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'portal', portals: [-3, 2], coins: new Map([[2, {}]]) }, { kind: 'grass' }]);
  const seen = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, fx: { teleport: (p, lane, fromX) => seen.push([lane.r, fromX, p.x]) } });
  b.p.x = -3; rules.tryMove(b.p, 0, 1); while (b.p.hop) { b.G.worldTick++; rules.stepPlayer(b.p, STEP); }
  assert.deepEqual([b.p.row, b.p.x, b.p.coins], [1, 2, 1], 'out of the other portal, with the coin there');
  assert.deepEqual(seen, [[1, -3, 2]]);
  rules.tryMove(b.p, -1, 0); while (b.p.hop) { b.G.worldTick++; rules.stepPlayer(b.p, STEP); }
  assert.equal(b.p.x, 1, 'a plain column');
  rules.tryMove(b.p, 1, 0); while (b.p.hop) { b.G.worldTick++; rules.stepPlayer(b.p, STEP); }
  assert.deepEqual([b.p.x, seen.length], [-3, 2], 'back into the portal: out the other side again');
  assert.ok(b.p.alive);
});

test('cliff: a tile breaks PLANK_BREAK steps after a landing and never comes back; a fall kills, the shield rescues, the cat does not', () => {
  const tiles = () => new Map([-4, -3, -2, -1, 0, 1, 2, 3, 4].map(x => [x, { breakAt: -1, backAt: -1 }]));
  const b = bench([{ kind: 'grass' }, { kind: 'cliff', planks: tiles() }, { kind: 'grass' }]);
  b.p.x = 0; b.rules.tryMove(b.p, 0, 1); b.settle();
  const landed = b.G.worldTick, lane = b.lanes.get(1);
  assert.equal(plankState(lane, 0, landed), 'cracking');
  assert.equal(plankState(lane, 0, landed + PLANK_BREAK + PLANK_BACK + 100000), 'down', 'gone for good');
  b.run(PLANK_BREAK - 1);
  assert.ok(b.p.alive, 'still holding');
  b.run(1);
  assert.deepEqual([b.p.alive, b.p.cause], [false, 'fall']);
  // hop along the ledge in time: each tile breaks behind you
  const c = bench([{ kind: 'grass' }, { kind: 'cliff', planks: tiles() }, { kind: 'grass' }]);
  c.p.x = 0; c.rules.tryMove(c.p, 0, 1); c.settle(); c.run(20); c.rules.tryMove(c.p, 1, 0); c.settle(); c.run(20); c.rules.tryMove(c.p, 0, 1); c.settle(); c.run(200);
  assert.deepEqual([c.p.alive, c.p.row], [true, 2]);
  assert.deepEqual([plankState(c.lanes.get(1), 0, c.G.worldTick), plankState(c.lanes.get(1), 1, c.G.worldTick), plankState(c.lanes.get(1), 2, c.G.worldTick)], ['down', 'down', 'up']);
  c.rules.tryMove(c.p, 0, -1); c.settle();
  assert.deepEqual([c.p.alive, c.p.cause], [false, 'fall'], 'back onto a broken tile: a fall');
  // the shield hops you back to solid ground (never onto the cliff); the cat's extra life is for water only
  const d = bench([{ kind: 'grass' }, { kind: 'cliff', planks: tiles() }, { kind: 'cliff', planks: tiles() }]);
  d.rules.giveShield(d.p);
  d.p.x = 0; d.rules.tryMove(d.p, 0, 1); d.settle(); d.rules.tryMove(d.p, 0, 1); d.settle(); d.run(PLANK_BREAK + 1);
  assert.deepEqual([d.p.alive, d.p.row, d.p.shield], [true, 0, false], 'rescued to the grass, past the cliff row behind');
  const e = benchWith([{ kind: 'grass' }, { kind: 'cliff', planks: tiles() }], ['cat']);
  const cat = e.players[0];
  cat.x = 0; e.rules.tryMove(cat, 0, 1); e.hopTicks(cat); e.run(PLANK_BREAK + 1);
  assert.deepEqual([cat.alive, cat.cause, cat.lives], [false, 'fall', 1], 'the cat has no life to spare on a cliff');
});

test('twister: the thing crossing a boss grass row kills like a car (no near miss); the shield rescues', () => {
  const b = benchWith([{ kind: 'grass' }, { kind: 'grass', twister: true, objs: [{ x: 3, len: 0.9, twister: true }] }, { kind: 'grass' }], ['frog']);
  const p = b.players[0];
  p.x = 0; b.rules.tryMove(p, 0, 1); b.hopTicks(p);
  b.lanes.get(1).objs[0].x = 0.45 + 0.28 + 0.3;   // just short of a hit
  b.run(3);
  assert.deepEqual([p.alive, p.combo], [true, 1], 'no near miss for a twister');
  b.lanes.get(1).objs[0].x = 0.5;
  b.run();
  assert.deepEqual([p.alive, p.cause], [false, 'twister']);
  const c = benchWith([{ kind: 'grass' }, { kind: 'grass', twister: true, objs: [{ x: 0, len: 0.9, twister: true }] }], ['frog']);
  c.rules.giveShield(c.players[0]);
  c.players[0].x = 0; c.rules.tryMove(c.players[0], 0, 1); c.hopTicks(c.players[0]); c.run();
  assert.deepEqual([c.players[0].alive, c.players[0].row, c.players[0].shield], [true, 0, false]);
  // the twister row of this world (createSim moves the twister with the world clock like a car)
  const g = createWorldGen(3);
  let tw = null;
  for (let r = 100; r < 300 && !tw; r++) if (g.lane(r).twister) tw = r;
  assert.ok(tw, 'seed 3 has a twister');
});

test('leader: two players, the one 5 rows ahead past row 30 hops slower, not in race or tag; p.lead says so', () => {
  const rows = Array.from({ length: 60 }, () => ({ kind: 'grass' }));
  const b = benchWith(rows, ['frog', 'frog']);
  const [a, c] = b.players;
  const labels = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, players: b.players, fx: { label: p => labels.push(p.id) } });
  a.row = LEAD_FROM; c.row = LEAD_FROM - LEAD_GAP;
  b.G.worldTick++; rules.stepPlayer(a, STEP); rules.stepPlayer(c, STEP);
  assert.deepEqual([a.lead, c.lead, labels], [true, false, [0]], 'the leader is labelled once');
  rules.tryMove(a, 0, 1); rules.tryMove(c, 0, 1);
  assert.ok(Math.abs(a.hop.dur / c.hop.dur - LEAD_SLOW) < 1e-9, 'the leader hops slower');
  b.G.worldTick++; rules.stepPlayer(a, STEP); rules.stepPlayer(c, STEP);
  assert.deepEqual(labels, [0], 'no change, no new label');
  // below the gap, below LEAD_FROM, in race or tag, or alone: no slowdown
  const check = (rowA, rowC, mode, alive = true, expect = false) => {
    const w = benchWith(rows, ['frog', 'frog'], mode);
    const [x, y] = w.players;
    x.row = rowA; y.row = rowC; y.alive = alive;
    w.run(); assert.equal(x.lead, expect, `lead: ${rowA} vs ${rowC} ${mode} alive=${alive}`);
    w.rules.tryMove(x, 0, 1);
    assert.equal(Math.abs(x.hop.dur / HOP_TIME - LEAD_SLOW) < 1e-9, expect, `${rowA} vs ${rowC} ${mode} alive=${alive}`);
  };
  check(LEAD_FROM, LEAD_FROM - LEAD_GAP + 1, 'classic');
  check(LEAD_FROM - 1, LEAD_FROM - 1 - LEAD_GAP, 'classic');
  check(LEAD_FROM, LEAD_FROM - LEAD_GAP, 'race');
  check(LEAD_FROM, LEAD_FROM - LEAD_GAP, 'tag');
  check(LEAD_FROM, LEAD_FROM - LEAD_GAP, 'classic', false);
  check(LEAD_FROM, LEAD_FROM - LEAD_GAP, 'coinwar', true, true);
  check(LEAD_FROM + 20, 0, 'daily', true, true);
  const solo = benchWith(rows, ['frog']);
  solo.players[0].row = 50; solo.rules.tryMove(solo.players[0], 0, 1);
  assert.equal(solo.players[0].hop.dur, HOP_TIME, 'alone: nobody to wait for');
});

test('bomb: with two players a magnet on a bomb row blocks the column ahead of the other player for BOMB_TICKS', () => {
  const rows = Array.from({ length: 30 }, () => ({ kind: 'grass' }));
  rows[24] = { kind: 'grass', power: { x: 0, kind: 'magnet' } };   // row 24: a bomb row
  rows[23] = { kind: 'grass', power: { x: 0, kind: 'magnet' } };   // row 23: a plain magnet
  const b = benchWith(rows, ['frog', 'fox']);
  const [a, c] = b.players;
  const log = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, players: b.players,
    fx: { bomb: (p, o, lane, x) => log.push(['bomb', p.id, o.id, lane.r, x]), unbomb: (lane, x) => log.push(['unbomb', lane.r, x]), power: (p, lane, pw) => log.push(['power', pw.kind]) } });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { b.G.worldTick++; b.G.playT += STEP; for (const p of b.players) if (p.alive) rules.stepPlayer(p, STEP); } };
  a.row = 22; a.x = 0; c.row = 10; c.x = 3.4;
  rules.tryMove(a, 0, 1); while (a.hop) step();
  assert.deepEqual([a.magnetT > 0, log], [true, [['power', 'magnet']]], 'row 23 is not a bomb row: a magnet');
  a.magnetT = 0;
  rules.tryMove(a, 0, 1); const picked = b.G.worldTick + Math.round(HOP_TIME / STEP); while (a.hop) step();
  assert.deepEqual(log.slice(1), [['bomb', 0, 1, 11, 3], ['power', 'bomb']], 'the bomb lands on row 11 column 3 (the fox at 3.4)');
  assert.ok(b.lanes.get(11).trees.has(3) && !a.magnetT && !a.shield);
  rules.tryMove(c, 0, 1);
  assert.equal(c.hop, null, 'the fox can not hop onto the bombed column');
  rules.tryMove(c, -1, 1); while (c.hop) step();
  assert.deepEqual([c.row, c.x], [11, 2], 'but around it');
  while (b.G.worldTick < picked + BOMB_TICKS - 2) step();
  assert.ok(b.lanes.get(11).trees.has(3), 'still blocked');
  step(3);
  assert.ok(!b.lanes.get(11).trees.has(3), 'freed after BOMB_TICKS');
  assert.deepEqual(log[log.length - 1], ['unbomb', 11, 3]);
  // the other player gone: the bomb is a shield for the picker. Alone: a magnet is a magnet
  const d = benchWith(rows, ['frog', 'fox']);
  d.players[1].alive = false;
  d.players[0].row = 23; d.players[0].x = 0; d.rules.tryMove(d.players[0], 0, 1); d.hopTicks(d.players[0]);
  assert.deepEqual([d.players[0].shield, d.players[0].magnetT], [true, 0]);
  const e = benchWith(rows, ['frog']);
  e.players[0].row = 23; e.players[0].x = 0; e.rules.tryMove(e.players[0], 0, 1); e.hopTicks(e.players[0]);
  assert.ok(e.players[0].magnetT > 0 && !e.players[0].shield);
  // a bomb at the edge is clamped to the play columns; a tree already there stays after the bomb
  const f = benchWith(rows, ['frog', 'fox']);
  f.lanes.get(11).trees.add(4);
  f.players[1].row = 10; f.players[1].x = 4; f.players[0].row = 23; f.players[0].x = 0;
  f.rules.tryMove(f.players[0], 0, 1); f.hopTicks(f.players[0]); f.run(BOMB_TICKS + 5);
  assert.ok(f.lanes.get(11).trees.has(4), 'the tree stays');
  // water ahead of the other player blocks nothing (logs decide there): the picker gets a shield instead
  const g = benchWith(rows, ['frog', 'fox']);
  g.lanes.get(11).kind = 'river'; g.lanes.get(11).objs = [];
  g.players[1].row = 10; g.players[1].x = 0; g.players[0].row = 23; g.players[0].x = 0;
  g.rules.tryMove(g.players[0], 0, 1); g.hopTicks(g.players[0]);
  assert.ok(g.players[0].shield && !g.lanes.get(11).trees.size, 'no rock on water, a shield for the picker');
  // a second bomb on the same column keeps the rock longer instead of doubling it; reset() lifts what is left
  const h = benchWith(rows, ['frog', 'fox']);
  const hl = [];
  const hr = makeRules({ G: h.G, lane: r => h.lanes.get(r), coins() {}, over() {}, players: h.players, fx: { bomb: () => hl.push('bomb'), unbomb: (lane, x) => hl.push('unbomb' + lane.r + ':' + x) } });
  const hstep = n => { for (let i = 0; i < n; i++) { h.G.worldTick++; h.G.playT += STEP; for (const p of h.players) if (p.alive) hr.stepPlayer(p, STEP); } };
  h.players[1].row = 10; h.players[1].x = 0; h.players[0].row = 23; h.players[0].x = 0;
  hr.tryMove(h.players[0], 0, 1); hstep(40);
  h.lanes.get(28).power = { x: 0, kind: 'magnet' };
  h.players[0].row = 27; h.players[0].hop = null; hr.tryMove(h.players[0], 0, 1); hstep(BOMB_TICKS - 20);
  assert.deepEqual(hl, ['bomb', 'bomb'], 'the second bomb only stretched the first');
  assert.ok(h.lanes.get(11).trees.has(0), 'still blocked: the second bomb set a new end');
  hr.reset();
  assert.deepEqual([hl[2], h.lanes.get(11).trees.has(0)], ['unbomb11:0', false], 'a new game lifts the bomb');
});
