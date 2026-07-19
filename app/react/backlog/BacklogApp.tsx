/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogApp.tsx — the CONTAINER component for the migrated React
 * Backlog / Sprint-planning screen.
 *
 * WHAT THIS IS
 *   The React re-expression of the AngularJS `BacklogController`
 *   (`app/coffee/modules/backlog/main.coffee`, class L25, registered L715) and
 *   the backlog Jade template (`app/partials/backlog/backlog.jade` +
 *   `app/partials/includes/modules/sprints.jade`). `../index.tsx` mounts this
 *   component as the `<tg-react-backlog>` custom element via
 *   `../shared/mount.tsx`.
 *
 * ARCHITECTURE — Container / Presentational split (AAP §0.3.3)
 *   This file OWNS: props ingestion, the `useBacklog` state hook (data fetching
 *   + WebSocket subscription + dispatch), every coordinating callback
 *   (add/edit/delete US, add/edit/delete sprint, move-to-sprint toolbar,
 *   velocity toggle, tags toggle, filter apply, closed-sprints toggle, burndown
 *   toggle), lightbox open/close state, and the composition of the DnD context
 *   + presentational children. The children only RENDER: `BacklogTable`,
 *   `Sprint` (+ nested `SprintHeader`/`ProgressBar`), `CreateEditSprintLightbox`,
 *   and `BulkCreateUsLightbox`.
 *
 * BEHAVIOURAL PARITY (hard requirement — AAP §0.1.1, §0.7.1)
 *   Reproduces the existing AngularJS behaviour EXACTLY (zero feature change).
 *   The DOM structure and SCSS class names of `backlog.jade` / `sprints.jade`
 *   are reproduced verbatim so the RETAINED stylesheets style the React DOM;
 *   there is deliberately NO `.scss` import here. Source line references are
 *   cited inline throughout.
 *
 * STRICT DEPENDENCY BOUNDARY
 *   Imports come ONLY from this file's declared dependencies: the sibling
 *   `./state`, `./dnd`, `./components/*` and the `../shared/*` infrastructure.
 *   It NEVER imports Immutable.js, dragula, dom-autoscroller, checksley, any
 *   `.coffee` / AngularJS module (esp. `resources.coffee`), nor the low-level
 *   `shared/api/client`: all backend / session / events / permissions access
 *   flows through the `useBacklog` hook + the permission helpers. `immer` and
 *   `@dnd-kit/core` are used only inside `state/` and `dnd/` respectively.
 *
 * Toolchain: TypeScript 5.4.5 under `strict`, `jsx: "react-jsx"` (NO
 * `import React`), Node v16.19.1 compatible. Bundled by esbuild into
 * `dist/js/react.js`.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { FC, ChangeEvent } from 'react';

import { useBacklog } from './state/useBacklog';
import { BacklogDndContext } from './dnd/BacklogDndContext';
import type { BacklogMovePayload } from './dnd/BacklogDndContext';
import { BacklogTable } from './components/BacklogTable';
import { Sprint } from './components/Sprint';
import { ProgressBar } from './components/ProgressBar';
import { CreateEditSprintLightbox } from './components/CreateEditSprintLightbox';
import { BulkCreateUsLightbox } from './components/BulkCreateUsLightbox';
// F-CQ-06: the sidebar filter panel. `FiltersSidebar` is the presentational port
// of the shared AngularJS `<tg-filter>` component that BOTH the Kanban board and
// the Backlog hosted verbatim (retired `backlog.jade` `.backlog-filter > tg-filter`
// with the identical `filters`/`custom-filters`/`selected-filters` bindings). It is
// purely presentational ("props down, events up"), so it is reused here; the
// data-shaping is done by the shared `UsFiltersMixin` port in `../shared/filters`.
import { FiltersSidebar } from '../kanban/components/FiltersSidebar';
import type { CustomFilter } from '../kanban/components/FiltersSidebar';
import {
    buildDataCollection,
    buildCategories,
    buildSelectedFilters,
    addFilterSelection,
    removeFilterSelection,
} from '../shared/filters';
import type { FilterCategory, SelectedFilter } from '../shared/filters';
import { canModifyUs, canAddUs, canAddMilestone, canMutate } from '../shared/permissions';
// F-UI-02: the ONE shared SVG-sprite icon primitive (replaces the container's
// broken empty-span placeholder).
import { TgIcon } from '../shared/icon';
import type { Project, UserStory, Milestone, Status, FilterOption } from '../shared/types';

/* ========================================================================== *
 * Props
 *
 * `../shared/mount.tsx` converts the lower-kebab HTML attributes on
 * `<tg-react-backlog project-id="1" project-slug="foo">` into camelCase props
 * whose values are ALWAYS strings. The container is responsible for coercing
 * them to their real types (here, `projectId` -> number).
 * ========================================================================== */

export interface BacklogAppProps {
    /** e.g. "1" — COERCED to a number with `Number(projectId)`. */
    projectId: string;
    /** e.g. "my-project" — informational; children read `project.slug` instead. */
    projectSlug?: string;
    /** Tolerate any extra attributes the mount wrapper passes through. */
    [key: string]: string | undefined;
}

/** Which lightbox (if any) is currently open. */
type LightboxKind = 'none' | 'sprint-create' | 'sprint-edit' | 'bulk-us';

/* ========================================================================== *
 * Pure helpers — coerce the loosely-typed `Project` extras
 *
 * The shared `Project` type carries an index signature (`[key: string]:
 * unknown`) for the many backend fields the migration does not model
 * explicitly, so these accessors narrow the specific extras the backlog needs.
 * ========================================================================== */

/**
 * The project's user-story statuses, sorted ascending by id. Reproduces
 * `@scope.usStatusList = _.sortBy(project.us_statuses, "id")`
 * (`main.coffee:482`). Returns `[]` before the project has loaded.
 */
function readSortedStatuses(project: Project | null): Status[] {
    const raw = (project?.us_statuses as Status[] | undefined) ?? [];
    return [...raw].sort((a, b) => a.id - b.id);
}

/**
 * The default US status id used to seed the bulk-create lightbox
 * (`@scope.project.default_us_status`, `main.coffee:690-691`). Falls back to the
 * first available status id (then `0`) when the field is absent so the child
 * never receives `NaN`.
 */
