/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Global `console.error` guard (jest `setupFilesAfterEnv`).
 *
 * Every React unit spec is held to strict console hygiene: ANY `console.error`
 * that leaks during a test — an unrecognized-tag warning, an act() warning, a
 * PropTypes failure, an unhandled render error — fails that test in
 * `afterEach`. There is no allowlist: the React roots emit only valid,
 * React-recognized markup (the sprint sidebar and the lightbox side panels are
 * semantic `<aside className="sidebar">` landmarks, not the legacy non-standard
 * `<sidebar>` element), so no benign warning needs to be tolerated.
 *
 * It is installed via raw assignment (not `jest.spyOn`) so it composes cleanly
 * with specs that install their OWN `console.error` spy for a deliberate error
 * path: their spy sits above this wrapper for the duration of the test and, on
 * restore, hands control back to it; this guard's `afterEach` then restores the
 * true original regardless. Registered from `setupFilesAfterEnv`, its
 * `beforeEach` runs first and its `afterEach` runs last, wrapping each test.
 *
 * This file lives under `app/react/__tests__/` so it is excluded from coverage
 * (`collectCoverageFrom` ignores `**​/__tests__/**`) and, lacking a
 * `.test`/`.spec` suffix, is never itself collected as a test.
 */

type ConsoleErrorFn = (...args: unknown[]) => void;

let originalConsoleError: ConsoleErrorFn;
let leaked: unknown[][];

beforeEach(() => {
    originalConsoleError = console.error.bind(console) as ConsoleErrorFn;
    leaked = [];

    console.error = ((...args: unknown[]): void => {
        // Record for the afterEach assertion, and still forward so the error
        // remains visible in the test output.
        leaked.push(args);
        originalConsoleError(...args);
    }) as ConsoleErrorFn;
});

afterEach(() => {
    // Always restore the true original, even if a spec left its own spy in
    // place (clearMocks resets call history but does not restore spies).
    console.error = originalConsoleError;

    if (leaked.length > 0) {
        const rendered = leaked
            .map((args, i) => {
                const first =
                    typeof args[0] === "string" ? args[0] : String(args[0]);
                return `  [${i + 1}] ${first}`;
            })
            .join("\n");
        const captured = leaked;
        leaked = [];
        throw new Error(
            `Unexpected console.error during test (${captured.length}). No ` +
                `console.error is allowed; assert or fix the following:\n${rendered}`,
        );
    }
});
