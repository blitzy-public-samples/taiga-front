/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Column.test.tsx
 * ---------------
 * Browserless Jest + React Testing Library unit spec for the React Kanban
 * status column (`../components/Column`). It contributes to the >=70%
 * line-coverage gate enforced over `app/react/**` (jest.config.js
 * `coverageThreshold`, AAP 0.6.2/0.7.1) and pins the structural + behavioural
 * contract the component ports from the legacy AngularJS `.taskboard-column`
 * markup and directives.
 *
 * The `Column` is the per-status DROP container: it registers the `@dnd-kit`
 * droppable, wraps its cards in a `SortableContext`, renders the num-us
 * counter, the fold placeholders, the loading / "no results" card placeholder,
 * the archived-status intro, and — the highest-value branch — the inline
 * `WipLimit` indicator placed immediately after a card at a boundary index that
 * the REAL `computeWipLimit` decides.
 *
 * BEHAVIOURAL ORIGIN (reproduced by the component, NEVER imported here — the
 * AngularJS/legacy sources stay on the far side of the coexistence boundary):
 *   `app/coffee/modules/kanban/main.coffee` — the `tgKanban` column render, the
 *   `KanbanSquishColumnDirective` fold logic, the `KanbanWipLimitDirective`
 *   WIP-limit placement (lines ~815-853), the `KanbanTaskboardColumnDirective`
 *   sticky counter, and the `KanbanArchivedStatusIntroDirective`. This spec
 *   asserts the REPRODUCED React DOM/behaviour, not the CoffeeScript.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2/0.7):
 *   - Jest + `jest-environment-jsdom` ONLY. No Playwright, no real browser, no
 *     network. Runs headlessly in a bare container.
 *   - The file name is exactly `Column.test.tsx` (a Jest `*.test.tsx` name,
 *     never a Playwright-style `*.spec.tsx` name).
 *   - `@dnd-kit/core` and `@dnd-kit/sortable` are MOCKED: `useDroppable` and
 *     `SortableContext` require an ancestor `<DndContext>` in real usage; this
 *     unit spec deliberately omits the provider and mocks both so `Column`
 *     renders standalone. Mocking `useDroppable` additionally lets the spec
 *     assert the EXACT droppable identity + data payload the column registers.
 *   - The child `./Card` is mocked to a prop-echoing `<tg-card>` stub so the
 *     spec can assert `cardPropsFor`'s mapping WITHOUT pulling in the real
 *     card's `useSortableCard` DnD machinery or its large template.
 *   - The sibling `WipLimit` + `computeWipLimit` are used REAL (they are pure /
 *     display-only) so the WIP indicator's placement matrix is exercised end to
 *     end; only the network side the real `WipLimit` module imports
 *     (`../../shared/api/userstories` -> `editStatus` -> httpClient/config/
 *     session) is mocked, severing all I/O.
 *   - React itself is NOT imported (automatic `react-jsx` runtime); `jest` is a
 *     global (`@types/jest`), never imported.
 */

// ---------------------------------------------------------------------------
// Hoisted module mocks. ts-jest hoists every `jest.mock(...)` call above the
// imports below, so each factory MUST be self-contained (it may reference only
// `jest` and modules it `require`s internally).
// ---------------------------------------------------------------------------

// Mock `@dnd-kit/core`: `Column` calls `useDroppable({ id, data })` to register
// its drop container. The real hook throws without an ancestor `<DndContext>`,
// so it is replaced with a `jest.fn` that returns a no-op `setNodeRef` (plus
// the `isOver` / `node` fields the hook's return type carries, for shape
// parity). Because it is a `jest.fn`, the spec can inspect the exact argument
// object the column passed (`mockUseDroppable`, below).
jest.mock('@dnd-kit/core', () => ({
  __esModule: true,
  useDroppable: jest.fn(() => ({
    setNodeRef: jest.fn(),
    isOver: false,
    node: { current: null },
  })),
}));

// Mock `@dnd-kit/sortable`: `SortableContext` is a passthrough that renders its
// children directly (so the column's cards + WIP indicator become direct
// children of the column root, preserving their DOM adjacency for the
// placement assertions), and `verticalListSortingStrategy` is an inert
// sentinel the column forwards but the mock ignores.
jest.mock('@dnd-kit/sortable', () => ({
  __esModule: true,
  SortableContext: ({ children }: { children?: unknown }) => children,
  verticalListSortingStrategy: {},
}));

