/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Framework-agnostic WebSocket subscription helper.
 *
 * Reproduces the real-time client of the legacy AngularJS `EventsService`
 * (`app/coffee/modules/events.coffee`) *over the wire only* — this module
 * imports no AngularJS, no React, and no stylesheet, relying solely on the
 * browser `WebSocket`, `window`, and timer globals. It is consumed by the
 * migrated React Kanban and Backlog screens so they receive the identical
 * server-push events on the identical frozen routing keys the AngularJS app
 * uses today.
 *
 * Constraint C-1 (frozen contract): the WebSocket event contract is frozen.
 * Only the three `changes.project.{id}.{userstories|milestones|projects}`
 * routing keys are ever produced, and no key is renamed or versioned.
 *
 * Assumption A-2 (no performance SLA): the timing constants below are
 * preserved as *behavior* (mirrored from `conf/conf.example.json`), never
 * asserted or measured as SLAs.
 *
 * Design note: this is the foundational module of `shared/ws/`. It defines
 * the authoritative public API — {@link EventsClient}, {@link EventCallback},
 * {@link ProjectEventHandlers}, {@link createEventsClient},
 * {@link subscribeToProject} — that downstream (not-yet-authored) consumers in
 * `shared/api/`, `kanban/hooks/useKanbanStories.ts`, and
 * `backlog/hooks/useBacklogStories.ts` conform to.
 */
import type { MountContext } from "../types";
import { readLiveToken } from "../auth/token";

/**
 * Upper bound (bytes/UTF-16 code units) on an inbound WS frame we will attempt
 * to `JSON.parse` (finding M9). The frozen event payloads are small; a frame
 * larger than this is treated as malformed and ignored rather than risking a
 * large allocation/parse from a corrupt or hostile socket.
 */
export const MAX_INBOUND_FRAME_LENGTH = 1_000_000;

/**
 * Maximum number of malformed-frame diagnostics emitted per client (bounded
 * diagnostics, finding M9): a broken/hostile socket cannot flood the console.
 */
export const MAX_MALFORMED_FRAME_LOGS = 5;

/**
 * Interval, in milliseconds, between outgoing heartbeat `ping` frames.
 * Mirrors `eventsHeartbeatIntervalTime` from `conf/conf.example.json`.
 * Preserved as behavior (A-2); do not tune.
 */
export const HEARTBEAT_INTERVAL_TIME = 60000;

/**
 * Number of consecutive un-answered heartbeats tolerated before the client
 * treats the socket as dead and forces a reconnect via `setupConnection()`.
 * Mirrors `eventsMaxMissedHeartbeats` from `conf/conf.example.json`.
 */
export const MAX_MISSED_HEARTBEATS = 5;

/**
 * Base back-off, in milliseconds, used when scheduling a reconnect attempt.
 * The effective delay is randomised within
 * `[RECONNECT_TRY_INTERVAL / 2, RECONNECT_TRY_INTERVAL]` = `[5000, 10000]`.
 * Mirrors `eventsReconnectTryInterval` from `conf/conf.example.json`.
 */
export const RECONNECT_TRY_INTERVAL = 10000;

/**
 * Maximum number of connection errors after which events are permanently
 * disabled — no further reconnect is scheduled from the error path.
 * Mirrors `eventsMaxConnectionErrors` (the legacy default declared in
 * `events.coffee`, as it is absent from `conf/conf.example.json`).
 */
export const MAX_CONNECTION_ERRORS = 5;

/**
 * Callback invoked with the raw `data` payload of a matched inbound event.
 *
 * Payloads are intentionally typed `unknown`: React consumers narrow/parse
 * them, preserving the loosely-typed event payload the AngularJS service
 * passed through unchanged.
 */
export type EventCallback = (data: unknown) => void;

/**
 * Public control surface of a single WebSocket events connection. This is the
 * authoritative contract downstream consumers (the `shared/api` client and the
 * Kanban / Backlog hooks) conform to.
 */
export interface EventsClient {
  /** Open (or reopen) the connection and (re)subscribe every stored key. */
  setupConnection(): void;
  /**
   * Tear the connection down deterministically. Listeners are removed before
   * the socket is closed, so no reconnect is scheduled on an intentional
   * shutdown (used by React `disconnectedCallback` / `useEffect` cleanup).
   */
  stop(): void;
  /** Register interest in a routing key and receive its payloads via `callback`. */
  subscribe(routingKey: string, callback: EventCallback, options?: Record<string, unknown>): void;
  /** Cancel interest in a routing key and drop it from the subscription map. */
  unsubscribe(routingKey: string): void;
  /** Whether the socket is currently in the connected state. */
  isConnected(): boolean;
}

