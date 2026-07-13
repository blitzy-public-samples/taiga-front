/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `bootstrap.ts` — the Web-Component Adapter that lets the React 18.2 migration
 * screens coexist inside the surviving AngularJS 1.5.10 shell WITHOUT any
 * `ngUpgrade` / `ngReact` bridge (Technical Specification AAP §0.3.3, §0.6.1).
 *
 * It defines two Custom Elements — `<tg-react-kanban>` and `<tg-react-backlog>`
 * — and, inside each element's `connectedCallback`, mounts a React root that
 * renders the corresponding screen component (`KanbanBoard` / `Backlog`). The
 * root is torn down in `disconnectedCallback`, so an AngularJS route change
 * (which removes the routed template from the DOM) cleanly unmounts the React
 * tree. AngularJS renders the unknown `<tg-react-*>` tags as inert nodes; once
 * `customElements.define(...)` has run the browser upgrades them and React
 * takes over that subtree.
 *
 * LOAD-ORDER CONTRACT (do not violate):
 *   `app-loader/app-loader.coffee` loads the built bundles in the order
 *   `elements.js` -> `react-screens.js` -> `app.js`, i.e. BEFORE
 *   `angular.bootstrap(document, ["taiga"])` runs. `react-screens.js` is the
 *   esbuild bundle whose entry (`app/react/index.tsx`) does `import "./bootstrap"`.
 *   Therefore the element registration MUST be a side effect of *evaluating*
 *   this module — the bottom-of-file `registerReactScreens()` call — so both
 *   tags are defined before AngularJS ever routes to the kanban/backlog
 *   templates that contain them.
 *
 * LAZY-CONTEXT CONTRACT (do not violate):
 *   At the moment this module is evaluated (before `app.js`), the AngularJS
 *   session/config globals do not exist yet — `window.taiga.sessionId` is set by
 *   `app.js` (`app/coffee/app.coffee` L26) and `window.taigaConfig` is populated
 *   by the app-loader. By the time an element actually *connects* (after
 *   `angular.bootstrap`, on a route to `/kanban` or `/backlog`) they do exist.
 *   Consequently ALL runtime context is read LAZILY inside `connectedCallback`
 *   via `readMountContext(host)` — never at module top level.
 *
 * ISOLATION CONTRACT:
 *   This file touches only the DOM, React, and browser globals
 *   (`window.taigaConfig`, `window.taiga`, `localStorage`). It never imports
 *   AngularJS, SCSS, or anything from `app/coffee/**` / `app/modules/**`. It is a
 *   `.ts` file, so it contains NO JSX — React elements are created with
 *   `createElement(...)`. The `jsx: "react-jsx"` automatic runtime means no
 *   `import React from "react"` is required anywhere in the tree.
 *
 * Exports (all consumed by the co-located `bootstrap.test.tsx` unit suite):
 *   - `readMountContext(host)` — resolves the cross-framework bridge payload.
 *   - `TgReactKanbanElement` / `TgReactBacklogElement` — the Custom Element classes.
 *   - `registerReactScreens()` — idempotent `customElements.define` registration.
 */

import { createElement } from "react";
import type { FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KanbanBoard } from "./kanban/KanbanBoard";
import { Backlog } from "./backlog/Backlog";
import type { MountContext } from "./shared/types";

/**
 * Custom-element tag names. Declared once so the `customElements.get(...)`
 * guard and the `customElements.define(...)` call in {@link registerReactScreens}
 * can never drift apart. These strings are part of the interop contract with the
 * route templates (`app/partials/kanban/kanban.jade` and
 * `app/partials/backlog/backlog.jade`) which host `<tg-react-kanban>` /
 * `<tg-react-backlog>` — they MUST remain exactly these values.
 */
const TG_REACT_KANBAN = "tg-react-kanban";
const TG_REACT_BACKLOG = "tg-react-backlog";

/**
 * Matches the AngularJS project routes `/project/:pslug/kanban` and
 * `/project/:pslug/backlog` (`app/coffee/app.coffee` L226/L235) and captures the
 * project slug in group 1. Used only as the last-resort fallback for
 * {@link readMountContext} when the host element carries no explicit slug
 * attribute. Declared at module scope because it is a static literal (it reads
 * no runtime context, so it does not violate the lazy-context contract).
 */
const PROJECT_ROUTE_RE = /\/project\/([^/]+)\/(?:kanban|backlog)/;

/**
 * Resolve the {@link MountContext} bridge payload for a mounted screen at
 * `connectedCallback` time.
 *
 * This mirrors, without importing them, the AngularJS auth/session/config
 * semantics:
 *   - `projectSlug` — the `project-slug` (or `data-project-slug`) host attribute
 *     set by the route template, falling back to parsing the current
 *     `window.location.pathname` against {@link PROJECT_ROUTE_RE}. `null` when no
 *     slug can be determined (the screens resolve slug -> project via
 *     `shared/api/client.ts`, mirroring the `:pslug` route-param flow).
 *   - `token` — the JWT persisted by `auth.coffee` via
 *     `$tgStorage.set("token", …)` (`base/storage.coffee` L27-32), which
 *     `JSON.stringify`s every value. The raw `localStorage` entry is therefore a
 *     JSON-encoded string and must be `JSON.parse`d exactly once (never
 *     double-encoded). Parse failure or a missing key yields `null`, matching
 *     `$tgStorage.get` (`base/storage.coffee` L17-25).
 *   - `sessionId` — the SAME `window.taiga.sessionId` the AngularJS app generated
 *     (`app.coffee` L26), so the React API client sends an identical
 *     `X-Session-Id` header rather than minting a competing session id.
 *   - `apiUrl` / `eventsUrl` / `language` — read from `window.taigaConfig`
 *     (populated by the app-loader; `api`, `eventsUrl`, `defaultLanguage`).
 *
 * Exported so the co-located `bootstrap.test.tsx` can unit-test the resolution
 * logic directly against a synthetic host element and mocked globals.
 *
 * @param host - The Custom Element instance being connected.
 * @returns The fully resolved, framework-agnostic mount context.
 */
