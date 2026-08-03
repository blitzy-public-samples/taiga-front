/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for the two progress bars exported by
 * `./SprintProgressBar.tsx`.
 *
 * WHY THIS SPEC IS SHAPED THE WAY IT IS
 * -------------------------------------
 * One module exports two bars that look interchangeable and are not. Both clamp
 * a percentage into `[0, 100]` and write the result to an inline width, and
 * there the resemblance stops:
 *
 *   * `BacklogProgressBar` reproduces `TgBacklogProgressBarDirective`
 *     (`app/coffee/modules/backlog/main.coffee:1362-1399`, template
 *     `app/partials/backlog/progress-bar.jade:8-13`). It ROUNDS to a whole
 *     percent (`:1373-1376`), and it SURRENDERS THREE PERCENT from each width
 *     (`:1393-1394`) so the excess-points marker at the right-hand end stays
 *     visible even on a full bar.
 *   * `SprintProgressBar` reproduces `TgProgressBarDirective`
 *     (`app/coffee/modules/common/components.coffee:433-450`, template
 *     `app/partials/common/components/progress-bar.jade:8`). Its clamp
 *     (`:443-444`) rounds nothing, and it surrenders nothing.
 *
 * Two clamp helpers separated only by a `Math.round` are precisely the kind of
 * thing a later reader tidies into one, so the arithmetic cases below assert
 * exact values rather than tolerances, and the closing case feeds the SAME
 * percentage through both bars and insists the two answers disagree. Each of
 * those numbers is preserved behaviour rather than preference: folding the two
 * helpers together moves pixels, which this migration forbids.
 *
 * THE FOUR BEHAVIOURS MOST AT RISK, each pinned by a case below
 * ------------------------------------------------------------
 *   1. THE `- 3` OFFSET (`main.coffee:1393-1394`). Drop it and the figures
 *      measured from the design frame become 100 % and 5 % instead of 97 % and
 *      2 %.
 *   2. TRUTHINESS, NOT NULLISHNESS (`main.coffee:1383`). `total_points` falls
 *      through to `defined_points` when it is ZERO just as much as when it is
 *      absent. Modernising that ternary into `??` would keep the zero, divide by
 *      it, and draw a full bar.
 *   3. THE ABSENT `Math.round` ON THE SPRINT BAR (`components.coffee:443-444`).
 *      Its width keeps every decimal the division produced.
 *   4. INVALID ARITHMETIC IS PASSED THROUGH, NOT GUARDED. Zero defined points
 *      divide to `NaN`; the incumbent wrote `width: NaN%` and browsers discard
 *      the declaration, so the bar keeps whatever width the stylesheet gives it.
 *      Adding an `|| 0` would draw a zero-width bar where today no width is
 *      declared at all -- a visible change, so it stays unguarded, and the case
 *      below distinguishes the two outcomes rather than accepting either.
 *
 * Browserless by construction: both bars are pure functions of their props, so
 * no injector, no service double and no bridge provider appears here. Nothing
 * in this file launches a browser, reaches the network, or reads build output.
 */

import { render } from '@testing-library/react';
import { StrictMode } from 'react';

import { BacklogProgressBar, SprintProgressBar } from './SprintProgressBar';
import type { BacklogProgressBarProps, SprintProgressBarProps } from './SprintProgressBar';
import type { ProjectStats } from './state/types';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/**
 * The single collaborator either bar has.
 *
 * It returns its argument, so the tooltip cases assert on the message KEY. That
 * keeps this spec correct when the English catalogue is reworded and failing
 * when a key is renamed, which is the distinction worth having.
 *
 * A module-level `mocks` object mirrors the incumbent CoffeeScript specs.
 * `jest.config.js` sets `clearMocks`, which clears recorded calls before every
 * test while leaving this implementation in place -- so nothing in this file
 * clears or restores it by hand.
 */
const mocks = {
    t: jest.fn((key: string): string => key),
};