/**
 * Optional per-topic handlers accepted by {@link subscribeToProject}.
 *
 * Kanban supplies `{ onUserStories, onProjects }`; Backlog supplies
 * `{ onUserStories, onMilestones }`; a caller may pass all three. Only the
 * handlers that are provided are wired to their routing key.
 */
export interface ProjectEventHandlers {
  onUserStories?: EventCallback;
  onMilestones?: EventCallback;
  onProjects?: EventCallback;
}

/** Internal record describing one active subscription held in the map. */
interface Subscription {
  routingKey: string;
  callback: EventCallback;
  options?: Record<string, unknown>;
}

/** Internal shape of an outgoing control frame serialised to JSON on the wire. */
interface OutgoingMessage {
  cmd: string;
  [key: string]: unknown;
}

/** Internal shape of an inbound frame parsed from the socket. */
interface IncomingMessage {
  cmd?: string;
  routing_key?: string;
  data?: unknown;
}

/**
 * Resolve the configured events URL, reproducing the legacy
 * `@config.get("eventsUrl")` lookup with a `window.taigaConfig` fallback (the
 * React bundle receives configuration via `window.taigaConfig`, mirrored from
 * the AngularJS `$tgConfig`).
 *
 * Prefers `MountContext.eventsUrl`; falls back to `window.taigaConfig.eventsUrl`;
 * returns `null` when neither is truthy, which disables events (a no-op
 * connection) exactly as the legacy service did.
 *
 * The `window as unknown as { ... }` double-cast is required under `strict`
 * because `taigaConfig` is not part of the standard `Window` type. The cast is
 * kept local so this module remains self-contained (no global augmentation).
 */
function resolveConfiguredEventsUrl(context: MountContext): string | null {
  if (context.eventsUrl) {
    return context.eventsUrl;
  }
  const globalConfig = (window as unknown as { taigaConfig?: { eventsUrl?: string | null } }).taigaConfig;
  return globalConfig && globalConfig.eventsUrl ? globalConfig.eventsUrl : null;
}

/**
 * Create a WebSocket events client bound to a resolved {@link MountContext}.
 *
 * This factory replaces the legacy `EventsService` class: a closure holds the
 * per-connection state (`ws`, `subscriptions`, `connected`, `error`,
 * `pendingMessages`, `errors`, `missedHeartbeats`, `heartbeatInterval`) that
 * the class previously held on `this`. The returned {@link EventsClient}
 * exposes only the safe control surface.
 *
 * Behavioral parity guarantees (verified against the legacy service):
 * 1. `open` sends the `auth` frame first, then starts the heartbeat, then
 *    (re)subscribes every key currently in the `subscriptions` map.
 *    `pendingMessages` is cleared at the top of the open handler so the auth
 *    frame is always the first frame on the wire and no stale pre-connect
 *    frames leak through — the map is the single source of truth for what to
 *    (re)subscribe, so first-connect and reconnect share one code path with no
 *    duplicate subscribe frames.
 * 2. `stop()` removes the four listeners before calling `close()`, so the
 *    `close` handler does not fire and does not schedule a reconnect on an
 *    intentional shutdown.
 * 3. `unsubscribe` deletes the key from the `subscriptions` map after sending
 *    the unsubscribe frame, so a later reconnect does not resurrect it.
 * 4. `setupConnection` resets both `error` and `connected` to `false` before
 *    creating the socket, so a reconnect after an error starts clean.
 * 5. The heartbeat tick uses try/throw/catch so that reaching
 *    `MAX_MISSED_HEARTBEATS` triggers `setupConnection()` (reconnect).
 * 6. `subscribe` while disconnected stores the subscription in the map only
 *    (the frame is emitted from the open handler's map walk); `subscribe`
 *    while connected sends the frame immediately. Both are guarded by
 *    `if (error) return;`.
 */
