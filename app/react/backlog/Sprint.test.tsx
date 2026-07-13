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
 * `Sprint` is the DOM-preserving React reproduction of the AngularJS `tg-sprint`
 * directive template (`app/partials/backlog/sprint.jade`): the content of ONE
 * sprint card in the Backlog sidebar — the header, the progress bar, the
 * `.sprint-table` (either the list of `.milestone-us-item-row` stories or an
 * empty-drop placeholder), and the taskboard link. Because the UNCHANGED Taiga
 * SCSS (`app/styles/modules/backlog/sprints.scss`) targets specific class names
 * and element hierarchy, these tests assert on the emitted DOM structure (via
 * `container.querySelector` / `querySelectorAll`), on the permission gating, on
 * the fold behavior, and on the progress-bar width math. Visible copy is
 * asserted through the shared `t(...)` helper so the expectations track the
 * locale bundle (the source of truth), proving the i18n keys resolve.
 *
 * Test harness conventions (see `jest.config.js` / `tsconfig.json`):
 *   - AMBIENT Jest globals — `describe` / `it` / `expect` / `jest` are provided
 *     by `@types/jest` (declared in `tsconfig.json` `types`), so they are NOT
 *     imported from `@jest/globals`.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — there is NO `import React`.
 *   - `ts-jest` transforms the TSX with the shared root `tsconfig.json`; the
 *     `jsdom` environment supplies the DOM; the `@testing-library/jest-dom`
 *     matchers are auto-registered once per file by `jest.setup.ts`.
 *
 * The tests render a REAL {@link SprintHeader} child (it is not mocked), so the
 * fold toggle (`.compact-sprint`) and the edit control (`.edit-sprint`) exercised
 * here flow through the actual header the production screen renders. The header's
 * `.edit-sprint` is gated on `modify_milestone` (and a non-archived project), and
 * the `Sprint` taskboard link (`a.btn-small`) is gated on `view_milestones`.
 */

import { render, fireEvent } from "@testing-library/react";
import { Sprint, SprintStoryRow } from "./Sprint";
import type { Milestone, Project, UserStory } from "../shared/types";
import { t } from "../shared/i18n/translate";

// --- Fixtures (partial objects cast with `as`, per the model contracts). ------

/**
 * Project context with the full permission set the two gated controls need:
 * `view_milestones` (taskboard link) and `modify_milestone` (edit-sprint), plus
 * `modify_us` (empty-placeholder message selection). Not archived, so the header
 * edit control is gated only by `modify_milestone`.
 */
