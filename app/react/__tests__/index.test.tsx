/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit spec for the React migration bundle entry point (`app/react/index.tsx`).
 *
 * The entry file's whole job is a load-time side effect: register the two Web
 * Components — `tg-react-kanban` and `tg-react-backlog` — on
 * `window.customElements` before `angular.bootstrap` runs. This suite asserts
 * that contract under jsdom:
 *   1. Importing the module defines BOTH custom elements as HTMLElement
 *      subclasses, each wired to a distinct React root.
 *   2. Re-evaluating the bundle is idempotent (the double-registration guard
 *      prevents the `NotSupportedError` that `customElements.define` throws on a
 *      duplicate tag).
 *   3. In a context without a custom-element registry the module no-ops instead
 *      of throwing (so the entry stays importable from non-browser tooling).
 *
 * `jest.isolateModules(require(...))` is used to re-run the module's top-level
 * side effect in a fresh module registry. Note that jsdom's `customElements`
 * registry is the environment global and is NOT reset between these runs, so a
 * tag defined by an earlier run stays defined — which is precisely what
 * exercises the "already registered" guard on subsequent runs.
 */

const KANBAN_TAG = "tg-react-kanban";
const BACKLOG_TAG = "tg-react-backlog";

/** Evaluate the entry module's top-level registration side effect afresh. */
function evaluateEntry(): void {
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        require("../index");
    });
}

describe("app/react/index (custom-element registration entry point)", () => {
    afterEach(() => {
        jest.resetModules();
    });

    it("defines both custom elements, wired to distinct HTMLElement roots", () => {
        evaluateEntry();

        const kanbanCtor = window.customElements.get(KANBAN_TAG);
        const backlogCtor = window.customElements.get(BACKLOG_TAG);

        // Both tags are now registered...
        expect(typeof kanbanCtor).toBe("function");
        expect(typeof backlogCtor).toBe("function");

        // ...as genuine HTMLElement subclasses (created instances upgrade to the
        // registered class rather than falling back to HTMLUnknownElement)...
        const kanbanEl = document.createElement(KANBAN_TAG);
        const backlogEl = document.createElement(BACKLOG_TAG);
        expect(kanbanEl).toBeInstanceOf(HTMLElement);
        expect(backlogEl).toBeInstanceOf(HTMLElement);
        expect(kanbanEl.constructor).toBe(kanbanCtor);
        expect(backlogEl.constructor).toBe(backlogCtor);

        // ...and each tag maps to its OWN class (Kanban root != Backlog root).
        expect(kanbanCtor).not.toBe(backlogCtor);
    });

    it("is idempotent: re-evaluating the bundle does not throw when tags already exist", () => {
        // First evaluation defines the tags (or they are already defined by a
        // prior test in this file's shared jsdom registry).
        evaluateEntry();
        expect(window.customElements.get(KANBAN_TAG)).toBeDefined();
        expect(window.customElements.get(BACKLOG_TAG)).toBeDefined();

        // A second evaluation must hit the `customElements.get(...)` guard and
        // return early instead of letting `define` throw NotSupportedError.
        expect(() => evaluateEntry()).not.toThrow();

        // The registrations are unchanged and still present.
        expect(window.customElements.get(KANBAN_TAG)).toBeDefined();
        expect(window.customElements.get(BACKLOG_TAG)).toBeDefined();
    });

    it("no-ops safely when a custom-element registry is unavailable", () => {
        const originalRegistry = window.customElements;

        // Simulate a non-browser / registry-less context.
        Object.defineProperty(window, "customElements", {
            value: undefined,
            configurable: true,
            writable: true,
        });

        try {
            expect(() => evaluateEntry()).not.toThrow();
        } finally {
            // Always restore the real registry for any subsequent tests.
            Object.defineProperty(window, "customElements", {
                value: originalRegistry,
                configurable: true,
                writable: true,
            });
        }
    });
});
