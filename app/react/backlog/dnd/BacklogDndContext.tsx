/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Migrated from app/coffee/modules/backlog/sortable.coffee (dragula) to @dnd-kit/core.

/**
 * Backlog / Sprint-planning drag-and-drop provider for the migrated React
 * screen (`app/react/backlog/**`).
 *
 * WHAT THIS IS
 *   The single file of the Backlog `dnd/` layer. It renders the `@dnd-kit/core`
 *   `DndContext` that wraps the backlog table + sprint list rendered by
 *   `../BacklogApp.tsx`, and it maps every drag-end into a source-faithful
 *   "move user story" payload (`BacklogMovePayload`) that the container forwards
 *   to the `state` layer via the `onMove` prop. THIS FILE PERFORMS NO API CALL —
 *   the `state/useBacklog.moveUs` thunk owns the `/api/v1/` traffic; the wire
 *   mapping is documented here only as a fidelity comment near `handleDragEnd`.
 *
 * FIDELITY (zero behaviour change — AAP §0.1.1, §0.7.1)
 *   Reproduces the AngularJS `backlog/sortable.coffee` (dragula +
 *   dom-autoscroller) semantics EXACTLY:
 *     - draggables are `.row` elements; droppables are the `.backlog-table-body`
 *       and each `.sprint-table` CONTAINER (never a row) — sortable.coffee:39-48;
 *     - `previousUs` / `nextUs` neighbour semantics — sortable.coffee:50-63 and
 *       main.coffee:588-591 (`nextUs` is used ONLY to place at the very top);
 *     - the same-container no-op guard — sortable.coffee:120-121;
 *     - the `modify_us` + `archived_code` permission gate — sortable.coffee:30
 *       (encapsulated by `isBoardDraggable`);
 *     - multi-card drag restricted to the source container.
 *   `@dnd-kit`'s built-in auto-scroll replaces `dom-autoscroller`
 *   (sortable.coffee:145). The ONLY net-new behaviour is keyboard-accessible
 *   dragging + ARIA live announcements (`KeyboardSensor`), confined to React
 *   (AAP §0.6.5).
 *
 * SHAPE
 *   Single file co-exporting the `BacklogDndContext` component AND its pure,
 *   browser-free helpers (`computeBacklogMovePayload`, `computeNeighbors`,
 *   `resolveDraggedIds`, `isSamePosition`) so `../__tests__` can unit-test the
 *   payload mapping headlessly by importing them directly. The sibling
 *   presentational components register their OWN `@dnd-kit` hooks
 *   (`useDraggable` / `useDroppable`), so this file exports NO
 *   `Draggable*` / `Droppable*` wrapper primitives.
 */

import { useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, CollisionDetection } from '@dnd-kit/core';
import { isBoardDraggable } from '../../shared/permissions';
import type { Project, UserStory, Milestone } from '../../shared/types';

/* ========================================================================== *
 * Public types & exports (all named exports; no default export)
 * ========================================================================== */

/**
 * The source-faithful "move user story" payload emitted on drop. Mirrors the
 * argument shape of the AngularJS `ctrl.moveUs(...)` call
 * (`sortable.coffee:143` → `main.coffee:523`).
 */
export interface BacklogMovePayload {
  usList: UserStory[]; // full dragged user-story objects, in source-container order
  index: number; // insertion index within the target container (excluding dragged rows)
  sprint: number | null; // target sprint id; null = the backlog
  previousUs: number | null; // id of the row immediately BEFORE the drop position (null at top)
  nextUs: number | null; // id of the row immediately AFTER — set ONLY when previousUs is null
}

// Data shapes the sibling components attach to their draggables/droppables.
// Exported for cross-file type-sharing; components MAY import these.
export interface BacklogDraggableData {
  type: 'us';
  usId: number;
  fromSprintId: number | null; // null = backlog row; else the containing sprint id
}
export type BacklogDroppableData =
  | { type: 'backlog' }
  | { type: 'sprint'; sprintId: number };

