/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Framework-agnostic translation + locale runtime for the React coexistence layer.
 *
 * This module is a faithful, AngularJS-free re-implementation of the SUBSET of
 * `angular-translate` behavior that the two migrated screens (Kanban + Backlog)
 * depend on. The AngularJS app configures translations like so
 * (`app/coffee/app.coffee:798-808`):
 *
 *     $translatePartialLoaderProvider.addPart('taiga')
 *     $translateProvider
 *         .useLoader('$translatePartialLoader',
 *             { urlTemplate: window._version + '/locales/{part}/locale-{lang}.json' })
 *         .useSanitizeValueStrategy('escapeParameters')
 *         .addInterpolation('$translateMessageFormatInterpolation')
 *         .preferredLanguage(preferedLangCode)
 *         .useMissingTranslationHandlerLog()
 *     $translateProvider.fallbackLanguage("en")
 *
 * The behaviors reproduced here, and why:
 *
 *   1. DOT-PATH KEYS. Translation keys are dot-separated paths into a nested JSON
 *      catalog (e.g. `ZOOM.TITLE`, `LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME`),
 *      exactly matching the structure of `app/locales/taiga/locale-<lang>.json`.
 *
 *   2. MISSING-KEY = KEY. When a key is absent, angular-translate (with
 *      `useMissingTranslationHandlerLog`) renders the KEY string itself. `t()`
 *      reproduces this: an unknown key returns verbatim, so a missing translation
 *      is visible and traceable rather than throwing or rendering blank.
 *
 *   3. FALLBACK TO ENGLISH. `fallbackLanguage("en")` means a key missing from the
 *      active language falls back to English. An English default catalog is
 *      embedded below (values copied VERBATIM from `locale-en.json`), and any
 *      loaded/injected catalog is DEEP-MERGED over it, so English always backfills
 *      gaps and English renders correctly even before any async load completes.
 *
 *   4. PARAMETER INTERPOLATION. angular-translate substitutes `{{param}}` (and the
 *      one-time-binding form `{{::param}}`) placeholders with named parameters.
 *      `t(key, params)` reproduces both forms. HTML-escaping of parameters
 *      (`escapeParameters`) is intentionally NOT performed here: React escapes text
 *      nodes on render, so the visible output is identical, and pre-escaping would
 *      double-encode. Callers that render catalog HTML (e.g. `LAST_SPRINT_NAME`)
 *      own their own sanitization decision at the render site.
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from AngularJS or the
 * CoffeeScript codebase. Its only in-repo import is the sibling `./session` module
 * (for the preferred-language resolution, which itself only reads globals), and its
 * only cross-framework interop is reading the `window._version` global and fetching
 * the same locale JSON the AngularJS loader fetches. There is no `angular` reference.
 */

import { getPreferredLanguage } from './session';
import { getConfigValue } from './config';

/**
 * A translation catalog is an arbitrarily nested tree whose leaves are strings.
 * This mirrors the shape of `app/locales/taiga/locale-<lang>.json`.
 */
export interface TranslationCatalog {
  [key: string]: string | TranslationCatalog;
}

/**
 * Named interpolation parameters for `t()`. Values are coerced to strings;
 * `null`/`undefined` render as an empty string (matching AngularJS `$interpolate`,
 * which renders an absent expression value as `""`).
 */
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  /**
   * `i18n.ts` OWNS the typing of the `window._version` global (the build-time
   * version segment used to namespace static assets, e.g. `"6.10.3"`). It is set
   * by `app-loader/app-loader.coffee` (`window._version = "___VERSION___"`,
   * replaced at build time) and is used here to build the locale-fetch URL,
   * exactly as the AngularJS partial loader's `urlTemplate` does. `config.ts` owns
   * `taigaConfig` and `session.ts` owns `taiga`; to avoid duplicate/conflicting
   * global augmentations, `_version` must NOT be redeclared elsewhere.
   */
  interface Window {
    _version?: string;
  }
}

/**
 * Embedded English default catalog — the exact subset of keys consumed by the two
 * migrated screens and their shared adapters. Every value is copied VERBATIM from
 * `app/locales/taiga/locale-en.json` so English rendering is byte-identical to the
 * AngularJS screens even when no localized catalog has been loaded (English is the
 * configured `fallbackLanguage`). New keys are added here as consumers need them.
 */
