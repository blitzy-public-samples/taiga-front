/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { memo, useContext } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

import { AngularBridgeContext, AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularBridgeContextValue, AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';

const SCOPE_MEMBER = `${'$'}${'scope'}`;

const ROOT_SCOPE_MEMBER = `${'$'}${'root'}${'Scope'}`;

const PROMISE_SERVICE_MEMBER = `${'$'}${'q'}`;

const DIGEST_ENTRY_MEMBERS: readonly string[] = [
    `${'$'}${'apply'}`,
    `${'$'}${'digest'}`,
    `${'$'}${'apply'}${'Async'}`,
];

const FORBIDDEN_MEMBERS: readonly string[] = [
    SCOPE_MEMBER,
    ROOT_SCOPE_MEMBER,
    PROMISE_SERVICE_MEMBER,
    ...DIGEST_ENTRY_MEMBERS,
];

const PERSISTENT_LIBRARY = `${'Immut'}${'able'}`;

const PERSISTENT_MARKER_PREFIX = `@@__${'IMMUT'}${'ABLE_'}`;

const PERSISTENT_MARKERS: readonly string[] = [
    `${PERSISTENT_MARKER_PREFIX}MAP__@@`,
    `${PERSISTENT_MARKER_PREFIX}LIST__@@`,
    `${PERSISTENT_MARKER_PREFIX}ITERABLE__@@`,
];

const RAW_MARKUP_PROP = `${'dangerously'}${'SetInnerHTML'}`;

const SHADOW_ROOT_CALL = `${'attach'}${'Shadow'}`;

const UNSAFE_TYPE_ANNOTATION = `: ${'a'}${'ny'}`;

const UNSAFE_TYPE_ASSERTION = `as ${'a'}${'ny'}`;

interface LightboxFactoryDouble {
    create: jest.Mock<void, [string, Record<string, unknown>?]>;
}

interface LoaderDouble {
    start: jest.Mock<void, []>;
    pageLoaded: jest.Mock<void, []>;
}

interface Mocks {
    tgLightboxFactory: LightboxFactoryDouble;
    tgLoader: LoaderDouble;
}

function _mockTgLightboxFactory(): LightboxFactoryDouble {
    return { create: jest.fn() };
}

function _mockTgLoader(): LoaderDouble {
    return { start: jest.fn(), pageLoaded: jest.fn() };
}

function _mocks(): Mocks {
    return {
        tgLightboxFactory: _mockTgLightboxFactory(),
        tgLoader: _mockTgLoader(),
    };
}

let mocks: Mocks = _mocks();

const observed: AngularBridgeContextValue[] = [];

function Probe(): ReactElement {
    observed.push(useContext(AngularBridgeContext));

    return <span data-testid="probe">probe</span>;
}

let memoRenderCount = 0;

const MemoisedConsumer = memo(function MemoisedConsumer(): ReactElement {
    memoRenderCount += 1;

    const injector = useContext(AngularBridgeContext);

    return (
        <span data-testid="memoised">{injector === null ? 'no-injector' : 'injector'}</span>
    );
});

function Harness({
    injector,
    label,
}: {
    injector: AngularInjector | null;
    label: string;
}): ReactElement {
    return (
        <AngularBridgeProvider injector={injector}>
            <span data-testid="label">{label}</span>
            <Probe />
            <MemoisedConsumer />
        </AngularBridgeProvider>
    );
}

function latestInjector(): AngularInjector {
    if (observed.length === 0) {
        throw new Error(
            'latestInjector: the probe observed nothing -- render a subtree ' +
                'containing <Probe /> before asking for the carried injector.',
        );
    }

    const value = observed[observed.length - 1];

    if (value === null) {
        throw new Error(
            'latestInjector: the probe observed the no-provider default rather ' +
                'than an injector -- wrap <Probe /> in <AngularBridgeProvider>.',
        );
    }

    return value;
}

function importSpecifiersOf(source: string): ReadonlyArray<string> {
    const withBindings = Array.from(
        source.matchAll(/^[ \t]*import\s[\s\S]*?from\s+'([^']+)';/gm),
        (match) => match[1],
    );
    const sideEffectOnly = Array.from(
        source.matchAll(/^[ \t]*import\s+'([^']+)';/gm),
        (match) => match[1],
    );

    return Array.from(new Set([...withBindings, ...sideEffectOnly])).sort();
}

beforeEach(() => {
    mocks = _mocks();
    observed.length = 0;
    memoRenderCount = 0;
});

