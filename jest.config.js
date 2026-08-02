/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest configuration for the React 18 + TypeScript code introduced by the
 * AngularJS to React migration of the Kanban board and the Backlog /
 * Sprint-Planning screen.
 *
 * WHY THIS FILE EXISTS (technology-specific change, migration seam)
 * ----------------------------------------------------------------
 * The incumbent unit layer is a browser-driven runner whose file list is bound
 * to the compiled bundle emitted by the Gulp pipeline. That coupling makes it
 * unusable for the new React tree: it needs a real browser binary and a
 * completed build before a single assertion can execute.
 *
 * This configuration is deliberately the opposite on every axis:
 *
 *   - browserless: `jsdom` supplies the DOM, so `npm test` passes on a machine
 *     with no browser binary installed at all;
 *   - build-free: nothing here refers to any generated build output, so the
 *     suite runs straight from TypeScript source;
 *   - offline: no global setup boots a server and no base URL is configured,
 *     so anything a unit needs is mocked inside its own spec;
 *   - isolated: `roots` is pinned to `app/react`, so the 106 CoffeeScript specs
 *     of the incumbent layer stay invisible here and keep running unchanged
 *     under their own runner, which keeps its own configuration file at the
 *     repository root and its own npm scripts.
 *
 * The end-to-end layer lives in its own tree with its own runner and its own
 * npm script (`e2e:react`). It is never imported from here, and neither
 * `npm test` nor any Gulp task ever invokes it.
 *
 * DESIGN CONSEQUENCE FOR THE REACT TREE
 * -------------------------------------
 * Because this suite is browserless and build-free, the React code has to be
 * shaped so it can be exercised without a browser: data fetching, realtime
 * subscriptions and drag effects belong in `app/react/**` hooks and container
 * components, while presentational components stay pure functions of their
 * props and reducers and selectors stay plain functions. That split is what
 * makes the 70 % line-coverage gate below achievable rather than aspirational.
 *
 * INVOCATION
 * ----------
 *   npm test                  runs this suite and nothing else
 *   npm test -- --watch       local iteration (never used by CI)
 *   npm run typecheck         the separate `tsc --noEmit` gate
 */
module.exports = {
    // Anchor every relative path below to this file's directory rather than to
    // the shell's working directory, so the suite behaves identically whether
    // it is started from the repository root or through an npm script.
    rootDir: __dirname,

    // Only the new React tree is in scope. This single option is what keeps the
    // incumbent CoffeeScript specs out of this runner: they live under
    // `app/coffee` and `app/modules`, which are never crawled from here. It also
    // excludes the end-to-end tree, whose specs are written for a different
    // runner and would fail if collected as unit tests.
    roots: ['app/react'],

    // Co-located spec convention for the React tree: `Foo.tsx` is tested by
    // `Foo.test.tsx` sitting beside it. The `.spec.coffee` files of the
    // incumbent layer are not matched, by extension and by location.
    testMatch: ['**/*.test.ts', '**/*.test.tsx'],

    // jsdom provides `window`, `document` and the DOM APIs the React components
    // and the IntersectionObserver-based virtualisation hook expect. Supplied by
    // the pinned `jest-environment-jsdom` package, which Jest 29 no longer
    // bundles by default.
    testEnvironment: 'jsdom',

    // A stable, deterministic document origin. Some bridge code reads
    // `window.location`; pinning the origin keeps such reads reproducible and
    // makes clear that no server is contacted.
    testEnvironmentOptions: {
        url: 'http://localhost/',
    },

    // TypeScript is compiled in-process by ts-jest, which reads the single
    // strict `tsconfig.json` at the repository root, so the specs are held to
    // exactly the same type rules as the production sources and no second
    // TypeScript configuration file has to be maintained.
    //
    // The two inline overrides are required, not stylistic. The root
    // configuration targets a bundler (`module: "esnext"` with
    // `moduleResolution: "bundler"`) because the browser bundle is produced by
    // esbuild. Jest's module registry is CommonJS, so ES module output would
    // fail at require time; `moduleResolution` has to move with `module`
    // because `bundler` resolution is only legal for ES module output. Every
    // other compiler option, `jsx: "react-jsx"` and `strict` included, is
    // inherited from `tsconfig.json` unchanged.
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    module: 'commonjs',
                    moduleResolution: 'node',
                },
            },
        ],
    },

    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

    // Stylesheets are resolved to an inert local module: jsdom cannot parse
    // Sass or CSS, and the specs assert on emitted class names rather than on
    // computed style, because the migration preserves every existing class name
    // verbatim (transformation rule T1). See the stub for the full rationale.
    moduleNameMapper: {
        '\\.(css|scss|sass)$': '<rootDir>/app/react/test-support/styleStub.js',
    },

    // Registers the DOM matchers (`toBeInTheDocument`, `toHaveClass`, ...) on
    // `expect` for every spec. Loaded after the test framework is installed,
    // which is what `setupFilesAfterEnv` is for.
    //
    // This covers run time only. The matching type declarations are pulled into
    // the program by `app/react/test-support/jestDomMatchers.d.ts`, because
    // `tsconfig.json` pins its `types` array and would otherwise reject these
    // matchers at type-check time while accepting them at run time.
    setupFilesAfterEnv: ['@testing-library/jest-dom'],

    // Coverage is always on, so the threshold below cannot be bypassed by
    // forgetting a command-line flag.
    collectCoverage: true,

    // Scoped to the new React sources only. Listing sources explicitly (rather
    // than letting Jest report on imported files alone) means a component that
    // no spec touches still counts against the gate, so coverage cannot be
    // inflated by leaving whole files untested.
    collectCoverageFrom: [
        'app/react/**/*.{ts,tsx}',
        // Specs measure the code under test, not themselves.
        '!app/react/**/*.test.{ts,tsx}',
        // Ambient declarations emit no executable statements.
        '!app/react/**/*.d.ts',
        // The bundle entry point is a single `customElements.define` side effect
        // executed by the browser at load time; it holds no branching logic and
        // cannot be imported under jsdom without registering a global element.
        '!app/react/index.ts',
    ],

    // The mandated quality gate: at least 70 % line coverage across the new
    // React code. This figure is a hard requirement and must never be lowered
    // to make a failing suite pass; raise coverage in the specs instead.
    coverageThreshold: {
        global: {
            lines: 70,
        },
    },

    // `text` prints the per-file table so a threshold failure immediately names
    // the files that caused it; `lcov` writes a machine-readable report for CI.
    coverageReporters: ['text', 'lcov'],

    // `tmp/` is already ignored by version control, so the report is written
    // without adding an ignore rule and without leaving untracked files behind.
    coverageDirectory: 'tmp/coverage',

    // Mock hygiene: every spec starts from a clean slate, and spies installed
    // with `jest.spyOn` are put back afterwards, so ordering between specs can
    // never leak state.
    clearMocks: true,
    restoreMocks: true,
};
