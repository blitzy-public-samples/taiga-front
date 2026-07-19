/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Focused Jest unit suite for the dependency-free `fetch` HTTP client that the
// React Kanban/Backlog screens use against the FROZEN Django `/api/v1/`
// contract (AAP §0.2.1 "app/react/**/*.test.tsx — CREATE" + §0.4.1 httpClient).
//
// Strategy: drive the REAL sibling adapters (config/session) by seeding the same
// window globals AngularJS establishes (`window.taigaConfig`,
// `localStorage["token"]`, `window.taiga.sessionId`), and stub the global
// `fetch` with a capturing mock so every emitted request (url + init) can be
// asserted byte-for-byte. This mirrors the "real capture server" approach the QA
// used, but in-process and deterministic.
//
// The expected header names / URL-join behavior are pinned here as INDEPENDENT
// literals sourced from the authoritative AngularJS contracts (never imported
// from the module under test), so any drift in httpClient.ts fails a test:
//   • Authorization: Bearer <token>  — app/coffee/modules/base/http.coffee L21-23
//   • Accept-Language / X-Session-Id — app/coffee/app.coffee L592-593, L601
//   • URL join trimEnd(base,"/")+"/"+trimStart(path,"/") — base/urls.coffee L34-37

import {
    HttpError,
    buildUrl,
    httpDelete,
    httpGet,
    httpPatch,
    httpPost,
    httpPut,
    isVersionConflict,
    request,
} from "./httpClient";
import { resetInterceptorHooks, setInterceptorHooks } from "./httpInterceptor";
import { getToken } from "../session/auth";

// --- Independent expectations (intentionally NOT imported from the SUT) ---
const API_BASE = "http://localhost:8000/api/v1/";
const TOKEN = "jwt-abc.def.ghi";
const SESSION_ID = "session-xyz-123";
const LANGUAGE = "es";

/** A minimal, `Response`-shaped stub (jsdom provides no `fetch`/`Response`). */
interface MockResponseInit {
    status?: number;
    statusText?: string;
    body?: string;
    headers?: Record<string, string>;
}

function mockResponse(init: MockResponseInit = {}): Response {
    const status = init.status ?? 200;
    const stub = {
        ok: status >= 200 && status < 300,
        status,
        statusText: init.statusText ?? "OK",
        headers: new Headers(init.headers ?? {}),
        text: async (): Promise<string> => init.body ?? "",
    };

    return stub as unknown as Response;
}

/** The capturing `fetch` mock; reset per test by `clearMocks:true`. */
let fetchMock: jest.Mock;

/** Read the `[url, init]` captured for the Nth fetch call (0-based). */
function callArgs(index = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init };
}

/** Read the outgoing headers of the Nth fetch call as a plain record. */
function sentHeaders(index = 0): Record<string, string> {
    return callArgs(index).init.headers as Record<string, string>;
}

beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("token", JSON.stringify(TOKEN));
    (window as unknown as { taiga?: { sessionId?: string } }).taiga = {
        sessionId: SESSION_ID,
    };
    window.taigaConfig = { api: API_BASE, defaultLanguage: LANGUAGE };

    fetchMock = jest.fn(async () => mockResponse({ body: "{}" }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
    // Restore the default interceptor policy so a per-test spy hook never leaks.
    resetInterceptorHooks();
    window.localStorage.clear();
    delete (window as unknown as { taiga?: unknown }).taiga;
    window.taigaConfig = undefined;
    jest.restoreAllMocks();
});

