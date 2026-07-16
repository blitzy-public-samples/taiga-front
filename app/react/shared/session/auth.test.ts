/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    clearSession,
    getRefreshToken,
    getToken,
    setRefreshToken,
    setToken,
} from "./auth";

describe("shared/session/auth", () => {
    beforeEach(() => {
        // clearMocks:true (jest.config.js) resets mock fns only, NOT storage.
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    describe("getToken", () => {
        it("JSON-decodes the token stored by $tgStorage (strips the quotes)", () => {
            // AngularJS $tgStorage.set JSON-encodes:
            // localStorage.setItem("token", JSON.stringify(val))
            window.localStorage.setItem("token", JSON.stringify("jwt-123"));

            expect(getToken()).toBe("jwt-123");
        });

        it("does NOT return the raw JSON-encoded value (that would corrupt Bearer)", () => {
            window.localStorage.setItem("token", JSON.stringify("jwt-xyz"));

            const raw = window.localStorage.getItem("token");
            expect(raw).toBe('"jwt-xyz"'); // stored WITH quotes
            expect(getToken()).toBe("jwt-xyz"); // decoded WITHOUT quotes
            expect(getToken()).not.toBe(raw);
        });

        it("returns null when no token is stored", () => {
            expect(getToken()).toBeNull();
        });

        it("returns null when the stored value is corrupt (invalid JSON)", () => {
            window.localStorage.setItem("token", "not-valid-json{");

            expect(getToken()).toBeNull();
        });

        it("returns null defensively when localStorage access throws", () => {
            const spy = jest
                .spyOn(Storage.prototype, "getItem")
                .mockImplementation(() => {
                    throw new Error("localStorage is unavailable");
                });

            expect(getToken()).toBeNull();

            spy.mockRestore();
        });
    });

    describe("getRefreshToken", () => {
        it("JSON-decodes the refresh token stored under 'refresh'", () => {
            window.localStorage.setItem("refresh", JSON.stringify("refresh-abc"));

            expect(getRefreshToken()).toBe("refresh-abc");
        });

        it("returns null when no refresh token is stored", () => {
            expect(getRefreshToken()).toBeNull();
        });
    });

    // Session WRITES — used only by the React-side 401 refresh flow to keep the
    // SHARED AngularJS session in sync (React fetch bypasses the ng interceptor).
    describe("setToken / setRefreshToken (round-trip via $tgStorage encoding)", () => {
        it("JSON-encodes the token so it round-trips through getToken and $tgStorage.get", () => {
            setToken("new-jwt");

            // Stored WITH quotes (matches $tgStorage.set), decoded WITHOUT.
            expect(window.localStorage.getItem("token")).toBe('"new-jwt"');
            expect(getToken()).toBe("new-jwt");
        });

        it("JSON-encodes the refresh token symmetrically", () => {
            setRefreshToken("new-refresh");

            expect(window.localStorage.getItem("refresh")).toBe('"new-refresh"');
            expect(getRefreshToken()).toBe("new-refresh");
        });

        it("overwrites a previously stored token", () => {
            window.localStorage.setItem("token", JSON.stringify("old"));
            setToken("rotated");
            expect(getToken()).toBe("rotated");
        });

        it("is a best-effort no-op when localStorage.setItem throws", () => {
            const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new Error("quota exceeded");
            });
            expect(() => setToken("x")).not.toThrow();
            spy.mockRestore();
        });
    });

    describe("clearSession", () => {
        it("removes token, refresh AND userInfo (mirrors removeUser + refresh removal)", () => {
            window.localStorage.setItem("token", JSON.stringify("t"));
            window.localStorage.setItem("refresh", JSON.stringify("r"));
            window.localStorage.setItem("userInfo", JSON.stringify({ id: 5 }));

            clearSession();

            expect(window.localStorage.getItem("token")).toBeNull();
            expect(window.localStorage.getItem("refresh")).toBeNull();
            expect(window.localStorage.getItem("userInfo")).toBeNull();
            expect(getToken()).toBeNull();
            expect(getRefreshToken()).toBeNull();
        });

        it("is a best-effort no-op when localStorage.removeItem throws", () => {
            const spy = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
                throw new Error("unavailable");
            });
            expect(() => clearSession()).not.toThrow();
            spy.mockRestore();
        });
    });
});
