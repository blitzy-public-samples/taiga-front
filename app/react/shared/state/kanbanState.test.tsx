/*
 * Copyright (c) 2021-present Kaleidos INC
 *
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Unit tests for the pure Kanban state producers/selectors in ./kanbanState.
 * These assertions encode the value semantics of the legacy Immutable.js
 * service (app/coffee/modules/kanban/kanban-usertories.coffee) and drive real
 * covered lines toward the >= 70% Jest line threshold.
 */

import type { UserStory, Swimlane } from "../types";
// Imported THROUGH the public `./index` barrel (NOT directly from
// `./kanbanState`) so the barrel's re-export lines count toward the >= 70% Jest
// line-coverage gate. Type-only symbols use `import type` (isolatedModules).
import {
    UNCLASSIFIED_SWIMLANE_ID,
    UNCLASSIFIED_SWIMLANE_NAME,
    createInitialKanbanState,
    reset,
    init,
    set,
    assignOrders,
    add,
    remove,
    replaceModel,
    replace,
    move,
    moveToEnd,
    toggleFold,
    resetFolds,
    addArchivedStatus,
    hideStatus,
    showStatus,
    getUs,
    getUsModel,
    isUsInArchivedHiddenStatus,
} from "./index";
import type { KanbanState, KanbanMoveResult } from "./index";

/** Minimal UserStory factory (only fields these projections read). */
function mkUS(
    id: number,
    status: number,
    swimlane: number | null,
    kanban_order?: number,
    subject?: string,
): UserStory {
    const us: UserStory = { id, status, swimlane };
    if (kanban_order !== undefined) {
        us.kanban_order = kanban_order;
    }
    if (subject !== undefined) {
        us.subject = subject;
    }
    return us;
}

/** The 4-story fixture used by the `move` cases (statuses 10/10/10/20). */
function baseMoveState(): KanbanState {
    return set(createInitialKanbanState(), [
        mkUS(1, 10, null, 1),
        mkUS(2, 10, null, 2),
        mkUS(3, 10, null, 3),
        mkUS(4, 20, null, 1),
    ]);
}

describe("createInitialKanbanState", () => {
    it("returns a fully-empty state", () => {
        const s = createInitialKanbanState();
        expect(s.userstoriesRaw).toEqual([]);
        expect(s.swimlanes).toEqual([]);
        expect(s.foldStatusChanged).toEqual({});
        expect(s.usByStatus).toEqual({});
        expect(s.usMap).toEqual({});
        expect(s.usByStatusSwimlanes).toEqual({});
        expect(s.statusHide).toEqual([]);
        expect(s.archivedStatus).toEqual([]);
        expect(s.swimlanesList).toEqual([]);
        expect(s.order).toEqual({});
    });
});

describe("set", () => {
    it("populates order, usByStatus, usMap and sorts userstoriesRaw by order", () => {
        const s = baseMoveState();

        // order mirrors each story's kanban_order.
        expect(s.order).toEqual({ 1: 1, 2: 2, 3: 3, 4: 1 });

        // usByStatus is keyed by String(statusId) with ordered ids.
        expect(s.usByStatus["10"]).toEqual([1, 2, 3]);
        expect(s.usByStatus["20"]).toEqual([4]);

        // usMap stores the raw stories by id.
        expect(s.usMap[1]).toEqual(mkUS(1, 10, null, 1));
        expect(Object.keys(s.usMap).sort()).toEqual(["1", "2", "3", "4"]);

        // userstoriesRaw is sorted by order (stable): [1(1),4(1),2(2),3(3)].
        expect(s.userstoriesRaw.map((u) => u.id)).toEqual([1, 4, 2, 3]);
    });

    it("sorts stories without a kanban_order last (orderOf => +Infinity)", () => {
        const s = set(createInitialKanbanState(), [
            mkUS(1, 10, null), // no kanban_order -> sorts last
            mkUS(2, 10, null, 5),
        ]);
        expect(s.userstoriesRaw.map((u) => u.id)).toEqual([2, 1]);
        expect(s.usByStatus["10"]).toEqual([2, 1]);
    });
});

