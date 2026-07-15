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
 * Jest + React Testing Library unit spec for the React Kanban status column
 * (`../components/Column`). It contributes to the >=70% line-coverage gate
 * enforced over `app/react/**` and pins the structural + behavioural contract
 * the component ports from the legacy AngularJS `.taskboard-column` markup and
 * directives.
 *
 * STRUCTURAL ORIGIN (reproduced here, NEVER imported — the AngularJS/legacy
 * sources stay on the far side of the coexistence boundary):
 *   - `kanban-table.jade` column block (swimlane lines 112-176 + non-swimlane
 *     lines 189-250): the `.kanban-uses-box.taskboard-column` root, its
 *     `id`/`data-status`/`data-swimlane` attributes, the `vfold`/`vunfold`
 *     `ng-class`, the `.kanban-task-counter`, the `.placeholder-collapsed`
 *     block, the `.card-placeholder`, the per-card `tg-card` bindings, and the
 *     `.kanban-column-intro`.
 *   - `main.coffee` directives: `KanbanTaskboardColumnDirective` (sticky
 *     counter `translateY(scrollTop)`), `KanbanSquishColumnDirective` (fold
 *     state -> classes), `KanbanArchivedStatusIntroDirective` (empty intro div
 *     that loads archived stories on click).
 *   - `animated-counter.directive.coffee` template (the `<tg-animated-counter>`
 *     inner DOM + `wip-amount`/`limit-over` `ng-class`).
 *   - `kanban-placeholder.jade` (the loading-skeleton + "no results" bodies).
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file):
 *   - Jest + jsdom only. No Playwright, no real browser, no network.
 *   - The child `./Card` is mocked to a lightweight stub that echoes the props
 *     `Column` maps onto it (so `cardPropsFor` can be asserted) WITHOUT pulling
 *     in the card's own `useSortable`/DnD machinery.
 *   - The sibling `WipLimit` + `computeWipLimit` are used REAL (already fully
 *     covered) so the WIP indicator's placement is exercised end to end.
 *   - A real `@dnd-kit/core` `<DndContext>` wraps every render so the column's
 *     `useDroppable` + the `SortableContext` resolve their context faithfully;
 *     no drag is simulated (deterministic under jsdom).
 *   - React itself is not imported (automatic `react-jsx` runtime); `jest` is a
 *     global (`@types/jest`), never imported.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DndContext } from '@dnd-kit/core';

// ---------------------------------------------------------------------------
// Mock the child `./Card` to a prop-echoing stub. The real Card runs its own
// `useSortable` and a large template; here we only need to prove that `Column`
// builds each card's props correctly (`cardPropsFor`) and orders the cards +
// the WIP indicator, so the stub renders the mapped props as data-* attributes.
// ---------------------------------------------------------------------------
jest.mock('../components/Card', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      react.createElement('div', {
        'data-testid': 'card',
        'data-us-id': String(props.usId),
        'data-type': String(props.type),
        'data-status-id': String(props.statusId),
        'data-swimlane-id': String(props.swimlaneId),
        'data-is-first': String(props.isFirst),
        'data-archived': String(props.archived),
        'data-in-viewport': String(props.inViewPort),
        'data-selected': String(props.selected),
        'data-moved': String(props.moved),
        'data-zoom-level': String(props.zoomLevel),
        'data-can-modify': String(props.canModify),
        'data-can-delete': String(props.canDelete),
        'data-can-view-tasks': String(props.canViewTasks),
        // expose whether the move-to-top handler was forwarded
        'data-has-move-to-top': String(typeof props.onMoveToTop === 'function'),
      }),
  };
});

import Column from '../components/Column';
import type { ColumnProps, UsStatus } from '../components/Column';
import type { UserStoryData, Project, User } from '../state/kanbanReducer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a `UsStatus` (open shape; only the fields the column reads matter). */
const makeStatus = (over: Partial<UsStatus> = {}): UsStatus =>
  ({
    id: 7,
    name: 'In progress',
    order: 2,
    color: '#aabbcc',
    wip_limit: null,
    is_archived: false,
    ...over,
  } as UsStatus);

