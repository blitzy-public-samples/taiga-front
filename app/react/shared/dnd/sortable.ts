/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sortable drop/ordering geometry + drag-end orchestration for the React
 * drag-and-drop layer — the CORE module of `app/react/shared/dnd`.
 *
 * WHAT THIS MODULE REPLACES
 * -------------------------
 * This is the React reproduction of the legacy AngularJS `dragula` sortable
 * directives on the two migrated screens, plus the `moveUs` API orchestration
 * they triggered on drop:
 *   - Kanban:  `directive('tgKanbanSortable', ...)`   kanban/sortable.coffee
 *              + `KanbanController.moveUs`             kanban/main.coffee:596-627
 *   - Backlog: `directive('tgBacklogSortable', ...)`  backlog/sortable.coffee
 *              + `BacklogController.moveUs`            backlog/main.coffee:523-607
 *
 * On drop, the handler factories below call the SAME frozen `/api/v1/`
 * bulk-ordering endpoints, through the `../api/userstories` adapter:
 *   - `bulkUpdateKanbanOrder`   -> `/userstories/bulk_update_kanban_order`
 *   - `bulkUpdateBacklogOrder`  -> `/userstories/bulk_update_backlog_order`
 * The optimistic board/backlog STATE update (the immer reducer) is NOT owned
 * here: it lives in `../kanban` / `../backlog`. This module hands the reducer a
 * fully-computed result via an injected `onMove` callback and performs the API
 * call, so state and side-effects stay in the feature folders while the DnD
 * geometry + the frozen contract stay here, exhaustively unit-testable.
 *
 * TWO CORRECTNESS-CRITICAL FIDELITY POINTS (audit these against the sources)
 * -------------------------------------------------------------------------
 *  1. AFTER-PRECEDENCE. When a story is dropped, the backend orders it relative
 *     to EXACTLY ONE neighbor: `after_userstory_id` (the PREVIOUS sibling) wins,
 *     and `before_userstory_id` (the NEXT sibling) is sent ONLY when there is no
 *     previous. Verified identical on both screens:
 *       - kanban/sortable.coffee:95-107 (`previousCard` / `nextCard`)
 *       - backlog/sortable.coffee:50-63 (`previousUs`  / `nextUs`)
 *     See {@link computeAdjacentIds} / {@link computeAdjacentIdsFromOrder}.
 *  2. `bulk_userstories` IS AN ARRAY OF IDS (`number[]`), NOT `{ us_id, order }`
 *     objects. Verified in both flows:
 *       - kanban-usertories.coffee `move()` returns `bulkUserstories: usList`
 *         (the id list), and
 *       - backlog/main.coffee:535 `bulkUserstories = _.map(usList, (it) -> it.id)`.
 *     The moved ids computed by {@link resolveMovedIds} are passed STRAIGHT to
 *     the API. See the TYPE-RECONCILIATION note on the handler factories for how
 *     the (deliberately id-only) runtime payload is reconciled with the
 *     adapter's declared parameter type without ever changing the payload.
 *
 * DRAGULA vs. @dnd-kit — A DOM-REORDER CAVEAT
 * -------------------------------------------
 * `dragula` PHYSICALLY moves the dragged DOM node into its drop position, so at
 * `drop`/`dragend` the element's real siblings already reflect the new order and
 * `prevAll`/`nextAll` read the final neighbors. `@dnd-kit` does NOT reorder the
 * DOM during a drag — it animates via CSS transforms and expects the consumer to
 * reorder the DATA MODEL on drop. Therefore the data-model helper
 * {@link computeAdjacentIdsFromOrder} (fed the FINAL ordered id list, e.g. from
 * `arrayMove`) is generally the correct path for `@dnd-kit`, while the DOM
 * helper {@link computeAdjacentIds} is exact only once the DOM reflects the drop
 * (and is invaluable as a directly jsdom-testable reproduction of the jQuery
 * logic). The Kanban handler supports BOTH paths and prefers whichever
 * `../kanban` wires (a `columnEl` => DOM path; `orderedIds` => data path).
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 — HARD)
 * -------------------------------------
 * This module imports ONLY its own npm dependencies (`@dnd-kit/core`,
 * `@dnd-kit/sortable`, `@dnd-kit/utilities`, and the `react` type for styling),
 * the sibling `./types`, and the in-repo `../api/userstories`. It imports
 * NOTHING from the legacy CoffeeScript sources, the modern Angular-Elements
 * bundle, the Jade partials, or the SCSS styles, and never references `angular`,
 * `dragula`, `dom-autoscroller`, `immutable`, or `jquery`. All host interop
 * flows through globals elsewhere in the `shared` layer, never through this file.
 *
 * CONSUMERS: `DndProvider.tsx` (drag start/over wiring + the handler factories)
 * and the `../kanban` Card / `../backlog` UserStoryRow presentational components
 * (via the {@link useSortableCard} / {@link useSortableRow} hooks).
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  DragEndEvent,
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core';
import type { CSSProperties } from 'react';