/**
 * The project statistics visible in the linked design frame, spelled with every
 * member `ProjectStats` declares rather than only the three the bar reads: a
 * fixture shaped like the real payload cannot drift out of the type.
 *
 * These are the figures the whole spec turns on. Three hundred and ninety two
 * project points against three hundred and ninety two and a half defined points
 * leaves the pending bar all but full, and twenty one closed points is the five
 * percent the frame's summary band reports.
 */
const FRAME_STATS: ProjectStats = {
    assigned_points: 100,
    closed_points: 21,
    completedPercentage: 5,
    defined_points: 392.5,
    milestones: [],
    speed: 0,
    total_milestones: 3,
    total_points: 392,
};

const stats = (over: Partial<ProjectStats> = {}): ProjectStats => ({ ...FRAME_STATS, ...over });

/**
 * The class names the stylesheets select. `app/styles/modules/backlog/*.scss`
 * and the shared progress mixin are unedited pass-through assets, so a renamed
 * class here is a silent, total loss of styling that still compiles.
 */
const DEFINED_POINTS = '.defined-points';
const PENDING_BAR = '.project-points-progress';
const CLOSED_BAR = '.closed-points-progress';
const CURRENT_BAR = '.current-progress';

/**
 * Hosts owned by the CONSUMERS, asserted absent here. `SummaryBar` emits
 * `.summary-progress-bar` around the backlog bar and `SprintCard` emits
 * `.sprint-progress-bar` around the sprint bar; both incumbent templates start
 * at the inner elements, so a bar that grew its own wrapper would nest one
 * element too deep and break the descendant selectors.
 */
const SUMMARY_HOST = '.summary-progress-bar';
const SPRINT_HOST = '.sprint-progress-bar';

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

function renderBacklogBar(props: BacklogProgressBarProps): HTMLElement {
    return render(<BacklogProgressBar {...props} />).container;
}

function renderSprintBar(props: SprintProgressBarProps): HTMLElement {
    return render(<SprintProgressBar {...props} />).container;
}

/** Renders the backlog bar with the shared translator and the frame fixture. */
function renderWithStats(over: Partial<ProjectStats> = {}): HTMLElement {
    return renderBacklogBar({ stats: stats(over), t: mocks.t });
}

function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const found = container.querySelector<HTMLElement>(selector);

    if (found === null) {
        throw new Error(`Expected the progress bar to render "${selector}".`);
    }

    return found;
}

/**
 * The width jsdom actually kept, which is not always the width React was asked
 * to set: jsdom parses the declaration and discards a value CSS cannot express.
 * That is the behaviour the `NaN` cases below rely on, so every width assertion
 * reads what survived rather than what was requested.
 */
function widthOf(container: HTMLElement, selector: string): string {
    return mustFind(container, selector).style.width;
}

function styleAttributeOf(container: HTMLElement, selector: string): string | null {
    return mustFind(container, selector).getAttribute('style');
}

function attributeOfEachChild(container: HTMLElement, name: string): readonly (string | null)[] {
    return Array.from(container.children).map((child): string | null => child.getAttribute(name));
}

function classesOf(container: HTMLElement): readonly (string | null)[] {
    return attributeOfEachChild(container, 'class');
}

function titlesOf(container: HTMLElement): readonly (string | null)[] {
    return attributeOfEachChild(container, 'title');
}

/* ==========================================================================
 * THE BACKLOG BAR
 * ========================================================================== */

