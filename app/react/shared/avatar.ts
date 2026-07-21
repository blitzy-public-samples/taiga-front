/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/avatar.ts — deterministic user-avatar resolution for the migrated
 * React Kanban + Backlog screens (F-VIS-01).
 *
 * WHY THIS EXISTS
 *   Taiga users normally have NO uploaded `photo`. Instead the shell renders a
 *   DETERMINISTIC coloured identicon: one of five avatar images painted on one
 *   of five background colours, both chosen by hashing the user's
 *   `gravatar_id`. The render-only `CardAssignedTo` leaf previously fell back to
 *   the flat gray `unnamed.png` placeholder whenever `photo` was null, so every
 *   assigned card showed an identical gray circle instead of the baseline's
 *   coloured identicon.
 *
 * FAITHFUL PORT (behaviour preserved EXACTLY — AAP §0.7.1)
 *   This module is a byte-for-byte port of the three AngularJS pieces that
 *   produced the identicon:
 *     - `app/modules/services/avatar.service.coffee`   (AvatarService.getAvatar /
 *       getDefault / getUnnamed — the branch structure below mirrors it exactly)
 *     - `app/js/murmurhash3_gc.js`                      ({@link murmurhash3_32_gc})
 *     - `app/coffee/utils.coffee:199` `_.cartesianProduct(IMAGES, COLORS)`
 *       (whose `reduceRight` ordering makes the IMAGE vary fastest inside each
 *       COLOUR block, i.e. `logos[idx] = [ IMAGES[idx % 5], COLORS[idx / 5] ]`)
 *
 *   The resulting mapping was validated 10/10 against the LIVE AngularJS shell
 *   for the project-3 members (admin → user-avatar-02, Begoña Flores →
 *   user-avatar-01, Virginia Castro → user-avatar-05, …), so React cards now
 *   match the committed AngularJS baseline pixel-for-pixel.
 *
 * PURE / TESTABLE
 *   No React, no JSX, no fetch, no immer. Everything here is a pure function of
 *   its inputs plus `window._version` / `window.taigaConfig` / `location`
 *   (all read defensively so the module is safe under jsdom in unit tests).
 *
 * Toolchain: TypeScript 5.4.5 (`strict`), Node v16.19.1 compatible.
 */

import type { AssignedUser } from './types';
import { getConfig } from './session';

/* ========================================================================== *
 * murmurhash3_32_gc — verbatim port of `app/js/murmurhash3_gc.js`
 * ========================================================================== *
 *
 * JS Implementation of MurmurHash3 (r136) (as of May 20, 2011), by Gary Court,
 * ported to TypeScript. Preserved operation-for-operation — including the
 * intentional `case` fall-through in the tail-mixing switch — so the 32-bit
 * hash matches the AngularJS shell for identical inputs. `key` is treated as an
 * ASCII string and `seed` is a positive integer (the shell always passes 42).
 */
