/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * ArchivedColumn.test.tsx -- co-located spec for the collapsed column rail
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, the
 * AngularJS services are doubles, no browser binary is launched, no network is
 * touched and nothing here refers to any generated build output.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./ArchivedColumn.tsx`, both of its exports. The unit is presentational, so
 * every assertion below is about EMITTED MARKUP -- class names, nesting, sibling
 * order, text content and the one data-bound inline style -- plus the single
 * lifetime callback the intro exposes.
 *
 * Class names and nesting are asserted rather than computed style because the
 * migration preserves every existing class name verbatim (rule T1) and the
 * appearance comes wholly from the unedited stylesheet, which jsdom does not
 * parse. An assertion on computed style would therefore test nothing about this
 * file; an assertion on the class contract tests exactly the thing that can
 * break.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 *  - the counter's internal roll animation and its state machine, which belong
 *    to `./TaskCounter.test.tsx`. What IS asserted here is the CALL SITE: that
 *    the vertical variant is selected, that the limit is passed through
 *    untouched, and that no re-render flag is forwarded;
 *  - which column is folded, and the force-folding of archived statuses on first
 *    load. That decision belongs to the caller and to `./state`, and the rail is
 *    mounted conditionally precisely so that it never has to know;
 *  - the store reconciliation the retired intro directive performed. Per
 *    requirement I9 that lives in `./hooks` and `./state`; the intro only
 *    reports that it is mounted.
 * ========================================================================== */

import { render } from '@testing-library/react';

import type { Status } from '../shared/types/status';
import { ArchivedColumn, ArchivedColumnIntro } from './ArchivedColumn';
import type { ArchivedColumnIntroProps, ArchivedColumnProps } from './ArchivedColumn';

/* --------------------------------------------------------------------------
 * Fixtures and doubles
 * -------------------------------------------------------------------------- */

/** The translation key the source reads (kanban-table.jade L138 and L214). */
const ARCHIVED_KEY = 'KANBAN.ARCHIVED';

/**
 * The value the shipped English locale holds for that key, verbatim.
 *
 * Parenthesised, and in mixed case: the parentheses come from the locale and the
 * upper-casing from `.placeholder-collapsed-wrapper`'s `text-transform`, so a
 * component that "helpfully" bracketed or upper-cased the string itself would
 * double up in English and corrupt every other locale. Asserting the raw value
 * is what catches that.
 */
const ARCHIVED_COPY = '(Archived)';

/** The host element of the ported counter, whose styling hangs off this tag. */
const COUNTER_HOST = 'tg-animated-counter';

/**
 * The translator double's signature — BOTH parameters of `TranslateFn`, so a case
 * can assert that no interpolation values are bound (the source binds none
 * either).
 */
type InstantMock = jest.Mock<string, [key: string, params?: Record<string, unknown>]>;

/**
 * A `$translate` double. `instant` resolves the archived key to the shipped
 * English value and marks anything else, so an unexpected lookup is visible in
 * the rendered output rather than silently plausible.
 */
function createTranslateDouble(): { readonly instant: InstantMock } {
    const instant: InstantMock = jest.fn(
        (key: string): string => (key === ARCHIVED_KEY ? ARCHIVED_COPY : `UNEXPECTED:${key}`),
    );


    return { instant };
}

/* --------------------------------------------------------------------------
 * ⭐ NO INJECTOR, NO PROVIDER AND NO ROOT-SCOPE DOUBLE IN THIS FILE.
 *
 * The rail used to resolve translation itself, so this spec had to stand up an
 * injector carrying `$translate` AND the application root scope -- the latter only
 * because the translation hook installs a language-change listener through it, and
 * without it the hook logged a degradation warning that would have polluted every
 * archived-branch case here with noise unrelated to what it asserts.
 *
 * The translator now arrives as a prop, so every case below renders the rail with
 * NO WRAPPER AT ALL. That is the strongest available form of the assertion the old
 * "exploding injector" case made by hand: a component that reached the bridge would
 * throw for want of a provider, on every single case rather than on one.
 * -------------------------------------------------------------------------- */

/**
 * A status record shaped like the ones the board actually holds.
 *
 * The colour is an ordinary per-project database value in the form the API
 * sends. It is fixture DATA, never a design token: rule T2 keeps this field
 * data-bound, and the spec's job is to prove the value flows through unchanged.
 */
const BASE_STATUS: Status = {
    id: 7,
    name: 'Ready for test',
    color: '#e4ce40',
    wip_limit: null,
    is_archived: false,
};

function statusOf(overrides: Partial<Status> = {}): Status {
    return { ...BASE_STATUS, ...overrides };
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`ArchivedColumn.test: no element matched '${selector}'.`);
    }

    return element;
}

/** The `class` attribute of every direct child, in DOM order. */
function childClassList(parent: Element): readonly string[] {
    return Array.from(parent.children).map((child: Element): string => child.className);
}

/** Everything the caller supplies, minus the translator the harness owns. */
type RailProps = Omit<ArchivedColumnProps, 'translate'>;

interface RailHarness {
    readonly container: HTMLElement;
    readonly instant: InstantMock;
    rerender(next: RailProps): void;
}

/** Renders the rail with a translator PROP and no provider of any kind. */
function renderRail(props: RailProps): RailHarness {
    const translate = createTranslateDouble();

    /* Forwards BOTH arguments, so the "no interpolation values" case stays honest. */
    const translateFn = (key: string, params?: Record<string, unknown>): string =>
        translate.instant(key, params);

    const { container, rerender } = render(
        <ArchivedColumn {...props} translate={translateFn} />,
    );

    return {
        container,
        instant: translate.instant,
        rerender(next: RailProps): void {
            rerender(<ArchivedColumn {...next} translate={translateFn} />);
        },
    };
}

/**
 * The `$$typeof` brand React stamps on the value `memo` returns.
 *
 * Read structurally because the memoisation is part of this file's public
 * contract -- the rail is repeated once per status per swimlane, so unwrapping it
 * would multiply wasted renders by the swimlane count -- and nothing else about
 * a memoised component is observable from the outside.
 */
function reactBrandOf(component: unknown): unknown {
    return (component as { readonly $$typeof?: unknown }).$$typeof;
}

/** Attribute names no element in this subtree may carry (rule T10). */
const FORBIDDEN_ATTRIBUTES: readonly string[] = ['role', 'title', 'tabindex'];

function forbiddenAttributesIn(root: Element): readonly string[] {
    const offenders: string[] = [];

    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        for (const name of element.getAttributeNames()) {
            if (FORBIDDEN_ATTRIBUTES.includes(name) || name.startsWith('aria-')) {
                offenders.push(`${element.tagName.toLowerCase()}[${name}]`);
            }
        }
    }

    return offenders;
}

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

describe('ArchivedColumn', () => {
    describe('the markup contract (kanban-table.jade L130-L142)', () => {
        it('emits the four nesting levels with their exact class names', () => {
            const { container } = renderRail({ status: statusOf(), count: 2 });

            const root = mustFind(container, '.placeholder-collapsed');

            // Level 1 is the container's only child; nothing wraps the rail.
            expect(container.children).toHaveLength(1);
            expect(container.firstElementChild).toBe(root);

            // Level 2 is the wrapper, and it is the rail's only child.
            expect(root.children).toHaveLength(1);
            const wrapper = mustFind(root, '.placeholder-collapsed-wrapper');
            expect(root.firstElementChild).toBe(wrapper);

            // Levels 3 and 4.
            expect(mustFind(wrapper, '.text-holder')).toBeInTheDocument();
            expect(mustFind(wrapper, '.name')).toBeInTheDocument();
            expect(mustFind(wrapper, '.square-color')).toBeInTheDocument();
        });

        it('keeps the doubled "m" of the count box class name (Drift D8)', () => {
            const { container } = renderRail({ status: statusOf(), count: 2 });

            // The typo IS the class name: `kanban-table.scss` L250 and L395
            // select it that way, and the corrected spelling matches nothing
            // anywhere in the repository.
            expect(container.querySelector('.ammount')).not.toBeNull();
            expect(container.querySelector('.amount')).toBeNull();
        });

        it('orders the wrapper siblings count, text holder, colour chip', () => {
            const { container } = renderRail({ status: statusOf(), count: 2 });

            // Load-bearing: `.placeholder-collapsed-wrapper` is `row-reverse`
            // under a vertical writing mode, so the LAST child paints at the top
            // of the rail. Reordering these would silently invert it.
            expect(childClassList(mustFind(container, '.placeholder-collapsed-wrapper'))).toEqual([
                'ammount',
                'text-holder',
                'square-color',
            ]);
        });

        it('drops only the count box when the status is archived', () => {
            const { container } = renderRail({
                status: statusOf({ is_archived: true }),
                count: 2,
            });

            expect(childClassList(mustFind(container, '.placeholder-collapsed-wrapper'))).toEqual([
                'text-holder',
                'square-color',
            ]);
        });

        it('orders the text holder archived label first, then the name', () => {
            const { container } = renderRail({
                status: statusOf({ is_archived: true }),
                count: 0,
            });

            // Source order. `.text-holder` is `row-reverse` too, which is why the
            // NAME is the run painted above the label in the reference render.
            expect(childClassList(mustFind(container, '.text-holder'))).toEqual([
                'archived',
                'name',
            ]);
        });

        it('renders the rail for a NON-archived status too', () => {
            // The source gate is `ng-if='folds[s.id]'` -- a fold test. Archived
            // statuses merely START folded, so this component must not be gated
            // on `is_archived`; only its two inner branches are.
            const { container } = renderRail({ status: statusOf(), count: 5 });

            expect(container.querySelector('.placeholder-collapsed')).not.toBeNull();
            expect(container.querySelector('.archived')).toBeNull();
            expect(container.querySelector('.ammount')).not.toBeNull();
        });

        it('adds no attribute the source does not have', () => {
            const { container } = renderRail({
                status: statusOf({ is_archived: true }),
                count: 0,
            });

            const root = mustFind(container, '.placeholder-collapsed');

            // The source element carries only its `ng-if`, which leaves no
            // attribute behind. Anything else here would be invention (T10).
            expect(root.getAttributeNames()).toEqual(['class']);
            expect(
                mustFind(container, '.placeholder-collapsed-wrapper').getAttributeNames(),
            ).toEqual(['class']);
            expect(mustFind(container, '.text-holder').getAttributeNames()).toEqual(['class']);
            expect(mustFind(container, '.name').getAttributeNames()).toEqual(['class']);
            expect(mustFind(container, '.archived').getAttributeNames()).toEqual(['class']);
        });

        it('adds no role, no title, no tabindex and no aria attribute', () => {
            const { container } = renderRail({ status: statusOf({ wip_limit: 3 }), count: 2 });

            expect(forbiddenAttributesIn(mustFind(container, '.placeholder-collapsed'))).toEqual(
                [],
            );
        });

        it('renders no interactive element and no vector mark', () => {
            const { container } = renderRail({
                status: statusOf({ is_archived: true }),
                count: 0,
            });

            // The unfold control and its sprite reference belong to the column
            // header component, not to this rail (rules T3 and T10).
            const root = mustFind(container, '.placeholder-collapsed');
            expect(root.querySelector('button')).toBeNull();
            expect(root.querySelector('a')).toBeNull();
            expect(root.querySelector('svg')).toBeNull();
            expect(root.querySelector('use')).toBeNull();
        });

        it('creates no shadow root anywhere in the subtree (requirement I6)', () => {
            const { container } = renderRail({ status: statusOf(), count: 1 });

            const root = mustFind(container, '.placeholder-collapsed');

            for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
                expect(element.shadowRoot).toBeNull();
            }
        });
    });

    describe('the status name', () => {
        it('renders the name as the text content of the name element', () => {
            const { container } = renderRail({
                status: statusOf({ name: 'Ready for test' }),
                count: 4,
            });

            expect(mustFind(container, '.name').textContent).toBe('Ready for test');
        });

        it('renders the name verbatim, without upper-casing or trimming it', () => {
            // `text-transform: uppercase` lives in the stylesheet; performing it
            // here as well would be a second, unremovable transformation.
            const { container } = renderRail({
                status: statusOf({ name: ' Espera de revisión ' }),
                count: 0,
            });

            expect(mustFind(container, '.name').textContent).toBe(' Espera de revisión ');
        });

        it('reflects a later name change', () => {
            const harness = renderRail({ status: statusOf({ name: 'New' }), count: 0 });

            harness.rerender({ status: statusOf({ name: 'Renamed' }), count: 0 });

            expect(mustFind(harness.container, '.name').textContent).toBe('Renamed');
        });
    });

    describe('the colour chip -- DATA, never a token (rule T2, Drift D3)', () => {
        it('binds the status colour as an inline background colour', () => {
            const { container } = renderRail({
                status: statusOf({ color: '#e4ce40' }),
                count: 1,
            });

            const chip = mustFind(container, '.square-color');

            // jsdom normalises the authored form, so the assertion is on the
            // resolved value rather than on the literal that was passed in.
            expect(chip.style.backgroundColor).toBe('rgb(228, 206, 64)');
            expect(chip.getAttributeNames()).toEqual(['class', 'style']);
        });

        it('carries a DIFFERENT colour for a different status', () => {
            // Two renders, two colours: proof the value is read from the datum
            // rather than baked in from the design frame.
            const first = renderRail({ status: statusOf({ color: 'rgb(1, 2, 3)' }), count: 0 });
            expect(mustFind(first.container, '.square-color').style.backgroundColor).toBe(
                'rgb(1, 2, 3)',
            );

            const second = renderRail({ status: statusOf({ color: 'rgb(4, 5, 6)' }), count: 0 });
            expect(mustFind(second.container, '.square-color').style.backgroundColor).toBe(
                'rgb(4, 5, 6)',
            );
        });

        it('sets no dimension, no radius, no border and no shadow', () => {
            // All of that already applies from `kanban-table.scss` L408-L411;
            // re-declaring it here would be a compliance violation (G-DS-4).
            const { container } = renderRail({ status: statusOf(), count: 0 });

            const chip = mustFind(container, '.square-color');

            expect(chip.style.getPropertyValue('width')).toBe('');
            expect(chip.style.getPropertyValue('height')).toBe('');
            expect(chip.style.getPropertyValue('border-radius')).toBe('');
            expect(chip.style.getPropertyValue('box-shadow')).toBe('');
        });

        it('renders the chip empty', () => {
            const { container } = renderRail({ status: statusOf(), count: 0 });

            const chip = mustFind(container, '.square-color');

            expect(chip.children).toHaveLength(0);
            expect(chip.textContent).toBe('');
        });
    });

    describe('the archived label', () => {
        it('resolves exactly the archived key and renders its value verbatim', () => {
            const harness = renderRail({
                status: statusOf({ is_archived: true }),
                count: 0,
            });

            // Two arguments, the second `undefined`: the bridge hook forwards its
            // optional interpolation map straight through, and this call site
            // supplies none -- the source binds no interpolation either.
            expect(harness.instant).toHaveBeenCalledTimes(1);
            expect(harness.instant).toHaveBeenCalledWith(ARCHIVED_KEY, undefined);
            expect(mustFind(harness.container, '.archived').textContent).toBe(ARCHIVED_COPY);
        });

        it('never resolves a translation for a non-archived status', () => {
            // The source evaluates the translate filter only INSIDE the element
            // gated on `s.is_archived`, so the lookup must not be hoisted.
            const harness = renderRail({ status: statusOf(), count: 3 });

            expect(harness.instant).not.toHaveBeenCalled();
        });

        it('renders WITHOUT ANY PROVIDER ABOVE IT, archived or not', () => {
            // Proves a negative no call-count assertion can: the rail resolves no
            // AngularJS service on either branch. A component that reached the bridge
            // would throw for want of a provider, so a passing render IS the assertion.
            const translate = (key: string): string => key;

            expect(() =>
                render(<ArchivedColumn status={statusOf()} count={3} translate={translate} />),
            ).not.toThrow();

            expect(() =>
                render(
                    <ArchivedColumn
                        status={statusOf({ is_archived: true })}
                        count={3}
                        translate={translate}
                    />,
                ),
            ).not.toThrow();
        });

        it('appears and disappears with the archived flag', () => {
            const harness = renderRail({ status: statusOf(), count: 3 });
            expect(harness.container.querySelector('.archived')).toBeNull();

            harness.rerender({ status: statusOf({ is_archived: true }), count: 3 });
            expect(harness.container.querySelector('.archived')).not.toBeNull();
            expect(harness.container.querySelector('.ammount')).toBeNull();

            harness.rerender({ status: statusOf({ is_archived: false }), count: 3 });
            expect(harness.container.querySelector('.archived')).toBeNull();
            expect(harness.container.querySelector('.ammount')).not.toBeNull();
        });
    });

    describe('the vertical counter call site', () => {
        it('mounts exactly one counter, in its vertical variant', () => {
            const { container } = renderRail({ status: statusOf(), count: 6 });

            const hosts = container.querySelectorAll(COUNTER_HOST);

            expect(hosts).toHaveLength(1);
            expect(mustFind(container, '.ammount').firstElementChild).toBe(hosts[0]);
            expect(hosts[0]).toHaveClass('vertical');
        });

        it('mounts no counter at all for an archived status', () => {
            const { container } = renderRail({
                status: statusOf({ is_archived: true }),
                count: 6,
            });

            expect(container.querySelectorAll(COUNTER_HOST)).toHaveLength(0);
        });

        it('forwards the count, and forwards no re-render flag', () => {
            const { container } = renderRail({ status: statusOf(), count: 6 });

            // A truthy re-render flag makes the counter freeze at zero, so a
            // rendered "6" is what proves the collapsed call site leaves that
            // binding off, exactly as kanban-table.jade L133-L136 does.
            const visibleRow = container.querySelectorAll<HTMLElement>('.result')[1];
            expect(visibleRow?.querySelector('.current')?.textContent).toBe('6');

            const host = mustFind(container, COUNTER_HOST);
            expect(host.hasAttribute('disabled')).toBe(false);
            expect(host.getAttributeNames()).toEqual(['class']);
        });

        it('renders a limit suffix when the status has a WIP limit', () => {
            const { container } = renderRail({
                status: statusOf({ wip_limit: 4 }),
                count: 1,
            });

            const visibleRow = container.querySelectorAll<HTMLElement>('.result')[1];

            expect(visibleRow?.textContent).toBe('1 / 4');
            expect(mustFind(container, '.animated-counter-inner')).toHaveClass('wip-amount');
        });

        it('renders a bare count when the limit is null', () => {
            const { container } = renderRail({
                status: statusOf({ wip_limit: null }),
                count: 2,
            });

            const visibleRow = container.querySelectorAll<HTMLElement>('.result')[1];

            expect(visibleRow?.textContent).toBe('2');
            expect(mustFind(container, '.animated-counter-inner')).not.toHaveClass('wip-amount');
        });

        it('renders a bare count when the limit is ZERO (Drift D13)', () => {
            // Zero is falsy, and the source tests the limit for truthiness rather
            // than against null, so a limit of zero produces no suffix and no
            // limit class. Passing the value through untouched is this call
            // site's whole contribution to that behaviour.
            const { container } = renderRail({
                status: statusOf({ wip_limit: 0 }),
                count: 0,
            });

            const visibleRow = container.querySelectorAll<HTMLElement>('.result')[1];

            expect(visibleRow?.textContent).toBe('0');
            expect(visibleRow?.children).toHaveLength(1);
            expect(mustFind(container, '.animated-counter-inner')).not.toHaveClass('wip-amount');
        });
    });

    describe('memoisation', () => {
        it('is a memoised component and names itself', () => {
            expect(reactBrandOf(ArchivedColumn)).toBe(Symbol.for('react.memo'));
            expect(ArchivedColumn.displayName).toBe('ArchivedColumn');
        });

        it('keeps the rendered nodes when re-rendered with equal props', () => {
            const status = statusOf({ wip_limit: 2 });
            const harness = renderRail({ status, count: 1 });

            const root = mustFind(harness.container, '.placeholder-collapsed');
            const chip = mustFind(harness.container, '.square-color');

            harness.rerender({ status, count: 1 });

            expect(mustFind(harness.container, '.placeholder-collapsed')).toBe(root);
            expect(mustFind(harness.container, '.square-color')).toBe(chip);
        });
    });
});

describe('ArchivedColumnIntro', () => {
    function renderIntro(props: ArchivedColumnIntroProps): {
        readonly container: HTMLElement;
        rerender(next: ArchivedColumnIntroProps): void;
        unmount(): void;
    } {
        const { container, rerender, unmount } = render(<ArchivedColumnIntro {...props} />);

        return {
            container,
            rerender(next: ArchivedColumnIntroProps): void {
                rerender(<ArchivedColumnIntro {...next} />);
            },
            unmount,
        };
    }

    describe('the markup contract (kanban-table.jade L172-L175)', () => {
        it('renders the intro container and nothing else', () => {
            const { container } = renderIntro({ status: statusOf({ is_archived: true }) });

            expect(container.children).toHaveLength(1);

            const intro = mustFind(container, '.kanban-column-intro');

            expect(container.firstElementChild).toBe(intro);
            expect(intro.tagName).toBe('DIV');
            expect(intro.children).toHaveLength(0);
            expect(intro.textContent).toBe('');
            expect(intro.getAttributeNames()).toEqual(['class']);
        });

        it('never sets the active state class', () => {
            // `kanban-table.scss` L260-L262 declares an `.active` variant that no
            // code in the repository ever applies. Inventing an applier would be
            // a feature change (T10).
            const { container } = renderIntro({ status: statusOf({ is_archived: true }) });

            expect(mustFind(container, '.kanban-column-intro')).not.toHaveClass('active');
        });

        it('adds no role, no title, no tabindex and no aria attribute', () => {
            const { container } = renderIntro({ status: statusOf({ is_archived: true }) });

            expect(forbiddenAttributesIn(mustFind(container, '.kanban-column-intro'))).toEqual([]);
        });

        it('is a memoised component and names itself', () => {
            expect(reactBrandOf(ArchivedColumnIntro)).toBe(Symbol.for('react.memo'));
            expect(ArchivedColumnIntro.displayName).toBe('ArchivedColumnIntro');
        });
    });

    describe('purity (requirement I9)', () => {
        it('renders with no bridge provider at all, so it resolves no AngularJS service', () => {
            // Rendering with NO provider is the stronger form of the assertion an
            // exploding-injector wrapper used to make: there is no injector to reach at
            // all, so a unit that tried would throw rather than pass quietly.
            expect(() =>
                render(<ArchivedColumnIntro status={statusOf({ is_archived: true })} />),
            ).not.toThrow();
        });

        it('renders and unmounts cleanly with no callback supplied', () => {
            const harness = renderIntro({ status: statusOf({ is_archived: true }) });

            expect(harness.container.querySelector('.kanban-column-intro')).not.toBeNull();
            expect(() => harness.unmount()).not.toThrow();
        });
    });

    describe('the onIntroShown lifetime seam', () => {
        it('notifies once on mount, with the status id', () => {
            const onIntroShown = jest.fn<void, [number]>();

            renderIntro({ status: statusOf({ id: 42, is_archived: true }), onIntroShown });

            expect(onIntroShown).toHaveBeenCalledTimes(1);
            expect(onIntroShown).toHaveBeenCalledWith(42);
        });

        it('does not re-notify when only the callback identity changes', () => {
            // The overwhelmingly common caller shape is an inline arrow, which is
            // a new identity on every render. The retired directive registered
            // once per element, i.e. once per status, so this must not re-fire.
            const status = statusOf({ id: 42, is_archived: true });
            const first = jest.fn<void, [number]>();
            const second = jest.fn<void, [number]>();

            const harness = renderIntro({ status, onIntroShown: first });
            harness.rerender({ status, onIntroShown: second });

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).not.toHaveBeenCalled();
        });

        it('notifies again when the status identity changes, using the latest callback', () => {
            const first = jest.fn<void, [number]>();
            const second = jest.fn<void, [number]>();

            const harness = renderIntro({
                status: statusOf({ id: 42, is_archived: true }),
                onIntroShown: first,
            });
            harness.rerender({
                status: statusOf({ id: 42, is_archived: true }),
                onIntroShown: second,
            });
            harness.rerender({
                status: statusOf({ id: 43, is_archived: true }),
                onIntroShown: second,
            });

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledWith(43);
        });

        it('does not re-notify when an unrelated field changes', () => {
            const status = statusOf({ id: 42, is_archived: true, name: 'Archived' });
            const onIntroShown = jest.fn<void, [number]>();

            const harness = renderIntro({ status, onIntroShown });
            harness.rerender({ status: { ...status, name: 'Archived stories' }, onIntroShown });

            expect(onIntroShown).toHaveBeenCalledTimes(1);
        });

        it('stops notifying after unmount', () => {
            const onIntroShown = jest.fn<void, [number]>();

            const harness = renderIntro({
                status: statusOf({ id: 42, is_archived: true }),
                onIntroShown,
            });

            harness.unmount();

            expect(onIntroShown).toHaveBeenCalledTimes(1);
        });
    });
});
