/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { MountContext } from "../types";
import { readLiveToken } from "../auth/token";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
    body?: unknown;
    headers?: Record<string, string>;
    enablePagination?: boolean;
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

/** Low-level fetch wrapper: applies headers, JSON-encodes the body, parses the response. */
export const request = async <T>(
    context: MountContext,
    method: HttpMethod,
    url: string,
    options: RequestOptions = {},
): Promise<HttpResponse<T>> => {
    const headers: Record<string, string> = {
        ...buildHeaders(context, method),
        ...(options.headers ?? {}),
    };

    if (method === "GET" && !options.enablePagination) {
        headers["x-disable-pagination"] = "1";
    }

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
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
