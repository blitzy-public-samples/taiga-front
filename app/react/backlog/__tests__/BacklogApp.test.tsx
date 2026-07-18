/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Backlog CONTAINER component `BacklogApp`
 * (`../BacklogApp`).
 *
 * WHAT IS UNDER TEST
 *   `BacklogApp` is the top-level React component mounted by the custom element
 *   `<tg-react-backlog>` (via `../shared/mount.tsx`). It is the React
 *   re-expression of the AngularJS `BacklogController`
 *   (`app/coffee/modules/backlog/main.coffee`, class L25 / registered L715). As
 *   a CONTAINER it owns: props ingestion (`project-id` / `project-slug`
 *   attributes arrive as camelCase STRING props), the `useBacklog` state hook,
 *   the coordinating callbacks, lightbox open/close state, and the composition
 *   of the `BacklogDndContext` + the presentational children (`BacklogTable`,
 *   `Sprint`, `CreateEditSprintLightbox`, `BulkCreateUsLightbox`).
 *
 *   This spec deliberately ISOLATES the container's orchestration wiring —
 *   `projectId` coercion, the render guards, and child composition — by MOCKING
 *   the hook, the DnD context and every child component. The children's own
 *   behaviour is exercised by their dedicated specs in this folder
 *   (`BacklogTable.test.tsx`, `Sprint.test.tsx`, `CreateEditSprintLightbox.test.tsx`,
 *   `BulkCreateUsLightbox.test.tsx`); here they are inert stubs, so no real
 *   `@dnd-kit`, no real `/api/v1/` client and no WebSocket bridge is ever loaded.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../BacklogApp.tsx`) was opened FIRST and this spec
 *   asserts ITS contract exactly (the component is NOT modified):
 *     - Props are `{ projectId: string; projectSlug?: string; [k: string]:
 *       string | undefined }`; the container coerces `projectId` with
 *       `Number(props.projectId)` and passes the NUMBER to `useBacklog`
 *       UNCONDITIONALLY (Rules of Hooks), so a "7" attribute yields
 *       `useBacklog(7)`.
 *     - There are THREE render branches, in order: (1) an inert host
 *       `<div class="wrapper" data-tg-react-backlog="invalid-project">` when the
 *       `project-id` attribute is not a finite number; (2) an empty state whose
 *       `<p class="title">` reads "The backlog is not activated for this project."
 *       when the STATE field `isBacklogActivated` is false AND the project has
 *       loaded (`project && !isBacklogActivated`, BacklogApp.tsx L565 — note it
 *       reads the reducer-derived STATE flag, which mirrors the source
 *       `loadProject`/`main.coffee:472` `is_backlog_activated` gate); and
 *       (3) otherwise the full board, where `BacklogDndContext` (gated on a
 *       loaded `project`) wraps `BacklogTable`, the open/closed `Sprint`s render,
 *       and both lightboxes mount (each toggled by an `open` prop).
 *     - The authored container has NO dedicated `loading` affordance (it never
 *       reads `state.loading`). Before the project has loaded (`project === null`)
 *       it simply gates the board/DnD/sprints/bulk-lightbox off; the
 *       always-mounted `CreateEditSprintLightbox` still renders. The "loading"
 *       scenario from the file summary is therefore expressed here as that
 *       authored `project === null` gating — no loading UI is invented.
 *     - The row/DnD callbacks handed to the children are container-local
 *       `useCallback` wrappers (NOT the raw hook actions): e.g. `onDeleteUs`
 *       delegates to `actions.removeUsOptimistic(us.id)` and `onMoveUsToTop` to
 *       `actions.moveUsToTopOfBacklog(us)`. The wiring test therefore invokes the
 *       captured child prop and asserts the delegated action fired.
 *
 * CONVENTIONS (enforced for this folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime, including inside the `jest.mock` factories below.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`) are registered
 *     globally by the Jest `setupFilesAfterEnv` entry and are NOT imported here.
 *   - `useBacklog` is auto-mocked; the DnD context and the four child components
 *     are replaced with lightweight pass-through / leaf stubs that expose a
 *     `data-testid` and capture their props, so composition and prop wiring can
 *     be asserted without importing the real children.
 */

import { render, screen, within } from '@testing-library/react';

import { BacklogApp } from '../BacklogApp';
import { useBacklog } from '../state/useBacklog';
import { makeProject, makeUserStory, makeUserStories, makeMilestone } from './factories';

import type { BacklogState } from '../state/backlogReducer';

/* ========================================================================== *
 * Captured child props
 *
 * A single module-scoped record the stub components write their received props
 * into on every render. Its name is prefixed with `mock` so the ts-jest module
 * hoister permits the `jest.mock` factories below to reference it (the factories
 * only READ nothing at definition time — they merely assign into it at render
 * time — so there is no temporal-dead-zone hazard). Reset in `beforeEach`.
 * ========================================================================== */