export interface BacklogDndContextProps {
  project: Project;
  canModifyUs: boolean; // BacklogApp passes canModifyUs(project); also gated by isBoardDraggable below
  userstories: UserStory[]; // backlog-order user stories (the backlog container list)
  sprints: Milestone[]; // sprints rendered as droppable containers (each has user_stories in sprint_order)
  selectedUsIds?: number[]; // checked rows (for multi-card drag); may be undefined
  onMove: (payload: BacklogMovePayload) => void; // = state/useBacklog moveUs thunk (via BacklogApp)
  children: ReactNode;
}

/* ========================================================================== *
 * PURE HELPERS (browser-free: no DOM, no hooks) — unit-testable directly
 * ========================================================================== */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Neighbor computation faithful to sortable.coffee:50-63 + main.coffee:588-591.
 * previousUs = row immediately BEFORE the insertion index in the target list
 *   (dragged rows already excluded); null when dropped at the very top.
 * nextUs = row immediately AFTER, but set ONLY when previousUs is null
 *   (the source uses nextUs solely to place at the top; the position math
 *   otherwise ignores it — reproduce this exactly, do NOT "fix" it).
 */
export function computeNeighbors(
  destExcl: number[],
  index: number,
): { previousUs: number | null; nextUs: number | null } {
  const previousUs = index > 0 ? destExcl[index - 1] : null;
  const nextUs = previousUs == null ? destExcl[index] ?? null : null;
  return { previousUs, nextUs };
}

/**
 * PURE payload mapper (dragula parity). `overIndex` is the insertion index
 * within the target container measured AFTER excluding the dragged ids; it is
 * computed impurely from DOM rects in onDragEnd and passed in as a plain number.
 */
export function computeBacklogMovePayload(args: {
  usList: UserStory[];
  overContainer: { sprintId: number | null };
  orderedIds: number[];
  overIndex: number;
}): BacklogMovePayload {
  const draggedSet = new Set(args.usList.map((u) => u.id));
  const destExcl = args.orderedIds.filter((id) => !draggedSet.has(id));
  const index = clamp(args.overIndex, 0, destExcl.length);
  const { previousUs, nextUs } = computeNeighbors(destExcl, index);
  return {
    usList: args.usList,
    index,
    sprint: args.overContainer.sprintId,
    previousUs,
    nextUs,
  };
}

/**
 * Multi-card selection resolution. Multi-drag engages IFF the grabbed row is
 * itself selected AND more than one row is selected; the dragged ids are
 * ordered by the SOURCE container order (which naturally restricts the drag to
 * the source container — backlog multi-drag is inherently within-container).
 * Otherwise only the grabbed row drags.
 */
export function resolveDraggedIds(
  activeUsId: number,
  selectedUsIds: number[] | undefined,
  sourceOrderedIds: number[],
): number[] {
  const selected = selectedUsIds ?? [];
  const isMulti = selected.length > 1 && selected.includes(activeUsId);
  if (!isMulti) return [activeUsId];
  const selectedSet = new Set(selected);
  const ordered = sourceOrderedIds.filter((id) => selectedSet.has(id));
  return ordered.length > 0 ? ordered : [activeUsId];
}

/**
 * Same-container no-op detection (source guard: skip moveUs when the item is
 * dropped back at its original index). Compares the dragged block's ORIGINAL
 * index within destExcl against the proposed insertion index.
 */
export function isSamePosition(
  targetOrderedIds: number[],
  draggedIds: number[],
  index: number,
): boolean {
  const draggedSet = new Set(draggedIds);
  const firstPos = targetOrderedIds.indexOf(draggedIds[0]);
  if (firstPos === -1) return false;
  const oldIndex = targetOrderedIds
    .slice(0, firstPos)
    .filter((id) => !draggedSet.has(id)).length;
  return index === oldIndex;
}

/* ========================================================================== *
 * IMPURE DOM helper — module-private (NOT exported, NOT unit-tested)
 * ========================================================================== */

