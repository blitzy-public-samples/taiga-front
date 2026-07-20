/**
 * Unit tests for the WebSocket events bridge (`../events`).
 *
 * WHAT THIS COVERS (F-AAP-04 — connection-lifecycle leak)
 * -------------------------------------------------------
 * The review flagged that the socket, the heartbeat interval, a pending
 * reconnect timer and the outbound message queue could all survive after the
 * LAST subscriber unsubscribed, and that the reconnect `setTimeout` handle was
 * discarded (uncancellable). These tests exercise the real `EventsBridge`
 * lifecycle end-to-end and assert that:
 *
 *   - the socket opens lazily on the first subscribe and the `subscribe` frame
 *     is emitted after `open` (behind the auth frame);
 *   - the socket is CLOSED and the heartbeat STOPPED once the last subscriber
 *     across all keys leaves, WITHOUT emitting an `unsubscribe` frame first —
 *     the close is the server-side teardown and preceding it with `unsubscribe`
 *     crashes `taiga-events` ("Channel ended, no reply will be forthcoming",
 *     M-09); a per-key `unsubscribe` is only emitted (deferred, socket-open
 *     gated) when a key empties while OTHER keys keep the socket open;
 *   - a reconnect scheduled by a socket error is CANCELLED by the final
 *     unsubscribe, so no zombie socket is reopened later (the core leak);
 *   - a `close` event can no longer resurrect the socket after teardown;
 *   - a fresh subscribe after teardown opens a brand-new socket (the
 *     lazy-connect latch is reset);
 *   - repeated subscribe/unsubscribe cycles leave ZERO live sockets and ZERO
 *     pending timers;
 *   - reference counting is correct across multiple keys and multiple listeners
 *     on the same key (the socket stays open while ANY listener remains);
 *   - multiple errors coalesce into a single pending reconnect;
 *   - with events disabled (no `eventsUrl`) nothing connects.
 *
 * TEST ENVIRONMENT
 * ----------------
 *   - jsdom (per `jest.config.js`). jsdom ships a real `WebSocket` that would
 *     attempt live network I/O, so every test replaces `globalThis.WebSocket`
 *     with the in-memory {@link MockWebSocket} below; the original is restored
 *     afterwards. No real socket is ever opened.
 *   - `../session` is mocked so the bridge is ENABLED (`getEventsUrl` truthy)
 *     and configured with short heartbeat/reconnect intervals we drive with
 *     Jest fake timers. The factory references no out-of-scope variables, so it
 *     is safe under jest's mock hoisting.
 *   - The bridge is a module-level singleton, so `jest.resetModules()` runs in
 *     `beforeEach` and the module is re-`require`d to get a pristine bridge for
 *     every test (order-independent, no cross-test state).
 *
 * Jest globals (`describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest`) are
 * ambient via the root `tsconfig.json` `types: ["jest", ...]`.
 */

// ---------------------------------------------------------------------------
// Mock the session bridge: enable events + supply short, deterministic timings.
// ---------------------------------------------------------------------------
jest.mock('../session', () => ({
    getEventsUrl: jest.fn((): string | null => 'ws://localhost:8888/events'),
    getConfig: jest.fn((): Record<string, unknown> => ({
        // Small intervals so fake timers reach them quickly.
        eventsReconnectTryInterval: 1000, // reconnect delay ∈ [500, 1000] ms
        eventsMaxConnectionErrors: 5,
        eventsMaxMissedHeartbeats: 5,
        eventsHeartbeatIntervalTime: 5000, // well above the reconnect window
    })),
    getAuthToken: jest.fn((): string | null => 'jwt-test'),
    getSessionId: jest.fn((): string | null => 'sess-test'),
}));

// ---------------------------------------------------------------------------
// In-memory WebSocket double. Records sent frames + close() calls and lets a
// test drive the open/message/error/close lifecycle synchronously.
// ---------------------------------------------------------------------------
type Listener = (ev: unknown) => void;

