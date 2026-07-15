/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Read-only runtime configuration adapter over `window.taigaConfig`.
 *
 * The AngularJS shell (`app-loader/app-loader.coffee`) seeds `window.taigaConfig`
 * with a set of defaults and then, after fetching `conf.json`, merges the fetched
 * values via `Object.assign({}, window.taigaConfig, data)` -- all of this happens
 * BEFORE the React roots mount. `window.taigaConfig` is therefore the single
 * source of truth shared by both frameworks; this adapter never hardcodes runtime
 * values and never duplicates configuration.
 *
 * Unlike the AngularJS `$tgConfig` service (which snapshots `window.taigaConfig`
 * at construction time), every getter here reads `window.taigaConfig` LAZILY at
 * call time, so late merges and unit-test overrides are always honored. Documented
 * defaults are applied as a fallback whenever a key is absent or `window` /
 * `window.taigaConfig` is unavailable (e.g. in a jsdom unit-test environment).
 *
 * This module is pure TypeScript: it performs no network I/O, writes nothing to
 * the DOM, and imports no React.
 */

/**
 * Shape of the Taiga runtime configuration.
 *
 * The eight keys below are the ones consumed by the migrated React Kanban and
 * Backlog screens and each has a dedicated typed getter. Every other key that the
 * AngularJS loader seeds (e.g. `debug`, `publicRegisterEnabled`, `contribPlugins`,
 * ...) is still carried through by the permissive index signature but is not part
 * of the two React screens' contract.
 */
export interface TaigaConfig {
    /** REST API base URL, e.g. `"http://localhost:8000/api/v1/"`. */
    api: string;
    /** WebSocket events URL. `null` disables the events channel. */
    eventsUrl: string | null;
    /** Number of missed heartbeats tolerated before the events socket reconnects. */
    eventsMaxMissedHeartbeats: number;
    /** Heartbeat interval for the events socket, in milliseconds. */
    eventsHeartbeatIntervalTime: number;
    /** Fallback language used for the `Accept-Language` header. */
    defaultLanguage: string;
    /** Ordered list of available theme names. */
    themes: string[];
    /** Theme applied when none is otherwise selected. */
    defaultTheme: string;
    /** Base href for the application. */
    baseHref: string;
    /** Any other runtime key seeded by the loader / `conf.json`. */
    [key: string]: unknown;
}

declare global {
    interface Window {
        taigaConfig?: Partial<TaigaConfig> & Record<string, unknown>;
    }
}

/**
 * Documented defaults, mirrored 1:1 from the `window.taigaConfig` object seeded in
 * `app-loader/app-loader.coffee` (L11-L34). Used as a fallback for the typed
 * getters when a key is missing or `window.taigaConfig` is unavailable.
 */
const DEFAULT_CONFIG: {
    api: string;
    eventsUrl: string | null;
    eventsMaxMissedHeartbeats: number;
    eventsHeartbeatIntervalTime: number;
    defaultLanguage: string;
    themes: string[];
    defaultTheme: string;
    baseHref: string;
} = {
    api: "http://localhost:8000/api/v1/",
    eventsUrl: null,
    eventsMaxMissedHeartbeats: 5,
    eventsHeartbeatIntervalTime: 60000,
    defaultLanguage: "en",
    themes: ["taiga", "taiga-legacy", "material-design", "high-contrast"],
    defaultTheme: "taiga",
    baseHref: "/",
};

/**
 * Lazily read the raw `window.taigaConfig` object. Returns an empty object when
 * `window` or `window.taigaConfig` is unavailable, so callers can safely apply
 * their own defaults.
 */
function raw(): Record<string, unknown> {
    if (typeof window === "undefined" || !window.taigaConfig) {
        return {};
    }

    return window.taigaConfig as Record<string, unknown>;
}

/** REST API base URL (consumed by `shared/api/httpClient.ts`). */
export function getApiUrl(): string {
    const value = raw().api;

    return typeof value === "string" ? value : DEFAULT_CONFIG.api;
}

/** WebSocket events URL; `null` disables events (consumed by `shared/events/websocket.ts`). */
export function getEventsUrl(): string | null {
    const value = raw().eventsUrl;

    return typeof value === "string" ? value : DEFAULT_CONFIG.eventsUrl;
}

/** Number of missed heartbeats tolerated before reconnecting the events socket. */
export function getEventsMaxMissedHeartbeats(): number {
    const value = raw().eventsMaxMissedHeartbeats;

    return typeof value === "number" ? value : DEFAULT_CONFIG.eventsMaxMissedHeartbeats;
}

/** Events heartbeat interval, in milliseconds. */
export function getEventsHeartbeatIntervalTime(): number {
    const value = raw().eventsHeartbeatIntervalTime;

    return typeof value === "number" ? value : DEFAULT_CONFIG.eventsHeartbeatIntervalTime;
}

/** Fallback language for the `Accept-Language` header. */
export function getDefaultLanguage(): string {
    const value = raw().defaultLanguage;

    return typeof value === "string" ? value : DEFAULT_CONFIG.defaultLanguage;
}

/** Ordered list of available theme names. */
export function getThemes(): string[] {
    const value = raw().themes;

    if (Array.isArray(value) && value.every((theme) => typeof theme === "string")) {
        return value as string[];
    }

    return DEFAULT_CONFIG.themes;
}

/** Theme applied when none is otherwise selected. */
export function getDefaultTheme(): string {
    const value = raw().defaultTheme;

    return typeof value === "string" ? value : DEFAULT_CONFIG.defaultTheme;
}

/** Base href for the application. */
export function getBaseHref(): string {
    const value = raw().baseHref;

    return typeof value === "string" ? value : DEFAULT_CONFIG.baseHref;
}

/**
 * Return the full runtime configuration: the raw `window.taigaConfig` values with
 * the eight documented keys guaranteed present (falling back to defaults) and
 * correctly typed.
 */
export function getConfig(): TaigaConfig {
    return {
        ...DEFAULT_CONFIG,
        ...raw(),
        api: getApiUrl(),
        eventsUrl: getEventsUrl(),
        eventsMaxMissedHeartbeats: getEventsMaxMissedHeartbeats(),
        eventsHeartbeatIntervalTime: getEventsHeartbeatIntervalTime(),
        defaultLanguage: getDefaultLanguage(),
        themes: getThemes(),
        defaultTheme: getDefaultTheme(),
        baseHref: getBaseHref(),
    };
}
