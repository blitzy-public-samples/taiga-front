/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * The backlog's dark statistics band: a progress bar, the completion percentage,
 * four numeral plus label blocks, and the burndown visibility toggle.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. WHAT THIS FILE REPLACES (rule T9)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `partials/includes/components/summary.jade` lines 8 through 32, which was
 * included at exactly ONE place (`partials/backlog/backlog.jade:21`), plus the
 * BUTTON HALF of the retired `tgToggleBurndownVisibility` directive
 * (`modules/backlog/main.coffee:1166` through `:1210`).
 *
 * ⚠ `summary.jade` and `sprint-summary.jade` are two DIFFERENT files. This one
 * renders the backlog's dark band; the other belongs to the out of scope
 * taskboard and was deliberately not consulted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2. WHY THE TOGGLE'S STATE IS NOT IN THIS FILE (the AngularJS seam, rule T9)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The retired directive was attached to the WRAPPER one level above the region
 * this file renders, and from there it reached BOTH WAYS out of that region
 * using two document wide element selectors: it toggled `shown` / `open` on the
 * burndown container, which is a SIBLING of this band, and `active` on the
 * button INSIDE it. React cannot own half of that arrangement, so the component
 * that renders BOTH regions owns the state.
 *
 * `BacklogScreen.tsx` therefore keeps the collapsed flag, the first load flag,
 * the persisted preference and the force collapse effect, and it drives the
 * burndown container's classes. This file is STATELESS with respect to the
 * toggle: it renders the control, derives one class name from a prop, and calls
 * the callback it was handed. That split is also what keeps this component a
 * pure function of its props, which requirement I9's coverage gate depends on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 3. WHAT IS DELIBERATELY *NOT* HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No stylesheet. `styles/components/summary.scss` already styles every element
 * below, and the band's measured geometry (its height, the progress bar's
 * percentage width, the toggle's box) is encoded there rather than in this file.
 * Authoring CSS for it would be a compliance violation, not an improvement, and
 * the main column's pixel width is an OUTPUT of the `.scrum` grid ratio and is
 * never restated anywhere.
 *
 * No colour either. Five source colours were measured across this band and each
 * one resolves to a theme variable the stylesheet already applies, so not one
 * literal colour value appears in this file.
 *
 * No element that the design does not show: no separator between the statistic
 * groups, no chrome around the toggle, no border, no shadow, no tooltip, no
 * fifth statistic, and no hover or focus treatment painted at rest. A pixel
 * accounting pass over the band attributed every ink pixel to one of the eleven
 * children reproduced below and left nothing unexplained.
 *
 * And no input and output of its own: this component performs no I/O, resolves
 * no service beyond the translator, and reads no persisted storage.
 *
 * And no compensation for the stylesheet's vertical rounding. The band's content
 * box works out to an odd number of pixels while its tallest child is an even
 * number, so centring has one leftover pixel to split and the browser rounds the
 * resulting half pixel edges to the next whole row. Each inner element (the
 * progress bar, its filled segment, the toggle) therefore paints one row lower
 * than the reference capture taken years ago on a different browser. That was
 * proven to belong to the shared stylesheet and not to React by rendering the
 * pre-migration markup as a static page carrying no script of its own: it
 * rasterises to byte-identical positions, and stripping the framework's marker
 * classes and whitespace nodes changed nothing. Correcting it would mean editing
 * the frozen stylesheet, which would shift the incumbent rendering by the same
 * row, so it is recorded as drift rather than papered over here.
 */

import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
import { BacklogProgressBar } from './SprintProgressBar';
import type { ProjectStats } from './state/types';

/* ==========================================================================
 * TRANSLATION KEYS
 *
 * Held as constants so each key is written exactly once and the misspellings
 * documented in section 5 cannot be silently "corrected" by a later edit.
 * ========================================================================== */

const PROJECT_POINTS_KEY = 'BACKLOG.SUMMARY.PROJECT_POINTS';

const DEFINED_POINTS_KEY = 'BACKLOG.SUMMARY.DEFINED_POINTS';

const CLOSED_POINTS_KEY = 'BACKLOG.SUMMARY.CLOSED_POINTS';

const POINTS_PER_SPRINT_KEY = 'BACKLOG.SUMMARY.POINTS_PER_SPRINT';

/**
 * ⛔ THE MISSPELLING IS REAL AND LOAD BEARING. The shipped locale file spells
 * this key with the project noun transposed, under the sprint summary section
 * rather than the summary section (`locales/taiga/locale-en.json:1468`).
 * Spelling it "correctly" resolves nothing and renders the raw key as the
 * control's tooltip, so it is reproduced verbatim (rule T10).
 */
const TOGGLE_TITLE_KEY = 'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH';

/* ==========================================================================
 * CLASS NAMES
 * ========================================================================== */

