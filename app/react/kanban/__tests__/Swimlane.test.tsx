/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Swimlane.test.tsx
 * -----------------
 * Jest + React Testing Library unit spec for the React Kanban swimlane
 * (`../components/Swimlane`). It contributes to the >=70% line-coverage gate
 * enforced over `app/react/**` and pins the structural + behavioural contract
 * the component ports from the legacy AngularJS swimlane markup and directive.
 *
 * STRUCTURAL ORIGIN (reproduced here, NEVER imported -- the legacy sources stay
 * on the far side of the coexistence boundary):
 *   - the kanban partial `kanban-table.jade` swimlane block (wrapper
 *     `.kanban-swimlane[data-swimlane]`, `button.kanban-swimlane-title` header
 *     78-106, and the `.kanban-table-body > .kanban-table-inner` column list
 *     107-176);
 *   - the `main.coffee` `KanbanSwimlaneDirective` (1130-1190) per-swimlane
 *     `mouseover`/`mouseleave` "auto-open while dragging" behaviour (the
 *     BOARD-level scroll -> `translateX` sticky title is out of scope here).
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file):
 *   - Jest + jsdom only. No Playwright, no real browser, no network.
 *   - The child `./Column` is mocked to a lightweight prop-echoing stub so the
 *     swimlane's per-column prop mapping (`orderedIds`/`folded`/`unfolded`/
 *     `showPlaceHolder` + the spread board-wide `columnContext`) is asserted
 *     WITHOUT pulling in the column's own `useDroppable`/`SortableContext`.
 *   - `@dnd-kit/core` is mocked so `useDndContext().active` -- the drag signal
 *     that drives auto-open -- is deterministically controllable from the spec
 *     (the module-scoped `mockActive`), with no real drag machinery.
 *   - React itself is not imported (automatic `react-jsx` runtime); `jest` is a
 *     global (`@types/jest`), never imported.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Controllable `@dnd-kit/core` mock. The swimlane reads `useDndContext().active`
// to know whether a drag is in progress; the module-scoped `mockActive`
// (name MUST start with `mock*` so Jest allows it inside the hoisted factory)
// lets each test simulate "dragging" (`{}`) or "idle" (`null`).
// ---------------------------------------------------------------------------
let mockActive: unknown = null;
jest.mock('@dnd-kit/core', () => ({
  __esModule: true,
  useDndContext: () => ({ active: mockActive }),
}));

// ---------------------------------------------------------------------------
// Prop-echoing stub for `./Column`. Renders the props the swimlane maps onto it
// as `data-*` attributes so we can assert the mapping without the real column.
// ---------------------------------------------------------------------------
jest.mock('../components/Column', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      const status = props.status as { id?: number } | undefined;
      const orderedIds = (props.orderedIds as number[] | undefined) ?? [];
      return react.createElement('div', {
        'data-testid': 'column',
        'data-status-id': String(status?.id),
        'data-swimlane-id': String(props.swimlaneId),
        'data-swimlane-mode': String(props.swimlaneMode),
        'data-folded': String(props.folded),
        'data-unfolded': String(props.unfolded),
        'data-show-placeholder': String(props.showPlaceHolder),
        'data-ordered': orderedIds.join(','),
        'data-can-modify': String(props.canModify),
      });
    },
  };
});

import Swimlane from '../components/Swimlane';
import type { SwimlaneProps, KanbanColumnContext } from '../components/Swimlane';
import type { UsStatus } from '../components/Column';
import type { Swimlane as SwimlaneModel, Project } from '../state/kanbanReducer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noop = (): void => {};

/** A `Project` with a default swimlane (id 10) and two swimlanes -> badge shows. */
const makeProject = (over: Record<string, unknown> = {}): Project =>
  ({
    id: 1,
    default_swimlane: 10,
    swimlanes: [{ id: 10 }, { id: 11 }],
    ...over,
  } as Project);

/** An open-shape `UsStatus` (only the fields Column reads matter; it is stubbed). */
const makeStatus = (id: number, over: Partial<UsStatus> = {}): UsStatus =>
  ({
    id,
    name: `Status ${id}`,
    order: id,
    color: '#aabbcc',
    wip_limit: null,
    is_archived: false,
    ...over,
  } as UsStatus);

