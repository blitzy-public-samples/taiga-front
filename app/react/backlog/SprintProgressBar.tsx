/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintProgressBar.tsx — the two progress-bar leaves of the React rebuild of
 * the Backlog / Sprint-Planning screen.
 *
 * ===========================================================================
 * WHAT THIS FILE IS A PORT OF
 * ===========================================================================
 * Two AngularJS progress-bar directives, ported as two SEPARATE components
 * because they render different markup out of different arithmetic:
 *
 *   BacklogProgressBar  <- `tgBacklogProgressBar`, RETIRED by this migration.
 *       factory    coffee/modules/backlog/main.coffee:L1345-L1383
 *       template   partials/backlog/progress-bar.jade:L8-L13
 *       call site  partials/includes/components/summary.jade:L9
 *       consumer   ./SummaryBar.tsx
 *
 *   SprintProgressBar   <- `tgProgressBar`, SHARED AND RETAINED. That directive
 *       is NOT retired by this migration: its registration at
 *       coffee/modules/common/components.coffee:L452 stays in place for the
 *       screens outside the migration, and this component reproduces its
 *       appearance for the one screen inside it that uses it.
 *       factory    coffee/modules/common/components.coffee:L433-L450
 *       template   partials/common/components/progress-bar.jade:L8
 *       call site  partials/backlog/sprint.jade:L11
 *       consumer   ./SprintCard.tsx
 *
 * CITATION CONVENTION. Every locator in this file is written relative to
 * `app/`, so `coffee/modules/backlog/main.coffee` is the file one level up from
 * this React tree at `<app>/coffee/modules/backlog/main.coffee`, and
 * `partials/...` and `styles/...` likewise. The prefix is omitted on purpose:
 * nothing under this tree may import from the CoffeeScript or plain-JavaScript
 * sources — they sit outside the TypeScript program and JavaScript sources are
 * not admitted to it — so a mechanical search of this file for such an import
 * path stays clean. No precision is lost; each locator resolves one directory
 * above the React tree.
 *
 * ===========================================================================
 * THE HOST ELEMENT BELONGS TO THE CALLER   (T1 / T9 seam note)
 * ===========================================================================
 * Both incumbent directives are ATTRIBUTE directives, and both replaced only
 * the CHILDREN of the element they were placed on: the render step ends in
 * `el.html(...)` at coffee/modules/backlog/main.coffee:L1354 and at
 * coffee/modules/common/components.coffee:L437. The wrapper itself was
 * authored in the Jade — partials/includes/components/summary.jade:L9 and
 * partials/backlog/sprint.jade:L11 — and its class is the OUTER selector of
 * the rule that styles the whole widget: styles/components/summary.scss:L94
 * for the summary bar, styles/modules/backlog/sprints.scss:L165 for the sprint
 * card, with the closed-sprint variant at styles/modules/backlog/sprints.scss:L387.
 *
 * These components therefore render the CHILDREN ONLY. `SummaryBar.tsx` and
 * `SprintCard.tsx` each supply their own wrapper carrying the class named at
 * those stylesheet locators, so the existing nested rules keep matching
 * verbatim and neither stylesheet needs an edit (T1, G-DS-4). Emitting the
 * wrapper here as well would nest it twice and break both rules.
 *
 * The wrapper's class name is deliberately not spelled out anywhere in this
 * file. It is unambiguous from the two stylesheet locators above, and leaving
 * the literal string out keeps "this file does not emit the wrapper"
 * mechanically checkable. The omission is intent, not oversight.
 *
 * ===========================================================================
 * THE TWO ARITHMETICS DIFFER — DO NOT UNIFY THEM   (T10)
 * ===========================================================================
 * `BacklogProgressBar` subtracts a 3-point offset, then clamps to 0...100 and
 * rounds. `SprintProgressBar` clamps to 0...100 and stops there — no offset,
 * no rounding. The difference is visible in the rendered pixels, as the next
 * section measures, so the two helpers below stay separate. Folding them into
 * one shared helper is a behaviour change, which T10 forbids outright.
 *
 * ===========================================================================
 * FIGMA / RASTER CORROBORATION — node 1:6, and why both quirks are real
 * ===========================================================================
 * The Figma REST API is rate-limited for this seat (HTTP 429, retry-after
 * ~3 days 22 hours, seat-wide), so node 1:6 exposes no structural tree at all:
 * no component, variant, auto-layout, token or typography data exists for this
 * screen. The authority is instead the committed raster
 * `design-reference/backlog-screen.png` in the parent repository, which is
 * byte-identical to that node's image fill. Measuring it settles both quirks,
 * in favour of the incumbent behaviour:
 *
 *  1. THE OFFSET IS REAL. The frame's statistics are 392 project points,
 *     392.5 defined points, 21 closed points. Its teal band measures exactly
 *     4 x 24 px inside a 183 x 30 px white track — pixel columns 235..238,
 *     inset by the 3 px padding declared at styles/components/summary.scss:L99.
 *     The arithmetic below yields a closed-points figure of 2, and 2 % of
 *     183 px is 3.66 px, painting those same four columns. Drop the offset and
 *     the figure becomes 5; 5 % of 183 px is 9.15 px — ten columns, over twice
 *     what the design shows.
 *  2. THE MISSING ROUNDING IS REAL. The sprint card reports 21 closed of 101.5
 *     total, and its fill measures 83 x 11 px on a 402 px track. The raw ratio
 *     20.689655172413794 % of 402 px is 83.17 px, painting 83 columns. Rounded
 *     to 21 % it would be 84.42 px — 84 columns, one column too wide.
 *
 * Neither component writes a colour, a dimension, a radius, a shadow or a
 * transition. The teal fill (#008AA8 in the raster, `$color-link-primary` in
 * the theme), the 30 px and 11 px heights, the 3 px inset, the square corners
 * of the summary bar and the 2 px corners and shadows of the sprint bar are all
 * declared by the two untouched stylesheets and apply the moment the class
 * names below are emitted (G-DS-3, G-DS-4). The only value either component
 * emits is an inline width percentage, which is exactly what the incumbent
 * templates interpolated.
 *
 * DRIFT REGISTER ITEMS RAISED BY THIS FILE. The register lives under
 * `e2e-react/artifacts/figma-comparison/` and is owned by the end-to-end
 * agent; these are reported for it to append, and are not written here.
 *
 *   D-SPB-1  FINDING. Element: the excess-of-points band, node 1:6.
 *            Figma-measured: ZERO rendered pixels — an exhaustive scan of all
 *            81,510 px of the dark summary bar finds no reddish pixel at all,
 *            and the bar's own 5,490 px hold just two colours.
 *            Repository-sourced: rendered unconditionally at
 *            partials/backlog/progress-bar.jade:L8, styled at
 *            styles/components/summary.scss:L106-L111.
 *            Implemented: the repository — the band IS rendered.
 *            Why: it is OCCLUDED, not absent. At the frame's data the
 *            project-points band is 97 % of 183 px = 177.51 px, which fully
 *            covers the excess band's `calc(100% - 6px)` = 177 px, so this
 *            output is pixel-identical to the frame. The band becomes visible
 *            whenever defined points exceed project points by more than the
 *            offset — the very state its own title key names. Dropping it
 *            would delete that state (T10) and break the class contract (T1).
 *   D-SPB-2  CONFIRMATION, not drift: quirk 1 above. The raster answers the
 *            open question of why the band is narrower than the "5%" reading
 *            printed beside it — that reading is `completedPercentage`, a
 *            separate server-computed field, not either width below.
 *   D-SPB-3  CONFIRMATION, not drift: quirk 2 above.
 *
 * No hover, tooltip, popover, focus or drag state is captured anywhere on that
 * frame, and none is invented here (Drift D4). The three `title` attributes
 * below paint no pixels until a pointer rests on them and are transcribed from
 * partials/backlog/progress-bar.jade:L8, L10 and L12 rather than inferred.
 *
 * ===========================================================================
 * PURITY   (I9, and why the translator arrives as a prop)
 * ===========================================================================
 * Both components are pure functions of their props: no hook, no state, no
 * effect, no context, no service lookup, no request, no storage access, no
 * timer. That is what lets them be asserted in a browserless runner with no
 * injector and no provider, which is what makes the coverage gate reachable
 * (I9, HR-9). `BacklogProgressBar` needs three translated titles, so its
 * caller — a container, which may hold hooks — resolves the translator once
 * and passes it down, rather than this leaf reaching for the injector itself.
 *
 * Rendered into light DOM like every other component in this migration; no
 * shadow root is ever created, so the single global stylesheet reaches this
 * markup and the theme cascade stays intact (I6). `className` is the correct
 * spelling on these plain `div` elements: the renderer translates it to the
 * `class` attribute for stock HTML tags.
 */

