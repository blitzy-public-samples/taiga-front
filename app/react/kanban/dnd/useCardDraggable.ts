/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useDraggable } from "@dnd-kit/core";

import type { CardDraggableData } from "./types";

export interface UseCardDraggableOptions {
    disabled?: boolean;
}

export type CardDraggableResult = Pick<
    ReturnType<typeof useDraggable>,
    "setNodeRef" | "attributes" | "listeners" | "isDragging"
>;

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
 * source itself (C-1). No `transform` is returned: cards are not CSS-translated
 * during drag — the affordance comes from dnd-kit state + the existing theme.
 */
export function useCardDraggable(
    usId: number,
    options?: UseCardDraggableOptions,
): CardDraggableResult {
    const data: CardDraggableData = { type: "card", usId };

    const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
        id: usId,
        disabled: options?.disabled ?? false,
        data,
    });

    return { setNodeRef, attributes, listeners, isDragging };
}
