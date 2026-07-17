/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `BacklogApp` — the composition root and controller for the React Backlog
 * screen. It ports the AngularJS `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee` L19-715) and the `backlog.jade`
 * shell layout into an explicit React data flow.
 *
 * Responsibilities (all owned here, children are presentational):
 *   - ALL board state, via the `useBacklogState` hook.
 *   - Data loading (project, stats, sprints, closed sprints, user stories,
 *     filters) against the FROZEN `/api/v1/` contract through the shared
 *     `../shared/api/*` adapters.
 *   - The WebSocket subscription (`initializeSubscription`) through the shared
 *     `../shared/events/websocket` adapter.
 *   - The drag-and-drop provider + order persistence (`moveUs`,
 *     `moveUsToTopOfBacklog`) through `../shared/dnd/DndProvider`.
 *   - Every mutation handler (create/edit/delete story, status/points change,
 *     add/edit sprint, bulk create) and the filters/search/velocity controls.
 *   - The three React lightboxes: bulk user stories, sprint add/edit, and the
 *     single-user-story create/edit form (`UserStoryEditLightbox`). All are
 *     React-owned — the migrated `backlog.jade` no longer hosts any AngularJS
 *     generic-form bridge (QA finding #2).
 *
 * This is the NAMED export consumed by `../index.tsx`
 * (`import { BacklogApp } from "./backlog/BacklogApp"`), which registers the
 * `<tg-react-backlog>` custom element.
 *
 * PROJECT-ID RESOLUTION CONTRACT (QA finding #1): the host element derives the
 * id from `data-project-id="{{project.id}}"`, but the migrated Jade shell has
 * NO controller putting `project` on the template scope, so that attribute
 * interpolates to `""` (→ `0`) or arrives as the raw `"{{project.id}}"` literal
 * (→ `NaN`) — NEVER a real id. Only a POSITIVE INTEGER is treated as valid
 * (`isValidProjectId`); `0`/`NaN` are rejected so the screen never issues the
 * spurious `GET /projects/0` that returned 404. When the prop id is unusable
 * the project is resolved from the slug embedded in the route URL
 * (`/project/:pslug/...`) via `GET projects/by_slug`, and the resolved id is
 * published to `resolvedId` (+ `resolvedIdRef`). EVERY network call and the
 * WebSocket connect are DEFERRED until a valid id is resolved; when neither a
 * valid prop id nor a URL slug is present, NO network runs (transient-NaN).
 *
 * SHARED-SESSION CONTRACT: this component NEVER mints its own JWT/sessionId and
 * NEVER opens a parallel WebSocket. It uses the `../shared/**` adapters
 * exclusively, which read the same globals AngularJS established
 * (`localStorage["token"]`, `window.taiga.sessionId`, `window.taigaConfig`).
 *
 * i18n: the migration renders English literals; the corresponding
 * angular-translate keys are kept inline as comments.
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import moment from "moment";

import type {
    CustomFilter,
    Filters,
    FilterCategory,
    FilterOption,
    Id,
    Project,
    ProjectStats,
    SelectedFilter,
    Sprint,
    UserStory,
    UserStoryActions,
} from "./types";
import { useBacklogState, calculateForecasting } from "./useBacklogState";
import { Burndown } from "./Burndown";
import { BacklogTable } from "./BacklogTable";
import { SprintList } from "./SprintList";
import { SprintEditLightbox } from "./SprintEditLightbox";
import { BulkUserStoriesLightbox } from "./BulkUserStoriesLightbox";
import { UserStoryEditLightbox } from "./UserStoryEditLightbox";
import { ConfirmDialog } from "../shared/dialog/ConfirmDialog";
import type {
    AssignableUser,
    UserStoryCreateFields,
    UserStoryEditChanges,
} from "./UserStoryEditLightbox";
import { httpGet, httpPatch, httpDelete, HttpError } from "../shared/api/httpClient";
import type { QueryParams, HttpResponse } from "../shared/api/httpClient";
import * as userstoriesApi from "../shared/api/userstories";
import * as attachmentsApi from "../shared/api/attachments";
import type { UserStoryAttachment } from "../shared/api/attachments";
import * as milestonesApi from "../shared/api/milestones";
import * as userStorageApi from "../shared/api/userStorage";
import type { StoredCustomFilters } from "../shared/api/userStorage";
import { createEventsClient } from "../shared/events/websocket";
import { generateHash } from "../shared/util/hash";
import {
    DndProvider,
    isDragEnabled,
    createBacklogPersister,
} from "../shared/dnd/DndProvider";
import type { NormalizedDragEnd, ResolvedDrop, DropNeighbors } from "../shared/dnd/DndProvider";
import {
    rowPreferringCollisionDetection,
    singleStepKeyboardCoordinates,
} from "../shared/dnd/keyboardCoordinates";
import { notifyError } from "../shared/notifications/notificationCenter";
import { NotificationHost } from "../shared/notifications/NotificationHost";
import { resetInterceptorHooks, setInterceptorHooks } from "../shared/api/httpInterceptor";
import { t } from "../shared/i18n/translate";

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Props for {@link BacklogApp}. Structural typing satisfies `defineElement`'s
 * `ComponentType<HostElementProps>` in `../index.tsx` (which types the
 * component as `Parameters<typeof defineElement>[0]`), so there must be NO
 * extra REQUIRED props beyond these two. `../host` is deliberately NOT
 * imported.
 */
export interface BacklogAppProps {
    /** Numeric project id, read from the host element's `data-project-id`. */
    projectId: number;
    /** Project slug, read from the host element's `data-project-slug`. */
    projectSlug: string;
}

/* -------------------------------------------------------------------------- */
/* Local types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Structurally-compatible seed for `SprintEditLightbox.initialValues`. The
 * authoritative `SprintFormValues` lives in `../shared/validation/sprintForm`,
 * which is NOT a declared dependency of this file and is NOT re-exported by
 * `SprintEditLightbox`; TypeScript structural typing lets this local shape be
 * passed to the `initialValues` prop.
 */
interface SprintFormSeed {
    name: string;
    estimated_start: string;
    estimated_finish: string;
    project?: number | null;
}

/** Controlled state for the create/edit-sprint lightbox. */
interface SprintLightboxState {
    open: boolean;
    mode: "create" | "edit";
    sprint: Sprint | null;
    initialValues: SprintFormSeed;
    lastSprintName: string | null;
    canDelete: boolean;
}

/** Controlled state for the bulk-user-story lightbox. */
interface BulkLightboxState {
    open: boolean;
}

/**
 * Controlled state for the single-user-story create/edit lightbox
 * ({@link UserStoryEditLightbox}). `us` is the row being edited in `"edit"`
 * mode and `null` in `"create"` mode. Ports the AngularJS generic-form
 * `$scope.mode` + `$scope.obj` (common/lightboxes.coffee L622-L673).
 */
interface UsLightboxState {
    open: boolean;
    mode: "create" | "edit";
    us: UserStory | null;
}

/**
 * Controlled state for the themed delete-confirmation dialog ([H]). Replaces the
 * native `window.confirm()`. `us` is the story pending deletion; `busy` disables
 * the dialog buttons while the DELETE request is in flight.
 */
interface DeleteConfirmState {
    open: boolean;
    us: UserStory | null;
    busy: boolean;
}

/** A raw filter item as returned inside `GET /userstories/filters_data`. */
interface RawFilterItem {
    id?: unknown;
    name?: unknown;
    full_name?: unknown;
    color?: unknown;
    count?: unknown;
    ref?: unknown;
    subject?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * User-story page size. The AngularJS repository paginated backlog reads; a
 * fixed page size keeps infinite-scroll behavior equivalent while bounding each
 * request. 100 mirrors the backend's default max page size for this list.
 */
const PAGE_SIZE = 100;

/**
 * The URL query keys the controller whitelisted (`validQueryParams`,
 * main.coffee L22-L34). Both the plain and `exclude_`-prefixed variants are
 * accepted so include/exclude filters round-trip to the same endpoint.
 */
const VALID_QUERY_PARAMS: ReadonlySet<string> = new Set<string>([
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
]);

/**
 * Debounce (ms) applied to the free-text search before reloading, mirroring the
 * responsiveness of the AngularJS `tg-input-search` debounce.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Legacy localStorage key for the burndown-collapsed flag (N-01). Reproduced
 * EXACTLY: the AngularJS backlog stored it under
 * `generateHash(["is-burndown-grpahs-collapsed"])` (backlog/main.coffee L1182),
 * where `generateHash` is the sha1-of-JSON-components helper ported byte-for-byte
 * in {@link generateHash}. The misspelling "grpahs" is preserved verbatim — it is
 * part of the hashed input, so any deviation would compute a different key and
 * silently orphan every existing user's saved setting. The former approximation
 * (the raw string `"is-burndown-grpahs-collapsed"`) is migrated on read below.
 */
const BURNDOWN_COLLAPSED_KEY = generateHash(["is-burndown-grpahs-collapsed"]);
/** The pre-N-01 approximated (un-hashed) key, migrated on read for continuity. */
const BURNDOWN_COLLAPSED_LEGACY_APPROX_KEY = "is-burndown-grpahs-collapsed";

/**
 * `storeCustomFiltersName` for the backlog (backlog/main.coffee L50). Used to
 * namespace the saved-filters row in `/api/v1/user-storage` so the React screen
 * reads/writes the SAME row the AngularJS backlog used.
 */
const BACKLOG_CUSTOM_FILTERS_SUFFIX = "backlog-custom-filters";

/** DnD container key for the backlog (milestone === null). */
const BACKLOG_KEY = "backlog";
/** DnD container key prefix for a sprint (`sprint:{id}`). */
const SPRINT_PREFIX = "sprint:";

/* -------------------------------------------------------------------------- */
/* Module-level pure helpers (deterministic + unit-testable)                  */
/* -------------------------------------------------------------------------- */

/**
 * Read the app base href from `window.taigaConfig` defensively (the runtime
 * config is seeded by `app-loader.coffee`). Returns `""` when unavailable so
 * image `src`s degrade gracefully in tests.
 */
function getBaseHref(): string {
    const cfg = (window as unknown as { taigaConfig?: { baseHref?: string } }).taigaConfig;
    return cfg?.baseHref ?? "";
}

/**
 * Per-project localStorage key for the show-tags preference (N-01). Reproduced
 * EXACTLY from the AngularJS resource (`userstories.coffee` storeShowTags /
 * getShowTags, L169-176): with `hashShowTags = 'backlog-tags'` the namespace is
 * `"{projectId}:backlog-tags"` and the key is
 * `generateHash([projectId, "{projectId}:backlog-tags"])`. Using the exact key
 * means the React Backlog reads the SAME value existing AngularJS users already
 * saved, instead of the previous approximation (`showTags-{projectId}`) that
 * silently started from scratch. The projectId is hashed as a number (matching
 * `@scope.projectId`), so `JSON.stringify` yields the bare integer.
 */
const SHOW_TAGS_NAMESPACE_SUFFIX = "backlog-tags";
function showTagsKey(projectId: number): string {
    const ns = `${projectId}:${SHOW_TAGS_NAMESPACE_SUFFIX}`;
    return generateHash([projectId, ns]);
}
/** The pre-N-01 approximated show-tags key, migrated on read for continuity. */
function showTagsLegacyApproxKey(projectId: number): string {
    return `showTags-${projectId}`;
}

/**
 * A project id is valid only when it is a POSITIVE INTEGER. The host element
 * derives the id from `data-project-id`, which the AngularJS Jade shell emits
 * as `{{project.id}}`; with no controller putting `project` on the template
 * scope it interpolates to `""` (→ `Number("") === 0`) or arrives as the raw
 * `"{{project.id}}"` literal (→ `NaN`). BOTH must be rejected — treating `0`
 * as an id previously produced `GET /projects/0` → 404 (QA finding #1). Only a
 * finite positive integer unlocks any network / WebSocket work.
 */
function isValidProjectId(id: number): boolean {
    return Number.isInteger(id) && id > 0;
}

/**
 * Resolve the project slug from the current URL. The Backlog route is
 * `/project/:pslug/backlog` (app.coffee), so the slug is ALWAYS present in the
 * path even though `data-project-slug` (like `data-project-id`) fails to
 * interpolate in the migrated shell. This is the RELIABLE fallback source used
 * to look the project up via `GET projects/by_slug` when the host attribute did
 * not yield a usable id (QA finding #1). Returns `null` when no slug segment is
 * present (e.g. jsdom's default `/` path), which keeps the transient-NaN
 * "no network until resolvable" contract intact.
 */
function slugFromLocation(): string | null {
    try {
        const match = /\/project\/([^/]+)/.exec(window.location.pathname);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

/** Map a DnD container key to its milestone id (`null` for the backlog). */
function milestoneIdFromKey(key: string): number | null {
    if (key === BACKLOG_KEY) {
        return null;
    }
    if (key.startsWith(SPRINT_PREFIX)) {
        const n = Number(key.slice(SPRINT_PREFIX.length));
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/** Locate a user story by id across the backlog + open + closed sprints. */
function locateUs(
    id: number,
    userstories: UserStory[],
    sprints: Sprint[],
    closedSprints: Sprint[],
): { containerKey: string; index: number; ids: number[] } | null {
    const backlogIndex = userstories.findIndex((u) => u.id === id);
    if (backlogIndex > -1) {
        return {
            containerKey: BACKLOG_KEY,
            index: backlogIndex,
            ids: userstories.map((u) => u.id),
        };
    }

    for (const sprint of sprints.concat(closedSprints)) {
        const i = sprint.user_stories.findIndex((u) => u.id === id);
        if (i > -1) {
            return {
                containerKey: `${SPRINT_PREFIX}${sprint.id}`,
                index: i,
                ids: sprint.user_stories.map((u) => u.id),
            };
        }
    }

    return null;
}

/** Return the current ordered id list of a container by key. */
function containerIds(
    key: string,
    userstories: UserStory[],
    sprints: Sprint[],
    closedSprints: Sprint[],
): number[] {
    if (key === BACKLOG_KEY) {
        return userstories.map((u) => u.id);
    }
    const sid = milestoneIdFromKey(key);
    const sprint =
        sprints.find((s) => s.id === sid) ?? closedSprints.find((s) => s.id === sid);
    return sprint ? sprint.user_stories.map((u) => u.id) : [];
}

/** Immutably remove a story from a list by id. */
function withoutUs(list: UserStory[], id: number): UserStory[] {
    return list.filter((u) => u.id !== id);
}

/** Immutably insert a story into a list at a clamped index. */
function insertUs(list: UserStory[], us: UserStory, index: number): UserStory[] {
    const copy = list.slice();
    const i = Math.max(0, Math.min(index, copy.length));
    copy.splice(i, 0, us);
    return copy;
}

/** Immutably map one sprint's `user_stories`, matched by id. */
function mapSprintStories(
    sprints: Sprint[],
    sprintId: number,
    fn: (stories: UserStory[]) => UserStory[],
): Sprint[] {
    return sprints.map((sprint) =>
        sprint.id === sprintId ? { ...sprint, user_stories: fn(sprint.user_stories) } : sprint,
    );
}

/** The three board collections `applyMovedUserstories` reconciles atomically. */
interface MovedCollections {
    userstories: UserStory[];
    sprints: Sprint[];
    closedSprints: Sprint[];
}

/**
 * Optimistic port of `moveUs`' splice logic (main.coffee L548-L598): remove the
 * dragged story from its origin container, set its `milestone` to the target,
 * and insert it into the target container at `targetIndex`. Returns `null` when
 * the dragged story cannot be found. Every array is rebuilt immutably so the
 * inputs are never mutated.
 */
function applyOptimisticMove(
    collections: MovedCollections,
    draggedId: number,
    originKey: string,
    targetKey: string,
    targetIndex: number,
): MovedCollections | null {
    const origin = locateUs(
        draggedId,
        collections.userstories,
        collections.sprints,
        collections.closedSprints,
    );
    if (!origin) {
        return null;
    }

    // Resolve the dragged story object from whichever container holds it.
    const dragged =
        collections.userstories.find((u) => u.id === draggedId) ??
        collections.sprints
            .concat(collections.closedSprints)
            // F-B: `.reduce` (ES2018) rather than `.flatMap` (ES2019). tsconfig
            // declares `lib: es2018`; `@types/node` transitively widens the lib
            // set so tsc would otherwise accept the ES2019 method and silently
            // break the declared type-gate. `Sprint.user_stories` is always a
            // `UserStory[]`, so this is behavior-identical (order preserved).
            .reduce<UserStory[]>((acc, s) => acc.concat(s.user_stories), [])
            .find((u) => u.id === draggedId);
    if (!dragged) {
        return null;
    }

    const targetMilestoneId = milestoneIdFromKey(targetKey);
    const movedUs: UserStory = { ...dragged, milestone: targetMilestoneId };

    let userstories = collections.userstories;
    let sprints = collections.sprints;
    let closedSprints = collections.closedSprints;

    // Remove from origin.
    if (originKey === BACKLOG_KEY) {
        userstories = withoutUs(userstories, draggedId);
    } else {
        const originId = milestoneIdFromKey(originKey);
        if (originId != null) {
            sprints = mapSprintStories(sprints, originId, (l) => withoutUs(l, draggedId));
            closedSprints = mapSprintStories(closedSprints, originId, (l) =>
                withoutUs(l, draggedId),
            );
        }
    }

    // Insert into target.
    if (targetKey === BACKLOG_KEY) {
        userstories = insertUs(userstories, movedUs, targetIndex);
    } else {
        const targetId = milestoneIdFromKey(targetKey);
        if (targetId != null) {
            sprints = mapSprintStories(sprints, targetId, (l) =>
                insertUs(l, movedUs, targetIndex),
            );
            closedSprints = mapSprintStories(closedSprints, targetId, (l) =>
                insertUs(l, movedUs, targetIndex),
            );
        }
    }

    return { userstories, sprints, closedSprints };
}

/** Coerce an unknown filters-data field into an array of raw filter items. */
function asRawItems(value: unknown): RawFilterItem[] {
    return Array.isArray(value) ? (value as RawFilterItem[]) : [];
}

/** Read an optional numeric `count`. */
function readCount(item: RawFilterItem): number | undefined {
    return typeof item.count === "number" ? item.count : undefined;
}

/** Read an optional string `color`. */
function readColor(item: RawFilterItem): string | undefined {
    return typeof item.color === "string" ? item.color : undefined;
}

/** Read a string field or a fallback. */
function readString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/**
 * Build the six backlog filter categories from a `filters_data` payload,
 * reproducing the id/name transforms of `generateFilters`
 * (controllerMixins.coffee L253-L296): statuses, tags, assigned users, roles,
 * owners (created-by) and epics — in that exact order.
 * i18n: COMMON.FILTERS.CATEGORIES.{STATUS,TAGS,ASSIGNED_TO,ROLE,CREATED_BY,EPIC}.
 */
function buildFilterCategories(data: Record<string, unknown>): Filters {
    const categories: FilterCategory[] = [];

    // Status — `it.id = it.id.toString()`.
    const status: FilterOption[] = asRawItems(data.statuses).map((it) => ({
        id: String(it.id),
        name: readString(it.name),
        color: readColor(it),
        count: readCount(it),
    }));
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.STATUS", "Status"),
        dataType: "status",
        content: status,
    });

    // Tags — `it.id = it.name`.
    const tags: FilterOption[] = asRawItems(data.tags).map((it) => ({
        id: readString(it.name),
        name: readString(it.name),
        color: readColor(it),
        count: readCount(it),
    }));
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.TAGS", "Tags"),
        dataType: "tags",
        content: tags,
    });

    // Assigned to — `it.id ? id.toString() : "null"`, `name = full_name || "Unassigned"`.
    const assigned: FilterOption[] = asRawItems(data.assigned_users).map((it) => ({
        id: it.id != null ? String(it.id) : "null",
        name: readString(it.full_name) || t("COMMON.FILTERS.UNASSIGNED", "Unassigned"),
        count: readCount(it),
    }));
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.ASSIGNED_TO", "Assigned to"),
        dataType: "assigned_users",
        content: assigned,
    });

    // Role — `it.id ? id.toString() : "null"`, `name = name || "Unassigned"`.
    const role: FilterOption[] = asRawItems(data.roles).map((it) => ({
        id: it.id != null ? String(it.id) : "null",
        name: readString(it.name) || t("COMMON.FILTERS.UNASSIGNED", "Unassigned"),
        count: readCount(it),
    }));
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.ROLE", "Role"),
        dataType: "role",
        content: role,
    });

    // Created by (owner) — `it.id = id.toString()`, `name = full_name`.
    const owner: FilterOption[] = asRawItems(data.owners).map((it) => ({
        id: String(it.id),
        name: readString(it.full_name),
        count: readCount(it),
    }));
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.CREATED_BY", "Created by"),
        dataType: "owner",
        content: owner,
    });

    // Epic — with-id: `name = "#{ref} {subject}"`; no-id: id "null", "Not in an epic".
    const epic: FilterOption[] = asRawItems(data.epics).map((it) => {
        if (it.id != null) {
            return {
                id: String(it.id),
                name: `#${readString(it.ref, String(it.ref))} ${readString(it.subject)}`.trim(),
                count: readCount(it),
            };
        }
        return {
            id: "null",
            name: t("COMMON.FILTERS.NOT_IN_EPIC", "Not in an epic"),
            count: readCount(it),
        };
    });
    categories.push({
        title: t("COMMON.FILTERS.CATEGORIES.EPIC", "Epic"),
        dataType: "epic",
        content: epic,
    });

    return categories;
}

