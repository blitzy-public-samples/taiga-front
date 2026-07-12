/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link BurndownSummary}.
 *
 * `BurndownSummary` is a DOM-preserving React reproduction of the AngularJS
 * Backlog screen's "backlog summary" region (see
 * `app/partials/includes/components/summary.jade`, `progress-bar.jade`, and the
 * `TgBacklogProgressBarDirective` / `tgToggleBurndownVisibility` behavior in
 * `app/coffee/modules/backlog/main.coffee`). Because the unchanged Taiga SCSS
 * targets specific class names / element hierarchy, these tests assert on the
 * emitted DOM structure (via `container.querySelector` / `querySelectorAll`)
 * and on the progress-bar width math rather than on translated copy — the i18n
 * KEYS are rendered literally by the component for this POC.
 *
 * Conventions (match the repo's React test harness — see `KanbanHeader.test.tsx`):
 *   - Test-framework globals are imported explicitly from `@jest/globals`
 *     (`describe`/`it`/`expect`). This is the repo's committed convention and the
 *     only one that type-checks under the shipped toolchain: `@jest/globals`
 *     carries its own type declarations (via the `jest` dependency), whereas the
 *     ambient global forms would require a `@types/jest` package that is not part
 *     of this project's dependency set — so importing them keeps `tsc --noEmit`
 *     clean without adding an out-of-tree dependency.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom` environment; `@testing-library/jest-dom` matchers are
 *     registered globally by `jest.setup.ts` (these tests use core matchers only).
 */

import { describe, expect, it } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurndownSummary } from "./BurndownSummary";
import type { BacklogStats } from "./BurndownSummary";

/**
 * A "fully populated" stats projection, mirroring the object the AngularJS
 * `BacklogController` exposed once the resource layer resolved. The
 * `as BacklogStats` cast documents intent and keeps strict typing happy even as
 * the interface evolves (every member of `BacklogStats` is optional).
 */
const FULL_STATS = {
  completedPercentage: 42,
  total_points: 100,
  defined_points: 80,
  closed_points: 20,
  speed: 12,
} as BacklogStats;

describe("BurndownSummary — DOM contract", () => {
  it("renders the summary panel with the completed percentage", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    // The wrapper + panel + progress-bar the SCSS targets must all be present.
    expect(container.querySelector(".backlog-summary")).not.toBeNull();
    expect(container.querySelector(".summary")).not.toBeNull();
    expect(container.querySelector(".summary-progress-bar")).not.toBeNull();

    // `.data > span.number` renders `${completedPercentage}%` (0-decimal filter).
    const number = container.querySelector(".data .number");
    expect(number).not.toBeNull();
    expect(number!.textContent).toContain("42%");
  });

  it("renders four .summary-stats blocks when total_points is present", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    expect(container.querySelectorAll(".summary-stats")).toHaveLength(4);

    // The four description spans, in DOM order, carry the four i18n keys.
    const descriptions = Array.from(
      container.querySelectorAll(".summary-stats .description"),
    ).map((el) => el.textContent);
    expect(descriptions).toEqual([
      "BACKLOG.SUMMARY.PROJECT_POINTS",
      "BACKLOG.SUMMARY.DEFINED_POINTS",
      "BACKLOG.SUMMARY.CLOSED_POINTS",
      "BACKLOG.SUMMARY.POINTS_PER_SPRINT",
    ]);

    // The PROJECT_POINTS description is reachable by its literal text, proving
    // the block is actually rendered (only present when total_points is truthy).
    expect(screen.getByText("BACKLOG.SUMMARY.PROJECT_POINTS")).not.toBeNull();
  });

  it("omits the PROJECT_POINTS block when total_points is falsy", () => {
    const stats = {
      completedPercentage: 10,
      total_points: 0,
      defined_points: 50,
      closed_points: 5,
      speed: 8,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    // PROJECT_POINTS is dropped, leaving DEFINED / CLOSED / POINTS_PER_SPRINT.
    expect(container.querySelectorAll(".summary-stats")).toHaveLength(3);

    const descriptions = Array.from(
      container.querySelectorAll(".summary-stats .description"),
    ).map((el) => el.textContent);
    expect(descriptions).not.toContain("BACKLOG.SUMMARY.PROJECT_POINTS");
    expect(descriptions).toEqual([
      "BACKLOG.SUMMARY.DEFINED_POINTS",
      "BACKLOG.SUMMARY.CLOSED_POINTS",
      "BACKLOG.SUMMARY.POINTS_PER_SPRINT",
    ]);
  });

  it("computes and clamps the progress-bar widths", () => {
    // definedPoints(80) is NOT > totalPoints(100), so:
    //   projectPointsPercentage = 100        -> adjust(100 - 3) = 97
    //   closedPointsPercentage  = 40*100/100 -> adjust(40 - 3)  = 37
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    const projectBar = container.querySelector(
      ".project-points-progress",
    ) as HTMLElement | null;
    const closedBar = container.querySelector(
      ".closed-points-progress",
    ) as HTMLElement | null;
    expect(projectBar).not.toBeNull();
    expect(closedBar).not.toBeNull();

    const projectWidth = projectBar!.style.width;
    const closedWidth = closedBar!.style.width;

    // Inline widths are percentages...
    expect(projectWidth.endsWith("%")).toBe(true);
    expect(closedWidth.endsWith("%")).toBe(true);

    // ...with the exact clamped/rounded values from the legacy directive math.
    expect(projectWidth).toBe("97%");
    expect(closedWidth).toBe("37%");

    // ...and the parsed magnitudes are within the inclusive [0, 100] range.
    const projectValue = parseFloat(projectWidth);
    const closedValue = parseFloat(closedWidth);
    expect(projectValue).toBeGreaterThanOrEqual(0);
    expect(projectValue).toBeLessThanOrEqual(100);
    expect(closedValue).toBeGreaterThanOrEqual(0);
    expect(closedValue).toBeLessThanOrEqual(100);
  });

  it("scales the bars against defined_points when defined_points exceeds total_points", () => {
    // Excess-of-points branch (definedPoints > totalPoints):
    //   projectPointsPercentage = totalPoints*100/definedPoints = 50*100/100 = 50 -> adjust(47) = 47
    //   closedPointsPercentage  = closedPoints*100/definedPoints = 40*100/100 = 40 -> adjust(37) = 37
    const stats = {
      total_points: 50,
      defined_points: 100,
      closed_points: 40,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    const projectBar = container.querySelector(
      ".project-points-progress",
    ) as HTMLElement | null;
    const closedBar = container.querySelector(
      ".closed-points-progress",
    ) as HTMLElement | null;
    expect(projectBar).not.toBeNull();
    expect(closedBar).not.toBeNull();

    expect(projectBar!.style.width).toBe("47%");
    expect(closedBar!.style.width).toBe("37%");
  });

  it("renders the toggle button and burndown container when !showGraphPlaceholder", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    // The clickable toggle carries the js- hook class and wraps the graph icon.
    const toggle = container.querySelector(".js-toggle-burndown-visibility-button");
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector("svg.icon-graph")).not.toBeNull();

    // The (collapsible) burndown graph container + inner `.burndown` are present.
    expect(
      container.querySelector(".graphics-container.js-burndown-graph .burndown"),
    ).not.toBeNull();
  });

  it("shows the empty-burndown call-to-action only for admins with a placeholder", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    // showGraphPlaceholder && isAdmin -> the "customize graph" empty state shows.
    const { container: adminContainer } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder isAdmin />,
    );
    expect(adminContainer.querySelector(".empty-burndown")).not.toBeNull();

    // Non-admin (even with the placeholder) -> no empty-burndown block.
    const { container: nonAdminContainer } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder isAdmin={false} />,
    );
    expect(nonAdminContainer.querySelector(".empty-burndown")).toBeNull();
  });

  it("does not crash and still renders the wrapper when stats is null", () => {
    const { container } = render(
      <BurndownSummary stats={null} showGraphPlaceholder={false} />,
    );

    // Defensive skeleton: the wrapper + panel render even with no stats.
    expect(container.querySelector(".backlog-summary")).not.toBeNull();
    expect(container.querySelector(".summary")).not.toBeNull();
  });
});

describe("BurndownSummary — interactions", () => {
  it("toggles burndown-graph visibility when the toggle button is clicked", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    const graphics = container.querySelector(
      ".graphics-container.js-burndown-graph",
    )!;
    const toggle = container.querySelector(
      ".js-toggle-burndown-visibility-button",
    )!;

    // Visible by default: the container carries `shown` + `open`, and the
    // toggle carries `active`.
    expect(graphics.classList.contains("shown")).toBe(true);
    expect(graphics.classList.contains("open")).toBe(true);
    expect(toggle.classList.contains("active")).toBe(true);

    // Clicking collapses the graph: the container stays mounted (so its SCSS
    // transition + `.graphics-container .burndown` selector keep applying) but
    // loses the `shown`/`open` classes, and the toggle loses `active`.
    fireEvent.click(toggle);

    expect(
      container.querySelector(".graphics-container.js-burndown-graph"),
    ).not.toBeNull();
    expect(graphics.classList.contains("shown")).toBe(false);
    expect(graphics.classList.contains("open")).toBe(false);
    expect(toggle.classList.contains("active")).toBe(false);
  });

  it("toggles burndown-graph visibility via the keyboard (Enter) for accessibility", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );

    const graphics = container.querySelector(
      ".graphics-container.js-burndown-graph",
    )!;
    const toggle = container.querySelector(
      ".js-toggle-burndown-visibility-button",
    )!;

    // The toggle <div> is keyboard-operable (role=button, tabIndex=0): pressing
    // Enter runs the same visibility toggle as a pointer click.
    expect(graphics.classList.contains("shown")).toBe(true);
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(graphics.classList.contains("shown")).toBe(false);
    expect(graphics.classList.contains("open")).toBe(false);
  });
});
