/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    getEventsUrl,
    getEventsMaxMissedHeartbeats,
    getEventsHeartbeatIntervalTime,
} from "../config/taigaConfig";
import { getToken } from "../session/auth";
import { getSessionId } from "../session/sessionId";

/**
 * Callback invoked with the `data.data` payload of a routed change message.
 *
 * The server payload shape is not statically known, so it is surfaced as
 * `unknown`; consumers (Kanban/Backlog roots) narrow it as needed. The client
 * is intentionally callback-agnostic — it stores and invokes the callback
 * verbatim and performs no debouncing (the AngularJS consumers wrapped the
 * callback in `debounceLeading`; that stays a consumer concern in React).
 */
export type SubscriptionCallback = (data: unknown) => void;

/**
 * Optional per-subscription options, forwarded verbatim inside the `subscribe`
 * frame as `message.options` (mirrors events.coffee L211-L212; the Backlog
 * milestones subscription passes `{ selfNotification: true }`).
 */
export type SubscriptionOptions = Record<string, unknown>;

/**
 * Public surface of the real-time events client.
 *
 * A React screen obtains an instance from {@link createEventsClient}, calls
 * {@link EventsClient.connect} once, {@link EventsClient.subscribe} for each
 * project-scoped routing key it cares about, and
 * {@link EventsClient.disconnect} on unmount.
 *
 * Verified routing keys used by the two migrated screens:
 * - `changes.project.{projectId}.userstories`  (Kanban + Backlog)
 * - `changes.project.{projectId}.projects`     (Kanban — swimlane/status/attribute changes)
 * - `changes.project.{projectId}.milestones`   (Backlog)
 */
export interface EventsClient {
    connect(): void;
    subscribe(
        routingKey: string,
        callback: SubscriptionCallback,
        options?: SubscriptionOptions,
    ): void;
    unsubscribe(routingKey: string): void;
    disconnect(): void;
}

interface Subscription {
    routingKey: string;
    callback: SubscriptionCallback;
}

interface OutgoingMessage {
    cmd: string;
    [key: string]: unknown;
}

interface IncomingMessage {
    cmd?: string;
    routing_key?: string;
    data?: unknown;
}

/*
 * Resilience tunables. The AngularJS `EventsService` read these from `$tgConfig`
 * (`eventsReconnectTryInterval` default 10000, `eventsMaxConnectionErrors`
 * default 5 — events.coffee L26-L27). The React `shared/config` adapter
 * intentionally does not expose these two keys, so the documented source
 * defaults are inlined here as named constants. The three sensitive values that
 * MUST come from the shared adapters (events URL, JWT token, session id) are
 * still read exclusively through the imported getters — never re-derived here.
 */
const RECONNECT_TRY_INTERVAL_MS = 10000;
const MAX_CONNECTION_ERRORS = 5;

const PING_MESSAGE: OutgoingMessage = { cmd: "ping" };

class EventsClientImpl implements EventsClient {
    private ws: WebSocket | null = null;
    private connected = false;
    private error = false;
    private stopped = false;
    private errors = 0;
    private missedHeartbeats = 0;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly subscriptions: Record<string, Subscription> = {};
    private pendingMessages: OutgoingMessage[] = [];

    connect(): void {
        this.stopped = false;
        this.setupConnection();
    }

    subscribe(
        routingKey: string,
        callback: SubscriptionCallback,
        options?: SubscriptionOptions,
    ): void {
        if (this.error) {
            return;
        }

        this.subscriptions[routingKey] = { routingKey, callback };

        const message: OutgoingMessage = {
            cmd: "subscribe",
            routing_key: routingKey,
        };

        if (options) {
            message.options = options;
        }

        this.sendMessage(message);
    }

    unsubscribe(routingKey: string): void {
        if (this.error) {
            return;
        }

        delete this.subscriptions[routingKey];

        this.sendMessage({ cmd: "unsubscribe", routing_key: routingKey });
    }

    disconnect(): void {
        this.stopped = true;
        this.clearReconnectTimer();
        this.stopExistingConnection();
    }

    // ---------------------------------------------------------------------
    // Connection lifecycle
    // ---------------------------------------------------------------------

    private setupConnection(): void {
        this.stopExistingConnection();

        const url = this.resolveUrl();

        // Disable events cleanly when no URL is configured — every method
        // becomes a no-op (mirrors events.coffee "return if not url").
        if (!url) {
            return;
        }

        // Defensive: environments without WebSocket support simply stay quiet.
        if (typeof WebSocket === "undefined") {
            return;
        }

        this.error = false;

        const socket = new WebSocket(url);
        this.ws = socket;
        socket.addEventListener("open", this.handleOpen);
        socket.addEventListener("message", this.handleMessage);
        socket.addEventListener("error", this.handleError);
        socket.addEventListener("close", this.handleClose);
    }

