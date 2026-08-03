/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * BurndownChart.test.tsx -- co-located spec for the Backlog burndown chart
 * ==========================================================================
 *
 * Runs BROWSERLESS in jsdom (constraint HR-5): no browser binary, no network,
 * and no dependency on generated build output. `npm test` executes this file
 * straight from TypeScript source.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./BurndownChart.tsx`, a React port of the retired AngularJS burndown
 * directive. The whole point of that component is FIDELITY: it hands the
 * retained jQuery Flot plugin an option object transcribed literal for literal
 * from the incumbent, and it preserves five defects the incumbent shipped. So
 * this spec is written as a CONTRACT ON WHAT REACHES THE DRAW CALL rather than
 * as a rendering test -- a canvas cannot be inspected in jsdom, and the pixels
 * are Flot's business, not the component's.
 *
 * HOW THE PLUGIN IS REACHED, AND WHY THAT MAKES THIS TESTABLE
 * -----------------------------------------------------------
 * jQuery and the Flot plugins are BROWSER GLOBALS supplied by the application's
 * concatenated vendor bundle, which this runner deliberately never loads. The
 * component therefore reads the global at the top of every draw and skips
 * drawing when it is absent. Two consequences, both exercised below:
 *
 *   - with the global absent the component still mounts and still renders its
 *     host, which is exactly what HR-5 requires;
 *   - with a stub factory installed, every argument the component would have
 *     given the real plugin becomes observable.
 *
 * The stub is installed with a property definition rather than an assignment,
 * because the component's own ambient declaration marks the global read-only --
 * it is written by the vendor bundle, never by application code -- and removed
 * again through the reflection helper, which needs no assertion either.
 *
 * WHY THE REAL TRANSLATION HOOK IS USED, NOT A MODULE MOCK
 * --------------------------------------------------------
 * The component's most subtle requirement is that a change of LANGUAGE must not
 * redraw the chart: the incumbent resolved its captions inside the redraw, so a
 * language switch left an already-drawn chart captioned in the old language
 * until the statistics changed. Proving that needs the real hook, because it is
 * the real hook that hands back a NEW lookup identity when the language
 * changes. A module mock returning a stable function would make the assertion
 * pass for the wrong reason.
 *
 * ==========================================================================
 * THREE PLACES WHERE THIS SPEC DELIBERATELY DIFFERS FROM THE PLAN THAT
 * COMMISSIONED IT, AND THE MEASUREMENT BEHIND EACH
 * ==========================================================================
 *
 * The plan for this spec was written against an EARLIER shape of the component.
 * Three of its instructions cannot be followed literally without asserting
 * something untrue, so each is reproduced in intent and recorded here. None is
 * a relaxation: in every case the substitute assertion is the stricter one.
 *
 * 1. NO INJECTOR AND NO PROVIDER, because the translator is a PROP.
 *    The plan has this spec stand the component inside a bridge provider
 *    carrying a mock injector, and prove by the injector's throw-on-unsupplied
 *    behaviour that the component asks for the translation service and nothing
 *    else. The component no longer asks for ANY service -- its owner passes the
 *    lookup down -- so the provider would be dead scaffolding and the injector
 *    import would not even compile under `noUnusedLocals`. The equivalent proof
 *    is stronger and needs no double at all: every case here renders the
 *    component BARE, and a component that still reached the bridge would throw,
 *    because the context's default value is null. See the final block.
 *
 * 2. THE HOST IS ONE VISIBLE ELEMENT, NOT THE ONLY ELEMENT.
 *    The plan expects a single `div.burndown` carrying nothing but a class. The
 *    component now also renders a `hidden` SIBLING holding the chart's textual
 *    equivalent, and gives the host the ARIA attributes that point at it. So
 *    "exactly one element carrying exactly one attribute" is replaced by two
 *    assertions that are together tighter: exactly one element occupies space,
 *    and the host's attribute set is enumerated EXHAUSTIVELY -- which is what
 *    actually protects the stylesheet contract, since an `id`, a `style` or a
 *    `data-` attribute appearing later would be caught.
 *
 * 3. THE PREDICTED FLOATING-POINT ARTEFACT DOES NOT OCCUR FOR THE PREDICTED
 *    VALUE. The plan names 8.2 as the value whose caption acquires a decimal
 *    tail, expecting 8.200000000000001. MEASURED IN THIS ENGINE, `8.2 * 10` is
 *    exactly 82, so 8.2 round-trips cleanly and an assertion for the predicted
 *    tail would fail. Asserting it "to be faithful to the plan" would have
 *    frozen a fiction. The real tail-bearing values were found by sweeping one-
 *    and two-decimal inputs, and the caption block below both pins those AND
 *    records the predicted value explicitly as one that is NOT produced, so the
 *    discrepancy is documented at the point where someone would look for it.
 * ========================================================================== */

import { render } from '@testing-library/react';
import { act } from '@testing-library/react';

import { BurndownChart, describeBurndownSeries } from './BurndownChart';
import type { BurndownChartProps } from './BurndownChart';
import type { BurndownMilestone, ProjectStats } from './state/types';

/* --------------------------------------------------------------------------
 * 1. STRUCTURAL MIRRORS OF WHAT THE COMPONENT HANDS THE PLUGIN
 *
 * The component keeps its plugin types module-private, which is correct -- they
 * describe a boundary, not a public surface. This spec therefore declares its
 * own minimal view of the same boundary, which is what lets every assertion
 * below be typed instead of poking at loose values.
 * -------------------------------------------------------------------------- */

/** One plotted point. Either slot may be padded out by the pairing helper. */
type SeriesPoint = readonly [number | undefined, number | undefined];

/** One series as the component builds it. */
interface RecordedSeries {
    readonly data: readonly SeriesPoint[];
    readonly lines: { readonly fillColor: string };
    readonly points?: { readonly show: boolean };
}

/** The hovered item the tooltip callback branches on. */
interface RecordedHoverItem {
    readonly seriesIndex: number;
}

/** Per-edge pixel measurements, for the border and the plot margin. */
interface RecordedEdges {
    readonly top: number;
    readonly right: number;
    readonly left: number;
    readonly bottom: number;
}

/**
 * The option object as the component builds it.
 *
 * `yaxis` is deliberately modelled as an open record rather than as a named
 * shape, because one of the assertions below is about a property that must be
 * ABSENT from it, and an exact shape would make that assertion vacuous.
 */
interface RecordedOptions {
    readonly grid: {
        readonly borderWidth: RecordedEdges;
        readonly borderColor: string;
        readonly color: string;
        readonly hoverable: boolean;
        readonly margin: RecordedEdges;
    };
    readonly xaxis: {
        readonly ticks: number;
        readonly axisLabel: string;
        readonly axisLabelUseCanvas: boolean;
        readonly axisLabelFontSizePixels: number;
        readonly axisLabelFontFamily: string;
        readonly axisLabelPadding: number;
        readonly tickFormatter: () => string;
    };
    readonly yaxis: Readonly<Record<string, unknown>>;
    readonly series: {
        readonly shadowSize: number;
        readonly lines: { readonly show: boolean; readonly fill: boolean };
        readonly points: {
            readonly show: boolean;
            readonly fill: boolean;
            readonly radius: number;
            readonly lineWidth: number;
        };
    };
    readonly colors: readonly string[];
    readonly tooltip: boolean;
    readonly tooltipOpts: {
        readonly content: (
            label: string,
            xval: number,
            yval: number,
            flotItem: RecordedHoverItem,
        ) => string;
    };
}

/** One recorded draw. */
interface DrawCall {
    readonly series: readonly RecordedSeries[];
    readonly options: RecordedOptions;
}

/* --------------------------------------------------------------------------
 * 2. THE PLUGIN STUB
 * -------------------------------------------------------------------------- */

interface FlotStub {
    /** Every draw, in order. */
    readonly draws: readonly DrawCall[];
    /** Every method called on the wrapper, in call order. */
    readonly journal: readonly string[];
    /** Every element the factory was asked to wrap, in order. */
    readonly wrapped: readonly HTMLElement[];
    /** The heights written onto the host, in order. */
    readonly heights: readonly number[];
    /** How many times the factory itself was called. */
    factoryCalls(): number;
    /** Changes the width the wrapper reports, for the resize specs. */
    setWidth(next: number): void;
}

/**
 * Builds a stand-in for the wrapper the vendor bundle would supply, recording
 * everything the component does to it.
 *
 * The recorded journal is what makes the ORDERING assertions possible: the
 * incumbent sizes the host before drawing and clears it before drawing, and both
 * of those are ordering facts rather than value facts.
 */
function createFlotStub(initialWidth: number): FlotStub {
    const draws: DrawCall[] = [];
    const journal: string[] = [];
    const wrapped: HTMLElement[] = [];
    const heights: number[] = [];
    let width = initialWidth;
    let factoryCallCount = 0;

    const target = {
        width(): number {
            journal.push('width');

            return width;
        },
        height(pixels: number): void {
            journal.push(`height:${pixels}`);
            heights.push(pixels);
        },
        empty(): void {
            journal.push('empty');
        },
        off(): void {
            journal.push('off');
        },
        plot(
            series: readonly RecordedSeries[],
            options: RecordedOptions,
        ): { data(key: string): unknown } {
            journal.push('plot');
            draws.push({ series, options });

            return {
                data(key: string): unknown {
                    journal.push(`data:${key}`);

                    return undefined;
                },
            };
        },
    };

    const factory = (element: HTMLElement): typeof target => {
        factoryCallCount += 1;
        wrapped.push(element);

        return target;
    };

    // A property definition rather than an assignment: the component declares
    // this global read-only, because the vendor bundle owns it. `configurable`
    // is what lets the teardown below remove it again.
    Object.defineProperty(window, 'jQuery', {
        value: factory,
        configurable: true,
        writable: true,
    });

    return {
        draws,
        journal,
        wrapped,
        heights,
        factoryCalls(): number {
            return factoryCallCount;
        },
        setWidth(next: number): void {
            width = next;
        },
    };
}

/** Returns the runner to the state HR-5 describes: no vendor bundle present. */
function removeFlotStub(): void {
    Reflect.deleteProperty(window, 'jQuery');
}

/* --------------------------------------------------------------------------
 * 3. THE ANGULARJS SEAM
 *
 * The component reaches the translation service through the bridge, and the
 * bridge hook additionally observes the application root scope so that a
 * language change re-renders its consumers. Both are supplied here, so the
 * hook takes its normal path and logs no degradation warning.
 * -------------------------------------------------------------------------- */

/*
 * ⭐ NO ROOT-SCOPE DOUBLE, NO INJECTOR AND NO PROVIDER IN THIS FILE ANY MORE.
 *
 * The chart used to resolve translation itself, so its spec had to stand up an
 * injector carrying `$translate` AND the application root scope -- the latter
 * only because the translation hook subscribes to the language-change event
 * through it. None of that described the chart; it was scaffolding for a
 * dependency the chart should not have had.
 *
 * The translator now arrives as a prop, so this spec renders the component with
 * NO WRAPPER AT ALL. That is an assertion in itself: a component that still
 * reached the bridge would throw here, because there is no provider above it.
 */

/**
 * A translation double whose lookup echoes the key and its parameters, so an
 * assertion can prove BOTH which key was chosen and what was interpolated into
 * it. The active language prefixes the result, which is how a caption resolved
 * before a language change is told apart from one resolved after it.
 */
interface TranslateDouble {
    instant: jest.Mock<
        string,
        [string, (Record<string, unknown> | undefined)?]
    >;
    preferredLanguage(): string;
    getTranslationTable(langKey: string): Record<string, unknown>;
    setLanguage(next: string): void;
}

function createTranslateDouble(): TranslateDouble {
    let active = 'en';

    return {
        instant: jest.fn(
            (
                key: string,
                interpolateParams?: Record<string, unknown>,
            ): string => {
                if (interpolateParams === undefined) {
                    return `${active}:${key}`;
                }

                const rendered = Object.keys(interpolateParams)
                    .sort()
                    .map(
                        (name: string): string =>
                            `${name}=${String(interpolateParams[name])}`,
                    )
                    .join('|');

                return `${active}:${key}{${rendered}}`;
            },
        ),
        preferredLanguage(): string {
            return active;
        },
        getTranslationTable(): Record<string, unknown> {
            return {};
        },
        setLanguage(next: string): void {
            active = next;
        },
    };
}

/* --------------------------------------------------------------------------
 * 4. FIXTURES
 *
 * Shaped from the statistics payload the screen really receives. The figures
 * are the ones measured off the committed design reference for this screen --
 * 392.5 defined points and 21 closed points -- so a reader can line the
 * fixtures up against that image.
 * -------------------------------------------------------------------------- */

function milestone(
    name: string,
    optimal: number,
    evolution: number | null,
    teamIncrement = 0,
    clientIncrement = 0,
): BurndownMilestone {
    return {
        name,
        optimal,
        evolution,
        'team-increment': teamIncrement,
        'client-increment': clientIncrement,
    };
}

function statsWith(
    milestones: readonly BurndownMilestone[],
): ProjectStats {
    return {
        assigned_points: 101.5,
        closed_points: 21,
        completedPercentage: 5,
        defined_points: 392.5,
        milestones,
        speed: 0,
        total_milestones: milestones.length,
        total_points: 392,
    };
}

/** Three sprints, the middle one not yet measured. Drives the compaction spec. */
const THREE_SPRINTS: readonly BurndownMilestone[] = [
    milestone('Sprint 1', 392.5, 392.5, 0, 0),
    milestone('Sprint 2', 261.7, null, 3, 2),
    milestone('Sprint 3', 130.8, 300.25, 5, 7),
];

/** Two fully measured sprints, for the specs that want no compaction. */
const TWO_SPRINTS: readonly BurndownMilestone[] = [
    milestone('Sprint 1', 392.5, 392.5, 0, 0),
    milestone('Sprint 2', 196.25, 371.5, 4, 6),
];

/**
 * FOUR sprints with the gap in the SECOND position and three distinct
 * measurements either side of it: 10, absent, 30, 40.
 *
 * Deliberately distinct, round and non-monotonic-looking values, because this
 * is the fixture that makes the compaction VISIBLE rather than merely short: a
 * reader can see that 30 -- which belongs at axis position 2 -- is drawn at
 * position 1, that 40 slides from 3 to 2, and that position 3 is left without a
 * value. Two sprints could not show a shift of more than one place, and equal
 * values could not show a shift at all.
 */
const GAPPED_SPRINTS: readonly BurndownMilestone[] = [
    milestone('Sprint 1', 100, 10, 1, 1),
    milestone('Sprint 2', 75, null, 2, 2),
    milestone('Sprint 3', 50, 30, 3, 3),
    milestone('Sprint 4', 25, 40, 4, 4),
];

/**
 * A single sprint carrying the increments the commissioning plan names -- three
 * from the team and five from the client -- so the two derived series come out
 * at distinguishable magnitudes (-3 and -8) instead of coinciding.
 */
const INCREMENT_PROBE: readonly BurndownMilestone[] = [
    milestone('Sprint 1', 200, 200, 3, 5),
];

/**
 * ⭐ HOW A MEASUREMENT BECOMES `undefined` WITHOUT A SINGLE CAST.
 *
 * The component filters the measured series on BOTH `null` and `undefined`, and
 * the domain type admits only `number | null` -- so the `undefined` half of that
 * guard looks unreachable and invites deletion. It is not unreachable. The
 * compiler is not configured to add `undefined` to the result of an index
 * lookup, so reading a MISSING KEY out of a record of measurements yields the
 * static type `number | null` and the runtime value `undefined`. That is a
 * shape real code produces: a lookup table keyed by sprint name simply has no
 * entry for a sprint nobody has measured yet.
 *
 * This is the same property of the configuration that lets the component index
 * its sprint list with an out-of-range axis value and throw rather than fail to
 * compile -- asserted at the end of the no-sprints block.
 */
const MEASUREMENTS_BY_SPRINT: Readonly<Record<string, number | null>> = {
    'Sprint 1': 10,
    'Sprint 3': 30,
};

/**
 * Reads a measurement for a sprint out of the table above.
 *
 * For `'Sprint 2'` there is no entry, so this returns `undefined` at runtime
 * while typing as `number | null` -- exactly the value the guard exists for.
 */
function measurementFor(sprintName: string): number | null {
    return MEASUREMENTS_BY_SPRINT[sprintName];
}

/* --------------------------------------------------------------------------
 * 5. HARNESS
 * -------------------------------------------------------------------------- */

/** Everything the harness supplies for the caller, minus the translator. */
type ChartProps = Omit<BurndownChartProps, 'translate'>;

interface Harness {
    readonly container: HTMLElement;
    readonly translate: TranslateDouble;
    rerenderWith(props: ChartProps): void;
    /**
     * Changes the active language the way the OWNER now would: the double's
     * lookup starts answering in the new language, and the component is
     * re-rendered with a FRESH function identity, because a real owner's
     * memoised translator is re-created on a language change.
     */
    changeLanguageTo(language: string): void;
    unmount(): void;
}

/**
 * Renders the chart with a translator PROP and no provider whatsoever.
 *
 * `translate` is wrapped in a fresh arrow on every render so its identity is
 * unstable — the pessimistic case. That is deliberate: it is what proves the
 * component holds the translator in a ref rather than in its effect's dependency
 * list, since an unstable identity in the list would redraw the chart on every
 * single render.
 */
function mountChart(props: ChartProps): Harness {
    const translate = createTranslateDouble();

    const translateFn = (
        key: string,
        interpolateParams?: Record<string, unknown>,
    ): string => translate.instant(key, interpolateParams);

    const view = render(<BurndownChart {...props} translate={translateFn} />);

    return {
        container: view.container,
        translate,
        rerenderWith(next: ChartProps): void {
            view.rerender(<BurndownChart {...next} translate={translateFn} />);
        },
        changeLanguageTo(language: string): void {
            translate.setLanguage(language);

            act((): void => {
                view.rerender(
                    <BurndownChart
                        {...props}
                        translate={(
                            key: string,
                            interpolateParams?: Record<string, unknown>,
                        ): string => translate.instant(key, interpolateParams)}
                    />,
                );
            });
        },
        unmount(): void {
            view.unmount();
        },
    };
}

/** The single host element the component is allowed to render. */
function hostOf(container: HTMLElement): HTMLElement {
    const host = container.querySelector('.burndown');

    if (host === null) {
        throw new Error('the component rendered no `.burndown` host');
    }

    if (!(host instanceof HTMLElement)) {
        throw new Error('the `.burndown` host is not an HTML element');
    }

    return host;
}

function fireWindowResize(): void {
    act((): void => {
        window.dispatchEvent(new Event('resize'));
    });
}

afterEach((): void => {
    removeFlotStub();
});

/* ==========================================================================
 * THE HOST ELEMENT AND THE CLASS CONTRACT (rules T1 and I6)
 * ========================================================================== */

describe('the rendered host', () => {
    it('renders ONE VISIBLE element, carrying the one class its stylesheet selects', () => {
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        const host = hostOf(container);

        expect(host.tagName).toBe('DIV');
        // Exactly the class its five-line stylesheet selects, and no other: rule T1
        // means zero stylesheet edits, which only holds while the class contract does.
        expect(host.className).toBe('burndown');
        // NO CHILDREN. The plugin fills the host at draw time and empties it before
        // every redraw, so a React child here would be destroyed on the first resize --
        // which is precisely why the accessible description is a sibling instead. See
        // the accessibility block below.
        expect(host.childElementCount).toBe(0);

        // The one sibling is that description, and it is `hidden`, so the host remains
        // the only element that occupies space.
        const visible = Array.from(container.children).filter(
            (child) => !child.hasAttribute('hidden'),
        );

        expect(visible).toEqual([host]);
    });

    it('renders in the light DOM, so the global stylesheet and icon sprite stay reachable', () => {
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(hostOf(container).shadowRoot).toBeNull();
    });

    it('carries an EXHAUSTIVELY enumerated attribute set, and nothing more', () => {
        // The stylesheet contract is what rule T1 rests on -- zero stylesheet edits
        // only hold while the markup keeps its side of the bargain -- so the host's
        // attributes are pinned as a SET rather than checked one at a time. Anything
        // added later fails here, which is the point: an `id` would collide with the
        // shell's own document, a `style` would defeat the stylesheet, and a `data-`
        // attribute would smuggle state into the DOM that React already holds.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });
        const host = hostOf(container);

        expect(
            Array.from(host.attributes)
                .map((attribute: Attr): string => attribute.name)
                .sort(),
        ).toEqual(['aria-describedby', 'aria-label', 'class', 'role']);

        // Spelled out individually as well, because the three that matter most are
        // absences and a reader should not have to infer them from the list above.
        expect(host.hasAttribute('id')).toBe(false);
        expect(host.hasAttribute('style')).toBe(false);
        expect(
            Array.from(host.attributes).some((attribute: Attr): boolean =>
                attribute.name.startsWith('data-'),
            ),
        ).toBe(false);
    });

    it.each([
        ['not set at all', undefined],
        ['explicitly empty', null],
    ] as ReadonlyArray<[string, undefined | null]>)(
        'renders the host before the statistics have arrived, when they are %s',
        (_label: string, absent: undefined | null) => {
            // BOTH absent forms, because the incumbent's guard was a single
            // existential test that excluded each of them, and the host sat in the
            // document from the moment the screen was compiled either way.
            const { container } = mountChart({ stats: absent });

            expect(hostOf(container).className).toBe('burndown');
        },
    );

    it('renders no placeholder and no wrapper of its own', () => {
        // The collapsible container and the empty-state panel belong to the screen
        // container, so nothing but the host and its hidden description may appear --
        // and NO WRAPPER around them, because the container's max-height slide and the
        // host's `width: 100%` both assume the existing parent-child relationship.
        const { container } = mountChart({ stats: undefined });

        expect(container.childElementCount).toBe(2);
        expect(
            Array.from(container.children).map((child) => child.tagName),
        ).toEqual(['DIV', 'DIV']);
        expect(hostOf(container).parentElement).toBe(container);
    });
});

/* ==========================================================================
 * ACCESSIBILITY -- THE CANVAS IS NOT THE ONLY WAY TO READ THIS CHART
 *
 * A chart drawn onto a canvas is an empty box to a screen reader. These cases
 * assert the role, the name and the textual alternative -- and that all of it is
 * invisible, because every one of them is an ARIA attribute or a `hidden` element,
 * so nothing here can conflict with the design reference (drift entry D4).
 * ========================================================================== */

describe('accessibility', () => {
    /** The hidden sibling the host describes itself with. */
    function descriptionOf(container: HTMLElement): HTMLElement {
        const host = hostOf(container);
        const id = host.getAttribute('aria-describedby');

        expect(id).toBeTruthy();

        const description = container.querySelector(`#${String(id)}`);

        if (description === null) {
            throw new Error('aria-describedby points at no element');
        }

        return description as HTMLElement;
    }

    it('presents the host as a single graphic rather than a container', () => {
        // Without the role, a reader walks the canvases and absolutely-positioned
        // label elements the plugin appends, announcing fragments of scaffolding.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(hostOf(container)).toHaveAttribute('role', 'img');
    });

    it('NAMES the host from the two existing axis-label keys', () => {
        // ⭐ NO NEW TRANSLATION KEY. The locale file has no title for this chart, the
        // locale files are not in scope, and a key added to English alone would leave
        // every other locale rendering a raw key. Composing the name from the two axis
        // labels says exactly what the chart plots, in the active locale.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(hostOf(container)).toHaveAttribute(
            'aria-label',
            'en:BACKLOG.CHART.YAXIS_LABEL / en:BACKLOG.CHART.XAXIS_LABEL',
        );
    });

    it('describes the host with a SIBLING, never a child', () => {
        // ⭐ THE CONSTRAINT THAT DECIDES THE MARKUP: `redrawChart` calls
        // `target.empty()` before every draw, so anything rendered INSIDE the host
        // would be destroyed by the first redraw and by every resize afterwards --
        // silently, and only in a real browser.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });
        const host = hostOf(container);
        const description = descriptionOf(container);

        expect(host.contains(description)).toBe(false);
        expect(description.parentElement).toBe(host.parentElement);
        expect(host.childElementCount).toBe(0);
    });

    it('keeps the description out of the layout entirely', () => {
        // `hidden` gives it `display: none` from the user-agent stylesheet, and nothing
        // in scope overrides that: `burndown.scss` is five lines and
        // `.graphics-container` sets only a max-height slide. A hidden element
        // referenced by `aria-describedby` is still read, which is what makes this
        // both invisible and effective.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });
        const description = descriptionOf(container);

        expect(description.hasAttribute('hidden')).toBe(true);
        expect(description.className).toBe('');
        expect(description.getAttribute('style')).toBeNull();
    });

    it('carries one sentence per series point, in the tooltip\u2019s own words', () => {
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });
        const sentences = Array.from(
            descriptionOf(container).querySelectorAll('p'),
        ).map((paragraph) => paragraph.textContent);

        // Two fully measured sprints, four described series each: optimal, real, and
        // the two increments. The keys are exactly the four the hover caption uses.
        expect(sentences).toHaveLength(8);
        expect(sentences[0]).toContain('BACKLOG.CHART.OPTIMAL');
        expect(sentences[1]).toContain('BACKLOG.CHART.REAL');
        expect(sentences[2]).toContain('BACKLOG.CHART.INCREMENT_CLIENT');
        expect(sentences[3]).toContain('BACKLOG.CHART.INCREMENT_TEAM');
    });

    it('keeps the description present, and empty, when there is nothing to plot', () => {
        // The id must always resolve: an `aria-describedby` pointing at a missing
        // element is a validity error in some tools and announces nothing in others.
        const { container } = mountChart({ stats: null });
        const description = descriptionOf(container);

        expect(description.querySelectorAll('p')).toHaveLength(0);
    });

    it('follows the active language', () => {
        const { container, changeLanguageTo } = mountChart({
            stats: statsWith(TWO_SPRINTS),
        });

        changeLanguageTo('es');

        // Unlike the canvas, which deliberately keeps its captions until the next draw,
        // the text alternative is ordinary React output and re-renders immediately.
        expect(hostOf(container)).toHaveAttribute(
            'aria-label',
            'es:BACKLOG.CHART.YAXIS_LABEL / es:BACKLOG.CHART.XAXIS_LABEL',
        );
    });
});

