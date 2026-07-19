/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogApp
 * ----------
 * React container replacing the AngularJS 1.5.10 `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee`, 1-1386) at the ROUTE level, part of
 * the AngularJS -> React 18 coexistence migration (Blitzy AAP 0.1-0.4).
 *
 * It reproduces the `app/partials/backlog/backlog.jade` DOM skeleton with
 * BYTE-IDENTICAL CSS class names so the existing compiled SCSS renders it
 * unchanged (ZERO visual change), and wires together the effectful data layer
 * (`./hooks/useBacklog`, which owns loading + the WebSocket subscriptions and
 * drives the pure immer `./state/backlogReducer`), the drag-and-drop context
 * (`../shared/dnd`), and the presentational children (`./components/*`).
 *
 * COEXISTENCE: this component is mounted by `app/react/elements/TgReactBacklog.ts`
 * inside the AngularJS `<tg-react-backlog>` host element; the AngularJS route
 * template `backlog.jade` hosts that custom element instead of the legacy
 * controller. ALL cross-framework interop flows through globals
 * (`window.taigaConfig`, `localStorage` `token`, `window.taiga.sessionId`) and
 * the frozen `/api/v1/` REST + WebSocket contract, entirely inside `../shared/*`.
 *
 * ORCHESTRATOR ROLE (AAP 0.7 minimal-change / isolation): this file is thin and
 * declarative. It owns NO low-level rendering (pushed into `./components/*`), NO
 * state transitions (owned by the immer reducer), and NO data loading or API
 * calls (owned by `useBacklog` + `../shared/dnd/sortable`). It dispatches through
 * the hook's stable `actions` surface and renders `state`.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 - HARD RULES): imports NOTHING from `app/coffee`,
 * `app/modules`, `app/partials`, `app/styles`, or `elements.js`, and never
 * references `angular` / `dragula` / `dom-autoscroller` / `immutable` /
 * `checksley` / `jquery`. In-repo imports are limited to `./hooks/*`,
 * `./state/*`, `./components/*`, and `../shared/*` (the latter includes the
 * cross-feature `../shared/components/FilterBar`, shared verbatim with Kanban).
 *
 * TWO DISTINCT BULK PATHS (must NOT be conflated - AAP 0.6):
 *   - DRAG reorder  -> `bulkUpdateBacklogOrder(number[])`, owned by the drag-end
 *     handler in `../shared/dnd/sortable` (NOT called here).
 *   - TOOLBAR move  -> `bulkUpdateMilestone([{us_id, order}])`, owned by the
 *     hook's `moveToCurrentSprint` / `moveToLatestSprint` actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DetailedHTMLProps, HTMLAttributes } from 'react';

// The effectful data layer (data + WebSocket + optimistic move flows). Returns
// `{ state, actions }`; the presentational layer renders `state` and calls
// `actions`. Auto-loads on mount, so this container never triggers initial load.
import {
  useBacklog,
  VALID_QUERY_PARAMS,
  backlogFiltersStorageKey,
} from './hooks/useBacklog';
// Reducer model TYPES are type-only imports (isolatedModules): `Sprint` /
// `UserStory` type the URL builders + sprint handlers, `SprintFormValues` types
// the serialized-form -> hook mapping. `./state/*` is an allowed boundary import.
import type { Sprint, UserStory, SprintFormValues } from './state/backlogReducer';
// `selectLastSprint` (VALUE import) resolves the latest-finishing OPEN sprint so
// the create-sprint form can default its start date to that sprint's finish
// (finding #14 — reproduces `getLastSprint`, lightboxes.coffee:120-127).
import { selectLastSprint } from './state/backlogReducer';
// Presentational children (each owns its own DOM sub-tree + `SortableContext`).
import { BacklogTable } from './components/BacklogTable';
// Inline row-control reference-data TYPES (finding #12). `RowStatusOption` types
// the per-row status dropdown option list; the estimation types shape the
// per-role points editor + the header "view points per Role" popover. Type-only
// imports (isolatedModules); the values are computed here from `state.project`.
import type { RowStatusOption } from './components/UserStoryRow';
import type { EstimationPoint, EstimationRole } from '../shared/estimation';
import { SprintList } from './components/SprintList';
import { SprintForm } from './components/SprintForm';
import { ProgressBar } from './components/ProgressBar';
// Burndown chart (finding #1): a pure inline-SVG port of the AngularJS Flot
// burndown directive (`tgBurndownBacklogGraph`, main.coffee:1217-1338), bound to
// `state.stats.milestones`. No charting dependency is introduced.
import { Burndown } from './components/Burndown';
// Shared filter sidebar (`tg-filter`), used VERBATIM by both migrated screens
// (relocated to `../shared/components` — AAP 0.3.1 shared/ for cross-feature UI),
// and the shared `filters_data` -> categories transform. BL-11.
import FilterBar, {
  type AppliedFilter,
  type CustomFilter,
  type FilterCategory,
  type FilterCategoryOption,
} from '../shared/components/FilterBar';
import { buildFilterCategories } from '../shared/filters';
import {
  reconcileAppliedFilterNames,
  writeFiltersToLocation,
  type RestoredAppliedFilter,
} from '../shared/filterUrl';
// Drag context (supplies ONLY the `DndContext`; NOT a `SortableContext`).
import { DndProvider } from '../shared/dnd/DndProvider';
// Factory for the backlog drag-end handler; owns `bulkUpdateBacklogOrder` + the
// optimistic `onMove`. The `../shared/api/userstories` adapter it calls is its
// internal default, so this container deliberately does NOT import that adapter
// (importing an unused symbol would violate strict/lint rules).
import { createBacklogDragEndHandler } from '../shared/dnd/sortable';

/* ------------------------------------------------------------------ *
 * JSX intrinsic augmentation
 * ------------------------------------------------------------------ */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      /**
       * The AngularJS `sidebar.sidebar` host is a NON-STANDARD element used
       * app-wide (task-detail.jade, us-detail.jade, epic-detail.jade, ...) and
       * by `backlog.jade:193`. It is declared here so strict TSX accepts the
       * tag while its EXACT name is preserved for CSS parity: the `.scrum` CSS
       * grid (`app/styles/layout/backlog.scss`) places `<sidebar>` in its second
       * column, so the tag must not be substituted with a `<div>`.
       */
      sidebar: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/**
 * localStorage key for the burndown collapse flag (finding #1). The legacy
 * `ToggleBurndownVisibility` directive persisted this under a hash of
 * `"is-burndown-grpahs-collapsed"` (typo present in the AngularJS source,
 * main.coffee:1183); the literal is preserved so the persisted preference is
 * key-compatible across the coexistence boundary.
 */
const BURNDOWN_COLLAPSE_KEY = 'is-burndown-grpahs-collapsed';

/**
 * Persist a JSON value to `localStorage`, swallowing quota/private-mode errors.
 * Used ONLY for the documented backlog filter UI-preference persistence (the
 * `localStorage` half of the legacy "persist to both storage and the URL"
 * behaviour; the URL half is handled by `writeFiltersToLocation`).
 */
function writeStored(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* UI-preference persistence only -- safe to ignore storage failures. */
  }
}

