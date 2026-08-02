/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useRealtime.test.tsx -- co-located spec for the null-scope realtime hook
 * ==========================================================================
 *
 * Browserless by construction (requirement HR-5): jsdom only, no end-to-end
 * runner imported, no real browser, no network, no WebSocket, and no dependency
 * on any build output. The whole realtime service is replaced by a test double
 * of three members, which is exactly what the per-hook dependency style is for
 * (requirement I9).
 *
 * THE DOUBLE REPRODUCES THE REAL SERVICE'S HAZARDS ON PURPOSE. A convenient
 * double that pruned its registry on `unsubscribe` would make the most important
 * assertion in this file vacuous, because `app/coffee/modules/events.coffee` does
 * NOT prune: `unsubscribe` (`:219-230`) sends a wire command and nothing else,
 * and the registry is touched at exactly three sites (`:180`, `:183`, `:214`)
 * with no `delete` among them. So the double keeps delivering after
 * `unsubscribe`, and the specs below prove the hook copes.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE EARNS ITS PLACE:
 *
 *   1. THE CLEANUP PROOF (mandated by AAP 0.6.3 item 8). Unmounting calls
 *      `unsubscribe` EXACTLY ONCE, with the EXACT routing key, and with EXACTLY
 *      ONE ARGUMENT -- the argument COUNT is asserted, not just the first
 *      argument, because `unsubscribe: (routingKey) ->` (`:219`) has no second
 *      parameter and a stray `options` would be silently swallowed. Without
 *      teardown the subscription leaks, and the leak is silent: it surfaces only
 *      as duplicate refreshes after navigating away and back.
 *   2. THE SCOPE IS THE LITERAL `null`. That is what makes AngularJS skip its own
 *      teardown (`:217`, `... if scope`), which is what makes assertion 1
 *      mandatory rather than defensive.
 *   3. `options` REACHES `subscribe` AND NEVER `unsubscribe`.
 *   4. A NEW INLINE HANDLER DOES NOT RESUBSCRIBE, yet the NEWEST handler is the
 *      one a message reaches -- the handler ref, proved from both sides.
 *   5. A MESSAGE AFTER UNMOUNT IS A NO-OP -- the disposed flag, i.e. hazard H1.
 *   6. A FALSY ROUTING KEY SUBSCRIBES TO NOTHING.
 * ========================================================================== */

