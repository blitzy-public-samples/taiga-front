/*
 * ---------------------------------------------------------------------------
 * Unit spec — Backlog immer reducer (app/react/backlog/state/backlogReducer.ts)
 * ---------------------------------------------------------------------------
 *
 * Companion unit coverage for the pure, deterministic producers/selectors that
 * back the React Backlog screen. Each exported function reproduces a specific
 * AngularJS `taigaBacklog` behavior (referenced inline in the source) and is a
 * pure `(state, ...args) => nextState` or standalone helper, so the assertions
 * below exercise the documented input/output contract directly and assert that
 * the immer producers never mutate their input state.
 */

import {
  createInitialState,
  initialBacklogState,
  reset,
  sortByBacklogOrder,
  sortBySprintOrder,
  keyById,
  sumBy,
  parseYmdToMs,
  formatMsToYmd,
  addWeeks,
  selectOpenSprints,
  sprintTotalPoints,
  findCurrentSprint,
  selectLastSprint,
  computeCompletedPercentage,
  buildCreateSprintDefaults,
  setUserstories,
  setSprints,
  setClosedSprints,
  unloadClosedSprints,
  setProjectStats,
  setProject,
  markNewUs,
  toggleShowTags,
  toggleActiveFilters,
  toggleVelocityForecasting,
  toggleClosedSprintsVisible,
  setForecastedStories,
  setFilterQuery,
  setFilters,
  setSelectedIds,
  toggleSelectedId,
  type UserStory,
  type Sprint,
  type BacklogStats,
  type Project,
  type BacklogState,
} from '../state/backlogReducer';

/* ------------------------------------------------------------------ *
 * Test fixture factories (typed to satisfy strict mode)
 * ------------------------------------------------------------------ */

function mkUs(overrides: Partial<UserStory> & { id: number }): UserStory {
  return {
    ref: overrides.id,
    milestone: null,
    project: 1,
    backlog_order: 0,
    sprint_order: 0,
    total_points: 0,
    ...overrides,
  } as UserStory;
}

function mkSprint(overrides: Partial<Sprint> & { id: number }): Sprint {
  return {
    name: `Sprint ${overrides.id}`,
    project: 1,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-15',
    closed: false,
    total_points: 0,
    user_stories: [],
    ...overrides,
  } as Sprint;
}

describe('backlogReducer — initial state & reset', () => {
  it('createInitialState() returns the documented load-bearing defaults', () => {
    const s = createInitialState();
    expect(s.project).toBeNull();
    expect(s.userstories).toEqual([]);
    expect(s.page).toBe(1);
    expect(s.showTags).toBe(true); // main.coffee:91
    expect(s.activeFilters).toBe(false); // main.coffee:92
    expect(s.forecastNewSprint).toBe(true); // main.coffee:450
    expect(s.closedSprintsVisible).toBe(false);
    expect(s.filters).toEqual({ query: '', selected: [], custom: [] });
    expect(s.sprintForm.open).toBe(false);
    expect(s.sprintForm.mode).toBe('create');
  });

  it('createInitialState() returns a fresh object each call (no shared mutable state)', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    expect(a.filters).not.toBe(b.filters);
    a.userstories.push(mkUs({ id: 1 }));
    expect(b.userstories).toEqual([]);
  });

  it('initialBacklogState matches a freshly built state', () => {
    expect(initialBacklogState).toEqual(createInitialState());
  });

  it('reset() carries over the project context when present', () => {
    const project: Project = { id: 42 };
    const prev = { ...createInitialState(), project, showTags: false };
    const next = reset(prev);
    expect(next.project).toBe(project);
    // everything else is a fresh default again
    expect(next.showTags).toBe(true);
  });

  it('reset() with no prior context yields a clean default state', () => {
    expect(reset()).toEqual(createInitialState());
    expect(reset({}).project).toBeNull();
  });
});

