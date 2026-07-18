/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * session.test.ts — browserless Jest (jsdom) unit spec for the shared
 * session / auth / runtime-config bridge (`app/react/shared/session.ts`).
 *
 * WHY THIS EXISTS
 *   `session.ts` is the SINGLE React-side source for the three pieces of
 *   ambient state the migrated Kanban + Backlog screens borrow from the still
 *   AngularJS shell:
 *     1. the JWT bearer token          (`getAuthToken`),
 *     2. the `X-Session-Id` correlation id (`getSessionId`), and
 *     3. the runtime configuration     (`getConfig` / `getApiUrl` /
 *        `getEventsUrl`, reading `window.taigaConfig`).
 *   These accessors keep React traffic byte-for-byte indistinguishable from
 *   AngularJS traffic to the Django `/api/v1/` backend and the events gateway,
 *   so exercising their exact contract here protects that invariant. This spec
 *   is also a primary line-coverage contributor for `shared/**` toward the
 *   repo-wide >= 70% line-coverage threshold enforced by the root
 *   `jest.config.js` (AAP 0.2.1 / 0.6.4).
 *
 * TEST-LAYER ISOLATION (hard constraints — verified by the Phase 5 grep gate)
 *   - jsdom only: NO Playwright, NO browser launch, NO real network, NO
 *     `fetch`, NO `WebSocket`. jsdom supplies a working `localStorage` and
 *     `window`, which the tests drive directly.
 *   - The ONLY module import is `../session`. Nothing from Immutable / dragula /
 *     dom-autoscroller / checksley or any `.coffee` / AngularJS module is
 *     imported, and there is no `import React`.
 *   - `getRefreshToken` is intentionally NOT imported: it is an optional export
 *     that the documented contract does not require this spec to cover.
 *   - The root `jest.config.js` already sets `testEnvironment: 'jsdom'`, the
 *     ts-jest transform, and `setupFilesAfterEnv: ['@testing-library/jest-dom']`,
 *     so there is deliberately no per-file `@jest-environment` docblock and the
 *     Jest globals (`describe` / `it` / `expect` / `afterEach` / `jest`) plus
 *     the jest-dom matchers are available without importing them.
 *
 * DOCUMENTED CONTRACT UNDER TEST (asserted exactly; do not diverge)
 *   - `getConfig()`      — returns `window.taigaConfig` when present, else the
 *                          minimal safe default `{ api: '/api/v1/',
 *                          eventsUrl: null }`; NEVER throws.
 *   - `getApiUrl()`      — returns `getConfig().api`.
 *   - `getEventsUrl()`   — returns `getConfig().eventsUrl ?? null`.
 *   - `getAuthToken()`   — reads `localStorage.getItem('token')` FRESH on every
 *                          call; `null` when absent; otherwise `JSON.parse`s the
 *                          value (the AngularJS `$tgStorage` persists it
 *                          JSON-stringified under the literal key `'token'` —
 *                          `auth.coffee:136-140`, `base/storage.coffee:27-32`).
 *   - `getSessionId()`   — returns `window.taiga?.sessionId ?? null`; never
 *                          generates a new id (`app.coffee:26,593,601`).
 */

import {
    getConfig,
    getApiUrl,
    getEventsUrl,
    getAuthToken,
    getSessionId,
} from '../session';

/*
 * Isolation: every spec must start from a pristine ambient state so the suite
 * is deterministic and order-independent. jsdom gives each test file one shared
 * `window` / `localStorage`, so we reset all three surfaces the module reads —
 * the `localStorage` store and the two `window` globals (`taiga`,
 * `taigaConfig`) — after each test. `jest.clearAllMocks()` is included for
 * forward-compatibility should any spec introduce a mock.
 */
afterEach(() => {
    localStorage.clear();
    delete (window as any).taiga;
    delete (window as any).taigaConfig;
    jest.clearAllMocks();
});

