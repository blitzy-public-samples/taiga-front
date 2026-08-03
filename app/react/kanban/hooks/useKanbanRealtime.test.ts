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
 * for that module. AAP 0.5.1 and 0.6.2 both place specs beside the unit under
 * test as `app/react/**` files, and `jest.config.js` collects coverage from every
 * source in that tree, so this file is what keeps the hook honest rather than
 * merely typed.
 *
 * WHAT IS BEING PROVEN, and why every one of these needs proving rather than
 * reviewing -- each is invisible at run time when it is wrong:
 *
 *   1. THE OWNERSHIP INVARIANT (hazard H2). `app/coffee/modules/events.coffee`
 *      L214 stores ONE subscription per routing key for the whole application
 *      (`@.subscriptions[routingKey] = subscription`), and `unsubscribe`
 *      (`:219-230`) sends a wire command carrying only that key. The RETAINED
 *      `KanbanController` owns both of this screen's keys
 *      (`app/coffee/modules/kanban/main.coffee:294-320`), so a React subscription
 *      would OVERWRITE its callback -- the board would silently stop refreshing --
 *      and either side's teardown would silence both. This hook must therefore
 *      SUBSCRIBE TO NOTHING and resolve no service at all. Asserted twice over:
 *      once by mounting with no bridge provider above it, which a hook resolving
 *      `$tgEvents` could not survive, and once by mounting inside a REAL
 *      `AngularBridgeProvider` whose `$tgEvents` double records every call, then
 *      proving both `subscribe` and `unsubscribe` stayed at zero. The second
 *      assertion is shown to be non-vacuous by a probe hook that resolves the
 *      same service through the same wrapper and gets the double back.
 *   2. THE FROZEN STREAM SET (goal G2, rule T10). TWO listeners and not three, on
 *      the two event names the controller re-publishes on, each with exactly two
 *      arguments -- an event name and one function. Kanban's realtime surface is
 *      `{userstories, projects}`; `milestones` and the `{selfNotification: true}`
 *      option belong to the BACKLOG screen's `milestones` subscription and must
 *      never appear here.
 *   3. ONE SHARED, ONCE-DRAWN WAIT. `randomTimeout = taiga.randomInt(700, 1000)`
 *      is drawn ONCE at `main.coffee:295` and used by BOTH debounced callbacks, so
 *      the two streams share a wait without sharing a timer, and re-rendering must
 *      not re-roll it. `randomInt` (`app/coffee/utils.coffee:253-255`) is
 *      inclusive at both ends, so both endpoints are pinned by mocking
 *      `Math.random` rather than by hoping.
 *   4. THE TRAILING DEBOUNCE. `debounceLeading` (`app/coffee/utils.coffee:121`) is
 *      a misnomer: it is lodash `{leading: false, trailing: true}`, the exact
 *      opposite of its leading-edge sibling at `:117`. Reading the NAME instead of
 *      the BODY inverts the behaviour, so the leading edge firing nothing, the
 *      reset-on-every-message, the single trailing invocation and the
 *      last-message-wins rule are each asserted separately.
 *   5. THE `matches` NARROWING, AFTER THE DEBOUNCE. The incumbent's test sits
 *      INSIDE the debounced function (`main.coffee:308-312`), so it runs against
 *      the LAST message of a burst only -- a matching message followed within the
 *      wait by a non-matching one refreshes nothing today, and must refresh
 *      nothing here. Malformed remote input must be ignored rather than thrown on.
 *   6. THE LIGHTBOX COALESCING BOUNDARY. Only the project stream is deferred
 *      (`main.coffee:313-314`); many deferred messages coalesce into ONE refresh
 *      released on the true -> false EDGE (`:253-257`); closing with nothing
 *      pending is a no-op; and the release uses the LATEST callback the caller
 *      supplied, without re-registering anything.
 *   7. CLEANUP AND THE SILENT LEAK (hazard H1, AAP 0.6.3 item 8). On the AngularJS
 *      side teardown is automatic only when a scope is supplied --
 *      `scope.$on("$destroy", …) if scope` at `events.coffee:217` -- and React has
 *      no scope, which is precisely why it listens instead of subscribing. Both
 *      listeners must be released with zero arguments, both debounce timers
 *      cancelled, any deferred rebuild dropped, and nothing delivered afterwards,
 *      including a delivery already in flight when teardown ran. A leak here
 *      throws nothing and logs nothing: it shows up only as the board doing its
 *      realtime work twice, then three times, as a user walks between Kanban and
 *      Backlog.
 *   8. THE SOURCE-LEVEL PROHIBITIONS. No transport, no digest driver, no
 *      AngularJS import, no `any`, no suppression comment -- and, positively, the
 *      hazards above documented AT the seam so the next reader inherits the
 *      reasoning instead of rediscovering it.
 *
 * HOW THE SEAM IS DOUBLED. `makeRegistrarDouble` reproduces `$scope.$on`
 * faithfully, including the two properties that matter here:
 *
 *   - MANY LISTENERS PER EVENT NAME. A scope keeps an ARRAY per name, so
 *     registering a second listener cannot displace the first -- the exact
 *     opposite of the routing-key registry, and the whole reason listening is safe
 *     where subscribing is not. That asymmetry is why no defensive global registry
 *     is added on the React side and none is tested for: a registry would be
 *     module-level mutable state that still could not see the AngularJS owner
 *     sharing the same map, so it would give false assurance while making the
 *     module stateful.
 *   - A DEREGISTRATION FUNCTION PER REGISTRATION, removing only its own listener.
 *     The double also RETAINS the listener reference after deregistration, so a
 *     spec can drive the delivery that was already in flight when teardown ran
 *     (hazard H1), which is otherwise unreachable.
 *
 * A shared journal records every registration and deregistration in order across
 * doubles, which is what makes "the old listeners were released BEFORE the new
 * ones were registered" an assertion rather than an assumption.
 *
 * Fake timers are used throughout, because every assertion about the debounce is
 * an assertion about time. `jest.config.js` sets `clearMocks` and `restoreMocks`,
 * so no spec here resets or restores a mock by hand.
 *
 * This suite is browserless (requirement HR-5): jsdom only, no browser binary, no
 * socket, no network, no build output, and nothing here imports the end-to-end
 * layer.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, renderHook } from '@testing-library/react';
import type { RenderHookResult } from '@testing-library/react';

import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import { useAngularService } from '../../bridge/useAngularService';
import type { AngularServices } from '../../bridge/useAngularService';
import {
    KANBAN_PROJECT_REFRESH_MATCHES,
    KANBAN_REALTIME_MAX_DELAY_MS,
    KANBAN_REALTIME_MIN_DELAY_MS,
    KANBAN_REALTIME_PROJECT_EVENT,
    KANBAN_REALTIME_USERSTORIES_EVENT,
    useKanbanRealtime,
} from './useKanbanRealtime';
import type {
    KanbanProjectRefreshHandler,
    KanbanRealtimeEventDeregistrar,
    KanbanRealtimeEventName,
    KanbanRealtimeEventRegistrar,
    KanbanUserStoriesMessageHandler,
    UseKanbanRealtimeOptions,
} from './useKanbanRealtime';

/* --------------------------------------------------------------------------
 * Layout-observer stubs
 *
 * jsdom implements neither observer, so anything that touched one would throw
 * `ReferenceError` rather than fail an assertion. Both are installed as precise
 * STRUCTURAL classes -- `implements IntersectionObserver` / `implements
 * ResizeObserver`, no escape-hatch type anywhere -- and removed again in
 * teardown, so this spec leaves no global residue for the next file in the run.
 *
 * They also carry an assertion of their own. This hook is TIME-driven, not
 * LAYOUT-driven: virtualisation lives in `app/react/shared/useInViewport.ts` and
 * nothing about a realtime message depends on geometry. Recording every
 * construction lets the hygiene suite prove the count stayed at zero, which is
 * how a future edit that reached for the viewport from inside a debounce would
 * be caught here rather than in a browser.
 * -------------------------------------------------------------------------- */

class StubIntersectionObserver implements IntersectionObserver {
    static instances: StubIntersectionObserver[] = [];

    readonly root: Element | Document | null;

