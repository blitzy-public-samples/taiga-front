/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Board.test.tsx
 * --------------
 * Browserless Jest + React Testing Library unit spec for the React Kanban
 * board table (`../components/Board`). It contributes to the >=70%
 * line-coverage gate enforced over `app/react/**` (jest.config.js
 * `coverageThreshold`, AAP 0.6.2/0.7.1) and pins the structural + behavioural
 * contract the component ports from the legacy AngularJS kanban table.
 *
 * `Board` is the composition ROOT of the board: it renders the sticky status
 * header (per-column add / bulk / fold / unfold buttons), then EITHER a
 * swimlane branch (one `<Swimlane>` per swimlane) OR a non-swimlane branch (one
 * `<Column>` per status). It owns the per-status column-fold view-state
 * persisted to `localStorage`, and wires up `ResizeObserver` /
 * `IntersectionObserver` / horizontal scroll-sync.
 *
 * BEHAVIOURAL ORIGIN (reproduced by the component, NEVER imported here — the
 * AngularJS/legacy sources stay on the far side of the coexistence boundary):
 *   the legacy AngularJS kanban `main.coffee` — the `tgKanban` directive
 *   (`KanbanDirective`, 639-717): the status-column header, the
 *   `KanbanSquishColumnDirective` (776-809) column fold/unfold + persistence,
 *   and the swimlane-vs-flat rendering branch. This spec asserts the REPRODUCED
 *   React DOM/behaviour, not the CoffeeScript.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2/0.7):
 *   - Jest + `jest-environment-jsdom` ONLY. No Playwright, no real browser, no
 *     network. Runs headlessly in a bare container.
 *   - The file name is exactly `Board.test.tsx` (a Jest `*.test.tsx` name,
 *     never a Playwright-style `*.spec.tsx` name).
 *   - The children `./Swimlane` and `./Column` are MOCKED to lightweight
 *     prop-echoing marker stubs. This isolates Board's OWN logic (header, branch
 *     selection, fold persistence, observers) and — crucially — SEVERS any
 *     transitive `@dnd-kit`/browser dependency those children carry, so Board
 *     renders standalone with no drag machinery.
 *   - jsdom has NO `ResizeObserver`/`IntersectionObserver`; both are stubbed on
 *     `global` (installed in `beforeEach`, restored in `afterEach`) so the
 *     observer effects run their bodies without leaking into other specs.
 *   - React itself is NOT imported (automatic `react-jsx` runtime); `jest` is a
 *     global (`@types/jest`), never imported.
 */

// ---------------------------------------------------------------------------
// Hoisted module mocks. ts-jest hoists every `jest.mock(...)` call above the
// imports below, so each factory MUST be self-contained (it may reference only
// `jest` and modules it `require`s internally). `require('react')` keeps the
// factory self-contained under that hoisting.
// ---------------------------------------------------------------------------

// Mock `./Swimlane` -> a marker `<div className="mock-swimlane" data-swimlane>`.
// Board maps ONE `<Swimlane>` per swimlane in the swimlane branch; the stub
// lets the spec count them and read each `swimlane.id` WITHOUT the real
// swimlane's `useDndContext`/column tree.
jest.mock('../components/Swimlane', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      const swimlane = props.swimlane as { id?: number } | undefined;
      // The REAL swimlane calls `showPlaceHolder(statusId, swimlaneId)` per
      // column; invoke it once here (with a non-null swimlaneId) so Board's
      // internal `showPlaceHolderFn` swimlane branch is exercised, and echo the
      // result. Guarded so a test that overrides the prop with a non-function
      // never breaks the stub.
      const shp =
        typeof props.showPlaceHolder === 'function'
          ? (props.showPlaceHolder as (s: number, sl: number | null) => boolean)(
              1,
              swimlane?.id ?? null,
            )
          : undefined;
      return react.createElement('div', {
        className: 'mock-swimlane',
        'data-swimlane': String(swimlane?.id),
        'data-folded': String(props.folded),
        'data-unfold': String(props.unfold),
        'data-show-placeholder': String(shp),
      });
    },
  };
});

