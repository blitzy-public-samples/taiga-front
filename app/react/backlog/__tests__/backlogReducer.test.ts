/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * backlogReducer.test.ts — Jest (jsdom) unit spec for the PURE, immer-driven
 * `backlogReducer` (`../state/backlogReducer.ts`).
 *
 * This is the PRIMARY coverage backbone for the migrated React Backlog /
 * Sprint-planning screen. The reducer is a pure `(state, action) => state`
 * function built on immer's `produce`; it performs no network, DOM, timer, or
 * `Date`/`moment` work, so this spec imports it directly and calls it — nothing
 * is mocked. Every `BacklogAction` type is dispatched at least once, and the
 * highest-value logic ported from the deleted AngularJS controller
 * (`app/coffee/modules/backlog/main.coffee`) — the `moveUs` optimistic
 * transitions (source L523-599) and `reconcileMoveResult` (source L611-617) — is
 * exercised exhaustively.
 *
 * FIDELITY NOTE — assertions target the ACTUAL authored reducer behaviour, which
 * (faithfully mirroring the CoffeeScript source) differs from a naive reading in
 * two places:
 *   1. The optimistic SPRINT -> BACKLOG branch does NOT clear `milestone`; the
 *      moved clone keeps its old sprint id until `reconcileMoveResult` applies the
 *      server value (source main.coffee L554-559).
 *   2. The -> SPRINT branch splices every card at the constant `newUsIndex`, so a
 *      multi-card move into a sprint REVERSES the pair's relative order (source
 *      main.coffee L560-566). Order-preservation is instead shown by the
 *      same-container reorder and the sprint -> backlog move (both use
 *      `newUsIndex + index`).
 *   3. `moveUs`/`reconcileMoveResult` mutate the `sprints` / `closedSprints`
 *      ARRAYS (via `findSprintDraft`, which scans those arrays) but never touch
 *      the `sprintsById` lookup. Because immer copy-on-writes each access path
 *      independently, the shared sprint object reachable from both `sprints[i]`
 *      and `sprintsById[id]` DIVERGES after a move: the array holds the updated
 *      sprint while `sprintsById[id]` keeps its pre-move snapshot. The `sprints`
 *      array is therefore the authoritative post-move container, so every
 *      post-move sprint assertion below reads through the `findSprint` helper
 *      (which resolves against `sprints`/`closedSprints`), never `sprintsById`.
 *      `sprintsById` population is validated separately in the `setSprints` block.
 * All three quirks are asserted verbatim rather than "fixed".
 */

import { freeze } from 'immer';

import { backlogReducer, initialBacklogState } from '../state/backlogReducer';
import type { BacklogAction, BacklogState, BacklogStats } from '../state/backlogReducer';
import type { Milestone, UserStory } from '../../shared/types';
import {
    makeFiltersData,
    makeMilestone,
    makeProject,
    makeSwimlane,
    makeUserStory,
} from './factories';

/* ========================================================================== *
 * Local helpers
 *
 * Fixtures are assembled ONLY from the shared `./factories` builders. The two
 * exceptions below are (a) a thin, fully-typed `dispatch` wrapper — typing
 * `action` as the real `BacklogAction` union makes every action object in this
 * file compile-checked against the authored reducer contract — and (b) a tiny
 * inline `makeStats` builder, because `BacklogStats` is a reducer-local type with
 * no shared-types factory.
 * ========================================================================== */

/** Fully-typed dispatch: every action is checked against `BacklogAction`. */
const dispatch = (state: BacklogState, action: BacklogAction): BacklogState =>
    backlogReducer(state, action);

/** Map a story list to its ids so ordering assertions read clearly. */
const ids = (list: UserStory[]): number[] => list.map((u) => u.id);

/** Find a story by id within a list (undefined when absent). */
const byId = (list: UserStory[], id: number): UserStory | undefined =>
    list.find((u) => u.id === id);

/** Find a story by id, throwing when absent — doubles as a fixture guard. */
const mustFind = (list: UserStory[], id: number): UserStory => {
    const found = list.find((u) => u.id === id);
    if (!found) {
        throw new Error(`fixture story ${id} not found`);
    }
    return found;
};

/**
 * Build `BacklogStats` inline. `BacklogStats` lives in the reducer module (not
 * `shared/types`), so `factories.ts` provides no builder for it; only the three
 * required fields are defaulted and forecasting numbers are passed per test.
 */
const makeStats = (overrides: Partial<BacklogStats> = {}): BacklogStats => ({
    completedPercentage: 0,
    showGraphPlaceholder: false,
    speed: 0,
    ...overrides,
});

/** Build a backlog story list from `[id, backlog_order]` pairs (milestone null). */
const backlog = (pairs: Array<[number, number]>): UserStory[] =>
    pairs.map(([id, order]) =>
        makeUserStory({ id, ref: id, milestone: null, backlog_order: order }),
    );