/** Build a minimal `UserStoryData` for the `usMap` (Card is stubbed). */
const makeItem = (id: number): UserStoryData =>
  ({
    foldStatusChanged: undefined,
    model: { id },
    images: [],
    id,
    swimlane: null,
    assigned_to: null,
    assigned_users: [],
    assigned_users_preview: [],
    colorized_tags: [],
  } as unknown as UserStoryData);

const makeProject = (): Project => ({ id: 55 } as unknown as Project);

const makeUser = (id: number): User => ({ id } as unknown as User);

/** A `usMap` covering the given ids. */
const usMapFor = (ids: number[]): Record<number, UserStoryData> =>
  ids.reduce<Record<number, UserStoryData>>((acc, id) => {
    acc[id] = makeItem(id);
    return acc;
  }, {});

const ZOOM = ['assigned_to', 'ref', 'subject'];

/** Merge caller props over sane defaults and render inside a real DndContext. */
const renderColumn = (over: Partial<ColumnProps> = {}) => {
  const orderedIds = over.orderedIds ?? [101, 102, 103];
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
    zoomLevel: 2,
    selectedUss: {},
    movedUs: [],
    cardVisibility: {},
    isUsArchivedHidden: undefined,
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
  const result = render(
    <DndContext>
      <Column {...props} />
    </DndContext>,
  );
  return { ...result, props };
};

/** Query the column root by its stable `id`. */
const columnRoot = (container: HTMLElement, statusId = 7): HTMLElement =>
  container.querySelector<HTMLElement>(`#column-${statusId}`)!;

// ---------------------------------------------------------------------------
// Root element: classes + attributes
// ---------------------------------------------------------------------------

describe('Column — root element', () => {
  it('renders the `.kanban-uses-box.taskboard-column` root with id + data-status', () => {
    const { container } = renderColumn();
    const root = columnRoot(container);
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass('kanban-uses-box', 'taskboard-column');
    expect(root).toHaveAttribute('id', 'column-7');
    expect(root).toHaveAttribute('data-status', '7');
  });

  it('omits `data-swimlane` in non-swimlane mode', () => {
    const { container } = renderColumn({ swimlaneMode: false, swimlaneId: null });
    expect(columnRoot(container).hasAttribute('data-swimlane')).toBe(false);
  });

  it('adds `data-swimlane` in swimlane mode (including the -1 sentinel)', () => {
    const { container } = renderColumn({ swimlaneMode: true, swimlaneId: -1 });
    expect(columnRoot(container)).toHaveAttribute('data-swimlane', '-1');
  });

  it('applies neither fold class by default', () => {
    const { container } = renderColumn();
    const root = columnRoot(container);
    expect(root).not.toHaveClass('vfold');
    expect(root).not.toHaveClass('vunfold');
  });

  it('applies `vfold` when folded and `vunfold` when unfolded', () => {
    const { container: c1 } = renderColumn({ folded: true });
    expect(columnRoot(c1)).toHaveClass('vfold');

    const { container: c2 } = renderColumn({ unfolded: true });
    expect(columnRoot(c2)).toHaveClass('vunfold');
  });
});

// ---------------------------------------------------------------------------
// (1) num-us counter (non-folded)
// ---------------------------------------------------------------------------