import { StrictMode, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import type { TaigaEventsService } from './useAngularService';
import { useRealtime } from './useRealtime';
import type { RealtimeMessageHandler, RealtimeSubscriptionOptions } from './useRealtime';

/* --------------------------------------------------------------------------
 * Test doubles
 * -------------------------------------------------------------------------- */

/** The callback shape the service stores and later invokes (`:203`, `:190`). */
type Subscriber = (data: unknown) => void;

type SubscribeMock = jest.Mock<
    void,
    [unknown, string, Subscriber, (RealtimeSubscriptionOptions | undefined)?]
>;

type UnsubscribeMock = jest.Mock<void, [string]>;

/**
 * A `$tgEvents` double, plus a `dispatch` that reproduces `processMessage`
 * (`app/coffee/modules/events.coffee:177-190`).
 *
 * `service` is typed as the real facade intersected with the mock types, so the
 * double cannot drift out of conformance with `TaigaEventsService` without
 * failing the type gate.
 */
interface EventsDouble {
    service: TaigaEventsService & { subscribe: SubscribeMock; unsubscribe: UnsubscribeMock };

    /**
     * Delivers a message the way the real service does: look the routing key up
     * in the registry, return silently when absent (`:180-181`), otherwise invoke
     * the stored callback DIRECTLY -- the null-scope branch at `:189-190`, which
     * runs outside any digest.
     */
    dispatch(routingKey: string, payload: unknown): void;

    /** How many callbacks the registry currently holds, for clobber assertions. */
    registrySize(): number;
}

function makeEventsDouble(): EventsDouble {
    // Mirrors `@.subscriptions` (`:214`): ONE flat map keyed by routing key for
    // the whole application, and DELIBERATELY never pruned -- see the file header.
    const subscriptions = new Map<string, Subscriber>();

    const subscribe: SubscribeMock = jest.fn((_scope, routingKey, callback) => {
        // `:214` overwrites unconditionally, which is hazard H2: a second
        // subscribe to the same key silently replaces the first callback.
        subscriptions.set(routingKey, callback);
    });

    // `:219-230` sends the wire command only. No map mutation, by design.
    const unsubscribe: UnsubscribeMock = jest.fn();

    return {
        service: { connected: true, subscribe, unsubscribe },
        dispatch(routingKey, payload) {
            const callback = subscriptions.get(routingKey);

            if (callback === undefined) {
                return;
            }

            callback(payload);
        },
        registrySize() {
            return subscriptions.size;
        },
    };
}

/**
 * An injector double resolving every name to `service`.
 *
 * `has` is omitted, which the sibling context documents as the common case and
 * which keeps the double minimal: `useAngularService` only rejects a name when
 * `has` is present AND returns `false`.
 */
function makeInjector(service: unknown): AngularInjector {
    const get = jest.fn<unknown, [string]>(() => service);

    return { get } as AngularInjector;
}

/** Wraps a hook or component under test in a provider carrying `injector`. */
function withInjector(injector: AngularInjector): (props: { children?: ReactNode }) => ReactElement {
    return function Wrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

/**
 * The same provider wrapper, additionally inside literal `StrictMode`.
 *
 * Kept separate from `withInjector` so that only the specs that mean to exercise
 * React 18's development-mode double-invocation of effects pay for it, and so the
 * default wrapper keeps asserting single-invocation behaviour.
 */
function withStrictInjector(
    injector: AngularInjector,
): (props: { children?: ReactNode }) => ReactElement {
    return function StrictWrapper({ children }: { children?: ReactNode }): ReactElement {
        return (
            <StrictMode>
                <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>
            </StrictMode>
        );
    };
}

/**
 * The four dot-separated segments of a real key -- the literal `changes`, the
 * literal `project`, the project id and the resource name -- assembled HERE, in
 * the spec, because composing keys is the CALLER's job and the hook never
 * hardcodes one.
 */
function projectKey(projectId: number, resource: string): string {
    return ['changes', 'project', String(projectId), resource].join('.');
}

const USERSTORIES_KEY = projectKey(3, 'userstories');
const MILESTONES_KEY = projectKey(3, 'milestones');
const PROJECTS_KEY = projectKey(3, 'projects');

/**
 * The one options object any in-scope screen uses, hoisted exactly as callers
 * are asked to hoist it: `app/coffee/modules/backlog/main.coffee:280` supplies
 * it for the `milestones` subscription created at `:276`.
 */
const MILESTONE_OPTIONS: RealtimeSubscriptionOptions = { selfNotification: true };

/* --------------------------------------------------------------------------
 * Specs
 * -------------------------------------------------------------------------- */

describe('useRealtime -- subscription', () => {
    it('subscribes once, on mount, with the caller-supplied routing key', () => {
        const events = makeEventsDouble();

        renderHook(() => useRealtime(USERSTORIES_KEY, jest.fn()), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
        expect(events.service.subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);
    });

    it('resolves the realtime service through the typed accessor', () => {
        const events = makeEventsDouble();
        const injector = makeInjector(events.service);

        renderHook(() => useRealtime(USERSTORIES_KEY, jest.fn()), {
            wrapper: withInjector(injector),
        });

        expect(injector.get).toHaveBeenCalledWith('$tgEvents');
    });

    it('passes the LITERAL null as the scope, which is why teardown is ours', () => {
        // `:217` is `scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope`.
        // Anything truthy here would register AngularJS teardown; anything else
        // truthy would also be a scope React must never hold.
        const events = makeEventsDouble();

        renderHook(() => useRealtime(USERSTORIES_KEY, jest.fn()), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        const scope = events.service.subscribe.mock.calls[0][0];

        expect(scope).toBeNull();
        expect(scope).not.toBeUndefined();
    });

    it('does not subscribe while the routing key is falsy', () => {
        // The project id is unknown until the project resolves. Subscribing to a
        // key composed from an undefined id would subscribe to garbage.
        const events = makeEventsDouble();
        const injector = makeInjector(events.service);

        const { rerender } = renderHook(
            ({ key }: { key: string | null | undefined }) => useRealtime(key, jest.fn()),
            { initialProps: { key: undefined as string | null | undefined }, wrapper: withInjector(injector) },
        );

        expect(events.service.subscribe).not.toHaveBeenCalled();

        rerender({ key: null });
        expect(events.service.subscribe).not.toHaveBeenCalled();

        rerender({ key: '' });
        expect(events.service.subscribe).not.toHaveBeenCalled();

        // ... and subscribes as soon as the real key arrives.
        rerender({ key: USERSTORIES_KEY });
        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
        expect(events.service.subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);
    });

    it('does not unsubscribe on unmount when it never subscribed', () => {
        const events = makeEventsDouble();

        const { unmount } = renderHook(() => useRealtime(null, jest.fn()), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        unmount();

        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- cleanup (the mandated proof, AAP 0.6.3 item 8)', () => {
    it('unsubscribes EXACTLY ONCE on unmount, with the EXACT routing key', () => {
        const events = makeEventsDouble();

        const { unmount } = renderHook(() => useRealtime(USERSTORIES_KEY, jest.fn()), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        expect(events.service.unsubscribe).not.toHaveBeenCalled();

        unmount();

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
    });

    it('calls unsubscribe with EXACTLY ONE argument', () => {
        // `unsubscribe: (routingKey) ->` (`:219`) declares one parameter. Passing
        // `options` -- or anything else -- as a second argument would be silently
        // dropped while implying the teardown is option-aware. Asserting the
        // ARGUMENT COUNT is the only way to catch that.
        const events = makeEventsDouble();

        const { unmount } = renderHook(
            () => useRealtime(MILESTONES_KEY, jest.fn(), MILESTONE_OPTIONS),
            { wrapper: withInjector(makeInjector(events.service)) },
        );

        unmount();

        const call = events.service.unsubscribe.mock.calls[0];

        expect(call).toHaveLength(1);
        expect(call[0]).toBe(MILESTONES_KEY);
    });

    it('unsubscribes the OLD key and subscribes the NEW one, in that order', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ key }: { key: string }) => useRealtime(key, jest.fn()),
            {
                initialProps: { key: USERSTORIES_KEY },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ key: PROJECTS_KEY });

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.subscribe.mock.calls[1][1]).toBe(PROJECTS_KEY);

        // Teardown must precede setup, or the second subscribe's registry entry
        // would be wiped by the first's unsubscribe on a shared key.
        expect(events.service.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
            events.service.subscribe.mock.invocationCallOrder[1],
        );
    });

    it('unsubscribes when the routing key becomes falsy again', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ key }: { key: string | null }) => useRealtime(key, jest.fn()),
            {
                initialProps: { key: USERSTORIES_KEY as string | null },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ key: null });

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('survives a mount / unmount / remount cycle with one live subscription', () => {
        // The shape React 18 StrictMode forces in development.
        const events = makeEventsDouble();
        const injector = makeInjector(events.service);
        const handler = jest.fn();

        const first = renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(injector),
        });
        first.unmount();

        const second = renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(injector),
        });

        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.registrySize()).toBe(1);

        // Exactly one live subscription, and it delivers.
        events.dispatch(USERSTORIES_KEY, { matches: 'userstories' });
        expect(handler).toHaveBeenCalledTimes(1);

        second.unmount();
        expect(events.service.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('holds exactly ONE live subscription under literal StrictMode', () => {
        // The test above reproduces the SHAPE StrictMode forces by driving two
        // renderHook calls by hand. This one uses the real thing, because the
        // host element is free to wrap the React tree in StrictMode and React 18
        // then mounts, tears down and remounts every effect in development.
        //
        // Hazard H2 is what makes that dangerous here: the registry is keyed
        // globally by routing key (`events.coffee:214`), so an effect whose
        // teardown is not symmetric with its setup leaves a live callback behind.
        //
        // The assertions are written against the INVARIANT rather than against a
        // double-invoke count, so this spec states what must be true of the hook
        // instead of which mode React happened to run in.
        const events = makeEventsDouble();
        const injector = makeInjector(events.service);
        const handler = jest.fn();

        const { unmount } = renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withStrictInjector(injector),
        });

        const subscribes = events.service.subscribe.mock.calls.length;
        const unsubscribes = events.service.unsubscribe.mock.calls.length;

        // Whether React ran the effect once (1 vs 0) or double-invoked it
        // (2 vs 1), exactly one subscription is outstanding while mounted.
        expect(subscribes - unsubscribes).toBe(1);
        expect(events.registrySize()).toBe(1);

        // StrictMode must not smuggle in a differently-shaped call: every
        // subscribe still passes the literal null scope, and every unsubscribe
        // still takes exactly one argument.
        for (const call of events.service.subscribe.mock.calls) {
            expect(call[0]).toBeNull();
        }

        for (const call of events.service.unsubscribe.mock.calls) {
            expect(call).toHaveLength(1);
            expect(call[0]).toBe(USERSTORIES_KEY);
        }

        // The decisive assertion. `disposed` is per-effect-run, NOT shared across
        // runs; were it shared, the discarded first run's cleanup would have set
        // it and poisoned the surviving subscription, delivering ZERO messages.
        events.dispatch(USERSTORIES_KEY, { strict: true });
        expect(handler).toHaveBeenCalledTimes(1);

        unmount();

        // Teardown is symmetric: nothing is left outstanding.
        expect(events.service.subscribe.mock.calls).toHaveLength(
            events.service.unsubscribe.mock.calls.length,
        );

        // And the never-pruned registry still holds a callback that is now inert.
        expect(events.registrySize()).toBe(1);
        events.dispatch(USERSTORIES_KEY, { afterUnmount: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('useRealtime -- options', () => {
    it('forwards options as the FOURTH argument to subscribe', () => {
        const events = makeEventsDouble();

        renderHook(() => useRealtime(MILESTONES_KEY, jest.fn(), MILESTONE_OPTIONS), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        const call = events.service.subscribe.mock.calls[0];

        expect(call).toHaveLength(4);
        expect(call[3]).toEqual({ selfNotification: true });
    });

    it('never passes options to unsubscribe', () => {
        const events = makeEventsDouble();

        const { unmount } = renderHook(
            () => useRealtime(MILESTONES_KEY, jest.fn(), MILESTONE_OPTIONS),
            { wrapper: withInjector(makeInjector(events.service)) },
        );

        unmount();

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(MILESTONES_KEY);
        expect(events.service.unsubscribe.mock.calls[0]).not.toContainEqual(MILESTONE_OPTIONS);
    });

    it('forwards undefined -- not an empty object -- when no options are given', () => {
        // The service branches on truthiness (`:211`), so `undefined` is what keeps
        // the `options` member off the wire message entirely. `{}` would put it on.
        const events = makeEventsDouble();

        renderHook(() => useRealtime(USERSTORIES_KEY, jest.fn()), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        expect(events.service.subscribe.mock.calls[0][3]).toBeUndefined();
    });

    it('does NOT resubscribe when an equal options object arrives with a new identity', () => {
        // A caller writing the literal inline creates a new object every render.
        // Only its VALUE reaches the dependency array, so the subscription stands.
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ options }: { options: RealtimeSubscriptionOptions }) =>
                useRealtime(MILESTONES_KEY, jest.fn(), options),
            {
                initialProps: { options: { selfNotification: true } },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ options: { selfNotification: true } });
        rerender({ options: { selfNotification: true } });

        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('resubscribes when the options VALUE changes', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ options }: { options: RealtimeSubscriptionOptions | undefined }) =>
                useRealtime(MILESTONES_KEY, jest.fn(), options),
            {
                initialProps: {
                    options: { selfNotification: true } as RealtimeSubscriptionOptions | undefined,
                },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ options: { selfNotification: false } });

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.subscribe.mock.calls[1][3]).toEqual({ selfNotification: false });

        // Dropping the options entirely is also a value change.
        rerender({ options: undefined });

        expect(events.service.subscribe).toHaveBeenCalledTimes(3);
        expect(events.service.subscribe.mock.calls[2][3]).toBeUndefined();
    });

    it('treats an empty options object as distinct from no options at all', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ options }: { options: RealtimeSubscriptionOptions | undefined }) =>
                useRealtime(MILESTONES_KEY, jest.fn(), options),
            {
                initialProps: { options: undefined as RealtimeSubscriptionOptions | undefined },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ options: {} });

        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.subscribe.mock.calls[1][3]).toEqual({});
    });
});

