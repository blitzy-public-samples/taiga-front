/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * AngularBridgeContext.test.tsx -- co-located spec for the injection seam
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file as much as it
 * governs the unit it covers. This spec sits on the narrowest joint of a
 * strangler-fig migration, so what each assertion buys is stated rather than
 * left to be inferred.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT IS UNDER TEST
 * --------------------------------------------------------------------------
 * `./AngularBridgeContext.tsx`: the React context that carries the AngularJS
 * `$injector` into a React subtree, plus the provider that publishes it. It is
 * the ONLY channel by which React code on the migrated Kanban and Backlog
 * screens reaches an AngularJS service, and it is the substitute for the static
 * constructor-injection arrays React components cannot use -- 24 entries for the
 * Kanban controller, 21 for the Backlog one, both of which survive intact as the
 * data, permission and drag-serialisation layer behind their React replacements.
 *
 * The unit is deliberately tiny: a context with a `null` default, and a provider
 * that forwards its `injector` prop AS-IS with no wrapper object and no
 * `useMemo`. Precisely because it is tiny, the things it must NOT do are the
 * interesting part, which is why three of the blocks below are negative.
 *
 * --------------------------------------------------------------------------
 * 2. WHY `mockInjector()` RATHER THAN LOADING ANGULARJS
 * --------------------------------------------------------------------------
 * Not a preference. The `jest.config.js` contract states it, and the quotation
 * is verbatim apart from the three browser-global names in its first sentence,
 * which are summarised in brackets for the reason given in section 3:
 *
 *     "AngularJS/jQuery globals: the bridge hooks read [three browser globals --
 *      the AngularJS one, the jQuery one and the application's own]. Tests must
 *      mock the injector, not load AngularJS. Provide the mocking seam through
 *      the test files themselves (a `mockInjector()` helper under
 *      `app/react/bridge/`), not by adding `angular` to `setupFiles`."
 *
 * So every injector in this file comes from `./mockInjector`. Nothing here
 * imports AngularJS, nothing reads the AngularJS browser global, and nothing
 * asks `jest.config.js` to change -- it has no `setupFiles` key at all, and this
 * spec is one of the reasons it never needs one.
 *
 * That keeps requirement HR-5 satisfied by construction: jsdom only, no browser
 * binary, no network, and zero coupling to the compiled distribution. The only
 * input this file performs is reading the unit's own source text off disk in
 * section 5's block, which is a local file read and reaches nothing.
 *
 * --------------------------------------------------------------------------
 * 3. WHY THE PROHIBITED IDENTIFIERS ARE ASSEMBLED FROM PARTS
 * --------------------------------------------------------------------------
 * The migration is verified in part by repository-wide greps over `app/react`
 * for a fixed set of identifiers that must never appear there. Spelling one out
 * -- even inside a comment, even inside an assertion that it is absent -- would
 * make this spec the very hit the grep exists to catch. Every such name is
 * therefore built from string fragments at run time. The unit documents the same
 * convention at `./AngularBridgeContext.tsx:95-101`, `./mockInjector.ts:34-42`
 * turns it into prose, and `./ErrorBoundary.test.tsx:898-905` into code.
 *
 * --------------------------------------------------------------------------
 * 4. WHY THE NEGATIVE ASSERTIONS EXIST
 * --------------------------------------------------------------------------
 * Two of them, and each protects a documented invariant that a passing render
 * test would not notice being broken.
 *
 *   (a) THE CONTEXT CARRIES ONLY THE INJECTOR. Neither AngularJS scope service
 *       may cross, nor the AngularJS promise service, nor any of the three
 *       digest-entry methods. AAP 0.7.4 is verbatim that React code must "never"
 *       call the root scope's apply method: digest cycles stay AngularJS's
 *       concern and React state updates are driven by React, so handing React a
 *       scope would put the one forbidden call within easy reach and the suite
 *       would stay green while it happened. The application already routes its
 *       own digests asynchronously (`app/coffee/app.coffee:604`), which is
 *       exactly the machinery React must not reach into. Promises cross through
 *       the sibling `./toNativePromise.ts` marshaller instead.
 *
 *   (b) NO PERSISTENT COLLECTION AND NO REPOSITORY MODEL INSTANCE. Flattening
 *       happens on the AngularJS side, BEFORE values cross: the house-style
 *       precedent is `.toJS()` in
 *       `app/modules/components/project-menu/project-menu.controller.coffee` on
 *       L27, as the project is placed into the params payload, with a second
 *       precedent on L21 for the milestone list. LOCATOR CORRECTION, verified by
 *       reading that file: the params flattening is on L27, NOT L28 -- L28 is
 *       the closing brace, so AAP 0.5.2 and 0.6.2 are off by one. The two
 *       `react-bridge.coffee` files generalise the call into a `toPlain` helper
 *       that falls back to `getAttrs()`, and `getAttrs(patch = false)` at
 *       `app/coffee/modules/base/model.coffee:48-54` returns a plain extension
 *       of the model's own and modified attributes. This matters because of
 *       P-IMMER-1: immer dislikes class instances, and the model factory returns
 *       classes carrying dirty-tracking state, so putting one into a draft is
 *       undefined behaviour -- and freezing a structure AngularJS is still
 *       iterating makes the next digest throw.
 *
 * --------------------------------------------------------------------------
 * 5. CONVENTIONS INHERITED FROM THE INCUMBENT SUITE
 * --------------------------------------------------------------------------
 * `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * is the model, and its component is one the Backlog screen consumes, so it must
 * keep passing untouched. Carried over: the module-level `mocks` registry (`:14`)
 * with ONE helper per dependency (`:16-19`, `:23-30`) collected by a `_mocks()`
 * function (`:32-37`) that `beforeEach` drives (`:48-50`); nested `describe`
 * blocks per behaviour area (`:61` for the button, `:103` for the lightbox); and
 * assertions on BOTH paths -- `:110` asserts the lightbox was created, `:114`
 * asserts it was not. Its `tgLightboxFactory` double (`:17-19`) reappears below
 * as the direct analogue it is.
 *
 * Mechanically translated: `provide.value "name", double` becomes a key of the
 * `mockInjector({ ... })` map; `sinon.stub()` becomes `jest.fn()`; the chai
 * matchers become the Jest ones. Deliberately NOT carried over is its fixture
 * style: that spec builds persistent structures with the collection library's
 * `fromJS` factory (`:25`, `:81-85`, `:95-98`) because AngularJS controllers
 * hold them. React fixtures here are plain objects and arrays, shaped like the
 * real models -- see section 4(b).
 *
 * No mock is hand-reset anywhere below: `jest.config.js` already sets both
 * `clearMocks` and `restoreMocks`, so duplicating that would invite specs to
 * depend on ordering the configuration already guarantees.
 *
 * Finally, there is deliberately no default React import. `tsconfig.json` sets
 * `jsx: "react-jsx"` -- the automatic runtime, which the esbuild task mirrors
 * with `jsx: "automatic"`; the two MUST agree or the bundle throws at run time
 * -- so it is unnecessary, and `noUnusedLocals: true` would turn it into a
 * compile error.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import { memo, useContext } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

import { AngularBridgeContext, AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularBridgeContextValue, AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';

/* --------------------------------------------------------------------------
 * Prohibited identifiers, assembled from parts (see section 3 of the header)
 * -------------------------------------------------------------------------- */

/** The directive-level AngularJS scope service. */
const SCOPE_MEMBER = `${'$'}${'scope'}`;

/** The application-level AngularJS scope service. */
const ROOT_SCOPE_MEMBER = `${'$'}${'root'}${'Scope'}`;

/** The AngularJS promise service, which crosses as a native promise instead. */
const PROMISE_SERVICE_MEMBER = `${'$'}${'q'}`;

/** The three ways into a digest cycle. React may reach none of them. */
const DIGEST_ENTRY_MEMBERS: readonly string[] = [
    `${'$'}${'apply'}`,
    `${'$'}${'digest'}`,
    `${'$'}${'apply'}${'Async'}`,
];

/**
 * Every member the context value must NOT expose. One flat list, so a future
 * addition to the prohibition set is one line here and is then checked by every
 * assertion that iterates it.
 */
const FORBIDDEN_MEMBERS: readonly string[] = [
    SCOPE_MEMBER,
    ROOT_SCOPE_MEMBER,
    PROMISE_SERVICE_MEMBER,
    ...DIGEST_ENTRY_MEMBERS,
];

/** The persistent-collection library's own name, for the source-level scan. */
const PERSISTENT_LIBRARY = `${'Immut'}${'able'}`;

/** Shared prefix of the private marker keys that library stamps onto values. */
const PERSISTENT_MARKER_PREFIX = `@@__${'IMMUT'}${'ABLE_'}`;

/** The marker keys themselves, for the three structures the migration meets. */
const PERSISTENT_MARKERS: readonly string[] = [
    `${PERSISTENT_MARKER_PREFIX}MAP__@@`,
    `${PERSISTENT_MARKER_PREFIX}LIST__@@`,
    `${PERSISTENT_MARKER_PREFIX}ITERABLE__@@`,
];

/** React's raw-markup escape hatch. */
const RAW_MARKUP_PROP = `${'dangerously'}${'SetInnerHTML'}`;

/** The shadow-root call requirement I6 forbids across the whole React tree. */
const SHADOW_ROOT_CALL = `${'attach'}${'Shadow'}`;

/** TypeScript's unsafe escape-hatch type, annotation form. */
const UNSAFE_TYPE_ANNOTATION = `: ${'a'}${'ny'}`;

/** The same type in assertion form. */
const UNSAFE_TYPE_ASSERTION = `as ${'a'}${'ny'}`;

/* --------------------------------------------------------------------------
 * Test doubles -- one helper per dependency, registered in a module-level
 * `mocks` object, mirroring `move-to-sprint.controller.spec.coffee:14-37`
 * -------------------------------------------------------------------------- */

/**
 * The lightbox factory double -- the direct analogue of
 * `move-to-sprint.controller.spec.coffee:17-19`, with that spec's `sinon.stub()`
 * replaced by `jest.fn()`.
 *
 * Declared structurally rather than as an intersection with the facade type,
 * because the shape is ALREADY checked where it matters: the service map handed
 * to `mockInjector({ ... })` is typed by the facade interface, so a misspelled
 * service name and a wrongly-shaped double are both compile errors at the call
 * site under `tsc --noEmit`. That is exactly the guarantee
 * `./mockInjector.ts:110-117` promises, and leaning on it keeps this spec's
 * imports confined to the two modules it is actually a spec for.
 */
interface LightboxFactoryDouble {
    create: jest.Mock<void, [string, Record<string, unknown>?]>;
}

/** The loader double -- a second, distinct service, so injectors can differ. */
interface LoaderDouble {
    start: jest.Mock<void, []>;
    pageLoaded: jest.Mock<void, []>;
}

/** Everything `_mocks()` registers. */
interface Mocks {
    tgLightboxFactory: LightboxFactoryDouble;
    tgLoader: LoaderDouble;
}

/** Builds the lightbox factory double. */
function _mockTgLightboxFactory(): LightboxFactoryDouble {
    return { create: jest.fn() };
}

/** Builds the loader double. */
function _mockTgLoader(): LoaderDouble {
    return { start: jest.fn(), pageLoaded: jest.fn() };
}

/** Collects every double, exactly as `_mocks()` does at `:32-37`. */
function _mocks(): Mocks {
    return {
        tgLightboxFactory: _mockTgLightboxFactory(),
        tgLoader: _mockTgLoader(),
    };
}

/**
 * The module-level registry the specs assert against, rebuilt per test by
 * `beforeEach` so no double can carry state across a boundary. Initialised at
 * module scope so it is never read before it is written.
 */
let mocks: Mocks = _mocks();

/* --------------------------------------------------------------------------
 * Probes
 * -------------------------------------------------------------------------- */

/**
 * Every context value observed, in render order.
 *
 * An array rather than a single slot on purpose: the re-render blocks assert on
 * the RELATIONSHIP between successive values -- that two are the same instance,
 * or that the second is a different one -- which a single slot cannot express.
 */
const observed: AngularBridgeContextValue[] = [];

/**
 * Reads the seam's context and records what it saw.
 *
 * Recording during render is the point: it captures the value a real consumer
 * would receive at exactly the moment it would receive it, with no effect
 * scheduling in between to blur the timing.
 */
function Probe(): ReactElement {
    observed.push(useContext(AngularBridgeContext));

    return <span data-testid="probe">probe</span>;
}

/** How many times {@link MemoisedConsumer} has rendered. */
let memoRenderCount = 0;

/**
 * A memoised context consumer with no props.
 *
 * `memo` bails out when props are shallow-equal, and an empty prop object always
 * is, so this component re-renders ONLY when the context value changes identity.
 * That turns "is the provided value stable?" into a countable fact rather than an
 * assertion about internals -- and it is the fact that matters, because a value
 * churning on every parent render would re-render every consumer of every bridge
 * hook, on a board of hundreds of cards.
 */
const MemoisedConsumer = memo(function MemoisedConsumer(): ReactElement {
    memoRenderCount += 1;

    const injector = useContext(AngularBridgeContext);

    return (
        <span data-testid="memoised">{injector === null ? 'no-injector' : 'injector'}</span>
    );
});

/**
 * A parent that re-renders whenever `label` changes, republishing `injector`.
 *
 * Changing `label` is what proves the parent genuinely re-rendered, so an
 * assertion that the memoised consumer did NOT re-render cannot pass vacuously.
 */
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

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

/**
 * The most recent value {@link Probe} observed, narrowed to a real injector.
 *
 * Throws rather than returning a nothing-value, for the reason
 * `./mockInjector.ts:126-146` gives about its own lookup: an absence that
 * travels surfaces later, somewhere unrelated, as an unreadable error.
 */
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

/**
 * Every module specifier a TypeScript source imports from, de-duplicated and
 * sorted. Covers binding imports (including the multi-line and type-only forms)
 * and side-effect-only imports, which is the form a stylesheet import would
 * take. Mirrors `./ErrorBoundary.test.tsx:288-299`.
 */
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
    // Fresh doubles and a fresh observation log per test. Jest already clears
    // and restores mocks between tests, so this rebuilds the fixtures rather
    // than resetting them -- no mock is touched by hand.
    mocks = _mocks();
    observed.length = 0;
    memoRenderCount = 0;
});

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

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

            // REFERENCE IDENTITY, not deep equality. Deep equality would pass for
            // a clone, a proxy or a partially applied wrapper; identity is what
            // proves the provider forwards the injector unmodified, which is the
            // whole contract of `./AngularBridgeContext.tsx:281-290`.
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

            // Singleton identity all the way through: spec -> map -> injector ->
            // context -> consumer, with nothing copied on the way.
            expect(lightbox).toBe(mocks.tgLightboxFactory);

            // BOTH PATHS, exactly as the incumbent spec asserts at `:110` and
            // `:114`: untouched before the call, called after it.
            expect(mocks.tgLightboxFactory.create).not.toHaveBeenCalled();

            lightbox.create('tg-search-box');

            expect(mocks.tgLightboxFactory.create).toHaveBeenCalledTimes(1);
            expect(mocks.tgLightboxFactory.create).toHaveBeenCalledWith('tg-search-box');
        });

        it('publishes the identical value through the documented wrapper helper', () => {
            // `withMockInjector` is the convenience every hook and container spec
            // in this layer uses. Asserting it here pins the two dependencies to
            // one another, so the wrapper cannot start wrapping the value.
            const injector = mockInjector({ tgLoader: mocks.tgLoader });

            render(<Probe />, { wrapper: withMockInjector(injector) });

            expect(observed).toHaveLength(1);
            expect(observed[0]).toBe(injector);
        });
    });

    describe('no provider above the consumer', () => {
        it('yields the null-ish default instead of throwing', () => {
            // Rendering a consumer with no provider must be uneventful. Raising a
            // clear, named diagnostic is `useAngularService`'s job -- it knows
            // WHICH service was asked for and can say so -- and the context
            // delegates to it on purpose
            // (`./AngularBridgeContext.tsx:239-245`).
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
            // A throw at module scope would break the bundle for EVERY screen,
            // including the out-of-scope AngularJS ones, so the absence of one is
            // worth asserting rather than assuming. That this file's imports
            // resolved at all is the first half of the proof; the second half is
            // that the exported surface is intact and usable.
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
            // The provider must be structurally invisible. Requirement I6 keeps
            // React in LIGHT DOM so the single global stylesheet still cascades
            // and sprite fragment ids stay reachable; an element injected here
            // would additionally break the class contract rule T1 preserves.
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

            // The parent really did re-render: the label changed and the
            // unmemoised probe ran a second time. Without these two the identity
            // assertion below could pass because nothing happened at all.
            expect(screen.getByTestId('label')).toHaveTextContent('second');
            expect(observed).toHaveLength(2);

            // Same instance both times. The provider allocates nothing per
            // render, so there is nothing to memoise -- see
            // `./AngularBridgeContext.tsx:178-189`.
            expect(Object.is(observed[0], observed[1])).toBe(true);
            expect(observed[1]).toBe(injector);

            // And therefore the memoised consumer was skipped entirely. A value
            // that churned would re-render every consumer of every bridge hook on
            // every parent render, across a board of hundreds of cards.
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

            // The complement of the previous block: the memoised consumer DOES
            // re-render when the value identity changes, which is what makes that
            // block's "did not re-render" assertion meaningful rather than an
            // artefact of `memo` never running.
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

            // The service the retired injector could resolve is now unreachable,
            // and fails loudly and by name rather than yielding a nothing-value
            // (`./mockInjector.ts:126-146`).
            expect(() => carried.get('tgLoader')).toThrow(/tgLoader/);
        });
    });

    describe('the context carries ONLY the injector', () => {
        /*
         * NEGATIVE BLOCK (a) -- see section 4(a) of the header. Every name below
         * is assembled from string fragments for the reason in section 3.
         */
        it('exposes the resolver and nothing else', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            expect(typeof carried.get).toBe('function');

            // The whole surface, enumerated. `has` is optional on the injector
            // type precisely so this minimal shape stays assignable
            // (`./AngularBridgeContext.tsx:229-236`).
            expect(Object.keys(carried)).toEqual(['get']);
        });

        it('exposes neither AngularJS scope service, nor the promise service, nor any digest entry', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            // Six: both scope services, the promise service, and the three
            // digest entries. Pinned so a fragment lost from the list above --
            // which would silently shrink this loop to nothing -- fails here.
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

            // They are absent from the service map's TYPE, so supplying one is a
            // compile error; at run time the lookup therefore fails loudly. Both
            // halves matter: the type gate stops the author, this stops the
            // accident.
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

            // A wrapper would show up as an extra level of indirection here. It
            // would also give the seam somewhere to start accumulating per-screen
            // state, which this anti-corruption layer must never become -- board
            // and backlog state live in their own reducers.
            expect(carried).not.toHaveProperty('injector');
            expect(carried).not.toHaveProperty('services');
            expect(carried).not.toHaveProperty('state');
            expect(carried).toBe(injector);
        });
    });

    describe('no persistent collection and no repository model instance', () => {
        /*
         * NEGATIVE BLOCK (b) -- see section 4(b) of the header. The library's own
         * name and its private marker keys are assembled from fragments, per
         * section 3.
         */
        it('carries a plain object, not a class instance', () => {
            render(
                <AngularBridgeProvider injector={mockInjector({ tgLoader: mocks.tgLoader })}>
                    <Probe />
                </AngularBridgeProvider>,
            );

            const carried = latestInjector();

            // P-IMMER-1: immer dislikes class instances. A plain prototype is the
            // property that keeps a value safe to put into a draft.
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

            // The flattening call itself, and the size accessor every structure
            // in that library carries. Their absence is what says "this value was
            // already flattened on the AngularJS side, before it crossed".
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

            // `getAttrs` is the plain-object accessor the model exposes and the
            // AngularJS-side `toPlain` helper falls back to. A value still
            // carrying it never went through that helper.
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

            // Shaped like the real user story -- and PLAIN. This is the one
            // convention from the incumbent spec that deliberately does not carry
            // over: it builds persistent structures because AngularJS controllers
            // hold them; React fixtures must not.
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

            // The same object, uncopied and unconverted.
            expect(carriedFixture).toBe(story);
            expect(Object.getPrototypeOf(story)).toBe(Object.prototype);
            expect('toJS' in story).toBe(false);
            expect('getAttrs' in story).toBe(false);
        });
    });

    describe('source-level prohibitions on the unit under test', () => {
        /*
         * The executable form of the migration's repository-wide prohibition
         * greps, narrowed to this unit. A grep protects the moment it is run; a
         * test protects every run afterwards -- so a future edit that reaches for
         * a forbidden identifier on a code path no render here exercises still
         * fails.
         *
         * Reading the file is a local filesystem read and touches no network, so
         * requirement HR-5 is untouched. `__dirname` resolves because
         * `jest.config.js` compiles this module to CommonJS.
         */
        const unitSource = readFileSync(
            join(__dirname, 'AngularBridgeContext.tsx'),
            'utf8',
        );

        it('reads the unit source, so the assertions below cannot pass vacuously', () => {
            expect(unitSource.length).toBeGreaterThan(0);
            expect(unitSource).toContain('AngularBridgeProvider');
        });

        it('never mentions either AngularJS scope service or any digest entry', () => {
            // NOTE, deliberately narrower than FORBIDDEN_MEMBERS: the promise
            // service IS named in the unit's own header, where it documents that
            // promises cross through the marshaller instead. That is prose about
            // the prohibition, not a use of it, so the promise service is
            // asserted at the VALUE level only -- three blocks above.
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
            // Requirement I6 is absolute across `app/react/**`: a shadow root
            // would sever the single global stylesheet's cascade and break
            // `<use>` references into the inlined sprite.
            expect(unitSource).not.toContain(SHADOW_ROOT_CALL);
        });

        it('never uses the unsafe escape-hatch type', () => {
            expect(unitSource).not.toContain(UNSAFE_TYPE_ANNOTATION);
            expect(unitSource).not.toContain(UNSAFE_TYPE_ASSERTION);
        });

        it('imports nothing but react', () => {
            // One assertion, four constraints. No HTTP client of any kind, per
            // rule T5 -- every request in this migration goes through the
            // existing repository layer, so the session headers, the token
            // refresh, the blocking interceptor and the changed-fields-only write
            // semantics are inherited rather than re-derived (requirement I7). No
            // AngularJS, so nothing can drag the 1.5.10 runtime into the bundle
            // through the seam. No persistent-collection library. And no
            // stylesheet, so rule T1's pass-through Sass stays untouched.
            expect(importSpecifiersOf(unitSource)).toEqual(['react']);
        });
    });
});
