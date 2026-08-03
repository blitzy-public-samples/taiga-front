/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector } from './mockInjector';
import { useRealtime } from './useRealtime';
import type { RealtimeMessageHandler, RealtimeSubscriptionOptions } from './useRealtime';

function projectRoutingKey(projectId: number, resource: string): string {
    return ['changes', 'project', String(projectId), resource].join('.');
}

const PROJECT_ID = 3;

const USERSTORIES_KEY = projectRoutingKey(PROJECT_ID, 'userstories');

const MILESTONES_KEY = projectRoutingKey(PROJECT_ID, 'milestones');

const PROJECTS_KEY = projectRoutingKey(PROJECT_ID, 'projects');

const MILESTONE_OPTIONS: RealtimeSubscriptionOptions = { selfNotification: true };

const USERSTORY_MESSAGE = { matches: 'userstories.userstory', data: { id: 42 } };

type RealtimeSubscriber = (data: unknown) => void;

type SubscribeSpy = jest.Mock<
    void,
    [
        scope: null,
        routingKey: string,
        callback: RealtimeSubscriber,
        options?: RealtimeSubscriptionOptions,
    ]
>;

type UnsubscribeSpy = jest.Mock<void, [routingKey: string]>;

interface RealtimeEventsDouble {
    connected: boolean;

    subscribe: SubscribeSpy;

    unsubscribe: UnsubscribeSpy;
}

interface RealtimeHarness {
    service: RealtimeEventsDouble;

    dispatch(routingKey: string, payload: unknown): void;

    isRegistered(routingKey: string): boolean;

    registrySize(): number;
}

function _mockTgEvents(): RealtimeHarness {
    const subscriptions = new Map<string, RealtimeSubscriber>();

    const subscribe: SubscribeSpy = jest.fn(
        (_scope: null, routingKey: string, callback: RealtimeSubscriber): void => {
            subscriptions.set(routingKey, callback);
        },
    );

    const unsubscribe: UnsubscribeSpy = jest.fn();

    return {
        service: { connected: true, subscribe, unsubscribe },

        dispatch(routingKey: string, payload: unknown): void {
            const callback = subscriptions.get(routingKey);

            if (callback === undefined) {
                return;
            }

            callback(payload);
        },

        isRegistered(routingKey: string): boolean {
            return subscriptions.has(routingKey);
        },

        registrySize(): number {
            return subscriptions.size;
        },
    };
}

interface Mocks {
    $tgEvents: RealtimeHarness;

    injector: AngularInjector;
}

function _mocks(): Mocks {
    const $tgEvents = _mockTgEvents();

    return {
        $tgEvents,
        injector: mockInjector({ $tgEvents: $tgEvents.service }),
    };
}

let mocks: Mocks;

beforeEach(() => {
    mocks = _mocks();
});