class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    /** Every socket the code-under-test constructs, in creation order. */
    static instances: MockWebSocket[] = [];

    static reset(): void {
        MockWebSocket.instances = [];
    }

    readonly url: string;
    readyState: number = MockWebSocket.CONNECTING;
    /** Serialized frames passed to `send()`, in order. */
    readonly sent: string[] = [];
    /** How many times `close()` was invoked. */
    closeCalls = 0;

    private readonly listeners: Record<string, Set<Listener>> = {
        open: new Set<Listener>(),
        message: new Set<Listener>(),
        error: new Set<Listener>(),
        close: new Set<Listener>(),
    };

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, cb: Listener): void {
        const set = this.listeners[type];
        if (set) {
            set.add(cb);
        }
    }

    removeEventListener(type: string, cb: Listener): void {
        const set = this.listeners[type];
        if (set) {
            set.delete(cb);
        }
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closeCalls += 1;
        this.readyState = MockWebSocket.CLOSED;
    }

    /* ---- test drivers ---- */

    emitOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.fire('open', { type: 'open' });
    }

    emitMessage(payload: unknown): void {
        this.fire('message', { data: JSON.stringify(payload) });
    }

    emitError(): void {
        this.fire('error', { type: 'error' });
    }

    emitClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.fire('close', { type: 'close' });
    }

    private fire(type: string, ev: unknown): void {
        const set = this.listeners[type];
        if (!set) {
            return;
        }
        // Copy first: a listener may mutate the set (remove itself) mid-dispatch.
        for (const cb of Array.from(set)) {
            cb(ev);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
type EventsModule = typeof import('../events');
type SessionMock = {
    getEventsUrl: jest.Mock;
    getConfig: jest.Mock;
    getAuthToken: jest.Mock;
    getSessionId: jest.Mock;
};

const ORIGINAL_WEBSOCKET: unknown = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;

let subscribe: EventsModule['subscribe'];
let subscribeProjectChanges: EventsModule['subscribeProjectChanges'];
let isEventsConnected: EventsModule['isEventsConnected'];
let sessionMock: SessionMock;

/** The most recently constructed socket (throws if none exists yet). */
function latestSocket(): MockWebSocket {
    const list = MockWebSocket.instances;
    const ws = list[list.length - 1];
    if (!ws) {
        throw new Error('expected a MockWebSocket to have been created');
    }
    return ws;
}

/** Parse a socket's sent frames into objects. */
function sentFrames(ws: MockWebSocket): Array<Record<string, unknown>> {
    return ws.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

/** The `cmd` field of every frame a socket has sent, in order. */
function sentCmds(ws: MockWebSocket): unknown[] {
    return sentFrames(ws).map((frame) => frame.cmd);
}

beforeEach(() => {
    MockWebSocket.reset();
    jest.useFakeTimers();

    // Swap in the mock socket for this test.
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

    // Fresh module registry → pristine singleton bridge.
    jest.resetModules();
    const mod = require('../events') as EventsModule;
    subscribe = mod.subscribe;
    subscribeProjectChanges = mod.subscribeProjectChanges;
    isEventsConnected = mod.isEventsConnected;

    // The freshly-created session mock instance the bridge now holds.
    sessionMock = require('../session') as SessionMock;
});

afterEach(() => {
    // Drop any timers a test intentionally left pending, then go back to real
    // timers and restore the environment's WebSocket.
    jest.clearAllTimers();
    jest.useRealTimers();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = ORIGINAL_WEBSOCKET;
    jest.clearAllMocks();
});

// ===========================================================================
describe('events bridge — connect / subscribe', () => {
    it('opens exactly one socket on first subscribe and sends auth then subscribe on open', () => {
        const cb = jest.fn();
        subscribe('changes.project.42.userstories', cb);

        // Lazy connect: exactly one socket, pointed at the resolved URL.
        expect(MockWebSocket.instances).toHaveLength(1);
        const ws = latestSocket();
        expect(ws.url).toBe('ws://localhost:8888/events');

        // Nothing is sent until the socket opens (frames are queued).
        expect(ws.sent).toHaveLength(0);

        ws.emitOpen();

        // Auth frame leads, then the queued subscribe frame.
        const cmds = sentCmds(ws);
        expect(cmds).toEqual(['auth', 'subscribe']);

        const [authFrame, subscribeFrame] = sentFrames(ws);
        expect(authFrame).toEqual({ cmd: 'auth', data: { token: 'jwt-test', sessionId: 'sess-test' } });
        expect(subscribeFrame).toEqual({ cmd: 'subscribe', routing_key: 'changes.project.42.userstories' });
    });

    it('emits the subscribe frame only once per key even with two listeners', () => {
        const un1 = subscribe('changes.project.7.userstories', jest.fn());
        subscribe('changes.project.7.userstories', jest.fn());

        latestSocket().emitOpen();

        const subscribeCount = sentCmds(latestSocket()).filter((c) => c === 'subscribe').length;
        expect(subscribeCount).toBe(1);

        // First listener leaving must NOT unsubscribe the key (a listener remains).
        un1();
        const unsubCount = sentCmds(latestSocket()).filter((c) => c === 'unsubscribe').length;
        expect(unsubCount).toBe(0);
        expect(latestSocket().closeCalls).toBe(0);
    });

    it('delivers a matching frame payload to the registered callback (and ignores unknown keys)', () => {
        const cb = jest.fn();
        subscribe('changes.project.1.userstories', cb);
        latestSocket().emitOpen();

        latestSocket().emitMessage({ routing_key: 'changes.project.1.userstories', data: { id: 99 } });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ id: 99 });

        // A frame for a key nobody subscribed to must not reach the callback.
        latestSocket().emitMessage({ routing_key: 'changes.project.1.milestones', data: { id: 5 } });
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

// ===========================================================================
describe('events bridge — teardown at zero subscribers (F-AAP-04)', () => {
    it('closes the socket and stops the heartbeat when the last subscriber leaves, WITHOUT sending an unsubscribe frame first (M-09)', () => {
        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen(); // starts the heartbeat

        unsubscribe();

        // M-09: on the last-listener path NO `unsubscribe` frame is emitted — the
        // socket close itself drops the binding server-side. Emitting
        // `unsubscribe` and then closing immediately orphans the backend's async
        // RabbitMQ unbind reply and crashes taiga-events ("Channel ended, no
        // reply will be forthcoming"). Flushing any deferred microtask must STILL
        // produce no unsubscribe (the socket is already closed → suppressed).
        expect(sentCmds(ws)).not.toContain('unsubscribe');
        jest.runAllTicks();
        expect(sentCmds(ws)).not.toContain('unsubscribe');

        // Socket closed, and no timers survive (heartbeat cleared).
        expect(ws.closeCalls).toBe(1);
        expect(jest.getTimerCount()).toBe(0);

        // Advancing well past the heartbeat interval sends no further ping and
        // opens no new socket.
        jest.advanceTimersByTime(20000);
        expect(MockWebSocket.instances).toHaveLength(1);
        expect(sentCmds(ws)).not.toContain('ping');
    });

    it('cancels a pending reconnect when the last subscriber leaves — no zombie socket (the core leak)', () => {
        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();

        // A socket error schedules a reconnect (handle is now stored).
        ws.emitError();
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // The last subscriber leaves: teardown must cancel that reconnect.
        unsubscribe();
        expect(jest.getTimerCount()).toBe(0);

        // Before the fix the discarded setTimeout would fire here and reopen a
        // socket; assert no second socket is ever created.
        jest.advanceTimersByTime(10000);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('a close event can no longer resurrect the socket after teardown', () => {
        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();

        unsubscribe(); // teardown removes the close listener and closes the socket
        expect(ws.closeCalls).toBe(1);

        // Firing close on the torn-down socket does nothing (listener removed):
        // no reconnect is scheduled and no new socket appears.
        ws.emitClose();
        jest.advanceTimersByTime(10000);
        expect(jest.getTimerCount()).toBe(0);
        expect(MockWebSocket.instances).toHaveLength(1);
    });
});

// ===========================================================================
describe('events bridge — reference counting across keys/listeners (F-AAP-04)', () => {
    it('keeps the socket open while any key still has a listener; closes only when all are gone', () => {
        const unUs = subscribe('changes.project.9.userstories', jest.fn());
        const unMs = subscribe('changes.project.9.milestones', jest.fn());

        // Two keys multiplex over a single socket.
        expect(MockWebSocket.instances).toHaveLength(1);
        const ws = latestSocket();
        ws.emitOpen();

        // Dropping one key must not close the socket.
        unUs();
        expect(ws.closeCalls).toBe(0);
        // The heartbeat interval is still running (plus a deferred unsubscribe
        // microtask now sits in the fake-timer queue), so the count is > 0.
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Dropping the last key tears everything down.
        unMs();
        expect(ws.closeCalls).toBe(1);

        // Flush the deferred microtasks: the userstories unsubscribe scheduled by
        // the first drop is suppressed (the socket is now closed), and no timers
        // survive the teardown (M-09 + F-AAP-04).
        jest.runAllTicks();
        expect(sentCmds(ws)).not.toContain('unsubscribe');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the socket open until BOTH listeners on the same key unsubscribe, then closes WITHOUT an unsubscribe frame (M-09)', () => {
        const un1 = subscribe('changes.project.3.userstories', jest.fn());
        const un2 = subscribe('changes.project.3.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();

        // First listener leaving does not empty the key → no teardown, no frame.
        un1();
        jest.runAllTicks();
        expect(ws.closeCalls).toBe(0);
        expect(sentCmds(ws)).not.toContain('unsubscribe');

        // Second (last) listener leaving empties the only key → the socket is
        // closed directly. M-09: NO `unsubscribe` frame precedes the close.
        un2();
        jest.runAllTicks();
        expect(sentCmds(ws)).not.toContain('unsubscribe');
        expect(ws.closeCalls).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('subscribeProjectChanges tears down all three subscriptions by closing the socket, emitting NO unsubscribe frames (M-09 multi-key teardown)', () => {
        const unsubscribe = subscribeProjectChanges(42, {
            onUserstories: jest.fn(),
            onMilestones: jest.fn(),
            onProjects: jest.fn(),
        });

        expect(MockWebSocket.instances).toHaveLength(1);
        const ws = latestSocket();
        ws.emitOpen();

        // Three routing keys were subscribed over the single socket.
        const subscribeCount = sentCmds(ws).filter((c) => c === 'subscribe').length;
        expect(subscribeCount).toBe(3);

        unsubscribe();
        // This is the exact real-world teardown that crashed taiga-events: all
        // three keys (userstories / milestones / projects) leave together. The
        // third removal closes the socket synchronously BEFORE any deferred
        // per-key frame runs, so every `unsubscribe` is suppressed — the wire
        // shows a clean close, never `unsubscribe…unsubscribe…close` (M-09).
        // Flush microtasks to prove the suppression is real, not merely pending.
        jest.runAllTicks();
        expect(sentCmds(ws)).not.toContain('unsubscribe');
        expect(ws.closeCalls).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
    });
});

// ===========================================================================
// M-09 (Integration / Availability): the unsubscribe-frame-then-close temporal
// pattern crashes the external taiga-events service ("Channel ended, no reply
// will be forthcoming"). These tests lock in the two-part client-side fix:
//   (a) a key that empties while OTHER keys keep the socket open still emits an
//       `unsubscribe` frame — DEFERRED to a microtask, socket-open gated;
//   (b) a multi-key teardown that ends by closing the socket suppresses every
//       deferred frame, so the wire never shows unsubscribe-then-close;
//   (c) an unsub→resub race on the same key suppresses the stale frame.
describe('events bridge — M-09 unsubscribe-frame safety on teardown', () => {
    it('emits a deferred unsubscribe frame for a key that empties while OTHER keys keep the socket open', () => {
        const unUs = subscribe('changes.project.9.userstories', jest.fn());
        subscribe('changes.project.9.milestones', jest.fn()); // keeps the socket open
        const ws = latestSocket();
        ws.emitOpen();

        // Dropping ONE key while another remains: the frame is DEFERRED, so it is
        // NOT on the wire synchronously.
        unUs();
        expect(sentCmds(ws)).not.toContain('unsubscribe');

        // Once the microtask runs — and because the socket is still OPEN (the
        // milestones listener remains) — the frame goes out exactly once.
        jest.runAllTicks();
        const unsub = sentFrames(ws).filter((f) => f.cmd === 'unsubscribe');
        expect(unsub).toHaveLength(1);
        expect(unsub[0]).toEqual({ cmd: 'unsubscribe', routing_key: 'changes.project.9.userstories' });

        // The socket must NOT close (milestones is still subscribed).
        expect(ws.closeCalls).toBe(0);
    });

    it('suppresses a deferred unsubscribe frame when a synchronous multi-key teardown closes the socket first', () => {
        // Two keys dropped back-to-back: the second drop is the last listener and
        // closes the socket synchronously, so the first key's deferred frame must
        // be suppressed (this is the exact crash sequence the fix prevents).
        const unUs = subscribe('changes.project.9.userstories', jest.fn());
        const unMs = subscribe('changes.project.9.milestones', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();

        unUs(); // schedules a deferred unsubscribe (socket still open at this point)
        unMs(); // last listener overall → closes the socket synchronously
        expect(ws.closeCalls).toBe(1);

        // Flushing the deferred microtask must produce NO unsubscribe (socket
        // already closed → isSocketOpen() false → suppressed).
        jest.runAllTicks();
        expect(sentCmds(ws)).not.toContain('unsubscribe');
    });

    it('suppresses a deferred unsubscribe frame when the key is re-subscribed before the microtask runs (unsub→resub race)', () => {
        const unUs = subscribe('changes.project.9.userstories', jest.fn());
        subscribe('changes.project.9.milestones', jest.fn()); // keeps the socket open
        const ws = latestSocket();
        ws.emitOpen();

        unUs(); // schedules a deferred unsubscribe for userstories
        // Re-subscribe the SAME key before the microtask runs.
        subscribe('changes.project.9.userstories', jest.fn());
        jest.runAllTicks();

        // The stale deferred unsubscribe must be suppressed — the key is live
        // again, so unsubscribing it would wrongly cancel the new subscription.
        expect(sentCmds(ws)).not.toContain('unsubscribe');
        expect(ws.closeCalls).toBe(0);
    });

    it('unsubscribe remains idempotent and safe to call repeatedly after teardown', () => {
        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();

        unsubscribe();
        expect(ws.closeCalls).toBe(1);

        // Calling the same unsubscribe again is a no-op: no throw, no second
        // close, no stray frame.
        expect(() => unsubscribe()).not.toThrow();
        jest.runAllTicks();
        expect(ws.closeCalls).toBe(1);
        expect(sentCmds(ws)).not.toContain('unsubscribe');
    });
});

// ===========================================================================
describe('events bridge — reconnect + resubscribe (F-AAP-04)', () => {
    it('reopens a fresh socket after a socket error while still subscribed', () => {
        subscribe('changes.project.42.userstories', jest.fn());
        const first = latestSocket();
        first.emitOpen();

        first.emitError(); // schedules a reconnect
        jest.advanceTimersByTime(1000); // fire it (delay ∈ [500,1000])

        // A brand-new socket was created; open it and confirm it re-auths.
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
        const second = latestSocket();
        expect(second).not.toBe(first);
        second.emitOpen();
        expect(sentCmds(second)).toContain('auth');
    });

    it('coalesces multiple errors into a single pending reconnect', () => {
        subscribe('changes.project.42.userstories', jest.fn());
        const first = latestSocket();
        first.emitOpen();

        first.emitError();
        first.emitError();
        first.emitError();

        // Only ONE reconnect fires: exactly one additional socket is created,
        // not three.
        jest.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('a fresh subscribe after full teardown opens a NEW socket (lazy-connect latch reset)', () => {
        const un1 = subscribe('changes.project.42.userstories', jest.fn());
        latestSocket().emitOpen();
        un1(); // full teardown

        expect(MockWebSocket.instances).toHaveLength(1);

        // Subscribing again must connect afresh rather than silently no-op.
        const un2 = subscribe('changes.project.42.userstories', jest.fn());
        expect(MockWebSocket.instances).toHaveLength(2);

        const second = latestSocket();
        second.emitOpen();
        expect(sentCmds(second)).toEqual(['auth', 'subscribe']);

        un2();
        expect(second.closeCalls).toBe(1);
    });

    it('repeated subscribe/error/unsubscribe cycles leave no live socket and no pending timers', () => {
        for (let i = 0; i < 3; i += 1) {
            const unsubscribe = subscribe(`changes.project.${i}.userstories`, jest.fn());
            const ws = latestSocket();
            ws.emitOpen();
            ws.emitError(); // schedule a reconnect each cycle
            unsubscribe(); // …which teardown must cancel
            expect(ws.closeCalls).toBe(1);
        }

        // One socket per cycle, all closed, nothing scheduled.
        expect(MockWebSocket.instances).toHaveLength(3);
        expect(jest.getTimerCount()).toBe(0);

        // No zombie reconnect fires afterwards.
        jest.advanceTimersByTime(10000);
        expect(MockWebSocket.instances).toHaveLength(3);
    });
});

// ===========================================================================
describe('events bridge — real connection state (F-AAP-03)', () => {
    it('reports false before connect, true only while the socket is open, false after close and teardown', () => {
        // No subscription yet → bridge not created → not connected.
        expect(isEventsConnected()).toBe(false);

        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        // Socket is CONNECTING, not yet open.
        expect(isEventsConnected()).toBe(false);

        const ws = latestSocket();
        ws.emitOpen();
        expect(isEventsConnected()).toBe(true);

        // A close flips the connection flag to disconnected.
        ws.emitClose();
        expect(isEventsConnected()).toBe(false);

        // Full teardown → still not connected.
        unsubscribe();
        expect(isEventsConnected()).toBe(false);
    });

    it('reports disconnected after a dropped connection (error then close)', () => {
        subscribe('changes.project.9.userstories', jest.fn());
        const ws = latestSocket();
        ws.emitOpen();
        expect(isEventsConnected()).toBe(true);

        // A real socket drop surfaces as an error immediately followed by close;
        // `connected` flips on the close (onError alone does not, matching the
        // source where the close always follows).
        ws.emitError();
        ws.emitClose();
        expect(isEventsConnected()).toBe(false);
    });
});

// ===========================================================================
describe('events bridge — disabled when events are off', () => {
    it('subscribe is a no-op (no socket) and returns a callable unsubscribe when eventsUrl is absent', () => {
        sessionMock.getEventsUrl.mockReturnValue(null);

        const unsubscribe = subscribe('changes.project.42.userstories', jest.fn());
        expect(MockWebSocket.instances).toHaveLength(0);
        expect(typeof unsubscribe).toBe('function');
        expect(() => unsubscribe()).not.toThrow();
    });

    it('subscribeProjectChanges is a no-op (no socket) when eventsUrl is absent', () => {
        sessionMock.getEventsUrl.mockReturnValue(null);

        const unsubscribe = subscribeProjectChanges(42, { onUserstories: jest.fn() });
        expect(MockWebSocket.instances).toHaveLength(0);
        expect(() => unsubscribe()).not.toThrow();
    });
});
