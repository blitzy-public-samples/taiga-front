/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogApp.test.tsx
 * -------------------
 * Browserless Jest + React Testing Library unit spec for {@link BacklogApp} —
 * the top-level React container that the `<tg-react-backlog>` custom element
 * mounts, replacing the AngularJS 1.5.10 `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee`) at the ROUTE level as part of the
 * AngularJS -> React 18 coexistence migration (Blitzy AAP 0.1-0.4). This spec
 * contributes to the mandated >=70% global line-coverage gate (AAP 0.2.1 /
 * 0.7.1).
 *
 * WHAT THIS SPEC PROVES (BacklogApp is a THIN ORCHESTRATOR): it exercises PURE
 * WIRING, not data or network behavior. The effectful data hook
 * (`../hooks/useBacklog`) is mocked to a fully controllable `{ state, actions }`
 * object, the presentational children (`BacklogTable`, `SprintList`,
 * `SprintForm`, `ProgressBar`) are replaced with prop-echoing marker stubs, and
 * the drag-and-drop layer (`../../shared/dnd/DndProvider` +
 * `createBacklogDragEndHandler` from `../../shared/dnd/sortable`) is mocked so
 * the coexistence DnD contract can be asserted without a real drag. Together
 * this isolates exactly the container's own responsibilities:
 *   - the static DOM skeleton + CSS class flags reproduced from
 *     `app/partials/backlog/backlog.jade` (visual parity, AAP 0.7);
 *   - the toolbar controls -> `useBacklog` action wiring; and
 *   - the `createBacklogDragEndHandler(...) -> <DndProvider mode="backlog">` seam.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7 - HARD RULES): browserless. Jest + jsdom +
 * React Testing Library ONLY -- NO Playwright, NO real browser, NO network, NO
 * timers (the container's debounced search input is deliberately never fired).
 * React is NOT imported (automatic `react-jsx` runtime); `jest` is a global;
 * jest-dom matchers are auto-registered via jest.config `setupFilesAfterEnv`.
 *
 * MOCK STYLE: every `jest.mock` factory uses `require('react')` + `createElement`
 * (never JSX) to avoid jest's out-of-scope-variable restriction on the injected
 * `_jsx` runtime binding -- matching the established pattern in the sibling
 * `BacklogTable.test.tsx` / `Swimlane.test.tsx` specs. The mock specifiers are
 * written RELATIVE TO THIS TEST FILE so they resolve to the SAME modules
 * `BacklogApp.tsx` imports (e.g. the test's `../hooks/useBacklog` is identical to
 * BacklogApp's `./hooks/useBacklog`); this import-path parity is what guarantees
 * interception.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react';

// The container under test. `BacklogApp` is exported BOTH as a named export and
// as the default; the named form is imported to match the sibling specs.
import { BacklogApp } from '../BacklogApp';
// The mocked hook + drag-end factory are imported so they can be cast to
// `jest.Mock` and driven / asserted below. Importing them AFTER the `jest.mock`
// calls (which ts-jest hoists to the top) yields the mock implementations.
import { useBacklog } from '../hooks/useBacklog';
import { createBacklogDragEndHandler } from '../../shared/dnd/sortable';

/* ------------------------------------------------------------------ *
 * Module mocks (hoisted by ts-jest above the imports)
 * ------------------------------------------------------------------ */

// A stable sentinel returned by the mocked backlog drag-end FACTORY. It lets the
// test prove BacklogApp hands `createBacklogDragEndHandler(...)`'s RETURN value
// straight to `<DndProvider onDragEnd>`. It is `mock`-prefixed so ts-jest's
// hoisted `jest.mock` factory may close over it: the closure is created at
// mock-registration time but only DEREFERENCED later (at render time), by which
// point this `const` is initialized.
const mockDragEndSentinel = jest.fn();

// The effectful data layer -- replaced wholesale so no load / WebSocket / API
// behavior runs. `useBacklog` is a bare `jest.fn()`; each test drives its return
// value via `makeBacklog(...)`.
jest.mock('../hooks/useBacklog', () => ({
  __esModule: true,
  useBacklog: jest.fn(),
  // BacklogApp ALSO imports these named exports for its Phase 10 URL/localStorage
  // filter persistence; the mock must provide real-shaped values so the
  // persistence effect (writeFiltersToLocation + backlogFiltersStorageKey) runs.
  VALID_QUERY_PARAMS: [
    'exclude_status',
    'status',
    'exclude_tags',
    'tags',
    'exclude_assigned_users',
    'assigned_users',
    'exclude_role',
    'role',
    'exclude_epic',
    'epic',
    'exclude_owner',
    'owner',
  ],
  backlogFiltersStorageKey: (slug: string | undefined) => `${slug ?? ''}:backlog-filters`,
}));

// BacklogTable stub: captures the props BacklogApp passes so the container ->
// table wiring (selection set, showTags/activeFilters flags, onSelectionChange,
// onLoadMore) can be asserted; renders a single marker node.
jest.mock('../components/BacklogTable', () => {
  const react = require('react');
  return {
    __esModule: true,
    BacklogTable: (props: any) => {
      (globalThis as any).__btProps = props;
      return react.createElement('div', { 'data-testid': 'backlog-table' });
    },
  };
});

// SprintList stub: the sprint-management affordances (add / edit / toggle-closed
// / toggle-fold) live in SprintList, so the stub exposes one button per injected
// callback -- letting the test prove each SprintList event routes to the correct
// `useBacklog` action. The edit button forwards the FIRST open sprint (the prop
// BacklogApp feeds it) so the `onEditSprint(sprint)` argument can be asserted.
jest.mock('../components/SprintList', () => {
  const react = require('react');
  return {
    __esModule: true,
    SprintList: (props: any) =>
      react.createElement(
        'div',
        { 'data-testid': 'sprint-list' },
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'add-sprint',
            onClick: () => props.onAddSprint && props.onAddSprint(),
          },
          'add sprint',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'edit-sprint',
            onClick: () =>
              props.onEditSprint && props.onEditSprint(props.openSprints && props.openSprints[0]),
          },
          'edit sprint',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'toggle-closed-sprints',
            onClick: () => props.onToggleClosedSprints && props.onToggleClosedSprints(),
          },
          'toggle closed',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'toggle-sprint-fold',
            onClick: () => props.onToggleSprintFold && props.onToggleSprintFold(55),
          },
          'toggle fold',
        ),
      ),
  };
});

// SprintForm stub: reflects the `open` / `mode` props (so the
// `state.sprintForm.open -> <SprintForm open>` binding is verifiable) AND exposes
// submit / close / delete triggers so the container's serialize-and-delegate
// handlers can be asserted. The submit trigger passes the exact field subset the
// real form emits (`{ name, estimated_start, estimated_finish }`).
jest.mock('../components/SprintForm', () => {
  const react = require('react');
  return {
    __esModule: true,
    SprintForm: (props: any) =>
      react.createElement(
        'div',
        {
          'data-testid': 'sprint-form',
          'data-open': String(!!props.open),
          'data-mode': String(props.mode ?? ''),
          // finding #14: echo the create-mode default-start seed so the container's
          // `lastSprintEndDate = selectLastSprint(state.sprints)?.estimated_finish`
          // wiring is directly assertable. Empty string when null/undefined.
          'data-last-sprint-end-date': String(props.lastSprintEndDate ?? ''),
        },
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'sprint-form-submit',
            onClick: () =>
              props.onSubmit &&
              props.onSubmit({
                name: 'New Sprint',
                estimated_start: '2021-02-01',
                estimated_finish: '2021-02-14',
              }),
          },
          'submit',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'sprint-form-close',
            onClick: () => props.onClose && props.onClose(),
          },
          'close',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'sprint-form-delete',
            onClick: () => props.onDelete && props.onDelete(),
          },
          'delete',
        ),
      ),
  };
});

