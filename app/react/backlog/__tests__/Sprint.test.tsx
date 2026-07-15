/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `Sprint` card (app/react/backlog/Sprint.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). Every render is
 * wrapped in a `<DndContext>` so the ambient `useDraggable` / `useDroppable`
 * hooks have the context that `BacklogApp` provides in production.
 *
 * Coverage focus (per the file's validation checklist):
 *  - header renders name / date range / closed+total points
 *  - progress bar width + `full` state + divide-by-zero guard
 *  - empty-sprint message variants by `modify_us` permission
 *  - collapse/expand toggle (initial state from `sprint.closed`)
 *  - edit control gated by `modify_milestone` / archived, fires `onEditSprint`
 *  - story rows: data-id, ref/subject/points, closed/blocked/readonly modifiers,
 *    epic pills, due-date marker, points-column presence
 *  - taskboard links gated by `view_milestones`
 *  - XSS safety: a subject containing markup renders as literal text
 */

import { DndContext } from "@dnd-kit/core";
import { render, screen, fireEvent } from "@testing-library/react";

import { Sprint } from "../Sprint";
import type { SprintProps } from "../Sprint";
import type { Project, Sprint as SprintModel, UserStory } from "../types";

/* -------------------------------------------------------------------------- */
/* jsdom polyfill: @dnd-kit/core useDroppable instantiates a ResizeObserver,   */
/* which jsdom does not provide. A no-op stub is sufficient for these tests.    */
/* -------------------------------------------------------------------------- */

class ResizeObserverStub {
    observe(): void {
        /* no-op */
    }
    unobserve(): void {
        /* no-op */
    }
    disconnect(): void {
        /* no-op */
    }
}

globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;

/* -------------------------------------------------------------------------- */
/* Test data factories                                                        */
/* -------------------------------------------------------------------------- */

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: "my-project",
        name: "My Project",
        my_permissions: ["view_milestones", "modify_us", "modify_milestone"],
        roles: [],
        points: [],
        us_statuses: [],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 1,
        total_milestones: null,
        i_am_admin: true,
        ...overrides,
    };
}

