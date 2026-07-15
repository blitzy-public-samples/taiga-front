/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the shared i18n runtime (`app/react/shared/i18n.ts`).
 *
 * These verify the angular-translate parity contract the migrated screens rely
 * on: dot-path key resolution, English-fallback deep merge, missing-key = key,
 * `{{param}}` / `{{::param}}` interpolation, non-English locale rendering, the
 * date-format accessor, and the async `loadCatalog` fetch path. All specs are
 * browserless (jsdom) and never touch the network except through a mocked
 * `fetch`.
 */

import {
  t,
  configureI18n,
  resetI18n,
  getLocale,
  getDateFormat,
  getPickerConfig,
  loadCatalog,
  type TranslationCatalog,
} from '../i18n';

afterEach(() => {
  // Restore pristine English defaults so each spec is fully isolated.
  resetI18n();
  // Clear any window.taigaConfig an rtlLanguages test may have installed.
  delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
  jest.restoreAllMocks();
});

describe('t() — dot-path resolution against the embedded English defaults', () => {
  it('resolves a top-level nested key', () => {
    expect(t('ZOOM.TITLE')).toBe('Zoom:');
  });

  it('resolves a key whose segment contains a hyphen', () => {
    expect(t('ZOOM.ZOOM-1')).toBe('Compact');
    expect(t('ZOOM.ZOOM-4')).toBe('Expanded');
  });

  it('resolves a deeply nested key', () => {
    expect(t('LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME')).toBe('sprint name');
    expect(t('COMMON.FILTERS.CATEGORIES.ASSIGNED_TO')).toBe('Assigned to');
  });

  it('returns the verbatim key when it is absent (angular-translate missing-key parity)', () => {
    expect(t('DOES.NOT.EXIST')).toBe('DOES.NOT.EXIST');
    expect(t('ZOOM.NOPE')).toBe('ZOOM.NOPE');
  });

  it('returns the key (not a stringified object) when the path resolves to a sub-tree', () => {
    // `ZOOM` is an object, not a leaf string -> treated as "not found".
    expect(t('ZOOM')).toBe('ZOOM');
    expect(t('COMMON.FILTERS.CATEGORIES')).toBe('COMMON.FILTERS.CATEGORIES');
  });
});

describe('t() — parameter interpolation', () => {
  it('substitutes a {{::param}} one-time-binding placeholder', () => {
    expect(t('BACKLOG.GO_TO_TASKBOARD', { name: 'Sprint 1' })).toBe('Go to the taskboard of Sprint 1');
  });

  it('substitutes a plain {{param}} placeholder (incl. HTML-bearing strings, left unescaped)', () => {
    expect(t('LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME', { lastSprint: 'Alpha' })).toBe(
      'last sprint is <strong> Alpha ;-) </strong>',
    );
  });

  it('renders a missing / undefined / null param value as an empty string', () => {
    expect(t('BACKLOG.GO_TO_TASKBOARD', {})).toBe('Go to the taskboard of ');
    expect(t('BACKLOG.GO_TO_TASKBOARD', { name: undefined })).toBe('Go to the taskboard of ');
    expect(t('BACKLOG.GO_TO_TASKBOARD', { name: null })).toBe('Go to the taskboard of ');
  });

  it('coerces numeric and boolean params to strings', () => {
    configureI18n({ TEST: { N: 'count={{n}} flag={{b}}' } });
    expect(t('TEST.N', { n: 0, b: false })).toBe('count=0 flag=false');
  });

  it('does not alter a string that has no placeholders', () => {
    expect(t('COMMON.SAVE', { unused: 'x' })).toBe('Save');
  });
});

describe('configureI18n() — non-English locale with English fallback', () => {
  const esPartial: TranslationCatalog = {
    ZOOM: {
      TITLE: 'Zoom',
      'ZOOM-1': 'Compacto',
    },
    COMMON: {
      PICKERDATE: { FORMAT: 'DD/MM/YYYY' },
      FORM_ERRORS: { REQUIRED: 'Valor requerido.' },
    },
  };

  it('renders injected localized values', () => {
    configureI18n(esPartial, 'es');
    expect(t('ZOOM.TITLE')).toBe('Zoom');
    expect(t('ZOOM.ZOOM-1')).toBe('Compacto');
    expect(t('COMMON.FORM_ERRORS.REQUIRED')).toBe('Valor requerido.');
  });

  it('falls back to English for keys absent from the injected catalog', () => {
    configureI18n(esPartial, 'es');
    // Not present in the Spanish partial -> English default backfills.
    expect(t('ZOOM.ZOOM-2')).toBe('Default');
    expect(t('COMMON.SAVE')).toBe('Save');
    expect(t('BACKLOG.EDIT_SPRINT')).toBe('Edit Sprint');
  });

  it('reports the configured locale and localized date format', () => {
    configureI18n(esPartial, 'es');
    expect(getLocale()).toBe('es');
    expect(getDateFormat()).toBe('DD/MM/YYYY');
  });

  it('leaves the locale unchanged when none is supplied', () => {
    configureI18n({ ZOOM: { TITLE: 'Z' } });
    expect(getLocale()).toBe('en');
  });
});