const mockCaptured: {
  dnd: any;
  backlogTable: any;
  createEditSprintLightbox: any;
  bulkCreateUsLightbox: any;
  sprint: any[];
} = {
  dnd: null,
  backlogTable: null,
  createEditSprintLightbox: null,
  bulkCreateUsLightbox: null,
  sprint: [],
};

/* ========================================================================== *
 * Module mocks (hoisted above the imports by ts-jest)
 *
 * - `useBacklog` is AUTO-mocked: its single export becomes a `jest.fn()` whose
 *   `{ state, actions }` return is configured per test in `beforeEach`. The real
 *   hook (and therefore its `@dnd-kit`-free shared api / session / events
 *   imports) still loads for introspection but never RUNS, so no network,
 *   WebSocket or timer is ever engaged.
 * - `BacklogDndContext` is a PASS-THROUGH stub: it renders its children so the
 *   wrapped `BacklogTable` stays in the tree, and records its props. No real
 *   `@dnd-kit` sensor is required.
 * - Each presentational child is a LEAF stub exposing a stable `data-testid`
 *   and recording its props. This keeps the spec a true container/unit test.
 * ========================================================================== */

jest.mock('../state/useBacklog');

jest.mock('../dnd/BacklogDndContext', () => ({
  __esModule: true,
  BacklogDndContext: (props: any) => {
    mockCaptured.dnd = props;
    return <div data-testid="dnd-context">{props.children}</div>;
  },
}));

jest.mock('../components/BacklogTable', () => ({
  __esModule: true,
  BacklogTable: (props: any) => {
    mockCaptured.backlogTable = props;
    return <div data-testid="backlog-table" />;
  },
}));

jest.mock('../components/Sprint', () => ({
  __esModule: true,
  Sprint: (props: any) => {
    mockCaptured.sprint.push(props);
    return <div data-testid="sprint" />;
  },
}));

jest.mock('../components/CreateEditSprintLightbox', () => ({
  __esModule: true,
  CreateEditSprintLightbox: (props: any) => {
    mockCaptured.createEditSprintLightbox = props;
    return (
      <div
        data-testid="create-edit-sprint-lightbox"
        data-open={String(Boolean(props.open))}
        data-mode={String(props.mode)}
      />
    );
  },
}));

jest.mock('../components/BulkCreateUsLightbox', () => ({
  __esModule: true,
  BulkCreateUsLightbox: (props: any) => {
    mockCaptured.bulkCreateUsLightbox = props;
    return (
      <div
        data-testid="bulk-create-us-lightbox"
        data-open={String(Boolean(props.open))}
      />
    );
  },
}));

/**
 * Strongly-typed handle onto the auto-mocked hook. `jest.MockedFunction`
 * preserves the original signature so `.mockReturnValue(...)` and the
 * `toHaveBeenCalledWith(...)` assertions remain type-checked.
 */
const mockUseBacklog = useBacklog as jest.MockedFunction<typeof useBacklog>;

/* ========================================================================== *
 * State + actions builders
 * ========================================================================== */

/**
 * Build a complete {@link BacklogState}, defaulting every field to the reducer's
 * documented `initialBacklogState` values, then applying `overrides`. The
 * `: BacklogState` return annotation makes TypeScript enforce field
 * completeness, so any drift in the reducer's state shape surfaces as a `tsc`
 * error here rather than a silent runtime gap. `firstUsInBacklog` is optional in
 * the state shape and is intentionally omitted from the defaults.
 */
function makeState(overrides: Partial<BacklogState> = {}): BacklogState {
  return {
    project: null,
    isBacklogActivated: true,
    userstories: [],
    sprints: [],
    closedSprints: [],
    sprintsById: {},
    closedSprintsById: {},
    stats: null,
    filtersData: null,
    selectedFilters: {},
    currentSprint: null,
    totalMilestones: 0,
    totalClosedMilestones: 0,
    page: 1,
    disablePagination: false,
    totalUserStories: 0,
    noSwimlaneUserStories: false,
    visibleUserStories: [],
    displayVelocity: false,
    forecastedStories: [],
    forecastNewSprint: true,
    showTags: true,
    activeFilters: false,
    swimlanesList: [],
    backlogOrder: {},
    milestonesOrder: {},
    newUs: [],
    loading: true,
    loadingUserstories: false,
    ...overrides,
  };
}

/**
 * Build the hook's `actions` object — every thunk the container consumes,
 * stubbed as a fresh `jest.fn()`. The 16 keys mirror the real memoized `actions`
 * object returned by `useBacklog`, so the container can read any of them.
 */
