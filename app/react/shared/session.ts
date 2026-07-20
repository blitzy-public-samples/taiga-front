/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * session.ts — shared auth / session / runtime-config bridge for the React
 * (Kanban + Backlog) screens that run in-place inside the AngularJS 1.5.10 shell.
 *
 * WHY THIS EXISTS
 *   This module is the SINGLE source, within the `app/react/**` tree, for the
 *   three pieces of ambient state the React screens must borrow from the still
 *   AngularJS application:
 *     1. the JWT bearer token,
 *     2. the `X-Session-Id` correlation id, and
 *     3. the runtime configuration object (`window.taigaConfig`).
 *
 *   Because React coexists inside the same client (the incremental "Strangler"
 *   migration — see `shared/mount.tsx`), it MUST reuse the exact values the
 *   AngularJS shell already holds. When `shared/api/client.ts` attaches the auth
 *   headers and `shared/events.ts` authenticates the WebSocket, the Django
 *   `/api/v1/` backend and the events gateway cannot distinguish React traffic
 *   from AngularJS traffic — the contract is byte-for-byte identical.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   - It performs NO authentication: it never logs in, never refreshes, and
 *     never mints a session id. It only READS the token and session id the
 *     AngularJS shell already established.
 *   - It hardcodes NO URLs: the API base comes from `window.taigaConfig.api`
 *     and the events base from `window.taigaConfig.eventsUrl`. The only literal
 *     here is a defensive same-origin fallback used solely if React somehow
 *     renders before `app-loader.coffee` has populated the config.
 *
 * SOURCE OF TRUTH (reproduced exactly — do not diverge)
 *   - Token/refresh storage — `app/coffee/modules/base/storage.coffee` +
 *     `app/coffee/modules/auth.coffee`: `$tgStorage.set(key, val)` stores
 *     `localStorage.setItem(key, JSON.stringify(val))` and `.get(key)` reads
 *     `JSON.parse(localStorage.getItem(key))`. `auth.coffee` persists the JWT
 *     under the literal key `"token"` (and the refresh token under `"refresh"`),
 *     so the raw JWT is `JSON.parse(localStorage.getItem("token"))`. The
 *     AngularJS HTTP layer sends it as `Authorization: Bearer <token>`
 *     (`app/coffee/modules/base/http.coffee:21-23`).
 *   - Session id — `app/coffee/app.coffee:26`: `taiga.sessionId` is generated
 *     ONCE at load on the GLOBAL `window.taiga` object and sent as `X-Session-Id`
 *     on every request (`app.coffee:593,601`) and handed to the events service
 *     (`app.coffee:606`). React reads that same id; it never generates its own.
 *   - Config — `app-loader/app-loader.coffee:11-34` seeds `window.taigaConfig`
 *     defaults (`api`, `eventsUrl`, heartbeat settings, `baseHref`, …) and then
 *     merges `conf.json` over them (`app-loader.coffee:116-131`).
 *
 * OWNERSHIP INVARIANT
 *   This file is the SOLE owner of the global `Window` type augmentation for
 *   `taigaConfig` and `taiga`. No other file in `app/react/**` declares those
 *   globals (`shared/types.ts` intentionally defers the augmentation here).
 *
 * PURITY INVARIANT
 *   Every accessor is a pure function that reads `window` / `localStorage` at
 *   CALL time. Nothing is cached at module load and there are no import-time
 *   side effects, so (a) a token refreshed by the AngularJS 401 interceptor is
 *   picked up automatically on the next call, and (b) unit tests can stub
 *   `localStorage`, `window.taiga`, and `window.taigaConfig` (jsdom) freely.
 *
 * Toolchain: TypeScript 5.4.5 under `strict`, `jsx: "react-jsx"` (no
 * `import React`), Node v16.19.1 compatible. Bundled by esbuild into
 * `dist/js/react.js`.
 */

import type { TaigaConfig } from './types';

/* ========================================================================== *
 * Phase 1 — Global type augmentation (single owner)
 *
 * Declared ONCE here for the whole React tree. `taigaConfig` and `taiga` are
 * both optional because, in principle, a React root could be constructed before
 * `app-loader.coffee` / `app.js` have run; every accessor below tolerates their
 * absence rather than assuming they exist.
 * ========================================================================== */

declare global {
    interface Window {
        /** Runtime configuration seeded by `app-loader.coffee` + `conf.json`. */
        taigaConfig?: TaigaConfig;
        /**
         * The global `taiga` namespace created by `app.coffee`. Only
         * `sessionId` is consumed by React; the index signature preserves the
         * many other members AngularJS attaches without constraining them.
         */
        taiga?: {
            sessionId?: string;
            [key: string]: unknown;
        };
    }
}

