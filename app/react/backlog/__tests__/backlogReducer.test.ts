/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ---------------------------------------------------------------------------
 * Unit spec — Backlog immer reducer (app/react/backlog/state/backlogReducer.ts)
 * ---------------------------------------------------------------------------
 *
 * This is the browserless Jest + TypeScript unit spec for the PURE, immer-based
 * Backlog reducer that powers the React coexistence migration of the AngularJS
 * `taigaBacklog` screen. The reducer is the highest-leverage contributor to the
 * mandated >=70% global line-coverage gate (root `jest.config.js`
 * `coverageThreshold.global.lines = 70` over `app/react/**`), so this spec
 * exhaustively exercises every exported factory, helper, selector, producer and
 * the optional dispatcher.
 *
 * DESIGN CONTRACT (AAP 0.6.2 test isolation, 0.7):
 *   - The reducer is PURE (its only runtime dependency is immer's `produce`),
 *     so this spec uses NO test doubles whatsoever — no module mocks, no fake
 *     timers, no DOM. Everything is driven through plain, typed data.
 *   - Test isolation is a HARD requirement: this file imports NO Playwright,
 *     launches NO browser, and makes NO network calls. It passes headlessly in
 *     a bare container under `jest-environment-jsdom`.
 *   - Globals-only boundary: the ONLY project import is the module under test
 *     (`../state/backlogReducer`). Nothing is imported from the legacy
 *     CoffeeScript sources, the Jade partials, the SCSS, the compiled
 *     Angular-Elements bundle, or any incumbent drag-and-drop / persistent-
 *     collection / form-validation package that the migration deliberately
 *     leaves to the out-of-scope screens.
 *
 * DETERMINISM: the reducer never reads the wall clock — every "now" is an
 * INJECTED `nowMs` / `nowYmd` argument. Timezone-independent instants are built
 * with the reducer's own `parseYmdToMs` (local midnight), so the suite is
 * deterministic on any machine/timezone with no fake timers.
 *
 * BEHAVIORAL-PARITY QUIRKS locked in by this spec (deliberate, NOT defects):
 *   - `applyDrag` same-container reorder reproduces the AngularJS
 *     after-precedence head-insert bug (main.coffee:591): a drop with only a
 *     `nextUs` inserts the moved story at the HEAD of the list.
 *   - `moveToCurrentSprint` / `moveToLatestSprint` always send
 *     `payload.milestoneId === sprints[0].id` (main.coffee:799), even when the
 *     optimistic union targets `currentSprint`.
 */

import {
  // Factory / reset
  createInitialState,
  initialBacklogState,
  reset,
  // Pure helpers
  sortByBacklogOrder,
  sortBySprintOrder,
  keyById,
  sumBy,
  parseYmdToMs,
  formatMsToYmd,
  addWeeks,
  // Selectors
  selectOpenSprints,
  sprintTotalPoints,
  findCurrentSprint,
  selectLastSprint,
  computeCompletedPercentage,
  buildCreateSprintDefaults,
  // Loading / stats producers
  setUserstories,
  setSprints,
  setClosedSprints,
  unloadClosedSprints,
  setProjectStats,
  setProject,
  markNewUs,
  // Inline row-control producers (finding #12)
  updateUserStory,
  removeUserStory,
  setPointsViewRole,
  // Movement producers (server-observable: return { state, payload })
  applyDrag,
  applyMoveResult,
  moveToCurrentSprint,
  moveToLatestSprint,
  // Toggle / filter / selection / fold producers
  toggleShowTags,
  toggleActiveFilters,
  toggleVelocityForecasting,
  calculateForecasting,
  setForecastedStories,
  toggleClosedSprintsVisible,
  setFilterQuery,
  setFilters,
  setSelectedIds,
  toggleSelectedId,
  toggleSprintFold,
  // Sprint add/edit form producers
  openSprintFormCreate,
  openSprintFormEdit,
  closeSprintForm,
  setSprintFormValues,
  removeSprint,
  upsertSprint,
  // Optional dispatcher
  backlogReducer,
  // Types (type-only where possible)
  type UserStory,
  type Sprint,
  type Project,
  type BacklogStats,
  type BacklogState,
  type BacklogFilters,
  type SprintFormValues,
  type SetUserstoriesOptions,
  type BacklogMoveResultEntry,
  type BacklogMovePayload,
  type BacklogMoveResult,
  type BacklogMoveToSprintResult,
  type BacklogAction,
} from '../state/backlogReducer';

/*
 * The `applyDrag` input type. `BacklogDragResult` is defined in
 * `../../shared/dnd/types` and is only *consumed* by the reducer — it is NOT
 * re-exported by `backlogReducer.ts`. To honor the "import ONLY the unit under
 * test" isolation rule we derive the exact input type from the function
 * signature instead of adding a second import.
 * // adjusted per backlogReducer.ts on disk: BacklogDragResult not re-exported;
 * // derived via Parameters<typeof applyDrag>[1].
 */
type DragResult = Parameters<typeof applyDrag>[1];

/* ================================================================== *
 * Phase B — Typed fixture factories (NO mocks; plain data mirroring
 * the frozen `/api/v1/` shapes). Every factory casts through the real
 * exported types so strict mode is satisfied without bare `any`.
 * ================================================================== */

/**
 * Build a backlog user story. `ref`, `backlog_order` and `sprint_order` default
 * to the `id` (so a fixture reads naturally) but every field is overridable.
 */
function makeUs(over: Partial<UserStory> = {}): UserStory {
  const id = over.id ?? 1;
  return {
    id,
    ref: id,
    milestone: null,
    project: 7,
    backlog_order: id,
    sprint_order: id,
    total_points: 0,
    ...over,
  } as UserStory;
}

/** Build a sprint/milestone with an empty, open story list by default. */
function makeSprint(over: Partial<Sprint> = {}): Sprint {
  const id = over.id ?? 10;
  return {
    id,
    name: `Sprint ${id}`,
    project: 7,
    closed: false,
    total_points: 0,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-15',
    user_stories: [],
    ...over,
  } as Sprint;
}

/** Build the resolved project record. */
function makeProject(over: Partial<Project> = {}): Project {
  return { id: 7, slug: 'p', ...over } as Project;
}

/** Build a project-stats payload (the derived `completedPercentage` is overwritten by the producer). */
function makeStats(over: Partial<BacklogStats> = {}): BacklogStats {
  return {
    total_points: 100,
    defined_points: 100,
    closed_points: 0,
    assigned_points: 0,
    speed: 0,
    total_milestones: 1,
    completedPercentage: 0,
    ...over,
  } as BacklogStats;
}

/** A clean default state (alias for readability at call sites). */
function baseState(): BacklogState {
  return createInitialState();
}

/** Structural deep clone used by the immutability assertions. */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A realistic populated state built by running the REAL loading producers in
 * the same order the hook would. Used by the movement / selector / purity
 * suites so they exercise production-shaped data (shared sprint references,
 * derived maps, current sprint wiring).
 *
 * Layout:
 *   - project id 7
 *   - two OPEN sprints: s100 (Jan) holding us101, s200 (Feb) empty
 *   - nowMs = Jan 10 2021 -> `currentSprint` = s100 (its range brackets nowMs)
 *   - backlog user stories 1,2,3 (milestone null)
 *   - selection = [1]
 *   - forecasted = [us1]
 */
function seededState(): BacklogState {
  let s = createInitialState();
  s = setProject(s, makeProject({ id: 7 }));
  const s100 = makeSprint({
    id: 100,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-20',
    user_stories: [makeUs({ id: 101, milestone: 100, sprint_order: 1, total_points: 2 })],
  });
  const s200 = makeSprint({
    id: 200,
    estimated_start: '2021-02-01',
    estimated_finish: '2021-02-20',
    user_stories: [],
  });
  s = setSprints(s, { milestones: [s100, s200], closed: 0, open: 2, nowMs: parseYmdToMs('2021-01-10') });
  s = setUserstories(s, [
    makeUs({ id: 1, ref: 1, backlog_order: 1, total_points: 1 }),
    makeUs({ id: 2, ref: 2, backlog_order: 2, total_points: 2 }),
    makeUs({ id: 3, ref: 3, backlog_order: 3, total_points: 3 }),
  ]);
  s = setSelectedIds(s, [1]);
  s = setForecastedStories(s, [makeUs({ id: 1, ref: 1 })], true);
  return s;
}

/* ================================================================== *
 * Phase C — Factory & reset (defaults preservation)
 * ================================================================== */

describe('createInitialState / initialBacklogState — documented defaults', () => {
  it('guarantees the load-bearing view defaults', () => {
    const s = createInitialState();
    // showTags DEFAULTS TRUE (main.coffee:91) — critical parity, NOT false.
    expect(s.showTags).toBe(true);
    expect(s.activeFilters).toBe(false);
    expect(s.forecastNewSprint).toBe(true);
    expect(s.displayVelocity).toBe(false);
    expect(s.closedSprintsVisible).toBe(false);
    expect(s.page).toBe(1);
    expect(s.disablePagination).toBe(false);
    expect(s.firstLoadComplete).toBe(false);
    // F-CLS-01: starts false so the empty-sprint illustration is suppressed until
    // the first setSprints (prevents the empty-state flash / layout shift).
    expect(s.sprintsLoaded).toBe(false);
    expect(s.loadingUserstories).toBe(false);
    expect(s.noSwimlaneUserStories).toBe(false);
    expect(s.currentSprint).toBeNull();
    expect(s.showGraphPlaceholder).toBeNull();
  });

  it('initialises the filters and sprint-form slices to their canonical shape', () => {
    const s = createInitialState();
    expect(s.filters).toEqual({ query: '', selected: [], custom: [] });
    expect(s.sprintForm).toEqual({
      open: false,
      mode: 'create',
      values: { project: null, name: null, estimated_start: null, estimated_finish: null },
      lastSprintName: null,
      canDelete: false,
    });
  });

  it('initialises every collection empty', () => {
    const s = createInitialState();
    expect(s.userstories).toEqual([]);
    expect(s.visibleUserStories).toEqual([]);
    expect(s.sprints).toEqual([]);
    expect(s.closedSprints).toEqual([]);
    expect(s.forecastedStories).toEqual([]);
    expect(s.newUs).toEqual([]);
    // selectedIds is a number[] ARRAY (NOT a Set).
    // adjusted per backlogReducer.ts on disk: selection modelled as number[].
    expect(Array.isArray(s.selectedIds)).toBe(true);
    expect(s.selectedIds).toEqual([]);
    expect(s.sprintsById).toEqual({});
    expect(s.closedSprintsById).toEqual({});
    expect(s.sprintOpen).toEqual({});
    expect(s.backlogOrder).toEqual({});
    expect(s.milestonesOrder).toEqual({});
    expect(s.pendingDrag).toEqual([]);
    expect(s.stats).toBeNull();
    expect(s.project).toBeNull();
  });

  it('returns a FRESH object each call (no shared mutable state)', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    expect(a.userstories).not.toBe(b.userstories);
    // Mutating one result must not leak into another.
    a.userstories.push(makeUs({ id: 99 }));
    expect(b.userstories).toEqual([]);
  });

  it('initialBacklogState deep-equals a freshly built state', () => {
    expect(initialBacklogState).toEqual(createInitialState());
  });
});

