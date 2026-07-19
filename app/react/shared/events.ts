/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * events.ts — WebSocket live-update bridge for the React (Kanban + Backlog)
 * screens that run in-place inside the AngularJS 1.5.10 shell.
 *
 * WHY THIS EXISTS
 *   The migrated Kanban and Backlog screens must refresh themselves when the
 *   backend broadcasts server-side changes (a teammate moving a card, editing a
 *   sprint, archiving the project, …). The still-AngularJS application does this
 *   through the `taigaEvents` service (`app/coffee/modules/events.coffee`). That
 *   service is an AngularJS provider wired to `$rootScope`, `$log`, `$tgAuth`
 *   and `tgLiveAnnouncementService`, so React cannot consume it directly.
 *
 *   This module is therefore a **React-internal reimplementation** of the exact
 *   same wire protocol. It does NOT change the protocol — it only re-expresses
 *   it — so the Django events gateway cannot tell a React client from an
 *   AngularJS one: identical auth handshake, identical `ping`/`pong` heartbeat,
 *   identical `subscribe`/`unsubscribe` frames, and identical routing keys
 *   (`changes.project.{id}.userstories|milestones|projects`). See AAP
 *   §0.1.1, §0.6.1 and §0.7.1 (the WebSocket contract is kept byte-for-byte).
 *
 *   It is imported by `../kanban/state/useKanbanBoard.ts` and
 *   `../backlog/state/useBacklog.ts`, which subscribe on mount (inside a
 *   `useEffect`) and call the returned unsubscribe function on unmount.
 *
 * SHARED RUNTIME (never hardcode anything)
 *   Every ambient value comes from `./session`, the single React-side owner of
 *   the AngularJS shell's runtime state:
 *     - `getEventsUrl()`  — the events base URL from `window.taigaConfig`. When
 *       it is falsy live updates are DISABLED and every export becomes a safe
 *       no-op (mirrors `events.coffee:43` `return if not url`).
 *     - `getConfig()`     — the runtime config, read for the heartbeat/reconnect
 *       numbers (with the same defaults AngularJS uses).
 *     - `getAuthToken()`  — the JWT sent in the `auth` handshake frame.
 *     - `getSessionId()`  — the `X-Session-Id` correlation id sent alongside it.
 *   This module NEVER reads `localStorage`, `window.taigaConfig` or the session
 *   id directly — it delegates entirely to `./session`.
 *
 * PROTOCOL SOURCE OF TRUTH — reproduced precisely from
 *   `app/coffee/modules/events.coffee`:
 *     - URL resolution / disable-on-empty ....... setupConnection (:36-57)
 *     - auth-first open handshake ................ onOpen          (:235-247)
 *     - ping/pong heartbeat ...................... :123-155
 *     - queue-then-flush send semantics .......... sendMessage     (:160-176)
 *     - subscribe / unsubscribe frames ........... :195-230
 *     - routing-key dispatch with `data.data` .... processMessage  (:177-190, 252-260)
 *     - reconnect with randomized backoff ........ onError/onClose (:262-284)
 *   Routing keys come from `backlog/main.coffee:223-234` (+ AAP §0.6.1); the
 *   `.milestones` subscription carries `{ selfNotification: true }`.
 *
 * DELIBERATE, DOCUMENTED DEVIATIONS FROM events.coffee (behaviour preserved,
 * wire frames unchanged):
 *   1. The AngularJS-only notification subscriptions (`notifications`,
 *      `liveNotifications`, `webNotifications`) are intentionally omitted — they
 *      depend on `$rootScope`, the desktop `Notification` API and the live
 *      announcement service, none of which belong to the Kanban/Backlog board
 *      refresh and none of which are in scope for this migration.
 *   2. Subscriptions are ref-counted per routing key via a
 *      `Map<routingKey, Set<callback>>` so the Kanban and Backlog screens can
 *      both listen to the same key. The `subscribe` frame is emitted once (first
 *      listener) and the `unsubscribe` frame once (last listener leaves), so the
 *      backend still sees exactly one subscription per key — the wire protocol
 *      is unchanged.
 *   3. `subscribe`/`unsubscribe` are NOT gated on the transient `error` flag (as
 *      `events.coffee:196,220` are). React registers the local handler and
 *      queues the frame regardless, so a board that subscribes during a
 *      reconnect keeps working once the socket re-opens — the frames themselves
 *      are byte-for-byte identical.
 *   4. `flush` only sends when `readyState === WebSocket.OPEN`, so a frame is
 *      never sent into a socket that is mid-close; anything unsent stays queued
 *      for the next open. This is strictly more robust and changes no frame.
 *
 * SAFETY / TESTABILITY INVARIANTS
 *   - NO top-level side effects: importing this module opens no socket. The
 *     connection is established lazily on the first `subscribe`, so Jest (jsdom,
 *     no network) can import it freely and `useEffect` fully owns the lifecycle.
 *   - DISABLED-SAFE: with no `eventsUrl`, `subscribe`/`subscribeProjectChanges`
 *     return a no-op unsubscribe, create no socket and never throw.
 *   - jsdom / SSR guarded: if `WebSocket` is undefined the connect step is a
 *     logged no-op rather than a crash.
 *
 * Toolchain: TypeScript 5.4.5 under `strict`, `jsx: "react-jsx"` (no
 * `import React`), Node v16.19.1 compatible. Bundled by esbuild into
 * `dist/js/react.js`. No legacy-lib imports (no dragula/immutable/checksley),
 * no `resources.coffee`.
 */