describe("move", () => {
    it("moves a card to the front of a status (no previousCard)", () => {
        const { state, result } = move(baseMoveState(), [3], 10, null, 0, null, null);

        expect(state.order).toEqual({ 1: 2, 2: 3, 3: 0, 4: 1 });
        expect(state.usByStatus["10"]).toEqual([3, 1, 2]);
        expect(result.bulkUserstories).toEqual([3]);
    });

    it("moves a card after another card (previousCard set)", () => {
        const { state } = move(baseMoveState(), [1], 10, null, 0, 2, null);

        expect(state.usByStatus["10"]).toEqual([2, 1, 3]);
    });

    it("moves a card across statuses and re-homes its status", () => {
        const { state } = move(baseMoveState(), [4], 10, null, 1, 1, null);

        expect(state.usByStatus["10"]).toEqual([1, 4, 2, 3]);
        expect(getUsModel(state, 4)!.status).toBe(10);
        // usMap was updated with the moved story's new status too.
        expect(getUs(state, 4)!.status).toBe(10);
    });

    it("moves multiple cards at once, preserving their relative order", () => {
        const { state, result } = move(baseMoveState(), [3, 1], 10, null, 0, null, null);

        expect(state.usByStatus["10"]).toEqual([3, 1, 2]);
        expect(state.order[3]).toBe(0);
        expect(state.order[1]).toBe(1);
        expect(result.bulkUserstories).toEqual([3, 1]);
    });

    it("assigns swimlane on a swimlane-scoped move", () => {
        const { state } = move(baseMoveState(), [1], 10, 7, 0, null, null);
        expect(getUsModel(state, 1)!.swimlane).toBe(7);
    });

    it("ignores unknown ids in usList (no matching model)", () => {
        const { state, result } = move(baseMoveState(), [999], 10, null, 0, null, null);
        // 999 is not a real story, so no model is re-homed; existing cards remain.
        expect(getUsModel(state, 999)).toBeUndefined();
        expect(result.bulkUserstories).toEqual([999]);
    });

    it("returns a result with EXACTLY the five camelCase keys and passed values", () => {
        const { result } = move(baseMoveState(), [1, 2], 10, null, 4, 2, 3);
        const expected: KanbanMoveResult = {
            statusId: 10,
            swimlaneId: null,
            afterUserstoryId: 2,
            beforeUserstoryId: 3,
            bulkUserstories: [1, 2],
        };
        expect(result).toEqual(expected);
        expect(Object.keys(result).sort()).toEqual(
            [
                "afterUserstoryId",
                "beforeUserstoryId",
                "bulkUserstories",
                "statusId",
                "swimlaneId",
            ].sort(),
        );
    });

    it("is pure — it does not mutate the input state", () => {
        const input = baseMoveState();
        const snapshot = JSON.parse(JSON.stringify(input));
        move(input, [3], 10, null, 0, null, null);
        expect(input).toEqual(snapshot);
    });
});

describe("moveToEnd", () => {
    it("sets order -1, updates status/kanban_order and returns the payload", () => {
        const { state, result } = moveToEnd(baseMoveState(), 1, 20);

        expect(result).toEqual({ us_id: 1, order: -1 });
        expect(state.order[1]).toBe(-1);
        expect(getUsModel(state, 1)!.status).toBe(20);
        expect(getUsModel(state, 1)!.kanban_order).toBe(-1);
        // Story 4 already lives in status 20 (see baseMoveState), so the moved
        // story 1 (order -1) sorts ahead of it: the column becomes [1, 4].
        expect(state.usByStatus["20"]).toEqual([1, 4]);
        expect(state.usByStatus["10"]).toEqual([2, 3]);
    });

    it("still records order -1 when the id is unknown", () => {
        const { state, result } = moveToEnd(baseMoveState(), 999, 20);
        expect(result).toEqual({ us_id: 999, order: -1 });
        expect(state.order[999]).toBe(-1);
    });
});

describe("add", () => {
    it("dedupes existing ids and appends genuinely-new stories", () => {
        let s = set(createInitialKanbanState(), [
            mkUS(1, 10, null, 1),
            mkUS(2, 10, null, 2),
        ]);
        s = add(s, [
            mkUS(2, 10, null, 2), // duplicate of existing id 2
            mkUS(3, 10, null, 3), // new
        ]);

        // No duplicate rows for id 2.
        expect(s.userstoriesRaw.filter((u) => u.id === 2).length).toBe(1);
        expect(s.usByStatus["10"]).toEqual([1, 2, 3]);
        expect(getUsModel(s, 3)).toBeDefined();
        expect(s.userstoriesRaw.map((u) => u.id)).toEqual([1, 2, 3]);
    });

    it("accepts a single story (non-array) argument", () => {
        let s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        s = add(s, mkUS(2, 10, null, 2));
        expect(s.usByStatus["10"]).toEqual([1, 2]);
        expect(getUs(s, 2)).toBeDefined();
    });

    it("creates a new status column for a new status", () => {
        let s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        s = add(s, mkUS(2, 30, null, 2));
        expect(s.usByStatus["30"]).toEqual([2]);
    });

    it("handles new stories without a kanban_order (treated as 0 for add sort)", () => {
        let s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        // Two-item array where BOTH lack kanban_order so the single sort
        // comparator call exercises the `?? 0` fallback on both operands.
        s = add(s, [mkUS(2, 10, null), mkUS(3, 10, null)]);
        expect(getUs(s, 2)).toBeDefined();
        expect(getUs(s, 3)).toBeDefined();
        expect(s.usByStatus["10"]).toContain(2);
        expect(s.usByStatus["10"]).toContain(3);
    });
});

