/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * client.test.ts — browserless Jest (jsdom) unit spec for the shared REST
 * adapter (`app/react/shared/api/client.ts`), the fetch wrapper whose single
 * job is to make the migrated React (Kanban + Backlog) screens
 * INDISTINGUISHABLE from AngularJS to the Django `/api/v1/` backend: the same
 * base URL, the same `Authorization: Bearer <jwt>` + `X-Session-Id` headers on
 * every call, and the same endpoint paths and JSON request bodies, byte-for-byte
 * (AAP 0.1.1 / 0.6.1 / 0.7.1). It is the highest-value line-coverage contributor
 * for `shared/**` toward the repo-wide >= 70% line-coverage threshold enforced
 * by the root `jest.config.js` (AAP 0.6.4).
 *
 * WHY THE SESSION BRIDGE IS NOT MOCKED
 *   `client.ts` reads the base URL, JWT and session id through the shared
 *   `../session` bridge. This spec deliberately does NOT mock that bridge;
 *   instead it stubs the ambient globals the bridge reads — `localStorage` (the
 *   JSON-encoded `'token'`), `window.taiga.sessionId`, and
 *   `window.taigaConfig.api`. That exercises the FULL client->session
 *   integration (the real header/URL wiring the backend must not be able to
 *   distinguish) and, as a bonus, raises the shared session module's coverage.
 *
 * TEST-LAYER ISOLATION (hard constraints — verified by the Phase 7 grep gate)
 *   - jsdom only. `global.fetch` is ALWAYS a jest mock: no live HTTP is ever
 *     performed and no browser engine is launched. jsdom does not implement
 *     `fetch`, so the injected mock is the sole network surface.
 *   - The ONLY module import is `../api/client`. None of the globally-loaded
 *     legacy libraries those screens replace internally, and no AngularJS
 *     `.coffee` module, is imported; there is likewise no UI-framework import
 *     (this spec renders no components).
 *   - The root `jest.config.js` already sets `testEnvironment: 'jsdom'`, the
 *     ts-jest transform, and the jest-dom matchers, so there is deliberately no
 *     per-file `@jest-environment` docblock and the Jest globals (`describe` /
 *     `it` / `expect` / `beforeEach` / `afterEach` / `jest`) are available
 *     without importing them.
 *
 * DOCUMENTED CONTRACT UNDER TEST (asserted exactly; do not diverge)
 *   - URL join mirrors the AngularJS URL service (`base/urls.coffee:34-37`): a
 *     single trailing slash is stripped from the config base and a single
 *     leading slash from the path, joined with exactly one `/` — so base
 *     `.../api/v1/` + `/userstories/...` => `.../api/v1/userstories/...`, never
 *     a double slash.
 *   - Headers reproduce the AngularJS HTTP layer: `Content-Type:
 *     application/json` ONLY when a body is sent (`app.coffee:591`);
 *     `Authorization: Bearer <token>` ONLY when a token is present
 *     (`http.coffee:21-23`); `X-Session-Id` whenever a session id is present,
 *     on GET and bodied verbs alike (`app.coffee:593,601`). Headers reach
 *     `fetch` as a plain object, so assertions read `init.headers['...']`.
 *   - Body: JSON-encoded for non-GET verbs that supply one; GET sends none and
 *     therefore carries no `Content-Type`.
 *   - Response parsing: an empty body (e.g. 204) resolves to `undefined`; a
 *     non-2xx response throws `ApiError` carrying `.status` (number) and the
 *     parsed `.body` (`name === 'ApiError'`).
 */

import { api, ApiError } from '../api/client';

/* ========================================================================== *
 * Isolation hooks
 *
 * `client.ts` reads the token, session id and base URL FRESH on every request,
 * so each test must start from an identical, fully-controlled ambient state:
 *   - a success `global.fetch` mock (jsdom provides no real `fetch`),
 *   - a JSON-encoded `'token'` in `localStorage` (as the AngularJS $tgStorage
 *     persists it),
 *   - a `window.taiga.sessionId`, and
 *   - a `window.taigaConfig.api` base URL.
 * `afterEach` tears all of that down (and installs a fresh mock next run via
 * `beforeEach`) so the suite is deterministic and order-independent, and so a
 * token removed within one test cannot leak into the next.
 * ========================================================================== */

