/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { fireEvent, render, waitFor } from "@testing-library/react";
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
 * QA-FUNC-11: an ARCHIVED project (truthy `archived_code`) that still grants
 * modify + delete permissions. AngularJS `projectService.canEdit` returns false
 * on an archived project regardless of `my_permissions`, so no edit/delete
 * affordance may render.
 */
const projectArchived: KanbanProject = {
    id: 7,
    my_permissions: ["modify_us", "delete_us"],
    archived_code: "blocked-by-owner-leaving",
};

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

    it("hides the card-actions trigger entirely on an archived project (QA-FUNC-11)", () => {
        // Even with modify_us + delete_us granted, an archived project disables
        // all editing affordances (canEdit === false when archived), so the ⋮
        // trigger button itself must not render.
        const { container } = render(
            <Card
                item={view({ id: 42, subject: "Hi" })}
                project={projectArchived}
                zoom={ZOOM[2]}
                zoomLevel={2}
            />,
        );
        expect(container.querySelector(".card-actions")).toBeNull();
        expect(container.querySelector(".card-actions .js-popup-button")).toBeNull();
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

    // [M-13] "Move to top" card action, ported from the legacy card-actions
    // popover gated on `canEdit(getModifyPermisionKey()) && !isFirst`
    // (kanban/main.coffee L1090-L1097). It fires `onClickMoveToTop(id)`.
    it("fires onClickMoveToTop with the story id when the Move-to-top action is clicked (not first card)", () => {
        const onClickMoveToTop = jest.fn();
        const { container } = render(
            <Card
                item={view({ id: 42, subject: "Hi" })}
                project={project}
                zoom={ZOOM[2]}
                zoomLevel={2}
                isFirst={false}
                onClickMoveToTop={onClickMoveToTop}
            />,
        );
        openActionsMenu(container);
        const moveTop = container.querySelector(".card-action-move-to-top");
        expect(moveTop).not.toBeNull();
        fireEvent.click(moveTop!);
        expect(onClickMoveToTop).toHaveBeenCalledTimes(1);
        expect(onClickMoveToTop).toHaveBeenCalledWith(42);
    });

    it("hides the Move-to-top action for the first card in its column (isFirst)", () => {
        const { container } = render(
            <Card
                item={view({ id: 42, subject: "Hi" })}
                project={project}
                zoom={ZOOM[2]}
                zoomLevel={2}
                isFirst
                onClickMoveToTop={jest.fn()}
            />,
        );
        openActionsMenu(container);
        // `project` grants modify_us, but the card is first -> no move-to-top.
        expect(container.querySelector(".card-action-edit")).not.toBeNull();
        expect(container.querySelector(".card-action-move-to-top")).toBeNull();
    });

    it("hides the Move-to-top action when the project lacks modify permission", () => {
        // view_us only: no modify_us -> the ⋮ trigger does not even render.
        const { container } = render(
            <Card
                item={view({ id: 42, subject: "Hi" })}
                project={projectReadOnly}
                zoom={ZOOM[2]}
                zoomLevel={2}
                isFirst={false}
                onClickMoveToTop={jest.fn()}
            />,
        );
        expect(container.querySelector(".card-actions")).toBeNull();
        expect(container.querySelector(".card-action-move-to-top")).toBeNull();
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
        expect(container.querySelector(".card-estimation")!.textContent).toBe("8 pts");
        expect(container.querySelector(".card-lock")).not.toBeNull();
        expect(container.querySelector(".card-attachments")).not.toBeNull();
        expect(container.querySelector(".card-comments")).not.toBeNull();
        expect(container.querySelector(".card-tasks")).not.toBeNull();
        expect(container.querySelectorAll(".card-task").length).toBe(2);
        expect(container.querySelector(".card-epic")).not.toBeNull();
        expect(container.querySelector(".extra-assigned")!.textContent).toContain("3+");
    });

    it("shows 'N/E' when the story has no points", () => {
        const model = { id: 201, status: 1, swimlane: null, kanban_order: 1, subject: "NP" } as UserStoryModel;
        const { container } = render(
            <Card item={retrieveUserStoryData(model, richUsers, {})} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        expect(container.querySelector(".card-estimation")!.textContent).toBe("N/E");
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

    it("[M-21] the unfold affordance is keyboard-operable (Enter/Space) and named", () => {
        const onToggleFold = jest.fn();
        const { container } = render(
            <Card item={richView()} project={project} zoom={ZOOM[3]} zoomLevel={3}
                onToggleFold={onToggleFold} />,
        );
        const unfold = container.querySelector(".card-unfold") as HTMLElement;
        expect(unfold).not.toBeNull();
        // Accessible name for assistive tech (the legacy control had none).
        expect((unfold.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
        // Keyboard activation: Enter toggles the fold…
        fireEvent.keyDown(unfold, { key: "Enter" });
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenLastCalledWith(200);
        // …and Space toggles it too.
        fireEvent.keyDown(unfold, { key: " " });
        expect(onToggleFold).toHaveBeenCalledTimes(2);
        expect(onToggleFold).toHaveBeenLastCalledWith(200);
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

    it("[M-21] the actions popup implements a complete ARIA menu (roles, controls, roving focus, Escape)", async () => {
        const { container } = render(
            <Card item={richView()} project={projectRW} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        const trigger = container.querySelector(
            ".card-actions .js-popup-button",
        ) as HTMLButtonElement;
        // Trigger advertises a menu popup.
        expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");

        fireEvent.click(trigger);

        const menu = container.querySelector(".card-actions-menu") as HTMLElement;
        expect(menu).not.toBeNull();
        // Menu semantics + wiring.
        expect(menu.getAttribute("role")).toBe("menu");
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
        expect(menu.id.length).toBeGreaterThan(0);

        const items = Array.from(
            menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        );
        // edit + assign + delete + move-to-top (richView is not the first card here).
        expect(items.length).toBeGreaterThanOrEqual(3);

        // Focus lands on the first item once the popup is rendered (post-paint).
        await waitFor(() => expect(document.activeElement).toBe(items[0]));

        // ArrowDown / ArrowUp move a roving focus between items.
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(items[1]);
        fireEvent.keyDown(menu, { key: "ArrowUp" });
        expect(document.activeElement).toBe(items[0]);

        // Home / End jump to the extremes.
        fireEvent.keyDown(menu, { key: "End" });
        expect(document.activeElement).toBe(items[items.length - 1]);
        fireEvent.keyDown(menu, { key: "Home" });
        expect(document.activeElement).toBe(items[0]);

        // Escape closes the menu and returns focus to the trigger.
        fireEvent.keyDown(menu, { key: "Escape" });
        expect(container.querySelector(".card-actions-menu")).toBeNull();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    });

    it("uses a custom resolveAvatar when provided", () => {
        const resolveAvatar = jest.fn().mockReturnValue("custom.png");
        render(
            <Card item={richView()} project={project} zoom={ZOOM[3]} zoomLevel={3} resolveAvatar={resolveAvatar} />,
        );
        expect(resolveAvatar).toHaveBeenCalled();
    });
});

describe("Card visual fidelity — due date, iocaine, points, avatar fallback", () => {
    it("suffixes points with ' pts' and shows a title of 'Estimation' (QA-VIS-10)", () => {
        const { container } = render(
            <Card item={view({ id: 310, total_points: 2 })} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        const est = container.querySelector(".card-estimation")!;
        expect(est.textContent).toBe("2 pts");
        expect(est.getAttribute("title")).toBe("Estimation");
    });

    it("renders .card-due-date with an icon-clock and status-suffixed title (QA-VIS-08)", () => {
        const { container } = render(
            <Card
                item={view({ id: 311, due_date: "2024-01-15" })}
                project={project}
                zoom={ZOOM[3]}
                zoomLevel={3}
            />,
        );
        const due = container.querySelector(".card-due-date");
        expect(due).not.toBeNull();
        // The sprite icon renders as <tg-svg><svg class="icon icon-clock">…</svg></tg-svg>.
        expect(due!.querySelector("svg.icon.icon-clock")).not.toBeNull();
        // A far-past date resolves to the "past due" appearance; the outer title
        // is the formatted date with the status name, and the icon <title> is the
        // localized "Due date: …" string.
        expect(due!.getAttribute("title")).toContain("(past due)");
        expect(due!.querySelector("svg title")!.textContent).toContain("Due date:");
    });

    it("omits .card-due-date when the story has no due_date (QA-VIS-08)", () => {
        const { container } = render(
            <Card item={view({ id: 312 })} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        expect(container.querySelector(".card-due-date")).toBeNull();
    });

    it("renders .card-iocaine with an icon-iocaine when is_iocaine (QA-VIS-09)", () => {
        const { container } = render(
            <Card
                item={view({ id: 313, is_iocaine: true })}
                project={project}
                zoom={ZOOM[3]}
                zoomLevel={3}
            />,
        );
        const iocaine = container.querySelector(".card-iocaine");
        expect(iocaine).not.toBeNull();
        expect(iocaine!.querySelector("svg.icon.icon-iocaine")).not.toBeNull();
        expect(iocaine!.getAttribute("title")).toBe("Is iocaine");
    });

    it("omits .card-iocaine when is_iocaine is falsy (QA-VIS-09)", () => {
        const { container } = render(
            <Card item={view({ id: 314 })} project={project} zoom={ZOOM[3]} zoomLevel={3} />,
        );
        expect(container.querySelector(".card-iocaine")).toBeNull();
    });

    it("gives the not-assigned avatar an unnamed.png fallback src (QA-VIS-07)", () => {
        const { container } = render(
            <Card item={view({ id: 315 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const img = container.querySelector(".card-not-assigned img") as HTMLImageElement | null;
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toContain("images/unnamed.png");
    });

    it("falls back to unnamed.png for an assigned user without a photo (QA-VIS-07)", () => {
        const nullPhotoUsers: UsersById = {
            20: { id: 20, username: "z", full_name_display: "Z", photo: null },
        };
        const model = {
            id: 316,
            status: 1,
            swimlane: null,
            kanban_order: 1,
            assigned_to: 20,
            assigned_users: [20],
        } as UserStoryModel;
        const { container } = render(
            <Card
                item={retrieveUserStoryData(model, nullPhotoUsers, {})}
                project={project}
                zoom={ZOOM[1]}
                zoomLevel={1}
            />,
        );
        const img = container.querySelector(".card-assigned-to img") as HTMLImageElement | null;
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toContain("images/unnamed.png");
    });
});

/* ==========================================================================
 * QA-A11Y-02 — drag-affordance gating on non-draggable cards
 * QA-FUNC-01 — ctrl/meta-click multi-select
 * ========================================================================== */

/** A read-only project (view but not modify) — DnD must be fully disabled. */
const projectReadOnly: KanbanProject = { id: 7, my_permissions: ["view_us"] };

describe("Card drag-affordance gating (QA-A11Y-02)", () => {
    it("exposes the sortable keyboard/ARIA affordances when the board is draggable", () => {
        // A draggable project (modify_us, not archived) must let a keyboard user
        // tab onto the card and pick it up.
        const { container } = render(
            <Card item={view({ id: 201 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(el).toHaveAttribute("tabindex", "0");
        expect(el).toHaveAttribute("aria-roledescription", "sortable");
        expect(el).toHaveAttribute("role", "button");
    });

    it("OMITS the sortable affordances on a read-only board", () => {
        // No modify_us -> DnD disabled -> the card must NOT be a keyboard/ARIA
        // drag target (no tabindex, no aria-roledescription, no role=button).
        const { container } = render(
            <Card item={view({ id: 202 })} project={projectReadOnly} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(el).not.toHaveAttribute("tabindex");
        expect(el).not.toHaveAttribute("aria-roledescription");
        expect(el).not.toHaveAttribute("role");
    });

    it("OMITS the sortable affordances on an archived board even with modify_us (QA-A11Y-02)", () => {
        const { container } = render(
            <Card item={view({ id: 203 })} project={projectArchived} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(el).not.toHaveAttribute("tabindex");
        expect(el).not.toHaveAttribute("aria-roledescription");
    });
});

describe("Card multi-select ctrl/meta-click (QA-FUNC-01)", () => {
    it("toggles selection on ctrl-click and on meta-click, but NOT on a plain click", () => {
        const onToggleSelect = jest.fn();
        const { container } = render(
            <Card
                item={view({ id: 301 })}
                project={project}
                zoom={ZOOM[1]}
                zoomLevel={1}
                onToggleSelect={onToggleSelect}
            />,
        );
        const el = container.querySelector("[data-id]")!;

        fireEvent.click(el);
        expect(onToggleSelect).not.toHaveBeenCalled();

        fireEvent.click(el, { ctrlKey: true });
        expect(onToggleSelect).toHaveBeenCalledWith(301);

        fireEvent.click(el, { metaKey: true });
        expect(onToggleSelect).toHaveBeenCalledTimes(2);
    });

    it("renders the selected classes when the card is selected", () => {
        const { container } = render(
            <Card item={view({ id: 302 })} project={project} zoom={ZOOM[1]} zoomLevel={1} selected />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(el.className).toContain("kanban-task-selected");
        expect(el.className).toContain("ui-multisortable-multiple");
    });

    it("is a safe no-op on ctrl-click when no onToggleSelect handler is supplied", () => {
        const { container } = render(
            <Card item={view({ id: 303 })} project={project} zoom={ZOOM[1]} zoomLevel={1} />,
        );
        const el = container.querySelector("[data-id]")!;
        expect(() => fireEvent.click(el, { ctrlKey: true })).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// [N-04] baseHref-aware epic/task navigation destinations.
// The initial migration emitted no-op `card-epic` anchors and a literal
// `href="#"` task link; both now resolve to the exact surviving AngularJS
// routes (`project-epics-detail` / `project-tasks-detail`).
// ---------------------------------------------------------------------------
describe("Card [N-04] epic/task link destinations", () => {
    const projectWithSlug: KanbanProject = {
        id: 7,
        my_permissions: ["modify_us"],
        slug: "proj",
    };

    it("expanded (zoom>0) epic link targets /project/:slug/epic/:ref", () => {
        const { container } = render(
            <Card
                item={view({
                    id: 1,
                    ref: 5,
                    epics: [{ id: 9, ref: 3, color: "#f00", subject: "Epic" }],
                })}
                project={projectWithSlug}
                zoom={ZOOM[2]}
                zoomLevel={2}
            />,
        );
        const link = container.querySelector(
            ".card-epics .card-epic",
        ) as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.getAttribute("href")).toBe("/project/proj/epic/3");
    });

    it("compact (zoom 0) epic link targets the same epic detail URL", () => {
        const { container } = render(
            <Card
                item={view({
                    id: 1,
                    ref: 5,
                    epics: [{ id: 9, ref: 3, color: "#f00", subject: "Epic" }],
                })}
                project={projectWithSlug}
                zoom={ZOOM[0]}
                zoomLevel={0}
            />,
        );
        const link = container.querySelector(
            ".card-compact-epics .card-epic",
        ) as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.getAttribute("href")).toBe("/project/proj/epic/3");
    });

    it("task link targets /project/:slug/task/:ref (no more href=#)", () => {
        const { container } = render(
            <Card
                item={view({
                    id: 1,
                    ref: 5,
                    tasks: [
                        {
                            id: 8,
                            ref: 4,
                            subject: "Task",
                            is_closed: false,
                            is_blocked: false,
                        },
                    ],
                })}
                project={projectWithSlug}
                zoom={ZOOM[3]}
                zoomLevel={3}
            />,
        );
        const link = container.querySelector(
            ".card-tasks .card-task a",
        ) as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.getAttribute("href")).toBe("/project/proj/task/4");
    });

    it("omits the href entirely when the project slug is unavailable", () => {
        const { container } = render(
            <Card
                item={view({
                    id: 1,
                    ref: 5,
                    epics: [{ id: 9, ref: 3, color: "#f00", subject: "Epic" }],
                })}
                project={project}
                zoom={ZOOM[2]}
                zoomLevel={2}
            />,
        );
        const link = container.querySelector(
            ".card-epics .card-epic",
        ) as HTMLAnchorElement;
        expect(link).not.toBeNull();
        // No `href=""`/`"#"` placeholder that would reload/scroll the page.
        expect(link.hasAttribute("href")).toBe(false);
    });
});
