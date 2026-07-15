/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Session / authentication adapter for the React coexistence layer.
 *
 * This module lets the migrated React screens (Kanban and Backlog) REUSE the
 * existing AngularJS 1.5.10 session and authentication state instead of
 * establishing their own. It reads the *identical* browser storage keys and
 * `window` globals the incumbent AngularJS client uses, so per-project and
 * per-feature permission gates behave byte-for-byte identically across the two
 * frameworks and the frozen Django `/api/v1/` contract keeps accepting the
 * requests.
 *
 * It is a faithful, framework-agnostic re-implementation of three AngularJS
 * reads:
 *
 *   1. TOKEN — `app/coffee/modules/base/storage.coffee` `StorageService`
 *      persists values with `localStorage.setItem(key, JSON.stringify(val))`
 *      and reads them back with `JSON.parse`. A string token is therefore
 *      stored WITH surrounding quotes (e.g. `"eyJhbGci..."`). React must read
 *      it the same way — `JSON.parse(localStorage.getItem('token'))` — NOT as
 *      the raw string. `app/coffee/modules/base/http.coffee:21-23` reads
 *      `token = @storage.get('token')` and, when truthy, sets
 *      `Authorization: "Bearer #{token}"`.
 *
 *   2. SESSION ID — `app/coffee/app.coffee:9,20-26` creates the browser global
 *      `window.taiga` (`@taiga = taiga = {}`) and assigns
 *      `taiga.sessionId = taiga.generateUniqueSessionIdentifier()` once at
 *      app-load time. AngularJS `$http` sends it as the `X-Session-Id` header
 *      (`app/coffee/app.coffee:590-594`). React reuses the SAME
 *      `window.taiga.sessionId` (it never generates a new one) so the backend
 *      correlates React and AngularJS traffic to one session.
 *
 *   3. PREFERRED LANGUAGE — `app/coffee/app.coffee:792-796` computes
 *      `userInfo?.lang || window.taigaConfig.defaultLanguage || "en"`, where
 *      `userInfo` is `JSON.parse(localStorage.userInfo)`. AngularJS
 *      `$tgHttp.headers()` sends this as `Accept-Language`
 *      (`app/coffee/modules/base/http.coffee:26-28`).
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from `app/coffee/**`,
 * `app/modules/**`, `elements.js`, or AngularJS. The ONLY cross-framework interop
 * is reading the browser `localStorage` keys and the `window.taiga` global, and
 * the ONLY in-repo import is the sibling `./config` module (for the language
 * fallback). There is no `angular` reference anywhere in this module.
 */

import { getDefaultLanguage } from './config';

declare global {
  /**
   * `session.ts` OWNS the typing of the `window.taiga` global. The sibling
   * `config.ts` separately owns the `window.taigaConfig` typing; to avoid
   * duplicate/conflicting global augmentations (TS2717), `taiga` must NOT be
   * redeclared elsewhere and `taigaConfig` must NOT be redeclared here.
   *
   * The AngularJS app assigns `@taiga = taiga = {}` and, immediately after,
   * `taiga.sessionId = taiga.generateUniqueSessionIdentifier()` at boot
   * (`app/coffee/app.coffee`). Typed as optional because the global may be
   * absent in some runtimes (for example under Jest/jsdom before a spec assigns
   * it). The index signature admits every other property AngularJS may attach
   * to `taiga` (e.g. `emojis`, hashing helpers) without enumerating keys the
   * React screens never touch.
   */
  interface Window {
    taiga?: {
      sessionId?: string;
      [key: string]: unknown;
    };
  }
}

/**
 * Returns the authentication token, or `null` when the user is not logged in.
 *
 * Reproduces `StorageService.get('token')` from
 * `app/coffee/modules/base/storage.coffee:17-25` exactly:
 *   - a missing key (`getItem` returns `null`) yields `null`;
 *   - otherwise the stored value is `JSON.parse`d, and any parse error yields
 *     `null` (never a thrown exception).
 *
 * CRITICAL: the token is JSON-serialized in `localStorage` (the AngularJS
 * `StorageService.set` stores it via `JSON.stringify`, so a string token is
 * persisted WITH surrounding quotes). It MUST be read back with `JSON.parse`
 * — returning the raw `localStorage.getItem('token')` string would include the
 * quotes and produce `Authorization: Bearer "<token>"`, which the frozen
 * `/api/v1/` contract would reject. A common migration bug is reading the raw
 * string; this parse is what keeps the header byte-identical to the AngularJS
 * `$tgHttp` output.
 *
 * SECURITY / VALIDATION (F17, CWE-20/CWE-287): the parsed value is validated to
 * be a NON-EMPTY string before it is returned. `JSON.parse` can legitimately
 * yield an object, number, boolean, `null`, or an empty/whitespace-only string
 * for malformed or stale session state, and none of those is a usable bearer
 * credential. Returning such a value would (a) let a blank/whitespace token be
 * reported as "authenticated" while `httpClient` correctly omits the
 * `Authorization` header for it (the exact inconsistency F17 flags), and (b) risk
 * emitting a malformed `Authorization: Bearer [object Object]` header. Rejecting
 * them to `null` keeps `getToken()` and the `Authorization` header in lockstep:
 * the header is set iff `getToken()` is non-null, mirroring the legacy
 * `if token` guard (`http.coffee`), which omits the header for a falsy/empty
 * token. A genuine token (which never contains surrounding whitespace) is
 * returned verbatim.
 *
 * @returns The bearer token string, or `null` if absent, unparseable, or not a
 *   non-empty string.
 */
