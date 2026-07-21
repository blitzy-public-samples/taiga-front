/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BurndownChart — the backlog burndown graph (render-only).
 *
 * React port of the AngularJS `tgBurndownBacklogGraph` directive (retired
 * `app/coffee/modules/backlog/main.coffee`, `BurndownBacklogGraphDirective`).
 * The legacy directive plotted five series with the jQuery **Flot** plugin
 * (`element.plot(data, options)`); Flot — or any charting library — is NOT in
 * the AAP React dependency inventory (§0.5.1, which permits only `immer` and
 * `@dnd-kit/core`), and the Minimal Change Clause (§0.7.1) forbids adding a
 * dependency beyond the migration requirements. This component therefore
 * reproduces the exact same five series as a HAND-ROLLED inline SVG with zero
 * new dependencies, restoring behavioral/visual parity (QA dest#6 / w023#4)
 * without violating the frozen plan.
 *
 * Faithful reproduction of the directive's `redrawChart`:
 *   - x-axis  = milestone index `[0 .. milestones.length - 1]`
 *     (`milestonesRange`), with empty tick labels (`tickFormatter -> ""`).
 *   - series 0 `zero_line`     : constant 0 — the baseline. Flot drew it fully
 *     transparent with points hidden; here it is the reference axis line.
 *   - series 1 `optimal_line`  : `ml.optimal` (the ideal-burndown line).
 *   - series 2 `evolution_line`: `ml.evolution` COMPACTED to non-null values
 *     (`_.filter(..., e?)`), i.e. the real line stops at the last recorded
 *     sprint — exactly matching the legacy `_.zip(range, evolution)` truncation.
 *   - series 3 `client_increment_line`: `-team_increment - client_increment`
 *     (plotted below the baseline).
 *   - series 4 `team_increment_line`  : `-team_increment` (below the baseline).
 * The line/fill colours are copied verbatim from the directive's `colors`
 * array and per-series `lines.fillColor`; each series fills down to the zero
 * baseline (Flot `series.lines.fill: true`) and shows filled point markers
 * (`points.show: true, radius: 4`).
 *
 * Pure presentational component: it receives the `milestones` stats slice via
 * props, holds no state, and performs NO fetch/API/WebSocket work (the data is
 * already fetched by `useBacklog.reloadStats` → `GET /projects/{id}/stats`, so
 * NO new network request or contract change is introduced — dest#6's "no
 * burndown-data request fires" is satisfied by reusing the existing stats call).
 * It renders into the retained `.burndown` container (`burndown.scss`, kept as
 * REFERENCE per §0.2.1) and adds no SCSS of its own.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement.
 */

import { translate } from '../../shared/i18n';
import type { BurndownMilestoneStat } from '../state/backlogReducer';

/**
 * Props for {@link BurndownChart}. `milestones` may be null/undefined before the
 * stats payload loads (the component renders nothing in that case, mirroring the
 * directive's `if $scope.stats?` guard).
 */
export interface BurndownChartProps {
    milestones: BurndownMilestoneStat[] | null | undefined;
}

/* ------------------------------------------------------------------------- *
 * Flot-faithful geometry. The directive sized the canvas to a 6:1 aspect
 * ratio (`element.height(element.width() / 6)`); the SVG keeps that ratio via
 * its `viewBox` while scaling fluidly to the `.burndown` container width.
 * ------------------------------------------------------------------------- */
const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 120;
const MARGIN = { top: 10, right: 24, bottom: 22, left: 42 } as const;
const PLOT_WIDTH = VIEWBOX_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - MARGIN.top - MARGIN.bottom;

/* Per-series line + fill colours, copied verbatim from the legacy directive's
 * `colors` array and the per-series `lines.fillColor` values. */
const GRID_COLOR = '#D8DEE9';
/* F-VIS-05: Y-axis numeric tick labels — a readable gray (slightly darker than
 * the faint gridlines) matching the baseline Flot axis numbers. */
const AXIS_TICK_COLOR = '#A0A9B4';
const SERIES_STYLE = {
    optimal: { line: 'rgba(216,222,233,1)', fill: 'rgba(200,201,196,0.2)' },
    evolution: { line: 'rgba(168,228,64,1)', fill: 'rgba(147,196,0,0.2)' },
    client: { line: 'rgba(216,222,233,1)', fill: 'rgba(200,201,196,0.2)' },
    team: { line: 'rgba(255,160,160,1)', fill: 'rgba(255,160,160,0.2)' },
} as const;

/** A resolved point in SVG user-space coordinates. */
interface ChartPoint {
    x: number;
    y: number;
    /** Milestone this marker belongs to (drives the hover tooltip). */
    milestoneName: string;
    /** Tooltip-formatted magnitude: `Math.abs(Math.round(value * 10) / 10)`. */
    tipValue: number;
}

/** One plotted series after scaling, ready to render. */
interface ResolvedSeries {
    key: keyof typeof SERIES_STYLE;
    points: ChartPoint[];
    /** i18n key + English fallback for the per-point hover tooltip. */
    tipKey: string;
    tipFallback: string;
}

/**
 * F-VIS-05: compute a "nice" ascending set of Y-axis tick values spanning
 * `[min, max]`, reproducing the numeric scale the legacy Flot plot drew (e.g.
 * `0 / 250 / 500 / 750 / 1000` for a ~806-point project). Targets roughly
 * `target` intervals and snaps the step to a nice `1 / 2.5 / 5 / 10 × 10^k`
 * value — Flot uses the same `2.5` step — then extends the range outward to
 * whole steps so the outermost ticks bound the data. Returns `[]` for a
 * degenerate or non-finite range (caller then keeps the raw data scale).
 */
function computeYTicks(min: number, max: number, target = 5): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return [];
    }
    const rawStep = (max - min) / target;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude; // 1 .. 10
    let niceNormalized: number;
    if (normalized < 1.5) {
        niceNormalized = 1;
    } else if (normalized < 3) {
        niceNormalized = 2.5;
    } else if (normalized < 7) {
        niceNormalized = 5;
    } else {
        niceNormalized = 10;
    }
    const step = niceNormalized * magnitude;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    // Half-step epsilon guards the loop bound against floating-point dust.
    for (let value = start; value <= end + step / 2; value += step) {
        // Snap to the step grid to erase accumulated FP error (and -0).
        const snapped = Math.round(value / step) * step;
        ticks.push(snapped === 0 ? 0 : snapped);
    }
    return ticks;
}