// Mock the child `./Card` to a prop-echoing `<tg-card>` stub. The real Card
// runs its own `useSortableCard` and a large template; here we only need to
// prove that `Column` builds each card's props correctly (`cardPropsFor`) and
// orders the cards relative to the WIP indicator, so the stub echoes the mapped
// props as `data-*` attributes. `require('react')` keeps the factory
// self-contained under ts-jest hoisting.
jest.mock('../components/Card', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      react.createElement('tg-card', {
        'data-testid': 'card',
        'data-id': String(props.usId),
        'data-type': String(props.type),
        'data-status-id': String(props.statusId),
        'data-swimlane-id': String(props.swimlaneId),
        'data-is-first': String(!!props.isFirst),
        'data-archived': String(!!props.archived),
        'data-in-viewport': String(!!props.inViewPort),
        'data-selected': String(!!props.selected),
        'data-moved': String(!!props.moved),
        'data-zoom-level': String(props.zoomLevel),
        'data-can-modify': String(!!props.canModify),
        'data-can-delete': String(!!props.canDelete),
        'data-can-view-tasks': String(!!props.canViewTasks),
        // Prove the move-to-top handler is forwarded (both board modes).
        'data-has-move-to-top': String(typeof props.onMoveToTop === 'function'),
      }),
  };
});

// Mock the ONLY network-bearing module the REAL `WipLimit` pulls in. `Column`
// imports `WipLimit` + `computeWipLimit` from `./WipLimit`, which are kept real;
// `WipLimit.tsx` in turn imports `editStatus` from
// `../../shared/api/userstories` (its persistence wrapper). Mocking that adapter
// severs the httpClient/config/session network chain while leaving the pure
// `computeWipLimit` and the display-only `WipLimit` component fully real. Both
// the named `editStatus` and the `default` aggregate expose the SAME `jest.fn`
// per the sibling-spec convention.
jest.mock('../../shared/api/userstories', () => {
  const editStatus = jest.fn(() => Promise.resolve({}));
  return { __esModule: true, editStatus, default: { editStatus } };
});

import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// The mocked droppable hook binding, imported after the mock so it resolves to
// the `jest.fn`. Typed for call inspection; `clearMocks: true` (jest.config.js)
// resets its recorded calls before every test.
import { useDroppable } from '@dnd-kit/core';

// Module under test. Its `./Card`, `@dnd-kit/*`, and (transitively) the
// userstories adapter are all mocked; `./WipLimit` is real.
import Column from '../components/Column';
import type { ColumnProps, UsStatus } from '../components/Column';
import type { UserStoryData, Project, User } from '../state/kanbanReducer';

/** The mocked `useDroppable`, typed so `.mock`/`toHaveBeenCalledWith` are available. */
const mockUseDroppable = useDroppable as unknown as jest.Mock;

/** The default return the column expects from `useDroppable` (a no-op droppable). */
const defaultDroppable = () => ({ setNodeRef: jest.fn(), isOver: false, node: { current: null } });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `UsStatus`. Only the fields the column reads
 * (`id`/`name`/`color`/`wip_limit`/`is_archived`) matter; the open index
 * signature on `UsStatus` tolerates the rest.
 */
const makeStatus = (over: Partial<UsStatus> = {}): UsStatus =>
  ({
    id: 1,
    name: 'New',
    order: 1,
    color: '#999',
    is_archived: false,
    wip_limit: null,
    ...over,
  } as UsStatus);

/**
 * Build a minimal `UserStoryData` for the `usMap`. Card is mocked and never
 * reads the story internals, so a structural cast is safe and correct.
 */
const makeItem = (id: number): UserStoryData =>
  ({ id, ref: id, subject: `US ${id}` } as unknown as UserStoryData);

/** A `usMap` (id -> story) covering the given ids. */
const usMapFor = (ids: number[]): Record<number, UserStoryData> =>
  ids.reduce<Record<number, UserStoryData>>((acc, id) => {
    acc[id] = makeItem(id);
    return acc;
  }, {});

/** A minimal project; the column only forwards it to the (mocked) Card. */
const makeProject = (over: Partial<Project> = {}): Project =>
  ({ id: 7, slug: 'proj', i_am_admin: true, ...over } as unknown as Project);

