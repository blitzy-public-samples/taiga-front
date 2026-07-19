/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/filters.ts — pure, framework-agnostic port of the AngularJS
 * `UsFiltersMixin` (`app/coffee/modules/controllerMixins.coffee`), the shared
 * mixin BOTH the Kanban board and the Backlog used to build their sidebar
 * filter facets from `/userstories/filters_data`.
 *
 * WHY SHARED: the legacy `<tg-filter>` panel was identical on both screens; only
 * the `excludeFilters` list differed (Kanban excluded the `status` facet because
 * status IS the columns; the Backlog showed every facet). This module reproduces
 * `generateFilters` exactly and takes the excluded-facet list as a parameter, so
 * each screen supplies its own. It performs NO fetch / API / WebSocket work — the
 * caller passes the already-fetched `FiltersData` in and receives plain display
 * structures out ("props down, events up").
 *
 * The result shapes ({@link FilterCategory}, {@link SelectedFilter}) are declared
 * here and are structurally identical to the props the presentational
 * `FiltersSidebar` component accepts, so a caller can pass these straight through.
 *
 * Toolchain: TypeScript 5.4.5 under `strict` + `isolatedModules`, Node
 * v16.19.1-compatible. No runtime dependencies beyond the shared domain types.
 */

import type { FilterOption, FiltersData } from './types';

/* ========================================================================== *
 * Result shapes (structurally identical to the FiltersSidebar props).
 * ========================================================================== */

/**
 * A processed filter category as emitted by `generateFilters` and consumed by the
 * sidebar's `.filters-cats` list. `dataType` is the facet key (e.g. `"status"`,
 * `"tags"`, `"assigned_users"`, `"owner"`); `title` is the section heading;
 * `content` is the list of selectable options. `hideEmpty` + `totalTaggedElements`
 * drive the empty-category skip rule for the `tags` facet.
 */
export interface FilterCategory {
    dataType: string;
    title: string;
    content: FilterOption[];
    hideEmpty?: boolean;
    totalTaggedElements?: number;
}

/**
 * A currently-applied filter (the shape the sidebar renders in its
 * included/excluded buckets). `mode` selects the bucket; `key` is the legacy
 * `type:value` identity used as a stable React key.
 */
export interface SelectedFilter {
    id: number | null;
    key?: string;
    name: string;
    mode: 'include' | 'exclude';
    dataType: string;
    color?: string | null;
}

/* ========================================================================== *
 * Constants (verbatim from `UsFiltersMixin`).
 * ========================================================================== */

/** `UsFiltersMixin.excludePrefix`. */
export const EXCLUDE_PREFIX = 'exclude_';

/**
 * `UsFiltersMixin.filterCategories` — the URL/param keys iterated when resolving
 * the currently-applied filters. Each key doubles as a `dataCollection` key.
 */
export const FILTER_CATEGORY_KEYS: ReadonlyArray<string> = [
    'tags',
    'status',
    'assigned_users',
    'assigned_to',
    'owner',
    'epic',
    'role',
];

/**
 * The filter categories offered by the sidebar, in the exact source order and
 * with the exact source titles (`generateFilters` 315-360). `gateKey` is the
 * `excludeFilters` membership test; `dataType` is the value emitted to the
 * sidebar (note `assigned_to -> assigned_users` and `created_by -> owner`);
 * `collectionKey` selects the mapped facet options.
 */
interface CategoryDef {
    gateKey: string;
    dataType: string;
    title: string;
    collectionKey: string;
    hideEmpty?: boolean;
}

