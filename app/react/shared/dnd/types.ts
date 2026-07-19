/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared TypeScript types for the React `@dnd-kit` drag-and-drop layer.
 *
 * This is the FOUNDATIONAL, dependency-free module of `app/react/shared/dnd`.
 * The DnD layer is the React replacement for the legacy `dragula` drakes +
 * `dom-autoscroller` auto-scroll used by the AngularJS Kanban and Backlog
 * sortable directives:
 *   - Kanban:  kanban/sortable.coffee
 *   - Backlog: backlog/sortable.coffee
 *
 * On drop, the sibling `sortable.ts` handlers call the SAME frozen `/api/v1/`
 * bulk-ordering endpoints (through the `api/userstories` adapter), so
 * server-side ordering is byte-identical to the legacy client.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 - HARD): this module imports NOTHING from the
 * repository - not the legacy CoffeeScript sources, the modern Angular-Elements
 * bundle, the Jade partials, or the SCSS styles - and never references the
 * global AngularJS injector. It is intentionally self-contained: every shape
 * below is declared locally (no `@dnd-kit` import either), so the file emits no
 * runtime code except the `DND_CLASS` constant object.
 *
 * Each type documents the `dragula`/AngularJS concept it mirrors, with source
 * line references, so behavioral parity can be audited field-by-field.
 */

/* ------------------------------------------------------------------------- *
 * Section 1 - Primitive / utility types
 * ------------------------------------------------------------------------- */

/**
 * A user-story id. In the legacy DOM this is the `data-id` attribute on a
 * `tg-card` (Kanban) or a `.row` (Backlog) element, read as
 * `Number(el.dataset.id)` (kanban/sortable.coffee:103; backlog/sortable.coffee:59).
 */
export type UsId = number;

/**
 * The `bulk_userstories` wire payload for the frozen `/api/v1/` bulk-ordering
 * endpoints.
 *
 * IMPORTANT (correctness-critical): this is an ARRAY OF USER-STORY IDS
 * (`number[]`), NOT an array of `{ us_id, order }` objects. This mirrors the
 * legacy resource exactly:
 *   - kanban-usertories.coffee:184-190 `move()` returns `bulkUserstories: usList`,
 *     where `usList` is the id array iterated at kanban-usertories.coffee:171
 *     (`for usId, key in usList`).
 *   - `KanbanController.moveUs` / `BacklogCtrl.moveUs` pass `usList.map(it => it.id)`.
 *
 * The `api/userstories` adapter's bulk parameter MUST accept this exact shape at
 * runtime; sending `{ us_id, order }` objects is a common migration bug that
 * this type deliberately prevents.
 */
export type BulkUserstoryIds = UsId[];

/**
 * Selects sensor / auto-scroll behavior and the DOM selectors used by the DnD
 * primitives. The two migrated screens use different container/item selectors
 * and different auto-scroll tuning (see `AutoScrollConfig`).
 */
export type DndMode = 'kanban' | 'backlog';

/* ------------------------------------------------------------------------- *
 * Section 2 - Adjacent-id result (the "after-precedence" output)
 * ------------------------------------------------------------------------- */

/**
 * Result of scanning the dropped item's siblings, reproducing the `dragula`
 * `drop` handlers (kanban/sortable.coffee:95-107; backlog/sortable.coffee:50-63).
 *
 * AFTER-PRECEDENCE RULE (both screens): `previousId` is taken from the preceding
 * siblings (`prevAll('tg-card:not(.gu-transit)')` / `prevAll('.row:not(.gu-transit)')`);
 * `nextId` is populated ONLY when there is no previous sibling
 * (`if (!previous && next...)`). Therefore AT MOST ONE of the two is non-null:
 *   - dropped after an item        -> previousId set, nextId null
 *   - dropped at the top of a list -> previousId null, nextId set
 *   - dropped into an empty list   -> both null
 */
export interface AdjacentIds {
  /** From preceding siblings -> `after_userstory_id` (kanban) / `previousUs` (backlog). */
  previousId: UsId | null;
  /** From following siblings, only when no previous -> `before_userstory_id` (kanban) / `nextUs` (backlog). */
  nextId: UsId | null;
}

/* ------------------------------------------------------------------------- *
 * Section 3 - Kanban & Backlog drag-result payloads
 * ------------------------------------------------------------------------- */

/**
 * Geometry computed on Kanban drag end (kanban/sortable.coffee:109-153),
 * consumed by the Kanban move flow (kanban/main.coffee:596-627) which maps
 * `newSwimlane === -1` to `null` before calling `bulkUpdateKanbanOrder`.
 */
