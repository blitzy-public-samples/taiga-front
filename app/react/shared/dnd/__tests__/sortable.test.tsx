/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the sortable DnD geometry helpers, `useSortable` wrappers, and
 * drag-end handler factories (F09 coverage, F41 visual-parity, contract freeze).
 *
 * The two correctness-critical fidelity points are asserted directly here:
 *   1. AFTER-PRECEDENCE — `afterUserstoryId`/`previousUs` wins; the `before`/`next`
 *      id is sent ONLY when there is no previous (AT MOST ONE is non-null), and
 *      {@link computeAdjacentIds} (DOM) and {@link computeAdjacentIdsFromOrder}
 *      (data model) produce IDENTICAL output.
 *   2. `bulk_userstories` IS `number[]` — the moved-id set is passed straight to
 *      the frozen `/api/v1/` endpoints as an array of ids.
 *
 * The pure helpers are exercised with a jsdom-built DOM. The handler factories
 * are driven with a fake `DragEndEvent` + a mocked `api` + a spy `onMove`, so the
 * exact endpoint arguments, the no-op guard, and the backlog serialization are
 * assertable without a real browser or network.
 */

import { renderHook } from '@testing-library/react';
import { CSS } from '@dnd-kit/utilities';
import type { DragEndEvent } from '@dnd-kit/core';

// Mock `useSortable` so the hook wrappers can be tested with a controlled drag
// state (transform / transition / isDragging) — no DndContext or real drag needed.
// The rest of the module is kept REAL via `requireActual` so pure helpers such as
// `arrayMove` (used by `computeFinalOrder`) resolve normally — they have no React
// or DOM dependency and are safe to run under jsdom.
jest.mock('@dnd-kit/sortable', () => ({
  ...jest.requireActual('@dnd-kit/sortable'),
  useSortable: jest.fn(),
}));
import { useSortable } from '@dnd-kit/sortable';

// Mock the api adapter so the "default api" branch (`deps.api ?? userstories`) can
// be exercised without importing the real httpClient. Injected local mocks are
// used elsewhere to assert exact arguments.
jest.mock('../../api/userstories', () => ({
  __esModule: true,
  default: {
    bulkUpdateKanbanOrder: jest.fn().mockResolvedValue(undefined),
    bulkUpdateBacklogOrder: jest.fn().mockResolvedValue(undefined),
    bulkUpdateMilestone: jest.fn().mockResolvedValue(undefined),
    bulkCreate: jest.fn(),
    editStatus: jest.fn(),
  },
}));
import userstories from '../../api/userstories';

import {
  matchesItem,
  computeAdjacentIds,
  computeAdjacentIdsFromOrder,
  computeFinalOrder,
  readKanbanColumnTarget,
  readColumnTargetFromData,
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
  useSortableItem,
  useSortableCard,
  useSortableRow,
  createKanbanDragEndHandler,
  createBacklogDragEndHandler,
} from '../sortable';
import { DND_CLASS, type KanbanOrderApi, type BacklogOrderApi } from '../types';

const mockUseSortable = useSortable as jest.Mock;

/* -------------------------------------------------------------------------- *
 * jsdom DOM builders
 * -------------------------------------------------------------------------- */

/** Build an element with a tag, class list, and dataset. */
function el(
  tag: string,
  classes: string[] = [],
  dataset: Record<string, string> = {},
): HTMLElement {
  const node = document.createElement(tag);
  classes.forEach((c) => node.classList.add(c));
  Object.entries(dataset).forEach(([k, v]) => {
    node.dataset[k] = v;
  });
  return node;
}

/** Append `tg-card` children (with `data-id`) to a container and return them. */
function appendCards(container: HTMLElement, ids: number[]): HTMLElement[] {
  return ids.map((id) => {
    const card = el('tg-card', ['card'], { id: String(id) });
    container.appendChild(card);
    return card;
  });
}

/** Append `.row` children (with `data-id`) to a container and return them. */
function appendRows(container: HTMLElement, ids: number[]): HTMLElement[] {
  return ids.map((id) => {
    const row = el('div', ['row'], { id: String(id) });
    container.appendChild(row);
    return row;
  });
}

/** Build a minimal fake DragEndEvent reading only the fields the handlers use. */
function makeEvent(
  activeId: number,
  activeData: Record<string, unknown> | undefined,
  // `null` => no `over` target at all; `undefined` => an `over` target is
  // present but its `data.current` is empty (exercises the defensive
  // optional-chaining / `?? undefined` short-circuit arms in the handlers).
  overData: Record<string, unknown> | null | undefined,
  // The id of the `over` droppable. At runtime a sibling card is the drop
  // target, so this is its numeric user-story id — the DATA-path handler reads
  // `Number(over.id)` to simulate the drop over that card. Defaults to a
  // non-numeric sentinel (coerces to NaN, i.e. "no specific target card") so
  // DOM-path and defensive tests that don't set it are unaffected.
  overId: number | string = 'over-droppable',
): DragEndEvent {
  const active = {
    id: activeId,
    data: { current: activeData },
    rect: { current: { initial: null, translated: null } },
  };
  const over =
    overData === null
      ? null
      : {
          id: overId,
          rect: {},
          data: { current: overData },
          disabled: false,
        };
  return {
    activatorEvent: new Event('pointerup'),
    active,
    collisions: null,
    delta: { x: 0, y: 0 },
    over,
  } as unknown as DragEndEvent;
}

