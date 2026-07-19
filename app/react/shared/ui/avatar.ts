/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * React port of the AngularJS `AvatarService` (app/modules/services/avatar.service.coffee).
 *
 * The service resolves a `{ url, bg }` avatar for a user, reproducing the exact
 * deterministic default-avatar selection the AngularJS client used so the React
 * screens render the SAME colored placeholder avatars as the surviving Angular
 * chrome (a zero-tolerance visual-fidelity requirement, AAP §0.3.4).
 *
 * Selection algorithm (verbatim port):
 *   - A user with a `photo` uses that photo directly.
 *   - Otherwise, when there is no photo but a `gravatar_id`, the client is on
 *     localhost (or gravatar is disabled), so a DEFAULT avatar is chosen from a
 *     fixed pool of 25 combinations — the cartesian product of 5 avatar images
 *     and 5 background colors — indexed by `murmurhash3_32_gc(gravatar_id, 42) % 25`.
 *   - A user without a `gravatar_id` (or no user at all) uses the "unnamed" avatar.
 *
 * The AngularJS `_.cartesianProduct(IMAGES, COLORS)` (utils.coffee, a `reduceRight`
 * over the argument arrays) produces the pool ordered COLOR-outer / IMAGE-inner, so
 * `logos[idx] === [IMAGES[idx % 5], COLORS[Math.floor(idx / 5)]]`. This module
 * reproduces that ordering exactly (verified against the running AngularJS build).
 */

import type { BaseUser } from "../../kanban/useKanbanState";

/**
 * JS implementation of MurmurHash3 (r136), verbatim from
 * app/js/murmurhash3_gc.js (Gary Court, 2011). Retained bit-for-bit so the
 * default-avatar index matches the AngularJS client's for every gravatar id.
 *
 * @param key ASCII-only string to hash.
 * @param seed Positive integer seed.
 * @returns 32-bit unsigned integer hash.
 */
export function murmurhash3_32_gc(key: string, seed: number): number {
    let remainder: number;
    let bytes: number;
    let h1: number;
    let h1b: number;
    let k1: number;
    let i: number;

    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;

    remainder = key.length & 3; // key.length % 4
    bytes = key.length - remainder;
    h1 = seed;
    i = 0;

    while (i < bytes) {
        k1 =
            (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;

        k1 =
            ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
            0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 =
            ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
            0xffffffff;

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1b =
            ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) &
            0xffffffff;
        h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16);
    }

    k1 = 0;

    switch (remainder) {
        case 3:
            k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        // falls through
        case 2:
            k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        // falls through
        case 1:
            k1 ^= key.charCodeAt(i) & 0xff;

            k1 =
                ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) &
                0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 =
                ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) &
                0xffffffff;
            h1 ^= k1;
    }

    h1 ^= key.length;

    h1 ^= h1 >>> 16;
    h1 =
        ((h1 & 0xffff) * 0x85ebca6b +
            ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) &
        0xffffffff;
    h1 ^= h1 >>> 13;
    h1 =
        ((h1 & 0xffff) * 0xc2b2ae35 +
            ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) &
        0xffffffff;
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
}

/** A resolved avatar: an image URL and an optional background color. */
export interface ResolvedAvatar {
    /** Avatar image URL. */
    url: string;
    /** Background color behind a transparent default avatar (undefined for real photos). */
    bg?: string;
}

/**
 * The five default avatar image basenames, in the AngularJS `IMAGES` order.
 * Version-prefixed lazily by {@link versionPrefix} so the served, hashed asset
 * path resolves identically to `AvatarService`'s `#{window._version}/images/...`.
 */
const DEFAULT_AVATAR_IMAGES = [
    "images/user-avatars/user-avatar-01.png",
    "images/user-avatars/user-avatar-02.png",
    "images/user-avatars/user-avatar-03.png",
    "images/user-avatars/user-avatar-04.png",
    "images/user-avatars/user-avatar-05.png",
];

/** The five background colors, in the AngularJS `COLORS` order. */
const DEFAULT_AVATAR_COLORS = [
    "rgba( 178, 176, 204, 1 )",
    "rgba( 183, 203, 131, 1 )",
    "rgba( 210, 198, 139, 1 )",
    "rgba( 214, 161, 212, 1 )",
    "rgba( 247, 154, 154, 1 )",
];

/**
 * Resolve the `window._version` prefix (e.g. `"v-1712345678/"`). Mirrors the
 * approach in {@link module:kanban/Card unnamedAvatarUrl}: production sets
 * `window._version`; when absent (jsdom unit tests, or a doc-root that already
 * IS the versioned directory) we fall back to a version-less relative path,
 * which resolves to the same served asset.
 */
function versionPrefix(): string {
    const version =
        typeof window !== "undefined"
            ? (window as unknown as { _version?: unknown })._version
            : undefined;
    return typeof version === "string" && version.length > 0
        ? `${version}/`
        : "";
}

/** The "unnamed" fallback avatar URL (ports `AvatarService.getUnnamed`). */
export function unnamedAvatarUrl(): string {
    return `${versionPrefix()}images/unnamed.png`;
}

/**
 * Select the deterministic DEFAULT avatar for a gravatar id (ports
 * `AvatarService.getDefault`): `idx = murmurhash3_32_gc(key, 42) % 25`, then
 * `logos[idx] = [IMAGES[idx % 5], COLORS[floor(idx / 5)]]`.
 */
function getDefaultAvatar(gravatarId: string): { src: string; color: string } {
    const total = DEFAULT_AVATAR_IMAGES.length * DEFAULT_AVATAR_COLORS.length; // 25
    const idx = murmurhash3_32_gc(gravatarId, 42) % total;
    return {
        src: DEFAULT_AVATAR_IMAGES[idx % DEFAULT_AVATAR_IMAGES.length],
        color: DEFAULT_AVATAR_COLORS[
            Math.floor(idx / DEFAULT_AVATAR_IMAGES.length)
        ],
    };
}

/**
 * Resolve a user's avatar `{ url, bg }` (ports `AvatarService.getAvatar`, the
 * localhost/gravatar-disabled branch that the Taiga dev/self-hosted stack uses):
 *
 *   - no user, or no `gravatar_id` -> the "unnamed" avatar (no bg);
 *   - a `photo` -> that photo (no bg);
 *   - otherwise -> the deterministic default avatar image + its bg color.
 */
export function resolveUserAvatar(user: BaseUser | undefined | null): ResolvedAvatar {
    if (!user) {
        return { url: unnamedAvatarUrl() };
    }
    const gravatar =
        typeof user.gravatar_id === "string" ? user.gravatar_id : "";
    const photo = typeof user.photo === "string" ? user.photo : "";
    if (!gravatar) {
        return { url: unnamedAvatarUrl() };
    }
    if (photo) {
        return { url: photo };
    }
    const logo = getDefaultAvatar(gravatar);
    return { url: `${versionPrefix()}${logo.src}`, bg: logo.color };
}
