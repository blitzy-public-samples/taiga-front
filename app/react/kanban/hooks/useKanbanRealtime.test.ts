/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useKanbanRealtime.test.ts -- THE KANBAN REALTIME CONTRACT, ASSERTED
 * ==========================================================================
 *
 * Co-located spec for `./useKanbanRealtime.ts`, carrying goal G4's coverage gate
 * for that module.
 *
 * WHAT IS BEING PROVEN, and why each part needs proving:
 *
 *   1. THE OWNERSHIP INVARIANT. `app/coffee/modules/events.coffee:214` stores ONE
 *      subscription per routing key for the whole application, and `unsubscribe`
 *      (`:219-230`) sends a wire command carrying only that key. The RETAINED
 *      `KanbanController` owns both of this screen's keys
 *      (`app/coffee/modules/kanban/main.coffee:341-360`), so a React subscription
 *      would overwrite its callback -- the board would silently stop refreshing --
 *      and either side's teardown would silence both. This hook must therefore
 *      SUBSCRIBE TO NOTHING and resolve no service at all, which is asserted by
 *      mounting it with no bridge provider above it.
 *   2. THE TRAILING DEBOUNCE. `debounceLeading` (`app/coffee/utils.coffee:121`)
 *      is a misnomer: it is lodash `{leading: false, trailing: true}`. Reading the
 *      NAME instead of the BODY inverts the behaviour, so the leading edge firing
 *      nothing, the reset-on-every-message, the single trailing invocation and the
 *      last-message-wins rule are each asserted separately.
 *   3. ONE SHARED, ONCE-DRAWN WAIT. `randomTimeout` is drawn once at `:342` and
 *      used by both callbacks, so the two timers share a wait without sharing a
 *      timer, and re-rendering must not re-roll it.
 *   4. THE `matches` NARROWING, AFTER THE DEBOUNCE. The incumbent's test sits
 *      INSIDE the debounced function (`:352-356`), so it runs against the LAST
 *      message of a burst only -- a matching message followed within the wait by a
 *      non-matching one refreshes nothing today, and must refresh nothing here.
 *   5. THE LIGHTBOX COALESCING BOUNDARY. Only the project stream is deferred
 *      (`:357-358`); many deferred messages coalesce into ONE refresh released on
 *      the true -> false edge (`:330-333`); closing with nothing pending is a
 *      no-op.
 *   6. CLEANUP. Both listeners released, both timers cancelled, and nothing
 *      delivered afterwards -- including a timer that was already queued.
 *
 * Fake timers are used throughout, because every assertion about the debounce is
 * an assertion about time. `jest.config.js` sets `clearMocks` and `restoreMocks`,
 * so no spec resets a mock by hand.
 *
 * This suite is browserless (requirement HR-5): jsdom only, no browser binary, no
 * network, and nothing here imports the end-to-end layer.
 * ========================================================================== */

import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    KANBAN_PROJECT_REFRESH_MATCHES,
    KANBAN_REALTIME_MAX_DELAY_MS,
    KANBAN_REALTIME_MIN_DELAY_MS,
    KANBAN_REALTIME_PROJECT_EVENT,
    KANBAN_REALTIME_USERSTORIES_EVENT,
    useKanbanRealtime,
} from './useKanbanRealtime';
import type {
    KanbanRealtimeEventName,
    KanbanRealtimeEventRegistrar,
    UseKanbanRealtimeOptions,
} from './useKanbanRealtime';

/* --------------------------------------------------------------------------
 * Test doubles
 * -------------------------------------------------------------------------- */

/**
 * The listener shape THE BRIDGE invokes: the payload, and nothing before it.
 *
 * ⭐ NOT `$scope.$on`'s own `(event, payload)` shape, deliberately. The bridge
 * does not hand a React handler to `$scope.$on`; it wraps it, DROPS AngularJS's
 * event object -- which carries `targetScope`/`currentScope` and would put a live
 * `$scope` on the React side of the seam -- and forwards only the payload
 * (`registerAngularEvent` in the matching `react-bridge.coffee`). A double that
 * invoked `(event, payload)` would be testing a producer that does not exist, and
 * would pass while the real hook read `undefined` on every message. The
 * cross-language spec at `app/react/bridge/reactBridgeContract.test.ts` pins this
 * shape against the real compiled bridge rather than against a double.
 */
