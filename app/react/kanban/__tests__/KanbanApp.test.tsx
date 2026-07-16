/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanApp.test.tsx
 * ------------------
 * Browserless Jest + React Testing Library unit spec for {@link KanbanApp} — the
 * top-level React container (the SIBLING module ONE LEVEL UP from this
 * `__tests__/` folder, `../KanbanApp`) that the `<tg-react-kanban>` custom
 * element mounts. `KanbanApp` REPLACES the AngularJS 1.5.10 `KanbanController`
 * (`app/coffee/modules/kanban/main.coffee:634`) at the ROUTE level as part of the
 * AngularJS -> React 18 coexistence migration (Blitzy AAP 0.1-0.4). This spec is
 * the integration-level contributor to the mandated >=70% global line-coverage
 * gate over `app/react/**` (AAP 0.2.1 / 0.7.1).
 *
 * WHAT THIS SPEC PROVES (KanbanApp is a THIN ORCHESTRATOR): it exercises the
 * container's OWN rendering + wiring, NOT data or network behavior. The effectful
 * data hook (`../hooks/useKanbanBoard`) is mocked to a fully controllable
 * `UseKanbanBoardResult`, the presentational children (`Board`, `ZoomControl`,
 * `FilterBar` — imported by KanbanApp from the SPECIFIC files
 * `./components/Board|FilterBar|ZoomControl`, NOT the barrel) are replaced with
 * prop-echoing marker stubs, and the drag-and-drop layer
 * (`../../shared/dnd/DndProvider` + `createKanbanDragEndHandler` from
 * `../../shared/dnd/sortable`) is mocked so the coexistence DnD seam can be
 * asserted without a real drag. This isolates exactly the container's own
 * responsibilities:
 *   - the outer Kanban shell DOM reproduced from `app/partials/kanban/kanban.jade`
 *     using the EXACT class names (visual parity, AAP 0.3.4 / 0.7);
 *   - the filter-sidebar toggle + zoom + add-story + drag-end wiring; and
 *   - the `createKanbanDragEndHandler(...) -> <DndProvider mode="kanban">` seam.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7 - HARD RULES): browserless. Jest + jsdom +
 * React Testing Library ONLY -- NO Playwright, NO real browser, NO network. Every
 * `../../shared/*` dependency, the hook, and the presentational children are
 * MOCKED. React is NOT imported (automatic `react-jsx` runtime); `jest` is a
 * global; jest-dom matchers are auto-registered via jest.config
 * `setupFilesAfterEnv`.
 *
 * MOCK STYLE: every `jest.mock` factory uses `require('react')` + `createElement`
 * (never JSX) to avoid jest's out-of-scope-variable restriction on the injected
 * `_jsx` runtime binding -- matching the established pattern in the sibling
 * `BacklogApp.test.tsx` / `Board.test.tsx` specs. The mock specifiers are written
 * RELATIVE TO THIS TEST FILE so they resolve to the SAME absolute modules
 * `KanbanApp.tsx` imports (the test's `../components/Board` === KanbanApp's
 * `./components/Board`; the test's `../../shared/dnd/DndProvider` === KanbanApp's
 * `../shared/dnd/DndProvider`); this import-path parity is what guarantees
 * interception.
 *
 * DISK-DRIVEN ADJUSTMENTS (Phase A drift guard — the real `KanbanApp.tsx` WINS):
 *   - KanbanApp imports Board/FilterBar/ZoomControl from the INDIVIDUAL component
 *     files as DEFAULT exports (NOT the `../components` barrel) — mocks target the
 *     specific files with a `default` export. // adjusted per KanbanApp.tsx on disk
 *   - `useKanbanBoard`, `DndProvider` and `createKanbanDragEndHandler` are NAMED
 *     exports — mocked as named. // adjusted per KanbanApp.tsx on disk
 *   - KanbanApp does NOT import `../shared/api/userstories`; add-bulk and drag-end
 *     delegate to the HOOK (`addUsBulk` / `moveUs`). The API module is mocked only
 *     DEFENSIVELY (and asserted NEVER called). // adjusted per KanbanApp.tsx on disk
 *   - The swimlane modifier token on `section.main.kanban` is `swimlane`.
 *     // adjusted per KanbanApp.tsx on disk
 *   - add-bulk OPENS a lightbox first; `addUsBulk` fires only on submit with
 *     non-empty text. // adjusted per KanbanApp.tsx on disk
 */