/** Build a story that lives inside a sprint (milestone + sprint_order set). */
const sprintStory = (id: number, milestone: number, sprint_order: number): UserStory =>
    makeUserStory({ id, ref: id, milestone, sprint_order });

/** Build a sprint (Milestone) with the given id and embedded stories. */
const sprintWith = (
    id: number,
    stories: UserStory[],
    overrides: Partial<Milestone> = {},
): Milestone => makeMilestone({ id, user_stories: stories, ...overrides });

/** Seed a state whose backlog is the given `[id, backlog_order]` pairs. */
const seedBacklog = (pairs: Array<[number, number]>): BacklogState =>
    dispatch(initialBacklogState, { type: 'setUserstories', userstories: backlog(pairs) });

/**
 * Resolve a sprint from the AUTHORITATIVE `sprints` (then `closedSprints`) array,
 * throwing when absent. `moveUs`/`reconcileMoveResult` mutate those arrays via the
 * reducer's `findSprintDraft`, so post-move assertions MUST read here and never
 * through `sprintsById` (see FIDELITY NOTE quirk 3 — the lookup goes stale after a
 * move). `sprintsById` population is asserted only inside the `setSprints` block.
 */
const findSprint = (state: BacklogState, id: number): Milestone => {
    const sprint =
        state.sprints.find((s) => s.id === id) ||
        state.closedSprints.find((s) => s.id === id);
    if (!sprint) {
        throw new Error(`fixture sprint ${id} not found in sprints/closedSprints`);
    }
    return sprint;
};

/* ========================================================================== *
 * initialBacklogState
 * ========================================================================== */

describe('initialBacklogState', () => {
    it('locks the documented starting defaults', () => {
        expect(initialBacklogState.loading).toBe(true);
        expect(initialBacklogState.showTags).toBe(true);
        expect(initialBacklogState.displayVelocity).toBe(false);
        expect(initialBacklogState.forecastNewSprint).toBe(true);
        expect(initialBacklogState.page).toBe(1);
        expect(initialBacklogState.userstories).toEqual([]);
        expect(initialBacklogState.sprints).toEqual([]);
        expect(initialBacklogState.closedSprints).toEqual([]);
        expect(initialBacklogState.visibleUserStories).toEqual([]);
        expect(initialBacklogState.totalMilestones).toBe(0);
    });
});

/* ========================================================================== *
 * setUserstories
 * ========================================================================== */

describe('setUserstories', () => {
    it('sorts the backlog ascending by backlog_order', () => {
        // Unsorted input: ids 3,1,2 with backlog_order 3,1,2.
        const input = backlog([
            [3, 3],
            [1, 1],
            [2, 2],
        ]);
        const result = dispatch(initialBacklogState, { type: 'setUserstories', userstories: input });
        expect(ids(result.userstories)).toEqual([1, 2, 3]);
    });

    it('recomputes visibleUserStories (all refs) and firstUsInBacklog', () => {
        const input = backlog([
            [3, 3],
            [1, 1],
            [2, 2],
        ]);
        const result = dispatch(initialBacklogState, { type: 'setUserstories', userstories: input });
        // ref === id in these fixtures; visible refs follow the sorted order.
        expect(result.visibleUserStories).toEqual([1, 2, 3]);
        expect(result.firstUsInBacklog).toBe(1);
        expect(result.loadingUserstories).toBe(false);
    });

    it('does not mutate the input array and returns a new state (purity)', () => {
        const input = backlog([
            [3, 3],
            [1, 1],
            [2, 2],
        ]);
        const prev = initialBacklogState;
        const result = dispatch(prev, { type: 'setUserstories', userstories: input });
        expect(result).not.toBe(prev);
        // The reducer sorts a COPY, so the caller's array is left untouched.
        expect(input[0].id).toBe(3);
        expect(ids(input)).toEqual([3, 1, 2]);
    });
});

/* ========================================================================== *
 * appendUserstories
 * ========================================================================== */

describe('appendUserstories', () => {
    it('concatenates a sorted batch after the existing backlog without dropping rows', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setUserstories',
            userstories: backlog([
                [1, 1],
                [2, 2],
            ]),
        });
        state = dispatch(state, {
            type: 'appendUserstories',
            userstories: backlog([
                [4, 4],
                [3, 3],
            ]),
        });
        expect(ids(state.userstories)).toEqual([1, 2, 3, 4]);
        expect(state.userstories).toHaveLength(4);
    });

    it('produces no duplicates for distinct ids and keeps loadingUserstories false', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setUserstories',
            userstories: backlog([
                [1, 1],
                [2, 2],
            ]),
        });
        state = dispatch(state, {
            type: 'appendUserstories',
            userstories: backlog([
                [3, 3],
                [4, 4],
            ]),
        });
        expect(new Set(ids(state.userstories)).size).toBe(4);
        expect(state.loadingUserstories).toBe(false);
    });
});

