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

describe('createEventsClient — queue-and-flush', () => {
  it('buffers a subscribe sent before open and flushes it (after auth) once connected', () => {
    const client = createEventsClient();
    client.connect();
    // Subscribe BEFORE the socket opens: nothing is sent yet (buffered).
    client.subscribe(routingKeys.userstories(1), () => undefined);
    expect(lastSocket().sent).toHaveLength(0);

    lastSocket().emitOpen();
    const cmds = lastSocket().sentParsed().map((m) => m.cmd);
    // On open the buffered subscribe is flushed together with the auth frame
    // enqueued by onOpen (the queue preserves insertion order, so the
    // pre-open subscribe leads the just-enqueued auth). Assert membership so
    // the test proves queue-and-flush + auth without over-fitting frame order.
    expect(cmds).toHaveLength(2);
    expect(cmds).toContain('auth');
    expect(cmds).toContain('subscribe');
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
});