describe('Column — num-us counter', () => {
  it('renders `.kanban-task-counter` with the card count when NOT folded', () => {
    const { container } = renderColumn({ orderedIds: [1, 2, 3, 4] });
    const counter = container.querySelector('.kanban-task-counter');
    expect(counter).toBeInTheDocument();
    expect(counter).toHaveAttribute('title', 'Number of US');
    // resting DOM: three `.result` rows, each showing the current count
    const inner = counter!.querySelector('.animated-counter-inner');
    expect(inner).toBeInTheDocument();
    expect(counter!.querySelectorAll('.counter-translator .result')).toHaveLength(3);
    expect(within(counter as HTMLElement).getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render the counter when folded', () => {
    const { container } = renderColumn({ folded: true });
    expect(container.querySelector('.kanban-task-counter')).not.toBeInTheDocument();
  });

  it('adds `wip-amount` and the ` / N` suffix when a WIP limit is set', () => {
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 5 }),
      orderedIds: [1, 2],
    });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).toHaveClass('wip-amount');
    expect(inner).not.toHaveClass('limit-over');
    // suffix present
    expect(within(inner as HTMLElement).getAllByText('/ 5').length).toBeGreaterThanOrEqual(1);
  });

  it('adds `limit-over` when the count exceeds the WIP limit', () => {
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 2 }),
      orderedIds: [1, 2, 3],
    });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).toHaveClass('wip-amount', 'limit-over');
  });

  it('renders `0` and no suffix for an empty column with no WIP limit', () => {
    const { container } = renderColumn({ orderedIds: [] });
    const inner = container.querySelector('.kanban-task-counter .animated-counter-inner');
    expect(inner).not.toHaveClass('wip-amount');
    expect(within(inner as HTMLElement).getAllByText('0').length).toBe(3);
    expect(within(inner as HTMLElement).queryByText(/\//)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) collapsed placeholder (folded)
// ---------------------------------------------------------------------------

describe('Column — collapsed placeholder (folded)', () => {
  it('renders the collapsed wrapper with the amount + name + colour swatch (non-archived)', () => {
    const { container } = renderColumn({
      folded: true,
      status: makeStatus({ name: 'Ready', color: '#ff0000', is_archived: false }),
      orderedIds: [1, 2],
    });
    const collapsed = container.querySelector('.placeholder-collapsed');
    expect(collapsed).toBeInTheDocument();
    const wrapper = collapsed!.querySelector('.placeholder-collapsed-wrapper');
    expect(wrapper).toBeInTheDocument();

    // non-archived -> vertical amount is shown
    const amount = wrapper!.querySelector('.ammount');
    expect(amount).toBeInTheDocument();
    expect(amount!.querySelector('tg-animated-counter')).toHaveAttribute('class', 'vertical');

    // name shown, no (Archived) label
    expect(wrapper!.querySelector('.text-holder .name')).toHaveTextContent('Ready');
    expect(wrapper!.querySelector('.text-holder .archived')).toBeNull();

    // colour swatch carries the status colour
    const swatch = wrapper!.querySelector<HTMLElement>('.square-color');
    expect(swatch).toBeInTheDocument();
    expect(swatch!.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('hides the amount and shows the `(Archived)` label for an archived folded column', () => {
    const { container } = renderColumn({
      folded: true,
      status: makeStatus({ name: 'Done', is_archived: true }),
    });
    const wrapper = container.querySelector('.placeholder-collapsed-wrapper')!;
    expect(wrapper.querySelector('.ammount')).toBeNull();
    expect(wrapper.querySelector('.text-holder .archived')).toHaveTextContent('(Archived)');
    expect(wrapper.querySelector('.text-holder .name')).toHaveTextContent('Done');
  });

  it('does NOT render the collapsed placeholder when not folded', () => {
    const { container } = renderColumn({ folded: false });
    expect(container.querySelector('.placeholder-collapsed')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (3) card placeholder (loading skeleton + "no results")
// ---------------------------------------------------------------------------

describe('Column — card placeholder', () => {
  it('is absent when `showPlaceHolder` is false', () => {
    const { container } = renderColumn({ showPlaceHolder: false });
    expect(container.querySelector('.card-placeholder')).not.toBeInTheDocument();
  });

  it('renders the loading skeleton body when `showPlaceHolder` and NOT `notFoundUserstories`', () => {
    const { container } = renderColumn({ showPlaceHolder: true, notFoundUserstories: false });
    const ph = container.querySelector('.card-placeholder');
    expect(ph).toBeInTheDocument();
    expect(ph).not.toHaveClass('not-found');

    // skeleton structure
    expect(ph!.querySelector('.placeholder-board-card')).toBeInTheDocument();
    expect(ph!.querySelectorAll('.placeholder-board-row')).toHaveLength(3);
    expect(ph!.querySelectorAll('.placeholder-board-text')).toHaveLength(3);
    expect(ph!.querySelector('.placeholder-board-row.avatar')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-board-avatar')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-board-user')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-titles .text-small')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-titles .text-large')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-avatar .image')).toBeInTheDocument();
    expect(ph!.querySelector('.placeholder-avatar .text')).toBeInTheDocument();

    // copy
    expect(within(ph as HTMLElement).getByText('This could be a user story')).toBeInTheDocument();
    expect(
      within(ph as HTMLElement).getByText(
        'Create user stories here and change their status to track their progress.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the "no results" body when `notFoundUserstories`', () => {
    const { container } = renderColumn({ showPlaceHolder: true, notFoundUserstories: true });
    const ph = container.querySelector('.card-placeholder');
    expect(ph).toHaveClass('not-found');
    // skeleton must NOT be present in the not-found branch
    expect(ph!.querySelector('.placeholder-board-card')).toBeNull();
    expect(within(ph as HTMLElement).getByText('No matching results found')).toBeInTheDocument();
    expect(
      within(ph as HTMLElement).getByText(/Try again using more general search terms/),
    ).toBeInTheDocument();
    expect(
      within(ph as HTMLElement).getByText(/Archived stories are not loaded by default/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (4) cards + WIP-limit placement
// ---------------------------------------------------------------------------

describe('Column — cards + WIP-limit placement', () => {
  it('renders one Card per ordered id', () => {
    const { container } = renderColumn({ orderedIds: [11, 22, 33] });
    const cards = container.querySelectorAll('[data-testid="card"]');
    expect(cards).toHaveLength(3);
    expect(Array.from(cards).map((c) => c.getAttribute('data-us-id'))).toEqual(['11', '22', '33']);
  });

  it('renders NO WIP indicator when the status has no WIP limit', () => {
    const { container } = renderColumn({ status: makeStatus({ wip_limit: null }) });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
  });

  it('renders NO WIP indicator for an archived status even with a limit', () => {
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 2, is_archived: true }),
      orderedIds: [1, 2, 3],
    });
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
  });

  it('inserts the WIP indicator immediately AFTER the boundary card (exceeded)', () => {
    // wip_limit 2, 3 cards -> exceeded, boundaryIndex = wip_limit - 1 = 1
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 2 }),
      orderedIds: [1, 2, 3],
    });
    const wip = container.querySelector('.kanban-wip-limit');
    expect(wip).toBeInTheDocument();
    expect(wip).toHaveClass?.('exceeded');
    expect(wip).toHaveClass('exceeded');
    expect(wip).toHaveTextContent('WIP Limit');

    // ordering: the indicator's immediately-preceding card is index 1 (us id 2),
    // and a further card (us id 3) follows the indicator.
    const root = columnRoot(container);
    const kids = Array.from(root.querySelectorAll('[data-testid="card"], .kanban-wip-limit'));
    const wipPos = kids.findIndex((n) => n.classList.contains('kanban-wip-limit'));
    expect(wipPos).toBe(2); // card0, card1, WIP, card2
    expect(kids[wipPos - 1].getAttribute('data-us-id')).toBe('2');
    expect(kids[wipPos + 1].getAttribute('data-us-id')).toBe('3');
  });

  it('inserts the WIP indicator after the last card when the limit is exactly reached', () => {
    // wip_limit 3, 3 cards -> reached, boundaryIndex = cardCount - 1 = 2 (last card)
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 3 }),
      orderedIds: [1, 2, 3],
    });
    const wip = container.querySelector('.kanban-wip-limit');
    expect(wip).toHaveClass('reached');
    const root = columnRoot(container);
    const kids = Array.from(root.querySelectorAll('[data-testid="card"], .kanban-wip-limit'));
    // last node is the WIP indicator
    expect(kids[kids.length - 1].classList.contains('kanban-wip-limit')).toBe(true);
    expect(kids[kids.length - 2].getAttribute('data-us-id')).toBe('3');
  });

  it('renders the "one-left" indicator when one slot remains', () => {
    // wip_limit 3, 2 cards -> one-left, boundaryIndex = cardCount - 1 = 1
    const { container } = renderColumn({
      status: makeStatus({ wip_limit: 3 }),
      orderedIds: [1, 2],
    });
    expect(container.querySelector('.kanban-wip-limit')).toHaveClass('one-left');
  });
});

// ---------------------------------------------------------------------------
// (5) card props mapping (`cardPropsFor`)
// ---------------------------------------------------------------------------

describe('Column — cardPropsFor mapping', () => {
  it('flags only the first card as `isFirst` and forwards static bindings', () => {
    const { container } = renderColumn({ orderedIds: [5, 6], zoomLevel: 3 });
    const cards = container.querySelectorAll('[data-testid="card"]');
    expect(cards[0]).toHaveAttribute('data-is-first', 'true');
    expect(cards[1]).toHaveAttribute('data-is-first', 'false');
    for (const card of Array.from(cards)) {
      expect(card).toHaveAttribute('data-type', 'us');
      expect(card).toHaveAttribute('data-status-id', '7');
      expect(card).toHaveAttribute('data-zoom-level', '3');
      expect(card).toHaveAttribute('data-can-modify', 'true');
      expect(card).toHaveAttribute('data-can-delete', 'true');
      expect(card).toHaveAttribute('data-can-view-tasks', 'true');
      // move-to-top handler forwarded in BOTH modes
      expect(card).toHaveAttribute('data-has-move-to-top', 'true');
    }
  });

  it('resolves `archived`, `inViewPort`, and `selected` from the lookup props', () => {
    const { container } = renderColumn({
      orderedIds: [10, 20],
      isUsArchivedHidden: (id) => id === 10,
      cardVisibility: { 20: true },
      selectedUss: { 10: true },
    });
    const c10 = container.querySelector('[data-us-id="10"]')!;
    const c20 = container.querySelector('[data-us-id="20"]')!;
    expect(c10).toHaveAttribute('data-archived', 'true');
    expect(c10).toHaveAttribute('data-in-viewport', 'false');
    expect(c10).toHaveAttribute('data-selected', 'true');
    expect(c20).toHaveAttribute('data-archived', 'false');
    expect(c20).toHaveAttribute('data-in-viewport', 'true');
    expect(c20).toHaveAttribute('data-selected', 'false');
  });

  it('sets `swimlaneId` on cards and marks moved cards ONLY in swimlane mode', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 3,
      orderedIds: [10, 20],
      movedUs: [20],
    });
    const c10 = container.querySelector('[data-us-id="10"]')!;
    const c20 = container.querySelector('[data-us-id="20"]')!;
    expect(c10).toHaveAttribute('data-swimlane-id', '3');
    expect(c20).toHaveAttribute('data-swimlane-id', '3');
    expect(c10).toHaveAttribute('data-moved', 'false');
    expect(c20).toHaveAttribute('data-moved', 'true'); // moved in swimlane mode
  });

  it('never marks a card as moved in non-swimlane mode', () => {
    const { container } = renderColumn({
      swimlaneMode: false,
      swimlaneId: null,
      orderedIds: [10, 20],
      movedUs: [20],
    });
    expect(container.querySelector('[data-us-id="20"]')).toHaveAttribute('data-moved', 'false');
    expect(container.querySelector('[data-us-id="10"]')).toHaveAttribute('data-swimlane-id', 'null');
  });

  it('defaults archived/inViewPort/selected to false when their lookups are absent', () => {
    const { container } = renderColumn({
      orderedIds: [10],
      isUsArchivedHidden: undefined,
      cardVisibility: undefined,
      selectedUss: undefined,
    });
    const c10 = container.querySelector('[data-us-id="10"]')!;
    expect(c10).toHaveAttribute('data-archived', 'false');
    expect(c10).toHaveAttribute('data-in-viewport', 'false');
    expect(c10).toHaveAttribute('data-selected', 'false');
  });
});

// ---------------------------------------------------------------------------
// (6) sticky counter scroll (tgKanbanTaskboardColumn)
// ---------------------------------------------------------------------------

describe('Column — sticky counter', () => {
  it('translates the counter by the scroll offset on column scroll', () => {
    const { container } = renderColumn({ orderedIds: [1, 2] });
    const root = columnRoot(container);
    const counter = container.querySelector<HTMLElement>('.kanban-task-counter')!;
    expect(counter.style.transform).toBe('');

    // jsdom: set scrollTop then dispatch the scroll event
    Object.defineProperty(root, 'scrollTop', { value: 42, configurable: true });
    fireEvent.scroll(root);
    expect(counter.style.transform).toBe('translateY(42px)');

    Object.defineProperty(root, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(root);
    expect(counter.style.transform).toBe('translateY(0px)');
  });

  it('does not throw scrolling a folded column (no counter present)', () => {
    const { container } = renderColumn({ folded: true });
    const root = columnRoot(container);
    Object.defineProperty(root, 'scrollTop', { value: 10, configurable: true });
    expect(() => fireEvent.scroll(root)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (7) archived-status intro (tgKanbanArchivedStatusIntro)
// ---------------------------------------------------------------------------

describe('Column — archived intro', () => {
  it('renders an EMPTY `.kanban-column-intro` only for archived statuses', () => {
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
// (8) combined structure sanity (non-swimlane vs swimlane)
// ---------------------------------------------------------------------------

describe('Column — end-to-end structure', () => {
  it('non-swimlane populated column: counter + 3 cards, no swimlane/intro/placeholder', () => {
    const { container } = renderColumn({ orderedIds: [1, 2, 3] });
    const root = columnRoot(container);
    expect(root.querySelector('.kanban-task-counter')).toBeInTheDocument();
    expect(root.querySelectorAll('[data-testid="card"]')).toHaveLength(3);
    expect(root.hasAttribute('data-swimlane')).toBe(false);
    expect(root.querySelector('.kanban-column-intro')).toBeNull();
    expect(root.querySelector('.card-placeholder')).toBeNull();
    expect(root.querySelector('.placeholder-collapsed')).toBeNull();
  });

  it('swimlane archived column: data-swimlane + intro + no collapsed amount', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 0,
      status: makeStatus({ is_archived: true, wip_limit: null }),
      orderedIds: [1],
      usersById: { 1: makeUser(1) },
    });
    const root = columnRoot(container);
    expect(root).toHaveAttribute('data-swimlane', '0');
    expect(root.querySelector('.kanban-column-intro')).toBeInTheDocument();
    expect(root.querySelectorAll('[data-testid="card"]')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (9) defensive fallbacks (optional status fields + absent movedUs)
// ---------------------------------------------------------------------------

describe('Column — defensive fallbacks', () => {
  it('treats a status with `wip_limit`/`is_archived` omitted as no-limit, non-archived', () => {
    // Omitting the optional fields exercises the `?? null` / `?? false`
    // fallbacks feeding `computeWipLimit`.
    const status = {
      id: 7,
      name: 'Bare',
      order: 1,
    } as unknown as UsStatus;
    const { container } = renderColumn({ status, orderedIds: [1, 2, 3] });
    // no WIP indicator (limit resolved to null) ...
    expect(container.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
    // ... and no archived intro (archived resolved to false)
    expect(container.querySelector('.kanban-column-intro')).not.toBeInTheDocument();
    // counter present, no `wip-amount`
    expect(
      container.querySelector('.kanban-task-counter .animated-counter-inner'),
    ).not.toHaveClass('wip-amount');
  });

  it('defaults `moved` to false in swimlane mode when `movedUs` is absent', () => {
    const { container } = renderColumn({
      swimlaneMode: true,
      swimlaneId: 2,
      orderedIds: [10],
      movedUs: undefined,
    });
    expect(container.querySelector('[data-us-id="10"]')).toHaveAttribute('data-moved', 'false');
  });
});