/**
 * Because `@dnd-kit` does NOT physically reorder the DOM during a drag (unlike
 * dragula — it uses transforms/overlays), reading post-drop DOM order would give
 * the OLD order. So compute the insertion index by comparing the dragged
 * element's translated rect center-Y against each candidate row's rect center-Y
 * (the backlog/sprint lists are vertical). Candidate rows are located via the
 * globally-unique `[data-id="..."]` attribute the sibling rows render.
 *
 * This `destExcl` is identical to the one `computeBacklogMovePayload`
 * recomputes (target ordered ids minus dragged ids == `orderedIds` minus
 * `usList` ids, since `usList` ids === `draggedIds`), so the index aligns.
 * `computeBacklogMovePayload` still clamps defensively.
 */
function computeOverIndex(
  targetOrderedIds: number[],
  draggedIds: number[],
  active: DragEndEvent['active'],
): number {
  const draggedSet = new Set(draggedIds);
  const destExcl = targetOrderedIds.filter((id) => !draggedSet.has(id));
  if (destExcl.length === 0) return 0;
  const translated = active.rect.current.translated;
  const draggedCenterY = translated
    ? translated.top + translated.height / 2
    : Number.POSITIVE_INFINITY;
  for (let i = 0; i < destExcl.length; i++) {
    const el = document.querySelector(`[data-id="${destExcl[i]}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const rowCenterY = rect.top + rect.height / 2;
    if (draggedCenterY < rowCenterY) return i;
  }
  return destExcl.length;
}

/* ========================================================================== *
 * Component — BacklogDndContext
 * ========================================================================== */

/**
 * Drag-and-drop provider for the Backlog / Sprint-planning screen.
 *
 * Receives board data (`userstories`, `sprints`) as props so that, on drop
 * (where `@dnd-kit`'s `active.data` carries only `{ usId, fromSprintId }` and
 * `over` is ALWAYS a container), it can look up the full `UserStory` objects by
 * id and build the ordered id list per container. The insertion index is
 * measured from live row rects (`computeOverIndex`) and mapped to the
 * source-faithful `BacklogMovePayload` by the pure helpers.
 */
export function BacklogDndContext(props: BacklogDndContextProps) {
  const { project, canModifyUs, userstories, sprints, selectedUsIds, onMove, children } = props;

  const [activeId, setActiveId] = useState<number | null>(null);
  const [draggedIds, setDraggedIds] = useState<number[]>([]);

  // id -> full UserStory across the backlog AND every sprint container.
  const usById = useMemo(() => {
    const m = new Map<number, UserStory>();
    for (const u of userstories) m.set(u.id, u);
    for (const s of sprints) for (const u of s.user_stories ?? []) m.set(u.id, u);
    return m;
  }, [userstories, sprints]);

  // ordered id list per container: null => backlog; else the sprint's list.
  const orderedIdsFor = useCallback(
    (sprintId: number | null): number[] => {
      if (sprintId == null) return userstories.map((u) => u.id);
      const s = sprints.find((sp) => sp.id === sprintId);
      return (s?.user_stories ?? []).map((u) => u.id);
    },
    [userstories, sprints],
  );

  // Sensors are ALWAYS constructed (hook-rules); pass [] to DndContext when the
  // board is read-only so no drag can start. PointerSensor distance:8 preserves
  // click-vs-drag; KeyboardSensor is the sole net-new (accessibility) behavior.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  // Permission/archived gate — source sortable.coffee:30 (modify_us && !archived_code).
  // isBoardDraggable already encapsulates modify_us + archived_code; also honor the
  // explicit canModifyUs prop passed by BacklogApp.
  const draggable = canModifyUs && isBoardDraggable(project);

  // Pointer-first collision (faithful to dragula pointer behavior); rectIntersection
  // fallback keeps keyboard dragging working when there is no pointer.
  const collisionDetection = useCallback<CollisionDetection>((collisionArgs) => {
    const pointerCollisions = pointerWithin(collisionArgs);
    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(collisionArgs);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as BacklogDraggableData | undefined;
      if (!data) return;
      const src = orderedIdsFor(data.fromSprintId);
      setActiveId(data.usId);
      setDraggedIds(resolveDraggedIds(data.usId, selectedUsIds, src));
    },
    [orderedIdsFor, selectedUsIds],
  );

  /*
   * Downstream mapping performed by state/useBacklog.moveUs (NOT this file);
   * documented for source fidelity (sortable.coffee:143 -> main.coffee:523-596):
   *
   *  PRIMARY (source-faithful): userstories.bulkUpdateBacklogOrder(
   *      projectId,
   *      currentSprintId = payload.sprint ?? oldSprintId,
   *      payload.previousUs,
   *      payload.nextUs,
   *      bulkUserstories = payload.usList.map(u => u.id)   // ARRAY OF US ID NUMBERS
   *  )
   *    - The milestone change is carried by THIS call's milestone_id; the drag
   *      moveUs does NOT separately call bulkUpdateMilestone (main.coffee:535-537).
   *    - Wire discrepancy: shared bulkUpdateBacklogOrder DECLARES
   *      bulkUserstories: BulkUserStoryOrder[]; passing number[] preserves the
   *      byte-for-byte wire format and may require a localized documented cast
   *      (as unknown as BulkUserStoryOrder[]) in the state thunk — flag for reviewer.
   *    - api.post returns the response BODY directly (React), so the thunk
   *      reconciles over `result`, not `result.data`.
   *
   *  OPTIONAL (per AAP 0.4.1/0.6.5): when a story is dropped INTO a different,
   *  truthy sprint, the thunk MAY ALSO issue
   *      milestones/userstories.bulkUpdateMilestone(projectId, payload.sprint,
   *          payload.usList.map(u => ({ us_id: u.id, order: u.sprint_order })))
   *  Keep bulkUpdateBacklogOrder-with-milestone_id as the source-faithful primary;
   *  recommend backend verification before enabling the secondary call.
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const dragged = draggedIds;
      setActiveId(null);
      setDraggedIds([]);
      if (!over) return; // dropped outside any container

      const activeData = active.data.current as BacklogDraggableData | undefined;
      const overData = over.data.current as BacklogDroppableData | undefined;
      if (!activeData || !overData) return;

      const targetSprintId = overData.type === 'sprint' ? overData.sprintId : null;
      const sourceSprintId = activeData.fromSprintId;

      // Fallback in case onDragStart state was lost.
      const finalDragged =
        dragged.length > 0
          ? dragged
          : resolveDraggedIds(activeData.usId, selectedUsIds, orderedIdsFor(sourceSprintId));

      const usList = finalDragged
        .map((id) => usById.get(id))
        .filter((u): u is UserStory => Boolean(u));
      if (usList.length === 0) return;

      const targetOrderedIds = orderedIdsFor(targetSprintId);
      const overIndex = computeOverIndex(targetOrderedIds, finalDragged, active);
      const payload = computeBacklogMovePayload({
        usList,
        overContainer: { sprintId: targetSprintId },
        orderedIds: targetOrderedIds,
        overIndex,
      });

      // No-op guard (source: skip when dropped back at the same position).
      const sameContainer = sourceSprintId === targetSprintId;
      if (sameContainer && isSamePosition(targetOrderedIds, finalDragged, payload.index)) return;

      onMove(payload);
    },
    [draggedIds, selectedUsIds, orderedIdsFor, usById, onMove],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDraggedIds([]);
  }, []);

  const activeUs = activeId != null ? usById.get(activeId) : undefined;

  // DragOverlay / transform contract: the sibling rows render statically (they
  // call setNodeRef + spread listeners/attributes to become grab handles but do
  // NOT apply the drag `transform`); this DragOverlay renders the moving
  // "mirror" — the @dnd-kit equivalent of dragula's `.gu-mirror`. The overlay
  // markup is intentionally minimal (ref + subject + a multi-count badge) and
  // reuses the existing `.row.us-item-row` classes plus a `tg-react-drag-overlay`
  // hook class so it stays decoupled from the row component.
  return (
    <DndContext
      sensors={draggable ? sensors : []}
      collisionDetection={collisionDetection}
      autoScroll={{ enabled: true }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay>
        {activeUs ? (
          <div className="row us-item-row tg-react-drag-overlay">
            <span className="us-item-ref">#{activeUs.ref}</span>
            <span className="us-item-subject">{activeUs.subject}</span>
            {draggedIds.length > 1 ? (
              <span className="tg-react-drag-count">{draggedIds.length}</span>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

