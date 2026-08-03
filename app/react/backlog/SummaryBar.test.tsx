/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for the backlog's dark statistics band.
 *
 * Browserless by construction: the unit under test is a pure function of its
 * props apart from one translator lookup, so every case below renders it in
 * jsdom behind a mock injector and asserts on emitted markup rather than on
 * computed style. Nothing here launches a browser, reaches the network or reads
 * build output.
 *
 * Two of the cases read the SHIPPED LOCALE FILE rather than a fixture, because
 * two of this component's decisions are only correct as long as the locale still
 * says what it said when they were made: the four statistic labels embed a line
 * break element, and the toggle's title key is misspelled. A fixture cannot
 * catch the locale drifting; reading the real file can.
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
 * FIXTURES
 * ========================================================================== */

const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

/**
 * The four label values, spelled exactly as the shipped English locale spells
 * them, line break element included. Reproduced here so the rendering cases do
 * not depend on file input and output, and asserted against the real file by the
 * locale cases below.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
    'BACKLOG.SUMMARY.PROJECT_POINTS': 'project<br />points',
    'BACKLOG.SUMMARY.DEFINED_POINTS': 'defined<br />points',
    'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed<br />points',
    'BACKLOG.SUMMARY.POINTS_PER_SPRINT': 'points /<br />sprint',
    'BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH': 'Show/Hide burndown graph',
    // Consumed by the imported progress bar for its three tooltips.
    'BACKLOG.EXCESS_OF_POINTS': 'Excess of points',
    'BACKLOG.PENDING_POINTS': 'Pending points',
    'BACKLOG.CLOSED_POINTS': 'Closed points',
};

/**
 * The statistics visible in the design frame. Twenty one closed of three hundred
 * and ninety two rounds to the five percent the frame shows, so this fixture
 * reproduces the exact figures the band was measured with.
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

function createTranslateDouble(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): MockServiceMap['$translate'] {
    return {
        // Unresolved keys fall back to the key itself, which is what
        // `$translate.instant` does.
        instant: (translationId: string): string => table[translationId] ?? translationId,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...table }),
    };
}

function createRootScopeDouble(): Readonly<Record<string, unknown>> {
    return {
        $on: (): (() => void) => (): void => undefined,
    };
}

/**
 * Composes the injector the translator hook needs.
 *
 * The sanctioned service map covers the translation service; the language event
 * host is not a member of that map and is supplied as an extension, which is the
 * same composition the bridge's own specification uses.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>> = {},
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

function bridge(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: createTranslateDouble(table) },
            { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
        ),
    );
}

const BASE_PROPS: SummaryBarProps = {
    stats: FRAME_STATS,
    showGraphPlaceholder: false,
    isBurndownGraphCollapsed: false,
    onToggleBurndown: (): void => undefined,
};

interface Mounted {
    readonly container: HTMLElement;
}

function mount(
    overrides: Partial<SummaryBarProps> = {},
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): Mounted {
    const { container } = render(<SummaryBar {...BASE_PROPS} {...overrides} />, {
        wrapper: bridge(table),
    });

    return { container };
}

/* ==========================================================================
 * QUERY HELPERS
 * ========================================================================== */

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

function toggle(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>('.stats');
}

function requiredToggle(container: HTMLElement): HTMLElement {
    return mustFind(container, '.stats');
}

function toggleClass(container: HTMLElement): string {
    return requiredToggle(container).getAttribute('class') ?? '';
}

/* ==========================================================================
 * CASES
 * ========================================================================== */

