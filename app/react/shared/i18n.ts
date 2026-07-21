/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/i18n.ts — the localization bridge for the migrated React Kanban +
 * Backlog screens (F-UI-06).
 *
 * WHY THIS EXISTS
 *   The legacy screens localized every user-facing string through
 *   angular-translate (`{{ 'KEY' | translate }}`, `$translate.instant('KEY')`)
 *   configured in `app/coffee/app.coffee:798-808` (partial loader for the
 *   `taiga` part, `preferredLanguage`, `fallbackLanguage("en")`), and formatted
 *   dates with a locale-aware `moment` plus the translated
 *   `COMMON.PICKERDATE.FORMAT` pattern. The React port had hardcoded English and
 *   fixed date formats, dropping 100+ translation call sites.
 *
 * THE BRIDGE (reuse the shell's service — do NOT re-implement translation)
 *   React renders INSIDE the already-bootstrapped AngularJS shell (the custom
 *   elements mount only once the hosting Angular template compiles, which is
 *   after `angular.bootstrap`). So the shell's `$translate` service is reachable
 *   at render time through the global Angular injector:
 *
 *       window.angular.element(document).injector().get('$translate')
 *
 *   {@link translate} calls `$translate.instant(key, params)` — the SAME service,
 *   SAME loaded `taiga` translation tables, SAME active language — so React text
 *   is localized identically to the shell and switches language with it. When
 *   the injector/service is not reachable (unit tests, or a key missing from the
 *   tables), it falls back to the supplied English default so the UI never shows
 *   a raw `SCREAMING.DOT.KEY`.
 *
 * DATES
 *   {@link formatDate} formats through `moment` (already a project dependency)
 *   after switching moment to the shell's resolved locale
 *   (`shared/session.getLanguage()` reads the `<html lang>` angular-translate
 *   stamps). This replaces the fixed `YYYY-MM-DD`-only formatting with the
 *   locale-aware, translated pattern the legacy used.
 *
 * TEST-LAYER ISOLATION
 *   No AngularJS import, no network, no browser engine. The injector is read
 *   defensively from `window` and every access is guarded, so under jsdom (no
 *   Angular) the fallbacks apply deterministically.
 *
 * Toolchain: TypeScript 5.4.5 (`strict`), Node v16.19.1 compatible.
 */

import { useCallback } from 'react';
// F-PERF-01: use the shell's already-loaded global Moment (see ./moment) so esbuild
// does not bundle a second ~60 KB copy of Moment into react.js.
import moment from './moment';

import { getLanguage } from './session';

/* ========================================================================== *
 * Angular injector access (guarded, no global augmentation)
 * ========================================================================== */

/** The tiny slice of the AngularJS `$translate` service this bridge consumes. */
interface TranslateService {
    instant(id: string, params?: Record<string, unknown>): string;
}

/** The tiny slice of the global `angular` object this bridge consumes. */
interface AngularStatic {
    element(node: Document | Element): {
        injector(): { get(name: string): unknown } | undefined;
    };
}

/**
 * Resolve the shell's `$translate` service via the global Angular injector, or
 * `undefined` when Angular is not present/bootstrapped (e.g. under jsdom) or the
 * service cannot be resolved. Every step is wrapped so a missing injector never
 * throws into a React render.
 */
function getTranslateService(): TranslateService | undefined {
    const ng = (window as unknown as { angular?: AngularStatic }).angular;
    if (!ng || typeof ng.element !== 'function') {
        return undefined;
    }
    try {
        const injector = ng.element(document).injector();
        if (!injector || typeof injector.get !== 'function') {
            return undefined;
        }
        const service = injector.get('$translate') as TranslateService | undefined;
        return service && typeof service.instant === 'function' ? service : undefined;
    } catch {
        return undefined;
    }
}

/* ========================================================================== *
 * Fallback interpolation
 * ========================================================================== */

/**
 * Interpolate `{{ token }}` / `{ token }` placeholders in a fallback string from
 * `params`, mirroring angular-translate's default interpolation so a fallback
 * behaves like a real translation when the service is unavailable. Unmatched
 * tokens are left intact.
 */
function interpolateFallback(text: string, params?: Record<string, unknown>): string {
    if (!params) {
        return text;
    }
    return text.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (match, token: string) => {
        const value = params[token];
        return value === undefined || value === null ? match : String(value);
    });
}

