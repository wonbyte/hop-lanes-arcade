// ESLint for Hop Lanes: the recommended rules, the security plugin, no unused variables, no warnings (npm run lint
// passes --max-warnings 0) and, for the game and the server, a cap on how complex one function may be. Unused exports are
// caught by tools/check-exports.mjs (eslint-plugin-import's rule for that does not run under ESLint 9's flat config).
// Run: npm run lint
import js from '@eslint/js';
import security from 'eslint-plugin-security';

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
  performance: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', fetch: 'readonly',
  AbortController: 'readonly', URL: 'readonly', Blob: 'readonly', File: 'readonly', Image: 'readonly', Audio: 'readonly',
  AudioContext: 'readonly', webkitAudioContext: 'readonly', Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly',
  matchMedia: 'readonly', screen: 'readonly', THREE: 'readonly', btoa: 'readonly', atob: 'readonly', addEventListener: 'readonly', removeEventListener: 'readonly', history: 'readonly', alert: 'readonly', prompt: 'readonly',
  Intl: 'readonly', TextEncoder: 'readonly', crypto: 'readonly', HTMLElement: 'readonly', getComputedStyle: 'readonly',
  MutationObserver: 'readonly', ResizeObserver: 'readonly', Node: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly'
};
const nodeGlobals = { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', URL: 'readonly', AbortController: 'readonly',
  performance: 'readonly', fetch: 'readonly', structuredClone: 'readonly', queueMicrotask: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly' };

export default [
  { ignores: ['vendor/**', 'hop-lanes-standalone.html', '**/node_modules/**', 'reports/**', '.stryker-tmp/**', '.scan-tools/**', 'bench/**'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browserGlobals },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // the security plugin's object-injection rule fires on every map lookup in a game; the real sinks are checked by review
      'security/detect-object-injection': 'off'
    }
  },
  {
    // measured with these rules (docs/budgets.md is for speed; this is for the code): no function above 20 paths
    // (it was 36 in sim.js land()), nesting 4 deep at most, 5 parameters at most
    files: ['js/**/*.js', 'server/**/*.mjs'],
    rules: { complexity: ['error', 20], 'max-depth': ['error', 4], 'max-params': ['error', 5] }
  },
  {
    files: ['server/**/*.mjs', 'tests/**/*.mjs', 'tools/**/*.mjs', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...nodeGlobals, ...browserGlobals } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'security/detect-object-injection': 'off', 'security/detect-non-literal-fs-filename': 'off', 'security/detect-child-process': 'off' }
  }
];