import userstories from '../api/userstories';
import {
  DND_CLASS,
  type AdjacentIds,
  type UsId,
  type BulkUserstoryIds,
  type KanbanDragResult,
  type BacklogDragResult,
  type KanbanDragEndDeps,
  type BacklogDragEndDeps,
  type KanbanOrderApi,
  type BacklogOrderApi,
} from './types';

/* ========================================================================== *
 * Phase 1 — PURE helpers (no `@dnd-kit`, no React; jsdom-testable)
 * -------------------------------------------------------------------------- *
 * Each helper is exported individually and is free of `@dnd-kit`/React so the
 * bulk of the coverage can be exercised with a jsdom-built DOM. Every helper
 * documents the exact AngularJS source line range it reproduces.
 * ========================================================================== */

/**
 * True when `el` is a draggable ITEM for the given screen and is NOT the in-place
 * transit placeholder.
 *
 * Reproduces the `:not(.gu-transit)` filter applied to the item selector in the
 * `dragula` `drop` handlers (kanban/sortable.coffee:98-99;
 * backlog/sortable.coffee:53-54): `tg-card:not(.gu-transit)` on Kanban and
 * `.row:not(.gu-transit)` on Backlog. `itemSelector` is `'tg-card'` (Kanban) or
 * `'.row'` (Backlog); `transitClass` defaults to `DND_CLASS.transit`
 * (`'gu-transit'`).
 */
export function matchesItem(
  el: Element,
  itemSelector: string,
  transitClass: string = DND_CLASS.transit,
): boolean {
  return el.matches(itemSelector) && !el.classList.contains(transitClass);
}

/**
 * Compute the after-precedence neighbor ids by scanning the moved element's DOM
 * siblings — the direct reproduction of the `dragula` `drop` handlers
 * (kanban/sortable.coffee:95-107; backlog/sortable.coffee:50-63):
 *
 *     prev = $(item).prevAll('tg-card:not(.gu-transit)')
 *     next = $(item).nextAll('tg-card:not(.gu-transit)')
 *     previousCard = Number(prev[0].dataset.id) if prev.length && prev[0].dataset.id
 *     nextCard     = Number(next[0].dataset.id) if !previousCard && next.length && next[0].dataset.id
 *
 * `prev[0]` / `next[0]` in jQuery are the CLOSEST matching sibling; walking
 * `previousElementSibling` / `nextElementSibling` and breaking on the FIRST
 * match reproduces that (intervening non-matching nodes are skipped, exactly
 * like `prevAll(selector)` / `nextAll(selector)`).
 *
 * AFTER-PRECEDENCE (correctness-critical): `nextId` is consulted ONLY when there
 * is no previous. A falsy `previousId` (null OR 0) triggers the next scan, byte-
 * for-byte matching the coffee `if !previousCard` guard — so AT MOST ONE of the
 * two is non-null. Requires `activeEl` to already sit in its drop position (true
 * for `dragula`, and for `@dnd-kit` only once the DOM reflects the reorder — see
 * the file header; prefer {@link computeAdjacentIdsFromOrder} for the model path).
 */
export function computeAdjacentIds(
  activeEl: HTMLElement,
  itemSelector: string,
  transitClass: string = DND_CLASS.transit,
): AdjacentIds {
  let previousId: UsId | null = null;
  for (
    let p: Element | null = activeEl.previousElementSibling;
    p;
    p = p.previousElementSibling
  ) {
    if (matchesItem(p, itemSelector, transitClass)) {
      const id = (p as HTMLElement).dataset.id;
      if (id) {
        previousId = Number(id);
      }
      break; // closest preceding match only (jQuery `prev[0]`)
    }
  }

  let nextId: UsId | null = null;
  // AFTER-PRECEDENCE: only consult `next` when there is no previous
  // (kanban/sortable.coffee:105 `if !previousCard`; treats 0 as "no previous").
  if (!previousId) {
    for (
      let n: Element | null = activeEl.nextElementSibling;
      n;
      n = n.nextElementSibling
    ) {
      if (matchesItem(n, itemSelector, transitClass)) {
        const id = (n as HTMLElement).dataset.id;
        if (id) {
          nextId = Number(id);
        }
        break; // closest following match only (jQuery `next[0]`)
      }
    }
  }

  return { previousId, nextId };
}