/** Flush all pending microtasks (and one macrotask tick). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

/* ========================================================================== *
 * Phase 1 — PURE helpers
 * ========================================================================== */

describe('matchesItem', () => {
  it('matches the item selector when NOT the transit placeholder', () => {
    const card = el('tg-card');
    expect(matchesItem(card, 'tg-card')).toBe(true);
  });

  it('rejects the transit placeholder (reproduces :not(.gu-transit))', () => {
    const card = el('tg-card', [DND_CLASS.transit]);
    expect(matchesItem(card, 'tg-card')).toBe(false);
  });

  it('rejects an element of a different selector', () => {
    const row = el('div', ['row']);
    expect(matchesItem(row, 'tg-card')).toBe(false);
  });
});

describe('computeAdjacentIds (DOM after-precedence)', () => {
  it('[A][moved][B][C] -> { previousId: A, nextId: null }', () => {
    const col = el('div');
    const [a, moved] = appendCards(col, [10, 20, 30, 40]);
    expect(a.dataset.id).toBe('10');
    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: 10,
      nextId: null,
    });
  });

  it('[moved][B] (top of list) -> { previousId: null, nextId: B }', () => {
    const col = el('div');
    const [moved] = appendCards(col, [20, 30]);
    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: null,
      nextId: 30,
    });
  });

  it('single item -> { previousId: null, nextId: null }', () => {
    const col = el('div');
    const [moved] = appendCards(col, [20]);
    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('skips a gu-transit sibling and intervening non-matching nodes', () => {
    const col = el('div');
    const a = el('tg-card', ['card'], { id: '10' });
    const transit = el('tg-card', ['card', DND_CLASS.transit], { id: '99' });
    const other = el('div', ['not-a-card']);
    const moved = el('tg-card', ['card'], { id: '20' });
    col.append(a, other, transit, moved);
    // Nearest matching, non-transit preceding sibling is A(10).
    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: 10,
      nextId: null,
    });
  });

  it('breaks on the closest preceding match even if it has no data-id', () => {
    const col = el('div');
    const noId = el('tg-card', ['card']); // matching sibling, no data-id
    const earlier = el('tg-card', ['card'], { id: '10' });
    const moved = el('tg-card', ['card'], { id: '20' });
    col.append(earlier, noId, moved);
    // jQuery prev[0] is `noId` (closest match); it has no id, so previousId stays
    // null and we do NOT look further back — but with no previous we then consult
    // next (none here) => both null.
    expect(computeAdjacentIds(moved, 'tg-card')).toEqual({
      previousId: null,
      nextId: null,
    });
  });
});