/** A minimal user for the (accepted-but-not-forwarded) `usersById` map. */
const makeUser = (id: number): User => ({ id } as unknown as User);

/** The cumulative zoom feature array (as ZoomControl would supply it). */
const ZOOM = ['assigned_to', 'ref', 'subject', 'card-data', 'assigned_to_extended'];

/**
 * Render `Column` with sane defaults merged under caller overrides. Defaults
 * mirror the agent-prompt Phase B2 contract (reconciled to `ColumnProps` on
 * disk: `selectedUss`/`cardVisibility` are `Record<number, boolean>`, not
 * arrays). Returns the RTL result plus the resolved `props` so tests can reach
 * the `jest.fn` spies.
 */
const renderColumn = (over: Partial<ColumnProps> = {}) => {
  const orderedIds = over.orderedIds ?? [11, 12, 13];
  const props: ColumnProps = {
    status: makeStatus(),
    swimlaneId: null,
    swimlaneMode: false,
    orderedIds,
    folded: false,
    unfolded: false,
    showPlaceHolder: false,
    notFoundUserstories: false,
    renderInProgress: false,
    usMap: usMapFor(orderedIds),
    project: makeProject(),
    zoom: ZOOM,
    zoomLevel: 1,
    selectedUss: {},
    movedUs: [],
    cardVisibility: { 11: true, 12: true, 13: true },
    isUsArchivedHidden: () => false,
    usersById: {},
    canModify: true,
    canDelete: true,
    canViewTasks: true,
    onCardToggleFold: jest.fn(),
    onCardEdit: jest.fn(),
    onCardDelete: jest.fn(),
    onCardAssignedTo: jest.fn(),
    onCardMoveToTop: jest.fn(),
    onCardSelect: jest.fn(),
    onShowArchived: jest.fn(),
    ...over,
  };
  const result = render(<Column {...props} />);
  return { ...result, props };
};

/** Query the column root by its stable `id="column-{statusId}"`. */
const columnRoot = (container: HTMLElement, statusId = 1): HTMLElement =>
  container.querySelector<HTMLElement>(`#column-${statusId}`)!;

/**
 * The most recent argument object passed to `useDroppable` during the current
 * render. The column re-renders once after mount (the callback ref stores the
 * live DOM node in state, feeding `data.columnEl`), so the LAST call carries
 * the settled payload; the `id` is stable across renders regardless.
 */
const lastDroppableArg = (): { id: string; data: Record<string, unknown> } => {
  const calls = mockUseDroppable.mock.calls;
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  // `clearMocks: true` already resets call state before each test; re-assert the
  // default `useDroppable` implementation defensively (per the agent-prompt
  // Phase B2 requirement) in case a test overrode it.
  jest.clearAllMocks();
  mockUseDroppable.mockImplementation(defaultDroppable);
});

// ---------------------------------------------------------------------------
// Phase C — droppable identity + root attributes
// ---------------------------------------------------------------------------

