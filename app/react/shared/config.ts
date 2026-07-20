/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Runtime configuration adapter for the React coexistence layer.
 *
 * This module is the single source of truth for runtime configuration on the
 * React side of the AngularJS 1.5.10 -> React 18 coexistence migration. It is a
 * faithful, framework-agnostic re-implementation of the AngularJS `$tgConfig`
 * `ConfigurationService` (`app/coffee/modules/base/conf.coffee`).
 *
 * Both frameworks read the SAME browser global, `window.taigaConfig`, so React
 * and AngularJS share one identical runtime configuration with no backend or
 * config-file change:
 *
 *   - `app-loader/app-loader.coffee` first seeds `window.taigaConfig` with the
 *     built-in defaults, then fetches `conf.json` and merges it via
 *     `window.taigaConfig = Object.assign({}, window.taigaConfig, data)` BEFORE
 *     it calls `angular.bootstrap(document, ['taiga'])`.
 *   - React roots are hosted inside `ng-view` route templates and therefore
 *     mount only AFTER `angular.bootstrap` runs. Consequently, by the time any
 *     React code executes, `window.taigaConfig` is already fully assembled and
 *     authoritative.
 *
 * Even though the global is stable by the time React runs, every accessor reads
 * it lazily at call-time (never snapshotting it at module-load time) so that the
 * live global always wins and so the functions remain trivially testable (a spec
 * can assign/delete `window.taigaConfig` between calls).
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from the repository.
 * The only cross-framework interop is reading `window.taigaConfig`. There is no
 * AngularJS/CoffeeScript import and no `angular` reference — the sole dependency
 * is the browser global itself.
 */

/**
 * Shape of the shared Taiga runtime configuration object.
 *
 * Only the keys consumed by the migrated React screens (and their shared
 * adapters) are typed explicitly; every other key that may appear in
 * `conf.json` (e.g. `themes`, `baseHref`, importer feature flags, …) is admitted
 * through the index signature so the object stays a faithful mirror of the
 * AngularJS `window.taigaConfig` global without needing to enumerate keys the
 * React screens never touch.
 */
export interface TaigaConfig {
  /** REST API base URL, including the trailing `"/api/v1/"` (e.g. `"http://localhost:8000/api/v1/"`). */
  api: string;
  /** WebSocket events endpoint URL; `null` disables realtime events. */
  eventsUrl: string | null;
  /** Default UI language / Accept-Language fallback (e.g. `"en"`). */
  defaultLanguage: string;
  /** Max missed heartbeats before the events connection is considered dead (default 5). */
  eventsMaxMissedHeartbeats?: number;
  /** Heartbeat interval for the events connection, in milliseconds (default 60000). */
  eventsHeartbeatIntervalTime?: number;
  /** Delay before attempting to reconnect the events socket, in milliseconds (default 10000). */
  eventsReconnectTryInterval?: number;
  /** Max consecutive connection errors tolerated before giving up (default 5). */
  eventsMaxConnectionErrors?: number;
  /** Debug flag mirrored from the AngularJS config (default false). */
  debug?: boolean;
  /** Tolerate any other `conf.json` key without widening the whole type to `any`. */
  [key: string]: unknown;
}

declare global {
  /**
   * `config.ts` OWNS the typing of `window.taigaConfig`. The sibling `session.ts`
   * separately owns the `window.taiga` typing; to avoid duplicate/conflicting
   * global augmentations, `taigaConfig` must NOT be redeclared elsewhere.
   *
   * Typed as optional because, defensively, the global may be absent in some
   * runtimes (for example under Jest/jsdom when a spec has not assigned it).
   */
  interface Window {
    taigaConfig?: TaigaConfig;
  }
}

/**
 * Returns the live shared configuration object.
 *
 * Always reads the current `window.taigaConfig` (never a module-load snapshot).
 * Falls back to an empty object when the global is absent so callers — and the
 * accessors below — never dereference `undefined`. This mirrors the AngularJS
 * `ConfigurationService` constructor (`@config = window.taigaConfig`) while
 * adding defensive handling for environments where the global is not set.
 */
export const getConfig = (): TaigaConfig => window.taigaConfig ?? ({} as TaigaConfig);

/**
 * Reads a single configuration value by key, reproducing the exact semantics of
 * the AngularJS `ConfigurationService.get(key, defaultValue)`:
 *
 *   get: (key, defaultValue=null) ->
 *       if _.has(@config, key)
 *           return @config[key]
 *       return defaultValue
 *
 * The value is returned whenever the key is an OWN property of the config object
 * — even when that value is falsy (`null`, `false`, `0`, `""`). Only a genuinely
 * absent key yields `defaultValue`. `Object.prototype.hasOwnProperty.call(...)`
 * is the flat-object equivalent of lodash `_.has` used by the original service.
 *
 * @typeParam T - Expected value type; inferred from `defaultValue`.
 * @param key - Configuration key to look up.
 * @param defaultValue - Value returned when `key` is not present.
 * @returns The configured value (cast to `T`) if present, otherwise `defaultValue`.
 */
export function getConfigValue<T = unknown>(key: string, defaultValue: T): T {
  const config = getConfig();

  if (Object.prototype.hasOwnProperty.call(config, key)) {
    // The index signature types indexed access as `unknown`; the generic `T`
    // (driven by `defaultValue`) is the caller's asserted expectation.
    return config[key] as T;
  }

  return defaultValue;
}

/**
 * The REST API base URL (e.g. `"http://localhost:8000/api/v1/"`).
 *
 * Returned verbatim — trailing-slash/join normalization is intentionally NOT
 * performed here; `shared/api/httpClient.ts` owns URL-join semantics. Defaults
 * to an empty string when unset so downstream join logic can decide how to react.
 */
export const getApiUrl = (): string => getConfigValue('api', '');

/**
 * The WebSocket events endpoint URL, or `null` when realtime events are disabled.
 *
 * Mirrors the AngularJS default (`eventsUrl: null`) so `shared/events/eventsClient.ts`
 * can treat `null` as "events off".
 */
export const getEventsUrl = (): string | null => getConfigValue<string | null>('eventsUrl', null);

/**
 * The default language, guaranteed to be a non-empty string.
 *
 * Used by `shared/session.ts` as the `Accept-Language` fallback. The trailing
 * `|| 'en'` guards against a configured-but-empty value in addition to an absent
 * key (which `getConfigValue`'s default already covers).
 */
export const getDefaultLanguage = (): string => getConfigValue('defaultLanguage', 'en') || 'en';
