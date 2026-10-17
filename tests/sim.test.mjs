// Fast tests for js/gen.js and js/sim.js (no browser): the world as data and the run without a screen.
// Run: node tests/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorldGen, railStep, standColumns, standGroups, trafficX, wetAt } from '../js/gen.js';
import { createSim, makeRules, resetPlayer, simulate, winnerOf } from '../js/sim.js';
import { decodeReplay, encodeReplay } from '../js/replay.js';
import { LOG_SLACK_BODY, PLAY_HALF, BOMB_TICKS, BRIDGE_FROM, CLIFF_FROM, COMBO_GAP, EAGLE_IDLE, EAGLE_SWOOP, EAGLE_WARN, HOP_TIME, ICE_FROM, LEAD_FROM, LEAD_GAP, LEAD_SLOW, MAGNET_REACH, MAGNET_TIME, PLANK_BACK, PLANK_BREAK, PORTAL_FROM, ROCKS_FROM, SPRING_FROM, SPRING_HOP, STEP, TRAITS, dailySeedFor, hashString, plankState, traitOf } from '../js/rules.js';

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
  {"code":"MnwxNDAxMTgxMTQzfGNsYXNzaWN8ZnJvZyxmb3h8MXwwfDU1OXw1YVUxMGFVMjBhVTE4YVIyMmFSMjBhUjI2YVUxNmFVMjhhVTI4YVUxMmFSMTBhTDIzYUQxOWFVMTlhVTMxYUQyNWFEMjhhVTIwYUQyMGFVMThhTDIxYVUyN2FVMTlhTDEyYVIzM2FEMTNhVTIyYUQxOWFVMzNhVTEzYUwyM2FSMTlhTDMxYVU5YVUzM2FVMzJhVTIyYVUyNWFVMjJhVTE3YVUxMmFVMTZhVTEwYVUyNGFVMjJhVTIxYVUxNmFVOGFVMjhhVTI2YVUxOGFVMjZhTDE5YVUxMGFMMjdhUjIxYUwyMmFSMTNhUjE0YUwyNmFSMTNhTDIwYVI5YVIyN2FMMjVhVTMzYVUyNmFVMTBhVTIwYVUzMWFEMjVhVTMzYVIyMmFSMjdhRDI3YVUxOGFMMjdhRDI1YVUxMGFVMTZhRDMxYVUxMGFSMjhhUjIyYVUzMWFEMThhVTE0YVIyNWFSMjRhTDIzYVIxMmFMMzNhUjEzYUwzM2FVMjNhVTI5YUQxNWFVMTVhRDI1YVUyNmFEMjNhVTI0YVUyOGFVOWFVMTdhTDI5YVUxMWFVMTRhVTIwYVUzMmFMMjZhUjExYVIyMWFEMzJhVTEzYVIzMmFMMjVhRDMyYVUxOGFVMTJhRDlhVTI2YUQyN2FVMzJhVTIwYVIxMWFMMjZhUjE3YUwxOWFVMThhVTMzYVUyMWFVMTFhUjI4YUQyN2FVMjBhVTIyYVUyMWFVMjdhVTMxYVUzM2FVMzNhVTI3YVIyOWFMMzFhUjI3YVIxN2FVMjNhVTE5YVUyOGFVMTVhVTIzYVUzM2FVMjNhVTEwYUQxOWFVOGFEMTBhVTExYVUxOWFEMTJhVTIyYUQxNWFVMzJhRDMxYVU4OGFVMjBhVTE0YVUzMGFVMTRhVQ","endTick":3966,"row":55,"cause":"squash","scores":[55,0]},
  // rules 3 (the first field of the code), played in the browser
  {"code":"M3wzMTMzN3xjbGFzc2ljfGZyb2csZm94fDF8MHwzODN8MThhVTQ4YVU0OGFVNDRhUjQ4YVU0OGFVNDhhTDQ4YVU5MGFVNDhhVQ","endTick":502,"row":8,"cause":"splash","scores":[8,0]},
  {"code":"M3w4NTE1MzI2MnxjbGFzc2ljfGZyb2csZm94fDF8MHw0MDB8NDJhVTQ2YVIzM2FSNDRhUjIzYVUyM2FMMjdhVTM3YVUyNGFVMjhhVTQwYVUzNGFVNDZhTDM5YVU0NWFVMjRhVTI4YUQzN2FVMzZhUjQ3YVUzOWFVMzFhVTIwYVUzN2FVNDRhVTQ3YVUzNGFSMzJhVTIzYVUzOWFVNDhhTDIxYVU0NmFSNDFhVQ","endTick":1219,"row":22,"cause":"splash","scores":[22,0]}
];

test('sim: the last saved browser run is a rules 3 run that rules 2 would end at row 4 (a landing on the log by the body)', () => {
  const rp = decodeReplay(BROWSER_RUNS[BROWSER_RUNS.length - 1].code);
  assert.equal(rp.version, 3);
  const v2 = simulate({ ...rp, version: 2 });
  assert.deepEqual([v2.score, v2.row, v2.cause], [4, 4, 'splash']);
});

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
// version: the rules version (rules.js RULES when left out)
function bench(rows, version) {
  const G = { state: 'play', camRow: 0, playT: 0, worldTick: 1000, run: null, rules: version };
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

test('ice: a hop queued during a hop waits for the slide, and runs at once when a tree stops the slide', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'ice', trees: new Set([3]) }, { kind: 'grass' }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1); b.settle();                // onto the ice at column 0
  b.rules.tryMove(b.p, 1, 0); b.rules.tryMove(b.p, 0, 1); // hop right, and forward queued
  b.run(); assert.ok(b.p.hop && b.p.queue, 'the forward hop is queued');
  for (let i = 0; i < 200 && !(b.p.hop && b.p.hop.slide); i++) b.run();
  assert.ok(b.p.hop.slide && b.p.queue, 'the slide starts first; the queued hop still waits');
  b.settle();
  assert.deepEqual([b.p.row, b.p.x], [2, 2], 'after the slide to 2, the queued hop took the player forward');
  const c = bench([{ kind: 'grass' }, { kind: 'ice', trees: new Set([2]) }, { kind: 'grass' }]);
  c.p.x = 0;
  c.rules.tryMove(c.p, 0, 1); c.settle();
  c.rules.tryMove(c.p, 1, 0); c.rules.tryMove(c.p, 0, 1);
  for (let i = 0; i < 200 && c.p.row === 1; i++) c.run();
  assert.equal(c.p.x, 1, 'the tree at 2 stopped the slide');
  assert.ok(c.p.hop && !c.p.hop.slide && c.p.hop.dr === 1, 'so the queued forward hop started on landing');
});

test('a landing on a whole bridge plank goes on as usual: its coin is picked up, a hop queued during the hop starts', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'bridge', planks: new Map([[0, { breakAt: -1, backAt: -1 }]]), coins: new Map([[0, true]]) }, { kind: 'grass' }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1); b.rules.tryMove(b.p, 0, 1);   // onto the plank, and on again (queued)
  for (let i = 0; i < 200 && b.p.row === 1 && !(b.p.row === 1 && !b.p.hop); i++) b.run();
  assert.ok(b.p.alive, 'the plank held');
  assert.ok(b.p.hop && b.p.hop.fromRow === 1 && b.p.hop.dr === 1, 'the queued hop left the plank at once');
  assert.ok(b.lanes.get(1).planks.get(0).breakAt > 1000, 'and the plank started to crack');
  assert.equal(b.lanes.get(1).coins.has(0), false, 'the coin on the plank was picked up');
  assert.equal(b.p.coins, 1);
});

test('a row dropped under a hop (the browser frees far rows) does not break the rules', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'grass' }]);
  b.p.x = 0;
  b.rules.tryMove(b.p, 0, 1);
  b.run();
  b.lanes.delete(1);
  assert.doesNotThrow(() => { b.settle(); b.run(30); });
  assert.deepEqual([b.p.alive, b.p.row, b.p.x], [true, 1, 0], 'landed, and stands there');
});

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

test('traits: the fox keeps a combo over a longer gap than the frog; the pig\'s magnet lasts 1.5x', () => {
  const b = benchWith(grassRows(8), ['frog', 'fox']);
  const [frog, fox] = b.players;
  assert.equal(TRAITS.fox.comboGap, 1.5);
  for (const p of b.players) { p.x = 0; b.rules.tryMove(p, 0, 1); }
  b.landTicks();
  assert.deepEqual([frog.combo, fox.combo], [1, 1]);
  // a gap between COMBO_GAP and 1.5 x COMBO_GAP: the frog starts over, the fox counts on
  b.run(Math.round(COMBO_GAP * 1.2 / STEP));
  for (const p of b.players) b.rules.tryMove(p, 0, 1);
  b.landTicks();
  assert.deepEqual([frog.combo, fox.combo], [1, 2], 'the fox keeps the combo');
  // past the fox's gap too, both start over
  b.run(Math.round(COMBO_GAP * 1.6 / STEP));
  for (const p of b.players) b.rules.tryMove(p, 0, 1);
  b.landTicks();
  assert.deepEqual([frog.combo, fox.combo], [1, 1]);
  assert.equal(TRAITS.pig.magnet, 1.5);
  const magnetFor = key => {
    const m = benchWith([{ kind: 'grass' }, { kind: 'grass', power: { x: 0, kind: 'magnet' } }], [key]);
    const p = m.players[0];
    p.x = 0; m.rules.tryMove(p, 0, 1); m.hopTicks(p);
    return p.magnetT;
  };
  assert.ok(Math.abs(magnetFor('frog') - MAGNET_TIME) < 0.02, 'frog: MAGNET_TIME');
  assert.ok(Math.abs(magnetFor('pig') - MAGNET_TIME * 1.5) < 0.02, 'pig: 1.5 x MAGNET_TIME');
});

