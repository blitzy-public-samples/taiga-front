/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest + TypeScript unit spec for the FRAMEWORK-AGNOSTIC parts of
 * the React drag-and-drop layer:
 *
 *   - `../dnd/sortable`   — the PURE geometry/predicate helpers and the DOM
 *                           class-management helpers (no React render here), plus
 *                           a deterministic smoke test of the drag-end handler
 *                           factories driven with an INJECTED mock `api`.
 *   - `../dnd/types`      — the `DND_CLASS` runtime constant (the visual-parity
 *                           class-name contract).
 *   - `../dnd/autoScroll` — `getAutoScrollOptions` and the KANBAN/BACKLOG config
 *                           + `@dnd-kit`-mapped option constants.
 *
 * WHY A SECOND SORTABLE SPEC (alongside `../dnd/__tests__/sortable.test.tsx`)
 * -------------------------------------------------------------------------
 * The sibling `sortable.test.tsx` exercises the React `useSortable` wrappers and
 * a full drag-end simulation. THIS file is deliberately React-free and jsdom-only
 * (no `@testing-library/react`, no `useSortable`), so it isolates and pins the
 * pure/DOM/config surface that must hold regardless of the rendering framework —
 * the part that reproduces the legacy `dragula`/`dom-autoscroller` semantics
 * byte-for-byte (kanban/sortable.coffee + backlog/sortable.coffee). It counts
 * toward the >=70% Jest line-coverage gate over `app/react/**`.
 *
 * TWO CORRECTNESS-CRITICAL FIDELITY POINTS asserted here:
 *   1. AFTER-PRECEDENCE — `previousId` (the backend `after_userstory_id`) wins;
 *      `nextId` (`before_userstory_id`) is produced ONLY when there is no
 *      previous, so AT MOST ONE of the two is non-null. Proven in BOTH the DOM
 *      helper ({@link computeAdjacentIds}) and the data-model helper
 *      ({@link computeAdjacentIdsFromOrder}), which must agree.
 *   2. `bulk_userstories` IS `number[]` — {@link resolveMovedIds} yields a bare
 *      id array that flows straight to the frozen `/api/v1/` endpoints.
 *
 * HARD BOUNDARY (AAP 0.7): this spec imports ONLY the sibling `../dnd/*` modules
 * and `../dnd/types` (plus their types) and the ambient Jest globals. It imports
 * NO React, NO AngularJS/CoffeeScript source, and NEVER `dragula`/`dom-autoscroller`.
 * It performs NO network I/O and launches NO browser: the real `../api/userstories`
 * adapter is never CALLED because every factory test injects its own mock `api`.
 */

import {
  matchesItem,
  computeAdjacentIds,
  computeAdjacentIdsFromOrder,
  readKanbanColumnTarget,
  toApiSwimlane,
  indexAmong,
  isKanbanContainer,
  isBacklogContainer,
  isBacklogListContainer,
  resolveMovedIds,
  addTargetDrop,
  removeTargetDrop,
  setDragActive,
  markColumnNew,
  removeDoomLines,
  createKanbanDragEndHandler,
  createBacklogDragEndHandler,
} from '../dnd/sortable';
import { DND_CLASS } from '../dnd/types';
import type {
  KanbanDragResult,
  BacklogDragResult,
  KanbanOrderApi,
  BacklogOrderApi,
} from '../dnd/types';
import {
  getAutoScrollOptions,
  KANBAN_AUTOSCROLL,
  BACKLOG_AUTOSCROLL,
  KANBAN_AUTOSCROLL_CONFIG,
  BACKLOG_AUTOSCROLL_CONFIG,
} from '../dnd/autoScroll';

/* -------------------------------------------------------------------------- *
 * Test fixtures / DOM builders
 * -------------------------------------------------------------------------- */

/**
 * Build a draggable ITEM element carrying `data-id` and the given class(es).
 * `cls` is the primary item class (e.g. `'row'` reproducing the Backlog `.row`),
 * and `extra` adds any state classes (e.g. `DND_CLASS.transit` to mark the
 * in-place placeholder, `DND_CLASS.moved` to tag the dragged item).
 */