const DEFAULT_EN_CATALOG: TranslationCatalog = {
  ZOOM: {
    TITLE: 'Zoom:',
    'ZOOM-1': 'Compact',
    'ZOOM-2': 'Default',
    'ZOOM-3': 'Detailed',
    'ZOOM-4': 'Expanded',
  },
  COMMON: {
    SAVE: 'Save',
    CLOSE: 'close',
    CREATE: 'Create',
    DELETE: 'Delete',
    CANCEL: 'Cancel',
    PICKERDATE: {
      FORMAT: 'DD MMM YYYY',
      FIRST_DAY_OF_WEEK: '1',
      PREV_MONTH: 'Previous Month',
      NEXT_MONTH: 'Next Month',
      MONTHS: {
        JAN: 'January',
        FEB: 'February',
        MAR: 'March',
        APR: 'April',
        MAY: 'May',
        JUN: 'June',
        JUL: 'July',
        AUG: 'August',
        SEP: 'September',
        OCT: 'October',
        NOV: 'November',
        DEC: 'December',
      },
      WEEK_DAYS: {
        SUN: 'Sunday',
        MON: 'Monday',
        TUE: 'Tuesday',
        WED: 'Wednesday',
        THU: 'Thursday',
        FRI: 'Friday',
        SAT: 'Saturday',
      },
      WEEK_DAYS_SHORT: {
        SUN: 'Sun',
        MON: 'Mon',
        TUE: 'Tue',
        WED: 'Wed',
        THU: 'Thu',
        FRI: 'Fri',
        SAT: 'Sat',
      },
    },
    FORM_ERRORS: {
      REQUIRED: 'This value is required.',
      MAX_LENGTH: 'This value is too long. It should have %s characters or less.',
      NOT_BLANK: 'This value should not be blank.',
    },
    FILTERS: {
      INPUT_PLACEHOLDER: 'subject or reference',
      TITLE_ACTION_FILTER_BUTTON: 'search',
      TITLE: 'Custom filters',
      TITLE_ACTION_SEARCH: 'Search',
      ACTION_ADD: 'Add',
      ACTION_SAVE_CUSTOM_FILTER: 'save filter',
      PLACEHOLDER_FILTER_NAME: 'Write the filter name and press enter',
      APPLIED_FILTERS_NUM: 'filters applied',
      TITLE_ADVANCED_FILTER: 'Advanced',
      LENGTH_ZERO_ERROR: 'Please add a filter name',
      REPEATED_FILTER_ERROR: 'This filter name is already in use',
      ADVANCED_FILTERS: {
        INCLUDE: 'Include',
        EXCLUDE: 'Exclude',
        INCLUDED: 'Filtered by:',
        EXCLUDED: 'Excluded:',
      },
      CATEGORIES: {
        TYPE: 'Type',
        STATUS: 'Status',
        SEVERITY: 'Severity',
        PRIORITIES: 'Priorities',
        TAGS: 'Tags',
        ASSIGNED_TO: 'Assigned to',
        ASSIGNED_USERS: 'Assigned users',
        ROLE: 'Role',
        CREATED_BY: 'Created by',
        CUSTOM_FILTERS: 'Custom filters',
        EPIC: 'Epic',
      },
    },
  },
  BACKLOG: {
    COMPACT_SPRINT: 'Compact Sprint',
    EDIT_SPRINT: 'Edit Sprint',
    GO_TO_TASKBOARD: 'Go to the taskboard of {{::name}}',
    CLOSED_POINTS: 'closed',
    TOTAL_POINTS: 'total',
    SPRINTS: {
      DATE: 'DD MMM YYYY',
    },
  },
  LIGHTBOX: {
    ADD_EDIT_SPRINT: {
      TITLE: 'New sprint',
      PLACEHOLDER_SPRINT_NAME: 'sprint name',
      PLACEHOLDER_SPRINT_START: 'Estimated Start',
      PLACEHOLDER_SPRINT_END: 'Estimated End',
      ACTION_DELETE_SPRINT: 'Do you want to delete this sprint?',
      TITLE_ACTION_DELETE_SPRINT: 'delete sprint',
      LAST_SPRINT_NAME: 'last sprint is <strong> {{lastSprint}} ;-) </strong>',
    },
  },
};

