/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * Svg.test.tsx -- the co-located spec for the React `tgSvg` replacement.
 * ==========================================================================
 *
 * What this file is actually for. `Svg.tsx` reproduces an AngularJS template
 * whose every detail is load-bearing for CSS that must not be edited (rule T1)
 * and for a sprite that must not be regenerated (rule T3). Almost every way of
 * getting it wrong is SILENT -- a wrapper element too many, a `className` where
 * a `class` was needed, a `<title>` one level too high, a missing `xlink:href`
 * -- so the assertions below are deliberately structural and attribute-exact
 * rather than behavioural. They fail loudly for exactly the mistakes that would
 * otherwise ship unnoticed.
 *
 * THE ELEVEN RULES THIS FILE PROTECTS, every one of them selecting on the `tg-svg`
 * ELEMENT NAME rather than on a class: `app/styles/layout/backlog.scss:109`;
 * `app/styles/modules/backlog/backlog-table.scss:28`, `:63`, `:72`, `:419`;
 * `app/styles/modules/backlog/sprints.scss:37`, `:42`;
 * `app/styles/modules/kanban/kanban-table.scss:435`, `:484`, `:488`; and
 * `app/modules/components/card/card.scss:189`. The last of those is a
 * DIRECT-CHILD combinator, `& > tg-svg`, which is why section 1 asserts the host's
 * NESTING DEPTH and not merely its existence. None of those files may be edited
 * (rules T1 and T4), so it is the markup that has to hold still.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED, and must not be added later: `role`, `aria-*`,
 * `focusable`, `viewBox`, `width`/`height`, a fallback for an unrecognised fragment
 * id, and error handling. The incumbent directive at
 * `app/coffee/modules/common.coffee:342`-`:363` emits none of them, and rule T10
 * forbids functional or feature change whatsoever, so asserting them would
 * legislate a feature into existence instead of locking the behaviour being
 * migrated. There is no snapshot here either: a snapshot would absorb a regression
 * in the `tg-svg` wrapper or in the `href` pair without a word, which is exactly
 * the class of failure this file exists to catch.
 *
 * Browserless by construction (constraint HR-5): jsdom only, no Playwright
 * import, no browser launch, no network, no dependency on `dist/`. Section 8 does
 * mount the AngularJS bridge, but through a MOCKED injector -- the library itself
 * is never loaded.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from './Svg';
import type { SvgProps } from './Svg';

/* --------------------------------------------------------------------------
 * Doubles and helpers
 * -------------------------------------------------------------------------- */

/** The XLink namespace, for the namespaced half of the `<use>` reference. */
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/**
 * A `$translate` double whose `instant` echoes the key together with whatever
 * interpolation values it received, so a spec can prove BOTH were forwarded
 * rather than just one.
 */
function createTranslateDouble(): {
    instant: jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;
} {
    return {
        instant: jest.fn(
            (key: string, interpolateParams?: Record<string, unknown>): string =>
                interpolateParams === undefined
                    ? `t:${key}`
                    : `t:${key}(${Object.entries(interpolateParams)
                          .map(([name, value]) => `${name}=${String(value)}`)
                          .sort()
                          .join(',')})`,
        ),
    };
}

/* ⭐ WHY `Svg` NEEDS NO PROVIDER, AND WHY ONE SECTION STILL MOUNTS THE REAL SEAM.
 *
 * `Svg` used to resolve translation through a module-private child that called the
 * bridge's translation hook, so a translated-title spec had to stand up an injector
 * carrying `$translate` AND the application root scope -- the latter only because
 * that hook subscribes to the language-change event through it.
 *
 * The translator now arrives as an OPTIONAL PROP, so every case below renders with
 * no wrapper at all unless it says otherwise. That is worth more than the
 * scaffolding it replaces: the most-rendered leaf on both screens no longer carries
 * a latent provider requirement that surfaces only when a caller happens to pass a
 * translation key.
 *
 * The prop is only half the contract, though. In production the owner obtains that
 * translator from `useTranslate()`, so a spec that never does more than pass a
 * hand-written double proves the prop is forwarded while proving nothing about the
 * wiring the screens actually use. Section 8 therefore mounts the whole path once --
 * `AngularBridgeProvider` -> injector double -> `useTranslate` -> the `translate`
 * prop -> `<title>` -- through the MANDATED `mockInjector` seam.
 *
 * The AngularJS library itself is still never loaded, here or in section 8: what
 * sits under the provider is a DOUBLE of the injector, which is the only sanctioned
 * way to reach `$translate` from a suite that must stay browserless, build-free and
 * offline (constraint HR-5).
 */