// Mock `./Column` -> a marker `<div className="mock-column" data-*>`. Board
// maps ONE `<Column>` per status in the non-swimlane branch; the stub echoes
// the per-column props Board forwards (`status`/`swimlaneId`/`folded`/
// `unfolded`/`orderedIds`) as `data-*` so the branch + fold-state assertions can
// read them WITHOUT the real column's `useDroppable`/`SortableContext`.
jest.mock('../components/Column', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      const status = props.status as { id?: number } | undefined;
      const orderedIds = (props.orderedIds as number[] | undefined) ?? [];
      // Emit a `<tg-card data-id>` per ordered id. The REAL column renders these
      // (via `<Card>`), and Board's IntersectionObserver effect queries
      // `tg-card[data-id]` to latch card visibility; emitting them here lets that
      // effect body be exercised without the real card's DnD machinery.
      const cards = orderedIds.map((id) =>
        react.createElement('tg-card', { key: id, 'data-id': String(id) }),
      );
      return react.createElement(
        'div',
        {
          className: 'mock-column',
          'data-status': String(status?.id),
          'data-swimlane': props.swimlaneId == null ? '' : String(props.swimlaneId),
          'data-folded': String(props.folded),
          'data-unfolded': String(props.unfolded),
          'data-ordered': orderedIds.join(','),
          'data-show-placeholder': String(props.showPlaceHolder),
        },
        cards,
      );
    },
  };
});