    readonly rootMargin: string;

    readonly thresholds: readonly number[];

    readonly observed: Element[] = [];

    constructor(_callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
        this.root = init?.root ?? null;
        this.rootMargin = init?.rootMargin ?? '';

        const threshold = init?.threshold ?? 0;

        this.thresholds = Array.isArray(threshold) ? threshold : [threshold];

        StubIntersectionObserver.instances.push(this);
    }

    observe(target: Element): void {
        if (!this.observed.includes(target)) {
            this.observed.push(target);
        }
    }

    unobserve(target: Element): void {
        const at = this.observed.indexOf(target);

        if (at !== -1) {
            this.observed.splice(at, 1);
        }
    }

    disconnect(): void {
        this.observed.length = 0;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

class StubResizeObserver implements ResizeObserver {
    static instances: StubResizeObserver[] = [];

    readonly observed: Element[] = [];

    constructor(_callback: ResizeObserverCallback) {
        StubResizeObserver.instances.push(this);
    }

    observe(target: Element): void {
        if (!this.observed.includes(target)) {
            this.observed.push(target);
        }
    }

    unobserve(target: Element): void {
        const at = this.observed.indexOf(target);

        if (at !== -1) {
            this.observed.splice(at, 1);
        }
    }

    disconnect(): void {
        this.observed.length = 0;
    }
}

/**
 * Captured before anything is installed, so teardown can put back exactly what
 * was there -- and delete the property outright when, as in jsdom, there was
 * nothing there to begin with.
 */
const nativeIntersectionObserver: typeof IntersectionObserver | undefined =
    globalThis.IntersectionObserver;

const nativeResizeObserver: typeof ResizeObserver | undefined = globalThis.ResizeObserver;

function installObserverStubs(): void {
    StubIntersectionObserver.instances = [];
    StubResizeObserver.instances = [];

    globalThis.IntersectionObserver = StubIntersectionObserver;
    globalThis.ResizeObserver = StubResizeObserver;
}

function restoreObservers(): void {
    if (nativeIntersectionObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    } else {
        globalThis.IntersectionObserver = nativeIntersectionObserver;
    }

    if (nativeResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } else {
        globalThis.ResizeObserver = nativeResizeObserver;
    }
}

/* --------------------------------------------------------------------------
 * The AngularJS-event seam, doubled
 * -------------------------------------------------------------------------- */

/**
 * The listener shape THE BRIDGE invokes: the payload, and nothing before it.
 *
 * ⭐ NOT `$scope.$on`'s own `(event, payload)` shape, deliberately. The bridge
 * does not hand a React handler to `$scope.$on`; it wraps it, DROPS AngularJS's
 * event object -- which carries `targetScope`/`currentScope` and would put a live
 * `$scope` on the React side of the seam -- and forwards only the payload
 * (`registerAngularEvent` in `app/coffee/modules/kanban/react-bridge.coffee`). A
 * double that invoked `(event, payload)` would be testing a producer that does not
 * exist, and would pass while the real hook read `undefined` on every message. The
 * cross-language spec at `app/react/bridge/reactBridgeContract.test.ts` pins this
 * shape against the real compiled bridge rather than against a double.
 */
type BridgeListener = (payload: unknown) => void;

/** One `register` or `deregister` event, in the order it happened. */
type JournalEntry = string;

interface RegistrarDouble {
    /** Distinguishes this double's entries in a shared journal. */
    readonly label: string;

    /** The ordered log this double appends to -- shared when one is passed in. */
    readonly journal: JournalEntry[];

    /** The registrar itself, shaped exactly like the bridge's `onAngularEvent`. */
    readonly register: jest.Mock<
        KanbanRealtimeEventDeregistrar,
        [KanbanRealtimeEventName, BridgeListener]
    >;

    /** Every event name the hook registered for, in registration order. */
    registeredNames(): KanbanRealtimeEventName[];

    /** Listeners still registered for one event name. */
    liveListenerCount(eventName: KanbanRealtimeEventName): number;

    /** Every deregistration function handed out, in registration order. */
    readonly deregistrations: jest.Mock<void, []>[];

    /** Broadcasts to the listeners that are still registered for a name. */
    broadcast(eventName: KanbanRealtimeEventName, payload?: unknown): void;

    /**
     * Invokes EVERY listener ever registered for a name, including ones already
     * deregistered -- the in-flight delivery of hazard H1, which a faithful
     * `$scope.$on` double could not otherwise reach because deregistration really
     * does remove the listener from the array.
     */
    broadcastIncludingReleased(eventName: KanbanRealtimeEventName, payload?: unknown): void;
}

function makeRegistrarDouble(label = 'primary', journal: JournalEntry[] = []): RegistrarDouble {
    // An array per name, like a real scope: registering never displaces.
    const live = new Map<KanbanRealtimeEventName, BridgeListener[]>();
    const everRegistered = new Map<KanbanRealtimeEventName, BridgeListener[]>();
    const deregistrations: jest.Mock<void, []>[] = [];

    const register = jest.fn<
        KanbanRealtimeEventDeregistrar,
        [KanbanRealtimeEventName, BridgeListener]
    >((eventName, listener) => {
        journal.push(`${label}/register/${eventName}`);

        const liveForName = live.get(eventName) ?? [];
        liveForName.push(listener);
        live.set(eventName, liveForName);

        const everForName = everRegistered.get(eventName) ?? [];
        everForName.push(listener);
        everRegistered.set(eventName, everForName);

        const deregister = jest.fn<void, []>(() => {
            journal.push(`${label}/deregister/${eventName}`);

            const current = live.get(eventName) ?? [];

            live.set(
                eventName,
                current.filter((candidate) => candidate !== listener),
            );
        });

        deregistrations.push(deregister);

        return deregister;
    });

    function invoke(listeners: BridgeListener[], payload: unknown): void {
        for (const listener of listeners) {
            listener(payload);
        }
    }

    return {
        label,
        journal,
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

/* --------------------------------------------------------------------------
 * The realtime service, doubled -- as the thing that must stay UNTOUCHED
 *
 * `$tgEvents` is mocked here not because the hook uses it but because it must
 * not: the double is the tripwire for hazard H2. Both spies are typed from the
 * real service contract with `Parameters<…>`, so the signature cannot drift out
 * from under this spec, and no local restatement of the AngularJS types is
 * needed.
 * -------------------------------------------------------------------------- */

type TaigaEventsService = AngularServices['$tgEvents'];

type SubscribeSpy = jest.Mock<void, Parameters<TaigaEventsService['subscribe']>>;

type UnsubscribeSpy = jest.Mock<void, Parameters<TaigaEventsService['unsubscribe']>>;

interface EventsDouble {
    /** Exactly what the injector hands back for `$tgEvents`. */
    readonly service: TaigaEventsService;

    readonly subscribe: SubscribeSpy;

    readonly unsubscribe: UnsubscribeSpy;
}

function _mockTgEvents(): EventsDouble {
    const subscribe: SubscribeSpy = jest.fn();
    const unsubscribe: UnsubscribeSpy = jest.fn();

    return {
        service: { connected: true, subscribe, unsubscribe },
        subscribe,
        unsubscribe,
    };
}

interface Mocks {
    readonly events: EventsDouble;

    readonly injector: AngularInjector;
}

function _mocks(): Mocks {
    const events = _mockTgEvents();

    // A PARTIAL map on purpose: `mockInjector` throws a diagnostic for any service
    // the unit asks for and the spec did not supply, so listing only `$tgEvents`
    // makes "this hook resolves nothing else either" a failure rather than a
    // silently-satisfied lookup.
    return { events, injector: mockInjector({ $tgEvents: events.service }) };
}

let mocks: Mocks;

/* --------------------------------------------------------------------------
 * Mounting
 * -------------------------------------------------------------------------- */

type UserStoriesSpy = jest.Mock<
    ReturnType<KanbanUserStoriesMessageHandler>,
    Parameters<KanbanUserStoriesMessageHandler>
>;

type ProjectRefreshSpy = jest.Mock<
    ReturnType<KanbanProjectRefreshHandler>,
    Parameters<KanbanProjectRefreshHandler>
>;

interface HookProps {
    readonly registrar: KanbanRealtimeEventRegistrar;

    readonly isLightboxOpen: boolean;

    readonly onUserStoriesChanged: UserStoriesSpy;

    readonly onProjectAttributesChanged: ProjectRefreshSpy;
}

type MountedHook = RenderHookResult<void, HookProps>;

/**
 * Both spies are typed FROM the hook's own exported handler types, so a change to
 * either public signature breaks this spec at compile time rather than letting it
 * go on asserting against a shape the hook no longer offers.
 */
function userStoriesSpy(): UserStoriesSpy {
    return jest.fn<
        ReturnType<KanbanUserStoriesMessageHandler>,
        Parameters<KanbanUserStoriesMessageHandler>
    >();
}

function projectRefreshSpy(): ProjectRefreshSpy {
    return jest.fn<
        ReturnType<KanbanProjectRefreshHandler>,
        Parameters<KanbanProjectRefreshHandler>
    >();
}

function makeProps(registrar: KanbanRealtimeEventRegistrar, isLightboxOpen = false): HookProps {
    return {
        registrar,
        isLightboxOpen,
        onUserStoriesChanged: userStoriesSpy(),
        onProjectAttributesChanged: projectRefreshSpy(),
    };
}

/**
 * The options object the hook actually receives, assembled in one place so every
 * mount goes through the same declared `UseKanbanRealtimeOptions` shape.
 */
function toOptions(current: HookProps): UseKanbanRealtimeOptions {
    return {
        registerAngularEvent: current.registrar,
        isLightboxOpen: current.isLightboxOpen,
        onUserStoriesChanged: current.onUserStoriesChanged,
        onProjectAttributesChanged: current.onProjectAttributesChanged,
    };
}

/**
 * Mounts the hook with NO bridge provider above it -- an assertion in itself,
 * because `AngularBridgeContext` defaults to `null` and every service accessor
 * throws on a null injector. A hook that resolved anything at all could not
 * survive this mount.
 */
function mountHook(props: HookProps): MountedHook {
    return renderHook(
        (current: HookProps) => {
            useKanbanRealtime(toOptions(current));
        },
        { initialProps: props },
    );
}

/**
 * Mounts the hook inside a REAL `AngularBridgeProvider` carrying a recording
 * `$tgEvents`. `withMockInjector` builds that wrapper with `createElement` rather
 * than JSX, which is what lets this spec stay a `.test.ts` file.
 *
 * This is the positive form of the ownership invariant: the service is right
 * there, reachable, and still never called.
 */
function mountHookWithBridge(props: HookProps): MountedHook {
    return renderHook(
        (current: HookProps) => {
            useKanbanRealtime(toOptions(current));
        },
        { initialProps: props, wrapper: withMockInjector(mocks.injector) },
    );
}

/* --------------------------------------------------------------------------
 * Time
 * -------------------------------------------------------------------------- */

/** Advances past the longest wait the hook can have drawn. */
function runOutTheWait(): void {
    act(() => {
        jest.advanceTimersByTime(KANBAN_REALTIME_MAX_DELAY_MS + 1);
    });
}

function advanceBy(milliseconds: number): void {
    act(() => {
        jest.advanceTimersByTime(milliseconds);
    });
}

/**
 * Pins the drawn wait to an exact number of milliseconds.
 *
 * `randomInt(start, end)` is `start + Math.floor(Math.random() * (end - start +
 * 1))` (`app/coffee/utils.coffee:253-255`), so every integer delay owns a bucket of
 * width `1 / (interval + 1)` in the unit interval. The fraction returned here aims
 * at the MIDDLE of the requested bucket rather than its lower edge, which keeps the
 * result exact under binary floating point -- a lower-edge fraction can multiply
 * back to a hair under its own integer and floor to the delay below. Asking for the
 * maximum still needs a fraction strictly under 1, which is exactly what a real
 * `Math.random()` can return and `1` never can, so the pinned values remain values
 * the incumbent could itself have drawn.
 */
function pinDrawnDelay(delayMs: number): jest.SpyInstance<number, []> {
    const interval = KANBAN_REALTIME_MAX_DELAY_MS - KANBAN_REALTIME_MIN_DELAY_MS;
    const fraction = (delayMs - KANBAN_REALTIME_MIN_DELAY_MS + 0.5) / (interval + 1);

    return jest.spyOn(Math, 'random').mockReturnValue(fraction);
}


/* --------------------------------------------------------------------------
 * Source text
 *
 * Some of what this hook must NOT do is unobservable at run time: a spec cannot
 * watch a `fetch` that is never written. Those prohibitions are asserted against
 * the source text instead, split deliberately in two:
 *
 *   - the EXECUTABLE source, comments stripped, for "the code must not contain
 *     this" -- otherwise the prose explaining why `subscribe` is forbidden would
 *     itself trip the gate on `subscribe`;
 *   - the FULL source, comments intact, for the two things that only live in
 *     comments: suppression pragmas, which must be absent, and the hazard
 *     documentation, which must be present.
 * -------------------------------------------------------------------------- */

const UNIT_PATH = join(__dirname, 'useKanbanRealtime.ts');

const SPEC_PATH = join(__dirname, 'useKanbanRealtime.test.ts');

const CONTROLLER_PATH = join(
    __dirname,
    '..',
    '..',
    '..',
    'coffee',
    'modules',
    'kanban',
    'main.coffee',
);

function readFullSource(path: string): string {
    return readFileSync(path, 'utf8');
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function readExecutableSource(): string {
    return stripComments(readFullSource(UNIT_PATH));
}

/* --------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------- */

const USERSTORIES_EVENT = KANBAN_REALTIME_USERSTORIES_EVENT;

const PROJECT_EVENT = KANBAN_REALTIME_PROJECT_EVENT;

/**
 * A realistic `…userstories` payload. `events.coffee:190` hands over `data.data`,
 * whose shape follows the routing key, so a realtime message is a plain object of
 * whatever the backend published -- never an Immutable structure and never a model
 * instance.
 */
const USERSTORIES_MESSAGE = { matches: 'userstories.userstory', data: { id: 42 } };

const MATCHING_MESSAGE = { matches: KANBAN_PROJECT_REFRESH_MATCHES[0] };

const NON_MATCHING_MESSAGE = { matches: 'projects.tag' };

/**
 * Project payloads that must not rebuild the board.
 *
 * `isProjectRefreshMessage` narrows an `unknown`, so the malformed shapes matter
 * as much as the well-formed-but-unrelated one: a realtime payload is whatever
 * arrived over the socket, and a board that throws on an unexpected message is
 * worse than one that ignores it -- the throw would escape a timer callback as an
 * unhandled error and abort a refresh the board legitimately owed.
 */
const IGNORED_PROJECT_PAYLOADS: Array<[string, unknown]> = [
    ['an unrelated match', NON_MATCHING_MESSAGE],
    ['no matches member', { pk: 1 }],
    ['a non-string matches', { matches: 42 }],
    ['a matches that only looks close', { matches: 'projects.swimlanes' }],
    ['a matches that is an object', { matches: { name: 'projects.swimlane' } }],
    ['a primitive payload', 'projects.swimlane'],
    ['a numeric payload', 7],
    ['a null payload', null],
    ['no payload at all', undefined],
];

/**
 * Payloads the user-story stream must forward UNTOUCHED. That stream applies no
 * narrowing at all -- `main.coffee:299-303` has no `matches` test -- so whatever
 * arrives is what the container is handed, malformed or not. The container owns
 * validation; a hook that quietly dropped an unexpected shape would stop the board
 * reloading with nothing to show why.
 */
const FORWARDED_USERSTORY_PAYLOADS: Array<[string, unknown]> = [
    ['a realistic message', USERSTORIES_MESSAGE],
    ['a bare object', { pk: 7 }],
    ['a string', 'userstories.userstory'],
    ['a number', 0],
    ['a boolean', false],
    ['null', null],
    ['an array', [{ id: 1 }, { id: 2 }]],
];

/* --------------------------------------------------------------------------
 * Lifecycle
 *
 * Fake timers everywhere, because every assertion about the debounce is an
 * assertion about time; real timers restored after each test so no spec can leak a
 * pending wait into the next one. `clearMocks` and `restoreMocks` in
 * `jest.config.js` handle every mock and spy, so nothing is reset by hand here.
 * -------------------------------------------------------------------------- */

beforeEach(() => {
    jest.useFakeTimers();
    installObserverStubs();
    mocks = _mocks();
});

afterEach(() => {
    jest.useRealTimers();
    restoreObservers();
});


/* ==========================================================================
 * 1. THE OWNERSHIP INVARIANT -- HAZARD H2
 * ========================================================================== */

describe('useKanbanRealtime -- the ownership invariant', () => {
    it('mounts with NO bridge provider at all, so it resolves no AngularJS service', () => {
        const registrar = makeRegistrarDouble();

        // `AngularBridgeContext` defaults to `null` and every accessor throws on a
        // null injector, so surviving this mount IS the assertion.
        expect(() => mountHook(makeProps(registrar.register))).not.toThrow();
        expect(registrar.register).toHaveBeenCalledTimes(2);
    });

    it('leaves $tgEvents entirely untouched even when a real bridge IS above it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHookWithBridge(props);

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        unmount();

        // Zero calls on BOTH halves. A single `subscribe` here would overwrite the
        // retained controller's entry in the one flat map at `events.coffee:214`
        // and the board would stop refreshing with nothing logged; a single
        // `unsubscribe` would tear down the shared server-side subscription and
        // silence the controller too.
        expect(mocks.events.subscribe).not.toHaveBeenCalled();
        expect(mocks.events.unsubscribe).not.toHaveBeenCalled();

        // The messages did arrive -- so the zero above is about the hook's
        // behaviour, not about a harness that delivered nothing.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('and that zero is not vacuous: the same wrapper DOES serve a hook that asks', () => {
        // Without this control, "never called" would also pass for a wrapper that
        // could not resolve `$tgEvents` at all.
        const probe = renderHook(() => useAngularService('$tgEvents'), {
            wrapper: withMockInjector(mocks.injector),
        });

        expect(probe.result.current).toBe(mocks.events.service);
        expect(probe.result.current.connected).toBe(true);
    });

    it('names no routing key and takes no project id: both belong to the controller', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        const executable = readExecutableSource();

        // The keys are composed at `main.coffee:298` and `:306` from the
        // controller's own `@scope.projectId`. A React hook that accepted a project
        // id would be advertising an authority it does not have, and a React hook
        // that composed a key would be one edit away from subscribing with it.
        expect(executable).not.toContain('changes.project');
        expect(executable).not.toContain('projectId');

        // What it listens for instead is two compile-time constants.
        expect(registrar.registeredNames()).toEqual([USERSTORIES_EVENT, PROJECT_EVENT]);
    });

    it('subscribes to nothing and resolves nothing in its EXECUTABLE source', () => {
        const executable = readExecutableSource();

        expect(executable.length).toBeGreaterThan(0);

        for (const forbidden of [
            // 'unsubscribe' is covered by 'subscribe'.
            'subscribe',
            '$tgEvents',
            'useAngularService',
            // The sanctioned generic primitive at `app/react/bridge/useRealtime.ts`
            // is deliberately NOT used by this screen: it subscribes with a null
            // scope, which is correct only for a key React owns outright, and
            // neither migrated screen has one.
            'useRealtime',
            'milestones',
            'selfNotification',
        ]) {
            expect(executable).not.toContain(forbidden);
        }
    });

    it('documents the global-key hazard and the null-scope cleanup at the seam', () => {
        const documented = readFullSource(UNIT_PATH);

        // Rule T9 asks for the technology-specific reasoning to live AT the point
        // of change. These are the two locators a future reader needs before
        // deciding to "simplify" this hook into a subscription.
        expect(documented).toContain('events.coffee L214');
        expect(documented).toContain('ARCHITECTURAL INVARIANT');
        expect(documented).toContain('events.coffee:217');
        expect(documented).toContain('silent leak');

        // And the reason no defensive registry is added on the React side.
        expect(documented).toContain('defensive global registry');
    });
});

/* ==========================================================================
 * 2. THE FROZEN STREAM SET -- GOAL G2, RULE T10
 * ========================================================================== */

describe('useKanbanRealtime -- the frozen stream set', () => {
    it('registers EXACTLY TWO listeners, for the user-story and project streams', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        expect(registrar.register).toHaveBeenCalledTimes(2);
        expect(registrar.registeredNames()).toEqual([USERSTORIES_EVENT, PROJECT_EVENT]);
    });

    it('hands the registrar EXACTLY an event name and one function -- no options', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        for (const call of registrar.register.mock.calls) {
            // `toHaveLength(2)` is the type-safe way to say "there is no third or
            // fourth argument": indexing past the declared tuple would not compile.
            // The Backlog screen's `milestones` subscription is the ONLY place in
            // the application that passes an options object
            // (`{selfNotification: true}`), and it passes it to `$tgEvents`, not to
            // a listener registrar. One appearing here would change realtime
            // behaviour silently.
            expect(call).toHaveLength(2);
            expect(typeof call[0]).toBe('string');
            expect(typeof call[1]).toBe('function');
        }
    });

    it('registers one live listener per stream, and never a second for either', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        expect(registrar.liveListenerCount(USERSTORIES_EVENT)).toBe(1);
        expect(registrar.liveListenerCount(PROJECT_EVENT)).toBe(1);
    });

    it('never registers a milestones stream: that set belongs to the Backlog', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        // Goal G2 names three resources -- userstories, milestones, projects -- but
        // that triple is the UNION of both migrated screens and neither screen's own
        // set. Kanban is {userstories, projects} (`main.coffee:298`, `:306`); Backlog
        // is {userstories, milestones}. Adding a third here would subscribe this
        // board to a stream the incumbent never gave it.
        for (const name of registrar.registeredNames()) {
            expect(name).not.toContain('milestones');
        }

        expect(registrar.registeredNames()).toHaveLength(2);
    });

