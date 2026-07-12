/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

import { createKanbanDragEndHandler } from "./useKanbanDragEnd";
import type { KanbanDragEndContext, KanbanDropArgs } from "./types";

export interface KanbanDndProviderProps {
    context: KanbanDragEndContext;
    onDrop?: (args: KanbanDropArgs) => void;
    enabled?: boolean;
    children: ReactNode;
}

/**
 * Wraps the Kanban board subtree in a configured DndContext (PointerSensor with a
 * 5px activation distance + dnd-kit built-in autoscroll, comparable to the legacy
 * dragula `autoScroll(..., { margin: 100, scrollWhenOutside: true })`).
 *
 * This is the AAP-mandated encapsulated alternative to wiring DndContext by hand;
 * it reuses `createKanbanDragEndHandler` so drop semantics are identical to the
 * board's direct DndContext usage. When `enabled` is false the context is inert
 * (no drag-end dispatch, no autoscroll).
 */
export function KanbanDndProvider({
    context,
    onDrop,
    enabled = true,
    children,
}: KanbanDndProviderProps): ReactElement {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    );

    const handleDragEnd = useMemo(
        () => createKanbanDragEndHandler(context, onDrop ?? context.handleDragEnd),
        [context, onDrop],
    );

    return (
        <DndContext
            sensors={sensors}
            onDragEnd={enabled ? handleDragEnd : undefined}
            autoScroll={enabled}
        >
            {children}
        </DndContext>
    );
}