function readDefaultUsStatus(project: Project | null, statuses: Status[]): number {
    const raw = Number(project?.default_us_status);
    if (Number.isFinite(raw)) {
        return raw;
    }
    return statuses[0]?.id ?? 0;
}

/** Whether the project has the Kanban board activated (gates the swimlane UI). */
function readIsKanbanActivated(project: Project | null): boolean {
    return Boolean(project?.is_kanban_activated);
}

/** The project's default swimlane id (or `null`), used by the bulk-create form. */
function readDefaultSwimlane(project: Project | null): number | null {
    const raw = project?.default_swimlane as number | null | undefined;
    return raw ?? null;
}

/**
 * Whether the current user is a project admin — gates the `empty-burndown`
 * customise-graph hint (`ng-if="showGraphPlaceholder && project.i_am_admin"`,
 * `backlog.jade:23`).
 */
function readIsAdmin(project: Project | null): boolean {
    return Boolean(project?.i_am_admin);
}

/**
 * Format a numeric stat for the summary block, tolerating `null`/`undefined`
 * (the AngularJS `| number` filter rendered nothing for missing values; we
 * render `0`). Kept deliberately small — the summary/burndown region is
 * layout-only (see the burndown scope note in the render).
 */
function formatNumber(value: unknown): string {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return '0';
    }
    return String(Math.round(n * 100) / 100);
}

// F-UI-02: icons render through the ONE shared `TgSvg` sprite primitive
// (`../shared/icon`). The container previously emitted an empty
// `<span class="icon …">`, which CANNOT paint a Taiga SVG-sprite icon (the
// retained SCSS targets the `tg-svg` host + `svg.icon` `<use href="#…">`
// reference). The `TgIcon` compat alias forwards a decorative `name` to the
// shared primitive so every `<TgIcon name="icon-…"/>` call site below renders
// the real sprite reference, matching the sibling child components.

/* ========================================================================== *
 * The container component
 * ========================================================================== */