const project = {
    id: 7,
    slug: "proj",
    my_permissions: ["view_milestones", "modify_milestone", "modify_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
} as Project;

/** A single open, estimated user story (8 points) that belongs to milestone 3. */
const story = {
    id: 10,
    ref: 101,
    subject: "Story A",
    status: 1,
    swimlane: null,
    total_points: 8,
    is_closed: false,
    is_blocked: false,
    milestone: 3,
} as UserStory;

/** An OPEN sprint (renders expanded) with one story and a 5/20 points ratio. */
const openSprint = {
    id: 3,
    name: "Sprint 1",
    slug: "sprint-1",
    estimated_start: "2020-01-10",
    estimated_finish: "2020-01-24",
    closed: false,
    closed_points: 5,
    total_points: 20,
    user_stories: [story],
} as Milestone;

/** Same open sprint but with no stories — drives the empty-drop placeholder. */
const emptySprint = { ...openSprint, id: 4, user_stories: [] } as Milestone;

/** A CLOSED sprint — renders collapsed (`display:none`, no `open` class). */
const closedSprint = { ...openSprint, id: 5, closed: true } as Milestone;

/** A no-op edit handler for cases that do not assert on the edit callback. */
const noop = () => {};

// --- Supplementary story fixtures (exercise the row's conditional branches). --

/** Closed story -> `closedRow` on the row, `closed` on the link and points. */
const closedStory = { ...story, id: 11, ref: 102, subject: "Closed story", is_closed: true } as UserStory;

/** Blocked story -> `blockedRow` on the row, `blocked` on the link and points. */
const blockedStory = { ...story, id: 12, ref: 103, subject: "Blocked story", is_blocked: true } as UserStory;

/** Story carrying an epic -> the `.us-epic-container` / `.belong-to-epic-pill`. */
const epicStory = {
    ...story,
    id: 13,
    ref: 104,
    subject: "Epic story",
    epics: [{ id: 500, ref: 42, subject: "Epic X", color: "#ff0000" }],
} as UserStory;

// `due_date` is a legacy view field NOT on the strict UserStory model; the
// component reads it defensively. Attach it through an `unknown` cast so the
// test can exercise the `.due-date` branch without widening the type.
const dueDateStory = {
    ...story,
    id: 14,
    ref: 105,
    subject: "Due story",
    due_date: "2025-06-01",
} as unknown as UserStory;

/** Story with no points -> its row omits the `.column-points` column. */
const noPointsStory = { ...story, id: 15, ref: 106, subject: "No points", total_points: null } as UserStory;

/** Story with no milestone -> the link href carries no `?milestone=` query. */
const noMilestoneStory = { ...story, id: 16, ref: 107, subject: "No milestone", milestone: null } as UserStory;

// =============================================================================
// Required cases (the 10 the file summary mandates, with exact assertions).
// =============================================================================

describe("Sprint", () => {
    // 1 -----------------------------------------------------------------------
    it("renders the header and the progress bar filled to the closed/total ratio", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        // The header (rendered by the real SprintHeader child).
        expect(container.querySelector(".sprint-summary")).not.toBeNull();

        // The progress-bar wrapper -> bar -> fill the SCSS targets.
        const fill = container.querySelector(
            ".summary-progress-wrapper .sprint-progress-bar .current-progress",
        ) as HTMLElement | null;
        expect(fill).not.toBeNull();
        // 100 * closed_points(5) / total_points(20) = 25%.
        expect(fill!.style.width).toBe("25%");
    });

    // 2 -----------------------------------------------------------------------
    it("renders one milestone story row with ref text, subject and points", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        const rows = container.querySelectorAll(".milestone-us-item-row");
        expect(rows).toHaveLength(1);

        const row = rows[0] as HTMLElement;
        expect(row.getAttribute("data-id")).toBe("10");
        // Ref text is `#<ref> ` with a single trailing space (BindOnceRefDirective).
        expect(row.querySelector(".us-ref-text")!.textContent).toBe("#101 ");
        // Subject rendered as an escaped text node.
        expect(row.querySelector(".us-name-text")!.textContent).toBe("Story A");
        // Points column renders the total_points value.
        expect(row.querySelector(".column-points .points-container")!.textContent).toBe("8");
    });

    // 3 -----------------------------------------------------------------------
    it("builds the us-name link href (with ?milestone) and the title", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        const link = container.querySelector(".us-name") as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("/project/proj/us/101?milestone=3");
        expect(link.getAttribute("title")).toBe("#101 Story A");
    });

    // 4 -----------------------------------------------------------------------
    it("renders the empty-drop placeholder gated by modify_us when the sprint has no stories", () => {
        const { container } = render(
            <Sprint sprint={emptySprint} project={project} onEditSprint={noop} />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("sprint-empty-wrapper")).toBe(true);

        const empty = container.querySelector(".sprint-empty") as HTMLElement;
        expect(empty).not.toBeNull();
        const spans = empty.querySelectorAll("span");
        expect(spans).toHaveLength(2);
        // With modify_us present: the anonymous warning is hidden, the drop
        // warning is shown.
        expect((spans[0] as HTMLElement).classList.contains("hidden")).toBe(true);
        expect((spans[1] as HTMLElement).classList.contains("hidden")).toBe(false);
        // Both warnings render their resolved translations (M7).
        expect(spans[0].textContent).toBe(
            t("BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS"),
        );
        expect(spans[1].textContent).toBe(t("BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT"));
    });

    // 5 -----------------------------------------------------------------------
    it("renders the taskboard link only for users who can view_milestones", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        const taskboard = container.querySelector(".btn-small") as HTMLAnchorElement;
        expect(taskboard).not.toBeNull();
        expect(taskboard.getAttribute("href")).toBe("/project/proj/taskboard/sprint-1");
        expect(taskboard.querySelector("span")!.textContent).toBe(
            t("BACKLOG.SPRINTS.LINK_TASKBOARD"),
        );
        expect(taskboard.getAttribute("title")).toBe(
            t("BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD", { name: "Sprint 1" }),
        );

        // A project without view_milestones hides the taskboard link entirely.
        const noViewProject = {
            ...project,
            my_permissions: ["modify_us", "modify_milestone"],
        } as Project;
        const { container: noView } = render(
            <Sprint sprint={openSprint} project={noViewProject} onEditSprint={noop} />,
        );
        expect(noView.querySelector(".btn-small")).toBeNull();
    });

    // 6 -----------------------------------------------------------------------
    it("renders an OPEN sprint expanded by default (visible, `open` class)", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.style.display).not.toBe("none");
        expect(table.classList.contains("open")).toBe(true);
    });

    // 7 -----------------------------------------------------------------------
    it("renders a CLOSED sprint collapsed by default (display:none, no `open`)", () => {
        const { container } = render(
            <Sprint sprint={closedSprint} project={project} onEditSprint={noop} />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.style.display).toBe("none");
        expect(table.classList.contains("open")).toBe(false);
    });

    // 8 -----------------------------------------------------------------------
    it("folds and unfolds when the compact-sprint control is clicked", () => {
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={noop} />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;

        // Starts expanded.
        expect(table.style.display).not.toBe("none");
        expect(table.classList.contains("open")).toBe(true);

        // First click collapses.
        fireEvent.click(container.querySelector(".compact-sprint")!);
        expect(table.style.display).toBe("none");
        expect(table.classList.contains("open")).toBe(false);

        // Second click re-expands.
        fireEvent.click(container.querySelector(".compact-sprint")!);
        expect(table.style.display).not.toBe("none");
        expect(table.classList.contains("open")).toBe(true);
    });

    // 9 -----------------------------------------------------------------------
    it("invokes onEditSprint once with the sprint when the edit control is clicked", () => {
        const fn = jest.fn();
        const { container } = render(
            <Sprint sprint={openSprint} project={project} onEditSprint={fn} />,
        );

        fireEvent.click(container.querySelector(".edit-sprint")!);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(openSprint);
    });

    // 10 ----------------------------------------------------------------------
    it("clamps progress and guards divide-by-zero (total_points 0 -> 0%)", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, closed_points: 0, total_points: 0 }}
                project={project}
                onEditSprint={noop}
            />,
        );

        const fill = container.querySelector(".current-progress") as HTMLElement;
        expect(fill.style.width).toBe("0%");
    });
});

