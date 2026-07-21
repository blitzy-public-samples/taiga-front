/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Project-scoped `localStorage` persistence for the React Backlog screen's
 * sidebar filter selection + search query.
 *
 * This reproduces the BEHAVIOR of the AngularJS backlog's persistence layer:
 * the `filtersMixin` `storeFilters` / `applyStoredFilters` with
 * `storeFiltersName = "backlog-filters"` (app/coffee/modules/backlog/main.coffee
 * at the migrated revision, via controllerMixins.coffee). It is the direct
 * Backlog counterpart of {@link module:app/react/kanban/persistence} and shares
 * that module's semantics exactly — only the storage key base differs
 * ("backlog-filters" vs "kanban-filters").
 *
 * The AngularJS implementation keyed its localStorage entries with a hex-sha1
 * hash of `[projectId, namespace]` because BOTH frameworks shared one storage
 * and the hash avoided cross-module key collisions. The Backlog screen is now
 * React-only, so no AngularJS consumer reads these keys and byte-exact hashing
 * is unnecessary; we instead use clear, stable, project-scoped keys. The
 * semantics (per-project, restored on load, written on every change) are
 * preserved exactly.
 *
 * Every accessor is defensive against an unavailable or throwing
 * `localStorage` (non-browser host, private mode, quota exceeded) and against
 * malformed stored JSON — a failure degrades gracefully to "nothing stored"
 * so it can never blank or crash the board. This mirrors the safe-storage
 * pattern already used by the shared session adapter
 * (app/react/shared/session/auth.ts) and the Kanban persistence module.
 */

/**
 * Per-project localStorage key for the sidebar filters + search query. The base
 * name mirrors AngularJS's `storeFiltersName = "backlog-filters"`.
 */
const FILTERS_KEY = "backlog-filters";

/**
 * The persisted filter payload: the free-text search query (`q`) plus the
 * currently-selected sidebar filter values. Generic over the concrete
 * selected-filter shape so this module stays a leaf dependency (it never
 * imports from the Backlog feature that consumes it).
 */
export interface PersistedBacklogFilters<TFilter> {
    /** The free-text search query (mirrors the `q` URL param). */
    q: string;
    /** The user's active sidebar filter selection. */
    selected: TFilter[];
}

/** True only for a real, finite project id (guards transient-NaN ids). */
function isPersistableProjectId(projectId: number): boolean {
    return Number.isFinite(projectId);
}

/** Build the project-scoped key for a given base name. */
function keyFor(base: string, projectId: number): string {
    return `${base}.${projectId}`;
}

/**
 * Read a raw string from localStorage. Returns `null` when the key is absent
 * OR when localStorage is unavailable/throws (non-browser host, privacy mode).
 */
function readRaw(key: string): string | null {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return null;
        }
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Write a raw string to localStorage (best-effort; swallows all failures). */
function writeRaw(key: string, value: string): void {
    try {
        if (typeof window === "undefined" || window.localStorage == null) {
            return;
        }
        window.localStorage.setItem(key, value);
    } catch {
        /* best-effort: ignore storage failures (private mode, quota, jsdom) */
    }
}

/* -------------------------------------------------------------------------- */
/* Sidebar filters + search query (QA finding #4)                             */
/* -------------------------------------------------------------------------- */

/**
 * Restore the persisted sidebar filters + search query for a project, or
 * `null` when nothing is stored. Port of the `filtersMixin` `applyStoredFilters`
 * (`storeFiltersName = "backlog-filters"`).
 *
 * Legacy parity (QA finding #4, controllerMixins.coffee `getFilters` L125-133):
 * the mixin explicitly `delete data.q` before returning the stored filters, so
 * the free-text search query is NEVER restored on load — only the `selected`
 * sidebar chips are. Reloading the board therefore shows the FULL story set
 * (search cleared) while preserving the active filter selection. We reproduce
 * that here by always returning `q: ""`, regardless of any `q` that
 * `saveBacklogFilters` may have written. A missing/invalid `selected` still
 * degrades to an empty array so a partially-corrupt entry never throws. This is
 * identical to the Kanban `loadKanbanFilters` behavior, so BOTH migrated screens
 * treat a reload the same way.
 */
export function loadBacklogFilters<TFilter>(
    projectId: number,
): PersistedBacklogFilters<TFilter> | null {
    if (!isPersistableProjectId(projectId)) {
        return null;
    }
    const raw = readRaw(keyFor(FILTERS_KEY, projectId));
    if (raw === null) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {
            return null;
        }
        const obj = parsed as { q?: unknown; selected?: unknown };
        // Mirror legacy `delete data.q`: the search query is dropped on load.
        const q = "";
        const selected = Array.isArray(obj.selected)
            ? (obj.selected as TFilter[])
            : [];
        return { q, selected };
    } catch {
        return null;
    }
}

/**
 * Persist the sidebar filters + search query for a project. Port of the
 * `filtersMixin` `storeFilters`. The whole payload (including `q`) is written;
 * only {@link loadBacklogFilters} drops `q` on the way back out.
 */
export function saveBacklogFilters<TFilter>(
    projectId: number,
    value: PersistedBacklogFilters<TFilter>,
): void {
    if (!isPersistableProjectId(projectId)) {
        return;
    }
    writeRaw(keyFor(FILTERS_KEY, projectId), JSON.stringify(value));
}
