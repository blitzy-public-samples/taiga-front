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
 *      so only an assertion catches it. AAP 0.6.3 item 8, verbatim: "This is the
 *      single easiest place in the migration to leak, and the leak is silent --
 *      it manifests only as duplicate refreshes after navigating away and back."
 *      That sentence is the reason this file exists, so the group carries a
 *      standing TRIPWIRE -- releases counted against registrations, so the two
 *      numbers can never drift apart unnoticed -- and a literal reproduction of
 *      the symptom it names: mount, leave, come back, and prove the screen
 *      refreshes ONCE rather than twice.
 *   4. THE FROZEN ROUTING KEYS (goal G2), asserted ACROSS THE LANGUAGE SEAM.
 *      The two keys and the one wire option live in the RETAINED controller, so
 *      the only way to hold them frozen from the React side is to read that
 *      CoffeeScript and assert on it -- which this suite does, exactly as the
 *      event-name spec above already does for the two broadcasts. What is frozen
 *      is a pair: the `userstories` and `milestones` resources, never the
 *      project-attributes resource, which belongs to the Kanban screen alone.
 *   5. THE TWO PRESERVED HAZARDS, H1 and H2, held as FACTS about the incumbent
 *      rather than as defects to repair (rule T10). H1: releasing a routing key
 *      leaves its callback in the registry, so a message already in flight can
 *      still reach it -- which is why this hook guards delivery with a lifecycle
 *      flag instead of trusting teardown. H2: that registry holds ONE owner per
 *      routing key for the whole application -- which is why this hook listens to
 *      a re-broadcast instead of subscribing. Both are asserted where they can be
 *      seen, and neither CoffeeScript file is touched.
 *   6. WHAT THE HOOK DOES NOT DO: no service resolved even when one is offered,
 *      no connectivity read, no timer, no reconnect, no request of its own, and
 *      no AngularJS digest driven. Each of those is cheap to add by accident and
 *      silent once added, so each has its own assertion.
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

