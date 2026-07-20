/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * DndProvider.tsx — the top-level `@dnd-kit` `<DndContext>` provider for the
 * React Kanban and Backlog screens.
 *
 * WHAT THIS IS
 * ------------
 * The single React primitive of `app/react/shared/dnd`. The `../kanban`
 * `<Board>` and the `../backlog` `<BacklogTable>` wrap their sortable content in
 * this provider. It composes the sibling helpers into one `<DndContext>`:
 *   - `./sensors`     — `useDndSensors()` (pointer sensor, 5px activation).
 *   - `./autoScroll`  — `getAutoScrollOptions(mode)` (kanban vs. backlog tuning).
 *   - `./sortable`    — the DOM class-side-effect helpers reused below.
 *   - `./types`       — `DndMode`, `UsId`, and the `DND_CLASS` visual-parity map.
 *
 * WHAT IT REPRODUCES (behavioral parity — AAP §0.7)
 * -------------------------------------------------
 * This provider recreates the drag LIFECYCLE side-effects of the two legacy
 * `dragula` drakes, so the EXISTING compiled SCSS renders the React drag states
 * byte-identically (zero visual change is the goal):
 *   - Kanban  `over`/`out` (kanban/sortable.coffee:65-73): toggle the
 *     `target-drop` highlight on a hovered column that DIFFERS from the drag
 *     origin.
 *   - Backlog `drag`/`dragend` (backlog/sortable.coffee:66-143): add the
 *     `drag-active` body class on drag start; on drag end remove it and clear the
 *     `.doom-line` decoration nodes.
 *   - Auto-scroll (kanban/sortable.coffee:155-160; backlog/sortable.coffee:145-151):
 *     forwarded via the `autoScroll` prop of `<DndContext>`.
 *   - Multi-drag mirror (dragula `cloned` → `multiple-drag-mirror`;
 *     kanban/sortable.coffee:89-90, backlog/sortable.coffee:90-91): reproduced
 *     with a `<DragOverlay className={DND_CLASS.mirror}>`.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It performs NO API calls and holds NO board state. The `onDragEnd` handler is
 * INJECTED by the caller (built by `createKanbanDragEndHandler` /
 * `createBacklogDragEndHandler` in `./sortable`); that handler owns the frozen
 * `/api/v1/` bulk-ordering call and the optimistic immer state update. This is
 * the seam that keeps `../kanban` / `../backlog` purely presentational: all the
 * VISUAL, SCSS-driving drag classes live here, while the contract-bound API +
 * state stay in the injected handler.
 *
 * COEXISTENCE BOUNDARY (AAP §0.7 — HARD)
 * --------------------------------------
 * Imports ONLY its own npm dependencies (`react`, `@dnd-kit/core`) and the
 * sibling `./sensors`, `./autoScroll`, `./sortable`, `./types`. It imports
 * NOTHING from the repository's legacy CoffeeScript sources, the modern
 * Angular-Elements bundle, the Jade partials, or the SCSS styles, and never
 * references `angular`, `dragula`, `dom-autoscroller`, `immutable`, or `jquery`.
 * In particular it does NOT import `../api` — the API call lives in the injected
 * `onDragEnd`.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DragCancelEvent,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';

import { useDndSensors } from './sensors';
import { getAutoScrollOptions } from './autoScroll';
import { addTargetDrop, removeTargetDrop, setDragActive, removeDoomLines } from './sortable';
import { DND_CLASS, type DndMode, type UsId } from './types';

/* ------------------------------------------------------------------------- *
 * Internal glue — safe reads from the untyped `data.current` bag
 * ------------------------------------------------------------------------- */

/**
 * Read the container element a droppable / draggable exposes on its
 * `data.current` under the `columnEl` key, or `null` when it is absent or not an
 * `HTMLElement`.
 *
 * `../kanban` attaches the SAME column element to BOTH the column droppable's
 * data (read here for the hovered container) AND each card's drag data (read
 * here for the drag-origin container), so the two can be compared by reference
 * to reproduce dragula's "container != initialContainer" guard
 * (kanban/sortable.coffee:67-73). Mirrors the `readElement(data, 'columnEl')`
 * pattern used by the drag-end handlers in `./sortable`.
 */
