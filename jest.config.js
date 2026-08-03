/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit-test configuration for the React sources under `app/react`.
 *
 * This runner is deliberately browserless, build-free and offline, and `roots`
 * confines it to `app/react`: the CoffeeScript specs keep their own runner and
 * configuration, and the end-to-end layer keeps its own runner and npm script.
 * Nothing here refers to build output, so the suite runs straight from source.
 */
module.exports = {
    rootDir: __dirname,

    roots: ['app/react'],

    testMatch: ['**/*.test.ts', '**/*.test.tsx'],

    testEnvironment: 'jsdom',

    testEnvironmentOptions: {
        url: 'http://localhost/',
    },

    // The two overrides are required, not stylistic: `tsconfig.json` targets a
    // bundler, and Jest's module registry is CommonJS, so ES module output would
    // fail at require time. `moduleResolution` has to move with `module` because
    // `bundler` resolution is only legal for ES module output. Every other
    // compiler option is inherited from `tsconfig.json` unchanged.
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

    // jsdom parses neither Sass nor CSS, and the specs assert on emitted class
    // names rather than on computed style, so stylesheet specifiers resolve to
    // an inert stub instead of being compiled.
    moduleNameMapper: {
        '\\.(css|scss|sass)$': '<rootDir>/app/react/styleMock.ts',
    },

    setupFilesAfterEnv: ['@testing-library/jest-dom'],

    collectCoverage: true,

    collectCoverageFrom: [
        'app/react/**/*.{ts,tsx}',
        '!app/react/**/*.test.{ts,tsx}',
        '!app/react/**/*.d.ts',
        '!app/react/index.ts',
    ],

    coverageThreshold: {
        global: {
            lines: 70,
        },
    },

    coverageReporters: ['text', 'lcov'],

    coverageDirectory: 'tmp/coverage',

    clearMocks: true,
    restoreMocks: true,
};