/* ========================================================================== *
 * Phase 2 — Runtime configuration accessors (never hardcode URLs)
 * ========================================================================== */

/**
 * Return the live runtime configuration.
 *
 * In production `app-loader.coffee` always sets `window.taigaConfig` (defaults
 * merged with `conf.json`) long before any React screen renders, so the first
 * branch is taken. The second branch is a defensive same-origin fallback that
 * keeps the accessors total — it never throws — should React somehow render
 * first. The fallback is built fresh on each call; nothing is cached.
 *
 * @returns The current `window.taigaConfig`, or a minimal same-origin default.
 */
export function getConfig(): TaigaConfig {
    const config = window.taigaConfig;
    if (config) {
        return config;
    }

    // Same-origin relative default: the nginx gateway proxies `/api/v1/` to the
    // backend, so a relative base is safe when the real config is not yet
    // present. `eventsUrl: null` disables live updates until config arrives.
    return { api: '/api/v1/', eventsUrl: null };
}

/**
 * Return the REST API base URL (always ends in `/api/v1/`).
 *
 * The value is passed through verbatim from the config — no path joining,
 * trimming, or normalisation happens here. `shared/api/client.ts` owns safe
 * joining of the base with individual endpoint paths.
 *
 * @returns The `/api/v1/` base URL from the runtime config.
 */
export function getApiUrl(): string {
    return getConfig().api;
}

/**
 * Return the WebSocket events endpoint, or `null` when live updates are
 * disabled (the default until `conf.json` supplies an `eventsUrl`).
 *
 * @returns The events base URL, or `null`.
 */
export function getEventsUrl(): string | null {
    return getConfig().eventsUrl ?? null;
}

/* ========================================================================== *
 * Phase 3 — Token & session accessors (read fresh on every call)
 * ========================================================================== */

/**
 * Read a `$tgStorage`-encoded value from `localStorage` by key.
 *
 * Mirrors `StorageService.get` from `app/coffee/modules/base/storage.coffee`:
 * values are stored `JSON.stringify`-encoded, so the primary path is
 * `JSON.parse`. Unlike `$tgStorage` (which returns `null` on a parse error),
 * this helper returns the raw string on parse failure so a non-JSON token that
 * some other code path may have written is still usable — the AngularJS HTTP
 * layer would send that raw value too.
 *
 * @param key The `localStorage` key to read (`"token"` or `"refresh"`).
 * @returns The decoded string value, or `null` when the key is absent.
 */
function readStoredString(key: string): string | null {
    const raw = localStorage.getItem(key);
    if (raw == null) {
        return null;
    }

    try {
        return JSON.parse(raw) as string;
    } catch {
        return raw;
    }
}

/**
 * Return the current JWT bearer token, read FRESH from `localStorage` on every
 * call so a token rotated by the AngularJS 401 interceptor is picked up by React
 * automatically.
 *
 * The key is the literal `"token"` and the value is JSON-encoded, exactly as
 * `auth.coffee`'s `setToken` / `getToken` and `$tgStorage` use it. Returns
 * `null` when no token is stored (the caller then omits the `Authorization`
 * header, matching AngularJS when logged out).
 *
 * @returns The raw JWT string, or `null` when unauthenticated.
 */
export function getAuthToken(): string | null {
    return readStoredString('token');
}

/**
 * Return the current refresh token, read FRESH from `localStorage` on every
 * call. Stored by `auth.coffee`'s `setRefreshToken` under the literal key
 * `"refresh"`, JSON-encoded like the access token. Exposed for symmetry with
 * the AngularJS auth service; returns `null` when absent.
 *
 * @returns The raw refresh-token string, or `null` when none is stored.
 */
export function getRefreshToken(): string | null {
    return readStoredString('refresh');
}

/**
 * Return the `X-Session-Id` correlation id established ONCE by `app.coffee` on
 * the global `window.taiga` object. React reuses this exact id so requests are
 * correlated identically to AngularJS; it NEVER generates a new one.
 *
 * Returns `null` if `window.taiga` (or its `sessionId`) is not yet present — in
 * which case the caller simply omits the header, matching AngularJS behaviour
 * when the id is unset.
 *
 * @returns The existing session id, or `null` when it has not been set.
 */
export function getSessionId(): string | null {
    return window.taiga?.sessionId ?? null;
}

/* ========================================================================== *
 * Phase 4 — Preferred-language accessor (read fresh on every call)
 * ========================================================================== */

