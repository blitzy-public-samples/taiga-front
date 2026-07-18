/**
 * Jest configuration — browserless UNIT test layer for the migrated React
 * screens (Kanban + Backlog) that live under `app/react/`.
 *
 * WHY THIS EXISTS
 *   The Kanban and Backlog screens were migrated from AngularJS 1.5.10 to
 *   React 18 and run in-place inside the existing AngularJS shell. Their
 *   component / state / logic units are exercised here with Jest in a jsdom
 *   (browserless) environment. Every other screen is still AngularJS and keeps
 *   its own retained Karma unit suite (`npm run ci:test`); this config never
 *   touches those legacy specs.
 *
 * TEST-LAYER ISOLATION (hard requirement)
 *   `npm test` must run ONLY these Jest specs and pass headlessly in a bare
 *   container: no real or headless browser engine, no network access, and NONE
 *   of the separate end-to-end (e2e) specs under `e2e-react/` — the additive,
 *   isolated layer that is invoked exclusively via `npm run e2e`. Discovery is
 *   therefore constrained twice over:
 *     1. `roots` limits Jest's file crawler to the `app/react` tree, so the
 *        sibling `e2e-react/` tree is never even scanned; and
 *     2. `testMatch` only accepts `*.test.*` / `*.spec.*` files that live
 *        inside an `__tests__` directory under `app/react`.
 *   As a result nothing outside `app/react/**` — most importantly the e2e
 *   specs in `e2e-react/tests/**` — is ever picked up by `npm test`.
 *
 * RUNTIME
 *   Node (pinned to v16.19.1 for this project) loads this file as a CommonJS
 *   module, hence `module.exports`. TypeScript / TSX specs and the source they
 *   import are compiled by ts-jest using the project's root `tsconfig.json`.
 */
module.exports = {
  // Browserless DOM environment, supplied by `jest-environment-jsdom`. React
  // components mount into jsdom; no real browser is launched.
  testEnvironment: 'jsdom',

  // Confine Jest's file crawler to the React tree only. On its own this
  // guarantees the e2e specs (the sibling `e2e-react/` tree) are never scanned.
  roots: ['<rootDir>/app/react'],

  // Only files named `*.test.(ts|tsx)` / `*.spec.(ts|tsx)` that live inside an
  // `__tests__` directory under `app/react` are treated as unit tests. This
  // deliberately excludes `e2e-react/tests/*.spec.ts` (the e2e layer).
  testMatch: ['<rootDir>/app/react/**/__tests__/**/*.(test|spec).(ts|tsx)'],

  // Compile TypeScript / TSX (specs and imported source) with ts-jest, reusing
  // the project's root TypeScript configuration for consistent type settings.
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  // Module resolution order — TS/TSX first so React source is preferred, then
  // the plain JS/JSON fallbacks.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Register the extended DOM assertion matchers (e.g. `toBeInTheDocument`)
  // relied on by the @testing-library/react component tests.
  setupFilesAfterEnv: ['@testing-library/jest-dom'],

  // Always collect coverage so the threshold below is enforced on every run.
  collectCoverage: true,

  // Measure coverage across the React source while excluding the tests
  // themselves, ambient type declarations, and the thin custom-element bundle
  // entry point (which is exercised at runtime, not by unit tests).
  collectCoverageFrom: [
    'app/react/**/*.{ts,tsx}',
    '!app/react/**/__tests__/**',
    '!app/react/**/*.d.ts',
    '!app/react/index.tsx',
  ],

  // Enforce the mandated minimum line coverage for the migrated screens.
  coverageThreshold: {
    global: { lines: 70 },
  },
};
