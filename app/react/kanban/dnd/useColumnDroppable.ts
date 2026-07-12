/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useDroppable } from "@dnd-kit/core";

import type { ColumnDroppableData } from "./types";

export interface UseColumnDroppableArgs {
    statusId: number;
    swimlaneId: number | null;
    disabled?: boolean;
}

export type ColumnDroppableResult = Pick<
    ReturnType<typeof useDroppable>,
    "setNodeRef" | "isOver"
>;

/**
 * Droppable wiring for one Kanban column (a status column in non-swimlane mode,
 * or a swimlane x status cell in swimlane mode), keyed by { statusId, swimlaneId }.
 *
 * Reproduces the legacy dragula containers: non-swimlane = `.taskboard-column`,
 * swimlane = `.kanban-swimlane[data-swimlane] .taskboard-column`. Because swimlane
 * columns share the same status id across swimlanes, the droppable id MUST encode
 * BOTH ids to stay unique per cell.
 *
 * `StatusColumn` assigns `setNodeRef` on the root `.taskboard-column` element and
 * adds the `target-drop` class when `isOver` (matching the legacy hover affordance).
 * The `data` payload is surfaced to the drag-end handler as `event.over.data.current`.
 * The raw `swimlaneId` (including -1 for the unclassified cell) is carried unchanged;
 * the -1 -> null API mapping happens later in the hook layer, not here.
 */
export function useColumnDroppable(args: UseColumnDroppableArgs): ColumnDroppableResult {
    const { statusId, swimlaneId, disabled } = args;

    const data: ColumnDroppableData = { type: "column", statusId, swimlaneId };

    const { setNodeRef, isOver } = useDroppable({
        id: `column:${statusId}:${swimlaneId ?? "none"}`,
        disabled: disabled ?? false,
        data,
    });

    return { setNodeRef, isOver };
}
