/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared session / authentication adapter
 * (`app/react/shared/session.ts`) used by the React coexistence layer.
 *
 * These specs pin the framework-agnostic re-implementation of three AngularJS
 * reads that let the migrated React screens REUSE the incumbent AngularJS
 * 1.5.10 session instead of establishing their own (source of truth:
 * `app/coffee/modules/base/storage.coffee` `StorageService` +
 * `app/coffee/app.coffee`):
 *
 *   - TOKEN — persisted via `StorageService.set` (`localStorage.setItem(key,
 *     JSON.stringify(val))`) and read back with `JSON.parse`, so a string token
 *     is stored WITH surrounding quotes. `getToken()` must `JSON.parse` it back
 *     to the bare string and must swallow parse errors as `null`.
 *   - SESSION ID — the process-wide `window.taiga.sessionId` global assigned
 *     once at AngularJS boot; `getSessionId()` reuses it verbatim, returning
 *     `''` when it is absent or falsy.
 *   - PREFERRED LANGUAGE — the AngularJS precedence
 *     `userInfo?.lang || window.taigaConfig.defaultLanguage || "en"`, where
 *     `userInfo` is `JSON.parse(localStorage.userInfo)`; `getPreferredLanguage()`
 *     delegates the config-default / hard-`"en"` tail to `getDefaultLanguage()`
 *     from `./config`.
 *
 * The suite is intentionally hermetic: it imports ONLY the module under test
 * (which internally pulls the sibling `./config`) and drives every branch by
 * manipulating the jsdom-provided `localStorage` plus the two shared browser
 * globals `window.taiga` and `window.taigaConfig`. There is no AngularJS /
 * CoffeeScript import, no direct `../config` import (its fallback is exercised
 * through `window.taigaConfig`), no Playwright, no browser launch, and no
 * network access — so it runs headlessly and deterministically and counts
 * toward the >=70% line-coverage gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach` are provided globally by
 * `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

import {
  getToken,
  getUser,
  getSessionId,
  getPreferredLanguage,
  isAuthenticated,
  redirectToLogin,
} from '../session';

/**
 * Installs the shared `window.taiga` global. `session.ts` OWNS this typing
 * (`{ sessionId?: string; [key: string]: unknown }`), so a partial fixture such
 * as `{}` or `{ sessionId: '' }` is directly assignable without a cast.
 */
const setTaigaGlobal = (value: { sessionId?: string; [key: string]: unknown }): void => {
  window.taiga = value;
};

/**
 * Removes any `window.taiga` so each spec starts from — and leaves behind — a
 * pristine global. The cast narrows `window` to the single optional property
 * being deleted, mirroring the sibling `config.test.ts` cleanup idiom.
 */
const clearTaigaGlobal = (): void => {
  delete (window as { taiga?: unknown }).taiga;
};

/**
 * Installs a (possibly partial) config object as the shared `window.taigaConfig`
 * global that `getDefaultLanguage()` reads. The double cast through `unknown`
 * sidesteps the strict `TaigaConfig` shape (which requires `api`/`eventsUrl`/
 * `defaultLanguage`) so specs can drive the language fallback with a minimal
 * `{ defaultLanguage }` fixture without fabricating irrelevant fields.
 */
const setConfig = (cfg: Record<string, unknown>): void => {
  (window as unknown as { taigaConfig?: unknown }).taigaConfig = cfg;
};

/**
 * Removes any `window.taigaConfig` so the language fallback resolves to the hard
 * `"en"` default and no config leaks across specs.
 */
const clearConfig = (): void => {
  delete (window as { taigaConfig?: unknown }).taigaConfig;
};

/**
 * Resets ALL shared state touched by these specs: the jsdom `localStorage`
 * (`token` + `userInfo` keys) and both `window` globals. Run both before and
 * after every test so neither this suite nor any sibling spec ever observes
 * residual authentication state.
 */
const resetSharedState = (): void => {
  localStorage.clear();
  clearTaigaGlobal();
  clearConfig();
};

