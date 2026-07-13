/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    computeMovedSet,
    resolveBacklogDrop,
    BacklogDropOver,
    ResolveBacklogDropInput,
} from "./resolveBacklogDrop";

/**
 * Model world used by the tests:
 *   backlog (null): [10, 11, 12]
 *   sprint 5 (open): [20, 21]
 *   sprint 8 (open): [30]
 *   sprint 9 (CLOSED): [40]
 */
const CONTAINERS: Record<string, number[]> = {
    backlog: [10, 11, 12],
    "5": [20, 21],
    "8": [30],
    "9": [40],
};
const CONTAINER_OF: Record<number, number | null> = {
    10: null,
    11: null,
    12: null,
    20: 5,
    21: 5,
    30: 8,
    40: 9,
};
function baseInput(over: BacklogDropOver, activeId: number, selected: number[] = []): ResolveBacklogDropInput {
    return {
        activeId,
        orderedSelectedIds: selected,
        over,
        storyContainer: (usId) => (usId in CONTAINER_OF ? CONTAINER_OF[usId] : undefined),
        containerOrderedIds: (sprintId) =>
            (CONTAINERS[sprintId === null ? "backlog" : String(sprintId)] ?? []).slice(),
    };
}

describe("computeMovedSet (C8 multi-drag gate)", () => {
    it("moves only the dragged row when nothing is multi-selected", () => {
        expect(computeMovedSet(11, [])).toEqual([11]);
    });

    it("moves only the dragged row when a single row is selected", () => {
        expect(computeMovedSet(11, [11])).toEqual([11]);
    });

    it("moves the whole selection when the dragged row is part of a multi-selection", () => {
        expect(computeMovedSet(11, [10, 11, 12])).toEqual([10, 11, 12]);
    });

    it("moves only the dragged row when it is NOT part of the multi-selection", () => {
        expect(computeMovedSet(30, [10, 11])).toEqual([30]);
    });

    it("preserves the document order of the selection", () => {
        expect(computeMovedSet(12, [12, 10, 11])).toEqual([12, 10, 11]);
    });
});

describe("resolveBacklogDrop - within-backlog reorder", () => {
    it("reorders 10 to sit before 12 (drop onto row 12)", () => {
        // base (10 removed) = [11, 12]; over 12 -> insertPos 1; prev 11, next null
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 12 }, 10));
        expect(r).toEqual({
            usIds: [10],
            newUsIndex: 1,
            newSprintId: null,
            previousUsId: 11,
            nextUsId: null,
        });
    });

    it("reorders to the TOP of the backlog (drop onto row 10) with the nextUs quirk", () => {
        // active 12, base (12 removed) = [10, 11]; over 10 -> insertPos 0
        // previousUs null -> nextUs = base[0] = 10
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 10 }, 12));
        expect(r).toEqual({
            usIds: [12],
            newUsIndex: 0,
            newSprintId: null,
            previousUsId: null,
            nextUsId: 10,
        });
    });

    it("returns null when the resulting backlog order is unchanged (no-op)", () => {
        // active 10 dropped onto 11: base=[11,12], insertPos 0 -> [10,11,12] == original
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 11 }, 10));
        expect(r).toBeNull();
    });

    it("returns null when a row is dropped onto itself", () => {
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 11 }, 11));
        expect(r).toBeNull();
    });
});

describe("resolveBacklogDrop - backlog -> sprint", () => {
    it("appends to an open sprint when dropped on the sprint container", () => {
        // dest sprint 5 = [20,21]; container drop -> append at index 2; prev 21
        const r = resolveBacklogDrop(baseInput({ kind: "container", sprintId: 5 }, 10));
        expect(r).toEqual({
            usIds: [10],
            newUsIndex: 2,
            newSprintId: 5,
            previousUsId: 21,
            nextUsId: null,
        });
    });

    it("inserts before a specific sprint row when dropped on that row", () => {
        // dest sprint 5 base=[20,21]; over 21 -> insertPos 1; prev 20
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 21 }, 10));
        expect(r).toEqual({
            usIds: [10],
            newUsIndex: 1,
            newSprintId: 5,
            previousUsId: 20,
            nextUsId: null,
        });
    });

    it("inserts at the TOP of a sprint (nextUs quirk) when dropped on the first sprint row", () => {
        // over 20 -> insertPos 0; prev null -> next 20
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 20 }, 10));
        expect(r).toEqual({
            usIds: [10],
            newUsIndex: 0,
            newSprintId: 5,
            previousUsId: null,
            nextUsId: 20,
        });
    });
});

