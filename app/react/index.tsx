/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * React migration bundle **ENTRY POINT** — custom-element registration.
 *
 * This is the single `esbuild` entry point for the entire React migration
 * (`gulpfile.js` sets `entryPoints = ["app/react/index.tsx"]` and emits
 * `dist/<version>/js/react-app.js`). Every module under `app/react/**` is
 * reachable only through the import graph rooted here — do NOT rename, move, or
 * add a second entry point.
 *
 * Its ONE job is to register the two Web Components — `tg-react-kanban` and
 * `tg-react-backlog` — on `window.customElements` as a **top-level side effect
 * at module load**. `app-loader/app-loader.coffee` loads the compiled bundle in
 * the chain
 *
 *     elements.js → react-app.js → app.js → angular.bootstrap(document, ['taiga'])
 *
 * so evaluating this module (a plain `<script>`) defines the custom elements
 * BEFORE AngularJS bootstraps and compiles the Jade shells that contain
 * `<tg-react-kanban>` / `<tg-react-backlog>`. `customElements.define` upgrades
 * any already-parsed and any future instances automatically, so registration
 * before the elements appear in the DOM is exactly what we want. This mirrors
 * the repository's existing `elements.js` (Angular Elements) coexistence
 * precedent, which likewise calls `customElements.define(...)` before
 * `angular.bootstrap`.
 *
 * This module intentionally stays tiny, side-effecting, and framework-agnostic:
 * it only wires each tag name to its React root via the generic `defineElement`
 * host factory. It NEVER reads host attributes (that is `defineElement`'s job),
 * NEVER touches AngularJS, and NEVER mints a session, reads config, imports CSS,
 * or performs any network call (those concerns live in `shared/**` and the App
 * roots). It authors no JSX, so it deliberately does not `import React`.
 */

import { defineElement } from "./host/defineElement";
import { KanbanApp } from "./kanban/KanbanApp";
import { BacklogApp } from "./backlog/BacklogApp";

/**
 * The exact custom-element tag names hosted by the migrated Jade shells.
 *
 * These are a hard contract with the AngularJS side:
 *   - `tg-react-kanban`  is emitted by `app/partials/kanban/kanban.jade`  and
 *      mounts {@link KanbanApp}.
 *   - `tg-react-backlog` is emitted by `app/partials/backlog/backlog.jade` and
 *      mounts {@link BacklogApp}.
 *
 * Both are valid (hyphenated) custom-element names. A typo here breaks mounting
 * silently — the browser would simply never upgrade the unknown tag — so the
 * literals are declared once, in this single source of truth, and reused below.
 */
const KANBAN_TAG = "tg-react-kanban";
const BACKLOG_TAG = "tg-react-backlog";

/**
 * Register one custom element, guarding against the two ways
 * `customElements.define` can fail or be pointless:
 *
 *  1. **No registry available.** In a non-browser context (e.g. Jest under a
 *     non-DOM environment, SSR, or a worker without `customElements`) there is
 *     nothing to register against; no-op instead of throwing. jsdom DOES provide
 *     `customElements`, so this guard is cheap insurance that also documents
 *     intent and keeps this entry importable from unit tests.
 *  2. **Already defined.** `customElements.define` throws `NotSupportedError` if
 *     a tag name is registered twice, which would happen if the bundle were ever
 *     evaluated more than once. A `get(tagName)` check makes registration
 *     idempotent.
 *
 * The `component` parameter is typed as `Parameters<typeof defineElement>[0]`
 * (i.e. the exact `ComponentType<HostElementProps>` that `defineElement`
 * accepts) so this file never has to import the host's prop types directly and
 * cannot drift from the factory's contract.
 *
 * @param tagName   The custom-element tag to define (must contain a hyphen).
 * @param component The React root to mount inside the element's host.
 */
const registerElement = (
    tagName: string,
    component: Parameters<typeof defineElement>[0],
): void => {
    if (typeof window === "undefined" || !window.customElements) {
        // No custom-element registry in this context — nothing to do.
        return;
    }

    if (window.customElements.get(tagName)) {
        // Already registered (e.g. the bundle was evaluated twice) — do nothing
        // rather than let customElements.define throw NotSupportedError.
        return;
    }

    window.customElements.define(tagName, defineElement(component));
};

// ---------------------------------------------------------------------------
// The side effect: register both elements at module load. These MUST run at
// import time (not inside an exported function) because the loader evaluates
// react-app.js as a plain <script>, and that evaluation is the registration
// trigger — guaranteed to complete before app.js and angular.bootstrap run.
// ---------------------------------------------------------------------------
registerElement(KANBAN_TAG, KanbanApp);
registerElement(BACKLOG_TAG, BacklogApp);
