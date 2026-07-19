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
 * Runs in the browserless jsdom environment (jest.config.js). The component
 * calls `useDroppable` and its child `SprintStoryRow` calls `useDraggable`, so
 * every render MUST be wrapped in a real `@dnd-kit/core` `<DndContext>` (the
 * `renderSprint` helper does this). No shared/network modules are mocked.
 *
 * The component is imported ALIASED (`Sprint as SprintCard`) to avoid a name
 * collision with the `Sprint` domain type imported from `../types`.
 *
 * NOTE on the collapse classes: the real component (and the original AngularJS
 * `tgBacklogSprint.toggleSprint`) marks the compact button `.active` and the
 * table `.open` when the sprint is EXPANDED — an OPEN sprint (`closed:false`)
 * therefore starts with both classes, and a CLOSED sprint starts without them.
 * The collapse specs below assert that verified direction; the invariant under
 * test is that `collapsed` initialises from `sprint.closed`.
 */

import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { DndContext } from "@dnd-kit/core";
import { Sprint as SprintCard } from "../Sprint";
import type { Project, Sprint, UserStory } from "../types";

/* -------------------------------------------------------------------------- */
/* Test data factories                                                        */
/* -------------------------------------------------------------------------- */

function makeUs(partial: Partial<UserStory> & { id: number; ref: number }): UserStory {
  return {
    subject: `US ${partial.ref}`,
    project: 1,
    status: 1,
    milestone: 1,
    points: {},
    total_points: null,
    backlog_order: partial.ref,
    sprint_order: partial.ref,
    assigned_to: null,
    is_blocked: false,
    is_closed: false,
    tags: null,
    epics: null,
    due_date: null,
    version: 1,
    ...partial,
  };
}

function makeSprint(partial: Partial<Sprint> & { id: number }): Sprint {
  return {
    name: `Sprint ${partial.id}`,
    slug: `sprint-${partial.id}`,
    project: 1,
    estimated_start: "2021-01-01",
    estimated_finish: "2021-01-15",
    closed: false,
    closed_points: 0,
    total_points: 0,
    user_stories: [],
    ...partial,
  };
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 1,
    slug: "proj",
    name: "Proj",
    my_permissions: ["modify_us", "modify_milestone", "view_milestones"],
    roles: [],
    points: [],
    us_statuses: [],
    is_backlog_activated: true,
    is_kanban_activated: false,
    default_us_status: 1,
    total_milestones: 0,
    i_am_admin: true,
    ...partial,
  };
}

type Props = ComponentProps<typeof SprintCard>;

function renderSprint(overrides: Partial<Props> = {}) {
  const onEditSprint = jest.fn();
  const props: Props = {
    sprint: makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1 })] }),
    project: makeProject(),
    dragEnabled: true,
    onEditSprint,
    ...overrides,
  };
  const utils = render(
    <DndContext onDragEnd={() => { /* noop */ }}>
      <SprintCard {...props} />
    </DndContext>,
  );
  return { ...utils, onEditSprint };
}

