/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * avatar — React 18 port of the AngularJS `tgAvatarService` (+ `tg-avatar`
 * directive) used to resolve a user's avatar image.
 *
 * The legacy `tg-avatar` directive [avatar.directive.coffee] simply calls
 * `avatarService.getAvatar(user, 'avatar')` and wires the result onto the
 * `<img>` (`src`, `title`, `alt`, `background`). This module reproduces
 * `AvatarService` [app/modules/services/avatar.service.coffee] faithfully so the
 * React filter/user surfaces render a REAL avatar (a user photo, a gravatar, or
 * a deterministic local placeholder) instead of a broken `<img src="">`.
 *
 * Fidelity notes:
 *   - The placeholder selection uses MurmurHash3 (Gary Court's r136 impl), ported
 *     verbatim from `app/js/murmurhash3_gc.js`, so a given `gravatar_id` resolves
 *     to the SAME image+color it did under AngularJS.
 *   - The 5 images x 5 colors "cartesian product" ordering is reproduced exactly:
 *     the legacy `_.cartesianProduct(IMAGES, COLORS)` [utils.coffee:199] yields
 *     `logos[idx] = [IMAGES[idx % 5], COLORS[floor(idx / 5)]]`.
 *   - Runtime config is read through the shared `config.ts` adapter
 *     (`gravatar`, `baseHref`) and the `window._version` cache-busting prefix —
 *     the same globals the AngularJS app uses — preserving the globals-only
 *     coexistence boundary (no AngularJS/CoffeeScript import).
 */

import { getConfigValue } from './config';

/**
 * JS implementation of MurmurHash3 (r136), Copyright (c) 2011 Gary Court.
 * Ported VERBATIM from `app/js/murmurhash3_gc.js` so the placeholder-avatar
 * selection is byte-for-byte identical to the AngularJS client.
 *
 * @param key - ASCII string to hash.
 * @param seed - Positive integer seed.
 * @returns 32-bit positive integer hash.
 */
export function murmurhash3_32_gc(key: string, seed: number): number {
  let h1b: number;
  let k1: number;

  const remainder = key.length & 3; // key.length % 4
  const bytes = key.length - remainder;
  let h1 = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
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

/** Minimal user shape consumed by {@link getAvatar}; extra fields are ignored. */
export interface AvatarUser {
  gravatar_id?: string | null;
  photo?: string | null;
  big_photo?: string | null;
  username?: string | null;
  full_name_display?: string | null;
  [key: string]: unknown;
}

/** Resolved avatar, mirroring `AvatarService.getAvatar`'s return shape. */
export interface ResolvedAvatar {
  url: string;
  username: string;
  fullName?: string;
  bg?: string;
}

/** Cache-busting version prefix (the `window._version` global the app sets). */
function version(): string {
  return String((window as unknown as { _version?: string })._version ?? '');
}

/** The five local placeholder avatar images, versioned like the legacy service. */
function images(): string[] {
  const v = version();
  return [
    `${v}/images/user-avatars/user-avatar-01.png`,
    `${v}/images/user-avatars/user-avatar-02.png`,
    `${v}/images/user-avatars/user-avatar-03.png`,
    `${v}/images/user-avatars/user-avatar-04.png`,
    `${v}/images/user-avatars/user-avatar-05.png`,
  ];
}

/** The five placeholder background colors (verbatim from the legacy service). */
const COLORS: ReadonlyArray<string> = [
  'rgba( 178, 176, 204, 1 )',
  'rgba( 183, 203, 131, 1 )',
  'rgba( 210, 198, 139, 1 )',
  'rgba( 214, 161, 212, 1 )',
  'rgba( 247, 154, 154, 1 )',
];

/** Total placeholder combinations (5 images x 5 colors). */
const LOGO_COUNT = 25;

/** The `getUnnamed()` fallback: a neutral local image and empty username. */
export function getUnnamed(): ResolvedAvatar {
  return { url: `${version()}/images/unnamed.png`, username: '' };
}

/**
 * Deterministic local placeholder for a given key (the user's `gravatar_id`).
 * Reproduces `AvatarService.getDefault`: hash the key, index into the cartesian
 * `logos` list where `logos[idx] = [IMAGES[idx % 5], COLORS[floor(idx / 5)]]`.
 */
export function getDefault(key: string): { src: string; color: string } {
  const idx = murmurhash3_32_gc(key, 42) % LOGO_COUNT;
  return { src: images()[idx % 5], color: COLORS[Math.floor(idx / 5)] };
}

/**
 * Resolve a user's avatar. Faithful port of `AvatarService.getAvatar`.
 *
 * Resolution order (identical to the legacy):
 *   1. no user OR no `gravatar_id` -> {@link getUnnamed}.
 *   2. an explicit `photo` (or `big_photo` when `type === 'avatarBig'`) -> that URL.
 *   3. on localhost OR when the `gravatar` config flag is disabled -> a local
 *      deterministic placeholder (see {@link getDefault}).
 *   4. otherwise -> a gravatar.com URL with the local placeholder as the `d=` fallback.
 *
 * @param user - The user record (or null/undefined).
 * @param type - `'avatar'` (default) or `'avatarBig'`.
 */
export function getAvatar(
  user: AvatarUser | null | undefined,
  type: 'avatar' | 'avatarBig' = 'avatar',
): ResolvedAvatar {
  if (!user) {
    return getUnnamed();
  }

  const avatarParamName = type === 'avatarBig' ? 'big_photo' : 'photo';
  const gravatar = user.gravatar_id;
  const photo = user[avatarParamName] as string | null | undefined;
  const username = `@${user.username}`;
  const fullName = user.full_name_display ?? undefined;

  if (!gravatar) {
    return getUnnamed();
  }

  if (photo) {
    return { url: photo, username, fullName };
  }

  // Reproduce `location.protocol + '//' + location.host + @config.get('baseHref')`
  // EXACTLY. The legacy `ConfigurationService.get` defaults an absent key to
  // `null`, and CoffeeScript's `+` concatenation coerces that to the literal
  // string "null"; a JS template-literal interpolation of `null` coerces the
  // same way, so passing the legacy `null` default preserves byte-parity in the
  // (in practice never-hit) case where `baseHref` is unset. Real configs always
  // carry `baseHref` (e.g. "/"), so `root` is normally e.g. "http://host/".
  const baseHref = getConfigValue<string | null>('baseHref', null);
  const root = `${location.protocol}//${location.host}${baseHref}`;
  const logo = getDefault(gravatar);

  if (location.host.indexOf('localhost') !== -1 || !getConfigValue('gravatar', true)) {
    return { url: root + logo.src, bg: logo.color, username, fullName };
  }

  const logoUrl = encodeURIComponent(root + logo.src);
  return {
    url: `https://www.gravatar.com/avatar/${gravatar}?s=200&d=${logoUrl}`,
    bg: logo.color,
    username,
    fullName,
  };
}