/** The translator prop's own signature, so the double cannot drift from it. */
type TranslateDouble = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

/** A translator prop double plus the mock behind it. */
function translatorProp(): { translate: TranslateDouble; instant: TranslateDouble } {
    const { instant } = createTranslateDouble();

    return { translate: instant, instant };
}

/* --------------------------------------------------------------------------
 * The mandated bridge seam -- used by section 8 alone
 * -------------------------------------------------------------------------- */

/**
 * The AngularJS name `useTranslate` resolves for its language-change listener,
 * restated here because `mockInjector` cannot express it: that helper's map is
 * `Partial<AngularServices>`, and the root scope is deliberately absent from the
 * allow-list (`app/react/bridge/useAngularService.ts:614`-`:644`).
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

type BroadcastListener = (event: unknown, payload?: unknown) => void;

/**
 * `$rootScope`, reduced to the single member the bridge is permitted to touch.
 *
 * `useTranslate` subscribes to `$translateChangeEnd` on mount and expects `$on` to
 * hand back a deregistration function. Nothing here ever emits: this file tests
 * icon MARKUP, and live language switching is covered where it belongs, in
 * `app/react/bridge/useTranslate.test.tsx`. Supplying the registrar keeps that hook
 * on its normal path, so it writes no warning and enters no degraded branch that
 * would then have to be silenced.
 */
function createRootScopeDouble(): { $on: jest.Mock<() => void, [string, BroadcastListener]> } {
    return {
        $on: jest.fn<() => void, [string, BroadcastListener]>(
            (): (() => void) => (): void => undefined,
        ),
    };
}

/**
 * Extends the mandated `mockInjector` with the one name its typed map cannot carry.
 *
 * The `$translate` half goes through `mockInjector` itself, so the allow-listed
 * service is resolved exactly as production resolves it and an unsupplied name
 * still raises that helper's own descriptive diagnostic rather than a silent
 * `undefined`. The same composition is used by
 * `app/react/bridge/useTranslate.test.tsx:217`-`:230`.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>>,
): AngularInjector {
    const mandatedSeam = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            if (extended.has(name)) {
                return extended.get(name) as T;
            }

            return mandatedSeam.get<T>(name);
        },
    };
}

/**
 * A `$translate` double satisfying the whole service contract the bridge declares
 * (`app/react/bridge/useAngularService.ts:545`-`:551`), so the mock cannot be a
 * narrower object than the real service the hook resolves.
 */
function translateServiceDouble(instant: TranslateDouble): {
    instant: TranslateDouble;
    preferredLanguage: jest.Mock<string, []>;
    getTranslationTable: jest.Mock<Record<string, unknown>, [string]>;
} {
    return {
        instant,
        preferredLanguage: jest.fn((): string => 'en'),
        getTranslationTable: jest.fn((_langKey: string): Record<string, unknown> => ({})),
    };
}

/**
 * The production wiring in miniature: an OWNER that resolves the translator through
 * the bridge and hands it to `Svg` as a prop, which is what every real call site
 * does now that the component takes no hook of its own.
 */
function TranslatedIcon(props: Omit<SvgProps, 'translate'>): ReactElement {
    const t: TranslateFn = useTranslate();

    return <Svg {...props} translate={t} />;
}