function readContainerEl(data: Record<string, unknown> | undefined): HTMLElement | null {
  const el = data?.['columnEl'];
  return el instanceof HTMLElement ? el : null;
}

/**
 * Collision detection for the BACKLOG screen.
 *
 * WHY NOT the `@dnd-kit` default (`rectIntersection`): the backlog reorder-to-top
 * gesture is a LONG drag driven by the window auto-scroller
 * (`getAutoScrollOptions('backlog')` + the test harness holding the pointer at
 * the viewport top until `scrollY === 0`). `rectIntersection` resolves `over`
 * from the ACTIVE draggable's translated bounding rect, which after a long
 * scroll-assisted travel across a tall page can intersect a STALE-measured
 * droppable in the right-hand sprint panel MORE than the intended backlog row —
 * so a pure backlog REORDER would resolve `over` to a sprint row and (because
 * each row now carries its container identity, see UserStoryRow/MilestoneRow)
 * wrongly route the stories INTO that sprint.
 *
 * The legacy `dragula` drakes resolved the drop container from the element
 * UNDER THE POINTER (`document.elementFromPoint`, via `isContainer` —
 * backlog/sortable.coffee:42), NOT from rect overlap. `pointerWithin` is the
 * faithful `@dnd-kit` analog: it returns only droppables whose rect contains the
 * pointer, so a drop resolves to whatever the pointer is actually over (the
 * backlog row for a reorder, the sprint table/row for a cross-panel move). We
 * fall back to `rectIntersection` for the rare frame where the pointer sits in a
 * 1px gap between droppables so `over` is never spuriously lost.
 */
const backlogCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
};

/* ------------------------------------------------------------------------- *
 * Public component API
 * ------------------------------------------------------------------------- */

export interface DndProviderProps {
  /**
   * Selects screen-specific behavior:
   *   - `'kanban'`  → `.taskboard-column` `target-drop` hover highlighting +
   *     the kanban auto-scroll tuning (orig `margin: 100`).
   *   - `'backlog'` → the `drag-active` body class while dragging + the backlog
   *     (window) auto-scroll tuning (orig `margin: 20`, `pixels: 30`).
   */
  mode: DndMode;
  /**
   * Built by `createKanbanDragEndHandler(deps)` / `createBacklogDragEndHandler(deps)`
   * in `./sortable`. Owns the `../api` bulk-ordering call + the optimistic
   * `onMove` state update. May be async; this provider AWAITS it before running
   * the drag-class cleanup so the handler can still read the drop DOM.
   */
  onDragEnd: (event: DragEndEvent) => void | Promise<void>;
  /**
   * Optional render callback for the drag mirror (multi-drag visual parity). When
   * provided, its output is rendered inside a `<DragOverlay>` that carries
   * `DND_CLASS.mirror` (`'multiple-drag-mirror'`) so the existing mirror SCSS
   * applies unchanged. Receives the id of the item currently being dragged, or
   * `null` when nothing is dragging.
   */
  renderOverlay?: (activeId: UsId | null) => React.ReactNode;
  /** The sortable content (columns/cards or the backlog table/rows). */
  children: React.ReactNode;
}

