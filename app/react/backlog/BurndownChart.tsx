/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import type { BurndownMilestone, ProjectStats } from './state/types';

type FlotPoint = readonly [number | undefined, number | undefined];

interface FlotSeries {
    readonly data: readonly FlotPoint[];
    readonly lines: { readonly fillColor: string };
    readonly points?: { readonly show: boolean };
}

interface FlotHoverItem {
    readonly seriesIndex: number;
}

interface FlotEdges {
    readonly top: number;
    readonly right: number;
    readonly left: number;
    readonly bottom: number;
}

interface FlotGridOptions {
    readonly borderWidth: FlotEdges;
    readonly borderColor: string;
    readonly color: string;
    readonly hoverable: boolean;
    readonly margin: FlotEdges;
}

interface FlotCanvasAxisLabelOptions {
    readonly axisLabel: string;
    readonly axisLabelUseCanvas: boolean;
    readonly axisLabelFontSizePixels: number;
    readonly axisLabelFontFamily: string;
    readonly axisLabelPadding: number;
}

interface FlotXAxisOptions extends FlotCanvasAxisLabelOptions {
    readonly ticks: number;
    readonly tickFormatter: () => string;
}

type FlotYAxisOptions = FlotCanvasAxisLabelOptions;

interface FlotSeriesDefaults {
    readonly shadowSize: number;
    readonly lines: { readonly show: boolean; readonly fill: boolean };
    readonly points: {
        readonly show: boolean;
        readonly fill: boolean;
        readonly radius: number;
        readonly lineWidth: number;
    };
}

interface FlotTooltipOptions {
    readonly content: (
        label: string,
        xval: number,
        yval: number,
        flotItem: FlotHoverItem,
    ) => string;
}

interface FlotOptions {
    readonly grid: FlotGridOptions;
    readonly xaxis: FlotXAxisOptions;
    readonly yaxis: FlotYAxisOptions;
    readonly series: FlotSeriesDefaults;
    readonly colors: readonly string[];
    readonly tooltip: boolean;
    readonly tooltipOpts: FlotTooltipOptions;
}

interface FlotPlotHandle {
    data(key: string): unknown;
}

interface FlotTarget {
    width(): number;
    height(pixels: number): void;
    empty(): void;
    off(): void;
    plot(data: readonly FlotSeries[], options: FlotOptions): FlotPlotHandle;
}

type JQueryFlotFactory = (element: HTMLElement) => FlotTarget;

declare global {
    interface Window {
        readonly jQuery?: JQueryFlotFactory;
    }
}

function coffeeRange(start: number, end: number): readonly number[] {
    const sequence: number[] = [];

    if (end >= start) {
        for (let value = start; value <= end; value += 1) {
            sequence.push(value);
        }

        return sequence;
    }

    for (let value = start; value >= end; value -= 1) {
        sequence.push(value);
    }

    return sequence;
}

function zip(
    indices: readonly number[],
    values: readonly number[],
): readonly FlotPoint[] {
    const length = Math.max(indices.length, values.length);
    const points: FlotPoint[] = [];

    for (let index = 0; index < length; index += 1) {
        points.push([indices[index], values[index]]);
    }

    return points;
}

// The chart is drawn by jQuery Flot onto a canvas, which is why the colours and fills are
// literals rather than stylesheet values: canvas paint cannot read a Sass variable, so any
// substitution here changes the rendered pixels. Three things about the series are
// positional and must not be reordered or "tidied": the colour array above pairs with the
// series list by index, the tooltip selects its wording by series index, and the evolution
// series is FILTERED where the other four are mapped — so it is deliberately shorter than
// the x range, which is what makes the real-progress line stop at the present sprint
// instead of being drawn to zero.
const SERIES_LINE_COLORS: readonly string[] = [
    'rgba(200,201,196,0.2)',
    'rgba(216,222,233,1)',
    'rgba(168,228,64,1)',
    'rgba(216,222,233,1)',
    'rgba(255,160,160,1)',
];

