/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared filter-category builder for the React Kanban and Backlog sidebars.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. This module
 * reproduces `UsFiltersMixin.generateFilters` (`controllerMixins.coffee:229-360`)
 * — the single AngularJS routine that turned the `GET /userstories/filters_data`
 * payload into the ordered list of collapsible filter categories both the
 * Kanban (`KanbanController`) and Backlog (`BacklogController`) screens rendered.
 *
 * WHY THIS EXISTS (QA findings #3–#6 + #11): the previous React `buildFilters`
 * derived categories from the STATIC project record (`tags_colors`, `members`,
 * `roles`), which structurally cannot produce the Epic category, per-option
 * story counts, the "Unassigned" / "Not in an epic" pseudo-options, or the
 * in-use-only tag list. Sourcing from `filters_data` — exactly as the legacy did
 * — fixes all five parity breaks at once. The endpoint and its payload are a
 * frozen `/api/v1/` read; nothing about the backend contract changes.
 *
 * Coexistence boundary (AAP 0.7): imports NOTHING from `app/coffee/**`,
 * `app/modules/**`, `elements.js`, or `angular`. The only import is the sibling
 * `./api/userstories` response type. The returned category/option objects are
 * plain data, structurally compatible with the `FilterBar` component's
 * `FilterCategory` / `FilterCategoryOption` props (both screens render the same
 * `FilterBar`), so no cross-feature type dependency is introduced.
 *
 * FIDELITY NOTES (reproducing `controllerMixins.coffee` line-for-line):
 *  - Category PUSH ORDER is status, tags, assigned_users, role, owner, epic
 *    (`:319-360`). Categories whose `dataType` appears in `excludeFilters` are
 *    dropped AFTER building (Kanban excludes `status`; Backlog excludes nothing).
 *  - Per-option `id` is coerced to a STRING; a `null` id becomes the literal
 *    string `'null'` for assigned_users / role / epic (`:265-303`), which is the
 *    sentinel the query serializer + FilterBar selection use for the
 *    Unassigned / Not-in-an-epic pseudo-options.
 *  - tags use the tag NAME as the id (`:258-260`) and the category carries
 *    `hideEmpty: true` + `totalTaggedElements` = the count of tags with
 *    `count > 0` (`:328-331`), so FilterBar hides `count === 0` tags and shows
 *    the in-use total.
 *  - assigned_users / role names fall back to `'Unassigned'` when empty
 *    (`:269/278/287`); epic name is `#{ref} {subject}` or `'Not in an epic'`
 *    (`:295-303`); owner name is the raw `full_name` (`:290-293`).
 */

import type { FiltersDataOption, FiltersDataResponse } from './api/userstories';

/**
 * A single option inside a built filter category. Structurally compatible with
 * `FilterBar`'s `FilterCategoryOption` (id/name/count/color/photo + index
 * signature), so the built categories can be passed straight to `FilterBar`.
 */
export interface BuiltFilterOption {
  /** String id ('null' for the Unassigned / Not-in-an-epic pseudo-option; tag name for tags). */
  id: string;
  /** Display label. */
  name: string;
  /** Story count for this option (drives the count badge + hideEmpty). */
  count: number;
  /** Swatch color (status / tags / roles), or null/absent. */
  color?: string | null;
  /** Avatar url (assigned_users / owner), or null/absent. */
  photo?: string | null;
  /** Tolerate extra fields (keeps structural compatibility with FilterBar). */
  [key: string]: unknown;
}

/**
 * A built, collapsible filter category. Structurally compatible with
 * `FilterBar`'s `FilterCategory`.
 */
export interface BuiltFilterCategory {
  /** Query-param key stem ('status' | 'tags' | 'assigned_users' | 'role' | 'owner' | 'epic'). */
  dataType: string;
  /** Category heading. */
  title: string;
  /** The selectable options. */
  content: BuiltFilterOption[];
  /** tags-only: hide options whose count is 0. */
  hideEmpty?: boolean;
  /** tags-only: number of tags actually in use (count > 0). */
  totalTaggedElements?: number;
}

/**
 * Human-readable category titles. The React translation surface uses an
 * identity stub (see `FilterBar`'s `t()`), so the English strings the AngularJS
 * `COMMON.FILTERS.CATEGORIES.*` keys resolved to are used directly here,
 * matching the labels the previous `buildFilters` produced ('Tags',
 * 'Assigned to', 'Created by', 'Role').
 */
const TITLES = {
  status: 'Status',
  tags: 'Tags',
  assigned_users: 'Assigned to',
  role: 'Role',
  owner: 'Created by',
  epic: 'Epic',
} as const;

/** Coerce a `filters_data` row id to the string form the legacy used. */
function toStringId(id: number | null | undefined): string {
  // `controllerMixins.coffee:265-303`: `if it.id -> it.id.toString() else 'null'`.
  return id === null || id === undefined ? 'null' : String(id);
}

/**
 * Build the ordered list of filter categories from a `filters_data` payload,
 * reproducing `UsFiltersMixin.generateFilters` (`controllerMixins.coffee`).
 *
 * @param data           - The `GET /userstories/filters_data` response, or null
 *                         (returns `[]` while the fetch is in flight).
 * @param excludeFilters - dataTypes to omit. Kanban passes `['status']`; the
 *                         Backlog passes `[]`.
 * @returns The categories in legacy push order, minus any excluded dataType.
 */
export function buildFilterCategories(
  data: FiltersDataResponse | null | undefined,
  excludeFilters: string[] = [],
): BuiltFilterCategory[] {
  if (!data) {
    return [];
  }

  const categories: BuiltFilterCategory[] = [];

  // 1. STATUS (controllerMixins.coffee:253-256, :319-323) — id.toString().
  const statuses = Array.isArray(data.statuses) ? data.statuses : [];
  categories.push({
    dataType: 'status',
    title: TITLES.status,
    content: statuses.map((it: FiltersDataOption) => ({
      id: toStringId(it.id),
      name: it.name ?? '',
      count: it.count ?? 0,
      color: it.color ?? null,
    })),
  });

  // 2. TAGS (controllerMixins.coffee:257-260, :325-332) — id = tag NAME;
  //    hideEmpty + totalTaggedElements = count of tags with count > 0.
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const tagsWithAtLeastOne = tags.filter((tag: FiltersDataOption) => (tag.count ?? 0) > 0);
  categories.push({
    dataType: 'tags',
    title: TITLES.tags,
    content: tags.map((it: FiltersDataOption) => ({
      id: String(it.name ?? ''),
      name: it.name ?? '',
      count: it.count ?? 0,
      color: it.color ?? null,
    })),
    hideEmpty: true,
    totalTaggedElements: tagsWithAtLeastOne.length,
  });

  // 3. ASSIGNED_USERS (controllerMixins.coffee:263-270, :335-338) — the
  //    ASSIGNED_TO category renders the `assigned_users` collection (with
  //    avatars); null id => 'null' + name 'Unassigned'.
  const assignedUsers = Array.isArray(data.assigned_users) ? data.assigned_users : [];
  categories.push({
    dataType: 'assigned_users',
    title: TITLES.assigned_users,
    content: assignedUsers.map((it: FiltersDataOption) => ({
      id: toStringId(it.id),
      name: it.full_name || 'Unassigned',
      count: it.count ?? 0,
      photo: it.photo ?? null,
    })),
  });

  // 4. ROLE (controllerMixins.coffee:281-289, :342-345) — null id => 'null' +
  //    name 'Unassigned'.
  const roles = Array.isArray(data.roles) ? data.roles : [];
  categories.push({
    dataType: 'role',
    title: TITLES.role,
    content: roles.map((it: FiltersDataOption) => ({
      id: toStringId(it.id),
      name: it.name || 'Unassigned',
      count: it.count ?? 0,
      color: it.color ?? null,
    })),
  });

  // 5. OWNER / "Created by" (controllerMixins.coffee:290-293, :349-352) —
  //    owners always have an id + full_name (no Unassigned fallback).
  const owners = Array.isArray(data.owners) ? data.owners : [];
  categories.push({
    dataType: 'owner',
    title: TITLES.owner,
    content: owners.map((it: FiltersDataOption) => ({
      id: toStringId(it.id),
      name: it.full_name ?? '',
      count: it.count ?? 0,
      photo: it.photo ?? null,
    })),
  });

  // 6. EPIC (controllerMixins.coffee:295-303, :358-359) — null id => 'null' +
  //    'Not in an epic'; else '#{ref} {subject}'.
  const epics = Array.isArray(data.epics) ? data.epics : [];
  categories.push({
    dataType: 'epic',
    title: TITLES.epic,
    content: epics.map((it: FiltersDataOption) => ({
      id: toStringId(it.id),
      name:
        it.id === null || it.id === undefined
          ? 'Not in an epic'
          : `#${it.ref} ${it.subject ?? ''}`.trim(),
      count: it.count ?? 0,
    })),
  });

  // Drop excluded categories AFTER building (controllerMixins.coffee gates each
  // push on `!@.excludeFilters.includes(...)`; filtering here is equivalent and
  // keeps the mapping above uniform).
  return categories.filter((category) => excludeFilters.indexOf(category.dataType) === -1);
}

/**
 * The minimal shape an applied filter must expose to be serialized into query
 * params. Structurally satisfied by both the Kanban and Backlog `AppliedFilter`
 * types (which carry additional presentational fields).
 */
export interface SerializableAppliedFilter {
  /** Option id (or the tag name / `'null'` pseudo-id). */
  id: string | number;
  /** Category stem: `status` | `tags` | `assigned_users` | `role` | `owner` | `epic`. */
  dataType: string;
  /** Whether this filter INCLUDES or EXCLUDES matching stories. */
  mode: 'include' | 'exclude';
}

/**
 * Serialize a list of applied filters into the `/userstories` query params,
 * reproducing the legacy backlog/kanban filter-query builder
 * (`filtersToQueryParams` / the `generateFilters` consumer, main.coffee):
 *
 *   - Group selected options by their category, keyed `dataType` for INCLUDE
 *     and `exclude_{dataType}` for EXCLUDE.
 *   - Only keys present in `validKeys` are emitted (the caller's whitelist,
 *     e.g. Backlog's `VALID_QUERY_PARAMS`), so unknown categories are dropped.
 *   - Each key's value is the comma-joined list of option ids (the exact wire
 *     format the Django `/api/v1/userstories` endpoint expects, byte-frozen).
 *
 * The free-text search (`q`) is intentionally NOT handled here; each screen maps
 * its own search text to `q` separately (Kanban appends it, Backlog reads
 * `filters.query`).
 *
 * @param selected - the currently-applied include/exclude filters.
 * @param validKeys - the whitelist of permitted query keys (include + exclude forms).
 * @returns a `{ key: "id,id,..." }` record ready to merge into the request params.
 */
export function serializeAppliedFilters(
  selected: readonly SerializableAppliedFilter[],
  validKeys: readonly string[],
): Record<string, string> {
  const grouped: Record<string, Array<string | number>> = {};
  for (const filter of selected) {
    const key = filter.mode === 'exclude' ? `exclude_${filter.dataType}` : filter.dataType;
    if (validKeys.indexOf(key) === -1) {
      continue;
    }
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(filter.id);
  }

  const query: Record<string, string> = {};
  for (const key of Object.keys(grouped)) {
    query[key] = grouped[key].join(',');
  }
  return query;
}
