/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * eventsClient.ts — WebSocket events client for the migrated React screens.
 *
 * Technology-change note (AngularJS 1.5.10 -> React 18 coexistence migration):
 * This module reproduces the AngularJS `$tgEvents` service
 * (app/coffee/modules/events.coffee) so the migrated Kanban and Backlog React
 * screens receive live updates over the SAME WebSocket endpoint, using the SAME
 * auth handshake ({ token, sessionId }), the SAME routing-key subscribe/
 * unsubscribe protocol, and the SAME ping/pong heartbeat + reconnect behavior.
 * The backend/events contract is therefore frozen.
 *
 * Coexistence boundary (HARD, AAP 0.7): globals-only. Imports ONLY the shared
 * config/session adapters and the browser `WebSocket` global. It never imports
 * AngularJS, any app/coffee module, or elements.js. Session/token/sessionId are
 * reused from the AngularJS session via ../session.
 */

import { getEventsUrl, getConfigValue } from '../config';
import { getToken, getSessionId } from '../session';

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

/** Options forwarded verbatim to the server on subscribe (e.g. { selfNotification: true }). */
export interface SubscribeOptions {
  selfNotification?: boolean;
  [key: string]: unknown;
}

/** Callback invoked with the message payload (`data.data`) for a routing key. */
export type EventCallback = (payload: unknown) => void;

/** Public API returned by createEventsClient(). */
export interface EventsClient {
  connect(): void;
  subscribe(routingKey: string, callback: EventCallback, options?: SubscribeOptions): void;
  unsubscribe(routingKey: string): void;
  disconnect(): void;
  /**
   * Live socket state. `true` only between a successful `onOpen` and the next
   * `onClose`/`disconnect()`. Mirrors the AngularJS `$tgEvents.connected` flag
   * (events.coffee) that `moveUs` consulted (`if not @events.connected`,
   * backlog/main.coffee:633) to decide whether to manually reload after a drag.
   * Consumers gate a post-drag reconcile on `!isConnected()` so the reload runs
   * only when the WebSocket is not carrying the change (parity: F/Gap 21).
   */
  isConnected(): boolean;
}

interface Subscription {
  routingKey: string;
  callback: EventCallback;
  /**
   * The subscribe options (if any) forwarded to the server. Retained on the
   * subscription so the deterministic re-subscribe on (re)connect (F21) resends
   * the identical frame the caller originally requested.
   */
  options?: SubscribeOptions;
}

interface OutgoingMessage {
  cmd: string;
  routing_key?: string;
  options?: SubscribeOptions;
  data?: unknown;
}

