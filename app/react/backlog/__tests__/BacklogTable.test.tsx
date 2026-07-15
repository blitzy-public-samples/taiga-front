/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link BacklogTable}.
 *
 * These run in a browserless jsdom environment (no network, no compiled
 * bundle). The `DndContext` provider is supplied here because the component
 * consumes `useDraggable` / `useDroppable`, which expect an ancestor context.
 *
 * The XSS assertion (a) is an explicit acceptance criterion: the user-story
 * subject must be rendered as PLAIN TEXT (React auto-escaping) and never via
 * `dangerouslySetInnerHTML`.
 */

import { render, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { BacklogTable } from "../BacklogTable";
import type { BacklogTableProps } from "../BacklogTable";
import type { Project, UserStory, UserStoryActions } from "../types";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeProject(permissions: string[] = ["modify_us", "delete_us"]): Project {
    return {
        id: 1,
        slug: "proj",
        name: "Proj",
        my_permissions: permissions,
        roles: [
            { id: 1, name: "Back", computable: true },
            { id: 2, name: "Design", computable: false },
        ],
        points: [
            { id: 10, name: "?", value: null, order: 0 },
            { id: 11, name: "1", value: 1, order: 1 },
            { id: 12, name: "2", value: 2, order: 2 },
        ],
        us_statuses: [
            { id: 100, name: "New", color: "#aaaaaa", order: 1, is_closed: false },
            { id: 101, name: "Done", color: "#00ff00", order: 2, is_closed: true },
        ],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 100,
        total_milestones: null,
        i_am_admin: true,
    };
}

function makeUs(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1000,
        ref: 1,
        subject: "A story",
        project: 1,
        status: 100,
        milestone: null,
        points: { "1": 11 },
        total_points: 1,
        backlog_order: 1,
        sprint_order: 1,
        assigned_to: null,
        is_blocked: false,
        is_closed: false,
        tags: null,
        epics: null,
        due_date: null,
        version: 1,
        ...overrides,
    };
}

function makeActions(): UserStoryActions {
    return {
        onEditUserStory: jest.fn(),
        onDeleteUserStory: jest.fn(),
        onMoveToTop: jest.fn(),
        onChangeStatus: jest.fn(),
        onChangePoints: jest.fn(),
    };
}

function makeProps(overrides: Partial<BacklogTableProps> = {}): BacklogTableProps {
    const project = overrides.project ?? makeProject();
    const userstories = overrides.userstories ?? [makeUs()];
    return {
        project,
        userstories,
        visibleRefs: userstories.map((us) => us.ref),
        showTags: false,
        activeFilters: false,
        displayVelocity: false,
        firstUsInBacklog: null,
        loadingUserstories: false,
        dragEnabled: true,
        selectedRefs: {},
        canLoadMore: false,
        onLoadMore: jest.fn(),
        onToggleSelection: jest.fn(),
        actions: makeActions(),
        ...overrides,
    };
}