test('gen: rain or snow (wetAt) makes roads, rivers and rocks faster than the dry formula allows', () => {
  // the dry speed ranges of gen.js, and the wet factor each kind gets
  const DRY = { road: (d, l) => [1.6 + d * 2.4, 2.8 + d * 2.4 + (l.police ? 1.6 : 0)], river: d => [1.0 + d, 1.9 + d], rocks: d => [0.8 + d * 1.2, 1.5 + d * 1.2] };
  const WET = { road: 1.1, river: 1.2, rocks: 1.1 };
  const faster = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const g = createWorldGen(seed);
    for (let r = 0; r < 100; r++) {   // below 100: no flood (a flood is 1.5x on top)
      const l = g.lane(r);
      assert.equal(l.wet, wetAt(seed, r), `seed ${seed} row ${r}: lane.wet is wetAt`);
      if (r < 20) assert.equal(l.wet, false, 'dry until row 20');
      if (!DRY[l.kind]) continue;
      const [lo, hi] = DRY[l.kind](l.diff, l), f = l.wet ? WET[l.kind] : 1;
      assert.ok(l.speed >= lo * f - 1e-9 && l.speed <= hi * f + 1e-9, `seed ${seed} row ${r} ${l.kind} wet=${l.wet}: ${l.speed} in [${lo * f}, ${hi * f}]`);
      if (l.wet && l.speed > hi + 1e-9) faster.add(l.kind);   // faster than any dry lane of this kind could be
    }
  }
  for (const kind of ['road', 'river', 'rocks']) assert.ok(faster.has(kind), `some wet ${kind} lane is faster than the dry formula allows`);
  assert.equal(wetAt(1, 89), true);
  assert.equal(createWorldGen(1).lane(89).speed > 2.8 + createWorldGen(1).lane(89).diff * 2.4, true, 'seed 1 row 89: a wet road past the dry maximum');
});

test('room mode: the seed is hashString("room:" + code), so two phones on one code build one world', () => {
  const kinds = seed => { const g = createWorldGen(seed); return Array.from({ length: 60 }, (_, r) => g.lane(r).kind); };
  const a = kinds(hashString('room:ABCD')), b = kinds(hashString('room:ABCD')), c = kinds(hashString('room:ABCE'));
  assert.deepEqual(a, b, 'the same code gives the same lanes');
  assert.notDeepEqual(a, c, 'another code gives another world');
  assert.notEqual(hashString('room:ABCD'), hashString('ABCD'), 'a room seed is not a plain hash of the code');
  assert.notEqual(hashString('room:2026-10-16'), dailySeedFor('2026-10-16'), 'nor the daily seed of a day-shaped code');
});

test('eagle: the warning sounds EAGLE_WARN seconds before the swoop on a player standing still', () => {
  const G = { state: 'play', camRow: 0, playT: 0, worldTick: 1000, run: null };
  const lanes = new Map(grassRows(4).map((l, r) => [r, { r, coins: new Map(), trees: new Set(), objs: [], span: 34, secret: null, power: null, ...l }]));
  const seen = {};
  let tick = 0;
  const rules = makeRules({ G, lane: r => lanes.get(r), coins() {}, over() {}, fx: { warn: () => { seen.warn = tick; }, eagle: () => { seen.eagle = tick; }, kill: (p, c) => { seen.kill = [tick, c]; } } });
  const p = { id: 0, joined: true };
  resetPlayer(p);
  while (p.alive && tick < 2000) { tick++; G.worldTick++; G.playT += STEP; rules.stepPlayer(p, STEP); }
  assert.ok(seen.warn && seen.eagle, 'the warning and the swoop both came');
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} ~ ${b}`);   // idleT adds up dt: one step of float slack
  near(seen.eagle - seen.warn, Math.round(EAGLE_WARN / STEP), 'EAGLE_WARN seconds apart');
  near(seen.warn, Math.round((EAGLE_IDLE - EAGLE_SWOOP - EAGLE_WARN) / STEP) + 1, 'the warning on the first step past the idle limit');
  near(seen.kill[0] - seen.eagle, Math.round(EAGLE_SWOOP / STEP), 'the swoop takes EAGLE_SWOOP seconds (its first step is the one it starts on)');
  near(seen.kill[0], Math.round(EAGLE_IDLE / STEP), 'taken EAGLE_IDLE seconds in');
  assert.equal(seen.kill[1], 'eagle');
  // a hop before the warning resets the idle time: no warning yet
  const q = { id: 0, joined: true };
  resetPlayer(q);
  let warned = 0;
  const r2 = makeRules({ G, lane: r => lanes.get(r), coins() {}, over() {}, fx: { warn: () => warned++ } });
  for (let i = 0; i < Math.round(3 / STEP); i++) { G.worldTick++; G.playT += STEP; r2.stepPlayer(q, STEP); }
  r2.tryMove(q, 0, 1);
  for (let i = 0; i < Math.round(3 / STEP); i++) { G.worldTick++; G.playT += STEP; r2.stepPlayer(q, STEP); }
  assert.equal(warned, 0, 'a hop puts the eagle off');
  assert.equal(q.warned, false);
});

test('magnet: a coin within MAGNET_REACH on the rows around the player is collected without landing on it', () => {
  const coin = () => ({});
  const rows = [
    { kind: 'grass', coins: new Map([[1, coin()]]) },               // row 0: one column away, behind
    { kind: 'grass', coins: new Map([[1, coin()], [3, coin()]]) },  // row 1: the player's row; 3 is out of reach
    { kind: 'road', coins: new Map([[-1, coin()]]) },               // row 2: ahead
    { kind: 'grass', coins: new Map([[0, coin()]]) }                // row 3: two rows ahead, never pulled
  ];
  const b = benchWith(rows, ['frog']);
  const p = b.players[0];
  const got = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, players: b.players, fx: { coin: (q, lane, x) => got.push([lane.r, x]) } });
  p.row = 1; p.x = 0;
  b.G.worldTick++; rules.stepPlayer(p, STEP);
  assert.deepEqual([got, p.coins], [[], 0], 'no magnet, no pull');
  p.magnetT = MAGNET_TIME;
  b.G.worldTick++; rules.stepPlayer(p, STEP);
  assert.deepEqual(got.sort(), [[0, 1], [1, 1], [2, -1]], 'the coins within reach on rows 0..2');
  assert.equal(p.coins, 3);
  assert.deepEqual([b.lanes.get(1).coins.has(3), b.lanes.get(3).coins.has(0)], [true, true], 'out of reach or too far ahead: still there');
  assert.ok(Math.abs(1 - p.x) <= MAGNET_REACH && 3 - p.x > MAGNET_REACH);
  assert.equal(p.hop, null, 'the player never hopped');
});

// ---------- the pure helpers of sim.js, and the rules not stated above ----------
const { creepCamera, feedReplay, runOver, topScore, touchRows } = await import('../js/sim.js');
const { BEHIND_LIMIT, MUD_SLOW, CAM_CATCH_RATE, CAM_CATCH_ROWS, CAM_CREEP, CAM_CREEP_GAIN, CAM_CREEP_MAX, COMBO_EVERY, COUNTDOWN, EDGE_DEATH, HIT_PAD, HOP_MID, LOG_SLACK, RESCUE_HOP, SHIELD_TIME, START_X } = await import('../js/rules.js');
const close = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} ~ ${b}`);

test('creepCamera: the scroll line creeps CAM_CREEP rows/s, faster with time up to CAM_CREEP_MAX, and catches up to a player well ahead', () => {
  close(creepCamera(0, 0, 0, 1), CAM_CREEP, 'one second at the start');
  close(creepCamera(10, 0, 0, 0.5), 10 + CAM_CREEP * 0.5, 'half a second');
  close(creepCamera(0, 100, 0, 1), Math.min(CAM_CREEP_MAX, CAM_CREEP + 100 * CAM_CREEP_GAIN), '100 s in: faster');
  close(creepCamera(0, 1000, 0, 1), CAM_CREEP_MAX, 'capped');
  assert.ok(creepCamera(0, 100, 0, 1) > creepCamera(0, 50, 0, 1) && creepCamera(0, 50, 0, 1) > creepCamera(0, 0, 0, 1));
  // a player more than CAM_CATCH_ROWS ahead pulls the line towards (lead - CAM_CATCH_ROWS) at CAM_CATCH_RATE per second
  const crept = creepCamera(0, 0, CAM_CATCH_ROWS, 0.01);
  close(crept, CAM_CREEP * 0.01, 'exactly CAM_CATCH_ROWS ahead: no catch-up');
  const c = creepCamera(0, 0, 10, 0.01);
  close(c, CAM_CREEP * 0.01 + (10 - CAM_CATCH_ROWS - CAM_CREEP * 0.01) * 0.01 * CAM_CATCH_RATE, 'ten rows ahead');
  close(creepCamera(0, 0, 10, 1), CAM_CREEP + (10 - CAM_CATCH_ROWS - CAM_CREEP) * 1, 'a whole second: all the way (the rate is capped at 1)');
  assert.ok(creepCamera(5, 0, 4, 0.1) < 5.1, 'a player behind the catch-up point does not pull');
});

