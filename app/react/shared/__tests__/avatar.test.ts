/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the deterministic avatar resolver in
 * `app/react/shared/avatar.ts` (F-VIS-01).
 *
 * WHY THIS EXISTS
 *   Taiga members almost never upload a `photo`; the shell instead paints a
 *   DETERMINISTIC coloured identicon derived from the user's `gravatar_id`. The
 *   migrated Kanban card previously omitted that branch and fell back to the
 *   flat-gray `unnamed.png` for every assigned user. This spec pins the ported
 *   `murmurhash3_32_gc` + `getDefaultAvatar` + `getUserAvatar` behaviour so it
 *   stays byte-for-byte equivalent to the AngularJS `AvatarService`
 *   (`app/modules/services/avatar.service.coffee`).
 *
 * ORACLE
 *   The expected `(image, colour)` pairs below were VALIDATED 10/10 against the
 *   live AngularJS shell for the project-3 members (`admin`, `Begoña Flores`,
 *   `Virginia Castro`, …). Any regression in the hash or the
 *   `cartesianProduct(IMAGES, COLORS)` ordering breaks these assertions.
 *
 * ISOLATION (hard requirement)
 *   Pure-function tests only: no browser-driver imports, no browser launch, no
 *   network/socket access. The only module import is the subject under test
 *   (`../avatar`). Jest globals are ambient via the root `tsconfig.json`
 *   `types: ["jest", ...]`. Runs under `npm test` (Jest only) in jsdom, whose
 *   default location host is `localhost`, so `getUserAvatar` takes the LOCAL
 *   identicon branch (matching the POC, which is served from localhost).
 */

import {
  murmurhash3_32_gc,
  getDefaultAvatar,
  getUserAvatar,
  AVATAR_IMAGE_FILENAMES,
  AVATAR_COLORS,
} from '../avatar';

/** Versioned asset root the resolver reads from `window._version`. */
const VERSION = 'v-test';

beforeEach(() => {
  (window as { _version?: string })._version = VERSION;
});

afterEach(() => {
  delete (window as { _version?: string })._version;
});

/* ========================================================================== *
 * murmurhash3_32_gc — the hash must be a stable 32-bit unsigned integer.
 * ========================================================================== */