function makeItem(id: number, cls: string, extra: string[] = []): HTMLElement {
  const el = document.createElement('div');
  el.className = [cls, ...extra].join(' ').trim();
  el.dataset.id = String(id);
  return el;
}

/**
 * Derive the drag-end handlers' event parameter type from the factory return
 * signatures instead of importing `DragEndEvent` from `@dnd-kit/core`, keeping
 * this spec's imports strictly within `../dnd/*` (AAP 0.7 globals-only boundary).
 */
type DragEndEventLike = Parameters<
  ReturnType<typeof createKanbanDragEndHandler>
>[0];

/** Build a minimal fake drag-end event reading only the fields the handlers use. */
function makeEvent(
  activeId: number,
  activeData: Record<string, unknown> | undefined,
  overData: Record<string, unknown> | null | undefined,
  // The id of the `over` droppable — at runtime the sibling card under the
  // pointer. The Kanban DATA-path handler reads `Number(over.id)` to simulate
  // the drop over that card. Defaults to a non-numeric sentinel (coerces to NaN)
  // so tests that don't target a specific card are unaffected.
  overId: number | string = 'over-droppable',
): DragEndEventLike {
  const active = {
    id: activeId,
    data: { current: activeData },
    rect: { current: { initial: null, translated: null } },
  };
  const over =
    overData === null
      ? null
      : { id: overId, rect: {}, data: { current: overData }, disabled: false };
  return {
    activatorEvent: new Event('pointerup'),
    active,
    collisions: null,
    delta: { x: 0, y: 0 },
    over,
  } as unknown as DragEndEventLike;
}

// Reset all DOM + body-class side effects between tests so nothing leaks across
// specs (setDragActive toggles document.body; removeDoomLines scans the document).
afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

/* -------------------------------------------------------------------------- *
 * computeAdjacentIds — DOM after-precedence (kanban/sortable.coffee:95-107;
 * backlog/sortable.coffee:50-63)
 * -------------------------------------------------------------------------- */

describe('computeAdjacentIds (DOM sibling scan, after-precedence)', () => {
  it('picks the NEAREST previous item id and leaves nextId null when a previous exists', () => {
    // [1, 2*(moved+transit), 3, 4] -> previous = 1, next suppressed.
    const container = document.createElement('div');
    const moved = makeItem(2, 'row', [DND_CLASS.moved, DND_CLASS.transit]);
    container.append(
      makeItem(1, 'row'),
      moved,
      makeItem(3, 'row'),
      makeItem(4, 'row'),
    );

    expect(computeAdjacentIds(moved, '.row', DND_CLASS.transit)).toEqual({
      previousId: 1,
      nextId: null,
    });
  });

  it('falls back to the NEAREST next item id only when there is no previous (moved is first)', () => {
    // [2*(moved+transit), 3, 4] -> no previous, so next = 3.
    const container = document.createElement('div');
    const moved = makeItem(2, 'row', [DND_CLASS.moved, DND_CLASS.transit]);
    container.append(moved, makeItem(3, 'row'), makeItem(4, 'row'));

    expect(computeAdjacentIds(moved, '.row', DND_CLASS.transit)).toEqual({
      previousId: null,
      nextId: 3,
    });
  });

  it('skips transit-placeholder siblings (the :not(.gu-transit) filter)', () => {
    // A stray transit placeholder sits between the real previous item and moved;
    // it must be ignored so previous resolves to the real item (id 1), not 99.
    const container = document.createElement('div');
    const placeholder = makeItem(99, 'row', [DND_CLASS.transit]);
    const moved = makeItem(2, 'row', [DND_CLASS.transit]);
    container.append(makeItem(1, 'row'), placeholder, moved, makeItem(3, 'row'));

    expect(computeAdjacentIds(moved, '.row', DND_CLASS.transit)).toEqual({
      previousId: 1,
      nextId: null,
    });
  });

  it('skips non-matching intervening nodes (reproduces prevAll(selector))', () => {
    // A <span> that does not match '.row' between item 1 and moved is skipped.
    const container = document.createElement('div');
    const span = document.createElement('span');
    const moved = makeItem(2, 'row', [DND_CLASS.transit]);
    container.append(makeItem(1, 'row'), span, moved, makeItem(3, 'row'));

    expect(computeAdjacentIds(moved, '.row', DND_CLASS.transit)).toEqual({
      previousId: 1,
      nextId: null,
    });
  });

  it('defaults transitClass to DND_CLASS.transit when the argument is omitted', () => {
    const container = document.createElement('div');
    const moved = makeItem(2, 'row', [DND_CLASS.transit]);
    container.append(makeItem(1, 'row'), moved);

    // No explicit transitClass -> default 'gu-transit' still filters correctly.
    expect(computeAdjacentIds(moved, '.row')).toEqual({
      previousId: 1,
      nextId: null,
    });
  });

  it('returns both null when the moved item has no matching siblings', () => {
    const container = document.createElement('div');
    const moved = makeItem(2, 'row', [DND_CLASS.transit]);
    container.append(moved);

    expect(computeAdjacentIds(moved, '.row', DND_CLASS.transit)).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('works with the Kanban tg-card selector too (screen-agnostic geometry)', () => {
    const container = document.createElement('div');
    const c1 = document.createElement('tg-card');
    c1.dataset.id = '10';
    const moved = document.createElement('tg-card');
    moved.dataset.id = '20';
    moved.classList.add(DND_CLASS.transit);
    const c3 = document.createElement('tg-card');
    c3.dataset.id = '30';
    container.append(c1, moved, c3);

    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: 10,
      nextId: null,
    });
  });
});

