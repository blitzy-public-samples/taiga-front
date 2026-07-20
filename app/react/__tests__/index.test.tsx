/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * index.test.tsx
 * --------------
 * Browserless Jest + React Testing Library unit spec for the coexistence ENTRY
 * POINT `app/react/index.tsx` — the esbuild entry that compiles to the
 * `react.js` bundle and whose SOLE responsibility is to register the two
 * React-backed Web Components as custom elements:
 *
 *     customElements.define('tg-react-kanban',  TgReactKanban);
 *     customElements.define('tg-react-backlog', TgReactBacklog);
 *
 * WHY THIS SPEC EXISTS (QA finding F-COV-1 / mutation-escape M2)
 * -------------------------------------------------------------
 * Before this spec, `index.tsx` (the `customElements.define(...)` glue) had ZERO
 * test coverage, so a mutation that renamed a registered tag (e.g.
 * `'tg-react-kanban'` -> `'tg-react-BROKEN'`) survived the entire suite: the
 * `kanban.jade` / `backlog.jade` route templates host `<tg-react-kanban>` /
 * `<tg-react-backlog>`, so a wrong registration name would silently leave those
 * hosts un-upgraded at runtime (AngularJS would pass an inert unknown element
 * through `$compile` and NOTHING would mount) — yet every unit test still passed.
 * This spec closes that escape by asserting, against jsdom's
 * `CustomElementRegistry`, that EACH tag string resolves to EXACTLY its wrapper
 * class. Rename either tag and `customElements.get(<original-tag>)` returns
 * `undefined`, so these assertions fail — the mutation can no longer escape.
 *
 * WHAT IT PROVES
 *   1. Importing the entry point runs its TOP-LEVEL registration side effects
 *      (registration must be synchronous on module evaluation so both elements
 *      are defined before `angular.bootstrap` compiles the DOM — see the
 *      boot-order note in `index.tsx`; it must NOT be deferred behind a callback).
 *   2. `'tg-react-kanban'`  is registered against the real `TgReactKanban` class.
 *   3. `'tg-react-backlog'` is registered against the real `TgReactBacklog` class.
 *   4. A registered element actually MOUNTS its feature app on connect (the
 *      registration is wired to a working wrapper, not a stray class), and the
 *      resolved `project-slug` reaches the mounted app.
 *   5. Re-evaluating the bundle is IDEMPOTENT: the `if (!customElements.get(...))`
 *      guards make a second evaluation a no-op instead of throwing the
 *      `DOMException` a duplicate `define()` would raise (covers the guard's
 *      already-registered branch).
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7 — HARD RULES): browserless. Jest + jsdom +
 * React Testing Library ONLY — NO Playwright, NO real browser, NO network. The
 * two FEATURE APPS (`../kanban/KanbanApp`, `../backlog/BacklogApp`) are mocked at
 * the module boundary so importing the entry point does not pull the heavy
 * screens (hooks, reducers, `shared/api`, `@dnd-kit`); the entry point and both
 * real wrapper classes run for real. Contributes to the mandated >=70% global
 * line-coverage gate over `app/react/**` (AAP 0.2.1 / 0.7.1) by covering the
 * previously-uncovered `index.tsx`.
 *
 * MOCK STYLE: the `jest.mock` factories use `require('react')` + `createElement`
 * (never JSX) to avoid Jest's out-of-scope-variable restriction on the injected
 * automatic-JSX runtime binding inside a hoisted factory — matching the
 * established pattern in `KanbanApp.test.tsx` / `BacklogApp.test.tsx`.
 */

import { act, waitFor } from '@testing-library/react';

/* ------------------------------------------------------------------ *
 * Module mocks (hoisted by ts-jest above the imports)
 * ------------------------------------------------------------------ */

// KanbanApp stub. The specifier is RELATIVE TO THIS FILE (app/react/__tests__/),
// so '../kanban/KanbanApp' resolves to the SAME absolute module that
// `../elements/TgReactKanban` imports via '../kanban/KanbanApp' — that import-path
// parity is what guarantees interception. The marker echoes `projectSlug` into a
// data attribute for assertion and exports BOTH the named `KanbanApp` and a
// `default` so it intercepts regardless of the import form the wrapper uses.
jest.mock('../kanban/KanbanApp', () => {
  const react = require('react');
  const KanbanAppMock = (props: { projectSlug: string }) =>
    react.createElement('div', {
      'data-testid': 'kanban-app',
      'data-slug': props.projectSlug,
    });
  return { __esModule: true, KanbanApp: KanbanAppMock, default: KanbanAppMock };
});