describe('BacklogProgressBar', () => {
    describe('the figures measured from the design frame', () => {
        it('renders the pending bar at 97 % and the closed bar at 2 %', () => {
            // The single most important assertion in this file.
            //
            //   pending: 392 * 100 / 392.5 = 99.8726..., minus 3 -> 96.8726..., rounded -> 97
            //   closed:   21 * 100 / 392.5 =  5.3503..., minus 3 ->  2.3503..., rounded ->  2
            //
            // Both numbers therefore prove three separate things at once: the
            // division uses defined points as its denominator, the offset is
            // subtracted, and the result is rounded.
            const container = renderWithStats();

            expect(widthOf(container, PENDING_BAR)).toBe('97%');
            expect(widthOf(container, CLOSED_BAR)).toBe('2%');
        });

        it('does not render the 100 % and 5 % the same figures give without the offset', () => {
            // The negative half of the case above. Deleting `- 3` from the
            // component turns these two widths into exactly these two values,
            // so asserting their absence names the regression it catches.
            const container = renderWithStats();

            expect(widthOf(container, PENDING_BAR)).not.toBe('100%');
            expect(widthOf(container, CLOSED_BAR)).not.toBe('5%');
        });

        it('rounds to a whole percent, leaving no fraction in either width', () => {
            // 96.8726... and 2.3503... both carry decimals before rounding, so a
            // width containing a decimal point means `Math.round` was lost.
            const container = renderWithStats();

            expect(widthOf(container, PENDING_BAR)).not.toContain('.');
            expect(widthOf(container, CLOSED_BAR)).not.toContain('.');
        });

        it('writes the width as a percentage declaration jsdom accepts', () => {
            // Guards the unit as much as the number: a bare `97` or a `97px`
            // would size the bar against the wrong box entirely.
            const container = renderWithStats();

            expect(styleAttributeOf(container, PENDING_BAR)).toBe('width: 97%;');
            expect(styleAttributeOf(container, CLOSED_BAR)).toBe('width: 2%;');
        });
    });

    describe('markup contract', () => {
        it('renders exactly three elements and no stray text node', () => {
            // The incumbent template is three siblings inside a host the CONSUMER
            // owns, so the component returns a fragment. An added wrapper, an
            // added bar or a stray whitespace text node all fail here.
            const container = renderWithStats();

            expect(container.children).toHaveLength(3);
            expect(container.childNodes).toHaveLength(3);
        });

        it('renders the three elements in template order', () => {
            // Order is load-bearing, not cosmetic: the three bars are stacked by
            // the stylesheet and the later ones paint over the earlier ones.
            // Walked sibling by sibling, and compared as a list of classes --
            // deliberately not captured as a snapshot, which would bless a
            // reordering the moment someone refreshed it.
            const container = renderWithStats();
            const first = container.firstElementChild;
            const second = first?.nextElementSibling ?? null;
            const third = second?.nextElementSibling ?? null;

            expect(first).toBe(mustFind(container, DEFINED_POINTS));
            expect(second).toBe(mustFind(container, PENDING_BAR));
            expect(third).toBe(mustFind(container, CLOSED_BAR));
            expect(third?.nextElementSibling).toBeNull();
            expect(classesOf(container)).toEqual([
                'defined-points',
                'project-points-progress',
                'closed-points-progress',
            ]);
        });

        it('renders each element as a childless `div` carrying exactly one class', () => {
            const container = renderWithStats();

            for (const selector of [DEFINED_POINTS, PENDING_BAR, CLOSED_BAR]) {
                const element = mustFind(container, selector);

                expect(element.tagName).toBe('DIV');
                expect(element.classList).toHaveLength(1);
                expect(element.childNodes).toHaveLength(0);
            }
        });

        it('leaves the excess-points marker without an inline width', () => {
            // `progress-bar.jade:8` gives `.defined-points` a title and nothing
            // else: its width comes from the stylesheet, which sizes it to the
            // whole track. Setting a width here would pin the marker to the
            // pending figure and hide the excess it exists to show.
            const container = renderWithStats();

            expect(widthOf(container, DEFINED_POINTS)).toBe('');
            expect(styleAttributeOf(container, DEFINED_POINTS)).toBeNull();
        });

        it('emits no host element of its own', () => {
            // `SummaryBar` owns `.summary-progress-bar`. If the bar grew its own
            // host, the markup would nest one level too deep and every
            // descendant selector in the stylesheet would miss.
            const container = renderWithStats();

            expect(container.querySelector(SUMMARY_HOST)).toBeNull();
            expect(container.querySelector(SPRINT_HOST)).toBeNull();
        });

        it('adds no element the incumbent template does not have', () => {
            const container = renderWithStats();

            expect(container.querySelectorAll('span')).toHaveLength(0);
            expect(container.querySelectorAll('button')).toHaveLength(0);
            expect(container.querySelectorAll('a')).toHaveLength(0);
            expect(container.querySelectorAll('img')).toHaveLength(0);
            expect(container.querySelectorAll('input')).toHaveLength(0);
        });

        it('renders identically when double-rendered under StrictMode', () => {
            // The bar holds no state and starts no effect, so React's
            // development double-invocation must be invisible. A width that
            // changed between the two passes would mean hidden state.
            const single = renderWithStats();
            const { container: strict } = render(
                <StrictMode>
                    <BacklogProgressBar stats={stats()} t={mocks.t} />
                </StrictMode>,
            );

            expect(strict.innerHTML).toBe(single.innerHTML);
        });
    });

    describe('tooltips', () => {
        it('titles the three elements with the three message keys, in order', () => {
            const container = renderWithStats();

            expect(titlesOf(container)).toEqual([
                'BACKLOG.EXCESS_OF_POINTS',
                'BACKLOG.PENDING_POINTS',
                'BACKLOG.CLOSED_POINTS',
            ]);
        });

        it('asks the translator for exactly those three keys and nothing else', () => {
            // Reading the calls rather than only the rendered attributes proves
            // the copy is resolved through the translator instead of being
            // hardcoded in English, which is what keeps the screen localised.
            renderWithStats();

            expect(mocks.t.mock.calls).toEqual([
                ['BACKLOG.EXCESS_OF_POINTS'],
                ['BACKLOG.PENDING_POINTS'],
                ['BACKLOG.CLOSED_POINTS'],
            ]);
        });

        it('renders whatever the translator returns, markup-shaped text included', () => {
            // The tooltip is an attribute, so a translated value with markup in
            // it must appear as text rather than being parsed. Asserting the
            // resolved value lands intact also proves the component passes the
            // translator's output straight through without decorating it.
            const translated = 'Puntos <en> exceso & pendientes';
            const container = renderBacklogBar({
                stats: stats(),
                t: (): string => translated,
            });

            expect(titlesOf(container)).toEqual([translated, translated, translated]);
            expect(container.querySelectorAll('en')).toHaveLength(0);
        });
    });

    describe('the absent-statistics gate', () => {
        it('renders nothing when the statistics are null', () => {
            // The incumbent guarded its whole body behind `if stats?`
            // (`main.coffee:1382`), which every screen reaches before the first
            // response arrives.
            const container = renderBacklogBar({ stats: null, t: mocks.t });

            expect(container.firstChild).toBeNull();
            expect(container.innerHTML).toBe('');
        });

        it('renders nothing when the statistics are undefined', () => {
            const container = renderBacklogBar({ stats: undefined, t: mocks.t });

            expect(container.firstChild).toBeNull();
            expect(container.childNodes).toHaveLength(0);
        });

        it('does not consult the translator while the statistics are absent', () => {
            renderBacklogBar({ stats: null, t: mocks.t });

            expect(mocks.t).not.toHaveBeenCalled();
        });
    });

    describe('percentage arithmetic', () => {
        it('falls through to defined points when the total is zero', () => {
            // TRUTHINESS, NOT NULLISHNESS -- the reason this case exists.
            //
            // A zero total falls through to the 100 defined points, so the
            // closed bar is 50 * 100 / 100 = 50, minus 3 -> 47. Had the ternary
            // been modernised into `??`, the zero would have been kept, the
            // division would have produced Infinity, and the clamp would have
            // drawn a full 100 % bar. The 47 % below is what separates the two.
            const container = renderWithStats({
                total_points: 0,
                defined_points: 100,
                closed_points: 50,
            });

            expect(widthOf(container, PENDING_BAR)).toBe('97%');
            expect(widthOf(container, CLOSED_BAR)).toBe('47%');
        });

        it('falls through to defined points when the total is absent', () => {
            // The same fall-through for the null the endpoint really sends on a
            // project with no point estimation configured.
            const container = renderWithStats({
                total_points: null,
                defined_points: 100,
                closed_points: 50,
            });

            expect(widthOf(container, PENDING_BAR)).toBe('97%');
            expect(widthOf(container, CLOSED_BAR)).toBe('47%');
        });

        it('divides by the defined points when they exceed the total', () => {
            // The over-committed project: 200 defined points against a 50 point
            // scope. Pending is 50 * 100 / 200 = 25 -> 22, closed is
            // 100 * 100 / 200 = 50 -> 47. A pending bar at 97 % here would mean
            // the branch had been taken the wrong way, hiding the over-commitment
            // this bar exists to make visible.
            const container = renderWithStats({
                total_points: 50,
                defined_points: 200,
                closed_points: 100,
            });

            expect(widthOf(container, PENDING_BAR)).toBe('22%');
            expect(widthOf(container, CLOSED_BAR)).toBe('47%');
        });

        it('holds the pending bar at 97 % whenever the defined points fit the total', () => {
            // The other side of that branch: while the estimate fits inside the
            // scope the pending bar is a constant, never a ratio.
            const container = renderWithStats({
                total_points: 400,
                defined_points: 100,
                closed_points: 40,
            });

            expect(widthOf(container, PENDING_BAR)).toBe('97%');
            expect(widthOf(container, CLOSED_BAR)).toBe('7%');
        });

        it('clamps a width beyond one hundred down to 100 %', () => {
            // Twice as many closed points as the whole scope: 200 % before the
            // offset, 197 % after it, clamped to 100 %. Anything above 103 %
            // survives the offset and must still be clamped.
            const container = renderWithStats({
                total_points: 100,
                defined_points: 100,
                closed_points: 200,
            });

            expect(widthOf(container, CLOSED_BAR)).toBe('100%');
        });

        it('clamps the negative width the offset produces up to 0 %', () => {
            // Nothing closed yet: 0 % minus the 3 % offset is -3 %, which the
            // clamp lifts to zero. Without the clamp the component would ask for
            // a negative width, which is invalid CSS and is discarded outright --
            // so a project with no progress would show a bar sized by the
            // stylesheet instead of no bar at all.
            const container = renderWithStats({ closed_points: 0 });

            expect(widthOf(container, CLOSED_BAR)).toBe('0%');
            // Written as a real declaration, which is what distinguishes a
            // clamped zero from the discarded `NaN` of the next block.
            expect(styleAttributeOf(container, CLOSED_BAR)).toBe('width: 0%;');
        });
    });

    describe('invalid arithmetic is reproduced, not guarded', () => {
        it('does not throw when every point count is zero', () => {
            expect(() =>
                renderWithStats({ total_points: 0, defined_points: 0, closed_points: 0 }),
            ).not.toThrow();
        });

        it('declares no width at all rather than substituting zero', () => {
            // AngularJS produced `width: NaN%`, which browsers ignore.
            // Reproduced, not guarded -- T10.
            //
            // A zero total falls through to zero defined points, so the closed
            // division is 0 * 100 / 0 = NaN and the clamp carries the NaN
            // through. React asks jsdom for `width: NaN%`, jsdom rejects the
            // value, and the element ends up with no style attribute -- exactly
            // what a browser does with the incumbent's output.
            //
            // An `|| 0` guard would instead emit `width: 0%;`, which the
            // previous block proves is a distinguishable, VISIBLE difference:
            // a zero-width bar where today the stylesheet's own width stands.
            const container = renderWithStats({
                total_points: 0,
                defined_points: 0,
                closed_points: 0,
            });

            expect(styleAttributeOf(container, CLOSED_BAR)).toBeNull();
            expect(widthOf(container, CLOSED_BAR)).toBe('');
            expect(styleAttributeOf(container, CLOSED_BAR)).not.toBe('width: 0%;');
        });

        it('keeps the pending bar and the markup intact alongside the unusable width', () => {
            // The failure is confined to the one width that could not be
            // computed: the rest of the bar still renders, still carries its
            // tooltips, and the pending bar still holds its constant 97 %.
            const container = renderWithStats({
                total_points: 0,
                defined_points: 0,
                closed_points: 0,
            });

            expect(widthOf(container, PENDING_BAR)).toBe('97%');
            expect(classesOf(container)).toHaveLength(3);
            expect(titlesOf(container)).toEqual([
                'BACKLOG.EXCESS_OF_POINTS',
                'BACKLOG.PENDING_POINTS',
                'BACKLOG.CLOSED_POINTS',
            ]);
        });
    });
});

