/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Dependency-free `fetch` wrapper for the React Kanban/Backlog screens.
 *
 * It talks to the FROZEN Django `/api/v1/` contract and reuses the EXACT same
 * authenticated session as the surviving AngularJS 1.5.10 application, by
 * reading the shared token / session-id / runtime-config through the sibling
 * `shared/session` and `shared/config` adapters (never re-deriving them).
 *
 * The header and URL-join behavior below is a faithful port of the AngularJS
 * HTTP stack:
 *   - per-request headers: app/coffee/modules/base/http.coffee (L17-35)
 *   - default headers:      app/coffee/app.coffee (L590-602)
 *   - URL join:             app/coffee/modules/base/urls.coffee (resolve, L34-37)
 *   - CRUD verb mapping:    app/coffee/modules/base/repository.coffee
 *
 * There is intentionally NO axios (forbidden) and no other runtime dependency:
 * the global `fetch` (available in the browser and in the Jest jsdom test
 * environment) is used directly, resolved at call time so unit tests can stub
 * `window.fetch`.
 */

import { getApiUrl, getDefaultLanguage } from "../config/taigaConfig";
import { clearSession, getToken } from "../session/auth";
import { getSessionId } from "../session/sessionId";
import {
    currentNextUrl,
    getInterceptorHooks,
    is401RecoveryEligible,
    refreshSession,
} from "./httpInterceptor";

/** HTTP verbs used by the migrated screens. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A primitive query-parameter value. `null` / `undefined` params are omitted. */
export type QueryParamValue = string | number | boolean | null | undefined;

/** Query-string parameters; array values are appended as repeated keys. */
export interface QueryParams {
    [key: string]: QueryParamValue | ReadonlyArray<string | number | boolean>;
}

/** Options accepted by {@link request}. */
export interface RequestOptions {
    /** Query-string parameters serialized onto the URL. */
    params?: QueryParams;
    /** Extra request headers (e.g. `x-disable-pagination`). Default headers win on conflict. */
    headers?: Record<string, string>;
    /**
     * Request body. A `FormData` value is sent as multipart (used for attachment
     * uploads); anything else is serialized with `JSON.stringify`.
     */
    body?: unknown;
    /** Optional abort signal. */
    signal?: AbortSignal;
}

/** Successful response envelope. `headers` is exposed for callers that read count headers. */
export interface HttpResponse<T> {
    data: T;
    status: number;
    headers: Headers;
}

/**
 * Error thrown for any non-2xx response. Carries the parsed body so callers can
 * surface blocked/archived (403/451) responses and field-validation errors.
 */
export class HttpError extends Error {
    public readonly status: number;
    public readonly statusText: string;
    public readonly body: unknown;
    public readonly url: string;

    constructor(status: number, statusText: string, body: unknown, url: string) {
        super(`HTTP ${status} ${statusText} for ${url}`);
        // Explicit assignments (rather than parameter properties) keep behavior
        // clear and correct under `useDefineForClassFields`.
        this.name = "HttpError";
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.url = url;
        // Restore the prototype chain so `instanceof HttpError` works after the
        // TypeScript `extends Error` down-level emit.
        Object.setPrototypeOf(this, HttpError.prototype);
    }
}

/**
 * Recognize an optimistic-concurrency (version) conflict from the FROZEN Django
 * `/api/v1/` contract.
 *
 * The backend's OCC mixin (`taiga-back` `taiga/projects/occ/mixins.py`) raises
 * `WrongArguments({"version": "The version doesn't match with the current one"})`
 * when a write carries a stale `version`. `WrongArguments` extends `BadRequest`,
 * whose inherited `status_code` is **HTTP 400** — NOT 409. The 400 response body
 * is the raw detail dict `{ "version": "..." }` (see
 * `taiga/base/exceptions.format_exception`, which passes a dict detail through
 * unchanged).
 *
 * Callers therefore cannot discriminate a version conflict on the HTTP status
 * alone: it is a `400` whose parsed body carries a `version` field. This
 * predicate centralizes that check so every save / status / points / reorder
 * recovery path treats the conflict uniformly (reloading to pick up the fresh
 * server version), while still tolerating a literal `409` defensively should the
 * contract ever change.
 */