/**
 * Translate the currently-selected filters into the endpoint's query params,
 * grouping ids by `dataType` (and `exclude_` prefix for excluded values) and
 * joining them with commas — mirroring how the AngularJS URL search string was
 * assembled and whitelisted by `validQueryParams`.
 */
function pickSelectedFilterParams(selected: SelectedFilter[]): QueryParams {
    const groups: Record<string, string[]> = {};

    for (const filter of selected) {
        const key = filter.mode === "exclude" ? `exclude_${filter.dataType}` : filter.dataType;
        if (!VALID_QUERY_PARAMS.has(key)) {
            continue;
        }
        (groups[key] ??= []).push(String(filter.id));
    }

    const params: QueryParams = {};
    for (const key of Object.keys(groups)) {
        params[key] = groups[key].join(",");
    }
    return params;
}

/**
 * Reduce the current selection to the plain string→string map a custom filter
 * persists (filter key incl. `exclude_` prefix → comma-joined ids), mirroring
 * the slice of `location.search()` that `saveCustomFilter` stored
 * (controllerMixins.coffee L201-L214).
 */
function selectedToStoredMap(selected: SelectedFilter[]): Record<string, string> {
    const groups: Record<string, string[]> = {};
    for (const filter of selected) {
        const key = filter.mode === "exclude" ? `exclude_${filter.dataType}` : filter.dataType;
        if (!VALID_QUERY_PARAMS.has(key)) {
            continue;
        }
        (groups[key] ??= []).push(String(filter.id));
    }
    const map: Record<string, string> = {};
    for (const key of Object.keys(groups)) {
        map[key] = groups[key].join(",");
    }
    return map;
}

/**
 * Rebuild a {@link SelectedFilter} list from a saved custom-filter param map,
 * matching each id against the freshly-loaded categories to recover its display
 * name/color (falling back to the raw id when the value no longer exists) —
 * mirroring `formatSelectedFilters` (controllerMixins.coffee L133-L177). Keys
 * carrying the `exclude_` prefix are restored with `mode: "exclude"`.
 */
function reconstructSelectedFromParamMap(
    paramMap: Record<string, string>,
    categories: Filters,
): SelectedFilter[] {
    const byDataType = new Map<string, FilterCategory>();
    for (const category of categories) {
        byDataType.set(category.dataType, category);
    }

    const selected: SelectedFilter[] = [];
    for (const rawKey of Object.keys(paramMap)) {
        const value = paramMap[rawKey];
        if (value == null || value === "") {
            continue;
        }
        const isExclude = rawKey.startsWith("exclude_");
        const dataType = isExclude ? rawKey.slice("exclude_".length) : rawKey;
        const mode = isExclude ? "exclude" : "include";
        const category = byDataType.get(dataType);

        for (const id of String(value).split(",")) {
            const trimmed = id.trim();
            if (trimmed === "") {
                continue;
            }
            const option = category?.content.find((o) => String(o.id) === trimmed);
            selected.push({
                id: trimmed,
                name: option ? option.name : trimmed,
                dataType,
                mode,
                ...(option?.color !== undefined ? { color: option.color } : {}),
            });
        }
    }
    return selected;
}

/**
 * Convert the raw `/user-storage` value (name → param map) into the
 * {@link CustomFilter} list the panel renders, mirroring the `_.forOwn` mapping
 * in `generateFilters` (controllerMixins.coffee L362-L364).
 */
function storedToCustomFilters(raw: StoredCustomFilters): CustomFilter[] {
    return Object.keys(raw).map((key) => ({ id: key, name: key, filter: raw[key] }));
}

/**
 * Report a recoverable failure (never throws).
 *
 * Always logs a diagnostic to the console (developer signal, carries the raw
 * error). When a `userMessage` is supplied it ALSO emits a non-blocking
 * notification onto the shared bus so the user is never left without feedback —
 * QA finding [ERR-1] (every mutation failure previously routed to
 * `console.error` only). The console detail and the user-facing copy are kept
 * separate: the toast never leaks internal error detail.
 */
function reportError(context: string, error: unknown, userMessage?: string): void {
    if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.error(`[taiga-react] ${context}`, error);
    }
    if (userMessage !== undefined) {
        notifyError(userMessage);
    }
}

/** Read a boolean flag from localStorage (safe under jsdom / privacy modes). */
function readStoredBoolean(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "true";
    } catch {
        return false;
    }
}

/** Persist a boolean flag to localStorage (best-effort; swallows failures). */
function writeStoredBoolean(key: string, value: boolean): void {
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        /* best-effort: ignore storage failures (private mode, quota, jsdom) */
    }
}

/**
 * Read a boolean preference under its EXACT legacy hashed key (N-01), migrating
 * a value written under an earlier approximated key if the hashed key is empty.
 *
 * Primary path: the hashed key is the one the AngularJS client used, so an
 * existing user's saved value is read directly. Migration path: if the hashed
 * key has no value but the pre-N-01 approximated key does, copy it forward
 * (write under the hashed key, best-effort) and honor it — so the brief window
 * in which the approximation was used never loses a user's setting. Absent both,
 * returns `false` (same default as `readStoredBoolean`).
 */
