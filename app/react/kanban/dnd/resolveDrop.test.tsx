/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest unit tests for the pure Kanban drop-resolution logic in
 * {@link resolveKanbanDrop} and its {@link computeMovedSet} helper
 * (`app/react/kanban/dnd/resolveDrop.ts`).
 *
 * These functions are the React reproduction of the legacy dragula drop /
 * dragend handler in `app/coffee/modules/kanban/sortable.coffee` plus the
 * `window.dragMultiple` multi-select set from `app/js/dragula-drag-multiple.js`.
 * They are intentionally PURE (no DOM, no React render, no `@dnd-kit` runtime):
 * the caller (`createKanbanDragEndHandler`) pre-computes every primitive from board state
 * and DOM geometry, so the whole drop semantics can be locked with plain value
 * assertions. That keeps these tests fast and lets them contribute real covered
 * lines toward the repo-wide >= 70% Jest line-coverage gate.
 *
 * The legacy behaviour these tests pin (see `sortable.coffee` drop handler):
 *   - the target column's "remaining" cards are the ordered ids MINUS the moved
 *     set (legacy `tg-card:not(.gu-transit)`),
 *   - `previousCard` is the nearest PRECEDING remaining card and ALWAYS takes
 *     priority; `nextCard` is the nearest FOLLOWING remaining card and is set
 *     ONLY when there is no `previousCard`,
 *   - a drop is a no-op (returns `null`) when the target container equals the
 *     origin container AND the resolved index equals the origin index,
 *   - `null` (non-swimlane) and `-1` (unclassified swimlane) collapse to the
 *     SAME container bucket for the no-op comparison, while the returned
 *     `swimlaneId` is passed through RAW (the `-1 -> null` API remap happens
 *     later, in the hook/controller layer, never here),
 *   - the whole multi-selection moves ONLY when the dragged card is part of a
 *     selection of two or more (DOM order preserved); otherwise just the dragged
 *     card moves.
 *
 * Conventions (matching the sibling React specs in this folder):
 *   - Ambient Jest globals (`describe`/`it`/`expect`) are used directly (they
 *     come from `@types/jest` via the root `tsconfig.json` `types` array); they
 *     are intentionally NOT imported from `@jest/globals`.
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - `resolveKanbanDrop` is imported through the `./index` BARREL so the
 *     barrel's `export { resolveKanbanDrop } from "./resolveDrop"` line is
 *     exercised too; `computeMovedSet` and the input type come straight from
 *     `./resolveDrop`, and the result type from `./types`.
 */

import { resolveKanbanDrop } from "./index";
import { computeMovedSet, type ResolveKanbanDropInput } from "./resolveDrop";
import type { KanbanDropArgs } from "./types";

/**
 * Build a `ResolveKanbanDropInput` from a set of defaults, so each test only
 * spells out the primitives it actually varies. Defaults describe a same-status
 * (status 10, non-swimlane) drag of card 1 to the front of an EMPTY target
 * column with no multi-selection.
 */
const makeInput = (overrides: Partial<ResolveKanbanDropInput> = {}): ResolveKanbanDropInput => ({
    activeId: 1,
    orderedSelectedIds: [],
    target: { statusId: 10, swimlaneId: null },
    origin: { statusId: 10, swimlaneId: null, index: 0 },
    targetOrderedIds: [],
    insertionIndex: 0,
    ...overrides,
});

/**
 * Build the expected `KanbanDropArgs` from the most common shape (status 10,
 * non-swimlane, front drop with nothing to anchor to), overriding only the
 * fields a given case asserts. Typing it as `KanbanDropArgs` also keeps the
 * `./types` import meaningfully USED under `noUnusedLocals`/strict.
 */
const makeExpected = (overrides: Partial<KanbanDropArgs> = {}): KanbanDropArgs => ({
    usList: [1],
    statusId: 10,
    swimlaneId: null,
    index: 0,
    previousCard: null,
    nextCard: null,
    ...overrides,
});

