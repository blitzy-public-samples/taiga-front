/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintHeader
 * ------------
 * Presentational, DOM-preserving React reproduction of the sprint header that
 * the AngularJS Backlog screen rendered for every sprint in the sidebar. It
 * emits the exact class names and element hierarchy that the (unchanged) Taiga
 * SCSS targets, so the migrated React screen is styled pixel-identically without
 * touching any stylesheet. It is a leaf component consumed by `./Sprint.tsx`.
 *
 * Source lineage (reference-only AngularJS originals this reproduces; never edited):
 *   - app/partials/backlog/sprint-header.jade                         -> the `.sprint-summary` markup
 *   - app/coffee/modules/backlog/sprints.coffee (L67-117)             -> BacklogSprintHeaderDirective:
 *       isEditable / isVisible gating, `project-taskboard` URL resolution,
 *       the `moment(date).format("DD MMM YYYY")` date range, and the
 *       closed/total points projection.
 *   - app/coffee/modules/backlog/sprints.coffee (L18-58)              -> BacklogSprintDirective:
 *       the `.compact-sprint` fold toggle and the `.edit-sprint` -> "sprintform:edit"
 *       broadcast; here those are surfaced as the `onToggleCompact` / `onEdit`
 *       callbacks (fold state itself is owned by `./Sprint.tsx`).
 *
 * SCSS this DOM is styled by (unchanged; the visual source of truth):
 *   - app/styles/modules/backlog/sprints.scss
 *       `.sprint-name a` (taskboard link), `.sprint-date`, `.sprint-summary svg`
 *       (edit icon), `.compact-sprint svg.icon` + `.compact-sprint.active`
 *       (arrow fill + rotation), `.sprint .number` / `.sprint .description`
 *       (points), `.sprint ul { text-align: right }`.
 *   The icons are targeted by BARE `svg` / `svg.icon` / `.icon` selectors (NOT a
 *   `tg-svg` host element), so this component emits a plain `<svg class="icon
 *   icon-<name>">` wrapping `<use xlink:href="#icon-<name>">`, exactly matching
 *   the compiled sprite output of the legacy `tg-svg` directive.
 *
 * i18n: every visible string is resolved at render time through the shared
 * `t(...)` helper against the compiled `app/locales/taiga/locale-en.json`
 * bundle, reproducing the AngularJS `translate` output exactly — the fold /
 * edit / taskboard `title=` strings (`BACKLOG.COMPACT_SPRINT`,
 * `BACKLOG.EDIT_SPRINT`, `BACKLOG.GO_TO_TASKBOARD`) and the point labels
 * (`BACKLOG.CLOSED_POINTS`, `BACKLOG.TOTAL_POINTS`). The only user-supplied
 * value rendered is `sprint.name`, which goes through React's default
 * (escaping) text node to preserve XSS-safety.
 */

import type { Milestone, Project } from "../shared/types";
import { taskboardUrl as buildTaskboardUrl } from "../shared/nav/routes";
import { t } from "../shared/i18n/translate";

/**
 * Abbreviated English month names, indexed 0..11 to line up with the numeric
 * month component of a `YYYY-MM-DD` date. Used by {@link formatSprintDate} to
 * reproduce moment's `"MMM"` token for the `"DD MMM YYYY"` format.
 */
const MONTHS: readonly string[] = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/**
 * Left-pad a 1-digit number with a leading zero, reproducing moment's `"DD"`
 * two-digit day token (e.g. `3` -> `"03"`, `12` -> `"12"`).
 */
function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a Taiga milestone date as `DD MMM YYYY` (the resolved value of the
 * `BACKLOG.SPRINTS.DATE` locale key), replacing the legacy
 * `moment(date).format("DD MMM YYYY")` call.
 *
 * Milestone dates arrive from the backend as calendar strings (`YYYY-MM-DD`).
 * This helper parses those components directly rather than via
 * `new Date("YYYY-MM-DD")`, because the string form is interpreted as UTC
 * midnight and rendering it in a negative-offset timezone would shift the day
 * backwards. A non-`YYYY-MM-DD` value falls back to the `Date` parser (using
 * the LOCAL components), and an empty / unparseable value renders as an empty
 * string, matching the "no date" affordance of the source template.
 *
 * @param value - The milestone date, typically `estimated_start` / `estimated_finish`.
 * @returns The `DD MMM YYYY` formatted date, or `""` when there is no valid date.
 */