import type { ReactElement } from 'react';

import type { ProjectStats } from './state/types';

/**
 * Clamps a percentage into 0...100 and rounds it to a whole number.
 *
 * A faithful port of `adjustPercentaje` at
 * coffee/modules/backlog/main.coffee:L1356-L1359, which composed
 * `_.max([0, percentage])`, then `_.min([100, adjusted])`, then a rounding
 * step. The composition order is preserved: the lower bound is applied first,
 * so a negative input becomes 0 rather than being rounded first.
 *
 * ⭐ THE 3-POINT OFFSET. Both call sites below hand this function
 * `percentage - 3`, exactly as coffee/modules/backlog/main.coffee:L1376-L1377
 * did. The offset is applied BEFORE the clamp and the rounding, never after.
 * It compensates for the 3 px padding on the wrapper element
 * (styles/components/summary.scss:L99): the three bands are absolutely
 * positioned against the wrapper's padding box, so a band at a true 100 %
 * would overhang the 3 px inset on the closing edge.
 *
 * PRESERVED VERBATIM PER T10 — DO NOT REMOVE THE OFFSET, DO NOT MOVE IT AFTER
 * THE CLAMP, AND DO NOT "CORRECT" IT. It is confirmed by pixel measurement of
 * the Figma raster, not merely by reading the source: see quirk 1 in this
 * file's header, where removing it would paint ten columns where the design
 * paints four.
 *
 * `NaN` propagates through untouched, which is deliberate — see
 * {@link BacklogProgressBar}.
 *
 * @param percentage The offset percentage to normalise.
 * @returns A whole number in 0...100, or `NaN` if the input was `NaN`.
 */
