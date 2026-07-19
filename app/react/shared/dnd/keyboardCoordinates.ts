/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Single-step keyboard drag-and-drop helpers for the React Backlog ([N]).
 *
 * The backlog/sprint rows are registered as BOTH `useDraggable` and
 * `useDroppable` (so a drop can land at a specific row), while the list/sprint
 * containers remain droppable too (so a drop can land in empty space). Given
 * that topology, these two helpers make keyboard DnD move an item DOWN/UP by a
 * SINGLE row per arrow press — instead of the default `KeyboardSensor`
 * behavior, which nudged the drag reference by a fixed pixel step that never
 * left the container, so the drop always resolved to the container and appended
 * the item at the END (the reported quirk).
 *
 *  - {@link rowPreferringCollisionDetection}: resolves the drop target to a ROW
 *    (numeric droppable id) whenever the dragged item overlaps one, falling back
 *    to the CONTAINER (string droppable id) only when it does not. Used for BOTH
 *    pointer and keyboard so precise reordering works either way.
 *  - {@link singleStepKeyboardCoordinates}: a self-contained
 *    `KeyboardCoordinateGetter` (no `SortableContext` required) that, per arrow
 *    press, moves the drag reference to the CENTER of the nearest adjacent row
 *    in the pressed direction — yielding one-row-per-press movement.
 *
 * Both are screen-agnostic and dependency-free beyond `@dnd-kit/core`, and are
 * only wired into the Backlog's `DndProvider` (Kanban keeps the dnd-kit
 * defaults, so its behavior is unchanged).
 */

import {
    KeyboardCode,
    closestCenter,
    closestCorners,
    getFirstCollision,
    pointerWithin,
    rectIntersection,
} from "@dnd-kit/core";
import type {
    CollisionDetection,
    DroppableContainer,
    KeyboardCoordinateGetter,
} from "@dnd-kit/core";

/** The four arrow keys we translate into single-row steps. */
const DIRECTIONS: string[] = [
    KeyboardCode.Down,
    KeyboardCode.Right,
    KeyboardCode.Up,
    KeyboardCode.Left,
];

/** True when a droppable id denotes a ROW (rows use the numeric `us.id`). */
function isRowId(id: string | number): boolean {
    return typeof id === "number";
}

/**
 * Collision detection that PREFERS row droppables over container droppables.
 *
 * Pointer drags use `pointerWithin` (the most accurate pointer strategy); for
 * keyboard drags (no pointer coordinates) `pointerWithin` yields nothing, so we
 * fall back to `rectIntersection` against the moving dragged rectangle. In
 * either case, if the dragged item overlaps one or more ROWS we return the
 * closest row center; otherwise we return the raw intersections (which will be
 * the container). The active item's own droppable is always excluded so a drag
 * never collides with itself.
 */
export const rowPreferringCollisionDetection: CollisionDetection = (args) => {
    const containersWithoutSelf = args.droppableContainers.filter(
        (container) => container.id !== args.active.id,
    );
    const scopedArgs = { ...args, droppableContainers: containersWithoutSelf };

    const pointerHits = pointerWithin(scopedArgs);
    const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(scopedArgs);

    const rowHits = hits.filter((collision) => isRowId(collision.id));
    if (rowHits.length > 0) {
        // Pick the closest row center — but ONLY among the rows the pointer/rect
        // actually hit (`rowHits`), never among every registered row. The legacy
        // `dragula` resolved the drop from the DOM element under the pointer, so a
        // backlog reorder could only ever land on a backlog row. Computing
        // `closestCenter` over ALL rows (backlog AND sprint) instead let the
        // dragged `collisionRect`'s center pull the target onto an unrelated
        // SPRINT row when the two columns sit close together (e.g. the ~800px
        // Playwright viewport): a multi-select backlog reorder toward row 0
        // silently resolved `over` to a sprint story, so the block moved INTO the
        // sprint (gained a `milestone_id`) instead of to the top of the backlog
        // ([14] "reorder multiple us"). Restricting the candidate set to the hit
        // rows preserves precise "closest of the overlapping rows" behavior while
        // guaranteeing the drop stays in the column the pointer is actually over.
        const hitRowIds = new Set<string | number>(rowHits.map((collision) => collision.id));
        const hitRowContainers = containersWithoutSelf.filter(
            (container) => isRowId(container.id) && hitRowIds.has(container.id),
        );
        const byCenter = closestCenter({ ...args, droppableContainers: hitRowContainers });
        return byCenter.length > 0 ? byCenter : rowHits;
    }

    return hits;
};