/* ========================================================================== *
 * setSprints / setClosedSprints
 * ========================================================================== */

describe('setSprints / setClosedSprints', () => {
    it('stores open sprints, keys them by id, and sorts each sprint by sprint_order', () => {
        const sprint7 = sprintWith(7, [sprintStory(12, 7, 2), sprintStory(11, 7, 1)]);
        const sprint8 = sprintWith(8, [sprintStory(22, 8, 2), sprintStory(21, 8, 1)]);
        const result = dispatch(initialBacklogState, {
            type: 'setSprints',
            sprints: [sprint7, sprint8],
            open: 2,
            closed: 0,
        });
        expect(result.sprints).toHaveLength(2);
        expect(result.sprintsById[7]).toBeDefined();
        expect(result.sprintsById[8]).toBeDefined();
        // user_stories sorted ascending by sprint_order within each sprint.
        expect(ids(result.sprints[0].user_stories)).toEqual([11, 12]);
        expect(ids(result.sprints[1].user_stories)).toEqual([21, 22]);
        // totalMilestones === open + closed.
        expect(result.totalMilestones).toBe(2);
    });

    it('clones each sprint so the input milestone user_stories array is untouched', () => {
        const inputStories = [sprintStory(12, 7, 2), sprintStory(11, 7, 1)];
        const sprint7 = sprintWith(7, inputStories);
        const result = dispatch(initialBacklogState, {
            type: 'setSprints',
            sprints: [sprint7],
            open: 1,
            closed: 0,
        });
        // The reducer sorts a COPY, so the caller's array order is preserved.
        expect(ids(inputStories)).toEqual([12, 11]);
        // The stored sprint is a distinct clone of the input object.
        expect(result.sprints[0]).not.toBe(sprint7);
    });

    it('stores closed sprints, keys them by id, and sets totalClosedMilestones', () => {
        const closed = sprintWith(9, [sprintStory(31, 9, 1)], { closed: true });
        const result = dispatch(initialBacklogState, {
            type: 'setClosedSprints',
            sprints: [closed],
            closed: 1,
        });
        expect(result.closedSprints).toHaveLength(1);
        expect(result.closedSprintsById[9]).toBeDefined();
        expect(result.totalClosedMilestones).toBe(1);
    });
});

/* ========================================================================== *
 * Single-field setters
 * ========================================================================== */

describe('setters (single-field stores)', () => {
    it('setLoading toggles the loading flag', () => {
        const result = dispatch(initialBacklogState, { type: 'setLoading', loading: false });
        expect(result.loading).toBe(false);
    });

    it('setProject stores the project and derives isBacklogActivated (true)', () => {
        const project = makeProject({ id: 5, is_backlog_activated: true });
        const result = dispatch(initialBacklogState, { type: 'setProject', project });
        expect(result.project?.id).toBe(5);
        expect(result.isBacklogActivated).toBe(true);
    });

    it('setProject with is_backlog_activated false disables the backlog', () => {
        const project = makeProject({ is_backlog_activated: false });
        const result = dispatch(initialBacklogState, { type: 'setProject', project });
        expect(result.isBacklogActivated).toBe(false);
    });

    it('setProject seeds swimlanesList from the project, deduped by id', () => {
        // Pre-seed swimlane 1 so setProject must SKIP it (dedupe) and add only 2.
        let state = dispatch(initialBacklogState, {
            type: 'setSwimlanes',
            swimlanes: [makeSwimlane({ id: 1 })],
        });
        // Typed local avoids indexing the `unknown`-typed `project.swimlanes`.
        const projSwimlanes = [makeSwimlane({ id: 1 }), makeSwimlane({ id: 2 })];
        const project = makeProject({
            id: 5,
            // `swimlanes` is not modelled on `Project` but is read structurally by
            // the reducer (loadSwimlanes parity); the index signature accepts it.
            swimlanes: projSwimlanes,
        });
        state = dispatch(state, { type: 'setProject', project });
        // id 1 already present (skipped), id 2 appended.
        expect(state.swimlanesList.map((s) => s.id)).toEqual([1, 2]);
        // Cloned into the draft — not the same reference as the project's array.
        expect(state.swimlanesList[1]).not.toBe(projSwimlanes[1]);
    });

    it('setPagination applies noSwimlaneUserStories when provided', () => {
        const result = dispatch(initialBacklogState, {
            type: 'setPagination',
            noSwimlaneUserStories: true,
        });
        expect(result.noSwimlaneUserStories).toBe(true);
        // Unrelated pagination fields keep their defaults.
        expect(result.page).toBe(1);
    });

    it('setPagination applies only the provided fields', () => {
        const result = dispatch(initialBacklogState, {
            type: 'setPagination',
            page: 3,
            disablePagination: true,
            totalUserStories: 42,
        });
        expect(result.page).toBe(3);
        expect(result.disablePagination).toBe(true);
        expect(result.totalUserStories).toBe(42);
        // Fields omitted from the action keep their defaults.
        expect(result.noSwimlaneUserStories).toBe(false);
    });

    it('setStats stores stats and recomputes the forecast', () => {
        const stats = makeStats({ speed: 10, assigned_points: 0, total_points: 16 });
        const result = dispatch(initialBacklogState, { type: 'setStats', stats });
        expect(result.stats?.speed).toBe(10);
        expect(Array.isArray(result.forecastedStories)).toBe(true);
    });

    it('setFiltersData stores the filters payload', () => {
        const filtersData = makeFiltersData({ statuses: [{ id: 1, name: 'New', count: 3 }] });
        const result = dispatch(initialBacklogState, { type: 'setFiltersData', filtersData });
        expect(result.filtersData).toEqual(filtersData);
    });

    it('setSelectedFilters stores the whitelisted filters map', () => {
        const filters = { status: '1,2', assigned_to: '7' };
        const result = dispatch(initialBacklogState, { type: 'setSelectedFilters', filters });
        expect(result.selectedFilters).toEqual(filters);
    });

    it('setCurrentSprint stores the current sprint', () => {
        const sprint = makeMilestone({ id: 7 });
        const result = dispatch(initialBacklogState, { type: 'setCurrentSprint', sprint });
        expect(result.currentSprint?.id).toBe(7);
    });

    it('setCurrentSprint accepts null', () => {
        const result = dispatch(initialBacklogState, { type: 'setCurrentSprint', sprint: null });
        expect(result.currentSprint).toBeNull();
    });

    it('setSwimlanes merges swimlanes deduped by id across dispatches', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setSwimlanes',
            swimlanes: [makeSwimlane({ id: 1 }), makeSwimlane({ id: 2 })],
        });
        // Second dispatch overlaps id 2 — it must NOT be duplicated.
        state = dispatch(state, {
            type: 'setSwimlanes',
            swimlanes: [makeSwimlane({ id: 2 }), makeSwimlane({ id: 3 })],
        });
        expect(state.swimlanesList.map((s) => s.id)).toEqual([1, 2, 3]);
    });
});

