/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createApiClient } from "./client";
import { resolveUrl, buildUrl, URL_TEMPLATES } from "./urls";
import { buildHeaders, ApiError } from "./http";
import { generateHash } from "../storage/legacyStorage";
import type { MountContext } from "../types";

interface MockResponseInit {
    status?: number;
    headers?: Record<string, string>;
}

const makeHeaders = (map: Record<string, string>): Headers => {
    const lower: Record<string, string> = {};
    Object.keys(map).forEach((key) => {
        lower[key.toLowerCase()] = map[key];
    });
    return {
        get: (name: string): string | null => {
            const value = lower[name.toLowerCase()];
            return value === undefined ? null : value;
        },
    } as unknown as Headers;
};

const mockResponse = (body: unknown, init: MockResponseInit = {}) => {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: makeHeaders(init.headers ?? {}),
        text: (): Promise<string> => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
    };
};

const baseContext: MountContext = {
    projectSlug: "my-project",
    token: "jwt-token",
    sessionId: "session-xyz",
    apiUrl: "http://localhost:8000/api/v1/",
    eventsUrl: null,
    language: "en",
};

let fetchMock: jest.Mock;

const setFetch = (): jest.Mock => {
    const mock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = mock;
    return mock;
};

const lastCall = (): [string, RequestInit] => {
    const calls = fetchMock.mock.calls;
    return calls[calls.length - 1] as [string, RequestInit];
};

const lastBody = (): Record<string, unknown> => {
    const [, init] = lastCall();
    return JSON.parse(init.body as string) as Record<string, unknown>;
};

const lastHeaders = (): Record<string, string> => {
    const [, init] = lastCall();
    return init.headers as Record<string, string>;
};

beforeEach(() => {
    fetchMock = setFetch();
    window.localStorage.clear();
    // Finding C4: localStorage is the AUTHORITATIVE credential store, and in
    // production the mount snapshot (`baseContext.token`) is read FROM it at
    // mount time. Seed the store to mirror that snapshot so the bearer contract
    // is exercised realistically; the two dedicated cases below override this
    // key to assert the authoritative-logout (absent / garbage) behaviour.
    window.localStorage.setItem("token", JSON.stringify("jwt-token"));
});

describe("urls.resolveUrl", () => {
    it("trims apiUrl trailing slash + template leading slash", () => {
        expect(resolveUrl(baseContext.apiUrl, "bulk-update-us-kanban-order")).toBe(
            "http://localhost:8000/api/v1/userstories/bulk_update_kanban_order",
        );
    });

    it("works when apiUrl has no trailing slash", () => {
        expect(resolveUrl("http://localhost:8000/api/v1", "milestones")).toBe(
            "http://localhost:8000/api/v1/milestones",
        );
    });

    it("substitutes %s positional ids", () => {
        expect(resolveUrl(baseContext.apiUrl, "userstory-upvote", 42)).toBe(
            "http://localhost:8000/api/v1/userstories/42/upvote",
        );
        expect(resolveUrl(baseContext.apiUrl, "move-userstories-to-milestone", 7)).toBe(
            "http://localhost:8000/api/v1/milestones/7/move_userstories_to_sprint",
        );
    });

    it("exposes only the frozen keys", () => {
        expect(Object.keys(URL_TEMPLATES).sort()).toEqual(
            [
                "bulk-create-us",
                "bulk-update-us-backlog-order",
                "bulk-update-us-kanban-order",
                "bulk-update-us-milestone",
                "milestones",
                "move-userstories-to-milestone",
                "projects",
                // Frozen `/auth/refresh` endpoint (C3 single-flight token
                // recovery) — mirrors resources.coffee, contract-preserving.
                "refresh",
                "resolver",
                "swimlanes",
                "user-storage",
                "userstories",
                "userstories-filters",
                "userstory-downvote",
                "userstory-statuses",
                "userstory-unwatch",
                "userstory-upvote",
                "userstory-watch",
            ].sort(),
        );
    });
});

describe("urls.buildUrl", () => {
    it("appends params and skips null/undefined", () => {
        expect(buildUrl("http://x/api", { project: 5, ref: undefined, m: null, q: "a b" })).toBe(
            "http://x/api?project=5&q=a%20b",
        );
    });

    it("uses & when a query already exists", () => {
        expect(buildUrl("http://x/api?a=1", { b: 2 })).toBe("http://x/api?a=1&b=2");
    });
});