describe('reset — carries over only the project context', () => {
  it('carries the project from prev when present', () => {
    const project = makeProject({ id: 42 });
    const next = reset({ project });
    expect(next.project).toBe(project);
    // Everything else is a clean default.
    const expected = createInitialState();
    expected.project = project;
    expect(next).toEqual(expected);
  });

  it('yields a clean default state when there is no prior context', () => {
    expect(reset()).toEqual(createInitialState());
    expect(reset({}).project).toBeNull();
  });
});

/* ================================================================== *
 * Phase D — Pure helpers (sorting / keying / summing / date math)
 * ================================================================== */

describe('sortByBacklogOrder / sortBySprintOrder — stable ascending, no mutation', () => {
  it('sortByBacklogOrder sorts ascending by backlog_order and returns a NEW array', () => {
    const input = [makeUs({ id: 3, backlog_order: 3 }), makeUs({ id: 1, backlog_order: 1 }), makeUs({ id: 2, backlog_order: 2 })];
    const originalOrder = input.map((u) => u.id);
    const out = sortByBacklogOrder(input);
    expect(out.map((u) => u.id)).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
    // Input array order is untouched.
    expect(input.map((u) => u.id)).toEqual(originalOrder);
  });

  it('sortByBacklogOrder is STABLE for equal keys (insertion order preserved)', () => {
    const input = [
      makeUs({ id: 10, backlog_order: 5 }),
      makeUs({ id: 11, backlog_order: 5 }),
      makeUs({ id: 12, backlog_order: 5 }),
    ];
    expect(sortByBacklogOrder(input).map((u) => u.id)).toEqual([10, 11, 12]);
  });

  it('sortBySprintOrder sorts ascending by sprint_order without mutating the input', () => {
    const input = [makeUs({ id: 2, sprint_order: 20 }), makeUs({ id: 1, sprint_order: 10 })];
    const out = sortBySprintOrder(input);
    expect(out.map((u) => u.id)).toEqual([1, 2]);
    expect(input.map((u) => u.id)).toEqual([2, 1]);
  });
});

describe('keyById — LAST-WINS single-object map (parity with utils.coffee:80-85)', () => {
  it('keys items by id', () => {
    const map = keyById([makeSprint({ id: 1 }), makeSprint({ id: 2 })]);
    expect(Object.keys(map).sort()).toEqual(['1', '2']);
    expect(map[1].id).toBe(1);
  });

  it('stores the LAST item on a duplicate id (a single object, NOT an array)', () => {
    const map = keyById([
      { id: 1, v: 'a' },
      { id: 1, v: 'b' },
    ]);
    expect(map[1]).toEqual({ id: 1, v: 'b' });
    expect(Array.isArray(map[1])).toBe(false);
  });
});

describe('sumBy — numeric projection', () => {
  it('sums the projected number', () => {
    expect(sumBy([{ p: 2 }, { p: 3 }, { p: 5 }], (x) => x.p)).toBe(10);
  });

  it('returns 0 for an empty list (safe identity)', () => {
    expect(sumBy([] as Array<{ p: number }>, (x) => x.p)).toBe(0);
  });
});

describe('date math — LOCAL, day-granularity (timezone-independent)', () => {
  it('parseYmdToMs parses to LOCAL midnight via new Date(y, m-1, d)', () => {
    // Compared to a locally-constructed Date so the assertion holds in any TZ.
    expect(parseYmdToMs('2021-03-23')).toBe(new Date(2021, 2, 23).getTime());
    // Month is 1-based in the string (March = -03-).
    expect(parseYmdToMs('2021-03-23')).not.toBe(new Date(2021, 3, 23).getTime());
  });

  it('formatMsToYmd is the inverse of parseYmdToMs (round-trip)', () => {
    expect(formatMsToYmd(parseYmdToMs('2021-03-23'))).toBe('2021-03-23');
    expect(formatMsToYmd(parseYmdToMs('2020-12-31'))).toBe('2020-12-31');
  });

  it('addWeeks adds weeks*7 days and returns YYYY-MM-DD', () => {
    expect(addWeeks('2021-01-01', 2)).toBe('2021-01-15');
    expect(addWeeks('2021-01-01', 0)).toBe('2021-01-01');
  });
});

/* ================================================================== *
 * Phase E — Selectors
 * ================================================================== */

describe('selectOpenSprints', () => {
  it('returns only non-closed sprints, preserving order', () => {
    const s = createInitialState();
    s.sprints = [makeSprint({ id: 1, closed: false }), makeSprint({ id: 2, closed: true }), makeSprint({ id: 3, closed: false })];
    expect(selectOpenSprints(s).map((sp) => sp.id)).toEqual([1, 3]);
  });

  it('returns empty when there are no open sprints', () => {
    const s = createInitialState();
    s.sprints = [makeSprint({ id: 2, closed: true })];
    expect(selectOpenSprints(s)).toEqual([]);
  });
});

describe('sprintTotalPoints — sums only stories still assigned to this sprint', () => {
  it('sums total_points of stories whose milestone === sprint.id', () => {
    const sprint = makeSprint({
      id: 10,
      user_stories: [
        makeUs({ id: 1, milestone: 10, total_points: 3 }),
        makeUs({ id: 2, milestone: 10, total_points: 5 }),
        // Belongs to another sprint -> excluded even though it lives in the list.
        makeUs({ id: 3, milestone: 99, total_points: 100 }),
      ],
    });
    expect(sprintTotalPoints(sprint)).toBe(8);
  });

  it('returns 0 for an empty sprint', () => {
    expect(sprintTotalPoints(makeSprint({ id: 10, user_stories: [] }))).toBe(0);
  });
});

describe('findCurrentSprint — injected nowMs, date-range bracketing', () => {
  const sprints = [
    makeSprint({ id: 1, estimated_start: '2021-01-01', estimated_finish: '2021-01-15' }),
    makeSprint({ id: 2, estimated_start: '2021-02-01', estimated_finish: '2021-02-15' }),
  ];

  it('returns the sprint whose [start, finish] range brackets nowMs', () => {
    const now = parseYmdToMs('2021-02-05');
    expect(findCurrentSprint(sprints, now)!.id).toBe(2);
  });

  it('includes the range boundaries (start and finish are inclusive)', () => {
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-01-01'))!.id).toBe(1);
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-01-15'))!.id).toBe(1);
  });

  it('returns null when no sprint brackets nowMs', () => {
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-03-01'))).toBeNull();
  });

  it('returns null for an empty sprint list', () => {
    expect(findCurrentSprint([], parseYmdToMs('2021-01-05'))).toBeNull();
  });
});

describe('selectLastSprint — latest-finishing OPEN sprint', () => {
  it('returns the open sprint with the latest estimated_finish', () => {
    const sprints = [
      makeSprint({ id: 1, estimated_finish: '2021-01-15' }),
      makeSprint({ id: 2, estimated_finish: '2021-03-15' }),
      makeSprint({ id: 3, estimated_finish: '2021-02-15' }),
    ];
    expect(selectLastSprint(sprints)!.id).toBe(2);
  });

  it('ignores closed sprints even if they finish later', () => {
    const sprints = [
      makeSprint({ id: 1, estimated_finish: '2021-01-15', closed: false }),
      makeSprint({ id: 2, estimated_finish: '2021-09-15', closed: true }),
    ];
    expect(selectLastSprint(sprints)!.id).toBe(1);
  });

  it('returns null when there are no open sprints', () => {
    expect(selectLastSprint([])).toBeNull();
    expect(selectLastSprint([makeSprint({ id: 1, closed: true })])).toBeNull();
  });
});

describe('computeCompletedPercentage — round(100*closed/total) with fallback + guard', () => {
  it('rounds closed_points / total_points to a percentage', () => {
    expect(computeCompletedPercentage(makeStats({ total_points: 100, closed_points: 30 }))).toBe(30);
    expect(computeCompletedPercentage(makeStats({ total_points: 3, closed_points: 1 }))).toBe(33);
  });

  it('falls back to defined_points when total_points is 0/falsy (|| fallback)', () => {
    // total_points is 0 (falsy) but defined_points is truthy -> uses defined_points.
    expect(computeCompletedPercentage(makeStats({ total_points: 0, defined_points: 50, closed_points: 25 }))).toBe(50);
  });

  it('guards against divide-by-zero: {0,0} -> 0 (no NaN/Infinity)', () => {
    const pct = computeCompletedPercentage(makeStats({ total_points: 0, defined_points: 0, closed_points: 10 }));
    expect(pct).toBe(0);
    expect(Number.isFinite(pct)).toBe(true);
  });
});

