/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Burndown — the backlog "summary" region of the Backlog screen.
 *
 * This single presentational component reproduces the ENTIRE
 * `div.backlog-summary` region of the legacy `backlog.jade` (L20-L30), which in
 * AngularJS was composed of four cooperating pieces:
 *
 *   1. `summary.jade`                    -> the `.summary` stats block.
 *   2. `tgBacklogProgressBar` directive  -> the 3-segment summary progress bar
 *      (`main.coffee` `TgBacklogProgressBarDirective`, +`progress-bar.jade`).
 *   3. `tgToggleBurndownVisibility`      -> the show/hide burndown toggle
 *      (`main.coffee` `ToggleBurndownVisibility`). Persistence lives in
 *      `BacklogApp`; this component only reflects `collapsed`.
 *   4. `tgBurndownBacklogGraph`          -> the burndown chart
 *      (`main.coffee` `BurndownBacklogGraphDirective`), here re-implemented as a
 *      dependency-free inline `<svg>` (NO Flot / jQuery.flot).
 *
 * The component performs NO network calls: every value it renders arrives via
 * props. Visual parity is achieved by reproducing the exact DOM class names the
 * original Jade emitted, so the already-compiled SCSS themes it unchanged.
 *
 * i18n: the app default language is English, so literal English strings are
 * rendered inline and the corresponding `translate` key is preserved in an
 * adjacent `{/* i18n: BACKLOG.XXX *\/}` comment for traceability.
 */

import { useCallback, useMemo } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import type { BurndownPoint, Project, ProjectStats } from "./types";
import { t } from "../shared/i18n/translate";
import { projectAdminModulesUrl } from "../shared/nav/urls";

/**
 * Render a summary-stats label from the shared catalog ([i18n]) that embeds a
 * `<br />` (e.g. `BACKLOG.SUMMARY.PROJECT_POINTS = 'project<br />points'`). The
 * localized value is split on the `<br />` boundary and rendered as escaped React
 * text separated by real `<br />` elements — preserving the two-line layout AND
 * localization without `dangerouslySetInnerHTML`.
 */
function renderMultilineLabel(key: string, fallback: string): ReactNode {
    const rendered = t(key, fallback);
    const parts = rendered.split(/<br\s*\/?>/i);
    // [N-06] Build the interleaved [text, <br/>, text, ...] output with a plain
    // `reduce` instead of `Array.prototype.flatMap`. `flatMap` is ES2019, but the
    // esbuild bundle targets es2017 (gulpfile.js) and esbuild does NOT down-level
    // /polyfill runtime prototype methods — a `flatMap` call would therefore be
    // emitted verbatim and throw on an es2017 runtime that lacks it. `reduce` is
    // ES5 and safe on every supported target while producing identical markup.
    return parts.reduce<ReactNode[]>((acc, part, index) => {
        if (index === 0) {
            acc.push(part);
        } else {
            acc.push(<br key={`br-${index}`} />, part);
        }
        return acc;
    }, []);
}

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Props for {@link Burndown}. Mirrors the scope the AngularJS directives read
 * (`stats`, `project`, `showGraphPlaceholder`) plus the toggle state that
 * `BacklogApp` owns and persists to `$storage` on the caller's behalf.
 */
export interface BurndownProps {
    /** `rs.projects.stats(projectId)` result, or `null` before it has loaded. */
    stats: ProjectStats | null;
    /** Current project, or `null` before it has loaded (read for `i_am_admin`). */
    project: Project | null;
    /**
     * `!(stats.total_points? && stats.total_milestones?)` computed by the
     * controller: `true` when the project has no points/sprints configured yet
     * (so the burndown cannot be drawn), `null` while unknown.
     */
    showGraphPlaceholder: boolean | null;
    /** Whether the burndown graph is collapsed/hidden (persisted by BacklogApp). */
    collapsed: boolean;
    /** Invoked when the toggle is activated; BacklogApp flips + persists state. */
    onToggleCollapsed: () => void;
}

