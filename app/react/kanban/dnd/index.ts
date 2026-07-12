/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Card draggable hook
export { useCardDraggable } from "./useCardDraggable";
export type { CardDraggableResult, UseCardDraggableOptions } from "./useCardDraggable";

// Column / swimlane-cell droppable hook
export { useColumnDroppable } from "./useColumnDroppable";
export type { ColumnDroppableResult, UseColumnDroppableArgs } from "./useColumnDroppable";

// Multi-select state hook (replaces window.dragMultiple)
export { useKanbanSelection } from "./useKanbanSelection";

// Drag-end orchestration (the glue)
export { createKanbanDragEndHandler, useKanbanDragEnd } from "./useKanbanDragEnd";

// Encapsulated DndContext provider (AAP-mandated)
export { KanbanDndProvider } from "./KanbanDndProvider";
export type { KanbanDndProviderProps } from "./KanbanDndProvider";

// Pure drop-descriptor resolution
export { computeMovedSet, resolveKanbanDrop } from "./resolveDrop";
export type { DropOrigin, DropTarget, ResolveKanbanDropInput } from "./resolveDrop";

// DOM geometry helpers
export {
    computeDropPointerY,
    computeInsertionIndex,
    findColumnElement,
    getCardMidpointY,
    readCardIdsInDomOrder,
    readColumnOrderedIds,
} from "./domGeometry";

// Shared dnd types
export type {
    CardDraggableData,
    ColumnDroppableData,
    KanbanDragEndContext,
    KanbanDropArgs,
    KanbanSelectionApi,
} from "./types";