test('touchRows: the rows around every joined player plus the row a hop left; feedReplay: every hop due by the tick, in order', () => {
  const into = new Set([99]);
  const players = [{ joined: true, row: 5, hop: null }, { joined: false, row: 50, hop: null }];
  assert.deepEqual([...touchRows(players, into)].sort((a, b) => a - b), [4, 5, 6], 'cleared, then rows 4..6');
  players[0].hop = { fromRow: 3 };
  assert.deepEqual([...touchRows(players, into)].sort((a, b) => a - b), [3, 4, 5, 6], 'a long hop keeps its start row hot');
  players[1].joined = true;
  assert.deepEqual([...touchRows(players, into)].sort((a, b) => a - b), [3, 4, 5, 6, 49, 50, 51]);
  const rp = { events: [[5, 0, 0, 1], [5, 1, -1, 0], [7, 0, 1, 0], [9, 1, 0, -1]], i: 0 };
  const seen = [];
  feedReplay(rp, 4, (...a) => seen.push(a));
  assert.deepEqual([seen, rp.i], [[], 0], 'nothing due yet');
  feedReplay(rp, 5, (...a) => seen.push(a));
  assert.deepEqual(seen, [[0, 0, 1], [1, -1, 0]], 'both hops of tick 5, in order');
  feedReplay(rp, 8, (...a) => seen.push(a));
  assert.deepEqual([seen.length, rp.i], [3, 3], 'tick 7 fed, tick 9 waits');
  feedReplay(rp, 100, (...a) => seen.push(a)); feedReplay(rp, 200, (...a) => seen.push(a));
  assert.deepEqual([seen.length, rp.i], [4, 4], 'fed once each, never again');
});

test('runOver, topScore and winnerOf: the end of a game and its winner by mode', () => {
  const P = (joined, alive, score = 0, coins = 0) => ({ joined, alive, score, coins });
  assert.equal(runOver([P(true, true), P(false, false)], 'classic'), false);
  assert.equal(runOver([P(true, false), P(false, false)], 'classic'), true, 'alone and dead');
  assert.equal(runOver([P(true, false), P(true, true)], 'classic'), false, 'one still plays');
  assert.equal(runOver([P(true, false), P(true, true)], 'race'), true, 'a race ends with the first death');
  assert.equal(runOver([P(true, false), P(false, true)], 'race'), true, 'alone in race mode: a plain game');
  assert.equal(runOver([P(true, true), P(true, true)], 'race'), false);
  assert.equal(runOver([P(true, false), P(true, false)], 'coinwar'), true);
  assert.equal(topScore([P(true, true, 7), P(true, true, 9)]), 9);
  assert.equal(topScore([P(true, true, 7), P(false, true, 9)]), 7, 'a player who did not join scores nothing');
  assert.equal(topScore([P(false, true, 7), P(true, true, 3)]), 3);
  const a = P(true, true, 5, 2), b = P(true, true, 5, 2);
  assert.equal(winnerOf([a, b], 'classic'), null, 'a tie');
  assert.equal(winnerOf([a, b], 'coinwar'), null);
  b.score = 6; assert.equal(winnerOf([a, b], 'classic'), b);
  assert.equal(winnerOf([a, b], 'coinwar'), null, 'coins decide the coin war, not rows');
  a.coins = 3; assert.equal(winnerOf([a, b], 'coinwar'), a);
  assert.equal(winnerOf([a, b], 'race'), b, 'both alive (or both dead): the race goes to the score');
  a.alive = false; b.alive = false; assert.equal(winnerOf([a, b], 'race'), b);
  a.alive = true; assert.equal(winnerOf([a, b], 'race'), a, 'the one still standing');
  assert.equal(winnerOf([a, b], 'tag'), b, 'tag: the score');
  assert.equal(winnerOf([P(false, true, 9), P(true, true, 1)], 'classic'), null);
});

test('resetPlayer: the state of an animal on row 0, on its start column, with the trait kept', () => {
  const p = { id: 1, joined: true, trait: TRAITS.cat, x: 9, row: 9, score: 9, alive: false, shield: true };
  resetPlayer(p);
  assert.equal(p.x, START_X[1]);
  assert.deepEqual([p.row, p.score, p.alive, p.hop, p.queue, p.cause, p.log, p.combo, p.shield, p.safeT, p.magnetT, p.coins, p.lives, p.lead, p.eagle, p.idleT, p.warned, p.lastHop, p.facing, p.nearRow],
    [0, 0, true, null, null, '', null, 0, false, 0, 0, 0, 1, false, null, 0, false, -9, 0, null]);
  assert.equal(p.trait, TRAITS.cat);
  assert.ok(p.nearSeen instanceof Set && p.nearSeen.size === 0);
  const q = { id: 0, joined: true };
  resetPlayer(q);
  assert.deepEqual([q.x, q.lives, q.trait], [START_X[0], 0, {}], 'no trait: a frog');
});

test('createSim: the world clock starts COUNTDOWN before startTick, the handicap gives a shield, end holds coins and the winner, prune forgets far rows', () => {
  const rp = decodeReplay(BROWSER_RUNS[0].code);   // race, both joined, handicap 1
  assert.deepEqual([rp.mode, rp.joined, rp.handicap], ['race', [true, true], 1]);
  const sim = createSim(rp);
  assert.equal(sim.worldTick, rp.startTick - Math.ceil(COUNTDOWN / STEP));
  assert.deepEqual(sim.players.map(p => p.shield), [true, false], 'the handicap shield for player 1');
  assert.deepEqual(sim.players.map(p => [p.joined, p.alive, p.x]), [[true, true, START_X[0]], [true, true, START_X[1]]]);
  assert.equal(sim.camRow, 0);
  assert.equal(sim.end, null);
  while (sim.step());
  assert.equal(sim.state, 'over');
  assert.deepEqual(sim.end.scores, BROWSER_RUNS[0].scores);
  assert.deepEqual(sim.end.coins, sim.players.map(p => p.coins));
  assert.ok(sim.end.coins.every(c => Number.isInteger(c) && c >= 0));
  assert.equal(sim.end.winner, 1, 'the fox was still standing when the frog was squashed');
  assert.equal(sim.end.score, Math.max(...BROWSER_RUNS[0].scores));
  // the other handicap, and none
  assert.deepEqual(createSim({ ...rp, handicap: 2 }).players.map(p => p.shield), [false, true]);
  assert.deepEqual(createSim({ ...rp, handicap: 0 }).players.map(p => p.shield), [false, false]);
  // one player: the countdown ends on startTick exactly, the first play tick is 1
  const solo = createSim({ seed: 5, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 1000, events: [] });
  assert.equal(solo.worldTick, 640);
  let n = 0; while (solo.state === 'countdown') { solo.step(); n++; }
  assert.ok(n >= 360 && n <= 361, 'about COUNTDOWN / STEP steps: ' + n);
  assert.deepEqual([solo.worldTick, solo.tick, solo.state], [1000, 0, 'play']);
  solo.step();
  assert.deepEqual([solo.worldTick, solo.tick], [1001, 1]);
  assert.equal(solo.players[1].alive, false, 'the second player never joined');
  // a tiny startTick never puts the clock below 0
  assert.equal(createSim({ seed: 5, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 10, events: [] }).worldTick, 0);
  // prune: rows further behind the scroll line than any player could stand are forgotten
  const s2 = createSim({ seed: 5, mode: 'classic', chars: ['frog', 'fox'], joined: [true, false], handicap: 0, startTick: 1000, events: [] });
  for (let r = -5; r < 10; r++) s2.lane(r);
  assert.equal(s2.lane(3), s2.lane(3), 'a row is kept once built');
  s2.prune();
  assert.equal(s2.lane(-5) !== undefined && s2.lane(-5).r, -5, 'rows behind the line at camRow 0 - 4.5 - 3 stay: -5 is not past it');
  // walk until the game is over (the eagle) and prune: rows behind are gone, the player's row stays
  while (s2.step());
  const keep = s2.lane(0), cam = s2.camRow;
  s2.prune();
  assert.equal(s2.lane(0), keep, 'row 0 is within reach of the line at ' + cam);
});