/* -------------------------------------------------------------------------- */
/* Numeric formatting                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reproduction of the AngularJS `| number[:decimals]` filter used by
 * `summary.jade`.
 *
 * Uses `Number#toLocaleString("en")` so grouping separators match the `en`
 * locale the app defaults to. Returns an empty string for `null`/`undefined`
 * (mirroring how `ng-bind` renders nothing when its expression is undefined),
 * so an unloaded `stats` produces blank cells rather than `"NaN"`.
 *
 * @param value    the numeric value (may be null/undefined before stats load)
 * @param decimals when provided, fixes both the min and max fraction digits
 *                 (the `speed` stat uses `number:0`)
 */
function formatNumber(value: number | null | undefined, decimals?: number): string {
    if (value === null || value === undefined) {
        return "";
    }

    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
        return "";
    }

    const options: Intl.NumberFormatOptions = {};
    if (decimals !== undefined) {
        options.minimumFractionDigits = decimals;
        options.maximumFractionDigits = decimals;
    }

    return numeric.toLocaleString("en", options);
}

/* -------------------------------------------------------------------------- */
/* Summary progress-bar math (ported 1:1 from tgBacklogProgressBar)           */
/* -------------------------------------------------------------------------- */

/**
 * The two computed segment widths (as whole-number percentages) rendered inside
 * `.summary-progress-bar`.
 */
interface ProgressBarWidths {
    projectPointsPercentaje: number;
    closedPointsPercentaje: number;
}

/**
 * `adjustPercentaje` from `TgBacklogProgressBarDirective`: clamp to `[0, 100]`
 * then round to the nearest integer. Equivalent to the source's
 * `_.max([0, p])` -> `_.min([100, ...])` -> `Math.round(...)`.
 */
function adjustPercentaje(percentage: number): number {
    return Math.round(Math.min(100, Math.max(0, percentage)));
}

/**
 * Compute the summary progress-bar segment widths with the EXACT algorithm from
 * `TgBacklogProgressBarDirective` (`main.coffee` ~L1364), including the
 * intentional `-3` offset applied before clamping.
 *
 * Divide-by-zero is guarded: when the relevant divisor (`definedPoints` or
 * `totalPoints`) is `0` the corresponding percentage falls back to `0` instead
 * of producing `NaN`/`Infinity` (the AngularJS original produced `NaN`, which
 * the browser silently dropped to a `0`-width element; the explicit `0` here is
 * behaviourally identical and safer).
 */
function computeProgressBar(stats: ProjectStats | null): ProgressBarWidths {
    if (!stats) {
        return { projectPointsPercentaje: 0, closedPointsPercentaje: 0 };
    }

    // `stats.total_points` is falsy (null or 0) -> fall back to defined_points,
    // exactly as `if stats.total_points then ... else stats.defined_points`.
    const totalPoints = stats.total_points ? stats.total_points : stats.defined_points;
    const definedPoints = stats.defined_points;
    const closedPoints = stats.closed_points;

    let projectPct: number;
    let closedPct: number;

    if (definedPoints > totalPoints) {
        projectPct = definedPoints !== 0 ? (totalPoints * 100) / definedPoints : 0;
        closedPct = definedPoints !== 0 ? (closedPoints * 100) / definedPoints : 0;
    } else {
        projectPct = 100;
        closedPct = totalPoints !== 0 ? (closedPoints * 100) / totalPoints : 0;
    }

    return {
        projectPointsPercentaje: adjustPercentaje(projectPct - 3),
        closedPointsPercentaje: adjustPercentaje(closedPct - 3),
    };
}

/**
 * `completedPercentage` for the `.data > .number` cell. Uses the value the
 * controller stored back onto `stats` when present, otherwise recomputes it
 * with the controller's own formula (`loadProjectStats`, `main.coffee` ~L258):
 * `Math.round(100 * closed_points / totalPoints)`, or `0` when there are no
 * points.
 */
function computeCompletedPercentage(stats: ProjectStats | null): number {
    if (!stats) {
        return 0;
    }

    if (typeof stats.completedPercentage === "number") {
        return stats.completedPercentage;
    }

    const totalPoints = stats.total_points ? stats.total_points : stats.defined_points;
    return totalPoints ? Math.round((100 * stats.closed_points) / totalPoints) : 0;
}

