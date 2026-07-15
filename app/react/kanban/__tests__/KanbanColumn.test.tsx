/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { fireEvent, render } from "@testing-library/react";
import {
    ColumnHeader,
    KanbanColumn,
    buildContainerKey,
    computeWipLimit,
} from "../KanbanColumn";
import { retrieveUserStoryData } from "../useKanbanState";
import type {
    KanbanProject,
    Status,
    UsersById,
    UserStoryModel,
    UsView,
} from "../useKanbanState";

const project: KanbanProject = { id: 7, my_permissions: ["modify_us"] };
const usersById: UsersById = {};
const ZOOM = ["assigned_to", "ref", "subject"];

function status(over: Partial<Status> & { id: number }): Status {
    return { name: "S", color: "#abc", order: 1, is_archived: false, wip_limit: null, ...over };
}
function mkMap(ids: number[], statusId = 1, swimlane: number | null = null): Record<number, UsView> {
    const m: Record<number, UsView> = {};
    for (const id of ids) {
        const model = { id, status: statusId, swimlane, kanban_order: id, subject: "S" + id } as UserStoryModel;
        m[id] = retrieveUserStoryData(model, usersById, {});
    }
    return m;
}

describe("buildContainerKey", () => {
    it("serializes null AND -1 both to the ::-1 sentinel", () => {
        expect(buildContainerKey(5, null)).toBe("5::-1");
        expect(buildContainerKey(5, -1)).toBe("5::-1");
        expect(buildContainerKey(5, 50)).toBe("5::50");
    });
});

describe("computeWipLimit (ported from KanbanWipLimitDirective)", () => {
    it("returns null when there is no limit", () => {
        expect(computeWipLimit(10, null)).toBeNull();
        expect(computeWipLimit(10, undefined)).toBeNull();
    });
    it("returns one-left when count is one below the limit", () => {
        expect(computeWipLimit(2, 3)).toEqual({ className: "one-left", afterIndex: 1 });
    });
    it("returns reached when count equals the limit", () => {
        expect(computeWipLimit(3, 3)).toEqual({ className: "reached", afterIndex: 2 });
    });
    it("returns exceeded (marker after wip-1) when count is over the limit", () => {
        expect(computeWipLimit(5, 3)).toEqual({ className: "exceeded", afterIndex: 2 });
    });
    it("returns null when comfortably under the limit", () => {
        expect(computeWipLimit(1, 5)).toBeNull();
    });
});

describe("KanbanColumn DOM", () => {
    it("renders .kanban-uses-box.taskboard-column with data-status and data-swimlane", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 1 })} swimlaneId={50} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[101, 102]} usMap={mkMap([101, 102], 1, 50)} folded={false} />,
        );
        const col = container.querySelector(".kanban-uses-box.taskboard-column")!;
        expect(col).toHaveAttribute("data-status", "1");
        expect(col).toHaveAttribute("data-swimlane", "50");
        expect(container.querySelectorAll("[data-id]").length).toBe(2);
        expect(container.querySelector(".kanban-task-counter")).not.toBeNull();
    });

    it("omits data-swimlane entirely in no-swimlane mode (swimlaneId=null)", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 1 })} swimlaneId={null} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[101]} usMap={mkMap([101])} folded={false} />,
        );
        expect(container.querySelector(".kanban-uses-box")!.hasAttribute("data-swimlane")).toBe(false);
    });

    it("shows .placeholder-collapsed (and hides the counter) when folded", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 1 })} swimlaneId={null} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[101]} usMap={mkMap([101])} folded={true} />,
        );
        expect(container.querySelector(".placeholder-collapsed")).not.toBeNull();
        expect(container.querySelector(".kanban-task-counter")).toBeNull();
        expect(container.querySelector(".vfold")).not.toBeNull();
    });

    it("renders a WIP-limit marker with the reached class when count == wip_limit", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 1, wip_limit: 2 })} swimlaneId={null} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[101, 102]} usMap={mkMap([101, 102])} folded={false} />,
        );
        expect(container.querySelector(".kanban-wip-limit.reached")).not.toBeNull();
    });

    it("suppresses the WIP marker and shows .kanban-column-intro for an archived status", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 2, is_archived: true, wip_limit: 1 })} swimlaneId={null} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[101, 102]} usMap={mkMap([101, 102], 2)} folded={false} />,
        );
        expect(container.querySelector(".kanban-wip-limit")).toBeNull();
        expect(container.querySelector(".kanban-column-intro")).not.toBeNull();
    });

    it("renders the .card-placeholder (with not-found) when showPlaceholder is set", () => {
        const { container } = render(
            <KanbanColumn status={status({ id: 1 })} swimlaneId={null} project={project} zoom={ZOOM} zoomLevel={1}
                cardIds={[]} usMap={{}} folded={false} showPlaceholder={true} notFound={true} />,
        );
        const ph = container.querySelector(".card-placeholder")!;
        expect(ph).not.toBeNull();
        expect(ph.className).toContain("not-found");
    });
});

describe("ColumnHeader", () => {
    it("shows add + bulk buttons and fires onAddUs when canAddUs and not archived", () => {
        const onAddUs = jest.fn();
        const { container } = render(
            <ColumnHeader status={status({ id: 1 })} folded={false} canAddUs={true} onAddUs={onAddUs} />,
        );
        expect(container.querySelector(".icon-add")).not.toBeNull();
        expect(container.querySelector(".icon-bulk")).not.toBeNull();
        fireEvent.click(container.querySelector(".icon-add")!.closest("button")!);
        expect(onAddUs).toHaveBeenCalledWith("standard", 1);
        fireEvent.click(container.querySelector(".icon-bulk")!.closest("button")!);
        expect(onAddUs).toHaveBeenCalledWith("bulk", 1);
    });

    it("hides add/bulk when the status is archived", () => {
        const { container } = render(
            <ColumnHeader status={status({ id: 2, is_archived: true })} folded={false} canAddUs={true} />,
        );
        expect(container.querySelector(".icon-add")).toBeNull();
        expect(container.querySelector(".icon-bulk")).toBeNull();
    });

    it("hides add/bulk when the user cannot add user stories", () => {
        const { container } = render(
            <ColumnHeader status={status({ id: 1 })} folded={false} canAddUs={false} />,
        );
        expect(container.querySelector(".icon-add")).toBeNull();
    });

    it("fires onFoldStatus from the fold affordance and applies vfold when folded", () => {
        const onFoldStatus = jest.fn();
        const { container } = render(
            <ColumnHeader status={status({ id: 1 })} folded={true} canAddUs={true} onFoldStatus={onFoldStatus} />,
        );
        expect(container.querySelector(".task-colum-name.vfold")).not.toBeNull();
        fireEvent.click(container.querySelector(".icon-unfold-column")!.closest("button")!);
        expect(onFoldStatus).toHaveBeenCalled();
    });
});
