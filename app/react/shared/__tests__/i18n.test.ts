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

describe('D#4 — static card/backlog labels resolve to verbatim English and localize', () => {
  // Each key below is one the migrated screens now route through `t()` instead of
  // hardcoding (finding D#4). The English value MUST equal the corresponding
  // `locale-en.json` string so the English POC renders byte-identically to the
  // AngularJS screens (zero visual change), and each key MUST be a real
  // angular-translate key so a non-English catalog localizes it.
  it('resolves the Kanban card ⋮ menu labels to the tgCardActions COMMON.CARD.* strings', () => {
    expect(t('COMMON.CARD.EDIT')).toBe('Edit card');
    expect(t('COMMON.CARD.ASSIGN_TO')).toBe('Assign To');
    expect(t('COMMON.CARD.DELETE')).toBe('Delete card');
    expect(t('COMMON.CARD.MOVE_TO_TOP')).toBe('Move to top');
    expect(t('COMMON.CARD.ESTIMATION')).toBe('Estimation');
  });

  it('resolves the Kanban card statistic tooltips to their legacy keys', () => {
    expect(t('TASK.FIELDS.IS_IOCAINE')).toBe('Is iocaine');
    expect(t('ATTACHMENT.SECTION_NAME')).toBe('Attachments');
    expect(t('COMMON.WATCHERS.WATCHERS')).toBe('Watchers');
    expect(t('COMMENTS.TITLE')).toBe('Comments');
    expect(t('COMMON.ASSIGNED_TO.NOT_ASSIGNED')).toBe('Not assigned');
  });

  it('resolves the Backlog row menu + status labels to the us-edit-popover keys', () => {
    expect(t('COMMON.EDIT')).toBe('Edit');
    expect(t('COMMON.DELETE')).toBe('Delete');
    expect(t('COMMON.MOVE_TO_TOP')).toBe('Move to top');
    expect(t('BACKLOG.STATUS_NAME')).toBe('Status Name');
  });

  it('resolves the shared write-error, loading, and empty-burndown keys', () => {
    expect(t('NOTIFICATION.WARNING_TEXT')).toBe('Your changes were not saved!');
    expect(t('COMMON.LOADING')).toBe('Loading...');
    expect(t('BACKLOG.CUSTOMIZE_GRAPH')).toBe('Customize your backlog graph');
    expect(t('BACKLOG.CUSTOMIZE_GRAPH_TEXT')).toBe(
      'To have a nice graph that helps you follow the evolution of the project you have to set up the points and sprints through the',
    );
    expect(t('BACKLOG.CUSTOMIZE_GRAPH_ADMIN')).toBe('Admin');
    expect(t('BACKLOG.CUSTOMIZE_GRAPH_TITLE')).toBe(
      'Set up the points and sprints through the Admin',
    );
  });

  it('localizes the routed label keys when a non-English catalog is active', () => {
    // A representative slice of a Spanish catalog. Because these are REAL
    // angular-translate keys, injecting a localized catalog resolves them to the
    // localized text (proving the D#4 fix restored localizability), while keys
    // absent from the slice still fall back to English.
    configureI18n(
      {
        COMMON: {
          CARD: { EDIT: 'Editar tarjeta', DELETE: 'Eliminar tarjeta' },
          EDIT: 'Editar',
        },
        NOTIFICATION: { WARNING_TEXT: '¡No se guardaron los cambios!' },
      },
      'es',
    );

    expect(t('COMMON.CARD.EDIT')).toBe('Editar tarjeta');
    expect(t('COMMON.CARD.DELETE')).toBe('Eliminar tarjeta');
    expect(t('COMMON.EDIT')).toBe('Editar');
    expect(t('NOTIFICATION.WARNING_TEXT')).toBe('¡No se guardaron los cambios!');
    // Absent from the Spanish slice -> English fallback still applies.
    expect(t('COMMON.CARD.MOVE_TO_TOP')).toBe('Move to top');
    expect(getLocale()).toBe('es');
  });
});

describe('w001 L1-L4 — backlog/kanban toolbar labels resolve to verbatim English and localize', () => {
  // The four MINOR label drifts flagged by w001 (search placeholder, add button,
  // tags toggle, summary metrics). Each value MUST equal the corresponding
  // `locale-en.json` string so the English POC matches the AngularJS baseline
  // exactly, and each MUST be a real angular-translate key so it localizes.

  it('L1: resolves the filter search placeholder to COMMON.FILTERS.INPUT_PLACEHOLDER', () => {
    // Shared `tg-input-search` placeholder (input-search.component.coffee:17).
    expect(t('COMMON.FILTERS.INPUT_PLACEHOLDER')).toBe('subject or reference');
  });

  it('L2: resolves the backlog add-user-story buttons to US.ADD / US.ADD_BULK', () => {
    // addnewus.jade: primary button visible text + bulk button aria-label.
    expect(t('US.ADD')).toBe('user story');
    expect(t('US.ADD_BULK')).toBe('Add some new user stories in bulk');
  });

  it('L3: resolves the tags-visibility toggle to BACKLOG.TAGS.*', () => {
    // backlog.jade #show-tags label + wrapper title.
    expect(t('BACKLOG.TAGS.SHOW')).toBe('tags');
    expect(t('BACKLOG.TAGS.TOGGLE')).toBe('Toggle tags visibility');
    expect(t('BACKLOG.TAGS.HIDE')).toBe('Hide tags');
  });

  it('L4: resolves the summary metric labels to BACKLOG.SUMMARY.* (with <br /> line breaks)', () => {
    // summary.jade .summary-stats .description translate keys. The literal
    // `<br />` is preserved verbatim (rendered via dangerouslySetInnerHTML).
    expect(t('BACKLOG.SUMMARY.PROJECT_POINTS')).toBe('project<br />points');
    expect(t('BACKLOG.SUMMARY.DEFINED_POINTS')).toBe('defined<br />points');
    expect(t('BACKLOG.SUMMARY.CLOSED_POINTS')).toBe('closed<br />points');
    expect(t('BACKLOG.SUMMARY.POINTS_PER_SPRINT')).toBe('points /<br />sprint');
  });

  it('strips the unset {{maxFileSizeMsg}} token from ATTACHMENT.ADD via interpolation', () => {
    // The create/edit lightbox passes an explicit empty maxFileSizeMsg so the
    // token resolves to empty, matching angular-translate in the attachments-simple
    // widget (the variable is never set there). Without params the literal token
    // would leak; with params it is stripped.
    expect(t('ATTACHMENT.ADD')).toBe('Add new attachment. {{maxFileSizeMsg}}');
    expect(t('ATTACHMENT.ADD', { maxFileSizeMsg: '' })).toBe('Add new attachment. ');
  });

  it('localizes the w001 toolbar keys when a non-English catalog is active', () => {
    configureI18n(
      {
        US: { ADD: 'historia de usuario' },
        BACKLOG: { TAGS: { SHOW: 'etiquetas' } },
        COMMON: { FILTERS: { INPUT_PLACEHOLDER: 'asunto o referencia' } },
      },
      'es',
    );
    expect(t('US.ADD')).toBe('historia de usuario');
    expect(t('BACKLOG.TAGS.SHOW')).toBe('etiquetas');
    expect(t('COMMON.FILTERS.INPUT_PLACEHOLDER')).toBe('asunto o referencia');
    // Absent from the Spanish slice -> English fallback still applies.
    expect(t('US.ADD_BULK')).toBe('Add some new user stories in bulk');
    expect(getLocale()).toBe('es');
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
