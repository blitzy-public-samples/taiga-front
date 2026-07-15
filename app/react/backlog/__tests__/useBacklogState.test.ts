/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for `useBacklogState` — the immer-based state hook that replaces
 * the AngularJS `BacklogController` scope state.
 *
 * Coverage focus (per the file's validation checklist):
 *  - `calculateForecasting` (exact push-before-break + speed>0 guards)
 *  - `findCurrentSprint`
 *  - `appendUserstories` (parseLoadUserstoriesResponse semantics)
 *  - `setSelection` shift-range
 *  - `patchUserStory` (backlog + sprints)
 * plus the remaining updater callbacks for regression safety.
 */

import { act, renderHook } from "@testing-library/react";

import type { ProjectStats, Sprint, UserStory } from "../types";
import {
    calculateForecasting,
    createInitialState,
    findCurrentSprint,
    sprintTotalPoints,
    useBacklogState,
} from "../useBacklogState";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type UsOverrides = Partial<UserStory> & { id: number; ref: number };

function makeUs(over: UsOverrides): UserStory {
    // `...over` supplies the required `id`/`ref` (and any overrides); the
    // literal only provides the remaining defaults so nothing is set twice.
    return {
        subject: `US ${over.ref}`,
        project: 1,
        status: 1,
        milestone: null,
        points: {},
        total_points: 0,
        backlog_order: over.id,
        sprint_order: over.id,
        assigned_to: null,
        is_blocked: false,
        is_closed: false,
        tags: null,
        epics: null,
        due_date: null,
        version: 1,
        ...over,
    };
}

function makeSprint(over: Partial<Sprint> & { id: number }): Sprint {
    return {
        name: `Sprint ${over.id}`,
        slug: `sprint-${over.id}`,
        project: 1,
        estimated_start: "2000-01-01",
        estimated_finish: "2000-12-31",
        closed: false,
        closed_points: 0,
        total_points: 0,
        user_stories: [],
        ...over,
    };
}

function makeStats(over: Partial<ProjectStats> = {}): ProjectStats {
    return {
        total_points: 100,
        defined_points: 100,
        closed_points: 0,
        assigned_points: 0,
        speed: 0,
        total_milestones: 3,
        milestones: [],
        ...over,
    };
}

// ---------------------------------------------------------------------------
// Pure helper: sprintTotalPoints
// ---------------------------------------------------------------------------

describe("sprintTotalPoints", () => {
    it("sums total_points of member stories and treats null as 0", () => {
        const sprint = makeSprint({
            id: 1,
            user_stories: [
                makeUs({ id: 10, ref: 10, milestone: 1, total_points: 5 }),
                makeUs({ id: 11, ref: 11, milestone: 1, total_points: null }),
                makeUs({ id: 12, ref: 12, milestone: 1, total_points: 3 }),
            ],
        });
        expect(sprintTotalPoints(sprint)).toBe(8);
    });

    it("ignores stories whose milestone is not the sprint id", () => {
        const sprint = makeSprint({
            id: 1,
            user_stories: [
                makeUs({ id: 10, ref: 10, milestone: 1, total_points: 5 }),
                makeUs({ id: 11, ref: 11, milestone: 2, total_points: 100 }),
            ],
        });
        expect(sprintTotalPoints(sprint)).toBe(5);
    });
});

// ---------------------------------------------------------------------------
// Pure helper: findCurrentSprint
// ---------------------------------------------------------------------------

describe("findCurrentSprint", () => {
    it("returns the first sprint whose date range contains now", () => {
        const past = makeSprint({
            id: 1,
            estimated_start: "2000-01-01",
            estimated_finish: "2000-12-31",
        });
        const current = makeSprint({
            id: 2,
            estimated_start: "2000-01-01",
            estimated_finish: "2999-12-31",
        });
        expect(findCurrentSprint([past, current])).toBe(current);
    });

    it("returns null when no sprint contains now", () => {
        const past = makeSprint({
            id: 1,
            estimated_start: "1999-01-01",
            estimated_finish: "2000-12-31",
        });
        expect(findCurrentSprint([past])).toBeNull();
    });

    it("returns null for an empty list", () => {
        expect(findCurrentSprint([])).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Pure helper: calculateForecasting (EXACT algorithm)
// ---------------------------------------------------------------------------

describe("calculateForecasting", () => {
    it("forecasts every story and keeps forecastNewSprint=true when speed is 0 and there are no sprints", () => {
        const userstories = [
            makeUs({ id: 1, ref: 1, total_points: 4 }),
            makeUs({ id: 2, ref: 2, total_points: 4 }),
            makeUs({ id: 3, ref: 3, total_points: 4 }),
        ];
        const { forecastedStories, forecastNewSprint } = calculateForecasting(
            userstories,
            [],
            makeStats({ speed: 0 }),
        );
        expect(forecastedStories).toHaveLength(3);
        expect(forecastNewSprint).toBe(true);
    });

    it("includes the story that first exceeds speed (push happens BEFORE the break) and sets forecastNewSprint=false when the first sprint fits", () => {
        const userstories = [
            makeUs({ id: 1, ref: 1, total_points: 4 }),
            makeUs({ id: 2, ref: 2, total_points: 4 }),
            makeUs({ id: 3, ref: 3, total_points: 4 }),
            makeUs({ id: 4, ref: 4, total_points: 4 }),
        ];
        // Empty sprint (0 points) fits within speed=10 → else branch → false.
        const sprints = [makeSprint({ id: 1, user_stories: [] })];
        const { forecastedStories, forecastNewSprint } = calculateForecasting(
            userstories,
            sprints,
            makeStats({ speed: 10 }),
        );
        // 4, 8, 12 → breaks on the 3rd (12 > 10) but the 3rd is still pushed.
        expect(forecastedStories.map((us) => us.id)).toEqual([1, 2, 3]);
        expect(forecastNewSprint).toBe(false);
    });

    it("keeps forecastNewSprint=true and resets the running total when the first sprint already exceeds speed", () => {
        const sprints = [
            makeSprint({
                id: 1,
                user_stories: [
                    makeUs({ id: 9, ref: 9, milestone: 1, total_points: 20 }),
                ],
            }),
        ];
        const userstories = [makeUs({ id: 1, ref: 1, total_points: 3 })];
        const { forecastedStories, forecastNewSprint } = calculateForecasting(
            userstories,
            sprints,
            makeStats({ speed: 10 }),
        );
        // sprint sum 20 > speed 10 → reset to 0, forecastNewSprint stays true;
        // backlog then accumulates 3 which never exceeds 10.
        expect(forecastedStories.map((us) => us.id)).toEqual([1]);
        expect(forecastNewSprint).toBe(true);
    });

    it("never breaks when speed is 0 even with sprints present", () => {
        const sprints = [makeSprint({ id: 1, user_stories: [] })];
        const userstories = [
            makeUs({ id: 1, ref: 1, total_points: 50 }),
            makeUs({ id: 2, ref: 2, total_points: 50 }),
        ];
        const { forecastedStories } = calculateForecasting(
            userstories,
            sprints,
            makeStats({ speed: 0 }),
        );
        expect(forecastedStories).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe("createInitialState", () => {
    it("returns the documented defaults", () => {
        const s = createInitialState();
        expect(s.userstories).toEqual([]);
        expect(s.visibleUserStories).toEqual([]);
        expect(s.page).toBe(1);
        expect(s.disablePagination).toBe(false);
        expect(s.firstLoadComplete).toBe(false);
        expect(s.loadingUserstories).toBe(false);
        expect(s.totalUserStories).toBe(0);
        expect(s.totalMilestones).toBeNull();
        expect(s.totalClosedMilestones).toBeNull();
        expect(s.showTags).toBe(true);
        expect(s.activeFilters).toBe(false);
        expect(s.displayVelocity).toBe(false);
        expect(s.showGraphPlaceholder).toBeNull();
        expect(s.currentSprint).toBeNull();
        expect(s.forecastNewSprint).toBe(true);
        expect(s.first_us_in_backlog).toBeNull();
        expect(s.noSwimlaneUserStories).toBe(false);
        expect(s.newUs).toEqual([]);
        expect(s.backlogOrder).toEqual({});
        expect(s.milestonesOrder).toEqual({});
        expect(s.selection).toEqual({ checked: {}, lastCheckedRef: null });
        expect(s.stats).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Hook: appendUserstories
// ---------------------------------------------------------------------------

describe("useBacklogState.appendUserstories", () => {
    it("resets, sorts by backlog_order, sets visible refs / first_us / pagination / headers / new flag", () => {
        const { result } = renderHook(() => useBacklogState());

        const rows = [
            makeUs({ id: 2, ref: 20, backlog_order: 2 }),
            makeUs({ id: 1, ref: 10, backlog_order: 1 }),
        ];

        act(() => {
            result.current.appendUserstories(rows, {
                reset: true,
                hasNextPage: true,
                totalUserStories: 5,
                noSwimlane: true,
                newUsIds: [1],
            });
        });

        const s = result.current.state;
        expect(s.userstories.map((us) => us.id)).toEqual([1, 2]);
        expect(s.visibleUserStories).toEqual([10, 20]);
        expect(s.first_us_in_backlog).toBe(1);
        expect(s.backlogOrder).toEqual({ "1": 1, "2": 2 });
        expect(s.page).toBe(2); // started at 1, hasNextPage → ++
        expect(s.disablePagination).toBe(false);
        expect(s.totalUserStories).toBe(5);
        expect(s.noSwimlaneUserStories).toBe(true);
        expect(s.loadingUserstories).toBe(false);
        expect(s.userstories.find((us) => us.id === 1)?.new).toBe(true);
        expect(s.userstories.find((us) => us.id === 2)?.new).toBeUndefined();
    });

    it("concatenates on a non-reset load and stops paginating when there is no next page", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.appendUserstories(
                [
                    makeUs({ id: 1, ref: 10, backlog_order: 1 }),
                    makeUs({ id: 2, ref: 20, backlog_order: 2 }),
                ],
                {
                    reset: true,
                    hasNextPage: true,
                    totalUserStories: 3,
                    noSwimlane: false,
                    newUsIds: [],
                },
            );
        });

        act(() => {
            result.current.appendUserstories(
                [makeUs({ id: 3, ref: 30, backlog_order: 3 })],
                {
                    reset: false,
                    hasNextPage: false,
                    totalUserStories: 3,
                    noSwimlane: false,
                    newUsIds: [],
                },
            );
        });

        const s = result.current.state;
        expect(s.userstories.map((us) => us.id)).toEqual([1, 2, 3]);
        expect(s.visibleUserStories).toEqual([10, 20, 30]);
        expect(s.page).toBe(2); // unchanged: no next page on the 2nd load
        expect(s.disablePagination).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Hook: setSelection (shift-range)
// ---------------------------------------------------------------------------

describe("useBacklogState.setSelection", () => {
    function seedVisible(result: { current: ReturnType<typeof useBacklogState> }) {
        act(() => {
            result.current.appendUserstories(
                [
                    makeUs({ id: 1, ref: 10, backlog_order: 1 }),
                    makeUs({ id: 2, ref: 20, backlog_order: 2 }),
                    makeUs({ id: 3, ref: 30, backlog_order: 3 }),
                    makeUs({ id: 4, ref: 40, backlog_order: 4 }),
                    makeUs({ id: 5, ref: 50, backlog_order: 5 }),
                ],
                {
                    reset: true,
                    hasNextPage: false,
                    totalUserStories: 5,
                    noSwimlane: false,
                    newUsIds: [],
                },
            );
        });
    }

    it("selects a single row without shift and records the anchor", () => {
        const { result } = renderHook(() => useBacklogState());
        seedVisible(result);

        act(() => {
            result.current.setSelection(20, true, false);
        });

        expect(result.current.state.selection.checked).toEqual({ "20": true });
        expect(result.current.state.selection.lastCheckedRef).toBe(20);
    });

    it("selects the inclusive range across visible order when shift is held", () => {
        const { result } = renderHook(() => useBacklogState());
        seedVisible(result);

        act(() => {
            result.current.setSelection(20, true, false);
        });
        act(() => {
            result.current.setSelection(40, true, true);
        });

        const checked = result.current.state.selection.checked;
        expect(checked).toEqual({ "20": true, "30": true, "40": true });
        expect(result.current.state.selection.lastCheckedRef).toBe(40);
    });

    it("selects the range regardless of click direction (anchor after target)", () => {
        const { result } = renderHook(() => useBacklogState());
        seedVisible(result);

        act(() => {
            result.current.setSelection(40, true, false);
        });
        act(() => {
            result.current.setSelection(20, true, true);
        });

        expect(result.current.state.selection.checked).toEqual({
            "20": true,
            "30": true,
            "40": true,
        });
    });

    it("falls back to a single toggle when shift is held but there is no anchor", () => {
        const { result } = renderHook(() => useBacklogState());
        seedVisible(result);

        act(() => {
            result.current.setSelection(30, true, true);
        });

        expect(result.current.state.selection.checked).toEqual({ "30": true });
        expect(result.current.state.selection.lastCheckedRef).toBe(30);
    });

    it("falls back to a single toggle when a shift target is not among the visible refs", () => {
        const { result } = renderHook(() => useBacklogState());
        seedVisible(result);

        act(() => {
            result.current.setSelection(20, true, false); // anchor = 20
        });
        act(() => {
            // 999 is not in visibleUserStories → indexOf === -1 → single toggle
            result.current.setSelection(999, true, true);
        });

        expect(result.current.state.selection.checked).toEqual({
            "20": true,
            "999": true,
        });
        expect(result.current.state.selection.lastCheckedRef).toBe(999);
    });
});

// ---------------------------------------------------------------------------
// Hook: patchUserStory
// ---------------------------------------------------------------------------

describe("useBacklogState.patchUserStory", () => {
    it("patches the matching story in the backlog AND inside every sprint's user_stories", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.appendUserstories(
                [makeUs({ id: 1, ref: 10, status: 1, total_points: 0 })],
                {
                    reset: true,
                    hasNextPage: false,
                    totalUserStories: 1,
                    noSwimlane: false,
                    newUsIds: [],
                },
            );
        });
        act(() => {
            result.current.setSprints(
                [
                    makeSprint({
                        id: 100,
                        user_stories: [
                            makeUs({ id: 1, ref: 10, milestone: 100, status: 1 }),
                        ],
                    }),
                ],
                1,
                1,
            );
        });
        act(() => {
            result.current.setClosedSprints(
                [
                    makeSprint({
                        id: 200,
                        closed: true,
                        user_stories: [
                            makeUs({ id: 1, ref: 10, milestone: 200, status: 1 }),
                        ],
                    }),
                ],
                1,
            );
        });

        act(() => {
            result.current.patchUserStory(1, { status: 9, total_points: 42 });
        });

        const s = result.current.state;
        expect(s.userstories[0].status).toBe(9);
        expect(s.userstories[0].total_points).toBe(42);
        expect(s.sprints[0].user_stories[0].status).toBe(9);
        expect(s.sprints[0].user_stories[0].total_points).toBe(42);
        expect(s.closedSprints[0].user_stories[0].status).toBe(9);
        expect(s.closedSprints[0].user_stories[0].total_points).toBe(42);
    });
});

// ---------------------------------------------------------------------------
// Hook: sprints / stats
// ---------------------------------------------------------------------------

describe("useBacklogState.setSprints / setClosedSprints", () => {
    it("sorts user_stories by sprint_order, builds sprintsById, and totals milestones", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.setSprints(
                [
                    makeSprint({
                        id: 7,
                        estimated_start: "2000-01-01",
                        estimated_finish: "2999-12-31",
                        user_stories: [
                            makeUs({ id: 3, ref: 3, sprint_order: 3 }),
                            makeUs({ id: 1, ref: 1, sprint_order: 1 }),
                            makeUs({ id: 2, ref: 2, sprint_order: 2 }),
                        ],
                    }),
                ],
                2,
                3,
            );
        });

        const s = result.current.state;
        expect(s.sprints[0].user_stories.map((us) => us.sprint_order)).toEqual([
            1, 2, 3,
        ]);
        expect(s.sprintsById["7"].id).toBe(7);
        expect(s.totalMilestones).toBe(5); // open(2) + closed(3)
        expect(s.totalClosedMilestones).toBe(3);
        expect(s.currentSprint?.id).toBe(7);
    });

    it("stores closed sprints, indexes them, and records the closed total", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.setClosedSprints(
                [
                    makeSprint({
                        id: 9,
                        closed: true,
                        user_stories: [
                            makeUs({ id: 2, ref: 2, sprint_order: 2 }),
                            makeUs({ id: 1, ref: 1, sprint_order: 1 }),
                        ],
                    }),
                ],
                4,
            );
        });

        const s = result.current.state;
        expect(s.closedSprints[0].user_stories.map((us) => us.id)).toEqual([1, 2]);
        expect(s.closedSprintsById["9"].id).toBe(9);
        expect(s.totalClosedMilestones).toBe(4);
    });
});

describe("useBacklogState.setStats", () => {
    it("computes completedPercentage and clears the graph placeholder when stats are complete", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.setStats(
                makeStats({
                    total_points: 100,
                    closed_points: 25,
                    total_milestones: 3,
                }),
            );
        });

        const s = result.current.state;
        expect(s.stats?.completedPercentage).toBe(25);
        expect(s.showGraphPlaceholder).toBe(false);
    });

    it("falls back to defined_points and yields 0% when there are no points", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.setStats(
                makeStats({ total_points: 0, defined_points: 0, closed_points: 0 }),
            );
        });

        expect(result.current.state.stats?.completedPercentage).toBe(0);
    });

    it("clears stats and shows the placeholder when passed null", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.setStats(makeStats());
        });
        act(() => {
            result.current.setStats(null);
        });

        expect(result.current.state.stats).toBeNull();
        expect(result.current.state.showGraphPlaceholder).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Hook: velocity / forecasting / moves / removals / scalar setters
