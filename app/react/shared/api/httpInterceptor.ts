/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * HTTP interceptor policy for the React Kanban/Backlog screens (QA finding
 * [ERR-2]).
 *
 * The React roots issue their own `fetch` requests and therefore DO NOT pass
 * through the AngularJS global `$httpProvider.interceptors`
 * (`authHttpIntercept` + `blockingIntercept`, app/coffee/app.coffee L609-707,
 * L759-787). Losing those interceptors meant a React request that returned:
 *   - a network/offline failure   → nothing (Angular showed a full-page error),
 *   - HTTP 401 mid-session         → the user was stranded with no re-auth,
 *   - HTTP 451 (project blocked)   → nothing (Angular showed the blocked page).
 *
 * This module re-implements those exact behaviors in the React HTTP layer so
 * `shared/api/httpClient.ts` can invoke them, WITHOUT touching `app.coffee`
 * (frozen per AAP §0.7.2) and while preserving the shared, single-session model
 * (§0.6.1): a refreshed token is written back to the SAME localStorage keys so
 * AngularJS sees the renewed session immediately.
 *
 * The side effects are expressed as an injectable {@link InterceptorHooks}
 * policy with SAFE defaults:
 *   - `onOffline` / `onBlocked` emit a non-blocking notification onto the shared
 *     bus (rendered by `NotificationHost`); the Backlog root upgrades these to a
 *     full-page overlay to mirror `errorHandlingService.error()/block()`.
 *   - `onSessionExpired` performs the login redirect, but ONLY in a real browser
 *     — under jsdom (unit tests) it is a no-op, because a jsdom navigation is
 *     reported through `console.error` and would trip the global console guard.
 * Tests inject their own hooks to assert the decisions deterministically.
 */

import { getApiUrl, getBaseHref, getDefaultLanguage } from "../config/taigaConfig";
import { getRefreshToken, setRefreshToken, setToken } from "../session/auth";
import { getSessionId } from "../session/sessionId";
import { notifyError } from "../notifications/notificationCenter";
import { t } from "../i18n/translate";

/**
 * User-facing messages. English literals today; Phase-9 i18n routes these
 * through the shared gettext catalog. Kept as named constants so tests pin the
 * exact copy and a future catalog lookup has a single call site.
 */
export const OFFLINE_MESSAGE =
    "Unable to reach the server. Please check your connection and try again.";
export const BLOCKED_MESSAGE = "This project is blocked and cannot be modified.";

/** Side-effect policy invoked by the HTTP client for intercepted conditions. */
export interface InterceptorHooks {
    /** A network/offline failure occurred (fetch rejected). */
    onOffline: (error: unknown) => void;
    /** The server responded 451 — the project is blocked. */
    onBlocked: () => void;
    /** A 401 could not be recovered by refresh; the session is over. */
    onSessionExpired: (nextUrl: string) => void;
}

/**
 * True only in a real, navigable browser. jsdom (the unit-test DOM) is excluded
 * because its `window.location` navigation is unimplemented and surfaces via
 * `console.error`; its user-agent reliably contains "jsdom".
 */
export function isBrowserNavigable(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof navigator !== "undefined" &&
        !/jsdom/i.test(navigator.userAgent)
    );
}

/**
 * The current front-end location used as the `next=` return target, mirroring
 * AngularJS `$location.url()`. Returns "/" when no location is available.
 */
export function currentNextUrl(): string {
    if (typeof window === "undefined" || !window.location) {
        return "/";
    }
    const { pathname, search, hash } = window.location;
    const url = `${pathname || "/"}${search || ""}${hash || ""}`;
    return url === "" ? "/" : url;
}

/**
 * Build the login URL with the `unauthorized`/`next` query, mirroring
 * `$navUrls.resolve("login") + '?unauthorized=true&next=' + nextUrl`
 * (app.coffee L648). The login route is baseHref-relative ("/login",
 * base.coffee L42).
 */
export function buildLoginUrl(nextUrl: string): string {
    // baseHref is read lazily through the config adapter so late merges / test
    // overrides are honored (default "/").
    const base = getBaseHref().replace(/\/+$/, "");
    return `${base}/login?unauthorized=true&next=${encodeURIComponent(nextUrl)}`;
}

