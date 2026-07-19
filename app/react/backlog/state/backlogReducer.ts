/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * backlogReducer.ts — PURE, immer-driven state reducer for the migrated React
 * Backlog / Sprint-planning screen.
 *
 * WHAT THIS REPLACES
 *   The AngularJS `BacklogController` (`app/coffee/modules/backlog/main.coffee`,
 *   class L25-715, plus `sprints.coffee`) held its board state on an Angular
 *   `$scope` backed by Immutable.js structures. This module reproduces the same
 *   state shape and the same state transitions with plain TypeScript objects and
 *   the `immer` `produce` helper — Immutable.js is replaced React-internally ONLY.
 *
 * PURITY CONTRACT (hard requirement — see the file's agent spec)
 *   - This is a PURE state module. It performs NO side effects at import time and
 *     inside the reducer: no React, no DOM/`window`/`document`, no `fetch`, no
 *     `localStorage`, no timers, no `Date`/`moment`. It must run unchanged in a
 *     bare Node/jsdom Jest environment.
 *   - The ONLY runtime import is `immer`'s `produce`. Everything else is a
 *     type-only import of the shared domain types.
 *   - The reducer performs ONLY the OPTIMISTIC in-memory move and the
 *     server-result reconciliation. The pending-drag QUEUE, the
 *     `bulkUpdateBacklogOrder` API call, the `!events.connected` fallback reloads
 *     and the moment/`Date` based `findCurrentSprint` computation all live in the
 *     `useBacklog.ts` hook, NOT here.
 *
 * IMMER-SAFETY CONTRACT (critical)
 *   Objects arriving inside an action (e.g. `usList`, `sprints`) originate either
 *   from the CURRENT already-produced state (which immer auto-FREEZES) or from
 *   freshly-fetched data. Mutating a frozen object throws
 *   `TypeError: Cannot assign to read only property`. Therefore this module NEVER
 *   mutates an action's input objects in place: it shallow-CLONES (`{ ...obj }`)
 *   any object before inserting it into a draft array, and only mutates the
 *   `draft` (whose nested objects immer drafts copy-on-write on access) or the
 *   fresh clones it just created.
 *
 * Behavioural parity is byte-for-byte with the AngularJS controller — zero
 * feature change (AAP §0.1.1, §0.7.1). Source line references are cited inline.
 */

import { produce } from 'immer';

import type {
    FiltersData,
    Milestone,
    Project,
    Swimlane,
    UserStory,
} from '../../shared/types';

/* ========================================================================== *
 * Phase 1 — Types
 * ========================================================================== */

/**
 * Project statistics payload (`GET /projects/{id}/stats`) plus the two derived
 * view fields the AngularJS controller stored alongside it
 * (`loadProjectStats`, main.coffee L256-268).
 *
 * `completedPercentage` and `showGraphPlaceholder` are COMPUTED BY THE HOOK
 * (they need only arithmetic over the payload) and then handed to the reducer
 * via `setStats`, matching how the controller wrote them onto `@scope.stats`.
 * The index signature tolerates every additional key the backend returns.
 */
export interface BacklogStats {
    /** round(100 * closed_points / (total_points || defined_points)); hook-computed. */
    completedPercentage: number;
    /** !(total_points && total_milestones); hook-computed. */
    showGraphPlaceholder: boolean;
    /** Team velocity used by the forecasting loop. */
    speed: number;
    total_points?: number;
    defined_points?: number;
    closed_points?: number;
    assigned_points?: number;
    total_milestones?: number;
    /** Forward-compatible catch-all for the remaining stats keys. */
    [key: string]: unknown;
}

/**
 * The full Backlog board state — a plain-TypeScript mirror of the AngularJS
 * controller scope (init at main.coffee L52-94, load-time fields throughout).
 * Every Immutable.js structure is modelled as a plain array / record.
 */
export interface BacklogState {
    project: Project | null;
    /** project.is_backlog_activated (loadProject L472); false => empty state. */
    isBacklogActivated: boolean;
    /** Backlog (unassigned) stories, sorted ascending by `backlog_order`. */
    userstories: UserStory[];
    /** OPEN sprints; each `user_stories` sorted ascending by `sprint_order`. */
    sprints: Milestone[];
    /** CLOSED sprints (lazily loaded); each `user_stories` sprint-order sorted. */
    closedSprints: Milestone[];
    /** keyBy id => single Milestone (source consumes `sprintsById[id]`, L528). */
    sprintsById: Record<number, Milestone>;
    /** keyBy id => single closed Milestone (source `closedSprintsById[id]`, L531). */
    closedSprintsById: Record<number, Milestone>;
    stats: BacklogStats | null;
    filtersData: FiltersData | null;
    /** Whitelisted (validQueryParams) filter key => backend URL query string. */
    selectedFilters: Record<string, string>;
    /** Hook-computed via moment date-range (findCurrentSprint L696-703). */
    currentSprint: Milestone | null;
    /** Open + closed milestone count (source L314). */
    totalMilestones: number;
    totalClosedMilestones: number;
    /** Pagination cursor (init 1). */
    page: number;
    /** Pagination lock (init false). */
    disablePagination: boolean;
    /** From header `Taiga-Info-Backlog-Total-Userstories`. */
    totalUserStories: number;
    /** From header `Taiga-Info-Userstories-Without-Swimlane` (init false). */
    noSwimlaneUserStories: boolean;
    /** Refs (`us.ref`) currently visible — drives filtering / velocity view. */
    visibleUserStories: number[];
    /** Velocity forecasting toggle (init false). */
    displayVelocity: boolean;
    /** Stories included by `calculateForecasting`. */
    forecastedStories: UserStory[];
    /** Whether forecasting predicts a brand-new sprint. */
    forecastNewSprint: boolean;
    /** Tag visibility (init true). */
    showTags: boolean;
    /** Sidebar custom-filters open state (init false). */
    activeFilters: boolean;
    /** Immutable.List => plain array (loadSwimlanes L298-302), deduped by id. */
    swimlanesList: Swimlane[];
    /** usId => backlog_order (main.coffee L386). */
    backlogOrder: Record<number, number>;
    /** sprintId => (usId => sprint_order) (setMilestonesOrder L270-274). */
    milestonesOrder: Record<number, Record<number, number>>;
    /**
     * Ids of newly-created stories to highlight. The AngularJS source maps the
     * created elements to their ids (`@.newUs = _.map els, (it) -> it.id`,
     * main.coffee L159-160) and later tests membership by id
     * (`@.newUs.includes(it.id)`, L383) — hence `number[]`, NOT `UserStory[]`.
     */
    newUs: number[];
    /** `userstories[0].id` (resetFirstStoryIndicator L507-509). */
    firstUsInBacklog?: number;
    /** Overall initial-load flag (init true). */
    loading: boolean;
    /**
     * F-AAP-10: whether the LAST full/initial load (or a live refresh) FAILED.
     * This is deliberately DISTINCT from "loaded but empty": the AngularJS
     * source never conflated the two, but the first React cut swallowed load
     * errors in the effect `catch` and merely cleared `loading`, so a failed
     * initial load rendered IDENTICALLY to a legitimately empty backlog (a
     * "successful empty screen"). With this flag the container can render a
     * genuine error state (with a retry affordance) instead of the empty-backlog
     * CTA. Set `true` when a load/refresh rejects; cleared at the start of every
     * (re)load attempt and on a successful load. Init `false`.
     */
    loadError: boolean;
    /** Pagination in-flight flag (source `loadingUserstories`; init false). */
    loadingUserstories: boolean;
    /**
     * The most recent DRAG/REORDER write error, or `null` when the last reorder
     * succeeded (or none has run). F-AAP-03: a rejected `bulkUpdateBacklogOrder`
     * must be SURFACED rather than silently swallowed, so the UI can tell the
     * user the move did not persist and the board is being reconciled. Set by
     * the hook's queue processor on a failed write; cleared on the next
     * optimistic move and on a successful server reconcile.
     */
    moveError: string | null;
}

/* ========================================================================== *
 * Phase 2 — initialBacklogState (reproduces the constructor defaults, L52-94)
 * ========================================================================== */

export const initialBacklogState: BacklogState = {
    project: null,
    isBacklogActivated: true,
    userstories: [],
    sprints: [],
    closedSprints: [],
    sprintsById: {},
    closedSprintsById: {},
    stats: null,
    filtersData: null,
    selectedFilters: {},
    currentSprint: null,
    totalMilestones: 0,
    totalClosedMilestones: 0,
    page: 1,
    disablePagination: false,
    totalUserStories: 0,
    noSwimlaneUserStories: false,
    visibleUserStories: [],
    displayVelocity: false,
    forecastedStories: [],
    forecastNewSprint: true,
    showTags: true,
    activeFilters: false,
    swimlanesList: [],
    backlogOrder: {},
    milestonesOrder: {},
    newUs: [],
    firstUsInBacklog: undefined,
    loading: true,
    loadError: false,
    loadingUserstories: false,
    moveError: null,
};

/* ========================================================================== *
 * Phase 3 — Pure helpers (module scope)
 *
 * Helpers that receive a `BacklogState` are always called with immer's draft at
 * runtime; because every domain type here is fully mutable (no `readonly`
 * fields), immer's `Draft<BacklogState>` is structurally identical to
 * `BacklogState`, so the plain annotation both type-checks AND lets immer track
 * the in-place mutations on the real draft proxy.
 * ========================================================================== */

/** Type-guard narrowing an optional ref (`number | undefined`) to `number`. */
const isRef = (r: number | undefined): r is number => typeof r === 'number';

/**
 * Return a NEW array sorted ascending by `backlog_order`, mirroring
 * `_.sortBy(userstories, "backlog_order")` (main.coffee L377). Missing orders
 * are treated as 0 so ordering is total and deterministic under strict TS.
 */
function sortByBacklogOrder(list: UserStory[]): UserStory[] {
    return [...list].sort((a, b) => (a.backlog_order ?? 0) - (b.backlog_order ?? 0));
}

/**
 * Return a NEW array sorted ascending by `sprint_order`, mirroring
 * `_.sortBy(sprint.user_stories, "sprint_order")` (main.coffee L318, L292).
 */
function sortBySprintOrder(list: UserStory[]): UserStory[] {
    return [...list].sort((a, b) => (a.sprint_order ?? 0) - (b.sprint_order ?? 0));
}

/**
 * keyBy id => single item. Mirrors the source `groupBy(sprints, (x) -> x.id)`
 * which — despite the name — is consumed as a single-object lookup
 * (`sprintsById[id]`, main.coffee L528/L531). Exported for direct unit testing.
 */
export function keyById<T extends { id: number }>(items: T[]): Record<number, T> {
    return items.reduce<Record<number, T>>((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});
}

/**
 * Rebuild `milestonesOrder` for the given sprints, reproducing
 * `setMilestonesOrder` (main.coffee L270-274): sprintId => (usId => sprint_order).
 * `sprint_order` is `number | undefined` in the shared type; stories that live in
 * a sprint always carry an order, so the `?? 0` guard is behaviour-preserving
 * when the value is present and keeps the map strictly `number`-valued.
 */
function setMilestonesOrderInto(draft: BacklogState, sprints: Milestone[]): void {
    for (const sprint of sprints) {
        draft.milestonesOrder[sprint.id] = {};
        for (const us of sprint.user_stories) {
            draft.milestonesOrder[sprint.id][us.id] = us.sprint_order ?? 0;
        }
    }
}

/**
 * Recompute the derived backlog fields exactly as `parseLoadUserstoriesResponse`
 * does (main.coffee L378-386):
 *   - `visibleUserStories` = the ordered list of refs,
 *   - `firstUsInBacklog`   = the first story id (resetFirstStoryIndicator L507-509),
 *   - `backlogOrder[id]`   = each story's `backlog_order`,
 *   - mark stories whose id is in `newUs` with a `new` flag (source `it.new = true`,
 *     L384). The bracket write side-steps the reserved word `new`; the shared
 *     `UserStory` type carries an index signature so it type-checks.
 * Iterating `draft.userstories` yields immer drafts, so the `new` marker is set
 * copy-on-write and never mutates a frozen input object.
 */
function recomputeBacklogDerived(draft: BacklogState): void {
    draft.visibleUserStories = draft.userstories.map((u) => u.ref).filter(isRef);
    draft.firstUsInBacklog = draft.userstories.length ? draft.userstories[0].id : undefined;

    for (const us of draft.userstories) {
        if (us.backlog_order != null) {
            draft.backlogOrder[us.id] = us.backlog_order;
        }
        if (draft.newUs.includes(us.id)) {
            (us as { [key: string]: unknown })['new'] = true;
        }
    }
}

/**
 * Sum the `total_points` of the stories that belong to the sprint, reproducing
 * `sprintTotalPoints` (main.coffee L435-442). `total_points` is nullable in the
 * shared type, so missing values count as 0 (behaviour-preserving when present).
 */
function sprintTotalPoints(sprint: Milestone): number {
    let points = 0;
    for (const us of sprint.user_stories) {
        if (us.milestone === sprint.id) {
            points += us.total_points ?? 0;
        }
    }
    return points;
}

/**
 * Recompute the velocity forecast in place, reproducing `calculateForecasting`
 * EXACTLY (main.coffee L444-467). The `?? 0` guards defend against
 * null/undefined under strict TS and are behaviour-preserving whenever the
 * backend supplies the numbers (which the AngularJS code assumed present).
 */
function calculateForecastingInto(draft: BacklogState): void {
    const stats = draft.stats;

    // Source calls this only after stats have loaded; guard for purity/strictness.
    if (!stats) {
        draft.forecastedStories = [];
        draft.forecastNewSprint = true;
        return;
    }

    // L446: assigned in the source but never subsequently read — retained here
    // purely for fidelity to the original routine.
    const total_points = stats.total_points;
    void total_points;

    let current_sum = stats.assigned_points ?? 0;
    let backlog_points_sum = 0;
    draft.forecastedStories = [];
    draft.forecastNewSprint = true;

    if (draft.sprints && draft.sprints.length) {
        backlog_points_sum = sprintTotalPoints(draft.sprints[0]);

        // Set 0 because we're going to create a new sprint (source L455-459).
        if ((stats.speed ?? 0) > 0 && backlog_points_sum > (stats.speed ?? 0)) {
            backlog_points_sum = 0;
        } else {
            draft.forecastNewSprint = false;
        }
    }

    for (const us of draft.userstories) {
        current_sum += us.total_points ?? 0;
        backlog_points_sum += us.total_points ?? 0;
        draft.forecastedStories.push(us);

        if ((stats.speed ?? 0) > 0 && backlog_points_sum > (stats.speed ?? 0)) {
            break;
        }
    }
}

/* ========================================================================== *
 * Phase 4 — BacklogAction (discriminated union)
 *
 * `useBacklog.ts` owns all effects/thunks and dispatches these plain actions.
 * The reducer is a pure function of (state, action). Actions carry either fresh
 * backend data or values already computed by the hook (e.g. `currentSprint`,
 * the stats view fields) — the reducer performs no I/O and no derivation that
 * requires the DOM, `Date`, or `moment`.
 * ========================================================================== */

export type BacklogAction =
    /** Toggle the overall initial-load flag. */
    | { type: 'setLoading'; loading: boolean }
    /** F-AAP-10: set/clear the initial-or-refresh load-failure flag. */
    | { type: 'setLoadError'; error: boolean }
    /**
     * F-CQ-05: set/clear the pagination in-flight flag. The hook sets this
     * `true` when a "load more" page fetch starts; the `setUserstories` /
     * `appendUserstories` cases reset it to `false` when a batch lands, and the
     * hook's `loadMore` `catch` resets it on failure. Nothing set this flag
     * `true` before (it was write-only-`false`), so the load-more spinner and
     * the in-flight guard were dead.
     */
    | { type: 'setLoadingUserstories'; loading: boolean }
    /** Store the loaded project + derive `isBacklogActivated` + seed swimlanes. */
    | { type: 'setProject'; project: Project }
    /** REPLACE the backlog list (resetPagination): sort + full derived recompute. */
    | { type: 'setUserstories'; userstories: UserStory[] }
    /** APPEND a paginated batch: concat sorted batch + full derived recompute. */
    | { type: 'appendUserstories'; userstories: UserStory[] }
    /** Apply any subset of pagination fields computed by the hook from headers. */
    | {
          type: 'setPagination';
          page?: number;
          disablePagination?: boolean;
          totalUserStories?: number;
          noSwimlaneUserStories?: boolean;
      }
    /** Store OPEN sprints (+ open/closed counts) — reproduces loadSprints. */
    | { type: 'setSprints'; sprints: Milestone[]; open: number; closed: number }
    /** Store CLOSED sprints (+ closed count) — reproduces loadClosedSprints. */
    | { type: 'setClosedSprints'; sprints: Milestone[]; closed: number }
    /** Store project stats and recompute the velocity forecast. */
    | { type: 'setStats'; stats: BacklogStats }
    /** Store the `/userstories/filters_data` payload. */
    | { type: 'setFiltersData'; filtersData: FiltersData }
    /** Store the whitelisted selected-filters map. */
    | { type: 'setSelectedFilters'; filters: Record<string, string> }
    /** Store the hook-computed current sprint (moment date-range). */
    | { type: 'setCurrentSprint'; sprint: Milestone | null }
    /** Merge additional swimlanes, deduped by id. */
    | { type: 'setSwimlanes'; swimlanes: Swimlane[] }
    /** Set (or flip) tag visibility. */
    | { type: 'toggleTags'; showTags?: boolean }
    /** Set (or flip) the sidebar custom-filters open state. */
    | { type: 'toggleActiveFilters'; activeFilters?: boolean }
    /** Set (or flip) velocity forecasting + recompute the visible refs. */
    | { type: 'toggleVelocity'; displayVelocity?: boolean }
    /** Force a forecast recompute. */
    | { type: 'setForecasting' }
    /** Optimistically insert created stories at the top/bottom + highlight them. */
    | { type: 'addUsOptimistic'; userstories: UserStory[]; position: 'top' | 'bottom' }
    /** Optimistically remove a story from the backlog list (deleteUserStory). */
    | { type: 'removeUsOptimistic'; usId: number }
    /**
     * Optimistically replace a single story in place by id (F-CQ-03 inline
     * status / points edit). Preserves list position; recomputes derived state.
     */
    | { type: 'replaceUs'; us: UserStory }
    /** OPTIMISTIC drag move (backlog <-> sprint <-> sprint / reorder). */
    | {
          type: 'moveUs';
          usList: UserStory[];
          newUsIndex: number;
          newSprintId: number | null;
          previousUs: number | null;
          nextUs: number | null;
      }
    /** Apply the server-returned `milestone` / `backlog_order` rows after a move. */
    | {
          type: 'reconcileMoveResult';
          updatedRows: Array<{ id: number; milestone: number | null; backlog_order?: number }>;
      }
    | { type: 'setMoveError'; message: string | null };

/* ========================================================================== *
 * Phase 5-7 — backlogReducer
 *
 * The entire switch runs inside a single `produce` call, so every `case` mutates
 * the `draft` and immer returns the next immutable (frozen) state — or the SAME
 * reference for a no-op action.
 * ========================================================================== */

export function backlogReducer(state: BacklogState, action: BacklogAction): BacklogState {
    return produce(state, (draft) => {
        switch (action.type) {
            case 'setLoading': {
                draft.loading = action.loading;
                break;
            }

            case 'setLoadError': {
                // F-AAP-10: surface a failed load instead of swallowing it.
                draft.loadError = action.error;
                break;
            }

            case 'setLoadingUserstories': {
                // F-CQ-05: the load-more page fetch is in flight.
                draft.loadingUserstories = action.loading;
                break;
            }

            case 'setProject': {
                draft.project = action.project;
                // loadProject L472: the backlog is disabled unless the project
                // explicitly enables it. The field is not modelled on `Project`,
                // so read it through a narrow structural cast.
                draft.isBacklogActivated = !!(action.project as { is_backlog_activated?: boolean })
                    .is_backlog_activated;

                // loadSwimlanes L298-302: seed swimlanesList from the project,
                // deduped by id (add only swimlanes not already present).
                const withSwimlanes = action.project as { swimlanes?: Swimlane[] };
                if (Array.isArray(withSwimlanes.swimlanes)) {
                    for (const swimlane of withSwimlanes.swimlanes) {
                        if (!draft.swimlanesList.some((s) => s.id === swimlane.id)) {
                            // Clone before inserting into the draft (immer-safety).
                            draft.swimlanesList.push({ ...swimlane });
                        }
                    }
                }
                break;
            }

            case 'setUserstories': {
                // resetPagination path: `@scope.userstories = []` then concat the
                // sorted batch (main.coffee L366 + L377).
                draft.userstories = sortByBacklogOrder(action.userstories);
                recomputeBacklogDerived(draft);
                draft.loadingUserstories = false;
                break;
            }

            case 'appendUserstories': {
                // Pagination path: concat the sorted batch after the existing list
                // (`@scope.userstories.concat(_.sortBy(userstories, "backlog_order"))`, L377).
                draft.userstories = draft.userstories.concat(sortByBacklogOrder(action.userstories));
                recomputeBacklogDerived(draft);
                draft.loadingUserstories = false;
                break;
            }

            case 'setPagination': {
                // Hook computes these from the response headers `x-pagination-next`,
                // `Taiga-Info-Backlog-Total-Userstories`,
                // `Taiga-Info-Userstories-Without-Swimlane` (main.coffee L390-398).
                if (action.page !== undefined) {
                    draft.page = action.page;
                }
                if (action.disablePagination !== undefined) {
                    draft.disablePagination = action.disablePagination;
                }
                if (action.totalUserStories !== undefined) {
                    draft.totalUserStories = action.totalUserStories;
                }
                if (action.noSwimlaneUserStories !== undefined) {
                    draft.noSwimlaneUserStories = action.noSwimlaneUserStories;
                }
                break;
            }

            case 'setSprints': {
                // loadSprints L304-330 (minus currentSprint, which arrives via
                // `setCurrentSprint`). Clone each sprint and sort its stories so we
                // never mutate a frozen/input sprint object (immer-safety).
                const sprints = action.sprints.map((s) => ({
                    ...s,
                    user_stories: sortBySprintOrder(s.user_stories ?? []),
                }));
                draft.sprints = sprints;
                draft.sprintsById = keyById(sprints);
                setMilestonesOrderInto(draft, sprints);
                draft.totalClosedMilestones = action.closed;
                draft.totalMilestones = action.open + action.closed;
                if (!draft.closedSprints) {
                    draft.closedSprints = [];
                }
                break;
            }

            case 'setClosedSprints': {
                // loadClosedSprints L281-296. Same clone + sort as setSprints.
                const sprints = action.sprints.map((s) => ({
                    ...s,
                    user_stories: sortBySprintOrder(s.user_stories ?? []),
                }));
                draft.closedSprints = sprints;
                draft.closedSprintsById = keyById(sprints);
                setMilestonesOrderInto(draft, sprints);
                draft.totalClosedMilestones = action.closed;
                break;
            }

            case 'setStats': {
                // loadProjectStats calls calculateForecasting (main.coffee L267).
                draft.stats = action.stats;
                calculateForecastingInto(draft);
                break;
            }

            case 'setFiltersData': {
                draft.filtersData = action.filtersData;
                break;
            }

            case 'setSelectedFilters': {
                draft.selectedFilters = action.filters;
                break;
            }

            case 'setCurrentSprint': {
                // Hook computes it via moment/`Date` (findCurrentSprint L696-703).
                draft.currentSprint = action.sprint;
                break;
            }

            case 'setSwimlanes': {
                // loadSwimlanes L298-302: dedupe by id, add only new ones.
                for (const swimlane of action.swimlanes) {
                    if (!draft.swimlanesList.some((s) => s.id === swimlane.id)) {
                        draft.swimlanesList.push({ ...swimlane });
                    }
                }
                break;
            }

            case 'toggleTags': {
                // The reducer owns ONLY the in-memory flag flip. F-CQ-09: the
                // project-scoped PERSISTENCE (`storeShowTags`) and REHYDRATION
                // (`getShowTags`) genuinely live in the hook (`useBacklog`) — it
                // writes `localStorage` whenever `toggleTags` is dispatched and
                // reads it back on mount per `projectId`, reproducing the
                // AngularJS `rs.userstories.storeShowTags` / `getShowTags`
                // behaviour (`main.coffee:236-239,501-502`,
                // `resources/userstories.coffee:169-177`). This comment previously
                // claimed the hook persisted but the hook did NOT — that
                // ownership mismatch is now resolved by making the claim TRUE.
                draft.showTags =
                    action.showTags !== undefined ? action.showTags : !draft.showTags;
                break;
            }

            case 'toggleActiveFilters': {
                // toggleActiveFilters L241-242.
                draft.activeFilters =
                    action.activeFilters !== undefined ? action.activeFilters : !draft.activeFilters;
                break;
            }

            case 'toggleVelocity': {
                // toggleVelocityForecasting L244-252.
                draft.displayVelocity =
                    action.displayVelocity !== undefined
                        ? action.displayVelocity
                        : !draft.displayVelocity;

                if (!draft.displayVelocity) {
                    draft.visibleUserStories = draft.userstories.map((u) => u.ref).filter(isRef);
                } else {
                    calculateForecastingInto(draft);
                    draft.visibleUserStories = draft.forecastedStories
                        .map((u) => u.ref)
                        .filter(isRef);
                }
                break;
            }

            case 'setForecasting': {
                calculateForecastingInto(draft);
                break;
            }

            case 'addUsOptimistic': {
                // "New US -> highlight" behaviour (main.coffee L158-166): the created
                // stories are inserted at the top/bottom and flagged `new`. Clone
                // each so we never mutate a frozen/input object (immer-safety).
                const clones = action.userstories.map((u) => ({ ...u }));
                const ids = clones.map((c) => c.id);
                clones.forEach((c) => {
                    (c as { [key: string]: unknown })['new'] = true;
                });

                if (action.position === 'top') {
                    draft.userstories.unshift(...clones);
                } else {
                    draft.userstories.push(...clones);
                }

                draft.newUs = draft.newUs.concat(ids);
                recomputeBacklogDerived(draft);
                break;
            }

            case 'removeUsOptimistic': {
                // deleteUserStory optimistic removal (main.coffee L669:
                // `@scope.userstories = _.without(@scope.userstories, us)`). Only the
                // backlog list is touched, matching the source.
                const index = draft.userstories.findIndex((u) => u.id === action.usId);
                if (index > -1) {
                    draft.userstories.splice(index, 1);
                }
                recomputeBacklogDerived(draft);
                break;
            }

            case 'replaceUs': {
                // F-CQ-03 inline single-story edit (status / points). Replace the
                // story in place by id, preserving its list position, then
                // recompute derived state so the row re-renders with the new
                // status colour / points value. Mirrors the AngularJS in-scope
                // model mutation (`us.status = ...` / `us.points = ...`) that
                // preceded `@repo.save(us)`; the hook owns the persistence.
                const index = draft.userstories.findIndex((u) => u.id === action.us.id);
                if (index > -1) {
                    draft.userstories[index] = action.us;
                    recomputeBacklogDerived(draft);
                }
                break;
            }

            case 'moveUs': {
                // -----------------------------------------------------------------
                // Phase 6 — OPTIMISTIC in-memory move ONLY (reproduces the `if ctx`
                // branch of main.coffee moveUs, L523-599). The pending-drag QUEUE,
                // the `bulkUpdateBacklogOrder` API call and the `!events.connected`
                // fallback reloads are the hook's responsibility, NOT the reducer's.
                // -----------------------------------------------------------------
                const { usList, newUsIndex, newSprintId, previousUs, nextUs } = action;
                if (usList.length === 0) {
                    break;
                }

                // F-AAP-03: a fresh drag starts optimistically clean — clear any
                // stale reorder error so it does not linger over a new move.
                draft.moveError = null;

                // oldSprintId = usList[0].milestone (L524). A backlog story => null.
                const oldSprintId: number | null = usList[0].milestone ?? null;

                // Clone the moving stories so we NEVER mutate a frozen/input object
                // (immer freezes produced state). We only ever insert / mutate these
                // clones; the originals in `usList` are read-only here.
                const clonesById: Record<number, UserStory> = {};
                usList.forEach((u) => {
                    clonesById[u.id] = { ...u };
                });
                const movingIds = usList.map((u) => u.id);

                // sprint / newSprint lookups across OPEN then CLOSED sprints
                // (source `sprintsById[id] || closedSprintsById[id]`, L528/L531).
                const findSprintDraft = (id: number | null): Milestone | undefined =>
                    id == null
                        ? undefined
                        : draft.sprints.find((s) => s.id === id) ||
                          draft.closedSprints.find((s) => s.id === id);

                const oldSprint = findSprintDraft(oldSprintId);
                const newSprint = findSprintDraft(newSprintId);

                const removeIdsFrom = (list: UserStory[]): void => {
                    for (const id of movingIds) {
                        const i = list.findIndex((it) => it.id === id);
                        if (i > -1) {
                            list.splice(i, 1);
                        }
                    }
                };

                if (newSprintId !== oldSprintId) {
                    // Different container. Remove from the OLD sprint (L549-556).
                    if (oldSprint) {
                        removeIdsFrom(oldSprint.user_stories);
                    }

                    if (newSprintId === null) {
                        // Sprint -> backlog (L554-559). NOTE the `newUsIndex + index`
                        // splice offset — reproduce this EXACTLY (do NOT "fix" the
                        // asymmetry against the ->sprint branch below).
                        usList.forEach((u, index) => {
                            draft.userstories.splice(newUsIndex + index, 0, clonesById[u.id]);
                        });
                    } else {
                        // -> sprint / sprint -> sprint (L560-566): remove from the
                        // backlog, set the milestone on the CLONE, then splice into
                        // the new sprint at `newUsIndex` (NOT `newUsIndex + index`).
                        removeIdsFrom(draft.userstories);
                        usList.forEach((u) => {
                            const c = clonesById[u.id];
                            c.milestone = newSprintId;
                            if (newSprint) {
                                newSprint.user_stories.splice(newUsIndex, 0, c);
                            }
                        });
                        // NOTE: the AngularJS `Object.assign(newSprint, {...})` /
                        // `@scope.sprints.map(Object.assign)` reference-churn (L568-576)
                        // existed ONLY to trigger Angular dirty-checking; immer tracks
                        // changes structurally, so it is intentionally NOT reproduced.
                    }
                } else {
                    // Same-container reorder (L577-595).
                    const targetList: UserStory[] =
                        newSprintId != null && newSprint ? newSprint.user_stories : draft.userstories;
                    removeIdsFrom(targetList);

                    // Position derivation reproduced VERBATIM from source L586-593.
                    // The AngularJS `else if nextUs` branch (L590-591) searches for
                    // `previousUs` too (an original-source quirk we preserve for exact
                    // parity — AAP §0.1.1/§0.7.1), so:
                    //   - previousUs truthy         -> index(previousUs) + 1 (drop AFTER it);
                    //   - previousUs null, nextUs set -> findIndex(null) = -1, ++ => 0
                    //     (the "move to top" path, moveUsToTopOfBacklog L511-519);
                    //   - previousUs null, nextUs null -> 0, ++ => 1.
                    // `nextUs` is additionally forwarded by the hook to
                    // `bulkUpdateBacklogOrder`; here it only gates the move-to-top case.
                    let position = 0;
                    if (previousUs) {
                        position = targetList.findIndex((u) => u.id === previousUs);
                    } else if (nextUs) {
                        // Source L590-591 searches `previousUs` (NOT `nextUs`) here.
                        position = targetList.findIndex((u) => u.id === previousUs);
                    }
                    position++; // L593
                    usList.forEach((u, index) => {
                        targetList.splice(position + index, 0, clonesById[u.id]);
                    });
                }

                // L597-598: recompute the visible refs from the backlog list.
                draft.visibleUserStories = draft.userstories.map((u) => u.ref).filter(isRef);
                // resetFirstStoryIndicator equivalent (L507-509).
                draft.firstUsInBacklog = draft.userstories.length
                    ? draft.userstories[0].id
                    : undefined;
                break;
            }

            case 'reconcileMoveResult': {
                // -----------------------------------------------------------------
                // Phase 7 — apply the server-returned `milestone` / `backlog_order`
                // (reproduces main.coffee L611-617). The source re-applied only to
                // the dragged `usList`; matching by id across ALL draft containers is
                // the faithful, robust equivalent because after the optimistic move a
                // story may now live in a sprint or in the backlog.
                // -----------------------------------------------------------------
                const applyTo = (list: UserStory[]): void => {
                    for (const row of action.updatedRows) {
                        const us = list.find((u) => u.id === row.id);
                        if (us) {
                            us.milestone = row.milestone;
                            if (row.backlog_order !== undefined) {
                                us.backlog_order = row.backlog_order;
                            }
                        }
                    }
                };

                applyTo(draft.userstories);
                draft.sprints.forEach((s) => applyTo(s.user_stories));
                draft.closedSprints.forEach((s) => applyTo(s.user_stories));
                // F-AAP-03: a successful server reconcile clears any prior
                // reorder error — the board now reflects server truth.
                draft.moveError = null;
                break;
            }

            case 'setMoveError': {
                // F-AAP-03: surface (or clear) the drag/reorder write error so the
                // UI can report a move that did not persist. The hook sets this on
                // a rejected `bulkUpdateBacklogOrder` and clears it (via `null`).
                draft.moveError = action.message;
                break;
            }

            default:
                // Exhaustive union — no-op for any unhandled action.
                break;
        }
    });
}

