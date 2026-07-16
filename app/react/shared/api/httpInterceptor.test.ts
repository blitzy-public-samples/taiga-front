/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Unit suite for the HTTP interceptor policy that re-implements the AngularJS
// global interceptors bypassed by the React `fetch` path (QA finding [ERR-2]):
// 401 token-refresh + coalescing, login-redirect URL building (jsdom-safe
// no-op navigation), 451/offline hook dispatch, and the injectable policy.
//
// Independent expectations (NOT imported from the SUT):
//   • refresh endpoint  = <api base>/auth/refresh   — resources.coffee L18
//   • login redirect    = <baseHref>/login?unauthorized=true&next=<enc>  — app.coffee L648
//   • rotated pair keys  = localStorage["token"] / ["refresh"] (JSON-encoded) — auth.coffee L129-137

import {
    BLOCKED_MESSAGE,
    OFFLINE_MESSAGE,
    buildLoginUrl,
    currentNextUrl,
    getInterceptorHooks,
    is401RecoveryEligible,
    isBrowserNavigable,
    redirectToLogin,
    refreshSession,
    resetInterceptorHooks,
    setInterceptorHooks,
} from "./httpInterceptor";
import { getRefreshToken, getToken } from "../session/auth";
import {
    clearNotificationListeners,
    subscribeNotifications,
} from "../notifications/notificationCenter";
import type { AppNotification } from "../notifications/notificationCenter";

const API_BASE = "http://localhost:8000/api/v1/";
const SESSION_ID = "session-xyz-123";

/** A minimal, `Response`-shaped stub (jsdom provides no `fetch`/`Response`). */
function mockResponse(init: { status?: number; body?: string } = {}): Response {
    const status = init.status ?? 200;
    const stub = {
        ok: status >= 200 && status < 300,
        status,
        statusText: "OK",
        headers: new Headers(),
        text: async (): Promise<string> => init.body ?? "",
    };
    return stub as unknown as Response;
}

let fetchMock: jest.Mock;

function callArgs(index = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init };
}

