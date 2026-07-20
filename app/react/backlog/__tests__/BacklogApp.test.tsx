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
 *       (3) otherwise the full board. Group B fix (dest#3): a SINGLE lifted
 *       `BacklogDndContext` provider now encloses BOTH `BacklogTable` AND the
 *       open/closed `Sprint`s (so sprint drop zones are reachable), and both
 *       lightboxes mount (each toggled by an `open` prop). The provider itself is
 *       no longer gated on a loaded `project` — it renders inert during the
 *       pre-load window while its draggable/droppable CONSUMERS stay gated.
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

import { render, screen, within, fireEvent, act } from '@testing-library/react';

import { BacklogApp } from '../BacklogApp';
import { useBacklog } from '../state/useBacklog';
import { useResolvedProjectId } from '../../shared/useResolvedProjectId';
import { createUserStory } from '../../shared/api/userstories';
import {
  makeProject,
  makeUserStory,
  makeUserStories,
  makeMilestone,
  makeFiltersData,
  makeFilterOption,
} from './factories';

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
  filtersSidebar: any;
  sprint: any[];
} = {
  dnd: null,
  backlogTable: null,
  createEditSprintLightbox: null,
  bulkCreateUsLightbox: null,
  filtersSidebar: null,
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

/*
 * `useResolvedProjectId` (F-REG-01) is replaced by a SYNCHRONOUS fast-path mock
 * that reproduces the container-boundary contract: it coerces `props.projectId`
 * to a number and reports `projectIdValid` via `Number.isInteger(id) && id > 0`,
 * with `resolving: false`. This keeps the CONTAINER specs focused on rendering
 * from a resolution RESULT (never loading the real `/projects/by_slug` client
 * graph), exactly as `useBacklog` is auto-mocked. The real slug-resolution logic
 * — URL parsing, the `by_slug` lookup, and the `resolving` window — is exercised
 * by the dedicated `shared/__tests__/useResolvedProjectId.test.ts` spec. Tests
 * that need the transient loading shell override this mock per-render.
 */
jest.mock('../../shared/useResolvedProjectId', () => ({
  __esModule: true,
  useResolvedProjectId: jest.fn((props?: { projectId?: string }) => {
    const id = Number(props?.projectId);
    const valid = Number.isInteger(id) && id > 0;
    return { projectId: valid ? id : 0, projectIdValid: valid, resolving: false };
  }),
}));

/*
 * C2 (dest#5): the standard "Add" reveals an inline create input that persists a
 * single story via `createUserStory` (`POST /userstories`). Mocked to resolve so
 * the container's async submit -> refresh chain settles without loading the real
 * `/api/v1/` client / session reader. (`BacklogApp` imports ONLY `createUserStory`
 * from this module; `filtersData` reaches it via the `useBacklog` state, not this
 * import, so no other export needs stubbing.)
 */
jest.mock('../../shared/api/userstories', () => ({
  __esModule: true,
  createUserStory: jest.fn(() => Promise.resolve({})),
}));

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

// F-CQ-06: the reused shared filter panel. Stubbed as a LEAF that records its
// props (filters/customFilters/selectedFilters + the five `on*` callbacks) so
// the container's filter WIRING is asserted here without re-testing the
// presentational component (covered by the Kanban `FiltersSidebar` spec).
jest.mock('../../kanban/components/FiltersSidebar', () => ({
  __esModule: true,
  FiltersSidebar: (props: any) => {
    mockCaptured.filtersSidebar = props;
    return <div data-testid="filters-sidebar" />;
  },
}));

/**
 * Strongly-typed handle onto the auto-mocked hook. `jest.MockedFunction`
 * preserves the original signature so `.mockReturnValue(...)` and the
 * `toHaveBeenCalledWith(...)` assertions remain type-checked.
 */
const mockUseBacklog = useBacklog as jest.MockedFunction<typeof useBacklog>;
const mockUseResolvedProjectId = useResolvedProjectId as jest.MockedFunction<
  typeof useResolvedProjectId
>;
const mockCreateUserStory = createUserStory as jest.MockedFunction<typeof createUserStory>;

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
    loadError: false,
    loadingUserstories: false,
    moveError: null,
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
    // Promise-returning thunks honour their real `Promise<void>` contract so the
    // container's `.then()/.catch()` (F-REG-06) resolve cleanly under test.
    moveToSprint: jest.fn(() => Promise.resolve()),
    loadMore: jest.fn(() => Promise.resolve()),
    finishSprintCreation: jest.fn(() => Promise.resolve()),
    reload: jest.fn(() => Promise.resolve()),
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
    deleteUs: jest.fn(() => Promise.resolve()),
    updateUsStatus: jest.fn(() => Promise.resolve()),
    updateUsPoints: jest.fn(() => Promise.resolve()),
    // F-AAP-03 (dest#8): dismiss the drag/mutation error toast.
    clearMoveError: jest.fn(),
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
  mockCaptured.filtersSidebar = null;
  mockCaptured.sprint = [];
  mockCreateUserStory.mockReset();
  mockCreateUserStory.mockResolvedValue({} as never);
  // Re-establish the synchronous fast-path resolution default (a per-test
  // override for the loading shell must not leak into later specs).
  mockUseResolvedProjectId.mockImplementation((props?: { projectId?: string }) => {
    const id = Number(props?.projectId);
    const valid = Number.isInteger(id) && id > 0;
    return { projectId: valid ? id : 0, projectIdValid: valid, resolving: false };
  });
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

    // F-REG-01: the guard must reject blank / non-positive / non-integer ids, not
    // just NaN. `Number("")` is 0 and `Number("-1")` is -1 (both FINITE), so the
    // stricter `Number.isInteger(id) && id > 0` rule is what rejects them, and it
    // also rejects the literal `"{{project.id}}"` snapshot AngularJS emits before
    // its first digest resolves the interpolation.
    it.each([
      ['a blank string (Number("") === 0)', ''],
      ['zero', '0'],
      ['a negative id', '-1'],
      ['a fractional id', '1.5'],
      ['the unresolved AngularJS interpolation literal', '{{project.id}}'],
    ])('rejects %s as an invalid project-id', (_label, value) => {
      const { container } = renderApp(value);

      expect(
        container.querySelector('[data-tg-react-backlog="invalid-project"]'),
      ).not.toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
      expect(screen.queryByTestId('backlog-table')).toBeNull();
    });
  });

  describe('project-id resolution (F-REG-01)', () => {
    it('renders a transient loading shell (not the blank invalid host) while the slug is resolving', () => {
      // While `useResolvedProjectId` is resolving the project from the URL slug
      // (`resolving: true`, id not yet valid), the container must show an
      // accessible LOADING shell rather than the inert invalid host or a blank
      // backlog — the fix for the permanently-blank board (F-REG-01).
      mockUseResolvedProjectId.mockReturnValue({
        projectId: 0,
        projectIdValid: false,
        resolving: true,
      });

      const { container } = renderApp(undefined as unknown as string, undefined);

      const resolving = container.querySelector('[data-tg-react-backlog="resolving"]');
      expect(resolving).not.toBeNull();
      expect(resolving?.getAttribute('aria-busy')).toBe('true');
      expect(screen.getByRole('status')).toBeInTheDocument();
      // Neither the inert invalid host nor the board renders while resolving.
      expect(container.querySelector('[data-tg-react-backlog="invalid-project"]')).toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });

    it('renders the board once the slug resolves to a valid project id', () => {
      // A resolved valid id (from the by_slug lookup) drives a normal render
      // even though NO numeric `project-id` attribute was supplied.
      mockUseResolvedProjectId.mockReturnValue({
        projectId: 7,
        projectIdValid: true,
        resolving: false,
      });

      renderApp(undefined as unknown as string, 'proj-7');

      // The resolved id flows into the backlog hook, and the invalid/resolving
      // hosts are absent.
      expect(useBacklog).toHaveBeenCalledWith(7);
    });
  });

  describe('project not yet loaded (project === null)', () => {
    // Group B fix (dest#3): the <BacklogDndContext> provider was lifted up to
    // <main> so a SINGLE provider encloses BOTH the backlog list AND the sprint
    // sidebar, which is what makes the sprint drop zones reachable. As a
    // consequence the provider now renders even during the pre-load window
    // (`project === null`) — but it is INERT then: every draggable/droppable
    // CONSUMER (the table, the sprints, the bulk-create lightbox) keeps its own
    // `{project && …}` guard and stays gated off until the project loads. This
    // asserts that corrected behavior rather than the pre-fix "provider gated on
    // project" behavior.
    it('renders an inert DnD provider but gates table, sprints and bulk lightbox off', () => {
      // beforeEach already primed the default state with project === null.
      renderApp();

      // The lifted provider renders even before the project loads...
      expect(screen.queryByTestId('dnd-context')).not.toBeNull();
      // ...but every draggable/droppable consumer remains gated off, so nothing
      // is actually draggable until the project (and its data) has loaded.
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

    it('N-11: exposes a correct heading hierarchy — "Backlog" semantically level 1, "Sprints" level 2', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        sprints: [makeMilestone()],
        totalMilestones: 1,
      });

      const { container } = renderApp();

      // The primary "Backlog" heading keeps its visual <h2> tag (baseline
      // fidelity — the SCSS + global typography style it via the tag) but is
      // marked aria-level=1 so assistive tech sees it as the top-level heading.
      const backlog = container.querySelector('.backlog-header-title h2') as HTMLElement;
      expect(backlog).not.toBeNull();
      expect(backlog.textContent).toContain('Backlog');
      expect(backlog).toHaveAttribute('aria-level', '1');

      // The "Sprints" sidebar heading keeps its visual <h1> tag but is marked
      // aria-level=2 so it is semantically subordinate — fixing the previous
      // out-of-order H2(Backlog) -> H1(Sprints) heading sequence with NO visual
      // change.
      const sprints = container.querySelector('.sprint-header h1') as HTMLElement;
      expect(sprints).not.toBeNull();
      expect(sprints.textContent).toContain('Sprints');
      expect(sprints).toHaveAttribute('aria-level', '2');
    });
  });

  /* ------------------------------------------------------------------ *
   * Shift-range multiselect — REAL handleToggleCheck (M-14)
   *
   * These specs drive the container's genuine `handleToggleCheck`
   * (captured off the mocked `BacklogTable` as `onToggleCheck`) with real
   * `useState`/`useRef` machinery and assert the resulting `checkedIds`
   * prop the container feeds back to the table.
   *
   * Runtime re-verification of M-14 surfaced a latent React-18 ordering
   * bug: `handleToggleCheck` read the previous anchor
   * (`lastCheckedIdRef.current`) INSIDE the `setCheckedIds` functional
   * updater, but overwrote that same ref to the CURRENT row id in the
   * synchronous handler body immediately after calling `setCheckedIds`.
   * Because React runs the updater during the render phase (AFTER the
   * handler body), the updater observed the just-overwritten value, so
   * `from === to` and a shift-range collapsed to just the two endpoints.
   * The mocked-table isolation lets us call the real handler directly; to
   * make the regression DETERMINISTIC we batch the anchor toggle and the
   * shift toggle inside a SINGLE `act(...)`. The first `setCheckedIds`
   * marks the fiber's lanes, so the second dispatch cannot take React's
   * eager-state fast-path and MUST defer its updater to the render phase —
   * exactly the ordering that manifested at runtime. On the pre-fix code
   * this yields `{first, last}`; the fix (snapshotting the anchor before
   * `setCheckedIds`) yields the full contiguous range.
   * ------------------------------------------------------------------ */
  describe('shift-range multiselect via the real handleToggleCheck (M-14)', () => {
    it('selects the FULL contiguous range on a batched anchor+shift toggle, not just the endpoints', () => {
      const stories = makeUserStories(5); // ids/refs 1..5, in backlog order
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: stories,
      });

      renderApp();

      // The mocked table received the real handler + the initial (empty) selection.
      expect(mockCaptured.backlogTable.checkedIds).toEqual([]);
      const onToggleCheck = mockCaptured.backlogTable.onToggleCheck as (
        us: (typeof stories)[number],
        checked: boolean,
        shiftKey: boolean,
      ) => void;

      // Batch BOTH interactions in one act(): (1) plain toggle of id 1 sets the
      // anchor, (2) shift-toggle of id 4 extends the range. Batching guarantees
      // the second updater DEFERS (no eager fast-path), reproducing the runtime
      // ordering the fix addresses.
      act(() => {
        onToggleCheck(stories[0], true, false); // anchor -> id 1
        onToggleCheck(stories[3], true, true); // shift  -> id 4
      });

      const finalChecked = [...mockCaptured.backlogTable.checkedIds].sort(
        (a: number, b: number) => a - b,
      );
      // Pre-fix bug -> [1, 4] (endpoints only). Fixed -> full range [1,2,3,4].
      expect(finalChecked).toEqual([1, 2, 3, 4]);
    });

    it('a plain (no-shift) toggle selects exactly the one clicked row and sets the anchor', () => {
      const stories = makeUserStories(5);
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: stories,
      });

      renderApp();

      const onToggleCheck = mockCaptured.backlogTable.onToggleCheck as (
        us: (typeof stories)[number],
        checked: boolean,
        shiftKey: boolean,
      ) => void;

      act(() => {
        onToggleCheck(stories[2], true, false); // id 3
      });

      expect(mockCaptured.backlogTable.checkedIds).toEqual([3]);
    });

    it('range selection is order-independent (shift UP from a lower anchor to a higher row)', () => {
      const stories = makeUserStories(5);
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: stories,
      });

      renderApp();

      const onToggleCheck = mockCaptured.backlogTable.onToggleCheck as (
        us: (typeof stories)[number],
        checked: boolean,
        shiftKey: boolean,
      ) => void;

      // Anchor on id 5 (last), then shift-toggle id 2 -> range 2..5.
      act(() => {
        onToggleCheck(stories[4], true, false); // anchor -> id 5
        onToggleCheck(stories[1], true, true); // shift  -> id 2
      });

      const finalChecked = [...mockCaptured.backlogTable.checkedIds].sort(
        (a: number, b: number) => a - b,
      );
      expect(finalChecked).toEqual([2, 3, 4, 5]);
    });
  });

  describe('drag/mutation error toast (F-AAP-03, dest#8)', () => {
    const MOVE_ERR =
      'The story order could not be saved. The board has been refreshed to the latest server state.';

    it('does NOT render the error toast when moveError is null', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        sprints: [makeMilestone()],
        moveError: null,
      });

      const { container } = renderApp();
      expect(container.querySelector('.notification-message-error')).toBeNull();
    });

    it('renders a dismissible error toast with the message when moveError is set', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        sprints: [makeMilestone()],
        moveError: MOVE_ERR,
      });

      const { container } = renderApp();

      const toast = container.querySelector('.notification-message-error');
      expect(toast).not.toBeNull();
      // The user-facing message is shown verbatim.
      expect(screen.getByText(MOVE_ERR)).toBeInTheDocument();
    });

    it('clears the error via the hook when the toast is dismissed', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        sprints: [makeMilestone()],
        moveError: MOVE_ERR,
      });

      renderApp();

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
      expect(stubActions.clearMoveError).toHaveBeenCalledTimes(1);
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
      expect(typeof mockCaptured.backlogTable.onUpdatePoints).toBe('function');
      expect(typeof mockCaptured.backlogTable.onEditUs).toBe('function');
      expect(typeof mockCaptured.backlogTable.onDeleteUs).toBe('function');
      expect(typeof mockCaptured.backlogTable.onMoveUsToTop).toBe('function');
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

  /* ------------------------------------------------------------------------ *
   * F-CQ-03 — single-story CRUD wiring (delete / status / points) + the
   * corrected create routing. The legacy backlog OWNED delete + status + points
   * and DELEGATED standard-create/edit to the common `genericform` dialog. These
   * specs assert the container gates every mutation on an archive-aware
   * permission (`canMutate`) and delegates the persistence to the hook thunk,
   * while standard-create stays an OOS no-op and only bulk opens the lightbox.
   * ------------------------------------------------------------------------ */
  describe('single-story CRUD wiring (F-CQ-03)', () => {
    /** A project that grants both mutation gates the controls require. */
    function editableProject() {
      return makeProject({
        is_backlog_activated: true,
        my_permissions: ['view_project', 'view_us', 'modify_us', 'delete_us'],
      });
    }

    /** Prime a LOADED, editable board and render, capturing child props. */
    function renderEditable(projectOverrides: Record<string, unknown> = {}): void {
      primeHook({
        project: { ...editableProject(), ...projectOverrides },
        isBacklogActivated: true,
        userstories: makeUserStories(2),
        sprints: [makeMilestone()],
      });
      renderApp();
    }

    let confirmSpy: jest.SpyInstance;
    afterEach(() => {
      confirmSpy?.mockRestore();
    });

    it('onUpdateStatus (granted): delegates to actions.updateUsStatus(us, statusId)', () => {
      renderEditable();
      const us = makeUserStory({ id: 5, status: 1 });
      mockCaptured.backlogTable.onUpdateStatus(us, 2);
      expect(stubActions.updateUsStatus).toHaveBeenCalledWith(us, 2);
    });

    it('onUpdateStatus (denied — view-only): is a gated no-op', () => {
      renderEditable({ my_permissions: ['view_project', 'view_us'] });
      mockCaptured.backlogTable.onUpdateStatus(makeUserStory({ id: 5 }), 2);
      expect(stubActions.updateUsStatus).not.toHaveBeenCalled();
    });

    it('onUpdateStatus (denied — archived project): is a gated no-op even with modify_us', () => {
      renderEditable({ archived_code: 'archived' });
      mockCaptured.backlogTable.onUpdateStatus(makeUserStory({ id: 5 }), 2);
      expect(stubActions.updateUsStatus).not.toHaveBeenCalled();
    });

    it('onUpdatePoints (granted): delegates to actions.updateUsPoints(us, roleId, pointId)', () => {
      renderEditable();
      const us = makeUserStory({ id: 6 });
      mockCaptured.backlogTable.onUpdatePoints(us, 1, 11);
      expect(stubActions.updateUsPoints).toHaveBeenCalledWith(us, 1, 11);
    });

    it('onUpdatePoints (denied — view-only): is a gated no-op', () => {
      renderEditable({ my_permissions: ['view_project', 'view_us'] });
      mockCaptured.backlogTable.onUpdatePoints(makeUserStory({ id: 6 }), 1, 11);
      expect(stubActions.updateUsPoints).not.toHaveBeenCalled();
    });

    it('onDeleteUs (granted + confirm ACCEPTED): delegates to actions.deleteUs(us)', () => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      renderEditable();
      const us = makeUserStory({ id: 42 });
      mockCaptured.backlogTable.onDeleteUs(us);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(stubActions.deleteUs).toHaveBeenCalledWith(us);
      // The obsolete local-only path is NOT taken.
      expect(stubActions.removeUsOptimistic).not.toHaveBeenCalled();
    });

    it('onDeleteUs (granted + confirm CANCELLED): asks but does not delete', () => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      renderEditable();
      mockCaptured.backlogTable.onDeleteUs(makeUserStory({ id: 42 }));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(stubActions.deleteUs).not.toHaveBeenCalled();
    });

    it('onDeleteUs (denied — no delete_us): gated BEFORE the confirm prompt', () => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      renderEditable({ my_permissions: ['view_project', 'view_us', 'modify_us'] });
      mockCaptured.backlogTable.onDeleteUs(makeUserStory({ id: 42 }));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(stubActions.deleteUs).not.toHaveBeenCalled();
    });

    it('onDeleteUs (denied — archived project): gated even with delete_us', () => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      renderEditable({ archived_code: 'archived' });
      mockCaptured.backlogTable.onDeleteUs(makeUserStory({ id: 42 }));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(stubActions.deleteUs).not.toHaveBeenCalled();
    });

    describe('onEditUs — routes to the shell-owned US detail screen (M-13)', () => {
      // M-13 parity fix: the backlog "Edit" option navigates to the shell-owned
      // US detail screen via `navigateToUserStoryDetail` -> `window.location.href`.
      // jsdom has no navigation, so swap `location` for a writable stub we can
      // ASSERT against, restored after each test. (Same pattern as `client.test.ts`.)
      let savedLocationDescriptor: PropertyDescriptor | undefined;
      const INITIAL_HREF = 'http://localhost/backlog';

      beforeEach(() => {
        savedLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
        Object.defineProperty(window, 'location', {
          configurable: true,
          writable: true,
          value: {
            href: INITIAL_HREF,
            origin: 'http://localhost',
            pathname: '/backlog',
            search: '',
            hash: '',
            assign() {},
            replace() {},
          },
        });
      });

      afterEach(() => {
        if (savedLocationDescriptor) {
          Object.defineProperty(window, 'location', savedLocationDescriptor);
        }
      });

      it('GRANTED (modify_us): navigates to /project/:slug/us/:ref (same detail screen as the row link)', () => {
        // `renderEditable` primes a modify_us project with slug "project-1", so
        // editing story ref 42 targets `/project/project-1/us/42` — the SAME
        // shell-owned detail screen the row subject link opens.
        renderEditable();
        mockCaptured.backlogTable.onEditUs(makeUserStory({ id: 9, ref: 42 }));
        expect(window.location.href).toBe('/project/project-1/us/42');
        // Navigation only — no board mutation fires here (the detail screen +
        // hook refresh own persistence/reflection).
        expect(stubActions.updateUsStatus).not.toHaveBeenCalled();
        expect(stubActions.deleteUs).not.toHaveBeenCalled();
      });

      it('DENIED (view-only): gated — does NOT navigate and does not mutate', () => {
        // The container handler gates on `canModifyUs` (mirroring the affordance,
        // which BacklogTable renders only under `modify_us`), so a view-only
        // project short-circuits BEFORE navigating.
        renderEditable({ my_permissions: ['view_project', 'view_us'] });
        expect(() =>
          mockCaptured.backlogTable.onEditUs(makeUserStory({ id: 9, ref: 42 })),
        ).not.toThrow();
        expect(window.location.href).toBe(INITIAL_HREF);
        expect(stubActions.updateUsStatus).not.toHaveBeenCalled();
        expect(stubActions.deleteUs).not.toHaveBeenCalled();
      });
    });

    it('the bulk "Add" button opens the BulkCreateUsLightbox', () => {
      renderEditable({
        my_permissions: ['view_project', 'view_us', 'modify_us', 'add_us'],
      });
      // Starts closed.
      expect(
        screen.getByTestId('bulk-create-us-lightbox'),
      ).toHaveAttribute('data-open', 'false');

      fireEvent.click(
        screen.getByRole('button', { name: 'Add user stories in bulk' }),
      );

      // The bulk lightbox is now open — the ONLY migrated create surface.
      expect(
        screen.getByTestId('bulk-create-us-lightbox'),
      ).toHaveAttribute('data-open', 'true');
    });

    /*
     * C2 (dest#5): the standard "Add" is NO LONGER a no-op. It reveals an inline
     * single-story create input (distinct from the bulk lightbox) that POSTs to
     * `/userstories` on submit. These specs assert THAT corrected behaviour
     * (aligned to the authoritative `dest_` report Issue 5). The two create paths
     * stay distinct: standard reveals the inline form; only bulk opens the lightbox.
     */
    /** Click the standard "Add" button (the first button in `.new-us`). */
    function clickStandardAdd(): void {
      const addButton = within(
        document.querySelector('.new-us') as HTMLElement,
      ).getAllByRole('button')[0];
      fireEvent.click(addButton);
    }

    it('the standard "Add" button reveals the inline create form WITHOUT opening the bulk lightbox', () => {
      renderEditable({
        my_permissions: ['view_project', 'view_us', 'modify_us', 'add_us'],
      });

      // No inline form until "Add" is clicked.
      expect(document.querySelector('form.new-us-inline')).toBeNull();

      clickStandardAdd();

      // The inline create input is now revealed…
      expect(document.querySelector('form.new-us-inline')).not.toBeNull();
      expect(screen.getByLabelText('New user story subject')).toBeInTheDocument();
      // …and standard create must NOT hijack the bulk lightbox (paths stay distinct).
      expect(screen.getByTestId('bulk-create-us-lightbox')).toHaveAttribute(
        'data-open',
        'false',
      );
      expect(mockCreateUserStory).not.toHaveBeenCalled();
    });

    it('submitting the inline form POSTs a single story to /userstories, then refreshes the list + stats and closes', async () => {
      renderEditable({
        my_permissions: ['view_project', 'view_us', 'modify_us', 'add_us'],
      });

      clickStandardAdd();
      const input = screen.getByLabelText('New user story subject') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '  New story from React  ' } });

      await act(async () => {
        fireEvent.submit(document.querySelector('form.new-us-inline') as HTMLElement);
        // Settle the async create -> refresh chain (createUserStory is mocked to resolve).
        await Promise.resolve();
        await Promise.resolve();
      });

      // The subject is trimmed and the payload carries the resolved project id (7).
      expect(mockCreateUserStory).toHaveBeenCalledTimes(1);
      expect(mockCreateUserStory).toHaveBeenCalledWith({
        project: 7,
        subject: 'New story from React',
      });
      // The list + stats refresh so the new row appears (parity with `usform:new:success`).
      expect(stubActions.reloadUserstories).toHaveBeenCalledTimes(1);
      expect(stubActions.reloadStats).toHaveBeenCalledTimes(1);
      // The inline form closes on success; the bulk lightbox was never opened.
      expect(document.querySelector('form.new-us-inline')).toBeNull();
      expect(screen.getByTestId('bulk-create-us-lightbox')).toHaveAttribute(
        'data-open',
        'false',
      );
    });

    it('the inline create form is dismissed by Cancel and by Escape without posting', () => {
      renderEditable({
        my_permissions: ['view_project', 'view_us', 'modify_us', 'add_us'],
      });

      // Cancel button dismisses the form.
      clickStandardAdd();
      expect(document.querySelector('form.new-us-inline')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(document.querySelector('form.new-us-inline')).toBeNull();

      // Escape on the subject input also dismisses it.
      clickStandardAdd();
      const input = screen.getByLabelText('New user story subject');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(document.querySelector('form.new-us-inline')).toBeNull();

      // Neither dismissal posted anything.
      expect(mockCreateUserStory).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------------ *
   * F-CQ-04 — backlog-summary progress meter integration + loading / error /
   * collapse states. The `ProgressBar` component (the real port of
   * `tgBacklogProgressBar`) was implemented but never mounted — the container
   * rendered an empty `.summary-progress-bar` placeholder. These specs prove the
   * real meter now renders with the live stats, that the loading/error classes
   * track the stats lifecycle, and that the burndown collapse toggle works.
   * NOTE: `ProgressBar` is deliberately NOT mocked, so the real DOM is asserted.
   * ------------------------------------------------------------------------ */
  describe('summary progress meter + burndown states (F-CQ-04)', () => {
    /** A `BacklogStats`-shaped fixture (structurally a ProgressBarStats too). */
    function makeStats(
      overrides: Partial<BacklogState['stats']> = {},
    ): NonNullable<BacklogState['stats']> {
      return {
        completedPercentage: 25,
        showGraphPlaceholder: false,
        speed: 3,
        total_points: 100,
        defined_points: 80,
        closed_points: 25,
        ...(overrides as object),
      };
    }

    it('mounts the REAL ProgressBar (three sub-bars) inside the summary once stats load', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats(),
      });
      const { container } = renderApp();

      // The real meter — its three characteristic sub-bars — is present, NOT the
      // old empty placeholder.
      const meter = container.querySelector('.summary-progress-bar');
      expect(meter).not.toBeNull();
      expect(meter?.querySelector('.defined-points')).not.toBeNull();
      expect(meter?.querySelector('.project-points-progress')).not.toBeNull();
      expect(meter?.querySelector('.closed-points-progress')).not.toBeNull();
    });

    it('drives the closed-points sub-bar width from the live stats formula', () => {
      // definedPoints(80) <= totalPoints(100) → projectPct=100; closedPct =
      // 25*100/100 = 25; each has the -3 inset then clamp/round → 97% and 22%.
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats({ total_points: 100, defined_points: 80, closed_points: 25 }),
      });
      const { container } = renderApp();

      const project = container.querySelector(
        '.summary-progress-bar .project-points-progress',
      ) as HTMLElement;
      const closed = container.querySelector(
        '.summary-progress-bar .closed-points-progress',
      ) as HTMLElement;
      expect(project.style.width).toBe('97%');
      expect(closed.style.width).toBe('22%');
    });

    it('marks the summary region loading (aria-busy) before stats first arrive', () => {
      // A loaded PROJECT but stats still null, and no load error → loading window.
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: null,
      });
      const { container } = renderApp();

      const summary = container.querySelector('.backlog-summary') as HTMLElement;
      expect(summary).toHaveClass('loading');
      expect(summary).toHaveAttribute('aria-busy', 'true');
      // The meter still renders (0%-width bars) rather than vanishing.
      expect(container.querySelector('.summary-progress-bar')).not.toBeNull();
    });

    it('clears the loading class once stats are present', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats(),
      });
      const { container } = renderApp();

      const summary = container.querySelector('.backlog-summary') as HTMLElement;
      expect(summary).not.toHaveClass('loading');
      expect(summary).toHaveAttribute('aria-busy', 'false');
    });

    it('toggles the burndown graph collapse via the summary graph button', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats({ showGraphPlaceholder: false }),
      });
      const { container } = renderApp();

      const graph = container.querySelector('.js-burndown-graph') as HTMLElement;
      const toggle = container.querySelector(
        '.js-toggle-burndown-visibility-button',
      ) as HTMLElement;
      // Starts expanded (`shown open`).
      expect(graph).toHaveClass('shown');
      expect(graph).toHaveClass('open');

      fireEvent.click(toggle);
      // Collapsed after one click.
      expect(graph).not.toHaveClass('shown');
      expect(graph).not.toHaveClass('open');
    });

    it('renders the admin empty-burndown hint when the graph placeholder is active', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true, i_am_admin: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats({ showGraphPlaceholder: true }),
      });
      const { container } = renderApp();

      expect(container.querySelector('.empty-burndown')).not.toBeNull();
    });

    it('renders the BurndownChart SVG inside .burndown once stats.milestones arrive (dest#6)', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats({
          showGraphPlaceholder: false,
          milestones: [
            { name: 'Sprint A', optimal: 100, evolution: 100, 'team-increment': 0, 'client-increment': 0 },
            { name: 'Sprint B', optimal: 50, evolution: 60, 'team-increment': 0, 'client-increment': 0 },
          ],
        }),
      });
      const { container } = renderApp();

      // The chart mounts inside the retained `.burndown` container — no longer
      // an empty placeholder (QA dest#6 / w023#4).
      const burndown = container.querySelector('.js-burndown-graph .burndown');
      expect(burndown).not.toBeNull();
      const svg = burndown?.querySelector('svg.burndown-graph');
      expect(svg).not.toBeNull();
      // Optimal series has one marker per milestone (2).
      expect(svg?.querySelectorAll('.burndown-series-optimal circle')).toHaveLength(2);
    });

    it('leaves .burndown empty (no SVG) while stats.milestones is absent', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        stats: makeStats({ showGraphPlaceholder: false }),
      });
      const { container } = renderApp();

      const burndown = container.querySelector('.js-burndown-graph .burndown');
      expect(burndown).not.toBeNull();
      // No milestones in this fixture → the chart renders nothing (guard parity).
      expect(burndown?.querySelector('svg')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------------ *
   * F-CQ-06 — sidebar filters. The legacy backlog hosted the shared
   * `<tg-filter>` panel with NO facet exclusions (unlike Kanban, which hid the
   * `status` facet). These specs assert the container (a) shapes the raw
   * `filtersData` into the sidebar's category + applied-filter props via the
   * shared `UsFiltersMixin` port, (b) offers the status facet, (c) delegates
   * add/remove intent to the hook's `setFilters` thunk with the correct
   * selections map, and (d) treats saved custom filters as an AAP-scoped
   * deferral (empty list + no-op handlers). The presentational panel itself is
   * stubbed (covered by the Kanban `FiltersSidebar` spec).
   * ------------------------------------------------------------------------ */
  describe('sidebar filters (F-CQ-06)', () => {
    /**
     * Prime a LOADED board carrying a representative `filtersData`, render, then
     * OPEN the filter drawer (the sidebar mounts only while open) so the stubbed
     * `FiltersSidebar` captures its props.
     */
    function renderWithFilters(stateOverrides: Partial<BacklogState> = {}): void {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(2),
        filtersData: makeFiltersData({
          statuses: [
            makeFilterOption({ id: 1, name: 'New', color: '#111', count: 3 }),
            makeFilterOption({ id: 2, name: 'Done', color: '#222', count: 5 }),
          ],
          tags: [makeFilterOption({ id: null, name: 'urgent', count: 4 })],
        }),
        ...stateOverrides,
      });
      renderApp();
      // Open the drawer via the header toggle (`#show-filters-button`).
      fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    }

    it('does not mount the sidebar until the drawer is opened', () => {
      primeHook({
        project: makeProject({ is_backlog_activated: true }),
        isBacklogActivated: true,
        userstories: makeUserStories(1),
        filtersData: makeFiltersData(),
      });
      renderApp();
      expect(mockCaptured.filtersSidebar).toBeNull();
      expect(screen.queryByTestId('filters-sidebar')).toBeNull();
    });

    it('offers every facet INCLUDING status (Backlog excludes none)', () => {
      renderWithFilters();
      expect(mockCaptured.filtersSidebar).not.toBeNull();
      const dataTypes = mockCaptured.filtersSidebar.filters.map((c: any) => c.dataType);
      expect(dataTypes).toContain('status');
      expect(dataTypes).toEqual([
        'status',
        'tags',
        'assigned_users',
        'role',
        'owner',
        'epic',
      ]);
    });

    it('passes an empty saved-custom-filter list (AAP-scoped deferral)', () => {
      renderWithFilters();
      expect(mockCaptured.filtersSidebar.customFilters).toEqual([]);
    });

    it('reflects the applied selections as resolved SelectedFilter entries', () => {
      renderWithFilters({ selectedFilters: { status: '1' } });
      const applied = mockCaptured.filtersSidebar.selectedFilters;
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({
        id: 1,
        name: 'New',
        dataType: 'status',
        mode: 'include',
      });
    });

    it('surfaces the applied-filter count on the header toggle', () => {
      renderWithFilters({ selectedFilters: { status: '1,2' } });
      // Two applied status options -> the `.selected-filters` badge reads "2".
      const badge = document.querySelector('.selected-filters');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe('2');
    });

    it('onAddFilter delegates to setFilters with the option added to the include bucket', () => {
      renderWithFilters();
      const category = mockCaptured.filtersSidebar.filters.find(
        (c: any) => c.dataType === 'status',
      );
      mockCaptured.filtersSidebar.onAddFilter({
        category,
        filter: makeFilterOption({ id: 2, name: 'Done', count: 5 }),
        mode: 'include',
      });
      expect(stubActions.setFilters).toHaveBeenCalledTimes(1);
      expect(stubActions.setFilters).toHaveBeenCalledWith({ status: '2' });
    });

    it('onAddFilter routes an exclude-mode add to the prefixed bucket', () => {
      renderWithFilters();
      const category = mockCaptured.filtersSidebar.filters.find(
        (c: any) => c.dataType === 'status',
      );
      mockCaptured.filtersSidebar.onAddFilter({
        category,
        filter: makeFilterOption({ id: 2, name: 'Done', count: 5 }),
        mode: 'exclude',
      });
      expect(stubActions.setFilters).toHaveBeenCalledWith({ exclude_status: '2' });
    });

    it('onRemoveFilter delegates to setFilters, dropping the emptied bucket', () => {
      renderWithFilters({ selectedFilters: { status: '1' } });
      mockCaptured.filtersSidebar.onRemoveFilter({
        id: 1,
        key: 'status:1',
        name: 'New',
        mode: 'include',
        dataType: 'status',
      });
      expect(stubActions.setFilters).toHaveBeenCalledTimes(1);
      expect(stubActions.setFilters).toHaveBeenCalledWith({});
    });

    it('treats the three custom-filter handlers as no-ops (never calls setFilters)', () => {
      renderWithFilters();
      expect(() => {
        mockCaptured.filtersSidebar.onSelectCustomFilter({ id: 9, name: 'Saved' });
        mockCaptured.filtersSidebar.onRemoveCustomFilter({ id: 9, name: 'Saved' });
        mockCaptured.filtersSidebar.onSaveCustomFilter('Saved');
      }).not.toThrow();
      expect(stubActions.setFilters).not.toHaveBeenCalled();
    });
  });
});