/* ==========================================================================
 * describeBurndownSeries -- THE TEXTUAL MAPPING, ASSERTED DIRECTLY
 * ========================================================================== */

describe('describeBurndownSeries', () => {
    /** Echoes the key and its interpolated values, like the harness double. */
    const echo = (key: string, params?: Record<string, unknown>): string =>
        params === undefined
            ? key
            : `${key}{${Object.keys(params)
                  .sort()
                  .map((name) => `${name}=${String(params[name])}`)
                  .join('|')}}`;

    it('emits optimal, real and both increments for a measured milestone', () => {
        const sentences = describeBurndownSeries(
            [milestone('Sprint 1', 392.5, 371.5, 4, 6)],
            echo,
        );

        expect(sentences).toEqual([
            'BACKLOG.CHART.OPTIMAL{sprintName=Sprint 1|value=392.5}',
            'BACKLOG.CHART.REAL{sprintName=Sprint 1|value=371.5}',
            // Both increments, from the same negated values the series plots, run back
            // through the tooltip's own `Math.abs(y * 10) / 10`.
            'BACKLOG.CHART.INCREMENT_CLIENT{sprintName=Sprint 1|value=10}',
            'BACKLOG.CHART.INCREMENT_TEAM{sprintName=Sprint 1|value=4}',
        ]);
    });

    it('\u2b50 omits the real-points sentence for an UNMEASURED milestone', () => {
        // The plotted evolution series is COMPACTED, so its index no longer lines up
        // with the milestone index and the hover caption can name the wrong sprint --
        // a faithfully preserved incumbent quirk. Text has no such constraint, so the
        // sentence is emitted if and only if THAT milestone has a measured value.
        // Copying the misalignment into prose would be copying a bug somewhere it does
        // not exist.
        const sentences = describeBurndownSeries(
            [milestone('Sprint 2', 261.7, null, 3, 2)],
            echo,
        );

        expect(sentences).toHaveLength(3);
        expect(sentences.some((sentence) => sentence.includes('REAL'))).toBe(false);
    });

    it('does not describe the zero baseline series', () => {
        // It carries no information -- it IS the axis -- and it is the one series whose
        // markers the chart also switches off.
        const sentences = describeBurndownSeries(TWO_SPRINTS, echo);

        expect(sentences).toHaveLength(8);
    });

    it('walks the milestones in order', () => {
        const sentences = describeBurndownSeries(THREE_SPRINTS, echo);

        expect(sentences[0]).toContain('Sprint 1');
        // Sprint 2 is unmeasured, so it contributes three sentences rather than four.
        expect(sentences[4]).toContain('Sprint 2');
        expect(sentences[7]).toContain('Sprint 3');
        expect(sentences).toHaveLength(11);
    });

    it('describes nothing for an empty milestone list', () => {
        expect(describeBurndownSeries([], echo)).toEqual([]);
    });
});