/** The board-wide column context (everything except the six per-column props). */
const makeColumnContext = (project: Project): KanbanColumnContext => ({
  swimlaneMode: true,
  notFoundUserstories: false,
  usMap: {},
  project,
  zoom: [],
  zoomLevel: 0,
  canModify: true,
  canDelete: true,
  onCardToggleFold: noop,
  onCardEdit: noop,
  onCardDelete: noop,
  onCardAssignedTo: noop,
  onCardMoveToTop: noop,
});

const makeProps = (over: Partial<SwimlaneProps> = {}): SwimlaneProps => {
  const project = over.project ?? makeProject();
  const base: SwimlaneProps = {
    swimlane: { id: 10, name: 'Backend', kanban_order: 1 } as SwimlaneModel,
    statuses: [makeStatus(1), makeStatus(2)],
    folded: false,
    project,
    orderedIdsByStatus: { 1: [101, 102], 2: [] },
    foldsByStatus: { 1: false, 2: true },
    unfold: null,
    showPlaceHolder: () => false,
    columnContext: makeColumnContext(project),
    onToggleSwimlane: jest.fn(),
  };
  return { ...base, ...over };
};

beforeEach(() => {
  mockActive = null;
});

// ===========================================================================
// Structure / DOM parity
// ===========================================================================
describe('Swimlane — structure', () => {
  it('renders the .kanban-swimlane wrapper carrying data-swimlane = swimlane.id', () => {
    const { container } = render(<Swimlane {...makeProps()} />);
    const root = container.querySelector('.kanban-swimlane');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-swimlane', '10');
  });

  it('renders the title button with .kanban-swimlane-title and the swimlane name', () => {
    render(<Swimlane {...makeProps({ swimlane: { id: 10, name: 'Backend', kanban_order: 1 } as SwimlaneModel })} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('kanban-swimlane-title');
    const title = btn.querySelector('h2.title-name');
    expect(title).toHaveTextContent('Backend');
  });

  it('when NOT folded: shows the unfold icon, omits the folded class, and renders the body', () => {
    const { container } = render(<Swimlane {...makeProps({ folded: false })} />);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveClass('folded');
    expect(container.querySelector('tg-svg.unfold-action .icon-unfolded-swimlane')).toBeInTheDocument();
    expect(container.querySelector('tg-svg.fold-action')).not.toBeInTheDocument();
    // body present
    expect(container.querySelector('.kanban-table-body .kanban-table-inner')).toBeInTheDocument();
    expect(screen.getAllByTestId('column')).toHaveLength(2);
  });

  it('when folded: adds the folded class, shows the fold icon, and hides the body entirely', () => {
    const { container } = render(<Swimlane {...makeProps({ folded: true })} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('folded');
    expect(container.querySelector('tg-svg.fold-action .icon-folded-swimlane')).toBeInTheDocument();
    expect(container.querySelector('tg-svg.unfold-action')).not.toBeInTheDocument();
    // body absent -> no columns
    expect(container.querySelector('.kanban-table-body')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('column')).toHaveLength(0);
  });
});

// ===========================================================================
// Unclassified swimlane (id === -1)
// ===========================================================================
describe('Swimlane — unclassified (id -1)', () => {
  const unclassified = { id: -1, name: 'Unclassified', kanban_order: 0 } as SwimlaneModel;

  it('adds unclassified-swimlane + unclassified-us-title and renders the tooltip info block', () => {
    const { container } = render(
      <Swimlane {...makeProps({ swimlane: unclassified, statuses: [makeStatus(1)] })} />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('unclassified-swimlane');
    expect(container.querySelector('h2.title-name.unclassified-us-title')).toBeInTheDocument();
    const info = container.querySelector('.unclassified-us-info');
    expect(info).toBeInTheDocument();
    expect(info?.querySelector('tg-svg .icon-help-circle')).toBeInTheDocument();
    const tooltip = container.querySelector('.unclassified-us-info .tooltip.pop-help');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('The user stories that are not part of any swimlane are here.');
  });

  it('a normal swimlane carries NO unclassified classes / info block', () => {
    const { container } = render(<Swimlane {...makeProps()} />);
    expect(screen.getByRole('button')).not.toHaveClass('unclassified-swimlane');
    expect(container.querySelector('.unclassified-us-title')).not.toBeInTheDocument();
    expect(container.querySelector('.unclassified-us-info')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Default-swimlane badge
// ===========================================================================
describe('Swimlane — default-swimlane badge', () => {
  it('shows the badge when swimlane.id === project.default_swimlane AND swimlanes.length > 1', () => {
    const { container } = render(<Swimlane {...makeProps()} />); // id 10 === default 10, 2 swimlanes
    const badge = container.querySelector('.default-swimlane');
    expect(badge).toBeInTheDocument();
    expect(badge?.querySelector('tg-svg.default-swimlane-icon .icon-star')).toBeInTheDocument();
    const text = container.querySelector('.default-swimlane .default-text');
    expect(text).toHaveTextContent('Default');
  });

  it('hides the badge when the project has only one swimlane', () => {
    const project = makeProject({ swimlanes: [{ id: 10 }] });
    const { container } = render(<Swimlane {...makeProps({ project })} />);
    expect(container.querySelector('.default-swimlane')).not.toBeInTheDocument();
  });

  it('hides the badge for a non-default swimlane', () => {
    const { container } = render(
      <Swimlane {...makeProps({ swimlane: { id: 11, name: 'Frontend', kanban_order: 2 } as SwimlaneModel })} />,
    );
    expect(container.querySelector('.default-swimlane')).not.toBeInTheDocument();
  });

  it('hides the badge when project.swimlanes is absent/not an array (defensive)', () => {
    const project = makeProject({ swimlanes: undefined });
    const { container } = render(<Swimlane {...makeProps({ project })} />);
    expect(container.querySelector('.default-swimlane')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Columns — per-status prop mapping
// ===========================================================================
describe('Swimlane — columns', () => {
  it('renders one <Column> per status and threads the correct per-column props', () => {
    const showPlaceHolder = jest.fn((statusId: number) => statusId === 1);
    render(
      <Swimlane
        {...makeProps({
          folded: false,
          statuses: [makeStatus(1), makeStatus(2)],
          orderedIdsByStatus: { 1: [101, 102], 2: [201] },
          foldsByStatus: { 1: false, 2: true },
          unfold: 2,
          showPlaceHolder,
        })}
      />,
    );

    const cols = screen.getAllByTestId('column');
    expect(cols).toHaveLength(2);

    // Column for status 1
    expect(cols[0]).toHaveAttribute('data-status-id', '1');
    expect(cols[0]).toHaveAttribute('data-swimlane-id', '10');
    expect(cols[0]).toHaveAttribute('data-swimlane-mode', 'true'); // from columnContext
    expect(cols[0]).toHaveAttribute('data-ordered', '101,102');
    expect(cols[0]).toHaveAttribute('data-folded', 'false');
    expect(cols[0]).toHaveAttribute('data-unfolded', 'false'); // unfold=2 !== 1
    expect(cols[0]).toHaveAttribute('data-show-placeholder', 'true'); // showPlaceHolder(1)=true
    expect(cols[0]).toHaveAttribute('data-can-modify', 'true'); // spread from columnContext

    // Column for status 2
    expect(cols[1]).toHaveAttribute('data-status-id', '2');
    expect(cols[1]).toHaveAttribute('data-ordered', '201');
    expect(cols[1]).toHaveAttribute('data-folded', 'true'); // foldsByStatus[2]=true
    expect(cols[1]).toHaveAttribute('data-unfolded', 'true'); // unfold=2 === 2
    expect(cols[1]).toHaveAttribute('data-show-placeholder', 'false'); // showPlaceHolder(2)=false

    // showPlaceHolder is invoked with (statusId, swimlaneId)
    expect(showPlaceHolder).toHaveBeenCalledWith(1, 10);
    expect(showPlaceHolder).toHaveBeenCalledWith(2, 10);
  });

  it('defaults a missing orderedIds entry to an empty list', () => {
    render(
      <Swimlane
        {...makeProps({ statuses: [makeStatus(9)], orderedIdsByStatus: {}, foldsByStatus: {} })}
      />,
    );
    const col = screen.getByTestId('column');
    expect(col).toHaveAttribute('data-ordered', '');
    expect(col).toHaveAttribute('data-folded', 'false'); // missing fold -> false
  });
});

// ===========================================================================
// Toggle on click
// ===========================================================================
describe('Swimlane — toggle on click', () => {
  it('calls onToggleSwimlane(swimlane.id) when the title button is clicked', () => {
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ onToggleSwimlane })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggleSwimlane).toHaveBeenCalledTimes(1);
    expect(onToggleSwimlane).toHaveBeenCalledWith(10);
  });
});

// ===========================================================================
// Auto-open while dragging (mouseover/mouseleave + 1000ms)
// ===========================================================================
describe('Swimlane — auto-open while dragging', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('folded + active drag: hover marks pending-to-open, holds through 999ms, then toggles + clears pending exactly at 1000ms', () => {
    mockActive = { id: 'drag' };
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ folded: true, onToggleSwimlane })} />);
    const btn = screen.getByRole('button');

    fireEvent.mouseOver(btn);
    expect(btn).toHaveClass('pending-to-open');
    expect(onToggleSwimlane).not.toHaveBeenCalled();

    // One tick BEFORE the AUTO_OPEN_DELAY_MS (1000ms) deadline: the countdown is
    // still pending and NOTHING has fired yet -- pins the exact boundary the
    // legacy `$timeout(..., 1000)` (main.coffee KanbanSwimlaneDirective) used.
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onToggleSwimlane).not.toHaveBeenCalled();
    expect(btn).toHaveClass('pending-to-open');

    // Crossing the 1000ms deadline (the final +1ms): auto-open fires EXACTLY
    // once with the swimlane id and the `pending-to-open` class is removed.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onToggleSwimlane).toHaveBeenCalledTimes(1);
    expect(onToggleSwimlane).toHaveBeenCalledWith(10);
    expect(btn).not.toHaveClass('pending-to-open');
  });

  it('folded but NO active drag: hover does nothing (no pending, no toggle)', () => {
    mockActive = null;
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ folded: true, onToggleSwimlane })} />);
    const btn = screen.getByRole('button');

    fireEvent.mouseOver(btn);
    expect(btn).not.toHaveClass('pending-to-open');

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onToggleSwimlane).not.toHaveBeenCalled();
  });

  it('NOT folded + active drag: hover does nothing (only folded swimlanes auto-open)', () => {
    mockActive = { id: 'drag' };
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ folded: false, onToggleSwimlane })} />);
    const btn = screen.getByRole('button');

    fireEvent.mouseOver(btn);
    expect(btn).not.toHaveClass('pending-to-open');

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onToggleSwimlane).not.toHaveBeenCalled();
  });

  it('mouseleave cancels a pending auto-open (timer cleared, class removed, no toggle)', () => {
    mockActive = { id: 'drag' };
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ folded: true, onToggleSwimlane })} />);
    const btn = screen.getByRole('button');

    fireEvent.mouseOver(btn);
    expect(btn).toHaveClass('pending-to-open');

    fireEvent.mouseLeave(btn);
    expect(btn).not.toHaveClass('pending-to-open');

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onToggleSwimlane).not.toHaveBeenCalled();
  });

  it('a repeated hover while already pending does NOT restart the countdown', () => {
    mockActive = { id: 'drag' };
    const onToggleSwimlane = jest.fn();
    render(<Swimlane {...makeProps({ folded: true, onToggleSwimlane })} />);
    const btn = screen.getByRole('button');

    fireEvent.mouseOver(btn);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // Second hover mid-countdown must be a no-op (guard on the live timer).
    fireEvent.mouseOver(btn);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // 1000ms total from the FIRST hover -> fires exactly once.
    expect(onToggleSwimlane).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending timer on unmount (no toggle fires afterwards)', () => {
    mockActive = { id: 'drag' };
    const onToggleSwimlane = jest.fn();
    const { unmount } = render(<Swimlane {...makeProps({ folded: true, onToggleSwimlane })} />);
    fireEvent.mouseOver(screen.getByRole('button'));

    unmount();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onToggleSwimlane).not.toHaveBeenCalled();
  });
});
