/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `SprintList` section (app/react/backlog/SprintList.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). Every render is
 * wrapped in a `<DndContext>` because the child `<Sprint>` cards call the ambient
 * `useDroppable` / `useDraggable` hooks that `BacklogApp` provides in production.
 *
 * Coverage focus (per the file's validation checklist):
 *  - header renders the sprint count + the OPEN sprints list
 *  - empty-small state appears only when `totalMilestones === 0` (no count badge)
 *  - the closed-sprints toggle appears only when `totalClosedMilestones` is truthy
 *    and fires `onToggleClosedSprints`; its label reflects visibility + count
 *  - the closed list stays hidden until `closedSprintsVisible`
 *  - the "add sprint" action is gated by the `add_milestone` permission and fires
 *    `onAddNewSprint`
 */

import { DndContext } from "@dnd-kit/core";
import { render, screen, fireEvent } from "@testing-library/react";

import { SprintList } from "../SprintList";
import type { SprintListProps } from "../SprintList";
import type { Project, Sprint as SprintModel } from "../types";

/* -------------------------------------------------------------------------- */
/* jsdom polyfill: @dnd-kit/core useDroppable instantiates a ResizeObserver,   */
/* which jsdom does not provide. A no-op stub is sufficient for these tests.   */
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
        my_permissions: ["view_milestones", "modify_us", "modify_milestone", "add_milestone"],
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

function makeSprint(overrides: Partial<SprintModel> = {}): SprintModel {
    return {
        id: 10,
        name: "Sprint 1",
        slug: "sprint-1",
        project: 1,
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        closed: false,
        closed_points: 0,
        total_points: 0,
        user_stories: [],
        ...overrides,
    };
}

function renderList(overrides: Partial<SprintListProps> = {}): {
    props: SprintListProps;
    result: ReturnType<typeof render>;
} {
    const props: SprintListProps = {
        project: makeProject(),
        openSprints: [],
        closedSprints: [],
        totalMilestones: 0,
        totalClosedMilestones: 0,
        closedSprintsVisible: false,
        dragEnabled: true,
        onAddNewSprint: jest.fn(),
        onEditSprint: jest.fn(),
        onToggleClosedSprints: jest.fn(),
        ...overrides,
    };
    const result = render(
        <DndContext>
            <SprintList {...props} />
        </DndContext>
    );
    return { props, result };
}

/* -------------------------------------------------------------------------- */
/* Header: count + open list                                                  */
/* -------------------------------------------------------------------------- */

describe("SprintList — header + open sprints", () => {
    it("renders the total count badge and the open sprints in order", () => {
        const openSprints = [
            makeSprint({ id: 1, name: "Sprint Alpha", slug: "alpha" }),
            makeSprint({ id: 2, name: "Sprint Beta", slug: "beta" }),
        ];
        const { result } = renderList({ totalMilestones: 2, openSprints });
        const { container } = result;

        // .number badge shows the total.
        expect(container.querySelector(".sprint-header .number")?.textContent).toBe("2");
        // Title is the resolved BACKLOG.SPRINTS.TITLE literal.
        expect(container.querySelector(".sprint-header .title")?.textContent).toBe("SPRINTS");

        // One .sprint.sprint-open wrapper per open sprint, rendering a <Sprint> card each.
        const openWrappers = container.querySelectorAll("div.sprint.sprint-open");
        expect(openWrappers).toHaveLength(2);
        expect(screen.getByText("Sprint Alpha")).toBeInTheDocument();
        expect(screen.getByText("Sprint Beta")).toBeInTheDocument();

        // No empty-small state and no closed content when there are only open sprints.
        expect(container.querySelector(".empty-small")).toBeNull();
        expect(container.querySelector(".filter-closed-sprints")).toBeNull();
        expect(container.querySelector("div.sprint.sprint-closed")).toBeNull();
    });

    it("omits the count badge while stats are still loading (totalMilestones === null)", () => {
        const { result } = renderList({ totalMilestones: null });
        const { container } = result;

        // Neither the count badge (ng-if fidelity) nor the empty state should appear.
        expect(container.querySelector(".sprint-header .number")).toBeNull();
        expect(container.querySelector(".empty-small")).toBeNull();
        // The title still renders.
        expect(container.querySelector(".sprint-header .title")?.textContent).toBe("SPRINTS");
    });
});

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

describe("SprintList — empty state", () => {
    it("renders empty-small (and no count badge) when totalMilestones === 0", () => {
        const { result } = renderList({ totalMilestones: 0 });
        const { container } = result;

        const empty = container.querySelector(".empty-small");
        expect(empty).not.toBeNull();
        // The empty image carries the BACKLOG.SPRINTS.EMPTY alt text and the static path.
        const img = empty?.querySelector("img");
        expect(img?.getAttribute("alt")).toBe("There are no sprints yet");
        expect(img?.getAttribute("src")).toContain("images/empty/empty_sprint.png");
        expect(empty?.querySelector(".title")?.textContent).toBe("There are no sprints yet");

        // The count badge is hidden when there are zero sprints (ng-if fidelity).
        expect(container.querySelector(".sprint-header .number")).toBeNull();
    });

    it("prefixes the empty image with window.taigaConfig.baseHref when the shell seeded it", () => {
        // The AngularJS shell seeds window.taigaConfig before the React roots mount;
        // the empty-state image must resolve relative to its baseHref.
        const win = window as unknown as { taigaConfig?: { baseHref?: string } };
        win.taigaConfig = { baseHref: "/sub/path/" };
        try {
            const { result } = renderList({ totalMilestones: 0 });
            expect(result.container.querySelector(".empty-small img")?.getAttribute("src")).toBe(
                "/sub/path/images/empty/empty_sprint.png"
            );
        } finally {
            delete win.taigaConfig;
        }
    });
});

/* -------------------------------------------------------------------------- */
/* Closed-sprints toggle + reveal                                             */
/* -------------------------------------------------------------------------- */

describe("SprintList — closed sprints toggle", () => {
    it("does not render the toggle when there are no closed milestones", () => {
        const { result } = renderList({ totalMilestones: 1, totalClosedMilestones: 0 });
        expect(result.container.querySelector(".filter-closed-sprints")).toBeNull();
    });

    it("renders the toggle when closed milestones exist and calls onToggleClosedSprints on click", () => {
        const { props, result } = renderList({
            totalMilestones: 3,
            totalClosedMilestones: 2,
            closedSprints: [makeSprint({ id: 5, name: "Closed One", slug: "closed-one", closed: true })],
        });
        const toggle = result.container.querySelector(".filter-closed-sprints");
        expect(toggle).not.toBeNull();

        fireEvent.click(toggle as Element);
        expect(props.onToggleClosedSprints).toHaveBeenCalledTimes(1);
    });

    it("keeps the closed list hidden until closedSprintsVisible, and reflects the label", () => {
        const closedSprints = [
            makeSprint({ id: 5, name: "Closed One", slug: "closed-one", closed: true }),
        ];

        // Hidden: no .sprint-closed rendered; label prompts to SHOW.
        const hidden = renderList({
            totalMilestones: 3,
            totalClosedMilestones: 1,
            closedSprints,
            closedSprintsVisible: false,
        });
        expect(hidden.result.container.querySelector("div.sprint.sprint-closed")).toBeNull();
        expect(
            hidden.result.container.querySelector(".filter-closed-sprints .text")?.textContent
        ).toBe("Show closed sprints");
        expect(screen.queryByText("Closed One")).toBeNull();

        // Visible: one .sprint-closed wrapper; label switches to HIDE.
        const visible = renderList({
            totalMilestones: 3,
            totalClosedMilestones: 1,
            closedSprints,
            closedSprintsVisible: true,
        });
        expect(
            visible.result.container.querySelectorAll("div.sprint.sprint-closed")
        ).toHaveLength(1);
        expect(
            visible.result.container.querySelector(".filter-closed-sprints .text")?.textContent
        ).toBe("Hide closed sprints");
        expect(screen.getByText("Closed One")).toBeInTheDocument();
    });

    it("labels the toggle SHOW when visible but the loaded closed list is empty", () => {
        // Ports the tgBacklogToggleClosedSprintsVisualization `closed-sprints:reloaded`
        // branch: even when revealed, an empty reloaded list keeps the SHOW label.
        const { result } = renderList({
            totalMilestones: 3,
            totalClosedMilestones: 2,
            closedSprints: [],
            closedSprintsVisible: true,
        });
        expect(
            result.container.querySelector(".filter-closed-sprints .text")?.textContent
        ).toBe("Show closed sprints");
        expect(result.container.querySelector("div.sprint.sprint-closed")).toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* Add-sprint permission gating                                               */
/* -------------------------------------------------------------------------- */

describe("SprintList — add sprint gating", () => {
    it("shows the header add action only with add_milestone and fires onAddNewSprint", () => {
        const { props, result } = renderList({ totalMilestones: 2 });
        const headerAdd = result.container.querySelector(".sprint-header .btn-link");
        expect(headerAdd).not.toBeNull();

        fireEvent.click(headerAdd as Element);
        expect(props.onAddNewSprint).toHaveBeenCalledTimes(1);
    });

    it("hides the header add action when the user lacks add_milestone", () => {
        const project = makeProject({ my_permissions: ["view_milestones", "modify_us"] });
        const { result } = renderList({ totalMilestones: 2, project });
        expect(result.container.querySelector(".sprint-header .btn-link")).toBeNull();
    });

    it("shows the empty-state add action only with add_milestone and fires onAddNewSprint", () => {
        const { props, result } = renderList({ totalMilestones: 0 });
        const emptyAdd = result.container.querySelector(".empty-small .btn-link");
        expect(emptyAdd).not.toBeNull();

        fireEvent.click(emptyAdd as Element);
        expect(props.onAddNewSprint).toHaveBeenCalledTimes(1);
    });

    it("hides the empty-state add action when the user lacks add_milestone", () => {
        const project = makeProject({ my_permissions: ["view_milestones"] });
        const { result } = renderList({ totalMilestones: 0, project });
        expect(result.container.querySelector(".empty-small .btn-link")).toBeNull();
        // The empty state itself still renders (image + title).
        expect(result.container.querySelector(".empty-small img")).not.toBeNull();
    });
});
