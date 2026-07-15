/*
 * ---------------------------------------------------------------------------
 * Jest configuration — React (Kanban + Backlog) migration unit tests.
 * ---------------------------------------------------------------------------
 *
 * This is the single, root-level Jest configuration for the NEW React source
 * that lives under `app/react/**`. It is invoked by `npm test` (the `test`
 * script in package.json is pointed at `jest`).
 *
 * Design contract (see AAP sections 0.2.1, 0.4.1, 0.6.2, 0.7.1):
 *
 *   1. BROWSERLESS.  The suite runs headlessly in a bare container using the
 *      `jsdom` test environment. It NEVER launches a real browser, NEVER
 *      imports Playwright, and requires NO network access. Playwright is a
 *      strictly separate layer invoked only through `npm run e2e`; this file
 *      contains no reference to `@playwright/test` or any browser driver.
 *
 *   2. TYPESCRIPT via ts-jest.  `.ts` / `.tsx` sources are transformed by
 *      `ts-jest`, which reads the project's root `tsconfig.json` (JSX =
 *      react-jsx, strict mode). No Babel is involved on the React path — the
 *      explicit `transform` below fully replaces Jest's default babel-jest,
 *      so the legacy `.babelrc` (es2015/stage-0, used by the CoffeeScript
 *      pipeline) never touches these tests.
 *
 *   3. SCOPED to React specs only.  Test discovery is triple-guarded so that
 *      Jest can ONLY ever pick up the React unit specs and never the
 *      Playwright `*.spec.ts` files under `e2e-react/`, the legacy Protractor
 *      suites under `e2e/`, or the CoffeeScript Karma specs:
 *        - `roots` limits the search tree to `<rootDir>/app/react`;
 *        - `testMatch` requires the `*.test.{ts,tsx}` naming inside a
 *          `__tests__` directory (Playwright uses `*.spec.ts`, which will
 *          never match);
 *        - `testPathIgnorePatterns` additionally excludes node_modules, dist,
 *          e2e and e2e-react.
 *
 *   4. COVERAGE GATE at 70% lines.  Coverage is collected across the new
 *      React code (`app/react/**`) and `coverageThreshold.global.lines` is
 *      set to 70, so `npm test` FAILS whenever line coverage of the React
 *      code drops below 70%. The gate intentionally measures ONLY the new
 *      React source — the un-instrumented AngularJS/CoffeeScript bundle is
 *      never included in `collectCoverageFrom`.
 * ---------------------------------------------------------------------------
 */

/** @type {import('jest').Config} */
module.exports = {
  // Resolve every relative path below against the taiga-front package root
  // (the directory that contains this file), regardless of CWD.
  rootDir: '.',

  // Browserless DOM. `jest-environment-jsdom` is an explicit devDependency; it
  // provides `window`/`document` for React component tests without a browser.
  testEnvironment: 'jest-environment-jsdom',

  // Constrain the entire search tree to the React source. This is the primary
  // guard that keeps Jest away from e2e-react/**, e2e/**, and the CoffeeScript
  // modules — they live outside app/react and are therefore never scanned.
  roots: ['<rootDir>/app/react'],

  // Only the React unit specs: `*.test.ts` / `*.test.tsx` files that live in a
  // `__tests__` directory anywhere under app/react. Playwright's `*.spec.ts`
  // naming is deliberately excluded and can never match this pattern.
  testMatch: ['<rootDir>/app/react/**/__tests__/**/*.test.{ts,tsx}'],

  // Transform TypeScript/TSX with ts-jest, reading the root tsconfig.json so
  // JSX (react-jsx) and strict-mode type checking apply to the tests. The
  // explicit array form passes options to the ts-jest transformer.
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },

  // Extension resolution order for bare (extensionless) imports.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Register the jest-dom matchers (e.g. toBeInTheDocument, toHaveClass).
  // jest-dom v6 auto-extends `expect` when its package entry is loaded as a
  // setup file, so no dedicated setup script is required. `@testing-library/
  // jest-dom` is an installed devDependency and is also declared in the root
  // tsconfig `types` array so the matchers are typed inside the specs.
  setupFilesAfterEnv: ['@testing-library/jest-dom'],

  // Stub non-JS module imports so browserless specs never choke on assets.
  // The migration reproduces existing CSS class names and relies on the
  // already-compiled SCSS (React does not import stylesheets at runtime), so
  // these stubs are a safety net; both mock modules exist under
  // app/react/__mocks__/ and simply export an empty object.
  moduleNameMapper: {
    '\\.(css|scss|sass|less)$': '<rootDir>/app/react/__mocks__/styleMock.js',
    '\\.(png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot)$':
      '<rootDir>/app/react/__mocks__/fileMock.js',
  },

  // Always collect coverage so the threshold below is enforced on every run,
  // including plain `npm test`.
  collectCoverage: true,

  // Measure ALL new React source. Per the AAP coverage-scope rule
  // (collectCoverageFrom over `app/react/**/*.{ts,tsx}` with only justified
  // exclusions), the only things removed from the measured set are:
  //   - test files themselves (`__tests__/**`), which hold the assertions, and
  //   - ambient type declarations (`*.d.ts`), which carry no executable lines.
  // The custom-element registration entry point (`app/react/index.tsx`) is
  // intentionally NOT blanket-excluded (finding F10): registration is
  // behaviorally important, so once that file is added in a later checkpoint it
  // is measured and must be covered like any other source file.
  collectCoverageFrom: [
    'app/react/**/*.{ts,tsx}',
    '!app/react/**/__tests__/**',
    '!app/react/**/*.d.ts',
  ],

  // The mandated gate: line coverage of the React code must be >= 70%, or the
  // process exits non-zero and `npm test` fails.
  coverageThreshold: {
    global: {
      lines: 70,
    },
  },

  // Write coverage reports here (gitignored / not committed).
  coverageDirectory: '<rootDir>/coverage',

  // Defense-in-depth: even though `roots` already scopes discovery to
  // app/react, explicitly ignore these trees so Jest never attempts to run a
  // Playwright spec or a legacy suite.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/e2e/', '/e2e-react/'],

  // Reset mock call state between tests for deterministic, isolated specs.
  clearMocks: true,
};
