/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanApp.dragOwnership.test.tsx
 * --------------------------------
 * Browserless Jest + React Testing Library integration spec for the Kanban
 * drag-end OWNERSHIP seam inside {@link KanbanApp}.
 *
 * WHY THIS SPEC IS SEPARATE FROM KanbanApp.test.tsx (QA finding F-COV-2)
 * ---------------------------------------------------------------------
 * The sibling `KanbanApp.test.tsx` MOCKS `createKanbanDragEndHandler`
 * (`../../shared/dnd/sortable`) at the module boundary, replacing it with a stub
 * that only invokes `deps.onMove`. That mock is file-wide (jest.mock is hoisted),
 * so the REAL handler's use of the injected `deps.getSelectedIds()` and
 * `deps.api.bulkUpdateKanbanOrder()` never executed — leaving the drag-wiring
 * `deps` object KanbanApp constructs (its `getSelectedIds`, its `onMove -> moveUs`
 * adapter, and its pass-through no-op `api`) UNCOVERED, and leaving the
 * single-call ownership invariant UN-ASSERTED. This spec therefore lives in its
 * OWN file where `createKanbanDragEndHandler` is NOT mocked (the real factory
 * runs), so those exact lines execute and the invariant is proven end-to-end.
 *
 * THE INVARIANT UNDER TEST (single network call per drop)
 * -------------------------------------------------------
 * `KanbanApp` wires drag-end so that `board.moveUs` (the hook) performs BOTH the
 * optimistic reducer move AND the one authoritative `/api/v1/`
 * `bulk_update_kanban_order` write. To guarantee a drop is not double-persisted,
 * KanbanApp injects a PASS-THROUGH no-op `api` into `createKanbanDragEndHandler`,
 * so the handler's own `api.bulkUpdateKanbanOrder(...)` is inert and the REAL
 * `../../shared/api/userstories` adapter is NEVER reached from the drag path.
 * This spec fires a real drop through the real handler and asserts:
 *   - the hook's `moveUs` is called EXACTLY ONCE with the computed geometry, and
 *   - the real `userstories.bulkUpdateKanbanOrder` adapter is NEVER called.
 * It also covers the same-container / unchanged-index NO-OP guard (a drop in
 * place must call neither `moveUs` nor any adapter).
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7 — HARD RULES): browserless. Jest + jsdom +
 * React Testing Library ONLY — NO Playwright, NO real browser, NO network. The
 * effectful hook (`../hooks/useKanbanBoard`), the presentational children
 * (`./components/Board|FilterBar|ZoomControl`) and the `../../shared/dnd/
 * DndProvider` are mocked; the `/api/v1/` adapter is mocked DEFENSIVELY (and
 * asserted NEVER called). Crucially, `../../shared/dnd/sortable` is NOT mocked —
 * the real `createKanbanDragEndHandler` runs. Contributes to the >=70% global
 * line-coverage gate over `app/react/**` (AAP 0.2.1 / 0.7.1) by covering the
 * KanbanApp drag-wiring `deps` object.
 *
 * MOCK STYLE: `jest.mock` factories use `require('react')` + `createElement`
 * (never JSX) to avoid Jest's out-of-scope-variable restriction on the injected
 * automatic-JSX runtime binding inside a hoisted factory.
 */

import { render, act } from '@testing-library/react';

import { KanbanApp } from '../KanbanApp';
import type { KanbanAppProps } from '../KanbanApp';
import { useKanbanBoard } from '../hooks/useKanbanBoard';
import type { UseKanbanBoardResult } from '../hooks/useKanbanBoard';
// The DEFAULT export of the api module is what `../../shared/dnd/sortable`
// imports (`import userstories from '../api/userstories'`) and would fall back to
// if no `api` were injected. Imported here (mocked below) so the never-called
// assertion has a handle.
import userstoriesApi from '../../shared/api/userstories';