    it('uses the exact event names the retained controller broadcasts', () => {
        // Assembled from fragments so this assertion cannot pass by comparing the
        // constant with itself.
        expect(KANBAN_REALTIME_USERSTORIES_EVENT).toBe(
            ['kanban', 'realtime', 'userstories'].join(':'),
        );
        expect(KANBAN_REALTIME_PROJECT_EVENT).toBe(['kanban', 'realtime', 'projects'].join(':'));

        // A two-ended contract: renaming one end leaves the other listening for an
        // event nobody raises, and AngularJS registers listeners for unknown names
        // quite happily -- so the failure is silent at BOTH ends. This is the only
        // assertion in the suite that reads the CoffeeScript producer, and it is
        // here because nothing else can catch that drift.
        const controller = readFullSource(CONTROLLER_PATH);

        expect(controller).toContain(`$broadcast("${KANBAN_REALTIME_USERSTORIES_EVENT}", message)`);
        expect(controller).toContain(`$broadcast("${KANBAN_REALTIME_PROJECT_EVENT}", message)`);
    });

    it('freezes the three project matches that rebuild the board', () => {
        expect(KANBAN_PROJECT_REFRESH_MATCHES).toEqual([
            'projects.swimlane',
            'projects.swimlaneuserstorystatus',
            'projects.userstorystatus',
        ]);

        // The same three, in the same order, in the incumbent's `in` test.
        const controller = readFullSource(CONTROLLER_PATH);

        for (const match of KANBAN_PROJECT_REFRESH_MATCHES) {
            expect(controller).toContain(`"${match}"`);
        }
    });

