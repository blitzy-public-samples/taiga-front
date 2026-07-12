/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the call-through REST facade (`createApiClient`).
 *
 * The facade reaches the backend exclusively through `fetch` (via `./http`), so
 * every case here mocks `global.fetch` and asserts the exact wire shape the
 * frozen `/api/v1/` contract expects: HTTP method, resolved URL, and JSON body.
 * No network, no AngularJS, no React rendering is involved.
 */

import type { MountContext } from "../types";
import { createApiClient } from "./client";

/** A fully-populated mount context; `apiUrl` intentionally has no trailing slash. */
const context: MountContext = {
    projectSlug: "proj-1",
    token: "test-token-value",
    sessionId: "test-session-id",
    apiUrl: "http://localhost:8000/api/v1",
    eventsUrl: null,
    language: "en",
};

const BASE = "http://localhost:8000/api/v1";

interface FakeResponseInit {
    status?: number;
    ok?: boolean;
    headers?: Record<string, string>;
}

/** Build a minimal `Response`-like object compatible with `http.ts` `request`. */
const makeResponse = (body: unknown, init: FakeResponseInit = {}): Response => {
    const status = init.status ?? 200;
    const ok = init.ok ?? (status >= 200 && status < 300);
    return {
        ok,
        status,
        headers: new Headers(init.headers ?? {}),
        text: async (): Promise<string> => (body === undefined ? "" : JSON.stringify(body)),
    } as unknown as Response;
};

const fetchMock = jest.fn();

interface DecodedCall {
    url: string;
    method: string;
    body: unknown;
}

