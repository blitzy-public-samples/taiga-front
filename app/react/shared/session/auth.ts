/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Read-only session/token adapter for the React screens.
 *
 * The Kanban and Backlog React roots run inside the SAME document as the
 * surviving AngularJS 1.5.10 application and MUST reuse the exact same
 * authenticated session. AngularJS owns every WRITE to the session
 * (login / logout / token refresh); this module only READS what AngularJS
 * has already persisted. There are deliberately NO setters here.
 *
 * AngularJS stores the JWT bearer token through `$tgStorage`
 * (app/coffee/modules/base/storage.coffee) under the localStorage key
 * "token", and the refresh token under "refresh". Crucially `$tgStorage`
 * JSON-ENCODES every value on write and JSON-DECODES on read:
 *
 *   set(key, val) -> localStorage.setItem(key, JSON.stringify(val))
 *   get(key)      -> const v = localStorage.getItem(key);
 *                    if (v === null) return null;
 *                    try { return JSON.parse(v); } catch { return null; }
 *
 * The token is therefore stored as a JSON string (wrapped in quotes). A raw
 * `localStorage.getItem("token")` would return the value WITH its surrounding
 * quotes and corrupt the `Authorization: Bearer <token>` header that
 * app/coffee/modules/base/http.coffee (L21-23) builds. These getters
 * replicate `$tgStorage.get` EXACTLY so the header matches AngularJS.
 */

/**
 * Replicates `$tgStorage.get(key)`: read the raw string, return null when
 * absent, otherwise JSON.parse inside a try/catch that returns null on
 * malformed JSON. Defensive against an unavailable localStorage (e.g. a
 * non-browser host or privacy mode) -> returns null.
 */
const readStorageString = (key: string): string | null => {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return null;
        }

        const serializedValue = window.localStorage.getItem(key);
        if (serializedValue === null) {
            return null;
        }

        const parsed: unknown = JSON.parse(serializedValue);
        return typeof parsed === "string" ? parsed : null;
    } catch {
        return null;
    }
};

/**
 * The JWT bearer token AngularJS stored under localStorage["token"],
 * JSON-decoded so it drops straight into `Authorization: Bearer <token>`.
 * Returns null when no session exists or the stored value is malformed.
 */
export const getToken = (): string | null => readStorageString("token");

/**
 * The refresh token AngularJS stored under localStorage["refresh"],
 * JSON-decoded. Returns null when absent or malformed.
 */
export const getRefreshToken = (): string | null => readStorageString("refresh");

/**
 * The current authenticated user, as AngularJS cached it under
 * localStorage["userInfo"] (`authService` `setUserdata` ->
 * `$tgStorage.set("userInfo", userModel._attrs)`, app/coffee/modules/auth.coffee
 * L96-L100). Unlike the token, this value is a JSON OBJECT (not a string), so it
 * is JSON-decoded and returned as-is. Returns null when no session exists or the
 * stored value is malformed / not an object.
 *
 * The React screens read this ONLY to resolve "self" affordances that AngularJS
 * also derives from the same cache — e.g. the create/edit lightbox's
 * "Assign to me" control (ports `$currentUserService.getUser().get('id')`,
 * app/modules/components/assigned-inline/assigned-users-inline.directive.coffee
 * L79-L80). It never writes, so it establishes no parallel session identity.
 */
export interface CurrentUser {
    /** The user's numeric id (the only field the React screens strictly need). */
    id: number;
    /** Display name, when present. */
    full_name_display?: string;
    /** Login handle, when present. */
    username?: string;
    /** Avatar photo URL, when present (may be null for the default avatar). */
    photo?: string | null;
    /** Gravatar seed used by the default-avatar hash, when present. */
    gravatar_id?: string;
    /** Any other cached fields are preserved but untyped. */
    [key: string]: unknown;
}

export const getCurrentUser = (): CurrentUser | null => {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return null;
        }
        const serializedValue = window.localStorage.getItem("userInfo");
        if (serializedValue === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(serializedValue);
        if (
            parsed !== null &&
            typeof parsed === "object" &&
            typeof (parsed as { id?: unknown }).id === "number"
        ) {
            return parsed as CurrentUser;
        }
        return null;
    } catch {
        return null;
    }
};

/*
 * ---------------------------------------------------------------------------
 * SESSION WRITES — narrowly scoped to the React-side 401 token-refresh flow.
 * ---------------------------------------------------------------------------
 *
 * This module is READ-mostly by design: AngularJS owns login / logout. The one
 * exception is the 401 recovery flow. Because the React screens issue their own
 * `fetch` requests they DO NOT pass through the AngularJS `$httpProvider`
 * `authHttpIntercept` (app/coffee/app.coffee L609-707). A mid-session 401 on a
 * React request therefore has to be recovered by the React HTTP layer itself
 * (`shared/api/httpInterceptor.ts`). When that refresh succeeds it MUST persist
 * the rotated `token` + `refresh` back to the SAME shared localStorage keys so
 * the surviving AngularJS app immediately sees the renewed session — exactly as
 * the AngularJS interceptor does (`storage.set("token", data.auth_token)` /
 * `storage.set("refresh", data.refresh)`, app.coffee L631-632). On refresh
 * failure the session is cleared the same way AngularJS `removeUser()` does
 * (remove "token" / "userInfo" / "refresh", app.coffee L629-630, L642).
 *
 * These writers replicate `$tgStorage.set` / `.remove` EXACTLY (JSON-encode on
 * write; guarded against an unavailable localStorage) so the values round-trip
 * through the read getters above and through AngularJS `$tgStorage.get`.
 */

/** Replicates `$tgStorage.set(key, value)`: JSON-encode then persist. Best-effort. */
const writeStorageString = (key: string, value: string): void => {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return;
        }
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* best-effort: ignore storage failures (private mode, quota, jsdom) */
    }
};

/** Replicates `$tgStorage.remove(key)`. Best-effort. */
const removeStorageKey = (key: string): void => {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return;
        }
        window.localStorage.removeItem(key);
    } catch {
        /* best-effort: ignore storage failures */
    }
};

/**
 * Persist a freshly issued JWT bearer token to the shared localStorage["token"],
 * JSON-encoded to match `$tgStorage.set` so AngularJS reads it back verbatim.
 */
export const setToken = (token: string): void => writeStorageString("token", token);

/** Persist a rotated refresh token to the shared localStorage["refresh"]. */
export const setRefreshToken = (token: string): void => writeStorageString("refresh", token);

/**
 * Clear the shared session, mirroring AngularJS `removeUser()` + refresh removal
 * (app.coffee L629-630, L642): drop the access token, the cached user info, and
 * the refresh token. Called when a 401 cannot be recovered, immediately before
 * redirecting to the login screen.
 */
export const clearSession = (): void => {
    removeStorageKey("token");
    removeStorageKey("userInfo");
    removeStorageKey("refresh");
};
