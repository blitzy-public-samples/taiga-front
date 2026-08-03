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
 * ========================================================================== */

import { render } from '@testing-library/react';
import { act } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { BurndownChart } from './BurndownChart';
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

/** The listener shape AngularJS calls: event object first, payload second. */
type BroadcastListener = (event: unknown, payload: unknown) => void;

interface RootScopeDouble {
    $on(eventName: string, listener: BroadcastListener): () => void;
    /** Raises the language-change event the way AngularJS raises it. */
    changeLanguageTo(language: string): void;
}

function createRootScopeDouble(): RootScopeDouble {
    const listeners: BroadcastListener[] = [];

    return {
        $on(_eventName: string, listener: BroadcastListener): () => void {
            listeners.push(listener);

            return (): void => {
                const at = listeners.indexOf(listener);

                if (at !== -1) {
                    listeners.splice(at, 1);
                }
            };
        },
        changeLanguageTo(language: string): void {
            act((): void => {
                [...listeners].forEach((listener: BroadcastListener): void => {
                    listener({ name: 'change' }, { language });
                });
            });
        },
    };
}

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

/**
 * An injector double over an explicit name-to-service table.
 *
 * The single narrowing assertion mirrors the one the folder's own sanctioned
 * mocking seam makes in `../bridge/mockInjector.ts`, and for the same reason: a
 * caller-chosen return type cannot be produced from a table of mixed values by
 * some other route. That seam is not reused directly here because it resolves
 * only the fifteen typed services, whereas the translation hook additionally
 * reaches the application root scope through the bridge's deliberate escape
 * hatch, and the hook logs a degradation warning when that is missing.
 */
function createInjector(
    services: Readonly<Record<string, unknown>>,
): AngularInjector {
    return {
        get<T>(name: string): T {
            return services[name] as T;
        },
    };
}

function wrapperFor(
    injector: AngularInjector,
): (props: { children?: ReactNode }) => ReactElement {
    return function Wrapper({
        children,
    }: {
        children?: ReactNode;
    }): ReactElement {
        return (
            <AngularBridgeProvider injector={injector}>
                {children}
            </AngularBridgeProvider>
        );
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

/* --------------------------------------------------------------------------
 * 5. HARNESS
 * -------------------------------------------------------------------------- */

interface Harness {
    readonly container: HTMLElement;
    readonly translate: TranslateDouble;
    readonly rootScope: RootScopeDouble;
    rerenderWith(props: BurndownChartProps): void;
    unmount(): void;
}

function mountChart(props: BurndownChartProps): Harness {
    const translate = createTranslateDouble();
    const rootScope = createRootScopeDouble();
    const injector = createInjector({
        $translate: translate,
        $rootScope: rootScope,
    });
    const wrapper = wrapperFor(injector);
    const view = render(<BurndownChart {...props} />, { wrapper });

    return {
        container: view.container,
        translate,
        rootScope,
        rerenderWith(next: BurndownChartProps): void {
            view.rerender(<BurndownChart {...next} />);
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
    it('renders exactly one element, carrying the one class its stylesheet selects', () => {
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(container.childElementCount).toBe(1);

        const host = hostOf(container);

        expect(host.tagName).toBe('DIV');
        expect(host.className).toBe('burndown');
        expect(host.childElementCount).toBe(0);
    });

    it('renders in the light DOM, so the global stylesheet and icon sprite stay reachable', () => {
        const { container } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(hostOf(container).shadowRoot).toBeNull();
    });

    it('renders the host even before the statistics have arrived', () => {
        const { container } = mountChart({ stats: undefined });

        expect(container.childElementCount).toBe(1);
        expect(hostOf(container).className).toBe('burndown');
    });

    it('renders no placeholder and no wrapper of its own', () => {
        // The collapsible container and the empty-state panel belong to the
        // screen container, so nothing but the host may appear here.
        const { container } = mountChart({ stats: undefined });

        expect(container.querySelectorAll('*')).toHaveLength(1);
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

    it('clears the host before drawing into it, so a redraw replaces rather than stacks', () => {
        const stub = createFlotStub(1254);

        mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.journal.indexOf('empty')).toBeLessThan(
            stub.journal.indexOf('plot'),
        );
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
 * PRESERVED DEFECT -- the measured series is COMPACTED, which re-indexes it
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
 * PRESERVED DEFECT -- zero sprints yields a descending, negative axis
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
        expect(optionsFor().xaxis.tickFormatter()).toBe('');
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
        const { translate, rootScope } = mountChart({
            stats: statsWith(TWO_SPRINTS),
        });

        translate.setLanguage('es');
        rootScope.changeLanguageTo('es');

        expect(stub.draws).toHaveLength(1);
        expect(stub.draws[0]?.options.xaxis.axisLabel).toBe(
            'en:BACKLOG.CHART.XAXIS_LABEL',
        );
    });

    it('picks the new language up on the NEXT draw, without subscribing itself', () => {
        const stub = createFlotStub(1254);
        const { translate, rootScope } = mountChart({
            stats: statsWith(TWO_SPRINTS),
        });

        translate.setLanguage('es');
        rootScope.changeLanguageTo('es');
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

    it('detaches the handlers the plugin bound to the host', () => {
        const stub = createFlotStub(1254);
        const { unmount } = mountChart({ stats: statsWith(TWO_SPRINTS) });

        expect(stub.journal).not.toContain('off');

        unmount();

        expect(stub.journal).toContain('off');
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