test('simulate: the first joined player reports; maxMs cuts a run short; until stops with over false and the live score', () => {
  const base = { seed: 11, mode: 'classic', chars: ['frog', 'fox'], joined: [false, true], handicap: 0, startTick: 300, events: [[10, 1, 0, 1], [30, 1, 0, 1]] };
  const s = simulate(base);
  assert.deepEqual([s.players[0].joined, s.players[1].joined, s.row, s.cause], [false, true, 2, 'eagle'], 'only the fox played: its row and cause');
  assert.deepEqual([s.scores, s.score, s.players[0].score, s.players[1].score], [[0, 2], 2, 0, 2]);
  assert.equal(simulate(base, { maxMs: 0 }), null, 'no time at all: null');
  const part = simulate(base, { until: 50 });
  assert.deepEqual([part.over, part.endTick, part.score, part.scores, part.row], [false, 50, 2, [0, 2], 2]);
  assert.equal(simulate(base, { maxTicks: 20 }), null);
  assert.equal(simulate(base, { until: 20 }).endTick, 20, 'until wins over maxTicks when it comes first');
  assert.deepEqual(Object.keys(simulate(base)).sort(), ['cause', 'coins', 'endTick', 'over', 'players', 'row', 'score', 'scores', 'winner']);
});

test('hops: a hop while hopping is queued and taken on landing; the animal faces where it goes; hops behind the scroll line are refused', () => {
  const b = bench(grassRows(6));
  const p = b.p;
  p.x = 0;
  b.rules.tryMove(p, 0, 1);
  assert.equal(p.facing, 0, 'forward');
  b.rules.tryMove(p, 1, 0);
  assert.deepEqual(p.queue, [1, 0], 'queued while in the air');
  b.rules.tryMove(p, -1, 0);
  assert.deepEqual(p.queue, [-1, 0], 'the last one wins');
  b.settle();
  assert.deepEqual([p.row, p.x, p.queue], [1, -1, null], 'landed, then the queued hop was taken');
  assert.equal(p.facing, Math.PI / 2, 'left');
  b.rules.tryMove(p, 1, 0); b.settle();
  assert.equal(p.facing, -Math.PI / 2, 'right');
  b.rules.tryMove(p, 0, -1); b.settle();
  assert.deepEqual([p.facing, p.row, p.score], [Math.PI, 0, 1], 'back, and the score stays');
  b.G.camRow = 3;   // the line at 3: row 0 is behind the limit (3 - 4.5 = -1.5 < 0, fine), row -2 is not allowed
  b.lanes.set(-1, { r: -1, kind: 'grass', coins: new Map(), trees: new Set(), objs: [], span: 34, secret: null, power: null });
  b.lanes.set(-2, { r: -2, kind: 'grass', coins: new Map(), trees: new Set(), objs: [], span: 34, secret: null, power: null });
  b.G.camRow = 3.6;   // 3.6 - 4.5 = -0.9: row -1 is behind the line
  b.rules.tryMove(p, 0, -1);
  assert.equal(p.hop, null, 'no hop behind the scroll line');
  b.G.camRow = 3.4;   // -1.1: row -1 is allowed
  b.rules.tryMove(p, 0, -1);
  assert.ok(p.hop && p.hop.tz === 1, 'just inside the line: allowed');
  b.settle();
  assert.equal(p.row, -1);
  // a dead player and a player in the eagle's claws can not move
  p.eagle = { t: 0 }; b.rules.tryMove(p, 0, 1); assert.equal(p.hop, null);
  p.eagle = null; p.alive = false; b.rules.tryMove(p, 0, 1); assert.equal(p.hop, null);
  // a hop's record
  const c = bench(grassRows(4)); c.p.x = 1; c.rules.tryMove(c.p, 0, 1);
  assert.deepEqual({ ...c.p.hop, fz: c.p.hop.fz + 0 }, { t: 0, dur: HOP_TIME, fromRow: 0, fx: 1, fz: 0, tx: 1, tz: -1, carry: null, carryX0: 0, span: 0, dx: 0, dr: 1, high: false, mud: false });
  assert.deepEqual([c.p.row, c.p.score, c.p.idleT, c.p.warned], [1, 1, 0, false]);
});

test('hops: mid-hop the animal is between the columns; a hop from mud is MUD_SLOW longer and marked mud', () => {
  const b = bench([{ kind: 'mud' }, { kind: 'grass' }]);
  b.p.x = 0; b.rules.tryMove(b.p, 1, 1);
  assert.ok(b.p.hop.mud && Math.abs(b.p.hop.dur - HOP_TIME * MUD_SLOW) < 1e-9);
  const steps = Math.round(b.p.hop.dur / STEP);
  b.run(Math.floor(steps / 2));
  close(b.p.hop.t, 0.5, 'half way', 0.05);
  close(b.p.x, 0.5, 'half way across', 0.05);
  b.settle();
  assert.deepEqual([b.p.x, b.p.row, b.p.hop], [1, 1, null]);
});

test('combos: every COMBO_EVERY quick hops pay a coin; a pause of COMBO_GAP + 0.2 s ends the combo; a near miss on a cold combo gives 2', () => {
  const paid = [];
  const b = benchWith(grassRows(30), ['frog']);
  const p = b.players[0];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins: n => paid.push(n), over() {}, players: b.players });
  const hop = () => { rules.tryMove(p, 0, 1); while (p.hop) b.run(); };
  for (let i = 1; i <= 2 * COMBO_EVERY; i++) {
    hop();
    assert.equal(p.combo, i, 'combo ' + i);
    assert.equal(paid.length, Math.floor(i / COMBO_EVERY), `after hop ${i}: ${paid.length} coins`);
  }
  assert.deepEqual([paid, p.coins], [[1, 1], 2]);
  // standing still: the combo lives COMBO_GAP + 0.2 s after the last hop, then it is gone
  const since = () => b.G.playT - p.lastHop;
  while (since() < COMBO_GAP + 0.2 - STEP) b.run();
  assert.equal(p.combo, 10, 'still alive just before');
  b.run(3);
  assert.equal(p.combo, 0, 'gone just after');
  // a near miss on a cold combo counts from 1: it makes 2
  const c = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 3, len: 1.4 }] }], ['frog']);
  const q = c.players[0];
  q.x = 0; q.row = 1; q.combo = 0;
  c.lanes.get(1).objs[0].x = 0.7 + HIT_PAD + 0.3;
  c.run();
  assert.equal(q.combo, 2);
  assert.equal(q.lastHop, c.G.playT, 'a near miss keeps the combo warm');
  // a near miss at the edge of NEAR_MISS counts, one at the edge of a hit kills
  const d = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0.7 + HIT_PAD + 0.49, len: 1.4 }] }], ['frog']);
  d.players[0].x = 0; d.players[0].row = 1; d.run();
  assert.deepEqual([d.players[0].alive, d.players[0].combo], [true, 2]);
  const e = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0.7 + HIT_PAD + 0.51, len: 1.4 }] }], ['frog']);
  e.players[0].x = 0; e.players[0].row = 1; e.run();
  assert.deepEqual([e.players[0].alive, e.players[0].combo], [true, 0], 'just too far: nothing');
  const f = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0.7 + HIT_PAD - 0.01, len: 1.4 }] }], ['frog']);
  f.players[0].x = 0; f.players[0].row = 1; f.run();
  assert.deepEqual([f.players[0].alive, f.players[0].cause], [false, 'squash'], 'inside HIT_PAD: a hit');
});

test('logs: a landing within LOG_SLACK of a log end rides it (rules 2), snapped to a segment; past the edge the log sweeps you away', () => {
  const log = { x: 0, len: 3 };
  const b = bench([{ kind: 'grass' }, { kind: 'river', objs: [log] }], 2);
  b.p.x = 1; b.rules.tryMove(b.p, 0.5 + LOG_SLACK - 0.01, 1); b.settle();
  assert.ok(b.p.alive && b.p.log === log, 'just inside the slack: on the log');
  assert.equal(b.p.logOff, 1, 'snapped to the end segment');
  const c = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 3 }] }], 2);
  c.p.x = 1; c.rules.tryMove(c.p, 0.5 + LOG_SLACK + 0.01, 1); c.settle();
  assert.deepEqual([c.p.alive, c.p.cause], [false, 'splash'], 'just outside: water');
  // riding: the animal moves with the log, then a hop carries the log's drift
  const d = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 3 }] }, { kind: 'grass' }]);
  d.p.x = 0; d.rules.tryMove(d.p, 0, 1); d.settle();
  assert.equal(d.p.logOff, 0);
  d.lanes.get(1).objs[0].x = 2; d.run();
  assert.equal(d.p.x, 2, 'carried along');
  d.rules.tryMove(d.p, 0, 1);
  assert.deepEqual([d.p.hop.carry, d.p.hop.carryX0, d.p.hop.span], [d.lanes.get(1).objs[0], 2, 34]);
  d.lanes.get(1).objs[0].x = 2.5; d.run();
  assert.ok(d.p.x > 2.4 && d.p.x <= 2.5, 'the hop drifts with the log: ' + d.p.x);
  d.lanes.get(1).objs[0].x = -15.5; d.run();   // the log wrapped around the span (34): 2 -> -15.5 is a drift of +16.5, not -17.5
  assert.ok(d.p.x > 18.4 && d.p.x < 18.6, 'the wrap is undone: ' + d.p.x);
  d.lanes.get(1).objs[0].x = 3; d.settle();
  assert.deepEqual([d.p.row, d.p.x, d.p.log], [2, 3, null], 'landed where the log took it, on a whole column');
  // a log at the edge
  const e = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: EDGE_DEATH - 0.05, len: 1 }] }]);
  e.p.row = 1; e.p.log = e.lanes.get(1).objs[0]; e.p.logOff = 0; e.run();
  assert.ok(e.p.alive, 'just inside the edge');
  e.lanes.get(1).objs[0].x = EDGE_DEATH + 0.05; e.run();
  assert.deepEqual([e.p.alive, e.p.cause], [false, 'swept']);
  const f = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: -EDGE_DEATH - 0.05, len: 1 }] }]);
  f.p.row = 1; f.p.log = f.lanes.get(1).objs[0]; f.p.logOff = 0; f.run();
  assert.equal(f.p.cause, 'swept', 'either edge');
  // a landing on a longer log snaps to the nearest whole segment, clamped to the log
  const g = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 4 }] }]);
  g.p.x = 2; g.rules.tryMove(g.p, -0.1, 1); g.settle();
  assert.ok(g.p.alive && g.p.log, 'a 4-log spans -2..2: 1.9 is on it');
  assert.equal(g.p.logOff, 1.5, 'the far segment of a 4-log (-1.5, -0.5, 0.5, 1.5)');
  g.run();
  assert.ok(Math.abs(g.p.x - 1.5) < 1e-9, 'standing on the log: snapped to the segment');
});