/* ------------------------------------------------------------------ *
 * Module mocks (hoisted by ts-jest above the imports)
 * ------------------------------------------------------------------ *
 * NOTE: `../../shared/dnd/sortable` is DELIBERATELY NOT mocked — the REAL
 * `createKanbanDragEndHandler` must run so the KanbanApp `deps` object executes.
 */

// Effectful data hook — replaced wholesale (no load / WebSocket / API). Each test
// drives the return value via `makeHookResult(...)`.
jest.mock('../hooks/useKanbanBoard', () => ({
  __esModule: true,
  useKanbanBoard: jest.fn(),
}));

// Board stub (DEFAULT export of `./components/Board`). Rendered inside the real
// DnD boundary; a marker node is enough (the drop is fired via the captured
// handler, not via real pointer events). The board-prop callbacks KanbanApp
// composes (e.g. `foldedSwimlane`, `isUsArchivedHidden`) are intentionally NOT
// invoked here — they require richer board state and are exercised by the
// dedicated Board/hook specs, not this drag-ownership spec.
jest.mock('../components/Board', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      react.createElement('div', {
        className: 'mock-board',
        'data-swimlanes': String(props.swimlanesList ? props.swimlanesList.length : 0),
      }),
  };
});

// FilterBar stub (DEFAULT export of `./components/FilterBar`).
jest.mock('../components/FilterBar', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (_props: any) => react.createElement('div', { className: 'mock-filter' }),
  };
});

// ZoomControl stub (DEFAULT export of `./components/ZoomControl`).
jest.mock('../components/ZoomControl', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (_props: any) => react.createElement('div', { className: 'mock-zoom' }),
  };
});

// DndProvider passthrough (NAMED + default export of `../../shared/dnd/DndProvider`):
// CAPTURES the `onDragEnd` KanbanApp computed (the REAL handler) onto a global so
// the test can invoke it directly with a synthetic DragEndEvent — exercising the
// real factory's `deps.getSelectedIds()` / `deps.onMove` / `deps.api` usage.
jest.mock('../../shared/dnd/DndProvider', () => {
  const react = require('react');
  const DndProvider = (props: any) => {
    (globalThis as any).__dragOwnershipDndProps = props;
    return react.createElement(
      'div',
      { className: 'mock-dnd-provider', 'data-mode': props.mode },
      props.children,
    );
  };
  return { __esModule: true, DndProvider, default: DndProvider };
});

// Defensive api mock. The real drag handler receives KanbanApp's injected no-op
// `api`, so it NEVER reaches this adapter; the module is mocked so nothing in the
// graph can hit real HTTP, and so the ownership assertion has a stable handle.
// Shape matches `userstories.ts`: named functions + a `userstories` aggregate +
// a `default` aggregate (sortable.ts imports the DEFAULT).
jest.mock('../../shared/api/userstories', () => {
  const bulkCreate = jest.fn(() => Promise.resolve({}));
  const bulkUpdateKanbanOrder = jest.fn(() => Promise.resolve({}));
  const bulkUpdateBacklogOrder = jest.fn(() => Promise.resolve({}));
  const bulkUpdateMilestone = jest.fn(() => Promise.resolve({}));
  const agg = { bulkCreate, bulkUpdateKanbanOrder, bulkUpdateBacklogOrder, bulkUpdateMilestone };
  return { __esModule: true, ...agg, userstories: agg, default: agg };
});

/* ------------------------------------------------------------------ *
 * Typed mock handles
 * ------------------------------------------------------------------ */

const mockUseKanbanBoard = useKanbanBoard as unknown as jest.Mock;
// The real drag handler is async; captured off the mocked DndProvider props.
type DragEndHandler = (event: unknown) => Promise<void> | void;

function capturedOnDragEnd(): DragEndHandler {
  const props = (globalThis as any).__dragOwnershipDndProps;
  if (!props || typeof props.onDragEnd !== 'function') {
    throw new Error('DndProvider onDragEnd was not captured — KanbanApp did not render the DnD boundary.');
  }
  return props.onDragEnd as DragEndHandler;
}

