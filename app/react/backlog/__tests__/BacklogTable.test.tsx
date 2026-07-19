/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link BacklogTable} — the React port of the AngularJS Backlog
 * table (`app/partials/includes/modules/backlog-table.jade` +
 * `app/coffee/modules/backlog/main.coffee:820-861`).
 *
 * Coverage focus (the behaviors BacklogTable uniquely owns, AAP 0.7.1 >=70% gate):
 *  - Header permission gating: the `draggable-us-column` and `input` header cells
 *    render ONLY when `canModifyUs` (jade `tg-check-permission="modify_us"`), while
 *    the `user-stories` / `status` / `points` / `us-header-options` columns are
 *    always present, in the exact source order.
 *  - Body `ng-class`: `show-tags` / `active-filters` / `forecasted-stories` toggle
 *    independently on `.backlog-table-body`.
 *  - Droppable + SortableContext topology: the body is a `useDroppable` keyed
 *    `'backlog'` with `data: { sprintId: null, isBacklog: true }`, and the ordered
 *    ids flow to `<SortableContext items>`.
 *  - Inclusive shift-range multi-select: a plain toggle flips a single id; a
 *    Shift-toggle after an anchor fills the whole contiguous range; a Shift-toggle
 *    with NO anchor degrades to a single toggle; the incoming `selectedIds` set is
 *    NEVER mutated (a fresh `Set` is always emitted).
 *  - Infinite scroll: `onLoadMore` fires only when enabled
 *    (`!disablePagination && firstLoadComplete`) AND the body is within 100px of
 *    the bottom, including the exact 100px boundary, successive paging, the
 *    both-gates-unmet case, and re-enabling after a terminal page.
 *  - Row prop wiring: `selected`, `canModify`, `isFirstInBacklog`, `detailUrl`,
 *    `statusName`, `statusColor`, `pointsLabel`, and the status/options adapters.
 *  - Role-points filter control accessibility + popover anchor (M-25 / M-09): the
 *    `.points .inner` control exposes a button role, an accessible name, a tab
 *    stop, and a popup relationship, activates on Enter/Space, and forwards the
 *    DOM event (so a popover can anchor to `event.currentTarget`).
 *  - Loading live region (M-27): the trailing element is a persistent
 *    `role="status"` / `aria-live="polite"` region whose `aria-busy` and
 *    visually-hidden label track `loadingUserstories`.
 *  - Production drag-end integration (C-02 / M-20): the REAL
 *    `createBacklogDragEndHandler` is driven with the ACTUAL container drag data
 *    BacklogTable registers (`orderedIds` + `isBacklog`/`sprintId` marker) to
 *    prove one correct `bulk_update_backlog_order` call per drop, none on a
 *    cancel/no-op, correct neighbor geometry, and multi-selection handling.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless. Jest + jsdom + React Testing
 * Library ONLY — NO Playwright, NO real browser, NO network. The sibling
 * `UserStoryRow` and both `@dnd-kit` packages are mocked so this spec exercises
 * ONLY BacklogTable's own logic (the row internals + real DnD are covered by
 * their own specs). React is NOT imported (automatic `react-jsx` runtime); `jest`
 * is a global; jest-dom matchers are registered via jest.config `setupFilesAfterEnv`.
 *
 * MOCK STYLE: the `jest.mock` factories use `require('react')` + `createElement`
 * (never JSX) to avoid jest's "out-of-scope variable" restriction on the injected
 * `_jsx` runtime binding — matching the established pattern in
 * `shared/dnd/__tests__/DndProvider.test.tsx`.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

import { BacklogTable } from '../components/BacklogTable';
import type { BacklogTableProps } from '../components/BacklogTable';
import type { UserStory } from '../state/backlogReducer';
// The REAL shared backlog drag-end handler + its structural contract types. These
// are imported (not mocked) so the "production drag-end integration" suite below
// proves the container drag data BacklogTable actually registers is SUFFICIENT to
// drive the frozen `/userstories/bulk_update_backlog_order` call — the true
// component -> provider -> handler seam. `sortable.ts` imports `@dnd-kit/core`
// only as TYPES (erased at runtime), so it coexists with the `@dnd-kit/core`
// value-mock below; its `@dnd-kit/sortable` value import (`useSortable`) is never
// invoked on this path (see the sortable mock's defensive stub).
import { createBacklogDragEndHandler } from '../../shared/dnd/sortable';
import type { BacklogDragResult, BacklogOrderApi } from '../../shared/dnd/types';

// --- Mock the sibling row so this spec targets ONLY BacklogTable ------------
// The stub renders a `user-story-row` element that surfaces the row props as
// data-* attributes and exposes buttons to fire each callback. `onToggleSelect`
// is fired with an explicit shiftKey (no synthetic event needed); the status /
// options buttons call their optional handlers only when present.
jest.mock('../components/UserStoryRow', () => {
  const react = require('react');
  return {
    __esModule: true,
    UserStoryRow: (props: Record<string, any>) =>
      react.createElement(
        'div',
        {
          'data-testid': 'user-story-row',
          'data-us-id': String(props.us.id),
          'data-selected': String(props.selected),
          'data-can-modify': String(props.canModify),
          'data-first': String(props.isFirstInBacklog),
          'data-show-tags': String(props.showTags),
          'data-detail-url': props.detailUrl,
          'data-status-name': props.statusName,
          'data-status-color': props.statusColor ?? '',
          'data-points-label': props.pointsLabel ?? '',
        },
        react.createElement(
          'button',
          {
            'data-testid': 'toggle-' + props.us.id,
            onClick: () => props.onToggleSelect(props.us.id, false),
          },
          'toggle',
        ),
        react.createElement(
          'button',
          {
            'data-testid': 'toggle-shift-' + props.us.id,
            onClick: () => props.onToggleSelect(props.us.id, true),
          },
          'toggle-shift',
        ),
        react.createElement(
          'button',
          {
            'data-testid': 'status-' + props.us.id,
            onClick: () => {
              if (props.onStatusClick) props.onStatusClick(props.us.id);
            },
          },
          'status',
        ),
        react.createElement(
          'button',
          {
            'data-testid': 'options-' + props.us.id,
            onClick: () => {
              if (props.onOptionsClick) props.onOptionsClick(props.us.id);
            },
          },
          'options',
        ),
      ),
  };
});

