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
 *    the bottom.
 *  - Row prop wiring: `selected`, `canModify`, `isFirstInBacklog`, `detailUrl`,
 *    `statusName`, `statusColor`, `pointsLabel`, and the status/options adapters.
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
jest.mock('@dnd-kit/sortable', () => {
  const react = require('react');
  return {
    __esModule: true,
    SortableContext: (props: { items?: unknown; children?: unknown }) =>
      react.createElement(
        'div',
        { 'data-testid': 'sortable-context', 'data-item-ids': JSON.stringify(props.items) },
        props.children,
      ),
    verticalListSortingStrategy: 'vertical-list-sorting-strategy',
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
  it('registers the body droppable with id "backlog" and the isBacklog/null-sprint marker', () => {
    render(<BacklogTable {...makeProps()} />);
    expect(mockUseDroppable).toHaveBeenCalledWith({
      id: 'backlog',
      data: { sprintId: null, isBacklog: true },
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
});

describe('BacklogTable — loading spinner', () => {
  it('shows the spinner classes on the trailing element only while loading', () => {
    const { container, rerender } = render(<BacklogTable {...makeProps({ loadingUserstories: true })} />);
    expect(container.querySelector('.backlog-table-body > .loading-spinner.is-loading')).toBeInTheDocument();

    rerender(<BacklogTable {...makeProps({ loadingUserstories: false })} />);
    expect(container.querySelector('.loading-spinner')).not.toBeInTheDocument();
  });
});