/* ==========================================================================
 * ABSENCE OF THE STATISTICS, AND ABSENCE OF THE VENDOR BUNDLE
 * ========================================================================== */

describe('when there is nothing to draw', () => {
    it.each([
        ['not set at all', undefined],
        ['explicitly empty', null],
    ] as ReadonlyArray<[string, undefined | null]>)(
        'skips the draw entirely when the statistics are %s',
        (_label: string, absent: undefined | null) => {
            const stub = createFlotStub(1254);

            mountChart({ stats: absent });

            expect(stub.factoryCalls()).toBe(0);
            expect(stub.draws).toHaveLength(0);
            expect(stub.journal).toHaveLength(0);
        },
    );

    it('registers no resize listener until the statistics arrive', () => {
        const stub = createFlotStub(1254);
        const { rerenderWith } = mountChart({ stats: null });

        fireWindowResize();

        expect(stub.draws).toHaveLength(0);

        // The moment they arrive, both the draw and the listener appear.
        rerenderWith({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws).toHaveLength(1);

        fireWindowResize();

        expect(stub.draws).toHaveLength(2);
    });

    it('mounts and renders without throwing when the vendor bundle is absent (HR-5)', () => {
        // No stub installed at all: this is the browserless runner's real state.
        expect(window.jQuery).toBeUndefined();

        const mount = (): Harness =>
            mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(mount).not.toThrow();
        expect(hostOf(mount().container).className).toBe('burndown');
    });

    it('does not log when the vendor bundle is absent', () => {
        // An expected condition must not become noise on every mount.
        const warn = jest.spyOn(console, 'warn').mockImplementation(undefined);
        const error = jest.spyOn(console, 'error').mockImplementation(undefined);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('recovers on a later draw when the bundle appears after mount', () => {
        // The global is read at the top of every draw rather than once at setup,
        // so a draw attempted too early is skipped and the next one succeeds.
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(hostOf(container).className).toBe('burndown');

        const stub = createFlotStub(1254);

        fireWindowResize();

        expect(stub.draws).toHaveLength(1);
    });
});

/* ==========================================================================
 * SIZING -- the six-to-one ratio is imperative, not styled
 * ========================================================================== */

describe('sizing', () => {
    it('writes a height of one sixth of the measured width, before drawing', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        // 1254 / 6 is 209 exactly -- the height measured on the committed
        // design reference for a panel of that width.
        expect(stub.heights).toEqual([209]);
        expect(stub.journal.indexOf('width')).toBeLessThan(
            stub.journal.indexOf('height:209'),
        );
        expect(stub.journal.indexOf('height:209')).toBeLessThan(
            stub.journal.indexOf('plot'),
        );
    });

    it('applies the same ratio to a narrower panel', () => {
        // 600 / 6 is 100. A second width, because a single measurement is consistent
        // with a hardcoded height as well as with a ratio.
        const stub = createFlotStub(600);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.heights).toEqual([100]);
    });

    it('does NOT round the quotient', () => {
        // Every width used above divides by six exactly, which would also be true of
        // a rounded implementation. 1000 does not: the ratio must reach the plugin as
        // the full repeating fraction, because rounding it would shift the canvas by
        // a fraction of a pixel against the axis labels the plugin positions from the
        // same number.
        const stub = createFlotStub(1000);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.heights).toEqual([1000 / 6]);
        expect(stub.heights[0]).toBe(166.66666666666666);
        expect(Number.isInteger(stub.heights[0])).toBe(false);
    });

    it('still draws when the element measures zero, adding no guard of its own', () => {
        // ⭐ THE BROWSERLESS RUNNER'S REAL MEASUREMENT. jsdom performs no layout, so
        // a live element genuinely reports a width of zero here. The incumbent sized
        // and drew unconditionally, and so does this: a guard would be a behaviour
        // change, and in a real browser a zero width only ever means the container is
        // collapsed -- which the next resize corrects.
        const stub = createFlotStub(0);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.heights).toEqual([0]);
        expect(stub.draws).toHaveLength(1);
    });

    it('clears the host before drawing into it, so a redraw replaces rather than stacks', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.journal.indexOf('empty')).toBeLessThan(
            stub.journal.indexOf('plot'),
        );
    });

    it('measures, sizes, clears and draws exactly once each, in that order', () => {
        // The whole sequence in one assertion, so the ORDER and the COUNTS are pinned
        // together. A second `empty` would mean the host was cleared after being
        // drawn into -- a blank chart -- and a missing one would mean canvases stack
        // on every resize until the panel grows without bound.
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.journal).toEqual([
            'width',
            'height:209',
            'empty',
            'plot',
            'data:plot',
        ]);
        expect(
            stub.journal.filter((entry: string): boolean => entry === 'empty'),
        ).toHaveLength(1);
    });

    it('asks the plot for its stored handle and discards it', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.journal).toContain('data:plot');
        expect(stub.journal.indexOf('plot')).toBeLessThan(
            stub.journal.indexOf('data:plot'),
        );
    });

    it('re-measures the live element on every draw rather than caching a width', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });
        stub.setWidth(600);
        fireWindowResize();

        expect(stub.heights).toEqual([209, 100]);
    });

    it('wraps the rendered host itself, not some other element', () => {
        const stub = createFlotStub(1254);
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.wrapped).toEqual([hostOf(container)]);
    });
});