describe('session bridge — getAuthToken (fresh localStorage read)', () => {
    it('returns the JSON-decoded token stored under the literal key "token"', () => {
        // The AngularJS shell persists the JWT JSON-stringified via $tgStorage,
        // i.e. localStorage.setItem('token', JSON.stringify(token)); the getter
        // JSON-parses it back to the raw token string.
        localStorage.setItem('token', JSON.stringify('jwt-xyz'));

        expect(getAuthToken()).toBe('jwt-xyz');
    });

    it('returns null when no token is stored', () => {
        // Nothing under 'token' (the store was cleared) => unauthenticated,
        // so the accessor yields null and callers omit the Authorization header.
        localStorage.clear();

        expect(getAuthToken()).toBeNull();
    });

    it('reads the value fresh on every call (never cached at import time)', () => {
        // Prove the accessor re-reads localStorage per call rather than
        // memoising a value captured when the module was first imported.
        localStorage.setItem('token', JSON.stringify('a'));
        expect(getAuthToken()).toBe('a');

        localStorage.setItem('token', JSON.stringify('b'));
        expect(getAuthToken()).toBe('b');
    });

    it('falls back to the raw string when the stored token is not valid JSON', () => {
        // Resilience path mirrored from readStoredString: a non-JSON value that
        // some other code path may have written is still returned verbatim so
        // the token remains usable (the AngularJS HTTP layer would send it too).
        localStorage.setItem('token', 'raw-token-not-json');

        expect(getAuthToken()).toBe('raw-token-not-json');
    });
});

describe('session bridge — getSessionId', () => {
    it('returns window.taiga.sessionId when it has been established', () => {
        // app.coffee generates the id ONCE on the global window.taiga object;
        // React reuses that exact id and never mints its own.
        (window as any).taiga = { sessionId: 's-1' };

        expect(getSessionId()).toBe('s-1');
    });

    it('returns null when window.taiga is unset', () => {
        // Before app.coffee has run (or after teardown) the global is absent;
        // the optional chain yields null and the caller omits X-Session-Id.
        delete (window as any).taiga;

        expect(getSessionId()).toBeNull();
    });

    it('returns null when window.taiga exists without a sessionId', () => {
        // A partially-populated global (no sessionId key) must still resolve to
        // null rather than undefined, matching AngularJS behaviour when unset.
        (window as any).taiga = {};

        expect(getSessionId()).toBeNull();
    });
});

describe('session bridge — getConfig / getApiUrl / getEventsUrl', () => {
    it('reads the api base and a null eventsUrl from a minimal window.taigaConfig', () => {
        // The minimal same-origin shape: a relative /api/v1/ base with live
        // updates disabled (eventsUrl null) — the app-loader default.
        (window as any).taigaConfig = { api: '/api/v1/', eventsUrl: null };

        expect(getApiUrl()).toBe('/api/v1/');
        expect(getEventsUrl()).toBeNull();
    });

    it('reads the api base and eventsUrl from a full window.taigaConfig', () => {
        // A fully-populated config (mirrors app-loader.coffee defaults) must be
        // passed through verbatim — no path joining, trimming, or rewriting.
        (window as any).taigaConfig = {
            api: 'http://localhost:8000/api/v1/',
            eventsUrl: 'ws://localhost:8888/events',
        };

        expect(getConfig().api).toBe('http://localhost:8000/api/v1/');
        expect(getApiUrl()).toBe('http://localhost:8000/api/v1/');
        expect(getEventsUrl()).toBe('ws://localhost:8888/events');
    });

    it('falls back to a safe default without throwing when config is unset', () => {
        // Defensive same-origin fallback used only if React somehow renders
        // before app-loader.coffee has populated window.taigaConfig. It must be
        // total (never throw) and yield the documented default.
        delete (window as any).taigaConfig;

        expect(() => getConfig()).not.toThrow();
        expect(getConfig()).toEqual({ api: '/api/v1/', eventsUrl: null });
        expect(getApiUrl()).toBe('/api/v1/');
        expect(getEventsUrl()).toBeNull();
    });
});
