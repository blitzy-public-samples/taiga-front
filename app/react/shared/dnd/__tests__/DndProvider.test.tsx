/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for `DndProvider` — the `@dnd-kit` `<DndContext>` provider that
 * drives the React Kanban/Backlog drag lifecycle (F09 coverage, F41 visual
 * parity, contract freeze).
 *
 * STRATEGY
 * --------
 * A real `<DndContext>` drag cannot be simulated deterministically under jsdom
 * (it needs real pointer geometry + a live layout), so `@dnd-kit/core` is mocked
 * so that `DndContext` merely renders its children and RECORDS the props it is
 * given (sensors, autoScroll, and the four lifecycle handlers). The handlers are
 * then invoked DIRECTLY with fake `Drag*Event`s — the same fake-event technique
 * used by the sibling `sortable.test.tsx` — to assert the exact class
 * side-effects that reproduce the legacy `dragula` drakes:
 *   - kanban `over`/`out` `target-drop` toggling (kanban/sortable.coffee:65-73),
 *   - backlog `drag`/`dragend` `drag-active` body class (backlog/sortable.coffee:73,103),
 *   - the await-then-cleanup ordering of drag end, and
 *   - drag cancel cleaning up WITHOUT invoking the injected move handler.
 *
 * The mock SPREADS the real module (`jest.requireActual`) and overrides ONLY
 * `DndContext` + `DragOverlay`, so the real `PointerSensor` / `useSensor` /
 * `useSensors` (used by `../sensors`) and `AutoScrollActivator` (used by
 * `../autoScroll`) keep working and reference-equality against the real
 * auto-scroll constants still holds.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragCancelEvent,
} from '@dnd-kit/core';

// Mock `@dnd-kit/core`: keep the REAL module (sensors/auto-scroll depend on it)
// and override only the two rendering components so we can (a) render children
// synchronously and (b) capture the props passed to `<DndContext>`.
jest.mock('@dnd-kit/core', () => {
  const actual = jest.requireActual('@dnd-kit/core');
  const react = require('react');
  return {
    __esModule: true,
    ...actual,
    DndContext: jest.fn((props: Record<string, unknown>) =>
      react.createElement('div', { 'data-testid': 'dnd-context' }, props.children as React.ReactNode),
    ),
    DragOverlay: jest.fn((props: Record<string, unknown>) =>
      react.createElement(
        'div',
        { 'data-testid': 'drag-overlay', className: props.className as string },
        props.children as React.ReactNode,
      ),
    ),
  };
});

import { DndContext } from '@dnd-kit/core';
import DndProvider, { type DndProviderProps } from '../DndProvider';
import { getAutoScrollOptions } from '../autoScroll';
import { DND_CLASS } from '../types';

const DndContextMock = DndContext as unknown as jest.Mock;

/** Props of the MOST RECENT `<DndContext>` render (handlers + sensors + autoScroll). */
interface CapturedProps {
  sensors: unknown;
  autoScroll: unknown;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  // The provider's `handleDragEnd` is declared `async`, so the captured prop is
  // always a `Promise<void>` (narrower than the public `void | Promise<void>`
  // prop type) — this lets the specs `await` / `.catch` it directly.
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onDragCancel: (event: DragCancelEvent) => void;
}

function lastProps(): CapturedProps {
  const { calls } = DndContextMock.mock;
  if (calls.length === 0) {
    throw new Error('DndContext was never rendered');
  }
  return calls[calls.length - 1][0] as CapturedProps;
}

/* --- fake-event builders (only the fields the handlers read) --------------- */

const startEvent = (
  activeData: Record<string, unknown>,
  id = 1,
): DragStartEvent =>
  ({
    active: { id, data: { current: activeData } },
    activatorEvent: new Event('pointerdown'),
  }) as unknown as DragStartEvent;

const overEvent = (
  overData: Record<string, unknown> | null,
  id = 1,
): DragOverEvent =>
  ({
    active: { id, data: { current: {} } },
    over: overData ? { id: 'droppable', data: { current: overData } } : null,
  }) as unknown as DragOverEvent;

const endEvent = (id = 1): DragEndEvent =>
  ({
    active: { id, data: { current: {} } },
    over: { id: 'droppable', data: { current: {} } },
  }) as unknown as DragEndEvent;

const cancelEvent = (id = 1): DragCancelEvent =>
  ({
    active: { id, data: { current: {} } },
    over: null,
  }) as unknown as DragCancelEvent;

