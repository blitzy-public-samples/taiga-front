/**
 * FilterBar — re-export shim.
 *
 * The filter sidebar (`tg-filter`) is shared VERBATIM by BOTH migrated screens
 * (Kanban and Backlog), so the implementation was relocated to the cross-cutting
 * `app/react/shared/components/FilterBar.tsx` (AAP 0.3.1 designates `shared/` for
 * concerns used by more than one feature). This shim preserves the original
 * `kanban/components/FilterBar` import path so every existing Kanban import,
 * barrel re-export, and unit test resolves UNCHANGED (zero blast radius on the
 * Kanban side), while the Backlog screen imports the same component from
 * `../shared/components/FilterBar`.
 *
 * NOTE: this file intentionally contains no logic — it is a pure re-export.
 */
export { default } from '../../shared/components/FilterBar';
export type {
  FilterBarProps,
  FilterCategory,
  FilterCategoryOption,
  AppliedFilter,
  CustomFilter,
} from '../../shared/components/FilterBar';