function buildSeries(
    milestones: readonly BurndownMilestone[],
): readonly FlotSeries[] {
    const milestonesRange = coffeeRange(0, milestones.length - 1);

    const zeroLine = milestones.map((): number => 0);

    const optimalLine = milestones.map(
        (milestone): number => milestone.optimal,
    );

    const evolutionLine = milestones
        .map((milestone): number | null => milestone.evolution)
        .filter(
            (evolution): evolution is number =>
                evolution !== null && evolution !== undefined,
        );

    const clientIncrementLine = milestones.map(
        (milestone): number =>
            -milestone['team-increment'] - milestone['client-increment'],
    );

    const teamIncrementLine = milestones.map(
        (milestone): number => -milestone['team-increment'],
    );

    return [
        {
            data: zip(milestonesRange, zeroLine),
            lines: { fillColor: 'rgba(0,0,0,0)' },
            points: { show: false },
        },
        {
            data: zip(milestonesRange, optimalLine),
            lines: { fillColor: 'rgba(200,201,196,0.2)' },
        },
        {
            data: zip(milestonesRange, evolutionLine),
            lines: { fillColor: 'rgba(147,196,0,0.2)' },
        },
        {
            data: zip(milestonesRange, clientIncrementLine),
            lines: { fillColor: 'rgba(200,201,196,0.2)' },
        },
        {
            data: zip(milestonesRange, teamIncrementLine),
            lines: { fillColor: 'rgba(255,160,160,0.2)' },
        },
    ];
}

function buildOptions(
    milestones: readonly BurndownMilestone[],
    translate: TranslateFn,
): FlotOptions {
    return {
        grid: {
            borderWidth: { top: 0, right: 1, left: 0, bottom: 0 },
            borderColor: '#D8DEE9',
            color: '#D8DEE9',
            hoverable: true,
            margin: { top: 0, right: 20, left: 5, bottom: 0 },
        },
        xaxis: {
            ticks: milestones.length,
            axisLabel: translate('BACKLOG.CHART.XAXIS_LABEL'),
            axisLabelUseCanvas: true,
            axisLabelFontSizePixels: 12,
            axisLabelFontFamily: 'Verdana, Arial, Helvetica, Tahoma, sans-serif',
            axisLabelPadding: 5,
            tickFormatter: (): string => '',
        },
        yaxis: {
            axisLabel: translate('BACKLOG.CHART.YAXIS_LABEL'),
            axisLabelUseCanvas: true,
            axisLabelFontSizePixels: 12,
            axisLabelFontFamily: 'Verdana, Arial, Helvetica, Tahoma, sans-serif',
            axisLabelPadding: 5,
        },
        series: {
            shadowSize: 0,
            lines: {
                show: true,
                fill: true,
            },
            points: {
                show: true,
                fill: true,
                radius: 4,
                lineWidth: 2,
            },
        },
        colors: SERIES_LINE_COLORS,
        tooltip: true,
        tooltipOpts: {
            content: (
                _label: string,
                xval: number,
                yval: number,
                flotItem: FlotHoverItem,
            ): string => {
                if (flotItem.seriesIndex === 1) {
                    return translate('BACKLOG.CHART.OPTIMAL', {
                        sprintName: milestones[xval].name,
                        value: Math.abs(yval * 10) / 10,
                    });
                }

                if (flotItem.seriesIndex === 2) {
                    return translate('BACKLOG.CHART.REAL', {
                        sprintName: milestones[xval].name,
                        value: Math.abs(yval * 10) / 10,
                    });
                }

                if (flotItem.seriesIndex === 3) {
                    return translate('BACKLOG.CHART.INCREMENT_CLIENT', {
                        sprintName: milestones[xval].name,
                        value: Math.abs(yval * 10) / 10,
                    });
                }

                return translate('BACKLOG.CHART.INCREMENT_TEAM', {
                    sprintName: milestones[xval].name,
                    value: Math.abs(yval * 10) / 10,
                });
            },
        },
    };
}

function redrawChart(
    host: HTMLDivElement,
    milestones: readonly BurndownMilestone[],
    translate: TranslateFn,
): void {
    const jq = window.jQuery;

    if (jq === undefined) {
        return;
    }

    const target = jq(host);

    // Flot sizes its canvas from the element's measured pixel height, so the 6:1 ratio has
    // to be applied here on every draw; expressing it in CSS would leave the canvas at
    // whatever height it was first given.
    const width = target.width();

    target.height(width / 6);

    const data = buildSeries(milestones);
    const options = buildOptions(milestones, translate);

    target.empty();
    target.plot(data, options).data('plot');
}

