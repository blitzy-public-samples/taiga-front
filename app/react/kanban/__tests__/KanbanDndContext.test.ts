/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanDndContext.test.ts — the PRIMARY, browserless Jest + jsdom unit spec for
 * the PURE, browser-free helper functions exported by `../dnd/KanbanDndContext`.
 *
 * WHAT THIS SPEC PROVES
 *   The five deterministic helpers that build the `kanban:us:move` payload —
 *   `resolveDraggedIds`, `computeDropIndex`, `computeNeighbors`,
 *   `buildFinalUsList`, and `computeMovePayload` — reproduce EXACTLY the dragula
 *   drop / dragend semantics of the AngularJS source of truth
 *   `app/coffee/modules/kanban/sortable.coffee` (READ-ONLY; NEVER imported):
 *     - multi-card drag engagement — the grabbed card is dragged alone unless it
 *       is itself selected AND more than one card is selected; the engaged set is
 *       returned in board/DOM order (`sortable.coffee:75-87`,
 *       `dragula-drag-multiple.js`);
 *     - the destination insertion index — append when dropped on the empty column
 *       body / below all cards, otherwise the over-card position (`+1` after it);
 *     - the `previousCard` / `nextCard` neighbour rule — `nextCard` is set ONLY
 *       when there is NO `previousCard` (`sortable.coffee:95-107`, mirroring the
 *       `afterUserstoryId`-wins API priority);
 *     - the `finalUsList` item shape `{ id, oldStatusId, oldSwimlaneId }` read
 *       RAW from `card.model.status` / `card.model.swimlane`
 *       (`sortable.coffee:136-141`);
 *     - the same-container / same-position no-op guard that fires NO callback
 *       (`sortable.coffee:124`); and
 *     - the FROZEN six-key payload in the exact order the AngularJS
 *       `moveUs(finalUsList, newStatus, newSwimlane, index, previousCard,
 *       nextCard)` broadcast consumes (`main.coffee:596`).
 *
 * TEST-LAYER ISOLATION (hard constraints — identical intent to every kanban spec)
 *   - `.ts` (NO JSX): the React components (`KanbanDndContext` provider,
 *     `DraggableCard`, `DroppableColumn`) need a live `DndContext`, so they are
 *     NOT rendered here — they are covered by the sibling `.tsx` smoke test and
 *     the Playwright e2e layer. This spec imports and asserts ONLY the pure
 *     functions, so there is deliberately NO `import React`.
 *   - jest globals (`describe` / `it` / `expect` / `jest`) and jest-dom matchers
 *     are AMBIENT (root `tsconfig.json` `types` + `jest.config.js`
 *     `setupFilesAfterEnv`), so neither is imported.
 *   - No `dragula` / `dom-autoscroller` / `immutable` / `checksley` / `jquery` /
 *     `angular` / `@playwright/test` / `app/coffee/**` imports; no network, no
 *     real browser. Node v16.19.1 compatible; ts-jest transform via root
 *     `tsconfig.json` (`strict` + `isolatedModules`, hence `import type`).
 *
 * KEEPING THE PURE-HELPER SPEC HERMETIC
 *   Importing `../dnd/KanbanDndContext` pulls its module graph, which imports
 *   `@dnd-kit/core` (installed — imports fine in jsdom) and `../components/Card`
 *   (a full component tree the pure helpers never touch). `../components/Card` is
 *   therefore mocked to an inert stub BEFORE the module under test is imported,
 *   so the graph stays fast and isolated. `@dnd-kit/core` is intentionally NOT
 *   mocked (the pure helpers do not use it) and the module under test is never
 *   mocked.
 */

jest.mock('../components/Card', () => ({ Card: () => null }));

import {
  resolveDraggedIds,
  computeDropIndex,
  computeNeighbors,
  buildFinalUsList,
  computeMovePayload,
} from '../dnd/KanbanDndContext';
import type { FinalUsListItem, MoveUsPayload } from '../dnd/KanbanDndContext';
import { makeUserStory, makeBoardCard, makeUsMap } from './factories';