/**
 * Build the SVG for a single series: the filled area (down to the zero
 * baseline, matching Flot's `lines.fill: true`), the connecting stroke, and a
 * filled circular marker per point carrying a native `<title>` tooltip that
 * reproduces the legacy Flot `tooltipOpts.content` string.
 */
function renderSeries(series: ResolvedSeries, zeroY: number) {
    const style = SERIES_STYLE[series.key];
    const { points } = series;
    if (points.length === 0) {
        return null;
    }

    // Area path: baseline → up to the first point → along the line → back down
    // to the baseline → close. Degenerates harmlessly to a zero-width sliver
    // for a single point.
    const first = points[0];
    const last = points[points.length - 1];
    const lineSegments = points.map((p) => `L ${p.x} ${p.y}`).join(' ');
    const areaPath = `M ${first.x} ${zeroY} ${lineSegments} L ${last.x} ${zeroY} Z`;

    // Stroke polyline through the points (only meaningful for 2+ points).
    const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

    return (
        <g className={`burndown-series burndown-series-${series.key}`}>
            <path d={areaPath} fill={style.fill} stroke="none" />
            {points.length > 1 && (
                <polyline
                    points={polyline}
                    fill="none"
                    stroke={style.line}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            )}
            {points.map((p, i) => (
                <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={3}
                    fill={style.line}
                    stroke="#fff"
                    strokeWidth={1}
                >
                    <title>
                        {translate(
                            series.tipKey,
                            { sprintName: p.milestoneName, value: p.tipValue },
                            series.tipFallback,
                        )}
                    </title>
                </circle>
            ))}
        </g>
    );
}

