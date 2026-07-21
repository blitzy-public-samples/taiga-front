/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Migrated from app/coffee/modules/kanban/sortable.coffee (dragula +
// dom-autoscroller) to @dnd-kit/core. Behavioural port target only — the
// CoffeeScript directive is NEVER imported.

/**
 * KanbanDndContext — the React 18 + TypeScript drag-and-drop layer for the
 * migrated Kanban board (`app/react/kanban/**`).
 *
 * WHAT THIS IS
 *   The single file of the Kanban `dnd/` layer. It renders the `@dnd-kit/core`
 *   `DndContext` that wraps the `.kanban-table` board region rendered by
 *   `../KanbanApp.tsx`, and it maps every drag-end into a source-faithful
 *   "move user story" payload that the container forwards to the state layer
 *   through the `onMoveUs` callback. THIS FILE PERFORMS NO API CALL and does NO
 *   swimlane id mapping — `../KanbanApp.tsx` (via `useKanbanBoard.move`) owns the
 *   `-1 -> null` swimlane mapping, the reducer dispatch, and the
 *   `bulkUpdateKanbanOrder` `/api/v1/` traffic.
 *
 * FIDELITY (zero behaviour change — AAP §0.1.1, §0.7.1)
 *   Reproduces the AngularJS `kanban/sortable.coffee` (`tgKanbanSortable`)
 *   semantics EXACTLY:
 *     - the `modify_us` + `archived_code` permission gate — sortable.coffee:37,40
 *       (encapsulated by `isBoardDraggable`);
 *     - the over/out `target-drop` highlight on a container DIFFERENT from the
 *       source — sortable.coffee:65-73;
 *     - the drag-start `oldIndex` taken from the FIRST dragged card among the
 *       source container's cards, with the card still in place — sortable:75-87;
 *     - the drop-time `previousCard` / `nextCard` neighbour computation, where
 *       `nextCard` is set ONLY when there is no `previousCard` — sortable:95-107;
 *     - the drag-end payload `(finalUsList, newStatus, newSwimlane, index,
 *       previousCard, nextCard)` broadcast as `kanban:us:move` — sortable:109-153
 *       / main.coffee:596-632;
 *     - the same-container no-op guard `index === oldIndex` — sortable.coffee:124;
 *     - multi-card drag engagement (grabbed card selected AND >1 selected),
 *       ordered by board/DOM order — `window.dragMultiple` / dragula-drag-multiple.js.
 *   `@dnd-kit`'s built-in auto-scroll replaces `dom-autoscroller`
 *   (sortable.coffee:155-160). The ONLY net-new behaviour is keyboard-accessible
 *   dragging + ARIA live announcements (`KeyboardSensor`), confined to React
 *   (AAP §0.6.5).
 *
 * CROSS-FOLDER INTEGRATION (Phase F — for the downstream implementer)
 *   - `../components/TaskboardColumn.tsx` wraps its column root in
 *       `<DroppableColumn statusId={..} swimlaneId={..}>` — applying the
 *       `target-drop` class when `isTarget`, and attaching `setNodeRef` to the
 *       root `<div>` that carries `data-status` / `data-swimlane` — and wraps
 *       EACH card in `<DraggableCard id={usId} statusId={..} swimlaneId={..}>`,
 *       rendering `<Card ref={setNodeRef} {...attributes} {...listeners} … />`
 *       so the drag `ref` + listeners + attributes reach `Card` via its
 *       `{...rest}` spread. `TaskboardColumn` imports the WRAPPERS
 *       (`DraggableCard` / `DroppableColumn`) from `../dnd/KanbanDndContext`,
 *       NEVER `@dnd-kit/core` directly, so `Card` stays fully `@dnd-kit`-free.
 *   - `../KanbanApp.tsx` renders
 *       `<KanbanDndContext project usMap selectedUss zoom zoomLevel onMoveUs>
 *          {board}
 *        </KanbanDndContext>`
 *       and its `onMoveUs` performs the `-1 -> null` swimlane mapping + the
 *       reducer `move` + the `bulkUpdateKanbanOrder` API call.
 *
 * SHAPE
 *   A single file co-exporting the `KanbanDndContext` provider, the two
 *   render-prop wrapper primitives (`DraggableCard` / `DroppableColumn`) that
 *   supply the `@dnd-kit` wiring to the intentionally `@dnd-kit`-free
 *   `Card` / `TaskboardColumn` siblings, AND the pure, browser-free helpers
 *   (`resolveDraggedIds`, `computeDropIndex`, `computeNeighbors`,
 *   `buildFinalUsList`, `computeMovePayload`) so `../__tests__` can unit-test the
 *   payload mapping headlessly by importing them directly.
 *
 * Compiled under `jsx: "react-jsx"` (automatic runtime), so there is
 * deliberately NO `import React`. All type-only imports use `import type`
 * because the project is compiled with `strict` + `isolatedModules`.
 */

import { useState, useRef, useCallback, createContext, useContext } from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  CollisionDetection,
} from '@dnd-kit/core';

