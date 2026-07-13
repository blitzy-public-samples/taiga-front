/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * resolveBacklogDrop
 * ------------------
 * PURE resolution of a completed Backlog / Sprint-Planning drag into the exact
 * arguments the hook's `moveUs` expects, or `null` for a no-op / rejected drop.
 *
 * This is the backlog analogue of `kanban/dnd/resolveDrop.ts`: it isolates the
 * cross-container drag maths (which `@dnd-kit`'s pointer geometry makes untestable
 * in jsdom) into one side-effect-free function so every legacy movement direction
 * is covered by fast unit tests. `Backlog.tsx` supplies the primitives from view
 * state; this function decides the moved set, destination container, insertion
 * index and the `previousUs`/`nextUs` neighbours.
 *
 * Faithful reproduction of the legacy contract
 * (`app/coffee/modules/backlog/sortable.coffee` `dragend` +
 *  `app/coffee/modules/backlog/main.coffee` `moveUs`, recovered from history):
 *   - EVERY drag direction resolves to ONE `moveUs(usList, newUsIndex, newSprintId,
 *     previousUs, nextUs)` call (→ the single `bulk-update-us-backlog-order`
 *     endpoint with `currentSprintId`). The cross-container `bulk-update-us-milestone`
 *     endpoint is the TOOLBAR "move selected to sprint" path, never drag.
 *   - `newSprintId` is the DESTINATION sprint id, or `null` for the backlog.
 *   - Multi-move: the whole selection moves ONLY when the dragged row is itself
 *     part of a multi-selection (`window.dragMultiple`); otherwise just the dragged
 *     row moves (see {@link computeMovedSet}).
 *   - `previousUs` = the nearest preceding remaining row; `nextUs` = the nearest
 *     following remaining row ONLY when there is no `previousUs` (the legacy
 *     top-of-list quirk `drake.on('drop')`).
 *   - Closed-sprint handling is NOT enforced here (legacy parity): the stock
 *     dragula config accepted ANY visible `.sprint-table` as a drop container
 *     (`isContainer: el.classList.contains('sprint-table')`, no closed check),
 *     and a closed sprint the user explicitly UNFOLDS becomes a valid container
 *     whose drop reopens it. Rejection of drops onto FOLDED / hidden closed
 *     sprints is a property of the droppable layer (a collapsed `.sprint-table`
 *     is not a live drop target — see the fold-gated `useDroppable` in
 *     `../SprintList.tsx`), exactly as the legacy collapsed table was not a
 *     dragula container. This resolver stays purely positional.
 *   - A drop that leaves the destination order unchanged (same container, same
 *     position) is a no-op (legacy `if index == oldIndex && sameContainer: return`).
 */

/** Where the drag ended, resolved from the `@dnd-kit` `over` droppable. */
export type BacklogDropOver =
    | { kind: "row"; usId: number }
    | { kind: "container"; sprintId: number | null };

/** All primitives {@link resolveBacklogDrop} needs — everything pre-computed by
 * the caller from view state, keeping this function pure and unit-testable. */
export interface ResolveBacklogDropInput {
    /** id of the row actually dragged (`@dnd-kit` `active.id`). */
    activeId: number;
    /** selected story ids in document order (backlog first, then sprints). */
    orderedSelectedIds: number[];
    /** the drop target resolved from `over` (a row, or a container). */
    over: BacklogDropOver;
    /** container of a story: `null` = backlog, a number = that sprint id, or
     * `undefined` when the id is unknown (guards against stale ids). */
    storyContainer: (usId: number) => number | null | undefined;
    /** ordered story ids of a container (pre-drop): `null` = backlog list. */
    containerOrderedIds: (sprintId: number | null) => number[];
}

/** The resolved move, mapped 1:1 onto `moveUs(usList, newUsIndex, newSprintId,
 * previousUs, nextUs)` by the caller (ids → `UserStory` objects). */
export interface BacklogDropResult {
    /** ids of every story that moves (single row, or the whole selection). */
    usIds: number[];
    /** insertion index within the destination container (moved rows excluded). */
    newUsIndex: number;
    /** destination sprint id, or `null` for the backlog. */
    newSprintId: number | null;
    /** the row the moved rows are inserted AFTER (legacy `previousUs`), or null. */
    previousUsId: number | null;
    /** the row the moved rows are inserted BEFORE — set ONLY when there is no
     * `previousUsId` (legacy top-of-list quirk), else null. */
    nextUsId: number | null;
}

/** Shallow equality of two id lists (order-sensitive). */
function sameOrder(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((value, index) => value === b[index]);
}

/**
 * Decide which stories move. Mirrors the legacy `window.dragMultiple` gate: the
 * whole selection moves ONLY when the dragged row is part of a multi-selection
 * (>= 2 selected); otherwise just the dragged row moves. The returned order is
 * the document order the caller supplied (matching legacy `getElements()`).
 */
export function computeMovedSet(activeId: number, orderedSelectedIds: number[]): number[] {
    const isMulti =
        orderedSelectedIds.indexOf(activeId) !== -1 && orderedSelectedIds.length > 1;
    return isMulti ? orderedSelectedIds.slice() : [activeId];
}

/**
 * Resolve a completed backlog drag, or `null` for a no-op / rejected drop.
 *
 * @param input - pre-computed primitives (see {@link ResolveBacklogDropInput}).
 * @returns the {@link BacklogDropResult}, or `null` to skip the move.
 */
export function resolveBacklogDrop(input: ResolveBacklogDropInput): BacklogDropResult | null {
    const { activeId, orderedSelectedIds, over, storyContainer, containerOrderedIds } =
        input;

    const usIds = computeMovedSet(activeId, orderedSelectedIds);
    const moved = new Set<number>(usIds);

    // --- Resolve the destination container + (optionally) the over row. --------
    let destSprintId: number | null;
    let overUsId: number | null = null;

    if (over.kind === "container") {
        destSprintId = over.sprintId;
    } else {
        overUsId = over.usId;
        // Dropped onto one of the moving rows themselves -> no-op.
        if (moved.has(overUsId)) {
            return null;
        }
        const container = storyContainer(overUsId);
        if (container === undefined) {
            return null;
        }
        destSprintId = container;
    }

    // --- Insertion index + neighbours within the destination (moved excluded). --
    const destIdsWithMoved = containerOrderedIds(destSprintId);
    const baseIds = destIdsWithMoved.filter((id) => !moved.has(id));

    let insertPos: number;
    if (over.kind === "container") {
        // Dropping onto the container body (empty sprint / whitespace) appends.
        insertPos = baseIds.length;
    } else {
        const k = baseIds.indexOf(overUsId as number);
        insertPos = k === -1 ? baseIds.length : k;
    }

    const previousUsId = insertPos > 0 ? baseIds[insertPos - 1] : null;
    // Legacy quirk: `nextUs` is populated ONLY when there is no `previousUs`.
    const nextUsId = previousUsId === null ? baseIds[insertPos] ?? null : null;

    // --- No-op guard (legacy `if index == oldIndex && sameContainer: return`). --
    const originSprintId = storyContainer(activeId) ?? null;
    if (destSprintId === originSprintId) {
        const newOrder = baseIds.slice();
        newOrder.splice(insertPos, 0, ...usIds);
        if (sameOrder(newOrder, destIdsWithMoved)) {
            return null;
        }
    }

    return {
        usIds,
        newUsIndex: insertPos,
        newSprintId: destSprintId,
        previousUsId,
        nextUsId,
    };
}
