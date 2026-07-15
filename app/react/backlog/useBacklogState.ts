/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * State hook for the React Backlog screen.
 *
 * Ported 1:1 from the AngularJS `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee`) and the sprint helpers in
 * `app/coffee/modules/backlog/sprints.coffee`. Every mutable `@scope.*` field
 * the controller owned — including the Immutable.js structures such as
 * `@scope.swimlanesList = Immutable.List()` (main.coffee:L86) — is represented
 * here as a PLAIN object and updated exclusively through `immer` `produce()`
 * (copy-on-write). There is deliberately NO `immutable` import.
 *
 * The hook is intentionally adapter-free: it owns state only. All network
 * access (loading user stories/sprints/stats, persisting drag order, patching
 * a story) lives in `BacklogApp.tsx`, which calls the typed updater callbacks
 * exposed here. The presentational children (`BacklogTable`, `SprintList`,
 * `Sprint`, ...) receive slices of `state` via props.
 *
 * KEY INVARIANT — `visibleUserStories` is a list of user-story **refs**, not
 * stories, because `backlog-row.jade` renders
 * `us in userstories | inArray:visibleUserStories:'ref'`. The velocity /
 * forecasting toggle works by narrowing that ref list, exactly as the
 * controller did (`@scope.visibleUserStories = _.map(..., (it) -> it.ref)`).
 */

import { useCallback, useMemo, useState } from "react";
import { castDraft, produce } from "immer";
import sortBy from "lodash/sortBy";
import moment from "moment";

import type {
    CustomFilter,
    Filters,
    Id,
    ProjectStats,
    SelectedFilter,
    Sprint,
    UserStory,
} from "./types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * The complete Backlog board state. Each field maps 1:1 to a `@scope.*` or
 * controller-instance field from `backlog/main.coffee` (the originating field
 * is noted inline). Everything is a plain, serialisable value so `immer` can
 * produce structurally-shared successors without the Immutable dependency.
 */
export interface BacklogState {
    /** `@scope.userstories` — the paginated backlog (milestone === null). */
    userstories: UserStory[];
    /**
     * `@scope.visibleUserStories` — the **refs** currently visible. Drives the
     * `inArray:visibleUserStories:'ref'` filter in `backlog-row.jade`.
     * Recomputed on every load and on the velocity/forecasting toggle.
     */
    visibleUserStories: number[];
    /** `@scope.sprints` — OPEN sprints (`loadSprints` → `{closed:false}`). */
    sprints: Sprint[];
    /**
     * `@scope.closedSprints` — closed sprints (`loadClosedSprints` →
     * `{closed:true}`), only populated once the user reveals them.
     */
    closedSprints: Sprint[];
    /** `@scope.sprintsById` — one sprint per id (`groupBy id`, flattened). */
    sprintsById: Record<string, Sprint>;
    /** `@scope.closedSprintsById`. */
    closedSprintsById: Record<string, Sprint>;
    /** `@scope.stats` — aggregate project statistics (or `null` until loaded). */
    stats: ProjectStats | null;
    /** Filter widget contract (`generateFilters`). */
    filters: Filters;
    customFilters: CustomFilter[];
    selectedFilters: SelectedFilter[];
    /** `ctrl.filterQ` — the free-text search string. */
    filterQ: string;
    /** `@.page` — 1-based pagination cursor (next page to load). */
    page: number;
    /** `@.disablePagination`. */
    disablePagination: boolean;
    /** `@.firstLoadComplete`. */
    firstLoadComplete: boolean;
    /** `@.loadingUserstories`. */
    loadingUserstories: boolean;
    /** `@.totalUserStories` — `Taiga-Info-Backlog-Total-Userstories` header. */
    totalUserStories: number;
    /** `@scope.totalMilestones` — `open + closed` from the milestones result. */
    totalMilestones: number | null;
    /** `@scope.totalClosedMilestones` — `result.closed`. */
    totalClosedMilestones: number | null;
    /** `@showTags`. */
    showTags: boolean;
    /** `@activeFilters`. */
    activeFilters: boolean;
    /** `@displayVelocity`. */
    displayVelocity: boolean;
    /**
     * `@scope.showGraphPlaceholder` —
     * `!(stats.total_points? && stats.total_milestones?)`. `null` until stats
     * first load.
     */
    showGraphPlaceholder: boolean | null;
    /** `@scope.currentSprint` — from {@link findCurrentSprint}. */
    currentSprint: Sprint | null;
    /** `@.forecastedStories` — from {@link calculateForecasting}. */
    forecastedStories: UserStory[];
    /** `@scope.forecastNewSprint`. */
    forecastNewSprint: boolean;
    /**
     * `@scope.first_us_in_backlog` — `userstories[0].id`; drives the `.first`
     * class on the first user story's options button.
     */
    first_us_in_backlog: number | null;
    /**
     * `@scope.noSwimlaneUserStories` —
     * `Taiga-Info-Userstories-Without-Swimlane` header.
     */
    noSwimlaneUserStories: boolean;
    /** `@.newUs` — ids of just-created stories; drives `it.new = true`. */
    newUs: number[];
    /** `@.backlogOrder` — `{ [usId]: backlog_order }`. */
    backlogOrder: Record<string, number>;
    /** `@.milestonesOrder` — retained for parity with the controller. */
    milestonesOrder: Record<string, number>;
    /**
     * Per-row checkbox selection (`us-check-{{us.ref}}`) plus the shift-range
     * anchor. Replaces the controller's ad-hoc per-row `vm.filterMode` flag
     * with an explicit controlled map keyed by ref.
     */
    selection: {
        checked: Record<string, boolean>;
        lastCheckedRef: number | null;
    };
}

