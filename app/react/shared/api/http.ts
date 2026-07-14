/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { MountContext } from "../types";
import { readLiveToken, readStoredRefresh, clearStoredSession } from "../auth/token";
import { notifyAuthChanged, notifyAuthLost } from "../auth/authEvents";
import { resolveUrl } from "./urls";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
    body?: unknown;
    headers?: Record<string, string>;
    enablePagination?: boolean;
    /**
     * Optional cancellation signal (finding M9). Threaded straight into the
     * underlying `fetch`, so a superseded in-flight request (e.g. a stale
     * board/backlog reload replaced by a newer one, or an unmounting screen) can
     * be aborted; the aborted `fetch` rejects with an `AbortError`, which the
     * calling hook distinguishes from a real failure and ignores.
     */
    signal?: AbortSignal;
    /**
     * Optional multipart body (finding M1: attachment upload). When present the
     * request is sent as `multipart/form-data`: the {@link FormData} instance is
     * handed to `fetch` UNSERIALIZED and the JSON `Content-Type` the trusted
     * header builder adds for mutations is dropped, so the browser can set the
     * correct `multipart/form-data; boundary=...` header itself. This mirrors the
     * legacy `attachmentsService.upload` `FormData` POST. When set, {@link body}
     * is ignored. The trusted bearer / session / negotiation headers (finding
     * M10) are still merged last and remain immutable.
     */
    formData?: FormData;
}

export interface HttpResponse<T> {
    data: T;
    headers: Headers;
    status: number;
}

/** Error thrown for non-2xx responses; carries status + parsed body. */
export class ApiError extends Error {
    readonly status: number;

    readonly data: unknown;