import { render, fireEvent, cleanup, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Module under test. Its `./Swimlane` and `./Column` children are mocked above;
// `BoardProps` is the real exported prop contract (type-only, unaffected by the
// runtime mock of the sibling components).
import Board from '../components/Board';
import type { BoardProps } from '../components/Board';
// `UsStatus` is owned/exported by the REAL `./Column` (type-only import — the
// runtime mock does not affect type resolution).
import type { UsStatus } from '../components/Column';
// Reducer view-model types (all open shapes). `Swimlane` is aliased so it does
// not collide with the mocked `Swimlane` component value.
import type {
  Project,
  Swimlane as SwimlaneModel,
  UserStoryData,
} from '../state/kanbanReducer';

// ---------------------------------------------------------------------------
// Browser-API stubs (jsdom lacks ResizeObserver + IntersectionObserver).
// Shared `jest.fn` spies are attached as instance methods so the spec can
// assert Board observed the columns after mount. `clearMocks: true`
// (jest.config.js) + the explicit `jest.clearAllMocks()` in `beforeEach` reset
// their recorded calls between tests.
// ---------------------------------------------------------------------------
const resizeObserve = jest.fn();
const resizeUnobserve = jest.fn();
const resizeDisconnect = jest.fn();

// Callbacks captured from the most recent observer construction so tests can
// fire them manually (jsdom never invokes observer callbacks automatically).
// Reset in `beforeEach`.
type ResizeCallback = (entries: unknown[], observer: unknown) => void;
type IntersectionCallback = (entries: unknown[]) => void;
let lastResizeCallback: ResizeCallback | null = null;
let lastIntersectionCallback: IntersectionCallback | null = null;

class MockResizeObserver {
  observe = resizeObserve;
  unobserve = resizeUnobserve;
  disconnect = resizeDisconnect;
  constructor(cb: ResizeCallback) {
    lastResizeCallback = cb;
  }
}

const intersectionObserve = jest.fn();
const intersectionUnobserve = jest.fn();
const intersectionDisconnect = jest.fn();

class MockIntersectionObserver {
  observe = intersectionObserve;
  unobserve = intersectionUnobserve;
  disconnect = intersectionDisconnect;
  takeRecords = (): unknown[] => [];
  constructor(cb: IntersectionCallback, _opts?: unknown) {
    void _opts;
    lastIntersectionCallback = cb;
  }
}

// The original descriptors (jsdom leaves these `undefined`); restored after each
// test so the stubs never leak into sibling specs. A narrow record type (rather
// than an intersection with `typeof globalThis`) keeps the two slots optional so
// they can be reset to `undefined` to exercise Board's `typeof X === 'undefined'`
// guards.
type ObservableGlobal = {
  ResizeObserver?: unknown;
  IntersectionObserver?: unknown;
};
const observableGlobal = global as unknown as ObservableGlobal;
const originalResizeObserver = observableGlobal.ResizeObserver;
const originalIntersectionObserver = observableGlobal.IntersectionObserver;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `UsStatus`. `id`/`name`/`order` are required; the open index
 * signature tolerates the rest. Defaults: non-archived, no WIP limit.
 */
const makeStatus = (over: Partial<UsStatus> = {}): UsStatus =>
  ({
    id: 1,
    name: 'New',
    order: 1,
    color: '#729fcf',
    is_archived: false,
    wip_limit: null,
    ...over,
  } as UsStatus);

/**
 * The default ordered status list: two open statuses (1, 2) + one ARCHIVED
 * status (3). The archived status drives the add/bulk visibility gate and the
 * auto-fold-archived-on-load branch.
 */
const statuses: UsStatus[] = [
  makeStatus({ id: 1, name: 'New' }),
  makeStatus({ id: 2, name: 'In progress' }),
  makeStatus({ id: 3, name: 'Done', is_archived: true }),
];

/**
 * Build a `Project`. `id: 7` makes the fold `localStorage` key deterministic
 * (`7:kanban-statuscolumnmodels`); `i_am_admin: true` and `us_statuses` gate
 * the add-swimlane link and feed `statusesForSwimlane(-1)`.
 */
const makeProject = (over: Record<string, unknown> = {}): Project =>
  ({
    id: 7,
    i_am_admin: true,
    us_statuses: statuses,
    default_swimlane: null,
    ...over,
  } as Project);

/** Build a swimlane model (`id`/`name`/`kanban_order` + open index). */
const makeSwimlane = (id: number, name: string): SwimlaneModel =>
  ({ id, name, kanban_order: 1 } as SwimlaneModel);

/** The persisted fold-map `localStorage` key for the default project (id 7). */
const FOLD_KEY = '7:kanban-statuscolumnmodels';

/**
 * The full spy set forwarded to `<Board>`. Fresh instances per `renderBoard`
 * call; the tests assert against the returned handles.
 */
type BoardSpies = {
  onAddNewUs: jest.Mock;
  onCardToggleFold: jest.Mock;
  onCardEdit: jest.Mock;
  onCardDelete: jest.Mock;
  onCardAssignedTo: jest.Mock;
  onCardMoveToTop: jest.Mock;
  onCardSelect: jest.Mock;
  onToggleSwimlane: jest.Mock;
  onShowStatus: jest.Mock;
  onHideStatus: jest.Mock;
  onShowArchived: jest.Mock;
};

const makeSpies = (): BoardSpies => ({
  onAddNewUs: jest.fn(),
  onCardToggleFold: jest.fn(),
  onCardEdit: jest.fn(),
  onCardDelete: jest.fn(),
  onCardAssignedTo: jest.fn(),
  onCardMoveToTop: jest.fn(),
  onCardSelect: jest.fn(),
  onToggleSwimlane: jest.fn(),
  onShowStatus: jest.fn(),
  onHideStatus: jest.fn(),
  onShowArchived: jest.fn(),
});

/**
 * Render `<Board>` with a complete default prop set (spread from
 * `useKanbanBoard`-shaped fixtures) and per-call overrides. Returns the RTL
 * render result plus the `spies` handles and the fully-resolved `props`.
 *
 * NOTE: `showPlaceHolder` is deliberately LEFT UNDEFINED by default so Board's
 * internal `showPlaceHolderFn` (the else branch) is exercised; a dedicated test
 * passes an explicit predicate to cover the delegating branch.
 * adjusted per Board.tsx on disk: `usMap` is a plain `Record` (Board reads it
 * via `Object.keys(usMap).length`), NOT a `Map`.
 */
const renderBoard = (over: Partial<BoardProps> = {}) => {
  const spies = makeSpies();
  const defaultProps: BoardProps = {
    // ---- data ----
    initialLoad: true,
    usStatusList: statuses,
    swimlanesList: [],
    swimlanesStatuses: {},
    usByStatus: { '1': [11], '2': [12], '3': [] },
    usByStatusSwimlanes: {},
    usMap: {} as Record<number, UserStoryData>,
    project: makeProject(),
    usersById: {},
    notFoundUserstories: false,
    renderInProgress: false,
    // ---- view state ----
    zoomLevel: 1,
    zoom: ['assigned_to', 'ref', 'subject', 'card-data', 'assigned_to_extended'],
    selectedUss: {},
    movedUs: [],
    foldedSwimlane: () => false,
    // ---- permissions ----
    canModify: true,
    canDelete: true,
    canAddUs: true,
    canViewTasks: true,
    // ---- predicates ----
    isUsArchivedHidden: () => false,
    // ---- callbacks ----
    onAddNewUs: spies.onAddNewUs,
    onCardToggleFold: spies.onCardToggleFold,
    onCardEdit: spies.onCardEdit,
    onCardDelete: spies.onCardDelete,
    onCardAssignedTo: spies.onCardAssignedTo,
    onCardMoveToTop: spies.onCardMoveToTop,
    onCardSelect: spies.onCardSelect,
    onToggleSwimlane: spies.onToggleSwimlane,
    onShowStatus: spies.onShowStatus,
    onHideStatus: spies.onHideStatus,
    onShowArchived: spies.onShowArchived,
  };
  const props: BoardProps = { ...defaultProps, ...over };
  const result = render(<Board {...props} />);
  return { ...result, spies, props };
};

/** All status headers in DOM order (`[status1, status2, status3]`). */
const headers = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('h2.task-colum-name'));