/**
 * Renders a Taiga sprite icon, reproducing the rendered output of the AngularJS
 * `tgSvg` directive (`tg-svg(svg-icon="...")`). This matches the sibling
 * `SprintList` / `SprintForm` convention EXACTLY (an `<svg class="icon ...">`
 * with a `<use>` referencing the sprite) so the icon-sprite SCSS applies
 * unchanged; `xlinkHref` covers SVG 1.1 while the extra `href` covers SVG 2 /
 * Firefox (the Playwright engine used for the committed evidence).
 */
function Svg({ icon }: { icon: string }) {
  return (
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as Record<string, unknown>)} />
    </svg>
  );
}

/** A minimal shape for the project's user-story statuses lookup. */
interface UsStatusLike {
  id?: number;
  name?: string;
  color?: string;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Props for {@link BacklogApp}. Supplied by the `TgReactBacklog` custom-element
 * wrapper, which reads them from the preserved AngularJS route + globals.
 */
export interface BacklogAppProps {
  /**
   * Project slug from the preserved route `/project/:pslug/backlog`
   * (app.coffee:226). `useBacklog` resolves it to the project (id, permissions,
   * points, statuses, roles) via `GET projects/by_slug` when no `projectId` is
   * supplied.
   */
  projectSlug: string;
  /**
   * Optional pre-resolved numeric project id. When present the hook skips the
   * by-slug lookup.
   */
  projectId?: number;
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

/**
 * The Backlog / sprint-planning screen container. See the module doc comment for
 * the full source mapping and the orchestrator contract.
 */
export function BacklogApp({ projectSlug, projectId }: BacklogAppProps) {
  // Data + effects live in the hook; it returns { state, actions, filtersData }
  // and auto-loads the project, stats, sprints, first user-story page, and the
  // filter sidebar data on mount (reproduces BacklogController.loadInitialData/
  // loadBacklog, main.coffee:410-415).
  const { state, actions, filtersData, writeError } = useBacklog({ projectSlug, projectId });

  /* ------------------------- derived: permissions ------------------------- */

  // Per-project permission list (`project.my_permissions`). The resolved project
  // carries the same permission codes the AngularJS `tg-check-permission`
  // directive gated on (`add_us`, `modify_us`, `add_milestone`,
  // `view_milestones`, `modify_milestone`, `delete_milestone`).
  const permissions = useMemo<string[]>(() => {
    const raw = state.project?.['my_permissions'];
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [state.project]);
  const can = useCallback((code: string): boolean => permissions.includes(code), [permissions]);

  /* ------------------------- derived: URL builders ------------------------- */

  // Prefer the resolved project's slug (authoritative) and fall back to the route
  // slug prop before the project has loaded.
  const resolvedSlug = useMemo<string>(() => {
    const slug = state.project?.['slug'];
    return typeof slug === 'string' && slug.length > 0 ? slug : projectSlug;
  }, [state.project, projectSlug]);

  // US detail URL (reproduces the AngularJS `tg-nav` target for a backlog row):
  // `/project/{slug}/us/{ref}`.
  const buildUserStoryUrl = useCallback(
    (us: UserStory): string => `/project/${resolvedSlug}/us/${us.ref}`,
    [resolvedSlug],
  );

  // Taskboard URL for a sprint (reproduces the sprint header taskboard link):
  // `/project/{slug}/taskboard/{sprint.slug}`.
  const buildTaskboardUrl = useCallback(
    (sprint: Sprint): string => {
      const slug = sprint['slug'];
      const sprintRef = typeof slug === 'string' && slug.length > 0 ? slug : String(sprint.id);
      return `/project/${resolvedSlug}/taskboard/${sprintRef}`;
    },
    [resolvedSlug],
  );

  /* ------------------------- derived: status lookup ------------------------- */

  // Map us_status id -> { name, color } from the resolved project so backlog rows
  // can display their status name/color (reproduces the status widget binding).
  const statusById = useMemo<Record<number, { name: string; color?: string }>>(() => {
    const map: Record<number, { name: string; color?: string }> = {};
    const list = state.project?.['us_statuses'];
    if (Array.isArray(list)) {
      for (const raw of list as UsStatusLike[]) {
        if (typeof raw.id === 'number') {
          map[raw.id] = {
            name: typeof raw.name === 'string' ? raw.name : '',
            color: typeof raw.color === 'string' ? raw.color : undefined,
          };
        }
      }
    }
    return map;
  }, [state.project]);

  const getStatusName = useCallback(
    (us: UserStory): string => {
      const sid = us.status;
      return sid != null && statusById[sid] ? statusById[sid].name : '';
    },
    [statusById],
  );
  const getStatusColor = useCallback(
    (us: UserStory): string | undefined => {
      const sid = us.status;
      return sid != null && statusById[sid] ? statusById[sid].color : undefined;
    },
    [statusById],
  );
  const getPointsLabel = useCallback(
    (us: UserStory): string => (typeof us.total_points === 'number' ? String(us.total_points) : ''),
    [],
  );

  /* ---------------- derived: inline row-control reference data (finding #12) ---------------- */

  // The three per-row control lists are derived from the resolved project payload
  // (the SAME project the AngularJS `tg-us-status` / `tg-backlog-us-points` /
  // `tg-us-role-points-selector` directives read from `$scope.project`). They are
  // passed to `BacklogTable` -> `UserStoryRow`, which only renders the inline
  // popovers when these lists are supplied (so the presentational tests that omit
  // them keep exercising the inert baseline). BL-12.

  // Ordered user-story statuses -> each row's inline status dropdown
  // (reproduces the `popover-us-status.jade` option list; the project returns the
  // statuses already in their configured order).
  const statuses = useMemo<RowStatusOption[]>(() => {
    const list = state.project?.['us_statuses'];
    if (!Array.isArray(list)) {
      return [];
    }
    const out: RowStatusOption[] = [];
    for (const raw of list as UsStatusLike[]) {
      if (typeof raw.id === 'number') {
        out.push({
          id: raw.id,
          name: typeof raw.name === 'string' ? raw.name : '',
          color: typeof raw.color === 'string' ? raw.color : undefined,
        });
      }
    }
    return out;
  }, [state.project]);

  // Estimation points -> each row's inline per-role points editor
  // (reproduces `us-estimation-points.jade`; a `value === null` entry is the "?"
  // point that clears an estimate). `calculateTotalPoints` treats `null` as
  // "unestimated" (estimation.coffee), so preserve `null` rather than coercing.
  const points = useMemo<EstimationPoint[]>(() => {
    const list = state.project?.['points'];
    if (!Array.isArray(list)) {
      return [];
    }
    const out: EstimationPoint[] = [];
    for (const raw of list as Array<Record<string, unknown>>) {
      if (typeof raw.id === 'number') {
        out.push({
          id: raw.id,
          name: typeof raw.name === 'string' ? raw.name : '',
          value: typeof raw.value === 'number' ? raw.value : null,
        });
      }
    }
    return out;
  }, [state.project]);

  // Project roles -> each row's points editor + the header "view points per Role"
  // popover. Only `computable` roles participate in estimation
  // (estimation.coffee:182 filters on `computable`); the flag is preserved so the
  // row/header can filter identically.
  const roles = useMemo<EstimationRole[]>(() => {
    const list = state.project?.['roles'];
    if (!Array.isArray(list)) {
      return [];
    }
    const out: EstimationRole[] = [];
    for (const raw of list as Array<Record<string, unknown>>) {
      if (typeof raw.id === 'number') {
        out.push({
          id: raw.id,
          name: typeof raw.name === 'string' ? raw.name : '',
          computable: raw.computable === true,
        });
      }
    }
    return out;
  }, [state.project]);

  /* ------------------------- derived: selection bridge ------------------------- */

  // BacklogTable consumes a ReadonlySet<number>; the reducer stores selectedIds as
  // number[]. Bridge both directions so the multi-select checkbox toggles and the
  // move-to-sprint toolbar / drag `getSelectedIds` all read the same source.
  const selectedIdsSet = useMemo<ReadonlySet<number>>(
    () => new Set(state.selectedIds),
    [state.selectedIds],
  );
  const handleSelectionChange = useCallback(
    (next: ReadonlySet<number>): void => {
      actions.setSelectedIds(Array.from(next));
    },
    [actions],
  );

  /* ------------------------------- DnD wiring ------------------------------- */

  // Backlog drag-end handler (reproduces backlog/sortable.coffee:39,95-118). The
  // handler owns `userstories.bulkUpdateBacklogOrder(number[])` internally; here
  // we only supply the optimistic `onMove` (an immer reorder dispatched via the
  // reducer's APPLY_DRAG action) and the current multi-selection. Rebuilt only
  // when the project id or selection changes.
  const onDragEnd = useMemo(
    () =>
      createBacklogDragEndHandler({
        projectId: state.project?.id ?? 0,
        getSelectedIds: () => state.selectedIds,
        onMove: (result) => actions.applyDrag(result),
        // BL-1 rollback: on a rejected bulk-order write, undo the optimistic
        // reorder (restore the pre-move snapshot) and surface the "changes were
        // not saved" alert.
        onMoveError: (err) => actions.onDragError(err),
      }),
    [state.project?.id, state.selectedIds, actions],
  );

  /* --------------------- toolbar "move to sprint" (bulk) --------------------- */

  // DISTINCT from the drag path: routes selected stories through the hook's
  // move actions, which POST `bulkUpdateMilestone([{us_id, order}])`
  // (reproduces moveUssToSprint, main.coffee:779-813 + the #move-to-*-sprint
  // click handlers, main.coffee:862-870).
  const handleMoveToCurrentSprint = useCallback((): void => {
    void actions.moveToCurrentSprint(state.selectedIds);
  }, [actions, state.selectedIds]);
  const handleMoveToLatestSprint = useCallback((): void => {
    void actions.moveToLatestSprint(state.selectedIds);
  }, [actions, state.selectedIds]);

  // The `.move-to-sprint` toolbar is shown (display:flex) only when at least one
  // story is selected AND at least one sprint exists; otherwise hidden
  // (reproduces checkSelected, main.coffee:828-831, which toggled the inline
  // `display` via `.css('display','flex')` / `.hide()`).
  const moveToSprintDisplay: 'flex' | 'none' =
    state.selectedIds.length > 0 && state.sprints.length > 0 ? 'flex' : 'none';

  /* ---------------------- filters / search / show-tags ---------------------- */

  // #show-filters-button toggles the sidebar filter (reproduces showHideFilter,
  // main.coffee:917-925): flips `activeFilters`; the `.active` class on the button
  // and on `#backlog-filter` + the presence of `#backlog-filter` follow the flag.
  const handleToggleFilters = useCallback((): void => {
    actions.toggleActiveFilters();
  }, [actions]);

  // Debounced free-text search bound to the `q` filter (reproduces
  // tg-input-search `change="ctrl.changeQ(q)"` -> filterQ -> loadUserstories(true),
  // main.coffee:341-408). Local state keeps the field responsive; the debounced
  // dispatch resets pagination inside the hook's setFilter.
  const [queryInput, setQueryInput] = useState<string>(() => state.filters.query ?? '');
  const queryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setQueryInput(value);
      if (queryDebounceRef.current != null) {
        clearTimeout(queryDebounceRef.current);
      }
      queryDebounceRef.current = setTimeout(() => {
        actions.setFilter({ query: value });
      }, 200);
    },
    [actions],
  );
  useEffect(
    () => () => {
      if (queryDebounceRef.current != null) {
        clearTimeout(queryDebounceRef.current);
      }
    },
    [],
  );