import { isBoardDraggable } from '../../shared/permissions';
import type { Project, UsMap, BoardCard } from '../../shared/types';
import { Card } from '../components/Card';

/* ========================================================================== *
 * Phase B — Exported PURE helper functions (browser-free: no DOM, no React, no
 * @dnd-kit). These are the deterministic heart of the drag-and-drop fidelity
 * contract and are imported + asserted directly by `../__tests__`.
 * ========================================================================== */

/**
 * The per-card descriptor carried in the `finalUsList` argument of the
 * `kanban:us:move` broadcast (`sortable.coffee:136-141`): the story id plus the
 * card's ORIGINAL status / swimlane (read raw from `card.model`). `oldSwimlaneId`
 * may be `null` (the story is not in any swimlane) and is NOT coerced to `-1`
 * here — the downstream handler owns any id normalisation.
 */
export interface FinalUsListItem {
  id: number;
  oldStatusId: number;
  oldSwimlaneId: number | null;
}

/**
 * Resolve the set of user-story ids that participate in a drag.
 *
 * Reproduces the `window.dragMultiple` engagement rule (verified against
 * `app/js/dragula-drag-multiple.js` `isMultiple` / `stop`): multi-drag engages
 * IFF the grabbed card is itself selected AND more than one card is selected.
 * When it engages, the selected set is returned in board/DOM order (the dragula
 * `getElements()` order) by filtering `orderedIds` down to the selected set;
 * when `orderedIds` is omitted the raw selected set is returned. The grabbed
 * `activeId` is always guaranteed to be present. Otherwise a single-card drag is
 * returned (`[activeId]`).
 *
 * @param activeId    The grabbed card's user-story id.
 * @param selectedUss Board multi-select map (`usId -> true`).
 * @param orderedIds  Optional board/DOM order used to sort a multi-drag set.
 */
export function resolveDraggedIds(
  activeId: number,
  selectedUss: Record<number, boolean>,
  orderedIds?: number[],
): number[] {
  const selectedIds = Object.keys(selectedUss)
    .map(Number)
    .filter((id) => selectedUss[id] === true);

  if (selectedUss[activeId] === true && selectedIds.length > 1) {
    const selectedSet = new Set(selectedIds);
    // Order the multi-drag set by the provided board/DOM order when available.
    const ordered = orderedIds
      ? orderedIds.filter((id) => selectedSet.has(id))
      : selectedIds;
    // Guarantee the grabbed card is included even if it was missing from
    // `orderedIds` (defensive; the grabbed card is always selected here).
    return ordered.includes(activeId) ? ordered : [...ordered, activeId];
  }

  return [activeId];
}

/**
 * Compute the insertion index of the dragged block within the destination
 * column's ordered ids, `destExcl` (the destination card ids EXCLUDING every
 * dragged id).
 *
 *   - `overCardId == null` (dropped on the empty column body / below all cards)
 *     -> append at `destExcl.length`;
 *   - the over-card is not found in `destExcl` -> append at `destExcl.length`;
 *   - otherwise the over-card's position, `+1` when dropping AFTER it.
 *
 * @param destExcl    Destination ordered ids, dragged ids already removed.
 * @param overCardId  The non-dragged card the pointer is over, or `null`.
 * @param insertAfter Whether the drop lands after the over-card (below its mid).
 */
export function computeDropIndex(
  destExcl: number[],
  overCardId: number | null,
  insertAfter: boolean,
): number {
  if (overCardId == null) {
    return destExcl.length;
  }
  const pos = destExcl.indexOf(overCardId);
  if (pos === -1) {
    return destExcl.length;
  }
  return insertAfter ? pos + 1 : pos;
}

/**
 * Compute the `previousCard` / `nextCard` neighbour ids for an insertion at
 * `index` within `destExcl` (mirrors `sortable.coffee:95-107`).
 *
 * Inserting the dragged block at position `index` places the previous sibling at
 * `destExcl[index - 1]` and — ONLY when there is no previous sibling
 * (`index === 0`) — the next sibling at `destExcl[index]`. This reproduces the
 * source's `if (!previousCard && next.length …)` exactly, which matches the API
 * priority in `bulkUpdateKanbanOrder` (`afterUserstoryId` wins; `beforeUserstoryId`
 * is used only when there is no after).
 *
 * @param destExcl Destination ordered ids, dragged ids already removed.
 * @param index    The insertion index within `destExcl`.
 */