/**
 * The toggle's two class names, in the source's order.
 *
 * The first is what the stylesheet selects on. The second is a behaviour hook
 * that the retired directive used as a document wide selector; React no longer
 * needs it to find the element, and it is KEPT REGARDLESS (rule T1) because the
 * class contract is a pass through asset and the end to end layer selects on it.
 * Dropping a class that costs nothing to emit would be a gratuitous break.
 */
const TOGGLE_CLASS_NAMES = 'stats js-toggle-burndown-visibility-button';

/**
 * The modifier the stylesheet uses for the toggle's engaged appearance.
 *
 * ⭐ IT MEANS "THE GRAPH IS SHOWN", NOT "THE BUTTON IS ON". The retired
 * directive REMOVED it from the button while hiding the graph
 * (`modules/backlog/main.coffee:1169`) and ADDED it while showing the graph
 * (`:1173`), so it is derived from the NEGATION of the collapsed flag. Getting
 * this backwards is invisible in a screenshot of one state and wrong in both.
 */
const TOGGLE_ACTIVE_CLASS_NAME = 'active';

/* ==========================================================================
 * NUMBER FORMATTING
 * ========================================================================== */

/**
 * Reproduces the AngularJS `number` filter in its NO ARGUMENT form, which is
 * how three of the four numerals were bound (`summary.jade:15`, `:18`, `:21`):
 * locale grouping with up to three fraction digits, so a whole number prints
 * bare and a fractional one keeps its fraction.
 *
 * Built once at module scope. Constructing a formatter is the expensive half of
 * `Intl`, and this band renders on every statistics refresh.
 */
const FRACTIONAL_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
});

/**
 * Reproduces the same filter in its `:0` form, which is how the fourth numeral
 * was bound (`summary.jade:24`): rounded to a whole number, no fraction shown.
 */
const WHOLE_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

/**
 * The two AngularJS numeral bindings of the source partial, as one function.
 *
 * MISSING AND NON FINITE INPUT YIELDS THE EMPTY STRING, never the text `NaN`
 * and never a fabricated zero. That is precisely what the AngularJS filter did
 * with a value it could not format, and it is also what keeps an absent
 * statistics payload from printing a number the server never sent. A zero that
 * the server DID send still prints as a zero, because zero is finite.
 *
 * DRIFT NOTE: grouping is now decided by `Intl` and the runtime locale rather
 * than by the AngularJS locale table. The rendered result agrees for every
 * value the band displays, and no formatting package was added, because the
 * dependency set is closed (constraint HR-2).
 *
 * @param value - the statistic to print, which may be absent.
 * @param fractionSize - pass `0` for the `:0` form; omit it for the plain form.
 *                       The parameter is typed as the literal `0` because that
 *                       is the ONLY argument the source markup ever supplied.
 * @returns the formatted numeral, or the empty string when there is nothing to
 *          format.
 */
function formatNumber(value?: number | null, fractionSize?: 0): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '';
    }

    return fractionSize === 0
        ? WHOLE_NUMBER_FORMAT.format(value)
        : FRACTIONAL_NUMBER_FORMAT.format(value);
}

/* ==========================================================================
 * TRANSLATIONS THAT CONTAIN MARKUP
 * ========================================================================== */

/**
 * Matches the line break element that four of this band's translations embed.
 *
 * Written to accept the self closing, unclosed and upper case spellings,
 * because a locale file is data: the shipped English values use one spelling
 * today and a translator supplying another must not silently lose the break.
 * A non global pattern is correct here, since `split` divides on every match
 * regardless of the flag.
 */
const HTMLISH_LINE_BREAK_PATTERN = /<br\s*\/?>/i;

/**
 * Renders a translation that contains a literal line break element as a node
 * array, interleaving real elements between the text runs.
 *
 * ⭐ WHY THIS EXISTS AT ALL (rule T9). The four statistic labels are not plain
 * text in the locale file: each value embeds a line break element
 * (`locales/taiga/locale-en.json:1472` through `:1475`), and the AngularJS
 * translate DIRECTIVE appended its result as markup, so each label rendered on
 * TWO lines. That is not decoration, it is why four numeral and label pairs fit
 * inside a band barely taller than one numeral. React escapes text by default,
 * so printing the value directly would render the break's source text as
 * visible characters and force each label onto one long line, widening the
 * cluster and pushing the layout apart. Verified against the design frame: all
 * four labels occupy two lines, and the fourth breaks after its solidus, giving
 * a first line of "points /" and a second of "sprint".
 *
 * ⛔ AND WHY IT IS NOT DONE THE OBVIOUS WAY. React's raw markup injection prop
 * is FORBIDDEN by this migration, and it is deliberately not even named in this
 * file so that searching for it here finds nothing. Splitting on the break and
 * building nodes keeps the rendered output identical while every text run stays
 * escaped, so a translation is data forever and can never become markup.
 *
 * A value with no break yields a single element array, which React renders as
 * one text run. Only the elements carry keys; text runs in a child array need
 * none.
 *
 * @param value - the translated label, possibly containing a break element.
 * @returns the label's text runs, separated by real break elements.
 */
