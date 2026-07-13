/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react unit tests for {@link useKanbanSelection}.
 *
 * `useKanbanSelection` is the React reproduction of the legacy Kanban
 * multi-select state: the AngularJS `window.dragMultiple` selection set plus the
 * `KanbanController.selectedUss` map / `toggleSelectedUs` / `cleanSelectedUss`
 * helpers (`app/coffee/modules/kanban/main.coffee`,
 * `app/coffee/modules/kanban/dragula-drag-multiple.js`).
 *
 * The hook owns ONLY the selection state (no drag mechanics, DOM reads, or API
 * calls), so these tests are pure state assertions. They intentionally cover
 * EVERY branch so the file is fully exercised for the repo-wide >= 70% line
 * coverage gate:
 *   - the empty initial state,
 *   - `toggleSelected` add path (`indexOf === -1` -> `concat`),
 *   - `toggleSelected` remove path (`indexOf !== -1` -> `filter`),
 *   - insertion (click) ordering, including re-selection appending at the END,
 *   - the `selectedUss` `useMemo` derivation (selected -> `true`, others ABSENT),
 *   - `clearSelection` resetting to empty,
 *   - `isSelected` true / false results,
 *   - the STABLE identities of `toggleSelected` / `clearSelection` across
 *     renders (functional-updater form with `[]` deps).
 *
 * Conventions (matching the sibling React tests):
 *   - Ambient Jest globals (`describe`/`it`/`expect`) are used directly (provided
 *     by @types/jest); they are intentionally NOT imported.
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - `@testing-library/jest-dom` matchers are registered globally by
 *     `jest.setup.ts`.
 */

import { act, renderHook } from "@testing-library/react";

import { useKanbanSelection } from "./useKanbanSelection";

describe("useKanbanSelection", () => {
    it("starts empty: no ids, empty map, nothing selected", () => {
        const { result } = renderHook(() => useKanbanSelection());

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.selectedUss).toEqual({});
        expect(result.current.isSelected(1)).toBe(false);
    });

    it("toggleSelected adds an id and marks it selected (indexOf === -1 -> concat)", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(7);
        });

        expect(result.current.selectedIds).toEqual([7]);
        expect(result.current.isSelected(7)).toBe(true);
        expect(result.current.selectedUss).toEqual({ 7: true });
    });

    it("toggleSelected twice removes the id, which is then ABSENT (indexOf !== -1 -> filter)", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(7);
        });
        act(() => {
            result.current.toggleSelected(7);
        });

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.isSelected(7)).toBe(false);
        expect(result.current.selectedUss).toEqual({});
        // De-selected ids are ABSENT from the map, never mapped to `false`, so
        // the downstream `selectedUss[id] === true` guard stays correct.
        expect(result.current.selectedUss).not.toHaveProperty("7");
    });

    it("preserves insertion order and appends a re-selected id at the END", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(1);
        });
        act(() => {
            result.current.toggleSelected(2);
        });
        act(() => {
            result.current.toggleSelected(3);
        });
        expect(result.current.selectedIds).toEqual([1, 2, 3]);

        // De-select the middle id: it is removed and the order of the rest holds.
        act(() => {
            result.current.toggleSelected(2);
        });
        expect(result.current.selectedIds).toEqual([1, 3]);

        // Re-select it: appended at the END (insertion order; the original slot
        // is NOT preserved).
        act(() => {
            result.current.toggleSelected(2);
        });
        expect(result.current.selectedIds).toEqual([1, 3, 2]);
        expect(result.current.selectedUss).toEqual({ 1: true, 3: true, 2: true });
    });

    it("selectedUss maps only selected ids to true; unselected ids are undefined/absent", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(10);
        });
        act(() => {
            result.current.toggleSelected(20);
        });

        expect(result.current.selectedUss[10]).toBe(true);
        expect(result.current.selectedUss[20]).toBe(true);
        expect(result.current.selectedUss[30]).toBeUndefined();
        expect(result.current.selectedUss).not.toHaveProperty("30");
        // The exact guard used by `useKanbanDragEnd`: absent -> `undefined !== true`.
        expect(result.current.selectedUss[30] === true).toBe(false);
    });

    it("clearSelection drops all selections (legacy cleanSelectedUss)", () => {
        const { result } = renderHook(() => useKanbanSelection());

        act(() => {
            result.current.toggleSelected(1);
        });
        act(() => {
            result.current.toggleSelected(2);
        });
        expect(result.current.selectedIds).toEqual([1, 2]);

        act(() => {
            result.current.clearSelection();
        });

        expect(result.current.selectedIds).toEqual([]);
        expect(result.current.selectedUss).toEqual({});
        expect(result.current.isSelected(1)).toBe(false);
        expect(result.current.isSelected(2)).toBe(false);
    });

    it("keeps STABLE identities for toggleSelected and clearSelection across renders", () => {
        const { result } = renderHook(() => useKanbanSelection());

        const toggleAtFirstRender = result.current.toggleSelected;
        const clearAtFirstRender = result.current.clearSelection;

        act(() => {
            result.current.toggleSelected(1);
        });
        expect(result.current.toggleSelected).toBe(toggleAtFirstRender);
        expect(result.current.clearSelection).toBe(clearAtFirstRender);

        act(() => {
            result.current.clearSelection();
        });
        expect(result.current.toggleSelected).toBe(toggleAtFirstRender);
        expect(result.current.clearSelection).toBe(clearAtFirstRender);
    });

    it("isSelected reflects the latest state (true then false)", () => {
        const { result } = renderHook(() => useKanbanSelection());

        expect(result.current.isSelected(5)).toBe(false);

        act(() => {
            result.current.toggleSelected(5);
        });
        expect(result.current.isSelected(5)).toBe(true);

        act(() => {
            result.current.toggleSelected(5);
        });
        expect(result.current.isSelected(5)).toBe(false);
    });
});