    it('freezes the inclusive wait bounds at the incumbent randomInt arguments', () => {
        expect(KANBAN_REALTIME_MIN_DELAY_MS).toBe(700);
        expect(KANBAN_REALTIME_MAX_DELAY_MS).toBe(1000);

        const controller = readFullSource(CONTROLLER_PATH);

        expect(controller).toContain(
            `randomInt(${KANBAN_REALTIME_MIN_DELAY_MS}, ${KANBAN_REALTIME_MAX_DELAY_MS})`,
        );
    });
});


/* ==========================================================================
 * 3. ONE SHARED, ONCE-DRAWN WAIT
 * ========================================================================== */

describe('useKanbanRealtime -- the shared random wait', () => {
    it('draws the INCLUSIVE lower bound when Math.random returns its floor', () => {
        const randomSpy = pinDrawnDelay(KANBAN_REALTIME_MIN_DELAY_MS);
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        advanceBy(KANBAN_REALTIME_MIN_DELAY_MS - 1);

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        advanceBy(1);

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(randomSpy).toHaveBeenCalledTimes(1);
    });

    it('draws the INCLUSIVE upper bound when Math.random returns its ceiling', () => {
        // `randomInt` is inclusive at BOTH ends -- `start + Math.floor(random *
        // (interval + 1))` reaches `end` only because of that `+ 1`. Losing it would
        // silently narrow the jitter window to 700-999, which no functional test
        // could ever see.
        pinDrawnDelay(KANBAN_REALTIME_MAX_DELAY_MS);

        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        advanceBy(KANBAN_REALTIME_MAX_DELAY_MS - 1);

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        advanceBy(1);

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('draws the wait ONCE per mounted hook, however many renders and messages follow', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { rerender } = mountHook(props);

        rerender({ ...props });
        rerender({ ...props, isLightboxOpen: true });
        rerender({ ...props, isLightboxOpen: false });

        // And then a burst on BOTH streams, twice over. This is the half that matters:
        // a wait re-drawn per TIMER rather than per MOUNT survives every threshold
        // assertion in this suite -- those pin `Math.random` to a fixed value, so a
        // re-draw returns the same number -- and shows up only as the draw count.
        for (let burst = 0; burst < 2; burst += 1) {
            registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
            registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
            registrar.broadcast(USERSTORIES_EVENT, { pk: burst });
            runOutTheWait();
        }

        // Re-rolling would make the wait a function of render and message count, and a
        // board mid-burst would settle at an unpredictable time. `randomTimeout` is a
        // single local at `main.coffee:295`, and the ref here is what reproduces it.
        expect(randomSpy).toHaveBeenCalledTimes(1);
    });

    it('gives BOTH streams the SAME wait, settling them together', () => {
        // `randomTimeout` is drawn once at `main.coffee:295` and closed over by both
        // debounced callbacks. Two independently drawn waits would still pass every
        // single-stream test in this file while changing when the board settles.
        const delay = 850;

        pinDrawnDelay(delay);

        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        advanceBy(delay - 1);

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        advanceBy(1);

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps every drawn wait inside the declared inclusive window', () => {
        // Belt and braces around the arithmetic itself: whatever fraction is drawn,
        // the resulting wait must fire inside [700, 1000] and never outside it.
        const randomSpy = jest.spyOn(Math, 'random');
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        advanceBy(KANBAN_REALTIME_MIN_DELAY_MS - 1);

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        advanceBy(KANBAN_REALTIME_MAX_DELAY_MS - KANBAN_REALTIME_MIN_DELAY_MS + 1);

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(randomSpy).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * 4. THE TRAILING DEBOUNCE -- `debounceLeading` IS A MISNOMER
 * ========================================================================== */

describe('useKanbanRealtime -- the trailing debounce', () => {
    it('fires NOTHING on the leading edge', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        // Reading `debounceLeading`'s NAME instead of its BODY
        // (`app/coffee/utils.coffee:121-122`, lodash `{leading: false, trailing:
        // true}`) inverts exactly this: the first message of a burst would fire
        // immediately and the last would be dropped.
        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('fires exactly once after the quiet period', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('stays quiet once the burst has been delivered', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();
        runOutTheWait();
        runOutTheWait();

        // A trailing debounce that re-armed itself would turn one message into a
        // poll, reloading the board for ever at the jitter interval.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('delivers the LAST message of a burst, and only it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);
        const last = { pk: 3 };

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, { pk: 1 });
        registrar.broadcast(USERSTORIES_EVENT, { pk: 2 });
        registrar.broadcast(USERSTORIES_EVENT, last);
        runOutTheWait();

        // lodash keeps only the most recent arguments, and so does this.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledWith(last);
    });

    it('hands the payload over by IDENTITY, neither cloned nor reshaped', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);
        const payload = { matches: 'userstories.userstory', data: { ids: [7, 8, 9] } };

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, payload);
        runOutTheWait();

        // Identity, not equality: the container reads this payload to decide which
        // stories to reload, and a defensive copy would quietly become the contract.
        expect(props.onUserStoriesChanged.mock.calls[0]?.[0]).toBe(payload);
    });

    it('resets the wait on every message rather than firing on a schedule', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // Nudge the clock forward in steps shorter than the minimum wait, so a
        // reset-less implementation would have fired several times by the end.
        for (let nudge = 0; nudge < 6; nudge += 1) {
            registrar.broadcast(USERSTORIES_EVENT, { pk: nudge });

            advanceBy(KANBAN_REALTIME_MIN_DELAY_MS - 100);
        }

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();

        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledWith({ pk: 5 });
    });

    it('keeps the two streams on INDEPENDENT timers', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        // A burst on the OTHER stream must not postpone the project timer. One timer
        // shared between the streams would let a busy board starve its own project
        // refresh indefinitely.
        for (let nudge = 0; nudge < 4; nudge += 1) {
            registrar.broadcast(USERSTORIES_EVENT, { pk: nudge });

            advanceBy(200);
        }

        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('lets the project stream reset without postponing the user-story stream', () => {
        // The mirror image of the previous test, because a shared timer is only
        // half-visible from one direction.
        const delay = 700;

        pinDrawnDelay(delay);

        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        advanceBy(delay - 100);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        advanceBy(100);

        // The user-story wait elapsed on its own schedule; the project one has not.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        advanceBy(delay - 100);

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('documents that the incumbent debounce is trailing-only despite its name', () => {
        const documented = readFullSource(UNIT_PATH);

        // Rule T9. Without this note the next reader sees `debounceLeading` in
        // `main.coffee` and "fixes" the React side to fire on the leading edge.
        expect(documented).toContain('TRAILING-ONLY');
        expect(documented).toContain('utils.coffee:121');
    });
});


/* ==========================================================================
 * 5. THE USER-STORY STREAM
 * ========================================================================== */

describe('useKanbanRealtime -- the user-story stream', () => {
    it.each(FORWARDED_USERSTORY_PAYLOADS)(
        'forwards %s to the container UNCHANGED',
        (_label, payload) => {
            const registrar = makeRegistrarDouble();
            const props = makeProps(registrar.register);

            mountHook(props);
            registrar.broadcast(USERSTORIES_EVENT, payload);
            runOutTheWait();

            // `main.coffee:299-303` applies no narrowing to this stream at all, so a
            // hook that validated the payload would drop reloads the incumbent
            // performs -- and would do it silently.
            expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
            expect(props.onUserStoriesChanged.mock.calls[0]?.[0]).toBe(payload);
        },
    );

    it('never throws on a malformed user-story payload', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        expect(() => {
            registrar.broadcast(USERSTORIES_EVENT, Symbol('unexpected'));
            runOutTheWait();
        }).not.toThrow();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('never routes a user-story message to the project refresh', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // Even a payload carrying a MATCHING `matches` value: the streams are keyed
        // by event name, and a board that rebuilt itself on a user-story message
        // would thrash on every card edit.
        registrar.broadcast(USERSTORIES_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('invokes the LATEST handler, never a stale closure', () => {
        const registrar = makeRegistrarDouble();
        const first = makeProps(registrar.register);
        const second = makeProps(registrar.register);

        const { rerender } = mountHook(first);

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        rerender({ ...second });
        runOutTheWait();

        // A queued timer must reach the handler the caller holds NOW, because the one
        // it was queued against may already be closed over stale state.
        expect(first.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-register when the caller passes fresh inline callbacks', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { rerender } = mountHook(props);

        // A container that builds its handlers inline re-renders with new identities
        // constantly. Re-registering on each one would deregister and re-register the
        // scope listeners on every keystroke, and a delivery landing in that gap
        // would simply be lost.
        rerender({ ...props, onUserStoriesChanged: userStoriesSpy() });
        rerender({ ...props, onProjectAttributesChanged: projectRefreshSpy() });

        expect(registrar.register).toHaveBeenCalledTimes(2);

        for (const deregister of registrar.deregistrations) {
            expect(deregister).not.toHaveBeenCalled();
        }
    });

    it('keeps firing while a lightbox is open: only the project stream defers', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        mountHook(props);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();

        // `main.coffee:299-303` has no lightbox test: restacking cards does not
        // disturb an open form, so this stream is never deferred.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * 6. THE PROJECT NARROWING
 * ========================================================================== */

describe('useKanbanRealtime -- the project narrowing', () => {
    it.each(KANBAN_PROJECT_REFRESH_MATCHES)('rebuilds the board for %s', (matches) => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(PROJECT_EVENT, { matches });
        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('invokes the refresh with NO arguments at all', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // The public handler type is `() => void`, and it stays that way on purpose:
        // the container's response is to re-fetch the project and reload
        // (`main.coffee:259-263`), which needs nothing from the message beyond the
        // fact that it matched. Passing the payload anyway would invite a consumer to
        // read board structure out of a notification.
        expect(props.onProjectAttributesChanged.mock.calls[0]).toHaveLength(0);
    });

    it.each(IGNORED_PROJECT_PAYLOADS)('ignores %s without throwing', (_label, payload) => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        expect(() => {
            registrar.broadcast(PROJECT_EVENT, payload);
            runOutTheWait();
        }).not.toThrow();

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('narrows AFTER the debounce, so a non-matching last message cancels the refresh', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // Exactly the incumbent's behaviour: the `matches` test lives INSIDE the
        // debounced function (`main.coffee:308-312`), so only the LAST message of the
        // burst is tested. Narrowing before the debounce instead would make the board
        // refresh in a case where it currently does not.
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, NON_MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('refreshes when a non-matching message is FOLLOWED by a matching one', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);

        // The other order, which must refresh exactly once -- last message wins in
        // both directions.
        registrar.broadcast(PROJECT_EVENT, NON_MATCHING_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('never routes a project message to the user-story handler', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        mountHook(props);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
    });
});


/* ==========================================================================
 * 7. THE LIGHTBOX COALESCING BOUNDARY
 * ========================================================================== */

describe('useKanbanRealtime -- the lightbox coalescing boundary', () => {
    it('defers a matching project message while a lightbox is open', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        mountHook(props);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // Rebuilding the board would yank the ground out from under an open form, so
        // the refresh is remembered instead (`main.coffee:313-314`).
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('coalesces MANY deferred messages into exactly ONE refresh on close', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        for (let burst = 0; burst < 4; burst += 1) {
            registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
            runOutTheWait();
        }

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        // `isRefreshNeeded` is a BOOLEAN, not a counter or a queue
        // (`main.coffee:90`), because the reload always fetches current state. Ten
        // deferred messages are one owed rebuild, not ten.
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('releases on the true -> false EDGE, so a repeated false is a no-op', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // Level-triggered logic would fire again on every render that merely repeats
        // `false`, which is most renders of a board with no lightbox open.
        rerender({ ...props, isLightboxOpen: false });
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('does not release on a FIRST render that is already closed', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, false);

        mountHook(props);

        // Edge-triggering rather than level-triggering is what makes this hold on the
        // very first render, where there is no previous state to compare against.
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('closing with nothing pending is a no-op', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('does not release a SECOND time on a later close: the flag was cleared', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // Open and close again with NOTHING pending. A flag left set after the first
        // release would rebuild the board every time a user dismissed any lightbox.
        rerender({ ...props, isLightboxOpen: true });
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('releases again on a SECOND open-defer-close cycle', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // Cycle two on the SAME hook instance. This is what proves the pending flag
        // really was cleared and that the re-entrancy guard was reset in its
        // `finally`: a guard left latched, or a flag left set, both surface here.
        rerender({ ...props, isLightboxOpen: true });
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(2);
    });

    it('refreshes immediately once the lightbox is closed again', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        rerender({ ...props, isLightboxOpen: false });
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // No deferral once closed: the message takes the direct path.
        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('releases the deferred refresh through the LATEST callback, without re-registering', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);
        const later = projectRefreshSpy();

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // The container swaps its callback while the lightbox is still open -- which
        // is ordinary, since a container that re-renders builds new handlers. The
        // owed rebuild must be released through the handler the caller holds NOW.
        rerender({ ...props, onProjectAttributesChanged: later });
        rerender({ ...props, onProjectAttributesChanged: later, isLightboxOpen: false });

        expect(later).toHaveBeenCalledTimes(1);
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        // And none of that touched the seam.
        expect(registrar.register).toHaveBeenCalledTimes(2);

        for (const deregister of registrar.deregistrations) {
            expect(deregister).not.toHaveBeenCalled();
        }
    });

    it('leaves the user-story stream untouched across the same open interval', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();

        // While open: user stories delivered, project deferred.
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        rerender({ ...props, isLightboxOpen: false });

        // On close: the owed rebuild released, and the user-story stream NOT replayed.
        // Deferral leaking into that path would double every card reload.
        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);
        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('defers only a MATCHING message: a non-matching one leaves nothing owed', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, NON_MATCHING_MESSAGE);
        runOutTheWait();
        rerender({ ...props, isLightboxOpen: false });

        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('lets a failing rebuild ESCAPE rather than swallowing it', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register, true);

        props.onProjectAttributesChanged.mockImplementationOnce(() => {
            throw new Error('rebuild failed');
        });

        // React reports an uncaught commit-phase error through `console.error` before
        // re-throwing it. The throw is the assertion here, so the report is expected
        // output rather than a problem; silencing it for this one test keeps a green
        // run's stderr genuinely empty. `restoreMocks` puts the real console back.
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { rerender } = mountHook(props);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        // A swallowed failure is the worst outcome available here: the board would sit
        // showing columns the project no longer has, with nothing in the console. So
        // the release must not wrap the callback in a catch -- the throw escapes
        // exactly as it would escape `main.coffee:256`, and the owning tree's
        // ErrorBoundary decides what to do about it.
        //
        // Note on what is NOT asserted: `main.coffee:255-257` clears the pending flag
        // AFTER the refresh, so a failed rebuild stays owed. That ordering is
        // implemented, but its consequence is unobservable from here, because React
        // escalates an uncaught error thrown in a passive effect to the root and
        // unmounts the tree -- taking the very ref that holds the flag with it.
        // Asserting a second release after this point would be asserting React's
        // teardown behaviour, not the hook's.
        expect(() => rerender({ ...props, isLightboxOpen: false })).toThrow('rebuild failed');
        expect(props.onProjectAttributesChanged).toHaveBeenCalledTimes(1);

        // The report was React's, not a second failure path of our own.
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});


/* ==========================================================================
 * 8. CLEANUP AND THE SILENT LEAK -- HAZARD H1
 * ========================================================================== */

describe('useKanbanRealtime -- cleanup', () => {
    it('releases BOTH listeners exactly once on unmount', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        unmount();

        expect(registrar.deregistrations).toHaveLength(2);

        for (const deregister of registrar.deregistrations) {
            expect(deregister).toHaveBeenCalledTimes(1);
        }

        expect(registrar.liveListenerCount(USERSTORIES_EVENT)).toBe(0);
        expect(registrar.liveListenerCount(PROJECT_EVENT)).toBe(0);
    });

    it('calls each deregistrar with NO arguments', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        unmount();

        for (const deregister of registrar.deregistrations) {
            // `$scope.$on` hands back a nullary deregistration function. Passing it a
            // routing key -- the shape `$tgEvents.unsubscribe(routingKey)` takes --
            // would be the visible symptom of having confused the two teardown
            // mechanisms, and only this assertion would catch it.
            expect(deregister.mock.calls[0]).toHaveLength(0);
        }
    });

    it('cancels a queued debounce so it can never fire after unmount', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHook(props);

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        expect(jest.getTimerCount()).toBeGreaterThan(0);

        unmount();

        // A timer can outlive its listener by up to one full wait, so cancelling is
        // not optional: a payload queued when the board went away describes a board
        // that is no longer on screen.
        expect(jest.getTimerCount()).toBe(0);

        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('ignores a delivery that was already in flight when teardown ran', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHook(props);

        unmount();

        // Hazard H1 in its purest form: the listener has been released, but a delivery
        // that had already started still reaches the callback the hook handed over.
        // The disposal flag is set BEFORE deregistering precisely so this arrives at a
        // hook that refuses to schedule.
        registrar.broadcastIncludingReleased(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcastIncludingReleased(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();
    });

    it('schedules NOTHING for an in-flight delivery after teardown', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        unmount();
        registrar.broadcastIncludingReleased(USERSTORIES_EVENT, USERSTORIES_MESSAGE);

        // Not merely "the callback did not run": no timer was armed at all, so the
        // refusal happens at the door rather than one wait later.
        expect(jest.getTimerCount()).toBe(0);
    });

    it('reports nothing to the console for a delivery after teardown', () => {
        // Spied narrowly and asserted only on the CALL, never on React's wording,
        // which changes between releases. A state update from an unmounted tree is the
        // classic symptom of a leaked listener, and it announces itself here.
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        unmount();
        registrar.broadcastIncludingReleased(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcastIncludingReleased(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('refuses a queued delivery even when a deregistrar throws mid-cleanup', () => {
        const registrar = makeRegistrarDouble();
        const props = makeProps(registrar.register);

        const { unmount } = mountHook(props);

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        expect(jest.getTimerCount()).toBe(2);

        // A deregistrar CAN fail: `$scope.$on`'s teardown runs against a scope
        // AngularJS may already have destroyed. Making the first one throw is what
        // turns the cleanup's internal ORDER from a code-reading into an assertion,
        // because the throw aborts the remainder of that cleanup -- neither the second
        // deregistration nor either timer cancellation gets to run.
        registrar.deregistrations[0].mockImplementationOnce(() => {
            throw new Error('scope already destroyed');
        });

        // React reports an uncaught cleanup error through `console.error` before
        // re-throwing it; silencing it here keeps a green run's stderr empty, and
        // `restoreMocks` puts the real console back.
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => unmount()).toThrow('scope already destroyed');

        // Proof that the cancellations really were skipped: both waits are still armed.
        expect(jest.getTimerCount()).toBe(2);

        runOutTheWait();

        // And nothing is delivered anyway, because the disposal flag is raised FIRST,
        // ahead of everything that can fail. Set last instead -- the natural reading
        // order -- a failing deregistration would let a queued rebuild through into an
        // unmounted tree, which is the single outcome the flag exists to prevent.
        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('drops a deferred rebuild when the board goes away before the lightbox closes', () => {
        const registrar = makeRegistrarDouble();
        const first = makeProps(registrar.register, true);

        const firstMount = mountHook(first);

        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        firstMount.unmount();

        // A fresh board must not inherit the previous one's owed rebuild: the pending
        // flag lives on the hook INSTANCE, never at module level, which is also what
        // keeps two boards on one page from releasing each other's work.
        const second = makeProps(registrar.register, true);
        const secondMount = mountHook(second);

        secondMount.rerender({ ...second, isLightboxOpen: false });

        expect(first.onProjectAttributesChanged).not.toHaveBeenCalled();
        expect(second.onProjectAttributesChanged).not.toHaveBeenCalled();

        secondMount.unmount();
    });

    it('re-arms after a remount and delivers again', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register)).unmount();

        const second = makeProps(registrar.register);
        const secondMount = mountHook(second);

        // Re-arming the disposal flag on every effect run is REQUIRED rather than
        // defensive: StrictMode's development-only mount/unmount/remount reuses the
        // very same refs, so a flag left set by the simulated unmount would silence
        // the board for the rest of the session.
        expect(registrar.liveListenerCount(USERSTORIES_EVENT)).toBe(1);
        expect(registrar.liveListenerCount(PROJECT_EVENT)).toBe(1);

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();

        expect(second.onUserStoriesChanged).toHaveBeenCalledTimes(1);

        secondMount.unmount();
    });

    it('releases the OLD listeners BEFORE registering the new ones', () => {
        const journal: JournalEntry[] = [];
        const first = makeRegistrarDouble('first', journal);
        const second = makeRegistrarDouble('second', journal);
        const props = makeProps(first.register);

        const { rerender } = mountHook(props);

        expect(journal).toEqual([
            `first/register/${USERSTORIES_EVENT}`,
            `first/register/${PROJECT_EVENT}`,
        ]);

        rerender({ ...props, registrar: second.register });

        // The exact order, not merely the counts. Registering the new listeners first
        // would leave both generations live for the duration of the swap, and a
        // delivery landing in that window would be handled TWICE -- the same duplicate
        // work that a leak produces, but harder to find because it is transient.
        expect(journal).toEqual([
            `first/register/${USERSTORIES_EVENT}`,
            `first/register/${PROJECT_EVENT}`,
            `first/deregister/${USERSTORIES_EVENT}`,
            `first/deregister/${PROJECT_EVENT}`,
            `second/register/${USERSTORIES_EVENT}`,
            `second/register/${PROJECT_EVENT}`,
        ]);
    });

    it('leaves nothing listening on the OLD registrar after the swap', () => {
        const first = makeRegistrarDouble('first');
        const second = makeRegistrarDouble('second');
        const props = makeProps(first.register);

        const { rerender } = mountHook(props);

        rerender({ ...props, registrar: second.register });

        expect(first.liveListenerCount(USERSTORIES_EVENT)).toBe(0);
        expect(first.liveListenerCount(PROJECT_EVENT)).toBe(0);

        // Broadcasting on the old registrar now reaches nobody, so a scope that
        // outlived the swap cannot drive this board any more.
        first.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        first.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).not.toHaveBeenCalled();
        expect(props.onProjectAttributesChanged).not.toHaveBeenCalled();

        // Note on what is deliberately NOT asserted: driving a RELEASED old listener
        // with `broadcastIncludingReleased` while the hook is still mounted is not a
        // no-op, and must not be. The disposal flag is re-armed by the new effect run
        // (see the remount test above, and StrictMode), so such a delivery is
        // indistinguishable from a duplicate message on the live stream -- which the
        // trailing debounce coalesces anyway. Asserting a no-op there would demand a
        // per-generation flag whose only effect would be to break StrictMode.

        expect(second.register).toHaveBeenCalledTimes(2);
    });

    it('delivers through the NEW registrar after the swap', () => {
        const first = makeRegistrarDouble('first');
        const second = makeRegistrarDouble('second');
        const props = makeProps(first.register);

        const { rerender } = mountHook(props);

        rerender({ ...props, registrar: second.register });

        second.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        runOutTheWait();

        expect(props.onUserStoriesChanged).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes no routing key on unmount, because it subscribed to none', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHookWithBridge(makeProps(registrar.register));

        unmount();

        // The other half of hazard H2: `unsubscribe` carries only the routing key
        // (`events.coffee:219-230`), so one call here would silence the retained
        // controller's own subscription along with this board's.
        expect(mocks.events.unsubscribe).not.toHaveBeenCalled();
    });
});


/* ==========================================================================
 * 9. THE SOURCE-LEVEL PROHIBITIONS
 *
 * A spec cannot watch a `fetch` that is never written, so the constraints that
 * are about ABSENCE are asserted against the source text. Every needle below is
 * matched against the EXECUTABLE source -- comments stripped -- because the prose
 * explaining why `subscribe` is forbidden would otherwise trip the gate on
 * `subscribe`.
 * ========================================================================== */

describe('useKanbanRealtime -- the source-level prohibitions', () => {
    it('constructs no transport of any kind', () => {
        const executable = readExecutableSource();

        // Rule T5 and requirement I7. Reads and writes belong to the container's
        // callbacks, which reach `$tgResources` through the bridge, so the
        // `Authorization` and `X-Session-Id` headers, the single-flight 401 refresh,
        // the 451 interceptor and `$tgModel`'s changed-fields-only PATCH semantics are
        // all inherited rather than re-derived. A hand-rolled client would drop every
        // one of them, and would do it invisibly until a token expired.
        for (const forbidden of [
            'WebSocket',
            'EventSource',
            'fetch(',
            'XMLHttpRequest',
            'axios',
            '$http',
            'FormData',
            'sendBeacon',
        ]) {
            expect(executable).not.toContain(forbidden);
        }
    });

    it('drives no AngularJS digest', () => {
        const executable = readExecutableSource();

        // AAP 0.7.4 forbids this outright: digest cycles stay AngularJS's concern and
        // React state updates are driven by React. The `$apply` needle also covers
        // `$applyAsync`.
        for (const driver of ['$apply', '$digest', '$evalAsync', '$rootScope', '$scope']) {
            expect(executable).not.toContain(driver);
        }
    });

    it('imports neither AngularJS, the legacy scripts, nor Immutable', () => {
        const executable = readExecutableSource();

        expect(executable).not.toMatch(/from\s+'angular/);

        // `app/js/` holds the pre-module browser globals -- `boards.js`,
        // `dragula-drag-multiple.js` -- which are loaded by the AngularJS bundle and
        // are not modules at all.
        expect(executable).not.toContain('app/js/');

        // Requirement I5: Immutable stays installed for the 124 files outside these
        // two modules, and stays OUT of the migrated ones.
        expect(executable).not.toContain('Immutable');
        expect(executable).not.toContain('immutable');
    });

    it('imports React by named import only', () => {
        const executable = readExecutableSource();

        // `jsx: "react-jsx"` means the runtime is injected by the compiler, so a
        // default or namespace import would be dead weight that also defeats
        // tree-shaking in the esbuild bundle.
        expect(executable).not.toMatch(/import\s+React\b/);
        expect(executable).not.toMatch(/import\s+\*\s+as\s+React\b/);
        expect(executable).toMatch(/import\s+\{[^}]*\}\s+from\s+'react'/);
    });

    it('uses no escape-hatch type and no suppression comment', () => {
        // `tsconfig.json` sets `strict` with no opt-outs, plus `noUnusedLocals`,
        // `noUnusedParameters` and `isolatedModules`. An escape hatch or a pragma
        // would make that gate advisory.
        expect(readExecutableSource()).not.toMatch(/\bany\b/);

        const documented = readFullSource(UNIT_PATH);

        // Assembled from fragments so that no suppression pragma appears literally
        // anywhere in this file either -- a repository-wide grep for one should find
        // nothing, including in the spec that forbids it.
        const pragmas = [
            ['@ts', 'ignore'].join('-'),
            ['@ts', 'expect', 'error'].join('-'),
            ['@ts', 'nocheck'].join('-'),
        ];

        for (const pragma of pragmas) {
            expect(documented).not.toContain(pragma);
        }
    });

    it('reaches for no end-to-end layer, no build output and no snapshot API', () => {
        const executable = readExecutableSource();

        // Requirement HR-5 keeps the two test layers apart: the end-to-end layer has
        // its own runner and its own npm script, and nothing in `app/react` may pull
        // it in. Nothing here depends on `dist/` either, which is what lets the suite
        // run straight from source.
        expect(executable.toLowerCase()).not.toContain('playwright');
        expect(executable.toLowerCase()).not.toContain('snapshot');
        expect(executable).not.toContain('dist/');
    });

    it('narrows remote payloads instead of asserting their shape', () => {
        const executable = readExecutableSource();

        // A realtime message is remote input handed over as `events.coffee:190`'s
        // `data.data`, so it may be malformed, null, a primitive, or an object whose
        // `matches` is not a string. The narrowing predicate is what makes the
        // ignore-rather-than-throw behaviour asserted above type-safe as well.
        expect(executable).toContain('message: unknown');
        expect(executable).toContain('message is {');
        expect(executable).toContain("typeof matches === 'string'");
    });
});

/* ==========================================================================
 * 10. SUITE HYGIENE AND SEAM FIDELITY
 *
 * Every assertion above rests on two things being true of the harness: that the
 * double behaves like `$scope.$on` and not like the routing-key registry, and that
 * the suite leaves no residue for the next file in the run.
 * ========================================================================== */

describe('useKanbanRealtime -- suite hygiene and seam fidelity', () => {
    it('keeps an ARRAY of listeners per event name, which is why listening is safe', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        // This pins the DOUBLE's fidelity, not a product behaviour. `$scope.$on`
        // appends to an array per name, so a second listener cannot displace the
        // first -- the exact opposite of `@.subscriptions[routingKey] = subscription`
        // at `events.coffee:214`, where a second subscribe silently overwrites. That
        // asymmetry is the entire justification for the listen-don't-subscribe design
        // (hazard H2).
        //
        // Two simultaneous consumers of one routing key is NOT asserted as a supported
        // pattern anywhere in this suite, because it is not one: the invariant is one
        // live owner per key, and that owner is the retained controller. What is
        // asserted is only that additional LISTENERS are harmless, which is the
        // property the design relies on.
        const extra = jest.fn<void, [unknown]>();
        const deregisterExtra = registrar.register(USERSTORIES_EVENT, extra);

        expect(registrar.liveListenerCount(USERSTORIES_EVENT)).toBe(2);

        deregisterExtra();

        expect(registrar.liveListenerCount(USERSTORIES_EVENT)).toBe(1);
        expect(extra).not.toHaveBeenCalled();
    });

    it('stubs both layout observers structurally, so nothing that used one would throw', () => {
        const target = document.createElement('div');

        const intersection = new globalThis.IntersectionObserver(() => undefined, {
            rootMargin: '10px',
        });

        intersection.observe(target);
        intersection.unobserve(target);
        intersection.disconnect();

        expect(intersection.rootMargin).toBe('10px');
        expect(intersection.root).toBeNull();
        expect(intersection.thresholds).toEqual([0]);
        expect(intersection.takeRecords()).toEqual([]);

        const resize = new globalThis.ResizeObserver(() => undefined);

        resize.observe(target);
        resize.unobserve(target);
        resize.disconnect();

        expect(StubIntersectionObserver.instances).toHaveLength(1);
        expect(StubResizeObserver.instances).toHaveLength(1);
    });

    it('constructs NO observer of its own: this hook is time-driven, not layout-driven', () => {
        const registrar = makeRegistrarDouble();

        const { unmount } = mountHook(makeProps(registrar.register));

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);
        runOutTheWait();
        unmount();

        // Virtualisation lives in `app/react/shared/useInViewport.ts`; nothing about a
        // realtime message depends on geometry. An edit that reached for the viewport
        // from inside a debounce would surface here rather than in a browser.
        expect(StubIntersectionObserver.instances).toHaveLength(0);
        expect(StubResizeObserver.instances).toHaveLength(0);
    });

    it('restores the observer globals to exactly their pre-suite state', () => {
        restoreObservers();

        expect(globalThis.IntersectionObserver).toBe(nativeIntersectionObserver);
        expect(globalThis.ResizeObserver).toBe(nativeResizeObserver);

        // Put them back so the rest of this test -- and the shared `afterEach` -- see
        // the same world every other spec sees.
        installObserverStubs();
    });

    it('leaves no timer pending once a wait has been run out', () => {
        const registrar = makeRegistrarDouble();

        mountHook(makeProps(registrar.register));

        registrar.broadcast(USERSTORIES_EVENT, USERSTORIES_MESSAGE);
        registrar.broadcast(PROJECT_EVENT, MATCHING_MESSAGE);

        expect(jest.getTimerCount()).toBe(2);

        runOutTheWait();

        // Real timers are restored in `afterEach`, so a spec that left a wait armed
        // would hand the next one a clock it did not expect.
        expect(jest.getTimerCount()).toBe(0);
    });

    it('imports only from the sanctioned set, keeping the suite browserless', () => {
        const specifiers = [...readFullSource(SPEC_PATH).matchAll(/from\s+'([^']+)'/g)].map(
            (match) => match[1],
        );

        // Requirement HR-5 and the plan's dependency discipline in one assertion: two
        // Node built-ins for the source gates, the jsdom testing library, the three
        // bridge modules this harness is built from, and the unit under test. No
        // end-to-end layer, no HTTP client, no AngularJS package, and no shared test
        // helper outside the declared dependency set.
        expect(new Set(specifiers)).toEqual(
            new Set([
                'fs',
                'path',
                '@testing-library/react',
                '../../bridge/AngularBridgeContext',
                '../../bridge/mockInjector',
                '../../bridge/useAngularService',
                './useKanbanRealtime',
            ]),
        );
    });
});

