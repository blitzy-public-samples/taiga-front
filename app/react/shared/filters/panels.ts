/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared filter model — the canonical types and PURE builders that back the
 * `tg-filter` category panel (reproduced by {@link BacklogFilterPanel}). Both
 * the Backlog and Kanban screens reproduce the SAME legacy AngularJS filter DOM
 * (the shared `FiltersMixin`/`UsFiltersMixin` in `controllerMixins.coffee`), so
 * the type shapes and the value/param transforms live here, in `shared/`, and
 * are consumed by both `useBacklogStories` and `useKanbanStories`.
 *
 * The functions are a faithful, framework-free port of the legacy
 * `generateFilters` pipeline:
 *   - `buildDataCollection`  <- the `dataCollection = {}` normalisation block
 *   - `buildFilterPanels`    <- the `@.filters.push({...})` category pushes
 *   - `formatSelectedFilters`/`computeSelectedFilters` <- `formatSelectedFilters`
 *   - `addParamValue`/`removeParamValue` <- `selectFilter`/`unselectFilter`
 *   - `collectCustomFilterParams` <- the params snapshot saved per custom filter
 *
 * The applied-filter model is URL-param based (a `Record<string,string>` of
 * comma-joined ids, keyed by category and its `exclude_` variant), exactly as
 * the legacy controllers kept `location.search()`.
 */

import { t } from "../i18n/translate";

/**
 * The filter categories the shared filter panel can present, in the legacy push
 * order (`generateFilters`). A screen omits categories via the `excludeFilters`
 * argument to {@link buildFilterPanels} (e.g. Kanban excludes `status`, since a
 * status-column board is already grouped by status).
 */
export const FILTER_CATEGORIES: readonly string[] = [
    "status",
    "tags",
    "assigned_users",
    "role",
    "owner",
    "epic",
];

/** Legacy `excludePrefix` — the `exclude_<category>` URL-param prefix. */
export const EXCLUDE_PREFIX = "exclude_";

/** A normalised, selectable filter value within a category. */
export interface FilterItem {
    id: string;
    name: string;
    color?: string;
    count?: number;
}

/** A filter category panel (one collapsible section in the filter UI). */
export interface FilterPanel {
    title: string;
    dataType: string;
    content: FilterItem[];
    hideEmpty?: boolean;
    totalTaggedElements?: number;
}

/** An applied-filter chip (legacy `formatSelectedFilters` output shape). */
export interface FilterChip {
    id: string;
    key: string;
    dataType: string;
    name: string;
    color?: string;
    mode: "include" | "exclude";
}

/** A saved custom filter (legacy remote-storage entry: name -> params map). */
export interface CustomFilter {
    id: string;
    name: string;
    filter: Record<string, string>;
}

/** A normalised per-category value collection (legacy `dataCollection`). */
export type DataCollection = Record<string, FilterItem[]>;

/** The URL param name for a (category, mode) pair (legacy `excludePrefix.concat`). */
export function paramNameFor(category: string, mode: "include" | "exclude"): string {
    return mode === "exclude" ? `${EXCLUDE_PREFIX}${category}` : category;
}

/** Merge a value into a comma-joined param, uniq (legacy `selectFilter`). */
export function addParamValue(
    params: Record<string, string>,
    name: string,
    value: string,
): Record<string, string> {
    const next = { ...params };
    const existing = next[name]
        ? next[name].split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    existing.push(String(value));
    next[name] = Array.from(new Set(existing)).join(",");
    return next;
}

/** Remove a value from a comma-joined param; delete the key when empty (legacy `unselectFilter`). */
export function removeParamValue(
    params: Record<string, string>,
    name: string,
    value: string,
): Record<string, string> {
    const next = { ...params };
    if (next[name] === undefined) {
        return next;
    }
    const remaining = next[name]
        .split(",")
        .map((x) => x.trim())
        .filter((v) => v.length > 0 && v !== String(value));
    if (remaining.length === 0) {
        delete next[name];
    } else {
        next[name] = Array.from(new Set(remaining)).join(",");
    }
    return next;
}

/**
 * Normalise the `getUserStoriesFilters` response into per-category
 * {@link FilterItem} lists (legacy `generateFilters` dataCollection: id->string,
 * derived name, "Unassigned"/"Not in an epic" fallbacks).
 */