/** Renders {@link TranslatedIcon} under a provider carrying the injector double. */
function renderThroughBridge(
    props: Omit<SvgProps, 'translate'>,
    instant: TranslateDouble,
): { host: HTMLElement } {
    const { container } = render(<TranslatedIcon {...props} />, {
        wrapper: withMockInjector(
            createInjector(
                { $translate: translateServiceDouble(instant) },
                { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
            ),
        ),
    });
    const host = container.querySelector('tg-svg');

    if (host === null) {
        throw new Error('Svg rendered no <tg-svg> host element through the bridge.');
    }

    return { host: host as HTMLElement };
}

/**
 * Builds a parent element imperatively and registers it for removal.
 *
 * Two of the specs below need a parent carrying the `variant` attribute of
 * `app/modules/components/card/card.scss:189`, which is not a typed prop of
 * `<button>`, so the element is constructed rather than rendered.
 *
 * `@testing-library/react`'s auto-cleanup only removes containers IT created, so
 * anything attached here is tracked and detached in `afterEach`: the jsdom
 * document is shared by every spec in a file, and residue left in `document.body`
 * is exactly how one spec silently starts influencing the next.
 */
const attached: HTMLElement[] = [];

function attachIconButton(): HTMLButtonElement {
    const button = document.createElement('button');

    button.className = 'btn-link';
    button.setAttribute('variant', 'icon');
    document.body.appendChild(button);
    attached.push(button);

    return button;
}

afterEach((): void => {
    while (attached.length > 0) {
        attached.pop()?.remove();
    }
});

/** Renders `<Svg>` with no provider above it and hands back the host element. */
function renderPlain(props: SvgProps): { host: HTMLElement; container: HTMLElement } {
    const { container } = render(<Svg {...props} />);
    const host = container.querySelector('tg-svg');

    if (host === null) {
        throw new Error('Svg rendered no <tg-svg> host element.');
    }

    return { host: host as HTMLElement, container };
}

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

describe('Svg', () => {
    describe('⭐1 the <tg-svg> host is the outermost node (Finding A / rule T1)', () => {
        it('renders exactly one root element, and it is <tg-svg>', () => {
            const { container } = renderPlain({ svgIcon: 'icon-add' });

            expect(container.childNodes).toHaveLength(1);
            expect(container.firstElementChild?.tagName.toLowerCase()).toBe('tg-svg');

            // Asserted in upper case as well, because the DOM upper-cases
            // `tagName` only for elements created in the HTML namespace. The same
            // tag created in the SVG namespace -- which is what an inner `<svg>`
            // subtree would give it -- reports `tg-svg` verbatim, and the eleven
            // element-name rules listed below are authored for an HTML element.
            expect(container.firstElementChild?.tagName).toBe('TG-SVG');
            expect(container.firstElementChild?.namespaceURI).toBe(
                'http://www.w3.org/1999/xhtml',
            );
        });

        it('attaches no shadow root, so the global cascade still reaches inside', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            // Requirement I6: light DOM, never shadow DOM. A shadow root would sever
            // the cascade from the single global stylesheet loaded at
            // `app/index.jade:25`, and would put the sprite inlined at
            // `app/index.jade:96` out of reach of `<use href="#icon-add">` -- an
            // unstyled, blank icon that raises no error at all.
            expect(host.shadowRoot).toBeNull();

            // Negative control for the assertion above: jsdom DOES implement shadow
            // roots for a hyphenated tag, so `null` is a fact about this component
            // rather than a gap in the environment.
            expect(typeof host.attachShadow).toBe('function');
        });

        it('wraps the host around nothing else -- tg-svg > svg > use is the whole tree', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            expect(host.children).toHaveLength(1);

            const inner = host.firstElementChild;

            expect(inner?.tagName.toLowerCase()).toBe('svg');
            expect(inner?.children).toHaveLength(1);
            expect(inner?.firstElementChild?.tagName.toLowerCase()).toBe('use');
        });

        it('is a DIRECT child of its parent, so card.scss:189 keeps matching', () => {
            // Reproduces `.btn-link[variant='icon'] { &:hover { & > tg-svg { … } } }`
            // from app/modules/components/card/card.scss:185-191.
            const button = attachIconButton();

            render(<Svg svgIcon="icon-trash" />, { container: button });

            const host = button.querySelector('tg-svg');

            expect(host).not.toBeNull();
            expect(host?.matches(".btn-link[variant='icon'] > tg-svg")).toBe(true);
        });

        it('negative control: an intervening wrapper would break that selector', () => {
            // Documents WHY the host must be outermost. Built by hand, because
            // Svg itself must never be able to produce this shape.
            const button = attachIconButton();
            const wrapper = document.createElement('span');
            const host = document.createElement('tg-svg');

            wrapper.appendChild(host);
            button.appendChild(wrapper);

            expect(host.matches(".btn-link[variant='icon'] > tg-svg")).toBe(false);
        });
    });

    describe('2 the inner <svg> and its fixed class', () => {
        it('sets the class to exactly `icon <svgIcon>`', () => {
            const { host } = renderPlain({ svgIcon: 'icon-star' });

            expect(host.firstElementChild?.getAttribute('class')).toBe('icon icon-star');
        });

        it('never merges className into the inner class', () => {
            const { host } = renderPlain({
                svgIcon: 'icon-add',
                className: 'add-action',
            });

            expect(host.firstElementChild?.getAttribute('class')).toBe('icon icon-add');
        });
    });

    describe('3 the sprite reference on <use> (rule T3)', () => {
        it('carries the fragment on BOTH href and xlink:href', () => {
            const { host } = renderPlain({ svgIcon: 'icon-bulk' });
            const use = host.querySelector('use');

            expect(use?.getAttribute('href')).toBe('#icon-bulk');
            expect(use?.getAttributeNS(XLINK_NAMESPACE, 'href')).toBe('#icon-bulk');
        });

        it('emits the XLink attribute under its qualified name, not camelCased', () => {
            const { host } = renderPlain({ svgIcon: 'icon-bulk' });
            const use = host.querySelector('use');

            expect(use?.getAttribute('xlink:href')).toBe('#icon-bulk');
            expect(use?.hasAttribute('xlinkHref')).toBe(false);
        });

        it('never emits an empty reference, unlike the AngularJS placeholder', () => {
            const { host } = renderPlain({ svgIcon: 'icon-edit' });
            const use = host.querySelector('use');

            // `common.coffee:345` writes a literal `xlink:href=""` beside the two
            // `ng-attr-` forms purely so an unresolved `{{ }}` never reaches the
            // attribute during the first digest. React interpolates before it
            // commits, so the placeholder has nothing left to suppress -- and an
            // empty reference that SURVIVED would resolve to the document itself and
            // draw nothing, with no error and no console warning.
            expect(use?.getAttribute('xlink:href')).not.toBe('');
            expect(use?.getAttribute('href')).not.toBe('');
            expect(host.innerHTML).not.toContain('xlink:href=""');
            expect(host.innerHTML).not.toContain('href=""');
        });

        it('writes no attr-href -- that spelling belongs to the lodash card variant', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });
            const use = host.querySelector('use');

            // `app/coffee/modules/kanban/main.coffee:858` emits
            // `xlink:href="#…" attr-href="#…"` from the lodash `CardSvgTemplate`,
            // because that string is interpolated outside AngularJS and cannot use
            // `ng-attr-`. `common.coffee:342`-`:363` is the authoritative template
            // for React, and it produces `href`, not `attr-href`. Copying the card
            // variant's spelling would leave the plain `href` unset, so only
            // XLink-aware renderers would draw the icon.
            expect(use?.getAttribute('attr-href')).toBeNull();
            expect(use?.getAttribute('ng-attr-href')).toBeNull();
        });

        it('references no asset of its own -- no symbol, path or defs is emitted', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            expect(host.querySelector('symbol')).toBeNull();
            expect(host.querySelector('path')).toBeNull();
            expect(host.querySelector('defs')).toBeNull();
        });
    });

    describe('4 titles are two independent children INSIDE <use>', () => {
        it('renders no title when neither prop is supplied', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            expect(host.querySelectorAll('title')).toHaveLength(0);
        });

        it('renders svgTitle inside <use>, not inside <svg> and not beside it', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add', svgTitle: 'Add a story' });
            const titles = host.querySelectorAll('title');

            expect(titles).toHaveLength(1);
            expect(titles[0]?.textContent).toBe('Add a story');
            expect(titles[0]?.parentElement?.tagName.toLowerCase()).toBe('use');
        });

        it('renders no title for an empty svgTitle, matching AngularJS truthiness', () => {
            // app/coffee/modules/kanban/main.coffee:886 defaults svgTitle to ''
            // for every card icon, so this branch is exercised in production.
            const { host } = renderPlain({ svgIcon: 'icon-add', svgTitle: '' });

            expect(host.querySelectorAll('title')).toHaveLength(0);
        });

        it('resolves svgTitleTranslate with the translator the OWNER supplies', () => {
            const { translate, instant } = translatorProp();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitleTranslate="COMMON.CAPSLOCK_WARNING"
                    translate={translate}
                />,
            );

            expect(instant).toHaveBeenCalledWith('COMMON.CAPSLOCK_WARNING', undefined);
            expect(container.querySelector('use > title')?.textContent).toBe(
                't:COMMON.CAPSLOCK_WARNING',
            );
        });

        it('forwards svgTitleTranslateValues as interpolation parameters', () => {
            const { translate, instant } = translatorProp();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitleTranslate="US.TITLE"
                    svgTitleTranslateValues={{ ref: 42 }}
                    translate={translate}
                />,
            );

            expect(instant).toHaveBeenCalledWith('US.TITLE', { ref: 42 });
            expect(container.querySelector('use > title')?.textContent).toBe('t:US.TITLE(ref=42)');
        });

        it('⭐ renders the KEY VERBATIM when no translator is supplied', () => {
            // `$translate.instant` returns the key it cannot resolve, so this is the
            // incumbent's own missing-translation behaviour rather than a new one. A blank
            // title would be a different behaviour and a worse outcome.
            const { host } = renderPlain({
                svgIcon: 'icon-add',
                svgTitleTranslate: 'COMMON.CAPSLOCK_WARNING',
            });

            expect(host.querySelector('use > title')?.textContent).toBe(
                'COMMON.CAPSLOCK_WARNING',
            );
        });

        it('ignores values when there is no key, as the translate filter does', () => {
            const { host } = renderPlain({
                svgIcon: 'icon-add',
                svgTitleTranslateValues: { ref: 42 },
            });

            expect(host.querySelectorAll('title')).toHaveLength(0);
        });

        it('renders BOTH titles when both props are supplied, svgTitle first', () => {
            const { translate } = translatorProp();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitle="Literal"
                    svgTitleTranslate="US.TITLE"
                    translate={translate}
                />,
            );

            const titles = [...container.querySelectorAll('use > title')].map(
                (title) => title.textContent,
            );

            expect(titles).toEqual(['Literal', 't:US.TITLE']);
        });
    });

    describe('⭐5 className is forwarded to the host as `class` (Finding B)', () => {
        it('emits a real class attribute, never className or classname', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add', className: 'add-action' });

            expect(host.getAttribute('class')).toBe('add-action');
            expect(host.hasAttribute('classname')).toBe(false);
            expect(host.hasAttribute('className')).toBe(false);
        });

        it('is discoverable by the class selectors the stylesheets use', () => {
            const { host } = renderPlain({
                svgIcon: 'icon-star',
                className: 'default-swimlane-icon',
            });

            expect(host.matches('tg-svg.default-swimlane-icon')).toBe(true);
        });

        it('omits the attribute entirely when no className is given', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            expect(host.hasAttribute('class')).toBe(false);
        });
    });

    describe('6 svgFill is applied inline to the inner <svg>', () => {
        it('sets fill on the inner element, not on the host', () => {
            const { host } = renderPlain({ svgIcon: 'icon-add', svgFill: '#008AA8' });
            const inner = host.firstElementChild as SVGElement | null;

            expect(inner?.getAttribute('style')).toBe('fill: #008AA8;');
            expect(host.hasAttribute('style')).toBe(false);
        });

        it('omits the style attribute when no fill is given', () => {
            // AngularJS emitted `style="fill: "`. An empty declaration is invalid
            // and discarded, and no in-scope stylesheet selects on [style], so
            // omitting it is CSS-equivalent rather than a behaviour change.
            const { host } = renderPlain({ svgIcon: 'icon-add' });

            expect(host.firstElementChild?.hasAttribute('style')).toBe(false);
        });
    });

    describe('⭐7 the plain icon needs no AngularJS provider', () => {
        it('renders with no bridge provider above it', () => {
            expect(() => render(<Svg svgIcon="icon-add" />)).not.toThrow();
        });

        it('renders a literal svgTitle with no bridge provider above it', () => {
            expect(() =>
                render(<Svg svgIcon="icon-add" svgTitle="Add a story" />),
            ).not.toThrow();
        });

        it('⭐ needs NO PROVIDER even for a translated title', () => {
            // The point of the change. Previously this threw, naming `$translate`: the
            // most-rendered leaf on both screens carried a latent provider requirement
            // that surfaced only when a caller happened to pass a key. Now the translated
            // path is as provider-free as every other path.
            expect(() =>
                render(<Svg svgIcon="icon-add" svgTitleTranslate="US.TITLE" />),
            ).not.toThrow();

            const { translate } = translatorProp();

            expect(() =>
                render(
                    <Svg svgIcon="icon-add" svgTitleTranslate="US.TITLE" translate={translate} />,
                ),
            ).not.toThrow();
        });

        it('calls the translator ONLY when a key is supplied', () => {
            const { translate, instant } = translatorProp();

            render(<Svg svgIcon="icon-add" svgTitle="Add a story" translate={translate} />);

            // The source evaluates the translate filter only inside the element gated on
            // the key, so the lookup must not be hoisted out of that branch.
            expect(instant).not.toHaveBeenCalled();
        });

        it('is indifferent to the bridge value -- an EMPTY provider is fine too', () => {
            // Distinct from the cases above, which have no provider at all. Here a
            // provider IS mounted and carries nothing, which is what a React root
            // created before AngularJS finishes bootstrapping looks like. A component
            // that consulted the context would raise the bridge's missing-injector
            // diagnostic; this one never asks, so it renders unchanged.
            const { container } = render(
                <AngularBridgeProvider injector={null}>
                    <Svg svgIcon="icon-add" svgTitle="Add a story" />
                </AngularBridgeProvider>,
            );

            expect(container.firstElementChild?.tagName).toBe('TG-SVG');
            expect(container.querySelector('use > title')?.textContent).toBe('Add a story');
        });
    });

    describe('⭐8 the production wiring, through the MANDATED injector seam', () => {
        /* Section 7 proves the component needs NO provider. This section proves the
         * other half of the same contract: that the translator a real owner obtains
         * from `useTranslate()` actually reaches `<title>`, and that the key and the
         * interpolation values both survive the trip.
         *
         * The whole path is mounted -- `AngularBridgeProvider` -> injector double ->
         * `useTranslate` -> the `translate` prop -> `<title>` -- because a
         * hand-written prop double on its own would pass just as happily against an
         * owner that resolved translation from nowhere at all. What is being locked
         * here is the wiring, not the prop.
         *
         * The injector is MOCKED and AngularJS is never loaded: `mockInjector` is the
         * sanctioned seam for this, and it is what keeps the suite browserless,
         * build-free and offline (constraint HR-5).
         */

        it('renders exactly what $translate.instant returned', () => {
            const { instant } = createTranslateDouble();
            const { host } = renderThroughBridge(
                {
                    svgIcon: 'icon-star',
                    svgTitleTranslate: 'ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT',
                },
                instant,
            );

            // The key is the one the default-swimlane marker really uses, at
            // `app/partials/includes/modules/kanban-table.jade:106`.
            expect(instant).toHaveBeenCalledTimes(1);
            expect(instant).toHaveBeenCalledWith('ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT', undefined);
            expect(host.querySelector('use > title')?.textContent).toBe(
                't:ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT',
            );
        });

        it('forwards svgTitleTranslateValues to $translate.instant unchanged', () => {
            const { instant } = createTranslateDouble();
            const values = { ref: 42, subject: 'Fix the board' };
            const { host } = renderThroughBridge(
                {
                    svgIcon: 'icon-edit',
                    svgTitleTranslate: 'US.TITLE',
                    svgTitleTranslateValues: values,
                },
                instant,
            );

            // Both arguments, and the SAME object rather than a reconstruction of it:
            // the AngularJS template hands the values straight to the translate filter
            // (`app/coffee/modules/common.coffee:347`), so a bridge that rebuilt the
            // object could quietly drop a value the filter would have interpolated.
            expect(instant).toHaveBeenCalledWith('US.TITLE', values);
            expect(instant.mock.calls[0]?.[1]).toBe(values);
            expect(host.querySelector('use > title')?.textContent).toBe(
                't:US.TITLE(ref=42,subject=Fix the board)',
            );
        });

        it('emits the same host / svg / use / title nesting as the unwired component', () => {
            const { instant } = createTranslateDouble();
            const { host } = renderThroughBridge(
                {
                    svgIcon: 'icon-add',
                    svgTitleTranslate: 'US.TITLE',
                    className: 'add-action',
                },
                instant,
            );

            // Going through the seam must not perturb the markup contract that
            // sections 1 to 6 lock, because that contract is what keeps the eleven
            // `tg-svg` stylesheet rules and the inlined sprite working.
            expect(host.tagName).toBe('TG-SVG');
            expect(host.getAttribute('class')).toBe('add-action');
            expect(host.shadowRoot).toBeNull();
            expect(host.children).toHaveLength(1);
            expect(host.firstElementChild?.getAttribute('class')).toBe('icon icon-add');
            expect(host.querySelector('use')?.getAttribute('href')).toBe('#icon-add');
            expect(host.querySelector('use')?.getAttribute('xlink:href')).toBe('#icon-add');
            expect(host.querySelectorAll('title')).toHaveLength(1);
        });

        it('leaves the translator untouched when the icon carries no key', () => {
            const { instant } = createTranslateDouble();
            const { host } = renderThroughBridge({ svgIcon: 'icon-add' }, instant);

            // The overwhelmingly common case on both screens: an icon with no title
            // at all must not cost a translation lookup even when a translator is
            // wired in, because `Svg` is rendered once per card action.
            expect(instant).not.toHaveBeenCalled();
            expect(host.querySelectorAll('title')).toHaveLength(0);
        });

        it("raises mockInjector's own diagnostic for a service the spec did not supply", () => {
            // Proves the seam is a DOUBLE rather than AngularJS itself: an unsupplied
            // name fails loudly and by name
            // (`app/react/bridge/mockInjector.ts:29`-`:47`) instead of resolving to
            // nothing and failing later somewhere unrelated.
            expect(() => mockInjector({}).get('$translate')).toThrow(/mockInjector/);
            expect(() => mockInjector({}).get('$translate')).toThrow(/\$translate/);
        });
    });

    describe('9 caller text renders as text, never as markup (AAP 0.8.2)', () => {
        it('escapes a literal svgTitle', () => {
            const payload = '<img src=x onerror=alert(1)>';
            const { host } = renderPlain({ svgIcon: 'icon-add', svgTitle: payload });

            expect(host.querySelector('title')?.textContent).toBe(payload);
            expect(host.querySelector('img')).toBeNull();
            expect(host.innerHTML).toContain('&lt;img');
        });

        it('escapes a translated svgTitle', () => {
            const { translate } = translatorProp();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitleTranslate="<script>x</script>"
                    translate={translate}
                />,
            );

            expect(container.querySelector('script')).toBeNull();
            expect(container.querySelector('title')?.textContent).toBe('t:<script>x</script>');
        });
    });

    describe('10 the emitted markup matches the incumbent template', () => {
        it('reproduces the tgSvg shape for a fully-populated icon', () => {
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitle="Add a story"
                    svgFill="#008AA8"
                    className="add-action"
                />,
            );

            expect(container.innerHTML).toBe(
                '<tg-svg class="add-action">' +
                    '<svg class="icon icon-add" style="fill: #008AA8;">' +
                    '<use xlink:href="#icon-add" href="#icon-add">' +
                    '<title>Add a story</title>' +
                    '</use>' +
                    '</svg>' +
                    '</tg-svg>',
            );
        });

        it('reproduces the minimal shape when only svgIcon is given', () => {
            const { container } = render(<Svg svgIcon="icon-graph" />);

            expect(container.innerHTML).toBe(
                '<tg-svg>' +
                    '<svg class="icon icon-graph">' +
                    '<use xlink:href="#icon-graph" href="#icon-graph"></use>' +
                    '</svg>' +
                    '</tg-svg>',
            );
        });
    });

    describe('11 every referenced fragment id exists in the sprite (rule T3)', () => {
        // Guards the one failure this component cannot detect at runtime: a
        // fragment id with no `<symbol>` behind it renders an invisible icon
        // silently. The sprite is inlined into the document by
        // `include svg/sprite.svg` at app/index.jade:96 and must never be
        // regenerated, so the ids are read from it rather than restated.
        const sprite = readFileSync(join(__dirname, '..', '..', 'svg', 'sprite.svg'), 'utf8');

        it.each([
            'icon-add',
            'icon-bulk',
            'icon-edit',
            'icon-graph',
            'icon-star',
            'icon-trash',
        ])('%s is defined exactly once in app/svg/sprite.svg', (svgIcon: string) => {
            const occurrences = sprite.split(`id="${svgIcon}"`).length - 1;

            expect(occurrences).toBe(1);
        });

        it('points <use> at the id verbatim, with a single leading #', () => {
            const { host } = renderPlain({ svgIcon: 'icon-move-to-top' });

            expect(sprite).toContain('id="icon-move-to-top"');
            expect(host.querySelector('use')?.getAttribute('href')).toBe('#icon-move-to-top');
        });
    });
});
