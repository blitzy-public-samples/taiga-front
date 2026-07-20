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

// ---------------------------------------------------------------------------
// Query serialization — reproduce AngularJS `$httpParamSerializer`
// (angular.js `ngParamSerializer` / `serializeValue` / `encodeUriQuery`,
// angular 1.5.10)
// ---------------------------------------------------------------------------

/**
 * Reproduces AngularJS `encodeUriQuery(val)` (angular.js:1494) with the
 * default `pctEncodeSpaces = false` used by `$httpParamSerializer`.
 *
 * `encodeURIComponent` is applied first, then the sub-delimiters AngularJS
 * leaves LITERAL in a query component are un-escaped (`@ : $ , ;`), and spaces
 * are encoded as `+` (not `%20`). This byte-for-byte matches the query strings
 * the AngularJS `$http` produced, which the frozen `/api/v1/` backend already
 * accepts — `URLSearchParams` diverged here (it percent-encodes `@ : $ , ;` and
 * also uses `+` for spaces, so the special-character handling differed).
 *
 * The `gi` flags mirror the AngularJS source exactly: `%40 %3A %2C %3B` are
 * replaced case-insensitively, while `%24` (`$`) and `%20` (space) are
 * case-sensitive (there are no lowercase hex variants of those two).
 */
function encodeUriQuery(val: string): string {
  return encodeURIComponent(val)
    .replace(/%40/gi, '@')
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%3B/gi, ';')
    .replace(/%20/g, '+');
}

/**
 * Reproduces AngularJS `serializeValue(v)` (angular.js:10746):
 *   - a `Date` becomes its `toISOString()` string;
 *   - any other non-null object becomes its JSON serialization (`toJson`, which
 *     for the plain params objects the React screens send is exactly
 *     `JSON.stringify`; AngularJS's `toJson` additionally strips `$$`-prefixed
 *     keys, which never appear in these params);
 *   - primitives are returned as their string form (numbers, booleans — e.g.
 *     `false` -> `"false"`), matching `encodeUriQuery(encodeURIComponent(...))`
 *     coercion of the raw primitive.
 *
 * `Date` is detected with `Object.prototype.toString` (AngularJS `isDate`) so it
 * is robust across realms, not just `instanceof Date`.
 */
function serializeValue(v: unknown): string {
  if (v !== null && typeof v === 'object') {
    return Object.prototype.toString.call(v) === '[object Date]'
      ? (v as Date).toISOString()
      : JSON.stringify(v);
  }

  return String(v);
}

/**
 * Reproduces AngularJS `ngParamSerializer` (angular.js:10773) EXACTLY:
 *   - keys are sorted alphabetically (`Object.keys(obj).sort()`, `forEachSorted`);
 *   - `null` and `undefined` values are skipped (and ONLY those — the bundled
 *     1.5.10 source does not skip functions here, so a function value falls
 *     through to `serializeValue`, which never occurs for Taiga params but is
 *     reproduced faithfully rather than diverging);
 *   - array values emit a REPEATED key (`foo=bar&foo=baz`), each element passed
 *     through `serializeValue`;
 *   - scalar/object values emit a single `key=value`, value passed through
 *     `serializeValue`;
 *   - both key and value are `encodeUriQuery`-encoded.
 *
 * @returns The `&`-joined query string WITHOUT a leading `?` (empty when no
 *   serializable params remain).
 */
function serializeParams(params?: Record<string, unknown>): string {
  if (!params) {
    return '';
  }

  const parts: string[] = [];
  // `forEachSorted` iterates keys in ascending sort order.
  const keys = Object.keys(params).sort();

  for (const key of keys) {
    const value = params[key];

    // `if (value === null || isUndefined(value)) return;` — skip only null and
    // undefined, matching the bundled serializer precisely.
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      // Repeated key for each element (`foo=bar&foo=baz`).
      for (const item of value) {
        parts.push(`${encodeUriQuery(key)}=${encodeUriQuery(serializeValue(item))}`);
      }
    } else {
      parts.push(`${encodeUriQuery(key)}=${encodeUriQuery(serializeValue(value))}`);
    }
  }

  return parts.join('&');
}

