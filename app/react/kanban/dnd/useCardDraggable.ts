/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useDraggable } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";

import type { CardDraggableData } from "./types";

export interface UseCardDraggableOptions {
    disabled?: boolean;
}

export type CardDraggableResult = Pick<
    ReturnType<typeof useDraggable>,
    "setNodeRef" | "attributes" | "listeners" | "isDragging"
> & {
    /**
     * The live drag transform reported by dnd-kit (C3). It is SURFACED here so
     * the hook is a faithful, complete wrapper over `useDraggable` — but the
     * source `<tg-card>` deliberately does NOT apply it as a CSS translate.
     *
     * Rationale (legacy-parity + geometry-safety): dragula never moved the
     * source element; it left a dimmed `.gu-transit` placeholder in place and
     * flew a separate `.gu-mirror` clone with the pointer. The React screens
     * reproduce that exact model with a `<DragOverlay>` (see KanbanDndProvider),
     * so the visible motion comes from the overlay mirror, not the source.
     * Translating the source would ALSO break the drop-position math in
     * `domGeometry.computeDropPointerY`, which relies on the dragged card
     * remaining at its origin midpoint (origin + delta.y). A consumer that does
     * NOT use a DragOverlay may still apply this transform itself.
     */
    transform: Transform | null;
};

/**
 * Draggable wiring for a single Kanban `tg-card`, keyed by user-story id.
 *
 * Reproduces the legacy dragula `moves: (item) => $(item).is('tg-card')` rule:
 * only cards are draggable. `Card` spreads the returned `attributes` +
 * `listeners` and assigns `setNodeRef` on the root `<tg-card>` (no wrapper DOM,
 * so SCSS/e2e selectors are preserved).
 *
 * Permission gating (modify_us / archived_code / per-card archived) is decided
 * by the board and passed in as `disabled`; this hook never reads a permission
 * source itself (C-1). The dnd-kit `transform` IS surfaced (C3) for a faithful
 * wrapper surface; the source card is not itself translated (a `<DragOverlay>`
 * mirror provides the visible motion — see the hook return type doc).
 */
export function useCardDraggable(
    usId: number,
    options?: UseCardDraggableOptions,
): CardDraggableResult {
    const data: CardDraggableData = { type: "card", usId };

    const { setNodeRef, attributes, listeners, isDragging, transform } = useDraggable({
        id: usId,
        disabled: options?.disabled ?? false,
        data,
    });

    return { setNodeRef, attributes, listeners, isDragging, transform };
}