export function createEventsClient(context: MountContext): EventsClient {
  let ws: WebSocket | undefined;
  const subscriptions: Record<string, Subscription> = {};
  let connected = false;
  let error = false;
  let pendingMessages: OutgoingMessage[] = [];
  let errors = 0;
  let missedHeartbeats = 0;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // Pending reconnect back-off handle (finding M9): tracked so an intentional
  // `stop()` (screen unmount / route change / logout) can CANCEL a reconnect
  // that a prior `error`/`close` scheduled, preventing a socket from being
  // recreated after teardown.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Bounded count of malformed inbound frames (finding M9): caps diagnostics.
  let malformedFrameCount = 0;

  /** Cancel any pending reconnect back-off timer (idempotent). */
  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  /**
   * Schedule a single reconnect attempt after the randomized back-off, tracking
   * the handle so it can be cancelled on teardown (finding M9). Any previously
   * pending attempt is cleared first so at most one is ever outstanding.
   */
  const scheduleReconnect = (): void => {
    clearReconnect();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      setupConnection();
    }, randomTryInterval());
  };

  const serialize = (message: OutgoingMessage): string => JSON.stringify(message);

  const flushPendingMessages = (): void => {
    if (!connected || !ws) {
      return;
    }
    const messages = pendingMessages.map(serialize);
    pendingMessages = [];
    for (const message of messages) {
      ws.send(message);
    }
  };

  const sendMessage = (message: OutgoingMessage): void => {
    pendingMessages.push(message);
    if (!connected) {
      return;
    }
    flushPendingMessages();
  };

  const randomTryInterval = (): number => {
    const min = RECONNECT_TRY_INTERVAL / 2;
    const max = RECONNECT_TRY_INTERVAL;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const stopHeartbeat = (): void => {
    if (!heartbeatInterval) {
      return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  };

  const startHeartbeat = (): void => {
    if (heartbeatInterval) {
      return;
    }
    missedHeartbeats = 0;
    heartbeatInterval = setInterval(() => {
      try {
        if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          throw new Error("Too many missed heartbeats PINGs.");
        }
        missedHeartbeats += 1;
        sendMessage({ cmd: "ping" });
      } catch {
        setupConnection();
      }
    }, HEARTBEAT_INTERVAL_TIME);
  };

  const dispatchMessage = (message: IncomingMessage): void => {
    const routingKey = message.routing_key;
    if (!routingKey) {
      return;
    }
    const subscription = subscriptions[routingKey];
    if (!subscription) {
      return;
    }
    subscription.callback(message.data);
  };

  const handleOpen = (): void => {
    connected = true;
    pendingMessages = [];
    // Re-authenticate with the LIVE token on every (re)connect (finding M8), so a
    // JWT refreshed while the screen is mounted is honoured after any reconnect.
    sendMessage({ cmd: "auth", data: { token: readLiveToken(context), sessionId: context.sessionId } });
    startHeartbeat();
    for (const routingKey of Object.keys(subscriptions)) {
      const subscription = subscriptions[routingKey];
      const message: OutgoingMessage = { cmd: "subscribe", routing_key: subscription.routingKey };
      if (subscription.options) {
        message.options = subscription.options;
      }
      sendMessage(message);
    }
  };

  /**
   * Emit a bounded malformed-frame diagnostic (finding M9). Only the first
   * {@link MAX_MALFORMED_FRAME_LOGS} are logged so a broken/hostile socket
   * cannot flood the console; the counter keeps growing for observability but
   * without further output.
   */
  const noteMalformedFrame = (reason: string): void => {
    malformedFrameCount += 1;
    if (malformedFrameCount <= MAX_MALFORMED_FRAME_LOGS && typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(`[events] ignoring malformed WS frame (${reason})`);
    }
  };

  const handleMessage = (event: MessageEvent): void => {
    // (M9) Validate the frame defensively before trusting it: bound the size,
    // parse safely, require a plain object with a string `cmd`, and require a
    // string `routing_key` when present. A malformed frame is ignored (never
    // throws out of the listener) so one bad frame cannot break the socket.
    const raw = event.data;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_INBOUND_FRAME_LENGTH) {
      noteMalformedFrame("non-string or out-of-bounds frame");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      noteMalformedFrame("JSON parse error");
      return;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      noteMalformedFrame("frame is not a JSON object");
      return;
    }

    const message = parsed as IncomingMessage;
    // A `cmd`, when present, must be a string; a `routing_key`, when present,
    // must be a string. The server sends data frames as `{ routing_key, data }`
    // (NO cmd) and control frames as `{ cmd: "pong" }` (legacy events.coffee),
    // so NEITHER field is mandatory — only well-typed when present.
    if (message.cmd !== undefined && typeof message.cmd !== "string") {
      noteMalformedFrame("non-string cmd");
      return;
    }
    if (message.routing_key !== undefined && typeof message.routing_key !== "string") {
      noteMalformedFrame("non-string routing_key");
      return;
    }

    if (message.cmd === "pong") {
      missedHeartbeats = 0;
      return;
    }
    // `dispatchMessage` further restricts delivery to routing keys we actually
    // subscribed to (frozen `changes.project.{id}.{...}` keys), so an unknown
    // key is silently and safely ignored.
    dispatchMessage(message);
  };

  const handleError = (): void => {
    error = true;
    errors += 1;
    if (errors < MAX_CONNECTION_ERRORS) {
      scheduleReconnect();
    }
  };

  const handleClose = (): void => {
    connected = false;
    stopHeartbeat();
    if (!error) {
      scheduleReconnect();
    }
  };

  const stopExistingConnection = (): void => {
    // Always cancel a pending reconnect back-off first (finding M9): a prior
    // error/close may have scheduled one even when no socket is currently open,
    // and an intentional stop must not let it recreate the connection.
    clearReconnect();
    if (!ws) {
      return;
    }
    ws.removeEventListener("open", handleOpen);
    ws.removeEventListener("close", handleClose);
    ws.removeEventListener("error", handleError);
    ws.removeEventListener("message", handleMessage);
    stopHeartbeat();
    ws.close();
    ws = undefined;
  };

  // Declared as a hoisted `function` (not a `const` arrow) precisely because it
  // is referenced inside `startHeartbeat`, `handleError`, and `handleClose`
  // above; hoisting lets those forward references type-check and run correctly.
  function setupConnection(): void {
    stopExistingConnection();
    let url = resolveConfiguredEventsUrl(context);
    if (!url) {
      return;
    }
    if (!url.startsWith("ws:") && !url.startsWith("wss:")) {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const path = url.replace(/^\/+/, "");
      url = `${scheme}//${window.location.host}/${path}`;
    }
    error = false;
    connected = false;
    ws = new WebSocket(url);
    ws.addEventListener("open", handleOpen);
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
  }

  const subscribe = (routingKey: string, callback: EventCallback, options?: Record<string, unknown>): void => {
    if (error) {
      return;
    }
    subscriptions[routingKey] = { routingKey, callback, options };
    if (connected) {
      const message: OutgoingMessage = { cmd: "subscribe", routing_key: routingKey };
      if (options) {
        message.options = options;
      }
      sendMessage(message);
    }
  };

  const unsubscribe = (routingKey: string): void => {
    if (error) {
      return;
    }
    sendMessage({ cmd: "unsubscribe", routing_key: routingKey });
    delete subscriptions[routingKey];
  };

  return {
    setupConnection,
    stop: stopExistingConnection,
    subscribe,
    unsubscribe,
    isConnected: (): boolean => connected,
  };
}

