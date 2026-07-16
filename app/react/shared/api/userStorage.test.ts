/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Tests for the custom-filter user-storage adapter (shared/api/userStorage.ts),
 * QA finding [J]. These exercise the REAL httpClient with a mocked `fetch`, so
 * the asserted URL, method, and JSON body are exactly what hits the frozen
 * `/api/v1/user-storage` endpoints — the same rows the AngularJS
 * `tgFilterRemoteStorageService` reads/writes.
 *
 * Contract under test (filter-remote.service.coffee parity):
 *   - storageHash(id, suffix) = generateHash([id, "{id}:{suffix}"])
 *   - getFilters → GET  /user-storage/{hash}      → row.value  (or {} on error)
 *   - storeFilters(empty)   → DELETE /user-storage/{hash}
 *   - storeFilters(non-empty) → PUT /user-storage/{hash}; POST /user-storage on PUT failure
 */

import { getFilters, storeFilters, storageHash } from "./userStorage";
import type { StoredCustomFilters } from "./userStorage";

const SUFFIX = "backlog-custom-filters";
const PROJECT_ID = 5;
// generateHash([5, "5:backlog-custom-filters"]) — cross-checked with Node crypto.
const HASH_5 = "e9fd4a8bf695f7f08519e3cb5e72cd9f1b122493";

const makeResponse = (json: unknown, status = 200): Response => {
    const stub = {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { get: (): string | null => null },
        text(): Promise<string> {
            return Promise.resolve(json === undefined ? "" : JSON.stringify(json));
        },
    };
    return stub as unknown as Response;
};

const fetchMock = jest.fn();

interface SentRequest {
    url: string;
    method: string;
    body: Record<string, unknown> | undefined;
}

const requestAt = (index: number): SentRequest => {
    const call = fetchMock.mock.calls[index] as [string, RequestInit];
    const init = call[1];
    const rawBody = init.body as string | undefined;
    return {
        url: call[0],
        method: init.method as string,
        body: rawBody === undefined ? undefined : (JSON.parse(rawBody) as Record<string, unknown>),
    };
};

const lastRequest = (): SentRequest => requestAt(fetchMock.mock.calls.length - 1);

const originalFetch = window.fetch;

beforeEach(() => {
    fetchMock.mockReset();
    window.fetch = fetchMock as unknown as typeof window.fetch;
    window.localStorage.clear();
    window.localStorage.setItem("token", JSON.stringify("jwt-abc"));
    window.taiga = { sessionId: "sess-1" };
    window.taigaConfig = { api: "http://localhost:8000/api/v1/", defaultLanguage: "en" };
});

afterEach(() => {
    window.fetch = originalFetch;
    window.localStorage.clear();
});

describe("storageHash", () => {
    test("matches generateHash([id, '{id}:{suffix}']) — the AngularJS key", () => {
        expect(storageHash(PROJECT_ID, SUFFIX)).toBe(HASH_5);
    });

    test("is namespaced per project (different id → different hash)", () => {
        expect(storageHash(3, SUFFIX)).toBe(
            "b3647b4eb080ece98f210e0f11f85b08fac77df9",
        );
        expect(storageHash(3, SUFFIX)).not.toBe(storageHash(5, SUFFIX));
    });
});

describe("getFilters", () => {
    test("GETs /user-storage/{hash} and returns the stored value map", async () => {
        const value: StoredCustomFilters = { "My filter": { status: "1,2" } };
        fetchMock.mockResolvedValue(makeResponse({ key: HASH_5, value }));

        const result = await getFilters(PROJECT_ID, SUFFIX);

        expect(result).toEqual(value);
        const req = lastRequest();
        expect(req.method).toBe("GET");
        expect(req.url).toBe(
            `http://localhost:8000/api/v1/user-storage/${HASH_5}`,
        );
    });

    test("resolves {} for a project that has never saved a filter (404)", async () => {
        fetchMock.mockResolvedValue(makeResponse({ detail: "Not found" }, 404));
        await expect(getFilters(PROJECT_ID, SUFFIX)).resolves.toEqual({});
    });

    test("resolves {} on a network/read error (parity with the AngularJS service)", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        await expect(getFilters(PROJECT_ID, SUFFIX)).resolves.toEqual({});
    });

    test("resolves {} when the row exists but carries a null/non-object value", async () => {
        fetchMock.mockResolvedValue(makeResponse({ key: HASH_5, value: null }));
        await expect(getFilters(PROJECT_ID, SUFFIX)).resolves.toEqual({});
    });
});

describe("storeFilters", () => {
    test("DELETEs the row when the map is empty", async () => {
        fetchMock.mockResolvedValue(makeResponse(undefined, 204));

        await storeFilters(PROJECT_ID, {}, SUFFIX);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const req = lastRequest();
        expect(req.method).toBe("DELETE");
        expect(req.url).toBe(
            `http://localhost:8000/api/v1/user-storage/${HASH_5}`,
        );
    });

    test("PUTs {key,value} to the row hash when the map is non-empty", async () => {
        fetchMock.mockResolvedValue(makeResponse({ key: HASH_5 }, 200));
        const value: StoredCustomFilters = { Urgent: { status: "7", exclude_tags: "9" } };

        await storeFilters(PROJECT_ID, value, SUFFIX);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const req = lastRequest();
        expect(req.method).toBe("PUT");
        expect(req.url).toBe(
            `http://localhost:8000/api/v1/user-storage/${HASH_5}`,
        );
        expect(req.body).toEqual({ key: HASH_5, value });
    });

    test("falls back to POST /user-storage when the PUT fails (row not yet created)", async () => {
        // First call (PUT) 404s; second call (POST) succeeds.
        fetchMock
            .mockResolvedValueOnce(makeResponse({ detail: "Not found" }, 404))
            .mockResolvedValueOnce(makeResponse({ key: HASH_5 }, 201));
        const value: StoredCustomFilters = { Urgent: { status: "7" } };

        await storeFilters(PROJECT_ID, value, SUFFIX);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const put = requestAt(0);
        expect(put.method).toBe("PUT");
        expect(put.url).toBe(
            `http://localhost:8000/api/v1/user-storage/${HASH_5}`,
        );
        const post = requestAt(1);
        expect(post.method).toBe("POST");
        expect(post.url).toBe("http://localhost:8000/api/v1/user-storage");
        expect(post.body).toEqual({ key: HASH_5, value });
    });
});