test('hazards: until mid-hop the row left still counts; after it the row landed on; a train hit sets trainDir', () => {
  const car = x => ({ x, len: 1.4 });
  // a car on the row left kills in the first half of the hop
  const a = bench([{ kind: 'road', objs: [car(5)] }, { kind: 'grass' }]);
  a.p.x = 0; a.p.row = 0; a.rules.tryMove(a.p, 0, 1);
  a.run(2); assert.ok(a.p.alive);
  a.lanes.get(0).objs[0].x = 0; a.run();
  assert.deepEqual([a.p.alive, a.p.cause], [false, 'squash'], 'hit from behind in the first half');
  // the same car does nothing once the hop is past its middle
  const b = bench([{ kind: 'road', objs: [car(5)] }, { kind: 'grass' }]);
  b.p.x = 0; b.rules.tryMove(b.p, 0, 1);
  while (b.p.hop.t < HOP_MID) b.run();
  b.lanes.get(0).objs[0].x = 0; b.run();
  assert.ok(b.p.alive, 'safe: already over the next row');
  // a car on the row ahead does nothing in the first half, and kills in the second
  const c = bench([{ kind: 'grass' }, { kind: 'road', objs: [car(0)] }]);
  c.p.x = 0; c.rules.tryMove(c.p, 0, 1); c.run();
  assert.ok(c.p.alive && c.p.hop.t < HOP_MID);
  while (c.p.alive && c.p.hop) c.run();
  assert.deepEqual([c.p.alive, c.p.cause], [false, 'squash']);
  // trains: a hit within len / 2 + HIT_PAD; the direction is kept for the effect
  const train = { len: 12, x: 0, active: true };
  const d = bench([{ kind: 'grass' }, { kind: 'rail', dir: -1, train }]);
  d.p.x = 0; d.p.row = 1; train.x = 6 + HIT_PAD + 0.01; d.run();
  assert.ok(d.p.alive, 'just clear');
  train.x = 6 + HIT_PAD - 0.01; d.run();
  assert.deepEqual([d.p.alive, d.p.cause, d.p.trainDir], [false, 'train', -1]);
  const e = bench([{ kind: 'grass' }, { kind: 'rail', dir: 1, train: { len: 12, x: 0, active: false } }]);
  e.p.x = 0; e.p.row = 1; e.run(5);
  assert.ok(e.p.alive, 'no train on the track');
  // rules 2: a plank that drops under a hop that has not reached its middle drops the player too
  const planks = () => new Map([[0, { breakAt: 1000, backAt: 2000 }], [1, { breakAt: -1, backAt: -1 }]]);
  const f = bench([{ kind: 'grass' }, { kind: 'bridge', planks: planks() }, { kind: 'grass' }], 2);
  f.p.x = 0; f.p.row = 1; f.G.worldTick = 995; f.rules.tryMove(f.p, 0, 1);
  f.run(); f.run(); f.run(); f.run(); f.run();   // tick 1000: the plank is down while the hop is still over it
  assert.deepEqual([f.p.alive, f.p.cause], [false, 'splash']);
  // rules 3: the player has hopped off it and is in the air: the hop goes on; a cliff tile the same
  for (const kind of ['bridge', 'cliff']) {
    const f3 = bench([{ kind: 'grass' }, { kind, planks: planks() }, { kind: 'grass' }]);
    f3.p.x = 0; f3.p.row = 1; f3.G.worldTick = 995; f3.rules.tryMove(f3.p, 0, 1);
    f3.run(5);
    assert.ok(f3.p.alive && f3.p.hop && f3.p.hop.t < HOP_MID, kind + ': in the air over the gone plank');
    f3.settle();
    assert.deepEqual([f3.p.alive, f3.p.row], [true, 2], kind + ': landed on the row ahead');
    // but one who stands on it still falls
    const s3 = bench([{ kind: 'grass' }, { kind, planks: planks() }]);
    s3.p.x = 0; s3.p.row = 1; s3.G.worldTick = 998; s3.run(); assert.ok(s3.p.alive, 'tick 999: still cracking');
    s3.run(); assert.deepEqual([s3.p.alive, s3.p.cause], [false, kind === 'cliff' ? 'fall' : 'splash'], 'tick 1000: gone under a player who stands on it');
  }
  const g = bench([{ kind: 'grass' }, { kind: 'bridge', planks: new Map([[0, { breakAt: 1000, backAt: 2000 }]]) }, { kind: 'grass' }]);
  g.p.x = 0; g.p.row = 1; g.G.worldTick = 980; g.rules.tryMove(g.p, 0, 1);
  while (g.p.hop && g.p.hop.t < HOP_MID) g.run();
  g.G.worldTick = 1000; g.run();
  assert.ok(g.p.alive, 'past the middle the plank behind can drop');
});