/* -------------------------------------------------------------------------- */
/* Shared icon                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Reproduction of `tg-svg(svg-icon="icon-graph")`. The AngularJS `tgSvg`
 * directive rendered `<svg class="icon icon-graph"><use xlink:href="#icon-graph"
 * href="#icon-graph"/></svg>`; the `#icon-graph` sprite symbol is injected into
 * the shared document (`app/svg/sprite.svg`) and resolves at runtime for both
 * frameworks. Both `xlinkHref` and `href` are emitted to match the original DOM
 * and to support browsers that only honour one.
 */
function IconGraph(): JSX.Element {
    return (
        <svg className="icon icon-graph" aria-hidden="true" focusable="false">
            <use xlinkHref="#icon-graph" href="#icon-graph" />
        </svg>
    );
}

/* -------------------------------------------------------------------------- */
/* Burndown chart (dependency-free reimplementation of tgBurndownBacklogGraph) */
/* -------------------------------------------------------------------------- */

// The AngularJS directive set the element height to width/6
// (`element.height(width/6)`); a fixed 6:1 viewBox reproduces that intrinsic
// ratio for a responsive, container-width <svg>.
const CHART_VIEWBOX_WIDTH = 600;
const CHART_VIEWBOX_HEIGHT = 100;

// Ported verbatim from the Flot `grid.margin` option.
const CHART_MARGIN = { top: 0, right: 20, bottom: 0, left: 5 } as const;

// Ported from the Flot `series.points.radius` / `series.points.lineWidth`.
const CHART_POINT_RADIUS = 4;
const CHART_LINE_WIDTH = 2;

// #D8DEE9 is the Flot `grid.borderColor` / `grid.color`.
const CHART_GRID_COLOR = "#D8DEE9";
// Axis-label typography: Flot used Verdana 12px. Rendered here in viewBox units
// (a 6:1, 100-tall viewBox) so a smaller size keeps the label proportionate.
const CHART_AXIS_FONT = "Verdana, Arial, Helvetica, Tahoma, sans-serif";
const CHART_AXIS_FONT_SIZE = 7;
const CHART_AXIS_LABEL_COLOR = "#727e8c";
// [G] Left gutter (viewBox units) reserved for the numeric y-axis tick labels,
// which sit between the rotated "Points" axis label (far left) and the plot.
const CHART_Y_TICK_LABEL_GUTTER = 24;
// x-position of the rotated "Points" axis label, kept at the far left edge so it
// never collides with the numeric tick labels that occupy the gutter.
const CHART_Y_AXIS_LABEL_X = 3;
// Target number of horizontal y-axis gridlines/ticks (Flot's default yaxis
// tick density). The "nice numbers" algorithm may return a few more or fewer.
const CHART_Y_TICK_TARGET = 5;

/**
 * Per-series visual styling, indexed to match Flot's series order (0..4):
 * 0 = zero line, 1 = optimal, 2 = evolution (real), 3 = client increment,
 * 4 = team increment.
 *
 * `fill` values are the Flot per-series `lines.fillColor`; `line` values are the
 * Flot `colors` array entries. Series 0 has a transparent fill and no markers,
 * exactly as the source configured (`points.show: false`).
 */
interface SeriesStyle {
    readonly fill: string;
    readonly line: string;
    readonly showPoints: boolean;
}

const SERIES_STYLES: readonly SeriesStyle[] = [
    { fill: "rgba(0,0,0,0)", line: "rgba(200,201,196,0.2)", showPoints: false },
    { fill: "rgba(200,201,196,0.2)", line: "rgba(216,222,233,1)", showPoints: true },
    { fill: "rgba(147,196,0,0.2)", line: "rgba(168,228,64,1)", showPoints: true },
    { fill: "rgba(200,201,196,0.2)", line: "rgba(216,222,233,1)", showPoints: true },
    { fill: "rgba(255,160,160,0.2)", line: "rgba(255,160,160,1)", showPoints: true },
];

/** A single plotted point: its milestone/x index and its y data value. */
interface ChartPoint {
    readonly plotIndex: number;
    readonly value: number;
}