function renderHtmlishLabel(value: string): ReactNode[] {
    return value
        .split(HTMLISH_LINE_BREAK_PATTERN)
        .flatMap((line: string, index: number): ReactNode[] =>
            index === 0 ? [line] : [<br key={`break-${String(index)}`} />, line],
        );
}

/* ==========================================================================
 * THE COMPLETION PERCENTAGE
 * ========================================================================== */

/**
 * Builds the text of the band's leading teal figure.
 *
 * ⭐ THIS ONE IS A STRING CONCATENATION, NOT A FORMATTED NUMBER (rule T9). The
 * source bound the expression `stats.completedPercentage + '%'`
 * (`summary.jade:12`), with no filter, and AngularJS's addition treated an
 * ABSENT operand as contributing nothing rather than as the text `undefined`.
 * So while the statistics were still in flight the figure read as a lone percent
 * sign, and that is reproduced here exactly: an absent payload yields `%`, NOT
 * `0%` and NOT `undefined%` (rule T10). A zero the server did send still reads
 * `0%`, because only a missing value is dropped.
 *
 * The percentage itself is CLIENT COMPUTED, not a server field: the controller
 * derived it as the closed points over the project points, or over the defined
 * points when no project total exists, rounded
 * (`modules/backlog/main.coffee:256` through `:268`). That computation belongs
 * to the data hook that loads the statistics, and this component only prints the
 * field. The design frame corroborates the arithmetic: twenty one closed of
 * three hundred and ninety two rounds to the five percent it shows.
 *
 * @param stats - the statistics payload, which may be absent.
 * @returns the figure to print, always ending in a percent sign.
 */
function formatCompletedPercentage(stats: ProjectStats | null | undefined): string {
    return `${stats?.completedPercentage ?? ''}%`;
}

/* ==========================================================================
 * ONE STATISTIC BLOCK
 * ========================================================================== */

interface SummaryStatProps {
    /** The already formatted numeral. */
    readonly value: string;

    /** The already translated label, which may embed a line break element. */
    readonly label: string;
}

/**
 * One numeral and label pair.
 *
 * Module local and not exported: it is a sub block of the band, never mounted on
 * its own, and the in repo precedent for a sub block is exactly this. It exists
 * so the four blocks below read as four one line call sites that map one to one
 * onto the four blocks of the source partial, while the markup they share is
 * written once. The emitted DOM is identical to writing all four out in full.
 *
 * ⛔ NOTE WHAT IS ABSENT: the source partial carried a static two hyphen
 * placeholder after each numeral binding, which the binding OVERWROTE at link
 * time. It was never visible to a user, so React must not emit it, and this file
 * contains no such text.
 */
function SummaryStat({ value, label }: SummaryStatProps): ReactElement {
    return (
        <div className="summary-stats">
            <span className="number">{value}</span>
            <span className="description">{renderHtmlishLabel(label)}</span>
        </div>
    );
}

/* ==========================================================================
 * THE BAND
 * ========================================================================== */

export interface SummaryBarProps {
    /**
     * The project statistics. Absent until the first load resolves, which is a
     * NORMAL state rather than an error: the band renders its structure
     * immediately and fills in as the payload arrives, exactly as the incumbent
     * did with an unresolved scope value.
     */
    readonly stats: ProjectStats | null | undefined;

    /**
     * Whether the screen is showing the burndown placeholder instead of a chart,
     * which suppresses the toggle entirely.
     *
     * THREE STATE, and the third state matters. It is `null` before the
     * statistics resolve and only then becomes a boolean
     * (`modules/backlog/main.coffee:266`). The source gated the control on plain
     * falsiness, so `null` RENDERS the control, and that is preserved.
     */
    readonly showGraphPlaceholder: boolean | null;

    /**
     * Whether the burndown chart is currently collapsed.
     *
     * Owned by the screen, not by this band: see section 2 of the file header.
     * Only the toggle's appearance is derived from it here.
     */
    readonly isBurndownGraphCollapsed: boolean;

    /**
     * Invoked when the user activates the toggle. The screen flips the collapsed
     * flag, persists it, and drives the burndown container's classes.
     */
    readonly onToggleBurndown: () => void;
}