import { getEventsUrl, getConfig, getAuthToken, getSessionId } from './session';

/* ========================================================================== *
 * Phase 1 — Types, defaults & module state
 * ========================================================================== */

/**
 * A live-update listener. It receives the `data.data` payload of a matched
 * frame — i.e. the body the backend attaches under the routing key, exactly as
 * `processMessage` delivers it in `events.coffee:187,190`. Typed `any` because
 * the payload shape varies per routing key and consumers narrow it themselves
 * (the public API in the agent prompt mandates `(payload: any) => void`).
 */
type EventCallback = (payload: any) => void;

/**
 * Configuration defaults, kept identical to the AngularJS `$tgConfig` fallbacks
 * so a config that omits these keys behaves exactly as it does today.
 */
const DEFAULT_RECONNECT_TRY_INTERVAL = 10000; // events.coffee:26
const DEFAULT_MAX_CONNECTION_ERRORS = 5; //       events.coffee:27
const DEFAULT_MAX_MISSED_HEARTBEATS = 5; //       events.coffee:126
const DEFAULT_HEARTBEAT_INTERVAL_TIME = 60000; // events.coffee:127

/**
 * The single connection manager. One socket multiplexes every subscription for
 * the whole React tree; instantiated once, lazily, via {@link getBridge}.
 *
 * This mirrors the lifetime of the AngularJS `EventsService` singleton, but
 * connects lazily (on the first subscription) instead of at bootstrap, so the
 * module has no import-time side effects.
 */
class EventsBridge {
    /** The active socket, or `undefined` when not connected. */
    private ws: WebSocket | undefined = undefined;

    /** `true` between the socket's `open` and `close`/teardown. */
    private connected = false;

    /** `true` once an error has been observed on the current socket. */
    private error = false;

    /** Monotonic error count; reconnection stops once it reaches the max. */
    private errors = 0;

    /** `true` once {@link connect} has been invoked at least once. */
    private started = false;

    /** Missed heartbeat PINGs since the last PONG (or since connect). */
    private missedHeartbeats = 0;

    /**
     * The heartbeat interval handle. Typed via `ReturnType<typeof setInterval>`
     * so it is correct whether the ambient types resolve `setInterval` to the
     * DOM (`number`) or Node (`NodeJS.Timeout`) overload — both are present in
     * this project's `tsconfig` (`lib: ["DOM"]` + `types: ["node"]`).
     */
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;