describe('buildCreateSprintDefaults — injected nowYmd, +2-week finish', () => {
  it('uses nowYmd for the start when there is no prior sprint', () => {
    const defaults = buildCreateSprintDefaults([], '2021-01-01');
    expect(defaults.estimated_start).toBe('2021-01-01');
    expect(defaults.estimated_finish).toBe('2021-01-15');
    expect(defaults.lastSprintName).toBeNull();
  });

  it('seeds the start from the last open sprint finish + its name', () => {
    const sprints = [
      makeSprint({ id: 1, name: 'Alpha', estimated_finish: '2021-05-10' }),
      makeSprint({ id: 2, name: 'Beta', estimated_finish: '2021-06-20' }),
    ];
    const defaults = buildCreateSprintDefaults(sprints, '2021-01-01');
    // Last (latest-finishing) sprint is Beta.
    expect(defaults.estimated_start).toBe('2021-06-20');
    expect(defaults.estimated_finish).toBe(addWeeks('2021-06-20', 2));
    expect(defaults.lastSprintName).toBe('Beta');
  });
});

/* ================================================================== *
 * Phase F — Loading / stats producers (return a NEW BacklogState;
 * the input state is never mutated).
 * ================================================================== */

describe('setUserstories', () => {
  it('sorts by backlog_order, derives visibleUserStories + backlogOrder, clears loading', () => {
    const state = createInitialState();
    const next = setUserstories(state, [
      makeUs({ id: 2, ref: 202, backlog_order: 2 }),
      makeUs({ id: 1, ref: 101, backlog_order: 1 }),
    ]);
    expect(next.userstories.map((u) => u.id)).toEqual([1, 2]);
    expect(next.visibleUserStories).toEqual([101, 202]);
    expect(next.backlogOrder).toEqual({ 1: 1, 2: 2 });
    expect(next.loadingUserstories).toBe(false);
    // Input untouched.
    expect(state.userstories).toEqual([]);
    expect(next).not.toBe(state);
  });

  it('appends by default and REPLACES when resetPagination is set', () => {
    let state = setUserstories(createInitialState(), [makeUs({ id: 1, backlog_order: 1 })]);
    // Append (no resetPagination).
    const appended = setUserstories(state, [makeUs({ id: 2, backlog_order: 2 })]);
    expect(appended.userstories.map((u) => u.id)).toEqual([1, 2]);
    // Replace.
    const replaced = setUserstories(state, [makeUs({ id: 9, backlog_order: 9 })], { resetPagination: true });
    expect(replaced.userstories.map((u) => u.id)).toEqual([9]);
  });

  it('honors hasNext (page++ and re-enables pagination) only when true', () => {
    const state = createInitialState(); // page = 1
    const withNext = setUserstories(state, [makeUs({ id: 1 })], { hasNext: true });
    expect(withNext.page).toBe(2);
    expect(withNext.disablePagination).toBe(false);
    const noNext = setUserstories(state, [makeUs({ id: 1 })], { hasNext: false });
    expect(noNext.page).toBe(1);
  });

  it('sets total and noSwimlane counts only when provided (!= null)', () => {
    const state = createInitialState();
    const opts: SetUserstoriesOptions = { total: 42, noSwimlane: true };
    const next = setUserstories(state, [makeUs({ id: 1 })], opts);
    expect(next.totalUserStories).toBe(42);
    expect(next.noSwimlaneUserStories).toBe(true);
    // Omitted -> unchanged from defaults.
    const bare = setUserstories(state, [makeUs({ id: 1 })]);
    expect(bare.totalUserStories).toBe(0);
    expect(bare.noSwimlaneUserStories).toBe(false);
  });

  it('flags stories whose id was marked new (deduped), leaving others untouched', () => {
    let state = markNewUs(createInitialState(), [2, 2]); // dedupe -> [2]
    expect(state.newUs).toEqual([2]);
    const next = setUserstories(state, [makeUs({ id: 1 }), makeUs({ id: 2 })]);
    expect(next.userstories.find((u) => u.id === 2)!.new).toBe(true);
    expect(next.userstories.find((u) => u.id === 1)!.new).toBeUndefined();
  });
});

describe('setSprints', () => {
  it('sorts stories, keys by id, sets counts, fold state and current sprint', () => {
    const state = createInitialState();
    const milestones = [
      makeSprint({
        id: 100,
        estimated_start: '2021-01-01',
        estimated_finish: '2021-01-20',
        user_stories: [makeUs({ id: 2, sprint_order: 2 }), makeUs({ id: 1, sprint_order: 1 })],
      }),
      makeSprint({ id: 200, closed: true, estimated_start: '2021-02-01', estimated_finish: '2021-02-20' }),
    ];
    const next = setSprints(state, { milestones, closed: 1, open: 1, nowMs: parseYmdToMs('2021-01-10') });
    // Array order preserved; per-sprint user_stories sorted by sprint_order.
    expect(next.sprints.map((sp) => sp.id)).toEqual([100, 200]);
    expect(next.sprints[0].user_stories.map((u) => u.id)).toEqual([1, 2]);
    // Counts.
    expect(next.totalOpenMilestones).toBe(1);
    expect(next.totalClosedMilestones).toBe(1);
    expect(next.totalMilestones).toBe(2);
    expect(next.sprintsCounter).toBe(2);
    // Lookup map + fold state.
    expect(next.sprintsById[100].id).toBe(100);
    expect(next.sprintOpen).toEqual({ 100: true, 200: false });
    // currentSprint via injected nowMs.
    expect(next.currentSprint!.id).toBe(100);
    // milestonesOrder populated.
    expect(next.milestonesOrder[100]).toEqual({ 1: 1, 2: 2 });
    // F-CLS-01: setSprints marks the list as loaded so the empty-state gate can act.
    expect(next.sprintsLoaded).toBe(true);
    // Input untouched.
    expect(state.sprints).toEqual([]);
  });

  it('does not mutate the incoming milestone objects', () => {
    const original = makeSprint({ id: 1, user_stories: [makeUs({ id: 2, sprint_order: 2 }), makeUs({ id: 1, sprint_order: 1 })] });
    const snapshot = deepClone(original);
    setSprints(createInitialState(), { milestones: [original], closed: 0, open: 1, nowMs: 0 });
    expect(original).toEqual(snapshot);
  });

  it('sets sprintsLoaded=true even for an empty project (F-CLS-01 load guard)', () => {
    const state = createInitialState();
    // Before the first load the guard is false -> empty illustration suppressed.
    expect(state.sprintsLoaded).toBe(false);
    // An empty project still fires setSprints (open + closed === 0); the flag must
    // flip so the empty-state can now render WITHOUT having flashed during load.
    const next = setSprints(state, { milestones: [], closed: 0, open: 0, nowMs: 0 });
    expect(next.sprintsLoaded).toBe(true);
    expect(next.totalMilestones).toBe(0);
  });
});

describe('setClosedSprints / unloadClosedSprints', () => {
  it('populates the closed collections with collapsed fold state', () => {
    const milestones = [makeSprint({ id: 300, closed: true })];
    const next = setClosedSprints(createInitialState(), { milestones, closed: 1 });
    expect(next.closedSprints.map((sp) => sp.id)).toEqual([300]);
    expect(next.closedSprintsById[300].id).toBe(300);
    expect(next.totalClosedMilestones).toBe(1);
    expect(next.sprintOpen[300]).toBe(false);
  });

  it('unloadClosedSprints clears the closed list and lookup map', () => {
    let s = setClosedSprints(createInitialState(), { milestones: [makeSprint({ id: 300, closed: true })], closed: 1 });
    const cleared = unloadClosedSprints(s);
    expect(cleared.closedSprints).toEqual([]);
    expect(cleared.closedSprintsById).toEqual({});
  });
});

describe('setProjectStats', () => {
  it('derives completedPercentage and hides the placeholder when data is complete', () => {
    const next = setProjectStats(createInitialState(), makeStats({ total_points: 100, closed_points: 40, total_milestones: 3 }));
    expect(next.stats!.completedPercentage).toBe(40);
    // Both total_points and total_milestones present -> placeholder false.
    expect(next.showGraphPlaceholder).toBe(false);
  });

  it('shows the placeholder when total_points or total_milestones is missing', () => {
    const missingMilestones = setProjectStats(createInitialState(), makeStats({ total_points: 100, total_milestones: undefined }));
    expect(missingMilestones.showGraphPlaceholder).toBe(true);
    const missingPoints = setProjectStats(createInitialState(), makeStats({ total_points: undefined, total_milestones: 3 }));
    expect(missingPoints.showGraphPlaceholder).toBe(true);
  });
});

describe('setProject / markNewUs', () => {
  it('setProject stores the resolved project', () => {
    const next = setProject(createInitialState(), makeProject({ id: 55 }));
    expect(next.project!.id).toBe(55);
  });

  it('markNewUs merges ids and dedupes across calls', () => {
    let s = markNewUs(createInitialState(), [1, 2]);
    s = markNewUs(s, [2, 3]);
    expect(s.newUs).toEqual([1, 2, 3]);
  });
});


/* ================================================================== *
 * Phase G — applyDrag: reorder WITHIN a single container
 * (reproduces the after-precedence head-insert bug, main.coffee:591)
 * ================================================================== */

/** A three-story backlog (all milestone null) used by the reorder suites. */
function threeStoryBacklog(): BacklogState {
  return setUserstories(createInitialState(), [
    makeUs({ id: 1, ref: 1, backlog_order: 1 }),
    makeUs({ id: 2, ref: 2, backlog_order: 2 }),
    makeUs({ id: 3, ref: 3, backlog_order: 3 }),
  ]);
}

