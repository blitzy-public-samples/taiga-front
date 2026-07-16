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
 * `./state/*`, `./components/*`, and `../shared/*`.
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
import { useBacklog } from './hooks/useBacklog';
// Reducer model TYPES are type-only imports (isolatedModules): `Sprint` /
// `UserStory` type the URL builders + sprint handlers, `SprintFormValues` types
// the serialized-form -> hook mapping. `./state/*` is an allowed boundary import.
import type { Sprint, UserStory, SprintFormValues } from './state/backlogReducer';
// Presentational children (each owns its own DOM sub-tree + `SortableContext`).
import { BacklogTable } from './components/BacklogTable';
import { SprintList } from './components/SprintList';
import { SprintForm } from './components/SprintForm';
import { ProgressBar } from './components/ProgressBar';
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
  // Data + effects live in the hook; it returns { state, actions } and auto-loads
  // the project, stats, sprints and first user-story page on mount
  // (reproduces BacklogController.loadInitialData/loadBacklog, main.coffee:410-415).
  const { state, actions } = useBacklog({ projectSlug, projectId });

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
  // Delete the sprint being edited (reproduces sprintform:remove:success,
  // main.coffee:192-208).
  const handleDeleteSprint = useCallback((): void => {
    const editingId = state.sprintForm.values.id;
    if (editingId != null) {
      void actions.removeSprint(editingId);
    }
  }, [actions, state.sprintForm.values.id]);

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
  const hasSelectedFilters = state.filters.selected.length > 0;
  const hasUserStories = state.userstories.length > 0;
  const hasQuery = queryInput.length > 0;
  // `project.i_am_admin` gates the empty-burndown "customize graph" placeholder
  // (backlog.jade:23).
  const isAdmin = state.project?.['i_am_admin'] === true;
  // The project name shown by the AngularJS `tg-main-title` directive.
  const projectNameRaw = state.project?.['name'];
  const projectName = typeof projectNameRaw === 'string' ? projectNameRaw : '';

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
            {/* mainTitle include (backlog.jade:18 -> mainTitle.jade): project heading. */}
            <header>
              <h1>{projectName}</h1>
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

                {/* div.stats.js-toggle-burndown-visibility-button(ng-if="!showGraphPlaceholder"). */}
                {!state.showGraphPlaceholder ? (
                  <div className="stats js-toggle-burndown-visibility-button" title="Toggle backlog graph">
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

              {/* div.graphics-container.js-burndown-graph > div.burndown. The flot
                  burndown chart (main.coffee:1217-1338) is REFERENCE-only and NOT
                  ported; only the container + placeholder divs are reproduced. */}
              <div className="graphics-container js-burndown-graph">
                <div className="burndown" />
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
                          `useBacklog` surface (BacklogApp's behavioral scope covers
                          sprint/milestone CRUD, not US CRUD - AAP 0.7), so the chrome is
                          reproduced for visual parity without a click handler. */}
                      {can('add_us') ? (
                        <div className="new-us">
                          <button className="btn-small" type="button" aria-label="Add user story">
                            <Svg icon="icon-add" />
                            <span className="text">Add</span>
                          </button>
                          <button className="btn-icon" type="button" aria-label="Add user stories in bulk">
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
                  filter host. The detailed filter widgets are backed by `state.filters`; a
                  minimal, class-accurate container is reproduced here. */}
              {state.activeFilters ? <div className="backlog-filter active" id="backlog-filter" /> : null}

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
                  <button className="btn-small" type="button" title="Create new user story">
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
        lastSprintName={state.sprintForm.lastSprintName}
        canDelete={state.sprintForm.canDelete && can('delete_milestone')}
        onSubmit={handleSubmitSprintForm}
        onClose={handleCloseSprintForm}
        onDelete={handleDeleteSprint}
      />
    </div>
  );
}

export default BacklogApp;