function makeActions() {
  return {
    moveUs: jest.fn(),
    moveUsToTopOfBacklog: jest.fn(),
    moveToSprint: jest.fn(),
    bulkCreateUs: jest.fn(),
    createSprint: jest.fn(),
    saveSprint: jest.fn(),
    removeSprint: jest.fn(),
    setFilters: jest.fn(),
    toggleTags: jest.fn(),
    toggleVelocity: jest.fn(),
    reloadUserstories: jest.fn(),
    reloadSprints: jest.fn(),
    reloadClosedSprints: jest.fn(),
    reloadStats: jest.fn(),
    addUsOptimistic: jest.fn(),
    removeUsOptimistic: jest.fn(),
  };
}

/** The stable stub actions for the current test (rebuilt fresh each test). */
let stubActions: ReturnType<typeof makeActions>;

/**
 * Configure the mocked hook to return `{ state, actions }` for the next render.
 * `state` is a fresh {@link makeState} (with the supplied overrides) while
 * `actions` reuses the current {@link stubActions} so a test can both drive the
 * render AND assert on the very same spies the container invoked. Returns the
 * state for convenience.
 */
function primeHook(stateOverrides: Partial<BacklogState> = {}): BacklogState {
  const state = makeState(stateOverrides);
  mockUseBacklog.mockReturnValue({
    state,
    actions: stubActions,
  } as ReturnType<typeof useBacklog>);
  return state;
}

/** Render `BacklogApp` with string attributes, type-checked against its props. */
function renderApp(
  projectId = '7',
  projectSlug: string | undefined = 'proj-7',
): ReturnType<typeof render> {
  return render(<BacklogApp projectId={projectId} projectSlug={projectSlug} />);
}

/* ========================================================================== *
 * Lifecycle
 * ========================================================================== */

