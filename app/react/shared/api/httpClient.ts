/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `fetch`-based HTTP client for the React coexistence layer.
 *
 * This module is the FOUNDATIONAL adapter of the React API layer in the
 * AngularJS 1.5.10 -> React 18 coexistence migration. Every `/api/v1/` request
 * the migrated React Kanban/Backlog screens make flows through this single
 * client, so the Django REST contract stays byte-identical and FROZEN. The
 * sibling adapters `userstories.ts` and `milestones.ts` call it; React never
 * hand-builds an absolute API URL anywhere else.
 *
 * It is a faithful, framework-agnostic re-implementation of three AngularJS
 * pieces, reproduced EXACTLY so the requests the frozen backend sees are
 * indistinguishable from the incumbent AngularJS `$http` traffic:
 *
 *   1. `$tgHttp` header set — `app/coffee/modules/base/http.coffee:17-35`.
 *      `headers()` adds `Authorization: "Bearer <token>"` (only when a token is
 *      present) and `Accept-Language: <preferredLanguage>`, and `request()`
 *      merges them onto the caller's headers via
 *      `_.assign({}, options.headers or {}, @.headers())`.
 *   2. `UrlsService.resolve` URL-join — `app/coffee/modules/base/urls.coffee:34-37`.
 *      The base and the relative path are joined as
 *      `trimEnd(base, "/") + "/" + trimStart(path, "/")`.
 *   3. `app.coffee` default headers — `app/coffee/app.coffee:590-602`. Writes
 *      (POST/PUT/PATCH/DELETE) carry `Content-Type: application/json`,
 *      `Accept-Language`, and `X-Session-Id`; GET carries ONLY `X-Session-Id`
 *      (no `Content-Type`).
 *
 * The base URL (`window.taigaConfig.api`), the JWT (`localStorage 'token'`), the
 * process-wide session id (`window.taiga.sessionId`), and the preferred language
 * are all re-derived — at call time — from the SAME globals/storage the
 * AngularJS client uses, via the sibling `../config` and `../session` adapters.
 * That shared runtime is precisely what keeps the `/api/v1/` contract frozen.
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from `app/coffee/**`,
 * `app/modules/**`, `app/partials/**`, `elements.js`, or `angular`. The ONLY
 * in-repo imports are the two sibling adapters `../config` and `../session`, and
 * the ONLY browser interop is the global `fetch` (called directly, never aliased
 * at module load, so specs can override `global.fetch` per test). No third-party
 * HTTP library is used.
 */

// The API base (`window.taigaConfig.api`, e.g. "http://localhost:8000/api/v1/").
// `../config` owns reading `window.taigaConfig`; read lazily at call time.
import { getApiUrl } from '../config';
// Session/auth reads shared with the AngularJS client. `../session` owns
// `localStorage 'token'` (JSON-parsed), `window.taiga.sessionId`, and the
// preferred-language precedence (userInfo.lang -> config default -> 'en').
import { getToken, getSessionId, getPreferredLanguage } from '../session';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * HTTP verbs supported by the client. These are exactly the methods the
 * AngularJS `$tgHttp` service exposes (`http.coffee:37-72`) and the four write
 * verbs whose default headers `app.coffee:596-599` configures.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Per-call request options.
 */
export interface RequestOptions {
  /**
   * Query parameters for GET requests, serialized to `?a=b&c=d`. `null` /
   * `undefined` values are skipped. Ignored for write verbs (which send their
   * payload in the body), mirroring how the adapters use `$tgHttp`.
   */
  params?: Record<string, unknown>;

  /**
   * Extra per-call headers (e.g. `{ 'x-disable-pagination': '1' }`). Merged on
   * top of the client-managed headers; see `buildHeaders`.
   */
  headers?: Record<string, string>;

  /**
   * Optional `AbortSignal`, passed straight through to `fetch` when provided so
   * callers can cancel in-flight requests (e.g. on React unmount).
   */
  signal?: AbortSignal;
}

/**
 * Result of a request: the parsed body plus the raw response metadata callers
 * may need — notably the `Headers` object, which the milestones list reads for
 * the `Taiga-Info-Total-*` pagination headers.
 */
export interface HttpResponse<T> {
  /** Parsed JSON body, or `null` for an empty / `204 No Content` response. */
  data: T;
  /** The `fetch` `Headers` object; use `.get('Taiga-Info-Total-...')`. */
  headers: Headers;
  /** The HTTP status code. */
  status: number;
}

/**
 * Error thrown on a non-2xx response. Carries the status code and any parsed
 * response body so callers (and the AngularJS-parity error handling) can react.
 */
