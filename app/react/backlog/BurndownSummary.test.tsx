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
 * `app/partials/includes/components/summary.jade`, `progress-bar.jade`, the
 * `TgBacklogProgressBarDirective` / `tgToggleBurndownVisibility` behavior, and
 * the `TgBurndownBacklogGraphDirective` Flot chart in
 * `app/coffee/modules/backlog/main.coffee`). Because the unchanged Taiga SCSS
 * targets specific class names / element hierarchy, these tests assert on the
 * emitted DOM structure (via `container.querySelector` / `querySelectorAll`)
 * and on the progress-bar width math. Every user-visible label is RESOLVED
 * through the same `t()` i18n runtime the component uses, so the expected copy
 * is derived from the source-of-truth message bundle (never a hard-coded string
 * and never a raw `BACKLOG.*` key).
 *
 * Conventions (match the repo's React test harness — see `KanbanHeader.test.tsx`):
 *   - Test-framework globals are imported explicitly from `@jest/globals`
 *     (`describe`/`it`/`expect`).
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom` environment; `@testing-library/jest-dom` matchers are
 *     registered globally by `jest.setup.ts` (these tests use core matchers only).
 */

import { describe, expect, it } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurndownSummary } from "./BurndownSummary";
import type { BacklogStats, BurndownMilestoneStat } from "./BurndownSummary";
import { t } from "../shared/i18n/translate";

/**
 * Resolve a summary-description key exactly as the component does, then strip the
 * inline `<br />` the message bundle embeds (`defined<br />points`) — the rendered
 * `.description` textContent concatenates the text nodes without the `<br>`.
 */
function desc(key: string): string {
  return t(key).replace(/<br\s*\/?>/gi, "");
}

/**
 * A representative burndown series (authoritative scalar shape): two real sprints
 * plus a future sprint whose `evolution` is null (exercises the null-skip path).
 */
const MILESTONES: BurndownMilestoneStat[] = [
  { name: "Sprint 4", optimal: 100, evolution: 100, "team-increment": 0, "client-increment": 0 },
  { name: "Sprint 5", optimal: 50, evolution: 60, "team-increment": 0, "client-increment": 0 },
  { name: "Future sprint", optimal: 0, evolution: null, "team-increment": 0, "client-increment": 0 },
];

/**
 * A "fully populated" stats projection, mirroring the object the AngularJS
 * `BacklogController` exposed once the resource layer resolved.
 */
const FULL_STATS = {
  completedPercentage: 42,
  total_points: 100,
  defined_points: 80,
  closed_points: 20,
  speed: 12,
  milestones: MILESTONES,
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

  it("renders four .summary-stats blocks with RESOLVED description copy", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    expect(container.querySelectorAll(".summary-stats")).toHaveLength(4);

    // The four description spans, in DOM order, carry the RESOLVED translations
    // (not raw keys) — derived from the same message bundle the component uses.
    const descriptions = Array.from(
      container.querySelectorAll(".summary-stats .description"),
    ).map((el) => el.textContent);
    expect(descriptions).toEqual([
      desc("BACKLOG.SUMMARY.PROJECT_POINTS"),
      desc("BACKLOG.SUMMARY.DEFINED_POINTS"),
      desc("BACKLOG.SUMMARY.CLOSED_POINTS"),
      desc("BACKLOG.SUMMARY.POINTS_PER_SPRINT"),
    ]);

    // No raw i18n key must ever leak into the rendered DOM.
    expect(container.innerHTML).not.toContain("BACKLOG.SUMMARY.");

    // The PROJECT_POINTS block is present (only when total_points is truthy);
    // reach it by its resolved copy.
    expect(
      screen.getByText(desc("BACKLOG.SUMMARY.PROJECT_POINTS")),
    ).not.toBeNull();
  });

  it("splits a <br />-bearing description into real <br> nodes", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );
    // DEFINED_POINTS = "defined<br />points" -> the span must contain a real <br>.
    const definedDesc = Array.from(
      container.querySelectorAll(".summary-stats .description"),
    ).find((el) => el.textContent === desc("BACKLOG.SUMMARY.DEFINED_POINTS"));
    expect(definedDesc).toBeTruthy();
    expect(definedDesc!.querySelector("br")).not.toBeNull();
  });

  it("resolves the progress-bar title attributes through t()", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );
    expect(
      container.querySelector(".defined-points")!.getAttribute("title"),
    ).toBe(t("BACKLOG.EXCESS_OF_POINTS"));
    expect(
      container.querySelector(".project-points-progress")!.getAttribute("title"),
    ).toBe(t("BACKLOG.PENDING_POINTS"));
    expect(
      container.querySelector(".closed-points-progress")!.getAttribute("title"),
    ).toBe(t("BACKLOG.CLOSED_POINTS"));
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
    expect(descriptions).not.toContain(desc("BACKLOG.SUMMARY.PROJECT_POINTS"));
    expect(descriptions).toEqual([
      desc("BACKLOG.SUMMARY.DEFINED_POINTS"),
      desc("BACKLOG.SUMMARY.CLOSED_POINTS"),
      desc("BACKLOG.SUMMARY.POINTS_PER_SPRINT"),
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
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    // The clickable toggle carries the js- hook class and wraps the graph icon,
    // and its title is the RESOLVED translation.
    const toggle = container.querySelector(".js-toggle-burndown-visibility-button");
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector("svg.icon-graph")).not.toBeNull();
    expect(toggle!.getAttribute("title")).toBe(
      t("BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH"),
    );

    // The (collapsible) burndown graph container + inner `.burndown` are present.
    expect(
      container.querySelector(".graphics-container.js-burndown-graph .burndown"),
    ).not.toBeNull();
  });

  it("shows the empty-burndown call-to-action (RESOLVED copy) only for admins with a placeholder", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
    } as BacklogStats;

    // showGraphPlaceholder && isAdmin -> the "customize graph" empty state shows.
    const { container: adminContainer } = render(
      <BurndownSummary
        stats={stats}
        showGraphPlaceholder
        isAdmin
        adminModulesUrl="/project/p/admin/project-values/status"
      />,
    );
    const empty = adminContainer.querySelector(".empty-burndown");
    expect(empty).not.toBeNull();
    // Resolved title + admin link copy (no raw keys).
    expect(empty!.querySelector(".title")!.textContent).toBe(
      t("BACKLOG.CUSTOMIZE_GRAPH"),
    );
    const link = empty!.querySelector("a")!;
    expect(link.textContent).toBe(t("BACKLOG.CUSTOMIZE_GRAPH_ADMIN"));
    expect(link.getAttribute("title")).toBe(t("BACKLOG.CUSTOMIZE_GRAPH_TITLE"));
    expect(link.getAttribute("href")).toBe(
      "/project/p/admin/project-values/status",
    );
    expect(adminContainer.innerHTML).not.toContain("BACKLOG.CUSTOMIZE_GRAPH");

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
    // No milestones -> no chart, but the container is still present + empty.
    const burndown = container.querySelector(
      ".graphics-container.js-burndown-graph .burndown",
    );
    expect(burndown).not.toBeNull();
    expect(burndown!.querySelector("svg.burndown-graph")).toBeNull();
  });
});

describe("BurndownSummary — burndown graph (C6)", () => {
  it("renders a real SVG graph from stats.milestones", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    const svg = container.querySelector(
      ".graphics-container.js-burndown-graph .burndown svg.burndown-graph",
    );
    expect(svg).not.toBeNull();
    // 6:1 viewBox (legacy element.height(width/6)).
    expect(svg!.getAttribute("viewBox")).toBe("0 0 660 110");
    expect(svg!.getAttribute("role")).toBe("img");
    // The SVG MUST carry explicit inline sizing: the app theme's global
    // `svg{width:1rem;height:1rem}` rule (specificity 0,0,1) would otherwise
    // collapse this class-only chart to a 16x16 icon (the legacy burndown was a
    // Flot <canvas>, so no `svg.burndown-graph` sizing rule exists). An inline
    // style beats that bare-`svg` rule and reproduces the legacy
    // `element.height(width/6)` sizing (width:100% + 660/110 aspect-ratio).
    const styleAttr = svg!.getAttribute("style") ?? "";
    // Both levers that override the theme's bare `svg{width:1rem;height:1rem}`
    // rule are asserted here: `width:100%` fills the `.burndown` container and
    // `height:auto` lets the 660/110 (6:1) viewBox drive the intrinsic height
    // (= width/6, i.e. the legacy `element.height(width/6)`). The component ALSO
    // sets `aspect-ratio:660/110` for real browsers, but jsdom's cssstyle does
    // not serialize `aspect-ratio`, so it cannot be asserted from the style
    // string here (the live-browser sizing is verified by the E2E capture).
    expect(styleAttr).toMatch(/width:\s*100%/);
    expect(styleAttr).toMatch(/height:\s*auto/);
  });

  it("plots the optimal + evolution series with points", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    // Optimal line has one point per milestone (3); evolution skips the null
    // future-sprint entry (2 points).
    expect(
      container.querySelector("polyline.burndown-line-optimal"),
    ).not.toBeNull();
    expect(
      container.querySelector("polyline.burndown-line-evolution"),
    ).not.toBeNull();
    expect(
      container.querySelectorAll("circle.burndown-point-optimal"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll("circle.burndown-point-evolution"),
    ).toHaveLength(2);
  });

  it("labels the axes with RESOLVED translations", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );
    expect(
      container.querySelector(".burndown-xaxis-label")!.textContent,
    ).toBe(t("BACKLOG.CHART.XAXIS_LABEL"));
    expect(
      container.querySelector(".burndown-yaxis-label")!.textContent,
    ).toBe(t("BACKLOG.CHART.YAXIS_LABEL"));
  });

  it("gives each data point a RESOLVED tooltip <title> (sprint name + value)", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
    );

    const optimalTitles = Array.from(
      container.querySelectorAll("circle.burndown-point-optimal title"),
    ).map((el) => el.textContent);
    // First optimal point: sprint "Sprint 4", value 100.
    expect(optimalTitles).toContain(
      t("BACKLOG.CHART.OPTIMAL", { sprintName: "Sprint 4", value: 100 }),
    );

    const realTitles = Array.from(
      container.querySelectorAll("circle.burndown-point-evolution title"),
    ).map((el) => el.textContent);
    // Second evolution point: sprint "Sprint 5", value 60.
    expect(realTitles).toContain(
      t("BACKLOG.CHART.REAL", { sprintName: "Sprint 5", value: 60 }),
    );

    // No raw chart key leaks.
    expect(container.innerHTML).not.toContain("BACKLOG.CHART.");
  });

  it("renders no chart when there are no milestones", () => {
    const stats = {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
      milestones: [],
    } as BacklogStats;

    const { container } = render(
      <BurndownSummary stats={stats} showGraphPlaceholder={false} />,
    );
    // Container present, but no SVG (nothing to plot).
    expect(
      container.querySelector(".graphics-container.js-burndown-graph .burndown"),
    ).not.toBeNull();
    expect(container.querySelector("svg.burndown-graph")).toBeNull();
  });
});

describe("BurndownSummary — interactions", () => {
  it("toggles burndown-graph visibility when the toggle button is clicked", () => {
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
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
    const { container } = render(
      <BurndownSummary stats={FULL_STATS} showGraphPlaceholder={false} />,
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
