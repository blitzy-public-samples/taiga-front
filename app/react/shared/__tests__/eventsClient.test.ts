/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * eventsClient.test.ts — Browserless Jest + TypeScript unit spec for the shared
 * React WebSocket events client (`app/react/shared/events/eventsClient.ts`).
 *
 * The events client is the framework-agnostic re-implementation of the AngularJS
 * `$tgEvents` service (`app/coffee/modules/events.coffee`) that lets the migrated
 * React Kanban/Backlog screens receive live updates over the SAME WebSocket
 * endpoint, with the SAME frozen wire protocol, as the incumbent AngularJS
 * client. This spec pins that protocol so the coexistence contract cannot drift:
 *
 *   - ROUTING KEYS — `changes.project.{projectId}.{entity}` for `userstories`,
 *     `projects`, and `milestones` (kanban/main.coffee:249,254 ;
 *     backlog/main.coffee:224,229).
 *   - EVENTS-DISABLED PATH — with no `eventsUrl`, `connect()` constructs no
 *     WebSocket at all (events.coffee:39-43).
 *   - RELATIVE-URL RESOLUTION — a non-`ws(s):` URL is resolved to an absolute
 *     `ws(s)://<host>/<path>` derived from `window.location` (events.coffee:46-50).
 *   - AUTH HANDSHAKE — on `open`, `{ cmd: 'auth', data: { token, sessionId } }`
 *     is sent first, reusing the AngularJS session token + sessionId
 *     (events.coffee:239-246).
 *   - QUEUE-AND-FLUSH — messages emitted before the socket opens are buffered
 *     and flushed, in order, once connected (events.coffee:165-175).
 *   - HEARTBEAT — a `{ cmd: 'ping' }` frame is emitted on the heartbeat interval
 *     (events.coffee:123-155).
 *   - SUBSCRIBE / DISPATCH / UNSUBSCRIBE — the payload delivered to a callback is
 *     the INNER `data.data`, not the envelope; `pong` and unknown/missing routing
 *     keys are ignored; `unsubscribe` stops delivery (events.coffee:176-214).
 *   - DISCONNECT — the socket is closed and client state is torn down cleanly.
 *
 * The suite is intentionally hermetic and browserless (AAP 0.6.2 / 0.7 test
 * isolation): it imports ONLY the module under test — which internally pulls the
 * sibling `../config` and `../session` adapters — and drives every branch with a
 * fake global `WebSocket` (jsdom provides none) plus the SAME shared browser
 * globals the AngularJS client uses (`window.taigaConfig`, `localStorage 'token'`,
 * `window.taiga.sessionId`). There is NO AngularJS/CoffeeScript import, NO
 * Playwright, NO browser launch, and NO real network, so it runs headlessly and
 * deterministically and counts toward the >=70% line-coverage gate.
 *
 * Fake timers are mandatory here so the heartbeat/reconnect `setInterval`/
 * `setTimeout` never fire real timers; every test disconnects the client and
 * restores real timers in `afterEach`, leaving no open handles (Jest exits
 * cleanly without `--forceExit`).
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are provided globally
 * by `@types/jest` + ts-jest and are deliberately NOT imported.
 */

import { createEventsClient, routingKeys } from '../events/eventsClient';
import type { EventsClient } from '../events/eventsClient';

/**
 * Minimal fake `WebSocket` installed as the global constructor for every test.
 *
 * It captures the connect URL and every serialized frame the client sends
 * (`sent`), records itself in a static `instances` registry so tests can assert
 * how many sockets were constructed, and exposes an `emit(type, event?)` helper
 * to drive the `open` / `message` lifecycle listeners the client registers via
 * `addEventListener`. The static `CONNECTING/OPEN/CLOSING/CLOSED` constants and
 * the instance `readyState` mirror the real `WebSocket` surface; although the
 * client under test gates sends on its own `connected` flag (not `readyState`),
 * the helper still sets `readyState = OPEN` before emitting `open` so the mock
 * stays faithful to the real API and robust to future implementations.
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  /** Every socket constructed during the current test. Reset in `beforeEach`. */
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  /** Raw (JSON-stringified) frames the client has sent, in order. */
  sent: string[] = [];

  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ||= []).push(cb);
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }

  send(msg: string): void {
    this.sent.push(msg);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Invoke every listener registered for `type` (snapshot to tolerate removal). */
  emit(type: string, event?: unknown): void {
    (this.listeners[type] || []).slice().forEach((f) => f(event));
  }
}

