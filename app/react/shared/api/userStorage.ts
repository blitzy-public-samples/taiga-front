/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * User-storage API for persisting the backlog's saved ("custom") filters,
 * hitting the FROZEN Django `/api/v1/user-storage` endpoints. This is a
 * faithful port of the AngularJS `tgFilterRemoteStorageService`
 * (app/modules/components/filter/filter-remote.service.coffee) and the
 * `tgUserResources` factory (app/modules/resources/user-resource.service.coffee):
 *
 *   - GET    /user-storage/{hash}   → `{ key, value }`  (value is the payload)
 *   - PUT    /user-storage/{hash}   body `{ key, value }`  (update)
 *   - POST   /user-storage          body `{ key, value }`  (create; PUT fallback)
 *   - DELETE /user-storage/{hash}   (remove when the value becomes empty)
 *
 * The storage key is `generateHash([projectId, "{projectId}:{suffix}"])`,
 * byte-identical to the AngularJS helper (see `shared/util/hash.ts`), so the
 * React screen reads and writes the SAME rows the AngularJS client used —
 * preserving a user's saved filters across the migration.
 *
 * No route is invented; `/api/v1/` is frozen and the backend pytest suite is
 * the authoritative contract guard.
 */

import { httpGet, httpPut, httpPost, httpDelete } from "./httpClient";
import { generateHash } from "../util/hash";

/**
 * The opaque per-name map a custom filter stores: filter query-param keys
 * (e.g. `status`, `exclude_tags`) → comma-joined id strings. Kept structurally
 * open because the endpoint round-trips it verbatim.
 */
export type StoredCustomFilters = Record<string, Record<string, string>>;

/** Shape of a single `/user-storage` row as returned by the backend. */
interface UserStorageRow<T> {
    key: string;
    value: T;
}

/**
 * Compute the storage hash for a project's namespaced key, mirroring
 * `filter-remote.service.coffee` (`ns = "{projectId}:{suffix}"`,
 * `hash = generateHash([projectId, ns])`).
 */
export function storageHash(projectId: number, suffix: string): string {
    const ns = `${projectId}:${suffix}`;
    return generateHash([projectId, ns]);
}

/**
 * Fetch the stored custom-filter map for a project. Mirrors
 * `FilterRemoteStorageService.getFilters`: resolves to the stored `value`, or
 * an empty object when the row does not exist yet (or any read error) so the
 * caller can treat "no saved filters" and "read failed" uniformly.
 */
export async function getFilters(
    projectId: number,
    suffix: string,
): Promise<StoredCustomFilters> {
    const hash = storageHash(projectId, suffix);
    try {
        const res = await httpGet<UserStorageRow<StoredCustomFilters>>(
            `user-storage/${hash}`,
        );
        const value = res.data?.value;
        return value && typeof value === "object" ? value : {};
    } catch {
        // Parity with the AngularJS service, which resolves `{}` on failure
        // (a 404 for a project that has never saved a filter is expected).
        return {};
    }
}

/**
 * Persist the stored custom-filter map for a project. Mirrors
 * `FilterRemoteStorageService.storeFilters`:
 *   - empty map  → DELETE the row,
 *   - otherwise  → PUT the row, falling back to POST (create) if the PUT fails
 *     because the row does not exist yet.
 */
export async function storeFilters(
    projectId: number,
    value: StoredCustomFilters,
    suffix: string,
): Promise<void> {
    const hash = storageHash(projectId, suffix);
    const body = { key: hash, value };

    if (isEmpty(value)) {
        await httpDelete(`user-storage/${hash}`, { body });
        return;
    }

    try {
        await httpPut(`user-storage/${hash}`, body);
    } catch {
        // The row does not exist yet — create it (mirrors the service's
        // PUT-then-POST fallback).
        await httpPost("user-storage", body);
    }
}

/** True when the object has no own enumerable keys (Lodash `_.isEmpty` parity for plain objects). */
function isEmpty(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).length === 0;
}