describe('useRealtime -- delivery', () => {
    it('invokes the handler with the payload the service dispatches', () => {
        const events = makeEventsDouble();
        const handler = jest.fn<void, [unknown]>();
        const payload = { matches: 'userstories.userstory' };

        renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        events.dispatch(USERSTORIES_KEY, payload);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers every message, not just the first', () => {
        const events = makeEventsDouble();
        const handler = jest.fn<void, [unknown]>();

        renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        events.dispatch(USERSTORIES_KEY, 1);
        events.dispatch(USERSTORIES_KEY, 2);
        events.dispatch(USERSTORIES_KEY, 3);

        expect(handler).toHaveBeenCalledTimes(3);
        expect(handler.mock.calls.map(([data]) => data)).toEqual([1, 2, 3]);
    });

    it('ignores messages for a routing key it did not subscribe to', () => {
        const events = makeEventsDouble();
        const handler = jest.fn();

        renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        events.dispatch(PROJECTS_KEY, {});

        expect(handler).not.toHaveBeenCalled();
    });

    it('lets a handler drive React state, because delivery is outside any digest', () => {
        const events = makeEventsDouble();

        function Consumer(): ReactElement {
            const [count, setCount] = useState(0);

            useRealtime(USERSTORIES_KEY, () => {
                setCount((previous) => previous + 1);
            });

            return <output data-testid="count">{count}</output>;
        }

        const { getByTestId } = render(<Consumer />, {
            wrapper: withInjector(makeInjector(events.service)),
        });

        expect(getByTestId('count')).toHaveTextContent('0');

        act(() => {
            events.dispatch(USERSTORIES_KEY, {});
        });

        expect(getByTestId('count')).toHaveTextContent('1');
    });
});

