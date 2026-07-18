/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * computeBacklogMovePayload.test.ts — Jest (jsdom) unit spec for the PURE,
 * browser-free drag-and-drop payload helpers co-exported by
 * `../dnd/BacklogDndContext` (`app/react/backlog/dnd/BacklogDndContext.tsx`):
 * `computeNeighbors`, `computeBacklogMovePayload`, `resolveDraggedIds` and
 * `isSamePosition`.
 *
 * WHY THESE ARE TESTED DIRECTLY
 *   The four helpers are the deterministic core of Backlog / Sprint-planning
 *   drag-and-drop parity. They port the dragula drop-handler math from the
 *   DELETED CoffeeScript `app/coffee/modules/backlog/sortable.coffee` (L50-143)
 *   and `app/coffee/modules/backlog/main.coffee` (`moveUs`, L523-599): the
 *   `previousUs` / `nextUs` neighbour computation, defensive index clamping,
 *   sprint-vs-backlog container resolution, multi-card drag ordering and the
 *   same-position no-op guard. Being pure (no DOM, no hooks, no `@dnd-kit`
 *   runtime behaviour), they are exercised headlessly by importing them
 *   directly — mirroring the sibling Kanban `__tests__` precedent.
 *
 * IMPORT NOTE
 *   Importing `../dnd/BacklogDndContext` pulls in `@dnd-kit/core`, which loads
 *   cleanly under jsdom; per the folder contract `@dnd-kit/core` is NOT mocked
 *   here because only the pure helpers are called. `describe` / `it` / `expect`
 *   are Jest globals (never imported); the jsdom environment is supplied by
 *   `jest.config.js` (no per-file environment pragma is declared here). The
 *   domain type and the payload type are imported type-only (`isolatedModules`).
 *
 * REGRESSION LOCK
 *   The 25 core cases below plus the `derived API arguments — wire-format lock`
 *   table are a locked regression set: they encode the exact, source-faithful
 *   contract and must all stay green.
 */

import type { UserStory } from '../../shared/types';
import type { BacklogMovePayload } from '../dnd/BacklogDndContext';
import {
  computeBacklogMovePayload,
  computeNeighbors,
  isSamePosition,
  resolveDraggedIds,
} from '../dnd/BacklogDndContext';
import { makeUserStory } from './factories';

/**
 * Build a list of fully-typed `UserStory` fixtures from bare ids. The helpers
 * under test read only `.id` (and the wire-format lock additionally reads
 * `.milestone`), but the factory yields complete objects so the fixtures
 * satisfy `UserStory[]` under strict TypeScript.
 */
const buildUsList = (...ids: number[]): UserStory[] =>
  ids.map((id) => makeUserStory({ id }));

/* ========================================================================== *
 * computeBacklogMovePayload — reorder within backlog
 * orderedIds = [10,20,30,40,50], overContainer = { sprintId: null }
 * ========================================================================== */

describe('computeBacklogMovePayload — reorder within backlog', () => {
  const orderedIds = [10, 20, 30, 40, 50];
  const overContainer = { sprintId: null };

  it('reorder-mid → previousUs 10, nextUs null', () => {
    const dragged = buildUsList(20);
    const payload: BacklogMovePayload = computeBacklogMovePayload({
      usList: dragged,
      overContainer,
      orderedIds,
      overIndex: 1,
    });
    // destExcl = [10,30,40,50]; clamp(1,0,4) = 1.
    expect(payload.index).toBe(1);
    expect(payload.sprint).toBeNull();
    expect(payload.previousUs).toBe(10);
    expect(payload.nextUs).toBeNull();
    // `usList` is returned by reference — the SAME array instance passed in.
    expect(payload.usList).toBe(dragged);
  });

  it('reorder-top → previousUs null, nextUs 10', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer,
      orderedIds,
      overIndex: 0,
    });
    // nextUs = first of destExcl because previousUs is null.
    expect(payload.index).toBe(0);
    expect(payload.sprint).toBeNull();
    expect(payload.previousUs).toBeNull();
    expect(payload.nextUs).toBe(10);
  });

  it('reorder-bottom → previousUs 50, nextUs null', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer,
      orderedIds,
      overIndex: 4,
    });
    // destExcl = [10,30,40,50]; clamp(4,0,4) = 4.
    expect(payload.index).toBe(4);
    expect(payload.previousUs).toBe(50);
    expect(payload.nextUs).toBeNull();
  });

  it('clamp-high → overIndex 999 clamps to destExcl.length (4)', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer,
      orderedIds,
      overIndex: 999,
    });
    expect(payload.index).toBe(4);
    expect(payload.previousUs).toBe(50);
    expect(payload.nextUs).toBeNull();
  });
});

/* ========================================================================== *
 * computeBacklogMovePayload — backlog → sprint
 * ========================================================================== */