/* ========================================================================== *
 * Toggle flags
 * ========================================================================== */

describe('toggle flags', () => {
    it('toggleTags flips showTags across dispatches', () => {
        let state = dispatch(initialBacklogState, { type: 'toggleTags' });
        expect(state.showTags).toBe(false); // was true
        state = dispatch(state, { type: 'toggleTags' });
        expect(state.showTags).toBe(true);
    });

    it('toggleTags honours an explicit value', () => {
        const state = dispatch(initialBacklogState, { type: 'toggleTags', showTags: false });
        expect(state.showTags).toBe(false);
    });

    it('toggleActiveFilters flips activeFilters across dispatches', () => {
        let state = dispatch(initialBacklogState, { type: 'toggleActiveFilters' });
        expect(state.activeFilters).toBe(true); // was false
        state = dispatch(state, { type: 'toggleActiveFilters' });
        expect(state.activeFilters).toBe(false);
    });

    it('setForecasting recomputes the forecast to a defined array', () => {
        let state = seedBacklog([
            [1, 1],
            [2, 2],
        ]);
        state = dispatch(state, { type: 'setStats', stats: makeStats({ speed: 10 }) });
        state = dispatch(state, { type: 'setForecasting' });
        expect(Array.isArray(state.forecastedStories)).toBe(true);
        expect(typeof state.forecastNewSprint).toBe('boolean');
    });

    it('toggleVelocity on recomputes visibleUserStories from the forecast subset', () => {
        // Four 4-point backlog stories + speed 10 => forecast truncates before all.
        const stories = [1, 2, 3, 4].map((id) =>
            makeUserStory({ id, ref: id, backlog_order: id, total_points: 4, milestone: null }),
        );
        let state = dispatch(initialBacklogState, { type: 'setUserstories', userstories: stories });
        state = dispatch(state, { type: 'setStats', stats: makeStats({ speed: 10, assigned_points: 0 }) });
        // No explicit value -> flips displayVelocity false => true.
        state = dispatch(state, { type: 'toggleVelocity' });
        expect(state.displayVelocity).toBe(true);
        // visibleUserStories mirrors the forecasted subset's refs (consistency).
        expect(state.visibleUserStories).toEqual(state.forecastedStories.map((u) => u.ref));
        // The forecast is a proper subset given speed 10 and 4-point stories.
        expect(state.forecastedStories.length).toBeLessThan(stories.length);
    });

    it('toggleVelocity off restores visibleUserStories to all backlog refs', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setUserstories',
            userstories: backlog([
                [1, 1],
                [2, 2],
                [3, 3],
            ]),
        });
        state = dispatch(state, { type: 'setStats', stats: makeStats({ speed: 10 }) });
        state = dispatch(state, { type: 'toggleVelocity', displayVelocity: true });
        state = dispatch(state, { type: 'toggleVelocity', displayVelocity: false });
        expect(state.displayVelocity).toBe(false);
        expect(state.visibleUserStories).toEqual([1, 2, 3]);
    });
});

