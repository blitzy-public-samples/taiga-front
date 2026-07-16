/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared internationalization adapter for the React Backlog screen.
 *
 * The React roots run INSIDE the living AngularJS 1.5 document (mounted via the
 * `tg-react-backlog` custom element after `angular.bootstrap`). AngularJS
 * localizes the whole client with angular-translate: it configures a partial
 * loader (`urlTemplate: window._version + '/locales/{part}/locale-{lang}.json'`,
 * part `"taiga"`), selects the user's language
 * (`userInfo?.lang || window.taigaConfig.defaultLanguage || "en"`) and falls
 * back to `"en"` (app/coffee/app.coffee L799-808). The Backlog route only
 * renders after its `languageLoad` resolve has completed, so by the time the
 * React root mounts the translation catalog for the active language is already
 * loaded into the running `$translate` service.
 *
 * Rather than shipping a second copy of ~30 locale catalogs (and a second
 * loader) into the React bundle, this adapter follows the same
 * "read the globals the AngularJS shell already establishes" pattern used by
 * {@link ../session/sessionId} and {@link ../config/taigaConfig}: it reaches
 * the SAME live `$translate` service through the Angular injector and asks it
 * for the localized string. There is therefore exactly ONE catalog, ONE active
 * language, and ONE source of truth shared across both frameworks — restoring
 * the ~30-locale coverage that the AngularJS Backlog had and that the initial
 * React migration dropped (all strings were hardcoded English).
 *
 * Robustness / test-safety contract:
 *   - When AngularJS is NOT present (jsdom unit tests, or any call before
 *     bootstrap) the adapter returns the caller-supplied ENGLISH fallback,
 *     interpolated locally. This keeps the React components rendering the exact
 *     same English text they render today, so existing jsdom assertions and the
 *     English default language are unaffected.
 *   - Interpolation is always performed LOCALLY over a `{{ name }}` template
 *     (recovered from the live catalog via private-use sentinels when Angular is
 *     available). React escapes the substituted values when they are rendered as
 *     text nodes / attribute values, so user-controlled content (a story
 *     subject, a search term) can never inject markup — without the double
 *     HTML-escaping that angular-translate's `escapeParameters` strategy would
 *     produce inside a React text context.
 */

/** Interpolation parameters: placeholder name -> value. */
export type TranslateParams = Record<string, string | number>;

/** Minimal shape of the angular-translate `$translate` service we rely on. */
interface AngularTranslateService {
    instant(translationId: string, interpolateParams?: Record<string, unknown>): string;
}

/** Minimal shape of the AngularJS `$injector` we rely on. */
interface AngularInjector {
    has(name: string): boolean;
    get(name: string): unknown;
}

/** Minimal shape of an `angular.element(...)` wrapper. */
interface AngularJQLite {
    injector(): AngularInjector | undefined;
}

/** Minimal shape of the global `angular` object. */
interface AngularStatic {
    element(node: unknown): AngularJQLite;
}

declare global {
    interface Window {
        angular?: AngularStatic;
    }
}

/*
 * Private-Use-Area sentinels. They are used to recover a localized TEMPLATE
 * (with its `{{ name }}` placeholders intact) from `$translate.instant`, which
 * otherwise only returns a fully-interpolated string. These code points never
 * occur in real UI copy or user content and contain no HTML-special characters,
 * so angular-translate's `escapeParameters` sanitizer passes them through
 * unchanged.
 */
const SENTINEL_START = "\uE000";
const SENTINEL_END = "\uE001";

/** Matches `{{ name }}` / `{{name}}` placeholders (angular-translate default). */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/*
 * Cached `$translate` service. `null` means "not resolved yet" (we re-attempt on
 * every call because the AngularJS injector only becomes reachable after
 * bootstrap); a non-null value is memoized because the injector is stable for
 * the lifetime of the page once bootstrapped.
 */
let cachedTranslate: AngularTranslateService | null = null;

/**
 * Resolve the live angular-translate `$translate` service via the AngularJS
 * injector attached to the bootstrapped document. Returns `null` (never throws)
 * when AngularJS is absent or the injector is not yet available.
 */
function resolveTranslate(): AngularTranslateService | null {
    if (cachedTranslate) {
        return cachedTranslate;
    }
    if (typeof window === "undefined") {
        return null;
    }
    const ng = window.angular;
    if (!ng || typeof ng.element !== "function" || typeof document === "undefined") {
        return null;
    }

    // `angular.bootstrap(document, ['taiga'])` attaches the injector to the
    // document; probe the most likely hosts defensively.
    const hosts: Array<unknown> = [document, document.documentElement, document.body];
    for (const host of hosts) {
        if (!host) {
            continue;
        }
        let injector: AngularInjector | undefined;
        try {
            injector = ng.element(host).injector();
        } catch {
            injector = undefined;
        }
        if (
            injector &&
            typeof injector.has === "function" &&
            typeof injector.get === "function" &&
            injector.has("$translate")
        ) {
            const service = injector.get("$translate") as AngularTranslateService | undefined;
            if (service && typeof service.instant === "function") {
                cachedTranslate = service;
                return service;
            }
        }
    }
    return null;
}

/**
 * Substitute `{{ name }}` placeholders in `template` with `params[name]`,
 * leaving unknown placeholders untouched. Values are inserted verbatim; the
 * caller renders the result through React, which escapes it.
 */
function interpolate(template: string, params?: TranslateParams): string {
    if (!params) {
        return template;
    }
    return template.replace(PLACEHOLDER_RE, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
}

/**
 * Fetch the localized template for `key` from the live catalog, with its
 * `{{ name }}` placeholders preserved for local interpolation. Returns `null`
 * when AngularJS is unavailable or the key is missing from the catalog (in
 * which case the caller falls back to the English default).
 */
function localizedTemplate(key: string, params?: TranslateParams): string | null {
    const service = resolveTranslate();
    if (!service) {
        return null;
    }
    try {
        const names = params ? Object.keys(params) : [];
        if (names.length === 0) {
            const out = service.instant(key);
            return typeof out === "string" && out !== key && out !== "" ? out : null;
        }

        // Interpolate with sentinels so we can recover the localized template.
        const sentinels: Record<string, string> = {};
        for (const name of names) {
            sentinels[name] = `${SENTINEL_START}${name}${SENTINEL_END}`;
        }
        const raw = service.instant(key, sentinels);
        if (typeof raw !== "string" || raw === key || raw === "") {
            return null;
        }
        let template = raw;
        for (const name of names) {
            template = template.split(sentinels[name]).join(`{{${name}}}`);
        }
        return template;
    } catch {
        return null;
    }
}

/**
 * Translate `key` using the shared AngularJS catalog, falling back to the
 * supplied English `fallback` when AngularJS is unavailable or the key is
 * missing. `params` are interpolated into `{{ name }}` placeholders.
 *
 * @param key       Dotted catalog key, e.g. `"BACKLOG.SECTION_NAME"`.
 * @param fallback  English default (kept identical to the pre-i18n literal so
 *                  jsdom tests and the English locale render unchanged).
 * @param params    Optional interpolation values keyed by placeholder name.
 */
export function t(key: string, fallback: string, params?: TranslateParams): string {
    const template = localizedTemplate(key, params) ?? fallback;
    return interpolate(template, params);
}

/**
 * Test-only hook to reset the memoized `$translate` service between test cases.
 * Not used by production code.
 */
export function __resetTranslateCacheForTests(): void {
    cachedTranslate = null;
}