import { render, fireEvent, act } from '@testing-library/react';

// The container under test. `KanbanApp` is exported BOTH as a named export and as
// the default; the named form is imported to match the sibling specs.
import { KanbanApp } from '../KanbanApp';
import type { KanbanAppProps } from '../KanbanApp';

// The mocked hook + drag-end factory are imported so they can be cast to
// `jest.Mock` and driven / asserted below. Imported AFTER the `jest.mock` calls
// (which ts-jest hoists to the top of the module) so these bindings are the mock
// implementations. The TYPE import resolves against the real hook source.
import { useKanbanBoard } from '../hooks/useKanbanBoard';
import type { UseKanbanBoardResult } from '../hooks/useKanbanBoard';
import { createKanbanDragEndHandler } from '../../shared/dnd/sortable';
// Defensive import so the never-called assertion in Phase G has a handle. The
// module is mocked below; KanbanApp itself never imports it.
import * as userstoriesApi from '../../shared/api/userstories';

/* ------------------------------------------------------------------ *
 * Module mocks (hoisted by ts-jest above the imports)
 * ------------------------------------------------------------------ */

// The effectful data layer -- replaced wholesale so no load / WebSocket / API
// behavior runs. `useKanbanBoard` is a NAMED export and a bare `jest.fn()`; each
// test drives its return value via `makeHookResult(...)`.
jest.mock('../hooks/useKanbanBoard', () => ({
  __esModule: true,
  useKanbanBoard: jest.fn(),
}));

// Board stub (DEFAULT export of the specific file `./components/Board`): surfaces
// the props the container -> board wiring depends on (`swimlanesList` length and
// `initialLoad`) and exposes one button per add-story mode so the test can drive
// `onAddNewUs('bulk' | 'standard', statusId)` at the container boundary.
jest.mock('../components/Board', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      react.createElement(
        'div',
        {
          className: 'mock-board',
          'data-swimlanes': String(props.swimlanesList ? props.swimlanesList.length : 0),
          'data-initial-load': String(props.initialLoad),
        },
        react.createElement('button', {
          type: 'button',
          className: 'mock-add-bulk',
          onClick: () => props.onAddNewUs && props.onAddNewUs('bulk', 1),
        }),
        react.createElement('button', {
          type: 'button',
          className: 'mock-add-standard',
          onClick: () => props.onAddNewUs && props.onAddNewUs('standard', 1),
        }),
      ),
  };
});

// FilterBar stub (DEFAULT export of `./components/FilterBar`): a single marker
// node so the test can assert it is rendered ONLY inside the `.kanban-filter`
// sidebar when the filter is open.
jest.mock('../components/FilterBar', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (_props: any) => react.createElement('div', { className: 'mock-filter' }),
  };
});

// ZoomControl stub (DEFAULT export of `./components/ZoomControl`): clicking it
// invokes the injected `onZoomChange(level, features)` so the zoom -> hook re-call
// wiring can be verified.
jest.mock('../components/ZoomControl', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      react.createElement('div', {
        className: 'mock-zoom',
        onClick: () => props.onZoomChange && props.onZoomChange(3, ['a']),
      }),
  };
});

// DndProvider passthrough (NAMED + default export of `../shared/dnd/DndProvider`):
// records the props it received (`mode`, `onDragEnd`, `children`) onto a global so
// the test can assert the wrapping topology (Board nested inside the provider) and
// invoke the captured `onDragEnd`.
jest.mock('../../shared/dnd/DndProvider', () => {
  const react = require('react');
  const DndProvider = (props: any) => {
    (globalThis as any).__kanbanDndProps = props;
    return react.createElement(
      'div',
      { className: 'mock-dnd-provider', 'data-mode': props.mode },
      props.children,
    );
  };
  return { __esModule: true, DndProvider, default: DndProvider };
});

// The kanban drag-end FACTORY (NAMED export of `../shared/dnd/sortable`). It
// CAPTURES the injected `deps` (so the test can assert the deps shape) and returns
// a handler that, when invoked, delegates to `deps.onMove(<KanbanDragResult>)` --
// exactly the seam KanbanApp uses to route a drop into the hook's `moveUs`. The
// result shape mirrors `KanbanDragResult` from `../../shared/dnd/types`
// (`newSwimlane: null` for the unclassified lane, which KanbanApp maps to -1).
jest.mock('../../shared/dnd/sortable', () => ({
  __esModule: true,
  createKanbanDragEndHandler: jest.fn((deps: any) =>
    jest.fn((_event: unknown) => {
      if (deps && typeof deps.onMove === 'function') {
        deps.onMove({
          movedIds: [13],
          newStatus: 1,
          newSwimlane: null,
          index: 0,
          afterUserstoryId: null,
          beforeUserstoryId: null,
        });
      }
    }),
  ),
}));

