/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { act, renderHook } from "@testing-library/react";
import {
    UNCLASSIFIED_SWIMLANE_ID,
    UNCLASSIFIED_USER_STORIES_LABEL,
    buildMoveResult,
    createInitialState,
    getContainerIds,
    getUs,
    getUsModel,
    isUsInArchivedHiddenStatus,
    reduceAddArchivedStatus,
    reduceInit,
    reduceMove,
    reduceSetUserstories,
    reduceToggleFold,
    retrieveUserStoryData,
    useKanbanState,
} from "./useKanbanState";
import type {
    KanbanProject,
    Status,
    Swimlane,
    UsersById,
    UserStoryModel,
} from "./useKanbanState";

const statuses: Status[] = [
    { id: 1, name: "New", color: "#f00", order: 1, is_archived: false, wip_limit: null },
    { id: 2, name: "Done", color: "#0f0", order: 2, is_archived: true, wip_limit: 3 },
];
const project: KanbanProject = {
    id: 7, name: "P", slug: "p", is_kanban_activated: true,
    my_permissions: ["view_us", "modify_us"], us_statuses: statuses,
};
const usersById: UsersById = {
    10: { id: 10, username: "alice", full_name_display: "Alice A", photo: "a.png" },
    11: { id: 11, username: "bob", full_name_display: "Bob B", photo: "b.png" },
};

function us(over: Partial<UserStoryModel> & { id: number }): UserStoryModel {
    return { status: 1, swimlane: null, kanban_order: over.id, ...over } as UserStoryModel;
}

describe("createInitialState", () => {
    it("produces an empty board shape", () => {
        const s = createInitialState();
        expect(s.project).toBeNull();
        expect(s.userstoriesRaw).toEqual([]);
        expect(s.usByStatus).toEqual({});
        expect(s.swimlanesList).toEqual([]);
        expect(s.archivedStatus).toEqual([]);
        expect(UNCLASSIFIED_SWIMLANE_ID).toBe(-1);
        expect(UNCLASSIFIED_USER_STORIES_LABEL).toBeTruthy();
    });
});

describe("reduceInit", () => {
    it("stores project/swimlanes/users and maps swimlanesStatuses incl. the -1 sentinel", () => {
        const s = reduceInit(createInitialState(), project, [], usersById);
        expect(s.project).toBe(project);
        expect(s.usersById).toBe(usersById);
        expect(s.swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID]).toEqual(statuses);
    });
    it("maps each swimlane's own statuses", () => {
        const sw: Swimlane = { id: 50, name: "SW", statuses: [statuses[0]] };
        const s = reduceInit(createInitialState(), project, [sw], usersById);
        expect(s.swimlanesStatuses[50]).toEqual([statuses[0]]);
    });
});

describe("reduceSetUserstories", () => {
    it("groups ids by status (sorted by kanban_order) and builds order + usMap", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 102, kanban_order: 2 }), us({ id: 101, kanban_order: 1 })]);
        expect(s.usByStatus["1"]).toEqual([101, 102]);
        expect(s.order[101]).toBe(1);
        expect(getUs(s, 101)).toBeDefined();
        expect(getUsModel(s, 102)!.id).toBe(102);
    });
    it("does NOT mutate the prior state (immer copy-on-write)", () => {
        const s0 = reduceInit(createInitialState(), project, [], usersById);
        const s1 = reduceSetUserstories(s0, [us({ id: 1 })]);
        expect(s0.usByStatus).toEqual({});
        expect(s1).not.toBe(s0);
        expect(Object.isFrozen(s1)).toBe(true);
    });
    it("builds swimlane grouping with the unclassified (-1) row when stories lack a swimlane", () => {
        const sw: Swimlane = { id: 50, name: "SW", statuses };
        let s = reduceInit(createInitialState(), project, [sw], usersById);
        s = reduceSetUserstories(s, [us({ id: 1, swimlane: 50 }), us({ id: 2, swimlane: null })]);
        const ids = s.swimlanesList.map((x) => x.id);
        expect(ids).toContain(50);
        expect(ids).toContain(UNCLASSIFIED_SWIMLANE_ID);
        expect(s.usByStatusSwimlanes[50][1]).toEqual([1]);
        expect(s.usByStatusSwimlanes[UNCLASSIFIED_SWIMLANE_ID][1]).toEqual([2]);
    });
});