  /* ----------------------------- filter sidebar (BL-11) ----------------------------- */

  // Build the sidebar categories from the server `filters_data` (all categories,
  // real per-option counts, Unassigned / Not-in-an-epic pseudo-options, tags
  // hidden when unused). Backlog shows EVERY category, so `excludeFilters` is
  // empty (unlike Kanban, which hides `status`). Empty until the fetch resolves.
  const filterCategories = useMemo<FilterCategory[]>(
    () => (filtersData ? buildFilterCategories(filtersData, []) : []),
    [filtersData],
  );

  // The reducer stores the applied and saved filters as `unknown[]`; narrow them
  // to the FilterBar contract. These are the single source of truth for the
  // sidebar's selected chips + saved custom filters (`state.filters.selected` /
  // `state.filters.custom`).
  // Reconcile any chips that were restored from the URL with placeholder (id)
  // names against the resolved categories, so a bookmarked/reloaded filter shows
  // its proper label once `filters_data` arrives (reproduces the legacy
  // `formatSelectedFilters` id->chip resolution). This is display-only: the
  // reducer keeps the raw `selected` (which serializes identically by id), so it
  // triggers NO re-query. `reconcileAppliedFilterNames` returns the same
  // reference once every label is resolved, keeping the memo stable.
  const selectedFilters = useMemo<AppliedFilter[]>(
    () =>
      reconcileAppliedFilterNames(
        ((state.filters.selected as AppliedFilter[]) ?? []) as RestoredAppliedFilter[],
        filterCategories,
      ) as AppliedFilter[],
    [state.filters.selected, filterCategories],
  );
  const customFilters = useMemo<CustomFilter[]>(
    () => (state.filters.custom as CustomFilter[]) ?? [],
    [state.filters.custom],
  );

  // Persist the applied filters + free-text query to BOTH the URL query string
  // (shareable / bookmarkable) AND per-project `localStorage` (survives reload),
  // reproducing the legacy behaviour where `FiltersMixin` wrote `$location.search()`
  // and mirrored it to storage. The URL write uses `history.replaceState` (no
  // AngularJS route reload) -- see `writeFiltersToLocation`. Driven by the raw
  // reducer `selected` (not the reconciled memo) so it stays byte-stable.
  useEffect(() => {
    const rawSelected = (state.filters.selected as RestoredAppliedFilter[]) ?? [];
    writeFiltersToLocation(rawSelected, VALID_QUERY_PARAMS, state.filters.query);
    writeStored(backlogFiltersStorageKey(resolvedSlug), rawSelected);
  }, [state.filters.selected, state.filters.query, resolvedSlug]);

  // Add an include/exclude filter chip (reproduces `addFilter`, main.coffee:705).
  // Routing through `actions.setFilter({ selected })` re-queries `/userstories`
  // with the serialized params AND refreshes the sidebar counts (BL-11).
  const handleAddFilter = useCallback(
    (payload: {
      category: FilterCategory;
      filter: FilterCategoryOption;
      mode: 'include' | 'exclude';
    }): void => {
      const applied: AppliedFilter = {
        id: payload.filter.id,
        name: payload.filter.name,
        dataType: payload.category.dataType,
        mode: payload.mode,
        color: payload.filter.color ?? null,
      };
      const exists = selectedFilters.some(
        (f) =>
          f.dataType === applied.dataType &&
          String(f.id) === String(applied.id) &&
          f.mode === applied.mode,
      );
      if (exists) {
        return;
      }
      actions.setFilter({ selected: [...selectedFilters, applied] });
    },
    [actions, selectedFilters],
  );

