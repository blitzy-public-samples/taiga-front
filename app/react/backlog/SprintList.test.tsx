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
 * `SprintList` is a DOM-preserving React 18.2 reproduction of the AngularJS
 * Backlog sidebar sprint list (`app/partials/includes/modules/sprints.jade`):
 * the `section.sprints` container holding, in order, the `header.sprint-header`
 * (the milestone COUNT + the "add sprint" button), the `.empty-small`
 * empty-state, the OPEN sprint cards, the `.filter-closed-sprints`
 * show/hide-closed-sprints toggle, and the CLOSED sprint cards. Because the
 * UNCHANGED Taiga SCSS (`app/styles/modules/backlog/sprints.scss`) and the
 * Protractor/Playwright selectors target specific class names and the literal
 * `tg-backlog-sprint="sprint"` attribute, these tests assert on the emitted DOM
 * structure (via `container.querySelector` / `querySelectorAll`), on the
 * `add_milestone` permission gating, on the closed-sprints toggle label, on the
 * closed-card visibility, and on the add / toggle callback wiring — NOT on
 * translated copy (the i18n keys are rendered as their resolved English copy by
 * the component). They contribute to the >= 70% line-coverage gate for the new
 * React code.
 *
 * Conventions (match the repo's React test harness — see `SprintHeader.test.tsx`
 * and `BacklogRow.test.tsx`):
 *   - AMBIENT Jest globals (`describe` / `it` / `expect` / `jest`) are used
 *     directly — this file intentionally does NOT import from `@jest/globals`.
 *     The project ships `@types/jest` (`package.json`) and lists `"jest"` in the
 *     `tsconfig.json` `types` array, so the ambient forms (and `jest.fn()` for
 *     the callback spies) type-check cleanly under `tsc --noEmit`.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — there is no `import React`.
 *   - `ts-jest` + `jsdom`; the `@testing-library/jest-dom` matchers are
 *     registered globally by `jest.setup.ts` (these tests deliberately use core
 *     matchers + plain DOM queries so they stay robust regardless of the matcher
 *     extension).
 *
 * Each render is wrapped in a real `@dnd-kit/core` `<DndContext>` because every
 * sprint card is a `useDroppable` target (`SprintList`'s local `DroppableSprint`
 * wrapper). `useDroppable` has a safe default outside a provider, but wrapping
 * mirrors the production `./Backlog.tsx` tree and guarantees the hook always has
 * a context. The real `Sprint` / `SprintHeader` children are rendered (not
 * mocked), so the per-card `.sprint-name` markup asserted here flows through the
 * actual components the production screen renders.
 */