/**
 * Options for {@link UseBacklogStateResult.appendUserstories}, mirroring the
 * values the controller derived from the `listUnassigned` response headers.
 */
export interface AppendUserstoriesOptions {
    /** When `true`, replace the backlog (reset pagination); else append. */
    reset: boolean;
    /** `header('x-pagination-next')` — whether another page is available. */
    hasNextPage: boolean;
    /** `header('Taiga-Info-Backlog-Total-Userstories')`. */
    totalUserStories: number;
    /** `header('Taiga-Info-Userstories-Without-Swimlane')`. */
    noSwimlane: boolean;
    /** `@.newUs` — ids to flag with `row.new = true`. */
    newUsIds: number[];
}

/**
 * Payload for {@link UseBacklogStateResult.applyMovedUserstories}: the three
 * collections reconciled by `BacklogApp`'s `moveUs` port, applied atomically.
 */
export interface MovedUserstories {
    userstories: UserStory[];
    sprints: Sprint[];
    closedSprints: Sprint[];
}

/**
 * The value returned by {@link useBacklogState}: the current `state` plus the
 * typed, memoised updater callbacks that mirror the controller mutations.
 */
export interface UseBacklogStateResult {
    state: BacklogState;
    setStats: (stats: ProjectStats | null) => void;
    setSprints: (open: Sprint[], totalOpen: number, totalClosed: number) => void;
    setClosedSprints: (closed: Sprint[], totalClosed: number) => void;
    appendUserstories: (rows: UserStory[], opts: AppendUserstoriesOptions) => void;
    setLoadingUserstories: (v: boolean) => void;
    setDisablePagination: (v: boolean) => void;
    setPage: (v: number) => void;
    setFirstLoadComplete: (v: boolean) => void;
    setFilters: (
        filters: Filters,
        custom: CustomFilter[],
        selected: SelectedFilter[],
    ) => void;
    setFilterQ: (q: string) => void;
    toggleShowTags: () => void;
    toggleActiveFilters: () => void;
    toggleVelocityForecasting: (forecasted: UserStory[]) => void;
    setForecasting: (
        forecastedStories: UserStory[],
        forecastNewSprint: boolean,
    ) => void;
    applyMovedUserstories: (next: MovedUserstories) => void;
    removeUserStory: (us: UserStory) => void;
    restoreUserstories: (prev: UserStory[]) => void;
    patchUserStory: (id: Id, changes: Partial<UserStory>) => void;
    setSelection: (ref: number, checked: boolean, shiftKey: boolean) => void;
    setNewUs: (ids: number[]) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported so they can be unit-tested without the hook wrapper)