/** Decode the most recent fetch invocation into url / method / parsed body. */
const lastCall = (): DecodedCall => {
    const { calls } = fetchMock.mock;
    const [url, requestInit] = calls[calls.length - 1] as [string, RequestInit];
    const rawBody = requestInit.body;
    return {
        url,
        method: requestInit.method ?? "GET",
        body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
    };
};

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("apiClient endpoints", () => {
    it("resolveProject resolves a slug to a numeric project id via /resolver", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ project: 42 }));
        const api = createApiClient(context);

        const id = await api.resolveProject("my-project");

        expect(id).toBe(42);
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/resolver?project=my-project`);
    });

    it("getUserStory GETs /userstories/{id}?project=", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 10, status: 1, swimlane: null }));
        const api = createApiClient(context);

        const us = await api.getUserStory(1, 10);

        expect(us.id).toBe(10);
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/userstories/10?project=1`);
    });

    it("getUserStory merges extra query params", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 10, status: 1, swimlane: null }));
        const api = createApiClient(context);

        await api.getUserStory(1, 10, { include_attachments: true });

        const { url } = lastCall();
        expect(url).toContain("project=1");
        expect(url).toContain("include_attachments=true");
    });

    it("getUserStoryByRef GETs /userstories/by_ref?project=&ref=", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 11, ref: 5, status: 1, swimlane: null }));
        const api = createApiClient(context);

        const us = await api.getUserStoryByRef(1, 5);

        expect(us.ref).toBe(5);
        const { url } = lastCall();
        expect(url).toContain(`${BASE}/userstories/by_ref?`);
        expect(url).toContain("project=1");
        expect(url).toContain("ref=5");
    });

    it("getUserStoriesFilters GETs /userstories/filters_data", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ statuses: [] }));
        const api = createApiClient(context);

        const data = await api.getUserStoriesFilters({ project: 1 });

        expect(data).toEqual({ statuses: [] });
        const { url } = lastCall();
        expect(url).toContain(`${BASE}/userstories/filters_data`);
        expect(url).toContain("project=1");
    });

    it("listUserStories GETs /userstories with filters", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([{ id: 1, status: 1, swimlane: null }]));
        const api = createApiClient(context);

        const list = await api.listUserStories({ project: 1, milestone: "null" });

        expect(list).toHaveLength(1);
        const { url } = lastCall();
        expect(url).toContain(`${BASE}/userstories?`);
        expect(url).toContain("project=1");
        expect(url).toContain("milestone=null");
    });

    it("getUserStoriesFilters defaults its params to an empty object", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ statuses: [] }));
        const api = createApiClient(context);

        const data = await api.getUserStoriesFilters();

        expect(data).toEqual({ statuses: [] });
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/userstories/filters_data`);
    });

    it("listUserStories defaults its filters to an empty object", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        const list = await api.listUserStories();

        expect(list).toEqual([]);
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/userstories`);
    });

    it("bulkCreateUserStories POSTs the frozen bulk_create payload", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([{ id: 20, status: 1, swimlane: null }]));
        const api = createApiClient(context);

        await api.bulkCreateUserStories(1, 3, "Story A\nStory B", 7);

        const { url, method, body } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/bulk_create`);
        expect(body).toEqual({
            project_id: 1,
            status_id: 3,
            bulk_stories: "Story A\nStory B",
            swimlane_id: 7,
        });
    });

    it("bulkUpdateKanbanOrder sets after_userstory_id (priority) and swimlane_id", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateKanbanOrder(1, 2, 5, 100, 200, [10, 11]);

        const { url, method, body } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/bulk_update_kanban_order`);
        expect(body).toEqual({
            project_id: 1,
            status_id: 2,
            bulk_userstories: [10, 11],
            after_userstory_id: 100,
            swimlane_id: 5,
        });
    });

    it("bulkUpdateKanbanOrder falls back to before_userstory_id when after is null", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateKanbanOrder(1, 2, null, null, 200, [10]);

        const { body } = lastCall();
        expect(body).toEqual({
            project_id: 1,
            status_id: 2,
            bulk_userstories: [10],
            before_userstory_id: 200,
        });
    });

    it("bulkUpdateKanbanOrder omits position + swimlane when all are null", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateKanbanOrder(1, 2, null, null, null, [10]);

        const { body } = lastCall();
        expect(body).toEqual({ project_id: 1, status_id: 2, bulk_userstories: [10] });
        expect(body).not.toHaveProperty("after_userstory_id");
        expect(body).not.toHaveProperty("before_userstory_id");
        expect(body).not.toHaveProperty("swimlane_id");
    });

    it("bulkUpdateBacklogOrder sets milestone_id and after_userstory_id", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateBacklogOrder(1, 9, 100, 200, [10, 11]);

        const { url, method, body } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/bulk_update_backlog_order`);
        expect(body).toEqual({
            project_id: 1,
            bulk_userstories: [10, 11],
            milestone_id: 9,
            after_userstory_id: 100,
        });
    });

    it("bulkUpdateBacklogOrder omits milestone_id and uses before when after is null", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateBacklogOrder(1, null, null, 200, [10]);

        const { body } = lastCall();
        expect(body).toEqual({ project_id: 1, bulk_userstories: [10], before_userstory_id: 200 });
        expect(body).not.toHaveProperty("milestone_id");
    });

    it("bulkUpdateMilestone POSTs {project_id, milestone_id, bulk_stories}", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.bulkUpdateMilestone(1, 9, [
            { us_id: 10, order: 0 },
            { us_id: 11, order: 1 },
        ]);

        const { url, body } = lastCall();
        expect(url).toBe(`${BASE}/userstories/bulk_update_milestone`);
        expect(body).toEqual({
            project_id: 1,
            milestone_id: 9,
            bulk_stories: [
                { us_id: 10, order: 0 },
                { us_id: 11, order: 1 },
            ],
        });
    });

    it("moveUserStoriesToMilestone POSTs /milestones/{id}/move_userstories_to_sprint", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null));
        const api = createApiClient(context);

        await api.moveUserStoriesToMilestone(7, 1, 9, [{ us_id: 10, order: 0 }]);

        const { url, method, body } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/milestones/7/move_userstories_to_sprint`);
        expect(body).toEqual({ project_id: 1, milestone_id: 9, bulk_stories: [{ us_id: 10, order: 0 }] });
    });

    it("editStatus PATCHes /userstory-statuses/{id} with {wip_limit}", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 3, name: "In progress", wip_limit: 5 }));
        const api = createApiClient(context);

        const status = await api.editStatus(3, 5);

        expect(status.wip_limit).toBe(5);
        const { url, method, body } = lastCall();
        expect(method).toBe("PATCH");
        expect(url).toBe(`${BASE}/userstory-statuses/3`);
        expect(body).toEqual({ wip_limit: 5 });
    });

    it("editStatus accepts a null wip_limit", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 3, name: "In progress", wip_limit: null }));
        const api = createApiClient(context);

        await api.editStatus(3, null);

        const { body } = lastCall();
        expect(body).toEqual({ wip_limit: null });
    });

    it("getMilestone GETs /milestones/{id}", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 9, name: "Sprint 1" }));
        const api = createApiClient(context);

        const milestone = await api.getMilestone(9);

        expect(milestone.name).toBe("Sprint 1");
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/milestones/9`);
    });

    it("getMilestoneStats GETs /milestones/{id}/stats", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ completed_points: 10 }));
        const api = createApiClient(context);

        const stats = await api.getMilestoneStats(9);

        expect(stats).toEqual({ completed_points: 10 });
        const { url } = lastCall();
        expect(url).toBe(`${BASE}/milestones/9/stats`);
    });

    it("listMilestones parses the Taiga-Info totals into {milestones, closed, open}", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse([{ id: 9, name: "S1" }], {
                headers: {
                    "Taiga-Info-Total-Closed-Milestones": "2",
                    "Taiga-Info-Total-Opened-Milestones": "5",
                },
            }),
        );
        const api = createApiClient(context);

        const result = await api.listMilestones(1);

        expect(result.milestones).toHaveLength(1);
        expect(result.closed).toBe(2);
        expect(result.open).toBe(5);
        const { url } = lastCall();
        expect(url).toContain(`${BASE}/milestones?`);
        expect(url).toContain("project=1");
    });

    it("listMilestones defaults the totals to 0 when the headers are absent", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        const result = await api.listMilestones(1, { closed: true });

        expect(result.closed).toBe(0);
        expect(result.open).toBe(0);
        const { url } = lastCall();
        expect(url).toContain("closed=true");
    });

    it("propagates the ApiError status on a non-2xx response", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ detail: "not found" }, { status: 404 }));
        const api = createApiClient(context);

        await expect(api.getMilestone(999)).rejects.toMatchObject({ status: 404 });
    });
});

describe("apiClient.save", () => {
    it("skips the request and returns the entity unchanged when patch and nothing is modified", async () => {
        const api = createApiClient(context);
        const entity = { id: 5, version: 3, subject: "unchanged", status: 1 };

        const result = await api.save("userstories", entity, {});

        expect(result).toBe(entity);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("PATCHes only the changed attrs and always includes the version", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ subject: "new", version: 4 }));
        const api = createApiClient(context);
        const entity = { id: 5, version: 3, subject: "old", status: 1 };

        const result = await api.save("userstories", entity, { subject: "new" });

        const { url, method, body } = lastCall();
        expect(method).toBe("PATCH");
        expect(url).toBe(`${BASE}/userstories/5`);
        expect(body).toEqual({ subject: "new", version: 3 });
        expect(result).toEqual({ id: 5, version: 4, subject: "new", status: 1 });
    });

    it("omits the version in the PATCH payload when the entity has none", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ subject: "new" }));
        const api = createApiClient(context);
        const entity = { id: 6, subject: "old" };

        await api.save("userstories", entity, { subject: "new" });

        const { body } = lastCall();
        expect(body).toEqual({ subject: "new" });
        expect(body).not.toHaveProperty("version");
    });

    it("PUTs the full entity MERGED WITH the modified attrs when patch is false", async () => {
        // Mirrors the frozen `model.getAttrs(patch=false)` =
        // `_.extend({}, @._attrs, @._modifiedAttrs)`: the modified attr must be
        // merged OVER the original entity, not silently dropped. The entity's
        // `subject` ("old") differs from the modified value ("PUT-CHANGED") so a
        // bare `{ ...entity }` copy (the previous bug) would fail this assertion.
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 5, version: 4, subject: "PUT-CHANGED", status: 2 }));
        const api = createApiClient(context);
        const entity = { id: 5, version: 3, subject: "old", status: 2 };

        const result = await api.save("userstories", entity, { subject: "PUT-CHANGED" }, false);

        const { method, body } = lastCall();
        expect(method).toBe("PUT");
        expect(body).toEqual({ id: 5, version: 3, subject: "PUT-CHANGED", status: 2 });
        expect(result.version).toBe(4);
        expect(result.subject).toBe("PUT-CHANGED");
    });

    it("does not skip when patch is false even if nothing is modified", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 5 }));
        const api = createApiClient(context);
        const entity = { id: 5, version: 3 };

        await api.save("userstories", entity, {}, false);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(lastCall().method).toBe("PUT");
    });
});

describe("apiClient remaining actions", () => {
    it("upvoteUserStory POSTs /userstories/{id}/upvote", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null));
        const api = createApiClient(context);

        await api.upvoteUserStory(5);

        const { url, method } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/5/upvote`);
    });

    it("downvoteUserStory POSTs /userstories/{id}/downvote", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null));
        const api = createApiClient(context);

        await api.downvoteUserStory(5);

        const { url, method } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/5/downvote`);
    });

    it("watchUserStory POSTs /userstories/{id}/watch", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null));
        const api = createApiClient(context);

        await api.watchUserStory(5);

        const { url, method } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/5/watch`);
    });

    it("unwatchUserStory POSTs /userstories/{id}/unwatch", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null));
        const api = createApiClient(context);

        await api.unwatchUserStory(5);

        const { url, method } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/userstories/5/unwatch`);
    });

    it("create POSTs to /{name} and returns the created resource", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ id: 30, name: "Sprint 2" }));
        const api = createApiClient(context);

        const created = await api.create<{ id: number; name: string }>("milestones", {
            name: "Sprint 2",
            project: 1,
        });

        expect(created).toEqual({ id: 30, name: "Sprint 2" });
        const { url, method, body } = lastCall();
        expect(method).toBe("POST");
        expect(url).toBe(`${BASE}/milestones`);
        expect(body).toEqual({ name: "Sprint 2", project: 1 });
    });

    it("remove DELETEs /{name}/{id}", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 204 }));
        const api = createApiClient(context);

        await api.remove("milestones", 30);

        const { url, method } = lastCall();
        expect(method).toBe("DELETE");
        expect(url).toBe(`${BASE}/milestones/30`);
    });
});

describe("apiClient project + swimlane + unassigned loaders", () => {
    /** Read the plain headers object passed to the most recent fetch call. */
    const lastHeaders = (): Record<string, string> => {
        const { calls } = fetchMock.mock;
        const [, requestInit] = calls[calls.length - 1] as [string, RequestInit];
        return (requestInit.headers ?? {}) as Record<string, string>;
    };

    it("getProjectBySlug GETs /projects/by_slug?slug= and returns the project detail", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse({
                id: 7,
                slug: "my-project",
                my_permissions: ["view_us", "modify_us"],
                is_kanban_activated: true,
                is_backlog_activated: true,
                us_statuses: [{ id: 1, name: "New" }],
                members: [{ id: 3, full_name: "Ada" }],
            }),
        );
        const api = createApiClient(context);

        const project = await api.getProjectBySlug("my-project");

        expect(project.id).toBe(7);
        expect(project.is_kanban_activated).toBe(true);
        expect(project.us_statuses).toHaveLength(1);
        expect(project.members?.[0].full_name).toBe("Ada");
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/projects/by_slug?slug=my-project`);
        // Parity with legacy queryOne: pagination is disabled on the metadata read.
        expect(lastHeaders()["x-disable-pagination"]).toBe("1");
        // Frozen-contract header parity on reads (base/http.coffee headers() +
        // $httpProvider common defaults merge onto every verb, GET included):
        // the backend content-negotiates on Accept-Language (Vary: Accept-Language).
        expect(lastHeaders()["Accept-Language"]).toBe("en");
        expect(lastHeaders().Accept).toBe("application/json, text/plain, */*");
        // GET carries no body, so no Content-Type is sent (matches the frozen client).
        expect(lastHeaders()["Content-Type"]).toBeUndefined();
    });

    it("getProjectStats GETs /projects/{id}/stats and returns the raw totals", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse({
                total_milestones: 3,
                total_points: 40,
                closed_points: 12,
                defined_points: 25,
                assigned_points: 30,
            }),
        );
        const api = createApiClient(context);

        const stats = await api.getProjectStats(7);

        expect(stats.total_points).toBe(40);
        expect(stats.closed_points).toBe(12);
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/projects/7/stats`);
    });

    it("getProjectTagsColors GETs /projects/{id}/tags_colors and returns the tag->color map", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse({ frontend: "#729fcf", urgent: null }));
        const api = createApiClient(context);

        const colors = await api.getProjectTagsColors(7);

        expect(colors).toEqual({ frontend: "#729fcf", urgent: null });
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/projects/7/tags_colors`);
    });

    it("listSwimlanes GETs /swimlanes?project= and returns the swimlane list", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse([
                { id: 1, name: "Default" },
                { id: 2, name: "Bugs" },
            ]),
        );
        const api = createApiClient(context);

        const swimlanes = await api.listSwimlanes(7);

        expect(swimlanes).toHaveLength(2);
        expect(swimlanes[1].name).toBe("Bugs");
        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toBe(`${BASE}/swimlanes?project=7`);
        // Parity with legacy queryMany (no enablePagination): pagination disabled.
        expect(lastHeaders()["x-disable-pagination"]).toBe("1");
    });

    it("listUnassignedUserStories GETs /userstories?project=&milestone=null&page_size= with pagination enabled", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse([{ id: 10, status: 1, swimlane: null }], {
                headers: {
                    "x-pagination-count": "42",
                    "x-pagination-current": "2",
                    "x-paginated-by": "30",
                },
            }),
        );
        const api = createApiClient(context);

        const result = await api.listUnassignedUserStories(7, {}, 30);

        expect(result.userStories).toHaveLength(1);
        expect(result.count).toBe(42);
        expect(result.current).toBe(2);
        expect(result.paginatedBy).toBe(30);

        const { url, method } = lastCall();
        expect(method).toBe("GET");
        expect(url).toContain(`${BASE}/userstories?`);
        expect(url).toContain("project=7");
        expect(url).toContain("milestone=null");
        expect(url).toContain("page_size=30");
        // enablePagination => the x-disable-pagination header MUST NOT be sent.
        expect(lastHeaders()["x-disable-pagination"]).toBeUndefined();
    });

    it("listUnassignedUserStories defaults current to 1 and count/paginatedBy to 0 when headers are absent", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        const result = await api.listUnassignedUserStories(7);

        expect(result.userStories).toEqual([]);
        expect(result.count).toBe(0);
        expect(result.current).toBe(1);
        expect(result.paginatedBy).toBe(0);
        // page_size is omitted from the query when not provided.
        expect(lastCall().url).not.toContain("page_size");
    });

    it("listUnassignedUserStories appends caller filters alongside project/milestone", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse([]));
        const api = createApiClient(context);

        await api.listUnassignedUserStories(7, { status: 3, tags: "urgent" }, 50);

        const { url } = lastCall();
        expect(url).toContain("project=7");
        expect(url).toContain("milestone=null");
        expect(url).toContain("status=3");
        expect(url).toContain("tags=urgent");
        expect(url).toContain("page_size=50");
    });
});

