/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest test suite for the framework-agnostic WebSocket subscription helper
 * (`./events.ts`).
 *
 * This co-located suite is the executable proof that the migrated real-time
 * client reproduces the legacy AngularJS `EventsService`
 * (`app/coffee/modules/events.coffee`) protocol and timing *over the wire*:
 * the auth-first handshake, the subscribe/unsubscribe framing, the
 * ping/pong heartbeat, the missed-heartbeat and close/error reconnect paths,
 * and the three FROZEN per-project routing keys (constraint C-1).
 *
 * File-extension note: the file is intentionally named `.test.tsx` (NOT
 * `.test.ts`) even though it contains no JSX. The root `jest.config.js`
 * scopes `testMatch` to `<rootDir>/app/react/**\/*.test.tsx` and excludes the
 * same glob from the coverage denominator, so a `.test.ts` file would neither
 * be run nor be excluded from coverage — either way breaking the >= 70% gate.
 *
 * Environment notes:
 * - jsdom does NOT provide a `WebSocket` global, so a deterministic
 *   {@link MockWebSocket} is installed on `globalThis` for each test.
 * - jsdom's default document origin is `http://localhost/`, which makes
 *   `window.location.protocol === "http:"` and `window.location.host ===
 *   "localhost"` — relied upon by the relative-URL resolution test.
 * - Jest fake timers drive the heartbeat interval and reconnect timeouts;
 *   `Math.random` is stubbed to 0 so the randomised reconnect back-off
 *   (`randomTryInterval()`) is deterministic (=> 5000 ms).
 *
 * The suite imports ONLY the module under test (`./events`) and the
 * type-only `MountContext` (`../types`); it pulls in no AngularJS, no React,
 * and no stylesheet, and performs no real network I/O.
 */
import {
  createEventsClient,
  subscribeToProject,
  HEARTBEAT_INTERVAL_TIME,
  MAX_MISSED_HEARTBEATS,
  RECONNECT_TRY_INTERVAL,
  MAX_INBOUND_FRAME_LENGTH,
  MAX_MALFORMED_FRAME_LOGS,
} from "./events";
import type { MountContext } from "../types";

/**
 * Minimal listener signature accepted by {@link MockWebSocket}. The only
 * inbound event whose payload is inspected by `events.ts` is `"message"`,
 * whose handler reads `event.data`; the `open`/`close`/`error` handlers ignore
 * their argument, so a single loose shape covers every registered listener.
 */
type WsListener = (event: { data?: string }) => void;

/**
 * Deterministic, synchronous stand-in for the browser `WebSocket`.
 *
 * It records every constructed instance (so a test can assert how many
 * sockets were opened across reconnects), every serialised frame passed to
 * `send()` (so a test can decode and assert the on-the-wire protocol), and a
 * `closed` flag (so a test can prove intentional shutdown). The `emit()`
 * helper synchronously invokes the listeners `events.ts` registered via
 * `addEventListener`, letting a test simulate `open`/`message`/`error`/`close`
 * without any asynchronous transport.
 *
 * ES2019 note: no ES2021 logical-assignment (`||=`) is used — the listener
 * bucket is initialised with an explicit `if (!...)` guard.
 */
class MockWebSocket {
  /** Every socket ever constructed in the current test (reset in `beforeEach`). */
  static instances: MockWebSocket[] = [];

  /** The resolved URL the client opened this socket with. */
  url: string;
  /** Raw JSON frames handed to `send()`, in order. */
  sent: string[] = [];
  /** Set by `close()`; proves an intentional teardown occurred. */
  closed = false;

  private listeners: Record<string, WsListener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: WsListener): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: WsListener): void {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /**
   * Synchronously fire the registered listeners for `type`. A copy of the
   * bucket is iterated so a listener that mutates the registration (e.g. the
   * reconnect path removing listeners) cannot corrupt the in-flight loop.
   */
  emit(type: string, event?: { data?: string }): void {
    (this.listeners[type] || []).slice().forEach((fn) => fn(event || {}));
  }
}

