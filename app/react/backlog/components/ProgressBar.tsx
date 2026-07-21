/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ProgressBar — backlog-summary progress bar (render-only).
 *
 * React port of the AngularJS `TgBacklogProgressBarDirective`
 * (`app/coffee/modules/backlog/main.coffee`, directive `tgBacklogProgressBar`)
 * and its template `app/partials/backlog/progress-bar.jade`.
 *
 * This is the three-sub-bar summary meter that the backlog summary region hosted
 * via `div.summary-progress-bar(tg-backlog-progress-bar="stats")`
 * (`app/partials/backlog/summary.jade`). It is intentionally NOT the per-sprint
 * progress bar (the common `tgProgressBar` single `.current-progress` div rendered
 * inline inside `Sprint.tsx`).
 *
 * Pure presentational component: it receives `stats` via props, computes the two
 * width percentages exactly as the directive did, holds no business state, and
 * performs no fetch/API/WebSocket work. It reuses the EXACT existing SCSS class
 * names (`summary-progress-bar`, `defined-points`, `project-points-progress`,
 * `closed-points-progress`, verified in `app/styles/components/summary.scss`) for
 * pixel fidelity — it does not import or rewrite any SCSS.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement and no hooks are used.
 */

// F-UI-06: bridge the three bar titles to the AngularJS shell's angular-translate
// service (English fallback keeps shell-less unit renders correct). Mirrors the
// legacy `title="{{'BACKLOG.…' | translate}}"` attributes in `progress-bar.jade`.
import { translate } from '../../shared/i18n';

/**
 * Subset of the backlog `stats` object consumed by this bar. Declared locally and
 * kept self-contained (no `Stats`/domain type is imported from `../../shared/types`);
 * the `BacklogApp` container passes a `stats` object that structurally satisfies this.
 */
export interface ProgressBarStats {
  total_points?: number | null;
  defined_points?: number | null;
  closed_points?: number | null;
}

/**
 * Props for {@link ProgressBar}. `stats` may be null/undefined before data loads,
 * in which case both bars render at width 0% (mirrors the directive's `stats?` guard).
 */
export interface ProgressBarProps {
  stats: ProgressBarStats | null | undefined;
}

/**
 * Clamp a percentage into the inclusive range [0, 100] and round to the nearest
 * integer. Byte-for-byte reproduction of the directive's `adjustPercentaje`:
 *   adjusted = _.max([0, percentage]); adjusted = _.min([100, adjusted]); Math.round(adjusted)
 */
function adjustPercentaje(percentage: number): number {
  return Math.round(Math.min(100, Math.max(0, percentage)));
}

/**
 * Safety guard (documented deviation): division by zero or falsy point totals can
 * produce `NaN`/`Infinity`. AngularJS would have interpolated an invalid `width: NaN%`
 * that the browser simply ignores; to avoid emitting an invalid inline style we coerce
 * any non-finite result to 0. This does not change behavior for valid data.
 */