    /**
     * The pending reconnect timer handle, or `undefined` when no reconnect is
     * scheduled.
     *
     * F-AAP-04: the AngularJS original fires a bare `setTimeout` in
     * `randomTryInterval` (`events.coffee:280-284`) and never keeps the handle,
     * so a queued reconnect cannot be cancelled. Here the handle is stored so
     * {@link stopReconnect} can cancel it the instant the last subscriber
     * leaves — otherwise a reconnect scheduled just before the final
     * unsubscribe would resurrect the socket after teardown (the resource leak
     * flagged in the review). Typed via `ReturnType<typeof setTimeout>` for the
     * same DOM/Node overload reason as {@link heartbeatTimer}.
     */
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined = undefined;

    /**
     * Frames awaiting delivery. Frames are enqueued here whenever the socket is
     * not yet OPEN and flushed (in FIFO order) the moment it opens
     * (`events.coffee:160-176`).
     */
    private pendingMessages: unknown[] = [];

    /**
     * Routing key → set of listeners. A `Set` (rather than a single callback as
     * in `events.coffee:214`) lets Kanban and Backlog subscribe to the same key
     * simultaneously; the reference is immutable, the contents are not.
     */
    private readonly subscriptions = new Map<string, Set<EventCallback>>();

    /* -------------------------------------------------------------------- *
     * Phase 2 — Connection lifecycle
     * -------------------------------------------------------------------- */

    /**
     * Establish (or re-establish) the socket — the analogue of
     * `setupConnection` (`events.coffee:36-57`). Tears down any existing socket
     * first, resolves the URL, and wires the event listeners. A no-op when
     * events are disabled (no `eventsUrl`) or when the environment has no
     * `WebSocket` implementation (jsdom / SSR).
     */
    connect(): void {
        this.stopExistingConnection();

        // We are (re)connecting right now, so any previously-scheduled reconnect
        // is redundant — cancel it so it cannot fire a second, overlapping
        // connect later (F-AAP-04).
        this.stopReconnect();

        const url = this.resolveUrl();
        if (url === null) {
            // No `eventsUrl` in configuration → live updates are disabled.
            return;
        }

        if (typeof WebSocket === 'undefined') {
            // No WebSocket implementation (jsdom without a polyfill, SSR).
            // Mirror `events.coffee:33-34`: report and stay a no-op.
            // eslint-disable-next-line no-console
            console.info('[taiga-react/events] WebSockets not supported in this environment; live updates disabled.');
            return;
        }

        this.error = false;

        const ws = new WebSocket(url);
        this.ws = ws;
        ws.addEventListener('open', this.onOpen);
        ws.addEventListener('message', this.onMessage);
        ws.addEventListener('error', this.onError);
        ws.addEventListener('close', this.onClose);
    }

    /**
     * Tear the current socket down without reconnecting — the analogue of
     * `stopExistingConnection` (`events.coffee:59-70`). Removes listeners, stops
     * the heartbeat and closes the socket. Additionally clears `connected` (a
     * defensive superset of the AngularJS behaviour) so no frame is sent into a
     * half-open socket while a new one is being created.
     */
    private stopExistingConnection(): void {
        const ws = this.ws;
        if (ws === undefined) {
            return;
        }

        ws.removeEventListener('open', this.onOpen);
        ws.removeEventListener('close', this.onClose);
        ws.removeEventListener('error', this.onError);
        ws.removeEventListener('message', this.onMessage);

        this.stopHeartbeat();
        ws.close();

        this.ws = undefined;
        this.connected = false;
    }