// ProgressBar stub: BacklogApp renders it inside `.backlog-summary .summary` when
// `state.stats` is present (a disk-only child not called out in the prompt).
jest.mock('../components/ProgressBar', () => {
  const react = require('react');
  return {
    __esModule: true,
    ProgressBar: (props: any) =>
      react.createElement('div', {
        'data-testid': 'progress-bar',
        'data-variant': String(props.variant ?? ''),
      }),
  };
});

// The backlog drag-end factory -- returns the stable sentinel so the test can
// assert (a) it was constructed with the right deps and (b) its return is what
// `<DndProvider onDragEnd>` receives.
jest.mock('../../shared/dnd/sortable', () => ({
  __esModule: true,
  createBacklogDragEndHandler: jest.fn(() => mockDragEndSentinel),
}));

// DndProvider passthrough: records the props it received (`mode`, `onDragEnd`)
// and renders its children so the wrapping topology (backlog body nested inside
// the provider) can be asserted.
jest.mock('../../shared/dnd/DndProvider', () => {
  const react = require('react');
  return {
    __esModule: true,
    DndProvider: (props: any) => {
      (globalThis as any).__dndProps = props;
      return react.createElement(
        'div',
        { 'data-testid': 'dnd-provider', 'data-mode': props.mode },
        props.children,
      );
    },
  };
});

// Defensive: BacklogApp does NOT import this adapter directly (the drag-end
// factory owns it internally), but it is mocked so nothing reachable through the
// module graph can ever hit the real `/api/v1/` HTTP layer if that changes.
jest.mock('../../shared/api/userstories', () => ({
  __esModule: true,
  default: {
    bulkUpdateBacklogOrder: jest.fn(),
    bulkUpdateMilestone: jest.fn(),
    bulkUpdateKanbanOrder: jest.fn(),
    bulkCreate: jest.fn(),
  },
  bulkUpdateBacklogOrder: jest.fn(),
  bulkUpdateMilestone: jest.fn(),
  bulkUpdateKanbanOrder: jest.fn(),
  bulkCreate: jest.fn(),
}));

/* ------------------------------------------------------------------ *
 * Typed mock handles
 * ------------------------------------------------------------------ */

const mockUseBacklog = useBacklog as unknown as jest.Mock;
const mockCreateDragEnd = createBacklogDragEndHandler as unknown as jest.Mock;

/* ------------------------------------------------------------------ *
 * `useBacklog` return-value factory
 * ------------------------------------------------------------------ *
 * `makeBacklog(over)` returns the EXACT `{ state, actions }` shape the real hook
 * exposes (see `useBacklog.ts` -> `UseBacklogResult`) -- NOTE the actions are
 * NESTED under `actions`, they are NOT spread onto the root. `over.state` and
 * `over.actions` shallow-merge onto the defaults so a test can flip a single
 * field (e.g. `activeFilters`) without restating the whole object.
 *
 * The defaults are chosen so the MAXIMAL DOM skeleton renders (a resolved admin
 * project with all permissions, one user story, one open + current sprint, a
 * selection, and a graph placeholder), letting each test then narrow via `over`.
 */
function makeBacklog(over: any = {}): { state: any; actions: any } {
  const state: any = {
    // --- project context ---
    project: {
      id: 7,
      slug: 'proj-slug',
      name: 'Sample Project',
      i_am_admin: true,
      my_permissions: [
        'add_us',
        'modify_us',
        'add_milestone',
        'view_milestones',
        'modify_milestone',
        'delete_milestone',
      ],
      us_statuses: [{ id: 1, name: 'New', color: '#999999' }],
    },
    // --- backlog user stories ---
    userstories: [
      {
        id: 101,
        ref: 5,
        milestone: null,
        project: 7,
        backlog_order: 1,
        sprint_order: 0,
        total_points: 3,
        status: 1,
      },
    ],
    visibleUserStories: [5],
    totalUserStories: 1,
    page: 1,
    disablePagination: false,
    firstLoadComplete: true,
    loadingUserstories: false,
    noSwimlaneUserStories: false,
    backlogOrder: {},
    milestonesOrder: {},
    newUs: [],
    // --- sprints / milestones ---
    sprints: [{ id: 55, name: 'Sprint 1', closed: false, total_points: 0, user_stories: [] }],
    closedSprints: [],
    sprintsById: {},
    closedSprintsById: {},
    sprintsCounter: 1,
    totalMilestones: 1,
    totalOpenMilestones: 1,
    totalClosedMilestones: 0,
    sprintsLoaded: true,
    currentSprint: { id: 55, name: 'Sprint 1', closed: false, total_points: 0, user_stories: [] },
    closedSprintsVisible: false,
    sprintOpen: {},
    // --- stats / forecasting ---
    stats: {
      total_points: 100,
      defined_points: 40,
      closed_points: 10,
      assigned_points: 20,
      speed: 5,
      completedPercentage: 10,
    },
    showGraphPlaceholder: true,
    displayVelocity: false,
    forecastedStories: [],
    forecastNewSprint: true,
    // --- view toggles / filters ---
    showTags: true,
    activeFilters: false,
    filters: { query: '', selected: [], custom: [] },
    // --- multi-select + drag (selectedIds is a number[] ARRAY, per disk) ---
    selectedIds: [101],
    pendingDrag: [],
    // --- sprint add/edit form ---
    sprintForm: {
      open: false,
      mode: 'create',
      values: { project: 7, name: null, estimated_start: null, estimated_finish: null },
      lastSprintName: null,
      canDelete: false,
    },
    ...(over.state || {}),
  };

  const actions: any = {
    // data loading
    loadBacklog: jest.fn(),
    loadProjectStats: jest.fn(),
    loadSprints: jest.fn(),
    loadClosedSprints: jest.fn(),
    unloadClosedSprints: jest.fn(),
    loadUserstories: jest.fn(),
    loadMoreUserstories: jest.fn(),
    // drag move
    applyDrag: jest.fn(),
    reconcileAfterMove: jest.fn(),
    // toolbar move to sprint
    moveToCurrentSprint: jest.fn(),
    moveToLatestSprint: jest.fn(),
    // sprint form
    openSprintForm: jest.fn(),
    closeSprintForm: jest.fn(),
    submitSprintForm: jest.fn(),
    removeSprint: jest.fn(),
    // filters & view toggles
    setFilter: jest.fn(),
    toggleShowTags: jest.fn(),
    toggleClosedSprints: jest.fn(),
    setSelectedIds: jest.fn(),
    toggleSprintFold: jest.fn(),
    toggleActiveFilters: jest.fn(),
    toggleVelocityForecasting: jest.fn(),
    ...(over.actions || {}),
  };

  return { state, actions };
}

/* ------------------------------------------------------------------ *
 * Render helper + shared fixtures
 * ------------------------------------------------------------------ */

const PROJECT_SLUG = 'proj-slug';

function renderApp() {
  return render(<BacklogApp projectSlug={PROJECT_SLUG} />);
}