/**
 * Tooltip text builder reproducing the Flot `tooltipOpts.content` formatter.
 * The `seriesIndex` mapping is 0-based (matching Flot): 1 -> OPTIMAL,
 * 2 -> REAL, 3 -> INCREMENT_CLIENT, otherwise INCREMENT_TEAM. Series 0 has no
 * markers so it never produces a tooltip.
 */
function chartTooltip(seriesIndex: number, sprintName: string, value: number): string {
    switch (seriesIndex) {
        case 1:
            return t(
                "BACKLOG.CHART.OPTIMAL",
                'Optimal pending points for sprint "{{sprintName}}" should be {{value}}',
                { sprintName, value },
            );
        case 2:
            return t("BACKLOG.CHART.REAL", 'Real pending points for sprint "{{sprintName}}" is {{value}}', {
                sprintName,
                value,
            });
        case 3:
            return t(
                "BACKLOG.CHART.INCREMENT_CLIENT",
                'Incremented points by client requirements for sprint "{{sprintName}}" is {{value}}',
                { sprintName, value },
            );
        default:
            return t(
                "BACKLOG.CHART.INCREMENT_TEAM",
                'Incremented points by team requirements for sprint "{{sprintName}}" is {{value}}',
                { sprintName, value },
            );
    }
}