describe("computeMovedSet (window.dragMultiple gate reproduction)", () => {
    it("moves ONLY the dragged card when it is NOT part of the selection", () => {
        // Others are selected, but the dragged card (3) is not -> single move.
        expect(computeMovedSet(3, [1, 2])).toEqual([3]);
    });

    it("moves the WHOLE selection (DOM order preserved) when the dragged card is in a multi-selection", () => {
        // Dragged card 2 is selected and the selection has >= 2 -> whole set,
        // in the exact DOM order the caller supplied (matching getElements()).
        expect(computeMovedSet(2, [1, 2, 5])).toEqual([1, 2, 5]);
    });

    it("moves ONLY the dragged card when it is the SOLE selected card (length 1 is not multi)", () => {
        // A selection of exactly one (== the dragged card) is NOT a multi-drag.
        expect(computeMovedSet(1, [1])).toEqual([1]);
    });

    it("falls back to just the dragged card when the selection is empty", () => {
        expect(computeMovedSet(7, [])).toEqual([7]);
    });

    it("returns a COPY of the selection (not the same array reference) on a multi-move", () => {
        const arr = [1, 2];
        const result = computeMovedSet(1, arr);

        expect(result).toEqual([1, 2]);
        // A defensive copy protects the caller's selection array from mutation.
        expect(result).not.toBe(arr);
    });
});

