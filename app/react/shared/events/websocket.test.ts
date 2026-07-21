/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Focused Jest unit suite for the React real-time events client (AAP §0.4.1
// websocket + §0.6.1 shared-session identity). It is a faithful port of the
// AngularJS `events.coffee` EventsService, so the assertions below pin the
// frozen wire contract:
//   • auth frame  {cmd:"auth", data:{token, sessionId}}     — events.coffee L243
//   • subscribe   {cmd:"subscribe", routing_key, options?}  — events.coffee L205-212
//   • unsubscribe {cmd:"unsubscribe", routing_key}
//   • ping/pong heartbeat + reconnect backoff [interval/2, interval]
//   • reconnect stops after eventsMaxConnectionErrors (default 5) errors
//
// A deterministic `MockWebSocket` (installed as `globalThis.WebSocket`) plus
// Jest fake timers make the socket lifecycle fully observable without any real
// network, mirroring the QA's "real ws server + fake-timer MockWS" harness.

// The events client is a module-level SHARED singleton (one socket per document,
// mirroring the single AngularJS EventsService — AAP §0.6.1, QA C02). To keep
// every test fully isolated, the module registry is reset in beforeEach and a
// FRESH copy of the module (with a new, un-connected singleton) is re-required
// per test; a static top-level import would leak socket/subscription state.
import type { EventsClient } from "./websocket";

let createEventsClient: typeof import("./websocket").createEventsClient;

const TOKEN = "jwt-token-abc";
const SESSION_ID = "shared-session-42";
const HEARTBEAT_MS = 1000;
const MAX_MISSED = 3;

interface FakeEvent {
    data?: unknown;
}
type Listener = (event: FakeEvent) => void;

/**
 * Minimal deterministic WebSocket double. Records every frame `send()`, exposes
 * helpers to simulate the server side (`emitOpen`/`emitMessage`/`emitError`/
 * `emitClose`), and tracks every constructed instance so reconnects are visible.
 */
class MockWebSocket {
    static instances: MockWebSocket[] = [];

    static reset(): void {
        MockWebSocket.instances = [];
    }

    static get latest(): MockWebSocket {
        return MockWebSocket.instances[MockWebSocket.instances.length - 1];
    }

    // Faithful readyState contract (mirrors the WHATWG WebSocket constants) so the
    // client's idempotent-reuse check (`readyState === OPEN | CONNECTING`) is
    // genuinely exercised rather than accidentally satisfied by `undefined ===
    // undefined`. C-02: the shared singleton reuses an already-open/connecting
    // socket instead of tearing it down on a second board's connect().
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    public readonly url: string;
    public closed = false;
    public readyState: number = MockWebSocket.CONNECTING;
    public readonly sent: string[] = [];
    private readonly listeners: Record<string, Listener[]> = {};

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, cb: Listener): void {
        (this.listeners[type] ??= []).push(cb);
    }

    removeEventListener(type: string, cb: Listener): void {
        this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
        this.readyState = MockWebSocket.CLOSED;
    }

    // ---- server-side simulation helpers ----
    emitOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.dispatch("open", {});
    }

    emitMessage(payload: unknown): void {
        const data = typeof payload === "string" ? payload : JSON.stringify(payload);
        this.dispatch("message", { data });
    }

    emitError(): void {
        this.dispatch("error", {});
    }

    emitClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatch("close", {});
    }

    private dispatch(type: string, event: FakeEvent): void {
        for (const cb of (this.listeners[type] ?? []).slice()) {
            cb(event);
        }
    }

    /** Parsed view of the frames this socket transmitted. */
    get frames(): Array<Record<string, unknown>> {
        return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    }

    /** Frames of a given command (e.g. "ping", "subscribe"). */
    framesOfCmd(cmd: string): Array<Record<string, unknown>> {
        return this.frames.filter((frame) => frame.cmd === cmd);
    }
}

let client: EventsClient;
let originalWebSocket: unknown;

beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.reset();

    originalWebSocket = (globalThis as unknown as { WebSocket: unknown }).WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

    window.taigaConfig = {
        api: "http://localhost:8000/api/v1/",
        eventsUrl: "ws://events.test/eventstream",
        eventsMaxMissedHeartbeats: MAX_MISSED,
        eventsHeartbeatIntervalTime: HEARTBEAT_MS,
    };
    window.localStorage.setItem("token", JSON.stringify(TOKEN));
    (window as unknown as { taiga?: { sessionId?: string } }).taiga = { sessionId: SESSION_ID };

    // Reset the module registry so the module-level shared singleton is recreated
    // fresh (un-connected, no retained subscriptions) for each test — otherwise
    // the singleton would leak socket / subscription state across tests.
    jest.resetModules();
    ({ createEventsClient } = require("./websocket") as typeof import("./websocket"));

    client = createEventsClient();
});

afterEach(() => {
    client.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    window.localStorage.clear();
    delete (window as unknown as { taiga?: unknown }).taiga;
    window.taigaConfig = undefined;
    jest.restoreAllMocks();
});

describe("shared/events/websocket", () => {
    describe("URL resolution", () => {
        it("opens no socket when the events URL is not configured (events disabled)", () => {
            window.taigaConfig = { eventsUrl: null };
            client.connect();
            expect(MockWebSocket.instances).toHaveLength(0);
        });

        it("opens no socket when events URL is an empty string", () => {
            window.taigaConfig = { eventsUrl: "" };
            client.connect();
            expect(MockWebSocket.instances).toHaveLength(0);
        });

        it("passes an absolute ws:// URL through unchanged", () => {
            window.taigaConfig = { eventsUrl: "ws://abs.test/stream" };
            client.connect();
            expect(MockWebSocket.latest.url).toBe("ws://abs.test/stream");
        });

        it("passes an absolute wss:// URL through unchanged", () => {
            window.taigaConfig = { eventsUrl: "wss://abs.test/stream" };
            client.connect();
            expect(MockWebSocket.latest.url).toBe("wss://abs.test/stream");
        });

        it("resolves a relative URL to ws:// on an http page", () => {
            window.taigaConfig = { eventsUrl: "/eventstream" };
            client.connect();
            expect(MockWebSocket.latest.url).toBe("ws://localhost/eventstream");
        });

        it("resolves a relative URL to wss:// on an https page", () => {
            jest.spyOn(window, "location", "get").mockReturnValue({
                protocol: "https:",
                host: "secure.test",
            } as Location);
            window.taigaConfig = { eventsUrl: "/eventstream" };
            client.connect();
            expect(MockWebSocket.latest.url).toBe("wss://secure.test/eventstream");
        });

        it("does not throw and opens no socket when WebSocket is unavailable", () => {
            (globalThis as unknown as { WebSocket: unknown }).WebSocket = undefined;
            expect(() => client.connect()).not.toThrow();
            expect(MockWebSocket.instances).toHaveLength(0);
        });
    });

    describe("authentication on open", () => {
        it("sends the auth frame first, reusing the shared token and session id verbatim", () => {
            client.connect();
            MockWebSocket.latest.emitOpen();

            const first = MockWebSocket.latest.frames[0];
            expect(first).toEqual({
                cmd: "auth",
                data: { token: TOKEN, sessionId: SESSION_ID },
            });
        });

        it("flushes auth BEFORE a subscription requested before open (QA F1)", () => {
            client.connect();
            client.subscribe("changes.project.1.userstories", jest.fn());
            MockWebSocket.latest.emitOpen();

            // The taiga-events backend authenticates the socket on `auth` and
            // drops any `subscribe` received before it. A subscription requested
            // while the socket was still connecting must therefore be (re)sent
            // AFTER auth from the retained subscriptions map — never queued ahead
            // of auth (the pre-fix order was the buggy `[subscribe, auth]`).
            const cmds = MockWebSocket.latest.frames.map((frame) => frame.cmd);
            expect(cmds).toEqual(["auth", "subscribe"]);
        });

        it("re-subscribes every retained routing key after auth on reconnect (QA F3)", () => {
            // Deterministic lower-bound (5000ms) reconnect backoff.
            jest.spyOn(Math, "random").mockReturnValue(0);

            client.connect();
            client.subscribe("changes.project.1.userstories", jest.fn());
            client.subscribe("changes.project.1.projects", jest.fn());
            MockWebSocket.latest.emitOpen();

            // Initial connection: auth precedes both subscribe frames.
            expect(MockWebSocket.latest.frames.map((f) => f.cmd)).toEqual([
                "auth",
                "subscribe",
                "subscribe",
            ]);

            // Transient network drop → bounded reconnect creates a fresh socket.
            MockWebSocket.latest.emitClose();
            jest.advanceTimersByTime(5000);
            expect(MockWebSocket.instances).toHaveLength(2);

            // The reconnected socket re-authenticates AND replays BOTH retained
            // subscriptions (in insertion order) so real-time updates resume
            // without the React screen having to remount — auth still first.
            MockWebSocket.latest.emitOpen();
            expect(MockWebSocket.latest.frames.map((f) => f.cmd)).toEqual([
                "auth",
                "subscribe",
                "subscribe",
            ]);
            expect(
                MockWebSocket.latest.framesOfCmd("subscribe").map((f) => f.routing_key),
            ).toEqual([
                "changes.project.1.userstories",
                "changes.project.1.projects",
            ]);
        });
    });

    describe("subscribe / unsubscribe frames", () => {
        beforeEach(() => {
            client.connect();
            MockWebSocket.latest.emitOpen();
        });

        it("emits a subscribe frame with the routing key and no options", () => {
            client.subscribe("changes.project.7.userstories", jest.fn());
            const frame = MockWebSocket.latest.framesOfCmd("subscribe").pop();
            expect(frame).toEqual({
                cmd: "subscribe",
                routing_key: "changes.project.7.userstories",
            });
        });

        it("forwards per-subscription options (e.g. selfNotification) verbatim", () => {
            client.subscribe("changes.project.7.milestones", jest.fn(), {
                selfNotification: true,
            });
            const frame = MockWebSocket.latest.framesOfCmd("subscribe").pop();
            expect(frame).toEqual({
                cmd: "subscribe",
                routing_key: "changes.project.7.milestones",
                options: { selfNotification: true },
            });
        });

        it("emits an unsubscribe frame for the routing key", () => {
            client.subscribe("changes.project.7.projects", jest.fn());
            client.unsubscribe("changes.project.7.projects");
            const frame = MockWebSocket.latest.framesOfCmd("unsubscribe").pop();
            expect(frame).toEqual({
                cmd: "unsubscribe",
                routing_key: "changes.project.7.projects",
            });
        });
    });

    describe("message routing", () => {
        beforeEach(() => {
            client.connect();
            MockWebSocket.latest.emitOpen();
        });

        it("routes a change message to the exact-key callback with its data payload", () => {
            const usCallback = jest.fn();
            const msCallback = jest.fn();
            client.subscribe("changes.project.1.userstories", usCallback);
            client.subscribe("changes.project.1.milestones", msCallback);

            MockWebSocket.latest.emitMessage({
                routing_key: "changes.project.1.userstories",
                data: { id: 99 },
            });

            expect(usCallback).toHaveBeenCalledTimes(1);
            expect(usCallback).toHaveBeenCalledWith({ id: 99 });
            expect(msCallback).not.toHaveBeenCalled();
        });

        it("ignores a message whose routing key has no subscription", () => {
            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);

            expect(() =>
                MockWebSocket.latest.emitMessage({
                    routing_key: "changes.project.999.userstories",
                    data: {},
                }),
            ).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
        });

        it("ignores a message that has no routing key", () => {
            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);

            expect(() => MockWebSocket.latest.emitMessage({ data: { x: 1 } })).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
        });

        it("ignores a malformed (non-JSON) frame without throwing", () => {
            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);

            expect(() => MockWebSocket.latest.emitMessage("this-is-not-json{")).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
        });

        it("does not fan out to a duplicate subscription of the same routing key", () => {
            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);
            client.subscribe("changes.project.1.userstories", callback);

            MockWebSocket.latest.emitMessage({
                routing_key: "changes.project.1.userstories",
                data: { id: 1 },
            });

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe("heartbeat (ping / pong)", () => {
        it("sends a PING frame every heartbeat interval", () => {
            client.connect();
            MockWebSocket.latest.emitOpen();

            jest.advanceTimersByTime(HEARTBEAT_MS);

            expect(MockWebSocket.latest.framesOfCmd("ping")).toHaveLength(1);
        });

        it("reconnects after the max missed heartbeats is reached", () => {
            client.connect();
            MockWebSocket.latest.emitOpen();
            expect(MockWebSocket.instances).toHaveLength(1);

            // MAX_MISSED increments, then the next tick triggers a full reconnect.
            jest.advanceTimersByTime(HEARTBEAT_MS * (MAX_MISSED + 1));

            expect(MockWebSocket.instances.length).toBeGreaterThan(1);
        });

        it("resets the missed-heartbeat counter when a pong is received", () => {
            client.connect();
            MockWebSocket.latest.emitOpen();

            jest.advanceTimersByTime(HEARTBEAT_MS * 2); // missed = 2
            MockWebSocket.latest.emitMessage({ cmd: "pong" }); // missed -> 0
            jest.advanceTimersByTime(HEARTBEAT_MS * 2); // missed = 2 again, still < MAX

            // Never crossed the reconnect threshold, so still the single socket.
            expect(MockWebSocket.instances).toHaveLength(1);
            expect(MockWebSocket.latest.framesOfCmd("ping").length).toBe(4);
        });
    });

    describe("reconnection backoff", () => {
        it("reconnects after a transient close within the lower backoff bound (5000ms)", () => {
            jest.spyOn(Math, "random").mockReturnValue(0);
            client.connect();
            MockWebSocket.latest.emitOpen();
            MockWebSocket.latest.emitClose();

            jest.advanceTimersByTime(4999);
            expect(MockWebSocket.instances).toHaveLength(1);

            jest.advanceTimersByTime(1);
            expect(MockWebSocket.instances).toHaveLength(2);
        });

        it("reconnects at the upper backoff bound (10000ms) when random is maximal", () => {
            jest.spyOn(Math, "random").mockReturnValue(0.999999);
            client.connect();
            MockWebSocket.latest.emitOpen();
            MockWebSocket.latest.emitClose();

            jest.advanceTimersByTime(9999);
            expect(MockWebSocket.instances).toHaveLength(1);

            jest.advanceTimersByTime(1);
            expect(MockWebSocket.instances).toHaveLength(2);
        });

        it("stops scheduling reconnects once the connection-error cap (5) is reached", () => {
            jest.spyOn(Math, "random").mockReturnValue(0.5); // 7500ms per attempt

            // Drive errors during CONNECTING (no open) so the heartbeat never
            // starts and cannot interfere with the pure error-path reconnect count.
            client.connect();

            // Errors 1..4 each schedule a reconnect (a fresh socket); the 5th
            // error hits the cap and must NOT schedule another reconnect.
            for (let i = 0; i < 5; i += 1) {
                MockWebSocket.latest.emitError();
                jest.advanceTimersByTime(10000);
            }

            const afterFiveErrors = MockWebSocket.instances.length;

            // Any further time advance must create no additional socket.
            jest.advanceTimersByTime(10000);
            expect(MockWebSocket.instances.length).toBe(afterFiveErrors);
            // initial + exactly four reconnects (errors 1..4 reconnect, 5th is capped).
            expect(afterFiveErrors).toBe(5);
        });
    });

    describe("guarded no-ops after an error", () => {
        it("does not emit a subscribe frame or register a callback while in an error state", () => {
            jest.spyOn(Math, "random").mockReturnValue(0.5);
            client.connect();
            MockWebSocket.latest.emitOpen();
            const socket = MockWebSocket.latest;

            socket.emitError(); // sets the internal error flag

            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);

            // No subscribe frame was queued on the errored socket...
            expect(socket.framesOfCmd("subscribe")).toHaveLength(0);
            // ...and a later routed message must not reach the (unregistered) callback.
            socket.emitMessage({ routing_key: "changes.project.1.userstories", data: {} });
            expect(callback).not.toHaveBeenCalled();
        });

        it("does not emit an unsubscribe frame while in an error state", () => {
            jest.spyOn(Math, "random").mockReturnValue(0.5);
            client.connect();
            MockWebSocket.latest.emitOpen();
            const socket = MockWebSocket.latest;

            socket.emitError(); // sets the internal error flag
            client.unsubscribe("changes.project.1.userstories");

            expect(socket.framesOfCmd("unsubscribe")).toHaveLength(0);
        });
    });

    describe("disconnect (per-board unmount) — shared session socket", () => {
        // C-02: a board unmount must NOT close the shared socket. Closing it on
        // navigation, while routing-key bindings are still live, is exactly what
        // crashed the frozen taiga-events service (unhandled AMQP channel
        // rejection, RestartPolicy=no). This mirrors AngularJS events.coffee,
        // where a scope $destroy only unsubscribes and never closes the socket.
        it("does NOT close the shared socket on unmount (leaves the session socket open)", () => {
            client.connect();
            const socket = MockWebSocket.latest;
            socket.emitOpen();

            client.disconnect();

            expect(socket.closed).toBe(false);
            expect(socket.readyState).toBe(MockWebSocket.OPEN);
            expect(MockWebSocket.instances).toHaveLength(1);
        });

        it("keeps the heartbeat running after unmount (session-long socket, matching AngularJS)", () => {
            client.connect();
            const socket = MockWebSocket.latest;
            socket.emitOpen();

            const pingsAtDisconnect = socket.framesOfCmd("ping").length;
            client.disconnect();
            jest.advanceTimersByTime(HEARTBEAT_MS * 2);

            // The socket persists, so heartbeats continue and no reconnect churns
            // a new socket.
            expect(socket.framesOfCmd("ping").length).toBeGreaterThan(
                pingsAtDisconnect,
            );
            expect(MockWebSocket.instances).toHaveLength(1);
        });

        it("reuses the SAME shared socket on a re-mount instead of opening a new one", () => {
            client.connect();
            const first = MockWebSocket.latest;
            first.emitOpen();

            // Unmount (disconnect) then re-mount (connect) — e.g. navigating away
            // from and back to a board, or the other board mounting. The singleton
            // must reuse the still-open socket, never tear it down and reopen.
            client.disconnect();
            client.connect();

            expect(MockWebSocket.instances).toHaveLength(1);
            expect(MockWebSocket.latest).toBe(first);
            expect(first.closed).toBe(false);
        });

        it("still delivers events to a retained subscription after a disconnect (socket persists)", () => {
            client.connect();
            const socket = MockWebSocket.latest;
            socket.emitOpen();

            const callback = jest.fn();
            client.subscribe("changes.project.1.userstories", callback);

            // A per-board disconnect that does NOT unsubscribe leaves the binding
            // intact on the persistent shared socket (callers unsubscribe their own
            // keys; disconnect alone never closes and never drops subscriptions).
            client.disconnect();
            socket.emitMessage({
                routing_key: "changes.project.1.userstories",
                data: { id: 7 },
            });

            expect(callback).toHaveBeenCalledWith({ id: 7 });
        });
    });

    describe("shared singleton accessor", () => {
        it("exposes the documented client surface", () => {
            const created = createEventsClient();
            expect(typeof created.connect).toBe("function");
            expect(typeof created.subscribe).toBe("function");
            expect(typeof created.unsubscribe).toBe("function");
            expect(typeof created.disconnect).toBe("function");
        });

        it("returns the SAME shared instance on every call (one socket per document — AAP §0.6.1, C-02)", () => {
            const a = createEventsClient();
            const b = createEventsClient();
            expect(a).toBe(b);
        });
    });
});