/**
 * Return the language tag the React screens must send as `Accept-Language`,
 * reproducing the AngularJS data-layer contract EXACTLY.
 *
 * SOURCE OF TRUTH (`app/coffee/modules/base/http.coffee:25-28`)
 *   `$tgHttp` — the general HTTP service that `resources.coffee` (and therefore
 *   every user-story / milestone request the React `client.ts` replaces) routes
 *   through — attaches `Accept-Language: <lang>` on EVERY verb, where
 *   `<lang> = $translate.preferredLanguage()`. So this header is not optional or
 *   verb-specific: to be byte-for-byte indistinguishable from AngularJS traffic
 *   the React client must send it on GET, POST, PATCH, PUT and DELETE alike.
 *
 * RESOLUTION ORDER (most-live first, mirroring how the shell derives the value)
 *   1. `document.documentElement.lang` — `i18nInit` sets `<html lang="…">` on
 *      every `$translateChangeEnd` (`app.coffee:859`), so this reflects the
 *      language the user is CURRENTLY viewing, including any runtime switch.
 *      This is the single most faithful mirror of `preferredLanguage()` in a
 *      live session, and it automatically tracks language changes with no
 *      caching.
 *   2. `userInfo.lang` from `localStorage.userInfo` — the persisted per-user
 *      preference that SEEDS `preferredLanguage()` at bootstrap
 *      (`app.coffee:793-796`, `.preferredLanguage(preferedLangCode)` at :805).
 *      Used when React renders before the first `$translateChangeEnd` has
 *      stamped `<html lang>`.
 *   3. `window.taigaConfig.defaultLanguage` — the instance-wide default, the
 *      next term of the same coffee expression (`app.coffee:796`).
 *   4. `"en"` — angular-translate's `fallbackLanguage("en")` (`app.coffee:808`),
 *      the final backstop so the header is always well-formed.
 *
 * Returns `null` only in the (practically impossible) case that every source is
 * absent AND the `"en"` backstop is somehow unreachable; callers then simply
 * omit the header, matching AngularJS when `preferredLanguage()` is falsy.
 *
 * @returns The BCP-47 language tag to send, or `null` when none is resolvable.
 */
export function getLanguage(): string | null {
    // 1. Live current language stamped on <html> by i18nInit.
    const htmlLang = document.documentElement.getAttribute('lang');
    if (htmlLang) {
        return htmlLang;
    }

    // 2. Persisted per-user preference (localStorage.userInfo is a JSON object,
    //    not a `$tgStorage` string, so it is parsed directly here).
    const rawUserInfo = localStorage.getItem('userInfo');
    if (rawUserInfo) {
        try {
            const userInfo = JSON.parse(rawUserInfo) as { lang?: unknown };
            if (typeof userInfo.lang === 'string' && userInfo.lang) {
                return userInfo.lang;
            }
        } catch {
            // Corrupt userInfo — fall through to the config/default chain,
            // exactly as the coffee `userInfo?.lang` would yield undefined.
        }
    }

    // 3. Instance default from runtime config.
    const configured = getConfig().defaultLanguage;
    if (configured) {
        return configured;
    }

    // 4. angular-translate's fallbackLanguage backstop.
    return 'en';
}

/* ========================================================================== *
 * Phase 5 — Token mutators & logout (used by the client's 401 refresh machine)
 *
 * These write the SAME `localStorage` keys, JSON-encoded the SAME way, as the
 * AngularJS auth service (`auth.coffee`) and its 401 interceptor
 * (`app.coffee:608-707`). They exist so `shared/api/client.ts` can port the
 * shell's single-flight token-refresh/retry/logout state machine for the React
 * screens — whose `fetch` calls are NOT intercepted by the AngularJS
 * `$httpProvider` interceptor and therefore must refresh their own token to stay
 * behaviourally identical to AngularJS traffic (review finding F-SEC-02).
 *
 * A React-initiated refresh and an AngularJS-initiated refresh remain mutually
 * consistent precisely because both read and write these identical keys.
 * ========================================================================== */

/**
 * Persist a freshly-minted JWT access token, JSON-encoded under the literal key
 * `"token"` — byte-for-byte how `auth.coffee`'s `setToken` →
 * `$tgStorage.set("token", …)` stores it (`auth.coffee:136-137`,
 * `base/storage.coffee:27-32`). The very next `getAuthToken()` (and thus the
 * next `Authorization: Bearer` header) picks it up because nothing is cached.
 *
 * @param token The new raw JWT string returned by `/auth/refresh`
 *              (`responseRefresh.data.auth_token`, `app.coffee:632`).
 */
