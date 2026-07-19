/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ProgressBar — React port of the two AngularJS Taiga Backlog progress bars.
 *
 * A pure, stateless presentational leaf that reproduces the EXACT DOM structure
 * and CSS class names of the original AngularJS directives so the existing,
 * already-compiled global SCSS renders it with ZERO visual change. It renders
 * only `<div>`s with fixed class names and inline `width` styles; it holds no
 * state, performs no I/O, and imports nothing but the `BacklogStats` type.
 *
 * A single `variant` discriminator selects between the two visually distinct
 * bars that both live on the Backlog screen:
 *
 *   • variant="sprint"           — the thin per-sprint bar shown inside each
 *                                  sprint card (host `.sprint-progress-bar`,
 *                                  single `.current-progress` child). Rendered
 *                                  by `Sprint.tsx`, which owns the surrounding
 *                                  `.summary-progress-wrapper` (NOT rendered here).
 *   • variant="backlog-summary"  — the three-layer stat bar in the backlog
 *                                  summary header (host `.summary-progress-bar`
 *                                  with `.defined-points`, `.project-points-progress`
 *                                  and `.closed-points-progress` children).
 *                                  Rendered by `BacklogApp.tsx`, which owns the
 *                                  surrounding `.summary` / `.data` / `.summary-stats`.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported; math/markup
 * reproduced by hand per the AAP §0.4.1 transformation map):
 *  - app/partials/common/components/progress-bar.jade:8 — the sprint inner
 *    template: a single `.current-progress(style="width: <X>%")`.
 *  - app/partials/backlog/sprint.jade:10-11 — the sprint host:
 *    `.summary-progress-wrapper > .sprint-progress-bar(tg-progress-bar="100 *
 *    sprint.closed_points / sprint.total_points")`.
 *  - app/coffee/modules/common/components.coffee:433-452 — `TgProgressBarDirective`
 *    (registered `tgProgressBar`): the sprint math. The source CLAMPS ONLY
 *    (`_.max([0, p])` then `_.min([100, p])`), does NOT round, and does NOT
 *    toggle any state class. The sprint variant below reproduces this exactly
 *    (finding #2). The `.full { background: … }` rule at sprints.scss:185 is dead
 *    CSS the AngularJS source never activated, so it is left untouched/unused.
 *  - app/partials/backlog/progress-bar.jade:8-13 — the backlog-summary inner
 *    template: `.defined-points` + `.project-points-progress` + `.closed-points-progress`.
 *  - app/partials/includes/components/summary.jade:9 — the backlog-summary host:
 *    `.summary-progress-bar(tg-backlog-progress-bar="stats")`.
 *  - app/coffee/modules/backlog/main.coffee:1345-1385 — `TgBacklogProgressBarDirective`
 *    (registered `tgBacklogProgressBar`): the backlog-summary math, reproduced
 *    exactly (adjustPercentaje = round∘clamp; total/defined/closed branch; a
 *    literal `-3` applied BEFORE clamp+round).
 *  - Styling (REFERENCE ONLY, never imported): sprints.scss:162-190 and
 *    summary.scss:94-122 define every class name reproduced below.
 *
 * Part of the AngularJS 1.5.10 → React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`),
 * so React is intentionally NOT imported; the component uses no hooks. The only
 * import is the `BacklogStats` TYPE (type-only, required by `isolatedModules`).
 */

import type { BacklogStats } from '../state/backlogReducer';

/**
 * Props for the thin per-sprint progress bar (`variant="sprint"`).
 *
 * `closedPoints` / `totalPoints` map directly to `sprint.closed_points` /
 * `sprint.total_points` and may be `undefined`/`0`; when `totalPoints` is falsy
 * the bar renders 0% (see the math note in {@link ProgressBar}).
 */
export interface SprintProgressBarProps {
  variant: 'sprint';
  /** `sprint.closed_points` (may be undefined/0). */
  closedPoints: number | undefined;
  /** `sprint.total_points` (may be undefined/0; when falsy the bar renders 0%). */
  totalPoints: number | undefined;
}

/**
 * Props for the three-layer backlog summary progress bar
 * (`variant="backlog-summary"`).
 *
 * Only the three point fields consumed by the original directive are required,
 * expressed as a `Pick` over {@link BacklogStats} so callers can pass the full
 * stats object.
 */
export interface BacklogSummaryProgressBarProps {
  variant: 'backlog-summary';
  /** The backlog stats object (uses total_points, defined_points, closed_points). */
  stats: Pick<BacklogStats, 'total_points' | 'defined_points' | 'closed_points'>;
}

/**
 * Discriminated union on `variant`; each caller gets fully type-safe props.
 * `Sprint.tsx`      → `<ProgressBar variant="sprint" closedPoints={…} totalPoints={…} />`
 * `BacklogApp.tsx`  → `<ProgressBar variant="backlog-summary" stats={stats} />`
 */
export type ProgressBarProps = SprintProgressBarProps | BacklogSummaryProgressBarProps;

/**
 * Renders one of the two Backlog progress bars, selected by `props.variant`.
 * See the file-level doc comment for the reference sources of every value below.
 */
export function ProgressBar(props: ProgressBarProps) {
  if (props.variant === 'sprint') {
    // --- Sprint bar (host `.sprint-progress-bar`, child `.current-progress`) ---
    //
    // Source `tgProgressBar` (components.coffee:436-445) evaluated
    //   `100 * sprint.closed_points / sprint.total_points`
    // then CLAMPED ONLY: `_.max([0, p])` → `_.min([100, p])`. The legacy
    // directive does NOT round the width and does NOT toggle any state class.
    //
    // Finding #2: an earlier port ROUNDED the width (e.g. showed 21% for a raw
    // 20.528%) AND added a `.full` class at ≥100%. Neither behavior exists in the
    // AngularJS source, and the AAP defines no progress-bar rule that would
    // override exact parity (§0.3.3 is "Design Pattern Applications" — it says
    // nothing about rounding or a `.full` state), so BOTH are removed here to
    // match the legacy clamp-only computation exactly. The `.full { … }` rule at
    // sprints.scss:185 is dead CSS the legacy directive never activated; we
    // likewise never activate it.
    //
    // When `total_points` is falsy the raw ratio would be `n/0` (→ Infinity/NaN);
    // we pin that degenerate case to 0% to avoid emitting a `width: NaN%` (the
    // browser would ignore a NaN width anyway, so this matches the rendered
    // legacy effect).
    const total = Number(props.totalPoints) || 0;
    const closed = Number(props.closedPoints) || 0;
    const raw = total > 0 ? (100 * closed) / total : 0;
    // Clamp to [0, 100] ONLY — no Math.round (legacy parity, finding #2).
    const percentage = Math.min(100, Math.max(0, raw));

    return (
      <div className="sprint-progress-bar">
        <div className="current-progress" style={{ width: `${percentage}%` }} />
      </div>
    );
  }

  // --- Backlog summary bar (host `.summary-progress-bar`, three children) ---
  //
  // Reproduces `TgBacklogProgressBarDirective` (main.coffee:1356-1377) exactly:
  //   adjustPercentaje(p) = round(clamp(p, 0, 100))   [source order: max0 → min100 → round]
  //   totalPoints   = stats.total_points ? stats.total_points : stats.defined_points
  //   definedPoints = stats.defined_points
  //   closedPoints  = stats.closed_points
  //   if definedPoints > totalPoints:
  //       project = totalPoints  * 100 / definedPoints
  //       closed  = closedPoints * 100 / definedPoints
  //   else:
  //       project = 100
  //       closed  = closedPoints * 100 / totalPoints
  //   project = adjustPercentaje(project - 3)          # the -3 is applied BEFORE clamp+round
  //   closed  = adjustPercentaje(closed  - 3)
  const { stats } = props;

  const adjustPercentaje = (p: number): number => Math.round(Math.min(100, Math.max(0, p)));

  // Guarded `n * 100 / d`. The AngularJS source divides UNGUARDED; a degenerate
  // all-zero project would make `closedPoints * 100 / totalPoints` evaluate to
  // `0 / 0 = NaN`, which would leak through `adjustPercentaje` as `width: NaN%`.
  // That case is not reachable with real backlog stats — this guard exists ONLY
  // to avoid emitting a NaN width, yielding 0 for a zero denominator.
  const ratio = (numerator: number, denominator: number): number =>
    denominator > 0 ? (numerator * 100) / denominator : 0;

  const totalPoints = stats.total_points ? stats.total_points : (stats.defined_points ?? 0);
  const definedPoints = stats.defined_points ?? 0;
  const closedPoints = stats.closed_points ?? 0;

  let projectPointsPercentaje: number;
  let closedPointsPercentaje: number;
  if (definedPoints > totalPoints) {
    projectPointsPercentaje = ratio(totalPoints, definedPoints);
    closedPointsPercentaje = ratio(closedPoints, definedPoints);
  } else {
    projectPointsPercentaje = 100;
    closedPointsPercentaje = ratio(closedPoints, totalPoints);
  }
  projectPointsPercentaje = adjustPercentaje(projectPointsPercentaje - 3);
  closedPointsPercentaje = adjustPercentaje(closedPointsPercentaje - 3);

  // `title` attributes reproduce the Jade i18n tooltips (progress-bar.jade:8-13).
  // They are non-visual (do not affect layout/SCSS); the literal English strings
  // below mirror the i18n keys BACKLOG.EXCESS_OF_POINTS / BACKLOG.PENDING_POINTS /
  // BACKLOG.CLOSED_POINTS. No translation library is wired here per the migration
  // import boundary; the hosting screen owns locale wiring.
  return (
    <div className="summary-progress-bar">
      {/* BACKLOG.EXCESS_OF_POINTS */}
      <div className="defined-points" title="Excess of points" />
      {/* BACKLOG.PENDING_POINTS */}
      <div
        className="project-points-progress"
        title="Pending points"
        style={{ width: `${projectPointsPercentaje}%` }}
      />
      {/* BACKLOG.CLOSED_POINTS */}
      <div
        className="closed-points-progress"
        title="Closed points"
        style={{ width: `${closedPointsPercentaje}%` }}
      />
    </div>
  );
}