describe("Sprint", () => {
  it("renders the summary markup (name, date, points, progress bar)", () => {
    const sprint = makeSprint({ id: 1, name: "Sprint Alpha", closed_points: 5, total_points: 10, user_stories: [makeUs({ id: 1, ref: 1, total_points: 5 })] });
    const { container } = renderSprint({ sprint });
    expect(container.querySelector(".sprint-summary")).not.toBeNull();
    expect(container.querySelector(".sprint-name")).not.toBeNull();
    expect(container.querySelector(".sprint-date")).not.toBeNull();
    expect(container.querySelector(".sprint-points")).not.toBeNull();
    expect(container.querySelector(".sprint-progress-bar")).not.toBeNull();
    expect(container.textContent).toContain("Sprint Alpha");
  });

  it("marks the progress bar .full and clamps width to 100% when closed >= total", () => {
    const sprint = makeSprint({ id: 1, closed_points: 15, total_points: 10, user_stories: [makeUs({ id: 1, ref: 1 })] });
    const { container } = renderSprint({ sprint });
    expect(container.querySelector(".sprint-progress-bar.full")).not.toBeNull();
    const bar = container.querySelector(".current-progress") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("computes an intermediate width without .full", () => {
    const sprint = makeSprint({ id: 1, closed_points: 5, total_points: 10, user_stories: [makeUs({ id: 1, ref: 1 })] });
    const { container } = renderSprint({ sprint });
    expect(container.querySelector(".sprint-progress-bar.full")).toBeNull();
    const bar = container.querySelector(".current-progress") as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });

  it("initialises expanded when sprint is open and toggles collapse via the compact button", () => {
    const sprint = makeSprint({ id: 1, closed: false, user_stories: [makeUs({ id: 1, ref: 1 })] });
    const { container } = renderSprint({ sprint });
    // [BL-11] An OPEN sprint starts EXPANDED: the table carries `.open`, and the
    // compact button is NOT `.active`. Per the corrected contract `.active` marks
    // the COLLAPSED state (the CSS rotates the single `icon-arrow-right` glyph to
    // rotate(0) → points right ▷ when collapsed; the default un-`active` state is
    // rotate(90deg) → points down ▽ when expanded).
    expect(container.querySelector(".sprint-table.open")).not.toBeNull();
    expect(container.querySelector(".compact-sprint.active")).toBeNull();
    fireEvent.click(container.querySelector(".compact-sprint") as HTMLElement);
    // Clicking the compact button COLLAPSES it: `.open` drops and `.active` turns ON.
    expect(container.querySelector(".sprint-table.open")).toBeNull();
    expect(container.querySelector(".compact-sprint.active")).not.toBeNull();
  });

  it("initialises collapsed when sprint is closed", () => {
    const sprint = makeSprint({ id: 2, closed: true, user_stories: [makeUs({ id: 1, ref: 1 })] });
    const { container } = renderSprint({ sprint });
    // [BL-11] A CLOSED sprint starts COLLAPSED: `.compact-sprint` carries `.active`
    // (arrow rotated to point right ▷) and the table has NO `.open`.
    expect(container.querySelector(".compact-sprint.active")).not.toBeNull();
    expect(container.querySelector(".sprint-table.open")).toBeNull();
  });

  it("renders .sprint-empty with warning text for an empty sprint", () => {
    const { container } = renderSprint({ sprint: makeSprint({ id: 1, closed: false, user_stories: [] }) });
    const empty = container.querySelector(".sprint-empty");
    expect(empty).not.toBeNull();
    expect((empty!.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("renders .sprint-empty for an anonymous/no-permission viewer too", () => {
    const { container } = renderSprint({ project: makeProject({ my_permissions: [] }), sprint: makeSprint({ id: 1, user_stories: [] }) });
    expect(container.querySelector(".sprint-empty")).not.toBeNull();
  });

  it("gives each story row a data-id and renders the subject as plain text (XSS-safe)", () => {
    const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 7, ref: 7, subject: "<img src=x onerror=alert(1)>" })] });
    const { container } = renderSprint({ sprint });
    expect(container.querySelector('[data-id="7"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("does not expose drag affordances when dragEnabled is false", () => {
    const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 7, ref: 7 })] });
    const { container } = renderSprint({ dragEnabled: false, sprint });
    expect(container.querySelector('[data-id="7"]')).not.toBeNull();
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull();
  });

  it("toggles .closedRow and .blockedRow on the corresponding US flags", () => {
    const sprint = makeSprint({ id: 1, user_stories: [
      makeUs({ id: 1, ref: 1, is_closed: true }),
      makeUs({ id: 2, ref: 2, is_blocked: true }),
      makeUs({ id: 3, ref: 3 }),
    ] });
    const { container } = renderSprint({ sprint });
    expect(container.querySelector(".closedRow")).not.toBeNull();
    expect(container.querySelector(".blockedRow")).not.toBeNull();
  });

  it("marks rows .readonly when the viewer lacks modify_us", () => {
    const { container } = renderSprint({ project: makeProject({ my_permissions: [] }), sprint: makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1 })] }) });
    expect(container.querySelector(".readonly")).not.toBeNull();
  });

  it("renders .column-points.width-1 only when total_points is not null", () => {
    const withPts = renderSprint({ sprint: makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1, total_points: 5 })] }) });
    expect(withPts.container.querySelector(".column-points.width-1")).not.toBeNull();
  });

  it("omits .column-points.width-1 when total_points is null", () => {
    const noPts = renderSprint({ sprint: makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1, total_points: null })] }) });
    expect(noPts.container.querySelector(".column-points.width-1")).toBeNull();
  });

  it("fires onEditSprint when the edit control is clicked", () => {
    const sprint = makeSprint({ id: 9, user_stories: [makeUs({ id: 1, ref: 1 })] });
    const { container, onEditSprint } = renderSprint({ sprint, project: makeProject({ my_permissions: ["modify_milestone"], i_am_admin: true }) });
    const edit = container.querySelector(".edit-sprint") as HTMLElement | null;
    expect(edit).not.toBeNull();
    fireEvent.click(edit!);
    expect(onEditSprint).toHaveBeenCalledTimes(1);
    expect(onEditSprint).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  /* ---------------------------------------------------------------------- */
  /* [Q] Accessible names / roles for icon-only controls                    */
  /* ---------------------------------------------------------------------- */

  describe("accessibility (a11y names/roles)", () => {
    it("[Q] names the compact-sprint chevron and exposes its expanded state", () => {
      const { container } = renderSprint();
      const chevron = container.querySelector(".compact-sprint") as HTMLElement;
      expect(chevron).not.toBeNull();
      expect(chevron).toHaveAttribute("aria-label", "Compact Sprint");
      // Sprints start expanded (not collapsed) -> aria-expanded="true".
      expect(chevron).toHaveAttribute("aria-expanded", "true");

      // Toggling collapses it -> aria-expanded flips to "false".
      fireEvent.click(chevron);
      expect(chevron).toHaveAttribute("aria-expanded", "false");
    });

    it("[Q] exposes the edit-sprint anchor as a named button", () => {
      const { container } = renderSprint();
      const edit = container.querySelector(".edit-sprint") as HTMLElement;
      expect(edit).not.toBeNull();
      expect(edit).toHaveAttribute("role", "button");
      expect(edit).toHaveAttribute("aria-label", "Edit Sprint");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* [M-07] baseHref-aware HTML5 navigation (no `#`-fragment)               */
  /* ---------------------------------------------------------------------- */

  describe("[M-07] HTML5 navigation", () => {
    it("links each user story to the baseHref-aware HTML5 us route (not a #-fragment)", () => {
      const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 5, ref: 42 })] });
      const { container } = renderSprint({ sprint, project: makeProject({ slug: "myproj" }) });
      const link = container.querySelector("a.us-name") as HTMLAnchorElement | null;
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/project/myproj/us/42");
      // must NOT be a hash-fragment link
      expect(link!.getAttribute("href")).not.toMatch(/^#/);
    });

    it("links the sprint header name and the bottom taskboard button to the HTML5 taskboard route", () => {
      const sprint = makeSprint({ id: 7, slug: "sprint-7", user_stories: [makeUs({ id: 1, ref: 1 })] });
      const { container } = renderSprint({ sprint, project: makeProject({ slug: "myproj" }) });
      const links = Array.from(container.querySelectorAll("a")).filter(
        (a) => a.getAttribute("href") === "/project/myproj/taskboard/sprint-7",
      );
      // header name link + bottom "go to taskboard" button both resolve here
      expect(links.length).toBe(2);
      links.forEach((a) => expect(a.getAttribute("href")).not.toMatch(/^#/));
    });
  });

  /* ---------------------------------------------------------------------- */
  /* [M-08] Due-date icon / severity color / formatted-date tooltip        */
  /* ---------------------------------------------------------------------- */

  describe("[M-08] due-date parity", () => {
    it("renders no due-date marker when the story has no due date", () => {
      const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1, due_date: null })] });
      const { container } = renderSprint({ sprint });
      expect(container.querySelector(".due-date")).toBeNull();
    });

    it("renders the due-date clock icon with severity fill and a formatted tooltip", () => {
      // 2000-01-01 is far in the past -> "past due" (red #E44057) with the
      // default thresholds.
      const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1, due_date: "2000-01-01" })] });
      const { container } = renderSprint({ sprint });

      const wrapper = container.querySelector(".due-date");
      expect(wrapper).not.toBeNull();

      const icon = wrapper!.querySelector("svg.icon.icon-clock") as SVGElement | null;
      expect(icon).not.toBeNull();
      // severity color applied as the svg fill (past due -> red #E44057).
      // jsdom preserves the hex string exactly as set on the inline style.
      expect((icon as unknown as HTMLElement).style.fill).toBe("#E44057");

      // the icon wrapper carries the themed `.due-date-icon` class
      expect(wrapper!.querySelector(".due-date-icon")).not.toBeNull();

      // tooltip = COMMON.CARD.DUE_DATE interpolated with the formatted date +
      // status name ("01 Jan 2000 (past due)")
      const title = icon!.querySelector("use > title");
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe("Due date: 01 Jan 2000 (past due)");
    });

    it("uses the project's us_duedates thresholds when provided", () => {
      // A single all-green threshold forces "normal due" regardless of date.
      const sprint = makeSprint({ id: 1, user_stories: [makeUs({ id: 1, ref: 1, due_date: "2000-01-01" })] });
      const project = makeProject({
        slug: "proj",
        us_duedates: [
          { color: "#00FF00", name: "custom green", days_to_due: null, by_default: true },
        ],
      });
      const { container } = renderSprint({ sprint, project });
      const icon = container.querySelector(".due-date svg.icon.icon-clock") as SVGElement | null;
      expect(icon).not.toBeNull();
      expect((icon as unknown as HTMLElement).style.fill).toBe("#00FF00");
      const title = icon!.querySelector("use > title");
      expect(title!.textContent).toBe("Due date: 01 Jan 2000 (custom green)");
    });
  });
});