describe("resolveKanbanDrop", () => {
    describe("insertion anchoring (previousCard priority over nextCard)", () => {
        it("front drop: no previousCard -> nextCard is the first remaining card", () => {
            // Cross-status drop of card 3 to the FRONT of column [1, 2].
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 3,
                    target: { statusId: 10, swimlaneId: null },
                    origin: { statusId: 20, swimlaneId: null, index: 0 },
                    targetOrderedIds: [1, 2],
                    insertionIndex: 0,
                }),
            );

            // index 0 -> previousCard null -> nextCard = remaining[0] (= 1).
            expect(result).toEqual(makeExpected({ usList: [3], nextCard: 1 }));
        });

        it("mid drop: previousCard takes priority so nextCard stays null even though a following card exists", () => {
            // Drop card 4 (from another status) into [1, 2, 3] so it sits after 1.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 4,
                    target: { statusId: 10, swimlaneId: null },
                    origin: { statusId: 20, swimlaneId: null, index: 0 },
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            // previousCard = 1 -> nextCard MUST be null despite 2 following it.
            expect(result).toEqual(makeExpected({ usList: [4], index: 1, previousCard: 1 }));
            // Explicit priority assertion for documentation.
            expect(result?.previousCard).toBe(1);
            expect(result?.nextCard).toBeNull();
        });

        it("end drop: anchors to the last remaining card as previousCard", () => {
            // Drop card 9 at the very end of [1, 2].
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 9,
                    targetOrderedIds: [1, 2],
                    insertionIndex: 2,
                }),
            );

            expect(result).toEqual(makeExpected({ usList: [9], index: 2, previousCard: 2 }));
        });
    });

    describe("moved cards are excluded from the remaining anchors", () => {
        it("same-status reorder: the dragged card itself is not counted as a neighbour", () => {
            // Reorder card 1 within [1, 2, 3] to sit after 2. Because 1 is removed
            // from `remaining` (-> [2, 3]), index 1 anchors on previousCard 2.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 1,
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            expect(result).toEqual(makeExpected({ usList: [1], index: 1, previousCard: 2 }));
            expect(result?.previousCard).toBe(2);
            expect(result?.nextCard).toBeNull();
        });

        it("multi-select move: the whole set moves (DOM order) and every moved id is excluded from prev/next", () => {
            // Selection [1, 2] dragged into [1, 2, 3, 4]. remaining = [3, 4].
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 2,
                    orderedSelectedIds: [1, 2],
                    targetOrderedIds: [1, 2, 3, 4],
                    insertionIndex: 1,
                }),
            );

            // usList preserves DOM order; index 1 anchors on the non-moved card 3.
            expect(result).toEqual(makeExpected({ usList: [1, 2], index: 1, previousCard: 3 }));
            expect(result?.usList).toEqual([1, 2]);
        });
    });

    describe("no-op guard (same container + same index -> null)", () => {
        it("returns null when the drop lands back on the origin container at the origin index", () => {
            // Card 2 dropped in status 10 at index 1, and it originated at index 1
            // in status 10 -> nothing to persist.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 2,
                    target: { statusId: 10, swimlaneId: null },
                    origin: { statusId: 10, swimlaneId: null, index: 1 },
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            expect(result).toBeNull();
        });

        it("is NOT a no-op when the container differs, even at the same index", () => {
            // Same index 1 but target status 20 != origin status 10 -> a real move.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 5,
                    target: { statusId: 20, swimlaneId: null },
                    origin: { statusId: 10, swimlaneId: null, index: 1 },
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            expect(result).not.toBeNull();
            expect(result?.statusId).toBe(20);
        });
    });

    describe("swimlane container normalization (null and -1 collapse to one bucket)", () => {
        it("treats target swimlane -1 and origin swimlane null as the SAME container -> no-op null", () => {
            // The unclassified swimlane (-1) and the non-swimlane column (null)
            // normalize to the same bucket key, so with a matching index this is
            // a no-op.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 2,
                    target: { statusId: 10, swimlaneId: -1 },
                    origin: { statusId: 10, swimlaneId: null, index: 1 },
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            // Documents that null and -1 are one and the same container bucket.
            expect(result).toBeNull();
        });

        it("treats a real swimlane (5) and swimlane null as DIFFERENT containers -> not a no-op", () => {
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 2,
                    target: { statusId: 10, swimlaneId: 5 },
                    origin: { statusId: 10, swimlaneId: null, index: 1 },
                    targetOrderedIds: [1, 2, 3],
                    insertionIndex: 1,
                }),
            );

            expect(result).not.toBeNull();
        });
    });

    describe("swimlaneId passthrough (no -1 -> null remap in this layer)", () => {
        it("returns the RAW swimlaneId (-1) unchanged on a real move", () => {
            // Cross-status so it is not a no-op; the -1 must survive verbatim.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 5,
                    target: { statusId: 20, swimlaneId: -1 },
                    origin: { statusId: 10, swimlaneId: null, index: 0 },
                    targetOrderedIds: [1, 2],
                    insertionIndex: 0,
                }),
            );

            expect(result).not.toBeNull();
            // NOT remapped to null here (the hook/controller layer does that).
            expect(result!.swimlaneId).toBe(-1);
        });
    });

    describe("insertionIndex clamping", () => {
        it("clamps an out-of-range high index down to remaining.length (end drop)", () => {
            // insertionIndex 99 with a 2-card column clamps to index 2.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 9,
                    targetOrderedIds: [1, 2],
                    insertionIndex: 99,
                }),
            );

            expect(result).toEqual(makeExpected({ usList: [9], index: 2, previousCard: 2 }));
        });

        it("clamps a negative index up to 0 (front drop)", () => {
            // Cross-status origin so the clamped index 0 is not read as a no-op.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 9,
                    origin: { statusId: 20, swimlaneId: null, index: 0 },
                    targetOrderedIds: [1, 2],
                    insertionIndex: -5,
                }),
            );

            // index 0 -> front drop -> previousCard null, nextCard first remaining.
            expect(result).toEqual(makeExpected({ usList: [9], index: 0, nextCard: 1 }));
        });
    });

    describe("empty target column", () => {
        it("anchors to nothing (both previousCard and nextCard null) when the column is empty", () => {
            // Cross-status drop into an EMPTY column -> no neighbours at all.
            const result = resolveKanbanDrop(
                makeInput({
                    activeId: 5,
                    origin: { statusId: 20, swimlaneId: null, index: 0 },
                    targetOrderedIds: [],
                    insertionIndex: 0,
                }),
            );

            expect(result).toEqual(makeExpected({ usList: [5], index: 0 }));
            expect(result?.previousCard).toBeNull();
            expect(result?.nextCard).toBeNull();
        });
    });
});