beforeEach(() => {
    window.localStorage.clear();
    (window as unknown as { taiga?: { sessionId?: string } }).taiga = { sessionId: SESSION_ID };
    window.taigaConfig = { api: API_BASE, defaultLanguage: "en", baseHref: "/" };

    fetchMock = jest.fn(async () => mockResponse({ body: "{}", status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
    resetInterceptorHooks();
    clearNotificationListeners();
    window.localStorage.clear();
    delete (window as unknown as { taiga?: unknown }).taiga;
    window.taigaConfig = undefined;
    jest.restoreAllMocks();
});

describe("shared/api/httpInterceptor", () => {
    describe("is401RecoveryEligible", () => {
        it("is eligible for ordinary API paths", () => {
            expect(is401RecoveryEligible("userstories")).toBe(true);
            expect(is401RecoveryEligible("projects/by_slug")).toBe(true);
            expect(is401RecoveryEligible("user-storage/abc")).toBe(true);
        });

        it("is NOT eligible for the refresh / login endpoints (no refresh loop)", () => {
            expect(is401RecoveryEligible("auth/refresh")).toBe(false);
            expect(is401RecoveryEligible("auth/login")).toBe(false);
            expect(is401RecoveryEligible("/login")).toBe(false);
        });
    });

    describe("buildLoginUrl", () => {
        it("joins the baseHref with /login and encodes the next target", () => {
            expect(buildLoginUrl("/project/foo/backlog")).toBe(
                "/login?unauthorized=true&next=%2Fproject%2Ffoo%2Fbacklog",
            );
        });

        it("honors a non-root baseHref", () => {
            window.taigaConfig = { api: API_BASE, baseHref: "/taiga/" };
            expect(buildLoginUrl("/x")).toBe("/taiga/login?unauthorized=true&next=%2Fx");
        });
    });

    describe("isBrowserNavigable / redirectToLogin", () => {
        it("reports NOT navigable under jsdom", () => {
            expect(isBrowserNavigable()).toBe(false);
        });

        it("redirectToLogin is a safe no-op under jsdom (no navigation, no throw)", () => {
            // Would emit a jsdom "not implemented" console.error if it navigated;
            // the global console guard would then fail this test.
            expect(() => redirectToLogin("/somewhere")).not.toThrow();
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("currentNextUrl", () => {
        it("returns the current path+search+hash", () => {
            window.history.pushState({}, "", "/project/p1/backlog?x=1");
            expect(currentNextUrl()).toBe("/project/p1/backlog?x=1");
            window.history.pushState({}, "", "/");
        });
    });

    describe("default interceptor hooks", () => {
        it("onOffline emits the offline message onto the notification bus", () => {
            const received: AppNotification[] = [];
            subscribeNotifications((n) => received.push(n));

            getInterceptorHooks().onOffline(new TypeError("Failed to fetch"));

            expect(received).toHaveLength(1);
            expect(received[0].level).toBe("error");
            expect(received[0].message).toBe(OFFLINE_MESSAGE);
        });

        it("onBlocked emits the blocked message onto the notification bus", () => {
            const received: AppNotification[] = [];
            subscribeNotifications((n) => received.push(n));

            getInterceptorHooks().onBlocked();

            expect(received).toHaveLength(1);
            expect(received[0].message).toBe(BLOCKED_MESSAGE);
        });

        it("onSessionExpired is a jsdom-safe no-op by default", () => {
            expect(() => getInterceptorHooks().onSessionExpired("/next")).not.toThrow();
        });
    });

    describe("setInterceptorHooks / resetInterceptorHooks", () => {
        it("overrides only the provided hooks and reset restores defaults", () => {
            const onBlocked = jest.fn();
            setInterceptorHooks({ onBlocked });

            getInterceptorHooks().onBlocked();
            expect(onBlocked).toHaveBeenCalledTimes(1);

            resetInterceptorHooks();
            // After reset the default (bus) policy is back — the spy is detached.
            getInterceptorHooks().onBlocked();
            expect(onBlocked).toHaveBeenCalledTimes(1);
        });
    });

    describe("refreshSession", () => {
        it("resolves null WITHOUT any fetch when there is no refresh token", async () => {
            const result = await refreshSession();
            expect(result).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("POSTs the refresh token and persists the rotated pair on success", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));
            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: JSON.stringify({ auth_token: "new-access", refresh: "new-refresh" }), status: 200 }),
            );

            const token = await refreshSession();

            expect(token).toBe("new-access");
            // Correct endpoint + method + body + shared-session headers, NO Authorization.
            const { url, init } = callArgs();
            expect(url).toBe(`${API_BASE}auth/refresh`);
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ refresh: "old-refresh" }));
            const headers = init.headers as Record<string, string>;
            expect(headers["X-Session-Id"]).toBe(SESSION_ID);
            expect(headers["Content-Type"]).toBe("application/json");
            expect(headers["Authorization"]).toBeUndefined();
            // Rotated pair written back to the SHARED session (JSON-encoded).
            expect(getToken()).toBe("new-access");
            expect(getRefreshToken()).toBe("new-refresh");
        });

        it("resolves null and does NOT persist when the refresh is rejected", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));
            fetchMock.mockResolvedValueOnce(mockResponse({ body: "{}", status: 401 }));

            const token = await refreshSession();

            expect(token).toBeNull();
            expect(getToken()).toBeNull();
            // The stored refresh is untouched (only the redirect path clears it).
            expect(getRefreshToken()).toBe("old-refresh");
        });

        it("resolves null when the refresh fetch itself throws (offline)", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));
            fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

            await expect(refreshSession()).resolves.toBeNull();
        });

        it("resolves null when the success body lacks an auth_token", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));
            fetchMock.mockResolvedValueOnce(mockResponse({ body: JSON.stringify({ nope: 1 }), status: 200 }));

            await expect(refreshSession()).resolves.toBeNull();
            expect(getToken()).toBeNull();
        });

        it("coalesces concurrent callers onto a single in-flight refresh", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("old-refresh"));

            let resolveFetch: (r: Response) => void = () => undefined;
            fetchMock.mockImplementationOnce(
                () =>
                    new Promise<Response>((resolve) => {
                        resolveFetch = resolve;
                    }),
            );

            const a = refreshSession();
            const b = refreshSession();
            // Both callers share ONE network request.
            expect(fetchMock).toHaveBeenCalledTimes(1);

            resolveFetch(
                mockResponse({ body: JSON.stringify({ auth_token: "shared", refresh: "r2" }), status: 200 }),
            );

            await expect(a).resolves.toBe("shared");
            await expect(b).resolves.toBe("shared");
        });

        it("allows a fresh refresh after the previous one settled", async () => {
            window.localStorage.setItem("refresh", JSON.stringify("r1"));
            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: JSON.stringify({ auth_token: "a1", refresh: "r2" }), status: 200 }),
            );
            await expect(refreshSession()).resolves.toBe("a1");

            fetchMock.mockResolvedValueOnce(
                mockResponse({ body: JSON.stringify({ auth_token: "a2", refresh: "r3" }), status: 200 }),
            );
            await expect(refreshSession()).resolves.toBe("a2");
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
