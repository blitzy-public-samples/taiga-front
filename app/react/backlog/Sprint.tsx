/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint — a single sprint card for the React Backlog screen.
 *
 * Ports these AngularJS units into one React component (like-for-like, no redesign):
 *  - `tgSprint`              (app/coffee/modules/backlog/sprints.coffee L169-180,
 *                             template app/partials/backlog/sprint.jade)
 *  - `tgBacklogSprintHeader` (sprints.coffee L67-117, template sprint-header.jade)
 *  - `tgBacklogSprint`       (sprints.coffee L18-60 — the collapse/expand toggle)
 *  - the per-sprint summary progress bar (`tgProgressBar`,
 *                             app/coffee/modules/common/components.coffee L433-452,
 *                             markup progress-bar.jade)
 *
 * Renders: a collapsible header (name / date / points / edit), a summary
 * progress bar, the sprint's user-story rows (each draggable OUT of the sprint,
 * the whole table droppable so a backlog story can be dropped IN), and a
 * "go to taskboard" button.
 *
 * Drag context is AMBIENT: `BacklogApp` supplies the `<DndContext>` (via
 * ../shared/dnd/DndProvider) and owns drop resolution + persistence
 * (resolveDrop / bulkUpdateMilestone). This component only REGISTERS the
 * draggable rows and the droppable table, and reproduces the exact markup and
 * class names so the already-compiled SCSS (app/styles/modules/backlog/sprints.scss)
 * themes it unchanged — the DOM mirrors sprint.jade + sprint-header.jade +
 * progress-bar.jade.
 */

import { useState, useMemo, useCallback } from "react";
import moment from "moment";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import type { Sprint, Project, UserStory, Epic } from "./types";
import { emojify } from "../shared/emoji/emojify";
import { t } from "../shared/i18n/translate";
import { projectUserStoryUrl, projectTaskboardUrl } from "../shared/nav/urls";
import { Icon } from "../shared/ui/Icon";
import { dueDateColor, dueDateTitle } from "../shared/duedate/dueDate";
import type { DueDateAppearance } from "../shared/duedate/dueDate";

/**
 * Concrete moment format for sprint start/finish dates. Equals the i18n value
 * of `BACKLOG.SPRINTS.DATE` ("DD MMM YYYY"), which the legacy
 * `tgBacklogSprintHeader` fed straight into `moment(...).format(...)`.
 */
// The sprint date format is a localizable moment token string
// (BACKLOG.SPRINTS.DATE). It is resolved through the shared runtime translator
// [M-06] at render time inside the `useMemo` below — never memoized at module
// load, since the React bundle is evaluated before `angular.bootstrap`, so the
// live `$translate` catalog only becomes reachable once the component renders.
const SPRINT_DATE_FMT_KEY = "BACKLOG.SPRINTS.DATE";
const SPRINT_DATE_FMT_FALLBACK = "DD MMM YYYY";

/**
 * Format a numeric point value the way the AngularJS `| number` filter did:
 * grouped thousands using the English locale (e.g. 1234 -> "1,234", 0.5 -> "0.5").
 */
function formatNumber(value: number): string {
    return value.toLocaleString("en");
}

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

export interface SprintProps {
    sprint: Sprint;
    project: Project;
    /**
     * Whether the sprint's rows may be dragged. `BacklogApp` computes this via
     * shared/dnd `isDragEnabled(project)` (== `modify_us` permission AND project
     * not archived). When false, rows are inert but still carry `data-id`.
     */
    dragEnabled: boolean;
    /** Opens the SprintEditLightbox in edit mode (ports the `sprintform:edit` broadcast). */
    onEditSprint: (sprint: Sprint) => void;
}

/* -------------------------------------------------------------------------- */
/* Story row (child) — isolates the useDraggable hook call                    */
/* -------------------------------------------------------------------------- */

interface SprintStoryRowProps {
    us: UserStory;
    projectSlug: string;
    /** `modify_us` permission — gates the `readonly` row modifier. */
    canModifyUs: boolean;
    /** Mirror of SprintProps.dragEnabled — gates the drag affordance. */
    dragEnabled: boolean;
    /**
     * [M-08] Project-level due-date threshold config (`project.us_duedates`).
     * `undefined` ⇒ the shared helper's default thresholds. Threaded from the
     * parent `Sprint` (which owns the `project`) so the sprint row reproduces
     * the same severity color / tooltip as the backlog row and the card.
     */
    dueDateConfig: DueDateAppearance[] | undefined;
}

