/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * kanbanReducer.test.ts
 * ---------------------
 * Exhaustive Jest unit spec for the pure, framework-agnostic immer board-state
 * reducer at `../state/kanbanReducer`. This is the coverage anchor for the
 * `app/react/**` >=70% line gate (jest.config.js `coverageThreshold`).
 *
 * HARD RULES enforced here (AAP 0.6.2 / 0.7):
 *   - Test isolation: Jest + jest-environment-jsdom ONLY. No Playwright, no
 *     browser, no network, no timers - the module under test is synchronous and
 *     pure, so every assertion is deterministic in a bare container.
 *   - Globals-only import boundary: the ONLY project import is the module under
 *     test (`../state/kanbanReducer`). Nothing is imported from the AngularJS
 *     CoffeeScript tree, the modern Angular tree, the compiled elements bundle,
 *     or the React shared adapters. Jest globals (describe / it / expect) are
 *     AMBIENT via the Jest type definitions, so there is no explicit Jest value
 *     import. `immer` runs for real - there are no test doubles.
 *
 * Every assertion is authored against the module's ACTUAL exported surface
 * (read from disk): there is no `kanbanReducer(state, action)` dispatcher, so
 * the optional dispatcher suite (spec Phase R) is intentionally omitted.
 */

import {
  reset,
  initialKanbanState,
  DEFAULT_UNCLASSIFIED_LABEL,
  getUsModel,
  getUs,
  getStatus,
  isUsInArchivedHiddenStatus,
  init,
  resetFolds,
  toggleFold,
  addArchivedStatus,
  hideStatus,
  showStatus,
  deleteStatus,
  refreshRawOrder,
  assignOrders,
  move,
  moveToEnd,
  set,
  initUsByStatusList,
  remove,
  add,
  replace,
  replaceModel,
  refreshUserStory,
  retrieveUserStoryData,
  refresh,
  refreshSwimlanes,
} from '../state/kanbanReducer';
import type {
  UserStory,
  User,
  Swimlane,
  UserStoryData,
  KanbanState,
  KanbanMoveResult,
  KanbanMoveToEndResult,
} from '../state/kanbanReducer';

/* ================================================================== *
 * Typed fixture factories (Phase B)
 *
 * Deterministic builders so every test starts from a known board and
 * NEVER relies on shared/global state. `as UserStory` / `as UserStoryData`
 * casts are confined to the factory boundary.
 * ================================================================== */

/** Minimal opaque user record. */
function makeUser(id: number, extra?: Partial<User>): User {
  return { id, ...extra };
}

/** Build a `usersById` lookup keyed by id. */
function makeUsersById(...ids: number[]): Record<number, User> {
  const map: Record<number, User> = {};
  for (const id of ids) {
    map[id] = makeUser(id);
  }
  return map;
}

/** Build a raw user story, defaulting every field the board logic consumes. */
function makeUs(partial: Partial<UserStory> & { id: number }): UserStory {
  return {
    status: 1,
    swimlane: null,
    kanban_order: 0,
    assigned_to: null,
    assigned_users: [],
    attachments: [],
    tags: [],
    ...partial,
  } as UserStory;
}

/** Build a swimlane record. */
function makeSwimlane(id: number, name = `S${id}`, kanban_order = id): Swimlane {
  return { id, name, kanban_order };
}

/**
 * Build a `UserStoryData` view-model. Accepts arbitrary extra marker fields
 * (via the interface index signature) so tests can pre-seed a SENTINEL entry in
 * `usMap` and later prove it was (or was not) overwritten.
 */
function makeUsData(partial: Partial<UserStoryData> & { id: number }): UserStoryData {
  // `id` is provided by `...partial` (the `& { id: number }` guarantees it), so
  // it is not restated here to avoid the "specified more than once" diagnostic.
  return {
    foldStatusChanged: undefined,
    model: makeUs({ id: partial.id }),
    images: [],
    swimlane: null,
    assigned_to: undefined,
    assigned_users: [],
    assigned_users_preview: [],
    colorized_tags: [],
    ...partial,
  } as UserStoryData;
}

/**
 * Structural deep clone for purity checks. The board state is plain
 * JSON-compatible data (numbers/strings/arrays/objects/null), so a JSON
 * round-trip is a faithful snapshot. `undefined` view-model fields are dropped
 * by JSON but Jest's `toEqual` treats a missing key and an `undefined` value as
 * equal, so the comparison remains exact for detecting real mutations.
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A three-card, single-status, no-swimlane board used by the `move`/`moveToEnd`
 * suites. `set` establishes `order === {10:0, 20:1, 30:2}` and
 * `usByStatus === {'3':[10,20,30]}`. No swimlanes are configured, so
 * `usByStatusSwimlanes` stays `{}` (the swimlane refresh early-returns) - keeps
 * the ordering maths free of swimlane noise.
 */
function threeCardState(): KanbanState {
  return set(reset(), [
    makeUs({ id: 10, status: 3, swimlane: null, kanban_order: 0 }),
    makeUs({ id: 20, status: 3, swimlane: null, kanban_order: 1 }),
    makeUs({ id: 30, status: 3, swimlane: null, kanban_order: 2 }),
  ]);
}

/**
 * A fully configured multi-status, multi-swimlane board used across the
 * collection/refresh/swimlane suites. Covers: statuses 1/2/3, `swimlane:null`
 * plus `swimlane:10`/`swimlane:20`, distinct `kanban_order`, and stories with
 * `assigned_to`/`assigned_users`.
 *
 * Derived (verified) projections:
 *   order                = {1:0, 2:1, 3:2, 4:3, 5:4}
 *   usByStatus           = {'1':[1,2], '3':[3,4], '2':[5]}   (STRING keys)
 *   swimlanesList        = [{id:-1,kanban_order:1,name:<label>}, sw10, sw20]
 *   usByStatusSwimlanes  = { -1:{1:[1],3:[4],2:[]},
 *                            10:{1:[2],3:[],2:[5]},
 *                            20:{1:[],3:[3],2:[]} }           (NUMBER inner keys)
 */
function seededBoard(unclassifiedLabel?: string): KanbanState {
  const configured = init(
    reset(),
    { id: 99 },
    [makeSwimlane(10), makeSwimlane(20)],
    makeUsersById(1, 2, 3),
    unclassifiedLabel,
  );
  return set(configured, [
    makeUs({ id: 1, status: 1, swimlane: null, kanban_order: 0, assigned_to: 1, assigned_users: [1, 2] }),
    makeUs({ id: 2, status: 1, swimlane: 10, kanban_order: 1 }),
    makeUs({ id: 3, status: 3, swimlane: 20, kanban_order: 2, assigned_to: 2, assigned_users: [2, 3] }),
    makeUs({ id: 4, status: 3, swimlane: null, kanban_order: 3 }),
    makeUs({ id: 5, status: 2, swimlane: 10, kanban_order: 4 }),
  ]);
}

/**
 * Build a populated previous state used by the `reset` flag-preservation tests.
 * It carries a non-empty statusHide, archivedStatus and swimlanesList, plus the
 * always-preserved project/usersById/unclassifiedLabel configuration.
 */