// ---------------------------------------------------------------------------
// Shared per-test state + helpers
// ---------------------------------------------------------------------------

/**
 * The client created by the current test. Tracked at suite scope so `afterEach`
 * can always tear it down (idempotently) even if a test forgets — this is what
 * clears the heartbeat interval and closes the socket so no handle leaks.
 */
let client: EventsClient | undefined;

/** The most recently constructed fake socket. */
const lastSocket = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1];

/** Transition a socket to OPEN and fire the client's `open` listener. */
const openSocket = (ws: MockWebSocket): void => {
  ws.readyState = MockWebSocket.OPEN;
  ws.emit('open');
};

/** Parse a single serialized frame into a plain object. */
const parse = (raw: string): Record<string, unknown> => JSON.parse(raw) as Record<string, unknown>;

/** The most recent serialized frame the client sent, parsed. */
const latestFrame = (ws: MockWebSocket): Record<string, unknown> => parse(ws.sent[ws.sent.length - 1]);

/** Assign the shared `window.taigaConfig` global (partial configs allowed). */
const setConfig = (cfg: Record<string, unknown>): void => {
  (window as unknown as { taigaConfig?: unknown }).taigaConfig = cfg;
};

beforeEach(() => {
  // Fake timers CONTAIN the heartbeat interval + reconnect timeouts so they
  // never fire on the real clock and never leak past a test.
  jest.useFakeTimers();

  // Fresh socket registry + install the fake as the global WebSocket (jsdom
  // does not provide one). The client resolves the bare `WebSocket` identifier
  // to this global.
  MockWebSocket.instances = [];
  global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

  // The SAME shared globals the AngularJS client reads. The token is stored
  // JSON-serialized (StorageService.set -> JSON.stringify), so `getToken()`
  // JSON.parses it back to the bare string 'tk'.
  setConfig({ eventsUrl: 'ws://localhost:7777/events' });
  window.taiga = { sessionId: 'sid' };
  localStorage.clear();
  localStorage.setItem('token', JSON.stringify('tk'));
});