export function buildDataCollection(filtersData: unknown): DataCollection {
    const fd = (filtersData ?? {}) as Record<string, Array<Record<string, unknown>>>;
    const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
    const mapUser = (list: Array<Record<string, unknown>> | undefined): FilterItem[] =>
        (list ?? []).map((it) => ({
            id: it.id != null ? str(it.id) : "null",
            name: (it.full_name as string) || "Unassigned",
            count: typeof it.count === "number" ? it.count : undefined,
        }));
    return {
        status: (fd.statuses ?? []).map((it) => ({
            id: str(it.id),
            name: str(it.name),
            color: typeof it.color === "string" ? it.color : undefined,
            count: typeof it.count === "number" ? it.count : undefined,
        })),
        tags: (fd.tags ?? []).map((it) => ({
            id: str(it.name),
            name: str(it.name),
            color: typeof it.color === "string" ? it.color : undefined,
            count: typeof it.count === "number" ? it.count : undefined,
        })),
        assigned_users: mapUser(fd.assigned_users),
        role: (fd.roles ?? []).map((it) => ({
            id: it.id != null ? str(it.id) : "null",
            name: str(it.name) || "Unassigned",
            count: typeof it.count === "number" ? it.count : undefined,
        })),
        owner: (fd.owners ?? []).map((it) => ({
            id: str(it.id),
            name: (it.full_name as string) || str(it.username),
            count: typeof it.count === "number" ? it.count : undefined,
        })),
        epic: (fd.epics ?? []).map((it) =>
            it.id != null
                ? {
                      id: str(it.id),
                      name: `#${str(it.ref)} ${str(it.subject)}`,
                      count: typeof it.count === "number" ? it.count : undefined,
                  }
                : {
                      id: "null",
                      name: "Not in an epic",
                      count: typeof it.count === "number" ? it.count : undefined,
                  },
        ),
    };
}

/**
 * Build the category panels (legacy `filters.push` with translated titles).
 * `excludeFilters` omits categories by `dataType` (Kanban passes `["status"]`).
 */
export function buildFilterPanels(
    dc: DataCollection,
    excludeFilters: readonly string[] = [],
): FilterPanel[] {
    const taggedWithContent = (dc.tags ?? []).filter((it) => (it.count ?? 0) > 0).length;
    const all: FilterPanel[] = [
        {
            title: t("COMMON.FILTERS.CATEGORIES.STATUS"),
            dataType: "status",
            content: dc.status ?? [],
        },
        {
            title: t("COMMON.FILTERS.CATEGORIES.TAGS"),
            dataType: "tags",
            content: dc.tags ?? [],
            hideEmpty: true,
            totalTaggedElements: taggedWithContent,
        },
        {
            title: t("COMMON.FILTERS.CATEGORIES.ASSIGNED_TO"),
            dataType: "assigned_users",
            content: dc.assigned_users ?? [],
        },
        {
            title: t("COMMON.FILTERS.CATEGORIES.ROLE"),
            dataType: "role",
            content: dc.role ?? [],
        },
        {
            title: t("COMMON.FILTERS.CATEGORIES.CREATED_BY"),
            dataType: "owner",
            content: dc.owner ?? [],
        },
        {
            title: t("COMMON.FILTERS.CATEGORIES.EPIC"),
            dataType: "epic",
            content: dc.epic ?? [],
        },
    ];
    return all.filter((p) => excludeFilters.indexOf(p.dataType) === -1);
}

/** Build applied chips for one category+mode from comma-joined ids (legacy `formatSelectedFilters`). */
export function formatSelectedFilters(
    type: string,
    list: FilterItem[],
    urlIds: string,
    mode: "include" | "exclude",
): FilterChip[] {
    const selectedIds = urlIds.split(",").map((x) => x.trim()).filter(Boolean);
    const selected = list.filter((it) => selectedIds.indexOf(it.id) !== -1);
    const invalidIds = selectedIds.filter((id) => !selected.find((s) => s.id === id));
    const invalidChips: FilterChip[] = invalidIds.map((id) => ({
        id,
        key: `${type}:${id}`,
        dataType: type,
        name: id,
        mode,
    }));
    const validChips: FilterChip[] = selected.map((it) => ({
        id: it.id,
        key: `${type}:${it.id}`,
        dataType: type,
        name: it.name,
        color: it.color,
        mode,
    }));
    return invalidChips.concat(validChips);
}

/** Project the applied chip list from a data collection + params (legacy `generateFilters` loop). */
export function computeSelectedFilters(
    dc: DataCollection,
    params: Record<string, string>,
): FilterChip[] {
    const chips: FilterChip[] = [];
    for (const cat of FILTER_CATEGORIES) {
        const inc = params[cat];
        if (inc) {
            chips.push(...formatSelectedFilters(cat, dc[cat] ?? [], inc, "include"));
        }
        const exc = params[paramNameFor(cat, "exclude")];
        if (exc) {
            chips.push(...formatSelectedFilters(cat, dc[cat] ?? [], exc, "exclude"));
        }
    }
    return chips;
}

/** Collect only the category (include+exclude) params for a saved custom filter. */
export function collectCustomFilterParams(
    params: Record<string, string>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const cat of FILTER_CATEGORIES) {
        if (params[cat]) {
            out[cat] = params[cat];
        }
        const ex = paramNameFor(cat, "exclude");
        if (params[ex]) {
            out[ex] = params[ex];
        }
    }
    return out;
}