/* ==========================================================================
 * THE SCREEN-READER ALTERNATIVE
 *
 * ⭐ WHY A SIBLING AND NEVER A CHILD. `redrawChart` above calls `target.empty()`
 * before every draw -- it has to, because the plugin APPENDS canvases and drawing
 * without emptying would stack them. Anything React rendered INSIDE the host
 * would therefore be destroyed by the first redraw and by every resize
 * afterwards, silently and only in a real browser. So the alternative is a
 * SIBLING of the host, referenced by `aria-describedby`.
 *
 * ⭐ WHY IT IS LAYOUT-SAFE. The sibling carries `hidden`, so the user-agent
 * stylesheet gives it `display: none`, and nothing in scope overrides that: the
 * host's own stylesheet is five lines
 * (`app/styles/modules/backlog/burndown.scss` -- `margin-bottom: 2rem;
 * width: 100%`), and the enclosing `.graphics-container`
 * (`app/styles/components/summary.scss:264`) only applies a max-height slide with
 * `overflow: hidden`, setting no `display` on its children. A hidden element
 * REFERENCED BY `aria-describedby` is still included in the accessible
 * description -- accname's hidden-node rule exempts directly-referenced nodes --
 * so the text reaches assistive technology while contributing exactly nothing to
 * layout or to the visual design (drift entry D4: the frames capture no state
 * this could conflict with).
 *
 * ⭐ WHY THESE WORDS. Every string comes from the FOUR KEYS THE HOVER TOOLTIP
 * ALREADY USES, with the SAME interpolation values and the same rounding, so a
 * screen-reader user hears exactly what a mouse user reads on hover. NO NEW
 * TRANSLATION KEY IS INVENTED -- and none may be: the locale files are not in
 * scope, and a key added to the English file alone would leave every other locale
 * rendering a raw key.
 * ========================================================================== */

/**
 * The tooltip's own value rounding, `Math.abs(yval * 10) / 10`, factored out so
 * the caption and the description can never round differently.
 *
 * `Math.abs` is what turns the deliberately negated increment series back into
 * positive point counts for display.
 *
 * @param plotted - the y value as the series plots it.
 * @returns the value as the hover caption shows it.
 */
function formatChartValue(plotted: number): number {
    return Math.abs(plotted * 10) / 10;
}

/**
 * Builds the textual equivalent of the chart: one sentence per series per
 * milestone, in milestone order.
 *
 * PER-MILESTONE RATHER THAN PER-PLOTTED-POINT, deliberately. The measured
 * evolution series is COMPACTED -- absent samples are filtered out rather than
 * plotted as gaps -- so its plotted index no longer lines up with the milestone
 * index, which is why the hover caption can name the wrong sprint for it (a
 * faithfully preserved incumbent quirk, recorded in the drift register). Text has
 * no such constraint: the real-points sentence is emitted for a milestone if and
 * only if THAT milestone has a measured value, so the description is correct even
 * where the caption is not. Reproducing the misalignment in prose would be
 * copying a bug into a place it does not exist.
 *
 * The zero baseline series is deliberately not described. It carries no
 * information -- it is the axis -- and it is the one series whose markers the
 * chart also switches off.
 *
 * Exported so the whole mapping is asserted directly, with no renderer and no
 * plugin.
 *
 * @param milestones - the burndown samples, in sprint order.
 * @param translate - the owner's translator.
 * @returns one sentence per described series point, in order.
 */
export function describeBurndownSeries(
    milestones: readonly BurndownMilestone[],
    translate: TranslateFn,
): readonly string[] {
    const sentences: string[] = [];

    for (const milestone of milestones) {
        const sprintName = milestone.name;

        sentences.push(
            translate('BACKLOG.CHART.OPTIMAL', {
                sprintName,
                value: formatChartValue(milestone.optimal),
            }),
        );

        if (milestone.evolution !== null && milestone.evolution !== undefined) {
            sentences.push(
                translate('BACKLOG.CHART.REAL', {
                    sprintName,
                    value: formatChartValue(milestone.evolution),
                }),
            );
        }

        /* Both increments, from the same negated values the series plots. */
        sentences.push(
            translate('BACKLOG.CHART.INCREMENT_CLIENT', {
                sprintName,
                value: formatChartValue(
                    -milestone['team-increment'] - milestone['client-increment'],
                ),
            }),
        );
        sentences.push(
            translate('BACKLOG.CHART.INCREMENT_TEAM', {
                sprintName,
                value: formatChartValue(-milestone['team-increment']),
            }),
        );
    }

    return sentences;
}

