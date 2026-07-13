/*
 * Copyright (c) 2021-present Kaleidos INC
 *
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Unit tests for the Backlog state producers (backlogState.ts) — verifies
 * payload shapes, order maps, pendingDrag coalescing, and optimistic moves.
 */

import {
  createInitialBacklogState,
  buildBacklogOrder,
  buildMilestonesOrder,
  prepareBulkUpdateData,
  buildBacklogOrderPayload,
  buildMilestonePayload,
  enqueueDrag,
  shiftDrag,
  hasPendingDrag,
  shouldCoalesceDrag,
  peekDrag,
  applyOptimisticMove,
  reconcileMovedStory,
  setUserstories,
  setSprints,
  setClosedSprints,
  moveMetadata,
} from "./index";
import type { BacklogState, PendingDragItem } from "./index";
import type { UserStory, Milestone } from "../types";

/* ------------------------------------------------------------------------- *
 * Test data helpers
 *
 * The `as UserStory` / `as Milestone` casts let the factories build the minimal
 * shape each producer actually reads (id + a couple of order/relationship
 * fields) without having to populate every required model field — mirroring the
 * partial fixtures the legacy Karma specs used.
 * ------------------------------------------------------------------------- */

const us = (id: number, extra: Partial<UserStory> = {}): UserStory =>
  ({ id, ...extra } as UserStory);

const sprint = (id: number, user_stories: UserStory[] = []): Milestone =>
  ({ id, name: `S${id}`, user_stories } as Milestone);

/**
 * Build the canonical `[1, 2, 3]` backlog used by the same-container reorder and
 * legacy top-drop cases. Stories carry ascending `backlog_order` so
 * `setUserstories`' sort yields a deterministic `[1, 2, 3]`.
 */
const backlog123 = (): BacklogState =>
  setUserstories(createInitialBacklogState(), [
    us(1, { milestone: null, backlog_order: 1 }),
    us(2, { milestone: null, backlog_order: 2 }),
    us(3, { milestone: null, backlog_order: 3 }),
  ]);

/* ------------------------------------------------------------------------- *
 * createInitialBacklogState
 * ------------------------------------------------------------------------- */

describe("createInitialBacklogState", () => {
  it("returns a fully-empty state", () => {
    expect(createInitialBacklogState()).toEqual({
      userstories: [],
      sprints: [],
      closedSprints: [],
      backlogOrder: {},
      milestonesOrder: {},
      pendingDrag: [],
    });
  });
});

/* ------------------------------------------------------------------------- *
 * Order-map builders
 * ------------------------------------------------------------------------- */

describe("buildBacklogOrder", () => {
  it("maps user-story id -> backlog_order", () => {
    expect(
      buildBacklogOrder([
        us(1, { backlog_order: 100 }),
        us(2, { backlog_order: 200 }),
      ]),
    ).toEqual({ 1: 100, 2: 200 });
  });
});

describe("buildMilestonesOrder", () => {
  it("maps sprint id -> (us id -> sprint_order)", () => {
    expect(
      buildMilestonesOrder([
        sprint(9, [
          us(1, { sprint_order: 1 }),
          us(2, { sprint_order: 2 }),
        ]),
      ]),
    ).toEqual({ 9: { 1: 1, 2: 2 } });
  });
});

/* ------------------------------------------------------------------------- *
 * prepareBulkUpdateData
 * ------------------------------------------------------------------------- */

describe("prepareBulkUpdateData", () => {
  it("defaults to the backlog_order field", () => {
    expect(
      prepareBulkUpdateData([
        us(1, { backlog_order: 10 }),
        us(2, { backlog_order: 20 }),
      ]),
    ).toEqual([
      { us_id: 1, order: 10 },
      { us_id: 2, order: 20 },
    ]);
  });

  it("reads an explicit order field (sprint_order)", () => {
    expect(prepareBulkUpdateData([us(1, { sprint_order: 4 })], "sprint_order")).toEqual([
      { us_id: 1, order: 4 },
    ]);
  });
});

/* ------------------------------------------------------------------------- *
 * buildBacklogOrderPayload — snake_case body with optional keys OMITTED
 * ------------------------------------------------------------------------- */

