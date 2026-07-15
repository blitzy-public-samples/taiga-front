/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Burndown } from "../Burndown";
import type { Project, ProjectStats, BurndownPoint } from "../types";

function makeStats(partial: Partial<ProjectStats> = {}): ProjectStats {
  return {
    total_points: 100,
    defined_points: 100,
    closed_points: 50,
    assigned_points: 0,
    speed: 10,
    total_milestones: 2,
    milestones: [],
    ...partial,
  };
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 1,
    slug: "proj",
    name: "Proj",
    my_permissions: [],
    roles: [],
    points: [],
    us_statuses: [],
    is_backlog_activated: true,
    is_kanban_activated: false,
    default_us_status: 1,
    total_milestones: 2,
    i_am_admin: true,
    ...partial,
  };
}

function noop(): void {
  /* no-op */
}

describe("Burndown", () => {
  it("renders the summary with 4 summary-stats when total_points is present", () => {
    const { container } = render(
      <Burndown stats={makeStats({ total_points: 100 })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector(".backlog-summary")).not.toBeNull();
    expect(container.querySelector(".summary")).not.toBeNull();
    expect(container.querySelectorAll(".summary-stats")).toHaveLength(4);
  });

  it("omits the project-points summary-stats block when total_points is null", () => {
    const { container } = render(
      <Burndown stats={makeStats({ total_points: null })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(container.querySelectorAll(".summary-stats")).toHaveLength(3);
  });

  it("computes the summary progress-bar widths with the -3 offset and clamp", () => {
    const { container } = render(
      <Burndown stats={makeStats({ total_points: 100, defined_points: 100, closed_points: 50 })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    const projectBar = container.querySelector(".project-points-progress") as HTMLElement | null;
    const closedBar = container.querySelector(".closed-points-progress") as HTMLElement | null;
    expect(projectBar).not.toBeNull();
    expect(closedBar).not.toBeNull();
    expect(projectBar!.style.width).toBe("97%");
    expect(closedBar!.style.width).toBe("47%");
  });

  it("shows the completed percentage in .data > .number", () => {
    const { container } = render(
      <Burndown stats={makeStats({ total_points: 100, closed_points: 50 })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    const dataNumber = container.querySelector(".data .number");
    expect(dataNumber).not.toBeNull();
    expect(dataNumber!.textContent).toContain("50");
  });

  it("guards divide-by-zero so widths are never NaN/Infinity", () => {
    const { container } = render(
      <Burndown stats={makeStats({ total_points: 0, defined_points: 0, closed_points: 0 })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    const projectBar = container.querySelector(".project-points-progress") as HTMLElement;
    const closedBar = container.querySelector(".closed-points-progress") as HTMLElement;
    expect(projectBar.style.width).toMatch(/^\d+%$/);
    expect(closedBar.style.width).toMatch(/^\d+%$/);
    expect(projectBar.style.width).not.toContain("NaN");
    expect(closedBar.style.width).not.toContain("Infinity");
  });

  it("renders the toggle button only when NOT showing the placeholder and fires onToggleCollapsed", () => {
    const onToggle = jest.fn();
    const { container } = render(
      <Burndown stats={makeStats()} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={onToggle} />,
    );
    const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement | null;
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides the toggle button when showGraphPlaceholder is true", () => {
    const { container } = render(
      <Burndown stats={makeStats()} project={makeProject()} showGraphPlaceholder={true} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector(".js-toggle-burndown-visibility-button")).toBeNull();
  });

  it("renders empty-burndown only when placeholder AND admin", () => {
    const { container: adminC } = render(
      <Burndown stats={makeStats()} project={makeProject({ i_am_admin: true })} showGraphPlaceholder={true} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(adminC.querySelector(".empty-burndown")).not.toBeNull();

    const { container: nonAdminC } = render(
      <Burndown stats={makeStats()} project={makeProject({ i_am_admin: false })} showGraphPlaceholder={true} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(nonAdminC.querySelector(".empty-burndown")).toBeNull();

    const { container: shownC } = render(
      <Burndown stats={makeStats()} project={makeProject({ i_am_admin: true })} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(shownC.querySelector(".empty-burndown")).toBeNull();
  });

  it("adds an open/shown class to the graph container when not collapsed and renders an inline svg", () => {
    const milestones: BurndownPoint[] = [
      { name: "S1", optimal: 10, evolution: 8, "team-increment": 2, "client-increment": 1 },
      { name: "S2", optimal: 5, evolution: 4, "team-increment": 1, "client-increment": 0 },
    ];
    const { container } = render(
      <Burndown stats={makeStats({ milestones })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    const graph = container.querySelector(".graphics-container.js-burndown-graph") as HTMLElement | null;
    expect(graph).not.toBeNull();
    expect(graph!.classList.contains("open") || graph!.classList.contains("shown")).toBe(true);
    expect(container.querySelector(".burndown")).not.toBeNull();
    expect(container.querySelector(".burndown svg")).not.toBeNull();
  });

  it("renders without throwing when milestones is empty", () => {
    const { container } = render(
      <Burndown stats={makeStats({ milestones: [] })} project={makeProject()} showGraphPlaceholder={false} collapsed={false} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector(".burndown")).not.toBeNull();
  });

  it("renders without throwing when stats is null", () => {
    const { container } = render(
      <Burndown stats={null} project={makeProject()} showGraphPlaceholder={true} collapsed={true} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector(".backlog-summary")).not.toBeNull();
  });
});
