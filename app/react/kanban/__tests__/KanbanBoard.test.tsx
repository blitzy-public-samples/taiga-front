/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { render } from "@testing-library/react";
import { KanbanBoard } from "../KanbanBoard";
import {
    createInitialState,
    reduceInit,
    reduceSetUserstories,
} from "../useKanbanState";
import type {
    KanbanProject,
    KanbanState,
    Status,
    Swimlane,
    UserStoryModel,
} from "../useKanbanState";

const statuses: Status[] = [
    { id: 1, name: "New", color: "#f00", order: 1, is_archived: false, wip_limit: null },
    { id: 2, name: "Done", color: "#0f0", order: 2, is_archived: false, wip_limit: null },
];
const project: KanbanProject = {
    id: 7, my_permissions: ["modify_us"], us_statuses: statuses, i_am_admin: true,
};
function usm(over: Partial<UserStoryModel> & { id: number }): UserStoryModel {
    return { status: 1, swimlane: null, kanban_order: over.id, ...over } as UserStoryModel;
}
function baseProps(state: KanbanState) {
    return {
        state, project, zoom: ["ref", "subject"], zoomLevel: 2,
        folds: {}, unfold: null, foldedSwimlane: {}, canAddUs: true,
        resolveDrop: jest.fn().mockReturnValue(null),
        persist: jest.fn(),
    };
}

describe("KanbanBoard no-swimlane mode", () => {
    it("renders zoom-{level}, one header cell per status and a single body", () => {
        let s = reduceInit(createInitialState(), project, [], {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1 }), usm({ id: 102, status: 2 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-table.zoom-2")).not.toBeNull();
        expect(container.querySelector(".kanban-table-swimlane")).toBeNull();
        expect(container.querySelectorAll(".kanban-table-header .task-colum-name").length).toBe(2);
        expect(container.querySelectorAll(".kanban-table-body").length).toBe(1);
        const cols = container.querySelectorAll(".kanban-uses-box.taskboard-column");
        expect(cols.length).toBe(2);
        expect(cols[0].hasAttribute("data-swimlane")).toBe(false);
    });
});

describe("KanbanBoard swimlane mode", () => {
    it("adds the kanban-table-swimlane class and renders per-swimlane bodies", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-table.kanban-table-swimlane")).not.toBeNull();
        expect(container.querySelectorAll(".kanban-swimlane").length).toBeGreaterThanOrEqual(1);
        const cols = container.querySelectorAll(".kanban-swimlane .kanban-uses-box");
        expect(cols.length).toBeGreaterThanOrEqual(1);
        expect(cols[0]).toHaveAttribute("data-swimlane", "50");
    });

    it("shows the swimlane-add affordance when admin and only one swimlane", () => {
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        let s = reduceInit(createInitialState(), project, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(<KanbanBoard {...baseProps(s)} />);
        expect(container.querySelector(".kanban-swimlane-add")).not.toBeNull();
    });

    it("hides the swimlane-add affordance on an archived project (QA-FUNC-11)", () => {
        // Even for an admin with a single swimlane, "Create swimlane" is an
        // editing affordance and must be disabled on an archived project
        // (canEdit === false when archived).
        const swimlanes: Swimlane[] = [{ id: 50, name: "SW", statuses }];
        const archivedProject: KanbanProject = {
            ...project,
            archived_code: "blocked-by-owner-leaving",
        };
        let s = reduceInit(createInitialState(), archivedProject, swimlanes, {});
        s = reduceSetUserstories(s, [usm({ id: 101, status: 1, swimlane: 50 })]);
        const { container } = render(
            <KanbanBoard {...baseProps(s)} project={archivedProject} />,
        );
        expect(container.querySelector(".kanban-swimlane-add")).toBeNull();
    });
});
