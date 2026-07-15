/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * avatar.test.ts — Jest unit spec for the React port of the AngularJS
 * `tgAvatarService` / `tg-avatar` directive (`../avatar`). Part of the AngularJS
 * 1.5.10 -> React 18 coexistence migration; counts toward the >=70% line-coverage
 * gate over `app/react/**`.
 *
 * Isolation: jsdom only — NO Playwright, NO browser, NO network. The behavioral
 * origin (avatar.service.coffee) and the verbatim MurmurHash3 source
 * (app/js/murmurhash3_gc.js) are reproduced from memory, never imported. The
 * murmurhash reference vectors below were computed from the ORIGINAL JS to prove
 * byte-for-byte parity of the placeholder-avatar selection.
 */

import {
  murmurhash3_32_gc,
  getUnnamed,
  getDefault,
  getAvatar,
  type AvatarUser,
} from '../avatar';

/* Globals the port reads (same globals-only boundary the AngularJS app uses). */
const w = window as unknown as { taigaConfig?: unknown; _version?: string };
let prevConfig: unknown;
let prevVersion: string | undefined;
let prevLocation: Location;

beforeEach(() => {
  prevConfig = w.taigaConfig;
  prevVersion = w._version;
  prevLocation = window.location;
  // Deterministic defaults for most cases: a fixed version and a "/" baseHref.
  w._version = 'v-123';
  w.taigaConfig = { baseHref: '/' };
});

afterEach(() => {
  w.taigaConfig = prevConfig;
  w._version = prevVersion;
  Object.defineProperty(window, 'location', { configurable: true, value: prevLocation });
});

/** Override window.location.host/protocol for the non-localhost branch. */
function setLocation(protocol: string, host: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { protocol, host } as unknown as Location,
  });
}

/* ------------------------------------------------------------------------------------------
 * murmurhash3_32_gc — verbatim port; reference vectors from the ORIGINAL JS
 * ---------------------------------------------------------------------------------------- */

