/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readLiveToken } from "./token";

describe("shared/auth/token — readLiveToken (M8 live credential accessor)", () => {
    afterEach(() => {
        localStorage.clear();
    });

    it("prefers the LIVE localStorage token over the mount snapshot (token refresh)", () => {
        // The snapshot is the OLD token; a refresh wrote a NEW token to storage.
        localStorage.setItem("token", JSON.stringify("fresh-jwt"));
        expect(readLiveToken({ token: "stale-snapshot-jwt" })).toBe("fresh-jwt");
    });

    it("falls back to the context snapshot when localStorage has no token", () => {
        expect(readLiveToken({ token: "snapshot-jwt" })).toBe("snapshot-jwt");
    });

    it("reads the JSON-encoded ($tgStorage) localStorage token", () => {
        localStorage.setItem("token", JSON.stringify("ls-jwt"));
        expect(readLiveToken({ token: null })).toBe("ls-jwt");
    });

    it("treats a garbage (non-JSON) stored token as absent and falls back", () => {
        localStorage.setItem("token", "{not-json");
        expect(readLiveToken({ token: "snapshot" })).toBe("snapshot");
    });

    it("treats a non-string stored value as absent and falls back", () => {
        localStorage.setItem("token", JSON.stringify({ nested: true }));
        expect(readLiveToken({ token: "snapshot" })).toBe("snapshot");
    });

    it("returns null when neither a live nor a snapshot token exists", () => {
        expect(readLiveToken({ token: null })).toBeNull();
    });

    it("treats an empty-string stored token as absent", () => {
        localStorage.setItem("token", JSON.stringify(""));
        expect(readLiveToken({ token: "snapshot" })).toBe("snapshot");
    });
});