  // Remove an applied filter chip (reproduces `removeFilter`, main.coffee:705).
  const handleRemoveFilter = useCallback(
    (filter: AppliedFilter): void => {
      const next = selectedFilters.filter(
        (f) =>
          !(
            f.dataType === filter.dataType &&
            String(f.id) === String(filter.id) &&
            f.mode === filter.mode
          ),
      );
      actions.setFilter({ selected: next });
    },
    [actions, selectedFilters],
  );

  // Save the current applied filters as a named custom filter (reproduces the
  // `tg-filter` save-filter flow). The snapshot rides `CustomFilter`'s index
  // signature so selecting it later restores the exact chips.
  const handleSaveCustomFilter = useCallback(
    (name: string): void => {
      const trimmed = name.trim();
      if (!trimmed || customFilters.some((f) => f.name === trimmed)) {
        return;
      }
      const custom: CustomFilter = { id: Date.now(), name: trimmed, filters: selectedFilters };
      actions.setFilter({ custom: [...customFilters, custom] });
    },
    [actions, customFilters, selectedFilters],
  );

  // Apply a saved custom filter (restores its snapshot of applied chips).
  const handleSelectCustomFilter = useCallback(
    (filter: CustomFilter): void => {
      const stored = (filter as Record<string, unknown>).filters;
      if (Array.isArray(stored)) {
        actions.setFilter({ selected: stored as AppliedFilter[] });
      }
    },
    [actions],
  );

  // Delete a saved custom filter.
  const handleRemoveCustomFilter = useCallback(
    (filter: CustomFilter): void => {
      actions.setFilter({
        custom: customFilters.filter((f) => String(f.id) !== String(filter.id)),
      });
    },
    [actions, customFilters],
  );

  // #show-tags checkbox toggles the tags column (reproduces toggleShowTags +
  // showHideTags, main.coffee:872-877,896-908): flips `showTags`; the `.active`
  // class on `#show-tags` (and its inner `.check.js-check`) follows the flag, and
  // `showTags` flows into BacklogTable (adds `show-tags` to the body).
  const handleToggleTags = useCallback((): void => {
    actions.toggleShowTags();
  }, [actions]);

  // Velocity-forecasting toggle (reproduces toggleVelocityForecasting,
  // main.coffee:244-254 + the button clicks, backlog.jade:107-122).
  const handleToggleVelocity = useCallback((): void => {
    actions.toggleVelocityForecasting();
  }, [actions]);

  /* ------------------------------- sprint form ------------------------------- */

  // "Add sprint" (SprintList header / empty state) opens the create lightbox with
  // reducer-computed default dates (reproduces sprintform:create, sprints.coffee +
  // lightboxes.coffee:120-221).
  const handleAddSprint = useCallback((): void => {
    actions.openSprintForm('create');
  }, [actions]);
  // Sprint edit pencil opens the edit lightbox (reproduces sprintform:edit).
  const handleEditSprint = useCallback(
    (sprint: Sprint): void => {
      actions.openSprintForm('edit', sprint);
    },
    [actions],
  );
  const handleCloseSprintForm = useCallback((): void => {
    actions.closeSprintForm();
  }, [actions]);
  // Serializes the form subset into SprintFormValues and delegates to the hook,
  // which validates-free (SprintForm validated already), calls
  // `milestones.create`/`.save`, then reloads sprints + stats
  // (reproduces sprintform:*:success, main.coffee:170-190).
  const handleSubmitSprintForm = useCallback(
    (formValues: { name: string; estimated_start: string; estimated_finish: string }): Promise<void> => {
      const mode = state.sprintForm.mode;
      const editingId = mode === 'edit' ? state.sprintForm.values.id : undefined;
      const values: SprintFormValues = {
        project: state.project?.id ?? null,
        name: formValues.name,
        estimated_start: formValues.estimated_start,
        estimated_finish: formValues.estimated_finish,
        id: editingId,
      };
      return actions.submitSprintForm(values, mode, editingId);
    },
    [actions, state.sprintForm.mode, state.sprintForm.values.id, state.project],
  );
  // Sprint delete confirmation (finding #13). Reproduces the legacy blocking
  // `$confirm.askOnDelete(title, sprintName)` gate (lightboxes.coffee:103-118):
  // the edit lightbox's delete button does NOT delete directly — it opens a
  // confirm dialog naming the sprint; only the dialog's confirm issues the
  // DELETE. Cancel dismisses with no side effect (the edit form stays open).
  const [sprintDeleteConfirm, setSprintDeleteConfirm] = useState<{
    open: boolean;
    id: number | null;
    name: string | null;
  }>({ open: false, id: null, name: null });

  // Delete button in the edit lightbox -> OPEN the confirm dialog (was: delete
  // immediately). Captures the sprint id + name from the open edit form.
  const handleDeleteSprint = useCallback((): void => {
    const editingId = state.sprintForm.values.id;
    if (editingId != null) {
      setSprintDeleteConfirm({
        open: true,
        id: editingId,
        name: state.sprintForm.values.name ?? null,
      });
    }
  }, [state.sprintForm.values.id, state.sprintForm.values.name]);

  // Confirm dialog "Cancel" -> dismiss only; the edit lightbox remains open
  // (legacy askOnDelete rejection leaves `createEditOpen` untouched).
  const handleCancelDeleteSprint = useCallback((): void => {
    setSprintDeleteConfirm({ open: false, id: null, name: null });
  }, []);

  // Confirm dialog "Delete" -> dismiss the dialog and perform the delete. The
  // hook's `removeSprint` issues DELETE /milestones/{id}, closes the edit form,
  // and reloads sprints + stats + userstories (reproduces sprintform:remove:success,
  // main.coffee:192-208).
  const handleConfirmDeleteSprint = useCallback((): void => {
    const id = sprintDeleteConfirm.id;
    setSprintDeleteConfirm({ open: false, id: null, name: null });
    if (id != null) {
      void actions.removeSprint(id);
    }
  }, [actions, sprintDeleteConfirm.id]);

  // Create-sprint default start date (finding #14). The last open sprint's
  // finish date; `SprintForm` seeds the create-mode start to `moment(lastEnd)`
  // (and finish to +2 weeks), or to today when there is no prior sprint —
  // exactly the legacy `getLastSprint` -> `estimated_start = lastSprint.estimated_finish`
  // rule (lightboxes.coffee:120-160). Passing this closes the "always today" gap.
  const lastSprintEndDate = useMemo<string | null>(
    () => selectLastSprint(state.sprints)?.estimated_finish ?? null,
    [state.sprints],
  );

  /* --------------------- inline row: edit / delete (finding #12) --------------------- */

  // Row ⋮ "Edit": the legacy `editUserStory` opened the generic edit lightbox by
  // broadcasting `genericform:edit` (main.coffee:653-660) — an AngularJS-only
  // surface OUTSIDE the React custom element. Per the coexistence boundary (AAP
  // 0.4.2: React owns everything INSIDE the tag, AngularJS owns navigation +
  // routing OUTSIDE it), the faithful bridge is to navigate to the story's
  // AngularJS detail/edit route — the SAME destination the row subject link
  // already targets (`/project/{slug}/us/{ref}`, via `buildUserStoryUrl`).
  const handleEditStory = useCallback(
    (us: UserStory): void => {
      window.location.assign(buildUserStoryUrl(us));
    },
    [buildUserStoryUrl],
  );

