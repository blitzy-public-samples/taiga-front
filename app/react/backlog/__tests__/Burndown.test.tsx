/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for {@link Burndown} — the backlog summary region.
 *
 * Coverage focuses on the two pieces of real logic the component owns:
 *   - the summary progress-bar percentage math (incl. the `-3` offset, the
 *     clamp/round of `adjustPercentaje`, and the divide-by-zero guard), and
 *   - the burndown series derivation (5 series with the exact sign conventions),
 * plus the conditional gating (`total_points`, toggle, empty placeholder), the
 * collapsed/visible state classes, and the toggle click/keyboard handlers.
 */

import { render, fireEvent } from "@testing-library/react";

import { Burndown } from "../Burndown";
import type { BurndownProps } from "../Burndown";
import type { BurndownPoint, Project, ProjectStats } from "../types";

/* -------------------------------------------------------------------------- */
/* Factories                                                                  */
/* -------------------------------------------------------------------------- */

function makeStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
    return {
        total_points: 100,
        defined_points: 120,
        closed_points: 60,
        assigned_points: 0,
        speed: 0,
        total_milestones: 0,
        milestones: [],
        ...overrides,
    };
}

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: "proj",
        name: "Proj",
        my_permissions: [],
        roles: [],
        points: [],
        us_statuses: [],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 1,
        total_milestones: 0,
        i_am_admin: false,
        ...overrides,
    };
}

function makeMilestone(overrides: Partial<BurndownPoint> = {}): BurndownPoint {
    return {
        name: "Sprint",
        optimal: 0,
        evolution: 0,
        "team-increment": 0,
        "client-increment": 0,
        ...overrides,
    };
}

