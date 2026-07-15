/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/** @type {import('jest').Config} */
module.exports = {
    // Browserless DOM environment (split from Jest core since v28 → jest-environment-jsdom 29.7.0)
    testEnvironment: "jsdom",

    // Only look at the React migration source — never the AngularJS/CoffeeScript tree
    roots: ["<rootDir>/app/react"],

    // Unit specs live in __tests__/ and/or are named *.test.ts(x)
    testMatch: [
        "<rootDir>/app/react/**/__tests__/**/*.(test|spec).ts?(x)",
        "<rootDir>/app/react/**/*.(test|spec).ts?(x)"
    ],

    // TypeScript transform via ts-jest; override module→commonjs for the CJS Jest runtime.
    transform: {
        "^.+\\.(ts|tsx)$": ["ts-jest", {
            tsconfig: { module: "commonjs", jsx: "react-jsx" }
        }]
    },

    // @testing-library/jest-dom v6 auto-registers matchers when required
    setupFilesAfterEnv: ["@testing-library/jest-dom"],

    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

    // In case any React file imports styles/assets, stub them (React theming is class-driven,
    // so this is defensive; identity mapping avoids parse errors if an import appears).
    moduleNameMapper: {
        "\\.(css|scss|sass|less)$": "<rootDir>/app/react/__mocks__/styleMock.js",
        "\\.(png|jpg|jpeg|gif|svg)$": "<rootDir>/app/react/__mocks__/fileMock.js"
    },

    clearMocks: true,

    // Coverage measured only on React source, excluding tests/mocks
    collectCoverageFrom: [
        "app/react/**/*.{ts,tsx}",
        "!app/react/**/*.d.ts",
        "!app/react/**/*.(test|spec).{ts,tsx}",
        "!app/react/**/__tests__/**",
        "!app/react/**/__mocks__/**",
        // The Kanban/Backlog component boundaries have now landed with their own
        // specs (e.g. useKanbanState.ts is exercised by useKanbanState.test.ts),
        // so those modules are measured by the coverage gate below (QA finding
        // F7 — the earlier exclusion masked an otherwise well-tested file and
        // could have hidden a future regression). Only `backlog/types.ts` stays
        // excluded because it is pure type declarations with no executable lines.
        "!app/react/backlog/types.ts"
    ],
    coverageDirectory: "<rootDir>/coverage",

    // Net-new gate: ≥70% coverage for the new React code (AAP §0.2.1, §0.5.2, §0.6.3).
    // The AAP mandates the ≥70% LINE gate; branch/function/statement gates are added
    // alongside it (QA finding F7 / Areas of Concern #4) so a regression that drops
    // branch or function coverage — e.g. an untested Card action or Swimlane drag-hover
    // timer path — is caught rather than being masked by the healthy line aggregate.
    coverageThreshold: {
        global: { lines: 70, branches: 70, functions: 70, statements: 70 }
    }
};