export function computeNeighbors(
  destExcl: number[],
  index: number,
): { previousCard: number | null; nextCard: number | null } {
  let previousCard: number | null = null;
  let nextCard: number | null = null;

  if (index - 1 >= 0 && destExcl[index - 1] != null) {
    previousCard = destExcl[index - 1];
  }
  // nextCard is set ONLY when there is no previousCard (source: L106).
  if (previousCard == null && destExcl[index] != null) {
    nextCard = destExcl[index];
  }

  return { previousCard, nextCard };
}

/**
 * Build the `finalUsList` payload from the dragged ids and the board `usMap`
 * (mirrors `sortable.coffee:136-141`). Each id resolves to its `BoardCard`;
 * missing ids are dropped; the remaining cards map to
 * `{ id, oldStatusId: model.status, oldSwimlaneId: model.swimlane }`. The RAW
 * `card.model.swimlane` (which may be `null`) is preserved — it is NOT coerced
 * to `-1` here.
 *
 * @param draggedIds The dragged user-story ids, in drag order.
 * @param usMap      The board's `usId -> BoardCard` lookup.
 */
export function buildFinalUsList(
  draggedIds: number[],
  usMap: UsMap,
): FinalUsListItem[] {
  return draggedIds
    .map((id) => usMap[id])
    .filter((card): card is BoardCard => Boolean(card))
    .map((card) => ({
      id: card.id,
      oldStatusId: card.model.status,
      oldSwimlaneId: card.model.swimlane,
    }));
}

/**
 * The fully-resolved argument bundle for the `kanban:us:move` broadcast, in the
 * FROZEN order the AngularJS `moveUs(ctx, usList, newStatusId, newSwimlaneId,
 * index, previousCard, nextCard)` consumes (`main.coffee:596`).
 */
export interface MoveUsPayload {
  finalUsList: FinalUsListItem[];
  newStatus: number;
  // F-AAP-09: `number | null`. A real swimlane id (INCLUDING the synthetic `-1`
  // "Unclassified" lane) or `null` when the board has no swimlanes. The onDragEnd
  // boundary normalizes a missing `data-swimlane` (which `Number()` would make
  // NaN) to `null`, so NaN can never reach the reducer state or the API body.
  newSwimlane: number | null;
  index: number;
  previousCard: number | null;
  nextCard: number | null;
}

/**
 * The pure drop mapper: compute the full `MoveUsPayload`, or `null` for a no-op.
 *
 * The no-op guard (`sortable.coffee:124`) returns `null` when the block is
 * dropped back into the SAME container at the SAME position
 * (`sameContainer && index === oldIndex`), so no callback fires.
 *
 * `newSwimlane` is `number | null` (F-AAP-09): the onDragEnd boundary normalizes
 * a missing `data-swimlane` to `null` BEFORE calling this mapper, so a real
 * swimlane id (INCLUDING `-1` for the synthetic "Unclassified" swimlane) or
 * `null` reaches here — never NaN. This mapper echoes the value unchanged.
 *
 * @param input.draggedIds   Dragged user-story ids, in drag order.
 * @param input.destExcl     Destination ordered ids, dragged ids removed.
 * @param input.overCardId   Non-dragged over-card id, or `null` to append.
 * @param input.insertAfter  Drop lands after the over-card.
 * @param input.newStatus    Destination status id (raw `data-status`).
 * @param input.newSwimlane  Destination swimlane id: a real id, `-1`, or `null`
 *                           (already normalized at the boundary; never NaN).
 * @param input.oldIndex     Source index of the first dragged card (with the
 *                           card still in place).
 * @param input.sameContainer Whether source and destination columns match.
 * @param input.usMap        The board's `usId -> BoardCard` lookup.
 */
export function computeMovePayload(input: {
  draggedIds: number[];
  destExcl: number[];
  overCardId: number | null;
  insertAfter: boolean;
  newStatus: number;
  newSwimlane: number | null;
  oldIndex: number;
  sameContainer: boolean;
  usMap: UsMap;
}): MoveUsPayload | null {
  const index = computeDropIndex(input.destExcl, input.overCardId, input.insertAfter);

  // No-op: dropped in the same container at the same position (source L124).
  if (input.sameContainer && index === input.oldIndex) {
    return null;
  }

  const { previousCard, nextCard } = computeNeighbors(input.destExcl, index);
  const finalUsList = buildFinalUsList(input.draggedIds, input.usMap);

  return {
    finalUsList,
    newStatus: input.newStatus,
    newSwimlane: input.newSwimlane,
    index,
    previousCard,
    nextCard,
  };
}

