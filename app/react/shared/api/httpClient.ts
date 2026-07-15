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
import { getToken } from "../session/auth";
import { getSessionId } from "../session/sessionId";

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
    /** JSON request body; serialized with `JSON.stringify`. */
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
 * Perform an HTTP request against the API. Resolves to an {@link HttpResponse}
 * on 2xx; throws {@link HttpError} (with the parsed body) on any non-2xx status.
 * Network failures propagate the underlying `fetch` rejection unchanged.
 */
export async function request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> {
    const url = buildUrl(path) + buildQueryString(options.params);
    const hasBody = options.body !== undefined && options.body !== null;
    const headers = buildHeaders(method, hasBody, options.headers);

    const init: RequestInit = { method, headers };
    if (hasBody) {
        init.body = JSON.stringify(options.body);
    }
    if (options.signal) {
        init.signal = options.signal;
    }

    const response = await fetch(url, init);
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