// Defensive: KanbanApp does NOT import this adapter directly (the hook owns every
// `/api/v1/` call, and the drag handler receives a local no-op `api`), but it is
// mocked so nothing reachable through the module graph can ever hit the real HTTP
// layer, and so Phase G can assert the raw endpoint is NEVER called.
jest.mock('../../shared/api/userstories', () => {
  const bulkCreate = jest.fn(() => Promise.resolve({}));
  const bulkUpdateKanbanOrder = jest.fn(() => Promise.resolve({}));
  const bulkUpdateBacklogOrder = jest.fn(() => Promise.resolve({}));
  const bulkUpdateMilestone = jest.fn(() => Promise.resolve({}));
  return {
    __esModule: true,
    bulkCreate,
    bulkUpdateKanbanOrder,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    default: { bulkCreate, bulkUpdateKanbanOrder, bulkUpdateBacklogOrder, bulkUpdateMilestone },
  };
});

/* ------------------------------------------------------------------ *
 * Typed mock handles
 * ------------------------------------------------------------------ */

const mockUseKanbanBoard = useKanbanBoard as unknown as jest.Mock;
const mockCreateKanbanDragEndHandler = createKanbanDragEndHandler as unknown as jest.Mock;

/* ------------------------------------------------------------------ *
 * `useKanbanBoard` return-value factory (controlled `UseKanbanBoardResult`)
 * ------------------------------------------------------------------ *
 * `makeHookResult(overrides)` returns the FULL `UseKanbanBoardResult` the real
 * hook exposes (see `useKanbanBoard.ts`), with deterministic fixture data + a
 * `jest.fn()` per dispatcher, so KanbanApp renders its maximal shell (a resolved
 * admin project with all permissions). `overrides` shallow-merges LAST so a test
 * can flip a single field (e.g. `swimlanesList`, `isFirstLoad`) without restating
 * the whole object. Disk-accurate shapes: `usMap` is a PLAIN OBJECT (not a Map),
 * `foldedSwimlane` is a Record (not a function), `statuses[].order` and
 * `swimlanesList[].kanban_order` are required.
 */
function makeHookResult(overrides: Partial<UseKanbanBoardResult> = {}): UseKanbanBoardResult {
  const base = {
    // --- board state + projections ---
    state: {},
    usByStatus: { '1': [11, 12], '2': [13] },
    usMap: {},
    usByStatusSwimlanes: {},
    swimlanesList: [],
    statuses: [
      { id: 1, name: 'New', order: 1, is_archived: false, wip_limit: null },
      { id: 2, name: 'Done', order: 2, is_archived: false, wip_limit: null },
    ],
    project: {
      id: 7,
      slug: 'proj',
      name: 'Proj',
      my_permissions: ['modify_us', 'delete_us', 'add_us'],
    },
    projectId: 7,
    usersById: {},
    foldedSwimlane: {},
    // --- flags ---
    isFirstLoad: false,
    loading: false,
    isLightboxOpened: false,
    notFoundUserstories: false,
    permissionError: false,
    // --- dispatchers (promise-returning ones resolve so `.then` chains work) ---
    moveUs: jest.fn(() => Promise.resolve()),
    moveUsToTop: jest.fn(() => Promise.resolve()),
    addUs: jest.fn(),
    addUsBulk: jest.fn(() => Promise.resolve()),
    editUs: jest.fn(),
    deleteUs: jest.fn(),
    toggleFold: jest.fn(),
    toggleSwimlane: jest.fn(),
    hideStatus: jest.fn(),
    showStatus: jest.fn(() => Promise.resolve()),
    reload: jest.fn(() => Promise.resolve()),
    setLightboxOpen: jest.fn(),
  };
  return { ...base, ...overrides } as unknown as UseKanbanBoardResult;
}

/* ------------------------------------------------------------------ *
 * Render helper
 * ------------------------------------------------------------------ *
 * Points the mocked hook at a fresh `makeHookResult(hookOverrides)`, renders
 * `<KanbanApp projectSlug="proj" {...props} />`, and returns the RTL utils PLUS
 * the exact `hookResult` object the render used -- so a test can assert on its
 * `jest.fn` dispatchers (e.g. `moveUs`, `addUsBulk`).
 */