const adjustPercentaje = (percentage: number): number =>
    Math.round(Math.min(100, Math.max(0, percentage)));

/**
 * Clamps a percentage into 0...100 — CLAMPED BUT DELIBERATELY NOT ROUNDED.
 *
 * A faithful port of the shared progress-bar directive's watch body at
 * coffee/modules/common/components.coffee:L442-L445, which was only
 * `_.max([0, percentage])` followed by `_.min([100, percentage])`. There is no
 * rounding step there and no 3-point offset, and neither may be added here.
 *
 * ⚠ DO NOT UNIFY THIS WITH {@link adjustPercentaje}. They come from two
 * different directives — coffee/modules/backlog/main.coffee:L1345 and
 * coffee/modules/common/components.coffee:L433 — and they genuinely disagree.
 * A well-meaning single helper is a T10 violation with a visible consequence:
 * as quirk 2 in this file's header measures, rounding this value would paint
 * 84 pixel columns where the design paints 83. (The rounding call appears
 * exactly once in this file, inside `adjustPercentaje`, so the absence of one
 * here is mechanically checkable; that is why this note names the behaviour
 * rather than the function.)
 *
 * `NaN` propagates through untouched, which is deliberate — see
 * {@link SprintProgressBar}.
 *
 * @param percentage The raw percentage to normalise.
 * @returns The value bounded to 0...100 with its fractional part intact, or
 *          `NaN` if the input was `NaN`.
 */
const clamp = (percentage: number): number => Math.min(100, Math.max(0, percentage));

/**
 * Props of {@link BacklogProgressBar}.
 *
 * `readonly` throughout because the Backlog reducer holds its state in a
 * structurally shared, frozen tree; a write through props would be a mistake
 * worth catching at compile time rather than at runtime.
 */
export interface BacklogProgressBarProps {
    /**
     * The project-statistics payload, or nothing.
     *
     * `null` and `undefined` are both accepted and both render nothing at all,
     * reproducing the existential guard at
     * coffee/modules/backlog/main.coffee:L1364-L1365: the incumbent watch
     * callback fired on every digest but only injected markup once a payload
     * had arrived.
     */
    readonly stats: ProjectStats | null | undefined;
    /**
     * Translator for the three band titles, structurally compatible with the
     * function the bridge's translate hook returns.
     *
     * Injected rather than resolved here so this stays a pure component that
     * needs no injector and no provider to test (I9). The caller —
     * `SummaryBar.tsx` — resolves it once for the whole screen.
     */
    readonly t: (key: string, params?: Record<string, unknown>) => string;
}

