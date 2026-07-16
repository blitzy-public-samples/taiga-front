/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    buildEmojiMap,
    emojiEntryToUnicode,
    emojify,
    getEmojiMap,
    type EmojiEntry,
} from "../emojify";

describe("emoji/emojify", () => {
    const SAMPLE: EmojiEntry[] = [
        { id: "1f604", name: "smile", image: "1f604.png" },
        { id: "1f44d", name: "+1", image: "1f44d.png" },
        { id: "0023-20e3", name: "hash", image: "0023-20e3.png" },
        { id: "path", name: "heart", image: "/v-123/emojis/2764.png" },
        { id: "uni", name: "star", unicode: "\u2b50" },
    ];

    afterEach(() => {
        // Reset any window.emojis override so the memoized reader re-reads.
        delete (window as unknown as { emojis?: unknown }).emojis;
        // Force cache invalidation by reading once with the cleared source.
        getEmojiMap();
    });

    describe("emojiEntryToUnicode", () => {
        it("derives a single-codepoint emoji from the image filename", () => {
            expect(emojiEntryToUnicode({ name: "smile", image: "1f604.png" })).toBe("😄");
        });

        it("derives a multi-codepoint (keycap) emoji from a hyphenated filename", () => {
            expect(emojiEntryToUnicode({ name: "hash", image: "0023-20e3.png" })).toBe("\u0023\u20e3");
        });

        it("strips a directory prefix before parsing the stem", () => {
            expect(emojiEntryToUnicode({ name: "heart", image: "/v-123/emojis/2764.png" })).toBe("\u2764");
        });

        it("prefers an explicit unicode field over the image filename", () => {
            expect(emojiEntryToUnicode({ name: "star", image: "ignored.png", unicode: "\u2b50" })).toBe("\u2b50");
        });

        it("returns null for a non-codepoint image name", () => {
            expect(emojiEntryToUnicode({ name: "weird", image: "not-hex.png" })).toBeNull();
        });

        it("returns null when neither unicode nor image is present", () => {
            expect(emojiEntryToUnicode({ name: "empty" })).toBeNull();
        });
    });

    describe("buildEmojiMap", () => {
        it("maps shortcode names to unicode, skipping invalid entries", () => {
            const map = buildEmojiMap([
                ...SAMPLE,
                { name: "bad", image: "zzz.png" },
                { name: "", image: "1f600.png" },
            ]);
            expect(map).toEqual({
                smile: "😄",
                "+1": "👍",
                hash: "\u0023\u20e3",
                heart: "\u2764",
                star: "\u2b50",
            });
            expect(map).not.toHaveProperty("bad");
        });

        it("returns an empty map for undefined/null input", () => {
            expect(buildEmojiMap(undefined)).toEqual({});
            expect(buildEmojiMap(null)).toEqual({});
        });
    });

    describe("emojify (with injected map)", () => {
        const map = buildEmojiMap(SAMPLE);

        it("replaces a known shortcode with its unicode character", () => {
            expect(emojify("hello :smile:", map)).toBe("hello 😄");
        });

        it("replaces multiple shortcodes in one string", () => {
            expect(emojify(":smile: and :heart:", map)).toBe("😄 and \u2764");
        });

        it("handles shortcodes containing + and - characters", () => {
            expect(emojify("nice :+1:", map)).toBe("nice 👍");
        });

        it("leaves unknown shortcodes untouched", () => {
            expect(emojify("what :unknown: is this", map)).toBe("what :unknown: is this");
        });

        it("returns the input unchanged when there is no colon", () => {
            expect(emojify("plain subject", map)).toBe("plain subject");
        });

        it("never emits HTML — output is plain text", () => {
            const out = emojify(":smile: <script>", map);
            expect(out).toBe("😄 <script>");
            expect(out).not.toContain("<img");
        });

        it("is a no-op when the map is empty", () => {
            expect(emojify(":smile:", {})).toBe(":smile:");
        });
    });

    describe("getEmojiMap / emojify (via window.emojis)", () => {
        it("returns an empty map when window.emojis is absent", () => {
            expect(getEmojiMap()).toEqual({});
            expect(emojify(":smile:")).toBe(":smile:");
        });

        it("reads and memoizes window.emojis, rebuilding when the source changes", () => {
            (window as unknown as { emojis?: EmojiEntry[] }).emojis = SAMPLE;
            expect(getEmojiMap().smile).toBe("😄");
            expect(emojify("hi :smile:")).toBe("hi 😄");

            // Swapping the source array identity rebuilds the map lazily.
            (window as unknown as { emojis?: EmojiEntry[] }).emojis = [
                { name: "smile", image: "1f603.png" },
            ];
            expect(getEmojiMap().smile).toBe("😃");
        });
    });
});