/* ==========================================================================
 * THE SPRINT BAR
 * ========================================================================== */

describe('SprintProgressBar', () => {
    describe('markup contract', () => {
        it('renders a single childless `div` carrying only the progress class', () => {
            // The shared template is one line -- `.current-progress(style!=...)`
            // at `app/partials/common/components/progress-bar.jade:8`. The host,
            // the track and the label all belong to the consumer.
            const container = renderSprintBar({ percentage: 50 });
            const bar = mustFind(container, CURRENT_BAR);

            expect(container.children).toHaveLength(1);
            expect(container.childNodes).toHaveLength(1);
            expect(container.firstElementChild).toBe(bar);
            expect(bar.tagName).toBe('DIV');
            expect(bar.className).toBe('current-progress');
            expect(bar.classList).toHaveLength(1);
            expect(bar.childNodes).toHaveLength(0);
        });

        it('emits no host element of its own', () => {
            // `SprintCard` owns `.sprint-progress-bar`, exactly as `SummaryBar`
            // owns the backlog bar's host.
            const container = renderSprintBar({ percentage: 50 });

            expect(container.querySelector(SPRINT_HOST)).toBeNull();
            expect(container.querySelector(SUMMARY_HOST)).toBeNull();
        });

        it('carries the width and nothing else -- no tooltip, no label, no data', () => {
            // The incumbent template sets a single attribute. A title added here
            // would appear on every sprint card in the sidebar untranslated.
            const container = renderSprintBar({ percentage: 50 });
            const bar = mustFind(container, CURRENT_BAR);

            expect(bar.getAttribute('style')).toBe('width: 50%;');
            expect(bar.getAttribute('title')).toBeNull();
            expect(bar.attributes).toHaveLength(2);
            expect(bar.textContent).toBe('');
        });

        it('renders from the percentage alone, consulting no translator', () => {
            // The negative path for the collaborator the OTHER bar needs. This
            // component takes no translator, and asserting the shared double is
            // never touched keeps it that way: a percentage is a number, and
            // formatting it through the catalogue would localise a CSS value.
            const container = renderSprintBar({ percentage: 50 });

            expect(widthOf(container, CURRENT_BAR)).toBe('50%');
            expect(mocks.t).not.toHaveBeenCalled();
        });

        it('renders identically when double-rendered under StrictMode', () => {
            const single = renderSprintBar({ percentage: 50 });
            const { container: strict } = render(
                <StrictMode>
                    <SprintProgressBar percentage={50} />
                </StrictMode>,
            );

            expect(strict.innerHTML).toBe(single.innerHTML);
        });
    });

    describe('clamping without rounding', () => {
        it('keeps every decimal the division produced', () => {
            // The counterpart to the backlog bar's rounding case, and the reason
            // the two clamp helpers must stay apart.
            //
            // Twenty one closed points of a hundred and one and a half is
            // 20.689655172413794 %, and the incumbent shared directive clamped
            // that value without rounding it. Rounding it -- which unifying the
            // two helpers would do -- turns this width into `21%` and fails here.
            const percentage = (100 * 21) / 101.5;
            const container = renderSprintBar({ percentage });

            expect(widthOf(container, CURRENT_BAR)).toBe('20.689655172413794%');
            expect(widthOf(container, CURRENT_BAR)).not.toBe('21%');
            expect(widthOf(container, CURRENT_BAR)).toContain('.');
        });

        it('applies no offset to a mid-range percentage', () => {
            // The backlog bar's other divergence: it surrenders three percent,
            // this bar surrenders none. A width of `47%` here would mean the
            // offset had leaked across.
            const container = renderSprintBar({ percentage: 50 });

            expect(widthOf(container, CURRENT_BAR)).toBe('50%');
            expect(widthOf(container, CURRENT_BAR)).not.toBe('47%');
        });

        it('clamps a percentage above one hundred down to 100 %', () => {
            // Reached by a sprint that closed more points than it was estimated
            // at, which the backend allows.
            const container = renderSprintBar({ percentage: 150 });

            expect(widthOf(container, CURRENT_BAR)).toBe('100%');
        });

        it('clamps a negative percentage up to 0 %', () => {
            const container = renderSprintBar({ percentage: -5 });

            expect(widthOf(container, CURRENT_BAR)).toBe('0%');
        });

        it('passes both boundaries through untouched', () => {
            // The clamp must not be exclusive at its own edges: an empty sprint
            // stays at zero and a finished one reaches the full track.
            expect(widthOf(renderSprintBar({ percentage: 0 }), CURRENT_BAR)).toBe('0%');
            expect(widthOf(renderSprintBar({ percentage: 100 }), CURRENT_BAR)).toBe('100%');
        });

        it('keeps a fraction below one percent rather than collapsing it to zero', () => {
            // A rounded clamp would erase the first point closed on a large
            // sprint, showing an empty bar to a team that had already started.
            const container = renderSprintBar({ percentage: 0.4 });

            expect(widthOf(container, CURRENT_BAR)).toBe('0.4%');
        });
    });

    describe('invalid input is reproduced, not guarded', () => {
        it('does not throw when the percentage is not a number', () => {
            // Reached whenever the total points of a sprint are zero and the
            // caller divides by them.
            expect(() => renderSprintBar({ percentage: NaN })).not.toThrow();
        });

        it('declares no width rather than substituting zero', () => {
            // Same reproduction, same reasoning, and the same distinguishing
            // assertion as the backlog bar: `width: NaN%` is rejected outright,
            // so the attribute is absent rather than set to a zero the
            // incumbent never drew.
            const container = renderSprintBar({ percentage: NaN });

            expect(styleAttributeOf(container, CURRENT_BAR)).toBeNull();
            expect(widthOf(container, CURRENT_BAR)).toBe('');
            expect(styleAttributeOf(container, CURRENT_BAR)).not.toBe('width: 0%;');
        });

        it('still renders the element itself rather than dropping the bar', () => {
            const container = renderSprintBar({ percentage: NaN });

            expect(container.children).toHaveLength(1);
            expect(mustFind(container, CURRENT_BAR).className).toBe('current-progress');
        });
    });
});