function populatedPrev(): KanbanState {
  let s = init(reset(), { id: 42 }, [makeSwimlane(10)], makeUsersById(1), 'Custom Label');
  // set() populates userstoriesRaw/order/usByStatus/usMap and (because a
  // swimlane is configured and the single story has swimlane:null) builds a
  // non-empty swimlanesList including the synthetic unclassified swimlane.
  s = set(s, [makeUs({ id: 1, status: 1, swimlane: null, kanban_order: 0 })]);
  s = addArchivedStatus(s, 7); // archivedStatus = [7] (status id 7)
  s = hideStatus(s, 8); // statusHide = [8]; deleteStatus is a no-op, so archivedStatus stays [7]
  return s;
}

/* ================================================================== *
 * Phase C - reset & initialKanbanState
 * ================================================================== */

describe('reset & initialKanbanState', () => {
  it('exposes the English fallback label constant', () => {
    expect(DEFAULT_UNCLASSIFIED_LABEL).toBe('Unclassified user stories');
  });

  it('initialKanbanState has empty collections and default label', () => {
    expect(initialKanbanState.userstoriesRaw).toEqual([]);
    expect(initialKanbanState.swimlanes).toEqual([]);
    expect(initialKanbanState.swimlanesList).toEqual([]);
    expect(initialKanbanState.usByStatus).toEqual({});
    expect(initialKanbanState.usMap).toEqual({});
    expect(initialKanbanState.usByStatusSwimlanes).toEqual({});
    expect(initialKanbanState.order).toEqual({});
    expect(initialKanbanState.foldStatusChanged).toEqual({});
    expect(initialKanbanState.statusHide).toEqual([]);
    expect(initialKanbanState.archivedStatus).toEqual([]);
    expect(initialKanbanState.project).toBeNull();
    expect(initialKanbanState.usersById).toEqual({});
    expect(initialKanbanState.unclassifiedLabel).toBe(DEFAULT_UNCLASSIFIED_LABEL);
  });

  it('reset() with no prev returns the canonical empty board', () => {
    const s = reset();
    expect(s.userstoriesRaw).toEqual([]);
    expect(s.swimlanes).toEqual([]);
    expect(s.swimlanesList).toEqual([]);
    expect(s.usByStatus).toEqual({});
    expect(s.usMap).toEqual({});
    expect(s.usByStatusSwimlanes).toEqual({});
    expect(s.order).toEqual({});
    expect(s.foldStatusChanged).toEqual({});
    expect(s.statusHide).toEqual([]);
    expect(s.archivedStatus).toEqual([]);
    expect(s.project).toBeNull();
    expect(s.usersById).toEqual({});
    expect(s.unclassifiedLabel).toBe(DEFAULT_UNCLASSIFIED_LABEL);
  });

  it('reset(prev) with default flags clears statusHide, archivedStatus and swimlanesList', () => {
    const prev = populatedPrev();
    const s = reset(prev);
    expect(s.statusHide).toEqual([]);
    expect(s.archivedStatus).toEqual([]);
    expect(s.swimlanesList).toEqual([]);
    // Always-cleared collections regardless of flags.
    expect(s.userstoriesRaw).toEqual([]);
    expect(s.usByStatus).toEqual({});
    expect(s.usMap).toEqual({});
    expect(s.order).toEqual({});
    expect(s.foldStatusChanged).toEqual({});
  });

  it('reset(prev, false, false, false) preserves swimlanesList/archivedStatus/statusHide but clears the rest', () => {
    const prev = populatedPrev();
    const s = reset(prev, false, false, false);
    expect(s.swimlanesList).toEqual(prev.swimlanesList);
    expect(s.archivedStatus).toEqual([7]);
    expect(s.statusHide).toEqual([8]);
    // The board collections are still cleared.
    expect(s.userstoriesRaw).toEqual([]);
    expect(s.usByStatus).toEqual({});
    expect(s.usMap).toEqual({});
    expect(s.order).toEqual({});
    expect(s.foldStatusChanged).toEqual({});
  });

  it('each preservation flag is independent', () => {
    const prev = populatedPrev();

    // resetSwimlanesList=false preserves ONLY swimlanesList.
    const onlySwimlanes = reset(prev, false, true, true);
    expect(onlySwimlanes.swimlanesList).toEqual(prev.swimlanesList);
    expect(onlySwimlanes.archivedStatus).toEqual([]);
    expect(onlySwimlanes.statusHide).toEqual([]);

    // resetArchivedStatus=false preserves ONLY archivedStatus.
    const onlyArchived = reset(prev, true, false, true);
    expect(onlyArchived.swimlanesList).toEqual([]);
    expect(onlyArchived.archivedStatus).toEqual([7]);
    expect(onlyArchived.statusHide).toEqual([]);

    // resetHideStatus=false preserves ONLY statusHide.
    const onlyHide = reset(prev, true, true, false);
    expect(onlyHide.swimlanesList).toEqual([]);
    expect(onlyHide.archivedStatus).toEqual([]);
    expect(onlyHide.statusHide).toEqual([8]);
  });

  it('project, usersById and unclassifiedLabel are preserved regardless of flags', () => {
    const prev = populatedPrev();
    for (const s of [reset(prev), reset(prev, false, false, false), reset(prev, true, false, true)]) {
      expect(s.project).toEqual({ id: 42 });
      expect(s.usersById).toEqual({ 1: { id: 1 } });
      expect(s.unclassifiedLabel).toBe('Custom Label');
    }
  });

  it('is pure - returns a new object and never mutates prev', () => {
    const prev = populatedPrev();
    const clone = deepClone(prev);
    const s = reset(prev);
    expect(s).not.toBe(prev);
    expect(prev).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase D - init
 * ================================================================== */

describe('init', () => {
  it('sets project, swimlanes and usersById, leaving other fields untouched', () => {
    const swimlanes = [makeSwimlane(10), makeSwimlane(20)];
    const usersById = makeUsersById(1, 2);
    const s = init(reset(), { id: 99 }, swimlanes, usersById);
    expect(s.project).toEqual({ id: 99 });
    expect(s.swimlanes).toEqual(swimlanes);
    expect(s.usersById).toEqual(usersById);
    // Untouched collections.
    expect(s.userstoriesRaw).toEqual([]);
    expect(s.usByStatus).toEqual({});
    // Label defaults when not injected.
    expect(s.unclassifiedLabel).toBe(DEFAULT_UNCLASSIFIED_LABEL);
  });

  it('injects the translated unclassified label when provided', () => {
    const s = init(reset(), { id: 1 }, [], {}, 'Sin clasificar');
    expect(s.unclassifiedLabel).toBe('Sin clasificar');
  });

  it('leaves unclassifiedLabel at its prior value when the label is omitted', () => {
    const withLabel = init(reset(), { id: 1 }, [], {}, 'Sin clasificar');
    const again = init(withLabel, { id: 2 }, [], {});
    expect(again.unclassifiedLabel).toBe('Sin clasificar');
  });

  it('accepts a null project', () => {
    const s = init(reset(), null, [], {});
    expect(s.project).toBeNull();
  });

  it('is pure - returns a new object and never mutates input', () => {
    const base = reset();
    const clone = deepClone(base);
    const s = init(base, { id: 1 }, [makeSwimlane(10)], makeUsersById(1));
    expect(s).not.toBe(base);
    expect(base).toEqual(clone);
  });
});


/* ================================================================== *
 * Phase E - selectors: getUsModel, getUs, getStatus, isUsInArchivedHiddenStatus
 * ================================================================== */

describe('getUsModel', () => {
  it('returns the raw user story by id', () => {
    const s = seededBoard();
    const us = getUsModel(s, 3);
    expect(us).toBeDefined();
    expect(us!.id).toBe(3);
    expect(us!.status).toBe(3);
    expect(us!.swimlane).toBe(20);
  });

  it('returns undefined for an unknown id', () => {
    expect(getUsModel(seededBoard(), 99999)).toBeUndefined();
  });
});

describe('getUs', () => {
  it('returns the view-model stored in usMap', () => {
    const s = seededBoard();
    const vm = getUs(s, 1);
    expect(vm).toBeDefined();
    expect(vm!.id).toBe(1);
    expect(vm!.model.id).toBe(1);
  });

  it('returns undefined for an id not present in usMap', () => {
    expect(getUs(seededBoard(), 99999)).toBeUndefined();
  });
});

describe('getStatus', () => {
  const mixed = (): KanbanState =>
    set(reset(), [
      makeUs({ id: 1, status: 1, swimlane: null }),
      makeUs({ id: 2, status: 1, swimlane: 10 }),
      makeUs({ id: 3, status: 2, swimlane: 10 }),
    ]);

  const ids = (list: UserStory[]): number[] => list.map((u) => u.id).sort((a, b) => a - b);

  it('returns all stories in a status when no swimlane is given', () => {
    expect(ids(getStatus(mixed(), 1))).toEqual([1, 2]);
  });

  it('constrains to a swimlane when a truthy swimlaneId is given', () => {
    expect(ids(getStatus(mixed(), 1, 10))).toEqual([2]);
  });

  it('treats a null/0/undefined swimlaneId as "any swimlane" (falsy guard)', () => {
    const s = mixed();
    const any = ids(getStatus(s, 1));
    expect(ids(getStatus(s, 1, null))).toEqual(any);
    expect(ids(getStatus(s, 1, 0))).toEqual(any);
    expect(ids(getStatus(s, 1, undefined))).toEqual(any);
  });

  it('returns an empty list for a status with no stories', () => {
    expect(getStatus(mixed(), 999)).toEqual([]);
  });
});

describe('isUsInArchivedHiddenStatus', () => {
  // The status VALUE must be present in BOTH archivedStatus AND statusHide.
  // addArchivedStatus and hideStatus both operate on the STATUS id (3); the
  // story id (100) is intentionally different to make clear that story ids play
  // no part here. hideStatus's internal deleteStatus is a NO-OP (F26), so the
  // archived status value is never stripped.
  it('is true only when the status is in BOTH archivedStatus and statusHide', () => {
    let s = set(reset(), [makeUs({ id: 100, status: 3 })]);
    s = addArchivedStatus(s, 3);
    s = hideStatus(s, 3);
    expect(s.archivedStatus).toContain(3);
    expect(s.statusHide).toContain(3);
    expect(isUsInArchivedHiddenStatus(s, 100)).toBe(true);
  });

  it('is false when the status is ONLY in archivedStatus', () => {
    let s = set(reset(), [makeUs({ id: 100, status: 3 })]);
    s = addArchivedStatus(s, 3);
    expect(isUsInArchivedHiddenStatus(s, 100)).toBe(false);
  });

  it('is false when the status is ONLY in statusHide', () => {
    let s = set(reset(), [makeUs({ id: 100, status: 3 })]);
    s = hideStatus(s, 3);
    expect(isUsInArchivedHiddenStatus(s, 100)).toBe(false);
  });

  it('is false when the status is in NEITHER list', () => {
    const s = set(reset(), [makeUs({ id: 100, status: 3 })]);
    expect(isUsInArchivedHiddenStatus(s, 100)).toBe(false);
  });

  it('is false (no throw) for an unknown usId with no usMap entry', () => {
    const s = set(reset(), [makeUs({ id: 100, status: 3 })]);
    expect(isUsInArchivedHiddenStatus(s, 99999)).toBe(false);
  });
});

/* ================================================================== *
 * Phase F - fold producers: resetFolds, toggleFold
 * ================================================================== */

describe('resetFolds', () => {
  it('clears all fold flags', () => {
    let s = set(reset(), [makeUs({ id: 1, status: 1 })]);
    s = toggleFold(s, 1);
    expect(s.foldStatusChanged[1]).toBe(true);
    const cleared = resetFolds(s);
    expect(cleared.foldStatusChanged).toEqual({});
  });

  it('is pure', () => {
    let s = set(reset(), [makeUs({ id: 1, status: 1 })]);
    s = toggleFold(s, 1);
    const clone = deepClone(s);
    resetFolds(s);
    expect(s).toEqual(clone);
  });
});

describe('toggleFold', () => {
  const twoCards = (): KanbanState =>
    set(reset(), [makeUs({ id: 1, status: 1 }), makeUs({ id: 2, status: 1 })]);

  it('flips the fold flag from undefined -> true -> false across two toggles', () => {
    const base = twoCards();
    expect(base.foldStatusChanged[1]).toBeUndefined();

    const once = toggleFold(base, 1);
    expect(once.foldStatusChanged[1]).toBe(true);

    const twice = toggleFold(once, 1);
    expect(twice.foldStatusChanged[1]).toBe(false);

    // The effective folded state (boolean coercion) returns to the original.
    expect(!!twice.foldStatusChanged[1]).toBe(!!base.foldStatusChanged[1]);
  });

  it('refreshes ONLY the toggled story view-model, leaving siblings untouched', () => {
    const base = twoCards();
    const once = toggleFold(base, 1);
    expect(once.usMap[1].foldStatusChanged).toBe(true);
    // Sibling entry is preserved by immer (structural sharing).
    expect(once.usMap[2]).toBe(base.usMap[2]);
  });

  it('is pure', () => {
    const base = twoCards();
    const clone = deepClone(base);
    toggleFold(base, 1);
    expect(base).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase G - status visibility: addArchivedStatus, hideStatus, showStatus, deleteStatus
 * ================================================================== */

describe('addArchivedStatus', () => {
  it('appends the status id to archivedStatus', () => {
    const s = addArchivedStatus(reset(), 3);
    expect(s.archivedStatus).toEqual([3]);
  });

  it('is pure', () => {
    const base = reset();
    const clone = deepClone(base);
    addArchivedStatus(base, 3);
    expect(base).toEqual(clone);
  });
});

describe('hideStatus', () => {
  it('pushes the status into statusHide (its internal deleteStatus is a no-op)', () => {
    const s = hideStatus(reset(), 3);
    expect(s.statusHide).toContain(3);
    // deleteStatus is a no-op (F26), so archivedStatus is never affected here.
    expect(s.archivedStatus).toEqual([]);
  });

  it('is pure', () => {
    const base = reset();
    const clone = deepClone(base);
    hideStatus(base, 3);
    expect(base).toEqual(clone);
  });
});

describe('showStatus', () => {
  it('removes ALL occurrences of a hidden status', () => {
    // Seed statusHide = [3, 3, 5] via repeated hideStatus.
    let s = hideStatus(reset(), 3);
    s = hideStatus(s, 3);
    s = hideStatus(s, 5);
    expect(s.statusHide).toEqual([3, 3, 5]);

    const shown = showStatus(s, 3);
    expect(shown.statusHide).not.toContain(3);
    expect(shown.statusHide).toContain(5);
    expect(shown.statusHide).toEqual([5]);
  });

  it('is pure', () => {
    const base = hideStatus(reset(), 3);
    const clone = deepClone(base);
    showStatus(base, 3);
    expect(base).toEqual(clone);
  });
});

describe('deleteStatus', () => {
  // Authoritative parity (kanban-usertories.coffee:134-138): deleteStatus is a
  // NO-OP. The `_.map (it) -> it.id` call (no collection arg) discards the
  // computed ids, and the result is assigned to a phantom `@.archived` field the
  // service never initializes and nothing reads. It must NOT touch archivedStatus
  // (which holds STATUS ids, not story ids) — see applyDeleteStatus (F26).
  it('is a no-op: leaves archivedStatus (and all state) unchanged; never throws', () => {
    let s = set(reset(), [makeUs({ id: 7, status: 3 }), makeUs({ id: 8, status: 4 })]);
    // Archive TWO status ids. Note id 7 numerically COLLIDES with the id of a
    // status-3 story — a bug-corrected implementation would wrongly strip it.
    s = addArchivedStatus(s, 7);
    s = addArchivedStatus(s, 99);
    expect(s.archivedStatus).toEqual([7, 99]);

    let result!: KanbanState;
    expect(() => {
      result = deleteStatus(s, 3);
    }).not.toThrow();

    // archivedStatus is untouched — proving story ids are NEVER subtracted from
    // the status-id collection, even on a numeric id collision (F26).
    expect(result.archivedStatus).toEqual([7, 99]);
    // A true no-op: immer returns the SAME reference when the draft is unchanged.
    expect(result).toBe(s);
  });

  it('is pure', () => {
    const base = addArchivedStatus(set(reset(), [makeUs({ id: 7, status: 3 })]), 7);
    const clone = deepClone(base);
    deleteStatus(base, 3);
    expect(base).toEqual(clone);
  });
});


/* ================================================================== *
 * Phase H - refreshRawOrder, assignOrders
 * ================================================================== */

describe('refreshRawOrder', () => {
  it('rebuilds order from each raw story kanban_order', () => {
    let s = set(reset(), [
      makeUs({ id: 1, status: 1, kanban_order: 5 }),
      makeUs({ id: 2, status: 1, kanban_order: 2 }),
      makeUs({ id: 3, status: 1, kanban_order: 9 }),
    ]);
    // Perturb `order` so refreshRawOrder has something to restore.
    s = assignOrders(s, { 1: 100 });
    expect(s.order[1]).toBe(100);

    const refreshed = refreshRawOrder(s);
    expect(refreshed.order).toEqual({ 1: 5, 2: 2, 3: 9 });
  });

  it('is pure', () => {
    const base = set(reset(), [makeUs({ id: 1, kanban_order: 5 })]);
    const clone = deepClone(base);
    refreshRawOrder(base);
    expect(base).toEqual(clone);
  });
});

describe('assignOrders', () => {
  it('merges into order (overwrite/preserve/add) and recomputes usByStatus without rebuilding usMap', () => {
    const base = set(reset(), [
      makeUs({ id: 10, status: 1, kanban_order: 0 }),
      makeUs({ id: 20, status: 1, kanban_order: 1 }),
    ]);
    // order starts as {10:0, 20:1}; usMap has entries for 10 and 20.
    const result = assignOrders(base, { 10: 6, 30: 7 });

    // 10 overwritten, 20 preserved, 30 added.
    expect(result.order).toEqual({ 10: 6, 20: 1, 30: 7 });

    // usByStatus reflects the NEW ordering (sorted by order: 20 @1 before 10 @6).
    expect(result.usByStatus['1']).toEqual([20, 10]);

    // usMap is NOT rebuilt: existing entries are structurally shared.
    expect(result.usMap[10]).toBe(base.usMap[10]);
    expect(result.usMap[20]).toBe(base.usMap[20]);
  });

  it('is pure', () => {
    const base = set(reset(), [makeUs({ id: 10, status: 1, kanban_order: 0 })]);
    const clone = deepClone(base);
    assignOrders(base, { 10: 6 });
    expect(base).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase I - move (SERVER-OBSERVABLE: byte-exact payload + order recomputation)
 * ================================================================== */

describe('move', () => {
  it('returns the exact API payload and a new state', () => {
    const state = threeCardState();
    const result: KanbanMoveResult = move(state, [20], 3, null, 1, 10, 30);

    expect(result.payload).toStrictEqual({
      statusId: 3,
      swimlaneId: null,
      afterUserstoryId: 10,
      beforeUserstoryId: 30,
      bulkUserstories: [20],
    });

    // bulkUserstories is a number[] (ids), never objects - the frozen contract
    // forwarded straight to bulkUpdateKanbanOrder.
    expect(Array.isArray(result.payload.bulkUserstories)).toBe(true);
    expect(result.payload.bulkUserstories).toEqual([20]);
    result.payload.bulkUserstories.forEach((id) => expect(typeof id).toBe('number'));

    // A brand new state object is returned.
    expect(result.state).not.toBe(state);
  });

  it('maps afterUserstoryId/beforeUserstoryId from previousCard/nextCard via ?? null', () => {
    const state = threeCardState();

    // Both absent (null) -> both null. `null` is the legal "no adjacent card"
    // value per the public contract (previousCard/nextCard: number | null, and
    // KanbanDragResult.after/beforeUserstoryId: UsId | null). No caller ever
    // passes `undefined`, so we test the legal value rather than casting around
    // the type (F49). `null` and `undefined` are behaviorally identical here
    // anyway: `if (previousCard)` and `previousCard ?? null` treat both as absent.
    const none = move(state, [20], 3, null, 0, null, null);
    expect(none.payload.afterUserstoryId).toBeNull();
    expect(none.payload.beforeUserstoryId).toBeNull();

    // Only previous provided.
    const onlyPrev = move(state, [20], 3, null, 1, 10, null);
    expect(onlyPrev.payload.afterUserstoryId).toBe(10);
    expect(onlyPrev.payload.beforeUserstoryId).toBeNull();

    // Only next provided.
    const onlyNext = move(state, [20], 3, null, 0, null, 30);
    expect(onlyNext.payload.afterUserstoryId).toBeNull();
    expect(onlyNext.payload.beforeUserstoryId).toBe(30);
  });

  it('recomputes order so the moved story lands between its neighbours', () => {
    const state = threeCardState();
    const result = move(state, [20], 3, null, 1, 10, 30);

    // Concrete traced values: 10 untouched (0), moved 20 -> 1, after-dest 30 -> 3.
    expect(result.state.order[10]).toBe(0);
    expect(result.state.order[20]).toBe(1);
    expect(result.state.order[30]).toBe(3);

    // Relative-ordering invariant (drift-proof): sorting ids by order is [10,20,30].
    const sorted = [10, 20, 30].slice().sort((a, b) => result.state.order[a] - result.state.order[b]);
    expect(sorted).toEqual([10, 20, 30]);
  });

  it('updates status/swimlane on the moved story and refreshes its view-model', () => {
    const state = threeCardState();
    const result = move(state, [20], 2, 10, 0, null, null);

    expect(getUsModel(result.state, 20)!.status).toBe(2);
    expect(getUsModel(result.state, 20)!.swimlane).toBe(10);
    expect(result.state.usMap[20].model.status).toBe(2);
    expect(result.state.usMap[20].model.swimlane).toBe(10);

    expect(result.payload.statusId).toBe(2);
    expect(result.payload.swimlaneId).toBe(10);
  });

  it('supports moving multiple stories with sequential orders from the insertion point', () => {
    const state = threeCardState();
    const result = move(state, [20, 30], 3, null, 0, null, null);

    expect(result.payload.bulkUserstories).toEqual([20, 30]);
    // Both moved stories get sequential orders starting at the insertion point (0).
    expect(result.state.order[20]).toBe(0);
    expect(result.state.order[30]).toBe(1);
    expect(result.state.order[20]).toBeLessThan(result.state.order[30]);
  });

  it('skips (without throwing) a moved id that is not present in userstoriesRaw', () => {
    const state = threeCardState();
    let result!: KanbanMoveResult;
    expect(() => {
      result = move(state, [999], 3, null, 0, null, null);
    }).not.toThrow();
    // The payload still carries the requested id (the server contract is by id).
    expect(result.payload.bulkUserstories).toEqual([999]);
    // But no phantom raw model is created for the missing id.
    expect(getUsModel(result.state, 999)).toBeUndefined();
  });

  it('is pure - input order and raw models are not mutated', () => {
    const state = threeCardState();
    const clone = deepClone(state);
    move(state, [20], 2, 10, 1, 10, 30);
    expect(state).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase J - moveToEnd (SERVER-OBSERVABLE)
 * ================================================================== */

describe('moveToEnd', () => {
  it('returns the exact { us_id, order:-1 } payload and applies the -1 sentinel', () => {
    const state = threeCardState();
    const r: KanbanMoveToEndResult = moveToEnd(state, 20, 5);

    expect(r.payload).toStrictEqual({ us_id: 20, order: -1 });
    expect(r.state.order[20]).toBe(-1);
    expect(getUsModel(r.state, 20)!.status).toBe(5);
    expect(getUsModel(r.state, 20)!.kanban_order).toBe(-1);
    expect(r.state).not.toBe(state);
  });

  it('is pure - input is unchanged', () => {
    const state = threeCardState();
    const clone = deepClone(state);
    moveToEnd(state, 20, 5);
    expect(state).toEqual(clone);
  });
});


/* ================================================================== *
 * Phase K - collection sync: set, initUsByStatusList
 * ================================================================== */

describe('set', () => {
  it('populates userstoriesRaw, rebuilds order, and builds STRING-keyed usByStatus + usMap', () => {
    const result = set(reset(), [
      makeUs({ id: 1, status: 1, kanban_order: 0 }),
      makeUs({ id: 3, status: 3, kanban_order: 1 }),
    ]);

    expect(result.userstoriesRaw.map((u) => u.id)).toEqual([1, 3]);
    expect(result.order).toEqual({ 1: 0, 3: 1 });

    // usByStatus keys are STRINGS.
    const keys = Object.keys(result.usByStatus);
    expect(keys.sort()).toEqual(['1', '3']);
    keys.forEach((k) => expect(typeof k).toBe('string'));

    // Values are number[] of ids.
    expect(result.usByStatus['1']).toEqual([1]);
    expect(result.usByStatus['3']).toEqual([3]);

    // usMap has a view-model for each story.
    expect(result.usMap[1].id).toBe(1);
    expect(result.usMap[3].id).toBe(3);
  });

  it('orders each status list ascending by order', () => {
    const result = set(reset(), [
      makeUs({ id: 1, status: 1, kanban_order: 2 }),
      makeUs({ id: 2, status: 1, kanban_order: 0 }),
      makeUs({ id: 3, status: 1, kanban_order: 1 }),
    ]);
    expect(result.usByStatus['1']).toEqual([2, 3, 1]);
  });
});

describe('initUsByStatusList', () => {
  it('creates a (string-keyed) empty column for a status with no existing list', () => {
    const result = initUsByStatusList(reset(), [makeUs({ id: 1, status: 7 })]);
    expect('7' in result.usByStatus).toBe(true);
    expect(result.usByStatus['7']).toEqual([]);
    Object.keys(result.usByStatus).forEach((k) => expect(typeof k).toBe('string'));
  });

  it('preserves an existing status column', () => {
    const base = set(reset(), [makeUs({ id: 1, status: 1, kanban_order: 0 })]);
    expect(base.usByStatus['1']).toEqual([1]);
    const result = initUsByStatusList(base, [makeUs({ id: 2, status: 1 })]);
    // Existing column is not wiped.
    expect(result.usByStatus['1']).toEqual([1]);
  });
});

/* ================================================================== *
 * Phase L - remove
 * ================================================================== */

describe('remove', () => {
  it('removes a story from every projection and re-runs the swimlane refresh', () => {
    const s = seededBoard();
    const raw = getUsModel(s, 3)!; // status 3, swimlane 20
    const result = remove(s, raw);

    expect(result.userstoriesRaw.find((u) => u.id === 3)).toBeUndefined();
    expect(result.order).not.toHaveProperty('3');
    expect(result.usMap[3]).toBeUndefined();
    expect(result.usByStatus['3']).not.toContain(3);
    expect(result.usByStatus['3']).toEqual([4]);

    // Swimlanes were configured, so usByStatusSwimlanes was rebuilt and no
    // longer references the removed id in any bucket.
    for (const swimlaneKey of Object.keys(result.usByStatusSwimlanes)) {
      const perStatus = result.usByStatusSwimlanes[Number(swimlaneKey)];
      for (const statusKey of Object.keys(perStatus)) {
        expect(perStatus[Number(statusKey)]).not.toContain(3);
      }
    }
  });

  it('is pure', () => {
    const s = seededBoard();
    const raw = getUsModel(s, 3)!;
    const clone = deepClone(s);
    remove(s, raw);
    expect(s).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase M - add (dedup + "don't overwrite existing usMap" guard)
 * ================================================================== */

describe('add', () => {
  it('coerces a single story argument into an array', () => {
    const result = add(reset(), makeUs({ id: 1, status: 3, kanban_order: 0 }));
    expect(result.userstoriesRaw.map((u) => u.id)).toEqual([1]);
    expect(result.usMap[1].id).toBe(1);
    expect(result.usByStatus['3']).toEqual([1]);
  });

  it('dedupes against existing raw stories and ends sorted ascending by order', () => {
    const base = set(reset(), [
      makeUs({ id: 1, status: 3, kanban_order: 0 }),
      makeUs({ id: 2, status: 3, kanban_order: 5 }),
    ]);
    // Add stories out of kanban_order order and re-include existing id 1.
    const result = add(base, [
      makeUs({ id: 3, status: 3, kanban_order: 2 }),
      makeUs({ id: 1, status: 3, kanban_order: 0 }),
    ]);

    const rawIds = result.userstoriesRaw.map((u) => u.id);
    // No duplicate ids.
    expect(new Set(rawIds).size).toBe(rawIds.length);
    // Sorted ascending by order (1@0, 3@2, 2@5).
    expect(rawIds).toEqual([1, 3, 2]);
  });

  it('preserves an existing usMap entry (the if(!usMap[id]) guard)', () => {
    const base = set(reset(), [makeUs({ id: 5, status: 3, kanban_order: 0 })]);
    // Pre-seed a SENTINEL view-model for id 5.
    const sentinel = makeUsData({ id: 5, marker: 'SENTINEL' });
    const withSentinel = replace(base, sentinel);
    expect(withSentinel.usMap[5]).toBe(sentinel);

    const result = add(withSentinel, [makeUs({ id: 5, status: 3, kanban_order: 0 })]);
    // The guard prevents overwriting - the sentinel survives.
    expect(result.usMap[5].marker).toBe('SENTINEL');
    expect(result.usMap[5]).toEqual(sentinel);
  });

  it('populates usMap and appends to usByStatus for a brand-new id', () => {
    const base = set(reset(), [makeUs({ id: 5, status: 3, kanban_order: 0 })]);
    const result = add(base, [makeUs({ id: 6, status: 4, kanban_order: 1 })]);

    expect(result.usMap[6]).toBeDefined();
    expect(result.usMap[6].id).toBe(6);
    // usByStatus['4'] is created and the new id appended.
    expect(result.usByStatus['4']).toContain(6);
  });

  it('is pure', () => {
    const base = set(reset(), [makeUs({ id: 1, status: 3, kanban_order: 0 })]);
    const clone = deepClone(base);
    add(base, [makeUs({ id: 2, status: 3, kanban_order: 1 })]);
    expect(base).toEqual(clone);
  });
});

/* ================================================================== *
 * Phase N - replace, replaceModel, refreshUserStory
 * ================================================================== */

describe('replace', () => {
  it('stores the given view-model under its id in usMap', () => {
    const vm = makeUsData({ id: 7, marker: 'X' });
    const result = replace(reset(), vm);
    expect(result.usMap[7]).toEqual(vm);
    expect(result.usMap[7].marker).toBe('X');
  });

  it('is pure', () => {
    const base = reset();
    const clone = deepClone(base);
    replace(base, makeUsData({ id: 7 }));
    expect(base).toEqual(clone);
  });
});

describe('replaceModel', () => {
  it('replaces the matching raw model by id and recomputes its view-model', () => {
    const base = seededBoard();
    const replacement = makeUs({
      id: 3,
      status: 9,
      swimlane: 5,
      kanban_order: 2,
      assigned_to: 1,
      assigned_users: [1],
    });
    const result = replaceModel(base, replacement);

    // Raw model swapped.
    expect(getUsModel(result, 3)).toEqual(replacement);
    // usMap[3] recomputed from the replacement raw.
    expect(result.usMap[3].model.status).toBe(9);
    expect(result.usMap[3].model.swimlane).toBe(5);
    // Derived fields recomputed via retrieveUserStoryData (assigned_to resolved).
    expect(result.usMap[3].assigned_to).toEqual({ id: 1 });
  });

  it('is pure', () => {
    const base = seededBoard();
    const clone = deepClone(base);
    replaceModel(base, makeUs({ id: 3, status: 9 }));
    expect(base).toEqual(clone);
  });
});

describe('refreshUserStory', () => {
  it('recomputes only the target view-model and leaves siblings untouched', () => {
    const base = seededBoard();
    const expected = retrieveUserStoryData(getUsModel(base, 1)!, base.foldStatusChanged, base.usersById);
    const result = refreshUserStory(base, 1);

    expect(result.usMap[1]).toEqual(expected);
    // Sibling entries are structurally shared (immer).
    expect(result.usMap[2]).toBe(base.usMap[2]);
  });

  it('is a no-op for an unknown id (no throw) and pure', () => {
    const base = seededBoard();
    const clone = deepClone(base);
    expect(() => refreshUserStory(base, 99999)).not.toThrow();
    expect(base).toEqual(clone);
  });
});


/* ================================================================== *
 * Phase O - retrieveUserStoryData (pure helper called DIRECTLY)
 * ================================================================== */

describe('retrieveUserStoryData', () => {
  it('passes through foldStatusChanged[id] (true when set, undefined otherwise)', () => {
    const us = makeUs({ id: 1 });
    expect(retrieveUserStoryData(us, { 1: true }, {}).foldStatusChanged).toBe(true);
    expect(retrieveUserStoryData(us, {}, {}).foldStatusChanged).toBeUndefined();
  });

  it('mirrors the raw model, id and swimlane', () => {
    const us = makeUs({ id: 42, swimlane: 10 });
    const data = retrieveUserStoryData(us, {}, {});
    expect(data.model).toEqual(us);
    expect(data.id).toBe(42);
    expect(data.swimlane).toBe(10);
  });

  it('filters images to attachments with a truthy thumbnail_card_url', () => {
    const us = makeUs({
      id: 1,
      attachments: [
        { thumbnail_card_url: 'a.png' },
        { thumbnail_card_url: null },
        { thumbnail_card_url: '' },
        {},
      ],
    });
    const data = retrieveUserStoryData(us, {}, {});
    expect(data.images).toHaveLength(1);
    expect(data.images[0].thumbnail_card_url).toBe('a.png');
  });

  it('resolves assigned_to via usersById, or undefined when null/missing', () => {
    const usersById = { 2: makeUser(2) };
    expect(retrieveUserStoryData(makeUs({ id: 1, assigned_to: 2 }), {}, usersById).assigned_to).toEqual({ id: 2 });
    expect(retrieveUserStoryData(makeUs({ id: 1, assigned_to: null }), {}, usersById).assigned_to).toBeUndefined();
    expect(retrieveUserStoryData(makeUs({ id: 1, assigned_to: 999 }), {}, usersById).assigned_to).toBeUndefined();
  });

  it('resolves assigned_users, skipping ids missing from usersById and preserving order', () => {
    const usersById = makeUsersById(1, 2);
    const data = retrieveUserStoryData(makeUs({ id: 1, assigned_users: [1, 2, 999] }), {}, usersById);
    expect(data.assigned_users).toHaveLength(2);
    expect(data.assigned_users.map((u) => u.id)).toEqual([1, 2]);
  });

  it('takes the first three resolved users for assigned_users_preview', () => {
    const usersById = makeUsersById(1, 2, 3, 4, 5);
    const data = retrieveUserStoryData(makeUs({ id: 1, assigned_users: [1, 2, 3, 4, 5] }), {}, usersById);
    expect(data.assigned_users_preview).toHaveLength(3);
    expect(data.assigned_users_preview.map((u) => u.id)).toEqual([1, 2, 3]);
  });

  it('maps colorized_tags from [name, color] tuples, defaulting to [] for empty/missing tags', () => {
    const withTags = retrieveUserStoryData(
      makeUs({ id: 1, tags: [['bug', '#f00'], ['ui', null]] }),
      {},
      {},
    );
    expect(withTags.colorized_tags).toEqual([
      { name: 'bug', color: '#f00' },
      { name: 'ui', color: null },
    ]);

    // Empty tags -> [].
    expect(retrieveUserStoryData(makeUs({ id: 1, tags: [] }), {}, {}).colorized_tags).toEqual([]);
    // Missing tags (undefined) -> [] (the ?? [] guard).
    const noTags = makeUs({ id: 1 });
    delete (noTags as { tags?: unknown }).tags;
    expect(retrieveUserStoryData(noTags, {}, {}).colorized_tags).toEqual([]);
  });
});

/* ================================================================== *
 * Phase P - refresh (string keys, dedup, refreshUsMap + refreshSwimlanes flags)
 * ================================================================== */

describe('refresh', () => {
  it('rebuilds STRING-keyed usByStatus, sorted ascending by order with no duplicate ids', () => {
    const base = set(reset(), [
      makeUs({ id: 1, status: 1, kanban_order: 2 }),
      makeUs({ id: 2, status: 1, kanban_order: 0 }),
      makeUs({ id: 3, status: 3, kanban_order: 1 }),
    ]);
    const result = refresh(base);

    Object.keys(result.usByStatus).forEach((k) => expect(typeof k).toBe('string'));
    // status 1 sorted by order: 2 (@0) before 1 (@2).
    expect(result.usByStatus['1']).toEqual([2, 1]);
    expect(result.usByStatus['3']).toEqual([3]);
    // No duplicate ids within a status list.
    for (const list of Object.values(result.usByStatus)) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('with refreshUsMap=false leaves an existing usMap entry untouched', () => {
    const base = set(reset(), [makeUs({ id: 1, status: 1, kanban_order: 0 })]);
    const withSentinel = replace(base, makeUsData({ id: 1, marker: 'SENT' }));
    const result = refresh(withSentinel, false);
    // usByStatus recomputed...
    expect(result.usByStatus['1']).toEqual([1]);
    // ...but usMap NOT rebuilt.
    expect(result.usMap[1].marker).toBe('SENT');
  });

  it('with refreshUsMap=true (default) rebuilds usMap for every raw story', () => {
    const base = set(reset(), [makeUs({ id: 1, status: 1, kanban_order: 0 })]);
    const withSentinel = replace(base, makeUsData({ id: 1, marker: 'SENT' }));
    const result = refresh(withSentinel, true);
    expect(result.usMap[1].marker).toBeUndefined();
    expect(result.usMap[1].model.id).toBe(1);
  });

  it('respects the refreshSwimlanes flag', () => {
    // Tamper the swimlane projection with a sentinel key that a real rebuild
    // could never produce, so we can tell whether the rebuild ran.
    const tampered: KanbanState = {
      ...seededBoard(),
      usByStatusSwimlanes: { 999: { 1: [424242] } },
    };

    // Flag false: swimlane projection is preserved (sentinel survives).
    const notRebuilt = refresh(tampered, true, false);
    expect(notRebuilt.usByStatusSwimlanes[999]).toEqual({ 1: [424242] });

    // Flag true (default): swimlane projection is rebuilt (sentinel gone).
    const rebuilt = refresh(tampered, true, true);
    expect(rebuilt.usByStatusSwimlanes[999]).toBeUndefined();
    expect(rebuilt.usByStatusSwimlanes[10]).toBeDefined();
  });
});

/* ================================================================== *
 * Phase Q - refreshSwimlanes (synthetic -1 swimlane, NUMBER inner keys)
 * ================================================================== */

describe('refreshSwimlanes', () => {
  it('early-returns (no throw) when no swimlanes are configured', () => {
    const s = set(reset(), [makeUs({ id: 1, swimlane: null })]);
    expect(s.swimlanes).toEqual([]);
    let result!: KanbanState;
    expect(() => {
      result = refreshSwimlanes(s);
    }).not.toThrow();
    expect(result.swimlanesList).toEqual([]);
    expect(result.usByStatusSwimlanes).toEqual({});
  });

  it('inserts the synthetic unclassified swimlane at index 0 when a null-swimlane story exists', () => {
    const s = seededBoard();
    expect(s.swimlanesList[0]).toEqual({
      id: -1,
      kanban_order: 1,
      name: s.unclassifiedLabel,
    });
    // The configured swimlanes follow the synthetic one.
    const ids = s.swimlanesList.map((sw) => sw.id);
    expect(ids).toContain(10);
    expect(ids).toContain(20);
    expect(ids[0]).toBe(-1);
  });

  it('uses the injected unclassified label for the synthetic swimlane', () => {
    const s = seededBoard('Sin clasificar');
    expect(s.swimlanesList[0].name).toBe('Sin clasificar');
  });

  it('does NOT insert a synthetic swimlane when every story has a real swimlane', () => {
    let s = init(reset(), { id: 1 }, [makeSwimlane(10)], {});
    s = set(s, [
      makeUs({ id: 1, status: 1, swimlane: 10, kanban_order: 0 }),
      makeUs({ id: 2, status: 1, swimlane: 10, kanban_order: 1 }),
    ]);
    expect(s.swimlanesList.every((sw) => sw.id !== -1)).toBe(true);
  });

  it('maps swimlane id -1 to the API null swimlane and uses NUMBER inner keys', () => {
    const s = seededBoard();

    // Outer keys are swimlane ids, including -1.
    expect(s.usByStatusSwimlanes[-1]).toBeDefined();
    expect(s.usByStatusSwimlanes[10]).toBeDefined();
    expect(s.usByStatusSwimlanes[20]).toBeDefined();

    // -1 bucket contains ids whose model.swimlane === null.
    expect(s.usByStatusSwimlanes[-1][1]).toEqual([1]); // us1: status1, swimlane null
    expect(s.usByStatusSwimlanes[-1][3]).toEqual([4]); // us4: status3, swimlane null

    // swimlane 10 bucket contains ids whose model.swimlane === 10.
    expect(s.usByStatusSwimlanes[10][1]).toEqual([2]); // us2
    expect(s.usByStatusSwimlanes[10][2]).toEqual([5]); // us5

    // swimlane 20 bucket contains ids whose model.swimlane === 20.
    expect(s.usByStatusSwimlanes[20][3]).toEqual([3]); // us3

    // Inner keys coerce to NUMBERS (the coffee Number(statusId)).
    const innerKeys = Object.keys(s.usByStatusSwimlanes[10]).map(Number);
    expect(innerKeys).toContain(1);
    expect(innerKeys).toContain(2);
    expect(innerKeys).toContain(3);
    // Numeric access works.
    expect(s.usByStatusSwimlanes[10][3]).toEqual([]);
  });

  it('cross-checks: the union of per-swimlane buckets for a status equals usByStatus[status]', () => {
    const s = seededBoard();
    const swimlaneIds = Object.keys(s.usByStatusSwimlanes).map(Number);

    for (const statusStr of Object.keys(s.usByStatus)) {
      const statusNum = Number(statusStr);
      const union: number[] = [];
      for (const swId of swimlaneIds) {
        union.push(...(s.usByStatusSwimlanes[swId][statusNum] ?? []));
      }
      // Every card appears in exactly one swimlane bucket, so the union (as a
      // set) equals the flat usByStatus column.
      expect(new Set(union)).toEqual(new Set(s.usByStatus[statusStr]));
      expect(union.length).toBe(s.usByStatus[statusStr].length);
    }
  });

  it('is pure', () => {
    const base = seededBoard();
    const clone = deepClone(base);
    refreshSwimlanes(base);
    expect(base).toEqual(clone);
  });
});

/* ================================================================== *
 * Defensive branch coverage - the internal stable-sort orders stories with a
 * MISSING order entry (undefined key) LAST, reproducing lodash `_.sortBy`
 * semantics. Exercised through `refresh`, which sorts userstoriesRaw by
 * `order[id]`. A raw story without an order entry yields an undefined key.
 * ================================================================== */

describe('stable-sort undefined-key handling (via refresh)', () => {
  it('orders a story whose order entry is missing AFTER one that has it (undefined first in input)', () => {
    const partial: KanbanState = {
      ...reset(),
      userstoriesRaw: [makeUs({ id: 1, status: 1 }), makeUs({ id: 2, status: 1 })],
      order: { 2: 0 }, // id 1 has no order entry -> undefined key
    };
    const result = refresh(partial);
    // Undefined-key story (1) sorts last.
    expect(result.usByStatus['1']).toEqual([2, 1]);
  });

  it('orders a story whose order entry is missing AFTER one that has it (defined first in input)', () => {
    const partial: KanbanState = {
      ...reset(),
      userstoriesRaw: [makeUs({ id: 1, status: 1 }), makeUs({ id: 2, status: 1 })],
      order: { 1: 0 }, // id 2 has no order entry -> undefined key
    };
    const result = refresh(partial);
    expect(result.usByStatus['1']).toEqual([1, 2]);
  });

  it('keeps defined-key stories in ascending order with an undefined-key story between them', () => {
    const partial: KanbanState = {
      ...reset(),
      userstoriesRaw: [
        makeUs({ id: 1, status: 1 }),
        makeUs({ id: 2, status: 1 }),
        makeUs({ id: 3, status: 1 }),
      ],
      order: { 1: 1, 3: 0 }, // id 2 has no order entry -> undefined key, sorts last
    };
    const result = refresh(partial);
    expect(result.usByStatus['1']).toEqual([3, 1, 2]);
  });
});

/* ================================================================== *
 * Defensive fallback branches - the reducer tolerates partial/abnormal
 * inputs via `?? []` / `?.` guards. These are part of the documented
 * contract (e.g. `reset` accepts a Partial<KanbanState>; `attachments` is
 * optional on UserStory), so they are exercised explicitly.
 * ================================================================== */

describe('defensive fallback branches', () => {
  it('reset falls back to empty arrays when a partial prev omits the preserved fields', () => {
    // `reset`'s signature accepts a Partial<KanbanState>. With the flags set to
    // preserve but the source missing those fields, each `?? []` fallback fires.
    const partialPrev: Partial<KanbanState> = { project: { id: 5 } };
    const s = reset(partialPrev, false, false, false);
    expect(s.swimlanesList).toEqual([]);
    expect(s.statusHide).toEqual([]);
    expect(s.archivedStatus).toEqual([]);
    expect(s.project).toEqual({ id: 5 });
    // usersById / unclassifiedLabel fall back to their defaults.
    expect(s.usersById).toEqual({});
    expect(s.unclassifiedLabel).toBe(DEFAULT_UNCLASSIFIED_LABEL);
  });

  it('retrieveUserStoryData tolerates undefined attachments (images -> [])', () => {
    const us = makeUs({ id: 1 });
    delete (us as { attachments?: unknown }).attachments;
    expect(retrieveUserStoryData(us, {}, {}).images).toEqual([]);
  });

  it('retrieveUserStoryData tolerates a non-array assigned_users (assigned_users -> [])', () => {
    const us = makeUs({ id: 1 });
    (us as { assigned_users: unknown }).assigned_users = null;
    const data = retrieveUserStoryData(us, {}, {});
    expect(data.assigned_users).toEqual([]);
    expect(data.assigned_users_preview).toEqual([]);
  });

  it('remove tolerates a story whose status column was never built', () => {
    const base = set(reset(), [makeUs({ id: 1, status: 1 })]);
    const orphan = makeUs({ id: 2, status: 99 }); // status 99 absent from usByStatus
    let result!: KanbanState;
    expect(() => {
      result = remove(base, orphan);
    }).not.toThrow();
    expect(result.usByStatus['99']).toEqual([]);
    // The unrelated existing column is untouched.
    expect(result.usByStatus['1']).toEqual([1]);
  });

  it('refreshSwimlanes skips ids that are missing from usMap (optional-chaining guard)', () => {
    // usByStatus references id 777 which has no usMap entry; the `usMap[id]?.`
    // guard short-circuits so 777 is simply excluded from the swimlane bucket.
    const inconsistent: KanbanState = {
      ...reset(),
      swimlanes: [makeSwimlane(10)],
      userstoriesRaw: [makeUs({ id: 1, status: 1, swimlane: 10 })],
      usByStatus: { '1': [1, 777] },
      usMap: { 1: makeUsData({ id: 1, swimlane: 10, model: makeUs({ id: 1, swimlane: 10 }) }) },
      order: { 1: 0 },
    };
    let result!: KanbanState;
    expect(() => {
      result = refreshSwimlanes(inconsistent);
    }).not.toThrow();
    expect(result.usByStatusSwimlanes[10][1]).toEqual([1]);
  });
});

/* ================================================================== *
 * Phase S - global purity / immutability sweep
 *
 * Every mutating producer must leave its input state deep-equal to a pre-call
 * clone (immer never mutates the input). This documents the immutability
 * contract and adds broad line coverage cheaply.
 * ================================================================== */

describe('immutability sweep - producers never mutate their input', () => {
  const runners: Array<[string, (s: KanbanState) => unknown]> = [
    ['init', (s) => init(s, { id: 1 }, [makeSwimlane(10)], makeUsersById(1))],
    ['resetFolds', (s) => resetFolds(s)],
    ['toggleFold', (s) => toggleFold(s, 1)],
    ['addArchivedStatus', (s) => addArchivedStatus(s, 3)],
    ['hideStatus', (s) => hideStatus(s, 3)],
    ['showStatus', (s) => showStatus(s, 3)],
    ['deleteStatus', (s) => deleteStatus(s, 3)],
    ['refreshRawOrder', (s) => refreshRawOrder(s)],
    ['assignOrders', (s) => assignOrders(s, { 1: 5 })],
    ['set', (s) => set(s, [makeUs({ id: 1 })])],
    ['initUsByStatusList', (s) => initUsByStatusList(s, [makeUs({ id: 1, status: 7 })])],
    ['remove', (s) => remove(s, getUsModel(s, 1)!)],
    ['add', (s) => add(s, [makeUs({ id: 999, status: 1 })])],
    ['replace', (s) => replace(s, makeUsData({ id: 1 }))],
    ['replaceModel', (s) => replaceModel(s, makeUs({ id: 1, status: 2 }))],
    ['refreshUserStory', (s) => refreshUserStory(s, 1)],
    ['refresh', (s) => refresh(s)],
    ['refreshSwimlanes', (s) => refreshSwimlanes(s)],
    ['move', (s) => move(s, [1], 1, null, 0, null, null).state],
    ['moveToEnd', (s) => moveToEnd(s, 1, 2).state],
  ];

  it.each(runners)('%s does not mutate the input', (_name, run) => {
    const seeded = seededBoard();
    const clone = deepClone(seeded);
    run(seeded);
    expect(seeded).toEqual(clone);
  });
});