describe('applyDrag — same-container reorder (after-precedence)', () => {
  it('returns { state, payload } with a BacklogMovePayload; bulkUserstories is a number[] of ids', () => {
    const state = threeStoryBacklog();
    const drag: DragResult = { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true };
    const result: BacklogMoveResult = applyDrag(state, drag);
    const payload = result.payload as BacklogMovePayload;
    expect(payload).not.toBeNull();
    expect(payload.projectId).toBe(7);
    expect(payload.milestoneId).toBeNull(); // backlog reorder -> milestone stays null
    expect(payload.afterUserstoryId).toBe(1);
    expect(payload.beforeUserstoryId).toBeNull();
    // bulkUserstories is a number[] of moved ids, never { us_id, order } objects.
    expect(payload.bulkUserstories).toEqual([3]);
    expect(Array.isArray(payload.bulkUserstories)).toBe(true);
    payload.bulkUserstories.forEach((id) => expect(typeof id).toBe('number'));
  });

  it('with previousUs set, inserts the moved story immediately AFTER previousUs', () => {
    const state = threeStoryBacklog();
    const drag: DragResult = { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true };
    const result = applyDrag(state, drag);
    // [1,2,3] -> remove 3 -> [1,2] -> insert after id 1 (index 0 + 1) -> [1,3,2].
    expect(result.state.userstories.map((u) => u.id)).toEqual([1, 3, 2]);
    expect(result.state.visibleUserStories).toEqual([1, 3, 2]);
  });

  it('with only nextUs set, inserts at the HEAD (reproduces after-precedence bug main.coffee:591 — nextUs branch inserts at head)', () => {
    const state = threeStoryBacklog();
    // Drop "before id 2" (previousUs null, nextUs 2). A correct impl would land
    // the story at index 1 ([1,3,2]); the reproduced source bug lands it at the
    // HEAD instead because the else-if branch reads previousUs (null) -> -1 -> +1 -> 0.
    const drag: DragResult = { movedIds: [3], targetSprintId: null, index: 0, previousUs: null, nextUs: 2, isBacklog: true };
    const result = applyDrag(state, drag);
    expect(result.state.userstories.map((u) => u.id)).toEqual([3, 1, 2]); // HEAD, NOT adjacent to nextUs
    // The payload still faithfully forwards the adjacency the DnD layer computed.
    expect(result.payload!.beforeUserstoryId).toBe(2);
    expect(result.payload!.afterUserstoryId).toBeNull();
  });

  it('does NOT mutate the input state (immer freeze / new object)', () => {
    const state = threeStoryBacklog();
    const snapshot = deepClone(state);
    const result = applyDrag(state, { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true });
    expect(result.state).not.toBe(state);
    expect(state).toEqual(snapshot); // original graph untouched
  });
});

/* ================================================================== *
 * Phase H — applyDrag: cross-container (backlog <-> sprint, sprint <-> sprint)
 * ================================================================== */

describe('applyDrag — cross-container moves', () => {
  it('backlog -> sprint: removes from backlog, sets milestone, inserts into the sprint at newUsIndex', () => {
    // One backlog story + one target open sprint.
    let state = createInitialState();
    state = setProject(state, makeProject({ id: 7 }));
    state = setSprints(state, { milestones: [makeSprint({ id: 500, user_stories: [] })], closed: 0, open: 1, nowMs: 0 });
    state = setUserstories(state, [makeUs({ id: 1, ref: 1, milestone: null, project: 7 })]);

    const drag: DragResult = { movedIds: [1], targetSprintId: 500, index: 0, previousUs: null, nextUs: null, isBacklog: false };
    const result = applyDrag(state, drag);

    // Removed from backlog.
    expect(result.state.userstories.map((u) => u.id)).toEqual([]);
    // Inserted into target sprint with milestone reassigned.
    const target = result.state.sprints.find((sp) => sp.id === 500)!;
    expect(target.user_stories.map((u) => u.id)).toEqual([1]);
    expect(target.user_stories[0].milestone).toBe(500);
    // payload.milestoneId is the destination sprint id (newSprintId !== oldSprintId).
    expect(result.payload!.milestoneId).toBe(500);
    expect(result.payload!.bulkUserstories).toEqual([1]);
    // Input untouched.
    expect(state.userstories.map((u) => u.id)).toEqual([1]);
  });

  it('sprint -> backlog: removes from sprint, splices into the backlog, leaves milestone unchanged optimistically', () => {
    let state = createInitialState();
    state = setProject(state, makeProject({ id: 7 }));
    state = setSprints(state, {
      milestones: [makeSprint({ id: 500, user_stories: [makeUs({ id: 1, milestone: 500, project: 7 })] })],
      closed: 0,
      open: 1,
      nowMs: 0,
    });
    state = setUserstories(state, [makeUs({ id: 9, ref: 9, backlog_order: 9 })]);

    const drag: DragResult = { movedIds: [1], targetSprintId: null, index: 0, previousUs: null, nextUs: null, isBacklog: true };
    const result = applyDrag(state, drag);

    // Removed from the sprint...
    expect(result.state.sprints.find((sp) => sp.id === 500)!.user_stories.map((u) => u.id)).toEqual([]);
    // ...and spliced into the backlog at index 0.
    expect(result.state.userstories.map((u) => u.id)).toEqual([1, 9]);
    // Source only reassigns milestone on the API result (applyMoveResult), so it
    // stays 500 optimistically; the payload targets the backlog (null).
    expect(result.state.userstories.find((u) => u.id === 1)!.milestone).toBe(500);
    expect(result.payload!.milestoneId).toBeNull();
  });

  it('sprint -> sprint: moves the story between sprints and updates its milestone', () => {
    let state = createInitialState();
    state = setProject(state, makeProject({ id: 7 }));
    state = setSprints(state, {
      milestones: [
        makeSprint({ id: 500, user_stories: [makeUs({ id: 1, milestone: 500, project: 7 })] }),
        makeSprint({ id: 600, user_stories: [] }),
      ],
      closed: 0,
      open: 2,
      nowMs: 0,
    });

    const drag: DragResult = { movedIds: [1], targetSprintId: 600, index: 0, previousUs: null, nextUs: null, isBacklog: false };
    const result = applyDrag(state, drag);

    expect(result.state.sprints.find((sp) => sp.id === 500)!.user_stories.map((u) => u.id)).toEqual([]);
    const dest = result.state.sprints.find((sp) => sp.id === 600)!;
    expect(dest.user_stories.map((u) => u.id)).toEqual([1]);
    expect(dest.user_stories[0].milestone).toBe(600);
    expect(result.payload!.milestoneId).toBe(600);
  });

  it('resolves a moved story that lives in a CLOSED sprint (closed-sprint -> backlog)', () => {
    // Exercises the closed-sprint search branch in resolveMovedUserStories and
    // the closed-sprint lookup in findSprintInArrays.
    let state = createInitialState();
    state = setProject(state, makeProject({ id: 7 }));
    state = setClosedSprints(state, {
      milestones: [makeSprint({ id: 900, closed: true, user_stories: [makeUs({ id: 901, milestone: 900, project: 7 })] })],
      closed: 1,
    });
    const drag: DragResult = { movedIds: [901], targetSprintId: null, index: 0, previousUs: null, nextUs: null, isBacklog: true };
    const result = applyDrag(state, drag);
    // Removed from the closed sprint, spliced into the backlog.
    expect(result.state.closedSprints.find((sp) => sp.id === 900)!.user_stories.map((u) => u.id)).toEqual([]);
    expect(result.state.userstories.map((u) => u.id)).toEqual([901]);
    // Moving out of a (closed) sprint into the backlog -> payload targets backlog (null).
    expect(result.payload!.milestoneId).toBeNull();
  });
});

/* ================================================================== *
 * Phase I — applyDrag: no-op & purity
 * ================================================================== */

describe('applyDrag — no-op & purity', () => {
  it('returns { state: <same ref>, payload: null } when no moved id resolves', () => {
    const state = threeStoryBacklog();
    const drag: DragResult = { movedIds: [999], targetSprintId: null, index: 0, previousUs: null, nextUs: null, isBacklog: true };
    const result = applyDrag(state, drag);
    expect(result.payload).toBeNull();
    // No mutation occurred -> immer returns the ORIGINAL reference.
    expect(result.state).toBe(state);
  });

  it('never throws on a frozen input and never mutates the input arrays/objects', () => {
    // A state produced by immer is deeply frozen; a stray mutation would throw.
    const state = seededState();
    const snapshot = deepClone(state);
    expect(() =>
      applyDrag(state, { movedIds: [1], targetSprintId: 100, index: 0, previousUs: null, nextUs: null, isBacklog: false }),
    ).not.toThrow();
    expect(state).toEqual(snapshot);
  });
});

/* ================================================================== *
 * Phase J — moveToCurrentSprint / moveToLatestSprint
 * (reproduces the sprints[0].id milestone-target quirk, main.coffee:799)
 * ================================================================== */

/**
 * Build a state with TWO open sprints where `currentSprint` (id 200) is NOT
 * `sprints[0]` (id 100), plus two selected backlog stories. This is the exact
 * arrangement that exposes the `sprints[0].id` quirk.
 */
function moveToSprintState(): BacklogState {
  let s = createInitialState();
  s = setProject(s, makeProject({ id: 7 }));
  const s100 = makeSprint({ id: 100, estimated_start: '2021-01-01', estimated_finish: '2021-01-20', total_points: 0 });
  const s200 = makeSprint({ id: 200, estimated_start: '2021-02-01', estimated_finish: '2021-02-20', total_points: 0 });
  // nowMs in Feb -> currentSprint = s200 (id 200), while sprints[0] = s100 (id 100).
  s = setSprints(s, { milestones: [s100, s200], closed: 0, open: 2, nowMs: parseYmdToMs('2021-02-05') });
  s = setUserstories(s, [
    makeUs({ id: 11, ref: 11, backlog_order: 1, sprint_order: 5, total_points: 3 }),
    makeUs({ id: 12, ref: 12, backlog_order: 2, sprint_order: 6, total_points: 4 }),
  ]);
  s = setSelectedIds(s, [11, 12]);
  return s;
}