/**
 * Data-model equivalent of {@link computeAdjacentIds} for the `@dnd-kit`
 * reorder-in-model flow. Given the FINAL ordered id list of the destination
 * container (transit placeholder excluded, e.g. the result of `arrayMove`) and
 * the moved id, returns the same after-precedence result WITHOUT any dependence
 * on DOM timing:
 *
 *     previousId = orderedIds[i-1] ?? null
 *     nextId     = (!previousId) ? (orderedIds[i+1] ?? null) : null
 *
 * Produces IDENTICAL output to {@link computeAdjacentIds} for the same logical
 * arrangement (asserted in the spec). The `!previousId` guard mirrors the coffee
 * `if !previousCard` (kanban/sortable.coffee:105) so a falsy previous (null OR 0)
 * consults next; AT MOST ONE of the two is non-null. Returns both `null` when
 * `movedId` is absent from `orderedIds` or the list has a single element.
 */
export function computeAdjacentIdsFromOrder(
  orderedIds: UsId[],
  movedId: UsId,
): AdjacentIds {
  const i = orderedIds.indexOf(movedId);
  if (i === -1) {
    return { previousId: null, nextId: null };
  }

  const previousId: UsId | null = i > 0 ? orderedIds[i - 1] : null;
  const nextId: UsId | null =
    !previousId && i + 1 < orderedIds.length ? orderedIds[i + 1] : null;

  return { previousId, nextId };
}

/**
 * Read the destination Kanban column's status + swimlane from its DOM dataset.
 *
 * Reproduces `newStatus = Number(parentEl.dataset.status)` and
 * `newSwimlane = Number(parentEl.dataset.swimlane)` (kanban/sortable.coffee:121-122),
 * where `parentEl` is the `.taskboard-column` the card was dropped into (the
 * column carries `data-status`, `data-swimlane`, and `id="column-<statusId>"`).
 */
export function readKanbanColumnTarget(columnEl: HTMLElement): {
  newStatus: number;
  newSwimlane: number;
} {
  return {
    newStatus: Number(columnEl.dataset.status),
    newSwimlane: Number(columnEl.dataset.swimlane),
  };
}

/**
 * Read the destination Kanban column's status + swimlane from the `data` a
 * `../kanban` droppable attaches to its `@dnd-kit` node (the data-model path,
 * used when no `columnEl` is wired). Mirrors {@link readKanbanColumnTarget} but
 * sources `statusId` / `swimlaneId` from `over.data.current` rather than the DOM
 * dataset. Non-numeric / missing values coerce to `NaN`, surfacing a wiring bug
 * loudly rather than silently sending `0`.
 */
export function readColumnTargetFromData(
  data: Record<string, unknown> | null | undefined,
): { newStatus: number; newSwimlane: number } {
  return {
    newStatus: Number(data?.['statusId']),
    newSwimlane: Number(data?.['swimlaneId']),
  };
}

/**
 * Map a Kanban swimlane id to its API form: the sentinel `-1` (the "no swimlane"
 * / default row) becomes `null`; every other value passes through unchanged.
 *
 * Reproduces `apiNewSwimlaneId = null if newSwimlaneId == -1` from
 * `KanbanController.moveUs` (kanban/main.coffee:604-606) — the single point where
 * the board's `-1` sentinel is translated to the wire `null`.
 */
export function toApiSwimlane(newSwimlane: number): number | null {
  return newSwimlane === -1 ? null : newSwimlane;
}

/**
 * Position of `el` among the elements matching `selector` WITHIN `parentEl`,
 * or `-1` when absent.
 *
 * Reproduces `$(parentEl).find(selector).index(el)` (kanban/sortable.coffee:120;
 * backlog/sortable.coffee:114-117): `querySelectorAll` matches descendants (like
 * jQuery `.find`), and `indexOf` reproduces `.index(el)` (including its `-1`
 * "not found" contract).
 */
export function indexAmong(
  el: Element,
  parentEl: Element,
  selector: string,
): number {
  return Array.from(parentEl.querySelectorAll(selector)).indexOf(el);
}

/**
 * True when `el` is a Kanban drop container (a `.taskboard-column`).
 * Mirrors the Kanban `dragula` container set (kanban/sortable.coffee:56-61),
 * whose containers are the swimlane columns rendered from kanban-table.jade.
 */
export function isKanbanContainer(el: Element): boolean {
  return el.classList.contains('taskboard-column');
}

