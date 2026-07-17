/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * [M-10] Unit suite for the user-story attachments API against the FROZEN
 * `/api/v1/userstories/attachments` endpoint. The FormData payload field names
 * and order are pinned as independent literals sourced from the AngularJS
 * resource (`attachments-resource.service.coffee` L116-120) so any drift fails.
 */

import {
    deleteUserstoryAttachment,
    listUserstoryAttachments,
    uploadUserstoryAttachment,
} from "./attachments";

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
    body: unknown;
    headers: Record<string, string>;
}

const lastRequest = (): SentRequest => {
    const calls = fetchMock.mock.calls;
    const call = calls[calls.length - 1] as [string, RequestInit];
    const init = call[1];
    return {
        url: call[0],
        method: init.method as string,
        body: init.body,
        headers: init.headers as Record<string, string>,
    };
};

const originalFetch = window.fetch;

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(makeResponse({ id: 99, name: "spec.txt" }));
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

describe("shared/api/attachments", () => {
    describe("uploadUserstoryAttachment", () => {
        it("POSTs multipart FormData with project/object_id/attached_file/from_comment", async () => {
            const file = new File(["hello"], "spec.txt", { type: "text/plain" });
            await uploadUserstoryAttachment(file, 42, 7);

            const sent = lastRequest();
            expect(sent.method).toBe("POST");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories/attachments");
            // The body is a FormData instance (multipart), not a JSON string.
            expect(sent.body).toBeInstanceOf(FormData);
            const form = sent.body as FormData;
            expect(form.get("project")).toBe("7");
            expect(form.get("object_id")).toBe("42");
            expect(form.get("from_comment")).toBe("false");
            expect(form.get("attached_file")).toBeInstanceOf(File);
            expect((form.get("attached_file") as File).name).toBe("spec.txt");
            // No JSON Content-Type on a multipart upload.
            expect(sent.headers["Content-Type"]).toBeUndefined();
            // Auth header is still applied.
            expect(sent.headers["Authorization"]).toBe("Bearer jwt-abc");
        });

        it("forwards a truthy from_comment flag", async () => {
            const file = new File(["x"], "c.txt");
            await uploadUserstoryAttachment(file, 1, 2, true);
            const form = lastRequest().body as FormData;
            expect(form.get("from_comment")).toBe("true");
        });
    });

    describe("deleteUserstoryAttachment", () => {
        it("DELETEs /userstories/attachments/{id}", async () => {
            await deleteUserstoryAttachment(99);
            const sent = lastRequest();
            expect(sent.method).toBe("DELETE");
            expect(sent.url).toBe("http://localhost:8000/api/v1/userstories/attachments/99");
        });
    });

    describe("listUserstoryAttachments", () => {
        it("GETs /userstories/attachments filtered by object_id + project", async () => {
            fetchMock.mockResolvedValueOnce(makeResponse([{ id: 1, name: "a" }]));
            const res = await listUserstoryAttachments(42, 7);
            const sent = lastRequest();
            expect(sent.method).toBe("GET");
            expect(sent.url).toContain("http://localhost:8000/api/v1/userstories/attachments?");
            expect(sent.url).toContain("object_id=42");
            expect(sent.url).toContain("project=7");
            expect(res.data).toEqual([{ id: 1, name: "a" }]);
        });
    });
});
