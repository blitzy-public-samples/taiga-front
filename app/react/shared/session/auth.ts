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