test('the shield: SHIELD_TIME of grace after a rescue in which cars and trains pass through, but water still sinks; no solid row behind: the hit kills', () => {
  const b = bench([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  b.rules.giveShield(b.p);
  assert.equal(b.p.shield, true);
  b.p.x = 0.4; b.rules.tryMove(b.p, 0, 1);
  while (b.p.row === 1) b.run();   // the car hits once the hop is over its middle
  assert.deepEqual([b.p.alive, b.p.row, b.p.shield], [true, 0, false]);
  assert.ok(b.p.hop && Math.abs(b.p.hop.dur - HOP_TIME * RESCUE_HOP) < 1e-9 && b.p.hop.tx === 0 && b.p.hop.tz === 0 && b.p.hop.fromRow === 1, 'a slow hop back to a whole column');
  close(b.p.safeT, SHIELD_TIME, 'the grace starts', STEP * 2);
  b.settle();
  assert.equal(b.p.x, 0);
  // a car on the row the animal was sent back to passes through it while the grace lasts
  b.lanes.get(0).objs = [{ x: 0, len: 1.4 }]; b.lanes.get(0).kind = 'road';
  b.settle();
  assert.ok(b.p.alive && b.p.safeT > 0, 'back on the road, still safe');
  while (b.p.safeT > 0) b.run();
  b.run();
  assert.deepEqual([b.p.alive, b.p.cause], [false, 'squash'], 'the grace over: the car counts');
  // a train in the grace
  const t = bench([{ kind: 'grass' }, { kind: 'rail', dir: 1, train: { len: 12, x: 0, active: true } }]);
  t.rules.giveShield(t.p); t.p.x = 0; t.rules.tryMove(t.p, 0, 1); t.settle(); t.run();
  assert.deepEqual([t.p.alive, t.p.row], [true, 0], 'rescued from the train');
  t.p.row = 1; t.p.hop = null; t.run();
  assert.ok(t.p.alive && t.p.safeT > 0, 'the train passes through during the grace');
  // water in the grace: still a splash, and no shield to spend
  const w = bench([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }, { kind: 'lily', pads: new Set([4]) }]);
  w.rules.giveShield(w.p); w.p.x = 0; w.rules.tryMove(w.p, 0, 1); w.settle(); w.run(); w.settle();
  w.p.row = 1; w.p.x = 0; w.rules.tryMove(w.p, 0, 1); w.settle();
  assert.deepEqual([w.p.alive, w.p.cause, w.p.safeT > 0], [false, 'splash', true]);
  // no solid row behind within reach: the rescue fails and the hit kills after all
  const n = bench([{ kind: 'river', objs: [] }, { kind: 'lily', pads: new Set([0]) }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  n.rules.giveShield(n.p); n.p.x = 0; n.p.row = 1; n.rules.tryMove(n.p, 0, 1); n.settle(); n.run();
  assert.deepEqual([n.p.alive, n.p.cause, n.p.shield], [false, 'squash', true], 'nowhere to go: the shield could not help');
  // the rescue goes to the nearest solid row behind, over water
  const far = bench([{ kind: 'grass' }, { kind: 'river', objs: [] }, { kind: 'lily', pads: new Set([0]) }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  far.rules.giveShield(far.p); far.p.x = 0; far.p.row = 2; far.rules.tryMove(far.p, 0, 1); far.settle(); far.run(); far.settle();
  assert.deepEqual([far.p.alive, far.p.row, far.p.x], [true, 0, 0]);
  // the rescue never goes behind the scroll line
  const line = bench([{ kind: 'grass' }, { kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  line.rules.giveShield(line.p); line.p.x = 0; line.p.row = 1; line.G.camRow = 5.6;   // 5.6 - 4.5 = 1.1: row 1 and below are behind the line
  line.rules.tryMove(line.p, 0, 1); line.settle(); line.run();
  assert.deepEqual([line.p.alive, line.p.cause], [false, 'squash'], 'the only solid rows are behind the line');
  // a shielded player sent back is safe from the 'slow' death too? no: only hits are forgiven
  const slow = bench(grassRows(3));
  slow.rules.giveShield(slow.p); slow.G.camRow = 5; slow.run();
  assert.deepEqual([slow.p.alive, slow.p.cause], [false, 'slow'], 'the shield is no help against the scroll line');
  const eagle = bench(grassRows(3));
  eagle.rules.giveShield(eagle.p); eagle.run(Math.round((EAGLE_IDLE + 1) / STEP));
  assert.deepEqual([eagle.p.alive, eagle.p.cause], [false, 'eagle'], 'nor against the eagle');
});

test('the run stats: hops, the best row, logs, rivers crossed, coins, secrets, power-ups, combo', () => {
  const run = { coins: 0, row: 0, rivers: 0, hops: 0, logs: 0, combo: 0, powers: 0, secrets: 0, nears: 0 };
  const rows = [{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 3 }] }, { kind: 'grass', secret: 5, coins: new Map([[5, true], [0, {}]]), power: { x: 1, kind: 'shield' } }, { kind: 'grass' }];
  const b = bench(rows);
  b.G.run = run;
  const paid = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins: n => paid.push(n), over() {} });
  const hop = (dx, dr) => { rules.tryMove(b.p, dx, dr); while (b.p.hop) { b.G.worldTick++; rules.stepPlayer(b.p, STEP); } };
  b.p.x = 0;
  hop(0, 1);
  assert.deepEqual([run.hops, run.row, run.logs, run.rivers], [1, 1, 1, 0], 'onto the log');
  hop(0, 1);
  assert.deepEqual([run.hops, run.row, run.rivers, paid, b.p.coins], [2, 2, 1, [1], 1], 'across the river, with the coin');
  hop(0, -1); hop(0, 1);
  assert.deepEqual([run.hops, run.row, run.rivers, run.logs], [4, 2, 2, 2], 'back and across again: a second crossing');
  hop(0, -1); hop(0, -1);
  assert.deepEqual([run.rivers, run.row, b.p.row], [2, 2, 0], 'going back over it does not count');
  b.p.x = 1; b.p.row = 1; b.p.log = null;
  hop(0, 1);
  assert.deepEqual([run.powers, b.p.shield], [1, true]);
  hop(1, 0); hop(1, 0); hop(1, 0);
  assert.equal(b.p.x, 4);
  hop(1, 0);
  // playT stands still here, so every hop is a quick one: the combo paid a coin at hops 5 and 10 on the way
  assert.deepEqual([b.p.x, run.secrets, paid, run.combo, b.p.combo], [5, 1, [1, 1, 1, 3], 11, 11], 'the hidden coin pays three');
  assert.equal(b.p.coins, 6);
  assert.equal(run.row, 2, 'the best row of the run');
  // no run stats (a replay): nothing breaks
  const c = bench(rows); c.G.run = null; c.p.x = 0; c.rules.tryMove(c.p, 0, 1); c.settle();
  assert.ok(c.p.alive && c.p.log);
});

test('stepPlayer: outside play nothing but the step itself happens; the magnet runs down and says so once', () => {
  const b = bench(grassRows(3));
  b.G.state = 'countdown';
  b.run(Math.round(8 / STEP));
  assert.deepEqual([b.p.idleT, b.p.eagle, b.p.alive], [0, null, true], 'no idle time in the countdown');
  b.G.state = 'play';
  const labels = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, fx: { label: () => labels.push(b.G.worldTick) } });
  b.p.magnetT = 10 * STEP;
  for (let i = 0; i < 20; i++) { b.G.worldTick++; rules.stepPlayer(b.p, STEP); }
  assert.equal(b.p.magnetT, 0);
  assert.equal(labels.length, 1, 'the label changed once, when the magnet ran out');
});

test('the eagle: a hop in the air does not count as idle; the eagle takes the player after EAGLE_SWOOP; the warning comes once', () => {
  const b = bench(grassRows(40));
  const warns = [];
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() {}, fx: { warn: () => warns.push(b.G.worldTick) } });
  const step = n => { for (let i = 0; i < n; i++) { b.G.worldTick++; b.G.playT += STEP; rules.stepPlayer(b.p, STEP); } };
  // keep hopping every 3 s: no eagle, ever
  for (let i = 0; i < 10; i++) { rules.tryMove(b.p, 0, 1); step(Math.round(3 / STEP)); }
  assert.deepEqual([b.p.alive, b.p.eagle, warns], [true, null, []]);
  // one more hop, then stop: the warning once, then the eagle
  rules.tryMove(b.p, 0, 1);
  const hopTicks = Math.round(HOP_TIME / STEP);   // in the air the clock does not count as idle
  step(Math.round((EAGLE_IDLE - EAGLE_SWOOP - EAGLE_WARN) / STEP) + hopTicks - 2);
  assert.equal(warns.length, 0, 'the hop itself was not idle time');
  step(4);
  assert.equal(warns.length, 1);
  step(Math.round(EAGLE_WARN / STEP) + 2);
  assert.ok(b.p.eagle && b.p.eagle.t > 0 && b.p.eagle.t < 1, 'the swoop is on');
  assert.equal(warns.length, 1, 'the warning does not repeat');
  rules.tryMove(b.p, 0, 1);
  assert.equal(b.p.hop, null, 'too late to move');
  step(Math.round(EAGLE_SWOOP / STEP) + 2);
  assert.deepEqual([b.p.alive, b.p.cause, b.p.eagle.t], [false, 'eagle', 1]);
});

test('boundaries: the scroll line, the log edge and the log slack, exactly at the limit', () => {
  // a player exactly on the line (camRow - BEHIND_LIMIT) lives; a hair behind it is out
  const a = bench(grassRows(3)); a.G.camRow = BEHIND_LIMIT; a.run();
  assert.ok(a.p.alive, 'exactly on the line');
  a.G.camRow = BEHIND_LIMIT + 1e-6; a.run();
  assert.deepEqual([a.p.alive, a.p.cause], [false, 'slow']);
  // a hop back onto the line's own row is allowed
  const b = bench(grassRows(3)); b.p.x = 0; b.p.row = 1; b.G.camRow = BEHIND_LIMIT;
  b.rules.tryMove(b.p, 0, -1);
  assert.ok(b.p.hop && b.p.hop.tz === 0, 'row 0 is exactly on the line: allowed');
  // and the shield can send you back onto it
  const c = bench([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  c.rules.giveShield(c.p); c.p.x = 0; c.p.row = 1; c.G.camRow = BEHIND_LIMIT; c.run();
  assert.deepEqual([c.p.alive, c.p.row], [true, 0], 'rescued onto the line');
  // a rescue to a row above 0: the hop's rows are recorded as z (minus the row)
  const d = bench([{ kind: 'grass' }, { kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  d.rules.giveShield(d.p); d.p.x = 0; d.p.row = 2; d.run();
  assert.deepEqual([d.p.row, d.p.hop.fromRow, d.p.hop.fz, d.p.hop.tz, d.p.hop.tx], [1, 2, -2, -1, 0]);
  // a log whose middle is exactly EDGE_DEATH away still holds; LOG_SLACK: exactly on the edge is water
  const e = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: EDGE_DEATH, len: 1 }] }]);
  e.p.row = 1; e.p.log = e.lanes.get(1).objs[0]; e.p.logOff = 0; e.run();
  assert.ok(e.p.alive);
  const f = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 3 }] }], 2);
  f.p.x = 1; f.rules.tryMove(f.p, 0.55, 1); f.settle();   // 1.55 = 1.5 + LOG_SLACK
  assert.deepEqual([f.p.alive, f.p.cause], [false, 'splash'], 'exactly at the slack: not on the log (rules 2)');
  const g = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 3 }] }]);
  g.p.x = 1; g.rules.tryMove(g.p, 0.5 + LOG_SLACK_BODY, 1); g.settle();   // 1.8 = 1.5 + LOG_SLACK_BODY
  assert.deepEqual([g.p.alive, g.p.cause], [false, 'splash'], 'exactly at the body slack: not on the log (rules 3)');
});