/* ==========================================================================
 * THE FIVE SERIES
 * ========================================================================== */

describe('the series handed to the plot', () => {
    function drawWith(
        milestones: readonly BurndownMilestone[],
    ): readonly RecordedSeries[] {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(milestones) });

        const first = stub.draws[0];

        if (first === undefined) {
            throw new Error('the component performed no draw');
        }

        return first.series;
    }

    it('hands over exactly five series, in the documented order of fills', () => {
        const series = drawWith(TWO_SPRINTS);

        expect(series).toHaveLength(5);
        expect(
            series.map((entry: RecordedSeries): string => entry.lines.fillColor),
        ).toEqual([
            'rgba(0,0,0,0)',
            'rgba(200,201,196,0.2)',
            'rgba(147,196,0,0.2)',
            'rgba(200,201,196,0.2)',
            'rgba(255,160,160,0.2)',
        ]);
    });

    it('switches markers off on the baseline series and on no other', () => {
        const series = drawWith(TWO_SPRINTS);

        expect(series[0]?.points).toEqual({ show: false });
        [1, 2, 3, 4].forEach((ordinal: number): void => {
            expect(series[ordinal]?.points).toBeUndefined();
        });
    });

    it('plots a flat baseline of one zero per sprint', () => {
        expect(drawWith(TWO_SPRINTS)[0]?.data).toEqual([
            [0, 0],
            [1, 0],
        ]);
    });

    it('plots the ideal ramp straight from each sprint', () => {
        expect(drawWith(TWO_SPRINTS)[1]?.data).toEqual([
            [0, 392.5],
            [1, 196.25],
        ]);
    });

    it('negates both increments for the client series, and the team one alone for the last', () => {
        const series = drawWith(TWO_SPRINTS);

        // Sprint 2 carries a team increment of 4 and a client increment of 6.
        expect(series[3]?.data).toEqual([
            [0, -0],
            [1, -10],
        ]);
        expect(series[4]?.data).toEqual([
            [0, -0],
            [1, -4],
        ]);
    });

    it('distinguishes the two increment series, which one negation would merge', () => {
        // ⭐ THE DOUBLE NEGATION, isolated. The client series carries
        // `-team - client` and the team series carries `-team`, so with a team
        // increment of three and a client increment of five they read -8 and -3. Drop
        // either minus sign, or fold the team increment out of the client series, and
        // the two lines coincide -- which is exactly the kind of change that looks
        // like a simplification and silently erases one of the five series.
        const series = drawWith(INCREMENT_PROBE);

        expect(series[3]?.data).toEqual([[0, -8]]);
        expect(series[4]?.data).toEqual([[0, -3]]);
        expect(series[3]?.data[0]?.[1]).not.toBe(series[4]?.data[0]?.[1]);
    });

    it('indexes every series by ascending axis position, not by array position', () => {
        // The x coordinates come from a generated range that is zipped against each
        // value list, so they ascend from zero independently of how each list was
        // built. Asserted across ALL FIVE series -- including the compacted one, whose
        // VALUES are re-indexed while its POSITIONS are not, which is the whole
        // mechanism of the defect two blocks down.
        const series = drawWith(GAPPED_SPRINTS);
        const expected = [0, 1, 2, 3];

        expect(series).toHaveLength(5);
        series.forEach((entry: RecordedSeries): void => {
            expect(
                entry.data.map((point: SeriesPoint): number | undefined => point[0]),
            ).toEqual(expected);
        });
    });

    it('keeps a genuine zero measurement rather than treating it as absent', () => {
        const series = drawWith([
            milestone('Sprint 1', 100, 0),
            milestone('Sprint 2', 50, 25),
        ]);

        expect(series[2]?.data).toEqual([
            [0, 0],
            [1, 25],
        ]);
    });
});

