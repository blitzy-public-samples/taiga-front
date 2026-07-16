/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * TgReactKanban
 * -------------
 * The React <-> AngularJS *coexistence boundary* for the Kanban board screen.
 * This custom-element class is the thin seam that lets a React 18 tree live
 * inside the AngularJS 1.5.10 host DOM without either framework knowing about
 * the other's internals (Blitzy AAP 0.1-0.6).
 *
 * WHAT IT DOES
 *   - `connectedCallback`  -> creates a React root over the host element and
 *                             renders <KanbanApp>.
 *   - `disconnectedCallback` -> unmounts that root (mandatory leak safety across
 *                             AngularJS `ng-view` route changes).
 * It contains NO business logic, NO `/api/v1/` calls, and NO drag-and-drop:
 * everything effectful lives inside `KanbanApp` and `../shared/*`. This wrapper
 * only resolves the project slug from the preserved route and manages the React
 * mount/unmount lifecycle.
 *
 * WHAT IT REPLACES
 *   It supersedes the ROUTE-LEVEL rendering of the AngularJS `KanbanController`
 *   (`app/coffee/modules/kanban/main.coffee:634`,
 *   `module.controller("KanbanController", KanbanController)`). The template
 *   `app/partials/kanban/kanban.jade` hosts `<tg-react-kanban>` instead of the
 *   legacy controller markup (that swap is another agent's change). The AngularJS
 *   `taigaKanban` module registration is intentionally RETAINED — the out-of-scope
 *   taskboard screen registers services onto it — and is never referenced here.
 *
 * HOW IT IS REGISTERED (verified — do NOT re-derive)
 *   The entry point `app/react/index.tsx` performs a NAMED import of this class
 *   (`import { TgReactKanban } from './elements/TgReactKanban';`) and registers
 *   the tag via `customElements.define('tg-react-kanban', TgReactKanban)`. That
 *   registration ships inside the `react.js` bundle, which
 *   `app-loader/app-loader.coffee` loads BETWEEN `elements.js` and `app.js` —
 *   i.e. BEFORE `angular.bootstrap(document, ['taiga'])`. Because the element is
 *   already defined when AngularJS `$compile` first encounters
 *   `<tg-react-kanban>` (in the `kanban.jade` route template), AngularJS treats
 *   it as an ordinary custom element and passes its internals through inertly —
 *   React owns everything inside the tag; AngularJS owns the chrome/routing
 *   outside it. This is the exact mechanism the repository already ships for its
 *   Angular-Elements bundle (`tg-main` / `tg-navigation-bar` /
 *   `tg-live-announcement` embedded in `app/index.jade:35-66`), and it mirrors
 *   the sibling wrapper `TgReactBacklog.ts`.
 *
 * NOTE: This class is the ONLY owner of `react-dom/client` mounting for the
 * Kanban screen. `KanbanApp` itself does not import `react-dom` — mounting is
 * exclusively this wrapper's responsibility.
 */

// Globals-only coexistence boundary (AAP 0.7): the ONLY permitted imports are
// `react`, `react-dom/client`, and the sibling feature module `KanbanApp`.
// Nothing from `angular`, `app/coffee/**`, `app/modules/**`, `app/partials/**`,
// `app/styles/**`, `elements.js`, or `../shared/*` may be imported here.
//
// This is a `.ts` file (NOT `.tsx`): JSX is not valid in `.ts`, so React trees
// are constructed with `createElement` rather than JSX syntax. `createElement`
// is imported explicitly for that reason.
import { createElement } from 'react';
// `createRoot` is the React 18 client entry that mounts a concurrent root over a
// DOM node; `Root` is its return type, stored on the instance so the exact root
// created on connect is the one unmounted on disconnect. The inline `type`
// modifier keeps `Root` type-only under the project's `isolatedModules` setting.
import { createRoot, type Root } from 'react-dom/client';
// The React feature component this wrapper mounts. `KanbanApp` is a NAMED export
// of `../kanban/KanbanApp` (it also ships a default). It receives the project
// slug and internally consumes the shared session/config/API adapters.
import { KanbanApp } from '../kanban/KanbanApp';

/**
 * Resolve the current project slug from the URL.
 *
 * The AngularJS controller reads `@params.pslug`
 * (`app/coffee/modules/kanban/main.coffee:88`, via `$routeParams`), but this
 * React wrapper is framework-agnostic and must not depend on AngularJS DI.
 * AngularJS runs in HTML5-mode routing
 * (`app/coffee/app.coffee:588`, `html5Mode({enabled: true, requireBase: true})`),
 * so the live path is in `window.location.pathname`, shaped
 * `/project/:pslug/kanban` (`app/coffee/app.coffee:235`).
 *
 * The lookup is robust to an optional `<base href>` prefix: rather than assuming
 * a fixed segment position, it locates the `"project"` path segment and returns
 * the segment immediately after it. Returns an empty string when the slug cannot
 * be determined (e.g. the element is mounted outside a project route); the
 * downstream `KanbanApp`/`useKanbanBoard` layer decides how to handle an empty
 * slug.
 */
function getProjectSlug(): string {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const projectIdx = segments.indexOf('project');
  if (projectIdx !== -1 && projectIdx + 1 < segments.length) {
    return segments[projectIdx + 1];
  }
  return '';
}

/**
 * Custom-element wrapper that bridges the AngularJS host DOM and the React
 * Kanban screen. Registered as `<tg-react-kanban>` by `app/react/index.tsx`
 * (this class never calls `customElements.define` itself).
 */
export class TgReactKanban extends HTMLElement {
  /**
   * The React root created over this element. Retained on the instance so that
   * `disconnectedCallback` unmounts the exact root that `connectedCallback`
   * created. `null` while the element is not mounted.
   */
  private root: Root | null = null;

  /**
   * Invoked by the browser when the element is attached to the document — which,
   * for `<tg-react-kanban>`, happens when AngularJS enters the
   * `/project/:pslug/kanban` route and `ng-view` inserts `kanban.jade`.
   *
   * Creates a React root over the host element and renders <KanbanApp>, passing
   * only the resolved project slug. The slug prefers an explicit `project-slug`
   * host attribute (an optional override for embedding/testing) and otherwise
   * falls back to parsing the URL — the reliable, spec-mandated source.
   */
  connectedCallback(): void {
    // Guard against a duplicate connect without an intervening disconnect (e.g.
    // if the element is moved within the DOM). Re-creating a root over a node
    // that already has one would orphan the previous React tree.
    if (this.root) {
      return;
    }

    const projectSlug = this.getAttribute('project-slug') ?? getProjectSlug();

    this.root = createRoot(this);
    // `.ts` file: JSX is not valid here, so the element is built with
    // `createElement`. Equivalent to `<KanbanApp projectSlug={projectSlug} />`
    // in a `.tsx` file. Only `{ projectSlug }` is supplied; the optional
    // `projectId` is resolved internally by `KanbanApp`/`useKanbanBoard`.
    this.root.render(createElement(KanbanApp, { projectSlug }));
  }

  /**
   * Invoked by the browser when the element is detached from the document —
   * which, for `<tg-react-kanban>`, happens when AngularJS leaves the kanban
   * route and `ng-view` removes the template.
   *
   * Unmounts the React tree to release its resources and event listeners,
   * preventing leaks across AngularJS route changes. Because this callback fires
   * from browser/AngularJS DOM removal — outside React's own render cycle —
   * calling `root.unmount()` synchronously is safe and is the mandated behavior.
   * (If a "synchronously unmount a root while rendering" warning ever appeared,
   * the fix would be to capture the root locally, null `this.root`, then
   * `queueMicrotask(() => localRoot.unmount())`; that deferral is deliberately
   * NOT added pre-emptively.)
   */
  disconnectedCallback(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}

// Default export in addition to the required named export. `index.tsx` consumes
// the NAMED export (`import { TgReactKanban }`); the default is provided for
// symmetry with the sibling `TgReactBacklog.ts` and for flexible consumption.
export default TgReactKanban;
