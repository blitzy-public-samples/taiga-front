/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useTranslate.test.tsx -- THE BEHAVIOURAL CONTRACT OF THE TRANSLATION SEAM
 * ==========================================================================
 *
 * Browserless by construction: jsdom supplies the DOM, `$translate` and the
 * AngularJS root scope are hand-built doubles, nothing is fetched, nothing is
 * built, and no browser binary is required (`jest.config.js`).
 *
 * The five specs the folder brief mandates are marked ⭐ below. Each of them
 * pins a behaviour whose absence is SILENT -- no exception, no warning, just a
 * screen that stops updating or a listener that never goes away -- which is why
 * they are asserted directly rather than inferred from a rendered snapshot:
 *
 *   ⭐1 `t` delegates to `instant` with the exact key and interpolation values.
 *   ⭐2 A real language change re-renders the caller.
 *   ⭐3 An emission carrying the SAME language does NOT re-render it
 *       (the guard of `app/coffee/app.coffee:968`).
 *   ⭐4 The language is read from the SECOND handler argument
 *       (the signature of `app/coffee/app.coffee:967`); a single-argument
 *       invocation therefore observes nothing.
 *   ⭐5 Unmount calls the captured deregistration function exactly once
 *       (the precedent of `app/coffee/modules/common/components.coffee:57`
 *       with `:70`-`:73`).
 *   ⭐6 `t` keeps a stable identity across renders that do not change the
 *       language, and takes a new one when the language does change.
 *
 * The remaining specs cover the degradation paths, because a bridge that
 * crashes a subtree when a double is imperfect is not usable by the rest of the
 * migration's specs.
 * ========================================================================== */

import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { render, renderHook, screen, act } from '@testing-library/react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { useTranslate } from './useTranslate';
import type { TranslateFn } from './useTranslate';

/* --------------------------------------------------------------------------
 * Doubles
 * -------------------------------------------------------------------------- */

/** The AngularJS event name, spelled as angular-translate raises it. */
const TRANSLATE_CHANGE_END = '$translateChangeEnd';

/** The listener shape AngularJS calls: event object first, payload second. */
type BroadcastListener = (event: unknown, payload: unknown) => void;

/**
 * A root-scope double that records its listeners so a spec can raise the event
 * itself, and hands back a deregistration spy so teardown can be asserted.
 */
interface RootScopeDouble {
    readonly $on: jest.Mock<() => void, [string, BroadcastListener]>;
    readonly deregister: jest.Mock<void, []>;
    /** Raises the event the way AngularJS does: `(eventObject, payload)`. */
    emit(payload: unknown): void;
    /** Raises it the WRONG way -- payload in the first position, nothing after. */
    emitWithSingleArgument(payload: unknown): void;
    /** Registered listener count, for the "exactly one listener" assertions. */
    listenerCount(eventName: string): number;
}

