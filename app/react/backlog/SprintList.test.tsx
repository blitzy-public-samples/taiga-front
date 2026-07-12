/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link SprintList}.
 *
 * `SprintList` is a DOM-preserving React reproduction of the AngularJS Backlog
 * sidebar sprint list (`app/partials/includes/modules/sprints.jade`): the
 * `section.sprints` container with the header (count + add-sprint button), the
 * empty-state, the OPEN sprint cards, the show/hide-closed-sprints toggle, and
 * the CLOSED sprint cards. Because the UNCHANGED Taiga SCSS
 * (`app/styles/modules/backlog/sprints.scss`) and the Protractor/Playwright
 * selectors target specific class names / literal `tg-*` attributes, these tests
 * assert on the emitted DOM structure (via `container.querySelector` /
 * `querySelectorAll`), on the `add_milestone` permission gating, on the
 * closed-sprints toggle label, and on the add / toggle / edit callback wiring —
 * NOT on translated copy (the i18n keys are rendered as their resolved English
 * copy by the component).
 *
 * Conventions (match the repo's React test harness — see `Sprint.test.tsx`):
 *   - Test-framework globals are imported explicitly from `@jest/globals`.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers are registered
 *     globally by `jest.setup.ts` (these tests use core matchers only).
 *
 * Each render is wrapped in a real `@dnd-kit/core` `<DndContext>` because every
 * sprint card is a `useDroppable` target ({@link DroppableSprint}). `useDroppable`
 * has a safe default outside a provider, but wrapping mirrors the production
 * `./Backlog.tsx` tree and keeps the render free of any context warnings. The
 * real {@link Sprint} / `SprintHeader` children are rendered (not mocked), so the
 * per-card controls asserted here (`.sprint-summary`, `.edit-sprint`) flow
 * through the actual components the production screen renders.
 */

import { describe, expect, it } from "@jest/globals";
import { render, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { SprintList } from "./SprintList";
import type { SprintListProps } from "./SprintList";
import type { Milestone, Project } from "../shared/types";

/**
 * Build a {@link Project} with the given permission set. `archived_code` defaults
 * to `null` (not archived) so a sprint card's edit control is gated only by
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

/** Build an OPEN sprint (milestone) fixture. */
function makeOpenSprint(id: number, overrides: Partial<Milestone> = {}): Milestone {
    return {
        id,
        name: `Sprint ${id}`,
        slug: `sprint-${id}`,
        closed: false,
        estimated_start: "2025-01-01",
        estimated_finish: "2025-01-15",
        total_points: 20,
        closed_points: 5,
        user_stories: [],
        ...overrides,
    };
}

/** Build a CLOSED sprint (milestone) fixture. */
function makeClosedSprint(id: number, overrides: Partial<Milestone> = {}): Milestone {
    return {
        id,
        name: `Sprint ${id}`,
        slug: `sprint-${id}`,
        closed: true,
        total_points: 20,
        closed_points: 20,
        user_stories: [],
        ...overrides,
    };
}

/** A no-op callback for props the test under focus does not assert on. */
const noop = (): void => {
    /* intentionally empty */
};

/**
 * Render `SprintList` inside a real `<DndContext>` with sensible defaults, letting
 * each test override only the props it cares about.
 */
function renderList(overrides: Partial<SprintListProps> = {}) {
    const props: SprintListProps = {
        project: makeProject(["add_milestone", "view_milestones", "modify_milestone"]),
        openSprints: [],
        closedSprints: [],
        totalMilestones: 0,
        totalClosedMilestones: 0,
        closedSprintsVisible: false,
        onAddSprint: noop,
        onToggleClosedSprints: noop,
        onEditSprint: noop,
        ...overrides,
    };
    return render(
        <DndContext>
            <SprintList {...props} />
        </DndContext>,
    );
}

describe("SprintList — header and count", () => {
    it("renders section.sprints, the count badge, the SPRINTS title and the add-sprint button", () => {
        const openSprints = [makeOpenSprint(1), makeOpenSprint(2)];
        const { container } = renderList({ openSprints, totalMilestones: 2 });

        // Container + header.
        expect(container.querySelector("section.sprints")).not.toBeNull();
        const header = container.querySelector("header.sprint-header");
        expect(header).not.toBeNull();

        // Count badge reflects totalMilestones; title is the resolved "SPRINTS" copy.
        const number = header!.querySelector("h1 .number") as HTMLElement | null;
        expect(number).not.toBeNull();
        expect(number!.textContent).toBe("2");
        expect((header!.querySelector("h1 .title") as HTMLElement).textContent).toBe("SPRINTS");

        // Add-sprint button carries BOTH btn-link (jade) and add-sprint (SCSS/e2e).
        const add = header!.querySelector("a.add-sprint") as HTMLElement | null;
        expect(add).not.toBeNull();
        expect(add!.classList.contains("btn-link")).toBe(true);
        expect(add!.getAttribute("title")).toBe("Add a sprint");
        expect((add!.querySelector("span") as HTMLElement).textContent).toBe("Add");
        // Compiled tg-svg sprite: <svg class="icon icon-add"><use xlink:href="#icon-add"/></svg>.
        expect(add!.querySelector("svg.icon.icon-add use")!.getAttribute("xlink:href")).toBe(
            "#icon-add",
        );
    });

    it("omits the count badge (and the header add-sprint button) when there are no milestones", () => {
        const { container } = renderList({ totalMilestones: 0 });
        expect(container.querySelector("h1 .number")).toBeNull();
        // The header add-sprint anchor is not rendered when totalMilestones is 0…
        expect(container.querySelector("header.sprint-header a.add-sprint")).toBeNull();
        // …but the title is always present.
        expect((container.querySelector("h1 .title") as HTMLElement).textContent).toBe("SPRINTS");
    });

    it("hides the header add-sprint button when the user lacks add_milestone", () => {
        const { container } = renderList({
            project: makeProject(["view_milestones"]),
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
        });
        expect(container.querySelector("header.sprint-header a.add-sprint")).toBeNull();
    });

    it("invokes onAddSprint (and prevents default) when the header add-sprint button is clicked", () => {
        let calls = 0;
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
            onAddSprint: () => {
                calls += 1;
            },
        });
        const add = container.querySelector("header.sprint-header a.add-sprint") as HTMLElement;
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        add.dispatchEvent(event);
        expect(calls).toBe(1);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe("SprintList — empty state", () => {
    it("renders .empty-small with image, title and a gated add-sprint link when totalMilestones is 0", () => {
        const { container } = renderList({ totalMilestones: 0 });

        const empty = container.querySelector(".empty-small") as HTMLElement | null;
        expect(empty).not.toBeNull();

        const img = empty!.querySelector("img") as HTMLImageElement;
        expect(img.getAttribute("alt")).toBe("There are no sprints yet");
        expect(img.getAttribute("src")).toBe("/v/images/empty/empty_sprint.png");
        expect((empty!.querySelector("p.title") as HTMLElement).textContent).toBe(
            "There are no sprints yet",
        );

        // The empty-state add link (user has add_milestone) carries btn-link + add-sprint.
        const add = empty!.querySelector("a.add-sprint") as HTMLElement | null;
        expect(add).not.toBeNull();
        expect(add!.classList.contains("btn-link")).toBe(true);
        expect((add!.querySelector("span") as HTMLElement).textContent).toBe(" Add a sprint");
    });

    it("omits the empty-state add link when the user lacks add_milestone", () => {
        const { container } = renderList({
            project: makeProject(["view_milestones"]),
            totalMilestones: 0,
        });
        expect(container.querySelector(".empty-small")).not.toBeNull();
        expect(container.querySelector(".empty-small a.add-sprint")).toBeNull();
    });

    it("does not render the empty state when there are milestones", () => {
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
        });
        expect(container.querySelector(".empty-small")).toBeNull();
    });

    it("invokes onAddSprint (and prevents default) from the empty-state add link", () => {
        let calls = 0;
        const { container } = renderList({
            totalMilestones: 0,
            onAddSprint: () => {
                calls += 1;
            },
        });
        const add = container.querySelector(".empty-small a.add-sprint") as HTMLElement;
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        add.dispatchEvent(event);
        expect(calls).toBe(1);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe("SprintList — open sprint cards", () => {
    it("renders one droppable div[tg-backlog-sprint].sprint-open per open sprint, each with the Sprint child", () => {
        const openSprints = [makeOpenSprint(1), makeOpenSprint(2), makeOpenSprint(3)];
        const { container } = renderList({ openSprints, totalMilestones: 3 });

        const cards = container.querySelectorAll('div[tg-backlog-sprint="sprint"]');
        expect(cards).toHaveLength(3);

        const openCards = container.querySelectorAll(".sprint.sprint-open");
        expect(openCards).toHaveLength(3);

        // No closed cards rendered while closed sprints are hidden.
        expect(container.querySelectorAll(".sprint.sprint-closed")).toHaveLength(0);

        // Each card carries the literal fidelity attribute and wraps a Sprint child.
        const first = openCards[0] as HTMLElement;
        expect(first.getAttribute("tg-backlog-sprint")).toBe("sprint");
        expect(first.hasAttribute("tg-sprint-sortable")).toBe(true);
        // The real Sprint/SprintHeader child renders its summary header.
        expect(first.querySelector(".sprint-summary")).not.toBeNull();
    });

    it("forwards onEditSprint from a card's edit control with the correct sprint", () => {
        const openSprints = [makeOpenSprint(7)];
        let edited: Milestone | null = null;
        const { container } = renderList({
            // modify_milestone + not archived -> the child SprintHeader renders `.edit-sprint`.
            project: makeProject(["modify_milestone", "view_milestones"]),
            openSprints,
            totalMilestones: 1,
            onEditSprint: (sprint) => {
                edited = sprint;
            },
        });

        const edit = container.querySelector(".sprint-open .edit-sprint") as HTMLElement | null;
        expect(edit).not.toBeNull();
        fireEvent.click(edit!);
        expect(edited).toBe(openSprints[0]);
    });
});

describe("SprintList — closed sprints toggle", () => {
    it("renders the .filter-closed-sprints toggle with the SHOW label when closed sprints are hidden", () => {
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
            closedSprints: [makeClosedSprint(9)],
            totalClosedMilestones: 1,
            closedSprintsVisible: false,
        });

        const toggle = container.querySelector("a.filter-closed-sprints") as HTMLElement | null;
        expect(toggle).not.toBeNull();
        expect(toggle!.querySelector("svg.icon.icon-folder use")!.getAttribute("xlink:href")).toBe(
            "#icon-folder",
        );
        expect((toggle!.querySelector(".text") as HTMLElement).textContent).toBe(
            "Show closed sprints",
        );

        // Closed cards are NOT rendered while hidden.
        expect(container.querySelectorAll(".sprint.sprint-closed")).toHaveLength(0);
    });

    it("shows the HIDE label and renders the closed sprint cards when closedSprintsVisible is true", () => {
        const closedSprints = [makeClosedSprint(9), makeClosedSprint(10)];
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
            closedSprints,
            totalClosedMilestones: 2,
            closedSprintsVisible: true,
        });

        expect(
            (container.querySelector("a.filter-closed-sprints .text") as HTMLElement).textContent,
        ).toBe("Hide closed sprints");

        const closedCards = container.querySelectorAll(".sprint.sprint-closed");
        expect(closedCards).toHaveLength(2);
        // Closed cards are droppable too and carry the fidelity attributes.
        const first = closedCards[0] as HTMLElement;
        expect(first.getAttribute("tg-backlog-sprint")).toBe("sprint");
        expect(first.hasAttribute("tg-sprint-sortable")).toBe(true);

        // All cards (open + closed) match the e2e sprints() selector.
        expect(container.querySelectorAll('div[tg-backlog-sprint="sprint"]')).toHaveLength(3);
    });

    it("hides the toggle entirely when there are no closed milestones", () => {
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
            totalClosedMilestones: 0,
        });
        expect(container.querySelector("a.filter-closed-sprints")).toBeNull();
    });

    it("invokes onToggleClosedSprints (and prevents default) when the toggle is clicked", () => {
        let calls = 0;
        const { container } = renderList({
            openSprints: [makeOpenSprint(1)],
            totalMilestones: 1,
            closedSprints: [makeClosedSprint(9)],
            totalClosedMilestones: 1,
            closedSprintsVisible: false,
            onToggleClosedSprints: () => {
                calls += 1;
            },
        });
        const toggle = container.querySelector("a.filter-closed-sprints") as HTMLElement;
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        toggle.dispatchEvent(event);
        expect(calls).toBe(1);
        expect(event.defaultPrevented).toBe(true);
    });
});