describe('computeAdjacentIdsFromOrder (data-model after-precedence)', () => {
  it('[A, moved, B, C] -> { previousId: A, nextId: null }', () => {
    expect(computeAdjacentIdsFromOrder([10, 20, 30, 40], 20)).toEqual({
      previousId: 10,
      nextId: null,
    });
  });

  it('[moved, B] (top) -> { previousId: null, nextId: B }', () => {
    expect(computeAdjacentIdsFromOrder([20, 30], 20)).toEqual({
      previousId: null,
      nextId: 30,
    });
  });

  it('single element -> both null', () => {
    expect(computeAdjacentIdsFromOrder([20], 20)).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('moved id absent from the list -> both null', () => {
    expect(computeAdjacentIdsFromOrder([10, 30], 20)).toEqual({
      previousId: null,
      nextId: null,
    });
  });

  it('produces IDENTICAL output to computeAdjacentIds for the same arrangement', () => {
    const arrangements: number[][] = [
      [10, 20, 30, 40],
      [20, 30, 40],
      [10, 20],
      [20],
    ];
    for (const ids of arrangements) {
      const col = el('div');
      const cards = appendCards(col, ids);
      const movedIdx = 0 === ids.indexOf(20) ? 0 : ids.indexOf(20);
      const moved = cards[movedIdx];
      const domResult = computeAdjacentIds(moved, 'tg-card');
      const modelResult = computeAdjacentIdsFromOrder(ids, 20);
      expect(modelResult).toEqual(domResult);
    }
  });
});

describe('computeFinalOrder (simulate the drop to derive the FINAL order — KB-7)', () => {
  // SAME container: the active id is already present and is relocated with
  // `arrayMove` from its current index to the over card's index.
  it('same container, move DOWN over a lower card -> arrayMove to that slot', () => {
    // 20 dropped over 40: 20 lands where 40 was; 40 shifts up one.
    expect(computeFinalOrder([10, 20, 30, 40], 20, 40)).toEqual([10, 30, 40, 20]);
  });

  it('same container, move UP over a higher card -> arrayMove to that slot', () => {
    // 40 dropped over 10: 40 lands at the top; the rest shift down one.
    expect(computeFinalOrder([10, 20, 30, 40], 40, 10)).toEqual([40, 10, 20, 30]);
  });

  it('same container, dropped over ITSELF -> order unchanged (feeds the no-op guard)', () => {
    // The drop-in-place case: over.id === active.id. The final order equals the
    // current order, so `finalOrder.indexOf(activeId) === oldIndex` and the
    // handler's no-op guard can fire (no redundant write).
    expect(computeFinalOrder([10, 20, 30], 20, 20)).toEqual([10, 20, 30]);
  });

  it('same container, over id NOT found (dropped on the column body) -> moved to the END', () => {
    expect(computeFinalOrder([10, 20, 30], 10, 999)).toEqual([20, 30, 10]);
  });

  // CROSS container: the active id is absent and is spliced in at the over slot.
  it('cross container, insert BEFORE the over card at its index', () => {
    // 20 comes from another column and is dropped over 30 (index 1) -> lands at 1.
    expect(computeFinalOrder([10, 30], 20, 30)).toEqual([10, 20, 30]);
  });

  it('cross container, over id NOT found -> appended to the end', () => {
    expect(computeFinalOrder([10, 30], 20, 999)).toEqual([10, 30, 20]);
  });

  it('cross container, empty destination -> becomes the sole element', () => {
    expect(computeFinalOrder([], 20, 999)).toEqual([20]);
  });

  it('KB-7 regression: a same-column reorder yields the DROP TARGET as the neighbor', () => {
    // Reproduces the reported defect shape: id 30 is dragged DOWN over id 143 in
    // a column whose current order still lists 30 next to its ORIGINAL neighbor
    // 32. The FINAL order must place 143 immediately before 30 so adjacency sends
    // after=143 (the drop target), never the stale original neighbor 32.
    const current = [30, 32, 100, 143, 200];
    const final = computeFinalOrder(current, 30, 143);
    expect(final).toEqual([32, 100, 143, 30, 200]);
    expect(computeAdjacentIdsFromOrder(final, 30)).toEqual({
      previousId: 143,
      nextId: null,
    });
  });
});

describe('readKanbanColumnTarget', () => {
  it('reads Number(dataset.status/.swimlane) from the column element', () => {
    const col = el('div', ['taskboard-column'], { status: '3', swimlane: '2' });
    expect(readKanbanColumnTarget(col)).toEqual({ newStatus: 3, newSwimlane: 2 });
  });

  it('reads the -1 swimlane sentinel unchanged', () => {
    const col = el('div', ['taskboard-column'], { status: '5', swimlane: '-1' });
    expect(readKanbanColumnTarget(col)).toEqual({ newStatus: 5, newSwimlane: -1 });
  });

  it('reads a MISSING data-swimlane (non-swimlane project column) as null (KB-6)', () => {
    // A non-swimlane project's column carries no `data-swimlane`; that must read
    // as null (the "no swimlane" state), not NaN, so the no-op guard can match it
    // against the equally-null source swimlane.
    const col = el('div', ['taskboard-column'], { status: '5' });
    expect(readKanbanColumnTarget(col)).toEqual({ newStatus: 5, newSwimlane: null });
  });
});

describe('readColumnTargetFromData', () => {
  it('reads statusId/swimlaneId from the droppable data', () => {
    expect(readColumnTargetFromData({ statusId: 4, swimlaneId: 7 })).toEqual({
      newStatus: 4,
      newSwimlane: 7,
    });
  });

  it('coerces a missing status to NaN (surfaces a wiring bug loudly) but a missing swimlane to null (the no-swimlane state)', () => {
    // A card ALWAYS carries a status, so a missing statusId is a wiring bug and
    // stays a loud NaN. A missing swimlaneId is the legitimate "no swimlane"
    // state of a non-swimlane project and MUST read as null (KB-6).
    const target = readColumnTargetFromData(null);
    expect(Number.isNaN(target.newStatus)).toBe(true);
    expect(target.newSwimlane).toBeNull();
  });

  it('reads an explicit null swimlaneId as null (KB-6 non-swimlane project)', () => {
    expect(readColumnTargetFromData({ statusId: 4, swimlaneId: null })).toEqual({
      newStatus: 4,
      newSwimlane: null,
    });
  });
});

describe('toApiSwimlane', () => {
  it('maps the -1 sentinel to null', () => {
    expect(toApiSwimlane(-1)).toBeNull();
  });

  it('passes 0 through (0 is a valid swimlane id)', () => {
    expect(toApiSwimlane(0)).toBe(0);
  });

  it('passes a positive id through unchanged', () => {
    expect(toApiSwimlane(5)).toBe(5);
  });

  it('passes null through as null (KB-6 non-swimlane project)', () => {
    expect(toApiSwimlane(null)).toBeNull();
  });
});

describe('indexAmong', () => {
  it('returns the position among matching descendants', () => {
    const col = el('div');
    const cards = appendCards(col, [10, 20, 30]);
    expect(indexAmong(cards[2], col, 'tg-card')).toBe(2);
  });

  it('returns -1 when the element is not a matching descendant', () => {
    const col = el('div');
    appendCards(col, [10, 20]);
    const stranger = el('tg-card', ['card'], { id: '99' });
    expect(indexAmong(stranger, col, 'tg-card')).toBe(-1);
  });
});

describe('container predicates', () => {
  it('isKanbanContainer matches .taskboard-column only', () => {
    expect(isKanbanContainer(el('div', ['taskboard-column']))).toBe(true);
    expect(isKanbanContainer(el('div', ['sprint-table']))).toBe(false);
  });

  it('isBacklogContainer matches sprint-table / backlog-table-body / js-empty-backlog', () => {
    expect(isBacklogContainer(el('div', ['sprint-table']))).toBe(true);
    expect(isBacklogContainer(el('div', ['backlog-table-body']))).toBe(true);
    expect(isBacklogContainer(el('div', ['js-empty-backlog']))).toBe(true);
    expect(isBacklogContainer(el('div', ['taskboard-column']))).toBe(false);
  });

  it('isBacklogListContainer matches ONLY the backlog list zones (not sprints)', () => {
    expect(isBacklogListContainer(el('div', ['backlog-table-body']))).toBe(true);
    expect(isBacklogListContainer(el('div', ['js-empty-backlog']))).toBe(true);
    expect(isBacklogListContainer(el('div', ['sprint-table']))).toBe(false);
  });
});

describe('resolveMovedIds (dragMultiple selection rule)', () => {
  it('returns the whole selection when it contains the active id', () => {
    expect(resolveMovedIds(7, [7, 8, 9])).toEqual([7, 8, 9]);
  });

  it('returns [activeId] when the selection does NOT contain the active id', () => {
    expect(resolveMovedIds(7, [8, 9])).toEqual([7]);
  });

  it('returns [activeId] for an empty selection', () => {
    expect(resolveMovedIds(7, [])).toEqual([7]);
  });

  it('returns a COPY of the selection, not the same reference', () => {
    const selection = [7, 8];
    const result = resolveMovedIds(7, selection);
    expect(result).toEqual([7, 8]);
    expect(result).not.toBe(selection);
  });
});

/* ========================================================================== *
 * Phase 2 — Class-management helpers
 * ========================================================================== */

describe('addTargetDrop / removeTargetDrop', () => {
  it('toggles DND_CLASS.targetDrop on a container', () => {
    const container = el('div', ['taskboard-column']);
    addTargetDrop(container);
    expect(container.classList.contains(DND_CLASS.targetDrop)).toBe(true);
    removeTargetDrop(container);
    expect(container.classList.contains(DND_CLASS.targetDrop)).toBe(false);
  });
});

describe('setDragActive', () => {
  it('adds DND_CLASS.dragActive to document.body when on=true', () => {
    setDragActive(true);
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(true);
  });

  it('removes DND_CLASS.dragActive from document.body when on=false', () => {
    document.body.classList.add(DND_CLASS.dragActive);
    setDragActive(false);
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
  });
});

describe('markColumnNew', () => {
  it('adds DND_CLASS.newColumn and removes it on animationend (one-shot)', () => {
    const col = el('div', ['taskboard-column']);
    markColumnNew(col);
    expect(col.classList.contains(DND_CLASS.newColumn)).toBe(true);

    col.dispatchEvent(new Event('animationend'));
    expect(col.classList.contains(DND_CLASS.newColumn)).toBe(false);

    // Listener self-detached ({ once: true }); a second event is a no-op.
    col.dispatchEvent(new Event('animationend'));
    expect(col.classList.contains(DND_CLASS.newColumn)).toBe(false);
  });
});

describe('removeDoomLines', () => {
  it('removes every .doom-line node under the root', () => {
    const root = el('div');
    root.appendChild(el('div', ['doom-line']));
    root.appendChild(el('div', ['doom-line']));
    root.appendChild(el('div', ['keep']));
    removeDoomLines(root);
    expect(root.querySelectorAll('.doom-line').length).toBe(0);
    expect(root.querySelectorAll('.keep').length).toBe(1);
  });

  it('defaults to document when no root is given', () => {
    document.body.appendChild(el('div', ['doom-line']));
    removeDoomLines();
    expect(document.querySelectorAll('.doom-line').length).toBe(0);
  });
});

/* ========================================================================== *
 * Phase 3 — useSortable wrappers
 * ========================================================================== */

describe('useSortableItem / useSortableCard / useSortableRow', () => {
  const baseReturn = {
    setNodeRef: jest.fn(),
    attributes: { role: 'button', tabIndex: 0 },
    listeners: { onPointerDown: jest.fn() },
    transform: null,
    transition: undefined,
    isDragging: false,
  };

  it('maps a NON-dragging item: className empty, transform undefined', () => {
    mockUseSortable.mockReturnValue({ ...baseReturn });
    const { result } = renderHook(() => useSortableCard(7));
    expect(result.current.className).toBe('');
    expect(result.current.isDragging).toBe(false);
    expect(result.current.style.transform).toBeUndefined();
    expect(typeof result.current.setNodeRef).toBe('function');
    expect(result.current.attributes).toEqual({ role: 'button', tabIndex: 0 });
  });

  it('maps a DRAGGING item: className gu-transit + transform via CSS.Transform.toString', () => {
    const transform = { x: 10, y: 20, scaleX: 1, scaleY: 1 };
    mockUseSortable.mockReturnValue({
      ...baseReturn,
      transform,
      transition: 'transform 200ms ease',
      isDragging: true,
    });
    const { result } = renderHook(() => useSortableRow(7));
    expect(result.current.className).toBe(DND_CLASS.transit);
    expect(result.current.isDragging).toBe(true);
    // Delegates to CSS.Transform.toString (not a hardcoded string).
    expect(result.current.style.transform).toBe(CSS.Transform.toString(transform));
    expect(result.current.style.transition).toBe('transform 200ms ease');
  });

  it('forwards id + data verbatim to useSortable', () => {
    mockUseSortable.mockReturnValue({ ...baseReturn });
    const data = { usId: 42, statusId: 3, swimlaneId: 2, oldIndex: 1 };
    renderHook(() => useSortableItem(42, data));
    expect(mockUseSortable).toHaveBeenCalledWith({ id: 42, data });
  });
});

/* ========================================================================== *
 * Phase 4 — createKanbanDragEndHandler
 * ========================================================================== */

describe('createKanbanDragEndHandler', () => {
  let bulkUpdateKanbanOrder: jest.Mock;
  let api: KanbanOrderApi;
  let onMove: jest.Mock;

  beforeEach(() => {
    bulkUpdateKanbanOrder = jest.fn().mockResolvedValue(undefined);
    api = { bulkUpdateKanbanOrder } as unknown as KanbanOrderApi;
    onMove = jest.fn();
  });

  it('data path: after-precedence PREVIOUS + exact endpoint args', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // Same-column reorder: current order [7, 11, 8], drag 7 DOWN over 11. The
    // FINAL order is [11, 7, 8], so 7 lands between 11 and 8 -> previous = 11
    // (after-precedence), next = null. This is the KB-7 shape: neighbors come
    // from the DROP TARGET, not 7's original neighbor.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, orderedIds: [7, 11, 8] },
        11,
      ),
    );

    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      newStatus: 3,
      newSwimlane: 2,
      index: 1,
      afterUserstoryId: 11,
      beforeUserstoryId: null,
    });
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
  });

  it('data path: after-precedence NEXT when dropped at the top', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // Same-column reorder: current order [8, 7, 9], drag 7 UP over 8. The FINAL
    // order is [7, 8, 9], so 7 lands at the TOP -> previous = null, next = 8.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 1 },
        { statusId: 3, swimlaneId: 2, orderedIds: [8, 7, 9] },
        8,
      ),
    );

    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ afterUserstoryId: null, beforeUserstoryId: 8 }),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, 8, [7]);
  });

  it('maps swimlane -1 to null in the API call', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // Same-column reorder in the -1 (unclassified) swimlane: current [7, 11],
    // drag 7 over 11 -> FINAL [11, 7], previous = 11.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: -1, oldIndex: 0 },
        { statusId: 3, swimlaneId: -1, orderedIds: [7, 11] },
        11,
      ),
    );

    // newSwimlane in the result stays -1; the API arg is null.
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ newSwimlane: -1 }),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, null, 11, null, [7]);
  });

  it('passes bulkUserstories as a number[] (never {us_id, order})', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 0, oldIndex: 0 },
        { statusId: 3, swimlaneId: 0, orderedIds: [7, 11] },
        11,
      ),
    );
    const bulk = bulkUpdateKanbanOrder.mock.calls[0][5];
    expect(Array.isArray(bulk)).toBe(true);
    expect(bulk).toEqual([7]);
    expect(bulk.every((v: unknown) => typeof v === 'number')).toBe(true);
  });

  it('uses the multi-selection as movedIds when the active id is selected', async () => {
    const handler = createKanbanDragEndHandler({
      projectId: 100,
      onMove,
      api,
      getSelectedIds: () => [7, 8, 9],
    });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, orderedIds: [7, 11, 8, 9] },
        11,
      ),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7, 8, 9]);
  });

  it('NO-OP GUARD: same container + unchanged index -> neither onMove nor api', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // Drop-in-place: 7 dropped over ITSELF in [11, 7, 8]. The FINAL order is
    // unchanged, so index (1) === oldIndex (1) in the same container -> no-op.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 1 },
        { statusId: 3, swimlaneId: 2, orderedIds: [11, 7, 8] },
        7,
      ),
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });

  it('dropped outside any column (over == null) -> no-op', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(makeEvent(7, { statusId: 1, swimlaneId: 2, oldIndex: 0 }, null));
    expect(onMove).not.toHaveBeenCalled();
    expect(bulkUpdateKanbanOrder).not.toHaveBeenCalled();
  });

  it('calls onMove BEFORE the API request (state first, then request)', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, orderedIds: [7, 11] },
        11,
      ),
    );
    expect(onMove.mock.invocationCallOrder[0]).toBeLessThan(
      bulkUpdateKanbanOrder.mock.invocationCallOrder[0],
    );
  });

  it('DOM path: reads columnEl, computes adjacency, and marks the destination "new"', async () => {
    const column = el('div', ['taskboard-column'], { status: '3', swimlane: '2' });
    appendCards(column, [11, 7, 8]);
    document.body.appendChild(column);

    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 1, swimlaneId: 2, oldIndex: 0 }, // source status 1 != dest 3
        { columnEl: column },
      ),
    );

    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      newStatus: 3,
      newSwimlane: 2,
      index: 1,
      afterUserstoryId: 11,
      beforeUserstoryId: null,
    });
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
    // Different container => one-shot "new" animation applied.
    expect(column.classList.contains(DND_CLASS.newColumn)).toBe(true);
  });

  it('reads orderedIds from @dnd-kit sortable.items fallback', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // No explicit `orderedIds`; the current order is taken from @dnd-kit's
    // auto-attached `sortable.items` ([7, 11, 8]). Drag 7 over 11 -> FINAL
    // [11, 7, 8], previous = 11.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, sortable: { items: [7, 11, 8] } },
        11,
      ),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
  });

  it('tolerates an over target whose data.current is empty (defensive short-circuits)', async () => {
    // `over` is present but carries no data.current: readElement -> null,
    // readColumnTargetFromData / readOrderedIds receive `undefined` and
    // short-circuit their optional chains. The move is still dispatched.
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(makeEvent(7, undefined, undefined));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1);
  });

  it('processes conservatively when the source data is absent (no oldIndex to guard on)', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // active.data.current is undefined -> sourceStatus/swimlane/oldIndex all null,
    // so the no-op guard cannot fire and the move is processed (harmless reorder)
    // EVEN when 7 is dropped over itself in [11, 7] (FINAL order unchanged,
    // previous = 11).
    await handler(
      makeEvent(7, undefined, { statusId: 3, swimlaneId: 2, orderedIds: [11, 7] }, 7),
    );
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 3, afterUserstoryId: 11 }),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
  });

  it('data path into an empty destination -> card becomes the sole element (adjacency null, index 0)', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // No orderedIds and no sortable.items -> the destination order is empty, so
    // the cross-container insert makes 7 the SOLE element: FINAL [7], index 0,
    // no neighbors. (Reproduces dropping into an empty column.)
    await handler(
      makeEvent(
        7,
        { statusId: 1, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2 }, // no orderedIds and no sortable.items
      ),
    );
    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      newStatus: 3,
      newSwimlane: 2,
      index: 0,
      afterUserstoryId: null,
      beforeUserstoryId: null,
    });
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, null, [7]);
  });

  it('DOM path reads an explicit cardEl from the active data when provided', async () => {
    const column = el('div', ['taskboard-column'], { status: '3', swimlane: '2' });
    const [, card7] = appendCards(column, [11, 7, 8]);
    document.body.appendChild(column);

    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0, cardEl: card7 },
        { columnEl: column },
      ),
    );
    // previous sibling is card 11 -> after-precedence previous.
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
  });

  it('falls back to the default api (userstories) when deps.api is omitted', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, orderedIds: [7, 11] },
        11,
      ),
    );
    expect(userstories.bulkUpdateKanbanOrder).toHaveBeenCalledWith(
      100,
      3,
      2,
      11,
      null,
      [7],
    );
  });

  // --- defensive / robustness branches (wiring-mistake scenarios) ----------- //

  it('ignores a non-element columnEl and takes the data path instead', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 0 },
        // columnEl is not an HTMLElement -> readElement returns null -> data path.
        // Current order [7, 11], drag 7 over 11 -> FINAL [11, 7], previous = 11.
        { columnEl: 'not-an-element', statusId: 3, swimlaneId: 2, orderedIds: [7, 11] },
        11,
      ),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, 11, null, [7]);
  });

  it('DOM path with the moved card absent -> adjacency null, index -1', async () => {
    const column = el('div', ['taskboard-column'], { status: '3', swimlane: '2' });
    appendCards(column, [11, 8]); // no card with id 99
    document.body.appendChild(column);

    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(99, { statusId: 1, swimlaneId: 2, oldIndex: 0 }, { columnEl: column }),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, null, [99]);
  });

  it('treats a non-numeric oldIndex as unknown (guard cannot fire)', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    // Same container, 7 dropped over itself in [7, 8] (FINAL order unchanged,
    // index 0, next = 8), but oldIndex is non-numeric -> NaN -> null, so the
    // no-op guard cannot fire and the move is processed anyway.
    await handler(
      makeEvent(
        7,
        { statusId: 3, swimlaneId: 2, oldIndex: 'x' },
        { statusId: 3, swimlaneId: 2, orderedIds: [7, 8] },
        7,
      ),
    );
    expect(onMove).toHaveBeenCalled();
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, 8, [7]);
  });

  it('ignores a malformed sortable bag (items not an array) -> empty order', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 1, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, sortable: { items: 'nope' } },
      ),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, null, [7]);
  });

  it('ignores a non-object sortable bag -> empty order', async () => {
    const handler = createKanbanDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { statusId: 1, swimlaneId: 2, oldIndex: 0 },
        { statusId: 3, swimlaneId: 2, sortable: 42 },
      ),
    );
    expect(bulkUpdateKanbanOrder).toHaveBeenCalledWith(100, 3, 2, null, null, [7]);
  });
});