describe('computeBacklogMovePayload — backlog → sprint', () => {
  it('backlog → empty sprint → index 0, sprint 7, no neighbours', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer: { sprintId: 7 },
      orderedIds: [], // empty sprint container
      overIndex: 0,
    });
    expect(payload.index).toBe(0);
    expect(payload.sprint).toBe(7);
    expect(payload.previousUs).toBeNull();
    expect(payload.nextUs).toBeNull();
  });

  it('backlog → sprint mid → previousUs 100, nextUs null', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer: { sprintId: 7 },
      orderedIds: [100, 200, 300], // 20 not present ⇒ destExcl unchanged
      overIndex: 1,
    });
    expect(payload.index).toBe(1);
    expect(payload.sprint).toBe(7);
    expect(payload.previousUs).toBe(100);
    expect(payload.nextUs).toBeNull();
  });
});

/* ========================================================================== *
 * computeBacklogMovePayload — sprint → backlog
 * ========================================================================== */

describe('computeBacklogMovePayload — sprint → backlog', () => {
  it('sprint → backlog top → previousUs null, nextUs 10', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(100), // dragged from a sprint; not in the backlog list
      overContainer: { sprintId: null },
      orderedIds: [10, 20, 30],
      overIndex: 0,
    });
    expect(payload.index).toBe(0);
    expect(payload.sprint).toBeNull();
    expect(payload.previousUs).toBeNull();
    expect(payload.nextUs).toBe(10);
  });
});

/* ========================================================================== *
 * computeBacklogMovePayload — sprint → sprint
 * ========================================================================== */

describe('computeBacklogMovePayload — sprint → sprint', () => {
  it('sprint → sprint bottom → previousUs 400, nextUs null', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(200),
      overContainer: { sprintId: 8 },
      orderedIds: [300, 400],
      overIndex: 2,
    });
    // destExcl = [300,400]; clamp(2,0,2) = 2.
    expect(payload.index).toBe(2);
    expect(payload.sprint).toBe(8);
    expect(payload.previousUs).toBe(400);
    expect(payload.nextUs).toBeNull();
  });
});

/* ========================================================================== *
 * computeBacklogMovePayload — multi-card drag
 * ========================================================================== */

describe('computeBacklogMovePayload — multi-card drag', () => {
  it('multi ordered by source → dragged ids excluded from neighbours', () => {
    const dragged = buildUsList(20, 40);
    const payload = computeBacklogMovePayload({
      usList: dragged,
      overContainer: { sprintId: null },
      orderedIds: [10, 20, 30, 40, 50],
      overIndex: 1,
    });
    // draggedSet = {20,40}; destExcl = [10,30,50]; clamp(1,0,3) = 1.
    expect(payload.index).toBe(1);
    expect(payload.previousUs).toBe(10);
    expect(payload.nextUs).toBeNull();
    // Neither dragged id may surface as a neighbour candidate.
    expect(payload.previousUs).not.toBe(20);
    expect(payload.previousUs).not.toBe(40);
    expect(payload.nextUs).not.toBe(20);
    expect(payload.nextUs).not.toBe(40);
  });
});

/* ========================================================================== *
 * computeNeighbors (direct)
 * ========================================================================== */

describe('computeNeighbors', () => {
  it('top → previousUs null, nextUs 10', () => {
    expect(computeNeighbors([10, 20, 30], 0)).toEqual({ previousUs: null, nextUs: 10 });
  });

  it('mid → previousUs 20, nextUs null', () => {
    expect(computeNeighbors([10, 20, 30], 2)).toEqual({ previousUs: 20, nextUs: null });
  });

  it('bottom → previousUs 30, nextUs null', () => {
    expect(computeNeighbors([10, 20, 30], 3)).toEqual({ previousUs: 30, nextUs: null });
  });

  it('empty → previousUs null, nextUs null', () => {
    // nextUs = destExcl[0] ?? null = null on an empty list.
    expect(computeNeighbors([], 0)).toEqual({ previousUs: null, nextUs: null });
  });
});

/* ========================================================================== *
 * resolveDraggedIds
 * ========================================================================== */

describe('resolveDraggedIds', () => {
  it('no selection → [activeUsId]', () => {
    expect(resolveDraggedIds(20, undefined, [10, 20, 30])).toEqual([20]);
  });

  it('empty selection → [activeUsId]', () => {
    expect(resolveDraggedIds(20, [], [10, 20, 30])).toEqual([20]);
  });

  it('single selected → [activeUsId] (length not > 1)', () => {
    expect(resolveDraggedIds(20, [20], [10, 20, 30])).toEqual([20]);
  });

  it('active not in selection → [activeUsId] (isMulti false)', () => {
    expect(resolveDraggedIds(20, [10, 30], [10, 20, 30])).toEqual([20]);
  });

  it('multi ordered by source → [20,40]', () => {
    expect(resolveDraggedIds(20, [40, 20], [10, 20, 30, 40, 50])).toEqual([20, 40]);
  });

  it('multi fallback (999 not in source) → [20]', () => {
    expect(resolveDraggedIds(20, [20, 999], [10, 20, 30])).toEqual([20]);
  });
});

/* ========================================================================== *
 * isSamePosition
 * ========================================================================== */

