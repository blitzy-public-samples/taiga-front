/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useBacklogRealtime.test.ts -- THE FROZEN REALTIME CONTRACT, ASSERTED
 * ==========================================================================
 *
 * Co-located spec for `./useBacklogRealtime.ts`, carrying goal G4's coverage
 * gate for that module. AAP 0.5.1 and 0.6.2 both place specs beside the unit
 * under test as `app/react/**` files, and `jest.config.js` collects coverage
 * from every source in that tree, so this file is what keeps the hook honest
 * rather than merely typed.
 *
 * WHAT IS BEING PROVEN, and why each half needs proving:
 *
 *   1. THE FROZEN CONTRACT (goal G2). Two subscriptions and not three; the
 *      right resource on each; the wire options on the `milestones`
 *      subscription alone; the `userstories` message driving two reload
 *      actions and the `milestones` message driving three, in source order.
 *      Every one of these is invisible at run time if it is wrong -- a missing
 *      options object simply means some pushes never arrive.
 *   2. THE LEAK REGRESSION (AAP 0.6.3, item 8). Both keys released on unmount;
 *      the caller's handlers never invoked afterwards even though the service
 *      keeps its registry entry after unsubscribing; a new inline handlers
 *      object on every render not resubscribing anything. A leak here throws
 *      nothing and logs nothing, so only an assertion catches it.
 *
 * ONE LINE OF THE UNIT IS DELIBERATELY LEFT UNCOVERED, and it is named here so
 * nobody mistakes it for an oversight: the early return inside the user-story
 * deliverer's lifecycle guard. Its twin in the milestone deliverer IS covered,
 * by the ordering spec below, which reaches it through the one window that
 * exists -- a message arriving while the first subscription is being released
 * and the second one's own guard is therefore still open. The user-story
 * deliverer has no such window, because it is the first subscription released
 * and the primitive's per-subscription guard closes ahead of it. The line is
 * defence in depth rather than dead code: it is what keeps "the caller's
 * handlers are never invoked after unmount" a property of the hook itself
 * instead of one inherited from another module's internals, and reaching it
 * from a spec would mean contorting the hook's structure to suit the spec.
 *
 * HOW THE SERVICE IS DOUBLED. `makeEventsDouble` reproduces the two behaviours
 * of `app/coffee/modules/events.coffee` that make this seam hazardous, so the
 * assertions are meaningful rather than self-fulfilling:
 *
 *   - ONE FLAT REGISTRY KEYED BY ROUTING KEY (`:214`), overwritten
 *     unconditionally, so a second subscribe to the same key clobbers the
 *     first -- hazard H2;
 *   - `unsubscribe` MUTATING NOTHING (`:219-230`), so the registry keeps the
 *     callback and `dispatch` can still deliver to it after teardown --
 *     hazard H1.
 *
 * `dispatch` reproduces `processMessage` (`:177-190`) taking the null-scope
 * branch at `:189-190`: the stored callback is invoked directly, with no
 * digest cycle around it.
 *
 * The double is typed as the real facade intersected with the mock types, so it
 * cannot drift out of conformance with `TaigaEventsService` without failing the
 * type gate. `jest.config.js` sets `clearMocks` and `restoreMocks`, so no spec
 * below resets mocks by hand.
 *
 * This suite is browserless (requirement HR-5): jsdom only, no browser binary,
 * no network, and nothing here imports the end-to-end layer.
 * ========================================================================== */

import { renderHook } from '@testing-library/react';

import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import type { RealtimeSubscriptionOptions } from '../../bridge/useRealtime';
import type { TaigaEventsService } from '../../bridge/useAngularService';
import { useBacklogRealtime } from './useBacklogRealtime';
import type { BacklogRealtimeHandlers } from './useBacklogRealtime';

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

interface EventsDouble {
    service: TaigaEventsService & {
        subscribe: SubscribeMock;
        unsubscribe: UnsubscribeMock;
    };

    /** Delivers a message the way `processMessage` does (`:177-190`). */
    dispatch(routingKey: string, payload: unknown): void;