/**
 * Renders the band.
 *
 * The class names and their nesting are the contract with
 * `styles/components/summary.scss`, which is reused unedited (rule T1), so each
 * one is reproduced exactly as the source partial emitted it and in the same
 * order. Eleven children are emitted, matching the eleven measured in the design
 * frame: the progress bar host, the percentage, four statistic blocks, and the
 * toggle. The toggle is pushed to the far end by a stylesheet rule, not by a
 * spacer element, which is why nothing separates it from the cluster here.
 */
export function SummaryBar({
    stats,
    showGraphPlaceholder,
    isBurndownGraphCollapsed,
    onToggleBurndown,
}: SummaryBarProps): ReactElement {
    /*
     * The one hook this component uses. It resolves the translator through the
     * bridge injector, and the resolved function is handed down to the progress
     * bar as well, so the subtree performs ONE lookup rather than one per
     * consumer and every label in the band changes language together.
     */
    const t = useTranslate();

    /*
     * ⭐ TRUTHINESS, NOT PRESENCE (rule T9). The source gated the first block on
     * `stats.total_points` itself (`summary.jade:14`), so a project with a total
     * of ZERO hid the block just as an absent total did. `Boolean` reproduces
     * that, and coercing here rather than in the markup also stops a numeric
     * value from ever reaching the DOM as stray text, which is what a bare
     * logical conjunction on a number would do.
     */
    const hasProjectPoints = Boolean(stats?.total_points);

    /*
     * Built with a template literal. No class name utility package is used or
     * needed, because the dependency set is closed (constraint HR-2).
     */
    const toggleClassName = isBurndownGraphCollapsed
        ? TOGGLE_CLASS_NAMES
        : `${TOGGLE_CLASS_NAMES} ${TOGGLE_ACTIVE_CLASS_NAME}`;

    /*
     * ⭐ THE INVISIBLE ACCESSIBILITY ADDITIONS, and why every one of them is
     * invisible.
     *
     * The control was a plain container with a click handler bound by selector,
     * so it was unreachable without a pointer and announced as nothing at all,
     * even though it is the only control in the band. Four additions fix that,
     * and NONE of them paints a pixel in the resting state the design frame
     * captures:
     *
     *   - the button role, so it is announced as a control rather than as a
     *     group to descend into;
     *   - a tab stop, so it can be reached from the keyboard. A focus ring
     *     appears only WHILE focused, a state the frame does not depict at all;
     *   - the expanded state, because this control reveals and hides a REGION
     *     rather than switching a setting, which makes it a disclosure. The
     *     pressed state would be the wrong choice, and the controlled region's
     *     identifier is not asserted because that region belongs to the screen
     *     and the markup being reproduced gives it no identifier to point at;
     *   - keyboard activation, below, WITHOUT which the button role would be a
     *     lie: a role that promises activation has to deliver it.
     *
     * The element stays a container and keeps exactly its original class names.
     * A native button element would have been the better semantic, and it is
     * deliberately NOT used: the stylesheet sizes this element and paints its
     * icon on the assumption of a plain container, so a button would arrive with
     * its own box, border and background and change the rendered result. The
     * accessible name comes from the title the source already carried, so no
     * translation key was invented for it.
     */
    const handleToggleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        // The space key scrolls the page by default, which a control must not do.
        event.preventDefault();

        onToggleBurndown();
    };

    return (
        <div className="summary">
            {/*
              * The host of the retired progress bar directive, emitted HERE
              * because the stylesheet's width, padding and background belong to
              * this element, while its three overlaid bars are the imported
              * component's fragment.
              */}
            <div className="summary-progress-bar">
                <BacklogProgressBar stats={stats} t={t} />
            </div>

            <div className="data">
                <span className="number">{formatCompletedPercentage(stats)}</span>
            </div>

            {hasProjectPoints ? (
                <SummaryStat
                    value={formatNumber(stats?.total_points)}
                    label={t(PROJECT_POINTS_KEY)}
                />
            ) : null}
            <SummaryStat
                value={formatNumber(stats?.defined_points)}
                label={t(DEFINED_POINTS_KEY)}
            />
            <SummaryStat
                value={formatNumber(stats?.closed_points)}
                label={t(CLOSED_POINTS_KEY)}
            />
            <SummaryStat
                value={formatNumber(stats?.speed, 0)}
                label={t(POINTS_PER_SPRINT_KEY)}
            />

            {showGraphPlaceholder ? null : (
                <div
                    className={toggleClassName}
                    title={t(TOGGLE_TITLE_KEY)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isBurndownGraphCollapsed}
                    onClick={onToggleBurndown}
                    onKeyDown={handleToggleKeyDown}
                >
                    {/*
                      * The icon renderer emits the element wrapper the
                      * stylesheets select on, and references the sprite symbol
                      * already inlined into the document, so no icon asset is
                      * added (rule T3).
                      */}
                    <Svg svgIcon="icon-graph" />
                </div>
            )}
        </div>
    );
}

