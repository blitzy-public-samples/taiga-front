/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintHeader — per-sprint summary header (render-only).
 *
 * React port of the AngularJS `tgBacklogSprintHeader` directive
 * (`BacklogSprintHeaderDirective` in `app/coffee/modules/backlog/sprints.coffee`,
 * original lines 67-117) together with its template
 * (`app/partials/backlog/sprint-header.jade`). Both AngularJS sources are
 * DELETE-marked by the migration and are reproduced here byte-for-byte in DOM
 * and derived-value behaviour.
 *
 * The directive was hosted by the sprint template
 * (`app/partials/backlog/sprint.jade`) as `header(tg-backlog-sprint-header)`, so
 * this component is nested inside `Sprint.tsx` (the React port of that template).
 * `Sprint` owns the collapse/expand state and the create/edit-sprint lightbox;
 * this header merely renders the summary and lifts two user intents upward:
 *   - clicking the `.compact-sprint` arrow  -> `onToggleCollapse()`   (parent folds/unfolds the sprint table)
 *   - clicking the `.edit-sprint` pencil     -> `onEditSprint(sprint)` (parent opens `CreateEditSprintLightbox` in edit mode)
 *
 * These mirror the directive's original `$rootScope` broadcasts:
 *   - the `.sprint-name > .compact-sprint` click that `BacklogSprintDirective`
 *     handled by `toggleSprint($el)` + `slideToggle`, and
 *   - the `.edit-sprint` click that broadcast `"sprintform:edit"` with the sprint.
 *
 * Pure presentational component: it receives `sprint` + `project` + callbacks via
 * props, holds NO business state, and performs NO fetch / `/api/v1/` /
 * WebSocket work. It reuses the EXACT existing SCSS class names
 * (`sprint-summary`, `sprint-name-container`, `sprint-name`, `compact-sprint`,
 * `sprint-date`, `sprint-points`, `edit-sprint`, `sprint-info`, `number`,
 * `description`, verified in `app/styles/modules/backlog/sprints.scss`) for pixel
 * fidelity — it neither imports nor rewrites any SCSS.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement; the only `react` import is the type-only `FC` /
 * `MouseEvent` (erased at compile time, contributing zero runtime import).
 */

import type { FC, MouseEvent } from 'react';

// `moment` is a RETAINED dependency (AAP §0.5.1). It is used here solely to
// format the sprint's estimated start/finish dates, mirroring the directive's
// `moment(...).format(prettyDate)` calls. `esModuleInterop` (root tsconfig)
// makes the default import valid.
// F-PERF-01: use the shell's already-loaded global Moment (see shared/moment.ts) so
// esbuild does not bundle a second ~60 KB copy of Moment into react.js.
import moment from '../../shared/moment';

import { can, canMutate } from '../../shared/permissions';

import type { Milestone, Project } from '../../shared/types';
// F-UI-02: the ONE shared SVG-sprite primitive replaces this file's local
// `tg-svg` host + `svgIcon` helper. F-UI-06: `translate` bridges the button/link
// titles and the closed/total labels to the shell's angular-translate service
// (English fallback for shell-less renders).
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

/**
 * Reproduce the AngularJS `| number` filter used by the two points cells
 * (`{{::closedPoints | number}}` / `{{::totalPoints | number}}`). The filter
 * applies locale thousands-grouping; `toLocaleString('en-US')` matches it for
 * both the common small-integer case (rendered as the plain integer) and large
 * values (grouped, e.g. `1,234`). The English locale is pinned explicitly so the
 * grouping is deterministic and does not depend on the host environment.
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Props for {@link SprintHeader}.
 *
 * `sprint` and `project` are the same objects the container (`BacklogApp` ->
 * `Sprint`) already holds; the header derives every displayed value and both
 * permission gates from them (it stores nothing). The two callbacks lift the
 * user's intents up to the parent `Sprint`, replacing the directive's
 * `$rootScope` broadcasts.
 */
export interface SprintHeaderProps {
  /** The sprint (milestone) this header summarises. */
  sprint: Milestone;
  /** The owning project; supplies `slug`, `archived_code`, and `my_permissions`. */
  project: Project;
  /**
   * Fires when the `.edit-sprint` pencil is clicked (the parent opens
   * `CreateEditSprintLightbox` in edit mode). Reproduces the directive's
   * `$rootScope.$broadcast("sprintform:edit", sprint)`.
   */
  onEditSprint: (sprint: Milestone) => void;
  /**
   * Fires when the `.compact-sprint` arrow is clicked (the parent `Sprint`
   * toggles its collapsed/expanded state). Reproduces the directive's
   * `.sprint-name > .compact-sprint` click that toggled the sprint table.
   */
  onToggleCollapse: () => void;
}

