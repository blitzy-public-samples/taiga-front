/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * AddNewUs.test.tsx -- co-located spec for the backlog add-story action pair
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator is a `jest.fn()` double, no browser binary is launched, no network
 * is touched, and nothing here refers to generated build output. `dist/` can be
 * deleted and `CHROME_BIN` unset and this file still runs.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./AddNewUs.tsx`. The unit is presentational, so every assertion is about
 * EMITTED MARKUP -- element names, class names and their ORDER, the `variant`
 * attribute, nesting, sibling order, text content, the accessible name -- plus the
 * two click callbacks.
 *
 * Class names and attributes are asserted rather than computed style because the
 * migration preserves the existing class contract verbatim (rule T1) and the
 * appearance comes wholly from UNEDITED stylesheets, which jsdom does not parse. An
 * assertion on computed style would test nothing here; an assertion on the
 * class-and-attribute contract tests exactly what can break.
 *
 * ⭐ THE HARNESS DEPARTS FROM THE ONE SKETCHED FOR THIS FILE, DELIBERATELY
 * ----------------------------------------------------------------------
 * That sketch wrapped every render in an `AngularBridgeProvider` because the
 * component was expected to call `useTranslate()` itself. The LANDED component does
 * not: it takes its translator as the required `t` prop and calls no hook at all
 * (`./AddNewUs.tsx:250`-`:274` records why -- a leaf that resolves a service
 * acquires a latent AngularJS provider requirement and stops being renderable as a
 * pure function of its props, which is precisely the presentational/container split
 * requirement I9's coverage gate depends on). So the default render here is BARE,
 * and this file is the evidence that the split actually holds: were a future edit to
 * reach for `useTranslate()` inside the component, every bare case below would fail
 * with a missing-provider error rather than silently acquiring a dependency.
 *
 * The prop is only half the contract, though. In production the owner obtains that
 * translator FROM `useTranslate()`, so a spec that never does more than pass a
 * hand-written double proves the prop is forwarded while proving nothing about the
 * wiring the screens actually use. The final section therefore mounts the whole path
 * once -- `AngularBridgeProvider` -> injector double -> `useTranslate` -> the `t`
 * prop -> the rendered copy -- through the MANDATED `mockInjector` seam. That keeps
 * the sketched harness's intent, resolves `$translate` exactly as production
 * resolves it, and needs no cast or compiler-suppression pragma to do it. The same
 * two-part shape is used by the sibling leaf's spec, `../shared/Svg.test.tsx`
 * (sections 7 and 8). AngularJS itself is never loaded on either path: what sits
 * under the provider is a DOUBLE of the injector.
 *
 * THE THREE CONTRACTS THAT WOULD FAIL SILENTLY IN PRODUCTION, SO THEY ARE PINNED
 * ------------------------------------------------------------------------------
 *  1. `variant` must reach the DOM as a REAL attribute, because `buttons-next.scss`
 *     selects `.btn-small[variant='primary']` (`:54`) and
 *     `.btn-icon[variant='secondary']` (`:85`). Lose it -- or move it into the
 *     `data-*` namespace -- and the buttons keep their shape but lose their colours,
 *     with nothing throwing.
 *  2. The class attribute must START with `btn-`, because `layout/backlog.scss:72`
 *     reads `[class^='btn-']:not(:last-child)` and `^=` anchors to the start of the
 *     whole attribute VALUE. That rule is the only source of the 16 px gap between
 *     the two buttons, so the ORDER is asserted, not merely the presence of both
 *     classes.
 *  3. Denied permission must HIDE, never unmount, because `tgCheckPermission`
 *     (`app/coffee/modules/common.coffee:93`) only toggles a class. A spec that
 *     merely checked "the button is not visible" would pass against a wrong
 *     implementation that removed the node, so PRESENCE is asserted explicitly in
 *     the denied case.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 *  - `Svg`'s own internals (the two-`<title>` contract, fill handling, `className`
 *    forwarding), which belong to `../shared/Svg.test.tsx`. What IS asserted here is
 *    the CALL SITE: that the `tg-svg` host survives -- the stylesheets target it as
 *    an element -- and that the correct sprite fragment is referenced;
 *  - how `canAddUs` is computed. `canEdit` is `!isArchived() && hasPermission(...)`
 *    and per requirement I9 that belongs to the screen; this unit receives a boolean;
 *  - what the click handlers go on to do. `'standard'` and `'bulk'` open two
 *    RETAINED AngularJS lightboxes; this unit only reports the intent.
 * ========================================================================== */

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';
import { AddNewUs } from './AddNewUs';
import type { AddNewUsKind, AddNewUsProps } from './AddNewUs';

/* ==========================================================================
 * FIXTURES -- every value verified against the repository, none invented
 * ========================================================================== */

/** The two keys the source reads (`addnewus.jade:15` and `:21`). */
const ADD_KEY = 'US.ADD';
const ADD_BULK_KEY = 'US.ADD_BULK';

/**
 * The values the shipped English locale holds for those keys, VERBATIM.
 *
 * `US.ADD` is LOWER CASE in `app/locales/taiga/locale-en.json` even though the
 * button reads as upper case on screen, because `%button` applies
 * `text-transform: uppercase` (`buttons-next.scss:15`). Asserting the raw lower-case
 * value is precisely what catches a component that "helpfully" upper-cased the
 * string itself and thereby broke every locale with different casing rules.
 */
const ADD_COPY = 'user story';
const ADD_BULK_COPY = 'Add some new user stories in bulk';

/** The icon host the stylesheets target as an ELEMENT, not as a class. */
const ICON_HOST = 'tg-svg';

/** The class selectors the stylesheets themselves use, restated once. */
const PRIMARY_SELECTOR = 'button.btn-small';
const SECONDARY_SELECTOR = 'button.btn-icon';

/** The class the retired permission directive toggled, and nothing else. */
const HIDDEN_CLASS = 'hidden';

/**
 * The translator's own signature, so a double cannot drift from the prop it feeds.
 *
 * Spelled out as a `jest.Mock` rather than plain `TranslateFn` so the mock members
 * (`mock.calls`, the matchers) stay available while the value remains directly
 * assignable to `TranslateFn` -- no cast is needed anywhere in this file.
 */
type TranslateDouble = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

/** The click reporter's signature, likewise pinned to the prop it feeds. */
type AddNewUsCallbackDouble = jest.Mock<void, [AddNewUsKind]>;

/* ==========================================================================
 * DOUBLES
 *
 * A single module-level `mocks` object, following the incumbent suite's own
 * convention (`app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * keeps one `mocks = {}` and fills it from `_mockX` factories) -- with that suite's
 * stub helper replaced by `jest.fn()`, which is the only double this suite uses.
 *
 * `jest.config.js` sets BOTH `clearMocks: true` and `restoreMocks: true`, so the
 * runner clears recorded calls between cases on our behalf. That is what makes a
 * module-level object safe here, and it is also why this file invokes neither of
 * Jest's global reset helpers by hand: doing so would duplicate the configured
 * behaviour and would mask a future change to it.
 *
 * ⭐ WHY `_mockTranslate()` RE-INSTALLS THE IMPLEMENTATION ON EVERY RENDER.
 * `clearMocks` clears recorded CALLS only -- it does not remove an implementation
 * (that would be `resetMocks`), and `restoreMocks` acts on `jest.spyOn` spies rather
 * than on a plain `jest.fn()`. Measured under this exact configuration: after the
 * reset a mock reports zero calls but STILL returns whatever implementation the
 * previous case installed. One case below deliberately overrides the translator to
 * return markup, so without a per-render re-install that override would leak
 * forwards and quietly weaken every later assertion about the rendered copy.
 * Re-installing is therefore load-bearing, not defensive tidying.
 * ========================================================================== */