/* ========================================================================== *
 * Phase C — Internal drag context + the two render-prop wrapper primitives.
 *
 * `Card` and `TaskboardColumn` are intentionally `@dnd-kit`-free. These wrappers
 * supply the `@dnd-kit` wiring via render props, and read the current
 * draggable / source-column / over-column state from a module-private context so
 * they can derive `disabled` (read-only board) and the `target-drop` highlight.
 * ========================================================================== */

/**
 * Module-private context describing the live drag state to the wrapper
 * primitives. `draggable` mirrors `isBoardDraggable(project)` (the permission /
 * archived gate); `sourceColumnKey` / `overColumnKey` drive the `target-drop`
 * highlight. `isDragging` and `onRequestUnfoldSwimlane` support the OPTIONAL
 * swimlane auto-unfold (Phase E) and are ignored by the core wrappers.
 */
interface KanbanDndInternal {
  /** `isBoardDraggable(project)` — false makes every wrapper register inert. */
  draggable: boolean;
  /** Column key of the drag source; set on drag start, cleared on end. */
  sourceColumnKey: string | null;
  /** Column key currently hovered; drives the non-source `target-drop` class. */
  overColumnKey: string | null;
  /** True while a drag is in flight (Phase E gate; `gu-mirror` presence proxy). */
  isDragging: boolean;
  /** Optional Phase E callback used by `useSwimlaneAutoUnfold`. */
  onRequestUnfoldSwimlane?: (swimlaneId: number) => void;
}

const KanbanDndInternalContext = createContext<KanbanDndInternal>({
  draggable: false,
  sourceColumnKey: null,
  overColumnKey: null,
  isDragging: false,
});

/**
 * Deterministic key identifying a board column. In no-swimlane mode `swimlaneId`
 * is `undefined` -> `'ns'`; in swimlane mode it is the swimlane id (including the
 * synthetic `-1` "Unclassified" swimlane). Used as the droppable id for columns
 * and to compare source vs destination containers.
 */
function columnKey(statusId: number, swimlaneId: number | null | undefined): string {
  return `${swimlaneId ?? 'ns'}:${statusId}`;
}

/* -------------------------------------------------------------------------- *
 * Phase D.5 — Thin DOM read layer (no jQuery, no document-wide scans). Invoked
 * only inside the drag handlers, via the `getNode()` closures stashed in each
 * draggable / droppable `data`.
 * -------------------------------------------------------------------------- */

/**
 * Read the ordered user-story ids from a column DOM node by scanning its `.card`
 * descendants and reading each card's `data-id` (mirrors the source's
 * `$(parentEl).find('tg-card')`). Non-numeric ids are dropped defensively.
 */
