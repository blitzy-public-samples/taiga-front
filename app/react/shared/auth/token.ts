/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { MountContext } from "../types";

/**
 * Decode a `$tgStorage` string value (every value is persisted via
 * `JSON.stringify` in `base/storage.coffee`). Returns the decoded string when
 * the stored value is a non-empty JSON string, otherwise `null` (absent,
 * malformed/non-JSON, non-string, or empty). Never throws.
 */
function readStorageString(key: string): string | null {
    try {
        if (typeof localStorage === "undefined") {
            return null;
        }
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "string" && parsed.length > 0) {
            return parsed;
        }
    } catch {
        // Malformed / non-JSON stored value — treat as absent.
    }
    return null;
}

/**
 * Read the CURRENT bearer token, mirroring the legacy `$tgStorage.get("token")`
 * (`base/storage.coffee`) that the AngularJS auth interceptor consulted on
 * EVERY request.
 *
 * Finding M8 (auth lifecycle): the mount `MountContext.token` is a ONE-TIME
 * snapshot taken in the Custom Element `connectedCallback`. If the JWT is
 * refreshed (or the user re-authenticates) while a React screen is mounted, a
 * snapshot would leave the REST client and the WebSocket auth frame stale,
 * causing silent 401s until the next route change. Reading the token LIVE from
 * `localStorage` on each request / each socket (re)connect keeps credentials
 * current for the lifetime of the mount, exactly as the legacy interceptor did.
 *
 * Finding C4 (authoritative logout — no token resurrection): when
 * `localStorage` IS available it is the SINGLE SOURCE OF TRUTH for the session,
 * exactly as it was for the legacy `$tgStorage`-backed auth layer. If the stored
 * "token" key is absent, empty, malformed, or non-string, that is an
 * AUTHORITATIVE "no session" signal — the surviving AngularJS auth layer clears
 * the key on logout / refresh-failure — so this returns `null` and the caller
 * must NOT authenticate. The stale one-time `MountContext.token` snapshot is
 * DELIBERATELY NOT consulted in that case; resurrecting it would let a logged-out
 * screen keep issuing authenticated REST calls and WebSocket auth frames with a
 * credential the user has already discarded.
 *
 * Resolution order:
 *   1. When `localStorage` is available: the live `localStorage["token"]` value
 *      (JSON-decoded) is authoritative. Present + valid -> that token. Absent /
 *      empty / malformed / non-string -> `null` (authoritative logout).
 *   2. Only when `localStorage` is entirely UNAVAILABLE (e.g. an SSR/bare Node
 *      context, or a unit test with no DOM storage) does the
 *      `MountContext.token` snapshot serve as the sole credential source, since
 *      there is no authoritative store to consult.
 *
 * Never throws.
 */
export function readLiveToken(context: Pick<MountContext, "token">): string | null {
    // When a real storage exists, it is authoritative: its absence of a valid
    // token means "logged out", and the mount snapshot MUST NOT resurrect a
    // discarded credential (finding C4).
    if (typeof localStorage !== "undefined") {
        return readStorageString("token");
    }
    // No storage at all (non-DOM host): the snapshot is the only source.
    return context.token ?? null;
}

/**
 * Read the CURRENT refresh token from `$tgStorage` ("refresh", JSON-decoded),
 * mirroring the legacy `auth.coffee` `getRefreshToken()` / the `app.coffee`
 * interceptor's `storage.get("refresh")`. Used by the single-flight token
 * refresh in `http.ts` (finding C3). Returns `null` when absent/malformed —
 * the caller then treats the session as unrecoverable and logs out.
 */
export function readStoredRefresh(): string | null {
    return readStorageString("refresh");
}

/**
 * Clear the persisted session, mirroring the legacy interceptor's `errorToken`
 * teardown (`storage.remove("token"/"userInfo"/"refresh")` in `app.coffee`).
 * Invoked by `http.ts` on a refresh failure / unrecoverable 401 (finding C3),
 * so the authoritative store reflects the logged-out state that `readLiveToken`
 * then reports. Never throws.
 */
export function clearStoredSession(): void {
    try {
        if (typeof localStorage === "undefined") {
            return;
        }
        localStorage.removeItem("token");
        localStorage.removeItem("userInfo");
        localStorage.removeItem("refresh");
    } catch {
        // A storage that rejects writes (private mode quota, etc.) — best effort.
    }
}
