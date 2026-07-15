/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintHeader — React port of the AngularJS `tgBacklogSprintHeader` directive.
 *
 * Presentational (stateless) leaf component that renders the compact header of a
 * single Backlog sprint card: the fold/expand toggle button, the sprint name
 * (linking to the taskboard), the estimated date range, an edit pencil, and the
 * closed / total point counts. It is rendered by `Sprint.tsx`.
 *
 * The component reproduces the EXACT DOM structure and CSS class names of the
 * original AngularJS markup so the existing compiled global SCSS renders it with
 * ZERO visual change. It owns no fold state of its own: `isOpen` (fold state),
 * `taskboardUrl` (pre-resolved link) and the permission gates all arrive as props
 * from the parent `Sprint.tsx`, which remains the single owner of the sprint
 * body's `.sprint-table.open` class.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - sprint-header.jade:10-37 — the DOM structure.
 *  - sprints.coffee:67-117 (BacklogSprintHeaderDirective) — date-range formatting
 *    ("DD MMM YYYY" joined by a literal hyphen), the `closed_points or 0` /
 *    `total_points or 0` defaults, and the two permission gates
 *    (`view_milestones` -> isVisible, `modify_milestone` && !archived_code
 *    -> isEditable).
 *  - sprints.coffee:18-58 (BacklogSprintDirective) — the imperative fold
 *    (`toggleSprint`) and `sprintform:edit` broadcast wiring, now expressed
 *    declaratively through the `isOpen` / `onToggleFold` / `onEdit` props.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value.
 */

import moment from 'moment';

/**
 * Module-local reference to the AngularJS `<tg-svg>` custom-element host.
 *
 * React owns the entire subtree inside `<tg-react-backlog>`, so it must render the
 * SVG sprite `<svg><use>` itself rather than relying on AngularJS to compile the
 * `tgSvg` directive (common.coffee:333-363). That directive runs in `template`
 * mode, emitting `<svg class="icon {icon}">...</svg>` INSIDE the `<tg-svg>` host,
 * so we reproduce both the host tag and its inner sprite.
 *
 * The `as unknown as any` cast lets the custom-element tag be used in JSX without a
 * cross-file `declare global { namespace JSX }` augmentation, which would conflict
 * with the sibling React files that use the same established pattern.
 */
const TgSvg = 'tg-svg' as unknown as any;

/**
 * Renders a Taiga sprite icon, mirroring the rendered output of the AngularJS
 * `tgSvg` directive. React maps `className` -> `class`; `xlinkHref` renders the
 * SVG 1.1 `xlink:href` attribute while the extra `href` covers SVG 2 / Firefox
 * (the Playwright engine used for visual evidence).
 */
function Svg({ icon, className }: { icon: string; className?: string }) {
  return (
    <TgSvg svg-icon={icon} className={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as any)} />
      </svg>
    </TgSvg>
  );
}

/**
 * Reproduces AngularJS's `{{ value | number }}` filter (see the `| number`
 * bindings in sprint-header.jade:33,36): locale-aware thousands grouping with up
 * to three fraction digits.
 */
const formatNumber = (n: number): string =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

/**
 * Props for {@link SprintHeader}. These mirror the AngularJS directive's `ctx`
 * object one-to-one (sprints.coffee:88-96) plus the three React-interactivity
 * props (`isOpen`, `onToggleFold`, `onEdit`) that replace the imperative
 * `toggleSprint` and the `sprintform:edit` broadcast.
 */
export interface SprintHeaderProps {
  /** sprint.name */
  name: string;
  /** sprint.estimated_start — raw API date ('YYYY-MM-DD'); formatted here via moment. */
  estimatedStart: string;
  /** sprint.estimated_finish — raw API date; formatted here via moment. */
  estimatedFinish: string;
  /** sprint.closed_points or 0. */
  closedPoints: number | undefined;
  /** sprint.total_points or 0. */
  totalPoints: number | undefined;
  /** Pre-resolved `/project/{pslug}/taskboard/{sslug}` URL (built by Sprint.tsx). */
  taskboardUrl: string;
  /** my_permissions includes 'view_milestones' — gates the taskboard name link. */
  isVisible: boolean;
  /** !project.archived_code && my_permissions includes 'modify_milestone' — gates the edit pencil. */
  isEditable: boolean;
  /** Fold state; true = expanded -> `.compact-sprint` gets the `active` class. */
  isOpen: boolean;
  /** Click the compact-sprint toggle button. */
  onToggleFold: () => void;
  /** Click the edit pencil -> parent maps to openSprintForm('edit', sprint). */
  onEdit: () => void;
}

/**
 * The compact sprint header. See the module doc comment for the full source
 * mapping (sprint-header.jade:10-37 + sprints.coffee:67-117).
 */
export function SprintHeader(props: SprintHeaderProps) {
  // sprints.coffee:83-86 — start/finish formatted with the "DD MMM YYYY" pattern
  // (BACKLOG.SPRINTS.DATE) and joined by a LITERAL hyphen with NO surrounding
  // spaces: estimatedDateRange = "#{start}-#{finish}" (e.g. "01 Jan 2021-15 Jan 2021").
  const estimatedDateRange = `${moment(props.estimatedStart).format('DD MMM YYYY')}-${moment(
    props.estimatedFinish,
  ).format('DD MMM YYYY')}`;

  return (
    <div className="sprint-summary">
      <div className="sprint-name-container">
        <div className="sprint-name">
          {/* Fold/expand toggle. `active` = expanded (arrow points down); no
              `active` = collapsed (arrow points right). title=BACKLOG.COMPACT_SPRINT. */}
          <button
            type="button"
            className={props.isOpen ? 'compact-sprint active' : 'compact-sprint'}
            title="Compact Sprint"
            onClick={props.onToggleFold}
          >
            <Svg icon="icon-arrow-right" />
          </button>
          {/* Taskboard link — gated by the 'view_milestones' permission.
              title=BACKLOG.GO_TO_TASKBOARD ("Go to the taskboard of {{name}}"). */}
          {props.isVisible && (
            <a href={props.taskboardUrl} title={`Go to the taskboard of ${props.name}`}>
              <span>{props.name}</span>
            </a>
          )}
        </div>

        <div className="sprint-date">{estimatedDateRange}</div>
      </div>
      <div className="sprint-points">
        {/* Edit pencil — gated by !archived_code && 'modify_milestone'. In AngularJS
            the click broadcast `sprintform:edit`; here it invokes onEdit.
            title=BACKLOG.EDIT_SPRINT. */}
        {props.isEditable && (
          <a
            className="edit-sprint"
            href=""
            title="Edit Sprint"
            onClick={(e) => {
              e.preventDefault();
              props.onEdit();
            }}
          >
            <Svg icon="icon-edit" />
          </a>
        )}
        <div className="sprint-info">
          <ul>
            <li>
              <span className="number">{formatNumber(props.closedPoints ?? 0)}</span>
              {/* i18n BACKLOG.CLOSED_POINTS */}
              <span className="description">closed</span>
            </li>
            <li>
              <span className="number">{formatNumber(props.totalPoints ?? 0)}</span>
              {/* i18n BACKLOG.TOTAL_POINTS */}
              <span className="description">total</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