// ---------------------------------------------------------------------------

describe("useBacklogState.toggleVelocityForecasting", () => {
    it("narrows visible refs to the forecast when ON and restores all backlog refs when OFF", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.appendUserstories(
                [
                    makeUs({ id: 1, ref: 10, backlog_order: 1 }),
                    makeUs({ id: 2, ref: 20, backlog_order: 2 }),
                    makeUs({ id: 3, ref: 30, backlog_order: 3 }),
                ],
                {
                    reset: true,
                    hasNextPage: false,
                    totalUserStories: 3,
                    noSwimlane: false,
                    newUsIds: [],
                },
            );
        });

        const forecast = [makeUs({ id: 2, ref: 20, backlog_order: 2 })];
        act(() => {
            result.current.toggleVelocityForecasting(forecast);
        });
        expect(result.current.state.displayVelocity).toBe(true);
        expect(result.current.state.visibleUserStories).toEqual([20]);
        expect(result.current.state.forecastedStories.map((u) => u.ref)).toEqual([
            20,
        ]);

        act(() => {
            result.current.toggleVelocityForecasting([]);
        });
        expect(result.current.state.displayVelocity).toBe(false);
        expect(result.current.state.visibleUserStories).toEqual([10, 20, 30]);
    });
});

describe("useBacklogState.applyMovedUserstories / removeUserStory / restoreUserstories", () => {
    it("atomically replaces the three collections and recomputes visible refs when velocity is off", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => {
            result.current.applyMovedUserstories({
                userstories: [
                    makeUs({ id: 2, ref: 20 }),
                    makeUs({ id: 1, ref: 10 }),
                ],
                sprints: [
                    makeSprint({
                        id: 5,
                        user_stories: [
                            makeUs({ id: 8, ref: 8, sprint_order: 2 }),
                            makeUs({ id: 7, ref: 7, sprint_order: 1 }),
                        ],
                    }),
                ],
                closedSprints: [],
            });
        });

        const s = result.current.state;
        expect(s.userstories.map((u) => u.id)).toEqual([2, 1]);
        expect(s.visibleUserStories).toEqual([20, 10]);
        expect(s.sprints[0].user_stories.map((u) => u.id)).toEqual([7, 8]);
        expect(s.sprintsById["5"].id).toBe(5);
    });

    it("optimistically removes a story and can restore a previous snapshot", () => {
        const { result } = renderHook(() => useBacklogState());

        const stories = [
            makeUs({ id: 1, ref: 10, backlog_order: 1 }),
            makeUs({ id: 2, ref: 20, backlog_order: 2 }),
        ];
        act(() => {
            result.current.appendUserstories(stories, {
                reset: true,
                hasNextPage: false,
                totalUserStories: 2,
                noSwimlane: false,
                newUsIds: [],
            });
        });

        act(() => {
            result.current.removeUserStory(stories[0]);
        });
        expect(result.current.state.userstories.map((u) => u.id)).toEqual([2]);
        expect(result.current.state.first_us_in_backlog).toBe(2);
        expect(result.current.state.visibleUserStories).toEqual([20]);

        act(() => {
            result.current.restoreUserstories(stories);
        });
        expect(result.current.state.userstories.map((u) => u.id)).toEqual([1, 2]);
        expect(result.current.state.first_us_in_backlog).toBe(1);
        expect(result.current.state.visibleUserStories).toEqual([10, 20]);
    });

    it("sets first_us_in_backlog to null when the backlog becomes empty", () => {
        const { result } = renderHook(() => useBacklogState());
        const only = makeUs({ id: 1, ref: 10 });

        act(() => {
            result.current.appendUserstories([only], {
                reset: true,
                hasNextPage: false,
                totalUserStories: 1,
                noSwimlane: false,
                newUsIds: [],
            });
        });
        act(() => {
            result.current.removeUserStory(only);
        });

        expect(result.current.state.userstories).toEqual([]);
        expect(result.current.state.first_us_in_backlog).toBeNull();
    });
});