/* ========================================================================== *
 * resolveDraggedIds — multi-card drag engagement + board ordering
 * (parity with `window.dragMultiple` / `sortable.coffee:75-87`).
 * ========================================================================== */

describe('resolveDraggedIds', () => {
  it('returns only the TRUTHY selected ids when the active card is selected', () => {
    // 9 is present but `false`, so it is excluded from the multi-drag set.
    const result = resolveDraggedIds(5, { 5: true, 7: true, 9: false });

    // Without `orderedIds` the raw selected set is returned; assert membership
    // and length so the test does not over-specify the (already deterministic
    // ascending integer-key) iteration order.
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([5, 7]));
    expect(result).not.toContain(9);
  });

  it('orders the multi-drag set by the supplied board order, not the selection map', () => {
    // Board order is [9,7,5,3]; the selected set {5,7} filtered by that order is
    // [7,5] — the ORDER comes from `orderedIds`, never from the selection object.
    const result = resolveDraggedIds(5, { 5: true, 7: true }, [9, 7, 5, 3]);

    expect(result).toEqual([7, 5]);
  });

  it('drags the active card ALONE when it is not itself selected', () => {
    // The grabbed card (5) is `false` in the selection map, so multi-drag does
    // not engage even though another card (7) is selected.
    const result = resolveDraggedIds(5, { 5: false, 7: true });

    expect(result).toEqual([5]);
  });

  it('drags the active card alone when it is the ONLY selected card', () => {
    // A single selected card is not a multi-selection (length must be > 1).
    const result = resolveDraggedIds(5, { 5: true });

    expect(result).toEqual([5]);
  });
});

/* ========================================================================== *
 * computeDropIndex — destination insertion index.
 * `overCardId == null` (empty body / below all cards) or an over-card that is
 * not in the destination => APPEND at `destExcl.length`; otherwise the over-card
 * position, `+1` when dropping AFTER it.
 * ========================================================================== */

describe('computeDropIndex', () => {
  it('returns 0 for an empty destination column', () => {
    // Empty column: append at length 0 === index 0.
    expect(computeDropIndex([], null, false)).toBe(0);
  });

  it('appends AFTER the last card => index === length', () => {
    // Over the last card (99) with insert-after => indexOf(99)+1 === length.
    expect(computeDropIndex([1, 2, 99], 99, true)).toBe(3);
  });

  it('inserts AFTER a card => indexOf(overCard) + 1', () => {
    // Dropping after the last of [10,20,40,50] lands at the end (index 4).
    expect(computeDropIndex([10, 20, 40, 50], 50, true)).toBe(4);
  });

  it('inserts BEFORE a card => indexOf(overCard)', () => {
    // Dropping before card 40 lands at its current position (index 2).
    expect(computeDropIndex([10, 20, 40, 50], 40, false)).toBe(2);
  });

  it('appends at the end when overCardId is null on a non-empty column', () => {
    // A `null` over-card means "dropped on the empty body / below all cards", so
    // the authored helper appends at `destExcl.length` (NOT index 0).
    expect(computeDropIndex([10, 20, 40, 50], null, false)).toBe(4);
  });

  it('appends at the end when the over-card is not in the destination', () => {
    // A defensive branch: an unknown over-card falls back to append.
    expect(computeDropIndex([10, 20], 999, false)).toBe(2);
  });
});

/* ========================================================================== *
 * computeNeighbors — previousCard / nextCard (mirrors `sortable.coffee:95-107`:
 * `nextCard` is set ONLY when there is no `previousCard`).
 * ========================================================================== */