function readOrderedCardIds(columnNode: HTMLElement): number[] {
  return Array.from(columnNode.querySelectorAll('.card'))
    .map((el) => Number((el as HTMLElement).dataset.id))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Resolve the nearest column root (`.kanban-uses-box.taskboard-column`) for a
 * given node: the node itself when it matches, else its closest matching
 * ancestor, else `null`.
 */
function resolveColumnNode(node: HTMLElement | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  if (node.matches('.kanban-uses-box.taskboard-column')) {
    return node;
  }
  return node.closest('.kanban-uses-box.taskboard-column') as HTMLElement | null;
}

/**
 * Props for {@link DraggableCard}. `children` is a render prop that receives the
 * `@dnd-kit` wiring so the consumer can spread it onto the `@dnd-kit`-free
 * `Card` (`<Card ref={setNodeRef} {...attributes} {...listeners} … />`).
 */
export interface DraggableCardProps {
  /** The card's user-story id (the draggable id). */
  id: number;
  /** Explicit disable; defaults to `!draggable` from the internal context. */
  disabled?: boolean;
  /** Owning status id — feeds the card's `columnKey`. */
  statusId: number;
  /** Owning swimlane id (swimlane mode) — feeds the card's `columnKey`. */
  swimlaneId?: number | null;
  /** Render prop supplied with the drag ref, listeners, attributes and state. */
  children: (drag: {
    setNodeRef: (el: HTMLElement | null) => void;
    listeners: Record<string, unknown> | undefined;
    attributes: Record<string, unknown>;
    isDragging: boolean;
  }) => ReactElement;
}

/**
 * `DraggableCard` — makes a Kanban card BOTH draggable and droppable.
 *
 * The card is droppable (id `card:<id>`) as well as draggable so the board can
 * detect precisely WHICH card the pointer is over for exact index / neighbour
 * computation — the source relied on the physical DOM position of the card. The
 * draggable id is the raw numeric `id` so `Number(event.active.id)` yields the
 * user-story id. A merged callback ref feeds the single `.card` root to both
 * `@dnd-kit` hooks and to a local `nodeRef` used by the DOM read layer.
 */
export function DraggableCard(props: DraggableCardProps): ReactElement {
  const { draggable } = useContext(KanbanDndInternalContext);
  const disabled = props.disabled ?? !draggable;

  const nodeRef = useRef<HTMLElement | null>(null);
  const key = columnKey(props.statusId, props.swimlaneId);

  const drag = useDraggable({
    id: props.id,
    disabled,
    data: {
      type: 'card',
      usId: props.id,
      columnKey: key,
      getNode: () => nodeRef.current,
    },
  });

  const drop = useDroppable({
    id: `card:${props.id}`,
    disabled,
    data: {
      type: 'card',
      usId: props.id,
      columnKey: key,
      getNode: () => nodeRef.current,
    },
  });

  const dragSetNodeRef = drag.setNodeRef;
  const dropSetNodeRef = drop.setNodeRef;

  // Merged callback ref: keep the local node reference AND feed both hooks.
  const setNodeRef = useCallback(
    (el: HTMLElement | null) => {
      nodeRef.current = el;
      dragSetNodeRef(el);
      dropSetNodeRef(el);
    },
    [dragSetNodeRef, dropSetNodeRef],
  );

  return props.children({
    setNodeRef,
    // SyntheticListenerMap (Record<string, Function>) assigns directly.
    listeners: drag.listeners,
    // DraggableAttributes is an interface (no index signature); spread into a
    // fresh object literal so it satisfies Record<string, unknown> under strict.
    attributes: { ...drag.attributes },
    isDragging: drag.isDragging,
  });
}

/**
 * Props for {@link DroppableColumn}. `children` is a render prop that receives
 * the droppable ref and the `isOver` / `isTarget` flags.
 */
export interface DroppableColumnProps {
  /** Column status id — half of the column key. */
  statusId: number;
  /** Column swimlane id (swimlane mode) — half of the column key. */
  swimlaneId?: number | null;
  /** Explicit disable; defaults to `!draggable` from the internal context. */
  disabled?: boolean;
  /** Render prop supplied with the droppable ref and the over/target flags. */
  children: (drop: {
    setNodeRef: (el: HTMLElement | null) => void;
    isOver: boolean;
    isTarget: boolean;
  }) => ReactElement;
}

/**
 * `DroppableColumn` — registers a column body as a droppable (id = its
 * `columnKey`). `isTarget` reproduces the source over/out highlight
 * (`sortable.coffee:65-73`): the `target-drop` class appears ONLY on a container
 * DIFFERENT from the drag source, i.e. `isOver && key !== sourceColumnKey`.
 */
export function DroppableColumn(props: DroppableColumnProps): ReactElement {
  const { draggable, sourceColumnKey } = useContext(KanbanDndInternalContext);
  const disabled = props.disabled ?? !draggable;
  const key = columnKey(props.statusId, props.swimlaneId);

  const nodeRef = useRef<HTMLElement | null>(null);

  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: key,
    disabled,
    data: {
      type: 'column',
      statusId: props.statusId,
      swimlaneId: props.swimlaneId ?? null,
      getNode: () => nodeRef.current,
    },
  });

  const setNodeRef = useCallback(
    (el: HTMLElement | null) => {
      nodeRef.current = el;
      dropRef(el);
    },
    [dropRef],
  );

  // target-drop appears ONLY on a container different from the drag source.
  const isTarget = isOver && key !== sourceColumnKey;

  return props.children({ setNodeRef, isOver, isTarget });
}

/* ========================================================================== *
 * Phase D — The KanbanDndContext provider (DndContext, sensors, autoscroll,
 * drag lifecycle, drop payload dispatch and the DragOverlay).
 * ========================================================================== */

/**
 * Props for {@link KanbanDndContext}.
 *
 * `onMoveUs` argument order is FROZEN and MUST match the AngularJS
 * `main.coffee` `kanban:us:move` broadcast / `moveUs(ctx, usList, newStatusId,
 * newSwimlaneId, index, previousCard, nextCard)` (`main.coffee:596`).
 */