beforeEach(() => {
  // Fresh spies + reset captured props so each test observes only its own render.
  stubActions = makeActions();
  mockCaptured.dnd = null;
  mockCaptured.backlogTable = null;
  mockCaptured.createEditSprintLightbox = null;
  mockCaptured.bulkCreateUsLightbox = null;
  mockCaptured.sprint = [];
  // Default: the project has NOT loaded yet (project === null).
  primeHook();
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('BacklogApp', () => {
  describe('projectId coercion', () => {
    it('coerces the string project-id attribute to a number for useBacklog', () => {
      renderApp('7', 'proj-7');

      // The container calls `Number(props.projectId)` and passes the NUMBER
      // (not the "7" string) to the hook — proving the coercion.
      expect(useBacklog).toHaveBeenCalledWith(7);
    });

    it('does not pass the raw string "7" to useBacklog', () => {
      renderApp('7', 'proj-7');

      // Jest distinguishes 7 from "7"; asserting the string was NOT used guards
      // against a regression that drops the `Number(...)` coercion.
      expect(useBacklog).not.toHaveBeenCalledWith('7');
    });
  });

  describe('invalid project-id guard', () => {
    it('renders the inert host and no board when project-id is not a number', () => {
      const { container } = renderApp('not-a-number');

      // `Number("not-a-number")` is NaN -> `projectIdValid` is false -> the
      // container short-circuits to the inert wrapper host.
      expect(
        container.querySelector('[data-tg-react-backlog="invalid-project"]'),
      ).not.toBeNull();

      // None of the board / lightbox subtree renders on the invalid branch.
      expect(screen.queryByTestId('dnd-context')).toBeNull();
      expect(screen.queryByTestId('backlog-table')).toBeNull();
      expect(screen.queryByTestId('create-edit-sprint-lightbox')).toBeNull();
    });

    it('still calls the hook unconditionally (Rules of Hooks) even when invalid', () => {
      renderApp('not-a-number');

      // The hook is invoked before the guard returns, so it is always called.
      expect(mockUseBacklog).toHaveBeenCalled();
    });
  });

  describe('project not yet loaded (project === null)', () => {
    // The authored container has NO dedicated loading affordance; while the
    // project is still loading (`project === null`) it simply gates the board,
    // DnD context, sprints and bulk-create lightbox off. This asserts that
    // authored gating rather than inventing a loading spinner.
    it('gates the DnD context, table, sprints and bulk lightbox off', () => {
      // beforeEach already primed the default state with project === null.
      renderApp();

      expect(screen.queryByTestId('dnd-context')).toBeNull();
      expect(screen.queryByTestId('backlog-table')).toBeNull();
      expect(screen.queryAllByTestId('sprint')).toHaveLength(0);
      expect(screen.queryByTestId('bulk-create-us-lightbox')).toBeNull();
    });

    it('still mounts the always-present sprint lightbox and shows no empty/invalid state', () => {
      renderApp();

      // The sprint lightbox is mounted unconditionally (toggled by `open`),
      // proving the full render tree — not the invalid/empty branch — was taken.
      expect(screen.getByTestId('create-edit-sprint-lightbox')).toBeInTheDocument();
      expect(
        screen.queryByText('The backlog is not activated for this project.'),
      ).toBeNull();
    });
  });

  describe('loaded — smoke render & child composition', () => {
    it('wraps the BacklogTable inside the DnD context and renders one Sprint per open sprint', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(2),
        sprints: [makeMilestone({ id: 1, name: 'Sprint 1' })],
      });

      renderApp();

      const dnd = screen.getByTestId('dnd-context');
      expect(dnd).toBeInTheDocument();

      // Composition: the table stub is a DESCENDANT of the DnD-context stub,
      // proving `BacklogDndContext` wraps `BacklogTable`.
      const table = within(dnd).getByTestId('backlog-table');
      expect(table).toBeInTheDocument();

      // One open sprint in state -> exactly one Sprint child.
      expect(screen.getAllByTestId('sprint')).toHaveLength(1);
    });

    it('mounts both lightboxes (closed) alongside the loaded board', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        sprints: [makeMilestone()],
      });

      renderApp();

      const sprintLightbox = screen.getByTestId('create-edit-sprint-lightbox');
      const bulkLightbox = screen.getByTestId('bulk-create-us-lightbox');
      expect(sprintLightbox).toBeInTheDocument();
      expect(bulkLightbox).toBeInTheDocument();

      // Both start closed (container `lightbox` state is 'none').
      expect(sprintLightbox).toHaveAttribute('data-open', 'false');
      expect(bulkLightbox).toHaveAttribute('data-open', 'false');
    });

    it('renders without throwing given a fully-populated stubbed state', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(3),
        sprints: [makeMilestone({ id: 1 }), makeMilestone({ id: 2, name: 'Sprint 2' })],
        totalMilestones: 2,
      });

      expect(() => renderApp()).not.toThrow();
      expect(screen.getAllByTestId('sprint')).toHaveLength(2);
    });
  });

  describe('backlog-not-activated empty state', () => {
    it('shows the not-activated message and no board when isBacklogActivated is false', () => {
      // Guard #2 reads the STATE flag `isBacklogActivated`; a loaded project is
      // also required (`project && !isBacklogActivated`).
      primeHook({
        project: makeProject({ is_backlog_activated: false }),
        isBacklogActivated: false,
      });

      renderApp();

      expect(
        screen.getByText('The backlog is not activated for this project.'),
      ).toBeInTheDocument();

      // The empty state early-returns BEFORE the board and the lightboxes.
      expect(screen.queryByTestId('backlog-table')).toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
      expect(screen.queryByTestId('create-edit-sprint-lightbox')).toBeNull();
      expect(screen.queryByTestId('bulk-create-us-lightbox')).toBeNull();
    });
  });

  describe('actions wiring (light)', () => {
    beforeEach(() => {
      // A loaded board so `BacklogTable` + `BacklogDndContext` render and capture
      // the props the container hands them.
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(2),
        sprints: [makeMilestone()],
      });
      renderApp();
    });

    it('passes function callbacks to the BacklogTable child', () => {
      expect(mockCaptured.backlogTable).not.toBeNull();
      expect(typeof mockCaptured.backlogTable.onToggleCheck).toBe('function');
      expect(typeof mockCaptured.backlogTable.onUpdateStatus).toBe('function');
      expect(typeof mockCaptured.backlogTable.onEditUs).toBe('function');
      expect(typeof mockCaptured.backlogTable.onDeleteUs).toBe('function');
      expect(typeof mockCaptured.backlogTable.onMoveUsToTop).toBe('function');
    });

    it('routes onDeleteUs to actions.removeUsOptimistic(us.id)', () => {
      mockCaptured.backlogTable.onDeleteUs(makeUserStory({ id: 42 }));
      expect(stubActions.removeUsOptimistic).toHaveBeenCalledWith(42);
    });

    it('routes onMoveUsToTop to actions.moveUsToTopOfBacklog(us)', () => {
      const us = makeUserStory({ id: 7 });
      mockCaptured.backlogTable.onMoveUsToTop(us);
      expect(stubActions.moveUsToTopOfBacklog).toHaveBeenCalledWith(us);
    });

    it('passes an onMove callback to the BacklogDndContext child', () => {
      expect(mockCaptured.dnd).not.toBeNull();
      expect(typeof mockCaptured.dnd.onMove).toBe('function');
    });
  });
});