/**
 * Navigate the browser to the login screen (mirrors the AngularJS
 * `window.location.href = ...` redirect). No-op outside a navigable browser so
 * it is safe under jsdom / SSR.
 */
export function redirectToLogin(nextUrl: string): void {
    if (!isBrowserNavigable()) {
        return;
    }
    window.location.assign(buildLoginUrl(nextUrl));
}

/** The default, production side-effect policy. */
const defaultHooks: InterceptorHooks = {
    onOffline: (): void => {
        // Routed through the shared catalog ([i18n]); OFFLINE_MESSAGE is the
        // English fallback (COMMON.CONNECTION_ERROR is not yet in the catalog).
        notifyError(t("COMMON.CONNECTION_ERROR", OFFLINE_MESSAGE));
    },
    onBlocked: (): void => {
        notifyError(t("PROJECT.BLOCKED_PROJECT.MODIFY_ERROR", BLOCKED_MESSAGE));
    },
    onSessionExpired: (nextUrl: string): void => {
        redirectToLogin(nextUrl);
    },
};

/** The active policy (defaults; overridable by the app root and by tests). */
let hooks: InterceptorHooks = { ...defaultHooks };

/** Override one or more interceptor side effects (app bootstrap / tests). */
export function setInterceptorHooks(partial: Partial<InterceptorHooks>): void {
    hooks = { ...hooks, ...partial };
}

/** Restore the default side-effect policy (test isolation / host unmount). */
export function resetInterceptorHooks(): void {
    hooks = { ...defaultHooks };
}

/** The active side-effect policy (read by the HTTP client). */
export function getInterceptorHooks(): InterceptorHooks {
    return hooks;
}

/**
 * Whether a 401 on this request path is eligible for the refresh-and-retry
 * recovery. The refresh call itself and the auth/login endpoints are excluded
 * so a failed refresh never loops (mirrors app.coffee L616 and the
 * `$location.url().indexOf('/login') == -1` guard L624).
 */
export function is401RecoveryEligible(path: string): boolean {
    const p = path.toLowerCase();
    return !p.includes("auth/refresh") && !p.includes("auth/login") && !p.includes("/login");
}

/** In-flight refresh, so concurrent 401s share ONE refresh (Angular `retry`). */
let pendingRefresh: Promise<string | null> | null = null;

/**
 * Perform the raw refresh POST. Uses `fetch` directly (NOT the HTTP client) so
 * a 401 on the refresh call can never recurse back into this recovery path.
 * Sends the shared-session headers but NO Authorization (the refresh token in
 * the body is the credential). Returns the new access token, or null on any
 * failure.
 */
async function performRefresh(refresh: string): Promise<string | null> {
    try {
        const base = getApiUrl().replace(/\/+$/, "");
        const url = `${base}/auth/refresh`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept-Language": getDefaultLanguage() || "en",
            "X-Session-Id": getSessionId(),
        };

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ refresh }),
        });

        if (!response.ok) {
            return null;
        }

        const text = await response.text();
        const data = (text === "" ? {} : JSON.parse(text)) as {
            auth_token?: unknown;
            refresh?: unknown;
        };

        const authToken = typeof data.auth_token === "string" ? data.auth_token : null;
        if (authToken === null) {
            return null;
        }

        // Persist the rotated pair to the SHARED session (auth.coffee L631-632).
        setToken(authToken);
        if (typeof data.refresh === "string") {
            setRefreshToken(data.refresh);
        }

        return authToken;
    } catch {
        // Network failure during refresh — treat as unrecoverable (no console).
        return null;
    }
}

/**
 * Attempt to refresh the session after a 401, coalescing concurrent callers
 * onto a single in-flight refresh. Resolves to the new access token on success,
 * or null when there is no refresh token or the refresh was rejected. Never
 * throws.
 */
export function refreshSession(): Promise<string | null> {
    if (pendingRefresh !== null) {
        return pendingRefresh;
    }

    const refresh = getRefreshToken();
    if (refresh === null) {
        // Nothing to refresh with — the caller redirects to login.
        return Promise.resolve(null);
    }

    pendingRefresh = performRefresh(refresh).finally(() => {
        pendingRefresh = null;
    });

    return pendingRefresh;
}
