/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useMemo, useState } from "react";

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

/**
 * Multi-select state for the Kanban board.
 *
 * Replaces the legacy `window.dragMultiple` selection set and the
 * `KanbanController.selectedUss` map / `toggleSelectedUs` / `cleanSelectedUss`
 * helpers. This hook owns ONLY the selection state; drag mechanics, DOM reads
 * and API calls live elsewhere in the dnd module.
 *
 * `selectedIds` is ordered by selection (insertion) order and is used purely
 * for UI bookkeeping. The ordered multi-drag set is re-derived from the DOM in
 * `useKanbanDragEnd` (document order), so this hook never reorders it.
 */
export function useKanbanSelection(): KanbanSelectionApi {
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const toggleSelected = useCallback((usId: number): void => {
        setSelectedIds((prev) => {
            if (prev.indexOf(usId) === -1) {
                return prev.concat(usId);
            }
            return prev.filter((id) => id !== usId);
        });
    }, []);

    const clearSelection = useCallback((): void => {
        setSelectedIds([]);
    }, []);

    const isSelected = useCallback(
        (usId: number): boolean => selectedIds.indexOf(usId) !== -1,
        [selectedIds],
    );

    const selectedUss = useMemo<Record<number, boolean>>(() => {
        const map: Record<number, boolean> = {};
        for (const id of selectedIds) {
            map[id] = true;
        }
        return map;
    }, [selectedIds]);

    return { selectedIds, selectedUss, isSelected, toggleSelected, clearSelection };
}
