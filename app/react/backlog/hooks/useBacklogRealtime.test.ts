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
 *   1. THE OWNERSHIP INVARIANT. `app/coffee/modules/events.coffee:214` stores
 *      ONE subscription per routing key for the whole application, and
 *      `unsubscribe` (`:219-230`) sends a wire command carrying only that key.
 *      The RETAINED `BacklogController` owns both of this screen's keys
 *      (`app/coffee/modules/backlog/main.coffee:269-280`), so a React
 *      subscription would overwrite its callback and either side's teardown
 *      would silence both. This hook must therefore SUBSCRIBE TO NOTHING and
 *      resolve no service at all -- asserted here by mounting it with no bridge
 *      provider above it, which is exactly what a hook that resolved `$tgEvents`
 *      could not survive.
 *   2. THE FROZEN STREAM SET (goal G2). Two listeners and not three, on the two
 *      event names the controller re-publishes on, each driving its own reload
 *      action and no other. Every one of these is invisible at run time if it is
 *      wrong -- a listener on a name nobody broadcasts simply never fires, and
 *      AngularJS registers it quite happily.
 *   3. THE LEAK REGRESSION (AAP 0.6.3, item 8). Both listeners released on
 *      unmount; the caller's handlers never invoked afterwards even for a
 *      delivery already in flight; a new inline handlers object on every render
 *      not re-registering anything. A leak here throws nothing and logs nothing,
 *      so only an assertion catches it.
 *
 * HOW THE SEAM IS DOUBLED. `makeRegistrarDouble` reproduces `$scope.$on`
 * faithfully, including the two properties that matter for this hook:
 *
 *   - MANY LISTENERS PER EVENT NAME. A scope keeps an ARRAY per name, so
 *     registering a second listener cannot displace the first -- the exact
 *     opposite of the routing-key registry, and the reason listening is safe
 *     where subscribing is not;
 *   - A DEREGISTRATION FUNCTION PER REGISTRATION, which removes only its own
 *     listener. The double also keeps the listener reference after
 *     deregistration so a spec can drive a delivery that was already in flight
 *     when teardown ran (hazard H1), which is otherwise unreachable.
 *
 * This suite is browserless (requirement HR-5): jsdom only, no browser binary,
 * no network, and nothing here imports the end-to-end layer.
 * ========================================================================== */

import { renderHook } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    BACKLOG_REALTIME_MILESTONES_EVENT,
    BACKLOG_REALTIME_USERSTORIES_EVENT,
    useBacklogRealtime,
} from './useBacklogRealtime';
import type {
    BacklogRealtimeEventName,
    BacklogRealtimeEventRegistrar,
    BacklogRealtimeHandlers,
} from './useBacklogRealtime';

/* --------------------------------------------------------------------------
 * Test doubles
 * -------------------------------------------------------------------------- */

/** The listener shape AngularJS invokes: event object first, payload second. */
type ScopeListener = (event: unknown, payload: unknown) => void;

interface RegistrarDouble {
    /** The registrar itself, shaped exactly like `events.onAngularEvent`. */
    readonly register: jest.Mock<() => void, [BacklogRealtimeEventName, ScopeListener]>;

    /** Every event name the hook registered for, in registration order. */
    registeredNames(): BacklogRealtimeEventName[];

    /** Listeners still registered for one event name. */
    liveListenerCount(eventName: BacklogRealtimeEventName): number;

    /** Every deregistration function handed out, in registration order. */
    readonly deregistrations: jest.Mock<void, []>[];

    /** Broadcasts to the listeners that are still registered for a name. */
    broadcast(eventName: BacklogRealtimeEventName, payload?: unknown): void;

    /**
     * Invokes EVERY listener ever registered for a name, including ones already
     * deregistered -- the in-flight delivery of hazard H1.
     */
    broadcastIncludingReleased(eventName: BacklogRealtimeEventName, payload?: unknown): void;
}

