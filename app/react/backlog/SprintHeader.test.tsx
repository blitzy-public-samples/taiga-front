/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link SprintHeader}.
 *
 * `SprintHeader` is the DOM-preserving React reproduction of the AngularJS
 * Backlog screen's per-sprint header (`app/partials/backlog/sprint-header.jade`
 * driven by the `BacklogSprintHeaderDirective` / `BacklogSprintDirective` in
 * `app/coffee/modules/backlog/sprints.coffee`). Because the AngularJS -> React
 * migration must be DOM/CSS-identical (the unchanged Taiga SCSS targets these
 * exact class names and element hierarchy), these tests assert on the emitted
 * DOM structure (class names, `title` attributes, the taskboard `href`, the
 * inline `svg.icon-*` sprite markup, the `DD MMM YYYY` date range, and the
 * closed/total points projection) rather than on translated copy — the i18n
 * KEYS are rendered as their resolved English copy by the component for this
 * POC.
 *
 * These tests exercise every branch of the component (the `isVisible` /
 * `isEditable` permission gates, the archived-project guard, the `expanded`
 * fold state, the date helper, and the two click handlers) and therefore
 * contribute to the >= 70% line-coverage gate for the new React code.
 *
 * Conventions (per the build constraints for this file, matching the repo's
 * `KanbanHeader.test.tsx` harness):
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *     They are provided by `@types/jest` (declared in `tsconfig.json`'s `types`
 *     array), so they type-check cleanly under `tsc --noEmit` and are
 *     intentionally NOT imported from `@jest/globals`.
 *   - The automatic JSX runtime (`jsx: "react-jsx"`) is used, so there is no
 *     `import React`.
 *   - `ts-jest` + `jsdom` environment; the `@testing-library/jest-dom` matchers
 *     are registered globally by `jest.setup.ts` (these tests deliberately use
 *     core matchers + plain DOM queries so they remain robust regardless of the
 *     matcher extension).
 *
 * jsdom note: the taskboard `href` is asserted via `getAttribute("href")` (the
 * literal `#/...` attribute value) rather than the `.href` IDL property, which
 * jsdom would resolve to an absolute `http://localhost/#/...` URL and cause a
 * false negative. The same applies to the `title` attributes.
 */

import { render, fireEvent } from "@testing-library/react";
import { SprintHeader } from "./SprintHeader";
import type { Milestone, Project } from "../shared/types";

// --- Fixtures -------------------------------------------------------------

/**
 * A fully populated sprint (milestone). The `as Milestone` cast documents intent
 * and keeps strict typing happy while omitting the many optional members the
 * header never reads.
 */
const sprint = {
  id: 1,
  name: "Sprint 1",
  slug: "sprint-1",
  estimated_start: "2020-01-10",
  estimated_finish: "2020-01-24",
  closed_points: 5,
  total_points: 20,
} as Milestone;

/**
 * A project where the current user may both view and modify milestones, and
 * which is not archived — so both the taskboard link (`isVisible`) and the
 * edit-sprint control (`isEditable`) render.
 */
const fullProject = {
  id: 7,
  slug: "proj",
  my_permissions: ["view_milestones", "modify_milestone"],
  is_kanban_activated: true,
  is_backlog_activated: true,
} as Project;

/**
 * A project where the current user has no permissions — so neither the
 * taskboard link nor the edit-sprint control renders.
 */
const noPermProject = {
  id: 7,
  slug: "proj",
  my_permissions: [],
  is_kanban_activated: true,
  is_backlog_activated: true,
} as Project;

/** A shared no-op callback for tests that do not assert on a specific handler. */
const noop = (): void => {};

// --- DOM contract ---------------------------------------------------------

describe("SprintHeader — DOM contract", () => {
  it("renders the sprint summary wrapper and the sprint-name span", () => {
    // Case 1: the SCSS-targeted `.sprint-summary` wrapper is present and the
    // taskboard link's `<span>` carries the (escaped) sprint name.
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".sprint-summary")).not.toBeNull();
    expect(container.querySelector(".sprint-name span")!.textContent).toBe(
      "Sprint 1",
    );
  });

  it("formats the estimated date range as DD MMM YYYY", () => {
    // Case 2: `estimated_start`-`estimated_finish`, each rendered via the
    // `moment(..).format("DD MMM YYYY")` replacement helper.
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".sprint-date")!.textContent).toBe(
      "10 Jan 2020-24 Jan 2020",
    );
  });

  it("renders the closed and total points, in order", () => {
    // Case 3: `.sprint-info` lists exactly two points figures — closed then
    // total — each with its `.number` value and `.description` label.
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    const items = container.querySelectorAll(".sprint-info li");
    expect(items).toHaveLength(2);

    expect(items[0].querySelector(".number")!.textContent).toBe("5");
    expect(items[0].querySelector(".description")!.textContent).toBe("closed");

    expect(items[1].querySelector(".number")!.textContent).toBe("20");
    expect(items[1].querySelector(".description")!.textContent).toBe("total");
  });

  it("marks the compact toggle active only when expanded, with icon + title", () => {
    // Case 4: the `.compact-sprint` fold toggle carries `active` while expanded,
    // exposes the static "Compact Sprint" title, and wraps the arrow sprite.
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    const toggle = container.querySelector(".compact-sprint");
    expect(toggle).not.toBeNull();
    expect(toggle!.classList.contains("active")).toBe(true);
    expect(toggle!.getAttribute("title")).toBe("Compact Sprint");
    expect(toggle!.querySelector("svg.icon-arrow-right")).not.toBeNull();

    // With `expanded={false}` the `active` class must be absent (SCSS uses it to
    // rotate the arrow between the collapsed/expanded states).
    const { container: collapsed } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded={false}
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    const collapsedToggle = collapsed.querySelector(".compact-sprint");
    expect(collapsedToggle).not.toBeNull();
    expect(collapsedToggle!.classList.contains("active")).toBe(false);
  });

  it("links the sprint name to the taskboard with the descriptive title", () => {
    // Case 5: the taskboard link resolves to the hashbang project-taskboard URL
    // and carries the "Go to the taskboard of <name>" title. `getAttribute` is
    // used so the literal attribute (not jsdom's resolved absolute URL) is read.
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    const link = container.querySelector(".sprint-name a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "#/project/proj/taskboard/sprint-1",
    );
    expect(link!.getAttribute("title")).toBe("Go to the taskboard of Sprint 1");
  });
});

