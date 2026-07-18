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
import { CreateEditSprintLightbox } from './components/CreateEditSprintLightbox';
import { BulkCreateUsLightbox } from './components/BulkCreateUsLightbox';
import { canModifyUs, canAddUs, canAddMilestone, can } from '../shared/permissions';
import type { Project, UserStory, Milestone, Status } from '../shared/types';

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

/**
 * A small inline icon placeholder that preserves the AngularJS `tg-svg`
 * `svg-icon="icon-*"` class contract so the retained SCSS (which targets these
 * `icon-*` class names) styles the React DOM identically. It is purely
 * decorative, hence `aria-hidden`.
 */
const TgIcon: FC<{ name: string }> = ({ name }) => (
    <span className={`icon ${name}`} aria-hidden="true" />
);

/* ========================================================================== *
 * The container component
 * ========================================================================== */

export const BacklogApp: FC<BacklogAppProps> = (props) => {
    // Coerce the string `project-id` attribute to a number ONCE (mount passes
    // strings). `Number.isFinite` guards a missing / malformed attribute.
    const projectId = Number(props.projectId);
    const projectIdValid = Number.isFinite(projectId);

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

    /* ---- Derived values ---------------------------------------------------- */

    const usStatusList = useMemo(() => readSortedStatuses(project), [project]);
    const defaultUsStatus = readDefaultUsStatus(project, usStatusList);
    const isKanbanActivated = readIsKanbanActivated(project);
    const defaultSwimlane = readDefaultSwimlane(project);
    const iAmAdmin = readIsAdmin(project);

    // Number of applied backend filters (the AngularJS `selectedFilters.length`).
    const selectedFilterCount = Object.keys(selectedFilters).length;

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
    const mayDeleteMilestone = can(project, 'delete_milestone');

    /* ====================================================================== *
     * Toolbar / action callbacks
     * ====================================================================== */

    // addNewUs (main.coffee:683-691). SCOPE NOTE: the standard single-US create
    // flow used the shared AngularJS `genericform:new` form, which is OUT OF
    // SCOPE (not migrated). Both the standard and bulk paths therefore route to
    // the in-scope `BulkCreateUsLightbox` — the only migrated create surface.
    const addNewUs = useCallback((_type: 'standard' | 'bulk') => {
        setLightbox('bulk-us');
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
        void actions.moveToSprint(checkedUserstories, target.id);
        clearSelection();
    }, [actions, checkedUserstories, currentSprint, sprints, clearSelection]);

    // Move-to-latest-sprint (moveToLatestSprint, main.coffee:812-813):
    // target = sprints[0].
    const moveToLatestSprint = useCallback(() => {
        if (checkedUserstories.length === 0 || sprints.length === 0) {
            return;
        }
        void actions.moveToSprint(checkedUserstories, sprints[0].id);
        clearSelection();
    }, [actions, checkedUserstories, sprints, clearSelection]);

    // toggleTags (main.coffee:501). The AngularJS source persisted the flag via
    // `rs.userstories.storeShowTags`; the migrated `useBacklog` hook owns
    // `showTags` in reducer state and does NOT re-read localStorage on mount, so
    // the container simply dispatches the toggle (documented deviation — the
    // persisted value is not re-hydrated, matching the state-owned design).
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

    // Delete a story (deleteUserStory, main.coffee:662-681). SCOPE NOTE: the
    // confirm dialog + backend DELETE belong to the OUT-OF-SCOPE generic US
    // surface. The migrated in-scope behaviour is the optimistic removal from
    // the backlog list (the source's `@scope.userstories = _.without(...)`),
    // dispatched via the hook's `removeUsOptimistic`.
    const handleDeleteUs = useCallback(
        (us: UserStory) => {
            actions.removeUsOptimistic(us.id);
        },
        [actions],
    );

    // Edit a story. SCOPE NOTE: the generic US edit form (`genericform:edit`) is
    // OUT OF SCOPE (not migrated). The row's detail link (the still-AngularJS US
    // detail screen) handles viewing/editing, so this inline affordance is a
    // documented no-op.
    const handleEditUs = useCallback((_us: UserStory) => {
        /* no-op: the generic US edit form is out of migration scope */
    }, []);

    // Inline status change. SCOPE NOTE: the single-US save endpoint is not part
    // of the whitelisted shared API (generic US save is out of scope), so this
    // is a documented no-op — the status popover renders for visual fidelity but
    // does not persist a change here.
    const handleUpdateStatus = useCallback(
        (_us: UserStory, _newStatusId: number) => {
            /* no-op: single-US status persistence is out of migration scope */
        },
        [],
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
        (_milestone: Milestone, ussToMove?: UserStory[]) => {
            actions.reloadSprints();
            actions.reloadStats();
            if (ussToMove && ussToMove.length > 0) {
                const target = currentSprint ?? sprints[0];
                if (target) {
                    void actions.moveToSprint(ussToMove, target.id);
                }
            }
            setLightbox('none');
        },
        [actions, currentSprint, sprints],
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
                    {/* Burndown / summary region (tg-toggle-burndown-visibility). */}
                    <div className="backlog-summary">
                        <div className="summary">
                            {/* Progress bar container — styled by the retained summary SCSS. */}
                            <div className="summary-progress-bar" />

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
                          Burndown chart intentionally not reproduced per AAP component
                          scope (§0.3.1); container preserved for layout fidelity.
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
                                      The custom-filter chip UI (`tg-filter`) is out of
                                      migration scope; the container is preserved for
                                      layout fidelity.
                                    */}
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
                                            onEditUs={handleEditUs}
                                            onDeleteUs={handleDeleteUs}
                                            onMoveUsToTop={handleMoveUsToTop}
                                            onToggleCheck={handleToggleCheck}
                                            onUpdateStatus={handleUpdateStatus}
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
