/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared `fetch`-based HTTP client
 * (`app/react/shared/api/httpClient.ts`) used by the React coexistence layer.
 *
 * These specs pin the framework-agnostic re-implementation of the AngularJS
 * request pipeline so the requests the FROZEN `/api/v1/` backend sees are
 * byte-identical to the incumbent `$tgHttp` traffic:
 *
 *   - URL JOIN — `UrlsService.resolve` (`urls.coffee:34-37`): the API base and
 *     the relative path are joined as `trimEnd(base,'/') + '/' + trimStart(path,'/')`.
 *   - HEADER UNION — `$tgHttp.headers()` (`http.coffee:17-35`) merged with the
 *     `app.coffee` per-method defaults (`app.coffee:590-602`): `X-Session-Id`
 *     and `Accept-Language` on every request, `Authorization: Bearer <token>`
 *     only when a token is present, and `Content-Type: application/json` on
 *     WRITE verbs only (never on GET).
 *   - EMPTY-BODY TOLERANCE — the bulk-ordering endpoints answer `204 No Content`;
 *     an empty body must resolve to `null`, never a JSON.parse throw.
 *   - NON-2xx — a failed response throws an `HttpError` carrying the status and
 *     the (defensively parsed) error body.
 *
 * The suite is intentionally hermetic: it imports ONLY the module under test
 * (which internally pulls the sibling `../config` / `../session` adapters) and
 * drives every branch by installing the SAME shared globals/storage the
 * AngularJS client uses — `window.taigaConfig`, `localStorage 'token'`,
 * `window.taiga.sessionId` — plus a per-test `global.fetch` stub. There is no
 * AngularJS / CoffeeScript import, no Playwright, no browser launch, and no real
 * network access, so it runs headlessly and deterministically and counts toward
 * the >=70% line-coverage gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are provided globally
 * by `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

import { httpClient } from '../httpClient';
import type { HttpError } from '../httpClient';

/**
 * Minimal duck-typed stand-in for the parts of the `fetch` `Response` the client
 * touches: `ok`, `status`, `headers`, and an async `text()`.
 */
interface FakeResponseInit {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Builds a fake `Response`-like object; `ok` is derived from the status code. */
const fakeResponse = (init: FakeResponseInit): Response => {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    text: async () => init.body ?? '',
  } as unknown as Response;
};

/** Installs the shared `window.taigaConfig` global read by `getApiUrl()`. */
const setConfig = (cfg: Record<string, unknown>): void => {
  (window as unknown as { taigaConfig?: unknown }).taigaConfig = cfg;
};

/** The mocked global `fetch`; typed as a jest mock for call inspection. */
const fetchMock = (): jest.Mock => global.fetch as unknown as jest.Mock;

/** Reads the `[url, init]` a given `fetch` call was invoked with. */
const callArgs = (idx = 0): [string, RequestInit] =>
  fetchMock().mock.calls[idx] as [string, RequestInit];

const API_BASE = 'http://localhost:8000/api/v1/';

beforeEach(() => {
  // Shared runtime the client re-derives at CALL TIME (never snapshotted).
  setConfig({ api: API_BASE, defaultLanguage: 'en', eventsUrl: null });
  window.taiga = { sessionId: 'sess-123' };
  localStorage.clear();
  localStorage.setItem('token', JSON.stringify('jwt-abc'));
  // Fresh fetch stub per test; default is an empty 200 unless overridden.
  global.fetch = jest.fn().mockResolvedValue(fakeResponse({ status: 200, body: '' })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as { taiga?: unknown }).taiga;
  delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
  localStorage.clear();
});

describe('httpClient — URL construction', () => {
  it('joins the API base and a leading-slash path with exactly one separator', async () => {
    fetchMock().mockResolvedValueOnce(fakeResponse({ body: '{"ok":true}' }));
    await httpClient.get('/userstories/bulk_update_kanban_order');
    const [url] = callArgs();
    expect(url).toBe('http://localhost:8000/api/v1/userstories/bulk_update_kanban_order');
  });

  it('tolerates a base without a trailing slash and a path without a leading slash', async () => {
    setConfig({ api: 'http://x/api/v1', defaultLanguage: 'en', eventsUrl: null });
    await httpClient.get('milestones');
    const [url] = callArgs();
    expect(url).toBe('http://x/api/v1/milestones');
  });

  it('serializes GET params into a query string, skipping null/undefined', async () => {
    await httpClient.get('userstories', { project: 42, milestone: null, q: undefined, closed: false });
    const [url] = callArgs();
    expect(url).toContain('userstories?');
    expect(url).toContain('project=42');
    expect(url).toContain('closed=false');
    expect(url).not.toContain('milestone');
    expect(url).not.toContain('q=');
  });

  it('does not append a query string when there are no serializable params', async () => {
    await httpClient.get('userstories');
    const [url] = callArgs();
    expect(url).toBe('http://localhost:8000/api/v1/userstories');
  });
});

describe('httpClient — headers (AngularJS $tgHttp + app.coffee parity)', () => {
  it('sends X-Session-Id, Accept-Language and Bearer token, but no Content-Type on GET', async () => {
    await httpClient.get('userstories');
    const [, init] = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Session-Id']).toBe('sess-123');
    expect(headers['Accept-Language']).toBe('en');
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('adds Content-Type: application/json on write verbs', async () => {
    await httpClient.post('userstories/bulk_create', { bulk: [] });
    const [, init] = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization entirely when no token is present', async () => {
    localStorage.removeItem('token');
    await httpClient.get('userstories');
    const [, init] = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    // X-Session-Id is still always present.
    expect(headers['X-Session-Id']).toBe('sess-123');
  });

  it('merges caller-supplied extra headers on top', async () => {
    await httpClient.get('userstories', undefined, { headers: { 'x-disable-pagination': '1' } });
    const [, init] = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers['x-disable-pagination']).toBe('1');
    expect(headers['X-Session-Id']).toBe('sess-123');
  });
});

describe('httpClient — write verbs and body handling', () => {
  it('POST stringifies the JSON body and returns the parsed response', async () => {
    fetchMock().mockResolvedValueOnce(fakeResponse({ status: 200, body: '{"id":7}' }));
    const result = await httpClient.post<{ id: number }>('userstories/bulk_create', { name: 'x' });
    const [, init] = callArgs();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    expect(result).toEqual({ id: 7 });
  });

  it('PUT / PATCH / DELETE use the correct verb', async () => {
    await httpClient.put('a', { v: 1 });
    await httpClient.patch('b', { v: 2 });
    await httpClient.delete('c');
    expect(callArgs(0)[1].method).toBe('PUT');
    expect(callArgs(1)[1].method).toBe('PATCH');
    expect(callArgs(2)[1].method).toBe('DELETE');
  });

  it('never attaches a body to a GET request', async () => {
    await httpClient.get('userstories', { project: 1 });
    const [, init] = callArgs();
    expect(init.body).toBeUndefined();
  });

  it('forwards an AbortSignal when provided', async () => {
    const controller = new AbortController();
    await httpClient.get('userstories', undefined, { signal: controller.signal });
    const [, init] = callArgs();
    expect(init.signal).toBe(controller.signal);
  });
});

describe('httpClient — response normalization', () => {
  it('resolves an empty (204) body to null instead of throwing', async () => {
    fetchMock().mockResolvedValueOnce(fakeResponse({ status: 204, body: '' }));
    const result = await httpClient.post('userstories/bulk_update_kanban_order', { bulk: [] });
    expect(result).toBeNull();
  });

  it('getWithHeaders exposes the raw Headers and status', async () => {
    fetchMock().mockResolvedValueOnce(
      fakeResponse({ status: 200, body: '[]', headers: { 'Taiga-Info-Total-Opened-Milestones': '3' } }),
    );
    const res = await httpClient.getWithHeaders('milestones');
    expect(res.status).toBe(200);
    expect(res.headers.get('Taiga-Info-Total-Opened-Milestones')).toBe('3');
    expect(res.data).toEqual([]);
  });

  it('throws an HttpError with status and parsed data on a non-2xx response', async () => {
    fetchMock().mockResolvedValueOnce(fakeResponse({ status: 400, body: '{"_error_message":"bad"}' }));
    expect.assertions(3);
    try {
      await httpClient.post('userstories/bulk_create', {});
    } catch (e) {
      const err = e as HttpError;
      expect(err.status).toBe(400);
      expect(err.data).toEqual({ _error_message: 'bad' });
      expect(err.message).toContain('HTTP 400');
    }
  });

  it('leaves HttpError.data undefined when the error body is not valid JSON', async () => {
    fetchMock().mockResolvedValueOnce(fakeResponse({ status: 500, body: '<html>oops</html>' }));
    expect.assertions(2);
    try {
      await httpClient.get('userstories');
    } catch (e) {
      const err = e as HttpError;
      expect(err.status).toBe(500);
      expect(err.data).toBeUndefined();
    }
  });
});