// =============================================================================
// Supplementary cases — exercise the remaining Sprint.tsx branches so the whole
// component is line-covered (>= 70% line gate). These extend, not replace, the
// required cases above.
// =============================================================================

describe("Sprint — additional branch coverage", () => {
    it("clamps progress to 100% when closed_points exceeds total_points", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, closed_points: 30, total_points: 20 }}
                project={project}
                onEditSprint={noop}
            />,
        );

        const fill = container.querySelector(".current-progress") as HTMLElement;
        expect(fill.style.width).toBe("100%");
    });

    it("applies the closedRow / blockedRow row modifiers and link/points modifiers", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, user_stories: [closedStory, blockedStory] }}
                project={project}
                onEditSprint={noop}
            />,
        );

        const closedRow = container.querySelector('[data-id="11"]') as HTMLElement;
        expect(closedRow.classList.contains("closedRow")).toBe(true);
        expect((closedRow.querySelector(".us-name") as HTMLElement).classList.contains("closed")).toBe(
            true,
        );
        expect(
            (closedRow.querySelector(".column-points") as HTMLElement).classList.contains("closed"),
        ).toBe(true);

        const blockedRow = container.querySelector('[data-id="12"]') as HTMLElement;
        expect(blockedRow.classList.contains("blockedRow")).toBe(true);
        expect(
            (blockedRow.querySelector(".us-name") as HTMLElement).classList.contains("blocked"),
        ).toBe(true);
    });

    it("reproduces the epic pills (us-epic-container) with a title and background", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, user_stories: [epicStory] }}
                project={project}
                onEditSprint={noop}
            />,
        );

        expect(container.querySelector(".us-epic-container")).not.toBeNull();
        const pills = container.querySelectorAll(".belong-to-epic-pill");
        expect(pills).toHaveLength(1);
        const pill = pills[0] as HTMLElement;
        expect(pill.getAttribute("title")).toBe("#42 Epic X");
        // jsdom normalises the hex color to rgb(), so just assert it was set.
        expect(pill.style.background).not.toBe("");
    });

    it("renders the optional due-date block when the story has a due_date", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, user_stories: [dueDateStory] }}
                project={project}
                onEditSprint={noop}
            />,
        );

        const dueDate = container.querySelector(".due-date");
        expect(dueDate).not.toBeNull();
        expect(dueDate!.textContent).toBe("2025-06-01");
    });

    it("omits the points column for a pointless story and the ?milestone query for a milestone-less story", () => {
        const { container } = render(
            <Sprint
                sprint={{ ...openSprint, user_stories: [noPointsStory, noMilestoneStory] }}
                project={project}
                onEditSprint={noop}
            />,
        );

        // No points -> no `.column-points` in that row.
        const noPointsRow = container.querySelector('[data-id="15"]') as HTMLElement;
        expect(noPointsRow.querySelector(".column-points")).toBeNull();

        // No milestone -> href without the `?milestone=` query.
        const noMilestoneRow = container.querySelector('[data-id="16"]') as HTMLElement;
        expect((noMilestoneRow.querySelector(".us-name") as HTMLElement).getAttribute("href")).toBe(
            "/project/proj/us/107",
        );
    });

    it("shows the anonymous empty message for users WITHOUT modify_us", () => {
        const anonProject = { ...project, my_permissions: ["view_milestones"] } as Project;
        const { container } = render(
            <Sprint sprint={emptySprint} project={anonProject} onEditSprint={noop} />,
        );

        const spans = container.querySelectorAll(".sprint-empty span");
        // Without modify_us: the anonymous warning is shown, the drop warning hidden.
        expect((spans[0] as HTMLElement).classList.contains("hidden")).toBe(false);
        expect((spans[1] as HTMLElement).classList.contains("hidden")).toBe(true);
        expect(spans[0].textContent).toBe(
            t("BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS"),
        );
        expect(spans[1].textContent).toBe(t("BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT"));
    });
});