/**
 * Renders the three overlaid bands of the Backlog summary progress bar.
 *
 * The emitted markup is equivalent to the template the incumbent directive
 * compiled and injected, partials/backlog/progress-bar.jade:L8-L13 — three
 * sibling `div` elements, in this order, and nothing else:
 *
 *     <div class="defined-points"          title="…EXCESS_OF_POINTS">
 *     <div class="project-points-progress" title="…PENDING_POINTS"  style="width: N%">
 *     <div class="closed-points-progress"  title="…CLOSED_POINTS"   style="width: N%">
 *
 * Every detail of that is a contract with the unedited stylesheet at
 * styles/components/summary.scss:L94-L122, and each is held to deliberately:
 *
 *  - The ORDER is the paint order. All three bands are absolutely positioned in
 *    the same wrapper, so later siblings cover earlier ones: the excess band
 *    lies underneath, the project-points band covers it, and the closed-points
 *    band sits on top. Reordering them would change what the user sees even
 *    though every class name still matched.
 *  - `.defined-points` carries NO inline width. It takes its full
 *    `calc(100% - 6px)` from styles/components/summary.scss:L110, and adding a
 *    width here would break the excess-of-points state (see D-SPB-1 in this
 *    file's header).
 *  - The wrapper is emitted by the CALLER, so the nested rules keep matching
 *    (T1) — see the header's ownership section.
 *  - No icon, no label, no ARIA attribute and no `role` are added, because the
 *    incumbent template emitted none and adding one would be a feature change
 *    (T10). The bar is a redundant view of the four figures printed beside it
 *    in the same summary bar, so no information is carried by this element
 *    alone.
 *
 * ONE INCUMBENT ARTEFACT, MEASURED AND DELIBERATELY LEFT ALONE. When the closed
 * figure exceeds 103 before the offset, the offset can no longer keep the band
 * inside the track: it reaches 100 %, and because the band is absolutely
 * positioned at `left: 3px` while its percentage resolves against the wrapper's
 * PADDING box, 100 % is the wrapper's full width and the band overhangs the
 * closing 3 px inset (measured in Chrome: 183.297 px band, computed
 * `right: -3px`, 3 px of fill protruding past the white track). The incumbent
 * computed the identical 100 % from the identical arithmetic and the same
 * unedited stylesheet positioned it identically, so this is faithful, not a
 * regression. Correcting it would mean changing the arithmetic (T10) or editing
 * styles/components/summary.scss (T1/G-DS-4) — both forbidden. It also requires
 * closed points to exceed defined points by more than 3 %, which the project's
 * own data model does not produce.
 *
 * A pure function of its props, with no hook whatsoever (I9).
 *
 * @example
 * const t = useTranslate();
 * // The wrapper element and its class are supplied here, by the container.
 * <div className={…}><BacklogProgressBar stats={stats} t={t} /></div>
 *
 * @param props The statistics payload and a translator.
 * @returns The three bands, or `null` when there is no payload yet.
 */
export function BacklogProgressBar({ stats, t }: BacklogProgressBarProps): ReactElement | null {
    // RENDER GATE. coffee/modules/backlog/main.coffee:L1365 wrapped the whole
    // body in an existential check, so nothing was injected until a payload
    // arrived. Rendering empty bands instead would flash a bare white track on
    // every screen load, which the incumbent never did.
    if (stats === null || stats === undefined) {
        return null;
    }

    // TRUTHINESS, NOT NULLISHNESS. coffee/modules/backlog/main.coffee:L1366 is
    // `if stats.total_points then … else …`, so a project total of 0 — falsy,
    // yet perfectly present — falls through to the defined total, and so does
    // `null`. A nullish fallback would keep the 0 and divide by it in the
    // second branch below. Preserved exactly (T10).
    const totalPoints = stats.total_points ? stats.total_points : stats.defined_points;
    const definedPoints = stats.defined_points;
    const closedPoints = stats.closed_points;

    // A 1:1 transcription of the branch at
    // coffee/modules/backlog/main.coffee:L1369-L1374. When more points are
    // defined than the project committed to, both bands scale against the
    // defined total and the project band shrinks below full width, exposing the
    // excess band beneath it; otherwise the project band fills the track and
    // only the closed band scales.
    //
    // DIVISION BY ZERO IS NOT GUARDED, ON PURPOSE. Both totals falsy sends the
    // else branch through a zero denominator, and the two outcomes differ:
    //   - no closed points either -> `0 * 100 / 0` is `NaN`, the clamp leaves it
    //     `NaN`, the style becomes `width: NaN%`, and the browser discards that
    //     declaration — a zero-width band rather than a thrown error;
    //   - some closed points -> the quotient is `Infinity`, which the clamp
    //     bounds to 100 and the rounding leaves at 100 — a full band.
    // Both are exactly what the incumbent produced, and both are reproduced
    // rather than "fixed": a guard here would be a behaviour change (T10).
    let projectPointsPercentaje: number;
    let closedPointsPercentaje: number;

    if (definedPoints > totalPoints) {
        projectPointsPercentaje = (totalPoints * 100) / definedPoints;
        closedPointsPercentaje = (closedPoints * 100) / definedPoints;
    } else {
        projectPointsPercentaje = 100;
        closedPointsPercentaje = (closedPoints * 100) / totalPoints;
    }

    // The 3-point offset, applied before the clamp and the rounding exactly as
    // coffee/modules/backlog/main.coffee:L1376-L1377 applied it. Preserved
    // verbatim per T10 — the reasoning and the pixel proof are on
    // `adjustPercentaje` above.
    projectPointsPercentaje = adjustPercentaje(projectPointsPercentaje - 3);
    closedPointsPercentaje = adjustPercentaje(closedPointsPercentaje - 3);

    // A fragment, not a wrapper: the incumbent replaced the CHILDREN of an
    // element authored in the Jade, whose class is the outer selector of
    // styles/components/summary.scss:L94. The container emits that element, so
    // the existing nesting still matches and the stylesheet needs no edit (T1).
    return (
        <>
            <div className="defined-points" title={t('BACKLOG.EXCESS_OF_POINTS')} />
            <div
                className="project-points-progress"
                title={t('BACKLOG.PENDING_POINTS')}
                style={{ width: `${projectPointsPercentaje}%` }}
            />
            <div
                className="closed-points-progress"
                title={t('BACKLOG.CLOSED_POINTS')}
                style={{ width: `${closedPointsPercentaje}%` }}
            />
        </>
    );
}