// The `{ state, actions }` object the hook returns for the CURRENT test. Set in
// `beforeEach` to a fresh default; a test may reassign it (then re-point the
// mock) to drive a specific state before rendering.
let currentBacklog: { state: any; actions: any };

beforeEach(() => {
  // clearAllMocks() resets call data; the jest.config `clearMocks: true` does the
  // same, but doing it explicitly keeps the spec self-describing.
  jest.clearAllMocks();
  currentBacklog = makeBacklog();
  mockUseBacklog.mockReturnValue(currentBacklog);
  // Re-establish the factory implementation so the sentinel is returned every
  // test regardless of the clear/reset config.
  mockCreateDragEnd.mockImplementation(() => mockDragEndSentinel);
  // Clean the prop-capture globals between tests to avoid cross-test leakage.
  delete (globalThis as any).__btProps;
  delete (globalThis as any).__dndProps;
  // Reset the jsdom URL + storage so the Phase 10 filter->URL persistence effect
  // starts from a clean query on every spec and does not leak between tests.
  try {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
  } catch {
    /* jsdom - safe to ignore */
  }
});

/* ------------------------------------------------------------------ *
 * Console hygiene (targeted, non-masking)
 * ------------------------------------------------------------------ *
 * BacklogApp intentionally renders a NON-STANDARD `<sidebar>` element (preserved
 * verbatim so the `.scrum` CSS grid in `app/styles/layout/backlog.scss` applies
 * unchanged -- see the JSX-intrinsic augmentation in BacklogApp.tsx). Under jsdom
 * that emits a benign React dev warning ("The tag <sidebar> is unrecognized in
 * this browser."). Silence ONLY that exact message so the spec output stays
 * clean; every other `console.error` is still forwarded so real problems always
 * surface.
 */
let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
  const originalError = console.error.bind(console);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('unrecognized in this browser')) {
      return;
    }
    originalError(...args);
  });
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

/* ================================================================== *
 * Phase C -- Static skeleton & class flags
 * ================================================================== */