/** Decode every JSON frame a socket has sent into plain objects for assertions. */
function framesOf(ws: MockWebSocket): Array<Record<string, unknown>> {
  return ws.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

/** The most recently constructed socket (the one the client is currently using). */
function latest(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

/**
 * Set (or clear) `window.taigaConfig`, the global fallback source that
 * `resolveConfiguredEventsUrl` consults when `MountContext.eventsUrl` is
 * falsy. The double cast is required because `taigaConfig` is not part of the
 * standard `Window` type.
 */
function setTaigaConfig(cfg: { eventsUrl: string | null } | undefined): void {
  (window as unknown as { taigaConfig?: { eventsUrl: string | null } }).taigaConfig = cfg;
}

/** Build a fully-populated {@link MountContext}, overriding only what a test needs. */
function makeContext(overrides: Partial<MountContext> = {}): MountContext {
  return {
    projectSlug: "proj-1",
    token: "jwt-abc",
    sessionId: "sess-1",
    apiUrl: "http://localhost:9000/api/v1/",
    eventsUrl: "ws://localhost:8888/events",
    language: "en",
    ...overrides,
  };
}

/**
 * Convenience: create a client, open its connection, and drive the socket to
 * the connected/`open` state. Returns the client so a test can continue to
 * drive it. Callers that need the socket use {@link latest}.
 */
function connectClient(
  overrides: Partial<MountContext> = {},
): ReturnType<typeof createEventsClient> {
  const client = createEventsClient(makeContext(overrides));
  client.setupConnection();
  latest().emit("open");
  return client;
}

// Preserve whatever (possibly undefined) `WebSocket` global jsdom provided so
// it can be restored after the whole suite runs.
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  jest.useFakeTimers();
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  setTaigaConfig({ eventsUrl: null });
  // Finding C4: localStorage is the AUTHORITATIVE credential store consulted
  // live on every (re)connect. In production the mount snapshot
  // (`context.token`) is itself read FROM localStorage at mount, so a connected
  // socket's auth frame carries the stored token. Seed it to mirror the default
  // context token ("jwt-abc") so the protocol-framing tests represent a real
  // logged-in session; the "live token auth" describe below clears and drives
  // the store itself to exercise refresh / logged-out paths.
  localStorage.clear();
  localStorage.setItem("token", JSON.stringify("jwt-abc"));
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

describe("createEventsClient — connection setup", () => {
  it("does not open a socket when the resolved events URL is falsy", () => {
    // Neither the context nor the global config supplies a URL => events are
    // disabled (a no-op connection), exactly as the legacy service behaved.
    setTaigaConfig({ eventsUrl: null });
    const client = createEventsClient(makeContext({ eventsUrl: null }));

    client.setupConnection();

    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.isConnected()).toBe(false);
  });

  it("falls back to window.taigaConfig.eventsUrl when the context URL is absent", () => {
    setTaigaConfig({ eventsUrl: "ws://cfg-host/events" });
    const client = createEventsClient(makeContext({ eventsUrl: null }));

    client.setupConnection();

    expect(latest().url).toBe("ws://cfg-host/events");
  });

  it("uses an absolute ws:// url unchanged", () => {
    const client = createEventsClient(makeContext({ eventsUrl: "ws://abs-host/events" }));

    client.setupConnection();

    expect(latest().url).toBe("ws://abs-host/events");
  });

  it("resolves a relative url against window.location (http => ws)", () => {
    // jsdom's default origin is http://localhost/, so the scheme ternary picks
    // "ws:" and the leading slash is trimmed before the host is prepended. The
    // https => wss branch is the same statement line and is line-covered here.
    const client = createEventsClient(makeContext({ eventsUrl: "/events" }));

    client.setupConnection();

    expect(latest().url).toBe("ws://localhost/events");
  });

  it("treats stop() before connect as a safe no-op", () => {
    // Exercises the `if (!ws) return;` guard in stopExistingConnection.
    const client = createEventsClient(makeContext());

    expect(() => client.stop()).not.toThrow();
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("toggles isConnected() on open and close", () => {
    const client = createEventsClient(makeContext());

    client.setupConnection();
    expect(client.isConnected()).toBe(false);

    latest().emit("open");
    expect(client.isConnected()).toBe(true);

    latest().emit("close");
    expect(client.isConnected()).toBe(false);
  });
});

describe("createEventsClient — protocol framing", () => {
  it("sends auth as the first frame on open, followed by stored subscriptions", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();

    // Subscribing before the socket is open only stores the key in the map;
    // no frame may hit the wire until the auth handshake has been sent.
    client.subscribe("changes.project.7.userstories", jest.fn());
    expect(latest().sent.length).toBe(0);

    latest().emit("open");

    const f = framesOf(latest());
    expect(f[0]).toEqual({ cmd: "auth", data: { token: "jwt-abc", sessionId: "sess-1" } });
    expect(f[1]).toEqual({ cmd: "subscribe", routing_key: "changes.project.7.userstories" });
    expect(f.length).toBe(2);
  });

  it("includes subscription options in the subscribe frame emitted on open", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();
    client.subscribe("k-opt", jest.fn(), { selfNotification: true });

    latest().emit("open");

    const frame = framesOf(latest()).find((m) => m.routing_key === "k-opt");
    expect(frame).toEqual({
      cmd: "subscribe",
      routing_key: "k-opt",
      options: { selfNotification: true },
    });
  });

  it("sends a subscribe frame immediately when subscribing while connected", () => {
    const client = connectClient();
    latest().sent = [];

    client.subscribe("k2", jest.fn());

    expect(framesOf(latest())).toContainEqual({ cmd: "subscribe", routing_key: "k2" });
  });

  it("dispatches an inbound message to the callback registered for its routing_key", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();
    const cb = jest.fn();
    client.subscribe("changes.project.7.userstories", cb);
    latest().emit("open");

    latest().emit("message", {
      data: JSON.stringify({ routing_key: "changes.project.7.userstories", data: { id: 42 } }),
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ id: 42 });
  });

  it("ignores a message whose routing_key has no subscription", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();
    const cb = jest.fn();
    client.subscribe("changes.project.7.userstories", cb);
    latest().emit("open");

    latest().emit("message", {
      data: JSON.stringify({ routing_key: "changes.project.7.unknown", data: {} }),
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores a message that carries no routing_key", () => {
    // Covers the early return at the top of dispatchMessage.
    const client = createEventsClient(makeContext());
    client.setupConnection();
    const cb = jest.fn();
    client.subscribe("changes.project.7.userstories", cb);
    latest().emit("open");

    expect(() =>
      latest().emit("message", { data: JSON.stringify({ cmd: "noop" }) }),
    ).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("sends an unsubscribe frame and drops the key from the map", () => {
    const client = connectClient();
    latest().sent = [];

    const cb = jest.fn();
    client.subscribe("k", cb);
    client.unsubscribe("k");

    expect(framesOf(latest())).toContainEqual({ cmd: "unsubscribe", routing_key: "k" });
  });
});


describe("createEventsClient — heartbeat & reconnect", () => {
  it("sends a ping frame on every heartbeat interval", () => {
    connectClient();
    const pingCount = (): number =>
      framesOf(latest()).filter((m) => m.cmd === "ping").length;

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME);
    expect(pingCount()).toBe(1);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME * 3);
    expect(pingCount()).toBe(4);
  });

  it("resets the missed-heartbeat counter on pong and keeps pinging", () => {
    const client = connectClient();
    const cb = jest.fn();
    client.subscribe("changes.project.7.userstories", cb);
    const socket = latest();
    const pingCount = (): number =>
      framesOf(socket).filter((m) => m.cmd === "ping").length;

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME);
    expect(pingCount()).toBe(1);

    // A pong is consumed by handleMessage (missed => 0) and never dispatched.
    socket.emit("message", { data: JSON.stringify({ cmd: "pong" }) });

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME);
    expect(pingCount()).toBe(2); // connection still alive, a 2nd ping was sent
    expect(MockWebSocket.instances.length).toBe(1); // no reconnect happened
    expect(cb).not.toHaveBeenCalled(); // pong is never routed to a subscriber
  });

  it("reconnects after MAX_MISSED_HEARTBEATS unanswered pings", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    connectClient();
    const socketA = latest();

    // Ticks 1..MAX each send a ping (missed climbs 0 -> MAX); the following
    // tick sees missed >= MAX, throws, and forces a reconnect via
    // setupConnection() (called directly from the heartbeat catch block).
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME * (MAX_MISSED_HEARTBEATS + 1));

    expect(MockWebSocket.instances.length).toBe(2);
    expect(socketA.closed).toBe(true);
    expect(framesOf(socketA).filter((m) => m.cmd === "ping").length).toBe(
      MAX_MISSED_HEARTBEATS,
    );
  });

  it("re-subscribes every stored key (with and without options) after a reconnect", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();
    client.subscribe("k1", jest.fn());
    client.subscribe("k2", jest.fn(), { selfNotification: true });
    latest().emit("open");

    const socketA = latest();
    expect(framesOf(socketA)).toEqual([
      { cmd: "auth", data: { token: "jwt-abc", sessionId: "sess-1" } },
      { cmd: "subscribe", routing_key: "k1" },
      { cmd: "subscribe", routing_key: "k2", options: { selfNotification: true } },
    ]);

    // Deterministic back-off, then a clean close schedules the reconnect.
    jest.spyOn(Math, "random").mockReturnValue(0);
    socketA.emit("close");
    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);
    expect(MockWebSocket.instances.length).toBe(2);

    const socketB = latest();
    socketB.emit("open");
    expect(framesOf(socketB)).toEqual([
      { cmd: "auth", data: { token: "jwt-abc", sessionId: "sess-1" } },
      { cmd: "subscribe", routing_key: "k1" },
      { cmd: "subscribe", routing_key: "k2", options: { selfNotification: true } },
    ]);
  });

  it("does not re-subscribe a key that was unsubscribed before the reconnect", () => {
    const client = createEventsClient(makeContext());
    client.setupConnection();
    client.subscribe("k", jest.fn());
    latest().emit("open");
    const socketA = latest();

    client.unsubscribe("k"); // drops "k" from the subscription map

    jest.spyOn(Math, "random").mockReturnValue(0);
    socketA.emit("close");
    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);

    const socketB = latest();
    socketB.emit("open");
    expect(framesOf(socketB)).toEqual([
      { cmd: "auth", data: { token: "jwt-abc", sessionId: "sess-1" } },
    ]);
  });
});


