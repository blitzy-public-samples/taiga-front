/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { MountContext } from "../types";

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
 * Resolution order:
 *   1. The live `localStorage["token"]` value (JSON-decoded, as `$tgStorage`
 *      stores every value via `JSON.stringify`). A refreshed token is written
 *      here by the surviving AngularJS auth layer, so this always reflects the
 *      newest credential.
 *   2. The `MountContext.token` snapshot — used as a fallback in environments
 *      without `localStorage` (e.g. unit tests that pass a synthetic context).
 *
 * A missing / malformed / non-string stored value yields the context fallback,
 * and ultimately `null` (treated as "no token") — never a thrown error.
 */
export function readLiveToken(context: Pick<MountContext, "token">): string | null {
    try {
        if (typeof localStorage !== "undefined") {
            const raw = localStorage.getItem("token");
            if (raw !== null) {
                const parsed: unknown = JSON.parse(raw);
                if (typeof parsed === "string" && parsed.length > 0) {
                    return parsed;
                }
                // A present-but-non-string value is malformed: fall through to
                // the context fallback rather than returning a bogus token.
            }
        }
    } catch {
        // Malformed / non-JSON stored value — fall through to the snapshot.
    }
    return context.token ?? null;
}
