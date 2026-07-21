/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    bulkCreate,
    bulkUpdateBacklogOrder,
    bulkUpdateKanbanOrder,
    bulkUpdateMilestone,
    createUserstory,
    filtersData,
    getUserstory,
    listUserstories,
} from "./userstories";

const makeResponse = (json: unknown = {}): Response => {
    const stub = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: (): string | null => null },
        text(): Promise<string> {
            return Promise.resolve(JSON.stringify(json));
        },
    };

    return stub as unknown as Response;
};

const fetchMock = jest.fn();

interface SentRequest {
    url: string;
    method: string;
    body: Record<string, unknown> | undefined;
    headers: Record<string, string>;
}

const lastRequest = (): SentRequest => {
    const calls = fetchMock.mock.calls;
    const call = calls[calls.length - 1] as [string, RequestInit];
    const init = call[1];
    const rawBody = init.body as string | undefined;

    return {
        url: call[0],
        method: init.method as string,
        body: rawBody === undefined ? undefined : (JSON.parse(rawBody) as Record<string, unknown>),
        headers: init.headers as Record<string, string>,
    };
};

const originalFetch = window.fetch;

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(makeResponse([]));
    window.fetch = fetchMock as unknown as typeof window.fetch;

    window.localStorage.clear();
    window.localStorage.setItem("token", JSON.stringify("jwt-abc"));
    window.taiga = { sessionId: "sess-1" };
    window.taigaConfig = { api: "http://localhost:8000/api/v1/", defaultLanguage: "en" };
});

afterEach(() => {
    window.fetch = originalFetch;
    window.localStorage.clear();
    delete window.taiga;
    window.taigaConfig = undefined;
});