/**
 * True when `el` is any Backlog drop container.
 *
 * Reproduces the Backlog `dragula` container predicate + the extra empty-backlog
 * drop zones (backlog/sortable.coffee:39-42): `isContainer` matches
 * `.sprint-table`, and the two `emptyBacklog` elements carry `.backlog-table-body`
 * / `.js-empty-backlog`.
 */
export function isBacklogContainer(el: Element): boolean {
  return (
    el.classList.contains('sprint-table') ||
    el.classList.contains('backlog-table-body') ||
    el.classList.contains('js-empty-backlog')
  );
}

/**
 * True when `el` is specifically the BACKLOG LIST (not a sprint) drop zone.
 *
 * Reproduces the `isBacklog` test at `dragend`
 * (backlog/sortable.coffee:99 `parent.hasClass('backlog-table-body') ||
 * parent.hasClass('js-empty-backlog')`), which decides whether the drop targets
 * the backlog (sprint id `null`) or a sprint.
 */
export function isBacklogListContainer(el: Element): boolean {
  return (
    el.classList.contains('backlog-table-body') ||
    el.classList.contains('js-empty-backlog')
  );
}

/**
 * Resolve the ids to move: the whole multi-selection when it is non-empty AND
 * contains the actively dragged item, otherwise just `[activeId]`.
 *
 * Reproduces the `window.dragMultiple` rule shared by both screens
 * (kanban/sortable.coffee:76-82,133-134; backlog/sortable.coffee:78-86): the
 * moved set is the current selection if the dragged item belongs to it, else the
 * single dragged item. In React the selection is owned by `../kanban` /
 * `../backlog` state and injected via `deps.getSelectedIds()`; the returned array
 * is a COPY so callers can freely retain it. The result is a
 * {@link BulkUserstoryIds} (`number[]`) — see fidelity point #2 in the header.
 */
export function resolveMovedIds(
  activeId: UsId,
  selectedIds: UsId[],
): BulkUserstoryIds {
  return selectedIds.length > 0 && selectedIds.includes(activeId)
    ? [...selectedIds]
    : [activeId];
}

/* ========================================================================== *
 * Phase 2 — Class-management helpers (visual parity; DOM side-effects)
 * -------------------------------------------------------------------------- *
 * Small, still-unit-testable helpers that toggle the exact class names the
 * existing SCSS keys on, so the React screens animate/highlight identically.
 * ========================================================================== */

/**
 * Highlight a hovered DIFFERENT container by adding `DND_CLASS.targetDrop`
 * (`'target-drop'`). Reproduces the `over` handler
 * (kanban/sortable.coffee:65-69). The "different container" condition is
 * enforced by the CALLER (DndProvider), matching the coffee guard
 * `else if container != initialContainer`.
 */
export function addTargetDrop(container: Element): void {
  container.classList.add(DND_CLASS.targetDrop);
}

/**
 * Remove the hovered-container highlight (`DND_CLASS.targetDrop`). Reproduces the
 * `out` handler (kanban/sortable.coffee:71-73).
 */
export function removeTargetDrop(container: Element): void {
  container.classList.remove(DND_CLASS.targetDrop);
}

/**
 * Toggle the body-level `DND_CLASS.dragActive` (`'drag-active'`) flag used by the
 * Backlog screen while a drag is in progress. Reproduces
 * `$(document.body).addClass('drag-active')` on `drag`
 * (backlog/sortable.coffee:73) and `.removeClass('drag-active')` on `dragend`
 * (backlog/sortable.coffee:103). The drag-start side (`true`) is wired in
 * `DndProvider`; the drag-end side (`false`) is invoked by the backlog handler.
 */
export function setDragActive(on: boolean): void {
  if (on) {
    document.body.classList.add(DND_CLASS.dragActive);
  } else {
    document.body.classList.remove(DND_CLASS.dragActive);
  }
}

/**
 * Play the one-shot "landed from elsewhere" animation on a destination column by
 * adding `DND_CLASS.newColumn` (`'new'`) and removing it after a single
 * `animationend`. Reproduces kanban/sortable.coffee:131-135:
 *
 *     $(parentEl).addClass('new')
 *     $(parentEl).one 'animationend', -> $(parentEl).removeClass('new')
 *
 * Only invoked when the card lands in a DIFFERENT column (the caller enforces
 * that, mirroring `if initialContainer != parentEl`). `{ once: true }` reproduces
 * jQuery `.one(...)` so the listener self-detaches.
 */
export function markColumnNew(columnEl: HTMLElement): void {
  columnEl.classList.add(DND_CLASS.newColumn);
  columnEl.addEventListener(
    'animationend',
    () => {
      columnEl.classList.remove(DND_CLASS.newColumn);
    },
    { once: true },
  );
}