describe('moveToCurrentSprint', () => {
  it('unions the selection into currentSprint, bumps its points, and clears the selection', () => {
    const state = moveToSprintState();
    expect(state.currentSprint!.id).toBe(200); // precondition
    const result: BacklogMoveToSprintResult = moveToCurrentSprint(state);

    // Stories moved out of the backlog into the CURRENT sprint (id 200) locally.
    expect(result.state.userstories.map((u) => u.id)).toEqual([]);
    const dest = result.state.sprints.find((sp) => sp.id === 200)!;
    expect(dest.user_stories.map((u) => u.id)).toEqual([11, 12]);
    // total_points bumped by the sum of moved stories (3 + 4).
    expect(dest.total_points).toBe(7);
    // Selection reset.
    expect(result.state.selectedIds).toEqual([]);
  });

  it('QUIRK: payload.milestoneId is ALWAYS sprints[0].id, not the current sprint id (main.coffee:799 — bulkUpdateMilestone always targets sprints[0].id)', () => {
    const state = moveToSprintState();
    const result = moveToCurrentSprint(state);
    expect(state.sprints[0].id).toBe(100); // precondition
    expect(result.payload).not.toBeNull();
    expect(result.payload!.milestoneId).toBe(100); // sprints[0].id, NOT currentSprint (200)
    expect(result.payload!.projectId).toBe(7);
  });

  it('payload.bulkStories is [{ us_id, order }] using each story sprint_order', () => {
    const state = moveToSprintState();
    const result = moveToCurrentSprint(state);
    expect(result.payload!.bulkStories).toStrictEqual([
      { us_id: 11, order: 5 },
      { us_id: 12, order: 6 },
    ]);
  });

  it('does not mutate the input state', () => {
    const state = moveToSprintState();
    const snapshot = deepClone(state);
    moveToCurrentSprint(state);
    expect(state).toEqual(snapshot);
  });

  it('is a no-op (payload null, same state ref) when nothing is selected', () => {
    let state = moveToSprintState();
    state = setSelectedIds(state, []);
    const result = moveToCurrentSprint(state);
    expect(result.payload).toBeNull();
    expect(result.state).toBe(state);
  });

  it('is a no-op when there is neither a current sprint nor any sprint', () => {
    const state = createInitialState();
    const result = moveToCurrentSprint(state);
    expect(result.payload).toBeNull();
    // No mutation occurred -> immer returns the ORIGINAL reference.
    expect(result.state).toBe(state);
  });

  it('is a no-op when sprints/current exist and a selection is set but the project is not yet resolved', () => {
    // Realistic load-order edge: sprints (and currentSprint) are loaded and a
    // story is selected before the project has been resolved. applyMoveToSprint
    // bails on the missing project, so the move is a no-op.
    let state = createInitialState();
    state = setSprints(state, {
      milestones: [makeSprint({ id: 100, estimated_start: '2021-01-01', estimated_finish: '2021-01-20' })],
      closed: 0,
      open: 1,
      nowMs: parseYmdToMs('2021-01-10'),
    });
    state = setUserstories(state, [makeUs({ id: 1, ref: 1 })]);
    state = setSelectedIds(state, [1]);
    expect(state.project).toBeNull(); // precondition
    const result = moveToCurrentSprint(state);
    expect(result.payload).toBeNull();
    // Selection is untouched because the producer returned before mutating.
    expect(result.state.selectedIds).toEqual([1]);
  });
});

describe('moveToLatestSprint', () => {
  it('targets sprints[0] and returns the bulkUpdateMilestone payload', () => {
    const state = moveToSprintState();
    const result = moveToLatestSprint(state);
    // Optimistic union targets sprints[0] (id 100).
    const dest = result.state.sprints.find((sp) => sp.id === 100)!;
    expect(dest.user_stories.map((u) => u.id)).toEqual([11, 12]);
    expect(result.payload!.milestoneId).toBe(100);
    expect(result.payload!.bulkStories).toStrictEqual([
      { us_id: 11, order: 5 },
      { us_id: 12, order: 6 },
    ]);
    expect(result.state.selectedIds).toEqual([]);
  });

  it('is a no-op (payload null, same state ref) when there are no sprints', () => {
    let state = setSelectedIds(createInitialState(), [11]);
    const result = moveToLatestSprint(state);
    expect(result.payload).toBeNull();
    expect(result.state).toBe(state);
  });
});


/* ================================================================== *
 * Phase K — Toggle / filter / selection / fold / sprint-form producers
 * ================================================================== */

describe('view toggles', () => {
  it('toggleShowTags flips showTags (true -> false -> true)', () => {
    const s0 = createInitialState(); // showTags defaults true
    const s1 = toggleShowTags(s0);
    expect(s1.showTags).toBe(false);
    expect(s0.showTags).toBe(true); // input untouched
    expect(toggleShowTags(s1).showTags).toBe(true);
  });

  it('toggleActiveFilters flips the filters-sidebar flag', () => {
    const s1 = toggleActiveFilters(createInitialState());
    expect(s1.activeFilters).toBe(true);
    expect(toggleActiveFilters(s1).activeFilters).toBe(false);
  });

  it('toggleClosedSprintsVisible flips the closed-sprints visibility flag', () => {
    const s1 = toggleClosedSprintsVisible(createInitialState());
    expect(s1.closedSprintsVisible).toBe(true);
    expect(toggleClosedSprintsVisible(s1).closedSprintsVisible).toBe(false);
  });
});

describe('velocity forecasting', () => {
  it('setForecastedStories stores the stories and the forecastNewSprint flag', () => {
    // adjusted per backlogReducer.ts on disk: setForecastedStories takes THREE args
    // (state, stories, forecastNewSprint).
    const stories = [makeUs({ id: 1, ref: 1 }), makeUs({ id: 2, ref: 2 })];
    const next = setForecastedStories(createInitialState(), stories, false);
    expect(next.forecastedStories.map((u) => u.id)).toEqual([1, 2]);
    expect(next.forecastNewSprint).toBe(false);
  });

  it('toggleVelocityForecasting RECOMPUTES the forecast on toggle-ON, then rebuilds visibleUserStories (#17)', () => {
    // Legacy `toggleVelocityForecasting` (main.coffee:250) calls
    // `calculateForecasting()` before rebuilding the visible list, so a stale
    // `forecastedStories` set beforehand must be IGNORED and recomputed fresh.
    let s = setUserstories(createInitialState(), [makeUs({ id: 1, ref: 10 }), makeUs({ id: 2, ref: 20 })]);
    // Seed a deliberately-stale forecast that the toggle must overwrite.
    s = setForecastedStories(s, [makeUs({ id: 3, ref: 30 })], true);
    // OFF -> ON: forecast is recomputed from userstories (speed 0, no sprints) ->
    // every story forecast, so visibleUserStories == all userstory refs.
    const on = toggleVelocityForecasting(s);
    expect(on.displayVelocity).toBe(true);
    expect(on.forecastedStories.map((u) => u.ref)).toEqual([10, 20]);
    expect(on.visibleUserStories).toEqual([10, 20]);
    // No sprints -> forecastNewSprint stays true (nothing sets it false).
    expect(on.forecastNewSprint).toBe(true);
    // ON -> OFF: visibleUserStories comes back from userstories.
    const off = toggleVelocityForecasting(on);
    expect(off.displayVelocity).toBe(false);
    expect(off.visibleUserStories).toEqual([10, 20]);
  });

  /* ------------------------------------------------------------------ *
   * calculateForecasting — velocity accumulation math (finding #17).
   * Reproduces `calculateForecasting` (main.coffee:444-467) exactly.
   * ------------------------------------------------------------------ */
  describe('calculateForecasting (#17)', () => {
    it('with speed 0 (every seeded project): forecasts EVERY story, forecastNewSprint false when sprints exist', () => {
      let s = setUserstories(createInitialState(), [
        makeUs({ id: 1, ref: 1, total_points: 3 }),
        makeUs({ id: 2, ref: 2, total_points: 5 }),
        makeUs({ id: 3, ref: 3, total_points: 8 }),
      ]);
      s = setSprints(s, {
        milestones: [makeSprint({ id: 100, user_stories: [] })],
        closed: 0,
        open: 1,
        nowMs: parseYmdToMs('2021-01-10'),
      });
      s = setProjectStats(s, makeStats({ speed: 0 }));
      const { forecastedStories, forecastNewSprint } = calculateForecasting(s);
      // speed 0 -> guard `speed > 0` never fires -> no break -> all stories.
      expect(forecastedStories.map((u) => u.ref)).toEqual([1, 2, 3]);
      // sprints exist AND not over-capacity (speed 0) -> forecastNewSprint false.
      expect(forecastNewSprint).toBe(false);
    });

    it('no sprints -> forecastNewSprint stays true and all stories forecast (speed 0)', () => {
      const s = setUserstories(createInitialState(), [
        makeUs({ id: 1, ref: 1, total_points: 2 }),
        makeUs({ id: 2, ref: 2, total_points: 4 }),
      ]);
      const { forecastedStories, forecastNewSprint } = calculateForecasting(s);
      expect(forecastedStories.map((u) => u.ref)).toEqual([1, 2]);
      expect(forecastNewSprint).toBe(true);
    });

    it('speed > 0: STOPS accumulating once backlogPointsSum exceeds speed (break)', () => {
      // No sprints -> backlogPointsSum starts at 0. speed = 6.
      //   us1 (+3) -> sum 3, push, 3 !> 6
      //   us2 (+5) -> sum 8, push, 8 > 6 -> BREAK (us3 never forecast)
      let s = setUserstories(createInitialState(), [
        makeUs({ id: 1, ref: 1, total_points: 3 }),
        makeUs({ id: 2, ref: 2, total_points: 5 }),
        makeUs({ id: 3, ref: 3, total_points: 8 }),
      ]);
      s = setProjectStats(s, makeStats({ speed: 6 }));
      const { forecastedStories, forecastNewSprint } = calculateForecasting(s);
      expect(forecastedStories.map((u) => u.ref)).toEqual([1, 2]);
      // No sprints -> forecastNewSprint never set false.
      expect(forecastNewSprint).toBe(true);
    });

    it('speed > 0 AND first sprint already over capacity: resets running sum to 0 and forecasts a NEW sprint', () => {
      // First sprint carries 10 points; speed 6 -> 10 > 6 -> sum reset to 0,
      // forecastNewSprint stays TRUE. Then us accumulation restarts from 0:
      //   us1 (+3) -> 3 !> 6 ; us2 (+5) -> 8 > 6 -> break after us2.
      const sprint = makeSprint({
        id: 100,
        user_stories: [makeUs({ id: 9, ref: 9, milestone: 100, total_points: 10 })],
      });
      let s = setSprints(createInitialState(), {
        milestones: [sprint],
        closed: 0,
        open: 1,
        nowMs: parseYmdToMs('2021-01-10'),
      });
      s = setUserstories(s, [
        makeUs({ id: 1, ref: 1, total_points: 3 }),
        makeUs({ id: 2, ref: 2, total_points: 5 }),
        makeUs({ id: 3, ref: 3, total_points: 8 }),
      ]);
      s = setProjectStats(s, makeStats({ speed: 6 }));
      const { forecastedStories, forecastNewSprint } = calculateForecasting(s);
      expect(forecastNewSprint).toBe(true);
      expect(forecastedStories.map((u) => u.ref)).toEqual([1, 2]);
    });

    it('speed > 0 AND first sprint within capacity: seeds the running sum and does NOT forecast a new sprint', () => {
      // First sprint carries 2 points; speed 10 -> 2 !> 10 -> forecastNewSprint
      // false, running sum SEEDED at 2. Then:
      //   us1 (+3) -> 5 !> 10 ; us2 (+5) -> 10 !> 10 ; us3 (+8) -> 18 > 10 -> break.
      const sprint = makeSprint({
        id: 100,
        user_stories: [makeUs({ id: 9, ref: 9, milestone: 100, total_points: 2 })],
      });
      let s = setSprints(createInitialState(), {
        milestones: [sprint],
        closed: 0,
        open: 1,
        nowMs: parseYmdToMs('2021-01-10'),
      });
      s = setUserstories(s, [
        makeUs({ id: 1, ref: 1, total_points: 3 }),
        makeUs({ id: 2, ref: 2, total_points: 5 }),
        makeUs({ id: 3, ref: 3, total_points: 8 }),
      ]);
      s = setProjectStats(s, makeStats({ speed: 10 }));
      const { forecastedStories, forecastNewSprint } = calculateForecasting(s);
      expect(forecastNewSprint).toBe(false);
      // seeded sum 2: +3=5, +5=10, +8=18>10 -> stories 1,2,3 all pushed (break AFTER push of the one that exceeds).
      expect(forecastedStories.map((u) => u.ref)).toEqual([1, 2, 3]);
    });

    it('empty userstories -> empty forecast', () => {
      const { forecastedStories, forecastNewSprint } = calculateForecasting(createInitialState());
      expect(forecastedStories).toEqual([]);
      expect(forecastNewSprint).toBe(true);
    });
  });

  it('setProjectStats recomputes forecastedStories from current stats/userstories (loadProjectStats parity, #17)', () => {
    // Reproduces `loadProjectStats` -> `calculateForecasting` (main.coffee:267).
    let s = setUserstories(createInitialState(), [
      makeUs({ id: 1, ref: 1, total_points: 4 }),
      makeUs({ id: 2, ref: 2, total_points: 6 }),
    ]);
    expect(s.forecastedStories).toEqual([]);
    s = setProjectStats(s, makeStats({ speed: 0 }));
    // speed 0 -> all stories forecast even without a toggle.
    expect(s.forecastedStories.map((u) => u.ref)).toEqual([1, 2]);
  });

  it('setProjectStats refreshes visibleUserStories when velocity is already being displayed (#17)', () => {
    let s = setUserstories(createInitialState(), [
      makeUs({ id: 1, ref: 1, total_points: 4 }),
      makeUs({ id: 2, ref: 2, total_points: 6 }),
    ]);
    // Turn velocity ON first (recomputes forecast -> visible = [1,2]).
    s = toggleVelocityForecasting(s);
    expect(s.displayVelocity).toBe(true);
    // A fresh stats load while displaying velocity refreshes the visible list.
    s = setProjectStats(s, makeStats({ speed: 0 }));
    expect(s.visibleUserStories).toEqual([1, 2]);
  });
});