import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
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
    /** The registrar itself, shaped exactly like `events.onAngularEvent`. */
    readonly register: jest.Mock<() => void, [BacklogRealtimeEventName, BridgeListener]>;

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
    const live = new Map<BacklogRealtimeEventName, BridgeListener[]>();
    const everRegistered = new Map<BacklogRealtimeEventName, BridgeListener[]>();
    const deregistrations: jest.Mock<void, []>[] = [];

    const register = jest.fn<() => void, [BacklogRealtimeEventName, BridgeListener]>(
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

/** `app/` -- three levels up from `app/react/backlog/hooks`. */
const APP_ROOT = join(__dirname, '..', '..', '..');

/**
 * Reads one of the RETAINED CoffeeScript modules under `app/coffee/modules`.
 *
 * ⭐ Reading the other language is deliberate, and it is the only way to hold
 * goal G2 frozen from this side of the seam. The two routing keys, the one wire
 * option and the reload lists they drive all live in the retained
 * `BacklogController`; the React hook sees only the two events that controller
 * re-broadcasts. A spec that asserted solely on the React side would therefore
 * pass unchanged if somebody renamed a routing key, dropped the wire option, or
 * added a third subscription -- each of which is silent at run time, because a
 * listener on a name nobody raises simply never fires.
 *
 * These files are READ, never written: rule T10 keeps the retained controller and
 * the realtime service exactly as the incumbent wrote them, hazards included.
 */
function readCoffeeSource(...segments: readonly string[]): string {
    return readFileSync(join(APP_ROOT, 'coffee', 'modules', ...segments), 'utf8');
}

/**
 * Transport constructs the unit must never contain, ASSEMBLED FROM FRAGMENTS
 * rather than spelled out.
 *
 * The repository scans new React sources for these same constructs, and a spec
 * that wrote one out in order to forbid it would trip that scan on its own text
 * -- a scan cannot tell a prohibition from a use. Joining fragments keeps the
 * assertion exact and keeps this file clean under it.
 *
 * Requirement I7 and rule T5 are what is being protected: every read and write
 * on this screen goes through the existing repository layer, so writes stay
 * dirty-tracked and send only changed fields, and realtime stays multiplexed
 * over the one connection the realtime service already owns.
 */
const FORBIDDEN_TRANSPORT: readonly string[] = [
    ['XML', 'HttpRequest'].join(''),
    ['fetch', '('].join(''),
    ['ax', 'ios'].join(''),
    'WebSocket',
    'EventSource',
    'sendBeacon',
];

/**
 * Scheduling constructs the unit must never contain.
 *
 * The Backlog subscriptions reload IMMEDIATELY -- `app/coffee/modules/backlog/
 * main.coffee:229-242` wraps neither callback in a delay. That is the opposite of
 * the Kanban screen, whose controller debounces both of its callbacks, so a
 * primitive copied across from that sibling would quietly add a delay this screen
 * never had (rule T10). `setInterval` earns its place separately: reconnection
 * restores only the connection-wide subscriptions
 * (`app/coffee/modules/events.coffee:235-250` handles authentication, the
 * heartbeat and the notification streams and re-subscribes NO project-scoped
 * key), and the incumbent's answer to that is a reload guarded by the service's
 * own connectivity flag at `app/coffee/modules/backlog/main.coffee:664` -- which
 * belongs to the drag hook that owns the write it follows, not here. A retry loop
 * grown in this file would be a new feature.
 */
const FORBIDDEN_SCHEDULING: readonly string[] = [
    'setTimeout',
    'setInterval',
    'setImmediate',
    'requestAnimationFrame',
    'queueMicrotask',
    'debounce',
];

type EventsSubscribeSpy = jest.Mock<
    void,
    [scope: null, routingKey: string, callback: (data: unknown) => void, options?: object]
>;

type EventsUnsubscribeSpy = jest.Mock<void, [routingKey: string]>;

/**
 * The realtime service's shape, declared structurally rather than imported.
 *
 * It mirrors the bridge's own service typing, and the `connected` member is an
 * accessor so that READS of it are countable: the incumbent consults that flag at
 * exactly one place in the whole repository
 * (`app/coffee/modules/backlog/main.coffee:664`, after a reorder write), and this
 * hook must not be a second.
 */
interface EventsServiceDouble {
    readonly connected: boolean;

    readonly subscribe: EventsSubscribeSpy;

    readonly unsubscribe: EventsUnsubscribeSpy;
}

interface RealtimeServiceHarness {
    readonly service: EventsServiceDouble;

    connectedReads(): number;
}

function makeRealtimeServiceDouble(): RealtimeServiceHarness {
    let connectedReads = 0;

    const subscribe: EventsSubscribeSpy = jest.fn();
    const unsubscribe: EventsUnsubscribeSpy = jest.fn();

    const service: EventsServiceDouble = {
        subscribe,
        unsubscribe,

        get connected(): boolean {
            connectedReads += 1;

            return true;
        },
    };

    return {
        service,

        connectedReads(): number {
            return connectedReads;
        },
    };
}

interface InjectorProbe {
    readonly injector: AngularInjector;

    requestedServiceNames(): readonly string[];
}

/**
 * An injector that RECORDS what was asked of it before answering.
 *
 * `mockInjector` already throws a descriptive error for a service a spec did not
 * supply (`app/react/bridge/mockInjector.ts:22-40`), which turns an unplanned
 * dependency into a loud failure. The probe adds the other half: it names what was
 * asked for even when the answer succeeded, so "this hook resolves nothing" is an
 * assertion about the whole conversation rather than about the one service the
 * spec happened to supply.
 */
function makeInjectorProbe(events: EventsServiceDouble): InjectorProbe {
    const requested: string[] = [];
    const delegate = mockInjector({ $tgEvents: events });

    return {
        injector: {
            get<T>(name: string): T {
                requested.push(name);

                return delegate.get<T>(name);
            },
        },

        requestedServiceNames(): readonly string[] {
            return requested;
        },
    };
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
 * the AngularJS root scope, or one single further service through the bridge
 * would throw here. The registrar is the hook's entire AngularJS surface, and
 * it arrives as an argument.
 *
 * The complementary case -- mounting INSIDE a provider that does supply a whole
 * realtime service, and proving the hook still never reaches for it -- is the
 * first spec of the closing group, because "no provider" only proves the hook
 * cannot resolve a service, whereas "a provider it declines to use" proves it
 * does not want to.
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

        const controllerSource = readCoffeeSource('backlog', 'main.coffee');

        expect(controllerSource).toContain(
            `$broadcast("${BACKLOG_REALTIME_USERSTORIES_EVENT}", message)`,
        );
        expect(controllerSource).toContain(
            `$broadcast("${BACKLOG_REALTIME_MILESTONES_EVENT}", message)`,
        );
    });
});