const CATEGORY_DEFS: ReadonlyArray<CategoryDef> = [
    { gateKey: 'status', dataType: 'status', title: 'Status', collectionKey: 'status' },
    { gateKey: 'tags', dataType: 'tags', title: 'Tags', collectionKey: 'tags', hideEmpty: true },
    {
        gateKey: 'assigned_to',
        dataType: 'assigned_users',
        title: 'Assigned to',
        collectionKey: 'assigned_users',
    },
    { gateKey: 'role', dataType: 'role', title: 'Role', collectionKey: 'role' },
    { gateKey: 'created_by', dataType: 'owner', title: 'Created by', collectionKey: 'owner' },
    { gateKey: 'epic', dataType: 'epic', title: 'Epic', collectionKey: 'epic' },
];

/* ========================================================================== *
 * Pure helpers.
 * ========================================================================== */

/**
 * Read a facet array from the loosely-typed `/userstories/filters_data` payload,
 * defaulting to an empty array when the key is absent or not an array.
 */
function facet(data: FiltersData | null, key: string): FilterOption[] {
    if (!data) {
        return [];
    }
    const value = (data as Record<string, unknown>)[key];
    return Array.isArray(value) ? (value as FilterOption[]) : [];
}

/**
 * The URL/query value used to identify a filter option, reproducing
 * `generateFilters`'s per-facet id rewriting (`controllerMixins.coffee:252-303`):
 * tags are identified by their name, everything else by its numeric id (or the
 * literal `"null"` for the "Unassigned"/"Not in an epic" buckets). The
 * `FilterOption.id` is left untouched (the shared type contract); this string is
 * computed on demand.
 */
export function optionQueryValue(dataType: string, option: FilterOption): string {
    if (dataType === 'tags') {
        return String(option.name ?? '');
    }
    return option.id == null ? 'null' : String(option.id);
}

/**
 * Build the per-facet option lists from a filters-data payload, reproducing the
 * `dataCollection` mapping in `generateFilters` (`controllerMixins.coffee:252-303`)
 * WITHOUT mutating the source objects. Only the user-visible `name` is
 * normalised; the domain `id` is preserved.
 */
export function buildDataCollection(
    data: FiltersData | null,
): Record<string, FilterOption[]> {
    const mapUser = (it: FilterOption): FilterOption => ({
        ...it,
        name: it.full_name || 'Unassigned',
    });
    return {
        status: facet(data, 'statuses').map((it) => ({ ...it })),
        tags: facet(data, 'tags').map((it) => ({ ...it })),
        assigned_users: facet(data, 'assigned_users').map(mapUser),
        assigned_to: facet(data, 'assigned_to').map(mapUser),
        role: facet(data, 'roles').map((it) => ({ ...it, name: it.name || 'Unassigned' })),
        owner: facet(data, 'owners').map((it) => ({ ...it, name: it.full_name })),
        epic: facet(data, 'epics').map((it) => {
            if (it.id != null) {
                const ref = (it as Record<string, unknown>).ref;
                const subject = (it as Record<string, unknown>).subject;
                return { ...it, name: `#${String(ref ?? '')} ${String(subject ?? '')}` };
            }
            return { ...it, name: 'Not in an epic' };
        }),
    };
}

/**
 * Assemble the `FilterCategory[]` the sidebar renders, in the source order and
 * skipping any facet whose `gateKey` is in `excludeFilters` (Kanban passes
 * `['status']`; the Backlog passes `[]`). The `tags` category carries `hideEmpty`
 * + `totalTaggedElements` exactly as the source did (`generateFilters:325-333`).
 */
export function buildCategories(
    dataCollection: Record<string, FilterOption[]>,
    excludeFilters: ReadonlyArray<string> = [],
): FilterCategory[] {
    const categories: FilterCategory[] = [];
    for (const def of CATEGORY_DEFS) {
        if (excludeFilters.includes(def.gateKey)) {
            continue;
        }
        const content = dataCollection[def.collectionKey] ?? [];
        const category: FilterCategory = {
            dataType: def.dataType,
            title: def.title,
            content,
        };
        if (def.hideEmpty) {
            category.hideEmpty = true;
            category.totalTaggedElements = content.filter((option) => option.count > 0).length;
        }
        categories.push(category);
    }
    return categories;
}

