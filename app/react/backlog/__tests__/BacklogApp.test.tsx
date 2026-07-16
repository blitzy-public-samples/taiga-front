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

import { render, screen, fireEvent, within } from '@testing-library/react';

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
  it('renders div.wrapper > main.main.scrum and a section.backlog with the summary, table and sidebar', () => {
    const { container } = renderApp();

    expect(container.querySelector('div.wrapper')).toBeInTheDocument();
    // main.main.scrum is a direct child of the wrapper.
    expect(container.querySelector('div.wrapper > main.main.scrum')).toBeInTheDocument();

    const backlogSection = container.querySelector('section.backlog');
    expect(backlogSection).toBeInTheDocument();
    // The three structural regions of the scrum screen live inside section.backlog.
    expect(backlogSection!.querySelector('.backlog-summary')).toBeInTheDocument();
    expect(backlogSection!.querySelector('.backlog-table')).toBeInTheDocument();
    // The non-standard <sidebar> tag is preserved verbatim for the .scrum grid.
    expect(backlogSection!.querySelector('sidebar.sidebar')).toBeInTheDocument();
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

  it('SprintForm delete trigger removes the sprint being edited (edit mode with an id)', () => {
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

    fireEvent.click(screen.getByTestId('sprint-form-delete'));
    // handleDeleteSprint reads state.sprintForm.values.id and removes it.
    expect(currentBacklog.actions.removeSprint).toHaveBeenCalledTimes(1);
    expect(currentBacklog.actions.removeSprint).toHaveBeenCalledWith(55);
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