/**
 * The `id` the host's `aria-describedby` points at.
 *
 * A module constant rather than a generated identifier: exactly one burndown
 * chart exists on the Backlog screen -- one host element in
 * `partials/backlog/backlog.jade:30`, inside one collapsible container -- so a
 * per-instance identifier would add machinery for a case the screen does not have.
 * The name is namespaced so it cannot collide with anything the AngularJS shell
 * renders in the same document.
 */
const CHART_DESCRIPTION_ID = 'tg-react-burndown-description';

/** Props of {@link BurndownChart}. */
export interface BurndownChartProps {
    readonly stats: ProjectStats | null | undefined;

    /**
     * The OWNER'S translator, used for the axis labels, the hover captions and the
     * screen-reader alternative.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE. This component is a rendering leaf: it turns a
     * statistics payload into a chart and owns no data. Resolving translation itself
     * gave it a hook, and therefore a latent AngularJS provider requirement, on a
     * component that is otherwise a pure function of its props -- which is the split
     * requirement I9's coverage gate depends on. The Backlog screen container already
     * holds a translator; it passes it down.
     *
     * REQUIRED: every axis label, every hover caption and the whole textual
     * alternative come from it, so a chart without one would be an unlabelled canvas.
     */
    readonly translate: TranslateFn;
}

/**
 * The Backlog burndown chart.
 *
 * Renders one element -- `<div class="burndown">` -- and drives the retained
 * jQuery Flot plugin into it from an effect. See the file header for what this
 * replaces and why the plugin is kept.
 */