beforeEach(() => {
    // Default happy-path fetch mock: 2xx, empty body. jsdom does NOT implement
    // `fetch`, so assigning it here is what makes the adapter callable at all.
    // `text()` is mandatory because the client parses via `await response.text()`.
    global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
    })) as any;

    // The JWT is stored JSON-stringified under the literal key 'token', exactly
    // as the AngularJS auth service / $tgStorage persist it; the session bridge
    // JSON-parses it back to the raw string 'jwt-abc'.
    localStorage.setItem('token', JSON.stringify('jwt-abc'));

    // The correlation id the AngularJS shell established once on window.taiga;
    // React reuses this exact id and never mints its own.
    (window as any).taiga = { sessionId: 'sess-123' };

    // The runtime config seeded by the app-loader; the client's base URL comes
    // ONLY from here (window.taigaConfig.api), never a hardcoded literal.
    (window as any).taigaConfig = { api: 'http://localhost:8000/api/v1/', eventsUrl: null };
});

afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete (window as any).taiga;
    delete (window as any).taigaConfig;
    delete (global as any).fetch;
    // getLanguage() reads <html lang>; jsdom persists it across tests, so clear
    // it to keep the Accept-Language specs deterministic and prevent leakage.
    document.documentElement.removeAttribute('lang');
});

/**
 * Read the arguments of a recorded `fetch(url, init)` call. `client.ts` always
 * invokes `fetch` as `fetch(url, init)` where `init = { method, headers, body? }`
 * and `headers` is a plain `Record<string,string>` — so callers assert with
 * `init.headers['Authorization']` etc. The `as unknown as jest.Mock` cast is the
 * strict-safe way to reach `.mock.calls` regardless of the ambient `fetch` type.
 */
function readFetchCall(index = 0): { url: string; init: any } {
    const call = (global.fetch as unknown as jest.Mock).mock.calls[index];
    return { url: call[0] as string, init: call[1] };
}

/* ========================================================================== *
 * Phase 2 — POST attaches all headers, correct single-slash URL, JSON body
 * (the core contract test: "React looks exactly like AngularJS to the backend")
 * ========================================================================== */

describe('api.post — AngularJS header parity, URL join, and JSON body', () => {
    it('attaches Authorization + X-Session-Id + Content-Type, joins the URL with a single slash, and sends the JSON body', async () => {
        await api.post('/userstories/bulk_create', { project_id: 1 });

        // Exactly one HTTP call was issued (no retries, no probes).
        expect(global.fetch).toHaveBeenCalledTimes(1);

        const { url, init } = readFetchCall();

        // Trailing-slash base + leading-slash path collapse to a single slash —
        // NOT `.../api/v1//userstories/...`.
        expect(url).toBe('http://localhost:8000/api/v1/userstories/bulk_create');

        expect(init.method).toBe('POST');

        // The three headers the Django backend uses to authenticate/correlate
        // the request identically to AngularJS traffic.
        expect(init.headers['Authorization']).toBe('Bearer jwt-abc');
        expect(init.headers['X-Session-Id']).toBe('sess-123');
        expect(init.headers['Content-Type']).toBe('application/json');

        // Body is the JSON-encoded payload, byte-for-byte.
        expect(init.body).toBe(JSON.stringify({ project_id: 1 }));
    });

    it('resolves to undefined for an empty (204-style) response body', async () => {
        // The default success mock returns text() === '' — the client parses an
        // empty body to `undefined` and does NOT throw. `api.post` resolves to
        // that parsed body.
        await expect(api.post('/x', {})).resolves.toBeUndefined();
    });
});

/* ========================================================================== *
 * Phase 3 — GET serializes params into the query string, omits body/Content-Type
 * ========================================================================== */