/* ==========================================================================
 * The measured series is COMPACTED, which re-indexes it
 * ========================================================================== */

describe('the compacted measurement series (a preserved defect)', () => {
    function measuredSeries(
        milestones: readonly BurndownMilestone[],
    ): RecordedSeries {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(milestones) });

        const series = stub.draws[0]?.series[2];

        if (series === undefined) {
            throw new Error('the measurement series was not handed over');
        }

        return series;
    }

    /* ----------------------------------------------------------------------
     * ⛔ PRESERVED DEFECT -- DO NOT "FIX" ANY OF THE FOUR CASES BELOW.
     *
     * `coffee/modules/backlog/main.coffee:1257` filters the measured values
     * before pairing them with the axis:
     *
     *     evolution_line = _.filter(_.map(dataToDraw.milestones,
     *                                    (ml) -> ml.evolution),
     *                               (evolution) -> evolution?)
     *
     * The filter REMOVES the unmeasured entries instead of leaving holes, so
     * every surviving value slides down to fill the gap and is drawn against
     * the WRONG sprint. The pairing helper then pads the freed trailing
     * positions, because it spans the longer of the two lists (`:1259`).
     *
     * This is a genuine data-shifting defect in the shipped product, and it is
     * reproduced deliberately: replacing the filter with a hole-preserving map,
     * or substituting a zero or a not-a-number for the absent samples, would
     * each change the line the user sees. Rule T10 -- no functional change
     * whatsoever -- puts that out of bounds, so these cases exist to fail loudly
     * if anyone tidies it.
     * ---------------------------------------------------------------------- */

    it('⛔ shifts EVERY later measurement down by the number of gaps before it', () => {
        // Four sprints measured 10, absent, 30, 40. The gap at position 1 pulls 30
        // from position 2 to position 1 and 40 from position 3 to position 2, and
        // position 3 is left without a value at all -- so the line stops one sprint
        // early AND misreports the two sprints it does draw.
        expect(measuredSeries(GAPPED_SPRINTS).data).toEqual([
            [0, 10],
            [1, 30],
            [2, 40],
            [3, undefined],
        ]);
    });

    it('⛔ spans the AXIS length rather than the surviving-measurement length', () => {
        // Three values survive, yet four points are handed over: the pairing helper
        // pads to the longer list instead of truncating to the shorter one. Truncating
        // would be the more obvious implementation and would draw the same visible
        // line, which is why the length is pinned explicitly rather than inferred.
        const data = measuredSeries(GAPPED_SPRINTS).data;

        const surviving = GAPPED_SPRINTS.filter(
            (sample: BurndownMilestone): boolean => sample.evolution !== null,
        ).length;

        expect(surviving).toBe(3);
        expect(data).toHaveLength(GAPPED_SPRINTS.length);
        expect(data).toHaveLength(4);
    });

    it('⛔ leaves the other four series aligned across the SAME four sprints', () => {
        // The defect is confined to the measured series. The other four keep one value
        // per sprint, which is precisely what makes the misalignment visible on
        // screen: the real-progress line drifts away from the ideal ramp beside it.
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(GAPPED_SPRINTS) });

        [0, 1, 3, 4].forEach((ordinal: number): void => {
            const series = stub.draws[0]?.series[ordinal];

            expect(series?.data).toHaveLength(4);
            series?.data.forEach((point: SeriesPoint): void => {
                expect(point[1]).not.toBeUndefined();
            });
        });
    });

    it('⛔ drops an ABSENT measurement exactly as it drops an empty one', () => {
        /*
         * The incumbent's existential test excluded both forms of absence at once,
         * and the port's guard names them both. `undefined` looks impossible here --
         * the domain type admits only a number or an empty measurement -- which is
         * why this case exists: the compiler is not configured to widen an index
         * lookup, so a missing entry in a table of measurements types as
         * `number | null` and arrives as `undefined`. See MEASUREMENTS_BY_SPRINT.
         *
         * Deleting the `undefined` half of the guard would let that value through to
         * the plot, where it becomes a point at an undefined height rather than an
         * omitted one.
         */
        const fromLookup: readonly BurndownMilestone[] = [
            milestone('Sprint 1', 100, measurementFor('Sprint 1')),
            milestone('Sprint 2', 75, measurementFor('Sprint 2')),
            milestone('Sprint 3', 50, measurementFor('Sprint 3')),
        ];

        // The middle sprint really is absent rather than empty, which is what makes
        // this a test of the second half of the guard and not a repeat of the first.
        expect(fromLookup[1]?.evolution).toBeUndefined();
        expect(fromLookup[1]?.evolution).not.toBeNull();

        expect(measuredSeries(fromLookup).data).toEqual([
            [0, 10],
            [1, 30],
            [2, undefined],
        ]);
    });

    it('shifts a later measurement onto an earlier axis position', () => {
        // Sprint 2 has no measurement, so sprint 3's value of 300.25 -- which
        // belongs at axis position 2 -- is plotted at axis position 1 instead.
        // Reproduced deliberately; the shipped product does this.
        expect(measuredSeries(THREE_SPRINTS).data).toEqual([
            [0, 392.5],
            [1, 300.25],
            [2, undefined],
        ]);
    });

    it('leaves the freed trailing positions without a value, so the line ends early', () => {
        const data = measuredSeries(THREE_SPRINTS).data;

        // The length still spans the axis -- it is the VALUES that ran out.
        expect(data).toHaveLength(3);
        expect(data[2]?.[1]).toBeUndefined();
    });

    it('spans the longer of the axis and the surviving measurements', () => {
        const axisLength = THREE_SPRINTS.length;
        const surviving = THREE_SPRINTS.filter(
            (sample: BurndownMilestone): boolean => sample.evolution !== null,
        ).length;

        expect(measuredSeries(THREE_SPRINTS).data).toHaveLength(
            Math.max(axisLength, surviving),
        );
    });

    it('drops every unmeasured sprint, however many there are', () => {
        const series = measuredSeries([
            milestone('Sprint 1', 90, null),
            milestone('Sprint 2', 60, null),
            milestone('Sprint 3', 30, 12.5),
        ]);

        expect(series.data).toEqual([
            [0, 12.5],
            [1, undefined],
            [2, undefined],
        ]);
    });

    it('leaves the other four series aligned to the axis', () => {
        // Only the measurement series compacts. Everything else keeps one value
        // per sprint, which is what makes the defect visible on screen.
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(THREE_SPRINTS) });

        [0, 1, 3, 4].forEach((ordinal: number): void => {
            const series = stub.draws[0]?.series[ordinal];

            expect(series?.data).toHaveLength(3);
            series?.data.forEach((point: SeriesPoint): void => {
                expect(point[1]).not.toBeUndefined();
            });
        });
    });
});

/* ==========================================================================
 * Zero sprints yields a descending, negative axis
 * ========================================================================== */

describe('with no sprints at all (a preserved defect)', () => {
    it('produces the degenerate two-position axis rather than an empty one', () => {
        // The incumbent's inclusive range counts DOWN when its end falls below
        // its start, so an empty sprint list gives positions 0 and -1. Neither
        // position carries a value, because every value list is empty.
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith([]) });

        const series = stub.draws[0]?.series;

        expect(series).toHaveLength(5);
        series?.forEach((entry: RecordedSeries): void => {
            expect(entry.data).toEqual([
                [0, undefined],
                [-1, undefined],
            ]);
        });
    });

    it('still draws, and reports a tick count of zero', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith([]) });

        expect(stub.draws).toHaveLength(1);
        expect(stub.draws[0]?.options.xaxis.ticks).toBe(0);
    });

    it('adds no guard of its own around the empty list', () => {
        // A guard would be a behaviour change: the placeholder decision belongs
        // to the screen container, which treats a total of zero as PRESENT.
        const stub = createFlotStub(1254);

        expect((): Harness => mountChart({ stats: statsWith([]) })).not.toThrow();
        expect(stub.journal).toContain('plot');
    });

    it('⛔ THROWS if the caption is asked about the negative axis position', () => {
        /*
         * ⛔ PRESERVED, AND DELIBERATELY UNGUARDED.
         *
         * The degenerate axis above contains position -1, and the caption names its
         * sprint by indexing the sprint list with the axis value
         * (`coffee/modules/backlog/main.coffee:1335`). On an empty list that lookup
         * yields nothing and reading a name off it throws -- in the incumbent
         * identically, since CoffeeScript compiled the same index expression.
         *
         * NO GUARD WAS ADDED, for two reasons. It is unreachable in practice: the
         * plugin only calls the caption for a point the pointer is actually over, and
         * a chart with no sprints has no drawn points to hover. And adding one would
         * be a behaviour change under rule T10, in a component whose entire purpose
         * is transcription. The compiler permits the expression because it is not
         * configured to widen index lookups -- the same property the absent-
         * measurement case above relies on -- so this is a runtime fact that the type
         * checker cannot see, which is exactly why it is asserted here.
         */
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith([]) });

        const content = stub.draws[0]?.options.tooltipOpts.content;

        if (content === undefined) {
            throw new Error('no tooltip callback was handed over');
        }

        expect((): string => content('', -1, 0, { seriesIndex: 1 })).toThrow();

        // Position 0 is no better off: the list is empty, so both positions of the
        // degenerate axis are out of range. Asserted so the case cannot be misread as
        // being about negative numbers specifically.
        expect((): string => content('', 0, 0, { seriesIndex: 1 })).toThrow();
    });
});