describe("http.buildHeaders", () => {
    it("GET: bearer + X-Session-Id, no Content-Type", () => {
        const h = buildHeaders(baseContext, "GET");
        expect(h.Authorization).toBe("Bearer jwt-token");
        expect(h["X-Session-Id"]).toBe("session-xyz");
        expect(h["Content-Type"]).toBeUndefined();
        // Accept-Language mirrors the frozen AngularJS client and is sent on
        // EVERY request (GET included) whenever the mount context carries a
        // language; only Content-Type is restricted to mutations.
        expect(h["Accept-Language"]).toBe("en");
    });

    it("POST: adds Content-Type + Accept-Language", () => {
        const h = buildHeaders(baseContext, "POST");
        expect(h["Content-Type"]).toBe("application/json");
        expect(h["Accept-Language"]).toBe("en");
    });

    it("reads JSON-encoded token from localStorage when context token absent", () => {
        window.localStorage.setItem("token", JSON.stringify("stored-token"));
        const ctx: MountContext = { ...baseContext, token: null };
        expect(buildHeaders(ctx, "GET").Authorization).toBe("Bearer stored-token");
    });

    it("treats garbage localStorage token as no token", () => {
        window.localStorage.setItem("token", "{not-json");
        const ctx: MountContext = { ...baseContext, token: null };
        expect(buildHeaders(ctx, "GET").Authorization).toBeUndefined();
    });

    it("falls back to window.taiga.sessionId", () => {
        (window as unknown as { taiga?: { sessionId?: string } }).taiga = { sessionId: "win-sess" };
        const ctx: MountContext = { ...baseContext, sessionId: null };
        expect(buildHeaders(ctx, "GET")["X-Session-Id"]).toBe("win-sess");
        delete (window as unknown as { taiga?: unknown }).taiga;
    });
});

describe("apiClient endpoints", () => {
    it("resolveProject -> GET /resolver?project=slug and returns .project", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ project: 123 }));
        const client = createApiClient(baseContext);
        const id = await client.resolveProject("my-project");
        expect(id).toBe(123);
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/resolver?project=my-project");
        expect(init.method).toBe("GET");
        expect(lastHeaders()["x-disable-pagination"]).toBe("1");
        expect(lastHeaders().Authorization).toBe("Bearer jwt-token");
        expect(lastHeaders()["X-Session-Id"]).toBe("session-xyz");
    });

    it("bulkUpdateKanbanOrder POSTs the frozen payload (after + swimlane)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.bulkUpdateKanbanOrder(3, 10, 5, 99, null, [1, 2, 3]);
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/userstories/bulk_update_kanban_order");
        expect(init.method).toBe("POST");
        expect(lastBody()).toEqual({
            project_id: 3,
            status_id: 10,
            bulk_userstories: [1, 2, 3],
            after_userstory_id: 99,
            swimlane_id: 5,
        });
        expect(lastHeaders()["Content-Type"]).toBe("application/json");
    });

    it("bulkUpdateKanbanOrder uses before_userstory_id when no after", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.bulkUpdateKanbanOrder(3, 10, null, null, 77, [4]);
        expect(lastBody()).toEqual({
            project_id: 3,
            status_id: 10,
            bulk_userstories: [4],
            before_userstory_id: 77,
        });
    });

    it("bulkUpdateBacklogOrder POSTs frozen payload", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.bulkUpdateBacklogOrder(3, 8, 55, null, [1, 2]);
        const [url] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/userstories/bulk_update_backlog_order");
        expect(lastBody()).toEqual({
            project_id: 3,
            bulk_userstories: [1, 2],
            milestone_id: 8,
            after_userstory_id: 55,
        });
    });

    it("bulkUpdateMilestone POSTs {project_id, milestone_id, bulk_stories}", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.bulkUpdateMilestone(3, 8, [{ us_id: 1, order: 0 }]);
        const [url] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/userstories/bulk_update_milestone");
        expect(lastBody()).toEqual({
            project_id: 3,
            milestone_id: 8,
            bulk_stories: [{ us_id: 1, order: 0 }],
        });
    });

    it("editStatus PATCHes /userstory-statuses/{id} with {wip_limit}", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 7, wip_limit: 5 }));
        const client = createApiClient(baseContext);
        await client.editStatus(7, 5);
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/userstory-statuses/7");
        expect(init.method).toBe("PATCH");
        expect(lastBody()).toEqual({ wip_limit: 5 });
    });

    it("listMilestones parses the Taiga-Info total headers", async () => {
        fetchMock.mockResolvedValueOnce(
            mockResponse([{ id: 1, name: "S1" }], {
                headers: {
                    "Taiga-Info-Total-Closed-Milestones": "4",
                    "Taiga-Info-Total-Opened-Milestones": "2",
                },
            }),
        );
        const client = createApiClient(baseContext);
        const result = await client.listMilestones(3);
        expect(result.closed).toBe(4);
        expect(result.open).toBe(2);
        expect(result.milestones).toHaveLength(1);
        const [url] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/milestones?project=3");
    });

    it("listMilestones defaults missing total headers to 0", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        const result = await client.listMilestones(3);
        expect(result.closed).toBe(0);
        expect(result.open).toBe(0);
    });
});