describe('api.get — query-string serialization, no body, no Content-Type', () => {
    it('serializes params onto the URL, omits the body and Content-Type, and still attaches auth + session headers', async () => {
        await api.get('/userstories/filters_data', { project: 1, status: '2' });

        const { url, init } = readFetchCall();

        // `toContain` avoids coupling the assertion to parameter ordering.
        expect(url).toContain('http://localhost:8000/api/v1/userstories/filters_data?');
        expect(url).toContain('project=1');
        expect(url).toContain('status=2');

        expect(init.method).toBe('GET');

        // GET sends no body and therefore no Content-Type (mirrors the AngularJS
        // GET default header set, which carries only X-Session-Id).
        expect(init.body).toBeUndefined();
        expect(init.headers['Content-Type']).toBeUndefined();

        // Auth + session headers still attach on GET.
        expect(init.headers['X-Session-Id']).toBe('sess-123');
        expect(init.headers['Authorization']).toBe('Bearer jwt-abc');
    });

    /* ---------------------------------------------------------------------- *
     * Phase 4 — Missing token => NO Authorization header (but keep X-Session-Id)
     * ---------------------------------------------------------------------- */
    it('omits the Authorization header when no token is stored', async () => {
        // Simulate the logged-out / pre-auth state: no 'token' in localStorage.
        localStorage.removeItem('token');

        await api.get('/userstories/filters_data');

        const { init } = readFetchCall();

        // No token => the client omits Authorization entirely (matches the
        // `if token` guard in the AngularJS HTTP layer, http.coffee:21-23).
        expect(init.headers['Authorization']).toBeUndefined();

        // The correlation header is independent of auth and must still be sent.
        expect(init.headers['X-Session-Id']).toBe('sess-123');
    });
});

/* ========================================================================== *
 * Phase 5 — Non-2xx rejects with an ApiError carrying status (and parsed body)
 * ========================================================================== */

describe('api — non-2xx responses reject with ApiError', () => {
    it('throws ApiError carrying the numeric status and the parsed error body', async () => {
        // Persistent (this-test-only) 400 mock: the endpoint is invoked twice
        // below — once for the `rejects` matcher and once to inspect the thrown
        // value — and `beforeEach` installs a fresh success mock for every other
        // test, so there is no cross-test leakage.
        (global.fetch as unknown as jest.Mock).mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ _error_message: 'bad' }),
            text: async () => JSON.stringify({ _error_message: 'bad' }),
            headers: new Headers(),
        } as any);

        await expect(api.post('/userstories/bulk_create', { project_id: 1 })).rejects.toBeInstanceOf(ApiError);

        // Inspect the thrown value directly to assert the status/body payload
        // the AngularJS `promise.error(data, status)` handlers relied upon.
        let caught: unknown;
        try {
            await api.post('/userstories/bulk_create', { project_id: 1 });
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(ApiError);
        expect(caught).toMatchObject({ status: 400, body: { _error_message: 'bad' } });
        expect((caught as ApiError).name).toBe('ApiError');
    });

    it('constructs a default message from the status when none is supplied', () => {
        // Exercises the exported ApiError contract directly: it extends Error,
        // reports name === "ApiError", preserves status + parsed body, and
        // synthesizes a "Request failed with status <n>" message when no explicit
        // message is passed (the `message ?? default` fallback).
        const err = new ApiError(500, { detail: 'boom' });

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.name).toBe('ApiError');
        expect(err.status).toBe(500);
        expect(err.body).toEqual({ detail: 'boom' });
        expect(err.message).toBe('Request failed with status 500');
    });
});

/* ========================================================================== *
 * Phase 6 — Low-level api.request exposes status + raw Headers; PATCH parity
 * ========================================================================== */

describe('api.request — low-level result exposes status and raw headers', () => {
    it('resolves to { data, status, headers } with headers as a Headers instance', async () => {
        // Header-exposing path used by the milestones adapter, which reads the
        // `Taiga-Info-Total-*-Milestones` pagination headers off the response.
        (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [{ id: 7 }],
            text: async () => JSON.stringify([{ id: 7 }]),
            headers: new Headers({ 'Taiga-Info-Total-Opened-Milestones': '5' }),
        } as any);

        const res = await api.request('GET', '/milestones');

        expect(res.status).toBe(200);
        expect(res.data).toEqual([{ id: 7 }]);
        expect(res.headers).toBeInstanceOf(Headers);
        expect(res.headers.get('Taiga-Info-Total-Opened-Milestones')).toBe('5');
    });
});