describe("useBacklogState scalar/toggle setters", () => {
    it("flips showTags and activeFilters", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => result.current.toggleShowTags());
        expect(result.current.state.showTags).toBe(false);

        act(() => result.current.toggleActiveFilters());
        expect(result.current.state.activeFilters).toBe(true);
    });

    it("applies the simple pagination/loading/page/first-load setters", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() => result.current.setLoadingUserstories(true));
        act(() => result.current.setDisablePagination(true));
        act(() => result.current.setPage(4));
        act(() => result.current.setFirstLoadComplete(true));

        const s = result.current.state;
        expect(s.loadingUserstories).toBe(true);
        expect(s.disablePagination).toBe(true);
        expect(s.page).toBe(4);
        expect(s.firstLoadComplete).toBe(true);
    });

    it("stores filters, search text, forecasting and new-us ids", () => {
        const { result } = renderHook(() => useBacklogState());

        act(() =>
            result.current.setFilters(
                [{ title: "Status", dataType: "status", content: [] }],
                [{ id: 1, name: "mine" }],
                [{ id: 2, name: "open", dataType: "status" }],
            ),
        );
        act(() => result.current.setFilterQ("login"));
        act(() =>
            result.current.setForecasting(
                [makeUs({ id: 1, ref: 10 })],
                false,
            ),
        );
        act(() => result.current.setNewUs([11, 12]));

        const s = result.current.state;
        expect(s.filters).toHaveLength(1);
        expect(s.customFilters[0].name).toBe("mine");
        expect(s.selectedFilters[0].name).toBe("open");
        expect(s.filterQ).toBe("login");
        expect(s.forecastedStories.map((u) => u.id)).toEqual([1]);
        expect(s.forecastNewSprint).toBe(false);
        expect(s.newUs).toEqual([11, 12]);
    });
});