describe("apiClient.save (dirty-field PATCH + optimistic concurrency)", () => {
    it("skips the request entirely when nothing modified", async () => {
        const client = createApiClient(baseContext);
        const entity = { id: 9, subject: "x", version: 2 };
        const result = await client.save("userstories", entity, {});
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toBe(entity);
    });

    it("PATCH sends only changed attrs and ALWAYS includes version; merges response", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ subject: "new", version: 3 }));
        const client = createApiClient(baseContext);
        const entity = { id: 9, subject: "old", status: 1, version: 2 };
        const result = await client.save("userstories", entity, { subject: "new" });
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/userstories/9");
        expect(init.method).toBe("PATCH");
        expect(lastBody()).toEqual({ subject: "new", version: 2 });
        expect(result.version).toBe(3);
        expect(result.subject).toBe("new");
        expect(result.status).toBe(1);
    });

    it("PUT sends all attrs when patch=false", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 9, subject: "old", version: 2 }));
        const client = createApiClient(baseContext);
        const entity = { id: 9, subject: "old", version: 2 };
        await client.save("userstories", entity, {}, false);
        const [, init] = lastCall();
        expect(init.method).toBe("PUT");
        expect(lastBody()).toEqual({ id: 9, subject: "old", version: 2 });
    });
});

describe("http error handling", () => {
    it("throws ApiError on non-2xx", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "bad" }, { status: 400 }));
        const client = createApiClient(baseContext);
        await expect(client.resolveProject("nope")).rejects.toBeInstanceOf(ApiError);
    });
});

describe("apiClient remaining userstory + milestone endpoints", () => {
    it("getUserStory GETs /userstories/{id}?project=", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 5 }));
        const client = createApiClient(baseContext);
        await client.getUserStory(3, 5);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/5?project=3");
    });

    it("getUserStoryByRef GETs /userstories/by_ref?project=&ref=", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 5 }));
        const client = createApiClient(baseContext);
        await client.getUserStoryByRef(3, 12);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/by_ref?project=3&ref=12");
    });

    it("getUserStoriesFilters GETs /userstories/filters_data", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({}));
        const client = createApiClient(baseContext);
        await client.getUserStoriesFilters({ project: 3 });
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/filters_data?project=3");
    });

    it("listUserStories GETs /userstories", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.listUserStories({ project: 3 });
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories?project=3");
    });

    it("bulkCreateUserStories POSTs the frozen payload", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([]));
        const client = createApiClient(baseContext);
        await client.bulkCreateUserStories(3, 10, "a\nb", 5);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/bulk_create");
        expect(lastBody()).toEqual({
            project_id: 3,
            status_id: 10,
            bulk_stories: "a\nb",
            swimlane_id: 5,
        });
    });

    it("moveUserStoriesToMilestone POSTs /milestones/{id}/move_userstories_to_sprint", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({}));
        const client = createApiClient(baseContext);
        await client.moveUserStoriesToMilestone(4, 3, 8, [{ us_id: 1, order: 0 }]);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/milestones/4/move_userstories_to_sprint");
        expect(lastBody()).toEqual({
            project_id: 3,
            milestone_id: 8,
            bulk_stories: [{ us_id: 1, order: 0 }],
        });
    });

    it("upvote/downvote/watch/unwatch POST to the %s action urls", async () => {
        const client = createApiClient(baseContext);
        fetchMock.mockResolvedValue(mockResponse(undefined));
        await client.upvoteUserStory(1);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/1/upvote");
        await client.downvoteUserStory(1);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/1/downvote");
        await client.watchUserStory(1);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/1/watch");
        await client.unwatchUserStory(1);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/userstories/1/unwatch");
    });

    it("getMilestone + getMilestoneStats GET the right urls", async () => {
        const client = createApiClient(baseContext);
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 8, name: "S" }));
        await client.getMilestone(8);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/milestones/8");
        fetchMock.mockResolvedValueOnce(mockResponse({}));
        await client.getMilestoneStats(8);
        expect(lastCall()[0]).toBe("http://localhost:8000/api/v1/milestones/8/stats");
    });

    it("create POSTs to /{name}", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 8 }));
        const client = createApiClient(baseContext);
        await client.create("milestones", { name: "Sprint 1" });
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/milestones");
        expect(init.method).toBe("POST");
        expect(lastBody()).toEqual({ name: "Sprint 1" });
    });

    it("remove DELETEs /{name}/{id}", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(undefined, { status: 204 }));
        const client = createApiClient(baseContext);
        await client.remove("milestones", 8);
        const [url, init] = lastCall();
        expect(url).toBe("http://localhost:8000/api/v1/milestones/8");
        expect(init.method).toBe("DELETE");
    });
});