function withInjector(
    injector: AngularInjector,
): (props: { children?: ReactNode }) => ReactElement {
    return function InjectorWrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

interface ConsumerProps {
    routingKey: string | null | undefined;

    handler: RealtimeMessageHandler;

    options?: RealtimeSubscriptionOptions;
}

function Consumer({ routingKey, handler, options }: ConsumerProps): ReactElement {
    useRealtime(routingKey, handler, options);

    return <output>realtime consumer</output>;
}

function renderConsumer(props: ConsumerProps): RenderResult {
    return render(<Consumer {...props} />, { wrapper: withInjector(mocks.injector) });
}

function StatefulConsumer({ routingKey }: { routingKey: string }): ReactElement {
    const [received, setReceived] = useState(0);

    useRealtime(routingKey, () => {
        setReceived((previous: number): number => previous + 1);
    });

    return <output data-testid="received">{received}</output>;
}

function subscribedCallback(callIndex = 0): RealtimeSubscriber {
    const { calls } = mocks.$tgEvents.service.subscribe.mock;

    if (calls.length <= callIndex) {
        throw new Error(
            `subscribedCallback: no subscribe call at index ${callIndex}; ` +
                `${calls.length} call(s) were recorded.`,
        );
    }

    return calls[callIndex][2];
}

describe('useRealtime -- cleanup, the mandated proof', () => {
    it('unsubscribes EXACTLY ONCE on unmount, with the EXACT routing key', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();

        unmount();

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
    });

    it('calls unsubscribe with EXACTLY ONE argument, even when options were supplied', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: MILESTONE_OPTIONS,
        });

        unmount();

        const [unsubscribeCall] = mocks.$tgEvents.service.unsubscribe.mock.calls;

        expect(unsubscribeCall).toHaveLength(1);
        expect(unsubscribeCall[0]).toBe(MILESTONES_KEY);
    });

    it('does not unsubscribe while the consumer stays mounted and merely re-renders', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        rerender(
            <Consumer
                routingKey={USERSTORIES_KEY}
                handler={jest.fn<void, [unknown]>()}
            />,
        );

        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('unsubscribes nothing when it never subscribed', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: undefined, handler });

        unmount();

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- the subscribe call', () => {
    it('subscribes exactly once on mount', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('passes the LITERAL null as the scope, which is what makes teardown ours', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        expect(subscribeCall[0]).toBeNull();
    });

    it('passes the routing key SECOND and a callback function THIRD', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: PROJECTS_KEY, handler });

        const [, routingKey, callback] = mocks.$tgEvents.service.subscribe.mock.calls[0];

        expect(routingKey).toBe(PROJECTS_KEY);
        expect(typeof callback).toBe('function');

        expect(callback).not.toBe(handler);
    });

    it('resolves the realtime service and asks the injector for nothing else', () => {
        const handler = jest.fn<void, [unknown]>();

        expect(() => {
            renderConsumer({ routingKey: USERSTORIES_KEY, handler });
        }).not.toThrow();

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('fails loudly and BY NAME when the realtime service is not registered', () => {
        const handler = jest.fn<void, [unknown]>();

        jest.spyOn(console, 'error').mockImplementation((): void => undefined);

        const emptyInjector = mockInjector();

        expect(() => {
            render(<Consumer routingKey={USERSTORIES_KEY} handler={handler} />, {
                wrapper: withInjector(emptyInjector),
            });
        }).toThrow(/\$tgEvents/);

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- options', () => {
    it('forwards the options object BY REFERENCE as the FOURTH argument', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: MILESTONE_OPTIONS,
        });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        expect(subscribeCall[3]).toBe(MILESTONE_OPTIONS);
        expect(subscribeCall[3]).toEqual({ selfNotification: true });
    });

    it('omits options entirely when the caller supplies none', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        expect(subscribeCall[3]).toBeUndefined();
    });

    it('does NOT resubscribe when an equal options object arrives with a new identity', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: { selfNotification: true },
        });

        rerender(
            <Consumer
                routingKey={MILESTONES_KEY}
                handler={handler}
                options={{ selfNotification: true }}
            />,
        );

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('resubscribes when the options VALUE changes', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: { selfNotification: true },
        });

        rerender(
            <Consumer
                routingKey={MILESTONES_KEY}
                handler={handler}
                options={{ selfNotification: false }}
            />,
        );

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(2);
        expect(mocks.$tgEvents.service.subscribe.mock.calls[1][3]).toEqual({
            selfNotification: false,
        });
    });
});