function renderApp(
  props: Partial<KanbanAppProps> = {},
  hookOverrides: Partial<UseKanbanBoardResult> = {},
) {
  const hookResult = makeHookResult(hookOverrides);
  mockUseKanbanBoard.mockReturnValue(hookResult);
  const utils = render(<KanbanApp projectSlug="proj" {...props} />);
  return { ...utils, hookResult };
}

/* ------------------------------------------------------------------ *
 * Per-test hygiene
 * ------------------------------------------------------------------ */

beforeEach(() => {
  // clearAllMocks() resets call data (jest.config `clearMocks: true` does the
  // same); implementations set in the jest.mock factories are PRESERVED, so the
  // drag-end handler + component stubs keep working. Re-establish a default hook
  // return so a bare render (if any) still resolves.
  jest.clearAllMocks();
  mockUseKanbanBoard.mockReturnValue(makeHookResult());
  delete (globalThis as any).__kanbanDndProps;
  try {
    localStorage.clear();
  } catch {
    /* jsdom localStorage - safe to ignore */
  }
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  delete (globalThis as any).__kanbanDndProps;
  delete (window as any).taiga;
  delete (window as any).taigaConfig;
});


/* ================================================================== *
 * Phase C -- Shell rendering
 * ================================================================== */

describe('KanbanApp - Phase C: shell rendering', () => {
  it('renders div.wrapper > section.main.kanban with header, filter toggle, ZoomControl and Board', () => {
    const { container } = renderApp();

    // Outer shell reproduced verbatim from kanban.jade for visual parity.
    expect(container.querySelector('div.wrapper')).toBeInTheDocument();
    const section = container.querySelector('section.main.kanban');
    expect(section).toBeInTheDocument();

    // Header region + the filter toggle button.
    expect(container.querySelector('.kanban-header')).toBeInTheDocument();
    expect(container.querySelector('button.btn-filter.e2e-open-filter')).toBeInTheDocument();

    // Both presentational children render (as stubbed markers).
    expect(container.querySelector('.mock-zoom')).toBeInTheDocument();
    expect(container.querySelector('.mock-board')).toBeInTheDocument();
  });

  it('calls useKanbanBoard with the projectSlug and the default zoom level', () => {
    renderApp();

    expect(mockUseKanbanBoard).toHaveBeenCalled();
    // The container feeds the hook its slug + owned zoom level (default 1).
    expect(mockUseKanbanBoard).toHaveBeenCalledWith(
      expect.objectContaining({ projectSlug: 'proj', zoomLevel: 1 }),
    );
  });

  it('renders the Board INSIDE the DndProvider, which receives mode="kanban" + an onDragEnd fn', () => {
    const { container } = renderApp();

    // Board nested within the provider proves the DnD wrapper topology.
    expect(container.querySelector('.mock-dnd-provider .mock-board')).toBeInTheDocument();

    // The provider props were captured by the DndProvider stub.
    const dndProps = (globalThis as any).__kanbanDndProps;
    expect(dndProps).toBeDefined();
    expect(dndProps.mode).toBe('kanban');
    expect(typeof dndProps.onDragEnd).toBe('function');
  });
});

/* ================================================================== *
 * Phase D -- Swimlane modifier class
 * ================================================================== */

describe('KanbanApp - Phase D: swimlane modifier class', () => {
  it('does NOT add the .swimlane modifier when swimlanesList is empty', () => {
    const { container } = renderApp(undefined, { swimlanesList: [] });

    const section = container.querySelector('section.main.kanban');
    expect(section).toBeInTheDocument();
    expect(section).not.toHaveClass('swimlane');
    // Board is told there are zero swimlanes.
    expect(container.querySelector('.mock-board')).toHaveAttribute('data-swimlanes', '0');
  });

  it('adds the .swimlane modifier when swimlanesList is non-empty', () => {
    const { container } = renderApp(undefined, {
      swimlanesList: [{ id: 5, name: 'S1', kanban_order: 1 }],
    });

    const section = container.querySelector('section.main.kanban');
    expect(section).toHaveClass('swimlane');
    // Board received the single swimlane (data-swimlanes surfaces the count).
    expect(container.querySelector('.mock-board')).toHaveAttribute('data-swimlanes', '1');
  });
});

