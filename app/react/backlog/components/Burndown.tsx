/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Burndown — React port of the AngularJS Backlog burndown chart
 * (`tgBurndownBacklogGraph` / `BurndownBacklogGraphDirective`,
 * app/coffee/modules/backlog/main.coffee:1217-1338) — finding #1.
 *
 * The legacy directive rendered a Flot (jQuery.plot) canvas chart. Flot is a
 * jQuery plug-in and is NOT part of the React runtime, so the chart is
 * re-implemented here as a pure, dependency-free inline `<svg>` that reproduces
 * the legacy chart's DATA, SERIES, COLORS, AXES and per-point TOOLTIPS exactly.
 * No new charting dependency is introduced (AAP §0.7 minimal-change / isolation).
 *
 * DATA SOURCE — reproduced verbatim from the directive's `redrawChart`:
 * the chart binds to `$scope.stats` (the project stats already loaded by the
 * Backlog screen via `GET /projects/{id}/stats`), specifically `stats.milestones`
 * — an ordered array where each entry carries `name`, `optimal`, `evolution`
 * (nullable), `team-increment` and `client-increment`. NO separate network call
 * is made (the finding notes the legacy chart likewise issues none — the series
 * come from the stats payload).
 *
 * FIVE SERIES (seriesIndex 0-4), reproduced exactly (main.coffee:1225-1256):
 *   0. zero baseline  — all-zero, transparent, points OFF (an invisible Flot
 *                       helper series). NOT rendered here (it is never visible
 *                       and, with points off, never produces a tooltip).
 *   1. optimal        — `ml.optimal`.                     tooltip → OPTIMAL
 *   2. evolution/real — `ml.evolution`, NULLS FILTERED OUT (so this line is
 *                       shorter than the sprint count and stops at the last
 *                       reported sprint, exactly like the legacy
 *                       `_.filter(..., (e) -> e?)`).       tooltip → REAL
 *   3. client incr.   — `-ml["team-increment"] - ml["client-increment"]`. tooltip → INCREMENT_CLIENT
 *   4. team incr.     — `-ml["team-increment"]`.          tooltip → INCREMENT_TEAM (else branch, covers 0 & 4)
 *
 * COLORS (line/point stroke) and FILL colors are the exact literals from the
 * directive (main.coffee:1258-1264 `colors`, and each series' `lines.fillColor`).
 *
 * AXES / GRID reproduce the Flot options (main.coffee:1266-1283): grid border
 * colour `#D8DEE9`; x-axis with one tick per sprint and an EMPTY tick formatter
 * (no per-tick text, `tickFormatter: -> ""`); axis labels sourced from the same
 * i18n keys the directive used — `BACKLOG.CHART.XAXIS_LABEL` ("Sprints") and
 * `BACKLOG.CHART.YAXIS_LABEL` ("Points").
 *
 * TOOLTIPS reproduce `tooltipOpts.content` (main.coffee:1305-1318): each plotted
 * point exposes, via a native SVG `<title>`, the interpolated message for its
 * series — `BACKLOG.CHART.{OPTIMAL,REAL,INCREMENT_CLIENT,INCREMENT_TEAM}` with
 * `{sprintName, value}` where `value = Math.abs(yval * 10) / 10` (the legacy
 * one-decimal absolute value). Hovering a point shows the same text Flot showed.
 *
 * NO LEGEND is rendered: the legacy Flot series carry no `label` and the config
 * sets no `legend`, so Flot rendered none. Adding one would be a NEW feature
 * (forbidden by the "no features added" parity rule); point tooltips provide the
 * same series identification the legacy chart offered, and the whole chart also
 * carries an `aria-label` for assistive tech.
 *
 * Aspect ratio matches the directive's `element.height(width / 6)` via a 6:1
 * `viewBox` scaled to the container width (`.burndown { width: 100% }`,
 * burndown.scss). The component is pure/stateless: it renders only SVG, holds no
 * state, performs no I/O, and imports only the `BacklogStats` TYPE plus the
 * shared i18n `t` (globals-only migration boundary).
 */

import type { BacklogStats } from '../state/backlogReducer';
import { t } from '../../shared/i18n';

/**
 * One entry of `stats.milestones` as consumed by the burndown chart. The stats
 * payload is typed loosely (`BacklogStats` has an index signature), so the chart
 * narrows the fields it needs here. Every numeric field is nullable in the raw
 * payload (`evolution` is frequently `null` for not-yet-reported sprints).
 */
export interface BurndownMilestone {
  name: string;
  optimal: number | null;
  evolution: number | null;
  'team-increment': number | null;
  'client-increment': number | null;
}

/** Props: the project stats (may be `null` before the first stats load). */
export interface BurndownProps {
  stats: BacklogStats | null;
}

/* ------------------------------------------------------------------ *
 * Exact legacy literals (main.coffee:1258-1264 + per-series fillColor).
 * ------------------------------------------------------------------ */

/** Per-series line/point stroke colours (Flot `colors`, seriesIndex 0-4). */
const SERIES_COLORS = [
  'rgba(200,201,196,0.2)',
  'rgba(216,222,233,1)',
  'rgba(168,228,64,1)',
  'rgba(216,222,233,1)',
  'rgba(255,160,160,1)',
] as const;

/** Per-series area fill colours (each series' `lines.fillColor`). */
const SERIES_FILL = [
  'rgba(0,0,0,0)',
  'rgba(200,201,196,0.2)',
  'rgba(147,196,0,0.2)',
  'rgba(200,201,196,0.2)',
  'rgba(255,160,160,0.2)',
] as const;

/** Grid / axis border colour (Flot `grid.borderColor` / `grid.color`). */
const GRID_COLOR = '#D8DEE9';

/* ------------------------------------------------------------------ *
 * viewBox geometry — 6:1 aspect ratio (legacy `height = width / 6`).
 * ------------------------------------------------------------------ */
const VB_W = 720;
const VB_H = 120;
const PAD_L = 40; // y-axis label + value ticks
const PAD_R = 25; // legacy grid margin.right 20 + right border 1
const PAD_T = 10;
const PAD_B = 22; // x-axis label ("Sprints")
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

/** Coerce a possibly-null/undefined numeric field to a finite number (→ 0). */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tooltip text for a plotted point, reproducing `tooltipOpts.content`
 * (main.coffee:1305-1318). `value = Math.abs(yval * 10) / 10` (one-decimal abs).
 */
function pointTooltip(seriesIndex: number, sprintName: string, yval: number): string {
  const value = Math.abs(yval * 10) / 10;
  const params = { sprintName, value };
  if (seriesIndex === 1) return t('BACKLOG.CHART.OPTIMAL', params);
  if (seriesIndex === 2) return t('BACKLOG.CHART.REAL', params);
  if (seriesIndex === 3) return t('BACKLOG.CHART.INCREMENT_CLIENT', params);
  // seriesIndex 0 (never rendered) and 4 fall here → INCREMENT_TEAM (else branch).
  return t('BACKLOG.CHART.INCREMENT_TEAM', params);
}

/** A single plotted vertex in viewBox coordinates, plus its source data. */
interface PlotPoint {
  cx: number;
  cy: number;
  msIndex: number;
  yval: number;
}

/**
 * Renders the burndown chart, or `null` when there is no milestone data to plot
 * (the surrounding `.graphics-container` / `.empty-burndown` placeholder in
 * `BacklogApp` owns the no-data state, exactly as the AngularJS template did).
 */
export function Burndown({ stats }: BurndownProps) {
  const milestones = (stats?.milestones as BurndownMilestone[] | undefined) ?? [];
  const n = milestones.length;
  if (n === 0) {
    return null;
  }

  // --- Series y-values (main.coffee:1225-1256) ---------------------------- //
  const optimalVals = milestones.map((m) => num(m.optimal));
  // Evolution: NULLS FILTERED (legacy `_.filter(..., (e) -> e?)`), so this line
  // is shorter and its point i maps to milestone i (0-based), like the Flot zip.
  const evolutionVals = milestones
    .map((m) => m.evolution)
    .filter((e): e is number => e != null)
    .map((e) => num(e));
  const clientIncVals = milestones.map((m) => -num(m['team-increment']) - num(m['client-increment']));
  const teamIncVals = milestones.map((m) => -num(m['team-increment']));

  // --- Domains ------------------------------------------------------------ //
  const allY = [0, ...optimalVals, ...evolutionVals, ...clientIncVals, ...teamIncVals];
  const yMin = Math.min(...allY);
  const yMaxRaw = Math.max(...allY);
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw; // avoid divide-by-zero

  const xScale = (i: number): number =>
    n <= 1 ? PAD_L + PLOT_W / 2 : PAD_L + (i / (n - 1)) * PLOT_W;
  const yScale = (v: number): number =>
    PAD_T + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;

  const baselineY = yScale(0); // zero line — fill areas close to here

  /** Build the plotted points for a full-length series (x = 0..n-1). */
  const buildPoints = (vals: number[]): PlotPoint[] =>
    vals.map((v, i) => ({ cx: xScale(i), cy: yScale(v), msIndex: i, yval: v }));

  // seriesIndex → points. Series 0 (zero baseline) is intentionally omitted.
  const series: Array<{ seriesIndex: number; points: PlotPoint[] }> = [
    { seriesIndex: 1, points: buildPoints(optimalVals) },
    { seriesIndex: 2, points: buildPoints(evolutionVals) },
    { seriesIndex: 3, points: buildPoints(clientIncVals) },
    { seriesIndex: 4, points: buildPoints(teamIncVals) },
  ];

  const xAxisLabel = t('BACKLOG.CHART.XAXIS_LABEL'); // "Sprints"
  const yAxisLabel = t('BACKLOG.CHART.YAXIS_LABEL'); // "Points"

  return (
    <svg
      className="burndown-chart"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${yAxisLabel} / ${xAxisLabel} burndown chart`}
      // Taiga's compiled theme carries a bare `svg { width: 1rem; height: 1rem }`
      // icon rule. A `width="100%"` *attribute* has lower specificity than that
      // stylesheet rule and gets overridden (the chart collapsed to ~16x3px).
      // Setting width/height via *inline style* wins (highest specificity, no
      // `!important` in the theme), and the explicit `aspectRatio` guarantees the
      // 6:1 height (legacy `element.height(width / 6)`) is derived from the width
      // even if the browser does not infer the intrinsic ratio from the viewBox.
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        aspectRatio: `${VB_W} / ${VB_H}`,
      }}
      data-testid="burndown-chart"
    >
      {/* --- Grid / axes (Flot grid, borderColor #D8DEE9) --- */}
      {/* y-axis */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke={GRID_COLOR} strokeWidth={1} />
      {/* x-axis (bottom) */}
      <line
        x1={PAD_L}
        y1={PAD_T + PLOT_H}
        x2={PAD_L + PLOT_W}
        y2={PAD_T + PLOT_H}
        stroke={GRID_COLOR}
        strokeWidth={1}
      />
      {/* right border (Flot borderWidth.right = 1) */}
      <line
        x1={PAD_L + PLOT_W}
        y1={PAD_T}
        x2={PAD_L + PLOT_W}
        y2={PAD_T + PLOT_H}
        stroke={GRID_COLOR}
        strokeWidth={1}
      />
      {/* x-axis ticks: one per sprint, NO label text (tickFormatter -> "") */}
      {milestones.map((_m, i) => (
        <line
          key={`tick-${i}`}
          x1={xScale(i)}
          y1={PAD_T + PLOT_H}
          x2={xScale(i)}
          y2={PAD_T + PLOT_H + 3}
          stroke={GRID_COLOR}
          strokeWidth={1}
        />
      ))}

      {/* --- Series (back-to-front): fill area, then line, then points --- */}
      {series.map(({ seriesIndex, points }) => {
        if (points.length === 0) {
          return null;
        }
        const linePts = points.map((p) => `${p.cx},${p.cy}`).join(' ');
        // Fill polygon: along the line, then back along the zero baseline.
        const first = points[0];
        const last = points[points.length - 1];
        const areaPts = `${linePts} ${last.cx},${baselineY} ${first.cx},${baselineY}`;
        return (
          <g key={`series-${seriesIndex}`} data-series-index={seriesIndex}>
            {points.length > 1 ? (
              <polygon points={areaPts} fill={SERIES_FILL[seriesIndex]} stroke="none" />
            ) : null}
            {points.length > 1 ? (
              <polyline
                points={linePts}
                fill="none"
                stroke={SERIES_COLORS[seriesIndex]}
                strokeWidth={1.5}
              />
            ) : null}
            {points.map((p) => (
              <circle
                key={`pt-${seriesIndex}-${p.msIndex}`}
                cx={p.cx}
                cy={p.cy}
                r={3}
                fill={SERIES_COLORS[seriesIndex]}
                stroke={SERIES_COLORS[seriesIndex]}
                strokeWidth={1.5}
                data-series-index={seriesIndex}
                data-ms-index={p.msIndex}
              >
                <title>{pointTooltip(seriesIndex, milestones[p.msIndex]?.name ?? '', p.yval)}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {/* --- Axis labels (i18n keys the directive used) --- */}
      <text
        x={PAD_L + PLOT_W / 2}
        y={VB_H - 4}
        textAnchor="middle"
        fontSize={9}
        fontFamily="Verdana, Arial, Helvetica, Tahoma, sans-serif"
        fill="#788188"
      >
        {xAxisLabel}
      </text>
      <text
        x={10}
        y={PAD_T + PLOT_H / 2}
        textAnchor="middle"
        fontSize={9}
        fontFamily="Verdana, Arial, Helvetica, Tahoma, sans-serif"
        fill="#788188"
        transform={`rotate(-90 10 ${PAD_T + PLOT_H / 2})`}
      >
        {yAxisLabel}
      </text>
    </svg>
  );
}

export default Burndown;