describe('Column — droppable identity + root attributes', () => {
  it('renders the `.kanban-uses-box.taskboard-column` root with id + data-status', () => {
    const { container } = renderColumn({ status: makeStatus({ id: 3 }) });
    const root = columnRoot(container, 3);
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass('kanban-uses-box', 'taskboard-column');
    expect(root).toHaveAttribute('id', 'column-3');
    expect(root).toHaveAttribute('data-status', '3');
  });

  it('registers the droppable id `column-{id}-none` + data payload when swimlaneId is null', () => {
    renderColumn({ status: makeStatus({ id: 3 }), swimlaneId: null, orderedIds: [11, 12, 13] });
    // Any call matches (the id is render-stable); assert id + the data contract.
    expect(mockUseDroppable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'column-3-none',
        data: expect.objectContaining({
          statusId: 3,
          swimlaneId: null,
          orderedIds: [11, 12, 13],
        }),
      }),
    );
    // The settled (post-mount) call carries the same id + data keys.
    const arg = lastDroppableArg();
    expect(arg.id).toBe('column-3-none');
    expect(arg.data).toEqual(
      expect.objectContaining({ statusId: 3, swimlaneId: null, orderedIds: [11, 12, 13] }),
    );
    // `columnEl` is part of the drag-coordination contract (data-path fallback).
    expect(arg.data).toHaveProperty('columnEl');
  });

  it('registers the droppable id `column-{id}-{swimlaneId}` when a swimlane id is set', () => {
    renderColumn({
      status: makeStatus({ id: 3 }),
      swimlaneMode: true,
      swimlaneId: 5,
      orderedIds: [11, 12],
    });
    expect(mockUseDroppable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'column-3-5',
        data: expect.objectContaining({ statusId: 3, swimlaneId: 5, orderedIds: [11, 12] }),
      }),
    );
    expect(lastDroppableArg().id).toBe('column-3-5');
  });

  it('adds `data-swimlane` ONLY in swimlane mode (incl. the -1 unclassified sentinel)', () => {
    const { container: on } = renderColumn({ swimlaneMode: true, swimlaneId: 5 });
    expect(columnRoot(on)).toHaveAttribute('data-swimlane', '5');

    const { container: sentinel } = renderColumn({ swimlaneMode: true, swimlaneId: -1 });
    expect(columnRoot(sentinel)).toHaveAttribute('data-swimlane', '-1');
  });

  it('omits `data-swimlane` entirely in non-swimlane mode', () => {
    const { container } = renderColumn({ swimlaneMode: false, swimlaneId: null });
    expect(columnRoot(container).hasAttribute('data-swimlane')).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// Phase D — fold / unfold state classes, counter, and placeholders
// ---------------------------------------------------------------------------

describe('Column — fold / unfold state classes', () => {
  it('applies neither `vfold` nor `vunfold` by default', () => {
    const { container } = renderColumn();
    const root = columnRoot(container);
    expect(root).not.toHaveClass('vfold');
    expect(root).not.toHaveClass('vunfold');
  });

  it('applies `vfold` when folded', () => {
    const { container } = renderColumn({ folded: true });
    expect(columnRoot(container)).toHaveClass('vfold');
  });

  it('applies `vunfold` when unfolded', () => {
    const { container } = renderColumn({ unfolded: true });
    expect(columnRoot(container)).toHaveClass('vunfold');
  });
});

describe('Column — num-us counter (non-folded)', () => {
  it('renders `.kanban-task-counter` with a `<tg-animated-counter>` when NOT folded', () => {
    const { container } = renderColumn({ folded: false, orderedIds: [1, 2, 3, 4] });
    const counter = container.querySelector('.kanban-task-counter');
    expect(counter).toBeInTheDocument();
    expect(counter).toHaveAttribute('title', 'Number of US');
    expect(counter!.querySelector('tg-animated-counter')).toBeInTheDocument();
    // Resting DOM: three `.result` rows each showing the current count.
    expect(counter!.querySelectorAll('.counter-translator .result')).toHaveLength(3);
    expect(within(counter as HTMLElement).getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render the counter (and DOES render `.placeholder-collapsed`) when folded', () => {
    const { container } = renderColumn({ folded: true });
    expect(container.querySelector('.kanban-task-counter')).not.toBeInTheDocument();
    expect(container.querySelector('.placeholder-collapsed')).toBeInTheDocument();
  });

  it('adds `wip-amount` and a ` / N` suffix when a WIP limit is set (not over)', () => {
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 5 }), orderedIds: [1, 2] });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).toHaveClass('wip-amount');
    expect(inner).not.toHaveClass('limit-over');
    expect(within(inner as HTMLElement).getAllByText('/ 5').length).toBeGreaterThanOrEqual(1);
  });

  it('adds `limit-over` when the card count exceeds the WIP limit', () => {
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 2 }), orderedIds: [1, 2, 3] });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).toHaveClass('wip-amount', 'limit-over');
  });

  it('renders `0` and no `/` suffix for an empty column with no WIP limit', () => {
    const { container } = renderColumn({ orderedIds: [] });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).not.toHaveClass('wip-amount');
    expect(within(inner as HTMLElement).getAllByText('0').length).toBe(3);
    expect(within(inner as HTMLElement).queryByText(/\//)).toBeNull();
  });
});