function makeRegistrarDouble(): RegistrarDouble {
    // An array per name, like a real scope: registering never displaces.
    const live = new Map<BacklogRealtimeEventName, ScopeListener[]>();
    const everRegistered = new Map<BacklogRealtimeEventName, ScopeListener[]>();
    const deregistrations: jest.Mock<void, []>[] = [];

    const register = jest.fn<() => void, [BacklogRealtimeEventName, ScopeListener]>(
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

    function invoke(listeners: ScopeListener[], payload: unknown): void {
        for (const listener of listeners) {
            listener({ name: 'angular-event-object' }, payload);
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

/** An event name the hook must never register for. */
const KANBAN_PROJECT_EVENT = 'kanban:realtime:projects';

/**
 * The unit's source with every comment removed, so a source-level prohibition
 * can be asserted against the CODE without tripping over the prose that
 * documents it.
 *
 * Block comments go first and line comments second, which is the only order that
 * survives a `//` sequence appearing inside a block comment.
 */
function readExecutableSource(): string {
    return readFileSync(join(__dirname, 'useBacklogRealtime.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

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

/**
 * Mounts the hook with NO bridge provider above it.
 *
 * That omission is an assertion in itself: a hook that resolved `$tgEvents`,
 * `$rootScope` or any other service through the bridge would throw here. The
 * registrar is the hook's entire AngularJS surface, and it arrives as an
 * argument.
 */
function mountHook(
    registrar: BacklogRealtimeEventRegistrar,
    handlers: BacklogRealtimeHandlers,
): ReturnType<
    typeof renderHook<
        void,
        { registrar: BacklogRealtimeEventRegistrar; handlers: BacklogRealtimeHandlers }
    >
> {
    return renderHook(
        ({
            registrar: currentRegistrar,
            handlers: currentHandlers,
        }: {
            registrar: BacklogRealtimeEventRegistrar;
            handlers: BacklogRealtimeHandlers;
        }) => {
            useBacklogRealtime(currentRegistrar, currentHandlers);
        },
        { initialProps: { registrar, handlers } },
    );
}

/* --------------------------------------------------------------------------
 * The ownership invariant
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- the ownership invariant', () => {
    it('mounts with no bridge provider at all, so it resolves no AngularJS service', () => {
        const registrar = makeRegistrarDouble();

        expect(() => mountHook(registrar.register, makeHandlers())).not.toThrow();
        expect(registrar.register).toHaveBeenCalledTimes(2);
    });

    it('subscribes to nothing and resolves nothing in its EXECUTABLE source', () => {
        const executable = readExecutableSource();

        // A source-level pass as well as a behavioural one: the specs below can
        // only observe the paths they exercise, whereas this holds for every path,
        // including one a future edit might add behind a condition. Comments are
        // stripped first, because the unit's prose legitimately QUOTES the
        // AngularJS subscription it is documenting -- what must be absent is the
        // code, not the explanation.
        expect(executable.length).toBeGreaterThan(0);

        for (const forbidden of [
            'subscribe',
            'unsubscribe',
            'useAngularService',
            'useRealtime',
            '$tgEvents',
            'changes.project',
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
 * The frozen stream set (goal G2)
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- the frozen stream set', () => {
    it('registers EXACTLY TWO listeners', () => {
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        expect(registrar.register).toHaveBeenCalledTimes(2);
    });

    it('registers for the userstories stream and the milestones stream', () => {
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        expect(registrar.registeredNames()).toEqual([
            BACKLOG_REALTIME_USERSTORIES_EVENT,
            BACKLOG_REALTIME_MILESTONES_EVENT,
        ]);
    });

    it('never registers for the project-attributes stream, which is Kanban only', () => {
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        expect(registrar.registeredNames()).not.toContain(KANBAN_PROJECT_EVENT);
    });

    it('uses the event names the retained controller broadcasts', () => {
        // Assembled from parts here so the expected values are independent of the
        // constants under test, and cross-checked against the CoffeeScript that
        // raises them -- the two ends are a contract, and a rename at one end is
        // silent at the other.
        expect(BACKLOG_REALTIME_USERSTORIES_EVENT).toBe(
            ['backlog', 'realtime', 'userstories'].join(':'),
        );
        expect(BACKLOG_REALTIME_MILESTONES_EVENT).toBe(
            ['backlog', 'realtime', 'milestones'].join(':'),
        );

        const controllerSource = readFileSync(
            join(__dirname, '..', '..', '..', 'coffee', 'modules', 'backlog', 'main.coffee'),
            'utf8',
        );

        expect(controllerSource).toContain(
            `$broadcast("${BACKLOG_REALTIME_USERSTORIES_EVENT}", message)`,
        );
        expect(controllerSource).toContain(
            `$broadcast("${BACKLOG_REALTIME_MILESTONES_EVENT}", message)`,
        );
    });
});

/* --------------------------------------------------------------------------
 * Delivery
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- delivery', () => {
    it('drives the user-story handler, and only it, on a userstories broadcast', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);
        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, { pk: 1 });

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
    });

    it('drives the milestone handler, and only it, on a milestones broadcast', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);
        registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, { pk: 2 });

        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
    });

    it('delivers every broadcast, not just the first -- there is no debounce here', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);

        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(3);
    });

    it('invokes handlers with no argument, because the payload is not consulted', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);
        registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, { pk: [4, 5, 6] });

        expect(handlers.onMilestonesChanged).toHaveBeenCalledWith();
    });

    it('invokes the LATEST handlers, never a stale closure', () => {
        const registrar = makeRegistrarDouble();
        const first = makeHandlers();
        const second = makeHandlers();

        const { rerender } = mountHook(registrar.register, first);

        rerender({ registrar: registrar.register, handlers: second });
        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);

        expect(first.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-register when a fresh handlers object arrives every render', () => {
        const registrar = makeRegistrarDouble();

        const { rerender } = mountHook(registrar.register, makeHandlers());

        rerender({ registrar: registrar.register, handlers: makeHandlers() });
        rerender({ registrar: registrar.register, handlers: makeHandlers() });

        expect(registrar.register).toHaveBeenCalledTimes(2);
        expect(registrar.deregistrations.every((deregister) => !deregister.mock.calls.length)).toBe(
            true,
        );
    });
});

/* --------------------------------------------------------------------------
 * Cleanup -- the mandated proof
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- cleanup, the mandated proof', () => {
    it('releases BOTH listeners exactly once on unmount', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(registrar.register, makeHandlers());

        unmount();

        expect(registrar.deregistrations).toHaveLength(2);

        for (const deregister of registrar.deregistrations) {
            expect(deregister).toHaveBeenCalledTimes(1);
        }

        expect(registrar.liveListenerCount(BACKLOG_REALTIME_USERSTORIES_EVENT)).toBe(0);
        expect(registrar.liveListenerCount(BACKLOG_REALTIME_MILESTONES_EVENT)).toBe(0);
    });

    it('invokes NEITHER handler after unmount, even for a delivery already in flight', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        const { unmount } = mountHook(registrar.register, handlers);

        unmount();

        // The listener object still exists -- AngularJS handed it to a broadcast
        // that was already being dispatched when teardown ran. The lifecycle guard
        // is what makes this a no-op.
        registrar.broadcastIncludingReleased(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcastIncludingReleased(BACKLOG_REALTIME_MILESTONES_EVENT);

        expect(handlers.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(handlers.onMilestonesChanged).not.toHaveBeenCalled();
    });

    it('re-registers when the registrar identity changes, releasing the old listeners first', () => {
        const first = makeRegistrarDouble();
        const second = makeRegistrarDouble();
        const handlers = makeHandlers();

        const { rerender } = mountHook(first.register, handlers);

        rerender({ registrar: second.register, handlers });

        expect(first.liveListenerCount(BACKLOG_REALTIME_USERSTORIES_EVENT)).toBe(0);
        expect(first.liveListenerCount(BACKLOG_REALTIME_MILESTONES_EVENT)).toBe(0);
        expect(second.register).toHaveBeenCalledTimes(2);

        second.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('holds one live listener per stream across a remount, and delivers again', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        const firstMount = mountHook(registrar.register, handlers);
        firstMount.unmount();

        const secondMount = mountHook(registrar.register, handlers);

        expect(registrar.liveListenerCount(BACKLOG_REALTIME_USERSTORIES_EVENT)).toBe(1);
        expect(registrar.liveListenerCount(BACKLOG_REALTIME_MILESTONES_EVENT)).toBe(1);

        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT);

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);

        secondMount.unmount();
    });
});