describe("apiClient user-storage (custom filters, C4)", () => {
    const SUFFIX = "backlog-custom-filters";
    const HASH = generateHash([7, `7:${SUFFIX}`]);
    const BASE = "http://localhost:8000/api/v1/user-storage";
    const KEYED = `${BASE}/${encodeURIComponent(HASH)}`;

    it("getUserFilters GETs /user-storage/{hash} and returns the stored value map", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ key: HASH, value: { A: { status: "1" } } }));
        const client = createApiClient(baseContext);
        const out = await client.getUserFilters(7, SUFFIX);
        expect(lastCall()[0]).toBe(KEYED);
        expect(lastCall()[1].method).toBe("GET");
        expect(out).toEqual({ A: { status: "1" } });
    });

    it("getUserFilters resolves to {} when the entry is absent (404)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(undefined, { status: 404 }));
        const client = createApiClient(baseContext);
        await expect(client.getUserFilters(7, SUFFIX)).resolves.toEqual({});
    });

    it("getUserFilters resolves to {} when the stored value is not an object", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ key: HASH, value: null }));
        const client = createApiClient(baseContext);
        await expect(client.getUserFilters(7, SUFFIX)).resolves.toEqual({});
    });

    it("storeUserFilters PUTs {key,value} to the keyed url for a non-empty map", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({}));
        const client = createApiClient(baseContext);
        await client.storeUserFilters(7, { A: { status: "1" } }, SUFFIX);
        const [url, init] = lastCall();
        expect(url).toBe(KEYED);
        expect(init.method).toBe("PUT");
        expect(lastBody()).toEqual({ key: HASH, value: { A: { status: "1" } } });
    });

    it("storeUserFilters DELETEs the entry for an empty map", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(undefined, { status: 204 }));
        const client = createApiClient(baseContext);
        await client.storeUserFilters(7, {}, SUFFIX);
        const [url, init] = lastCall();
        expect(url).toBe(KEYED);
        expect(init.method).toBe("DELETE");
    });

    it("storeUserFilters falls back to POST /user-storage when the PUT 404s (entry not yet created)", async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse(undefined, { status: 404 })) // PUT fails
            .mockResolvedValueOnce(mockResponse({ key: HASH }, { status: 201 })); // POST create
        const client = createApiClient(baseContext);
        await client.storeUserFilters(7, { A: { status: "1" } }, SUFFIX);
        const [url, init] = lastCall();
        expect(url).toBe(BASE);
        expect(init.method).toBe("POST");
        expect(lastBody()).toEqual({ key: HASH, value: { A: { status: "1" } } });
    });

    it("storeUserFilters treats a DELETE of an absent entry as success (no throw)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(undefined, { status: 404 }));
        const client = createApiClient(baseContext);
        await expect(client.storeUserFilters(7, {}, SUFFIX)).resolves.toBeUndefined();
    });
});

describe("barrel index", () => {
    it("re-exports the public surface", async () => {
        const api = await import("./index");
        expect(typeof api.createApiClient).toBe("function");
        expect(typeof api.ApiError).toBe("function");
        expect(typeof api.resolveUrl).toBe("function");
        expect(typeof api.buildUrl).toBe("function");
        expect(api.URL_TEMPLATES.userstories).toBe("/userstories");
    });
});