describe("buildBacklogOrderPayload", () => {
  it("includes milestone_id + after_userstory_id when both are provided", () => {
    expect(buildBacklogOrderPayload(7, 3, 42, null, [1, 2])).toEqual({
      project_id: 7,
      bulk_userstories: [1, 2],
      milestone_id: 3,
      after_userstory_id: 42,
    });
  });

  it("omits milestone_id and after_userstory_id, keeping only before_userstory_id", () => {
    expect(buildBacklogOrderPayload(7, null, null, 99, [5])).toEqual({
      project_id: 7,
      bulk_userstories: [5],
      before_userstory_id: 99,
    });
  });

  it("emits neither after nor before when both are null", () => {
    expect(buildBacklogOrderPayload(7, 3, null, null, [5])).toEqual({
      project_id: 7,
      bulk_userstories: [5],
      milestone_id: 3,
    });
  });

  it("gives after_userstory_id precedence over before_userstory_id (ELSE IF)", () => {
    const payload = buildBacklogOrderPayload(7, null, 42, 99, [5]);
    expect(payload.after_userstory_id).toBe(42);
    // Mutually exclusive: when `after` wins, `before` must be entirely absent.
    expect(payload).not.toHaveProperty("before_userstory_id");
  });
});

/* ------------------------------------------------------------------------- *
 * buildMilestonePayload
 * ------------------------------------------------------------------------- */

describe("buildMilestonePayload", () => {
  it("wraps the bulk_stories entries in the snake_case body", () => {
    expect(
      buildMilestonePayload(7, 3, [
        { us_id: 1, order: 4 },
        { us_id: 2, order: 5 },
      ]),
    ).toEqual({
      project_id: 7,
      milestone_id: 3,
      bulk_stories: [
        { us_id: 1, order: 4 },
        { us_id: 2, order: 5 },
      ],
    });
  });
});

/* ------------------------------------------------------------------------- *
 * pendingDrag queue helpers + coalescing gate
 * ------------------------------------------------------------------------- */