function makeUserStory(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 100,
        ref: 42,
        subject: "A user story",
        project: 1,
        status: 1,
        milestone: 10,
        points: {},
        total_points: 5,
        backlog_order: 0,
        sprint_order: 0,
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

function makeSprint(overrides: Partial<SprintModel> = {}): SprintModel {
    return {
        id: 10,
        name: "Sprint 1",
        slug: "sprint-1",
        project: 1,
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        closed: false,
        closed_points: 3,
        total_points: 6,
        user_stories: [],
        ...overrides,
    };
}

function renderSprint(overrides: Partial<SprintProps> = {}): ReturnType<typeof render> {
    const props: SprintProps = {
        sprint: makeSprint(),
        project: makeProject(),
        dragEnabled: true,
        onEditSprint: jest.fn(),
        ...overrides,
    };
    return render(
        <DndContext>
            <Sprint {...props} />
        </DndContext>
    );
}

/* -------------------------------------------------------------------------- */
/* Header: name / date / points                                               */
/* -------------------------------------------------------------------------- */

describe("Sprint — header", () => {
    it("renders the sprint name, formatted date range, and closed/total points", () => {
        const sprint = makeSprint({
            name: "Sprint Alpha",
            estimated_start: "2021-03-01",
            estimated_finish: "2021-03-14",
            closed_points: 4,
            total_points: 12,
        });
        const { container } = renderSprint({ sprint });

        expect(screen.getByText("Sprint Alpha")).toBeInTheDocument();
        // BACKLOG.SPRINTS.DATE = "DD MMM YYYY"; range joined with " - ".
        expect(screen.getByText("01 Mar 2021 - 14 Mar 2021")).toBeInTheDocument();

        const numbers = Array.from(
            container.querySelectorAll(".sprint-info .number")
        ).map((n) => n.textContent);
        expect(numbers).toEqual(["4", "12"]);
    });

    it("formats large point values with grouped thousands (| number parity)", () => {
        const sprint = makeSprint({ closed_points: 1234, total_points: 5678 });
        const { container } = renderSprint({ sprint });

        const numbers = Array.from(
            container.querySelectorAll(".sprint-info .number")
        ).map((n) => n.textContent);
        expect(numbers).toEqual(["1,234", "5,678"]);
    });
});

/* -------------------------------------------------------------------------- */
/* Progress bar                                                               */
/* -------------------------------------------------------------------------- */

describe("Sprint — progress bar", () => {
    it("sets the current-progress width to the clamped percentage (50%)", () => {
        const sprint = makeSprint({ closed_points: 3, total_points: 6 });
        const { container } = renderSprint({ sprint });

        const progress = container.querySelector(".current-progress") as HTMLElement;
        expect(progress).toBeTruthy();
        expect(progress.style.width).toBe("50%");
        // Not full at 50%.
        expect(container.querySelector(".sprint-progress-bar.full")).toBeNull();
        expect(container.querySelector(".current-progress.full")).toBeNull();
    });

    it("clamps to 100% and applies the `full` class when closed exceeds total", () => {
        const sprint = makeSprint({ closed_points: 10, total_points: 5 });
        const { container } = renderSprint({ sprint });

        const progress = container.querySelector(".current-progress") as HTMLElement;
        expect(progress.style.width).toBe("100%");
        expect(container.querySelector(".sprint-progress-bar.full")).not.toBeNull();
        expect(container.querySelector(".current-progress.full")).not.toBeNull();
    });

    it("guards divide-by-zero: 0 total points yields 0% and no `full`", () => {
        const sprint = makeSprint({ closed_points: 0, total_points: 0 });
        const { container } = renderSprint({ sprint });

        const progress = container.querySelector(".current-progress") as HTMLElement;
        expect(progress.style.width).toBe("0%");
        expect(container.querySelector(".sprint-progress-bar.full")).toBeNull();
    });

    it("applies `full` exactly at 100%", () => {
        const sprint = makeSprint({ closed_points: 6, total_points: 6 });
        const { container } = renderSprint({ sprint });

        const progress = container.querySelector(".current-progress") as HTMLElement;
        expect(progress.style.width).toBe("100%");
        expect(container.querySelector(".sprint-progress-bar.full")).not.toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* Empty sprint messaging                                                     */
/* -------------------------------------------------------------------------- */

describe("Sprint — empty state", () => {
    it("shows the drag-here hint when the user has modify_us", () => {
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [] }),
            project: makeProject({ my_permissions: ["modify_us", "view_milestones"] }),
        });

        expect(
            screen.getByText("Drop here Stories from your backlog to start a new sprint")
        ).toBeInTheDocument();
        // The table carries the empty-wrapper modifier.
        expect(
            container.querySelector(".sprint-table.sprint-empty-wrapper")
        ).not.toBeNull();
    });

    it("shows the anonymous message when the user lacks modify_us", () => {
        renderSprint({
            sprint: makeSprint({ user_stories: [] }),
            project: makeProject({ my_permissions: ["view_milestones"] }),
            dragEnabled: false,
        });

        expect(screen.getByText("This sprint has no user stories")).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* Collapse / expand toggle                                                   */
/* -------------------------------------------------------------------------- */

describe("Sprint — collapse toggle", () => {
    it("an open sprint starts expanded (.compact-sprint.active + .sprint-table.open)", () => {
        const { container } = renderSprint({ sprint: makeSprint({ closed: false }) });

        const button = container.querySelector(".compact-sprint") as HTMLElement;
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(button.className).toContain("active");
        expect(table.className).toContain("open");
    });

    it("a closed sprint starts collapsed (no active / open)", () => {
        const { container } = renderSprint({ sprint: makeSprint({ closed: true }) });

        const button = container.querySelector(".compact-sprint") as HTMLElement;
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(button.className).not.toContain("active");
        expect(table.className).not.toContain("open");
    });

    it("clicking .compact-sprint toggles the expanded classes", () => {
        const { container } = renderSprint({ sprint: makeSprint({ closed: false }) });

        const button = container.querySelector(".compact-sprint") as HTMLElement;
        const table = container.querySelector(".sprint-table") as HTMLElement;

        fireEvent.click(button);
        expect(button.className).not.toContain("active");
        expect(table.className).not.toContain("open");

        fireEvent.click(button);
        expect(button.className).toContain("active");
        expect(table.className).toContain("open");
    });
});

/* -------------------------------------------------------------------------- */
/* Edit control                                                               */
/* -------------------------------------------------------------------------- */

describe("Sprint — edit control", () => {
    it("renders .edit-sprint and calls onEditSprint(sprint) on click", () => {
        const onEditSprint = jest.fn();
        const sprint = makeSprint();
        const { container } = renderSprint({
            sprint,
            project: makeProject({
                my_permissions: ["modify_milestone", "view_milestones"],
            }),
            onEditSprint,
        });

        const editControl = container.querySelector(".edit-sprint") as HTMLElement;
        expect(editControl).toBeTruthy();

        fireEvent.click(editControl);
        expect(onEditSprint).toHaveBeenCalledTimes(1);
        expect(onEditSprint).toHaveBeenCalledWith(sprint);
    });

    it("hides .edit-sprint without modify_milestone permission", () => {
        const { container } = renderSprint({
            project: makeProject({ my_permissions: ["view_milestones"] }),
        });
        expect(container.querySelector(".edit-sprint")).toBeNull();
    });

    it("hides .edit-sprint when the project is archived", () => {
        const { container } = renderSprint({
            project: makeProject({
                archived_code: "ARCHIVED",
                my_permissions: ["modify_milestone", "view_milestones"],
            }),
        });
        expect(container.querySelector(".edit-sprint")).toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* Story rows                                                                 */
/* -------------------------------------------------------------------------- */

describe("Sprint — story rows", () => {
    it("renders a draggable row with data-id, ref, subject and points", () => {
        const us = makeUserStory({ id: 77, ref: 9, subject: "Do the thing", total_points: 8 });
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us], closed: false }),
        });

        const row = container.querySelector(".row.milestone-us-item-row") as HTMLElement;
        expect(row).toBeTruthy();
        // data-id is always present so DndProvider.resolveDrop can read ordered ids.
        expect(row.getAttribute("data-id")).toBe("77");

        expect(screen.getByText("#9")).toBeInTheDocument();
        expect(screen.getByText("Do the thing")).toBeInTheDocument();

        const points = container.querySelector(".column-points .points-container");
        expect(points?.textContent).toBe("8");

        // The story name links to the AngularJS hash route.
        const link = container.querySelector(".us-name") as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("#/project/my-project/us/9");
    });

    it("applies closedRow / blockedRow modifiers and keeps data-id", () => {
        const us = makeUserStory({ id: 5, is_closed: true, is_blocked: true });
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us] }),
        });

        const row = container.querySelector(".row.milestone-us-item-row") as HTMLElement;
        expect(row.className).toContain("closedRow");
        expect(row.className).toContain("blockedRow");
        expect(row.getAttribute("data-id")).toBe("5");
    });

    it("marks rows readonly when the user lacks modify_us", () => {
        const us = makeUserStory();
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us] }),
            project: makeProject({ my_permissions: ["view_milestones"] }),
            dragEnabled: false,
        });

        const row = container.querySelector(".row.milestone-us-item-row") as HTMLElement;
        expect(row.className).toContain("readonly");
    });

    it("omits the points column when total_points is null", () => {
        const us = makeUserStory({ total_points: null });
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us] }),
        });

        expect(container.querySelector(".column-points")).toBeNull();
    });

    it("renders an epic pill per epic with color and title", () => {
        const us = makeUserStory({
            epics: [{ ref: 5, subject: "Epic A", color: "#ff0000" }],
        });
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us] }),
        });

        const pills = container.querySelectorAll(".us-epic-container .belong-to-epic-pill");
        expect(pills).toHaveLength(1);
        const pill = pills[0] as HTMLElement;
        expect(pill.getAttribute("title")).toBe("#5 Epic A");
        // Inline style color applied from epic.color.
        expect(pill.style.background).toBe("rgb(255, 0, 0)");
    });

    it("renders the due-date marker only when a due date is present", () => {
        const withDue = makeUserStory({ id: 1, due_date: "2021-02-01" });
        const { container: c1 } = renderSprint({
            sprint: makeSprint({ user_stories: [withDue] }),
        });
        expect(c1.querySelector(".due-date")).not.toBeNull();

        const withoutDue = makeUserStory({ id: 2, due_date: null });
        const { container: c2 } = renderSprint({
            sprint: makeSprint({ user_stories: [withoutDue] }),
        });
        expect(c2.querySelector(".due-date")).toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* Taskboard links (view_milestones gate)                                     */
/* -------------------------------------------------------------------------- */

describe("Sprint — taskboard links", () => {
    it("renders the header link and bottom button when view_milestones is granted", () => {
        const { container } = renderSprint({
            sprint: makeSprint({ slug: "sprint-x" }),
            project: makeProject({
                slug: "proj-x",
                my_permissions: ["view_milestones"],
            }),
        });

        const button = container.querySelector(".btn-small") as HTMLAnchorElement;
        expect(button).toBeTruthy();
        expect(button.getAttribute("href")).toBe("#/project/proj-x/taskboard/sprint-x");
        expect(screen.getByText("Sprint Taskboard")).toBeInTheDocument();
    });

    it("hides the taskboard button but keeps the name visible without view_milestones", () => {
        const { container } = renderSprint({
            sprint: makeSprint({ name: "Sprint 1" }),
            project: makeProject({ my_permissions: [] }),
            dragEnabled: false,
        });

        expect(container.querySelector(".btn-small")).toBeNull();
        // Name is still shown (as a plain span, not a link).
        expect(screen.getByText("Sprint 1")).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* XSS safety                                                                 */
/* -------------------------------------------------------------------------- */

describe("Sprint — XSS safety", () => {
    it("renders a subject containing markup as literal text (no injected element)", () => {
        const malicious = '<img src=x onerror="alert(1)">';
        const us = makeUserStory({ subject: malicious });
        const { container } = renderSprint({
            sprint: makeSprint({ user_stories: [us] }),
        });

        const nameText = container.querySelector(".us-name-text") as HTMLElement;
        // The raw markup appears verbatim as text content...
        expect(nameText.textContent).toBe(malicious);
        // ...and NO <img> element was created from it.
        expect(container.querySelector("img")).toBeNull();
    });
});
