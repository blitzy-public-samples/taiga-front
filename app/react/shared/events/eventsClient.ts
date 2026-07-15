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
}

interface Subscription {
  routingKey: string;
  callback: EventCallback;
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

  const subscriptions: Record<string, Subscription> = {};
  let pendingMessages: OutgoingMessage[] = [];

  // Reconnect config (events.coffee:26-27).
  const reconnectTryInterval = getConfigValue<number>('eventsReconnectTryInterval', 10000);
  const maxConnectionErrors = getConfigValue<number>('eventsMaxConnectionErrors', 5);

  // Heartbeat state (events.coffee:123-155).
  let missedHeartbeats = 0;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // --- messaging (events.coffee:160-190) ---------------------------------

  const serialize = (message: OutgoingMessage): string => JSON.stringify(message);

  // Queue-and-flush: messages sent before the socket opens are buffered and
  // flushed (in order) once connected. Reproduces events.coffee:165-175.
  const sendMessage = (message: OutgoingMessage): void => {
    pendingMessages.push(message);
    if (!connected || !ws) {
      return;
    }
    const messages = pendingMessages.map(serialize);
    pendingMessages = [];
    for (const msg of messages) {
      ws.send(msg);
    }
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
    subscription.callback(data.data);
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

  // --- socket lifecycle (events.coffee:36-70, 235-284) -------------------

  const onOpen = (): void => {
    connected = true;
    // Auth handshake — reuse the AngularJS session token + sessionId
    // (events.coffee:239-246). Token is JSON-parsed by ../session.getToken().
    const message: OutgoingMessage = {
      cmd: 'auth',
      data: { token: getToken(), sessionId: getSessionId() },
    };
    sendMessage(message);
    startHeartBeatMessages();
  };

  const onMessage = (event: MessageEvent): void => {
    const data = JSON.parse(event.data) as IncomingMessage;
    if (data.cmd === 'pong') {
      processHeartBeatPongMessage();
    } else {
      processMessage(data);
    }
  };

  const onError = (): void => {
    error = true;
    errors++;
    if (errors < maxConnectionErrors && !disposed) {
      setTimeout(setupConnection, randomTryInterval());
    }
  };

  const onClose = (): void => {
    connected = false;
    stopHeartBeatMessages();
    if (!error && !disposed) {
      setTimeout(setupConnection, randomTryInterval());
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
    ws = new WebSocket(url);
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
  };

  // --- public API --------------------------------------------------------

  const connect = (): void => {
    disposed = false;
    errors = 0;
    setupConnection();
  };

  const subscribe = (routingKey: string, callback: EventCallback, options?: SubscribeOptions): void => {
    if (error) {
      return;
    }
    subscriptions[routingKey] = { routingKey, callback };
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
    delete subscriptions[routingKey];
    sendMessage({ cmd: 'unsubscribe', routing_key: routingKey });
  };

  const disconnect = (): void => {
    disposed = true;
    stopExistingConnection();
    pendingMessages = [];
  };

  return { connect, subscribe, unsubscribe, disconnect };
}
