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
 * closed-sprints toggle label, and on the add / toggle / edit callback wiring.
 * All visible copy is asserted THROUGH the shared `t()` runtime against the SAME
 * keys the component binds (`BACKLOG.SPRINTS.TITLE`, `.TITLE_ACTION_NEW_SPRINT`,
 * `.EMPTY`, `.ACTION_SHOW_CLOSED_SPRINTS` / `.ACTION_HIDE_CLOSED_SPRINTS`,
 * `COMMON.ADD`) — never against a hard-coded literal — so a broken key wiring or
 * a dropped translation is caught, and a dedicated test proves no raw `KEY.PATH`
 * token leaks into the DOM.
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
import { t } from "../shared/i18n/translate";

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
        expect((header!.querySelector("h1 .title") as HTMLElement).textContent).toBe(
            t("BACKLOG.SPRINTS.TITLE"),
        );

        // Add-sprint button carries BOTH btn-link (jade) and add-sprint (SCSS/e2e).
        const add = header!.querySelector("a.add-sprint") as HTMLElement | null;
        expect(add).not.toBeNull();
        expect(add!.classList.contains("btn-link")).toBe(true);
        expect(add!.getAttribute("title")).toBe(t("BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT"));
        expect((add!.querySelector("span") as HTMLElement).textContent).toBe(t("COMMON.ADD"));
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
        expect((container.querySelector("h1 .title") as HTMLElement).textContent).toBe(
            t("BACKLOG.SPRINTS.TITLE"),
        );
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
        expect(img.getAttribute("alt")).toBe(t("BACKLOG.SPRINTS.EMPTY"));
        expect(img.getAttribute("src")).toBe("/v/images/empty/empty_sprint.png");
        expect((empty!.querySelector("p.title") as HTMLElement).textContent).toBe(
            t("BACKLOG.SPRINTS.EMPTY"),
        );

        // The empty-state add link (user has add_milestone) carries btn-link + add-sprint.
        const add = empty!.querySelector("a.add-sprint") as HTMLElement | null;
        expect(add).not.toBeNull();
        expect(add!.classList.contains("btn-link")).toBe(true);
        expect((add!.querySelector("span") as HTMLElement).textContent).toBe(
            " " + t("BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT"),
        );
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
            t("BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS"),
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
        ).toBe(t("BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS"));

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

describe("SprintList — i18n resolution (M7)", () => {
    // Guards finding M7: every visible string must be a RESOLVED translation, not
    // a hard-coded literal AND not an unresolved `KEY.PATH` token leaking through.
    it("resolves the header, add-sprint and closed-toggle keys to non-empty copy (never the raw key)", () => {
        // Header title, add-sprint button + empty-state key + both toggle labels.
        for (const key of [
            "BACKLOG.SPRINTS.TITLE",
            "BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT",
            "BACKLOG.SPRINTS.EMPTY",
            "BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS",
            "BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS",
            "COMMON.ADD",
        ]) {
            const resolved = t(key);
            expect(resolved.length).toBeGreaterThan(0);
            // A resolved value must differ from the dotted key path it was looked up by.
            expect(resolved).not.toBe(key);
        }
    });

    it("emits no raw KEY.PATH i18n token anywhere in the rendered sprint list", () => {
        // Render a fully-populated list so every translated surface is present:
        // header (count + add button), open cards, the closed toggle (SHOW state)
        // and, in a second render, the HIDE state + closed cards + empty state.
        const populated = renderList({
            openSprints: [makeOpenSprint(1), makeOpenSprint(2)],
            totalMilestones: 2,
            closedSprints: [makeClosedSprint(9)],
            totalClosedMilestones: 1,
            closedSprintsVisible: true,
        });
        const empty = renderList({ totalMilestones: 0 });

        // An unresolved AngularJS/React i18n key would surface as an uppercase,
        // dot-separated token (e.g. "BACKLOG.SPRINTS.TITLE"). Assert none leak.
        const RAW_KEY = /\b[A-Z][A-Z0-9_]+(?:\.[A-Z0-9_]+)+\b/;
        expect(RAW_KEY.test(populated.container.textContent ?? "")).toBe(false);
        expect(RAW_KEY.test(empty.container.textContent ?? "")).toBe(false);

        // And the concrete resolved copy IS present.
        expect(populated.container.textContent).toContain(t("BACKLOG.SPRINTS.TITLE"));
        expect(populated.container.textContent).toContain(
            t("BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS"),
        );
        expect(empty.container.textContent).toContain(t("BACKLOG.SPRINTS.EMPTY"));
    });
});

// =============================================================================
// renderStoryRow forwarding (finding C8)
//
// `./Backlog.tsx` threads a `renderStoryRow` render-prop for SORTABLE sprint
// story rows. It must reach OPEN sprint cards (whose stories become draggable)
// but NEVER the CLOSED sprint cards (whose stories stay plain / non-draggable,
// matching the closed-sprint rejection contract).
// =============================================================================
describe("SprintList — renderStoryRow forwarding (C8)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openStory = { id: 301, ref: 301, subject: "Open story", status: 1 } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const closedStory = { id: 901, ref: 901, subject: "Closed story", status: 1 } as any;

    it("forwards renderStoryRow to OPEN sprints only, never to CLOSED sprints", () => {
        const seen: number[] = [];
        const { container } = renderList({
            openSprints: [makeOpenSprint(3, { user_stories: [openStory] })],
            closedSprints: [makeClosedSprint(9, { user_stories: [closedStory] })],
            totalMilestones: 1,
            totalClosedMilestones: 1,
            closedSprintsVisible: true,
            renderStoryRow: (us) => {
                seen.push(us.id);
                return <div key={us.id} data-testid="rr" data-id={String(us.id)} />;
            },
        });

        // Only the OPEN sprint's story went through renderStoryRow.
        expect(seen).toEqual([openStory.id]);

        // The open sprint's story rendered via the custom (sortable) row...
        const custom = container.querySelectorAll('[data-testid="rr"]');
        expect(custom.length).toBe(1);
        expect(custom[0].getAttribute("data-id")).toBe(String(openStory.id));

        // ...while the closed sprint's story rendered via the PLAIN row path.
        const plainRows = container.querySelectorAll(".milestone-us-item-row");
        expect(plainRows.length).toBe(1);
        expect(plainRows[0].getAttribute("data-id")).toBe(String(closedStory.id));
    });
});
