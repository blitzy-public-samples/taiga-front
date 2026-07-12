/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link Sprint}.
 *
 * `Sprint` is a DOM-preserving React reproduction of the AngularJS `tg-sprint`
 * directive template (`app/partials/backlog/sprint.jade`): the content of ONE
 * sprint card in the Backlog sidebar (header, progress bar, the `.sprint-table`
 * list of `.milestone-us-item-row` stories or an empty-drop placeholder, and the
 * taskboard link). Because the UNCHANGED Taiga SCSS
 * (`app/styles/modules/backlog/sprints.scss`) targets specific class names /
 * element hierarchy, these tests assert on the emitted DOM structure (via
 * `container.querySelector` / `querySelectorAll`), on the permission gating, on
 * the fold behavior, and on the progress-bar width math — NOT on translated copy
 * (the i18n keys are rendered as their resolved English copy by the component).
 *
 * Conventions (match the repo's React test harness — see `BurndownSummary.test.tsx`):
 *   - Test-framework globals are imported explicitly from `@jest/globals`
 *     (`describe`/`it`/`expect`); this is the committed convention that type-checks
 *     under the shipped toolchain (no ambient `@types/jest` is installed).
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers are registered
 *     globally by `jest.setup.ts` (these tests use core matchers only).
 *
 * The tests render a REAL {@link SprintHeader} child (it is not mocked), so the
 * fold toggle (`.compact-sprint`) and edit control (`.edit-sprint`) exercised here
 * flow through the actual header the production screen renders.
 */

import { describe, expect, it } from "@jest/globals";
import { render, fireEvent } from "@testing-library/react";
import { Sprint } from "./Sprint";
import type { StoryRowDndProps } from "./Sprint";
import type { Milestone, Project, UserStory } from "../shared/types";

/**
 * Build a {@link Project} with the given permission set. `archived_code` defaults
 * to `null` (not archived) so the header's edit control is gated only by
 * `modify_milestone`.
 */
function makeProject(permissions: string[], overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: "proj-1",
        name: "Project One",
        my_permissions: permissions,
        is_kanban_activated: true,
        is_backlog_activated: true,
        archived_code: null,
        ...overrides,
    };
}

/** A no-op edit handler for the tests that do not assert on it. */
const noEdit = (): void => {
    /* intentionally empty */
};

// --- User-story fixtures covering the row's conditional branches. -------------

const STORY_OPEN: UserStory = {
    id: 10,
    ref: 101,
    subject: "Alpha story",
    status: 1,
    swimlane: null,
    total_points: 5,
    milestone: 7,
};

const STORY_CLOSED: UserStory = {
    id: 11,
    ref: 102,
    subject: "Beta story",
    status: 2,
    swimlane: null,
    total_points: 3,
    milestone: 7,
    is_closed: true,
};

const STORY_BLOCKED: UserStory = {
    id: 12,
    ref: 103,
    subject: "Gamma story",
    status: 1,
    swimlane: null,
    total_points: 2,
    milestone: 7,
    is_blocked: true,
};

const STORY_WITH_EPICS: UserStory = {
    id: 13,
    ref: 104,
    subject: "Delta story",
    status: 1,
    swimlane: null,
    total_points: 8,
    milestone: 7,
    epics: [{ id: 500, ref: 42, subject: "Epic X", color: "#ff0000" }],
};

// `due_date` is a legacy view field NOT on the strict UserStory model; the
// component reads it defensively. The fixture attaches it via an `unknown` cast
// so the test can exercise the `.due-date` branch without widening the type.
const STORY_WITH_DUE_DATE = {
    id: 14,
    ref: 105,
    subject: "Epsilon story",
    status: 1,
    swimlane: null,
    total_points: 1,
    milestone: 7,
    due_date: "2025-06-01",
} as unknown as UserStory;

const STORY_NO_POINTS: UserStory = {
    id: 15,
    ref: 106,
    subject: "Zeta story",
    status: 1,
    swimlane: null,
    // total_points intentionally omitted (falsy) -> no `.column-points` column.
    milestone: 7,
};

const STORY_NO_MILESTONE: UserStory = {
    id: 16,
    ref: 107,
    subject: "Eta story",
    status: 1,
    swimlane: null,
    total_points: 4,
    // milestone intentionally omitted -> href carries no `?milestone=` query.
};

// --- Sprint (milestone) fixtures. --------------------------------------------

