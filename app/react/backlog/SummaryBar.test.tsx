/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for the backlog's dark statistics band (`./SummaryBar.tsx`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. BROWSERLESS BY CONSTRUCTION (constraint HR-5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The unit under test is a pure function of its props apart from ONE translator
 * lookup, so every case below renders it in jsdom behind a mock injector and
 * asserts on emitted markup rather than on computed style. Nothing here launches
 * a browser, opens a socket, reaches the network or reads build output: this file
 * passes with `dist/` deleted and no browser binary installed anywhere on the
 * machine. That is why the presentational/container split exists at all
 * (requirement I9) — the band's data loading, its persisted preference and its
 * drag effects all live in `./BacklogScreen.tsx` and its hooks, leaving a
 * component whose entire behaviour is reachable from props.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2. WHAT THIS FILE IS FOR (rules T1 and T10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two jobs, and neither is "check that React renders".
 *
 * FIRST, it locks the exact CLASS-NAME AND NESTING CONTRACT, because
 * `app/styles/components/summary.scss` is a pass-through asset reused with zero
 * edits (rule T1). Every selector that stylesheet targets — `.summary`,
 * `.summary-stats`, `.data .number`, `.number`, `.description`, `.stats`,
 * `.stats.active`, `.stats svg`, `.summary-progress-bar` and the progress bar's
 * three overlaid segments — is asserted by STRING EQUALITY rather than by
 * `toContain`, so a stray extra class fails the case instead of passing it.
 *
 * SECOND, it locks four pieces of PRESERVED, DELIBERATELY UNIMPROVED behaviour
 * (rule T10). Each one looks like a defect and each one is the incumbent's
 * observable behaviour, so each one has a case naming its source locator:
 *
 *   - the toggle's title key is MISSPELLED in the shipped catalogue
 *     (`app/locales/taiga/locale-en.json:1468`);
 *   - an absent statistics payload renders a LONE PERCENT SIGN, not `0%`
 *     (`app/partials/includes/components/summary.jade:12`);
 *   - the first statistic block is gated on TRUTHINESS, not on presence, so a
 *     project total of zero hides it (`…/summary.jade:14`);
 *   - the static two-hyphen placeholder the source markup carried must NOT be
 *     emitted, because the binding overwrote it before a user ever saw it
 *     (`…/summary.jade:15`, `:18`, `:21`, `:24`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 3. WHY TWO CASES READ A FILE FROM DISK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two of this component's decisions are only correct as long as the SHIPPED
 * LOCALE still says what it said when they were made: the four statistic labels
 * embed a line break element, and the toggle's title key is misspelled. A
 * hand-written fixture cannot catch the catalogue drifting away from either fact —
 * it would keep passing while production rendered a raw key as a tooltip. So the
 * last section reads `app/locales/taiga/locale-en.json` itself. That is a
 * synchronous local file read, not I/O against a service, so section 1 still
 * holds.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 4. CONVENTIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Doubles are `jest.fn()`, held in one module-level {@link mocks} registry and
 * re-armed before every case. `jest.config.js` sets `clearMocks` and
 * `restoreMocks`, so this file calls neither of the corresponding global
 * helpers. There is no snapshot anywhere: a snapshot would record the markup
 * without asserting anything about it, and the whole point here is that specific
 * named classes appear in a specific order. Elements are located by CLASS rather
 * than by role, because — the toggle aside — that is what they carry.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import { SummaryBar } from './SummaryBar';
import type { SummaryBarProps } from './SummaryBar';
import type { ProjectStats } from './state/types';

/* ==========================================================================
 * TRANSLATION FIXTURE
 * ========================================================================== */

/**
 * The AngularJS name the translator hook resolves for its language-change
 * listener.
 *
 * Restated here because {@link mockInjector} cannot express it: that helper's map
 * is `Partial<AngularServices>`, and the root scope is DELIBERATELY absent from
 * the bridge's allow-list (`app/react/bridge/useAngularService.ts:614`-`:687`)
 * so that React can reach the listener registrar and nothing else. The same
 * composition appears in `app/react/shared/Svg.test.tsx:160`-`:183`.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

/**
 * The eight catalogue entries this band and its imported progress bar look up,
 * spelled EXACTLY as the shipped English catalogue spells them.
 *
 * Verbatim values matter here rather than being a nicety: the four statistic
 * labels carry an embedded line break element, and rendering that correctly is
 * the single most intricate thing the component does. A fixture of plain words
 * would exercise none of it. Sourced from
 * `app/locales/taiga/locale-en.json:1426`-`:1428` (the progress bar's three
 * tooltips), `:1468` (the toggle's misspelled title key) and `:1472`-`:1475`
 * (the four labels), and asserted against the real file by the last section.
 *
 * ⚠ `BACKLOG.CLOSED_POINTS` and `BACKLOG.SUMMARY.CLOSED_POINTS` are TWO
 * DIFFERENT ENTRIES with different values — `closed` for the progress bar's
 * tooltip, `closed<br />points` for the statistic label. Collapsing them would
 * quietly break one of the two.
 */
const LOCALE: Readonly<Record<string, string>> = Object.freeze({
    'BACKLOG.SUMMARY.PROJECT_POINTS': 'project<br />points',
    'BACKLOG.SUMMARY.DEFINED_POINTS': 'defined<br />points',
    'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed<br />points',
    'BACKLOG.SUMMARY.POINTS_PER_SPRINT': 'points /<br />sprint',
    'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH': 'Show/Hide burndown graph',
    'BACKLOG.EXCESS_OF_POINTS': 'Excess of points',
    'BACKLOG.PENDING_POINTS': 'Pending Points',
    'BACKLOG.CLOSED_POINTS': 'closed',
});

/**
 * The toggle's title key, held as a constant so the transposed spelling is
 * written once and cannot be silently "corrected" by a later edit.
 *
 * ⛔ THE MISSPELLING IS REAL. The catalogue spells it `BAKLOG`, under the sprint
 * summary section rather than the summary section
 * (`app/locales/taiga/locale-en.json:1468`).
 */
const TOGGLE_TITLE_KEY = 'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH';

const TOGGLE_TITLE = 'Show/Hide burndown graph';

/** The four statistic label keys, in the order the band emits them. */
const LABEL_KEYS: readonly string[] = Object.freeze([
    'BACKLOG.SUMMARY.PROJECT_POINTS',
    'BACKLOG.SUMMARY.DEFINED_POINTS',
    'BACKLOG.SUMMARY.CLOSED_POINTS',
    'BACKLOG.SUMMARY.POINTS_PER_SPRINT',
]);

/* ==========================================================================
 * STATISTICS FIXTURES
 * ========================================================================== */

/**
 * The statistics visible in the design frame.
 *
 * Twenty-one closed points of three hundred and ninety-two rounds to the five
 * percent the frame shows, so this fixture reproduces the exact figures the band
 * was measured against rather than round numbers that would prove less.
 *
 * `milestones` is present and empty: the payload's type requires it, and this
 * band never reads it — the burndown chart does.
 */
const FRAME_STATS: ProjectStats = Object.freeze({
    assigned_points: 100,
    closed_points: 21,
    completedPercentage: 5,
    defined_points: 392.5,
    milestones: [],
    speed: 0,
    total_milestones: 3,
    total_points: 392,
});

/**
 * The frame statistics with one member GENUINELY ABSENT, which is what a
 * truncated payload looks like at run time.
 *
 * ⭐ WHY NOT JUST WRITE `undefined` IN A LITERAL. The payload's type declares
 * `defined_points` as a required number and `total_points` as a nullable one, so
 * neither can be spelled `undefined` in a type-checked object literal — and this
 * file admits NO escape hatch to get around that. Deleting the own property from
 * a spread copy produces the run-time shape honestly, keeps the declared type
 * intact, and needs no type assertion at all.
 *
 * This matters because the server really can omit a member, and the component's
 * formatter has a dedicated branch for it that a `null` does not reach in the
 * same way.
 *
 * @param member - the statistic to remove.
 * @returns a payload that is missing `member` entirely.
 */
function statsWithout(member: keyof ProjectStats): ProjectStats {
    const truncated: ProjectStats = { ...FRAME_STATS };

    Reflect.deleteProperty(truncated, member);

    return truncated;
}

/* ==========================================================================
 * DOUBLES
 * ========================================================================== */

/** The translation service's `instant` signature, so the double cannot drift. */
type InstantMock = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

/** The root scope's `$on` signature, reduced to what the bridge may touch. */
type RootScopeOnMock = jest.Mock<
    () => void,
    [string, (event: unknown, payload?: unknown) => void]
>;

type ToggleMock = jest.Mock<void, []>;

function createInstantMock(table: Readonly<Record<string, string>>): InstantMock {
    // Unresolved keys fall back to the key itself, which is exactly what
    // `$translate.instant` returns for a key it cannot resolve.
    return jest.fn((translationId: string): string => table[translationId] ?? translationId);
}

/**
 * `$rootScope`, reduced to the one member the bridge is permitted to use.
 *
 * The translator hook subscribes to `$translateChangeEnd` on mount and expects
 * `$on` to hand back a deregistration function. Nothing in this file ever raises
 * a language change — live switching is covered where it belongs, in
 * `app/react/bridge/useTranslate.test.tsx`. Supplying the registrar keeps the
 * hook on its normal path, so it logs no warning and enters no degraded branch
 * that would then have to be silenced here.
 */
function createRootScopeOnMock(): RootScopeOnMock {
    return jest.fn<() => void, [string, (event: unknown, payload?: unknown) => void]>(
        (): (() => void) => (): void => undefined,
    );
}

interface SuiteMocks {
    /** The translation service's `instant`, so its CALL ARGUMENTS are assertable. */
    instant: InstantMock;

    /** The root scope's listener registrar. */
    rootScopeOn: RootScopeOnMock;

    /** The band's only callback. */
    onToggleBurndown: ToggleMock;
}

/**
 * The suite's doubles, in one place.
 *
 * Re-armed by the hook below before every case, so no case can observe a call
 * another case made. `jest.config.js` already clears call history through
 * `clearMocks`; re-arming additionally guarantees a fresh IMPLEMENTATION for the
 * cases that swap the translation table.
 */
const mocks: SuiteMocks = {
    instant: createInstantMock(LOCALE),
    rootScopeOn: createRootScopeOnMock(),
    onToggleBurndown: jest.fn<void, []>(),
};

beforeEach((): void => {
    mocks.instant = createInstantMock(LOCALE);
    mocks.rootScopeOn = createRootScopeOnMock();
    mocks.onToggleBurndown = jest.fn<void, []>();
});

/**
 * A translation service double satisfying the WHOLE contract the bridge declares
 * (`app/react/bridge/useAngularService.ts:545`-`:551`), so the mock is never a
 * narrower object than the service the hook actually resolves.
 */
function createTranslateDouble(instant: InstantMock): MockServiceMap['$translate'] {
    return {
        instant,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({}),
    };
}

/**
 * Composes the injector the translator hook needs.
 *
 * The sanctioned half goes through {@link mockInjector} itself, so `$translate`
 * is resolved exactly as production resolves it AND an unexpected service name
 * still raises that helper's own descriptive diagnostic instead of yielding a
 * silent `undefined`. That is the point of routing through it rather than
 * hand-rolling the whole injector: if a future edit reached for a repository, an
 * events service or a storage service from inside this component — forbidden by
 * rule T5 and requirement I9 — every case below would fail loudly.
 *
 * The unsanctioned half is one name, {@link ROOT_SCOPE_SERVICE_NAME}, which the
 * typed map cannot carry by design.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>>,
): AngularInjector {
    const sanctioned = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            if (extended.has(name)) {
                return extended.get(name) as T;
            }

            return sanctioned.get<T>(name);
        },
    };
}

/** The provider wrapper every case renders through. */
function bridge(): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: createTranslateDouble(mocks.instant) },
            { [ROOT_SCOPE_SERVICE_NAME]: { $on: mocks.rootScopeOn } },
        ),
    );
}