export interface KanbanDragResult {
  /** Moved ids: the multi-selection when non-empty, else `[activeId]` (window.dragMultiple; kanban/sortable.coffee:133-134). */
  movedIds: BulkUserstoryIds;
  /** `Number(parentEl.dataset.status)` - destination column status id (kanban/sortable.coffee:121). */
  newStatus: number;
  /** `Number(parentEl.dataset.swimlane)` (kanban/sortable.coffee:122); the API maps `-1 -> null` (kanban/main.coffee:604-606). */
  newSwimlane: number | null;
  /** Position of the moved item among destination `tg-card`s: `$(parentEl).find('tg-card').index(firstElement)` (kanban/sortable.coffee:120). */
  index: number;
  /** `previousCard` -> `after_userstory_id` (kanban/sortable.coffee:102-103). */
  afterUserstoryId: UsId | null;
  /** `nextCard` -> `before_userstory_id` (kanban/sortable.coffee:106-107). */
  beforeUserstoryId: UsId | null;
}

/**
 * Geometry computed on Backlog drag end (backlog/sortable.coffee:94-143),
 * consumed by `BacklogCtrl.moveUs` (backlog/main.coffee:523-607) which calls
 * `bulkUpdateBacklogOrder(project, currentSprintId, previousUs, nextUs, bulkUserstories)`.
 */
export interface BacklogDragResult {
  /** Moved ids: the multi-selection when non-empty, else `[activeId]` (backlog/sortable.coffee:124-140). */
  movedIds: BulkUserstoryIds;
  /** Destination sprint id (`parent.scope()?.sprint.id`; backlog/sortable.coffee:118); `null` when dropped in the backlog list. */
  targetSprintId: number | null;
  /** Position within `.backlog-table-body .row` (backlog) or within the sprint list (backlog/sortable.coffee:114-117). */
  index: number;
  /** `previousUs` -> preceding `.row` id (backlog/sortable.coffee:58-59). */
  previousUs: UsId | null;
  /** `nextUs` -> following `.row` id, only when no previous (backlog/sortable.coffee:62-63). */
  nextUs: UsId | null;
  /** True when the destination is the backlog body / `.js-empty-backlog` (backlog/sortable.coffee:99). */
  isBacklog: boolean;
}

/* ------------------------------------------------------------------------- *
 * Section 4 - Auto-scroll configuration
 * ------------------------------------------------------------------------- */

/**
 * Mirrors the `dom-autoscroller` options used by the AngularJS sortables:
 *   - kanban:  `autoScroll(containers, { margin: 100, scrollWhenOutside: true })`
 *     (kanban/sortable.coffee:155-160)
 *   - backlog: `autoScroll([window], { margin: 20, pixels: 30, scrollWhenOutside: true })`
 *     (backlog/sortable.coffee:145-151)
 * The React auto-scroll helper (`autoScroll.ts`) reproduces this behavior with
 * `@dnd-kit` sensors/modifiers; `pixels` is optional (the kanban config omits it).
 */
export interface AutoScrollConfig {
  /** Distance from the container edge that triggers scrolling (px). */
  margin: number;
  /** Fixed scroll step per tick (px); omitted by the kanban config. */
  pixels?: number;
  /** Keep scrolling while the pointer is dragged outside the container. */
  scrollWhenOutside: boolean;
}

/* ------------------------------------------------------------------------- *
 * Section 5 - Handler-factory dependency & callback types
 * ------------------------------------------------------------------------- *
 * These shapes let `sortable.ts` own DnD geometry + the API call while the
 * optimistic state updates stay in the immer reducers under the `kanban` and
 * `backlog` feature folders.
 */

/**
 * Provides the current multi-selection, the React equivalent of
 * `window.dragMultiple.getElements()` (elements carrying the
 * `ui-multisortable-multiple` class). Returns `[]` for a single-item drag.
 */
export type GetSelectedIds = () => UsId[];

/** Consumer callback: apply the optimistic immer state update in the `kanban` feature. */
export type OnKanbanMove = (result: KanbanDragResult) => void;

/** Consumer callback: apply the optimistic immer state update in the `backlog` feature. */
export type OnBacklogMove = (result: BacklogDragResult) => void;

/**
 * Consumer callback fired when the Backlog drag WRITE fails - i.e.
 * `bulkUpdateBacklogOrder` rejects (4xx/5xx/offline). It lets the `backlog`
 * feature ROLL BACK the optimistic `onMove` update and surface a save-failure
 * notification, reproducing the Kanban rollback parity (useKanbanBoard.moveUs
 * "F-WRITE-2") on the Backlog drag path (QA BL-1). The rejected `result` is the
 * exact object previously passed to `onMove`, so the consumer can correlate the
 * failure with the optimistic change it must undo.
 */
export type OnBacklogMoveError = (err: unknown, result: BacklogDragResult) => void;

/** Dependencies injected into the Kanban drag-end handler factory in `sortable.ts`. */
export interface KanbanDragEndDeps {
  /** Current project id (route param), forwarded to the bulk-ordering endpoint. */
  projectId: number;
  /** Multi-selection provider; omit (or return `[]`) for a single-card drag. */
  getSelectedIds?: GetSelectedIds;
  /** Optimistic state update applied in the `kanban` feature. */
  onMove: OnKanbanMove;
  /** Optional API override for tests; defaults to the real `api/userstories` adapter in `sortable.ts`. */
  api?: KanbanOrderApi;
}