/**
 * Remove every `.doom-line` decoration node under `root` (default `document`).
 * Reproduces `$('.doom-line').remove()` run at the start of the Backlog
 * `dragend` handler (backlog/sortable.coffee:95).
 */
export function removeDoomLines(root: ParentNode = document): void {
  root.querySelectorAll('.doom-line').forEach((node) => {
    node.remove();
  });
}

/* ========================================================================== *
 * Phase 3 — `useSortable` wrappers (React hooks)
 * -------------------------------------------------------------------------- *
 * Thin wrappers over `@dnd-kit/sortable`'s `useSortable` consumed by the
 * `../kanban` Card (`tg-card`) and the `../backlog` UserStoryRow (`.row`). These
 * hooks are ALSO what enforce "only `tg-card` / `.row` may move": a non-draggable
 * element simply never calls one, reproducing the `dragula` `moves:` predicate
 * (kanban/sortable.coffee:59-60; backlog/sortable.coffee:43-48).
 * ========================================================================== */

/**
 * The render-time state a sortable item needs, returned by
 * {@link useSortableCard} / {@link useSortableRow}. Spread `attributes` and
 * `listeners` onto the draggable element, attach `setNodeRef` as its `ref`, apply
 * `style`, and append `className` (which carries `gu-transit` while dragging so
 * the existing SCSS placeholder styling applies).
 */
export interface SortableItemState {
  /** `@dnd-kit` node ref setter — attach as the draggable element's `ref`. */
  setNodeRef: (node: HTMLElement | null) => void;
  /** ARIA + role attributes to spread onto the draggable element. */
  attributes: DraggableAttributes;
  /** Pointer/keyboard drag listeners to spread onto the draggable element. */
  listeners: DraggableSyntheticListeners;
  /** Inline transform/transition style produced by `@dnd-kit` during a drag. */
  style: CSSProperties;
  /** Whether this item is the one currently being dragged. */
  isDragging: boolean;
  /** `DND_CLASS.transit` (`'gu-transit'`) while dragging, else `''`. */
  className: string;
}

/**
 * Shared implementation behind {@link useSortableCard} and {@link useSortableRow}
 * (identical except for the selector each represents — `tg-card` vs `.row`).
 *
 * Wraps `useSortable({ id: usId, data })` and adapts its output to
 * {@link SortableItemState}:
 *   - `style.transform` uses `CSS.Transform.toString(transform)` (returns
 *     `string | undefined`, matching `CSSProperties['transform']`);
 *   - `className` carries `DND_CLASS.transit` (`'gu-transit'`) while `isDragging`
 *     so the EXISTING placeholder SCSS renders the dragged item unchanged
 *     (reproducing the `gu-transit` class `dragula` applies to the in-place
 *     placeholder — backlog-table.scss:330; the `:not(.gu-transit)` selectors in
 *     the sortables).
 *
 * `data` is forwarded verbatim to `@dnd-kit`; `../kanban` / `../backlog` use it
 * to carry the per-item context the handler factories read from
 * `event.active.data.current` (e.g. `{ usId, statusId, swimlaneId, oldIndex }`).
 * Must be called from a React render context (it is a hook).
 */
export function useSortableItem(
  usId: UsId,
  data?: Record<string, unknown>,
): SortableItemState {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: usId, data });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Reproduce the `gu-transit` placeholder class dragula applied to the moving
  // item, so the existing SCSS keeps styling the "in transit" slot identically.
  const className = isDragging ? DND_CLASS.transit : '';

  return { setNodeRef, attributes, listeners, style, isDragging, className };
}

/**
 * Sortable hook for a Kanban CARD (`tg-card`). See {@link useSortableItem}.
 * Enforces that only cards are draggable (dragula `moves: $(item).is('tg-card')`,
 * kanban/sortable.coffee:59-60).
 */
export function useSortableCard(
  usId: UsId,
  data?: Record<string, unknown>,
): SortableItemState {
  return useSortableItem(usId, data);
}

/**
 * Sortable hook for a Backlog ROW (`.row` — either `.us-item-row` in the backlog
 * body or `.milestone-us-item-row` inside a sprint). See {@link useSortableItem}.
 * Enforces that only rows are draggable (dragula `moves: $(item).hasClass('row')`,
 * backlog/sortable.coffee:43-48).
 */
export function useSortableRow(
  usId: UsId,
  data?: Record<string, unknown>,
): SortableItemState {
  return useSortableItem(usId, data);
}