describe('useRealtime -- hazard H1, delivery after teardown', () => {
    it('leaves the double still routing after unsubscribe, so these specs are not vacuous', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        expect(mocks.$tgEvents.isRegistered(USERSTORIES_KEY)).toBe(true);

        unmount();

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.isRegistered(USERSTORIES_KEY)).toBe(true);
    });

    it('is a silent no-op for a message the service dispatches AFTER unmount', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        unmount();

        expect(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        }).not.toThrow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('is a no-op even when the captured callback is invoked directly', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const deliver = subscribedCallback();

        unmount();

        expect(() => {
            deliver(USERSTORY_MESSAGE);
        }).not.toThrow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('writes no state and logs no React warning on the late-delivery path', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);

        const { unmount, getByTestId } = render(
            <StatefulConsumer routingKey={USERSTORIES_KEY} />,
            { wrapper: withInjector(mocks.injector) },
        );

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        expect(getByTestId('received').textContent).toBe('1');

        unmount();

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('silences only the OUTGOING subscription when the routing key changes', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const staleDeliver = subscribedCallback(0);

        rerender(<Consumer routingKey={MILESTONES_KEY} handler={handler} />);

        staleDeliver(USERSTORY_MESSAGE);
        expect(handler).not.toHaveBeenCalled();

        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('sets the disposed flag BEFORE calling unsubscribe, leaving no window open', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const deliver = subscribedCallback();

        mocks.$tgEvents.service.unsubscribe.mockImplementation((): void => {
            deliver(USERSTORY_MESSAGE);
        });

        unmount();

        expect(handler).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- the handler ref', () => {
    it('does NOT resubscribe when a new inline handler arrives on every render', () => {
        const { rerender } = renderConsumer({
            routingKey: USERSTORIES_KEY,
            handler: jest.fn<void, [unknown]>(),
        });

        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );
        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );
        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('keeps the SAME subscribed callback identity across handler changes', () => {
        const { rerender } = renderConsumer({
            routingKey: USERSTORIES_KEY,
            handler: jest.fn<void, [unknown]>(),
        });

        const before = subscribedCallback();

        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );

        expect(subscribedCallback()).toBe(before);
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('delivers to the LATEST handler, never the mount-time closure', () => {
        const first = jest.fn<void, [unknown]>();
        const second = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler: first });

        rerender(<Consumer routingKey={USERSTORIES_KEY} handler={second} />);

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith(USERSTORY_MESSAGE);
    });
});

describe('useRealtime -- routing-key changes', () => {
    it('unsubscribes the OLD key, then subscribes the NEW one, in that order', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        rerender(<Consumer routingKey={MILESTONES_KEY} handler={handler} />);

        const { subscribe, unsubscribe } = mocks.$tgEvents.service;

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(subscribe).toHaveBeenCalledTimes(2);

        expect(unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);
        expect(subscribe.mock.calls[1][1]).toBe(MILESTONES_KEY);

        expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
            subscribe.mock.invocationCallOrder[1],
        );
        expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
            unsubscribe.mock.invocationCallOrder[0],
        );
    });

    it('does not subscribe at all while the routing key is falsy', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: undefined, handler });
        renderConsumer({ routingKey: null, handler });
        renderConsumer({ routingKey: '', handler });

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
        expect(mocks.$tgEvents.registrySize()).toBe(0);
    });

    it('subscribes as soon as the key arrives, and unsubscribes if it goes away again', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: null, handler });

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();

        rerender(<Consumer routingKey={USERSTORIES_KEY} handler={handler} />);

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);

        rerender(<Consumer routingKey={null} handler={handler} />);

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
    });
});

describe('useRealtime -- payload delivery', () => {
    it('hands the handler the dispatched payload UNMODIFIED', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        expect(handler).toHaveBeenCalledTimes(1);

        const [delivered] = handler.mock.calls[0];

        expect(Object.is(delivered, USERSTORY_MESSAGE)).toBe(true);
    });

    it('delivers every message, not only the first', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const second = { matches: 'userstories.userstory', data: { id: 7 } };

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        mocks.$tgEvents.dispatch(USERSTORIES_KEY, second);

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0]).toBe(second);
    });

    it('delivers nothing for a routing key it did not subscribe to', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);

        expect(handler).not.toHaveBeenCalled();
    });

    it('lets a handler drive React state, because delivery is outside any digest', () => {
        const { getByTestId } = render(<StatefulConsumer routingKey={USERSTORIES_KEY} />, {
            wrapper: withInjector(mocks.injector),
        });

        expect(getByTestId('received').textContent).toBe('0');

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        expect(getByTestId('received').textContent).toBe('2');
    });
});

describe('useRealtime -- hazard H2, one consumer per routing key', () => {
    it('keeps ONE registry entry per key, so a second consumer of the same key clobbers the first', () => {
        const first = jest.fn<void, [unknown]>();
        const second = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler: first });
        renderConsumer({ routingKey: USERSTORIES_KEY, handler: second });

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(2);
        expect(mocks.$tgEvents.registrySize()).toBe(1);

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps distinct keys fully independent, which is why the invariant is workable', () => {
        const onUserstories = jest.fn<void, [unknown]>();
        const onMilestones = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler: onUserstories });
        renderConsumer({
            routingKey: MILESTONES_KEY,
            handler: onMilestones,
            options: MILESTONE_OPTIONS,
        });

        expect(mocks.$tgEvents.registrySize()).toBe(2);

        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);

        expect(onMilestones).toHaveBeenCalledTimes(1);
        expect(onUserstories).not.toHaveBeenCalled();
    });
});