export const BacklogApp: FC<BacklogAppProps> = (props) => {
    // Coerce the string `project-id` attribute to a number ONCE (mount passes
    // strings). A valid project id must be a POSITIVE INTEGER (F-REG-01):
    // `Number.isInteger(...) && > 0` rejects the literal `"{{project.id}}"`
    // snapshot (NaN), a blank/absent attribute (`Number("")` -> 0) and any
    // non-positive/fractional value. When AngularJS later resolves the
    // interpolation, `attributeChangedCallback` in shared/mount.tsx re-renders
    // with the real id and this guard then passes.
    const projectId = Number(props.projectId);
    const projectIdValid = Number.isInteger(projectId) && projectId > 0;

    // The effectful Backlog state hook (data load + WebSocket subscription +
    // thunks). Called UNCONDITIONALLY (Rules of Hooks); when `projectId` is not
    // a real number the hook's own `if (!projectId)` effect guard no-ops, so no
    // request is issued.
    const { state, actions } = useBacklog(projectId);

    const {
        project,
        isBacklogActivated,
        userstories,
        sprints,
        closedSprints,
        stats,
        filtersData,
        selectedFilters,
        currentSprint,
        totalMilestones,
        totalClosedMilestones,
        totalUserStories,
        visibleUserStories,
        displayVelocity,
        forecastNewSprint,
        showTags,
        swimlanesList,
        firstUsInBacklog,
        // F-CQ-05: pagination view fields (drive the load-more sentinel + spinner).
        loadingUserstories,
        disablePagination,
        // F-AAP-10: distinguish a genuine load FAILURE from a legitimately empty
        // backlog so the container can render an error state (with retry).
        loadError,
    } = state;

    /* ---- Local UI state (the ephemeral view state the AngularJS controller
     * kept on `$scope` or directly in the DOM). ------------------------------ */

    // Which lightbox is open + the sprint being edited (edit mode only).
    const [lightbox, setLightbox] = useState<LightboxKind>('none');
    const [editingSprint, setEditingSprint] = useState<Milestone | null>(null);

    // Checked backlog rows (drives the move-to-sprint toolbar + multi-drag).
    const [checkedIds, setCheckedIds] = useState<number[]>([]);
    // Last checked row id — anchors shift-range selection (main.coffee:820).
    // A ref (not state): mutated synchronously, must not trigger re-renders,
    // mirroring the AngularJS `lastChecked` closure variable.
    const lastCheckedIdRef = useRef<number | null>(null);

    // Closed-sprints visibility. `excludeClosedSprints` started TRUE in the
    // source (closed sprints hidden), so this starts `false` (sprints.coffee:124).
    const [showClosedSprints, setShowClosedSprints] = useState(false);

    // Custom-filters sidebar open flag (the AngularJS `activeFilters` for the
    // `#show-filters-button` / `.backlog-filter` region + `backlog-manager`
    // `expanded` class). Kept local because the filter-chip directive
    // (`tg-filter`) is out of migration scope.
    const [filtersSidebarOpen, setFiltersSidebarOpen] = useState(false);

    // Text search bound to the `tg-input-search` box (`ctrl.filterQ`).
    const [filterQ, setFilterQ] = useState('');

    // Burndown graph collapsed flag (ToggleBurndownVisibility, main.coffee:1166).
    const [burndownCollapsed, setBurndownCollapsed] = useState(false);

    // `showGraphPlaceholder` defaults the burndown to collapsed, exactly as the
    // directive's watch did: `isBurndownGraphCollapsed ||= showGraphPlaceholder`.
    const showGraphPlaceholder = Boolean(stats?.showGraphPlaceholder);
    useEffect(() => {
        if (showGraphPlaceholder) {
            setBurndownCollapsed(true);
        }
    }, [showGraphPlaceholder]);

    // F-CQ-04 summary loading/error signals. `stats` is populated by the initial
    // load and every `reloadStats`; until it first arrives the summary meter has
    // no data. `statsLoading` marks that pre-data window so the region renders a
    // loading treatment (rather than a misleading "0%"); `statsError` is a load
    // failure while content is present — the summary keeps the last-known values
    // and flags the staleness instead of blanking (the board-level error state
    // at the top handles the genuinely empty + failed case).
    const statsLoading = stats == null && !loadError;
    const statsError = loadError && stats == null && userstories.length > 0;

    /* ---- Derived values ---------------------------------------------------- */

    const usStatusList = useMemo(() => readSortedStatuses(project), [project]);
    const defaultUsStatus = readDefaultUsStatus(project, usStatusList);
    const isKanbanActivated = readIsKanbanActivated(project);
    const defaultSwimlane = readDefaultSwimlane(project);
    const iAmAdmin = readIsAdmin(project);

    // F-CQ-06 sidebar filters. The hook keeps the raw `filtersData` facets and the
    // applied `selectedFilters` (a `Record<dataType, csv-of-values>`); the shared
    // `UsFiltersMixin` port shapes them into the display structures `FiltersSidebar`
    // renders. The Backlog uses NO facet exclusions (`excludeFilters = []` in the
    // legacy `BacklogController`, unlike Kanban which hid `status`), so the STATUS
    // facet is offered here.
    const filterDataCollection = useMemo(
        () => buildDataCollection(filtersData),
        [filtersData],
    );
    const filterCategories = useMemo(
        () => buildCategories(filterDataCollection, []),
        [filterDataCollection],
    );
    const appliedFilters = useMemo(
        () => buildSelectedFilters(filterDataCollection, selectedFilters),
        [filterDataCollection, selectedFilters],
    );

    // Number of applied FACET filters (the AngularJS `ctrl.selectedFilters.length`
    // — the count of applied options, NOT the number of populated buckets).
    const selectedFilterCount = appliedFilters.length;

    // The checked user stories, in backlog order (getUsToMove, main.coffee:769-777).
    const checkedUserstories = useMemo(
        () => userstories.filter((us) => checkedIds.includes(us.id)),
        [userstories, checkedIds],
    );
    // The move-to-sprint toolbar is shown only when >=1 story is checked AND at
    // least one open sprint exists (checkSelected, main.coffee:828-831).
    const hasSelection = checkedIds.length > 0 && sprints.length > 0;

    // The most recent OPEN sprint (sorted ascending by `estimated_finish`,
    // getLastSprint) — used to prefill the create-sprint lightbox dates.
    const lastSprint = useMemo<Milestone | null>(() => {
        if (sprints.length === 0) {
            return null;
        }
        const sorted = [...sprints].sort((a, b) =>
            String(a.estimated_finish).localeCompare(String(b.estimated_finish)),
        );
        return sorted[sorted.length - 1];
    }, [sprints]);

    /* ---- Permission gates (the AngularJS `tg-check-permission` directives) -- */
    const mayAddUs = canAddUs(project);
    const mayAddMilestone = canAddMilestone(project);
    const mayModifyUs = canModifyUs(project);
    // F-REG-03: deleting a sprint is a mutation -> archive-aware gate.
    const mayDeleteMilestone = canMutate(project, 'delete_milestone');

    /* ====================================================================== *
     * Toolbar / action callbacks
     * ====================================================================== */

    // addNewUs (main.coffee:683-691). F-CQ-03 — the two create paths are NOT
    // interchangeable:
    //   - 'standard' broadcast `genericform:new` -> the COMMON module's generic
    //     US form (AAP §0.2.2 common OOS; §0.4.1 defines no React standard-create
    //     component). It is a DEFERRED no-op; the still-AngularJS shell provides
    //     the standard create dialog. Routing it to the bulk lightbox (the prior
    //     cut) was WRONG — the two dialogs are distinct.
    //   - 'bulk' broadcast `usform:bulk` -> the in-scope `BulkCreateUsLightbox`
    //     (AAP §0.4.1), the ONLY migrated create surface.
    const addNewUs = useCallback((type: 'standard' | 'bulk') => {
        if (type === 'bulk') {
            setLightbox('bulk-us');
        }
        // 'standard' is a deferred no-op (genericform:new, common OOS).
    }, []);

    // addNewSprint (main.coffee:693-694) -> open the sprint lightbox in create mode.
    const addNewSprint = useCallback(() => {
        setEditingSprint(null);
        setLightbox('sprint-create');
    }, []);

    // Edit-sprint pencil (Sprint -> SprintHeader) -> open the lightbox in edit
    // mode. Reproduces `$rootScope.$broadcast("sprintform:edit", sprint)`.
    const handleEditSprint = useCallback((sprint: Milestone) => {
        setEditingSprint(sprint);
        setLightbox('sprint-edit');
    }, []);

    const clearSelection = useCallback(() => {
        setCheckedIds([]);
        lastCheckedIdRef.current = null;
    }, []);

    // Move-to-current-sprint (moveToCurrentSprint, main.coffee:807-810):
    // target = currentSprint || sprints[0]. Delegates to the hook's
    // `moveToSprint` thunk (the genuine `bulkUpdateMilestone` use-site, which
    // reloads sprints + stats), then clears the selection.
    const moveToCurrentSprint = useCallback(() => {
        if (checkedUserstories.length === 0 || sprints.length === 0) {
            return;
        }
        const target = currentSprint ?? sprints[0];
        // F-REG-06: await the move; clear the selection ONLY on success. On
        // failure the hook has surfaced `moveError` and reconciled the board to
        // server truth (the optimistically-removed stories return) — keep the
        // selection so the user can retry rather than losing it silently.
        void actions
            .moveToSprint(checkedUserstories, target.id)
            .then(() => clearSelection())
            .catch(() => {
                /* selection intentionally retained on failure */
            });
    }, [actions, checkedUserstories, currentSprint, sprints, clearSelection]);

    // Move-to-latest-sprint (moveToLatestSprint, main.coffee:812-813):
    // target = sprints[0].
    const moveToLatestSprint = useCallback(() => {
        if (checkedUserstories.length === 0 || sprints.length === 0) {
            return;
        }
        // F-REG-06: await + clear selection only on success (see moveToCurrentSprint).
        void actions
            .moveToSprint(checkedUserstories, sprints[0].id)
            .then(() => clearSelection())
            .catch(() => {
                /* selection intentionally retained on failure */
            });
    }, [actions, checkedUserstories, sprints, clearSelection]);

    // toggleTags (main.coffee:501). The AngularJS source persisted the flag via
    // `rs.userstories.storeShowTags(projectId, value)` and rehydrated it via
    // `getShowTags(projectId)` on load. The migrated `useBacklog` hook owns
    // `showTags` in reducer state AND reproduces both halves of that contract
    // (F-CQ-09): `toggleTags` writes the project-scoped preference to
    // localStorage, and a mount effect re-reads it on projectId change. The
    // container therefore just dispatches the toggle; persistence + rehydration
    // are handled by the hook.
    const handleToggleTags = useCallback(() => {
        actions.toggleTags();
    }, [actions]);

    // Velocity forecasting toggle (toggleVelocityForecasting, main.coffee:244-254).
    // The forecast math (using `stats.speed`) lives in the reducer/hook; the
    // container flips the flag and renders the toggle state + forecast region.
    const handleToggleVelocity = useCallback(() => {
        actions.toggleVelocity();
    }, [actions]);

    // Custom-filters sidebar visibility (`toggleActiveFilters`, main.coffee:241-242).
    const toggleFiltersSidebar = useCallback(() => {
        setFiltersSidebarOpen((open) => !open);
    }, []);

    // F-CQ-06 addFilterBacklog (main.coffee:706-708): add the chosen option to the
    // include/exclude bucket, then reload. `setFilters` replaces the whole
    // selections map and re-runs the backlog fetch + facet regeneration, so a
    // single call covers `selectFilter` + `filtersReloadContent` + `generateFilters`.
    const handleAddFilter = useCallback(
        (payload: {
            category: FilterCategory;
            filter: FilterOption;
            mode: 'include' | 'exclude';
        }) => {
            const next = addFilterSelection(
                selectedFilters,
                payload.category.dataType,
                payload.filter,
                payload.mode,
            );
            actions.setFilters(next);
        },
        [actions, selectedFilters],
    );

    // F-CQ-06 removeFilterBacklog (main.coffee:710-713): drop the applied option
    // from its bucket, then reload.
    const handleRemoveFilter = useCallback(
        (filter: SelectedFilter) => {
            const next = removeFilterSelection(selectedFilters, filter);
            actions.setFilters(next);
        },
        [actions, selectedFilters],
    );

    // F-CQ-06 SAVED "custom filters" (named, server-persisted filter SETS) — the
    // same principled deferral the Kanban board makes: the legacy
    // `saveCustomFilter`/`selectCustomFilter`/`removeCustomFilter`
    // (main.coffee via `FiltersMixin`, `controllerMixins.coffee:197-247`) persist
    // through `filterRemoteStorageService` -> the `/user-storage` endpoint
    // (`resources.coffee:46`). That service is NOT in the AAP §0.4.1 `shared/api/**`
    // manifest and belongs to the COMMON module the AAP lists OUT OF SCOPE (§0.2.2),
    // so there is no in-scope adapter to own saved-filter persistence. The AD-HOC
    // facet filters above ARE fully implemented (they use the in-scope
    // `filters_data` endpoint); only the named saved-set feature is deferred, so
    // the sidebar renders an empty saved-filter list and these three handlers are
    // documented, AAP-scoped no-ops.
    const handleSelectCustomFilter = useCallback((_customFilter: CustomFilter) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter). */
    }, []);
    const handleRemoveCustomFilter = useCallback((_customFilter: CustomFilter) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter). */
    }, []);
    const handleSaveCustomFilter = useCallback((_name: string) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter). */
    }, []);

    // Search box (`tg-input-search` -> `ctrl.changeQ`). Binds the `q` text
    // filter and reloads the backlog with it via `setFilters` — the only
    // reload-with-filters action the hook exposes (`params.q = @.filterQ`,
    // main.coffee:353). NOTE: `setFilters` recomputes `activeFilters` from the
    // filter-key count, so a non-empty search marks filters active (a benign,
    // arguably-correct effect — search IS an active filter).
    const handleChangeQ = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const q = event.target.value;
            setFilterQ(q);
            const nextFilters: Record<string, string> = { ...selectedFilters };
            if (q) {
                nextFilters.q = q;
            } else {
                delete nextFilters.q;
            }
            actions.setFilters(nextFilters);
        },
        [actions, selectedFilters],
    );

    // Closed-sprints toggle (ToggleExcludeClosedSprintsVisualization,
    // sprints.coffee:122-165). Toggling to VISIBLE lazily loads the closed
    // sprints if none are present yet (backlog:load-closed-sprints); toggling to
    // hidden simply stops rendering them (the source's unload cleared the list,
    // equivalent for the UI).
    const toggleClosedSprints = useCallback(() => {
        setShowClosedSprints((prev) => {
            const next = !prev;
            if (next && closedSprints.length === 0) {
                actions.reloadClosedSprints();
            }
            return next;
        });
    }, [actions, closedSprints.length]);

    // Burndown graph visibility toggle (ToggleBurndownVisibility, main.coffee:1198).
    const toggleBurndown = useCallback(() => {
        setBurndownCollapsed((collapsed) => !collapsed);
    }, []);

    /* ====================================================================== *
     * BacklogTable row callbacks
     * ====================================================================== */

    // onToggleCheck reproduces the shift-range multiselect (main.coffee:819-860):
    // on a shift-click, select the contiguous range (in rendered backlog order)
    // between the last checked row and the clicked row; otherwise toggle the
    // single row. `lastChecked` is updated on every interaction.
    const handleToggleCheck = useCallback(
        (us: UserStory, checked: boolean, shiftKey: boolean) => {
            setCheckedIds((prev) => {
                const next = new Set(prev);
                const lastId = lastCheckedIdRef.current;

                if (shiftKey && lastId != null) {
                    const ids = userstories.map((u) => u.id);
                    const from = ids.indexOf(lastId);
                    const to = ids.indexOf(us.id);
                    if (from !== -1 && to !== -1) {
                        const lo = Math.min(from, to);
                        const hi = Math.max(from, to);
                        for (let i = lo; i <= hi; i += 1) {
                            next.add(ids[i]);
                        }
                    } else if (checked) {
                        next.add(us.id);
                    } else {
                        next.delete(us.id);
                    }
                } else if (checked) {
                    next.add(us.id);
                } else {
                    next.delete(us.id);
                }

                return Array.from(next);
            });
            lastCheckedIdRef.current = us.id;
        },
        [userstories],
    );

    // Move a story to the top of the backlog (moveUsToTopOfBacklog, main.coffee:511-521).
    const handleMoveUsToTop = useCallback(
        (us: UserStory) => {
            actions.moveUsToTopOfBacklog(us);
        },
        [actions],
    );

    // Delete a story (deleteUserStory, main.coffee:662-681). F-CQ-03 — this
    // control was OWNED by the legacy controller: `@confirm.askOnDelete` then
    // `@repo.remove(us)` (a real `DELETE /userstories/{id}`). The prior React cut
    // only removed the story from the LOCAL list (no backend DELETE) — the
    // "delete is local-only" bug. Now: archive-aware `delete_us` gate +
    // `window.confirm` (the established stand-in for `$confirm.askOnDelete`) +
    // the hook's `deleteUs` thunk (optimistic remove + `api.del` + reload/rollback).
    const handleDeleteUs = useCallback(
        (us: UserStory) => {
            if (!canMutate(project, 'delete_us')) {
                return;
            }
            const confirmed = window.confirm(
                `Are you sure you want to delete the user story "${us.subject}"?`,
            );
            if (!confirmed) {
                return;
            }
            void actions.deleteUs(us);
        },
        [actions, project],
    );

    // Edit a story. F-CQ-03 DEFERRED: the generic US edit form was the COMMON
    // module's `genericform:edit` dialog (AAP §0.2.2 common OOS; §0.4.1 defines no
    // React US-edit component). The row's subject link opens the still-AngularJS
    // US detail screen, which owns viewing/editing — so this inline affordance is
    // an AAP-scoped no-op, not a gap.
    const handleEditUs = useCallback((_us: UserStory) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no React edit component):
         * generic US edit is owned by the still-AngularJS US detail screen. */
    }, []);

    // Inline status change (tgUsStatus popover). F-CQ-03 — the status popover UI
    // is reproduced in-scope by `BacklogTable`; the persistence was missing. Now
    // the container gates `modify_us` (archive-aware) and delegates to the hook's
    // `updateUsStatus` thunk (optimistic `replaceUs` + `PATCH /userstories/{id}`
    // { status, version } + reload stats/filters + reload-on-error reconcile).
    const handleUpdateStatus = useCallback(
        (us: UserStory, newStatusId: number) => {
            if (!canMutate(project, 'modify_us')) {
                return;
            }
            void actions.updateUsStatus(us, newStatusId);
        },
        [actions, project],
    );

    // Inline points change (tgBacklogUsPoints estimation edit). F-CQ-03 — the
    // points editor persists via the hook's `updateUsPoints` thunk (optimistic
    // `replaceUs` + `PATCH /userstories/{id}` { points, version } + reload stats +
    // reload-on-error reconcile). The point VALUES come from in-scope
    // `project.points`, so no common-module estimation service is required. The
    // container gates `modify_us` (archive-aware); `roleId`/`pointId` are chosen
    // in the inline popover rendered by `BacklogTable`.
    const handleUpdatePoints = useCallback(
        (us: UserStory, roleId: number, pointId: number) => {
            if (!canMutate(project, 'modify_us')) {
                return;
            }
            void actions.updateUsPoints(us, roleId, pointId);
        },
        [actions, project],
    );

    /* ====================================================================== *
     * DnD move adapter
     *
     * `BacklogDndContext` emits a `BacklogMovePayload` OBJECT on drop; the hook's
     * `moveUs` thunk takes POSITIONAL arguments. This adapter bridges the two,
     * preserving the exact `{usList, index, sprint, previousUs, nextUs}` shape.
     * ====================================================================== */
    const handleMove = useCallback(
        (payload: BacklogMovePayload) => {
            actions.moveUs(
                payload.usList,
                payload.index,
                payload.sprint,
                payload.previousUs,
                payload.nextUs,
            );
        },
        [actions],
    );

    /* ====================================================================== *
     * Lightbox success handlers (initializeEventHandlers parity, main.coffee:152)
     * ====================================================================== */

    // BulkCreateUsLightbox onSuccess -> usform:bulk:success (main.coffee:158-166):
    // insert the created stories at the chosen position + refresh stats.
    const handleBulkSuccess = useCallback(
        (result: UserStory[], position: 'top' | 'bottom') => {
            actions.bulkCreateUs(result, position);
            setLightbox('none');
        },
        [actions],
    );

    // CreateEditSprintLightbox onCreated -> sprintform:create:success
    // (main.coffee:170-176): reload sprints + stats, and (if the user chose
    // stories to move into the new sprint) move them to the current sprint
    // (sprintform:create:success:callback -> moveToCurrentSprint, main.coffee:815-817).
    const handleSprintCreated = useCallback(
        (_createdMilestone: Milestone, ussToMove?: UserStory[]) => {
            // F-REG-07: delegate to the hook's `finishSprintCreation`, which
            // AWAITS the sprint reload and only THEN moves the chosen stories
            // into `currentSprint || sprints[0]` computed from the REFRESHED
            // list — faithful to `sprintform:create:success` →
            // `moveToCurrentSprint` (main.coffee:170-176,807-817). The previous
            // version fired `reloadSprints()` WITHOUT awaiting it and computed
            // the target from STALE pre-create `currentSprint`/`sprints`, so the
            // stories went to the wrong (old) sprint and the just-created
            // milestone was ignored.
            void actions.finishSprintCreation(ussToMove);
            setLightbox('none');
        },
        [actions],
    );

    // onSaved -> sprintform:edit:success (main.coffee:189-190). The lightbox has
    // already persisted the edit; reload the sprint lists (open + closed, so an
    // edit that flips `closed` is reflected) and the project stats.
    const handleSprintSaved = useCallback(
        (_milestone: Milestone) => {
            actions.reloadSprints();
            actions.reloadClosedSprints();
            actions.reloadStats();
            setLightbox('none');
        },
        [actions],
    );

    // onRemoved -> sprintform:remove:success (main.coffee:192-203). Here the
    // CONTAINER owns the actual removal: the hook's `removeSprint` performs the
    // DELETE and reloads sprints/closed-sprints/userstories/stats.
    const handleSprintRemoved = useCallback(
        (milestone: Milestone) => {
            void actions.removeSprint(milestone.id);
            setLightbox('none');
        },
        [actions],
    );

    const closeLightbox = useCallback(() => {
        setLightbox('none');
    }, []);

    /* ====================================================================== *
     * Guards (rendered AFTER every hook so hook order stays stable)
     * ====================================================================== */

    // A malformed `project-id` attribute: render a minimal, inert host.
    if (!projectIdValid) {
        return <div className="wrapper" data-tg-react-backlog="invalid-project" />;
    }

    // F-AAP-10: a genuine load FAILURE (initial or refresh) with no content to
    // show renders a DISTINCT error state — never the empty-backlog CTA, which
    // would misrepresent a failure as a successful empty screen. The retry
    // button re-runs the centralized, awaited load (`actions.reload`). When the
    // board already has content, a failed live refresh does NOT blank the screen
    // (the flag is set but this gate only fires on an empty board).
    if (loadError && userstories.length === 0) {
        return (
            <div className="wrapper">
                <main className="main scrum">
                    <section className="backlog">
                        <div className="empty-large js-backlog-load-error" role="alert">
                            <p className="title">The backlog could not be loaded.</p>
                            <button
                                type="button"
                                className="button button-green js-backlog-retry"
                                onClick={() => {
                                    void actions.reload();
                                }}
                            >
                                Try again
                            </button>
                        </div>
                    </section>
                </main>
            </div>
        );
    }

    // `is_backlog_activated` gate (loadProject, main.coffee:472-473): once the
    // project has loaded and the backlog is NOT activated, render an empty
    // state. (Before load, `isBacklogActivated` defaults to true, so there is no
    // empty-state flash while data is in flight.)
    if (project && !isBacklogActivated) {
        return (
            <div className="wrapper">
                <main className="main scrum">
                    <section className="backlog">
                        <div className="empty-large">
                            <p className="title">The backlog is not activated for this project.</p>
                        </div>
                    </section>
                </main>
            </div>
        );
    }

    /* ====================================================================== *
     * Render — reproduces backlog.jade + sprints.jade (exact class names/ids)
     * ====================================================================== */

    return (
        <div className="wrapper">
            <main className="main scrum">
                <section className="backlog">
                    {/*
                      Burndown / summary region (tg-toggle-burndown-visibility).
                      F-CQ-04: the `loading`/`error` classes let the retained
                      summary SCSS dim the meter while stats are in flight or a
                      refresh failed (the last-known numbers are kept, never
                      blanked). `aria-busy` mirrors the loading state for AT.
                    */}
                    <div
                        className={`backlog-summary${statsLoading ? ' loading' : ''}${
                            statsError ? ' error' : ''
                        }`}
                        aria-busy={statsLoading}
                    >
                        <div className="summary">
                            {/*
                              F-CQ-04: the REAL backlog-summary progress meter
                              (`ProgressBar`, the port of `tgBacklogProgressBar` +
                              `progress-bar.jade`). It was implemented but never
                              mounted — the container rendered an empty
                              `.summary-progress-bar` placeholder, so the meter was
                              always blank. It now receives the live `stats`
                              (structurally a `ProgressBarStats`) and computes the
                              two sub-bar widths itself; a null `stats` renders 0%
                              bars (its documented pre-load behavior).
                            */}
                            <ProgressBar stats={stats} />

                            <div className="data">
                                <span className="number">
                                    {(stats?.completedPercentage ?? 0)}%
                                </span>
                            </div>

                            {stats?.total_points != null && (
                                <div className="summary-stats">
                                    <span className="number">{formatNumber(stats.total_points)}</span>
                                    <span className="description">Project points</span>
                                </div>
                            )}
                            <div className="summary-stats">
                                <span className="number">{formatNumber(stats?.defined_points)}</span>
                                <span className="description">Defined points</span>
                            </div>
                            <div className="summary-stats">
                                <span className="number">{formatNumber(stats?.closed_points)}</span>
                                <span className="description">Closed points</span>
                            </div>
                            <div className="summary-stats">
                                <span className="number">{formatNumber(stats?.speed)}</span>
                                <span className="description">Points per sprint</span>
                            </div>

                            {!showGraphPlaceholder && (
                                <button
                                    type="button"
                                    className={`stats js-toggle-burndown-visibility-button${
                                        burndownCollapsed ? '' : ' active'
                                    }`}
                                    title="Toggle backlog graph"
                                    onClick={toggleBurndown}
                                >
                                    <TgIcon name="icon-graph" />
                                </button>
                            )}
                        </div>

                        {showGraphPlaceholder && iAmAdmin && (
                            <div className="empty-burndown">
                                <TgIcon name="icon-graph" />
                                <div className="empty-text">
                                    <p className="title">Customize your burndown graph</p>
                                    <p>Configure the project modules to display the burndown chart.</p>
                                </div>
                            </div>
                        )}

                        {/*
                          Burndown CHART (the plotted graph) — DEFERRED per the
                          frozen AAP, not an omission:
                            - The AAP React component manifest (§0.3.1) lists the
                              backlog components explicitly (BacklogTable, Sprint,
                              SprintHeader, ProgressBar, UsEditSelector,
                              UsRolePointsSelector, CreateEditSprintLightbox,
                              BulkCreateUsLightbox) — there is NO burndown-chart
                              component among them.
                            - The legacy chart (`tgBurndownBacklogGraph`, retired
                              backlog/main.coffee:1217-1338) rendered via the
                              jQuery Flot plugin (`element.plot(data, options)`).
                              Flot / any charting library is NOT in the AAP React
                              dependency inventory (§0.5.1), and the Minimal Change
                              Clause (§0.7.1) forbids adding dependencies beyond
                              the migration requirements.
                            - `burndown.scss` is retained as REFERENCE (§0.2.1),
                              so the collapsible container, the toggle button, the
                              admin `empty-burndown` hint and the collapse state
                              (F-CQ-04 collapse) are all reproduced faithfully for
                              layout parity; only the plotted series are absent.
                          The collapse classes (`shown open`) and the toggle above
                          remain fully functional.
                        */}
                        <div
                            className={`graphics-container js-burndown-graph${
                                burndownCollapsed ? '' : ' shown open'
                            }`}
                        >
                            <div className="burndown" />
                        </div>
                    </div>

                    {/* Backlog table + toolbar. */}
                    <div className="backlog-table">
                        <div className="backlog-top">
                            <div className="backlog-menu">
                                <div className="backlog-header">
                                    <div className="backlog-header-title">
                                        <h2>Backlog</h2>
                                        {selectedFilterCount > 0 ? (
                                            <>
                                                <span className="backlog-stories-number squared">
                                                    {userstories.length}
                                                </span>
                                                <span className="backlog-stories-number">
                                                    {totalUserStories} stories (filtered)
                                                </span>
                                            </>
                                        ) : (
                                            <span className="backlog-stories-number">
                                                {totalUserStories} stories
                                            </span>
                                        )}
                                    </div>
                                    <div className="backlog-header-options">
                                        {/* addnewus include (add user story buttons). */}
                                        <div className="new-us">
                                            {mayAddUs && (
                                                <button
                                                    type="button"
                                                    className="btn-small"
                                                    onClick={() => addNewUs('standard')}
                                                >
                                                    <TgIcon name="icon-add" />
                                                    <span className="text">Add</span>
                                                </button>
                                            )}
                                            {mayAddUs && (
                                                <button
                                                    type="button"
                                                    className="btn-icon"
                                                    aria-label="Add user stories in bulk"
                                                    onClick={() => addNewUs('bulk')}
                                                >
                                                    <TgIcon name="icon-bulk" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="backlog-table-options">
                                    <div className="backlog-table-options-start">
                                        <button
                                            type="button"
                                            className={`btn-filter e2e-open-filter${
                                                filtersSidebarOpen ? ' active' : ''
                                            }`}
                                            id="show-filters-button"
                                            onClick={toggleFiltersSidebar}
                                        >
                                            <TgIcon name="icon-filters" />
                                            <span className="text">
                                                {filtersSidebarOpen ? 'Hide filters' : 'Filters'}
                                            </span>
                                            {selectedFilterCount > 0 && (
                                                <span className="selected-filters">
                                                    {selectedFilterCount}
                                                </span>
                                            )}
                                        </button>

                                        <input
                                            type="text"
                                            className="tg-input-search"
                                            value={filterQ}
                                            onChange={handleChangeQ}
                                            placeholder="Search"
                                            aria-label="Search backlog"
                                        />

                                        {userstories.length > 0 && (
                                            <div className="display-tags-button" id="show-tags">
                                                <div className={`check js-check${showTags ? ' active' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        id="show-tags-input"
                                                        checked={showTags}
                                                        onChange={handleToggleTags}
                                                    />
                                                    <div />
                                                </div>
                                                <label htmlFor="show-tags-input">Show tags</label>
                                            </div>
                                        )}
                                    </div>

                                    <div className="backlog-table-options-end">
                                        {hasSelection && currentSprint && (
                                            <button
                                                type="button"
                                                className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                                                id="move-to-current-sprint"
                                                title="Move user stories to the current sprint"
                                                onClick={moveToCurrentSprint}
                                            >
                                                <span className="text">Move to current sprint</span>
                                                <TgIcon name="icon-add-to-sprint" />
                                            </button>
                                        )}
                                        {hasSelection && !currentSprint && (
                                            <button
                                                type="button"
                                                className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                                                id="move-to-latest-sprint"
                                                title="Move user stories to the latest sprint"
                                                onClick={moveToLatestSprint}
                                            >
                                                <span className="text">Move to latest sprint</span>
                                                <TgIcon name="icon-add-to-sprint" />
                                            </button>
                                        )}

                                        {userstories.length > 0 && displayVelocity && mayAddMilestone && (
                                            <button
                                                type="button"
                                                className="btn-filter active velocity-forecasting-btn e2e-velocity-forecasting"
                                                title="Forecasting"
                                                onClick={handleToggleVelocity}
                                            >
                                                <TgIcon name="icon-fold-column" />
                                                <span className="text">Backlog</span>
                                            </button>
                                        )}
                                        {userstories.length > 0 &&
                                            !displayVelocity &&
                                            (stats?.speed ?? 0) > 0 &&
                                            mayAddMilestone && (
                                                <button
                                                    type="button"
                                                    className="btn-filter velocity-forecasting-btn e2e-velocity-forecasting"
                                                    title="Backlog"
                                                    onClick={handleToggleVelocity}
                                                >
                                                    Forecasting
                                                </button>
                                            )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={`backlog-manager${filtersSidebarOpen ? '' : ' expanded'}`}>
                            {filtersSidebarOpen && (
                                <div className="backlog-filter" id="backlog-filter">
                                    {/*
                                      F-CQ-06: the shared `<tg-filter>` panel, reproduced by
                                      the reused presentational `FiltersSidebar`. The retired
                                      `backlog.jade` hosted the identical component here
                                      (`.backlog-filter > tg-filter` with the same
                                      `filters`/`custom-filters`/`selected-filters` inputs and
                                      `on-*` outputs); the data is shaped by the shared
                                      `UsFiltersMixin` port (`../shared/filters`). The Backlog
                                      applies NO facet exclusions, so ALL facets (incl. status)
                                      are offered. Saved custom filters are an AAP-scoped
                                      deferral (see the handler comments above), hence
                                      `customFilters={[]}`.
                                    */}
                                    <FiltersSidebar
                                        filters={filterCategories}
                                        customFilters={[]}
                                        selectedFilters={appliedFilters}
                                        onAddFilter={handleAddFilter}
                                        onRemoveFilter={handleRemoveFilter}
                                        onSelectCustomFilter={handleSelectCustomFilter}
                                        onRemoveCustomFilter={handleRemoveCustomFilter}
                                        onSaveCustomFilter={handleSaveCustomFilter}
                                    />
                                </div>
                            )}

                            <section
                                className={`backlog-table${userstories.length === 0 ? ' hidden' : ''}`}
                            >
                                {project && (
                                    <BacklogDndContext
                                        project={project}
                                        canModifyUs={mayModifyUs}
                                        userstories={userstories}
                                        sprints={sprints}
                                        selectedUsIds={checkedIds}
                                        onMove={handleMove}
                                    >
                                        <BacklogTable
                                            userstories={userstories}
                                            statuses={usStatusList}
                                            project={project}
                                            showTags={showTags}
                                            activeFilters={filtersSidebarOpen}
                                            displayVelocity={displayVelocity}
                                            checkedIds={checkedIds}
                                            visibleUserStories={
                                                displayVelocity ? visibleUserStories : undefined
                                            }
                                            firstUsInBacklog={firstUsInBacklog}
                                            /* F-CQ-05: spinner while a page fetch is in flight. */
                                            loading={loadingUserstories}
                                            /* F-CQ-05: mount the infinite-scroll sentinel ONLY while
                                               more pages remain; omitting `onLoadMore` when
                                               `disablePagination` unmounts the sentinel so no further
                                               fetches are attempted (the last page had no
                                               `x-pagination-next`). */
                                            onLoadMore={
                                                disablePagination ? undefined : actions.loadMore
                                            }
                                            onEditUs={handleEditUs}
                                            onDeleteUs={handleDeleteUs}
                                            onMoveUsToTop={handleMoveUsToTop}
                                            onToggleCheck={handleToggleCheck}
                                            onUpdateStatus={handleUpdateStatus}
                                            onUpdatePoints={handleUpdatePoints}
                                        />
                                    </BacklogDndContext>
                                )}

                                {displayVelocity && (
                                    <div className="forecasting-add-sprint e2e-velocity-forecasting-add">
                                        <span className="forecasting-text">
                                            {forecastNewSprint
                                                ? 'A new sprint is forecasted for these stories.'
                                                : 'These stories fit in the current sprint.'}
                                        </span>
                                        {forecastNewSprint && mayAddMilestone && (
                                            <button
                                                type="button"
                                                className="button btn-link"
                                                onClick={addNewSprint}
                                            >
                                                <TgIcon name="icon-add" />
                                                <span className="text">Add new sprint</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </section>

                            {/* No-match empty state (a filter is active but nothing matches). */}
                            <div
                                className={`empty-backlog js-empty-backlog${
                                    userstories.length > 0 || filterQ.length === 0 ? ' hidden' : ''
                                }`}
                            >
                                <p className="no-match">No user stories match your search.</p>
                                <p className="no-match-help">Try a different search term or filter.</p>
                            </div>

                            {/* Empty-backlog CTA (no stories and no active search). */}
                            <div
                                className={`empty-large js-empty-backlog${
                                    userstories.length > 0 || filterQ.length > 0 ? ' hidden' : ''
                                }`}
                            >
                                <p className="title">Your backlog is empty.</p>
                                {mayAddUs && (
                                    <button
                                        type="button"
                                        className="btn-small"
                                        title="Create a new user story"
                                        onClick={() => addNewUs('standard')}
                                    >
                                        <TgIcon name="icon-add" />
                                        <span className="text">Create your first user story</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Sprint sidebar (sprints.jade). `sidebar` is a non-standard tag in
                    the Jade; rendered as a <div class="sidebar"> for DOM validity. */}
                <div className="sidebar">
                    <section className="sprints">
                        <header className="sprint-header">
                            <h1>
                                {totalMilestones > 0 && (
                                    <span className="number">{totalMilestones}</span>
                                )}
                                <span className="title">Sprints</span>
                            </h1>
                            {totalMilestones > 0 && mayAddMilestone && (
                                <button
                                    type="button"
                                    className="btn-link"
                                    title="Add a new sprint"
                                    onClick={addNewSprint}
                                >
                                    <span>Add</span>
                                    <TgIcon name="icon-add" />
                                </button>
                            )}
                        </header>

                        {totalMilestones === 0 && (
                            <div className="empty-small">
                                <p className="title">You have no sprints yet.</p>
                                {mayAddMilestone && (
                                    <button
                                        type="button"
                                        className="btn-link"
                                        onClick={addNewSprint}
                                    >
                                        <span>New sprint</span>
                                        <TgIcon name="icon-add" />
                                    </button>
                                )}
                            </div>
                        )}

                        {project &&
                            sprints.map((sprint) => (
                                <div className="sprint sprint-open" key={sprint.id}>
                                    <Sprint
                                        project={project}
                                        sprint={sprint}
                                        onEditSprint={handleEditSprint}
                                    />
                                </div>
                            ))}

                        {totalClosedMilestones > 0 && (
                            <button
                                type="button"
                                className="filter-closed-sprints"
                                onClick={toggleClosedSprints}
                            >
                                <TgIcon name="icon-folder" />
                                <span className="text">
                                    {showClosedSprints ? 'Hide closed sprints' : 'Show closed sprints'}
                                </span>
                            </button>
                        )}

                        {project &&
                            showClosedSprints &&
                            closedSprints.map((sprint) => (
                                <div className="sprint sprint-closed" key={sprint.id}>
                                    <Sprint
                                        project={project}
                                        sprint={sprint}
                                        onEditSprint={handleEditSprint}
                                    />
                                </div>
                            ))}
                    </section>
                </div>
            </main>

            {/* Lightboxes (hosted at the wrapper level, toggled by container state). */}
            <div className="lightbox lightbox-generic-bulk">
                {project && (
                    <BulkCreateUsLightbox
                        open={lightbox === 'bulk-us'}
                        projectId={projectId}
                        defaultStatusId={defaultUsStatus}
                        statuses={usStatusList}
                        swimlanes={swimlanesList}
                        isKanbanActivated={isKanbanActivated}
                        defaultSwimlane={defaultSwimlane}
                        onSuccess={handleBulkSuccess}
                        onClose={closeLightbox}
                    />
                )}
            </div>

            <div className="lightbox lightbox-sprint-add-edit">
                <CreateEditSprintLightbox
                    open={lightbox === 'sprint-create' || lightbox === 'sprint-edit'}
                    mode={lightbox === 'sprint-edit' ? 'edit' : 'create'}
                    sprint={editingSprint}
                    projectId={projectId}
                    canDeleteMilestone={mayDeleteMilestone}
                    lastSprint={lastSprint}
                    onCreated={handleSprintCreated}
                    onSaved={handleSprintSaved}
                    onRemoved={handleSprintRemoved}
                    onClose={closeLightbox}
                />
            </div>
        </div>
    );
};
