/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useAngularService.test.tsx -- co-located spec for the service accessor
 * ==========================================================================
 *
 * Browserless by construction (requirement HR-5): jsdom only, no Playwright
 * import, no real browser, no network, and no dependency on `dist/`. The whole
 * AngularJS injector is replaced by a three-line test double, which is the
 * entire point of the per-hook dependency style this hook enables (requirement
 * I9) -- a spec for a hook that needs one service stands up one service, not
 * the twenty-three the Kanban controller injects.
 *
 * TWO KINDS OF ASSERTION LIVE HERE, and both are load-bearing:
 *
 *  - RUN-TIME assertions, in `it` blocks, checked by Jest.
 *  - COMPILE-TIME assertions, written as type-level equalities that are then
 *    asserted at run time so they are impossible to leave unused. These are the
 *    ones that guarantee the hook does not hand back the unsafe escape-hatch
 *    type: `Equals` below is deliberately built from the two-signature trick
 *    rather than from `extends`, because that construction is the one that
 *    DISTINGUISHES the unsafe type from a real type. A plain
 *    `const x: TaigaResources = useAngularService('$tgResources')` would pass
 *    even if the return type were unsafe, since the unsafe type is assignable
 *    to everything -- so it would prove nothing at all. If the hook's return
 *    type ever degrades, `npx tsc --noEmit` and `npm test` both fail here.
 * ========================================================================== */

import type { ReactElement, ReactNode } from 'react';
import { renderHook } from '@testing-library/react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { useAngularService, useUntypedAngularService } from './useAngularService';
import type {
    AngularServices,
    TaigaEventsService,
    TaigaResources,
    TranslateService,
} from './useAngularService';

/* --------------------------------------------------------------------------
 * Type-level assertion helpers
 * -------------------------------------------------------------------------- */

/**
 * Exact type equality. The two-signature construction is intentional: unlike a
 * mutual-`extends` check, it does NOT consider the unsafe escape-hatch type
 * equal to an arbitrary type, so it is what turns "is this still typed?" into a
 * compile error rather than a silent pass.
 */
type Equals<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/* --------------------------------------------------------------------------
 * Test doubles
 * -------------------------------------------------------------------------- */

/** A recognisable, referentially unique stand-in for a resolved service. */
interface ResolvedStub {
    readonly marker: string;
}

/**
 * Builds an injector double.
 *
 * `has` is omitted by default on purpose, which is the shape the sibling
 * context documents as the common case (`./AngularBridgeContext.tsx:229-236`):
 * it proves that a minimal `{ get }` double stays structurally assignable and
 * that the hook resolves through it without complaint.
 */
function makeInjector(
    resolved: unknown,
): AngularInjector & { get: jest.Mock<unknown, [string]> } {
    const get = jest.fn<unknown, [string]>(() => resolved);

    return { get } as AngularInjector & { get: jest.Mock<unknown, [string]> };
}

/** Builds an injector double whose `has` answers from an allow-list. */
function makeInjectorWithHas(
    resolved: unknown,
    registered: readonly string[],
): AngularInjector & {
    get: jest.Mock<unknown, [string]>;
    has: jest.Mock<boolean, [string]>;
} {
    const get = jest.fn<unknown, [string]>(() => resolved);
    const has = jest.fn<boolean, [string]>((name: string) => registered.includes(name));

    return { get, has } as AngularInjector & {
        get: jest.Mock<unknown, [string]>;
        has: jest.Mock<boolean, [string]>;
    };
}

