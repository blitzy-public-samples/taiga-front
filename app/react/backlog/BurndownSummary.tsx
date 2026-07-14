/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BurndownSummary
 * ---------------
 * Presentational, DOM-preserving React reproduction of the AngularJS Backlog
 * screen's "backlog summary" region. It emits the exact class names and element
 * hierarchy that the (unchanged) Taiga SCSS targets, so the migrated React
 * screen is styled pixel-identically without touching any stylesheet. It is a
 * leaf component consumed by `./Backlog.tsx`.
 *
 * Source lineage (reference-only AngularJS originals this reproduces; never edited):
 *   - app/partials/includes/components/summary.jade        -> the `div.summary` stats panel
 *   - app/partials/backlog/progress-bar.jade               -> the `.summary-progress-bar` inner bars
 *   - app/coffee/modules/backlog/main.coffee (L1345-1385)  -> TgBacklogProgressBarDirective percentage math
 *   - app/coffee/modules/backlog/main.coffee (L1166-1210)  -> tgToggleBurndownVisibility show/hide behavior
 *   - app/coffee/modules/backlog/main.coffee (L1217-1338)  -> TgBurndownBacklogGraphDirective (Flot chart)
 *   - app/partials/backlog/backlog.jade (L20-30)           -> the `div.backlog-summary` wrapper + burndown container
 *
 * SCSS this DOM is styled by (unchanged; the visual source of truth):
 *   - app/styles/components/summary.scss     (.summary, .summary-progress-bar, .summary-stats,
 *                                              .data .number, .stats, .empty-burndown, .graphics-container)
 *   - app/styles/modules/backlog/burndown.scss  (.burndown { width: 100% })
 *
 * i18n: every displayed label is resolved through the React i18n runtime
 * `t()` (`app/react/shared/i18n/translate.ts`), which compiles in the same
 * `locale-en.json` message bundle the AngularJS `$translate` used. No raw
 * `BACKLOG.*` key is ever shown to the user. The few summary labels whose
 * message contains an inline `<br />` (e.g. `defined<br />points`) are split so
 * the reproduced `.description` span carries a real `<br>` node, matching the
 * DOM the legacy `translate` directive produced. All content is either numeric
 * stats or static translated copy rendered through React's default escaping.
 */

