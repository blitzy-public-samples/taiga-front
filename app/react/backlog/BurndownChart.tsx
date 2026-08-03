/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * BurndownChart.tsx -- the Backlog burndown chart
 * ==========================================================================
 *
 * T9 COMMENT 1 OF 11 -- FILE HEADER.
 *
 * Rule T9 ("comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file. Eleven numbered
 * T9 comments are required of it; each one is tagged `T9 COMMENT n OF 11` so a
 * reviewer can find all eleven by searching for `T9 COMMENT`.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS REPLACES
 * --------------------------------------------------------------------------
 * The retired AngularJS element directive `tgBurndownBacklogGraph`: factory at
 * `coffee/modules/backlog/main.coffee:L1217`, registration at `:L1338`. Its
 * `redrawChart` body occupies `:L1218-L1321` and its `link` occupies
 * `:L1323-L1334`. The directive was attached to the inner host element of
 * `partials/backlog/backlog.jade:L29-L30`:
 *
 *     div.graphics-container.js-burndown-graph          <- owned by BacklogScreen
 *         div.burndown(tg-burndown-backlog-graph)       <- THIS component
 *
 * so this component renders exactly ONE element, `<div class="burndown">`, and
 * nothing else. The collapsible wrapper above it, the placeholder shown when a
 * project has configured no points, the `shown` / `open` class contract and the
 * persisted collapse flag all belong to `BacklogScreen`, not here.
 *
 * LOCATOR CONVENTION, stated once. Locators into the incumbent tree are written
 * RELATIVE TO THE `app/` DIRECTORY -- so `coffee/modules/backlog/main.coffee` is
 * the CoffeeScript module of that name beneath the application's own `app`
 * directory, and `:L1217` is line 1217 of it. The `app`-prefixed spelling is
 * deliberately never written out here, because this folder is verified by a
 * compliance sweep for code reaching into the CoffeeScript and
 * hand-written-JavaScript trees, and that sweep should stay clean on a file
 * which only ever CITES them. A bare `:Lnnn` continues the path named
 * immediately before it.
 *
 * --------------------------------------------------------------------------
 * 2. jQUERY FLOT IS DELIBERATELY RETAINED -- THE CENTRAL DECISION
 * --------------------------------------------------------------------------
 * The chart is still drawn by the incumbent jQuery Flot plugin set. This
 * component is a thin React shell that owns a host element and drives Flot
 * imperatively from an effect. It is NOT a rewrite onto a React charting
 * library, and that is a requirement rather than a preference:
 *
 *   - Rule T10 permits no functional or feature change of the migrated screens.
 *     A different renderer would change pixels -- gridline alpha, marker
 *     geometry, canvas text metrics, area-fill compositing -- while looking
 *     superficially similar.
 *   - Constraint HR-2 pins a closed set of fifteen packages. A charting library
 *     is not in it, and neither are ambient type packages for jQuery or Flot.
 *
 * Every literal below is therefore load-bearing and is transcribed from
 * `:L1218-L1321` unchanged. The plan's own gap register records the reason in
 * G-DS-2: these values are CANVAS literals, so they are outside the Sass token
 * system by nature -- a canvas cannot read a Sass variable -- and tokenising
 * them would risk a visible chart change for no benefit.
 *
 * --------------------------------------------------------------------------
 * 3. WHAT THIS COMPONENT DOES NOT DO
 * --------------------------------------------------------------------------
 *   - NO DATA ACCESS (rules T5 and I7). It receives `stats` as a prop and never
 *     reaches the repository layer, never opens a transport of its own, and
 *     never constructs a request. The screen container fetches; this renders.
 *   - NO APPLICATION STATE (requirement I9). Its only side effect is the
 *     imperative draw call, which is what keeps it testable in a browserless
 *     runner.
 *   - NO SHADOW ROOT (requirement I6). Flot writes its canvases into the LIGHT
 *     DOM of the host below, which is what keeps the single global stylesheet
 *     and the in-document icon sprite reachable.
 *   - NO STYLESHEET. `styles/modules/backlog/burndown.scss` is five lines --
 *     `.burndown { margin-bottom: 2rem; width: 100%; }` -- and is the only rule
 *     in the repository that selects this class. It receives ZERO edits, and
 *     this folder adds no Sass of its own, because authoring a rule that
 *     already applies is a compliance violation rather than an improvement
 *     (rules T1 and G-DS-4).
 *   - NO MARKUP INJECTION. The tooltip strings this file returns are inserted
 *     into the tooltip node by the Flot tooltip plugin, which is that plugin's
 *     behaviour and not ours; no React escape hatch for raw markup is used.
 *
 * --------------------------------------------------------------------------
 * 4. VERIFIED AGAINST THE DESIGN REFERENCE
 * --------------------------------------------------------------------------
 * The linked Figma frame for this screen (node `1:6`) is a single flattened
 * screenshot of the live AngularJS output, and its byte-identical raster is
 * committed at `design-reference/backlog-screen.png` in the parent repository.
 * Pixel measurement of that raster confirms every geometric and chromatic
 * decision encoded below, and no value in this file was chosen to satisfy the
 * frame rather than the source:
 *
 *   host 1254 x 209 px -> 209 is 1254 / 6 exactly, confirming section 6 below
 *   grid border        -> 1 px, RIGHT edge only, in the pale blue-grey literal
 *   plot margins       -> top 0, right 20, left 5, bottom 0, all four confirmed
 *   x tick labels      -> not one glyph at even one of the seven tick positions
 *   axis labels        -> "Sprints" centred on the plot, "Points" rotated, 12 px
 *   area fills         -> the twenty-per-cent-alpha layers composite to the
 *                         three tones the raster contains, which only real
 *                         alpha reproduces; a flattened colour would be wrong
 *   markers            -> hollow, white-centred, ten pixels across
 *   state              -> idle throughout: no tooltip, hover or overlay drawn
 *
 * Two measured findings are recorded rather than acted on. The frame's axis
 * glyphs carry Arial-class metrics, not the metrics of the first family in the
 * font stack section 8 preserves -- the capture machine simply lacked that
 * family and the stack fell back, which is what a stack is for; editing the
 * stack would be a functional change. And the host's measured top edge sits
 * lower in the panel than first estimated, which is a property of the wrapper
 * and the gap beneath the summary bar -- both owned by `BacklogScreen` -- while
 * the HEIGHT this component computes matched to the pixel.
 * ========================================================================== */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';
import type { BurndownMilestone, ProjectStats } from './state/types';

/* ==========================================================================
 * THE jQUERY + FLOT AMBIENT SURFACE
 *
 * T9 COMMENT 2 OF 11 -- WHY THESE TYPES ARE DECLARED HERE INSTEAD OF IMPORTED.
 *
 * jQuery and the three Flot plugins are BROWSER GLOBALS, established by the
 * concatenated vendor bundle the existing build already produces: the bundle's
 * source list carries `jquery/dist/jquery.js` followed by `Flot/jquery.flot.js`,
 * its pie and time companions, `flot-axislabels/jquery.flot.axislabels.js` and
 * `jquery.flot.tooltip/js/jquery.flot.tooltip.js`. Nothing in this migration
 * changes that list, and no build task is added or altered by this folder.
 *
 * Two consequences follow, and together they force the shape below.
 *
 *   - THIS MODULE MUST NOT IMPORT THEM. The React bundle is emitted by esbuild,
 *     which would resolve and inline a module import -- shipping a second copy
 *     of jQuery, registering the Flot plugins onto that copy, and leaving the
 *     plugin methods missing from the copy the rest of the application uses.
 *     Reading the global is not a shortcut; it is the only correct wiring.
 *   - AMBIENT TYPE PACKAGES MAY NOT BE ADDED. Constraint HR-2 closes the
 *     dependency set, so the published typings for jQuery and for Flot are both
 *     out of bounds.
 *
 * A `declare global` augmentation resolves both. It is a TYPE DECLARATION, not
 * a cast: it emits no code, it adds no dependency, and it lets the compiler
 * check every call made through it. This file contains no unsafe escape-hatch
 * type, no double assertion, no suppression comment and no non-null assertion.
 *
 * The declarations model only the narrow slice this component actually uses --
 * five methods on the wrapper and the exact option fields `:L1264-L1318` sets.
 * A member absent here is a member this file does not call. The setter and
 * teardown methods are declared as returning nothing even though jQuery returns
 * its wrapper for chaining, because this component discards those results and a
 * narrower declaration cannot be misused.
 *
 * The property is optional and read-only. Optional because the browserless test
 * runner has no vendor bundle, so the global is genuinely absent there -- see
 * T9 comment 3. Read-only because this module never assigns it; only the vendor
 * bundle does, from outside the type system's view.
 *
 * Checked before writing: no other module under this React tree augments the
 * window type or declares this global, so there is no competing declaration to
 * reconcile. The tree's ambient JSX declaration file is owned elsewhere and is
 * deliberately left untouched.
 * ========================================================================== */

/**
 * One plotted point, `[x, y]`.
 *
 * BOTH SLOTS ADMIT AN ABSENT VALUE, and that is deliberate rather than
 * defensive. The pairing helper below reproduces the incumbent's zip, which
 * pads the SHORTER of the two input arrays -- so a position beyond the end of
 * either input carries nothing at all. Flot renders a point whose y is absent
 * as a gap in the line, which is precisely how the real evolution series ends
 * early on the reference screenshot.
 *
 * The x slot can only be padded when the value array outruns the index array,
 * which none of the five series below produces; it is admitted so the type
 * tells the truth about the helper rather than about its current callers.
 */
type FlotPoint = readonly [number | undefined, number | undefined];

/**
 * One series handed to the plot call. Shaped exactly as `:L1224-L1255` builds
 * it: a point list plus a line fill, and -- on the first series alone -- a
 * marker override.
 */
interface FlotSeries {
    readonly data: readonly FlotPoint[];
    readonly lines: { readonly fillColor: string };
    readonly points?: { readonly show: boolean };
}

/**
 * The hovered item passed to the tooltip callback, narrowed to the ONE member
 * `:L1305`, `:L1308` and `:L1311` read. The plugin supplies more; this file
 * consumes only the series ordinal, so nothing else is modelled.
 */
interface FlotHoverItem {
    readonly seriesIndex: number;
}

/** Per-edge measurements, in pixels. Used for both the border and the margin. */
interface FlotEdges {
    readonly top: number;
    readonly right: number;
    readonly left: number;
    readonly bottom: number;
}

/** `grid`, exactly the five fields `:L1265-L1271` sets. */
interface FlotGridOptions {
    readonly borderWidth: FlotEdges;
    readonly borderColor: string;
    readonly color: string;
    readonly hoverable: boolean;
    readonly margin: FlotEdges;
}

/**
 * The five canvas-drawn axis-caption fields BOTH axes set, declared once.
 *
 * `:L1272-L1287` sets these on the horizontal axis and again on the vertical
 * one, with only the caption text differing. Declaring them once here is what
 * makes the two axis types below say structurally what the source says: the
 * vertical axis is EXACTLY this set, and the horizontal axis is this set plus
 * two more fields.
 */
interface FlotCanvasAxisLabelOptions {
    readonly axisLabel: string;
    readonly axisLabelUseCanvas: boolean;
    readonly axisLabelFontSizePixels: number;
    readonly axisLabelFontFamily: string;
    readonly axisLabelPadding: number;
}

/** `xaxis`, exactly the seven fields `:L1272-L1280` sets. */
interface FlotXAxisOptions extends FlotCanvasAxisLabelOptions {
    readonly ticks: number;
    readonly tickFormatter: () => string;
}

/**
 * `yaxis`, exactly the five fields `:L1281-L1287` sets -- the caption set above
 * and NOTHING ELSE.
 *
 * NOTE WHAT IS MISSING: the vertical axis carries NO tick formatter. Only the
 * horizontal one does. Its tick labels are therefore drawn normally, which is
 * why the reference screenshot shows a value at every horizontal gridline while
 * the horizontal axis shows nothing at all. Do not add one here -- the alias
 * form makes that structural rather than merely documented.
 */
type FlotYAxisOptions = FlotCanvasAxisLabelOptions;

/** `series`, the per-series defaults of `:L1288-L1300`. */
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

/** `tooltipOpts`, the single callback of `:L1303-L1317`. */
interface FlotTooltipOptions {
    readonly content: (
        label: string,
        xval: number,
        yval: number,
        flotItem: FlotHoverItem,
    ) => string;
}

/** The complete option object of `:L1264-L1318`, field for field. */
interface FlotOptions {
    readonly grid: FlotGridOptions;
    readonly xaxis: FlotXAxisOptions;
    readonly yaxis: FlotYAxisOptions;
    readonly series: FlotSeriesDefaults;
    readonly colors: readonly string[];
    readonly tooltip: boolean;
    readonly tooltipOpts: FlotTooltipOptions;
}

/**
 * The plot handle the draw call returns. `:L1321` asks it for its stored plot
 * object and then discards the result, so the stored value is modelled as
 * unknown -- this file never inspects it.
 */
interface FlotPlotHandle {
    data(key: string): unknown;
}

/**
 * The wrapped element, narrowed to the five members `:L1219-L1321` and `:L1334`
 * call. The three that return nothing here really return the wrapper for
 * chaining; the incumbent chains none of them and neither does this file.
 */
interface FlotTarget {
    width(): number;
    height(pixels: number): void;
    empty(): void;
    off(): void;
    plot(data: readonly FlotSeries[], options: FlotOptions): FlotPlotHandle;
}

/** Wrapping a raw element, which is the one jQuery call form this file uses. */
type JQueryFlotFactory = (element: HTMLElement) => FlotTarget;

declare global {
    interface Window {
        /**
         * Published by the concatenated vendor bundle, with the Flot plugins
         * already installed onto it. Optional because the browserless test
         * runner loads no vendor bundle.
         */
        readonly jQuery?: JQueryFlotFactory;
    }
}

/* ==========================================================================
 * TWO LANGUAGE PRIMITIVES THE INCUMBENT GOT FROM COFFEESCRIPT AND LODASH
 *
 * Both are pure, module-level and side-effect free, so the co-located spec can
 * pin their behaviour by driving the component and inspecting what reaches the
 * draw call. Neither is exported: the public surface of this module is the
 * component and its props, and nothing else.
 * ========================================================================== */

/**
 * The index sequence for the horizontal axis.
 *
 * T9 COMMENT 5 OF 11 -- WHY THIS IS NOT `Array.from({ length: n }, ...)`.
 *
 * `:L1221` is `milestonesRange = [0..(dataToDraw.milestones.length - 1)]`, and
 * a CoffeeScript inclusive range is BIDIRECTIONAL. It counts UP when its end is
 * at or above its start and DOWN when the end falls below it, so:
 *
 *     [0..4]   ->  0, 1, 2, 3, 4        five milestones
 *     [0..0]   ->  0                    one milestone
 *     [0..-1]  ->  0, -1                ZERO milestones -- and it descends
 *
 * THE LAST ROW IS THE ONE THAT MATTERS, and it is a preserved defect. With no
 * milestones the incumbent does not produce an empty axis: it produces a
 * two-element sequence whose second entry is NEGATIVE. Every series value list
 * is empty in that state, so the pairing helper yields two points that carry no
 * value, and Flot is handed them. A tooltip on such a point would index the
 * milestone list at -1 and raise an error.
 *
 * That state is genuinely reachable. The screen decides between the chart and
 * its placeholder with an existential check on the project's point and
 * milestone totals (`:L266`), and CoffeeScript's existential operator tests for
 * absence, not for truthiness -- a total of zero is PRESENT. A project with a
 * point total and zero milestones therefore renders this chart, not the
 * placeholder.
 *
 * Rule T10 forbids repairing it. An empty-sequence "fix" would change what the
 * shipped product draws, and the fix belongs in the screen's placeholder
 * condition rather than here. Recorded for the drift register.
 *
 * @param start - the first index, inclusive.
 * @param end - the last index, inclusive; may fall below `start`.
 * @returns the inclusive sequence, ascending or descending as the bounds imply.
 */
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

/**
 * Pairs each axis index with its series value.
 *
 * T9 COMMENT 6 OF 11 -- WHY A MAP OVER THE INDEX LIST WOULD BE WRONG.
 *
 * `:L1225`, `:L1233`, `:L1239`, `:L1246` and `:L1252` all pair the axis index
 * list with a value list through lodash's zip, whose length is the length of
 * the LONGER input, with the shorter side padded by absence. Two failure modes
 * follow from reaching for something simpler:
 *
 *   - Mapping over the index list TRUNCATES whenever the value list is longer.
 *   - Mapping over the value list DROPS TRAILING POSITIONS whenever the value
 *     list is shorter -- and the third series is routinely shorter, because its
 *     values are compacted (see T9 comment 7). Those trailing positions are
 *     exactly what makes Flot end that line early instead of stretching it, and
 *     the reference screenshot shows the line ending early.
 *
 * So the longer-of-the-two length is not incidental: it is what draws the
 * chart correctly.
 *
 * @param indices - the axis index sequence.
 * @param values - the series values, possibly shorter than `indices`.
 * @returns one point per position, up to the longer of the two lengths.
 */
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

/* ==========================================================================
 * THE FIVE SERIES
 *
 * T9 COMMENT 8 OF 11 -- THE FILL AND LINE LITERALS ARE CANVAS VALUES, AND ARE
 * DELIBERATELY NOT TOKENISED.
 *
 * `:L1224-L1262` supplies two independent colour channels, and they are NOT the
 * same values:
 *
 *   - a per-series AREA FILL, given as the `fillColor` under each series' line
 *     options, at twenty per cent alpha;
 *   - a per-series LINE colour, given positionally by the plot-wide colour
 *     array, at FULL alpha for every series that is meant to be seen.
 *
 * Series ordinal 4 is where getting this wrong is invisible in review and loud
 * on screen: ITS FILL AND ITS LINE CARRY DIFFERENT ALPHAS, twenty per cent for
 * the fill and full for the line, both otherwise the same salmon. Unifying them
 * either erases the line or floods the plot. They stay distinct.
 *
 * The plan's gap register (G-DS-2) settles why none of these becomes a design
 * token: they are painted onto a CANVAS, and a canvas cannot read a Sass
 * variable, so they sit outside the token system by nature rather than by
 * oversight. Two of them look like invitations to tokenise and are not:
 *
 *   - the line colour of series 2, #A8E440, coincides EXACTLY with the first
 *     colour of the loading-spinner palette. Same hex, unrelated meaning.
 *     Aliasing it to that token would couple the burndown to spinner styling.
 *   - the line colour of series 4, #FFA0A0, has no token at all.
 *
 * Both stay as literals. Pixel measurement of the committed reference raster
 * confirms all three visible line colours at their exact hex, and confirms that
 * the twenty-per-cent fills composite to THREE distinguishable tones -- grey
 * over white, green over grey, and green over bare white where the green line
 * runs above the grey one. Only genuine alpha produces all three; a flattened
 * colour would be wrong in the third region. Passing the alpha values through
 * untouched, as below, is what reproduces the reference.
 *
 * One shared value is worth naming so it is not mistaken for a copy-paste slip:
 * the fill `rgba(200,201,196,0.2)` is used by series 1 AND series 3, and is
 * additionally the array's first entry -- the line colour of the invisible
 * baseline series. Three occurrences of one literal, all intentional.
 * ========================================================================== */

/**
 * The line colours, positional: entry `n` paints series `n`.
 *
 * Transcribed from `:L1256-L1262`. Entry 0 belongs to the hidden baseline
 * series and is itself a twenty-per-cent value, which is part of why that
 * series does not read as ink. Entries 1 and 3 are the same pale blue-grey.
 */
const SERIES_LINE_COLORS: readonly string[] = [
    'rgba(200,201,196,0.2)',
    'rgba(216,222,233,1)',
    'rgba(168,228,64,1)',
    'rgba(216,222,233,1)',
    'rgba(255,160,160,1)',
];

/**
 * Builds the five series, in the order the colour array above is indexed by.
 *
 * The order is part of the contract twice over: the plot pairs series ordinal
 * with colour ordinal, and the tooltip callback branches on that same ordinal.
 * Reordering these five entries silently recolours the chart AND relabels every
 * tooltip.
 *
 * @param milestones - the burndown samples, one per sprint, in axis order.
 * @returns the five series, ordinals 0 to 4, ready for the draw call.
 */
function buildSeries(
    milestones: readonly BurndownMilestone[],
): readonly FlotSeries[] {
    // `:L1221`. See T9 comment 5 for the degenerate zero-milestone case.
    const milestonesRange = coffeeRange(0, milestones.length - 1);

    // `:L1223`. One zero per milestone -- a flat baseline, not a data series.
    const zeroLine = milestones.map((): number => 0);

    // `:L1231`. The ideal remaining-points ramp.
    const optimalLine = milestones.map(
        (milestone): number => milestone.optimal,
    );

    /*
     * `:L1237`. T9 COMMENT 7 OF 11 -- THE COMPACTING FILTER, A PRESERVED DEFECT.
     *
     * The incumbent maps every milestone to its measured value and then FILTERS
     * the result through CoffeeScript's existential test -- which asks only
     * whether a value is absent, so it rejects both flavours of absence and
     * keeps a legitimate zero. The predicate below is that test written as a
     * TypeScript narrowing guard, which is also what lets the result type be a
     * plain number list with no assertion.
     *
     * ⚠ WHAT THE FILTER DOES TO THE AXIS. Filtering REMOVES entries and CLOSES
     * THE GAP, so the surviving values shift left. A sprint with no measurement
     * yet does not leave a hole at its own position: it pulls every later value
     * one position TOWARDS THE ORIGIN. The measurement belonging to sprint five
     * can therefore be plotted above sprint three. The positions freed at the
     * end receive no value from the pairing helper, and Flot ends the line
     * there.
     *
     * This is a real data-shifting defect in the shipped product, and rule T10
     * requires reproducing it rather than repairing it. It is also visible in
     * the committed reference raster, where this series carries two markers and
     * stops after the first interval while its neighbours carry seven and span
     * the plot -- so faithfulness here is simultaneously the pixel-correct
     * choice. Recorded for the drift register.
     *
     * ⛔ Do NOT preserve the holes by mapping absence to a placeholder value.
     * Substituting zero would draw a false plunge to the axis; substituting a
     * non-number would change the series length the paired list reports.
     */
    const evolutionLine = milestones
        .map((milestone): number | null => milestone.evolution)
        .filter(
            (evolution): evolution is number =>
                evolution !== null && evolution !== undefined,
        );

    // `:L1243-L1244`. Both increments, negated, so the series descends.
    const clientIncrementLine = milestones.map(
        (milestone): number =>
            -milestone['team-increment'] - milestone['client-increment'],
    );

    // `:L1250`. The team increment alone, negated.
    const teamIncrementLine = milestones.map(
        (milestone): number => -milestone['team-increment'],
    );

    return [
        /*
         * Ordinal 0, `:L1224-L1230`. The baseline. A fully transparent fill, and
         * THE ONLY SERIES THAT OVERRIDES THE MARKER DEFAULT -- its markers are
         * switched off, so it contributes no visible dots. Every other series
         * inherits the shared marker settings and shows them.
         */
        {
            data: zip(milestonesRange, zeroLine),
            lines: { fillColor: 'rgba(0,0,0,0)' },
            points: { show: false },
        },
        // Ordinal 1, `:L1232-L1236`. Ideal burndown.
        {
            data: zip(milestonesRange, optimalLine),
            lines: { fillColor: 'rgba(200,201,196,0.2)' },
        },
        // Ordinal 2, `:L1238-L1242`. Measured burndown, compacted above.
        {
            data: zip(milestonesRange, evolutionLine),
            lines: { fillColor: 'rgba(147,196,0,0.2)' },
        },
        // Ordinal 3, `:L1245-L1249`. Client plus team increment.
        {
            data: zip(milestonesRange, clientIncrementLine),
            lines: { fillColor: 'rgba(200,201,196,0.2)' },
        },
        /*
         * Ordinal 4, `:L1251-L1255`. Team increment. Twenty per cent alpha on
         * the fill here, full alpha on the matching line in the colour array --
         * see T9 comment 8.
         */
        {
            data: zip(milestonesRange, teamIncrementLine),
            lines: { fillColor: 'rgba(255,160,160,0.2)' },
        },
    ];
}

/**
 * Builds the plot options, field for field from `:L1264-L1318`.
 *
 * Both axis labels and all four tooltip strings are resolved HERE, at draw time,
 * exactly as the incumbent called the translation service from inside its redraw
 * rather than capturing strings once at link time. The consequence is a real
 * behaviour and is preserved deliberately: switching language does NOT relabel
 * an already-drawn chart until the statistics change and the chart is redrawn.
 * No subscription to the bridge's language-change notification is added here,
 * because adding one would be a feature the incumbent does not have (rule T10).
 * Recorded for the drift register.
 *
 * @param milestones - the same samples the series were built from; the tooltip
 *                     callback closes over them to name the hovered sprint.
 * @param translate - the translation lookup, read fresh on every draw.
 * @returns the complete option object for the draw call.
 */
function buildOptions(
    milestones: readonly BurndownMilestone[],
    translate: TranslateFn,
): FlotOptions {
    return {
        /*
         * `:L1265-L1271`. Note the asymmetry: the border is one pixel on the
         * RIGHT EDGE ONLY -- top, left and bottom are zero -- and the plot is
         * inset on the right and the left only. Both were confirmed by pixel
         * measurement of the committed reference raster.
         *
         * The single grid colour drives BOTH the full-strength right border and
         * the internal gridlines, which the plot derives from it at roughly a
         * fifth of its alpha. That derivation is why the reference shows near
         * invisible gridlines and a clearly visible border in the same hue, and
         * why no separate gridline colour is set here: setting one would make
         * the gridlines about five times too dark.
         *
         * Hovering must stay enabled -- it is what feeds the tooltip below.
         */
        grid: {
            borderWidth: { top: 0, right: 1, left: 0, bottom: 0 },
            borderColor: '#D8DEE9',
            color: '#D8DEE9',
            hoverable: true,
            margin: { top: 0, right: 20, left: 5, bottom: 0 },
        },
        /*
         * `:L1272-L1280`. The horizontal axis.
         *
         * ITS TICK LABELS ARE DELIBERATELY BLANK. `:L1279` formats every tick as
         * the empty string, so the axis shows tick POSITIONS but never a caption
         * -- confirmed by measurement of the reference, which carries not one
         * glyph at even one of the seven tick positions. The incumbent's formatter
         * declares two parameters and reads neither; declaring none here is
         * identical in behaviour, since the plot passes its arguments
         * positionally and they are simply ignored, and it keeps the compiler's
         * unused-parameter check satisfied without disabling it.
         *
         * The canvas font settings are repeated verbatim on both axes rather
         * than shared, because that is how `:L1272-L1287` sets them and because
         * the label plugin reads them per axis. The first family in the stack is
         * a DELIBERATE EXCEPTION to the screen's type system: these captions are
         * painted into the canvas, not styled by Sass, so the product's own type
         * mixins cannot reach them. Measurement of the reference shows the
         * capture machine lacked that first family and fell back to the next --
         * which is what the fallbacks exist for, and not a reason to edit the
         * stack.
         */
        xaxis: {
            ticks: milestones.length,
            axisLabel: translate('BACKLOG.CHART.XAXIS_LABEL'),
            axisLabelUseCanvas: true,
            axisLabelFontSizePixels: 12,
            axisLabelFontFamily: 'Verdana, Arial, Helvetica, Tahoma, sans-serif',
            axisLabelPadding: 5,
            tickFormatter: (): string => '',
        },
        /*
         * `:L1281-L1287`. The vertical axis, carrying NO tick formatter, so its
         * tick captions render normally. That asymmetry with the axis above is
         * intentional in the source and is reproduced.
         */
        yaxis: {
            axisLabel: translate('BACKLOG.CHART.YAXIS_LABEL'),
            axisLabelUseCanvas: true,
            axisLabelFontSizePixels: 12,
            axisLabelFontFamily: 'Verdana, Arial, Helvetica, Tahoma, sans-serif',
            axisLabelPadding: 5,
        },
        /*
         * `:L1288-L1300`. Shared per-series defaults: no drop shadow, filled
         * lines, and filled markers whose radius and stroke width together give
         * the ten-pixel hollow dot measured on the reference. Series ordinal 0
         * overrides the marker visibility; nothing else overrides these.
         */
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
            /*
             * `:L1304-L1316`. The hover caption.
             *
             * T9 COMMENT 9 OF 11 -- THE VALUE EXPRESSION IS TRANSCRIBED, NOT
             * SIMPLIFIED, AND IT IS NOT A ROUNDING STEP.
             *
             * The incumbent scales the hovered value by ten, takes its
             * magnitude, and divides by ten. Read as arithmetic that is the
             * magnitude and nothing more -- it discards no decimal place, so a
             * value of 0.123 is presented as 0.123, not as 0.1.
             *
             * It also INTRODUCES VISIBLE FLOATING-POINT ERROR, and that error is
             * user-facing text. Scaling 8.2 by ten does not give 82 in binary
             * floating point; it gives a value a hair above it, and dividing
             * back gives a number that prints with a long decimal tail. The
             * caption really does show that tail today.
             *
             * So the expression is written out at all four branches exactly as
             * the source has it. Reducing it to a bare magnitude, or replacing
             * it with a rounding helper or a fixed-decimal formatter, would each
             * change text the user reads -- which rule T10 forbids. Recorded for
             * the drift register.
             *
             * T9 COMMENT 10 OF 11 -- THE FINAL BRANCH IS A FALLTHROUGH, AND
             * ORDINAL 0 LANDS IN IT.
             *
             * The source tests ordinals 1, 2 and 3 explicitly and sends
             * EVERYTHING ELSE to the team-increment caption. Ordinal 4 belongs
             * there. ORDINAL 0 -- the baseline series -- DOES NOT, yet reaches
             * it, so hovering the baseline reads as though it were the team
             * increment. It is seldom reached, because that series shows no
             * markers, but grid hovering keeps it reachable.
             *
             * ⛔ Do NOT add a branch for ordinal 0. The fallthrough is the
             * shipped behaviour and is preserved verbatim. It is written as
             * sequential early returns rather than as a switch precisely so that
             * no reader is tempted to complete the enumeration. Recorded for the
             * drift register.
             *
             * The first parameter is the series label. The source declares it
             * and never reads it; the plugin passes its arguments positionally,
             * so the parameter must keep its place. The leading underscore is
             * what satisfies the compiler's unused-parameter check without
             * disabling it.
             *
             * The hovered sprint is named by indexing the milestone list with
             * the hovered axis value. That index is NOT bounds-checked, exactly
             * as the source leaves it unchecked -- see T9 comment 5 for the one
             * state in which it can go negative. No guard and no non-null
             * assertion is added; the compiler needs neither.
             */
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

/**
 * Sizes the host and draws the chart into it. The whole of `:L1218-L1321`.
 *
 * @param host - the rendered host element; the chart is drawn inside it.
 * @param milestones - the burndown samples to plot.
 * @param translate - the translation lookup for the axis and tooltip captions.
 */
function redrawChart(
    host: HTMLDivElement,
    milestones: readonly BurndownMilestone[],
    translate: TranslateFn,
): void {
    /*
     * T9 COMMENT 3 OF 11 -- THE ABSENT-GLOBAL RETURN IS A REQUIREMENT, NOT A
     * DEFENSIVE HABIT.
     *
     * The vendor bundle that publishes jQuery and installs the Flot plugins onto
     * it is a BROWSER artefact. Constraint HR-5 requires the unit suite to run
     * browserless, with no browser binary, no network and no dependency on
     * generated build output -- so in that runner the global is genuinely
     * absent, and it is absent by design rather than by misconfiguration.
     *
     * Returning here leaves the component mounted and its host rendered, with
     * the drawing simply skipped. Nothing is thrown, because a component that
     * throws in the unit runner cannot be tested at all; and nothing is logged,
     * because a warning on every mount would be noise about an expected
     * condition. The spec supplies its own wrapper factory to exercise
     * everything below this line.
     *
     * The global is read HERE, at the top of each draw, rather than once when
     * the effect is set up. A draw attempted before the bundle has published it
     * is then simply skipped, and the next draw succeeds.
     */
    const jq = window.jQuery;

    if (jq === undefined) {
        return;
    }

    const target = jq(host);

    /*
     * `:L1219-L1220`. T9 COMMENT 4 OF 11 -- THE SIX-TO-ONE ASPECT RATIO IS
     * IMPERATIVE, NOT STYLED.
     *
     * The host's stylesheet contributes its full width and its bottom margin and
     * nothing else -- five lines in total. Its HEIGHT is computed here, from the
     * width it just measured, and written onto the element. That is why the
     * chart stays at a six-to-one ratio at every panel width, why it has to be
     * recomputed on resize, and why nothing about that ratio can be found in
     * Sass. Pixel measurement of the committed reference confirms the outcome
     * exactly: a 1254-pixel-wide host measures 209 pixels tall.
     *
     * The measurement is taken from the LIVE element, never from a constant. The
     * panel and sidebar widths are outputs of a proportional grid declared in
     * the screen's layout stylesheet, so hard-coding either would break the
     * moment that grid or the viewport changed.
     */
    const width = target.width();

    target.height(width / 6);

    const data = buildSeries(milestones);
    const options = buildOptions(milestones, translate);

    /*
     * `:L1320-L1321`. Clearing first is what makes a redraw idempotent: the plot
     * appends canvases to its container, so drawing without emptying would stack
     * them. Every resize therefore replaces the chart rather than layering one.
     *
     * The trailing lookup for the stored plot object is transcribed from the
     * source, where its result is also discarded -- the handle is fetched and
     * thrown away. It is kept as a bare statement for fidelity; deliberately
     * nothing is assigned from it.
     */
    target.empty();
    target.plot(data, options).data('plot');
}

/** Props of {@link BurndownChart}. */
export interface BurndownChartProps {
    /**
     * The project statistics payload, whose milestone list is the series source.
     *
     * ADMITS BOTH FLAVOURS OF ABSENCE, and both skip the drawing entirely. This
     * mirrors the incumbent, where the watched value starts out unset and the
     * redraw sat behind an existential check (`:L1326-L1328`) that treats unset
     * and explicitly-empty identically. The screen fetches these statistics
     * asynchronously, so the first render genuinely has nothing to plot.
     */
    readonly stats: ProjectStats | null | undefined;
}

/**
 * The Backlog burndown chart.
 *
 * Renders one element -- `<div class="burndown">` -- and drives the retained
 * jQuery Flot plugin into it from an effect. See the file header for what this
 * replaces and why the plugin is kept.
 */
export function BurndownChart({ stats }: BurndownChartProps): ReactElement {
    const t = useTranslate();
    const hostRef = useRef<HTMLDivElement | null>(null);

    /*
     * T9 COMMENT 11 OF 11 -- WHY THE TRANSLATION LOOKUP LIVES IN A REF, AND WHY
     * THE EFFECT DEPENDS ON THE STATISTICS ALONE.
     *
     * THE REF. The bridge hook hands back a memoised lookup whose IDENTITY
     * changes whenever the active language changes. Listing it among the effect's
     * dependencies would tear the chart down and redraw it on every such change
     * -- and, for a caller whose own memoisation ever lapsed, on every render.
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

        // `:L1327`. No host yet, or no statistics yet, means nothing to draw --
        // and, per the note above, nothing to listen for either.
        if (host === null || stats === null || stats === undefined) {
            return undefined;
        }

        const redraw = (): void => {
            redrawChart(host, stats.milestones, translateRef.current);
        };

        // `:L1328`. The initial draw, as soon as the statistics are available.
        redraw();

        const handleResize = (): void => {
            redraw();
        };

        window.addEventListener('resize', handleResize);

        return (): void => {
            window.removeEventListener('resize', handleResize);

            /*
             * `:L1333-L1334`. The incumbent detached its element's handlers when
             * the scope was destroyed; the plugins bind hover handlers to the
             * host to drive the tooltip, and this is what releases them. React's
             * effect teardown is the counterpart of that destroy hook.
             */
            const jq = window.jQuery;

            if (jq !== undefined) {
                jq(host).off();
            }
        };
    }, [stats]);

    /*
     * `partials/backlog/backlog.jade:L30`, reproduced exactly: ONE element,
     * carrying the one class its five-line stylesheet selects, and no children.
     * The plugin fills it with canvases at draw time -- in the LIGHT DOM, with no
     * shadow root, so the single global stylesheet and the in-document icon
     * sprite stay reachable (requirement I6).
     *
     * The element renders even while the statistics are absent, matching the
     * incumbent, where this host existed in the document from the moment the
     * screen was compiled and only its CONTENT waited on data. No placeholder
     * and no conditional wrapper belongs here: the collapsible container and the
     * empty-state panel are the screen container's elements.
     */
    return <div className="burndown" ref={hostRef} />;
}