/* -------------------------------------------------------------------------- *
 * computeAdjacentIdsFromOrder — data-model after-precedence (@dnd-kit path)
 * -------------------------------------------------------------------------- */

describe('computeAdjacentIdsFromOrder (ordered-id list, after-precedence)', () => {
  it('middle element -> previous wins, next suppressed', () => {
    expect(computeAdjacentIdsFromOrder([10, 20, 30], 20)).toEqual({
      previousId: 10,
      nextId: null,
    });
  });

  it('first element -> no previous, so next is used', () => {
    expect(computeAdjacentIdsFromOrder([10, 20, 30], 10)).toEqual({
      previousId: null,
      nextId: 20,
    });
  });

  it('last element -> previous wins, next null', () => {
    expect(computeAdjacentIdsFromOrder([10, 20, 30], 30)).toEqual({
      previousId: 20,
      nextId: null,
    });
  });

  it('returns both null when the moved id is absent from the list', () => {
    expect(computeAdjacentIdsFromOrder([10, 20, 30], 99)).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('single-element list -> both null (no neighbors either side)', () => {
    expect(computeAdjacentIdsFromOrder([42], 42)).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('agrees with the DOM helper for the same logical arrangement (parity)', () => {
    // Build the SAME arrangement [1, 2*(moved), 3, 4] in the DOM and as an id
    // list; both helpers must produce identical after-precedence output.
    const container = document.createElement('div');
    const moved = makeItem(2, 'row', [DND_CLASS.transit]);
    container.append(
      makeItem(1, 'row'),
      moved,
      makeItem(3, 'row'),
      makeItem(4, 'row'),
    );

    const fromDom = computeAdjacentIds(moved, '.row', DND_CLASS.transit);
    const fromOrder = computeAdjacentIdsFromOrder([1, 2, 3, 4], 2);
    expect(fromOrder).toEqual(fromDom);
    expect(fromOrder).toEqual({ previousId: 1, nextId: null });
  });
});

/* -------------------------------------------------------------------------- *
 * readKanbanColumnTarget / toApiSwimlane / indexAmong
 * -------------------------------------------------------------------------- */

describe('readKanbanColumnTarget', () => {
  it('reads numeric status + swimlane from the column dataset', () => {
    const column = document.createElement('div');
    column.dataset.status = '4';
    column.dataset.swimlane = '2';

    expect(readKanbanColumnTarget(column)).toEqual({
      newStatus: 4,
      newSwimlane: 2,
    });
  });

  it('reads the -1 swimlane sentinel (default row) as a real number, not null', () => {
    const column = document.createElement('div');
    column.dataset.status = '7';
    column.dataset.swimlane = '-1';

    // The -1 -> null mapping belongs to toApiSwimlane, NOT to this reader.
    expect(readKanbanColumnTarget(column)).toEqual({
      newStatus: 7,
      newSwimlane: -1,
    });
  });
});

describe('toApiSwimlane', () => {
  it('maps the -1 sentinel to null', () => {
    expect(toApiSwimlane(-1)).toBeNull();
  });

  it('passes a real swimlane id through unchanged', () => {
    expect(toApiSwimlane(2)).toBe(2);
  });

  it('preserves 0 as a valid id (only -1 becomes null)', () => {
    expect(toApiSwimlane(0)).toBe(0);
  });
});

describe('indexAmong', () => {
  it('returns the position of an element among matching descendants', () => {
    const parent = document.createElement('div');
    const a = makeItem(1, 'row');
    const b = makeItem(2, 'row');
    const c = makeItem(3, 'row');
    parent.append(a, b, c);

    expect(indexAmong(a, parent, '.row')).toBe(0);
    expect(indexAmong(b, parent, '.row')).toBe(1);
    expect(indexAmong(c, parent, '.row')).toBe(2);
  });

  it('returns -1 for an element that is not inside the parent', () => {
    const parent = document.createElement('div');
    parent.append(makeItem(1, 'row'), makeItem(2, 'row'));
    const orphan = makeItem(9, 'row');

    expect(indexAmong(orphan, parent, '.row')).toBe(-1);
  });

  it('returns -1 when the element exists but does not match the selector', () => {
    const parent = document.createElement('div');
    const span = document.createElement('span');
    parent.append(makeItem(1, 'row'), span);

    expect(indexAmong(span, parent, '.row')).toBe(-1);
  });
});

/* -------------------------------------------------------------------------- *
 * Container predicates (isKanbanContainer / isBacklogContainer /
 * isBacklogListContainer) and resolveMovedIds / matchesItem
 * -------------------------------------------------------------------------- */

describe('isKanbanContainer', () => {
  it('is true for a .taskboard-column element', () => {
    const el = document.createElement('div');
    el.classList.add('taskboard-column');
    expect(isKanbanContainer(el)).toBe(true);
  });

  it('is false for an unrelated element', () => {
    const el = document.createElement('div');
    el.classList.add('sprint-table');
    expect(isKanbanContainer(el)).toBe(false);
  });
});

describe('isBacklogContainer', () => {
  it.each(['sprint-table', 'backlog-table-body', 'js-empty-backlog'])(
    'is true for a .%s element',
    (cls) => {
      const el = document.createElement('div');
      el.classList.add(cls);
      expect(isBacklogContainer(el)).toBe(true);
    },
  );

  it('is false for an unrelated element', () => {
    const el = document.createElement('div');
    el.classList.add('taskboard-column');
    expect(isBacklogContainer(el)).toBe(false);
  });
});

describe('isBacklogListContainer', () => {
  it.each(['backlog-table-body', 'js-empty-backlog'])(
    'is true for a .%s element (the backlog LIST drop zone)',
    (cls) => {
      const el = document.createElement('div');
      el.classList.add(cls);
      expect(isBacklogListContainer(el)).toBe(true);
    },
  );

  it('is false for a .sprint-table element (that is a sprint, not the backlog list)', () => {
    const el = document.createElement('div');
    el.classList.add('sprint-table');
    expect(isBacklogListContainer(el)).toBe(false);
  });

  it('is false for an unrelated element', () => {
    const el = document.createElement('div');
    el.classList.add('taskboard-column');
    expect(isBacklogListContainer(el)).toBe(false);
  });
});

describe('resolveMovedIds', () => {
  it('returns the whole selection when it is non-empty and contains the active id', () => {
    expect(resolveMovedIds(2, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('returns just the active id when the selection is empty', () => {
    expect(resolveMovedIds(2, [])).toEqual([2]);
  });

  it('returns just the active id when the active id is not in the selection', () => {
    expect(resolveMovedIds(2, [5, 6])).toEqual([2]);
  });

  it('returns a COPY of the selection (callers may retain it safely)', () => {
    const selection = [1, 2, 3];
    const result = resolveMovedIds(2, selection);
    expect(result).toEqual(selection);
    expect(result).not.toBe(selection);
  });
});

describe('matchesItem', () => {
  it('is true when the element matches the selector and has no transit class', () => {
    const el = makeItem(1, 'row');
    expect(matchesItem(el, '.row', DND_CLASS.transit)).toBe(true);
  });

  it('is false once the transit class is present (the in-place placeholder)', () => {
    const el = makeItem(1, 'row');
    el.classList.add(DND_CLASS.transit);
    expect(matchesItem(el, '.row', DND_CLASS.transit)).toBe(false);
  });

  it('is false when the element does not match the selector', () => {
    const el = document.createElement('span');
    expect(matchesItem(el, '.row', DND_CLASS.transit)).toBe(false);
  });

  it('defaults transitClass to DND_CLASS.transit when omitted', () => {
    const el = makeItem(1, 'row');
    expect(matchesItem(el, '.row')).toBe(true);
    el.classList.add(DND_CLASS.transit);
    expect(matchesItem(el, '.row')).toBe(false);
  });
});


/* -------------------------------------------------------------------------- *
 * Class-management helpers (DOM side effects; DND_CLASS values)
 * -------------------------------------------------------------------------- */

describe('addTargetDrop / removeTargetDrop', () => {
  it('adds and removes the target-drop highlight class on a container', () => {
    const container = document.createElement('div');

    addTargetDrop(container);
    expect(container.classList.contains(DND_CLASS.targetDrop)).toBe(true);
    expect(container).toHaveClass('target-drop');

    removeTargetDrop(container);
    expect(container.classList.contains(DND_CLASS.targetDrop)).toBe(false);
  });

  it('removeTargetDrop is a no-op when the class is not present', () => {
    const container = document.createElement('div');
    expect(() => removeTargetDrop(container)).not.toThrow();
    expect(container.classList.contains(DND_CLASS.targetDrop)).toBe(false);
  });
});

describe('setDragActive', () => {
  it('adds drag-active to document.body when turned on', () => {
    setDragActive(true);
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(true);
  });

  it('removes drag-active from document.body when turned off', () => {
    document.body.classList.add(DND_CLASS.dragActive);
    setDragActive(false);
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
  });
});

describe('markColumnNew', () => {
  it('adds the "new" animation class to the destination column', () => {
    const column = document.createElement('div');
    markColumnNew(column);
    expect(column.classList.contains(DND_CLASS.newColumn)).toBe(true);
  });

  it('removes "new" after a single animationend event (reproduces jQuery .one)', () => {
    const column = document.createElement('div');
    markColumnNew(column);
    expect(column.classList.contains(DND_CLASS.newColumn)).toBe(true);

    column.dispatchEvent(new Event('animationend'));
    expect(column.classList.contains(DND_CLASS.newColumn)).toBe(false);
  });

  it('registers the animationend listener as one-shot (does not re-fire)', () => {
    const column = document.createElement('div');
    markColumnNew(column);
    column.dispatchEvent(new Event('animationend')); // consumes the {once:true} listener

    // Re-add the class manually; a second animationend must NOT auto-remove it,
    // proving the original listener already self-detached.
    column.classList.add(DND_CLASS.newColumn);
    column.dispatchEvent(new Event('animationend'));
    expect(column.classList.contains(DND_CLASS.newColumn)).toBe(true);
  });
});

describe('removeDoomLines', () => {
  it('removes every .doom-line under the default document root', () => {
    const a = document.createElement('div');
    a.className = 'doom-line';
    const b = document.createElement('div');
    b.className = 'doom-line';
    document.body.append(a, b, document.createElement('span'));
    expect(document.querySelectorAll('.doom-line')).toHaveLength(2);

    removeDoomLines();
    expect(document.querySelectorAll('.doom-line')).toHaveLength(0);
  });

  it('scopes removal to the provided root subtree', () => {
    const scoped = document.createElement('div');
    const inside = document.createElement('div');
    inside.className = 'doom-line';
    scoped.append(inside);

    const outside = document.createElement('div');
    outside.className = 'doom-line';
    document.body.append(scoped, outside);

    removeDoomLines(scoped);
    expect(scoped.querySelectorAll('.doom-line')).toHaveLength(0);
    // The doom-line outside the passed root is untouched.
    expect(document.querySelectorAll('.doom-line')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * DND_CLASS — the visual-parity class-name contract (types.ts)
 * -------------------------------------------------------------------------- */

describe('DND_CLASS constant', () => {
  it('deep-equals the frozen class-name contract', () => {
    expect(DND_CLASS).toEqual({
      transit: 'gu-transit',
      transitMulti: 'gu-transit-multi',
      targetDrop: 'target-drop',
      mirror: 'multiple-drag-mirror',
      selected: 'ui-multisortable-multiple',
      moved: 'kanban-moved',
      newColumn: 'new',
      dragActive: 'drag-active',
    });
  });
});

/* -------------------------------------------------------------------------- *
 * autoScroll — getAutoScrollOptions + source-of-truth configs (autoScroll.ts)
 * -------------------------------------------------------------------------- */

describe('getAutoScrollOptions', () => {
  it('returns the Kanban options (acceleration 10) by reference for "kanban"', () => {
    const opts = getAutoScrollOptions('kanban');
    expect(opts).toBe(KANBAN_AUTOSCROLL);
    expect(opts.acceleration).toBe(10);
    expect(opts.enabled).toBe(true);
    expect(opts.threshold).toEqual({ x: 0.2, y: 0.2 });
  });

  it('returns the Backlog options (acceleration 30) by reference for "backlog"', () => {
    const opts = getAutoScrollOptions('backlog');
    expect(opts).toBe(BACKLOG_AUTOSCROLL);
    expect(opts.acceleration).toBe(30);
    expect(opts.enabled).toBe(true);
    expect(opts.threshold).toEqual({ x: 0.0, y: 0.1 });
  });

  it('preserves the source-of-truth dom-autoscroller config values', () => {
    expect(KANBAN_AUTOSCROLL_CONFIG).toEqual({
      margin: 100,
      scrollWhenOutside: true,
    });
    expect(BACKLOG_AUTOSCROLL_CONFIG).toEqual({
      margin: 20,
      pixels: 30,
      scrollWhenOutside: true,
    });
  });

  it('keeps the parity invariants: kanban edge zone > backlog, backlog speed > kanban', () => {
    // Kanban has the LARGER edge zone; Backlog scrolls FASTER (orig pixels: 30).
    expect(KANBAN_AUTOSCROLL.threshold).toEqual({ x: 0.2, y: 0.2 });
    expect(BACKLOG_AUTOSCROLL.threshold).toEqual({ x: 0.0, y: 0.1 });
    expect(BACKLOG_AUTOSCROLL.acceleration).toBeGreaterThan(
      KANBAN_AUTOSCROLL.acceleration as number,
    );
  });
});

/* -------------------------------------------------------------------------- *
 * Drag-end handler factories — deterministic smoke tests with an INJECTED mock
 * api. The real ../api/userstories adapter is NEVER called (no network).
 * -------------------------------------------------------------------------- */

describe('createKanbanDragEndHandler (deterministic, injected mock api)', () => {
  it('returns a callable handler', () => {
    const handler = createKanbanDragEndHandler({
      projectId: 1,
      onMove: jest.fn(),
      api: {
        bulkUpdateKanbanOrder: jest.fn().mockResolvedValue({}),
      } as unknown as KanbanOrderApi,
      getSelectedIds: () => [],
    });
    expect(typeof handler).toBe('function');
  });

  it('applies the optimistic onMove result and calls the injected api with after-precedence args', async () => {
    const onMove = jest.fn();
    const bulkUpdateKanbanOrder = jest.fn().mockResolvedValue({});
    const handler = createKanbanDragEndHandler({
      projectId: 42,
      onMove,
      api: { bulkUpdateKanbanOrder } as unknown as KanbanOrderApi,
      getSelectedIds: () => [],
    });

    // DATA PATH (cross-column): moved id 20 comes from status 1 and is dropped
    // OVER card 30 in status 2's default (swimlane -1) row, whose current order
    // is [10, 30]. Simulating the drop splices 20 at 30's index -> FINAL order
    // [10, 20, 30], so 20 lands at index 1 with previous = 10 (after-precedence).
    const event = makeEvent(
      20,
      { statusId: 1, swimlaneId: -1, oldIndex: 0 },
      { statusId: 2, swimlaneId: -1, orderedIds: [10, 30] },
      30,
    );

    await handler(event);

    expect(onMove).toHaveBeenCalledTimes(1);
    const result = onMove.mock.calls[0][0] as KanbanDragResult;
    expect(result).toEqual({
      movedIds: [20],
      newStatus: 2,
      newSwimlane: -1,
      index: 1,
      afterUserstoryId: 10, // previous wins (after-precedence)
      beforeUserstoryId: null,
    });

    // -1 swimlane sentinel is mapped to null on the wire; ids passed straight through.
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1);
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(
      42,
      2,
      null,
      10,
      null,
      [20],
    );
  });

  it('does nothing when there is no drop target (over == null)', async () => {
    const onMove = jest.fn();
    const bulkUpdateKanbanOrder = jest.fn().mockResolvedValue({});
    const handler = createKanbanDragEndHandler({
      projectId: 1,
      onMove,
      api: { bulkUpdateKanbanOrder } as unknown as KanbanOrderApi,
      getSelectedIds: () => [],
    });

    await handler(makeEvent(20, { statusId: 1, swimlaneId: -1 }, null));

    expect(onMove).not.toHaveBeenCalled();
    expect(bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });
});

describe('createBacklogDragEndHandler (deterministic, injected mock api)', () => {
  it('returns a callable handler', () => {
    const handler = createBacklogDragEndHandler({
      projectId: 1,
      onMove: jest.fn(),
      api: {
        bulkUpdateBacklogOrder: jest.fn().mockResolvedValue({}),
      } as unknown as BacklogOrderApi,
      getSelectedIds: () => [],
    });
    expect(typeof handler).toBe('function');
  });

  it('always runs cleanup, then applies onMove and calls the injected api (sprint target)', async () => {
    // Pre-seed the side effects the handler must always clean up on dragend.
    document.body.classList.add(DND_CLASS.dragActive);
    const doom = document.createElement('div');
    doom.className = 'doom-line';
    document.body.append(doom);

    const onMove = jest.fn();
    const bulkUpdateBacklogOrder = jest.fn().mockResolvedValue({});
    const handler = createBacklogDragEndHandler({
      projectId: 7,
      onMove,
      api: { bulkUpdateBacklogOrder } as unknown as BacklogOrderApi,
      getSelectedIds: () => [],
    });

    // DATA PATH: moved id 3 lands at index 1 of [10, 3, 30] in sprint 9.
    const event = makeEvent(
      3,
      { sprintId: 5, isBacklog: false, oldIndex: 0 },
      { isBacklog: false, sprintId: 9, orderedIds: [10, 3, 30] },
    );

    await handler(event);

    // Cleanup ALWAYS runs first (backlog/sortable.coffee:95,103).
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
    expect(document.querySelectorAll('.doom-line')).toHaveLength(0);

    expect(onMove).toHaveBeenCalledTimes(1);
    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result).toEqual({
      movedIds: [3],
      targetSprintId: 9,
      index: 1,
      previousUs: 10, // after-precedence: previous wins
      nextUs: null,
      isBacklog: false,
    });

    expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, 9, 10, null, [3]);
  });

  it('targets the backlog list (targetSprintId null) and uses next when moved is first', async () => {
    const onMove = jest.fn();
    const bulkUpdateBacklogOrder = jest.fn().mockResolvedValue({});
    const handler = createBacklogDragEndHandler({
      projectId: 7,
      onMove,
      api: { bulkUpdateBacklogOrder } as unknown as BacklogOrderApi,
      getSelectedIds: () => [],
    });

    // Moved id 3 is FIRST in the backlog list order -> no previous, next = 20.
    const event = makeEvent(
      3,
      { sprintId: 9, isBacklog: false, oldIndex: 5 },
      { isBacklog: true, orderedIds: [3, 20, 30] },
    );

    await handler(event);

    const result = onMove.mock.calls[0][0] as BacklogDragResult;
    expect(result.targetSprintId).toBeNull();
    expect(result.isBacklog).toBe(true);
    expect(result.previousUs).toBeNull();
    expect(result.nextUs).toBe(20);
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(7, null, null, 20, [3]);
  });
});