test('rules 3: a landing rides a log while the body overlaps its end; rules 2 needed the middle within LOG_SLACK', () => {
  for (const [rules, miss, on] of [[3, 0.29, true], [3, 0.31, false], [2, 0.29, false], [undefined, 0.29, true]]) {
    const b = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 2 }] }], rules);
    b.p.x = 1; b.rules.tryMove(b.p, miss, 1); b.settle();   // the log ends at 1: the middle lands miss past it
    assert.equal(b.p.alive, on, `rules ${rules}, ${miss} past the end`);
    if (on) { assert.equal(b.p.logOff, 0.5, 'snapped onto the end segment'); b.run(); assert.equal(b.p.x, 0.5, 'and drawn on the log'); }
    // the other end, the other way
    const c = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 2 }] }], rules);
    c.p.x = -1; c.rules.tryMove(c.p, -miss, 1); c.settle();
    assert.equal(c.p.alive, on, `rules ${rules}, ${miss} past the left end`);
  }
});

test('rules 3: a forward or back hop from a log carried past the last column goes to the last column; rules 2 refused it', () => {
  const rows = () => [{ kind: 'grass' }, { kind: 'river', objs: [{ x: 4.8, len: 1 }] }, { kind: 'grass' }, { kind: 'grass' }];
  for (const [dr, toRow] of [[1, 2], [-1, 0]]) {
    const b = bench(rows());
    b.p.row = 1; b.p.log = b.lanes.get(1).objs[0]; b.p.logOff = 0; b.run();
    assert.equal(b.p.x, 4.8);
    b.rules.tryMove(b.p, 0, dr);
    assert.ok(b.p.hop, 'rules 3: the hop goes');
    assert.deepEqual([b.p.hop.fx, b.p.hop.tx, b.p.hop.carry], [4.8, PLAY_HALF, b.lanes.get(1).objs[0]], 'from where the animal is, to the last column, with the log drift');
    b.settle();
    assert.deepEqual([b.p.alive, b.p.row, b.p.x], [true, toRow, PLAY_HALF]);
    const c = bench(rows(), 2);
    c.p.row = 1; c.p.log = c.lanes.get(1).objs[0]; c.p.logOff = 0; c.run();
    c.rules.tryMove(c.p, 0, dr);
    assert.equal(c.p.hop, null, 'rules 2: refused (round(4.8) = 5 is past the edge)');
  }
  // the left edge, and a hop onto another river row from there: the target column is the last one too
  const d = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: -5, len: 1 }] }, { kind: 'river', objs: [{ x: -PLAY_HALF, len: 3 }] }]);
  d.p.row = 1; d.p.log = d.lanes.get(1).objs[0]; d.p.logOff = 0; d.run();
  d.rules.tryMove(d.p, 0, 1);
  assert.equal(d.p.hop.tx, -PLAY_HALF);
  d.settle();
  assert.ok(d.p.alive && d.p.log === d.lanes.get(2).objs[0], 'onto the next log');
  // a sideways hop is not clamped: toward the edge is still refused, back toward the middle goes one column
  const e = bench(rows());
  e.p.row = 1; e.p.log = e.lanes.get(1).objs[0]; e.p.logOff = 0; e.run();
  e.rules.tryMove(e.p, 1, 0);
  assert.equal(e.p.hop, null, '5.8 is past the river edge');
  e.rules.tryMove(e.p, -1, 0);
  assert.ok(Math.abs(e.p.hop.tx - 3.8) < 1e-9, 'one column in: ' + e.p.hop.tx);
  // a rider on the play area hops as before (no clamp needed)
  const f = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 3.4, len: 1 }] }, { kind: 'grass' }]);
  f.p.row = 1; f.p.log = f.lanes.get(1).objs[0]; f.p.logOff = 0; f.run();
  f.rules.tryMove(f.p, 0, 1);
  assert.equal(f.p.hop.tx, 3);
  // between the last column and its edge (4 < x <= 4.5) rules 2 let the hop go straight: rules 3 does the same, no clamp
  for (const version of [2, 3]) {
    const g = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 4.3, len: 1 }] }, { kind: 'river', objs: [{ x: 5.32, len: 2 }] }], version);
    g.p.row = 1; g.p.log = g.lanes.get(1).objs[0]; g.p.logOff = 0; g.run();
    g.rules.tryMove(g.p, 0, 1);
    assert.equal(g.p.hop.tx, 4.3, 'rules ' + version + ': straight ahead');
  }
});

test('the edge warning: once per ride, when a log carries the rider past the last column (effects only)', () => {
  const warned = [];
  const G = { state: 'play', camRow: 0, playT: 0, worldTick: 1000, run: null };
  const log = { x: 4, len: 3 };
  const lanes = new Map([[0, { r: 0, kind: 'grass', coins: new Map(), trees: new Set(), objs: [] }], [1, { r: 1, kind: 'river', coins: new Map(), trees: new Set(), objs: [log], span: 34 }]]);
  const rules = makeRules({ G, lane: r => lanes.get(r), coins() {}, over() {}, fx: { edge: q => warned.push(q.x) } });
  const p = { id: 0, joined: true };
  resetPlayer(p);
  p.row = 1; p.log = log; p.logOff = 0;
  const run = () => { G.worldTick++; rules.stepPlayer(p, STEP); };
  run(); assert.deepEqual(warned, [], 'on the last column: no warning');
  log.x = PLAY_HALF + 0.5; run(); assert.deepEqual(warned, [], 'exactly half a column out: not yet');
  log.x = PLAY_HALF + 0.51; run(); log.x = 5; run(); log.x = 5.3; run();
  assert.deepEqual(warned, [PLAY_HALF + 0.51], 'once, the step it crosses');
  log.x = 4; run(); log.x = -4.6; run();
  assert.equal(warned.length, 2, 'back in and out the other side: again');
  assert.ok(p.alive);
  // a new ride warns again: a sideways hop along the log is a landing
  log.x = 4; run(); p.edgeWarned = true; rules.tryMove(p, -1, 0);
  for (let i = 0; i < 100 && p.hop; i++) run();
  assert.deepEqual([p.alive, p.log, p.x, p.edgeWarned], [true, log, 3, false], 'a landing starts a new ride');
});

test('leader and tag with the other player ahead or level; two bombs on two rows; a bomb whose row is gone', () => {
  const rows = Array.from({ length: 60 }, () => ({ kind: 'grass' }));
  const b = benchWith(rows, ['frog', 'frog']);
  const [a, c] = b.players;
  c.row = LEAD_FROM + 10; a.row = LEAD_FROM;   // player 2 leads
  b.run();
  assert.deepEqual([a.lead, c.lead], [false, true], 'player 2 can lead too');
  b.rules.tryMove(c, 0, 1);
  assert.ok(Math.abs(c.hop.dur / HOP_TIME - LEAD_SLOW) < 1e-9);
  const t = benchWith(grassRows(8), ['frog', 'frog'], 'tag');
  t.players[0].row = 3; t.players[1].row = 3;
  t.rules.tryMove(t.players[0], 0, 1);
  assert.equal(t.players[0].hop.dur, HOP_TIME, 'level: nobody is behind');
  t.rules.tryMove(t.players[1], 0, 1);
  assert.ok(Math.abs(t.players[1].hop.dur - HOP_TIME * 0.7) < 1e-9, 'the first hop put player 1 ahead, so player 2 is behind now');
  // two bombs on different rows: both rocks stand, each picked as a bomb
  const br = Array.from({ length: 30 }, () => ({ kind: 'grass' }));
  br[24] = { kind: 'grass', power: { x: 0, kind: 'magnet' } };
  br[28] = { kind: 'grass', power: { x: 0, kind: 'magnet' } };
  const w = benchWith(br, ['frog', 'fox']);
  const kinds = [];
  const rules = makeRules({ G: w.G, lane: r => w.lanes.get(r), coins() {}, over() {}, players: w.players, fx: { power: (p, lane, pw) => kinds.push(pw.kind) } });
  const step = n => { for (let i = 0; i < n; i++) { w.G.worldTick++; w.G.playT += STEP; for (const p of w.players) if (p.alive) rules.stepPlayer(p, STEP); } };
  w.players[1].row = 10; w.players[1].x = 0; w.players[0].row = 23; w.players[0].x = 0;
  rules.tryMove(w.players[0], 0, 1); step(20);
  w.players[1].row = 15;
  w.players[0].row = 27; w.players[0].hop = null; rules.tryMove(w.players[0], 0, 1); step(20);
  assert.deepEqual(kinds, ['bomb', 'bomb']);
  assert.ok(w.lanes.get(11).trees.has(0) && w.lanes.get(16).trees.has(0), 'a rock on row 11 and one on row 16');
  assert.ok(!w.players[0].shield, 'no shield for the picker: both were bombs');
  step(BOMB_TICKS);
  assert.ok(!w.lanes.get(11).trees.has(0) && !w.lanes.get(16).trees.has(0), 'both lifted');
  // a bomb on a row that has since been dropped: lifting it is no trouble
  const z = benchWith(br, ['frog', 'fox']);
  z.players[1].row = 10; z.players[1].x = 0; z.players[0].row = 23; z.players[0].x = 0;
  z.rules.tryMove(z.players[0], 0, 1); z.hopTicks(z.players[0]);
  assert.ok(z.lanes.get(11).trees.has(0));
  z.lanes.delete(11);
  z.rules.reset();
  z.run(BOMB_TICKS + 5);
  assert.ok(z.players[0].alive, 'nothing broke');
});

