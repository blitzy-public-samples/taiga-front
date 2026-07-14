/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `index.tsx` — the esbuild bundle ENTRY POINT for the React 18.2 migration
 * screens (Technical Specification AAP §0.3.1, §0.4.1, §0.6.1).
 *
 * The Gulp `react-screens` task (`gulpfile.js`) bundles this module — and its
 * import closure — with esbuild into a single browser IIFE at
 * `dist/<version>/js/react-screens.js`. `app-loader/app-loader.coffee` then
 * loads that bundle in the order `elements.js` -> `react-screens.js` -> `app.js`,
 * i.e. BEFORE `angular.bootstrap(document, ["taiga"])` runs.
 *
 * LOAD-ORDER CONTRACT (why this entry is a bare side-effect import):
 *   The ONLY responsibility of this entry is to guarantee that, by the time the
 *   AngularJS shell routes to `/kanban` or `/backlog`, the two Custom Elements
 *   (`<tg-react-kanban>` / `<tg-react-backlog>`) hosted by those route templates
 *   (`app/partials/kanban/kanban.jade`, `app/partials/backlog/backlog.jade`) are
 *   already registered with the browser. `./bootstrap` performs that registration
 *   as a side effect of being evaluated (its bottom-of-file
 *   `registerReactScreens()` call). Importing it here — and nothing else at module
 *   top level — makes the registration run exactly once when the IIFE executes,
 *   before `app.js`.
 *
 * WHERE THE REACT ROOTS ARE MOUNTED:
 *   This entry deliberately does NOT call `createRoot` itself. Per the Web
 *   Component Adapter pattern (AAP §0.3.3), each screen's React root is created
 *   LAZILY inside the corresponding Custom Element's `connectedCallback` (in
 *   `./bootstrap`), which resolves the live session/project/auth context at the
 *   moment the element connects (after `angular.bootstrap`) and torn down in
 *   `disconnectedCallback` on AngularJS route changes. Resolving context here, at
 *   module-evaluation time (before `app.js`), would read undefined globals — see
 *   the LAZY-CONTEXT CONTRACT in `./bootstrap`.
 *
 * ISOLATION:
 *   Like `./bootstrap`, this entry imports nothing from `app/coffee/**` /
 *   `app/modules/**` and touches no AngularJS internals; the React screens couple
 *   to the backend only through the frozen `/api/v1` REST + WebSocket contract via
 *   `./shared/api` and `./shared/ws` (constraint C-1).
 */

// Side-effect import: evaluating `./bootstrap` registers `<tg-react-kanban>` and
// `<tg-react-backlog>` via `customElements.define(...)`. This MUST be the entry's
// effect so both tags are defined before AngularJS bootstraps and routes to the
// templates that contain them (load-order contract above).
import "./bootstrap";

// M24 hashbang -> HTML5 compatibility bridge: normalize an inbound
// `#!/project/<slug>/{kanban,backlog}` checkpoint/bookmark URL to its
// authoritative HTML5 pathname BEFORE AngularJS bootstraps (this bundle is
// loaded ahead of `app.js` by app-loader.coffee), so the routed template that
// hosts the `<tg-react-*>` Custom Element actually renders and the React
// screen mounts. Changes no frozen Angular route; only unambiguous `#!` route
// hashbangs are touched (AAP §0.6.1).
import { applyHashbangCompatibility } from "./shared/nav/hashbangBridge";

// M5 runtime i18n bridge: resolve the deployment's active language (from
// `localStorage.userInfo.lang` / `window.taigaConfig.defaultLanguage`, both
// already populated by the app-loader BEFORE this bundle evaluates) and load its
// message bundle into the shared resolver, then watch `<html lang>` for live
// language switches. Starting it here (module-evaluation, before `app.js`) is
// safe because — unlike `window.taiga.sessionId`, which `app.js` sets later —
// `taigaConfig` and `localStorage` are available at this point. Idempotent.
import { startLocaleBridge } from "./shared/i18n/localeBridge";

// Run the hashbang compatibility rewrite FIRST so any inbound `#!` route is
// already an HTML5 path before the rest of the bundle (and, shortly after,
// AngularJS) reads `window.location`.
applyHashbangCompatibility();

startLocaleBridge();