describe('computeNeighbors', () => {
  it('dropped at the END => previousCard is the last card, nextCard is null', () => {
    // index 4 in a 4-long list => previous is element[3] (50); a previous exists
    // so nextCard stays null.
    expect(computeNeighbors([10, 20, 40, 50], 4)).toEqual({
      previousCard: 50,
      nextCard: null,
    });
  });

  it('dropped at the HEAD => previousCard is null, nextCard is element[dropIndex]', () => {
    // index 0 => no previous, so nextCard is element[0] (99).
    expect(computeNeighbors([99], 0)).toEqual({
      previousCard: null,
      nextCard: 99,
    });
  });

  it('dropped in the MIDDLE => previousCard set, nextCard null', () => {
    // index 2 => previous is element[1] (20); a previous exists so next is null.
    expect(computeNeighbors([10, 20, 40, 50], 2)).toEqual({
      previousCard: 20,
      nextCard: null,
    });
  });

  it('empty destination => both neighbours null', () => {
    // No previous (index-1 < 0) and no element at index 0 => both null.
    expect(computeNeighbors([], 0)).toEqual({
      previousCard: null,
      nextCard: null,
    });
  });
});

/* ========================================================================== *
 * buildFinalUsList — maps each dragged id to its RAW original status / swimlane
 * (`sortable.coffee:136-141`). The swimlane is preserved as-is (may be null) and
 * is NOT coerced to -1 here.
 * ========================================================================== */

describe('buildFinalUsList', () => {
  // us1 has no swimlane (null); us2 sits in swimlane 10. Cards are built via
  // `makeBoardCard({ model })` so `card.model.status` / `card.model.swimlane`
  // are the values `buildFinalUsList` reads.
  const us1 = makeUserStory({ id: 1, status: 100, swimlane: null });
  const us2 = makeUserStory({ id: 2, status: 100, swimlane: 10 });
  const usMap = makeUsMap([
    makeBoardCard({ model: us1 }),
    makeBoardCard({ model: us2 }),
  ]);

  it('maps each id to { id, oldStatusId, oldSwimlaneId } read from card.model', () => {
    const expected: FinalUsListItem[] = [
      { id: 1, oldStatusId: 100, oldSwimlaneId: null },
      { id: 2, oldStatusId: 100, oldSwimlaneId: 10 },
    ];

    expect(buildFinalUsList([1, 2], usMap)).toEqual(expected);
  });

  it('preserves the order of the draggedIds input', () => {
    // Reversing the input reverses the output; id 2 must come first.
    const result = buildFinalUsList([2, 1], usMap);

    expect(result[0].id).toBe(2);
    expect(result[1].id).toBe(1);
  });
});

/* ========================================================================== *
 * computeMovePayload — no-op guard.
 * Dropping a card back into the SAME container at the SAME position
 * (`sameContainer && index === oldIndex`) fires no callback (`sortable.coffee:124`).
 * ========================================================================== */

describe('computeMovePayload — no-op guard', () => {
  const usMap = makeUsMap([
    makeBoardCard({ model: makeUserStory({ id: 10, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 20, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 40, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 50, status: 100, swimlane: null }) }),
  ]);

  it('returns null when dropped in the same container at the same index', () => {
    // The dragged card is 40 (its source index is 2). Dropping AFTER card 20 in
    // the destination-excluding-moved list [10,20,50] yields index 2 as well
    // (indexOf(20)+1), so with `sameContainer` the guard trips and no move fires.
    const result: MoveUsPayload | null = computeMovePayload({
      draggedIds: [40],
      destExcl: [10, 20, 50],
      overCardId: 20,
      insertAfter: true,
      newStatus: 100,
      newSwimlane: -1,
      oldIndex: 2,
      sameContainer: true,
      usMap,
    });

    expect(result).toBeNull();
  });
});

/* ========================================================================== *
 * computeMovePayload — real move.
 * A cross-status drop produces the full payload; `newSwimlane` is surfaced RAW
 * as a number (-1 is the "Unclassified"/no-swimlane sentinel — the downstream
 * `onMoveUs` handler owns any -1 -> null normalisation, NOT this pure mapper).
 * ========================================================================== */