describe('api.patch — PATCH verb parity', () => {
    it('sends method PATCH with a Content-Type header and a JSON body', async () => {
        await api.patch('/milestones/7', { name: 'X' });

        const { url, init } = readFetchCall();

        expect(url).toBe('http://localhost:8000/api/v1/milestones/7');
        expect(init.method).toBe('PATCH');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.body).toBe(JSON.stringify({ name: 'X' }));
    });
});

/* ========================================================================== *
 * Remaining client.ts contract coverage — PUT / DELETE verbs, same-origin URL
 * enforcement (cross-origin rejection), null/undefined query-param skipping, and
 * the non-JSON body fallback. These exercise the SAME in-scope client module and
 * drive its line coverage toward 100% (AAP 0.6.4 — the >= 70% line-coverage
 * mandate).
 * ========================================================================== */

describe('api — remaining verbs and URL / parse edge cases', () => {
    it('api.put sends method PUT with a Content-Type header and a JSON body', async () => {
        await api.put('/milestones/7', { name: 'Y' });

        const { url, init } = readFetchCall();

        expect(url).toBe('http://localhost:8000/api/v1/milestones/7');
        expect(init.method).toBe('PUT');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.body).toBe(JSON.stringify({ name: 'Y' }));
    });

    it('api.del issues a DELETE with no body and no Content-Type, keeping auth + session headers', async () => {
        await api.del('/userstories/1');

        const { url, init } = readFetchCall();

        expect(url).toBe('http://localhost:8000/api/v1/userstories/1');
        expect(init.method).toBe('DELETE');
        // DELETE carries no request body, hence no Content-Type header.
        expect(init.body).toBeUndefined();
        expect(init.headers['Content-Type']).toBeUndefined();
        // Auth + correlation headers still attach, exactly as on every verb.
        expect(init.headers['Authorization']).toBe('Bearer jwt-abc');
        expect(init.headers['X-Session-Id']).toBe('sess-123');
    });

    /* ---------------------------------------------------------------------- *
     * Same-origin enforcement (findings #6 CWE-200 + #28 test-correctness).
     *
     * The adapter attaches the JWT Bearer token and X-Session-Id to EVERY call,
     * so it MUST refuse to send them off-origin. These tests assert the SECURE
     * contract — an off-origin endpoint is rejected and NO request is issued, so
     * credentials can never leak — replacing the earlier test that wrongly
     * blessed an absolute off-origin URL being used verbatim (which would have
     * exfiltrated the token/session to a foreign host).
     * ---------------------------------------------------------------------- */
    it('rejects an off-origin absolute endpoint, issues NO request, and never transmits credentials', async () => {
        // The configured API base is http://localhost:8000/api/v1/ (see
        // beforeEach); this endpoint is a DIFFERENT origin.
        await expect(api.get('https://cdn.example.test/attachments/1')).rejects.toThrow(/cross-origin/i);

        // Hard guarantee: fetch was never invoked, so the Bearer token and
        // X-Session-Id were never transmitted to the foreign origin (CWE-200).
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects a protocol-relative off-origin endpoint without issuing a request', async () => {
        // `//host/…` inherits the page protocol and points at a foreign origin;
        // it must be rejected exactly like an explicit http(s) absolute URL,
        // regardless of the HTTP verb.
        await expect(api.post('//evil.example.test/steal', { project_id: 1 })).rejects.toThrow(/cross-origin/i);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('allows an absolute endpoint that is same-origin with the configured API base and still attaches credentials', async () => {
        // An absolute URL on the SAME origin as the API base is safe and is used
        // verbatim (the legitimate half of the legacy `resolveAbsolute` guard),
        // and credentials attach exactly as on a relative path.
        await api.get('http://localhost:8000/api/v1/attachments/1');

        expect(global.fetch).toHaveBeenCalledTimes(1);

        const { url, init } = readFetchCall();

        expect(url).toBe('http://localhost:8000/api/v1/attachments/1');
        expect(init.headers['Authorization']).toBe('Bearer jwt-abc');
        expect(init.headers['X-Session-Id']).toBe('sess-123');
    });

    it('skips null and undefined query params while serializing the defined ones', async () => {
        // Optional params may be passed unconditionally: null / undefined
        // entries are omitted from the query string, so callers need not branch.
        await api.get('/userstories/filters_data', {
            project: 1,
            status: null,
            assigned_to: undefined,
        });

        const { url } = readFetchCall();

        expect(url).toContain('project=1');
        expect(url).not.toContain('status=');
        expect(url).not.toContain('assigned_to=');
    });

    it('appends no query string at all when every provided param is null/undefined', async () => {
        // When params are supplied but all skipped, the serializer yields the
        // empty string, so the URL carries no trailing `?`.
        await api.get('/userstories/filters_data', { status: null, assigned_to: undefined });

        const { url } = readFetchCall();

        expect(url).toBe('http://localhost:8000/api/v1/userstories/filters_data');
        expect(url).not.toContain('?');
    });

    it('falls back to the raw text body when a 2xx response is not valid JSON', async () => {
        // A non-JSON success payload must resolve to the raw text (the
        // JSON.parse catch branch) rather than throwing.
        (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => {
                throw new Error('not json');
            },
            text: async () => 'plain-text-body',
            headers: new Headers(),
        } as any);

        await expect(api.get('/system/status')).resolves.toBe('plain-text-body');
    });
});