export function isVersionConflict(err: unknown): boolean {
    if (!(err instanceof HttpError)) {
        return false;
    }

    // Defensive: honor a literal 409 even though the current contract returns 400.
    if (err.status === 409) {
        return true;
    }

    // The authoritative signal: a 400 whose body is an object carrying `version`.
    return (
        err.status === 400 &&
        typeof err.body === "object" &&
        err.body !== null &&
        "version" in (err.body as Record<string, unknown>)
    );
}

/**
 * Join the configured API base URL with a relative path, mirroring the
 * AngularJS `UrlsService.resolve` (`urls.coffee` L34-37):
 * `trimEnd(base, "/") + "/" + trimStart(path, "/")`.
 */
export function buildUrl(path: string): string {
    const base = getApiUrl().replace(/\/+$/, "");
    const suffix = path.replace(/^\/+/, "");

    return `${base}/${suffix}`;
}

/** Serialize query parameters, skipping null/undefined and expanding arrays into repeated keys. */
function buildQueryString(params?: QueryParams): string {
    if (!params) {
        return "";
    }

    const search = new URLSearchParams();

    for (const key of Object.keys(params)) {
        const value = params[key];

        if (value === null || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                search.append(key, String(item));
            }
        } else {
            search.append(key, String(value));
        }
    }

    const queryString = search.toString();

    return queryString ? `?${queryString}` : "";
}

/**
 * Build the request headers, faithfully reproducing the AngularJS behavior:
 * - `Authorization: Bearer <token>` ONLY when a token exists (http.coffee L21-23).
 * - `Accept-Language: <lang>` always, falling back to "en" (app.coffee L592).
 * - `X-Session-Id: <sessionId>` always (app.coffee L593, L601).
 * - `Content-Type: application/json` only for write methods carrying a body
 *   (app.coffee L591; GET carries no Content-Type).
 *
 * Caller-supplied `extraHeaders` are applied FIRST so the mandatory defaults win
 * on any key conflict — matching `http.coffee` `request()` where the service
 * headers override the caller headers.
 */
function buildHeaders(
    method: HttpMethod,
    hasBody: boolean,
    extraHeaders?: Record<string, string>,
): Record<string, string> {
    const headers: Record<string, string> = {};

    if (extraHeaders) {
        for (const key of Object.keys(extraHeaders)) {
            headers[key] = extraHeaders[key];
        }
    }

    const token = getToken();
    if (token !== null) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    headers["Accept-Language"] = getDefaultLanguage() || "en";
    headers["X-Session-Id"] = getSessionId();

    const isWriteMethod =
        method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    if (hasBody && isWriteMethod) {
        headers["Content-Type"] = "application/json";
    }

    return headers;
}

/**
 * Parse a response body: `204` (and empty bodies) become `undefined`; otherwise
 * the text is JSON-parsed, falling back to the raw text when it is not JSON.
 */