// ---------------------------------------------------------------------------

/**
 * Port of `sprintTotalPoints` (main.coffee:L435). Sums the points of the
 * stories belonging to the sprint. The `us.milestone === sprint.id` guard is
 * carried over verbatim from the controller; it is a no-op for well-formed
 * data (a sprint's `user_stories` always carry that sprint's milestone id),
 * but it is preserved for exact behavioural parity. `|| 0` is added so an
 * unestimated story (`total_points === null`) contributes zero under strict
 * TypeScript instead of producing `NaN`.
 */
export function sprintTotalPoints(sprint: Sprint): number {
    let points = 0;
    for (const us of sprint.user_stories) {
        if (us.milestone === sprint.id) {
            points += us.total_points || 0;
        }
    }
    return points;
}

/**
 * Port of `findCurrentSprint` (main.coffee:L696). Returns the first sprint
 * whose `[estimated_start, estimated_finish]` range (inclusive) contains
 * "now". Dates are parsed with moment using the `YYYY-MM-DD` format and
 * compared as epoch milliseconds, exactly as the controller did
 * (`moment(..., 'YYYY-MM-DD').format('x')`).
 */
export function findCurrentSprint(sprints: Sprint[]): Sprint | null {
    const currentDate = Date.now();
    const found = sprints.find((sprint) => {
        const start = Number(moment(sprint.estimated_start, "YYYY-MM-DD").format("x"));
        const end = Number(moment(sprint.estimated_finish, "YYYY-MM-DD").format("x"));
        return currentDate >= start && currentDate <= end;
    });
    return found ?? null;
}

/**
 * Port of `calculateForecasting` (main.coffee:L444-L467). Walks the backlog
 * accumulating points until the running total would exceed the project's
 * velocity (`stats.speed`), then stops.
 *
 * The ordering is preserved EXACTLY: each story is pushed onto
 * `forecastedStories` BEFORE the break check, so the story that first exceeds
 * the speed is itself included — matching the CoffeeScript loop.
 *
 * `total_points` and `current_sum` are computed by the original controller;
 * only `forecastedStories` and `forecastNewSprint` influence the result, but
 * both accumulators are retained for a faithful 1:1 port.
 */
export function calculateForecasting(
    userstories: UserStory[],
    sprints: Sprint[],
    stats: ProjectStats,
): { forecastedStories: UserStory[]; forecastNewSprint: boolean } {
    const total_points = stats.total_points;
    // `total_points` is assigned but never read in the source; reference it as
    // a no-op so the parity port stays lint-clean under any future config.
    void total_points;

    let current_sum = stats.assigned_points;
    let backlog_points_sum = 0;
    let forecastNewSprint = true;
    const forecastedStories: UserStory[] = [];

    if (sprints && sprints.length) {
        backlog_points_sum = sprintTotalPoints(sprints[0]);

        // Reset to 0 because we're going to create a new sprint.
        if (stats.speed > 0 && backlog_points_sum > stats.speed) {
            backlog_points_sum = 0;
        } else {
            forecastNewSprint = false;
        }
    }

    for (const us of userstories) {
        const tp = us.total_points || 0;
        current_sum += tp;
        backlog_points_sum += tp;
        forecastedStories.push(us);

        if (stats.speed > 0 && backlog_points_sum > stats.speed) {
            break;
        }
    }

    return { forecastedStories, forecastNewSprint };
}

// ---------------------------------------------------------------------------
// Internal (non-exported) helpers
// ---------------------------------------------------------------------------

/**
 * Build a `{ [id]: sprint }` lookup. Mirrors the controller's
 * `groupBy(sprints, (x) -> x.id)` but stores the single sprint per id directly
 * (the controller's `groupBy` produced single-element arrays it then indexed).
 */