/* ==========================================================================
 * THE DIVERGENCE GUARD
 * ========================================================================== */

describe('BacklogProgressBar vs SprintProgressBar must not be unified', () => {
    it('renders two different widths from one and the same percentage', () => {
        // These directives are distinct: `app/coffee/modules/backlog/main.coffee:1362`
        // declares the backlog bar with a rounding, offsetting clamp, while
        // `app/coffee/modules/common/components.coffee:433` declares the shared
        // bar with a plain one. Unifying the clamp helpers is a T10 violation.
        //
        // One percentage, fed through both paths. Twenty one of a hundred and one
        // and a half is 20.689655172413794 %, and the statistics below are chosen
        // so the backlog bar computes that very number for BOTH of its widths:
        // 101.5 defined points exceed the 21 point total, so both divisions use
        // 101.5 as their denominator and 21 as their numerator.
        const percentage = (100 * 21) / 101.5;
        const backlog = renderWithStats({
            total_points: 21,
            defined_points: 101.5,
            closed_points: 21,
        });
        const sprint = renderSprintBar({ percentage });

        // The sprint bar keeps the number intact.
        expect(widthOf(sprint, CURRENT_BAR)).toBe('20.689655172413794%');

        // The backlog bar subtracts three and rounds: 17.689655... -> 18.
        expect(widthOf(backlog, PENDING_BAR)).toBe('18%');
        expect(widthOf(backlog, CLOSED_BAR)).toBe('18%');

        // Stated as the inequality the guard is really about, so a future reader
        // who makes the two agree sees the intent rather than only the numbers.
        expect(widthOf(backlog, PENDING_BAR)).not.toBe(widthOf(sprint, CURRENT_BAR));
        expect(Math.round(percentage - 3)).toBe(18);
        expect(`${percentage}%`).not.toBe(`${Math.round(percentage)}%`);
    });
});