const OPEN_SPRINT: Milestone = {
    id: 7,
    name: "Sprint 1",
    slug: "sprint-1",
    closed: false,
    estimated_start: "2025-01-01",
    estimated_finish: "2025-01-15",
    total_points: 20,
    closed_points: 5,
    user_stories: [STORY_OPEN, STORY_CLOSED],
};

const CLOSED_SPRINT: Milestone = {
    id: 8,
    name: "Sprint 0",
    slug: "sprint-0",
    closed: true,
    total_points: 20,
    closed_points: 20,
    user_stories: [STORY_OPEN],
};

const EMPTY_SPRINT: Milestone = {
    id: 9,
    name: "Empty Sprint",
    slug: "empty-sprint",
    closed: false,
    total_points: 0,
    closed_points: 0,
    user_stories: [],
};

describe("Sprint — DOM contract", () => {
    it("renders header, progress bar, sprint-table and taskboard link for an open sprint", () => {
        const project = makeProject(["modify_us", "view_milestones", "modify_milestone"]);
        const { container } = render(
            <Sprint sprint={OPEN_SPRINT} project={project} onEditSprint={noEdit} />,
        );

        // Header (from the real SprintHeader child).
        expect(container.querySelector(".sprint-summary")).not.toBeNull();

        // Progress bar wrapper + bar + fill the SCSS targets.
        expect(container.querySelector(".summary-progress-wrapper")).not.toBeNull();
        const fill = container.querySelector(
            ".sprint-progress-bar .current-progress",
        ) as HTMLElement | null;
        expect(fill).not.toBeNull();
        // closed_points(5) / total_points(20) * 100 = 25%.
        expect(fill!.style.width).toBe("25%");

        // The sprint table with its story rows.
        const table = container.querySelector(".sprint-table") as HTMLElement | null;
        expect(table).not.toBeNull();
        expect(table!.classList.contains("open")).toBe(true);
        expect(table!.classList.contains("sprint-empty-wrapper")).toBe(false);
        expect(container.querySelectorAll(".milestone-us-item-row")).toHaveLength(2);

        // Taskboard link (gated by view_milestones, which the project has).
        const taskboard = container.querySelector("a.btn-small") as HTMLElement | null;
        expect(taskboard).not.toBeNull();
        expect(taskboard!.getAttribute("href")).toBe("#/project/proj-1/taskboard/sprint-1");
        expect(taskboard!.getAttribute("title")).toBe('Go to Taskboard of "Sprint 1"');
        expect(taskboard!.querySelector("span")!.textContent).toBe("Sprint Taskboard");
    });

    it("renders the user-story link with `#<ref> ` ref text, escaped subject, title and href", () => {
        const project = makeProject(["modify_us", "view_milestones"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_OPEN] }}
                project={project}
                onEditSprint={noEdit}
            />,
        );

        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(row.getAttribute("data-id")).toBe("10");

        const link = row.querySelector("a.us-name.clickable") as HTMLElement;
        expect(link).not.toBeNull();
        // Ref text is `#<ref> ` with a single trailing space (BindOnceRefDirective).
        expect(row.querySelector(".us-ref-text")!.textContent).toBe("#101 ");
        // Subject rendered as an escaped text node.
        expect(row.querySelector(".us-name-text")!.textContent).toBe("Alpha story");
        // Anchor title = `#<ref> <subject>`.
        expect(link.getAttribute("title")).toBe("#101 Alpha story");
        // Href includes the ?milestone query because the story has a milestone.
        expect(link.getAttribute("href")).toBe("#/project/proj-1/us/101?milestone=7");
        // Points column renders the total_points value.
        expect(row.querySelector(".column-points.width-1 .points-container")!.textContent).toBe(
            "5",
        );
    });

    it("applies closedRow / blockedRow (and closed / blocked on the link) modifiers", () => {
        const project = makeProject(["modify_us"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_CLOSED, STORY_BLOCKED] }}
                project={project}
                onEditSprint={noEdit}
            />,
        );

        const closedRow = container.querySelector('[data-id="11"]') as HTMLElement;
        expect(closedRow.classList.contains("closedRow")).toBe(true);
        expect(
            (closedRow.querySelector(".us-name") as HTMLElement).classList.contains("closed"),
        ).toBe(true);
        expect(
            (closedRow.querySelector(".column-points") as HTMLElement).classList.contains("closed"),
        ).toBe(true);

        const blockedRow = container.querySelector('[data-id="12"]') as HTMLElement;
        expect(blockedRow.classList.contains("blockedRow")).toBe(true);
        expect(
            (blockedRow.querySelector(".us-name") as HTMLElement).classList.contains("blocked"),
        ).toBe(true);
    });

    it("reproduces the epic pills (us-epic-container) with background color and title", () => {
        const project = makeProject(["modify_us"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_WITH_EPICS] }}
                project={project}
                onEditSprint={noEdit}
            />,
        );

        const epicContainer = container.querySelector(".us-epic-container");
        expect(epicContainer).not.toBeNull();
        const pills = container.querySelectorAll(".belong-to-epic-pill");
        expect(pills).toHaveLength(1);
        const pill = pills[0] as HTMLElement;
        expect(pill.getAttribute("title")).toBe("#42 Epic X");
        // Some background value was applied (jsdom normalises the hex to rgb).
        expect(pill.style.background).not.toBe("");
    });

    it("renders the optional due-date block when the story has a due_date", () => {
        const project = makeProject(["modify_us"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_WITH_DUE_DATE] }}
                project={project}
                onEditSprint={noEdit}
            />,
        );

        const dueDate = container.querySelector(".due-date");
        expect(dueDate).not.toBeNull();
        expect(dueDate!.textContent).toBe("2025-06-01");
    });

    it("omits the points column when total_points is falsy and omits ?milestone when unset", () => {
        const project = makeProject(["modify_us"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_NO_POINTS, STORY_NO_MILESTONE] }}
                project={project}
                onEditSprint={noEdit}
            />,
        );

        // Story with no points -> no `.column-points` in its row.
        const noPointsRow = container.querySelector('[data-id="15"]') as HTMLElement;
        expect(noPointsRow.querySelector(".column-points")).toBeNull();

        // Story with no milestone -> href has no `?milestone=` query.
        const noMilestoneRow = container.querySelector('[data-id="16"]') as HTMLElement;
        expect((noMilestoneRow.querySelector("a.us-name") as HTMLElement).getAttribute("href")).toBe(
            "#/project/proj-1/us/107",
        );
    });
});