/* ========================================================================== *
 * Phase 4 — createBacklogDragEndHandler
 * ========================================================================== */

describe('createBacklogDragEndHandler', () => {
  let bulkUpdateBacklogOrder: jest.Mock;
  let api: BacklogOrderApi;
  let onMove: jest.Mock;

  beforeEach(() => {
    bulkUpdateBacklogOrder = jest.fn().mockResolvedValue(undefined);
    api = { bulkUpdateBacklogOrder } as unknown as BacklogOrderApi;
    onMove = jest.fn();
  });

  it('data path (sprint target): after-precedence PREVIOUS + exact endpoint args + cleanup', async () => {
    document.body.classList.add(DND_CLASS.dragActive);
    document.body.appendChild(el('div', ['doom-line']));

    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { sprintId: 55, orderedIds: [11, 7, 8] },
      ),
    );

    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      targetSprintId: 55,
      index: 1,
      previousUs: 11,
      nextUs: null,
      isBacklog: false,
    });
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, 55, 11, null, [7]);
    // Cleanup always runs on dragend.
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
    expect(document.querySelectorAll('.doom-line').length).toBe(0);
  });

  it('backlog-list target -> targetSprintId null + after-precedence NEXT', async () => {
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { isBacklog: true, orderedIds: [7, 8] },
      ),
    );

    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      targetSprintId: null,
      index: 0,
      previousUs: null,
      nextUs: 8,
      isBacklog: true,
    });
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, null, null, 8, [7]);
  });

  it('reads the sprint id from the targetSprintId data field when sprintId is absent', async () => {
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { targetSprintId: 55, orderedIds: [11, 7] },
      ),
    );
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, 55, 11, null, [7]);
  });

  it('NO-OP GUARD: same sprint + unchanged index -> no onMove/api, but cleanup still ran', async () => {
    document.body.classList.add(DND_CLASS.dragActive);
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { sprintId: 55, oldIndex: 1 },
        { sprintId: 55, orderedIds: [11, 7, 8] },
      ),
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(bulkUpdateBacklogOrder).not.toHaveBeenCalled();
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
  });

  it('dropped outside any container (over == null) -> cleanup only, no onMove/api', async () => {
    document.body.classList.add(DND_CLASS.dragActive);
    document.body.appendChild(el('div', ['doom-line']));
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(makeEvent(7, { sprintId: 40, oldIndex: 0 }, null));
    expect(onMove).not.toHaveBeenCalled();
    expect(bulkUpdateBacklogOrder).not.toHaveBeenCalled();
    expect(document.body.classList.contains(DND_CLASS.dragActive)).toBe(false);
    expect(document.querySelectorAll('.doom-line').length).toBe(0);
  });

  it('DOM path (sprint-table): computes adjacency from real .row siblings', async () => {
    const sprintTable = el('div', ['sprint-table']);
    appendRows(sprintTable, [11, 7, 8]);
    document.body.appendChild(sprintTable);

    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { destEl: sprintTable, sprintId: 55 },
      ),
    );

    expect(onMove).toHaveBeenCalledWith({
      movedIds: [7],
      targetSprintId: 55,
      index: 1,
      previousUs: 11,
      nextUs: null,
      isBacklog: false,
    });
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, 55, 11, null, [7]);
  });

  it('DOM path (backlog-table-body): isBacklog true -> targetSprintId null', async () => {
    const backlogBody = el('div', ['backlog-table-body']);
    appendRows(backlogBody, [7, 8]);
    document.body.appendChild(backlogBody);

    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    // Source is a SPRINT (sprintId 40) moving INTO the backlog list -> a genuine
    // cross-container move (not caught by the same-container no-op guard).
    await handler(
      makeEvent(7, { sprintId: 40, oldIndex: 0 }, { destEl: backlogBody }),
    );

    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSprintId: null,
        isBacklog: true,
        previousUs: null,
        nextUs: 8,
      }),
    );
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, null, null, 8, [7]);
  });

  it('falls back to the default api (userstories) when deps.api is omitted', async () => {
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { sprintId: 55, orderedIds: [11, 7] },
      ),
    );
    expect(userstories.bulkUpdateBacklogOrder).toHaveBeenCalledWith(
      100,
      55,
      11,
      null,
      [7],
    );
  });

  it('uses the multi-selection as movedIds when the active id is selected', async () => {
    const handler = createBacklogDragEndHandler({
      projectId: 100,
      onMove,
      api,
      getSelectedIds: () => [7, 8, 9],
    });
    await handler(
      makeEvent(
        7,
        { sprintId: 40, oldIndex: 0 },
        { sprintId: 55, orderedIds: [11, 7, 8, 9] },
      ),
    );
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, 55, 11, null, [7, 8, 9]);
  });

  it('processes conservatively when the source data is absent', async () => {
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    // active.data.current undefined -> sourceSprintId/isBacklog/oldIndex all
    // absent, so the guard cannot fire and the move is processed.
    await handler(
      makeEvent(7, undefined, { sprintId: 55, orderedIds: [11, 7] }),
    );
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ targetSprintId: 55, previousUs: 11 }),
    );
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledWith(100, 55, 11, null, [7]);
  });

  it('tolerates an over target whose data.current is empty (defensive short-circuits)', async () => {
    // `over` present but no data.current: destEl -> null, so isBacklog falls
    // back to Boolean(overData?.isBacklog) (short-circuit) and targetSprintId
    // to toNumberOrNull(overData?.sprintId ?? overData?.targetSprintId) -> null.
    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });
    await handler(makeEvent(7, undefined, undefined));
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ targetSprintId: null, movedIds: [7] }),
    );
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
  });

  it('SERIALIZES overlapping drops: the second awaits the first API resolution', async () => {
    let resolveFirst: () => void = () => undefined;
    const firstPending = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    bulkUpdateBacklogOrder
      .mockImplementationOnce(() => firstPending)
      .mockImplementationOnce(() => Promise.resolve());

    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });

    const p1 = handler(
      makeEvent(7, { sprintId: 40, oldIndex: 0 }, { sprintId: 55, orderedIds: [11, 7] }),
    );
    const p2 = handler(
      makeEvent(8, { sprintId: 41, oldIndex: 0 }, { sprintId: 55, orderedIds: [7, 8] }),
    );

    // Let run1 execute up to its (pending) await. run2 must NOT have started.
    await flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);

    // Resolve the first request; only then does run2 proceed.
    resolveFirst();
    await Promise.all([p1, p2]);
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(2);
    // Ordering preserved: first drop's request precedes the second.
    expect(bulkUpdateBacklogOrder.mock.invocationCallOrder[0]).toBeLessThan(
      bulkUpdateBacklogOrder.mock.invocationCallOrder[1],
    );
  });

  it('continues the queue even if a drop rejects (a failed request does not wedge it)', async () => {
    bulkUpdateBacklogOrder
      .mockImplementationOnce(() => Promise.reject(new Error('network')))
      .mockImplementationOnce(() => Promise.resolve());

    const handler = createBacklogDragEndHandler({ projectId: 100, onMove, api });

    const p1 = handler(
      makeEvent(7, { sprintId: 40, oldIndex: 0 }, { sprintId: 55, orderedIds: [11, 7] }),
    );
    // First drop rejects; swallow so it is not an unhandled rejection.
    await expect(p1).rejects.toThrow('network');

    const p2 = handler(
      makeEvent(8, { sprintId: 41, oldIndex: 0 }, { sprintId: 55, orderedIds: [7, 8] }),
    );
    await p2;
    expect(bulkUpdateBacklogOrder).toHaveBeenCalledTimes(2);
  });
});