describe('filters & selection', () => {
  it('setFilterQuery sets filters.query without touching the rest of the slice', () => {
    const next = setFilterQuery(createInitialState(), 'bug');
    expect(next.filters.query).toBe('bug');
    expect(next.filters.selected).toEqual([]);
  });

  it('setFilters merges a partial filter change', () => {
    const patch: Partial<BacklogFilters> = { selected: [{ id: 1 }] };
    const next = setFilters(createInitialState(), patch);
    expect(next.filters.selected).toEqual([{ id: 1 }]);
    expect(next.filters.query).toBe(''); // untouched
  });

  it('setSelectedIds replaces the whole selection', () => {
    const next = setSelectedIds(createInitialState(), [5, 6, 7]);
    expect(next.selectedIds).toEqual([5, 6, 7]);
  });

  it('toggleSelectedId adds when absent and removes when present (both directions)', () => {
    const added = toggleSelectedId(createInitialState(), 5);
    expect(added.selectedIds).toContain(5);
    const removed = toggleSelectedId(added, 5);
    expect(removed.selectedIds).not.toContain(5);
    expect(removed.selectedIds).toEqual([]);
  });
});

describe('toggleSprintFold', () => {
  it('flips sprintOpen[id]: open -> collapsed and back', () => {
    // setSprints seeds sprintOpen[10] = true (open sprint expanded).
    let s = setSprints(createInitialState(), { milestones: [makeSprint({ id: 10 })], closed: 0, open: 1, nowMs: 0 });
    expect(s.sprintOpen[10]).toBe(true);
    const folded = toggleSprintFold(s, 10);
    expect(folded.sprintOpen[10]).toBe(false);
    expect(toggleSprintFold(folded, 10).sprintOpen[10]).toBe(true);
  });

  it('treats an unknown sprint id as false -> true on first toggle', () => {
    const next = toggleSprintFold(createInitialState(), 999);
    expect(next.sprintOpen[999]).toBe(true);
  });
});

describe('sprint add/edit form', () => {
  it('openSprintFormCreate opens create mode and seeds default dates from buildCreateSprintDefaults', () => {
    const next = openSprintFormCreate(createInitialState(), { projectId: 7, nowYmd: '2021-01-01' });
    expect(next.sprintForm.open).toBe(true);
    expect(next.sprintForm.mode).toBe('create');
    expect(next.sprintForm.canDelete).toBe(false);
    expect(next.sprintForm.values.project).toBe(7);
    expect(next.sprintForm.values.name).toBeNull();
    expect(next.sprintForm.values.estimated_start).toBe('2021-01-01');
    expect(next.sprintForm.values.estimated_finish).toBe('2021-01-15');
    expect(next.sprintForm.lastSprintName).toBeNull();
  });

  it('openSprintFormCreate seeds the start from the last sprint finish + name when sprints exist', () => {
    let s = setSprints(createInitialState(), {
      milestones: [makeSprint({ id: 1, name: 'Prev', estimated_finish: '2021-04-10' })],
      closed: 0,
      open: 1,
      nowMs: 0,
    });
    const next = openSprintFormCreate(s, { projectId: 7, nowYmd: '2021-01-01' });
    expect(next.sprintForm.values.estimated_start).toBe('2021-04-10');
    expect(next.sprintForm.values.estimated_finish).toBe(addWeeks('2021-04-10', 2));
    expect(next.sprintForm.lastSprintName).toBe('Prev');
  });

  it('openSprintFormEdit opens edit mode with the sprint values (incl id) and injected canDelete', () => {
    const sprint = makeSprint({ id: 42, name: 'Sprint 42', project: 7, estimated_start: '2021-03-01', estimated_finish: '2021-03-15' });
    const next = openSprintFormEdit(createInitialState(), { sprint, canDelete: true });
    expect(next.sprintForm.open).toBe(true);
    expect(next.sprintForm.mode).toBe('edit');
    expect(next.sprintForm.canDelete).toBe(true);
    expect(next.sprintForm.values).toEqual({
      project: 7,
      name: 'Sprint 42',
      estimated_start: '2021-03-01',
      estimated_finish: '2021-03-15',
      id: 42,
    });
    expect(next.sprintForm.lastSprintName).toBeNull();
  });

  it('closeSprintForm resets the form to its closed defaults', () => {
    let s = openSprintFormCreate(createInitialState(), { projectId: 7, nowYmd: '2021-01-01' });
    const closed = closeSprintForm(s);
    expect(closed.sprintForm).toEqual(createInitialState().sprintForm);
  });

  it('setSprintFormValues merges partial field updates', () => {
    let s = openSprintFormCreate(createInitialState(), { projectId: 7, nowYmd: '2021-01-01' });
    const values: Partial<SprintFormValues> = { name: 'My Sprint' };
    const next = setSprintFormValues(s, values);
    expect(next.sprintForm.values.name).toBe('My Sprint');
    // Other seeded values remain.
    expect(next.sprintForm.values.project).toBe(7);
    expect(next.sprintForm.values.estimated_start).toBe('2021-01-01');
  });
});