describe('Column — collapsed placeholder (folded)', () => {
  it('shows the amount + name + colour swatch for a NON-archived folded column', () => {
    const { container } = renderColumn({
      folded: true,
      status: makeStatus({ name: 'Ready', color: '#ff0000', is_archived: false }),
      orderedIds: [1, 2],
    });
    const wrapper = container.querySelector('.placeholder-collapsed .placeholder-collapsed-wrapper')!;
    expect(wrapper).toBeInTheDocument();
    // Non-archived -> the vertical amount is shown.
    const amount = wrapper.querySelector('.ammount');
    expect(amount).toBeInTheDocument();
    expect(amount!.querySelector('tg-animated-counter')).toHaveAttribute('class', 'vertical');
    // Name shown, no `(Archived)` label.
    expect(wrapper.querySelector('.text-holder .name')).toHaveTextContent('Ready');
    expect(wrapper.querySelector('.text-holder .archived')).toBeNull();
    // Colour swatch carries the status colour.
    const swatch = wrapper.querySelector<HTMLElement>('.square-color');
    expect(swatch).toBeInTheDocument();
    expect(swatch!.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('hides the amount and shows `(Archived)` for an archived folded column', () => {
    const { container } = renderColumn({
      folded: true,
      status: makeStatus({ name: 'Done', is_archived: true }),
    });
    const wrapper = container.querySelector('.placeholder-collapsed-wrapper')!;
    expect(wrapper.querySelector('.ammount')).toBeNull();
    expect(wrapper.querySelector('.text-holder .archived')).toHaveTextContent('(Archived)');
    expect(wrapper.querySelector('.text-holder .name')).toHaveTextContent('Done');
  });
});

describe('Column — card placeholder (loading skeleton + no-results)', () => {
  it('is absent when `showPlaceHolder` is false', () => {
    const { container } = renderColumn({ showPlaceHolder: false });
    expect(container.querySelector('.card-placeholder')).not.toBeInTheDocument();
  });

  it('renders the loading skeleton WITHOUT `not-found` when showPlaceHolder && !notFoundUserstories', () => {
    const { container } = renderColumn({ showPlaceHolder: true, notFoundUserstories: false });
    const ph = container.querySelector('.card-placeholder');
    expect(ph).toBeInTheDocument();
    expect(ph).not.toHaveClass('not-found');
    // A representative slice of the skeleton structure.
    expect(ph!.querySelector('.placeholder-board-card')).toBeInTheDocument();
    expect(ph!.querySelectorAll('.placeholder-board-row')).toHaveLength(3);
    expect(within(ph as HTMLElement).getByText('This could be a user story')).toBeInTheDocument();
  });

  it('renders the `.card-placeholder.not-found` "no results" body when notFoundUserstories', () => {
    const { container } = renderColumn({ showPlaceHolder: true, notFoundUserstories: true });
    const ph = container.querySelector('.card-placeholder');
    expect(ph).toHaveClass('not-found');
    // The skeleton must NOT be present in the not-found branch.
    expect(ph!.querySelector('.placeholder-board-card')).toBeNull();
    expect(within(ph as HTMLElement).getByText('No matching results found')).toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// Phase E — card rendering + `cardPropsFor` mapping
// ---------------------------------------------------------------------------

describe('Column — card rendering + cardPropsFor mapping', () => {
  it('renders one Card per ordered id, in order', () => {
    const { container } = renderColumn({ orderedIds: [11, 12, 13] });
    const cards = container.querySelectorAll('[data-testid="card"]');
    expect(cards).toHaveLength(3);
    expect(Array.from(cards).map((c) => c.getAttribute('data-id'))).toEqual(['11', '12', '13']);
  });

  it('flags ONLY the first card as `isFirst` and forwards the static bindings', () => {
    const { container } = renderColumn({
      status: makeStatus({ id: 7 }),
      orderedIds: [11, 12, 13],
      zoomLevel: 3,
    });
    const cards = Array.from(container.querySelectorAll('[data-testid="card"]'));
    expect(cards[0]).toHaveAttribute('data-is-first', 'true');
    expect(cards[1]).toHaveAttribute('data-is-first', 'false');
    expect(cards[2]).toHaveAttribute('data-is-first', 'false');
    for (const card of cards) {
      expect(card).toHaveAttribute('data-type', 'us');
      expect(card).toHaveAttribute('data-status-id', '7');
      expect(card).toHaveAttribute('data-zoom-level', '3');
      expect(card).toHaveAttribute('data-can-modify', 'true');
      expect(card).toHaveAttribute('data-can-delete', 'true');
      expect(card).toHaveAttribute('data-can-view-tasks', 'true');
      // The move-to-top handler is forwarded in BOTH board modes.
      expect(card).toHaveAttribute('data-has-move-to-top', 'true');
    }
  });

  it('maps `inViewPort` from `cardVisibility[usId]`', () => {
    const { container } = renderColumn({
      orderedIds: [11, 12, 13],
      cardVisibility: { 11: true, 12: false, 13: true },
    });
    expect(container.querySelector('[data-id="11"]')).toHaveAttribute('data-in-viewport', 'true');
    expect(container.querySelector('[data-id="12"]')).toHaveAttribute('data-in-viewport', 'false');
    expect(container.querySelector('[data-id="13"]')).toHaveAttribute('data-in-viewport', 'true');
  });

  it('maps `archived` from `isUsArchivedHidden(usId)`', () => {
    const { container } = renderColumn({
      orderedIds: [11, 12, 13],
      isUsArchivedHidden: (id) => id === 12,
    });
    expect(container.querySelector('[data-id="11"]')).toHaveAttribute('data-archived', 'false');
    expect(container.querySelector('[data-id="12"]')).toHaveAttribute('data-archived', 'true');
    expect(container.querySelector('[data-id="13"]')).toHaveAttribute('data-archived', 'false');
  });

  it('maps `selected` from `selectedUss[usId]`', () => {
    const { container } = renderColumn({ orderedIds: [11, 12], selectedUss: { 11: true } });
    expect(container.querySelector('[data-id="11"]')).toHaveAttribute('data-selected', 'true');
    expect(container.querySelector('[data-id="12"]')).toHaveAttribute('data-selected', 'false');
  });

  it('marks `moved` cards ONLY in swimlane mode (and forwards the swimlane id)', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 3,
      orderedIds: [11, 12],
      movedUs: [12],
    });
    const c11 = container.querySelector('[data-id="11"]')!;
    const c12 = container.querySelector('[data-id="12"]')!;
    expect(c11).toHaveAttribute('data-swimlane-id', '3');
    expect(c12).toHaveAttribute('data-swimlane-id', '3');
    expect(c11).toHaveAttribute('data-moved', 'false');
    expect(c12).toHaveAttribute('data-moved', 'true');
  });

  it('NEVER marks a card `moved` in non-swimlane mode (moved is forced false)', () => {
    const { container } = renderColumn({
      swimlaneMode: false,
      swimlaneId: null,
      orderedIds: [11, 12],
      movedUs: [12],
    });
    expect(container.querySelector('[data-id="12"]')).toHaveAttribute('data-moved', 'false');
    // Non-swimlane cards carry the null swimlane id.
    expect(container.querySelector('[data-id="11"]')).toHaveAttribute('data-swimlane-id', 'null');
  });

  it('defaults archived / inViewPort / selected to false when their lookups are absent', () => {
    const { container } = renderColumn({
      orderedIds: [11],
      isUsArchivedHidden: undefined,
      cardVisibility: undefined,
      selectedUss: undefined,
    });
    const c11 = container.querySelector('[data-id="11"]')!;
    expect(c11).toHaveAttribute('data-archived', 'false');
    expect(c11).toHaveAttribute('data-in-viewport', 'false');
    expect(c11).toHaveAttribute('data-selected', 'false');
  });

  it('defaults `moved` to false in swimlane mode when `movedUs` is absent', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 2,
      orderedIds: [11],
      movedUs: undefined,
    });
    expect(container.querySelector('[data-id="11"]')).toHaveAttribute('data-moved', 'false');
  });
});


// ---------------------------------------------------------------------------
// Phase F — WIP-limit marker placement (uses the REAL `computeWipLimit`)
// ---------------------------------------------------------------------------
//
// `computeWipLimit(cardCount, wipLimit, isArchived)` (real, from ./WipLimit):
//   - one-left: cardCount + 1 === wipLimit -> boundaryIndex = cardCount - 1
//   - reached:  cardCount     === wipLimit -> boundaryIndex = cardCount - 1
//   - exceeded: cardCount      >  wipLimit -> boundaryIndex = wipLimit - 1
//   - archived OR falsy wipLimit           -> null
// The column renders <WipLimit> IMMEDIATELY AFTER the card at boundaryIndex.
// Adjacency is asserted over the in-document order of the card + WIP nodes,
// which are direct children of the column root (the SortableContext mock is a
// passthrough).

/** The card + WIP nodes of a column root, in document order. */
const cardAndWipNodes = (root: HTMLElement): Element[] =>
  Array.from(root.querySelectorAll('[data-testid="card"], .kanban-wip-limit'));

describe('Column — WIP-limit marker placement', () => {
  it('renders NO `.kanban-wip-limit` when `wip_limit` is null', () => {
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: null }),
      orderedIds: [1, 2, 3],
    });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
  });

  it('reached: renders `.kanban-wip-limit.reached` after the LAST card (count === limit)', () => {
    // length 3, wip_limit 3 -> reached, boundaryIndex = cardCount - 1 = 2.
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 3 }), orderedIds: [11, 12, 13] });
    const wip = container.querySelector('.kanban-wip-limit');
    expect(wip).toBeInTheDocument();
    expect(wip).toHaveClass('reached');
    expect(wip).toHaveTextContent('WIP Limit');

    const nodes = cardAndWipNodes(columnRoot(container));
    // card0, card1, card2, WIP -> the WIP marker is the LAST node.
    expect(nodes[nodes.length - 1].classList.contains('kanban-wip-limit')).toBe(true);
    expect(nodes[nodes.length - 2].getAttribute('data-id')).toBe('13');
  });

  it('exceeded: renders `.kanban-wip-limit.exceeded` after the card at index `wip_limit - 1`', () => {
    // length 5, wip_limit 3 -> exceeded, boundaryIndex = wip_limit - 1 = 2 (3rd card).
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 3 }),
      orderedIds: [11, 12, 13, 14, 15],
    });
    const wip = container.querySelector('.kanban-wip-limit');
    expect(wip).toHaveClass('exceeded');

    const nodes = cardAndWipNodes(columnRoot(container));
    const wipPos = nodes.findIndex((n) => n.classList.contains('kanban-wip-limit'));
    // card0, card1, card2(=orderedIds[2]=13), WIP, card3, card4.
    expect(nodes[wipPos - 1].getAttribute('data-id')).toBe('13');
    expect(nodes[wipPos + 1].getAttribute('data-id')).toBe('14');
  });

  it('one-left: renders `.kanban-wip-limit.one-left` after the card at index `cardCount - 1`', () => {
    // length 2, wip_limit 3 -> one-left, boundaryIndex = cardCount - 1 = 1.
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 3 }), orderedIds: [11, 12] });
    const wip = container.querySelector('.kanban-wip-limit');
    expect(wip).toHaveClass('one-left');

    const nodes = cardAndWipNodes(columnRoot(container));
    // card0, card1(=orderedIds[1]=12), WIP -> WIP is last, preceded by id 12.
    expect(nodes[nodes.length - 1].classList.contains('kanban-wip-limit')).toBe(true);
    expect(nodes[nodes.length - 2].getAttribute('data-id')).toBe('12');
  });

  it('renders no WIP marker below the limit and not one-left away from it', () => {
    // length 1, wip_limit 5 -> not one-left/reached/exceeded -> null.
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 5 }), orderedIds: [11] });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
  });

  it('archived suppresses the WIP marker but STILL renders the archived intro', () => {
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 3, is_archived: true }),
      orderedIds: [1, 2, 3, 4, 5],
    });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
    expect(container.querySelector('.kanban-column-intro')).toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// Phase G — archived-status intro (tgKanbanArchivedStatusIntro)
