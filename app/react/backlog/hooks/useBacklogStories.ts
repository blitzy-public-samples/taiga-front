/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklogStories — the single custom React hook that owns ALL Backlog /
 * Sprint-Planning screen state and side effects.
 *
 * It reproduces (framework-only migration; behavior preserved exactly):
 *   - `BacklogController` + its directives/toolbar (app/coffee/modules/backlog/main.coffee)
 *   - the drag/move semantics of backlog/sortable.coffee (L39, L145)
 *   - the closed-sprint toggle of backlog/sprints.coffee
 *   - the sprint create/edit success/remove flows of backlog/lightboxes.coffee
 *   - the request shapes of resources/{userstories,sprints}.coffee
 *
 * It is consumed by `../Backlog.tsx`, which destructures EVERY {@link BacklogVM}
 * member below — a missing member is a runtime crash. This hook follows the
 * established sibling precedent `../../kanban/hooks/useKanbanStories.ts`
 * (runtime project window bridge + graceful fallback, immer state-producer
 * transitions, optimistic-move-then-persist with mandated rollback, and a WS
 * effect with consumer-owned debounce).
 *
 * Contract-preserving (constraint C-1): the backend is reached ONLY through
 * `apiClient` using the frozen endpoint keys; no new endpoint, header, or
 * request shape is ever constructed here. WebSocket routing keys are fixed by
 * `subscribeToProject`. There is NO parallel authorization: this hook only READS
 * `project.my_permissions` / `is_backlog_activated` for view gating.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    MountContext,
    Project,
    Milestone,
    UserStory,
    Attachment,
    Status,
    Point,
    Role,
} from "../../shared/types";
import type { ApiClient, BulkStoryOrder, ProjectStats } from "../../shared/api";
import { createApiClient, sanitizeErrorMessage } from "../../shared/api";
import { generateHash } from "../../shared/storage/legacyStorage";
import { t } from "../../shared/i18n/translate";
import {
    setAll as setAppMeta,
    snapshotManagedMeta,
    restoreManagedMeta,
} from "../../shared/meta/appMeta";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";
import type { EventsClient } from "../../shared/ws/events";
import {
    createInitialBacklogState,
    setUserstories,
    setSprints,
    setClosedSprints,
    enqueueDrag,
    shiftDrag,
    clearDragQueue,
    peekDrag,
    shouldCoalesceDrag,
    applyOptimisticMove,
    reconcileMovedStory,
    captureBacklogPositions,
    restoreBacklogStories,
    reinsertBacklogStory,
    moveMetadata,
    prepareBulkUpdateData,
    appendUserstories,
} from "../../shared/state";
import type { BacklogState, PendingDragItem, BacklogPositionDelta } from "../../shared/state";
import type { BacklogStats, BurndownMilestoneStat } from "../BurndownSummary";
import type { StoryFormValues, BulkStoryValues } from "../../shared/lightboxes/storyForm";
import { usePendingDelete } from "../../shared/lightboxes";
import type { PendingDelete } from "../../shared/lightboxes";
import { isProjectWritable } from "../../shared/permissions";
import {
    Savable,
    buildCreateStoryPayload,
    diffStoryValues,
    applyStoryAttachments,
} from "../../shared/lightboxes/storyPayload";

/* ------------------------------------------------------------------------- *
 * Internal types & helpers (module scope, above the hook)
 * ------------------------------------------------------------------------- */

/**
 * The full runtime project shape. It is the AUTHORITATIVE project detail loaded
 * from the frozen REST surface (`GET /projects/by_slug?slug=<slug>` via
 * `apiClient.getProjectBySlug`), which carries the rich fields the screen gates
 * and renders on (`my_permissions`, `is_backlog_activated`, `points`, `roles`,
 * `us_statuses`, members, aggregate totals). `Project` is the structural base;
 * this extension names the additional fields the backlog reads. Mirrors the
 * `ProjectRuntime` extension used by `useKanbanStories.ts`.
 */
type ProjectRuntime = Project & {
    i_am_admin?: boolean;
    default_us_status?: number;
    us_statuses?: Status[];
    points?: Point[];
    roles?: Role[];
    members?: unknown[];
    total_story_points?: number | null;
    total_milestones?: number | null;
    total_closed_milestones?: number | null;
};

/**
 * Dependency-free date parser (replaces moment in `findCurrentSprint` /
 * sprint sorting). Parses a leading `YYYY-MM-DD` to LOCAL midnight ms (TZ-safe,
 * matching the legacy `moment(date, 'YYYY-MM-DD')`), else falls back to
 * `Date.parse`. Returns `null` for empty/invalid input.
 */
function parseYmdMs(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) {
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    }
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
}

/** Inclusive random integer in [start, end] (matches the kanban precedent). */
function randomInt(start: number, end: number): number {
    return start + Math.floor(Math.random() * (end - start + 1));
}

/** A trailing-debounced function that also exposes a `cancel()` for cleanup. */
interface Debounced<A extends unknown[]> {
    (...args: A): void;
    cancel: () => void;
}

/**
 * Consumer-owned trailing debounce (the WS/search debounce is the caller's
 * responsibility per `subscribeToProject`). Matches the kanban precedent.
 */
function debounceTrailing<A extends unknown[]>(
    wait: number,
    fn: (...args: A) => void,
): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wrapped = (...args: A): void => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    };
    (wrapped as Debounced<A>).cancel = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return wrapped as Debounced<A>;
}

/**
 * localStorage boolean-preference helpers keyed by the LEGACY
 * `taiga.generateHash` key and storing the value as a JSON boolean — EXACTLY as
 * the AngularJS `$storage.set(hash, bool)` / `$storage.get(hash)` did
 * (resources/userstories.coffee L169-177). Reproducing the hash + JSON encoding
 * makes React read/write the SAME entry a user already toggled from the stock
 * screen, rather than stranding it behind a fresh `taiga-react.*` key (M5).
 * `readStoredBool` returns `null` when the key is absent or non-boolean so the
 * caller can apply the legacy default. Guarded so private-mode / quota errors
 * never break the screen.
 */
function readStoredBool(key: string): boolean | null {
    try {
        if (typeof window === "undefined" || !window.localStorage) {
            return null;
        }
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "boolean" ? parsed : null;
    } catch {
        return null;
    }
}

function writeStoredBool(key: string, value: boolean): void {
    try {
        if (typeof window === "undefined" || !window.localStorage) {
            return;
        }
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore quota/security errors */
    }
}

/**
 * Legacy `showTags` storage key: `taiga.generateHash([projectId,
 * "<projectId>:backlog-tags"])` (resources/userstories.coffee L13,L170-172).
 */
const showTagsKey = (projectId: number): string =>
    generateHash([projectId, `${projectId}:backlog-tags`]);

/* ------------------------------------------------------------------------- *
 * Filters (finding C4) — faithful reproduction of the legacy backlog filter
 * contract (controllerMixins.coffee `FiltersMixin`/`UsFiltersMixin` +
 * backlog/main.coffee). The applied-filter set is held as a URL-style params
 * object (`Record<string,string>`, e.g. `{ status: "1,2", exclude_tags: "3" }`)
 * — the React equivalent of the legacy `location.search()` picked to
 * `validQueryParams`. It is the single source of truth for what is filtered:
 *   - hydrated on mount from the URL query (`parseUrlQueryParams`) or, when the
 *     URL is empty, from the persisted `backlog-filters` localStorage entry
 *     (`applyStoredFilters`);
 *   - merged into every `loadUserstories` request (data reload);
 *   - persisted back to `backlog-filters` on every change; and
 *   - projected into the applied-chip list + category panels by re-fetching
 *     `getUserStoriesFilters` (legacy `generateFilters`).
 * Custom filters persist to the frozen `user-storage` endpoint (legacy
 * `tgFilterRemoteStorageService`), NOT in-memory (M5).
 * ------------------------------------------------------------------------- */

/**
 * Recognised URL filter query params (legacy backlog `validQueryParams`,
 * main.coffee L55-68). Unlike Kanban, the backlog INCLUDES `status`/
 * `exclude_status` (Kanban is organised BY status column, so it omits them).
 */
const VALID_QUERY_PARAMS: readonly string[] = [
    "exclude_status",
    "status",
    "exclude_tags",
    "tags",
    "exclude_assigned_users",
    "assigned_users",
    "exclude_role",
    "role",
    "exclude_epic",
    "epic",
    "exclude_owner",
    "owner",
];

/**
 * The filter categories the backlog panel renders + groups selected chips under
 * (legacy `UsFiltersMixin.filterCategories`, minus `assigned_to` which the
 * backlog `generateFilters` builds a data collection for but never renders a
 * panel for). Each maps 1:1 to an include/exclude pair in {@link VALID_QUERY_PARAMS}.
 */
const FILTER_CATEGORIES: readonly string[] = [
    "status",
    "tags",
    "assigned_users",
    "role",
    "owner",
    "epic",
];

const EXCLUDE_PREFIX = "exclude_";

/** Legacy custom-filter storage suffix (`UsFiltersMixin.storeCustomFiltersName`). */
const BACKLOG_CUSTOM_FILTERS_SUFFIX = "backlog-custom-filters";

/** Legacy applied-filter storage suffix (`BacklogController.storeFiltersName`). */
const BACKLOG_FILTERS_SUFFIX = "backlog-filters";

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
type DataCollection = Record<string, FilterItem[]>;

/**
 * Read the current URL query string (the hashbang query the AngularJS router
 * carries, else the real `?` search). Mirrors the Kanban precedent helper.
 */
function getUrlSearchString(): string {
    if (typeof window === "undefined" || !window.location) {
        return "";
    }
    const { search, hash } = window.location;
    if (search && search.length > 1) {
        return search;
    }
    const qIdx = hash.indexOf("?");
    return qIdx >= 0 ? hash.slice(qIdx) : "";
}

/** Pick the recognised {@link VALID_QUERY_PARAMS} out of the current URL query. */
function parseUrlQueryParams(): Record<string, string> {
    const out: Record<string, string> = {};
    try {
        const usp = new URLSearchParams(getUrlSearchString());
        for (const key of VALID_QUERY_PARAMS) {
            const v = usp.get(key);
            if (v != null) {
                out[key] = v;
            }
        }
    } catch {
        /* ignore malformed URLs */
    }
    return out;
}

/** Whether the current URL carries ANY query params (legacy `applyStoredFilters` gate). */
function hasUrlSearch(): boolean {
    return getUrlSearchString().replace(/^[?]/, "").length > 0;
}

/** Keep only the recognised {@link VALID_QUERY_PARAMS} of a params object. */
function pickValidParams(params: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of VALID_QUERY_PARAMS) {
        const v = params[key];
        if (typeof v === "string" && v.length > 0) {
            out[key] = v;
        }
    }
    return out;
}

/** Legacy applied-filter localStorage key: `generateHash([pslug, "<pslug>:backlog-filters"])`. */
const backlogFiltersKey = (projectSlug: string): string =>
    generateHash([projectSlug, `${projectSlug}:${BACKLOG_FILTERS_SUFFIX}`]);

/** Read the persisted applied-filter params object (JSON), `null` when absent/invalid. */
function readStoredParams(key: string): Record<string, string> | null {
    try {
        if (typeof window === "undefined" || !window.localStorage) {
            return null;
        }
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        // Drop `q` (legacy `getFilters` deletes it) + keep only string values.
        const rec = parsed as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const k of Object.keys(rec)) {
            if (k !== "q" && typeof rec[k] === "string") {
                out[k] = rec[k] as string;
            }
        }
        return out;
    } catch {
        return null;
    }
}

/** Persist the applied-filter params object as JSON (legacy `storeFilters`). */
function writeStoredParams(key: string, params: Record<string, string>): void {
    try {
        if (typeof window === "undefined" || !window.localStorage) {
            return;
        }
        window.localStorage.setItem(key, JSON.stringify(params));
    } catch {
        /* ignore quota/security errors */
    }
}