describe("resolveBacklogDrop - sprint -> backlog", () => {
    it("moves a sprint story back to the backlog (drop on a backlog row)", () => {
        // active 20 (sprint 5) dropped on backlog row 12; dest backlog base=[10,11,12]
        // over 12 -> insertPos 2; prev 11
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 12 }, 20));
        expect(r).toEqual({
            usIds: [20],
            newUsIndex: 2,
            newSprintId: null,
            previousUsId: 11,
            nextUsId: null,
        });
    });

    it("appends to the backlog when dropped on the backlog container", () => {
        const r = resolveBacklogDrop(baseInput({ kind: "container", sprintId: null }, 20));
        expect(r).toEqual({
            usIds: [20],
            newUsIndex: 3,
            newSprintId: null,
            previousUsId: 12,
            nextUsId: null,
        });
    });
});

describe("resolveBacklogDrop - within-sprint reorder", () => {
    it("reorders within the same sprint to the top (nextUs quirk)", () => {
        // active 21 (sprint 5) dropped on row 20; base (21 removed)=[20]; over 20 insertPos 0
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 20 }, 21));
        expect(r).toEqual({
            usIds: [21],
            newUsIndex: 0,
            newSprintId: 5,
            previousUsId: null,
            nextUsId: 20,
        });
    });

    it("returns null for a no-op within-sprint drop", () => {
        // active 20 dropped on 21: base=[21]; insertPos 0 -> [20,21] == original
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 21 }, 20));
        expect(r).toBeNull();
    });
});

describe("resolveBacklogDrop - between-sprint move", () => {
    it("moves a story from sprint 5 to sprint 8 (drop on sprint 8 container)", () => {
        // active 20 (sprint 5) -> sprint 8 = [30]; container append insertPos 1; prev 30
        const r = resolveBacklogDrop(baseInput({ kind: "container", sprintId: 8 }, 20));
        expect(r).toEqual({
            usIds: [20],
            newUsIndex: 1,
            newSprintId: 8,
            previousUsId: 30,
            nextUsId: null,
        });
    });

    it("moves a story from sprint 5 before a row in sprint 8", () => {
        // over 30 (sprint 8) base=[30]; insertPos 0; prev null -> next 30
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 30 }, 20));
        expect(r).toEqual({
            usIds: [20],
            newUsIndex: 0,
            newSprintId: 8,
            previousUsId: null,
            nextUsId: 30,
        });
    });
});

describe("resolveBacklogDrop - closed-sprint reopen (legacy parity)", () => {
    // Legacy parity: the pure resolver is purely POSITIONAL and never rejects on
    // the closed flag (the stock dragula accepted any visible `.sprint-table`).
    // Rejection of drops onto FOLDED / hidden closed sprints is a property of the
    // fold-gated `useDroppable` in `../SprintList.tsx`; once the user UNFOLDS a
    // closed sprint, @dnd-kit reports it as `over` and the resolver produces a
    // real move whose persistence reopens the sprint on the backend.
    it("RESOLVES a drop onto a (now-unfolded) closed sprint container as a move into it", () => {
        const r = resolveBacklogDrop(baseInput({ kind: "container", sprintId: 9 }, 10));
        expect(r).not.toBeNull();
        // Story 10 moves into sprint 9, appended after its single existing story 40.
        expect(r!.usIds).toEqual([10]);
        expect(r!.newSprintId).toBe(9);
        expect(r!.previousUsId).toBe(40);
    });

    it("RESOLVES a drop onto a row that lives in a (now-unfolded) closed sprint", () => {
        // over 40 lives in sprint 9 -> the move resolves into sprint 9 at row 40.
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 40 }, 10));
        expect(r).not.toBeNull();
        expect(r!.usIds).toEqual([10]);
        expect(r!.newSprintId).toBe(9);
    });
});

describe("resolveBacklogDrop - multi-move", () => {
    it("moves the whole selection into a sprint (container drop)", () => {
        // selected [10,11] with active 10 -> sprint 8=[30]; base=[30]; append insertPos 1
        const r = resolveBacklogDrop(baseInput({ kind: "container", sprintId: 8 }, 10, [10, 11]));
        expect(r).toEqual({
            usIds: [10, 11],
            newUsIndex: 1,
            newSprintId: 8,
            previousUsId: 30,
            nextUsId: null,
        });
    });

    it("excludes all moved rows from the neighbour computation", () => {
        // selected [11,12] active 11 dropped on backlog row 10 (move both to top);
        // base (11,12 removed) = [10] -> proves BOTH moved rows are excluded.
        // over 10 -> insertPos 0; prev null -> next 10; result [11,12,10] != original.
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 10 }, 11, [11, 12]));
        expect(r).toEqual({
            usIds: [11, 12],
            newUsIndex: 0,
            newSprintId: null,
            previousUsId: null,
            nextUsId: 10,
        });
    });

    it("returns null when the dragged row of a selection is dropped onto a selected (moving) row", () => {
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 11 }, 10, [10, 11]));
        expect(r).toBeNull();
    });
});

describe("resolveBacklogDrop - defensive guards", () => {
    it("returns null when the over row id is unknown", () => {
        const r = resolveBacklogDrop(baseInput({ kind: "row", usId: 999 }, 10));
        expect(r).toBeNull();
    });
});
