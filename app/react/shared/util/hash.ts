/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Dependency-free SHA-1 + `generateHash`, a faithful port of the AngularJS
 * client's global helpers so the React screens compute IDENTICAL storage keys.
 *
 * Parity contract
 * ---------------
 *   - `taiga.generateHash` (app/coffee/app.coffee L15-L17):
 *         generateHash(components) = hex_sha1(components.map(JSON.stringify).join(":"))
 *   - `hex_sha1` (app/js/sha1-custom.js): the pajhome SHA-1 with `chrsz = 8`
 *     (one byte per input char, i.e. `charCodeAt(i) & 0xff`). For ASCII input
 *     — which every key here is (numeric project id + the ASCII suffix
 *     "backlog-custom-filters") — this is byte-for-byte standard SHA-1.
 *
 * This matters because the custom-filter feature persists to the shared
 * `/api/v1/user-storage/{hash}` endpoint (see `shared/api/userStorage.ts`): a
 * divergent hash would strand filters a user saved from the AngularJS backlog
 * before migration, and would prevent the React screen from reading its own
 * previously-saved filters after a reload. Keeping the algorithm identical
 * guarantees full data continuity across the coexisting frameworks.
 *
 * The implementation is intentionally allocation-light and self-contained (no
 * Node `crypto`, no `SubtleCrypto`) so it runs identically under the esbuild
 * browser bundle and the jsdom Jest environment.
 */

/** 32-bit left rotate. */
function rotl(value: number, shift: number): number {
    return (value << shift) | (value >>> (32 - shift));
}

/**
 * Compute the lowercase hex SHA-1 digest of `input`, treating each character as
 * a single byte (`charCodeAt & 0xff`) to mirror the legacy `chrsz = 8` config.
 */
export function hexSha1(input: string): string {
    // 1. Encode to bytes (one byte per char, matching the legacy `chrsz = 8`).
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i += 1) {
        bytes.push(input.charCodeAt(i) & 0xff);
    }

    // 2. Pad: append 0x80, then zeros until length ≡ 56 (mod 64), then the
    //    64-bit big-endian bit length.
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }
    const hi = Math.floor(bitLength / 0x100000000);
    const lo = bitLength >>> 0;
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

    // 3. Initialize the five working registers (FIPS PUB 180-1).
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;

    const w = new Array<number>(80);

    // 4. Process each 512-bit (64-byte) block.
    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            const j = offset + i * 4;
            w[i] =
                ((bytes[j] << 24) |
                    (bytes[j + 1] << 16) |
                    (bytes[j + 2] << 8) |
                    bytes[j + 3]) >>>
                0;
        }
        for (let i = 16; i < 80; i += 1) {
            w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;

        for (let i = 0; i < 80; i += 1) {
            let f: number;
            let k: number;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
            e = d;
            d = c;
            c = rotl(b, 30) >>> 0;
            b = a;
            a = temp;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }

    // 5. Emit the digest as 40 lowercase hex characters.
    return [h0, h1, h2, h3, h4].map(toHex8).join("");
}

/** Format a 32-bit unsigned integer as 8 lowercase hex digits (big-endian). */
function toHex8(n: number): string {
    let out = "";
    for (let i = 7; i >= 0; i -= 1) {
        out += ((n >>> (i * 4)) & 0xf).toString(16);
    }
    return out;
}

/**
 * Port of `taiga.generateHash` (app/coffee/app.coffee L15-L17): JSON-encode each
 * component, join with ":", and hash. Argument/output are byte-identical to the
 * AngularJS helper for ASCII components.
 */
export function generateHash(components: readonly unknown[] = []): string {
    return hexSha1(components.map((c) => JSON.stringify(c)).join(":"));
}