export interface HttpError extends Error {
  /** The HTTP status code of the failed response. */
  status?: number;
  /** The parsed error body, when the response had one. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// URL-join helpers — reproduce `UrlsService.resolve` (urls.coffee:34-37)
// ---------------------------------------------------------------------------

/**
 * Trailing-slash trim, equivalent to lodash `_.trimEnd(str, "/")`
 * (`urls.coffee:35`). Implemented locally so this file pulls in no lodash.
 */
const trimEndSlash = (value: string): string => value.replace(/\/+$/, '');

/**
 * Leading-slash trim, equivalent to lodash `_.trimStart(str, "/")`
 * (`urls.coffee:36`). Implemented locally so this file pulls in no lodash.
 */
const trimStartSlash = (value: string): string => value.replace(/^\/+/, '');

/**
 * Joins the API base and a relative path with exactly one separating slash,
 * reproducing `UrlsService.resolve`'s
 * `format("%s/%s", [_.trimEnd(mainUrl, "/"), _.trimStart(url, "/")])`
 * (`urls.coffee:34-37`). A leading slash on `path` is tolerated because
 * `trimStartSlash` strips it.
 *
 * Examples:
 *   joinUrl('http://x/api/v1/', '/userstories/bulk_create')
 *     === 'http://x/api/v1/userstories/bulk_create'
 *   joinUrl('http://x/api/v1', 'milestones')
 *     === 'http://x/api/v1/milestones'
 */
const joinUrl = (base: string, path: string): string =>
  `${trimEndSlash(base)}/${trimStartSlash(path)}`;

/**
 * Serializes a params object into a query string (`{ project: 42 }` -> `?project=42`),
 * skipping `null` / `undefined` values. Returns `''` when there are no
 * serializable params so callers can append unconditionally. Uses the standard
 * `URLSearchParams` (correct percent-encoding, no third-party dependency).
 */
function toQueryString(params?: Record<string, unknown>): string {
  if (!params) {
    return '';
  }

  const usp = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // Skip absent values so they do not serialize as the literal strings
    // "null"/"undefined"; every other value is coerced to its string form.
    if (value !== null && value !== undefined) {
      usp.append(key, String(value));
    }
  }

  const qs = usp.toString();

  return qs ? `?${qs}` : '';
}

/**
 * Defensive JSON parse used ONLY for error-body extraction: returns `undefined`
 * instead of throwing when the body is not valid JSON, so building/throwing an
 * `HttpError` never itself throws a secondary parse error.
 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Header builder — reproduce `$tgHttp.headers()` (http.coffee:17-30) merged
// with the `app.coffee` default-header split (app.coffee:590-602)
// ---------------------------------------------------------------------------

/**
 * Builds the effective header set for a request, reproducing the union of the
 * AngularJS `$tgHttp.headers()` output and the `$httpProvider` per-method
 * defaults, evaluated fresh at call time (never snapshotted at module load):
 *
 *   - ALL methods:  `X-Session-Id`, `Accept-Language` (when non-empty), and
 *     `Authorization: Bearer <token>` (ONLY when a token is present).
 *   - WRITES only:  additionally `Content-Type: application/json`.
 *   - GET:          NO `Content-Type` (the single header difference vs writes).
 *
 * @param method - The HTTP verb; determines whether `Content-Type` is added.
 * @param extra  - Optional per-call headers (e.g. `x-disable-pagination`).
 * @returns A plain header map ready for `RequestInit.headers`.
 */