test('more of the rules: a dead player stays dead, the twister in the grace, sideways on a river, slides, the magnet off centre', () => {
  const killed = [];
  const b = bench([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }]);
  const rules = makeRules({ G: b.G, lane: r => b.lanes.get(r), coins() {}, over() { killed.push('over'); }, fx: { kill: (p, c) => killed.push(c) } });
  rules.kill(b.p, 'squash'); rules.kill(b.p, 'train');
  assert.deepEqual([killed, b.p.cause, b.p.alive], [['squash', 'over'], 'squash', false], 'the second death does not count');
  // the twister passes through a just-rescued player too
  const t = benchWith([{ kind: 'grass' }, { kind: 'road', objs: [{ x: 0, len: 1.4 }] }, { kind: 'grass', twister: true, objs: [{ x: 0, len: 0.9, twister: true }] }], ['frog']);
  const q = t.players[0];
  t.rules.giveShield(q); q.x = 0; q.row = 1; t.run(); t.hopTicks(q);
  assert.deepEqual([q.alive, q.row, q.safeT > 0], [true, 0, true]);
  q.row = 2; t.run();
  assert.ok(q.alive, 'the twister passes through during the grace');
  while (q.safeT > 0) t.run();
  t.run();
  assert.deepEqual([q.alive, q.cause], [false, 'twister']);
  // a sideways hop on a log is not a river crossed
  const run = { coins: 0, row: 0, rivers: 0, hops: 0, logs: 0, combo: 0, powers: 0, secrets: 0, nears: 0 };
  const r = bench([{ kind: 'grass' }, { kind: 'river', objs: [{ x: 0, len: 4 }] }, { kind: 'grass' }]);
  r.G.run = run;
  r.p.x = 0; r.rules.tryMove(r.p, 0, 1); r.settle(); r.rules.tryMove(r.p, 1, 0); r.settle();
  assert.deepEqual([r.p.alive, r.p.row, run.rivers, run.logs], [true, 1, 0, 2], 'still on the log, no crossing');
  r.rules.tryMove(r.p, 0, 1); r.settle();
  assert.equal(run.rivers, 1);
  // the slide is a hop of its own: flagged, on the same row, SLIDE_TIME long; a hop with a forward part does not slide
  const i = bench([{ kind: 'grass' }, { kind: 'ice' }, { kind: 'ice' }]);
  i.p.x = 0; i.rules.tryMove(i.p, 0, 1); i.settle();
  i.rules.tryMove(i.p, 1, 0); while (i.p.hop && !i.p.hop.slide) i.run();
  assert.ok(i.p.hop && i.p.hop.slide === true, 'sliding');
  assert.deepEqual([i.p.hop.dur, i.p.hop.fromRow, i.p.hop.fz, i.p.hop.tz, i.p.hop.fx, i.p.hop.tx, i.p.hop.dr, i.p.hop.dx], [0.12, 1, -1, -1, 1, 2, 0, 0]);
  i.settle();
  i.rules.tryMove(i.p, -1, 1); i.settle();
  assert.deepEqual([i.p.row, i.p.x], [2, 1], 'a diagonal hop onto ice: no slide');
  // the magnet reaches MAGNET_REACH either side of the player, not of the column
  const m = benchWith([{ kind: 'grass', coins: new Map([[2, {}], [-1, {}]]) }], ['frog']);
  m.players[0].x = 1; m.players[0].magnetT = MAGNET_TIME; m.run();
  assert.deepEqual([m.lanes.get(0).coins.has(2), m.lanes.get(0).coins.has(-1), m.players[0].coins], [false, true, 1], 'the coin at 2 is within reach of x = 1, the one at -1 is not');
});

test('planks: landing again on a cracking plank does not give it more time; a landing in water has no landing effect', () => {
  const planks = new Map([[0, { breakAt: -1, backAt: -1 }], [1, { breakAt: -1, backAt: -1 }]]);
  const b = bench([{ kind: 'grass' }, { kind: 'bridge', planks }]);
  b.p.x = 0; b.rules.tryMove(b.p, 0, 1); b.settle();
  const breakAt = planks.get(0).breakAt;
  assert.equal(breakAt, b.G.worldTick + PLANK_BREAK);
  b.rules.tryMove(b.p, 1, 0); b.settle(); b.rules.tryMove(b.p, -1, 0); b.settle();
  assert.deepEqual([b.p.x, planks.get(0).breakAt], [0, breakAt], 'back on it: the crack is as old as it was');
  assert.equal(planks.get(1).breakAt, breakAt + Math.ceil(HOP_TIME / STEP - 1e-9), 'the other plank cracked when it was stepped on (a hop is 14.4 steps, so 15)');
  const lands = [];
  const d = bench([{ kind: 'grass' }, { kind: 'bridge', planks: new Map([[0, { breakAt: -1, backAt: -1 }]]) }]);
  const rules = makeRules({ G: d.G, lane: r => d.lanes.get(r), coins() {}, over() {}, fx: { land: (p, lane) => lands.push(lane.r) } });
  d.p.x = 2; rules.tryMove(d.p, 0, 1); while (d.p.hop) { d.G.worldTick++; rules.stepPlayer(d.p, STEP); }
  assert.deepEqual([d.p.cause, lands], ['splash', []], 'sunk on landing: no landing');
  const h = bench(grassRows(4)); h.p.x = 1; h.p.row = 1; h.rules.tryMove(h.p, 0, 1);
  assert.deepEqual([h.p.hop.fromRow, h.p.hop.fz, h.p.hop.tz], [1, -1, -2], 'a hop from row 1 to row 2, as z');
  const w = [{ joined: true, alive: true, score: 5, coins: 0 }, { joined: true, alive: false, score: 7, coins: 0 }];
  assert.equal(winnerOf(w, 'classic'), w[1], 'outside a race the score decides, alive or not');
  assert.equal(winnerOf(w, 'coinwar'), null);
});

test('createSim: a dead player ahead does not pull the scroll line; prune forgets rows behind it; nothing moves after the end', () => {
  const rp = { seed: 5, mode: 'classic', chars: ['frog', 'fox'], joined: [true, true], handicap: 0, startTick: 1000, events: [] };
  const sim = createSim(rp);
  while (sim.state === 'countdown') sim.step();
  sim.players[0].alive = false; sim.players[0].row = 30;   // as if the frog had died far ahead
  for (let i = 0; i < 120; i++) sim.step();
  assert.ok(sim.camRow < 1, 'the line creeps on its own, it does not catch up to the dead: ' + sim.camRow);
  assert.ok(sim.players[1].alive);
  // prune: with the line at camRow, rows below camRow - BEHIND_LIMIT - 3 are forgotten, the others kept
  const s2 = createSim({ ...rp, joined: [true, false] });
  while (s2.step());
  const cam = s2.camRow, kept = new Map();
  for (let r = -12; r <= 2; r++) kept.set(r, s2.lane(r));
  s2.prune();
  for (let r = -12; r <= 2; r++) assert.equal(s2.lane(r) === kept.get(r), r >= cam - BEHIND_LIMIT - 3, `row ${r} with the line at ${cam}`);
  assert.ok([...kept.keys()].some(r => r < cam - BEHIND_LIMIT - 3), 'some row was far enough behind to be forgotten');
  const tick = s2.worldTick;
  assert.equal(s2.step(), false);
  assert.equal(s2.worldTick, tick, 'the clock stops at the end');
  // a player who did not join has no cause; a run that fits in the time allowed completes
  const s = simulate({ ...rp, joined: [false, true] });
  assert.deepEqual([s.players[0].cause, s.players[0].alive, s.players[0].row, s.cause], ['', false, 0, 'eagle']);
  assert.notEqual(simulate({ ...rp, joined: [false, true] }, { maxMs: 60000 }), null, 'a minute is plenty');
});

// the score server stores only the hops a run applied (server/scores.mjs): onHop must name each hop the rules started,
// as the move it was (a spring's two-row hop is the forward move), so their fresh code plays the very same run
test('onHop: the hops the rules started; their fresh code plays the very same run', () => {
  const bench = fs.readFileSync(new URL('./bench-replay.txt', import.meta.url), 'utf8').trim();   // crosses springs (row 95 on)
  for (const code of [...BROWSER_RUNS.map(r => r.code), bench]) {
    const rp = decodeReplay(code), hops = [];
    const a = simulate(rp, { onHop: (...h) => hops.push(h) });
    assert.ok(hops.length > 0 && hops.length <= rp.events.length, 'at most one hop per move');
    assert.ok(hops.every(([t, p, dx, dr]) => rp.joined[p] && t >= 1 && t <= a.endTick && Math.abs(dx) + Math.abs(dr) === 1), 'a move of a joined player, in the run');
    const fresh = decodeReplay(encodeReplay({ ...rp, events: hops }));
    assert.deepEqual(simulate(fresh), a);
    assert.deepEqual(simulate(rp), a, 'the hook changes nothing');
  }
  const sim = createSim(decodeReplay(bench)), seen = [];
  const withHook = createSim(decodeReplay(bench), { onHop: (t, p) => seen.push(p) });
  while (sim.step() | withHook.step());   // both to the end, step for step
  assert.equal(withHook.end.endTick, sim.end.endTick);
  assert.ok(seen.length > 100);
});