export function readMountContext(host: HTMLElement): MountContext {
    // --- projectSlug: explicit host attribute wins, else parse the route. ---
    let projectSlug: string | null =
        host.getAttribute("project-slug") ??
        host.getAttribute("data-project-slug");

    if (projectSlug === null) {
        const match = PROJECT_ROUTE_RE.exec(window.location.pathname);
        projectSlug = match !== null ? match[1] : null;
    }

    // --- token: JSON-decode the $tgStorage-encoded localStorage value. ---
    let token: string | null = null;
    try {
        const raw = localStorage.getItem("token");
        if (raw !== null) {
            // `$tgStorage` stores every value via `JSON.stringify`, so the JWT
            // string round-trips through `JSON.parse` to a plain string. Anything
            // that is not a string (unexpected) is treated as "no token".
            const parsed: unknown = JSON.parse(raw);
            token = typeof parsed === "string" ? parsed : null;
        }
    } catch {
        // Malformed / non-JSON value — mirror `$tgStorage.get`'s null fallback.
        token = null;
    }

    // --- sessionId: reuse the AngularJS session id (never generate a new one). ---
    const sessionId =
        (window as unknown as { taiga?: { sessionId?: string } }).taiga
            ?.sessionId ?? null;

    // --- config: read the runtime configuration injected by the app-loader. ---
    const cfg =
        (window as unknown as { taigaConfig?: Record<string, unknown> })
            .taigaConfig ?? {};
    const apiUrl = String(cfg.api ?? "");
    const eventsUrl = (cfg.eventsUrl as string | null) ?? null;
    const language = String(cfg.defaultLanguage ?? "en");

    return { projectSlug, token, sessionId, apiUrl, eventsUrl, language };
}

/**
 * Build a Custom Element class that mounts the supplied React screen component
 * on connect and unmounts it on disconnect. A single factory keeps the kanban
 * and backlog elements behaviourally identical (deterministic mount/unmount,
 * double-mount guard) so their lifecycles cannot diverge.
 *
 * The return type is annotated as the built-in {@link CustomElementConstructor}
 * so the two exported subclasses below extend a NAMED base type — this keeps the
 * exported declarations free of the private `root` field and the anonymous
 * class expression, which would otherwise be rejected under `strict`.
 *
 * @param Component - The screen's React function component. Its single prop is
 *   the `{ context: MountContext }` object; typed as `FunctionComponent` so the
 *   `createElement` call resolves cleanly to the function-component overload.
 * @returns A `HTMLElement` subclass constructor ready for `customElements.define`.
 */
function createReactScreenElement(
    Component: FunctionComponent<{ context: MountContext }>,
): CustomElementConstructor {
    return class extends HTMLElement {
        /** The React root owning this element's subtree, or `null` when unmounted. */
        private root: Root | null = null;

        /**
         * Mount the React tree into the element itself. Guarded so a spurious
         * re-connect (or a connect fired while already mounted) does not create a
         * second root over the same container.
         */
        connectedCallback(): void {
            if (this.root !== null) {
                return;
            }

            this.root = createRoot(this);
            this.root.render(
                createElement(Component, { context: readMountContext(this) }),
            );
        }

        /**
         * Unmount the React tree so an AngularJS route change tears it down
         * cleanly and releases its listeners / WebSocket subscriptions.
         */
        disconnectedCallback(): void {
            if (this.root !== null) {
                this.root.unmount();
                this.root = null;
            }
        }
    };
}

/**
 * Custom Element backing `<tg-react-kanban>` — mounts the {@link KanbanBoard}
 * screen (feature F-001).
 */
export class TgReactKanbanElement extends createReactScreenElement(KanbanBoard) {}

/**
 * Custom Element backing `<tg-react-backlog>` — mounts the {@link Backlog}
 * screen (feature F-002).
 */
export class TgReactBacklogElement extends createReactScreenElement(Backlog) {}

/**
 * Register both Custom Elements, idempotently.
 *
 * Each `define` is guarded by `customElements.get(...)` so a double-load of the
 * bundle (or the test suite importing this module more than once) does not throw
 * a "this name has already been used" `DOMException`. The `typeof customElements`
 * check keeps the module import-safe in any non-DOM evaluation context.
 *
 * Exported so tests can assert the registration is idempotent, and so a host
 * that imports the module without the bottom-of-file side effect (e.g. a future
 * consumer) can still trigger registration explicitly.
 */
export function registerReactScreens(): void {
    if (typeof customElements === "undefined") {
        return;
    }

    if (!customElements.get(TG_REACT_KANBAN)) {
        customElements.define(TG_REACT_KANBAN, TgReactKanbanElement);
    }

    if (!customElements.get(TG_REACT_BACKLOG)) {
        customElements.define(TG_REACT_BACKLOG, TgReactBacklogElement);
    }
}

// Side effect required by the load-order contract: merely importing this module
// (as `index.tsx` does via `import "./bootstrap"`) registers both Custom
// Elements before `app.js` runs `angular.bootstrap`. The guards inside
// `registerReactScreens` make this safe to evaluate more than once.
registerReactScreens();
