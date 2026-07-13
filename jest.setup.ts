/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest global setup file.
 *
 * Registers the `@testing-library/jest-dom` custom matchers (for example
 * `toBeInTheDocument`, `toHaveClass`, `toHaveAttribute`, `toHaveTextContent`)
 * on Jest's global `expect`. It is referenced by `jest.config.js` through the
 * `setupFilesAfterEnv` option, so it runs once for every test file after the
 * testing framework has been installed into the jsdom environment.
 *
 * These DOM matchers are central to the AngularJS -> React migration: the
 * migrated Kanban and Backlog screens must reproduce the exact DOM that the
 * legacy AngularJS controllers rendered, so the React component tests under
 * `app/react/**` assert on class names and `data-*` attributes to prove that
 * DOM parity.
 *
 * `@testing-library/jest-dom` v6 auto-extends `expect` as a side effect of the
 * import, so this bare import is all that is required. (The legacy
 * `@testing-library/jest-dom/extend-expect` entry point is deprecated and is
 * intentionally not used here.)
 */
import "@testing-library/jest-dom";

/**
 * -------------------------------------------------------------------------
 * Fail-on-unexpected-console-output guard (review finding M10 — Test Integrity).
 * -------------------------------------------------------------------------
 *
 * A high line-coverage number is only meaningful if the tests would actually
 * FAIL when the migrated screens misbehave. React reports the most common
 * correctness regressions — invalid DOM nesting, unrecognized custom-element
 * props, missing list `key`s, state updates outside `act(...)`, and unknown
 * DOM attributes — through `console.error` / `console.warn` rather than through
 * thrown exceptions, so a test can render visibly-broken output and still go
 * green. To close that gap this guard records every `console.error` /
 * `console.warn` emitted during a test and fails that test in `afterEach`
 * unless the message matches the tightly-scoped environment allowlist below.
 *
 * The allowlist is deliberately limited to jsdom environment noise that is
 * unrelated to the migrated screens' correctness (jsdom does not implement
 * real navigation or a full CSS parser). Product/React warnings are NOT
 * allowlisted — they must be fixed at the source.
 *
 * Per-test opt-out: a test that intentionally exercises a logging path (for
 * example the bounded WebSocket malformed-frame diagnostics) may either
 * (a) spy on the console method itself with its own `mockImplementation`
 * (that supersedes this guard for the duration of the test), or (b) call
 * `allowConsole(pattern)` to whitelist an expected message for the current
 * test only. Both mechanisms keep the intent explicit at the call site.
 */

/** Substring/RegExp patterns for benign jsdom environment output only. */
const CONSOLE_ALLOWLIST: Array<string | RegExp> = [
  // jsdom has no real navigation/layout engine.
  "Not implemented: navigation",
  "Not implemented: HTMLFormElement.prototype.requestSubmit",
  "Not implemented: HTMLCanvasElement.prototype.getContext",
  /Not implemented:/,
  // jsdom's CSS parser rejects some modern rules the theme ships.
  "Could not parse CSS stylesheet",
];

/** Per-test opt-out patterns; reset before every test. */
let perTestAllow: Array<string | RegExp> = [];

/**
 * Whitelist an expected console message for the CURRENT test only. Intended
 * for tests that assert on a deliberate logging path without spying on the
 * console method directly.
 */
function allowConsole(pattern: string | RegExp): void {
  perTestAllow.push(pattern);
}
// Expose for tests without requiring an import (mirrors the global `expect`).
(globalThis as unknown as { allowConsole: typeof allowConsole }).allowConsole =
  allowConsole;

type ConsoleCall = { level: "error" | "warn"; text: string };
let capturedConsole: ConsoleCall[] = [];
let originalError: typeof console.error;
let originalWarn: typeof console.warn;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function isAllowed(text: string): boolean {
  const matches = (p: string | RegExp) =>
    typeof p === "string" ? text.includes(p) : p.test(text);
  return CONSOLE_ALLOWLIST.some(matches) || perTestAllow.some(matches);
}

beforeEach(() => {
  capturedConsole = [];
  perTestAllow = [];
  originalError = console.error;
  originalWarn = console.warn;
  // Direct assignment (not jest.spyOn) so a test's own `jest.spyOn(console, …)`
  // cleanly supersedes this recorder and `restoreAllMocks()` in a test's own
  // teardown never resets the guard out from under us.
  console.error = (...args: unknown[]) => {
    capturedConsole.push({ level: "error", text: formatArgs(args) });
  };
  console.warn = (...args: unknown[]) => {
    capturedConsole.push({ level: "warn", text: formatArgs(args) });
  };
});

afterEach(() => {
  // Restore the real console FIRST so the failure message (and any subsequent
  // teardown) is never swallowed by the recorder.
  console.error = originalError;
  console.warn = originalWarn;

  const unexpected = capturedConsole.filter((c) => !isAllowed(c.text));
  if (unexpected.length > 0) {
    const detail = unexpected
      .map((c) => `  • console.${c.level}: ${c.text}`)
      .join("\n");
    throw new Error(
      "Test produced unexpected console output (M10 fail-on-console guard).\n" +
        "React reports invalid DOM/props/keys/act warnings via console; fix the " +
        "source, or (for a deliberate logging path) spy on the console method or " +
        "call allowConsole(pattern).\n" +
        detail,
    );
  }
});