function formatSprintDate(value: string | undefined): string {
    if (!value) {
        return "";
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        return `${pad2(day)} ${MONTHS[monthIndex]} ${year}`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    return `${pad2(parsed.getDate())} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/**
 * Props for {@link SprintHeader}.
 */
export interface SprintHeaderProps {
    /** The sprint (milestone) this header describes. */
    sprint: Milestone;
    /** The project context, read for permission gating and the taskboard URL. */
    project: Project;
    /**
     * Fold state of the parent sprint row, owned by `./Sprint.tsx`. When `true`
     * the `.compact-sprint` toggle carries the `active` class (the SCSS rotates
     * the arrow from the collapsed 90deg to the expanded 0deg).
     */
    expanded: boolean;
    /**
     * Invoked when the `.compact-sprint` toggle is activated. Mirrors the legacy
     * `.sprint-name > .compact-sprint` click handler that folded/unfolded the
     * sprint table (`sprints.coffee` L42-47).
     */
    onToggleCompact: () => void;
    /**
     * Invoked when the `.edit-sprint` control is activated. Mirrors the legacy
     * `$rootscope.$broadcast("sprintform:edit", sprint)` that opened the
     * create/edit-sprint lightbox (`sprints.coffee` L49-53).
     */
    onEdit: () => void;
}

/**
 * Renders a sprint's header: the fold toggle, the sprint-name taskboard link,
 * the estimated date range, the optional edit-sprint button, and the
 * closed / total points summary.
 *
 * Permission gating is identical to `BacklogSprintHeaderDirective`:
 *   - `isVisible` (`view_milestones`) gates the taskboard link — the `<span>`
 *     carrying `sprint.name` must render for users who can view milestones
 *     (admins have `view_milestones`, so it renders for them).
 *   - `isEditable` (project not archived AND `modify_milestone`) gates the
 *     `.edit-sprint` control.
 * There is NO parallel authorization: the backend remains the single
 * enforcement point; these flags only decide which controls are shown.
 */
export function SprintHeader(props: SprintHeaderProps): JSX.Element {
    const { sprint, project, expanded, onToggleCompact, onEdit } = props;

    // --- Derived values (EXACTLY as BacklogSprintHeaderDirective, L67-99) ---

    // Editable when the project is not archived and the user may modify milestones.
    const isEditable =
        !project.archived_code &&
        project.my_permissions.indexOf("modify_milestone") !== -1;

    // The taskboard link is only shown to users who can view milestones.
    const isVisible = project.my_permissions.indexOf("view_milestones") !== -1;

    // resolve("project-taskboard", {project: slug, sprint: sprint.slug}) — HTML5 plain path.
    const taskboardUrl = buildTaskboardUrl(project.slug, sprint.slug);

    // The taskboard tooltip carries the sprint name. The locale value uses the
    // legacy AngularJS one-time token `{{::name}}`, which the shared `t()` does
    // not interpolate, so the name is substituted here after resolution.
    const goToTaskboardTitle = t("BACKLOG.GO_TO_TASKBOARD").replace(
        "{{::name}}",
        sprint.name ?? "",
    );

    // `sprint.closed_points or 0` / `sprint.total_points or 0` from the directive.
    const closedPoints = sprint.closed_points ?? 0;
    const totalPoints = sprint.total_points ?? 0;

    // "#{start}-#{finish}" with each side formatted as "DD MMM YYYY".
    const estimatedDateRange = `${formatSprintDate(sprint.estimated_start)}-${formatSprintDate(
        sprint.estimated_finish,
    )}`;

    // Class list for the fold toggle; `active` is appended while expanded.
    const compactSprintClassName = `compact-sprint${expanded ? " active" : ""}`;

    return (
        <div className="sprint-summary">
            <div className="sprint-name-container">
                <div className="sprint-name">
                    <button
                        type="button"
                        className={compactSprintClassName}
                        title={t("BACKLOG.COMPACT_SPRINT")}
                        onClick={(event) => {
                            event.preventDefault();
                            onToggleCompact();
                        }}
                    >
                        <svg className="icon icon-arrow-right">
                            <use xlinkHref="#icon-arrow-right" />
                        </svg>
                    </button>
                    {isVisible ? (
                        <a href={taskboardUrl} title={goToTaskboardTitle}>
                            <span>{sprint.name}</span>
                        </a>
                    ) : null}
                </div>
                <div className="sprint-date">{estimatedDateRange}</div>
            </div>
            <div className="sprint-points">
                {isEditable ? (
                    <a
                        className="edit-sprint"
                        href=""
                        title={t("BACKLOG.EDIT_SPRINT")}
                        onClick={(event) => {
                            event.preventDefault();
                            onEdit();
                        }}
                    >
                        <svg className="icon icon-edit">
                            <use xlinkHref="#icon-edit" />
                        </svg>
                    </a>
                ) : null}
                <div className="sprint-info">
                    <ul>
                        <li>
                            <span className="number">{closedPoints}</span>
                            <span className="description">{t("BACKLOG.CLOSED_POINTS")}</span>
                        </li>
                        <li>
                            <span className="number">{totalPoints}</span>
                            <span className="description">{t("BACKLOG.TOTAL_POINTS")}</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
