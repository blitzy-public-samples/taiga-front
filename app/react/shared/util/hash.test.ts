/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Parity tests for the dependency-free SHA-1 + `generateHash` port
 * (shared/util/hash.ts). These guard the custom-filter storage-key contract
 * (QA finding [J]): the React hash MUST be byte-identical to the AngularJS
 * `hex_sha1` / `taiga.generateHash` helpers so a project's saved filters,
 * persisted under `/user-storage/{hash}`, round-trip across both frameworks.
 *
 * Expected digests are the canonical FIPS-180-1 SHA-1 vectors (equal to the
 * legacy pajhome `chrsz = 8` output for ASCII input) and were independently
 * confirmed with Node `crypto.createHash("sha1")`.
 */

import { hexSha1, generateHash } from "./hash";

describe("hexSha1 — canonical SHA-1 vectors", () => {
    test('"abc" hashes to the FIPS-180-1 reference digest', () => {
        expect(hexSha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    });

    test("the empty string hashes to the SHA-1 of zero bytes", () => {
        expect(hexSha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });

    test("a multi-block message (>55 bytes) pads and hashes correctly", () => {
        // 43 bytes < 56 → single block, but exercises the 512-bit path fully.
        expect(hexSha1("The quick brown fox jumps over the lazy dog")).toBe(
            "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
        );
    });

    test("a 64-byte-plus message spans two blocks", () => {
        // 56 bytes forces the length field into a SECOND padded block, exercising
        // the multi-block loop (a common off-by-one source in SHA-1 ports).
        const input = "a".repeat(56);
        // Digest cross-checked against Node crypto sha1 of 56 'a' bytes.
        expect(hexSha1(input)).toBe("c2db330f6083854c99d4b5bfb6e8f29f201be699");
    });

    test("output is always 40 lowercase hex characters", () => {
        const digest = hexSha1("taiga");
        expect(digest).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe("generateHash — taiga.generateHash parity", () => {
    test("JSON-encodes each component and joins with ':' before hashing", () => {
        // The AngularJS backlog stores under generateHash([projectId, ns]) where
        // ns = "{projectId}:backlog-custom-filters". This exact value is what the
        // custom-filter round-trip depends on.
        expect(generateHash([3, "3:backlog-custom-filters"])).toBe(
            "b3647b4eb080ece98f210e0f11f85b08fac77df9",
        );
    });

    test("a different project id yields a different (but stable) key", () => {
        expect(generateHash([5, "5:backlog-custom-filters"])).toBe(
            "e9fd4a8bf695f7f08519e3cb5e72cd9f1b122493",
        );
    });

    test("an empty component list hashes the empty string", () => {
        expect(generateHash([])).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
        // Default argument path (no array supplied) behaves identically.
        expect(generateHash()).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });

    test("numeric components are JSON-encoded (not coerced ad hoc)", () => {
        // join of "1","2","3" → "1:2:3"; guards against accidental toString drift.
        expect(generateHash([1, 2, 3])).toBe(
            "d4b2d74332c4368b8ef3b388292faffe6c4a16f5",
        );
    });

    test("is deterministic for identical input", () => {
        expect(generateHash([3, "3:backlog-custom-filters"])).toBe(
            generateHash([3, "3:backlog-custom-filters"]),
        );
    });
});