const mocks: {
    translate: TranslateDouble;
    onAddNewUs: AddNewUsCallbackDouble;
} = {
    translate: jest.fn<string, [string, (Record<string, unknown> | undefined)?]>(),
    onAddNewUs: jest.fn<void, [AddNewUsKind]>(),
};

/**
 * Teaches the translator double the two real keys and MARKS anything else.
 *
 * An unexpected lookup therefore shows up in the rendered output as
 * `UNEXPECTED:<key>` instead of looking plausible, which is what lets the "renders
 * nothing that looks like an unresolved key" case below be meaningful.
 */
function _mockTranslate(): void {
    mocks.translate.mockImplementation((key: string): string => {
        if (key === ADD_KEY) {
            return ADD_COPY;
        }

        if (key === ADD_BULK_KEY) {
            return ADD_BULK_COPY;
        }

        return `UNEXPECTED:${key}`;
    });
}

/* ==========================================================================
 * HARNESS
 * ========================================================================== */

interface Harness {
    /** The `.new-us` root. */
    readonly root: HTMLElement;

    /** The add-story button, located POSITIONALLY (first child). */
    readonly primary: HTMLButtonElement;

    /** The bulk-add button, located POSITIONALLY (second child). */
    readonly secondary: HTMLButtonElement;

    /**
     * The same two buttons located by the CLASS SELECTORS the stylesheets use.
     *
     * Kept alongside the positional handles rather than instead of them: the
     * positional pair is what lets sibling ORDER be asserted and keeps the class
     * assertions from being circular, while this pair independently proves that
     * `button.btn-small` and `button.btn-icon` -- the selectors
     * `buttons-next.scss` and `layout/backlog.scss` actually match on -- each
     * resolve to exactly one element and to the expected one.
     */
    readonly bySelector: {
        readonly primary: Element | null;
        readonly secondary: Element | null;
    };

