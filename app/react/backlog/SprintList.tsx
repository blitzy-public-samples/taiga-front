/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintList — the sprint sidebar section of the React Backlog screen.
 *
 * Ports these AngularJS units into one presentational React component
 * (like-for-like, no redesign):
 *  - `app/partials/includes/modules/sprints.jade` (the section markup)
 *  - `tgBacklogSprint`                    (sprints.coffee L18-60 — its compact
 *                                          collapse/expand toggle + `sprint-closed`
 *                                          class are folded into `Sprint.tsx`)
 *  - `tgBacklogToggleClosedSprintsVisualization`
 *                                         (sprints.coffee L124-167 — the
 *                                          "show/hide closed sprints" reveal toggle)
 *  - the controller's `openSprints()` / `closedSprints()` selection
 *                                         (backlog/main.coffee)
 *
 * Renders, in order:
 *  1. a header with the total sprint count and a gated "add sprint" action,
 *  2. an empty state (only when there are zero sprints),
 *  3. the OPEN sprints list,
 *  4. a "show/hide closed sprints" toggle (only when closed sprints exist),
 *  5. the CLOSED sprints list (only once revealed).
 *
 * Each sprint card is a `<Sprint>` (imported as `SprintCard` to avoid colliding
 * with the `Sprint` domain type). This component is purely presentational: which
 * sprints are open vs closed, the counts, and the `sprint_order` sort are all
 * prepared upstream in `useBacklogState` / `BacklogApp`; the drag wiring and the
 * per-card compact toggle live in `Sprint.tsx`.
 *
 * The exact class names and DOM structure of `sprints.jade` are reproduced so the
 * already-compiled SCSS (`app/styles/modules/backlog/sprints.scss`) themes the
 * output unchanged. String literals are the resolved English values of the
 * referenced i18n keys (keys noted in comments), matching the convention used by
 * the sibling `Sprint.tsx`.
 */

import type { Project, Sprint } from "./types";
import { Sprint as SprintCard } from "./Sprint";
import { t } from "../shared/i18n/translate";

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

