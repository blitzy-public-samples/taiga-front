/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared `fetch`-based HTTP client
 * (`app/react/shared/api/httpClient.ts`) — the FOUNDATIONAL adapter every
 * migrated React Kanban/Backlog `/api/v1/` request flows through in the
 * AngularJS 1.5.10 -> React 18 coexistence migration.
 *
 * These specs pin the framework-agnostic re-implementation of the AngularJS
 * request pipeline so the requests the FROZEN Django backend sees are
 * byte-identical to the incumbent `$tgHttp` traffic:
 *
 *   - URL JOIN — reproduces `UrlsService.resolve` (`app/coffee/modules/base/
 *     urls.coffee:34-37`): base and path are joined as
 *     `trimEnd(base,'/') + '/' + trimStart(path,'/')`, yielding exactly ONE
 *     separator regardless of a trailing/leading slash.
 *   - HEADER UNION — `$tgHttp.headers()` (`app/coffee/modules/base/http.coffee:
 *     17-35`) merged with the `app.coffee` per-method defaults
 *     (`app/coffee/app.coffee:590-602`): `X-Session-Id` on every request,
 *     `Accept-Language` when truthy, `Authorization: Bearer <token>` ONLY when a
 *     token is present, and `Content-Type: application/json` on WRITE verbs only
 *     (never on GET). Per-call headers are merged last.
 *   - GET PARAMS — serialized to a query string, skipping `null`/`undefined`;
 *     only GET serializes params.
 *   - EMPTY-BODY TOLERANCE — bulk-ordering endpoints answer `204 No Content`; an
 *     empty body resolves to `null`, never a JSON.parse throw.
 *   - NON-2xx — a failed response throws an `HttpError` (an `Error` subclass)
 *     carrying `.status` and the (defensively parsed) `.data` body.
 *
 * The suite is intentionally hermetic: it imports ONLY the module under test
 * (which internally pulls the sibling `../config` / `../session` adapters) and
 * drives every branch by installing the SAME shared globals/storage the
 * AngularJS client uses — `window.taigaConfig`, `window.taiga.sessionId`, and
 * `localStorage 'token'` — plus a per-test `global.fetch` mock. There is NO
 * AngularJS/CoffeeScript import, NO Playwright, NO browser launch and NO real
 * network access, so it runs headlessly and deterministically under jsdom and
 * counts toward the >=70% line-coverage gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are provided globally
 * by `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

import httpClient from '../api/httpClient';
// Type-only import (project runs with `isolatedModules`, so types that are used
// solely in annotations must be imported with `import type`).
import type { HttpError } from '../api/httpClient';

// ---------------------------------------------------------------------------
// fetch stubbing helpers
// ---------------------------------------------------------------------------

/** Shape of a single stubbed `fetch` response for {@link stubFetch}. */
type FetchStub = {
  /** `Response.ok`; defaults to `true`. Set `false` to exercise the error path. */
  ok?: boolean;
  /** HTTP status code; defaults to `200`. */
  status?: number;
  /** Response headers, read by `getWithHeaders` via `.get(name)`. */
  headers?: Record<string, string>;
  /**
   * Response body. `null`/`undefined` -> empty body (`204`-style); a string is
   * sent verbatim; any other value is JSON-stringified.
   */
  body?: unknown;
};

/**
 * Builds a minimal duck-typed stand-in for the parts of the `fetch` `Response`
 * the client actually touches: `ok`, `status`, an async `text()`, and a
 * `headers` object exposing `.get(name)`. The header container is a PLAIN object
 * with a `get` method (not a real `Headers`) — sufficient because the client
 * only ever calls `response.headers.get(...)` (surfaced via `getWithHeaders`).
 */
function buildFetchResult({
  ok = true,
  status = 200,
  headers = {},
  body = null,
}: FetchStub) {
  const text =
    body === null || body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

  return {
    ok,
    status,
    headers: {
      get: (name: string): string | null =>
        name in headers ? headers[name] : null,
    },
    text: async (): Promise<string> => text,
  };
}

/** The mocked global `fetch`, typed as a jest mock for call inspection. */
const fetchMock = (): jest.Mock => global.fetch as unknown as jest.Mock;

/**
 * Queues ONE stubbed `fetch` response (consumed FIFO before the empty-200
 * default installed in `beforeEach`). Call it in tests that assert on a specific
 * response body, status, or headers.
 */
function stubFetch(stub: FetchStub = {}): void {
  fetchMock().mockResolvedValueOnce(buildFetchResult(stub));
}

/** Reads the `[url, init]` a given `fetch` call (default: the first) received. */
const callArgs = (index = 0): [string, RequestInit] =>
  fetchMock().mock.calls[index] as [string, RequestInit];

/**
 * Reads a header value from a captured `RequestInit`, tolerating BOTH the
 * plain-object header map the client currently builds AND a `Headers` instance
 * (so these assertions survive a future refactor to `new Headers(...)`).
 * Returns `undefined` when the header is absent, so callers can assert presence
 * with `toBe(...)` and absence with `toBeUndefined()`.
 */
function readHeader(init: RequestInit, name: string): string | undefined {
  const raw = init.headers;

  if (!raw) {
    return undefined;
  }

  if (raw instanceof Headers) {
    const value = raw.get(name);
    return value === null ? undefined : value;
  }

  const map = raw as unknown as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}

// The API base used by the suite. Deliberately WITHOUT a trailing slash so the
// URL-join tests can prove the single-separator guarantee for both forms.
const API_BASE = 'https://host/api/v1';

// ---------------------------------------------------------------------------
// Shared runtime setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Install the SAME shared globals/storage the AngularJS client uses; the
  // client re-derives them at CALL TIME (never snapshotted at module load).
  window.taigaConfig = { api: API_BASE, eventsUrl: null, defaultLanguage: 'en' };
  window.taiga = { sessionId: 'sid-1' };
  localStorage.clear();
  // StorageService JSON-serializes values, so the token is stored WITH quotes;
  // `getToken()` reads it back via `JSON.parse`.
  localStorage.setItem('token', JSON.stringify('tkn-1'));

  // Fresh fetch mock per test. A default empty-200 resolution lets
  // request-inspection tests run without stubbing a response explicitly;
  // response-specific tests override the FIRST call via `stubFetch`.
  global.fetch = jest.fn() as unknown as typeof fetch;
  fetchMock().mockResolvedValue(buildFetchResult({}));
});

afterEach(() => {
  // Reset mock state/implementations and clear every shared global so no state
  // leaks across tests.
  jest.resetAllMocks();
  delete window.taigaConfig;
  delete window.taiga;
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// URL construction — UrlsService.resolve parity (urls.coffee:34-37)
// ---------------------------------------------------------------------------

describe('httpClient — URL construction', () => {
  it('joins a slashless base and a bare path with exactly one separator', async () => {
    await httpClient.get('userstories');

    const [url] = callArgs();
    expect(url).toBe('https://host/api/v1/userstories');
  });

  it('collapses a trailing base slash + leading path slash to a single separator', async () => {
    window.taigaConfig = {
      api: 'https://host/api/v1/',
      eventsUrl: null,
      defaultLanguage: 'en',
    };

    await httpClient.get('/userstories');

    const [url] = callArgs();
    expect(url).toBe('https://host/api/v1/userstories');
  });

  it('serializes GET params into a query string, skipping null/undefined', async () => {
    await httpClient.get('milestones', { project: 3, skip: null, name: 'x' });

    const [url] = callArgs();
    expect(url).toContain('milestones?');
    expect(url).toContain('project=3');
    expect(url).toContain('name=x');
    // The `null` param must NOT serialize as the literal string "null".
    expect(url).not.toContain('skip');
  });

  it('appends no query string when there are no serializable params', async () => {
    await httpClient.get('userstories');

    const [url] = callArgs();
    expect(url).toBe('https://host/api/v1/userstories');
    expect(url).not.toContain('?');
  });
});

// ---------------------------------------------------------------------------
// Headers — $tgHttp.headers() + app.coffee per-method defaults parity
// ---------------------------------------------------------------------------

describe('httpClient — headers', () => {
  it('sends X-Session-Id, Accept-Language and Bearer token but NO Content-Type on GET', async () => {
    await httpClient.get('userstories');

    const [, init] = callArgs();
    expect(readHeader(init, 'X-Session-Id')).toBe('sid-1');
    expect(readHeader(init, 'Accept-Language')).toBe('en');
    expect(readHeader(init, 'Authorization')).toBe('Bearer tkn-1');
    // The single header difference vs writes: GET carries no Content-Type.
    expect(readHeader(init, 'Content-Type')).toBeUndefined();
  });

  it('omits Authorization entirely when no token is present', async () => {
    localStorage.removeItem('token');

    await httpClient.get('userstories');

    const [, init] = callArgs();
    expect(readHeader(init, 'Authorization')).toBeUndefined();
    // X-Session-Id is still always present.
    expect(readHeader(init, 'X-Session-Id')).toBe('sid-1');
  });

  it('merges caller-supplied per-call headers on top of the managed set', async () => {
    await httpClient.get('userstories', undefined, {
      headers: { 'X-Custom': '9' },
    });

    const [, init] = callArgs();
    expect(readHeader(init, 'X-Custom')).toBe('9');
    // Managed headers remain intact alongside the extra one.
    expect(readHeader(init, 'X-Session-Id')).toBe('sid-1');
  });
});

// ---------------------------------------------------------------------------
// Write verbs & body handling
// ---------------------------------------------------------------------------

describe('httpClient — write verbs and body handling', () => {
  it('POST sets the verb, Content-Type and a JSON-stringified body', async () => {
    await httpClient.post('userstories/bulk_create', { a: 1 });

    const [, init] = callArgs();
    expect(init.method).toBe('POST');
    expect(readHeader(init, 'Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('PUT and PATCH set their verb and Content-Type: application/json', async () => {
    await httpClient.put('userstories/1', { v: 1 });
    await httpClient.patch('userstories/1', { v: 2 });

    const [, putInit] = callArgs(0);
    const [, patchInit] = callArgs(1);

    expect(putInit.method).toBe('PUT');
    expect(readHeader(putInit, 'Content-Type')).toBe('application/json');
    expect(putInit.body).toBe(JSON.stringify({ v: 1 }));

    expect(patchInit.method).toBe('PATCH');
    expect(readHeader(patchInit, 'Content-Type')).toBe('application/json');
    expect(patchInit.body).toBe(JSON.stringify({ v: 2 }));
  });

  it('DELETE sets its verb + Content-Type and forwards a body when provided', async () => {
    await httpClient.delete('userstories/7', { id: 7 });

    const [, init] = callArgs();
    expect(init.method).toBe('DELETE');
    expect(readHeader(init, 'Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ id: 7 }));
  });

  it('never attaches a body to a GET request', async () => {
    await httpClient.get('userstories', { project: 1 });

    const [, init] = callArgs();
    expect(init.body).toBeUndefined();
  });

  it('forwards an AbortSignal straight through to fetch', async () => {
    const controller = new AbortController();

    await httpClient.get('userstories', undefined, { signal: controller.signal });

    const [, init] = callArgs();
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

describe('httpClient — response normalization', () => {
  it('parses a JSON body and returns it from get()', async () => {
    stubFetch({ body: { id: 7 } });

    const result = await httpClient.get<{ id: number }>('x');
    expect(result).toEqual({ id: 7 });
  });

  it('resolves an empty / 204 body to null instead of throwing', async () => {
    stubFetch({ status: 204, body: null });

    const result = await httpClient.get('x');
    expect(result).toBeNull();
  });

  it('getWithHeaders returns { data, headers, status } with a readable Headers.get', async () => {
    stubFetch({
      status: 200,
      headers: { 'Taiga-Info-Total-Opened-Milestones': '5' },
      body: [{ id: 1 }],
    });

    const result = await httpClient.getWithHeaders<Array<{ id: number }>>('milestones');
    expect(result.status).toBe(200);
    expect(result.headers.get('Taiga-Info-Total-Opened-Milestones')).toBe('5');
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('throws an HttpError carrying status and parsed data on a non-2xx response', async () => {
    stubFetch({ ok: false, status: 404, body: { detail: 'nope' } });

    expect.assertions(4);
    try {
      await httpClient.get('x');
    } catch (caught) {
      const error = caught as HttpError;
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(404);
      expect(error.data).toEqual({ detail: 'nope' });
      expect(error.message).toContain('404');
    }
  });

  it('leaves HttpError.data undefined when the error body is not valid JSON', async () => {
    stubFetch({ ok: false, status: 500, body: '<html>oops</html>' });

    expect.assertions(2);
    try {
      await httpClient.get('x');
    } catch (caught) {
      const error = caught as HttpError;
      expect(error.status).toBe(500);
      expect(error.data).toBeUndefined();
    }
  });
});