/**
 * Accessibility bundle passed to `<DndContext accessibility={...}>` for
 * screen-reader parity (KB-8).
 *
 * `@dnd-kit` ships a DEFAULT `screenReaderInstructions.draggable` that every
 * draggable advertises through its `aria-describedby`
 * ("To pick up a draggable item, press the space bar. While dragging, use the
 * arrow keys to move the item…"), plus DEFAULT `announcements` phrased around
 * that same keyboard-move model. This board wires ONLY a pointer sensor
 * (see `./sensors` — `useDndSensors()` returns a single `PointerSensor`); there
 * is NO `KeyboardSensor`, so keyboard drag-and-drop is deliberately NOT
 * implemented. That matches the legacy `dragula` drakes, which offered no
 * keyboard DnD and emitted no screen-reader text at all.
 *
 * Advertising an unimplemented keyboard affordance misleads assistive-technology
 * users (a user is told to press Space/arrows, but nothing happens). We therefore
 * override the accessibility content with empty / parity-accurate values:
 *   - `screenReaderInstructions.draggable: ''` — each card's `aria-describedby`
 *     no longer promises keyboard dragging.
 *   - `announcements.*` all return `undefined` — no live-region messages, exactly
 *     as the silent `dragula` implementation behaved.
 *
 * This changes NO visible DOM and NO drag behavior — it only removes misleading
 * screen-reader text, restoring behavioral parity with the AngularJS screen.
 */
const DND_ACCESSIBILITY: {
  screenReaderInstructions: ScreenReaderInstructions;
  announcements: Announcements;
} = {
  screenReaderInstructions: { draggable: '' },
  announcements: {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  },
};

/**
 * `<DndContext>` wrapper that drives sensors, auto-scroll, the drag-lifecycle
 * class side-effects, and an optional drag mirror overlay. See the file header
 * for the full behavioral-parity contract.
 */