/* ==========================================================================
 * MOUNTING
 * ========================================================================== */

interface Mounted {
    readonly container: HTMLElement;
}

/**
 * Renders the band under the bridge provider.
 *
 * @param overrides - props to replace on top of the frame defaults.
 * @param table - a translation table to swap in, for the cases that probe how a
 *                catalogue value is rendered. Re-arms {@link mocks.instant}
 *                before the provider captures it.
 */
function mount(
    overrides: Partial<SummaryBarProps> = {},
    table: Readonly<Record<string, string>> = LOCALE,
): Mounted {
    if (table !== LOCALE) {
        mocks.instant = createInstantMock(table);
    }

    const props: SummaryBarProps = {
        stats: FRAME_STATS,
        showGraphPlaceholder: false,
        isBurndownGraphCollapsed: false,
        onToggleBurndown: mocks.onToggleBurndown,
        ...overrides,
    };

    const { container } = render(<SummaryBar {...props} />, { wrapper: bridge() });

    return { container };
}

/** The same table with one entry replaced, for the label-rendering cases. */
function localeWith(key: string, value: string): Readonly<Record<string, string>> {
    return Object.freeze({ ...LOCALE, [key]: value });
}

/* ==========================================================================
 * QUERY HELPERS
 * ========================================================================== */