/**
 * Backlog burndown graph. Reproduces the exact five-series Flot plot the
 * AngularJS `tgBurndownBacklogGraph` directive rendered, as a dependency-free
 * inline SVG, reusing the existing `.burndown` container for layout fidelity.
 */
export function BurndownChart(props: BurndownChartProps) {
    const milestones = props.milestones;

    // Mirror the directive's `if $scope.stats?` guard: with no milestone data
    // there is nothing to plot, so render nothing (the collapsible container +
    // toggle remain, exactly as before).
    if (!milestones || milestones.length === 0) {
        return null;
    }

    const n = milestones.length;

    // ----- Series values (index-aligned to milestones, except `evolution`,
    // which is COMPACTED to non-null values exactly like the directive's
    // `_.filter(_.map(...evolution), (e) -> e?)` then `_.zip(range, ...)`). -----
    const optimalVals = milestones.map((m) => m.optimal);
    const evolutionVals = milestones
        .map((m) => m.evolution)
        .filter((e): e is number => e != null);
    const clientVals = milestones.map(
        (m) => -(m['team-increment'] ?? 0) - (m['client-increment'] ?? 0),
    );
    const teamVals = milestones.map((m) => -(m['team-increment'] ?? 0));

    // ----- Scales. Include 0 so the baseline is always in range; guard against
    // a degenerate (all-equal) range to avoid divide-by-zero. -----
    const allValues = [0, ...optimalVals, ...evolutionVals, ...clientVals, ...teamVals].filter(
        (v) => Number.isFinite(v),
    );
    let yMax = Math.max(...allValues);
    let yMin = Math.min(...allValues);
    if (yMax === yMin) {
        yMax += 1;
        yMin -= 1;
    }
    // F-VIS-05: derive the nice numeric Y ticks, then SNAP the scale to the
    // outermost ticks so the plotted series rest on the same gridlines the
    // baseline Flot plot used (e.g. the ~750 evolution line sits on the "750"
    // tick with a 0..1000 scale). Degenerate ranges keep the raw data scale.
    const yTicks = computeYTicks(yMin, yMax);
    if (yTicks.length >= 2) {
        yMin = yTicks[0];
        yMax = yTicks[yTicks.length - 1];
    }
    const yRange = yMax - yMin;

    const xFor = (i: number): number =>
        n <= 1 ? MARGIN.left + PLOT_WIDTH / 2 : MARGIN.left + (i / (n - 1)) * PLOT_WIDTH;
    const yFor = (v: number): number => MARGIN.top + ((yMax - v) / yRange) * PLOT_HEIGHT;
    const zeroY = yFor(0);

    // Tooltip magnitude formatter — the directive used `Math.abs(yval * 10) / 10`
    // (one decimal place, always positive since the increment series are drawn
    // negative but reported as magnitudes).
    const tipValue = (v: number): number => Math.abs(Math.round(v * 10) / 10);

    const toPoints = (values: number[]): ChartPoint[] =>
        values.map((v, i) => ({
            x: xFor(i),
            y: yFor(v),
            // Point i maps to milestone i for every series (evolution's compacted
            // index equals its Flot x-value, so `milestones[xval]` still applies).
            milestoneName: milestones[i]?.name ?? '',
            tipValue: tipValue(v),
        }));

    // Paint order matches Flot's series order (later series drawn on top).
    const series: ResolvedSeries[] = [
        {
            key: 'optimal',
            points: toPoints(optimalVals),
            tipKey: 'BACKLOG.CHART.OPTIMAL',
            tipFallback:
                'Optimal pending points for sprint "{{sprintName}}" should be {{value}}',
        },
        {
            key: 'evolution',
            points: toPoints(evolutionVals),
            tipKey: 'BACKLOG.CHART.REAL',
            tipFallback: 'Real pending points for sprint "{{sprintName}}" is {{value}}',
        },
        {
            key: 'client',
            points: toPoints(clientVals),
            tipKey: 'BACKLOG.CHART.INCREMENT_CLIENT',
            tipFallback:
                'Incremented points by client requirements for sprint "{{sprintName}}" is {{value}}',
        },
        {
            key: 'team',
            points: toPoints(teamVals),
            tipKey: 'BACKLOG.CHART.INCREMENT_TEAM',
            tipFallback:
                'Incremented points by team requirements for sprint "{{sprintName}}" is {{value}}',
        },
    ];

    const plotRight = MARGIN.left + PLOT_WIDTH;
    const plotBottom = MARGIN.top + PLOT_HEIGHT;
    const xAxisLabel = translate('BACKLOG.CHART.XAXIS_LABEL', undefined, 'Sprints');
    const yAxisLabel = translate('BACKLOG.CHART.YAXIS_LABEL', undefined, 'Points');

    return (
        <svg
            className="burndown-graph"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${yAxisLabel} burndown across ${n} ${xAxisLabel.toLowerCase()}`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
        >
            {/* Grid: faint per-milestone verticals (Flot `xaxis.ticks`, empty
                labels), the right border (Flot grid `borderWidth.right: 1`), and
                the zero baseline the series fill down to. */}
            <g className="burndown-grid" stroke={GRID_COLOR} strokeWidth={1}>
                {milestones.map((_m, i) => (
                    <line key={i} x1={xFor(i)} y1={MARGIN.top} x2={xFor(i)} y2={plotBottom} opacity={0.4} />
                ))}
                <line x1={plotRight} y1={MARGIN.top} x2={plotRight} y2={plotBottom} />
                <line x1={MARGIN.left} y1={zeroY} x2={plotRight} y2={zeroY} />
            </g>

            {/* F-VIS-05: numeric Y-axis scale (Flot `yaxis.ticks`) — a faint
                horizontal gridline plus a right-aligned value label per tick in
                the left gutter. Restores the baseline "1000 / 750 / 500 / 250 /
                0" scale the React port had omitted. Rendered before the series so
                the gridlines sit behind them; the labels live left of the plot
                (x < MARGIN.left) so the series never cover them. */}
            <g className="burndown-yaxis">
                {yTicks.map((tick) => {
                    const tickY = yFor(tick);
                    return (
                        <g key={tick}>
                            <line
                                x1={MARGIN.left}
                                y1={tickY}
                                x2={plotRight}
                                y2={tickY}
                                stroke={GRID_COLOR}
                                strokeWidth={1}
                                opacity={0.4}
                            />
                            <text
                                className="burndown-axis-tick burndown-axis-tick-y"
                                x={MARGIN.left - 6}
                                y={tickY + 3}
                                textAnchor="end"
                                fontSize={9}
                                fill={AXIS_TICK_COLOR}
                            >
                                {String(tick)}
                            </text>
                        </g>
                    );
                })}
            </g>

            {/* Data series, in Flot paint order. */}
            {series.map((s) => (
                <g key={s.key}>{renderSeries(s, zeroY)}</g>
            ))}

            {/* Axis labels (Flot `axisLabel`s). X centered under the plot; Y
                rotated up the left gutter. */}
            <text
                className="burndown-axis-label burndown-axis-x"
                x={MARGIN.left + PLOT_WIDTH / 2}
                y={VIEWBOX_HEIGHT - 4}
                textAnchor="middle"
                fontSize={10}
                fill={GRID_COLOR}
            >
                {xAxisLabel}
            </text>
            <text
                className="burndown-axis-label burndown-axis-y"
                x={12}
                y={MARGIN.top + PLOT_HEIGHT / 2}
                textAnchor="middle"
                fontSize={10}
                fill={GRID_COLOR}
                transform={`rotate(-90 12 ${MARGIN.top + PLOT_HEIGHT / 2})`}
            >
                {yAxisLabel}
            </text>
        </svg>
    );
}
