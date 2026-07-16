/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit spec for the TgReactKanban custom-element wrapper.
 *
 * Verifies the AngularJS <-> React coexistence bridge:
 *  - connectedCallback mounts <KanbanApp> (React root created over the host element)
 *  - the project slug is resolved from the `project-slug` attribute, falling back
 *    to parsing window.location.pathname (/project/:pslug/kanban, app.coffee:235)
 *  - disconnectedCallback unmounts the React tree (leak safety across ng-view routes)
 *
 * Browserless: jest-environment-jsdom via `npm test`. No Playwright, no browser,
 * no network — KanbanApp is mocked at the module boundary. Behavioral origin of
 * the mounted screen: KanbanController [kanban/main.coffee:634] (reference only;
 * this spec tests the React wrapper, never the CoffeeScript).
 *
 * This spec is the direct mirror of TgReactBacklog.test.tsx (same structure; only
 * the feature app, tag, route and test-id differ). Together the two wrapper specs
 * exercise every line/branch of the tiny wrappers so the app/react/** source stays
 * above the mandated >=70% global line-coverage gate (AAP 0.2.1 / 0.7.1).
 */

import { act, waitFor } from '@testing-library/react';

// Mock the feature app at the module boundary. This specifier resolves to the SAME
// module (app/react/kanban/KanbanApp) that TgReactKanban imports via
// '../kanban/KanbanApp', so the wrapper renders this lightweight marker instead of
// the real (heavy) screen — none of KanbanApp's deps (hooks, reducers, shared/api,
// @dnd-kit) load or run. The marker echoes the resolved projectSlug into a data
// attribute for assertion, and exports BOTH the named `KanbanApp` and a `default`
// so it intercepts regardless of which specifier the wrapper uses.
jest.mock('../../kanban/KanbanApp', () => {
  const KanbanAppMock = ({ projectSlug }: { projectSlug: string }) => (
    <div data-testid="kanban-app" data-slug={projectSlug} />
  );
  return { __esModule: true, KanbanApp: KanbanAppMock, default: KanbanAppMock };
});

import { TgReactKanban } from '../TgReactKanban';

const TAG = 'tg-react-kanban';

// jsdom provides a fresh CustomElementRegistry per test file; the tag is normally
// registered by index.tsx (not by the wrapper), so THIS spec registers it. The
// guard covers in-file re-runs (e.g. jest --watch) and avoids "already defined".
if (!customElements.get(TAG)) {
  customElements.define(TAG, TgReactKanban);
}

describe('TgReactKanban custom element', () => {
  let el: TgReactKanban;

  beforeEach(() => {
    jest.clearAllMocks();
    // Deterministic default location with no `project` segment => slug resolves to ''.
    window.history.pushState({}, '', '/');
    el = document.createElement(TAG) as TgReactKanban;
  });

  afterEach(() => {
    // Trigger disconnectedCallback so no React root leaks between tests.
    if (el.isConnected) {
      act(() => {
        el.remove();
      });
    }
    window.history.pushState({}, '', '/');
  });

  it('mounts KanbanApp into the host element on connect', async () => {
    el.setAttribute('project-slug', 'test-slug');

    act(() => {
      document.body.appendChild(el);
    });

    await waitFor(() => {
      expect(el.querySelector('[data-testid="kanban-app"]')).not.toBeNull();
    });
  });

  it('passes the project-slug attribute value to KanbanApp', async () => {
    el.setAttribute('project-slug', 'test-slug');

    act(() => {
      document.body.appendChild(el);
    });

    let mounted: Element | null = null;
    await waitFor(() => {
      mounted = el.querySelector('[data-testid="kanban-app"]');
      expect(mounted).not.toBeNull();
    });
    expect(mounted).toHaveAttribute('data-slug', 'test-slug');
  });

  it('falls back to parsing the URL when no attribute is set', async () => {
    window.history.pushState({}, '', '/project/foo/kanban');

    act(() => {
      document.body.appendChild(el);
    });

    let mounted: Element | null = null;
    await waitFor(() => {
      mounted = el.querySelector('[data-testid="kanban-app"]');
      expect(mounted).not.toBeNull();
    });
    expect(mounted).toHaveAttribute('data-slug', 'foo');
  });

  it('resolves an empty slug when the URL has no project segment', async () => {
    window.history.pushState({}, '', '/something/else');

    act(() => {
      document.body.appendChild(el);
    });

    let mounted: Element | null = null;
    await waitFor(() => {
      mounted = el.querySelector('[data-testid="kanban-app"]');
      expect(mounted).not.toBeNull();
    });
    // React renders empty-string data-* attributes, so the attribute exists and equals ''.
    expect((mounted as unknown as HTMLElement).getAttribute('data-slug')).toBe('');
  });

  it('does not remount when connectedCallback fires again while already connected', async () => {
    act(() => {
      document.body.appendChild(el);
    });
    await waitFor(() => {
      expect(el.querySelectorAll('[data-testid="kanban-app"]').length).toBe(1);
    });

    // Invoke the lifecycle callback directly; the internal `if (this.root) return;`
    // guard must prevent a second React root / duplicate mount.
    act(() => {
      el.connectedCallback();
    });

    expect(el.querySelectorAll('[data-testid="kanban-app"]').length).toBe(1);
  });

  it('unmounts the React tree on disconnect', async () => {
    act(() => {
      document.body.appendChild(el);
    });
    await waitFor(() => {
      expect(el.querySelector('[data-testid="kanban-app"]')).not.toBeNull();
    });

    act(() => {
      el.remove();
    });

    // `el` is now detached from document.body; assert directly on it. An emptied
    // container proves React actually unmounted (root.unmount() clears it
    // synchronously in act()).
    expect(el.querySelector('[data-testid="kanban-app"]')).toBeNull();
    expect(el.childNodes.length).toBe(0);
  });
});