/** The URL param name for a (category, mode) pair (legacy `excludePrefix.concat`). */
function paramNameFor(category: string, mode: "include" | "exclude"): string {
    return mode === "exclude" ? `${EXCLUDE_PREFIX}${category}` : category;
}

/** Merge a value into a comma-joined param, uniq (legacy `selectFilter`). */
function addParamValue(
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
function removeParamValue(
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
function buildDataCollection(filtersData: unknown): DataCollection {
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

/** Build the category panels (legacy `filters.push` with translated titles). */
function buildFilterPanels(dc: DataCollection): FilterPanel[] {
    const taggedWithContent = (dc.tags ?? []).filter((it) => (it.count ?? 0) > 0).length;
    return [
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
}

/** Build applied chips for one category+mode from comma-joined ids (legacy `formatSelectedFilters`). */
function formatSelectedFilters(
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
function computeSelectedFilters(
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
function collectCustomFilterParams(params: Record<string, string>): Record<string, string> {
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

/** Sort sprints ascending by `estimated_finish` (legacy lightbox ordering). */
function sortByFinishAsc(sprints: Milestone[]): Milestone[] {
    return [...sprints].sort(
        (a, b) => (parseYmdMs(a.estimated_finish) ?? 0) - (parseYmdMs(b.estimated_finish) ?? 0),
    );
}

/** The latest-finishing open sprint (legacy lightboxes.coffee `getLastSprint`). */
function getLastSprint(openSprints: Milestone[]): Milestone | null {
    const sorted = sortByFinishAsc(openSprints);
    return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * Compute the FORECASTED story subset (finding M3) — the leading ordered
 * backlog stories that fit within the next sprint's remaining velocity capacity.
 * This is the EXACT projection the legacy `calculateForecasting` stored on
 * `$ctrl.forecastedStories` and that the `.forecasting-add-sprint` handler moved
 * into a sprint (main.coffee L245-263, L878-894). Extracted to a pure helper so
 * the visible-story memo AND the forecast add-sprint action share ONE source of
 * truth (they must agree on which stories are being moved).
 *
 * With `speed <= 0` the legacy accumulation loop never broke, so EVERY story is
 * forecast (the enable control is anyway hidden until a velocity exists).
 * Otherwise the running total is seeded with the first open sprint's points —
 * unless that sprint alone already exceeds the velocity, in which case a brand
 * new sprint is forecast and the sum restarts at zero — then each ordered story
 * is kept until the total FIRST exceeds `speed` (the overflowing story is still
 * included, matching the legacy post-push `break`).
 */
function computeForecastedStories(
    userstories: UserStory[],
    sprints: Milestone[],
    speed: number,
): UserStory[] {
    if (!(speed > 0)) {
        return userstories;
    }
    let backlogPointsSum = 0;
    if (sprints.length > 0) {
        const firstPoints = sprints[0].total_points ?? 0;
        backlogPointsSum = firstPoints > speed ? 0 : firstPoints;
    }
    const forecasted: UserStory[] = [];
    for (const us of userstories) {
        backlogPointsSum += us.total_points ?? 0;
        forecasted.push(us);
        if (backlogPointsSum > speed) {
            break;
        }
    }
    return forecasted;
}

/**
 * The sprint whose [estimated_start, estimated_finish] window contains "now"
 * (legacy `findCurrentSprint`, main.coffee L696). Returns `null` when none match.
 */
function findCurrentSprint(sprints: Milestone[]): Milestone | null {
    const now = Date.now();
    return (
        sprints.find((s) => {
            const start = parseYmdMs(s.estimated_start);
            const end = parseYmdMs(s.estimated_finish);
            return start != null && end != null && now >= start && now <= end;
        }) ?? null
    );
}

/**
 * Map the AUTHORITATIVE backend project stats (`GET /projects/{id}/stats`, via
 * `apiClient.getProjectStats`) into the {@link BacklogStats} the summary/burndown
 * render on, reproducing the legacy `loadProjectStats` mapping EXACTLY
 * (main.coffee L257-266): the `completedPercentage` denominator is
 * `total_points || defined_points`. `assigned_points` and `speed` are the REAL
 * backend values — they drive the doom-line and `calculateForecasting` — NOT the
 * previous `closed_points` / `0` placeholders that made forecasting inert (C5).
 * Returns a zeroed {@link BacklogStats} before the stats request resolves.
 */
function computeStats(raw: ProjectStats | null): BacklogStats {
    const total_points = Number(raw?.total_points ?? 0);
    const defined_points = Number(raw?.defined_points ?? 0);
    const closed_points = Number(raw?.closed_points ?? 0);
    const assigned_points = Number(raw?.assigned_points ?? 0);
    const total_milestones = Number(raw?.total_milestones ?? 0);
    // `speed` is not a formally-typed ProjectStats field but IS present on the
    // frozen `/stats` payload (reached through the interface index signature).
    const speedVal: unknown = raw?.speed;
    const speed = typeof speedVal === "number" && Number.isFinite(speedVal) ? speedVal : 0;
    // Legacy denominator (main.coffee L259): total_points, else defined_points.
    const denom = total_points || defined_points;
    const completedPercentage = denom ? Math.round((100 * closed_points) / denom) : 0;
    // Pass the authoritative per-sprint burndown series through unchanged (reached
    // via the ProjectStats index signature); the summary's BurndownChart coerces
    // each field defensively, so an Array guard is all that is required here.
    const rawMilestones: unknown = raw?.milestones;
    const milestones = Array.isArray(rawMilestones)
        ? (rawMilestones as BurndownMilestoneStat[])
        : undefined;
    return {
        total_points,
        defined_points,
        closed_points,
        assigned_points,
        speed,
        completedPercentage,
        total_milestones,
        milestones,
    };
}

/**
 * Graph-placeholder gate reproducing legacy `!(stats.total_points? &&
 * stats.total_milestones?)` (main.coffee L266) — an EXISTENCE check
 * (`0` still shows the graph), not a truthiness check.
 */
function shouldShowGraphPlaceholder(raw: ProjectStats | null): boolean {
    return !(raw != null && raw.total_points != null && raw.total_milestones != null);
}

/* ------------------------------------------------------------------------- *
 * Public VM contract (LOCKED — do NOT rename/drop/retype any member)
 * ------------------------------------------------------------------------- */

/** Open/close + mode + payload for the sprint create/edit lightbox. */
export interface SprintLightboxState {
    open: boolean;
    mode: "create" | "edit";
    sprint: Milestone | null;
    lastSprint: Milestone | null;
}

/**
 * The complete view-model surface consumed by `../Backlog.tsx`. Every member is
 * destructured by the consumer; the object returned by {@link useBacklogStories}
 * MUST contain all of them.
 */
/**
 * Active story lightbox descriptor. The Backlog screen reuses the SAME shared
 * `StoryFormLightbox` / `BulkStoryLightbox` components the Kanban screen uses
 * (finding C7): `create`/`bulk` open a fresh form; `edit` targets `usId` (the
 * full story object is captured in `editStoryRef` when the opener fires).
 */
export interface BacklogLightboxState {
    type: "create" | "edit" | "bulk";
    usId?: number;
}

export interface BacklogVM {
    // ---- state ----
    loading: boolean;
    /**
     * The last user-visible, sanitized error message (M2). `null` when the last
     * relevant operation succeeded. Set by mutation catch-handlers via
     * `sanitizeErrorMessage` so `Backlog.tsx` can surface a live status region
     * instead of failing silently to the console.
     */
    errorMessage: string | null;
    /** True while a story delete is awaiting the server (M2 pending guard). */
    savingUs: boolean;
    /**
     * True while the edit opener is fetching the AUTHORITATIVE by-id detail +
     * attachments before opening the form (C6). Drives an accessible board
     * status region and prevents a blank-content edit.
     */
    editLoading: boolean;
    project: Project | null;
    projectId: number;
    userstories: UserStory[];
    sprints: Milestone[];
    closedSprints: Milestone[];
    closedSprintsVisible: boolean;
    totalMilestones: number;
    totalClosedMilestones: number;
    totalUserStories: number;
    /** M2: another backlog page is available (backend `X-Pagination-Next`). */
    hasMoreUserstories: boolean;
    /** M2: true while an infinite-scroll "load more" (append) fetch is running. */
    loadingMore: boolean;
    currentSprint: Milestone | null;
    stats: BacklogStats | null;
    showGraphPlaceholder: boolean;
    showTags: boolean;
    activeFilters: boolean;
    displayVelocity: boolean;
    forecastNewSprint: boolean;
    filterQ: string;
    /** Applied-filter chips (projected from applied params + fetched category data). */
    selectedFilters: FilterChip[];
    /** Category panels rendered by the filter UI (status/tags/assigned/role/owner/epic). */
    filters: FilterPanel[];
    /** Persisted saved custom filters (from the frozen `user-storage` endpoint). */
    customFilters: CustomFilter[];
    statuses: Status[];
    selectedUs: Set<number>;
    eventsConnected: boolean;
    sprintLightbox: SprintLightboxState;
    apiClient: ApiClient;
    // ---- actions ----
    hasPermission: (perm: string) => boolean;
    isBacklogActivated: boolean;
    loadUserstories: () => void;
    /** M2: fetch + APPEND the next backlog page (infinite scroll / "load more"). */
    loadMoreUserstories: () => void;
    changeQ: (q: string) => void;
    /** Apply a filter option ({category:{dataType}, filter:{id}, mode?}); legacy `addFilterBacklog`. */
    addFilter: (newFilter: unknown) => void;
    /** Remove an applied filter chip; legacy `removeFilterBacklog`. */
    removeFilter: (filter: unknown) => void;
    /** Persist the current applied filters under a name; legacy `saveCustomFilter`. */
    saveCustomFilter: (name: string) => void;
    /** Apply a saved custom filter; legacy `selectCustomFilter`. */
    selectCustomFilter: (f: unknown) => void;
    /** Remove a saved custom filter; legacy `removeCustomFilter`. */
    removeCustomFilter: (f: unknown) => void;
    toggleShowTags: () => void;
    toggleActiveFilters: () => void;
    toggleVelocityForecasting: () => void;
    toggleClosedSprints: () => void;
    moveUs: (
        usList: UserStory[],
        newUsIndex: number,
        newSprintId: number | null,
        previousUs: UserStory | null,
        nextUs: UserStory | null,
    ) => void;
    moveToSprint: (usList: UserStory[], sprintId: number) => void;
    moveUsToTop: (us: UserStory) => void;
    updateUserStoryStatus: (us: UserStory, statusId: number) => void;
    updateUserStoryPoints: (us: UserStory, roleId: number | null, pointId: number) => void;
    deleteUserStory: (us: UserStory) => void;
    /* C7: delete confirmation (localized modal, replacing `window.confirm`) */
    pendingDelete: PendingDelete<UserStory> | null;
    deleteBusy: boolean;
    confirmDelete: () => void;
    cancelDelete: () => void;
    addNewUs: (type: "standard" | "bulk") => void;
    editUserStory: (us: UserStory) => void;
    /** The active story lightbox (create/edit/bulk), or null when closed. */
    activeLightbox: BacklogLightboxState | null;
    /** Close the active story lightbox (also flushed on a successful submit). */
    closeLightbox: () => void;
    /** Persist a create from the shared `StoryFormLightbox` (awaited, guarded, M2-safe). */
    submitNewUs: (values: StoryFormValues) => void;
    /** Persist an edit from the shared `StoryFormLightbox` (dirty PATCH + version). */
    submitEditUs: (values: StoryFormValues) => void;
    /** Bulk-create from the shared `BulkStoryLightbox`. */
    submitBulkUs: (values: BulkStoryValues) => void;
    toggleSelectedUs: (us: UserStory, checked: boolean) => void;
    moveSelectedToCurrentSprint: () => void;
    moveSelectedToLatestSprint: () => void;
    openCreateSprint: () => void;
    openEditSprint: (sprint: Milestone) => void;
    closeSprintLightbox: () => void;
    onSprintSaved: () => void;
    onSprintDeleted: () => void;
    createSprintFromForecasting: () => void;
}

/* ------------------------------------------------------------------------- *
 * The hook
 * ------------------------------------------------------------------------- */

/**
 * Own all Backlog / Sprint-Planning state and side effects for a single mounted
 * screen. `context` is the cross-framework mount payload resolved by the Web
 * Component adapter and passed straight through by `../Backlog.tsx`.
 */
export function useBacklogStories(context: MountContext): BacklogVM {
    // ---- story/sprint data: ONE state object driven by the immer producers ----
    const [state, setState] = useState<BacklogState>(() => createInitialBacklogState());

    // ---- UI-only state (kept separate from the producer-driven data) ----
    const [loading, setLoading] = useState<boolean>(true);
    // M2: user-visible error surface (the raw error is retained for diagnostics;
    // `errorMessage` is the sanitized string rendered by the screen).
    const [, setError] = useState<unknown>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // M2: pending guard for the (confirm-gated) delete flow.
    const [savingUs, setSavingUs] = useState<boolean>(false);
    // C6: the edit opener fetches authoritative detail + attachments BEFORE
    // opening the form. `editLoading` surfaces that fetch; `editLoadingRef`
    // re-open-guards a rapid second click from firing a duplicate fetch.
    const [editLoading, setEditLoading] = useState<boolean>(false);
    const editLoadingRef = useRef<boolean>(false);
    // Active story lightbox (create/edit/bulk). `activeLightboxRef` mirrors it so
    // the awaited submit handlers read the CURRENT target without a stale closure;
    // `editStoryRef` captures the exact story object passed to `editUserStory`
    // (it may live in a sprint, not just the backlog list); `savingUsRef` guards
    // against double-submit (M2).
    const [activeLightbox, setActiveLightbox] = useState<BacklogLightboxState | null>(null);
    const activeLightboxRef = useRef<BacklogLightboxState | null>(null);
    const editStoryRef = useRef<UserStory | null>(null);
    const savingUsRef = useRef<boolean>(false);
    const [project, setProject] = useState<Project | null>(null);
    const [projectId, setProjectId] = useState<number>(0);
    const [statuses, setStatuses] = useState<Status[]>([]);
    const [closedSprintsVisible, setClosedSprintsVisible] = useState<boolean>(false);
    const [totalMilestones, setTotalMilestones] = useState<number>(0);
    const [totalClosedMilestones, setTotalClosedMilestones] = useState<number>(0);
    const [totalUserStories, setTotalUserStories] = useState<number>(0);
    // M2: infinite-scroll pagination. `hasMoreUserstories` reflects the backend
    // `X-Pagination-Next` header (there is another page to load); `loadingMore`
    // is true only while an APPEND (next-page) fetch is in flight so the
    // incremental status region and the scroll trigger stay independent of the
    // main initial-load `loading` flag.
    const [hasMoreUserstories, setHasMoreUserstories] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [currentSprint, setCurrentSprint] = useState<Milestone | null>(null);
    const [stats, setStats] = useState<BacklogStats | null>(null);
    const [showGraphPlaceholder, setShowGraphPlaceholder] = useState<boolean>(true);
    const [showTags, setShowTags] = useState<boolean>(true);
    const [activeFilters, setActiveFilters] = useState<boolean>(false);
    const [displayVelocity, setDisplayVelocity] = useState<boolean>(false);
    const [forecastNewSprint, setForecastNewSprint] = useState<boolean>(true);
    const [filterQ, setFilterQ] = useState<string>("");
    // C4: the full backlog filter contract. `selectedFilters` are the applied
    // chips (projected from `appliedParams` + the fetched category data);
    // `filters` are the category panels; `customFilters` are the persisted saved
    // filters. `appliedParams` is the URL-style params object (source of truth).
    const [selectedFilters, setSelectedFilters] = useState<FilterChip[]>([]);
    const [filters, setFilters] = useState<FilterPanel[]>([]);
    const [customFilters, setCustomFilters] = useState<CustomFilter[]>([]);
    const [appliedParams, setAppliedParams] = useState<Record<string, string>>({});
    const [selectedUs, setSelectedUs] = useState<Set<number>>(() => new Set<number>());
    const [eventsConnected, setEventsConnected] = useState<boolean>(false);
    const [sprintLightbox, setSprintLightbox] = useState<SprintLightboxState>({
        open: false,
        mode: "create",
        sprint: null,
        lastSprint: null,
    });

    // ---- the thin call-through client (stable per mount context) ----
    const apiClient = useMemo<ApiClient>(() => createApiClient(context), [context]);

    // ---- refs to defeat stale closures in async callbacks / WS handlers /
    // move-persist recursion (read the CURRENT value inside callbacks) ----
    const stateRef = useRef<BacklogState>(state);
    const statsRef = useRef<BacklogStats | null>(stats);
    const projectRef = useRef<ProjectRuntime | null>(null);
    const projectIdRef = useRef<number>(0);
    const filterQRef = useRef<string>("");
    // C4 filter refs (defeat stale closures in debounced reloads / async regen).
    const appliedParamsRef = useRef<Record<string, string>>({});
    const dataCollectionRef = useRef<DataCollection>({});
    const pslugRef = useRef<string>(context.projectSlug ?? "");
    const selectedUsRef = useRef<Set<number>>(selectedUs);
    const currentSprintRef = useRef<Milestone | null>(null);
    const eventsClientRef = useRef<EventsClient | null>(null);
    // C5: the latest AUTHORITATIVE backend stats payload (`/projects/{id}/stats`).
    // `refreshStats` recomputes the derived BacklogStats from this ref; a
    // server mutation refreshes it via `reloadStats`.
    const projectStatsRef = useRef<ProjectStats | null>(null);
    // M2: pagination cursor. `pageRef` is the NEXT page to request (legacy
    // `@.page`, starting at 1 and advanced when `X-Pagination-Next` is present);
    // `hasMoreRef`/`loadingMoreRef` mirror the state for use inside async
    // callbacks and the scroll trigger without stale closures.
    const pageRef = useRef<number>(1);
    const hasMoreRef = useRef<boolean>(false);
    const loadingMoreRef = useRef<boolean>(false);
    // M3: forecast story carry. When the forecast "add sprint" action opens the
    // create-sprint modal (no sprint exists yet), the forecasted stories are
    // parked here and moved into the sprint once it is created + the sprint list
    // reloads (legacy `sprintform:create` -> `sprintform:create:success:callback`
    // -> `moveToCurrentSprint(ussToMove)`). `null` when no forecast move is
    // pending (a plain / edit sprint save must NOT move anything).
    const pendingForecastMoveRef = useRef<UserStory[] | null>(null);
    // M9: operation-generation guard. Non-abortable in-flight mutations
    // (create/edit/delete/move/forecast) capture this counter at start and
    // re-check it after every `await`; a slug change / unmount / board reload
    // bumps it (see the mount-effect cleanup), so a completion or rollback that
    // resolves AFTER the board has moved on is IGNORED rather than mutating (or
    // rolling back) the freshly-loaded board. Mirrors the kanban precedent
    // (`useKanbanStories.ts` `opGenerationRef`).
    const opGenerationRef = useRef<number>(0);
    // M1: per-operation rollback. Instead of snapshotting the WHOLE state at
    // batch start (which erases newer concurrent changes on rollback — CWE-362),
    // we capture the FIRST pre-move position delta per involved story id and, on
    // failure, restore ONLY those stories onto the CURRENT state. Keyed by story
    // id; the earliest capture per batch wins (dedupe-first).
    const pendingDeltaRef = useRef<Map<number, BacklogPositionDelta>>(
        new Map<number, BacklogPositionDelta>(),
    );

    // Keep the refs in sync with the latest committed render values.
    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    useEffect(() => {
        statsRef.current = stats;
    }, [stats]);
    useEffect(() => {
        selectedUsRef.current = selectedUs;
    }, [selectedUs]);
    useEffect(() => {
        currentSprintRef.current = currentSprint;
    }, [currentSprint]);
    useEffect(() => {
        filterQRef.current = filterQ;
    }, [filterQ]);
    useEffect(() => {
        appliedParamsRef.current = appliedParams;
    }, [appliedParams]);
    useEffect(() => {
        pslugRef.current = context.projectSlug ?? "";
    }, [context.projectSlug]);
    useEffect(() => {
        projectIdRef.current = projectId;
    }, [projectId]);

    /* --------------------------------------------------------------------- *
     * M2 — user-visible error surface. `reportError` records the raw error for
     * diagnostics and publishes a SANITIZED message (never a raw stack / URL /
     * token) for the screen to render. `clearError` resets it before a fresh
     * optimistic mutation so a stale banner never lingers.
     * --------------------------------------------------------------------- */
    const reportError = useCallback((e: unknown): void => {
        setError(e);
        setErrorMessage(sanitizeErrorMessage(e));
    }, []);
    const clearError = useCallback((): void => {
        setError(null);
        setErrorMessage(null);
    }, []);

    /* --------------------------------------------------------------------- *
     * M1 — per-operation rollback helpers (see `pendingDeltaRef`).
     * `captureBatchDeltas` records the CURRENT position of each involved story
     * BEFORE the optimistic move is applied, keeping only the FIRST capture per
     * id for the batch (dedupe-first, so a story moved twice rolls back to its
     * true pre-batch slot). `rollbackBatch` restores exactly those stories onto
     * the CURRENT `stateRef` (never a stale whole-state snapshot) and clears the
     * batch. `clearBatchDeltas` drops the deltas after a successful batch.
     * --------------------------------------------------------------------- */
    const captureBatchDeltas = useCallback((usList: UserStory[]): void => {
        const deltas = captureBacklogPositions(usList);
        const map = pendingDeltaRef.current;
        for (const d of deltas) {
            if (!map.has(d.id)) {
                map.set(d.id, d);
            }
        }
    }, []);
    const rollbackBatch = useCallback((): void => {
        const map = pendingDeltaRef.current;
        if (map.size > 0) {
            const restored = restoreBacklogStories(stateRef.current, Array.from(map.values()));
            stateRef.current = restored;
            setState(restored);
        }
        map.clear();
    }, []);
    const clearBatchDeltas = useCallback((): void => {
        pendingDeltaRef.current.clear();
    }, []);

    /* --------------------------------------------------------------------- *
     * Forecasting (main.coffee L444) — best-effort. Default true; when open
     * sprints exist it flips to false unless velocity (`speed`) is known and the
     * first sprint over-fills it. With the derived `speed = 0` it therefore
     * mirrors the legacy "there are sprints => no forecast-new-sprint prompt".
     * --------------------------------------------------------------------- */
    const calculateForecasting = useCallback((): void => {
        let next = true;
        const openSprints = stateRef.current.sprints;
        if (openSprints.length > 0) {
            const speed = statsRef.current?.speed ?? 0;
            const firstPoints = openSprints[0].total_points ?? 0;
            if (!(speed > 0 && firstPoints > speed)) {
                next = false;
            }
        }
        setForecastNewSprint(next);
    }, []);

    /* --------------------------------------------------------------------- *
     * Loaders (useCallbacks). Those that run during mount take an explicit
     * `pid` so they work before `projectId` state settles; `loadUserstories`
     * reads the refs so it is safe from WS handlers and the US-lightbox bridge.
     * --------------------------------------------------------------------- */

    /** Prefer the runtime project's `us_statuses`; else the filters endpoint; else []. */
    const loadStatuses = useCallback(
        async (pid: number, runtime: ProjectRuntime | null): Promise<void> => {
            let next: Status[] = [];
            const fromRuntime = runtime?.us_statuses;
            if (fromRuntime && fromRuntime.length) {
                next = [...fromRuntime].sort(
                    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
                );
            } else {
                try {
                    const f = await apiClient.getUserStoriesFilters({ project: pid });
                    next = (f as { statuses?: Status[] }).statuses ?? [];
                } catch {
                    next = [];
                }
            }
            setStatuses(next);
        },
        [apiClient],
    );

    /** List open sprints, store them (sorted), set totals + current sprint. */
    const loadSprints = useCallback(
        async (pid: number): Promise<Milestone[]> => {
            const res = await apiClient.listMilestones(pid, { closed: false });
            setState((s) => setSprints(s, res.milestones));
            setTotalMilestones(res.open + res.closed);
            setTotalClosedMilestones(res.closed);
            const current = findCurrentSprint(res.milestones);
            setCurrentSprint(current);
            currentSprintRef.current = current;
            return res.milestones;
        },
        [apiClient],
    );

    /** List closed sprints and store them (the closed-sprint toggle target). */
    const loadClosedSprints = useCallback(
        async (pid: number): Promise<void> => {
            const res = await apiClient.listMilestones(pid, { closed: true });
            setState((s) => setClosedSprints(s, res.milestones));
            setTotalClosedMilestones(res.closed);
        },
        [apiClient],
    );

    /**
     * Load the backlog (unassigned) user stories from the AUTHORITATIVE PAGINATED
     * endpoint (finding M2). Mirrors legacy `BacklogController#loadUserstories`
     * (`resources/userstories.coffee#listUnassigned` via `queryMany` WITHOUT
     * `x-disable-pagination`):
     *   - `resetPagination` (default `true`) resets the cursor to page 1 and
     *     REPLACES the list; `false` fetches the tracked next page and APPENDS
     *     (dedup + re-sort) so infinite scroll accumulates pages.
     *   - `pageSize` is forwarded to the backend `page_size` (used by
     *     `reloadLoadedUserstories` to refetch every loaded story in one page).
     *   - `totalUserStories` is set from the AUTHORITATIVE
     *     `Taiga-Info-Backlog-Total-Userstories` header (NOT `list.length`,
     *     which only counted the loaded rows — the defect this fixes); it falls
     *     back to the page length only if the header is somehow absent.
     *   - `X-Pagination-Next` drives `hasMore` + page advancement (legacy
     *     `if header('x-pagination-next'): @.page++`).
     * The applied filter params + search `q` are merged into every request
     * (C4). M9: a slug change / reload that supersedes this fetch is discarded.
     */
    const loadUserstories = useCallback(
        async (resetPagination = true, pageSize?: number): Promise<void> => {
            const pid = projectIdRef.current;
            if (!pid) {
                return;
            }
            if (resetPagination) {
                pageRef.current = 1;
            }
            const page = pageRef.current;
            const gen = opGenerationRef.current;
            // C4: merge the applied filter params (`status`, `tags`, `exclude_*`,
            // …) into the list request — the data reload the legacy
            // `loadUserstories` performed via
            // `_.pick(location.search(), validQueryParams)`. `milestone:"null"`
            // is supplied by the client (the unassigned/backlog draw).
            const result = await apiClient.listUnassignedUserStories(
                pid,
                {
                    ...appliedParamsRef.current,
                    q: filterQRef.current,
                    page,
                },
                pageSize,
            );
            // M9: ignore a load whose board was superseded by a slug change.
            if (opGenerationRef.current !== gen) {
                return;
            }
            const sortedPage = [...result.userStories].sort(
                (a, b) => (a.backlog_order ?? 0) - (b.backlog_order ?? 0),
            );
            setState((current) =>
                resetPagination
                    ? setUserstories(current, sortedPage)
                    : appendUserstories(current, sortedPage),
            );
            // M2: AUTHORITATIVE total from the header, not the loaded-row count.
            setTotalUserStories(
                result.backlogTotal !== null
                    ? result.backlogTotal
                    : result.userStories.length,
            );
            // M2: advance the cursor + track "has more" from `X-Pagination-Next`.
            hasMoreRef.current = result.hasNext;
            setHasMoreUserstories(result.hasNext);
            if (result.hasNext) {
                pageRef.current = page + 1;
            }
        },
        [apiClient],
    );

    /**
     * Fetch the NEXT backlog page and APPEND it (finding M2 — infinite scroll /
     * "load more"). No-op when there is no next page or an append is already in
     * flight. `loadingMore` drives the incremental `role=status` region while
     * the fetch runs; DnD/WS reconciliation is preserved because
     * `appendUserstories` dedups against the already-loaded (possibly
     * optimistically-moved) rows.
     */
    const loadMoreUserstories = useCallback(async (): Promise<void> => {
        if (!hasMoreRef.current || loadingMoreRef.current) {
            return;
        }
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            await loadUserstories(false);
        } catch (e) {
            reportError(e);
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    }, [loadUserstories, reportError]);

    /**
     * Reload EVERY currently-loaded story in a SINGLE request (finding M2).
     * Mirrors legacy `reloadLoadedUserstories`: it refetches with
     * `page_size = <loaded count>` and `resetPagination = true` so a refresh
     * after a mutation / WebSocket event does not SHRINK a list the user
     * scrolled to expand, then RESTORES the page cursor so the next "load more"
     * continues from the right place. Falls back to the default page size when
     * nothing is loaded yet.
     */
    const reloadLoadedUserstories = useCallback((): Promise<void> => {
        const savedPage = pageRef.current;
        const loaded = stateRef.current.userstories.length;
        return loadUserstories(true, loaded > 0 ? loaded : undefined).then(() => {
            pageRef.current = savedPage;
        });
    }, [loadUserstories]);

    /**
     * Recompute the derived {@link BacklogStats} from the cached AUTHORITATIVE
     * backend stats (`projectStatsRef`) — SYNC. Used by pure-UI toggles and as
     * the tail of `reloadStats`. The graph-placeholder gate uses the legacy
     * existence check (main.coffee L266).
     */
    const refreshStats = useCallback((): void => {
        const s = computeStats(projectStatsRef.current);
        statsRef.current = s;
        setStats(s);
        setShowGraphPlaceholder(shouldShowGraphPlaceholder(projectStatsRef.current));
        calculateForecasting();
    }, [calculateForecasting]);

    /**
     * Refetch the AUTHORITATIVE project stats (`GET /projects/{id}/stats`) then
     * recompute (mirrors legacy `loadProjectStats`, main.coffee L257). Called
     * after any server mutation that changes points / assignment / milestones and
     * on the milestones WebSocket key. A rejected request surfaces via
     * `reportError` but never blanks the screen (the last-known stats persist).
     */
    const reloadStats = useCallback(
        async (pid: number): Promise<void> => {
            if (!pid) {
                return;
            }
            try {
                const raw = await apiClient.getProjectStats(pid);
                projectStatsRef.current = raw;
            } catch (e) {
                reportError(e);
            }
            refreshStats();
        },
        [apiClient, refreshStats, reportError],
    );


    /* --------------------------------------------------------------------- *
     * Mount effect — keyed [context.projectSlug], run-once guard with
     * cancellation. Resolves the project id, bridges the runtime project (or a
     * graceful fallback), then loads statuses -> sprints -> closed sprints ->
     * userstories, computes stats and forecasting, and hydrates localStorage
     * prefs. On error it still clears `loading` so the screen never hangs.
     * --------------------------------------------------------------------- */
    useEffect(() => {
        let cancelled = false;
        void (async (): Promise<void> => {
            try {
                setLoading(true);
                clearError();
                // C1: load the AUTHORITATIVE project detail by slug from the frozen
                // REST surface (GET /projects/by_slug). Real `my_permissions`,
                // `is_backlog_activated`, `us_statuses`, members, roles, points and
                // totals come from the backend — never `window` globals, never a
                // fabricated read-only fallback. A rejected request (404/403/network)
                // is caught below and fails CLOSED: `project` stays null so the
                // screen renders an error state instead of a permissive stub.
                const runtime = (await apiClient.getProjectBySlug(
                    context.projectSlug ?? "",
                )) as ProjectRuntime;
                if (cancelled) {
                    return;
                }
                const pid = runtime.id;
                projectRef.current = runtime;
                setProject(runtime);

                // C5: module-activation VIEW gate (the backend remains the single
                // authorization enforcement point, constraint C-1). The legacy
                // `BacklogController.loadProject` called
                // `errorHandlingService.permissionDenied()` and did NOT proceed to
                // load any backlog data when `is_backlog_activated` was false. We
                // fail CLOSED with the same intent: publish `project` so the screen
                // can render the deactivated placeholder, but do NOT set `projectId`
                // (so the WebSocket effect below — guarded on `projectId` — never
                // subscribes) and RETURN before fetching statuses / sprints /
                // stories / stats. The `finally` block still clears `loading`.
                // Mirrors the kanban precedent in `useKanbanStories.ts`, which
                // early-returns after the project load when `is_kanban_activated`
                // is false.
                if (runtime.is_backlog_activated === false) {
                    return;
                }
                setProjectId(pid);
                projectIdRef.current = pid;

                // M5: legacy `showTags` preference (taiga.generateHash key, JSON
                // boolean). Default TRUE; flip to false ONLY when the stored value
                // is strictly `false` (main.coffee L494-495). `displayVelocity` is
                // EPHEMERAL in the legacy controller (main.coffee L94) — it is NEVER
                // persisted, so it is neither read here nor written on toggle.
                setShowTags(readStoredBool(showTagsKey(pid)) === false ? false : true);

                // C4: hydrate the applied filters BEFORE the first story load so
                // the initial list request already carries them. Prefer the URL
                // query; when the URL carries no query at all, fall back to the
                // persisted `backlog-filters` entry (legacy `applyStoredFilters`).
                let appliedInit = parseUrlQueryParams();
                if (Object.keys(appliedInit).length === 0 && !hasUrlSearch()) {
                    const stored = readStoredParams(backlogFiltersKey(pslugRef.current));
                    if (stored) {
                        appliedInit = pickValidParams(stored);
                    }
                }
                setAppliedParams(appliedInit);
                appliedParamsRef.current = appliedInit;

                await loadStatuses(pid, runtime);
                await loadSprints(pid);
                if (cancelled) {
                    return;
                }
                await loadClosedSprints(pid);
                await loadUserstories();
                if (cancelled) {
                    return;
                }
                // C4: build the filter category panels + applied chips from the
                // authoritative filter data, and load the persisted custom filters.
                await regenerateFilters(pid, appliedParamsRef.current);
                await loadCustomFilters(pid);
                if (cancelled) {
                    return;
                }
                // C5: authoritative stats from GET /projects/{id}/stats — populates
                // real total/defined/closed/assigned points, milestone count and
                // velocity (`speed`), then recomputes derived stats + forecasting.
                await reloadStats(pid);
            } catch (e) {
                // Fail CLOSED (C1): leave `project` null and surface a sanitized
                // message so the screen shows an error state rather than a
                // permissive, fabricated board.
                if (!cancelled) {
                    reportError(e);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
            // M9: advance the operation generation so any mutation still in
            // flight (its completion/rollback) is ignored after this reload.
            opGenerationRef.current += 1;
        };
        // Loaders are stable (memoized on apiClient); re-running only on the slug
        // avoids reload loops while still reacting to project navigation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context.projectSlug]);

    /* --------------------------------------------------------------------- *
     * M22 — localized page <title>/<meta> (mirror BacklogController first-load
     * `loadInitialData().then` -> appMetaService.setAll, backlog/main.coffee
     * L105-110). Written once the AUTHORITATIVE project detail (name +
     * description) is loaded, so the browser tab reads "Backlog - <projectName>"
     * instead of the previous screen's stale title. The prior <head> tags are
     * snapshotted first and restored on unmount / slug change, so navigating
     * back to an AngularJS screen does not leak the Backlog title (the AngularJS
     * controllers still overwrite on their own load — restore is a safe
     * superset). Shares the exact `shared/meta/appMeta.ts` helper the Kanban
     * screen uses (`useKanbanStories.ts`).
     *
     * Keyed on the identifying project fields (slug/name/description) — NOT the
     * object identity — so an in-place `setProject` merge does not re-run it. On
     * a first-load ERROR `project` stays null, so no misleading Backlog title is
     * written (parity with `onInitialDataError`, which set no metadata).
     * --------------------------------------------------------------------- */
    useEffect(() => {
        if (project == null) {
            return;
        }
        const projectName = project.name ?? "";
        const projectDescription = project.description ?? "";
        const snapshot = snapshotManagedMeta();
        setAppMeta(
            t("BACKLOG.PAGE_TITLE", { projectName }),
            t("BACKLOG.PAGE_DESCRIPTION", { projectName, projectDescription }),
        );
        return () => {
            restoreManagedMeta(snapshot);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project?.slug, project?.name, project?.description]);

    /* --------------------------------------------------------------------- *
     * WebSocket effect — keyed [projectId], only when truthy (mirrors kanban).
     * Reproduces `initializeSubscription` (main.coffee L206): the userstories
     * key reloads userstories + sprints; the milestones key reloads sprints +
     * closed sprints + stats. The consumer owns the debounce;
     * `subscribeToProject` attaches `{ selfNotification: true }` for milestones
     * internally, so it is NOT passed here. Backlog subscribes only
     * onUserStories + onMilestones (never onProjects).
     * --------------------------------------------------------------------- */
    useEffect(() => {
        // C5: fail closed. `projectId` is only set once the project loaded AND
        // `is_backlog_activated` was true (see the load effect), so a deactivated
        // module leaves `projectId` null and never reaches here. The explicit
        // activation re-check is defensive — it keeps the WebSocket subscription
        // gated even if a future refactor sets `projectId` earlier.
        if (!projectId || projectRef.current?.is_backlog_activated === false) {
            return;
        }
        const client = createEventsClient(context);
        eventsClientRef.current = client;
        const onUserStories = debounceTrailing(randomInt(700, 1000), (): void => {
            // M2: WS reload preserves the loaded page depth (partial-list safe).
            void reloadLoadedUserstories();
            void loadSprints(projectId);
        });
        const onMilestones = debounceTrailing(randomInt(700, 1000), (): void => {
            void loadSprints(projectId);
            void loadClosedSprints(projectId);
            void reloadStats(projectId);
        });
        const cleanup = subscribeToProject(client, projectId, { onUserStories, onMilestones });
        client.setupConnection();
        setEventsConnected(client.isConnected());
        return () => {
            onUserStories.cancel();
            onMilestones.cancel();
            cleanup();
            client.stop();
            eventsClientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    /* --------------------------------------------------------------------- *
     * Drag/move persistence (main.coffee L523-645): optimistic reshuffle +
     * coalesced queue + single bulk-order call + reconcile + events-disconnected
     * fallback + MANDATED rollback (the AAP adds the rollback the legacy lacked).
     * --------------------------------------------------------------------- */

    /**
     * Drain the head of the pendingDrag queue with exactly one
     * `bulk-update-us-backlog-order` call (legacy `moveUs` with `ctx = null`).
     * On success: reconcile milestone/backlog_order from server truth, shift the
     * queue, then drain the next item or — if the queue is empty and the WS is
     * disconnected — reload from the server (the legacy events-disconnected
     * fallback). On failure: restore the pre-batch snapshot.
     */
    const drainPendingDrag = useCallback((): void => {
        const s0 = stateRef.current;
        const head = peekDrag(s0);
        if (!head) {
            return;
        }
        // M9: capture the operation generation; a board reload during this
        // bulk-order call bumps it, so the completion/rollback below is ignored.
        const gen = opGenerationRef.current;
        const meta = moveMetadata(head.usList, head.newSprintId);
        const pid = projectIdRef.current;
        apiClient
            .bulkUpdateBacklogOrder(
                pid,
                meta.currentSprintId,
                head.previousUs,
                head.nextUs,
                meta.bulkUserstories,
            )
            .then((updated) => {
                // M9: a reload superseded this move — do not touch the fresh board.
                if (opGenerationRef.current !== gen) {
                    return;
                }
                // Reconcile from server truth + shift the queue. We compute the
                // next state from `stateRef.current` (the authoritative in-flight
                // value) and sync the ref SYNCHRONOUSLY here — the `[state]`
                // passive effect only runs after React commits, which is far too
                // late for the recursion below. Reading `stateRef.current` in a
                // microtask instead would observe the STALE pre-shift queue and
                // recurse forever (heap exhaustion). Driving the loop off the
                // freshly-computed `ns` guarantees termination.
                let ns = stateRef.current;
                for (const u of updated) {
                    ns = reconcileMovedStory(ns, u.id, u.milestone ?? null, u.backlog_order);
                }
                ns = shiftDrag(ns);
                stateRef.current = ns;
                setState(ns);
                // Drain the next queued move, or finish the batch.
                if (peekDrag(ns)) {
                    drainPendingDrag();
                    return;
                }
                // Batch fully drained: the optimistic state is now server-truth,
                // so the per-op rollback deltas are no longer needed (M1).
                clearBatchDeltas();
                // Events-disconnected fallback (main.coffee L633-637): when the WS
                // is down, reload from the server so the client re-syncs.
                const connected = eventsClientRef.current?.isConnected() ?? false;
                if (!connected) {
                    void loadSprints(projectIdRef.current);
                    void loadClosedSprints(projectIdRef.current);
                    void reloadStats(projectIdRef.current);
                }
            })
            .catch((err: unknown) => {
                // M9: a reload superseded this move — do not roll back the fresh
                // board (its state no longer contains this batch's optimistic move).
                if (opGenerationRef.current !== gen) {
                    return;
                }
                // MANDATED per-operation ROLLBACK (AAP 0.6.3; M1 CWE-362 fix):
                // restore ONLY the stories this batch moved onto the CURRENT state
                // (never a stale whole-state snapshot), clear the queue, then
                // surface a sanitized message (M2).
                rollbackBatch();
                const cleared = clearDragQueue(stateRef.current);
                stateRef.current = cleared;
                setState(cleared);
                reportError(err);
            });
    }, [
        apiClient,
        loadSprints,
        loadClosedSprints,
        reloadStats,
        clearBatchDeltas,
        rollbackBatch,
        reportError,
    ]);

    /**
     * Enqueue a drag move, apply the optimistic reshuffle, and drain only when
     * this is the FIRST queued move (subsequent moves coalesce and are drained
     * one at a time on resolve). `previousUs`/`nextUs` arrive as UserStory
     * objects from `Backlog.tsx` and are converted to ids for the producer/API.
     */
    const moveUs = useCallback(
        (
            usList: UserStory[],
            newUsIndex: number,
            newSprintId: number | null,
            previousUs: UserStory | null,
            nextUs: UserStory | null,
        ): void => {
            // M4 (defense-in-depth hook guard): a read-only / archived project
            // accepts NO reorder. The row/sprint drag sensors are already gated
            // on `canEditStory`, so this only fires on programmatic misuse; it
            // mirrors the legacy `sortable.coffee` init guard. The backend stays
            // the single enforcement point (constraint C-1).
            const activeProject = projectRef.current;
            if (activeProject && !isProjectWritable(activeProject)) {
                return;
            }
            const item: PendingDragItem = {
                usList,
                newUsIndex,
                newSprintId,
                previousUs: previousUs ? previousUs.id : null,
                nextUs: nextUs ? nextUs.id : null,
            };
            // `stateRef.current` is the authoritative in-flight state (it is kept
            // synchronised on every move/drain transition, ahead of the `[state]`
            // passive effect). Snapshot for rollback only when a NEW batch begins
            // (queue currently empty).
            const base = stateRef.current;
            // M1: capture pre-move positions of the involved stories BEFORE the
            // optimistic reshuffle (dedupe-first per batch); on failure only these
            // stories are restored onto the CURRENT state.
            captureBatchDeltas(usList);
            const next = applyOptimisticMove(enqueueDrag(base, item), item);
            stateRef.current = next;
            setState(next);
            // Only the FIRST enqueued drag fires the API immediately; extras
            // coalesce (shouldCoalesceDrag(next) === next.pendingDrag.length > 1)
            // and are drained one at a time by the in-flight drain's recursion.
            if (!shouldCoalesceDrag(next)) {
                drainPendingDrag();
            }
        },
        [drainPendingDrag, captureBatchDeltas],
    );


    /**
     * Move stories into a sprint (legacy `moveUssToSprint`, main.coffee L779-810):
     * optimistic cross-container move to the front of the target sprint, then one
     * `bulk-update-us-milestone` call, then reload + recompute; rollback on reject.
     */
    const moveToSprint = useCallback(
        (usList: UserStory[], sprintId: number): void => {
            // M4 (defense-in-depth hook guard): a read-only / archived project
            // accepts NO cross-sprint move. Sprint/row drag sensors are gated on
            // `canEditStory`; this only fires on programmatic misuse and mirrors
            // the legacy `sortable.coffee` init guard. Backend stays the single
            // enforcement point (constraint C-1).
            const activeProject = projectRef.current;
            if (activeProject && !isProjectWritable(activeProject)) {
                return;
            }
            const pid = projectIdRef.current;
            // M9: a board reload during the milestone-move supersedes it.
            const gen = opGenerationRef.current;
            // M1: capture pre-move positions before the optimistic cross-container
            // move so a rejected `bulk-update-us-milestone` restores ONLY these
            // stories onto the CURRENT state.
            captureBatchDeltas(usList);
            const item: PendingDragItem = {
                usList,
                newUsIndex: 0,
                newSprintId: sprintId,
                previousUs: null,
                nextUs: null,
            };
            const optimistic = applyOptimisticMove(stateRef.current, item);
            stateRef.current = optimistic;
            setState(optimistic);
            // `prepareBulkUpdateData` yields `order: number | undefined`; coerce the
            // (always-present in practice) sprint_order to the `BulkStoryOrder`
            // `order: number` shape the frozen endpoint expects.
            const bulk: BulkStoryOrder[] = prepareBulkUpdateData(usList, "sprint_order").map(
                (e) => ({ us_id: e.us_id, order: e.order ?? 0 }),
            );
            apiClient
                .bulkUpdateMilestone(pid, sprintId, bulk)
                .then(() => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    clearBatchDeltas();
                    void loadSprints(pid);
                    void loadClosedSprints(pid);
                    void reloadStats(pid);
                })
                .catch((err: unknown) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    // M1 per-op rollback: restore only the moved stories onto the
                    // CURRENT state; M2: surface a sanitized message.
                    rollbackBatch();
                    reportError(err);
                });
        },
        [
            apiClient,
            loadSprints,
            loadClosedSprints,
            reloadStats,
            captureBatchDeltas,
            clearBatchDeltas,
            rollbackBatch,
            reportError,
        ],
    );

    /**
     * Reorder a story to the front of the backlog (legacy
     * `moveUsToTopOfBacklog`, main.coffee L511). No-op when the backlog is empty
     * or the story is already first; otherwise reuse `moveUs` with the current
     * first story as `nextUs`.
     */
    const moveUsToTop = useCallback(
        (us: UserStory): void => {
            const first = stateRef.current.userstories[0];
            if (!first || first.id === us.id) {
                return;
            }
            moveUs([us], 0, null, null, first);
        },
        [moveUs],
    );

    /**
     * Inline status editor on a backlog row: optimistic status change, then a
     * dirty-field PATCH (only `{ status }` + `version` over the wire). On reject,
     * reload to recover server truth.
     */
    const updateUserStoryStatus = useCallback(
        (us: UserStory, statusId: number): void => {
            // M9: ignore this inline edit's completion/recovery after a reload.
            const gen = opGenerationRef.current;
            setState((s) =>
                setUserstories(
                    s,
                    s.userstories.map((u) => (u.id === us.id ? { ...u, status: statusId } : u)),
                ),
            );
            clearError();
            apiClient
                .save("userstories", { ...us, status: statusId }, { status: statusId })
                .then((updated) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    // Replace the local story with the server truth returned by the
                    // PATCH, INCLUDING the incremented `version`. Without this merge a
                    // SECOND inline edit to the same story sends the stale pre-PATCH
                    // version and the backend rejects it with 400 "invalid"
                    // (optimistic-concurrency contract — M1/M2). Mirrors the Kanban
                    // hook, which replaces the model from the save response.
                    setState((s) =>
                        setUserstories(
                            s,
                            s.userstories.map((u) => (u.id === us.id ? { ...u, ...updated } : u)),
                        ),
                    );
                    // Status changes affect closed/assigned points -> authoritative
                    // stats reload (C5).
                    void reloadStats(projectIdRef.current);
                })
                .catch((err: unknown) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    // Recover server truth + surface a sanitized message (M2).
                    void reloadLoadedUserstories();
                    reportError(err);
                });
        },
        [apiClient, reloadLoadedUserstories, reloadStats, clearError, reportError],
    );

    /**
     * Inline points editor: optimistic update of the story's role->point map, then
     * a dirty-field PATCH of `{ points }`. When `roleId` is null (single computable
     * role), apply to the first computable role when known; otherwise still PATCH
     * the map defensively.
     */
    const updateUserStoryPoints = useCallback(
        (us: UserStory, roleId: number | null, pointId: number): void => {
            const newPoints: Record<string, number | null> = { ...(us.points ?? {}) };
            if (roleId != null) {
                newPoints[String(roleId)] = pointId;
            } else {
                const roles = projectRef.current?.roles ?? [];
                const computable = roles.find((r) => r.computable);
                if (computable) {
                    newPoints[String(computable.id)] = pointId;
                }
            }
            const patched = { ...us, points: newPoints };
            // M9: ignore this inline points edit after a board reload.
            const gen = opGenerationRef.current;
            setState((s) =>
                setUserstories(
                    s,
                    s.userstories.map((u) => (u.id === us.id ? patched : u)),
                ),
            );
            clearError();
            apiClient
                .save("userstories", patched, { points: newPoints })
                .then((updated) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    // Merge the PATCH response (incl. the new `version`) into state so
                    // a subsequent edit to the SAME story sends the current version
                    // (optimistic-concurrency contract — M1/M2). Mirrors the Kanban
                    // hook, which replaces the model from the save response.
                    setState((s) =>
                        setUserstories(
                            s,
                            s.userstories.map((u) => (u.id === us.id ? { ...u, ...updated } : u)),
                        ),
                    );
                    // Points changes affect total/assigned points -> authoritative
                    // stats reload (C5).
                    void reloadStats(projectIdRef.current);
                })
                .catch((err: unknown) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    void reloadLoadedUserstories();
                    reportError(err);
                });
        },
        [apiClient, reloadLoadedUserstories, reloadStats, clearError, reportError],
    );

    /**
     * Perform the story delete (C7 INTERNAL mutation): optimistic remove, DELETE,
     * then reload stats + sprints; rollback the removal on reject.
     *
     * This runs ONLY after the user confirms in the shared
     * `ConfirmDeleteLightbox` — it replaces the previous hard-coded English
     * `window.confirm` (a non-localized substitute the review flagged, C7) with
     * the localized modal, faithfully restoring the legacy `$confirm.askOnDelete`
     * flow. It returns the settle promise so the confirmation controller can show
     * the busy state and close the modal once the delete resolves/rejects; it
     * never rejects (it owns its rollback + `reportError`).
     */
    const performDeleteUserStory = useCallback(
        (us: UserStory): Promise<void> => {
            // M1: capture the FULL story so failure re-inserts exactly this
            // story onto the CURRENT state (targeted, not a stale whole-state
            // snapshot). M2: pending guard + sanitized error.
            const removed = us;
            // M9: ignore this delete's completion/rollback after a board reload
            // (the fresh board no longer contains the optimistically-removed row).
            const gen = opGenerationRef.current;
            setSavingUs(true);
            clearError();
            setState((s) => setUserstories(s, s.userstories.filter((u) => u.id !== us.id)));
            return apiClient
                .remove("userstories", us.id)
                .then(() => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    void loadSprints(projectIdRef.current);
                    void reloadStats(projectIdRef.current);
                })
                .catch((err: unknown) => {
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    const restored = reinsertBacklogStory(stateRef.current, removed);
                    stateRef.current = restored;
                    setState(restored);
                    reportError(err);
                })
                .finally(() => {
                    setSavingUs(false);
                });
        },
        [apiClient, loadSprints, reloadStats, clearError, reportError],
    );

    // C7: confirm-before-delete gate — SHARED with Kanban via `usePendingDelete`
    // + `ConfirmDeleteLightbox`. This replaces the previous hard-coded English
    // `window.confirm` with the localized modal (legacy `$confirm.askOnDelete`).
    const {
        pending: pendingDelete,
        busy: deleteBusy,
        request: requestDeleteUserStory,
        cancel: cancelDelete,
        confirm: confirmDelete,
    } = usePendingDelete<UserStory>(performDeleteUserStory);

    /**
     * Request deletion of a story (finding C7): OPENS the confirmation modal
     * labelled with the story subject; nothing is mutated until the user
     * confirms. Signature unchanged (`(us) => void`) so `BacklogRow`'s wiring is
     * untouched.
     */
    const deleteUserStory = useCallback(
        (us: UserStory): void => {
            requestDeleteUserStory(us, us.subject ?? "");
        },
        [requestDeleteUserStory],
    );

    /**
     * Open the shared React create/bulk story lightbox (finding C7). This replaces
     * the previous outward `tg-react:us:new` CustomEvent (dispatched into the void
     * — no AngularJS listener exists, the legacy lightboxes were deleted). The
     * Backlog screen now mounts the SAME `StoryFormLightbox` / `BulkStoryLightbox`
     * the Kanban screen uses. `activeLightboxRef` is updated synchronously so the
     * awaited submit handlers see the current target immediately.
     */
    const addNewUs = useCallback(
        (type: "standard" | "bulk"): void => {
            const next: BacklogLightboxState = { type: type === "bulk" ? "bulk" : "create" };
            activeLightboxRef.current = next;
            editStoryRef.current = null;
            setActiveLightbox(next);
            clearError();
        },
        [clearError],
    );

    /**
     * Open the shared React edit story lightbox for `us` (findings C6 + C7).
     *
     * C6 ROOT-CAUSE FIX: the backlog LIST serializer omits `description` (and
     * lacks the authoritative optimistic-concurrency `version` and the
     * attachments), so seeding the edit form from the list row `us` renders
     * BLANK content that a subsequent save would PATCH away, and attachments
     * could not be managed. Mirroring the legacy US-detail load (and the Kanban
     * `editUs` fix), the opener now fetches the AUTHORITATIVE by-id detail FIRST
     * (FATAL: a failure surfaces a sanitized message and does NOT open a blank
     * form) plus the attachments (NON-FATAL: a failure degrades to `[]`, as the
     * legacy attachments load was independent of the story load), reconciles the
     * full model into every projection (`reinsertBacklogStory` places it back
     * into the backlog list OR its owning sprint, preserving order), and only
     * THEN opens the lightbox seeded from that authoritative model. `submitEditUs`
     * diffs against THIS model, so the dirty-PATCH carries the correct `version`
     * and never blanks the description.
     */
    const editUserStory = useCallback(
        (us: UserStory): void => {
            // C6: re-open guard — a rapid second click must not fire a duplicate
            // detail fetch or open two forms.
            if (editLoadingRef.current) {
                return;
            }
            editLoadingRef.current = true;
            setEditLoading(true);
            clearError();
            // M9: ignore this edit-open entirely if a board reload supersedes it.
            const gen = opGenerationRef.current;
            void (async (): Promise<void> => {
                const pid = projectIdRef.current;
                if (!pid) {
                    // No resolved project yet -> nothing to edit; release guard.
                    editLoadingRef.current = false;
                    setEditLoading(false);
                    return;
                }
                try {
                    // Authoritative detail is FATAL: without it the form cannot
                    // safely seed description/version.
                    const detail = await apiClient.getUserStory(pid, us.id);
                    // Attachments are NON-FATAL: degrade to none rather than
                    // blocking the edit (legacy loaded them independently).
                    let attachments: Attachment[] = [];
                    try {
                        attachments = await apiClient.listUserStoryAttachments(pid, us.id);
                    } catch {
                        attachments = [];
                    }
                    // M9: a reload superseded this edit-open -> discard the fetched
                    // detail and do NOT open a lightbox for the old board.
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    const full: UserStory = { ...detail, attachments };
                    // Reconcile the authoritative detail into every projection so
                    // the backlog row / sprint row reflects it too.
                    const next = reinsertBacklogStory(stateRef.current, full);
                    stateRef.current = next;
                    setState(next);
                    const lb: BacklogLightboxState = { type: "edit", usId: us.id };
                    activeLightboxRef.current = lb;
                    editStoryRef.current = full;
                    setActiveLightbox(lb);
                } catch (e) {
                    // M9: suppress a superseded edit-open's error (stale board).
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                    // Do NOT open a blank form: surface the sanitized error and
                    // leave the board as-is (parity with a failed detail load).
                    reportError(e);
                } finally {
                    editLoadingRef.current = false;
                    setEditLoading(false);
                }
            })();
        },
        [apiClient, clearError, reportError],
    );

    /** Close the active story lightbox and clear the captured edit target. */
    const closeLightbox = useCallback((): void => {
        activeLightboxRef.current = null;
        editStoryRef.current = null;
        setActiveLightbox(null);
    }, []);

    /**
     * Create a single user story from the shared `StoryFormLightbox` (finding C7).
     * Builds the POST body via the SHARED `buildCreateStoryPayload` (identical
     * request-shaping to Kanban), reloads the backlog + authoritative stats on
     * success, and — M2 — is awaited, double-submit guarded, and KEEPS the
     * lightbox open (preserving the typed values) with a sanitized message on
     * failure. The create status falls back to the project's first US status when
     * the form leaves it unset (the backlog has no status columns).
     */
    const submitNewUs = useCallback(
        async (values: StoryFormValues): Promise<void> => {
            const lb = activeLightboxRef.current;
            if (!lb || lb.type !== "create") {
                return;
            }
            if (savingUsRef.current) {
                return;
            }
            savingUsRef.current = true;
            setSavingUs(true);
            clearError();
            // M9: capture the operation generation so a create that resolves
            // AFTER a board reload neither closes a fresh lightbox nor reports a
            // stale error onto the new board.
            const gen = opGenerationRef.current;
            try {
                const pid = projectIdRef.current;
                const fallbackStatusId = projectRef.current?.us_statuses?.[0]?.id ?? 0;
                const payload = buildCreateStoryPayload(pid, fallbackStatusId, values);
                const created = await apiClient.create<UserStory>("userstories", payload);
                if (opGenerationRef.current !== gen) {
                    return;
                }
                // M1: run the queued attachment add/delete lifecycle AFTER the
                // story exists (legacy `createAttachments(data)` tail). No-op when
                // no attachments are queued (the common new-story case).
                if (pid != null) {
                    await applyStoryAttachments(
                        values,
                        pid,
                        created.id,
                        apiClient.createUserStoryAttachment,
                        apiClient.deleteUserStoryAttachment,
                    );
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                }
                closeLightbox();
                // M2: reload EVERY loaded story (preserve scroll depth) + authoritative total.
                await reloadLoadedUserstories();
                await reloadStats(pid);
            } catch (e) {
                if (opGenerationRef.current === gen) {
                    reportError(e);
                }
            } finally {
                savingUsRef.current = false;
                setSavingUs(false);
            }
        },
        [apiClient, clearError, closeLightbox, reloadLoadedUserstories, reloadStats, reportError],
    );

    /**
     * Persist edits from the shared `StoryFormLightbox` (finding C7). Computes the
     * DIRTY diff via the SHARED `diffStoryValues`, PATCHes with the
     * optimistic-concurrency `version`, then reloads. Nothing-changed closes
     * without a request. M2: awaited, guarded, lightbox stays open on failure.
     */
    const submitEditUs = useCallback(
        async (values: StoryFormValues): Promise<void> => {
            const lb = activeLightboxRef.current;
            if (!lb || lb.type !== "edit" || lb.usId == null) {
                return;
            }
            if (savingUsRef.current) {
                return;
            }
            const story = editStoryRef.current;
            if (!story) {
                return;
            }
            const modified = diffStoryValues(story, values);
            if (Object.keys(modified).length === 0) {
                closeLightbox();
                return;
            }
            savingUsRef.current = true;
            setSavingUs(true);
            clearError();
            // M9: ignore an edit that resolves after a board reload.
            const gen = opGenerationRef.current;
            try {
                const pid = projectIdRef.current;
                await apiClient.save<Savable<UserStory>>(
                    "userstories",
                    story as Savable<UserStory>,
                    modified,
                );
                if (opGenerationRef.current !== gen) {
                    return;
                }
                // M1: apply queued attachment add/delete AFTER the save (legacy
                // `deleteAttachments(data).then(createAttachments(data))`). No-op
                // when nothing is queued.
                if (pid != null) {
                    await applyStoryAttachments(
                        values,
                        pid,
                        story.id,
                        apiClient.createUserStoryAttachment,
                        apiClient.deleteUserStoryAttachment,
                    );
                    if (opGenerationRef.current !== gen) {
                        return;
                    }
                }
                closeLightbox();
                // M2: reload EVERY loaded story (preserve scroll depth) + authoritative total.
                await reloadLoadedUserstories();
                await reloadStats(pid);
            } catch (e) {
                if (opGenerationRef.current === gen) {
                    reportError(e);
                }
            } finally {
                savingUsRef.current = false;
                setSavingUs(false);
            }
        },
        [apiClient, clearError, closeLightbox, reloadLoadedUserstories, reloadStats, reportError],
    );

    /**
     * Bulk-create user stories (one per line) from the shared `BulkStoryLightbox`
     * (finding C7) via the frozen `bulk-create-us` endpoint, then reload. Backlog
     * bulk-create carries no swimlane (`values.swimlane` is null; isKanban=false).
     * M2 semantics as above.
     */
    const submitBulkUs = useCallback(
        async (values: BulkStoryValues): Promise<void> => {
            const lb = activeLightboxRef.current;
            if (!lb || lb.type !== "bulk") {
                return;
            }
            if (savingUsRef.current) {
                return;
            }
            savingUsRef.current = true;
            setSavingUs(true);
            clearError();
            // M9: ignore a bulk-create that resolves after a board reload.
            const gen = opGenerationRef.current;
            try {
                const pid = projectIdRef.current;
                const statusId = values.status ?? projectRef.current?.us_statuses?.[0]?.id ?? null;
                await apiClient.bulkCreateUserStories(pid, statusId, values.bulk, values.swimlane);
                if (opGenerationRef.current !== gen) {
                    return;
                }
                closeLightbox();
                // M2: reload EVERY loaded story (preserve scroll depth) + authoritative total.
                await reloadLoadedUserstories();
                await reloadStats(pid);
            } catch (e) {
                if (opGenerationRef.current === gen) {
                    reportError(e);
                }
            } finally {
                savingUsRef.current = false;
                setSavingUs(false);
            }
        },
        [apiClient, clearError, closeLightbox, reloadLoadedUserstories, reloadStats, reportError],
    );

    /** Toggle a story's membership in the multi-select set (bulk toolbar). */
    const toggleSelectedUs = useCallback((us: UserStory, checked: boolean): void => {
        setSelectedUs((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(us.id);
            } else {
                next.delete(us.id);
            }
            return next;
        });
    }, []);

    /**
     * Bulk-move the selected stories to the current sprint (legacy toolbar
     * `moveToCurrentSprint`: currentSprint || sprints[0]), then clear selection.
     */
    const moveSelectedToCurrentSprint = useCallback((): void => {
        const selectedList = stateRef.current.userstories.filter((u) =>
            selectedUsRef.current.has(u.id),
        );
        if (!selectedList.length) {
            return;
        }
        const target = currentSprintRef.current ?? stateRef.current.sprints[0];
        if (!target) {
            return;
        }
        moveToSprint(selectedList, target.id);
        setSelectedUs(new Set<number>());
    }, [moveToSprint]);

    /**
     * Bulk-move the selected stories to the latest sprint (legacy toolbar
     * `moveToLatestSprint`: sprints[0]), then clear selection.
     */
    const moveSelectedToLatestSprint = useCallback((): void => {
        const selectedList = stateRef.current.userstories.filter((u) =>
            selectedUsRef.current.has(u.id),
        );
        if (!selectedList.length) {
            return;
        }
        const target = stateRef.current.sprints[0];
        if (!target) {
            return;
        }
        moveToSprint(selectedList, target.id);
        setSelectedUs(new Set<number>());
    }, [moveToSprint]);

    /* --------------------------------------------------------------------- *
     * Sprint lightbox actions. This hook only manages open/close + mode +
     * `lastSprint`; the actual milestones create/save/remove HTTP calls live in
     * `../lightboxes/CreateEditSprint.tsx`. onSprintSaved / onSprintDeleted run
     * the post-save/delete reloads (legacy `sprintform:*:success`).
     * --------------------------------------------------------------------- */
    const openCreateSprint = useCallback((): void => {
        setSprintLightbox({
            open: true,
            mode: "create",
            sprint: null,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, []);

    /**
     * Forecast "add sprint" action (finding M3) — the React reproduction of the
     * legacy `.forecasting-add-sprint` click handler (main.coffee L878-894). The
     * forecasted stories (the visible velocity projection) are ACTUALLY MOVED
     * into a sprint; the previous implementation only opened a modal and dropped
     * the stories on the floor.
     *
     *   - When a sprint already exists (`!forecastNewSprint` => the row reads
     *     "Move to Current Sprint"): move the forecasted stories straight into
     *     the sprint with NO modal (legacy `moveToCurrentSprint(ussToMove)`).
     *   - Otherwise (`forecastNewSprint` => "create sprint and add US"): open the
     *     create-sprint lightbox CARRYING the forecasted stories in
     *     `pendingForecastMoveRef`; `onSprintSaved` moves them once the sprint is
     *     created and the list reloads (legacy `sprintform:create` ->
     *     `sprintform:create:success:callback`).
     *
     * Either branch issues exactly ONE `bulk-update-us-milestone` request via
     * `moveToSprint` (== legacy `moveUssToSprint` -> `bulkUpdateMilestone`, target
     * `sprints[0].id`), which reconciles every story copy + reloads stats, and
     * then forecasting is turned off (legacy `moveUssToSprint` called
     * `toggleVelocityForecasting`).
     */
    const createSprintFromForecasting = useCallback((): void => {
        const speed = statsRef.current?.speed ?? 0;
        const forecasted = computeForecastedStories(
            stateRef.current.userstories,
            stateRef.current.sprints,
            speed,
        );
        if (!forecastNewSprint) {
            // A sprint exists: move the forecasted stories into it directly.
            if (!forecasted.length) {
                return;
            }
            const target = stateRef.current.sprints[0];
            if (!target) {
                return;
            }
            moveToSprint(forecasted, target.id);
            setDisplayVelocity(false);
            return;
        }
        // No usable sprint yet: carry the forecasted stories through the modal.
        pendingForecastMoveRef.current = forecasted;
        setSprintLightbox({
            open: true,
            mode: "create",
            sprint: null,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, [forecastNewSprint, moveToSprint]);

    const openEditSprint = useCallback((sprint: Milestone): void => {
        setSprintLightbox({
            open: true,
            mode: "edit",
            sprint,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, []);

    const closeSprintLightbox = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
    }, []);

    /**
     * Close + reload after a sprint is created/edited (loadSprints + stats).
     *
     * Finding M3: when the create modal was opened FROM the forecast action
     * (`pendingForecastMoveRef` is set), move the carried forecast stories into
     * the just-created sprint once the sprint list reloads — the React
     * reproduction of the legacy `sprintform:create:success` handler, which ran
     * `loadSprints().then(=> broadcast "sprintform:create:success:callback",
     * ussToMove)` and whose callback invoked `moveToCurrentSprint(ussToMove)`
     * (main.coffee L170, L815). A plain / edit sprint save leaves the ref null
     * and therefore moves nothing.
     */
    const onSprintSaved = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
        const pid = projectIdRef.current;
        const pendingForecast = pendingForecastMoveRef.current;
        pendingForecastMoveRef.current = null;
        const sprintsPromise = loadSprints(pid);
        void reloadStats(pid);
        if (pendingForecast && pendingForecast.length) {
            void sprintsPromise.then((milestones) => {
                // `loadSprints` has QUEUED a `setState`; in this microtask
                // `stateRef` may still lack the new sprint. Reconcile the
                // reloaded sprints into `stateRef` NOW so the optimistic move in
                // `moveToSprint` can find the just-created target sprint (else
                // `applyOptimisticMove` would silently drop the stories until the
                // move's own reload). Target `sprints[0]` exactly like the legacy
                // `bulkUpdateMilestone(project.id, sprints[0].id, ...)`.
                const reconciled = setSprints(stateRef.current, milestones);
                stateRef.current = reconciled;
                const target = reconciled.sprints[0];
                if (target) {
                    moveToSprint(pendingForecast, target.id);
                }
                setDisplayVelocity(false);
            });
        }
    }, [loadSprints, reloadStats, moveToSprint]);

    /**
     * Close + full reload after a sprint is removed (loadSprints + closed +
     * userstories + stats). If velocity was on, turn it off (legacy
     * `sprintform:remove:success`).
     */
    const onSprintDeleted = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
        const pid = projectIdRef.current;
        void loadSprints(pid);
        void loadClosedSprints(pid);
        // M2: preserve loaded page depth after a sprint delete returns its stories.
        void reloadLoadedUserstories();
        void reloadStats(pid);
        // displayVelocity is EPHEMERAL (M5): reset in-memory only, never persist.
        setDisplayVelocity((v) => (v ? false : v));
    }, [loadSprints, loadClosedSprints, reloadLoadedUserstories, reloadStats]);

    /* --------------------------------------------------------------------- *
     * Toggles + search
     * --------------------------------------------------------------------- */

    const toggleShowTags = useCallback((): void => {
        setShowTags((v) => {
            const nv = !v;
            // M5: persist under the LEGACY taiga.generateHash key (JSON boolean).
            writeStoredBool(showTagsKey(projectIdRef.current), nv);
            return nv;
        });
    }, []);

    const toggleActiveFilters = useCallback((): void => {
        setActiveFilters((v) => !v);
    }, []);

    const toggleVelocityForecasting = useCallback((): void => {
        // displayVelocity is EPHEMERAL (legacy main.coffee L94/L245 — in-memory
        // only, never persisted). M5: no localStorage write.
        setDisplayVelocity((v) => !v);
        calculateForecasting();
    }, [calculateForecasting]);

    /**
     * Toggle the closed-sprint section: loading them on, clearing them on off
     * (legacy `backlog:load-closed-sprints` / `backlog:unload-closed-sprints`).
     */
    const toggleClosedSprints = useCallback((): void => {
        setClosedSprintsVisible((v) => {
            const nv = !v;
            if (nv) {
                void loadClosedSprints(projectIdRef.current);
            } else {
                setState((s) => setClosedSprints(s, []));
            }
            return nv;
        });
    }, [loadClosedSprints]);

    /** Stable trailing-debounced backlog reload for the search input. */
    const debouncedLoadUserstories = useMemo(
        () =>
            debounceTrailing(randomInt(300, 500), (): void => {
                void loadUserstories();
            }),
        [loadUserstories],
    );

    // Cancel any pending debounced reload on unmount / re-key.
    useEffect(
        () => () => {
            debouncedLoadUserstories.cancel();
        },
        [debouncedLoadUserstories],
    );

    /** Update the search query + ref, then trigger a debounced reload. */
    const changeQ = useCallback(
        (q: string): void => {
            setFilterQ(q);
            filterQRef.current = q;
            debouncedLoadUserstories();
        },
        [debouncedLoadUserstories],
    );

    /* --------------------------------------------------------------------- *
     * Filters (C4). `regenerateFilters` re-fetches the category data with the
     * current applied params (legacy `generateFilters`), rebuilds the panels and
     * re-projects the applied chips. `loadCustomFilters` reads the persisted
     * custom filters from the frozen `user-storage` endpoint. add/remove/select
     * mutate `appliedParams`, update the chips optimistically from the cached
     * data collection, persist to `backlog-filters`, refresh the panels, and
     * trigger a (debounced, coalesced) list reload.
     * --------------------------------------------------------------------- */

    /** Build the `filtersData` request params for the current applied filters. */
    const buildLoadFilters = useCallback(
        (pid: number, params: Record<string, string>): Record<string, string | number> => {
            const loadFilters: Record<string, string | number> = {
                project: pid,
                milestone: "null",
            };
            for (const cat of FILTER_CATEGORIES) {
                if (params[cat]) {
                    loadFilters[cat] = params[cat];
                }
                const ex = paramNameFor(cat, "exclude");
                if (params[ex]) {
                    loadFilters[ex] = params[ex];
                }
            }
            return loadFilters;
        },
        [],
    );

    /** Re-fetch category data + rebuild panels/chips (legacy `generateFilters`). */
    const regenerateFilters = useCallback(
        async (pid: number, params: Record<string, string>): Promise<void> => {
            try {
                const data = await apiClient.getUserStoriesFilters(
                    buildLoadFilters(pid, params),
                );
                const dc = buildDataCollection(data);
                dataCollectionRef.current = dc;
                setFilters(buildFilterPanels(dc));
                setSelectedFilters(computeSelectedFilters(dc, appliedParamsRef.current));
            } catch (e) {
                // Non-fatal: surface a sanitized message but keep the last panels.
                reportError(e);
            }
        },
        [apiClient, buildLoadFilters, reportError],
    );

    /** Load the persisted custom filters from `user-storage` (legacy remote store). */
    const loadCustomFilters = useCallback(
        async (pid: number): Promise<void> => {
            try {
                const raw = await apiClient.getUserFilters(pid, BACKLOG_CUSTOM_FILTERS_SUFFIX);
                const list: CustomFilter[] = Object.keys(raw).map((name) => ({
                    id: name,
                    name,
                    filter: (raw[name] ?? {}) as Record<string, string>,
                }));
                setCustomFilters(list);
            } catch (e) {
                reportError(e);
            }
        },
        [apiClient, reportError],
    );

    /** Commit a new applied-params set: sync state/ref, chips, persist, refresh, reload. */
    const applyParams = useCallback(
        (next: Record<string, string>): void => {
            const pid = projectIdRef.current;
            setAppliedParams(next);
            appliedParamsRef.current = next;
            // Optimistic chip update from the cached data collection.
            setSelectedFilters(computeSelectedFilters(dataCollectionRef.current, next));
            writeStoredParams(backlogFiltersKey(pslugRef.current), next);
            if (pid) {
                void regenerateFilters(pid, next);
            }
            debouncedLoadUserstories();
        },
        [regenerateFilters, debouncedLoadUserstories],
    );

    /** Apply a filter (legacy `addFilterBacklog` -> `selectFilter`). */
    const addFilter = useCallback(
        (newFilter: unknown): void => {
            const nf = newFilter as {
                category?: { dataType?: string };
                filter?: { id?: string | number };
                mode?: string;
            };
            const category = nf.category?.dataType;
            const id = nf.filter?.id;
            if (!category || id === undefined || id === null) {
                return;
            }
            const mode: "include" | "exclude" = nf.mode === "exclude" ? "exclude" : "include";
            const next = addParamValue(
                appliedParamsRef.current,
                paramNameFor(category, mode),
                String(id),
            );
            applyParams(next);
        },
        [applyParams],
    );

    /** Remove an applied filter chip (legacy `removeFilterBacklog` -> `unselectFilter`). */
    const removeFilter = useCallback(
        (filter: unknown): void => {
            const chip = filter as FilterChip;
            if (!chip || !chip.dataType || chip.id === undefined) {
                return;
            }
            const mode: "include" | "exclude" = chip.mode === "exclude" ? "exclude" : "include";
            const next = removeParamValue(
                appliedParamsRef.current,
                paramNameFor(chip.dataType, mode),
                String(chip.id),
            );
            applyParams(next);
        },
        [applyParams],
    );

    /** Apply a saved custom filter (legacy `selectCustomFilter` -> `replaceAllFilters`). */
    const selectCustomFilter = useCallback(
        (f: unknown): void => {
            const cf = f as CustomFilter;
            const next = cf && cf.filter ? { ...cf.filter } : {};
            applyParams(next);
        },
        [applyParams],
    );

    /** Persist the current applied filters under a name (legacy `saveCustomFilter`). */
    const saveCustomFilter = useCallback(
        (name: string): void => {
            const pid = projectIdRef.current;
            const trimmed = (name ?? "").trim();
            if (!pid || !trimmed) {
                return;
            }
            void (async (): Promise<void> => {
                try {
                    const raw = await apiClient.getUserFilters(
                        pid,
                        BACKLOG_CUSTOM_FILTERS_SUFFIX,
                    );
                    raw[trimmed] = collectCustomFilterParams(appliedParamsRef.current);
                    await apiClient.storeUserFilters(
                        pid,
                        raw,
                        BACKLOG_CUSTOM_FILTERS_SUFFIX,
                    );
                    await loadCustomFilters(pid);
                } catch (e) {
                    reportError(e);
                }
            })();
        },
        [apiClient, loadCustomFilters, reportError],
    );

    /** Remove a saved custom filter (legacy `removeCustomFilter`). */
    const removeCustomFilter = useCallback(
        (f: unknown): void => {
            const pid = projectIdRef.current;
            const cf = f as CustomFilter;
            if (!pid || !cf || cf.id === undefined) {
                return;
            }
            void (async (): Promise<void> => {
                try {
                    const raw = await apiClient.getUserFilters(
                        pid,
                        BACKLOG_CUSTOM_FILTERS_SUFFIX,
                    );
                    delete raw[cf.id];
                    await apiClient.storeUserFilters(
                        pid,
                        raw,
                        BACKLOG_CUSTOM_FILTERS_SUFFIX,
                    );
                    await loadCustomFilters(pid);
                } catch (e) {
                    reportError(e);
                }
            })();
        },
        [apiClient, loadCustomFilters, reportError],
    );

    /* --------------------------------------------------------------------- *
     * Permission read (VIEW gating only — NO parallel authorization; the backend
     * is the single enforcement point, constraint C-1).
     * --------------------------------------------------------------------- */
    const hasPermission = useCallback((perm: string): boolean => {
        const perms = projectRef.current?.my_permissions;
        return perms ? perms.indexOf(perm) > -1 : false;
    }, []);

    // Boolean field (NOT a function). Default true so the screen renders even
    // before the project loads or when the flag is absent.
    const isBacklogActivated = project ? project.is_backlog_activated !== false : true;

    /* --------------------------------------------------------------------- *
     * Velocity forecasting — the VISIBLE story projection (legacy
     * `calculateForecasting` + `toggleVelocityForecasting`, main.coffee
     * L245-263,L444-464). When forecasting is OFF, every fetched story renders.
     * When it is ON and the project has a known velocity (`speed > 0`), the
     * backlog collapses to just the leading stories that fit within the next
     * sprint's remaining capacity: iterate the ordered backlog accumulating
     * `total_points`, keep each story, and stop AFTER the first one that pushes
     * the running sum past `speed` (so the overflowing story is still shown,
     * exactly as the legacy loop `break`ed after the push). The accumulation is
     * seeded with the first OPEN sprint's points — unless that sprint alone
     * already over-fills the velocity, in which case a brand-new sprint is
     * forecast and the sum restarts at zero. With `speed <= 0` the legacy loop
     * never broke, so every story stays visible and the count is unchanged
     * (which is also why the enable control is hidden until velocity exists).
     *
     * This mirrors the legacy `visibleUserStories` projection: internal mutations
     * (moves, WS handlers) always read the FULL list from `stateRef`, so limiting
     * the exposed `userstories` here only affects what the table renders.
     * --------------------------------------------------------------------- */
    const visibleUserstories = useMemo<UserStory[]>(() => {
        if (!displayVelocity) {
            return state.userstories;
        }
        // Same projection the forecast add-sprint action moves (M3) — via the
        // shared `computeForecastedStories` helper so the two never diverge.
        return computeForecastedStories(
            state.userstories,
            state.sprints,
            stats?.speed ?? 0,
        );
    }, [displayVelocity, state.userstories, state.sprints, stats]);

    /* --------------------------------------------------------------------- *
     * Return the complete BacklogVM (every member present — a missing one
     * crashes Backlog.tsx).
     * --------------------------------------------------------------------- */
    return {
        // ---- state ----
        loading,
        errorMessage,
        savingUs,
        editLoading,
        project,
        projectId,
        // The VISIBLE projection: identical to the fetched list unless velocity
        // forecasting is active, in which case it collapses to the leading
        // stories that fit within the next sprint (legacy `visibleUserStories`).
        userstories: visibleUserstories,
        sprints: state.sprints,
        closedSprints: state.closedSprints,
        closedSprintsVisible,
        totalMilestones,
        totalClosedMilestones,
        totalUserStories,
        hasMoreUserstories,
        loadingMore,
        currentSprint,
        stats,
        showGraphPlaceholder,
        showTags,
        activeFilters,
        displayVelocity,
        forecastNewSprint,
        filterQ,
        selectedFilters,
        filters,
        customFilters,
        statuses,
        selectedUs,
        eventsConnected,
        sprintLightbox,
        apiClient,
        // ---- actions ----
        hasPermission,
        isBacklogActivated,
        loadUserstories,
        loadMoreUserstories,
        changeQ,
        addFilter,
        removeFilter,
        saveCustomFilter,
        selectCustomFilter,
        removeCustomFilter,
        toggleShowTags,
        toggleActiveFilters,
        toggleVelocityForecasting,
        toggleClosedSprints,
        moveUs,
        moveToSprint,
        moveUsToTop,
        updateUserStoryStatus,
        updateUserStoryPoints,
        deleteUserStory,
        pendingDelete,
        deleteBusy,
        confirmDelete,
        cancelDelete,
        addNewUs,
        editUserStory,
        activeLightbox,
        closeLightbox,
        submitNewUs,
        submitEditUs,
        submitBulkUs,
        toggleSelectedUs,
        moveSelectedToCurrentSprint,
        moveSelectedToLatestSprint,
        openCreateSprint,
        openEditSprint,
        closeSprintLightbox,
        onSprintSaved,
        onSprintDeleted,
        createSprintFromForecasting,
    };
}