describe('backlogReducer — pure helpers (sorting / keying / summing)', () => {
  it('sortByBacklogOrder sorts ascending and never mutates the input', () => {
    const input = [mkUs({ id: 2, backlog_order: 20 }), mkUs({ id: 1, backlog_order: 10 })];
    const out = sortByBacklogOrder(input);
    expect(out.map((u) => u.id)).toEqual([1, 2]);
    expect(input.map((u) => u.id)).toEqual([2, 1]); // input untouched
    expect(out).not.toBe(input);
  });

  it('sortByBacklogOrder is stable for equal keys (decorate-sort tiebreak)', () => {
    const input = [
      mkUs({ id: 1, backlog_order: 5 }),
      mkUs({ id: 2, backlog_order: 5 }),
      mkUs({ id: 3, backlog_order: 5 }),
    ];
    expect(sortByBacklogOrder(input).map((u) => u.id)).toEqual([1, 2, 3]);
  });

  it('sortBySprintOrder sorts ascending by sprint_order', () => {
    const input = [mkUs({ id: 1, sprint_order: 3 }), mkUs({ id: 2, sprint_order: 1 })];
    expect(sortBySprintOrder(input).map((u) => u.id)).toEqual([2, 1]);
  });

  it('keyById builds a last-wins single-item map (NOT arrays)', () => {
    const map = keyById([mkUs({ id: 1, ref: 11 }), mkUs({ id: 2 }), mkUs({ id: 1, ref: 99 })]);
    expect(Object.keys(map)).toEqual(['1', '2']);
    expect(map[1].ref).toBe(99); // last wins
    expect(Array.isArray(map[1])).toBe(false);
  });

  it('sumBy sums a numeric field and returns 0 for an empty list', () => {
    expect(sumBy([{ p: 2 }, { p: 3 }, { p: 5 }], (x) => x.p)).toBe(10);
    expect(sumBy([] as Array<{ p: number }>, (x) => x.p)).toBe(0);
  });
});

describe('backlogReducer — date math (day granularity)', () => {
  it('parseYmdToMs parses to local midnight deterministically', () => {
    expect(parseYmdToMs('2021-01-15')).toBe(new Date(2021, 0, 15).getTime());
  });

  it('formatMsToYmd is the inverse of parseYmdToMs (round trip)', () => {
    expect(formatMsToYmd(parseYmdToMs('2021-03-01'))).toBe('2021-03-01');
    expect(formatMsToYmd(new Date(2021, 2, 1).getTime())).toBe('2021-03-01');
  });

  it('addWeeks adds weeks*7 days (parity with the +2-week sprint default)', () => {
    expect(addWeeks('2021-01-15', 2)).toBe('2021-01-29');
    expect(addWeeks('2021-01-04', 2)).toBe('2021-01-18');
    expect(addWeeks('2021-01-01', 0)).toBe('2021-01-01');
  });
});

describe('backlogReducer — sprint selectors', () => {
  it('selectOpenSprints filters out closed sprints', () => {
    const sprints = [mkSprint({ id: 1 }), mkSprint({ id: 2, closed: true }), mkSprint({ id: 3 })];
    expect(selectOpenSprints({ ...createInitialState(), sprints }).map((s) => s.id)).toEqual([1, 3]);
  });

  it('sprintTotalPoints sums only stories still assigned to this sprint', () => {
    const sprint = mkSprint({
      id: 5,
      user_stories: [
        mkUs({ id: 1, milestone: 5, total_points: 3 }),
        mkUs({ id: 2, milestone: 5, total_points: 2 }),
        mkUs({ id: 3, milestone: 9, total_points: 100 }), // different milestone -> excluded
      ],
    });
    expect(sprintTotalPoints(sprint)).toBe(5);
  });

  it('findCurrentSprint returns the sprint bracketing nowMs, else null', () => {
    const sprints = [
      mkSprint({ id: 1, estimated_start: '2021-01-01', estimated_finish: '2021-01-31' }),
      mkSprint({ id: 2, estimated_start: '2021-02-01', estimated_finish: '2021-02-28' }),
    ];
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-01-15'))?.id).toBe(1);
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-02-10'))?.id).toBe(2);
    expect(findCurrentSprint(sprints, parseYmdToMs('2021-06-01'))).toBeNull();
  });

  it('selectLastSprint returns the latest-finishing OPEN sprint (or null)', () => {
    const sprints = [
      mkSprint({ id: 1, estimated_finish: '2021-01-31' }),
      mkSprint({ id: 2, estimated_finish: '2021-03-31' }),
      mkSprint({ id: 3, estimated_finish: '2021-12-31', closed: true }), // closed -> ignored
    ];
    expect(selectLastSprint(sprints)?.id).toBe(2);
    expect(selectLastSprint([])).toBeNull();
    expect(selectLastSprint([mkSprint({ id: 9, closed: true })])).toBeNull();
  });

  it('computeCompletedPercentage rounds closed/total, falling back to defined_points', () => {
    expect(computeCompletedPercentage({ total_points: 100, closed_points: 25, completedPercentage: 0 })).toBe(25);
    expect(
      computeCompletedPercentage({ total_points: 0, defined_points: 50, closed_points: 10, completedPercentage: 0 }),
    ).toBe(20);
    expect(computeCompletedPercentage({ total_points: 0, defined_points: 0, closed_points: 5, completedPercentage: 0 })).toBe(0);
    expect(computeCompletedPercentage({ total_points: 3, completedPercentage: 0 })).toBe(0); // closed_points ?? 0
  });

  it('buildCreateSprintDefaults uses the injected now when there is no last sprint', () => {
    const d = buildCreateSprintDefaults([], '2021-06-01');
    expect(d).toEqual({ estimated_start: '2021-06-01', estimated_finish: '2021-06-15', lastSprintName: null });
  });

  it('buildCreateSprintDefaults seeds from the last sprint finish + name', () => {
    const sprints = [mkSprint({ id: 7, name: 'Sprint 7', estimated_finish: '2021-05-20' })];
    const d = buildCreateSprintDefaults(sprints, '2021-01-01');
    expect(d.estimated_start).toBe('2021-05-20');
    expect(d.estimated_finish).toBe('2021-06-03'); // +2 weeks
    expect(d.lastSprintName).toBe('Sprint 7');
  });
});