describe("shared/api/userstories", () => {
    describe("listUserstories", () => {
        it("GETs /userstories with project + filters and disables pagination", async () => {
            await listUserstories(42, { milestone: 7, status: [1, 2] });

            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toContain("http://localhost:8000/api/v1/userstories?");
            expect(sent.url).toContain("project=42");
            expect(sent.url).toContain("milestone=7");
            expect(sent.url).toContain("status=1");
            expect(sent.url).toContain("status=2");
            expect(sent.headers["x-disable-pagination"]).toBe("1");
        });
    });

    describe("filtersData", () => {
        it("GETs /userstories/filters_data with disable-pagination", async () => {
            await filtersData({ project: 42 });

            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toContain("http://localhost:8000/api/v1/userstories/filters_data?");
            expect(sent.url).toContain("project=42");
            expect(sent.headers["x-disable-pagination"]).toBe("1");
        });
    });

    describe("getUserstory", () => {
        // D-1: the edit lightbox re-fetches the FULL story detail on open so a
        // subject-only save cannot erase the `description` that the light board
        // LIST serializer omits. This GETs the detail endpoint by id.
        it("GETs /userstories/{id} for a single story detail", async () => {
            fetchMock.mockResolvedValue(
                makeResponse({ id: 77, subject: "S", description: "the body" }),
            );

            const res = await getUserstory(77);

            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories/77");
            // The parsed detail (with its description) is returned to the caller.
            expect(res.data).toMatchObject({ id: 77, description: "the body" });
        });
    });

    describe("bulkCreate", () => {
        it("POSTs /userstories/bulk_create with a STRING bulk_stories and always includes swimlane_id", async () => {
            await bulkCreate(42, 3, "Story A\nStory B", 9);

            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories/bulk_create");
            expect(sent.body).toEqual({
                project_id: 42,
                status_id: 3,
                bulk_stories: "Story A\nStory B",
                swimlane_id: 9,
            });
            expect(typeof (sent.body as Record<string, unknown>).bulk_stories).toBe("string");
        });

        it("includes swimlane_id even when it is null", async () => {
            await bulkCreate(42, 3, "Only", null);

            const sent = lastRequest();
            expect(sent.body).toHaveProperty("swimlane_id");
            expect((sent.body as Record<string, unknown>).swimlane_id).toBeNull();
        });
    });

    describe("createUserstory", () => {
        it("POSTs /userstories ATOMICALLY with the WHOLE story body in a single request (no follow-up PATCH)", async () => {
            await createUserstory({
                project: 42,
                subject: "Atomic story",
                status: 3,
                swimlane: 9,
                points: { "1": 5 },
                assigned_to: 7,
                description: "desc",
                tags: [["urgent", "#ff0000"]],
                due_date: "2024-01-31",
                is_blocked: true,
                blocked_note: "waiting",
                team_requirement: true,
                client_requirement: false,
            });

            // Exactly ONE request is issued (the atomic create): the previous
            // bulk_create + PATCH flow made two. The endpoint is the standard
            // single-story create using the serializer field names.
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories");
            expect(sent.body).toEqual({
                project: 42,
                subject: "Atomic story",
                status: 3,
                swimlane: 9,
                points: { "1": 5 },
                assigned_to: 7,
                description: "desc",
                tags: [["urgent", "#ff0000"]],
                due_date: "2024-01-31",
                is_blocked: true,
                blocked_note: "waiting",
                team_requirement: true,
                client_requirement: false,
            });
        });

        it("sends a minimal body (project + subject only) when no optional fields are provided", async () => {
            await createUserstory({ project: 42, subject: "Bare" });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories");
            expect(sent.body).toEqual({ project: 42, subject: "Bare" });
        });
    });

    describe("bulkUpdateBacklogOrder", () => {
        it("adds milestone_id when truthy and after_userstory_id when an 'after' id is given", async () => {
            await bulkUpdateBacklogOrder(42, 7, 100, null, [10, 11, 12]);

            const sent = lastRequest();
            expect(sent.url).toBe(
                "http://localhost:8000/api/v1/userstories/bulk_update_backlog_order",
            );
            expect(sent.body).toEqual({
                project_id: 42,
                bulk_userstories: [10, 11, 12],
                milestone_id: 7,
                after_userstory_id: 100,
            });
            expect(sent.body).not.toHaveProperty("before_userstory_id");
        });

        it("uses before_userstory_id when no 'after' id is given, and omits milestone_id when falsy", async () => {
            await bulkUpdateBacklogOrder(42, null, null, 200, [10, 11]);

            const sent = lastRequest();
            expect(sent.body).toEqual({
                project_id: 42,
                bulk_userstories: [10, 11],
                before_userstory_id: 200,
            });
            expect(sent.body).not.toHaveProperty("milestone_id");
            expect(sent.body).not.toHaveProperty("after_userstory_id");
        });

        it("prefers after_userstory_id over before_userstory_id when BOTH neighbors are given", async () => {
            // Exercises the `if (after) {} else if (before) {}` XOR precedence
            // directly (QA F6): with both truthy, 'after' wins and 'before' is omitted.
            await bulkUpdateBacklogOrder(42, 7, 100, 200, [10, 11]);

            const sent = lastRequest();
            expect(sent.body).toEqual({
                project_id: 42,
                bulk_userstories: [10, 11],
                milestone_id: 7,
                after_userstory_id: 100,
            });
            expect(sent.body).not.toHaveProperty("before_userstory_id");
        });
    });

    describe("bulkUpdateMilestone", () => {
        it("POSTs /userstories/bulk_update_milestone with bulk_stories as {us_id, order}[]", async () => {
            await bulkUpdateMilestone(42, 7, [
                { us_id: 10, order: 0 },
                { us_id: 11, order: 1 },
            ]);

            const sent = lastRequest();
            expect(sent.url).toBe(
                "http://localhost:8000/api/v1/userstories/bulk_update_milestone",
            );
            expect(sent.body).toEqual({
                project_id: 42,
                milestone_id: 7,
                bulk_stories: [
                    { us_id: 10, order: 0 },
                    { us_id: 11, order: 1 },
                ],
            });
        });
    });

    describe("bulkUpdateKanbanOrder", () => {
        it("includes after_userstory_id and swimlane_id when the swimlane id is truthy", async () => {
            await bulkUpdateKanbanOrder(42, 3, 5, 100, null, [10, 11]);

            const sent = lastRequest();
            expect(sent.url).toBe(
                "http://localhost:8000/api/v1/userstories/bulk_update_kanban_order",
            );
            expect(sent.body).toEqual({
                project_id: 42,
                status_id: 3,
                bulk_userstories: [10, 11],
                after_userstory_id: 100,
                swimlane_id: 5,
            });
            expect(sent.body).not.toHaveProperty("before_userstory_id");
        });

        it("uses before_userstory_id and omits swimlane_id when the swimlane id is null (mapped from -1)", async () => {
            await bulkUpdateKanbanOrder(42, 3, null, null, 200, [10]);

            const sent = lastRequest();
            expect(sent.body).toEqual({
                project_id: 42,
                status_id: 3,
                bulk_userstories: [10],
                before_userstory_id: 200,
            });
            expect(sent.body).not.toHaveProperty("swimlane_id");
            expect(sent.body).not.toHaveProperty("after_userstory_id");
        });

        it("prefers after_userstory_id over before_userstory_id when BOTH neighbors are given", async () => {
            // Kanban is the drag hot path; assert the same XOR precedence (QA F6).
            await bulkUpdateKanbanOrder(42, 3, 5, 100, 200, [10, 11]);

            const sent = lastRequest();
            expect(sent.body).toMatchObject({
                after_userstory_id: 100,
                swimlane_id: 5,
            });
            expect(sent.body).not.toHaveProperty("before_userstory_id");
        });
    });
});
