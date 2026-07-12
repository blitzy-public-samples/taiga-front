/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { KanbanDropArgs } from "./types";

/**
 * Target column the drop landed on (from the dnd-kit droppable `data`).
 * `swimlaneId` is the RAW value: `null` (non-swimlane), a real id, or `-1`
 * (unclassified swimlane).
 */
export interface DropTarget {
    statusId: number;
    swimlaneId: number | null;
}

/**
 * Origin of the dragged card, resolved from board state at drag-end.
 * `index` is the position of the dragged card in its origin column's ordered
 * list (used only by the same-container no-op guard).
 */
export interface DropOrigin {
    statusId: number;
    swimlaneId: number | null;
    index: number;
}

/** All primitives `resolveKanbanDrop` needs. Everything is pre-computed by the
 * caller (`useKanbanDragEnd`) from board state + DOM geometry, keeping this
 * function pure and fully unit-testable. */
export interface ResolveKanbanDropInput {
    /** id of the card actually dragged (dnd-kit `active.id`). */
    activeId: number;
    /** currently-selected ids in DOM document order (from the selection layer). */
    orderedSelectedIds: number[];
    /** target column descriptor (from the dnd-kit `over` droppable data). */
    target: DropTarget;
    /** origin descriptor from board state (`usMap[activeId]` + origin index). */
    origin: DropOrigin;
    /** current ordered ids of the target column (from board state, pre-drop). */
    targetOrderedIds: number[];
    /** drop insertion index among the NON-moved target cards (from DOM geometry). */
    insertionIndex: number;
}

/** Normalize a swimlane id for same-container comparison: `null` (non-swimlane)
 * and `-1` (unclassified) collapse to the same bucket key. */
const swimlaneKey = (swimlaneId: number | null): number =>
    swimlaneId === null || swimlaneId === undefined ? -1 : swimlaneId;

const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

/**
 * Decide the set of user-stories that move. Mirrors the legacy
 * `window.dragMultiple` gate: the whole selection moves ONLY when the dragged
 * card is itself part of a multi-selection (>= 2 selected); otherwise just the
 * dragged card moves. The returned order is the DOM order supplied by the
 * caller (matching legacy `getElements()`).
 */
export function computeMovedSet(activeId: number, orderedSelectedIds: number[]): number[] {
    const isMulti = orderedSelectedIds.indexOf(activeId) !== -1 && orderedSelectedIds.length > 1;
    return isMulti ? orderedSelectedIds.slice() : [activeId];
}

/**
 * Resolve a completed drag into a `KanbanDropArgs`, or `null` when the drop is a
 * no-op (same container, same position). Pure: all inputs are pre-computed.
 *
 * Reproduces `sortable.coffee` drop/dragend:
 *  - `remaining` = target column ids minus the moved set (legacy `:not(.gu-transit)`).
 *  - `previousCard` = nearest preceding remaining card (priority); `nextCard` =
 *    nearest following remaining card ONLY when there is no `previousCard`.
 *  - no-op when the target equals the origin container AND `index === origin.index`.
 */
export function resolveKanbanDrop(input: ResolveKanbanDropInput): KanbanDropArgs | null {
    const { activeId, orderedSelectedIds, target, origin, targetOrderedIds, insertionIndex } = input;

    const usList = computeMovedSet(activeId, orderedSelectedIds);

    const moved: Record<number, true> = {};
    for (const id of usList) {
        moved[id] = true;
    }
    const remaining = targetOrderedIds.filter((id) => !moved[id]);

    const index = clamp(insertionIndex, 0, remaining.length);

    const previousCard: number | null = index > 0 ? remaining[index - 1] : null;
    const nextCard: number | null =
        previousCard === null ? (index < remaining.length ? remaining[index] : null) : null;

    const sameContainer =
        target.statusId === origin.statusId && swimlaneKey(target.swimlaneId) === swimlaneKey(origin.swimlaneId);

    if (sameContainer && index === origin.index) {
        return null;
    }

    return {
        usList,
        statusId: target.statusId,
        swimlaneId: target.swimlaneId,
        index,
        previousCard,
        nextCard,
    };
}