describe("Sprint — progress bar math", () => {
    it("clamps the progress to 100% when closed exceeds total", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, total_points: 20, closed_points: 30 }}
                project={project}
                onEditSprint={noEdit}
            />,
        );
        const fill = container.querySelector(".current-progress") as HTMLElement;
        expect(fill.style.width).toBe("100%");
    });

    it("guards divide-by-zero (total_points 0) and renders a 0% bar", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint sprint={EMPTY_SPRINT} project={project} onEditSprint={noEdit} />,
        );
        const fill = container.querySelector(".current-progress") as HTMLElement;
        expect(fill.style.width).toBe("0%");
    });
});

describe("Sprint — empty state and permission gating", () => {
    it("shows the empty-drop placeholder gated by modify_us (with modify_us)", () => {
        const project = makeProject(["modify_us", "view_milestones"]);
        const { container } = render(
            <Sprint sprint={EMPTY_SPRINT} project={project} onEditSprint={noEdit} />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("sprint-empty-wrapper")).toBe(true);

        const spans = container.querySelectorAll(".sprint-empty span");
        expect(spans).toHaveLength(2);
        // Anonymous message hidden for users WITH modify_us.
        expect(spans[0].textContent).toBe("This sprint has no user stories");
        expect((spans[0] as HTMLElement).classList.contains("hidden")).toBe(true);
        // Drop message visible for users WITH modify_us.
        expect(spans[1].textContent).toBe(
            "Drop here Stories from your backlog to start a new sprint",
        );
        expect((spans[1] as HTMLElement).classList.contains("hidden")).toBe(false);

        // No story rows in an empty sprint.
        expect(container.querySelectorAll(".milestone-us-item-row")).toHaveLength(0);
    });

    it("shows the anonymous empty message for users WITHOUT modify_us", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint sprint={EMPTY_SPRINT} project={project} onEditSprint={noEdit} />,
        );

        const spans = container.querySelectorAll(".sprint-empty span");
        expect((spans[0] as HTMLElement).classList.contains("hidden")).toBe(false);
        expect((spans[1] as HTMLElement).classList.contains("hidden")).toBe(true);
    });

    it("hides the taskboard link for users without view_milestones", () => {
        const project = makeProject(["modify_us"]);
        const { container } = render(
            <Sprint sprint={OPEN_SPRINT} project={project} onEditSprint={noEdit} />,
        );
        expect(container.querySelector("a.btn-small")).toBeNull();
    });
});