/** Render helper returning a stable `onDragEnd` spy. */
function renderProvider(
  overrides: Partial<DndProviderProps> = {},
): { onDragEnd: jest.Mock } {
  const onDragEnd = (overrides.onDragEnd as jest.Mock) ?? jest.fn();
  render(
    <DndProvider mode={overrides.mode ?? 'kanban'} onDragEnd={onDragEnd} renderOverlay={overrides.renderOverlay}>
      {overrides.children ?? <div data-testid="child">content</div>}
    </DndProvider>,
  );
  return { onDragEnd };
}

afterEach(() => {
  // The provider toggles a global body class in backlog mode; make sure no test
  // leaks it into the next.
  document.body.classList.remove(DND_CLASS.dragActive);
});

describe('DndProvider — mount + prop forwarding', () => {
  it('renders its children inside the DndContext', () => {
    renderProvider();
    expect(screen.getByTestId('child')).toHaveTextContent('content');
    expect(screen.getByTestId('dnd-context')).toBeInTheDocument();
  });

  it('forwards a non-empty sensors descriptor list to DndContext', () => {
    renderProvider();
    const { sensors } = lastProps();
    expect(Array.isArray(sensors)).toBe(true);
    expect((sensors as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('forwards the KANBAN auto-scroll options (by reference) in kanban mode', () => {
    renderProvider({ mode: 'kanban' });
    expect(lastProps().autoScroll).toBe(getAutoScrollOptions('kanban'));
  });

  it('forwards the BACKLOG auto-scroll options (by reference) in backlog mode', () => {
    renderProvider({ mode: 'backlog' });
    expect(lastProps().autoScroll).toBe(getAutoScrollOptions('backlog'));
  });
});

describe('DndProvider — drag mirror overlay (multiple-drag-mirror parity)', () => {
  it('does NOT render an overlay when renderOverlay is omitted', () => {
    renderProvider();
    expect(screen.queryByTestId('drag-overlay')).not.toBeInTheDocument();
  });

  it('renders the overlay with DND_CLASS.mirror and reflects the active id', () => {
    renderProvider({
      renderOverlay: (activeId) => (
        <span data-testid="overlay-body">{activeId === null ? 'none' : `card-${activeId}`}</span>
      ),
    });

    // Before any drag: overlay is present (renderOverlay provided) and reflects
    // the null active id, and carries the mirror class so the existing SCSS
    // applies unchanged.
    const overlay = screen.getByTestId('drag-overlay');
    expect(overlay).toHaveClass(DND_CLASS.mirror); // 'multiple-drag-mirror'
    expect(screen.getByTestId('overlay-body')).toHaveTextContent('none');

    // After drag start the active id (42) is surfaced to renderOverlay.
    act(() => lastProps().onDragStart(startEvent({}, 42)));
    expect(screen.getByTestId('overlay-body')).toHaveTextContent('card-42');
  });
});

describe('DndProvider — backlog drag-active body class (backlog/sortable.coffee:73,103)', () => {
  it('adds drag-active on drag start and removes it on drag end', async () => {
    const { onDragEnd } = renderProvider({ mode: 'backlog' });

    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);

    act(() => lastProps().onDragStart(startEvent({})));
    expect(document.body).toHaveClass(DND_CLASS.dragActive);

    await act(async () => {
      await lastProps().onDragEnd(endEvent());
    });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);
  });

  it('does NOT add drag-active in kanban mode', () => {
    renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({})));
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);
  });

  it('removes drag-active on drag cancel too', () => {
    renderProvider({ mode: 'backlog' });
    act(() => lastProps().onDragStart(startEvent({})));
    expect(document.body).toHaveClass(DND_CLASS.dragActive);
    act(() => lastProps().onDragCancel(cancelEvent()));
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);
  });
});