/** Wraps a hook under test in a provider carrying `injector`. */
function withInjector(
    injector: AngularInjector | null,
): (props: { children?: ReactNode }) => ReactElement {
    return function Wrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

/**
 * Every key of the service map, kept exhaustive by the `Missing` check below so
 * that adding a key without extending this list is a compile error.
 */
const ALL_SERVICE_NAMES = [
    '$tgResources',
    'tgResources',
    '$tgRepo',
    '$tgModel',
    '$tgEvents',
    '$translate',
    '$tgConfirm',
    'tgErrorHandlingService',
    'tgProjectService',
    '$tgStorage',
    'tgLightboxFactory',
    'tgLoader',
    '$tgNavUrls',
    'tgFilterRemoteStorageService',
    '$tgAnalytics',
] as const satisfies readonly (keyof AngularServices)[];

/**
 * React logs a component error to the console before rethrowing it. The
 * throwing specs silence exactly that, so a deliberate failure does not look
 * like a broken suite. `restoreMocks: true` in `jest.config.js` restores the
 * real console afterwards.
 */
function silenceReactErrorLog(): void {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

describe('useAngularService', () => {
    describe('type contract (compile-time, asserted at run time)', () => {
        it('returns the mapped service type and NOT the unsafe escape-hatch type', () => {
            // Each of these fails to compile if the corresponding return type
            // degrades -- to the unsafe type, to `unknown`, or to anything other
            // than the exact mapped facade.
            const resourcesIsExact: Equals<
                ReturnType<typeof useAngularService<'$tgResources'>>,
                TaigaResources
            > = true;
            const eventsIsExact: Equals<
                ReturnType<typeof useAngularService<'$tgEvents'>>,
                TaigaEventsService
            > = true;
            const translateIsExact: Equals<
                ReturnType<typeof useAngularService<'$translate'>>,
                TranslateService
            > = true;

            expect(resourcesIsExact).toBe(true);
            expect(eventsIsExact).toBe(true);
            expect(translateIsExact).toBe(true);
        });

        it('exposes the untyped escape hatch as `unknown`, forcing the caller to narrow', () => {
            const escapeIsUnknown: Equals<
                ReturnType<typeof useUntypedAngularService>,
                unknown
            > = true;

            expect(escapeIsUnknown).toBe(true);
        });

        it('covers every key of the service map in this spec', () => {
            type Missing = Exclude<keyof AngularServices, (typeof ALL_SERVICE_NAMES)[number]>;

            const nothingMissing: Equals<Missing, never> = true;

            expect(nothingMissing).toBe(true);
            expect(ALL_SERVICE_NAMES).toHaveLength(15);
        });

        it('types resource members concretely enough to be called', () => {
            const resources: TaigaResources = {
                userstories: {
                    get: jest.fn(),
                    getByRef: jest.fn(),
                    listAll: jest.fn(),
                    listUnassigned: jest.fn(),
                    filtersData: jest.fn(),
                    bulkCreate: jest.fn(),
                    bulkUpdateBacklogOrder: jest.fn(),
                    bulkUpdateKanbanOrder: jest.fn(),
                    bulkUpdateMilestone: jest.fn(),
                    storeQueryParams: jest.fn(),
                    storeBacklog: jest.fn(),
                    storeShowTags: jest.fn(),
                    getShowTags: jest.fn(() => null),
                },
                sprints: { list: jest.fn() },
                swimlanes: { list: jest.fn() },
                kanban: {
                    storeStatusColumnModes: jest.fn(),
                    getStatusColumnModes: jest.fn(() => ({})),
                    storeSwimlanesModes: jest.fn(),
                    getSwimlanesModes: jest.fn(() => ({})),
                },
                projects: { stats: jest.fn(), tagsColors: jest.fn() },
            };

            const injector = makeInjector(resources);
            const { result } = renderHook(() => useAngularService('$tgResources'), {
                wrapper: withInjector(injector),
            });

            // Reached through the mapped type, so a rename in the facade breaks
            // compilation here rather than silently at run time in the browser.
            result.current.userstories.storeShowTags(7, true);
            result.current.kanban.storeSwimlanesModes(7, { 1: 'collapsed' });

            expect(resources.userstories.storeShowTags).toHaveBeenCalledWith(7, true);
            expect(resources.kanban.storeSwimlanesModes).toHaveBeenCalledWith(7, {
                1: 'collapsed',
            });
        });
    });

    describe('resolution', () => {
        it('returns exactly the instance the injector resolved, by reference', () => {
            const resolved: ResolvedStub = { marker: 'the-one-true-singleton' };
            const injector = makeInjector(resolved);

            const { result } = renderHook(() => useAngularService('$tgConfirm'), {
                wrapper: withInjector(injector),
            });

            // Identity, not equality: no proxy, no clone, no partial application.
            expect(result.current).toBe(resolved);
        });

        it('asks the injector for the exact name it was given', () => {
            const injector = makeInjector({ marker: 'events' });

            renderHook(() => useAngularService('$tgEvents'), {
                wrapper: withInjector(injector),
            });

            expect(injector.get).toHaveBeenCalledTimes(1);
            expect(injector.get).toHaveBeenCalledWith('$tgEvents');
        });

        it('resolves every key of the service map through the same code path', () => {
            const injector = makeInjector({ marker: 'any-service' });

            for (const name of ALL_SERVICE_NAMES) {
                const { result } = renderHook(() => useAngularService(name), {
                    wrapper: withInjector(injector),
                });

                expect(result.current).toEqual({ marker: 'any-service' });
            }

            expect(injector.get.mock.calls.map(([name]) => name)).toEqual([
                ...ALL_SERVICE_NAMES,
            ]);
        });

        it('keeps `$tgResources` and `tgResources` distinct', () => {
            const injector = makeInjector({ marker: 'either' });

            renderHook(
                () => {
                    useAngularService('$tgResources');
                    useAngularService('tgResources');
                },
                { wrapper: withInjector(injector) },
            );

            expect(injector.get).toHaveBeenNthCalledWith(1, '$tgResources');
            expect(injector.get).toHaveBeenNthCalledWith(2, 'tgResources');
        });

        it('is a pure lookup: it re-resolves per render and stores nothing', () => {
            const resolved: ResolvedStub = { marker: 'singleton' };
            const injector = makeInjector(resolved);

            const { result, rerender } = renderHook(
                () => useAngularService('$tgStorage'),
                { wrapper: withInjector(injector) },
            );

            const first = result.current;

            rerender();

            // Same instance across renders, because the injector returns a
            // singleton -- so stability needs no memoisation here.
            expect(result.current).toBe(first);
            expect(injector.get.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('accepts a minimal `{ get }` double with no `has`', () => {
            const injector: AngularInjector = { get: <T,>(): T => 42 as unknown as T };

            const { result } = renderHook(() => useAngularService('$tgAnalytics'), {
                wrapper: withInjector(injector),
            });

            expect(result.current).toBe(42);
        });
    });

    describe('missing provider diagnostic', () => {
        it('throws a message naming the hook, the service and the provider', () => {
            silenceReactErrorLog();

            expect(() =>
                renderHook(() => useAngularService('$tgResources')),
            ).toThrow(/useAngularService\('\$tgResources'\)/);
        });

        it('tells the reader what to mount and what to wrap in a test', () => {
            silenceReactErrorLog();

            let message = '';

            try {
                renderHook(() => useAngularService('$tgRepo'));
            } catch (error: unknown) {
                message = error instanceof Error ? error.message : String(error);
            }

            expect(message).toContain('AngularBridgeProvider');
            expect(message).toContain('ReactHostElement');
            expect(message).toContain('get(name)');
        });

        it('throws for an explicitly null injector, not only for a missing provider', () => {
            silenceReactErrorLog();

            expect(() =>
                renderHook(() => useAngularService('tgLoader'), {
                    wrapper: withInjector(null),
                }),
            ).toThrow(/outside <AngularBridgeProvider>/);
        });
    });

    describe('unregistered service diagnostic', () => {
        it('throws when `has` positively reports the name as unregistered', () => {
            silenceReactErrorLog();

            const injector = makeInjectorWithHas({ marker: 'unused' }, []);

            expect(() =>
                renderHook(() => useAngularService('$tgNavUrls'), {
                    wrapper: withInjector(injector),
                }),
            ).toThrow(/no AngularJS service registered/);

            // Fails BEFORE resolution, so the misleading AngularJS
            // "Unknown provider" error is never reached.
            expect(injector.get).not.toHaveBeenCalled();
        });

        it('names the confusable pair in the diagnostic', () => {
            silenceReactErrorLog();

            const injector = makeInjectorWithHas({ marker: 'unused' }, []);
            let message = '';

            try {
                renderHook(() => useAngularService('tgResources'), {
                    wrapper: withInjector(injector),
                });
            } catch (error: unknown) {
                message = error instanceof Error ? error.message : String(error);
            }

            expect(message).toContain("'$tgResources' and 'tgResources'");
        });

        it('resolves normally when `has` reports the name as registered', () => {
            const resolved: ResolvedStub = { marker: 'registered' };
            const injector = makeInjectorWithHas(resolved, ['tgProjectService']);

            const { result } = renderHook(() => useAngularService('tgProjectService'), {
                wrapper: withInjector(injector),
            });

            expect(injector.has).toHaveBeenCalledWith('tgProjectService');
            expect(result.current).toBe(resolved);
        });
    });
});

describe('useUntypedAngularService', () => {
    it('resolves a service outside the map and returns it by reference', () => {
        const resolved: ResolvedStub = { marker: 'tgKanbanUserstories' };
        const injector = makeInjector(resolved);

        const { result } = renderHook(
            () => useUntypedAngularService('tgKanbanUserstories'),
            { wrapper: withInjector(injector) },
        );

        expect(injector.get).toHaveBeenCalledWith('tgKanbanUserstories');
        expect(result.current).toBe(resolved);
    });

    it('returns a value that must be narrowed before use', () => {
        const injector = makeInjector({ marker: 'needs-narrowing' });

        const { result } = renderHook(
            () => useUntypedAngularService('$tgQueueModelTransformation'),
            { wrapper: withInjector(injector) },
        );

        const candidate = result.current;
        let marker = 'not-narrowed';

        // The narrowing is the whole point: without it, `candidate` cannot be
        // dereferenced at all, which is what `unknown` buys over the unsafe type.
        if (
            typeof candidate === 'object' &&
            candidate !== null &&
            'marker' in candidate &&
            typeof (candidate as ResolvedStub).marker === 'string'
        ) {
            marker = (candidate as ResolvedStub).marker;
        }

        expect(marker).toBe('needs-narrowing');
    });

    it('raises the same provider diagnostic, under its own name', () => {
        silenceReactErrorLog();

        expect(() =>
            renderHook(() => useUntypedAngularService('tgSomething')),
        ).toThrow(/useUntypedAngularService\('tgSomething'\)/);
    });

    it('raises the same unregistered diagnostic, under its own name', () => {
        silenceReactErrorLog();

        const injector = makeInjectorWithHas({ marker: 'unused' }, ['somethingElse']);

        expect(() =>
            renderHook(() => useUntypedAngularService('tgSomething'), {
                wrapper: withInjector(injector),
            }),
        ).toThrow(/useUntypedAngularService\('tgSomething'\) found no AngularJS service/);
    });
});