    private stopExistingConnection(): void {
        const socket = this.ws;
        if (!socket) {
            return;
        }

        socket.removeEventListener("open", this.handleOpen);
        socket.removeEventListener("close", this.handleClose);
        socket.removeEventListener("error", this.handleError);
        socket.removeEventListener("message", this.handleMessage);

        this.stopHeartBeatMessages();
        socket.close();
        this.ws = null;
    }

    /**
     * Resolve the configured events URL to an absolute ws/wss URL.
     *
     * - Returns `null` when no URL is configured (events disabled).
     * - Absolute `ws:`/`wss:` URLs pass through unchanged.
     * - Relative URLs are resolved against the current document origin,
     *   choosing `wss:` on https pages and `ws:` otherwise
     *   (mirrors events.coffee L46-L50).
     */
    private resolveUrl(): string | null {
        const configured = getEventsUrl();
        if (!configured) {
            return null;
        }

        if (configured.startsWith("ws:") || configured.startsWith("wss:")) {
            return configured;
        }

        if (typeof window === "undefined" || !window.location) {
            return null;
        }

        const { protocol, host } = window.location;
        const scheme = protocol === "https:" ? "wss:" : "ws:";
        const path = configured.replace(/^\/+/, "");

        return `${scheme}//${host}/${path}`;
    }

    // ---------------------------------------------------------------------
    // Heartbeat (ping / pong)
    // ---------------------------------------------------------------------

    private startHeartBeatMessages(): void {
        if (this.heartbeatInterval) {
            return;
        }

        const maxMissedHeartbeats = getEventsMaxMissedHeartbeats();
        const heartbeatIntervalTime = getEventsHeartbeatIntervalTime();

        this.missedHeartbeats = 0;
        this.heartbeatInterval = setInterval(() => {
            if (this.missedHeartbeats >= maxMissedHeartbeats) {
                // Too many missed PONGs — force a full reconnect.
                this.setupConnection();
                return;
            }

            this.missedHeartbeats += 1;
            this.sendMessage(PING_MESSAGE);
        }, heartbeatIntervalTime);
    }

    private stopHeartBeatMessages(): void {
        if (!this.heartbeatInterval) {
            return;
        }

        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }

    private processHeartBeatPongMessage(): void {
        this.missedHeartbeats = 0;
    }

    // ---------------------------------------------------------------------
    // Message plumbing
    // ---------------------------------------------------------------------

    private sendMessage(message: OutgoingMessage): void {
        this.pendingMessages.push(message);

        if (!this.connected || !this.ws) {
            return;
        }

        const queued = this.pendingMessages;
        this.pendingMessages = [];

        for (const item of queued) {
            this.ws.send(JSON.stringify(item));
        }
    }

    private processMessage(data: IncomingMessage): void {
        const routingKey = data.routing_key;
        if (routingKey === undefined) {
            return;
        }

        const subscription = this.subscriptions[routingKey];
        if (!subscription) {
            return;
        }

        subscription.callback(data.data);
    }

    // ---------------------------------------------------------------------
    // Reconnection
    // ---------------------------------------------------------------------

    private clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped) {
            return;
        }

        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.stopped) {
                this.setupConnection();
            }
        }, this.randomTryInterval());
    }

    private randomTryInterval(): number {
        const max = RECONNECT_TRY_INTERVAL_MS;
        const min = RECONNECT_TRY_INTERVAL_MS / 2;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // ---------------------------------------------------------------------
    // WebSocket event listeners (stable references for add/removeEventListener)
    // ---------------------------------------------------------------------

    private readonly handleOpen = (): void => {
        this.connected = true;

        // Authenticate by reusing the SHARED token + session id — never mint a
        // new session (the events backend uses the session id to suppress
        // echoing a client's own optimistic changes back to it).
        const message: OutgoingMessage = {
            cmd: "auth",
            data: { token: getToken(), sessionId: getSessionId() },
        };

        this.sendMessage(message);
        this.startHeartBeatMessages();
    };

    private readonly handleMessage = (event: MessageEvent): void => {
        const raw =
            typeof event.data === "string" ? event.data : String(event.data);

        let data: IncomingMessage;
        try {
            data = JSON.parse(raw) as IncomingMessage;
        } catch {
            return;
        }

        if (data.cmd === "pong") {
            this.processHeartBeatPongMessage();
        } else {
            this.processMessage(data);
        }
    };

    private readonly handleError = (): void => {
        this.error = true;
        this.errors += 1;

        if (!this.stopped && this.errors < MAX_CONNECTION_ERRORS) {
            this.scheduleReconnect();
        }
    };

    private readonly handleClose = (): void => {
        this.connected = false;
        this.stopHeartBeatMessages();

        if (!this.stopped && !this.error) {
            this.scheduleReconnect();
        }
    };
}

/**
 * Create a React-agnostic real-time events client.
 *
 * The client reuses the SAME session as AngularJS — the JWT token from
 * `shared/session/auth`, the `X-Session-Id` value from
 * `shared/session/sessionId`, and the runtime config from `shared/config` —
 * so both frameworks share a single authenticated session and a single events
 * subscription identity.
 */
export function createEventsClient(): EventsClient {
    return new EventsClientImpl();
}
