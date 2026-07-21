/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Project-scoped `localStorage` persistence for the React Kanban board's view
 * preferences: column fold modes, swimlane fold modes, and the sidebar filter
 * selection + search query.
 *
 * This reproduces the BEHAVIOR of the AngularJS board's persistence layer:
 *   - column fold modes  -> `storeStatusColumnModes` / `getStatusColumnModes`
 *   - swimlane fold modes -> `storeSwimlanesModes` / `getSwimlanesModes`
 *   - sidebar filters     -> the `filtersMixin` `storeFilters` /
 *     `applyStoredFilters` with `storeFiltersName = "kanban-filters"`
 * (all in app/coffee/modules/kanban/main.coffee at the migrated revision).
 *
 * The AngularJS implementation keyed its localStorage entries with a hex-sha1
 * hash of `[projectId, namespace]` because BOTH frameworks shared one storage
 * and the hash avoided cross-module key collisions. The Kanban board is now
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
 * (app/react/shared/session/auth.ts) and the Backlog root.
 */

/** Per-project localStorage key for the column fold modes. */
const COLUMN_FOLDS_KEY = "kanban-statuscolumn-modes";
/** Per-project localStorage key for the swimlane fold modes. */
const SWIMLANE_FOLDS_KEY = "kanban-swimlanes-modes";
/**
 * Per-project localStorage key for the sidebar filters + search query. The
 * base name mirrors AngularJS's `storeFiltersName = "kanban-filters"`.
 */
const FILTERS_KEY = "kanban-filters";

/**
 * The persisted filter payload: the free-text search query (`q`) plus the
 * currently-selected sidebar filter values. Generic over the concrete
 * selected-filter shape so this module stays a leaf dependency (it never
 * imports from the Kanban feature that consumes it).
 */
export interface PersistedKanbanFilters<TFilter> {
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

/**
 * Parse a stored JSON object of the form `{ [id]: boolean }` into a
 * numeric-keyed record. Returns `null` for absent/malformed data. JSON object
 * keys are always strings, so each key is coerced back to a number and any
 * non-finite key is dropped.
 */
function parseBooleanRecord(raw: string | null): Record<number, boolean> | null {
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
        const out: Record<number, boolean> = {};
        for (const [rawKey, rawValue] of Object.entries(
            parsed as Record<string, unknown>,
        )) {
            const id = Number(rawKey);
            if (Number.isFinite(id)) {
                out[id] = Boolean(rawValue);
            }
        }
        return out;
    } catch {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* Column fold modes (QA-FUNC-03)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Restore the persisted column fold modes for a project, or `null` when
 * nothing is stored. Port of `getStatusColumnModes(projectId)`.
 */
export function loadColumnFolds(
    projectId: number,
): Record<number, boolean> | null {
    if (!isPersistableProjectId(projectId)) {
        return null;
    }
    return parseBooleanRecord(readRaw(keyFor(COLUMN_FOLDS_KEY, projectId)));
}

/**
 * Persist the column fold modes for a project. Port of
 * `storeStatusColumnModes(projectId)`.
 */
export function saveColumnFolds(
    projectId: number,
    folds: Record<number, boolean>,
): void {
    if (!isPersistableProjectId(projectId)) {
        return;
    }
    writeRaw(keyFor(COLUMN_FOLDS_KEY, projectId), JSON.stringify(folds));
}

/* -------------------------------------------------------------------------- */
/* Swimlane fold modes (QA-FUNC-03)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Restore the persisted swimlane fold modes for a project, or `null` when
 * nothing is stored. Port of `getSwimlanesModes(projectId)`.
 */
export function loadSwimlaneFolds(
    projectId: number,
): Record<number, boolean> | null {
    if (!isPersistableProjectId(projectId)) {
        return null;
    }
    return parseBooleanRecord(readRaw(keyFor(SWIMLANE_FOLDS_KEY, projectId)));
}

/**
 * Persist the swimlane fold modes for a project. Port of
 * `storeSwimlanesModes(projectId)`.
 */
export function saveSwimlaneFolds(
    projectId: number,
    folds: Record<number, boolean>,
): void {
    if (!isPersistableProjectId(projectId)) {
        return;
    }
    writeRaw(keyFor(SWIMLANE_FOLDS_KEY, projectId), JSON.stringify(folds));
}

/* -------------------------------------------------------------------------- */
/* Sidebar filters + search query (QA-FUNC-09)                                */
/* -------------------------------------------------------------------------- */

/**
 * Restore the persisted sidebar filters + search query for a project, or
 * `null` when nothing is stored. Port of the `filtersMixin` `applyStoredFilters`
 * (`storeFiltersName = "kanban-filters"`).
 *
 * Legacy parity (QA-FUNC, controllerMixins.coffee `getFilters` L125-133): the
 * mixin explicitly `delete data.q` before returning the stored filters, so the
 * free-text search query is NEVER restored on load — only the `selected`
 * sidebar chips are. Reloading the board therefore shows the FULL story set
 * (search cleared) while preserving the active filter selection. We reproduce
 * that here by always returning `q: ""`, regardless of any `q` that
 * `saveKanbanFilters` may have written. A missing/invalid `selected` still
 * degrades to an empty array so a partially-corrupt entry never throws.
 */
export function loadKanbanFilters<TFilter>(
    projectId: number,
): PersistedKanbanFilters<TFilter> | null {
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
 * `filtersMixin` `storeFilters`.
 */
export function saveKanbanFilters<TFilter>(
    projectId: number,
    value: PersistedKanbanFilters<TFilter>,
): void {
    if (!isPersistableProjectId(projectId)) {
        return;
    }
    writeRaw(keyFor(FILTERS_KEY, projectId), JSON.stringify(value));
}