export function murmurhash3_32_gc(key: string, seed: number): number {
    const remainder: number = key.length & 3; // key.length % 4
    const bytes: number = key.length - remainder;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    let h1: number = seed;
    let h1b: number;
    let k1: number;
    let i = 0;

    while (i < bytes) {
        k1 =
            (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;

        k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1b = ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff;
        h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16);
    }

    k1 = 0;

    // Tail bytes: cases 3 and 2 intentionally fall through to case 1, which does
    // the single k1 mix. This mirrors the reference implementation exactly.
    switch (remainder) {
        case 3:
            k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        // falls through
        case 2:
            k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        // falls through
        case 1:
            k1 ^= key.charCodeAt(i) & 0xff;

            k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
            h1 ^= k1;
    }

    h1 ^= key.length;

    h1 ^= h1 >>> 16;
    h1 = ((h1 & 0xffff) * 0x85ebca6b + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 13;
    h1 = ((h1 & 0xffff) * 0xc2b2ae35 + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
}

/* ========================================================================== *
 * Identicon image + colour tables (from `avatar.service.coffee`)
 * ========================================================================== */

/**
 * The five identicon image FILENAMES, in the exact order the AngularJS
 * `AvatarService` declared them. Prefixed at resolution time with
 * `${window._version}/images/user-avatars/` (the versioned asset root the Gulp
 * `dist/` build emits, mirroring the `IMAGES` array in the service).
 */
export const AVATAR_IMAGE_FILENAMES: readonly string[] = [
    'user-avatar-01.png',
    'user-avatar-02.png',
    'user-avatar-03.png',
    'user-avatar-04.png',
    'user-avatar-05.png',
];

/**
 * The five identicon background COLOURS, in the exact order the AngularJS
 * `AvatarService` declared them. The COLOUR VALUES are identical to the source
 * (`rgba( 178, 176, 204, 1 )` …); the only change is cosmetic — the inner
 * spaces have been removed (`rgba(178, 176, 204, 1)`) so the string is accepted
 * by the strict CSSOM parser (jsdom, some minifiers) as well as every browser.
 * The RENDERED colour is bit-for-bit identical (both forms normalise to
 * `rgb(178, 176, 204)` via `getComputedStyle`), so visual fidelity is preserved.
 * Applied to the avatar `<img>` as its `background-color`.
 */
export const AVATAR_COLORS: readonly string[] = [
    'rgba(178, 176, 204, 1)',
    'rgba(183, 203, 131, 1)',
    'rgba(210, 198, 139, 1)',
    'rgba(214, 161, 212, 1)',
    'rgba(247, 154, 154, 1)',
];

/**
 * The murmurhash seed the AngularJS `AvatarService.getDefault` uses. Kept as a
 * named constant so the port reads exactly like the source.
 */
const AVATAR_HASH_SEED = 42;

/** Number of identicon (image × colour) permutations = 5 × 5 = 25. */
const LOGO_COUNT = AVATAR_IMAGE_FILENAMES.length * AVATAR_COLORS.length;

/** A resolved default identicon: which image file, and its background colour. */
export interface DefaultAvatar {
    /** The identicon image FILENAME (e.g. `"user-avatar-02.png"`). */
    file: string;
    /** The identicon background colour, as an `rgba(...)` string. */
    color: string;
}

/**
 * Port of `AvatarService.getDefault(key)`.
 *
 * `idx = murmurhash3_32_gc(key, 42) % 25`, then index into the 25-entry
 * `cartesianProduct(IMAGES, COLORS)` table. Because that product is built with
 * `_.reduceRight`, the IMAGE varies fastest within each COLOUR block, which is
 * equivalent to `file = IMAGES[idx % 5]`, `color = COLORS[floor(idx / 5)]`.
 *
 * @param key The user's `gravatar_id` (an MD5 hex string).
 * @returns The deterministic identicon image file + background colour.
 */
export function getDefaultAvatar(key: string): DefaultAvatar {
    const idx = murmurhash3_32_gc(key, AVATAR_HASH_SEED) % LOGO_COUNT;
    const file = AVATAR_IMAGE_FILENAMES[idx % AVATAR_IMAGE_FILENAMES.length];
    const color = AVATAR_COLORS[Math.floor(idx / AVATAR_IMAGE_FILENAMES.length)];
    return { file, color };
}

/* ========================================================================== *
 * getUserAvatar — port of `AvatarService.getAvatar`
 * ========================================================================== */

/** The resolved avatar shape consumed by the render-only card leaf. */
export interface ResolvedUserAvatar {
    /** Image URL to place in `<img src>`. */
    url: string;
    /**
     * Background colour for the `<img>` (`rgba(...)`), or `undefined` when no
     * identicon colour applies (uploaded photo, or the unnamed placeholder).
     */
    bg: string | undefined;
    /** The user's display name (`full_name_display`), or `''` when unknown. */
    fullName: string;
}

/**
 * The versioned asset root prefix (e.g. `"v-1784591002693"`), read from
 * `window._version` exactly as the AngularJS `IMAGES` array did. Falls back to
 * `''` so URLs resolve to `images/…` under jsdom / when the global is absent.
 */
function assetVersion(): string {
    return (typeof window !== 'undefined' && (window as { _version?: string })._version) || '';
}

/** The shared `unnamed.png` placeholder — port of `AvatarService.getUnnamed`. */
function getUnnamed(fullName: string): ResolvedUserAvatar {
    return { url: `${assetVersion()}/images/unnamed.png`, bg: undefined, fullName };
}

/**
 * `true` when the page is served from a `localhost` host, mirroring the
 * AngularJS service's `location.host.indexOf('localhost') != -1` check. Guarded
 * for non-DOM contexts.
 */
function isLocalhost(): boolean {
    return typeof location !== 'undefined' && location.host.indexOf('localhost') !== -1;
}

/**
 * `true` when Gravatar CDN avatars are enabled. Mirrors the service's
 * `@config.get("gravatar", true)` — DEFAULTS TO TRUE when the key is absent.
 * Read through the `TaigaConfig` index signature (typed `unknown`), so it is
 * narrowed defensively here.
 */
function gravatarEnabled(): boolean {
    const value = (getConfig() as { gravatar?: unknown }).gravatar;
    return typeof value === 'boolean' ? value : true;
}

/**
 * Build the absolute asset root `protocol//host + baseHref`, matching the
 * AngularJS service's `location.protocol + '//' + location.host +
 * @config.get('baseHref')`. Used only for the Gravatar-CDN `d=` fallback URL.
 */
function absoluteRoot(): string {
    const baseHref = getConfig().baseHref ?? '/';
    const proto = typeof location !== 'undefined' ? location.protocol : 'http:';
    const host = typeof location !== 'undefined' ? location.host : 'localhost';
    return `${proto}//${host}${baseHref}`;
}

/**
 * Resolve a user's avatar exactly as the AngularJS `AvatarService.getAvatar`
 * did (the `'photo'` param; the `'avatarBig'` variant is unused on the board).
 *
 * Branch structure (identical to the source):
 *   1. No user                          → `unnamed.png` (no bg).
 *   2. No `gravatar_id`                  → `unnamed.png` (no bg).
 *   3. Uploaded `photo`                  → that photo (no bg).
 *   4. localhost OR gravatar disabled    → LOCAL identicon image + bg colour.
 *   5. gravatar enabled (non-localhost)  → gravatar.com URL, with the local
 *                                          identicon as the `d=` default, + bg.
 *
 * In this POC the stack is served from `localhost` with `gravatar: false`, so
 * branch 4 (the local coloured identicon) applies — matching the baseline.
 *
 * @param user The assigned user (or `null`/`undefined`).
 * @returns The resolved `{ url, bg, fullName }` for the avatar `<img>`.
 */
export function getUserAvatar(user: AssignedUser | null | undefined): ResolvedUserAvatar {
    if (!user) {
        return getUnnamed('');
    }

    const fullName = user.full_name_display || '';
    // `gravatar_id` is a first-class optional field on AssignedUser; `photo` is
    // `string | null | undefined`.
    const gravatar = user.gravatar_id;
    const photo = user.photo;

    // Branch 2: without a gravatar_id the shell shows the unnamed placeholder.
    if (!gravatar) {
        return getUnnamed(fullName);
    }

    // Branch 3: an explicitly uploaded photo wins (no identicon colour).
    if (photo) {
        return { url: photo, bg: undefined, fullName };
    }

    // Branches 4 & 5 both compute the local identicon first.
    const logo = getDefaultAvatar(gravatar);
    const localSrc = `${assetVersion()}/images/user-avatars/${logo.file}`;

    // Branch 4: localhost OR gravatar disabled → serve the local identicon
    // directly (relative, versioned — resolves against `<base href>`, matching
    // the existing card's `unnamed.png` convention).
    if (isLocalhost() || !gravatarEnabled()) {
        return { url: localSrc, bg: logo.color, fullName };
    }

    // Branch 5: gravatar enabled on a real host → hit gravatar.com, passing the
    // ABSOLUTE local identicon as the `d=` (default) image, exactly as the
    // service did. The identicon colour is still applied as the background.
    const absoluteLocal = encodeURIComponent(`${absoluteRoot()}${localSrc}`);
    return {
        url: `https://www.gravatar.com/avatar/${gravatar}?s=200&d=${absoluteLocal}`,
        bg: logo.color,
        fullName,
    };
}
