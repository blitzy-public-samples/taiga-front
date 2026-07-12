/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the header builder + `fetch` wrapper (`./http`).
 *
 * These lock the frozen HTTP header contract that the AngularJS client emits on
 * EVERY request. The wire source of truth is `base/http.coffee`
 * `HttpService.headers()` (Authorization + Accept-Language, merged onto every
 * verb by `request()`) plus the `app.coffee` `$httpProvider` defaults (the
 * built-in `common.Accept` applies to all verbs; Content-Type only on
 * mutations). A prior implementation gated `Accept-Language` behind the mutating
 * methods and never set an explicit `Accept`, so GET reads diverged from the
 * frozen client and the backend (which content-negotiates on `Accept-Language`,
 * `Vary: Accept-Language`) returned a different `Content-Language` for reads.
 */

import type { MountContext } from "../types";
import { buildHeaders, request, type HttpMethod } from "./http";

/** A fully-populated mount context; `apiUrl` intentionally has no trailing slash. */
const baseContext: MountContext = {
    projectSlug: "proj-1",
    token: "test-token-value",
    sessionId: "test-session-id",
    apiUrl: "http://localhost:8000/api/v1",
    eventsUrl: null,
    language: "en",
};

const MUTATIONS: ReadonlyArray<HttpMethod> = ["POST", "PUT", "PATCH", "DELETE"];
const ALL_METHODS: ReadonlyArray<HttpMethod> = ["GET", ...MUTATIONS];

describe("http.buildHeaders header contract", () => {
    beforeEach(() => {
        // jsdom persists localStorage/window across tests in a file; reset the
        // token + session fallbacks so each case starts from a clean slate.
        localStorage.clear();
        delete (window as unknown as { taiga?: unknown }).taiga;
    });

    it("sends Authorization (bearer) + X-Session-Id on every request", () => {
        ALL_METHODS.forEach((method) => {
            const headers = buildHeaders(baseContext, method);
            expect(headers.Authorization).toBe("Bearer test-token-value");
            expect(headers["X-Session-Id"]).toBe("test-session-id");
        });
    });

    it("sends Accept-Language on GET as well as mutations (H1: not gated behind mutating methods)", () => {
        ALL_METHODS.forEach((method) => {
            expect(buildHeaders(baseContext, method)["Accept-Language"]).toBe("en");
        });
    });

    it("sends the explicit Accept header on every request (H2)", () => {
        ALL_METHODS.forEach((method) => {
            expect(buildHeaders(baseContext, method).Accept).toBe("application/json, text/plain, */*");
        });
    });

    it("sends Content-Type only on mutations, never on GET", () => {
        expect(buildHeaders(baseContext, "GET")["Content-Type"]).toBeUndefined();
        MUTATIONS.forEach((method) => {
            expect(buildHeaders(baseContext, method)["Content-Type"]).toBe("application/json");
        });
    });

    it("omits Accept-Language when the context has no language, but still sends Accept", () => {
        const ctx: MountContext = { ...baseContext, language: "" };
        const headers = buildHeaders(ctx, "GET");
        expect(headers["Accept-Language"]).toBeUndefined();
        expect(headers.Accept).toBe("application/json, text/plain, */*");
    });

    it("omits Authorization when there is neither a context token nor a localStorage token", () => {
        const ctx: MountContext = { ...baseContext, token: null };
        expect(buildHeaders(ctx, "GET").Authorization).toBeUndefined();
    });

    it("falls back to the JSON-encoded localStorage token when the context token is absent", () => {
        const ctx: MountContext = { ...baseContext, token: null };
        localStorage.setItem("token", JSON.stringify("ls-token"));
        expect(buildHeaders(ctx, "GET").Authorization).toBe("Bearer ls-token");
    });

    it("treats a garbage (non-JSON) localStorage token as no token", () => {
        const ctx: MountContext = { ...baseContext, token: null };
        localStorage.setItem("token", "{not-json");
        expect(buildHeaders(ctx, "GET").Authorization).toBeUndefined();
    });

    it("reuses window.taiga.sessionId when the context sessionId is absent (never mints one)", () => {
        const ctx: MountContext = { ...baseContext, sessionId: null };
        (window as unknown as { taiga?: { sessionId?: string } }).taiga = { sessionId: "win-sid" };
        expect(buildHeaders(ctx, "GET")["X-Session-Id"]).toBe("win-sid");
    });
});

describe("http.request GET wire parity", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    /** Read the plain headers object handed to the most recent fetch call. */
    const lastInitHeaders = (): Record<string, string> => {
        const { calls } = fetchMock.mock;
        const [, init] = calls[calls.length - 1] as [string, RequestInit];
        return (init.headers ?? {}) as Record<string, string>;
    };

    it("issues a GET carrying Accept-Language + Accept + x-disable-pagination and no Content-Type", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async (): Promise<string> => JSON.stringify([{ id: 1 }]),
        } as unknown as Response);

        await request(baseContext, "GET", "http://localhost:8000/api/v1/userstories?project=1");

        const headers = lastInitHeaders();
        expect(headers["Accept-Language"]).toBe("en");
        expect(headers.Accept).toBe("application/json, text/plain, */*");
        expect(headers["x-disable-pagination"]).toBe("1");
        expect(headers["Content-Type"]).toBeUndefined();
    });
});