describe("remove", () => {
    it("drops a story from every projection", () => {
        let s = set(createInitialKanbanState(), [
            mkUS(1, 10, null, 1),
            mkUS(2, 10, null, 2),
            mkUS(3, 10, null, 3),
        ]);
        s = remove(s, { id: 2, status: 10 });

        expect(s.userstoriesRaw.map((u) => u.id)).toEqual([1, 3]);
        expect(s.usByStatus["10"]).toEqual([1, 3]);
        expect(s.usMap[2]).toBeUndefined();
        expect(s.order[2]).toBeUndefined();
    });
});

describe("replaceModel / replace", () => {
    it("replaceModel swaps the matching story and leaves others untouched", () => {
        let s = set(createInitialKanbanState(), [
            mkUS(1, 10, null, 1),
            mkUS(2, 10, null, 2, "keep"),
        ]);
        s = replaceModel(s, mkUS(1, 10, null, 1, "updated"));
        expect(getUsModel(s, 1)!.subject).toBe("updated");
        expect(getUs(s, 1)!.subject).toBe("updated");
        // The non-matching story is returned unchanged by the map callback.
        expect(getUsModel(s, 2)!.subject).toBe("keep");
    });

    it("replace updates only the usMap entry", () => {
        let s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        s = replace(s, mkUS(1, 10, null, 1, "mapped"));
        expect(getUs(s, 1)!.subject).toBe("mapped");
        // userstoriesRaw is left untouched by `replace`.
        expect(getUsModel(s, 1)!.subject).toBeUndefined();
    });
});

describe("assignOrders", () => {
    it("merges new order values and re-sorts projections", () => {
        let s = set(createInitialKanbanState(), [
            mkUS(1, 10, null, 1),
            mkUS(2, 10, null, 2),
            mkUS(3, 10, null, 3),
        ]);
        s = assignOrders(s, { 1: 10 });
        expect(s.order[1]).toBe(10);
        expect(s.usByStatus["10"]).toEqual([2, 3, 1]);
    });
});

describe("init + refreshSwimlanes", () => {
    it("prepends the synthetic swimlane and buckets stories when a null-swimlane story exists", () => {
        const swimlanes: Swimlane[] = [
            { id: 5, name: "A" },
            { id: 6, name: "B" },
        ];
        let s = init(createInitialKanbanState(), swimlanes);
        s = set(s, [
            mkUS(100, 10, null, 1), // unclassified
            mkUS(101, 10, 5, 2),
            mkUS(102, 20, 6, 3),
        ]);

        expect(s.swimlanesList.map((sw) => sw.id)).toEqual([
            UNCLASSIFIED_SWIMLANE_ID,
            5,
            6,
        ]);
        expect(s.swimlanesList[0]).toEqual({
            id: UNCLASSIFIED_SWIMLANE_ID,
            kanban_order: 1,
            name: UNCLASSIFIED_SWIMLANE_NAME,
        });

        expect(s.usByStatusSwimlanes["-1"]["10"]).toEqual([100]);
        expect(s.usByStatusSwimlanes["5"]["10"]).toEqual([101]);
        expect(s.usByStatusSwimlanes["6"]["20"]).toEqual([102]);
        // The unclassified bucket has no story in status 20.
        expect(s.usByStatusSwimlanes["-1"]["20"]).toEqual([]);
    });

    it("omits the synthetic swimlane when every story has a swimlane", () => {
        const swimlanes: Swimlane[] = [
            { id: 5, name: "A" },
            { id: 6, name: "B" },
        ];
        let s = init(createInitialKanbanState(), swimlanes);
        s = set(s, [mkUS(101, 10, 5, 1), mkUS(102, 20, 6, 2)]);

        expect(s.swimlanesList.map((sw) => sw.id)).toEqual([5, 6]);
        expect(s.swimlanesList.map((sw) => sw.id)).not.toContain(
            UNCLASSIFIED_SWIMLANE_ID,
        );
        expect(s.usByStatusSwimlanes["5"]["10"]).toEqual([101]);
        expect(s.usByStatusSwimlanes["6"]["20"]).toEqual([102]);
    });

    it("de-duplicates configured swimlanes by id", () => {
        const swimlanes: Swimlane[] = [
            { id: 5, name: "A" },
            { id: 5, name: "A-dup" },
        ];
        let s = init(createInitialKanbanState(), swimlanes);
        s = set(s, [mkUS(101, 10, 5, 1)]);
        expect(s.swimlanesList.map((sw) => sw.id)).toEqual([5]);
    });

    it("leaves swimlane projections empty when no swimlanes are configured", () => {
        const s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        expect(s.swimlanesList).toEqual([]);
        expect(s.usByStatusSwimlanes).toEqual({});
    });
});