interface IncomingMessage {
  cmd?: string;
  routing_key?: string;
  data?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Routing-key helpers — frozen contract: `changes.project.{projectId}.{entity}`
// (kanban/main.coffee:249,254 ; backlog/main.coffee:224,229)
// ---------------------------------------------------------------------------

export const routingKeys = {
  userstories: (projectId: number | string): string => `changes.project.${projectId}.userstories`,
  projects: (projectId: number | string): string => `changes.project.${projectId}.projects`,
  milestones: (projectId: number | string): string => `changes.project.${projectId}.milestones`,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an events client instance. Mirrors a single `$tgEvents` connection.
 * Typical usage from a hook: `const c = createEventsClient(); c.connect();
 * c.subscribe(routingKeys.userstories(id), cb); ...; return () => c.disconnect();`
 */
export function createEventsClient(): EventsClient {
  let ws: WebSocket | undefined;
  let connected = false;
  let error = false;
  let disposed = false;
  let errors = 0;

  // The authoritative subscription registry. It is BOTH the live dispatch table
  // (routing key -> callback) AND the buffer of subscribe frames to (re)send on
  // every (re)connect: a subscribe requested before the socket opens is recorded
  // here and emitted by resubscribeAll() on open, which also makes reconnect
  // re-subscription deterministic (F21). There is therefore no separate
  // pending-message queue — the registry subsumes the AngularJS pre-open buffer
  // for the only frames that matter (subscribe/unsubscribe), and auth/ping are
  // only ever sent while connected.
  const subscriptions: Record<string, Subscription> = {};

  // Reconnect config (events.coffee:26-27).
  const reconnectTryInterval = getConfigValue<number>('eventsReconnectTryInterval', 10000);
  const maxConnectionErrors = getConfigValue<number>('eventsMaxConnectionErrors', 5);

  // Heartbeat state (events.coffee:123-155).
  let missedHeartbeats = 0;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Reconnect state (F21). The AngularJS source scheduled reconnects with an
  // UNTRACKED `setTimeout` in BOTH onError and onClose (events.coffee:268,278),
  // so a flapping connection (error THEN close, or repeated closes) could stack
  // several pending timers and open several concurrent sockets. We track a
  // SINGLE cancellable timer and dedupe scheduling so at most one reconnect is
  // ever pending, and it can be cancelled on a successful open or on disconnect.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // --- messaging (events.coffee:160-190) ---------------------------------

  const serialize = (message: OutgoingMessage): string => JSON.stringify(message);

  // Send a frame when connected; drop it otherwise. Reproduces the CONNECTED
  // half of events.coffee:165-175. Frames a caller issues while disconnected are
  // intentionally NOT sent here: subscribe/unsubscribe mutate the registry (so
  // resubscribeAll re-emits them on open), and auth/ping are only ever sent
  // while connected — so nothing meaningful is ever dropped. Centralizing the
  // `connected && ws` guard HERE (rather than at each call site) keeps the auth
  // frame guaranteed-first in onOpen and avoids duplicate sends.
  const sendMessage = (message: OutgoingMessage): void => {
    if (!connected || !ws) {
      return;
    }
    ws.send(serialize(message));
  };

  const processMessage = (data: IncomingMessage): void => {
    const routingKey = data.routing_key;
    if (!routingKey) {
      return;
    }
    const subscription = subscriptions[routingKey];
    if (!subscription) {
      return;
    }
    // Isolate per-callback errors (F22): a subscriber that throws must NOT break
    // the message loop, crash the socket handler, or prevent other
    // subscriptions from receiving their events. Swallow (best-effort) so one
    // faulty screen callback cannot take down live updates for the rest.
    try {
      subscription.callback(data.data);
    } catch {
      // Intentionally ignored — a throwing subscriber is contained here.
    }
  };

  const processHeartBeatPongMessage = (): void => {
    missedHeartbeats = 0;
  };

  // --- heartbeat (events.coffee:123-155) ---------------------------------

  const startHeartBeatMessages = (): void => {
    if (heartbeatInterval) {
      return;
    }
    const maxMissedHeartbeats = getConfigValue<number>('eventsMaxMissedHeartbeats', 5);
    const heartbeatIntervalTime = getConfigValue<number>('eventsHeartbeatIntervalTime', 60000);
    missedHeartbeats = 0;
    heartbeatInterval = setInterval(() => {
      try {
        if (missedHeartbeats >= maxMissedHeartbeats) {
          throw new Error('Too many missed heartbeats PINGs.');
        }
        missedHeartbeats++;
        sendMessage({ cmd: 'ping' });
      } catch (e) {
        setupConnection();
      }
    }, heartbeatIntervalTime);
  };

  const stopHeartBeatMessages = (): void => {
    if (!heartbeatInterval) {
      return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  };

  const randomTryInterval = (): number => {
    const min = reconnectTryInterval / 2;
    const max = reconnectTryInterval;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // --- reconnect scheduling (F21) ----------------------------------------

  /** Cancel any pending reconnect timer (on successful open or on disconnect). */
  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  /**
   * Schedule exactly ONE reconnect attempt. Deduped: if a reconnect is already
   * pending (or the client has been disposed), this is a no-op — so a burst of
   * error/close events can never stack multiple timers or open multiple sockets
   * (F21). The timer nulls its own handle before reconnecting so the next
   * failure can schedule again.
   */
  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      setupConnection();
    }, randomTryInterval());
  };

  /**
   * Re-send a subscribe frame for every active subscription (F21). Invoked once
   * per (re)connect AFTER the auth frame, so subscriptions survive a reconnect —
   * the AngularJS source never re-subscribed after a dropped connection
   * (a latent bug), leaving the screens silently stale until a full reload.
   * Exactly one subscribe frame is sent per active routing key, so there is no
   * duplicate-subscription risk.
   */
  const resubscribeAll = (): void => {
    for (const routingKey of Object.keys(subscriptions)) {
      const sub = subscriptions[routingKey];
      const message: OutgoingMessage = { cmd: 'subscribe', routing_key: routingKey };
      if (sub.options) {
        message.options = sub.options;
      }
      sendMessage(message);
    }
  };

  // --- socket lifecycle (events.coffee:36-70, 235-284) -------------------

  const onOpen = (): void => {
    connected = true;
    // A successful open clears the error latch, restores the full reconnect
    // budget, and cancels any pending reconnect timer (F21) so a reconnect that
    // succeeds does not leave a stale timer armed or a spent error count that
    // would permanently disable events after a few lifetime blips.
    error = false;
    errors = 0;
    clearReconnectTimer();

    // F02 (CRITICAL): the AUTH frame MUST be the FIRST frame on the wire. The
    // AngularJS source called sendMessage(auth) AFTER connected=true, but its
    // sendMessage APPENDED to a queue that could already hold a subscribe
    // buffered before open — so on a cold connection a subscribe raced ahead of
    // auth and the server rejected it. Here subscribe frames are NEVER buffered
    // ahead of auth (they live in the registry, re-emitted below), and auth is
    // the FIRST sendMessage after connected=true, so it is guaranteed to be the
    // first frame on the wire. Token + sessionId are reused from the AngularJS
    // session (events.coffee:239-246); getToken() JSON-parses the stored token.
    sendMessage({
      cmd: 'auth',
      data: { token: getToken(), sessionId: getSessionId() },
    });

    // F21: deterministically re-subscribe (exactly once) to every active
    // routing key AFTER auth, so live updates survive a reconnect.
    resubscribeAll();

    startHeartBeatMessages();
  };

  const onMessage = (event: MessageEvent): void => {
    // Guard the parse (F22): a malformed / non-JSON frame must NEVER throw out
    // of the socket's message handler (which would surface as an unhandled
    // error and could tear down the connection). Drop unparseable frames.
    let data: IncomingMessage;
    try {
      data = JSON.parse(event.data) as IncomingMessage;
    } catch {
      return;
    }

    // Validate the frame shape (F22): only a non-null object can carry a `cmd`
    // or a `routing_key`. A JSON primitive (e.g. `null`, `42`, `"x"`) is ignored
    // rather than trusted, so `data.cmd` / `data.routing_key` are never read off
    // a non-object.
    if (data === null || typeof data !== 'object') {
      return;
    }

    if (data.cmd === 'pong') {
      processHeartBeatPongMessage();
    } else {
      processMessage(data);
    }
  };

  const onError = (): void => {
    error = true;
    errors++;
    // Schedule at most one reconnect (F21). Once the cumulative error budget is
    // exhausted, events stay disabled (events.coffee:267-270).
    if (errors < maxConnectionErrors && !disposed) {
      scheduleReconnect();
    }
  };

  const onClose = (): void => {
    connected = false;
    stopHeartBeatMessages();
    // Only reconnect on an UNEXPECTED close (no prior error — onError already
    // scheduled in that case). scheduleReconnect() dedupes, so even if both
    // error and close fire, exactly one reconnect is pending (F21).
    if (!error && !disposed) {
      scheduleReconnect();
    }
  };

  const stopExistingConnection = (): void => {
    if (!ws) {
      return;
    }
    // Remove listeners BEFORE close so an intentional close does not trigger
    // the reconnect path in onClose (events.coffee:59-70).
    ws.removeEventListener('open', onOpen);
    ws.removeEventListener('close', onClose);
    ws.removeEventListener('error', onError);
    ws.removeEventListener('message', onMessage);
    stopHeartBeatMessages();
    ws.close();
    ws = undefined;
  };

  const setupConnection = (): void => {
    if (disposed) {
      return;
    }
    // Cancel any pending reconnect timer: we are (re)connecting NOW, so a
    // separately-armed timer must not fire and open a second socket (F21).
    clearReconnectTimer();
    stopExistingConnection();

    let url = getEventsUrl();

    // Disable events entirely when no URL is configured (events.coffee:39-43).
    if (!url) {
      return;
    }

    // Relative URL -> absolute ws(s):// derived from the current location
    // (events.coffee:46-50). Note both 'ws:' and 'wss:' are checked because
    // 'wss:' does not start with 'ws:'.
    if (!url.startsWith('ws:') && !url.startsWith('wss:')) {
      const loc = window.location;
      const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = url.replace(/^\/+/, ''); // _.trimStart(url, "/")
      url = `${scheme}//${loc.host}/${path}`;
    }

    error = false;
    // Guard socket construction (F22): `new WebSocket(url)` can throw
    // synchronously (e.g. a SecurityError or a malformed URL) and attaching
    // listeners could too. Route any such failure through the SAME error policy
    // as a runtime socket error rather than letting it escape `connect()` /
    // the reconnect timer — so a bad URL degrades gracefully (bounded retries)
    // instead of crashing the caller.
    try {
      ws = new WebSocket(url);
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    } catch {
      ws = undefined;
      onError();
    }
  };

  // --- public API --------------------------------------------------------

  const connect = (): void => {
    disposed = false;
    error = false;
    errors = 0;
    setupConnection();
  };

  const subscribe = (routingKey: string, callback: EventCallback, options?: SubscribeOptions): void => {
    if (error) {
      return;
    }
    // Record the subscription in the authoritative registry so it is (re)sent by
    // resubscribeAll() on every (re)connect (F21). Store the options so the
    // re-subscribe frame is identical to the original request.
    subscriptions[routingKey] = { routingKey, callback, options };

    // Emit the subscribe frame. sendMessage drops it while disconnected, in
    // which case resubscribeAll() emits it on the next open — so a subscribe
    // requested before the socket opens is deferred, then sent exactly ONCE
    // (never doubled). When already connected it is sent immediately.
    const message: OutgoingMessage = { cmd: 'subscribe', routing_key: routingKey };
    if (options) {
      message.options = options;
    }
    sendMessage(message);
  };

  const unsubscribe = (routingKey: string): void => {
    if (error) {
      return;
    }
    // Remove from the registry first (so a reconnect does not re-subscribe it),
    // then emit an unsubscribe frame. sendMessage is a no-op while disconnected,
    // which is correct: with no live socket there is nothing to unsubscribe from.
    delete subscriptions[routingKey];
    sendMessage({ cmd: 'unsubscribe', routing_key: routingKey });
  };

  const disconnect = (): void => {
    disposed = true;
    // Cancel any pending reconnect so a scheduled timer cannot resurrect the
    // connection after an intentional teardown (F21).
    clearReconnectTimer();
    stopExistingConnection();
    // Full teardown / state reset (F21): a disposed client leaves no residual
    // connection, error latch, buffered frames, or subscriptions behind, so a
    // later connect() (or a fresh client) starts from a clean slate and no stale
    // routing keys are silently re-subscribed.
    connected = false;
    error = false;
    errors = 0;
    for (const key of Object.keys(subscriptions)) {
      delete subscriptions[key];
    }
  };

  // Expose the live connection flag (read-only accessor over the internal
  // `connected` latch maintained by onOpen/onClose/disconnect). Used by the
  // backlog hook to reproduce moveUs's `if not @events.connected` reconcile.
  const isConnected = (): boolean => connected;

  return { connect, subscribe, unsubscribe, disconnect, isConnected };
}