function createRootScopeDouble(): RootScopeDouble {
    const listeners = new Map<string, BroadcastListener[]>();
    const deregister = jest.fn<void, []>();

    const $on = jest.fn<() => void, [string, BroadcastListener]>(
        (eventName: string, listener: BroadcastListener): (() => void) => {
            const existing = listeners.get(eventName) ?? [];

            listeners.set(eventName, [...existing, listener]);

            return deregister;
        },
    );

    function each(callback: (listener: BroadcastListener) => void): void {
        // Copied before iteration, exactly as AngularJS does, so a listener that
        // unsubscribes during dispatch cannot disturb the walk.
        [...(listeners.get(TRANSLATE_CHANGE_END) ?? [])].forEach(callback);
    }

    return {
        $on,
        deregister,
        emit(payload: unknown): void {
            // The AngularJS event object. Deliberately given a `language`
            // property so that a handler reading the FIRST argument would find
            // a plausible-looking wrong answer instead of `undefined` -- that is
            // what makes spec ⭐4 discriminating.
            const eventObject = {
                name: TRANSLATE_CHANGE_END,
                language: 'WRONG-ARGUMENT',
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

/** A `$translate` double whose `instant` echoes the key with its language. */
function createTranslateDouble(language = 'en'): {
    instant: jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;
    setLanguage(next: string): void;
} {
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
        setLanguage(next: string): void {
            active = next;
        },
    };
}

/**
 * Builds an injector double over an explicit name-to-service table.
 *
 * `has` is omitted on purpose. The sibling accessors only reject a name when
 * `has` is present AND returns exactly `false` (`./useAngularService.ts`), so
 * omitting it keeps these doubles minimal and exercises the resolution path the
 * browser actually takes.
 */
function createInjector(services: Readonly<Record<string, unknown>>): AngularInjector {
    return {
        get<T>(name: string): T {
            return services[name] as T;
        },
    };
}

function wrapperFor(injector: AngularInjector): (props: { children?: ReactNode }) => ReactElement {
    return function Wrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

/** Silences the deliberate diagnostics of the degradation specs. */
function silenceWarnings(): jest.SpyInstance {
    return jest.spyOn(console, 'warn').mockImplementation(() => undefined);
}

/* --------------------------------------------------------------------------
 * A probe component: counts its own renders and publishes `t`'s identity.
 * -------------------------------------------------------------------------- */

interface ProbeProps {
    readonly translationKey: string;
    readonly onRender?: (t: TranslateFn, renderCount: number) => void;
}

function TranslationProbe({ translationKey, onRender }: ProbeProps): ReactElement {
    const t = useTranslate();
    const renderCountRef = useRef(0);

    renderCountRef.current += 1;

    // Reported from an effect rather than from the render body so the count is
    // only published for renders React actually commits.
    useEffect((): void => {
        onRender?.(t, renderCountRef.current);
    });

    return (
        <output data-testid="probe" data-render-count={renderCountRef.current}>
            {t(translationKey)}
        </output>
    );
}

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

describe('useTranslate', () => {
    describe('⭐1 delegation to $translate.instant', () => {
        it('passes the exact key through, with no interpolation values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(result.current('US.ADD')).toBe('en:US.ADD');
            expect(translate.instant).toHaveBeenCalledTimes(1);
            expect(translate.instant).toHaveBeenCalledWith('US.ADD', undefined);
        });

        it('forwards interpolation values unchanged, by reference', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const params = { name: 'Sprint 2026-5-15', points: 101.5 };
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(result.current('BACKLOG.SPRINTS.TITLE', params)).toBe(
                'en:BACKLOG.SPRINTS.TITLE(name,points)',
            );
            expect(translate.instant).toHaveBeenCalledWith('BACKLOG.SPRINTS.TITLE', params);
            expect(translate.instant.mock.calls[0]?.[1]).toBe(params);
        });

        it('returns whatever the service returns, including a key echoed back for a missing translation', () => {
            // angular-translate returns the key itself when the key is absent.
            // No fallback string is invented here (rule T10).
            const translate = {
                instant: jest.fn((key: string): string => key),
            };
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(result.current('NO.SUCH.KEY')).toBe('NO.SUCH.KEY');
        });

        it('does not call the service until `t` is called', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();

            renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(translate.instant).not.toHaveBeenCalled();
        });
    });

    describe('⭐2 / ⭐3 the language guard of app/coffee/app.coffee:968', () => {
        it('⭐2 re-renders with the new strings when the language really changes', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(screen.getByTestId('probe')).toHaveTextContent('en:US.ADD');

            // The service switches language first, exactly as angular-translate
            // does before it raises the event.
            translate.setLanguage('es');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(screen.getByTestId('probe')).toHaveTextContent('es:US.ADD');
        });

        it('⭐3 does NOT re-render when the emission carries the language already seen', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renders: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renders.push(renderCount);
                    }}
                />,
                {
                    wrapper: wrapperFor(
                        createInjector({ $translate: translate, $rootScope: rootScope }),
                    ),
                },
            );

            const rendersAfterMount = renders.length;

            // First emission: the ref still holds `null`, which cannot equal any
            // real tag, so this one passes the guard -- the direct counterpart of
            // `lang = null` at app.coffee:965.
            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const rendersAfterFirstChange = renders.length;

            expect(rendersAfterFirstChange).toBeGreaterThan(rendersAfterMount);

            // Three further emissions of the SAME language: the guard suppresses
            // every one of them.
            act((): void => {
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
            });

            expect(renders.length).toBe(rendersAfterFirstChange);
        });

        it('counts two distinct changes as two, not one, when both arrive in the same batch', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const identities: TranslateFn[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(t: TranslateFn): void => {
                        identities.push(t);
                    }}
                />,
                {
                    wrapper: wrapperFor(
                        createInjector({ $translate: translate, $rootScope: rootScope }),
                    ),
                },
            );

            act((): void => {
                rootScope.emit({ language: 'es' });
            });
            act((): void => {
                rootScope.emit({ language: 'ca' });
            });

            // The functional updater is what makes this hold: two real changes
            // produce two distinct `t` identities rather than collapsing into one.
            const unique = new Set(identities);

            expect(unique.size).toBe(3);
        });

        it('reacts again after a language returns to a previously seen value', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            translate.setLanguage('es');
            act((): void => {
                rootScope.emit({ language: 'es' });
            });
            expect(screen.getByTestId('probe')).toHaveTextContent('es:US.ADD');

            translate.setLanguage('en');
            act((): void => {
                rootScope.emit({ language: 'en' });
            });
            expect(screen.getByTestId('probe')).toHaveTextContent('en:US.ADD');
        });
    });

    describe('⭐4 the payload is read from the SECOND argument', () => {
        it('ignores a `language` sitting on the event object in the first position', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renders: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renders.push(renderCount);
                    }}
                />,
                {
                    wrapper: wrapperFor(
                        createInjector({ $translate: translate, $rootScope: rootScope }),
                    ),
                },
            );

            const rendersAfterMount = renders.length;

            // The double's event object carries `language: 'WRONG-ARGUMENT'`. A
            // handler written as `(ctx) => ctx.language` would read exactly that
            // and re-render; the correct two-argument handler reads the payload
            // instead, and here the payload carries no language at all.
            act((): void => {
                rootScope.emit(undefined);
            });

            expect(renders.length).toBe(rendersAfterMount);
        });

        it('observes nothing when invoked with a single argument, proving the payload is positional', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renders: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renders.push(renderCount);
                    }}
                />,
                {
                    wrapper: wrapperFor(
                        createInjector({ $translate: translate, $rootScope: rootScope }),
                    ),
                },
            );

            const rendersAfterMount = renders.length;

            // A well-formed payload delivered in the WRONG position. The
            // implementation reads argument two, which is `undefined` here, so
            // nothing happens -- which is precisely the assertion: the language
            // is NOT read from argument one.
            act((): void => {
                rootScope.emitWithSingleArgument({ language: 'es' });
            });

            expect(renders.length).toBe(rendersAfterMount);

            // ... and the same payload in the RIGHT position does re-render,
            // so the previous assertion is about position, not about the payload.
            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(renders.length).toBeGreaterThan(rendersAfterMount);
        });

        it('registers its listener under the exact AngularJS event name', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();

            renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(rootScope.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.$on.mock.calls[0]?.[0]).toBe(TRANSLATE_CHANGE_END);
            expect(rootScope.listenerCount(TRANSLATE_CHANGE_END)).toBe(1);
        });
    });

    describe('⭐5 deregistration on unmount', () => {
        it('calls the captured deregistration function exactly once', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();
            const { unmount } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('does not resubscribe on re-render, so one mount means one listener and one teardown', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();
            const { rerender, unmount } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            rerender();
            rerender();

            expect(rootScope.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            expect(rootScope.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('warns instead of throwing when AngularJS returns no deregistration function', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble();
            const rootScope = {
                $on: jest.fn((): undefined => undefined),
            };
            const { unmount } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect((): void => {
                unmount();
            }).not.toThrow();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain('[taiga-react-bridge:useTranslate]');
            expect(warn.mock.calls[0]?.[0]).toContain(TRANSLATE_CHANGE_END);
        });

        it('contains a deregistration function that throws, so the unmount still completes', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble();
            const failure = new Error('deregistration exploded');
            const rootScope = {
                $on: jest.fn((): (() => void) => (): void => {
                    throw failure;
                }),
            };
            const { unmount } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            expect((): void => {
                unmount();
            }).not.toThrow();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[1]).toBe(failure);
        });
    });

    describe('⭐6 the identity of `t`', () => {
        it('is stable across re-renders that do not change the language', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();
            const { result, rerender } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            const first = result.current;

            rerender();
            rerender();

            expect(result.current).toBe(first);

            // A suppressed emission must not disturb it either: the guard is
            // what keeps `React.memo` effective downstream.
            act((): void => {
                rootScope.emit({ language: 'en' });
                rootScope.emit({ language: 'en' });
            });

            const afterFirstRealChange = result.current;

            expect(afterFirstRealChange).not.toBe(first);

            act((): void => {
                rootScope.emit({ language: 'en' });
            });

            expect(result.current).toBe(afterFirstRealChange);
        });

        it('changes when the language changes, so memoised children re-render', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            const before = result.current;

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(result.current).not.toBe(before);
        });
    });

    describe('malformed payloads are ignored rather than fatal', () => {
        it.each([
            ['undefined', undefined],
            ['null', null],
            ['a string', 'es'],
            ['a number', 7],
            ['an object with no language', { locale: 'es' }],
            ['an object whose language is not a string', { language: 42 }],
            ['an object whose language is null', { language: null }],
        ])('ignores a payload that is %s', (_label: string, payload: unknown) => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            const before = result.current;

            expect((): void => {
                act((): void => {
                    rootScope.emit(payload);
                });
            }).not.toThrow();

            expect(result.current).toBe(before);
        });

        it('accepts the empty string as a language, because the incumbent compares raw values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            const before = result.current;

            act((): void => {
                rootScope.emit({ language: '' });
            });

            expect(result.current).not.toBe(before);
        });
    });

    describe('degradation when the root scope cannot be listened to', () => {
        it.each([
            ['is absent from the injector', undefined],
            ['is null', null],
            ['is not an object', 'not-a-scope'],
            ['exposes no $on at all', { $new: jest.fn() }],
            ['exposes a non-callable $on', { $on: 'nope' }],
        ])('warns once and still translates when the root scope %s', (_label: string, rootScope: unknown) => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            // The whole point of degrading rather than throwing: lookups work.
            expect(result.current('US.ADD')).toBe('en:US.ADD');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain('[taiga-react-bridge:useTranslate]');
            expect(warn.mock.calls[0]?.[0]).toContain('$rootScope');
        });
    });

    describe('a misconfigured $translate fails loudly', () => {
        it('throws a named diagnostic when `instant` is not callable', () => {
            const rootScope = createRootScopeDouble();
            const { result } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(
                    createInjector({ $translate: { preferredLanguage: (): string => 'en' }, $rootScope: rootScope }),
                ),
            });

            expect((): string => result.current('US.ADD')).toThrow(
                /\[taiga-react-bridge:useTranslate\].*'instant'/s,
            );
            expect((): string => result.current('US.ADD')).toThrow(/US\.ADD/);
        });

        it('names the missing provider when mounted outside the bridge provider', () => {
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

            expect((): unknown => renderHook(() => useTranslate())).toThrow(
                /useAngularService\('\$translate'\) was called outside <AngularBridgeProvider>/,
            );

            consoleError.mockRestore();
        });
    });

    describe('no polling, no timers, no DOM outside the React root', () => {
        it('registers no interval, no timeout and no observer', () => {
            const setInterval = jest.spyOn(globalThis, 'setInterval');
            const setTimeout = jest.spyOn(globalThis, 'setTimeout');
            const querySelector = jest.spyOn(document, 'querySelector');
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();

            const { result, unmount } = renderHook(() => useTranslate(), {
                wrapper: wrapperFor(createInjector({ $translate: translate, $rootScope: rootScope })),
            });

            result.current('US.ADD');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            unmount();

            expect(setInterval).not.toHaveBeenCalled();
            expect(setTimeout).not.toHaveBeenCalled();
            expect(querySelector).not.toHaveBeenCalled();
        });

        it('gives every mounted caller its own listener and removes each one', () => {
            const translate = createTranslateDouble();
            const rootScope = createRootScopeDouble();
            const wrapper = wrapperFor(
                createInjector({ $translate: translate, $rootScope: rootScope }),
            );

            const first = renderHook(() => useTranslate(), { wrapper });
            const second = renderHook(() => useTranslate(), { wrapper });

            expect(rootScope.$on).toHaveBeenCalledTimes(2);

            first.unmount();
            second.unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(2);
        });
    });
});