// --- Mock @dnd-kit/sortable: passthrough SortableContext + strategy sentinel --
// A `useSortable` stub is included defensively: importing the real
// `createBacklogDragEndHandler` (above) transitively loads `shared/dnd/sortable.ts`,
// which imports `useSortable` from this module. It is NEVER called on this spec's
// paths (the sibling `UserStoryRow` — the only `useSortable` consumer — is mocked
// out, and the drag-end handler is a plain function), but stubbing it keeps the
// module contract complete and future-proof.
jest.mock('@dnd-kit/sortable', () => {
  const react = require('react');
  return {
    __esModule: true,
    // Real (pure) `arrayMove` — the production drag-end handler's `computeFinalOrder`
    // uses it to simulate the drop when resolving same-container reorder adjacency
    // (backlog "move to top" fix). Matches @dnd-kit/sortable's implementation.
    arrayMove: (array: unknown[], from: number, to: number): unknown[] => {
      const next = array.slice();
      next.splice(to < 0 ? next.length + to : to, 0, next.splice(from, 1)[0]);
      return next;
    },
    SortableContext: (props: { items?: unknown; children?: unknown }) =>
      react.createElement(
        'div',
        { 'data-testid': 'sortable-context', 'data-item-ids': JSON.stringify(props.items) },
        props.children,
      ),
    verticalListSortingStrategy: 'vertical-list-sorting-strategy',
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: jest.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

// --- Mock @dnd-kit/core: capture the useDroppable config, return a noop ref ---
jest.mock('@dnd-kit/core', () => ({
  __esModule: true,
  useDroppable: jest.fn(() => ({ setNodeRef: jest.fn() })),
}));

import { useDroppable } from '@dnd-kit/core';

/** The mocked droppable hook, typed for call inspection. `clearMocks: true` resets it per test. */
const mockUseDroppable = useDroppable as unknown as jest.Mock;

/** Build a full `UserStory` (only the reducer's required fields matter here). */
const makeUs = (id: number, over: Partial<UserStory> = {}): UserStory => ({
  id,
  ref: id,
  milestone: null,
  project: 1,
  backlog_order: id,
  sprint_order: id,
  total_points: 0,
  ...over,
});

/** Three ordered stories used across the suite: ids 10, 20, 30. */
const US = [makeUs(10), makeUs(20), makeUs(30)];

/**
 * Build a valid `BacklogTableProps` with sensible defaults; override per test.
 * Callback defaults are jest mocks so tests can inspect calls.
 */
const makeProps = (over: Partial<BacklogTableProps> = {}): BacklogTableProps => ({
  userstories: US,
  showTags: false,
  activeFilters: false,
  displayVelocity: false,
  canModifyUs: true,
  selectedIds: new Set<number>(),
  onSelectionChange: jest.fn(),
  loadingUserstories: false,
  disablePagination: false,
  firstLoadComplete: true,
  onLoadMore: jest.fn(),
  buildUserStoryUrl: (us) => `/project/p/us/${us.ref}`,
  getStatusName: () => 'New',
  ...over,
});

/** Query the `.backlog-table-body` element (the droppable + scroll host). */
const getBody = (container: HTMLElement): HTMLDivElement => {
  const body = container.querySelector<HTMLDivElement>('.backlog-table-body');
  if (!body) throw new Error('.backlog-table-body not found');
  return body;
};

/** Define layout metrics on the body so the scroll math is deterministic in jsdom. */
const setScrollMetrics = (
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void => {
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: metrics.scrollTop, configurable: true, writable: true });
};

// Reset every mock's call history before each test so `mockUseDroppable` and the
// per-test callback spies never leak state across cases. The root jest.config.js
// also sets `clearMocks: true`; declaring this hook explicitly satisfies the
// spec contract and keeps the suite deterministic even if that config option is
// ever changed. `jest` is the ambient global (typed via tsconfig `types`) — it is
// intentionally NOT imported (globals-only HARD RULE).
beforeEach(() => {
  jest.clearAllMocks();
});

describe('BacklogTable — header', () => {
  it('renders the six columns in source order, with User Story / Status / Points labels', () => {
    const { container } = render(<BacklogTable {...makeProps()} />);

    expect(container.querySelector('.backlog-table-header')).toBeInTheDocument();
    const title = container.querySelector('.row.backlog-table-title') as HTMLElement;
    expect(title).toBeInTheDocument();

    expect(within(title).getByText('User Story')).toHaveClass('user-stories');
    expect(within(title).getByText('Status')).toHaveClass('status');
    expect(within(title).getByText('Points')).toHaveClass('header-points');

    // The points column carries the role-filter tooltip + the filter icon.
    const points = title.querySelector('.points') as HTMLElement;
    expect(points).toHaveAttribute('title', 'Select view per Role');
    expect(points.querySelector('.inner')).toBeInTheDocument();
    expect(points.querySelector('svg.icon.icon-filter')).toBeInTheDocument();
    expect(title.querySelector('.us-header-options')).toBeInTheDocument();
  });

  it('renders the draggable-us-column + input header cells ONLY when canModifyUs is true', () => {
    const { container } = render(<BacklogTable {...makeProps({ canModifyUs: true })} />);
    expect(container.querySelector('.backlog-table-title > .draggable-us-column')).toBeInTheDocument();
    expect(container.querySelector('.backlog-table-title > .input')).toBeInTheDocument();
  });

  it('omits the draggable-us-column + input header cells when canModifyUs is false', () => {
    const { container } = render(<BacklogTable {...makeProps({ canModifyUs: false })} />);
    expect(container.querySelector('.draggable-us-column')).not.toBeInTheDocument();
    expect(container.querySelector('.backlog-table-title > .input')).not.toBeInTheDocument();
    // The always-present columns remain.
    expect(container.querySelector('.user-stories')).toBeInTheDocument();
    expect(container.querySelector('.us-header-options')).toBeInTheDocument();
  });

  it('fires onRolePointsFilterClick when the points .inner is clicked', () => {
    const onRolePointsFilterClick = jest.fn();
    const { container } = render(
      <BacklogTable {...makeProps({ onRolePointsFilterClick })} />,
    );
    fireEvent.click(container.querySelector('.points .inner') as HTMLElement);
    expect(onRolePointsFilterClick).toHaveBeenCalledTimes(1);
  });
});

// --- M-25 (accessible control) + M-09 (popover anchor): the role-points filter
// is a non-<button> element, so it must expose an explicit button role, an
// accessible name, focusability, a popup relationship, and keyboard activation —
// and it must forward the DOM event so the caller can anchor the popover. ---
describe('BacklogTable — role-points filter control (accessibility + popover anchor)', () => {
  /** The `.points .inner` control (kept a <div> for visual parity). */
  const control = (container: HTMLElement): HTMLElement =>
    container.querySelector('.points .inner') as HTMLElement;

  it('exposes button role, accessible name, focusability and a popup relationship', () => {
    const { container } = render(<BacklogTable {...makeProps({ onRolePointsFilterClick: jest.fn() })} />);
    const el = control(container);

    // Discoverable as a button with a name (queryable by accessible role+name).
    expect(screen.getByRole('button', { name: 'Select view per Role' })).toBe(el);
    expect(el).toHaveAttribute('aria-haspopup', 'dialog');
    // Keyboard-focusable (a real tab stop), not a dead control.
    expect(el).toHaveAttribute('tabindex', '0');
    // Visual parity: it is still a <div> carrying the `.inner` class the SCSS
    // targets (NOT a native <button> that would introduce UA chrome).
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('inner');
  });

  it('forwards the DOM event on click so the popover can anchor to the control (currentTarget)', () => {
    // React nulls `currentTarget` after the handler returns, so the anchor MUST be
    // read synchronously inside the handler (mirrors how a real caller reads it to
    // position a popover). Capturing it here proves the anchor is the control.
    let anchor: EventTarget | null | undefined;
    const onRolePointsFilterClick = jest.fn((event?: { currentTarget?: EventTarget | null }) => {
      anchor = event?.currentTarget ?? null;
    });
    const { container } = render(<BacklogTable {...makeProps({ onRolePointsFilterClick })} />);
    const el = control(container);

    fireEvent.click(el);
    expect(onRolePointsFilterClick).toHaveBeenCalledTimes(1);
    // M-09: the anchor is the control element itself.
    expect(anchor).toBe(el);
  });

  it('activates on Enter and forwards the keyboard event (with default prevented)', () => {
    let anchor: EventTarget | null | undefined;
    let prevented: boolean | undefined;
    const onRolePointsFilterClick = jest.fn(
      (event?: { currentTarget?: EventTarget | null; defaultPrevented?: boolean }) => {
        anchor = event?.currentTarget ?? null;
        prevented = event?.defaultPrevented;
      },
    );
    const { container } = render(<BacklogTable {...makeProps({ onRolePointsFilterClick })} />);
    const el = control(container);

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onRolePointsFilterClick).toHaveBeenCalledTimes(1);
    expect(anchor).toBe(el);
    expect(prevented).toBe(true);
  });

  it('activates on Space and forwards the keyboard event', () => {
    let prevented: boolean | undefined;
    const onRolePointsFilterClick = jest.fn(
      (event?: { defaultPrevented?: boolean }) => {
        prevented = event?.defaultPrevented;
      },
    );
    const { container } = render(<BacklogTable {...makeProps({ onRolePointsFilterClick })} />);
    const el = control(container);

    fireEvent.keyDown(el, { key: ' ' });
    expect(onRolePointsFilterClick).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('does NOT activate on unrelated keys (e.g. Tab, ArrowDown)', () => {
    const onRolePointsFilterClick = jest.fn();
    const { container } = render(<BacklogTable {...makeProps({ onRolePointsFilterClick })} />);
    const el = control(container);

    fireEvent.keyDown(el, { key: 'Tab' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(onRolePointsFilterClick).not.toHaveBeenCalled();
  });

  it('keyboard activation is a harmless no-op when no handler is supplied', () => {
    // No onRolePointsFilterClick -> the control still renders and Enter/Space do
    // nothing (covers the guard branch in handleRolePointsKeyDown).
    const { container } = render(<BacklogTable {...makeProps()} />);
    const el = control(container);
    expect(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
      fireEvent.keyDown(el, { key: ' ' });
    }).not.toThrow();
  });
});

// --- finding #12: the header "view points per Role" popover. Rendered ONLY when
// `roles` (with computable entries) + `onSelectRoleView` are supplied; drives the
// reducer `pointsViewRoleId` so every row's points cell switches display together.
describe('BacklogTable — header role-view popover (finding #12)', () => {
  /** Two computable roles (UX, Front) + one non-computable (Product Owner). */
  const ROLES = [
    { id: 13, name: 'UX', computable: true },
    { id: 15, name: 'Front', computable: true },
    { id: 17, name: 'Product Owner', computable: false },
  ];
  /** The `.points .inner` header control. */
  const control = (container: HTMLElement): HTMLElement =>
    container.querySelector('.points .inner') as HTMLElement;

  it('opens the .pop-role popover with "All roles" + one entry per computable role', () => {
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView: jest.fn() })} />,
    );
    // Closed initially.
    expect(container.querySelector('.points .pop-role')).toBeNull();
    fireEvent.click(control(container));
    const popover = container.querySelector('.points .pop-role') as HTMLElement;
    expect(popover).toBeInTheDocument();
    // "All roles" clear-selection + the two COMPUTABLE roles (PO excluded).
    expect(popover.querySelector('.clear-selection')).toBeInTheDocument();
    expect(popover.querySelectorAll('a.role')).toHaveLength(2);
    expect(popover).toHaveTextContent('UX');
    expect(popover).toHaveTextContent('Front');
    expect(popover).not.toHaveTextContent('Product Owner');
  });

  it('shows the header label "Points" when no role is selected', () => {
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView: jest.fn(), pointsViewRoleId: null })} />,
    );
    expect(container.querySelector('.header-points')).toHaveTextContent('Points');
  });

  it('shows the selected role name as the header label', () => {
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView: jest.fn(), pointsViewRoleId: 15 })} />,
    );
    expect(container.querySelector('.header-points')).toHaveTextContent('Front');
  });

  it('marks the selected role entry with active-popover', () => {
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView: jest.fn(), pointsViewRoleId: 15 })} />,
    );
    fireEvent.click(control(container));
    const front = container.querySelector('.points .pop-role a[data-role-id="15"]') as HTMLElement;
    expect(front).toHaveClass('role', 'active-popover');
  });

  it('marks "All roles" active-popover when no role is selected', () => {
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView: jest.fn(), pointsViewRoleId: null })} />,
    );
    fireEvent.click(control(container));
    expect(container.querySelector('.points .pop-role .clear-selection')).toHaveClass('active-popover');
  });

  it('calls onSelectRoleView(roleId) and closes when a role is chosen', () => {
    const onSelectRoleView = jest.fn();
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView })} />,
    );
    fireEvent.click(control(container));
    fireEvent.click(container.querySelector('.points .pop-role a[data-role-id="13"]') as HTMLElement);
    expect(onSelectRoleView).toHaveBeenCalledWith(13);
    expect(container.querySelector('.points .pop-role')).toBeNull();
  });

  it('calls onSelectRoleView(null) and closes when "All roles" is chosen', () => {
    const onSelectRoleView = jest.fn();
    const { container } = render(
      <BacklogTable {...makeProps({ roles: ROLES, onSelectRoleView, pointsViewRoleId: 15 })} />,
    );
    fireEvent.click(control(container));
    fireEvent.click(container.querySelector('.points .pop-role .clear-selection') as HTMLElement);
    expect(onSelectRoleView).toHaveBeenCalledWith(null);
    expect(container.querySelector('.points .pop-role')).toBeNull();
  });

  it('does NOT open the role-view popover when onSelectRoleView is absent (baseline)', () => {
    const { container } = render(<BacklogTable {...makeProps({ roles: ROLES })} />);
    fireEvent.click(control(container));
    expect(container.querySelector('.points .pop-role')).toBeNull();
  });

  it('does NOT open the role-view popover when there are no computable roles', () => {
    const nonComputable = [{ id: 17, name: 'Product Owner', computable: false }];
    const { container } = render(
      <BacklogTable {...makeProps({ roles: nonComputable, onSelectRoleView: jest.fn() })} />,
    );
    fireEvent.click(control(container));
    expect(container.querySelector('.points .pop-role')).toBeNull();
  });
});

