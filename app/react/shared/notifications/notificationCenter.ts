/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Framework-agnostic notification bus for the React Kanban/Backlog screens.
 *
 * WHY THIS EXISTS (QA finding [ERR-1] + [ERR-2]):
 * The migrated React screens run inside the surviving AngularJS document but do
 * NOT flow through the AngularJS `$confirm.notify(...)` / `errorHandlingService`
 * machinery. Before this module every recoverable failure (a failed inline
 * status change, a rejected drag-reorder, a delete that the server refused, an
 * offline blip) was routed to `console.error` only, so the user got NO feedback
 * — a systemic silent-failure gap flagged by QA. This tiny publish/subscribe bus
 * is the single place non-blocking user notifications are emitted; a React
 * `NotificationHost` subscribes and renders them, and `shared/api/httpInterceptor`
 * uses it for the offline/blocked interceptor surfaces.
 *
 * DESIGN NOTES:
 * - Pure TypeScript: no React import, no DOM access, no `console` usage. This
 *   keeps it trivially unit-testable and safe to import from the HTTP layer.
 * - The exported name is `AppNotification` (never the DOM `Notification`) to
 *   avoid shadowing the browser global.
 * - Listeners are held in an insertion-ordered `Set` so a subscriber added while
 *   a notification is being dispatched is not invoked for the in-flight event
 *   (snapshot-on-dispatch), matching typical event-emitter semantics.
 */

/** Severity of a user-facing notification. Drives the rendered styling class. */
export type NotificationLevel = "error" | "success" | "info";

/** A single user-facing notification emitted onto the bus. */
export interface AppNotification {
    /** Monotonically increasing id, unique within a page session (React key). */
    readonly id: number;
    /** Severity — selects the notification styling. */
    readonly level: NotificationLevel;
    /** Human-readable, already-localized message text (never raw error detail). */
    readonly message: string;
}

/** A bus subscriber. Receives every notification emitted after it subscribed. */
export type NotificationListener = (notification: AppNotification) => void;

/** Registered listeners, in insertion order. */
const listeners = new Set<NotificationListener>();

/** Monotonic id source so React can key notifications stably. */
let sequence = 0;

/**
 * Subscribe to the notification bus. Returns an idempotent unsubscribe function
 * (calling it more than once is harmless). A React host typically calls this in
 * an effect and returns the unsubscribe as the cleanup.
 */
export function subscribeNotifications(listener: NotificationListener): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

/**
 * Emit a notification to every current subscriber and return the created record.
 *
 * A snapshot of the listeners is taken before dispatch so that mutating the set
 * from within a listener (e.g. unsubscribing) cannot corrupt the iteration, and
 * a listener that was added *during* dispatch does not receive the in-flight
 * event. A throwing listener never blocks the others.
 */
export function notify(level: NotificationLevel, message: string): AppNotification {
    sequence += 1;
    const notification: AppNotification = { id: sequence, level, message };

    for (const listener of Array.from(listeners)) {
        try {
            listener(notification);
        } catch {
            // A misbehaving subscriber must never break the emitter or starve
            // the remaining subscribers. Deliberately swallowed (no console).
        }
    }

    return notification;
}

/** Convenience: emit an `error`-level notification. */
export function notifyError(message: string): AppNotification {
    return notify("error", message);
}

/** Convenience: emit a `success`-level notification. */
export function notifySuccess(message: string): AppNotification {
    return notify("success", message);
}

/** Convenience: emit an `info`-level notification. */
export function notifyInfo(message: string): AppNotification {
    return notify("info", message);
}

/**
 * Remove every subscriber. Intended for test isolation (so one spec's listeners
 * never leak into the next); production code relies on per-host unsubscribe.
 */
export function clearNotificationListeners(): void {
    listeners.clear();
}