describe("shared/api/httpClient", () => {
    describe("buildUrl", () => {
        it("joins the API base and a bare path with a single slash", () => {
            expect(buildUrl("userstories")).toBe(`${API_BASE}userstories`);
        });

        it("collapses a trailing base slash against a leading path slash", () => {
            expect(buildUrl("/userstories")).toBe(`${API_BASE}userstories`);
        });

        it("adds the separator when the base has no trailing slash", () => {
            window.taigaConfig = { api: "http://host/api/v1" };
            expect(buildUrl("/milestones")).toBe("http://host/api/v1/milestones");
        });

        it("collapses multiple leading/trailing slashes to exactly one", () => {
            window.taigaConfig = { api: "http://host/api/v1///" };
            expect(buildUrl("///foo")).toBe("http://host/api/v1/foo");
        });
    });

    describe("query-string serialization", () => {
        it("omits the query string entirely when there are no params", async () => {
            await httpGet("userstories");
            expect(callArgs().url).toBe(`${API_BASE}userstories`);
        });

        it("serializes scalar params", async () => {
            await httpGet("userstories", { project: 7, status: "open" });
            expect(callArgs().url).toBe(`${API_BASE}userstories?project=7&status=open`);
        });

        it("expands array params into repeated keys", async () => {
            await httpGet("userstories", { id: [1, 2, 3] });
            expect(callArgs().url).toBe(`${API_BASE}userstories?id=1&id=2&id=3`);
        });

        it("omits null and undefined params but keeps 0 and empty string", async () => {
            await httpGet("userstories", {
                a: null,
                b: undefined,
                zero: 0,
                empty: "",
                keep: "yes",
            });
            expect(callArgs().url).toBe(`${API_BASE}userstories?zero=0&empty=&keep=yes`);
        });

        it("serializes boolean params", async () => {
            await httpGet("userstories", { flag: true, off: false });
            expect(callArgs().url).toBe(`${API_BASE}userstories?flag=true&off=false`);
        });
    });

    describe("HTTP methods", () => {
        it("issues a GET with no body and no Content-Type", async () => {
            await httpGet("userstories");
            const { init } = callArgs();
            expect(init.method).toBe("GET");
            expect(init.body).toBeUndefined();
            expect(sentHeaders()["Content-Type"]).toBeUndefined();
        });

        it("issues a POST with a JSON-serialized body", async () => {
            await httpPost("userstories", { subject: "New" });
            const { init } = callArgs();
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ subject: "New" }));
            expect(sentHeaders()["Content-Type"]).toBe("application/json");
        });

        it("issues a PUT with a JSON-serialized body", async () => {
            await httpPut("userstories/1", { subject: "Edit" });
            expect(callArgs().init.method).toBe("PUT");
            expect(callArgs().init.body).toBe(JSON.stringify({ subject: "Edit" }));
        });

        it("issues a PATCH with a JSON-serialized body (bulk order round-trip)", async () => {
            const payload = { bulk_userstories: [[1, 10], [2, 20]] };
            await httpPatch("userstories/bulk_update_kanban_order", payload);
            expect(callArgs().init.method).toBe("PATCH");
            expect(callArgs().init.body).toBe(JSON.stringify(payload));
            expect(sentHeaders()["Content-Type"]).toBe("application/json");
        });

        it("issues a DELETE with no body by default", async () => {
            await httpDelete("userstories/1");
            const { init } = callArgs();
            expect(init.method).toBe("DELETE");
            expect(init.body).toBeUndefined();
        });

        it("[M-10] sends a FormData body as multipart (no JSON.stringify, no JSON Content-Type)", async () => {
            const form = new FormData();
            form.append("project", "7");
            form.append("object_id", "42");
            await request("POST", "userstories/attachments", { body: form });
            const { init } = callArgs();
            // The FormData instance is passed through verbatim (not stringified).
            expect(init.body).toBe(form);
            expect(typeof init.body).not.toBe("string");
            // No JSON Content-Type: the browser sets the multipart boundary itself.
            expect(sentHeaders()["Content-Type"]).toBeUndefined();
            // Auth/session headers are still applied.
            expect(sentHeaders()["Authorization"]).toBe(`Bearer ${TOKEN}`);
            expect(sentHeaders()["X-Session-Id"]).toBe(SESSION_ID);
        });

        it("transmits a DELETE body when one is supplied", async () => {
            await request("DELETE", "userstories/1", { body: { reason: "obsolete" } });
            const { init } = callArgs();
            expect(init.method).toBe("DELETE");
            expect(init.body).toBe(JSON.stringify({ reason: "obsolete" }));
            expect(sentHeaders()["Content-Type"]).toBe("application/json");
        });
    });

    describe("request headers", () => {
        it("sets exactly the mandatory shared-session headers on a GET", async () => {
            await httpGet("userstories");
            const headers = sentHeaders();
            expect(headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
            expect(headers["Accept-Language"]).toBe(LANGUAGE);
            expect(headers["X-Session-Id"]).toBe(SESSION_ID);
        });

        it("omits Authorization entirely when no token is stored", async () => {
            window.localStorage.removeItem("token");
            await httpGet("userstories");
            expect(sentHeaders()["Authorization"]).toBeUndefined();
        });

        it("falls back to 'en' for Accept-Language when the configured language is empty", async () => {
            window.taigaConfig = { api: API_BASE, defaultLanguage: "" };
            await httpGet("userstories");
            expect(sentHeaders()["Accept-Language"]).toBe("en");
        });

        it("lets the mandatory defaults win over caller headers of the same name", async () => {
            await httpGet("userstories", undefined, {
                "Accept-Language": "fr",
                "X-Session-Id": "attacker-session",
                "X-Custom": "keep-me",
            });
            const headers = sentHeaders();
            // Defaults override caller values...
            expect(headers["Accept-Language"]).toBe(LANGUAGE);
            expect(headers["X-Session-Id"]).toBe(SESSION_ID);
            // ...but unrelated caller headers are preserved.
            expect(headers["X-Custom"]).toBe("keep-me");
        });

        it("overrides a caller Authorization header when a real token exists", async () => {
            await httpGet("userstories", undefined, { Authorization: "Bearer caller-supplied" });
            expect(sentHeaders()["Authorization"]).toBe(`Bearer ${TOKEN}`);
        });

        it("preserves the caller Authorization header when no token exists", async () => {
            window.localStorage.removeItem("token");
            await httpGet("userstories", undefined, { Authorization: "Bearer caller-supplied" });
            expect(sentHeaders()["Authorization"]).toBe("Bearer caller-supplied");
        });

        it("does not add Content-Type to a write request that carries no body", async () => {
            await httpPost("userstories");
            expect(sentHeaders()["Content-Type"]).toBeUndefined();
        });
    });

    describe("response body parsing", () => {
        it("parses a JSON object response", async () => {
            fetchMock.mockResolvedValueOnce(mockResponse({ body: '{"id":42,"name":"S"}' }));
            const res = await httpGet<{ id: number; name: string }>("userstories/42");
            expect(res.status).toBe(200);
            expect(res.data).toEqual({ id: 42, name: "S" });
        });

        it("returns undefined data for a 204 No Content response", async () => {
            fetchMock.mockResolvedValueOnce(mockResponse({ status: 204, statusText: "No Content" }));
            const res = await httpDelete("userstories/1");
            expect(res.status).toBe(204);
            expect(res.data).toBeUndefined();
        });

        it("returns undefined data for an empty 200 body", async () => {
            fetchMock.mockResolvedValueOnce(mockResponse({ body: "" }));
            const res = await httpGet("ping");
            expect(res.data).toBeUndefined();
        });

        it("falls back to the raw text when the body is not JSON", async () => {
            fetchMock.mockResolvedValueOnce(mockResponse({ body: "plain-text-body" }));
            const res = await httpGet<string>("text");
            expect(res.data).toBe("plain-text-body");
        });

        it("exposes the response headers to the caller", async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: "[]", headers: { "x-pagination-count": "17" } }),
            );
            const res = await httpGet("userstories");
            expect(res.headers.get("x-pagination-count")).toBe("17");
        });
    });

    describe("HttpError on non-2xx responses", () => {
        it.each([400, 401, 403, 404, 409, 451, 500])(
            "throws HttpError carrying the parsed body for status %s",
            async (status) => {
                fetchMock.mockResolvedValueOnce(
                    mockResponse({
                        status,
                        statusText: "Err",
                        body: '{"_error_message":"nope"}',
                    }),
                );

                await expect(httpGet("userstories")).rejects.toBeInstanceOf(HttpError);
            },
        );

        it("populates status, statusText, body and url on the thrown error", async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ status: 403, statusText: "Forbidden", body: '{"detail":"blocked"}' }),
            );

            expect.assertions(5);
            try {
                await httpGet("userstories/1");
            } catch (error) {
                const httpError = error as HttpError;
                expect(httpError).toBeInstanceOf(Error);
                expect(httpError.status).toBe(403);
                expect(httpError.statusText).toBe("Forbidden");
                expect(httpError.body).toEqual({ detail: "blocked" });
                expect(httpError.url).toBe(`${API_BASE}userstories/1`);
            }
        });

        it("produces a message that names the status and url but leaks no stack/fs path", async () => {
            fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, statusText: "Server Error" }));

            try {
                await httpGet("userstories");
                throw new Error("expected rejection");
            } catch (error) {
                const httpError = error as HttpError;
                expect(httpError.name).toBe("HttpError");
                expect(httpError.message).toBe(
                    `HTTP 500 Server Error for ${API_BASE}userstories`,
                );
                expect(httpError.message).not.toMatch(/\/(?:home|root|tmp|Users)\//);
            }
        });
    });

    describe("network failures", () => {
        it("propagates a fetch rejection unchanged (not wrapped in HttpError)", async () => {
            const networkError = new TypeError("Failed to fetch");
            fetchMock.mockRejectedValueOnce(networkError);

            await expect(httpGet("userstories")).rejects.toBe(networkError);
        });
    });

    describe("abort signal", () => {
        it("forwards a caller-supplied AbortSignal to fetch", async () => {
            const controller = new AbortController();
            await request("GET", "userstories", { signal: controller.signal });
            expect(callArgs().init.signal).toBe(controller.signal);
        });
    });

    describe("security & safety", () => {
        it("preserves HTML/script in an error body as an inert string (no DOM execution)", async () => {
            const payload = "<script>window.__pwned = true;</script>";
            fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, body: payload }));

            try {
                await httpGet("userstories");
            } catch (error) {
                const httpError = error as HttpError;
                expect(typeof httpError.body).toBe("string");
                expect(httpError.body).toBe(payload);
            }
            expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
        });

        it("does not pollute Object.prototype from a malicious JSON response", async () => {
            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: '{"__proto__":{"polluted":true},"legit":1}' }),
            );

            const res = await httpGet<{ legit: number }>("userstories");
            expect(res.data.legit).toBe(1);
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        });

        it("logs nothing to the console (no session/token leakage) on success or error", async () => {
            const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
                jest.spyOn(console, method).mockImplementation(() => undefined),
            );

            await httpGet("userstories");

            fetchMock.mockResolvedValueOnce(mockResponse({ status: 500 }));
            await expect(httpGet("userstories")).rejects.toBeInstanceOf(HttpError);

            for (const spy of spies) {
                expect(spy).not.toHaveBeenCalled();
            }
        });
    });

    // The React `fetch` path re-implements the AngularJS global interceptors
    // that it would otherwise bypass (QA finding [ERR-2]). These assert the
    // behavior end-to-end with spy hooks injected via `setInterceptorHooks`.
    describe("interceptor integration ([ERR-2])", () => {
        it("recovers a 401 by refreshing the token and retrying the ORIGINAL request", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));

            // 1) original GET → 401; 2) POST auth/refresh → new tokens;
            // 3) retried GET (with new Bearer) → 200 with the real payload.
            fetchMock
                .mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }))
                .mockResolvedValueOnce(
                    mockResponse({
                        body: JSON.stringify({ auth_token: "new-access", refresh: "new-refresh" }),
                    }),
                )
                .mockResolvedValueOnce(mockResponse({ body: '{"id":42}' }));

            const res = await httpGet<{ id: number }>("userstories/42");

            expect(res.status).toBe(200);
            expect(res.data).toEqual({ id: 42 });
            expect(fetchMock).toHaveBeenCalledTimes(3);

            // The refresh call hit the correct endpoint.
            expect(callArgs(1).url).toBe(`${API_BASE}auth/refresh`);
            expect(callArgs(1).init.method).toBe("POST");

            // The RETRY carried the refreshed bearer token, and the shared
            // session was updated so AngularJS sees the new token too.
            expect(sentHeaders(2)["Authorization"]).toBe("Bearer new-access");
            expect(getToken()).toBe("new-access");
        });

        it("redirects to login (onSessionExpired) and CLEARS the stale session when a 401 cannot be refreshed", async () => {
            // A (now invalid) access token is present from beforeEach, but NO
            // refresh token is stored → refresh is impossible.
            expect(getToken()).toBe(TOKEN);
            const onSessionExpired = jest.fn();
            setInterceptorHooks({ onSessionExpired });

            fetchMock.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));

            await expect(httpGet("userstories")).rejects.toBeInstanceOf(HttpError);
            // No refresh token → NO extra fetch; the session-expired hook fired.
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(onSessionExpired).toHaveBeenCalledTimes(1);
            expect(typeof onSessionExpired.mock.calls[0][0]).toBe("string");
            // The stale credentials were cleared BEFORE redirect, mirroring the
            // AngularJS `removeUser()` that precedes the login redirect — so a
            // lingering invalid token can no longer provoke repeat 401s.
            expect(getToken()).toBeNull();
        });

        it("does NOT attempt recovery for a 401 on the refresh endpoint itself", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));
            const onSessionExpired = jest.fn();
            setInterceptorHooks({ onSessionExpired });

            fetchMock.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));

            await expect(httpPost("auth/refresh", { refresh: "x" })).rejects.toBeInstanceOf(HttpError);
            // Not recovery-eligible: exactly one call, no redirect, no loop.
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(onSessionExpired).not.toHaveBeenCalled();
        });

        it("fires onBlocked for a 451 response before throwing", async () => {
            const onBlocked = jest.fn();
            setInterceptorHooks({ onBlocked });

            fetchMock.mockResolvedValueOnce(
                mockResponse({ status: 451, statusText: "Unavailable For Legal Reasons" }),
            );

            await expect(httpGet("userstories")).rejects.toBeInstanceOf(HttpError);
            expect(onBlocked).toHaveBeenCalledTimes(1);
        });

        it("fires onOffline and RE-THROWS the same error on a network failure", async () => {
            const onOffline = jest.fn();
            setInterceptorHooks({ onOffline });

            const networkError = new TypeError("Failed to fetch");
            fetchMock.mockRejectedValueOnce(networkError);

            await expect(httpGet("userstories")).rejects.toBe(networkError);
            expect(onOffline).toHaveBeenCalledTimes(1);
            expect(onOffline.mock.calls[0][0]).toBe(networkError);
        });

        it("leaves a normal 2xx request completely untouched (no hook fires)", async () => {
            const onOffline = jest.fn();
            const onBlocked = jest.fn();
            const onSessionExpired = jest.fn();
            setInterceptorHooks({ onOffline, onBlocked, onSessionExpired });

            fetchMock.mockResolvedValueOnce(mockResponse({ body: '{"ok":true}' }));
            await httpGet("userstories");

            expect(onOffline).not.toHaveBeenCalled();
            expect(onBlocked).not.toHaveBeenCalled();
            expect(onSessionExpired).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    // [W1-1] Optimistic-concurrency (version) conflict discrimination. The FROZEN
    // backend OCC mixin raises WrongArguments({"version": "..."}) which extends
    // BadRequest -> HTTP 400 (NOT 409); the 400 body is the raw {"version": "..."}
    // detail dict (taiga-back taiga/projects/occ/mixins.py L65 +
    // taiga/base/exceptions.py BaseException.status_code / format_exception).
    // isVersionConflict must recognize that 400+version shape AND still tolerate a
    // literal 409 defensively, while rejecting every other error.
    describe("isVersionConflict ([W1-1] OCC 400/409)", () => {
        it("returns true for the real contract: HTTP 400 with a `version` body", () => {
            const err = new HttpError(
                400,
                "Bad Request",
                { version: "The version doesn't match with the current one" },
                `${API_BASE}userstories/1000`,
            );
            expect(isVersionConflict(err)).toBe(true);
        });

        it("returns true for a literal 409 (defensive, contract may change)", () => {
            const err = new HttpError(409, "Conflict", null, `${API_BASE}userstories/1000`);
            expect(isVersionConflict(err)).toBe(true);
        });

        it("returns false for a 400 whose body has NO `version` key", () => {
            const err = new HttpError(
                400,
                "Bad Request",
                { __all__: ["A different validation problem"] },
                `${API_BASE}userstories/1000`,
            );
            expect(isVersionConflict(err)).toBe(false);
        });

        it("returns false for a 400 with a null body", () => {
            const err = new HttpError(400, "Bad Request", null, `${API_BASE}userstories/1000`);
            expect(isVersionConflict(err)).toBe(false);
        });

        it("returns false for a 400 with a non-object (string) body", () => {
            const err = new HttpError(400, "Bad Request", "plain text", `${API_BASE}userstories/1000`);
            expect(isVersionConflict(err)).toBe(false);
        });

        it("returns false for other statuses (e.g. 500) even if a version body is present", () => {
            const err = new HttpError(
                500,
                "Server Error",
                { version: "irrelevant" },
                `${API_BASE}userstories/1000`,
            );
            expect(isVersionConflict(err)).toBe(false);
        });

        it("returns false for non-HttpError values (plain Error, string, null, undefined)", () => {
            expect(isVersionConflict(new Error("boom"))).toBe(false);
            expect(isVersionConflict("nope")).toBe(false);
            expect(isVersionConflict(null)).toBe(false);
            expect(isVersionConflict(undefined)).toBe(false);
            expect(isVersionConflict({ status: 400, body: { version: "x" } })).toBe(false);
        });
    });
});