describe('shared/session auth adapter', () => {
  beforeEach(resetSharedState);
  afterEach(resetSharedState);

  describe('getToken()', () => {
    it('returns the JSON-parsed bare token when a valid token is stored', () => {
      // StorageService.set JSON-serializes values, so the token is persisted
      // WITH surrounding quotes (the raw stored string is `"abc"`).
      localStorage.setItem('token', JSON.stringify('abc'));

      // Sanity-check the fixture reproduces the AngularJS on-disk shape: the raw
      // value carries the quotes that getToken() must strip via JSON.parse.
      expect(localStorage.getItem('token')).toBe('"abc"');

      // getToken must return the BARE string, never the raw quoted value —
      // returning the raw string would yield `Authorization: Bearer "abc"`,
      // which the frozen /api/v1/ contract rejects.
      expect(getToken()).toBe('abc');
    });

    it('round-trips a realistic JWT-like token without surrounding quotes', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo0Mn0.s1gn4tur3';
      localStorage.setItem('token', JSON.stringify(jwt));

      expect(getToken()).toBe(jwt);
      // The returned value must not retain the JSON quote characters.
      expect(getToken()).not.toContain('"');
    });

    it('returns null when no token key is present', () => {
      // localStorage.getItem('token') === null -> early null return.
      expect(getToken()).toBeNull();
    });

    it('returns null for a present-but-corrupt (non-JSON) token (catch branch)', () => {
      // A value that is present but not valid JSON must exercise the try/catch
      // and yield null rather than throwing (mirrors StorageService.get).
      localStorage.setItem('token', 'not-json{');

      expect(getToken()).toBeNull();
    });

    // --- F17: non-empty-string validation (CWE-20/CWE-287) --------------------
    // A usable bearer credential must be a non-empty string. Any other parsed
    // shape, and empty/whitespace-only strings, must resolve to null so that
    // getToken() stays in lockstep with the Authorization header (set iff a real
    // token exists) and never reports a bogus "authenticated" token.

    it('returns null for an empty-string token (JSON "")', () => {
      // Raw stored value is `""` -> JSON.parse -> "" -> rejected (blank).
      localStorage.setItem('token', JSON.stringify(''));
      expect(localStorage.getItem('token')).toBe('""');
      expect(getToken()).toBeNull();
    });

    it('returns null for a whitespace-only token', () => {
      // Non-empty but blank once trimmed; not a usable credential.
      localStorage.setItem('token', JSON.stringify('   '));
      expect(getToken()).toBeNull();
    });

    it('returns null for a numeric token', () => {
      localStorage.setItem('token', JSON.stringify(12345));
      expect(getToken()).toBeNull();
    });

    it('returns null for a boolean token', () => {
      localStorage.setItem('token', JSON.stringify(true));
      expect(getToken()).toBeNull();
    });

    it('returns null for an object token', () => {
      localStorage.setItem('token', JSON.stringify({ token: 'abc' }));
      expect(getToken()).toBeNull();
    });

    it('returns null for a JSON null token', () => {
      // Valid JSON, parses to null -> not a string -> null.
      localStorage.setItem('token', JSON.stringify(null));
      expect(getToken()).toBeNull();
    });

    it('preserves a valid token verbatim (no trimming of a real credential)', () => {
      // A real token has no surrounding whitespace; ensure the value is returned
      // exactly as stored (trim is only used to DECIDE emptiness).
      localStorage.setItem('token', JSON.stringify('abc.def.ghi'));
      expect(getToken()).toBe('abc.def.ghi');
    });
  });

  describe('getSessionId()', () => {
    it('returns window.taiga.sessionId when the global is set', () => {
      setTaigaGlobal({ sessionId: 'sid-123' });
      expect(getSessionId()).toBe('sid-123');
    });

    it('returns "" when window.taiga is undefined', () => {
      // No global installed -> short-circuits to the `|| ''` fallback.
      expect(getSessionId()).toBe('');
    });

    it('returns "" when window.taiga exists but has no sessionId', () => {
      setTaigaGlobal({});
      expect(getSessionId()).toBe('');
    });

    it('returns "" when window.taiga.sessionId is an empty string (falsy)', () => {
      // A present-but-empty sessionId is falsy, so the `|| ''` guard keeps it ''.
      setTaigaGlobal({ sessionId: '' });
      expect(getSessionId()).toBe('');
    });
  });

  describe('getPreferredLanguage()', () => {
    it('returns userInfo.lang when present in localStorage', () => {
      // userInfo is itself JSON-serialized (StorageService.set).
      localStorage.setItem('userInfo', JSON.stringify({ lang: 'fr' }));
      expect(getPreferredLanguage()).toBe('fr');
    });

    it('prefers userInfo.lang over the config default (precedence)', () => {
      // Reproduces `userInfo?.lang || config.defaultLanguage || "en"`: the user's
      // stored language wins even when a config default is also present.
      localStorage.setItem('userInfo', JSON.stringify({ lang: 'fr' }));
      setConfig({ defaultLanguage: 'de' });
      expect(getPreferredLanguage()).toBe('fr');
    });

    it('falls back to the config defaultLanguage when userInfo is absent', () => {
      setConfig({ defaultLanguage: 'de' });
      expect(getPreferredLanguage()).toBe('de');
    });

    it('falls back to "en" when there is neither userInfo nor config', () => {
      // Ultimate fallback via getDefaultLanguage() -> getConfigValue default.
      expect(getPreferredLanguage()).toBe('en');
    });

    it('delegates to the config default when userInfo has no lang key', () => {
      // userInfo is truthy but `userInfo.lang` is undefined -> fall through to
      // getDefaultLanguage(), which reads the config default.
      localStorage.setItem('userInfo', JSON.stringify({}));
      setConfig({ defaultLanguage: 'de' });
      expect(getPreferredLanguage()).toBe('de');
    });

    it('delegates to the config default when userInfo.lang is an empty string (falsy)', () => {
      // Present-but-falsy lang must not win; the `userInfo && userInfo.lang`
      // guard is false, so the config default applies.
      localStorage.setItem('userInfo', JSON.stringify({ lang: '' }));
      setConfig({ defaultLanguage: 'de' });
      expect(getPreferredLanguage()).toBe('de');
    });

    it('falls back to the default for a corrupt (non-JSON) userInfo value (guarded catch)', () => {
      // A present-but-invalid userInfo must not throw; the guarded parse falls
      // through to getDefaultLanguage() -> "en" when no config is present.
      localStorage.setItem('userInfo', 'not-json{');
      expect(getPreferredLanguage()).toBe('en');
    });
  });

  describe('getUser()', () => {
    it('returns the parsed user-session object when userInfo is a valid object', () => {
      // userInfo is JSON-serialized by StorageService.set, so it is stored with
      // its object braces and read back with JSON.parse.
      const user = { id: 42, username: 'ada', lang: 'fr' };
      localStorage.setItem('userInfo', JSON.stringify(user));

      // The parsed plain object is returned as-is (React does not build a model).
      expect(getUser()).toEqual(user);
    });

    it('preserves arbitrary persisted attributes via the index signature', () => {
      // The legacy user model persists many fields; getUser() must not drop any.
      const user = { id: 7, is_superuser: true, roles: ['a', 'b'], extra: { nested: 1 } };
      localStorage.setItem('userInfo', JSON.stringify(user));

      expect(getUser()).toEqual(user);
    });

    it('returns null when no userInfo key is present', () => {
      // localStorage.getItem('userInfo') === null -> `if (!raw)` early null.
      expect(getUser()).toBeNull();
    });

    it('returns null for an empty-string userInfo value', () => {
      // A present-but-empty string is falsy -> `if (!raw)` early null (never
      // reaches JSON.parse('')).
      localStorage.setItem('userInfo', '');
      expect(getUser()).toBeNull();
    });

    it('returns null for a corrupt (non-JSON) userInfo value (guarded catch)', () => {
      // A present-but-invalid userInfo must not throw; the guarded parse yields
      // null, mirroring StorageService.get's `catch -> return null`.
      localStorage.setItem('userInfo', 'not-json{');
      expect(getUser()).toBeNull();
    });

    it('returns null for a JSON null userInfo value', () => {
      // Valid JSON that parses to null -> not a non-null object -> null. This
      // also mirrors the legacy `if userData` truthiness guard rejecting null.
      localStorage.setItem('userInfo', JSON.stringify(null));
      expect(getUser()).toBeNull();
    });

    it('returns null for a non-object userInfo value (string)', () => {
      // A JSON string is valid JSON but not a user session object.
      localStorage.setItem('userInfo', JSON.stringify('not-a-user'));
      expect(getUser()).toBeNull();
    });

    it('returns null for a non-object userInfo value (number)', () => {
      localStorage.setItem('userInfo', JSON.stringify(123));
      expect(getUser()).toBeNull();
    });

    it('returns null for a non-object userInfo value (boolean)', () => {
      localStorage.setItem('userInfo', JSON.stringify(true));
      expect(getUser()).toBeNull();
    });
  });

  describe('isAuthenticated()', () => {
    // F17: authentication is defined by the presence of a valid user SESSION
    // (`getUser() != null`), reproducing `auth.coffee`
    // `CurrentUserService.isAuthenticated()` (`if @.getUser() != null return true`).
    // It is INDEPENDENT of the raw bearer token — the token concern is owned
    // separately by getToken()/the Authorization header.

    it('returns true when a valid userInfo session object is present', () => {
      localStorage.setItem('userInfo', JSON.stringify({ id: 1, username: 'ada' }));
      expect(isAuthenticated()).toBe(true);
    });

    it('returns true from userInfo alone even when NO token is stored (token-independent)', () => {
      // The key F17 divergence fix: a present user session authenticates the
      // user regardless of whether a token key exists in storage.
      localStorage.setItem('userInfo', JSON.stringify({ id: 2 }));
      expect(getToken()).toBeNull(); // no token stored
      expect(isAuthenticated()).toBe(true);
    });

    it('returns true from userInfo even when the token is blank/invalid (decoupled from getToken)', () => {
      // A blank token yields getToken() === null, but a valid user session still
      // authenticates — proving isAuthenticated no longer tracks getToken.
      localStorage.setItem('userInfo', JSON.stringify({ id: 3 }));
      localStorage.setItem('token', JSON.stringify('   ')); // getToken() -> null
      expect(getToken()).toBeNull();
      expect(isAuthenticated()).toBe(true);
    });

    it('returns false when no userInfo session is present', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('returns false when a token exists but there is no userInfo session', () => {
      // The previous token-derived implementation returned true here; the legacy
      // userInfo contract correctly reports NOT authenticated without a session.
      localStorage.setItem('token', JSON.stringify('abc'));
      expect(getToken()).toBe('abc'); // a valid token exists...
      expect(isAuthenticated()).toBe(false); // ...but no user session -> false
    });

    it('returns false for a corrupt (non-JSON) userInfo value (tracks getUser null)', () => {
      // getUser() returns null for unparseable values, so isAuthenticated,
      // being derived from getUser, must report false.
      localStorage.setItem('userInfo', 'not-json{');
      expect(isAuthenticated()).toBe(false);
    });

    it('returns false for a JSON null userInfo value', () => {
      localStorage.setItem('userInfo', JSON.stringify(null));
      expect(isAuthenticated()).toBe(false);
    });
  });

  /**
   * `redirectToLogin()` reproduces the legacy `$tgHttp` 401 -> /login navigation
   * (`app/coffee/app.coffee:1025`). It calls `window.location.assign('/login')`.
   * jsdom's real `location.assign` is a non-implemented no-op that logs noise, so
   * the tests swap `window.location` for a stub carrying a spy and restore it
   * afterwards.
   */
  describe('redirectToLogin()', () => {
    let originalLocation: Location;
    let assignSpy: jest.Mock;

    beforeEach(() => {
      originalLocation = window.location;
      assignSpy = jest.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { assign: assignSpy } as unknown as Location,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    });

    it('navigates the browser to the /login route', () => {
      redirectToLogin();
      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy).toHaveBeenCalledWith('/login');
    });
  });
});