    /**
     * Fully disconnect and reset for a fresh session. Closes the socket, stops
     * the heartbeat, cancels any pending reconnect, clears the outbound queue
     * and resets the lazy-connect latch and error/heartbeat counters. After
     * this call the next {@link subscribe} opens a fresh socket with a clean
     * error budget.
     *
     * F-AAP-04: unlike AngularJS (which keeps the connection warm forever), the
     * ordinary unsubscribe path DOES call this once the last listener across all
     * keys is gone — see {@link removeSubscription}. That closes the socket,
     * heartbeat interval, reconnect timer and queue that would otherwise survive
     * with zero subscribers. Because the error/heartbeat counters are reset
     * here, the next subscription session starts with a full retry budget rather
     * than inheriting the previous session's (a stale count would otherwise let
     * a fresh session give up early, since {@link connect} clears `error` but
     * not `errors`).
     */
    disconnect(): void {
        this.stopExistingConnection();
        this.stopReconnect();
        this.started = false;
        this.error = false;
        this.errors = 0;
        this.missedHeartbeats = 0;
        this.pendingMessages = [];
    }

    /**
     * @returns The REAL connection state — `true` only while the socket is
     *          actually open (between `open` and `close`/teardown), `false`
     *          while connecting, in reconnect backoff, errored or torn down.
     *
     * F-AAP-03: consumers must distinguish "an events URL is configured" from
     * "a live socket is currently connected". This exposes the latter (the
     * private {@link connected} flag) so a post-write reconcile can decide
     * whether live pushes will actually refresh the board, rather than assuming
     * a configured URL means a healthy socket.
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Resolve the WebSocket URL from `getEventsUrl()`, reproducing
     * `events.coffee:39-50`:
     *   - falsy `eventsUrl` → `null` (disabled);
     *   - already-absolute `ws:`/`wss:` URL → used verbatim;
     *   - otherwise treated as a path and combined with the current location's
     *     scheme (`wss:` under HTTPS, else `ws:`) and host, with leading slashes
     *     trimmed (the `_.trimStart(url, "/")` equivalent).
     *
     * @returns The absolute socket URL, or `null` when events are disabled.
     */
    private resolveUrl(): string | null {
        const eventsUrl = getEventsUrl();
        if (!eventsUrl) {
            return null;
        }

        if (eventsUrl.startsWith('ws:') || eventsUrl.startsWith('wss:')) {
            return eventsUrl;
        }

        const loc = window.location;
        const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        const path = eventsUrl.replace(/^\/+/, '');
        return `${scheme}//${loc.host}/${path}`;
    }

    /* -------------------------------------------------------------------- *
     * Phase 2 (cont.) — Socket event handlers (stable arrow identities so
     * addEventListener / removeEventListener reference the same function)
     * -------------------------------------------------------------------- */

    /**
     * `open` handler — reproduces `events.coffee:235-247`. Marks the socket
     * connected, sends the auth frame FIRST, starts the heartbeat and flushes
     * any queued frames. The auth frame is unshifted to the front of the queue
     * so a single {@link flush} drains everything in order with auth leading.
     */
    private onOpen = (): void => {
        this.connected = true;

        const authFrame = {
            cmd: 'auth',
            data: {
                token: getAuthToken(),
                sessionId: getSessionId(),
            },
        };
        this.pendingMessages.unshift(authFrame);

        this.startHeartbeat();
        this.flush();
    };

    /**
     * `message` handler — reproduces `events.coffee:252-260`. Parses the frame;
     * a `{ cmd: "pong" }` resets the heartbeat counter, anything else is routed
     * to {@link processMessage}. Malformed JSON is ignored rather than thrown so
     * a bad frame can never crash the board.
     */
    private onMessage = (event: MessageEvent): void => {
        let data: any;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        if (data !== null && data !== undefined && data.cmd === 'pong') {
            this.processHeartbeatPong();
        } else {
            this.processMessage(data);
        }
    };

