/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {
    Announcements,
    DragCancelEvent,
    DragEndEvent,
    DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { createKanbanDragEndHandler } from "./useKanbanDragEnd";
import type { KanbanDragEndContext, KanbanDropArgs } from "./types";

export interface KanbanDndProviderProps {
    context: KanbanDragEndContext;
    onDrop?: (args: KanbanDropArgs) => void;
    enabled?: boolean;
    /**
     * Renders the `<DragOverlay>` mirror for the currently-dragged card (C3).
     * The board supplies a lightweight `<tg-card class="gu-mirror">` clone so
     * the drag has a visible, pointer-following affordance WITHOUT translating
     * the source element (which would break `domGeometry.computeDropPointerY`
     * and diverge from the legacy dragula `.gu-transit` + `.gu-mirror` model).
     * When omitted the overlay renders nothing (drag still works; no mirror).
     */
    renderOverlay?: (activeId: number) => ReactNode;
    children: ReactNode;
}

/**
 * The SINGLE, tested Kanban drag-and-drop provider (finding M6).
 *
 * `KanbanBoard` renders THIS provider rather than wiring `DndContext` by hand,
 * so there is exactly one production drag path (no dead/duplicate config, no
 * bypass of the tested glue). It reproduces the legacy dragula behavior on top
 * of `@dnd-kit/core`:
 *
 *   - `PointerSensor` with a 5px activation distance (the dragula grab
 *     threshold) PLUS a `KeyboardSensor` (C3) so a card can be picked up,
 *     moved and dropped with the keyboard alone.
 *   - `autoScroll` (dnd-kit built-in) mirrors the legacy
 *     `autoScroll(..., { margin: 100, scrollWhenOutside: true })`.
 *   - A `<DragOverlay>` (C3) renders a `.gu-mirror` clone that follows the
 *     pointer — the legacy dragula mirror — while the source `<tg-card>` stays
 *     in place (StatusColumn/Card mark it `.gu-transit`).
 *   - Screen-reader `announcements` (C3 / a11y) describe pick-up, move-over and
 *     drop, keyed by the story subject read from `context.usMap`.
 *
 * The drag-end handler is STABILISED against context churn (M6): `context`,
 * `onDrop` and `renderOverlay` are the `useKanbanStories` return whose identity
 * changes every render, so the callbacks passed to `DndContext` read the LATEST
 * values through refs and keep a constant identity (`useCallback([])`) — the
 * `DndContext` subscription is not torn down and rebuilt on every board render.
 * Drop semantics are delegated to `createKanbanDragEndHandler`, so exactly one
 * `KanbanDropArgs` is dispatched per non-no-op drop (or none).
 *
 * When `enabled` is false the context is inert: no drag-start/-end/-cancel
 * dispatch, no autoscroll, and no overlay.
 */
export function KanbanDndProvider({
    context,
    onDrop,
    enabled = true,
    renderOverlay,
    children,
}: KanbanDndProviderProps): ReactElement {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor),
    );

    // "Latest value" refs so the DndContext callbacks stay identity-stable
    // across renders while always operating on the current context/onDrop.
    const contextRef = useRef(context);
    contextRef.current = context;
    const onDropRef = useRef(onDrop);
    onDropRef.current = onDrop;
    const renderOverlayRef = useRef(renderOverlay);
    renderOverlayRef.current = renderOverlay;

    // Id of the card currently being dragged (drives the DragOverlay mirror).
    const [activeId, setActiveId] = useState<number | null>(null);

    const handleDragStart = useCallback((event: DragStartEvent): void => {
        const id = Number(event.active.id);
        setActiveId(Number.isNaN(id) ? null : id);
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent): void => {
        setActiveId(null);
        const ctx = contextRef.current;
        const drop = onDropRef.current ?? ctx.handleDragEnd;
        createKanbanDragEndHandler(ctx, drop)(event);
    }, []);

    const handleDragCancel = useCallback((_event: DragCancelEvent): void => {
        setActiveId(null);
    }, []);

    // Screen-reader messages (C3). `subjectOf` names the story so the messages
    // are meaningful; it falls back to the id when the subject is unavailable.
    const announcements: Announcements = {
        onDragStart({ active }) {
            return `Picked up user story ${subjectOf(contextRef.current, active.id)}.`;
        },
        onDragOver({ active, over }) {
            if (over) {
                return `User story ${subjectOf(contextRef.current, active.id)} is over a drop target.`;
            }
            return `User story ${subjectOf(contextRef.current, active.id)} is no longer over a drop target.`;
        },
        onDragEnd({ active, over }) {
            if (over) {
                return `User story ${subjectOf(contextRef.current, active.id)} was dropped.`;
            }
            return `User story ${subjectOf(contextRef.current, active.id)} was dropped outside a column.`;
        },
        onDragCancel({ active }) {
            return `Dragging user story ${subjectOf(contextRef.current, active.id)} was cancelled.`;
        },
    };

    return (
        <DndContext
            sensors={sensors}
            onDragStart={enabled ? handleDragStart : undefined}
            onDragEnd={enabled ? handleDragEnd : undefined}
            onDragCancel={enabled ? handleDragCancel : undefined}
            autoScroll={enabled}
            accessibility={{ announcements }}
        >
            {children}
            {enabled ? (
                <DragOverlay>
                    {activeId !== null && renderOverlayRef.current
                        ? renderOverlayRef.current(activeId)
                        : null}
                </DragOverlay>
            ) : null}
        </DndContext>
    );
}

/** Resolve a story's subject for an accessibility announcement (id fallback). */
function subjectOf(context: KanbanDragEndContext, id: number | string): string {
    const numericId = Number(id);
    const story = Number.isNaN(numericId) ? undefined : context.usMap[numericId];
    const subject = story?.subject;
    if (typeof subject === "string" && subject.trim().length > 0) {
        return subject;
    }
    return `#${id}`;
}