type BridgeListener = (payload: unknown) => void;

interface RegistrarDouble {
    readonly register: jest.Mock<() => void, [KanbanRealtimeEventName, BridgeListener]>;
    registeredNames(): KanbanRealtimeEventName[];
    liveListenerCount(eventName: KanbanRealtimeEventName): number;
    readonly deregistrations: jest.Mock<void, []>[];
    broadcast(eventName: KanbanRealtimeEventName, payload?: unknown): void;
    broadcastIncludingReleased(eventName: KanbanRealtimeEventName, payload?: unknown): void;
}

/**
 * Reproduces `$scope.$on`: an ARRAY of listeners per event name, so a second
 * registration cannot displace the first, and one deregistration function per
 * registration which removes only its own listener.
 *
 * Listeners are retained after deregistration as well, so a spec can drive the
 * delivery that was already in flight when teardown ran.
 */
function makeRegistrarDouble(): RegistrarDouble {
    const live = new Map<KanbanRealtimeEventName, BridgeListener[]>();
    const everRegistered = new Map<KanbanRealtimeEventName, BridgeListener[]>();
    const deregistrations: jest.Mock<void, []>[] = [];

    const register = jest.fn<() => void, [KanbanRealtimeEventName, BridgeListener]>(
        (eventName, listener) => {
            const liveForName = live.get(eventName) ?? [];
            liveForName.push(listener);
            live.set(eventName, liveForName);

            const everForName = everRegistered.get(eventName) ?? [];
            everForName.push(listener);
            everRegistered.set(eventName, everForName);

            const deregister = jest.fn<void, []>(() => {
                const current = live.get(eventName) ?? [];

                live.set(
                    eventName,
                    current.filter((candidate) => candidate !== listener),
                );
            });

            deregistrations.push(deregister);

            return deregister;
        },
    );

    function invoke(listeners: BridgeListener[], payload: unknown): void {
        for (const listener of listeners) {
            listener(payload);
        }
    }

    return {
        register,
        deregistrations,
        registeredNames() {
            return register.mock.calls.map((call) => call[0]);
        },
        liveListenerCount(eventName) {
            return (live.get(eventName) ?? []).length;
        },
        broadcast(eventName, payload) {
            invoke(live.get(eventName) ?? [], payload);
        },
        broadcastIncludingReleased(eventName, payload) {
            invoke(everRegistered.get(eventName) ?? [], payload);
        },
    };
}

interface HookProps {
    readonly registrar: KanbanRealtimeEventRegistrar;
    readonly isLightboxOpen: boolean;
    readonly onUserStoriesChanged: jest.Mock<void, [unknown]>;
    readonly onProjectAttributesChanged: jest.Mock<void, []>;
}

function makeProps(registrar: KanbanRealtimeEventRegistrar, isLightboxOpen = false): HookProps {
    return {
        registrar,
        isLightboxOpen,
        onUserStoriesChanged: jest.fn<void, [unknown]>(),
        onProjectAttributesChanged: jest.fn<void, []>(),
    };
}

/**
 * Mounts the hook with NO bridge provider above it -- an assertion in itself, as
 * a hook that resolved any AngularJS service through the bridge would throw here.
 */
function mountHook(
    props: HookProps,
): ReturnType<typeof renderHook<void, HookProps>> {
    return renderHook(
        (current: HookProps) => {
            const options: UseKanbanRealtimeOptions = {
                registerAngularEvent: current.registrar,
                isLightboxOpen: current.isLightboxOpen,
                onUserStoriesChanged: current.onUserStoriesChanged,
                onProjectAttributesChanged: current.onProjectAttributesChanged,
            };

            useKanbanRealtime(options);
        },
        { initialProps: props },
    );
}

/** Advances past the longest wait the hook can have drawn. */
function runOutTheWait(): void {
    act(() => {
        jest.advanceTimersByTime(KANBAN_REALTIME_MAX_DELAY_MS + 1);
    });
}