describe('resetI18n() / getDateFormat() defaults', () => {
  it('getDateFormat() returns the English default before any configuration', () => {
    expect(getDateFormat()).toBe('DD MMM YYYY');
    expect(getLocale()).toBe('en');
  });

  it('reverts to English defaults and the "en" locale', () => {
    configureI18n({ ZOOM: { TITLE: 'X' } }, 'de');
    expect(t('ZOOM.TITLE')).toBe('X');
    expect(getLocale()).toBe('de');

    resetI18n();
    expect(t('ZOOM.TITLE')).toBe('Zoom:');
    expect(getLocale()).toBe('en');
  });
});

describe('loadCatalog() — async fetch path', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete (window as { _version?: string })._version;
  });

  it('fetches the versioned locale URL, installs the catalog, and sets the locale', async () => {
    (window as { _version?: string })._version = '6.10.3';

    const frCatalog: TranslationCatalog = { ZOOM: { TITLE: 'Zoom :' } };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(frCatalog),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadCatalog('fr');

    expect(fetchMock).toHaveBeenCalledWith(
      '/6.10.3/locales/taiga/locale-fr.json',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(t('ZOOM.TITLE')).toBe('Zoom :');
    // English fallback still applies for keys absent from the loaded catalog.
    expect(t('COMMON.SAVE')).toBe('Save');
    expect(getLocale()).toBe('fr');
  });

  it('rejects and leaves the active catalog unchanged on a non-OK response', async () => {
    (window as { _version?: string })._version = '6.10.3';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response) as unknown as typeof fetch;

    await expect(loadCatalog('xx')).rejects.toThrow(/Failed to load locale catalog "xx"/);
    // Unchanged: English default still resolves.
    expect(t('ZOOM.TITLE')).toBe('Zoom:');
    expect(getLocale()).toBe('en');
  });

  it('defaults the language to the session preferred language when none is given', async () => {
    // No user info / no configured default -> session.getPreferredLanguage() -> "en".
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadCatalog();

    expect(fetchMock).toHaveBeenCalledWith(
      '/locales/taiga/locale-en.json',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('collapses a missing version into a clean (no double-slash) URL', async () => {
    // No window._version set -> version segment is empty.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await loadCatalog('en');

    expect(fetchMock).toHaveBeenCalledWith(
      '/locales/taiga/locale-en.json',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('getPickerConfig() — DataPickerConfig.get() parity', () => {
  it('assembles the English calendar config (months, weekdays, firstDay, format)', () => {
    const cfg = getPickerConfig();
    expect(cfg.i18n.previousMonth).toBe('Previous Month');
    expect(cfg.i18n.nextMonth).toBe('Next Month');
    expect(cfg.i18n.months).toHaveLength(12);
    expect(cfg.i18n.months[0]).toBe('January'); // January-first
    expect(cfg.i18n.months[11]).toBe('December');
    expect(cfg.i18n.weekdays).toHaveLength(7);
    expect(cfg.i18n.weekdays[0]).toBe('Sunday'); // Sunday-first
    expect(cfg.i18n.weekdaysShort[0]).toBe('Sun');
    expect(cfg.i18n.weekdaysShort[6]).toBe('Sat');
    expect(cfg.firstDay).toBe(1); // COMMON.PICKERDATE.FIRST_DAY_OF_WEEK = "1"
    expect(cfg.format).toBe('DD MMM YYYY');
    expect(cfg.isRTL).toBe(false); // no rtlLanguages config
  });

  it('sources month names, first day, and format from the active (non-English) catalog', () => {
    configureI18n(
      {
        COMMON: {
          PICKERDATE: {
            FORMAT: 'DD/MM/YYYY',
            FIRST_DAY_OF_WEEK: '0',
            PREV_MONTH: 'Mes anterior',
            NEXT_MONTH: 'Mes siguiente',
            MONTHS: { JAN: 'Enero' },
            WEEK_DAYS: { SUN: 'Domingo' },
            WEEK_DAYS_SHORT: { SUN: 'Dom' },
          },
        },
      },
      'es',
    );
    const cfg = getPickerConfig();
    expect(cfg.format).toBe('DD/MM/YYYY');
    expect(cfg.firstDay).toBe(0);
    expect(cfg.i18n.previousMonth).toBe('Mes anterior');
    expect(cfg.i18n.months[0]).toBe('Enero');
    expect(cfg.i18n.weekdays[0]).toBe('Domingo');
    expect(cfg.i18n.weekdaysShort[0]).toBe('Dom');
    // Keys not overridden fall back to the English defaults (deep-merge contract).
    expect(cfg.i18n.months[1]).toBe('February');
  });

  it('flags isRTL when the preferred language is in the rtlLanguages config list', () => {
    (window as unknown as { taigaConfig: unknown }).taigaConfig = {
      rtlLanguages: ['en', 'ar', 'he'],
    };
    // Preferred language resolves to 'en' (no userInfo/defaultLanguage), which is
    // in the list above.
    expect(getPickerConfig().isRTL).toBe(true);
  });

  it('falls back to firstDay 0 when the catalog value is not numeric', () => {
    configureI18n(
      { COMMON: { PICKERDATE: { FIRST_DAY_OF_WEEK: 'not-a-number' } } },
      'xx',
    );
    expect(getPickerConfig().firstDay).toBe(0);
  });
});
