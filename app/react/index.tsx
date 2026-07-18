/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * index.tsx — the single esbuild entry point for the React 18 screens that run
 * in-place inside the AngularJS 1.5.10 shell (the incremental "Strangler"
 * migration of the Kanban and Backlog / Sprint-planning screens).
 *
 * WHAT THIS FILE IS
 *   A thin, side-effect-only module. It contains no business logic and no JSX
 *   of its own: it merely wires the two screen containers (`KanbanApp`,
 *   `BacklogApp`) to the shared Web-Components mount factory (`mountElement`)
 *   and registers the two Custom Elements that the migrated Jade partials host:
 *
 *       <tg-react-kanban>   ->  KanbanApp
 *       <tg-react-backlog>  ->  BacklogApp
 *
 * HOW IT IS LOADED
 *   The root `gulpfile.js` `react` task bundles EXACTLY this file with esbuild
 *   (`bundle: true`, `format: 'iife'`, `target: 'es2018'`, `jsx: 'automatic'`)
 *   into `dist/js/react.js`. `app-loader/app-loader.coffee` loads that bundle
 *   BEFORE `app.js` and `angular.bootstrap(document, ['taiga'])`, mirroring how
 *   the pre-existing Angular-2+ `elements.js` Web-Components bundle is loaded
 *   today. Because the bundle is an IIFE that runs before AngularJS boots, the
 *   top-level `customElements.define` calls below execute first — so the custom
 *   elements are already registered when the AngularJS router compiles the
 *   templates that host them, and the browser upgrades the elements immediately.
 *
 * RESPONSIBILITY BOUNDARY ("props down, events up")
 *   Attribute-to-prop bridging, `createRoot(...).render(...)` in
 *   `connectedCallback`, and `root.unmount()` in `disconnectedCallback` all live
 *   in `./shared/mount` (the only module in `app/react/**` permitted to import
 *   `react-dom/client`). This entry merely passes each container into
 *   `mountElement`; it never touches React directly, hence there is
 *   intentionally no `import React` here and no JSX (the toolchain uses the
 *   `jsx: "react-jsx"` automatic runtime, and this file emits none).
 */

import { mountElement } from './shared/mount';
import { KanbanApp } from './kanban/KanbanApp';
import { BacklogApp } from './backlog/BacklogApp';

/*
 * Register the two Custom Elements as a load-time side effect.
 *
 * The exact lower-kebab tag names below MUST match the tags the updated Jade
 * partials host (`app/partials/kanban/kanban.jade` -> `<tg-react-kanban>` and
 * `app/partials/backlog/backlog.jade` -> `<tg-react-backlog>`); they must not be
 * renamed, pluralized, or re-cased.
 *
 * Each registration is guarded with `customElements.get(...)` so this module is
 * idempotent and safe against double-evaluation (for example the bundle being
 * injected more than once, or a hot reload during development): calling
 * `customElements.define` twice for the same tag name throws a
 * `NotSupportedError`.
 *
 * The tag names are written as inline string literals (rather than shared
 * constants) so the compiled bundle always contains the verbatim
 * `customElements.define('tg-react-kanban', ...)` / `('tg-react-backlog', ...)`
 * call sites in both the minified (deploy) and non-minified (watch) esbuild
 * outputs.
 */
if (!customElements.get('tg-react-kanban')) {
    customElements.define('tg-react-kanban', mountElement(KanbanApp));
}

if (!customElements.get('tg-react-backlog')) {
    customElements.define('tg-react-backlog', mountElement(BacklogApp));
}
