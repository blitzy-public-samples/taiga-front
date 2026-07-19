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
        // Card action callbacks (KB-2 edit / KB-3 assign / KB-4 delete) exposed
        // so the container-level handlers can be exercised with a fixed us id 11.
        react.createElement('button', {
          type: 'button',
          className: 'mock-card-edit',
          onClick: () => props.onCardEdit && props.onCardEdit(11),
        }),
        react.createElement('button', {
          type: 'button',
          className: 'mock-card-assign',
          onClick: () => props.onCardAssignedTo && props.onCardAssignedTo(11),
        }),
        react.createElement('button', {
          type: 'button',
          className: 'mock-card-delete',
          onClick: () => props.onCardDelete && props.onCardDelete(11),
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
    // Echoes `selectedFilters` (count + JSON) so the URL-restore path can be
    // asserted, and exposes a `.mock-add-filter` button that invokes
    // `onAddFilter` with a fixed `tags`/`bug` include payload so the URL-write
    // path can be exercised without a real FilterBar. Still renders the
    // `.mock-filter` marker the pre-existing presence/absence assertions rely on.
    default: (props: any) =>
      react.createElement(
        'div',
        {
          className: 'mock-filter',
          'data-selected-count': String((props.selectedFilters ?? []).length),
          'data-selected-json': JSON.stringify(props.selectedFilters ?? []),
        },
        react.createElement('button', {
          type: 'button',
          className: 'mock-add-filter',
          onClick: () =>
            props.onAddFilter &&
            props.onAddFilter({
              category: { dataType: 'tags', title: 'Tags', content: [] },
              filter: { id: 'bug', name: 'bug', color: '#f00' },
              mode: 'include',
            }),
        }),
      ),
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
    // `userstoriesRaw` present (empty by default) so the real `getUsModel`
    // (`state.userstoriesRaw.find`) never throws; nav tests override it with a
    // resolvable story.
    state: { userstoriesRaw: [] },
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
    loadError: null,
    writeError: null,
    // --- dispatchers (promise-returning ones resolve so `.then` chains work) ---
    moveUs: jest.fn(() => Promise.resolve()),
    moveUsToTop: jest.fn(() => Promise.resolve()),
    addUs: jest.fn(),
    addUsBulk: jest.fn(() => Promise.resolve()),
    addUsStandard: jest.fn(() => Promise.resolve()),
    editUs: jest.fn(),
    saveUs: jest.fn(() => Promise.resolve()),
    deleteUs: jest.fn(() => Promise.resolve()),
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
  // Reset the jsdom URL so KanbanApp's URL-filter restore (Phase 10) starts from
  // a clean query on every test and does not leak filter state between specs.
  try {
    window.history.replaceState(null, '', '/');
  } catch {
    /* ignore */
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

  // KB-9 (a11y): the header search field must carry an `id` AND `name` so the
  // browser stops logging "A form field element should have an id or name
  // attribute". The accessible name is supplied by `aria-label` (no visible
  // <label>, matching the legacy `tg-input-search` DOM for visual parity).
  it('gives the header search input an id, name, and aria-label (KB-9)', () => {
    const { container } = renderApp();
    const search = container.querySelector('input[type="search"]') as HTMLInputElement | null;
    expect(search).toBeInTheDocument();
    expect(search?.getAttribute('id')).toBe('kanban-filter-search');
    expect(search?.getAttribute('name')).toBe('kanban-filter-search');
    expect(search?.getAttribute('aria-label')).toBeTruthy();
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

/* ================================================================== *
 * Error-state rendering (F-READ-1 load failure, F-WRITE-2 write failure)
 * ------------------------------------------------------------------
 * The hook surfaces `loadError` / `writeError`; KanbanApp must render a
 * user-visible, role="alert" banner for each rather than leaving the board
 * silently broken (the QA complaint). These specs pin the consumer wiring:
 * the correct container class, the ARIA alert role, the friendly legacy copy
 * (NOT a raw i18n key), and the negative case (no banners when no error).
 * ================================================================== */

describe('KanbanApp - error-state rendering', () => {
  it('renders NO error banners on the happy path (no loadError / writeError)', () => {
    const { container } = renderApp();

    expect(container.querySelector('.load-error')).not.toBeInTheDocument();
    expect(container.querySelector('.write-error')).not.toBeInTheDocument();
  });

  it('renders a role="alert" .load-error banner with the legacy warning copy when loadError is set (F-READ-1)', () => {
    const { container } = renderApp(undefined, { loadError: new Error('boom') });

    const banner = container.querySelector('.load-error');
    expect(banner).toBeInTheDocument();
    // ARIA alert so assistive tech announces the failed board load.
    expect(banner).toHaveAttribute('role', 'alert');
    // Friendly legacy string, NOT the raw `NOTIFICATION.WARNING` key.
    expect(banner).toHaveTextContent('Oops, something went wrong...');
    // A load failure must not masquerade as a write failure.
    expect(container.querySelector('.write-error')).not.toBeInTheDocument();
  });

  it('renders a role="alert" .write-error banner with the legacy save-failure copy when writeError is set (F-WRITE-2)', () => {
    const { container } = renderApp(undefined, { writeError: new Error('save failed') });

    const banner = container.querySelector('.write-error');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    // The optimistic move has been rolled back; tell the user it did not persist.
    expect(banner).toHaveTextContent('Your changes were not saved!');
    expect(container.querySelector('.load-error')).not.toBeInTheDocument();
  });

  it('renders BOTH banners independently when both errors are set', () => {
    const { container } = renderApp(undefined, {
      loadError: new Error('load boom'),
      writeError: new Error('write boom'),
    });

    expect(container.querySelector('.load-error')).toBeInTheDocument();
    expect(container.querySelector('.write-error')).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Group A -- single-story card operations (KB-1..KB-5)
 * ------------------------------------------------------------------
 * KB-5 / #7: the standard "+" opens a FUNCTIONAL create form (subject + core
 *       card fields) that POSTs via the hook's addUsStandard (the container
 *       never calls the raw endpoint).
 * KB-2 (#8): the card Edit action opens the INLINE edit lightbox seeded from the
 *       model and PATCHes via the hook's saveUs - the user stays on the board
 *       (this replaces the previous window.location navigation).
 * KB-3 (#8): the card Assign action opens the INLINE assign-users popover and
 *       PATCHes assigned_users/assigned_to via saveUs - again, no navigation.
 * KB-4: the card Delete action opens a confirm; confirming fires the pessimistic
 *       hook deleteUs (the server DELETE + remove-on-success live in the hook).
 * ================================================================== */

describe('KanbanApp - Group A: single-story card operations', () => {
  // A resolvable board state so the real `getUsModel(state, 11)` returns a story
  // the inline edit/assign forms can seed from. Carries the core editable fields
  // plus the concurrency `version` and current assignees.
  const stateWithUs11 = {
    userstoriesRaw: [
      {
        id: 11,
        ref: 42,
        status: 1,
        swimlane: null,
        kanban_order: 1,
        subject: 'Existing subject',
        description: 'Existing description',
        tags: [
          ['red', '#ff0000'],
          ['blue', null],
        ],
        is_blocked: false,
        blocked_note: '',
        due_date: null,
        version: 7,
        assigned_to: 101,
        assigned_users: [101, 102],
      },
    ],
  } as unknown as UseKanbanBoardResult['state'];
  const emptyState = { userstoriesRaw: [] } as unknown as UseKanbanBoardResult['state'];

  // A project carrying members so the inline assign popover has rows to render.
  const projectWithMembers = {
    id: 7,
    slug: 'proj',
    name: 'Proj',
    my_permissions: ['modify_us', 'delete_us', 'add_us'],
    members: [
      { id: 101, full_name_display: 'Alice' },
      { id: 102, full_name_display: 'Bob' },
      { id: 103, full_name_display: 'Carol' },
    ],
  } as unknown as UseKanbanBoardResult['project'];

  // ---- KB-5: functional single-story create ----
  it('KB-5: submitting the create subject calls addUsStandard(statusId, subject, extra) once and closes', async () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-standard') as HTMLElement);
    // A real subject input is rendered (not an inert shell).
    const input = container.querySelector('.create-us-subject') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '  New story  ' } });

    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-create-edit .btn-save') as HTMLElement);
    });

    expect(hookResult.addUsStandard).toHaveBeenCalledTimes(1);
    // statusId 1 from the Board stub's onAddNewUs('standard', 1); subject trimmed.
    // The container delegates to the hook (which owns the frozen POST); it never
    // builds the request itself. With only the subject filled, the `extra`
    // payload is an empty object (the adapter then posts a subject-only body,
    // byte-identical to the legacy quick add).
    expect(hookResult.addUsStandard).toHaveBeenCalledWith(1, 'New story', {});
    // The lightbox closes after a successful create.
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });

  // ---- #7: the create form carries the core card fields; a fully-filled create
  //          passes the `extra` payload through to addUsStandard ----
  it('#7: a create with description/tags/blocked/due passes the extra payload to addUsStandard', async () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-standard') as HTMLElement);
    fireEvent.change(container.querySelector('.create-us-subject') as HTMLInputElement, {
      target: { value: 'Rich story' },
    });
    fireEvent.change(container.querySelector('.create-us-description') as HTMLTextAreaElement, {
      target: { value: 'A description' },
    });
    fireEvent.change(container.querySelector('.create-us-tags') as HTMLInputElement, {
      target: { value: 'alpha, beta ,, alpha' },
    });
    fireEvent.change(container.querySelector('.create-us-due-date') as HTMLInputElement, {
      target: { value: '2026-08-15' },
    });
    fireEvent.click(container.querySelector('.create-us-blocked') as HTMLInputElement);
    fireEvent.change(container.querySelector('.create-us-blocked-note') as HTMLTextAreaElement, {
      target: { value: 'waiting' },
    });

    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-create-edit .btn-save') as HTMLElement);
    });

    expect(hookResult.addUsStandard).toHaveBeenCalledTimes(1);
    // Tags are trimmed + de-duplicated to names; the blocked note only rides
    // along because the story is blocked; due_date is the ISO string.
    expect(hookResult.addUsStandard).toHaveBeenCalledWith(1, 'Rich story', {
      description: 'A description',
      tags: ['alpha', 'beta'],
      is_blocked: true,
      blocked_note: 'waiting',
      due_date: '2026-08-15',
    });
  });

  it('KB-5: an empty create subject does NOT call addUsStandard and closes the shell', () => {
    const { container, hookResult } = renderApp();

    fireEvent.click(container.querySelector('.mock-add-standard') as HTMLElement);
    const input = container.querySelector('.create-us-subject') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(container.querySelector('.lightbox-create-edit .btn-save') as HTMLElement);

    expect(hookResult.addUsStandard).not.toHaveBeenCalled();
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });

  // ---- KB-2 (#8): edit opens the INLINE edit lightbox (no navigation) ----
  it('KB-2 (#8): card Edit opens the inline edit lightbox seeded from the model - the user stays on the board', () => {
    const { container } = renderApp({}, { state: stateWithUs11 });

    fireEvent.click(container.querySelector('.mock-card-edit') as HTMLElement);

    // The inline edit lightbox opens with the edit title, seeded from us 11.
    const lb = container.querySelector('.lightbox-create-edit');
    expect(lb).toBeInTheDocument();
    expect(lb?.querySelector('.title')?.textContent).toBe('Edit user story');
    const subject = container.querySelector('.create-us-subject') as HTMLInputElement;
    expect(subject.value).toBe('Existing subject');
    expect((container.querySelector('.create-us-description') as HTMLTextAreaElement).value).toBe(
      'Existing description',
    );
    // Tag NAMES are joined into the comma-separated field (colours dropped).
    expect((container.querySelector('.create-us-tags') as HTMLInputElement).value).toBe('red, blue');
  });

  it('KB-2 (#8): editing and saving calls saveUs with the changed fields + version (no navigation)', async () => {
    const { container, hookResult } = renderApp({}, { state: stateWithUs11 });

    fireEvent.click(container.querySelector('.mock-card-edit') as HTMLElement);
    fireEvent.change(container.querySelector('.create-us-subject') as HTMLInputElement, {
      target: { value: 'Renamed' },
    });

    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-create-edit .btn-save') as HTMLElement);
    });

    expect(hookResult.saveUs).toHaveBeenCalledTimes(1);
    const [usId, changed] = (hookResult.saveUs as jest.Mock).mock.calls[0];
    expect(usId).toBe(11);
    // The PATCH body carries the changed subject + the current status + the
    // concurrency version read off the model.
    expect(changed).toEqual(
      expect.objectContaining({ subject: 'Renamed', status: 1, version: 7 }),
    );
    // addUsStandard (create path) is NOT used for an edit.
    expect(hookResult.addUsStandard).not.toHaveBeenCalled();
    // The lightbox closes after a successful save.
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });

  it('KB-2 (#8): an empty subject on edit keeps the form open and does NOT call saveUs', () => {
    const { container, hookResult } = renderApp({}, { state: stateWithUs11 });

    fireEvent.click(container.querySelector('.mock-card-edit') as HTMLElement);
    fireEvent.change(container.querySelector('.create-us-subject') as HTMLInputElement, {
      target: { value: '   ' },
    });
    fireEvent.click(container.querySelector('.lightbox-create-edit .btn-save') as HTMLElement);

    expect(hookResult.saveUs).not.toHaveBeenCalled();
    // Subject is required on edit, so the form stays open (unlike create, which
    // closes on an empty subject).
    expect(container.querySelector('.lightbox-create-edit')).toBeInTheDocument();
  });

  // ---- KB-3 (#8): assign opens the INLINE assign popover (no navigation) ----
  it('KB-3 (#8): card Assign opens the inline assign popover seeded with the current assignees', () => {
    const { container } = renderApp({}, { state: stateWithUs11, project: projectWithMembers });

    fireEvent.click(container.querySelector('.mock-card-assign') as HTMLElement);

    const popover = container.querySelector('.lightbox-select-user');
    expect(popover).toBeInTheDocument();
    // One row per project member.
    const rows = popover?.querySelectorAll('.assign-user-row') ?? [];
    expect(rows.length).toBe(3);
    // The seeded checked set is compact(union(assigned_users=[101,102],
    // [assigned_to=101])) = {101, 102}; member 103 is unchecked.
    const checkboxes = popover?.querySelectorAll(
      '.assign-user-checkbox',
    ) as NodeListOf<HTMLInputElement>;
    expect(checkboxes[0].checked).toBe(true); // 101 Alice
    expect(checkboxes[1].checked).toBe(true); // 102 Bob
    expect(checkboxes[2].checked).toBe(false); // 103 Carol
    // No edit lightbox and no create call.
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });

  it('KB-3 (#8): unchecking the primary assignee recomputes assigned_to and calls saveUs', async () => {
    const { container, hookResult } = renderApp(
      {},
      { state: stateWithUs11, project: projectWithMembers },
    );

    fireEvent.click(container.querySelector('.mock-card-assign') as HTMLElement);
    const checkboxes = container.querySelectorAll(
      '.assign-user-checkbox',
    ) as NodeListOf<HTMLInputElement>;
    // Uncheck 101 (the current primary) -> selected becomes [102].
    fireEvent.click(checkboxes[0]);

    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-select-user .btn-save') as HTMLElement);
    });

    expect(hookResult.saveUs).toHaveBeenCalledTimes(1);
    const [usId, changed] = (hookResult.saveUs as jest.Mock).mock.calls[0];
    expect(usId).toBe(11);
    // assigned_to was 101; 101 is no longer selected, so it becomes the first of
    // the remaining set (102). assigned_users is the new set. version rides along.
    expect(changed).toEqual({ assigned_users: [102], assigned_to: 102, version: 7 });
    expect(container.querySelector('.lightbox-select-user')).not.toBeInTheDocument();
  });

  it('KB-3 (#8): clearing all assignees sets assigned_to to null', async () => {
    const { container, hookResult } = renderApp(
      {},
      { state: stateWithUs11, project: projectWithMembers },
    );

    fireEvent.click(container.querySelector('.mock-card-assign') as HTMLElement);
    const checkboxes = container.querySelectorAll(
      '.assign-user-checkbox',
    ) as NodeListOf<HTMLInputElement>;
    // Uncheck both seeded members -> empty set.
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-select-user .btn-save') as HTMLElement);
    });

    const [, changed] = (hookResult.saveUs as jest.Mock).mock.calls[0];
    expect(changed).toEqual({ assigned_users: [], assigned_to: null, version: 7 });
  });

  it('#8: card Edit is a no-op (no lightbox) when the story id cannot be resolved', () => {
    // Empty userstoriesRaw -> getUsModel returns undefined -> nothing opens.
    const { container } = renderApp({}, { state: emptyState });

    fireEvent.click(container.querySelector('.mock-card-edit') as HTMLElement);
    fireEvent.click(container.querySelector('.mock-card-assign') as HTMLElement);

    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
    expect(container.querySelector('.lightbox-select-user')).not.toBeInTheDocument();
  });

  // ---- #9: double-submit guard on the create form ----
  it('#9: two rapid Save clicks on the create form call addUsStandard exactly once', async () => {
    // A deferred addUsStandard keeps the first write in flight so the second
    // click hits the in-flight guard.
    let resolveCreate: () => void = () => undefined;
    const pending = new Promise<void>((res) => {
      resolveCreate = res;
    });
    const addUsStandard = jest.fn(() => pending);

    const { container } = renderApp({}, { addUsStandard });

    fireEvent.click(container.querySelector('.mock-add-standard') as HTMLElement);
    fireEvent.change(container.querySelector('.create-us-subject') as HTMLInputElement, {
      target: { value: 'Once only' },
    });

    const saveBtn = container.querySelector('.lightbox-create-edit .btn-save') as HTMLButtonElement;
    // Two rapid clicks BEFORE the first create resolves.
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(addUsStandard).toHaveBeenCalledTimes(1);
    // The Save button is disabled while the write is in flight.
    expect(saveBtn.disabled).toBe(true);

    // Let the write settle so the pending promise does not leak between tests.
    await act(async () => {
      resolveCreate();
      await pending;
    });
  });

  // ---- KB-4: delete confirm fires the pessimistic hook deleteUs ----
  it('KB-4: card Delete opens a confirm; confirming calls the hook deleteUs with the story', async () => {
    const { container, hookResult } = renderApp({}, { state: stateWithUs11 });

    // Delete opens the confirm dialog (no server call yet).
    fireEvent.click(container.querySelector('.mock-card-delete') as HTMLElement);
    expect(container.querySelector('.lightbox-create-edit')).toBeInTheDocument();
    expect(hookResult.deleteUs).not.toHaveBeenCalled();

    // Confirm -> pessimistic delete via the hook, then the dialog closes.
    await act(async () => {
      fireEvent.click(container.querySelector('.lightbox-create-edit .btn-delete') as HTMLElement);
    });

    expect(hookResult.deleteUs).toHaveBeenCalledTimes(1);
    expect((hookResult.deleteUs as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 11 }),
    );
    // The confirm dialog closes on confirm.
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });

  it('KB-4: cancelling the delete confirm does NOT call deleteUs', () => {
    const { container, hookResult } = renderApp({}, { state: stateWithUs11 });

    fireEvent.click(container.querySelector('.mock-card-delete') as HTMLElement);
    fireEvent.click(container.querySelector('.lightbox-create-edit .btn-cancel') as HTMLElement);

    expect(hookResult.deleteUs).not.toHaveBeenCalled();
    expect(container.querySelector('.lightbox-create-edit')).not.toBeInTheDocument();
  });
});


