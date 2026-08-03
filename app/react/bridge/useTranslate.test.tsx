/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render, renderHook, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';
import type { MockServiceMap } from './mockInjector';
import { useTranslate } from './useTranslate';
import type { TranslateFn } from './useTranslate';

const TRANSLATE_CHANGE_END = '$translateChangeEnd';

const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

const LOG_PREFIX = '[taiga-react-bridge:useTranslate]';

const UNIT_FILENAME = 'useTranslate.ts';

const LEGACY_ELEMENT_SELECTOR = `${'tg'}-${'legacy'}`;
const LEGACY_TABLE_KEY = `${'translation'}${'Table'}`;

const LEGACY_TRANSLATIONS_PROPERTY = 'translations';

const FORBIDDEN_SCOPE_MEMBERS: ReadonlyArray<string> = [
    `${'$'}${'apply'}`,
    `${'$'}${'apply'}${'Async'}`,
    `${'$'}${'digest'}`,
    '$broadcast',
    '$emit',
    '$new',
    '$watch',
    '$evalAsync',
    '$destroy',
];

const UNTRANSLATED_LITERALS: ReadonlyArray<{
    readonly literal: string;
    readonly locator: string;
    readonly why: string;
}> = [
    {
        literal: 'WIP Limit',
        locator: 'app/coffee/modules/kanban/main.coffee:839',
        why:
            'Drift Register entry D5. Hardcoded English inside the markup string the ' +
            'incumbent WIP directive injects; ../kanban/WipLimitMarker.tsx emits it ' +
            'verbatim and calls no translation hook.',
    },
    {
        literal: 'Backlog',
        locator: 'app/partials/backlog/backlog.jade:37',
        why: 'The panel heading, written as literal text in the incumbent template.',
    },
    {
        literal: 'Add',
        locator: 'app/partials/includes/modules/sprints.jade:23',
        why: 'The sprint-sidebar link label, written as literal text.',
    },
];

const SEARCH_PLACEHOLDER_KEY = 'COMMON.FILTERS.INPUT_PLACEHOLDER';

type BroadcastListener = (event: unknown, payload: unknown) => void;

interface TranslateDouble {
    readonly instant: jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

    readonly preferredLanguage: jest.Mock<string, []>;

    readonly getTranslationTable: jest.Mock<Record<string, unknown>, [string]>;

    setLanguage(next: string): void;
}

function createTranslateDouble(language = 'en'): TranslateDouble {
    let active = language;

    return {
        instant: jest.fn(
            (key: string, interpolateParams?: Record<string, unknown>): string => {
                const suffix =
                    interpolateParams === undefined
                        ? ''
                        : `(${Object.keys(interpolateParams).sort().join(',')})`;

                return `${active}:${key}${suffix}`;
            },
        ),
        preferredLanguage: jest.fn((): string => active),
        getTranslationTable: jest.fn((_langKey: string): Record<string, unknown> => ({})),
        setLanguage(next: string): void {
            active = next;
        },
    };
}

interface RootScopeFacade {
    readonly $on: jest.Mock<() => void, [string, BroadcastListener]>;
}

interface RootScopeDouble {
    readonly facade: RootScopeFacade;

    readonly deregister: jest.Mock<void, []>;

    emit(payload: unknown): void;

    emitWithSingleArgument(payload: unknown): void;

    listenerCount(eventName: string): number;
}

const DECOY_EVENT_LANGUAGE = 'WRONG-ARGUMENT';

function createRootScopeDouble(): RootScopeDouble {
    const listeners = new Map<string, BroadcastListener[]>();
    const deregister = jest.fn<void, []>();

    const $on = jest.fn<() => void, [string, BroadcastListener]>(
        (eventName: string, listener: BroadcastListener): (() => void) => {
            listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);

            return deregister;
        },
    );

    function each(callback: (listener: BroadcastListener) => void): void {
        [...(listeners.get(TRANSLATE_CHANGE_END) ?? [])].forEach(callback);
    }

    return {
        facade: Object.freeze({ $on }),
        deregister,
        emit(payload: unknown): void {
            const eventObject = {
                name: TRANSLATE_CHANGE_END,
                language: DECOY_EVENT_LANGUAGE,
                defaultPrevented: false,
            };

            each((listener: BroadcastListener): void => {
                listener(eventObject, payload);
            });
        },
        emitWithSingleArgument(payload: unknown): void {
            each((listener: BroadcastListener): void => {
                (listener as (single: unknown) => void)(payload);
            });
        },
        listenerCount(eventName: string): number {
            return (listeners.get(eventName) ?? []).length;
        },
    };
}