describe('murmurhash3_32_gc', () => {
  it('is deterministic and returns a 32-bit unsigned integer for the shell seed', () => {
    const h = murmurhash3_32_gc('e64c7d89f26bd1972efa854d13d7dd61', 42);
    // Stable across calls…
    expect(murmurhash3_32_gc('e64c7d89f26bd1972efa854d13d7dd61', 42)).toBe(h);
    // …and an unsigned 32-bit integer (the reference returns `h1 >>> 0`).
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('maps the admin gravatar_id to logo index 16 (matches the live shell)', () => {
    // idx = hash % 25 → 16 → IMAGES[16 % 5] = user-avatar-02.png,
    // COLORS[floor(16 / 5)] = COLORS[3].
    expect(murmurhash3_32_gc('e64c7d89f26bd1972efa854d13d7dd61', 42) % 25).toBe(16);
  });
});

/* ========================================================================== *
 * getDefaultAvatar — the (image × colour) table lookup, validated vs the shell.
 * ========================================================================== */
describe('getDefaultAvatar', () => {
  // gravatar_id → [expected image file, expected rgba colour] (VALIDATED oracle).
  const ORACLE: ReadonlyArray<readonly [string, string, string]> = [
    ['admin', 'e64c7d89f26bd1972efa854d13d7dd61', 'user-avatar-02.png'],
    ['Begoña Flores', 'aed1e43be0f69f07ce6f34a907bc6328', 'user-avatar-01.png'],
    ['Catalina Fernandez', '9971a763f5dfc5cbd1ce1d2865b4fcfa', 'user-avatar-03.png'],
    ['Enrique Crespo', 'f31e0063c7cd6da19b6467bc48d2b14b', 'user-avatar-02.png'],
    ['Francisco Gil', '5c921c7bd676b7b4992501005d243c42', 'user-avatar-01.png'],
    ['Miguel Molina', 'dce0e8ed702cd85d5132e523121e619b', 'user-avatar-04.png'],
    ['Mohamed Ortega', '6d7e702bd6c6fc568fca7577f9ca8c55', 'user-avatar-01.png'],
    ['Vanesa Garcia', '74cb769a5e64d445b8550789e1553502', 'user-avatar-03.png'],
    ['Vanesa Torres', 'b579f05d7d36f4588b11887093e4ce44', 'user-avatar-04.png'],
    ['Virginia Castro', '69b60d39a450e863609ae3546b12b360', 'user-avatar-05.png'],
  ];

  it.each(ORACLE)('resolves %s to the validated identicon image', (_name, gravatar, file) => {
    expect(getDefaultAvatar(gravatar).file).toBe(file);
  });

  it('always returns a file from AVATAR_IMAGE_FILENAMES and a colour from AVATAR_COLORS', () => {
    for (const [, gravatar] of ORACLE) {
      const { file, color } = getDefaultAvatar(gravatar);
      expect(AVATAR_IMAGE_FILENAMES).toContain(file);
      expect(AVATAR_COLORS).toContain(color);
    }
  });

  it('is stable for a given key (same image + colour on repeated calls)', () => {
    const a = getDefaultAvatar('69b60d39a450e863609ae3546b12b360');
    const b = getDefaultAvatar('69b60d39a450e863609ae3546b12b360');
    expect(a).toEqual(b);
    // Virginia Castro → user-avatar-05.png on COLORS[2].
    expect(a.file).toBe('user-avatar-05.png');
    expect(a.color).toBe(AVATAR_COLORS[2]);
  });
});

/* ========================================================================== *
 * getUserAvatar — the full branch structure ported from AvatarService.getAvatar.
 * ========================================================================== */
describe('getUserAvatar', () => {
  it('returns the unnamed placeholder (no bg) for a null user', () => {
    const a = getUserAvatar(null);
    expect(a.url).toBe(`${VERSION}/images/unnamed.png`);
    expect(a.bg).toBeUndefined();
    expect(a.fullName).toBe('');
  });

  it('returns the unnamed placeholder (no bg) when gravatar_id is absent', () => {
    const a = getUserAvatar({ id: 1, full_name_display: 'No Gravatar', photo: null });
    expect(a.url).toBe(`${VERSION}/images/unnamed.png`);
    expect(a.bg).toBeUndefined();
    expect(a.fullName).toBe('No Gravatar');
  });

  it('prefers an uploaded photo (no identicon colour) when present', () => {
    const a = getUserAvatar({
      id: 1,
      full_name_display: 'Has Photo',
      photo: 'https://cdn.example/p.png',
      gravatar_id: 'e64c7d89f26bd1972efa854d13d7dd61',
    });
    expect(a.url).toBe('https://cdn.example/p.png');
    expect(a.bg).toBeUndefined();
  });

  it('generates the coloured identicon on localhost when photo is null (F-VIS-01)', () => {
    // jsdom host is `localhost`, so the LOCAL identicon branch applies.
    const a = getUserAvatar({
      id: 5,
      full_name_display: 'Administrator',
      photo: null,
      gravatar_id: 'e64c7d89f26bd1972efa854d13d7dd61',
    });
    // admin → user-avatar-02.png on COLORS[3].
    expect(a.url).toBe(`${VERSION}/images/user-avatars/user-avatar-02.png`);
    expect(a.bg).toBe(AVATAR_COLORS[3]);
    expect(a.fullName).toBe('Administrator');
  });

  it('assigns visibly DIFFERENT identicon colours to different users', () => {
    // Begoña → COLORS[0]; Virginia → COLORS[2] — proves the board is no longer
    // a wall of one flat colour.
    const begona = getUserAvatar({
      id: 2,
      full_name_display: 'Begoña Flores',
      photo: null,
      gravatar_id: 'aed1e43be0f69f07ce6f34a907bc6328',
    });
    const virginia = getUserAvatar({
      id: 3,
      full_name_display: 'Virginia Castro',
      photo: null,
      gravatar_id: '69b60d39a450e863609ae3546b12b360',
    });
    expect(begona.bg).toBe(AVATAR_COLORS[0]);
    expect(virginia.bg).toBe(AVATAR_COLORS[2]);
    expect(begona.bg).not.toBe(virginia.bg);
    expect(begona.url).toContain('user-avatar-01.png');
    expect(virginia.url).toContain('user-avatar-05.png');
  });
});