export function BurndownChart({ stats, translate: t }: BurndownChartProps): ReactElement {
    const hostRef = useRef<HTMLDivElement | null>(null);

    /*
     * WHY THE TRANSLATION LOOKUP LIVES IN A REF, AND WHY
     * THE EFFECT DEPENDS ON THE STATISTICS ALONE.
     *
     * THE REF. The translator's IDENTITY changes whenever the active language
     * changes -- the bridge hook that ultimately produces it is memoised on a
     * language epoch -- and it now arrives as a PROP, so a caller whose own
     * memoisation lapsed could hand over a new identity on every render. Listing it
     * among the effect's dependencies would tear the chart down and redraw it in
     * either case.
     * The incumbent had no such exposure: its translation service was injected
     * ONCE, for the lifetime of the directive, and its redraw ran only when the
     * watched statistics changed (`:L1326`). A ref refreshed on each render
     * reproduces that precisely: the draw always reads the CURRENT lookup, and
     * the effect is never rebuilt on account of it.
     *
     * Writing the ref during render is the deliberate, idempotent form of this
     * pattern: the value is only ever READ from inside the effect and from the
     * resize handler, never during rendering, so no render can observe a value
     * inconsistent with its own output.
     *
     * THE DEPENDENCY LIST. Reference comparison on the statistics is sound
     * because the screen's reducer applies structural updates through the pinned
     * immutable-update library with automatic freezing left ON, so an untouched
     * branch keeps its identity across unrelated state changes. No deep
     * comparison and no serialised dependency belongs here; either would redraw
     * the chart on every unrelated update.
     *
     * THE RESIZE LISTENER -- A SANCTIONED DIVERGENCE, RECORDED AS DRIFT.
     * `:L1330` registers the resize handler INSIDE the statistics watcher, so
     * each statistics change adds another one: N changes leave N handlers and one
     * window resize triggers N redraws. This effect registers EXACTLY ONE and
     * removes it on teardown. Because each redraw clears the host before drawing,
     * N identical redraws and one redraw put the same pixels on screen -- so the
     * convergence is observably equivalent to the user while shedding the
     * accumulation. The leak is deliberately NOT reproduced.
     *
     * The gating is reproduced, though: the incumbent's handler only existed once
     * the statistics had arrived, which the early return below reproduces by
     * registering nothing until they have.
     *
     * A PLAIN DOM LISTENER, NOT THE BRIDGE'S EVENT CHANNEL. The framework-level
     * resize notification the incumbent listened for originates at
     * `coffee/modules/base.coffee:L20-L23`, where the shell ASSIGNS an `onresize`
     * property on the window and rebroadcasts from it. A property assignment and
     * an added listener coexist -- neither clobbers the other -- and both fire on
     * the same physical resize. Listening directly therefore observes exactly the
     * same events, costs this component no dependency on the bridge's event hook,
     * and keeps it trivially exercisable in the browserless runner by dispatching
     * a resize event.
     */
    const translateRef = useRef<TranslateFn>(t);

    translateRef.current = t;

    useEffect((): (() => void) | undefined => {
        const host = hostRef.current;

        if (host === null || stats === null || stats === undefined) {
            return undefined;
        }

        const redraw = (): void => {
            redrawChart(host, stats.milestones, translateRef.current);
        };

        redraw();

        const handleResize = (): void => {
            redraw();
        };

        window.addEventListener('resize', handleResize);

        return (): void => {
            window.removeEventListener('resize', handleResize);

            const jq = window.jQuery;

            if (jq !== undefined) {
                jq(host).off();
            }
        };
    }, [stats]);

    /*
     * `partials/backlog/backlog.jade:L30`, reproduced: the host is ONE element,
     * carrying the one class its five-line stylesheet selects, and NO CHILDREN --
     * the plugin fills it with canvases at draw time, in the LIGHT DOM, with no
     * shadow root, so the single global stylesheet and the in-document icon sprite
     * stay reachable (requirement I6).
     *
     * The host renders even while the statistics are absent, matching the
     * incumbent, where it existed in the document from the moment the screen was
     * compiled and only its CONTENT waited on data. No placeholder and no
     * conditional wrapper belongs here: the collapsible container and the
     * empty-state panel are the screen container's elements.
     *
     * ⭐ THE ACCESSIBILITY ADDITIONS, and why each is invisible.
     *
     * A chart drawn onto a canvas is, to a screen reader, an empty box. The host
     * previously carried no role, no name and no description, so the entire
     * burndown -- the one piece of analysis on this screen -- was unreachable
     * without sight. Three attributes and one hidden sibling fix that:
     *
     *   - `role="img"` says the element is a single graphic rather than a container
     *     to descend into. That matters here specifically: the plugin appends
     *     canvases and absolutely-positioned label elements, and without the role a
     *     reader would walk that scaffolding announcing fragments of it.
     *   - `aria-label` names it, COMPOSED FROM THE TWO EXISTING AXIS-LABEL KEYS --
     *     "Points / Sprints" in English -- because there is no title key in the
     *     locale file and inventing one is not available (see the block above). The
     *     name therefore says exactly what the chart plots, in the active locale.
     *   - `aria-describedby` points at the sibling carrying the full series text.
     *
     * NONE OF IT CHANGES A PIXEL. All three are ARIA attributes with no rendered
     * effect, the sibling is `hidden`, and no class name is added anywhere -- so
     * rule T1 holds (zero stylesheet edits) and the layout is bit-for-bit what it
     * was. This is "invisible accessibility": nothing here can conflict with a
     * design frame, which is what makes it safe to add without a Figma reference
     * for a state the frames do not capture (drift entry D4).
     *
     * A FRAGMENT, NOT A WRAPPER. Wrapping the two in a new `div` would insert an
     * element between `.graphics-container` and `.burndown`, and the container's
     * max-height slide plus the host's `width: 100%` both assume the existing
     * parent-child relationship. The fragment keeps the host exactly where the
     * stylesheet expects it.
     */
    return (
        <>
            <div
                className="burndown"
                ref={hostRef}
                role="img"
                aria-label={`${t('BACKLOG.CHART.YAXIS_LABEL')} / ${t(
                    'BACKLOG.CHART.XAXIS_LABEL',
                )}`}
                aria-describedby={CHART_DESCRIPTION_ID}
            />
            {/*
              * The textual alternative. `hidden`, so it is `display: none` and
              * contributes nothing to layout, yet still read as the host's
              * description because `aria-describedby` references it directly.
              *
              * One paragraph per sentence rather than one run-on string, so a
              * reader can move through the series point by point instead of
              * hearing the whole chart as a single utterance. Each sentence is a
              * text child, so React escapes it -- the sprint names inside are
              * user-authored (plan section 0.8.2).
              *
              * Rendered even when there is nothing to plot, so the id the host
              * references always resolves; an `aria-describedby` pointing at a
              * missing element is a validity error in some tools and simply
              * announces nothing in others.
              */}
            <div id={CHART_DESCRIPTION_ID} hidden>
                {stats === null || stats === undefined
                    ? null
                    : describeBurndownSeries(stats.milestones, t).map(
                          (sentence, index): ReactElement => (
                              // The sentences are a positional sequence with no identity
                              // of their own; the milestone name is not unique across
                              // series, so the index is the only stable key available.
                              <p key={index}>{sentence}</p>
                          ),
                      )}
            </div>
        </>
    );
}
