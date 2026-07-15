/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { fireEvent, render } from "@testing-library/react";
import { Card } from "../Card";
import { retrieveUserStoryData } from "../useKanbanState";
import type {
    KanbanProject,
    UsersById,
    UserStoryModel,
    UsView,
} from "../useKanbanState";

const ZOOM: string[][] = [
    ["assigned_to", "ref"],
    ["assigned_to", "ref", "subject", "card-data", "assigned_to_extended"],
    ["assigned_to", "ref", "subject", "card-data", "assigned_to_extended", "tags", "extra_info", "unfold"],
    ["assigned_to", "ref", "subject", "card-data", "assigned_to_extended", "tags", "extra_info", "unfold", "related_tasks", "attachments"],
];
const usersById: UsersById = {
    10: { id: 10, username: "alice", full_name_display: "Alice A", photo: "a.png" },
};
const project: KanbanProject = { id: 7, my_permissions: ["modify_us"] };
/** A project granting BOTH modify + delete so the Delete action renders (QA F1). */
const projectRW: KanbanProject = { id: 7, my_permissions: ["modify_us", "delete_us"] };

/**
 * Open a card's actions popover via its real toggler button.
 *
 * The Edit / Assign to / Delete items render ONLY inside `{actionsOpen && ...}`
 * (Card.tsx). A trustworthy assertion MUST open the menu first: querying those
 * items without opening the menu always yields `null`, which is exactly the
 * false-positive `if (element)` pattern QA finding F1 flagged (a neutralized
 * `onClickEdit`/`onClickDelete` slipped through undetected).
 */
function openActionsMenu(container: HTMLElement): void {
    const toggle = container.querySelector(".card-actions .js-popup-button");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
}

function view(over: Partial<UserStoryModel> & { id: number }): UsView {
    const model = { status: 1, swimlane: null, kanban_order: 1, ...over } as UserStoryModel;
    return retrieveUserStoryData(model, usersById, {});
}