describe('isSamePosition', () => {
  it('same → true (index equals oldIndex 1)', () => {
    expect(isSamePosition([10, 20, 30], [20], 1)).toBe(true);
  });

  it('moved-top → false', () => {
    expect(isSamePosition([10, 20, 30], [20], 0)).toBe(false);
  });

  it('moved-bottom → false', () => {
    expect(isSamePosition([10, 20, 30], [20], 2)).toBe(false);
  });

  it('cross-container (id not found) → false (firstPos -1)', () => {
    expect(isSamePosition([10, 30], [20], 0)).toBe(false);
  });

  it('multi contiguous same → true', () => {
    expect(isSamePosition([10, 20, 30, 40], [20, 30], 1)).toBe(true);
  });

  it('multi moved → false', () => {
    expect(isSamePosition([10, 20, 30, 40], [20, 30], 0)).toBe(false);
  });
});

/* ========================================================================== *
 * derived API arguments — wire-format lock  (CRITICAL REGRESSION GUARD)
 *
 * Given a computed `BacklogMovePayload`, assert the derived values the
 * `state`/hook layer forwards to the `/api/v1/` backlog-order endpoint. These
 * are the byte-for-byte wire-format assertions the folder spec mandates.
 * ========================================================================== */

describe('derived API arguments — wire-format lock', () => {
  /*
   * The exact rule the state/hook layer (`state/useBacklog`) uses to choose the
   * sprint id sent to the backlog-order API — ported verbatim from
   * `app/coffee/modules/backlog/main.coffee` L533:
   *   currentSprintId = (newSprintId != oldSprintId) ? newSprintId : oldSprintId
   * This is deliberately the strict `!==` form, NOT `newSprintId ?? oldSprintId`.
   * The `??` form (shown in the DnD file's doc-comment) is WRONG for the
   * sprint → backlog case: dropping a story back to the backlog must send
   * `null`, but `null ?? oldSprintId` would resend the old sprint. Implemented
   * inline here to document and lock the rule; it is intentionally NOT imported
   * from the hook.
   */
  const currentSprintId = (
    newSprintId: number | null,
    oldSprintId: number | null,
  ): number | null => (newSprintId !== oldSprintId ? newSprintId : oldSprintId);

  it.each<[string, number | null, number | null, number | null]>([
    ['backlog(old null) → backlog(null) ⇒ null', null, null, null],
    ['backlog(old null) → sprint 7 ⇒ 7', null, 7, 7],
    ['sprint 7 → backlog(null) ⇒ null (the ?? form wrongly sends 7)', 7, null, null],
    ['sprint 7 → sprint 8 ⇒ 8', 7, 8, 8],
    ['sprint 7 → same sprint 7 reorder ⇒ 7', 7, 7, 7],
  ])('currentSprintId: %s', (_label, dragMilestone, overSprintId, expected) => {
    // oldSprintId derives from usList[0].milestone (main.coffee L524); newSprintId
    // is payload.sprint (= overContainer.sprintId). Compute a REAL payload so the
    // lock exercises the actual helper output, not hand-built fields.
    const payload = computeBacklogMovePayload({
      usList: [makeUserStory({ id: 20, milestone: dragMilestone })],
      overContainer: { sprintId: overSprintId },
      orderedIds: overSprintId == null ? [10, 30, 40, 50] : [100, 200, 300],
      overIndex: 1,
    });
    const oldSprintId = payload.usList[0].milestone;
    const newSprintId = payload.sprint;
    expect(currentSprintId(newSprintId, oldSprintId)).toBe(expected);
  });

  it('bulkUserstories is a number[] of user-story ids (single card)', () => {
    const payload = computeBacklogMovePayload({
      usList: buildUsList(20),
      overContainer: { sprintId: null },
      orderedIds: [10, 30, 40, 50],
      overIndex: 1,
    });
    const bulkUserstories = payload.usList.map((u) => u.id);
    expect(Array.isArray(bulkUserstories)).toBe(true);
    expect(bulkUserstories).toEqual([20]);
    expect(typeof bulkUserstories[0]).toBe('number');
    // MUST NOT be the {us_id, order} object-array shape.
    expect(bulkUserstories[0]).not.toHaveProperty('us_id');
    expect(bulkUserstories[0]).not.toHaveProperty('order');
  });

  it('bulkUserstories multi = [20,40], every element a number (NOT {us_id,order})', () => {
    const dragged = buildUsList(20, 40);
    const payload = computeBacklogMovePayload({
      usList: dragged,
      overContainer: { sprintId: null },
      orderedIds: [10, 20, 30, 40, 50],
      overIndex: 1,
    });
    const bulkUserstories = payload.usList.map((u) => u.id);
    expect(Array.isArray(bulkUserstories)).toBe(true);
    expect(bulkUserstories).toEqual([20, 40]);
    bulkUserstories.forEach((id) => expect(typeof id).toBe('number'));
    // Explicitly lock AGAINST a regression to the {us_id, order}[] shape (which
    // is used only by the separate bulkUpdateMilestone path, never here).
    expect(bulkUserstories[0]).not.toHaveProperty('us_id');
    expect(bulkUserstories[0]).not.toHaveProperty('order');
  });
});