/**
 * Locates a required element, throwing a NAMED failure when it is absent.
 *
 * Throwing rather than returning a nullable value keeps every case below free of
 * optional chaining on values whose absence is itself a defect, so a missing
 * element fails with the selector in the message instead of with a property
 * access on nothing.
 */
function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`Expected the band to render "${selector}".`);
    }

    return element;
}

function band(container: HTMLElement): HTMLElement {
    return mustFind(container, '.summary');
}

/** The band's direct children's class attributes, in document order. */
function childClassNames(container: HTMLElement): (string | null)[] {
    return Array.from(band(container).children).map((child): string | null =>
        child.getAttribute('class'),
    );
}

function statBlocks(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.summary-stats'));
}

function statNumerals(container: HTMLElement): string[] {
    return statBlocks(container).map(
        (block): string => mustFind(block, '.number').textContent ?? '',
    );
}

function statDescriptions(container: HTMLElement): HTMLElement[] {
    return statBlocks(container).map((block): HTMLElement => mustFind(block, '.description'));
}

function percentage(container: HTMLElement): string {
    return mustFind(container, '.data .number').textContent ?? '';
}

/**
 * The toggle, located by its BEHAVIOUR-HOOK class rather than by `.stats`.
 *
 * The end-to-end layer and the retired AngularJS directive both selected on this
 * exact class, so asserting its presence and absence through it is asserting the
 * contract those consumers rely on.
 */
const TOGGLE_SELECTOR = '.stats.js-toggle-burndown-visibility-button';

function findToggle(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>(TOGGLE_SELECTOR);
}

function requiredToggle(container: HTMLElement): HTMLElement {
    return mustFind(container, TOGGLE_SELECTOR);
}

function toggleClass(container: HTMLElement): string {
    return requiredToggle(container).getAttribute('class') ?? '';
}

/* ==========================================================================
 * CASES
 * ========================================================================== */

