/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Legacy-compatible localStorage key derivation (finding M5).
 *
 * The AngularJS screens persisted per-project UI preferences (Kanban column
 * folds + swimlane folds, Backlog tag filters / velocity / burndown fold /
 * closed-sprint fold) under keys derived by `taiga.generateHash`
 * (`app/coffee/app.coffee`):
 *
 *   hex_sha1( components.map(JSON.stringify).join(":") )
 *
 * and stored the JSON-encoded value via `$tgStorage.set`
 * (`app/coffee/modules/base/storage.coffee` → `localStorage.setItem(key,
 * JSON.stringify(value))`). The resource providers namespaced each preference
 * with `"<projectId>:<suffix>"` (e.g. `$tgKanbanResourcesProvider`:
 * `kanban-statuscolumnmodels` / `kanban-swimlanesmodels`).
 *
 * The first React implementation invented fresh `taiga.react.*` keys, which
 * would strand every preference a user had already saved from the stock
 * AngularJS screen. Reproducing the exact hash + JSON-encoding here lets the
 * React hooks read and write the SAME entries, preserving continuity across the
 * framework migration (AAP §0.6.4: "fold and zoom preferences continue to
 * persist in localStorage"; Minimal Change Clause).
 *
 * SHA-1 is implemented locally (no new dependency, Node-16 constraint) over the
 * UTF-8 byte sequence of the input, byte-identical to the classic `hex_sha1`
 * for the ASCII keys used here.
 */

/** Encode a JS string to its UTF-8 byte sequence (handles the full BMP + astral planes). */
function utf8Bytes(str: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < str.length; i += 1) {
        const c = str.charCodeAt(i);
        if (c < 0x80) {
            out.push(c);
        } else if (c < 0x800) {
            out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c < 0xdc00) {
            // High surrogate: combine with the following low surrogate.
            const c2 = str.charCodeAt(i + 1);
            i += 1;
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
            out.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f),
            );
        } else {
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    return out;
}

/** 32-bit left rotate (unsigned). */
function rotl(n: number, s: number): number {
    return ((n << s) | (n >>> (32 - s))) >>> 0;
}

/** Unsigned 32-bit addition of any number of operands. */
function add32(...nums: number[]): number {
    let acc = 0;
    for (const n of nums) {
        acc = (acc + n) >>> 0;
    }
    return acc;
}

/** SHA-1 of a string (UTF-8), returned as 40 lowercase hex characters. */
export function sha1Hex(message: string): string {
    const bytes = utf8Bytes(message);
    const bitLen = bytes.length * 8;

    // Padding: append 0x80, then 0x00 until length ≡ 56 (mod 64).
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }
    // Append the 64-bit big-endian message length (bits). Inputs here are tiny,
    // so the high 32 bits are derived defensively via division rather than a
    // 32-bit shift (which would overflow for large inputs).
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push(
        (hi >>> 24) & 0xff,
        (hi >>> 16) & 0xff,
        (hi >>> 8) & 0xff,
        hi & 0xff,
        (lo >>> 24) & 0xff,
        (lo >>> 16) & 0xff,
        (lo >>> 8) & 0xff,
        lo & 0xff,
    );

    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;

    const w = new Array<number>(80);
    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
        for (let i = 0; i < 16; i += 1) {
            const j = chunk + i * 4;
            w[i] =
                ((bytes[j] << 24) |
                    (bytes[j + 1] << 16) |
                    (bytes[j + 2] << 8) |
                    bytes[j + 3]) >>>
                0;
        }
        for (let i = 16; i < 80; i += 1) {
            w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
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
            const temp = add32(rotl(a, 5), f >>> 0, e, k, w[i]);
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }

        h0 = add32(h0, a);
        h1 = add32(h1, b);
        h2 = add32(h2, c);
        h3 = add32(h3, d);
        h4 = add32(h4, e);
    }

    const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

/**
 * Reproduce `taiga.generateHash(components)`: JSON-encode each component, join
 * with ":", and SHA-1 the result. Used to derive the exact localStorage keys
 * the legacy resource providers wrote.
 */
export function generateHash(components: ReadonlyArray<unknown>): string {
    return sha1Hex(components.map((c) => JSON.stringify(c)).join(":"));
}