describe('backlogReducer — loading / stats producers (immutable)', () => {
  it('setUserstories sorts, derives visibleUserStories + backlogOrder, clears loading', () => {
    const s0: BacklogState = { ...createInitialState(), loadingUserstories: true };
    const s1 = setUserstories(s0, [
      mkUs({ id: 2, ref: 12, backlog_order: 2 }),
      mkUs({ id: 1, ref: 11, backlog_order: 1 }),
    ]);
    expect(s1.userstories.map((u) => u.id)).toEqual([1, 2]);
    expect(s1.visibleUserStories).toEqual([11, 12]);
    expect(s1.backlogOrder).toEqual({ 1: 1, 2: 2 });
    expect(s1.loadingUserstories).toBe(false);
    expect(s0.loadingUserstories).toBe(true); // input untouched
  });

  it('setUserstories honors hasNext (page++), total and resetPagination', () => {
    const s1 = setUserstories(createInitialState(), [mkUs({ id: 1, backlog_order: 1 })], {
      hasNext: true,
      total: 5,
    });
    expect(s1.page).toBe(2);
    expect(s1.disablePagination).toBe(false);
    expect(s1.totalUserStories).toBe(5);

    const s2 = setUserstories({ ...s1 }, [mkUs({ id: 9, backlog_order: 9 })], { resetPagination: true });
    expect(s2.userstories.map((u) => u.id)).toEqual([9]); // list cleared before append
  });

  it('markNewUs then setUserstories flags matching stories as new (deduped)', () => {
    const withNew = markNewUs(createInitialState(), [1, 1, 2]);
    expect(withNew.newUs).toEqual([1, 2]);
    const merged = markNewUs(withNew, [2, 3]);
    expect(merged.newUs).toEqual([1, 2, 3]);
    const loaded = setUserstories(merged, [mkUs({ id: 1, backlog_order: 1 }), mkUs({ id: 5, backlog_order: 2 })]);
    expect(loaded.userstories.find((u) => u.id === 1)?.new).toBe(true);
    expect(loaded.userstories.find((u) => u.id === 5)?.new).toBeUndefined();
  });

  it('setSprints sorts stories, keys by id, sets fold state and current sprint', () => {
    const s1 = setSprints(createInitialState(), {
      milestones: [
        mkSprint({
          id: 1,
          estimated_start: '2021-01-01',
          estimated_finish: '2021-01-31',
          user_stories: [mkUs({ id: 10, sprint_order: 2 }), mkUs({ id: 11, sprint_order: 1 })],
        }),
      ],
      closed: 2,
      open: 1,
      nowMs: parseYmdToMs('2021-01-15'),
    });
    expect(s1.sprints).toHaveLength(1);
    expect(s1.sprints[0].user_stories.map((u) => u.id)).toEqual([11, 10]); // sorted by sprint_order
    expect(s1.sprintsById[1].id).toBe(1);
    expect(s1.sprintsById[1]).toBe(s1.sprints[0]); // same reference
    expect(s1.sprintOpen[1]).toBe(true); // open -> expanded
    expect(s1.currentSprint?.id).toBe(1);
    expect(s1.totalOpenMilestones).toBe(1);
    expect(s1.totalClosedMilestones).toBe(2);
    expect(s1.totalMilestones).toBe(3);
    expect(s1.sprintsCounter).toBe(1);
    expect(s1.milestonesOrder[1]).toEqual({ 10: 2, 11: 1 });
  });

  it('setClosedSprints populates closed collections with collapsed fold state', () => {
    const s1 = setClosedSprints(createInitialState(), {
      milestones: [mkSprint({ id: 5, closed: true, user_stories: [mkUs({ id: 1, sprint_order: 1 })] })],
      closed: 1,
    });
    expect(s1.closedSprints.map((s) => s.id)).toEqual([5]);
    expect(s1.closedSprintsById[5].id).toBe(5);
    expect(s1.sprintOpen[5]).toBe(false); // closed -> collapsed
    expect(s1.totalClosedMilestones).toBe(1);
  });

  it('unloadClosedSprints clears the closed list and lookup map', () => {
    const loaded = setClosedSprints(createInitialState(), {
      milestones: [mkSprint({ id: 5, closed: true })],
      closed: 1,
    });
    const cleared = unloadClosedSprints(loaded);
    expect(cleared.closedSprints).toEqual([]);
    expect(cleared.closedSprintsById).toEqual({});
  });

  it('setProjectStats derives completedPercentage and showGraphPlaceholder', () => {
    const shown = setProjectStats(createInitialState(), {
      total_points: 100,
      total_milestones: 3,
      closed_points: 25,
      completedPercentage: 0,
    });
    expect(shown.stats?.completedPercentage).toBe(25);
    expect(shown.showGraphPlaceholder).toBe(false);

    const placeholder = setProjectStats(createInitialState(), { closed_points: 0, completedPercentage: 0 });
    expect(placeholder.showGraphPlaceholder).toBe(true);
  });

  it('setProject stores the resolved project', () => {
    const project: Project = { id: 7, slug: 'demo' };
    expect(setProject(createInitialState(), project).project).toBe(project);
  });
});