/* ========================================================================== *
 * Network-isolation guard — proves no test can reach the real network
 * ========================================================================== */

describe('network isolation — fetch is always a jest mock', () => {
    it('confirms global.fetch is a mock function so no live HTTP is performed', () => {
        // `beforeEach` installs the mock before every test; this asserts the
        // invariant the Phase 7 grep gate depends on (global.fetch is ALWAYS a
        // jest mock — never real network I/O).
        expect(jest.isMockFunction(global.fetch)).toBe(true);
    });
});

/* ========================================================================== *
 * Accept-Language parity — `$tgHttp.headers()` attaches it on EVERY verb
 * (http.coffee:25-28). The React client must be byte-for-byte identical.
 * ========================================================================== */

describe('api — Accept-Language header parity (all verbs)', () => {
    it('sends Accept-Language on POST, reading the live <html lang> first', async () => {
        // i18nInit stamps <html lang> on every language change (app.coffee:859);
        // getLanguage() prefers it, so the client mirrors what the user views.
        document.documentElement.setAttribute('lang', 'fr');

        await api.post('/userstories/bulk_create', { project_id: 1 });

        const { init } = readFetchCall();
        expect(init.headers['Accept-Language']).toBe('fr');

        document.documentElement.removeAttribute('lang');
    });

    it('sends Accept-Language on GET too (the header is NOT verb-specific)', async () => {
        // Unlike app.coffee:592 defaultHeaders (bodied verbs only), $tgHttp
        // attaches Accept-Language in request(), which GET also funnels through.
        document.documentElement.setAttribute('lang', 'de');

        await api.get('/userstories/filters_data', { project: 1 });

        const { init } = readFetchCall();
        expect(init.headers['Accept-Language']).toBe('de');

        document.documentElement.removeAttribute('lang');
    });

    it('falls back to taigaConfig.defaultLanguage when <html lang> and userInfo are absent', async () => {
        // beforeEach sets no <html lang> / userInfo; supply a config default and
        // confirm the client sends it, matching preferredLanguage()'s seed chain.
        document.documentElement.removeAttribute('lang');
        (window as any).taigaConfig = {
            api: 'http://localhost:8000/api/v1/',
            eventsUrl: null,
            defaultLanguage: 'es',
        };

        await api.patch('/userstories/1', { subject: 'x' });

        const { init } = readFetchCall();
        expect(init.headers['Accept-Language']).toBe('es');
    });

    it('defaults to "en" when no language source is resolvable', async () => {
        // beforeEach's config has no defaultLanguage and there is no <html lang>
        // or userInfo, so getLanguage() returns the "en" backstop
        // (angular-translate fallbackLanguage, app.coffee:808).
        document.documentElement.removeAttribute('lang');

        await api.del('/userstories/1');

        const { init } = readFetchCall();
        expect(init.headers['Accept-Language']).toBe('en');
    });

    it('reads the language fresh per request (tracks a runtime language switch)', async () => {
        // Two calls with a language change in between must send DIFFERENT
        // Accept-Language values — proving nothing is cached at module load.
        document.documentElement.setAttribute('lang', 'en');
        await api.get('/a');
        expect(readFetchCall(0).init.headers['Accept-Language']).toBe('en');

        document.documentElement.setAttribute('lang', 'ja');
        await api.get('/b');
        expect(readFetchCall(1).init.headers['Accept-Language']).toBe('ja');

        document.documentElement.removeAttribute('lang');
    });
});


