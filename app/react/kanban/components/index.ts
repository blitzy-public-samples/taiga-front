/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Barrel re-exports for the Kanban presentational components.
 *
 * Single public surface of the Kanban components folder: consumers such as the
 * KanbanApp root, the useKanbanBoard hook and the component unit tests import
 * every Kanban presentational component and its public types from this module.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. The file
 * contains no logic and no JSX; it is composed exclusively of re-exports of the
 * sibling modules in this folder, referenced only through relative paths.
 *
 * Under isolatedModules (see the TypeScript config) type-only re-exports use
 * the `export type { ... }` form so the transpiler can erase them safely, while
 * runtime values (component defaults and the WipLimit helper functions) are
 * re-exported with the value `export { ... }` form.
 */

export { default as Board } from './Board';
export type { BoardProps } from './Board';

export { default as Swimlane } from './Swimlane';
export type { SwimlaneProps, KanbanColumnContext } from './Swimlane';

export { default as Column } from './Column';
export type { ColumnProps } from './Column';

export { default as Card } from './Card';
export type { CardProps } from './Card';

export { default as WipLimit, computeWipLimit, editWipLimit } from './WipLimit';
export type { WipLimitProps, WipLimitState, WipLimitPlacement } from './WipLimit';

export { default as ZoomControl } from './ZoomControl';
export type { ZoomControlProps } from './ZoomControl';

export { default as FilterBar } from './FilterBar';
export type {
  FilterBarProps,
  FilterCategory,
  FilterCategoryOption,
  AppliedFilter,
  CustomFilter,
} from './FilterBar';