export interface SprintListProps {
    /** The current project — supplies `my_permissions` and is forwarded to each card. */
    project: Project;
    /**
     * Open (not-closed) sprints, already sorted by `sprint_order` upstream.
     * Rendered in the given order.
     */
    openSprints: Sprint[];
    /**
     * Closed sprints, already sorted upstream. Only rendered when
     * `closedSprintsVisible` is `true`.
     */
    closedSprints: Sprint[];
    /**
     * Total number of sprints (`stats.total_milestones`). `null` while stats are
     * still loading. Gates the header count/add action and the empty state.
     */
    totalMilestones: number | null;
    /**
     * Total number of CLOSED sprints. `null`/`0` hides the closed-sprints toggle.
     */
    totalClosedMilestones: number | null;
    /** Whether the closed-sprints list is currently revealed. */
    closedSprintsVisible: boolean;
    /** Forwarded to each `<Sprint>` — whether its story rows may be dragged. */
    dragEnabled: boolean;
    /** Opens the SprintEditLightbox in create mode (ports the `sprintform:create` broadcast). */
    onAddNewSprint: () => void;
    /** Opens the SprintEditLightbox in edit mode for the given sprint. */
    onEditSprint: (sprint: Sprint) => void;
    /** Loads/unloads the closed sprints and toggles their visibility (owned by BacklogApp). */
    onToggleClosedSprints: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SprintList(props: SprintListProps): JSX.Element {
    const {
        project,
        openSprints,
        closedSprints,
        totalMilestones,
        totalClosedMilestones,
        closedSprintsVisible,
        dragEnabled,
        onAddNewSprint,
        onEditSprint,
        onToggleClosedSprints,
    } = props;

    // Gates the "add sprint" actions — ports tg-check-permission="add_milestone".
    const canAddMilestone = project.my_permissions.includes("add_milestone");

    // The empty-state image is served relative to the app base href. `taigaConfig`
    // is seeded on `window` by the AngularJS shell before the React roots mount;
    // read it defensively (it is absent under jsdom) without importing the shared
    // config adapter, which is not a declared dependency of this component.
    const baseHref =
        (window as unknown as { taigaConfig?: { baseHref?: string } }).taigaConfig
            ?.baseHref ?? "";

    // Closed-sprints toggle label — ports tgBacklogToggleClosedSprintsVisualization,
    // which swapped `.text` to HIDE when the reloaded closed list was non-empty and
    // SHOW otherwise. Derived directly from visibility + loaded count here.
    const closedSprintsLabel =
        closedSprintsVisible && closedSprints.length > 0
            ? t("BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS", "Hide closed sprints")
            : t("BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS", "Show closed sprints");

    return (
        <section className="sprints">
            <header className="sprint-header">
                <h1>
                    {/* ng-if="totalMilestones": the count badge is shown only when there is at least one sprint. */}
                    {totalMilestones ? (
                        <span className="number">{totalMilestones}</span>
                    ) : null}
                    <span className="title">{t("BACKLOG.SPRINTS.TITLE", "SPRINTS")}</span>
                </h1>
                {/* ng-if="totalMilestones" + tg-check-permission="add_milestone" */}
                {!!totalMilestones && canAddMilestone ? (
                    <a
                        className="btn-link"
                        href=""
                        title={t("BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT", "Add a sprint")}
                        onClick={(event) => {
                            event.preventDefault();
                            onAddNewSprint();
                        }}
                    >
                        {/* literal "Add" in sprints.jade (no BACKLOG.SPRINTS.ADD key) */}
                        <span>Add</span>
                        {/* tg-svg icon-add (decorative) */}
                        <svg className="icon icon-add" aria-hidden="true" focusable="false">
                            <use xlinkHref="#icon-add" href="#icon-add" />
                        </svg>
                    </a>
                ) : null}
            </header>

            {/* ng-if="totalMilestones === 0": empty state (distinct from the still-loading `null`). */}
            {totalMilestones === 0 ? (
                <div className="empty-small">
                    <img
                        src={`${baseHref}images/empty/empty_sprint.png`}
                        alt={t("BACKLOG.SPRINTS.EMPTY", "There are no sprints yet")}
                    />
                    <p className="title">{t("BACKLOG.SPRINTS.EMPTY", "There are no sprints yet")}</p>
                    {/* tg-check-permission="add_milestone" */}
                    {canAddMilestone ? (
                        <a
                            className="btn-link"
                            href=""
                            title=""
                            onClick={(event) => {
                                event.preventDefault();
                                onAddNewSprint();
                            }}
                        >
                            <span>{t("BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT", "Add a sprint")}</span>
                            {/* tg-svg icon-add (decorative) */}
                            <svg className="icon icon-add" aria-hidden="true" focusable="false">
                                <use xlinkHref="#icon-add" href="#icon-add" />
                            </svg>
                        </a>
                    ) : null}
                </div>
            ) : null}

            {/* OPEN sprints — ng-repeat="sprint in ctrl.openSprints() track by sprint.id" */}
            {openSprints.map((sprint) => (
                <div key={sprint.id} className="sprint sprint-open">
                    <SprintCard
                        sprint={sprint}
                        project={project}
                        dragEnabled={dragEnabled}
                        onEditSprint={onEditSprint}
                    />
                </div>
            ))}

            {/* ng-if="totalClosedMilestones": the reveal toggle only when closed sprints exist. */}
            {!!totalClosedMilestones ? (
                <a
                    className="filter-closed-sprints"
                    href=""
                    onClick={(event) => {
                        event.preventDefault();
                        onToggleClosedSprints();
                    }}
                >
                    {/* tg-svg icon-folder (decorative) */}
                    <svg className="icon icon-folder" aria-hidden="true" focusable="false">
                        <use xlinkHref="#icon-folder" href="#icon-folder" />
                    </svg>
                    <span className="text">{closedSprintsLabel}</span>
                </a>
            ) : null}

            {/* CLOSED sprints — ng-repeat="sprint in closedSprints track by sprint.id", revealed on demand. */}
            {closedSprintsVisible
                ? closedSprints.map((sprint) => (
                      <div key={sprint.id} className="sprint sprint-closed">
                          <SprintCard
                              sprint={sprint}
                              project={project}
                              dragEnabled={dragEnabled}
                              onEditSprint={onEditSprint}
                          />
                      </div>
                  ))
                : null}
        </section>
    );
}