describe("fold producers", () => {
    it("toggleFold flips the flag and resetFolds clears all flags", () => {
        let s = createInitialKanbanState();
        s = toggleFold(s, 5);
        expect(s.foldStatusChanged[5]).toBe(true);
        s = toggleFold(s, 5);
        expect(s.foldStatusChanged[5]).toBe(false);

        s = toggleFold(s, 9);
        s = resetFolds(s);
        expect(s.foldStatusChanged).toEqual({});
    });
});

describe("archived / hidden status producers", () => {
    it("addArchivedStatus records a status id", () => {
        const s = addArchivedStatus(createInitialKanbanState(), 10);
        expect(s.archivedStatus).toEqual([10]);
    });

    it("hideStatus removes the column and records the hidden id", () => {
        let s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        expect(s.usByStatus["10"]).toEqual([1]);
        s = hideStatus(s, 10);
        expect(s.usByStatus["10"]).toBeUndefined();
        expect(s.statusHide).toEqual([10]);
    });

    it("hideStatus still records the id when the column is absent", () => {
        const s = hideStatus(createInitialKanbanState(), 42);
        expect(s.statusHide).toEqual([42]);
    });

    it("showStatus removes an id from statusHide", () => {
        let s = hideStatus(createInitialKanbanState(), 10);
        s = showStatus(s, 10);
        expect(s.statusHide).toEqual([]);
    });
});

describe("isUsInArchivedHiddenStatus", () => {
    function stateWithStory(): KanbanState {
        return set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
    }

    it("is true only when the status is BOTH archived and hidden", () => {
        let s = stateWithStory();
        s = addArchivedStatus(s, 10);
        s = hideStatus(s, 10);
        expect(isUsInArchivedHiddenStatus(s, 1)).toBe(true);
    });

    it("is false when only archived", () => {
        let s = stateWithStory();
        s = addArchivedStatus(s, 10);
        expect(isUsInArchivedHiddenStatus(s, 1)).toBe(false);
    });

    it("is false when only hidden", () => {
        let s = stateWithStory();
        s = hideStatus(s, 10);
        expect(isUsInArchivedHiddenStatus(s, 1)).toBe(false);
    });

    it("is false for an unknown story id", () => {
        const s = stateWithStory();
        expect(isUsInArchivedHiddenStatus(s, 999)).toBe(false);
    });
});

describe("reset", () => {
    function populated(): KanbanState {
        let s = init(createInitialKanbanState(), [{ id: 5, name: "A" }]);
        s = set(s, [mkUS(1, 10, null, 1)]);
        s = addArchivedStatus(s, 10);
        s = hideStatus(s, 99);
        return s;
    }

    it("clears the core collections by default", () => {
        const s = reset(populated());
        expect(s.userstoriesRaw).toEqual([]);
        expect(s.swimlanes).toEqual([]);
        expect(s.usByStatus).toEqual({});
        expect(s.usMap).toEqual({});
        expect(s.usByStatusSwimlanes).toEqual({});
        expect(s.statusHide).toEqual([]);
        expect(s.archivedStatus).toEqual([]);
        expect(s.swimlanesList).toEqual([]);
    });

    it("retains archivedStatus when resetArchivedStatus is false", () => {
        const s = reset(populated(), { resetArchivedStatus: false });
        expect(s.archivedStatus).toEqual([10]);
    });

    it("retains statusHide when resetStatusHide is false", () => {
        const s = reset(populated(), { resetStatusHide: false });
        expect(s.statusHide).toEqual([99]);
    });

    it("retains swimlanesList when resetSwimlanesList is false", () => {
        const before = populated();
        const s = reset(before, { resetSwimlanesList: false });
        expect(s.swimlanesList).toEqual(before.swimlanesList);
    });
});

describe("selectors", () => {
    it("getUs / getUsModel return matches and undefined for misses", () => {
        const s = set(createInitialKanbanState(), [mkUS(1, 10, null, 1)]);
        expect(getUs(s, 1)).toBeDefined();
        expect(getUs(s, 999)).toBeUndefined();
        expect(getUsModel(s, 1)).toBeDefined();
        expect(getUsModel(s, 999)).toBeUndefined();
    });
});
