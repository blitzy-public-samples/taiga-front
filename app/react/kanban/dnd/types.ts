/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { UserStory, Swimlane } from "../../shared/types";

/**
 * Drop descriptor produced by the Kanban drag-and-drop layer on a completed
 * drag. Its fields map ONE-TO-ONE (name + order) onto the `shared/state`
 * `move(state, usList, statusId, swimlaneId, index, previousCard, nextCard)`
 * parameters, so the board can forward it straight to `kb.handleDragEnd(args)`.
 *
 * `swimlaneId` carries the RAW droppable value: `null` in non-swimlane mode,
 * a real swimlane id in swimlane mode, or `-1` for the synthetic "unclassified"
 * swimlane. The board/hook layer is responsible for mapping `-1 -> null` before
 * the API call (legacy `KanbanController.moveUs`); this layer never remaps it.
 *
 * `previousCard` ALWAYS takes priority over `nextCard`: `nextCard` is non-null
 * only when `previousCard` is null (legacy `sortable.coffee` drop handler).
 */
export interface KanbanDropArgs {
    usList: number[];
    statusId: number;
    swimlaneId: number | null;
    index: number;
    previousCard: number | null;
    nextCard: number | null;
}

/**
 * Structural subset of the `useKanbanStories` (`kb`) return that the drag-end
 * handler consumes. Declared structurally so this folder does not depend on the
 * separately-authored `kanban/hooks/useKanbanStories.ts`; the full `kb` object
 * (with additional members) stays assignable to this type.
 *
 * - `usByStatus`: String(statusId) -> ordered userstory ids (non-swimlane view).
 * - `usByStatusSwimlanes`: String(swimlaneId) -> String(statusId) -> ordered ids
 *   (swimlane view; the unclassified swimlane is keyed "-1").
 * - `usMap`: userstory id -> raw UserStory (origin status/swimlane come from here).
 * - `selectedUss`: userstory id -> selected? (values may be `false`; test `=== true`).
 * - `swimlanesList`: configured swimlanes; empty array means non-swimlane mode.
 * - `handleDragEnd`: the single sink the resolved drop is forwarded to (called
 *   exactly once per non-no-op drop).
 */
export interface KanbanDragEndContext {
    usByStatus: Record<string, number[]>;
    usByStatusSwimlanes: Record<string, Record<string, number[]>>;
    usMap: Record<number, UserStory>;
    selectedUss: Record<number, boolean>;
    swimlanesList: Swimlane[];
    handleDragEnd: (args: KanbanDropArgs) => void;
}

/**
 * `data` payload attached to a `@dnd-kit/core` `useDraggable` for one `tg-card`.
 * Read back off `event.active.data.current` in the drag-end handler.
 */
export interface CardDraggableData {
    type: "card";
    usId: number;
}

/**
 * `data` payload attached to a `@dnd-kit/core` `useDroppable` for one status
 * column (non-swimlane) or one swimlane x status cell. Read back off
 * `event.over.data.current` to resolve the drop target. `swimlaneId` is `null`
 * in non-swimlane mode, a real id in swimlane mode, or `-1` for unclassified.
 */
export interface ColumnDroppableData {
    type: "column";
    statusId: number;
    swimlaneId: number | null;
}

/**
 * Public API of the `useKanbanSelection` hook — the multi-select state that
 * replaces the legacy `window.dragMultiple` + controller `selectedUss` map.
 *
 * - `selectedIds`: currently-selected ids in insertion (click) order.
 * - `selectedUss`: id -> selected? map mirroring the legacy shape (a de-selected
 *   id may map to `false` rather than being removed).
 * - `isSelected`: true only when the id is currently selected.
 * - `toggleSelected`: ctrl/meta-click toggle of one card into/out of selection.
 * - `clearSelection`: drop all selections (legacy `cleanSelectedUss`).
 */
export interface KanbanSelectionApi {
    selectedIds: number[];
    selectedUss: Record<number, boolean>;
    isSelected: (usId: number) => boolean;
    toggleSelected: (usId: number) => void;
    clearSelection: () => void;
}