export const DndProvider: React.FC<DndProviderProps> = ({
  mode,
  onDragEnd,
  renderOverlay,
  children,
}) => {
  // Pointer sensor(s). `useDndSensors` returns a stable descriptor list (its
  // sensor class is module-stable), so the pointer listeners install once.
  const sensors = useDndSensors();

  // Auto-scroll options for the active screen. `getAutoScrollOptions` returns a
  // module-level constant by reference; `useMemo` keyed on `mode` keeps the
  // identity stable across re-renders so `<DndContext>` does not churn its
  // auto-scroll setup when nothing relevant changed.
  const autoScroll = useMemo(() => getAutoScrollOptions(mode), [mode]);

  // Collision detection. Kanban keeps the `@dnd-kit` default (`rectIntersection`)
  // — its short, side-by-side column drags resolve correctly and the whole
  // kanban suite passes on it. The backlog uses a pointer-first strategy (see
  // `backlogCollisionDetection`) so its long, auto-scroll-assisted reorders
  // resolve `over` from the pointer position — faithful to the legacy dragula
  // `elementFromPoint` container test — rather than from a translated rect that
  // can spuriously intersect the right-hand sprint panel.
  const collisionDetection = useMemo<CollisionDetection | undefined>(
    () => (mode === 'backlog' ? backlogCollisionDetection : undefined),
    [mode],
  );

  // The id of the item currently being dragged, surfaced to `renderOverlay`.
  const [activeId, setActiveId] = useState<UsId | null>(null);

  // The container currently showing the `target-drop` highlight (kanban only),
  // and the container the active item started in. Both are compared by reference
  // to reproduce dragula's "different container" guard. Refs (not state) because
  // they change mid-gesture and must not trigger re-renders.
  const hoveredRef = useRef<HTMLElement | null>(null);
  const originContainerRef = useRef<HTMLElement | null>(null);

  /**
   * Remove EVERY drag-state class this provider may have applied and reset the
   * per-drag refs/state. Idempotent (each removal is a no-op when the class /
   * node is absent), so it is safe to call on both drag end and drag cancel and
   * safe to run even after the injected backlog handler already cleared its own
   * classes.
   *
   * Reproduces the backlog `dragend` cleanup (`.doom-line` removal —
   * backlog/sortable.coffee:95; `drag-active` removal — backlog/sortable.coffee:103)
   * plus the kanban `target-drop` teardown implied by the `out` handler
   * (kanban/sortable.coffee:71-73).
   */
  const clearAllDragState = useCallback((): void => {
    // Kanban: drop the lingering `target-drop` highlight from the last hovered
    // (different) column.
    if (hoveredRef.current) {
      removeTargetDrop(hoveredRef.current);
      hoveredRef.current = null;
    }
    // Backlog: remove the body `drag-active` flag (a no-op in kanban mode, where
    // it was never added) and the `.doom-line` decoration nodes.
    setDragActive(false);
    removeDoomLines();
    // Reset per-drag tracking.
    setActiveId(null);
    originContainerRef.current = null;
  }, []);

  /**
   * Drag start. Records the active id (for the overlay) and captures the
   * drag-origin container from the active item's `data.current` so `handleDragOver`
   * can enforce the "different container" highlight rule. In `'backlog'` mode it
   * also adds the `drag-active` body class — reproducing
   * `$(document.body).addClass('drag-active')` on the backlog `drag` event
   * (backlog/sortable.coffee:73).
   */
  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const { active } = event;
      setActiveId(Number(active.id));

      // Origin container of the dragged item (the column it started in). Used by
      // `handleDragOver` to skip highlighting the origin, mirroring the coffee
      // guard where `initialContainer` is the source container.
      originContainerRef.current = readContainerEl(active.data.current ?? undefined);

      if (mode === 'backlog') {
        setDragActive(true);
      }
    },
    [mode],
  );

  /**
   * Drag over (kanban parity only). Reproduces the dragula `over`/`out` handlers
   * (kanban/sortable.coffee:65-73): highlight a hovered column with `target-drop`
   * ONLY when it differs from the drag-origin column, and remove the highlight
   * from the previously hovered column when the pointer moves on (or leaves every
   * droppable). The backlog screen has no equivalent hover highlight, so it exits
   * early.
   */
  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      // Backlog has no `target-drop` hover behavior — nothing to do here.
      if (mode !== 'kanban') {
        return;
      }

      const { over } = event;
      // The hovered column element, or `null` when the pointer is over no
      // droppable that exposes a `columnEl`.
      const newEl = readContainerEl(over?.data.current ?? undefined);

      // Only act when the hovered container actually changed.
      if (newEl !== hoveredRef.current) {
        // `out`: drop the highlight from the container we just left.
        if (hoveredRef.current) {
          removeTargetDrop(hoveredRef.current);
        }
        hoveredRef.current = newEl;
        // `over`: highlight the new container ONLY when it differs from the drag
        // origin (reproduces `else if container != initialContainer`).
        if (newEl && newEl !== originContainerRef.current) {
          addTargetDrop(newEl);
        }
      }
    },
    [mode],
  );

  /**
   * Drag end. AWAITS the injected `onDragEnd` (which owns the frozen `/api/v1/`
   * call + the optimistic state update) BEFORE running the class cleanup — the
   * AngularJS ordering, where `dragend` computes the move from the settled drop
   * DOM and only then the drake resets. The cleanup runs in `finally` so the
   * drag-state classes are always cleared even if the handler throws.
   */
  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      try {
        await onDragEnd(event);
      } finally {
        clearAllDragState();
      }
    },
    [onDragEnd, clearAllDragState],
  );

  /**
   * Drag cancel (drop rejected / gesture aborted). Runs the class cleanup ONLY —
   * the move handler is deliberately NOT invoked, so no API call or state update
   * happens for a cancelled drag (mirroring dragula snapping the item back with
   * no `moveUs`).
   */
  const handleDragCancel = useCallback(
    (_event: DragCancelEvent): void => {
      clearAllDragState();
    },
    [clearAllDragState],
  );

  // NOTE (boundary): this provider deliberately does NOT create a
  // `SortableContext`. The per-column / per-sprint sortable item-id arrays differ
  // and are owned by `../kanban` / `../backlog`, which each render their own
  // `<SortableContext>` around their item lists inside `children`. This provider
  // supplies only the `DndContext`, sensors, auto-scroll, the lifecycle class
  // side-effects, and the optional drag mirror overlay.
  return (
    <DndContext
      sensors={sensors}
      autoScroll={autoScroll}
      collisionDetection={collisionDetection}
      accessibility={DND_ACCESSIBILITY}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      {renderOverlay ? (
        <DragOverlay className={DND_CLASS.mirror}>{renderOverlay(activeId)}</DragOverlay>
      ) : null}
    </DndContext>
  );
};

export default DndProvider;
