/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { act, renderHook } from "@testing-library/react";

import { useKanbanSelection } from "./index";

describe("useKanbanSelection", () => {
    it("starts with an empty selection", () => {
        const { result } = renderHook(() => useKanbanSelection());

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.selectedUss).toEqual({});
        expect(result.current.isSelected(1)).toBe(false);
    });

    it("selects a card via toggleSelected", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(1);
        });

        expect(result.current.selectedIds).toEqual([1]);
        expect(result.current.selectedUss).toEqual({ 1: true });
        expect(result.current.isSelected(1)).toBe(true);
        expect(result.current.isSelected(2)).toBe(false);
    });

    it("preserves insertion order across multiple toggles", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(3);
        });
        act(() => {
            result.current.toggleSelected(1);
        });
        act(() => {
            result.current.toggleSelected(2);
        });

        expect(result.current.selectedIds).toEqual([3, 1, 2]);
        expect(result.current.selectedUss).toEqual({ 1: true, 2: true, 3: true });
    });

    it("deselects a selected card and re-adds it at the end", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(3);
        });
        act(() => {
            result.current.toggleSelected(1);
        });
        act(() => {
            result.current.toggleSelected(2);
        });

        act(() => {
            result.current.toggleSelected(1);
        });

        expect(result.current.selectedIds).toEqual([3, 2]);
        expect(result.current.isSelected(1)).toBe(false);
        expect(result.current.selectedUss[1]).toBeUndefined();

        act(() => {
            result.current.toggleSelected(1);
        });

        expect(result.current.selectedIds).toEqual([3, 2, 1]);
        expect(result.current.isSelected(1)).toBe(true);
    });

    it("clearSelection empties the whole selection", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(1);
        });
        act(() => {
            result.current.toggleSelected(2);
        });
        act(() => {
            result.current.clearSelection();
        });

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.selectedUss).toEqual({});
        expect(result.current.isSelected(1)).toBe(false);
        expect(result.current.isSelected(2)).toBe(false);
    });

    it("maps only selected ids to true so the `=== true` guard is exact", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(5);
        });

        expect(result.current.selectedUss[5]).toBe(true);
        expect(result.current.selectedUss[99]).toBeUndefined();
        // useKanbanDragEnd derives the drag set with `selectedUss[id] === true`,
        // so absent (unselected) ids must NOT satisfy the guard.
        expect(result.current.selectedUss[99] === true).toBe(false);
    });
});
