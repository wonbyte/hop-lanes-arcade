// npm run deps: the module graph rules (dependency-cruiser). CLAUDE.md: "Game rules live in rules/gen/sim; world.js and
// players.js only render them", and the score server runs the same rules, so those files must stay pure.
const PURE = '^js/(rules|gen|sim|replay|missions)\\.js$';
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', comment: 'an import cycle (players.js <-> screens.js was one: now a hook)', from: {}, to: { circular: true } },
    { name: 'pure-rules', severity: 'error', comment: 'the rules import only each other: no DOM, no Three.js, no game state',
      from: { path: PURE }, to: { pathNot: PURE } },
    { name: 'server-pure', severity: 'error', comment: 'the score server imports only Node and the pure rules',
      from: { path: '^server/' }, to: { path: '^js/', pathNot: PURE } },
    { name: 'no-orphans', severity: 'error', comment: 'a module nothing imports', from: { orphan: true, path: '^js/' }, to: {} },
    { name: 'no-tests-in-game', severity: 'error', comment: 'the game never imports test or tool code',
      from: { path: '^js/' }, to: { path: '^(tests|tools)/' } }
  ],
  options: { doNotFollow: { path: 'node_modules' }, moduleSystems: ['es6'], exclude: { path: '^vendor/' } }
};
