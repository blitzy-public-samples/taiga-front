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
import { buildHeaders, request, ApiError, type HttpMethod } from "./http";

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
        // session fallback so each case starts clean.
        localStorage.clear();
        // Finding C4: localStorage is the AUTHORITATIVE credential store. In
        // production the mount snapshot (`context.token`) is itself READ FROM
        // localStorage at `connectedCallback` time, so the two always agree.
        // Seed the store to mirror `baseContext.token`; individual cases below
        // override it to exercise the absent / malformed (logged-out) paths.
        localStorage.setItem("token", JSON.stringify("test-token-value"));
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

    it("C4: omits Authorization when localStorage has no token (authoritative logout), ignoring a stale snapshot", () => {
        // localStorage cleared of the seed => logged out. Even though the context
        // still carries a snapshot token, no bearer must be emitted.
        localStorage.removeItem("token");
        const ctx: MountContext = { ...baseContext, token: "stale-snapshot" };
        expect(buildHeaders(ctx, "GET").Authorization).toBeUndefined();
    });

    it("C4: uses the JSON-encoded localStorage token as the authoritative bearer", () => {
        const ctx: MountContext = { ...baseContext, token: null };
        localStorage.setItem("token", JSON.stringify("ls-token"));
        expect(buildHeaders(ctx, "GET").Authorization).toBe("Bearer ls-token");
    });

    it("C4: treats a garbage (non-JSON) localStorage token as authoritative logout (no bearer)", () => {
        const ctx: MountContext = { ...baseContext, token: "stale-snapshot" };
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

/** Build a mock `Response` usable by both the main request path (text) and the refresh path (json). */
const mockResponse = (
    body: unknown,
    status = 200,
    headers: Headers = new Headers(),
): Response =>
    ({
        ok: status >= 200 && status < 300,
        status,
        headers,
        text: async (): Promise<string> => (typeof body === "string" ? body : JSON.stringify(body)),
        json: async (): Promise<unknown> => body,
    }) as unknown as Response;

describe("http.request — header integrity (M10)", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        localStorage.clear();
        localStorage.setItem("token", JSON.stringify("test-token-value"));
    });

    afterEach(() => localStorage.clear());

    const lastInitHeaders = (): Record<string, string> => {
        const { calls } = fetchMock.mock;
        const [, init] = calls[calls.length - 1] as [string, RequestInit];
        return (init.headers ?? {}) as Record<string, string>;
    };

    it("ignores caller attempts to override the trusted transport headers (case-insensitive)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([{ id: 1 }]));

        await request(baseContext, "POST", "http://localhost:8000/api/v1/userstories", {
            body: { subject: "x" },
            headers: {
                // Every one of these is a PROTECTED header and must be dropped.
                Authorization: "Bearer FORGED",
                "x-session-id": "FORGED-SID",
                Accept: "text/evil",
                "Accept-Language": "zz",
                "Content-Type": "text/evil",
                "X-Disable-Pagination": "0",
            },
        });

        const headers = lastInitHeaders();
        expect(headers.Authorization).toBe("Bearer test-token-value");
        expect(headers["X-Session-Id"]).toBe("test-session-id");
        expect(headers.Accept).toBe("application/json, text/plain, */*");
        expect(headers["Accept-Language"]).toBe("en");
        expect(headers["Content-Type"]).toBe("application/json");
    });

    it("preserves benign, request-specific caller headers", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([{ id: 1 }]));

        await request(baseContext, "GET", "http://localhost:8000/api/v1/userstories", {
            headers: { "X-Custom-Trace": "abc-123" },
        });

        expect(lastInitHeaders()["X-Custom-Trace"]).toBe("abc-123");
    });
});

describe("http.request — cancellation (M9)", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        localStorage.clear();
        localStorage.setItem("token", JSON.stringify("test-token-value"));
    });

    afterEach(() => localStorage.clear());

    it("threads the provided AbortSignal into fetch", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse([{ id: 1 }]));
        const controller = new AbortController();

        await request(baseContext, "GET", "http://localhost:8000/api/v1/userstories", {
            signal: controller.signal,
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.signal).toBe(controller.signal);
    });

    it("propagates an abort rejection to the caller unchanged (not wrapped as ApiError)", async () => {
        const abortError = new DOMException("Aborted", "AbortError");
        fetchMock.mockRejectedValueOnce(abortError);
        const controller = new AbortController();
        controller.abort();

        await expect(
            request(baseContext, "GET", "http://localhost:8000/api/v1/userstories", {
                signal: controller.signal,
            }),
        ).rejects.toBe(abortError);
    });
});