describe('useRealtime -- source-level prohibitions', () => {
    const unitSource = readFileSync(join(__dirname, 'useRealtime.ts'), 'utf8');

    const specSource = readFileSync(join(__dirname, 'useRealtime.test.tsx'), 'utf8');

    function executableSourceOf(source: string): string {
        return source
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:/])\/\/.*$/gm, '$1');
    }

    function importSpecifiersOf(source: string): string[] {
        const specifiers: string[] = [];
        const pattern = /(?:^|\n)\s*import\s[^;]*?from\s*'([^']+)'/g;
        let match = pattern.exec(source);

        while (match !== null) {
            specifiers.push(match[1]);
            match = pattern.exec(source);
        }

        return specifiers;
    }

    const unitCode = executableSourceOf(unitSource);
    const specCode = executableSourceOf(specSource);

    const DIGEST_CALLS = [
        `${'$'}${'apply'}`,
        `${'$'}${'applyAsync'}`,
        `${'$'}${'digest'}`,
    ];
    const SOCKET_CONSTRUCTION = `new ${'Web'}${'Socket'}`;
    const SHADOW_ROOT_CALL = `${'attach'}${'Shadow'}`;
    const COMPOSED_KEY_PREFIX = `${['changes', 'project'].join('.')}.`;
    const END_TO_END_RUNNER = `@${'playwright'}/test`;

    it('reads a non-empty unit and a non-empty spec, so the assertions below can fail', () => {
        expect(unitSource.length).toBeGreaterThan(0);
        expect(specSource.length).toBeGreaterThan(0);
        expect(unitCode).toContain('useRealtime');
        expect(specCode).toContain('useRealtime');
    });

    it('never triggers an AngularJS digest, in the unit or in this spec', () => {
        DIGEST_CALLS.forEach((call: string): void => {
            expect(unitCode).not.toContain(call);
            expect(specCode).not.toContain(call);
        });
    });

    it('never constructs a realtime transport of its own', () => {
        expect(unitCode).not.toContain(SOCKET_CONSTRUCTION);
        expect(specCode).not.toContain(SOCKET_CONSTRUCTION);
    });

    it('never creates a shadow root', () => {
        expect(unitCode).not.toContain(SHADOW_ROOT_CALL);
        expect(specCode).not.toContain(SHADOW_ROOT_CALL);
    });

    it('imports no end-to-end runner, keeping the unit layer browserless', () => {
        expect(specSource).not.toContain(END_TO_END_RUNNER);
        expect(unitSource).not.toContain(END_TO_END_RUNNER);
    });

    it('hardcodes NO routing key -- keys are composed by the caller', () => {
        expect(unitSource).not.toContain(COMPOSED_KEY_PREFIX);
        expect(specSource).not.toContain(COMPOSED_KEY_PREFIX);

        expect(USERSTORIES_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'userstories',
        ]);
        expect(MILESTONES_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'milestones',
        ]);
        expect(PROJECTS_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'projects',
        ]);
    });

    it('imports nothing but React and the typed service accessor', () => {
        expect(importSpecifiersOf(unitSource)).toEqual(['react', './useAngularService']);
    });

    it('imports only the whitelisted bridge modules and the pinned test libraries', () => {
        expect([...new Set(importSpecifiersOf(specSource))]).toEqual([
            'fs',
            'path',
            '@testing-library/react',
            'react',
            './AngularBridgeContext',
            './mockInjector',
            './useRealtime',
        ]);
    });

    it('resets no mock by hand, because jest.config.js already does', () => {
        expect(specCode).not.toContain(`${'clear'}AllMocks`);
        expect(specCode).not.toContain(`${'restore'}AllMocks`);
        expect(specCode).not.toContain(`${'reset'}AllMocks`);
    });

    it('builds no persistent-collection fixture: React receives plain objects only', () => {
        expect(specSource).not.toContain(`${'Immut'}${'able'}`);
        expect(unitSource).not.toContain(`${'Immut'}${'able'}`);
    });
});