/* ==========================================================================
 * THE OPTION OBJECT
 * ========================================================================== */

describe('the options handed to the plot', () => {
    function optionsFor(
        milestones: readonly BurndownMilestone[] = TWO_SPRINTS,
    ): RecordedOptions {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(milestones) });

        const first = stub.draws[0];

        if (first === undefined) {
            throw new Error('the component performed no draw');
        }

        return first.options;
    }

    it('borders the grid on the right edge only, and insets it on two sides', () => {
        const { grid } = optionsFor();

        expect(grid.borderWidth).toEqual({
            top: 0,
            right: 1,
            left: 0,
            bottom: 0,
        });
        expect(grid.margin).toEqual({ top: 0, right: 20, left: 5, bottom: 0 });
    });

    it('hands over the WHOLE grid object, with no member beyond these five', () => {
        // The members are asserted individually either side of this case; this one
        // pins the object as a WHOLE, so a sixth member -- a background, a tick
        // colour, a click handler -- cannot be introduced unnoticed. Every value is
        // a canvas literal rather than a stylesheet value, because canvas paint
        // cannot read a variable: this is the design system's sanctioned exception.
        expect(optionsFor().grid).toEqual({
            borderWidth: { top: 0, right: 1, left: 0, bottom: 0 },
            borderColor: '#D8DEE9',
            color: '#D8DEE9',
            hoverable: true,
            margin: { top: 0, right: 20, left: 5, bottom: 0 },
        });
    });

    it('gives the border and the gridlines one shared colour, and enables hovering', () => {
        const { grid } = optionsFor();

        // One value drives both: the plot derives the near-invisible gridlines
        // from it at a fraction of its alpha, which is why no separate gridline
        // colour is set. Hovering is what feeds the tooltip.
        expect(grid.borderColor).toBe('#D8DEE9');
        expect(grid.color).toBe('#D8DEE9');
        expect(grid.hoverable).toBe(true);
    });

    it('ticks the horizontal axis once per sprint', () => {
        expect(optionsFor(TWO_SPRINTS).xaxis.ticks).toBe(TWO_SPRINTS.length);
        expect(optionsFor(THREE_SPRINTS).xaxis.ticks).toBe(
            THREE_SPRINTS.length,
        );
    });

    it('formats every horizontal tick as the empty string', () => {
        // Deliberate: the axis shows tick positions and never a caption, which
        // is exactly what the committed design reference shows.
        const { tickFormatter } = optionsFor().xaxis;

        expect(typeof tickFormatter).toBe('function');
        expect(tickFormatter()).toBe('');

        // The plugin calls the formatter WITH the tick value and the axis object. The
        // port declares it as taking nothing, which is sound only because it ignores
        // both -- so it is invoked here the way the plugin really invokes it, through
        // a reference typed as the plugin's own two-parameter contract, to prove the
        // arguments cannot influence the result.
        const asPluginCallsIt: (
            value: number,
            axis: Readonly<Record<string, unknown>>,
        ) => string = tickFormatter;

        expect(asPluginCallsIt(3, {})).toBe('');
        expect(asPluginCallsIt(0, { min: 0, max: 3 })).toBe('');
    });

    it('gives the vertical axis NO tick formatter', () => {
        // The asymmetry with the axis above is in the source and is preserved.
        expect('tickFormatter' in optionsFor().yaxis).toBe(false);
    });

    it('draws both axis captions into the canvas at twelve pixels, in the retained stack', () => {
        const { xaxis, yaxis } = optionsFor();

        expect(xaxis.axisLabelUseCanvas).toBe(true);
        expect(xaxis.axisLabelFontSizePixels).toBe(12);
        expect(xaxis.axisLabelFontFamily).toBe(
            'Verdana, Arial, Helvetica, Tahoma, sans-serif',
        );
        expect(xaxis.axisLabelPadding).toBe(5);

        expect(yaxis.axisLabelUseCanvas).toBe(true);
        expect(yaxis.axisLabelFontSizePixels).toBe(12);
        expect(yaxis.axisLabelFontFamily).toBe(
            'Verdana, Arial, Helvetica, Tahoma, sans-serif',
        );
        expect(yaxis.axisLabelPadding).toBe(5);
    });

    it('translates both axis captions instead of hardcoding them', () => {
        const { xaxis, yaxis } = optionsFor();

        expect(xaxis.axisLabel).toBe('en:BACKLOG.CHART.XAXIS_LABEL');
        expect(yaxis.axisLabel).toBe('en:BACKLOG.CHART.YAXIS_LABEL');
    });

    it('sets the shared per-series defaults', () => {
        const { series } = optionsFor();

        expect(series.shadowSize).toBe(0);
        expect(series.lines).toEqual({ show: true, fill: true });
        // A radius of four with a two-pixel stroke is the ten-pixel hollow dot
        // measured on the committed design reference.
        expect(series.points).toEqual({
            show: true,
            fill: true,
            radius: 4,
            lineWidth: 2,
        });
    });

    it('hands over the WHOLE per-series default object, and nothing else', () => {
        // As with the grid: the three members are checked individually above, and
        // pinned as a whole here so nothing can be added silently. A shadow of zero
        // matters visually -- the plugin's default is a soft drop shadow under every
        // line, which the design reference does not show.
        expect(optionsFor().series).toEqual({
            shadowSize: 0,
            lines: { show: true, fill: true },
            points: { show: true, fill: true, radius: 4, lineWidth: 2 },
        });
    });

    it('lists the five line colours positionally, at full alpha where they must be seen', () => {
        expect(optionsFor().colors).toEqual([
            'rgba(200,201,196,0.2)',
            'rgba(216,222,233,1)',
            'rgba(168,228,64,1)',
            'rgba(216,222,233,1)',
            'rgba(255,160,160,1)',
        ]);
    });

    it('keeps the last series\u2019 fill alpha distinct from its line alpha', () => {
        // Unifying the two would either erase the line or flood the plot.
        const { colors } = optionsFor();
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws[0]?.series[4]?.lines.fillColor).toBe(
            'rgba(255,160,160,0.2)',
        );
        expect(colors[4]).toBe('rgba(255,160,160,1)');
        expect(colors[4]).not.toBe(stub.draws[0]?.series[4]?.lines.fillColor);
    });

    it('enables the tooltip', () => {
        expect(optionsFor().tooltip).toBe(true);
    });
});

/* ==========================================================================
 * THE TOOLTIP -- including its preserved fallthrough and its float arithmetic
 * ========================================================================== */