async function parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return undefined;
    }

    const text = await response.text();
    if (text === "") {
        return undefined;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

/**
 * Issue the underlying `fetch`, replicating the AngularJS OFFLINE interceptor
 * branch (`status == 0` → `errorHandlingService.error()`, app.coffee L620-623):
 * a rejected `fetch` (no HTTP response — DNS/connection/offline) fires the
 * `onOffline` hook, then the ORIGINAL rejection is re-thrown UNCHANGED so
 * callers (and the existing "propagates the fetch rejection unchanged" contract)
 * see the exact same error object.
 */
async function doFetch(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (networkError) {
        getInterceptorHooks().onOffline(networkError);
        throw networkError;
    }
}

/**
 * Perform an HTTP request against the API. Resolves to an {@link HttpResponse}
 * on 2xx; throws {@link HttpError} (with the parsed body) on any non-2xx status.
 * Network failures propagate the underlying `fetch` rejection unchanged.
 *
 * The request also replicates the AngularJS global HTTP interceptors that the
 * React `fetch` path would otherwise bypass (QA finding [ERR-2]):
 *   - 401 (recovery-eligible path): attempt a single token refresh + retry with
 *     the renewed Bearer token; if refresh fails, fire `onSessionExpired`
 *     (redirect to login) and surface the 401 as usual
 *     (authHttpIntercept, app.coffee L624-701).
 *   - 451: fire `onBlocked` (blocked-project surface) before throwing
 *     (blockingIntercept, app.coffee L768-772).
 */
export async function request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    const url = buildUrl(path) + buildQueryString(options.params);
    const hasBody = options.body !== undefined && options.body !== null;
    // [M-10] `FormData` bodies (attachment uploads) are sent as multipart: they
    // are NOT JSON-stringified, and the JSON `Content-Type` header is omitted so
    // the browser sets the correct `multipart/form-data; boundary=…` itself.
    const isFormDataBody =
        hasBody && typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers = buildHeaders(method, hasBody && !isFormDataBody, options.headers);

    const init: RequestInit = { method, headers };
    if (hasBody) {
        init.body = isFormDataBody
            ? (options.body as FormData)
            : JSON.stringify(options.body);
    }
    if (options.signal) {
        init.signal = options.signal;
    }

    let response = await doFetch(url, init);

    // --- 401: token-refresh + single retry, else redirect-to-login ----------
    if (response.status === 401 && is401RecoveryEligible(path)) {
        const refreshedToken = await refreshSession();

        if (refreshedToken !== null) {
            // Retry the ORIGINAL request once with the renewed bearer token, the
            // React analog of re-issuing `response.config` (app.coffee L634-636).
            const retryHeaders: Record<string, string> = {
                ...(init.headers as Record<string, string>),
                Authorization: `Bearer ${refreshedToken}`,
            };
            response = await doFetch(url, { ...init, headers: retryHeaders });
        } else {
            // No refresh token, or the refresh was rejected: the session is over.
            // Clear the stale credentials BEFORE redirecting, mirroring the
            // AngularJS `removeUser()` that precedes the login redirect
            // (app.coffee L629-630, L642) — otherwise the invalid token would
            // survive and provoke repeated 401s on any subsequent request.
            clearSession();
            getInterceptorHooks().onSessionExpired(currentNextUrl());
        }
    }

    // --- 451: blocked project (fires on the final response) ------------------
    if (response.status === 451) {
        getInterceptorHooks().onBlocked();
    }

    const body = await parseBody(response);

    if (!response.ok) {
        throw new HttpError(response.status, response.statusText, body, url);
    }

    return {
        data: body as T,
        status: response.status,
        headers: response.headers,
    };
}

/** GET convenience wrapper. */
export function httpGet<T = unknown>(
    path: string,
    params?: QueryParams,
    headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
    return request<T>("GET", path, { params, headers });
}

/** POST convenience wrapper (JSON body). */
export function httpPost<T = unknown>(
    path: string,
    body?: unknown,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    return request<T>("POST", path, { ...options, body });
}

/** PUT convenience wrapper (JSON body). */
export function httpPut<T = unknown>(
    path: string,
    body?: unknown,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    return request<T>("PUT", path, { ...options, body });
}

/** PATCH convenience wrapper (JSON body). */
export function httpPatch<T = unknown>(
    path: string,
    body?: unknown,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    return request<T>("PATCH", path, { ...options, body });
}

/** DELETE convenience wrapper. */
export function httpDelete<T = unknown>(
    path: string,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    return request<T>("DELETE", path, options);
}
