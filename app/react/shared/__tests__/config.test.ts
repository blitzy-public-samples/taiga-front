/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared runtime-config adapter
 * (`app/react/shared/config.ts`) used by the React coexistence layer.
 *
 * These specs exercise the framework-agnostic re-implementation of the AngularJS
 * `$tgConfig` `ConfigurationService` (`app/coffee/modules/base/conf.coffee`). The
 * behavioral contract mirrored here is that `ConfigurationService.get(key, default)`
 * returns `config[key]` whenever the key is an OWN property of the config object
 * (via lodash `_.has`) — even when that value is falsy — and only falls back to the
 * default for a genuinely absent key.
 *
 * The suite is intentionally hermetic: it imports ONLY the module under test and
 * manipulates the single shared browser global `window.taigaConfig` inside jsdom.
 * There is no AngularJS/CoffeeScript import, no other `app/react` module, no
 * Playwright, no browser launch, and no network access — so it runs headlessly and
 * deterministically and counts toward the >=70% line-coverage gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`afterEach` are provided globally by
 * `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

import {
  getConfig,
  getConfigValue,
  getApiUrl,
  getEventsUrl,
  getDefaultLanguage,
} from '../config';
// Type-only import: needed to build a fully-typed config object for the
// reference-identity assertion and to keep the window global correctly typed.
import type { TaigaConfig } from '../config';

/**
 * Loose shape used ONLY by these specs to install a (possibly partial) config on
 * the shared global. Real `conf.json` payloads carry many more keys; the adapter
 * only ever cares whether a given key is an own property, so a partial object is a
 * faithful and sufficient test fixture.
 */
type TestConfig = Record<string, unknown>;

/**
 * Installs a (possibly partial) config object as the shared `window.taigaConfig`
 * global. The double cast through `unknown` sidesteps the strict `TaigaConfig`
 * shape (which requires `api`/`eventsUrl`/`defaultLanguage`) so specs can assert
 * behavior against minimal fixtures without fabricating irrelevant fields.
 */
const setConfig = (cfg: TestConfig): void => {
  (window as unknown as { taigaConfig?: unknown }).taigaConfig = cfg;
};

/**
 * Removes any `window.taigaConfig` so each spec starts from — and leaves behind —
 * a pristine global, preventing state leakage into sibling specs.
 */
const clearConfig = (): void => {
  delete (window as { taigaConfig?: unknown }).taigaConfig;
};

describe('shared/config runtime-config adapter', () => {
  // Guarantee a clean global both before and after every test so neither this
  // suite nor any sibling spec ever observes residual `window.taigaConfig`.
  beforeEach(() => {
    clearConfig();
  });

  afterEach(() => {
    clearConfig();
  });

  describe('getConfig()', () => {
    it('returns an empty object when window.taigaConfig is undefined', () => {
      expect(getConfig()).toEqual({});
    });

    it('returns the identical live object when window.taigaConfig is set', () => {
      const cfg: TaigaConfig = {
        api: 'https://host/api/v1/',
        eventsUrl: null,
        defaultLanguage: 'en',
      };
      window.taigaConfig = cfg;

      // Same reference, not merely a structural copy — the accessor reads the
      // live global rather than snapshotting or cloning it.
      expect(getConfig()).toBe(cfg);
    });

    it('reads the global lazily at call time (never a module-load snapshot)', () => {
      // First call: global still absent -> empty object.
      expect(getConfig()).toEqual({});

      // Assign AFTER the first call; the next call must observe the new value.
      const cfg: TaigaConfig = {
        api: 'https://later/api/v1/',
        eventsUrl: null,
        defaultLanguage: 'en',
      };
      window.taigaConfig = cfg;

      expect(getConfig()).toBe(cfg);
    });
  });

  describe('getConfigValue(key, defaultValue)', () => {
    it('returns the configured value when the key is present', () => {
      setConfig({ api: 'https://h/api/v1' });
      expect(getConfigValue('api', 'DEFAULT')).toBe('https://h/api/v1');
    });

    it('returns the default value when the key is absent', () => {
      setConfig({ api: 'https://h/api/v1' });
      expect(getConfigValue('missing', 'DEFAULT')).toBe('DEFAULT');
    });

    it('returns the default value when there is no config object at all', () => {
      expect(getConfigValue('anything', 'DEFAULT')).toBe('DEFAULT');
    });

    it('returns a present-but-false value instead of the default (own-property wins)', () => {
      setConfig({ debug: false });
      // `false` is an own property, so it must win over the 'X' default.
      expect(getConfigValue('debug', 'X')).toBe(false);
    });

    it('returns a present-but-null value instead of the default (own-property wins)', () => {
      setConfig({ eventsUrl: null });
      expect(getConfigValue('eventsUrl', 'fallback')).toBeNull();
    });

    it('returns a present empty-string value instead of the default (own-property wins)', () => {
      setConfig({ defaultLanguage: '' });
      expect(getConfigValue('defaultLanguage', 'en')).toBe('');
    });

    it('returns a present zero value instead of the default (own-property wins)', () => {
      setConfig({ eventsMaxMissedHeartbeats: 0 });
      expect(getConfigValue('eventsMaxMissedHeartbeats', 5)).toBe(0);
    });
  });

  describe('getApiUrl()', () => {
    it('returns the configured api base URL', () => {
      setConfig({ api: 'https://h/api/v1/' });
      expect(getApiUrl()).toBe('https://h/api/v1/');
    });

    it('returns "" when api is absent from the config', () => {
      setConfig({ defaultLanguage: 'en' });
      expect(getApiUrl()).toBe('');
    });

    it('returns "" when there is no config object at all', () => {
      expect(getApiUrl()).toBe('');
    });
  });

  describe('getEventsUrl()', () => {
    it('returns the configured events (WebSocket) URL', () => {
      setConfig({ eventsUrl: 'wss://h/events' });
      expect(getEventsUrl()).toBe('wss://h/events');
    });

    it('returns null when eventsUrl is explicitly null (events disabled)', () => {
      setConfig({ eventsUrl: null });
      expect(getEventsUrl()).toBeNull();
    });

    it('returns null when eventsUrl is absent from the config', () => {
      setConfig({ api: 'https://h/api/v1/' });
      expect(getEventsUrl()).toBeNull();
    });

    it('returns null when there is no config object at all', () => {
      expect(getEventsUrl()).toBeNull();
    });
  });

  describe('getDefaultLanguage()', () => {
    it('returns the configured default language', () => {
      setConfig({ defaultLanguage: 'es' });
      expect(getDefaultLanguage()).toBe('es');
    });

    it('falls back to "en" when defaultLanguage is an empty string', () => {
      // Own-property present but empty -> the trailing `|| 'en'` guard applies.
      setConfig({ defaultLanguage: '' });
      expect(getDefaultLanguage()).toBe('en');
    });

    it('falls back to "en" when defaultLanguage is absent from the config', () => {
      setConfig({ api: 'https://h/api/v1/' });
      expect(getDefaultLanguage()).toBe('en');
    });

    it('falls back to "en" when there is no config object at all', () => {
      expect(getDefaultLanguage()).toBe('en');
    });
  });
});
