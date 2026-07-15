/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    create,
    get,
    list,
    moveUserStoriesToSprint,
    remove,
    save,
    stats,
} from "./milestones";

interface FakeResponseInit {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    json?: unknown;
}

const makeHeaders = (map: Record<string, string> = {}): Headers => {
    const lower: Record<string, string> = {};
    for (const key of Object.keys(map)) {
        lower[key.toLowerCase()] = map[key];
    }

    const stub = {
        get(name: string): string | null {
            const value = lower[name.toLowerCase()];
            return value === undefined ? null : value;
        },
    };

    return stub as unknown as Headers;
};

const makeResponse = (init: FakeResponseInit = {}): Response => {
    const status = init.status ?? 200;
    const stub = {
        ok: status >= 200 && status < 300,
        status,
        statusText: init.statusText ?? "OK",
        headers: makeHeaders(init.headers),
        text(): Promise<string> {
            return Promise.resolve(init.json === undefined ? "" : JSON.stringify(init.json));
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
    fetchMock.mockResolvedValue(makeResponse({ json: [] }));
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

describe("shared/api/milestones", () => {
    describe("list", () => {
        it("GETs /milestones and parses the open/closed count headers", async () => {
            fetchMock.mockResolvedValue(
                makeResponse({
                    json: [{ id: 1 }, { id: 2 }],
                    headers: {
                        "Taiga-Info-Total-Closed-Milestones": "3",
                        "Taiga-Info-Total-Opened-Milestones": "5",
                    },
                }),
            );

            const result = await list(42);

            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toContain("http://localhost:8000/api/v1/milestones?");
            expect(sent.url).toContain("project=42");
            expect(sent.headers["x-disable-pagination"]).toBe("1");
            expect(result.milestones).toEqual([{ id: 1 }, { id: 2 }]);
            expect(result.closed).toBe(3);
            expect(result.open).toBe(5);
        });

        it("yields NaN counts when the headers are absent (mirrors source parseInt semantics)", async () => {
            fetchMock.mockResolvedValue(makeResponse({ json: [] }));

            const result = await list(42);

            expect(Number.isNaN(result.closed)).toBe(true);
            expect(Number.isNaN(result.open)).toBe(true);
        });
    });

    describe("get / stats", () => {
        it("GETs /milestones/{id} with disable-pagination", async () => {
            await get(11);

            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toBe("http://localhost:8000/api/v1/milestones/11");
            expect(sent.headers["x-disable-pagination"]).toBe("1");
        });

        it("GETs /milestones/{id}/stats", async () => {
            await stats(11);

            const sent = lastRequest();
            expect(sent.url).toBe("http://localhost:8000/api/v1/milestones/11/stats");
            expect(sent.headers["x-disable-pagination"]).toBe("1");
        });
    });

    describe("create / save / remove", () => {
        it("POSTs /milestones with the writable sprint body", async () => {
            await create({
                project: 42,
                name: "Sprint 1",
                estimated_start: "2021-01-01",
                estimated_finish: "2021-01-14",
            });

            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe("http://localhost:8000/api/v1/milestones");
            expect(sent.body).toEqual({
                project: 42,
                name: "Sprint 1",
                estimated_start: "2021-01-01",
                estimated_finish: "2021-01-14",
            });
        });

        it("PATCHes /milestones/{id} with the changed fields and DELETEs by id", async () => {
            await save(11, { name: "Renamed" });

            let sent = lastRequest();
            expect(sent.method).toBe("PATCH");
            expect(sent.url).toBe("http://localhost:8000/api/v1/milestones/11");
            expect(sent.body).toEqual({ name: "Renamed" });

            await remove(11);

            sent = lastRequest();
            expect(sent.method).toBe("DELETE");
            expect(sent.url).toBe("http://localhost:8000/api/v1/milestones/11");
        });
    });

    describe("moveUserStoriesToSprint", () => {
        it("POSTs to the CURRENT milestone path with the DESTINATION milestone and {us_id, order}[] body", async () => {
            await moveUserStoriesToSprint(11, 42, 99, [
                { us_id: 10, order: 0 },
                { us_id: 11, order: 1 },
                { us_id: 12, order: 2 },
            ]);

            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe(
                "http://localhost:8000/api/v1/milestones/11/move_userstories_to_sprint",
            );
            expect(sent.body).toEqual({
                project_id: 42,
                milestone_id: 99,
                bulk_stories: [
                    { us_id: 10, order: 0 },
                    { us_id: 11, order: 1 },
                    { us_id: 12, order: 2 },
                ],
            });
        });
    });
});
