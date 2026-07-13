/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { DragEndEvent } from "@dnd-kit/core";

import {
    computeDropPointerY,
    computeInsertionIndex,
    findColumnElement,
    readCardIdsInDomOrder,
    readColumnOrderedIds,
} from "./domGeometry";
import { computeMovedSet, resolveKanbanDrop } from "./resolveDrop";
import type {
    ColumnDroppableData,
    KanbanDragEndContext,
    KanbanDropArgs,
} from "./types";

/**
 * Builds the Kanban board's `onDragEnd` handler, reproducing the legacy
 * sortable.coffee `drop` + `dragend` algorithm on top of @dnd-kit/core.
 *
 * Division of labour: this glue computes ONE KanbanDropArgs descriptor and hands
 * it to `onDrop` exactly once (or not at all for a no-op / invalid drop). It never
 * maps swimlane -1 -> null and never calls the API — the board wires `onDrop` to
 * the hook's `move()`, which performs the -1 -> null mapping and the single
 * `bulkUpdateKanbanOrder` request.
 *
 * @dnd-kit note: in `onDragEnd`, `event.active.rect` is unreliable (null), so the
 * drop position is derived from the dragged card's live DOM midpoint + `delta.y`
 * via `computeDropPointerY` (domGeometry) — never from `event.active.rect`.
 */
export function createKanbanDragEndHandler(
    context: KanbanDragEndContext,
    onDrop: (args: KanbanDropArgs) => void,
): (event: DragEndEvent) => void {
    return (event: DragEndEvent): void => {
        const { active, over, delta } = event;

        // Dropped outside every column (legacy: no target container) -> no move.
        if (over === null) {
            return;
        }

        const overData = over.data.current as ColumnDroppableData | undefined;

        if (overData === undefined || overData.type !== "column") {
            return;
        }

        const activeId = Number(active.id);

        if (Number.isNaN(activeId)) {
            return;
        }

        const activeStory = context.usMap[activeId];

        if (activeStory === undefined) {
            return;
        }

        const target = { statusId: overData.statusId, swimlaneId: overData.swimlaneId };
        const originStatusId = activeStory.status;
        const originSwimlaneId = activeStory.swimlane;

        // Ordered multi-drag set in DOM document order (legacy
        // window.dragMultiple.getElements()), restricted to the current selection.
        // `=== true` because legacy cleanSelectedUss sets entries to false, not delete.
        const orderedSelectedIds = readCardIdsInDomOrder().filter(
            (id) => context.selectedUss[id] === true,
        );
        const movedIds = computeMovedSet(activeId, orderedSelectedIds);

        // Origin insertion index = non-moved cards above the dragged card's ORIGINAL
        // position (delta 0). Measured on the SAME basis as the target insertion index
        // so a drop-in-place yields index === origin.index (no-op guard) for both
        // single- and multi-select.
        const originColumnEl = findColumnElement(originStatusId, originSwimlaneId);
        const originIndex =
            originColumnEl === null
                ? 0
                : computeInsertionIndex(
                      originColumnEl,
                      computeDropPointerY(activeId, 0),
                      movedIds,
                  );

        // Target column + insertion index via the null-rect workaround.
        const targetColumnEl = findColumnElement(target.statusId, target.swimlaneId);

        if (targetColumnEl === null) {
            return;
        }

        const targetOrderedIds = readColumnOrderedIds(targetColumnEl);
        const insertionIndex = computeInsertionIndex(
            targetColumnEl,
            computeDropPointerY(activeId, delta.y),
            movedIds,
        );

        const result = resolveKanbanDrop({
            activeId,
            orderedSelectedIds,
            target,
            origin: {
                statusId: originStatusId,
                swimlaneId: originSwimlaneId,
                index: originIndex,
            },
            targetOrderedIds,
            insertionIndex,
        });

        // Exactly one dispatch, or none for a no-op / unresolved drop.
        if (result !== null) {
            onDrop(result);
        }
    };
}