/* ================================================================== *
 * Phase E -- Filter toggle (openFilter state)
 * ================================================================== */

describe('KanbanApp - Phase E: filter toggle', () => {
  it('starts CLOSED: .kanban-manager is .expanded, no .kanban-filter sidebar, no FilterBar', () => {
    const { container } = renderApp();

    const manager = container.querySelector('.kanban-manager');
    expect(manager).toBeInTheDocument();
    expect(manager).toHaveClass('expanded');
    expect(container.querySelector('.kanban-filter')).not.toBeInTheDocument();
    expect(container.querySelector('.mock-filter')).not.toBeInTheDocument();
  });

  it('opens on toggle click: manager loses .expanded, .kanban-filter + FilterBar appear', () => {
    const { container } = renderApp();
    const toggle = container.querySelector('button.btn-filter.e2e-open-filter') as HTMLElement;

    fireEvent.click(toggle);

    const manager = container.querySelector('.kanban-manager');
    expect(manager).not.toHaveClass('expanded');
    expect(container.querySelector('.kanban-filter')).toBeInTheDocument();
    // FilterBar is rendered INSIDE the sidebar only when open.
    expect(container.querySelector('.kanban-filter .mock-filter')).toBeInTheDocument();
  });

  it('is idempotent: a second click restores the initial CLOSED state', () => {
    const { container } = renderApp();
    const toggle = container.querySelector('button.btn-filter.e2e-open-filter') as HTMLElement;

    fireEvent.click(toggle); // open
    expect(container.querySelector('.kanban-filter')).toBeInTheDocument();

    fireEvent.click(toggle); // close again
    const manager = container.querySelector('.kanban-manager');
    expect(manager).toHaveClass('expanded');
    expect(container.querySelector('.kanban-filter')).not.toBeInTheDocument();
    expect(container.querySelector('.mock-filter')).not.toBeInTheDocument();
  });
});

/* ================================================================== *
 * Phase F -- Add user story (bulk delegates to the hook's addUsBulk)
 * ================================================================== *
 * Reproduces AngularJS `addNewUs` (main.coffee:266-276): "bulk" opens the bulk
 * form (whose submit posts to bulk_create), "standard" opens the generic create
 * form. KanbanApp is a THIN ORCHESTRATOR: it opens a lightbox shell and, on bulk
 * submit, delegates to the hook's `addUsBulk` (which owns the bulk_create call --
 * covered end-to-end by useKanbanBoard.test.tsx). KanbanApp never calls the raw
 * API adapter itself.
 */

describe('KanbanApp - Phase F: add user story', () => {
  it('onAddNewUs("bulk") opens the bulk lightbox WITHOUT calling addUsBulk yet', () => {
    const { container, hookResult } = renderApp();

    // No bulk lightbox before the action.
    expect(container.querySelector('.lightbox-generic-bulk')).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('.mock-add-bulk') as HTMLElement);

    // The functional bulk lightbox shell opens; the hook is NOT called until submit.
    expect(container.querySelector('.lightbox-generic-bulk')).toBeInTheDocument();
    expect(container.querySelector('.bulk-textarea')).toBeInTheDocument();
    expect(hookResult.addUsBulk).not.toHaveBeenCalled();
  });

  it('submitting the bulk textarea calls addUsBulk(statusId, trimmedText) exactly once', async () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-bulk') as HTMLElement);
    const textarea = container.querySelector('.bulk-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  Story A\nStory B  ' } });

    // `await act(async ...)` flushes the `.then(closeBulk)` microtask so no state
    // update escapes act (addUsBulk itself is invoked synchronously on click).
    await act(async () => {
      fireEvent.click(container.querySelector('.btn-save') as HTMLElement);
    });

    expect(hookResult.addUsBulk).toHaveBeenCalledTimes(1);
    // statusId 1 comes from the Board stub's onAddNewUs('bulk', 1); the text is
    // trimmed by submitBulk.
    expect(hookResult.addUsBulk).toHaveBeenCalledWith(1, 'Story A\nStory B');
    // The raw endpoint is NEVER hit directly from the container.
    expect(userstoriesApi.bulkCreate).not.toHaveBeenCalled();
  });

  it('does NOT call addUsBulk when the bulk textarea is empty (whitespace only)', () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-bulk') as HTMLElement);
    const textarea = container.querySelector('.bulk-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(container.querySelector('.btn-save') as HTMLElement);

    expect(hookResult.addUsBulk).not.toHaveBeenCalled();
    // The empty submit closes the lightbox (submitBulk early-returns via closeBulk).
    expect(container.querySelector('.lightbox-generic-bulk')).not.toBeInTheDocument();
  });

  it('onAddNewUs("standard") opens the create lightbox and does NOT call addUsBulk', () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-standard') as HTMLElement);

    // The generic create/edit lightbox shell opens; the bulk path is untouched.
    expect(container.querySelector('.lightbox-create-edit')).toBeInTheDocument();
    expect(container.querySelector('.lightbox-generic-bulk')).not.toBeInTheDocument();
    expect(hookResult.addUsBulk).not.toHaveBeenCalled();
  });
});


