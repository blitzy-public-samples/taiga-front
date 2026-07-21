/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * client.ts — the centralized versioned-REST adapter for the React (Kanban +
 * Backlog) screens that run in-place inside the AngularJS 1.5.10 shell.
 *
 * WHAT THIS IS
 *   This is the React-side equivalent of the AngularJS data layer, namely
 *   `app/coffee/modules/resources.coffee` + `app/coffee/modules/base/http.coffee`
 *   + `app/coffee/modules/base/urls.coffee` + `app/coffee/modules/base/repository.coffee`.
 *   Its single job is to make React traffic BYTE-FOR-BYTE indistinguishable from
 *   AngularJS traffic to the Django REST backend: the same base URL, the
 *   same `Authorization: Bearer <jwt>` and `X-Session-Id` correlation headers on
 *   every call, the same endpoint paths, and the same JSON request bodies. It
 *   re-expresses that identical HTTP contract using the browser `fetch` API.
 *
 * WHAT THIS IS NOT
 *   - It NEVER imports `resources.coffee`, `$tgHttp`, `$tgUrls`, or any other
 *     AngularJS service, and it pulls in NONE of the globally-loaded libraries
 *     (Immutable.js, dragula, dom-autoscroller, checksley). Its only dependency
 *     is the shared `../session` bridge.
 *   - It does NOT own login: it never mints the FIRST token — the AngularJS
 *     login screen still does that. It merely reads whatever token/session the
 *     shell established, and keeps that token fresh on 401 (see below).
 *
 * 401 TOKEN-REFRESH PARITY (review finding F-SEC-02)
 *   React's `fetch` calls are NOT seen by the AngularJS `$httpProvider`
 *   interceptor (`app.coffee:608-707`), which is the shell's single-flight
 *   token-refresh/retry/logout state machine. If this adapter did nothing on a
 *   `401`, a React screen would hard-fail on an expired token while the
 *   AngularJS screens silently refreshed — a behavioural divergence AND a
 *   security regression (a stale/compromised token would linger in storage).
 *   To stay byte-for-byte equivalent, `request()` therefore PORTS that exact
 *   state machine (see {@link refreshAuthToken}):
 *     - on a `401` (except for the `/auth/refresh` call itself — loop
 *       prevention, mirroring the coffee `if url.includes('/auth/refresh')`
 *       guard), it performs a SINGLE-FLIGHT `POST /auth/refresh` so concurrent
 *       401s share ONE refresh round-trip;
 *     - on success it persists the new `auth_token` + `refresh` and RETRIES the
 *       original request exactly once with the rotated Bearer token;
 *     - on failure (or a missing refresh token) it CLEARS the stored session
 *       (`token`/`refresh`/`userInfo`) and redirects to `/login`, exactly as the
 *       coffee `errorToken` path does, then rejects with the original error.
 *   Because both the shell and this adapter read/write the identical
 *   `localStorage` keys, a refresh performed by either side is honoured by both.
 *
 * FRESH-READ INVARIANT
 *   The base URL, JWT token, language, and session id are read FRESH on every
 *   request (via `getApiUrl()` / `getAuthToken()` / `getLanguage()` /
 *   `getSessionId()` from `../session`), never cached at module load.
 *   Consequently a token rotated by EITHER the AngularJS 401 interceptor OR this
 *   adapter's own refresh propagates automatically on the very next call — and
 *   the one-shot retry after a refresh here picks up the new token the same way.
 *
 * Toolchain: pure TypeScript 5.4.5 under `strict` (no React/JSX here), Node
 * v16.19.1 compatible, bundled by esbuild into `dist/js/react.js`.
 */

import {
    getApiUrl,
    getAuthToken,
    getSessionId,
    getLanguage,
    getRefreshToken,
    setAuthToken,
    setRefreshToken,
    clearSession,
    redirectToLogin,
} from '../session';

/* ========================================================================== *
 * Phase 2 — Public types
 * ========================================================================== */