describe('useRealtime -- the handler ref (why handler is not a dependency)', () => {
    it('does NOT resubscribe when a new inline handler arrives on every render', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ handler }: { handler: RealtimeMessageHandler }) =>
                useRealtime(USERSTORIES_KEY, handler),
            {
                // A fresh function each time, which is what an inline arrow at a
                // call site produces.
                initialProps: { handler: (): void => undefined },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        rerender({ handler: (): void => undefined });
        rerender({ handler: (): void => undefined });
        rerender({ handler: (): void => undefined });

        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('keeps the SAME subscribed callback identity across handler changes', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            ({ handler }: { handler: RealtimeMessageHandler }) =>
                useRealtime(USERSTORIES_KEY, handler),
            {
                initialProps: { handler: jest.fn() as RealtimeMessageHandler },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        const subscribed = events.service.subscribe.mock.calls[0][2];

        rerender({ handler: jest.fn() as RealtimeMessageHandler });

        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
        expect(events.service.subscribe.mock.calls[0][2]).toBe(subscribed);
    });

    it('invokes the LATEST handler, never a stale closure', () => {
        const events = makeEventsDouble();
        const first = jest.fn<void, [unknown]>();
        const second = jest.fn<void, [unknown]>();

        const { rerender } = renderHook(
            ({ handler }: { handler: RealtimeMessageHandler }) =>
                useRealtime(USERSTORIES_KEY, handler),
            {
                initialProps: { handler: first as RealtimeMessageHandler },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        events.dispatch(USERSTORIES_KEY, 'before');
        expect(first).toHaveBeenCalledWith('before');

        rerender({ handler: second as RealtimeMessageHandler });
        events.dispatch(USERSTORIES_KEY, 'after');

        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith('after');
        // The superseded handler is never called again.
        expect(first).toHaveBeenCalledTimes(1);
    });

    it('reads state captured by the newest handler, not the mount-time one', () => {
        const events = makeEventsDouble();
        const seen: number[] = [];

        function Consumer(): ReactElement {
            const [tick, setTick] = useState(0);

            useRealtime(USERSTORIES_KEY, () => {
                seen.push(tick);
            });

            return (
                <button type="button" onClick={(): void => setTick(tick + 1)}>
                    tick
                </button>
            );
        }

        const { getByRole } = render(<Consumer />, {
            wrapper: withInjector(makeInjector(events.service)),
        });

        events.dispatch(USERSTORIES_KEY, {});

        act(() => {
            getByRole('button').click();
        });

        events.dispatch(USERSTORIES_KEY, {});

        // A stale closure would have pushed [0, 0].
        expect(seen).toEqual([0, 1]);
        expect(events.service.subscribe).toHaveBeenCalledTimes(1);
    });
});

describe('useRealtime -- the disposed flag (hazard H1)', () => {
    it('is a no-op for a message that arrives AFTER unmount', () => {
        // The registry entry survives `unsubscribe` (`:219-230` prunes nothing),
        // so a late or in-flight message still reaches the subscribed callback.
        // Without the disposed flag this would be a state write into an unmounted
        // tree.
        const events = makeEventsDouble();
        const handler = jest.fn();

        const { unmount } = renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        unmount();

        // The double still holds the callback -- exactly like the real service.
        expect(events.registrySize()).toBe(1);

        events.dispatch(USERSTORIES_KEY, { late: true });

        expect(handler).not.toHaveBeenCalled();
    });

    it('produces no console error or warning when a message arrives after unmount', () => {
        // React 18 no longer emits the "update on an unmounted component" warning,
        // so the load-bearing assertion is the one above: the handler never runs,
        // therefore no state is written. This guards the surrounding behaviour --
        // nothing throws, and nothing is logged, on the late-delivery path.
        const events = makeEventsDouble();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        function Consumer(): ReactElement {
            const [count, setCount] = useState(0);

            useRealtime(USERSTORIES_KEY, () => {
                setCount((previous) => previous + 1);
            });

            return <output>{count}</output>;
        }

        const { unmount } = render(<Consumer />, {
            wrapper: withInjector(makeInjector(events.service)),
        });

        unmount();

        expect(() => {
            events.dispatch(USERSTORIES_KEY, { late: true });
        }).not.toThrow();

        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('silences only the outgoing subscription when the routing key changes', () => {
        const events = makeEventsDouble();
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderHook(
            ({ key }: { key: string }) => useRealtime(key, handler),
            {
                initialProps: { key: USERSTORIES_KEY },
                wrapper: withInjector(makeInjector(events.service)),
            },
        );

        const firstSubscribed = events.service.subscribe.mock.calls[0][2];

        rerender({ key: PROJECTS_KEY });

        // The retired callback is inert...
        firstSubscribed({ stale: true });
        expect(handler).not.toHaveBeenCalled();

        // ...while the current one delivers.
        events.dispatch(PROJECTS_KEY, { fresh: true });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ fresh: true });
    });

    it('sets the flag BEFORE calling unsubscribe, leaving no window open', () => {
        // Ordering is the whole point: a message racing the unsubscribe command
        // must already find the callback disposed. The double dispatches from
        // inside `unsubscribe` to model exactly that race.
        const events = makeEventsDouble();
        const handler = jest.fn();

        const { unmount } = renderHook(() => useRealtime(USERSTORIES_KEY, handler), {
            wrapper: withInjector(makeInjector(events.service)),
        });

        events.service.unsubscribe.mockImplementation((routingKey: string) => {
            events.dispatch(routingKey, { racing: true });
        });

        unmount();

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- service identity', () => {
    it('resubscribes through the new service when the resolved instance changes', () => {
        // Not expected in the browser, where AngularJS services are singletons, but
        // the dependency array is honest about it rather than silently keeping a
        // subscription on a service the tree no longer resolves. The injector is
        // threaded through props here because `renderHook`'s wrapper is fixed for
        // the lifetime of the render.
        const first = makeEventsDouble();
        const second = makeEventsDouble();

        function Subscriber(): ReactElement {
            useRealtime(USERSTORIES_KEY, jest.fn());

            return <output />;
        }

        function Harness({ injector }: { injector: AngularInjector }): ReactElement {
            return (
                <AngularBridgeProvider injector={injector}>
                    <Subscriber />
                </AngularBridgeProvider>
            );
        }

        const { rerender } = render(<Harness injector={makeInjector(first.service)} />);

        expect(first.service.subscribe).toHaveBeenCalledTimes(1);

        rerender(<Harness injector={makeInjector(second.service)} />);

        expect(first.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(first.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(second.service.subscribe).toHaveBeenCalledTimes(1);
        expect(second.service.subscribe.mock.calls[0][0]).toBeNull();
        expect(second.service.subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);
    });
});