describe('BacklogApp - static skeleton & class flags', () => {
  it('renders div.wrapper > main.main.scrum, a section.backlog (summary + table), and the sidebar as a SIBLING (finding S1)', () => {
    const { container } = renderApp();

    expect(container.querySelector('div.wrapper')).toBeInTheDocument();
    // main.main.scrum is a direct child of the wrapper.
    expect(container.querySelector('div.wrapper > main.main.scrum')).toBeInTheDocument();

    const backlogSection = container.querySelector('section.backlog');
    expect(backlogSection).toBeInTheDocument();
    // The summary + table regions live inside section.backlog (the .scrum grid's first column).
    expect(backlogSection!.querySelector('.backlog-summary')).toBeInTheDocument();
    expect(backlogSection!.querySelector('.backlog-table')).toBeInTheDocument();
    // Finding S1: the non-standard <sidebar> sprint panel is the .scrum grid's SECOND column,
    // so it must be a SIBLING of section.backlog (a direct child of the grid), NOT nested inside
    // it -- nesting it inside collapsed the panel below the table and left the grid's right
    // column empty. In production both are direct children of main.scrum (the real DndProvider
    // adds no DOM wrapper); here the mocked DndProvider wraps them in a single div, so assert the
    // sidebar is OUTSIDE section.backlog and shares section.backlog's parent (they are siblings).
    const sidebar = container.querySelector('sidebar.sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(backlogSection!.querySelector('sidebar.sidebar')).not.toBeInTheDocument();
    expect(sidebar!.parentElement).toBe(backlogSection!.parentElement);
  });

  it('renders the burndown placeholders inside .backlog-summary (graphics-container + empty-burndown)', () => {
    const { container } = renderApp();

    const summary = container.querySelector('.backlog-summary');
    expect(summary).toBeInTheDocument();
    // The always-present burndown host + inner .burndown div.
    expect(summary!.querySelector('.graphics-container.js-burndown-graph')).toBeInTheDocument();
    expect(summary!.querySelector('.graphics-container.js-burndown-graph .burndown')).toBeInTheDocument();
    // .empty-burndown renders only when showGraphPlaceholder && project.i_am_admin
    // (both true in the default fixture) -- adjusted per BacklogApp.tsx on disk.
    expect(summary!.querySelector('.empty-burndown')).toBeInTheDocument();
  });

  it('adds .expanded to .backlog-manager when NOT activeFilters, and removes it when activeFilters', () => {
    const { container, rerender } = renderApp();

    // Default: activeFilters === false -> expanded present.
    expect(container.querySelector('.backlog-manager')).toHaveClass('expanded');

    // Flip activeFilters -> the manager loses .expanded on the next render.
    currentBacklog = makeBacklog({ state: { activeFilters: true } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    rerender(<BacklogApp projectSlug={PROJECT_SLUG} />);

    expect(container.querySelector('.backlog-manager')).not.toHaveClass('expanded');
  });

  it('renders #backlog-filter only when activeFilters is true', () => {
    // adjusted per BacklogApp.tsx on disk: the AngularJS jade always emitted the
    // filter host, but the React container mounts #backlog-filter conditionally
    // (ng-if="activeFilters", backlog.jade:126). Assert BOTH states.
    const { container, rerender } = renderApp();
    expect(container.querySelector('#backlog-filter')).not.toBeInTheDocument();

    currentBacklog = makeBacklog({ state: { activeFilters: true } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    rerender(<BacklogApp projectSlug={PROJECT_SLUG} />);

    expect(container.querySelector('#backlog-filter')).toBeInTheDocument();
  });

  it('always renders the two js-empty-backlog placeholders', () => {
    const { container } = renderApp();
    expect(container.querySelector('.empty-backlog.js-empty-backlog')).toBeInTheDocument();
    expect(container.querySelector('.empty-large.js-empty-backlog')).toBeInTheDocument();
  });

  it('places the child stubs correctly: BacklogTable in section.backlog-table, SprintList in sidebar.sidebar, and SprintForm rendered', () => {
    const { container } = renderApp();

    // BacklogTable lives inside the draggable backlog body (section.backlog-table),
    // NOT inside the top chrome (div.backlog-table).
    const bodySection = container.querySelector('section.backlog-table');
    expect(bodySection).toBeInTheDocument();
    expect(within(bodySection as HTMLElement).getByTestId('backlog-table')).toBeInTheDocument();

    // SprintList (its "add-sprint" affordance) is inside <sidebar class="sidebar">.
    const sidebar = container.querySelector('sidebar.sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(within(sidebar as HTMLElement).getByTestId('add-sprint')).toBeInTheDocument();

    // SprintForm is rendered (outside <main>, a sibling within .wrapper) and
    // reflects the closed default via data-open.
    const form = screen.getByTestId('sprint-form');
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute('data-open', 'false');
  });

  it('reflects state.sprintForm.open on the SprintForm host', () => {
    currentBacklog = makeBacklog({
      state: {
        sprintForm: {
          open: true,
          mode: 'edit',
          values: { project: 7, name: 'Sprint 1', estimated_start: '2021-01-01', estimated_finish: '2021-01-15', id: 55 },
          lastSprintName: null,
          canDelete: true,
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    const form = screen.getByTestId('sprint-form');
    expect(form).toHaveAttribute('data-open', 'true');
    expect(form).toHaveAttribute('data-mode', 'edit');
  });
});

/* ================================================================== *
 * Phase D -- Drag-and-drop wiring (the coexistence DnD contract)
 * ================================================================== */

describe('BacklogApp - DnD wiring', () => {
  it('constructs the backlog drag-end handler exactly once with the right deps, and routes onMove through applyDrag', () => {
    renderApp();

    expect(mockCreateDragEnd).toHaveBeenCalledTimes(1);

    // createBacklogDragEndHandler({ projectId, getSelectedIds, onMove })
    const arg = mockCreateDragEnd.mock.calls[0][0];

    // projectId comes from state.project.id.
    expect(arg.projectId).toBe(7);

    // getSelectedIds() returns the SAME array instance the reducer holds.
    expect(arg.getSelectedIds()).toBe(currentBacklog.state.selectedIds);

    // onMove(result) is the optimistic bridge -> actions.applyDrag(result).
    const dragResult = { movedIds: [101], targetSprintId: null, index: 0 };
    arg.onMove(dragResult);
    expect(currentBacklog.actions.applyDrag).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.applyDrag).toHaveBeenCalledWith(dragResult);
  });

  it('falls back to projectId 0 when there is no resolved project (backlog.state.project?.id ?? 0)', () => {
    // References BacklogApp: `projectId: state.project?.id ?? 0`.
    currentBacklog = makeBacklog({ state: { project: null } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    expect(mockCreateDragEnd).toHaveBeenCalledTimes(1);
    const arg = mockCreateDragEnd.mock.calls[0][0];
    expect(arg.projectId).toBe(0);
  });

  it('wraps the backlog body in <DndProvider mode="backlog"> and passes the handler as onDragEnd', () => {
    renderApp();

    const provider = screen.getByTestId('dnd-provider');
    expect(provider).toHaveAttribute('data-mode', 'backlog');

    // The onDragEnd prop is exactly the factory's return (the sentinel handler).
    expect((globalThis as any).__dndProps.onDragEnd).toBe(mockDragEndSentinel);

    // The backlog body (BacklogTable) is a descendant of the provider, proving
    // React owns drag INSIDE the element.
    expect(within(provider).getByTestId('backlog-table')).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Phase E -- Toolbar -> hook-action wiring
 * ================================================================== */

describe('BacklogApp - toolbar -> hook-action wiring', () => {
  it('#show-tags input change calls toggleShowTags once', () => {
    const { container } = renderApp();
    // The onChange lives on the inner checkbox (#show-tags-input), mirroring the
    // AngularJS `#show-tags > input` change handler (main.coffee:872-877).
    const checkbox = container.querySelector('#show-tags-input');
    expect(checkbox).toBeInTheDocument();

    fireEvent.click(checkbox as HTMLElement);
    expect(currentBacklog.actions.toggleShowTags).toHaveBeenCalledTimes(1);
  });

  it('#move-to-current-sprint click calls moveToCurrentSprint with the current selection', () => {
    // currentSprint is truthy in the default fixture -> #move-to-current-sprint renders.
    const { container } = renderApp();
    const btn = container.querySelector('#move-to-current-sprint');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn as HTMLElement);
    expect(currentBacklog.actions.moveToCurrentSprint).toHaveBeenCalledTimes(1);
    // The wired argument is state.selectedIds (the number[] selection).
    expect(currentBacklog.actions.moveToCurrentSprint).toHaveBeenCalledWith(currentBacklog.state.selectedIds);
  });

  it('#move-to-latest-sprint click calls moveToLatestSprint with the current selection', () => {
    // With no currentSprint, BacklogApp renders #move-to-latest-sprint instead.
    currentBacklog = makeBacklog({ state: { currentSprint: null } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    const btn = container.querySelector('#move-to-latest-sprint');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn as HTMLElement);
    expect(currentBacklog.actions.moveToLatestSprint).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.moveToLatestSprint).toHaveBeenCalledWith(currentBacklog.state.selectedIds);
  });

  it('#show-filters-button click toggles the active filters (toggleActiveFilters)', () => {
    const { container } = renderApp();
    const btn = container.querySelector('#show-filters-button');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn as HTMLElement);
    expect(currentBacklog.actions.toggleActiveFilters).toHaveBeenCalledTimes(1);
  });

  it('SprintList add trigger opens the sprint form in create mode', () => {
    // add-sprint opens the sprint form in create mode.
    renderApp();
    fireEvent.click(screen.getByTestId('add-sprint'));
    expect(currentBacklog.actions.openSprintForm).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.openSprintForm).toHaveBeenCalledWith('create');
  });

  it('passes the derived state props to BacklogTable and wires its selection/pagination callbacks', () => {
    renderApp();

    const bt = (globalThis as any).__btProps;
    expect(bt).toBeTruthy();

    // selectedIds is bridged from the number[] reducer state into a ReadonlySet.
    expect(bt.selectedIds instanceof Set).toBe(true);
    expect(bt.selectedIds.has(101)).toBe(true);

    // Flags derived from state.
    expect(bt.showTags).toBe(true);
    expect(bt.activeFilters).toBe(false);
    expect(bt.canModifyUs).toBe(true); // modify_us is in my_permissions

    // onSelectionChange(next: Set) -> actions.setSelectedIds(Array.from(next)).
    bt.onSelectionChange(new Set([102, 103]));
    expect(currentBacklog.actions.setSelectedIds).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.setSelectedIds).toHaveBeenCalledWith([102, 103]);

    // onLoadMore() -> actions.loadMoreUserstories().
    bt.onLoadMore();
    expect(currentBacklog.actions.loadMoreUserstories).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================== *
 * Phase E (cont.) -- Sidebar / sprint-form -> hook-action wiring
 * ================================================================== */

describe('BacklogApp - sidebar & sprint-form wiring', () => {
  it('SprintList edit trigger opens the sprint form in edit mode with the selected sprint', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('edit-sprint'));
    expect(currentBacklog.actions.openSprintForm).toHaveBeenCalledTimes(1);
    // handleEditSprint(sprint) -> actions.openSprintForm('edit', sprint); the stub
    // forwards openSprints[0], i.e. state.sprints[0].
    expect(currentBacklog.actions.openSprintForm).toHaveBeenCalledWith('edit', currentBacklog.state.sprints[0]);
  });

  it('SprintList toggle-closed trigger calls toggleClosedSprints', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('toggle-closed-sprints'));
    expect(currentBacklog.actions.toggleClosedSprints).toHaveBeenCalledTimes(1);
  });

  it('SprintList toggle-fold trigger calls toggleSprintFold with the sprint id', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('toggle-sprint-fold'));
    expect(currentBacklog.actions.toggleSprintFold).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.toggleSprintFold).toHaveBeenCalledWith(55);
  });

  it('SprintForm submit serializes the fields and delegates to submitSprintForm (create mode)', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('sprint-form-submit'));
    expect(currentBacklog.actions.submitSprintForm).toHaveBeenCalledTimes(1);
    // handleSubmitSprintForm builds SprintFormValues { project, name, dates, id } and
    // passes (values, mode, editingId). Default is create mode with no editingId.
    expect(currentBacklog.actions.submitSprintForm).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 7,
        name: 'New Sprint',
        estimated_start: '2021-02-01',
        estimated_finish: '2021-02-14',
      }),
      'create',
      undefined,
    );
  });

  it('SprintForm close trigger calls closeSprintForm', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('sprint-form-close'));
    expect(currentBacklog.actions.closeSprintForm).toHaveBeenCalledTimes(1);
  });

  it('SprintForm delete trigger OPENS the confirm dialog (does NOT delete synchronously) — finding #13', () => {
    // finding #13: the legacy `.delete-sprint` click first ran the blocking
    // `$confirm.askOnDelete(DELETE_SPRINT.TITLE, sprint.name)` gate
    // (lightboxes.coffee:103-118, 225-227). The React delete button must therefore
    // OPEN a confirmation dialog rather than issue DELETE /milestones/{id} at once.
    currentBacklog = makeBacklog({
      state: {
        sprintForm: {
          open: true,
          mode: 'edit',
          values: {
            project: 7,
            name: 'Sprint 1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
            id: 55,
          },
          lastSprintName: null,
          canDelete: true,
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    // Precondition: no confirm dialog yet.
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sprint-form-delete'));

    // The confirm dialog is now open and names the sprint; removeSprint has NOT fired.
    const dialog = container.querySelector('.lightbox-confirm-delete-sprint');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Delete sprint');
    expect(dialog).toHaveTextContent('Are you sure you want to delete "Sprint 1"?');
    expect(currentBacklog.actions.removeSprint).not.toHaveBeenCalled();
  });

  it('the velocity-forecasting toggle calls toggleVelocityForecasting', () => {
    // Default fixture (userstories present, displayVelocity false, stats.speed > 0,
    // add_milestone permission) renders the forecasting toggle button.
    const { container } = renderApp();
    const velocityBtn = container.querySelector('.velocity-forecasting-btn');
    expect(velocityBtn).toBeInTheDocument();

    fireEvent.click(velocityBtn as HTMLElement);
    expect(currentBacklog.actions.toggleVelocityForecasting).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================== *
 * Phase E (cont.) -- Sprint delete confirmation (#13) + create-sprint
 *                    default start date (#14)
 * ================================================================== *
 * #13: legacy `.delete-sprint` first ran the blocking
 *   `$confirm.askOnDelete(DELETE_SPRINT.TITLE, sprint.name)` gate
 *   (lightboxes.coffee:103-118, 225-227); only on confirmation did it call
 *   `$repo.remove(sprint)`. The React screen must reproduce that blocking gate:
 *   delete OPENS `.lightbox-confirm-delete-sprint`; Cancel dismisses with no
 *   side effect (edit form stays open); Delete calls `actions.removeSprint(id)`.
 * #14: legacy `getLastSprint` seeded the create form start to the last OPEN
 *   sprint's `estimated_finish` (lightboxes.coffee:120-160). The container wires
 *   `lastSprintEndDate = selectLastSprint(state.sprints)?.estimated_finish` into
 *   <SprintForm>; the mock echoes it as `data-last-sprint-end-date`.
 * ================================================================== */

// Edit-mode fixture: sprint-form open on an existing sprint (id 55) with delete
// permission, so the SprintForm delete trigger is meaningful.
function editingSprintBacklog(over: any = {}) {
  return makeBacklog({
    ...over,
    state: {
      sprintForm: {
        open: true,
        mode: 'edit',
        values: {
          project: 7,
          name: 'Sprint 1',
          estimated_start: '2021-01-01',
          estimated_finish: '2021-01-15',
          id: 55,
        },
        lastSprintName: null,
        canDelete: true,
      },
      ...(over.state || {}),
    },
  });
}

describe('BacklogApp - sprint delete confirmation (finding #13)', () => {
  it('Cancel in the confirm dialog dismisses it WITHOUT calling removeSprint (edit form stays open)', () => {
    currentBacklog = editingSprintBacklog();
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    // Open the confirm dialog.
    fireEvent.click(screen.getByTestId('sprint-form-delete'));
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).toBeInTheDocument();

    // Cancel.
    fireEvent.click(container.querySelector('.lightbox-confirm-delete-sprint .e2e-cancel') as HTMLElement);

    // Dialog gone; removeSprint never fired; the edit form is still mounted.
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).not.toBeInTheDocument();
    expect(currentBacklog.actions.removeSprint).not.toHaveBeenCalled();
    expect(screen.getByTestId('sprint-form')).toHaveAttribute('data-open', 'true');
  });

  it('Delete in the confirm dialog calls removeSprint(id) once and dismisses the dialog', () => {
    currentBacklog = editingSprintBacklog();
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByTestId('sprint-form-delete'));
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).toBeInTheDocument();

    // Confirm the delete.
    fireEvent.click(container.querySelector('.lightbox-confirm-delete-sprint .e2e-delete') as HTMLElement);

    expect(currentBacklog.actions.removeSprint).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.removeSprint).toHaveBeenCalledWith(55);
    // Dialog is dismissed once the delete is dispatched.
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).not.toBeInTheDocument();
  });

  it('the confirm dialog falls back to "this sprint" when the sprint has no name', () => {
    currentBacklog = editingSprintBacklog({
      state: {
        sprintForm: {
          open: true,
          mode: 'edit',
          values: {
            project: 7,
            name: null,
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
            id: 55,
          },
          lastSprintName: null,
          canDelete: true,
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByTestId('sprint-form-delete'));
    const dialog = container.querySelector('.lightbox-confirm-delete-sprint');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Are you sure you want to delete this sprint?');
  });

  it('delete is a no-op when there is no sprint id (create mode / unsaved)', () => {
    // Default fixture: sprintForm is create-mode with values.id undefined.
    currentBacklog = makeBacklog({
      state: {
        sprintForm: {
          open: true,
          mode: 'create',
          values: {
            project: 7,
            name: 'Draft',
            estimated_start: null,
            estimated_finish: null,
            // no id
          },
          lastSprintName: null,
          canDelete: true,
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByTestId('sprint-form-delete'));

    // No id -> handleDeleteSprint does nothing: no dialog, no removeSprint.
    expect(container.querySelector('.lightbox-confirm-delete-sprint')).not.toBeInTheDocument();
    expect(currentBacklog.actions.removeSprint).not.toHaveBeenCalled();
  });
});

describe('BacklogApp - create-sprint default start date (finding #14)', () => {
  it('threads lastSprintEndDate = the last OPEN sprint\u2019s estimated_finish into <SprintForm>', () => {
    currentBacklog = makeBacklog({
      state: {
        sprints: [
          {
            id: 70,
            name: 'Sprint 2',
            closed: false,
            total_points: 0,
            user_stories: [],
            estimated_finish: '2021-03-15',
          },
        ],
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    expect(screen.getByTestId('sprint-form')).toHaveAttribute(
      'data-last-sprint-end-date',
      '2021-03-15',
    );
  });

  it('ignores CLOSED sprints when resolving the last sprint end date', () => {
    currentBacklog = makeBacklog({
      state: {
        sprints: [
          {
            id: 70,
            name: 'Open',
            closed: false,
            total_points: 0,
            user_stories: [],
            estimated_finish: '2021-03-15',
          },
          {
            id: 71,
            name: 'Closed later',
            closed: true,
            total_points: 0,
            user_stories: [],
            estimated_finish: '2021-09-15',
          },
        ],
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    // selectLastSprint filters out the (later-finishing) closed sprint.
    expect(screen.getByTestId('sprint-form')).toHaveAttribute(
      'data-last-sprint-end-date',
      '2021-03-15',
    );
  });

  it('passes an empty last-sprint-end-date when no open sprint carries a finish date', () => {
    // Default fixture sprint has no estimated_finish -> selectLastSprint(...)?.estimated_finish
    // is undefined -> `?? null` -> the mock echoes ''.
    renderApp();
    expect(screen.getByTestId('sprint-form')).toHaveAttribute('data-last-sprint-end-date', '');
  });
});

/* ================================================================== *
 * Phase E (cont.) -- Derived prop builders handed to children
 * ================================================================== */

describe('BacklogApp - derived prop builders', () => {
  it('supplies BacklogTable working URL / status / points helpers derived from the resolved project', () => {
    renderApp();
    const bt = (globalThis as any).__btProps;
    const us = currentBacklog.state.userstories[0];

    // buildUserStoryUrl -> /project/{slug}/us/{ref} (resolved slug wins).
    expect(bt.buildUserStoryUrl(us)).toBe('/project/proj-slug/us/5');
    // getStatusName / getStatusColor read the us_statuses lookup (id 1 -> New/#999999).
    expect(bt.getStatusName(us)).toBe('New');
    expect(bt.getStatusColor(us)).toBe('#999999');
    // getPointsLabel stringifies total_points.
    expect(bt.getPointsLabel(us)).toBe('3');
  });

  it('serializes an edit-mode sprint submit with the editing id', () => {
    currentBacklog = makeBacklog({
      state: {
        sprintForm: {
          open: true,
          mode: 'edit',
          values: {
            project: 7,
            name: 'Sprint 1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
            id: 55,
          },
          lastSprintName: null,
          canDelete: true,
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    fireEvent.click(screen.getByTestId('sprint-form-submit'));
    // Edit mode threads the editing id into both the values and the editingId arg.
    expect(currentBacklog.actions.submitSprintForm).toHaveBeenCalledWith(
      expect.objectContaining({ project: 7, name: 'New Sprint', id: 55 }),
      'edit',
      55,
    );
  });
});

/* ================================================================== *
 * Phase F -- Mount data load (ownership check)
 * ================================================================== */

describe('BacklogApp - mount data load', () => {
  it('does NOT trigger any data-loading action on mount (loading is owned by the auto-loading hook)', () => {
    // Per BacklogApp.tsx on disk, the container has NO mount-load useEffect (its
    // only effect is a debounce-cleanup on unmount); `useBacklog` auto-loads the
    // project/stats/sprints/first US page on mount. So the container itself must
    // never invoke a load action -- Phase F "mount data load" is therefore an
    // ownership assertion rather than a call assertion.
    renderApp();

    expect(currentBacklog.actions.loadBacklog).not.toHaveBeenCalled();
    expect(currentBacklog.actions.loadUserstories).not.toHaveBeenCalled();
    expect(currentBacklog.actions.loadSprints).not.toHaveBeenCalled();
    expect(currentBacklog.actions.loadProjectStats).not.toHaveBeenCalled();
    expect(currentBacklog.actions.loadMoreUserstories).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Finding #12 -- inline row controls: reference-data derivation,
 * handler threading, and the blocking delete-confirm lightbox.
 * ------------------------------------------------------------------ *
 * The BacklogTable stub records the props it receives on
 * `globalThis.__btProps`, so these specs prove BacklogApp (a) derives the
 * status / points / roles reference data + `canDeleteUs` gate from
 * `state.project`, (b) threads the five inline-control actions straight
 * through to the table, and (c) owns the Delete flow itself -- opening a
 * blocking `.lightbox-confirm-delete-us` confirm on `onDeleteStory`, calling
 * `actions.deleteUserStory` only on confirm, and dismissing on cancel. */
describe('BacklogApp - inline row controls (finding #12)', () => {
  // Project fixture carrying the estimation reference data + `delete_us`
  // permission the inline controls need (the default `makeBacklog` project
  // deliberately omits points/roles/delete_us to keep the baseline inert).
  function makeRichProject() {
    return {
      id: 7,
      slug: 'proj-slug',
      name: 'Sample Project',
      i_am_admin: true,
      my_permissions: ['add_us', 'modify_us', 'delete_us'],
      us_statuses: [
        { id: 1, name: 'New', color: '#999999' },
        { id: 2, name: 'Ready', color: '#E44057' },
      ],
      points: [
        { id: 25, name: '?', value: null },
        { id: 28, name: '1', value: 1 },
      ],
      roles: [
        { id: 13, name: 'UX', computable: true },
        { id: 17, name: 'PO', computable: false },
      ],
    };
  }

  it('derives status/points/roles reference data + canDeleteUs and threads the five inline actions to BacklogTable', () => {
    const changeUsStatus = jest.fn();
    const changeUsPoints = jest.fn();
    const moveUsToTop = jest.fn();
    const setPointsViewRole = jest.fn();
    const deleteUserStory = jest.fn();
    currentBacklog = makeBacklog({
      state: { project: makeRichProject(), pointsViewRoleId: 13 },
      actions: {
        changeUsStatus,
        changeUsPoints,
        moveUsToTop,
        setPointsViewRole,
        deleteUserStory,
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    const p = (globalThis as any).__btProps;
    // Reference data derived verbatim from state.project.
    expect(p.statuses).toEqual([
      { id: 1, name: 'New', color: '#999999' },
      { id: 2, name: 'Ready', color: '#E44057' },
    ]);
    expect(p.points).toEqual([
      { id: 25, name: '?', value: null },
      { id: 28, name: '1', value: 1 },
    ]);
    expect(p.roles).toEqual([
      { id: 13, name: 'UX', computable: true },
      { id: 17, name: 'PO', computable: false },
    ]);
    // Header points-per-role selection + delete gate.
    expect(p.pointsViewRoleId).toBe(13);
    expect(p.canDeleteUs).toBe(true);
    // The three "pure" inline actions are threaded straight through.
    expect(p.onChangeStatus).toBe(changeUsStatus);
    expect(p.onChangePoints).toBe(changeUsPoints);
    expect(p.onMoveToTop).toBe(moveUsToTop);
    expect(p.onSelectRoleView).toBe(setPointsViewRole);
    // Edit + Delete are container-owned wrappers (navigation / confirm), NOT the
    // raw actions -- so they must be functions distinct from deleteUserStory.
    expect(typeof p.onEditStory).toBe('function');
    expect(typeof p.onDeleteStory).toBe('function');
    expect(p.onDeleteStory).not.toBe(deleteUserStory);
  });

  it('sets canDeleteUs=false when the project lacks the delete_us permission', () => {
    // The default makeBacklog project has modify_us but NOT delete_us.
    renderApp();
    expect((globalThis as any).__btProps.canDeleteUs).toBe(false);
  });

  it('returns empty points/roles reference data when the project omits them', () => {
    // Default project has us_statuses but no points/roles keys.
    renderApp();
    const p = (globalThis as any).__btProps;
    expect(p.points).toEqual([]);
    expect(p.roles).toEqual([]);
    // us_statuses is still mapped (single "New" status).
    expect(p.statuses).toEqual([{ id: 1, name: 'New', color: '#999999' }]);
  });

  it('onDeleteStory opens a blocking confirm lightbox naming the story; deleteUserStory is NOT called until confirmed', () => {
    const deleteUserStory = jest.fn();
    currentBacklog = makeBacklog({
      state: { project: makeRichProject() },
      actions: { deleteUserStory },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    // No dialog on first render.
    expect(container.querySelector('.lightbox-confirm-delete-us')).toBeNull();

    const us = { id: 101, ref: 5, subject: 'My story', status: 1 };
    // The row would invoke the captured onDeleteStory; this is an out-of-event
    // state update, so wrap in act().
    act(() => {
      (globalThis as any).__btProps.onDeleteStory(us);
    });

    const dialog = container.querySelector('.lightbox-confirm-delete-us');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('lightbox', 'lightbox-generic-form', 'open');
    // The confirm names the specific story (blocking askOnDelete parity).
    expect(dialog).toHaveTextContent('My story');
    // Blocking: nothing deleted yet.
    expect(deleteUserStory).not.toHaveBeenCalled();
  });

  it('confirming the delete lightbox calls actions.deleteUserStory with the target story and dismisses the dialog', () => {
    const deleteUserStory = jest.fn();
    currentBacklog = makeBacklog({
      state: { project: makeRichProject() },
      actions: { deleteUserStory },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    const us = { id: 101, ref: 5, subject: 'Doomed story', status: 1 };
    act(() => {
      (globalThis as any).__btProps.onDeleteStory(us);
    });

    fireEvent.click(container.querySelector('.lightbox-confirm-delete-us .e2e-delete') as HTMLElement);

    expect(deleteUserStory).toHaveBeenCalledTimes(1);
    expect(deleteUserStory).toHaveBeenCalledWith(us);
    // Dialog dismissed after confirming.
    expect(container.querySelector('.lightbox-confirm-delete-us')).toBeNull();
  });

  it('cancelling the delete lightbox dismisses it WITHOUT calling deleteUserStory', () => {
    const deleteUserStory = jest.fn();
    currentBacklog = makeBacklog({
      state: { project: makeRichProject() },
      actions: { deleteUserStory },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    act(() => {
      (globalThis as any).__btProps.onDeleteStory({ id: 101, ref: 5, subject: 'Spared', status: 1 });
    });
    expect(container.querySelector('.lightbox-confirm-delete-us')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.lightbox-confirm-delete-us .e2e-cancel') as HTMLElement);

    expect(deleteUserStory).not.toHaveBeenCalled();
    expect(container.querySelector('.lightbox-confirm-delete-us')).toBeNull();
  });

  it('uses a generic confirm message when the story has no subject', () => {
    currentBacklog = makeBacklog({
      state: { project: makeRichProject() },
      actions: { deleteUserStory: jest.fn() },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    act(() => {
      (globalThis as any).__btProps.onDeleteStory({ id: 101, ref: 5, status: 1 });
    });

    const dialog = container.querySelector('.lightbox-confirm-delete-us');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('this user story');
  });
});

/* ================================================================== *
 * Add-user-story wiring (finding #16)
 * ------------------------------------------------------------------ *
 * The header "+ Add" button, the bulk-add icon, and the empty-state
 * "Create your first user story" button open an add-story lightbox
 * (single-subject input or bulk textarea) whose submit delegates to the
 * hook's `addStoryStandard` / `addStoryBulk` actions. A double-submit
 * guard ensures one submit yields exactly one create call.
 * ================================================================== */

/** A promise plus its resolver, so a test can hold a create in flight. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('BacklogApp - add user story (finding #16)', () => {
  it('opens the single-subject lightbox from the header "+ Add" button and creates on submit', async () => {
    const addStoryStandard = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    // No lightbox until the header button is pressed.
    expect(container.querySelector('.lightbox-add-story')).toBeNull();

    fireEvent.click(screen.getByLabelText('Add user story'));

    const lightbox = container.querySelector('.lightbox-add-story');
    expect(lightbox).toBeInTheDocument();
    const input = container.querySelector('.e2e-add-story-subject') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '  A brand new story  ' } });
    // Submit resolves the create promise, whose `.finally` closes the lightbox on
    // a microtask -> flush it inside act() so the async close is captured.
    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-add-story .e2e-create') as HTMLElement);
    });

    // Trimmed subject forwarded to the hook; bulk untouched.
    expect(addStoryStandard).toHaveBeenCalledTimes(1);
    expect(addStoryStandard).toHaveBeenCalledWith('A brand new story');
    // Lightbox closed after a successful create.
    expect(container.querySelector('.lightbox-add-story')).toBeNull();
  });

  it('submits the single-subject lightbox on Enter', async () => {
    const addStoryStandard = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByLabelText('Add user story'));
    const input = container.querySelector('.e2e-add-story-subject') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Enter-submitted story' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(addStoryStandard).toHaveBeenCalledWith('Enter-submitted story');
  });

  it('opens the bulk lightbox from the bulk icon and bulk-creates on submit', async () => {
    const addStoryBulk = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryBulk } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByLabelText('Add user stories in bulk'));

    const lightbox = container.querySelector('.lightbox-add-story-bulk');
    expect(lightbox).toBeInTheDocument();
    const textarea = container.querySelector('.e2e-add-story-bulk') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'Story A\nStory B\nStory C' } });
    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-add-story-bulk .e2e-create') as HTMLElement);
    });

    expect(addStoryBulk).toHaveBeenCalledTimes(1);
    expect(addStoryBulk).toHaveBeenCalledWith('Story A\nStory B\nStory C');
  });

  it('Cancel dismisses the lightbox without creating anything', () => {
    const addStoryStandard = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByLabelText('Add user story'));
    expect(container.querySelector('.lightbox-add-story')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.lightbox-add-story .e2e-cancel') as HTMLElement);

    expect(container.querySelector('.lightbox-add-story')).toBeNull();
    expect(addStoryStandard).not.toHaveBeenCalled();
  });

  it('a blank subject closes the lightbox and does not call the create action', () => {
    const addStoryStandard = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByLabelText('Add user story'));
    const input = container.querySelector('.e2e-add-story-subject') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '     ' } });
    fireEvent.click(container.querySelector('.lightbox-add-story .e2e-create') as HTMLElement);

    expect(addStoryStandard).not.toHaveBeenCalled();
    expect(container.querySelector('.lightbox-add-story')).toBeNull();
  });

  it('guards against double submit: two rapid Create clicks yield exactly one create call', async () => {
    const gate = deferred();
    const addStoryStandard = jest.fn(() => gate.promise);
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByLabelText('Add user story'));
    const input = container.querySelector('.e2e-add-story-subject') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Only once' } });

    const createBtn = container.querySelector('.lightbox-add-story .e2e-create') as HTMLElement;
    // First click starts the (still-pending) create; second click must be ignored
    // because the in-flight guard is set.
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);
    expect(addStoryStandard).toHaveBeenCalledTimes(1);

    // Resolve the in-flight create -> guard clears and the lightbox closes.
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(container.querySelector('.lightbox-add-story')).toBeNull();
  });

  it('opens the single-subject lightbox from the empty-state "Create your first user story" button', async () => {
    const addStoryStandard = jest.fn(() => Promise.resolve());
    currentBacklog = makeBacklog({ actions: { addStoryStandard } });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();

    fireEvent.click(screen.getByTitle('Create new user story'));

    expect(container.querySelector('.lightbox-add-story')).toBeInTheDocument();
    const input = container.querySelector('.e2e-add-story-subject') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'First story' } });
    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-add-story .e2e-create') as HTMLElement);
    });

    expect(addStoryStandard).toHaveBeenCalledWith('First story');
  });

  it('does not render the add-story buttons when the user lacks add_us permission', () => {
    currentBacklog = makeBacklog({
      state: {
        project: {
          ...makeBacklog().state.project,
          my_permissions: ['view_us', 'view_milestones'],
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    renderApp();

    expect(screen.queryByLabelText('Add user story')).toBeNull();
    expect(screen.queryByLabelText('Add user stories in bulk')).toBeNull();
    expect(screen.queryByTitle('Create new user story')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- *
 * Burndown chart — toggle wiring + real SVG rendering (finding #1)            *
 * -------------------------------------------------------------------------- *
 * The default fixture (makeBacklog) sets `showGraphPlaceholder: true` and a   *
 * `stats` object WITHOUT `milestones`, so the toggle button is hidden and the *
 * chart collapses (empty-burndown placeholder path). These specs use a        *
 * NON-placeholder variant (`showGraphPlaceholder: false` + `stats.milestones`)*
 * so the toggle button renders and <Burndown> can draw the real inline-SVG    *
 * chart. localStorage is cleared before each spec so the persisted collapse   *
 * flag starts from a known (expanded) state.                                  */
describe('BacklogApp — burndown chart (finding #1)', () => {
  const statsWithMilestones = {
    total_points: 806,
    defined_points: 1206.5,
    closed_points: 35,
    assigned_points: 200,
    speed: 0,
    total_milestones: 3,
    completedPercentage: 4,
    milestones: [
      { name: 'Sprint A', optimal: 806, evolution: 806, 'team-increment': 0, 'client-increment': 0 },
      { name: 'Sprint B', optimal: 400, evolution: 771, 'team-increment': 10, 'client-increment': 5 },
      { name: 'Sprint C', optimal: 0, evolution: null, 'team-increment': 0, 'client-increment': 0 },
    ],
  };

  function renderWithChart(): ReturnType<typeof renderApp> {
    try {
      window.localStorage.clear();
    } catch {
      /* jsdom storage always present; guard for safety */
    }
    currentBacklog = makeBacklog({
      state: { showGraphPlaceholder: false, stats: statsWithMilestones },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    return renderApp();
  }

  it('renders a real <svg> burndown chart inside .burndown when milestone data is present', () => {
    const { container } = renderWithChart();
    const host = container.querySelector('.burndown');
    expect(host).toBeInTheDocument();
    const chart = host!.querySelector('[data-testid="burndown-chart"]');
    expect(chart).toBeInTheDocument();
    expect(chart!.tagName.toLowerCase()).toBe('svg');
    // Four VISIBLE series groups (the invisible zero-baseline series 0 is omitted).
    expect(container.querySelectorAll('g[data-series-index]')).toHaveLength(4);
    // At least one plotted point circle is present.
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('shows the chart by default (.shown container + .active button) and wires the toggle', () => {
    const { container } = renderWithChart();
    const gc = container.querySelector('.graphics-container.js-burndown-graph');
    const btn = container.querySelector('.js-toggle-burndown-visibility-button');
    expect(gc).toBeInTheDocument();
    expect(btn).toBeInTheDocument();
    expect(gc).toHaveClass('shown');
    expect(btn).toHaveClass('active');
  });

  it('clicking the toggle HIDES the chart and persists the collapse flag', () => {
    const { container } = renderWithChart();
    const btn = container.querySelector('.js-toggle-burndown-visibility-button')!;
    act(() => {
      fireEvent.click(btn);
    });
    const gc = container.querySelector('.graphics-container.js-burndown-graph')!;
    expect(gc).not.toHaveClass('shown');
    expect(gc).not.toHaveClass('open');
    expect(
      container.querySelector('.js-toggle-burndown-visibility-button'),
    ).not.toHaveClass('active');
    // The collapse flag is persisted under the legacy (typo-preserved) key.
    expect(window.localStorage.getItem('is-burndown-grpahs-collapsed')).toBe('true');
  });

  it('toggling twice RE-SHOWS the chart with .open (animated reveal) + .active button', () => {
    const { container } = renderWithChart();
    act(() => {
      fireEvent.click(container.querySelector('.js-toggle-burndown-visibility-button')!);
    }); // hide
    act(() => {
      fireEvent.click(container.querySelector('.js-toggle-burndown-visibility-button')!);
    }); // re-show
    const gc = container.querySelector('.graphics-container.js-burndown-graph')!;
    expect(gc).toHaveClass('open');
    expect(gc).not.toHaveClass('shown');
    expect(
      container.querySelector('.js-toggle-burndown-visibility-button'),
    ).toHaveClass('active');
    expect(window.localStorage.getItem('is-burndown-grpahs-collapsed')).toBe('false');
  });

  it('does not render the toggle button when showGraphPlaceholder is true (placeholder path)', () => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
    currentBacklog = makeBacklog({
      state: { showGraphPlaceholder: true, stats: statsWithMilestones },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);
    const { container } = renderApp();
    expect(
      container.querySelector('.js-toggle-burndown-visibility-button'),
    ).toBeNull();
  });
});


/* ------------------------------------------------------------------ *
 * Phase 10 — filter persistence to the URL (location.search)
 * ------------------------------------------------------------------ *
 * Proves BacklogApp's persistence effect mirrors the reducer filter model to the
 * URL (via history.replaceState) AND to per-project localStorage, and that chips
 * restored from the URL with placeholder (id) names are reconciled to their
 * labels once `filters_data` resolves — fixing the tracked MINOR deviation.
 */
describe('BacklogApp — Phase 10: filter persistence to the URL', () => {
  it('writes the applied filters from reducer state to window.location.search on mount', () => {
    currentBacklog = makeBacklog({
      state: {
        filters: {
          query: '',
          selected: [{ id: '1', name: 'New', dataType: 'status', mode: 'include', color: null }],
          custom: [],
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);

    renderApp();

    expect(window.location.search).toBe('?status=1');
  });

  it('writes the free-text query to the URL as q', () => {
    currentBacklog = makeBacklog({
      state: { filters: { query: 'needle', selected: [], custom: [] } },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);

    renderApp();

    expect(window.location.search).toBe('?q=needle');
  });

  it('mirrors the applied filters to per-project localStorage', () => {
    currentBacklog = makeBacklog({
      state: {
        // resolvedSlug falls back to the prop `proj-slug` when project.slug matches.
        filters: {
          query: '',
          selected: [{ id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude', color: null }],
          custom: [],
        },
      },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);

    renderApp();

    const stored = window.localStorage.getItem('proj-slug:backlog-filters');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual([
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude', color: null },
    ]);
    // and the URL carries the exclude form
    expect(window.location.search).toBe('?exclude_tags=foo');
  });

  it('clears the managed query when there are no filters', () => {
    window.history.replaceState(null, '', '/project/proj-slug/backlog?status=99&page=2');
    currentBacklog = makeBacklog({
      state: { filters: { query: '', selected: [], custom: [] } },
    });
    mockUseBacklog.mockReturnValue(currentBacklog);

    renderApp();

    // status (managed) removed; page (unrelated) preserved.
    expect(window.location.search).toBe('?page=2');
  });

  it('reconciles a URL-restored chip name against filters_data (id -> label)', () => {
    currentBacklog = makeBacklog({
      state: {
        activeFilters: true, // renders the FilterBar sidebar
        filters: {
          query: '',
          // placeholder (id) name, as produced by a URL restore before data loads
          selected: [{ id: '1', name: '1', dataType: 'status', mode: 'include', color: null }],
          custom: [],
        },
      },
    });
    // Provide filters_data so filterCategories resolves the id -> 'New' label.
    mockUseBacklog.mockReturnValue({
      ...currentBacklog,
      filtersData: {
        statuses: [{ id: 1, name: 'New', color: '#aaa', count: 2 }],
        tags: [],
        assigned_users: [],
        roles: [],
        owners: [],
        epics: [],
      },
    });

    const { container } = renderApp();

    const chip = container.querySelector('.single-applied-filter .name');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('New');
  });
});