describe("reduceMove", () => {
    it("moves a story to a new status and re-indexes order", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 1, status: 1 }), us({ id: 2, status: 1 }), us({ id: 3, status: 2 })]);
        s = reduceMove(s, [1], 2, null, 3, null);
        expect(getUsModel(s, 1)!.status).toBe(2);
        expect(s.usByStatus["2"]).toContain(1);
        expect(s.usByStatus["1"]).not.toContain(1);
    });
    it("places a moved card after previousCard (order chain)", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 1 }), us({ id: 2 }), us({ id: 3 })]);
        s = reduceMove(s, [3], 1, null, 1, null);
        // previousCard=1 → moved card 3 is placed immediately AFTER card 1
        expect(s.order[3]).toBeGreaterThan(s.order[1]);
    });
});

describe("buildMoveResult", () => {
    it("maps previousCard→after and nextCard→before (bulk payload shape)", () => {
        const r = buildMoveResult([9, 8], 4, null, 5, 6);
        expect(r).toEqual({
            statusId: 4, swimlaneId: null,
            afterUserstoryId: 5, beforeUserstoryId: 6, bulkUserstories: [9, 8],
        });
    });
});

describe("reduceToggleFold", () => {
    it("flips the fold flag for a user story", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 1 })]);
        s = reduceToggleFold(s, 1);
        expect(s.foldStatusChanged[1]).toBe(true);
        s = reduceToggleFold(s, 1);
        expect(s.foldStatusChanged[1]).toBe(false);
    });
});

describe("reduceAddArchivedStatus", () => {
    it("adds and de-duplicates archived status ids", () => {
        let s = reduceAddArchivedStatus(createInitialState(), 2);
        s = reduceAddArchivedStatus(s, 2);
        expect(s.archivedStatus).toEqual([2]);
    });
});

describe("isUsInArchivedHiddenStatus", () => {
    it("is true only when the status is BOTH archived and hidden", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 1, status: 2 })]);
        s = reduceAddArchivedStatus(s, 2);
        expect(isUsInArchivedHiddenStatus(s, 1)).toBe(false); // not hidden yet
        const hidden = { ...s, statusHide: [2] };
        expect(isUsInArchivedHiddenStatus(hidden, 1)).toBe(true);
        expect(isUsInArchivedHiddenStatus(s, 999)).toBe(false);
    });
});

describe("getContainerIds", () => {
    it("returns ids from usByStatus in no-swimlane mode", () => {
        let s = reduceInit(createInitialState(), project, [], usersById);
        s = reduceSetUserstories(s, [us({ id: 1 }), us({ id: 2 })]);
        expect(getContainerIds(s, 1)).toEqual([1, 2]);
        expect(getContainerIds(s, 999)).toEqual([]);
    });
    it("returns ids from usByStatusSwimlanes in swimlane mode", () => {
        const sw: Swimlane = { id: 50, name: "SW", statuses };
        let s = reduceInit(createInitialState(), project, [sw], usersById);
        s = reduceSetUserstories(s, [us({ id: 1, swimlane: 50 })]);
        expect(getContainerIds(s, 1, 50)).toEqual([1]);
    });
});

describe("retrieveUserStoryData", () => {
    it("resolves assignee, assigned_users preview, tags and images", () => {
        const view = retrieveUserStoryData(
            us({
                id: 1, assigned_to: 10, assigned_users: [10, 11, 10, 11, 10],
                tags: [["urgent", "#f00"], ["nocolor", null]],
                attachments: [
                    { id: 1, thumbnail_card_url: "t.png" },
                    { id: 2, thumbnail_card_url: null },
                ],
            }),
            usersById, {},
        );
        expect(view.assigned_to!.username).toBe("alice");
        expect(view.assigned_users_preview.length).toBe(3);
        expect(view.colorized_tags).toEqual([
            { name: "urgent", color: "#f00" },
            { name: "nocolor", color: null },
        ]);
        expect(view.images.length).toBe(1);
    });
    it("leaves assigned_to undefined when unassigned", () => {
        const view = retrieveUserStoryData(us({ id: 1, assigned_to: null }), usersById, {});
        expect(view.assigned_to).toBeUndefined();
    });
});

describe("useKanbanState hook", () => {
    it("exposes actions that update state immutably", () => {
        const { result } = renderHook(() => useKanbanState());
        act(() => result.current.init(project, [], usersById));
        act(() => result.current.setUserstories([us({ id: 1 }), us({ id: 2 })]));
        expect(result.current.state.usByStatus["1"]).toEqual([1, 2]);
        act(() => result.current.move([1], 2, null, null, null));
        expect(result.current.state.usByStatus["2"]).toContain(1);
        act(() => result.current.toggleFold(2));
        expect(result.current.state.foldStatusChanged[2]).toBe(true);
        act(() => result.current.addArchivedStatus(2));
        expect(result.current.state.archivedStatus).toEqual([2]);
    });
});