describe('the tooltip caption', () => {
    function contentFor(
        milestones: readonly BurndownMilestone[] = THREE_SPRINTS,
    ): RecordedOptions['tooltipOpts']['content'] {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(milestones) });

        const content = stub.draws[0]?.options.tooltipOpts.content;

        if (content === undefined) {
            throw new Error('no tooltip callback was handed over');
        }

        return content;
    }

    it.each([
        [1, 'BACKLOG.CHART.OPTIMAL'],
        [2, 'BACKLOG.CHART.REAL'],
        [3, 'BACKLOG.CHART.INCREMENT_CLIENT'],
    ] as ReadonlyArray<[number, string]>)(
        'captions series %i with %s',
        (seriesIndex: number, key: string) => {
            const content = contentFor();

            expect(content('', 0, 392.5, { seriesIndex })).toBe(
                `en:${key}{sprintName=Sprint 1|value=392.5}`,
            );
        },
    );

    it('captions the last series with the team-increment key', () => {
        expect(contentFor()('', 2, -5, { seriesIndex: 4 })).toBe(
            'en:BACKLOG.CHART.INCREMENT_TEAM{sprintName=Sprint 3|value=5}',
        );
    });

    it('sends the BASELINE series to the team-increment key too (a preserved defect)', () => {
        // The source tests ordinals 1, 2 and 3 and sends everything else -- the
        // baseline included -- to the team-increment caption. Hovering the
        // baseline therefore reads as though it were the team increment. The
        // fallthrough is the shipped behaviour; no branch for ordinal 0 exists.
        expect(contentFor()('', 1, 0, { seriesIndex: 0 })).toBe(
            'en:BACKLOG.CHART.INCREMENT_TEAM{sprintName=Sprint 2|value=0}',
        );
    });

    it('sends every unrecognised ordinal to the same fallthrough', () => {
        const content = contentFor();

        [5, 9, 42].forEach((seriesIndex: number): void => {
            expect(content('', 0, 1, { seriesIndex })).toContain(
                'BACKLOG.CHART.INCREMENT_TEAM{',
            );
        });
    });

    it('names the hovered sprint by indexing the sprint list with the axis value', () => {
        const content = contentFor();

        expect(content('', 0, 1, { seriesIndex: 1 })).toContain(
            'sprintName=Sprint 1|',
        );
        expect(content('', 2, 1, { seriesIndex: 1 })).toContain(
            'sprintName=Sprint 3|',
        );
    });

    it('reports the magnitude, so a negative series reads positive', () => {
        expect(contentFor()('', 0, -12, { seriesIndex: 3 })).toContain(
            'value=12}',
        );
    });

    it('discards no decimal place -- the expression is not a rounding step', () => {
        const content = contentFor();

        expect(content('', 0, 0.123, { seriesIndex: 1 })).toContain(
            'value=0.123}',
        );
        expect(content('', 0, -16.5, { seriesIndex: 2 })).toContain(
            'value=16.5}',
        );
    });

    it('reproduces the floating-point tail the arithmetic introduces', () => {
        /*
         * Scaling by ten and dividing back is NOT the identity in binary
         * floating point, so the caption really does show a long decimal tail
         * for some values. That is why the expression is transcribed rather
         * than simplified to a bare magnitude: the two are observably different
         * strings, and the difference is user-facing text.
         *
         * ⚠ THE VALUES BELOW WERE MEASURED, NOT ASSUMED. This engine computes
         * `8.2 * 10` as exactly 82, so 8.2 round-trips cleanly and does NOT
         * exhibit the tail -- an intuitive-looking choice of fixture that would
         * have made this spec pass for the wrong reason. A sweep of one- and
         * two-decimal values found the real cases; 0.11 and 0.47 are two of
         * them. Do not "correct" these fixtures back to a tidier number.
         */
        expect(Math.abs(0.11 * 10) / 10).not.toBe(0.11);
        expect(Math.abs(0.47 * 10) / 10).not.toBe(0.47);

        const content = contentFor();

        expect(content('', 0, 0.11, { seriesIndex: 1 })).toContain(
            'value=0.11000000000000001}',
        );
        expect(content('', 0, -0.47, { seriesIndex: 2 })).toContain(
            'value=0.4699999999999999}',
        );
    });

    it('is not equivalent to a bare magnitude, which is why it is not simplified', () => {
        // The single clearest reason the expression must stay verbatim: for the
        // values above, the two produce different captions. Compared WHOLE
        // rather than by containment, because the tail-bearing caption does
        // contain the shorter one as a prefix.
        const content = contentFor();
        const verbatim = content('', 0, 0.11, { seriesIndex: 1 });
        const simplified = `en:BACKLOG.CHART.OPTIMAL{sprintName=Sprint 1|value=${String(
            Math.abs(0.11),
        )}}`;

        expect(verbatim).not.toBe(simplified);
        expect(verbatim).toBe(
            'en:BACKLOG.CHART.OPTIMAL{sprintName=Sprint 1|value=0.11000000000000001}',
        );
    });

    it('⛔ reports the three values the plan named, as this engine really computes them', () => {
        /*
         * ⛔ PRESERVED DEFECT, AND A CORRECTION TO THE PLAN THAT COMMISSIONED IT.
         *
         * `coffee/modules/backlog/main.coffee:1326` (and the three sibling branches
         * at `:1329`, `:1332` and `:1335`) compute the displayed figure as
         *
         *     value: Math.abs(yval * 10) / 10
         *
         * That is NOT a rounding step. It multiplies and divides back, which is the
         * identity for most values and leaks a decimal tail for some -- so it is
         * transcribed verbatim rather than simplified to a magnitude or replaced with
         * a rounding call, either of which would change user-visible caption text and
         * violate rule T10.
         *
         * ⚠ THE PLAN PREDICTED THE WRONG VALUE. It names 8.2 as the tail-bearing
         * case, expecting a caption of 8.200000000000001. MEASURED HERE: this engine
         * computes `8.2 * 10` as exactly 82, so 8.2 round-trips cleanly and the
         * predicted caption is never produced. The prediction is recorded as a
         * negative assertion below rather than quietly dropped, so that anyone
         * checking this spec against the plan finds the discrepancy resolved at the
         * point they look for it. The values that DO carry a tail are pinned in the
         * case above, and were found by sweeping one- and two-decimal inputs.
         */
        const content = contentFor();

        // The arithmetic itself, measured before it is asserted through the caption.
        expect(8.2 * 10).toBe(82);
        expect(Math.abs(8.2 * 10) / 10).toBe(8.2);
        expect(Math.abs(8.2 * 10) / 10).not.toBe(8.200000000000001);

        // 8.2 -- the plan's prediction of 8.200000000000001 does not occur.
        expect(content('', 0, 8.2, { seriesIndex: 1 })).toBe(
            'en:BACKLOG.CHART.OPTIMAL{sprintName=Sprint 1|value=8.2}',
        );

        // -12.5 -- the magnitude, exactly, because halves are representable.
        expect(content('', 0, -12.5, { seriesIndex: 3 })).toBe(
            'en:BACKLOG.CHART.INCREMENT_CLIENT{sprintName=Sprint 1|value=12.5}',
        );

        // 0.123 -- three decimals kept, which is the clearest single proof that the
        // expression is not rounding to one decimal place.
        expect(content('', 0, 0.123, { seriesIndex: 2 })).toBe(
            'en:BACKLOG.CHART.REAL{sprintName=Sprint 1|value=0.123}',
        );
    });

    it('round-trips the tidier values cleanly, as the shipped captions show', () => {
        // Recorded so the two behaviours are not confused: most real point
        // totals are halves, and every one of those is exact.
        const content = contentFor();

        [392.5, 371.5, 101.5, 53.5, 25.5, 20.5, 18.5, 16.5].forEach(
            (value: number): void => {
                expect(content('', 0, value, { seriesIndex: 1 })).toContain(
                    `value=${String(value)}}`,
                );
            },
        );
    });

    it('ignores its first argument, which the plugin passes positionally', () => {
        const content = contentFor();

        expect(content('a label', 0, 1, { seriesIndex: 1 })).toBe(
            content('', 0, 1, { seriesIndex: 1 }),
        );
    });
});

/* ==========================================================================
 * REDRAW TRIGGERS -- one resize listener, and nothing else
 * ========================================================================== */

describe('redraw triggers', () => {
    it('draws once on mount', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws).toHaveLength(1);
    });

    it('redraws exactly once per window resize', () => {
        // The incumbent registered a listener inside its statistics watcher, so
        // listeners accumulated and one resize triggered several redraws. One
        // registration is observably equivalent, because each redraw clears the
        // host first -- and it sheds the accumulation.
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });
        fireWindowResize();

        expect(stub.draws).toHaveLength(2);

        fireWindowResize();

        expect(stub.draws).toHaveLength(3);
    });

    it('keeps exactly one listener across several statistics changes', () => {
        const stub = createFlotStub(1254);
        const { rerenderWith } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        rerenderWith({ stats: statsWith(THREE_SPRINTS) });
        rerenderWith({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws).toHaveLength(3);

        fireWindowResize();

        // Four, not six: one resize, one redraw.
        expect(stub.draws).toHaveLength(4);
    });

    it('redraws when the statistics change identity', () => {
        const stub = createFlotStub(1254);
        const { rerenderWith } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        rerenderWith({ stats: statsWith(THREE_SPRINTS) });

        expect(stub.draws).toHaveLength(2);
        expect(stub.draws[1]?.options.xaxis.ticks).toBe(3);
    });

    it('does NOT redraw when re-rendered with the same statistics reference', () => {
        const stub = createFlotStub(1254);
        const stats = statsWith(TWO_SPRINTS);
        const { rerenderWith } = mountChart({ stats });

        rerenderWith({ stats });
        rerenderWith({ stats });

        expect(stub.draws).toHaveLength(1);
    });

    it('does NOT redraw when the language changes', () => {
        // The lookup identity changes on a language change, and the chart must
        // not be rebuilt on account of it: the incumbent resolved its captions
        // inside the redraw, so an already-drawn chart kept the old captions
        // until the statistics changed. This is what proves the lookup is held
        // in a ref rather than listed as a dependency.
        const stub = createFlotStub(1254);
        const { changeLanguageTo } = mountChart({
            stats: statsWith(TWO_SPRINTS),
        });

        changeLanguageTo('es');

        expect(stub.draws).toHaveLength(1);
        expect(stub.draws[0]?.options.xaxis.axisLabel).toBe(
            'en:BACKLOG.CHART.XAXIS_LABEL',
        );
    });

    it('picks the new language up on the NEXT draw, without subscribing itself', () => {
        const stub = createFlotStub(1254);
        const { changeLanguageTo } = mountChart({
            stats: statsWith(TWO_SPRINTS),
        });

        changeLanguageTo('es');
        fireWindowResize();

        expect(stub.draws).toHaveLength(2);
        expect(stub.draws[1]?.options.xaxis.axisLabel).toBe(
            'es:BACKLOG.CHART.XAXIS_LABEL',
        );
    });

    it('resolves the captions at draw time, not once at mount', () => {
        const stub = createFlotStub(1254);
        const { translate } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        const beforeResize = translate.instant.mock.calls.length;

        fireWindowResize();

        expect(translate.instant.mock.calls.length).toBeGreaterThan(
            beforeResize,
        );
        expect(stub.draws).toHaveLength(2);
    });

    it('stops drawing again, and stops listening, when the statistics go away', () => {
        // The round trip, because the arrival direction is covered above and the
        // DEPARTURE direction is where a stale closure would show: an effect that
        // failed to tear down would keep redrawing from the statistics it captured,
        // drawing a chart for data the screen no longer has.
        const stub = createFlotStub(1254);
        const { rerenderWith } = mountChart({ stats: null });

        expect(stub.draws).toHaveLength(0);

        rerenderWith({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws).toHaveLength(1);

        rerenderWith({ stats: null });

        // No farewell draw, and no listener left behind.
        expect(stub.draws).toHaveLength(1);

        fireWindowResize();

        expect(stub.draws).toHaveLength(1);
    });

    it('resolves the axis captions eagerly and the hover captions only on demand', () => {
        // The asymmetry is in the source and is preserved: the two axis captions are
        // resolved while the option object is being built, whereas the four hover
        // captions live inside a callback the plugin invokes on hover. Resolving them
        // eagerly would mean four lookups per draw for text nobody has asked for --
        // and, worse, would freeze the caption wording at draw time in a way the
        // language-change cases above would no longer detect.
        const stub = createFlotStub(1254);
        const { translate } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        const keysUsed = (): readonly string[] =>
            translate.instant.mock.calls.map(
                (call: readonly [string, ...unknown[]]): string => call[0],
            );

        expect(keysUsed()).toContain('BACKLOG.CHART.XAXIS_LABEL');
        expect(keysUsed()).toContain('BACKLOG.CHART.YAXIS_LABEL');

        // The four hover keys are absent -- with one qualification worth stating,
        // because it would otherwise look like a contradiction: the textual
        // alternative rendered beside the host uses the SAME four keys, so they are
        // resolved during render even though the tooltip has not been invoked. What
        // this case pins is that the DRAW does not resolve them, which is asserted by
        // counting: the description accounts for every occurrence, and the tooltip
        // adds one more the moment it is invoked.
        const beforeHover = translate.instant.mock.calls.length;

        const content = stub.draws[0]?.options.tooltipOpts.content;

        if (content === undefined) {
            throw new Error('no tooltip callback was handed over');
        }

        expect(translate.instant.mock.calls.length).toBe(beforeHover);

        content('', 0, 1, { seriesIndex: 1 });

        expect(translate.instant.mock.calls.length).toBe(beforeHover + 1);
        expect(keysUsed()[keysUsed().length - 1]).toBe('BACKLOG.CHART.OPTIMAL');
    });
});

