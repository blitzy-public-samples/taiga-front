/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Proves the local SHA-1 / `generateHash` reproduces the AngularJS
 * `taiga.generateHash` byte-for-byte (finding M5), so the React hooks address
 * the SAME localStorage entries the legacy screens wrote. The reference hashes
 * were computed independently with Python's `hashlib.sha1` over
 * `components.map(JSON.stringify).join(":")`.
 */
import { sha1Hex, generateHash } from "./legacyStorage";

describe("sha1Hex — standard vectors", () => {
    it("hashes the empty string", () => {
        expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });

    it('hashes "abc"', () => {
        expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    });

    it("hashes a 56-byte input (block-boundary padding path)", () => {
        // Exactly 448 bits forces an extra padding block — exercises the
        // multi-chunk loop.
        expect(sha1Hex("a".repeat(56))).toBe("c2db330f6083854c99d4b5bfb6e8f29f201be699");
    });
});

describe("generateHash — legacy resource key parity", () => {
    it("matches taiga.generateHash for the kanban status-column-modes key", () => {
        expect(generateHash([1, "1:kanban-statuscolumnmodels"])).toBe(
            "701708451c2dd9d89035f23e76568ce51c7b77b8",
        );
    });

    it("matches taiga.generateHash for the kanban swimlanes-modes key", () => {
        expect(generateHash([1, "1:kanban-swimlanesmodels"])).toBe(
            "8769d68c61a77a42597e5215c7f305c50391cb4a",
        );
    });

    it("matches taiga.generateHash for the kanban status-view-modes key", () => {
        expect(generateHash([1, "1:kanban-statusviewmodels"])).toBe(
            "ae24392fa456407519009417a01e4bf4fb3ab041",
        );
    });

    it("JSON-encodes each component (a numeric id is not the same as its string form)", () => {
        // JSON.stringify(1) === "1" but JSON.stringify("1") === '"1"', so the
        // number/string distinction must survive into the hash input.
        expect(generateHash([1])).not.toBe(generateHash(["1"]));
    });
});