describe('BacklogTable — body ng-class', () => {
  it('is just "backlog-table-body" when all flags are false', () => {
    const { container } = render(<BacklogTable {...makeProps()} />);
    const body = getBody(container);
    expect(body.className).toBe('backlog-table-body');
  });

  it('adds show-tags / active-filters / forecasted-stories independently', () => {
    const { container } = render(
      <BacklogTable
        {...makeProps({ showTags: true, activeFilters: true, displayVelocity: true })}
      />,
    );
    const body = getBody(container);
    expect(body).toHaveClass('backlog-table-body', 'show-tags', 'active-filters', 'forecasted-stories');
  });

  it('adds only show-tags when only showTags is true', () => {
    const { container } = render(<BacklogTable {...makeProps({ showTags: true })} />);
    const body = getBody(container);
    expect(body).toHaveClass('show-tags');
    expect(body).not.toHaveClass('active-filters');
    expect(body).not.toHaveClass('forecasted-stories');
  });
});

describe('BacklogTable — droppable + sortable topology', () => {
  it('registers the body droppable with id "backlog", the isBacklog/null-sprint marker, and the ordered ids', () => {
    render(<BacklogTable {...makeProps()} />);
    // C-02: the container droppable must carry `orderedIds` (the current row
    // order) so the shared backlog drag-end handler can resolve the drop position
    // when a story is dropped onto the backlog BODY (not onto a specific row).
    expect(mockUseDroppable).toHaveBeenCalledWith({
      id: 'backlog',
      data: { sprintId: null, isBacklog: true, orderedIds: [10, 20, 30] },
    });
  });

  it('keeps the droppable orderedIds in sync with the visible (filtered/reordered) rows', () => {
    // A different visible order/subset must be reflected verbatim in the drag data
    // so the handler never computes against a stale order.
    render(<BacklogTable {...makeProps({ userstories: [makeUs(30), makeUs(10)] })} />);
    expect(mockUseDroppable).toHaveBeenCalledWith({
      id: 'backlog',
      data: { sprintId: null, isBacklog: true, orderedIds: [30, 10] },
    });
  });

  it('passes the ordered ids to SortableContext and renders one row per story in order', () => {
    render(<BacklogTable {...makeProps()} />);
    expect(screen.getByTestId('sortable-context')).toHaveAttribute('data-item-ids', '[10,20,30]');

    const rows = screen.getAllByTestId('user-story-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('data-us-id'))).toEqual(['10', '20', '30']);
  });

  it('renders an empty backlog (no rows) without error and still with the header', () => {
    const { container } = render(<BacklogTable {...makeProps({ userstories: [] })} />);
    expect(screen.queryAllByTestId('user-story-row')).toHaveLength(0);
    expect(screen.getByTestId('sortable-context')).toHaveAttribute('data-item-ids', '[]');
    expect(container.querySelector('.backlog-table-header')).toBeInTheDocument();
  });
});

describe('BacklogTable — row prop wiring', () => {
  it('threads selected / canModify / isFirstInBacklog / detailUrl / statusName / statusColor / pointsLabel', () => {
    render(
      <BacklogTable
        {...makeProps({
          selectedIds: new Set<number>([20]),
          canModifyUs: false,
          showTags: true,
          firstUsInBacklogId: 10,
          buildUserStoryUrl: (us) => `/us/${us.id}`,
          getStatusName: (us) => `status-${us.id}`,
          getStatusColor: (us) => (us.id === 10 ? '#ff0000' : undefined),
          getPointsLabel: (us) => `${us.id}pts`,
        })}
      />,
    );

    const rows = screen.getAllByTestId('user-story-row');
    const [first, second] = rows;

    // selected reflects membership in selectedIds (only id 20).
    expect(first).toHaveAttribute('data-selected', 'false');
    expect(second).toHaveAttribute('data-selected', 'true');

    // canModify mirrors canModifyUs; showTags is forwarded.
    expect(first).toHaveAttribute('data-can-modify', 'false');
    expect(first).toHaveAttribute('data-show-tags', 'true');

    // isFirstInBacklog true only for the matching id.
    expect(first).toHaveAttribute('data-first', 'true');
    expect(second).toHaveAttribute('data-first', 'false');

    // Resolved getters.
    expect(first).toHaveAttribute('data-detail-url', '/us/10');
    expect(first).toHaveAttribute('data-status-name', 'status-10');
    expect(first).toHaveAttribute('data-status-color', '#ff0000');
    expect(second).toHaveAttribute('data-status-color', ''); // undefined -> ''
    expect(first).toHaveAttribute('data-points-label', '10pts');
  });

  it('adapts onStatusClick / onOptionsClick to call the outer handler with the UserStory', () => {
    const onStatusClick = jest.fn();
    const onOptionsClick = jest.fn();
    render(<BacklogTable {...makeProps({ onStatusClick, onOptionsClick })} />);

    fireEvent.click(screen.getByTestId('status-20'));
    expect(onStatusClick).toHaveBeenCalledTimes(1);
    expect(onStatusClick).toHaveBeenCalledWith(expect.objectContaining({ id: 20 }));

    fireEvent.click(screen.getByTestId('options-30'));
    expect(onOptionsClick).toHaveBeenCalledTimes(1);
    expect(onOptionsClick).toHaveBeenCalledWith(expect.objectContaining({ id: 30 }));
  });

  it('passes undefined status/options handlers through when the outer handlers are absent', () => {
    // No onStatusClick / onOptionsClick -> the adapters resolve to undefined and
    // clicking is a harmless noop (covers the ternary `: undefined` branch).
    render(<BacklogTable {...makeProps()} />);
    expect(() => {
      fireEvent.click(screen.getByTestId('status-10'));
      fireEvent.click(screen.getByTestId('options-10'));
    }).not.toThrow();
  });
});

describe('BacklogTable — shift-range multi-select', () => {
  it('toggles a single id on a plain (non-shift) click', () => {
    const onSelectionChange = jest.fn();
    render(<BacklogTable {...makeProps({ onSelectionChange })} />);

    fireEvent.click(screen.getByTestId('toggle-20'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0][0] as ReadonlySet<number>;
    expect([...next]).toEqual([20]);
  });

  it('removes an already-selected id on a plain click', () => {
    const onSelectionChange = jest.fn();
    render(
      <BacklogTable {...makeProps({ onSelectionChange, selectedIds: new Set<number>([20]) })} />,
    );

    fireEvent.click(screen.getByTestId('toggle-20'));
    const next = onSelectionChange.mock.calls[0][0] as ReadonlySet<number>;
    expect(next.has(20)).toBe(false);
  });

  it('fills the inclusive contiguous range on a Shift click after an anchor', () => {
    const onSelectionChange = jest.fn();
    render(<BacklogTable {...makeProps({ onSelectionChange })} />);

    // Anchor on id 10 (index 0), then Shift-click id 30 (index 2).
    fireEvent.click(screen.getByTestId('toggle-10'));
    fireEvent.click(screen.getByTestId('toggle-shift-30'));

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    const range = onSelectionChange.mock.calls[1][0] as ReadonlySet<number>;
    expect([...range].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('fills the range regardless of click direction (high anchor -> low click)', () => {
    const onSelectionChange = jest.fn();
    render(<BacklogTable {...makeProps({ onSelectionChange })} />);

    fireEvent.click(screen.getByTestId('toggle-30')); // anchor index 2
    fireEvent.click(screen.getByTestId('toggle-shift-10')); // shift to index 0

    const range = onSelectionChange.mock.calls[1][0] as ReadonlySet<number>;
    expect([...range].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('degrades a Shift click with NO prior anchor to a single toggle', () => {
    const onSelectionChange = jest.fn();
    render(<BacklogTable {...makeProps({ onSelectionChange })} />);

    fireEvent.click(screen.getByTestId('toggle-shift-20')); // shift, but anchor is null
    const next = onSelectionChange.mock.calls[0][0] as ReadonlySet<number>;
    expect([...next]).toEqual([20]);
  });

  it('never mutates the incoming selectedIds set (emits a fresh Set)', () => {
    const onSelectionChange = jest.fn();
    const original = new Set<number>([10]);
    render(<BacklogTable {...makeProps({ onSelectionChange, selectedIds: original })} />);

    fireEvent.click(screen.getByTestId('toggle-20'));
    const emitted = onSelectionChange.mock.calls[0][0] as ReadonlySet<number>;

    // The original is untouched; a new, different Set instance is emitted.
    expect([...original]).toEqual([10]);
    expect(emitted).not.toBe(original);
    expect([...emitted].sort((a, b) => a - b)).toEqual([10, 20]);
  });
});

describe('BacklogTable — infinite scroll', () => {
  it('fires onLoadMore when enabled and scrolled within 100px of the bottom', () => {
    const onLoadMore = jest.fn();
    const { container } = render(<BacklogTable {...makeProps({ onLoadMore })} />);
    const body = getBody(container);

    // 1000 - 700 - 300 = 0 (<= 100) -> near bottom.
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onLoadMore when far from the bottom', () => {
    const onLoadMore = jest.fn();
    const { container } = render(<BacklogTable {...makeProps({ onLoadMore })} />);
    const body = getBody(container);

    // 1000 - 0 - 300 = 700 (> 100) -> not near bottom.
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(body);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT fire onLoadMore when pagination is disabled', () => {
    const onLoadMore = jest.fn();
    const { container } = render(
      <BacklogTable {...makeProps({ onLoadMore, disablePagination: true })} />,
    );
    const body = getBody(container);
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT fire onLoadMore until the first load completes', () => {
    const onLoadMore = jest.fn();
    const { container } = render(
      <BacklogTable {...makeProps({ onLoadMore, firstLoadComplete: false })} />,
    );
    const body = getBody(container);
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('fires at EXACTLY the 100px threshold but not one pixel beyond it', () => {
    const onLoadMore = jest.fn();
    const { container } = render(<BacklogTable {...makeProps({ onLoadMore })} />);
    const body = getBody(container);

    // distance = 1000 - 600 - 300 = 100 -> `<= 100` fires.
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 });
    fireEvent.scroll(body);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // distance = 1000 - 599 - 300 = 101 -> just past the threshold, no fire.
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 599 });
    fireEvent.scroll(body);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('can fire on successive near-bottom scrolls (paging through multiple pages)', () => {
    const onLoadMore = jest.fn();
    const { container } = render(<BacklogTable {...makeProps({ onLoadMore })} />);
    const body = getBody(container);

    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body);
    fireEvent.scroll(body);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('stays disabled at the bottom while BOTH gates are unmet (disabled AND first load incomplete)', () => {
    const onLoadMore = jest.fn();
    const { container } = render(
      <BacklogTable
        {...makeProps({ onLoadMore, disablePagination: true, firstLoadComplete: false })}
      />,
    );
    const body = getBody(container);
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('re-enables loading the next page once disablePagination flips false (terminal-page reversal)', () => {
    const onLoadMore = jest.fn();
    const { container, rerender } = render(
      <BacklogTable {...makeProps({ onLoadMore, disablePagination: true })} />,
    );
    const body = getBody(container);
    setScrollMetrics(body, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    // Terminal page reached -> disabled -> no fetch.
    fireEvent.scroll(body);
    expect(onLoadMore).not.toHaveBeenCalled();

    // Pagination re-enabled (e.g. filters changed) -> a near-bottom scroll now pages.
    rerender(<BacklogTable {...makeProps({ onLoadMore, disablePagination: false })} />);
    const body2 = getBody(container);
    setScrollMetrics(body2, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(body2);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe('BacklogTable — loading spinner', () => {
  it('shows the spinner classes on the trailing element only while loading', () => {
    const { container, rerender } = render(<BacklogTable {...makeProps({ loadingUserstories: true })} />);
    expect(container.querySelector('.backlog-table-body > .loading-spinner.is-loading')).toBeInTheDocument();

    rerender(<BacklogTable {...makeProps({ loadingUserstories: false })} />);
    expect(container.querySelector('.loading-spinner')).not.toBeInTheDocument();
  });

  // --- M-27: the loading element must be an accessible, color-independent live
  // region so screen-reader users perceive the loading state that sighted users
  // infer from the spinner animation. ---

  it('is ALWAYS a polite status live region (present even when idle) so AT registers it', () => {
    // Idle: the element exists as an empty role="status" region with aria-busy
    // false and no spinner classes (so it is visually empty — no layout change).
    const { container } = render(<BacklogTable {...makeProps({ loadingUserstories: false })} />);
    const region = container.querySelector('.backlog-table-body > [role="status"]') as HTMLElement;
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(region).not.toHaveClass('is-loading');
    // No visually-hidden label while idle.
    expect(region).toHaveTextContent('');
  });

  it('exposes aria-busy=true and a screen-reader-only label while loading', () => {
    const { container } = render(<BacklogTable {...makeProps({ loadingUserstories: true })} />);
    const region = container.querySelector('.backlog-table-body > [role="status"]') as HTMLElement;
    expect(region).toHaveAttribute('aria-busy', 'true');

    // The status region is announced by name — a visually-hidden label carries the
    // color-independent loading text, routed through the shared `t('COMMON.LOADING')`
    // key (finding D#4) so it is localizable like the rest of the app.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading...');

    // The label is visually hidden (clip-rect technique) — it must NOT occupy a
    // visible box, so the zero-visual-change contract holds.
    const label = region.querySelector('span') as HTMLElement;
    expect(label).toBeInTheDocument();
    expect(label.style.position).toBe('absolute');
    expect(label.style.width).toBe('1px');
    expect(label.style.height).toBe('1px');
    expect(label.style.overflow).toBe('hidden');
  });

  it('toggles aria-busy and the hidden label as loading flips false -> true -> false', () => {
    const { container, rerender } = render(<BacklogTable {...makeProps({ loadingUserstories: false })} />);
    const region = () => container.querySelector('.backlog-table-body > [role="status"]') as HTMLElement;

    expect(region()).toHaveAttribute('aria-busy', 'false');
    expect(region().querySelector('span')).toBeNull();

    rerender(<BacklogTable {...makeProps({ loadingUserstories: true })} />);
    expect(region()).toHaveAttribute('aria-busy', 'true');
    expect(region().querySelector('span')).not.toBeNull();

    rerender(<BacklogTable {...makeProps({ loadingUserstories: false })} />);
    expect(region()).toHaveAttribute('aria-busy', 'false');
    expect(region().querySelector('span')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C-02 / M-20: production drag-end integration (component -> provider -> handler)
// ---------------------------------------------------------------------------
// The unit suites above mock `@dnd-kit` to inspect what BacklogTable REGISTERS.
// This suite closes the loop: it takes the ACTUAL container drag data the
// component hands to the `@dnd-kit` provider (captured from the real
// `useDroppable(...)` argument) and feeds it into the REAL
// `createBacklogDragEndHandler` from `shared/dnd/sortable.ts`. That proves the
// registered data is SUFFICIENT for the shared handler to (a) resolve the correct
// drop geometry when a story lands on the backlog BODY, (b) issue EXACTLY ONE
// frozen `/userstories/bulk_update_backlog_order` call per drop, (c) issue NONE on
// a cancel or a no-op, and (d) honor the multi-selection. Without the `orderedIds`
// the component now supplies (C-02), the handler would compute index -1 / null
// neighbors — so these assertions would fail, which is exactly the regression the
// finding required be covered.
describe('BacklogTable — production drag-end integration (real handler)', () => {
  /**
   * Derive the handler's event parameter type from its return signature (the same
   * pattern the shared DnD spec uses) so no value is imported from the mocked
   * `@dnd-kit/core` module.
   */
  type DragEndEventLike = Parameters<ReturnType<typeof createBacklogDragEndHandler>>[0];

  /**
   * Build a minimal drag-end event exposing only the fields the handler reads.
   *
   * `overId` is the id of the drop target the shared handler simulates the drop
   * over (`over.id`): the container key `'backlog'` for a drop on the list BODY
   * (past the last row -> the row moves to the END), or a sibling ROW id for an
   * interior reorder (the row is relocated to that row's slot). It defaults to
   * the container so body-drop cases read naturally. NOTE: `overData.orderedIds`
   * is the container's CURRENT (pre-drop) row order — the exact list the real
   * `BacklogTable` registers on its body droppable — and the handler SIMULATES
   * the drop of `activeId` over `overId` to derive the final geometry.
   */
  const makeBacklogEvent = (
    activeId: number,
    activeData: Record<string, unknown> | undefined,
    overData: Record<string, unknown> | null,
    overId: number | string = 'backlog',
  ): DragEndEventLike => {
    const active = {
      id: activeId,
      data: { current: activeData },
      rect: { current: { initial: null, translated: null } },
    };
    const over =
      overData === null
        ? null
        : { id: overId, rect: {}, data: { current: overData }, disabled: false };
    return {
      activatorEvent: new Event('pointerup'),
      active,
      collisions: null,
      delta: { x: 0, y: 0 },
      over,
    } as unknown as DragEndEventLike;
  };

  /**
   * Render BacklogTable and return the EXACT `data` object it registered on its
   * body droppable (the real `useDroppable(...)` first argument). This is the
   * container drag data the shared handler consumes as `over.data.current`.
   */
  const registeredBacklogData = (
    over: Partial<BacklogTableProps> = {},
  ): Record<string, unknown> => {
    render(<BacklogTable {...makeProps(over)} />);
    const calls = mockUseDroppable.mock.calls;
    const lastArg = calls[calls.length - 1][0] as { id: string; data: Record<string, unknown> };
    return lastArg.data;
  };

  /** A fresh injected API whose one method resolves; asserted for call shape. */
  const makeApi = () =>
    ({ bulkUpdateBacklogOrder: jest.fn().mockResolvedValue({}) }) as unknown as BacklogOrderApi & {
      bulkUpdateBacklogOrder: jest.Mock;
    };

  // The handler cleans up a body drag-state class + `.doom-line` nodes on every
  // dragend; reset the body between cases so nothing leaks.
  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('the registered container data carries the exact visible order the handler needs', () => {
    const data = registeredBacklogData();
    expect(data).toMatchObject({ sprintId: null, isBacklog: true, orderedIds: [10, 20, 30] });
  });

  it('drives EXACTLY ONE bulk_update_backlog_order call with correct geometry for a body drop', async () => {
    const overData = registeredBacklogData(); // { sprintId:null, isBacklog:true, orderedIds:[10,20,30] }
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({ projectId: 7, onMove, api, getSelectedIds: () => [] });

    // Story 10 (currently the FIRST row, pre-drop index 0) is dropped onto the
    // backlog BODY past the last row. A body drop resolves to "move to the end",
    // so the handler simulates the drop and lands it LAST -> previous=30,
    // next=null (after-precedence). oldIndex 0 != final index 2, so this is a real
    // reorder, not a no-op.
    await handler(
      makeBacklogEvent(10, { sprintId: null, isBacklog: true, oldIndex: 0 }, overData),
    );

    expect(onMove).toHaveBeenCalledTimes(1);
    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result).toEqual({
      movedIds: [10],
      targetSprintId: null,
      index: 2,
      previousUs: 30,
      nextUs: null,
      isBacklog: true,
    });

    // Frozen contract: bulkUpdateBacklogOrder(project, milestone|null, after, before, ids).
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, 30, null, [10]);
  });

  it('resolves an interior body drop to the correct previous neighbor', async () => {
    const overData = registeredBacklogData(); // orderedIds [10,20,30]
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({ projectId: 7, onMove, api, getSelectedIds: () => [] });

    // Story 30 lands at index 2 having started at index 0 -> previous=20.
    await handler(
      makeBacklogEvent(30, { sprintId: null, isBacklog: true, oldIndex: 0 }, overData),
    );

    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result.index).toBe(2);
    expect(result.previousUs).toBe(20);
    expect(result.nextUs).toBeNull();
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, 20, null, [30]);
  });

  it('issues NO request and NO optimistic move on a no-op drop (same container, same index)', async () => {
    const overData = registeredBacklogData();
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({ projectId: 7, onMove, api, getSelectedIds: () => [] });

    // Story 30 is already the LAST row (pre-drop index 2). Dropping it on the
    // backlog body resolves to "move to the end", i.e. back to index 2 -> the
    // simulated final index equals oldIndex 2, so the same-container no-op guard
    // fires: no optimistic move and no request.
    await handler(
      makeBacklogEvent(30, { sprintId: null, isBacklog: true, oldIndex: 2 }, overData),
    );

    expect(onMove).not.toHaveBeenCalled();
    expect(api.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
  });

  it('issues NO request and NO optimistic move on a cancelled drop (no drop target)', async () => {
    registeredBacklogData();
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({ projectId: 7, onMove, api, getSelectedIds: () => [] });

    // over === null -> the drag was released outside any droppable.
    await handler(makeBacklogEvent(10, { sprintId: null, isBacklog: true, oldIndex: 2 }, null));

    expect(onMove).not.toHaveBeenCalled();
    expect(api.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
  });

  it('honors the multi-selection: moved ids carry the whole selection when it includes the active row', async () => {
    const overData = registeredBacklogData();
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({
      projectId: 7,
      onMove,
      api,
      getSelectedIds: () => [10, 20],
    });

    // Selection is {10,20} and the active row 10 (pre-drop index 0) is dropped on
    // the body -> move to the end. The whole selection travels with the anchor,
    // so movedIds carries [10,20]; the anchor's simulated neighbors are
    // previous=30, next=null (after-precedence).
    await handler(
      makeBacklogEvent(10, { sprintId: null, isBacklog: true, oldIndex: 0 }, overData),
    );

    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result.movedIds).toEqual([10, 20]);
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, 30, null, [10, 20]);
  });

  it('routes a story dragged FROM a sprint INTO the backlog (targetSprintId null)', async () => {
    const onMove = jest.fn();
    const api = makeApi();
    const handler = createBacklogDragEndHandler({ projectId: 7, onMove, api, getSelectedIds: () => [] });

    // Active story 20 came from sprint 9 (isBacklog:false); the backlog currently
    // holds rows [10, 30] (20 is not among them until the move applies). Dropping
    // 20 OVER backlog row 30 cross-inserts it at row 30's slot -> final
    // [10, 20, 30], so it lands at index 1 with previous=10 (after-precedence);
    // isBacklog true, targetSprintId null.
    const overData = { sprintId: null, isBacklog: true, orderedIds: [10, 30] };
    await handler(
      makeBacklogEvent(20, { sprintId: 9, isBacklog: false, oldIndex: 0 }, overData, 30),
    );

    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result.isBacklog).toBe(true);
    expect(result.targetSprintId).toBeNull();
    expect(result.index).toBe(1);
    expect(result.previousUs).toBe(10);
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
    expect(api.bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, 10, null, [20]);
  });
});
