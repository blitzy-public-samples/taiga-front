/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared filter <-> URL persistence helpers
 * (`app/react/shared/filterUrl.ts`) that fix the tracked MINOR deviation
 * "filters persist to localStorage only, not location.search".
 *
 * The helpers reproduce the AngularJS `FiltersMixin`
 * (`app/coffee/modules/controllerMixins.coffee:54-168`):
 *
 *   - `readLocationSearch` / `extractQueryText` parse the URL query string into
 *     the record shape `$location.search()` returned.
 *   - `locationHasManagedParams` implements the `applyStoredFilters`
 *     `if _.isEmpty(@location.search())` "URL wins on load" guard.
 *   - `parseAppliedFiltersFromSearch` reproduces `formatSelectedFilters`
 *     (split on `,`, `exclude_` prefix -> exclude mode, id->chip resolution).
 *   - `reconcileAppliedFilterNames` fills placeholder (id) names once
 *     `filters_data` resolves, returning the SAME reference when nothing changes.
 *   - `buildFilterSearchString` / `writeFiltersToLocation` reproduce the
 *     `$location.search(...)` serialization (comma-joined ids, literal commas,
 *     unrelated params preserved) written via `history.replaceState` (the
 *     no-reload React equivalent of `$location.noreload()`).
 *
 * The suite is hermetic: it drives jsdom's `window.location` / `window.history`
 * directly, performs no fetch/network, and imports no AngularJS/Playwright.
 */

import {
  QUERY_KEY,
  readLocationSearch,
  extractQueryText,
  locationHasManagedParams,
  parseAppliedFiltersFromSearch,
  reconcileAppliedFilterNames,
  buildFilterSearchString,
  writeFiltersToLocation,
  type ReconcilableCategory,
  type RestoredAppliedFilter,
} from '../filterUrl';
import type { SerializableAppliedFilter } from '../filters';

// The Kanban whitelist (hides `status`; keeps epic + owner). Mirrors
// `KanbanApp.VALID_QUERY_PARAMS`.
const KANBAN_KEYS = [
  'exclude_tags',
  'tags',
  'exclude_assigned_users',
  'assigned_users',
  'exclude_role',
  'role',
  'exclude_epic',
  'epic',
  'exclude_owner',
  'owner',
];

// The Backlog whitelist (includes `status`). Mirrors
// `useBacklog.VALID_QUERY_PARAMS`.
const BACKLOG_KEYS = ['exclude_status', 'status', ...KANBAN_KEYS];

/** Restore the jsdom URL to a clean path with no query between tests. */
function resetLocation(path = '/project/project-3/kanban'): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  resetLocation();
});