describe('AngularBridgeContext', () => {
    describe('injector pass-through', () => {
        it('hands a consumer inside the provider the exact injector instance', () => {
            const injector = mockInjector({ tgLoader: mocks.tgLoader });

            render(
                <AngularBridgeProvider injector={injector}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            expect(observed).toHaveLength(1);

            expect(Object.is(observed[0], injector)).toBe(true);
            expect(observed[0]).toBe(injector);
        });

        it('carries an injector that resolves the very double this spec holds', () => {
            const injector = mockInjector({
                tgLightboxFactory: mocks.tgLightboxFactory,
            });

            render(
                <AngularBridgeProvider injector={injector}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();
            const lightbox = carried.get<LightboxFactoryDouble>('tgLightboxFactory');

            expect(lightbox).toBe(mocks.tgLightboxFactory);

            expect(mocks.tgLightboxFactory.create).not.toHaveBeenCalled();

            lightbox.create('tg-search-box');

            expect(mocks.tgLightboxFactory.create).toHaveBeenCalledTimes(1);
            expect(mocks.tgLightboxFactory.create).toHaveBeenCalledWith('tg-search-box');
        });

        it('publishes the identical value through the documented wrapper helper', () => {
            const injector = mockInjector({ tgLoader: mocks.tgLoader });

            render(<Probe />, { wrapper: withMockInjector(injector) });

            expect(observed).toHaveLength(1);
            expect(observed[0]).toBe(injector);
        });
    });

    describe('no provider above the consumer', () => {
        it('yields the null-ish default instead of throwing', () => {
            expect(() => render(<Probe />)).not.toThrow();

            expect(observed).toHaveLength(1);
            expect(observed[0]).toBeNull();
            expect(observed).toEqual([null]);
        });

        it('renders a memoised consumer against the default without throwing', () => {
            render(<MemoisedConsumer />);

            expect(screen.getByTestId('memoised')).toHaveTextContent('no-injector');
        });

        it('loaded as a module without throwing, and names itself for DevTools', () => {
            expect(AngularBridgeContext).toBeDefined();
            expect(typeof AngularBridgeProvider).toBe('function');
            expect(AngularBridgeContext.displayName).toBe('AngularBridgeContext');
        });
    });

    describe('children', () => {
        it('renders its children', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <p>the migrated board renders here</p>
                </AngularBridgeProvider>,
            );

            expect(screen.getByText('the migrated board renders here')).toBeInTheDocument();
        });

        it('renders several children in order, adding no wrapper element of its own', () => {
            const { container } = render(
                <AngularBridgeProvider injector={mockInjector()}>
                    <span>first</span>
                    <span>second</span>
                </AngularBridgeProvider>,
            );

            expect(container.childNodes).toHaveLength(2);
            expect(container.textContent).toBe('firstsecond');
        });

        it('renders nothing when given no children, since children are optional', () => {
            const { container } = render(
                <AngularBridgeProvider injector={mockInjector()} />,
            );

            expect(container).toBeEmptyDOMElement();
        });
    });

    describe('value identity across parent re-renders', () => {
        it('keeps the same value identity, and skips the memoised consumer', () => {
            const injector = mockInjector({ tgLoader: mocks.tgLoader });

            const { rerender } = render(<Harness injector={injector} label="first" />);

            expect(screen.getByTestId('label')).toHaveTextContent('first');
            expect(observed).toHaveLength(1);

            const rendersAfterMount = memoRenderCount;

            expect(rendersAfterMount).toBeGreaterThan(0);

            rerender(<Harness injector={injector} label="second" />);

            expect(screen.getByTestId('label')).toHaveTextContent('second');
            expect(observed).toHaveLength(2);

            expect(Object.is(observed[0], observed[1])).toBe(true);
            expect(observed[1]).toBe(injector);

            expect(memoRenderCount).toBe(rendersAfterMount);
        });
    });

    describe('a new injector', () => {
        it('propagates to consumers and re-renders even the memoised one', () => {
            const first = mockInjector({ tgLoader: mocks.tgLoader });
            const second = mockInjector({
                tgLightboxFactory: mocks.tgLightboxFactory,
            });

            const { rerender } = render(<Harness injector={first} label="first" />);

            expect(observed[0]).toBe(first);

            const rendersAfterMount = memoRenderCount;

            rerender(<Harness injector={second} label="second" />);

            expect(observed).toHaveLength(2);
            expect(observed[1]).toBe(second);
            expect(observed[1]).not.toBe(first);

            expect(memoRenderCount).toBeGreaterThan(rendersAfterMount);
        });

        it('resolves through the new injector only, not the retired one', () => {
            const first = mockInjector({ tgLoader: mocks.tgLoader });
            const second = mockInjector({
                tgLightboxFactory: mocks.tgLightboxFactory,
            });

            const { rerender } = render(<Harness injector={first} label="first" />);

            rerender(<Harness injector={second} label="second" />);

            const carried = latestInjector();

            expect(carried.get<LightboxFactoryDouble>('tgLightboxFactory')).toBe(
                mocks.tgLightboxFactory,
            );

            expect(() => carried.get('tgLoader')).toThrow(/tgLoader/);
        });
    });

    describe('the context carries ONLY the injector', () => {
        it('exposes the resolver and nothing else', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(typeof carried.get).toBe('function');

            expect(Object.keys(carried)).toEqual(['get']);
        });

        it('exposes neither AngularJS scope service, nor the promise service, nor any digest entry', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(FORBIDDEN_MEMBERS).toHaveLength(6);
            expect(DIGEST_ENTRY_MEMBERS).toHaveLength(3);

            for (const member of FORBIDDEN_MEMBERS) {
                expect(member in carried).toBe(false);
                expect(carried).not.toHaveProperty(member);
            }
        });

        it('cannot even resolve those names through the resolver', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            for (const member of FORBIDDEN_MEMBERS) {
                expect(() => carried.get(member)).toThrow(/mockInjector/);
            }
        });

        it('publishes the injector itself, not an object wrapping it', () => {
            const injector = mockInjector({ tgLoader: mocks.tgLoader });

            render(
                <AngularBridgeProvider injector={injector}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(carried).not.toHaveProperty('injector');
            expect(carried).not.toHaveProperty('services');
            expect(carried).not.toHaveProperty('state');
            expect(carried).toBe(injector);
        });
    });

    describe('no persistent collection and no repository model instance', () => {
        it('carries a plain object, not a class instance', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(Object.getPrototypeOf(carried)).toBe(Object.prototype);
            expect(carried.constructor).toBe(Object);
        });

        it('carries none of the persistent-collection marker keys', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(PERSISTENT_MARKERS).toHaveLength(3);

            for (const marker of PERSISTENT_MARKERS) {
                expect(marker in carried).toBe(false);
            }

            expect('toJS' in carried).toBe(false);
            expect('size' in carried).toBe(false);
        });

        it('carries no repository model instance', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect('getAttrs' in carried).toBe(false);
            expect('_attrs' in carried).toBe(false);
            expect('_modifiedAttrs' in carried).toBe(false);
            expect('isModified' in carried).toBe(false);
        });

        it('lets a plain, model-shaped fixture cross the seam unchanged', () => {
            render(
                <AngularBridgeProvider
                    injector={mockInjector({
                        tgLightboxFactory: mocks.tgLightboxFactory,
                    })}
                >
                    <Probe />
                </AngularBridgeProvider>,
            );

            const lightbox = latestInjector().get<LightboxFactoryDouble>(
                'tgLightboxFactory',
            );

            const story = {
                id: 7,
                ref: 42,
                subject: 'Reorder the sprint',
                is_blocked: false,
            };

            lightbox.create('tg-lb-create-edit', story);

            expect(mocks.tgLightboxFactory.create).toHaveBeenCalledWith(
                'tg-lb-create-edit',
                story,
            );

            const [, carriedFixture] = mocks.tgLightboxFactory.create.mock.calls[0];

            expect(carriedFixture).toBe(story);
            expect(Object.getPrototypeOf(story)).toBe(Object.prototype);
            expect('toJS' in story).toBe(false);
            expect('getAttrs' in story).toBe(false);
        });
    });

    describe('source-level prohibitions on the unit under test', () => {
        const unitSource = readFileSync(
            join(__dirname, 'AngularBridgeContext.tsx'),
            'utf8',
        );

        it('reads the unit source, so the assertions below cannot pass vacuously', () => {
            expect(unitSource.length).toBeGreaterThan(0);
            expect(unitSource).toContain('AngularBridgeProvider');
        });

        it('never mentions either AngularJS scope service or any digest entry', () => {
            for (const member of [SCOPE_MEMBER, ROOT_SCOPE_MEMBER, ...DIGEST_ENTRY_MEMBERS]) {
                expect(unitSource).not.toContain(member);
            }
        });

        it('never mentions the persistent-collection library', () => {
            expect(unitSource).not.toContain(PERSISTENT_LIBRARY);
        });

        it('never reaches for React raw-markup escape hatch', () => {
            expect(unitSource).not.toContain(RAW_MARKUP_PROP);
        });

        it('never creates a shadow root', () => {
            expect(unitSource).not.toContain(SHADOW_ROOT_CALL);
        });

        it('never uses the unsafe escape-hatch type', () => {
            expect(unitSource).not.toContain(UNSAFE_TYPE_ANNOTATION);
            expect(unitSource).not.toContain(UNSAFE_TYPE_ASSERTION);
        });

        it('imports nothing but react', () => {
            expect(importSpecifiersOf(unitSource)).toEqual(['react']);
        });
    });
});