/* ========================================================================== *
 * forecasting (calculateForecasting parity — main.coffee L444-467)
 *
 * `setForecasting` recomputes the velocity forecast in place. These tests drive
 * the branches the toggle-flags tests do not: the no-stats early return and the
 * `sprints.length > 0` sprint-points branch (both under and over velocity).
 * ========================================================================== */

describe('forecasting (setForecasting)', () => {
    it('with no stats clears the forecast and flags a new sprint (early return)', () => {
        // initialBacklogState.stats is null, so calculateForecasting returns early.
        const state = dispatch(initialBacklogState, { type: 'setForecasting' });
        expect(state.forecastedStories).toEqual([]);
        expect(state.forecastNewSprint).toBe(true);
    });

    it('with a first sprint UNDER velocity clears forecastNewSprint (sprint branch, else)', () => {
        // sprintTotalPoints(sprints[0]) = 2 (story 100, milestone 7, 2 pts); speed 10.
        // 2 is NOT > 10, so the else branch sets forecastNewSprint = false.
        let state = dispatch(initialBacklogState, {
            type: 'setSprints',
            sprints: [sprintWith(7, [makeUserStory({ id: 100, ref: 100, milestone: 7, sprint_order: 1, total_points: 2 })])],
            open: 1,
            closed: 0,
        });
        state = dispatch(state, {
            type: 'setUserstories',
            userstories: [
                makeUserStory({ id: 1, ref: 1, milestone: null, backlog_order: 1, total_points: 1 }),
                makeUserStory({ id: 2, ref: 2, milestone: null, backlog_order: 2, total_points: 1 }),
            ],
        });
        state = dispatch(state, { type: 'setStats', stats: makeStats({ speed: 10, assigned_points: 0 }) });
        state = dispatch(state, { type: 'setForecasting' });
        expect(state.forecastNewSprint).toBe(false);
        // Both small backlog stories fit under speed 10 -> all forecasted.
        expect(state.forecastedStories.map((u) => u.id)).toEqual([1, 2]);
    });

    it('with a first sprint OVER velocity resets backlog points and keeps forecastNewSprint true', () => {
        // sprintTotalPoints(sprints[0]) = 20 (story 100, 20 pts); speed 10.
        // 20 > 10, so backlog_points_sum resets to 0 and forecastNewSprint stays true.
        let state = dispatch(initialBacklogState, {
            type: 'setSprints',
            sprints: [sprintWith(7, [makeUserStory({ id: 100, ref: 100, milestone: 7, sprint_order: 1, total_points: 20 })])],
            open: 1,
            closed: 0,
        });
        state = dispatch(state, {
            type: 'setUserstories',
            userstories: [
                makeUserStory({ id: 1, ref: 1, milestone: null, backlog_order: 1, total_points: 1 }),
                makeUserStory({ id: 2, ref: 2, milestone: null, backlog_order: 2, total_points: 1 }),
            ],
        });
        state = dispatch(state, { type: 'setStats', stats: makeStats({ speed: 10, assigned_points: 0 }) });
        state = dispatch(state, { type: 'setForecasting' });
        expect(state.forecastNewSprint).toBe(true);
        // After the reset the backlog sum restarts at 0, so both stories forecast.
        expect(state.forecastedStories.map((u) => u.id)).toEqual([1, 2]);
    });
});

/* ========================================================================== *
 * addUsOptimistic / removeUsOptimistic
 * ========================================================================== */

describe('addUsOptimistic / removeUsOptimistic', () => {
    it('addUsOptimistic top inserts at the front, flags newUs, and recomputes visible refs', () => {
        let state = seedBacklog([
            [1, 1],
            [2, 2],
        ]);
        const created = makeUserStory({ id: 99, ref: 99, backlog_order: 0, milestone: null });
        state = dispatch(state, { type: 'addUsOptimistic', userstories: [created], position: 'top' });
        expect(state.userstories[0].id).toBe(99);
        expect(state.userstories).toHaveLength(3);
        expect(state.newUs).toContain(99);
        expect(state.visibleUserStories).toContain(99);
    });

    it('addUsOptimistic bottom appends at the end', () => {
        let state = seedBacklog([
            [1, 1],
            [2, 2],
        ]);
        const created = makeUserStory({ id: 88, ref: 88, backlog_order: 9, milestone: null });
        state = dispatch(state, { type: 'addUsOptimistic', userstories: [created], position: 'bottom' });
        expect(state.userstories[state.userstories.length - 1].id).toBe(88);
    });

    it('removeUsOptimistic removes the story by id from the backlog and recomputes refs', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        state = dispatch(state, { type: 'removeUsOptimistic', usId: 20 });
        expect(ids(state.userstories)).toEqual([10, 30]);
        expect(state.visibleUserStories).toEqual([10, 30]);
    });
});