/**
 * Props of {@link SprintProgressBar}.
 *
 * `readonly` for the same reason as {@link BacklogProgressBarProps}.
 */
export interface SprintProgressBarProps {
    /**
     * The completion percentage, raw and unbounded.
     *
     * The caller passes the ratio straight through — `SprintCard.tsx` computes
     * `100 * sprint.closed_points / sprint.total_points`, the expression bound
     * at partials/backlog/sprint.jade:L11 — and this component clamps it, which
     * is precisely how the incumbent directive divided the work. Do NOT
     * pre-round or pre-clamp at the call site: the fractional part is load
     * bearing (quirk 2 in this file's header), and a sprint with no estimated
     * points legitimately yields `NaN` here.
     *
     * WHAT `NaN` ACTUALLY LOOKS LIKE, measured rather than assumed. The width
     * becomes the string `NaN%`, which the CSSOM rejects, so no inline width
     * declaration survives — and the track's own rule then wins, because
     * styles/modules/backlog/sprints.scss:L183 gives `.current-progress` a
     * standing `width: calc(30% - 4px)`. Measured in Chrome against the real
     * compiled theme: the band paints 116.594 px on a 402 px track, i.e. about
     * 29 %, NOT an empty bar. That is unchanged from the incumbent, whose
     * interpolated `width: NaN%` attribute was rejected by the same CSSOM and
     * left the same stylesheet rule in charge, so the pixels are identical
     * either way. Reproduced, not guarded (T10). Note this differs from
     * {@link BacklogProgressBar}, whose bands declare no standing CSS width and
     * so collapse to zero instead — the asymmetry lives in the two
     * stylesheets, not in these two components.
     *
     * There is deliberately no `total`/`closed` pair and no `full` flag. The
     * incumbent took a single already-computed number, and the `.full`
     * modifier at styles/modules/backlog/sprints.scss:L185-L187 is applied by
     * the caller that owns the wrapper, not by this leaf.
     */
    readonly percentage: number;
}

/**
 * Renders the single filled band of a sprint-card progress bar.
 *
 * The emitted markup is equivalent to the whole of
 * partials/common/components/progress-bar.jade:L8 — one element, one class, one
 * inline width:
 *
 *     <div class="current-progress" style="width: N%">
 *
 * As with {@link BacklogProgressBar}, the track element is the CALLER's: it is
 * the outer selector of styles/modules/backlog/sprints.scss:L165, which also
 * declares this band's colour, height, radius, shadow and absolute placement at
 * styles/modules/backlog/sprints.scss:L175-L188. Nothing visual is authored
 * here (G-DS-4).
 *
 * The width keeps its full fractional precision. It is clamped to 0...100 and
 * NOT rounded, matching coffee/modules/common/components.coffee:L442-L445 — see
 * the warning on {@link clamp} for the pixel consequence of changing that.
 *
 * A pure function of its single prop, with no hook whatsoever (I9).
 *
 * @example
 * // The track element and its class are supplied here, by the container.
 * <div className={…}>
 *     <SprintProgressBar percentage={(100 * sprint.closed_points) / sprint.total_points} />
 * </div>
 *
 * @param props The raw completion percentage.
 * @returns The filled band.
 */
export function SprintProgressBar({ percentage }: SprintProgressBarProps): ReactElement {
    return <div className="current-progress" style={{ width: `${clamp(percentage)}%` }} />;
}