  // Row ⋮ "Delete": the legacy `deleteUserStory` gated removal behind a BLOCKING
  // confirm (`confirm.askOnDelete`, main.coffee:662-684) and only then optimistically
  // removed the story + reloaded stats/sprints. Reproduce that gate with a
  // lightbox confirm dialog; the actual removal (hook `deleteUserStory`, which
  // dispatches the optimistic REMOVE_US then `DELETE /userstories/{id}` and
  // reloads) fires ONLY on confirm.
  const [usDeleteConfirm, setUsDeleteConfirm] = useState<{ open: boolean; us: UserStory | null }>({
    open: false,
    us: null,
  });
  const handleRequestDeleteStory = useCallback((us: UserStory): void => {
    setUsDeleteConfirm({ open: true, us });
  }, []);
  const handleCancelDeleteStory = useCallback((): void => {
    setUsDeleteConfirm({ open: false, us: null });
  }, []);
  const handleConfirmDeleteStory = useCallback((): void => {
    const target = usDeleteConfirm.us;
    // Dismiss the dialog immediately (parity: the confirm lightbox closes on
    // click), then fire the hook's optimistic delete.
    setUsDeleteConfirm({ open: false, us: null });
    if (target != null) {
      void actions.deleteUserStory(target);
    }
  }, [actions, usDeleteConfirm.us]);

  // The subject shown in the delete-confirm message (reproduces the legacy
  // `US.TITLE_DELETE_MESSAGE {subject}` interpolation, main.coffee:664).
  const usDeleteConfirmSubject = useMemo<string>(() => {
    const subject = usDeleteConfirm.us?.['subject'];
    return typeof subject === 'string' ? subject : '';
  }, [usDeleteConfirm.us]);

  /* ------------------------------- add user story ------------------------------ */

  // Finding #16: the "+ Add" toolbar button, the bulk-add icon button, and the
  // empty-state "Create your first user story" button were inert (no handler).
  // Reproduce the legacy `addNewUs('standard' | 'bulk')` flow (main.coffee:683-691)
  // with a functional lightbox: 'standard' is a single-subject create input,
  // 'bulk' is a one-subject-per-line textarea. Both POST through the frozen
  // `/userstories` (single) and `/userstories/bulk_create` (bulk) endpoints via
  // the hook's `addStoryStandard` / `addStoryBulk` actions, which reload the
  // backlog + stats on success so the new stories appear.
  const [addStoryLightbox, setAddStoryLightbox] = useState<{
    open: boolean;
    mode: 'standard' | 'bulk';
  }>({ open: false, mode: 'standard' });
  const [addStorySubject, setAddStorySubject] = useState<string>('');
  const [addStoryBulkText, setAddStoryBulkText] = useState<string>('');
  // Double-submit guard (parity with the create-form's in-flight lock): a second
  // click while the create request is in flight is ignored, so one submit yields
  // exactly one POST.
  const addStorySubmittingRef = useRef<boolean>(false);

  const handleOpenAddStandard = useCallback((): void => {
    setAddStorySubject('');
    setAddStoryLightbox({ open: true, mode: 'standard' });
  }, []);
  const handleOpenAddBulk = useCallback((): void => {
    setAddStoryBulkText('');
    setAddStoryLightbox({ open: true, mode: 'bulk' });
  }, []);
  const handleCloseAddStory = useCallback((): void => {
    setAddStoryLightbox((prev) => ({ open: false, mode: prev.mode }));
    setAddStorySubject('');
    setAddStoryBulkText('');
  }, []);
  const handleSubmitAddStory = useCallback((): void => {
    if (addStorySubmittingRef.current) {
      return;
    }
    const mode = addStoryLightbox.mode;
    const payload = mode === 'bulk' ? addStoryBulkText.trim() : addStorySubject.trim();
    if (payload.length === 0) {
      handleCloseAddStory();
      return;
    }
    addStorySubmittingRef.current = true;
    const create = mode === 'bulk' ? actions.addStoryBulk(payload) : actions.addStoryStandard(payload);
    void create.finally(() => {
      addStorySubmittingRef.current = false;
      handleCloseAddStory();
    });
  }, [
    addStoryLightbox.mode,
    addStoryBulkText,
    addStorySubject,
    actions,
    handleCloseAddStory,
  ]);

  /* --------------------------- closed sprints / fold --------------------------- */

  // Single toggle that flips visibility and lazily loads closed sprints the first
  // time (reproduces tgBacklogToggleClosedSprintsVisualization, sprints.coffee).
  const handleToggleClosedSprints = useCallback((): void => {
    void actions.toggleClosedSprints();
  }, [actions]);
  const handleToggleSprintFold = useCallback(
    (sprintId: number): void => {
      actions.toggleSprintFold(sprintId);
    },
    [actions],
  );

  /* ------------------------------- derived view ------------------------------- */

  const permsCanModifyUs = can('modify_us');
  // `delete_us` gates each backlog row's ⋮ "Delete" item (reproduces the
  // `tg-check-permission="delete_us"` on `us-edit-popover.jade`). BL-12.
  const permsCanDeleteUs = can('delete_us');
  const hasSelectedFilters = state.filters.selected.length > 0;
  const hasUserStories = state.userstories.length > 0;
  const hasQuery = queryInput.length > 0;
  // `project.i_am_admin` gates the empty-burndown "customize graph" placeholder
  // (backlog.jade:23).
  const isAdmin = state.project?.['i_am_admin'] === true;