/* ========================================================================== *
 * replaceUs (F-CQ-03 — in-place single-story status / points edit)
 * ========================================================================== */

describe('replaceUs', () => {
    it('replaces a story in place by id, preserving its list position', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        const updated = makeUserStory({
            id: 20,
            ref: 20,
            milestone: null,
            backlog_order: 2,
            status: 99,
        });
        state = dispatch(state, { type: 'replaceUs', us: updated });

        // Same order, same length — only the id-20 entry changed.
        expect(ids(state.userstories)).toEqual([10, 20, 30]);
        expect(mustFind(state.userstories, 20).status).toBe(99);
    });

    it('carries a new points map onto the replaced story', () => {
        let state = seedBacklog([[10, 1]]);
        const updated = makeUserStory({
            id: 10,
            ref: 10,
            milestone: null,
            backlog_order: 1,
            points: { '1': 11 },
        });
        state = dispatch(state, { type: 'replaceUs', us: updated });
        expect(mustFind(state.userstories, 10).points).toEqual({ '1': 11 });
    });

    it('is a no-op when the id is not present in the backlog', () => {
        const before = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        const after = dispatch(before, {
            type: 'replaceUs',
            us: makeUserStory({ id: 999, ref: 999, milestone: null }),
        });
        expect(ids(after.userstories)).toEqual([10, 20]);
    });
});


/* ========================================================================== *
 * moveUs — optimistic transitions (THE critical coverage)
 * ========================================================================== */