// =============================================================================
// Supplementary cases — @dnd-kit wiring passed down from the Backlog DndContext.
// =============================================================================

describe("Sprint — @dnd-kit wiring", () => {
    it("applies the droppable ref + drag-over class and the per-row sortable props", () => {
        let dropEl: HTMLElement | null = null;
        let rowEl: HTMLElement | null = null;

        const { container } = render(
            <Sprint
                sprint={openSprint}
                project={project}
                onEditSprint={noop}
                dropRef={(el) => {
                    dropEl = el;
                }}
                isOver
                getStoryRowProps={(us) =>
                    us.id === story.id
                        ? {
                              setNodeRef: (el) => {
                                  rowEl = el;
                              },
                              style: { transform: "translateY(4px)" },
                              isDragging: true,
                              attributes: { "data-dnd-attr": "yes" },
                              listeners: { "data-dnd-listener": "yes" },
                          }
                        : undefined
                }
            />,
        );

        // The `.sprint-table` is the droppable: its ref is invoked and `isOver`
        // adds the `drag-over` class.
        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("drag-over")).toBe(true);
        expect(dropEl).toBe(table);

        // The row received the sortable wiring: node ref, dragging class, spreads.
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(rowEl).toBe(row);
        expect(row.classList.contains("dragging")).toBe(true);
        expect(row.getAttribute("data-dnd-attr")).toBe("yes");
        expect(row.getAttribute("data-dnd-listener")).toBe("yes");
        expect(row.style.transform).toBe("translateY(4px)");
    });

    it("renders plainly (no drag-over, no dragging) when no dnd wiring is supplied", () => {
        const { container } = render(
            <Sprint
                sprint={openSprint}
                project={project}
                onEditSprint={noop}
                getStoryRowProps={() => undefined}
            />,
        );

        const table = container.querySelector(".sprint-table") as HTMLElement;
        expect(table.classList.contains("drag-over")).toBe(false);
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(row.classList.contains("dragging")).toBe(false);
    });
});