/* ==========================================================================
 * TEARDOWN
 * ========================================================================== */

describe('teardown', () => {
    it('removes the resize listener, so a later resize draws nothing', () => {
        const stub = createFlotStub(1254);
        const { unmount } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.draws).toHaveLength(1);

        unmount();
        fireWindowResize();

        expect(stub.draws).toHaveLength(1);
    });

    it('detaches the handlers the plugin bound to the host, exactly once', () => {
        // The count matters, not just the presence. The incumbent detached once, on
        // scope destruction (`coffee/modules/backlog/main.coffee:1354`); detaching on
        // every redraw instead would strip the handlers the plugin itself binds for
        // hovering, and the tooltip would stop appearing after the first resize.
        const stub = createFlotStub(1254);
        const { unmount } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        fireWindowResize();

        expect(stub.journal).not.toContain('off');

        unmount();

        expect(
            stub.journal.filter((entry: string): boolean => entry === 'off'),
        ).toHaveLength(1);
        // On the host itself, not on some other element the component reached for.
        expect(stub.wrapped[stub.wrapped.length - 1]).toBe(stub.wrapped[0]);
    });

    it('tears down without throwing when the vendor bundle has gone away', () => {
        createFlotStub(1254);

        const { unmount } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        removeFlotStub();

        expect(unmount).not.toThrow();
    });

    it('removes the listener even when the statistics were absent', () => {
        const stub = createFlotStub(1254);
        const { unmount } = mountChart({ stats: null });

        unmount();
        fireWindowResize();

        expect(stub.draws).toHaveLength(0);
    });
});

/* ==========================================================================
 * INJECTOR ISOLATION -- THE COMPONENT ASKS THE BRIDGE FOR NOTHING
 *
 * The plan for this spec proves the component's service appetite by supplying a
 * mock injector that THROWS for anything it was not given, and showing that a
 * map holding only the translation service is enough. That proof no longer
 * applies, because the component asks for no service at all: its owner passes
 * the lookup down as a prop.
 *
 * The replacement is stricter, and it is the absence of scaffolding rather than
 * the presence of it. Every case in this file renders the component with NO
 * provider anywhere above it, so the bridge context holds its default value of
 * null -- and the bridge's accessor hook rejects that, by design, so a component
 * that reached for a service would fail on mount. The cases below make that
 * implicit proof explicit, since a reader should not have to notice an absence.
 *
 * This is what requirement I9's coverage gate depends on: a component that owns
 * no data and resolves no service is a pure function of its props, and can be
 * exercised exhaustively in a browserless runner. Every branch of this
 * component is reached above without a single framework double.
 * ========================================================================== */

describe('injector isolation', () => {
    it('mounts with NO bridge provider above it', () => {
        // No provider, no injector, no root scope, no AngularJS module -- and the
        // component both renders and draws. Nothing is imported from the bridge in
        // this file beyond the translator's type, which is the compiler's own record
        // of the same fact.
        const stub = createFlotStub(1254);

        expect((): Harness =>
            mountChart({ stats: statsWith(TWO_SPRINTS) }),
        ).not.toThrow();
        expect(stub.draws).toHaveLength(1);
    });

    it('reaches nothing on the window except the charting global', () => {
        /*
         * ⭐ THE BROWSERLESS GUARANTEE (HR-5), stated as a property of the component
         * rather than of the configuration: the only ambient thing it touches is the
         * charting factory the vendor bundle installs. Nothing here transfers data or
         * persists anything, so the suite needs no network, no server, no fixture and
         * no browser binary.
         *
         * ⚠ EVERY PRIMITIVE IS INSTRUMENTED THROUGH ITS PROTOTYPE, AND THE STORAGE ONE
         * HAS TO BE. The runner's storage object is a proxy whose property writes are
         * STORAGE WRITES, so replacing a method on the instance stores a value under
         * that name instead of substituting the method -- the spy silently fails to
         * install and the assertion then passes for no reason at all. Instrumenting
         * `Storage.prototype` is the form that actually takes effect. The request
         * primitive is taken from its prototype for the same reason of robustness: the
         * prototype exists however an individual call would have been made.
         *
         * The fetch probe is INSTALLED rather than spied on, because this runner
         * provides no fetch implementation at all -- an even stronger guarantee, but
         * one that would make a spy-based assertion depend on the runner's version
         * rather than on the component. Installing a recorder works either way:
         * whatever the runner does or does not ship, a call would land here.
         */
        const openSpy = jest.spyOn(XMLHttpRequest.prototype, 'open');
        const sendSpy = jest.spyOn(XMLHttpRequest.prototype, 'send');
        const storageSpy = jest.spyOn(Storage.prototype, 'setItem');

        const fetchProbe = jest.fn();
        const runnerSuppliesFetch = 'fetch' in globalThis;
        const suppliedFetch: unknown = Reflect.get(globalThis, 'fetch');

        Object.defineProperty(globalThis, 'fetch', {
            value: fetchProbe,
            configurable: true,
            writable: true,
        });

        try {
            const stub = createFlotStub(1254);
            const { unmount } = mountChart({ stats: statsWith(THREE_SPRINTS) });

            fireWindowResize();
            unmount();

            // A full lifecycle -- mount, redraw, teardown -- and not one of them.
            expect(stub.draws).toHaveLength(2);
            expect(fetchProbe).not.toHaveBeenCalled();
            expect(openSpy).not.toHaveBeenCalled();
            expect(sendSpy).not.toHaveBeenCalled();
            expect(storageSpy).not.toHaveBeenCalled();
        } finally {
            if (runnerSuppliesFetch) {
                Object.defineProperty(globalThis, 'fetch', {
                    value: suppliedFetch,
                    configurable: true,
                    writable: true,
                });
            } else {
                Reflect.deleteProperty(globalThis, 'fetch');
            }
        }
    });

    it('takes its translator from the prop it was handed, not from a global', () => {
        // Two mounts, two independent doubles: the captions each chart resolves come
        // from ITS OWN translator. A component reading a shared or module-scoped lookup
        // would produce identical captions here.
        const first = createFlotStub(1254);
        const one = mountChart({ stats: statsWith(TWO_SPRINTS) });

        one.changeLanguageTo('es');
        fireWindowResize();

        expect(first.draws[1]?.options.xaxis.axisLabel).toBe(
            'es:BACKLOG.CHART.XAXIS_LABEL',
        );

        // The second chart's own translator is untouched by the first one's language
        // change, because there is no shared state between them to change.
        const second = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(second.translate).not.toBe(one.translate);
        expect(first.draws[first.draws.length - 1]?.options.xaxis.axisLabel).toBe(
            'en:BACKLOG.CHART.XAXIS_LABEL',
        );
    });
});