function renderTable(props: BacklogTableProps): { container: HTMLElement } {
    const result = render(
        <DndContext>
            <BacklogTable {...props} />
        </DndContext>,
    );
    return { container: result.container };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("BacklogTable", () => {
    // (a) XSS SAFETY — mandatory acceptance criterion.
    it("renders the user-story subject as plain text (no HTML injection)", () => {
        const malicious = '<img src=x onerror=alert(1)>';
        const props = makeProps({ userstories: [makeUs({ subject: malicious })] });
        const { container } = renderTable(props);

        // The injected <img> must NOT become a real element.
        expect(container.querySelector("img")).toBeNull();
        // It must appear verbatim as text.
        expect(container.querySelector(".user-story-name")?.textContent).toBe(malicious);
    });

    // (b) Rows are filtered by visibleRefs (inArray on ref).
    it("only renders rows whose ref is in visibleRefs", () => {
        const userstories = [
            makeUs({ id: 1000, ref: 1 }),
            makeUs({ id: 2000, ref: 2 }),
            makeUs({ id: 3000, ref: 3 }),
        ];
        const props = makeProps({ userstories, visibleRefs: [1, 3] });
        const { container } = renderTable(props);

        expect(container.querySelectorAll(".us-item-row")).toHaveLength(2);
        const numbers = Array.from(container.querySelectorAll(".user-story-number")).map(
            (node) => node.textContent,
        );
        expect(numbers).toEqual(["#1", "#3"]);
    });

    // (c) Selecting a status in the popover calls onChangeStatus(us, statusId).
    it("calls onChangeStatus when a status is picked from the popover", () => {
        const us = makeUs({ status: 100 });
        const props = makeProps({ userstories: [us] });
        const { container } = renderTable(props);

        // Open the status popover.
        const statusTrigger = container.querySelector(".us-status");
        expect(statusTrigger).not.toBeNull();
        fireEvent.click(statusTrigger as Element);

        // Pick "Done" (id 101).
        const doneOption = container.querySelector('.pop-status a[data-status-id="101"]');
        expect(doneOption).not.toBeNull();
        fireEvent.click(doneOption as Element);

        expect(props.actions.onChangeStatus).toHaveBeenCalledTimes(1);
        expect(props.actions.onChangeStatus).toHaveBeenCalledWith(us, 101);
    });

    // (d) Options popup: move-to-top hidden for the first US, shown otherwise;
    //     edit/delete invoke the right actions.
    it("hides 'move to top' for the first backlog story and shows it for others", () => {
        const first = makeUs({ id: 100, ref: 1 });
        const other = makeUs({ id: 200, ref: 2 });
        const props = makeProps({
            userstories: [first, other],
            firstUsInBacklog: 100,
        });
        const { container } = renderTable(props);

        const firstRow = container.querySelector('[data-id="100"]') as HTMLElement;
        const otherRow = container.querySelector('[data-id="200"]') as HTMLElement;

        // Open the first row's options popup → no move-to-top action.
        fireEvent.click(firstRow.querySelector(".us-option-popup-button") as Element);
        expect(firstRow.querySelector(".us-option-popup")).not.toBeNull();
        expect(firstRow.querySelector(".move-to-top")).toBeNull();
        expect(firstRow.querySelector(".us-option-popup")?.className).toContain("first");

        // Open the other row's options popup → move-to-top present.
        fireEvent.click(otherRow.querySelector(".us-option-popup-button") as Element);
        expect(otherRow.querySelector(".move-to-top")).not.toBeNull();
    });

    it("invokes edit / delete / move-to-top actions from the options popup", () => {
        const first = makeUs({ id: 100, ref: 1 });
        const other = makeUs({ id: 200, ref: 2 });
        const props = makeProps({
            userstories: [first, other],
            firstUsInBacklog: 100,
        });
        const { container } = renderTable(props);

        const firstRow = container.querySelector('[data-id="100"]') as HTMLElement;
        const otherRow = container.querySelector('[data-id="200"]') as HTMLElement;

        // Edit on the first row.
        fireEvent.click(firstRow.querySelector(".us-option-popup-button") as Element);
        fireEvent.click(firstRow.querySelector(".edit-story") as Element);
        expect(props.actions.onEditUserStory).toHaveBeenCalledWith(first);

        // Delete on the first row (reopen — selecting edit closed it).
        fireEvent.click(firstRow.querySelector(".us-option-popup-button") as Element);
        fireEvent.click(firstRow.querySelector(".e2e-delete") as Element);
        expect(props.actions.onDeleteUserStory).toHaveBeenCalledWith(first);

        // Move-to-top on the non-first row.
        fireEvent.click(otherRow.querySelector(".us-option-popup-button") as Element);
        fireEvent.click(otherRow.querySelector(".move-to-top") as Element);
        expect(props.actions.onMoveToTop).toHaveBeenCalledWith(other);
    });

    // (e) Checkbox toggle calls onToggleSelection(ref, checked, shiftKey).
    it("calls onToggleSelection when the row checkbox is toggled", () => {
        const us = makeUs({ ref: 7 });
        const props = makeProps({ userstories: [us], visibleRefs: [7] });
        const { container } = renderTable(props);

        const checkbox = container.querySelector("#us-check-7") as HTMLInputElement;
        expect(checkbox).not.toBeNull();
        fireEvent.click(checkbox);

        expect(props.onToggleSelection).toHaveBeenCalledTimes(1);
        expect(props.onToggleSelection).toHaveBeenCalledWith(7, true, false);
    });

    // (f) Without modify_us: drag handle & checkbox hidden, row is readonly.
    it("hides the drag handle and checkbox and marks the row readonly without modify_us", () => {
        const props = makeProps({ project: makeProject([]) });
        const { container } = renderTable(props);

        const row = container.querySelector(".us-item-row") as HTMLElement;
        expect(row.className).toContain("readonly");
        expect(container.querySelector(".draggable-us-row")).toBeNull();
        expect(container.querySelector(".custom-checkbox")).toBeNull();
        // The options popup (edit/delete/move) is also gated by modify_us.
        expect(container.querySelector(".us-option")).toBeNull();
    });

    // Points display: unestimated stories show "?", estimated show the total.
    it("renders the points total, falling back to '?' when unestimated", () => {
        const estimated = makeUs({ id: 100, ref: 1, total_points: 5 });
        const unestimated = makeUs({
            id: 200,
            ref: 2,
            total_points: null,
            points: {},
        });
        const props = makeProps({ userstories: [estimated, unestimated] });
        const { container } = renderTable(props);

        const points = Array.from(container.querySelectorAll(".us-points")).map(
            (node) => node.textContent,
        );
        expect(points).toEqual(["5", "?"]);
    });

    // Header role selector: picking a role switches the points cell to that
    // role's value; "All points" restores the total. Display-only (no persist).
    it("switches the points display when a role is chosen in the header selector", () => {
        // total_points (9) differs from role 1's point value (2) so we can tell
        // which one is displayed.
        const us = makeUs({ total_points: 9, points: { "1": 12 } });
        const props = makeProps({ userstories: [us] });
        const { container } = renderTable(props);

        expect(container.querySelector(".us-points")?.textContent).toBe("9");

        // Open the header role selector and pick role 1 ("Back").
        fireEvent.click(container.querySelector(".backlog-table-header .inner") as Element);
        fireEvent.click(container.querySelector('.pop-role a[data-role-id="1"]') as Element);
        expect(container.querySelector(".us-points")?.textContent).toBe("2");

        // Restore "All points" → total again.
        fireEvent.click(container.querySelector(".backlog-table-header .inner") as Element);
        fireEvent.click(container.querySelector(".pop-role .clear-selection") as Element);
        expect(container.querySelector(".us-points")?.textContent).toBe("9");
    });

    // Points popover: selecting a point calls onChangePoints(us, roleId, pointId).
    it("calls onChangePoints when a point is picked from the points popover", () => {
        const us = makeUs();
        const props = makeProps({ userstories: [us] });
        const { container } = renderTable(props);

        // Open the points popover on the row.
        fireEvent.click(container.querySelector(".us-points") as Element);
        // Only computable role 1 is listed; its point anchors are [?, 1, 2].
        const pointLinks = container.querySelectorAll(".pop-points a");
        expect(pointLinks).toHaveLength(3);
        fireEvent.click(pointLinks[2] as Element); // point id 12

        expect(props.actions.onChangePoints).toHaveBeenCalledWith(us, 1, 12);
    });

    // Tags are rendered only when showTags is true, with the last one flagged.
    it("renders tags with the correct classes when showTags is true", () => {
        const us = makeUs({
            tags: [
                ["urgent", "#ff0000"],
                ["backend", null],
            ],
        });
        const props = makeProps({ userstories: [us], showTags: true });
        const { container } = renderTable(props);

        const tags = container.querySelectorAll(".tag");
        expect(tags).toHaveLength(2);
        expect(tags[0].textContent).toBe("urgent");
        expect(tags[1].className).toContain("last");
    });

    // Popovers close on an outside click and on Escape (usePopover behavior).
    it("closes an open popover on outside click and on Escape", () => {
        const props = makeProps({ userstories: [makeUs()] });
        const { container } = renderTable(props);

        // Outside click closes it.
        fireEvent.click(container.querySelector(".us-status") as Element);
        expect(container.querySelector(".pop-status")).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(container.querySelector(".pop-status")).toBeNull();

        // Escape closes it.
        fireEvent.click(container.querySelector(".us-status") as Element);
        expect(container.querySelector(".pop-status")).not.toBeNull();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(container.querySelector(".pop-status")).toBeNull();
    });
});