describe("createEventsClient — close/error handling", () => {
  it("schedules a reconnect after a clean close (no error)", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const client = connectClient();
    const socketA = latest();

    socketA.emit("close");
    expect(client.isConnected()).toBe(false);

    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("does not reconnect after an intentional stop()", () => {
    const client = connectClient();
    const socketA = latest();

    // stop() removes the close listener BEFORE closing, so the close handler
    // never runs and no reconnect is scheduled on an intentional shutdown.
    client.stop();
    expect(socketA.closed).toBe(true);

    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("M9: cancels a PENDING reconnect when stop() runs before the back-off fires", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const client = connectClient();
    const socketA = latest();

    // A prior clean close scheduled a reconnect back-off (not yet elapsed).
    socketA.emit("close");
    expect(client.isConnected()).toBe(false);
    expect(MockWebSocket.instances.length).toBe(1);

    // The screen unmounts / route changes / logs out BEFORE the back-off fires.
    client.stop();

    // Advancing well past the back-off must NOT recreate the socket: an
    // intentional teardown cancels the pending reconnect (no work after unmount).
    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL * 3);
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("schedules a reconnect on error while under the connection-error limit", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    connectClient();
    const socketA = latest();

    socketA.emit("error");
    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);

    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("ignores subscribe/unsubscribe while in the error state", () => {
    const client = connectClient();
    const socketA = latest();

    socketA.emit("error"); // sets the client into the error state

    // Both calls are guarded by `if (error) return;`, so neither emits a frame.
    // Timers are intentionally NOT advanced so the error-path reconnect does
    // not fire and reset the state before these assertions run.
    client.subscribe("kX", jest.fn());
    client.unsubscribe("kY");

    const keys = framesOf(socketA).map((m) => m.routing_key);
    expect(keys).not.toContain("kX");
    expect(keys).not.toContain("kY");
  });
});

describe("subscribeToProject", () => {
  it("subscribes the three frozen project keys and unsubscribes them on cleanup", () => {
    const client = connectClient();
    latest().sent = [];

    const cleanup = subscribeToProject(client, 42, {
      onUserStories: jest.fn(),
      onMilestones: jest.fn(),
      onProjects: jest.fn(),
    });

    // Only the three frozen keys are ever produced (constraint C-1); the
    // milestones subscription carries { selfNotification: true }, the other
    // two carry no options.
    expect(framesOf(latest())).toEqual([
      { cmd: "subscribe", routing_key: "changes.project.42.userstories" },
      {
        cmd: "subscribe",
        routing_key: "changes.project.42.milestones",
        options: { selfNotification: true },
      },
      { cmd: "subscribe", routing_key: "changes.project.42.projects" },
    ]);

    latest().sent = [];
    cleanup();
    expect(framesOf(latest())).toEqual([
      { cmd: "unsubscribe", routing_key: "changes.project.42.userstories" },
      { cmd: "unsubscribe", routing_key: "changes.project.42.milestones" },
      { cmd: "unsubscribe", routing_key: "changes.project.42.projects" },
    ]);
  });

  it("subscribes only userstories and projects for the Kanban handler subset", () => {
    const client = connectClient();
    latest().sent = [];

    subscribeToProject(client, 42, {
      onUserStories: jest.fn(),
      onProjects: jest.fn(),
    });

    expect(framesOf(latest())).toEqual([
      { cmd: "subscribe", routing_key: "changes.project.42.userstories" },
      { cmd: "subscribe", routing_key: "changes.project.42.projects" },
    ]);
    expect(framesOf(latest()).map((m) => m.routing_key)).not.toContain(
      "changes.project.42.milestones",
    );
  });

  it("subscribes only userstories and milestones for the Backlog handler subset", () => {
    const client = connectClient();
    latest().sent = [];

    subscribeToProject(client, 42, {
      onUserStories: jest.fn(),
      onMilestones: jest.fn(),
    });

    expect(framesOf(latest())).toEqual([
      { cmd: "subscribe", routing_key: "changes.project.42.userstories" },
      {
        cmd: "subscribe",
        routing_key: "changes.project.42.milestones",
        options: { selfNotification: true },
      },
    ]);
    expect(framesOf(latest()).map((m) => m.routing_key)).not.toContain(
      "changes.project.42.projects",
    );
  });

  it("interpolates the project id into every routing key", () => {
    const client = connectClient();
    latest().sent = [];

    subscribeToProject(client, 9, {
      onUserStories: jest.fn(),
      onMilestones: jest.fn(),
      onProjects: jest.fn(),
    });

    expect(framesOf(latest()).map((m) => m.routing_key)).toEqual([
      "changes.project.9.userstories",
      "changes.project.9.milestones",
      "changes.project.9.projects",
    ]);
  });
});


describe("createEventsClient — defensive guards", () => {
  it("queues (does not send) a frame produced while disconnected", () => {
    // unsubscribe() calls sendMessage() unconditionally (after the error gate);
    // while disconnected the frame is queued and the `if (!connected) return`
    // fast-path is taken, so nothing reaches the socket.
    const client = createEventsClient(makeContext());
    client.setupConnection(); // socket constructed but not yet open => disconnected

    client.unsubscribe("k");

    expect(latest().sent.length).toBe(0);
  });

  it("does not start a second heartbeat when open fires more than once", () => {
    connectClient(); // first open starts the heartbeat
    const socket = latest();

    socket.emit("open"); // second open must hit the already-running guard

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_TIME);
    // Exactly one interval is running, so exactly one ping is produced.
    expect(framesOf(socket).filter((m) => m.cmd === "ping").length).toBe(1);
  });

  it("safely ignores a subscribe issued after stop() tore the socket down", () => {
    // After stop() the socket reference is cleared; the flush fast-path
    // (`if (!connected || !ws) return`) swallows the send without throwing.
    const client = connectClient();
    client.stop();

    expect(() => client.subscribe("z", jest.fn())).not.toThrow();
  });
});



/**
 * M8 (auth lifecycle): the WebSocket auth handshake must carry the CURRENT
 * bearer token, read live from `localStorage` on every (re)connect, rather
 * than the one-time `MountContext.token` snapshot captured at mount. This
 * mirrors the legacy `$tgStorage.get("token")` that the AngularJS auth layer
 * consulted afresh on each connection, so a token refreshed while a React
 * screen is mounted is used on the next reconnect instead of causing silent
 * 401s until the next route change.
 *
 * These tests deliberately drive `localStorage`. The outer suite seeds a stored
 * token so its protocol-framing tests represent a logged-in session; this
 * describe therefore CLEARS `localStorage` in its own `beforeEach` to start from
 * a known-empty store, drives it explicitly per case, and clears again on
 * `afterEach` so no live token leaks across describes regardless of order.
 *
 * Finding C4 (authoritative logout): when `localStorage` is available but holds
 * no valid token, the auth frame carries `token: null` — the stale mount
 * snapshot is NOT resurrected.
 */
describe("createEventsClient — live token auth (M8 / C4)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("authenticates with the LIVE localStorage token, not the context snapshot", () => {
    // The mount snapshot is the stale "jwt-abc"; the live store holds the
    // refreshed credential that the auth layer wrote after a token refresh.
    localStorage.setItem("token", JSON.stringify("live-token-xyz"));

    connectClient(); // context.token is still "jwt-abc"

    const auth = framesOf(latest())[0];
    expect(auth).toEqual({
      cmd: "auth",
      data: { token: "live-token-xyz", sessionId: "sess-1" },
    });
  });

  it("C4: sends a null auth token when localStorage has none, NOT the stale context snapshot", () => {
    // localStorage is available but empty => authoritative logged-out state.
    // Even though the mount context still carries a snapshot ("jwt-abc"), the
    // socket must NOT resurrect it; the auth frame carries token: null so the
    // backend rejects the (logged-out) handshake instead of accepting a
    // discarded credential.
    expect(localStorage.getItem("token")).toBeNull();

    connectClient(); // context.token is still "jwt-abc"

    expect(framesOf(latest())[0]).toEqual({
      cmd: "auth",
      data: { token: null, sessionId: "sess-1" },
    });
  });

  it("re-authenticates on reconnect with a token refreshed mid-mount", () => {
    // Connect with the original live token, then simulate an auth refresh
    // (a new JWT written to localStorage) before the socket drops. The
    // reconnect handshake must carry the NEW token, not the original.
    localStorage.setItem("token", JSON.stringify("token-v1"));
    jest.spyOn(Math, "random").mockReturnValue(0);

    const client = createEventsClient(makeContext());
    client.setupConnection();
    latest().emit("open");
    expect(framesOf(latest())[0]).toEqual({
      cmd: "auth",
      data: { token: "token-v1", sessionId: "sess-1" },
    });

    // Token is refreshed by the surviving AngularJS auth layer mid-mount.
    localStorage.setItem("token", JSON.stringify("token-v2"));

    // A clean close schedules the deterministic reconnect.
    latest().emit("close");
    jest.advanceTimersByTime(RECONNECT_TRY_INTERVAL);
    expect(MockWebSocket.instances.length).toBe(2);

    const socketB = latest();
    socketB.emit("open");
    expect(framesOf(socketB)[0]).toEqual({
      cmd: "auth",
      data: { token: "token-v2", sessionId: "sess-1" },
    });
  });

  it("sends a null token in the auth frame when neither store nor context has one", () => {
    // A logged-out / token-less mount must still handshake deterministically
    // (token: null) rather than throw; the backend rejects it, matching the
    // legacy behaviour of authenticating with whatever storage returned.
    connectClient({ token: undefined as unknown as string });

    expect(framesOf(latest())[0]).toEqual({
      cmd: "auth",
      data: { token: null, sessionId: "sess-1" },
    });
  });
});

