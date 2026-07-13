/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react unit suite for the Web-Component adapter
 * `app/react/bootstrap.ts`.
 *
 * `bootstrap.ts` is the framework-interop seam of the AngularJS -> React 18.2
 * migration (Technical Specification AAP §0.3.3, §0.6.1): it defines the two
 * Custom Elements `<tg-react-kanban>` / `<tg-react-backlog>`, mounts a React root
 * inside each element's `connectedCallback`, unmounts it in
 * `disconnectedCallback`, and resolves the cross-framework `MountContext` bridge
 * payload with `readMountContext`. Because `bootstrap.ts` carries real branching
 * logic (slug resolution, token JSON-decoding, mount/unmount guards, idempotent
 * registration) and is INCLUDED in the Jest coverage denominator
 * (`jest.config.js` `collectCoverageFrom` excludes only `*.test.*`, `*.d.ts`,
 * `index.tsx`, and `shared/types/**`), this co-located suite drives every branch
 * in jsdom to keep the >= 70% line-coverage gate green.
 *
 * Conventions (matching the sibling React specs, e.g. `KanbanBoard.test.tsx`):
 *   - The automatic JSX runtime is used, so there is NO `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - `@testing-library/jest-dom` matchers are registered by `jest.setup.ts`.
 *   - Both screen components (`KanbanBoard`, `Backlog`) are MOCKED so the unit
 *     under test is exactly the adapter — no full Kanban/Backlog tree, no
 *     network, and no WebSocket is touched. `jest.mock` factories are hoisted
 *     above the imports by ts-jest; the JSX inside them compiles via the
 *     automatic runtime.
 *
 * jsdom supports `customElements`, `createRoot`, and the element lifecycle
 * callbacks, so the whole suite runs without a real browser.
 */

import { act, screen, waitFor } from "@testing-library/react";

import {
    readMountContext,
    registerReactScreens,
    TgReactBacklogElement,
    TgReactKanbanElement,
} from "./bootstrap";
import type { MountContext } from "./shared/types";
import { AUTH_CHANGED_EVENT, AUTH_LOST_EVENT } from "./shared/auth/authEvents";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

// Mock `KanbanBoard`: render a lightweight DOM node jsdom can mount, echoing the
// forwarded `context.projectSlug` as `data-slug` so a test can assert the bridge
// payload actually flowed from `readMountContext(host)` into the screen prop.
jest.mock("./kanban/KanbanBoard", () => ({
    KanbanBoard: (props: { context: { projectSlug?: string | null; token?: string | null } }) => (
        <div
            data-testid="mock-kanban"
            data-slug={props.context.projectSlug ?? ""}
            // Echo the forwarded token too so the same-document auth-bridge tests
            // (finding M11) can prove a remount carried a FRESH context snapshot.
            data-token={props.context.token ?? ""}
        />
    ),
}));

// Mock `Backlog`: a bare marker node — the backlog element shares the same
// factory-built lifecycle as the kanban element, so a presence assertion is
// enough to prove the second Custom Element mounts its screen too.
jest.mock("./backlog/Backlog", () => ({
    Backlog: () => <div data-testid="mock-backlog" />,
}));

/* -------------------------------------------------------------------------- */
/* Typed helpers (keep `any` out of the suite)                                 */
/* -------------------------------------------------------------------------- */

/**
 * The two AngularJS-populated browser globals the adapter reads lazily. Declared
 * as optional so `delete` is legal under `strict` and so each test can toggle
 * them without leaking into the next (see `afterEach`).
 */
type BridgeWindow = typeof window & {
    taiga?: { sessionId?: string };
    taigaConfig?: Record<string, unknown>;
};

const bridgeWindow = window as BridgeWindow;

/**
 * The Custom Element instance shape exposing the lifecycle callbacks. The DOM
 * `HTMLElement` type does not declare `connectedCallback` / `disconnectedCallback`,
 * so tests that invoke them directly (to exercise the mount / unmount guards
 * without going through real DOM insertion) cast through this type rather than
 * `any`.
 */
type LifecycleElement = HTMLElement & {
    connectedCallback: () => void;
    disconnectedCallback: () => void;
};

/* -------------------------------------------------------------------------- */
/* Hermetic teardown                                                           */
/* -------------------------------------------------------------------------- */

afterEach(() => {
    // Clearing the body removes any still-connected Custom Element, which fires
    // `disconnectedCallback` and unmounts its React root; wrapping in `act`
    // flushes that teardown so no update escapes the test boundary.
    act(() => {
        document.body.innerHTML = "";
    });
    localStorage.clear();
    jest.clearAllMocks();
    delete bridgeWindow.taiga;
    delete bridgeWindow.taigaConfig;
    // Reset the jsdom URL so the route-parsing branch of `readMountContext`
    // starts from a clean, non-project path in the next test.
    window.history.pushState({}, "", "/");
});

/* -------------------------------------------------------------------------- */
/* registerReactScreens                                                        */
/* -------------------------------------------------------------------------- */

describe("registerReactScreens", () => {
    it("registers both Custom Elements as a side effect of importing the module", () => {
        // Importing `./bootstrap` above already ran the bottom-of-file
        // `registerReactScreens()` call, so both tags must resolve to the exact
        // exported constructor classes.
        expect(customElements.get("tg-react-kanban")).toBe(TgReactKanbanElement);
        expect(customElements.get("tg-react-backlog")).toBe(
            TgReactBacklogElement,
        );
    });

    it("is idempotent — a second call neither throws nor redefines the tags", () => {
        // The `customElements.get(...)` guards must swallow the redefinition so a
        // double-load of the bundle (or a re-import in tests) cannot raise the
        // "this name has already been used" DOMException.
        expect(() => registerReactScreens()).not.toThrow();

        expect(customElements.get("tg-react-kanban")).toBe(TgReactKanbanElement);
        expect(customElements.get("tg-react-backlog")).toBe(
            TgReactBacklogElement,
        );
    });

    it("no-ops in a non-DOM context where customElements is undefined", () => {
        // Exercise the `typeof customElements === "undefined"` import-safety
        // guard by temporarily removing the registry, then restoring it so the
        // rest of the suite still has a working `customElements`.
        const saved = window.customElements;
        Object.defineProperty(window, "customElements", {
            value: undefined,
            configurable: true,
            writable: true,
        });

        try {
            expect(() => registerReactScreens()).not.toThrow();
        } finally {
            Object.defineProperty(window, "customElements", {
                value: saved,
                configurable: true,
                writable: true,
            });
        }
    });
});

/* -------------------------------------------------------------------------- */
/* Custom Element lifecycle (connectedCallback / disconnectedCallback)         */
/* -------------------------------------------------------------------------- */

describe("Custom Element lifecycle", () => {
    it("mounts the KanbanBoard React tree on connect and forwards the context", async () => {
        // `readMountContext` (called inside `connectedCallback`) reads the
        // `project-slug` host attribute, which the mocked screen echoes as
        // `data-slug` — proving the bridge payload reached the React prop.
        const el = document.createElement("tg-react-kanban");
        el.setAttribute("project-slug", "ctx-proj");

        act(() => {
            document.body.appendChild(el);
        });

        const mounted = await screen.findByTestId("mock-kanban");
        expect(mounted).toBeInTheDocument();
        expect(mounted).toHaveAttribute("data-slug", "ctx-proj");
    });

    it("mounts the Backlog React tree on connect", async () => {
        const el = document.createElement("tg-react-backlog");

        act(() => {
            document.body.appendChild(el);
        });

        expect(await screen.findByTestId("mock-backlog")).toBeInTheDocument();
    });

    it("unmounts the React tree on disconnect", async () => {
        const el = document.createElement("tg-react-kanban");

        act(() => {
            document.body.appendChild(el);
        });
        await screen.findByTestId("mock-kanban");

        // Removing the element fires `disconnectedCallback`, which unmounts the
        // root so an AngularJS route change tears the React tree down cleanly.
        act(() => {
            el.remove();
        });

        await waitFor(() => {
            expect(screen.queryByTestId("mock-kanban")).not.toBeInTheDocument();
        });
    });

    it("guards a double connect so a single React root is created", async () => {
        const el = document.createElement("tg-react-kanban");

        act(() => {
            document.body.appendChild(el);
        });
        await screen.findByTestId("mock-kanban");

        // Invoking `connectedCallback` again while already mounted must hit the
        // `this.root !== null` guard: no throw, no second `createRoot`, and still
        // exactly one rendered screen.
        expect(() =>
            act(() => {
                (el as LifecycleElement).connectedCallback();
            }),
        ).not.toThrow();

        expect(screen.getAllByTestId("mock-kanban")).toHaveLength(1);
    });

    it("no-ops when disconnect fires before a mount", () => {
        // A never-connected element has a `null` root, so `disconnectedCallback`
        // must take the guarded early-return path without throwing.
        const el = document.createElement("tg-react-kanban");

        expect(() =>
            (el as LifecycleElement).disconnectedCallback(),
        ).not.toThrow();
    });
});

/* -------------------------------------------------------------------------- */
/* Same-document auth bridge (finding M11)                                     */
/* -------------------------------------------------------------------------- */

describe("Custom Element same-document auth bridge (M11)", () => {
    it("remounts with the FRESH token on a same-document AUTH_CHANGED_EVENT", async () => {
        localStorage.setItem("token", JSON.stringify("token-old"));
        const el = document.createElement("tg-react-kanban");
        act(() => {
            document.body.appendChild(el);
        });
        const mounted = await screen.findByTestId("mock-kanban");
        expect(mounted).toHaveAttribute("data-token", "token-old");

        // A same-tab refresh (e.g. the http.ts single-flight refresh) writes a
        // new token then announces it via the same-document event. The browser
        // `storage` event would NOT fire here (same document), so this bridge is
        // the only signal — the element must remount with the new credential.
        act(() => {
            localStorage.setItem("token", JSON.stringify("token-new"));
            window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
        });

        await waitFor(() => {
            expect(screen.getByTestId("mock-kanban")).toHaveAttribute("data-token", "token-new");
        });
    });

    it("tears down the React tree on a same-document AUTH_LOST_EVENT", async () => {
        localStorage.setItem("token", JSON.stringify("token-old"));
        const el = document.createElement("tg-react-kanban");
        act(() => {
            document.body.appendChild(el);
        });
        await screen.findByTestId("mock-kanban");

        // A same-tab logout / refresh-failure clears the session and announces
        // the loss; the tree must unmount at once so its live subscriptions stop.
        act(() => {
            localStorage.removeItem("token");
            window.dispatchEvent(new CustomEvent(AUTH_LOST_EVENT));
        });

        await waitFor(() => {
            expect(screen.queryByTestId("mock-kanban")).not.toBeInTheDocument();
        });
    });

    it("ignores a spurious AUTH_CHANGED_EVENT when the token is unchanged (no remount)", async () => {
        localStorage.setItem("token", JSON.stringify("token-same"));
        const el = document.createElement("tg-react-kanban");
        act(() => {
            document.body.appendChild(el);
        });
        const first = await screen.findByTestId("mock-kanban");

        act(() => {
            window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
        });

        // Same token => no teardown/rebuild: the very same DOM node persists.
        expect(screen.getByTestId("mock-kanban")).toBe(first);
        expect(first).toHaveAttribute("data-token", "token-same");
    });

    it("re-mounts a torn-down tree when a valid session returns (auth-lost then auth-changed)", async () => {
        localStorage.setItem("token", JSON.stringify("token-old"));
        const el = document.createElement("tg-react-kanban");
        act(() => {
            document.body.appendChild(el);
        });
        await screen.findByTestId("mock-kanban");

        // Logout tears the tree down...
        act(() => {
            localStorage.removeItem("token");
            window.dispatchEvent(new CustomEvent(AUTH_LOST_EVENT));
        });
        await waitFor(() => {
            expect(screen.queryByTestId("mock-kanban")).not.toBeInTheDocument();
        });

        // ...and a subsequent same-tab login re-mounts it with the new token.
        act(() => {
            localStorage.setItem("token", JSON.stringify("token-relogin"));
            window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
        });
        await waitFor(() => {
            expect(screen.getByTestId("mock-kanban")).toHaveAttribute("data-token", "token-relogin");
        });
    });

    it("stops listening for auth events after disconnect", async () => {
        localStorage.setItem("token", JSON.stringify("token-old"));
        const el = document.createElement("tg-react-kanban");
        act(() => {
            document.body.appendChild(el);
        });
        await screen.findByTestId("mock-kanban");

        act(() => {
            el.remove();
        });
        await waitFor(() => {
            expect(screen.queryByTestId("mock-kanban")).not.toBeInTheDocument();
        });

        // A late auth event for a disconnected element must not resurrect it.
        act(() => {
            localStorage.setItem("token", JSON.stringify("token-new"));
            window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
        });
        expect(screen.queryByTestId("mock-kanban")).not.toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* readMountContext                                                            */
/* -------------------------------------------------------------------------- */

describe("readMountContext", () => {
    it("resolves the full bridge payload from the host attribute, globals, and storage", () => {
        bridgeWindow.taigaConfig = {
            api: "http://localhost:8000/api/v1/",
            eventsUrl: "ws://localhost:8888/events",
            defaultLanguage: "en",
        };
        bridgeWindow.taiga = { sessionId: "sess-123" };
        // `$tgStorage` JSON-encodes every value, so the persisted token is a
        // JSON string that must be `JSON.parse`d exactly once.
        localStorage.setItem("token", JSON.stringify("jwt-abc"));

        const host = document.createElement("div");
        host.setAttribute("project-slug", "my-proj");

        expect(readMountContext(host)).toEqual({
            projectSlug: "my-proj",
            token: "jwt-abc",
            sessionId: "sess-123",
            apiUrl: "http://localhost:8000/api/v1/",
            eventsUrl: "ws://localhost:8888/events",
            language: "en",
        });
    });

    it("falls back to the data-project-slug attribute when project-slug is absent", () => {
        const host = document.createElement("div");
        host.setAttribute("data-project-slug", "data-proj");

        expect(readMountContext(host).projectSlug).toBe("data-proj");
    });

    it("parses the project slug from a /project/:slug/kanban route", () => {
        window.history.pushState({}, "", "/project/url-proj/kanban");
        const host = document.createElement("div");

        expect(readMountContext(host).projectSlug).toBe("url-proj");
    });

    it("parses the project slug from a /project/:slug/backlog route", () => {
        window.history.pushState({}, "", "/project/backlog-proj/backlog");
        const host = document.createElement("div");

        expect(readMountContext(host).projectSlug).toBe("backlog-proj");
    });

    it("yields a null slug when neither the attribute nor the route matches", () => {
        window.history.pushState({}, "", "/home");
        const host = document.createElement("div");

        expect(readMountContext(host).projectSlug).toBeNull();
    });

    it("returns a null token when the storage key is absent", () => {
        localStorage.removeItem("token");
        const host = document.createElement("div");
        host.setAttribute("project-slug", "p");

        expect(readMountContext(host).token).toBeNull();
    });

    it("returns a null token when the stored value is not valid JSON", () => {
        // Malformed JSON makes `JSON.parse` throw; the try/catch must fall back
        // to `null` exactly like `$tgStorage.get`.
        localStorage.setItem("token", "{not json");
        const host = document.createElement("div");
        host.setAttribute("project-slug", "p");

        expect(readMountContext(host).token).toBeNull();
    });

    it("returns a null token when the decoded value is not a string", () => {
        // Valid JSON that decodes to a non-string (here a number) must be
        // rejected by the `typeof parsed === "string"` guard.
        localStorage.setItem("token", JSON.stringify(42));
        const host = document.createElement("div");
        host.setAttribute("project-slug", "p");

        expect(readMountContext(host).token).toBeNull();
    });

    it("applies safe defaults when the AngularJS globals are absent", () => {
        delete bridgeWindow.taiga;
        delete bridgeWindow.taigaConfig;

        const host = document.createElement("div");
        host.setAttribute("project-slug", "p");

        const ctx: MountContext = readMountContext(host);

        expect(ctx.sessionId).toBeNull();
        expect(ctx.apiUrl).toBe("");
        expect(ctx.eventsUrl).toBeNull();
        expect(ctx.language).toBe("en");
    });
});