    /** The rendered container, for whole-subtree queries. */
    readonly container: HTMLElement;
}

/**
 * Renders the unit bare -- no provider, no injector, no root-scope double -- and
 * hands back the root plus both buttons.
 *
 * @param overrides - props to replace on top of the permitted-member default.
 */
function renderAddNewUs(overrides: Partial<AddNewUsProps> = {}): Harness {
    _mockTranslate();

    const props: AddNewUsProps = {
        canAddUs: true,
        onAddNewUs: mocks.onAddNewUs,
        t: mocks.translate,
        ...overrides,
    };

    const { container } = render(<AddNewUs {...props} />);

    const root = container.firstElementChild;

    if (!(root instanceof HTMLElement)) {
        throw new Error('AddNewUs rendered no root element.');
    }

    const [primary, secondary] = Array.from(root.children);

    if (!(primary instanceof HTMLButtonElement) || !(secondary instanceof HTMLButtonElement)) {
        throw new Error('AddNewUs did not render two button elements.');
    }

    return {
        root,
        primary,
        secondary,
        bySelector: {
            primary: container.querySelector(PRIMARY_SELECTOR),
            secondary: container.querySelector(SECONDARY_SELECTOR),
        },
        container,
    };
}

/* ==========================================================================
 * THE MANDATED BRIDGE SEAM -- used by the final section alone
 *
 * See the file header for why this exists alongside the bare harness rather than
 * replacing it.
 * ========================================================================== */

/**
 * The AngularJS name `useTranslate` resolves for its language-change listener,
 * restated here because `mockInjector` cannot express it: that helper's map is
 * `Partial<AngularServices>`, and the root scope is deliberately absent from the
 * allow-list, so React can never reach the digest trio or either event raiser
 * (`../bridge/useAngularService.ts:614`-`:644`).
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

type BroadcastListener = (event: unknown, payload?: unknown) => void;

/**
 * `$rootScope`, reduced to the single member the bridge is permitted to touch.
 *
 * `useTranslate` subscribes to `$translateChangeEnd` on mount and expects `$on` to
 * hand back a deregistration function. Nothing here ever emits: this file tests the
 * add-story MARKUP, and live language switching is covered where it belongs, in
 * `../bridge/useTranslate.test.tsx`. Supplying the registrar keeps that hook on its
 * normal path, so it writes no warning and enters no degraded branch that would then
 * have to be silenced.
 */
function createRootScopeDouble(): { $on: jest.Mock<() => void, [string, BroadcastListener]> } {
    return {
        $on: jest.fn<() => void, [string, BroadcastListener]>(
            (): (() => void) => (): void => undefined,
        ),
    };
}

/**
 * A `$translate` double satisfying the WHOLE service contract the bridge declares
 * (`../bridge/useAngularService.ts:545`-`:551`), so the mock cannot be a narrower
 * object than the real service the hook resolves.
 */
function createTranslateServiceDouble(): MockServiceMap['$translate'] {
    return {
        instant: mocks.translate,
        preferredLanguage: jest.fn((): string => 'en'),
        getTranslationTable: jest.fn((): Record<string, unknown> => ({})),
    };
}

/**
 * Extends the mandated `mockInjector` with the one name its typed map cannot carry.
 *
 * The `$translate` half goes through `mockInjector` ITSELF, so the allow-listed
 * service is resolved exactly as production resolves it and an unsupplied name still
 * raises that helper's own descriptive diagnostic rather than resolving to a silent
 * `undefined`. That throwing behaviour is the point of using the helper here: it
 * surfaces an accidental extra service dependency the component might grow.
 */
function createExtendedInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>>,
): AngularInjector {
    const mandatedSeam = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            const supplied = extended.get(name);

            if (supplied !== undefined) {
                return supplied as T;
            }

            return mandatedSeam.get<T>(name);
        },
    };
}

/**
 * The production wiring in miniature: an OWNER that resolves the translator through
 * the bridge and hands it to `AddNewUs` as a prop, which is what the real call site
 * -- the backlog screen -- does now that the component takes no hook of its own.
 */
function BridgedAddNewUs(props: Omit<AddNewUsProps, 't'>): ReactElement {
    const t: TranslateFn = useTranslate();

    return <AddNewUs {...props} t={t} />;
}