describe('SummaryBar', () => {
    describe('structure', () => {
        it('renders the band with its seven direct children in source order', () => {
            const { container } = mount();
            const children = Array.from(band(container).children);

            expect(children).toHaveLength(7);
            expect(children[0]?.getAttribute('class')).toBe('summary-progress-bar');
            expect(children[1]?.getAttribute('class')).toBe('data');
            expect(children[2]?.getAttribute('class')).toBe('summary-stats');
            expect(children[3]?.getAttribute('class')).toBe('summary-stats');
            expect(children[4]?.getAttribute('class')).toBe('summary-stats');
            expect(children[5]?.getAttribute('class')).toBe('summary-stats');
            expect(children[6]?.getAttribute('class')).toBe(
                'stats js-toggle-burndown-visibility-button active',
            );
        });

        it('renders exactly four statistic blocks, not five', () => {
            expect(statBlocks(mount().container)).toHaveLength(4);
        });

        it('hosts the progress bar inside its own element, which owns the class', () => {
            const { container } = mount();
            const host = mustFind(container, '.summary-progress-bar');

            expect(host.tagName).toBe('DIV');
            expect(Array.from(host.children).map((child): string | null =>
                child.getAttribute('class'),
            )).toEqual([
                'defined-points',
                'project-points-progress',
                'closed-points-progress',
            ]);
        });

        it('adds no element the source markup does not have', () => {
            const { container } = mount();

            expect(container.querySelectorAll('hr')).toHaveLength(0);
            expect(container.querySelectorAll('button')).toHaveLength(0);
            expect(container.querySelectorAll('a')).toHaveLength(0);
            expect(container.querySelectorAll('img')).toHaveLength(0);
            expect(container.querySelectorAll('input')).toHaveLength(0);
        });

        it('emits no inline style and no stylesheet class of its own invention', () => {
            const { container } = mount();

            expect(band(container).getAttribute('style')).toBeNull();
            expect(mustFind(container, '.data').getAttribute('style')).toBeNull();
            expect(requiredToggle(container).getAttribute('style')).toBeNull();
        });

        it('survives a double render under StrictMode', () => {
            const { container } = render(
                <StrictMode>
                    <SummaryBar {...BASE_PROPS} />
                </StrictMode>,
                { wrapper: bridge() },
            );

            expect(statBlocks(container)).toHaveLength(4);
            expect(percentage(container)).toBe('5%');
        });
    });

    describe('the completion percentage', () => {
        it('prints the client computed field followed by a percent sign', () => {
            expect(percentage(mount().container)).toBe('5%');
        });

        it('prints a lone percent sign when the statistics are absent', () => {
            expect(percentage(mount({ stats: null }).container)).toBe('%');
            expect(percentage(mount({ stats: undefined }).container)).toBe('%');
        });

        it('prints a zero it was given rather than dropping it', () => {
            const { container } = mount({
                stats: { ...FRAME_STATS, completedPercentage: 0 },
            });

            expect(percentage(container)).toBe('0%');
        });

        it('never prints the word undefined', () => {
            const { container } = mount({ stats: null });

            expect(container.textContent).not.toContain('undefined');
            expect(container.textContent).not.toContain('null');
        });
    });

    describe('numeral formatting', () => {
        it('prints the four frame figures exactly as the frame shows them', () => {
            expect(statNumerals(mount().container)).toEqual(['392', '392.5', '21', '0']);
        });

        it('rounds the sprint velocity to a whole number, as its filter argument did', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, speed: 2.6 } });

            expect(statNumerals(container)[3]).toBe('3');
        });

        it('keeps up to three fraction digits on the unargumented bindings', () => {
            const { container } = mount({
                stats: { ...FRAME_STATS, defined_points: 0.12345 },
            });

            expect(statNumerals(container)[1]).toBe('0.123');
        });

        it('groups large figures through the platform formatter', () => {
            const { container } = mount({
                stats: { ...FRAME_STATS, defined_points: 1234.5 },
            });

            // Compared against the same formatter rather than a hardcoded
            // string, so the case does not depend on the runtime locale.
            expect(statNumerals(container)[1]).toBe(
                new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(1234.5),
            );
        });

        it('prints nothing at all for a non finite figure', () => {
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
            expect(container.textContent).not.toContain('NaN');
            expect(container.textContent).not.toContain('Infinity');
        });

        it('prints nothing for every figure when the statistics are absent', () => {
            expect(statNumerals(mount({ stats: null }).container)).toEqual(['', '', '']);
        });

        it('never emits the placeholder text the source markup carried', () => {
            const { container } = mount();

            expect(container.textContent).not.toContain('-');
        });
    });

    describe('the project points block', () => {
        it('renders when the project total is a positive number', () => {
            expect(statNumerals(mount().container)).toHaveLength(4);
        });

        it('is hidden when the project total is zero, because the gate is truthiness', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: 0 } });

            expect(statBlocks(container)).toHaveLength(3);
            expect(statNumerals(container)).toEqual(['392.5', '21', '0']);
        });

        it('is hidden when the project total is absent', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: null } });

            expect(statBlocks(container)).toHaveLength(3);
        });

        it('renders no numeric residue when hidden', () => {
            const { container } = mount({ stats: { ...FRAME_STATS, total_points: 0 } });

            expect(band(container).children).toHaveLength(6);
            expect(container.textContent).not.toContain('project');
        });
    });

    describe('labels that embed a line break element', () => {
        it('renders each label as two lines separated by a real break element', () => {
            const descriptions = statDescriptions(mount().container);

            expect(descriptions).toHaveLength(4);

            for (const description of descriptions) {
                expect(description.querySelectorAll('br')).toHaveLength(1);
            }
        });

        it('renders the break as markup, never as visible characters', () => {
            const { container } = mount();

            expect(container.innerHTML).toContain('<br>');
            expect(container.textContent).not.toContain('<br');
            expect(container.textContent).not.toContain('/>');
        });

        it('splits the fourth label after its solidus, as the frame shows', () => {
            const fourth = statDescriptions(mount().container)[3];

            expect(fourth?.childNodes[0]?.textContent).toBe('points /');
            expect(fourth?.childNodes[2]?.textContent).toBe('sprint');
        });

        it('splits the first three labels between their two words', () => {
            const descriptions = statDescriptions(mount().container);

            expect(descriptions[0]?.childNodes[0]?.textContent).toBe('project');
            expect(descriptions[0]?.childNodes[2]?.textContent).toBe('points');
            expect(descriptions[1]?.childNodes[0]?.textContent).toBe('defined');
            expect(descriptions[2]?.childNodes[0]?.textContent).toBe('closed');
        });

        it('renders a label with no break as a single text run', () => {
            const { container } = mount(
                {},
                { ...TRANSLATIONS, 'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed points' },
            );
            const third = statDescriptions(container)[2];

            expect(third?.querySelectorAll('br')).toHaveLength(0);
            expect(third?.textContent).toBe('closed points');
        });

        it('accepts the unclosed and upper case spellings of the break', () => {
            const { container } = mount({}, {
                ...TRANSLATIONS,
                'BACKLOG.SUMMARY.DEFINED_POINTS': 'defined<br>points',
                'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed<BR />points',
            });
            const descriptions = statDescriptions(container);

            expect(descriptions[1]?.querySelectorAll('br')).toHaveLength(1);
            expect(descriptions[2]?.querySelectorAll('br')).toHaveLength(1);
        });

        it('escapes a translation that contains other markup instead of injecting it', () => {
            const { container } = mount(
                {},
                { ...TRANSLATIONS, 'BACKLOG.SUMMARY.CLOSED_POINTS': 'closed<i>points</i>' },
            );

            expect(container.querySelectorAll('i')).toHaveLength(0);
            expect(statDescriptions(container)[2]?.textContent).toBe('closed<i>points</i>');
        });
    });

    describe('the burndown toggle', () => {
        it('keeps both source class names, in source order', () => {
            expect(toggleClass(mount().container)).toBe(
                'stats js-toggle-burndown-visibility-button active',
            );
        });

        it('carries the engaged modifier while the graph is shown', () => {
            expect(toggleClass(mount({ isBurndownGraphCollapsed: false }).container)).toContain(
                'active',
            );
        });

        it('drops the engaged modifier while the graph is collapsed', () => {
            const className = toggleClass(mount({ isBurndownGraphCollapsed: true }).container);

            expect(className).toBe('stats js-toggle-burndown-visibility-button');
            expect(className).not.toContain('active');
        });

        it('titles itself from the misspelled locale key, verbatim', () => {
            expect(requiredToggle(mount().container).getAttribute('title')).toBe(
                'Show/Hide burndown graph',
            );
        });

        it('renders the sprite icon inside the element the stylesheets select on', () => {
            const { container } = mount();
            const host = mustFind(container, '.stats tg-svg');
            const svg = host.querySelector('svg');
            const use = host.querySelector('use');

            expect(host.tagName).toBe('TG-SVG');
            expect(svg?.getAttribute('class')).toBe('icon icon-graph');
            expect(use?.getAttribute('href')).toBe('#icon-graph');
            expect(use?.getAttribute('xlink:href')).toBe('#icon-graph');
        });

        it('is suppressed while the screen shows the burndown placeholder', () => {
            const { container } = mount({ showGraphPlaceholder: true });

            expect(toggle(container)).toBeNull();
            expect(band(container).children).toHaveLength(6);
        });

        it('renders while the placeholder flag is still unresolved', () => {
            expect(toggle(mount({ showGraphPlaceholder: null }).container)).not.toBeNull();
        });

        it('calls back exactly once per click', () => {
            const onToggleBurndown = jest.fn<void, []>();
            const { container } = mount({ onToggleBurndown });

            fireEvent.click(requiredToggle(container));

            expect(onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('does not call back on render', () => {
            const onToggleBurndown = jest.fn<void, []>();

            mount({ onToggleBurndown });

            expect(onToggleBurndown).not.toHaveBeenCalled();
        });
    });

    describe('the toggle is reachable without a pointer', () => {
        it('announces itself as a control and takes a tab stop', () => {
            const control = requiredToggle(mount().container);

            expect(control.getAttribute('role')).toBe('button');
            expect(control.getAttribute('tabindex')).toBe('0');
        });

        it('reports the controlled region as revealed while the graph is shown', () => {
            expect(
                requiredToggle(mount({ isBurndownGraphCollapsed: false }).container).getAttribute(
                    'aria-expanded',
                ),
            ).toBe('true');
        });

        it('reports the controlled region as hidden while the graph is collapsed', () => {
            expect(
                requiredToggle(mount({ isBurndownGraphCollapsed: true }).container).getAttribute(
                    'aria-expanded',
                ),
            ).toBe('false');
        });

        it('activates on the enter key', () => {
            const onToggleBurndown = jest.fn<void, []>();
            const { container } = mount({ onToggleBurndown });

            fireEvent.keyDown(requiredToggle(container), { key: 'Enter' });

            expect(onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('activates on the space key without scrolling the page', () => {
            const onToggleBurndown = jest.fn<void, []>();
            const { container } = mount({ onToggleBurndown });
            const activated = fireEvent.keyDown(requiredToggle(container), { key: ' ' });

            expect(onToggleBurndown).toHaveBeenCalledTimes(1);
            // `fireEvent` returns false when the handler prevented the default.
            expect(activated).toBe(false);
        });

        it('also activates on the legacy name for the space key', () => {
            // React normalises the pre standard key name to the modern one
            // before the handler sees it (`normalizeKey` in react-dom), so an
            // older browser reporting the legacy name still activates the
            // control. Asserted rather than assumed, because the alternative
            // reading is that such a browser cannot use this control at all.
            const onToggleBurndown = jest.fn<void, []>();
            const { container } = mount({ onToggleBurndown });

            fireEvent.keyDown(requiredToggle(container), { key: 'Spacebar' });

            expect(onToggleBurndown).toHaveBeenCalledTimes(1);
        });

        it('ignores every other key', () => {
            const onToggleBurndown = jest.fn<void, []>();
            const { container } = mount({ onToggleBurndown });
            const control = requiredToggle(container);

            for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', 'PageDown', 'End']) {
                fireEvent.keyDown(control, { key });
            }

            expect(onToggleBurndown).not.toHaveBeenCalled();
        });
    });

    describe('an absent statistics payload', () => {
        it('still renders the band, the percentage and three blocks', () => {
            const { container } = mount({ stats: null });

            expect(band(container)).not.toBeNull();
            expect(percentage(container)).toBe('%');
            expect(statBlocks(container)).toHaveLength(3);
        });

        it('leaves the progress bar host empty rather than drawing a bar', () => {
            const { container } = mount({ stats: null });

            expect(mustFind(container, '.summary-progress-bar').children).toHaveLength(0);
        });

        it('still renders the toggle, because the toggle does not depend on the payload', () => {
            expect(toggle(mount({ stats: null }).container)).not.toBeNull();
        });
    });

    describe('the shipped locale still justifies two of this file\'s decisions', () => {
        interface LocaleShape {
            readonly BACKLOG: {
                readonly SUMMARY: Readonly<Record<string, string>>;
                readonly SPRINT_SUMMARY: Readonly<Record<string, string>>;
            };
        }

        function readLocale(): LocaleShape {
            return JSON.parse(readFileSync(LOCALE_FILE, 'utf8')) as LocaleShape;
        }

        it('embeds a line break element in all four statistic labels', () => {
            const { SUMMARY } = readLocale().BACKLOG;
            const keys = [
                'PROJECT_POINTS',
                'DEFINED_POINTS',
                'CLOSED_POINTS',
                'POINTS_PER_SPRINT',
            ];

            for (const key of keys) {
                expect(SUMMARY[key]).toMatch(/<br\s*\/?>/i);
            }
        });

        it('breaks the fourth label after the solidus', () => {
            expect(readLocale().BACKLOG.SUMMARY['POINTS_PER_SPRINT']).toBe('points /<br />sprint');
        });

        it('still spells the toggle title key exactly as this file spells it', () => {
            // The transposition is the shipped spelling, and it lives under the
            // sprint summary section rather than the summary section. Both facts
            // are asserted, because "correcting" either one renders the raw key
            // as the control's tooltip.
            const { SUMMARY, SPRINT_SUMMARY } = readLocale().BACKLOG;

            expect(Object.keys(SPRINT_SUMMARY)).toContain('TOGGLE_BAKLOG_GRAPH');
            expect(SPRINT_SUMMARY['TOGGLE_BAKLOG_GRAPH']).toBe('Show/Hide burndown graph');
            expect(Object.keys(SPRINT_SUMMARY)).not.toContain('TOGGLE_BACKLOG_GRAPH');
            expect(Object.keys(SUMMARY)).not.toContain('TOGGLE_BAKLOG_GRAPH');
        });
    });
});