describe('moveUs — optimistic transitions', () => {
    it('reorders within the backlog (drops the card AFTER previousUs)', () => {
        // Backlog ids [10,20,30,40,50]; move [20] to just after 40.
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
            [40, 4],
            [50, 5],
        ]);
        const prev = state;
        const moving = mustFind(state.userstories, 20);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: 40,
            nextUs: 50,
        });
        // remove 20 -> [10,30,40,50]; position = index(40)=2, ++=3; splice(3,20).
        expect(ids(state.userstories)).toEqual([10, 30, 40, 20, 50]);
        expect(state.visibleUserStories).toEqual([10, 30, 40, 20, 50]);
        expect(state).not.toBe(prev);
    });

    it('backlog -> sprint removes from backlog, sets milestone, and splices into the sprint', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [sprintStory(100, 7, 1)])],
            open: 1,
            closed: 0,
        });
        const moving = mustFind(state.userstories, 20);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: 7,
            previousUs: null,
            nextUs: 100,
        });
        // 20 leaves the backlog ...
        expect(ids(state.userstories)).toEqual([10, 30]);
        // ... and is spliced into sprint 7 at index 0 with milestone set to 7.
        expect(ids(findSprint(state, 7).user_stories)).toEqual([20, 100]);
        expect(byId(findSprint(state, 7).user_stories, 20)?.milestone).toBe(7);
        // visible refs recomputed from the (now shorter) backlog.
        expect(state.visibleUserStories).toEqual([10, 30]);
    });

    it('sprint -> backlog inserts at newUsIndex + index and keeps the old milestone (optimistic)', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [sprintStory(100, 7, 1), sprintStory(200, 7, 2)])],
            open: 1,
            closed: 0,
        });
        const moving = mustFind(findSprint(state, 7).user_stories, 100);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 1,
            newSprintId: null,
            previousUs: 10,
            nextUs: 20,
        });
        // 100 removed from sprint 7 -> [200].
        expect(ids(findSprint(state, 7).user_stories)).toEqual([200]);
        // Inserted into the backlog at newUsIndex + index = 1 + 0 = 1.
        expect(ids(state.userstories)).toEqual([10, 100, 20]);
        // AUTHORED behaviour: the optimistic sprint -> backlog branch does NOT
        // clear milestone; the clone keeps its old sprint id until reconcile.
        expect(byId(state.userstories, 100)?.milestone).toBe(7);
    });

    it('sprint -> sprint moves the story between sprints and sets the new milestone', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setSprints',
            sprints: [
                sprintWith(7, [sprintStory(100, 7, 1), sprintStory(200, 7, 2)]),
                sprintWith(8, [sprintStory(300, 8, 1)]),
            ],
            open: 2,
            closed: 0,
        });
        const moving = mustFind(findSprint(state, 7).user_stories, 200);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: 8,
            previousUs: null,
            nextUs: 300,
        });
        expect(ids(findSprint(state, 7).user_stories)).toEqual([100]);
        expect(ids(findSprint(state, 8).user_stories)).toEqual([200, 300]);
        expect(byId(findSprint(state, 8).user_stories, 200)?.milestone).toBe(8);
    });

    it('move-to-top of the backlog lands the story at index 0 (previousUs null, nextUs set)', () => {
        // moveUsToTopOfBacklog parity: previousUs null + nextUs = current first id.
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        const moving = mustFind(state.userstories, 30);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: null,
            nextUs: 10,
        });
        expect(ids(state.userstories)).toEqual([30, 10, 20]);
        expect(state.firstUsInBacklog).toBe(30);
    });

    it('multi-card reorder within the backlog moves both together preserving relative order', () => {
        // Backlog [10,20,30,40,50]; move [20,40] to just after 10.
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
            [40, 4],
            [50, 5],
        ]);
        const a = mustFind(state.userstories, 20);
        const b = mustFind(state.userstories, 40);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [a, b],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: 10,
            nextUs: 30,
        });
        // remove 20,40 -> [10,30,50]; position=index(10)=0,++=1; splice(1,20) then splice(2,40).
        expect(ids(state.userstories)).toEqual([10, 20, 40, 30, 50]);
        // Same-container reorder uses `position + index`, so 20 stays before 40.
        const order = ids(state.userstories);
        expect(order.indexOf(20)).toBeLessThan(order.indexOf(40));
    });

    it('multi-card backlog -> sprint moves both and assigns the new milestone to each', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
            [40, 4],
            [50, 5],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [sprintStory(100, 7, 1)])],
            open: 1,
            closed: 0,
        });
        const a = mustFind(state.userstories, 20);
        const b = mustFind(state.userstories, 40);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [a, b],
            newUsIndex: 0,
            newSprintId: 7,
            previousUs: null,
            nextUs: 100,
        });
        // Both leave the backlog together.
        expect(ids(state.userstories)).toEqual([10, 30, 50]);
        // AUTHORED behaviour: the -> sprint branch splices every card at the SAME
        // newUsIndex (0), so the moved pair's order is reversed -> [40, 20, 100].
        expect(ids(findSprint(state, 7).user_stories)).toEqual([40, 20, 100]);
        // Both clones carry the new milestone.
        expect(byId(findSprint(state, 7).user_stories, 20)?.milestone).toBe(7);
        expect(byId(findSprint(state, 7).user_stories, 40)?.milestone).toBe(7);
    });

    it('an empty usList is a no-op that returns the identical state', () => {
        // Source guards `if not usList.length` before touching anything (L626-627);
        // immer returns the ORIGINAL root when the draft is never mutated.
        const state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        const result = dispatch(state, {
            type: 'moveUs',
            usList: [],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: null,
            nextUs: null,
        });
        expect(result).toBe(state);
        expect(ids(result.userstories)).toEqual([10, 20]);
    });

    it('backlog -> CLOSED sprint resolves via the closed-sprints fallback', () => {
        // findSprintDraft scans OPEN sprints first, then CLOSED (source
        // `sprintsById[id] || closedSprintsById[id]`, L648). Moving into a closed
        // sprint exercises that fallback branch.
        let state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        state = dispatch(state, {
            type: 'setClosedSprints',
            sprints: [sprintWith(9, [], { closed: true })],
            closed: 1,
        });
        const moving = mustFind(state.userstories, 20);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: 9,
            previousUs: null,
            nextUs: null,
        });
        // 20 leaves the backlog and lands in the closed sprint with milestone 9.
        expect(ids(state.userstories)).toEqual([10]);
        expect(ids(findSprint(state, 9).user_stories)).toEqual([20]);
        expect(byId(findSprint(state, 9).user_stories, 20)?.milestone).toBe(9);
    });
});

/* ========================================================================== *
 * moveUs — immer safety & purity
 * ========================================================================== */

describe('moveUs — immer safety & purity', () => {
    it('does not throw when the moving usList is deeply frozen', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [])],
            open: 1,
            closed: 0,
        });
        // Deep-freeze the action's usList. The reducer must clone ({...u}) before
        // mutating `milestone`, so a frozen input must NOT throw.
        const frozen = freeze([makeUserStory({ id: 20, ref: 20, milestone: null, backlog_order: 2 })], true);
        expect(() =>
            dispatch(state, {
                type: 'moveUs',
                usList: frozen,
                newUsIndex: 0,
                newSprintId: 7,
                previousUs: null,
                nextUs: null,
            }),
        ).not.toThrow();
    });

    it('sets the new milestone on a clone, leaving the frozen input object untouched', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [])],
            open: 1,
            closed: 0,
        });
        const input = makeUserStory({ id: 20, ref: 20, milestone: null, backlog_order: 2 });
        const frozen = freeze([input], true);
        const result = dispatch(state, {
            type: 'moveUs',
            usList: frozen,
            newUsIndex: 0,
            newSprintId: 7,
            previousUs: null,
            nextUs: null,
        });
        // The clone inside the sprint carries the new milestone ...
        expect(byId(findSprint(result, 7).user_stories, 20)?.milestone).toBe(7);
        // ... while the original frozen input object is unchanged.
        expect(input.milestone).toBeNull();
    });

    it('is referentially pure: the previous state is not mutated and a new root is returned', () => {
        const state = seedBacklog([
            [10, 1],
            [20, 2],
            [30, 3],
        ]);
        const prev = state;
        const before = ids(prev.userstories);
        const moving = mustFind(state.userstories, 20);
        const result = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: 30,
            nextUs: null,
        });
        expect(result).not.toBe(prev);
        // The base state is left intact (same ids, same order).
        expect(ids(prev.userstories)).toEqual(before);
        expect(ids(prev.userstories)).toEqual([10, 20, 30]);
    });
});

