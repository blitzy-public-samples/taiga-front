/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * F-A — Global `console.error` guard (jest `setupFilesAfterEnv`).
 *
 * The React Backlog root hosts its sprint sidebar inside a lowercase custom
 * element via `createElement("sidebar", …)` (BacklogApp.tsx). React does not
 * recognize `<sidebar>` as an intrinsic element and emits a one-off
 * `console.error`:
 *
 *   "Warning: The tag <sidebar> is unrecognized in this browser. If you meant
 *    to render a React component, start its name with an uppercase letter."
 *
 * That warning is benign (the element is intentional and class-driven CSS
 * themes it exactly like the Jade output), but before this guard it leaked
 * un-asserted on every happy-path Backlog render — noise that could hide a
 * genuinely new console error.
 *
 * This guard makes console hygiene explicit for EVERY spec:
 *   - the single benign `<sidebar>` unrecognized-tag warning is suppressed;
 *   - EVERY other `console.error` is still forwarded (so it stays visible) AND
 *     recorded, and the test FAILS in `afterEach` if any such error leaked.
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

/** True when the call is React's benign "<sidebar> is unrecognized" warning. */
function isBenignSidebarWarning(args: readonly unknown[]): boolean {
    const format = typeof args[0] === "string" ? (args[0] as string) : "";
    return (
        /is unrecognized in this browser/.test(format) &&
        args.some((a) => a === "sidebar")
    );
}

let originalConsoleError: ConsoleErrorFn;
let leaked: unknown[][];

beforeEach(() => {
    originalConsoleError = console.error.bind(console) as ConsoleErrorFn;
    leaked = [];

    console.error = ((...args: unknown[]): void => {
        if (isBenignSidebarWarning(args)) {
            // Intentional, benign — swallow it.
            return;
        }
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
            `Unexpected console.error during test (${captured.length}). Only the ` +
                `benign React "<sidebar> is unrecognized" warning is allowed; ` +
                `assert or fix the following:\n${rendered}`,
        );
    }
});