    /** Every routing key the double was asked to subscribe to, in order. */
    subscribedKeys(): string[];
}

function makeEventsDouble(): EventsDouble {
    // Mirrors `@.subscriptions` (`:214`): one flat map for the whole
    // application, overwritten unconditionally and DELIBERATELY never pruned.
    const subscriptions = new Map<string, Subscriber>();

    const subscribe: SubscribeMock = jest.fn((_scope, routingKey, callback) => {
        subscriptions.set(routingKey, callback);
    });

    // `:219-230` sends the wire command only. No map mutation, by design --
    // which is precisely hazard H1.
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
        subscribedKeys() {
            return subscribe.mock.calls.map((call) => call[1]);
        },
    };
}

/**
 * Assembles a routing key from its four segments HERE, in the spec, so the
 * expected values are built independently of the hook that produces them.
 */
function projectKey(projectId: number, resource: string): string {
    return ['changes', 'project', String(projectId), resource].join('.');
}

const PROJECT_ID = 7;
const USERSTORIES_KEY = projectKey(PROJECT_ID, 'userstories');
const MILESTONES_KEY = projectKey(PROJECT_ID, 'milestones');
const PROJECTS_KEY = projectKey(PROJECT_ID, 'projects');

interface HandlerDoubles extends BacklogRealtimeHandlers {
    readonly onUserStoriesChanged: jest.Mock<void, []>;
    readonly onMilestonesChanged: jest.Mock<void, []>;
}

function makeHandlers(): HandlerDoubles {
    return {
        onUserStoriesChanged: jest.fn<void, []>(),
        onMilestonesChanged: jest.fn<void, []>(),
    };
}

/** Mounts the hook with a `$tgEvents` double published through the bridge. */
function mountHook(
    events: EventsDouble,
    projectId: number | null | undefined,
    handlers: BacklogRealtimeHandlers,
): ReturnType<typeof renderHook<void, { projectId: number | null | undefined }>> {
    return renderHook(
        ({ projectId: id }: { projectId: number | null | undefined }) => {
            useBacklogRealtime(id, handlers);
        },
        {
            initialProps: { projectId },
            wrapper: withMockInjector(mockInjector({ $tgEvents: events.service })),
        },
    );
}