function buildHeaders(
  method: HttpMethod,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // X-Session-Id — set on EVERY request by the app.coffee defaults
  // (writes app.coffee:593, GET app.coffee:601). `getSessionId()` reads the
  // same `window.taiga.sessionId` the AngularJS app assigns at boot
  // (app.coffee:26) so React and AngularJS traffic correlate to one session.
  headers['X-Session-Id'] = getSessionId();

  // Accept-Language — added by $tgHttp.headers() when truthy
  // (http.coffee:26-28). `getPreferredLanguage()` reproduces the precedence
  // `userInfo?.lang || taigaConfig.defaultLanguage || 'en'` (app.coffee:796),
  // so it is effectively always non-empty, but the guard mirrors the source's
  // `if lang` check exactly.
  const lang = getPreferredLanguage();
  if (lang) {
    headers['Accept-Language'] = lang;
  }

  // Authorization — added by $tgHttp.headers() ONLY when a token is present
  // (http.coffee:21-23). `getToken()` returns the JSON-parsed bare token from
  // `localStorage 'token'`, so the header is byte-identical to the AngularJS
  // output (no surrounding quotes).
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Content-Type — present for WRITES only (app.coffee:591, applied to
  // delete/patch/post/put at app.coffee:596-599); the GET default
  // (app.coffee:600-602) deliberately omits it.
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  // Merge per-call extras last. AngularJS applies the auth headers OVER the
  // caller's headers (http.coffee:33: `_.assign({}, options.headers, @.headers())`);
  // because the only per-call extra the adapters send is `x-disable-pagination`
  // — which never collides with the session/auth/content-type keys above —
  // merging extras last is equivalent and keeps the result deterministic.
  return { ...headers, ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

/**
 * Low-level request core. Builds the URL and headers, issues the `fetch`, and
 * normalizes the response (empty-body handling + non-2xx errors).
 *
 * Reproduces the AngularJS request pipeline: the URL join of `UrlsService`
 * (`urls.coffee:34-37`), the header union of `$tgHttp` + the `app.coffee`
 * defaults, the `responseType: 'text'` empty-body tolerance of
 * `$tgHttp.post` (`http.coffee:52`), and the `JSON.stringify(data)` payload
 * handling of the write verbs.
 *
 * @typeParam T - Expected parsed-body type.
 * @param method  - HTTP verb.
 * @param path    - RELATIVE path (e.g. `'userstories/bulk_create'`); joined to
 *                  `getApiUrl()`. A leading slash is tolerated.
 * @param body    - Request payload for write verbs; `JSON.stringify`d. Ignored
 *                  for GET (which must not carry a body).
 * @param options - Query params (GET), extra headers, and/or an `AbortSignal`.
 * @returns The parsed body plus the raw `Headers` and status code.
 * @throws {HttpError} When the response status is not 2xx.
 */
async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<HttpResponse<T>> {
  // Read the base lazily at call time (never snapshot at module load) so the
  // live `window.taigaConfig.api` always wins — and so tests can set the global
  // immediately before invoking a request. Only GET serializes params into the
  // query string; write verbs carry their payload in the body.
  const url =
    joinUrl(getApiUrl(), path) +
    toQueryString(method === 'GET' ? options?.params : undefined);

  const init: RequestInit = {
    method,
    headers: buildHeaders(method, options?.headers),
  };

  // Attach a JSON body for write verbs only. `fetch` rejects a body on GET, and
  // the AngularJS GET default never sends one, so GET is always body-less here.
  if (method !== 'GET' && body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }

  // Pass the caller's abort signal straight through when provided.
  if (options?.signal) {
    init.signal = options.signal;
  }

  // Call the GLOBAL `fetch` directly (never aliased at module scope) so Jest
  // specs can override `global.fetch` per test.
  const response = await fetch(url, init);

  // Read the body as text FIRST — reproducing `$tgHttp.post`'s
  // `responseType: 'text'` (http.coffee:52) — then decide how to parse. The
  // bulk-ordering endpoints (bulk_update_kanban_order / backlog_order / …)
  // answer `204 No Content` with an empty body, which must not be JSON.parsed.
  const text = await response.text();

  // Throw on any non-2xx status. `response.ok` is true for 200-299. Parse the
  // error body defensively so constructing the error never throws.
  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status} for ${method} ${url}`,
    ) as HttpError;
    error.status = response.status;
    error.data = text ? safeJsonParse(text) : undefined;
    throw error;
  }

  // Empty body -> `null`; otherwise parse the JSON payload as `T`.
  const data = text ? (JSON.parse(text) as T) : (null as unknown as T);

  return { data, headers: response.headers, status: response.status };
}

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * The shared HTTP client. Verbs are exposed as METHODS on this object (rather
 * than standalone functions) because `delete` is a reserved word and cannot be
 * a top-level `function delete` — object method names, however, may be reserved
 * words. `get`/`post`/`put`/`patch`/`delete` return the parsed body directly;
 * `getWithHeaders` returns the full `HttpResponse` for callers that need the
 * response `Headers` (e.g. the milestones list's `Taiga-Info-Total-*`), and
 * `request` is the low-level core for advanced callers.
 */
export const httpClient = {
  /** Low-level core; returns the full `HttpResponse<T>`. */
  request,

  /**
   * GET, returning the parsed body. Query params are serialized onto the URL.
   */
  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    const res = await request<T>('GET', path, undefined, { ...options, params });
    return res.data;
  },

  /**
   * GET, returning the parsed body AND the response metadata (`headers`,
   * `status`). Used by the milestones list to read `Taiga-Info-Total-*`.
   */
  async getWithHeaders<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return request<T>('GET', path, undefined, { ...options, params });
  },

  /** POST a JSON body, returning the parsed response body (or `null` on 204). */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return (await request<T>('POST', path, body, options)).data;
  },

  /** PUT a JSON body, returning the parsed response body. */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return (await request<T>('PUT', path, body, options)).data;
  },

  /** PATCH a JSON body, returning the parsed response body. */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return (await request<T>('PATCH', path, body, options)).data;
  },

  /** DELETE (optionally with a JSON body), returning the parsed response body. */
  async delete<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return (await request<T>('DELETE', path, body, options)).data;
  },
};

export default httpClient;