/** Renders {@link BridgedAddNewUs} under a provider carrying the injector double. */
function renderThroughBridge(canAddUs = true): { root: HTMLElement } {
    _mockTranslate();

    const { container } = render(
        <BridgedAddNewUs canAddUs={canAddUs} onAddNewUs={mocks.onAddNewUs} />,
        {
            wrapper: withMockInjector(
                createExtendedInjector(
                    { $translate: createTranslateServiceDouble() },
                    { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
                ),
            ),
        },
    );

    const root = container.firstElementChild;

    if (!(root instanceof HTMLElement)) {
        throw new Error('AddNewUs rendered no root element through the bridge.');
    }

    return { root };
}

/* ==========================================================================
 * SPECS
 * ========================================================================== */

describe('AddNewUs', () => {
    /* ----------------------------------------------------------------------
     * 1 Structure -- the class and nesting contract (rule T1)
     * -------------------------------------------------------------------- */

    describe('structure and class contract (T1)', () => {
        it('renders a single DIV root whose class attribute is exactly "new-us"', () => {
            const { root } = renderAddNewUs();

            expect(root.tagName).toBe('DIV');

            // STRING EQUALITY, not `toHaveClass`: a stray extra class would sail
            // through a membership check while changing what the cascade matches.
            expect(root.className).toBe('new-us');
        });

        it('renders exactly two element children, both of them BUTTON', () => {
            const { root } = renderAddNewUs();

            // Exactly two: the source declares no third control, and inventing one
            // would be a feature change (rule T10).
            expect(root.children).toHaveLength(2);
            expect(Array.from(root.children).map((child) => child.tagName)).toEqual([
                'BUTTON',
                'BUTTON',
            ]);

            // Real `<button>` elements rather than clickable containers, so both are
            // keyboard-operable and focusable with no ARIA scaffolding at all.
            expect(root.children[0]).toBeInstanceOf(HTMLButtonElement);
            expect(root.children[1]).toBeInstanceOf(HTMLButtonElement);
        });

        it('puts the primary add button first and the icon-only bulk button second', () => {
            const { primary, secondary } = renderAddNewUs();

            // `startsWith`, because `layout/backlog.scss:72` anchors `[class^='btn-']`
            // to the START of the whole class attribute value. Asserted here in the
            // permitted state and again in the denied state, where a naive
            // implementation would prepend `hidden` and break the anchor.
            expect(primary.className.startsWith('btn-small')).toBe(true);
            expect(secondary.className.startsWith('btn-icon')).toBe(true);
        });

        it('resolves each button through the class selector the stylesheets use', () => {
            const { primary, secondary, bySelector, container } = renderAddNewUs();

            // Independent of the positional lookup: this is the selector
            // `buttons-next.scss` and `layout/backlog.scss` actually match on, so it
            // is asserted to resolve to exactly one element -- and to the same one.
            expect(container.querySelectorAll(PRIMARY_SELECTOR)).toHaveLength(1);
            expect(container.querySelectorAll(SECONDARY_SELECTOR)).toHaveLength(1);
            expect(bySelector.primary).toBe(primary);
            expect(bySelector.secondary).toBe(secondary);
        });

        it('nests an icon host then span.text in the primary, and only an icon host in the bulk', () => {
            const { primary, secondary } = renderAddNewUs();

            // IN ORDER. `addnewus.jade:14`-`:15` puts the glyph before the label, and
            // `.btn-small tg-svg { margin-right: .5rem }` (`buttons-next.scss:69`)
            // spaces them in that direction only.
            expect(Array.from(primary.children).map((child) => child.tagName.toLowerCase())).toEqual(
                [ICON_HOST, 'span'],
            );
            expect(primary.children[1]).toHaveClass('text');

            // The bulk button is icon-ONLY (`addnewus.jade:23`): one child, no label.
            expect(Array.from(secondary.children).map((child) => child.tagName.toLowerCase())).toEqual(
                [ICON_HOST],
            );
            expect(secondary.querySelector('span')).toBeNull();
        });

        it('emits variant as a REAL DOM attribute on both buttons', () => {
            const { primary, secondary } = renderAddNewUs();

            // Load-bearing styling, not metadata: `buttons-next.scss:54` selects
            // `.btn-small[variant='primary']` (the mint `$color-solid-primary` fill)
            // and `:85` selects `.btn-icon[variant='secondary']` (the grey
            // `$color-gray400` fill). A non-matching attribute selector fails QUIETLY,
            // so losing or renaming this attribute would strip both buttons of their
            // colours with nothing throwing (rule T1).
            expect(primary.getAttribute('variant')).toBe('primary');
            expect(secondary.getAttribute('variant')).toBe('secondary');
        });

        it('does not substitute a data-variant attribute, which would match no selector', () => {
            const { primary, secondary } = renderAddNewUs();

            // Moving the attribute into the `data-*` namespace type-checks and renders,
            // and then matches NEITHER selector above -- worse than a cast, because
            // nothing fails at all (rule T1).
            expect(primary.hasAttribute('data-variant')).toBe(false);
            expect(secondary.hasAttribute('data-variant')).toBe(false);
        });

        it('emits no explicit type attribute on either button', () => {
            const { primary, secondary } = renderAddNewUs();

            // The Jade emits bare `button` elements (`addnewus.jade:9` and `:17`), so
            // the DOM default applies; adding `type="button"` would be a functional
            // change (rule T10). It is also inert here -- `backlog.jade` places
            // `.backlog-header-options` outside every `form`, so there is nothing for a
            // submit-type button to submit.
            expect(primary.getAttribute('type')).toBeNull();
            expect(secondary.getAttribute('type')).toBeNull();
            expect(primary.type).toBe('submit');
            expect(secondary.type).toBe('submit');
        });

        it('emits no inline style on the root or either button', () => {
            const { root, primary, secondary } = renderAddNewUs();

            // Every visual property comes from the unedited stylesheets; this component
            // authors no CSS and inlines none (gap G-DS-4).
            expect(root.hasAttribute('style')).toBe(false);
            expect(primary.hasAttribute('style')).toBe(false);
            expect(secondary.hasAttribute('style')).toBe(false);
        });
    });

    /* ----------------------------------------------------------------------
     * 2 Icons -- the sprite contract (rules T1 and T3)
     * -------------------------------------------------------------------- */

    describe('icons (T1/T3)', () => {
        it('gives the primary button the add glyph, classed "icon icon-add"', () => {
            const { primary } = renderAddNewUs();

            const svg = primary.querySelector('svg');

            expect(svg).not.toBeNull();

            // `getAttribute('class')`, never `svg.className`: on an SVGElement the
            // latter is an SVGAnimatedString object rather than a string, so comparing
            // it to a string would silently never match.
            expect(svg?.getAttribute('class')).toBe('icon icon-add');
        });

        it('references the add sprite symbol on BOTH href and xlink:href', () => {
            const { primary } = renderAddNewUs();

            const use = primary.querySelector('use');

            // A same-document fragment reference into the sprite inlined at
            // `app/index.jade:96`, so no new asset is introduced (rule T3) and light DOM
            // is required for it to resolve at all (requirement I6). Both spellings are
            // emitted: `xlink:href` for the older engines the incumbent supports, `href`
            // for current ones.
            expect(use?.getAttribute('href')).toBe('#icon-add');
            expect(use?.getAttribute('xlink:href')).toBe('#icon-add');
        });

        it('gives the bulk button the bulk glyph, classed "icon icon-bulk"', () => {
            const { secondary } = renderAddNewUs();

            const svg = secondary.querySelector('svg');
            const use = secondary.querySelector('use');

            expect(svg?.getAttribute('class')).toBe('icon icon-bulk');
            expect(use?.getAttribute('href')).toBe('#icon-bulk');
            expect(use?.getAttribute('xlink:href')).toBe('#icon-bulk');
        });

        it('wraps each glyph in a tg-svg element, two in total', () => {
            const { container, primary, secondary } = renderAddNewUs();

            // The `<tg-svg>` wrapper is MANDATORY, not incidental: `buttons-next.scss`
            // targets it as an ELEMENT -- `%button { & tg-svg { fill: currentColor } }`
            // (`:31`) and `.btn-small { tg-svg { margin-right: .5rem } }` (`:69`). Drop
            // the host and the glyph loses both its colour and its spacing. Both symbol
            // ids are defined exactly once in `app/svg/sprite.svg`, so rule T3 holds at
            // zero new assets.
            expect(container.querySelectorAll(ICON_HOST)).toHaveLength(2);
            expect(primary.querySelectorAll(ICON_HOST)).toHaveLength(1);
            expect(secondary.querySelectorAll(ICON_HOST)).toHaveLength(1);

            // The host is the OUTERMOST node of each icon: the stylesheet rules above
            // are descendant rules rooted at it, so an `<svg>` hoisted out of the host
            // would match neither.
            expect(primary.children[0]?.tagName.toLowerCase()).toBe(ICON_HOST);
            expect(secondary.children[0]?.tagName.toLowerCase()).toBe(ICON_HOST);
        });

        it('renders no title inside either glyph, since neither is given one', () => {
            const { container } = renderAddNewUs();

            // `addnewus.jade:14` and `:23` pass only `svg-icon`, no `svg-title`. The
            // primary button's label already names it and the bulk button's `aria-label`
            // does; a third name would be a feature change (rule T10).
            expect(container.querySelectorAll('title')).toHaveLength(0);
        });
    });

    /* ----------------------------------------------------------------------
     * 3 Copy and translation
     * -------------------------------------------------------------------- */

    describe('copy and translation', () => {
        it('renders the label in span.text as the raw LOWER-CASE locale value', () => {
            const { primary } = renderAddNewUs();

            const label = primary.querySelector('span.text');

            expect(label).not.toBeNull();

            // Lower case, exactly as `locale-en.json` holds it. The upper case seen on
            // screen is `%button { text-transform: uppercase }`
            // (`buttons-next.scss:15`) -- a paint-time decision owned by the stylesheet.
            // Upper-casing here, or hardcoding a pre-upper-cased 'USER STORY', would
            // produce identical English while silently corrupting every locale whose
            // casing rules differ.
            expect(label?.textContent).toBe(ADD_COPY);
            expect(label?.textContent).not.toBe(ADD_COPY.toUpperCase());
        });

        it('looks up exactly the two source keys, with no interpolation values', () => {
            renderAddNewUs();

            expect(mocks.translate).toHaveBeenCalledWith(ADD_KEY);
            expect(mocks.translate).toHaveBeenCalledWith(ADD_BULK_KEY);

            // Both are called with a SINGLE argument: the source binds no interpolation
            // values either (`addnewus.jade:15` and `:21`).
            for (const call of mocks.translate.mock.calls) {
                expect(call).toHaveLength(1);
            }

            // And nothing else is looked up, so no key crept in unnoticed.
            expect(mocks.translate.mock.calls.map(([key]) => key).sort()).toEqual(
                [ADD_BULK_KEY, ADD_KEY].sort(),
            );
        });

        it('names the bulk button with aria-label, reachable by its accessible name', () => {
            const { secondary } = renderAddNewUs();

            expect(secondary.getAttribute('aria-label')).toBe(ADD_BULK_COPY);

            // The one accessible query that genuinely applies on this screen. The bulk
            // button is icon-only, so `aria-label` is its ONLY accessible name -- and
            // resolving it back to `button.btn-icon` proves the name landed on the right
            // element rather than merely existing somewhere in the subtree.
            const byAccessibleName = screen.getByLabelText(ADD_BULK_COPY);

            expect(byAccessibleName).toBe(secondary);
            expect(byAccessibleName.matches(SECONDARY_SELECTOR)).toBe(true);
        });

        it('adds no aria-label to the primary button and no title to either', () => {
            const { primary, secondary } = renderAddNewUs();

            // NEGATIVE PATH. The primary button has visible text, so the source gives it
            // no `aria-label`; adding one would override the visible label for screen
            // readers. Neither button carries a `title` in `addnewus.jade`, so neither
            // may grow a tooltip here. Both additions would be rule T10 changes.
            expect(primary.hasAttribute('aria-label')).toBe(false);
            expect(primary.hasAttribute('title')).toBe(false);
            expect(secondary.hasAttribute('title')).toBe(false);
        });

        it('renders nothing that looks like an unresolved key', () => {
            const { root } = renderAddNewUs();

            // The double marks every key it was not taught, so an extra or misspelled
            // lookup would surface here rather than looking plausible.
            expect(root.textContent).not.toContain('UNEXPECTED:');
            expect(root.textContent).toBe(ADD_COPY);
        });

        it('renders the translated copy as TEXT, never as markup', () => {
            _mockTranslate();
            mocks.translate.mockImplementation((): string => '<em>injected</em>');

            const { container } = render(
                <AddNewUs canAddUs onAddNewUs={mocks.onAddNewUs} t={mocks.translate} />,
            );

            // React escapes text children by default, and this asserts the default was
            // not defeated. The screens now render user-authored content, so the
            // guarantee is worth a failing test rather than an assumption (AAP 0.8.2).
            expect(container.querySelector('em')).toBeNull();
            expect(container.querySelector('span.text')?.textContent).toBe('<em>injected</em>');
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐⭐ 4 Permission gate -- the element ALWAYS renders
     *      (tgCheckPermission semantics)
     * -------------------------------------------------------------------- */

    describe('permission gate -- the element ALWAYS renders (tgCheckPermission semantics)', () => {
        it('leaves both class attributes exactly the base class when permitted', () => {
            const { primary, secondary } = renderAddNewUs({ canAddUs: true });

            expect(primary.classList.contains(HIDDEN_CLASS)).toBe(false);
            expect(secondary.classList.contains(HIDDEN_CLASS)).toBe(false);

            // String equality again, so a stray class cannot slip in beside the base one.
            expect(primary.className).toBe('btn-small');
            expect(secondary.className).toBe('btn-icon');
        });

        it('keeps BOTH buttons mounted when permission is denied, only adding hidden', () => {
            const { container, primary, secondary } = renderAddNewUs({ canAddUs: false });

            // ⭐ THE ELEMENT ALWAYS EXISTS. `tgCheckPermission`
            // (`app/coffee/modules/common.coffee:88`-`:119`) calls `$el.addClass('hidden')`
            // in its link function and removes it again only once
            // `projectService.canEdit(permission)` is true; it NEVER detaches the node.
            // Conditional rendering -- `{canAddUs && <button/>}` -- would therefore be a
            // behaviour change (rule T10) and would break every stylesheet rule and
            // end-to-end selector that expects the node present but hidden.
            //
            // Asserted as a DOM query rather than as "not visible", because a wrong
            // implementation that removed the node would pass a visibility check.
            expect(container.querySelectorAll('button')).toHaveLength(2);
            expect(primary).toBeInTheDocument();
            expect(secondary).toBeInTheDocument();

            expect(primary.classList.contains(HIDDEN_CLASS)).toBe(true);
            expect(secondary.classList.contains(HIDDEN_CLASS)).toBe(true);
        });

        it('⭐ APPENDS hidden AFTER the btn- class so [class^="btn-"] still matches', () => {
            const { primary, secondary } = renderAddNewUs({ canAddUs: false });

            // ⭐ ORDER, not just membership. `layout/backlog.scss:72` reads
            // `.new-us > [class^='btn-']:not(:last-child) { margin-right: 1rem }`, and
            // `^=` anchors to the START of the whole class attribute VALUE:
            // `"btn-small hidden"` matches, `"hidden btn-small"` does not. That single
            // rule is the only source of the 16 px gap between the two buttons, so
            // prepending would silently collapse them together.
            expect(primary.className).toBe('btn-small hidden');
            expect(secondary.className).toBe('btn-icon hidden');

            expect(primary.className.startsWith('btn-')).toBe(true);
            expect(secondary.className.startsWith('btn-')).toBe(true);
        });

        it('expresses denial through the class alone -- not disabled, not ARIA', () => {
            const { primary, secondary } = renderAddNewUs({ canAddUs: false });

            // The retired directive set neither, and the design frame shows no disabled
            // treatment. So the buttons stay reachable and operable while hidden; adding
            // `disabled` or `aria-disabled` would be a rule T10 change.
            expect(primary.hasAttribute('disabled')).toBe(false);
            expect(secondary.hasAttribute('disabled')).toBe(false);
            expect(primary).not.toBeDisabled();
            expect(secondary).not.toBeDisabled();
            expect(primary.hasAttribute('aria-disabled')).toBe(false);
            expect(secondary.hasAttribute('aria-disabled')).toBe(false);
        });

        it('keeps every other part of the contract intact when permission is denied', () => {
            const { container, primary, secondary } = renderAddNewUs({ canAddUs: false });

            // Hiding changes the class attribute and NOTHING else: the variant
            // attributes, the icons and the accessible name all survive, so restoring
            // permission restores a fully styled, fully named control.
            expect(primary.getAttribute('variant')).toBe('primary');
            expect(secondary.getAttribute('variant')).toBe('secondary');
            expect(container.querySelectorAll(ICON_HOST)).toHaveLength(2);
            expect(secondary.getAttribute('aria-label')).toBe(ADD_BULK_COPY);
        });
    });

    /* ----------------------------------------------------------------------
     * 5 Callbacks
     * -------------------------------------------------------------------- */

    describe('callbacks', () => {
        it('reports the standard flow exactly once when the primary button is clicked', () => {
            const { primary } = renderAddNewUs();

            fireEvent.click(primary);

            expect(mocks.onAddNewUs).toHaveBeenCalledTimes(1);
            expect(mocks.onAddNewUs).toHaveBeenCalledWith('standard');
        });

        it('reports the bulk flow exactly once when the bulk button is clicked', () => {
            const { secondary } = renderAddNewUs();

            fireEvent.click(secondary);

            expect(mocks.onAddNewUs).toHaveBeenCalledTimes(1);
            expect(mocks.onAddNewUs).toHaveBeenCalledWith('bulk');
        });

        it('does not invoke the callback while merely rendering', () => {
            renderAddNewUs();

            expect(mocks.onAddNewUs).not.toHaveBeenCalled();
        });

        it('reports each flow independently across repeated clicks', () => {
            const { primary, secondary } = renderAddNewUs();

            fireEvent.click(primary);
            fireEvent.click(secondary);
            fireEvent.click(primary);

            expect(mocks.onAddNewUs).toHaveBeenCalledTimes(3);
            expect(mocks.onAddNewUs.mock.calls.map(([kind]) => kind)).toEqual([
                'standard',
                'bulk',
                'standard',
            ]);
        });

        it('STILL reports clicks when permission is denied', () => {
            // ⭐ ASSERTED DELIBERATELY, so nobody "hardens" this later. The retired
            // directive hid the control with a class and did NOT detach a handler or
            // disable the element, so a hidden button remains wired. Guarding the ACTION
            // is the screen's job; inventing a guard here would be a behaviour change
            // (rule T10). If a future reader disagrees, the correct response is a Drift
            // Register entry -- not a quiet change to this component.
            const { primary, secondary } = renderAddNewUs({ canAddUs: false });

            fireEvent.click(primary);
            fireEvent.click(secondary);

            expect(mocks.onAddNewUs).toHaveBeenCalledTimes(2);
            expect(mocks.onAddNewUs.mock.calls.map(([kind]) => kind)).toEqual([
                'standard',
                'bulk',
            ]);
        });
    });

    /* ----------------------------------------------------------------------
     * 6 Presentational purity (requirement I9)
     * -------------------------------------------------------------------- */

    describe('presentational purity (I9)', () => {
        it('renders identical markup for identical props', () => {
            const first = renderAddNewUs();
            const firstMarkup = first.root.outerHTML;

            const second = renderAddNewUs();

            // Asserted against a value captured in this same case, NOT against a stored
            // snapshot: the suite takes no snapshots, so a markup change has to be made
            // deliberately in a spec rather than absorbed by re-recording a file.
            expect(second.root.outerHTML).toBe(firstMarkup);
        });

        it('needs no AngularJS provider, injector or root scope to render', () => {
            _mockTranslate();

            // ⭐ THE PRESENTATIONAL/CONTAINER SPLIT, ASSERTED. Every case above already
            // renders bare, but this states the property outright: the component is a
            // pure function of its props, so it mounts with nothing above it. Were a
            // future edit to reach for `useTranslate()` inside the component, this would
            // fail with the bridge's own missing-provider diagnostic instead of the
            // dependency being acquired unnoticed.
            expect(() =>
                render(<AddNewUs canAddUs onAddNewUs={mocks.onAddNewUs} t={mocks.translate} />),
            ).not.toThrow();
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐ 7 The production wiring, through the MANDATED injector seam
     * -------------------------------------------------------------------- */

    describe('the production wiring, through the MANDATED injector seam', () => {
        it('renders the same copy when the translator comes from useTranslate()', () => {
            const { root } = renderThroughBridge();

            // The whole path in one case: `AngularBridgeProvider` -> injector double ->
            // `useTranslate` -> the `t` prop -> the rendered copy. Passing a hand-written
            // double everywhere else proves the prop is forwarded; this proves the WIRING
            // the backlog screen actually uses resolves `$translate` and produces a
            // `TranslateFn` the component accepts, with no cast at the seam.
            expect(root.querySelector('span.text')?.textContent).toBe(ADD_COPY);
            expect(root.querySelector(SECONDARY_SELECTOR)?.getAttribute('aria-label')).toBe(
                ADD_BULK_COPY,
            );

            // Resolved through the real service member, `$translate.instant`, and both
            // keys reach it.
            //
            // Asserted on the KEYS rather than on the whole argument list, because the
            // arity legitimately differs between the two paths and pinning it here would
            // pin an implementation detail of the hook rather than of this component: the
            // component calls `t(key)` with one argument, and `useTranslate`'s wrapper
            // then forwards `(key, interpolateParams)` to `instant`, materialising the
            // absent second parameter as an explicit `undefined`. Both are correct --
            // `$translate.instant`'s own signature makes the parameter optional
            // (`../bridge/useAngularService.ts:546`) -- so the one-argument form is
            // asserted where it belongs, against the prop, in the copy section above.
            expect(mocks.translate.mock.calls.map(([key]) => key).sort()).toEqual(
                [ADD_BULK_KEY, ADD_KEY].sort(),
            );
        });

        it('keeps the whole class, variant and permission contract through the bridge', () => {
            const { root } = renderThroughBridge(false);

            // The bridge changes where the translator comes from and nothing else, so the
            // contract pinned above must survive unchanged on this path too.
            expect(root.className).toBe('new-us');
            expect(root.querySelector(PRIMARY_SELECTOR)?.className).toBe('btn-small hidden');
            expect(root.querySelector(SECONDARY_SELECTOR)?.className).toBe('btn-icon hidden');
            expect(root.querySelector(PRIMARY_SELECTOR)?.getAttribute('variant')).toBe('primary');
            expect(root.querySelectorAll(ICON_HOST)).toHaveLength(2);
        });

        it('resolves ONLY $translate and the language-event host from the injector', () => {
            const get = jest.fn<unknown, [string]>();
            const seam = createExtendedInjector(
                { $translate: createTranslateServiceDouble() },
                { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
            );

            get.mockImplementation((name: string): unknown => seam.get(name));

            _mockTranslate();
            render(<BridgedAddNewUs canAddUs onAddNewUs={mocks.onAddNewUs} />, {
                wrapper: withMockInjector({ get: <T,>(name: string): T => get(name) as T }),
            });

            // The component itself consumes NO service -- requirement I9 -- so the only
            // names reaching the injector are the two `useTranslate` needs. A component
            // that grew a data dependency would show up here as a third name.
            expect([...new Set(get.mock.calls.map(([name]) => name))].sort()).toEqual(
                ['$rootScope', '$translate'].sort(),
            );
        });

        it("raises mockInjector's own diagnostic for a service the spec did not supply", () => {
            // The reason the mandated helper is used rather than a bare object literal:
            // an unsupplied name throws a descriptive error
            // (`../bridge/mockInjector.ts:29`-`:47`) instead of resolving to `undefined`,
            // so an accidental extra service dependency surfaces immediately.
            expect(() => mockInjector({}).get('$translate')).toThrow(/mockInjector/);
            expect(() => mockInjector({}).get('$translate')).toThrow(/\$translate/);
        });
    });
});
