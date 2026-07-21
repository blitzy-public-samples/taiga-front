/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/i18n.ts` — the
 * localization bridge (F-UI-06).
 *
 * Two paths are exercised:
 *   1. NO Angular (the default jsdom world) — every call must fall back to the
 *      supplied English default (with `{{token}}` interpolation), NEVER a raw
 *      key.
 *   2. Angular PRESENT — a stub `window.angular` exposing an injector whose
 *      `$translate.instant` is asserted to be called with the key + params, and
 *      whose result is preferred (unless it echoes the key, i.e. a miss).
 *
 * No AngularJS, no network, no browser engine are imported.
 */

import { renderHook } from '@testing-library/react';

import { translate, t, getLocale, formatDate, formatNumber, useTranslation } from '../i18n';

/** Install a stub `window.angular` whose `$translate.instant` uses `table`. */
function installAngular(
    table: Record<string, string>,
    instant?: jest.Mock,
): jest.Mock {
    const instantFn =
        instant ??
        jest.fn((id: string) => (id in table ? table[id] : id));
    (window as unknown as { angular?: unknown }).angular = {
        element: () => ({
            injector: () => ({
                get: (name: string) => (name === '$translate' ? { instant: instantFn } : undefined),
            }),
        }),
    };
    return instantFn;
}

function clearAngular(): void {
    delete (window as unknown as { angular?: unknown }).angular;
}

afterEach(() => {
    clearAngular();
    document.documentElement.removeAttribute('lang');
});

describe('translate — no Angular (fallback path)', () => {
    it('returns the English fallback when the service is unavailable', () => {
        expect(translate('BACKLOG.ACTION_ADD_SPRINT', undefined, 'Add sprint')).toBe('Add sprint');
    });

    it('returns the key itself when no fallback is supplied', () => {
        expect(translate('SOME.MISSING.KEY')).toBe('SOME.MISSING.KEY');
    });

    it('interpolates {{token}} placeholders into the fallback', () => {
        expect(
            translate('X', { count: 3 }, 'Added {{count}} stories'),
        ).toBe('Added 3 stories');
    });

    it('interpolates single-brace {token} placeholders too', () => {
        expect(translate('X', { name: 'Sprint 1' }, 'Edit {name}')).toBe('Edit Sprint 1');
    });

    it('leaves unmatched tokens intact', () => {
        expect(translate('X', { a: 1 }, '{{a}} of {{b}}')).toBe('1 of {{b}}');
    });

    it('is exported as the `t` shorthand', () => {
        expect(t('X', undefined, 'Save')).toBe('Save');
    });
});

describe('translate — Angular present (bridge path)', () => {
    it('returns the shell translation and passes the key + params through', () => {
        const instant = jest.fn(() => 'Añadir sprint');
        installAngular({}, instant);
        expect(translate('BACKLOG.ACTION_ADD_SPRINT', { n: 1 }, 'Add sprint')).toBe('Añadir sprint');
        expect(instant).toHaveBeenCalledWith('BACKLOG.ACTION_ADD_SPRINT', { n: 1 });
    });

    it('prefers the fallback when the service ECHOES the key (missing translation)', () => {
        installAngular({}); // default stub echoes unknown keys
        expect(translate('MISSING.KEY', undefined, 'Default label')).toBe('Default label');
    });

    it('uses a real table entry when present', () => {
        installAngular({ 'COMMON.SAVE': 'Guardar' });
        expect(translate('COMMON.SAVE', undefined, 'Save')).toBe('Guardar');
    });

    it('falls back gracefully if instant throws', () => {
        installAngular(
            {},
            jest.fn(() => {
                throw new Error('not ready');
            }),
        );
        expect(translate('X', undefined, 'Safe')).toBe('Safe');
    });

    it('falls back when the injector is not yet available', () => {
        (window as unknown as { angular?: unknown }).angular = {
            element: () => ({ injector: () => undefined }),
        };
        expect(translate('X', undefined, 'Safe')).toBe('Safe');
    });

    it('falls back when reading the injector throws', () => {
        (window as unknown as { angular?: unknown }).angular = {
            element: () => {
                throw new Error('no document injector');
            },
        };
        expect(translate('X', undefined, 'Safe')).toBe('Safe');
    });
});

describe('useTranslation', () => {
    it('returns a stable translator that delegates to translate', () => {
        const { result, rerender } = renderHook(() => useTranslation());
        const first = result.current.t;
        expect(first('X', undefined, 'Save')).toBe('Save');
        rerender();
        // Stable identity across renders (safe for effect/callback deps).
        expect(result.current.t).toBe(first);
    });

    it('resolves through the shell service when present', () => {
        installAngular({ 'COMMON.SAVE': 'Guardar' });
        const { result } = renderHook(() => useTranslation());
        expect(result.current.t('COMMON.SAVE', undefined, 'Save')).toBe('Guardar');
    });
});

describe('getLocale', () => {
    it('reads the shell <html lang> when present', () => {
        document.documentElement.setAttribute('lang', 'es');
        expect(getLocale()).toBe('es');
    });

    it('defaults to "en" (angular-translate fallbackLanguage) when unresolved', () => {
        expect(getLocale()).toBe('en');
    });
});

describe('formatDate', () => {
    it('returns "" for null/undefined/empty', () => {
        expect(formatDate(null)).toBe('');
        expect(formatDate(undefined)).toBe('');
        expect(formatDate('')).toBe('');
    });

    it('returns "" for an unparseable value', () => {
        // moment emits an RFC2822/ISO deprecation console.warn when it falls
        // back to the native Date parser for a genuinely unparseable string.
        // This is a deliberate negative-path probe of formatDate's isValid()
        // guard — production only ever receives real API date strings/Date
        // objects — so we silence the expected third-party warning to keep the
        // suite output clean without altering production behavior.
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(formatDate('not-a-date')).toBe('');
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('formats a valid ISO date with an explicit token', () => {
        expect(formatDate('2023-04-15', 'YYYY-MM-DD')).toBe('2023-04-15');
    });

    it('formats with the locale default short date ("L") by default', () => {
        // "L" in the "en" locale is MM/DD/YYYY.
        expect(formatDate('2023-04-15')).toBe('04/15/2023');
    });
});

describe('formatNumber (F-VIS-06)', () => {
    it('groups thousands in the default "en" locale (the baseline "1,344")', () => {
        expect(formatNumber(1344)).toBe('1,344');
        expect(formatNumber(1234567)).toBe('1,234,567');
    });

    it('does not group values below 1000', () => {
        expect(formatNumber(806)).toBe('806');
        expect(formatNumber(0)).toBe('0');
    });

    it('rounds to at most 3 fraction digits by default (bare `| number`)', () => {
        expect(formatNumber(100.333333)).toBe('100.333');
        expect(formatNumber(2.5)).toBe('2.5');
    });

    it('honours maximumFractionDigits=0 (the legacy `| number:0` for speed)', () => {
        expect(formatNumber(5.5, 0)).toBe('6');
        expect(formatNumber(0, 0)).toBe('0');
    });

    it('returns "0" for null/undefined/NaN/±Infinity (never a blank cell)', () => {
        expect(formatNumber(null)).toBe('0');
        expect(formatNumber(undefined)).toBe('0');
        expect(formatNumber(Number.NaN)).toBe('0');
        expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
        expect(formatNumber('not-a-number')).toBe('0');
    });

    it('uses the shell locale for grouping (delegates to getLocale, not hardcoded "en")', () => {
        // Prove the formatter reads the SAME resolved locale as `translate`
        // rather than hardcoding "en". The "de" locale groups thousands with a
        // period. Comparing against the reference `Intl` output for that locale
        // keeps the assertion correct on any ICU build (both sides fall back
        // identically on a reduced-ICU runtime), while still catching a hardcoded
        // "en" on a full-ICU runtime (where "en" → "1,344" ≠ "de" → "1.344").
        document.documentElement.setAttribute('lang', 'de');
        expect(getLocale()).toBe('de');
        const expected = new Intl.NumberFormat('de', { maximumFractionDigits: 3 }).format(1344);
        expect(formatNumber(1344)).toBe(expected);
        // On a full-ICU runtime "de" resolves to itself and uses the period
        // separator — a visible difference from the "en" comma, proving the
        // delegation is locale-driven. Skipped on a reduced-ICU fallback.
        if (new Intl.NumberFormat('de').resolvedOptions().locale === 'de') {
            expect(formatNumber(1344)).toBe('1.344');
        }
    });
});