describe("pendingDrag queue helpers", () => {
  const item1: PendingDragItem = {
    usList: [us(1, { milestone: null })],
    newUsIndex: 0,
    newSprintId: null,
    previousUs: null,
    nextUs: 2,
  };
  const item2: PendingDragItem = {
    usList: [us(2, { milestone: null })],
    newUsIndex: 1,
    newSprintId: null,
    previousUs: 1,
    nextUs: null,
  };

  it("enqueues a single move: hasPendingDrag true, shouldCoalesceDrag false", () => {
    let s = createInitialBacklogState();
    s = enqueueDrag(s, item1);

    expect(hasPendingDrag(s)).toBe(true);
    // A single queued move is drained immediately -> the API call IS made.
    expect(shouldCoalesceDrag(s)).toBe(false);
  });

  it("coalesces once a second move is queued and peeks the head (FIFO)", () => {
    let s = createInitialBacklogState();
    s = enqueueDrag(s, item1);
    s = enqueueDrag(s, item2);

    // More than one queued -> the just-enqueued move coalesces (API call skipped).
    expect(shouldCoalesceDrag(s)).toBe(true);
    // peekDrag returns the FIRST enqueued item (head of the queue).
    expect(peekDrag(s)).toEqual(item1);
  });

  it("shiftDrag removes the head until the queue is empty", () => {
    let s = createInitialBacklogState();
    s = enqueueDrag(s, item1);
    s = enqueueDrag(s, item2);

    s = shiftDrag(s);
    expect(s.pendingDrag).toHaveLength(1);
    expect(hasPendingDrag(s)).toBe(true);
    // The head advanced to the second item.
    expect(peekDrag(s)).toEqual(item2);

    s = shiftDrag(s);
    expect(hasPendingDrag(s)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * applyOptimisticMove
 * ------------------------------------------------------------------------- */

describe("applyOptimisticMove", () => {
  it("moves a story from the backlog into a sprint (cross-container)", () => {
    let s = createInitialBacklogState();
    s = setUserstories(s, [
      us(1, { milestone: null, backlog_order: 1 }),
      us(2, { milestone: null, backlog_order: 2 }),
    ]);
    s = setSprints(s, [sprint(9, [])]);

    s = applyOptimisticMove(s, {
      usList: [us(1, { milestone: null })],
      newUsIndex: 0,
      newSprintId: 9,
      previousUs: null,
      nextUs: null,
    });

    // Story 1 left the backlog.
    expect(s.userstories.map((u) => u.id)).toEqual([2]);
    // ...and landed in sprint 9 with its milestone re-pointed.
    expect(s.sprints[0].user_stories!.map((u) => u.id)).toEqual([1]);
    expect(s.sprints[0].user_stories![0].milestone).toBe(9);
  });

  it("reorders within the backlog (same-container): id 3 after id 1", () => {
    let s = backlog123();

    s = applyOptimisticMove(s, {
      usList: [us(3, { milestone: null })],
      newUsIndex: 1,
      newSprintId: null,
      previousUs: 1,
      nextUs: 2,
    });

    expect(s.userstories.map((u) => u.id)).toEqual([1, 3, 2]);
  });

  it("replicates the LEGACY top-drop quirk: nextUs-only drop lands at the FRONT", () => {
    // LEGACY QUIRK (faithful replication, NOT a bug fix): in legacy `moveUs` both
    // the `if previousUs` and the `else if nextUs` branches compute the position by
    // searching for `previousUs`. On a top-of-list drop `previousUs` is null, so
    // findIndex returns -1, `position++` turns it into 0, and the story is inserted
    // at position 0. This asserts that exact behavioral parity.
    let s = backlog123();

    s = applyOptimisticMove(s, {
      usList: [us(3, { milestone: null })],
      newUsIndex: 0,
      newSprintId: null,
      previousUs: null,
      nextUs: 1,
    });

    expect(s.userstories.map((u) => u.id)).toEqual([3, 1, 2]);
  });

  it("moves a story from a sprint back into the backlog (cross-container)", () => {
    let s = createInitialBacklogState();
    s = setSprints(s, [
      sprint(9, [
        us(1, { milestone: 9, sprint_order: 1 }),
        us(2, { milestone: 9, sprint_order: 2 }),
      ]),
    ]);
    s = setUserstories(s, [us(5, { milestone: null, backlog_order: 1 })]);

    s = applyOptimisticMove(s, {
      usList: [us(1, { milestone: 9 })],
      newUsIndex: 0,
      newSprintId: null,
      previousUs: null,
      nextUs: null,
    });

    // Story 1 left sprint 9...
    expect(s.sprints[0].user_stories!.map((u) => u.id)).toEqual([2]);
    // ...and landed at the front of the backlog with its milestone cleared.
    expect(s.userstories.map((u) => u.id)).toEqual([1, 5]);
    expect(s.userstories[0].milestone).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * reconcileMovedStory
 * ------------------------------------------------------------------------- */

describe("reconcileMovedStory", () => {
  it("updates milestone + backlog_order for a story living in a sprint", () => {
    let s = createInitialBacklogState();
    s = setSprints(s, [
      sprint(9, [us(5, { milestone: 9, sprint_order: 1 })]),
    ]);

    s = reconcileMovedStory(s, 5, null, 7);

    const moved = s.sprints[0].user_stories![0];
    expect(moved.id).toBe(5);
    expect(moved.milestone).toBeNull();
    expect(moved.backlog_order).toBe(7);
  });

  it("is a no-op when the story id is not found anywhere", () => {
    let s = createInitialBacklogState();
    s = setUserstories(s, [us(1, { milestone: null, backlog_order: 1 })]);
    s = setSprints(s, [sprint(9, [us(5, { milestone: 9, sprint_order: 1 })])]);

    const before = JSON.stringify(s);
    const after = reconcileMovedStory(s, 999, null, 7);

    expect(after).toEqual(s);
    expect(JSON.stringify(after)).toBe(before);
  });

  it("updates a backlog story and keeps the backlogOrder map in sync", () => {
    let s = createInitialBacklogState();
    s = setUserstories(s, [us(1, { milestone: null, backlog_order: 1 })]);

    s = reconcileMovedStory(s, 1, 5, 99);

    expect(s.userstories[0].milestone).toBe(5);
    expect(s.userstories[0].backlog_order).toBe(99);
    // Because the story lives in the backlog, the order map is kept in sync.
    expect(s.backlogOrder[1]).toBe(99);
  });

  it("locates and updates a story living in a closed sprint", () => {
    let s = createInitialBacklogState();
    s = setClosedSprints(s, [
      sprint(3, [us(7, { milestone: 3, sprint_order: 1 })]),
    ]);

    s = reconcileMovedStory(s, 7, null, 12);

    const moved = s.closedSprints[0].user_stories![0];
    expect(moved.id).toBe(7);
    expect(moved.milestone).toBeNull();
    expect(moved.backlog_order).toBe(12);
  });
});

/* ------------------------------------------------------------------------- *
 * moveMetadata
 * ------------------------------------------------------------------------- */

describe("moveMetadata", () => {
  it("derives old/current sprint, project, and bulk ids for a cross-sprint move", () => {
    expect(moveMetadata([us(1, { milestone: 3, project: 7 })], 9)).toEqual({
      oldSprintId: 3,
      currentSprintId: 9,
      projectId: 7,
      bulkUserstories: [1],
    });
  });

  it("keeps the current sprint id equal to the old one for a same-sprint move", () => {
    expect(moveMetadata([us(1, { milestone: 3, project: 7 })], 3).currentSprintId).toBe(3);
  });

  it("returns null sprint ids for a backlog-to-backlog move", () => {
    const meta = moveMetadata([us(1, { milestone: null, project: 7 })], null);
    expect(meta.oldSprintId).toBeNull();
    expect(meta.currentSprintId).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * setUserstories / setSprints / setClosedSprints — sorting + order maps
 * ------------------------------------------------------------------------- */

describe("setUserstories / setSprints / setClosedSprints", () => {
  it("setUserstories sorts the backlog by backlog_order and rebuilds backlogOrder", () => {
    const s = setUserstories(createInitialBacklogState(), [
      us(2, { backlog_order: 20 }),
      us(1, { backlog_order: 10 }),
    ]);

    expect(s.userstories.map((u) => u.id)).toEqual([1, 2]);
    expect(s.backlogOrder).toEqual({ 1: 10, 2: 20 });
  });

  it("setSprints sorts each sprint's stories by sprint_order and builds milestonesOrder", () => {
    const s = setSprints(createInitialBacklogState(), [
      sprint(9, [
        us(2, { sprint_order: 20 }),
        us(1, { sprint_order: 10 }),
      ]),
    ]);

    expect(s.sprints[0].user_stories!.map((u) => u.id)).toEqual([1, 2]);
    expect(s.milestonesOrder).toEqual({ 9: { 1: 10, 2: 20 } });
  });

  it("setClosedSprints stores the closed-sprint list", () => {
    const s = setClosedSprints(createInitialBacklogState(), [sprint(5)]);

    expect(s.closedSprints).toHaveLength(1);
    expect(s.closedSprints[0].id).toBe(5);
  });
});

/* ------------------------------------------------------------------------- *
 * Purity — producers never mutate their input state
 * ------------------------------------------------------------------------- */

describe("producer purity", () => {
  it("enqueueDrag does not mutate the input state", () => {
    const s = createInitialBacklogState();
    const before = JSON.stringify(s);

    enqueueDrag(s, {
      usList: [us(1, { milestone: null })],
      newUsIndex: 0,
      newSprintId: null,
      previousUs: null,
      nextUs: null,
    });

    expect(JSON.stringify(s)).toBe(before);
    // The original queue is untouched.
    expect(s.pendingDrag).toHaveLength(0);
  });

  it("applyOptimisticMove does not mutate the input state", () => {
    const s = backlog123();
    const before = JSON.stringify(s);

    applyOptimisticMove(s, {
      usList: [us(3, { milestone: null })],
      newUsIndex: 1,
      newSprintId: null,
      previousUs: 1,
      nextUs: 2,
    });

    expect(JSON.stringify(s)).toBe(before);
    // The original ordering is preserved on the input snapshot.
    expect(s.userstories.map((u) => u.id)).toEqual([1, 2, 3]);
  });
});
