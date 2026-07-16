/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * React <-> AngularJS coexistence entry point.
 * =============================================
 *
 * This is the esbuild entry for the `react.js` bundle (Gulp `react` task emits
 * `dist/<version>/js/react.js`, a gitignored build artifact). It is the linchpin
 * of the AngularJS 1.5.10 -> React 18 coexistence migration for the Kanban board
 * and the Backlog / sprint-planning screens (Blitzy AAP 0.1-0.6).
 *
 * WHAT THIS FILE DOES (and nothing else)
 *   It imports the two Web Component wrapper classes and registers them as custom
 *   elements. That is the file's *entire* responsibility. It contains NO UI, NO
 *   React components, NO business logic, and NO `/api/v1/` calls — all rendering
 *   and behavior live in `./elements/*`, `./kanban/*`, `./backlog/*`, and
 *   `./shared/*`. The `customElements.define(...)` calls are TOP-LEVEL side
 *   effects that run the moment this module is evaluated.
 *
 * WHY REGISTRATION MUST RUN AT MODULE TOP LEVEL (verified — do NOT re-derive)
 *   `app-loader/app-loader.coffee` loads the bundles in this order, then boots
 *   AngularJS:
 *
 *       elements.js  ->  react.js (THIS bundle)  ->  app.js  ->  angular.bootstrap(document, ['taiga'])
 *
 *   The loader awaits each script's `onload` before loading the next, so by the
 *   time `app.js` runs and `angular.bootstrap` compiles the DOM, this module has
 *   already executed and both custom elements are defined. Registration therefore
 *   MUST be a synchronous side effect of script execution — it must NOT be
 *   deferred behind `DOMContentLoaded`, `setTimeout`, `requestAnimationFrame`, a
 *   dynamic `import()`, or any other callback. If it were deferred, AngularJS
 *   `$compile` could encounter `<tg-react-kanban>` / `<tg-react-backlog>` in the
 *   `kanban.jade` / `backlog.jade` route templates before they were defined.
 *
 *   Once a tag is defined, AngularJS treats it as an ordinary (already-upgraded)
 *   custom element and passes its internals through inertly — React owns
 *   everything inside the tag, AngularJS owns the navigation chrome and routing
 *   outside it. This is the exact, production-proven mechanism the repository
 *   already ships for its Angular-Elements bundle: `tg-main`, `tg-legacy`,
 *   `tg-navigation-bar`, and `tg-live-announcement` are embedded directly in the
 *   bootstrapped shell (`app/index.jade:35-64`). We re-apply that mechanism to a
 *   React bundle; we do NOT invent a new integration path.
 *
 * GLOBALS-ONLY COEXISTENCE BOUNDARY (hard constraint — AAP 0.4.2 / 0.7)
 *   The only imports permitted in this file are the two sibling `./elements/*`
 *   wrapper modules. This file must NOT import from `angular`, `app/coffee/**`,
 *   `app/modules/**`, or the compiled `elements.js`; and no AngularJS/CoffeeScript
 *   module imports React. All cross-framework interop happens elsewhere through
 *   process-wide globals (`window.taigaConfig`, `window.taiga.sessionId`,
 *   `localStorage 'token'`) and the shared `/api/v1/` REST + WebSocket endpoints,
 *   keeping the Django contract byte-identical and untouched.
 */

// The two custom-element wrapper classes. Each extends `HTMLElement` and manages
// a React root's mount/unmount lifecycle (`connectedCallback` /
// `disconnectedCallback`); neither self-registers — defining the tag is this
// entry point's job. Named imports match the exported convention in
// `./elements/TgReactKanban.ts` and `./elements/TgReactBacklog.ts`.
import { TgReactKanban } from './elements/TgReactKanban';
import { TgReactBacklog } from './elements/TgReactBacklog';

// Register the React-backed Web Components BEFORE `angular.bootstrap` runs (see
// the boot-order note above). Each `define` is guarded with `customElements.get`
// so re-evaluating this bundle (e.g. an accidental double-load, or a test that
// imports it more than once) is idempotent: a second `define()` of an
// already-registered name throws a `DOMException`, and the guard prevents that.
if (!customElements.get('tg-react-kanban')) {
  customElements.define('tg-react-kanban', TgReactKanban);
}

if (!customElements.get('tg-react-backlog')) {
  customElements.define('tg-react-backlog', TgReactBacklog);
}