  /* --- Burndown chart visibility toggle (finding #1) --------------------- *
   * Reproduces `ToggleBurndownVisibility` (main.coffee:1175-1210): the graph is
   * shown by default and hidden when collapsed; the collapse flag is persisted
   * in storage under the (typo-preserved) legacy key, and is forced collapsed
   * whenever there is no graph to draw (`showGraphPlaceholder`). The container
   * gets `.shown` on the FIRST reveal (instant, no CSS transition) and `.open`
   * on every subsequent user toggle (animated), exactly like the directive's
   * `show(firstLoad)`; the toggle button gets `.active` while the graph is open.
   * -------------------------------------------------------------------------- */
  const [burndownCollapsed, setBurndownCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BURNDOWN_COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const burndownFirstLoadRef = useRef<boolean>(true);
  // Legacy `$watch "showGraphPlaceholder"`: once known, collapse if there is no
  // graph to render (`isBurndownGraphCollapsed = isBurndownGraphCollapsed || showGraphPlaceholder`).
  useEffect(() => {
    if (state.showGraphPlaceholder === true) {
      setBurndownCollapsed((prev) => prev || true);
    }
  }, [state.showGraphPlaceholder]);
  const handleToggleBurndown = useCallback((): void => {
    // After the first interaction, subsequent reveals animate (`.open`).
    burndownFirstLoadRef.current = false;
    setBurndownCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(BURNDOWN_COLLAPSE_KEY, String(next));
      } catch {
        /* storage unavailable — visibility still toggles for this session */
      }
      return next;
    });
  }, []);
  const burndownVisible = !burndownCollapsed;
  // `.shown` (first reveal, instant) vs `.open` (subsequent, animated).
  const graphicsContainerClass = `graphics-container js-burndown-graph${
    burndownVisible ? (burndownFirstLoadRef.current ? ' shown' : ' open') : ''
  }`;
  const toggleButtonClass = `stats js-toggle-burndown-visibility-button${
    burndownVisible ? ' active' : ''
  }`;
  // The project name shown by the AngularJS `tg-main-title` directive.
  const projectNameRaw = state.project?.['name'];
  const projectName = typeof projectNameRaw === 'string' ? projectNameRaw : '';

  // T1 fix: reproduce the AngularJS `appMetaService.setAll` browser-title
  // behavior (backlog/main.coffee:105-110). The legacy BacklogController set the
  // document title to `BACKLOG.PAGE_TITLE` ("Backlog - <projectName>") once the
  // initial data resolved. React sets it when the project name is known and
  // restores the prior title on unmount so leaving the route (an AngularJS
  // navigation) does not leave a stale "Backlog - ..." title behind.
  useEffect(() => {
    if (!projectName) {
      return undefined;
    }
    const previousTitle = document.title;
    document.title = `Backlog - ${projectName}`;
    return () => {
      document.title = previousTitle;
    };
  }, [projectName]);

  // Infinite-scroll next-page loader (reproduces ctrl.loadUserstories paging,
  // main.coffee:341-408); memoized so BacklogTable's scroll handler identity is
  // stable across renders.
  const handleLoadMore = useCallback((): void => {
    void actions.loadMoreUserstories();
  }, [actions]);

  /* --------------------------------- render --------------------------------- */

  // DOM skeleton reproduced from `app/partials/backlog/backlog.jade` with
  // BYTE-IDENTICAL class names (AAP 0.7 zero-visual-change). `DndProvider`
  // renders ONLY a `<DndContext>` (no DOM node) + an optional portal overlay, so
  // wrapping `section.backlog` + `sidebar.sidebar` inside it leaves them the two
  // direct children of the `.scrum` CSS grid, preserving the layout exactly.
  return (
    <div className="wrapper">
      <main className="main scrum">
        <DndProvider mode="backlog" onDragEnd={onDragEnd}>
          <section className="backlog">
            {/* Surface a failed optimistic move WRITE (QA BL-1 drag reorder /
                BL-2 toolbar move-to-sprint). The optimistic change has already
                been rolled back by the hook; this alert tells the user the
                reorder/move did not persist. Same copy + `.write-error`
                role="alert" markup the Kanban board renders (KanbanApp), so the
                existing SCSS applies and the two screens behave identically. */}
            {writeError ? (
              <div className="write-error" role="alert">
                Your changes were not saved!
              </div>
            ) : null}
            {/* mainTitle include (backlog.jade:18 -> mainTitle.jade). H1 fix: the
                heading shows the SECTION name ("Scrum"), matching the AngularJS
                `tg-main-title` directive (sectionName = BACKLOG.SECTION_NAME),
                NOT the project name. */}
            <header>
              <h1>Scrum</h1>
            </header>

            {/* backlog-summary (backlog.jade:20-30): project stats + burndown host. */}
            <div className="backlog-summary">
              {/* summary include (summary.jade): the three-layer summary bar + numbers. */}
              <div className="summary">
                {/* div.summary-progress-bar(tg-backlog-progress-bar="stats"). */}
                {state.stats ? <ProgressBar variant="backlog-summary" stats={state.stats} /> : null}

                <div className="data">
                  <span className="number">{`${state.stats?.completedPercentage ?? 0}%`}</span>
                </div>

                {state.stats?.total_points ? (
                  <div className="summary-stats">
                    <span className="number">{state.stats.total_points}</span>
                    <span className="description">Project points</span>
                  </div>
                ) : null}
                <div className="summary-stats">
                  <span className="number">{state.stats?.defined_points ?? 0}</span>
                  <span className="description">Defined points</span>
                </div>
                <div className="summary-stats">
                  <span className="number">{state.stats?.closed_points ?? 0}</span>
                  <span className="description">Closed points</span>
                </div>
                <div className="summary-stats">
                  <span className="number">{state.stats?.speed ?? 0}</span>
                  <span className="description">Points per sprint</span>
                </div>

                {/* div.stats.js-toggle-burndown-visibility-button(ng-if="!showGraphPlaceholder").
                    Wired to toggle the burndown chart (finding #1) — reproduces the
                    click handler in `ToggleBurndownVisibility` (main.coffee:1200-1203). */}
                {!state.showGraphPlaceholder ? (
                  <div
                    className={toggleButtonClass}
                    title="Toggle backlog graph"
                    role="button"
                    tabIndex={0}
                    aria-pressed={burndownVisible}
                    onClick={handleToggleBurndown}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleBurndown();
                      }
                    }}
                  >
                    <Svg icon="icon-graph" />
                  </div>
                ) : null}
              </div>

              {/* div.empty-burndown(ng-if="showGraphPlaceholder && project.i_am_admin"). */}
              {state.showGraphPlaceholder && isAdmin ? (
                <div className="empty-burndown">
                  <Svg icon="icon-graph" />
                  <div className="empty-text">
                    <p className="title">Customize your graph</p>
                    <p>Configure the project modules to display the burndown graph.</p>
                  </div>
                </div>
              ) : null}

              {/* div.graphics-container.js-burndown-graph > div.burndown. The Flot
                  burndown chart (main.coffee:1217-1338) is reproduced as a pure
                  inline-SVG <Burndown> bound to `state.stats.milestones` (finding
                  #1). The container's `.shown`/`.open` classes (driven by the
                  toggle) reveal it via the `slide` mixin (summary.scss:264-271). */}
              <div className={graphicsContainerClass}>
                <div className="burndown">
                  <Burndown stats={state.stats} />
                </div>
              </div>
            </div>

            {/* backlog-table top chrome (backlog.jade:32-122). */}
            <div className="backlog-table">
              <div className="backlog-top">
                <div className="backlog-menu">
                  <div className="backlog-header">
                    <div className="backlog-header-title">
                      <h2>Backlog</h2>
                      {/* Story counts (backlog.jade:38-48): a squared "visible" badge +
                          filtered total when filters are selected, else a plain total. */}
                      {hasSelectedFilters ? (
                        <>
                          <span className="backlog-stories-number squared">{state.userstories.length}</span>
                          <span className="backlog-stories-number">{`${state.totalUserStories} stories`}</span>
                        </>
                      ) : (
                        <span className="backlog-stories-number">{`${state.totalUserStories} stories`}</span>
                      )}
                    </div>
                    <div className="backlog-header-options">
                      {/* addnewus include (addnewus.jade): the "add user story" controls.
                          The create-US lightbox is an AngularJS flow with no action on the
                          `useBacklog` surface. Finding #16: the "+ Add" and bulk
                          buttons are now functional — they open the create /
                          bulk-create lightbox, reproducing `addNewUs('standard' |
                          'bulk')` (main.coffee:683-691). */}
                      {can('add_us') ? (
                        <div className="new-us">
                          <button
                            className="btn-small"
                            type="button"
                            aria-label="Add user story"
                            onClick={handleOpenAddStandard}
                          >
                            <Svg icon="icon-add" />
                            <span className="text">Add</span>
                          </button>
                          <button
                            className="btn-icon"
                            type="button"
                            aria-label="Add user stories in bulk"
                            onClick={handleOpenAddBulk}
                          >
                            <Svg icon="icon-bulk" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="backlog-table-options">
                    <div className="backlog-table-options-start">
                      {/* #show-filters-button (backlog.jade:54-67): toggles the sidebar
                          filter + the `.active` class on itself (main.coffee:917-925). */}
                      <button
                        id="show-filters-button"
                        type="button"
                        className={
                          state.activeFilters
                            ? 'btn-filter e2e-open-filter ng-animate-disabled active'
                            : 'btn-filter e2e-open-filter ng-animate-disabled'
                        }
                        onClick={handleToggleFilters}
                      >
                        <Svg icon="icon-filters" />
                        <span className="text">{state.activeFilters ? 'Hide filters' : 'Filters'}</span>
                        {hasSelectedFilters ? (
                          <span className="selected-filters">{state.filters.selected.length}</span>
                        ) : null}
                      </button>

                      {/* tg-input-search equivalent (backlog.jade:69-72): a debounced free-text
                          search bound to the `q` filter. `tg-input-search` is an AngularJS
                          directive; a plain search input reproduces the interaction. */}
                      <input
                        type="text"
                        className="tg-input-search"
                        aria-label="Search"
                        placeholder="Search"
                        value={queryInput}
                        onChange={handleQueryChange}
                      />

                      {/* #show-tags (backlog.jade:74-89, ng-if="userstories.length"):
                          toggles the tags column; `.active` on `#show-tags` + inner
                          `.check.js-check` follows `showTags` (main.coffee:872-877,896-908). */}
                      {hasUserStories ? (
                        <div
                          className={state.showTags ? 'display-tags-button active' : 'display-tags-button'}
                          id="show-tags"
                        >
                          <div className={state.showTags ? 'check js-check active' : 'check js-check'}>
                            <input
                              type="checkbox"
                              id="show-tags-input"
                              checked={state.showTags}
                              onChange={handleToggleTags}
                            />
                            <div />
                          </div>
                          <label htmlFor="show-tags-input">Show tags</label>
                        </div>
                      ) : null}
                    </div>

                    <div className="backlog-table-options-end">
                      {/* #move-to-current-sprint / #move-to-latest-sprint (backlog.jade:92-105).
                          Exactly one is present, chosen by `currentSprint`; both route through
                          the DISTINCT toolbar bulk path (bulkUpdateMilestone). Visibility is an
                          inline `display` toggle, reproducing checkSelected (main.coffee:828-831). */}
                      {state.currentSprint ? (
                        <button
                          id="move-to-current-sprint"
                          type="button"
                          className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                          style={{ display: moveToSprintDisplay }}
                          title="Move to current sprint"
                          onClick={handleMoveToCurrentSprint}
                        >
                          <span className="text">Move to current sprint</span>
                          <Svg icon="icon-add-to-sprint" />
                        </button>
                      ) : (
                        <button
                          id="move-to-latest-sprint"
                          type="button"
                          className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                          style={{ display: moveToSprintDisplay }}
                          title="Move to latest sprint"
                          onClick={handleMoveToLatestSprint}
                        >
                          <span className="text">Move to latest sprint</span>
                          <Svg icon="icon-add-to-sprint" />
                        </button>
                      )}

                      {/* velocity-forecasting-btn (backlog.jade:107-122): two variants gated
                          by `displayVelocity` + `stats.speed`; both toggle forecasting. */}
                      {hasUserStories && state.displayVelocity && can('add_milestone') ? (
                        <button
                          type="button"
                          className="btn-filter active velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting"
                          title="Forecasting"
                          onClick={handleToggleVelocity}
                        >
                          <Svg icon="icon-fold-column" />
                          <span className="text">Backlog</span>
                        </button>
                      ) : null}
                      {hasUserStories && !state.displayVelocity && (state.stats?.speed ?? 0) > 0 && can('add_milestone') ? (
                        <button
                          type="button"
                          className="btn-filter velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting"
                          title="Backlog"
                          onClick={handleToggleVelocity}
                        >
                          Forecasting
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* backlog-manager (backlog.jade:124): `.expanded` when NOT activeFilters. */}
            <div className={state.activeFilters ? 'backlog-manager' : 'backlog-manager expanded'}>
              {/* #backlog-filter (backlog.jade:126-140, ng-if="activeFilters"): the sidebar
                  filter host. Hosts the shared `tg-filter` FilterBar, populated from the
                  server `filters_data` (BL-11); the container keeps its `#backlog-filter`
                  id + `.backlog-filter.active` classes so the existing SCSS applies. */}
              {state.activeFilters ? (
                <div className="backlog-filter active" id="backlog-filter">
                  <FilterBar
                    filters={filterCategories}
                    customFilters={customFilters}
                    selectedFilters={selectedFilters}
                    excludeFilters={[]}
                    onAddFilter={handleAddFilter}
                    onRemoveFilter={handleRemoveFilter}
                    onSaveCustomFilter={handleSaveCustomFilter}
                    onSelectCustomFilter={handleSelectCustomFilter}
                    onRemoveCustomFilter={handleRemoveCustomFilter}
                  />
                </div>
              ) : null}

              {/* section.backlog-table (backlog.jade:142): the draggable backlog body,
                  `.hidden` when there are no stories. BacklogTable owns its own
                  SortableContext + droppable; BacklogApp only supplies the DndProvider. */}
              <section className={hasUserStories ? 'backlog-table' : 'backlog-table hidden'}>
                <BacklogTable
                  userstories={state.userstories}
                  showTags={state.showTags}
                  activeFilters={state.activeFilters}
                  displayVelocity={state.displayVelocity}
                  canModifyUs={permsCanModifyUs}
                  selectedIds={selectedIdsSet}
                  onSelectionChange={handleSelectionChange}
                  loadingUserstories={state.loadingUserstories}
                  disablePagination={state.disablePagination}
                  firstLoadComplete={state.firstLoadComplete}
                  onLoadMore={handleLoadMore}
                  firstUsInBacklogId={state.userstories[0]?.id}
                  buildUserStoryUrl={buildUserStoryUrl}
                  getStatusName={getStatusName}
                  getStatusColor={getStatusColor}
                  getPointsLabel={getPointsLabel}
                  /* inline row controls (finding #12): reference data + handlers.
                     Supplying these activates the per-row status dropdown, the
                     per-role points editor, the ⋮ options menu, and the header
                     "view points per Role" popover (all inert until now). */
                  statuses={statuses}
                  points={points}
                  roles={roles}
                  pointsViewRoleId={state.pointsViewRoleId}
                  canDeleteUs={permsCanDeleteUs}
                  onChangeStatus={actions.changeUsStatus}
                  onChangePoints={actions.changeUsPoints}
                  onEditStory={handleEditStory}
                  onDeleteStory={handleRequestDeleteStory}
                  onMoveToTop={actions.moveUsToTop}
                  onSelectRoleView={actions.setPointsViewRole}
                />

                {/* .forecasting-add-sprint (backlog.jade:144-172): shown when velocity
                    forecasting is on. The new-sprint affordance opens the create lightbox. */}
                {state.displayVelocity ? (
                  <div className="forecasting-add-sprint e2e-velocity-forecasting-add">
                    <span className="forecasting-text">
                      {state.forecastNewSprint ? 'New sprint' : 'Current sprint'}
                    </span>
                    {state.forecastNewSprint ? (
                      <div className="button btn-link">
                        <Svg icon="icon-add" />
                        <button className="text" type="button" onClick={handleAddSprint}>
                          Add new sprint
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* .empty-backlog (backlog.jade:174-176): "no match" state — visible when the
                  list is empty AND a query is active. */}
              <div
                className={
                  !hasUserStories && hasQuery
                    ? 'empty-backlog js-empty-backlog'
                    : 'empty-backlog js-empty-backlog hidden'
                }
              >
                <p className="no-match">There are no user stories matching your search.</p>
                <p className="no-match-help">Try a different search.</p>
              </div>

              {/* .empty-large (backlog.jade:178-191): first-use empty state — visible when the
                  list is empty AND there is no query. */}
              <div
                className={
                  !hasUserStories && !hasQuery
                    ? 'empty-large js-empty-backlog'
                    : 'empty-large js-empty-backlog hidden'
                }
              >
                <p className="title">Your backlog is empty.</p>
                {can('add_us') ? (
                  <button
                    className="btn-small"
                    type="button"
                    title="Create new user story"
                    onClick={handleOpenAddStandard}
                  >
                    <Svg icon="icon-add" />
                    <span className="text">Create your first user story</span>
                  </button>
                ) : null}
                <img src="images/empty/empty_mex.png" alt="Your backlog is empty" />
              </div>
            </div>

            {/* sidebar.sidebar (backlog.jade:193-194 -> sprints.jade): the Sprints section.
                SprintList renders `section.sprints`; the `<sidebar>` wrapper is the
                `.scrum` grid's second column. */}
            <sidebar className="sidebar">
              <SprintList
                openSprints={state.sprints}
                closedSprints={state.closedSprints}
                totalMilestones={state.totalMilestones}
                totalClosedMilestones={state.totalClosedMilestones}
                showClosedSprints={state.closedSprintsVisible}
                sprintOpen={state.sprintOpen}
                canAddMilestone={can('add_milestone')}
                canViewMilestones={can('view_milestones')}
                canEditSprint={can('modify_milestone')}
                canModifyUs={permsCanModifyUs}
                buildTaskboardUrl={buildTaskboardUrl}
                buildUserStoryUrl={buildUserStoryUrl}
                onAddSprint={handleAddSprint}
                onToggleClosedSprints={handleToggleClosedSprints}
                onToggleSprintFold={handleToggleSprintFold}
                onEditSprint={handleEditSprint}
              />
            </sidebar>
          </section>
        </DndProvider>
      </main>

      {/* .lightbox-sprint-add-edit host (backlog.jade:201-202 -> lightbox-sprint-add-edit.jade).
          SprintForm owns the validation (../shared/validation/sprintValidators) + the
          lightbox DOM; BacklogApp supplies the `state.sprintForm` model + the submit /
          close / delete callbacks (the hook owns the milestones API). */}
      <SprintForm
        open={state.sprintForm.open}
        mode={state.sprintForm.mode}
        initialValues={{
          name: state.sprintForm.values.name ?? undefined,
          estimated_start: state.sprintForm.values.estimated_start ?? undefined,
          estimated_finish: state.sprintForm.values.estimated_finish ?? undefined,
        }}
        sprintId={state.sprintForm.values.id}
        lastSprintEndDate={lastSprintEndDate}
        lastSprintName={state.sprintForm.lastSprintName}
        canDelete={state.sprintForm.canDelete && can('delete_milestone')}
        onSubmit={handleSubmitSprintForm}
        onClose={handleCloseSprintForm}
        onDelete={handleDeleteSprint}
      />

      {/* US delete-confirm lightbox (finding #12). Reproduces the blocking
          `confirm.askOnDelete` gate the legacy `deleteUserStory` required
          (main.coffee:662-684), using the SAME `.lightbox.lightbox-generic-form`
          confirm DOM the Kanban screen uses for its delete gate so the shared
          lightbox SCSS applies unchanged. The optimistic remove fires only from
          `handleConfirmDeleteStory`; Cancel dismisses with no side effect. */}
      {usDeleteConfirm.open ? (
        <div className="lightbox lightbox-generic-form lightbox-confirm-delete-us open">
          <div className="lightbox-header">
            <h2 className="title">Delete user story</h2>
          </div>
          <div className="lightbox-body">
            <p>
              Are you sure you want to delete
              {usDeleteConfirmSubject ? ` "${usDeleteConfirmSubject}"` : ' this user story'}?
            </p>
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn-cancel e2e-cancel"
                onClick={handleCancelDeleteStory}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete e2e-delete"
                onClick={handleConfirmDeleteStory}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Sprint delete-confirm lightbox (finding #13). Reproduces the blocking
          `$confirm.askOnDelete(DELETE_SPRINT.TITLE, sprint.name)` the legacy
          `.delete-sprint` click required (lightboxes.coffee:103-118, 225-227),
          using the SAME `.lightbox.lightbox-generic-form` confirm DOM as the US
          delete gate so the shared lightbox SCSS applies unchanged. The DELETE
          fires only from `handleConfirmDeleteSprint`; Cancel dismisses with no
          side effect and leaves the edit form open. */}
      {sprintDeleteConfirm.open ? (
        <div className="lightbox lightbox-generic-form lightbox-confirm-delete-sprint open">
          <div className="lightbox-header">
            <h2 className="title">Delete sprint</h2>
          </div>
          <div className="lightbox-body">
            <p>
              Are you sure you want to delete
              {sprintDeleteConfirm.name ? ` "${sprintDeleteConfirm.name}"` : ' this sprint'}?
            </p>
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn-cancel e2e-cancel"
                onClick={handleCancelDeleteSprint}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete e2e-delete"
                onClick={handleConfirmDeleteSprint}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add-user-story lightbox (finding #16). Reproduces the legacy
          `addNewUs('standard' | 'bulk')` create surfaces (main.coffee:683-691):
          'standard' is a single-subject input (`.lightbox-generic-form`), 'bulk'
          is a one-subject-per-line textarea (`.lightbox-generic-bulk`), using the
          same lightbox class names as the Kanban create/bulk lightboxes so the
          shared SCSS applies. Submit fires the hook's create/bulk-create action
          (guarded against double-submit); a blank payload just closes. */}
      {addStoryLightbox.open ? (
        <div
          className={
            addStoryLightbox.mode === 'bulk'
              ? 'lightbox lightbox-generic-bulk lightbox-add-story-bulk open'
              : 'lightbox lightbox-generic-form lightbox-add-story open'
          }
        >
          <div className="lightbox-header">
            <h2 className="title">
              {addStoryLightbox.mode === 'bulk' ? 'Add user stories in bulk' : 'New user story'}
            </h2>
          </div>
          <div className="lightbox-body">
            {addStoryLightbox.mode === 'bulk' ? (
              <textarea
                className="bulk-textarea e2e-add-story-bulk"
                aria-label="Add user stories in bulk"
                placeholder="Enter one user story per line"
                value={addStoryBulkText}
                autoFocus
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setAddStoryBulkText(event.target.value)
                }
              />
            ) : (
              <input
                type="text"
                className="create-us-subject e2e-add-story-subject"
                name="create-us-subject"
                aria-label="New user story"
                placeholder="Type the user story subject"
                value={addStorySubject}
                autoFocus
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setAddStorySubject(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSubmitAddStory();
                  }
                }}
              />
            )}
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn-cancel e2e-cancel"
                onClick={handleCloseAddStory}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-save e2e-create"
                onClick={handleSubmitAddStory}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default BacklogApp;