/**
 * M9 (inbound-frame validation): a hostile or buggy socket must never be able
 * to break the client. `handleMessage` bounds the frame size, parses JSON
 * safely, requires a plain object, and requires `cmd`/`routing_key` (when
 * present) to be strings; any violation is ignored (never thrown out of the
 * listener) and logged at most `MAX_MALFORMED_FRAME_LOGS` times so a flood of
 * bad frames cannot swamp the console. A single bad frame must not stop a
 * later, well-formed frame from being dispatched.
 */
describe("createEventsClient — malformed frame validation (M9)", () => {
  const KEY = "changes.project.7.userstories";

  /**
   * Connect a client subscribed to {@link KEY}, spy on `console.warn`, and
   * return both so a test can assert the callback was never invoked and the
   * bounded diagnostic fired. `console.warn` is restored by the global
   * `afterEach` (`jest.restoreAllMocks()`).
   */
  function connectSubscribed(): {
    cb: jest.Mock;
    warn: jest.SpyInstance;
    socket: MockWebSocket;
  } {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createEventsClient(makeContext());
    client.setupConnection();
    const cb = jest.fn();
    client.subscribe(KEY, cb);
    latest().emit("open");
    latest().sent = []; // discard the auth+subscribe frames; focus on inbound
    return { cb, warn, socket: latest() };
  }

  it("ignores a non-string frame payload without throwing or dispatching", () => {
    const { cb, warn, socket } = connectSubscribed();

    expect(() =>
      socket.emit("message", { data: 123 as unknown as string }),
    ).not.toThrow();

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty-string frame", () => {
    const { cb, warn, socket } = connectSubscribed();

    socket.emit("message", { data: "" });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores an over-length frame beyond MAX_INBOUND_FRAME_LENGTH", () => {
    const { cb, warn, socket } = connectSubscribed();
    const huge = "x".repeat(MAX_INBOUND_FRAME_LENGTH + 1);

    socket.emit("message", { data: huge });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a frame that is not valid JSON without throwing", () => {
    const { cb, warn, socket } = connectSubscribed();

    expect(() =>
      socket.emit("message", { data: "{ not valid json" }),
    ).not.toThrow();

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a JSON array frame (not a plain object)", () => {
    const { cb, warn, socket } = connectSubscribed();

    socket.emit("message", { data: JSON.stringify([1, 2, 3]) });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a JSON null frame (not a plain object)", () => {
    const { cb, warn, socket } = connectSubscribed();

    socket.emit("message", { data: JSON.stringify(null) });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a frame whose cmd is not a string", () => {
    const { cb, warn, socket } = connectSubscribed();

    socket.emit("message", {
      data: JSON.stringify({ cmd: 5, routing_key: KEY, data: { id: 1 } }),
    });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a frame whose routing_key is not a string", () => {
    const { cb, warn, socket } = connectSubscribed();

    socket.emit("message", {
      data: JSON.stringify({ routing_key: 5, data: { id: 1 } }),
    });

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still dispatches a well-formed frame that arrives after a malformed one", () => {
    const { cb, socket } = connectSubscribed();

    socket.emit("message", { data: "{ broken" }); // malformed: ignored
    socket.emit("message", {
      data: JSON.stringify({ routing_key: KEY, data: { id: 99 } }),
    }); // well-formed: must dispatch

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ id: 99 });
  });

  it("bounds malformed-frame logging to MAX_MALFORMED_FRAME_LOGS", () => {
    const { warn, socket } = connectSubscribed();

    // Emit strictly more than the cap; only the first MAX are logged, but
    // every one is still safely ignored (no throw).
    for (let i = 0; i < MAX_MALFORMED_FRAME_LOGS + 3; i += 1) {
      socket.emit("message", { data: "{ broken" });
    }

    expect(warn).toHaveBeenCalledTimes(MAX_MALFORMED_FRAME_LOGS);
  });
});