/** Round to 2 dp for compact, deterministic SVG coordinate strings. */
function round2(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/**
 * Classic "nice number" rounding used by axis-tick generators (and by Flot's
 * own tick algorithm): round `range` to a 1/2/5 × 10^n value. When `round` is
 * true the nearest nice number is chosen; otherwise the ceiling nice number.
 */
function niceNum(range: number, round: boolean): number {
    if (!(range > 0)) {
        return 1;
    }
    const exponent = Math.floor(Math.log10(range));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction: number;
    if (round) {
        if (fraction < 1.5) niceFraction = 1;
        else if (fraction < 3) niceFraction = 2;
        else if (fraction < 7) niceFraction = 5;
        else niceFraction = 10;
    } else if (fraction <= 1) {
        niceFraction = 1;
    } else if (fraction <= 2) {
        niceFraction = 2;
    } else if (fraction <= 5) {
        niceFraction = 5;
    } else {
        niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
}

/** The result of {@link niceScale}: enclosing bounds + the tick values. */
export interface NiceScale {
    niceMin: number;
    niceMax: number;
    ticks: number[];
}

/**
 * Compute a "nice" numeric axis that ENCLOSES `[min, max]` and the evenly-spaced
 * tick values along it — the y-axis the AngularJS burndown got for free from
 * Flot (finding [G]: React drew the series but no numeric y-ticks). Handles
 * negative ranges (the React series include negative increments) and the
 * degenerate flat-series case (`min === max`).
 */
export function niceScale(min: number, max: number, maxTicks = CHART_Y_TICK_TARGET): NiceScale {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return { niceMin: 0, niceMax: 1, ticks: [0, 1] };
    }
    // Flat series: synthesize a small enclosing range so labels/scale exist.
    if (min === max) {
        if (min === 0) {
            return { niceMin: 0, niceMax: 1, ticks: [0, 1] };
        }
        const pad = Math.abs(min) * 0.5 || 1;
        min -= pad;
        max += pad;
    }
    const effectiveTicks = Math.max(2, maxTicks);
    const range = niceNum(max - min, false);
    const tickSpacing = niceNum(range / (effectiveTicks - 1), true) || 1;
    const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
    const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;
    const ticks: number[] = [];
    // Guard against pathological spacing producing an unbounded loop.
    const maxIterations = 1000;
    let iterations = 0;
    for (
        let value = niceMin;
        value <= niceMax + tickSpacing * 0.5 && iterations < maxIterations;
        value += tickSpacing, iterations += 1
    ) {
        // Snap to the tick grid to avoid floating-point drift (e.g. 0.30000004).
        ticks.push(Math.round(value / tickSpacing) * tickSpacing);
    }
    return { niceMin, niceMax, ticks };
}

/**
 * Format a y-axis tick value compactly: integers verbatim, otherwise trimmed to
 * at most 2 decimals (Flot's numeric ticks are unformatted, not thousands-grouped).
 */
function formatTick(value: number): string {
    if (Number.isInteger(value)) {
        return String(value);
    }
    return String(Math.round(value * 100) / 100);
}

/**
 * Derive the five burndown series from `milestones`, reproducing the sign
 * conventions of `BurndownBacklogGraphDirective.redrawChart`:
 *
 *   0 zero_line          -> constant 0
 *   1 optimal_line       -> ml.optimal
 *   2 evolution_line     -> ml.evolution, NULLs filtered out and re-indexed
 *                           from 0 (matching `_.filter` + `_.zip`)
 *   3 client_increment   -> -ml["team-increment"] - ml["client-increment"]
 *   4 team_increment     -> -ml["team-increment"]
 */
function deriveSeries(milestones: readonly BurndownPoint[]): ChartPoint[][] {
    const zeroLine: ChartPoint[] = milestones.map((_ml, index) => ({ plotIndex: index, value: 0 }));
    const optimalLine: ChartPoint[] = milestones.map((ml, index) => ({
        plotIndex: index,
        value: ml.optimal,
    }));

    // `_.filter(_.map(milestones, ml -> ml.evolution), (e) -> e?)`: drop null
    // entries, then re-index the survivors positionally from 0.
    const evolutionLine: ChartPoint[] = milestones
        .map((ml) => ml.evolution)
        .filter((evolution): evolution is number => evolution !== null && evolution !== undefined)
        .map((value, index) => ({ plotIndex: index, value }));

    const clientIncrementLine: ChartPoint[] = milestones.map((ml, index) => ({
        plotIndex: index,
        value: -ml["team-increment"] - ml["client-increment"],
    }));
    const teamIncrementLine: ChartPoint[] = milestones.map((ml, index) => ({
        plotIndex: index,
        value: -ml["team-increment"],
    }));

    return [zeroLine, optimalLine, evolutionLine, clientIncrementLine, teamIncrementLine];
}

/**
 * Dependency-free inline-SVG reimplementation of `tgBurndownBacklogGraph`.
 *
 * Renders the five derived series (see {@link deriveSeries}) into a responsive
 * 6:1 `<svg>`: faint per-milestone gridlines and a zero baseline first, then for
 * each data series a translucent area polygon filled to the baseline, a stroked
 * line, and — for series 1..4 — circular markers carrying a native `<title>`
 * tooltip. A linear scale maps the combined min/max of ALL series (several of
 * which are negative) onto the vertical range.
 *
 * When there are no milestones the caller renders an empty `.burndown`
 * container, but this component also guards against the empty case so it never
 * throws if invoked directly.
 */
function BurndownChart({ milestones }: { milestones: readonly BurndownPoint[] }): JSX.Element | null {
    const geometry = useMemo(() => {
        const count = milestones.length;
        if (count === 0) {
            return null;
        }

        const series = deriveSeries(milestones);

        // Combined min/max across every plotted value (the zero line guarantees
        // 0 is always inside the range).
        const allValues = series.reduce<number[]>((acc, points) => {
            for (const point of points) {
                if (Number.isFinite(point.value)) {
                    acc.push(point.value);
                }
            }
            return acc;
        }, []);
        const rawMin = allValues.length ? Math.min(...allValues) : 0;
        const rawMax = allValues.length ? Math.max(...allValues) : 0;

        // [G] Expand the data range to a "nice" enclosing axis so we can draw
        // evenly-spaced, human-readable numeric y-ticks (0 / 250 / 500 …) — the
        // axis Flot produced for the AngularJS burndown. The zero-line series
        // guarantees 0 is inside [rawMin, rawMax], so it stays on the axis.
        const scale = niceScale(rawMin, rawMax, CHART_Y_TICK_TARGET);
        const minValue = scale.niceMin;
        const maxValue = scale.niceMax;
        const valueRange = maxValue - minValue || 1;

        // Inset the data plot by the marker radius so top/bottom/edge markers are
        // never clipped (Flot reserves this space outside its grid too). The left
        // inset ALSO reserves a gutter for the numeric y-tick labels ([G]).
        const innerLeft =
            CHART_MARGIN.left + CHART_Y_TICK_LABEL_GUTTER + CHART_POINT_RADIUS;
        const innerRight = CHART_VIEWBOX_WIDTH - CHART_MARGIN.right - CHART_POINT_RADIUS;
        const innerTop = CHART_MARGIN.top + CHART_POINT_RADIUS;
        const innerBottom = CHART_VIEWBOX_HEIGHT - CHART_MARGIN.bottom - CHART_POINT_RADIUS;
        const plotWidth = innerRight - innerLeft;
        const plotHeight = innerBottom - innerTop;

        const xFor = (plotIndex: number): number =>
            count <= 1 ? innerLeft + plotWidth / 2 : innerLeft + (plotIndex / (count - 1)) * plotWidth;
        const yFor = (value: number): number =>
            innerBottom - ((value - minValue) / valueRange) * plotHeight;

        const baselineY = Math.min(innerBottom, Math.max(innerTop, yFor(0)));

        // Faint vertical gridline per milestone (x-axis ticks = milestones.length).
        const gridLines = milestones.map((_ml, index) => ({
            key: `grid-${index}`,
            x: round2(xFor(index)),
            top: round2(innerTop),
            bottom: round2(innerBottom),
        }));

        // [G] Horizontal y-axis ticks: one gridline + numeric label per nice tick
        // that falls within the plotted range.
        const yTicks = scale.ticks
            .filter((value) => value >= minValue - 1e-9 && value <= maxValue + 1e-9)
            .map((value) => ({
                key: `ytick-${value}`,
                value,
                label: formatTick(value),
                y: round2(yFor(value)),
            }));

        return {
            count,
            series,
            innerLeft,
            innerRight,
            innerTop,
            innerBottom,
            baselineY: round2(baselineY),
            gridLines,
            yTicks,
            xFor,
            yFor,
        };
    }, [milestones]);

    if (!geometry) {
        return null;
    }

    const {
        series,
        innerLeft,
        innerRight,
        innerTop,
        innerBottom,
        baselineY,
        gridLines,
        yTicks,
        xFor,
        yFor,
    } = geometry;

    return (
        <svg
            className="burndown-chart"
            viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={t("BACKLOG.CHART.ARIA_LABEL", "Burndown chart")}
            style={{ width: "100%", height: "auto", display: "block" }}
        >
            {/* Gridlines + zero baseline (Flot grid.color / borderColor #D8DEE9). */}
            <g stroke={CHART_GRID_COLOR} strokeWidth={0.5} aria-hidden="true">
                {/* [G] Horizontal y-axis gridlines, one per numeric tick. */}
                {yTicks.map((tick) => (
                    <line
                        key={tick.key}
                        x1={round2(innerLeft)}
                        y1={tick.y}
                        x2={round2(innerRight)}
                        y2={tick.y}
                        opacity={0.5}
                    />
                ))}
                {gridLines.map((line) => (
                    <line key={line.key} x1={line.x} y1={line.top} x2={line.x} y2={line.bottom} opacity={0.6} />
                ))}
                <line x1={round2(innerLeft)} y1={baselineY} x2={round2(innerRight)} y2={baselineY} />
                {/* Flot grid.borderWidth right:1 — the single drawn plot border. */}
                <line x1={round2(innerRight)} y1={round2(innerTop)} x2={round2(innerRight)} y2={round2(innerBottom)} strokeWidth={1} />
            </g>

            {/* [G] Numeric y-axis tick labels, right-aligned just left of the plot. */}
            <g aria-hidden="true">
                {yTicks.map((tick) => (
                    <text
                        key={`ylabel-${tick.value}`}
                        x={round2(innerLeft - CHART_POINT_RADIUS - 2)}
                        y={tick.y}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fontFamily={CHART_AXIS_FONT}
                        fontSize={CHART_AXIS_FONT_SIZE}
                        fill={CHART_AXIS_LABEL_COLOR}
                    >
                        {tick.label}
                    </text>
                ))}
            </g>

            {/* Data series: area fill, then line, then markers with tooltips. */}
            {series.map((points, seriesIndex) => {
                const style = SERIES_STYLES[seriesIndex];
                if (points.length === 0) {
                    return null;
                }

                const linePointsList = points.map(
                    (point) => `${round2(xFor(point.plotIndex))},${round2(yFor(point.value))}`,
                );
                const linePoints = linePointsList.join(" ");

                const firstX = round2(xFor(points[0].plotIndex));
                const lastX = round2(xFor(points[points.length - 1].plotIndex));
                const areaPoints = `${linePoints} ${lastX},${baselineY} ${firstX},${baselineY}`;
                const drawArea = style.fill !== "rgba(0,0,0,0)" && points.length >= 2;

                return (
                    <g key={`series-${seriesIndex}`}>
                        {drawArea ? (
                            <polygon points={areaPoints} fill={style.fill} stroke="none" />
                        ) : null}
                        <polyline
                            points={linePoints}
                            fill="none"
                            stroke={style.line}
                            strokeWidth={CHART_LINE_WIDTH}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                        />
                        {style.showPoints
                            ? points.map((point) => {
                                  const sprintName = milestones[point.plotIndex]?.name ?? "";
                                  const tooltipValue = Math.abs(Math.round(point.value * 10) / 10);
                                  return (
                                      <circle
                                          key={`p-${seriesIndex}-${point.plotIndex}`}
                                          cx={round2(xFor(point.plotIndex))}
                                          cy={round2(yFor(point.value))}
                                          r={CHART_POINT_RADIUS}
                                          fill={style.line}
                                      >
                                          <title>{chartTooltip(seriesIndex, sprintName, tooltipValue)}</title>
                                      </circle>
                                  );
                              })
                            : null}
                    </g>
                );
            })}

            {/* Axis labels (Flot xaxis/yaxis axisLabel), Verdana per source. */}
            <text
                x={CHART_VIEWBOX_WIDTH / 2}
                y={CHART_VIEWBOX_HEIGHT - 1}
                textAnchor="middle"
                fontFamily={CHART_AXIS_FONT}
                fontSize={CHART_AXIS_FONT_SIZE}
                fill={CHART_AXIS_LABEL_COLOR}
            >
                {t("BACKLOG.CHART.XAXIS_LABEL", "Sprints")}
            </text>
            <text
                x={CHART_Y_AXIS_LABEL_X}
                y={CHART_VIEWBOX_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 ${CHART_Y_AXIS_LABEL_X} ${CHART_VIEWBOX_HEIGHT / 2})`}
                fontFamily={CHART_AXIS_FONT}
                fontSize={CHART_AXIS_FONT_SIZE}
                fill={CHART_AXIS_LABEL_COLOR}
            >
                {t("BACKLOG.CHART.YAXIS_LABEL", "Points")}
            </text>
        </svg>
    );
}

/* -------------------------------------------------------------------------- */
/* Public component                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The backlog summary region: summary stats + progress bar + burndown graph +
 * show/hide toggle. See the module docblock for the source mapping.
 */
export function Burndown(props: BurndownProps): JSX.Element {
    const { stats, project, showGraphPlaceholder, collapsed, onToggleCollapsed } = props;

    // Progress-bar widths, memoised on `stats` (matches the directive's
    // `$watch $attrs.tgBacklogProgressBar`).
    const { projectPointsPercentaje, closedPointsPercentaje } = useMemo(
        () => computeProgressBar(stats),
        [stats],
    );
    const completedPercentage = useMemo(() => computeCompletedPercentage(stats), [stats]);

    const milestones = stats?.milestones ?? [];
    const hasMilestones = milestones.length > 0;

    // `ng-if="!showGraphPlaceholder"` — a null (unknown) placeholder still shows
    // the toggle, exactly as the AngularJS truthiness check did.
    const showToggle = !showGraphPlaceholder;
    // `ng-if="showGraphPlaceholder && project.i_am_admin"`.
    const showPlaceholder = Boolean(showGraphPlaceholder) && Boolean(project?.i_am_admin);

    // The toggle directive added `.active` to the button and `.shown`/`.open` to
    // `.js-burndown-graph` when the graph is visible (i.e. not collapsed).
    const graphVisible = !collapsed;
    const graphicsContainerClassName = graphVisible
        ? "graphics-container js-burndown-graph shown open"
        : "graphics-container js-burndown-graph";
    const toggleClassName = graphVisible
        ? "stats js-toggle-burndown-visibility-button active"
        : "stats js-toggle-burndown-visibility-button";

    // Keyboard parity: Enter / Space activate the toggle just like a click.
    const handleToggleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                event.preventDefault();
                onToggleCollapsed();
            }
        },
        [onToggleCollapsed],
    );

    return (
        <div className="backlog-summary">
            {/* (A) summary.jade — the `.summary` stats block */}
            <div className="summary">
                {/* (B) tg-backlog-progress-bar="stats" — the 3-segment progress bar */}
                <div className="summary-progress-bar">
                    <div className="defined-points" title={t("BACKLOG.EXCESS_OF_POINTS", "Excess of points")} />
                    <div
                        className="project-points-progress"
                        title={t("BACKLOG.PENDING_POINTS", "Pending Points")}
                        style={{ width: `${projectPointsPercentaje}%` }}
                    />
                    <div
                        className="closed-points-progress"
                        title={t("BACKLOG.CLOSED_POINTS", "closed")}
                        style={{ width: `${closedPointsPercentaje}%` }}
                    />
                </div>

                <div className="data">
                    <span className="number">{completedPercentage}%</span>
                </div>

                {stats?.total_points != null ? (
                    <div className="summary-stats">
                        <span className="number">{formatNumber(stats.total_points)}</span>
                        <span className="description">
                            {renderMultilineLabel("BACKLOG.SUMMARY.PROJECT_POINTS", "project<br />points")}
                        </span>
                    </div>
                ) : null}

                <div className="summary-stats">
                    <span className="number">{formatNumber(stats?.defined_points)}</span>
                    <span className="description">
                        {renderMultilineLabel("BACKLOG.SUMMARY.DEFINED_POINTS", "defined<br />points")}
                    </span>
                </div>

                <div className="summary-stats">
                    <span className="number">{formatNumber(stats?.closed_points)}</span>
                    <span className="description">
                        {renderMultilineLabel("BACKLOG.SUMMARY.CLOSED_POINTS", "closed<br />points")}
                    </span>
                </div>

                <div className="summary-stats">
                    <span className="number">{formatNumber(stats?.speed, 0)}</span>
                    <span className="description">
                        {renderMultilineLabel("BACKLOG.SUMMARY.POINTS_PER_SPRINT", "points /<br />sprint")}
                    </span>
                </div>

                {showToggle ? (
                    <div
                        className={toggleClassName}
                        title={t("BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH", "Show/Hide burndown graph")}
                        aria-label={t("BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH", "Show/Hide burndown graph")}
                        onClick={onToggleCollapsed}
                        onKeyDown={handleToggleKeyDown}
                        role="button"
                        tabIndex={0}
                        aria-pressed={graphVisible}
                    >
                        <IconGraph />
                    </div>
                ) : null}
            </div>

            {/* (C) empty-burndown placeholder — admins with no points/sprints set up */}
            {showPlaceholder ? (
                <div className="empty-burndown">
                    <IconGraph />
                    <div className="empty-text">
                        <p className="title">
                            {t("BACKLOG.CUSTOMIZE_GRAPH", "Customize your backlog graph")}
                        </p>
                        <p>
                            {t(
                                "BACKLOG.CUSTOMIZE_GRAPH_TEXT",
                                "To have a nice graph that helps you follow the evolution of the project you have to set up the points and sprints through the",
                            )}{" "}
                            <a
                                href={
                                    project
                                        ? projectAdminModulesUrl(project.slug)
                                        : undefined
                                }
                                title={t(
                                    "BACKLOG.CUSTOMIZE_GRAPH_TITLE",
                                    "Set up the points and sprints through the Admin",
                                )}
                            >
                                {t("BACKLOG.CUSTOMIZE_GRAPH_ADMIN", "Admin")}
                            </a>
                        </p>
                    </div>
                </div>
            ) : null}

            {/* (D) burndown graph container — visible when not collapsed */}
            <div className={graphicsContainerClassName} data-collapsed={collapsed ? "true" : undefined}>
                <div className="burndown">
                    {hasMilestones ? <BurndownChart milestones={milestones} /> : null}
                </div>
            </div>
        </div>
    );
}

