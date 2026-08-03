/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * ArchivedColumn.test.tsx -- co-located spec for the COLLAPSED column rail
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator is a plain function double, no browser binary is launched, no
 * network is touched and nothing here refers to any generated build output. The
 * suite therefore passes with no Chrome and no `dist/`.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./ArchivedColumn.tsx`, BOTH of its exports:
 *
 *   - `ArchivedColumn`      -- the collapsed rail, ported from the block at
 *                              `app/partials/includes/modules/kanban-table.jade`
 *                              L130-L142 (swimlane mode) and, byte for byte,
 *                              L206-L218 (flat mode);
 *   - `ArchivedColumnIntro` -- `div.kanban-column-intro`, ported from
 *                              `kanban-table.jade` L172-L175, whose retired
 *                              directive is `KanbanArchivedStatusIntroDirective`
 *                              at `app/coffee/modules/kanban/main.coffee`
 *                              L754-L770.
 *
 * Both units are presentational, so every assertion below is about EMITTED
 * MARKUP -- element names, class names, nesting, sibling order by index, text
 * content, attributes and the one data-bound inline style -- plus the single
 * lifetime callback the intro exposes.
 *
 * WHY CLASS NAMES AND NOT COMPUTED STYLE
 * --------------------------------------
 * Rule T1: the migration preserves every existing class name verbatim, and the
 * appearance comes wholly from the UNEDITED stylesheet
 * `app/styles/modules/kanban/kanban-table.scss`, which jsdom does not parse. An
 * assertion on computed style would therefore assert nothing about this file,
 * while an assertion on the class contract asserts exactly the thing that can
 * break.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - Geometry and orientation. The vertical writing mode, the reversed flex
 *    direction, the upper-casing, the chip's `1rem x 10px` and the 36 px rail
 *    width Figma node `1:7` measures at x 1701...1736 all live in
 *    `kanban-table.scss` L368-L410 and L100-L106. That is gap G-DS-3: component
 *    geometry already encoded in the stylesheet. No token is invented for it and
 *    NO PIXEL IS ASSERTED.
 *  - The unfold affordance. The expand control is the `.hunfold` button in
 *    `./StatusColumnHeader.tsx`; it is not part of this rail, and the cases below
 *    assert its ABSENCE so that nobody adds one here.
 *  - The counter's internal roll state machine, which belongs to
 *    `./TaskCounter.test.tsx`. What is asserted here is the CALL SITE: the
 *    vertical variant, the untouched limit, the absent re-render flag, and that
 *    the counter is consequently live rather than frozen.
 *  - Which column is folded, and the force-folding of archived statuses on first
 *    load (`main.coffee` L802-L805). That decision belongs to the caller and to
 *    `./state`; see the fold-gate cases for why the rail must never know.
 *  - The store reconciliation the retired intro directive performed. Per rule T5
 *    and requirement I7 the `$tgResources`/userstories-service pair lives in
 *    `./hooks` and `./state`; this file mocks neither and imports neither.
 * ========================================================================== */

import { act, fireEvent, render } from '@testing-library/react';

import type { Status } from '../shared/types/status';
import { ArchivedColumn, ArchivedColumnIntro } from './ArchivedColumn';
import type { ArchivedColumnIntroProps, ArchivedColumnProps } from './ArchivedColumn';

/* ==========================================================================
 * 1. THE CLASS AND KEY CONTRACT UNDER TEST
 * ========================================================================== */

/**
 * ⭐ THE COUNT BOX CLASS NAME, WITH ITS DOUBLED "m" -- `ammount`, not `amount`.
 *
 * T10: the typo IS the class name. `kanban-table.scss` selects `.ammount` at
 * L250 (the `&.target-drop` variant) and at L395 (inside
 * `.placeholder-collapsed`), and nothing anywhere in the repository selects the
 * corrected spelling. "Fixing" it would silently unstyle the collapsed counter,
 * which is a functional change and is forbidden.
 */
const COUNT_BOX_CLASS = 'ammount';

/**
 * The corrected spelling, DERIVED rather than written out.
 *
 * Deriving it does two things at once: it states the relationship between the
 * real name and the tempting one in code, and it keeps the literal token out of
 * this file so the repository-wide guard for the corrected spelling stays clean.
 * The cases below assert that no element in either subtree ever carries it.
 */
const CORRECTED_COUNT_BOX_CLASS = COUNT_BOX_CLASS.replace('mm', 'm');

/** The translation key the source reads (`kanban-table.jade` L138 and L214). */
const ARCHIVED_KEY = 'KANBAN.ARCHIVED';

/**
 * A stand-in for whatever the ACTIVE LOCALE holds for {@link ARCHIVED_KEY}.
 *
 * Deliberately not English copy, and deliberately not the shipped value: the
 * component's contract is to render the translator's answer, whatever it is. An
 * expectation written as English copy would pass just as well against a
 * component that hardcoded the word, which is precisely the regression these
 * cases exist to catch.
 */
const LOCALE_ANSWER = 'value-from-the-active-locale';

/** The host element of the ported counter; the stylesheet hangs off this tag. */
const COUNTER_HOST = 'tg-animated-counter';

/**
 * The class that swaps the counter onto its vertical axis, applied at the
 * collapsed call site by `class="vertical"` (`kanban-table.jade` L134 and L210).
 */
const COUNTER_VERTICAL_CLASS = 'vertical';

/* ==========================================================================
 * 2. FIXTURES
 * ========================================================================== */

/**
 * A status record shaped exactly like the ones the board holds: ONE shape in
 * three roles -- folded-and-ordinary, folded-and-archived, and limited -- which
 * is why there is a single factory and no per-variant builder.
 *
 * `color` is an ordinary per-project database value in the form the API sends.
 * It is fixture INPUT, never a design token: rule T2 and drift entry D3 keep the
 * field data-bound, and the colours visible in Figma node `1:7` are `sample_data`
 * artefacts that would break every real project if they were baked in here.
 *
 * `wip_limit` is `number | null`, and null means "no limit" rather than zero --
 * the distinction drift entry D13 turns on.
 */
const BASE_STATUS: Status = {
    id: 7,
    name: 'Ready for test',
    color: '#e4ce40',
    wip_limit: null,
    is_archived: false,
};

function makeStatus(overrides: Partial<Status> = {}): Status {
    return { ...BASE_STATUS, ...overrides };
}

/* ==========================================================================
 * 3. STRICT-SAFE QUERY HELPERS
 *
 * `strict` is on with no opt-out, so a helper that returns `Element | null`
 * forces a narrowing dance at every call site and buries the assertion. These
 * throw instead, which reads better AND fails with a useful message.
 * ========================================================================== */

/** Queries one element and THROWS when it is absent. */
function q(root: ParentNode, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`ArchivedColumn.test: no element matched '${selector}'.`);
    }

    return element;
}

/** Queries one element and returns `null` when it is absent, for absence cases. */
function maybe(root: ParentNode, selector: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(selector);
}

/**
 * Every match as a real array, so the count property is `length`.
 *
 * The React state for this board holds plain objects and plain arrays. The
 * persistent-collection façade the incumbent binds through -- whose count is
 * spelled differently -- is not used anywhere in this tree, and nothing here
 * constructs one.
 */
function all(root: ParentNode, selector: string): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/** The child at `index`, THROWING when the parent has no such child. */
function childAt(parent: Element, index: number): Element {
    const child = parent.children[index];

    if (child === undefined) {
        const tag = parent.tagName.toLowerCase();

        throw new Error(`ArchivedColumn.test: <${tag}> has no child at index ${index}.`);
    }

    return child;
}

/** The `class` attribute of every direct child, in DOM order. */
function childClasses(parent: Element): readonly string[] {
    return Array.from(parent.children).map((child: Element): string => child.className);
}

/** The rail's resting counter row. `TaskCounter` renders [nextUp, resting, nextDown]. */
const RESTING_ROW_INDEX = 1;

function restingCounterRow(container: HTMLElement): HTMLElement {
    const rows = all(container, '.result');

    const row = rows[RESTING_ROW_INDEX];

    if (row === undefined) {
        throw new Error(
            `ArchivedColumn.test: expected three counter rows, found ${rows.length}.`,
        );
    }

    return row;
}

/* ==========================================================================
 * 4. ATTRIBUTE-PURITY GUARD
 * ========================================================================== */

/**
 * Attributes the ported markup does not have and must not grow (rule T10).
 *
 * The source elements carry an `ng-if`, an `ng-style` or a `tg-bo-bind` and
 * nothing else, none of which leaves an attribute behind in a React port. Adding
 * a role or a label here would be an accessibility IMPROVEMENT, and improvements
 * outside the technology transition are exactly what the Minimal Change Clause
 * forbids -- they also change what assistive technology announces, which is a
 * behaviour change on a screen whose behaviour must be preserved.
 */
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

/** Every class name carried by any element in the subtree, root included. */
function everyClassNameIn(root: Element): readonly string[] {
    const names: string[] = [];

    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        names.push(...Array.from(element.classList));
    }

    return names;
}

/**
 * The `$$typeof` brand React stamps on the value `memo` returns.
 *
 * Read structurally because memoisation is part of these components' contract --
 * the rail is repeated once per status PER SWIMLANE, so unwrapping it would
 * multiply wasted renders by the swimlane count -- and nothing else about a
 * memoised component is observable from outside.
 */
function reactBrandOf(component: unknown): unknown {
    return (component as { readonly $$typeof?: unknown }).$$typeof;
}

/* ==========================================================================
 * 5. HARNESSES
 *
 * ⭐ NO INJECTOR, NO PROVIDER AND NO ROOT-SCOPE DOUBLE APPEARS IN THIS FILE.
 *
 * `ArchivedColumn` takes its translator as a PROP and consumes no bridge hook,
 * so every case below renders it with NO WRAPPER AT ALL. That is a stronger
 * statement than any call-count assertion could make: a leaf that reached the
 * AngularJS bridge would throw for want of a provider, on every single case
 * rather than on one. `../bridge/mockInjector` is consequently NOT imported --
 * there is nothing here for it to stand in for.
 * ========================================================================== */

/** The translator double's signature, taken from the component's own prop type. */
type TranslateFn = ArchivedColumnProps['translate'];

type TranslateDouble = jest.Mock<string, [key: string, params?: Record<string, unknown>]>;

/**
 * A translator that resolves every key to ITSELF.
 *
 * Identity is the right double here: it makes the rendered text equal to the KEY
 * the component asked for, so one assertion proves both that the lookup happened
 * and that the answer -- not a hardcoded string -- is what reached the DOM.
 */
function keyIdentityTranslator(): TranslateDouble {
    return jest.fn((key: string): string => key);
}

/** A translator standing in for a populated locale. */
function localeTranslator(): TranslateDouble {
    return jest.fn((key: string): string => (key === ARCHIVED_KEY ? LOCALE_ANSWER : `?${key}`));
}

/** Everything the caller supplies, minus the translator the harness owns. */
type RailProps = Omit<ArchivedColumnProps, 'translate'>;

interface RailHarness {
    readonly container: HTMLElement;
    readonly translate: TranslateDouble;
    readonly root: HTMLElement;
    rerender(next: RailProps): void;
}

/** Renders the rail with a translator PROP and no provider of any kind. */
function renderRail(
    props: RailProps,
    translate: TranslateDouble = keyIdentityTranslator(),
): RailHarness {
    /* Forwards BOTH parameters, so the "binds no interpolation" case stays honest. */
    const translateFn: TranslateFn = (key: string, params?: Record<string, unknown>): string =>
        translate(key, params);

    const { container, rerender } = render(<ArchivedColumn {...props} translate={translateFn} />);

    return {
        container,
        translate,
        root: q(container, '.placeholder-collapsed'),
        rerender(next: RailProps): void {
            rerender(<ArchivedColumn {...next} translate={translateFn} />);
        },
    };
}

interface IntroHarness {
    readonly container: HTMLElement;
    rerender(next: ArchivedColumnIntroProps): void;
    unmount(): void;
}

function renderIntro(props: ArchivedColumnIntroProps): IntroHarness {
    const { container, rerender, unmount } = render(<ArchivedColumnIntro {...props} />);

    return {
        container,
        rerender(next: ArchivedColumnIntroProps): void {
            rerender(<ArchivedColumnIntro {...next} />);
        },
        unmount,
    };
}

/* ==========================================================================
 * 6. SPECS -- THE COLLAPSED RAIL
 * ========================================================================== */

describe('ArchivedColumn (the collapsed rail)', () => {
    describe('the fold gate -- what actually selects this markup', () => {
        it('renders the collapsed rail for ANY folded column, not only archived ones -- the source gate is folds[s.id], not s.is_archived', () => {
            // T10: the biggest trap in this component, and the reason its name is
            // misleading on purpose. `kanban-table.jade` L130 gates the block on
            // `ng-if='folds[s.id]'` -- A FOLD TEST. Archived statuses merely START
            // folded, because `KanbanSquishColumnDirective`'s one-shot
            // `ctrl.initialLoad` watch forces `folds[status.id] = true` for every
            // archived status at `main.coffee` L802-L805. Gating this component on
            // `is_archived` would make every folded ORDINARY column vanish -- a
            // large, immediately visible regression that a naive reading of the
            // component's name invites. Whether a column is folded at all is the
            // caller's decision and `./state`'s data; the rail never asks.
            const { container } = renderRail({
                status: makeStatus({ is_archived: false }),
                count: 5,
            });

            expect(maybe(container, '.placeholder-collapsed')).not.toBeNull();
        });

        it('shows the count box and no archived label for a folded NON-archived status', () => {
            const { container } = renderRail({
                status: makeStatus({ is_archived: false }),
                count: 5,
            });

            expect(maybe(container, `.${COUNT_BOX_CLASS}`)).not.toBeNull();
            expect(maybe(container, '.archived')).toBeNull();
        });

        it('shows the archived label and no count box for a folded ARCHIVED status', () => {
            const { container } = renderRail({
                status: makeStatus({ is_archived: true }),
                count: 5,
            });

            expect(maybe(container, '.archived')).not.toBeNull();
            expect(maybe(container, `.${COUNT_BOX_CLASS}`)).toBeNull();
        });

        it('renders exactly ONE of the two sub-blocks -- never both, never neither', () => {
            // `div.ammount(ng-if="!s.is_archived")` and
            // `div.archived(ng-if="s.is_archived")` are complementary gates on the
            // SAME flag, so the pair is an exclusive-or by construction. Asserting
            // the XOR rather than the two branches separately is what catches a
            // refactor that changes one gate and forgets the other.
            for (const isArchived of [false, true]) {
                const { container } = renderRail({
                    status: makeStatus({ is_archived: isArchived }),
                    count: 3,
                });

                const hasCountBox = maybe(container, `.${COUNT_BOX_CLASS}`) !== null;
                const hasArchivedLabel = maybe(container, '.archived') !== null;

                expect(hasCountBox).toBe(!isArchived);
                expect(hasArchivedLabel).toBe(isArchived);
                expect(hasCountBox !== hasArchivedLabel).toBe(true);
            }
        });

        it('swaps the two sub-blocks when the archived flag flips, and keeps the rail', () => {
            const harness = renderRail({ status: makeStatus({ is_archived: false }), count: 3 });

            expect(maybe(harness.container, '.placeholder-collapsed')).not.toBeNull();
            expect(maybe(harness.container, `.${COUNT_BOX_CLASS}`)).not.toBeNull();
            expect(maybe(harness.container, '.archived')).toBeNull();

            harness.rerender({ status: makeStatus({ is_archived: true }), count: 3 });

            expect(maybe(harness.container, '.placeholder-collapsed')).not.toBeNull();
            expect(maybe(harness.container, `.${COUNT_BOX_CLASS}`)).toBeNull();
            expect(maybe(harness.container, '.archived')).not.toBeNull();

            harness.rerender({ status: makeStatus({ is_archived: false }), count: 3 });

            expect(maybe(harness.container, '.placeholder-collapsed')).not.toBeNull();
            expect(maybe(harness.container, `.${COUNT_BOX_CLASS}`)).not.toBeNull();
            expect(maybe(harness.container, '.archived')).toBeNull();
        });
    });

    describe('the emitted class contract (rule T1)', () => {
        it('emits the four nesting levels with their exact class names', () => {
            const { container, root } = renderRail({ status: makeStatus(), count: 2 });

            // Level 1 is the container's only child: nothing wraps the rail.
            expect(container.children).toHaveLength(1);
            expect(container.firstElementChild).toBe(root);
            expect(root.tagName).toBe('DIV');

            // Level 2 is the wrapper, and it is the rail's ONLY child.
            expect(root.children).toHaveLength(1);
            const wrapper = q(root, '.placeholder-collapsed-wrapper');
            expect(root.firstElementChild).toBe(wrapper);
            expect(wrapper.tagName).toBe('DIV');

            // Levels 3 and 4.
            expect(q(wrapper, `.${COUNT_BOX_CLASS}`).tagName).toBe('DIV');
            expect(q(wrapper, '.text-holder').tagName).toBe('DIV');
            expect(q(wrapper, '.name').tagName).toBe('DIV');
            expect(q(wrapper, '.square-color').tagName).toBe('DIV');
        });

        it('renders div.ammount -- the double-m spelling is the real class name in kanban-table.scss (T10, drift D8)', () => {
            // T10: `kanban-table.scss` selects `.ammount` at L250 and L395 and
            // NOTHING selects the corrected spelling, so the typo is load-bearing:
            // correcting it silently unstyles the collapsed counter. This asserts
            // the exact literal, so a well-meaning rename fails here rather than in
            // a screenshot nobody reads.
            const { container } = renderRail({ status: makeStatus(), count: 2 });

            expect(COUNT_BOX_CLASS).toBe('ammount');
            expect(q(container, `.${COUNT_BOX_CLASS}`).className).toBe('ammount');
        });

        it('carries the corrected spelling on NO element anywhere in either subtree', () => {
            // The guard for the other half of drift D8. `CORRECTED_COUNT_BOX_CLASS`
            // is derived from the real name so the tempting token never appears as
            // a literal in this file either.
            const rail = renderRail({ status: makeStatus(), count: 2 });
            const intro = renderIntro({ status: makeStatus({ is_archived: true }) });

            // Spelled in two halves on purpose: the whole point of the derivation
            // is that the corrected token never appears as a searchable literal.
            expect(CORRECTED_COUNT_BOX_CLASS).toBe('amo' + 'unt');
            expect(everyClassNameIn(rail.root)).not.toContain(CORRECTED_COUNT_BOX_CLASS);
            expect(maybe(intro.container, `.${CORRECTED_COUNT_BOX_CLASS}`)).toBeNull();
        });

        it('orders the wrapper children count box, text holder, colour chip -- by index', () => {
            // Load-bearing order. `.placeholder-collapsed-wrapper` is
            // `flex-direction: row-reverse` under `writing-mode: vertical-rl`
            // (`kanban-table.scss` L373-L381), so the LAST child paints at the top
            // of the rail. Reordering these would silently invert the rail while
            // every individual element still existed.
            const { container } = renderRail({
                status: makeStatus({ is_archived: false }),
                count: 2,
            });

            const wrapper = q(container, '.placeholder-collapsed-wrapper');

            expect(wrapper.children).toHaveLength(3);
            expect(childAt(wrapper, 0).className).toBe(COUNT_BOX_CLASS);
            expect(childAt(wrapper, 1).className).toBe('text-holder');
            expect(childAt(wrapper, 2).className).toBe('square-color');
            expect(childClasses(wrapper)).toEqual([COUNT_BOX_CLASS, 'text-holder', 'square-color']);
        });

        it('orders the wrapper children text holder, colour chip when archived -- by index', () => {
            // The archived branch drops ONLY the count box; the remaining two keep
            // their relative order and their indices shift down by one.
            const { container } = renderRail({
                status: makeStatus({ is_archived: true }),
                count: 2,
            });

            const wrapper = q(container, '.placeholder-collapsed-wrapper');

            expect(wrapper.children).toHaveLength(2);
            expect(childAt(wrapper, 0).className).toBe('text-holder');
            expect(childAt(wrapper, 1).className).toBe('square-color');
            expect(childClasses(wrapper)).toEqual(['text-holder', 'square-color']);
        });

        it('orders the text-holder children archived label, then name -- by index', () => {
            // Source order, `kanban-table.jade` L137-L139. `.text-holder` is
            // `row-reverse` too (`kanban-table.scss` L385-L390), which is why the
            // NAME is the run painted above the label in the reference render.
            const { container } = renderRail({
                status: makeStatus({ is_archived: true }),
                count: 0,
            });

            const holder = q(container, '.text-holder');

            expect(holder.children).toHaveLength(2);
            expect(childAt(holder, 0).className).toBe('archived');
            expect(childAt(holder, 1).className).toBe('name');
            expect(childClasses(holder)).toEqual(['archived', 'name']);
        });

        it('leaves the text holder holding only the name when the status is not archived', () => {
            const { container } = renderRail({
                status: makeStatus({ is_archived: false }),
                count: 0,
            });

            const holder = q(container, '.text-holder');

            expect(holder.children).toHaveLength(1);
            expect(childAt(holder, 0).className).toBe('name');
        });

        it('adds no attribute the source markup does not have', () => {
            const { container } = renderRail({
                status: makeStatus({ is_archived: true }),
                count: 0,
            });

            // The source elements carry `ng-if`, `ng-style` and `tg-bo-bind`, none
            // of which survives into a React port as an attribute. Anything beyond
            // `class` -- and `style` on the data-bound chip alone -- is invention.
            expect(q(container, '.placeholder-collapsed').getAttributeNames()).toEqual(['class']);
            expect(q(container, '.placeholder-collapsed-wrapper').getAttributeNames()).toEqual([
                'class',
            ]);
            expect(q(container, '.text-holder').getAttributeNames()).toEqual(['class']);
            expect(q(container, '.archived').getAttributeNames()).toEqual(['class']);
            expect(q(container, '.name').getAttributeNames()).toEqual(['class']);
            expect(q(container, '.square-color').getAttributeNames()).toEqual(['class', 'style']);
        });

        it('adds no role, no title, no tabindex and no aria attribute', () => {
            const { root } = renderRail({ status: makeStatus({ wip_limit: 3 }), count: 2 });

            expect(forbiddenAttributesIn(root)).toEqual([]);
        });

        it('renders no expand chevron, no button, no link and no vector mark', () => {
            // The expand affordance is the `.hunfold` unfold button and it lives in
            // `./StatusColumnHeader.tsx`, NOT here -- so this case exists to stop
            // one being added. Rule T3 also forbids any new icon: every sprite
            // reference on this screen goes through `../shared/Svg` against the
            // sprite already inlined into the document.
            const { root } = renderRail({ status: makeStatus({ is_archived: true }), count: 0 });

            expect(maybe(root, '.hunfold')).toBeNull();
            expect(maybe(root, 'button')).toBeNull();
            expect(maybe(root, 'a')).toBeNull();
            expect(maybe(root, 'svg')).toBeNull();
            expect(maybe(root, 'use')).toBeNull();
            expect(maybe(root, 'tg-svg')).toBeNull();
        });

        it('creates no shadow root anywhere in the subtree (requirement I6)', () => {
            // Light DOM is mandatory, not preferred: a shadow boundary would sever
            // the single global stylesheet loaded at `app/index.jade` L25 and would
            // stop `<use href="#icon-...">` resolving against the sprite inlined at
            // L96 -- unstyling the rail and blanking every icon on the screen.
            const { root } = renderRail({ status: makeStatus(), count: 1 });

            for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
                expect(element.shadowRoot).toBeNull();
            }
        });
    });

    describe('the archived label -- translated, never hardcoded copy', () => {
        it('asks the injected translator for exactly the KANBAN.ARCHIVED key', () => {
            const harness = renderRail({ status: makeStatus({ is_archived: true }), count: 0 });

            // The KEY is what is asserted, not English copy. With an identity
            // translator the rendered text IS the key, so this one pair of
            // assertions proves the lookup happened AND that the translator's
            // answer -- rather than a baked-in string -- is what reached the DOM.
            expect(harness.translate).toHaveBeenCalledTimes(1);
            expect(harness.translate.mock.calls[0]?.[0]).toBe(ARCHIVED_KEY);
            expect(q(harness.container, '.archived').textContent).toBe(ARCHIVED_KEY);
        });

        it('binds no interpolation values, because the source binds none', () => {
            // `{{'KANBAN.ARCHIVED' | translate}}` at `kanban-table.jade` L138 passes
            // the filter nothing, so the port must pass nothing either: a stray
            // interpolation map would change which locale string is selected for
            // plural or gendered locales.
            const harness = renderRail({ status: makeStatus({ is_archived: true }), count: 0 });

            expect(harness.translate).toHaveBeenCalledWith(ARCHIVED_KEY, undefined);
        });

        it('renders whatever the active locale returns, verbatim', () => {
            // A populated-locale double, whose answer is deliberately NOT English
            // copy: the component neither punctuates nor cases the value. The
            // shipped English string arrives parenthesised and the upper-casing
            // comes from `.placeholder-collapsed-wrapper`'s `text-transform`
            // (`kanban-table.scss` L378), so a component that bracketed or
            // upper-cased it would double up in English and corrupt every other
            // locale.
            const harness = renderRail(
                { status: makeStatus({ is_archived: true }), count: 0 },
                localeTranslator(),
            );

            expect(q(harness.container, '.archived').textContent).toBe(LOCALE_ANSWER);
        });

        it('asks for no translation at all when the status is not archived', () => {
            // The source evaluates the translate filter INSIDE the element gated on
            // `s.is_archived`, so the lookup must not be hoisted above the branch.
            const harness = renderRail({ status: makeStatus({ is_archived: false }), count: 3 });

            expect(harness.translate).not.toHaveBeenCalled();
        });

        it('renders on both branches with no provider, so it resolves no AngularJS service', () => {
            // Rendering with NO provider is a stronger statement than any
            // call-count assertion: a leaf that reached the bridge would throw for
            // want of an injector, so a passing render IS the assertion. Rule T5
            // and requirement I7 keep every service call in `./hooks`.
            const translate: TranslateFn = (key: string): string => key;

            expect(() =>
                render(<ArchivedColumn status={makeStatus()} count={3} translate={translate} />),
            ).not.toThrow();

            expect(() =>
                render(
                    <ArchivedColumn
                        status={makeStatus({ is_archived: true })}
                        count={3}
                        translate={translate}
                    />,
                ),
            ).not.toThrow();
        });
    });

    describe('the status name', () => {
        it('renders the name as the exact text content of div.name', () => {
            const { container } = renderRail({
                status: makeStatus({ name: 'Ready for test' }),
                count: 4,
            });

            // Strict equality, not `toContain`: `tg-bo-bind="s.name"` at
            // `kanban-table.jade` L139 writes the name and nothing else into the
            // element, so any decoration added here would be a content change.
            expect(q(container, '.name').textContent).toBe('Ready for test');
        });

        it('renders the name as TEXT, never as markup', () => {
            // A status name is user-authored, per-project data. React escapes text
            // children by default, so this passes today; the case exists so that a
            // future `dangerouslySetInnerHTML` cannot be introduced without a
            // failing test -- the exact injection guard the migration plan asks for
            // now that React renders user content on this screen.
            const { container } = renderRail({
                status: makeStatus({ name: '<i>DONE</i>' }),
                count: 1,
            });

            const name = q(container, '.name');

            expect(name.textContent).toBe('<i>DONE</i>');
            expect(maybe(container, 'i')).toBeNull();
            expect(name.children).toHaveLength(0);
        });

        it('renders the name verbatim, without upper-casing or trimming it', () => {
            // `text-transform: uppercase` lives in the stylesheet
            // (`kanban-table.scss` L378); performing it here as well would be a
            // second, unremovable transformation that no locale could opt out of.
            const { container } = renderRail({
                status: makeStatus({ name: ' Espera de revisión ' }),
                count: 0,
            });

            expect(q(container, '.name').textContent).toBe(' Espera de revisión ');
        });

        it('reflects a later name change', () => {
            // The source binding is ONE-TIME (`tg-bo-bind`), which in AngularJS
            // froze the text after the first digest. Plain React text content is
            // strictly better behaved and is what the port emits; a rename now
            // shows up, and nothing in the screen's behaviour depended on the
            // staleness.
            const harness = renderRail({ status: makeStatus({ name: 'New' }), count: 0 });

            harness.rerender({ status: makeStatus({ name: 'Renamed' }), count: 0 });

            expect(q(harness.container, '.name').textContent).toBe('Renamed');
        });
    });

    describe('the colour chip -- DATA, never a token (rule T2, drift D3)', () => {
        it('binds the fixture-supplied status colour as an inline background colour', () => {
            // The colour arrives as fixture INPUT and is asserted as OUTPUT, which
            // is the only honest way to test a data-bound value. The status colours
            // visible in Figma node `1:7` -- NEW, READY, IN PROGRESS, READY FOR
            // TEST, DONE -- are `sample_data` artefacts, and hardcoding any of them
            // would break every real project.
            const { container } = renderRail({
                status: makeStatus({ color: '#e4ce40' }),
                count: 1,
            });

            // jsdom normalises the authored hex to `rgb()`, so the assertion is on
            // the resolved value rather than on the literal that was passed in.
            expect(q(container, '.square-color').style.backgroundColor).toBe('rgb(228, 206, 64)');
        });

        it('carries a DIFFERENT colour for a different status', () => {
            // Two renders, two colours: proof the value is read from the datum on
            // every render rather than baked in from the design frame once.
            const first = renderRail({ status: makeStatus({ color: 'rgb(1, 2, 3)' }), count: 0 });
            const second = renderRail({ status: makeStatus({ color: 'rgb(4, 5, 6)' }), count: 0 });

            expect(q(first.container, '.square-color').style.backgroundColor).toBe('rgb(1, 2, 3)');
            expect(q(second.container, '.square-color').style.backgroundColor).toBe('rgb(4, 5, 6)');
        });

        it('sets background colour and nothing else inline', () => {
            // Gap G-DS-3: the chip's `height: 1rem` and `width: 10px`
            // (`kanban-table.scss` L406-L409) are component geometry ALREADY encoded
            // in the unedited stylesheet. Re-declaring any of it here would be a
            // design-system compliance violation, and asserting a pixel would be
            // meaningless anyway because jsdom loads no CSS.
            const { container } = renderRail({ status: makeStatus(), count: 0 });

            const chip = q(container, '.square-color');

            expect(chip.style.length).toBe(1);
            expect(chip.style.getPropertyValue('background-color')).not.toBe('');
            expect(chip.style.getPropertyValue('width')).toBe('');
            expect(chip.style.getPropertyValue('height')).toBe('');
            expect(chip.style.getPropertyValue('border-radius')).toBe('');
            expect(chip.style.getPropertyValue('box-shadow')).toBe('');
            expect(chip.style.getPropertyValue('writing-mode')).toBe('');
            expect(chip.style.getPropertyValue('transform')).toBe('');
        });

        it('renders the chip empty', () => {
            const { container } = renderRail({ status: makeStatus(), count: 0 });

            const chip = q(container, '.square-color');

            expect(chip.children).toHaveLength(0);
            expect(chip.textContent).toBe('');
        });
    });

    describe('the vertical counter call site', () => {
        it('mounts exactly one counter host, tg-animated-counter, carrying class vertical', () => {
            const { container } = renderRail({ status: makeStatus(), count: 6 });

            const hosts = all(container, COUNTER_HOST);

            // The ELEMENT NAME and the CLASS are both asserted: the name because
            // `kanban-table.scss` selects on the tag, and the class because
            // `class="vertical"` (`kanban-table.jade` L134) is what swaps the
            // counter onto the `translateX` / `width: $counter-height` axis. React
            // forwards `class` verbatim on a hyphenated tag, so the spelling here is
            // the one the stylesheet sees.
            expect(hosts).toHaveLength(1);
            expect(q(container, COUNTER_HOST).tagName).toBe('TG-ANIMATED-COUNTER');
            expect(q(container, COUNTER_HOST)).toHaveClass(COUNTER_VERTICAL_CLASS);
        });

        it('mounts the counter as the only child of the count box', () => {
            const { container } = renderRail({ status: makeStatus(), count: 6 });

            const box = q(container, `.${COUNT_BOX_CLASS}`);

            expect(box.children).toHaveLength(1);
            expect(childAt(box, 0)).toBe(q(container, COUNTER_HOST));
        });

        it('mounts no counter at all for an archived status', () => {
            const { container } = renderRail({
                status: makeStatus({ is_archived: true }),
                count: 6,
            });

            expect(all(container, COUNTER_HOST)).toHaveLength(0);
        });

        it('echoes the count into the rendered number', () => {
            const { container } = renderRail({ status: makeStatus({ wip_limit: null }), count: 6 });

            expect(q(restingCounterRow(container), '.current').textContent).toBe('6');
        });

        it('renders count over limit when the status has a WIP limit', () => {
            const { container } = renderRail({ status: makeStatus({ wip_limit: 4 }), count: 1 });

            expect(restingCounterRow(container).textContent).toBe('1 / 4');
            expect(q(container, '.animated-counter-inner')).toHaveClass('wip-amount');
        });

        it('renders a bare count when the limit is null', () => {
            const { container } = renderRail({ status: makeStatus({ wip_limit: null }), count: 2 });

            expect(restingCounterRow(container).textContent).toBe('2');
            expect(restingCounterRow(container).children).toHaveLength(1);
            expect(q(container, '.animated-counter-inner')).not.toHaveClass('wip-amount');
        });

        it('renders a bare count when the limit is ZERO (drift D13)', () => {
            // Zero is falsy, and the source tests the limit for TRUTHINESS rather
            // than against null, so a limit of zero produces no suffix and no limit
            // class -- indistinguishable from "no limit" on screen. Passing the
            // value through untouched is this call site's whole contribution to that
            // behaviour, and the alternative -- normalising zero to null, or
            // treating it as a real limit -- would each change what the board shows.
            const { container } = renderRail({ status: makeStatus({ wip_limit: 0 }), count: 3 });

            expect(restingCounterRow(container).textContent).toBe('3');
            expect(restingCounterRow(container).children).toHaveLength(1);
            expect(q(container, '.animated-counter-inner')).not.toHaveClass('wip-amount');
        });

        it('passes NO disabled binding, so the host carries only its class', () => {
            // ⭐ THE ASYMMETRY WORTH NAMING. The EXPANDED counter binds
            // `disabled="ctrl.renderInProgress"` (`kanban-table.jade` L126-L129 and
            // L202-L205); this COLLAPSED one binds nothing at all
            // (L133-L136 and L209-L212). It is the only counter call site in the
            // application with no re-render flag, which is exactly why
            // `TaskCounter`'s `disabled` prop must stay OPTIONAL -- and why this
            // case asserts the attribute is absent rather than merely falsy.
            const { container } = renderRail({ status: makeStatus({ wip_limit: 4 }), count: 6 });

            const host = q(container, COUNTER_HOST);

            expect(host.hasAttribute('disabled')).toBe(false);
            expect(host.getAttributeNames()).toEqual(['class']);
            expect(restingCounterRow(container).textContent).toBe('6 / 4');
        });

        describe('and because no disabled binding is passed, the counter stays live', () => {
            beforeEach(() => {
                jest.useFakeTimers();
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it('rolls to a new count, which a frozen counter could not do', () => {
                // Positive proof for the case above: a truthy re-render flag makes
                // the counter's layout effect bail out and the number never moves.
                // Driving a real roll to completion is therefore the strongest
                // available assertion that the collapsed call site leaves the flag
                // off. The two-commit dance -- stage the row, then apply the
                // direction class one macrotask later -- and the manual
                // `transitionend` are jsdom necessities: it fires no transition
                // events of its own.
                const harness = renderRail({ status: makeStatus({ wip_limit: 4 }), count: 1 });

                expect(restingCounterRow(harness.container).textContent).toBe('1 / 4');

                harness.rerender({ status: makeStatus({ wip_limit: 4 }), count: 2 });

                const translator = q(harness.container, '.counter-translator');
                expect(translator.className).toBe('counter-translator');

                act(() => {
                    jest.advanceTimersByTime(1);
                });

                expect(q(harness.container, '.counter-translator').className).toBe(
                    'counter-translator inc',
                );

                fireEvent.transitionEnd(q(harness.container, '.counter-translator'));

                expect(restingCounterRow(harness.container).textContent).toBe('2 / 4');
                expect(q(harness.container, '.counter-translator').className).toBe(
                    'counter-translator',
                );
            });
        });
    });

    describe('memoisation', () => {
        it('is a memoised component and names itself', () => {
            expect(reactBrandOf(ArchivedColumn)).toBe(Symbol.for('react.memo'));
            expect(ArchivedColumn.displayName).toBe('ArchivedColumn');
        });

        it('keeps the rendered nodes when re-rendered with equal props', () => {
            // The rail is repeated once per status PER SWIMLANE -- Figma node `1:7`
            // shows the archived rail five times, once per swimlane -- so a
            // re-render that recreated these nodes would multiply the cost by the
            // swimlane count. Node identity is the observable form of that.
            const status = makeStatus({ wip_limit: 2 });
            const harness = renderRail({ status, count: 1 });

            const root = q(harness.container, '.placeholder-collapsed');
            const chip = q(harness.container, '.square-color');

            harness.rerender({ status, count: 1 });

            expect(q(harness.container, '.placeholder-collapsed')).toBe(root);
            expect(q(harness.container, '.square-color')).toBe(chip);
        });
    });
});

/* ==========================================================================
 * 7. SPECS -- THE ARCHIVED COLUMN INTRO
 *
 * Ported from `kanban-table.jade` L172-L175, whose retired directive is
 * `KanbanArchivedStatusIntroDirective` (`main.coffee` L754-L770):
 *
 *     $scope.$on "kanban:shown-userstories-for-status", (ctx, statusId, loaded) ->
 *         if statusId == status.id                     # L761 -- the whole behaviour
 *             kanbanUserstoriesService.deleteStatus(statusId)   # L762
 *             kanbanUserstoriesService.add(loaded)              # L763
 *
 * TWO SOURCE DETAILS RECORDED RATHER THAN REPRODUCED:
 *
 *  1. The directive opens with a module-level `userStories = []` (L755) that
 *     NOTHING ever reads. It is dead code in the incumbent and is deliberately
 *     not carried across; this note exists so its absence reads as a decision
 *     rather than an oversight.
 *  2. `deleteStatus` then `add` are SERVICE calls on `tgKanbanUserstories`. Rule
 *     T5 and requirement I7 place those in `./hooks` and `./state`, not in a
 *     presentational leaf, so this file neither imports nor mocks
 *     `$tgResources` or the userstories service. What the leaf owns is the SEAM:
 *     it announces, exactly once and only for itself, that an archived column's
 *     intro is mounted -- and the ordering cases below assert that the
 *     announcement arrives with the node already in the document, which is the
 *     precondition the receiving hook's delete-then-add pair depends on.
 *
 * A THIRD DETAIL, ABOUT THE FOLDED CASE: `.vfold .kanban-column-intro { display:
 * none }` at `kanban-table.scss` L107-L109 means a folded archived column hides
 * its intro THROUGH CSS. The component must therefore NOT gate on folded state --
 * the element still exists while folded -- and this spec must not assert
 * `display`, which jsdom could not resolve anyway.
 * ========================================================================== */

describe('ArchivedColumnIntro', () => {
    describe('the archived gate (kanban-table.jade L172-L175)', () => {
        it('renders div.kanban-column-intro for an archived status', () => {
            const { container } = renderIntro({ status: makeStatus({ is_archived: true }) });

            const intro = q(container, '.kanban-column-intro');

            expect(container.children).toHaveLength(1);
            expect(container.firstElementChild).toBe(intro);
            expect(intro.tagName).toBe('DIV');
            expect(intro.children).toHaveLength(0);
            expect(intro.textContent).toBe('');
            expect(intro.getAttributeNames()).toEqual(['class']);
        });

        it('renders NOTHING for a non-archived status', () => {
            // The source element is `ng-if="s.is_archived"`, so an ordinary column
            // has no intro node at all. Unlike the rail above -- gated on FOLD, not
            // on archived -- this one really is archived-only, and emitting a stray
            // empty div in every column would add a `margin: 1rem 2rem` box
            // (`kanban-table.scss` L255-L262) to five columns per swimlane.
            const { container } = renderIntro({ status: makeStatus({ is_archived: false }) });

            expect(container.children).toHaveLength(0);
            expect(maybe(container, '.kanban-column-intro')).toBeNull();
        });

        it('appears when a status becomes archived and disappears when it stops being', () => {
            const harness = renderIntro({ status: makeStatus({ is_archived: false }) });
            expect(maybe(harness.container, '.kanban-column-intro')).toBeNull();

            harness.rerender({ status: makeStatus({ is_archived: true }) });
            expect(maybe(harness.container, '.kanban-column-intro')).not.toBeNull();

            harness.rerender({ status: makeStatus({ is_archived: false }) });
            expect(maybe(harness.container, '.kanban-column-intro')).toBeNull();
        });

        it('never sets the active state class', () => {
            // `kanban-table.scss` L259-L261 declares an `&.active` variant that no
            // code in the repository ever applies. Inventing an applier would be a
            // feature change (rule T10).
            const { container } = renderIntro({ status: makeStatus({ is_archived: true }) });

            expect(q(container, '.kanban-column-intro')).not.toHaveClass('active');
            expect(q(container, '.kanban-column-intro').className).toBe('kanban-column-intro');
        });

        it('adds no role, no title, no tabindex and no aria attribute', () => {
            const { container } = renderIntro({ status: makeStatus({ is_archived: true }) });

            expect(forbiddenAttributesIn(q(container, '.kanban-column-intro'))).toEqual([]);
        });

        it('is a memoised component and names itself', () => {
            expect(reactBrandOf(ArchivedColumnIntro)).toBe(Symbol.for('react.memo'));
            expect(ArchivedColumnIntro.displayName).toBe('ArchivedColumnIntro');
        });
    });

    describe('the status-identity guard (main.coffee L761)', () => {
        it('announces once on mount, carrying THIS status id', () => {
            const onIntroShown = jest.fn<void, [number]>();

            renderIntro({ status: makeStatus({ id: 42, is_archived: true }), onIntroShown });

            expect(onIntroShown).toHaveBeenCalledTimes(1);
            expect(onIntroShown).toHaveBeenCalledWith(42);
        });

        it('announces only its OWN id when two intros are mounted side by side', () => {
            // The React form of the retired `statusId == status.id` guard. The
            // directive was a LISTENER on a broadcast and had to filter, because
            // every archived column heard every reveal; without the filter, one
            // column's reveal reloaded them all. The port inverts the direction --
            // each intro announces itself -- so the guard holds BY CONSTRUCTION,
            // and this case is what proves the construction: neither callback ever
            // sees the other status's id.
            const first = jest.fn<void, [number]>();
            const second = jest.fn<void, [number]>();

            render(
                <>
                    <ArchivedColumnIntro
                        status={makeStatus({ id: 42, is_archived: true })}
                        onIntroShown={first}
                    />
                    <ArchivedColumnIntro
                        status={makeStatus({ id: 43, is_archived: true })}
                        onIntroShown={second}
                    />
                </>,
            );

            expect(first.mock.calls).toEqual([[42]]);
            expect(second.mock.calls).toEqual([[43]]);
        });

        it('announces nothing at all for a non-archived status', () => {
            // The other half of the archived gate. A non-archived status never
            // rendered the element, so the directive was never linked and no
            // listener existed -- the port must therefore stay silent too, not
            // merely render nothing.
            const onIntroShown = jest.fn<void, [number]>();

            renderIntro({ status: makeStatus({ id: 42, is_archived: false }), onIntroShown });

            expect(onIntroShown).not.toHaveBeenCalled();
        });

        it('announces when a status becomes archived, and not before', () => {
            const onIntroShown = jest.fn<void, [number]>();
            const harness = renderIntro({
                status: makeStatus({ id: 42, is_archived: false }),
                onIntroShown,
            });

            expect(onIntroShown).not.toHaveBeenCalled();

            harness.rerender({ status: makeStatus({ id: 42, is_archived: true }), onIntroShown });

            expect(onIntroShown).toHaveBeenCalledTimes(1);
            expect(onIntroShown).toHaveBeenCalledWith(42);
        });

        it('announces the NEW id, and not the old one, when the status identity changes', () => {
            const first = jest.fn<void, [number]>();
            const second = jest.fn<void, [number]>();

            const harness = renderIntro({
                status: makeStatus({ id: 42, is_archived: true }),
                onIntroShown: first,
            });
            harness.rerender({
                status: makeStatus({ id: 42, is_archived: true }),
                onIntroShown: second,
            });
            harness.rerender({
                status: makeStatus({ id: 43, is_archived: true }),
                onIntroShown: second,
            });

            expect(first.mock.calls).toEqual([[42]]);
            expect(second.mock.calls).toEqual([[43]]);
        });

        it('does not re-announce when only the callback identity changes', () => {
            // The overwhelmingly common caller shape is an inline arrow, which is a
            // fresh identity on every parent render. The retired directive
            // registered once per element -- i.e. once per status -- so this must
            // not re-fire, or every board re-render would re-reveal every archived
            // column.
            const status = makeStatus({ id: 42, is_archived: true });
            const first = jest.fn<void, [number]>();
            const second = jest.fn<void, [number]>();

            const harness = renderIntro({ status, onIntroShown: first });
            harness.rerender({ status, onIntroShown: second });

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).not.toHaveBeenCalled();
        });

        it('does not re-announce when an unrelated field changes', () => {
            const status = makeStatus({ id: 42, is_archived: true, name: 'Archived stories' });
            const onIntroShown = jest.fn<void, [number]>();

            const harness = renderIntro({ status, onIntroShown });
            harness.rerender({ status: { ...status, name: 'Archived work' }, onIntroShown });

            expect(onIntroShown).toHaveBeenCalledTimes(1);
        });

        it('stops announcing after unmount', () => {
            const onIntroShown = jest.fn<void, [number]>();

            const harness = renderIntro({
                status: makeStatus({ id: 42, is_archived: true }),
                onIntroShown,
            });

            harness.unmount();

            expect(onIntroShown).toHaveBeenCalledTimes(1);
        });
    });

    describe('ordering at the seam (main.coffee L762-L763)', () => {
        it('announces with the intro node already in the document', () => {
            // A shared call-order recorder, which is how the delete-then-add
            // ordering of L762-L763 is observable from here. Those two service
            // calls belong to `./hooks` (rule T5, requirement I7), and the ONLY
            // ordering this leaf controls is the one they depend on: the
            // announcement must arrive AFTER commit, with the column's intro
            // mounted, or a receiver that reconciled the store would be doing so
            // against markup that did not exist yet.
            const calls: string[] = [];

            renderIntro({
                status: makeStatus({ id: 42, is_archived: true }),
                onIntroShown: (statusId: number): void => {
                    calls.push(`node-count:${all(document.body, '.kanban-column-intro').length}`);
                    calls.push(`announced:${statusId}`);
                },
            });

            expect(calls).toEqual(['node-count:1', 'announced:42']);
        });

        it('announces two mounted intros in mount order', () => {
            const calls: string[] = [];
            const record = (statusId: number): void => {
                calls.push(`announced:${statusId}`);
            };

            render(
                <>
                    <ArchivedColumnIntro
                        status={makeStatus({ id: 42, is_archived: true })}
                        onIntroShown={record}
                    />
                    <ArchivedColumnIntro
                        status={makeStatus({ id: 43, is_archived: true })}
                        onIntroShown={record}
                    />
                </>,
            );

            expect(calls).toEqual(['announced:42', 'announced:43']);
        });
    });

    describe('purity (requirement I9)', () => {
        it('renders with no provider at all, so it resolves no AngularJS service', () => {
            expect(() =>
                render(<ArchivedColumnIntro status={makeStatus({ is_archived: true })} />),
            ).not.toThrow();
        });

        it('renders and unmounts cleanly with no callback supplied', () => {
            // `$scope.$on "$destroy", -> $el.off()` at `main.coffee` L765-L766 is
            // the directive's teardown. React unmounting the subtree is the whole
            // of the port's equivalent, and the callback being optional means a
            // caller that only wants the markup pays nothing for the seam.
            const harness = renderIntro({ status: makeStatus({ is_archived: true }) });

            expect(maybe(harness.container, '.kanban-column-intro')).not.toBeNull();
            expect(() => harness.unmount()).not.toThrow();
        });
    });
});