describe('removeSprint / upsertSprint', () => {
  function twoOpenSprints(): BacklogState {
    return setSprints(createInitialState(), {
      milestones: [makeSprint({ id: 1 }), makeSprint({ id: 2 })],
      closed: 0,
      open: 2,
      nowMs: 0,
    });
  }

  it('removeSprint drops the sprint from the list, the map, fold state and decrements totals', () => {
    const state = twoOpenSprints();
    const next = removeSprint(state, 1);
    expect(next.sprints.map((sp) => sp.id)).toEqual([2]);
    expect(next.sprintsById[1]).toBeUndefined();
    expect(next.sprintOpen[1]).toBeUndefined();
    expect(next.totalOpenMilestones).toBe(1);
    expect(next.totalMilestones).toBe(1);
    expect(next.sprintsCounter).toBe(1);
  });

  it('removeSprint clears currentSprint when the removed sprint was the current one', () => {
    // nowMs inside sprint 1's default range -> currentSprint = sprint 1.
    let state = setSprints(createInitialState(), {
      milestones: [makeSprint({ id: 1, estimated_start: '2021-01-01', estimated_finish: '2021-01-20' })],
      closed: 0,
      open: 1,
      nowMs: parseYmdToMs('2021-01-10'),
    });
    expect(state.currentSprint!.id).toBe(1);
    const next = removeSprint(state, 1);
    expect(next.currentSprint).toBeNull();
  });

  it('upsertSprint replaces an existing sprint by id (no total change)', () => {
    const state = twoOpenSprints();
    const replacement = makeSprint({ id: 1, name: 'Renamed', total_points: 99 });
    const next = upsertSprint(state, replacement);
    expect(next.sprints.map((sp) => sp.id)).toEqual([1, 2]);
    expect(next.sprints.find((sp) => sp.id === 1)!.name).toBe('Renamed');
    expect(next.sprintsById[1].total_points).toBe(99);
    expect(next.totalOpenMilestones).toBe(2); // unchanged
  });

  it('upsertSprint pushes a new sprint and increments totals + counter', () => {
    const state = twoOpenSprints();
    const next = upsertSprint(state, makeSprint({ id: 3, name: 'New' }));
    expect(next.sprints.map((sp) => sp.id)).toEqual([1, 2, 3]);
    expect(next.sprintOpen[3]).toBe(true);
    expect(next.totalOpenMilestones).toBe(3);
    expect(next.totalMilestones).toBe(3);
    expect(next.sprintsCounter).toBe(3);
  });

  it('removeSprint drops a CLOSED sprint and decrements the closed total', () => {
    let state = setClosedSprints(createInitialState(), {
      milestones: [makeSprint({ id: 900, closed: true })],
      closed: 1,
    });
    // totalMilestones is only bumped by setSprints; seed it so the decrement is observable.
    state = setSprints(state, { milestones: [], closed: 1, open: 0, nowMs: 0 });
    const next = removeSprint(state, 900);
    expect(next.closedSprints.map((sp) => sp.id)).toEqual([]);
    expect(next.closedSprintsById[900]).toBeUndefined();
    expect(next.totalClosedMilestones).toBe(0);
  });
});

describe('applyMoveResult — post-API reconciliation', () => {
  it('updates milestone + backlog_order for each returned entry', () => {
    let state = createInitialState();
    state = setUserstories(state, [makeUs({ id: 1, milestone: null, backlog_order: 1 }), makeUs({ id: 2, milestone: null, backlog_order: 2 })]);
    const updated: BacklogMoveResultEntry[] = [{ id: 1, milestone: 500, backlog_order: 9 }];
    const next = applyMoveResult(state, updated);
    const us1 = next.userstories.find((u) => u.id === 1)!;
    expect(us1.milestone).toBe(500);
    expect(us1.backlog_order).toBe(9);
    // Untouched story stays as-is.
    expect(next.userstories.find((u) => u.id === 2)!.milestone).toBeNull();
    // Input untouched.
    expect(state.userstories.find((u) => u.id === 1)!.milestone).toBeNull();
  });
});

/* ================================================================== *
 * Phase L — Optional discriminated-union dispatcher backlogReducer
 * ================================================================== */

describe('backlogReducer dispatcher', () => {
  it('delegates a plain-state producer (TOGGLE_SHOW_TAGS)', () => {
    const s0 = createInitialState();
    const next = backlogReducer(s0, { type: 'TOGGLE_SHOW_TAGS' });
    expect(next.showTags).toBe(false);
  });

  it('delegates a payload-carrying producer (SET_SPRINTS)', () => {
    const action: BacklogAction = {
      type: 'SET_SPRINTS',
      milestones: [makeSprint({ id: 10 })],
      closed: 0,
      open: 1,
      nowMs: parseYmdToMs('2021-01-10'),
    };
    const next = backlogReducer(createInitialState(), action);
    expect(next.sprints.map((sp) => sp.id)).toEqual([10]);
    expect(next.currentSprint!.id).toBe(10);
  });

  it('delegates SET_USERSTORIES with opts', () => {
    const next = backlogReducer(createInitialState(), {
      type: 'SET_USERSTORIES',
      userstories: [makeUs({ id: 1, ref: 1 })],
      opts: { total: 5 },
    });
    expect(next.userstories.map((u) => u.id)).toEqual([1]);
    expect(next.totalUserStories).toBe(5);
  });

  it('for APPLY_DRAG it returns ONLY the next state (payload discarded)', () => {
    const state = threeStoryBacklog();
    const drag: DragResult = { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true };
    const next = backlogReducer(state, { type: 'APPLY_DRAG', result: drag });
    // Same state graph the producer's `.state` would yield.
    expect(next.userstories.map((u) => u.id)).toEqual([1, 3, 2]);
    // The returned value is a BacklogState (no `payload`/`state` wrapper).
    expect(next).not.toHaveProperty('payload');
  });

  it('for MOVE_TO_CURRENT_SPRINT / MOVE_TO_LATEST_SPRINT it returns the plain state', () => {
    const state = moveToSprintState();
    const current = backlogReducer(state, { type: 'MOVE_TO_CURRENT_SPRINT' });
    expect(current.sprints.find((sp) => sp.id === 200)!.user_stories.map((u) => u.id)).toEqual([11, 12]);
    const latest = backlogReducer(state, { type: 'MOVE_TO_LATEST_SPRINT' });
    expect(latest.sprints.find((sp) => sp.id === 100)!.user_stories.map((u) => u.id)).toEqual([11, 12]);
  });

  it('delegates APPLY_MOVE_RESULT', () => {
    let state = setUserstories(createInitialState(), [makeUs({ id: 1, milestone: null })]);
    const next = backlogReducer(state, { type: 'APPLY_MOVE_RESULT', updated: [{ id: 1, milestone: 3, backlog_order: 4 }] });
    expect(next.userstories.find((u) => u.id === 1)!.milestone).toBe(3);
  });

  it('returns the SAME state reference for an unknown action (default case)', () => {
    const state = seededState();
    // Cast around the discriminated union to model a runtime-unknown action.
    const next = backlogReducer(state, { type: '__UNKNOWN__' } as unknown as BacklogAction);
    expect(next).toBe(state);
  });
});