export interface KanbanDndContextProps {
  /** The board's project — drives the `isBoardDraggable` permission gate. */
  project: Project;
  /** The board's `usId -> BoardCard` lookup — read to build `finalUsList`. */
  usMap: UsMap;
  /** Board multi-select map (`usId -> true`) — drives multi-card drag. */
  selectedUss: Record<number, boolean>;
  /** Enabled card sections (forwarded to the overlay `Card`). */
  zoom: string[];
  /** Numeric board zoom level (forwarded to the overlay `Card`). */
  zoomLevel: number;
  /**
   * Drop callback — FROZEN argument order (see interface docs). `newSwimlane` is
   * `number | null` (F-AAP-09): a real swimlane id, the synthetic `-1`
   * "Unclassified" lane, or `null` on a swimlane-less board — never NaN.
   */
  onMoveUs: (
    finalUsList: FinalUsListItem[],
    newStatus: number,
    newSwimlane: number | null,
    index: number,
    previousCard: number | null,
    nextCard: number | null,
  ) => void;
  /** The board region to wrap (`.kanban-table`). */
  children: ReactNode;
  /** OPTIONAL Phase E: request unfolding a folded swimlane while dragging. */
  onRequestUnfoldSwimlane?: (swimlaneId: number) => void;
}

/**
 * The Kanban drag-and-drop provider. Renders a `DndContext` around the board and
 * maps each drop to the source-faithful `onMoveUs(...)` call. On a read-only
 * board (`isBoardDraggable(project) === false`) the context and children still
 * render (so the `@dnd-kit` hooks in the wrappers stay valid) but every wrapper
 * registers `disabled` via the internal context, so no drag can ever start and
 * `onMoveUs` never fires — equivalent to the source directive's early `return`
 * where the dragula `drake` is never created (`sortable.coffee:37,40`).
 */