/* ================================================================== *
 * Phase G -- Drag-end delegates the move to the hook (moveUs)
 * ================================================================== *
 * SINGLE-CALL invariant (main.coffee parity): the board move performs BOTH the
 * reducer update AND the one bulkUpdateKanbanOrder network call INSIDE the hook's
 * moveUs. KanbanApp injects a pass-through `api` into createKanbanDragEndHandler,
 * so the drag handler never hits the network directly. The `-1 <-> null` swimlane
 * mapping and the single-call contract are covered in depth by
 * useKanbanBoard.test.tsx.
 */

describe('KanbanApp - Phase G: drag-end move', () => {
  it('builds onDragEnd via createKanbanDragEndHandler(deps) with projectId + an onMove fn', () => {
    renderApp();

    expect(mockCreateKanbanDragEndHandler).toHaveBeenCalledTimes(1);
    expect(mockCreateKanbanDragEndHandler).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 7, onMove: expect.any(Function) }),
    );
  });

  it('invoking the captured onDragEnd routes the move through the hook moveUs (single call)', () => {
    const { hookResult } = renderApp();

    const dndProps = (globalThis as any).__kanbanDndProps;
    expect(typeof dndProps.onDragEnd).toBe('function');

    // Simulate a @dnd-kit DragEndEvent. The mocked handler ignores the event and
    // delegates to deps.onMove(<KanbanDragResult>) -> KanbanApp.onMove -> moveUs.
    act(() => {
      dndProps.onDragEnd({
        active: { id: 'us-13', data: { current: {} } },
        over: { id: 'column-1-none', data: { current: {} } },
      });
    });

    // The move goes through the hook's moveUs exactly once; the container maps the
    // unclassified swimlane (null) to -1 for the hook.
    expect(hookResult.moveUs).toHaveBeenCalledTimes(1);
    expect(hookResult.moveUs).toHaveBeenCalledWith([{ id: 13 }], 1, -1, 0, null, null);
    // The raw ordering endpoint is NEVER called directly from the container.
    expect(userstoriesApi.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * Phase H -- First-load state
 * ================================================================== */

describe('KanbanApp - Phase H: first-load state', () => {
  it('renders the shell and passes initialLoad=false to Board while isFirstLoad is true', () => {
    const { container } = renderApp(undefined, { isFirstLoad: true });

    // The container renders its shell without throwing during the first load.
    expect(container.querySelector('section.main.kanban')).toBeInTheDocument();
    const board = container.querySelector('.mock-board');
    expect(board).toBeInTheDocument();
    // Board receives initialLoad = !isFirstLoad = false.
    expect(board).toHaveAttribute('data-initial-load', 'false');
  });

  it('passes initialLoad=true to Board once the first load has completed', () => {
    const { container } = renderApp(undefined, { isFirstLoad: false });

    expect(container.querySelector('.mock-board')).toHaveAttribute('data-initial-load', 'true');
  });
});

/* ================================================================== *
 * Zoom control wiring (bonus -- exercises handleZoomChange -> hook re-call)
 * ================================================================== */

describe('KanbanApp - zoom control wiring', () => {
  it('re-invokes useKanbanBoard with the new zoom level when ZoomControl changes it', () => {
    const { container } = renderApp();

    // The initial hook call used the default zoom level 1.
    expect(mockUseKanbanBoard).toHaveBeenCalledWith(expect.objectContaining({ zoomLevel: 1 }));

    // The ZoomControl stub fires onZoomChange(3, ['a']) on click.
    fireEvent.click(container.querySelector('.mock-zoom') as HTMLElement);

    // KanbanApp lifts the zoom level and re-runs the hook with the new value.
    expect(mockUseKanbanBoard).toHaveBeenCalledWith(expect.objectContaining({ zoomLevel: 3 }));
  });
});