/**
 * A `KeyboardCoordinateGetter` that steps the drag reference to the nearest
 * adjacent ROW in the pressed arrow direction, giving single-row-per-press
 * movement. Only row droppables are considered (containers are excluded) so a
 * single press never jumps past the neighbouring row to the container.
 *
 * Two mechanics make repeated presses walk one row at a time reliably:
 *
 *  1. TOP-LEFT single-axis return. dnd-kit's `KeyboardSensor` derives
 *     `currentCoordinates` from `{ x: collisionRect.left, y: collisionRect.top }`
 *     and translates by `delta = newCoordinates - currentCoordinates`. Returning
 *     the target row's *centre* injected a spurious `+width/2` delta on the
 *     preserved axis — on the ~774px backlog rows that was a ~+387px HORIZONTAL
 *     drift for a vertical move, shoving the drag reference into the sprint
 *     column so the drop resolved onto a sprint row (the story silently gained a
 *     `milestone_id` and left the backlog). We therefore return the target row's
 *     top-left and only advance along the pressed axis, preserving the other.
 *
 *  2. `over`-based advancement. With a `DragOverlay`, `collisionRect` is
 *     re-derived from the overlay each press and can pin to its start position,
 *     so the nearest candidate would stay constant and the item would never move
 *     past the first adjacent row. Mirroring dnd-kit's own
 *     `sortableKeyboardCoordinates`, when the closest candidate is the row we are
 *     already `over`, we step to the next-closest collision — so each press
 *     advances exactly one further row even when `collisionRect` does not
 *     accumulate.
 *
 * Returns `undefined` (dnd-kit keeps the current position) when there is no row
 * in the pressed direction — e.g. pressing Down on the last row.
 */
export const singleStepKeyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context: { active, collisionRect, droppableRects, droppableContainers, over } },
) => {
    if (!DIRECTIONS.includes(event.code)) {
        return undefined;
    }
    // Prevent the arrow key from also scrolling the page during a keyboard drag.
    event.preventDefault();

    if (!active || !collisionRect) {
        return undefined;
    }

    // Candidate rows in the pressed direction, excluding the active row itself.
    const candidates: DroppableContainer[] = [];
    for (const entry of droppableContainers.getEnabled()) {
        if (!entry || entry.disabled) {
            continue;
        }
        if (entry.id === active.id || !isRowId(entry.id)) {
            continue;
        }
        const rect = droppableRects.get(entry.id);
        if (!rect) {
            continue;
        }
        switch (event.code) {
            case KeyboardCode.Down:
                if (rect.top > collisionRect.top) candidates.push(entry);
                break;
            case KeyboardCode.Up:
                if (rect.top < collisionRect.top) candidates.push(entry);
                break;
            case KeyboardCode.Right:
                if (rect.left > collisionRect.left) candidates.push(entry);
                break;
            case KeyboardCode.Left:
                if (rect.left < collisionRect.left) candidates.push(entry);
                break;
            default:
                break;
        }
    }

    if (candidates.length === 0) {
        return undefined;
    }

    // The nearest candidate (by corner distance) is the adjacent row.
    const collisions = closestCorners({
        active,
        collisionRect,
        droppableRects,
        droppableContainers: candidates,
        pointerCoordinates: null,
    });
    let closestId = getFirstCollision(collisions, "id");
    if (closestId == null) {
        return undefined;
    }

    // Advance PAST the row we are already hovering. dnd-kit's `over` tracks the
    // droppable currently under the drag; when the drag reference does not
    // accumulate between synchronous key presses (which happens with a
    // `DragOverlay`, where `collisionRect` is re-derived from the overlay each
    // press and can pin to its start), the nearest candidate stays constant and
    // the item would never move more than one row. Mirroring dnd-kit's own
    // `sortableKeyboardCoordinates`, when the closest candidate is the row we
    // are already `over`, we step to the next-closest collision so each arrow
    // press advances exactly one further row toward the pressed direction.
    if (closestId === over?.id && collisions.length > 1) {
        closestId = collisions[1].id;
    }

    const targetRect = droppableRects.get(closestId);
    if (!targetRect) {
        return undefined;
    }

    // Move the drag reference to the adjacent row using dnd-kit's TOP-LEFT
    // coordinate convention. The KeyboardSensor derives `currentCoordinates`
    // from `{ x: collisionRect.left, y: collisionRect.top }` and computes the
    // translation as `delta = newCoordinates - currentCoordinates`
    // (see @dnd-kit/core KeyboardSensor.handleKeyDown). Returning the target
    // row's *centre* here previously injected a spurious delta of +width/2 on
    // the axis being preserved — on the wide backlog rows (~774px) that was a
    // ~+387px HORIZONTAL drift for a vertical move, which shoved the drag
    // reference out of the backlog column and into the sprint column so the
    // drop resolved onto a sprint row (the story silently gained a
    // `milestone_id` and left the backlog). To guarantee single-axis movement
    // with zero drift we preserve the coordinate on the non-travel axis and
    // only advance along the pressed direction's axis, expressed in the same
    // top-left reference dnd-kit measures against.
    const isVertical =
        event.code === KeyboardCode.Up || event.code === KeyboardCode.Down;
    return {
        x: isVertical ? collisionRect.left : targetRect.left,
        y: isVertical ? targetRect.top : collisionRect.top,
    };
};