    constructor(status: number, data: unknown, message?: string) {
        super(message ?? `Request failed with status ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
        Object.setPrototypeOf(this, ApiError.prototype);
    }
}

const MUTATING: ReadonlyArray<HttpMethod> = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Header names OWNED by this trusted transport layer (finding M10). Callers
 * (feature hooks) supply only benign, request-specific headers via
 * `RequestOptions.headers`; they MUST NOT be able to override the security- and
 * negotiation-critical headers the client sets itself. If a caller-supplied key
 * matches one of these (compared case-insensitively), it is dropped BEFORE the
 * trusted headers are merged, so it can never strip the bearer / session id,
 * downgrade `Accept`/`Accept-Language` content negotiation, forge the body
 * `Content-Type`, or flip the pagination directive. The trusted headers are then
 * merged LAST, making them authoritative regardless of caller input.
 */
const PROTECTED_HEADERS: ReadonlyArray<string> = [
    "authorization",
    "x-session-id",
    "accept",
    "accept-language",
    "content-type",
    "x-disable-pagination",
];

/**
 * Module-level single-flight guard for the token refresh (finding C3), mirroring
 * the legacy `authHttpIntercept` `retry = { inProgress, promise }` in
 * `app/coffee/app.coffee`. While a refresh is in flight, every concurrent 401
 * awaits the SAME promise instead of firing a stampede of `/auth/refresh` POSTs.
 */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * `true` when `url` targets the token-refresh endpoint itself. A 401 from the
 * refresh call must NOT trigger another refresh (the legacy interceptor guards
 * this with `response.config.url.includes('/auth/refresh')`), preventing an
 * infinite refresh loop.
 */
const isRefreshUrl = (url: string): boolean => url.indexOf("/auth/refresh") !== -1;

/**
 * `true` when the browser is currently on the login route. Mirrors the legacy
 * `$location.url().indexOf('/login') == -1` guard so a 401 raised while already
 * unauthenticated does not attempt a refresh or a redirect loop. Defensive: the
 * two migrated screens never render on `/login`, but a stray request must fail
 * closed rather than loop.
 */
const isOnLoginPage = (): boolean => {
    if (typeof window === "undefined" || !window.location) {
        return false;
    }
    return (window.location.pathname || "").indexOf("/login") !== -1;
};

/**
 * Perform a SINGLE-FLIGHT token refresh against the frozen `/auth/refresh`
 * endpoint (finding C3), reproducing the legacy interceptor's recovery:
 *
 *   1. Read the persisted refresh token (`$tgStorage` "refresh"). Absent ->
 *      resolve `null` (unrecoverable; the caller logs out).
 *   2. POST `{ refresh }` to `urls.resolve("refresh")`.
 *   3. On success, persist the new `auth_token` (+ rotated `refresh`) into
 *      `localStorage` exactly as `$tgStorage.set` did, announce the credential
 *      change to the same document (finding M11) so the mounted screen/WS pick
 *      up the fresh token, and resolve the new bearer.
 *   4. On any transport/HTTP/parse failure, resolve `null`.
 *
 * The in-flight promise is shared across concurrent callers and cleared once
 * settled, so the next 401 after a completed cycle starts a fresh attempt.
 */
const performTokenRefresh = (context: MountContext): Promise<string | null> => {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    const attempt = (async (): Promise<string | null> => {
        const refreshToken = readStoredRefresh();
        if (!refreshToken) {
            return null;
        }

        let response: Response;
        try {
            response = await fetch(resolveUrl(context.apiUrl, "refresh"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/plain, */*",
                },
                body: JSON.stringify({ refresh: refreshToken }),
            });
        } catch {
            return null;
        }

        if (!response.ok) {
            return null;
        }

        let payload: { auth_token?: unknown; refresh?: unknown } | null = null;
        try {
            payload = (await response.json()) as { auth_token?: unknown; refresh?: unknown };
        } catch {
            return null;
        }

        const newToken = payload && typeof payload.auth_token === "string" ? payload.auth_token : "";
        if (!newToken) {
            return null;
        }

        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem("token", JSON.stringify(newToken));
                if (payload && typeof payload.refresh === "string" && payload.refresh.length > 0) {
                    localStorage.setItem("refresh", JSON.stringify(payload.refresh));
                }
            }
        } catch {
            // A storage that rejects writes — the token still flows back to the
            // immediate retry via the resolved value below.
        }

        notifyAuthChanged();
        return newToken;
    })();

    refreshInFlight = attempt;
    const clear = (): void => {
        if (refreshInFlight === attempt) {
            refreshInFlight = null;
        }
    };
    attempt.then(clear, clear);
    return attempt;
};

/**
 * Tear down the session on an unrecoverable 401 (finding C3), mirroring the
 * legacy `errorToken`: clear the persisted token/userInfo/refresh, announce the
 * loss to the same document (finding M11) so the mounted screen unmounts and its
 * WebSocket stops, and redirect to the login route with the `next` deep-link the
 * interceptor preserved. Redirect is best-effort and guarded for non-DOM hosts.
 */
const performLogout = (): void => {
    clearStoredSession();
    notifyAuthLost();

    if (typeof window !== "undefined" && window.location) {
        try {
            const loc = window.location;
            const next = `${loc.pathname || ""}${loc.search || ""}`;
            loc.href = `/login?unauthorized=true&next=${encodeURIComponent(next)}`;
        } catch {
            // Navigation unsupported (e.g. a locked-down test location) — the
            // cleared storage + auth-lost event already reflect the logout.
        }
    }
};

/**
 * Resolve the bearer token LIVE on every request (finding M8). Prefer the
 * current `$tgStorage` JSON-encoded "token" localStorage value so a JWT refresh
 * while a screen is mounted is picked up immediately; fall back to the
 * `MountContext.token` snapshot only when `localStorage` is unavailable
 * (e.g. unit tests passing a synthetic context). Missing/garbage -> no token.
 */
const resolveToken = (context: MountContext): string | null => readLiveToken(context);

/** Reuse the existing session id; never mint a new one. */
const resolveSessionId = (context: MountContext): string | null => {
    if (context.sessionId) {
        return context.sessionId;
    }
    if (typeof window !== "undefined") {
        const globalTaiga = (window as unknown as { taiga?: { sessionId?: string } }).taiga;
        if (globalTaiga && globalTaiga.sessionId) {
            return globalTaiga.sessionId;
        }
    }
    return null;
};

/**
 * Build request headers, mirroring the frozen `base/http.coffee`
 * `HttpService.headers()` + the `app.coffee` `$httpProvider` defaults, so the
 * React reads/writes hit the wire byte-for-byte like the AngularJS client:
 *
 *  - `Authorization: Bearer <token>` + `X-Session-Id` on EVERY request.
 *  - An explicit `Accept` of "application/json, text/plain" plus a wildcard on
 *    EVERY request. AngularJS seeds this via
 *    `$httpProvider.defaults.headers.common.Accept`, which applies to all verbs
 *    (GET included), so it is sent on reads and writes alike.
 *  - `Accept-Language: <language>` on EVERY request (GET included) when a
 *    language is set. The frozen `HttpService.headers()` adds this
 *    UNCONDITIONALLY and `HttpService.request()` merges it onto every verb, so
 *    the backend content-negotiates (`Vary: Accept-Language`) identically for
 *    reads as for mutations. It MUST NOT be gated behind the mutating methods.
 *  - `Content-Type: application/json` ONLY on mutations (POST/PUT/PATCH/DELETE),
 *    which are the only requests that carry a JSON body. This matches both the
 *    per-verb `$httpProvider` split (get has no Content-Type) and the absence of
 *    Content-Type in `HttpService.headers()`.
 */
export const buildHeaders = (context: MountContext, method: HttpMethod): Record<string, string> => {
    const headers: Record<string, string> = {};

    const token = resolveToken(context);
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const sessionId = resolveSessionId(context);
    if (sessionId) {
        headers["X-Session-Id"] = sessionId;
    }

    // Accept + Accept-Language are sent on EVERY request (GET included) to mirror
    // the frozen AngularJS client, whose `$httpProvider` common defaults and
    // `HttpService.headers()` merge these onto every verb.
    headers.Accept = "application/json, text/plain, */*";
    if (context.language) {
        headers["Accept-Language"] = context.language;
    }

    // Content-Type is set only for mutations, which are the requests that carry a
    // JSON body (GET/HEAD-style reads never do).
    if (MUTATING.indexOf(method) !== -1) {
        headers["Content-Type"] = "application/json";
    }

    return headers;
};

/**
 * Low-level fetch wrapper: applies headers, JSON-encodes the body, parses the
 * response, and transparently recovers a single expired-token 401.
 *
 * Header integrity (finding M10): caller-supplied `options.headers` are first
 * stripped of any {@link PROTECTED_HEADERS} name (case-insensitive), then the
 * trusted transport headers from {@link buildHeaders} (and the pagination
 * directive) are merged LAST, so a caller can never override the bearer /
 * session id / negotiation / body content-type.
 *
 * Cancellation (finding M9): `options.signal` is threaded into `fetch`; an
 * aborted request rejects and is surfaced to the caller unchanged.
 *
 * Token recovery (finding C3): a `401` (except from the refresh endpoint itself,
 * while already on `/login`, or on the post-refresh retry) triggers a
 * single-flight `/auth/refresh`; on success the request is retried exactly once
 * with the refreshed credential (read live by `buildHeaders`), and on failure
 * the session is torn down via {@link performLogout}. The `isRetry` flag makes
 * the recovery strictly one-shot, preventing loops.
 *
 * @param isRetry - Internal flag set only on the single post-refresh retry.
 */
export const request = async <T>(
    context: MountContext,
    method: HttpMethod,
    url: string,
    options: RequestOptions = {},
    isRetry = false,
): Promise<HttpResponse<T>> => {
    // M10: drop any caller header that collides with a trusted, transport-owned
    // header BEFORE merging, so the trusted values (merged last) are immutable.
    const safeCallerHeaders: Record<string, string> = {};
    if (options.headers) {
        for (const key of Object.keys(options.headers)) {
            if (PROTECTED_HEADERS.indexOf(key.toLowerCase()) === -1) {
                safeCallerHeaders[key] = options.headers[key];
            }
        }
    }

    const headers: Record<string, string> = {
        ...safeCallerHeaders,
        ...buildHeaders(context, method),
    };

    if (method === "GET" && !options.enablePagination) {
        headers["x-disable-pagination"] = "1";
    }

    const init: RequestInit = { method, headers };
    if (options.formData !== undefined) {
        // M1 multipart upload: send the FormData verbatim and DROP the JSON
        // Content-Type the trusted builder added for this mutation, so the
        // browser sets `multipart/form-data` with the correct boundary. The
        // bearer / session / negotiation headers stay merged-last + immutable
        // (M10); only the transport-owned body content-type is adjusted here.
        delete headers["Content-Type"];
        init.body = options.formData;
    } else if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
    }
    if (options.signal) {
        init.signal = options.signal;
    }

    const response = await fetch(url, init);

    const text = await response.text();
    let data: unknown = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (!response.ok) {
        // C3: recover a single expired-token 401. Never for the refresh endpoint
        // itself, never on the one-shot retry, and never while on /login.
        if (response.status === 401 && !isRetry && !isRefreshUrl(url) && !isOnLoginPage()) {
            const newToken = await performTokenRefresh(context);
            if (newToken) {
                return request<T>(context, method, url, options, true);
            }
            performLogout();
        }
        throw new ApiError(response.status, data);
    }

    return { data: data as T, headers: response.headers, status: response.status };
};

export const httpGet = <T>(context: MountContext, url: string, options?: RequestOptions): Promise<HttpResponse<T>> =>
    request<T>(context, "GET", url, options);

export const httpPost = <T>(
    context: MountContext,
    url: string,
    body?: unknown,
    options?: RequestOptions,
): Promise<HttpResponse<T>> => request<T>(context, "POST", url, { ...options, body });

export const httpPatch = <T>(
    context: MountContext,
    url: string,
    body?: unknown,
    options?: RequestOptions,
): Promise<HttpResponse<T>> => request<T>(context, "PATCH", url, { ...options, body });

export const httpPut = <T>(
    context: MountContext,
    url: string,
    body?: unknown,
    options?: RequestOptions,
): Promise<HttpResponse<T>> => request<T>(context, "PUT", url, { ...options, body });

export const httpDelete = <T>(
    context: MountContext,
    url: string,
    body?: unknown,
    options?: RequestOptions,
): Promise<HttpResponse<T>> => request<T>(context, "DELETE", url, { ...options, body });

/** Parse an integer response header (used by the sprint-list total headers); 0 when absent. */
export const parseHeaderInt = (headers: Headers, name: string): number => {
    const raw = headers.get(name);
    const parsed = raw === null ? NaN : parseInt(raw, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
};