/* ========================================================================== *
 * Phase 4 — Drag-end handler FACTORIES
 * -------------------------------------------------------------------------- *
 * Each factory closes over its injected dependencies and returns a
 * `(event: DragEndEvent) => Promise<void>` suitable for `<DndContext onDragEnd>`.
 * The optimistic state update is delegated to `deps.onMove` (applied BEFORE the
 * request, matching the AngularJS `$scope.$apply` ordering — state first, then
 * the API call), and the frozen `/api/v1/` call is made via `deps.api` (defaulting
 * to the real `../api/userstories` adapter).
 * ========================================================================== */

/* --- internal glue: safe reads from the untyped `data.current` bags -------- */

/**
 * Coerce an unknown `data.current` value to a finite number, or `null` when it is
 * missing / not numeric. `0` and `-1` (the swimlane sentinel) are preserved as
 * valid numbers; only `null` / `undefined` / `NaN` collapse to `null`. Used for
 * the source-container comparison in the no-op guards.
 */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Read an `HTMLElement` from a `data.current` field, or `null` if not present. */
function readElement(
  data: Record<string, unknown> | undefined,
  key: string,
): HTMLElement | null {
  const el = data?.[key];
  return el instanceof HTMLElement ? el : null;
}

/**
 * Read the FINAL ordered id list from a droppable's `data.current`. Prefers an
 * explicit `orderedIds: number[]` (what `../kanban` / `../backlog` wire), and
 * falls back to `@dnd-kit/sortable`'s auto-attached `sortable.items` so idiomatic
 * sortable wiring also works. Returns `[]` when neither is present.
 */
function readOrderedIds(data: Record<string, unknown> | undefined): UsId[] {
  const explicit = data?.['orderedIds'];
  if (Array.isArray(explicit)) {
    return explicit.map((v) => Number(v));
  }
  const sortable = data?.['sortable'];
  if (sortable && typeof sortable === 'object') {
    const items = (sortable as Record<string, unknown>)['items'];
    if (Array.isArray(items)) {
      return items.map((v) => Number(v));
    }
  }
  return [];
}

/**
 * Locate the moved item's DOM element for the DOM adjacency path: prefer an
 * explicit element on the active `data.current`, else query it inside the
 * destination container by `data-id` (`selector[data-id="<id>"]`).
 */
function readItemEl(
  activeData: Record<string, unknown> | undefined,
  containerEl: HTMLElement | null,
  activeId: UsId,
  elKey: string,
  selector: string,
): HTMLElement | null {
  const fromData = readElement(activeData, elKey);
  if (fromData) {
    return fromData;
  }
  if (containerEl) {
    return containerEl.querySelector<HTMLElement>(
      `${selector}[data-id="${activeId}"]`,
    );
  }
  return null;
}

/**
 * Create the Kanban `onDragEnd` handler.
 *
 * Reproduces the Kanban `dragula` `dragend` geometry (kanban/sortable.coffee:109-153)
 * and `KanbanController.moveUs` (kanban/main.coffee:596-627): it resolves the
 * destination status/swimlane, the after-precedence neighbors, the drop index and
 * the moved-id set, applies the optimistic update via `onMove`, then calls
 * `bulkUpdateKanbanOrder` with `swimlane === -1` mapped to `null`.
 *
 * TYPE RECONCILIATION (AAP 0.5.3): the real `../api/userstories` adapter types its
 * bulk parameter as `BulkOrderItem[]` (`{ us_id, order }`), whereas the frozen
 * wire payload — and therefore the `KanbanOrderApi` structural type — is a bare
 * `number[]` (`BulkUserstoryIds`). The legacy client sends IDS ONLY (see fidelity
 * point #2 in the header), so the RUNTIME value stays `number[]`; we reconcile only
 * the STATIC type here, once, via a single `as unknown as` cast at the default. The
 * payload is never altered.
 *
 * Destination geometry is read via whichever path `../kanban` wires:
 *   - DOM path  — when the over droppable exposes a `columnEl` HTMLElement:
 *     {@link readKanbanColumnTarget} + {@link computeAdjacentIds} + {@link indexAmong};
 *   - data path — otherwise, from `over.data.current`:
 *     {@link readColumnTargetFromData} + {@link computeAdjacentIdsFromOrder}.
 *
 * The source container (`statusId`/`swimlaneId`) and `oldIndex` are read from the
 * active item's `data.current` (attached at drag start by `../kanban`). When they
 * are absent the handler conservatively processes the move (a redundant reorder is
 * harmless server-side). `bulkUpdateMilestone` is deliberately NOT called here — it
 * backs the toolbar "move to sprint" action, not drag-and-drop (backlog/main.coffee:779-813).
 */