describe('computeMovePayload — real move', () => {
  // Source column status 100 holds [1,2,3]; destination column status 200 holds
  // [4,5]. None of the dragged ids are in the destination, so destExcl === [4,5].
  const usMap = makeUsMap([
    makeBoardCard({ model: makeUserStory({ id: 1, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 2, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 3, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 4, status: 200, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 5, status: 200, swimlane: null }) }),
  ]);

  it('produces the frozen payload for a single-card cross-status move', () => {
    // Drop card 1 into status 200 AFTER card 4 => index 1 (indexOf(4)+1 in [4,5]).
    const result: MoveUsPayload | null = computeMovePayload({
      draggedIds: [1],
      destExcl: [4, 5],
      overCardId: 4,
      insertAfter: true,
      newStatus: 200,
      newSwimlane: -1,
      oldIndex: 0,
      sameContainer: false,
      usMap,
    });

    expect(result).not.toBeNull();

    const expectedFinalUsList: FinalUsListItem[] = [
      { id: 1, oldStatusId: 100, oldSwimlaneId: null },
    ];
    expect(result!.finalUsList).toEqual(expectedFinalUsList);
    expect(result!.newStatus).toBe(200);
    // Surfaced RAW (number). -1 is the no-swimlane sentinel; never null here.
    expect(result!.newSwimlane).toBe(-1);
    expect(result!.index).toBe(1);
    // A previousCard (4) exists, so nextCard must be null.
    expect(result!.previousCard).toBe(4);
    expect(result!.nextCard).toBeNull();
  });

  it('carries the full multi-card set in board order for a multi-card move', () => {
    // Resolve the dragged set exactly as the drag handler would: cards 1 and 2
    // are both selected and card 1 is grabbed, so the engaged set is [1,2] in
    // board order. This exercises the resolveDraggedIds -> computeMovePayload
    // pipeline end to end.
    const draggedIds = resolveDraggedIds(1, { 1: true, 2: true }, [1, 2, 3]);
    expect(draggedIds).toEqual([1, 2]);

    const result: MoveUsPayload | null = computeMovePayload({
      draggedIds,
      destExcl: [4, 5],
      overCardId: 4,
      insertAfter: true,
      newStatus: 200,
      newSwimlane: -1,
      oldIndex: 0,
      sameContainer: false,
      usMap,
    });

    expect(result).not.toBeNull();
    expect(result!.finalUsList).toHaveLength(2);
    expect(result!.finalUsList.map((item) => item.id)).toEqual([1, 2]);
    expect(result!.finalUsList).toEqual([
      { id: 1, oldStatusId: 100, oldSwimlaneId: null },
      { id: 2, oldStatusId: 100, oldSwimlaneId: null },
    ]);
    expect(result!.newStatus).toBe(200);
  });
});

/* ========================================================================== *
 * MoveUsPayload shape is frozen.
 * The `onMoveUs(finalUsList, newStatus, newSwimlane, index, previousCard,
 * nextCard)` contract has EXACTLY six keys — no more, no fewer (`main.coffee:596`).
 * ========================================================================== */

describe('MoveUsPayload shape is frozen', () => {
  const usMap = makeUsMap([
    makeBoardCard({ model: makeUserStory({ id: 1, status: 100, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 4, status: 200, swimlane: null }) }),
    makeBoardCard({ model: makeUserStory({ id: 5, status: 200, swimlane: null }) }),
  ]);

  it('returns exactly the six frozen keys for a real move', () => {
    const result: MoveUsPayload | null = computeMovePayload({
      draggedIds: [1],
      destExcl: [4, 5],
      overCardId: 5,
      insertAfter: true,
      newStatus: 200,
      newSwimlane: 10,
      oldIndex: 0,
      sameContainer: false,
      usMap,
    });

    // Narrow away the null branch so the key assertion is type-safe (no cast).
    if (!result) {
      throw new Error('expected computeMovePayload to return a payload for a real move');
    }

    expect(Object.keys(result).sort()).toEqual(
      ['finalUsList', 'index', 'newStatus', 'newSwimlane', 'nextCard', 'previousCard'].sort(),
    );
  });
});