describe("Sprint — fold state", () => {
    it("renders an open sprint expanded (no display:none, `open` class present)", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint sprint={OPEN_SPRINT} project={project} onEditSprint={noEdit} />,
        );
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("open")).toBe(true);
        expect(table.style.display).not.toBe("none");
    });

    it("renders a closed sprint collapsed (display:none, no `open` class)", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint sprint={CLOSED_SPRINT} project={project} onEditSprint={noEdit} />,
        );
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("open")).toBe(false);
        expect(table.style.display).toBe("none");
    });

    it("toggles the fold when the header's compact-sprint control is clicked", () => {
        const project = makeProject(["view_milestones"]);
        const { container } = render(
            <Sprint sprint={OPEN_SPRINT} project={project} onEditSprint={noEdit} />,
        );

        const compact = container.querySelector(".compact-sprint") as HTMLElement;
        const table = container.querySelector(".sprint-table") as HTMLElement;

        // Starts expanded.
        expect(table.classList.contains("open")).toBe(true);
        expect(compact.classList.contains("active")).toBe(true);

        // Click collapses.
        fireEvent.click(compact);
        expect(table.classList.contains("open")).toBe(false);
        expect(table.style.display).toBe("none");
        expect(compact.classList.contains("active")).toBe(false);

        // Click again re-expands.
        fireEvent.click(compact);
        expect(table.classList.contains("open")).toBe(true);
        expect(table.style.display).not.toBe("none");
        expect(compact.classList.contains("active")).toBe(true);
    });
});

describe("Sprint — edit callback", () => {
    it("invokes onEditSprint with the sprint when the edit control is activated", () => {
        // modify_milestone + not archived -> the header renders `.edit-sprint`.
        const project = makeProject(["modify_us", "modify_milestone", "view_milestones"]);
        let edited: Milestone | null = null;
        const { container } = render(
            <Sprint
                sprint={OPEN_SPRINT}
                project={project}
                onEditSprint={(sprint) => {
                    edited = sprint;
                }}
            />,
        );

        const edit = container.querySelector(".edit-sprint") as HTMLElement | null;
        expect(edit).not.toBeNull();
        fireEvent.click(edit!);
        expect(edited).toBe(OPEN_SPRINT);
    });
});

describe("Sprint — @dnd-kit wiring", () => {
    it("applies the droppable ref + drag-over class and per-row sortable props", () => {
        const project = makeProject(["modify_us", "view_milestones"]);
        let dropEl: HTMLElement | null = null;
        let rowEl: HTMLElement | null = null;

        const getStoryRowProps = (us: UserStory): StoryRowDndProps | undefined => {
            if (us.id !== STORY_OPEN.id) {
                return undefined;
            }
            return {
                setNodeRef: (el) => {
                    rowEl = el;
                },
                style: { transform: "translateY(4px)" },
                isDragging: true,
                attributes: { "data-dnd-attr": "yes" },
                listeners: { "data-dnd-listener": "yes" },
            };
        };

        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_OPEN] }}
                project={project}
                onEditSprint={noEdit}
                dropRef={(el) => {
                    dropEl = el;
                }}
                isOver
                getStoryRowProps={getStoryRowProps}
            />,
        );

        // The `.sprint-table` is the droppable: its ref is invoked and `isOver`
        // adds the `drag-over` class.
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("drag-over")).toBe(true);
        expect(dropEl).toBe(table);

        // The row received the sortable wiring: ref, dragging class, spread attrs.
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(rowEl).toBe(row);
        expect(row.classList.contains("dragging")).toBe(true);
        expect(row.getAttribute("data-dnd-attr")).toBe("yes");
        expect(row.getAttribute("data-dnd-listener")).toBe("yes");
        expect(row.style.transform).toBe("translateY(4px)");
    });

    it("renders plainly (no drag-over, no dragging) when getStoryRowProps returns undefined", () => {
        const project = makeProject(["modify_us", "view_milestones"]);
        const { container } = render(
            <Sprint
                sprint={{ ...OPEN_SPRINT, user_stories: [STORY_OPEN] }}
                project={project}
                onEditSprint={noEdit}
                getStoryRowProps={() => undefined}
            />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("drag-over")).toBe(false);
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(row.classList.contains("dragging")).toBe(false);
    });
});