/**
 * One user-story row inside a sprint. Extracted into its own component because
 * React hooks (`useDraggable`) cannot be called inside a `.map()` callback —
 * they must run at the top level of a component.
 *
 * Ports the `div.row.milestone-us-item-row` markup from sprint.jade.
 */
function SprintStoryRow({ us, projectSlug, canModifyUs, dragEnabled, dueDateConfig }: SprintStoryRowProps): JSX.Element {
    // Register the row as a draggable node. Called unconditionally (Rules of Hooks);
    // the drag affordance itself is applied only when `dragEnabled` (below).
    const { attributes, listeners, setNodeRef } = useDraggable({ id: us.id });

    // [N] Register the SAME row as a DROPPABLE (numeric id === us.id) so
    // DndProvider's row-preferring collision detection and single-step keyboard
    // coordinate getter can target an individual story row rather than falling
    // through to the sprint-container droppable (which lands the item at the
    // END). `resolveDrop` in BacklogApp already lands a numeric `overId` at that
    // row's position, so registering the droppable is what enables single-step
    // (down-one / up-one) keyboard reordering AND precise pointer drops.
    const { setNodeRef: setRowDroppableRef } = useDroppable({ id: us.id });

    // Merge the draggable and droppable refs onto one DOM node. @dnd-kit hands
    // each hook its own ref setter; a row must be BOTH to support "drop onto a
    // sibling row", so we fan the node out to both setters.
    const setRowRef = useCallback(
        (node: HTMLElement | null) => {
            setNodeRef(node);
            setRowDroppableRef(node);
        },
        [setNodeRef, setRowDroppableRef],
    );

    // Row modifier classes — port ng-class={closedRow, blockedRow} +
    // tg-class-permission="{'readonly': '!modify_us'}" from sprint.jade.
    const rowClassName =
        "row milestone-us-item-row" +
        (us.is_closed ? " closedRow" : "") +
        (us.is_blocked ? " blockedRow" : "") +
        (!canModifyUs ? " readonly" : "");

    // Name-link modifier classes — port ng-class={closed, blocked}.
    const usNameClassName =
        "us-name clickable" +
        (us.is_closed ? " closed" : "") +
        (us.is_blocked ? " blocked" : "");

    // Points column modifier classes — port ng-class={closed, blocked}.
    const pointsColumnClassName =
        "column-points width-1" +
        (us.is_closed ? " closed" : "") +
        (us.is_blocked ? " blocked" : "");

    // Apply drag attributes/listeners ONLY when dragging is enabled, so archived
    // projects (or users lacking `modify_us`) get a non-draggable, inert row.
    const dragHandleProps = dragEnabled ? { ...attributes, ...listeners } : {};

    return (
        <div
            ref={setRowRef}
            // `data-id` is ALWAYS present (even when not draggable): DndProvider.resolveDrop
            // reads it from the DOM to compute the ordered id list on drop.
            data-id={us.id}
            className={rowClassName}
            {...dragHandleProps}
        >
            <div className="column-us">
                <a
                    className={usNameClassName}
                    // [M-07] baseHref-aware HTML5 route (NOT a `#`-fragment):
                    // the legacy `tg-nav="project-userstories-detail"` navigated
                    // for real under HTML5 mode. `projectUserStoryUrl`
                    // reproduces the `$navUrls` template + baseHref prefix.
                    href={projectUserStoryUrl(projectSlug, us.ref)}
                >
                    <span className="us-ref-text">#{us.ref}</span>
                    {/*
                      [T] Subject is rendered as PLAIN TEXT: `emojify` swaps
                      `:shortcode:` for the unicode emoji CHARACTER (never HTML), and
                      React escapes the result, so a subject like
                      "<img src=x onerror=...>" appears verbatim and can never execute.
                      NEVER use dangerouslySetInnerHTML here — this restores the legacy
                      `| emojify` rendering without reopening the XSS surface.
                    */}
                    <span className="us-name-text">{emojify(us.subject)}</span>
                </a>
                {us.epics && us.epics.length > 0 ? (
                    // tg-belong-to-epics format="pill" — one colored pill per epic.
                    <div className="us-epic-container">
                        {us.epics.map((epic: Epic) => (
                            <div
                                key={epic.ref}
                                className="belong-to-epic-pill"
                                style={{ background: epic.color }}
                                title={`#${epic.ref} ${epic.subject}`}
                            />
                        ))}
                    </div>
                ) : null}
                {/* [M-08] Due-date parity — reproduces the legacy
                    `tg-due-date.due-date` (icon-only variant, `due-date-icon.jade`):
                    an `icon-clock` whose fill is the severity color and whose
                    tooltip is the formatted date + status name. `.due-date`
                    (wrapper) and `.due-date-icon` (icon) class names match the
                    compiled SCSS (sprints.scss L243-254) so it themes unchanged. */}
                {us.due_date ? (
                    <span className="due-date">
                        <Icon
                            name="icon-clock"
                            wrapperClass="due-date-icon"
                            fill={dueDateColor(us.due_date, dueDateConfig) ?? undefined}
                            title={t("COMMON.CARD.DUE_DATE", "Due date: {{date}}", {
                                date: dueDateTitle(us.due_date, dueDateConfig),
                            })}
                        />
                    </span>
                ) : null}
            </div>
            {us.total_points != null ? (
                <div className={pointsColumnClassName}>
                    <span className="points-container">{formatNumber(us.total_points)}</span>
                </div>
            ) : null}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Sprint (main component)                                                    */
/* -------------------------------------------------------------------------- */

export function Sprint({ sprint, project, dragEnabled, onEditSprint }: SprintProps): JSX.Element {
    // Collapse state — ports tgBacklogSprint: closed sprints start collapsed,
    // open sprints start expanded. When EXPANDED the arrow button gets `active`
    // and the sprint-table gets `open` (mirrors the legacy toggleSprint()).
    const [collapsed, setCollapsed] = useState<boolean>(sprint.closed);

    const toggleCollapsed = useCallback(() => {
        setCollapsed((current) => !current);
    }, []);

    // Register the sprint table as a droppable target so a backlog story can be
    // dropped INTO this sprint. The id encodes the sprint so resolveDrop can map
    // it back to a milestone move.
    const { setNodeRef: setDroppableRef } = useDroppable({ id: `sprint:${sprint.id}` });

    // Derived header/permission/progress view-model (ports tgBacklogSprintHeader.render).
    const view = useMemo(() => {
        // canModifyUs gates draggability + the `readonly` row class.
        const canModifyUs = project.my_permissions.includes("modify_us");
        // isEditable gates the `.edit-sprint` control.
        const isEditable =
            !project.archived_code && project.my_permissions.includes("modify_milestone");
        // isVisible gates the taskboard links (header name link + bottom button).
        const isVisible = project.my_permissions.includes("view_milestones");

        // [M-07] baseHref-aware HTML5 route (navUrls key "project-taskboard"),
        // NOT a `#`-fragment: the legacy `tgBacklogSprintHeader` resolved this
        // via `$navUrls.resolve` and HTML5-mode routing performed a real
        // navigation. `projectTaskboardUrl` reproduces the exact template +
        // baseHref prefix.
        const taskboardUrl = projectTaskboardUrl(project.slug, sprint.slug);

        const sprintDateFmt = t(SPRINT_DATE_FMT_KEY, SPRINT_DATE_FMT_FALLBACK);
        const start = moment(sprint.estimated_start).format(sprintDateFmt);
        const finish = moment(sprint.estimated_finish).format(sprintDateFmt);
        const estimatedDateRange = `${start} - ${finish}`;

        const closedPoints = sprint.closed_points || 0;
        const totalPoints = sprint.total_points || 0;

        // Progress — ports tgProgressBar: clamp(0..100) of 100*closed/total, /0 guarded.
        const pct = totalPoints > 0 ? (100 * closedPoints) / totalPoints : 0;
        const clampedPct = Math.min(100, Math.max(0, pct));
        const isFull = pct >= 100;

        return {
            canModifyUs,
            isEditable,
            isVisible,
            taskboardUrl,
            estimatedDateRange,
            closedPoints,
            totalPoints,
            clampedPct,
            isFull,
        };
    }, [project, sprint]);

    // [M-08] Project-level due-date threshold configuration (`us_duedates`),
    // falling back to the shared helper's defaults when the project doesn't
    // define one (mirrors `DueDateService.getStatus`). Memoized so each
    // `SprintStoryRow` receives a stable reference.
    const dueDateConfig = useMemo<DueDateAppearance[] | undefined>(
        () =>
            Array.isArray(project.us_duedates)
                ? (project.us_duedates as DueDateAppearance[])
                : undefined,
        [project],
    );

    const hasStories = sprint.user_stories.length > 0;

    // .sprint-table class — mirror ng-class {'sprint-empty-wrapper': !length} plus the
    // `open` state class the legacy toggleSprint() added when the sprint is expanded.
    const sprintTableClassName =
        "sprint-table" +
        (!hasStories ? " sprint-empty-wrapper" : "") +
        (!collapsed ? " open" : "");

    return (
        <>
            {/* === header (ports tg-backlog-sprint-header / sprint-header.jade) === */}
            <header>
                <div className="sprint-summary">
                    <div className="sprint-name-container">
                        <div className="sprint-name">
                            <button
                                className={`compact-sprint${!collapsed ? " active" : ""}`}
                                title={t("BACKLOG.COMPACT_SPRINT", "Compact Sprint")}
                                // [Q] Icon-only chevron toggle: give it an accessible
                                // name and expose its expanded/collapsed state.
                                aria-label={t("BACKLOG.COMPACT_SPRINT", "Compact Sprint")}
                                aria-expanded={!collapsed}
                                onClick={toggleCollapsed}
                                type="button"
                            >
                                {/* tg-svg icon-arrow-right (decorative) */}
                                <svg className="icon icon-arrow-right" aria-hidden="true" focusable="false">
                                    <use xlinkHref="#icon-arrow-right" href="#icon-arrow-right" />
                                </svg>
                            </button>
                            {view.isVisible ? (
                                <a
                                    href={view.taskboardUrl}
                                    title={t("BACKLOG.GO_TO_TASKBOARD", "Go to the taskboard of {{name}}", {
                                        name: sprint.name,
                                    })}
                                >
                                    <span>{sprint.name}</span>
                                </a>
                            ) : (
                                // Keep the name visible even without the view_milestones permission.
                                <span>{sprint.name}</span>
                            )}
                        </div>
                        <div className="sprint-date">{view.estimatedDateRange}</div>
                    </div>
                    <div className="sprint-points">
                        {view.isEditable ? (
                            <a
                                className="edit-sprint"
                                href=""
                                title={t("BACKLOG.EDIT_SPRINT", "Edit Sprint")}
                                // [Q] Icon-only edit control rendered as an anchor:
                                // expose button semantics + an accessible name.
                                role="button"
                                aria-label={t("BACKLOG.EDIT_SPRINT", "Edit Sprint")}
                                onClick={(event) => {
                                    event.preventDefault();
                                    onEditSprint(sprint);
                                }}
                            >
                                {/* tg-svg icon-edit (decorative) */}
                                <svg className="icon icon-edit" aria-hidden="true" focusable="false">
                                    <use xlinkHref="#icon-edit" href="#icon-edit" />
                                </svg>
                            </a>
                        ) : null}
                        <div className="sprint-info">
                            <ul>
                                <li>
                                    <span className="number">{formatNumber(view.closedPoints)}</span>
                                    <span className="description">{t("BACKLOG.CLOSED_POINTS", "closed")}</span>
                                </li>
                                <li>
                                    <span className="number">{formatNumber(view.totalPoints)}</span>
                                    <span className="description">{t("BACKLOG.TOTAL_POINTS", "total")}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </header>

            {/* === summary progress bar (tg-progress-bar="100 * closed_points / total_points") === */}
            <div className="summary-progress-wrapper">
                <div className={`sprint-progress-bar${view.isFull ? " full" : ""}`}>
                    <div
                        className={`current-progress${view.isFull ? " full" : ""}`}
                        style={{ width: `${view.clampedPct}%` }}
                    />
                </div>
            </div>

            {/* === sprint table (droppable target; id = `sprint:${sprint.id}`) === */}
            <div ref={setDroppableRef} className={sprintTableClassName}>
                {!hasStories ? (
                    <div className="sprint-empty">
                        {view.canModifyUs ? (
                            <span>
                                {t(
                                    "BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT",
                                    "Drop here Stories from your backlog to start a new sprint",
                                )}
                            </span>
                        ) : (
                            <span>
                                {t(
                                    "BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS",
                                    "This sprint has no user stories",
                                )}
                            </span>
                        )}
                    </div>
                ) : (
                    sprint.user_stories.map((us: UserStory) => (
                        <SprintStoryRow
                            key={us.id}
                            us={us}
                            projectSlug={project.slug}
                            canModifyUs={view.canModifyUs}
                            dragEnabled={dragEnabled}
                            dueDateConfig={dueDateConfig}
                        />
                    ))
                )}
            </div>

            {/* === go-to-taskboard button (tg-check-permission="view_milestones") === */}
            {view.isVisible ? (
                <a
                    className="btn-small"
                    href={view.taskboardUrl}
                    title={t("BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD", 'Go to Taskboard of "{{name}}"', {
                        name: sprint.name,
                    })}
                >
                    <span>{t("BACKLOG.SPRINTS.LINK_TASKBOARD", "Sprint Taskboard")}</span>
                </a>
            ) : null}
        </>
    );
}
