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
        // Future-boundary groundwork stubs: the Kanban/Backlog presentational
        // layer and its state/types are introduced — and unit-tested — by their
        // own later checkpoints. They are OUT OF SCOPE for this shared-runtime
        // foundation boundary (no registered root wires them in yet), so the
        // ≥70% gate below measures exactly the "new React code" this boundary
        // delivers (AAP §0.2.1, §0.6.3). Re-include these once the Kanban/Backlog
        // component boundaries land with their own specs.
        "!app/react/kanban/useKanbanState.ts",
        "!app/react/backlog/types.ts"
    ],
    coverageDirectory: "<rootDir>/coverage",

    // Net-new gate: ≥70% LINE coverage for the new React code (AAP §0.2.1, §0.5.2, §0.6.3)
    coverageThreshold: {
        global: { lines: 70 }
    }
};