describe('backlogReducer dispatcher — every action type is routed', () => {
  // A base state rich enough for every action (project, two open sprints, a
  // backlog, a selection). Sprint 100 exists for REMOVE_SPRINT / form edit.
  function dispatchBase(): BacklogState {
    return seededState();
  }
  const sprint100 = makeSprint({ id: 100 });

  const cases: Array<[string, BacklogAction, (next: BacklogState) => void]> = [
    ['SET_PROJECT', { type: 'SET_PROJECT', project: makeProject({ id: 77 }) }, (n) => expect(n.project!.id).toBe(77)],
    [
      'SET_USERSTORIES',
      { type: 'SET_USERSTORIES', userstories: [makeUs({ id: 50, ref: 50 })], opts: { resetPagination: true } },
      (n) => expect(n.userstories.map((u) => u.id)).toEqual([50]),
    ],
    [
      'SET_SPRINTS',
      { type: 'SET_SPRINTS', milestones: [makeSprint({ id: 111 })], closed: 0, open: 1, nowMs: 0 },
      (n) => expect(n.sprints.map((sp) => sp.id)).toEqual([111]),
    ],
    [
      'SET_CLOSED_SPRINTS',
      { type: 'SET_CLOSED_SPRINTS', milestones: [makeSprint({ id: 222, closed: true })], closed: 1 },
      (n) => expect(n.closedSprints.map((sp) => sp.id)).toEqual([222]),
    ],
    ['UNLOAD_CLOSED_SPRINTS', { type: 'UNLOAD_CLOSED_SPRINTS' }, (n) => expect(n.closedSprints).toEqual([])],
    [
      'SET_PROJECT_STATS',
      { type: 'SET_PROJECT_STATS', stats: makeStats({ total_points: 10, closed_points: 5, total_milestones: 1 }) },
      (n) => expect(n.stats!.completedPercentage).toBe(50),
    ],
    ['MARK_NEW_US', { type: 'MARK_NEW_US', ids: [42] }, (n) => expect(n.newUs).toContain(42)],
    ['TOGGLE_SHOW_TAGS', { type: 'TOGGLE_SHOW_TAGS' }, (n) => expect(n.showTags).toBe(false)],
    ['TOGGLE_ACTIVE_FILTERS', { type: 'TOGGLE_ACTIVE_FILTERS' }, (n) => expect(n.activeFilters).toBe(true)],
    ['TOGGLE_VELOCITY', { type: 'TOGGLE_VELOCITY' }, (n) => expect(n.displayVelocity).toBe(true)],
    ['TOGGLE_CLOSED_SPRINTS_VISIBLE', { type: 'TOGGLE_CLOSED_SPRINTS_VISIBLE' }, (n) => expect(n.closedSprintsVisible).toBe(true)],
    ['SET_FILTER_QUERY', { type: 'SET_FILTER_QUERY', query: 'z' }, (n) => expect(n.filters.query).toBe('z')],
    ['SET_FILTERS', { type: 'SET_FILTERS', filters: { query: 'y' } }, (n) => expect(n.filters.query).toBe('y')],
    ['SET_SELECTED_IDS', { type: 'SET_SELECTED_IDS', ids: [8, 9] }, (n) => expect(n.selectedIds).toEqual([8, 9])],
    ['TOGGLE_SELECTED_ID', { type: 'TOGGLE_SELECTED_ID', id: 2 }, (n) => expect(n.selectedIds).toContain(2)],
    ['TOGGLE_SPRINT_FOLD', { type: 'TOGGLE_SPRINT_FOLD', sprintId: 100 }, (n) => expect(n.sprintOpen[100]).toBe(false)],
    [
      'OPEN_SPRINT_FORM_CREATE',
      { type: 'OPEN_SPRINT_FORM_CREATE', projectId: 7, nowYmd: '2021-01-01' },
      (n) => expect(n.sprintForm.mode).toBe('create'),
    ],
    [
      'OPEN_SPRINT_FORM_EDIT',
      { type: 'OPEN_SPRINT_FORM_EDIT', sprint: sprint100, canDelete: true },
      (n) => expect(n.sprintForm.mode).toBe('edit'),
    ],
    ['CLOSE_SPRINT_FORM', { type: 'CLOSE_SPRINT_FORM' }, (n) => expect(n.sprintForm.open).toBe(false)],
    ['SET_SPRINT_FORM_VALUES', { type: 'SET_SPRINT_FORM_VALUES', values: { name: 'x' } }, (n) => expect(n.sprintForm.values.name).toBe('x')],
    ['REMOVE_SPRINT', { type: 'REMOVE_SPRINT', sprintId: 100 }, (n) => expect(n.sprints.some((sp) => sp.id === 100)).toBe(false)],
    ['UPSERT_SPRINT', { type: 'UPSERT_SPRINT', sprint: makeSprint({ id: 333 }) }, (n) => expect(n.sprints.some((sp) => sp.id === 333)).toBe(true)],
    [
      'APPLY_DRAG',
      { type: 'APPLY_DRAG', result: { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true } },
      (n) => expect(n.userstories.map((u) => u.id)).toEqual([1, 3, 2]),
    ],
    ['MOVE_TO_CURRENT_SPRINT', { type: 'MOVE_TO_CURRENT_SPRINT' }, (n) => expect(n.selectedIds).toEqual([])],
    ['MOVE_TO_LATEST_SPRINT', { type: 'MOVE_TO_LATEST_SPRINT' }, (n) => expect(n.selectedIds).toEqual([])],
    [
      'APPLY_MOVE_RESULT',
      { type: 'APPLY_MOVE_RESULT', updated: [{ id: 1, milestone: 100, backlog_order: 9 }] },
      (n) => expect(n.userstories.find((u) => u.id === 1)!.backlog_order).toBe(9),
    ],
    // Inline row-control actions (finding #12).
    [
      'UPDATE_US',
      { type: 'UPDATE_US', us: makeUs({ id: 2, ref: 2, backlog_order: 2, total_points: 99 }) },
      (n) => expect(n.userstories.find((u) => u.id === 2)!.total_points).toBe(99),
    ],
    [
      'REMOVE_US',
      { type: 'REMOVE_US', usId: 1 },
      (n) => {
        expect(n.userstories.some((u) => u.id === 1)).toBe(false);
        // id 1 was in the seeded selection -> also dropped from selectedIds.
        expect(n.selectedIds).not.toContain(1);
      },
    ],
    [
      'SET_POINTS_VIEW_ROLE',
      { type: 'SET_POINTS_VIEW_ROLE', roleId: 15 },
      (n) => expect(n.pointsViewRoleId).toBe(15),
    ],
  ];

  it.each(cases)('routes %s to its producer', (_name, action, check) => {
    const next = backlogReducer(dispatchBase(), action);
    check(next);
  });
});

/* ================================================================== *
 * Phase M — Global purity sweep: every state-returning producer must
 * return a NEW top-level object and never mutate its input graph.
 * ================================================================== */

describe('immutability sweep — producers never mutate their input', () => {
  const drag: DragResult = { movedIds: [3], targetSprintId: null, index: 0, previousUs: 1, nextUs: null, isBacklog: true };

  const runners: Array<[string, (s: BacklogState) => unknown]> = [
    ['setProject', (s) => setProject(s, makeProject({ id: 7 }))],
    ['setUserstories', (s) => setUserstories(s, [makeUs({ id: 4, ref: 4, backlog_order: 4 })])],
    ['setSprints', (s) => setSprints(s, { milestones: [makeSprint({ id: 300 })], closed: 0, open: 1, nowMs: 0 })],
    ['setClosedSprints', (s) => setClosedSprints(s, { milestones: [makeSprint({ id: 400, closed: true })], closed: 1 })],
    ['unloadClosedSprints', (s) => unloadClosedSprints(s)],
    ['setProjectStats', (s) => setProjectStats(s, makeStats({ total_points: 10, closed_points: 5, total_milestones: 1 }))],
    ['markNewUs', (s) => markNewUs(s, [4])],
    ['toggleShowTags', (s) => toggleShowTags(s)],
    ['toggleActiveFilters', (s) => toggleActiveFilters(s)],
    ['toggleVelocityForecasting', (s) => toggleVelocityForecasting(s)],
    ['setForecastedStories', (s) => setForecastedStories(s, [makeUs({ id: 5, ref: 5 })], false)],
    ['toggleClosedSprintsVisible', (s) => toggleClosedSprintsVisible(s)],
    ['setFilterQuery', (s) => setFilterQuery(s, 'q')],
    ['setFilters', (s) => setFilters(s, { query: 'x' })],
    ['setSelectedIds', (s) => setSelectedIds(s, [2, 3])],
    ['toggleSelectedId', (s) => toggleSelectedId(s, 2)],
    ['toggleSprintFold', (s) => toggleSprintFold(s, 100)],
    ['openSprintFormCreate', (s) => openSprintFormCreate(s, { projectId: 7, nowYmd: '2021-01-01' })],
    ['openSprintFormEdit', (s) => openSprintFormEdit(s, { sprint: makeSprint({ id: 100 }), canDelete: true })],
    ['closeSprintForm', (s) => closeSprintForm(s)],
    ['setSprintFormValues', (s) => setSprintFormValues(s, { name: 'n' })],
    ['removeSprint', (s) => removeSprint(s, 100)],
    ['upsertSprint', (s) => upsertSprint(s, makeSprint({ id: 100, name: 'Up' }))],
    ['applyMoveResult', (s) => applyMoveResult(s, [{ id: 1, milestone: 100, backlog_order: 9 }])],
    // Inline row-control producers (finding #12).
    ['updateUserStory', (s) => updateUserStory(s, makeUs({ id: 2, ref: 2, total_points: 42 }))],
    ['removeUserStory', (s) => removeUserStory(s, 1)],
    ['setPointsViewRole', (s) => setPointsViewRole(s, 15)],
    // Server-observable producers: assert purity on `.state`.
    ['applyDrag', (s) => applyDrag(s, drag).state],
    ['moveToCurrentSprint', (s) => moveToCurrentSprint(s).state],
    ['moveToLatestSprint', (s) => moveToLatestSprint(s).state],
  ];

  it.each(runners)('%s does not mutate the seeded input state', (_name, run) => {
    const seeded = seededState();
    const clone = deepClone(seeded);
    run(seeded);
    expect(seeded).toEqual(clone);
  });

  it.each(runners)('%s returns a NEW top-level object for the seeded input', (_name, run) => {
    const seeded = seededState();
    const result = run(seeded);
    // Every producer here changes something on the seeded state, so immer must
    // return a fresh top-level object (never the same reference).
    expect(result).not.toBe(seeded);
  });
});

/* ================================================================== *
 * Inline row-control producers (finding #12): updateUserStory,
 * removeUserStory, setPointsViewRole — direct-call behavioural specs.
 * These reproduce the legacy in-place US update / optimistic remove /
 * "view points per role" selection (backlog/main.coffee:662-684, the
 * status/points widgets, and the header role selector).
 * ================================================================== */

describe('updateUserStory — replaces a story in place by id', () => {
  it('replaces the matching story with the server copy, preserving order', () => {
    const s = seededState(); // userstories ids [1, 2, 3]
    const updated = makeUs({ id: 2, ref: 2, backlog_order: 2, status: 16, total_points: 99 });
    const next = updateUserStory(s, updated);
    // Same length + order; only id 2 changed.
    expect(next.userstories.map((u) => u.id)).toEqual([1, 2, 3]);
    const row = next.userstories.find((u) => u.id === 2)!;
    expect(row.total_points).toBe(99);
    expect(row.status).toBe(16);
  });

  it('is a no-op when the id is not present', () => {
    const s = seededState();
    const next = updateUserStory(s, makeUs({ id: 999, ref: 999 }));
    expect(next.userstories.map((u) => u.id)).toEqual([1, 2, 3]);
  });
});

describe('removeUserStory — optimistic removal + selection cleanup', () => {
  it('removes the story from the backlog list', () => {
    const s = seededState();
    const next = removeUserStory(s, 2);
    expect(next.userstories.map((u) => u.id)).toEqual([1, 3]);
  });

  it('also drops the removed id from the multi-selection', () => {
    const s = seededState(); // seeded selection is [1]
    expect(s.selectedIds).toContain(1);
    const next = removeUserStory(s, 1);
    expect(next.userstories.some((u) => u.id === 1)).toBe(false);
    expect(next.selectedIds).not.toContain(1);
  });

  it('is a no-op (list unchanged) when the id is absent', () => {
    const s = seededState();
    const next = removeUserStory(s, 999);
    expect(next.userstories.map((u) => u.id)).toEqual([1, 2, 3]);
  });
});

describe('setPointsViewRole — header "view points per Role" selection', () => {
  it('stores the selected role id', () => {
    const s = seededState();
    expect(s.pointsViewRoleId).toBeNull();
    const next = setPointsViewRole(s, 15);
    expect(next.pointsViewRoleId).toBe(15);
  });

  it('clears the selection when passed null ("All roles")', () => {
    let s = seededState();
    s = setPointsViewRole(s, 15);
    const next = setPointsViewRole(s, null);
    expect(next.pointsViewRoleId).toBeNull();
  });
});