/* --------------------------------------------------------------------------
 * The frozen routing keys (goal G2), asserted across the language seam
 * -------------------------------------------------------------------------- */

/**
 * One composed routing key: the two literal segments, the interpolated project
 * id, and the resource name that is captured.
 */
const ROUTING_KEY_PATTERN = /"changes\.project\.#\{[^}]+\}\.([a-z]+)"/g;

/**
 * Every resource the named retained controller composes a routing key for, in
 * source order.
 */
function routingKeyResourcesOf(screen: string): string[] {
    const source = readCoffeeSource(screen, 'main.coffee');
    const resources: string[] = [];

    for (const match of source.matchAll(ROUTING_KEY_PATTERN)) {
        const resource: string | undefined = match[1];

        if (resource !== undefined) {
            resources.push(resource);
        }
    }

    return resources;
}

describe('useBacklogRealtime -- the frozen routing keys', () => {
    it('spells both keys exactly as the incumbent composes them', () => {
        // ⭐ Goal G2 in its most literal form: the two keys are quoted here character
        // for character, including the interpolation of the project id, so a rename on
        // either side of the seam fails this spec instead of failing silently on a
        // stream nobody is listening to. `app/coffee/modules/backlog/main.coffee:230`
        // and `:236`.
        const source = readCoffeeSource('backlog', 'main.coffee');

        expect(source).toContain('routingKey1 = "changes.project.#{@scope.projectId}.userstories"');
        expect(source).toContain('routingKey2 = "changes.project.#{@scope.projectId}.milestones"');

        // And the third key of goal G2's list is absent from THIS controller, because
        // it was never this screen's (see the mirror-image proof below).
        expect(source).not.toContain('changes.project.#{@scope.projectId}.projects');
    });

    it('composes EXACTLY TWO keys, naming the userstories and milestones resources', () => {
        // `app/coffee/modules/backlog/main.coffee:230` and `:236`, in that order.
        // Two, so this screen holds two listeners and not three -- which is what the
        // registration specs above assert from the React side.
        expect(routingKeyResourcesOf('backlog')).toEqual(['userstories', 'milestones']);
    });

    it('never composes the project-attributes key, which belongs to Kanban alone', () => {
        // ⭐⭐ Goal G2 names THREE resources, and that triple is the UNION of the two
        // migrated screens rather than either screen's set. The Kanban controller
        // takes the user-story resource (`app/coffee/modules/kanban/main.coffee:298`)
        // and the project-attributes resource (`:306`) and never the milestone one;
        // the Backlog controller is the mirror image. Opening a project-attributes
        // subscription for this screen would be a subscription the incumbent never
        // opens -- a feature change, and rule T10 forbids one.
        const backlog = routingKeyResourcesOf('backlog');
        const kanban = routingKeyResourcesOf('kanban');

        expect(backlog).not.toContain('projects');
        expect(kanban).toContain('projects');
        expect(kanban).not.toContain('milestones');

        // The mirror image, quoted: the key this screen must never hold is the one the
        // OTHER screen does hold (`app/coffee/modules/kanban/main.coffee:306`).
        expect(readCoffeeSource('kanban', 'main.coffee')).toContain(
            'changes.project.#{@scope.projectId}.projects',
        );
    });

    it('hands the retained controller scope to BOTH subscriptions', () => {
        // That argument is what buys their teardown: the realtime service registers a
        // destroy-time release ONLY when a scope is supplied
        // (`app/coffee/modules/events.coffee:217`), so both subscriptions die with the
        // controller. The React side therefore owns two listeners and no subscription,
        // and the release of those two listeners is what the cleanup group proves.
        //
        // The contrast is the point. A React-owned key gets NO scope -- the sanctioned
        // primitive passes none (`app/react/bridge/useRealtime.ts:50`) because a live
        // scope has no business crossing the seam -- so it forfeits that automatic
        // release and has to unsubscribe itself. That is the exact mechanism AAP 0.6.3
        // item 8 warns about, and it is why the cleanup group counts releases rather
        // than trusting them.
        const source = readCoffeeSource('backlog', 'main.coffee');
        const scopedSubscriptions = source.match(/@events\.subscribe @scope,/g) ?? [];

        expect(scopedSubscriptions).toHaveLength(2);
    });

    it('attaches the self-notification wire option to the milestones subscription ONLY', () => {
        // `app/coffee/modules/backlog/main.coffee:242` attaches it to the SECOND
        // subscription and nothing else, and the first passes no options object at
        // all -- so the first subscription's wire message carries no options member,
        // which the realtime service adds only when one is supplied
        // (`app/coffee/modules/events.coffee:211-212`). Both halves of that are
        // asserted: exactly one occurrence, positioned after the milestones key.
        const source = readCoffeeSource('backlog', 'main.coffee');
        const option = 'selfNotification';

        expect(source.split(option)).toHaveLength(2);

        const userstoriesKeyAt = source.indexOf('.userstories"');
        const milestonesKeyAt = source.indexOf('.milestones"');
        const optionAt = source.indexOf(option);

        expect(userstoriesKeyAt).toBeGreaterThan(-1);
        expect(milestonesKeyAt).toBeGreaterThan(userstoriesKeyAt);
        expect(optionAt).toBeGreaterThan(milestonesKeyAt);
    });

    it('drives two reloads from a userstories message and three, in order, from a milestones one', () => {
        // The counts and the ORDER are the caller's obligation, not this hook's: the
        // hook hands each message to one handler and the container performs the
        // reloads. Pinning them here is what makes those two handlers auditable
        // against `app/coffee/modules/backlog/main.coffee:232-233` (two reloads) and
        // `:238-240` (three, in this order).
        const source = readCoffeeSource('backlog', 'main.coffee');

        const userstoriesBlock = source.slice(
            source.indexOf('.userstories"'),
            source.indexOf('.milestones"'),
        );

        expect(userstoriesBlock.indexOf('loadAllPaginatedUserstories()')).toBeGreaterThan(-1);
        expect(userstoriesBlock.indexOf('loadAllPaginatedUserstories()')).toBeLessThan(
            userstoriesBlock.indexOf('loadSprints()'),
        );

        const milestonesBlock = source.slice(
            source.indexOf('.milestones"'),
            source.indexOf('selfNotification'),
        );

        const openSprintsAt = milestonesBlock.indexOf('loadSprints()');
        const closedSprintsAt = milestonesBlock.indexOf('loadClosedSprints()');
        const statsAt = milestonesBlock.indexOf('loadProjectStats()');

        expect(milestonesBlock).not.toContain('loadAllPaginatedUserstories()');
        expect(openSprintsAt).toBeGreaterThan(-1);
        expect(closedSprintsAt).toBeGreaterThan(openSprintsAt);
        expect(statsAt).toBeGreaterThan(closedSprintsAt);
    });

    it('releases a routing key with the key alone, never with the wire options', () => {
        // `app/coffee/modules/events.coffee:219` takes ONE formal parameter -- the
        // routing key -- so the options object accepted at subscription time is never
        // forwarded at release time. The React-side counterpart of this arity is the
        // zero-argument deregistration function asserted in the cleanup group.
        const events = readCoffeeSource('events.coffee');

        expect(events).toContain('unsubscribe: (routingKey) ->');
        expect(events).not.toContain('unsubscribe: (routingKey, options');
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

    it('tolerates EVERY payload shape, including no payload at all', () => {
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);

        // The wire shape is not this screen's business and never was. The realtime
        // service hands its callback the message body
        // (`app/coffee/modules/events.coffee:186` and `:190`), the retained
        // controller re-broadcasts that body untouched, and the incumbent reload path
        // inspects none of it. A hook that read into the payload would work against
        // today's messages and break on the first field that moved, so the contract
        // asserted here is that it reads nothing: three shapes, no failure, one
        // delivery each.
        expect(() => {
            registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, undefined);
            registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, {});
            registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, { data: {} });
            registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, {
                data: { matches: 'milestones' },
            });
        }).not.toThrow();

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(3);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
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

    it('balances EVERY registration with exactly one release -- the leak tripwire', () => {
        // ⭐⭐ THE TRIPWIRE, and the reason this file exists. AAP 0.6.3 item 8,
        // verbatim: "This is the single easiest place in the migration to leak, and
        // the leak is silent -- it manifests only as duplicate refreshes after
        // navigating away and back."
        //
        // Counting releases against registrations is what makes the two numbers unable
        // to drift apart unnoticed. The per-listener assertions above check the
        // registrations this hook makes TODAY; this one holds for a registration a
        // later edit adds, because a third registration with no matching release fails
        // it without anybody having to remember to extend the spec.
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(registrar.register, makeHandlers());

        expect(registrar.register).toHaveBeenCalledTimes(2);

        unmount();

        const releases = registrar.deregistrations.reduce(
            (total: number, deregister: jest.Mock<void, []>): number =>
                total + deregister.mock.calls.length,
            0,
        );

        expect(releases).toBe(registrar.register.mock.calls.length);
    });

    it('keeps the tripwire balanced across a re-registration and a final unmount', () => {
        // The same equality after the registrar identity changes once: the first pair
        // is released when the effect re-runs, the second pair when the screen goes
        // away, so four registrations answer to four releases. An effect that
        // re-registered without releasing would leave the two counts apart, which is
        // exactly the shape of the silent leak.
        const first = makeRegistrarDouble();
        const second = makeRegistrarDouble();
        const handlers = makeHandlers();

        const { rerender, unmount } = mountHook(first.register, handlers);

        rerender({ registrar: second.register, handlers });
        unmount();

        const registrations =
            first.register.mock.calls.length + second.register.mock.calls.length;
        const releases = [...first.deregistrations, ...second.deregistrations].reduce(
            (total: number, deregister: jest.Mock<void, []>): number =>
                total + deregister.mock.calls.length,
            0,
        );

        expect(registrations).toBe(4);
        expect(releases).toBe(registrations);
    });

    it('releases with NO argument, because a deregistration function takes none', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(registrar.register, makeHandlers());

        unmount();

        for (const deregister of registrar.deregistrations) {
            expect(deregister.mock.calls[0]).toHaveLength(0);
        }

        // ⭐ That zero-argument shape is not this double's invention. The bridge helper
        // at `app/coffee/modules/backlog/react-bridge.coffee:156-162` registers the
        // listener on the controller's scope and returns AngularJS's OWN deregistration
        // function unchanged, and AngularJS gives that function no parameters. It is
        // easily confused with the routing-key release it sits next to,
        // `app/coffee/modules/events.coffee:219`, which takes exactly one argument --
        // the key -- and never the wire options; forwarding anything to either one
        // would be wrong in a different way, so both arities are pinned.
        const bridge = readCoffeeSource('backlog', 'react-bridge.coffee');
        const helperAt = bridge.indexOf('registerAngularEvent = (');

        expect(helperAt).toBeGreaterThan(-1);

        // The helper is seven lines long, so eight is its body plus its terminator.
        const helper = bridge.slice(helperAt).split('\n').slice(0, 8).join('\n');

        expect(helper).toContain('deregister = $scope.$on');
        expect(helper).toContain('return deregister');
    });

    it('refreshes ONCE, not twice, after navigating away and back', () => {
        // ⭐ The symptom AAP 0.6.3 item 8 names, reproduced literally. Distinct handler
        // objects per visit are what make a duplicate visible: a leak shows up as the
        // handlers of the visit the user LEFT firing alongside the ones they came back
        // to, so every message reloads the screen twice.
        const registrar = makeRegistrarDouble();
        const beforeLeaving = makeHandlers();
        const afterReturning = makeHandlers();

        const firstVisit = mountHook(registrar.register, beforeLeaving);

        firstVisit.unmount();

        const secondVisit = mountHook(registrar.register, afterReturning);

        // Hazard H1, reproduced on purpose rather than repaired. Releasing a routing
        // key at `app/coffee/modules/events.coffee:219` sends the wire command but
        // leaves the callback in the registry it was stored in at `:214`, so
        // `processMessage` (`:177`-`:190`) can still reach a consumer that has gone.
        // Driving EVERY listener the registrar ever handed out -- released ones
        // included -- is what that looks like from the React side. The hook's lifecycle
        // flag is the mitigation, and the CoffeeScript stays untouched (rule T10).
        registrar.broadcastIncludingReleased(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcastIncludingReleased(BACKLOG_REALTIME_MILESTONES_EVENT);

        expect(beforeLeaving.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(beforeLeaving.onMilestonesChanged).not.toHaveBeenCalled();
        expect(afterReturning.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(afterReturning.onMilestonesChanged).toHaveBeenCalledTimes(1);

        secondVisit.unmount();
    });

    it('is safe to unmount twice, and releases nothing a second time', () => {
        // A screen can be torn down by more than one route, and a release that ran
        // twice would be as wrong as one that never ran: the routing-key release is
        // idempotent, but a listener release that fired twice would mean the effect
        // had registered twice.
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(registrar.register, makeHandlers());

        unmount();

        expect(() => {
            unmount();
        }).not.toThrow();

        for (const deregister of registrar.deregistrations) {
            expect(deregister).toHaveBeenCalledTimes(1);
        }
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

/* --------------------------------------------------------------------------
 * The shape of the contract
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- the shape of the contract', () => {
    it('returns undefined -- it hands the caller nothing back', () => {
        // No release function, no connection state, no event names: the caller keeps
        // the registrar it already owns and the handlers it already wrote, and the
        // hook's entire output is the effect it runs. A return value would be a second
        // way to release the listeners, and two ways to release the same thing is how
        // one of them ends up unused and the other ends up called twice.
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        const { result } = renderHook(() => useBacklogRealtime(registrar.register, handlers));

        expect(result.current).toBeUndefined();
    });

    it('takes exactly two parameters, the registrar and the handlers', () => {
        // Both are required, and neither is optional -- a third parameter, or a
        // defaulted one, would mean a caller could mount this hook without a way to
        // reach AngularJS or without somewhere to deliver, and it would fail silently
        // rather than at the call site.
        expect(useBacklogRealtime).toHaveLength(2);
    });

    it('registers on the FIRST mount, with no identifier to wait for', () => {
        // Contrast the sanctioned primitive at `app/react/bridge/useRealtime.ts:36-38`,
        // whose effect returns early while its routing key is still absent: a key
        // interpolates a project id that arrives asynchronously, so that primitive has
        // to tolerate a key that is not ready yet. This hook composes no key -- its two
        // event names are module constants -- so there is nothing to wait for and no
        // deferred-registration path to exercise. Both listeners are therefore live
        // from the first commit, before a message can arrive.
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        expect(registrar.register).toHaveBeenCalledTimes(2);
        expect(registrar.liveListenerCount(BACKLOG_REALTIME_USERSTORIES_EVENT)).toBe(1);
        expect(registrar.liveListenerCount(BACKLOG_REALTIME_MILESTONES_EVENT)).toBe(1);
    });

    it('passes a FUNCTION as the listener for each event name', () => {
        // The registrar is handed to AngularJS's scope registration, which accepts
        // whatever it is given: an object or a string registers quite happily and then
        // fails when the event arrives, long after the mistake was made.
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        for (const call of registrar.register.mock.calls) {
            expect(call).toHaveLength(2);
            expect(typeof call[1]).toBe('function');
        }
    });
});

/* --------------------------------------------------------------------------
 * One owner per routing key (hazard H2), preserved
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- one owner per routing key, preserved', () => {
    it('registers each event name exactly once per instance', () => {
        const registrar = makeRegistrarDouble();

        mountHook(registrar.register, makeHandlers());

        const names = registrar.registeredNames();

        expect(
            names.filter((name) => name === BACKLOG_REALTIME_USERSTORIES_EVENT),
        ).toHaveLength(1);
        expect(names.filter((name) => name === BACKLOG_REALTIME_MILESTONES_EVENT)).toHaveLength(
            1,
        );
    });

    it('lets two instances share one registrar, because a scope keeps a LIST per name', () => {
        // ⭐ The property that makes listening safe where subscribing is not, asserted
        // rather than assumed. A scope holds an array of listeners per event name, so a
        // second registration cannot displace the first and releasing one cannot
        // silence the other.
        const registrar = makeRegistrarDouble();
        const first = makeHandlers();
        const second = makeHandlers();

        const firstInstance = mountHook(registrar.register, first);
        const secondInstance = mountHook(registrar.register, second);

        expect(registrar.register).toHaveBeenCalledTimes(4);
        expect(registrar.liveListenerCount(BACKLOG_REALTIME_USERSTORIES_EVENT)).toBe(2);

        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);

        expect(first.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);

        firstInstance.unmount();
        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);

        expect(first.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(2);

        secondInstance.unmount();
    });

    it('leaves the single-owner routing-key registry exactly as the incumbent wrote it', () => {
        // ⭐⭐ Hazards H2 and H1 asserted as FACTS, not repaired (rule T10).
        //
        // H2: `app/coffee/modules/events.coffee:214` stores a subscription under the
        // routing key ALONE, for the whole application. A second subscription to the
        // same key replaces the first silently, and the Kanban controller subscribes
        // the same user-story key this screen does -- the two only coexist because they
        // live on different routes and never mount together. That is precisely why this
        // hook listens to a re-broadcast instead of subscribing, and why a "small
        // improvement" that opened its own subscription would take the retained
        // controller's callback with it.
        //
        // H1: releasing at `:219` sends the wire command and leaves the registry entry
        // in place -- there is no removal anywhere in the file -- so a message already
        // being dispatched can still reach a released callback. The React-side
        // mitigation is the lifecycle flag proven in the cleanup group.
        //
        // Both assertions read the retained service; neither edits it.
        const events = readCoffeeSource('events.coffee');

        expect(events).toContain('@.subscriptions[routingKey] = subscription');
        expect(events).not.toContain('delete @.subscriptions');
    });

    it('composes no routing key of its own, in its EXECUTABLE source', () => {
        // The corollary of H2, held at the source level so it covers every path rather
        // than only the ones these specs drive. Comments are stripped first: the unit's
        // prose legitimately explains the subscription it does not open.
        const executable = readExecutableSource();

        expect(executable).not.toContain('changes.project');
        expect(executable).not.toContain('routingKey');
    });
});

/* --------------------------------------------------------------------------
 * What it declines to do
 * -------------------------------------------------------------------------- */

describe('useBacklogRealtime -- what it declines to do', () => {
    it('resolves NOTHING from the injector, even with a whole realtime service on offer', () => {
        // ⭐ The complement of the ownership invariant at the top of this file. Mounting
        // with no provider proves the hook CANNOT resolve a service; mounting inside a
        // provider that supplies the realtime service in full, and watching it decline,
        // proves it does not want to.
        //
        // Only that one service is supplied, so one further name would raise
        // `mockInjector`'s descriptive failure (`app/react/bridge/mockInjector.ts:22-40`)
        // instead of quietly returning undefined; the probe records the name as well, so
        // a resolution that succeeded would still be reported here.
        //
        // The connectivity read is counted for the same reason. The incumbent consults
        // that flag at exactly one place in the repository --
        // `app/coffee/modules/backlog/main.coffee:664`, reloading the sprints after a
        // reorder when realtime is down -- and it belongs to the hook that owns that
        // write, not to this one.
        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();
        const realtime = makeRealtimeServiceDouble();
        const probe = makeInjectorProbe(realtime.service);

        const { unmount } = renderHook(
            () => {
                useBacklogRealtime(registrar.register, handlers);
            },
            { wrapper: withMockInjector(probe.injector) },
        );

        registrar.broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT);
        registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT);
        unmount();

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);

        expect(probe.requestedServiceNames()).toEqual([]);
        expect(realtime.service.subscribe).not.toHaveBeenCalled();
        expect(realtime.service.unsubscribe).not.toHaveBeenCalled();
        expect(realtime.connectedReads()).toBe(0);
    });

    it('schedules nothing: no delay, no interval, no retry loop', () => {
        // Source-level, because a scheduled call is only observable on the path that
        // schedules it. The behavioural half follows: delivery has already happened by
        // the time the broadcast returns, so nothing is waiting on a clock.
        const executable = readExecutableSource();

        for (const construct of FORBIDDEN_SCHEDULING) {
            expect(executable).not.toContain(construct);
        }

        const registrar = makeRegistrarDouble();
        const handlers = makeHandlers();

        mountHook(registrar.register, handlers);
        registrar.broadcast(BACKLOG_REALTIME_MILESTONES_EVENT);

        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
    });

    it('opens no transport of its own', () => {
        // Requirement I7 and rule T5: the existing repository layer keeps writes
        // dirty-tracked and sending only changed fields, and the realtime service already
        // multiplexes one connection. A second transport opened here would bypass both,
        // and would do it invisibly -- the screen would still work, and every write would
        // start carrying whole objects.
        const executable = readExecutableSource();

        for (const construct of FORBIDDEN_TRANSPORT) {
            expect(executable).not.toContain(construct);
        }
    });
});