/* --------------------------------------------------------------------------
 * The frozen contract (goal G2)
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- the frozen subscription set', () => {
    it('subscribes to EXACTLY TWO routing keys', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
    });

    it('subscribes to the userstories resource and the milestones resource', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        expect(events.subscribedKeys()).toEqual([USERSTORIES_KEY, MILESTONES_KEY]);
    });

    it('never subscribes to the project-attributes resource, which is Kanban only', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        expect(events.subscribedKeys()).not.toContain(PROJECTS_KEY);
    });

    it('builds each key from the live project id', () => {
        const events = makeEventsDouble();

        mountHook(events, 412, makeHandlers());

        expect(events.subscribedKeys()).toEqual([
            projectKey(412, 'userstories'),
            projectKey(412, 'milestones'),
        ]);
    });

    it('passes the literal null as the scope, which is why teardown is ours', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        for (const call of events.service.subscribe.mock.calls) {
            expect(call[0]).toBeNull();
        }
    });
});

describe('useBacklogRealtime -- the wire options', () => {
    it('supplies { selfNotification: true } to the milestones subscription', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        const milestonesCall = events.service.subscribe.mock.calls.find(
            (call) => call[1] === MILESTONES_KEY,
        );

        // Asserted argument by argument rather than through an asymmetric
        // matcher, so the callback slot is checked structurally and no
        // wildcard-typed helper appears in this tree.
        expect(milestonesCall).toBeDefined();
        expect(milestonesCall?.[0]).toBeNull();
        expect(typeof milestonesCall?.[2]).toBe('function');
        expect(milestonesCall?.[3]).toEqual({ selfNotification: true });
    });

    it('supplies NO options object to the userstories subscription', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers());

        const userStoriesCall = events.service.subscribe.mock.calls.find(
            (call) => call[1] === USERSTORIES_KEY,
        );

        expect(userStoriesCall).toBeDefined();
        // `undefined`, not an empty object: the service omits the `options`
        // member from the outgoing command entirely when nothing is supplied
        // (`app/coffee/modules/events.coffee:211-212`), which is a different
        // wire message.
        expect(userStoriesCall?.[3]).toBeUndefined();
    });

    it('reuses the SAME options object across remounts, never a fresh literal', () => {
        const events = makeEventsDouble();

        const first = mountHook(events, PROJECT_ID, makeHandlers());
        first.unmount();
        mountHook(events, PROJECT_ID, makeHandlers());

        const optionsArguments = events.service.subscribe.mock.calls
            .filter((call) => call[1] === MILESTONES_KEY)
            .map((call) => call[3]);

        expect(optionsArguments).toHaveLength(2);
        expect(optionsArguments[0]).toBe(optionsArguments[1]);
    });
});

/* --------------------------------------------------------------------------
 * Delivery: the reload actions each resource drives
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- delivery', () => {
    it('drives the user-story handler, and only it, on a userstories message', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers);
        events.dispatch(USERSTORIES_KEY, { matches: 'userstories.userstory' });

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
    });

    it('drives the milestone handler, and only it, on a milestones message', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers);
        events.dispatch(MILESTONES_KEY, { matches: 'milestones.milestone' });

        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
    });

    it('delivers every message, not just the first', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers);
        events.dispatch(USERSTORIES_KEY, 1);
        events.dispatch(USERSTORIES_KEY, 2);
        events.dispatch(MILESTONES_KEY, 3);

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(2);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
    });

    it('invokes handlers with no argument, because the payload is not consulted', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers);
        events.dispatch(USERSTORIES_KEY, { ignored: true });

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledWith();
    });

    it('ignores a message for a resource it did not subscribe to', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers);
        events.dispatch(PROJECTS_KEY, { matches: 'projects.swimlane' });

        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
    });

    it('invokes the LATEST handlers, never a stale closure', () => {
        const events = makeEventsDouble();
        const stale = makeHandlers();
        const fresh = makeHandlers();

        const { rerender } = renderHook(
            ({ handlers }: { handlers: BacklogRealtimeHandlers }) => {
                useBacklogRealtime(PROJECT_ID, handlers);
            },
            {
                initialProps: { handlers: stale as BacklogRealtimeHandlers },
                wrapper: withMockInjector(mockInjector({ $tgEvents: events.service })),
            },
        );

        rerender({ handlers: fresh as BacklogRealtimeHandlers });
        events.dispatch(MILESTONES_KEY, null);

        expect(fresh.onMilestonesChanged).toHaveBeenCalledTimes(1);
        expect(stale.onMilestonesChanged).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * The unresolved project id
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- an unresolved project id', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('subscribes to nothing while the id is %s', (_label, projectId) => {
        const events = makeEventsDouble();

        mountHook(events, projectId, makeHandlers());

        expect(events.service.subscribe).not.toHaveBeenCalled();
    });

    it('subscribes to nothing for a falsy numeric id, matching the incumbent guard', () => {
        const events = makeEventsDouble();

        mountHook(events, 0, makeHandlers());

        expect(events.service.subscribe).not.toHaveBeenCalled();
    });

    it('takes both subscriptions once the id resolves', () => {
        const events = makeEventsDouble();

        const { rerender } = mountHook(events, null, makeHandlers());
        expect(events.service.subscribe).not.toHaveBeenCalled();

        rerender({ projectId: PROJECT_ID });

        expect(events.subscribedKeys()).toEqual([USERSTORIES_KEY, MILESTONES_KEY]);
    });

    it('releases nothing on unmount when it never subscribed', () => {
        const events = makeEventsDouble();

        mountHook(events, null, makeHandlers()).unmount();

        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * The leak regression (AAP 0.6.3, item 8)
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- cleanup, the mandated proof', () => {
    it('releases BOTH routing keys exactly once on unmount', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers()).unmount();

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(2);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(events.service.unsubscribe).toHaveBeenCalledWith(MILESTONES_KEY);
    });

    it('releases each key with EXACTLY ONE argument', () => {
        const events = makeEventsDouble();

        mountHook(events, PROJECT_ID, makeHandlers()).unmount();

        for (const call of events.service.unsubscribe.mock.calls) {
            expect(call).toHaveLength(1);
        }
    });

    it('invokes NEITHER handler after unmount, although the registry keeps them', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers).unmount();

        // Hazard H1: `unsubscribe` removed nothing, so the double still finds
        // both callbacks and delivers to them -- exactly as the real service
        // does for a message already in flight.
        events.dispatch(USERSTORIES_KEY, null);
        events.dispatch(MILESTONES_KEY, null);

        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
    });

    it('silences the handlers BEFORE either subscription is released', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        // The ordering property the lifecycle guard exists for, exercised
        // directly. React releases the two subscriptions in the order they were
        // created, so at the instant the FIRST key is released the second
        // subscription's own guard is still open -- this reproduces a message
        // arriving in exactly that window. Only the hook's own guard can stop
        // it, so this asserts that the guard is set before the first release
        // rather than after the last one.
        events.service.unsubscribe.mockImplementation((routingKey) => {
            if (routingKey === USERSTORIES_KEY) {
                events.dispatch(MILESTONES_KEY, null);
            }
        });

        mountHook(events, PROJECT_ID, handlers).unmount();

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(2);
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
    });

    it('moves both subscriptions when the project changes, releasing the old keys', () => {
        const events = makeEventsDouble();

        const { rerender } = mountHook(events, PROJECT_ID, makeHandlers());
        rerender({ projectId: 99 });

        expect(events.service.unsubscribe.mock.calls.map((call) => call[0])).toEqual([
            USERSTORIES_KEY,
            MILESTONES_KEY,
        ]);
        expect(events.subscribedKeys()).toEqual([
            USERSTORIES_KEY,
            MILESTONES_KEY,
            projectKey(99, 'userstories'),
            projectKey(99, 'milestones'),
        ]);
    });

    it('releases both keys when the project id becomes unresolved again', () => {
        const events = makeEventsDouble();

        const { rerender } = mountHook(events, PROJECT_ID, makeHandlers());
        rerender({ projectId: null });

        expect(events.service.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('does NOT resubscribe when a fresh handlers object arrives every render', () => {
        const events = makeEventsDouble();

        const { rerender } = renderHook(
            () => {
                // A new object literal on every render, which is what a call
                // site writes naturally and must therefore be safe.
                useBacklogRealtime(PROJECT_ID, {
                    onUserStoriesChanged: () => undefined,
                    onMilestonesChanged: () => undefined,
                });
            },
            { wrapper: withMockInjector(mockInjector({ $tgEvents: events.service })) },
        );

        rerender();
        rerender();
        rerender();

        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('does NOT resubscribe when the project id is re-rendered unchanged', () => {
        const events = makeEventsDouble();

        const { rerender } = mountHook(events, PROJECT_ID, makeHandlers());
        rerender({ projectId: PROJECT_ID });

        expect(events.service.subscribe).toHaveBeenCalledTimes(2);
        expect(events.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('holds one live subscription per resource across a remount, and delivers again', () => {
        const events = makeEventsDouble();
        const handlers = makeHandlers();

        mountHook(events, PROJECT_ID, handlers).unmount();
        const second = mountHook(events, PROJECT_ID, handlers);

        events.dispatch(USERSTORIES_KEY, null);
        events.dispatch(MILESTONES_KEY, null);

        // The lifecycle guard is re-armed on the way back in; a guard left set
        // by the first cleanup would swallow both of these.
        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);

        second.unmount();
        expect(events.service.unsubscribe).toHaveBeenCalledTimes(4);
    });
});