/**
 * Subscribe a client to the three FROZEN per-project routing keys, fanning a
 * project id out to whichever of the three handlers the caller supplies.
 *
 * Reproduces the per-screen subscription wiring found in the legacy
 * controllers:
 * - Kanban subscribes `changes.project.{id}.userstories` and
 *   `changes.project.{id}.projects` (no milestones, no options).
 * - Backlog subscribes `changes.project.{id}.userstories` (no options) and
 *   `changes.project.{id}.milestones` with `{ selfNotification: true }`
 *   (no projects).
 *
 * Only these three keys may ever be produced (constraint C-1). The
 * `debounceLeading` / random-timeout the legacy controllers applied around
 * their callbacks is the *caller's* responsibility (the consumer hook), not
 * this module's — raw callbacks are dispatched here.
 *
 * @returns a cleanup function that unsubscribes exactly the keys that were
 * subscribed (and no others); the React hooks invoke it from `useEffect`
 * teardown.
 */
export function subscribeToProject(
  client: EventsClient,
  projectId: number,
  handlers: ProjectEventHandlers,
): () => void {
  const base = `changes.project.${projectId}`;
  const subscribedKeys: string[] = [];

  if (handlers.onUserStories) {
    const key = `${base}.userstories`;
    client.subscribe(key, handlers.onUserStories);
    subscribedKeys.push(key);
  }
  if (handlers.onMilestones) {
    const key = `${base}.milestones`;
    client.subscribe(key, handlers.onMilestones, { selfNotification: true });
    subscribedKeys.push(key);
  }
  if (handlers.onProjects) {
    const key = `${base}.projects`;
    client.subscribe(key, handlers.onProjects);
    subscribedKeys.push(key);
  }

  return (): void => {
    for (const key of subscribedKeys) {
      client.unsubscribe(key);
    }
  };
}
