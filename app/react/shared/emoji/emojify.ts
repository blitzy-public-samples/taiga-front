/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Safe emoji-shortcode → unicode transform.
 *
 * The AngularJS Backlog rendered user-story subjects through the `emojify`
 * filter (`us.subject | emojify`, backlog-row.jade / sprint.jade), which called
 * `$tgEmojis.replaceEmojiNameByHtmlImgs()` to swap `:shortcode:` tokens for
 * `<img>` tags pointing at the emoji sprite PNGs (common/emojis.coffee). That
 * approach injected HTML and depended on the emoji image assets.
 *
 * The React migration deliberately renders subjects as plain, auto-escaped text
 * (never `dangerouslySetInnerHTML`) — an XSS-safety improvement — but that
 * dropped emoji rendering entirely, so `:smile:` showed up literally (QA finding
 * [T]). This module restores emoji parity WITHOUT reintroducing any HTML: it
 * maps each `:shortcode:` to the corresponding unicode emoji CHARACTER and
 * returns a plain string, which React then escapes as ordinary text.
 *
 * The shortcode → unicode map is derived from the very same `window.emojis`
 * dataset the AngularJS shell loads (so shortcode coverage is identical): each
 * entry's `image` filename encodes the emoji's unicode code point(s) in hex
 * (e.g. `1f604.png` → U+1F604 😄, `0023-20e3.png` → U+0023 U+20E3 "#⃣"). When
 * `window.emojis` is unavailable (jsdom unit tests, or a host that has not loaded
 * the dataset) the transform is a safe no-op that returns the input unchanged.
 *
 * This module is pure TypeScript: no React, no DOM writes, no network I/O.
 */

/**
 * Shape of a single entry in the shared `window.emojis` dataset (common/
 * emojis.coffee consumes `{ id, name, image }`; some builds also carry a
 * precomputed `unicode` string, which is honored when present).
 */
export interface EmojiEntry {
    /** Stable id (e.g. the hex code point string); unused by the transform. */
    id?: string;
    /** Shortcode name WITHOUT the surrounding colons, e.g. `"smile"`. */
    name: string;
    /** Sprite filename whose stem encodes the unicode code point(s) in hex. */
    image?: string;
    /** Optional precomputed unicode string; preferred over `image` when set. */
    unicode?: string;
}

declare global {
    interface Window {
        emojis?: EmojiEntry[];
    }
}

/**
 * Matches an emoji shortcode token `:name:`. The inner character class mirrors
 * the AngularJS source regex `/:([\w +-]*):/g` (word chars, space, `+`, `-`) so
 * the exact same set of shortcodes is recognized.
 */
const SHORTCODE_RE = /:([\w +-]+):/g;

/**
 * Derive the unicode string for a single emoji entry.
 *
 * Prefers an explicit `unicode` field. Otherwise parses the `image` filename
 * stem: strip any directory and the `.png`/`.svg` extension, split on `-`, and
 * interpret each segment as a hex code point. Returns `null` when no valid code
 * point can be derived (so non-codepoint image names are safely skipped).
 */
export function emojiEntryToUnicode(entry: EmojiEntry): string | null {
    if (typeof entry.unicode === "string" && entry.unicode.length > 0) {
        return entry.unicode;
    }

    const image = entry.image;
    if (typeof image !== "string" || image.length === 0) {
        return null;
    }

    // Keep only the filename stem: drop directories and the extension.
    const fileName = image.split("/").pop() ?? image;
    const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
    if (stem.length === 0) {
        return null;
    }

    const segments = stem.split("-");
    const codePoints: number[] = [];
    for (const segment of segments) {
        // Every segment MUST be a valid hex code point in the Unicode range,
        // otherwise the whole entry is rejected (defensive: never emit garbage).
        if (!/^[0-9a-f]+$/i.test(segment)) {
            return null;
        }
        const codePoint = Number.parseInt(segment, 16);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
            return null;
        }
        codePoints.push(codePoint);
    }

    if (codePoints.length === 0) {
        return null;
    }

    try {
        return String.fromCodePoint(...codePoints);
    } catch {
        return null;
    }
}

/**
 * Build a `shortcode → unicode` lookup from an emoji dataset. Pure and
 * dependency-free, so it is directly unit-testable with an injected fixture.
 * Entries whose unicode cannot be derived are skipped.
 */
export function buildEmojiMap(emojis: readonly EmojiEntry[] | undefined | null): Record<string, string> {
    const map: Record<string, string> = {};
    if (!emojis) {
        return map;
    }
    for (const entry of emojis) {
        if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
            continue;
        }
        const unicode = emojiEntryToUnicode(entry);
        if (unicode !== null) {
            map[entry.name] = unicode;
        }
    }
    return map;
}

// Memoize the derived map, keyed by the `window.emojis` array identity so a late
// dataset load (or a test override) rebuilds the map lazily on next use.
let cachedSource: EmojiEntry[] | undefined;
let cachedMap: Record<string, string> = {};

/**
 * Lazily read `window.emojis` and return the memoized `shortcode → unicode` map.
 * Returns an empty map when `window` / `window.emojis` is unavailable, which
 * makes {@link emojify} a safe no-op in jsdom tests and on hosts without the
 * dataset.
 */
export function getEmojiMap(): Record<string, string> {
    const source = typeof window !== "undefined" ? window.emojis : undefined;
    if (source !== cachedSource) {
        cachedSource = source;
        cachedMap = buildEmojiMap(source);
    }
    return cachedMap;
}

/**
 * Replace `:shortcode:` tokens in `text` with their unicode emoji characters.
 *
 * Unknown shortcodes are left untouched. The result is a PLAIN STRING intended
 * to be rendered as auto-escaped React text — it NEVER contains HTML, so it is
 * XSS-safe by construction. When `map` is omitted the shared `window.emojis`
 * map is used; passing a `map` explicitly makes the function fully deterministic
 * for unit tests.
 *
 * @param text the raw subject/text to transform
 * @param map  optional shortcode → unicode lookup (defaults to {@link getEmojiMap})
 * @returns the text with recognized shortcodes replaced by unicode emoji
 */
export function emojify(text: string, map?: Record<string, string>): string {
    if (typeof text !== "string" || text.length === 0 || text.indexOf(":") === -1) {
        return text;
    }
    const lookup = map ?? getEmojiMap();
    // Fast exit when there is nothing to substitute with.
    let hasAny = false;
    for (const _key in lookup) {
        hasAny = true;
        break;
    }
    if (!hasAny) {
        return text;
    }
    return text.replace(SHORTCODE_RE, (whole, name: string) => {
        const replacement = lookup[name];
        return replacement !== undefined ? replacement : whole;
    });
}