export function createKanbanDragEndHandler(
  deps: KanbanDragEndDeps,
): (event: DragEndEvent) => Promise<void> {
  const api: KanbanOrderApi =
    deps.api ?? (userstories as unknown as KanbanOrderApi);

  return async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    // No droppable target => dropped outside any column. `dragula` would snap the
    // card back to its source; `@dnd-kit` reports `over == null`. Nothing to persist.
    if (!over) {
      return;
    }

    const activeId: UsId = Number(active.id);
    const activeData = active.data.current ?? undefined;
    const overData = over.data.current ?? undefined;

    let newStatus: number;
    let newSwimlane: number;
    let adjacent: AdjacentIds;
    let index: number;

    const columnEl = readElement(overData, 'columnEl');
    if (columnEl) {
      // DOM PATH: exact once the DOM reflects the drop (see file header).
      const target = readKanbanColumnTarget(columnEl);
      newStatus = target.newStatus;
      newSwimlane = target.newSwimlane;
      const cardEl = readItemEl(activeData, columnEl, activeId, 'cardEl', 'tg-card');
      adjacent = cardEl
        ? computeAdjacentIds(cardEl, 'tg-card')
        : { previousId: null, nextId: null };
      index = cardEl ? indexAmong(cardEl, columnEl, 'tg-card') : -1;
    } else {
      // DATA PATH (preferred for @dnd-kit): read status/swimlane + final order.
      const target = readColumnTargetFromData(overData);
      newStatus = target.newStatus;
      newSwimlane = target.newSwimlane;
      const orderedIds = readOrderedIds(overData);
      adjacent = computeAdjacentIdsFromOrder(orderedIds, activeId);
      index = orderedIds.indexOf(activeId);
    }

    // Source container + original index, attached at drag start by ../kanban.
    const sourceStatus = toNumberOrNull(activeData?.['statusId']);
    const sourceSwimlane = toNumberOrNull(activeData?.['swimlaneId']);
    const oldIndex = toNumberOrNull(activeData?.['oldIndex']);
    const sameContainer =
      sourceStatus !== null &&
      sourceSwimlane !== null &&
      newStatus === sourceStatus &&
      newSwimlane === sourceSwimlane;

    // NO-OP GUARD (kanban/sortable.coffee:128-129): same container AND unchanged
    // index => do nothing (no state update, no request). Requires a known oldIndex;
    // when it is absent we fall through and process (safe, harmless reorder).
    if (sameContainer && oldIndex !== null && index === oldIndex) {
      return;
    }

    // Landed in a DIFFERENT column => one-shot "new" animation on the destination
    // (kanban/sortable.coffee:131-135). Only meaningful on the DOM path.
    if (!sameContainer && columnEl) {
      markColumnNew(columnEl);
    }

    const movedIds = resolveMovedIds(activeId, deps.getSelectedIds?.() ?? []);
    const apiSwimlane = toApiSwimlane(newSwimlane);

    const result: KanbanDragResult = {
      movedIds,
      newStatus,
      newSwimlane,
      index,
      afterUserstoryId: adjacent.previousId,
      beforeUserstoryId: adjacent.nextId,
    };

    // Optimistic state update FIRST (immer reducer in ../kanban), then the frozen
    // API call — matching the AngularJS order (state via $scope.$apply, then moveUs).
    deps.onMove(result);

    await api.bulkUpdateKanbanOrder(
      deps.projectId,
      newStatus,
      apiSwimlane,
      result.afterUserstoryId,
      result.beforeUserstoryId,
      movedIds,
    );
  };
}

/**
 * Create the Backlog `onDragEnd` handler.
 *
 * Reproduces the Backlog `dragula` `dragend` geometry (backlog/sortable.coffee:94-143)
 * and `BacklogController.moveUs` (backlog/main.coffee:523-607): it always cleans up
 * the `drag-active` body flag and any `.doom-line` decorations, determines whether
 * the drop targets the backlog list or a sprint, resolves after-precedence neighbors,
 * the drop index and the moved-id set, applies the optimistic update via `onMove`,
 * then calls `bulkUpdateBacklogOrder(projectId, targetSprintId, previousUs, nextUs,
 * movedIds)`. `targetSprintId` is the DESTINATION sprint id (or `null` for the
 * backlog), which equals the `currentSprintId` derived in `moveUs`.
 *
 * SERIALIZATION (backlog/main.coffee `pendingDrag` queue, ~539-631): concurrent
 * drops must not race — each awaits the previous. Reproduced with a closure-scoped
 * promise chain; the chain continues past a rejected drop (a failed request does not
 * wedge the queue). Callers `await` the returned promise for the specific drop.
 *
 * TYPE RECONCILIATION (AAP 0.5.3): identical to the Kanban factory — the runtime
 * `bulk_userstories` payload stays `number[]`; only the static adapter type is
 * reconciled here via a single `as unknown as` cast at the default.
 *
 * `bulkUpdateMilestone` is deliberately NOT called here — the drag flow uses
 * `bulkUpdateBacklogOrder` exactly as the source does (backlog/main.coffee:544-556);
 * `bulkUpdateMilestone` backs the separate toolbar "move to sprint" action.
 */