describe('DndProvider — kanban target-drop hover highlight (kanban/sortable.coffee:65-73)', () => {
  let originEl: HTMLElement;
  let destEl: HTMLElement;

  beforeEach(() => {
    originEl = document.createElement('div');
    destEl = document.createElement('div');
    document.body.append(originEl, destEl);
  });

  afterEach(() => {
    originEl.remove();
    destEl.remove();
  });

  it('adds target-drop to a hovered column DIFFERENT from the origin', () => {
    renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));

    expect(destEl).toHaveClass(DND_CLASS.targetDrop); // 'target-drop'
    expect(originEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('does NOT add target-drop when hovering the ORIGIN column', () => {
    renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));
    act(() => lastProps().onDragOver(overEvent({ columnEl: originEl })));

    expect(originEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('moves the highlight off the previous column when the hover changes', () => {
    renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));

    // Hover dest -> dest highlighted.
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));
    expect(destEl).toHaveClass(DND_CLASS.targetDrop);

    // Hover back to origin -> dest highlight removed, origin stays un-highlighted.
    act(() => lastProps().onDragOver(overEvent({ columnEl: originEl })));
    expect(destEl).not.toHaveClass(DND_CLASS.targetDrop);
    expect(originEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('clears the highlight when the pointer leaves every droppable (over = null)', () => {
    renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));
    expect(destEl).toHaveClass(DND_CLASS.targetDrop);

    act(() => lastProps().onDragOver(overEvent(null)));
    expect(destEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('removes the lingering target-drop highlight on drag end', async () => {
    const { onDragEnd } = renderProvider({ mode: 'kanban' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));
    expect(destEl).toHaveClass(DND_CLASS.targetDrop);

    await act(async () => {
      await lastProps().onDragEnd(endEvent());
    });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(destEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('is a no-op in backlog mode (no target-drop from onDragOver)', () => {
    renderProvider({ mode: 'backlog' });
    act(() => lastProps().onDragStart(startEvent({ columnEl: originEl })));
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));
    expect(destEl).not.toHaveClass(DND_CLASS.targetDrop);
  });

  it('tolerates a drag start with NO active data (origin container resolves to null)', () => {
    renderProvider({ mode: 'kanban' });

    // A draggable registered without drag data: `active.data.current` is
    // `undefined`, exercising the `?? undefined` normalization and the
    // "not an HTMLElement -> null" branch of `readContainerEl`.
    const noDataStart = {
      active: { id: 5, data: { current: undefined } },
      activatorEvent: new Event('pointerdown'),
    } as unknown as DragStartEvent;

    expect(() => act(() => lastProps().onDragStart(noDataStart))).not.toThrow();

    // With a null origin, any hovered column is "different" and gets highlighted.
    act(() => lastProps().onDragOver(overEvent({ columnEl: destEl })));
    expect(destEl).toHaveClass(DND_CLASS.targetDrop);
  });
});

describe('DndProvider — drag end ordering + cancel semantics', () => {
  it('AWAITS onDragEnd BEFORE clearing the drag-state classes', async () => {
    let activeDuringHandler: boolean | null = null;
    const onDragEnd = jest.fn(async () => {
      // At handler time (before cleanup) the backlog drag-active flag must still
      // be present, matching the AngularJS order (dragend fires the move, THEN
      // the drake resets).
      activeDuringHandler = document.body.classList.contains(DND_CLASS.dragActive);
    });

    renderProvider({ mode: 'backlog', onDragEnd });
    act(() => lastProps().onDragStart(startEvent({})));

    await act(async () => {
      await lastProps().onDragEnd(endEvent());
    });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(activeDuringHandler).toBe(true); // still active while handler ran
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive); // cleared after
  });

  it('runs cleanup even when onDragEnd rejects (try/finally)', async () => {
    const onDragEnd = jest.fn(async () => {
      throw new Error('bulk update failed');
    });

    renderProvider({ mode: 'backlog', onDragEnd });
    act(() => lastProps().onDragStart(startEvent({})));
    expect(document.body).toHaveClass(DND_CLASS.dragActive);

    await act(async () => {
      await lastProps().onDragEnd(endEvent()).catch(() => undefined);
    });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // finally-block cleanup ran despite the rejection.
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);
  });

  it('drag cancel cleans up WITHOUT invoking onDragEnd', () => {
    const { onDragEnd } = renderProvider({
      mode: 'backlog',
      renderOverlay: (activeId) => (
        <span data-testid="overlay-body">{activeId === null ? 'none' : `card-${activeId}`}</span>
      ),
    });

    act(() => lastProps().onDragStart(startEvent({}, 7)));
    expect(document.body).toHaveClass(DND_CLASS.dragActive);
    expect(screen.getByTestId('overlay-body')).toHaveTextContent('card-7');

    act(() => lastProps().onDragCancel(cancelEvent(7)));

    expect(onDragEnd).not.toHaveBeenCalled(); // move handler NOT called on cancel
    expect(document.body).not.toHaveClass(DND_CLASS.dragActive);
    expect(screen.getByTestId('overlay-body')).toHaveTextContent('none'); // activeId reset
  });
});