describe("Card DOM contract", () => {
    it("carries data-id/data-status/data-swimlane matching the tg-card Jade markup", () => {
        const { container } = render(
            <Card item={view({ id: 101, status: 3, swimlane: 55 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(el).toHaveAttribute("data-id", "101");
        expect(el).toHaveAttribute("data-status", "3");
        expect(el).toHaveAttribute("data-swimlane", "55");
    });
    it("maps a null swimlane to the -1 sentinel in data-swimlane", () => {
        const { container } = render(
            <Card item={view({ id: 1, swimlane: null })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        expect(container.querySelector("[data-id]")).toHaveAttribute("data-swimlane", "-1");
    });
});

describe("Card XSS-safe output", () => {
    it("renders a malicious subject as inert text (no injected <script>/<img>)", () => {
        const evil = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">';
        const { container } = render(
            <Card item={view({ id: 1, subject: evil })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const subject = container.querySelector(".card-subject.e2e-title")!;
        expect(subject.textContent).toBe(evil);
        // React escaped it: no real element nodes were created from the payload
        expect(container.querySelector("script")).toBeNull();
        // the injected <img src=x onerror> payload must NOT become a live element
        expect(container.querySelector('img[src="x"]')).toBeNull();
        expect(container.querySelector("img[onerror]")).toBeNull();
        expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    });
});

describe("Card cumulative zoom visibility", () => {
    it("hides the subject at zoom level 0 and shows it from level 1", () => {
        const { container: c0 } = render(
            <Card item={view({ id: 1, subject: "Hi", ref: 1 })} project={project} zoom={ZOOM[0]} zoomLevel={0} />,
        );
        expect(c0.querySelector(".card-subject")).toBeNull();
        expect(c0.querySelector(".card-ref")).not.toBeNull();

        const { container: c1 } = render(
            <Card item={view({ id: 1, subject: "Hi", ref: 1 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        expect(c1.querySelector(".card-subject")!.textContent).toBe("Hi");
    });
    it("shows tags only from zoom level 2", () => {
        const item = view({ id: 1, subject: "Hi", tags: [["t", "#fff"]] });
        const { container: c1 } = render(
            <Card item={item} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        expect(c1.querySelector(".card-tags")).toBeNull();
        const { container: c2 } = render(
            <Card item={item} project={project} zoom={ZOOM[2]} zoomLevel={2} />,
        );
        expect(c2.querySelector(".card-tags")).not.toBeNull();
    });
});

describe("Card assignee + actions", () => {
    it("shows the assignee avatar area at zoom>=0", () => {
        const { container } = render(
            <Card item={view({ id: 1, assigned_to: 10 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        expect(container.querySelector(".wrapper-assigned-to-data")).not.toBeNull();
    });

    it("does not render the actions menu until the popup button is clicked", () => {
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={projectRW} zoom={ZOOM[2]} zoomLevel={2} />,
        );
        // Closed by default: the action items are absent from the DOM.
        expect(container.querySelector(".card-actions-menu")).toBeNull();
        expect(container.querySelector(".card-action-edit")).toBeNull();
        expect(container.querySelector(".card-action-delete")).toBeNull();

        openActionsMenu(container);
        expect(container.querySelector(".card-actions-menu")).not.toBeNull();
    });

    it("fires onClickEdit with the story id when the Edit action is clicked", () => {
        const onClickEdit = jest.fn();
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={project} zoom={ZOOM[2]} zoomLevel={2} onClickEdit={onClickEdit} />,
        );
        openActionsMenu(container);
        const edit = container.querySelector(".card-action-edit");
        expect(edit).not.toBeNull();
        fireEvent.click(edit!);
        expect(onClickEdit).toHaveBeenCalledTimes(1);
        expect(onClickEdit).toHaveBeenCalledWith(42);
    });

    it("fires onClickAssignedTo with the story id when the Assign to action is clicked", () => {
        const onClickAssignedTo = jest.fn();
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={project} zoom={ZOOM[2]} zoomLevel={2} onClickAssignedTo={onClickAssignedTo} />,
        );
        openActionsMenu(container);
        const assign = container.querySelector(".card-action-assigned-to");
        expect(assign).not.toBeNull();
        fireEvent.click(assign!);
        expect(onClickAssignedTo).toHaveBeenCalledTimes(1);
        expect(onClickAssignedTo).toHaveBeenCalledWith(42);
    });

    it("fires onClickDelete with the story id when the Delete action is clicked (delete permission)", () => {
        const onClickDelete = jest.fn();
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={projectRW} zoom={ZOOM[2]} zoomLevel={2} onClickDelete={onClickDelete} />,
        );
        openActionsMenu(container);
        const del = container.querySelector(".card-action-delete");
        expect(del).not.toBeNull();
        fireEvent.click(del!);
        expect(onClickDelete).toHaveBeenCalledTimes(1);
        expect(onClickDelete).toHaveBeenCalledWith(42);
    });

    it("hides the Delete action when the project lacks delete permission", () => {
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={project} zoom={ZOOM[2]} zoomLevel={2} />,
        );
        openActionsMenu(container);
        // `project` grants modify_us but NOT delete_us: Edit/Assign present, Delete absent.
        expect(container.querySelector(".card-action-edit")).not.toBeNull();
        expect(container.querySelector(".card-action-assigned-to")).not.toBeNull();
        expect(container.querySelector(".card-action-delete")).toBeNull();
    });

    it("closes the actions menu after an action is chosen", () => {
        const { container } = render(
            <Card item={view({ id: 42, subject: "Hi" })} project={projectRW} zoom={ZOOM[2]} zoomLevel={2} onClickEdit={jest.fn()} />,
        );
        openActionsMenu(container);
        expect(container.querySelector(".card-actions-menu")).not.toBeNull();
        fireEvent.click(container.querySelector(".card-action-edit")!);
        expect(container.querySelector(".card-actions-menu")).toBeNull();
    });
});

describe("Card rich render at max zoom", () => {
    const richUsers: UsersById = {
        10: { id: 10, username: "a", full_name_display: "A", photo: "a.png" },
        11: { id: 11, username: "b", full_name_display: "B", photo: "b.png" },
        12: { id: 12, username: "c", full_name_display: "C", photo: "c.png" },
        13: { id: 13, username: "d", full_name_display: "D", photo: "d.png" },
        14: { id: 14, username: "e", full_name_display: "E", photo: "e.png" },
    };
    function richView(): UsView {
        const model = {
            id: 200, status: 1, swimlane: null, kanban_order: 1, ref: 200, subject: "Rich",
            assigned_to: 10, assigned_users: [10, 11, 12, 13, 14],
            tags: [["x", "#111"]], is_blocked: true, total_points: 8,
            total_attachments: 2, total_comments: 3, watchers: [1, 2],
            epics: [{ id: 1, ref: 5, subject: "Epic", color: "#0af" }],
            tasks: [
                { id: 1, ref: 11, subject: "T1", is_closed: true, is_blocked: false },
                { id: 2, ref: 12, subject: "T2", is_closed: false, is_blocked: true },
            ],
            attachments: [{ id: 1, thumbnail_card_url: "img.png" }],
        } as UserStoryModel;
        return retrieveUserStoryData(model, richUsers, {});
    }

    it("renders card-data, statistics, epics, lock, tasks and the +N assignee badge", () => {
        const { container } = render(
            <Card item={richView()} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        expect(container.querySelector(".card-data")).not.toBeNull();
        expect(container.querySelector(".card-estimation")!.textContent).toBe("8");
        expect(container.querySelector(".card-lock")).not.toBeNull();
        expect(container.querySelector(".card-attachments")).not.toBeNull();
        expect(container.querySelector(".card-comments")).not.toBeNull();
        expect(container.querySelector(".card-tasks")).not.toBeNull();
        expect(container.querySelectorAll(".card-task").length).toBe(2);
        expect(container.querySelector(".card-epic")).not.toBeNull();
        expect(container.querySelector(".extra-assigned")!.textContent).toContain("3+");
    });

    it("shows 'No pts' when the story has no points", () => {
        const model = { id: 201, status: 1, swimlane: null, kanban_order: 1, subject: "NP" } as UserStoryModel;
        const { container } = render(
            <Card item={retrieveUserStoryData(model, richUsers, {})} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        expect(container.querySelector(".card-estimation")!.textContent).toBe("No pts");
    });

    it("fires onToggleFold with the story id from the unfold affordance", () => {
        const onToggleFold = jest.fn();
        const { container } = render(
            <Card item={richView()} project={project} zoom={ZOOM[3]} zoomLevel={3}
                onToggleFold={onToggleFold} />,
        );
        const unfold = container.querySelector(".card-unfold");
        expect(unfold).not.toBeNull();
        fireEvent.click(unfold!);
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenCalledWith(200);
    });

    it("fires edit/assign/delete with the story id from the actions menu at max zoom", () => {
        const onClickEdit = jest.fn();
        const onClickAssignedTo = jest.fn();
        const onClickDelete = jest.fn();

        const edit = render(
            <Card item={richView()} project={projectRW} zoom={ZOOM[3]} zoomLevel={3} onClickEdit={onClickEdit} />,
        );
        fireEvent.click(edit.container.querySelector(".card-actions .js-popup-button")!);
        fireEvent.click(edit.container.querySelector(".card-action-edit")!);
        expect(onClickEdit).toHaveBeenCalledWith(200);

        const assign = render(
            <Card item={richView()} project={projectRW} zoom={ZOOM[3]} zoomLevel={3} onClickAssignedTo={onClickAssignedTo} />,
        );
        fireEvent.click(assign.container.querySelector(".card-actions .js-popup-button")!);
        fireEvent.click(assign.container.querySelector(".card-action-assigned-to")!);
        expect(onClickAssignedTo).toHaveBeenCalledWith(200);

        const del = render(
            <Card item={richView()} project={projectRW} zoom={ZOOM[3]} zoomLevel={3} onClickDelete={onClickDelete} />,
        );
        fireEvent.click(del.container.querySelector(".card-actions .js-popup-button")!);
        fireEvent.click(del.container.querySelector(".card-action-delete")!);
        expect(onClickDelete).toHaveBeenCalledWith(200);
    });

    it("uses a custom resolveAvatar when provided", () => {
        const resolveAvatar = jest.fn().mockReturnValue("custom.png");
        render(
            <Card item={richView()} project={project} zoom={ZOOM[3]} zoomLevel={3} resolveAvatar={resolveAvatar} />,
        );
        expect(resolveAvatar).toHaveBeenCalled();
    });
});
