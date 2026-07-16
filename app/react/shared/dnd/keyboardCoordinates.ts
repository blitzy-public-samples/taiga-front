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
        const rowContainers = containersWithoutSelf.filter((container) => isRowId(container.id));
        const byCenter = closestCenter({ ...args, droppableContainers: rowContainers });
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
 * Returns `undefined` (dnd-kit keeps the current position) when there is no row
 * in the pressed direction — e.g. pressing Down on the last row.
 */
export const singleStepKeyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context: { active, collisionRect, droppableRects, droppableContainers } },
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
    const closestId = getFirstCollision(collisions, "id");
    if (closestId == null) {
        return undefined;
    }

    const targetRect = droppableRects.get(closestId);
    if (!targetRect) {
        return undefined;
    }

    // Move the drag reference to the centre of the adjacent row so the collision
    // detection resolves the drop onto that exact row (single-step).
    return {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.top + targetRect.height / 2,
    };
};
