/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Kanban CONTAINER component `KanbanApp`
 * (`../KanbanApp`).
 *
 * WHAT IS UNDER TEST
 *   `KanbanApp` is the top-level React component mounted by the custom element
 *   `<tg-react-kanban>` (via `../../shared/mount.tsx`). It is the React
 *   re-expression of the AngularJS `KanbanController`
 *   (`app/coffee/modules/kanban/main.coffee`) and the `kanban.jade` screen shell.
 *   As a CONTAINER it owns view state — zoom (persisted in
 *   `localStorage['kanban_zoom']`), the filter panel + debounced search query,
 *   multi-select, status-column folds, swimlane folds, the moved-card highlight —
 *   and delegates ALL board data / immutable math to `useKanbanBoard`,
 *   drag-and-drop to `KanbanDndContext`, and every `/api/v1/` call to
 *   `../../shared/*`, while composing the presentational children (`Swimlane` +
 *   `SwimlaneAddLink`, `TaskboardColumn`, `FiltersSidebar`).
 *
 *   This spec deliberately ISOLATES the container's orchestration wiring by
 *   MOCKING the hook, the DnD context, the three child components, and the one
 *   shared api function the container calls directly (`filtersData`). The
 *   children's own behaviour is exercised by their dedicated specs in this
 *   folder; here they are inert stubs that expose a `data-testid` and capture
 *   their props, so composition and prop wiring can be asserted without loading
 *   any real `@dnd-kit`, `/api/v1/` client, WebSocket bridge or session reader.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../KanbanApp.tsx`) was opened FIRST and this spec
 *   asserts ITS contract exactly (the component is NOT modified):
 *     - Props are `{ projectId?: string; projectSlug?: string; [k: string]:
 *       string | undefined }`; the container coerces with `Number(props.projectId)`
 *       and passes an OBJECT `{ projectId, zoomLevel, filterQ, filterParams }` to
 *       `useKanbanBoard` UNCONDITIONALLY (Rules of Hooks), so a `"7"` attribute
 *       yields `useKanbanBoard({ projectId: 7, ... })`.
 *     - There are TWO leading render branches: (1) an inert host
 *       `<div class="wrapper" data-tg-react-kanban="invalid-project">` when the
 *       `project-id` attribute is not a finite number; (2) otherwise the full
 *       shell (`section.main.kanban`, header, zoom control, manager), where the
 *       board (`KanbanDndContext` wrapping `.kanban-table`) renders ONLY once
 *       `board.initialLoad && board.project` are both truthy.
 *     - `onMoveUs` reproduces `KanbanController.moveUs` (SOURCE 596-632): it
 *       clears the selection, maps the drag payload to ids, and calls
 *       `board.move(usIds, newStatus, newSwimlane, index, previousCard, nextCard)`
 *       with the argument order FROZEN and the raw `newSwimlane` (including the
 *       synthetic `-1`) forwarded unchanged — the `-1 -> null` mapping lives in
 *       the hook, not the container.
 *     - `onClickMoveToTop` reproduces `moveUsToTop` (SOURCE 160-184): it looks the
 *       card up in `usMap`, finds the first id in the target status/swimlane list,
 *       maps a `null` swimlane to the synthetic `-1`, and delegates to the same
 *       move pipeline.
 *     - The inline `StatusColumnHeader` (SquishColumn/ArchivedStatusHeader are not
 *       in the dependency whitelist) renders the fold ("Fold column") and unfold
 *       ("Unfold column") buttons; folding/unfolding an ARCHIVED status column
 *       calls `board.hideArchivedStatus` / `board.showArchivedStatus`. On the
 *       first load every archived column is force-folded (SOURCE squish
 *       `$watch 'ctrl.initialLoad'`).
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
 */

import { render, screen, within, fireEvent, act } from '@testing-library/react';

import { KanbanApp } from '../KanbanApp';
import { useKanbanBoard } from '../state/useKanbanBoard';
import { filtersData } from '../../shared/api/userstories';
import { makeProject, makeStatus, makeSwimlane, makeUserStory, makeBoardCard, makeUsMap } from './factories';

import type { UseKanbanBoardResult } from '../state/useKanbanBoard';

/* ========================================================================== *
 * Captured child props
 *
 * A single module-scoped record the stub components write their received props
 * into on every render. Its name is prefixed with `mock` so the ts-jest module
 * hoister permits the `jest.mock` factories below to reference it. Reset in
 * `beforeEach`.
 * ========================================================================== */

const mockCaptured: {
  dnd: any;
  filters: any;
  swimlaneAddLink: any;
  swimlane: any[];
  column: any[];
} = {
  dnd: null,
  filters: null,
  swimlaneAddLink: null,
  swimlane: [],
  column: [],
};

/* ========================================================================== *
 * Module mocks (hoisted above the imports by ts-jest)
 *
 * - `useKanbanBoard` is replaced by a bare `jest.fn()` (factory mock), so the
 *   real hook — and therefore its shared api / session / events graph — is
 *   NEVER loaded. Its `{ ... }` return is configured per test via `primeBoard`.
 * - `filtersData` (the one shared-api function the CONTAINER calls directly, in
 *   an effect) is a `jest.fn()` resolving to `{}` by default, so no real
 *   `/api/v1/` client / session reader is loaded.
 * - `KanbanDndContext` is a PASS-THROUGH stub: it renders its children so the
 *   wrapped `.kanban-table` stays in the tree, and records its props (esp.
 *   `onMoveUs`). No real `@dnd-kit` sensor is required.
 * - `Swimlane` / `SwimlaneAddLink` and `TaskboardColumn` are LEAF stubs exposing
 *   stable `data-testid`s and recording their props, so composition and prop
 *   wiring can be asserted without importing the real children.
 * ========================================================================== */

jest.mock('../state/useKanbanBoard', () => ({
  __esModule: true,
  useKanbanBoard: jest.fn(),
}));

jest.mock('../../shared/api/userstories', () => ({
  __esModule: true,
  filtersData: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../dnd/KanbanDndContext', () => ({
  __esModule: true,
  KanbanDndContext: (props: any) => {
    mockCaptured.dnd = props;
    return <div data-testid="dnd-context">{props.children}</div>;
  },
}));

jest.mock('../components/Swimlane', () => ({
  __esModule: true,
  Swimlane: (props: any) => {
    mockCaptured.swimlane.push(props);
    return <div data-testid="swimlane" data-swimlane-id={String(props.swimlane?.id)} />;
  },
  SwimlaneAddLink: (props: any) => {
    mockCaptured.swimlaneAddLink = props;
    return <div data-testid="swimlane-add-link" />;
  },
}));

jest.mock('../components/TaskboardColumn', () => ({
  __esModule: true,
  TaskboardColumn: (props: any) => {
    mockCaptured.column.push(props);
    return <div data-testid="taskboard-column" data-status={String(props.status?.id)} />;
  },
}));

jest.mock('../components/FiltersSidebar', () => ({
  __esModule: true,
  FiltersSidebar: (props: any) => {
    mockCaptured.filters = props;
    return <div data-testid="filters-sidebar" />;
  },
}));

/**
 * Strongly-typed handle onto the factory-mocked hook. `jest.MockedFunction`
 * preserves the original signature (resolved from the real module's types,
 * which TypeScript uses regardless of the runtime mock) so `.mockReturnValue`
 * and the `toHaveBeenCalledWith` assertions stay type-checked.
 */
const mockUseKanbanBoard = useKanbanBoard as jest.MockedFunction<typeof useKanbanBoard>;
const mockFiltersData = filtersData as jest.MockedFunction<typeof filtersData>;

/* ========================================================================== *
 * Board view-model builder
 * ========================================================================== */

/**
 * Build a complete {@link UseKanbanBoardResult}, defaulting every collection to
 * empty and every action to a fresh spy, then applying `overrides`. The
 * `: UseKanbanBoardResult` return annotation makes TypeScript enforce field
 * completeness, so any drift in the hook's contract surfaces as a `tsc` error
 * here rather than a silent runtime gap. `move` resolves so the container's
 * `board.move(...).then(...)` chain settles.
 */
function makeBoard(overrides: Partial<UseKanbanBoardResult> = {}): UseKanbanBoardResult {
  return {
    usByStatus: {},
    usMap: {},
    usByStatusSwimlanes: {},
    swimlanesList: [],
    project: null,
    usStatusList: [],
    swimlanesStatuses: {},
    initialLoad: false,
    loading: false,
    notFoundUserstories: false,
    move: jest.fn(() => Promise.resolve()),
    toggleFold: jest.fn(),
    showArchivedStatus: jest.fn(),
    hideArchivedStatus: jest.fn(),
    reload: jest.fn(),
    ...overrides,
  };
}

/** The board object primed for the current test (the SAME object the container
 * renders from AND on whose `move` / archived-toggle spies the test asserts). */
let currentBoard: UseKanbanBoardResult;

/**
 * Configure the mocked hook to return a fresh {@link makeBoard} (with the
 * supplied overrides) for the next render, and stash it in {@link currentBoard}.
 */
function primeBoard(overrides: Partial<UseKanbanBoardResult> = {}): UseKanbanBoardResult {
  currentBoard = makeBoard(overrides);
  mockUseKanbanBoard.mockReturnValue(currentBoard);
  return currentBoard;
}

/** Render `KanbanApp` with string attributes, type-checked against its props. */
function renderApp(
  projectId: string | undefined = '7',
  projectSlug: string | undefined = 'proj-7',
): ReturnType<typeof render> {
  return render(<KanbanApp projectId={projectId} projectSlug={projectSlug} />);
}

/**
 * Prime a fully-loaded, NO-swimlane board with two statuses (100 "New", 200
 * "Done"), a single card (id 1) in status 100, and a project. Used by the
 * board-composition, move, select and card-action specs.
 */
function primeLoadedNoSwimlane(projectOverrides = {}): UseKanbanBoardResult {
  const s100 = makeStatus({ id: 100, name: 'New', order: 1, is_archived: false });
  const s200 = makeStatus({ id: 200, name: 'Done', order: 2, is_archived: false });
  const card = makeBoardCard({ model: makeUserStory({ id: 1, status: 100, swimlane: null }) });
  return primeBoard({
    project: makeProject(projectOverrides),
    initialLoad: true,
    usStatusList: [s100, s200],
    usByStatus: { '100': [1], '200': [] },
    usMap: makeUsMap([card]),
  });
}

/* ========================================================================== *
 * Lifecycle
 * ========================================================================== */

beforeEach(() => {
  // A clean slate: no persisted zoom / fold state bleeds between tests.
  localStorage.clear();
  mockCaptured.dnd = null;
  mockCaptured.filters = null;
  mockCaptured.swimlaneAddLink = null;
  mockCaptured.swimlane = [];
  mockCaptured.column = [];
  mockFiltersData.mockReset();
  mockFiltersData.mockResolvedValue({});
  // Default: nothing loaded yet (initialLoad === false, project === null).
  primeBoard();
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('KanbanApp', () => {
  describe('projectId coercion', () => {
    it('coerces the string project-id attribute to a number in the hook params', () => {
      renderApp('7', 'proj-7');

      // The container calls `useKanbanBoard({ projectId: Number(props.projectId), ... })`
      // — proving the coercion to the NUMBER 7 (not the "7" string).
      expect(mockUseKanbanBoard).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 7 }),
      );
    });

    it('does not pass the raw string "7" as projectId to the hook', () => {
      renderApp('7', 'proj-7');

      // Jest distinguishes 7 from "7"; asserting the string was NOT used guards
      // against a regression that drops the `Number(...)` coercion.
      expect(mockUseKanbanBoard).not.toHaveBeenCalledWith(
        expect.objectContaining({ projectId: '7' }),
      );
    });

    it('passes the current zoom level, search query and filter params to the hook', () => {
      renderApp();

      // On first render: default zoom 1 (cleared localStorage), empty query, no
      // filter params — the four documented hook params are all present.
      expect(mockUseKanbanBoard).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 7,
          zoomLevel: 1,
          filterQ: '',
          filterParams: {},
        }),
      );
    });
  });

  describe('invalid project-id guard', () => {
    it('renders the inert host and no board when project-id is not a number', () => {
      const { container } = renderApp('not-a-number');

      // `Number("not-a-number")` is NaN -> `projectIdValid` is false -> the
      // container short-circuits to the inert wrapper host.
      expect(
        container.querySelector('[data-tg-react-kanban="invalid-project"]'),
      ).not.toBeNull();

      // Neither the shell nor the board subtree renders on the invalid branch.
      expect(container.querySelector('section.main.kanban')).toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });

    it('still calls the hook unconditionally (Rules of Hooks) even when invalid', () => {
      renderApp('not-a-number');

      // The hook is invoked before the guard returns, so it is always called.
      expect(mockUseKanbanBoard).toHaveBeenCalled();
    });

    it('treats a missing project-id (undefined) as invalid', () => {
      // Render WITHOUT a `projectId` prop (not via `renderApp`, whose defaulted
      // parameter would substitute "7" when passed `undefined`). The custom
      // element mounted without a `project-id` attribute yields `props.projectId
      // === undefined` -> `Number(undefined)` is NaN -> the invalid branch.
      const { container } = render(<KanbanApp projectSlug="proj-7" />);

      expect(
        container.querySelector('[data-tg-react-kanban="invalid-project"]'),
      ).not.toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });
  });

  describe('board render gating (initialLoad && project)', () => {
    it('renders the shell but gates the board off before the first load resolves', () => {
      // A loaded project but initialLoad still false -> shell yes, board no.
      primeBoard({ project: makeProject(), initialLoad: false });
      const { container } = renderApp();

      expect(container.querySelector('.kanban-header')).not.toBeNull();
      expect(container.querySelector('.taskboard-actions')).not.toBeNull();
      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });

    it('gates the board off when initialLoad is true but the project has not loaded', () => {
      primeBoard({ project: null, initialLoad: true });
      renderApp();

      expect(screen.queryByTestId('dnd-context')).toBeNull();
    });
  });

  describe('no-swimlane render & shell classes', () => {
    it('emits the exact shell class names verbatim', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      // Section: `main kanban` WITHOUT the `swimlane` modifier (no swimlanes).
      const section = container.querySelector('section.main.kanban');
      expect(section).not.toBeNull();
      expect(section?.classList.contains('swimlane')).toBe(false);

      // Header + actions + option groups + filter button.
      expect(container.querySelector('.kanban-header')).not.toBeNull();
      expect(container.querySelector('.taskboard-actions')).not.toBeNull();
      expect(container.querySelector('.kanban-table-options-start')).not.toBeNull();
      expect(container.querySelector('.kanban-table-options-end')).not.toBeNull();
      expect(container.querySelector('.btn-filter.e2e-open-filter')).not.toBeNull();

      // Manager carries `expanded` while the filter panel is closed (default).
      const manager = container.querySelector('.kanban-manager');
      expect(manager).not.toBeNull();
      expect(manager?.classList.contains('expanded')).toBe(true);

      // Zoom control present; board table carries the default `zoom-1` class and
      // NOT the swimlane variant.
      expect(container.querySelector('.board-zoom')).not.toBeNull();
      const table = container.querySelector('.kanban-table');
      expect(table).not.toBeNull();
      expect(table?.classList.contains('zoom-1')).toBe(true);
      expect(table?.classList.contains('kanban-table-swimlane')).toBe(false);
    });

    it('wraps the board in the DnD context and renders one TaskboardColumn per status', () => {
      primeLoadedNoSwimlane();
      renderApp();

      const dnd = screen.getByTestId('dnd-context');
      expect(dnd).toBeInTheDocument();

      // Columns are DESCENDANTS of the DnD-context stub (composition proof).
      const columns = within(dnd).getAllByTestId('taskboard-column');
      expect(columns).toHaveLength(2);

      // The status-100 column received its card id list `[1]`.
      const col100 = mockCaptured.column.find((c) => c.status.id === 100);
      expect(col100).toBeDefined();
      expect(col100.cardIds).toEqual([1]);

      // No swimlane subtree in no-swimlane mode.
      expect(screen.queryByTestId('swimlane')).toBeNull();
      expect(screen.queryByTestId('swimlane-add-link')).toBeNull();
    });

    it('renders one inline status-column header per status', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      expect(container.querySelectorAll('.task-colum-name')).toHaveLength(2);
    });
  });

  describe('swimlane render & SwimlaneAddLink composition', () => {
    function primeSwimlaneBoard(): UseKanbanBoardResult {
      const s100 = makeStatus({ id: 100, name: 'New', order: 1 });
      const sw10 = makeSwimlane({ id: 10, name: 'Swimlane A', order: 1 });
      const card = makeBoardCard({ model: makeUserStory({ id: 1, status: 100, swimlane: 10 }) });
      return primeBoard({
        project: makeProject(),
        initialLoad: true,
        usStatusList: [s100],
        swimlanesList: [sw10],
        swimlanesStatuses: { '10': [s100] },
        usByStatusSwimlanes: { '10': { '100': [1] } },
        usMap: makeUsMap([card]),
      });
    }

    it('adds the `swimlane` section modifier and the `kanban-table-swimlane` table class', () => {
      primeSwimlaneBoard();
      const { container } = renderApp();

      const section = container.querySelector('section.main.kanban');
      expect(section?.classList.contains('swimlane')).toBe(true);

      const table = container.querySelector('.kanban-table');
      expect(table?.classList.contains('kanban-table-swimlane')).toBe(true);
    });

    it('renders one Swimlane per entry plus a single SwimlaneAddLink', () => {
      primeSwimlaneBoard();
      renderApp();

      expect(screen.getAllByTestId('swimlane')).toHaveLength(1);
      expect(screen.getByTestId('swimlane-add-link')).toBeInTheDocument();

      // The container hands the Swimlane a `getColumnCardIds` that reads the
      // per-swimlane grouping: swimlane 10 / status 100 -> [1].
      expect(typeof mockCaptured.swimlane[0].getColumnCardIds).toBe('function');
      expect(mockCaptured.swimlane[0].getColumnCardIds(100)).toEqual([1]);

      // SwimlaneAddLink receives the swimlane count (its own gate is tested in
      // Swimlane.test.tsx; here we assert the container passes the count).
      expect(mockCaptured.swimlaneAddLink.swimlaneCount).toBe(1);
    });
  });

  describe('filter panel toggle', () => {
    it('opens the filter sidebar, drops the manager `expanded` class and marks the button active', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      // Closed initially.
      expect(container.querySelector('.kanban-filter')).toBeNull();
      expect(screen.queryByTestId('filters-sidebar')).toBeNull();
      expect(container.querySelector('.btn-filter')?.classList.contains('active')).toBe(false);
      expect(container.querySelector('.kanban-manager')?.classList.contains('expanded')).toBe(true);

      fireEvent.click(container.querySelector('.btn-filter.e2e-open-filter') as HTMLElement);

      // Open: sidebar mounts inside `.kanban-filter`, button active, manager
      // loses `expanded`.
      expect(container.querySelector('.kanban-filter')).not.toBeNull();
      expect(screen.getByTestId('filters-sidebar')).toBeInTheDocument();
      expect(container.querySelector('.btn-filter')?.classList.contains('active')).toBe(true);
      expect(container.querySelector('.kanban-manager')?.classList.contains('expanded')).toBe(false);
    });

    it('hands the FiltersSidebar an empty custom-filter list and function callbacks', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      fireEvent.click(container.querySelector('.btn-filter.e2e-open-filter') as HTMLElement);

      expect(mockCaptured.filters).not.toBeNull();
      expect(mockCaptured.filters.customFilters).toEqual([]);
      expect(Array.isArray(mockCaptured.filters.filters)).toBe(true);
      expect(Array.isArray(mockCaptured.filters.selectedFilters)).toBe(true);
      expect(typeof mockCaptured.filters.onAddFilter).toBe('function');
      expect(typeof mockCaptured.filters.onRemoveFilter).toBe('function');
      expect(typeof mockCaptured.filters.onSelectCustomFilter).toBe('function');
      expect(typeof mockCaptured.filters.onRemoveCustomFilter).toBe('function');
      expect(typeof mockCaptured.filters.onSaveCustomFilter).toBe('function');
    });
  });

  describe('zoom control', () => {
    it('persists the chosen zoom level to localStorage and updates the board zoom class', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      const radios = container.querySelectorAll(
        '.board-zoom input[type="radio"]',
      ) as NodeListOf<HTMLInputElement>;
      expect(radios).toHaveLength(4);

      // Click "Expanded" (value 3). Even the first zoom change writes localStorage
      // and updates the class (the first-load branch does not gate those).
      fireEvent.click(radios[3]);

      expect(localStorage.getItem('kanban_zoom')).toBe('3');
      const table = container.querySelector('.kanban-table');
      expect(table?.classList.contains('zoom-3')).toBe(true);
      expect(table?.classList.contains('zoom-1')).toBe(false);
    });

    it('does not flash the zoom-loading indicator on the very first zoom change', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      const radios = container.querySelectorAll(
        '.board-zoom input[type="radio"]',
      ) as NodeListOf<HTMLInputElement>;

      // The first zoom application is the "initial load" branch (SOURCE 135-138):
      // it resets folds but does NOT set the heavy-reload loading flag.
      fireEvent.click(radios[3]);

      expect(container.querySelector('.zoom-loading')).toBeNull();
    });

    it('shows and then auto-clears the zoom-loading flash when a later change crosses the heavy threshold', async () => {
      jest.useFakeTimers();
      try {
        primeLoadedNoSwimlane();
        const { container } = renderApp();

        // Flush the mount-time filtersData microtask so its setState does not race
        // the fake-timer assertions below.
        await act(async () => {
          await Promise.resolve();
        });

        const radios = container.querySelectorAll(
          '.board-zoom input[type="radio"]',
        ) as NodeListOf<HTMLInputElement>;

        // First change consumes the initial-load branch (no loading flash).
        fireEvent.click(radios[2]); // value 2 (<= threshold)
        expect(container.querySelector('.zoom-loading')).toBeNull();

        // Second change crosses `<= 2 -> > 2` (SOURCE 142-147) -> loading flash.
        fireEvent.click(radios[3]); // value 3 (> threshold)
        expect(container.querySelector('.zoom-loading')).not.toBeNull();

        // The flash auto-clears after its timeout.
        act(() => {
          jest.advanceTimersByTime(600);
        });
        expect(container.querySelector('.zoom-loading')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('search query', () => {
    it('reflects the typed value and debounces it into the hook filterQ param', async () => {
      jest.useFakeTimers();
      try {
        primeLoadedNoSwimlane();
        const { container } = renderApp();

        await act(async () => {
          await Promise.resolve();
        });

        const input = container.querySelector(
          '.tg-input-search input[type="search"]',
        ) as HTMLInputElement;
        expect(input).not.toBeNull();

        fireEvent.change(input, { target: { value: 'login bug' } });

        // Controlled input reflects the value immediately.
        expect(input.value).toBe('login bug');

        // The debounced value reaches the hook only after the debounce window.
        act(() => {
          jest.advanceTimersByTime(250);
        });

        const sawDebouncedQuery = mockUseKanbanBoard.mock.calls.some(
          ([params]) => params.filterQ === 'login bug',
        );
        expect(sawDebouncedQuery).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('moveUs pipeline (onMoveUs -> board.move)', () => {
    it('forwards the frozen argument order and the raw swimlane id to board.move', async () => {
      const board = primeLoadedNoSwimlane();
      renderApp();

      expect(mockCaptured.dnd).not.toBeNull();
      expect(typeof mockCaptured.dnd.onMoveUs).toBe('function');

      const finalUsList = [{ id: 1, oldStatusId: 100, oldSwimlaneId: null }];

      await act(async () => {
        // (finalUsList, newStatus, newSwimlane, index, previousCard, nextCard)
        mockCaptured.dnd.onMoveUs(finalUsList, 200, -1, 0, null, 5);
      });

      // Argument order FROZEN to SOURCE `moveUs`; the raw `-1` swimlane is
      // forwarded unchanged (the `-1 -> null` mapping lives in the hook).
      expect(board.move).toHaveBeenCalledWith([1], 200, -1, 0, null, 5);
    });

    it('clears the multi-selection before performing the move', async () => {
      const board = primeLoadedNoSwimlane();
      renderApp();

      // Select card 1 via a column callback, then confirm the selection is
      // observed as active on the next render.
      act(() => {
        mockCaptured.column[0].onToggleSelectedUs(1);
      });
      let latestColumn = mockCaptured.column[mockCaptured.column.length - 1];
      expect(latestColumn.selectedUss[1]).toBe(true);

      await act(async () => {
        mockCaptured.dnd.onMoveUs([{ id: 1, oldStatusId: 100, oldSwimlaneId: null }], 200, -1, 0, null, null);
      });

      // SOURCE 597: the move clears the selection first.
      expect(board.move).toHaveBeenCalled();
      latestColumn = mockCaptured.column[mockCaptured.column.length - 1];
      expect(latestColumn.selectedUss[1]).toBeFalsy();
    });
  });

  describe('moveUsToTop (onClickMoveToTop)', () => {
    it('computes the first card in the target column and delegates to the move pipeline', async () => {
      const s100 = makeStatus({ id: 100, name: 'New', order: 1 });
      const cards = [
        makeBoardCard({ model: makeUserStory({ id: 7, status: 100, swimlane: null }) }),
        makeBoardCard({ model: makeUserStory({ id: 1, status: 100, swimlane: null }) }),
        makeBoardCard({ model: makeUserStory({ id: 2, status: 100, swimlane: null }) }),
      ];
      const board = primeBoard({
        project: makeProject(),
        initialLoad: true,
        usStatusList: [s100],
        usByStatus: { '100': [7, 1, 2] },
        usMap: makeUsMap(cards),
      });

      renderApp();

      await act(async () => {
        mockCaptured.column[0].onClickMoveToTop(1);
      });

      // nextUsId is the FIRST id in status 100 -> 7; a null swimlane maps to the
      // synthetic `-1`; index 0; previousCard null (SOURCE 172-184).
      expect(board.move).toHaveBeenCalledWith([1], 100, -1, 0, null, 7);
    });

    it('does nothing when the moved card is not in the board map', async () => {
      const board = primeLoadedNoSwimlane();
      renderApp();

      await act(async () => {
        mockCaptured.column[0].onClickMoveToTop(9999); // unknown id
      });

      expect(board.move).not.toHaveBeenCalled();
    });
  });

  describe('multi-select (onToggleSelectedUs)', () => {
    it('toggles a card id in the selection set on successive calls', () => {
      primeLoadedNoSwimlane();
      renderApp();

      const toggle = mockCaptured.column[0].onToggleSelectedUs;
      expect(typeof toggle).toBe('function');

      act(() => toggle(1));
      let latest = mockCaptured.column[mockCaptured.column.length - 1];
      expect(latest.selectedUss[1]).toBe(true);

      act(() => toggle(1));
      latest = mockCaptured.column[mockCaptured.column.length - 1];
      expect(latest.selectedUss[1]).toBe(false);
    });
  });

  describe('status-column fold (inline StatusColumnHeader)', () => {
    function primeArchivedBoard(): UseKanbanBoardResult {
      const normal = makeStatus({ id: 100, name: 'New', order: 1, is_archived: false });
      const archived = makeStatus({ id: 200, name: 'Archived', order: 2, is_archived: true });
      return primeBoard({
        project: makeProject(),
        initialLoad: true,
        usStatusList: [normal, archived],
        usByStatus: { '100': [], '200': [] },
        usMap: {},
      });
    }

    it('force-folds archived columns on first load and toggles the hook show/hide on unfold/fold', () => {
      const board = primeArchivedBoard();
      const { container } = renderApp();

      // headers render in usStatusList order: [0]=normal(100), [1]=archived(200).
      let headers = container.querySelectorAll('.task-colum-name');
      expect(headers).toHaveLength(2);

      // The archived column is force-folded on first load (SOURCE squish $watch).
      expect(headers[1].classList.contains('vfold')).toBe(true);

      // Unfolding the archived column reopens it -> showArchivedStatus(200).
      fireEvent.click(within(headers[1] as HTMLElement).getByTitle('Unfold column'));
      expect(board.showArchivedStatus).toHaveBeenCalledWith(200);

      // Re-query (React reconciled the header) and fold it again -> hide.
      headers = container.querySelectorAll('.task-colum-name');
      fireEvent.click(within(headers[1] as HTMLElement).getByTitle('Fold column'));
      expect(board.hideArchivedStatus).toHaveBeenCalledWith(200);
    });

    it('folding a non-archived column adds `vfold` without calling the archived hooks', () => {
      const board = primeArchivedBoard();
      const { container } = renderApp();

      let headers = container.querySelectorAll('.task-colum-name');
      // The non-archived column (100) starts unfolded.
      expect(headers[0].classList.contains('vfold')).toBe(false);

      fireEvent.click(within(headers[0] as HTMLElement).getByTitle('Fold column'));

      headers = container.querySelectorAll('.task-colum-name');
      expect(headers[0].classList.contains('vfold')).toBe(true);

      // No archived side-effects for a normal column.
      expect(board.showArchivedStatus).not.toHaveBeenCalledWith(100);
      expect(board.hideArchivedStatus).not.toHaveBeenCalledWith(100);
    });
  });

  describe('status-column add actions (permission-gated)', () => {
    it('renders the add / bulk buttons when the project grants add_us', () => {
      const s100 = makeStatus({ id: 100, name: 'New', order: 1, is_archived: false });
      primeBoard({
        project: makeProject({ my_permissions: ['view_us', 'add_us', 'modify_us'] }),
        initialLoad: true,
        usStatusList: [s100],
        usByStatus: { '100': [] },
        usMap: {},
      });

      const { container } = renderApp();

      const header = container.querySelector('.task-colum-name') as HTMLElement;
      const addBtn = within(header).getByTitle('Add new user story');
      const bulkBtn = within(header).getByTitle('Add new bulk');
      expect(addBtn).toBeInTheDocument();
      expect(bulkBtn).toBeInTheDocument();

      // The handlers are permission-gated no-ops (the lightbox is provided by the
      // out-of-scope AngularJS shell) — they must not throw.
      expect(() => {
        fireEvent.click(addBtn);
        fireEvent.click(bulkBtn);
      }).not.toThrow();
    });

    it('omits the add / bulk buttons when the project lacks add_us', () => {
      primeLoadedNoSwimlane(); // default project: my_permissions === ['view_us']
      const { container } = renderApp();

      const header = container.querySelector('.task-colum-name') as HTMLElement;
      expect(within(header).queryByTitle('Add new user story')).toBeNull();
      expect(within(header).queryByTitle('Add new bulk')).toBeNull();
    });
  });

  describe('card action callbacks (delegated, gated no-ops)', () => {
    it('exposes edit / delete / assigned-to handlers to the columns that do not throw', () => {
      primeLoadedNoSwimlane({ my_permissions: ['view_us', 'modify_us', 'delete_us'] });
      renderApp();

      const col = mockCaptured.column[0];
      expect(typeof col.onClickEdit).toBe('function');
      expect(typeof col.onClickDelete).toBe('function');
      expect(typeof col.onClickAssignedTo).toBe('function');
      expect(typeof col.onToggleFold).toBe('function');

      expect(() => {
        act(() => {
          col.onClickEdit(1);
          col.onClickDelete(1);
          col.onClickAssignedTo(1);
        });
      }).not.toThrow();
    });
  });

  describe('filter add / remove wiring', () => {
    it('adds a tag filter to the hook params and removes it again', () => {
      primeLoadedNoSwimlane();
      const { container } = renderApp();

      // Open the panel so the sidebar (and its captured callbacks) mount.
      fireEvent.click(container.querySelector('.btn-filter.e2e-open-filter') as HTMLElement);
      expect(mockCaptured.filters).not.toBeNull();

      // Add an "include" tag filter. For tags the query value is the tag NAME.
      act(() => {
        mockCaptured.filters.onAddFilter({
          category: { dataType: 'tags', title: 'Tags', content: [] },
          filter: { id: null, name: 'urgent', count: 1 },
          mode: 'include',
        });
      });

      const sawTag = mockUseKanbanBoard.mock.calls.some(
        ([params]) => Boolean(params.filterParams) && params.filterParams!.tags === 'urgent',
      );
      expect(sawTag).toBe(true);

      // Remove it via the applied-filter descriptor -> the tags param drops.
      act(() => {
        mockCaptured.filters.onRemoveFilter({
          id: null,
          key: 'tags:urgent',
          name: 'urgent',
          mode: 'include',
          dataType: 'tags',
        });
      });

      const lastCall = mockUseKanbanBoard.mock.calls[mockUseKanbanBoard.mock.calls.length - 1];
      expect(lastCall[0].filterParams).toEqual({});
    });
  });
});