/**
 * The catalog `t()` currently resolves against. Initialized to the English
 * defaults so translations work synchronously with zero configuration; replaced
 * (always merged OVER the English defaults) by `configureI18n`/`loadCatalog`.
 */
let activeCatalog: TranslationCatalog = DEFAULT_EN_CATALOG;

/** The active locale code (e.g. `"en"`, `"es"`). Reported by `getLocale()`. */
let activeLocale = 'en';

/**
 * Deep-merges `override` over `base`, returning a NEW catalog. Nested objects are
 * merged recursively; string leaves in `override` replace those in `base`; keys
 * present only in `base` are preserved (this is what backfills English fallbacks).
 */
function deepMerge(base: TranslationCatalog, override: TranslationCatalog): TranslationCatalog {
  const result: TranslationCatalog = { ...base };

  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    const baseValue = result[key];

    if (
      overrideValue !== null &&
      typeof overrideValue === 'object' &&
      baseValue !== null &&
      typeof baseValue === 'object'
    ) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

/**
 * Resolves a dot-separated key path into `catalog`, returning the leaf string, or
 * `undefined` when the path is absent or resolves to a non-string (a sub-tree).
 */
function resolvePath(catalog: TranslationCatalog, key: string): string | undefined {
  const segments = key.split('.');
  let current: string | TranslationCatalog | undefined = catalog;

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Substitutes `{{param}}` and `{{::param}}` placeholders (tolerating surrounding
 * whitespace) with the supplied named parameters. Missing/`null`/`undefined`
 * values render as an empty string, matching AngularJS `$interpolate`.
 */
function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{\{\s*(?:::)?\s*([A-Za-z0-9_$.]+)\s*\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Translates a dot-path key against the active catalog, interpolating any named
 * parameters. Returns the key verbatim when it is absent (angular-translate
 * missing-translation parity), so untranslated keys are visible rather than blank.
 *
 * @param key - Dot-separated catalog key (e.g. `"ZOOM.TITLE"`).
 * @param params - Optional named interpolation parameters.
 * @returns The translated (and interpolated) string, or `key` when not found.
 */
export function t(key: string, params?: TranslationParams): string {
  const raw = resolvePath(activeCatalog, key);

  if (raw === undefined) {
    return key;
  }

  return params ? interpolate(raw, params) : raw;
}

/**
 * Installs a translation catalog and (optionally) sets the active locale.
 *
 * The supplied catalog is DEEP-MERGED over the embedded English defaults, so keys
 * absent from `catalog` still resolve to English (the `fallbackLanguage("en")`
 * contract). This is the synchronous entry point used both by the hosting screens
 * (to inject a catalog fetched elsewhere) and by unit tests (to exercise
 * non-English rendering deterministically without any network access).
 *
 * @param catalog - Localized catalog to merge over the English defaults.
 * @param locale - Optional locale code to report from `getLocale()`.
 */
export function configureI18n(catalog: TranslationCatalog, locale?: string): void {
  activeCatalog = deepMerge(DEFAULT_EN_CATALOG, catalog);

  if (locale) {
    activeLocale = locale;
  }
}

/**
 * Restores the pristine English defaults and the `"en"` locale. Primarily used by
 * tests to isolate cases, but also valid at runtime to revert to the fallback.
 */
export function resetI18n(): void {
  activeCatalog = DEFAULT_EN_CATALOG;
  activeLocale = 'en';
}

/**
 * @returns The active locale code (e.g. `"en"`, `"es"`).
 */
export function getLocale(): string {
  return activeLocale;
}

/**
 * @returns The active locale's date-picker display format (moment tokens), read
 *   from `COMMON.PICKERDATE.FORMAT` (e.g. `"DD MMM YYYY"`). This is the exact
 *   source AngularJS reads for `tg-date-selector`/Pikaday display formatting.
 */
export function getDateFormat(): string {
  return t('COMMON.PICKERDATE.FORMAT');
}

/**
 * Month keys (January-first) and weekday keys (Sunday-first) in the exact order
 * the AngularJS `DataPickerConfig` service reads them (common.coffee), so the
 * assembled arrays line up index-for-index with what Pikaday expected.
 */
const PICKER_MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;
const PICKER_WEEKDAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Localized calendar strings for the date picker (Pikaday `i18n` parity). */
export interface PickerI18n {
  previousMonth: string;
  nextMonth: string;
  /** Twelve full month names, January-first. */
  months: string[];
  /** Seven full weekday names, Sunday-first. */
  weekdays: string[];
  /** Seven abbreviated weekday names, Sunday-first. */
  weekdaysShort: string[];
}

/**
 * The full date-picker configuration, reproducing the object returned by the
 * AngularJS `tgDatePickerConfigService.get()` factory (`DataPickerConfig`,
 * common.coffee): localized month/weekday names, RTL flag, first day of week, and
 * the moment display format — all sourced from the active `COMMON.PICKERDATE.*`
 * catalog and the `rtlLanguages` runtime config.
 */
export interface PickerConfig {
  i18n: PickerI18n;
  isRTL: boolean;
  firstDay: number;
  format: string;
}

/**
 * Assembles the active-locale date-picker configuration, byte-for-byte mirroring
 * the legacy `DataPickerConfig.get()`:
 *  - `i18n` month/weekday names + prev/next labels from `COMMON.PICKERDATE.*`,
 *  - `isRTL` = whether the preferred language is in the `rtlLanguages` config list,
 *  - `firstDay` = `parseInt(COMMON.PICKERDATE.FIRST_DAY_OF_WEEK, 10)` (NaN -> 0,
 *    matching Pikaday's tolerance of an invalid value),
 *  - `format` = `COMMON.PICKERDATE.FORMAT` (the moment display/parse pattern).
 *
 * This is the single source the React `DatePicker` reads, so the calendar renders
 * with the same localized labels, week start, and date format the AngularJS
 * `tg-date-selector` did.
 */
export function getPickerConfig(): PickerConfig {
  const lang = getPreferredLanguage();
  const rtlLanguages = getConfigValue<string[]>('rtlLanguages', []);
  const isRTL = Array.isArray(rtlLanguages) && rtlLanguages.indexOf(lang) > -1;
  const firstDay = parseInt(t('COMMON.PICKERDATE.FIRST_DAY_OF_WEEK'), 10);

  return {
    i18n: {
      previousMonth: t('COMMON.PICKERDATE.PREV_MONTH'),
      nextMonth: t('COMMON.PICKERDATE.NEXT_MONTH'),
      months: PICKER_MONTH_KEYS.map((k) => t(`COMMON.PICKERDATE.MONTHS.${k}`)),
      weekdays: PICKER_WEEKDAY_KEYS.map((k) => t(`COMMON.PICKERDATE.WEEK_DAYS.${k}`)),
      weekdaysShort: PICKER_WEEKDAY_KEYS.map((k) => t(`COMMON.PICKERDATE.WEEK_DAYS_SHORT.${k}`)),
    },
    isRTL,
    firstDay: Number.isFinite(firstDay) ? firstDay : 0,
    format: t('COMMON.PICKERDATE.FORMAT'),
  };
}

/**
 * Asynchronously loads a localized catalog and installs it (merged over the
 * English defaults). Fetches the SAME locale JSON the AngularJS partial loader
 * fetches — `${window._version}/locales/taiga/locale-<lang>.json` — using a
 * leading-slash, origin-absolute path so it resolves independently of the current
 * route. On any failure (missing version, network/parse error, non-OK response)
 * the active catalog is left unchanged so English (or the previously loaded
 * locale) keeps rendering; the error is surfaced to the caller via a rejected
 * promise so the hosting screen can decide how to react.
 *
 * @param lang - Locale code to load. Defaults to the user's preferred language
 *   (`session.getPreferredLanguage()` -> `userInfo.lang || defaultLanguage || 'en'`).
 * @returns The installed catalog on success.
 */
export async function loadCatalog(lang?: string): Promise<TranslationCatalog> {
  const language = lang || getPreferredLanguage();
  // `window._version` is a bare path segment (e.g. "6.10.3"); build an
  // origin-absolute URL and omit the version segment entirely when it is unset so
  // no accidental "//" is produced. Defensive slash-trimming tolerates a value
  // that arrives already wrapped in slashes.
  const version = (window._version ?? '').replace(/^\/+|\/+$/g, '');
  const versionSegment = version ? `/${version}` : '';
  const url = `${versionSegment}/locales/taiga/locale-${language}.json`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to load locale catalog "${language}" (HTTP ${response.status})`);
  }

  const catalog = (await response.json()) as TranslationCatalog;

  configureI18n(catalog, language);

  return activeCatalog;
}