// ---------------------------------------------------------------------------

describe('Column — archived intro', () => {
  it('renders an EMPTY `.kanban-column-intro` ONLY for archived statuses', () => {
    const { container: normal } = renderColumn({ status: makeStatus({ is_archived: false }) });
    expect(normal.querySelector('.kanban-column-intro')).not.toBeInTheDocument();

    const { container: archived } = renderColumn({ status: makeStatus({ is_archived: true }) });
    const intro = archived.querySelector('.kanban-column-intro');
    expect(intro).toBeInTheDocument();
    expect(intro).toBeEmptyDOMElement();
  });

  it('invokes `onShowArchived` with the status id when the intro is clicked', () => {
    const onShowArchived = jest.fn();
    const { container } = renderColumn({
      status: makeStatus({ id: 9, is_archived: true }),
      onShowArchived,
    });
    fireEvent.click(container.querySelector('.kanban-column-intro')!);
    expect(onShowArchived).toHaveBeenCalledWith(9);
  });

  it('does not throw when the intro is clicked without an `onShowArchived` handler', () => {
    const { container } = renderColumn({
      status: makeStatus({ is_archived: true }),
      onShowArchived: undefined,
    });
    expect(() => fireEvent.click(container.querySelector('.kanban-column-intro')!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase H — sticky num-us counter scroll (tgKanbanTaskboardColumn)
// ---------------------------------------------------------------------------

describe('Column — sticky counter scroll', () => {
  it('translates the counter by the scroll offset on column scroll', () => {
    const { container } = renderColumn({ orderedIds: [1, 2] });
    const root = columnRoot(container);
    const counter = container.querySelector<HTMLElement>('.kanban-task-counter')!;
    expect(counter.style.transform).toBe('');

    // jsdom does no layout, so drive `scrollTop` explicitly, then dispatch scroll.
    Object.defineProperty(root, 'scrollTop', { value: 42, configurable: true });
    fireEvent.scroll(root);
    expect(counter.style.transform).toBe('translateY(42px)');

    Object.defineProperty(root, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(root);
    expect(counter.style.transform).toBe('translateY(0px)');
  });

  it('does not throw when scrolling a folded column (no counter present)', () => {
    const { container } = renderColumn({ folded: true });
    const root = columnRoot(container);
    Object.defineProperty(root, 'scrollTop', { value: 10, configurable: true });
    expect(() => fireEvent.scroll(root)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// End-to-end structure sanity (non-swimlane vs swimlane archived)
// ---------------------------------------------------------------------------

describe('Column — end-to-end structure', () => {
  it('non-swimlane populated column: counter + 3 cards, no swimlane / intro / placeholder', () => {
    const { container } = renderColumn({ orderedIds: [11, 12, 13] });
    const root = columnRoot(container);
    expect(root.querySelector('.kanban-task-counter')).toBeInTheDocument();
    expect(root.querySelectorAll('[data-testid="card"]')).toHaveLength(3);
    expect(root.hasAttribute('data-swimlane')).toBe(false);
    expect(root.querySelector('.kanban-column-intro')).toBeNull();
    expect(root.querySelector('.card-placeholder')).toBeNull();
    expect(root.querySelector('.placeholder-collapsed')).toBeNull();
  });

  it('swimlane archived column: data-swimlane + intro + one card, no collapsed amount', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 0,
      status: makeStatus({ is_archived: true, wip_limit: null }),
      orderedIds: [11],
      usersById: { 1: makeUser(1) },
    });
    const root = columnRoot(container);
    expect(root).toHaveAttribute('data-swimlane', '0');
    expect(root.querySelector('.kanban-column-intro')).toBeInTheDocument();
    expect(root.querySelectorAll('[data-testid="card"]')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Defensive fallbacks (optional status fields feeding computeWipLimit)
// ---------------------------------------------------------------------------

describe('Column — defensive fallbacks', () => {
  it('treats a status with `wip_limit` / `is_archived` omitted as no-limit, non-archived', () => {
    // Omitting the optional fields exercises the `?? null` / `?? false`
    // fallbacks feeding `computeWipLimit`.
    const status = { id: 1, name: 'Bare', order: 1 } as unknown as UsStatus;
    const { container } = renderColumn({ status, orderedIds: [1, 2, 3] });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
    expect(container.querySelector('.kanban-column-intro')).not.toBeInTheDocument();
    expect(
      container.querySelector('.kanban-task-counter .animated-counter-inner'),
    ).not.toHaveClass('wip-amount');
  });

  it('renders an empty column (no cards, no WIP marker) without error', () => {
    const { container } = renderColumn({ status: makeStatus({ wip_limit: 3 }), orderedIds: [] });
    expect(screen.queryAllByTestId('card')).toHaveLength(0);
    // cardCount 0, wip_limit 3 -> not one-left/reached/exceeded -> no marker.
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
    // The counter still renders (not folded) showing 0.
    expect(container.querySelector('.kanban-task-counter')).toBeInTheDocument();
  });
});