function renderBurndown(
    overrides: Partial<BurndownProps> = {},
): { container: HTMLElement; onToggleCollapsed: jest.Mock } {
    const onToggleCollapsed = jest.fn();
    const props: BurndownProps = {
        stats: makeStats(),
        project: makeProject(),
        showGraphPlaceholder: false,
        collapsed: true,
        onToggleCollapsed,
        ...overrides,
    };
    const { container } = render(<Burndown {...props} />);
    return { container, onToggleCollapsed };
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                  */
/* -------------------------------------------------------------------------- */

describe("Burndown — structure", () => {
    it("renders the backlog-summary wrapper with the summary + progress-bar segments", () => {
        const { container } = renderBurndown();

        expect(container.querySelector(".backlog-summary")).not.toBeNull();
        expect(container.querySelector(".summary")).not.toBeNull();
        expect(container.querySelector(".summary-progress-bar")).not.toBeNull();
        expect(container.querySelector(".defined-points")).not.toBeNull();
        expect(container.querySelector(".project-points-progress")).not.toBeNull();
        expect(container.querySelector(".closed-points-progress")).not.toBeNull();
        expect(container.querySelector(".graphics-container.js-burndown-graph")).not.toBeNull();
        expect(container.querySelector(".burndown")).not.toBeNull();
    });

    it("titles the progress-bar segments with the reproduced translate strings", () => {
        const { container } = renderBurndown();

        expect(container.querySelector(".defined-points")).toHaveAttribute("title", "Excess of points");
        expect(container.querySelector(".project-points-progress")).toHaveAttribute("title", "Pending Points");
        expect(container.querySelector(".closed-points-progress")).toHaveAttribute("title", "closed");
    });
});

/* -------------------------------------------------------------------------- */
/* Progress-bar math                                                          */
/* -------------------------------------------------------------------------- */

describe("Burndown — progress-bar width math", () => {
    function widths(stats: ProjectStats): { project: string; closed: string } {
        const { container } = renderBurndown({ stats });
        const project = container.querySelector(".project-points-progress") as HTMLElement;
        const closed = container.querySelector(".closed-points-progress") as HTMLElement;
        return { project: project.style.width, closed: closed.style.width };
    }

    it("uses the definedPoints divisor when definedPoints > totalPoints (with -3 offset + round)", () => {
        // totalPoints=100, defined=120, closed=60
        // projectPct = round(min(100,max(0, 100*100/120 - 3))) = round(80.33) = 80
        // closedPct  = round(min(100,max(0, 60*100/120 - 3)))  = round(47)    = 47
        const { project, closed } = widths(makeStats({ total_points: 100, defined_points: 120, closed_points: 60 }));
        expect(project).toBe("80%");
        expect(closed).toBe("47%");
    });

    it("caps projectPct at 100 (pre-offset) when definedPoints <= totalPoints, dividing closed by totalPoints", () => {
        // total_points null -> totalPoints falls back to defined_points=50; defined=50; closed=25
        // 50 > 50 is false -> projectPct=100 -> adjust(97)=97 ; closedPct = 25*100/50 - 3 = 47
        const { project, closed } = widths(makeStats({ total_points: null, defined_points: 50, closed_points: 25 }));
        expect(project).toBe("97%");
        expect(closed).toBe("47%");
    });

    it("guards divide-by-zero: all-zero stats never produce NaN", () => {
        const { project, closed } = widths(makeStats({ total_points: 0, defined_points: 0, closed_points: 0 }));
        // else branch: projectPct=100 -> adjust(97)=97 ; closedPct guarded to 0 -> adjust(-3)=0
        expect(project).toBe("97%");
        expect(closed).toBe("0%");
        expect(project).not.toContain("NaN");
        expect(closed).not.toContain("NaN");
    });

    it("clamps negative results to 0", () => {
        // closed_points 0 -> closedPct = 0 - 3 = -3 -> clamped to 0
        const { closed } = widths(makeStats({ total_points: 100, defined_points: 100, closed_points: 0 }));
        expect(closed).toBe("0%");
    });
});

/* -------------------------------------------------------------------------- */
/* completedPercentage                                                        */
/* -------------------------------------------------------------------------- */

describe("Burndown — completedPercentage in .data .number", () => {
    function completed(stats: ProjectStats): string {
        const { container } = renderBurndown({ stats });
        return (container.querySelector(".data .number") as HTMLElement).textContent ?? "";
    }

    it("renders the pre-computed completedPercentage when present", () => {
        expect(completed(makeStats({ completedPercentage: 42 }))).toBe("42%");
    });

    it("recomputes from closed_points / totalPoints when completedPercentage is absent", () => {
        // 100 * 25 / 100 = 25
        expect(completed(makeStats({ total_points: 100, closed_points: 25, completedPercentage: undefined }))).toBe("25%");
    });

    it("falls back to 0% when there are no points", () => {
        expect(completed(makeStats({ total_points: 0, defined_points: 0, closed_points: 0, completedPercentage: undefined }))).toBe("0%");
    });
});

/* -------------------------------------------------------------------------- */
/* Numeric formatting                                                         */
/* -------------------------------------------------------------------------- */

describe("Burndown — number formatting (| number filter)", () => {
    it("groups thousands with the en locale separator", () => {
        const { container } = renderBurndown({ stats: makeStats({ defined_points: 1234 }) });
        const numbers = Array.from(container.querySelectorAll(".summary-stats .number")).map((n) => n.textContent);
        expect(numbers).toContain("1,234");
    });

    it("renders speed with zero decimals (number:0)", () => {
        const { container } = renderBurndown({ stats: makeStats({ speed: 3.7 }) });
        const numbers = Array.from(container.querySelectorAll(".summary-stats .number")).map((n) => n.textContent);
        expect(numbers).toContain("4");
    });
});

/* -------------------------------------------------------------------------- */
/* Conditional gating                                                         */
/* -------------------------------------------------------------------------- */

describe("Burndown — total_points summary-stat gating", () => {
    it("renders the project-points stat when total_points != null", () => {
        const { container } = renderBurndown({ stats: makeStats({ total_points: 100 }) });
        const numbers = Array.from(container.querySelectorAll(".summary-stats .number")).map((n) => n.textContent);
        // total_points, defined_points, closed_points, speed -> 4 summary-stats
        expect(container.querySelectorAll(".summary-stats")).toHaveLength(4);
        expect(numbers).toContain("100");
    });

    it("omits the project-points stat when total_points is null", () => {
        const { container } = renderBurndown({ stats: makeStats({ total_points: null }) });
        // defined_points, closed_points, speed -> 3 summary-stats
        expect(container.querySelectorAll(".summary-stats")).toHaveLength(3);
    });

    it("still renders the project-points stat when total_points is 0 (!= null)", () => {
        const { container } = renderBurndown({ stats: makeStats({ total_points: 0 }) });
        expect(container.querySelectorAll(".summary-stats")).toHaveLength(4);
    });
});

describe("Burndown — toggle button gating", () => {
    it("renders the toggle when showGraphPlaceholder is false", () => {
        const { container } = renderBurndown({ showGraphPlaceholder: false });
        expect(container.querySelector(".js-toggle-burndown-visibility-button")).not.toBeNull();
    });

    it("hides the toggle when showGraphPlaceholder is true", () => {
        const { container } = renderBurndown({ showGraphPlaceholder: true });
        expect(container.querySelector(".js-toggle-burndown-visibility-button")).toBeNull();
    });

    it("renders the toggle when showGraphPlaceholder is null (unknown)", () => {
        const { container } = renderBurndown({ showGraphPlaceholder: null });
        expect(container.querySelector(".js-toggle-burndown-visibility-button")).not.toBeNull();
    });
});

describe("Burndown — empty-burndown placeholder gating", () => {
    it("renders the placeholder for admins when showGraphPlaceholder is true", () => {
        const { container } = renderBurndown({
            showGraphPlaceholder: true,
            project: makeProject({ i_am_admin: true }),
        });
        const placeholder = container.querySelector(".empty-burndown");
        expect(placeholder).not.toBeNull();
        expect(placeholder?.querySelector(".empty-text .title")?.textContent).toBe("Customize your backlog graph");
        expect(placeholder?.querySelector("a")?.textContent?.trim()).toBe("Admin");
    });

    it("hides the placeholder for non-admins even when showGraphPlaceholder is true", () => {
        const { container } = renderBurndown({
            showGraphPlaceholder: true,
            project: makeProject({ i_am_admin: false }),
        });
        expect(container.querySelector(".empty-burndown")).toBeNull();
    });

    it("hides the placeholder when showGraphPlaceholder is false", () => {
        const { container } = renderBurndown({
            showGraphPlaceholder: false,
            project: makeProject({ i_am_admin: true }),
        });
        expect(container.querySelector(".empty-burndown")).toBeNull();
    });

    it("does not crash when project is null", () => {
        const { container } = renderBurndown({ showGraphPlaceholder: true, project: null });
        expect(container.querySelector(".empty-burndown")).toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* Collapsed / visible state classes                                          */
/* -------------------------------------------------------------------------- */

describe("Burndown — collapsed / visible state classes", () => {
    it("adds shown/open to the graph and active to the toggle when not collapsed", () => {
        const { container } = renderBurndown({ collapsed: false, showGraphPlaceholder: false });
        const graph = container.querySelector(".graphics-container.js-burndown-graph") as HTMLElement;
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        expect(graph.classList.contains("shown")).toBe(true);
        expect(graph.classList.contains("open")).toBe(true);
        expect(toggle.classList.contains("active")).toBe(true);
        expect(graph.getAttribute("data-collapsed")).toBeNull();
    });

    it("omits shown/open/active and sets data-collapsed when collapsed", () => {
        const { container } = renderBurndown({ collapsed: true, showGraphPlaceholder: false });
        const graph = container.querySelector(".graphics-container.js-burndown-graph") as HTMLElement;
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        expect(graph.classList.contains("shown")).toBe(false);
        expect(graph.classList.contains("open")).toBe(false);
        expect(toggle.classList.contains("active")).toBe(false);
        expect(graph.getAttribute("data-collapsed")).toBe("true");
    });
});

/* -------------------------------------------------------------------------- */
/* Toggle interaction                                                         */
/* -------------------------------------------------------------------------- */

describe("Burndown — toggle interaction", () => {
    it("invokes onToggleCollapsed on click", () => {
        const { container, onToggleCollapsed } = renderBurndown({ showGraphPlaceholder: false });
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        fireEvent.click(toggle);
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    });

    it("invokes onToggleCollapsed on Enter and Space", () => {
        const { container, onToggleCollapsed } = renderBurndown({ showGraphPlaceholder: false });
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        fireEvent.keyDown(toggle, { key: "Enter" });
        fireEvent.keyDown(toggle, { key: " " });
        expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
    });

    it("ignores unrelated keys", () => {
        const { container, onToggleCollapsed } = renderBurndown({ showGraphPlaceholder: false });
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        fireEvent.keyDown(toggle, { key: "a" });
        expect(onToggleCollapsed).not.toHaveBeenCalled();
    });

    it("exposes an accessible button role and label", () => {
        const { container } = renderBurndown({ showGraphPlaceholder: false });
        const toggle = container.querySelector(".js-toggle-burndown-visibility-button") as HTMLElement;
        expect(toggle).toHaveAttribute("role", "button");
        expect(toggle).toHaveAttribute("aria-label", "Show/Hide burndown graph");
        expect(toggle).toHaveAttribute("tabindex", "0");
    });
});

/* -------------------------------------------------------------------------- */
/* Burndown chart series                                                      */
/* -------------------------------------------------------------------------- */

describe("Burndown — chart series rendering", () => {
    it("renders no chart/series when milestones is empty", () => {
        const { container } = renderBurndown({ stats: makeStats({ milestones: [] }) });
        expect(container.querySelector(".burndown")).not.toBeNull();
        expect(container.querySelector(".burndown-chart")).toBeNull();
        expect(container.querySelectorAll("circle")).toHaveLength(0);
    });

    it("renders no chart when stats is null", () => {
        const { container } = renderBurndown({ stats: null });
        expect(container.querySelector(".burndown")).not.toBeNull();
        expect(container.querySelector(".burndown-chart")).toBeNull();
    });

    it("renders an SVG with markers for series 1-4 when milestones are present", () => {
        const milestones: BurndownPoint[] = [
            makeMilestone({ name: "Sprint 1", optimal: 30, evolution: 30, "team-increment": 2, "client-increment": 1 }),
            makeMilestone({ name: "Sprint 2", optimal: 20, evolution: 25, "team-increment": 3, "client-increment": 0 }),
            makeMilestone({ name: "Sprint 3", optimal: 10, evolution: 15, "team-increment": 1, "client-increment": 4 }),
        ];
        const { container } = renderBurndown({ stats: makeStats({ milestones }) });

        const svg = container.querySelector(".burndown-chart");
        expect(svg).not.toBeNull();

        // optimal(3) + evolution(3) + client(3) + team(3) = 12 markers; zero line has none.
        expect(container.querySelectorAll("circle")).toHaveLength(12);

        // 3 milestones -> 3 polylines with markers + the zero-line polyline = 5 polylines total.
        expect(container.querySelectorAll("polyline")).toHaveLength(5);
    });

    it("drops null evolution points from the real (evolution) series", () => {
        const milestones: BurndownPoint[] = [
            makeMilestone({ name: "S1", optimal: 30, evolution: 30 }),
            makeMilestone({ name: "S2", optimal: 20, evolution: null }),
            makeMilestone({ name: "S3", optimal: 10, evolution: null }),
        ];
        const { container } = renderBurndown({ stats: makeStats({ milestones }) });
        // optimal(3) + evolution(1 non-null) + client(3) + team(3) = 10 markers
        expect(container.querySelectorAll("circle")).toHaveLength(10);
    });

    it("emits the Flot-style tooltip text for the optimal series", () => {
        const milestones: BurndownPoint[] = [
            makeMilestone({ name: "Sprint 1", optimal: 30, evolution: 30 }),
            makeMilestone({ name: "Sprint 2", optimal: 20, evolution: 20 }),
        ];
        const { container } = renderBurndown({ stats: makeStats({ milestones }) });
        const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
        expect(titles).toContain('Optimal pending points for sprint "Sprint 1" should be 30');
        expect(titles.some((t) => t?.startsWith('Real pending points for sprint "Sprint 1"'))).toBe(true);
    });
});