/** Dependencies injected into the Backlog drag-end handler factory in `sortable.ts`. */
export interface BacklogDragEndDeps {
  /** Current project id (route param), forwarded to the bulk-ordering endpoint. */
  projectId: number;
  /** Multi-selection provider; omit (or return `[]`) for a single-row drag. */
  getSelectedIds?: GetSelectedIds;
  /** Optimistic state update applied in the `backlog` feature. */
  onMove: OnBacklogMove;
  /**
   * Optional failure callback (QA BL-1): invoked if `bulkUpdateBacklogOrder`
   * rejects, so the consumer can roll back the optimistic `onMove` update and
   * surface a save-failure notification (matching the Kanban drag path). When
   * omitted, a failed write is swallowed (the pre-existing behavior) rather than
   * escaping as an unhandled promise rejection.
   */
  onMoveError?: OnBacklogMoveError;
  /** Optional API override for tests; defaults to the real `api/userstories` adapter in `sortable.ts`. */
  api?: BacklogOrderApi;
}

/**
 * Minimal STRUCTURAL type of the `api/userstories` adapter function this layer
 * calls on a Kanban drop. Declared here (NOT imported) so that:
 *   1. this foundational file stays fully dependency-free, and
 *   2. tests can pass a fake that satisfies this shape.
 * The REAL adapter is imported by `sortable.ts`, never here.
 *
 * NOTE: `bulkUserstories` is `BulkUserstoryIds` (`number[]`) at runtime - see
 * Section 1. Mirrors the `/userstories/bulk_update_kanban_order` endpoint
 * (resources.coffee:112).
 */
export interface KanbanOrderApi {
  bulkUpdateKanbanOrder(
    projectId: number,
    statusId: number,
    swimlaneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: BulkUserstoryIds,
  ): Promise<unknown>;
}

/**
 * Minimal STRUCTURAL type of the `api/userstories` adapter functions this layer
 * calls on a Backlog drop. Declared here (NOT imported) for the same reasons as
 * `KanbanOrderApi`; the real adapter is imported by `sortable.ts`.
 *
 * NOTE: `bulkUserstories` is `BulkUserstoryIds` (`number[]`) at runtime - see Section 1.
 */
export interface BacklogOrderApi {
  /**
   * Mirrors `/userstories/bulk_update_backlog_order` (resources.coffee:109);
   * `milestoneId` is the target sprint id, or `null` for the backlog list.
   */
  bulkUpdateBacklogOrder(
    projectId: number,
    milestoneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: BulkUserstoryIds,
  ): Promise<unknown>;
  /**
   * Present for completeness; the drag flow uses `bulkUpdateBacklogOrder`.
   * `bulkUpdateMilestone` mirrors the toolbar "move to sprint" action
   * (`/userstories/bulk_update_milestone`, resources.coffee:110; backlog/main.coffee:779-813).
   */
  bulkUpdateMilestone?(
    projectId: number,
    milestoneId: number,
    bulkStories: BulkUserstoryIds,
  ): Promise<unknown>;
}

/* ------------------------------------------------------------------------- *
 * Section 6 - CSS class-name constants (visual-parity contract)
 * ------------------------------------------------------------------------- *
 * The DnD primitives must apply these exact class names so the EXISTING
 * compiled SCSS renders the React screens unchanged. Centralizing them here
 * prevents typos across sensors.ts / autoScroll.ts / sortable.ts / DndProvider.tsx.
 * Values verified against kanban-table.scss, backlog-table.scss, and base.scss.
 */
export const DND_CLASS = {
  /** In-place placeholder of the dragged item (backlog-table.scss:330; kanban `:not(.gu-transit)` selectors). */
  transit: 'gu-transit',
  /** Multi-drag transit placeholder (kanban-table.scss:359). */
  transitMulti: 'gu-transit-multi',
  /** Applied to a hovered DIFFERENT container (kanban/sortable.coffee:69; kanban-table.scss:247). */
  targetDrop: 'target-drop',
  /** Drag mirror / overlay clone (kanban/sortable.coffee:90; backlog/sortable.coffee:92; backlog-table.scss:295). */
  mirror: 'multiple-drag-mirror',
  /** Multi-selection marker read by window.dragMultiple (kanban-table.jade ng-class). */
  selected: 'ui-multisortable-multiple',
  /** Post-move animation on the moved card (kanban-table.scss:310). */
  moved: 'kanban-moved',
  /** Destination column "landed from elsewhere" animation (kanban/sortable.coffee:128; kanban-table.scss:241). */
  newColumn: 'new',
  /** Added to `document.body` during a backlog drag (backlog/sortable.coffee:73,108; base.scss:36). */
  dragActive: 'drag-active',
} as const;

/** Union of the drag-state class-name string literals in `DND_CLASS`. */
export type DndClassName = (typeof DND_CLASS)[keyof typeof DND_CLASS];