interface DigestTripwireScope {
    readonly facade: Readonly<Record<string, unknown>>;

    readonly forbidden: ReadonlyMap<string, jest.Mock<unknown, unknown[]>>;

    readonly deregister: jest.Mock<void, []>;

    emit(payload: unknown): void;
}

function createDigestTripwireScope(): DigestTripwireScope {
    const listeners: BroadcastListener[] = [];
    const deregister = jest.fn<void, []>();
    const forbidden = new Map<string, jest.Mock<unknown, unknown[]>>();
    const facade: Record<string, unknown> = {
        $on: jest.fn(
            (eventName: string, listener: BroadcastListener): (() => void) => {
                if (eventName === TRANSLATE_CHANGE_END) {
                    listeners.push(listener);
                }

                return deregister;
            },
        ),
    };

    for (const member of FORBIDDEN_SCOPE_MEMBERS) {
        const spy = jest.fn<unknown, unknown[]>();

        forbidden.set(member, spy);
        facade[member] = spy;
    }

    return {
        facade,
        forbidden,
        deregister,
        emit(payload: unknown): void {
            const eventObject = { name: TRANSLATE_CHANGE_END, defaultPrevented: false };

            [...listeners].forEach((listener: BroadcastListener): void => {
                listener(eventObject, payload);
            });
        },
    };
}

function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>> = {},
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

function bridgeFor(
    translate: TranslateDouble,
    rootScope: RootScopeDouble,
): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: translate },
            { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade },
        ),
    );
}

function silenceWarnings(): jest.SpyInstance {
    return jest.spyOn(console, 'warn').mockImplementation((): undefined => undefined);
}

function silenceRenderErrors(): jest.SpyInstance {
    return jest.spyOn(console, 'error').mockImplementation((): undefined => undefined);
}

interface ProbeProps {
    readonly translationKey: string;

    readonly onRender?: (t: TranslateFn, renderCount: number) => void;
}

function TranslationProbe({ translationKey, onRender }: ProbeProps): ReactElement {
    const t = useTranslate();
    const renderCountRef = useRef(0);

    renderCountRef.current += 1;

    useEffect((): void => {
        onRender?.(t, renderCountRef.current);
    });

    return (
        <output data-testid="probe" data-render-count={renderCountRef.current}>
            {t(translationKey)}
        </output>
    );
}