    /**
     * `error` handler — reproduces `events.coffee:262-270`. Flags the error,
     * increments the monotonic error count and schedules a reconnect while the
     * count is below the maximum; once the maximum is reached retries stop and
     * events are effectively disabled for the rest of the session.
     */
    private onError = (): void => {
        this.error = true;
        this.errors += 1;

        if (this.errors < this.getMaxConnectionErrors()) {
            this.scheduleReconnect();
        } else {
            // eslint-disable-next-line no-console
            console.error('[taiga-react/events] Events disabled: maximum connection errors reached.');
        }
    };

    /**
     * `close` handler — reproduces `events.coffee:272-278`. Marks the socket
     * disconnected and stops the heartbeat; if the close was not preceded by an
     * error, a reconnect is scheduled (an error-driven close is already being
     * retried by {@link onError}).
     */
    private onClose = (): void => {
        this.connected = false;
        this.stopHeartbeat();

        if (!this.error) {
            this.scheduleReconnect();
        }
    };

    /**
     * Schedule {@link connect} after a randomized delay, reproducing the
     * `randomTryInterval` backoff (`events.coffee:280-284`): a uniform value in
     * `[reconnect/2, reconnect]` milliseconds. Randomization spreads reconnect
     * storms across many clients.
     *
     * F-AAP-04 hardening over the AngularJS original:
     *   1. The timer handle is stored in {@link reconnectTimer} so
     *      {@link stopReconnect} can cancel it — the AngularJS `setTimeout`
     *      handle was discarded and thus uncancellable.
     *   2. It is a no-op when there are no subscribers, so a socket error/close
     *      that races the final unsubscribe cannot resurrect the connection
     *      after teardown.
     *   3. Pending reconnects are coalesced: if one is already scheduled a
     *      second is not stacked on top.
     * The timer callback re-checks {@link hasSubscriptions} because the last
     * subscriber may leave while the delay elapses.
     */
    private scheduleReconnect(): void {
        if (!this.hasSubscriptions()) {
            return;
        }

        if (this.reconnectTimer !== undefined) {
            return;
        }

        this.reconnectTimer = setTimeout((): void => {
            this.reconnectTimer = undefined;
            if (!this.hasSubscriptions()) {
                return;
            }
            this.connect();
        }, this.randomTryInterval());
    }

    /**
     * Cancel a pending reconnect timer, if any (F-AAP-04). Idempotent. Called
     * from {@link connect} (we are connecting now) and {@link disconnect} (the
     * last subscriber left) so a queued reconnect can never reopen the socket
     * after teardown.
     */
    private stopReconnect(): void {
        if (this.reconnectTimer === undefined) {
            return;
        }

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }

    /**
     * @returns `true` while at least one routing key still has a listener. This
     *          is the single source of truth for whether the socket should stay
     *          open (F-AAP-04): {@link removeSubscription} deletes a key the
     *          moment its listener set empties, so a non-zero map size means at
     *          least one live subscriber remains.
     */
    private hasSubscriptions(): boolean {
        return this.subscriptions.size > 0;
    }

