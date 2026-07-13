/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readLiveToken, readStoredRefresh, clearStoredSession } from "./token";

describe("shared/auth/token — readLiveToken (M8 live credential accessor / C4 authoritative logout)", () => {
    afterEach(() => {
        localStorage.clear();
    });

    it("prefers the LIVE localStorage token over the mount snapshot (token refresh)", () => {
        // The snapshot is the OLD token; a refresh wrote a NEW token to storage.
        localStorage.setItem("token", JSON.stringify("fresh-jwt"));
        expect(readLiveToken({ token: "stale-snapshot-jwt" })).toBe("fresh-jwt");
    });

    it("reads the JSON-encoded ($tgStorage) localStorage token", () => {
        localStorage.setItem("token", JSON.stringify("ls-jwt"));
        expect(readLiveToken({ token: null })).toBe("ls-jwt");
    });

    // ---- Finding C4: localStorage is AUTHORITATIVE when available. ----
    // The surviving AngularJS auth layer clears the stored token on logout /
    // refresh-failure, so its absence (or a malformed value) means "logged out".
    // The stale mount snapshot MUST NOT resurrect a discarded credential, even
    // though the test passes one via `context.token`.

    it("C4: returns null (authoritative logout) when localStorage has no token — never the snapshot", () => {
        expect(readLiveToken({ token: "snapshot-jwt" })).toBeNull();
    });

    it("C4: treats a garbage (non-JSON) stored token as authoritative logout (null), not the snapshot", () => {
        localStorage.setItem("token", "{not-json");
        expect(readLiveToken({ token: "snapshot" })).toBeNull();
    });

    it("C4: treats a non-string stored value as authoritative logout (null), not the snapshot", () => {
        localStorage.setItem("token", JSON.stringify({ nested: true }));
        expect(readLiveToken({ token: "snapshot" })).toBeNull();
    });

    it("C4: treats an empty-string stored token as authoritative logout (null), not the snapshot", () => {
        localStorage.setItem("token", JSON.stringify(""));
        expect(readLiveToken({ token: "snapshot" })).toBeNull();
    });

    it("returns null when neither a live nor a snapshot token exists", () => {
        expect(readLiveToken({ token: null })).toBeNull();
    });

    it("uses the snapshot ONLY when localStorage is entirely unavailable (non-DOM host)", () => {
        // Simulate a host without a storage API (e.g. SSR / bare Node context):
        // with no authoritative store to consult, the mount snapshot is the sole
        // credential source — the single legitimate fallback path.
        const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).localStorage;
        try {
            expect(readLiveToken({ token: "snapshot-only" })).toBe("snapshot-only");
            expect(readLiveToken({ token: null })).toBeNull();
        } finally {
            if (original) {
                Object.defineProperty(globalThis, "localStorage", original);
            }
        }
    });
});

describe("shared/auth/token — readStoredRefresh (C3 single-flight refresh source)", () => {
    afterEach(() => {
        localStorage.clear();
    });

    it("reads the JSON-encoded ($tgStorage) refresh token", () => {
        localStorage.setItem("refresh", JSON.stringify("refresh-abc"));
        expect(readStoredRefresh()).toBe("refresh-abc");
    });

    it("returns null when the refresh token is absent", () => {
        expect(readStoredRefresh()).toBeNull();
    });

    it("returns null for a malformed / non-string / empty refresh value", () => {
        localStorage.setItem("refresh", "{not-json");
        expect(readStoredRefresh()).toBeNull();
        localStorage.setItem("refresh", JSON.stringify({ nested: true }));
        expect(readStoredRefresh()).toBeNull();
        localStorage.setItem("refresh", JSON.stringify(""));
        expect(readStoredRefresh()).toBeNull();
    });
});

describe("shared/auth/token — clearStoredSession (C3 logout teardown)", () => {
    afterEach(() => {
        localStorage.clear();
    });

    it("removes token, userInfo and refresh (mirrors the legacy errorToken teardown)", () => {
        localStorage.setItem("token", JSON.stringify("t"));
        localStorage.setItem("userInfo", JSON.stringify({ id: 1 }));
        localStorage.setItem("refresh", JSON.stringify("r"));

        clearStoredSession();

        expect(localStorage.getItem("token")).toBeNull();
        expect(localStorage.getItem("userInfo")).toBeNull();
        expect(localStorage.getItem("refresh")).toBeNull();
        // After clearing, the accessor reports the authoritative logged-out state.
        expect(readLiveToken({ token: "stale" })).toBeNull();
    });

    it("is a no-op that does not throw when nothing is stored", () => {
        expect(() => clearStoredSession()).not.toThrow();
    });
});