describe('murmurhash3_32_gc', () => {
  it('matches reference hashes computed from the original implementation (seed 42)', () => {
    expect(murmurhash3_32_gc('', 42)).toBe(142593372);
    expect(murmurhash3_32_gc('abc', 42)).toBe(1313807976);
    expect(murmurhash3_32_gc('alice-hash', 42)).toBe(1314980630);
    expect(murmurhash3_32_gc('gravatar123', 42)).toBe(3586173634);
  });

  it('is deterministic and returns an unsigned 32-bit integer', () => {
    const a = murmurhash3_32_gc('taiga', 42);
    const b = murmurhash3_32_gc('taiga', 42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('exercises every string-length remainder (0/1/2/3 bytes past the last 4-byte block)', () => {
    // Lengths 4,5,6,7 -> remainders 0,1,2,3. Just assert determinism / integer output.
    ['abcd', 'abcde', 'abcdef', 'abcdefg'].forEach((k) => {
      const h = murmurhash3_32_gc(k, 42);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBe(murmurhash3_32_gc(k, 42));
    });
  });
});

/* ------------------------------------------------------------------------------------------
 * getUnnamed / getDefault — versioned local placeholder selection
 * ---------------------------------------------------------------------------------------- */

describe('getUnnamed', () => {
  it('returns the versioned unnamed.png with an empty username', () => {
    expect(getUnnamed()).toEqual({ url: 'v-123/images/unnamed.png', username: '' });
  });

  it('uses an empty version prefix when window._version is unset', () => {
    delete (window as unknown as { _version?: string })._version;
    expect(getUnnamed()).toEqual({ url: '/images/unnamed.png', username: '' });
  });
});

describe('getDefault', () => {
  it('selects image = IMAGES[idx % 5] and color = COLORS[floor(idx / 5)] for idx = hash % 25', () => {
    // 'abc' -> hash 1313807976 -> idx 1 -> IMAGES[1] (user-avatar-02), COLORS[0].
    expect(getDefault('abc')).toEqual({
      src: 'v-123/images/user-avatars/user-avatar-02.png',
      color: 'rgba( 178, 176, 204, 1 )',
    });

    // 'gravatar123' -> hash 3586173634 -> idx 9 -> IMAGES[4] (user-avatar-05), COLORS[1].
    expect(getDefault('gravatar123')).toEqual({
      src: 'v-123/images/user-avatars/user-avatar-05.png',
      color: 'rgba( 183, 203, 131, 1 )',
    });
  });

  it('is deterministic for a given key', () => {
    expect(getDefault('taiga')).toEqual(getDefault('taiga'));
  });
});

/* ------------------------------------------------------------------------------------------
 * getAvatar — full resolution order (faithful to AvatarService.getAvatar)
 * ---------------------------------------------------------------------------------------- */

describe('getAvatar', () => {
  it('returns getUnnamed() when no user is supplied', () => {
    expect(getAvatar(null)).toEqual({ url: 'v-123/images/unnamed.png', username: '' });
    expect(getAvatar(undefined)).toEqual({ url: 'v-123/images/unnamed.png', username: '' });
  });

  it('returns getUnnamed() when the user has no gravatar_id (even if a photo exists)', () => {
    const user: AvatarUser = { photo: 'p.png', username: 'bob', full_name_display: 'Bob' };
    expect(getAvatar(user)).toEqual({ url: 'v-123/images/unnamed.png', username: '' });
  });

  it('returns the photo URL directly when both gravatar_id and photo are present', () => {
    const user: AvatarUser = {
      gravatar_id: 'g1',
      photo: 'alice.png',
      username: 'alice',
      full_name_display: 'Alice Anderson',
    };
    expect(getAvatar(user)).toEqual({
      url: 'alice.png',
      username: '@alice',
      fullName: 'Alice Anderson',
    });
  });

  it('uses big_photo when type is "avatarBig"', () => {
    const user: AvatarUser = {
      gravatar_id: 'g1',
      photo: 'small.png',
      big_photo: 'big.png',
      username: 'alice',
    };
    expect(getAvatar(user, 'avatarBig').url).toBe('big.png');
  });

  it('returns a LOCAL placeholder (root + logo.src, bg) on localhost with no photo', () => {
    // jsdom default host is "localhost" -> the localhost branch is taken.
    const user: AvatarUser = { gravatar_id: 'gravatar123', username: 'x', full_name_display: 'X' };
    const result = getAvatar(user);

    // root = "http://localhost" + baseHref("/") ; logo.src is the deterministic placeholder.
    expect(result.url).toBe('http://localhost/v-123/images/user-avatars/user-avatar-05.png');
    expect(result.bg).toBe('rgba( 183, 203, 131, 1 )');
    expect(result.username).toBe('@x');
    expect(result.fullName).toBe('X');
  });

  it('builds a gravatar.com URL (with local placeholder fallback) off-localhost when gravatar is enabled', () => {
    setLocation('https:', 'taiga.example.com');
    w.taigaConfig = { baseHref: '/', gravatar: true };

    const user: AvatarUser = { gravatar_id: 'gravatar123', username: 'x' };
    const result = getAvatar(user);

    const expectedFallback = encodeURIComponent(
      'https://taiga.example.com/v-123/images/user-avatars/user-avatar-05.png',
    );
    expect(result.url).toBe(
      `https://www.gravatar.com/avatar/gravatar123?s=200&d=${expectedFallback}`,
    );
    expect(result.bg).toBe('rgba( 183, 203, 131, 1 )');
    expect(result.username).toBe('@x');
  });

  it('forces the LOCAL branch off-localhost when the gravatar config flag is false', () => {
    setLocation('https:', 'taiga.example.com');
    w.taigaConfig = { baseHref: '/', gravatar: false };

    const user: AvatarUser = { gravatar_id: 'gravatar123', username: 'x' };
    const result = getAvatar(user);

    expect(result.url).toBe(
      'https://taiga.example.com/v-123/images/user-avatars/user-avatar-05.png',
    );
    // Not a gravatar.com URL.
    expect(result.url).not.toContain('gravatar.com');
  });

  it('reproduces the legacy baseHref default: an ABSENT baseHref coerces to the literal "null"', () => {
    // No baseHref key -> getConfigValue('baseHref', null) -> null -> template coerces to "null",
    // exactly as CoffeeScript's `location.host + @config.get('baseHref')` did.
    w.taigaConfig = { gravatar: false };
    const user: AvatarUser = { gravatar_id: 'gravatar123', username: 'x' };
    const result = getAvatar(user);
    // logo.src carries NO leading slash (avatar images use `${_version}/...`), so with
    // the coerced "null" baseHref the segments abut: "...localhostnull" + "v-123/...".
    expect(result.url).toBe(
      'http://localhostnullv-123/images/user-avatars/user-avatar-05.png',
    );
  });
});
