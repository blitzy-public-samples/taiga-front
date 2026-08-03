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
 * Browserless by construction (constraint HR-5): jsdom only, no Playwright
 * import, no browser launch, no network, no dependency on `dist/`.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
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

/**
 * A `$rootScope` double exposing only `$on`, which is all `useTranslate`
 * narrows it to. Returns a deregistration function, as AngularJS does.
 */
function createRootScopeDouble(): { $on: jest.Mock<() => void, [string, unknown]> } {
    return {
        $on: jest.fn<() => void, [string, unknown]>((): (() => void) => (): void => undefined),
    };
}

/**
 * An injector double over an explicit name-to-service table.
 *
 * Deliberately NOT `mockInjector` from `../bridge/mockInjector`: its map is
 * typed `Partial<AngularServices>`, and `$rootScope` is excluded from that map
 * by design, yet `useTranslate` resolves the root scope through the untyped
 * escape hatch. This is the same local shape `../bridge/useTranslate.test.tsx`
 * uses for the same reason. `has` is omitted so resolution takes the path the
 * browser takes.
 */
function createInjector(services: Readonly<Record<string, unknown>>): AngularInjector {
    return {
        get<T>(name: string): T {
            return services[name] as T;
        },
    };
}

/** Wraps a subtree in a bridge provider carrying `injector`. */
function wrapperFor(injector: AngularInjector): (props: { children?: ReactNode }) => ReactElement {
    return function Wrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

/** A provider carrying a working `$translate` plus the root scope it needs. */
function translatingWrapper(): {
    wrapper: (props: { children?: ReactNode }) => ReactElement;
    instant: jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;
} {
    const translate = createTranslateDouble();

    return {
        wrapper: wrapperFor(
            createInjector({ $translate: translate, $rootScope: createRootScopeDouble() }),
        ),
        instant: translate.instant,
    };
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

            expect(host.innerHTML).not.toContain('xlink:href=""');
            expect(host.innerHTML).not.toContain('href=""');
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

        it('resolves svgTitleTranslate through the AngularJS translation service', () => {
            const { wrapper, instant } = translatingWrapper();
            const { container } = render(
                <Svg svgIcon="icon-add" svgTitleTranslate="COMMON.CAPSLOCK_WARNING" />,
                { wrapper },
            );

            expect(instant).toHaveBeenCalledWith('COMMON.CAPSLOCK_WARNING', undefined);
            expect(container.querySelector('use > title')?.textContent).toBe(
                't:COMMON.CAPSLOCK_WARNING',
            );
        });

        it('forwards svgTitleTranslateValues as interpolation parameters', () => {
            const { wrapper, instant } = translatingWrapper();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitleTranslate="US.TITLE"
                    svgTitleTranslateValues={{ ref: 42 }}
                />,
                { wrapper },
            );

            expect(instant).toHaveBeenCalledWith('US.TITLE', { ref: 42 });
            expect(container.querySelector('use > title')?.textContent).toBe('t:US.TITLE(ref=42)');
        });

        it('ignores values when there is no key, as the translate filter does', () => {
            const { host } = renderPlain({
                svgIcon: 'icon-add',
                svgTitleTranslateValues: { ref: 42 },
            });

            expect(host.querySelectorAll('title')).toHaveLength(0);
        });

        it('renders BOTH titles when both props are supplied, svgTitle first', () => {
            const { wrapper } = translatingWrapper();
            const { container } = render(
                <Svg
                    svgIcon="icon-add"
                    svgTitle="Literal"
                    svgTitleTranslate="US.TITLE"
                />,
                { wrapper },
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

        it('does not consult the injector unless a translation key is supplied', () => {
            const injector = createInjector({});
            const get = jest.spyOn(injector, 'get');

            render(<Svg svgIcon="icon-add" svgTitle="Add a story" />, {
                wrapper: wrapperFor(injector),
            });

            expect(get).not.toHaveBeenCalled();
        });

        it('only then requires a provider, and says so by name', () => {
            const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

            try {
                expect(() =>
                    render(<Svg svgIcon="icon-add" svgTitleTranslate="US.TITLE" />),
                ).toThrow(/\$translate/);
            } finally {
                error.mockRestore();
            }
        });
    });

    describe('8 caller text renders as text, never as markup (AAP 0.8.2)', () => {
        it('escapes a literal svgTitle', () => {
            const payload = '<img src=x onerror=alert(1)>';
            const { host } = renderPlain({ svgIcon: 'icon-add', svgTitle: payload });

            expect(host.querySelector('title')?.textContent).toBe(payload);
            expect(host.querySelector('img')).toBeNull();
            expect(host.innerHTML).toContain('&lt;img');
        });

        it('escapes a translated svgTitle', () => {
            const { wrapper } = translatingWrapper();
            const { container } = render(
                <Svg svgIcon="icon-add" svgTitleTranslate="<script>x</script>" />,
                { wrapper },
            );

            expect(container.querySelector('script')).toBeNull();
            expect(container.querySelector('title')?.textContent).toBe('t:<script>x</script>');
        });
    });

    describe('9 the emitted markup matches the incumbent template', () => {
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

    describe('10 every referenced fragment id exists in the sprite (rule T3)', () => {
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