describe('SummaryBar', () => {
    /* ----------------------------------------------------------------------
     * The contract with the reused stylesheet (rule T1)
     * -------------------------------------------------------------------- */
    describe('structure and class contract (T1)', () => {
        it('names the root element exactly "summary" and nothing more', () => {
            const { container } = mount();
            const root = band(container);

            // STRING EQUALITY, deliberately. `toContain` would pass with a stray
            // extra class, and the stylesheet's rules are written against the
            // bare name (`app/styles/components/summary.scss:3`).
            expect(root.className).toBe('summary');
            expect(root.getAttribute('class')).toBe('summary');
            expect(root.tagName).toBe('DIV');
        });

        it('emits its seven direct children in the source markup\'s order', () => {
            // The order is `app/partials/includes/components/summary.jade:9`-`:32`
            // read top to bottom, and it is load-bearing: the stylesheet pushes
            // the toggle to the far end with `margin-left: auto` rather than with
            // a spacer, so the toggle has to be LAST for the band to lay out.
            expect(childClassNames(mount().container)).toEqual([
                'summary-progress-bar',
                'data',
                'summary-stats',
                'summary-stats',
                'summary-stats',
                'summary-stats',
                'stats js-toggle-burndown-visibility-button active',
            ]);
        });

        it('hosts the progress bar in exactly one element, which owns the class', () => {
            const { container } = mount();

            // Once, not once per statistic: the host carries the stylesheet's
            // width, padding and background, and a second one would paint a
            // second track (`app/styles/components/summary.scss:94`-`:101`).
            expect(container.querySelectorAll('.summary-progress-bar')).toHaveLength(1);

            const host = mustFind(container, '.summary-progress-bar');

            expect(host.tagName).toBe('DIV');
            expect(
                Array.from(host.children).map((child): string | null =>
                    child.getAttribute('class'),
                ),
            ).toEqual(['defined-points', 'project-points-progress', 'closed-points-progress']);
        });

        it('renders exactly four statistic blocks, not three and not five', () => {
            expect(statBlocks(mount().container)).toHaveLength(4);
        });

        it('gives every statistic block one span.number followed by one span.description', () => {
            const blocks = statBlocks(mount().container);

            expect(blocks).toHaveLength(4);

            for (const block of blocks) {
                const children = Array.from(block.children);

                expect(children).toHaveLength(2);
                expect(children[0]?.tagName).toBe('SPAN');
                expect(children[0]?.getAttribute('class')).toBe('number');
                expect(children[1]?.tagName).toBe('SPAN');
                expect(children[1]?.getAttribute('class')).toBe('description');

                // One of each, so a duplicate cannot hide behind the pair above.
                expect(block.querySelectorAll('span.number')).toHaveLength(1);
                expect(block.querySelectorAll('span.description')).toHaveLength(1);
            }
        });

        it('never emits the two hyphen placeholder the source markup carried', () => {
            const { container } = mount();

            // `ng-bind` overwrote the static ` --` in `summary.jade:L15/18/21/24`;
            // React must not emit it. It was never visible to a user, so emitting
            // it would be a NEW artefact rather than preserved behaviour.
            expect(container.textContent ?? '').not.toContain('--');

            for (const numeral of statNumerals(container)) {
                expect(numeral).not.toContain('-');
            }
        });

        it('adds no element the source markup does not have', () => {
            const { container } = mount();

            expect(container.querySelectorAll('hr')).toHaveLength(0);
            expect(container.querySelectorAll('button')).toHaveLength(0);
            expect(container.querySelectorAll('a')).toHaveLength(0);
            expect(container.querySelectorAll('img')).toHaveLength(0);
            expect(container.querySelectorAll('input')).toHaveLength(0);
        });

        it('emits no inline style of its own on the elements it owns', () => {
            const { container } = mount();

            // The three overlaid progress segments DO carry a width, which is
            // data rather than design; nothing else may carry style at all,
            // because the stylesheet is reused unedited.
            expect(band(container).getAttribute('style')).toBeNull();
            expect(mustFind(container, '.data').getAttribute('style')).toBeNull();
            expect(mustFind(container, '.summary-progress-bar').getAttribute('style')).toBeNull();
            expect(requiredToggle(container).getAttribute('style')).toBeNull();

            for (const block of statBlocks(container)) {
                expect(block.getAttribute('style')).toBeNull();
            }
        });

        it('survives the double render StrictMode performs', () => {
            const { container } = render(
                <StrictMode>
                    <SummaryBar
                        stats={FRAME_STATS}
                        showGraphPlaceholder={false}
                        isBurndownGraphCollapsed={false}
                        onToggleBurndown={mocks.onToggleBurndown}
                    />
                </StrictMode>,
                { wrapper: bridge() },
            );

            expect(childClassNames(container)).toHaveLength(7);
            expect(statBlocks(container)).toHaveLength(4);
            expect(percentage(container)).toBe('5%');
            expect(mocks.onToggleBurndown).not.toHaveBeenCalled();
        });
    });

    /* ----------------------------------------------------------------------
     * The two AngularJS numeral filters, reproduced
     * -------------------------------------------------------------------- */
    describe('numbers', () => {
        it('prints the four frame figures exactly as the frame shows them', () => {
            // `392` from the plain filter (`summary.jade:15`), `392.5` from the
            // same filter keeping its fraction (`:18`), `21` (`:21`), and `0`
            // from `speed` through the `:0` form (`:24`).
            expect(statNumerals(mount().container)).toEqual(['392', '392.5', '21', '0']);
        });

        it('keeps up to three fraction digits and groups, on the unargumented filter', () => {
            const { container } = mount({
                stats: { ...FRAME_STATS, defined_points: 1234.56789 },
            });

            expect(statNumerals(container)[1]).toBe('1,234.568');
        });

        it('keeps a short fraction whole rather than padding it', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, defined_points: 0.12345 } });

            expect(statNumerals(container)[1]).toBe('0.123');
        });

        it('rounds the sprint velocity to a whole number, as its filter argument did', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, speed: 2.6 } });

            expect(statNumerals(container)[3]).toBe('3');
        });

        it('rounds the sprint velocity down as well as up', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, speed: 2.4 } });

            expect(statNumerals(container)[3]).toBe('2');
        });

        it('prints an empty string for a member the payload omits entirely', () => {
            const { container } = mount({ stats: statsWithout('defined_points') });

            // NEVER the text `NaN`, and NEVER a fabricated `0`: a zero is a figure
            // the server sent, and printing one for a member it did not send would
            // assert something untrue about the project.
            expect(statNumerals(container)[1]).toBe('');
            expect(container.textContent ?? '').not.toContain('NaN');
            expect(container.textContent ?? '').not.toContain('undefined');
        });

        it('prints an empty string for a non finite figure', () => {
            const { container } = mount({
                stats: {
                    ...FRAME_STATS,
                    closed_points: Number.NaN,
                    defined_points: Number.POSITIVE_INFINITY,
                },
            });
            const numerals = statNumerals(container);

            expect(numerals[1]).toBe('');
            expect(numerals[2]).toBe('');
            expect(container.textContent ?? '').not.toContain('NaN');
            expect(container.textContent ?? '').not.toContain('Infinity');
            expect(container.textContent ?? '').not.toContain('∞');
        });

        it('prints a zero the server did send, because zero is finite', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, closed_points: 0 } });

            expect(statNumerals(container)[2]).toBe('0');
        });
    });

    /* ----------------------------------------------------------------------
     * The leading teal figure, which is a CONCATENATION rather than a format
     * -------------------------------------------------------------------- */
    describe('completedPercentage concatenation (preserved AngularJS `+` semantics)', () => {
        it('prints the client computed field followed by a percent sign', () => {
            expect(percentage(mount().container)).toBe('5%');
        });

        it('prints a zero it was given rather than dropping it', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, completedPercentage: 0 } });

            expect(percentage(container)).toBe('0%');
        });

        it('prints a LONE percent sign when the payload is absent', () => {
            // ⭐ `summary.jade:12` bound `stats.completedPercentage + '%'`, and
            // AngularJS's addition contributed NOTHING for an absent operand
            // rather than the text `undefined`. Preserved per T10; do NOT render
            // `0%` — that would claim a measured zero the server never sent.
            expect(percentage(mount({ stats: null }).container)).toBe('%');
            expect(percentage(mount({ stats: undefined }).container)).toBe('%');
        });

        it('renders no numerals and no progress bar at all when the payload is absent', () => {
            const { container } = mount({ stats: null });

            // THREE numerals, not four: the same absent payload also closes the
            // first block's truthiness gate (`summary.jade:14`), so the band
            // renders the three ungated blocks and each of them is empty.
            expect(statNumerals(container)).toEqual(['', '', '']);

            // The imported progress bar renders NOTHING without a payload rather
            // than an empty track, so its three segments are absent outright.
            expect(container.querySelector('.project-points-progress')).toBeNull();
            expect(container.querySelector('.defined-points')).toBeNull();
            expect(container.querySelector('.closed-points-progress')).toBeNull();
            expect(mustFind(container, '.summary-progress-bar').children).toHaveLength(0);
        });

        it('never leaks a nothing value into the rendered text', () => {
            const { container } = mount({ stats: null });

            expect(container.textContent ?? '').not.toContain('undefined');
            expect(container.textContent ?? '').not.toContain('null');
            expect(container.textContent ?? '').not.toContain('NaN');
        });

        it('still renders the band, the percentage host and the toggle without a payload', () => {
            const { container } = mount({ stats: null });

            expect(band(container).className).toBe('summary');
            expect(percentage(container)).toBe('%');
            expect(statBlocks(container)).toHaveLength(3);
            expect(findToggle(container)).not.toBeNull();
        });
    });


    /* ----------------------------------------------------------------------
     * The first block's gate
     * -------------------------------------------------------------------- */
    describe('first block truthiness gate (summary.jade:L14)', () => {
        it('renders the project points block when the total is a positive number', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: 392 } });

            expect(statBlocks(container)).toHaveLength(4);
            expect(statNumerals(container)[0]).toBe('392');
            expect(statDescriptions(container)[0]?.textContent).toBe('projectpoints');
        });

        it('hides the project points block when the total is ZERO', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: 0 } });

            // `ng-if` is truthiness, not nullishness. A project whose total is a
            // measured zero hid this block exactly as an absent total did, so the
            // remaining three shift up and the DEFINED points lead the cluster.
            expect(statBlocks(container)).toHaveLength(3);
            expect(statNumerals(container)).toEqual(['392.5', '21', '0']);
            expect(statDescriptions(container)[0]?.textContent).toBe('definedpoints');
        });

        it('hides the project points block when the total is null', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: null } });

            expect(statBlocks(container)).toHaveLength(3);
            expect(statNumerals(container)[0]).toBe('392.5');
        });

        it('hides the project points block when the payload omits the total entirely', () => {
            const { container } = mount({ stats: statsWithout('total_points') });

            expect(statBlocks(container)).toHaveLength(3);
            expect(statNumerals(container)[0]).toBe('392.5');
        });

        it('leaves no residue of the hidden block', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: 0 } });

            // Six children rather than seven, and the label is gone from the text
            // as well as the numeral: a gate that hid the numeral but kept the
            // label would read as an unexplained caption.
            expect(childClassNames(container)).toEqual([
                'summary-progress-bar',
                'data',
                'summary-stats',
                'summary-stats',
                'summary-stats',
                'stats js-toggle-burndown-visibility-button active',
            ]);
            expect(container.textContent ?? '').not.toContain('project');
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐⭐ The four labels are not plain text: each embeds a line break element
     * -------------------------------------------------------------------- */
    describe('<br /> inside BACKLOG.SUMMARY.* labels', () => {
        it('renders every label as two runs separated by ONE real break element', () => {
            const descriptions = statDescriptions(mount().container);

            expect(descriptions).toHaveLength(4);

            for (const description of descriptions) {
                // A REAL element, not escaped characters. The catalogue values at
                // `app/locales/taiga/locale-en.json:1472`-`:1475` embed the break
                // because four numeral-and-label pairs only fit inside a band
                // barely taller than one numeral when each label is two lines.
                expect(description.querySelectorAll('br')).toHaveLength(1);
                expect(description.textContent ?? '').not.toContain('<br');
                expect(description.textContent ?? '').not.toContain('/>');
            }
        });

        it('joins the two runs of each label with nothing between them', () => {
            const descriptions = statDescriptions(mount().container);

            // `'project<br />points'` renders as the text `projectpoints` with a
            // break between the runs: the break contributes no character, so the
            // concatenated text carries no space either.
            expect(descriptions[0]?.textContent).toBe('projectpoints');
            expect(descriptions[1]?.textContent).toBe('definedpoints');
            expect(descriptions[2]?.textContent).toBe('closedpoints');
            expect(descriptions[3]?.textContent).toBe('points /sprint');
        });

        it('places the break between the two runs rather than around them', () => {
            const descriptions = statDescriptions(mount().container);
            const first = descriptions[0];

            expect(first?.childNodes).toHaveLength(3);
            expect(first?.childNodes[0]?.textContent).toBe('project');
            expect(first?.childNodes[1]?.nodeName).toBe('BR');
            expect(first?.childNodes[2]?.textContent).toBe('points');

            // The fourth label breaks after its solidus, as the design frame shows.
            expect(descriptions[3]?.childNodes[0]?.textContent).toBe('points /');
            expect(descriptions[3]?.childNodes[2]?.textContent).toBe('sprint');
        });

        it('emits the break as markup and never as an escaped entity', () => {
            const { container } = mount();

            expect(container.innerHTML).toContain('<br>');

            // ⭐ The negative half, and the one that actually proves the node array
            // substitution worked: an implementation that printed the catalogue
            // value as text would serialise here as `&lt;br /&gt;`.
            expect(container.innerHTML).not.toContain('&lt;br');
            expect(container.innerHTML).not.toContain('&lt;');
        });

        it('accepts the unclosed and upper case spellings of the break', () => {
            // A catalogue is DATA. The shipped English values use one spelling
            // today; a translator supplying another must not silently lose the
            // break and collapse the label onto one line.
            const { container } = mount({}, {
                ...LOCALE,
                'BACKLOG.SUMMARY.DEFINED_POINTS': 'defined<br>points',
                'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed<BR />points',
            });
            const descriptions = statDescriptions(container);

            expect(descriptions[1]?.querySelectorAll('br')).toHaveLength(1);
            expect(descriptions[1]?.textContent).toBe('definedpoints');
            expect(descriptions[2]?.querySelectorAll('br')).toHaveLength(1);
            expect(descriptions[2]?.textContent).toBe('closedpoints');
        });

        it('renders a label with no break as a single text node', () => {
            const { container } = mount(
                {},
                localeWith('BACKLOG.SUMMARY.PROJECT_POINTS', 'points'),
            );
            const first = statDescriptions(container)[0];

            expect(first?.querySelectorAll('br')).toHaveLength(0);
            expect(first?.childNodes).toHaveLength(1);
            expect(first?.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
            expect(first?.textContent).toBe('points');
        });

        it('renders a label that is nothing but a break as two empty runs', () => {
            const { container } = mount({}, localeWith('BACKLOG.SUMMARY.CLOSED_POINTS', '<br />'));
            const third = statDescriptions(container)[2];

            expect(third?.querySelectorAll('br')).toHaveLength(1);
            expect(third?.textContent).toBe('');
        });

        it('renders a label with two breaks as three runs', () => {
            const { container } = mount(
                {},
                localeWith('BACKLOG.SUMMARY.CLOSED_POINTS', 'a<br />b<br />c'),
            );
            const third = statDescriptions(container)[2];

            expect(third?.querySelectorAll('br')).toHaveLength(2);
            expect(third?.textContent).toBe('abc');
        });

        it('keeps a catalogue value that carries OTHER markup as text', () => {
            const { container } = mount(
                {},
                localeWith(
                    'BACKLOG.SUMMARY.CLOSED_POINTS',
                    'evil<img src=x onerror=alert(1)>label',
                ),
            );
            const third = statDescriptions(container)[2];

            // ⛔ Only the break is structurally reproduced; everything else stays
            // TEXT. React's raw-markup injection prop is forbidden by this
            // migration and is deliberately not named anywhere in this file or in
            // the unit under test, so searching either for it finds nothing — which
            // is what makes a translation data forever rather than latent markup.
            expect(container.querySelector('img')).toBeNull();
            expect(container.querySelectorAll('img')).toHaveLength(0);
            expect(third?.textContent).toBe('evil<img src=x onerror=alert(1)>label');
            expect(third?.querySelectorAll('br')).toHaveLength(0);
        });

        it('keeps an element and a closing tag as text too', () => {
            const { container } = mount(
                {},
                localeWith('BACKLOG.SUMMARY.CLOSED_POINTS', 'closed<i>points</i>'),
            );

            expect(container.querySelectorAll('i')).toHaveLength(0);
            expect(statDescriptions(container)[2]?.textContent).toBe('closed<i>points</i>');
        });

        it('looks each label up through the translator, by its catalogue key', () => {
            mount();

            for (const key of LABEL_KEYS) {
                // Two arguments, because the translator hook always forwards its
                // optional interpolation parameters to `$translate.instant`.
                expect(mocks.instant).toHaveBeenCalledWith(key, undefined);
            }
        });

        it('falls back to the key itself for a label the catalogue cannot resolve', () => {
            // What `$translate.instant` itself does for a missing key, so a broken
            // catalogue renders a diagnosable key rather than an empty band.
            const sparse: Readonly<Record<string, string>> = Object.freeze({
                'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH': TOGGLE_TITLE,
            });
            const { container } = mount({}, sparse);

            expect(statDescriptions(container)[0]?.textContent).toBe(
                'BACKLOG.SUMMARY.PROJECT_POINTS',
            );
        });
    });


    /* ----------------------------------------------------------------------
     * The band's only control
     * -------------------------------------------------------------------- */
    describe('burndown toggle button', () => {
        it('renders with both source class names, in order, while the graph is shown', () => {
            const { container } = mount({
                showGraphPlaceholder: false,
                isBurndownGraphCollapsed: false,
            });

            expect(findToggle(container)).not.toBeNull();
            expect(toggleClass(container)).toBe(
                'stats js-toggle-burndown-visibility-button active',
            );
        });

        it('drops the engaged modifier while the graph is collapsed', () => {
            const className = toggleClass(mount({ isBurndownGraphCollapsed: true }).container);

            // `active` marks SHOWN, per `main.coffee:L1169` removing and `L1173`
            // adding it. Deriving it from the collapsed flag directly instead of
            // from its negation is invisible in a screenshot of one state and
            // wrong in both.
            expect(className).toBe('stats js-toggle-burndown-visibility-button');
            expect(className).not.toContain('active');
        });

        it('titles itself from the MISSPELLED catalogue key, verbatim', () => {
            const { container } = mount();

            // ⭐ Key typo verified at `app/locales/taiga/locale-en.json:L1468`;
            // preserved per T10 — "fixing" it yields a missing-translation render,
            // because no correctly spelled key exists to resolve.
            expect(mocks.instant).toHaveBeenCalledWith(TOGGLE_TITLE_KEY, undefined);
            expect(mocks.instant.mock.calls.map(([key]): string => key)).toContain(
                'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH',
            );
            expect(requiredToggle(container).getAttribute('title')).toBe(TOGGLE_TITLE);
        });

        it('never asks the catalogue for the correctly spelled key', () => {
            mount();

            expect(mocks.instant).not.toHaveBeenCalledWith(
                'BACKLOG.SPRINT_SUMMARY.TOGGLE_BACKLOG_GRAPH',
                undefined,
            );
            expect(mocks.instant).not.toHaveBeenCalledWith(
                'BACKLOG.SUMMARY.TOGGLE_BAKLOG_GRAPH',
                undefined,
            );
        });

        it('calls back exactly once per click', () => {
            const { container } = mount();

            fireEvent.click(requiredToggle(container));

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('hands the callback nothing it is entitled to read', () => {
            const { container } = mount();

            fireEvent.click(requiredToggle(container));

            // The prop is declared ZERO-ARITY, so whatever React's handler
            // forwards positionally is unreadable through the declared contract.
            // Asserted rather than assumed because the two activation paths differ
            // in what they forward — the pointer path is bound straight to the
            // prop and therefore carries React's synthetic event, while the
            // keyboard path calls it explicitly with no arguments — and a future
            // edit that started READING an argument would work for one path and
            // silently receive nothing on the other.
            const [pointerCall] = mocks.onToggleBurndown.mock.calls;

            expect(pointerCall).toHaveLength(1);

            fireEvent.keyDown(requiredToggle(container), { key: 'Enter' });

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(2);
            expect(mocks.onToggleBurndown.mock.calls[1]).toHaveLength(0);
        });

        it('calls back once per click and not once per render', () => {
            const { container } = mount();

            expect(mocks.onToggleBurndown).not.toHaveBeenCalled();

            fireEvent.click(requiredToggle(container));
            fireEvent.click(requiredToggle(container));

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(2);
        });

        it('is ABSENT while the screen shows the burndown placeholder', () => {
            const { container } = mount({ showGraphPlaceholder: true });

            expect(container.querySelector('.js-toggle-burndown-visibility-button')).toBeNull();
            expect(findToggle(container)).toBeNull();
            expect(container.querySelector('tg-svg')).toBeNull();
            expect(childClassNames(container)).toHaveLength(6);
        });

        it('IS present while the placeholder flag is still unresolved', () => {
            // ⭐ The negative path most easily got wrong. `ng-if="!showGraphPlaceholder"`
            // is plain falsiness, and the flag starts life as `null`
            // (`main.coffee:L93`), so the control renders during the first paint
            // rather than popping in once the statistics resolve.
            const { container } = mount({ showGraphPlaceholder: null });

            expect(findToggle(container)).not.toBeNull();
            expect(toggleClass(container)).toBe(
                'stats js-toggle-burndown-visibility-button active',
            );
        });

        it('does not depend on the statistics payload', () => {
            const { container } = mount({ stats: null });

            expect(findToggle(container)).not.toBeNull();
            expect(requiredToggle(container).getAttribute('title')).toBe(TOGGLE_TITLE);
        });
    });

    /* ----------------------------------------------------------------------
     * The icon, reused from the inlined sprite (rules T1 and T3)
     * -------------------------------------------------------------------- */
    describe('icon (T1/T3)', () => {
        it('wraps the icon in a tg-svg element inside the toggle', () => {
            const { container } = mount();
            const host = container.querySelector('tg-svg');

            // The wrapper is MANDATORY, not decorative: in-scope stylesheets
            // target `.stats svg` through this element
            // (`app/styles/components/summary.scss:63`-`:71`), and the retired
            // AngularJS renderer emitted the same element
            // (`modules/common.coffee:342`-`:363`).
            //
            // Locators into the retired CoffeeScript tree are written WITHOUT
            // their leading directory throughout this migration, matching
            // `./SummaryBar.tsx`, so that searching for an import out of that
            // tree returns only real imports and never a citation.
            expect(host).not.toBeNull();
            expect(host?.tagName).toBe('TG-SVG');
            expect(requiredToggle(container).contains(host)).toBe(true);
            expect(container.querySelectorAll('tg-svg')).toHaveLength(1);
        });

        it('references the sprite symbol by fragment, adding no asset of its own', () => {
            const { container } = mount();
            const host = mustFind(container, `${TOGGLE_SELECTOR} tg-svg`);
            const svg = host.querySelector('svg');
            const use = host.querySelector('use');

            // `getAttribute` rather than `.className`, because an SVG element's
            // `className` is an animated-string object and never a plain string.
            expect(svg?.getAttribute('class')).toBe('icon icon-graph');

            // `icon-graph` is verified present exactly once in `app/svg/sprite.svg`
            // — T3 holds at zero new assets. Both spellings are emitted so the
            // reference resolves in every browser the incumbent supported.
            expect(use?.getAttribute('href')).toBe('#icon-graph');
            expect(use?.getAttribute('xlink:href')).toBe('#icon-graph');
        });

        it('gives the icon no title, because the toggle already carries one', () => {
            const { container } = mount();

            // A duplicated accessible name would be announced twice. The control's
            // name comes from the title the source markup already carried.
            expect(container.querySelectorAll('tg-svg title')).toHaveLength(0);
        });
    });

    /* ----------------------------------------------------------------------
     * The control is reachable without a pointer
     *
     * Four additions to a container that was previously click-bound by document
     * wide selector. None of them paints a pixel in the resting state the design
     * frame captures, so layout fidelity is untouched.
     * -------------------------------------------------------------------- */
    describe('the toggle is operable without a pointer', () => {
        it('announces itself as a control and takes a tab stop', () => {
            const control = requiredToggle(mount().container);

            expect(control.getAttribute('role')).toBe('button');
            expect(control.getAttribute('tabindex')).toBe('0');
        });

        it('reports the controlled region as revealed while the graph is shown', () => {
            const control = requiredToggle(mount({ isBurndownGraphCollapsed: false }).container);

            expect(control.getAttribute('aria-expanded')).toBe('true');
        });

        it('reports the controlled region as hidden while the graph is collapsed', () => {
            const control = requiredToggle(mount({ isBurndownGraphCollapsed: true }).container);

            expect(control.getAttribute('aria-expanded')).toBe('false');
        });

        it('activates on the enter key', () => {
            const { container } = mount();

            fireEvent.keyDown(requiredToggle(container), { key: 'Enter' });

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('activates on the space key without scrolling the page', () => {
            const { container } = mount();
            const notPrevented = fireEvent.keyDown(requiredToggle(container), { key: ' ' });

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(1);
            // `fireEvent` returns false when a handler prevented the default, which
            // is how the page is kept from scrolling under the activation.
            expect(notPrevented).toBe(false);
        });

        it('also activates on the pre standard name for the space key', () => {
            // React normalises the legacy key name to the modern one before the
            // handler sees it, so an older browser reporting the legacy name still
            // operates the control. Asserted rather than assumed, because the
            // alternative reading is that such a browser cannot use it at all.
            const { container } = mount();

            fireEvent.keyDown(requiredToggle(container), { key: 'Spacebar' });

            expect(mocks.onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('ignores every other key', () => {
            const { container } = mount();
            const control = requiredToggle(container);

            for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', 'PageDown', 'End', 'Shift']) {
                fireEvent.keyDown(control, { key });
            }

            expect(mocks.onToggleBurndown).not.toHaveBeenCalled();
        });
    });

    /* ----------------------------------------------------------------------
     * The bridge seam
     * -------------------------------------------------------------------- */
    describe('the AngularJS seam', () => {
        it('resolves the translator and the listener registrar, and nothing else', () => {
            mount();

            // The injector double THROWS for every other name, so reaching the
            // band at all proves no repository, events, storage or navigation
            // service was resolved (rule T5, requirement I9). Rendering is the
            // assertion; these confirm the sanctioned pair really was used.
            expect(mocks.instant).toHaveBeenCalled();
            expect(mocks.rootScopeOn).toHaveBeenCalledTimes(1);

            const [eventName, listener] = mocks.rootScopeOn.mock.calls[0] ?? [];

            expect(eventName).toBe('$translateChangeEnd');
            expect(typeof listener).toBe('function');
        });

        it('deregisters its language listener when the band unmounts', () => {
            const deregister = jest.fn<void, []>();

            mocks.rootScopeOn = jest.fn<
                () => void,
                [string, (event: unknown, payload?: unknown) => void]
            >((): (() => void) => deregister);

            const { unmount } = render(
                <SummaryBar
                    stats={FRAME_STATS}
                    showGraphPlaceholder={false}
                    isBurndownGraphCollapsed={false}
                    onToggleBurndown={mocks.onToggleBurndown}
                />,
                { wrapper: bridge() },
            );

            expect(deregister).not.toHaveBeenCalled();

            unmount();

            // A leaked root scope listener is SILENT: it surfaces only as duplicate
            // work after navigating away from the backlog and back.
            expect(deregister).toHaveBeenCalledTimes(1);
        });
    });

    /* ----------------------------------------------------------------------
     * The shipped catalogue still justifies two of the decisions above
     * -------------------------------------------------------------------- */
    describe('the shipped locale still justifies two of these decisions', () => {
        interface LocaleShape {
            readonly BACKLOG: {
                readonly SUMMARY: Readonly<Record<string, string>>;
                readonly SPRINT_SUMMARY: Readonly<Record<string, string>>;
                readonly EXCESS_OF_POINTS: string;
                readonly PENDING_POINTS: string;
                readonly CLOSED_POINTS: string;
            };
        }

        function readLocale(): LocaleShape {
            return JSON.parse(readFileSync(LOCALE_FILE, 'utf8')) as LocaleShape;
        }

        it('embeds a line break element in all four statistic labels', () => {
            const { SUMMARY } = readLocale().BACKLOG;

            for (const key of LABEL_KEYS) {
                // The fixture's keys are fully qualified; the catalogue nests them
                // under `BACKLOG.SUMMARY`, so the shared prefix is dropped here.
                expect(SUMMARY[key.replace('BACKLOG.SUMMARY.', '')]).toMatch(/<br\s*\/?>/i);
            }
        });

        it('spells the four labels exactly as this file\'s fixture spells them', () => {
            const { SUMMARY } = readLocale().BACKLOG;

            expect(SUMMARY['PROJECT_POINTS']).toBe(LOCALE['BACKLOG.SUMMARY.PROJECT_POINTS']);
            expect(SUMMARY['DEFINED_POINTS']).toBe(LOCALE['BACKLOG.SUMMARY.DEFINED_POINTS']);
            expect(SUMMARY['CLOSED_POINTS']).toBe(LOCALE['BACKLOG.SUMMARY.CLOSED_POINTS']);
            expect(SUMMARY['POINTS_PER_SPRINT']).toBe(
                LOCALE['BACKLOG.SUMMARY.POINTS_PER_SPRINT'],
            );
        });

        it('still spells the toggle title key exactly as this file spells it', () => {
            const { SUMMARY, SPRINT_SUMMARY } = readLocale().BACKLOG;

            // Both facts are asserted, because "correcting" either one renders the
            // raw key as the control's tooltip: the transposition itself, and the
            // section it lives under.
            expect(Object.keys(SPRINT_SUMMARY)).toContain('TOGGLE_BAKLOG_GRAPH');
            expect(SPRINT_SUMMARY['TOGGLE_BAKLOG_GRAPH']).toBe(TOGGLE_TITLE);
            expect(Object.keys(SPRINT_SUMMARY)).not.toContain('TOGGLE_BACKLOG_GRAPH');
            expect(Object.keys(SUMMARY)).not.toContain('TOGGLE_BAKLOG_GRAPH');
        });

        it('still spells the progress bar\'s three tooltips as this file\'s fixture does', () => {
            const { BACKLOG } = readLocale();

            expect(BACKLOG.EXCESS_OF_POINTS).toBe(LOCALE['BACKLOG.EXCESS_OF_POINTS']);
            expect(BACKLOG.PENDING_POINTS).toBe(LOCALE['BACKLOG.PENDING_POINTS']);
            expect(BACKLOG.CLOSED_POINTS).toBe(LOCALE['BACKLOG.CLOSED_POINTS']);

            // ⚠ And they are NOT the same entries as the statistic labels: the
            // progress bar's `closed` and the label's `closed<br />points` live
            // under different keys and must stay distinguishable.
            expect(BACKLOG.CLOSED_POINTS).not.toBe(BACKLOG.SUMMARY['CLOSED_POINTS']);
        });
    });
});

