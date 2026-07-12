/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { MountContext } from "../types";

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
 * Resolve the bearer token. Prefer `MountContext.token` (already JSON-decoded by
 * the bootstrap layer); otherwise read the AngularJS `$tgStorage` JSON-encoded
 * "token" localStorage value, treating missing/garbage as no token.
 */
const resolveToken = (context: MountContext): string | null => {
    if (context.token) {
        return context.token;
    }
    try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
        if (raw === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "string" ? parsed : null;
    } catch {
        return null;
    }
};

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
 * Build request headers, mirroring `base/http.coffee` + `app.coffee` defaultHeaders:
 * bearer + X-Session-Id on every request; Content-Type + Accept-Language on mutations.
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

    if (MUTATING.indexOf(method) !== -1) {
        headers["Content-Type"] = "application/json";
        if (context.language) {
            headers["Accept-Language"] = context.language;
        }
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
