/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Same-document authentication event bridge.
 *
 * Finding M11 (same-tab auth propagation): the browser `storage` event fires
 * ONLY in *other* documents/tabs — never in the document that performed the
 * `localStorage.setItem` / `removeItem`. Consequently a token refresh, login,
 * or logout that happens INSIDE the currently-mounted React screen (e.g. the
 * `http.ts` single-flight refresh in finding C3, or a same-tab logout) would
 * NOT be observed by the `bootstrap.ts` `storage` listener, leaving the mounted
 * screen and its WebSocket authenticated with a stale credential.
 *
 * This module provides a tiny, framework-agnostic `window`-scoped custom-event
 * bus so the auth layer can announce credential changes to the same document:
 *
 *   - {@link AUTH_CHANGED_EVENT} — the stored token changed (login / refresh).
 *     Listeners (the Custom-Element adapter) re-read the live token and remount
 *     with a fresh {@link import("../types").MountContext} so both the REST
 *     client and the WebSocket auth frame pick up the new credential — exactly
 *     the behaviour the legacy `$rootScope.$broadcast("auth:login"/"auth:refresh")`
 *     drove in `app/coffee/modules/auth.coffee`.
 *   - {@link AUTH_LOST_EVENT} — the stored token was cleared (logout / refresh
 *     failure). Listeners tear down the mounted tree and its live subscriptions.
 *
 * It intentionally imports nothing from AngularJS and touches no application
 * state directly; it is a pure notification seam consumed by `bootstrap.ts`.
 */

/** Dispatched to `window` when the stored bearer token changes (login/refresh). */
export const AUTH_CHANGED_EVENT = "taiga:auth-changed";

/** Dispatched to `window` when authentication is cleared (logout/refresh failure). */
export const AUTH_LOST_EVENT = "taiga:auth-lost";

/**
 * `true` when a same-document event bus is usable. Guarded so the auth layer can
 * run unchanged in non-DOM environments (SSR / a bare Node unit context) where
 * `window`/`CustomEvent` are absent.
 */
function canDispatch(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.dispatchEvent === "function" &&
        typeof CustomEvent === "function"
    );
}

/**
 * Announce that the stored token changed within THIS document (login/refresh),
 * so same-tab listeners can remount with the fresh credential. No-op when no DOM
 * event bus is available.
 */
export function notifyAuthChanged(): void {
    if (!canDispatch()) {
        return;
    }
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

/**
 * Announce that authentication was cleared within THIS document (logout / token
 * refresh failure), so same-tab listeners can tear down live subscriptions.
 * No-op when no DOM event bus is available.
 */
export function notifyAuthLost(): void {
    if (!canDispatch()) {
        return;
    }
    window.dispatchEvent(new CustomEvent(AUTH_LOST_EVENT));
}