describe('readLocationSearch', () => {
  it('parses the live window.location.search into a decoded record', () => {
    window.history.replaceState(null, '', '/x?status=13,14&tags=foo%20bar&q=hi');
    const params = readLocationSearch();
    expect(params).toEqual({ status: '13,14', tags: 'foo bar', q: 'hi' });
  });

  it('accepts an explicit search string with or without the leading "?"', () => {
    expect(readLocationSearch('?a=1&b=2')).toEqual({ a: '1', b: '2' });
    expect(readLocationSearch('a=1&b=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns an empty object for an empty query', () => {
    expect(readLocationSearch('')).toEqual({});
    window.history.replaceState(null, '', '/x');
    expect(readLocationSearch()).toEqual({});
  });
});

describe('extractQueryText', () => {
  it('returns the q value when present', () => {
    expect(extractQueryText({ q: 'hello', status: '1' })).toBe('hello');
  });
  it('returns "" when q is absent', () => {
    expect(extractQueryText({ status: '1' })).toBe('');
  });
  it('exposes the reserved query key', () => {
    expect(QUERY_KEY).toBe('q');
  });
});

describe('locationHasManagedParams (URL-wins-on-load guard)', () => {
  it('is true when a managed filter key carries a value', () => {
    expect(locationHasManagedParams(KANBAN_KEYS, '?status=13')).toBe(false); // status not in kanban keys
    expect(locationHasManagedParams(BACKLOG_KEYS, '?status=13')).toBe(true);
    expect(locationHasManagedParams(KANBAN_KEYS, '?tags=foo')).toBe(true);
    expect(locationHasManagedParams(KANBAN_KEYS, '?exclude_epic=null')).toBe(true);
  });

  it('is true when only q carries a value', () => {
    expect(locationHasManagedParams(KANBAN_KEYS, '?q=abc')).toBe(true);
  });

  it('is false for an empty query or only-unrelated params', () => {
    expect(locationHasManagedParams(KANBAN_KEYS, '')).toBe(false);
    expect(locationHasManagedParams(KANBAN_KEYS, '?page=2&foo=bar')).toBe(false);
    expect(locationHasManagedParams(KANBAN_KEYS, '?tags=')).toBe(false); // empty value
  });
});

describe('parseAppliedFiltersFromSearch (formatSelectedFilters parity)', () => {
  it('splits comma-joined ids into individual include filters', () => {
    const params = { status: '13,14' };
    const out = parseAppliedFiltersFromSearch(params, BACKLOG_KEYS);
    expect(out).toEqual([
      { id: '13', name: '13', dataType: 'status', mode: 'include', color: null },
      { id: '14', name: '14', dataType: 'status', mode: 'include', color: null },
    ]);
  });

  it('maps the exclude_ prefix to exclude mode and strips it from the dataType', () => {
    const out = parseAppliedFiltersFromSearch({ exclude_tags: 'foo' }, KANBAN_KEYS);
    expect(out).toEqual([
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude', color: null },
    ]);
  });

  it('ignores q and keys outside the whitelist', () => {
    const out = parseAppliedFiltersFromSearch(
      { q: 'x', page: '2', status: '13' },
      KANBAN_KEYS, // status NOT in kanban keys
    );
    expect(out).toEqual([]);
  });

  it('follows validKeys order, not URL param order', () => {
    const params = { epic: '5', tags: 'a' };
    const out = parseAppliedFiltersFromSearch(params, KANBAN_KEYS);
    // tags precedes epic in KANBAN_KEYS
    expect(out.map((f) => f.dataType)).toEqual(['tags', 'epic']);
  });

  it('resolves names + colors from categories when supplied', () => {
    const categories: ReconcilableCategory[] = [
      {
        dataType: 'status',
        content: [
          { id: 13, name: 'New', color: '#aaa' },
          { id: 14, name: 'Ready', color: '#bbb' },
        ],
      },
    ];
    const out = parseAppliedFiltersFromSearch({ status: '13,14' }, BACKLOG_KEYS, categories);
    expect(out).toEqual([
      { id: '13', name: 'New', dataType: 'status', mode: 'include', color: '#aaa' },
      { id: '14', name: 'Ready', dataType: 'status', mode: 'include', color: '#bbb' },
    ]);
  });

  it('trims whitespace and drops empty segments', () => {
    const out = parseAppliedFiltersFromSearch({ tags: ' a , , b ' }, KANBAN_KEYS);
    expect(out.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('reconcileAppliedFilterNames', () => {
  const categories: ReconcilableCategory[] = [
    { dataType: 'status', content: [{ id: 13, name: 'New', color: '#aaa' }] },
    { dataType: 'tags', content: [{ id: 'foo', name: 'foo', color: '#123' }] },
  ];

  it('fills in placeholder (id) names + colors from categories', () => {
    const selected: RestoredAppliedFilter[] = [
      { id: '13', name: '13', dataType: 'status', mode: 'include', color: null },
    ];
    const out = reconcileAppliedFilterNames(selected, categories);
    expect(out).not.toBe(selected); // changed -> new reference
    expect(out[0]).toEqual({
      id: '13',
      name: 'New',
      dataType: 'status',
      mode: 'include',
      color: '#aaa',
    });
  });

  it('returns the SAME reference when every label is already resolved (no loop)', () => {
    const selected: RestoredAppliedFilter[] = [
      { id: '13', name: 'New', dataType: 'status', mode: 'include', color: '#aaa' },
    ];
    expect(reconcileAppliedFilterNames(selected, categories)).toBe(selected);
  });

  it('returns the same reference when categories are empty', () => {
    const selected: RestoredAppliedFilter[] = [
      { id: '13', name: '13', dataType: 'status', mode: 'include' },
    ];
    expect(reconcileAppliedFilterNames(selected, [])).toBe(selected);
  });

  it('leaves filters whose id has no matching option untouched', () => {
    const selected: RestoredAppliedFilter[] = [
      { id: '999', name: '999', dataType: 'status', mode: 'include' },
    ];
    expect(reconcileAppliedFilterNames(selected, categories)).toBe(selected);
  });

  // Regression for the QA security-gate finding "kanban filter-reconcile reload
  // loop": a TAG filter's id equals its name (e.g. `?tags=foo`), so the
  // "unresolved" guard (name !== id) can NEVER short-circuit it. Before the
  // value-equality fix, reconcile returned a brand-new array on EVERY pass even
  // when nothing had changed, defeating the consuming effect's `reconciled ===
  // prev` guard and driving the reconcile -> filtersQuery -> reload -> reconcile
  // loop (~76 reload cycles on a `?tags=` load). It must now resolve the color
  // exactly once, then return the SAME reference so the loop cannot start.
  it('resolves a tag filter (id === name) color once, then is stable across passes', () => {
    const first: RestoredAppliedFilter[] = [
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'include', color: null },
    ];
    // Pass 1: the color is filled in (null -> '#123') -> a genuine change -> new ref.
    const pass1 = reconcileAppliedFilterNames(first, categories);
    expect(pass1).not.toBe(first);
    expect(pass1[0]).toEqual({
      id: 'foo',
      name: 'foo',
      dataType: 'tags',
      mode: 'include',
      color: '#123',
    });
    // Pass 2: feeding the resolved output back yields NO change -> SAME reference,
    // so the effect guard short-circuits and the reload loop never begins.
    const pass2 = reconcileAppliedFilterNames(pass1, categories);
    expect(pass2).toBe(pass1);
  });

  it('returns the SAME reference for an already-resolved tag filter (id === name)', () => {
    // This is the exact shape that previously looped: id === name AND the color is
    // already resolved. The pre-fix code flipped `changed` to true unconditionally
    // and returned a fresh array here; the fix must return the input reference.
    const selected: RestoredAppliedFilter[] = [
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'include', color: '#123' },
    ];
    expect(reconcileAppliedFilterNames(selected, categories)).toBe(selected);
  });
});

describe('buildFilterSearchString (serialization parity)', () => {
  it('serializes include + exclude filters into comma-joined keys', () => {
    const selected: SerializableAppliedFilter[] = [
      { id: '13', dataType: 'status', mode: 'include' },
      { id: '14', dataType: 'status', mode: 'include' },
      { id: 'foo', dataType: 'tags', mode: 'exclude' },
    ];
    const qs = buildFilterSearchString(selected, BACKLOG_KEYS);
    // status=13,14 & exclude_tags=foo (order follows Object.keys insertion)
    expect(qs).toContain('status=13,14');
    expect(qs).toContain('exclude_tags=foo');
  });

  it('appends a non-empty q and omits an empty/whitespace q', () => {
    const selected: SerializableAppliedFilter[] = [];
    expect(buildFilterSearchString(selected, KANBAN_KEYS, 'hi')).toBe('q=hi');
    expect(buildFilterSearchString(selected, KANBAN_KEYS, '   ')).toBe('');
    expect(buildFilterSearchString(selected, KANBAN_KEYS, '')).toBe('');
  });

  it('keeps commas literal but percent-encodes other special chars', () => {
    const selected: SerializableAppliedFilter[] = [
      { id: 'a b', dataType: 'tags', mode: 'include' },
      { id: 'c', dataType: 'tags', mode: 'include' },
    ];
    const qs = buildFilterSearchString(selected, KANBAN_KEYS);
    expect(qs).toBe('tags=a%20b,c');
  });

  it('preserves unrelated existing params but drops managed keys + q', () => {
    const selected: SerializableAppliedFilter[] = [
      { id: '5', dataType: 'epic', mode: 'include' },
    ];
    const existing = { page: '2', status: '99', q: 'stale', tags: 'old' };
    const qs = buildFilterSearchString(selected, KANBAN_KEYS, undefined, existing);
    expect(qs).toContain('page=2'); // unrelated -> preserved
    expect(qs).toContain('epic=5'); // freshly serialized
    expect(qs).not.toContain('tags=old'); // managed key dropped (not re-added)
    expect(qs).not.toContain('q=stale'); // q dropped (no new q supplied)
    // `status` is unrelated for the KANBAN whitelist, so it IS preserved
    expect(qs).toContain('status=99');
  });

  it('returns "" for no filters and no query', () => {
    expect(buildFilterSearchString([], KANBAN_KEYS)).toBe('');
  });
});

describe('writeFiltersToLocation (history.replaceState, no reload)', () => {
  it('writes the serialized filters to window.location.search', () => {
    resetLocation('/project/project-3/kanban');
    const selected: RestoredAppliedFilter[] = [
      { id: '13', name: 'New', dataType: 'status', mode: 'include' },
    ];
    writeFiltersToLocation(selected, BACKLOG_KEYS, '');
    expect(window.location.pathname).toBe('/project/project-3/kanban');
    expect(window.location.search).toBe('?status=13');
  });

  it('appends q and preserves the pathname + hash', () => {
    resetLocation('/project/project-3/backlog');
    window.history.replaceState(null, '', '/project/project-3/backlog#frag');
    writeFiltersToLocation([], BACKLOG_KEYS, 'search text');
    expect(window.location.pathname).toBe('/project/project-3/backlog');
    expect(window.location.search).toBe('?q=search%20text');
    expect(window.location.hash).toBe('#frag');
  });

  it('clears the query when there are no filters and no q (unrelated params kept)', () => {
    window.history.replaceState(null, '', '/x?tags=foo&page=2');
    writeFiltersToLocation([], KANBAN_KEYS, '');
    // tags (managed) removed; page (unrelated) preserved
    expect(window.location.search).toBe('?page=2');
  });

  it('is idempotent: an identical write does not throw and keeps the URL stable', () => {
    resetLocation('/x');
    const selected: RestoredAppliedFilter[] = [
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'include' },
    ];
    writeFiltersToLocation(selected, KANBAN_KEYS);
    const first = window.location.search;
    writeFiltersToLocation(selected, KANBAN_KEYS);
    expect(window.location.search).toBe(first);
    expect(first).toBe('?tags=foo');
  });

  it('round-trips through parseAppliedFiltersFromSearch', () => {
    resetLocation('/x');
    const selected: RestoredAppliedFilter[] = [
      { id: '13', name: 'New', dataType: 'status', mode: 'include' },
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude' },
    ];
    writeFiltersToLocation(selected, BACKLOG_KEYS, 'q1');
    const params = readLocationSearch();
    expect(extractQueryText(params)).toBe('q1');
    const restored = parseAppliedFiltersFromSearch(params, BACKLOG_KEYS);
    expect(restored).toEqual([
      { id: '13', name: '13', dataType: 'status', mode: 'include', color: null },
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude', color: null },
    ]);
  });
});