    /**
     * @returns A randomized reconnect delay in `[reconnect/2, reconnect]` ms.
     */
    private randomTryInterval(): number {
        const reconnect = this.getConfigNumber('eventsReconnectTryInterval', DEFAULT_RECONNECT_TRY_INTERVAL);
        const min = reconnect / 2;
        const max = reconnect;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /* -------------------------------------------------------------------- *
     * Phase 2 (cont.) — Heartbeat (ping / pong)
     * See RFC 6455 §5.5.2-5.5.3, as referenced by events.coffee:121.
     * -------------------------------------------------------------------- */

    /**
     * Start the heartbeat, reproducing `events.coffee:123-143`. On each tick, if
     * too many PINGs have gone unanswered the connection is treated as dead and
     * rebuilt; otherwise a `{ cmd: "ping" }` frame is sent and the missed
     * counter incremented (a PONG resets it via {@link processHeartbeatPong}).
     * A no-op if the heartbeat is already running.
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer !== undefined) {
            return;
        }

        const maxMissedHeartbeats = this.getConfigNumber('eventsMaxMissedHeartbeats', DEFAULT_MAX_MISSED_HEARTBEATS);
        const heartbeatIntervalTime = this.getConfigNumber('eventsHeartbeatIntervalTime', DEFAULT_HEARTBEAT_INTERVAL_TIME);

        this.missedHeartbeats = 0;
        this.heartbeatTimer = setInterval((): void => {
            try {
                if (this.missedHeartbeats >= maxMissedHeartbeats) {
                    throw new Error('Too many missed heartbeats PINGs.');
                }

                this.missedHeartbeats += 1;
                this.sendMessage({ cmd: 'ping' });
            } catch {
                // A dead connection: rebuild it from scratch.
                this.connect();
            }
        }, heartbeatIntervalTime);
    }

    /**
     * Stop the heartbeat if running (`events.coffee:145-151`).
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer === undefined) {
            return;
        }

        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }

    /**
     * Reset the missed-heartbeat counter on an incoming PONG
     * (`events.coffee:153-155`).
     */
    private processHeartbeatPong(): void {
        this.missedHeartbeats = 0;
    }

    /* -------------------------------------------------------------------- *
     * Phase 2 (cont.) — Message send / queue / dispatch
     * -------------------------------------------------------------------- */

    /**
     * Serialize a frame for the wire (`events.coffee:160-163`): objects are
     * `JSON.stringify`-encoded, anything else is coerced to a string (defensive;
     * every frame this module sends is an object).
     */
    private serialize(message: unknown): string {
        if (typeof message === 'object' && message !== null) {
            return JSON.stringify(message);
        }
        return String(message);
    }

    /**
     * Enqueue a frame and, if connected, flush the queue
     * (`events.coffee:165-175`). While disconnected the frame simply stays
     * queued until the next `open`.
     */
    private sendMessage(message: unknown): void {
        this.pendingMessages.push(message);

        if (!this.connected) {
            return;
        }

        this.flush();
    }

    /**
     * Drain the pending-frame queue to the socket in FIFO order. Sends only when
     * the socket is genuinely OPEN; otherwise the queue is left intact for the
     * next `open` (see deviation #4 in the module header).
     */
    private flush(): void {
        const ws = this.ws;
        if (ws === undefined || !this.connected || ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const frames = this.pendingMessages.map((message) => this.serialize(message));
        this.pendingMessages = [];

        for (const frame of frames) {
            ws.send(frame);
        }
    }

    /**
     * Route an inbound frame to its subscribers, reproducing
     * `events.coffee:177-190`: look up `data.routing_key`, and if any listeners
     * are registered invoke each with `data.data` (the payload). Frames for
     * unknown keys are ignored. Listeners are iterated over a snapshot so a
     * callback that unsubscribes mid-dispatch cannot corrupt the iteration.
     */
    private processMessage(data: any): void {
        if (data === null || data === undefined) {
            return;
        }

        const routingKey: unknown = data.routing_key;
        if (typeof routingKey !== 'string') {
            return;
        }

        const handlers = this.subscriptions.get(routingKey);
        if (handlers === undefined || handlers.size === 0) {
            return;
        }

        for (const callback of Array.from(handlers)) {
            callback(data.data);
        }
    }

    /* -------------------------------------------------------------------- *
     * Phase 3 — Subscribe / unsubscribe (manager level)
     * -------------------------------------------------------------------- */

    /**
     * Register a listener for a routing key and return its unsubscribe function.
     * Opens the socket lazily on the very first subscription. The `subscribe`
     * wire frame (`events.coffee:206-215`) is emitted only when the FIRST
     * listener for a key registers; `options` are attached only when provided
     * and are taken from that first subscriber (all callers of a given key in
     * this migration pass the same options, so this is unambiguous in practice).
     *
     * @param routingKey The routing key to subscribe to.
     * @param callback   Invoked with the frame payload (`data.data`).
     * @param options    Optional subscription options (e.g. `selfNotification`).
     * @returns An idempotent unsubscribe function.
     */
    subscribe(routingKey: string, callback: EventCallback, options?: Record<string, unknown>): () => void {
        if (!this.started) {
            this.started = true;
            this.connect();
        }

        let handlers = this.subscriptions.get(routingKey);
        const isNewRoutingKey = handlers === undefined;

        if (handlers === undefined) {
            handlers = new Set<EventCallback>();
            this.subscriptions.set(routingKey, handlers);
        }

        handlers.add(callback);

        if (isNewRoutingKey) {
            const message: Record<string, unknown> = {
                cmd: 'subscribe',
                routing_key: routingKey,
            };
            if (options !== undefined) {
                message.options = options;
            }
            this.sendMessage(message);
        }

        let active = true;
        return (): void => {
            if (!active) {
                return;
            }
            active = false;
            this.removeSubscription(routingKey, callback);
        };
    }

    /**
     * Remove one listener for a key and, when the last listener for that key is
     * gone, emit the `unsubscribe` frame (`events.coffee:225-230`) and drop the
     * key locally.
     *
     * F-AAP-04: additionally, once the last listener across ALL keys is gone,
     * fully tear the connection down via {@link disconnect}. Without this the
     * socket, the heartbeat interval, any pending reconnect timer and the
     * outbound message queue would all survive with zero subscribers — the
     * resource leak flagged in the review. The `unsubscribe` frame is enqueued
     * (and flushed synchronously if the socket is OPEN) BEFORE the teardown
     * closes the socket, so it still reaches the wire in the normal case; if the
     * socket was never open the server has no subscription for us anyway and the
     * subsequent `close` cleans up server-side. The next {@link subscribe} then
     * opens a fresh socket because {@link disconnect} resets the `started`
     * latch.
     */
    private removeSubscription(routingKey: string, callback: EventCallback): void {
        const handlers = this.subscriptions.get(routingKey);
        if (handlers === undefined) {
            return;
        }

        handlers.delete(callback);

        if (handlers.size === 0) {
            this.subscriptions.delete(routingKey);
            this.sendMessage({
                cmd: 'unsubscribe',
                routing_key: routingKey,
            });
        }

        if (!this.hasSubscriptions()) {
            this.disconnect();
        }
    }

    /* -------------------------------------------------------------------- *
     * Config helpers
     * -------------------------------------------------------------------- */

    /**
     * Read a numeric setting from the runtime config, falling back to `fallback`
     * when the key is absent or not a number. Values reach us through
     * `TaigaConfig`'s index signature as `unknown`, so the `typeof` guard keeps
     * this `strict`-clean.
     */
    private getConfigNumber(key: string, fallback: number): number {
        const value: unknown = getConfig()[key];
        return typeof value === 'number' ? value : fallback;
    }

    /**
     * @returns The configured maximum connection-error count before retries stop
     *          (`events.coffee:27`), defaulting to {@link DEFAULT_MAX_CONNECTION_ERRORS}.
     */
    private getMaxConnectionErrors(): number {
        return this.getConfigNumber('eventsMaxConnectionErrors', DEFAULT_MAX_CONNECTION_ERRORS);
    }
}

/* ========================================================================== *
 * Phase 3 — Public API (lazy singleton + exported functions)
 * ========================================================================== */

/**
 * The lazily-created singleton bridge. Kept `null` until the first enabled
 * subscription so importing this module has no side effects.
 */
let bridge: EventsBridge | null = null;

/**
 * @returns The shared {@link EventsBridge}, creating it on first use.
 */
function getBridge(): EventsBridge {
    if (bridge === null) {
        bridge = new EventsBridge();
    }
    return bridge;
}

/**
 * A shared no-op unsubscribe returned whenever events are disabled, so callers
 * can always invoke the result unconditionally.
 */
const NO_OP_UNSUBSCRIBE = (): void => {
    /* events disabled — nothing to tear down */
};

/**
 * @returns `true` only when a live socket is CURRENTLY open.
 *
 * F-AAP-03: this reports the REAL connection state, not merely whether an
 * events URL is configured. It never creates the bridge — if nothing has
 * subscribed yet (`bridge === null`) or the socket is connecting / in backoff /
 * errored / torn down, it returns `false`. Consumers (e.g. `useBacklog`) use it
 * to decide whether live pushes will refresh the board or a fallback reload is
 * required after a write settles.
 */
export function isEventsConnected(): boolean {
    return bridge !== null && bridge.isConnected();
}

/**
 * Subscribe to a raw routing key.
 *
 * When events are disabled (no `eventsUrl`) this is a guaranteed no-op: it
 * creates no socket, registers nothing and returns {@link NO_OP_UNSUBSCRIBE}.
 * Otherwise it lazily connects, registers the listener, emits the `subscribe`
 * frame (once per key) and returns an idempotent unsubscribe function.
 *
 * @param routingKey The routing key, e.g. `changes.project.42.userstories`.
 * @param callback   Invoked with the frame payload (`data.data`).
 * @param options    Optional subscription options (e.g. `{ selfNotification: true }`).
 * @returns An unsubscribe function; safe to call multiple times.
 */
export function subscribe(
    routingKey: string,
    callback: (payload: any) => void,
    options?: Record<string, unknown>,
): () => void {
    if (!getEventsUrl()) {
        return NO_OP_UNSUBSCRIBE;
    }
    return getBridge().subscribe(routingKey, callback, options);
}

/**
 * Handlers for the three per-project change streams the Kanban and Backlog
 * screens care about. Every handler is optional; only the provided ones are
 * subscribed. Each receives the frame payload (`data.data`).
 */
export interface ProjectChangeHandlers {
    /** `changes.project.{id}.userstories` — a user story changed. */
    onUserstories?: (payload: any) => void;
    /** `changes.project.{id}.milestones` — a sprint/milestone changed. */
    onMilestones?: (payload: any) => void;
    /** `changes.project.{id}.projects` — the project itself changed. */
    onProjects?: (payload: any) => void;
}

/**
 * Subscribe to the per-project change streams for a project, the high-level
 * entry point preferred by `useKanbanBoard` / `useBacklog`.
 *
 * Reproduces the routing keys from `backlog/main.coffee:223-234` (+ AAP
 * §0.6.1). The `.milestones` subscription carries `{ selfNotification: true }`
 * to match `backlog/main.coffee:234`. Only the handlers that are supplied are
 * subscribed. The returned function tears down every subscription created here.
 *
 * When events are disabled (no `eventsUrl`) this is a guaranteed no-op: it
 * creates no socket and returns {@link NO_OP_UNSUBSCRIBE}.
 *
 * @param projectId The project id (number or string) to build the keys from.
 * @param handlers  The per-stream callbacks to register.
 * @returns A single unsubscribe function that tears down all of them.
 */
export function subscribeProjectChanges(projectId: number | string, handlers: ProjectChangeHandlers): () => void {
    if (!getEventsUrl()) {
        return NO_OP_UNSUBSCRIBE;
    }

    const { onUserstories, onMilestones, onProjects } = handlers;
    const unsubscribers: Array<() => void> = [];

    if (onUserstories) {
        unsubscribers.push(subscribe(`changes.project.${projectId}.userstories`, onUserstories));
    }

    if (onMilestones) {
        unsubscribers.push(
            subscribe(`changes.project.${projectId}.milestones`, onMilestones, { selfNotification: true }),
        );
    }

    if (onProjects) {
        unsubscribers.push(subscribe(`changes.project.${projectId}.projects`, onProjects));
    }

    return (): void => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
    };
}