/* ========================================================================== *
 * 401 single-flight token refresh / retry / logout parity (F-SEC-02)
 *
 * Ports and verifies the AngularJS `$httpProvider` interceptor state machine
 * (`app.coffee:608-707`) that React `fetch` calls would otherwise bypass:
 *   - a 401 triggers ONE `POST /auth/refresh`;
 *   - on success the rotated token is persisted and the original request is
 *     retried exactly once with the new Bearer;
 *   - concurrent 401s share a SINGLE refresh (single-flight);
 *   - on refresh failure / missing refresh token the session is cleared
 *     (logout) and the original error is thrown;
 *   - the `/auth/refresh` call itself is never refreshed (loop prevention);
 *   - the retry happens at most once (no infinite loop).
 * The logout side-effect is asserted via `localStorage` (the real
 * `clearSession` runs), honouring this spec's "only import ../api/client"
 * isolation rule — no session module is imported or mocked.
 * ========================================================================== */

/** Build a minimal fetch-Response stub with the fields `client.ts` reads. */
function makeResponse(status: number, body = ''): any {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (body ? JSON.parse(body) : {}),
        text: async () => body,
        headers: new Headers(),
    };
}

/** The JSON body a successful `/auth/refresh` returns (auth_token + refresh). */
function refreshOk(): string {
    return JSON.stringify({ auth_token: 'new-jwt', refresh: 'new-refresh' });
}