describe("http.request — token recovery (C3)", () => {
    const fetchMock = jest.fn();
    let originalLocation: Location;

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        localStorage.clear();
        localStorage.setItem("token", JSON.stringify("old-token"));
        localStorage.setItem("refresh", JSON.stringify("refresh-abc"));
        // Replace window.location with a plain writable stub so the logout
        // redirect assignment is observable and does not trigger jsdom's
        // unimplemented-navigation warning.
        originalLocation = window.location;
        delete (window as unknown as { location?: unknown }).location;
        (window as unknown as { location: unknown }).location = {
            pathname: "/project/proj-1/kanban",
            search: "",
            href: "",
        };
    });

    afterEach(() => {
        (window as unknown as { location: Location }).location = originalLocation;
        localStorage.clear();
    });

    it("refreshes the token on 401 and retries the original request once with the new bearer", async () => {
        // 1) original request -> 401
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "expired" }, 401));
        // 2) /auth/refresh -> 200 with a rotated token
        fetchMock.mockResolvedValueOnce(
            mockResponse({ auth_token: "new-token", refresh: "refresh-xyz" }, 200),
        );
        // 3) retried original request -> 200
        fetchMock.mockResolvedValueOnce(mockResponse([{ id: 7 }], 200));

        const result = await request<Array<{ id: number }>>(
            baseContext,
            "GET",
            "http://localhost:8000/api/v1/userstories?project=1",
        );

        expect(result.status).toBe(200);
        expect(result.data).toEqual([{ id: 7 }]);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // The refresh POST hit the frozen /auth/refresh endpoint with { refresh }.
        const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(refreshUrl).toBe("http://localhost:8000/api/v1/auth/refresh");
        expect(JSON.parse(String(refreshInit.body))).toEqual({ refresh: "refresh-abc" });

        // New token persisted + used on the retry (live read by buildHeaders).
        expect(JSON.parse(localStorage.getItem("token") as string)).toBe("new-token");
        expect(JSON.parse(localStorage.getItem("refresh") as string)).toBe("refresh-xyz");
        const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
        expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer new-token");
    });

    it("logs out (clears session + redirects) when no refresh token is stored", async () => {
        localStorage.removeItem("refresh");
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "expired" }, 401));

        await expect(
            request(baseContext, "GET", "http://localhost:8000/api/v1/userstories"),
        ).rejects.toBeInstanceOf(ApiError);

        // Only the original request fired — no refresh attempt without a token.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Session torn down authoritatively.
        expect(localStorage.getItem("token")).toBeNull();
        expect(localStorage.getItem("refresh")).toBeNull();
        expect(window.location.href).toContain("/login?unauthorized=true&next=");
    });

    it("logs out when the refresh call itself fails (does not loop)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "expired" }, 401)); // original
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "bad refresh" }, 401)); // refresh -> 401

        await expect(
            request(baseContext, "GET", "http://localhost:8000/api/v1/userstories"),
        ).rejects.toBeInstanceOf(ApiError);

        // original + refresh only; the refresh 401 does NOT trigger another refresh.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem("token")).toBeNull();
    });

    it("does not attempt a refresh for a 401 from the refresh endpoint itself", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ detail: "bad" }, 401));

        await expect(
            request(baseContext, "POST", "http://localhost:8000/api/v1/auth/refresh", {
                body: { refresh: "x" },
            }),
        ).rejects.toBeInstanceOf(ApiError);

        // Exactly one call: no recursive refresh of the refresh endpoint.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("coalesces concurrent 401s into a SINGLE refresh (single-flight)", async () => {
        // Two original requests both 401, then one shared refresh, then two retries.
        fetchMock.mockImplementation((url: string) => {
            if (isRefreshCall(url)) {
                return Promise.resolve(mockResponse({ auth_token: "flight-token" }, 200));
            }
            // First two calls (the originals) 401; subsequent (retries) succeed.
            const originalCalls = fetchMock.mock.calls.filter(
                (c) => !isRefreshCall(String(c[0])),
            ).length;
            return Promise.resolve(
                originalCalls <= 2 ? mockResponse({ detail: "expired" }, 401) : mockResponse([{ id: 1 }], 200),
            );
        });

        const [a, b] = await Promise.all([
            request(baseContext, "GET", "http://localhost:8000/api/v1/userstories?a=1"),
            request(baseContext, "GET", "http://localhost:8000/api/v1/userstories?b=2"),
        ]);

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        const refreshCalls = fetchMock.mock.calls.filter((c) => isRefreshCall(String(c[0])));
        expect(refreshCalls).toHaveLength(1);
    });
});


describe("http.request — multipart FormData (M1 attachment uploads)", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        localStorage.clear();
        localStorage.setItem("token", JSON.stringify("test-token-value"));
    });

    afterEach(() => localStorage.clear());

    const lastInit = (): RequestInit => {
        const { calls } = fetchMock.mock;
        const [, init] = calls[calls.length - 1] as [string, RequestInit];
        return init;
    };
    const lastHeaders = (): Record<string, string> =>
        (lastInit().headers ?? {}) as Record<string, string>;

    it("sends the FormData instance verbatim and DROPS Content-Type (browser sets the boundary)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 7 }, 201));

        const form = new FormData();
        form.append("attached_file", new File(["x"], "a.txt", { type: "text/plain" }));

        await request(baseContext, "POST", "http://localhost:8000/api/v1/userstories/attachments", {
            formData: form,
        });

        // The exact FormData object is forwarded (no JSON.stringify).
        expect(lastInit().body).toBe(form);
        // Content-Type is removed so fetch can inject the multipart boundary.
        expect(lastHeaders()["Content-Type"]).toBeUndefined();
        // Trusted transport headers survive.
        expect(lastHeaders().Authorization).toBe("Bearer test-token-value");
        expect(lastHeaders()["X-Session-Id"]).toBe("test-session-id");
    });

    it("prefers formData over a JSON body when both are (mis)supplied", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ id: 8 }, 201));

        const form = new FormData();
        form.append("k", "v");

        await request(baseContext, "POST", "http://localhost:8000/api/v1/userstories/attachments", {
            formData: form,
            body: { should: "be ignored" },
        });

        expect(lastInit().body).toBe(form);
        expect(lastHeaders()["Content-Type"]).toBeUndefined();
    });
});

/** True when a fetch call URL targets the refresh endpoint. */
const isRefreshCall = (url: string): boolean => url.indexOf("/auth/refresh") !== -1;