function buildById(sprints: Sprint[]): Record<string, Sprint> {
    const byId: Record<string, Sprint> = {};
    for (const sprint of sprints) {
        byId[String(sprint.id)] = sprint;
    }
    return byId;
}

/**
 * Return copies of the sprints with their `user_stories` sorted ascending by
 * `sprint_order`. Mirrors the "Fix order of USs" loop in `loadSprints` /
 * `loadClosedSprints` (`_.sortBy(sprint.user_stories, "sprint_order")`). New
 * objects are produced so the input array is never mutated.
 */
function sortSprintStories(sprints: Sprint[]): Sprint[] {
    return sprints.map((sprint) => ({
        ...sprint,
        user_stories: sortBy(sprint.user_stories, (us) => us.sprint_order),
    }));
}

/**
 * `showGraphPlaceholder` predicate shared by {@link BacklogState} and
 * `setStats`: `!(stats.total_points? && stats.total_milestones?)`.
 */
function computeShowGraphPlaceholder(stats: ProjectStats | null): boolean {
    return !(
        stats != null &&
        stats.total_points != null &&
        stats.total_milestones != null
    );
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** The default {@link BacklogState}, matching the controller constructor. */
export function createInitialState(): BacklogState {
    return {
        userstories: [],
        visibleUserStories: [],
        sprints: [],
        closedSprints: [],
        sprintsById: {},
        closedSprintsById: {},
        stats: null,
        filters: [],
        customFilters: [],
        selectedFilters: [],
        filterQ: "",
        page: 1,
        disablePagination: false,
        firstLoadComplete: false,
        loadingUserstories: false,
        totalUserStories: 0,
        totalMilestones: null,
        totalClosedMilestones: null,
        showTags: true,
        activeFilters: false,
        displayVelocity: false,
        showGraphPlaceholder: null,
        currentSprint: null,
        forecastedStories: [],
        forecastNewSprint: true,
        first_us_in_backlog: null,
        noSwimlaneUserStories: false,
        newUs: [],
        backlogOrder: {},
        milestonesOrder: {},
        selection: { checked: {}, lastCheckedRef: null },
    };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Owns the entire Backlog board state. All updaters mutate immutably through
 * `immer` `produce()` and are memoised with `useCallback` (empty deps — they
 * only use the `setState` updater form, so they never need to close over the
 * current state). The returned object is memoised so its identity is stable
 * across renders that do not change `state`.
 */
export function useBacklogState(): UseBacklogStateResult {
    const [state, setState] = useState<BacklogState>(createInitialState);

    // -- Stats -------------------------------------------------------------

    const setStats = useCallback((stats: ProjectStats | null): void => {
        setState((prev) =>
            produce(prev, (draft) => {
                draft.showGraphPlaceholder = computeShowGraphPlaceholder(stats);

                if (stats == null) {
                    draft.stats = null;
                    return;
                }

                // `total_points || defined_points` — velocity widgets fall back
                // to defined points when total is 0/undefined.
                const totalPoints = stats.total_points || stats.defined_points;
                const completedPercentage = totalPoints
                    ? Math.round((100 * stats.closed_points) / totalPoints)
                    : 0;

                draft.stats = castDraft({ ...stats, completedPercentage });
            }),
        );
    }, []);

    // -- Sprints -----------------------------------------------------------

    const setSprints = useCallback(
        (open: Sprint[], totalOpen: number, totalClosed: number): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    const sorted = sortSprintStories(open);
                    draft.sprints = castDraft(sorted);
                    draft.sprintsById = castDraft(buildById(sorted));
                    draft.totalMilestones = totalOpen + totalClosed;
                    draft.totalClosedMilestones = totalClosed;
                    draft.currentSprint = castDraft(findCurrentSprint(sorted));
                }),
            );
        },
        [],
    );

    const setClosedSprints = useCallback(
        (closed: Sprint[], totalClosed: number): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    const sorted = sortSprintStories(closed);
                    draft.closedSprints = castDraft(sorted);
                    draft.closedSprintsById = castDraft(buildById(sorted));
                    draft.totalClosedMilestones = totalClosed;
                }),
            );
        },
        [],
    );

    // -- User stories (pagination) ----------------------------------------

    const appendUserstories = useCallback(
        (rows: UserStory[], opts: AppendUserstoriesOptions): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    // Sort incoming, (replace | concat), then keep the whole
                    // list ordered by backlog_order — equivalent to the source
                    // (`existing.concat(_.sortBy(new, "backlog_order"))`) while
                    // being robust to out-of-order pages.
                    const base: UserStory[] = opts.reset ? [] : prev.userstories;
                    const merged = sortBy(
                        base.concat(rows),
                        (row) => row.backlog_order,
                    ).map((row) => ({ ...row }));

                    const newIds = new Set(opts.newUsIds);
                    const backlogOrder: Record<string, number> = {};
                    for (const it of merged) {
                        if (newIds.has(it.id)) {
                            it.new = true;
                        }
                        backlogOrder[String(it.id)] = it.backlog_order;
                    }

                    draft.userstories = castDraft(merged);
                    draft.backlogOrder = backlogOrder;
                    draft.visibleUserStories = merged.map((row) => row.ref);
                    draft.first_us_in_backlog = merged.length ? merged[0].id : null;
                    draft.loadingUserstories = false;

                    if (opts.hasNextPage) {
                        draft.disablePagination = false;
                        draft.page += 1;
                    } else {
                        draft.disablePagination = true;
                    }

                    draft.totalUserStories = opts.totalUserStories;
                    draft.noSwimlaneUserStories = opts.noSwimlane;
                }),
            );
        },
        [],
    );

    const setLoadingUserstories = useCallback((v: boolean): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.loadingUserstories = v;
        }));
    }, []);

    const setDisablePagination = useCallback((v: boolean): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.disablePagination = v;
        }));
    }, []);

    const setPage = useCallback((v: number): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.page = v;
        }));
    }, []);

    const setFirstLoadComplete = useCallback((v: boolean): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.firstLoadComplete = v;
        }));
    }, []);

    // -- Filters / search --------------------------------------------------

    const setFilters = useCallback(
        (
            filters: Filters,
            custom: CustomFilter[],
            selected: SelectedFilter[],
        ): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    draft.filters = castDraft(filters);
                    draft.customFilters = castDraft(custom);
                    draft.selectedFilters = castDraft(selected);
                }),
            );
        },
        [],
    );

    const setFilterQ = useCallback((q: string): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.filterQ = q;
        }));
    }, []);

    // -- Toggles -----------------------------------------------------------

    const toggleShowTags = useCallback((): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.showTags = !draft.showTags;
        }));
    }, []);

    const toggleActiveFilters = useCallback((): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.activeFilters = !draft.activeFilters;
        }));
    }, []);

    const toggleVelocityForecasting = useCallback(
        (forecasted: UserStory[]): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    const next = !prev.displayVelocity;
                    draft.displayVelocity = next;

                    if (!next) {
                        // Velocity OFF → every backlog story is visible again.
                        draft.visibleUserStories = prev.userstories.map(
                            (it) => it.ref,
                        );
                    } else {
                        // Velocity ON → only the forecasted stories are visible.
                        draft.visibleUserStories = forecasted.map((it) => it.ref);
                        draft.forecastedStories = castDraft(forecasted);
                    }
                }),
            );
        },
        [],
    );

    const setForecasting = useCallback(
        (forecastedStories: UserStory[], forecastNewSprint: boolean): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    draft.forecastedStories = castDraft(forecastedStories);
                    draft.forecastNewSprint = forecastNewSprint;
                }),
            );
        },
        [],
    );

    // -- Drag reconcile / mutations ---------------------------------------

    const applyMovedUserstories = useCallback((next: MovedUserstories): void => {
        setState((prev) =>
            produce(prev, (draft) => {
                const sprints = sortSprintStories(next.sprints);
                const closedSprints = sortSprintStories(next.closedSprints);

                draft.userstories = castDraft(next.userstories);
                draft.sprints = castDraft(sprints);
                draft.closedSprints = castDraft(closedSprints);
                draft.sprintsById = castDraft(buildById(sprints));
                draft.closedSprintsById = castDraft(buildById(closedSprints));

                if (!draft.displayVelocity) {
                    draft.visibleUserStories = next.userstories.map((it) => it.ref);
                }
            }),
        );
    }, []);

    const removeUserStory = useCallback((us: UserStory): void => {
        setState((prev) =>
            produce(prev, (draft) => {
                const remaining = prev.userstories.filter((u) => u.id !== us.id);
                draft.userstories = castDraft(remaining);
                draft.first_us_in_backlog = remaining.length
                    ? remaining[0].id
                    : null;
                draft.visibleUserStories = remaining.map((u) => u.ref);
            }),
        );
    }, []);

    const restoreUserstories = useCallback((prevStories: UserStory[]): void => {
        setState((prev) =>
            produce(prev, (draft) => {
                draft.userstories = castDraft(prevStories);
                draft.first_us_in_backlog = prevStories.length
                    ? prevStories[0].id
                    : null;
                draft.visibleUserStories = prevStories.map((u) => u.ref);
            }),
        );
    }, []);

    const patchUserStory = useCallback(
        (id: Id, changes: Partial<UserStory>): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    // A story can appear both in the backlog list and inside a
                    // sprint's user_stories, so patch every occurrence.
                    for (const us of draft.userstories) {
                        if (us.id === id) {
                            Object.assign(us, changes);
                        }
                    }
                    for (const sprint of draft.sprints) {
                        for (const us of sprint.user_stories) {
                            if (us.id === id) {
                                Object.assign(us, changes);
                            }
                        }
                    }
                    for (const sprint of draft.closedSprints) {
                        for (const us of sprint.user_stories) {
                            if (us.id === id) {
                                Object.assign(us, changes);
                            }
                        }
                    }
                }),
            );
        },
        [],
    );

    // -- Selection ---------------------------------------------------------

    const setSelection = useCallback(
        (ref: number, checked: boolean, shiftKey: boolean): void => {
            setState((prev) =>
                produce(prev, (draft) => {
                    const order = prev.visibleUserStories;
                    const anchor = prev.selection.lastCheckedRef;

                    if (shiftKey && anchor != null) {
                        const a = order.indexOf(anchor);
                        const b = order.indexOf(ref);

                        if (a !== -1 && b !== -1) {
                            const lo = Math.min(a, b);
                            const hi = Math.max(a, b);
                            for (let i = lo; i <= hi; i++) {
                                draft.selection.checked[String(order[i])] = checked;
                            }
                        } else {
                            draft.selection.checked[String(ref)] = checked;
                        }
                    } else {
                        draft.selection.checked[String(ref)] = checked;
                    }

                    draft.selection.lastCheckedRef = ref;
                }),
            );
        },
        [],
    );

    const setNewUs = useCallback((ids: number[]): void => {
        setState((prev) => produce(prev, (draft) => {
            draft.newUs = ids;
        }));
    }, []);

    // -- Stable result -----------------------------------------------------

    return useMemo<UseBacklogStateResult>(
        () => ({
            state,
            setStats,
            setSprints,
            setClosedSprints,
            appendUserstories,
            setLoadingUserstories,
            setDisablePagination,
            setPage,
            setFirstLoadComplete,
            setFilters,
            setFilterQ,
            toggleShowTags,
            toggleActiveFilters,
            toggleVelocityForecasting,
            setForecasting,
            applyMovedUserstories,
            removeUserStory,
            restoreUserstories,
            patchUserStory,
            setSelection,
            setNewUs,
        }),
        [
            state,
            setStats,
            setSprints,
            setClosedSprints,
            appendUserstories,
            setLoadingUserstories,
            setDisablePagination,
            setPage,
            setFirstLoadComplete,
            setFilters,
            setFilterQ,
            toggleShowTags,
            toggleActiveFilters,
            toggleVelocityForecasting,
            setForecasting,
            applyMovedUserstories,
            removeUserStory,
            restoreUserstories,
            patchUserStory,
            setSelection,
            setNewUs,
        ],
    );
}