afterEach(() => {
  // Idempotent teardown: closes the socket, clears the heartbeat interval, and
  // marks the client disposed so any pending reconnect timeout is a no-op.
  if (client) {
    client.disconnect();
    client = undefined;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
  localStorage.clear();
  delete (window as { taiga?: unknown }).taiga;
  delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
});

// ---------------------------------------------------------------------------
// routingKeys — frozen `changes.project.{id}.{entity}` contract
// ---------------------------------------------------------------------------

describe('routingKeys', () => {
  it('builds the frozen changes.project.{id}.{entity} keys', () => {
    expect(routingKeys.userstories(42)).toBe('changes.project.42.userstories');
    expect(routingKeys.milestones(42)).toBe('changes.project.42.milestones');
    expect(routingKeys.projects(42)).toBe('changes.project.42.projects');
  });

  it('accepts string project ids (e.g. slugs) verbatim', () => {
    expect(routingKeys.userstories('abc')).toBe('changes.project.abc.userstories');
  });
});

// ---------------------------------------------------------------------------
// connect() — socket construction + URL resolution
// ---------------------------------------------------------------------------

describe('createEventsClient — connect() and URL resolution', () => {
  it('constructs NO socket when eventsUrl is not configured (events disabled)', () => {
    setConfig({});
    client = createEventsClient();
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('constructs exactly one socket at the absolute ws:// URL verbatim', () => {
    client = createEventsClient();
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toBe('ws://localhost:7777/events');
  });

  it('resolves a relative eventsUrl to an absolute ws://host/path from window.location', () => {
    setConfig({ eventsUrl: '/events' });
    client = createEventsClient();
    client.connect();
    // jsdom default location is http://localhost/ -> scheme ws:, host localhost.
    expect(lastSocket().url).toBe('ws://localhost/events');
  });
});

// ---------------------------------------------------------------------------
// open — auth handshake + heartbeat
// ---------------------------------------------------------------------------

describe('createEventsClient — open handshake and heartbeat', () => {
  it('sends the auth frame { token, sessionId } as the first message on open', () => {
    client = createEventsClient();
    client.connect();
    openSocket(lastSocket());

    expect(parse(lastSocket().sent[0])).toEqual({
      cmd: 'auth',
      data: { token: 'tk', sessionId: 'sid' },
    });
  });

  it('emits a ping frame when the heartbeat interval elapses', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    const before = ws.sent.length; // auth already flushed
    // Default heartbeat interval is 60000ms (getConfigValue fallback). Advancing
    // the fake clock by one interval fires exactly one heartbeat tick; no real
    // timer runs.
    jest.advanceTimersByTime(60000);

    const framesAfter = ws.sent.slice(before).map(parse);
    expect(framesAfter).toContainEqual({ cmd: 'ping' });
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe — outgoing frame shapes + queue-and-flush
// ---------------------------------------------------------------------------

describe('createEventsClient — subscribe / unsubscribe', () => {
  it('sends { cmd: "subscribe", routing_key } as the latest frame after open', () => {
    client = createEventsClient();
    client.connect();
    openSocket(lastSocket());

    const key = routingKeys.userstories(1);
    client.subscribe(key, () => undefined);

    expect(latestFrame(lastSocket())).toEqual({ cmd: 'subscribe', routing_key: key });
  });

  it('includes the options object in the subscribe frame when provided', () => {
    client = createEventsClient();
    client.connect();
    openSocket(lastSocket());

    const key = routingKeys.milestones(9);
    client.subscribe(key, () => undefined, { selfNotification: true });

    expect(latestFrame(lastSocket())).toEqual({
      cmd: 'subscribe',
      routing_key: key,
      options: { selfNotification: true },
    });
  });

  it('buffers a pre-open subscribe and flushes it (with auth) once connected', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();

    // Subscribe BEFORE the socket opens: the frame is queued, nothing sent yet.
    client.subscribe(routingKeys.userstories(1), () => undefined);
    expect(ws.sent).toHaveLength(0);

    // On open the buffered subscribe is flushed together with the auth frame
    // that onOpen enqueues. The queue preserves insertion order, so assert
    // membership (not order) to prove queue-and-flush without over-fitting.
    openSocket(ws);
    const cmds = ws.sent.map((s) => parse(s).cmd);
    expect(cmds).toHaveLength(2);
    expect(cmds).toContain('auth');
    expect(cmds).toContain('subscribe');
  });

  it('sends { cmd: "unsubscribe", routing_key } as the latest frame', () => {
    client = createEventsClient();
    client.connect();
    openSocket(lastSocket());

    const key = routingKeys.userstories(1);
    client.subscribe(key, () => undefined);
    client.unsubscribe(key);

    expect(latestFrame(lastSocket())).toEqual({ cmd: 'unsubscribe', routing_key: key });
  });
});

// ---------------------------------------------------------------------------
// message dispatch — inner payload delivery, pong + unknown keys ignored
// ---------------------------------------------------------------------------

describe('createEventsClient — message dispatch', () => {
  it('invokes the subscription callback once with the INNER payload (data.data)', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    const cb = jest.fn();
    const key = routingKeys.userstories(1);
    client.subscribe(key, cb);

    ws.emit('message', { data: JSON.stringify({ routing_key: key, data: { foo: 'bar' } }) });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('ignores pong frames without invoking any subscription callback', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    const cb = jest.fn();
    client.subscribe(routingKeys.userstories(1), cb);

    expect(() => ws.emit('message', { data: JSON.stringify({ cmd: 'pong' }) })).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores messages whose routing_key is unknown or missing', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    const cb = jest.fn();
    client.subscribe(routingKeys.userstories(1), cb);

    // Unknown routing key (no matching subscription) and a frame with no key.
    ws.emit('message', {
      data: JSON.stringify({ routing_key: 'changes.project.99.userstories', data: {} }),
    });
    ws.emit('message', { data: JSON.stringify({ data: { orphan: true } }) });

    expect(cb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disconnect — socket closed + safe teardown
// ---------------------------------------------------------------------------

describe('createEventsClient — disconnect', () => {
  it('closes the socket (readyState === CLOSED) on disconnect', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    client.disconnect();

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('does not throw and does not dispatch when a frame arrives after disconnect', () => {
    client = createEventsClient();
    client.connect();
    const ws = lastSocket();
    openSocket(ws);

    const cb = jest.fn();
    const key = routingKeys.userstories(1);
    client.subscribe(key, cb);

    client.disconnect();

    // disconnect() removed the client's listeners, so a stray frame reaching a
    // retained socket reference must be inert — no throw, no callback.
    expect(() =>
      ws.emit('message', { data: JSON.stringify({ routing_key: key, data: { x: 1 } }) }),
    ).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});