describe('api — 401 refresh/retry/logout parity (F-SEC-02)', () => {
    // `redirectToLogin` sets `window.location.href`; jsdom does not implement
    // navigation and logs a noisy "Not implemented" error. Replace `location`
    // with a plain writable stub for these tests so the href assignment is a
    // no-op we can also ASSERT against. The stub keeps a same-origin absolute
    // `href`, so `resolveUrl`'s origin resolution is unaffected. Restored after
    // each test to avoid leaking into later specs in this file.
    let savedLocationDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        savedLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: {
                href: 'http://localhost:8000/kanban',
                origin: 'http://localhost:8000',
                pathname: '/kanban',
                search: '',
                assign() {},
                replace() {},
            },
        });
    });

    afterEach(() => {
        if (savedLocationDescriptor) {
            Object.defineProperty(window, 'location', savedLocationDescriptor);
        }
    });

    it('on 401 refreshes once, persists the rotated token, and retries with the new Bearer', async () => {
        // A refresh token must be present for the refresh path to run.
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(makeResponse(401)) // original request → 401
            .mockResolvedValueOnce(makeResponse(200, refreshOk())) // POST /auth/refresh
            .mockResolvedValueOnce(makeResponse(200, JSON.stringify({ ok: true }))); // retry
        global.fetch = fetchMock as any;

        const result = await api.get('/userstories/filters_data', { project: 1 });

        // Exactly three calls: original, refresh, retry.
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // The refresh POST hit /auth/refresh with the {refresh} body.
        const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
        expect(refreshUrl).toBe('http://localhost:8000/api/v1/auth/refresh');
        expect(refreshInit.method).toBe('POST');
        expect(refreshInit.body).toBe(JSON.stringify({ refresh: 'refresh-tok' }));

        // Rotated tokens were persisted (JSON-encoded, as $tgStorage does).
        expect(JSON.parse(localStorage.getItem('token') as string)).toBe('new-jwt');
        expect(JSON.parse(localStorage.getItem('refresh') as string)).toBe('new-refresh');

        // The retry carried the NEW Bearer token (headers rebuilt fresh).
        const [, retryInit] = fetchMock.mock.calls[2];
        expect(retryInit.headers['Authorization']).toBe('Bearer new-jwt');

        // The caller sees the retried success body.
        expect(result).toEqual({ ok: true });
    });

    it('clears the session (logout) and throws the original error when the refresh itself fails', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));
        localStorage.setItem('userInfo', JSON.stringify({ id: 7 }));

        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(makeResponse(401)) // original → 401
            .mockResolvedValueOnce(makeResponse(401)); // refresh → 401 (fails)
        global.fetch = fetchMock as any;

        await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);

        // Original + refresh only — NO retry after a failed refresh.
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // errorToken logout removed token, refresh AND userInfo.
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('refresh')).toBeNull();
        expect(localStorage.getItem('userInfo')).toBeNull();
    });

    it('does not attempt a refresh (and logs out) when no refresh token is stored', async () => {
        // No 'refresh' key in storage → the refresh is impossible.
        localStorage.removeItem('refresh');

        const fetchMock = jest.fn().mockResolvedValueOnce(makeResponse(401));
        global.fetch = fetchMock as any;

        await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);

        // Only the original request — NO /auth/refresh POST at all.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The session was cleared even though no refresh was attempted.
        expect(localStorage.getItem('token')).toBeNull();
        // And the client was redirected to /login with the unauthorized+next
        // query, reproducing the coffee errorToken redirect (app.coffee:643-645).
        expect(window.location.href).toBe('/login?unauthorized=true&next=%2Fkanban');
    });

    it('shares a SINGLE refresh across concurrent 401s (single-flight)', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        let refreshCalls = 0;
        const fetchMock = jest.fn(async (url: string, init: any) => {
            if (url.includes('/auth/refresh')) {
                refreshCalls += 1;
                // Widen the single-flight window so both 401 handlers enter
                // before the shared refresh settles.
                await new Promise((r) => setTimeout(r, 5));
                return makeResponse(200, refreshOk());
            }
            // Non-refresh: still-old token → 401; rotated token → 200.
            if (init.headers['Authorization'] === 'Bearer new-jwt') {
                return makeResponse(200, JSON.stringify({ ok: true }));
            }
            return makeResponse(401);
        });
        global.fetch = fetchMock as any;

        const [r1, r2] = await Promise.all([api.get('/a'), api.get('/b')]);

        // Both concurrent requests succeeded after ONE shared refresh.
        expect(r1).toEqual({ ok: true });
        expect(r2).toEqual({ ok: true });
        expect(refreshCalls).toBe(1);
    });

    it('never refreshes the /auth/refresh call itself (loop prevention)', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        const fetchMock = jest.fn().mockResolvedValue(makeResponse(401));
        global.fetch = fetchMock as any;

        await expect(api.post('/auth/refresh', { refresh: 'x' })).rejects.toBeInstanceOf(ApiError);

        // A single call: the 401 on /auth/refresh does NOT spawn a nested refresh.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats a 2xx refresh with a malformed body (no auth_token) as a logout', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(makeResponse(401)) // original → 401
            .mockResolvedValueOnce(makeResponse(200, JSON.stringify({ unexpected: true }))); // no auth_token
        global.fetch = fetchMock as any;

        await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);

        // No retry (the refresh yielded no usable token); session cleared.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('refresh')).toBeNull();
    });

    it('logs out when the refresh request rejects at the network layer', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        const fetchMock = jest.fn(async (url: string) => {
            if (url.includes('/auth/refresh')) {
                throw new TypeError('network down');
            }
            return makeResponse(401);
        });
        global.fetch = fetchMock as any;

        await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);

        // Session cleared on the network-error refresh path (no unhandled throw).
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('refresh')).toBeNull();
    });

    it('retries at most once — a second 401 after a successful refresh is surfaced', async () => {
        localStorage.setItem('refresh', JSON.stringify('refresh-tok'));

        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(makeResponse(401)) // original → 401
            .mockResolvedValueOnce(makeResponse(200, refreshOk())) // refresh OK
            .mockResolvedValueOnce(makeResponse(401)); // retry STILL 401
        global.fetch = fetchMock as any;

        await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);

        // original + refresh + exactly one retry, then give up (no loop).
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