/**
 * Split a comma-joined URL value into the applied `SelectedFilter[]` for a single
 * facet, reproducing `FiltersMixin.formatSelectedFilters`
 * (`controllerMixins.coffee:136-166`): options whose query value is present are
 * "valid" (carry the resolved name/colour); selected ids with no matching option
 * are "invalid" (carry the raw value as the name). Invalid entries precede valid
 * ones, matching the source `invalid.concat(valid)` order.
 */
export function formatSelectedFilters(
    type: string,
    list: FilterOption[],
    urlIds: string,
    mode: 'include' | 'exclude',
): SelectedFilter[] {
    const selectedIds = urlIds.split(',').filter((value) => value.length > 0);
    const valid: SelectedFilter[] = list
        .filter((option) => selectedIds.indexOf(optionQueryValue(type, option)) !== -1)
        .map((option) => ({
            id: option.id,
            key: `${type}:${optionQueryValue(type, option)}`,
            name: option.name ?? '',
            color: option.color ?? null,
            mode,
            dataType: type,
        }));
    const invalid: SelectedFilter[] = selectedIds
        .filter((value) => !list.some((option) => optionQueryValue(type, option) === value))
        .map((value) => ({
            id: null,
            key: `${type}:${value}`,
            name: value,
            mode,
            dataType: type,
        }));
    return invalid.concat(valid);
}

/**
 * Resolve the full applied-filter list from the current selections, iterating the
 * source `filterCategories` and emitting both the include and exclude buckets
 * (`generateFilters:305-313`).
 */
export function buildSelectedFilters(
    dataCollection: Record<string, FilterOption[]>,
    selections: Record<string, string>,
): SelectedFilter[] {
    let result: SelectedFilter[] = [];
    for (const key of FILTER_CATEGORY_KEYS) {
        const excludeKey = EXCLUDE_PREFIX + key;
        const list = dataCollection[key] ?? [];
        if (selections[key]) {
            result = result.concat(formatSelectedFilters(key, list, selections[key], 'include'));
        }
        if (selections[excludeKey]) {
            result = result.concat(
                formatSelectedFilters(key, list, selections[excludeKey], 'exclude'),
            );
        }
    }
    return result;
}

/**
 * Add an option's query value to the include/exclude bucket of a selections map,
 * returning a NEW map (reproduces `addFilter -> selectFilter`). No-op-safe: a
 * value already present is not duplicated.
 */
export function addFilterSelection(
    selections: Record<string, string>,
    dataType: string,
    option: FilterOption,
    mode: 'include' | 'exclude',
): Record<string, string> {
    const key = mode === 'exclude' ? EXCLUDE_PREFIX + dataType : dataType;
    const value = optionQueryValue(dataType, option);
    const current = selections[key]
        ? selections[key].split(',').filter((entry) => entry.length > 0)
        : [];
    if (current.indexOf(value) === -1) {
        current.push(value);
    }
    return { ...selections, [key]: current.join(',') };
}

/**
 * Remove an applied filter's query value from its bucket, returning a NEW map and
 * dropping the key entirely once its last value is removed (reproduces
 * `removeFilter -> unselectFilter`).
 */
export function removeFilterSelection(
    selections: Record<string, string>,
    filter: SelectedFilter,
): Record<string, string> {
    const key = filter.mode === 'exclude' ? EXCLUDE_PREFIX + filter.dataType : filter.dataType;
    const value = filter.key
        ? filter.key.slice(filter.key.indexOf(':') + 1)
        : String(filter.id ?? '');
    if (!selections[key]) {
        return selections;
    }
    const remaining = selections[key]
        .split(',')
        .filter((entry) => entry.length > 0 && entry !== value);
    const next = { ...selections };
    if (remaining.length) {
        next[key] = remaining.join(',');
    } else {
        delete next[key];
    }
    return next;
}