export function createBacklogDragEndHandler(
  deps: BacklogDragEndDeps,
): (event: DragEndEvent) => Promise<void> {
  const api: BacklogOrderApi =
    deps.api ?? (userstories as unknown as BacklogOrderApi);

  const run = async (event: DragEndEvent): Promise<void> => {
    // Cleanup ALWAYS runs on dragend, BEFORE any guard/branch: remove the
    // `.doom-line` nodes (backlog/sortable.coffee:95) and the body `drag-active`
    // flag (backlog/sortable.coffee:103).
    setDragActive(false);
    removeDoomLines();

    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeId: UsId = Number(active.id);
    const activeData = active.data.current ?? undefined;
    const overData = over.data.current ?? undefined;

    // Destination container: a DOM element when wired (`destEl`), else inferred
    // from the droppable data.
    const destEl = readElement(overData, 'destEl');
    const isBacklog =
      destEl !== null
        ? isBacklogListContainer(destEl)
        : Boolean(overData?.['isBacklog']);

    // targetSprintId = destination sprint id, or `null` for the backlog list
    // (backlog/sortable.coffee:118 `sprint = parent.scope()?.sprint.id`).
    const targetSprintId = isBacklog
      ? null
      : toNumberOrNull(overData?.['sprintId'] ?? overData?.['targetSprintId']);

    let adjacent: AdjacentIds;
    let index: number;
    const rowEl = readItemEl(activeData, destEl, activeId, 'rowEl', '.row');
    if (destEl && rowEl) {
      // DOM PATH.
      adjacent = computeAdjacentIds(rowEl, '.row');
      index = indexAmong(rowEl, destEl, '.row');
    } else {
      // DATA PATH (preferred for @dnd-kit).
      const orderedIds = readOrderedIds(overData);
      adjacent = computeAdjacentIdsFromOrder(orderedIds, activeId);
      index = orderedIds.indexOf(activeId);
    }

    // Source container + original index, attached at drag start by ../backlog.
    const sourceSprintId = toNumberOrNull(activeData?.['sprintId']);
    const sourceIsBacklog = activeData
      ? Boolean(activeData['isBacklog'])
      : false;
    const oldIndex = toNumberOrNull(activeData?.['oldIndex']);

    // sameContainer reproduces backlog/sortable.coffee:106-110 exactly:
    //   if initIsBacklog || isBacklog: sameContainer = (initIsBacklog == isBacklog)
    //   else:                          sameContainer = (sourceSprintId == destSprintId)
    let sameContainer: boolean;
    if (sourceIsBacklog || isBacklog) {
      sameContainer = sourceIsBacklog === isBacklog;
    } else {
      sameContainer =
        sourceSprintId !== null &&
        targetSprintId !== null &&
        sourceSprintId === targetSprintId;
    }

    // NO-OP GUARD (backlog/sortable.coffee:120-121): same container AND unchanged
    // index => do nothing (cleanup above already ran). Requires a known oldIndex.
    if (sameContainer && oldIndex !== null && index === oldIndex) {
      return;
    }

    const movedIds = resolveMovedIds(activeId, deps.getSelectedIds?.() ?? []);

    const result: BacklogDragResult = {
      movedIds,
      targetSprintId,
      index,
      previousUs: adjacent.previousId,
      nextUs: adjacent.nextId,
      isBacklog,
    };

    // Optimistic state update FIRST (immer reducer in ../backlog), then the frozen
    // API call — matching the AngularJS order ($scope.$applyAsync, then moveUs).
    deps.onMove(result);

    await api.bulkUpdateBacklogOrder(
      deps.projectId,
      targetSprintId,
      result.previousUs,
      result.nextUs,
      movedIds,
    );
  };

  // Per-handler promise chain: each invocation runs only after the previous one
  // settles (resolve OR reject), so overlapping drops are serialized and a failed
  // request never wedges the queue. Reproduces the `pendingDrag` serialization.
  let queue: Promise<void> = Promise.resolve();
  return (event: DragEndEvent): Promise<void> => {
    queue = queue.then(
      () => run(event),
      () => run(event),
    );
    return queue;
  };
}