/* ------------------------------------------------------------------ *
 * Phase 10 — filter persistence to the URL (location.search)
 * ------------------------------------------------------------------ *
 * Proves KanbanApp wires the shared `filterUrl` helpers: it RESTORES the applied
 * filters + free-text `q` from `window.location.search` on mount (URL wins over
 * localStorage) and WRITES them back to the URL (via history.replaceState) when
 * they change — fixing the tracked MINOR deviation (filters were localStorage-only).
 */
describe('Phase 10: filter persistence to the URL', () => {
  it('restores applied filters from the URL query on mount (chips + preserved URL)', () => {
    window.history.replaceState(null, '', '/project/proj/kanban?tags=bug&q=hi');
    const { container } = renderApp();

    // Open the sidebar so the (mocked) FilterBar is rendered.
    fireEvent.click(container.querySelector('button.btn-filter.e2e-open-filter') as HTMLElement);
    const filterEl = container.querySelector('.mock-filter') as HTMLElement | null;
    // FilterBar receives the restored filter derived from ?tags=bug.
    expect(filterEl).not.toBeNull();
    expect(filterEl?.getAttribute('data-selected-count')).toBe('1');
    expect(filterEl?.getAttribute('data-selected-json')).toContain('"dataType":"tags"');
    expect(filterEl?.getAttribute('data-selected-json')).toContain('"id":"bug"');

    // The search input is seeded from ?q=hi and the URL is preserved.
    const search = container.querySelector('#kanban-filter-search') as HTMLInputElement;
    expect(search.value).toBe('hi');
    expect(window.location.search).toContain('tags=bug');
    expect(window.location.search).toContain('q=hi');
  });

  it('writes the free-text q to the URL when the search box changes', () => {
    window.history.replaceState(null, '', '/project/proj/kanban');
    const { container } = renderApp();
    const search = container.querySelector('#kanban-filter-search') as HTMLInputElement;

    act(() => {
      fireEvent.change(search, { target: { value: 'needle' } });
    });

    expect(window.location.search).toBe('?q=needle');
  });

  it('writes an applied filter to the URL when a chip is added', () => {
    window.history.replaceState(null, '', '/project/proj/kanban');
    const { container } = renderApp();
    fireEvent.click(container.querySelector('button.btn-filter.e2e-open-filter') as HTMLElement);

    act(() => {
      fireEvent.click(container.querySelector('.mock-add-filter') as HTMLElement);
    });

    // addFilter appends { dataType: 'tags', id: 'bug', mode: 'include' }.
    expect(window.location.search).toBe('?tags=bug');
  });

  it('falls back to localStorage when the URL has no managed params', () => {
    // Seed the per-project localStorage key the way a prior session would have.
    const stored = [{ id: 'foo', name: 'foo', dataType: 'tags', mode: 'include', color: null }];
    localStorage.setItem('proj:kanban-filters', JSON.stringify(stored));
    window.history.replaceState(null, '', '/project/proj/kanban');

    const { container } = renderApp();
    fireEvent.click(container.querySelector('button.btn-filter.e2e-open-filter') as HTMLElement);
    const filterEl = container.querySelector('.mock-filter') as HTMLElement;
    expect(filterEl.getAttribute('data-selected-count')).toBe('1');
    expect(filterEl.getAttribute('data-selected-json')).toContain('"id":"foo"');
    // The restored localStorage filter is ALSO mirrored to the URL by the effect.
    expect(window.location.search).toBe('?tags=foo');
  });
});