function readStoredBooleanMigrating(exactKey: string, approxKey: string): boolean {
    try {
        const exact = window.localStorage.getItem(exactKey);
        if (exact !== null) {
            return exact === "true";
        }
        const approx = window.localStorage.getItem(approxKey);
        if (approx !== null) {
            window.localStorage.setItem(exactKey, approx);
            return approx === "true";
        }
        return false;
    } catch {
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* BacklogFilterPanel — in-board reimplementation of the shared `tg-filter`    */
/* -------------------------------------------------------------------------- */

interface BacklogFilterPanelProps {
    filters: Filters;
    selectedFilters: SelectedFilter[];
    /** Saved ("custom") filters for this project (QA finding [J]). */
    customFilters: CustomFilter[];
    /** Currently-applied saved filter id, for the `.active` highlight. */
    activeCustomFilter: Id | string | null;
    /** Include/exclude mode of the NEXT option selection (QA finding [K]). */
    filterMode: string;
    onSetFilterMode: (mode: string) => void;
    onAddFilter: (category: FilterCategory, option: FilterOption) => void;
    onRemoveFilter: (filter: SelectedFilter) => void;
    onSaveCustomFilter: (name: string) => void;
    onSelectCustomFilter: (filter: CustomFilter) => void;
    onRemoveCustomFilter: (filter: CustomFilter) => void;
}

/**
 * Minimal in-board filter panel that renders the `.backlog-filter#backlog-filter`
 * region the shared AngularJS `tg-filter` directive used to own. Selecting an
 * option toggles a {@link SelectedFilter}; the parent reloads the backlog and
 * regenerates the category counts. Only the category `dataType`s the backlog
 * whitelists are produced upstream by {@link buildFilterCategories}.
 */
/**
 * Decorative SVG icon host, mirroring the sibling `BacklogTable` convention:
 * `createElement("tg-svg", …)` avoids augmenting `JSX.IntrinsicElements` (which
 * would risk a duplicate-declaration collision across the React modules that
 * also emit `tg-svg`). The inner `<svg>` is hidden from assistive tech — the
 * surrounding control carries the accessible label — so this is invisible
 * accessibility that never conflicts with the class-driven SCSS theme.
 */
function Svg({ icon }: { icon: string }): JSX.Element {
    return createElement(
        "tg-svg",
        null,
        <svg className={`icon ${icon}`} aria-hidden="true" focusable="false">
            <use xlinkHref={`#${icon}`} href={`#${icon}`} />
        </svg>,
    );
}

/**
 * Render the delete-confirmation message from the shared catalog ([i18n], key
 * `US.TITLE_DELETE_MESSAGE`). The catalog value embeds a `<strong>` around the
 * interpolated (and quote-wrapped) story subject; rather than losing that
 * emphasis (a flat string cannot carry React elements) OR risking
 * `dangerouslySetInnerHTML`, we split the localized string on the single known
 * `<strong>…</strong>` boundary — mirroring `renderLastSprintHint` in
 * `SprintEditLightbox` — and render each segment as escaped React text. This
 * preserves both the bold emphasis (visual parity) AND localization, with the
 * interpolated subject always escaped by React (XSS-safe). The fallback matches
 * the frozen catalog verbatim, including its literal `\u201C` quotes on BOTH
 * sides of the subject (a catalog quirk preserved for exact parity).
 */
function renderDeleteMessage(subject: string): ReactNode {
    const rendered = t(
        "US.TITLE_DELETE_MESSAGE",
        "Are you sure you want to delete <strong>\u201C{{subject}}\u201C</strong>?",
        { subject },
    );
    const match = rendered.match(/^([\s\S]*?)<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
    if (!match) {
        // No <strong> in this locale's value — render plain (tag-stripped) text.
        return rendered.replace(/<\/?strong>/g, "");
    }
    return (
        <>
            {match[1]}
            <strong>{match[2]}</strong>
            {match[3]}
        </>
    );
}

/** Angular `filterModeOptions` (filter.controller.coffee L20). */
const FILTER_MODE_OPTIONS = ["include", "exclude"] as const;

/** Per-category `single-filter-type-*` class (filter.jade `ng-class`). */
function optionTypeClass(dataType: string): string {
    if (dataType === "tags") {
        return "single-filter-type-tag";
    }
    if (dataType === "assigned_users" || dataType === "owner") {
        return "single-filter-type-user";
    }
    return "single-filter-type-general";
}

/**
 * Per-option inline color, reproducing filter.jade's `ng-style`: tags color the
 * background, every other category colors the left border; absent colors fall
 * back to a transparent border so the SCSS `border-left` slot stays reserved.
 */
function optionStyle(dataType: string, option: FilterOption): CSSProperties {
    if (dataType === "tags") {
        return option.color ? { background: option.color } : {};
    }
    return { borderColor: option.color ? option.color : "transparent" };
}

/**
 * In-board reimplementation of the shared AngularJS `tg-filter` widget
 * (filter.jade + filter.controller.coffee), rendering the SAME class-driven
 * DOM so the compiled `filter.scss` themes it unchanged. It restores three
 * capabilities the first React port dropped:
 *   - [J] the saved ("custom") filters section (list + add-form + delete),
 *   - [K] the include/exclude mode toggle and the included/excluded split of
 *     applied filters, and
 *   - [L] collapsible filter categories (only one open at a time; all closed
 *     initially, matching `FilterController.opened = null`).
 */
function BacklogFilterPanel(props: BacklogFilterPanelProps): JSX.Element {
    const {
        filters,
        selectedFilters,
        customFilters,
        activeCustomFilter,
        filterMode,
        onSetFilterMode,
        onAddFilter,
        onRemoveFilter,
        onSaveCustomFilter,
        onSelectCustomFilter,
        onRemoveCustomFilter,
    } = props;

    // -- [L] Collapse: a single open category dataType (null = all closed). ----
    const [opened, setOpened] = useState<string | null>(null);
    const isOpen = useCallback((dataType: string): boolean => opened === dataType, [opened]);
    const toggleCategory = useCallback((dataType: string): void => {
        setOpened((prev) => (prev === dataType ? null : dataType));
    }, []);

    // -- [J] Custom-filter add-form state + validation (filter.controller). ----
    const [customFilterForm, setCustomFilterForm] = useState<boolean>(false);
    const [customFilterName, setCustomFilterName] = useState<string>("");
    const [lengthZeroError, setLengthZeroError] = useState<boolean>(false);
    const [repeatedFilterError, setRepeatedFilterError] = useState<boolean>(false);

    const openCustomFilter = useCallback((): void => {
        setCustomFilterForm(true);
        setLengthZeroError(false);
        setRepeatedFilterError(false);
    }, []);

    const submitCustomFilter = useCallback(
        (event: FormEvent): void => {
            event.preventDefault();
            const name = customFilterName;
            const isDuplicate = customFilters.some((f) => f.name === name);
            if (name.length > 0 && !isDuplicate) {
                setLengthZeroError(false);
                setRepeatedFilterError(false);
                onSaveCustomFilter(name);
                setCustomFilterForm(false);
                setCustomFilterName("");
                return;
            }
            setLengthZeroError(name.length === 0);
            setRepeatedFilterError(name.length > 0 && isDuplicate);
        },
        [customFilterName, customFilters, onSaveCustomFilter],
    );

    const isSelected = useCallback(
        (dataType: string, id: Id | string): boolean =>
            selectedFilters.some(
                (f) => f.dataType === dataType && String(f.id) === String(id),
            ),
        [selectedFilters],
    );

    // -- [K] Applied filters split by mode. ------------------------------------
    const includedFilters = selectedFilters.filter((f) => f.mode !== "exclude");
    const excludedFilters = selectedFilters.filter((f) => f.mode === "exclude");
    const hasCustomForm = customFilterForm && selectedFilters.length > 0;

    /** One applied-filter chip (shared by the included/excluded groups). */
    const appliedChip = (filter: SelectedFilter): JSX.Element => (
        <div
            key={`${filter.dataType}:${filter.id}`}
            className={`single-applied-filter ${filter.mode ?? "include"}`}
        >
            <span className="name">{filter.name}</span>
            <button
                type="button"
                className="remove-filter e2e-remove-filter"
                aria-label={t("COMMON.FILTERS.REMOVE", "Remove filter {{name}}", { name: filter.name })}
                onClick={() => onRemoveFilter(filter)}
            >
                <Svg icon="icon-close" />
            </button>
        </div>
    );

    return (
        <div className="backlog-filter" id="backlog-filter">
            {/* [J] Custom (saved) filters ------------------------------------ */}
            <div className="custom-filters">
                <div className="custom-filters-header">
                    <div className="custom-filters-title">
                        <span className="name">{t("COMMON.FILTERS.TITLE", "Custom filters")}</span>
                        <span className="number">({customFilters.length})</span>
                    </div>
                    {!customFilterForm && (
                        <button
                            type="button"
                            className="add-custom-filter"
                            disabled={selectedFilters.length === 0}
                            onClick={openCustomFilter}
                        >
                            {t("COMMON.FILTERS.ACTION_ADD", "Add")}
                        </button>
                    )}
                </div>

                {hasCustomForm && (
                    <form className="custom-filters-add-form" onSubmit={submitCustomFilter}>
                        <input
                            className={`add-filter-input e2e-filter-name-input${
                                lengthZeroError || repeatedFilterError ? " checksley-error" : ""
                            }`}
                            type="text"
                            placeholder={t(
                                "COMMON.FILTERS.PLACEHOLDER_FILTER_NAME",
                                "Write the filter name and press enter",
                            )}
                            aria-label={t(
                                "COMMON.FILTERS.PLACEHOLDER_FILTER_NAME",
                                "Write the filter name and press enter",
                            )}
                            value={customFilterName}
                            onChange={(e) => setCustomFilterName(e.target.value)}
                        />
                        {lengthZeroError && (
                            <span className="error-text">
                                {t("COMMON.FILTERS.LENGTH_ZERO_ERROR", "Please add a filter name")}
                            </span>
                        )}
                        {repeatedFilterError && !lengthZeroError && (
                            <span className="error-text">
                                {t("COMMON.FILTERS.REPEATED_FILTER_ERROR", "This filter name is already in use")}
                            </span>
                        )}
                        <button className="btn-small e2e-open-custom-filter-form" type="submit">
                            {t("COMMON.FILTERS.ACTION_SAVE_CUSTOM_FILTER", "save filter")}
                        </button>
                    </form>
                )}

                {customFilters.length > 0 && (
                    <div className="custom-filter-list">
                        {customFilters.map((filter) => (
                            <div
                                key={String(filter.id)}
                                className={`single-filter single-filter-type-custom${
                                    filter.id === activeCustomFilter ? " active" : ""
                                }`}
                            >
                                <button
                                    type="button"
                                    className="name"
                                    onClick={() => onSelectCustomFilter(filter)}
                                >
                                    {filter.name}
                                </button>
                                <button
                                    type="button"
                                    className="remove-filter e2e-remove-custom-filter"
                                    aria-label={t("COMMON.FILTERS.REMOVE_CUSTOM_FILTER", "Remove saved filter {{name}}", {
                                        name: filter.name,
                                    })}
                                    onClick={() => onRemoveCustomFilter(filter)}
                                >
                                    <Svg icon="icon-trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="filters-step-cat">
                {/* [K] Applied filters, split into included / excluded --------- */}
                {(includedFilters.length > 0 || excludedFilters.length > 0) && (
                    <div className="filters-applied">
                        {includedFilters.length > 0 && (
                            <div className="filters-included">
                                <div className="filters-title">
                                    {t("COMMON.FILTERS.ADVANCED_FILTERS.INCLUDED", "Filtered by:")}
                                </div>
                                <div className="filters-wrapper">
                                    {includedFilters.map(appliedChip)}
                                </div>
                            </div>
                        )}
                        {excludedFilters.length > 0 && (
                            <div className="filters-excluded">
                                <div className="filters-title">
                                    {t("COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDED", "Excluded:")}
                                </div>
                                <div className="filters-wrapper">
                                    {excludedFilters.map(appliedChip)}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* [K] Include / exclude mode toggle --------------------------- */}
                <div className="filters-advanced">
                    <div className="filters-advanced-form">
                        {FILTER_MODE_OPTIONS.map((option) => (
                            <div className="custom-radio" key={option}>
                                <input
                                    type="radio"
                                    name="filter-mode"
                                    id={`filter-mode-${option}`}
                                    value={option}
                                    checked={filterMode === option}
                                    onChange={() => onSetFilterMode(option)}
                                />
                                <label
                                    className={`filter-mode ${option}${
                                        filterMode === option ? " active" : ""
                                    }`}
                                    htmlFor={`filter-mode-${option}`}
                                >
                                    <span className="radio-mark">
                                        <span className={`radio-mark-inner ${option}`} />
                                    </span>
                                    <span>
                                        {option === "include"
                                            ? t("COMMON.FILTERS.ADVANCED_FILTERS.INCLUDE", "Include")
                                            : t("COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDE", "Exclude")}
                                    </span>
                                </label>
                            </div>
                        ))}
                    </div>
                </div>

                {/* [L] Collapsible filter categories --------------------------- */}
                <div className="filters-cats">
                    <ul>
                        {filters.map((category) => {
                            const open = isOpen(category.dataType);
                            return (
                                <li
                                    key={category.dataType}
                                    className={open ? "selected" : ""}
                                    data-type={category.dataType}
                                >
                                    <button
                                        type="button"
                                        className={`filters-cat-single e2e-category${
                                            open ? " selected" : ""
                                        }`}
                                        aria-expanded={open}
                                        onClick={() => toggleCategory(category.dataType)}
                                    >
                                        <span className="title">{category.title}</span>
                                        <Svg icon={open ? "icon-arrow-down" : "icon-arrow-right"} />
                                    </button>

                                    {open && (
                                        <div className="filter-list">
                                            {category.content
                                                .filter(
                                                    (option) =>
                                                        !isSelected(category.dataType, option.id),
                                                )
                                                .map((option) => (
                                                    <button
                                                        type="button"
                                                        key={String(option.id)}
                                                        className={`single-filter ${optionTypeClass(
                                                            category.dataType,
                                                        )}`}
                                                        style={optionStyle(
                                                            category.dataType,
                                                            option,
                                                        )}
                                                        onClick={() => onAddFilter(category, option)}
                                                    >
                                                        <span className="name">{option.name}</span>
                                                        {typeof option.count === "number" &&
                                                            option.count > 0 && (
                                                                <span className="number e2e-filter-count">
                                                                    {option.count}
                                                                </span>
                                                            )}
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* BacklogApp                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The React Backlog root. See the file header for the full responsibility list
 * and the transient-NaN / shared-session contracts.
 */
export function BacklogApp(props: BacklogAppProps): JSX.Element {
    const { projectId } = props;

    /* ---------------------------------------------------------------------- */
    /* Phase A — state & derived values                                        */
    /* ---------------------------------------------------------------------- */

    const bs = useBacklogState();
    const { state } = bs;
    // Destructure the STABLE updater callbacks. `bs` itself re-identifies on
    // every state change (its `useMemo` lists `state`), but each updater is a
    // `useCallback([])` and therefore constant for the component's lifetime.
    // Depending on the individual setters (never on `bs`) keeps the memoised
    // loaders/handlers stable and prevents the mount effect from re-firing on
    // every state update (which would be an infinite reload loop).
    const {
        setStats,
        setSprints,
        setClosedSprints,
        appendUserstories,
        setLoadingUserstories,
        setFirstLoadComplete,
        setFilters,
        setCustomFilters,
        setFilterQ,
        setForecasting,
        applyMovedUserstories,
        removeUserStory,
        restoreUserstories,
        patchUserStory,
        setSelection,
        clearSelection,
        setNewUs,
        toggleShowTags: bsToggleShowTags,
        toggleActiveFilters: bsToggleActiveFilters,
        toggleVelocityForecasting: bsToggleVelocityForecasting,
    } = bs;

    // Local component state NOT owned by the board-state hook.
    const [project, setProject] = useState<Project | null>(null);
    const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    // [ERR-2] offline surface: set when a React `fetch` fails with no HTTP
    // response (network down). Mirrors the AngularJS offline interceptor branch
    // (`errorHandlingService.error()`, app.coffee L620-623) which renders a
    // full-page error rather than a transient toast.
    const [connectionError, setConnectionError] = useState<boolean>(false);
    // The EFFECTIVE project id the whole screen keys off. It is the prop id when
    // that is already a valid positive integer; otherwise it stays `NaN` until
    // `loadProject` resolves it from the URL slug via `GET projects/by_slug`
    // (QA finding #1). `resolvedIdRef` mirrors it so the memoised async loaders
    // can read the freshest id the instant `loadProject` publishes it — WITHIN
    // the same `loadInitialData` run — without being re-created on every change.
    const [resolvedId, setResolvedId] = useState<number>(() =>
        isValidProjectId(projectId) ? projectId : NaN,
    );
    const [burndownCollapsed, setBurndownCollapsed] = useState<boolean>(() =>
        readStoredBooleanMigrating(
            BURNDOWN_COLLAPSED_KEY,
            BURNDOWN_COLLAPSED_LEGACY_APPROX_KEY,
        ),
    );
    const [closedSprintsVisible, setClosedSprintsVisible] = useState<boolean>(false);
    const [sprintLightbox, setSprintLightbox] = useState<SprintLightboxState>({
        open: false,
        mode: "create",
        sprint: null,
        initialValues: { name: "", estimated_start: "", estimated_finish: "", project: null },
        lastSprintName: null,
        canDelete: false,
    });
    const [bulkLightbox, setBulkLightbox] = useState<BulkLightboxState>({ open: false });
    const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
        open: false,
        us: null,
        busy: false,
    });
    const [usLightbox, setUsLightbox] = useState<UsLightboxState>({
        open: false,
        mode: "create",
        us: null,
    });
    // Include/exclude mode of the NEXT filter option selected (QA finding [K]),
    // and the id of the applied saved filter for its `.active` highlight ([J]).
    const [filterMode, setFilterMode] = useState<string>("include");
    const [activeCustomFilter, setActiveCustomFilter] = useState<Id | string | null>(null);

    // Refs that mirror the latest render values so the memoised async callbacks
    // never read a stale closure (the controller relied on a live `@scope`).
    const aliveRef = useRef<boolean>(true);
    // M-04: per-project generation. `loadProject` bumps it whenever it (re)resolves
    // the project — a new prop id on a same-instance transition, or a `.projects`
    // refresh. Every dependent loader (stats/sprints/userstories/filters) captures
    // the generation at its start and commits ONLY if it is still current, so a
    // late completion cannot publish data for a project that has since changed.
    // This closes the gap the boolean `aliveRef` alone could not (the root stays
    // "alive" across a same-instance project transition).
    const loadGenRef = useRef<number>(0);
    // M-04: per-query generation for the paginated userstories load, so a slow
    // response for an older filter/search/page cannot overwrite the list produced
    // by a newer query (latest-wins), independent of the project generation.
    const userstoriesGenRef = useRef<number>(0);
    const stateRef = useRef(state);
    stateRef.current = state;
    const projectRef = useRef<Project | null>(project);
    projectRef.current = project;
    const resolvedIdRef = useRef<number>(resolvedId);
    resolvedIdRef.current = resolvedId;
    const closedVisibleRef = useRef<boolean>(closedSprintsVisible);
    closedVisibleRef.current = closedSprintsVisible;
    // Mirror the include/exclude mode so `addFilterBacklog` (memoised, no
    // `filterMode` dependency) always reads the live value.
    const filterModeRef = useRef<string>(filterMode);
    filterModeRef.current = filterMode;

    // Pagination cursor authority: the hook's `appendUserstories` increments its
    // own `page` on `hasNextPage` but does NOT reset it on a reset-load, so the
    // request page is tracked HERE instead (1-based; next page to request).
    const pageRef = useRef<number>(1);

    // WebSocket client (created lazily in `initializeSubscription`).
    const eventsRef = useRef<ReturnType<typeof createEventsClient> | null>(null);

    // Debounce timer for free-text search.
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dragEnabled = useMemo(() => isDragEnabled(project), [project]);
    const canLoadMore = !state.disablePagination && state.firstLoadComplete;
    const baseHref = useMemo(() => getBaseHref(), []);

    // [ERR-2] — replicate the AngularJS global HTTP interceptors that the React
    // `fetch` path bypasses, mapping their side effects onto this root's
    // full-page surfaces (mirroring `errorHandlingService.error()`/`.block()`
    // which render an overlay rather than navigating):
    //   - offline (network failure) → a full-page connection-error overlay;
    //   - 451 blocked-project        → the existing permission-denied overlay.
    // The 401 refresh/redirect is handled by the DEFAULT interceptor policy
    // (`shared/api/httpInterceptor`), which persists the rotated token to the
    // shared session and redirects to login only in a real browser. Hooks are
    // reset on unmount so a later screen restores the default (toast) policy.
    useEffect(() => {
        setInterceptorHooks({
            onOffline: () => {
                setConnectionError(true);
            },
            onBlocked: () => {
                setPermissionDenied(true);
            },
        });
        return () => {
            resetInterceptorHooks();
        };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Phase B — data loaders (ALL guarded by isValidProjectId(resolvedId))    */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of `loadProject` (main.coffee L469), extended with URL-slug
     * resolution to fix QA finding #1. Resolves the project payload and gates
     * the whole screen: a project without `is_backlog_activated`, or a 403/451
     * (blocked / archived) response, sets `permissionDenied`. Returns `true`
     * only when the backlog may proceed to load.
     *
     * Resolution strategy (ONE network round-trip, never `GET /projects/0`):
     *   - When the host attribute yielded a valid positive integer id, fetch
     *     `GET projects/{id}` directly (the fast path; also what unit tests that
     *     pass a real `projectId` exercise).
     *   - Otherwise the migrated Jade shell never interpolated a usable id (its
     *     `data-project-id="{{project.id}}"` has no controller-scope `project`),
     *     so fall back to the slug embedded in the URL — `/project/:pslug/...` —
     *     and resolve the project with `GET projects/by_slug?slug={pslug}`. When
     *     no slug is present (e.g. a transient render with a bare path) there is
     *     nothing to resolve yet, so return without touching the network.
     *
     * On success the resolved id is published to BOTH `resolvedIdRef` (read
     * synchronously by the parallel loaders in the same `loadInitialData` run)
     * and `resolvedId` state (drives the render gate + memo recreation).
     *
     * [ERR-3]: the transient gate state (`permissionDenied` / `loadError`) is
     * reset at the START of every load so a stale denial/error from a previous
     * project or a recovered failure never sticks across reloads.
     */
    const loadProject = useCallback(async (): Promise<boolean> => {
        // [ERR-3] — clear any prior denial/error before (re)loading.
        setPermissionDenied(false);
        setLoadError(null);
        // [ERR-2] — clear a prior offline overlay so a recovered connection
        // never keeps the board wedged on a stale connection-error screen.
        setConnectionError(false);

        // M-04: open a NEW generation for this project resolution. Any load already
        // in flight (from a prior project id or an overlapping refresh) is now
        // stale and drops its result below.
        const myGen = ++loadGenRef.current;

        try {
            // Choose the resolution endpoint. Only a valid positive-integer id
            // uses the by-id path (called with a single arg, exactly as before);
            // everything else falls back to the URL slug via `projects/by_slug`.
            let res: HttpResponse<Project>;
            if (isValidProjectId(projectId)) {
                res = await httpGet<Project>(`projects/${projectId}`);
            } else {
                const slug = slugFromLocation();
                if (!slug) {
                    // No id and no slug → nothing resolvable yet; no network.
                    return false;
                }
                res = await httpGet<Project>("projects/by_slug", { slug });
            }
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return false;
            }
            // Publish the resolved id to the ref FIRST so the loaders invoked
            // later in this same `loadInitialData` run read the real id, then to
            // state so the render gate opens and the memo chain recomputes.
            resolvedIdRef.current = res.data.id;
            setResolvedId(res.data.id);
            setProject(res.data);
            if (!res.data.is_backlog_activated) {
                // Port `errorHandlingService.permissionDenied()`.
                setPermissionDenied(true);
                return false;
            }
            return true;
        } catch (err) {
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return false;
            }
            // Respect blocked / archived responses (403 / 451) as permission-denied.
            if (err instanceof HttpError && (err.status === 403 || err.status === 451)) {
                setPermissionDenied(true);
            } else {
                setLoadError(t("BACKLOG.ERROR_LOADING_BACKLOG", "The backlog could not be loaded."));
                reportError("loadProject failed", err);
            }
            return false;
        }
    }, [projectId]);

    /**
     * Port of `loadProjectStats` (main.coffee L256). The hook derives
     * `completedPercentage` and `showGraphPlaceholder` inside `setStats`.
     */
    const loadProjectStats = useCallback(async (): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        // M-04: bind this load to the project generation active at its start.
        const myGen = loadGenRef.current;
        try {
            const res = await httpGet<ProjectStats>(`projects/${id}/stats`);
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            setStats(res.data);
        } catch (err) {
            reportError("loadProjectStats failed", err);
        }
    }, [setStats]);

    /**
     * Port of `loadSprints` (main.coffee L304): open sprints (`{closed:false}`),
     * `totalMilestones = open + closed`. The hook sorts each sprint's stories by
     * `sprint_order` and derives `currentSprint`.
     */
    const loadSprints = useCallback(async (): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        // M-04: bind to the project generation active at start.
        const myGen = loadGenRef.current;
        try {
            const result = await milestonesApi.list(id, { closed: false });
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            const open = Number.isNaN(result.open) ? result.milestones.length : result.open;
            const closed = Number.isNaN(result.closed) ? 0 : result.closed;
            setSprints(result.milestones as unknown as Sprint[], open, closed);
        } catch (err) {
            reportError("loadSprints failed", err);
        }
    }, [setSprints]);

    /** Port of `loadClosedSprints` (main.coffee L281): closed sprints (`{closed:true}`). */
    const loadClosedSprints = useCallback(async (): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        // M-04: bind to the project generation active at start.
        const myGen = loadGenRef.current;
        try {
            const result = await milestonesApi.list(id, { closed: true });
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            const closed = Number.isNaN(result.closed) ? result.milestones.length : result.closed;
            setClosedSprints(result.milestones as unknown as Sprint[], closed);
        } catch (err) {
            reportError("loadClosedSprints failed", err);
        }
    }, [setClosedSprints]);

    /**
     * Port of `loadUserstories` (main.coffee L341): the backlog (milestone
     * "null") page, whitelisted filter params + free-text `q`, reading the
     * pagination / total / no-swimlane response headers. `reset` restarts
     * pagination; otherwise the next page (tracked by `pageRef`) is appended.
     * `q` / `selected` overrides let callers pass fresh values without waiting
     * for the async state update.
     */
    const loadUserstories = useCallback(
        async (opts: { reset: boolean; q?: string; selected?: SelectedFilter[] }): Promise<void> => {
            const id = resolvedIdRef.current;
            if (!isValidProjectId(id)) {
                return;
            }
            const s = stateRef.current;
            const q = opts.q !== undefined ? opts.q : s.filterQ;
            const selected = opts.selected !== undefined ? opts.selected : s.selectedFilters;
            const requestPage = opts.reset ? 1 : pageRef.current;

            // M-04: bind to the current project generation AND claim a new query
            // generation. The commit below must be BOTH the newest query and still
            // for the current project, so a stale filter/search/page response never
            // overwrites a newer one and a cross-project response never lands.
            const projGen = loadGenRef.current;
            const usGen = ++userstoriesGenRef.current;

            setLoadingUserstories(true);

            const params: QueryParams = {
                project: id,
                milestone: "null",
                page: requestPage,
                page_size: PAGE_SIZE,
            };
            if (q) {
                params.q = q;
            }
            Object.assign(params, pickSelectedFilterParams(selected));

            try {
                const res = await httpGet<UserStory[]>("userstories", params);
                if (
                    !aliveRef.current ||
                    projGen !== loadGenRef.current ||
                    usGen !== userstoriesGenRef.current
                ) {
                    return;
                }

                // Truthiness of `x-pagination-next` mirrors the source's
                // `if header('x-pagination-next')`.
                const hasNextPage = Boolean(res.headers.get("x-pagination-next"));
                const totalHeader = res.headers.get("Taiga-Info-Backlog-Total-Userstories");
                const totalUserStories =
                    totalHeader != null ? Number(totalHeader) : s.totalUserStories;
                const noSwimlaneHeader = res.headers.get("Taiga-Info-Userstories-Without-Swimlane");
                const noSwimlane = noSwimlaneHeader != null && Number(noSwimlaneHeader) > 0;

                appendUserstories(res.data, {
                    reset: opts.reset,
                    hasNextPage,
                    totalUserStories,
                    noSwimlane,
                    newUsIds: s.newUs,
                });

                pageRef.current = hasNextPage ? requestPage + 1 : requestPage;
            } catch (err) {
                if (
                    !aliveRef.current ||
                    projGen !== loadGenRef.current ||
                    usGen !== userstoriesGenRef.current
                ) {
                    return;
                }
                setLoadingUserstories(false);
                reportError("loadUserstories failed", err);
            }
        },
        [setLoadingUserstories, appendUserstories],
    );

    /**
     * Port of `generateFilters` (controllerMixins.coffee L229): fetch the
     * filters metadata (scoped to the backlog + current selection) and build the
     * six category widgets. Selected/custom filters are preserved.
     */
    const loadFilters = useCallback(
        async (overrideSelected?: SelectedFilter[]): Promise<void> => {
            const id = resolvedIdRef.current;
            if (!isValidProjectId(id)) {
                return;
            }
            const s = stateRef.current;
            // Callers that just mutated the selection pass it explicitly so the
            // freshly-computed counts reflect it (state update is async).
            const selected =
                overrideSelected !== undefined ? overrideSelected : s.selectedFilters;
            // M-04: bind to the project generation active at start.
            const myGen = loadGenRef.current;
            try {
                const res = await userstoriesApi.filtersData({
                    project: id,
                    milestone: "null",
                    ...pickSelectedFilterParams(selected),
                });
                if (!aliveRef.current || myGen !== loadGenRef.current) {
                    return;
                }
                const categories = buildFilterCategories(res.data);
                setFilters(categories, s.customFilters, selected);
            } catch (err) {
                reportError("loadFilters failed", err);
            }
        },
        [setFilters],
    );

    /**
     * Load the project's saved ("custom") filters from `/user-storage` and
     * publish them to the hook (QA finding [J]; mirrors the second half of
     * `generateFilters`, controllerMixins.coffee L246-L364). Declared here — with
     * the other loaders — because `loadInitialData` lists it as a dependency.
     */
    const loadCustomFilters = useCallback(async (): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        // M-04: bind to the project generation active at start.
        const myGen = loadGenRef.current;
        try {
            const raw = await userStorageApi.getFilters(id, BACKLOG_CUSTOM_FILTERS_SUFFIX);
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            // Update ONLY the customFilters slice. Reading stateRef.current.filters
            // here and writing it back via setFilters would clobber the categories
            // loadFilters set moments earlier (no render has flushed the ref yet).
            setCustomFilters(storedToCustomFilters(raw));
        } catch (err) {
            reportError("loadCustomFilters failed", err);
        }
    }, [setCustomFilters]);

    /** Port of `loadBacklog` (main.coffee L410): stats + sprints + first US page in parallel. */
    const loadBacklog = useCallback(async (): Promise<void> => {
        await Promise.all([loadProjectStats(), loadSprints(), loadUserstories({ reset: true })]);
    }, [loadProjectStats, loadSprints, loadUserstories]);

    /**
     * Refresh the authoritative project record and reconcile everything that
     * depends on it. Invoked by the `changes.project.{id}.projects` WebSocket
     * subscription (C-05) so that — on an already-mounted Backlog screen — a
     * server-side change to project attributes never leaves a stale gate:
     *   - module activation (`is_backlog_activated`),
     *   - permissions (`my_permissions`, e.g. add_us / modify_us / delete_milestone),
     *   - archive / block state (403 / 451 → permission-denied),
     *   - metadata (user-story statuses, points) used by the filters and rows.
     *
     * `loadProject` re-runs the exact gate logic used on first load (clearing or
     * setting `permissionDenied` / `loadError`); when the project is still
     * viewable it reconciles the dependent data (stats, sprints, stories) and the
     * filter categories so status/point metadata changes are reflected. The
     * shared `aliveRef` guard prevents a late completion from committing after
     * unmount (further hardened per-project/per-query in the async-safety pass).
     */
    const refreshProjectState = useCallback(async (): Promise<void> => {
        const ok = await loadProject();
        if (!aliveRef.current || !ok) {
            return;
        }
        await loadBacklog();
        if (!aliveRef.current) {
            return;
        }
        await loadFilters();
    }, [loadProject, loadBacklog, loadFilters]);

    /* ---------------------------------------------------------------------- */
    /* Phase C — WebSocket subscription (port initializeSubscription)          */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of `initializeSubscription` (main.coffee L223). Uses the SHARED
     * events client (never a parallel connection). The `.milestones`
     * subscription passes `{ selfNotification: true }` verbatim so the backlog
     * refreshes even for changes this client originated.
     */
    const initializeSubscription = useCallback((): void => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        // M-04: never leak a prior socket. If a client already exists (e.g. a
        // same-instance project transition re-ran the init), disconnect it before
        // establishing the new subscription so events for the previous project can
        // no longer fire. The mount effect also tears the socket down on a
        // projectId change; this guards any re-init ordering.
        if (eventsRef.current) {
            eventsRef.current.disconnect();
            eventsRef.current = null;
        }
        const client = createEventsClient();
        eventsRef.current = client;
        client.connect();

        client.subscribe(`changes.project.${id}.userstories`, () => {
            void loadUserstories({ reset: true });
            void loadSprints();
        });

        client.subscribe(
            `changes.project.${id}.milestones`,
            () => {
                void loadSprints();
                void loadClosedSprints();
                void loadProjectStats();
            },
            { selfNotification: true },
        );

        // C-05 — project-attribute events. The AngularJS client keeps its
        // permission / module / archive / metadata gates fresh on an
        // already-open screen by reacting to `changes.project.{id}.projects`
        // (the same routing key the Kanban root already honors). The Backlog had
        // been omitting it, so a server-side module-deactivation, permission
        // revocation, archive/block, or user-story-status/points edit left the
        // mounted Backlog stale. Refresh the project record (which re-evaluates
        // every gate) and reconcile the dependent data on any `.projects` event
        // — the Backlog has no swimlanes, so (unlike Kanban) it does not narrow
        // to swimlane/status match strings; any project-attribute change is
        // relevant to at least one Backlog gate or list.
        client.subscribe(`changes.project.${id}.projects`, () => {
            void refreshProjectState();
        });
    }, [
        loadUserstories,
        loadSprints,
        loadClosedSprints,
        loadProjectStats,
        refreshProjectState,
    ]);

    /**
     * Port of `loadInitialData` (main.coffee L488): project → subscription →
     * backlog → filters, then flag first-load-complete. Restores the persisted
     * show-tags preference before loading (port of the `getShowTags` check).
     */
    const loadInitialData = useCallback(async (): Promise<void> => {
        // NO leading id guard: in production the host attribute never yields a
        // usable id, so the id is resolved from the URL slug INSIDE loadProject.
        // loadProject returns false (without touching the network) when nothing
        // is resolvable, which correctly short-circuits the rest of the load.
        const ok = await loadProject();
        if (!aliveRef.current || !ok) {
            return;
        }

        initializeSubscription();

        // Restore the persisted show-tags preference (port of `getShowTags`).
        // Uses the RESOLVED id (published synchronously by loadProject above).
        try {
            const pid = resolvedIdRef.current;
            let stored = window.localStorage.getItem(showTagsKey(pid));
            if (stored == null) {
                // N-01 migration: honor a value written under the pre-N-01
                // approximated key, copying it forward under the exact key.
                const approx = window.localStorage.getItem(showTagsLegacyApproxKey(pid));
                if (approx != null) {
                    try {
                        window.localStorage.setItem(showTagsKey(pid), approx);
                    } catch {
                        /* best-effort */
                    }
                    stored = approx;
                }
            }
            if (stored != null) {
                const desired = stored === "true";
                if (stateRef.current.showTags !== desired) {
                    bsToggleShowTags();
                }
            }
        } catch {
            /* ignore storage access failures */
        }

        await loadBacklog();
        if (!aliveRef.current) {
            return;
        }
        await loadFilters();
        if (!aliveRef.current) {
            return;
        }
        // Saved ("custom") filters — QA finding [J]. Loaded after the categories
        // so the panel can resolve saved ids to display names on first paint.
        await loadCustomFilters();
        if (!aliveRef.current) {
            return;
        }
        setFirstLoadComplete(true);
    }, [
        loadProject,
        initializeSubscription,
        loadBacklog,
        loadFilters,
        loadCustomFilters,
        setFirstLoadComplete,
        bsToggleShowTags,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Phase E — drag & drop                                                   */
    /* ---------------------------------------------------------------------- */

    /**
     * Resolve a raw dnd-kit drop into the container-agnostic {@link ResolvedDrop}
     * the provider needs. It locates the dragged story's ORIGIN container/index
     * from board state, derives the TARGET container + drop index from `overId`
     * (a container key `"backlog"` / `"sprint:{id}"`, or another row's numeric
     * id), and builds the target's post-drop ordered id list (with the dragged
     * id inserted). Returns `null` for a no-op (same container + unchanged
     * index) or an unresolvable drop.
     */
    const resolveDrop = useCallback((event: NormalizedDragEnd): ResolvedDrop | null => {
        const { userstories, sprints, closedSprints } = stateRef.current;
        const draggedId = event.activeId;
        const overId = event.overId;
        if (overId == null || overId === draggedId) {
            return null;
        }

        const origin = locateUs(draggedId, userstories, sprints, closedSprints);
        if (!origin) {
            return null;
        }

        let targetKey: string;
        let dropIndex: number;

        if (typeof overId === "string") {
            // Dropped on a container itself → append at the end.
            targetKey = overId;
            const base = containerIds(targetKey, userstories, sprints, closedSprints).filter(
                (id) => id !== draggedId,
            );
            dropIndex = base.length;
        } else {
            // Dropped over another row.
            const overLoc = locateUs(overId, userstories, sprints, closedSprints);
            if (!overLoc) {
                return null;
            }
            targetKey = overLoc.containerKey;
            const base = overLoc.ids.filter((id) => id !== draggedId);
            const k = base.indexOf(overId);
            if (k === -1) {
                dropIndex = base.length;
            } else if (
                overLoc.containerKey === origin.containerKey &&
                origin.index < overLoc.index
            ) {
                // SAME-container DOWNWARD move ([N]): land AFTER the over-row.
                // Filtering the dragged id out of `base` shifts every row below the
                // drag up by one, so the plain "insert BEFORE the over-row" index
                // (`k`) resolves to the drag's ORIGINAL slot — a silent no-op that
                // affected BOTH a single-ArrowDown keyboard step AND an adjacent
                // pointer drag (the story never moved and nothing persisted).
                // Landing at `k + 1` reproduces canonical dnd-kit `arrayMove`
                // semantics (moving down = step PAST each crossed row), so the item
                // advances exactly one slot per crossed row for pointer and keyboard
                // alike. Upward moves and cross-container drops need no adjustment
                // because removing the dragged id does not shift the over-row.
                dropIndex = k + 1;
            } else {
                // Same-container UPWARD move, or a cross-container insertion: land
                // at the over-row's position (insert before it).
                dropIndex = k;
            }
        }

        const targetIds = containerIds(targetKey, userstories, sprints, closedSprints).filter(
            (id) => id !== draggedId,
        );
        const insertAt = Math.max(0, Math.min(dropIndex, targetIds.length));
        const orderedIds = targetIds.slice();
        orderedIds.splice(insertAt, 0, draggedId);

        const resolved: ResolvedDrop = {
            origin: { containerKey: origin.containerKey, index: origin.index },
            target: { containerKey: targetKey, index: insertAt },
            orderedIds,
            draggedIds: [draggedId],
        };

        if (
            resolved.origin.containerKey === resolved.target.containerKey &&
            resolved.origin.index === resolved.target.index
        ) {
            return null;
        }
        return resolved;
    }, []);

    /**
     * Persist a resolved drop. Ports `moveUs` (main.coffee L523): optimistic
     * splice via `applyMovedUserstories`, then a SINGLE
     * `bulkUpdateBacklogOrder(project, targetMilestoneId, after, before, bulk)`
     * (the frozen contract routes both reorders AND cross-list moves through
     * this one endpoint — the target milestone id carries the move). On success
     * the returned rows reconcile `milestone` / order; on failure the optimistic
     * move is rolled back.
     */
    const persist = useCallback(
        async (resolved: ResolvedDrop, neighbors: DropNeighbors): Promise<void> => {
            const s = stateRef.current;
            const prev: MovedCollections = {
                userstories: s.userstories,
                sprints: s.sprints,
                closedSprints: s.closedSprints,
            };
            const draggedId = resolved.draggedIds[0];
            const moved = applyOptimisticMove(
                prev,
                draggedId,
                resolved.origin.containerKey,
                resolved.target.containerKey,
                resolved.target.index,
            );
            if (!moved) {
                return;
            }

            applyMovedUserstories(moved);

            const targetMilestoneId = milestoneIdFromKey(resolved.target.containerKey);
            const persister = createBacklogPersister(resolvedId);

            try {
                // Neighbor → API mapping: previous → afterUserstoryId, next → beforeUserstoryId.
                const res = await persister({
                    milestoneId: targetMilestoneId,
                    afterUserstoryId: neighbors.previous,
                    beforeUserstoryId: neighbors.next,
                    bulkUserstories: resolved.draggedIds,
                });
                if (!aliveRef.current) {
                    return;
                }

                for (const updated of res.data) {
                    const record = updated as {
                        milestone?: unknown;
                        backlog_order?: unknown;
                        sprint_order?: unknown;
                    };
                    const changes: Partial<UserStory> = {};
                    if (typeof record.milestone === "number" || record.milestone === null) {
                        changes.milestone = record.milestone as Id | null;
                    }
                    if (typeof record.backlog_order === "number") {
                        changes.backlog_order = record.backlog_order;
                    }
                    if (typeof record.sprint_order === "number") {
                        changes.sprint_order = record.sprint_order;
                    }
                    patchUserStory(updated.id, changes);
                }

                // The events layer refreshes when connected; the client's
                // `connected` flag is private, so reload the affected
                // collections unconditionally (idempotent) — mirrors moveUs'
                // `if !@events.connected` reloads.
                const reloads: Array<Promise<void>> = [loadSprints(), loadProjectStats()];
                if (closedVisibleRef.current) {
                    reloads.push(loadClosedSprints());
                }
                await Promise.all(reloads);
            } catch (err) {
                if (aliveRef.current) {
                    // Roll back the optimistic move.
                    applyMovedUserstories(prev);
                }
                reportError(
                    "drag order persistence failed",
                    err,
                    t("BACKLOG.ERROR_MOVE_US", "Could not save the new order. Please try again."),
                );
            }
        },
        [resolvedId, applyMovedUserstories, patchUserStory, loadSprints, loadProjectStats, loadClosedSprints],
    );

    /**
     * Port of `moveUsToTopOfBacklog` (main.coffee L511): place a story at the
     * top of the backlog. Reproduces `moveUs(..., 0, null, null, nextUs)` — i.e.
     * `bulkUpdateBacklogOrder(project, null, null, nextUs, [us.id])` (backlog
     * milestone, `beforeUserstoryId = nextUs`). No-op when the backlog is empty
     * or the story is already first.
     */
    const moveUsToTopOfBacklog = useCallback(
        async (us: UserStory): Promise<void> => {
            const s = stateRef.current;
            if (!s.userstories.length) {
                return;
            }
            const nextUs = s.userstories[0].id;
            if (nextUs === us.id) {
                return;
            }

            const origin = locateUs(us.id, s.userstories, s.sprints, s.closedSprints);
            const originKey = origin ? origin.containerKey : BACKLOG_KEY;

            const prev: MovedCollections = {
                userstories: s.userstories,
                sprints: s.sprints,
                closedSprints: s.closedSprints,
            };
            const moved = applyOptimisticMove(prev, us.id, originKey, BACKLOG_KEY, 0);
            if (moved) {
                applyMovedUserstories(moved);
            }

            try {
                const res = await userstoriesApi.bulkUpdateBacklogOrder(
                    resolvedId,
                    null,
                    null,
                    nextUs,
                    [us.id],
                );
                if (!aliveRef.current) {
                    return;
                }
                for (const updated of res.data) {
                    const record = updated as { milestone?: unknown; backlog_order?: unknown };
                    const changes: Partial<UserStory> = {};
                    if (typeof record.milestone === "number" || record.milestone === null) {
                        changes.milestone = record.milestone as Id | null;
                    }
                    if (typeof record.backlog_order === "number") {
                        changes.backlog_order = record.backlog_order;
                    }
                    patchUserStory(updated.id, changes);
                }
                await Promise.all([loadSprints(), loadProjectStats()]);
            } catch (err) {
                if (aliveRef.current) {
                    applyMovedUserstories(prev);
                }
                reportError(
                    "move-to-top failed",
                    err,
                    t("BACKLOG.ERROR_MOVE_US", "Could not move the story. Please try again."),
                );
            }
        },
        [resolvedId, applyMovedUserstories, patchUserStory, loadSprints, loadProjectStats],
    );

    /* ---------------------------------------------------------------------- */
    /* Phase F — mutation handlers                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of `editUserStory` (main.coffee L653). In AngularJS the controller
     * re-fetched the story + attachments and broadcast to the generic-form
     * lightbox; here the row `us` seeds the React-owned {@link
     * UserStoryEditLightbox} directly (the Angular host was removed by the
     * migration — QA finding #2).
     */
    const onEditUserStory = useCallback((us: UserStory): void => {
        // [#2] Open the React-owned create/edit lightbox in EDIT mode, seeded
        // from the row. Previously this broadcast "genericform:edit" to the
        // Angular `tg-lb-create-edit` host that the migrated backlog.jade
        // removed, so it was a silent no-op.
        setUsLightbox({ open: true, mode: "edit", us });
    }, []);

    /**
     * The ACTUAL user-story deletion (main.coffee L662, minus the confirm):
     * optimistically remove, DELETE, reload stats + sprints; restore on failure.
     * The confirmation step is handled by the themed {@link ConfirmDialog} ([H]).
     */
    const performDeleteUserStory = useCallback(
        async (us: UserStory): Promise<void> => {
            const previous = stateRef.current.userstories;
            removeUserStory(us);

            try {
                await httpDelete(`userstories/${us.id}`);
                if (!aliveRef.current) {
                    return;
                }
                await Promise.all([loadProjectStats(), loadSprints()]);
            } catch (err) {
                if (aliveRef.current) {
                    restoreUserstories(previous);
                }
                reportError(
                    "deleteUserStory failed",
                    err,
                    t("BACKLOG.ERROR_DELETE_US", "Could not delete the story. Please try again."),
                );
            }
        },
        [removeUserStory, restoreUserstories, loadProjectStats, loadSprints],
    );

    /**
     * Row "delete" action: open the themed confirmation dialog ([H], replacing
     * the native `window.confirm`). The dialog's confirm handler runs the
     * deletion. Ports `deleteUserStory`'s `$confirm.askOnDelete(...)` prompt.
     */
    const onDeleteUserStory = useCallback((us: UserStory): void => {
        setDeleteConfirm({ open: true, us, busy: false });
    }, []);

    /** Confirm handler for the delete dialog: run the delete, then close. */
    const handleConfirmDelete = useCallback(async (): Promise<void> => {
        const us = deleteConfirm.us;
        if (!us) {
            return;
        }
        setDeleteConfirm((s) => ({ ...s, busy: true }));
        await performDeleteUserStory(us);
        if (aliveRef.current) {
            setDeleteConfirm({ open: false, us: null, busy: false });
        }
    }, [deleteConfirm.us, performDeleteUserStory]);

    /** Cancel handler for the delete dialog. */
    const handleCancelDelete = useCallback((): void => {
        setDeleteConfirm({ open: false, us: null, busy: false });
    }, []);

    /** Port of the row "move to top" action → {@link moveUsToTopOfBacklog}. */
    const onMoveToTop = useCallback(
        (us: UserStory): void => {
            void moveUsToTopOfBacklog(us);
        },
        [moveUsToTopOfBacklog],
    );

    /**
     * Port of the `tgUsStatus` save + `updateUserStoryStatus` (main.coffee L646):
     * PATCH `{ status, version }`, patch state with the server response, then
     * reload stats. A 409 version conflict reloads the backlog to pick up fresh
     * versions.
     */
    const onChangeStatus = useCallback(
        async (us: UserStory, statusId: Id): Promise<void> => {
            try {
                const res = await httpPatch<UserStory>(`userstories/${us.id}`, {
                    status: statusId,
                    version: us.version,
                });
                if (!aliveRef.current) {
                    return;
                }
                patchUserStory(us.id, res.data);
                await loadProjectStats();
            } catch (err) {
                if (err instanceof HttpError && err.status === 409) {
                    await loadUserstories({ reset: true });
                } else {
                    reportError(
                        "changeStatus failed",
                        err,
                        t("BACKLOG.ERROR_CHANGE_STATUS", "Could not update the status. Please try again."),
                    );
                }
            }
        },
        [patchUserStory, loadProjectStats, loadUserstories],
    );

    /**
     * Port of `tgBacklogUsPoints.onSelectedPointForRole`: merge the new
     * role→point into `us.points`, PATCH `{ points, version }`, patch state,
     * reload stats. 409 reloads the backlog.
     */
    const onChangePoints = useCallback(
        async (us: UserStory, roleId: Id, pointId: Id): Promise<void> => {
            const points: Record<string, Id> = { ...us.points, [String(roleId)]: pointId };
            try {
                const res = await httpPatch<UserStory>(`userstories/${us.id}`, {
                    points,
                    version: us.version,
                });
                if (!aliveRef.current) {
                    return;
                }
                patchUserStory(us.id, res.data);
                await loadProjectStats();
            } catch (err) {
                if (err instanceof HttpError && err.status === 409) {
                    await loadUserstories({ reset: true });
                } else {
                    reportError(
                        "changePoints failed",
                        err,
                        t("BACKLOG.ERROR_CHANGE_POINTS", "Could not update the points. Please try again."),
                    );
                }
            }
        },
        [patchUserStory, loadProjectStats, loadUserstories],
    );

    /**
     * Port of `addNewUs` (main.coffee L683): "standard" opens the shared
     * generic-form lightbox via the Angular bridge; "bulk" opens the React bulk
     * lightbox.
     */
    const addNewUs = useCallback((type: "standard" | "bulk"): void => {
        if (type === "standard") {
            // [#2] Open the React-owned create/edit lightbox in CREATE mode.
            // Previously this broadcast "genericform:new" to the Angular
            // `tg-lb-create-edit` host removed by the migration, so it was a
            // silent no-op.
            setUsLightbox({ open: true, mode: "create", us: null });
        } else {
            setBulkLightbox({ open: true });
        }
    }, []);

    /**
     * Port of `addNewSprint` (main.coffee L693) + the `sprintform:create` date
     * defaults (lightboxes.coffee L120-170): seed the create lightbox with the
     * last open sprint's finish (or today) as the start and start + 2 weeks as
     * the finish.
     */
    const addNewSprint = useCallback((): void => {
        const openSprints = stateRef.current.sprints.filter((s) => !s.closed);
        const sorted = [...openSprints].sort(
            (a, b) =>
                Number(moment(a.estimated_finish, "YYYY-MM-DD").format("X")) -
                Number(moment(b.estimated_finish, "YYYY-MM-DD").format("X")),
        );
        const lastSprint = sorted.length ? sorted[sorted.length - 1] : null;

        const estimatedStart = lastSprint
            ? moment(lastSprint.estimated_finish, "YYYY-MM-DD")
            : moment();
        const estimatedFinish = estimatedStart.clone().add(2, "weeks");

        setSprintLightbox({
            open: true,
            mode: "create",
            sprint: null,
            initialValues: {
                name: "",
                estimated_start: estimatedStart.format("YYYY-MM-DD"),
                estimated_finish: estimatedFinish.format("YYYY-MM-DD"),
                project: resolvedId,
            },
            lastSprintName: lastSprint ? lastSprint.name : null,
            canDelete: false,
        });
    }, [resolvedId]);

    /** Open the sprint lightbox in edit mode for an existing sprint. */
    const onEditSprint = useCallback(
        (sprint: Sprint): void => {
            const proj = projectRef.current;
            const canDelete = !!proj && proj.my_permissions.includes("delete_milestone");
            setSprintLightbox({
                open: true,
                mode: "edit",
                sprint,
                initialValues: {
                    name: sprint.name,
                    estimated_start: moment(sprint.estimated_start, "YYYY-MM-DD").format("YYYY-MM-DD"),
                    estimated_finish: moment(sprint.estimated_finish, "YYYY-MM-DD").format(
                        "YYYY-MM-DD",
                    ),
                    project: resolvedId,
                },
                lastSprintName: null,
                canDelete,
            });
        },
        [resolvedId],
    );

    /**
     * After a create/edit/delete sprint: close the lightbox and reload.
     *
     * [#5] The backlog user-story list MUST be reloaded here too. This handler is
     * unified across create/edit/delete and previously reloaded only the sprint
     * lists and project stats — so when a sprint containing stories was DELETED,
     * the backend `SET_NULL`-ed those stories' milestone (returning them to the
     * backlog) but the on-screen backlog list was never refreshed, so the
     * returned stories did not reappear until a full page reload. Reloading the
     * user stories unconditionally is correct on delete and a harmless refresh on
     * create/edit (where the backlog set is unchanged).
     */
    const onSprintChanged = useCallback(async (): Promise<void> => {
        setSprintLightbox((s) => ({ ...s, open: false }));
        await Promise.all([
            loadSprints(),
            loadClosedSprints(),
            loadProjectStats(),
            loadUserstories({ reset: true }),
        ]);
    }, [loadSprints, loadClosedSprints, loadProjectStats, loadUserstories]);

    /**
     * Port of `usform:bulk:success` (common lightbox L375): flag the created
     * stories (drives the `.new` blink), reload the backlog, and — when the user
     * chose "top" — reorder the created stories to the top of the backlog with a
     * single bulk-order call.
     */
    const onBulkCreated = useCallback(
        async (created: UserStory[], position: "top" | "bottom"): Promise<void> => {
            setNewUs(created.map((u) => u.id));
            setBulkLightbox({ open: false });

            await loadUserstories({ reset: true });
            if (!aliveRef.current) {
                return;
            }

            // [#3] Refresh project stats (total points / completion) unconditionally
            // after a bulk create. Previously stats were reloaded only inside the
            // `position === "top"` reorder branch below, so creating stories at the
            // BOTTOM (the default) left the sidebar totals and the burndown graph
            // stale until a full page reload. Newly created stories add points
            // regardless of insert position, so the stats reload must not be gated
            // on position.
            await loadProjectStats();
            if (!aliveRef.current) {
                return;
            }

            if (position === "top" && created.length) {
                const createdIds = created.map((u) => u.id);
                const existing = stateRef.current.userstories.filter(
                    (u) => !createdIds.includes(u.id),
                );
                const nextUs = existing.length ? existing[0].id : undefined;
                if (nextUs !== undefined) {
                    try {
                        await userstoriesApi.bulkUpdateBacklogOrder(
                            resolvedId,
                            null,
                            null,
                            nextUs,
                            createdIds,
                        );
                        if (!aliveRef.current) {
                            return;
                        }
                        await loadUserstories({ reset: true });
                        await loadProjectStats();
                    } catch (err) {
                        reportError(
                            "bulk move-to-top failed",
                            err,
                            t("BACKLOG.ERROR_MOVE_US", "Could not move the selected stories. Please try again."),
                        );
                    }
                }
            }
        },
        [setNewUs, resolvedId, loadUserstories, loadProjectStats],
    );

    /**
     * [#2] Persist a NEW single story from {@link UserStoryEditLightbox}. Ports
     * the generic-form `mode == 'new'` branch (common/lightboxes.coffee L786-792)
     * onto the AAP-enumerated endpoints: `bulk_create` carries subject + status,
     * and — because that endpoint does NOT accept points/assignee — a follow-up
     * `PATCH userstories/{id}` persists those when set. Then `onBulkCreated`
     * re-reads the backlog (and reorders to the top when the user chose "top"),
     * mirroring `usform:new:success`. Rejects on failure so the lightbox keeps
     * itself open and surfaces the error.
     */
    const onCreateUserStory = useCallback(
        async (fields: UserStoryCreateFields): Promise<void> => {
            const res = await userstoriesApi.bulkCreate(
                resolvedId,
                fields.statusId,
                fields.subject,
                null,
            );
            // The bulk_create endpoint returns full story objects; the API
            // adapter types them with the minimal `{ id }` shape, so narrow to the
            // richer domain `UserStory` (mirrors BulkUserStoriesLightbox). No
            // `any` is used.
            let created = res.data as unknown as UserStory[];
            const first = created[0];
            const hasPoints = Object.keys(fields.points).length > 0;
            // bulk_create carries only subject/status. Everything else the
            // generic form collects is persisted in a follow-up PATCH — but only
            // when at least one such field departs from its create default (so a
            // bare "subject only" create still makes exactly one request).
            const needsFollowUp =
                hasPoints ||
                fields.assignedTo !== null ||
                fields.description !== "" ||
                fields.tags.length > 0 ||
                fields.due_date !== null ||
                fields.is_blocked ||
                fields.team_requirement ||
                fields.client_requirement;
            if (first && needsFollowUp) {
                const patchRes = await httpPatch<UserStory>(`userstories/${first.id}`, {
                    points: fields.points,
                    assigned_to: fields.assignedTo,
                    description: fields.description,
                    tags: fields.tags,
                    due_date: fields.due_date,
                    is_blocked: fields.is_blocked,
                    blocked_note: fields.blocked_note,
                    team_requirement: fields.team_requirement,
                    client_requirement: fields.client_requirement,
                    version: first.version,
                });
                if (!aliveRef.current) {
                    return;
                }
                created = [patchRes.data, ...created.slice(1)];
            }
            // Upload any chosen files against the freshly-created story (ports
            // `createAttachments(data)`).
            if (first) {
                await createAttachments(first.id, fields.attachmentsToAdd);
            }
            await onBulkCreated(created, fields.position);
        },
        [resolvedId, onBulkCreated],
    );

    /**
     * [#2] Persist EDITS to an existing story from {@link UserStoryEditLightbox}.
     * Ports the generic-form `mode == 'edit'` branch (common/lightboxes.coffee
     * L794): `PATCH userstories/{id}` with the changed fields + `version` for
     * optimistic concurrency, then patch state + reload stats + re-read the
     * backlog. A 409 version conflict reloads to pick up fresh versions (ports
     * the 409 branch of `onChangeStatus`); the error is rethrown so the lightbox
     * keeps itself open and surfaces the failure.
     */
    const onSaveUserStoryEdit = useCallback(
        async (target: UserStory, changes: UserStoryEditChanges): Promise<void> => {
            try {
                const res = await httpPatch<UserStory>(`userstories/${target.id}`, {
                    subject: changes.subject,
                    status: changes.status,
                    points: changes.points,
                    assigned_to: changes.assigned_to,
                    description: changes.description,
                    tags: changes.tags,
                    due_date: changes.due_date,
                    is_blocked: changes.is_blocked,
                    blocked_note: changes.blocked_note,
                    team_requirement: changes.team_requirement,
                    client_requirement: changes.client_requirement,
                    version: target.version,
                });
                // Reproduce the CoffeeScript submit order: save →
                // deleteAttachments → createAttachments.
                await deleteAttachments(changes.attachmentsToDelete);
                await createAttachments(target.id, changes.attachmentsToAdd);
                if (!aliveRef.current) {
                    return;
                }
                patchUserStory(target.id, res.data);
                await loadProjectStats();
                await loadUserstories({ reset: true });
            } catch (err) {
                if (err instanceof HttpError && err.status === 409) {
                    await loadUserstories({ reset: true });
                }
                throw err;
            }
        },
        [patchUserStory, loadProjectStats, loadUserstories],
    );

    /**
     * Upload each pending file as an attachment of user story `objectId`, against
     * the frozen `/userstories/attachments` endpoint (ports `createAttachments`).
     * Sequential to keep ordering deterministic.
     */
    const createAttachments = useCallback(
        async (objectId: number, files: File[]): Promise<void> => {
            for (const file of files) {
                await attachmentsApi.uploadUserstoryAttachment(
                    file,
                    objectId,
                    resolvedIdRef.current,
                );
            }
        },
        [],
    );

    /** Delete each queued attachment id (ports `deleteAttachments`). */
    const deleteAttachments = useCallback(
        async (ids: number[]): Promise<void> => {
            for (const attachmentId of ids) {
                await attachmentsApi.deleteUserstoryAttachment(attachmentId);
            }
        },
        [],
    );

    /**
     * Hydrate a story's existing attachments for the edit form. The backlog list
     * endpoint omits the attachments array, so the lightbox calls this on open
     * (against the frozen `/userstories/attachments` list endpoint).
     */
    const fetchUsAttachments = useCallback(
        async (usId: number): Promise<UserStoryAttachment[]> => {
            const response = await attachmentsApi.listUserstoryAttachments(
                usId,
                resolvedIdRef.current,
            );
            return response.data ?? [];
        },
        [],
    );

    /** The prop-drilled user-story action contract (memoised). */
    const actions: UserStoryActions = useMemo(
        () => ({
            onEditUserStory,
            onDeleteUserStory: (us: UserStory) => {
                void onDeleteUserStory(us);
            },
            onMoveToTop,
            onChangeStatus: (us: UserStory, statusId: Id) => {
                void onChangeStatus(us, statusId);
            },
            onChangePoints: (us: UserStory, roleId: Id, pointId: Id) => {
                void onChangePoints(us, roleId, pointId);
            },
        }),
        [onEditUserStory, onDeleteUserStory, onMoveToTop, onChangeStatus, onChangePoints],
    );

    // [#2] Assignable users for the create/edit lightbox's assignee control,
    // derived from the already-loaded `userstories-filters` "assigned_users"
    // category (id = user id, name = full name). This reuses the AAP-enumerated
    // filters endpoint rather than introducing a new members request. The
    // synthetic "Unassigned" entry (id === null / "null") is dropped — the
    // lightbox offers its own "Not assigned" option. Declared here (with the
    // other hooks, BEFORE any early return) to honor the Rules of Hooks.
    const assignableUsers = useMemo<AssignableUser[]>(() => {
        const category = state.filters.find((c) => c.dataType === "assigned_users");
        if (!category) {
            return [];
        }
        return category.content
            .filter((option) => option.id !== null && String(option.id) !== "null")
            .map((option) => ({ id: Number(option.id), name: option.name }))
            .filter((user) => Number.isInteger(user.id));
    }, [state.filters]);

    /* ---------------------------------------------------------------------- */
    /* Phase G — filters / search / toggles                                    */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of the search box: update the controlled `filterQ` immediately, then
     * debounce the reset-load (~250 ms) so keystrokes don't spam the API. The
     * fresh `q` is passed to the loader so it never reads a stale state value.
     */
    const changeQ = useCallback(
        (q: string): void => {
            setFilterQ(q);
            if (searchTimerRef.current !== null) {
                clearTimeout(searchTimerRef.current);
            }
            searchTimerRef.current = setTimeout(() => {
                searchTimerRef.current = null;
                void loadUserstories({ reset: true, q });
            }, SEARCH_DEBOUNCE_MS);
        },
        [setFilterQ, loadUserstories],
    );

    /** Port of the filters toggle (`@activeFilters`). */
    const toggleActiveFilters = useCallback((): void => {
        bsToggleActiveFilters();
    }, [bsToggleActiveFilters]);

    /**
     * Port of `toggleShowTags` + `storeShowTags`: flip the hook flag and persist
     * the preference under the EXACT legacy per-project key
     * `generateHash([projectId, "{projectId}:backlog-tags"])` (N-01, see
     * {@link showTagsKey}), so the value round-trips with what the AngularJS
     * backlog wrote for the same user.
     */
    const toggleShowTags = useCallback((): void => {
        const next = !stateRef.current.showTags;
        bsToggleShowTags();
        writeStoredBoolean(showTagsKey(resolvedId), next);
    }, [resolvedId, bsToggleShowTags]);

    /**
     * Port of the velocity/forecasting toggle: recompute the forecast from the
     * current state (guarding null stats) and hand the forecasted stories to the
     * hook so it can flip `displayVelocity` and recompute `visibleUserStories`.
     */
    const toggleVelocityForecasting = useCallback((): void => {
        const s = stateRef.current;
        const forecasted = s.stats
            ? calculateForecasting(s.userstories, s.sprints, s.stats).forecastedStories
            : [];
        bsToggleVelocityForecasting(forecasted);
    }, [bsToggleVelocityForecasting]);

    /**
     * Port of `tgToggleBurndownVisibility`: flip the burndown collapse flag and
     * persist under the LEGACY key (misspelling `grpahs` preserved verbatim for
     * parity with `generateHash(["is-burndown-grpahs-collapsed"])`).
     */
    const toggleBurndownCollapsed = useCallback((): void => {
        setBurndownCollapsed((prev) => {
            const next = !prev;
            writeStoredBoolean(BURNDOWN_COLLAPSED_KEY, next);
            return next;
        });
    }, []);

    /**
     * Reveal / hide the closed sprints. When revealing for the first time (none
     * loaded yet) the closed milestones are fetched lazily — mirrors the
     * controller's load-on-demand of `loadClosedSprints`.
     */
    const handleToggleClosedSprints = useCallback((): void => {
        setClosedSprintsVisible((prev) => {
            const next = !prev;
            if (next && stateRef.current.closedSprints.length === 0) {
                void loadClosedSprints();
            }
            return next;
        });
    }, [loadClosedSprints]);

    /**
     * Port of `addFilterBacklog` (main.coffee L705): append the chosen option to
     * the selection (deduped), push the new selection to the hook for immediate
     * UI feedback, then reload the backlog page and regenerate the category
     * counts with the fresh selection.
     */
    const addFilterBacklog = useCallback(
        (category: FilterCategory, option: FilterOption): void => {
            const s = stateRef.current;
            const exists = s.selectedFilters.some(
                (f) => f.dataType === category.dataType && String(f.id) === String(option.id),
            );
            if (exists) {
                return;
            }
            // Attach the current include/exclude mode (QA finding [K]) so the
            // selection round-trips to the correct `status` / `exclude_status`
            // query param (see `pickSelectedFilterParams`).
            const added: SelectedFilter = {
                id: option.id,
                name: option.name,
                dataType: category.dataType,
                mode: filterModeRef.current,
                ...(option.color !== undefined ? { color: option.color } : {}),
            };
            const nextSelected = [...s.selectedFilters, added];
            // A manual selection clears the applied saved-filter highlight
            // (filter.controller.coffee `selectFilter` sets activeCustomFilter = null).
            setActiveCustomFilter(null);
            setFilters(s.filters, s.customFilters, nextSelected);
            void loadUserstories({ reset: true, selected: nextSelected });
            void loadFilters(nextSelected);
        },
        [setFilters, loadUserstories, loadFilters],
    );

    /** Port of `removeFilterBacklog` (main.coffee L710): drop the selected filter. */
    const removeFilterBacklog = useCallback(
        (filter: SelectedFilter): void => {
            const s = stateRef.current;
            const nextSelected = s.selectedFilters.filter(
                (f) => !(f.dataType === filter.dataType && String(f.id) === String(filter.id)),
            );
            setActiveCustomFilter(null);
            setFilters(s.filters, s.customFilters, nextSelected);
            void loadUserstories({ reset: true, selected: nextSelected });
            void loadFilters(nextSelected);
        },
        [setFilters, loadUserstories, loadFilters],
    );

    /* -- Custom (saved) filters — QA finding [J] --------------------------- */

    /**
     * Port of `saveCustomFilter` (controllerMixins.coffee L201-L214): snapshot
     * the current selection into a param map, merge it under `name`, and persist
     * the whole map back to `/user-storage`.
     */
    const saveCustomFilter = useCallback(
        async (name: string): Promise<void> => {
            const id = resolvedIdRef.current;
            if (!isValidProjectId(id)) {
                return;
            }
            const paramMap = selectedToStoredMap(stateRef.current.selectedFilters);
            try {
                const existing = await userStorageApi.getFilters(
                    id,
                    BACKLOG_CUSTOM_FILTERS_SUFFIX,
                );
                const next: StoredCustomFilters = { ...existing, [name]: paramMap };
                await userStorageApi.storeFilters(id, next, BACKLOG_CUSTOM_FILTERS_SUFFIX);
                if (!aliveRef.current) {
                    return;
                }
                // Only the customFilters slice changes; leave categories/selection intact.
                setCustomFilters(storedToCustomFilters(next));
            } catch (err) {
                reportError(
                    "saveCustomFilter failed",
                    err,
                    t("BACKLOG.ERROR_SAVE_CUSTOM_FILTER", "Could not save the custom filter. Please try again."),
                );
            }
        },
        [setCustomFilters],
    );

    /**
     * Port of `selectCustomFilter` (controllerMixins.coffee L197-L200): replace
     * the whole selection with the saved filter's stored params, then reload.
     */
    const selectCustomFilter = useCallback(
        (filter: CustomFilter): void => {
            const s = stateRef.current;
            const nextSelected = reconstructSelectedFromParamMap(filter.filter ?? {}, s.filters);
            setActiveCustomFilter(filter.id);
            setFilters(s.filters, s.customFilters, nextSelected);
            void loadUserstories({ reset: true, selected: nextSelected });
            void loadFilters(nextSelected);
        },
        [setFilters, loadUserstories, loadFilters],
    );

    /**
     * Port of `removeCustomFilter` (controllerMixins.coffee L216-L221): drop the
     * saved filter from the stored map and persist (DELETE when it becomes
     * empty). The current selection is left untouched.
     */
    const removeCustomFilter = useCallback(
        async (filter: CustomFilter): Promise<void> => {
            const id = resolvedIdRef.current;
            if (!isValidProjectId(id)) {
                return;
            }
            try {
                const existing = await userStorageApi.getFilters(
                    id,
                    BACKLOG_CUSTOM_FILTERS_SUFFIX,
                );
                const next: StoredCustomFilters = { ...existing };
                delete next[String(filter.id)];
                await userStorageApi.storeFilters(id, next, BACKLOG_CUSTOM_FILTERS_SUFFIX);
                if (!aliveRef.current) {
                    return;
                }
                setActiveCustomFilter((prev) => (prev === filter.id ? null : prev));
                // Only the customFilters slice changes; leave categories/selection intact.
                setCustomFilters(storedToCustomFilters(next));
            } catch (err) {
                reportError(
                    "removeCustomFilter failed",
                    err,
                    t("BACKLOG.ERROR_REMOVE_CUSTOM_FILTER", "Could not remove the custom filter. Please try again."),
                );
            }
        },
        [setCustomFilters],
    );

    /**
     * Port of the "move to current / latest sprint" buttons. Moves the CHECKED
     * backlog stories to the resolved target milestone via `bulkUpdateMilestone`,
     * then reloads the backlog + sprints. NOTE: the legacy selection semantics
     * were not fully captured; this moves the CHECKED rows (no-op when none are
     * checked). "latest" resolves to the open sprint with the furthest
     * `estimated_finish`.
     */
    const moveSelectedToSprint = useCallback(
        async (target: "current" | "latest"): Promise<void> => {
            if (!isValidProjectId(resolvedId)) {
                return;
            }
            const s = stateRef.current;
            const checked = s.selection.checked;
            const ids: number[] = [];
            for (const us of s.userstories) {
                if (checked[String(us.ref)]) {
                    ids.push(us.id);
                }
            }
            if (ids.length === 0) {
                return;
            }
            let targetSprint: Sprint | null;
            if (target === "current") {
                targetSprint = s.currentSprint;
            } else {
                const openSorted = [...s.sprints].sort(
                    (a, b) =>
                        moment(a.estimated_finish, "YYYY-MM-DD").valueOf() -
                        moment(b.estimated_finish, "YYYY-MM-DD").valueOf(),
                );
                targetSprint = openSorted.length ? openSorted[openSorted.length - 1] : null;
            }
            if (!targetSprint) {
                return;
            }
            const bulkStories = ids.map((usId, index) => ({ us_id: usId, order: index }));
            try {
                await userstoriesApi.bulkUpdateMilestone(resolvedId, targetSprint.id, bulkStories);
                if (!aliveRef.current) {
                    return;
                }
                // [#4] The moved stories have left the backlog, so the checkbox
                // selection that drove this action is now stale. Clear it BEFORE
                // reloading so the "N selected" affordance (and its move-to-sprint
                // buttons) disappears immediately; previously the checked refs
                // lingered, leaving orphaned selection UI for rows that no longer
                // existed in the backlog list.
                clearSelection();
                await loadBacklog();
                if (!aliveRef.current) {
                    return;
                }
                if (closedVisibleRef.current) {
                    await loadClosedSprints();
                }
            } catch (err) {
                reportError(
                    "moveSelectedToSprint failed",
                    err,
                    t("BACKLOG.ERROR_MOVE_US", "Could not move the stories to the sprint. Please try again."),
                );
            }
        },
        [resolvedId, loadBacklog, loadClosedSprints, clearSelection],
    );

    /* ---------------------------------------------------------------------- */
    /* Phase D — forecasting (reactive)                                        */
    /* ---------------------------------------------------------------------- */

    /**
     * Recompute the velocity forecast whenever the inputs change. Kept reactive
     * (rather than folded into each loader) so it always sees the committed
     * state and never a stale async closure. `setForecasting` is stable and its
     * outputs are NOT in the deps, so this cannot loop. `calculateForecasting`
     * requires non-null stats, hence the guard.
     */
    useEffect(() => {
        const stats = state.stats;
        if (!stats) {
            return;
        }
        const { forecastedStories, forecastNewSprint } = calculateForecasting(
            state.userstories,
            state.sprints,
            stats,
        );
        setForecasting(forecastedStories, forecastNewSprint);
    }, [state.stats, state.userstories, state.sprints, setForecasting]);

    /* ---------------------------------------------------------------------- */
    /* Phase H — lifecycle effects                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Mount / project-change effect. It fires `loadInitialData` only when there
     * is SOMETHING to resolve — either a valid positive-integer prop id, OR a
     * slug in the URL (`/project/:pslug/...`) that `loadProject` can look up via
     * `GET projects/by_slug` (QA finding #1). When neither is present (a bare
     * transient render), NO network / WebSocket work runs, preserving the
     * transient-NaN contract. `loadInitialData` is stable per `projectId` (its
     * dependency chain bottoms out at `projectId` + module-stable setters +
     * refs), so this effect fires once per distinct prop id — never on every
     * state update, and NOT again merely because `loadProject` published the
     * resolved id into state. Cleanup disconnects the shared events client and
     * cancels the pending search debounce.
     */
    useEffect(() => {
        aliveRef.current = true;
        if (isValidProjectId(projectId) || slugFromLocation() !== null) {
            void loadInitialData();
        }
        return () => {
            aliveRef.current = false;
            if (searchTimerRef.current !== null) {
                clearTimeout(searchTimerRef.current);
                searchTimerRef.current = null;
            }
            eventsRef.current?.disconnect();
            eventsRef.current = null;
        };
    }, [projectId, loadInitialData]);

    /* ---------------------------------------------------------------------- */
    /* Phase I — render (port backlog.jade; EXACT class names)                 */
    /* ---------------------------------------------------------------------- */

    // --- Render guards. ALL hooks are declared above, so branching is safe. ---

    // Transient-NaN: the project id has not resolved yet. Either the prop id is
    // still unusable AND the URL slug lookup (loadProject → GET projects/by_slug)
    // has not returned, so no board data exists — render a neutral shell, never
    // crash. Once `resolvedId` becomes a valid positive integer the full board
    // renders below.
    if (!isValidProjectId(resolvedId)) {
        return <main className="main scrum" />;
    }

    // [ERR-2] offline overlay — a React `fetch` failed with no HTTP response
    // (network down). Mirrors the AngularJS offline interceptor which renders a
    // full-page error rather than leaving the user with a silently-stale board.
    if (connectionError) {
        return (
            <main className="main scrum">
                <div className="error-load-data">
                    <h1>{t("COMMON.CONNECTION_ERROR", "Connection lost")}</h1>
                    <p>
                        {t(
                            "COMMON.CONNECTION_ERROR_HELP",
                            "Unable to reach the server. Check your connection and reload the page.",
                        )}
                    </p>
                </div>
            </main>
        );
    }

    // Port of `permissionDenied` (backlog module disabled, or a 403 / 451
    // blocked/archived response).
    if (permissionDenied) {
        return (
            <main className="main scrum">
                <div className="permission-denied">
                    <h1>{t("ERROR.PERMISSION_DENIED", "Permission denied")}</h1>
                    <p>
                        {t(
                            "BACKLOG.PERMISSION_DENIED_HELP",
                            "You don't have permission to see the backlog.",
                        )}
                    </p>
                </div>
            </main>
        );
    }

    // Initial project load still pending — or it failed with a load error.
    if (project === null) {
        if (loadError) {
            return (
                <main className="main scrum">
                    <div className="error-load-data">{loadError}</div>
                </main>
            );
        }
        return <main className="main scrum" />;
    }

    // From here `project` is non-null (TypeScript narrows the const binding),
    // so children that require a Project can be rendered unconditionally.
    const canAddUs = project.my_permissions.includes("add_us");
    const canAddMilestone = project.my_permissions.includes("add_milestone");
    const hasSelectedFilters = state.selectedFilters.length > 0;
    const hasStories = state.userstories.length > 0;
    // [M] move-to-sprint reveal. The `.btn-filter.move-to-sprint` SCSS rule has a
    // hard `display:none` base with no class-based reveal in the compiled CSS. The
    // AngularJS backlog revealed it imperatively in `checkSelected`
    // (`moveToSprintDom.css('display','flex')`) when at least one user story was
    // checked AND there was at least one open sprint to move it into; otherwise it
    // called `.hide()`. We reproduce that exact condition and drive an inline
    // `display` style so the button becomes visible on selection.
    const selectedCount = Object.values(state.selection.checked).filter(Boolean).length;
    const moveToSprintVisible = selectedCount > 0 && state.sprints.length > 0;
    // Empty-state visibility ports the jade `ng-class`. In React `userstories`
    // is ALWAYS an array (never `undefined`), so the `=== undefined` disjunct
    // collapses out.
    const emptyBacklogHidden = hasStories || state.filterQ.length === 0;
    const emptyLargeHidden = hasStories || state.filterQ.length > 0;
    const speed = state.stats?.speed ?? 0;

    return (
        <main className="main scrum">
            {/* A single DndContext wraps BOTH the backlog list (drag sources) and
                the sprint sidebar (drop targets) so a story can be dragged from
                the backlog into a sprint. DndProvider renders a fragment (no DOM
                wrapper), so `main`'s children remain `section.backlog` +
                `sidebar.sidebar`, exactly as the Jade emitted. */}
            {/* [N] Backlog OPTS IN to row-level drop targeting:
                - `collisionDetection` prefers an individual story ROW (numeric
                  droppable id) over the enclosing container, so both pointer and
                  keyboard drops land at a precise row rather than the end.
                - `keyboardCoordinateGetter` gives single-step (down-one / up-one)
                  keyboard movement instead of jumping to the container end.
                Kanban (out of scope) shares DndProvider but leaves both undefined,
                keeping @dnd-kit's default behavior there. */}
            <DndProvider
                project={project}
                resolveDrop={resolveDrop}
                persist={persist}
                collisionDetection={rowPreferringCollisionDetection}
                keyboardCoordinateGetter={singleStepKeyboardCoordinates}
            >
                <section className="backlog">
                    {/* [F] Section title. Ported from mainTitle.jade + main-title.jade
                        (`header > h1 > span`), which the original backlog.jade rendered
                        as the FIRST child of `section.backlog` (React-owned region), not
                        outer chrome. Rendering it here restores the correct heading
                        order (h1 "Scrum" → h2 "Backlog" → h1 "SPRINTS"). */}
                    <header>
                        <h1>
                            <span>{t("BACKLOG.SECTION_NAME", "Scrum")}</span>
                        </h1>
                    </header>

                    <Burndown
                        stats={state.stats}
                        project={project}
                        showGraphPlaceholder={state.showGraphPlaceholder}
                        collapsed={burndownCollapsed}
                        onToggleCollapsed={toggleBurndownCollapsed}
                    />

                    <div className="backlog-table">
                        <div className="backlog-top">
                            <div className="backlog-menu">
                                <div className="backlog-header">
                                    <div className="backlog-header-title">
                                        <h2>{t("BACKLOG.TITLE", "Backlog")}</h2>
                                        {hasSelectedFilters ? (
                                            <>
                                                <span className="backlog-stories-number squared">
                                                    {state.userstories.length}
                                                </span>
                                                {/* [C] filtered story count. */}
                                                <span className="backlog-stories-number">
                                                    {t(
                                                        "BACKLOG.TOTAL_STORIES_FILTERED",
                                                        "of {{ totalUserStories }} user stories",
                                                        { totalUserStories: state.totalUserStories },
                                                    )}
                                                </span>
                                            </>
                                        ) : (
                                            /* [B] unfiltered story count. */
                                            <span className="backlog-stories-number">
                                                {t(
                                                    "BACKLOG.TOTAL_STORIES",
                                                    "{{ totalUserStories }} user stories",
                                                    { totalUserStories: state.totalUserStories },
                                                )}
                                            </span>
                                        )}
                                    </div>
                                    <div className="backlog-header-options">
                                        {/* addnewus.jade */}
                                        <div className="new-us">
                                            {canAddUs && (
                                                <>
                                                    <button
                                                        className="btn-small"
                                                        type="button"
                                                        onClick={() => addNewUs("standard")}
                                                    >
                                                        <Svg icon="icon-add" />
                                                        {/* [E] add-user-story label. */}
                                                        <span className="text">{t("US.ADD", "user story")}</span>
                                                    </button>
                                                    <button
                                                        className="btn-icon"
                                                        type="button"
                                                        aria-label={t("US.ADD_BULK", "Add some new user stories in bulk")}
                                                        title={t("US.ADD_BULK", "Add some new user stories in bulk")}
                                                        onClick={() => addNewUs("bulk")}
                                                    >
                                                        <Svg icon="icon-bulk" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="backlog-table-options">
                                    <div className="backlog-table-options-start">
                                        <button
                                            id="show-filters-button"
                                            type="button"
                                            className={`btn-filter e2e-open-filter${
                                                state.activeFilters ? " active" : ""
                                            }`}
                                            onClick={toggleActiveFilters}
                                        >
                                            <Svg icon="icon-filters" />
                                            <span className="text">
                                                {state.activeFilters
                                                    ? t("BACKLOG.FILTERS.HIDE_TITLE", "Hide filters")
                                                    : t("BACKLOG.FILTERS.TITLE", "Filters")}
                                            </span>
                                            {hasSelectedFilters && (
                                                <span className="selected-filters">
                                                    {state.selectedFilters.length}
                                                </span>
                                            )}
                                        </button>

                                        {/*
                                          * tg-input-search: a REAL custom element (styled by tag
                                          * name in input-search.component.scss — a position:relative
                                          * host with an absolutely-positioned `tg-svg` magnifier —
                                          * and sized to 185px by `.backlog-table-options-start
                                          * tg-input-search` in backlog.scss L127). The previous markup
                                          * put `tg-input-search` as a CLASS on the bare <input>, which
                                          * the tag-selector SCSS never matched, so the search box was
                                          * unstyled and the magnifier icon was missing (QA MINOR #6).
                                          * Rendered via createElement — matching the sibling Svg/Icon
                                          * precedent — so we don't augment JSX.IntrinsicElements. The
                                          * placeholder now uses the shared catalog key
                                          * COMMON.FILTERS.INPUT_PLACEHOLDER ("subject or reference"),
                                          * identical to the Kanban search, restoring parity with the
                                          * AngularJS `tg-input-search` component. */}
                                        {createElement(
                                            "tg-input-search",
                                            null,
                                            <input
                                                key="search-input"
                                                id="backlog-search-input"
                                                name="backlog-search"
                                                className="backlog-search e2e-search"
                                                type="search"
                                                value={state.filterQ}
                                                placeholder={t(
                                                    "COMMON.FILTERS.INPUT_PLACEHOLDER",
                                                    "subject or reference",
                                                )}
                                                aria-label={t(
                                                    "COMMON.FILTERS.INPUT_PLACEHOLDER",
                                                    "subject or reference",
                                                )}
                                                onChange={(e) => changeQ(e.target.value)}
                                            />,
                                            <Svg key="search-icon" icon="icon-search" />,
                                        )}

                                        {hasStories && (
                                            <div id="show-tags" className="display-tags-button">
                                                <div
                                                    className={`check js-check${
                                                        state.showTags ? " active" : ""
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        id="show-tags-input"
                                                        checked={state.showTags}
                                                        onChange={toggleShowTags}
                                                    />
                                                    <div />
                                                </div>
                                                <label htmlFor="show-tags-input">
                                                    {t("BACKLOG.TAGS.SHOW", "tags")}
                                                </label>
                                            </div>
                                        )}
                                    </div>

                                    <div className="backlog-table-options-end">
                                        {state.currentSprint ? (
                                            <button
                                                id="move-to-current-sprint"
                                                type="button"
                                                className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                                                title={t("BACKLOG.MOVE_US_TO_CURRENT_SPRINT", "Move to Current Sprint")}
                                                // [M] inline reveal — see moveToSprintVisible above.
                                                style={{ display: moveToSprintVisible ? "flex" : "none" }}
                                                onClick={() => {
                                                    void moveSelectedToSprint("current");
                                                }}
                                            >
                                                <span className="text">
                                                    {t("BACKLOG.MOVE_US_TO_CURRENT_SPRINT", "Move to Current Sprint")}
                                                </span>
                                                <Svg icon="icon-add-to-sprint" />
                                            </button>
                                        ) : (
                                            <button
                                                id="move-to-latest-sprint"
                                                type="button"
                                                className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                                                title={t("BACKLOG.MOVE_US_TO_LATEST_SPRINT", "Move to latest Sprint")}
                                                // [M] inline reveal — see moveToSprintVisible above.
                                                style={{ display: moveToSprintVisible ? "flex" : "none" }}
                                                onClick={() => {
                                                    void moveSelectedToSprint("latest");
                                                }}
                                            >
                                                <span className="text">
                                                    {t("BACKLOG.MOVE_US_TO_LATEST_SPRINT", "Move to latest Sprint")}
                                                </span>
                                                <Svg icon="icon-add-to-sprint" />
                                            </button>
                                        )}

                                        {/* Both forecasting buttons are gated on `add_milestone`
                                            (jade `tg-check-permission="add_milestone"`). */}
                                        {hasStories && state.displayVelocity && canAddMilestone && (
                                            <button
                                                type="button"
                                                className="btn-filter active velocity-forecasting-btn e2e-velocity-forecasting"
                                                title={t("BACKLOG.FORECASTING.TITLE", "Velocity forecasting")}
                                                onClick={toggleVelocityForecasting}
                                            >
                                                <Svg icon="icon-fold-column" />
                                                <span className="text">
                                                    {t("BACKLOG.FORECASTING.BACKLOG", "return to backlog")}
                                                </span>
                                            </button>
                                        )}
                                        {hasStories &&
                                            !state.displayVelocity &&
                                            speed > 0 &&
                                            canAddMilestone && (
                                                <button
                                                    type="button"
                                                    className="btn-filter velocity-forecasting-btn e2e-velocity-forecasting"
                                                    title={t("BACKLOG.FORECASTING.BACKLOG", "return to backlog")}
                                                    onClick={toggleVelocityForecasting}
                                                >
                                                    {t("BACKLOG.FORECASTING.TITLE", "Velocity forecasting")}
                                                </button>
                                            )}
                                    </div>
                                </div>
                            </div>

                            <div
                                className={`backlog-manager${
                                    !state.activeFilters ? " expanded" : ""
                                }`}
                            >
                                {state.activeFilters && (
                                    <BacklogFilterPanel
                                        filters={state.filters}
                                        selectedFilters={state.selectedFilters}
                                        customFilters={state.customFilters}
                                        activeCustomFilter={activeCustomFilter}
                                        filterMode={filterMode}
                                        onSetFilterMode={setFilterMode}
                                        onAddFilter={addFilterBacklog}
                                        onRemoveFilter={removeFilterBacklog}
                                        onSaveCustomFilter={saveCustomFilter}
                                        onSelectCustomFilter={selectCustomFilter}
                                        onRemoveCustomFilter={removeCustomFilter}
                                    />
                                )}

                                <section
                                    className={`backlog-table${!hasStories ? " hidden" : ""}`}
                                >
                                    <BacklogTable
                                        project={project}
                                        userstories={state.userstories}
                                        visibleRefs={state.visibleUserStories}
                                        showTags={state.showTags}
                                        activeFilters={state.activeFilters}
                                        displayVelocity={state.displayVelocity}
                                        stats={state.stats}
                                        firstUsInBacklog={state.first_us_in_backlog}
                                        loadingUserstories={state.loadingUserstories}
                                        dragEnabled={dragEnabled}
                                        selectedRefs={state.selection.checked}
                                        canLoadMore={canLoadMore}
                                        onLoadMore={() => {
                                            void loadUserstories({ reset: false });
                                        }}
                                        onToggleSelection={setSelection}
                                        actions={actions}
                                    />

                                    {state.displayVelocity && (
                                        <div className="forecasting-add-sprint e2e-velocity-forecasting-add">
                                            <span className="forecasting-text">
                                                {state.forecastNewSprint
                                                    ? t(
                                                          "BACKLOG.FORECASTING.NEW_SPRINT",
                                                          "Candidate user stories for your next sprint based on your velocity.",
                                                      )
                                                    : t(
                                                          "BACKLOG.FORECASTING.CURRENT_SPRINT",
                                                          "Candidate user stories for your sprint based on your velocity. Click to add to current sprint.",
                                                      )}
                                            </span>
                                            <div className="button btn-link">
                                                <Svg icon="icon-add" />
                                                <button
                                                    className="text"
                                                    type="button"
                                                    onClick={() => addNewSprint()}
                                                >
                                                    {t("BACKLOG.FORECASTING.ADD_NEW_SPRINT", "create sprint and add US")}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </section>

                                <div
                                    className={`empty-backlog js-empty-backlog${
                                        emptyBacklogHidden ? " hidden" : ""
                                    }`}
                                >
                                    <p className="no-match">
                                        {t(
                                            "BACKLOG.NO_MATCH",
                                            "No matching search result found with \u201C{{ q }}\u201D",
                                            { q: state.filterQ },
                                        )}
                                    </p>
                                    <p className="no-match-help">
                                        {t(
                                            "BACKLOG.NO_MATCH_HELP",
                                            "Try again using more general search terms",
                                        )}
                                    </p>
                                </div>

                                <div
                                    className={`empty-large js-empty-backlog${
                                        emptyLargeHidden ? " hidden" : ""
                                    }`}
                                >
                                    <p className="title">
                                        {t("BACKLOG.EMPTY", "The backlog is empty!")}
                                    </p>
                                    {canAddUs && (
                                        <button
                                            className="btn-small"
                                            type="button"
                                            onClick={() => addNewUs("standard")}
                                        >
                                            <Svg icon="icon-add" />
                                            <span className="text">
                                                {t(
                                                    "BACKLOG.CREATE_NEW_US_EMPTY_HELP",
                                                    "Add a user story",
                                                )}
                                            </span>
                                        </button>
                                    )}
                                    <img
                                        src={`${baseHref}images/empty/empty_mex.png`}
                                        alt={t("BACKLOG.EMPTY", "The backlog is empty!")}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* The sprint sidebar is a child of `main`, a SIBLING of
                    `section.backlog`. The legacy Jade emitted a non-standard
                    `<sidebar class="sidebar">`; here it is a semantic
                    `<aside className="sidebar">` (a valid HTML landmark that
                    React recognizes, so no "unrecognized tag" warning), while
                    keeping the `sidebar` CLASS so the compiled `.sidebar` SCSS
                    (lightbox.scss, backlog layout) themes it unchanged. */}
                <aside className="sidebar">
                    <SprintList
                        project={project}
                        openSprints={state.sprints}
                        closedSprints={state.closedSprints}
                        totalMilestones={state.totalMilestones}
                        totalClosedMilestones={state.totalClosedMilestones}
                        closedSprintsVisible={closedSprintsVisible}
                        dragEnabled={dragEnabled}
                        onAddNewSprint={addNewSprint}
                        onEditSprint={onEditSprint}
                        onToggleClosedSprints={handleToggleClosedSprints}
                    />
                </aside>
            </DndProvider>

            {/* [ERR-1] non-blocking user notifications (failed inline change /
                move / delete / drop / filter mutations). Renders nothing until a
                notification is emitted onto the shared bus. */}
            <NotificationHost />

            {/* React lightboxes — all three are React-owned (QA finding #2):
                bulk create, single-US create/edit, and sprint add/edit. */}
            <BulkUserStoriesLightbox
                open={bulkLightbox.open}
                project={project}
                defaultStatusId={project.default_us_status}
                onCreated={onBulkCreated}
                onClose={() => setBulkLightbox({ open: false })}
            />
            <UserStoryEditLightbox
                open={usLightbox.open}
                mode={usLightbox.mode}
                project={project}
                us={usLightbox.us}
                assignableUsers={assignableUsers}
                onCreate={onCreateUserStory}
                onEdit={onSaveUserStoryEdit}
                fetchAttachments={fetchUsAttachments}
                onClose={() => setUsLightbox((s) => ({ ...s, open: false }))}
            />
            <SprintEditLightbox
                open={sprintLightbox.open}
                mode={sprintLightbox.mode}
                project={project}
                sprint={sprintLightbox.sprint}
                initialValues={sprintLightbox.initialValues}
                lastSprintName={sprintLightbox.lastSprintName}
                canDelete={sprintLightbox.canDelete}
                onChanged={onSprintChanged}
                onClose={() => setSprintLightbox((s) => ({ ...s, open: false }))}
            />
            {/* [H] Themed delete-confirmation dialog, replacing the native
                window.confirm. Ports `$confirm.askOnDelete(...)`:
                title US.TITLE_DELETE_ACTION, message US.TITLE_DELETE_MESSAGE. */}
            <ConfirmDialog
                open={deleteConfirm.open}
                variant="delete"
                busy={deleteConfirm.busy}
                title={t("US.TITLE_DELETE_ACTION", "Delete user story")}
                message={
                    deleteConfirm.us
                        ? renderDeleteMessage(deleteConfirm.us.subject)
                        : null
                }
                confirmLabel={t("COMMON.DELETE", "Delete")}
                cancelLabel={t("COMMON.CANCEL", "Cancel")}
                onConfirm={() => {
                    void handleConfirmDelete();
                }}
                onCancel={handleCancelDelete}
            />
        </main>
    );
}
