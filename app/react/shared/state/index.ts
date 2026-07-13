/*
 * Copyright (c) 2021-present Kaleidos INC
 *
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Public barrel for the shared React state module (immer producers +
 * projection/order helpers) used by the Kanban and Backlog hooks.
 */

// This file is a pure re-export barrel: it has NO runtime side effects, NO
// default export, and imports nothing at value-execution time beyond the two
// sibling state modules it aggregates. Consumers import the whole public
// surface of `shared/state` from here (e.g. `import { move, enqueueDrag } from
// "../shared/state"`), and the co-located tests exercise the SUT through this
// entry point.
//
// `isolatedModules` is enabled in the root tsconfig, so VALUE re-exports
// (functions / consts) and TYPE re-exports (interfaces / type aliases) MUST be
// emitted as SEPARATE statements per source module — a bare `export { SomeType }`
// for a type-only symbol would fail with TS1205. Explicit named lists (never
// `export *`) keep the public surface intentional and tree-shakeable.

/* -------------------------------------------------------------------------- */
/* Kanban board state (mirrors kanban-usertories.coffee via ./kanbanState).   */
/* -------------------------------------------------------------------------- */

// Value exports: immer producers, selectors, and the synthetic-swimlane consts.
export {
  createInitialKanbanState,
  reset,
  init,
  set,
  assignOrders,
  add,
  remove,
  replaceModel,
  replace,
  move,
  moveToEnd,
  restoreStories,
  toggleFold,
  resetFolds,
  addArchivedStatus,
  hideStatus,
  showStatus,
  getUs,
  getUsModel,
  isUsInArchivedHiddenStatus,
  UNCLASSIFIED_SWIMLANE_ID,
  UNCLASSIFIED_SWIMLANE_NAME,
} from "./kanbanState";

// Type-only exports (erased at compile time; must use `export type`).
export type { KanbanState, KanbanMoveResult, StoryPositionDelta } from "./kanbanState";

/* -------------------------------------------------------------------------- */
/* Backlog / Sprint-Planning state (mirrors backlog/main.coffee via           */
/* ./backlogState).                                                           */
/* -------------------------------------------------------------------------- */

// Value exports: state builders/setters, order-map + API-payload builders,
// pendingDrag queue helpers, optimistic-move / reconciliation producers, and
// the move-metadata helper.
export {
  createInitialBacklogState,
  buildBacklogOrder,
  buildMilestonesOrder,
  prepareBulkUpdateData,
  buildBacklogOrderPayload,
  buildMilestonePayload,
  enqueueDrag,
  shiftDrag,
    clearDragQueue,
  hasPendingDrag,
  shouldCoalesceDrag,
  peekDrag,
  applyOptimisticMove,
  reconcileMovedStory,
  captureBacklogPositions,
  restoreBacklogStories,
    reinsertBacklogStory,
  setUserstories,
  setSprints,
  setClosedSprints,
  moveMetadata,
} from "./backlogState";

// Type-only exports (erased at compile time; must use `export type`).
export type {
  BacklogState,
  PendingDragItem,
  BacklogOrderPayload,
  MilestonePayload,
  BulkOrderEntry,
  BacklogPositionDelta,
} from "./backlogState";