// =============================================================================
// renderStoryRow path + exported SprintStoryRow (finding C8)
//
// When `./Backlog.tsx` owns the DndContext it threads a `renderStoryRow` render-
// prop through `SprintList -> Sprint`, so each sprint story becomes a SORTABLE
// row (enabling within/between-sprint reorder and sprint->backlog drags). When
// `renderStoryRow` is present the default rows are replaced by its output inside
// a `SortableContext`; when absent, the plain `getStoryRowProps` path is used.
// =============================================================================

describe("Sprint — renderStoryRow (sortable) path", () => {
    it("delegates every story to renderStoryRow and renders its output", () => {
        const seen: number[] = [];
        const { container } = render(
            <Sprint
                sprint={openSprint}
                project={project}
                onEditSprint={noop}
                renderStoryRow={(us) => {
                    seen.push(us.id);
                    return <div key={us.id} data-testid="custom-row" data-id={String(us.id)} />;
                }}
            />,
        );

        // Called once per story, and its custom output is what renders.
        expect(seen).toEqual([story.id]);
        const custom = container.querySelectorAll('[data-testid="custom-row"]');
        expect(custom.length).toBe(1);
        expect(custom[0].getAttribute("data-id")).toBe(String(story.id));
        // The default (getStoryRowProps) row is NOT auto-rendered on this path.
        expect(container.querySelector(".milestone-us-item-row")).toBeNull();
    });

    it("still renders the empty-drop placeholder (renderStoryRow only affects rows)", () => {
        const { container } = render(
            <Sprint
                sprint={emptySprint}
                project={project}
                onEditSprint={noop}
                renderStoryRow={() => <div />}
            />,
        );
        expect(container.querySelector(".sprint-empty")).not.toBeNull();
    });
});

describe("SprintStoryRow (exported leaf)", () => {
    it("renders the milestone row DOM with ref, subject and points", () => {
        const { container } = render(<SprintStoryRow us={story} project={project} />);
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(row).not.toBeNull();
        expect(row.getAttribute("data-id")).toBe(String(story.id));
        expect(container.querySelector(".us-ref-text")!.textContent).toBe(`#${story.ref} `);
        expect(container.querySelector(".us-name-text")!.textContent).toBe(story.subject);
        expect(container.querySelector(".points-container")!.textContent).toBe(
            String(story.total_points),
        );
    });

    it("applies the @dnd-kit sortable wiring to the row root", () => {
        let rowEl: HTMLElement | null = null;
        const { container } = render(
            <SprintStoryRow
                us={story}
                project={project}
                dnd={{
                    setNodeRef: (el) => {
                        rowEl = el;
                    },
                    style: { transform: "translateY(6px)" },
                    isDragging: true,
                    attributes: { "data-dnd-attr": "yes" },
                    listeners: { "data-dnd-listener": "yes" },
                }}
            />,
        );
        const row = container.querySelector(".milestone-us-item-row") as HTMLElement;
        expect(rowEl).toBe(row);
        expect(row.classList.contains("dragging")).toBe(true);
        expect(row.getAttribute("data-dnd-attr")).toBe("yes");
        expect(row.getAttribute("data-dnd-listener")).toBe("yes");
        expect(row.style.transform).toBe("translateY(6px)");
    });

    it("disables native drag on the story link so the whole-row sortable drag stays clean", () => {
        const { container } = render(<SprintStoryRow us={story} project={project} />);
        const link = container.querySelector(".us-name") as HTMLAnchorElement;
        // `draggable={false}` renders the attribute as the string "false".
        expect(link.getAttribute("draggable")).toBe("false");
        // A native dragstart on the link is prevented (would otherwise hijack the
        // @dnd-kit pointer drag).
        const dragStarted = fireEvent.dragStart(link);
        expect(dragStarted).toBe(false);
    });


    it("marks closed/blocked stories with the row + link + points modifiers", () => {
        const { container: closed } = render(
            <SprintStoryRow us={closedStory} project={project} />,
        );
        expect(closed.querySelector(".milestone-us-item-row")!.classList.contains("closedRow")).toBe(true);
        expect(closed.querySelector(".us-name")!.classList.contains("closed")).toBe(true);

        const { container: blocked } = render(
            <SprintStoryRow us={blockedStory} project={project} />,
        );
        expect(blocked.querySelector(".milestone-us-item-row")!.classList.contains("blockedRow")).toBe(true);
        expect(blocked.querySelector(".us-name")!.classList.contains("blocked")).toBe(true);
    });
});