/**
 * The HTTP verbs this adapter supports. Mirrors the verbs used by the AngularJS
 * repository layer: POST (`create`), PATCH/PUT (`save`), GET (`queryOne`/
 * `queryMany`/`queryOneRaw`), and DELETE (`remove`).
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * A flat map of query-string parameters. Values are serialized into the URL
 * query string; `null` / `undefined` entries are skipped entirely so that
 * optional parameters can be passed through unconditionally.
 */
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Per-request configuration accepted by {@link request}.
 *
 * - `body`   — the (unserialized) request payload; JSON-encoded automatically
 *              for non-GET verbs.
 * - `params` — query-string parameters (see {@link QueryParams}).
 * - `headers`— extra request headers merged LAST, so a caller may override any
 *              default header (e.g. the `x-disable-pagination` header that the
 *              AngularJS `queryMany`/`queryOne` helpers attach).
 */
export interface RequestConfig {
    body?: unknown;
    params?: QueryParams;
    headers?: Record<string, string>;
}

/**
 * The low-level result of {@link request}. It deliberately exposes the raw
 * response `headers` so header-sensitive callers (e.g. `milestones.ts` reading
 * the `Taiga-Info-Total-*-Milestones` pagination headers, matching the
 * AngularJS `queryMany(..., headers=true)` contract) can inspect them.
 */
export interface ApiResponse<T = unknown> {
    data: T;
    status: number;
    headers: Headers;
}

/**
 * Error thrown for any non-2xx HTTP response. The parsed response `body` is
 * preserved so callers can surface backend validation errors (for example the
 * Django `{ _error_message: "..." }` payload) to the user, exactly as the
 * AngularJS `promise.error (data, status)` handlers did.
 */
export class ApiError extends Error {
    public status: number;
    public body: unknown;

