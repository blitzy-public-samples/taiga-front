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
import moment from 'moment';

import { can } from '../../shared/permissions';

import type { Milestone, Project } from '../../shared/types';

/*
 * Taiga renders inline SVG sprites through its `<tg-svg>` web component, which
 * is not a standard HTML element, so we widen the JSX intrinsic-element table
 * locally (mirroring the sibling backlog/kanban components). Typed `any` because
 * the element is opaque to React/TS and is resolved by the existing sprite
 * runtime at render time.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'tg-svg': any;
    }
  }
}

/**
 * Render Taiga's `<tg-svg>` sprite wrapper, mirroring the AngularJS
 * `tg-svg(svg-icon="…")` markup used in `sprint-header.jade`. `className` is
 * forwarded onto the custom element (the sprite runtime reads it); the inner
 * `<svg>` carries the `icon <name>` classes the retained SCSS targets, and
 * `<use>` references the sprite by id. Icons used by this header:
 * `icon-arrow-right` (the compact-sprint toggle) and `icon-edit` (the
 * edit-sprint pencil).
 */
function svgIcon(icon: string, className?: string) {
  return (
    <tg-svg class={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} />
      </svg>
    </tg-svg>
  );
}

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
  const isEditable = !project.archived_code && can(project, 'modify_milestone');
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
            title="Compact Sprint"
            onClick={onToggleCollapse}
          >
            {svgIcon('icon-arrow-right')}
          </button>

          {/*
            Taskboard link — shown only when the user can view milestones.
            i18n: BACKLOG.GO_TO_TASKBOARD -> "Go to the taskboard of {{::name}}".
          */}
          {isVisible && (
            <a href={taskboardUrl} title={`Go to the taskboard of ${name}`}>
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
            title="Edit Sprint"
            onClick={handleEditClick}
          >
            {svgIcon('icon-edit')}
          </a>
        )}

        <div className="sprint-info">
          <ul>
            <li>
              <span className="number">{formatNumber(closedPoints)}</span>
              {/* i18n: BACKLOG.CLOSED_POINTS -> "closed" (lowercase, verbatim). */}
              <span className="description">closed</span>
            </li>
            <li>
              <span className="number">{formatNumber(totalPoints)}</span>
              {/* i18n: BACKLOG.TOTAL_POINTS -> "total" (lowercase, verbatim). */}
              <span className="description">total</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