/**
 * The sprint summary header.
 *
 * Derived values reproduce `BacklogSprintHeaderDirective` EXACTLY:
 *   - `isEditable = !project.archived_code && can(project, 'modify_milestone')`
 *     (mirrors `!archived_code && my_permissions.indexOf("modify_milestone") != -1`).
 *   - `isVisible  = can(project, 'view_milestones')`
 *     (mirrors `my_permissions.indexOf("view_milestones") != -1`).
 *   - `taskboardUrl = /project/{project.slug}/taskboard/{sprint.slug}`
 *     (mirrors `$navUrls.resolve("project-taskboard", {project: slug, sprint: sprint.slug})`,
 *     the Taiga HTML5 route). `sprint.slug` is optional on the type, so it is
 *     guarded with `?? ''`.
 *   - `estimatedDateRange = "{start}-{finish}"` where each side is
 *     `moment(date).format('DD MMM YYYY')` — `prettyDate` is the English of
 *     `BACKLOG.SPRINTS.DATE`. Note: NO space around the hyphen (verbatim
 *     reproduction of the directive's `"#{start}-#{finish}"`).
 *   - `closedPoints = sprint.closed_points || 0`, `totalPoints = sprint.total_points || 0`.
 *   - `name = sprint.name`.
 *
 * Render-only: permission gates decide whether the taskboard link (`isVisible`)
 * and the edit pencil (`isEditable`) appear; nothing here mutates state or hits
 * the network.
 */
export const SprintHeader: FC<SprintHeaderProps> = (props) => {
  const { sprint, project, onEditSprint, onToggleCollapse } = props;

  // ---- Derived values (mirror BacklogSprintHeaderDirective, sprints.coffee) ----

  // English of BACKLOG.SPRINTS.DATE — the directive's `prettyDate`.
  const prettyDate = 'DD MMM YYYY';

  // `!archived_code && modify_milestone` — edit affordance gate.
  // F-REG-03: archive-aware mutation gate (equivalent to the legacy
  // `!archived_code && modify_milestone`), centralized in `canMutate`.
  const isEditable = canMutate(project, 'modify_milestone');
  // `view_milestones` — taskboard link visibility gate.
  const isVisible = can(project, 'view_milestones');

  // Taiga HTML5 taskboard route for this sprint. `sprint.slug` is optional on
  // the `Milestone` type; guard with `?? ''` to keep the URL well-formed.
  const taskboardUrl = `/project/${project.slug}/taskboard/${sprint.slug ?? ''}`;

  // "{start}-{finish}" with NO surrounding whitespace around the hyphen,
  // exactly as the directive built it.
  const estimatedDateRange = `${moment(sprint.estimated_start).format(
    prettyDate,
  )}-${moment(sprint.estimated_finish).format(prettyDate)}`;

  // `closed_points` / `total_points` are `number | null | undefined` on the
  // wire; `|| 0` reproduces the directive's `sprint.closed_points or 0`.
  const closedPoints = sprint.closed_points || 0;
  const totalPoints = sprint.total_points || 0;
  const name = sprint.name;

  /**
   * Handle the edit-sprint pencil click: suppress the anchor's default
   * navigation (the original used `href=""`) and lift the intent to the parent.
   */
  const handleEditClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    onEditSprint(sprint);
  };

  return (
    <div className="sprint-summary">
      <div className="sprint-name-container">
        <div className="sprint-name">
          {/*
            Compact-sprint toggle. Rendered as a real <button> (as in the jade)
            with an explicit type="button" so it can never submit an enclosing
            form. i18n: BACKLOG.COMPACT_SPRINT -> "Compact Sprint".
          */}
          <button
            type="button"
            className="compact-sprint"
            title={translate('BACKLOG.COMPACT_SPRINT', undefined, 'Compact Sprint')}
            onClick={onToggleCollapse}
          >
            <TgSvg icon="icon-arrow-right" />
          </button>

          {/*
            Taskboard link — shown only when the user can view milestones.
            F-UI-06: BACKLOG.GO_TO_TASKBOARD -> "Go to the taskboard of {{::name}}".
            The shell interpolates `{name}`; the English fallback is pre-interpolated
            since the fallback interpolator does not parse the `::` one-time-binding
            token in the shipped value.
          */}
          {isVisible && (
            <a
              href={taskboardUrl}
              title={translate('BACKLOG.GO_TO_TASKBOARD', { name }, `Go to the taskboard of ${name}`)}
            >
              <span>{name}</span>
            </a>
          )}
        </div>

        <div className="sprint-date">{estimatedDateRange}</div>
      </div>

      <div className="sprint-points">
        {/*
          Edit-sprint pencil — shown only when the sprint is editable
          (not archived + modify_milestone). Kept as an <a> with the
          `edit-sprint` class (per the source jade); `href="#"` keeps it
          keyboard-focusable while `handleEditClick` calls preventDefault.
          i18n: BACKLOG.EDIT_SPRINT -> "Edit Sprint".
        */}
        {isEditable && (
          <a
            className="edit-sprint"
            href="#"
            title={translate('BACKLOG.EDIT_SPRINT', undefined, 'Edit Sprint')}
            onClick={handleEditClick}
          >
            <TgSvg icon="icon-edit" />
          </a>
        )}

        <div className="sprint-info">
          <ul>
            <li>
              <span className="number">{formatNumber(closedPoints)}</span>
              {/* F-UI-06: BACKLOG.CLOSED_POINTS -> "closed" (lowercase, verbatim). */}
              <span className="description">
                {translate('BACKLOG.CLOSED_POINTS', undefined, 'closed')}
              </span>
            </li>
            <li>
              <span className="number">{formatNumber(totalPoints)}</span>
              {/* F-UI-06: BACKLOG.TOTAL_POINTS -> "total" (lowercase, verbatim). */}
              <span className="description">
                {translate('BACKLOG.TOTAL_POINTS', undefined, 'total')}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