// --- Permission gating ----------------------------------------------------

describe("SprintHeader — permission gating", () => {
  it("shows the edit-sprint control only with modify_milestone", () => {
    // Case 6: `isEditable` (not archived AND `modify_milestone`) gates the
    // `.edit-sprint` control and its edit sprite.
    const { container: editable } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    const editControl = editable.querySelector(".edit-sprint");
    expect(editControl).not.toBeNull();
    expect(editControl!.querySelector("svg.icon-edit")).not.toBeNull();

    // Without `modify_milestone`, the control must not be rendered.
    const { container: notEditable } = render(
      <SprintHeader
        sprint={sprint}
        project={noPermProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(notEditable.querySelector(".edit-sprint")).toBeNull();
  });

  it("hides the taskboard span without view_milestones", () => {
    // Case 7: `isVisible` (`view_milestones`) gates the taskboard link, so with
    // no permissions there is no `<span>` under `.sprint-name` (the points spans
    // live under `.sprint-info`, not `.sprint-name`).
    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={noPermProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".sprint-name span")).toBeNull();
  });

  it("disables editing for an archived project even with modify_milestone", () => {
    // Case 10: a truthy `archived_code` makes `isEditable` false regardless of
    // the `modify_milestone` permission, so the `.edit-sprint` control is gone.
    const archivedProject = { ...fullProject, archived_code: "x" } as Project;

    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={archivedProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".edit-sprint")).toBeNull();
  });
});

// --- Interactions ---------------------------------------------------------

describe("SprintHeader — interactions", () => {
  it("invokes onToggleCompact when the compact toggle is clicked", () => {
    // Case 8: activating `.compact-sprint` surfaces the legacy fold toggle.
    const onToggleCompact = jest.fn();

    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={onToggleCompact}
        onEdit={noop}
      />,
    );

    fireEvent.click(container.querySelector(".compact-sprint")!);
    expect(onToggleCompact).toHaveBeenCalledTimes(1);
  });

  it("invokes onEdit when the edit-sprint control is clicked", () => {
    // Case 9: activating `.edit-sprint` surfaces the legacy
    // `sprintform:edit` broadcast (needs `fullProject` so the control renders).
    const onEdit = jest.fn();

    const { container } = render(
      <SprintHeader
        sprint={sprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={onEdit}
      />,
    );

    fireEvent.click(container.querySelector(".edit-sprint")!);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

// --- Date helper edge cases ----------------------------------------------
//
// These supplement the 10 required cases: they drive the `formatSprintDate`
// fallback branches (missing value / non-ISO parse / unparseable value) so the
// date helper — called out by the file's validation notes — is fully covered.

describe("SprintHeader — date helper edge cases", () => {
  it("renders an empty side when a milestone date is missing", () => {
    // With no `estimated_start` / `estimated_finish`, each side of the range
    // formats to "" (the source template's "no date" affordance), so the
    // `.sprint-date` text collapses to the bare "-" separator.
    const undatedSprint = {
      ...sprint,
      estimated_start: undefined,
      estimated_finish: undefined,
    } as Milestone;

    const { container } = render(
      <SprintHeader
        sprint={undatedSprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".sprint-date")!.textContent).toBe("-");
  });

  it("falls back to the Date parser for non-ISO dates and drops unparseable ones", () => {
    // A non-`YYYY-MM-DD` but parseable value uses the `new Date(..)` fallback
    // (local components, so timezone-stable), while an unparseable value renders
    // as "" — exercising both remaining branches of the date helper.
    const mixedSprint = {
      ...sprint,
      estimated_start: "Jan 15 2020",
      estimated_finish: "not-a-date",
    } as Milestone;

    const { container } = render(
      <SprintHeader
        sprint={mixedSprint}
        project={fullProject}
        expanded
        onToggleCompact={noop}
        onEdit={noop}
      />,
    );

    expect(container.querySelector(".sprint-date")!.textContent).toBe(
      "15 Jan 2020-",
    );
  });
});
