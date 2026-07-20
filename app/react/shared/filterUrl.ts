/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared filter <-> URL (`location.search`) persistence for the migrated React
 * Kanban and Backlog screens.
 *
 * ## Why this module exists
 *
 * The AngularJS Kanban/Backlog controllers persisted the applied sidebar
 * filters to BOTH the browser URL query string AND per-project storage via the
 * `FiltersMixin` (`app/coffee/modules/controllerMixins.coffee:54-140`):
 *
 *   - `selectFilter` / `unselectFilter` / `replaceFilter` mutate individual
 *     `$location.search()` keys, so the query string always reflects the active
 *     filters and the URL is shareable / bookmarkable.
 *   - `storeFilters` mirrors `$location.search()` into `localStorage`.
 *   - `applyStoredFilters` restores from storage ONLY when the URL has no query
 *     params ("URL wins" on load), then `generateFilters` reads
 *     `$location.search()` back to drive the `/userstories` request and, once
 *     `filters_data` resolves, `formatSelectedFilters`
 *     (`controllerMixins.coffee:135-168`) resolves the selected ids into full
 *     filter chips (names + colors).
 *
 * The initial React migration persisted filters to `localStorage` ONLY, so
 * filters survived reload but the URL was never updated (the tracked MINOR
 * deviation in the QA report: "URL not shareable/bookmarkable with filter
 * state"). This module reproduces the URL half of the legacy behaviour with a
 * small set of pure, framework-agnostic helpers plus two thin `window`-touching
 * wrappers, keeping every screen's filter state fully in sync with the URL.
 *
 * ## Coexistence-safe URL writes (the React equivalent of `$location.noreload`)
 *
 * taiga-front runs in HTML5 location mode (`$locationProvider.html5Mode({enabled:
 * true})`, `app/coffee/app.coffee:588`), so the query lives in
 * `window.location.search`. The legacy mixin avoided a full AngularJS route
 * reload on every filter toggle via `$location.noreload()`
 * (`app/coffee/modules/base/location.coffee:10-16`). Because the Kanban/Backlog
 * routes now host React custom elements INSTEAD of AngularJS controllers, the
 * correct React equivalent is `history.replaceState`: it updates the URL WITHOUT
 * firing a `popstate` event, so AngularJS's `$browser.onUrlChange` listener does
 * not fire and the surrounding AngularJS shell never reloads the route (which
 * would otherwise tear down and remount the React root). We also thread the
 * existing `history.state` through the call so AngularJS's own `$location` state
 * bookkeeping is left byte-intact.
 *
 * ## Boundary
 *
 * This module imports ONLY the shared, framework-agnostic serializer from
 * `./filters` and touches ONLY browser globals (`window.location`,
 * `window.history`). It imports no AngularJS/CoffeeScript module and no React,
 * so it stays inside the coexistence boundary (AAP 0.4.2 "globals only") and is
 * trivially unit-testable under jsdom.
 */

import { serializeAppliedFilters, type SerializableAppliedFilter } from './filters';

/**
 * The reserved query key holding the free-text search term (`filterQ` on Kanban,
 * `state.filters.query` on Backlog). Managed alongside the filter chips but kept
 * separate from the category serializer.
 */
export const QUERY_KEY = 'q';

/** Prefix the legacy `FiltersMixin` applied to EXCLUDE-mode category keys. */
const EXCLUDE_PREFIX = 'exclude_';

/**
 * The minimal shape of a filter category needed to resolve a restored id into a
 * display name / color. Structurally satisfied by both `BuiltFilterCategory`
 * (from `./filters`) and the `FilterBar` `FilterCategory`, so callers can pass
 * whichever they already hold without a conversion.
 */
export interface ReconcilableCategory {
  /** Category stem: `status` | `tags` | `assigned_users` | `role` | `owner` | `epic`. */
  dataType: string;
  /** The selectable options (only `id` / `name` / `color` / `photo` are read). */
  content: ReadonlyArray<{
    id: string | number;
    name: string;
    color?: string | null;
    photo?: string | null;
    [key: string]: unknown;
  }>;
}

/**
 * An applied filter restored from the URL. Structurally compatible with both
 * screens' `AppliedFilter` (the tolerant index signature lets it carry the extra
 * presentational fields each `AppliedFilter` declares) so a restored list can be
 * assigned straight into either screen's filter state.
 */
export interface RestoredAppliedFilter {
  /** Option id (or the tag name / `'null'` pseudo-id). */
  id: string | number;
  /** Display label. Falls back to the stringified id until reconciled. */
  name: string;
  /** Category stem (without the `exclude_` prefix). */
  dataType: string;
  /** Whether this filter INCLUDES or EXCLUDES matching stories. */
  mode: 'include' | 'exclude';
  /** Swatch color, filled in during reconciliation when available. */
  color?: string | null;
  /** Tolerate the extra presentational fields each screen's AppliedFilter adds. */
  [key: string]: unknown;
}

/**
 * Parse a URL query string into a plain `{ key: value }` record, reproducing the
 * shape AngularJS's `$location.search()` returned. Last value wins for repeated
 * keys (the legacy serializer never emitted repeats). Values are URL-decoded.
 *
 * @param search - a query string (with or without a leading `?`). Defaults to
 *                 the live `window.location.search` when omitted / undefined.
 * @returns the decoded params (an empty object for an empty / absent query).
 */
export function readLocationSearch(search?: string): Record<string, string> {
  let raw = search;
  if (raw === undefined) {
    raw = typeof window !== 'undefined' && window.location ? window.location.search : '';
  }
  const params: Record<string, string> = {};
  if (!raw) {
    return params;
  }
  const usp = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  usp.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Extract the free-text search term (`q`) from a parsed search record.
 *
 * @param params - a record from {@link readLocationSearch}.
 * @returns the trimmed-as-stored `q` value, or `''` when absent.
 */
export function extractQueryText(params: Record<string, string>): string {
  const value = params[QUERY_KEY];
  return typeof value === 'string' ? value : '';
}

/**
 * True when the current URL (or the supplied search string) carries ANY managed
 * filter key or a non-empty `q`. Used to implement the legacy "URL wins" restore
 * precedence: when this is true the caller restores from the URL, otherwise it
 * falls back to `localStorage` (reproducing `applyStoredFilters`'s
 * `if _.isEmpty(@location.search())` guard).
 *
 * @param validKeys - the whitelist of managed filter keys (include + exclude forms).
 * @param search    - optional query string; defaults to `window.location.search`.
 */
export function locationHasManagedParams(
  validKeys: readonly string[],
  search?: string,
): boolean {
  const params = readLocationSearch(search);
  for (const key of Object.keys(params)) {
    if (key === QUERY_KEY && params[key].length > 0) {
      return true;
    }
    if (validKeys.indexOf(key) !== -1 && params[key].length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Look up an option's `name` / `color` in a set of categories for a given
 * dataType + id. Returns `undefined` when the category or option is not present
 * (e.g. before `filters_data` has resolved, or for a stale bookmarked id).
 */
function findOption(
  categories: readonly ReconcilableCategory[],
  dataType: string,
  id: string | number,
): { name: string; color?: string | null } | undefined {
  const category = categories.find((c) => c.dataType === dataType);
  if (!category) {
    return undefined;
  }
  const option = category.content.find((o) => String(o.id) === String(id));
  if (!option) {
    return undefined;
  }
  return { name: option.name, color: option.color ?? null };
}

/**
 * Convert parsed URL params into a list of applied filters, reproducing the
 * legacy `formatSelectedFilters` (`controllerMixins.coffee:135-168`): each
 * managed key is split on `,` into individual option ids, the `exclude_` prefix
 * maps to `mode: 'exclude'`, and — when `categories` are supplied — each id is
 * resolved to its display `name` / `color`. Before `filters_data` resolves the
 * name defaults to the stringified id and is filled in later by
 * {@link reconcileAppliedFilterNames}.
 *
 * @param params     - a record from {@link readLocationSearch}.
 * @param validKeys  - the whitelist of managed keys (include + exclude forms);
 *                     keys outside it (and `q`) are ignored.
 * @param categories - optional resolved categories for name/color lookup.
 * @returns the restored filters, in `validKeys` order then value order.
 */
export function parseAppliedFiltersFromSearch(
  params: Record<string, string>,
  validKeys: readonly string[],
  categories?: readonly ReconcilableCategory[],
): RestoredAppliedFilter[] {
  const restored: RestoredAppliedFilter[] = [];
  // Iterate validKeys (not params) so restored chips follow the canonical
  // include/exclude category order rather than URL param order.
  for (const key of validKeys) {
    const rawValue = params[key];
    if (typeof rawValue !== 'string' || rawValue.length === 0) {
      continue;
    }
    const isExclude = key.indexOf(EXCLUDE_PREFIX) === 0;
    const dataType = isExclude ? key.slice(EXCLUDE_PREFIX.length) : key;
    const mode: 'include' | 'exclude' = isExclude ? 'exclude' : 'include';
    const ids = rawValue
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const id of ids) {
      const resolved = categories ? findOption(categories, dataType, id) : undefined;
      restored.push({
        id,
        name: resolved ? resolved.name : id,
        dataType,
        mode,
        color: resolved ? resolved.color ?? null : null,
      });
    }
  }
  return restored;
}

/**
 * Fill in the `name` / `color` of filters that are still unresolved (i.e. were
 * restored from the URL before `filters_data` loaded, so their `name` is still
 * the raw id) using the now-available categories. This mirrors the legacy flow
 * where `generateFilters` reads the URL first and resolves the labels only once
 * the `filters_data` collection arrives.
 *
 * Returns the SAME array reference when nothing changed, so callers can safely
 * `setState(reconcile(...))` inside an effect without triggering a render loop.
 *
 * @param selected   - the currently-applied filters (possibly with placeholder names).
 * @param categories - the resolved categories to resolve names/colors from.
 */
export function reconcileAppliedFilterNames<T extends RestoredAppliedFilter>(
  selected: readonly T[],
  categories: readonly ReconcilableCategory[],
): T[] {
  if (selected.length === 0 || categories.length === 0) {
    return selected as T[];
  }
  let changed = false;
  const next = selected.map((filter) => {
    // A filter is "unresolved" when its label still equals its stringified id.
    if (filter.name !== String(filter.id)) {
      return filter;
    }
    const resolved = findOption(categories, filter.dataType, filter.id);
    if (!resolved) {
      return filter;
    }
    // Only treat this filter as *changed* when the resolved name/color ACTUALLY
    // differ from the current values. This value-equality check is critical for
    // tag filters, whose id equals their name (e.g. `?tags=ab` -> { id: 'ab',
    // name: 'ab' }): the "unresolved" guard above can NEVER short-circuit them,
    // so without this check every reconcile pass would return a brand-new object
    // with identical fields, flip `changed` to true, and hand the caller a fresh
    // array reference. That defeats the `reconciled === prev` guard in the
    // consuming effect and drives the reconcile -> selectedFilters -> filtersQuery
    // -> reload -> reconcile render loop the QA gate flagged (~76 reload cycles on
    // a `?tags=` load). Resolving a color exactly once (null -> '#rrggbb') is a
    // genuine change and still propagates; once the color is stable we return the
    // SAME reference so the effect guard short-circuits and the loop cannot start.
    const resolvedColor = resolved.color ?? filter.color ?? null;
    if (filter.name === resolved.name && (filter.color ?? null) === resolvedColor) {
      return filter;
    }
    changed = true;
    return { ...filter, name: resolved.name, color: resolvedColor };
  });
  return changed ? next : (selected as T[]);
}

/**
 * Build the query string (WITHOUT a leading `?`) representing the given filters
 * plus optional free-text term, reproducing the legacy `$location.search()`
 * serialization:
 *
 *   - Filter categories are serialized by the shared {@link serializeAppliedFilters}
 *     (`dataType` / `exclude_{dataType}` keyed, comma-joined ids), so the wire
 *     format matches the `/userstories` query byte-for-byte.
 *   - A non-empty `queryText` is appended as `q`.
 *   - Any `existingParams` NOT managed by this module (i.e. not a `validKey` and
 *     not `q`) are preserved, so unrelated query params survive a filter change.
 *   - Commas are kept literal (not percent-encoded) to match AngularJS's
 *     `$location` serialization and keep the URL readable — the same rationale as
 *     the httpClient's manual encoder.
 *
 * @returns the encoded query string, or `''` when there is nothing to encode.
 */
export function buildFilterSearchString(
  selected: readonly SerializableAppliedFilter[],
  validKeys: readonly string[],
  queryText?: string,
  existingParams?: Record<string, string>,
): string {
  const managed = serializeAppliedFilters(selected, validKeys);

  // Start from any unrelated existing params so they are preserved across the
  // rewrite, then overlay the freshly-serialized managed filter keys.
  const out: Record<string, string> = {};
  if (existingParams) {
    for (const key of Object.keys(existingParams)) {
      if (key === QUERY_KEY || validKeys.indexOf(key) !== -1) {
        continue; // drop managed keys; they are re-added from `managed` below
      }
      out[key] = existingParams[key];
    }
  }
  for (const key of Object.keys(managed)) {
    out[key] = managed[key];
  }
  const trimmedQuery = (queryText ?? '').trim();
  if (trimmedQuery.length > 0) {
    out[QUERY_KEY] = trimmedQuery;
  }

  const parts: string[] = [];
  for (const key of Object.keys(out)) {
    // Encode each value, then restore literal commas (the id separator).
    const encoded = encodeURIComponent(out[key]).replace(/%2C/g, ',');
    parts.push(`${encodeURIComponent(key)}=${encoded}`);
  }
  return parts.join('&');
}

/**
 * Persist the given filters + free-text term to the browser URL using
 * `history.replaceState` — the coexistence-safe, no-reload equivalent of the
 * AngularJS `$location.noreload().search(...)` the `FiltersMixin` used (see the
 * module header). No-ops when `window` is unavailable (SSR / non-DOM). Only
 * writes when the composed URL actually differs from the current one, so
 * redundant renders do not churn `history`.
 *
 * The current `window.location.search` is read first so unrelated params are
 * preserved, and `pathname` + `hash` + `history.state` are all kept intact.
 *
 * @param selected  - the currently-applied filters.
 * @param validKeys - the whitelist of managed keys (include + exclude forms).
 * @param queryText - the optional free-text search term (`q`).
 */
export function writeFiltersToLocation(
  selected: readonly SerializableAppliedFilter[],
  validKeys: readonly string[],
  queryText?: string,
): void {
  if (typeof window === 'undefined' || !window.location || !window.history) {
    return;
  }
  const existing = readLocationSearch(window.location.search);
  const search = buildFilterSearchString(selected, validKeys, queryText, existing);
  const { pathname, hash } = window.location;
  const nextUrl = `${pathname}${search ? `?${search}` : ''}${hash}`;
  const currentUrl = `${pathname}${window.location.search}${hash}`;
  if (nextUrl === currentUrl) {
    return;
  }
  try {
    // Thread the existing history.state through so AngularJS's own $location
    // state bookkeeping is preserved; replaceState avoids a new history entry
    // and (unlike a hash/path change) never fires popstate, so the AngularJS
    // shell does not reload the route hosting the React root.
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    /* Some sandboxed contexts forbid history writes; URL persistence is a
     * best-effort UI convenience, so a failure here is safely ignored. */
  }
}
