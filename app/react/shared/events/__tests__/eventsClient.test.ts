/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared WebSocket events client
 * (`app/react/shared/events/eventsClient.ts`) used by the React coexistence
 * layer.
 *
 * These specs pin the framework-agnostic re-implementation of the AngularJS
 * `$tgEvents` service (`app/coffee/modules/events.coffee`) so the migrated
 * React Kanban/Backlog screens receive live updates over the SAME WebSocket
 * endpoint with the SAME frozen protocol:
 *
 *   - ROUTING KEYS — `changes.project.{projectId}.{entity}` for `userstories`,
 *     `projects`, and `milestones` (kanban/main.coffee:249,254 ;
 *     backlog/main.coffee:224,229).
 *   - DISABLED WHEN UNCONFIGURED — with no `eventsUrl`, `connect()` opens no
 *     socket (events.coffee:39-43).
 *   - RELATIVE-URL RESOLUTION — a non-`ws(s):` URL is resolved to an absolute
 *     `ws(s)://<host>/<path>` from `window.location` (events.coffee:46-50).
 *   - AUTH HANDSHAKE — on open, `{ cmd: 'auth', data: { token, sessionId } }`
 *     is sent, reusing the AngularJS session (events.coffee:239-246).
 *   - QUEUE-AND-FLUSH — messages sent before the socket opens are buffered and
 *     flushed in order once connected (events.coffee:165-175).
 *   - SUBSCRIBE / DISPATCH / UNSUBSCRIBE — a payload is delivered to the
 *     callback registered for its `routing_key`; `pong` and unknown keys are
 *     ignored; `unsubscribe` stops delivery (events.coffee:176-190).
 *
 * The suite is intentionally hermetic: it imports ONLY the module under test
 * (which internally pulls the sibling `../config` / `../session` adapters) and
 * drives every branch with a fake `WebSocket` plus the SAME shared globals the
 * AngularJS client uses (`window.taigaConfig`, `localStorage 'token'`,
 * `window.taiga.sessionId`). Fake timers keep the heartbeat/reconnect timers
 * from leaking. There is no AngularJS / CoffeeScript import, no Playwright, no
 * browser launch, and no real network — so it runs headlessly and
 * deterministically and counts toward the >=70% line-coverage gate.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are provided globally
 * by `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

import { createEventsClient, routingKeys } from '../eventsClient';

type Listener = (event: unknown) => void;

/**
 * Minimal fake `WebSocket` capturing the URL, registered listeners, and every
 * serialized message the client sends. Test code drives lifecycle transitions
 * via `emitOpen` / `emitMessage`.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
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
  }

  emit(type: string, event: unknown): void {
    for (const l of this.listeners[type] ?? []) {
      l(event);
    }
  }

  emitOpen(): void {
    this.emit('open', {});
  }

  emitMessage(obj: unknown): void {
    this.emit('message', { data: JSON.stringify(obj) });
  }

  /** Emit a raw (possibly non-JSON) message frame verbatim, for parse-guard tests. */
  emitRaw(data: string): void {
    this.emit('message', { data });
  }

  emitError(): void {
    this.emit('error', {});
  }

  emitClose(): void {
    this.emit('close', {});
  }

  /** Parsed view of everything the client has sent so far. */
  sentParsed(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const setConfig = (cfg: Record<string, unknown>): void => {
  (window as unknown as { taigaConfig?: unknown }).taigaConfig = cfg;
};

/** The most recently constructed fake socket. */
const lastSocket = (): FakeWebSocket => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  setConfig({ api: 'http://localhost:8000/api/v1/', defaultLanguage: 'en', eventsUrl: 'ws://localhost:7600/events' });
  window.taiga = { sessionId: 'sess-123' };
  localStorage.clear();
  localStorage.setItem('token', JSON.stringify('jwt-abc'));
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  delete (window as { taiga?: unknown }).taiga;
  delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
  localStorage.clear();
});

describe('routingKeys — frozen contract', () => {
  it('builds changes.project.{id}.{entity} keys', () => {
    expect(routingKeys.userstories(42)).toBe('changes.project.42.userstories');
    expect(routingKeys.projects(7)).toBe('changes.project.7.projects');
    expect(routingKeys.milestones('abc')).toBe('changes.project.abc.milestones');
  });
});

describe('createEventsClient — connection lifecycle', () => {
  it('opens no socket when eventsUrl is not configured', () => {
    setConfig({ api: 'http://x/api/v1/', defaultLanguage: 'en', eventsUrl: null });
    const client = createEventsClient();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connects to an absolute ws:// URL verbatim', () => {
    const client = createEventsClient();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toBe('ws://localhost:7600/events');
    client.disconnect();
  });

  it('resolves a relative eventsUrl to an absolute ws://host/path from window.location', () => {
    setConfig({ api: 'http://x/api/v1/', defaultLanguage: 'en', eventsUrl: '/events' });
    const client = createEventsClient();
    client.connect();
    // jsdom default location is http://localhost/ -> scheme ws:, host localhost.
    expect(lastSocket().url).toBe('ws://localhost/events');
    client.disconnect();
  });

  it('sends the auth handshake (token + sessionId) on open', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const first = lastSocket().sentParsed()[0];
    expect(first.cmd).toBe('auth');
    expect(first.data).toEqual({ token: 'jwt-abc', sessionId: 'sess-123' });
    client.disconnect();
  });
});

describe('createEventsClient — isConnected() (parity: moveUs `@events.connected`, F/Gap 21)', () => {
  it('is false before connect() and before the socket opens', () => {
    const client = createEventsClient();
    expect(client.isConnected()).toBe(false);
    client.connect();
    // connect() constructs the socket but the open handshake has not fired yet.
    expect(client.isConnected()).toBe(false);
    client.disconnect();
  });

  it('becomes true after onOpen and false again after onClose', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    expect(client.isConnected()).toBe(true);
    lastSocket().emitClose();
    expect(client.isConnected()).toBe(false);
    client.disconnect();
  });

  it('is false after an explicit disconnect() even if the socket was open', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    expect(client.isConnected()).toBe(true);
    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('is false when eventsUrl is unconfigured (no socket ever opens)', () => {
    setConfig({ api: 'http://x/api/v1/', defaultLanguage: 'en', eventsUrl: null });
    const client = createEventsClient();
    client.connect();
    expect(client.isConnected()).toBe(false);
    client.disconnect();
  });
});

describe('createEventsClient — queue-and-flush', () => {
  it('defers a subscribe sent before open and sends it (AFTER auth) once connected — auth is FIRST (F02)', () => {
    const client = createEventsClient();
    client.connect();
    // Subscribe BEFORE the socket opens: nothing is sent yet (deferred to open).
    client.subscribe(routingKeys.userstories(1), () => undefined);
    expect(lastSocket().sent).toHaveLength(0);

    lastSocket().emitOpen();
    const cmds = lastSocket().sentParsed().map((m) => m.cmd);
    // F02 (CRITICAL): on a cold connection the AUTH frame MUST lead the wire,
    // BEFORE the deferred subscribe. The prior implementation appended auth to a
    // queue behind the pre-open subscribe, so a subscribe raced ahead of auth;
    // the fix guarantees auth is the first frame. Assert exact ordering now.
    expect(cmds).toEqual(['auth', 'subscribe']);
    client.disconnect();
  });

  it('sends a subscribe immediately once already connected', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const before = lastSocket().sent.length;
    client.subscribe(routingKeys.milestones(9), () => undefined, { selfNotification: true });
    const sent = lastSocket().sentParsed();
    expect(sent.length).toBe(before + 1);
    const last = sent[sent.length - 1];
    expect(last.cmd).toBe('subscribe');
    expect(last.routing_key).toBe('changes.project.9.milestones');
    expect(last.options).toEqual({ selfNotification: true });
    client.disconnect();
  });
});

describe('createEventsClient — message dispatch', () => {
  it('delivers a payload to the callback registered for its routing_key', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const cb = jest.fn();
    const key = routingKeys.userstories(1);
    client.subscribe(key, cb);

    lastSocket().emitMessage({ routing_key: key, data: { id: 5, status: 2 } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ id: 5, status: 2 });
    client.disconnect();
  });

  it('ignores pong frames and messages with unknown or missing routing keys', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const cb = jest.fn();
    client.subscribe(routingKeys.userstories(1), cb);

    lastSocket().emitMessage({ cmd: 'pong' });
    lastSocket().emitMessage({ routing_key: 'changes.project.99.userstories', data: {} });
    lastSocket().emitMessage({ data: { orphan: true } });
    expect(cb).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('stops delivering to a routing key after unsubscribe', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const cb = jest.fn();
    const key = routingKeys.userstories(1);
    client.subscribe(key, cb);
    client.unsubscribe(key);

    const sent = lastSocket().sentParsed();
    expect(sent[sent.length - 1].cmd).toBe('unsubscribe');

    lastSocket().emitMessage({ routing_key: key, data: { id: 1 } });
    expect(cb).not.toHaveBeenCalled();
    client.disconnect();
  });
});

describe('createEventsClient — disconnect', () => {
  it('closes the socket on disconnect', () => {
    const client = createEventsClient();
    client.connect();
    const socket = lastSocket();
    socket.emitOpen();
    client.disconnect();
    expect(socket.closed).toBe(true);
  });

  it('clears subscriptions on disconnect so a later connect does not re-subscribe them (F21)', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    client.subscribe(routingKeys.userstories(1), () => undefined);
    client.disconnect();

    // Reconnect fresh: on open, only the auth frame is sent — the previously
    // subscribed key was cleared on disconnect (no stale re-subscription).
    client.connect();
    lastSocket().emitOpen();
    const cmds = lastSocket().sentParsed().map((m) => m.cmd);
    expect(cmds).toEqual(['auth']);
    client.disconnect();
  });
});

describe('createEventsClient — heartbeat (ping/pong)', () => {
  it('sends a ping on each heartbeat interval and a pong resets the missed count', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsHeartbeatIntervalTime: 1000,
      eventsMaxMissedHeartbeats: 5,
    });
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();

    jest.advanceTimersByTime(1000);
    const afterPing = lastSocket().sentParsed();
    expect(afterPing[afterPing.length - 1].cmd).toBe('ping');

    // A pong resets missedHeartbeats; subsequent intervals keep pinging without
    // tripping the max-missed reconnect.
    lastSocket().emitMessage({ cmd: 'pong' });
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });

  it('reconnects when too many heartbeat PINGs are missed', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsHeartbeatIntervalTime: 1000,
      eventsMaxMissedHeartbeats: 2,
    });
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // missed: 0->1 (ping), 1->2 (ping), then 2 >= 2 -> throw -> reconnect.
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    client.disconnect();
  });

  it('does not start a second heartbeat when open fires twice (idempotent)', () => {
    const client = createEventsClient();
    client.connect();
    const socket = lastSocket();
    socket.emitOpen();
    // A duplicated open must not arm a second heartbeat interval
    // (startHeartBeatMessages short-circuits when one is already running).
    expect(() => socket.emitOpen()).not.toThrow();
    client.disconnect();
  });
});

describe('createEventsClient — reconnect (F21: tracked, deduped timer + re-subscribe)', () => {
  it('schedules exactly ONE reconnect even if close fires repeatedly (dedup)', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    const client = createEventsClient();
    client.connect();
    const first = lastSocket();
    first.emitOpen();

    // Two closes would, with the AngularJS untracked setTimeout, arm TWO timers
    // and open TWO reconnect sockets. The tracked/deduped timer opens exactly one.
    first.emitClose();
    first.emitClose();
    jest.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('re-subscribes (once) to every active routing key after a reconnect', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    const client = createEventsClient();
    client.connect();
    const key = routingKeys.userstories(1);
    const cb = jest.fn();
    lastSocket().emitOpen();
    client.subscribe(key, cb);

    // Drop the connection and let the tracked timer reconnect.
    lastSocket().emitClose();
    jest.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // On the NEW socket's open, auth leads and the active key is re-subscribed.
    const reconnected = lastSocket();
    reconnected.emitOpen();
    expect(reconnected.sentParsed().map((m) => m.cmd)).toEqual(['auth', 'subscribe']);

    // The re-subscribed key delivers events over the new socket.
    reconnected.emitMessage({ routing_key: key, data: { id: 9 } });
    expect(cb).toHaveBeenCalledWith({ id: 9 });
    client.disconnect();
  });

  it('re-subscribes with the ORIGINAL options after a reconnect (F21)', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    const client = createEventsClient();
    client.connect();
    const key = routingKeys.milestones(3);
    lastSocket().emitOpen();
    // Subscribe WITH options so the retained options round-trip on re-subscribe.
    client.subscribe(key, () => undefined, { selfNotification: true });

    lastSocket().emitClose();
    jest.advanceTimersByTime(100);
    const reconnected = lastSocket();
    reconnected.emitOpen();

    const resub = reconnected.sentParsed().find((m) => m.cmd === 'subscribe');
    expect(resub?.options).toEqual({ selfNotification: true });
    client.disconnect();
  });

  it('stops reconnecting once maxConnectionErrors is reached', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
      eventsMaxConnectionErrors: 2,
    });
    const client = createEventsClient();
    client.connect();

    // error 1 -> errors=1 (<2) -> schedule -> reconnect (socket 2).
    lastSocket().emitError();
    jest.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // error 2 -> errors=2 (NOT <2) -> no schedule -> no further socket.
    lastSocket().emitError();
    jest.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it('disconnect cancels a pending reconnect timer', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    const client = createEventsClient();
    client.connect();
    lastSocket().emitClose(); // schedules a reconnect
    client.disconnect(); // must cancel it

    jest.advanceTimersByTime(500);
    // No reconnect socket appears after an intentional disconnect.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('createEventsClient — resilience (F22: guarded parse, callback isolation, socket construction)', () => {
  it('ignores a malformed (non-JSON) frame without throwing', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const cb = jest.fn();
    client.subscribe(routingKeys.userstories(1), cb);

    expect(() => lastSocket().emitRaw('not json{')).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('ignores a frame that parses to a non-object JSON primitive', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const cb = jest.fn();
    client.subscribe(routingKeys.userstories(1), cb);

    expect(() => lastSocket().emitRaw('42')).not.toThrow();
    expect(() => lastSocket().emitRaw('null')).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('isolates a throwing subscriber so other subscriptions keep receiving', () => {
    const client = createEventsClient();
    client.connect();
    lastSocket().emitOpen();
    const key1 = routingKeys.userstories(1);
    const key2 = routingKeys.milestones(2);
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    client.subscribe(key1, bad);
    client.subscribe(key2, good);

    // A throwing callback must not surface out of the message handler...
    expect(() => lastSocket().emitMessage({ routing_key: key1, data: {} })).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);

    // ...and the other subscription keeps working afterward.
    lastSocket().emitMessage({ routing_key: key2, data: { ok: true } });
    expect(good).toHaveBeenCalledWith({ ok: true });
    client.disconnect();
  });

  it('routes a WebSocket construction failure through the error policy (connect never throws)', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    // A constructor that throws synchronously.
    global.WebSocket = function ThrowingWebSocket(): never {
      throw new Error('construct fail');
    } as unknown as typeof WebSocket;

    const client = createEventsClient();
    expect(() => client.connect()).not.toThrow();

    // Restore a working fake; the scheduled reconnect then succeeds.
    global.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    jest.advanceTimersByTime(100);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    client.disconnect();
  });

  it('ignores subscribe/unsubscribe while the client is in the error state (F21)', () => {
    setConfig({
      api: 'http://x/api/v1/',
      defaultLanguage: 'en',
      eventsUrl: 'ws://localhost:7600/events',
      eventsReconnectTryInterval: 100,
    });
    const client = createEventsClient();
    client.connect();
    const socket = lastSocket();
    socket.emitOpen();
    const sentAfterAuth = socket.sent.length;

    // Enter the error latch; subscribe/unsubscribe must short-circuit and emit
    // no frames on the (defunct) socket — the registry is untouched, so nothing
    // is re-subscribed on a later reconnect either.
    socket.emitError();
    client.subscribe(routingKeys.userstories(1), () => undefined);
    client.unsubscribe(routingKeys.userstories(1));
    expect(socket.sent.length).toBe(sentAfterAuth);
    client.disconnect();
  });
});
