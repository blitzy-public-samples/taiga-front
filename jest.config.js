/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest configuration for the React unit / component test suite.
 *
 * This runner exists solely to exercise the NEW React 18.2 + TypeScript screens
 * introduced by the AngularJS -> React migration (the Kanban board and the
 * Backlog / Sprint-Planning workspace). All new React source lives under
 * `app/react/**`, and its co-located tests are named `*.test.tsx`.
 *
 * It is invoked by the `test:react` npm script (`"test:react": "jest"`) and by
 * the CI Jest gate. It is intentionally a SEPARATE runner from the surviving
 * `test` script (Karma, which runs the AngularJS/CoffeeScript unit specs) and
 * from the Protractor (`conf.e2e.js`) / Playwright (`playwright.config.ts`)
 * end-to-end harnesses; those continue to run the unmigrated screens and MUST
 * NOT be picked up here.
 *
 * Runtime constraint: the whole toolchain is pinned to Node 16.19.1 (see
 * `.nvmrc`). Jest 29 supports Node >= 16.10 — Jest 30 was deliberately avoided
 * because it drops Node 16 support.
 *
 * Option-by-option rationale:
 *
 *  - `preset: "ts-jest"` — compile the TypeScript / TSX sources on the fly so no
 *    separate build step is required to run the tests. The transform below pins
 *    the exact tsconfig so `ts-jest` and the esbuild production bundle share one
 *    source of truth (`target: ES2019`, `jsx: react-jsx`).
 *
 *  - `testEnvironment: "jsdom"` — the migrated components render real DOM and the
 *    tests assert on class names and `data-*` attributes to prove DOM parity with
 *    the legacy AngularJS markup, so a browser-like DOM is required. Provided by
 *    the `jest-environment-jsdom` dev dependency.
 *
 *  - `setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"]` — registers the
 *    `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`,
 *    `toHaveClass`, `toHaveAttribute`) once per test file, after the framework is
 *    installed into jsdom.
 *
 *  - `roots` + `testMatch` — BOTH are scoped to `app/react` so Jest only ever
 *    discovers the new React tests. This double scoping guarantees the ~100
 *    Karma `.spec.coffee` specs under `app/modules`, the Protractor `.e2e.js`
 *    suites under `e2e`, and the Playwright `.spec.ts` suite under `e2e-react`
 *    are never collected by this runner.
 *
 *  - `moduleNameMapper` — a DEFENSIVE stub for any stylesheet import. The
 *    migration reproduces the existing DOM/class names and relies on the already
 *    compiled SCSS theme, so React components should not import stylesheets; this
 *    mapper (backed by `app/react/__mocks__/styleMock.js`) simply keeps Jest from
 *    choking should a `.css/.scss/.sass/.less` import ever appear.
 *
 *  - `collectCoverageFrom` + `coverageThreshold` — coverage is measured across
 *    the new React implementation only, and the >= 70% LINE threshold is a HARD
 *    gate for the migration. Test files, ambient declarations, the thin
 *    `createRoot` entry point, and the pure type modules are excluded from the
 *    denominator because they carry no meaningful branch/line logic to cover.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  // Transform TS/TSX via ts-jest.
  preset: "ts-jest",

  // Browser-like DOM for React component rendering assertions.
  testEnvironment: "jsdom",

  // Resolve every relative path below against the taiga-front root.
  rootDir: ".",

  // Restrict test discovery to the new React tree only (excludes Karma/e2e).
  roots: ["<rootDir>/app/react"],

  // Register @testing-library/jest-dom matchers after the env is set up.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],

  // Only co-located React component/unit tests are collected.
  testMatch: ["<rootDir>/app/react/**/*.test.tsx"],

  // Module resolution order for imports without an explicit extension.
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

  // Compile TypeScript/TSX with the shared root tsconfig (ES2019 / react-jsx).
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },

  // Defensive: map any stylesheet import to an empty stub (see styleMock.js).
  // React components should NOT import stylesheets (they rely on the existing
  // compiled SCSS), so in practice this mapper is never triggered.
  moduleNameMapper: {
    "\\.(css|scss|sass|less)$": "<rootDir>/app/react/__mocks__/styleMock.js",
  },

  // Always measure coverage so the threshold gate below is enforced.
  collectCoverage: true,

  // Coverage denominator: the new React implementation, minus non-logic files.
  collectCoverageFrom: [
    "app/react/**/*.{ts,tsx}",
    "!app/react/**/*.test.tsx",
    "!app/react/**/*.d.ts",
    "!app/react/index.tsx",
    "!app/react/shared/types/**",
  ],

  // Keep the React coverage report out of the AngularJS/Karma coverage output.
  coverageDirectory: "<rootDir>/coverage/react",

  // HARD GATE: fail the run if line coverage of the new React code drops below
  // 70%. Do NOT lower this threshold.
  coverageThreshold: {
    global: {
      lines: 70,
    },
  },
};