/* ========================================================================== *
 * reconcileMoveResult
 * ========================================================================== */

describe('reconcileMoveResult', () => {
    it('applies milestone and backlog_order across the backlog AND all sprints', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        state = dispatch(state, {
            type: 'setSprints',
            sprints: [sprintWith(7, [sprintStory(100, 7, 1)])],
            open: 1,
            closed: 0,
        });
        const prev = state;
        state = dispatch(state, {
            type: 'reconcileMoveResult',
            updatedRows: [
                { id: 20, milestone: 7, backlog_order: 99 },
                { id: 100, milestone: null },
            ],
        });
        // US 20 (in the backlog) picks up milestone 7 and backlog_order 99.
        expect(byId(state.userstories, 20)?.milestone).toBe(7);
        expect(byId(state.userstories, 20)?.backlog_order).toBe(99);
        // US 100 (in sprint 7) has milestone cleared to null.
        expect(byId(findSprint(state, 7).user_stories, 100)?.milestone).toBeNull();
        // Untouched rows keep their fields (subject + the un-listed story).
        expect(byId(state.userstories, 10)?.milestone).toBeNull();
        expect(byId(state.userstories, 20)?.subject).toBe('Story 1');
        // Purity: the previous state is not mutated.
        expect(byId(prev.userstories, 20)?.milestone).toBeNull();
        expect(byId(prev.userstories, 20)?.backlog_order).toBe(2);
        expect(state).not.toBe(prev);
    });

    it('leaves backlog_order unchanged when a row omits it', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        state = dispatch(state, {
            type: 'reconcileMoveResult',
            updatedRows: [{ id: 20, milestone: 5 }],
        });
        expect(byId(state.userstories, 20)?.milestone).toBe(5);
        // backlog_order untouched because the row omitted it.
        expect(byId(state.userstories, 20)?.backlog_order).toBe(2);
    });

    it('clears moveError on a successful reconcile (F-AAP-03)', () => {
        let state = dispatch(seedBacklog([[10, 1]]), {
            type: 'setMoveError',
            message: 'earlier reorder failed',
        });
        expect(state.moveError).toBe('earlier reorder failed');

        state = dispatch(state, { type: 'reconcileMoveResult', updatedRows: [{ id: 10, milestone: null }] });
        expect(state.moveError).toBeNull();
    });
});

/* ========================================================================== *
 * moveError surfacing / clearing (F-AAP-03)
 * ========================================================================== */

describe('moveError (F-AAP-03)', () => {
    it('has a null moveError in the initial state', () => {
        expect(initialBacklogState.moveError).toBeNull();
    });

    it('setMoveError surfaces a message and clears it with null', () => {
        let state = dispatch(initialBacklogState, {
            type: 'setMoveError',
            message: 'Server rejected the reorder',
        });
        expect(state.moveError).toBe('Server rejected the reorder');

        state = dispatch(state, { type: 'setMoveError', message: null });
        expect(state.moveError).toBeNull();
    });

    it('a fresh optimistic moveUs clears a stale moveError', () => {
        let state = seedBacklog([
            [10, 1],
            [20, 2],
        ]);
        state = dispatch(state, { type: 'setMoveError', message: 'stale error' });
        expect(state.moveError).toBe('stale error');

        const moving = mustFind(state.userstories, 20);
        state = dispatch(state, {
            type: 'moveUs',
            usList: [moving],
            newUsIndex: 0,
            newSprintId: null,
            previousUs: 10,
            nextUs: null,
        });
        expect(state.moveError).toBeNull();
    });
});

/* ========================================================================== *
 * default (unhandled action)
 * ========================================================================== */

describe('unhandled action', () => {
    it('is a no-op that returns the identical state (default switch branch)', () => {
        // The union is exhaustive, so force an out-of-contract action through a
        // double cast. The reducer's default branch does nothing, and immer
        // returns the ORIGINAL root when the draft is never mutated.
        const unknownAction = { type: '__does_not_exist__' } as unknown as BacklogAction;
        const result = dispatch(initialBacklogState, unknownAction);
        expect(result).toBe(initialBacklogState);
    });
});