    constructor(status: number, body: unknown, message?: string) {
        super(message ?? `Request failed with status ${status}`);

        // Restore the prototype chain so `instanceof ApiError` holds regardless
        // of the compilation target esbuild emits when bundling `react.js`.
        Object.setPrototypeOf(this, ApiError.prototype);

        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

/* ========================================================================== *
 * Phase 3 — URL join + query-string serialization (private helpers)
 * ========================================================================== */

/**
 * Resolve an endpoint `path` against the configured API `base`, mirroring the
 * AngularJS `UrlsService.resolve` join (`app/coffee/modules/base/urls.coffee:34-37`)
 * — `format("%s/%s", [_.trimEnd(mainUrl, "/"), _.trimStart(url, "/")])` — while
 * ENFORCING that the resulting URL stays on the configured API origin.
 *
 * SECURITY INVARIANT (CWE-200 — off-origin credential exfiltration)
 *   `request()` attaches the JWT `Authorization: Bearer` token and the
 *   `X-Session-Id` correlation id to EVERY call. Those credentials must never be
 *   transmitted to a foreign origin. This function therefore REJECTS — before a
 *   single header is built or `fetch` is invoked — any endpoint that resolves to
 *   an origin other than the configured API base's origin. The rejection is a
 *   thrown `Error` (surfaced as a rejected promise to callers), so no request is
 *   ever issued and no credential can leak.
 *
 *   This is faithful to the legacy contract, not a behaviour change: the
 *   AngularJS `UrlsService.resolve` only ever expanded named endpoint templates
 *   against the API `mainUrl` (urls.coffee:23-37), so an arbitrary off-origin
 *   endpoint was never a legitimate input, and every React caller
 *   (`api/userstories.ts`, `api/milestones.ts`) passes a relative `/…` path.
 *   The AAP's "one same-origin deployable client" directive (§0.6.1) is upheld.
 *
 * JOIN SEMANTICS (unchanged for the relative paths every caller actually uses)
 *   A single joining `/` is produced with no risk of a double slash: any
 *   trailing slash(es) are stripped from `base` and any leading slash(es) from
 *   `path`. An absolute (`http(s)://…`) or protocol-relative (`//host/…`)
 *   endpoint is used verbatim ONLY when it is same-origin with the API base;
 *   otherwise it is rejected.
 *
 * @throws {Error} when `path` resolves to an origin other than the API origin.
 * @example resolveUrl('a/b/', '/c') === 'a/b/c'  // trailing + leading slash collapse to one
 * @example resolveUrl('a/b',  'c')  === 'a/b/c'  // absent slashes yield exactly one
 */
function resolveUrl(base: string, path: string): string {
    // An absolute (`http(s)://…`) or protocol-relative (`//host/…`) endpoint is
    // used verbatim; a relative path is joined onto the base (single-slash),
    // exactly as urls.coffee:34-37 does for the relative paths every caller uses.
    const isAbsolute = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path);
    const candidate = isAbsolute
        ? path
        : `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

    // Enforce the same-origin invariant. `window.location.href` resolves a
    // relative config base (e.g. `/api/v1/`) or a protocol-relative candidate to
    // a concrete origin so the comparison is always well-defined.
    const apiOrigin = new URL(base, window.location.href).origin;
    const resolvedOrigin = new URL(candidate, window.location.href).origin;
    if (resolvedOrigin !== apiOrigin) {
        // Report only the origins (never the full URL) so a sensitive query
        // string can never be echoed into logs or error surfaces.
        throw new Error(
            `Refusing to issue a credentialed request to a cross-origin endpoint ` +
                `(${resolvedOrigin}); the configured API origin is ${apiOrigin}.`,
        );
    }

    return candidate;
}

/**
 * Serialize a {@link QueryParams} map into a query string beginning with `?`,
 * or the empty string when there are no defined parameters. Both keys and
 * values are percent-encoded; `null` / `undefined` values are skipped, and
 * numbers/booleans are coerced with `String(value)`.
 */
function buildQueryString(params?: QueryParams): string {
    if (!params) {
        return '';
    }

    const parts: string[] = [];

    for (const key of Object.keys(params)) {
        const value = params[key];

        // Skip absent values so optional params can be passed unconditionally.
        if (value === null || value === undefined) {
            continue;
        }

        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }

    return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/* ========================================================================== *
 * Phase 4 — Header assembly (private helper, called fresh per request)
 * ========================================================================== */

/**
 * Build the request headers for a single call, reproducing the AngularJS header
 * contract exactly:
 *
 * - `Content-Type: application/json` whenever a body is sent (`app.coffee:591`).
 * - `Authorization: Bearer <jwt>` only when a token is present
 *   (`http.coffee:21-23`).
 * - `Accept-Language: <lang>` on EVERY verb when a language is resolvable
 *   (`http.coffee:25-28` — `$tgHttp` attaches it in `request()`, which GET,
 *   POST, PUT, PATCH and DELETE all funnel through, so it is NOT verb-specific).
 *   The value comes from `getLanguage()`, which mirrors
 *   `$translate.preferredLanguage()` and tracks live language switches.
 * - `X-Session-Id: <sessionId>` only when a session id is present
 *   (`app.coffee:593,601` — set on GET and on bodied verbs alike).
 *
 * The token, language, and session id are read FRESH here on every call (never
 * hoisted or cached at module load), so refreshes and language switches
 * performed by the AngularJS shell are picked up automatically. Caller-supplied
 * `extra` headers are merged LAST so they can override any default (e.g.
 * `x-disable-pagination`).
 */
function buildHeaders(hasBody: boolean, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};

    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }

    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Accept-Language on every verb, mirroring `$tgHttp.headers()`
    // (http.coffee:25-28). Omitted only when no language is resolvable, exactly
    // as the coffee omits it when `preferredLanguage()` is falsy.
    const lang = getLanguage();
    if (lang) {
        headers['Accept-Language'] = lang;
    }

    const sessionId = getSessionId();
    if (sessionId) {
        headers['X-Session-Id'] = sessionId;
    }

    return { ...headers, ...extra };
}

/* ========================================================================== *
 * Phase 5 — Single-flight 401 token refresh (ports app.coffee:608-707)
 * ========================================================================== */

/**
 * The refresh endpoint path, matching the AngularJS URL map entry
 * `"refresh": "/auth/refresh"` (`resources.coffee:18`). Kept as a module
 * constant so both the loop-prevention guard in {@link request} and the refresh
 * POST in {@link refreshAuthToken} reference the SAME literal.
 */
const REFRESH_PATH = '/auth/refresh';

/**
 * The in-flight refresh promise, or `null` when no refresh is running. This is
 * the React equivalent of the coffee interceptor's shared
 * `retry = { inProgress, promise }` object (`app.coffee:610-613`): every 401
 * that arrives while a refresh is underway JOINS this one promise instead of
 * firing its own `POST /auth/refresh`, so a burst of concurrent 401s triggers
 * exactly ONE refresh round-trip.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * The shape of the `/auth/refresh` success body — `{ auth_token, refresh }`,
 * exactly the fields the coffee reads (`responseRefresh.data.auth_token` /
 * `.refresh`, `app.coffee:632-633`).
 */
interface RefreshResponse {
    auth_token: string;
    refresh: string;
}

/**
 * Execute one `POST /auth/refresh`, persisting the rotated tokens on success.
 * On ANY failure — a missing refresh token, a non-2xx refresh response, or a
 * network/parse error — it performs the coffee `errorToken` logout (clears the
 * stored session and redirects to `/login`) and resolves `false`. It never
 * throws, so callers can branch on the boolean.
 *
 * This is the body of the single-flight; {@link refreshAuthToken} is the
 * de-duplicating wrapper callers actually invoke.
 */
async function performRefresh(): Promise<boolean> {
    const refreshToken = getRefreshToken();

    // coffee: the `else` branch when `storage.get("refresh")` is falsy — there
    // is nothing to refresh with, so log out and bail (app.coffee:648-663).
    if (!refreshToken) {
        clearSession();
        redirectToLogin();
        return false;
    }

    try {
        // The refresh POST goes through the same same-origin `resolveUrl` guard
        // and carries `Content-Type: application/json`; it deliberately does NOT
        // recurse through `request()` (no 401 handling on the refresh call
        // itself — loop prevention).
        const url = resolveUrl(getApiUrl(), REFRESH_PATH);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: refreshToken }),
        });

        if (!response.ok) {
            // coffee `request.catch` → errorToken (app.coffee:636-641).
            clearSession();
            redirectToLogin();
            return false;
        }

        const text = await response.text();
        const data = (text ? JSON.parse(text) : {}) as Partial<RefreshResponse>;

        // A 2xx with a malformed body (no auth_token) is treated as a failure so
        // we never persist an `undefined` token.
        if (!data.auth_token) {
            clearSession();
            redirectToLogin();
            return false;
        }

        // coffee refreshTokenReponse: persist both rotated tokens
        // (app.coffee:632-633).
        setAuthToken(data.auth_token);
        if (data.refresh) {
            setRefreshToken(data.refresh);
        }
        return true;
    } catch {
        // Network or JSON error → same logout path as a rejected refresh.
        clearSession();
        redirectToLogin();
        return false;
    }
}

/**
 * Single-flight wrapper over {@link performRefresh}. The FIRST 401 starts the
 * refresh and stores its promise; concurrent 401s return that SAME promise; and
 * once it settles the slot is reset so a genuinely later token expiry can
 * refresh again. Resolves `true` when a new token was stored (caller should
 * retry), `false` when refresh was impossible/failed (caller should surface the
 * original error — the session has already been cleared).
 */
function refreshAuthToken(): Promise<boolean> {
    if (!refreshInFlight) {
        refreshInFlight = performRefresh().finally(() => {
            // Reset once, after the shared promise settles, so the next 401 can
            // start a fresh refresh (coffee resets `retry.inProgress = false`).
            refreshInFlight = null;
        });
    }
    return refreshInFlight;
}

/* ========================================================================== *
 * Phase 6 — Core request()
 * ========================================================================== */

/**
 * Perform a single HTTP request against the versioned REST backend and return
 * the parsed body together with the status and raw response headers.
 *
 * Behaviour reproduced from the AngularJS data layer:
 * - The URL is `getApiUrl()` joined with `path` (see {@link resolveUrl}) plus any
 *   serialized query string.
 * - A JSON body is sent for every non-GET verb that supplies one
 *   (`repository.coffee` `create`/`save`).
 * - The response body is parsed gracefully: an empty body (e.g. `204 No
 *   Content`) resolves `data` to `undefined`; a non-JSON body resolves to its
 *   raw text.
 * - Any non-2xx response throws an {@link ApiError} carrying the status and the
 *   parsed body.
 *
 * 401 handling ports the AngularJS single-flight refresh/retry/logout state
 * machine (see {@link refreshAuthToken} and the module header): a `401` on any
 * call other than `/auth/refresh` itself triggers a shared refresh; on success
 * the request is retried exactly once with the rotated token; on failure the
 * session is cleared, the client is redirected to `/login`, and the original
 * error is thrown.
 *
 * @typeParam T The expected shape of the parsed response body.
 */
async function request<T = unknown>(
    method: HttpMethod,
    path: string,
    config: RequestConfig = {},
): Promise<ApiResponse<T>> {
    // `resolveUrl` throws for a cross-origin endpoint BEFORE any header is built
    // or `fetch` is invoked, so credentials are never transmitted off-origin.
    const url = resolveUrl(getApiUrl(), path) + buildQueryString(config.params);

    const hasBody = config.body !== undefined && config.body !== null && method !== 'GET';

    // A closure that issues one attempt. `buildHeaders` is called INSIDE so the
    // `Authorization` header is rebuilt from storage each time — the post-refresh
    // retry therefore automatically carries the rotated Bearer token, exactly as
    // the coffee reset `response.config.headers.Authorization` before retrying.
    //
    // Intentionally leave `credentials` at the fetch default ('same-origin'):
    // AngularJS `$http` authenticates with the Bearer token, not cookies. Every
    // request reaching this point is guaranteed same-origin with the API base by
    // `resolveUrl`, so no cross-origin credentialed request is ever made.
    const attempt = (): Promise<Response> => {
        const headers = buildHeaders(hasBody, config.headers);
        const init: RequestInit = { method, headers };
        if (hasBody) {
            init.body = JSON.stringify(config.body);
        }
        return fetch(url, init);
    };

    let response = await attempt();

    // 401 single-flight refresh + one retry. The `/auth/refresh` call itself is
    // exempt (loop prevention), mirroring the coffee guard
    // `if response.config.url.includes('/auth/refresh') return $q.reject(...)`.
    if (response.status === 401 && !path.includes(REFRESH_PATH)) {
        const refreshed = await refreshAuthToken();
        if (refreshed) {
            // coffee: retry the ORIGINAL request once, now with the new token.
            response = await attempt();
        }
        // If the refresh failed, `refreshAuthToken` has already cleared the
        // session and redirected; we fall through and throw the original error.
    }

    // Parse the body gracefully so empty (204) and non-JSON responses are safe.
    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (!response.ok) {
        throw new ApiError(response.status, data, `${method} ${path} failed with ${response.status}`);
    }

    return { data: data as T, status: response.status, headers: response.headers };
}

/* ========================================================================== *
 * Phase 7 — Public `api` object
 *
 * The convenience verb methods resolve directly to the parsed response body for
 * ergonomic callers. The raw `request` is exposed on the object (and as a named
 * export) so header-sensitive callers such as `milestones.ts` can reach
 * `ApiResponse.headers`.
 * ========================================================================== */

export const api = {
    request,

    /**
     * Issue a GET request, resolving to the parsed response body. Optional
     * query parameters are serialized onto the URL.
     */
    get<T = unknown>(
        path: string,
        params?: QueryParams,
        options?: Omit<RequestConfig, 'params' | 'body'>,
    ): Promise<T> {
        return request<T>('GET', path, { ...options, params }).then((r) => r.data);
    },

    /** Issue a POST request with a JSON body, resolving to the parsed body. */
    post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestConfig, 'body'>): Promise<T> {
        return request<T>('POST', path, { ...options, body }).then((r) => r.data);
    },

    /** Issue a PATCH request with a JSON body, resolving to the parsed body. */
    patch<T = unknown>(path: string, body?: unknown, options?: Omit<RequestConfig, 'body'>): Promise<T> {
        return request<T>('PATCH', path, { ...options, body }).then((r) => r.data);
    },

    /** Issue a PUT request with a JSON body, resolving to the parsed body. */
    put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestConfig, 'body'>): Promise<T> {
        return request<T>('PUT', path, { ...options, body }).then((r) => r.data);
    },

    /**
     * Issue a DELETE request, resolving to the parsed body. Named `del` to avoid
     * the reserved word; this is the canonical name consumers import.
     */
    del<T = unknown>(path: string, options?: Omit<RequestConfig, 'body'>): Promise<T> {
        return request<T>('DELETE', path, { ...options }).then((r) => r.data);
    },
};

// Also expose the low-level `request` as a named export for callers that prefer
// a direct import over the `api` object; both reference the same function.
export { request };