describe('useTranslate', () => {
    describe('⭐1 delegation to $translate.instant', () => {
        it('passes the exact key through, with no interpolation values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(result.current('US.ADD')).toBe('en:US.ADD');

            expect(translate.instant).toHaveBeenCalledTimes(1);
            expect(translate.instant).toHaveBeenCalledWith('US.ADD', undefined);
        });

        it('forwards interpolation values BY REFERENCE, not by copy', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const interpolateParams = { n: 3, name: 'Sprint 2026-5-15' };

            expect(result.current('SOME.KEY', interpolateParams)).toBe('en:SOME.KEY(n,name)');

            const forwarded = translate.instant.mock.calls[0]?.[1];

            expect(Object.is(forwarded, interpolateParams)).toBe(true);
        });

        it('returns whatever the service returns, inventing no fallback', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            translate.instant.mockReturnValueOnce('BACKLOG.NOT.A.REAL.KEY');

            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(result.current('BACKLOG.NOT.A.REAL.KEY')).toBe('BACKLOG.NOT.A.REAL.KEY');
        });

        it('does not consult the service until `t` is actually called', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(translate.instant).not.toHaveBeenCalled();
        });

        it('resolves one shared $translate through the mandated seam, by identity', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const wrapper = bridgeFor(translate, rootScope);

            const first = renderHook((): TranslateFn => useTranslate(), { wrapper });
            const second = renderHook((): TranslateFn => useTranslate(), { wrapper });

            first.result.current('US.ADD');
            second.result.current('US.DELETE');

            expect(translate.instant.mock.calls.map((call): string => call[0])).toEqual([
                'US.ADD',
                'US.DELETE',
            ]);
        });
    });

    describe('⭐2 the language is read from the SECOND handler argument', () => {
        it('registers exactly one listener, under the exact AngularJS event name', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(rootScope.facade.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.facade.$on).toHaveBeenCalledWith(
                TRANSLATE_CHANGE_END,
                expect.any(Function),
            );
            expect(rootScope.listenerCount(TRANSLATE_CHANGE_END)).toBe(1);
        });

        it('re-renders with the NEW strings when the language really changes', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(screen.getByTestId('probe')).toHaveTextContent('en:US.ADD');

            const callsBeforeChange = translate.instant.mock.calls.length;

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            expect(screen.getByTestId('probe')).toHaveTextContent('es:US.ADD');
            expect(translate.instant.mock.calls.length).toBeGreaterThan(callsBeforeChange);
            expect(screen.getByTestId('probe')).toHaveAttribute('data-render-count', '2');
        });

        it('reads the payload, NOT the `language` sitting on the event object', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renderCounts: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renderCounts.push(renderCount);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            act((): void => {
                rootScope.emit({ language: DECOY_EVENT_LANGUAGE });
            });

            expect(renderCounts[renderCounts.length - 1]).toBe(3);
        });

        it('observes nothing when the handler is invoked with a single argument', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                rootScope.emitWithSingleArgument({ language: 'es' });
            });

            expect(Object.is(result.current, before)).toBe(true);
        });
    });

    describe('⭐3 the guard of app/coffee/app.coffee:968', () => {
        it('does NOT re-render when the emission carries the language already seen', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renderCounts: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renderCounts.push(renderCount);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const rendersAfterRealChange = renderCounts[renderCounts.length - 1];
            const callsAfterRealChange = translate.instant.mock.calls.length;

            act((): void => {
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
            });

            expect(renderCounts[renderCounts.length - 1]).toBe(rendersAfterRealChange);
            expect(translate.instant.mock.calls.length).toBe(callsAfterRealChange);
        });

        it('processes every emission of a batch, ending on the LAST language', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const identities: TranslateFn[] = [];
            const latest = (): TranslateFn | undefined => identities[identities.length - 1];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(t: TranslateFn): void => {
                        identities.push(t);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            act((): void => {
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'ca' });
            });

            expect(new Set<TranslateFn>(identities).size).toBe(2);

            const afterBatch = latest();

            act((): void => {
                rootScope.emit({ language: 'ca' });
            });

            expect(Object.is(latest(), afterBatch)).toBe(true);

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(Object.is(latest(), afterBatch)).toBe(false);
        });

        it('advances the memo key on EVERY real change, not only the first', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const identities: TranslateFn[] = [result.current];

            for (const language of ['es', 'ca', 'en']) {
                act((): void => {
                    rootScope.emit({ language });
                });

                identities.push(result.current);
            }

            expect(new Set<TranslateFn>(identities).size).toBe(4);
        });

        it('reacts again after the language returns to a previously seen value', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const afterFirstChange = result.current;

            act((): void => {
                rootScope.emit({ language: 'en' });
            });

            expect(Object.is(result.current, afterFirstChange)).toBe(false);
        });

        it('accepts the empty string, because the incumbent compares raw values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                rootScope.emit({ language: '' });
            });

            expect(Object.is(result.current, before)).toBe(false);
        });

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['a bare string', 'es'],
            ['a number', 7],
            ['an object with no language', { locale: 'es' }],
            ['an object whose language is not a string', { language: 42 }],
            ['an object whose language is null', { language: null }],
        ])(
            'ignores, without throwing, a payload that is %s',
            (_label: string, payload: unknown) => {
                const translate = createTranslateDouble('en');
                const rootScope = createRootScopeDouble();
                const { result } = renderHook((): TranslateFn => useTranslate(), {
                    wrapper: bridgeFor(translate, rootScope),
                });

                const before = result.current;

                expect((): void => {
                    act((): void => {
                        rootScope.emit(payload);
                    });
                }).not.toThrow();

                expect(Object.is(result.current, before)).toBe(true);
            },
        );
    });

    describe('⭐4 deregistration on unmount', () => {
        it('calls the captured deregistration function EXACTLY ONCE', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('does not resubscribe on re-render: one mount, one listener, one teardown', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { rerender, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            rerender();
            rerender();

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(rootScope.facade.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('gives every mounted caller its own listener and removes each one', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const wrapper = bridgeFor(translate, rootScope);

            const first = renderHook((): TranslateFn => useTranslate(), { wrapper });
            const second = renderHook((): TranslateFn => useTranslate(), { wrapper });

            expect(rootScope.facade.$on).toHaveBeenCalledTimes(2);
            expect(rootScope.listenerCount(TRANSLATE_CHANGE_END)).toBe(2);

            first.unmount();
            second.unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(2);
        });

        it('warns instead of throwing when AngularJS returns no deregistration function', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            rootScope.facade.$on.mockImplementationOnce((): (() => void) => {
                return undefined as unknown as () => void;
            });

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
            expect(warn.mock.calls[0]?.[0]).toContain(TRANSLATE_CHANGE_END);
        });

        /**
         * A payload whose `language` is a GETTER, so every read is observable.
         *
         * This is how "the listener did nothing" is asserted rather than assumed.
         * Calling a state setter after unmount is a silent no-op in React 18, so a
         * leaked listener cannot be caught by watching for a warning; counting
         * payload reads catches it directly, because the disposed latch is checked
         * BEFORE the payload is touched.
         */
        function observablePayload(language: string): {
            readonly payload: unknown;
            reads(): number;
        } {
            let reads = 0;

            return {
                payload: {
                    get language(): string {
                        reads += 1;

                        return language;
                    },
                },
                reads: (): number => reads,
            };
        }

        it('latches the listener INERT when AngularJS returns no deregistration function', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            // Registration still happens; only the RETURN VALUE is withheld, which
            // is the situation being tested: the unit is given nothing to call, so
            // the listener necessarily stays attached to an object that outlives
            // every React root. The listener is therefore invoked through the
            // recorded call rather than through the double's dispatcher, because
            // this implementation deliberately bypasses the double's registry.
            rootScope.facade.$on.mockImplementationOnce(
                (): (() => void) => undefined as unknown as () => void,
            );

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const listener = rootScope.facade.$on.mock.calls[0]?.[1];

            expect(typeof listener).toBe('function');

            const eventObject = { name: TRANSLATE_CHANGE_END };
            const live = observablePayload('es');

            act((): void => {
                listener?.(eventObject, live.payload);
            });

            // While mounted the handler reads the payload, so the probe is known to
            // be sensitive rather than trivially satisfied below.
            expect(live.reads()).toBe(1);

            unmount();

            const afterUnmount = observablePayload('ca');

            // Warning about an unremovable listener and moving on would leave it
            // LIVE, holding a closure over an unmounted component's state setter for
            // the rest of the session and accumulating one more on every navigation.
            expect((): void => {
                listener?.(eventObject, afterUnmount.payload);
            }).not.toThrow();

            // ⭐ THE ASSERTION THAT MATTERS: the residue did no work at all. Not one
            // property read, so no ref write and no state update either.
            expect(afterUnmount.reads()).toBe(0);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain('latched inert');
        });

        it('latches the listener INERT when the deregistration function throws', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            rootScope.deregister.mockImplementation((): never => {
                throw new Error('deregistration exploded');
            });

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const live = observablePayload('es');

            act((): void => {
                rootScope.emit(live.payload);
            });

            expect(live.reads()).toBe(1);

            unmount();

            const afterUnmount = observablePayload('ca');

            expect((): void => {
                rootScope.emit(afterUnmount.payload);
            }).not.toThrow();

            // The latch is set BEFORE the fallible deregistration call, which is why
            // a throwing teardown cannot leave a live listener behind.
            expect(afterUnmount.reads()).toBe(0);
            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
        });

        it('re-arms the listener when the effect resubscribes rather than unmounts', () => {
            const translate = createTranslateDouble('en');
            const first = createRootScopeDouble();
            const second = createRootScopeDouble();

            // Resolving a DIFFERENT host is what makes the effect tear down and
            // resubscribe, which must not be mistaken for a teardown: the latch has
            // to be cleared again or live switching would be lost for the rest of
            // the mount, silently.
            const { rerender } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, first),
            });

            rerender();

            const rearmed = observablePayload('es');

            act((): void => {
                first.emit(rearmed.payload);
            });

            expect(rearmed.reads()).toBe(1);
            expect(second.facade.$on).not.toHaveBeenCalled();
        });

        it('survives a deregistration function that itself throws', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            rootScope.deregister.mockImplementationOnce((): never => {
                throw new Error('deregistration exploded');
            });

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
        });
    });

    describe('⭐5 the identity of `t`', () => {
        it('is STABLE across re-renders that do not change the language', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result, rerender } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const first = result.current;

            rerender();
            rerender();

            expect(Object.is(result.current, first)).toBe(true);
        });

        it('is STABLE across guard-suppressed emissions', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'en' });
            });

            const afterFirst = result.current;

            act((): void => {
                rootScope.emit({ language: 'en' });
                rootScope.emit({ language: 'en' });
            });

            expect(Object.is(result.current, afterFirst)).toBe(true);
        });

        it('CHANGES when the language changes, so memoised children re-render', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            expect(Object.is(result.current, before)).toBe(false);
            expect(result.current('US.ADD')).toBe('es:US.ADD');
        });
    });

    describe('⛔6 the incumbent legacy-element translation-table push is NOT reproduced', () => {
        it('never queries the document for the legacy custom element', () => {
            const querySelector = jest.spyOn(document, 'querySelector');
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            unmount();

            expect(querySelector).not.toHaveBeenCalledWith(LEGACY_ELEMENT_SELECTOR);
            expect(querySelector).not.toHaveBeenCalled();
        });

        it('never reads the whole translation table', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            result.current('US.ADD');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            result.current('US.ADD');

            expect(translate.getTranslationTable).not.toHaveBeenCalled();
            expect(translate.preferredLanguage).not.toHaveBeenCalled();
        });

        it('assigns no translations property to any element in the document', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const touched = Array.from(document.querySelectorAll('*')).filter(
                (element: Element): boolean => LEGACY_TRANSLATIONS_PROPERTY in element,
            );

            expect(touched).toEqual([]);
        });

        it('does not even name the hand-off in its own source', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

            expect(unitSource.length).toBeGreaterThan(0);
            expect(unitSource).not.toContain('querySelector');
            expect(unitSource).not.toContain(LEGACY_ELEMENT_SELECTOR);
            expect(unitSource).not.toContain(LEGACY_TABLE_KEY);
        });
    });

    describe('⛔7 no AngularJS digest is ever driven', () => {
        it('calls none of the forbidden scope members, in any phase', () => {
            const translate = createTranslateDouble('en');
            const tripwire = createDigestTripwireScope();

            const { result, rerender, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(
                    createInjector(
                        { $translate: translate },
                        { [ROOT_SCOPE_SERVICE_NAME]: tripwire.facade },
                    ),
                ),
            });

            result.current('US.ADD');

            act((): void => {
                tripwire.emit({ language: 'es' });
            });

            rerender();
            result.current('US.ADD');
            unmount();

            for (const member of FORBIDDEN_SCOPE_MEMBERS) {
                const spy = tripwire.forbidden.get(member);

                expect(spy).toBeDefined();
                expect(spy).not.toHaveBeenCalled();
            }

            expect(tripwire.deregister).toHaveBeenCalledTimes(1);
        });

        it('names no digest driver in its own source', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');
            const digestDrivers = FORBIDDEN_SCOPE_MEMBERS.slice(0, 3);

            expect(digestDrivers).toHaveLength(3);

            for (const driver of digestDrivers) {
                expect(unitSource).not.toContain(driver);
            }
        });

        it('registers no interval, no timeout and no observer', () => {
            const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { result, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            result.current('US.ADD');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            unmount();

            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(setTimeoutSpy).not.toHaveBeenCalled();
        });
    });

    describe('⛔8 the root scope is touched through a one-member surface', () => {
        it('needs nothing but $on: a facade with exactly one own property suffices', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            expect(Object.keys(rootScope.facade)).toEqual(['$on']);
            expect(Reflect.ownKeys(rootScope.facade)).toHaveLength(1);

            const { result, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            expect(result.current('US.ADD')).toBe('es:US.ADD');

            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('resolves the root scope by its exact injector name, through the named accessor', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const resolved: string[] = [];
            const base = createInjector(
                { $translate: translate },
                { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade },
            );
            const recordingInjector: AngularInjector = {
                get<T>(name: string): T {
                    resolved.push(name);

                    return base.get<T>(name);
                },
            };

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(recordingInjector),
            });

            expect(resolved).toEqual(['$translate', ROOT_SCOPE_SERVICE_NAME]);
        });

        it.each([
            ['is absent from the injector', undefined],
            ['is null', null],
            ['is not an object', 'not-a-scope'],
            ['exposes no $on at all', { $new: jest.fn() }],
            ['exposes a non-callable $on', { $on: 'nope' }],
        ])(
            'warns once and still translates when the root scope %s',
            (_label: string, rootScope: unknown) => {
                const warn = silenceWarnings();
                const translate = createTranslateDouble('en');

                const { result } = renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(
                        createInjector(
                            { $translate: translate },
                            { [ROOT_SCOPE_SERVICE_NAME]: rootScope },
                        ),
                    ),
                });

                expect(result.current('US.ADD')).toBe('en:US.ADD');
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
                expect(warn.mock.calls[0]?.[0]).toContain(ROOT_SCOPE_SERVICE_NAME);
            },
        );
    });

    describe('the mandated mocking seam fails loudly and by name', () => {
        it('names the service a spec forgot to supply', () => {
            const consoleError = silenceRenderErrors();
            const rootScope = createRootScopeDouble();

            expect((): unknown =>
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(
                        createInjector({}, { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade }),
                    ),
                }),
            ).toThrow(/mockInjector: .*'\$translate'/s);

            expect(consoleError).toHaveBeenCalled();
        });

        it('lists what WAS supplied when the off-map root scope is the omission', () => {
            const consoleError = silenceRenderErrors();
            const translate = createTranslateDouble('en');

            let message = '';

            try {
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(createInjector({ $translate: translate })),
                });
            } catch (failure: unknown) {
                message = failure instanceof Error ? failure.message : String(failure);
            }

            expect(message).toContain(ROOT_SCOPE_SERVICE_NAME);
            expect(message).toContain('$translate');
            expect(message).not.toContain('(nothing)');
            expect(consoleError).toHaveBeenCalled();
        });

        it('names the missing provider when mounted outside the bridge provider', () => {
            const consoleError = silenceRenderErrors();

            expect((): unknown => renderHook((): TranslateFn => useTranslate())).toThrow(
                /useAngularService\('\$translate'\) was called outside <AngularBridgeProvider>/,
            );

            expect((): unknown =>
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(null),
                }),
            ).toThrow(/outside <AngularBridgeProvider>/);

            expect(consoleError).toHaveBeenCalled();
        });

        it('throws a named diagnostic when the resolved $translate has no callable instant', () => {
            const rootScope = createRootScopeDouble();

            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(
                    createInjector(
                        {},
                        {
                            $translate: { preferredLanguage: (): string => 'en' },
                            [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade,
                        },
                    ),
                ),
            });

            expect((): string => result.current('US.ADD')).toThrow(
                new RegExp(`${LOG_PREFIX.replace(/[[\]$]/g, '\\$&')}.*'instant'`, 's'),
            );
            expect((): string => result.current('US.ADD')).toThrow(/US\.ADD/);
        });
    });

    describe('⛔9 the three untranslated literals stay out of the translation path', () => {
        it('documents exactly three of them, each with the locator that fixes it', () => {
            expect(UNTRANSLATED_LITERALS).toHaveLength(3);
            expect(UNTRANSLATED_LITERALS.map((entry): string => entry.literal)).toEqual([
                'WIP Limit',
                'Backlog',
                'Add',
            ]);

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(entry.locator).toMatch(/^app\/[\w./-]+\.(coffee|jade):\d+$/);
                expect(entry.why.length).toBeGreaterThan(0);
            }
        });

        it('is never consulted for any of them during a render', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey={SEARCH_PLACEHOLDER_KEY} />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const keysAsked = translate.instant.mock.calls.map((call): string => call[0]);

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(keysAsked).not.toContain(entry.literal);
            }
        });

        it('would change what renders if a literal were routed through it', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(result.current(entry.literal)).not.toBe(entry.literal);
            }
        });

        it('DOES translate the search placeholder, which really is a key', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(result.current(SEARCH_PLACEHOLDER_KEY)).toBe(`en:${SEARCH_PLACEHOLDER_KEY}`);
            expect(translate.instant).toHaveBeenCalledWith(SEARCH_PLACEHOLDER_KEY, undefined);
        });

        it('has the prohibition documented at the point of change in the unit itself', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(unitSource).toContain(entry.literal);
            }

            expect(unitSource).toContain(SEARCH_PLACEHOLDER_KEY);
        });
    });
});