// BacklogApp stub — direct mirror of the KanbanApp stub; only the tag, test-id
// and feature app differ. '../backlog/BacklogApp' resolves to the SAME module
// that `../elements/TgReactBacklog` imports.
jest.mock('../backlog/BacklogApp', () => {
  const react = require('react');
  const BacklogAppMock = (props: { projectSlug: string }) =>
    react.createElement('div', {
      'data-testid': 'backlog-app',
      'data-slug': props.projectSlug,
    });
  return { __esModule: true, BacklogApp: BacklogAppMock, default: BacklogAppMock };
});

// The REAL wrapper classes. These are the exact constructors `index.tsx`
// registers; the registry-identity assertions compare against them (this is the
// M2-killing check). Imported AFTER the mocks (ts-jest hoists the `jest.mock`
// calls above all imports) so the wrappers see the mocked feature apps.
import { TgReactKanban } from '../elements/TgReactKanban';
import { TgReactBacklog } from '../elements/TgReactBacklog';

// Importing the entry point EXECUTES its top-level `customElements.define(...)`
// side effects — this is the behavior under test. (A single import per file is
// enough; jsdom's registry is shared for the whole file. The idempotency test
// below re-requires it deliberately.)
import '../index';

const KANBAN_TAG = 'tg-react-kanban';
const BACKLOG_TAG = 'tg-react-backlog';

describe('app/react/index.tsx — custom-element registration entry point', () => {
  afterEach(() => {
    // Reset the URL so any wrapper slug-fallback path is deterministic and no
    // state leaks between tests.
    window.history.pushState({}, '', '/');
  });

  it('registers <tg-react-kanban> against the TgReactKanban wrapper class', () => {
    // Kills mutation M2: rename the tag in index.tsx and get() returns undefined.
    expect(customElements.get(KANBAN_TAG)).toBe(TgReactKanban);
  });

  it('registers <tg-react-backlog> against the TgReactBacklog wrapper class', () => {
    expect(customElements.get(BACKLOG_TAG)).toBe(TgReactBacklog);
  });

  it('mounts KanbanApp when a registered <tg-react-kanban> connects', async () => {
    const el = document.createElement(KANBAN_TAG);
    el.setAttribute('project-slug', 'proj-k');

    act(() => {
      document.body.appendChild(el);
    });

    let mounted: Element | null = null;
    await waitFor(() => {
      mounted = el.querySelector('[data-testid="kanban-app"]');
      expect(mounted).not.toBeNull();
    });
    // The resolved slug reaches the mounted app => the registered class is a
    // working wrapper, not a stray constructor.
    expect(mounted).toHaveAttribute('data-slug', 'proj-k');

    act(() => {
      el.remove(); // disconnectedCallback unmounts the React root (leak safety).
    });
  });

  it('mounts BacklogApp when a registered <tg-react-backlog> connects', async () => {
    const el = document.createElement(BACKLOG_TAG);
    el.setAttribute('project-slug', 'proj-b');

    act(() => {
      document.body.appendChild(el);
    });

    let mounted: Element | null = null;
    await waitFor(() => {
      mounted = el.querySelector('[data-testid="backlog-app"]');
      expect(mounted).not.toBeNull();
    });
    expect(mounted).toHaveAttribute('data-slug', 'proj-b');

    act(() => {
      el.remove();
    });
  });

  it('is idempotent on re-evaluation (guarded define does not throw)', () => {
    // jsdom's CustomElementRegistry is per-environment and is NOT cleared by
    // jest.resetModules(); only the JS module cache is. So re-requiring the entry
    // point re-runs its top-level code, whose `if (!customElements.get(tag))`
    // guards now see the ALREADY-registered tags and SKIP the second define()
    // (a duplicate define() would otherwise throw a DOMException). This exercises
    // the guard's already-registered branch and proves accidental double-loads
    // are safe.
    jest.resetModules();
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      require('../index');
    }).not.toThrow();

    // The tags remain bound to the ORIGINAL wrapper classes (registration was not
    // overwritten by the second evaluation).
    expect(customElements.get(KANBAN_TAG)).toBe(TgReactKanban);
    expect(customElements.get(BACKLOG_TAG)).toBe(TgReactBacklog);
  });
});