// ---------------------------------------------------------------------------
// Lifecycle: install the observer stubs + reset storage/mocks before each test;
// restore everything after each so nothing leaks into sibling specs.
// ---------------------------------------------------------------------------
beforeEach(() => {
  observableGlobal.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  observableGlobal.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  lastResizeCallback = null;
  lastIntersectionCallback = null;
  localStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  observableGlobal.ResizeObserver = originalResizeObserver;
  observableGlobal.IntersectionObserver = originalIntersectionObserver;
});

// ---------------------------------------------------------------------------
// Phase C — initialLoad gating
// ---------------------------------------------------------------------------
describe('initialLoad gating', () => {
  it('renders nothing until initialLoad is true', () => {
    const { container } = renderBoard({ initialLoad: false });
    expect(container.firstChild).toBeNull();
    expect(container.querySelector('.kanban-table')).toBeNull();
  });

  it('renders the .kanban-table root once initialLoad is true', () => {
    const { container } = renderBoard({ initialLoad: true });
    expect(container.querySelector('.kanban-table')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase D — Root classes: zoom level + swimlane modifier
// ---------------------------------------------------------------------------
describe('root classes (zoom + swimlane modifier)', () => {
  it.each([0, 2, 3])('applies zoom-%s to the .kanban-table root', (zoomLevel) => {
    const { container } = renderBoard({ zoomLevel });
    const root = container.querySelector('.kanban-table') as HTMLElement;
    expect(root.className).toContain(`zoom-${zoomLevel}`);
  });

  it('omits kanban-table-swimlane when there are no swimlanes', () => {
    const { container } = renderBoard({ swimlanesList: [] });
    const root = container.querySelector('.kanban-table') as HTMLElement;
    expect(root.className).not.toContain('kanban-table-swimlane');
  });

  it('adds kanban-table-swimlane when at least one swimlane exists', () => {
    const { container } = renderBoard({ swimlanesList: [makeSwimlane(5, 'S1')] });
    const root = container.querySelector('.kanban-table') as HTMLElement;
    expect(root.className).toContain('kanban-table-swimlane');
  });
});

// ---------------------------------------------------------------------------
// Phase E — Status header rendering
// ---------------------------------------------------------------------------
describe('status header rendering', () => {
  it('renders one h2.task-colum-name per status with the status name', () => {
    const { container } = renderBoard();
    const hs = headers(container);
    expect(hs).toHaveLength(statuses.length);
    hs.forEach((h, i) => {
      expect(h.querySelector('.name')?.textContent).toBe(statuses[i].name);
      expect(h.getAttribute('title')).toBe(statuses[i].name);
    });
  });

  it('each header exposes .deco-square, .title and .options', () => {
    const { container } = renderBoard();
    headers(container).forEach((h) => {
      expect(h.querySelector('.deco-square')).not.toBeNull();
      expect(h.querySelector('.title')).not.toBeNull();
      expect(h.querySelector('.options')).not.toBeNull();
    });
  });

  it('shows add + bulk buttons only on non-archived statuses when canAddUs is true', () => {
    const { container } = renderBoard({ canAddUs: true });
    const hs = headers(container);
    // statuses 1 & 2 (non-archived) => add + bulk present
    [0, 1].forEach((i) => {
      expect(within(hs[i]).queryByTitle('Add new user story')).not.toBeNull();
      expect(within(hs[i]).queryByTitle('Add new bulk')).not.toBeNull();
    });
    // status 3 (archived) => NO add/bulk
    expect(within(hs[2]).queryByTitle('Add new user story')).toBeNull();
    expect(within(hs[2]).queryByTitle('Add new bulk')).toBeNull();
  });

  it('hides add + bulk buttons on every status when canAddUs is false', () => {
    const { container } = renderBoard({ canAddUs: false });
    headers(container).forEach((h) => {
      expect(within(h).queryByTitle('Add new user story')).toBeNull();
      expect(within(h).queryByTitle('Add new bulk')).toBeNull();
    });
  });

  it('wires the add button to onAddNewUs("standard", statusId)', () => {
    const { container, spies } = renderBoard();
    fireEvent.click(within(headers(container)[0]).getByTitle('Add new user story'));
    expect(spies.onAddNewUs).toHaveBeenCalledTimes(1);
    expect(spies.onAddNewUs).toHaveBeenCalledWith('standard', 1);
  });

  it('wires the bulk button to onAddNewUs("bulk", statusId)', () => {
    const { container, spies } = renderBoard();
    fireEvent.click(within(headers(container)[1]).getByTitle('Add new bulk'));
    expect(spies.onAddNewUs).toHaveBeenCalledTimes(1);
    expect(spies.onAddNewUs).toHaveBeenCalledWith('bulk', 2);
  });
});

// ---------------------------------------------------------------------------
// Phase F — Non-swimlane branch (flat columns)
// ---------------------------------------------------------------------------
describe('non-swimlane branch (flat columns)', () => {
  it('renders .kanban-table-body with one Column per status and no Swimlane', () => {
    const { container } = renderBoard({ swimlanesList: [] });
    expect(container.querySelector('.kanban-table-body')).not.toBeNull();

    const columns = Array.from(container.querySelectorAll('.mock-column'));
    expect(columns).toHaveLength(statuses.length);
    expect(columns.map((c) => c.getAttribute('data-status'))).toEqual(['1', '2', '3']);
    // Non-swimlane columns carry no swimlane id (Board passes `swimlaneId={null}`).
    columns.forEach((c) => expect(c.getAttribute('data-swimlane')).toBe(''));
    expect(container.querySelector('.mock-swimlane')).toBeNull();
  });

  it('forwards the ordered ids from usByStatus (string keys) to each Column', () => {
    const { container } = renderBoard({ swimlanesList: [] });
    const byStatus = (id: string) => container.querySelector(`.mock-column[data-status="${id}"]`);
    expect(byStatus('1')?.getAttribute('data-ordered')).toBe('11');
    expect(byStatus('2')?.getAttribute('data-ordered')).toBe('12');
    expect(byStatus('3')?.getAttribute('data-ordered')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Phase G — Swimlane branch
// ---------------------------------------------------------------------------
describe('swimlane branch', () => {
  it('renders one Swimlane per swimlane and no board-level Column', () => {
    const { container } = renderBoard({
      swimlanesList: [makeSwimlane(5, 'S1'), makeSwimlane(6, 'S2')],
    });
    const sls = Array.from(container.querySelectorAll('.mock-swimlane'));
    expect(sls).toHaveLength(2);
    expect(sls.map((s) => s.getAttribute('data-swimlane'))).toEqual(['5', '6']);
    // Columns live INSIDE each (stubbed) Swimlane, so none render at board level.
    expect(container.querySelector('.mock-column')).toBeNull();
  });

  it('shows a.kanban-swimlane-add when admin and exactly one swimlane', () => {
    const { container } = renderBoard({
      project: makeProject({ i_am_admin: true }),
      swimlanesList: [makeSwimlane(5, 'S1')],
    });
    expect(container.querySelector('a.kanban-swimlane-add')).not.toBeNull();
  });

  it('hides a.kanban-swimlane-add when there are two or more swimlanes', () => {
    const { container } = renderBoard({
      project: makeProject({ i_am_admin: true }),
      swimlanesList: [makeSwimlane(5, 'S1'), makeSwimlane(6, 'S2')],
    });
    expect(container.querySelector('a.kanban-swimlane-add')).toBeNull();
  });

  it('hides a.kanban-swimlane-add when the viewer is not an admin', () => {
    const { container } = renderBoard({
      project: makeProject({ i_am_admin: false }),
      swimlanesList: [makeSwimlane(5, 'S1')],
    });
    expect(container.querySelector('a.kanban-swimlane-add')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase G2 — statusesForSwimlane derivation (coverage of every branch). The
// derived statuses feed the (stubbed) Swimlane; the assertions confirm the
// board renders each swimlane without throwing while the derivation executes.
// ---------------------------------------------------------------------------
describe('statusesForSwimlane derivation', () => {
  it('uses an explicit swimlanesStatuses entry when provided', () => {
    const { container } = renderBoard({
      swimlanesList: [makeSwimlane(5, 'S1')],
      swimlanesStatuses: { 5: [makeStatus({ id: 1 })] },
    });
    expect(container.querySelector('.mock-swimlane[data-swimlane="5"]')).not.toBeNull();
  });

  it('maps the synthetic -1 swimlane to project.us_statuses', () => {
    const { container } = renderBoard({
      swimlanesList: [makeSwimlane(-1, 'Unclassified')],
    });
    expect(container.querySelector('.mock-swimlane[data-swimlane="-1"]')).not.toBeNull();
  });

  it('falls back to usStatusList for the -1 swimlane when the project has no us_statuses', () => {
    const { container } = renderBoard({
      project: makeProject({ us_statuses: undefined }),
      swimlanesList: [makeSwimlane(-1, 'Unclassified')],
    });
    expect(container.querySelector('.mock-swimlane[data-swimlane="-1"]')).not.toBeNull();
  });

  it("uses a normal swimlane's own statuses array when present", () => {
    const swimlane = { ...makeSwimlane(5, 'S1'), statuses: [makeStatus({ id: 2 })] } as SwimlaneModel;
    const { container } = renderBoard({ swimlanesList: [swimlane] });
    expect(container.querySelector('.mock-swimlane[data-swimlane="5"]')).not.toBeNull();
  });

  it('falls back to usStatusList for a normal swimlane without a statuses array', () => {
    const { container } = renderBoard({ swimlanesList: [makeSwimlane(5, 'S1')] });
    expect(container.querySelector('.mock-swimlane[data-swimlane="5"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase H — Column fold state & localStorage persistence (CRITICAL branch)
// ---------------------------------------------------------------------------
describe('column fold state & localStorage persistence', () => {
  it('initialises folded columns from the persisted map', () => {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ '2': true }));
    const { container } = renderBoard();
    const hs = headers(container);
    expect(hs[1].className).toContain('vfold'); // status 2 folded from storage
    expect(hs[0].className).not.toContain('vfold'); // status 1 not folded
  });

  it('forces archived status columns folded on init', () => {
    const { container } = renderBoard(); // clean storage; status 3 is archived
    expect(headers(container)[2].className).toContain('vfold');
  });

  it('does NOT force-fold archived columns when the board has no data', () => {
    const { container } = renderBoard({ usByStatus: {}, usByStatusSwimlanes: {} });
    // hasBoardData is false -> the init effect early-returns -> status 3 stays unfolded.
    expect(headers(container)[2].className).not.toContain('vfold');
  });

  it('foldStatus folds a column, adds vfold and persists { statusId: true }', () => {
    const { container } = renderBoard();
    fireEvent.click(within(headers(container)[0]).getByTitle('Fold column'));

    expect(headers(container)[0].className).toContain('vfold');
    const persisted = JSON.parse(localStorage.getItem(FOLD_KEY) as string);
    expect(persisted['1']).toBe(true);
  });

  it('foldStatus unfolds a folded column, removes vfold and persists false', () => {
    const { container } = renderBoard();
    // fold, then unfold status 1
    fireEvent.click(within(headers(container)[0]).getByTitle('Fold column'));
    fireEvent.click(within(headers(container)[0]).getByTitle('Unfold column'));

    expect(headers(container)[0].className).not.toContain('vfold');
    const persisted = JSON.parse(localStorage.getItem(FOLD_KEY) as string);
    expect(persisted['1']).toBe(false);
  });

  it('marks the just-unfolded status via the Column `unfolded` prop', () => {
    const { container } = renderBoard();
    fireEvent.click(within(headers(container)[0]).getByTitle('Fold column'));
    fireEvent.click(within(headers(container)[0]).getByTitle('Unfold column'));
    // `unfold === 1` surfaces on the non-swimlane Column as `unfolded`.
    const col1 = container.querySelector('.mock-column[data-status="1"]');
    expect(col1?.getAttribute('data-unfolded')).toBe('true');
  });

  it('fires onHideStatus (not onShowStatus) when the Fold button toggles an archived status', () => {
    const { container, spies } = renderBoard();
    // Status 3 is archived + folded on init; its Fold button runs foldStatus,
    // whose archived branch calls onHideStatus(3). The Fold button never calls
    // onShowStatus.
    fireEvent.click(within(headers(container)[2]).getByTitle('Fold column'));
    expect(spies.onHideStatus).toHaveBeenCalledWith(3);
    expect(spies.onShowStatus).not.toHaveBeenCalled();
  });

  it('archived Unfold button calls BOTH onHideStatus (via foldStatus) and onShowStatus', () => {
    const { container, spies } = renderBoard();
    fireEvent.click(within(headers(container)[2]).getByTitle('Unfold column'));
    expect(spies.onHideStatus).toHaveBeenCalledWith(3);
    expect(spies.onShowStatus).toHaveBeenCalledWith(3);
  });

  it('tolerates malformed persisted fold JSON (renders without throwing)', () => {
    localStorage.setItem(FOLD_KEY, '{not valid json');
    expect(() => renderBoard()).not.toThrow();
  });

  it('ignores a non-object persisted fold value', () => {
    localStorage.setItem(FOLD_KEY, '5');
    const { container } = renderBoard();
    // A scalar is discarded -> status 1 is not folded from storage.
    expect(headers(container)[0].className).not.toContain('vfold');
  });

  it('does not throw when localStorage.setItem fails during a fold', () => {
    const { container } = renderBoard();
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    try {
      expect(() =>
        fireEvent.click(within(headers(container)[0]).getByTitle('Fold column')),
      ).not.toThrow();
      // The view-state still updates even though persistence failed.
      expect(headers(container)[0].className).toContain('vfold');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase I — Observer / scroll wiring (best-effort, no throws)
// ---------------------------------------------------------------------------
describe('observer & scroll wiring', () => {
  it('mounts with the stubbed observers and observes the header columns', () => {
    const { container } = renderBoard();
    expect(container.querySelector('.kanban-table')).not.toBeNull();
    // The ResizeObserver effect observes every `.task-colum-name` after mount.
    expect(resizeObserve).toHaveBeenCalled();
  });

  it('handles a body scroll without throwing (non-swimlane board)', () => {
    const { container } = renderBoard({ swimlanesList: [] });
    const body = container.querySelector('.kanban-table-body') as HTMLElement;
    expect(() => fireEvent.scroll(body)).not.toThrow();
  });

  it('handles a root scroll and translates the sticky swimlane add-link', () => {
    const { container } = renderBoard({
      project: makeProject({ i_am_admin: true }),
      swimlanesList: [makeSwimlane(5, 'S1')],
    });
    const root = container.querySelector('.kanban-table') as HTMLElement;
    expect(() => fireEvent.scroll(root)).not.toThrow();
    // onRootScroll sets a translateX transform on `.kanban-swimlane-add`.
    const addLink = container.querySelector('a.kanban-swimlane-add') as HTMLElement;
    expect(addLink.style.transform).toContain('translateX');
  });

  it('renders safely when the observer constructors are absent (jsdom default)', () => {
    // Remove the stubs to exercise Board's `typeof X === 'undefined'` guards.
    observableGlobal.ResizeObserver = undefined;
    observableGlobal.IntersectionObserver = undefined;
    expect(() => renderBoard()).not.toThrow();
  });

  it('renders an empty board (no status columns) without wiring the observers', () => {
    // No statuses -> the ResizeObserver effect finds no `.task-colum-name`
    // columns and bails out early; the board still renders its root safely.
    const { container } = renderBoard({ usStatusList: [], swimlanesList: [] });
    expect(container.querySelector('.kanban-table')).not.toBeNull();
    expect(container.querySelectorAll('h2.task-colum-name')).toHaveLength(0);
    expect(container.querySelectorAll('.mock-column')).toHaveLength(0);
  });

  it('recomputes width and unobserves removed columns when the ResizeObserver fires', () => {
    const { container } = renderBoard();
    expect(typeof lastResizeCallback).toBe('function');
    // Detach one observed `.task-colum-name` so the resize handler takes its
    // "column removed from the DOM -> unobserve" branch.
    const cols = Array.from(container.querySelectorAll('.task-colum-name'));
    cols[0].remove();
    expect(() =>
      act(() => {
        lastResizeCallback?.([], null);
      }),
    ).not.toThrow();
    expect(resizeUnobserve).toHaveBeenCalled();
  });

  it('latches card visibility when the IntersectionObserver fires', () => {
    const { container } = renderBoard({ swimlanesList: [] });
    // The Column stub renders `<tg-card data-id>` per ordered id, so the effect
    // constructs the observer and captures its callback.
    expect(typeof lastIntersectionCallback).toBe('function');
    const card = container.querySelector('tg-card[data-id="11"]') as Element;
    expect(intersectionObserve).toHaveBeenCalled();

    // A mix of intersecting + non-intersecting entries: only the intersecting
    // one latches. Firing twice proves the one-way latch never regresses.
    expect(() =>
      act(() => {
        lastIntersectionCallback?.([
          { isIntersecting: false, target: card },
          { isIntersecting: true, target: card },
        ]);
      }),
    ).not.toThrow();
    expect(() =>
      act(() => {
        lastIntersectionCallback?.([{ isIntersecting: true, target: card }]);
      }),
    ).not.toThrow();
    // An all-non-intersecting batch is a no-op (early return, no state change).
    expect(() =>
      act(() => {
        lastIntersectionCallback?.([{ isIntersecting: false, target: card }]);
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// showPlaceHolder — both the delegating branch and the internal reproduction
// ---------------------------------------------------------------------------
describe('showPlaceHolder', () => {
  it('delegates to a supplied showPlaceHolder predicate', () => {
    const showPlaceHolder = jest.fn(() => true);
    const { container } = renderBoard({ swimlanesList: [], showPlaceHolder });
    // The non-swimlane columns call the predicate once per status.
    expect(showPlaceHolder).toHaveBeenCalled();
    const col1 = container.querySelector('.mock-column[data-status="1"]');
    expect(col1?.getAttribute('data-show-placeholder')).toBe('true');
  });

  it('reproduces the placeholder rule internally when no predicate is supplied', () => {
    // Empty usMap => the first status column shows the placeholder.
    const { container } = renderBoard({ swimlanesList: [] });
    const col1 = container.querySelector('.mock-column[data-status="1"]');
    const col2 = container.querySelector('.mock-column[data-status="2"]');
    expect(col1?.getAttribute('data-show-placeholder')).toBe('true');
    expect(col2?.getAttribute('data-show-placeholder')).toBe('false');
  });
});