import { Fragment, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "../shared/i18n/translate";
import { BURNDOWN_CHART_COLORS } from "../shared/theme/colors";

/**
 * A single burndown milestone data point, mirroring one entry of the frozen
 * `GET /projects/{id}/stats` `milestones` array (taiga-back
 * `taiga/projects/services/stats.py` `_get_milestones_stats_for_backlog`):
 * each entry carries a scalar `optimal`, a scalar (nullable) `evolution`, and
 * the two increment fields (hyphenated exactly as the backend serializes them).
 */
export interface BurndownMilestoneStat {
    /** Sprint name (or a localized "Future sprint" / "Project End" sentinel). */
    name?: string;
    /** Optimal remaining points for this sprint (descending "ideal" line). */
    optimal?: number | null;
    /** Real remaining points (the burndown "evolution" line); `null` for future sprints. */
    evolution?: number | null;
    /** Cumulative team-increment points (added scope from the team). */
    "team-increment"?: number | null;
    /** Cumulative client-increment points (added scope from the client). */
    "client-increment"?: number | null;
}

/**
 * Shape of the aggregate backlog statistics consumed by the summary region.
 *
 * This is the single source of truth for the stats shape across the React
 * backlog screen: `./Backlog.tsx` and `./hooks/useBacklogStories.ts` import it
 * via `import type { BacklogStats } from "./BurndownSummary"`.
 *
 * Mirrors the `stats` object the AngularJS `BacklogController` exposed
 * (defined_points / closed_points / total_points / speed / completedPercentage /
 * assigned_points / total_milestones / milestones[]). Every member is optional
 * because the resource loader may not have populated the projection yet on first
 * paint.
 */
export interface BacklogStats {
    total_points?: number;
    defined_points?: number;
    closed_points?: number;
    assigned_points?: number;
    speed?: number;
    completedPercentage?: number;
    total_milestones?: number;
    /**
     * Per-sprint burndown series from the authoritative `/stats` payload. Drives
     * the {@link BurndownChart}. Absent/empty until stats resolve (or when the
     * project has no configured points/sprints, in which case the "customize
     * graph" placeholder is shown instead).
     */
    milestones?: BurndownMilestoneStat[];
}

/**
 * Props for {@link BurndownSummary}.
 */
export interface BurndownSummaryProps {
    /** Aggregate backlog statistics; `null` while the projection is still loading. */
    stats: BacklogStats | null;
    /**
     * When true the project has no burndown graph configured yet, so the summary
     * toggle button is hidden and (for admins) the "customize graph" empty state
     * is shown. Mirrors the AngularJS `showGraphPlaceholder` scope flag.
     */
    showGraphPlaceholder: boolean;
    /** Whether the current user is a project admin (gates the empty-burndown call-to-action). */
    isAdmin?: boolean;
    /** href for the "customize graph" admin link (project admin modules page). */
    adminModulesUrl?: string;
}

/**
 * Computed widths (as whole-number percentages) for the two dynamic bars inside
 * `.summary-progress-bar`.
 */
interface ProgressBarPercentages {
    projectPointsPercentage: number;
    closedPointsPercentage: number;
}

/**
 * Format a numeric stat for a `.number` span. The legacy template applied the
 * Angular `| number` / `| number:0` filters (0 decimals for these fields), so we
 * round to an integer. Defensive: a null/undefined value renders as an empty
 * string rather than "NaN"/"undefined".
 */
function fmt(n: number | undefined): string {
    return n == null ? "" : String(Math.round(n));
}

/**
 * Coerce an unknown stat field to a finite number (0 when absent/NaN), so the
 * SVG geometry never produces `NaN` path coordinates.
 */
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Clamp a percentage to the inclusive [0, 100] range and round it, matching the
 * legacy `adjustPercentaje` helper (main.coffee L1357-1361:
 * `_.max([0, p])` -> `_.min([100, ...])` -> `Math.round`).
 */
function adjustPercentage(percentage: number): number {
    return Math.round(Math.min(100, Math.max(0, percentage)));
}

/**
 * Reproduce the exact `TgBacklogProgressBarDirective` math (main.coffee L1364-1378):
 *
 *   totalPoints   = stats.total_points ? stats.total_points : stats.defined_points
 *   definedPoints = stats.defined_points
 *   closedPoints  = stats.closed_points
 *   if definedPoints > totalPoints:
 *       project = totalPoints  * 100 / definedPoints
 *       closed  = closedPoints * 100 / definedPoints
 *   else:
 *       project = 100
 *       closed  = closedPoints * 100 / totalPoints
 *   project = adjust(project - 3); closed = adjust(closed - 3)
 *
 * Division-by-zero guard: `totalPoints` / `definedPoints` may be 0, in which case
 * the corresponding percentage is 0 (never NaN) so the emitted `width` is valid.
 */
function computeProgressBarPercentages(stats: BacklogStats): ProgressBarPercentages {
    const definedPoints = stats.defined_points ?? 0;
    const closedPoints = stats.closed_points ?? 0;
    // total_points falls back to defined_points when falsy, exactly as legacy.
    const totalPoints = stats.total_points ? stats.total_points : definedPoints;

    let projectPointsPercentage: number;
    let closedPointsPercentage: number;

    if (definedPoints > totalPoints) {
        projectPointsPercentage = definedPoints > 0 ? (totalPoints * 100) / definedPoints : 0;
        closedPointsPercentage = definedPoints > 0 ? (closedPoints * 100) / definedPoints : 0;
    } else {
        projectPointsPercentage = 100;
        closedPointsPercentage = totalPoints > 0 ? (closedPoints * 100) / totalPoints : 0;
    }

    return {
        projectPointsPercentage: adjustPercentage(projectPointsPercentage - 3),
        closedPointsPercentage: adjustPercentage(closedPointsPercentage - 3),
    };
}

/**
 * Inline reproduction of `tg-svg(svg-icon="icon-graph")`. The AngularJS directive
 * renders `<svg class="icon icon-<name>">` wrapping a `<use xlink:href="#icon-<name>">`;
 * we reproduce the class-based structure the SCSS targets (`.stats svg`,
 * `.empty-burndown svg`). The icon symbol itself is supplied by the app's global
 * SVG sprite, exactly as in the legacy screen.
 */
function GraphIcon(): JSX.Element {
    return (
        <svg className="icon icon-graph">
            <use xlinkHref="#icon-graph" />
        </svg>
    );
}

/**
 * Render a `.summary-stats .description` span for a translation key. Some backlog
 * summary labels embed an inline `<br />` (`defined<br />points`); the legacy
 * AngularJS `translate` directive injected that as HTML, so we split on `<br />`
 * and interleave real `<br>` nodes to reproduce the identical DOM. The message
 * bundle is a trusted, compiled-in asset (never user content).
 */
function TranslatedDescription({ translationKey }: { translationKey: string }): JSX.Element {
    const parts = t(translationKey).split(/<br\s*\/?>/i);
    return (
        <span className="description">
            {parts.map((part, index) => (
                <Fragment key={index}>
                    {index > 0 ? <br /> : null}
                    {part}
                </Fragment>
            ))}
        </span>
    );
}

/* ---------------------------------------------------------------------------
 * Burndown chart geometry.
 *
 * The legacy chart was jQuery-Flot (`element.plot(data, options)`), which is not
 * part of the React stack. We reproduce it as a dependency-free inline SVG line
 * chart driven by the SAME authoritative `stats.milestones[]` series the Flot
 * directive consumed (main.coffee L1240-1256). The viewBox keeps the legacy 6:1
 * aspect ratio (`element.height(element.width() / 6)`); the SVG scales to the
 * `.burndown { width: 100% }` container. Colours come from the documented
 * `BURNDOWN_CHART_COLORS` token block (mirrors the Flot `colors`/`fillColor`).
 * ------------------------------------------------------------------------- */
const CHART_VIEW_W = 660;
const CHART_VIEW_H = 110;
const CHART_PAD_L = 30;
const CHART_PAD_R = 20;
const CHART_PAD_T = 8;
const CHART_PAD_B = 22;

interface ChartPoint {
    x: number;
    y: number;
    /** Localized tooltip text (already resolved through `t()`). */
    tooltip: string;
}

interface ChartSeries {
    /** Stable class suffix for the series (`optimal` / `evolution` / ...). */
    key: string;
    line: string;
    fill: string;
    points: ChartPoint[];
}

/**
 * Real burndown graph: an inline SVG reproducing the legacy Flot series
 * (optimal, evolution/real, client-increment, team-increment) from the
 * authoritative `/stats` `milestones` array. Returns `null` when there is no
 * milestone data to plot (the container stays empty, exactly as Flot would draw
 * nothing).
 *
 * ---------------------------------------------------------------------------
 * Finding M16 — documented rendering-parity deviation (AAP-approved).
 * ---------------------------------------------------------------------------
 * The AngularJS chart was jQuery-Flot (`element.plot(data, options)`,
 * `TgBurndownBacklogGraphDirective`, main.coffee L1217-1338) drawn on a
 * `<canvas>`. Reproducing Flot's EXACT output — its canvas anti-aliasing and its
 * `jquery.flot.tooltip` hover-tooltip DOM — is only possible by vendoring
 * jQuery + jquery.flot (+ the tooltip/axislabels plugins) INTO the React bundle.
 * The AAP forbids exactly that, and by D1 precedence an explicit AAP constraint
 * outranks a finding's suggested resolution:
 *   - §0.7.2 Minimal Change Clause — prefer the smallest change; do NOT add
 *     dependencies beyond the two screens' framework transition.
 *   - §0.5.1 frozen dependency inventory — the approved ADDED set is
 *     react / react-dom / immer / @dnd-kit*; jQuery and Flot are NOT added, and
 *     "Removed packages: none". Pulling jQuery+Flot into `app/react/**` would
 *     violate this inventory.
 *   - §0.2.1 isolation — new code lives under `app/react/**` and must not import
 *     the AngularJS/jQuery machinery.
 *   - §0.6.5 shared-component boundary — React RE-RENDERS shared widgets' DOM
 *     (the burndown among them) rather than importing them.
 *
 * Resolution taken = the finding's second sanctioned branch: reproduce the
 * chart with an isolated SVG that maximizes fidelity, and gate the residual
 * pixel-level difference with the strict M27 visual comparator (Phase 7) for
 * explicit stakeholder approval. Fidelity that IS reproduced exactly:
 *   - series math (optimal; evolution null-skipped; client-increment =
 *     -(team+client); team-increment = -team) — main.coffee L1231-1256;
 *   - colours + area fills (`BURNDOWN_CHART_COLORS` == the Flot `colors` +
 *     per-series `fillColor`), the `#D8DEE9` grid colour;
 *   - the 6:1 aspect ratio (`element.height(width/6)`);
 *   - point radius 4 + line width 2 (Flot `points.radius:4`, `lineWidth:2`);
 *   - tooltip TEXT: identical i18n keys (OPTIMAL/REAL/INCREMENT_CLIENT/
 *     INCREMENT_TEAM) and the identical `Math.abs(yval*10)/10` value formula.
 * Accepted residual deviation (the documented gap): `<canvas>` anti-aliasing vs
 * SVG vector edges, and the Flot tooltip-plugin popup vs the native SVG
 * `<title>` hover — neither closable without the forbidden jQuery+Flot vendor.
 */
function BurndownChart({ milestones }: { milestones: BurndownMilestoneStat[] }): JSX.Element | null {
    if (!milestones || milestones.length === 0) {
        return null;
    }

    const count = milestones.length;
    const xAt = (index: number): number =>
        count <= 1
            ? CHART_PAD_L
            : CHART_PAD_L + (index * (CHART_VIEW_W - CHART_PAD_L - CHART_PAD_R)) / (count - 1);

    // Build the four visible legacy series (the invisible zero baseline is not
    // rendered). `evolution` skips null entries (future sprints) but keeps each
    // remaining point at its true milestone x-index.
    const rawSeries: Array<{ key: string; line: string; fill: string; tooltipKey: string; value: (m: BurndownMilestoneStat) => number | null }> = [
        {
            key: "optimal",
            line: BURNDOWN_CHART_COLORS.optimal.line,
            fill: BURNDOWN_CHART_COLORS.optimal.fill,
            tooltipKey: "BACKLOG.CHART.OPTIMAL",
            value: (m) => num(m.optimal),
        },
        {
            key: "evolution",
            line: BURNDOWN_CHART_COLORS.evolution.line,
            fill: BURNDOWN_CHART_COLORS.evolution.fill,
            tooltipKey: "BACKLOG.CHART.REAL",
            value: (m) => (m.evolution == null ? null : num(m.evolution)),
        },
        {
            key: "client-increment",
            line: BURNDOWN_CHART_COLORS.clientIncrement.line,
            fill: BURNDOWN_CHART_COLORS.clientIncrement.fill,
            tooltipKey: "BACKLOG.CHART.INCREMENT_CLIENT",
            value: (m) => -(num(m["team-increment"]) + num(m["client-increment"])),
        },
        {
            key: "team-increment",
            line: BURNDOWN_CHART_COLORS.teamIncrement.line,
            fill: BURNDOWN_CHART_COLORS.teamIncrement.fill,
            tooltipKey: "BACKLOG.CHART.INCREMENT_TEAM",
            value: (m) => -num(m["team-increment"]),
        },
    ];

    // Collect every plotted magnitude (plus the zero baseline) to size the y-axis.
    const allValues: number[] = [0];
    const seriesValues = rawSeries.map((s) =>
        milestones.map((m) => {
            const v = s.value(m);
            if (v != null) {
                allValues.push(v);
            }
            return v;
        }),
    );
    const yMax = Math.max(...allValues);
    const yMin = Math.min(...allValues);
    const ySpan = yMax - yMin || 1;
    const yAt = (value: number): number =>
        CHART_PAD_T + ((yMax - value) * (CHART_VIEW_H - CHART_PAD_T - CHART_PAD_B)) / ySpan;
    const baselineY = yAt(0);

    const series: ChartSeries[] = rawSeries.map((s, si) => {
        const points: ChartPoint[] = [];
        seriesValues[si].forEach((value, index) => {
            if (value == null) {
                return;
            }
            // Tooltip value reproduces the legacy Flot `tooltipOpts.content`
            // formula VERBATIM (`Math.abs(yval * 10) / 10`, main.coffee L1305) so
            // the hover text is byte-identical to the AngularJS chart.
            const displayValue = Math.abs(value * 10) / 10;
            points.push({
                x: xAt(index),
                y: yAt(value),
                tooltip: t(s.tooltipKey, {
                    sprintName: milestones[index]?.name ?? "",
                    value: displayValue,
                }),
            });
        });
        return { key: s.key, line: s.line, fill: s.fill, points };
    });

    const centerX = (CHART_VIEW_W - CHART_PAD_L - CHART_PAD_R) / 2 + CHART_PAD_L;
    const centerY = (CHART_VIEW_H - CHART_PAD_T - CHART_PAD_B) / 2 + CHART_PAD_T;
    const xAxisLabel = t("BACKLOG.CHART.XAXIS_LABEL");
    const yAxisLabel = t("BACKLOG.CHART.YAXIS_LABEL");

    return (
        <svg
            className="burndown-graph"
            viewBox={`0 0 ${CHART_VIEW_W} ${CHART_VIEW_H}`}
            preserveAspectRatio="none"
            // The theme's global `svg{width:1rem;height:1rem}` rule (specificity
            // 0,0,1) would otherwise collapse this inline chart to a 16x16 icon:
            // the legacy burndown was a Flot <canvas>, so the theme has no
            // `svg.burndown-graph` sizing rule. An INLINE style beats that bare
            // `svg` rule and reproduces the legacy `element.height(width/6)`
            // sizing — `width:100%` fills the `.burndown` container and the
            // 660/110 (6:1) aspect-ratio drives `height = width/6`, staying well
            // under the `.graphics-container.open` 300px max-height cap.
            style={{ width: "100%", height: "auto", aspectRatio: `${CHART_VIEW_W} / ${CHART_VIEW_H}` }}
            role="img"
            aria-label={`${yAxisLabel} / ${xAxisLabel}`}
        >
            {/* axes (grid border colour reused from the legacy Flot grid) */}
            <line
                className="burndown-axis burndown-axis-x"
                x1={CHART_PAD_L}
                y1={CHART_VIEW_H - CHART_PAD_B}
                x2={CHART_VIEW_W - CHART_PAD_R}
                y2={CHART_VIEW_H - CHART_PAD_B}
                stroke={BURNDOWN_CHART_COLORS.grid}
            />
            <line
                className="burndown-axis burndown-axis-y"
                x1={CHART_PAD_L}
                y1={CHART_PAD_T}
                x2={CHART_PAD_L}
                y2={CHART_VIEW_H - CHART_PAD_B}
                stroke={BURNDOWN_CHART_COLORS.grid}
            />

            {series.map((s) => {
                if (s.points.length === 0) {
                    return null;
                }
                const linePoints = s.points.map((p) => `${p.x},${p.y}`).join(" ");
                const first = s.points[0];
                const last = s.points[s.points.length - 1];
                const areaPoints = `${first.x},${baselineY} ${linePoints} ${last.x},${baselineY}`;
                return (
                    <g className={`burndown-series burndown-series-${s.key}`} key={s.key}>
                        <polygon
                            className={`burndown-area burndown-area-${s.key}`}
                            points={areaPoints}
                            fill={s.fill}
                            stroke="none"
                        />
                        <polyline
                            className={`burndown-line burndown-line-${s.key}`}
                            points={linePoints}
                            fill="none"
                            stroke={s.line}
                            strokeWidth={2}
                        />
                        {s.points.map((p, pi) => (
                            <circle
                                className={`burndown-point burndown-point-${s.key}`}
                                key={pi}
                                cx={p.x}
                                cy={p.y}
                                r={4}
                                fill={s.line}
                            >
                                <title>{p.tooltip}</title>
                            </circle>
                        ))}
                    </g>
                );
            })}

            {/* axis labels (resolved translations, matching the Flot axisLabel) */}
            <text
                className="burndown-axis-label burndown-xaxis-label"
                x={centerX}
                y={CHART_VIEW_H - 4}
                textAnchor="middle"
            >
                {xAxisLabel}
            </text>
            <text
                className="burndown-axis-label burndown-yaxis-label"
                x={10}
                y={centerY}
                textAnchor="middle"
                transform={`rotate(-90 10 ${centerY})`}
            >
                {yAxisLabel}
            </text>
        </svg>
    );
}

/**
 * Renders the backlog summary panel, the points progress bar, the optional
 * "customize graph" empty state, and the (collapsible) burndown graph container.
 *
 * Behavioral parity with `tgToggleBurndownVisibility`: the burndown graph is
 * visible by default; clicking `.js-toggle-burndown-visibility-button` toggles it.
 * Visibility is expressed through the `shown`/`open` classes on `.graphics-container`
 * (the SCSS `slide` mixin yields `max-height: 0` when collapsed and `max-height: 300px`
 * when either class is present), and the toggle button carries `active` while the
 * graph is shown. The container element always stays mounted so its SCSS transition
 * and the `.graphics-container .burndown` selector continue to apply.
 */
export function BurndownSummary(props: BurndownSummaryProps): JSX.Element {
    const { stats, showGraphPlaceholder, isAdmin = false, adminModulesUrl } = props;

    const [burndownVisible, setBurndownVisible] = useState<boolean>(true);

    const toggleBurndown = (): void => {
        setBurndownVisible((visible) => !visible);
    };

    // Invisible accessibility (no visual impact): the legacy `.stats` toggle is a
    // clickable <div> styled by the SCSS, so we keep the <div> for DOM/visual
    // parity but make it keyboard operable and expose its pressed state.
    const handleToggleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleBurndown();
        }
    };

    // Defensive: render a valid skeleton (empty/zero numbers) when stats is null
    // instead of crashing, mirroring the pre-binding state of the legacy template.
    const safeStats: BacklogStats = stats ?? {};
    const { projectPointsPercentage, closedPointsPercentage } =
        computeProgressBarPercentages(safeStats);
    const milestones = safeStats.milestones ?? [];

    // `shown` + `open` both resolve to max-height:300px in the SCSS slide mixin
    // (visible); their absence collapses the container to max-height:0 (hidden).
    const graphicsContainerClassName = burndownVisible
        ? "graphics-container js-burndown-graph shown open"
        : "graphics-container js-burndown-graph";
    const toggleButtonClassName = burndownVisible
        ? "stats js-toggle-burndown-visibility-button active"
        : "stats js-toggle-burndown-visibility-button";

    return (
        <div className="backlog-summary">
            {/* ---- div.summary (summary.jade) ---- */}
            <div className="summary">
                {/* ---- div.summary-progress-bar (progress-bar.jade + TgBacklogProgressBarDirective) ---- */}
                <div className="summary-progress-bar">
                    <div className="defined-points" title={t("BACKLOG.EXCESS_OF_POINTS")} />
                    <div
                        className="project-points-progress"
                        title={t("BACKLOG.PENDING_POINTS")}
                        style={{ width: `${projectPointsPercentage}%` }}
                    />
                    <div
                        className="closed-points-progress"
                        title={t("BACKLOG.CLOSED_POINTS")}
                        style={{ width: `${closedPointsPercentage}%` }}
                    />
                </div>

                {/* ---- div.data > span.number (completedPercentage + '%') ---- */}
                <div className="data">
                    <span className="number">{`${fmt(safeStats.completedPercentage)}%`}</span>
                </div>

                {/* ---- summary-stats: PROJECT_POINTS (only when total_points is truthy) ---- */}
                {safeStats.total_points ? (
                    <div className="summary-stats">
                        <span className="number">{fmt(safeStats.total_points)}</span>
                        <TranslatedDescription translationKey="BACKLOG.SUMMARY.PROJECT_POINTS" />
                    </div>
                ) : null}

                {/* ---- summary-stats: DEFINED_POINTS ---- */}
                <div className="summary-stats">
                    <span className="number">{fmt(safeStats.defined_points)}</span>
                    <TranslatedDescription translationKey="BACKLOG.SUMMARY.DEFINED_POINTS" />
                </div>

                {/* ---- summary-stats: CLOSED_POINTS ---- */}
                <div className="summary-stats">
                    <span className="number">{fmt(safeStats.closed_points)}</span>
                    <TranslatedDescription translationKey="BACKLOG.SUMMARY.CLOSED_POINTS" />
                </div>

                {/* ---- summary-stats: POINTS_PER_SPRINT (speed, 0 decimals) ---- */}
                <div className="summary-stats">
                    <span className="number">{fmt(safeStats.speed)}</span>
                    <TranslatedDescription translationKey="BACKLOG.SUMMARY.POINTS_PER_SPRINT" />
                </div>

                {/* ---- toggle button (hidden when a graph placeholder is shown) ---- */}
                {!showGraphPlaceholder ? (
                    <div
                        className={toggleButtonClassName}
                        title={t("BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH")}
                        role="button"
                        tabIndex={0}
                        aria-pressed={burndownVisible}
                        onClick={toggleBurndown}
                        onKeyDown={handleToggleKeyDown}
                    >
                        <GraphIcon />
                    </div>
                ) : null}
            </div>

            {/* ---- empty-burndown call-to-action (admins only, when no graph configured) ---- */}
            {showGraphPlaceholder && isAdmin ? (
                <div className="empty-burndown">
                    <GraphIcon />
                    <div className="empty-text">
                        <p className="title">{t("BACKLOG.CUSTOMIZE_GRAPH")}</p>
                        <p>
                            {t("BACKLOG.CUSTOMIZE_GRAPH_TEXT")}{" "}
                            <a href={adminModulesUrl ?? ""} title={t("BACKLOG.CUSTOMIZE_GRAPH_TITLE")}>
                                {t("BACKLOG.CUSTOMIZE_GRAPH_ADMIN")}
                            </a>
                        </p>
                    </div>
                </div>
            ) : null}

            {/* ---- burndown graph container ----
                Reproduces `div.graphics-container.js-burndown-graph > div.burndown`
                (backlog.jade L29-30). The real chart is rendered by {@link BurndownChart}
                from the authoritative `stats.milestones[]` series; the `.burndown`
                element is styled by the unchanged SCSS (`.burndown { width: 100% }`)
                and visibility is driven by `burndownVisible`. */}
            <div className={graphicsContainerClassName}>
                <div className="burndown">
                    <BurndownChart milestones={milestones} />
                </div>
            </div>
        </div>
    );
}
