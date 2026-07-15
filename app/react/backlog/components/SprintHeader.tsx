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
 * Localization (F32): every label, tooltip, and the date-range format are resolved
 * through the shared `t()` runtime (app/react/shared/i18n.ts) against the active
 * Taiga locale — never hardcoded — reproducing the AngularJS `| translate`
 * filters and `$translate.instant("BACKLOG.SPRINTS.DATE")` call
 * (sprints.coffee:70). Point labels use `BACKLOG.CLOSED_POINTS` /
 * `BACKLOG.TOTAL_POINTS` and the tooltips use `BACKLOG.COMPACT_SPRINT`,
 * `BACKLOG.GO_TO_TASKBOARD`, and `BACKLOG.EDIT_SPRINT`.
 *
 * Accessibility (F33): the fold toggle carries `aria-expanded` reflecting `isOpen`,
 * and the edit pencil — which the compiled SCSS renders at `opacity: 0`, revealed
 * only on `.sprint-summary:hover` — gains a focus-visible reveal so keyboard users
 * do not land on an invisible control. The reveal reproduces the EXACT hover
 * treatment (`opacity: 1; background: rgba(255,255,255,.8)`) as an inline style
 * applied only while focused, so the default and hover appearances stay
 * byte-identical (F41 — zero visual change; the reference-only SCSS is not edited).
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; the `useState` hook and the
 * `CSSProperties` type are imported by name.
 */

import { useState, type CSSProperties } from 'react';
import moment from 'moment';

import { t } from '../../shared/i18n';

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
 * F33 — focus-visible reveal for the edit pencil.
 *
 * The compiled SCSS (sprints.scss -> theme) renders `.sprint-summary .edit-sprint`
 * at `opacity: 0` and only reveals it on `.sprint-summary:hover`
 * (`opacity: 1; background: rgba(255,255,255,.8)`). A keyboard user tabbing to the
 * edit link would therefore focus an invisible control. Because the SCSS is
 * reference-only (never modified) and inline styles cannot express a `:focus`
 * rule, this reproduces the EXACT hover treatment as an inline style applied only
 * while the link holds keyboard focus. It is strictly additive: it changes only
 * the focused state (previously invisible) and leaves the default and hover
 * appearances byte-identical, honoring the zero-visual-change mandate (F41).
 */
const EDIT_FOCUS_REVEAL: CSSProperties = {
  opacity: 1,
  background: 'rgba(255, 255, 255, 0.8)',
};

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
  // F33 — focus-reveal state for the edit pencil (see EDIT_FOCUS_REVEAL). Gates an
  // inline style that mirrors the SCSS hover reveal while the link holds focus.
  const [editFocused, setEditFocused] = useState(false);

  // sprints.coffee:70,83-86 — the sprint date format is the ACTIVE locale's
  // BACKLOG.SPRINTS.DATE pattern (English "DD MMM YYYY"), obtained via
  // `$translate.instant("BACKLOG.SPRINTS.DATE")` and applied with moment.format.
  // start and finish are joined by a LITERAL hyphen with NO surrounding spaces:
  // estimatedDateRange = "#{start}-#{finish}" (e.g. "01 Jan 2021-15 Jan 2021").
  const sprintDateFormat = t('BACKLOG.SPRINTS.DATE');
  const estimatedDateRange = `${moment(props.estimatedStart).format(sprintDateFormat)}-${moment(
    props.estimatedFinish,
  ).format(sprintDateFormat)}`;

  return (
    <div className="sprint-summary">
      <div className="sprint-name-container">
        <div className="sprint-name">
          {/* Fold/expand toggle. `active` = expanded (arrow points down); no
              `active` = collapsed (arrow points right). F32: title via
              BACKLOG.COMPACT_SPRINT. F33: aria-expanded mirrors the fold state so
              assistive tech announces the collapsed/expanded state of the sprint
              body this button controls (owned by the parent Sprint.tsx). */}
          <button
            type="button"
            className={props.isOpen ? 'compact-sprint active' : 'compact-sprint'}
            title={t('BACKLOG.COMPACT_SPRINT')}
            aria-expanded={props.isOpen}
            onClick={props.onToggleFold}
          >
            <Svg icon="icon-arrow-right" />
          </button>
          {/* Taskboard link — gated by the 'view_milestones' permission (F32).
              title = BACKLOG.GO_TO_TASKBOARD. The catalog value is
              "Go to the taskboard of {{::name}}", but sprint-header.jade renders it
              with the bare `| translate` filter and passes NO interpolation params,
              so AngularJS interpolates `{{::name}}` against an empty context to the
              empty string. Verified empirically against the live AngularJS app:
              `$translate.instant('BACKLOG.GO_TO_TASKBOARD')` === "Go to the taskboard of "
              (trailing space, no name). We reproduce that EXACT render by passing an
              empty params object — `t(key, {})` substitutes the placeholder with ""
              — preserving byte-exact parity with the legacy tooltip rather than
              "correcting" the latent legacy omission (AAP goal 1: no behavior change;
              D1: exact-parity precedence over intent). */}
          {props.isVisible && (
            <a href={props.taskboardUrl} title={t('BACKLOG.GO_TO_TASKBOARD', {})}>
              <span>{props.name}</span>
            </a>
          )}
        </div>

        <div className="sprint-date">{estimatedDateRange}</div>
      </div>
      <div className="sprint-points">
        {/* Edit pencil — gated by !archived_code && 'modify_milestone'. In AngularJS
            the click broadcast `sprintform:edit`; here it invokes onEdit. F32: title
            via BACKLOG.EDIT_SPRINT. F33: onFocus/onBlur toggle the focus-visible
            reveal (EDIT_FOCUS_REVEAL) so keyboard users see the otherwise
            `opacity: 0` control; the `title` provides its accessible name. */}
        {props.isEditable && (
          <a
            className="edit-sprint"
            href=""
            title={t('BACKLOG.EDIT_SPRINT')}
            style={editFocused ? EDIT_FOCUS_REVEAL : undefined}
            onFocus={() => setEditFocused(true)}
            onBlur={() => setEditFocused(false)}
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
              {/* F32: point label via BACKLOG.CLOSED_POINTS (jade: translate="..."). */}
              <span className="description">{t('BACKLOG.CLOSED_POINTS')}</span>
            </li>
            <li>
              <span className="number">{formatNumber(props.totalPoints ?? 0)}</span>
              {/* F32: point label via BACKLOG.TOTAL_POINTS (jade: translate="..."). */}
              <span className="description">{t('BACKLOG.TOTAL_POINTS')}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