/* ------------------------------------------------------------------ *
 * `useKanbanBoard` return-value factory (controlled `UseKanbanBoardResult`)
 * ------------------------------------------------------------------ *
 * Full shape the real hook exposes (mirrors `KanbanApp.test.tsx`), with a
 * resolved admin project + all permissions so KanbanApp renders its board shell
 * (and therefore the `<DndProvider onDragEnd=...>` boundary). `moveUs` is the
 * jest.fn the ownership assertion inspects.
 */
function makeHookResult(overrides: Partial<UseKanbanBoardResult> = {}): UseKanbanBoardResult {
  const base = {
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
    isFirstLoad: false,
    loading: false,
    isLightboxOpened: false,
    notFoundUserstories: false,
    permissionError: false,
    loadError: null,
    writeError: null,
    moveUs: jest.fn(() => Promise.resolve()),
    moveUsToTop: jest.fn(() => Promise.resolve()),
    addUs: jest.fn(),
    addUsBulk: jest.fn(() => Promise.resolve()),
    addUsStandard: jest.fn(() => Promise.resolve()),
    editUs: jest.fn(),
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

function renderApp(props: Partial<KanbanAppProps> = {}, hookOverrides: Partial<UseKanbanBoardResult> = {}) {
  const hookResult = makeHookResult(hookOverrides);
  mockUseKanbanBoard.mockReturnValue(hookResult);
  const utils = render(<KanbanApp projectSlug="proj" {...props} />);
  return { ...utils, hookResult };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseKanbanBoard.mockReturnValue(makeHookResult());
  delete (globalThis as any).__dragOwnershipDndProps;
});

afterEach(() => {
  delete (globalThis as any).__dragOwnershipDndProps;
});

describe('KanbanApp — drag-end ownership (real createKanbanDragEndHandler)', () => {
  it('routes a cross-column drop to the hook moveUs EXACTLY ONCE and never calls the real adapter', async () => {
    const { hookResult } = renderApp();

    // Synthetic @dnd-kit DragEndEvent taking the DATA PATH (no `columnEl`): a card
    // (#11, source status 1) dropped over sibling card #12 in a DIFFERENT column
    // (status 2). Different status => NOT the no-op guard => the handler proceeds,
    // reads the moved-id set via `deps.getSelectedIds()`, applies the optimistic
    // update via `deps.onMove` (=> moveUs), then awaits the injected no-op `api`.
    const event = {
      active: { id: 11, data: { current: { statusId: 1, swimlaneId: -1, oldIndex: 0 } } },
      over: { id: 12, data: { current: { statusId: 2, swimlaneId: -1, orderedIds: [12] } } },
    };

    await act(async () => {
      await capturedOnDragEnd()(event);
    });

    // Single-call ownership: the hook's moveUs owns the ONE state+network action.
    // Geometry: [{id:11}] to status 2, swimlane -1 (unclassified), index 0, after
    // null, before 12 (the simulated drop makes #11 land ahead of #12).
    expect(hookResult.moveUs).toHaveBeenCalledTimes(1);
    expect(hookResult.moveUs).toHaveBeenCalledWith([{ id: 11 }], 2, -1, 0, null, 12);

    // The drag path used the injected pass-through `api`, so the REAL bulk-order
    // adapter was NEVER reached — no double network write.
    expect(userstoriesApi.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });

  it('treats a same-container, same-index drop as a NO-OP (no moveUs, no adapter call)', async () => {
    const { hookResult } = renderApp();

    // Drop #11 back onto itself in its ORIGINAL column (status 1) at its original
    // index 0 => same container AND unchanged index => the guard returns early.
    const event = {
      active: { id: 11, data: { current: { statusId: 1, swimlaneId: -1, oldIndex: 0 } } },
      over: { id: 11, data: { current: { statusId: 1, swimlaneId: -1, orderedIds: [11] } } },
    };

    await act(async () => {
      await capturedOnDragEnd()(event);
    });

    // A drop in place persists nothing and mutates no state.
    expect(hookResult.moveUs).not.toHaveBeenCalled();
    expect(userstoriesApi.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });
});