/**
 * The unit's source with every comment removed, so a source-level prohibition can
 * be asserted against the CODE without tripping over the prose documenting it.
 */
function readExecutableSource(): string {
    return readFileSync(join(__dirname, 'useKanbanRealtime.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

const MATCHING_MESSAGE = { matches: KANBAN_PROJECT_REFRESH_MATCHES[0] };
const NON_MATCHING_MESSAGE = { matches: 'projects.tag' };

/**
 * Project payloads that must not rebuild the board.
 *
 * `isProjectRefreshMessage` narrows an `unknown`, so the malformed shapes matter
 * as much as the well-formed-but-unrelated one: a realtime payload is whatever
 * arrived over the socket, and a board that throws on an unexpected message is
 * worse than one that ignores it.
 */
const IGNORED_PROJECT_PAYLOADS: Array<[string, unknown]> = [
    ['an unrelated match', NON_MATCHING_MESSAGE],
    ['no matches member', { pk: 1 }],
    ['a non-string matches', { matches: 42 }],
    ['a matches that only looks close', { matches: 'projects.swimlanes' }],
    ['a primitive payload', 'projects.swimlane'],
    ['a null payload', null],
    ['no payload at all', undefined],
];

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

/* --------------------------------------------------------------------------
 * The ownership invariant
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- the ownership invariant', () => {
    it('mounts with no bridge provider at all, so it resolves no AngularJS service', () => {
        const registrar = makeRegistrarDouble();

        expect(() => mountHook(makeProps(registrar.register))).not.toThrow();
        expect(registrar.register).toHaveBeenCalledTimes(2);
    });

    it('subscribes to nothing and resolves nothing in its EXECUTABLE source', () => {
        const executable = readExecutableSource();

        expect(executable.length).toBeGreaterThan(0);

        for (const forbidden of [
            'subscribe',
            'unsubscribe',
            'useAngularService',
            'useRealtime',
            '$tgEvents',
            'changes.project',
            'milestones',
            'selfNotification',
        ]) {
            expect(executable).not.toContain(forbidden);
        }
    });

    it('drives no AngularJS digest in its EXECUTABLE source', () => {
        const executable = readExecutableSource();

        for (const driver of ['$apply', '$digest']) {
            expect(executable).not.toContain(driver);
        }
    });
});

/* --------------------------------------------------------------------------
 * The frozen stream set
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- the frozen stream set', () => {
    it('registers EXACTLY TWO listeners, for the user-story and project streams', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        expect(registrar.register).toHaveBeenCalledTimes(2);
        expect(registrar.registeredNames()).toEqual([
            KANBAN_REALTIME_USERSTORIES_EVENT,
            KANBAN_REALTIME_PROJECT_EVENT,
        ]);
    });

    it('uses the event names the retained controller broadcasts', () => {
        expect(KANBAN_REALTIME_USERSTORIES_EVENT).toBe(
            ['kanban', 'realtime', 'userstories'].join(':'),
        );
        expect(KANBAN_REALTIME_PROJECT_EVENT).toBe(['kanban', 'realtime', 'projects'].join(':'));

        const controllerSource = readFileSync(
            join(__dirname, '..', '..', '..', 'coffee', 'modules', 'kanban', 'main.coffee'),
            'utf8',
        );

        expect(controllerSource).toContain(
            `$broadcast("${KANBAN_REALTIME_USERSTORIES_EVENT}", message)`,
        );
        expect(controllerSource).toContain(`$broadcast("${KANBAN_REALTIME_PROJECT_EVENT}", message)`);
    });

    it('freezes the three project matches that rebuild the board', () => {
        expect(KANBAN_PROJECT_REFRESH_MATCHES).toEqual([
            'projects.swimlane',
            'projects.swimlaneuserstorystatus',
            'projects.userstorystatus',
        ]);
    });
});

/* --------------------------------------------------------------------------
 * The trailing debounce
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- the trailing debounce', () => {
    it('fires NOTHING on the leading edge', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
    });

    it('fires exactly once after the quiet period', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('delivers the LAST message of a burst, and only it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);
        const last = { pk: 3 };

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 2 });
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, last);
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledWith(last);
    });

    it('hands the payload over by IDENTITY, neither cloned nor reshaped', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);
        const payload = { pk: [7, 8, 9] };

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, payload);
        runOutTheWait();

        expect(props.onUserStoriesChanged.mock.calls[0]?.[0]).toBe(payload);
    });

    it('resets the wait on every message rather than firing on a schedule', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // Nudge the timer forward in steps shorter than the minimum wait, so a
        // reset-less implementation would have fired by the end of the loop.
        for (let nudge = 0; nudge < 6; nudge += 1) {
            registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: nudge });

            act(() => {
                jest.advanceTimersByTime(KANBAN_REALTIME_MIN_DELAY_MS - 100);
            });
        }

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps the two streams on INDEPENDENT timers', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);

        // A burst on the OTHER stream must not postpone the project timer.
        for (let nudge = 0; nudge < 4; nudge += 1) {
            registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: nudge });

            act(() => {
                jest.advanceTimersByTime(200);
            });
        }

        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('draws ONE wait in the inclusive 700-1000 ms range and never re-rolls it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        const { rerender } = mountHook(props);

        rerender({ ...props });
        rerender({ ...props });

        expect(randomSpy).toHaveBeenCalledTimes(1);

        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });

        act(() => {
            jest.advanceTimersByTime(KANBAN_REALTIME_MIN_DELAY_MS - 1);
        });

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(KANBAN_REALTIME_MAX_DELAY_MS);
        });

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(KANBAN_REALTIME_MIN_DELAY_MS).toBe(700);
        expect(KANBAN_REALTIME_MAX_DELAY_MS).toBe(1000);
    });

    it('invokes the LATEST handlers, never a stale closure', () => {
        const registrar = makeRegistrarDouble();
        const first = makeProps(registrar.register);
        const second = makeProps(registrar.register);

        const { rerender } = mountHook(first);

        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        rerender({ ...second });
        runOutTheWait();

        expect(first.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(registrar.register).toHaveBeenCalledTimes(2);
    });
});

/* --------------------------------------------------------------------------
 * The project narrowing
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- the project narrowing', () => {
    it.each(KANBAN_PROJECT_REFRESH_MATCHES)('rebuilds the board for %s', (matches) => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, { matches });
        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it.each(IGNORED_PROJECT_PAYLOADS)('ignores %s without throwing', (_label, payload) => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        expect(() => {
            registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, payload);
            runOutTheWait();
        }).not.toThrow();

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('narrows AFTER the debounce, so a non-matching last message cancels the refresh', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // Exactly the incumbent's behaviour: the `matches` test lives inside the
        // debounced function, so only the LAST message of the burst is tested.
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, NON_MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('never routes a project message to the user-story handler', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * The lightbox coalescing boundary
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- the lightbox coalescing boundary', () => {
    it('defers a matching project message while a lightbox is open', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('does NOT defer user-story messages while a lightbox is open', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        mountHook(props);
        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('coalesces MANY deferred messages into exactly ONE refresh on close', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        for (let burst = 0; burst < 4; burst += 1) {
            registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
            runOutTheWait();
        }

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('releases on the true -> false EDGE, so a repeated false is a no-op', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // Level-triggered logic would fire again on every render that merely
        // repeats `false`, which is most renders of a board with no lightbox.
        rerender({ ...props, isLightboxOpen: false });
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('does not release on a FIRST render that is already closed', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, false);

        mountHook(props);

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('closing with nothing pending is a no-op', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('refreshes immediately once the lightbox is closed again', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        rerender({ ...props, isLightboxOpen: false });
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('lets a failing rebuild ESCAPE rather than swallowing it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        props.onProjectAttributesChanged.mockImplementationOnce(() => {
            throw new Error('rebuild failed');
        });

        // React reports an uncaught commit-phase error through `console.error`
        // before re-throwing it. The throw is the assertion here, so the report is
        // expected output rather than a problem; silencing it for this one test
        // keeps a green run's stderr genuinely empty. `restoreMocks` puts the real
        // console back afterwards.
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { rerender } = mountHook(props);

        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // A swallowed failure is the worst outcome available here: the board would
        // sit there showing columns the project no longer has, with nothing in the
        // console. So the release must not wrap the callback in a catch — the
        // throw escapes exactly as it would escape `main.coffee:332`, and the
        // owning tree's ErrorBoundary is what decides what to do about it.
        //
        // Note on what is NOT asserted: `main.coffee:331-333` clears the pending
        // flag AFTER the refresh, so a failed rebuild stays owed. That ordering is
        // implemented, but its consequence is unobservable from here, because
        // React escalates an uncaught error thrown in a passive effect to the root
        // and unmounts the tree — taking the very ref that holds the flag with it.
        // Asserting a second release after this point would be asserting React's
        // teardown behaviour, not the hook's.
        expect(() => rerender({ ...props, isLightboxOpen: false })).toThrow('rebuild failed');
        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // The report was React's, not a second failure path of our own.
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('releases again on a SECOND open-defer-close cycle', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        // Cycle one.
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // Cycle two, on the SAME hook instance. This is what proves the pending
        // flag was actually cleared after the first release and that the
        // reentrancy guard was reset in its `finally` — a guard left latched, or a
        // flag left set, both show up right here.
        rerender({ ...props, isLightboxOpen: true });
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(2);
    });
});

/* --------------------------------------------------------------------------
 * Cleanup
 * -------------------------------------------------------------------------- */

describe('useKanbanRealtime -- cleanup', () => {
    it('releases BOTH listeners exactly once on unmount', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        unmount();

        expect(registrar.deregistrations).toHaveLength(2);

        for (const deregister of registrar.deregistrations) {
            expect(deregister).toHaveBeenCalledTimes(1);
        }

        expect(registrar.liveListenerCount(KANBAN_REALTIME_USERSTORIES_EVENT)).toBe(0);
        expect(registrar.liveListenerCount(KANBAN_REALTIME_PROJECT_EVENT)).toBe(0);
    });

    it('cancels a queued debounce so it can never fire after unmount', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHook(props);

        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        unmount();
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('ignores a delivery that was already in flight when teardown ran', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHook(props);

        unmount();
        registrar.broadcastIncludingReleased(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        registrar.broadcastIncludingReleased(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('drops a deferred rebuild when the board goes away before the lightbox closes', () => {
        const registrar = makeRegistrarDouble();
        const first = makeProps(registrar.register, true);

        const firstMount = mountHook(first);

        registrar.broadcast(KANBAN_REALTIME_PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        firstMount.unmount();

        // A fresh board must not inherit the previous one's owed rebuild: the
        // pending flag lives on the hook INSTANCE, never at module level, which is
        // also what keeps two boards on one page from releasing each other's work.
        const second = makeProps(registrar.register, true);
        const secondMount = mountHook(second);

        secondMount.rerender({ ...second, isLightboxOpen: false });

        expect(first.onProjectAttributesChanged).not.toHaveBeenCalled();
        expect(second.onProjectAttributesChanged).not.toHaveBeenCalled();

        secondMount.unmount();
    });

    it('re-arms after a remount and delivers again', () => {
        const registrar = makeRegistrarDouble();
        const first = makeProps(registrar.register);

        mountHook(first).unmount();

        const second = makeProps(registrar.register);
        const secondMount = mountHook(second);

        expect(registrar.liveListenerCount(KANBAN_REALTIME_USERSTORIES_EVENT)).toBe(1);
        expect(registrar.liveListenerCount(KANBAN_REALTIME_PROJECT_EVENT)).toBe(1);

        registrar.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        runOutTheWait();

        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);

        secondMount.unmount();
    });

    it('re-registers when the registrar identity changes, releasing the old listeners first', () => {
        const first = makeRegistrarDouble();
        const second = makeRegistrarDouble();
        const props = makeProps(first.register);

        const { rerender } = mountHook(props);

        rerender({ ...props, registrar: second.register });

        expect(first.liveListenerCount(KANBAN_REALTIME_USERSTORIES_EVENT)).toBe(0);
        expect(second.register).toHaveBeenCalledTimes(2);

        second.broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { pk: 1 });
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });
});