describe('backlogReducer — view toggles / filters (immutable)', () => {
  it('toggleShowTags flips showTags without mutating input', () => {
    const s0 = createInitialState();
    const s1 = toggleShowTags(s0);
    expect(s1.showTags).toBe(false);
    expect(s0.showTags).toBe(true);
    expect(s1).not.toBe(s0);
    expect(toggleShowTags(s1).showTags).toBe(true);
  });

  it('toggleActiveFilters flips the filters-sidebar flag', () => {
    expect(toggleActiveFilters(createInitialState()).activeFilters).toBe(true);
  });

  it('toggleClosedSprintsVisible flips the closed-sprints flag', () => {
    expect(toggleClosedSprintsVisible(createInitialState()).closedSprintsVisible).toBe(true);
  });

  it('toggleVelocityForecasting recomputes visibleUserStories from the active source', () => {
    const base: BacklogState = {
      ...createInitialState(),
      userstories: [mkUs({ id: 1, ref: 101 })],
      forecastedStories: [mkUs({ id: 2, ref: 202 }), mkUs({ id: 3, ref: 303 })],
      visibleUserStories: [101],
    };
    const on = toggleVelocityForecasting(base);
    expect(on.displayVelocity).toBe(true);
    expect(on.visibleUserStories).toEqual([202, 303]); // from forecastedStories
    const off = toggleVelocityForecasting(on);
    expect(off.displayVelocity).toBe(false);
    expect(off.visibleUserStories).toEqual([101]); // back to userstories
  });

  it('setForecastedStories stores stories and the forecastNewSprint flag', () => {
    const s1 = setForecastedStories(createInitialState(), [mkUs({ id: 1 })], false);
    expect(s1.forecastedStories.map((u) => u.id)).toEqual([1]);
    expect(s1.forecastNewSprint).toBe(false);
  });

  it('setFilterQuery / setFilters / setSelectedIds / toggleSelectedId update the slice immutably', () => {
    const q = setFilterQuery(createInitialState(), 'bug');
    expect(q.filters.query).toBe('bug');

    const merged = setFilters(createInitialState(), { query: 'x', selected: [{ id: 1 }] });
    expect(merged.filters.query).toBe('x');
    expect(merged.filters.selected).toEqual([{ id: 1 }]);
    expect(merged.filters.custom).toEqual([]); // untouched key preserved

    const sel = setSelectedIds(createInitialState(), [4, 5, 6]);
    expect(sel.selectedIds).toEqual([4, 5, 6]);

    const added = toggleSelectedId(createInitialState(), 3);
    expect(added.selectedIds).toEqual([3]);
    const removed = toggleSelectedId(added, 3);
    expect(removed.selectedIds).toEqual([]);
  });
});