function toFinitePercentaje(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Compute the two dynamic sub-bar widths exactly as `TgBacklogProgressBarDirective`
 * did on every `stats` change:
 *
 *   totalPoints    = stats.total_points || stats.defined_points   (falls back like the coffee ternary)
 *   definedPoints  = stats.defined_points
 *   closedPoints   = stats.closed_points
 *   if definedPoints > totalPoints:
 *       projectPointsPercentaje = totalPoints * 100 / definedPoints
 *       closedPointsPercentaje  = closedPoints * 100 / definedPoints
 *   else:
 *       projectPointsPercentaje = 100
 *       closedPointsPercentaje  = closedPoints * 100 / totalPoints
 *   projectPointsPercentaje = adjustPercentaje(projectPointsPercentaje - 3)
 *   closedPointsPercentaje  = adjustPercentaje(closedPointsPercentaje - 3)
 *
 * The `- 3` inset is applied to BOTH percentages before clamping/rounding, matching
 * the original. A null/undefined `stats` yields 0/0 (the directive only rendered when
 * `stats?`). Each result is finite-guarded to keep inline widths valid.
 */
function computePercentages(stats: ProgressBarStats | null | undefined): {
  projectPointsPercentaje: number;
  closedPointsPercentaje: number;
} {
  if (!stats) {
    return { projectPointsPercentaje: 0, closedPointsPercentaje: 0 };
  }

  // `total_points || defined_points || 0` mirrors `if stats.total_points then ... else ...`
  // with an added `|| 0` so a null/undefined defined_points cannot leak through.
  const totalPoints = stats.total_points || stats.defined_points || 0;
  const definedPoints = stats.defined_points || 0;
  const closedPoints = stats.closed_points || 0;

  let projectPointsPercentaje: number;
  let closedPointsPercentaje: number;

  if (definedPoints > totalPoints) {
    projectPointsPercentaje = (totalPoints * 100) / definedPoints;
    closedPointsPercentaje = (closedPoints * 100) / definedPoints;
  } else {
    projectPointsPercentaje = 100;
    closedPointsPercentaje = (closedPoints * 100) / totalPoints;
  }

  // The original subtracted 3 from each percentage before clamp/round.
  projectPointsPercentaje = adjustPercentaje(projectPointsPercentaje - 3);
  closedPointsPercentaje = adjustPercentaje(closedPointsPercentaje - 3);

  return {
    projectPointsPercentaje: toFinitePercentaje(projectPointsPercentaje),
    closedPointsPercentaje: toFinitePercentaje(closedPointsPercentaje),
  };
}

/**
 * Backlog-summary progress meter. Renders the exact DOM the directive produced —
 * a `.summary-progress-bar` host wrapping the three stacked sub-bars — reusing the
 * existing SCSS class names for visual fidelity.
 */
export function ProgressBar(props: ProgressBarProps) {
  const { projectPointsPercentaje, closedPointsPercentaje } = computePercentages(props.stats);

  // F-UI-05: expose the meter to assistive tech as a `progressbar`. The
  // announced value is the CLEAN closed-points completion (closed / total,
  // clamped to 0–100) — deliberately WITHOUT the `- 3` visual inset the sub-bar
  // widths use, so screen-reader users hear the true completion percentage. The
  // legacy template announced nothing here (visual-only), so this is a pure
  // a11y addition that leaves the rendered DOM/SCSS untouched.
  const stats = props.stats;
  const totalForAria = stats ? stats.total_points || stats.defined_points || 0 : 0;
  const closedForAria = stats ? stats.closed_points || 0 : 0;
  const closedCompletion = totalForAria > 0 ? adjustPercentaje((closedForAria * 100) / totalForAria) : 0;

  return (
    <div
      className="summary-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={closedCompletion}
      aria-valuetext={`${closedCompletion}%`}
      aria-label={translate('BACKLOG.PROGRESS', undefined, 'Backlog points progress')}
    >
      {/* Background/track bar. F-UI-06: BACKLOG.EXCESS_OF_POINTS -> "Excess of points". */}
      <div
        className="defined-points"
        title={translate('BACKLOG.EXCESS_OF_POINTS', undefined, 'Excess of points')}
      />
      {/* Pending points. F-UI-06: BACKLOG.PENDING_POINTS -> "Pending Points". */}
      <div
        className="project-points-progress"
        title={translate('BACKLOG.PENDING_POINTS', undefined, 'Pending Points')}
        style={{ width: `${projectPointsPercentaje}%` }}
      />
      {/* Closed points. F-UI-06: BACKLOG.CLOSED_POINTS -> "closed" (lowercase, verbatim). */}
      <div
        className="closed-points-progress"
        title={translate('BACKLOG.CLOSED_POINTS', undefined, 'closed')}
        style={{ width: `${closedPointsPercentaje}%` }}
      />
    </div>
  );
}