export function KanbanDndContext(props: KanbanDndContextProps): ReactElement {
  /* D.1 Gate — reuse the shared helper; never re-derive modify_us/archived. */
  const draggable = isBoardDraggable(props.project);

  /* D.2 Sensors — PointerSensor distance:8 preserves plain clicks and the
   * ctrl/⌘ multi-select click that lives in Card's root onClick; KeyboardSensor
   * adds keyboard-accessible dragging + ARIA live announcements (the sole
   * permitted net-new behaviour). Hooks are always called (rules of hooks);
   * disabled wrappers alone prevent any drag on a read-only board. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  /* Pointer-first collision (faithful to dragula's pointer hit-testing and
   * robust for dropping onto EMPTY columns); rectIntersection is the fallback
   * that keeps keyboard dragging working when there is no pointer. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    return pointer.length > 0 ? pointer : rectIntersection(args);
  }, []);

  /* D.4 Drag lifecycle — refs are the AUTHORITATIVE reads inside onDragEnd (no
   * stale closures); state mirrors the values a re-render needs (the overlay and
   * the internal context that drives `isTarget`). */
  const activeIdRef = useRef<number | null>(null);
  const draggedIdsRef = useRef<number[]>([]);
  const sourceColumnKeyRef = useRef<string | null>(null);
  const oldIndexRef = useRef<number>(-1);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [draggedIds, setDraggedIds] = useState<number[]>([]);
  const [sourceColumnKey, setSourceColumnKey] = useState<string | null>(null);
  const [overColumnKey, setOverColumnKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Clear ALL drag state (refs + state). Called on drag end, cancel, and every
  // early return so nothing leaks between drags.
  const clearDragState = useCallback(() => {
    activeIdRef.current = null;
    draggedIdsRef.current = [];
    sourceColumnKeyRef.current = null;
    oldIndexRef.current = -1;
    setActiveId(null);
    setDraggedIds([]);
    setSourceColumnKey(null);
    setOverColumnKey(null);
    setIsDragging(false);
  }, []);

  /* D.6 onDragStart (sortable.coffee:75-87). */
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const active = Number(event.active.id);
      const data = event.active.data.current;

      // Source column DOM node via the getNode() closure stashed in the card's
      // draggable data; its columnKey is already the source key.
      const sourceColumnNode = resolveColumnNode(
        (data?.getNode?.() ?? null) as HTMLElement | null,
      );
      const srcKey: string | null = (data?.columnKey as string | undefined) ?? null;

      // Source container's cards INCLUDING the dragged ones (DOM order).
      const sourceFullIds = sourceColumnNode ? readOrderedCardIds(sourceColumnNode) : [];
      const dragged = resolveDraggedIds(active, props.selectedUss, sourceFullIds);
      // oldIndex from the FIRST dragged card, with the card still in place.
      const oldIdx = sourceFullIds.indexOf(dragged[0]);

      activeIdRef.current = active;
      draggedIdsRef.current = dragged;
      sourceColumnKeyRef.current = srcKey;
      oldIndexRef.current = oldIdx;

      setActiveId(active);
      setDraggedIds(dragged);
      setSourceColumnKey(srcKey);
      setOverColumnKey(srcKey); // reset over === source at drag start
      setIsDragging(true);
    },
    [props.selectedUss],
  );

  /* D.7 onDragOver — recompute the hovered column key so DroppableColumn's
   * `isTarget` updates (the non-source `target-drop` highlight). */
  const onDragOver = useCallback((event: DragOverEvent) => {
    const overData = event.over?.data.current;
    if (!overData) {
      return;
    }
    let key: string | null = null;
    if (overData.type === 'column') {
      key = columnKey(
        Number(overData.statusId),
        overData.swimlaneId != null ? Number(overData.swimlaneId) : null,
      );
    } else if (overData.type === 'card') {
      key = (overData.columnKey as string | undefined) ?? null;
    }
    setOverColumnKey(key);
  }, []);

  /* D.8 onDragEnd (sortable.coffee:109-153) — compute the payload and dispatch. */
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Snapshot the authoritative ref values before clearing.
      const draggedIdsSnap = draggedIdsRef.current;
      const sourceKeySnap = sourceColumnKeyRef.current;
      const oldIndexSnap = oldIndexRef.current;
      const activeIdSnap = activeIdRef.current;

      // Dropped outside any droppable, or no valid drag in flight -> no-op.
      if (!event.over || draggedIdsSnap.length === 0 || activeIdSnap == null) {
        clearDragState();
        return;
      }

      const overData = event.over.data.current;
      const destColumnNode = resolveColumnNode(
        (overData?.getNode?.() ?? null) as HTMLElement | null,
      );
      if (!destColumnNode) {
        clearDragState();
        return;
      }

      // Status / swimlane from the destination column (sortable.coffee:121-122).
      //
      // F-AAP-09 (data integrity): normalize a MISSING swimlane to `null` at THIS
      // boundary. In no-swimlane mode `data-swimlane` is absent, so
      // `Number(undefined)` is NaN. Previously the raw NaN was surfaced and only
      // survived by coincidence (NaN is falsy, so the downstream `swimlaneId ===
      // -1 ? null : swimlaneId` fell through and `if (swimlaneId)` omitted it) —
      // but a NaN could still reach the optimistic reducer state and the
      // `/userstories/bulk_update_kanban_order` body. We coerce NaN -> `null` here
      // so the value is a clean `number | null`: a real swimlane id (INCLUDING -1
      // for the synthetic "Unclassified" lane) or `null` when there are none.
      // `useKanbanBoard.move` still maps the synthetic `-1` to the API `null`.
      const newStatus = Number(destColumnNode.dataset.status);
      const rawSwimlane = Number(destColumnNode.dataset.swimlane);
      const newSwimlane: number | null = Number.isNaN(rawSwimlane) ? null : rawSwimlane;

      // Destination card order, dragged ids removed.
      const destExcl = readOrderedCardIds(destColumnNode).filter(
        (id) => !draggedIdsSnap.includes(id),
      );

      // Over-card + drop side — only when hovering a NON-dragged card. The drop
      // side is decided by the dragged element's translated center-Y vs the
      // over-card's center-Y (both lists are vertical within a column).
      let overCardId: number | null = null;
      let insertAfter = false;
      if (overData?.type === 'card') {
        const overUsId = Number(overData.usId);
        if (!draggedIdsSnap.includes(overUsId)) {
          overCardId = overUsId;
          const translated = event.active.rect.current.translated;
          if (translated) {
            const activeCenterY = translated.top + translated.height / 2;
            const overCenterY = event.over.rect.top + event.over.rect.height / 2;
            insertAfter = activeCenterY > overCenterY;
          } else {
            insertAfter = false;
          }
        }
      }

      // `newSwimlane` is already normalized to `number | null` (F-AAP-09), so it
      // is passed straight through — `columnKey` renders `null` as the `ns`
      // (no-swimlane) sentinel.
      const destColumnKey = columnKey(newStatus, newSwimlane);
      const sameContainer = sourceKeySnap === destColumnKey;

      const payload = computeMovePayload({
        draggedIds: draggedIdsSnap,
        destExcl,
        overCardId,
        insertAfter,
        newStatus,
        newSwimlane,
        oldIndex: oldIndexSnap,
        sameContainer,
        usMap: props.usMap,
      });

      // null => same container, same position (sortable.coffee:124) => no move.
      if (payload) {
        props.onMoveUs(
          payload.finalUsList,
          payload.newStatus,
          payload.newSwimlane,
          payload.index,
          payload.previousCard,
          payload.nextCard,
        );
      }

      // NOTE (intentionally NOT ported): the source's per-item $scope.$apply
      // deleteElement DOM cleanup (sortable.coffee:143-151) and the transient
      // `new` class + animationend (sortable.coffee:127-131) are AngularJS DOM
      // side-effects. In React the board re-renders from state after onMoveUs, so
      // no manual DOM node removal or class toggling is needed.
      clearDragState();
    },
    [props.usMap, props.onMoveUs, clearDragState],
  );

  /* D.9 onDragCancel — clear all drag state; never call onMoveUs. */
  const onDragCancel = useCallback(() => {
    clearDragState();
  }, [clearDragState]);

  /* D.11 renderOverlay — the floating drag mirror (replaces dragula's
   * `.gu-mirror` / the multi-drag mirror). Reuses EXISTING SCSS class names
   * only; introduces no new styles. */
  const renderOverlay = (): ReactElement | null => {
    if (activeId == null) {
      return null;
    }
    const card = props.usMap[activeId];
    if (!card) {
      return null;
    }
    const single = (
      <Card
        item={card}
        project={props.project}
        zoom={props.zoom}
        zoomLevel={props.zoomLevel}
        inViewPort
      />
    );
    if (draggedIds.length > 1) {
      return (
        <div className="multiple-drag-mirror tg-multiple-drag-mirror">{single}</div>
      );
    }
    return single;
  };

  /* D.10 Render. */
  return (
    <KanbanDndInternalContext.Provider
      value={{
        draggable,
        sourceColumnKey,
        overColumnKey,
        isDragging,
        onRequestUnfoldSwimlane: props.onRequestUnfoldSwimlane,
      }}
    >
      {/* D.3 autoScroll replaces dom-autoscroller({margin:100, scrollWhenOutside:
          true}) (sortable.coffee:155-160); @dnd-kit's built-in acceleration /
          threshold approximate that margin behaviour and scroll while the pointer
          is near/over container edges during an active drag. */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        autoScroll={{ enabled: true }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {props.children}
        <DragOverlay>{renderOverlay()}</DragOverlay>
      </DndContext>
    </KanbanDndInternalContext.Provider>
  );
}

/* ========================================================================== *
 * Phase E — OPTIONAL swimlane auto-unfold while dragging (main.coffee:1153-1180).
 *
 * This behaviour belongs to the `tgKanbanSwimlane` directive, NOT sortable.coffee,
 * and is SECONDARY / non-blocking: the core `KanbanDndContext` builds and works
 * with `onRequestUnfoldSwimlane` omitted. When a consumer wants it, a `Swimlane`
 * wrapper (rendered inside this DndContext) can call `useSwimlaneAutoUnfold` and
 * pass the returned handlers to `Swimlane`'s `onMouseOverSwimlane` /
 * `onMouseLeaveSwimlane` callbacks. The core drag state (`isDragging`) and the
 * `onRequestUnfoldSwimlane` callback are exposed through the internal context.
 * ========================================================================== */

/**
 * Hook implementing the drag-hover auto-unfold of a folded swimlane, faithful to
 * `main.coffee:1153-1180`: while a drag is in flight (`isDragging`, the React
 * equivalent of the original `document.querySelectorAll('tg-card.gu-mirror')`
 * probe), hovering a FOLDED swimlane adds a `pending-to-open` class and, after a
 * `1000ms` timer, requests unfolding via the context `onRequestUnfoldSwimlane`;
 * leaving cancels the timer and removes the class.
 *
 * Reads `isDragging` + `onRequestUnfoldSwimlane` from the internal context, so it
 * is a no-op unless rendered inside a `KanbanDndContext` that was given the
 * `onRequestUnfoldSwimlane` prop.
 *
 * @param swimlaneId The swimlane this hover targets.
 * @param folded     Whether that swimlane is currently folded.
 */
export function useSwimlaneAutoUnfold(
  swimlaneId: number,
  folded: boolean,
): {
  onMouseOverSwimlane: (el?: HTMLElement | null) => void;
  onMouseLeaveSwimlane: (el?: HTMLElement | null) => void;
} {
  const { isDragging, onRequestUnfoldSwimlane } = useContext(KanbanDndInternalContext);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLElement | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (elRef.current) {
      elRef.current.classList.remove('pending-to-open');
      elRef.current = null;
    }
  }, []);

  const onMouseOverSwimlane = useCallback(
    (el?: HTMLElement | null) => {
      // Gated on an active drag + a folded swimlane + a wired request callback.
      if (!isDragging || !folded || !onRequestUnfoldSwimlane) {
        return;
      }
      if (timerRef.current != null) {
        return; // an unfold is already pending
      }
      if (el) {
        elRef.current = el;
        el.classList.add('pending-to-open');
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (elRef.current) {
          elRef.current.classList.remove('pending-to-open');
          elRef.current = null;
        }
        onRequestUnfoldSwimlane(swimlaneId);
      }, 1000);
    },
    [isDragging, folded, onRequestUnfoldSwimlane, swimlaneId],
  );

  const onMouseLeaveSwimlane = useCallback(() => {
    cancel();
  }, [cancel]);

  return { onMouseOverSwimlane, onMouseLeaveSwimlane };
}