/* ========================================================================== *
 * Public API
 * ========================================================================== */

/**
 * Translate a key through the shell's angular-translate service.
 *
 * @param key    The translation id, e.g. `"BACKLOG.ACTION_ADD_SPRINT"`.
 * @param params Interpolation params for the translation (or the fallback).
 * @param fallback English default rendered when the service is unavailable or the
 *   key is missing. STRONGLY recommended so the UI never shows a raw key.
 * @returns The localized string (or the interpolated fallback / key).
 */
export function translate(
    key: string,
    params?: Record<string, unknown>,
    fallback?: string,
): string {
    const service = getTranslateService();
    if (service) {
        try {
            const result = service.instant(key, params);
            // angular-translate echoes the KEY back when a translation is missing;
            // in that case prefer the caller's English fallback.
            if (typeof result === 'string' && result !== '' && result !== key) {
                return result;
            }
        } catch {
            /* fall through to the fallback */
        }
    }
    return interpolateFallback(fallback ?? key, params);
}

/** Convenience shorthand mirroring the common `t(...)` alias. */
export const t = translate;

/**
 * React hook returning a stable `t` translator. Purely a convenience wrapper
 * over {@link translate}; kept hook-shaped so components can depend on it in
 * effect/callback dependency arrays without re-creating the function.
 */
export function useTranslation(): { t: typeof translate } {
    const translator = useCallback(
        (key: string, params?: Record<string, unknown>, fallback?: string) =>
            translate(key, params, fallback),
        [],
    );
    return { t: translator };
}

/**
 * The shell's resolved locale (BCP-47), e.g. `"en"`, `"es"`. Reuses
 * `session.getLanguage()` (the `<html lang>` angular-translate stamps) and
 * defaults to `"en"` — angular-translate's `fallbackLanguage`.
 */
export function getLocale(): string {
    return getLanguage() ?? 'en';
}

/**
 * Format a date through `moment` in the shell's locale. `value` may be a
 * `Date`, an ISO string, or a moment-parseable value. Returns `""` for a
 * null/invalid input (the legacy templates rendered nothing for empty dates).
 *
 * @param value  The date to format.
 * @param format A moment format token (defaults to the locale's `"L"` — the
 *   localized short date, matching the legacy `COMMON.PICKERDATE.FORMAT` intent).
 */
export function formatDate(
    value: Date | string | number | null | undefined,
    format = 'L',
): string {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    const m = moment(value);
    if (!m.isValid()) {
        return '';
    }
    return m.locale(getLocale()).format(format);
}

/**
 * Format a number in the shell's locale with grouped thousands, mirroring the
 * AngularJS `number` filter the legacy Backlog summary used
 * (`span.number(ng-bind="stats.total_points | number")`, `summary.jade`).
 *
 * AngularJS's `| number` groups thousands per the active locale and rounds to
 * at most `maximumFractionDigits` fraction digits (its bare form defaults to a
 * maximum of 3); `| number:0` — used by the "points / sprint" stat — maps to
 * `maximumFractionDigits = 0`. This restores the baseline "1,344" rendering
 * that the previous hand-rolled `Math.round(n*100)/100` (which produced the
 * separator-less "1344") had dropped (F-VIS-06).
 *
 * @param value  The numeric value (or anything coercible via `Number(...)`).
 * @param maximumFractionDigits  Max fraction digits (default 3; pass 0 for the
 *   legacy `| number:0`).
 * @returns The grouped, localized string; `"0"` for a null/NaN/±Infinity input
 *   — matching the previous container fallback so a summary cell never renders
 *   blank before the stats payload loads.
 */
export function formatNumber(value: unknown, maximumFractionDigits = 3): string {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
        return '0';
    }
    try {
        return new Intl.NumberFormat(getLocale(), { maximumFractionDigits }).format(n);
    } catch {
        // `Intl`/the resolved locale is unavailable on an extremely old engine:
        // fall back to a plain rounded string so the number still renders.
        const factor = 10 ** maximumFractionDigits;
        return String(Math.round(n * factor) / factor);
    }
}