export function setAuthToken(token: string): void {
    localStorage.setItem('token', JSON.stringify(token));
}

/**
 * Persist a freshly-minted refresh token, JSON-encoded under the literal key
 * `"refresh"`, mirroring `auth.coffee`'s `setRefreshToken` →
 * `$tgStorage.set("refresh", …)` (`auth.coffee:130-131`).
 *
 * @param token The new refresh token returned by `/auth/refresh`
 *              (`responseRefresh.data.refresh`, `app.coffee:633`).
 */
export function setRefreshToken(token: string): void {
    localStorage.setItem('refresh', JSON.stringify(token));
}

/**
 * Clear the stored session on an unrecoverable auth failure, removing exactly
 * the three keys the AngularJS interceptor's `errorToken` path removes: the
 * access `token`, the `refresh` token, and the cached `userInfo`
 * (`app.coffee:627-628,636-641` → `storage.remove("refresh")` +
 * `removeUser()` which removes `token` and `userInfo`; cf. `auth.coffee`
 * `removeToken`/`clear`). After this, `getAuthToken()`/`getRefreshToken()`
 * return `null`, so no stale or compromised credential is ever reused.
 */
export function clearSession(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh');
    localStorage.removeItem('userInfo');
}

/**
 * Navigate the whole client to the login screen after an unrecoverable auth
 * failure, reproducing the AngularJS interceptor's default redirect
 * `window.location.href = $navUrls.resolve("login") +
 * '?unauthorized=true&next=' + nextUrl` (`app.coffee:643-645`).
 *
 * The login path is the same `/login` route the shell resolves
 * (`base.coffee:42`), prefixed by the configured `baseHref` (default `/`), and
 * `next` is the current in-app URL so the user returns where they were after
 * re-authenticating. The assignment is wrapped in a `try/catch` because jsdom
 * (unit-test environment) does not implement navigation and would otherwise
 * throw; in a real browser the navigation proceeds normally.
 */
export function redirectToLogin(): void {
    const baseHref = getConfig().baseHref ?? '/';
    const loginBase = `${baseHref.replace(/\/+$/, '')}/login`;
    const nextUrl = `${window.location.pathname}${window.location.search}`;
    const target = `${loginBase}?unauthorized=true&next=${encodeURIComponent(nextUrl)}`;

    try {
        window.location.href = target;
    } catch {
        // jsdom has no navigation; swallowing keeps the transport total in unit
        // tests. Real browsers navigate before this line can throw.
    }
}

/**
 * Navigate the whole client to the shell-owned user-story DETAIL screen
 * (`/project/:slug/us/:ref`) — the SAME route the Kanban card title link and the
 * backlog row subject link already target (see `Card.tsx` `usHref`).
 *
 * This is the migration's parity replacement for the deleted COMMON-module
 * dialogs that the AngularJS controllers opened on "Edit card" / "Assign To"
 * (`genericform:edit`) and on the backlog "Edit" option: the AAP lists the
 * common module OUT OF SCOPE (§0.2.2) and defines NO React edit/assignee
 * component (§0.4.1), so rather than reproducing an out-of-scope lightbox the
 * card/row actions route to the still-AngularJS US detail screen, which OWNS
 * viewing, editing, and assignment. Consolidating "Assign To" onto the same
 * detail screen (instead of an inline assignee picker) is a deliberate,
 * AAP-scoped deviation from that finding's literal suggestion — the
 * `tg-lb-select-user` lightbox it named is itself common-module OOS.
 *
 * The URL format mirrors `Card.tsx`'s `usHref` byte-for-byte
 * (`project-userstories-detail = /project/:project/us/:ref`, `base.coffee:71-73`)
 * so the destination is identical to clicking the card title. The assignment is
 * wrapped in a `try/catch` for the same jsdom reason as `redirectToLogin`.
 *
 * @param projectSlug the owning project's slug (`project.slug`)
 * @param usRef       the user story's human `ref` (NOT its numeric `id`)
 */
export function navigateToUserStoryDetail(
    projectSlug: string | null | undefined,
    usRef: number | null | undefined,
): void {
    // Defensive: never navigate to a malformed `/project//us/undefined` URL when
    // the slug or ref cannot be resolved (the callers already guard, but a bad
    // navigation must never be attempted).
    if (!projectSlug || usRef == null) {
        return;
    }
    const target = `/project/${projectSlug}/us/${usRef}`;
    try {
        window.location.href = target;
    } catch {
        // jsdom has no navigation; swallowing keeps unit tests total. Real
        // browsers navigate before this line can throw.
    }
}