/**
 * Serializes a params object into a query string with a leading `?`
 * (`{ project: 42 }` -> `?project=42`), or `''` when nothing is serializable so
 * callers can append unconditionally. Delegates to {@link serializeParams},
 * which reproduces AngularJS `$httpParamSerializer` byte-for-byte.
 */
function toQueryString(params?: Record<string, unknown>): string {
  const qs = serializeParams(params);

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
// Response body transform — reproduce AngularJS `defaultHttpResponseTransform`
// (angular.js:10866) + `isJsonLike` (angular.js:10882)
// ---------------------------------------------------------------------------

/** AngularJS `JSON_PROTECTION_PREFIX` (angular.js:10738): the XSSI guard prefix. */
const JSON_PROTECTION_PREFIX = /^\)]\}',?\n/;
/** AngularJS `JSON_START` (angular.js:10733): a body "looks like JSON" if it starts with `[` or `{`. */
const JSON_START = /^\[|^\{(?!\{)/;
/** AngularJS `JSON_ENDS` (angular.js:10734): the matching terminator for each start. */
const JSON_ENDS: Record<string, RegExp> = {
  '[': /]$/,
  '{': /}$/,
};

/**
 * Reproduces AngularJS `isJsonLike(str)` (angular.js:10882): a trimmed body is
 * JSON-like when it starts with `[`/`{` (per {@link JSON_START}) AND ends with
 * the matching `]`/`}` (per {@link JSON_ENDS}).
 */
function isJsonLike(str: string): boolean {
  const jsonStart = str.match(JSON_START);
  return jsonStart !== null && JSON_ENDS[jsonStart[0]].test(str);
}

/**
 * Reproduces AngularJS `defaultHttpResponseTransform` (angular.js:10866) — the
 * default `$http` response transform that ran on EVERY AngularJS response — so
 * the React screens parse response bodies the same way `$tgHttp` did (F20):
 *
 *   1. Strip the XSSI protection prefix (`)]}',\n`) and trim whitespace.
 *   2. An empty/whitespace-only body resolves to `null` — this is the ONE
 *      intentional refinement over AngularJS (which returns the empty string):
 *      the bulk-ordering endpoints answer `204 No Content` and the adapters
 *      consume `null`, and this preserves the established, tested contract.
 *   3. Parse as JSON ONLY when the `Content-Type` starts with `application/json`
 *      OR the body is JSON-like ({@link isJsonLike}); otherwise return the RAW
 *      text. This is the core F20 fix: an unconditional `JSON.parse` threw on a
 *      genuinely non-JSON success body (e.g. a plain-text or HTML `200`),
 *      whereas AngularJS returned such bodies as strings.
 *   4. If a body that claims/looks like JSON fails to parse, fall back to the
 *      raw text rather than throwing (a defensive superset of AngularJS, which
 *      relied on an outer try/catch; the React client must never surface a
 *      secondary parse throw on a 2xx response).
 *
 * @typeParam T - Expected parsed-body type.
 * @param text        - The raw response body text.
 * @param contentType - The response `Content-Type` header value (or `null`).
 * @returns The parsed JSON (`T`), the raw text (`T`), or `null` for an empty body.
 */
function transformResponseBody<T>(text: string, contentType: string | null): T {
  // Strip the XSSI prefix and surrounding whitespace, matching AngularJS.
  const tempData = text.replace(JSON_PROTECTION_PREFIX, '').trim();

  // Empty body -> null (204 No Content and the bulk-ordering endpoints).
  if (tempData === '') {
    return null as unknown as T;
  }

  const hasJsonContentType =
    contentType !== null && contentType.toLowerCase().indexOf('application/json') === 0;

  if (hasJsonContentType || isJsonLike(tempData)) {
    try {
      return JSON.parse(tempData) as T;
    } catch {
      // A body that declares/looks like JSON but does not parse must not throw
      // on a 2xx response; return the raw text (defensive superset of $http).
      return text as unknown as T;
    }
  }

  // Non-JSON success body (plain text / HTML): return it verbatim rather than
  // JSON.parsing it — the "unconditional JSON.parse breaks text" fix (F20).
  return text as unknown as T;
}

// ---------------------------------------------------------------------------
// Header builder — reproduce `$tgHttp.headers()` (http.coffee:17-30) merged
// with the `app.coffee` default-header split (app.coffee:590-602)
// ---------------------------------------------------------------------------

/**
 * The lower-cased names of the client-managed, PROTECTED headers a caller must
 * never be able to override (F19). `Authorization` and `Accept-Language` are
 * protected because AngularJS `$tgHttp.request()` assigns `@.headers()` LAST
 * (`_.assign({}, options.headers, @.headers())`, http.coffee:32), so the caller
 * can never clobber them. `X-Session-Id` and `Content-Type` come from the
 * `app.coffee` defaults; no legacy caller overrides them, and letting a caller
 * forge the session id or content type is exactly the injection risk F19 flags,
 * so they are protected here too. Names are compared case-insensitively so a
 * lower-cased `authorization` cannot slip past a same-case overwrite.
 */
const PROTECTED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'x-session-id',
  'content-type',
  'accept-language',
]);

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
 * HEADER PRECEDENCE (F19): the caller's extra headers are applied FIRST and the
 * client-managed protected headers LAST, so a caller can NEVER override
 * `Authorization`, `X-Session-Id`, `Content-Type`, or `Accept-Language`. This
 * reproduces AngularJS `$tgHttp.request()`'s
 * `_.assign({}, options.headers, @.headers())` (http.coffee:32), which merges
 * the auth headers OVER the caller's, and additionally protects the
 * session/content-type headers. The previous implementation merged the caller's
 * extras LAST, which let a caller clobber the bearer token / session id — the
 * exact vulnerability F19 identified. Any caller header whose name collides
 * (case-insensitively) with a protected header is dropped, so a forged
 * `authorization`/`Authorization` can neither replace nor duplicate the real one.
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

  // 1. Caller-supplied extras FIRST — but drop any key that collides
  //    (case-insensitively) with a protected header so it cannot forge or
  //    duplicate a credential/session/content-type header (F19).
  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      if (!PROTECTED_HEADER_NAMES.has(name.toLowerCase())) {
        headers[name] = value;
      }
    }
  }

  // 2. Client-managed protected headers LAST (cannot be overridden).

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

  return headers;
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
  // immediately before invoking a request.
  const base = getApiUrl();

  // Fail fast with a clear error when the API base is absent (F20). `getApiUrl()`
  // returns '' when `window.taigaConfig.api` is unset; without this guard the
  // URL would silently collapse to a ROOT-RELATIVE path (e.g.
  // `/userstories/bulk_create`), sending the request to the front-end origin
  // instead of the Django API and yielding a confusing 404/HTML response. A
  // misconfigured runtime must surface immediately, not masquerade as a network
  // error deep inside a screen.
  if (!base) {
    throw new Error(
      'Taiga API base URL is not configured: `window.taigaConfig.api` is empty. ' +
        'The React Kanban/Backlog screens cannot issue /api/v1/ requests without it.',
    );
  }

  // Only GET serializes params into the query string; write verbs carry their
  // payload in the body.
  const url =
    joinUrl(base, path) +
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

  // Parse the success body the SAME way AngularJS `$http` did (F20): JSON only
  // when the `Content-Type` is `application/json` or the body is JSON-like, and
  // the raw text otherwise — an empty body resolves to `null`. This replaces the
  // previous UNCONDITIONAL `JSON.parse(text)`, which threw on a genuinely
  // non-JSON success payload (a plain-text or HTML `200`); see
  // `transformResponseBody`.
  const data = transformResponseBody<T>(text, response.headers.get('Content-Type'));

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
