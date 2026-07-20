/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the milestone/sprint CRUD adapters
 * (`app/react/shared/api/milestones.ts`) used by the React Backlog screen in the
 * AngularJS 1.5.10 -> React 18 coexistence migration.
 *
 * Unlike the sibling spec at `app/react/shared/api/__tests__/milestones.test.ts`
 * (which MOCKS the `../httpClient` module and asserts the adapter's calls into
 * it), this spec exercises the adapters through the REAL `httpClient` and mocks
 * only the GLOBAL `fetch`. It therefore pins the END-TO-END request/response
 * contract the FROZEN `/milestones` `/api/v1/` endpoints see — the HTTP verb,
 * the joined URL, the query string, the request headers built from the shared
 * AngularJS runtime state, and the response-header parsing — so the requests the
 * Django backend receives are byte-identical to the incumbent AngularJS
 * `$tgSprintsResourcesProvider` (`resources/sprints.coffee`) + `$tgRepo` traffic:
 *
 *   - URL + VERB parity: list -> GET `milestones`, get -> GET `milestones/{id}`,
 *     stats -> GET `milestones/{id}/stats`, create -> POST `milestones`,
 *     save -> PATCH `milestones/{id}`, remove -> DELETE `milestones/{id}`.
 *   - `x-disable-pagination: "1"` on every GET (reproducing the `$repo`
 *     queryMany/queryOne/queryOneRaw defaults, `repository.coffee:139-140/167-168/177-178`).
 *   - `list()` params are `{ project, ...filters }` (serialized onto the query
 *     string) and the open/closed totals come from the
 *     `Taiga-Info-Total-Opened/Closed-Milestones` RESPONSE headers, parsed with
 *     `parseInt` — so an ABSENT header yields `NaN`, matching AngularJS
 *     (`parseInt(undefined, 10)`), NOT `0`.
 *   - Date serialization: `estimated_start` / `estimated_finish` are formatted
 *     `YYYY-MM-DD` (matching `lightboxes.coffee:59-60/66-67`) ONLY when present
 *     and non-empty, never invoking `moment(undefined)` (which would default to
 *     "now").
 *
 * Hermetic & browserless (AAP 0.6.2 / 0.7 test-isolation): the ONLY in-repo
 * import is `../api/milestones` (which transitively pulls the REAL `httpClient`,
 * `../config`, `../session`, and the retained `moment` dependency — `moment` is
 * deliberately NOT mocked). The shared runtime the real client reads is
 * installed as jsdom globals (`window.taigaConfig`, `window.taiga.sessionId`,
 * `localStorage 'token'`) and every `/api/v1/` call is intercepted by a
 * per-test `global.fetch` jest mock, so there is NO network, NO browser, NO
 * Playwright, and NO AngularJS/CoffeeScript import. The suite runs headlessly
 * and deterministically under jsdom and counts toward the >=70% line-coverage
 * gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are provided globally
 * by `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

// The module under test. `milestones` is the default aggregate export; the six
// named exports are the individual adapters. This is the ONLY in-repo import —
// the real `httpClient` reached through these adapters is driven via the mocked
// `global.fetch` below (it is intentionally NOT imported or mocked here).
import milestones, {
  list,
  get,
  stats,
  create,
  save,
  remove,
} from '../api/milestones';

// ---------------------------------------------------------------------------
// fetch stubbing helpers (mirroring the shared httpClient spec so the real
// client — which calls `global.fetch` directly — can be driven per test)
// ---------------------------------------------------------------------------

/** Shape of a single stubbed `fetch` response for {@link stubFetch}. */
type FetchStub = {
  /** `Response.ok`; defaults to `true`. Set `false` to exercise the error path. */
  ok?: boolean;
  /** HTTP status code; defaults to `200`. */
  status?: number;
  /** Response headers, read by the real client via `response.headers.get(name)`. */
  headers?: Record<string, string>;
  /**
   * Response body. `null`/`undefined` -> empty body (`204`-style); a string is
   * sent verbatim; any other value is JSON-stringified.
   */
  body?: unknown;
};

/**
 * Builds a minimal duck-typed stand-in for the parts of the `fetch` `Response`
 * the real `httpClient` actually touches: `ok`, `status`, an async `text()`, and
 * a `headers` object exposing `.get(name)`. The header container is a PLAIN
 * object with a `get` method (not a real `Headers`) — sufficient because the
 * client only ever calls `response.headers.get(...)`, and `milestones.list`
 * reads the exact-cased `Taiga-Info-Total-*-Milestones` names it also stubs.
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
 * Reads a request header from a captured `RequestInit`, tolerating BOTH the
 * plain-object header map the client currently builds AND a `Headers` instance
 * (so these assertions survive a future refactor to `new Headers(...)`).
 * Returns `undefined` when the header is absent.
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

// The API base used by the suite. Deliberately WITHOUT a trailing slash; the
// real client's URL-join collapses it to a single separator before the path.
const API_BASE = 'https://host/api/v1';

// ---------------------------------------------------------------------------
// Shared runtime setup / teardown — install the SAME globals/storage the
// AngularJS client uses so the REAL httpClient builds identical requests.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // The real client re-derives these at CALL TIME (never snapshotted at module
  // load), so assigning them here is sufficient for every request below.
  window.taigaConfig = { api: API_BASE, eventsUrl: null, defaultLanguage: 'en' };
  window.taiga = { sessionId: 'sid' };
  localStorage.clear();
  // StorageService JSON-serializes values, so the token is stored WITH quotes;
  // `getToken()` reads it back via `JSON.parse` (yielding the bare `tk`).
  localStorage.setItem('token', JSON.stringify('tk'));

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
// list — GET /milestones with the open/closed header totals (sprints.coffee:26-42)
// ---------------------------------------------------------------------------

describe('milestones.list — GET /milestones with header totals', () => {
  it('resolves the milestones plus parsed closed/open totals and sends project=3', async () => {
    stubFetch({
      body: [{ id: 1 }, { id: 2 }],
      headers: {
        'Taiga-Info-Total-Closed-Milestones': '2',
        'Taiga-Info-Total-Opened-Milestones': '5',
      },
    });

    const result = await list(3);

    expect(result).toEqual({
      milestones: [{ id: 1 }, { id: 2 }],
      closed: 2,
      open: 5,
    });

    const [url, init] = callArgs();
    expect(init.method).toBe('GET');
    expect(url).toContain('milestones');
    expect(url).toContain('project=3');
  });

  it('sends the x-disable-pagination request header on the list GET', async () => {
    stubFetch({ body: [] });

    await list(3);

    const [, init] = callArgs();
    expect(readHeader(init, 'x-disable-pagination')).toBe('1');
    // GET carries no Content-Type (the single header difference vs writes).
    expect(readHeader(init, 'Content-Type')).toBeUndefined();
  });

  it('yields NaN totals when the Taiga-Info headers are absent (matches AngularJS parseInt) and [] for an empty body', async () => {
    stubFetch({ body: null, headers: {} });

    const result = await list(3);

    expect(Number.isNaN(result.closed)).toBe(true);
    expect(Number.isNaN(result.open)).toBe(true);
    expect(result.milestones).toEqual([]);
  });

  it('merges optional filters into the query string alongside project', async () => {
    stubFetch({ body: [] });

    await list(3, { closed: true });

    const [url] = callArgs();
    expect(url).toContain('project=3');
    expect(url).toContain('closed=true');
  });
});

// ---------------------------------------------------------------------------
// get — GET /milestones/{id} (sprints.coffee:16-21)
// ---------------------------------------------------------------------------

describe('milestones.get — GET /milestones/{id}', () => {
  it('GETs the single milestone by id with x-disable-pagination and returns it raw', async () => {
    const sprint = { id: 9, name: 'S9', project: 7 };
    stubFetch({ body: sprint });

    const result = await get(9);

    const [url, init] = callArgs();
    expect(init.method).toBe('GET');
    expect(url.endsWith('milestones/9')).toBe(true);
    expect(readHeader(init, 'x-disable-pagination')).toBe('1');
    // GET must never carry a body.
    expect(init.body).toBeUndefined();
    expect(result).toEqual(sprint);
  });
});

// ---------------------------------------------------------------------------
// stats — GET /milestones/{id}/stats (sprints.coffee:23-24)
// ---------------------------------------------------------------------------

describe('milestones.stats — GET /milestones/{id}/stats', () => {
  it('GETs the stats sub-resource with x-disable-pagination and returns the raw payload', async () => {
    const statsPayload = { total_points: 40, completed_points: 12 };
    stubFetch({ body: statsPayload });

    const result = await stats(9);

    const [url, init] = callArgs();
    expect(init.method).toBe('GET');
    expect(url.endsWith('milestones/9/stats')).toBe(true);
    expect(readHeader(init, 'x-disable-pagination')).toBe('1');
    expect(result).toEqual(statsPayload);
  });
});

// ---------------------------------------------------------------------------
// create — POST /milestones (repository.coffee:24-35) with date serialization
// ---------------------------------------------------------------------------

describe('milestones.create — POST /milestones', () => {
  it('POSTs to milestones with the dates serialized to YYYY-MM-DD', async () => {
    stubFetch({ body: { id: 100 } });

    await create({
      project: 1,
      name: 'Sprint 1',
      // A datetime ISO string (no timezone) — moment parses and formats it in
      // the SAME local zone, so the wall-clock date is preserved.
      estimated_start: '2024-03-23T10:00:00',
      estimated_finish: '2024-04-06',
    });

    const [url, init] = callArgs();
    expect(init.method).toBe('POST');
    expect(url.endsWith('milestones')).toBe(true);
    // Writes carry Content-Type: application/json.
    expect(readHeader(init, 'Content-Type')).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.project).toBe(1);
    expect(body.name).toBe('Sprint 1');
    // Proves the YYYY-MM-DD serialization: the time component is dropped and a
    // date-only value is passed through unchanged.
    expect(body.estimated_start).toBe('2024-03-23');
    expect(body.estimated_finish).toBe('2024-04-06');
  });

  it('returns the created milestone JSON from the client', async () => {
    const created = { id: 100, name: 'Sprint 1', project: 1 };
    stubFetch({ body: created });

    const result = await create({
      project: 1,
      name: 'Sprint 1',
      estimated_start: '2024-03-23',
      estimated_finish: '2024-04-06',
    });

    expect(result).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// save — PATCH /milestones/{id} (repository.coffee:54-68) with date serialization
// ---------------------------------------------------------------------------

describe('milestones.save — PATCH /milestones/{id}', () => {
  it('PATCHes the milestone by id, serializing a present date to YYYY-MM-DD', async () => {
    stubFetch({ body: { id: 9 } });

    await save(9, { name: 'x', estimated_start: '2024-05-01T00:00:00' });

    const [url, init] = callArgs();
    expect(init.method).toBe('PATCH');
    expect(url.endsWith('milestones/9')).toBe(true);
    expect(readHeader(init, 'Content-Type')).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('x');
    expect(body.estimated_start).toBe('2024-05-01');
  });

  it('leaves a partial edit without dates untouched (no moment(undefined) -> now)', async () => {
    stubFetch({ body: {} });

    await save(9, { name: 'only name changed' });

    const [, init] = callArgs();
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ name: 'only name changed' });
    expect('estimated_start' in body).toBe(false);
    expect('estimated_finish' in body).toBe(false);
  });

  it('does not format empty-string dates (guards against the now-default bug)', async () => {
    stubFetch({ body: {} });

    await save(9, { estimated_start: '', estimated_finish: '' });

    const [, init] = callArgs();
    const body = JSON.parse(init.body as string);
    expect(body.estimated_start).toBe('');
    expect(body.estimated_finish).toBe('');
  });
});

// ---------------------------------------------------------------------------
// remove — DELETE /milestones/{id} (repository.coffee:37-48)
// ---------------------------------------------------------------------------

describe('milestones.remove — DELETE /milestones/{id}', () => {
  it('DELETEs the milestone by id and resolves void', async () => {
    stubFetch({ status: 204, body: null });

    const result = await remove(9);

    const [url, init] = callArgs();
    expect(init.method).toBe('DELETE');
    expect(url.endsWith('milestones/9')).toBe(true);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// export surface — the default aggregate mirrors the named exports
// ---------------------------------------------------------------------------

describe('milestones — export surface', () => {
  it('exposes the six adapters on the default aggregate', () => {
    expect(typeof milestones.list).toBe('function');
    expect(typeof milestones.get).toBe('function');
    expect(typeof milestones.stats).toBe('function');
    expect(typeof milestones.create).toBe('function');
    expect(typeof milestones.save).toBe('function');
    expect(typeof milestones.remove).toBe('function');
  });

  it('binds the aggregate members to the named exports', () => {
    expect(milestones.list).toBe(list);
    expect(milestones.get).toBe(get);
    expect(milestones.stats).toBe(stats);
    expect(milestones.create).toBe(create);
    expect(milestones.save).toBe(save);
    expect(milestones.remove).toBe(remove);
  });
});