import { render, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { SprintList } from "./SprintList";
import type { SprintListProps } from "./SprintList";
import type { Milestone, Project } from "../shared/types";

// ---------------------------------------------------------------------------
// Fixtures
//
// The `as Project` / `as Milestone` casts document intent and keep strict typing
// happy while omitting the many optional model members the sprint list never
// reads. `project` holds every permission the screen gates on; `noPerm` strips
// them all to exercise the gating branches.
// ---------------------------------------------------------------------------

/** A project whose permissions unlock every gated control in the sprint list. */
const project = {
    id: 7,
    slug: "proj",
    my_permissions: ["add_milestone", "view_milestones", "modify_milestone", "modify_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
} as Project;

/** The same project with no permissions — gates off every add/edit control. */
const noPerm = { ...project, my_permissions: [] } as Project;

/**
 * Build a sprint (milestone) fixture. `closed` selects the OPEN vs CLOSED list
 * the card is rendered in (and therefore the `.sprint-open` / `.sprint-closed`
 * modifier chosen by {@link SprintList}).
 */
const mkSprint = (id: number, name: string, closed = false): Milestone =>
    ({
        id,
        name,
        slug: `s-${id}`,
        estimated_start: "2020-01-01",
        estimated_finish: "2020-01-15",
        closed,
        closed_points: 0,
        total_points: 0,
        user_stories: [],
    }) as Milestone;

/** Two open sprints and one closed sprint feeding the default render. */
const open = [mkSprint(1, "S1"), mkSprint(2, "S2")];
const closed = [mkSprint(3, "S3", true)];

/** A no-op callback for props the test under focus does not assert on. */
const noop = (): void => {
    /* intentionally empty */
};

/**
 * Render `SprintList` inside a real `<DndContext>` (the provider every sprint
 * card's `useDroppable` reads from) with the realistic defaults below, letting
 * each test override only the props it cares about.
 */
function renderList(overrides: Partial<SprintListProps> = {}) {
    const props: SprintListProps = {
        project,
        openSprints: open,
        closedSprints: closed,
        totalMilestones: 2,
        totalClosedMilestones: 1,
        closedSprintsVisible: false,
        onAddSprint: noop,
        onToggleClosedSprints: noop,
        onEditSprint: noop,
        ...overrides,
    };

    return render(
        <DndContext>
            {/* provider for useDroppable */}
            <SprintList {...props} />
        </DndContext>,
    );
}

describe("SprintList", () => {
    // Case 1 — the sprints section, the milestone count badge and the title.
    it("renders section.sprints with the count badge and the SPRINTS title", () => {
        const { container } = renderList();

        expect(container.querySelector(".sprints")).not.toBeNull();
        expect(container.querySelector(".sprint-header .number")!.textContent).toBe("2");
        expect(container.querySelector(".sprint-header .title")!.textContent).toBe("SPRINTS");
    });

    // Case 2 — one droppable card per open sprint, each carrying the LITERAL
    // `tg-backlog-sprint="sprint"` attribute the e2e selectors rely on.
    it('renders a div[tg-backlog-sprint="sprint"].sprint-open per open sprint', () => {
        const { container } = renderList();

        expect(
            container.querySelectorAll('div[tg-backlog-sprint="sprint"].sprint-open'),
        ).toHaveLength(2);
    });

    // Case 3 — the add-sprint control renders with add_milestone and is gated off
    // without it.
    it("renders the add-sprint control only for users with add_milestone", () => {
        const { container } = renderList();
        expect(container.querySelector(".add-sprint")).not.toBeNull();

        const gated = renderList({ project: noPerm });
        expect(gated.container.querySelector(".add-sprint")).toBeNull();
    });

    // Case 4 — the empty-state placeholder replaces the cards (and the count
    // badge is absent) when there are no milestones.
    it("renders the empty-small placeholder (and no count badge) when totalMilestones is 0", () => {
        const { container } = renderList({ totalMilestones: 0, openSprints: [] });

        const empty = container.querySelector(".empty-small");
        expect(empty).not.toBeNull();
        expect(empty!.querySelector(".title")!.textContent).toBe("There are no sprints yet");
        expect(container.querySelector(".sprint-header .number")).toBeNull();
    });

    // Case 5 — the closed-sprints toggle is present and its label reflects the
    // current `closedSprintsVisible` flag.
    it("renders the closed-sprints toggle with a label that reflects visibility", () => {
        const shown = renderList();
        expect(shown.container.querySelector(".filter-closed-sprints")).not.toBeNull();
        expect(shown.container.querySelector(".filter-closed-sprints .text")!.textContent).toBe(
            "Show closed sprints",
        );

        const visible = renderList({ closedSprintsVisible: true });
        expect(visible.container.querySelector(".filter-closed-sprints .text")!.textContent).toBe(
            "Hide closed sprints",
        );
    });

    // Case 6 — closed sprint cards are rendered only while closedSprintsVisible.
    it("renders closed sprint cards only when closedSprintsVisible is true", () => {
        const { container } = renderList();
        expect(container.querySelectorAll(".sprint-closed")).toHaveLength(0);

        const visible = renderList({ closedSprintsVisible: true });
        expect(visible.container.querySelectorAll(".sprint-closed")).toHaveLength(1);
    });

    // Case 7 — the closed-sprints toggle is hidden when there are no closed
    // milestones to reveal.
    it("hides the closed-sprints toggle when there are no closed milestones", () => {
        const { container } = renderList({ totalClosedMilestones: 0 });

        expect(container.querySelector(".filter-closed-sprints")).toBeNull();
    });

    // Case 8 — clicking the add-sprint control invokes onAddSprint exactly once.
    it("invokes onAddSprint when the add-sprint control is clicked", () => {
        const fn = jest.fn();
        const { container } = renderList({ onAddSprint: fn });

        fireEvent.click(container.querySelector(".add-sprint")!);

        expect(fn).toHaveBeenCalledTimes(1);
    });

    // Case 9 — clicking the closed-sprints toggle invokes onToggleClosedSprints
    // exactly once.
    it("invokes onToggleClosedSprints when the closed-sprints toggle is clicked", () => {
        const fn = jest.fn();
        const { container } = renderList({ onToggleClosedSprints: fn });

        fireEvent.click(container.querySelector(".filter-closed-sprints")!);

        expect(fn).toHaveBeenCalledTimes(1);
    });

    // Case 10 — each open sprint's name is rendered through Sprint -> SprintHeader
    // (the project holds view_milestones, so the `.sprint-name` link/span shows).
    it("renders each open sprint's name via Sprint -> SprintHeader", () => {
        const { container } = renderList();

        const names = Array.from(
            container.querySelectorAll('div[tg-backlog-sprint="sprint"] .sprint-name span'),
        ).map((el) => el.textContent);

        expect(names).toContain("S1");
        expect(names).toContain("S2");
    });
});