export function getToken(): string | null {
  const raw = localStorage.getItem('token');

  if (raw === null) {
    return null;
  }

  let parsed: unknown;

  try {
    // Token is JSON-serialized (StorageService.set -> JSON.stringify), so it
    // must be JSON.parse'd back to the bare string — NOT returned raw.
    parsed = JSON.parse(raw);
  } catch {
    // Mirror StorageService.get's `catch -> return null` fallback for values
    // that are present but not parseable as JSON.
    return null;
  }

  // A usable bearer token must be a non-empty string. Reject objects, numbers,
  // booleans, JSON `null`, and empty/whitespace-only strings (F17). `trim()` is
  // used only to DECIDE emptiness — the original (untrimmed) value is returned
  // for a valid token so a legitimate credential is never mutated.
  if (typeof parsed !== 'string' || parsed.trim().length === 0) {
    return null;
  }

  return parsed;
}

/**
 * Returns the process-wide session identifier shared with the AngularJS client.
 *
 * Reads the same `window.taiga.sessionId` global that
 * `app/coffee/app.coffee:20-26` assigns at boot and that AngularJS `$http`
 * sends as the `X-Session-Id` header (`app/coffee/app.coffee:593`). React reuses
 * this value verbatim — it never generates a new session id — so the backend
 * correlates React and AngularJS requests to a single session.
 *
 * The `typeof window !== 'undefined'` guard keeps the accessor safe in
 * non-browser/test runtimes, and the `|| ''` fallback guarantees a string is
 * always returned (an empty string when the global has not yet been set), so
 * callers can build headers without null-checking.
 *
 * @returns The shared session id, or an empty string when unavailable.
 */
export function getSessionId(): string {
  return (typeof window !== 'undefined' && window.taiga && window.taiga.sessionId) || '';
}

/**
 * Returns the user's preferred language code for the `Accept-Language` header.
 *
 * Reproduces the precedence in `app/coffee/app.coffee:792-796`:
 *   `userInfo?.lang || window.taigaConfig.defaultLanguage || "en"`
 * i.e. the user's stored language wins, then the shared config default, then
 * the hard `"en"` fallback. The `userInfo` object is itself JSON-serialized in
 * `localStorage` (via the same `StorageService`), so it is read back with
 * `JSON.parse`.
 *
 * The config-default and final `"en"` fallback are delegated to
 * `getDefaultLanguage()` from `./config`, which already resolves
 * `defaultLanguage || 'en'`.
 *
 * @returns The preferred language code (guaranteed non-empty).
 */
export function getPreferredLanguage(): string {
  try {
    const rawUserInfo = localStorage.getItem('userInfo');

    if (rawUserInfo) {
      // `userInfo` is stored JSON-serialized, mirroring StorageService.set.
      const userInfo = JSON.parse(rawUserInfo) as { lang?: string } | null;

      if (userInfo && userInfo.lang) {
        return userInfo.lang;
      }
    }
  } catch {
    // A present-but-invalid `userInfo` value must not throw; fall through to
    // the shared config default exactly as the AngularJS `||` chain would.
  }

  // config.defaultLanguage || 'en'
  return getDefaultLanguage();
}

/**
 * Minimal shape of the persisted user-session object (`localStorage.userInfo`).
 *
 * Only fields the React layer may consult are named; every other attribute the
 * AngularJS user model persists is admitted via the index signature. The object
 * is a plain JSON snapshot of the AngularJS user attributes, not a model.
 */
export interface SessionUser {
  /** Numeric user id. */
  id?: number;
  /** Preferred UI language (also consulted by {@link getPreferredLanguage}). */
  lang?: string;
  /** Bearer token some legacy flows mirror onto the user object. */
  auth_token?: string;
  /** Tolerate any other persisted user attribute. */
  [key: string]: unknown;
}

/**
 * Returns the persisted user-session object, or `null` when no user is logged in.
 *
 * Reproduces the authoritative legacy session read from
 * `app/coffee/modules/auth.coffee` `CurrentUserService.getUser()`:
 *
 *     getUser: ->
 *         ...
 *         userData = @storage.get("userInfo")
 *         if userData
 *             user = @model.make_model("users", userData)
 *         ...
 *
 * i.e. it reads `userInfo` from storage (itself JSON-serialized via
 * `StorageService.set`) and treats a present, truthy, object value as the current
 * user. React does not build an AngularJS model — it returns the parsed plain
 * object. A missing key, a parse error, or a non-object value all yield `null`,
 * matching `StorageService.get`'s `catch -> null` behavior and the legacy
 * `if userData` truthiness guard.
 *
 * @returns The parsed user-session object, or `null` when absent/invalid.
 */
export function getUser(): SessionUser | null {
  const raw = localStorage.getItem('userInfo');

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    // `if userData` in the legacy accepts a truthy value; the user session is
    // always a JSON object, so require a non-null object here.
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as SessionUser;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Reports whether an authenticated user session exists.
 *
 * Reproduces the authoritative legacy contract from
 * `app/coffee/modules/auth.coffee` `CurrentUserService.isAuthenticated()`:
 *
 *     isAuthenticated: ->
 *         if @.getUser() != null
 *             return true
 *         ...
 *
 * Authentication is therefore defined by the presence of a valid user SESSION
 * (`getUser() != null`), NOT by the raw bearer token. This is deliberate (F17):
 *   - it matches the legacy user/session truthiness model exactly, and
 *   - it no longer reports "authenticated" for a blank/empty token value while
 *     `httpClient` omits the `Authorization` header for that same value — the
 *     inconsistency the previous token-derived implementation exhibited.
 * The bearer-token concern is owned separately by {@link getToken} (which now
 * rejects empty/invalid tokens), so the `Authorization` header and the
 * authentication check are each faithful to their respective legacy sources.
 *
 * @returns `true` when a valid user session exists, otherwise `false`.
 */
export function isAuthenticated(): boolean {
  return getUser() !== null;
}
