/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import sortBy from "lodash/sortBy";
import debounce from "lodash/debounce";
import * as userStorageApi from "../shared/api/userStorage";
import type { StoredCustomFilters } from "../shared/api/userStorage";
import {
    httpDelete,
    httpGet,
    httpPatch,
    HttpError,
    isVersionConflict,
} from "../shared/api/httpClient";
import type { QueryParams, HttpResponse } from "../shared/api/httpClient";
import {
    bulkCreate,
    bulkUpdateKanbanOrder,
    createUserstory,
    filtersData,
    getUserstory,
    listUserstories,
} from "../shared/api/userstories";
import { createEventsClient } from "../shared/events/websocket";
import {
    uploadUserstoryAttachment,
    deleteUserstoryAttachment,
    listUserstoryAttachments,
} from "../shared/api/attachments";
import type { UserStoryAttachment } from "../shared/api/attachments";
import type {
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "../shared/dnd/DndProvider";
import { KanbanBoard } from "./KanbanBoard";
import { Icon } from "../shared/ui/Icon";
import { resolveUserAvatar } from "../shared/ui/avatar";
import { ConfirmDialog } from "../shared/dialog/ConfirmDialog";
import { useDialogA11y } from "../shared/dialog/useDialogA11y";
import { t } from "../shared/i18n/translate";
import { setAll as setAppMeta } from "../shared/meta/appMeta";
import { buildContainerKey } from "./KanbanColumn";
import { UserStoryEditLightbox } from "./UserStoryEditLightbox";
import { SelectUserLightbox } from "./SelectUserLightbox";
import type { SelectUserRole } from "./SelectUserLightbox";
import type {
    AssignableUser,
    UserStoryCreateFields,
    UserStoryEditChanges,
} from "./UserStoryEditLightbox";
import {
    loadColumnFolds,
    loadKanbanFilters,
    loadSwimlaneFolds,
    saveColumnFolds,
    saveKanbanFilters,
    saveSwimlaneFolds,
} from "./persistence";
import { useKanbanState, UNCLASSIFIED_SWIMLANE_ID } from "./useKanbanState";
import type {
    BaseUser,
    KanbanProject,
    KanbanState,
    Status,
    Swimlane,
    UserStoryModel,
    UsersById,
} from "./useKanbanState";

/**
 * Props supplied by the `<tg-react-kanban>` custom-element host.
 *
 * Declared locally (NOT imported from `../host/**`) to keep the Kanban module
 * decoupled from the host. Structurally identical to the host's
 * `HostElementProps`. `projectId` may be a transient `NaN` before AngularJS
 * interpolates `{{project.id}}` into the element's dataset, so every network
 * and WebSocket interaction is deferred until `Number.isFinite(projectId)`.
 */
export interface HostElementProps {
    projectId: number;
    projectSlug: string;
}

/**
 * Guard the host-supplied project id. The migrated `kanban.jade` binds
 * `data-project-id="{{project.id}}"`, but the Kanban route lost its controller
 * scope so the interpolation resolves to the empty string (→ `NaN`) or, in a
 * degenerate parse, `0`. BOTH must be rejected — treating `0` as an id would
 * issue `GET /projects/0` → 404 (mirrors the Backlog fix for QA finding #1).
 * Only a finite positive integer unlocks any network / WebSocket work.
 */
export function isValidProjectId(id: number): boolean {
    return Number.isInteger(id) && id > 0;
}

/**
 * Resolve the project slug from the current URL. The Kanban route is
 * `/project/:pslug/kanban` (app.coffee), so the slug is ALWAYS present in the
 * path even though `data-project-slug` (like `data-project-id`) fails to
 * interpolate in the migrated shell. This is the RELIABLE fallback source used
 * to look the project up via `GET /projects/by_slug` when the host attribute
 * did not yield a usable id (QA finding #1 — CRITICAL). Returns `null` when no
 * slug segment is present (e.g. jsdom's default `/` path), which keeps the
 * transient-NaN "no network until resolvable" contract intact.
 */
export function slugFromLocation(): string | null {
    try {
        const match = /\/project\/([^/]+)/.exec(window.location.pathname);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Zoom model — ported from kanban-board-zoom.directive.coffee. Each zoom level
// cumulatively concatenates the visibility keys of all levels up to it.
// ---------------------------------------------------------------------------

const ZOOM_LEVELS: ReadonlyArray<ReadonlyArray<string>> = [
    ["assigned_to", "ref"],
    ["subject", "card-data", "assigned_to_extended"],
    ["tags", "extra_info", "unfold"],
    ["related_tasks", "attachments"],
];

const MAX_ZOOM_LEVEL = 3;
const DEFAULT_ZOOM_LEVEL = 1;
const MOVED_HIGHLIGHT_MS = 1000;
const SEARCH_DEBOUNCE_MS = 200;
// M-11: coalesce WebSocket event bursts so a rapid stream of `.userstories` /
// `.projects` notifications does not trigger overlapping full-board refetches.
// The AngularJS baseline wrapped BOTH subscription handlers in
// `taiga.debounceLeading(randomInt(700, 1000), fn)` (kanban/main.coffee L246-255),
// where `debounceLeading` is `_.debounce(fn, wait, {leading:false, trailing:true})`
// (utils.coffee L121) — i.e. PURE TRAILING. We reproduce that exactly with a fixed
// wait at the upper bound of the legacy random range (the randomness was only an
// anti-thundering-herd jitter across clients, not user-visible behavior). A rapid
// stream of events therefore collapses into EXACTLY ONE trailing full-board refresh
// once the burst settles — never a per-event refetch (Issue 2: a 20-event burst must
// not fan out into ~40 fetches). Latest-request protection is provided by the reload
// generation guard.
const EVENTS_DEBOUNCE_MS = 1000;

// Non-visible input identifiers for the search affordance. All USER-VISIBLE
// board-header copy (KANBAN.SECTION_NAME section title; ZOOM.TITLE + ZOOM.ZOOM-1..4
// zoom labels ported from `board-zoom.jade`; COMMON.FILTERS.INPUT_PLACEHOLDER
// search placeholder + its aria-label) is localized [M-06] through the shared
// runtime translator at RENDER time — defined as locals inside `KanbanApp`
// (see below) rather than at module load, because the React bundle is evaluated
// by `loadJS(react-app.js)` BEFORE `angular.bootstrap`, so the live `$translate`
// service is only reachable once a component actually renders inside the mounted
// custom element. Freezing them at module load would pin the English fallback
// for every locale, defeating the localization this finding restores.
const SEARCH_INPUT_ID = "kanban-search-input";
const SEARCH_INPUT_NAME = "kanban-search";

// Error-notification copy — ported from the AngularJS `$tgConfirm.notify("error")`
// path (common/confirm.coffee: NOTIFICATION.WARNING / NOTIFICATION.WARNING_TEXT,
// and NOTIFICATION.CLOSE for the dismiss control), surfaced through an in-board,
// className-driven banner. Localized [M-06] at render time via locals in the
// consuming components (`KanbanNotification`, `BulkLightbox`, `KanbanApp`).
//
// Permission-denied copy (QA-FUNC-10, ERROR.PERMISSION_DENIED /
// ERROR.PERMISSION_DENIED_TEXT) and the bulk-create lightbox copy (QA-FUNC-04,
// COMMON.NEW_BULK, LIGHTBOX.CREATE_EDIT.*, KANBAN.UNCLASSIFIED_USER_STORIES,
// COMMON.ONE_ITEM_LINE, COMMON.SAVE, ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT) are
// likewise localized at render time via locals in `KanbanApp` / `BulkLightbox`.

// Bulk-textarea validation (QA-FUNC-07) — the AngularJS lightbox wired two
// `checksley` validators on the textarea: `data-required="true"` and
// `data-linewidth="200"`. The latter is the custom validator registered in
// app.coffee (L907): every line must be strictly shorter than the width, i.e.
// `line.length < 200`. The messages are the exact COMMON.FORM_ERRORS strings,
// resolved through the translator inside `validateBulkText` (render/runtime).
const BULK_LINE_WIDTH = 200;

/**
 * Client-side reproduction of the two `checksley` validators bound to the bulk
 * textarea (QA-FUNC-07). Returns the error message to display, or `null` when
 * the input is valid.
 *  - required  : the value must contain at least one non-whitespace character.
 *  - linewidth : every line must be strictly shorter than `BULK_LINE_WIDTH`
 *                (mirrors the `_.every lines, (line) -> line.length < width`
 *                validator in app.coffee L907).
 */
export function validateBulkText(text: string): string | null {
    if (!text.trim()) {
        return t("COMMON.FORM_ERRORS.REQUIRED", "This value is required.");
    }
    const lines = text.split(/\r\n|\r|\n/);
    const anyTooLong = lines.some((line) => line.length >= BULK_LINE_WIDTH);
    if (anyTooLong) {
        // COMMON.FORM_ERRORS.LINEWIDTH uses a checksley-style `%s` placeholder
        // (not angular-translate's `{{ }}`), so the width is substituted here
        // after translation — for both the live catalog value and the fallback.
        return t(
            "COMMON.FORM_ERRORS.LINEWIDTH",
            "One or more lines is perhaps too long. Try to keep under %s characters.",
        ).replace("%s", String(BULK_LINE_WIDTH));
    }
    return null;
}

export function zoomKeysFor(level: number): string[] {
    let clamped = Number(level);
    if (!Number.isFinite(clamped)) {
        clamped = 0;
    }
    if (clamped > MAX_ZOOM_LEVEL) {
        clamped = MAX_ZOOM_LEVEL;
    }
    if (clamped < 0) {
        clamped = 0;
    }
    let keys: string[] = [];
    for (let i = 0; i <= clamped; i++) {
        keys = keys.concat(ZOOM_LEVELS[i] as string[]);
    }
    return keys;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * First user-story id currently in the (status, swimlane) column, or `null`
 * when the column is empty. Used by the bulk "on top" placement (QA-FUNC-04) to
 * find the story the newly-created stories must be ordered BEFORE — captured
 * BEFORE the create request because the new stories are not yet in state
 * (mirrors AngularJS `moveUsToTop`, kanban/main.coffee L160-L182: `nextUsId =
 * userstories.get(0)`). In swimlane mode the bucket is
 * `usByStatusSwimlanes[swimlane][status]` (a `null` swimlane maps to the
 * unclassified `-1` bucket); otherwise it is `usByStatus[status]`.
 */
export function firstUsInColumn(
    state: KanbanState,
    statusId: number,
    swimlaneId: number | null,
): number | null {
    let ids: number[] | undefined;
    if (state.swimlanesList.length > 0) {
        const bucketSwimlane =
            swimlaneId === null ? UNCLASSIFIED_SWIMLANE_ID : swimlaneId;
        ids = state.usByStatusSwimlanes[bucketSwimlane]?.[statusId];
    } else {
        ids = state.usByStatus[String(statusId)];
    }
    return ids && ids.length ? ids[0] : null;
}

/**
 * Whether the board currently has any UNCLASSIFIED user stories (the `-1`
 * swimlane bucket). Mirrors the AngularJS `noSwimlaneUserStories` flag that
 * gates the bulk lightbox's "Unclassified" swimlane option
 * (`tg-swimlane-selector` has-unclassified-stories, swimlane-selector.jade L26).
 */
export function hasUnclassifiedStories(state: KanbanState): boolean {
    const bucket = state.usByStatusSwimlanes[UNCLASSIFIED_SWIMLANE_ID];
    if (!bucket) {
        return false;
    }
    return Object.values(bucket).some((ids) => ids.length > 0);
}

/** Parse a `${statusId}::${swimlaneId}` container key. Swimlane id is RAW. */
export function parseContainerKey(key: string): {
    statusId: number;
    swimlaneId: number;
} {
    const separator = key.indexOf("::");
    if (separator === -1) {
        return { statusId: Number(key), swimlaneId: UNCLASSIFIED_SWIMLANE_ID };
    }
    return {
        statusId: Number(key.slice(0, separator)),
        swimlaneId: Number(key.slice(separator + 2)),
    };
}

interface ContainerLocation {
    key: string;
    index: number;
}

interface ContainerIndex {
    containerOf: Record<number, ContainerLocation>;
    listOf: Record<string, number[]>;
}

/**
 * Build a lookup of every card's container + index and the ordered id list of
 * every container, so that a drag `over` target (card id OR container key) can
 * be resolved into an ordered target list.
 */
function buildContainerIndex(state: KanbanState): ContainerIndex {
    const containerOf: Record<number, ContainerLocation> = {};
    const listOf: Record<string, number[]> = {};

    if (state.swimlanesList.length > 0) {
        for (const swimlane of state.swimlanesList) {
            const statuses = state.swimlanesStatuses[swimlane.id] ?? [];
            for (const status of statuses) {
                const inner = state.usByStatusSwimlanes[swimlane.id];
                const ids = (inner && inner[status.id]) ?? [];
                const key = buildContainerKey(status.id, swimlane.id);
                listOf[key] = ids.slice();
                ids.forEach((id, index) => {
                    containerOf[id] = { key, index };
                });
            }
        }
    } else {
        for (const statusIdStr of Object.keys(state.usByStatus)) {
            const ids = state.usByStatus[statusIdStr] ?? [];
            const key = buildContainerKey(Number(statusIdStr), null);
            listOf[key] = ids.slice();
            ids.forEach((id, index) => {
                containerOf[id] = { key, index };
            });
        }
    }

    return { containerOf, listOf };
}

/**
 * Resolve a normalized drag-end into a `ResolvedDrop`. The consumer computes
 * the target container's final ordered id list + the dragged card's index;
 * `DndProvider.computeNeighbors` then derives the before/after neighbors.
 *
 * MULTI-SELECT GROUP DRAG (QA-FUNC-01): the optional `selectedIds` argument
 * carries the ids of the currently multi-selected cards (AngularJS
 * `ctrl.selectedUss`). When the dragged card is part of an active selection of
 * more than one card, the WHOLE selection is moved together as one contiguous
 * block to the drop location and every moved id is reported in `draggedIds`
 * (so the bulk-order endpoint receives `bulk_userstories` with >1 id), exactly
 * as the legacy `dragMultipleItems` path did (kanban/sortable.coffee). When
 * there is no active multi-selection — or the dragged card is not part of it —
 * only the single dragged card moves and the single-item behavior is preserved
 * bit-for-bit.
 */
export function resolveKanbanDrop(
    state: KanbanState,
    event: NormalizedDragEnd,
    selectedIds?: number[],
): ResolvedDrop | null {
    const { activeId, overId } = event;
    if (overId === null || overId === undefined) {
        return null;
    }

    const { containerOf, listOf } = buildContainerIndex(state);
    const origin = containerOf[activeId];
    if (!origin) {
        return null;
    }

    // --- Resolve the moved group -----------------------------------------
    // Default: the single dragged card. When a multi-selection (>1 card) is
    // active AND the dragged card belongs to it, the moved group becomes every
    // selected card that still exists on the board, ordered by board reading
    // order (container-construction order, then index within the container) so
    // the relative sequence of the selected cards is stable across the move.
    let group: number[] = [activeId];
    if (
        Array.isArray(selectedIds) &&
        selectedIds.length > 1 &&
        selectedIds.indexOf(activeId) !== -1
    ) {
        const onBoard = selectedIds.filter((id) => containerOf[id] !== undefined);
        if (onBoard.length > 1) {
            const rank = new Map<number, number>();
            let r = 0;
            for (const key of Object.keys(listOf)) {
                for (const id of listOf[key]) {
                    rank.set(id, r);
                    r += 1;
                }
            }
            group = Array.from(new Set(onBoard)).sort(
                (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
            );
        }
    }
    const groupSet = new Set(group);

    let targetKey: string;
    let targetIndexRaw: number;
    if (typeof overId === "number") {
        const overLocation = containerOf[overId];
        if (!overLocation) {
            return null;
        }
        targetKey = overLocation.key;
        targetIndexRaw = overLocation.index;
    } else {
        targetKey = overId;
        targetIndexRaw = (listOf[targetKey] ?? []).length;
    }

    const targetListRaw = (listOf[targetKey] ?? []).slice();

    // Number of group members sitting BEFORE the raw target index inside the
    // target container. Removing them shifts the insertion point left by that
    // many slots (for a single-item drag this reduces to the original
    // `existing < targetIndexRaw` decrement).
    let removedBefore = 0;
    for (let i = 0; i < targetListRaw.length && i < targetIndexRaw; i += 1) {
        if (groupSet.has(targetListRaw[i])) {
            removedBefore += 1;
        }
    }

    // Strip every group member out of the target container list.
    const targetList = targetListRaw.filter((id) => !groupSet.has(id));

    let insertAt = targetIndexRaw - removedBefore;
    if (insertAt < 0) {
        insertAt = 0;
    }
    if (insertAt > targetList.length) {
        insertAt = targetList.length;
    }
    // Insert the whole group (in reading order) contiguously at the drop point.
    targetList.splice(insertAt, 0, ...group);

    return {
        origin: { containerKey: origin.key, index: origin.index },
        target: { containerKey: targetKey, index: insertAt },
        orderedIds: targetList,
        draggedIds: group,
    };
}

function buildUserstoriesParams(
    level: number,
    query: string,
    selected: KanbanSelectedFilter[] = [],
): QueryParams {
    const params: QueryParams = { status__is_archived: false };
    if (level >= 2) {
        params.include_attachments = 1;
        params.include_tasks = 1;
    }
    if (query) {
        params.q = query;
    }
    // Merge the sidebar filter selection (tags / assigned_users / role / owner /
    // epic — status is intentionally excluded) into the list request.
    Object.assign(params, pickSelectedFilterParams(selected));
    return params;
}

// F-KANBAN-ARCHIVED-NO-LOAD: parameters for the per-status fetch of an ARCHIVED
// column's stories, performed lazily when the user unfolds that column. This
// mirrors the legacy AngularJS `loadUserStoriesForStatus({status, ...})` call
// (kanban/main.coffee), which fetched a single archived status's stories on the
// `kanban:show-userstories-for-status` broadcast.
//
// The decisive difference from `buildUserstoriesParams` is the DELIBERATE
// OMISSION of `status__is_archived: false`: the base board request keeps that
// filter (so archived stories stay out of the normal columns), while this
// request scopes to one specific `status` id and therefore returns that status's
// stories regardless of their archived flag. The same zoom-driven include flags,
// search query, and sidebar filter selection are applied so the archived column
// honours the active search/filters exactly like the live columns.
function buildArchivedStatusParams(
    level: number,
    query: string,
    selected: KanbanSelectedFilter[],
    statusId: number,
): QueryParams {
    const params: QueryParams = { status: statusId };
    if (level >= 2) {
        params.include_attachments = 1;
        params.include_tasks = 1;
    }
    if (query) {
        params.q = query;
    }
    Object.assign(params, pickSelectedFilterParams(selected));
    return params;
}

function buildUsersById(project: KanbanProject): UsersById {
    const result: UsersById = {};
    const members = Array.isArray(project.members) ? project.members : [];
    for (const raw of members) {
        const member = raw as BaseUser;
        if (member && typeof member.id === "number") {
            result[member.id] = member;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Filter model — the in-board reimplementation of the shared `tg-filter`
// directive. The Kanban board whitelists FIVE categories (tags, assigned
// users, role, owner/created-by, epic) — it deliberately OMITS "status"
// because the columns ARE the statuses (the AngularJS controller set
// `excludeFilters: ["status"]`, and `validQueryParams` carried no `status`).
// Types are declared LOCALLY so the Kanban module stays self-contained (no
// value/type coupling to the Backlog module).
// ---------------------------------------------------------------------------

/** A single selectable value within a {@link KanbanFilterCategory}. */
interface KanbanFilterOption {
    id: string;
    name: string;
    color?: string;
    count?: number;
    /**
     * Avatar fields, preserved from `filters_data` for the `assigned_users` /
     * `owner` categories so the option row can render its member avatar
     * (`filter.jade`'s `img.user-pic[tg-avatar]`, KAN-04). Absent for every
     * non-user category.
     */
    gravatar_id?: string | null;
    photo?: string | null;
}

/** A group of filter options (e.g. "Tags", "Assigned to"). */
interface KanbanFilterCategory {
    title: string;
    dataType: string;
    content: KanbanFilterOption[];
}

/** A filter value the user has currently applied. */
interface KanbanSelectedFilter {
    id: string;
    name: string;
    dataType: string;
    /**
     * Include/exclude mode of this selection (KAN-04). `"exclude"` routes the id
     * to the `exclude_<dataType>` query param; anything else (or absent) means
     * an ordinary include. Mirrors the shared `tg-filter` `mode` field.
     */
    mode?: string;
    color?: string;
}

/**
 * A saved ("custom") filter for the Kanban board (KAN-04). The saved-filter NAME
 * doubles as its id — mirroring the AngularJS custom-filter store
 * (`{id: key, name: key, filter: value}`, controllerMixins.coffee L362-L364) and
 * the Backlog module's `CustomFilter`. Declared LOCALLY so the Kanban module
 * stays self-contained (no value/type coupling to the Backlog module).
 */
interface KanbanCustomFilter {
    id: string;
    name: string;
    /** The stored query-param map (filter key incl. `exclude_` prefix → ids). */
    filter?: Record<string, string>;
}

type KanbanFilters = KanbanFilterCategory[];

/**
 * `storeCustomFiltersName` for the Kanban board (kanban/main.coffee L57), used as
 * the `/user-storage` key suffix so the React screen reads/writes the SAME saved
 * filters the AngularJS client used. Byte-identical to the AngularJS value.
 */
const KANBAN_CUSTOM_FILTERS_SUFFIX = "kanban-custom-filters";

/** Angular `filterModeOptions` (filter.controller.coffee L20). */
const KANBAN_FILTER_MODE_OPTIONS = ["include", "exclude"] as const;

/**
 * URL query keys the Kanban controller whitelisted (`validQueryParams`,
 * kanban/main.coffee L59-L70). NOTE the deliberate ABSENCE of
 * `status` / `exclude_status`: the board's columns ARE the statuses, so status
 * is never offered as a sidebar filter (the controller's `excludeFilters`
 * carried `"status"`).
 */
const KANBAN_VALID_QUERY_PARAMS: ReadonlySet<string> = new Set<string>([
    "tags",
    "exclude_tags",
    "assigned_users",
    "exclude_assigned_users",
    "role",
    "exclude_role",
    "owner",
    "exclude_owner",
    "epic",
    "exclude_epic",
]);

type RawFilterItem = Record<string, unknown>;

/** Coerce an unknown `filters_data` field into an array of raw filter items. */
function asRawItems(value: unknown): RawFilterItem[] {
    return Array.isArray(value) ? (value as RawFilterItem[]) : [];
}

/** Read an optional numeric field (e.g. `count`). */
function readNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

/** Read a string field or a fallback. */
function readStringField(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/**
 * Build the FIVE Kanban filter categories from a `filters_data` payload,
 * reproducing the id/name transforms of `generateFilters`
 * (controllerMixins.coffee) MINUS the status category (see
 * {@link KANBAN_VALID_QUERY_PARAMS}). i18n categories: TAGS, ASSIGNED_TO, ROLE,
 * CREATED_BY, EPIC — in that exact order.
 */
export function buildKanbanFilterCategories(
    data: Record<string, unknown>,
): KanbanFilters {
    const categories: KanbanFilterCategory[] = [];

    // Tags — `it.id = it.name`.
    categories.push({
        title: "Tags",
        dataType: "tags",
        content: asRawItems(data.tags).map((it) => ({
            id: readStringField(it.name),
            name: readStringField(it.name),
            color: typeof it.color === "string" ? it.color : undefined,
            count: readNumber(it.count),
        })),
    });

    // Assigned to — `it.id ? id.toString() : "null"`, name = full_name || "Unassigned".
    categories.push({
        title: "Assigned to",
        dataType: "assigned_users",
        content: asRawItems(data.assigned_users).map((it) => ({
            id: it.id != null ? String(it.id) : "null",
            name: readStringField(it.full_name) || "Unassigned",
            count: readNumber(it.count),
            // KAN-04: carry the avatar identity so the option row can render
            // its member picture (a null gravatar → the "unnamed" placeholder,
            // matching the AngularJS "Unassigned" row).
            gravatar_id: typeof it.gravatar_id === "string" ? it.gravatar_id : null,
            photo: typeof it.photo === "string" ? it.photo : null,
        })),
    });

    // Role — `it.id ? id.toString() : "null"`, name = name || "Unassigned".
    categories.push({
        title: "Role",
        dataType: "role",
        content: asRawItems(data.roles).map((it) => ({
            id: it.id != null ? String(it.id) : "null",
            name: readStringField(it.name) || "Unassigned",
            count: readNumber(it.count),
        })),
    });

    // Created by (owner) — `it.id = id.toString()`, name = full_name.
    categories.push({
        title: "Created by",
        dataType: "owner",
        content: asRawItems(data.owners).map((it) => ({
            id: String(it.id),
            name: readStringField(it.full_name),
            count: readNumber(it.count),
            // KAN-04: owner options are also `single-filter-type-user` and carry
            // an avatar (filter.jade renders `img.user-pic` for both categories).
            gravatar_id: typeof it.gravatar_id === "string" ? it.gravatar_id : null,
            photo: typeof it.photo === "string" ? it.photo : null,
        })),
    });

    // Epic — with-id: name = "#{ref} {subject}"; no-id: "null" / "Not in an epic".
    categories.push({
        title: "Epic",
        dataType: "epic",
        content: asRawItems(data.epics).map((it) => {
            if (it.id != null) {
                return {
                    id: String(it.id),
                    name: `#${readStringField(it.ref, String(it.ref))} ${readStringField(
                        it.subject,
                    )}`.trim(),
                    count: readNumber(it.count),
                };
            }
            return { id: "null", name: "Not in an epic", count: readNumber(it.count) };
        }),
    });

    return categories;
}

/**
 * Translate the currently-selected filters into endpoint query params, grouping
 * ids by `dataType` (comma-joined) and whitelisting via
 * {@link KANBAN_VALID_QUERY_PARAMS}.
 */
export function pickSelectedFilterParams(
    selected: KanbanSelectedFilter[],
): QueryParams {
    const groups: Record<string, string[]> = {};
    for (const filter of selected) {
        // KAN-04: excluded values route to the `exclude_<dataType>` param, so
        // the include/exclude toggle round-trips to the same endpoint.
        const key =
            filter.mode === "exclude" ? `exclude_${filter.dataType}` : filter.dataType;
        if (!KANBAN_VALID_QUERY_PARAMS.has(key)) {
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
 * persists (filter key incl. `exclude_` prefix → comma-joined ids). Mirrors the
 * Backlog module's `selectedToStoredMap` and the AngularJS `saveCustomFilter`
 * (controllerMixins.coffee L201-L214).
 */
function selectedToStoredMap(
    selected: KanbanSelectedFilter[],
): Record<string, string> {
    const groups: Record<string, string[]> = {};
    for (const filter of selected) {
        const key =
            filter.mode === "exclude" ? `exclude_${filter.dataType}` : filter.dataType;
        if (!KANBAN_VALID_QUERY_PARAMS.has(key)) {
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
 * Rebuild a {@link KanbanSelectedFilter} list from a saved custom-filter param
 * map, matching each id against the freshly-loaded categories to recover its
 * display name/color (falling back to the raw id when the value no longer
 * exists). Keys carrying the `exclude_` prefix are restored with
 * `mode: "exclude"`. Mirrors the Backlog `reconstructSelectedFromParamMap`.
 */
function reconstructSelectedFromParamMap(
    paramMap: Record<string, string>,
    categories: KanbanFilters,
): KanbanSelectedFilter[] {
    const byDataType = new Map<string, KanbanFilterCategory>();
    for (const category of categories) {
        byDataType.set(category.dataType, category);
    }
    const selected: KanbanSelectedFilter[] = [];
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
 * {@link KanbanCustomFilter} list the panel renders. Mirrors the Backlog
 * `storedToCustomFilters` and the `_.forOwn` mapping in `generateFilters`
 * (controllerMixins.coffee L362-L364).
 */
function storedToKanbanCustomFilters(raw: StoredCustomFilters): KanbanCustomFilter[] {
    return Object.keys(raw).map((key) => ({ id: key, name: key, filter: raw[key] }));
}

/**
 * Per-category `single-filter-type-*` class (filter.jade `ng-class`), mirroring
 * the Backlog module. `assigned_users` / `owner` become `single-filter-type-user`
 * (the class the compiled `filter.scss` themes with the member avatar), tags
 * `single-filter-type-tag`, everything else `single-filter-type-general`.
 */
function kanbanOptionTypeClass(dataType: string): string {
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
 * background; every other category colors the left border; absent colors fall
 * back to a transparent border so the SCSS `border-left` slot stays reserved.
 * Mirrors the Backlog module's `optionStyle`.
 */
function kanbanOptionStyle(
    dataType: string,
    option: KanbanFilterOption,
): CSSProperties {
    if (dataType === "tags") {
        return option.color ? { background: option.color } : {};
    }
    return { borderColor: option.color ? option.color : "transparent" };
}

// ---------------------------------------------------------------------------
// KanbanFilterPanel — in-board reimplementation of the shared `tg-filter`
// directive. The root carries `.kanban-filter` so the already-compiled SCSS
// themes it unchanged, and so the toggle contract (`.kanban-filter` present iff
// the panel is open) is preserved.
// ---------------------------------------------------------------------------

interface KanbanFilterPanelProps {
    filters: KanbanFilters;
    selectedFilters: KanbanSelectedFilter[];
    /** Saved ("custom") filters for this project (KAN-04). */
    customFilters: KanbanCustomFilter[];
    /** Currently-applied saved filter id, for the `.active` highlight. */
    activeCustomFilter: string | null;
    /** Include/exclude mode of the NEXT option selection (KAN-04). */
    filterMode: string;
    onSetFilterMode: (mode: string) => void;
    onAddFilter: (category: KanbanFilterCategory, option: KanbanFilterOption) => void;
    onRemoveFilter: (filter: KanbanSelectedFilter) => void;
    onSaveCustomFilter: (name: string) => void;
    onSelectCustomFilter: (filter: KanbanCustomFilter) => void;
    onRemoveCustomFilter: (filter: KanbanCustomFilter) => void;
}

/**
 * In-board reimplementation of the shared AngularJS `tg-filter` widget
 * (filter.jade + filter.controller.coffee), rendering the SAME class-driven DOM
 * as the Backlog port so the compiled `filter.scss` themes it unchanged. KAN-04
 * restored the capabilities the first Kanban port dropped, bringing it to parity
 * with the Backlog panel:
 *   - the saved ("custom") filters section (list + add-form + delete),
 *   - the "Filtered by:" applied-filter chips with a visible × remove glyph,
 *   - the include/exclude mode toggle and the included/excluded split, and
 *   - collapsible filter categories (only one open at a time; all closed
 *     initially, matching `FilterController.opened = null`).
 * The root keeps the `.kanban-filter#kanban-filter` id/class so the board's
 * toggle contract (panel present iff open) and any board-scoped layout survive.
 */
function KanbanFilterPanel(props: KanbanFilterPanelProps): JSX.Element {
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

    // -- Collapse: a single open category dataType (null = all closed). --------
    const [opened, setOpened] = useState<string | null>(null);
    const isOpen = useCallback((dataType: string): boolean => opened === dataType, [opened]);
    const toggleCategory = useCallback((dataType: string): void => {
        setOpened((prev) => (prev === dataType ? null : dataType));
    }, []);

    // -- Custom-filter add-form state + validation (filter.controller). --------
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
        (dataType: string, id: string): boolean =>
            selectedFilters.some(
                (f) => f.dataType === dataType && String(f.id) === String(id),
            ),
        [selectedFilters],
    );

    // -- Applied filters split by mode. ----------------------------------------
    const includedFilters = selectedFilters.filter((f) => f.mode !== "exclude");
    const excludedFilters = selectedFilters.filter((f) => f.mode === "exclude");
    const hasCustomForm = customFilterForm && selectedFilters.length > 0;

    /** One applied-filter chip (shared by the included/excluded groups). */
    const appliedChip = (filter: KanbanSelectedFilter): JSX.Element => (
        <div
            key={`${filter.dataType}:${filter.id}`}
            className={`single-applied-filter ${filter.mode ?? "include"}`}
        >
            <span className="name">{filter.name}</span>
            <button
                type="button"
                className="remove-filter e2e-remove-filter"
                aria-label={t("COMMON.FILTERS.REMOVE", "Remove filter {{name}}", {
                    name: filter.name,
                })}
                onClick={() => onRemoveFilter(filter)}
            >
                <Icon name="icon-close" />
            </button>
        </div>
    );

    return (
        <div className="kanban-filter" id="kanban-filter">
            {/* Custom (saved) filters ---------------------------------------- */}
            <div className="custom-filters">
                <div className="custom-filters-header">
                    <div className="custom-filters-title">
                        <span className="name">
                            {t("COMMON.FILTERS.TITLE", "Custom filters")}
                        </span>
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
                                {t(
                                    "COMMON.FILTERS.REPEATED_FILTER_ERROR",
                                    "This filter name is already in use",
                                )}
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
                                    aria-label={t(
                                        "COMMON.FILTERS.REMOVE_CUSTOM_FILTER",
                                        "Remove saved filter {{name}}",
                                        { name: filter.name },
                                    )}
                                    onClick={() => onRemoveCustomFilter(filter)}
                                >
                                    <Icon name="icon-trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="filters-step-cat">
                {/* Applied filters, split into included / excluded ----------- */}
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

                {/* Include / exclude mode toggle ----------------------------- */}
                <div className="filters-advanced">
                    <div className="filters-advanced-form">
                        {KANBAN_FILTER_MODE_OPTIONS.map((option) => (
                            <div className="custom-radio" key={option}>
                                <input
                                    type="radio"
                                    name="kanban-filter-mode"
                                    id={`kanban-filter-mode-${option}`}
                                    value={option}
                                    checked={filterMode === option}
                                    onChange={() => onSetFilterMode(option)}
                                />
                                <label
                                    className={`filter-mode ${option}${
                                        filterMode === option ? " active" : ""
                                    }`}
                                    htmlFor={`kanban-filter-mode-${option}`}
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

                {/* Collapsible filter categories ----------------------------- */}
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
                                        <Icon name={open ? "icon-arrow-down" : "icon-arrow-right"} />
                                    </button>

                                    {open && (
                                        <div className="filter-list">
                                            {category.content
                                                .filter(
                                                    (option) =>
                                                        !isSelected(category.dataType, option.id),
                                                )
                                                .map((option) => {
                                                    // KAN-04: the `assigned_users` / `owner`
                                                    // categories render a member avatar
                                                    // (`filter.jade`'s `img.user-pic[tg-avatar]`).
                                                    // A null gravatar resolves to the "unnamed"
                                                    // placeholder — matching the AngularJS
                                                    // "Unassigned" / "Not assigned" rows.
                                                    const isUserType =
                                                        category.dataType ===
                                                            "assigned_users" ||
                                                        category.dataType === "owner";
                                                    const avatar = isUserType
                                                        ? resolveUserAvatar({
                                                              id: 0,
                                                              gravatar_id:
                                                                  option.gravatar_id ?? null,
                                                              photo: option.photo ?? null,
                                                          })
                                                        : null;
                                                    return (
                                                    <button
                                                        type="button"
                                                        key={String(option.id)}
                                                        className={`single-filter ${kanbanOptionTypeClass(
                                                            category.dataType,
                                                        )}`}
                                                        style={kanbanOptionStyle(
                                                            category.dataType,
                                                            option,
                                                        )}
                                                        onClick={() => onAddFilter(category, option)}
                                                    >
                                                        {avatar && (
                                                            <img
                                                                className="user-pic"
                                                                style={{
                                                                    background: avatar.bg,
                                                                }}
                                                                src={avatar.url}
                                                                alt=""
                                                            />
                                                        )}
                                                        <span className="name">{option.name}</span>
                                                        {typeof option.count === "number" &&
                                                            option.count > 0 && (
                                                                <span className="number e2e-filter-count">
                                                                    {option.count}
                                                                </span>
                                                            )}
                                                    </button>
                                                    );
                                                })}
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

// ---------------------------------------------------------------------------
// Error notification banner — the React-owned equivalent of the AngularJS
// `$tgConfirm.notify("error")` toast (QA-FUNC-14). It reproduces the
// notification-message DOM (icon + title + message + dismiss) but uses a
// DISTINCT, React-owned class prefix (`kanban-notification*`) rather than the
// global `.notification-message-error` class, so the cross-framework
// `$tgConfirm.notify` selector never targets this element. Dismissed by the
// user via the close control (the surviving AngularJS shell owns any auto-hide
// timing for its own toasts; here the board keeps the banner until dismissed or
// superseded, matching the "a message is shown" requirement).
// ---------------------------------------------------------------------------

interface KanbanNotificationProps {
    message: string;
    onClose: () => void;
}

function KanbanNotification(props: KanbanNotificationProps): JSX.Element {
    // [M-06] Localized at render time (see the module-level note on why the
    // translator must not be invoked at module load).
    const NOTIFY_ERROR_TITLE = t("NOTIFICATION.WARNING", "Oops, something went wrong...");
    const NOTIFY_CLOSE_LABEL = t("NOTIFICATION.CLOSE", "Close notification");
    return (
        <div
            className="kanban-notification kanban-notification-error"
            role="alert"
        >
            <Icon name="icon-error" wrapperClass="kanban-notification-icon" />
            <div className="text">
                <h4 className="warning">{NOTIFY_ERROR_TITLE}</h4>
                <p>{props.message}</p>
            </div>
            <button
                type="button"
                className="close kanban-notification-close"
                aria-label={NOTIFY_CLOSE_LABEL}
                title={NOTIFY_CLOSE_LABEL}
                onClick={props.onClose}
            >
                <Icon name="icon-close" />
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// [N-03] Delete-confirmation state + message rendering.
//
// The AngularJS Kanban deleted a story through `$tgConfirm.askOnDelete(...)`
// (common/confirm.coffee L122), a THEMED, localized lightbox — never the
// browser-native `window.confirm`. The initial React port regressed this to a
// raw `window.confirm("Delete this user story?")` (English-only, unthemed,
// blocking). This state object + the shared {@link ConfirmDialog} restore the
// themed/localized behavior, mirroring the Backlog root's already-fixed flow.
// ---------------------------------------------------------------------------

interface DeleteConfirmState {
    /** Whether the confirmation dialog is open. */
    open: boolean;
    /** The story pending deletion (id + subject for the message), or null. */
    us: { id: number; subject: string } | null;
    /** True while the DELETE request is in flight (disables the buttons). */
    busy: boolean;
}

/**
 * Render the localized "Are you sure you want to delete …" message with the
 * story subject wrapped in `<strong>` — ports `US.TITLE_DELETE_MESSAGE`
 * (locale-en.json) and the AngularJS `askOnDelete` copy. The subject is passed
 * as a React child (auto-escaped), so no `dangerouslySetInnerHTML` is used and
 * the migration's XSS-safe posture is preserved. When the active locale's value
 * carries no `<strong>` wrapper the text is rendered plain (tags stripped),
 * matching the Backlog root's identical helper.
 */
function renderDeleteMessage(subject: string): ReactNode {
    const rendered = t(
        "US.TITLE_DELETE_MESSAGE",
        "Are you sure you want to delete <strong>\u201C{{subject}}\u201C</strong>?",
        { subject },
    );
    const match = rendered.match(/^([\s\S]*?)<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
    if (!match) {
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

// Bulk create lightbox (QA-FUNC-04) — a faithful React reproduction of
// `lightbox-us-bulk.jade` + `CreateBulkUserstoriesDirective`
// (common/lightboxes.coffee L315-L410). It renders the same regions the
// AngularJS lightbox did — title, status selector, top/bottom position radios,
// swimlane selector (in swimlane mode), and the `cols=200` textarea with the
// "One item per line..." placeholder — using the same DOM/class names so the
// compiled `lightbox.scss` themes it unchanged. On submit it validates the
// textarea (QA-FUNC-07: required + linewidth<200) and, only when valid, hands
// the subjects together with the SELECTED status, swimlane (QA-FUNC-05) and
// position to `onSubmit`.
// ---------------------------------------------------------------------------

interface BulkLightboxProps {
    /** All project statuses shown in the status selector. */
    statuses: Status[];
    /** Status whose "+bulk" affordance opened the lightbox (initial selection). */
    initialStatusId: number;
    /** Real swimlanes for the swimlane selector (empty on a no-swimlane board). */
    swimlanes: Swimlane[];
    /** Project default swimlane — the swimlane pre-selected on open (QA-FUNC-05). */
    defaultSwimlaneId: number | null;
    /** Whether the board is in swimlane mode (gates the swimlane selector). */
    swimlaneMode: boolean;
    /** Whether an "Unclassified" swimlane option should be offered. */
    hasUnclassified: boolean;
    onSubmit: (
        subjects: string,
        statusId: number,
        swimlaneId: number | null,
        position: "top" | "bottom",
    ) => void;
    onClose: () => void;
    /** Inline error surfaced when a bulk-create request fails (QA-FUNC-06). */
    error?: string | null;
    /**
     * [N02] Whether a bulk-create request is currently in flight. Drives the
     * visible busy/disabled state on the Save button so a slow submit is
     * distinguishable and cannot be double-activated from the UI, matching the
     * in-flight affordance the sibling lightboxes provide.
     */
    submitting?: boolean;
}

function BulkLightbox(props: BulkLightboxProps): JSX.Element {
    const {
        statuses,
        initialStatusId,
        swimlanes,
        defaultSwimlaneId,
        swimlaneMode,
        hasUnclassified,
        onSubmit,
        onClose,
        error,
        submitting = false,
    } = props;

    const [text, setText] = useState("");
    const [statusId, setStatusId] = useState<number>(initialStatusId);
    const [displayStatusSelector, setDisplayStatusSelector] = useState(false);
    const [swimlaneId, setSwimlaneId] = useState<number | null>(defaultSwimlaneId);
    const [displaySwimlaneSelector, setDisplaySwimlaneSelector] = useState(false);
    const [position, setPosition] = useState<"top" | "bottom">("bottom");
    // Client-side validation message (QA-FUNC-07); takes precedence over the
    // server-side failure error (QA-FUNC-06) in the shared `.bulk-error` slot.
    const [validationError, setValidationError] = useState<string | null>(null);

    // F-KANBAN-BULK-MODAL: promote the bulk-insert lightbox to a proper modal
    // dialog, matching the sibling `UserStoryEditLightbox` and the Backlog
    // `BulkUserStoriesLightbox`. `useDialogA11y` supplies role="dialog" +
    // aria-modal="true", moves focus into the dialog on open, traps Tab focus,
    // makes the background inert, restores focus on close, and closes on Escape
    // (stack-aware). The lightbox is only mounted while open (bulkStatusId !==
    // null in the parent), so `open` is constant `true` for its lifetime.
    const titleId = useId();
    const { dialogRef, dialogProps } = useDialogA11y({
        open: true,
        onClose,
        closeOnEscape: true,
    });

    const currentStatus =
        statuses.find((status) => status.id === statusId) ?? statuses[0];
    const currentSwimlane =
        swimlaneId === null
            ? null
            : swimlanes.find((swimlane) => swimlane.id === swimlaneId) ?? null;
    const showSwimlaneSelector = swimlaneMode && swimlanes.length > 0;
    const shownError = validationError ?? error ?? null;

    // [M-06] Bulk-lightbox copy localized at render time (see the module-level
    // note on why the translator is not invoked at module load). Keys + English
    // fallbacks are the authoritative catalog entries referenced by the legacy
    // `lightbox-us-bulk.jade`.
    // F-KANBAN-BULK-CLOSE-LABEL: this control dismisses a MODAL DIALOG, so its
    // accessible name is the generic dialog "close" (COMMON.CLOSE) — matching
    // the sibling lightbox close buttons — not the notification-toast dismiss
    // string ("Close notification"), which belongs to `KanbanNotification`.
    const BULK_CLOSE_LABEL = t("COMMON.CLOSE", "close");
    const BULK_TITLE = t("COMMON.NEW_BULK", "New bulk insert");
    const BULK_SELECT_STATUS = t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS", "Select status");
    const BULK_LOCATION = t("LIGHTBOX.CREATE_EDIT.LOCATION", "Location");
    const BULK_CREATE_BOTTOM = t("LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM", "at the bottom");
    const BULK_CREATE_TOP = t("LIGHTBOX.CREATE_EDIT.CREATE_TOP", "on top");
    const BULK_SELECT_SWIMLANE = t("LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE", "Select swimlane");
    const BULK_DEFAULT_SWIMLANE = t("ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT", "Default");
    const BULK_UNCLASSIFIED = t(
        "KANBAN.UNCLASSIFIED_USER_STORIES",
        "Unclassified user stories",
    );
    const BULK_PLACEHOLDER = t("COMMON.ONE_ITEM_LINE", "One item per line...");
    const BULK_SAVE = t("COMMON.SAVE", "Save");
    // [N02] Busy label shown on the Save button while a bulk-create request is
    // in flight, so a slow/offline submit has a visible in-flight distinction.
    const BULK_SAVING = t("COMMON.LOADING", "Loading...");

    const handleSubmit = (): void => {
        // [N02] Ignore activations while a request is already in flight so the
        // disabled Save button cannot be bypassed (e.g. Enter key), giving the
        // same single-write guarantee as the parent's `bulkSubmittingRef`.
        if (submitting) {
            return;
        }
        const message = validateBulkText(text);
        if (message !== null) {
            setValidationError(message);
            return;
        }
        setValidationError(null);
        onSubmit(text, statusId, swimlaneId, position);
    };

    return (
        <div
            className="lightbox lightbox-generic-bulk open"
            ref={dialogRef}
            {...dialogProps}
            aria-labelledby={titleId}
        >
            <div className="lightbox-us-bulk">
                <button
                    type="button"
                    className="close lightbox-close e2e-bulk-close"
                    aria-label={BULK_CLOSE_LABEL}
                    title={BULK_CLOSE_LABEL}
                    onClick={onClose}
                >
                    <Icon name="icon-close" />
                </button>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        handleSubmit();
                    }}
                >
                    <h2 className="title" id={titleId}>{BULK_TITLE}</h2>

                    {statuses.length ? (
                        <fieldset>
                            <div className="label">{BULK_SELECT_STATUS}</div>
                            <div className="bulk-status-selector-wrapper">
                                <button
                                    type="button"
                                    className={
                                        "bulk-status-selector" +
                                        (displayStatusSelector ? " active" : "")
                                    }
                                    style={
                                        currentStatus
                                            ? { backgroundColor: currentStatus.color }
                                            : undefined
                                    }
                                    onClick={() =>
                                        setDisplayStatusSelector((open) => !open)
                                    }
                                >
                                    <span>{currentStatus?.name}</span>
                                    <Icon name="icon-arrow-down" />
                                </button>
                                {displayStatusSelector ? (
                                    <div className="bulk-status-option-wrapper">
                                        {statuses.map((status) => (
                                            <button
                                                key={status.id}
                                                type="button"
                                                className={
                                                    "bulk-status-option" +
                                                    (status.id === statusId
                                                        ? " selected"
                                                        : "")
                                                }
                                                onClick={() => {
                                                    setStatusId(status.id);
                                                    setDisplayStatusSelector(false);
                                                }}
                                            >
                                                {status.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </fieldset>
                    ) : null}

                    <fieldset className="creation-position">
                        <div className="label">{BULK_LOCATION}</div>
                        <div className="creation-position-fields">
                            <label className="custom-radio">
                                <input
                                    type="radio"
                                    name="us_position"
                                    value="bottom"
                                    checked={position === "bottom"}
                                    onChange={() => setPosition("bottom")}
                                />
                                <span className="radio-control" />
                                <span className="radio-label">
                                    {BULK_CREATE_BOTTOM}
                                </span>
                            </label>
                            <label className="custom-radio">
                                <input
                                    type="radio"
                                    name="us_position"
                                    value="top"
                                    checked={position === "top"}
                                    onChange={() => setPosition("top")}
                                />
                                <span className="radio-control" />
                                <span className="radio-label">
                                    {BULK_CREATE_TOP}
                                </span>
                            </label>
                        </div>
                    </fieldset>

                    {showSwimlaneSelector ? (
                        <fieldset className="swimlane-select">
                            <div className="label">{BULK_SELECT_SWIMLANE}</div>
                            <div className="swimlane-selector">
                                <button
                                    type="button"
                                    className="select"
                                    onClick={() =>
                                        setDisplaySwimlaneSelector((open) => !open)
                                    }
                                >
                                    {currentSwimlane ? (
                                        <span className="swimlane-select-text">
                                            <span>{currentSwimlane.name}</span>
                                            {currentSwimlane.id ===
                                                defaultSwimlaneId &&
                                            swimlanes.length > 1 ? (
                                                <span className="swimlane-default">
                                                    {" (" +
                                                        BULK_DEFAULT_SWIMLANE +
                                                        ")"}
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : (
                                        <span className="swimlane-select-text unclassified">
                                            {BULK_UNCLASSIFIED}
                                        </span>
                                    )}
                                    <Icon name="icon-arrow-down" />
                                </button>
                                {displaySwimlaneSelector ? (
                                    <div className="options">
                                        {hasUnclassified ? (
                                            <button
                                                type="button"
                                                className={
                                                    "option unclassified" +
                                                    (swimlaneId === null
                                                        ? " selected"
                                                        : "")
                                                }
                                                onClick={() => {
                                                    setSwimlaneId(null);
                                                    setDisplaySwimlaneSelector(
                                                        false,
                                                    );
                                                }}
                                            >
                                                {BULK_UNCLASSIFIED}
                                            </button>
                                        ) : null}
                                        {swimlanes.map((swimlane) => (
                                            <button
                                                key={swimlane.id}
                                                type="button"
                                                className={
                                                    "option" +
                                                    (swimlane.id === swimlaneId
                                                        ? " selected"
                                                        : "")
                                                }
                                                onClick={() => {
                                                    setSwimlaneId(swimlane.id);
                                                    setDisplaySwimlaneSelector(
                                                        false,
                                                    );
                                                }}
                                            >
                                                <span>{swimlane.name}</span>
                                                {defaultSwimlaneId ===
                                                    swimlane.id &&
                                                swimlanes.length > 1 ? (
                                                    <span className="swimlane-default">
                                                        {" (" +
                                                            BULK_DEFAULT_SWIMLANE +
                                                            ")"}
                                                    </span>
                                                ) : null}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </fieldset>
                    ) : null}

                    <fieldset>
                        <textarea
                            className="bulk-subjects e2e-bulk-subjects"
                            cols={BULK_LINE_WIDTH}
                            wrap="off"
                            placeholder={BULK_PLACEHOLDER}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                        />
                    </fieldset>

                    {shownError ? (
                        <div className="bulk-error e2e-bulk-error" role="alert">
                            {shownError}
                        </div>
                    ) : null}

                    <div className="lb-action-wrapper">
                        <button
                            type="submit"
                            className={
                                "btn-small js-submit-button e2e-bulk-submit" +
                                (submitting ? " is-loading" : "")
                            }
                            title={submitting ? BULK_SAVING : BULK_SAVE}
                            disabled={submitting}
                            aria-busy={submitting}
                        >
                            {submitting ? BULK_SAVING : BULK_SAVE}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Kanban root component
// ---------------------------------------------------------------------------

export function KanbanApp(props: HostElementProps): JSX.Element {
    const { projectId } = props;
    const kanban = useKanbanState();

    // [M-06] Board-header + notification + permission-denied copy localized at
    // RENDER time (see the module-level note on why the translator must not be
    // invoked at module load). Keys + English fallbacks are the authoritative
    // catalog entries used by the legacy Jade markup / locale-en.json.
    const SECTION_NAME = t("KANBAN.SECTION_NAME", "Kanban");
    const ZOOM_TITLE = t("ZOOM.TITLE", "Zoom:");
    const ZOOM_LABELS: ReadonlyArray<string> = [
        t("ZOOM.ZOOM-1", "Compact"),
        t("ZOOM.ZOOM-2", "Default"),
        t("ZOOM.ZOOM-3", "Detailed"),
        t("ZOOM.ZOOM-4", "Expanded"),
    ];
    const SEARCH_PLACEHOLDER = t("COMMON.FILTERS.INPUT_PLACEHOLDER", "subject or reference");
    // `aria-label` has no legacy catalog entry (added for QA-A11Y-01); it routes
    // through the translator and resolves to the fallback until a key is added.
    const SEARCH_ARIA_LABEL = t(
        "KANBAN.SEARCH_ARIA_LABEL",
        "Search by subject or reference",
    );
    const NOTIFY_ERROR_MESSAGE = t("NOTIFICATION.WARNING_TEXT", "Your changes were not saved!");
    // [N02] Distinct bulk-create failure messages so an offline failure reads
    // differently from a server rejection instead of collapsing to one string.
    const BULK_OFFLINE_ERROR_MESSAGE = t(
        "COMMON.CONNECTION_ERROR",
        "Unable to reach the server. Your text is kept — check your connection and try again.",
    );
    const BULK_SERVER_ERROR_MESSAGE = t(
        "NOTIFICATION.WARNING_TEXT",
        "The server could not create the stories. Your text is kept — please try again.",
    );
    const PERMISSION_DENIED_TITLE = t("ERROR.PERMISSION_DENIED", "Permission denied");
    const PERMISSION_DENIED_TEXT = t(
        "ERROR.PERMISSION_DENIED_TEXT",
        "You don't have permission to access this page.",
    );
    // [N10] Board load-error copy + retry label. The AngularJS Kanban left the
    // global `tgLoader` spinner up on a failed initial load (recoverable only by
    // a full browser reload); the React root surfaces an explicit, in-board error
    // with a Retry affordance that re-runs `loadInitialData` instead.
    const LOAD_ERROR_TEXT = t(
        "KANBAN.ERROR_LOADING_KANBAN",
        "The board could not be loaded.",
    );
    const RETRY_LABEL = t("COMMON.RETRY", "Retry");

    // The EFFECTIVE project id the whole board keys off. It is the prop id when
    // that is already a valid positive integer; otherwise it stays `NaN` until
    // `loadInitialData` resolves it from the URL slug via `GET projects/by_slug`
    // (QA finding — blank Kanban board). The prop is populated from the Jade host
    // attribute `data-project-id="{{project.id}}"`, but with the AngularJS
    // `KanbanController` removed that interpolation stays empty, so `parseInt("")`
    // yields `NaN` and every id-gated loader silently skips. Mirroring the Backlog
    // root, we fall back to resolving the id from the `/project/:slug/kanban` URL.
    // `resolvedIdRef` mirrors this so the async loaders can read the freshest id
    // the instant it is published — WITHIN the same `loadInitialData` run —
    // without being re-created on every change.
    const [resolvedId, setResolvedId] = useState<number>(() =>
        isValidProjectId(projectId) ? projectId : NaN,
    );

    const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM_LEVEL);
    const [zoom, setZoom] = useState<string[]>(() => zoomKeysFor(DEFAULT_ZOOM_LEVEL));
    const [openFilter, setOpenFilter] = useState(false);
    const [filterQ, setFilterQ] = useState("");
    const [folds, setFolds] = useState<Record<number, boolean>>({});
    const [unfold, setUnfold] = useState<number | null>(null);
    const [foldedSwimlane, setFoldedSwimlane] = useState<Record<number, boolean>>({});
    // Multi-select group drag (QA-FUNC-01): the AngularJS board supported
    // ctrl/meta-click multi-card selection for group drag, tracked in
    // `ctrl.selectedUss` (a `{ [usId]: boolean }` map) and reflected on each card
    // via the `kanban-task-selected` / `ui-multisortable-multiple` classes
    // (kanban-table.jade). Selecting one card and dragging it moves the whole
    // selection together, and the selection is cleared whenever the board
    // reloads (`cleanSelectedUss`, main.coffee L597). This state reproduces that
    // map; `toggleSelectedUs` flips a single card and it is threaded to the leaf
    // `Card` (via `selectedUss` + `onToggleSelect`) which already renders the
    // matching classes.
    const [selectedUss, setSelectedUss] = useState<Record<number, boolean>>({});
    const [movedUs, setMovedUs] = useState<number[]>([]);
    const [notFound, setNotFound] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState<KanbanProject | null>(null);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [loadError, setLoadError] = useState(false);
    // Board-level error banner (QA-FUNC-14) and bulk-lightbox inline error
    // (QA-FUNC-06). `null` = hidden.
    const [errorNotice, setErrorNotice] = useState<string | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    // [N02] Visible in-flight state for the bulk-create submit. `bulkSubmittingRef`
    // (a ref) guards double-submit synchronously but does not re-render; this
    // STATE drives the disabled/busy affordance on the lightbox's Save button so
    // the pending request is visible.
    const [bulkSubmitting, setBulkSubmitting] = useState<boolean>(false);
    // [N-03] Themed delete-confirmation dialog state (replaces window.confirm).
    // `open` toggles the shared ConfirmDialog; `busy` disables its buttons while
    // the DELETE is in flight; `us` carries the id + subject for the message.
    const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
        open: false,
        us: null,
        busy: false,
    });

    // Sidebar filter state (F2). `filters` are the five category widgets built
    // from `filters_data`; `selectedFilters` are the user's active choices and
    // feed every `listUserstories` request via `pickSelectedFilterParams`.
    const [filters, setFilters] = useState<KanbanFilters>([]);
    const [selectedFilters, setSelectedFilters] = useState<KanbanSelectedFilter[]>(
        [],
    );
    // KAN-04: include/exclude mode of the NEXT option selection, saved ("custom")
    // filters, and the currently-applied saved filter id — the three tg-filter
    // capabilities the first Kanban port dropped (parity with the Backlog panel).
    const [filterMode, setFilterMode] = useState<string>("include");
    const [customFilters, setCustomFilters] = useState<KanbanCustomFilter[]>([]);
    const [activeCustomFilter, setActiveCustomFilter] = useState<string | null>(null);

    const projectRef = useRef<KanbanProject | null>(null);
    // Mirrors `resolvedId` so the memoised async loaders never read a stale
    // closure and can pick up the id the instant `loadInitialData` publishes it.
    const resolvedIdRef = useRef<number>(resolvedId);
    resolvedIdRef.current = resolvedId;
    const zoomLevelRef = useRef(zoomLevel);
    const filterQRef = useRef(filterQ);
    const selectedFiltersRef = useRef(selectedFilters);
    // KAN-04: mirror the include/exclude mode so `addFilter` (which reads refs,
    // not reactive closures) always sees the live value.
    const filterModeRef = useRef<string>(filterMode);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // In-flight guard for the bulk-create submit — preserves the double-submit
    // prevention (QA verified PASS) now that the lightbox closes only on success
    // (QA-FUNC-06), not synchronously at submit time.
    const bulkSubmittingRef = useRef<boolean>(false);
    // Unmount guard: async resolvers must not `setState` after the root has been
    // unmounted (F-C). Mirrors the Backlog root's `aliveRef` pattern.
    const aliveRef = useRef<boolean>(true);
    // M-03/M-04: monotonic generation counter for board-loading operations
    // (`loadInitialData` + `reloadUserstories`). Each load captures the value it
    // bumps to and commits its result ONLY if it is still the newest load; a
    // superseded (stale) load — from an older filter/search/zoom/event OR a prior
    // project/query transition on the same instance — is dropped. This is the
    // "only the latest request may commit" guarantee, and it makes same-instance
    // project transitions safe where the boolean `aliveRef` alone was not.
    const loadGenRef = useRef<number>(0);
    // M-03: independent latest-wins guard for the auxiliary filter metadata load,
    // so a slow `filters_data` response cannot overwrite the categories produced
    // by a newer selection. Kept separate from `loadGenRef` because a filter
    // change reloads BOTH the board and the filters and the two must not cancel
    // each other.
    const filterGenRef = useRef<number>(0);
    // N-05: a SINGLE handle for the moved-card highlight timer, cleared before it
    // is replaced (rapid successive moves) and on unmount, so overlapping timers
    // can neither fight over `movedUs` nor fire after the root is gone.
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // F-KANBAN-ARCHIVED-NO-LOAD: the board's raw story list is composed from the
    // base (non-archived) list PLUS the stories of any ARCHIVED columns the user
    // has unfolded. `reduceSetUserstories` rebuilds the whole board from the list
    // it is handed, so every board publish must pass the COMPOSED list (base +
    // shown archived); otherwise a reload would silently drop the archived
    // stories the user asked to see. `baseUserstoriesRef` holds the latest base
    // list; `shownArchivedRef` maps an unfolded archived status id -> its fetched
    // stories.
    const baseUserstoriesRef = useRef<UserStoryModel[]>([]);
    const shownArchivedRef = useRef<Record<number, UserStoryModel[]>>({});
    zoomLevelRef.current = zoomLevel;
    filterQRef.current = filterQ;
    selectedFiltersRef.current = selectedFilters;
    filterModeRef.current = filterMode;

    // F-KANBAN-ARCHIVED-NO-LOAD: merge the base list with every shown archived
    // column's stories, de-duplicated by id (a story belongs to exactly one
    // status, so the archived set never legitimately overlaps the base set —
    // the dedup simply keeps the compose idempotent). The composed list is what
    // is handed to `kanban.setUserstories`, which groups stories into columns by
    // `status`, so archived stories land in their archived column and — because
    // `statusHide` is never populated — render once the column is unfolded.
    const composeBoardUserstories = (): UserStoryModel[] => {
        const composed: UserStoryModel[] = [];
        const seen = new Set<number>();
        const append = (list: UserStoryModel[]): void => {
            for (const us of list) {
                if (!seen.has(us.id)) {
                    seen.add(us.id);
                    composed.push(us);
                }
            }
        };
        append(baseUserstoriesRef.current);
        for (const key of Object.keys(shownArchivedRef.current)) {
            append(shownArchivedRef.current[Number(key)] ?? []);
        }
        return composed;
    };

    // -----------------------------------------------------------------------
    // Data loading (deferred until projectId is finite)
    // -----------------------------------------------------------------------

    const reloadUserstories = async (
        levelOverride?: number,
        queryOverride?: string,
    ): Promise<void> => {
        const project = projectRef.current;
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id) || !project) {
            return;
        }
        const level = levelOverride ?? zoomLevelRef.current;
        const query = queryOverride ?? filterQRef.current;
        const selected = selectedFiltersRef.current;
        // F-KANBAN-ARCHIVED-NO-LOAD: any archived columns the user has already
        // unfolded must survive a reload (filter/search change, WebSocket event,
        // post-drag refresh). Re-fetch each in the SAME parallel batch — under the
        // SAME generation guard — so their content also honours the active
        // search/filters, then recompose. When no archived column is unfolded
        // this list is empty and the request set is unchanged (base + swimlanes).
        const shownArchivedIds = Object.keys(shownArchivedRef.current).map(Number);
        // M-03/M-04: claim the newest generation. Any load already in flight is
        // now stale and will drop its result below.
        const myGen = ++loadGenRef.current;
        try {
            const [usResponse, swimlaneResponse, ...archivedResponses] =
                await Promise.all([
                    listUserstories(
                        id,
                        buildUserstoriesParams(level, query, selected),
                    ),
                    httpGet<Swimlane[]>("/swimlanes", { project: id }),
                    ...shownArchivedIds.map((statusId) =>
                        listUserstories(
                            id,
                            buildArchivedStatusParams(level, query, selected, statusId),
                        ),
                    ),
                ]);
            // Drop the result if the root unmounted OR a newer load superseded us.
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            const userstories =
                (usResponse.data as unknown as UserStoryModel[]) ?? [];
            // Refresh the shown-archived cache from the parallel responses.
            shownArchivedIds.forEach((statusId, index) => {
                shownArchivedRef.current[statusId] =
                    (archivedResponses[index]?.data as unknown as UserStoryModel[]) ??
                    [];
            });
            baseUserstoriesRef.current = userstories;
            kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
            kanban.setUserstories(composeBoardUserstories());
            // Multi-select group drag (QA-FUNC-01): clear the card selection whenever
            // the board reloads, mirroring `cleanSelectedUss` (main.coffee L597) so a
            // stale selection cannot outlive the cards it referenced.
            setSelectedUss({});
            setNotFound(userstories.length === 0 && !!query);
        } catch {
            // M-03: a reload can be fired-and-forgotten (WebSocket handler, drag
            // persist, delete). Catch here so it never rejects unhandled, and —
            // only if we are still the newest live load — surface the shared error
            // toast instead of silently leaving the board stale.
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            setErrorNotice(NOTIFY_ERROR_MESSAGE);
        }
    };

    /**
     * F-KANBAN-ARCHIVED-NO-LOAD: fetch a single ARCHIVED status's stories and
     * merge them into the board. Invoked lazily when the user UNFOLDS an archived
     * column (see {@link foldStatus}), reproducing the legacy AngularJS
     * `loadUserStoriesForStatus({status, ...})` call that ran on the
     * `kanban:show-userstories-for-status` broadcast.
     *
     * The request uses {@link buildArchivedStatusParams} — scoped to the status
     * id, WITHOUT `status__is_archived:false` — so it returns the archived
     * stories the base board request deliberately excludes. On success the
     * fetched stories are cached under the status id and the board is recomposed
     * (base + all shown archived); a failure surfaces the shared error toast and
     * leaves the base board intact. Guarded by `aliveRef` so a late resolve after
     * unmount never calls `setState`.
     */
    const loadArchivedStatus = async (statusId: number): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        try {
            const response = await listUserstories(
                id,
                buildArchivedStatusParams(
                    zoomLevelRef.current,
                    filterQRef.current,
                    selectedFiltersRef.current,
                    statusId,
                ),
            );
            if (!aliveRef.current) {
                return;
            }
            shownArchivedRef.current[statusId] =
                (response.data as unknown as UserStoryModel[]) ?? [];
            kanban.setUserstories(composeBoardUserstories());
        } catch {
            if (!aliveRef.current) {
                return;
            }
            setErrorNotice(NOTIFY_ERROR_MESSAGE);
        }
    };

    /**
     * Fetch the `filters_data` metadata (scoped to the current selection) and
     * build the five Kanban category widgets. Guarded by `Number.isFinite` (so
     * a transient-NaN projectId issues no request) and by `aliveRef` (so a late
     * resolve after unmount does not `setState`). A failure leaves the existing
     * categories intact — filters are auxiliary, never fatal to the board.
     */
    const loadFilters = async (
        overrideSelected?: KanbanSelectedFilter[],
    ): Promise<void> => {
        const id = resolvedIdRef.current;
        if (!isValidProjectId(id)) {
            return;
        }
        const selected = overrideSelected ?? selectedFiltersRef.current;
        // M-03: latest-wins for the auxiliary filter-metadata load, independent of
        // the board `loadGenRef`, so a slow response for an older selection cannot
        // overwrite the categories computed for a newer one.
        const myGen = ++filterGenRef.current;
        try {
            const response = await filtersData({
                project: id,
                ...pickSelectedFilterParams(selected),
            });
            if (!aliveRef.current || myGen !== filterGenRef.current) {
                return;
            }
            setFilters(buildKanbanFilterCategories(response.data));
        } catch {
            /* filters are auxiliary; a failure must not blank the board */
        }
    };

    const loadInitialData = async (): Promise<void> => {
        // Resolve the project FIRST, mirroring the Backlog root. The host attribute
        // `data-project-id="{{project.id}}"` interpolates to `NaN` now that the
        // AngularJS `KanbanController` is gone (QA finding — blank Kanban board),
        // so a valid positive-integer prop uses the by-id path and everything else
        // falls back to the `/project/:slug/kanban` URL slug via
        // `GET projects/by_slug`. When neither an id nor a slug is available there
        // is nothing to resolve yet, so no request is issued (keeps a transient
        // render network-silent).
        if (!isValidProjectId(projectId) && slugFromLocation() === null) {
            return;
        }
        // [N10] Clear any prior gate state before (re)loading so a stale denial
        // or a recovered load error never sticks across reloads — this is what
        // makes the load-error "Retry" affordance below actually recover the
        // board (mirrors the Backlog root's `loadProject`, which resets
        // `permissionDenied` / `loadError` at the start of every load).
        setLoadError(false);
        setPermissionDenied(false);
        // M-04: claim the newest generation for this full (re)load. A prior load
        // still in flight — e.g. from the previous project id on a same-instance
        // transition, or an overlapping projects-event refresh — becomes stale and
        // will not commit its project metadata, board data, or error state below.
        const myGen = ++loadGenRef.current;
        try {
            // Choose the resolution endpoint. A valid positive-integer id uses the
            // by-id path (the leading-slash form the existing suite asserts);
            // everything else resolves from the URL slug.
            let projectResponse: HttpResponse<KanbanProject>;
            if (isValidProjectId(projectId)) {
                projectResponse = await httpGet<KanbanProject>(
                    `/projects/${projectId}`,
                );
            } else {
                const slug = slugFromLocation();
                if (!slug) {
                    // No id and no slug → nothing resolvable yet; no network.
                    return;
                }
                projectResponse = await httpGet<KanbanProject>(
                    "projects/by_slug",
                    { slug },
                );
            }
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            const project = projectResponse.data;
            // Publish the resolved id to the ref FIRST so the loaders invoked later
            // in this same run read the real id, then to state so the render gate
            // opens and the memoised WebSocket effect recomputes with the real id.
            resolvedIdRef.current = project.id;
            setResolvedId(project.id);
            // Module gate — mirrors loadProject's is_kanban_activated check.
            if (!project.is_kanban_activated) {
                setPermissionDenied(true);
                return;
            }
            // QA-FUNC-09: restore the persisted sidebar filters + search query
            // BEFORE the first userstories/filters fetch so the board loads already
            // filtered (mirrors the AngularJS filtersMixin `applyStoredFilters`,
            // storeFiltersName "kanban-filters"). Now that the real id is known the
            // persisted state is keyed off it. Writing the refs SYNCHRONOUSLY
            // guarantees the initial `listUserstories` and `filtersData` requests
            // (which read `selectedFiltersRef` / `filterQRef`) honor the restored
            // selection; the matching `setState` calls refresh the visible filter
            // chips + search box on the next render.
            const storedFilters = loadKanbanFilters<KanbanSelectedFilter>(project.id);
            if (storedFilters) {
                selectedFiltersRef.current = storedFilters.selected;
                filterQRef.current = storedFilters.q;
                setSelectedFilters(storedFilters.selected);
                setFilterQ(storedFilters.q);
            }
            // QA-FUNC-03: restore the persisted swimlane fold modes now, and capture
            // the persisted column fold modes for the archived-override merge below
            // (port of `getSwimlanesModes` / `getStatusColumnModes`).
            const storedColumnFolds = loadColumnFolds(project.id);
            const storedSwimlaneFolds = loadSwimlaneFolds(project.id);
            if (storedSwimlaneFolds) {
                setFoldedSwimlane(storedSwimlaneFolds);
            }
            project.us_statuses = sortBy(
                (project.us_statuses as Status[] | undefined) ?? [],
                "order",
            );
            // QA-FUNC-03 + QA-FUNC-02: seed the column fold modes from the
            // persisted state (`storedColumnFolds`, falling back to the current
            // state), then force every archived status folded ON TOP so archived
            // columns always render squished on a fresh board load regardless of
            // the stored/prior mode. This mirrors the AngularJS `ctrl.initialLoad`
            // watcher, which restores `getStatusColumnModes` and then forces
            // `folds[status.id] = true` for every `is_archived` status
            // (kanban/main.coffee L797-803).
            setFolds((previous) => {
                const next = { ...(storedColumnFolds ?? previous) };
                for (const status of project.us_statuses as Status[]) {
                    if (status.is_archived) {
                        next[status.id] = true;
                    }
                }
                return next;
            });
            projectRef.current = project;
            setProjectLoaded(project);

            const [usResponse, swimlaneResponse] = await Promise.all([
                listUserstories(
                    project.id,
                    buildUserstoriesParams(
                        zoomLevelRef.current,
                        filterQRef.current,
                        selectedFiltersRef.current,
                    ),
                ),
                httpGet<Swimlane[]>("/swimlanes", { project: project.id }),
            ]);
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            const userstories =
                (usResponse.data as unknown as UserStoryModel[]) ?? [];
            // F-KANBAN-ARCHIVED-NO-LOAD: seed the base list and publish the
            // composed board. Archived columns start folded on initial load
            // (see the `is_archived` fold-forcing above), so `shownArchivedRef`
            // is empty here and the composed list equals the base list; the
            // archived stories arrive lazily on the first unfold.
            baseUserstoriesRef.current = userstories;
            kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
            kanban.setUserstories(composeBoardUserstories());
            // QA-FUNC (empty-state symmetry): manage `notFound` here exactly as
            // `reloadUserstories` (L1925) does, so the initial load and every
            // subsequent reload agree on the empty-state. A "no results" flag set
            // by a prior filtered `reloadUserstories` is cleared when a fresh
            // `loadInitialData` (Retry affordance / project refresh) restores the
            // full board (the query is dropped on load per `loadKanbanFilters`, so
            // this resolves to `false` unless a search is active). Without this the
            // stale empty-state could outlive the reload that repopulated the board.
            setNotFound(userstories.length === 0 && !!filterQRef.current);

            // Load the sidebar filter categories (auxiliary; never blocks the board).
            void loadFilters();

            // KAN-04: load the saved ("custom") filters for this project from
            // `/user-storage` (auxiliary; never blocks the board). Guarded by the
            // same generation so a slow response from an older project can't leak.
            void (async (): Promise<void> => {
                try {
                    const raw = await userStorageApi.getFilters(
                        project.id,
                        KANBAN_CUSTOM_FILTERS_SUFFIX,
                    );
                    if (!aliveRef.current || myGen !== loadGenRef.current) {
                        return;
                    }
                    setCustomFilters(storedToKanbanCustomFilters(raw));
                } catch (err) {
                    if (typeof console !== "undefined") {
                        // eslint-disable-next-line no-console
                        console.error("[taiga-react] loadCustomFilters failed", err);
                    }
                }
            })();
        } catch (err) {
            if (!aliveRef.current || myGen !== loadGenRef.current) {
                return;
            }
            // Respect blocked / archived responses (403 / 451) as permission-denied,
            // mirroring the Backlog root and `errorHandlingService.permissionDenied()`
            // (AAP §0.6.3). Any other failure surfaces the generic load error.
            if (
                err instanceof HttpError &&
                (err.status === 403 || err.status === 451)
            ) {
                setPermissionDenied(true);
            } else {
                setLoadError(true);
            }
        }
    };

    // Keep the WebSocket callbacks pointed at the latest closures.
    const reloadRef = useRef<() => void>(() => undefined);
    const refreshAllRef = useRef<() => void>(() => undefined);
    reloadRef.current = () => {
        void reloadUserstories();
    };
    refreshAllRef.current = () => {
        void loadInitialData();
    };

    // M-11: pure-trailing coalescing wrappers for the two WebSocket handlers,
    // created ONCE and reused for the socket's whole life. Each invokes the latest
    // reload/refresh closure via its ref, so a burst of events collapses into a
    // SINGLE trailing refresh once the burst settles (matching the AngularJS
    // `debounceLeading` = {leading:false, trailing:true}). `.cancel()` on teardown
    // discards any pending trailing call (timer cleanup + latest-request protection
    // across resolvedId transitions and unmount).
    const debouncedReloadRef = useRef<ReturnType<typeof debounce> | null>(null);
    if (debouncedReloadRef.current === null) {
        debouncedReloadRef.current = debounce(
            () => reloadRef.current(),
            EVENTS_DEBOUNCE_MS,
            { leading: false, trailing: true },
        );
    }
    const debouncedRefreshAllRef = useRef<ReturnType<typeof debounce> | null>(
        null,
    );
    if (debouncedRefreshAllRef.current === null) {
        debouncedRefreshAllRef.current = debounce(
            () => refreshAllRef.current(),
            EVENTS_DEBOUNCE_MS,
            { leading: false, trailing: true },
        );
    }

    useEffect(() => {
        // Fire `loadInitialData` only when there is SOMETHING to resolve — either
        // a valid positive-integer prop id, OR a slug in the URL
        // (`/project/:pslug/kanban`) that `loadInitialData` can look up via
        // `GET projects/by_slug` (QA finding — blank Kanban board). When neither is
        // present (a bare transient render) NO network / WebSocket work runs,
        // preserving the transient-NaN contract.
        if (isValidProjectId(projectId) || slugFromLocation() !== null) {
            void loadInitialData();
        }
        // Reload only when the (possibly transient NaN) projectId settles.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    // WebSocket subscription — mirrors initializeSubscription.
    //
    // F2: the subscription lifecycle depends ONLY on the stable `projectId` and
    // a boolean "project loaded" flag — NEVER on the `projectLoaded` OBJECT
    // identity. A projects-key change triggers `refreshAllRef → loadInitialData
    // → setProjectLoaded(newObject)`; keying the effect on that object reference
    // would tear the socket down and recreate it on every data refresh (churn,
    // a brief event-loss window, and re-incurring the auth-ordering path each
    // time). The AngularJS baseline uses one app-level socket that survives data
    // reloads; `projectReady` flips false→true exactly once per mount, so this
    // effect connects once and is not disturbed by subsequent refreshes.
    const projectReady = projectLoaded !== null;
    useEffect(() => {
        // Subscribe against the RESOLVED id (the real project id, whether it came
        // from the prop or the by-slug lookup), so the WebSocket keys match the
        // board data even when the host attribute was empty (QA finding — blank
        // Kanban board).
        if (!isValidProjectId(resolvedId) || !projectReady) {
            return undefined;
        }
        const client = createEventsClient();
        client.connect();
        const userstoriesKey = `changes.project.${resolvedId}.userstories`;
        const projectsKey = `changes.project.${resolvedId}.projects`;
        client.subscribe(userstoriesKey, () => {
            // M-11: coalesce bursts into a single trailing refresh.
            debouncedReloadRef.current?.();
        });
        client.subscribe(projectsKey, (data) => {
            // The matches filter runs SYNCHRONOUSLY per event (outside the
            // debounce) so a matching event within a burst is never missed just
            // because the trailing-sampled event did not match; only the
            // resulting full refresh is coalesced.
            const matches = (data as { matches?: string }).matches;
            if (
                matches === "projects.swimlane" ||
                matches === "projects.swimlaneuserstorystatus" ||
                matches === "projects.userstorystatus"
            ) {
                debouncedRefreshAllRef.current?.();
            }
        });
        return () => {
            // Cancel any pending trailing refresh before tearing the socket down
            // so it cannot fire against a stale resolvedId or after unmount.
            debouncedReloadRef.current?.cancel();
            debouncedRefreshAllRef.current?.cancel();
            client.unsubscribe(userstoriesKey);
            client.unsubscribe(projectsKey);
            client.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedId, projectReady]);

    useEffect(() => {
        // F-C: mark the root alive for the duration of the mount so async
        // resolvers (load / reload / filters / delete / bulk-create) can bail out
        // of `setState` once it unmounts.
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            if (searchTimer.current !== null) {
                clearTimeout(searchTimer.current);
            }
            // N-05: clear the single moved-card highlight timer so it cannot fire
            // `setMovedUs` after the root has unmounted.
            if (highlightTimerRef.current !== null) {
                clearTimeout(highlightTimerRef.current);
                highlightTimerRef.current = null;
            }
            // M-11: cancel any pending coalesced socket refresh on unmount (the
            // socket effect also cancels, but this guards teardown ordering).
            debouncedReloadRef.current?.cancel();
            debouncedRefreshAllRef.current?.cancel();
        };
    }, []);

    // F-001: restore document.title / meta parity with the AngularJS baseline.
    //
    // The original KanbanController set the page metadata once `loadInitialData`
    // resolved (kanban/main.coffee L117-122):
    //   title = translate.instant("KANBAN.PAGE_TITLE", {projectName})
    //   description = translate.instant("KANBAN.PAGE_DESCRIPTION",
    //                                   {projectName, projectDescription})
    //   appMetaService.setAll(title, description)
    // The React port dropped this, leaving the tab title on the static
    // index.html default ("Taiga") and — after an AngularJS → React SPA
    // transition — stale on the previous route's title.
    //
    // Keying on the RESOLVED project's `name`/`description` (stable primitives,
    // not the object identity) fires this effect exactly when the project first
    // resolves and whenever those fields genuinely change — never churning on
    // unrelated data refreshes. Because it also runs on every fresh mount, it
    // re-applies the title when the board is re-entered from another route,
    // curing the stale-title-after-SPA-transition case. `t()` reads the live,
    // shared angular-translate catalog at runtime (localized), falling back to
    // the English literal when Angular is absent.
    const kanbanProjectName = projectLoaded?.name ?? "";
    const kanbanProjectDescription =
        typeof projectLoaded?.description === "string"
            ? projectLoaded.description
            : "";
    useEffect(() => {
        if (projectLoaded === null) {
            return;
        }
        const title = t("KANBAN.PAGE_TITLE", "Kanban - {{projectName}}", {
            projectName: kanbanProjectName,
        });
        const description = t(
            "KANBAN.PAGE_DESCRIPTION",
            "The kanban panel, with user stories of the project {{projectName}}: {{projectDescription}}",
            {
                projectName: kanbanProjectName,
                projectDescription: kanbanProjectDescription,
            },
        );
        setAppMeta(title, description);
        // `projectLoaded` is read only for the null-guard; the meaningful inputs
        // are the name/description primitives, so the effect re-runs only when
        // the page metadata would actually change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kanbanProjectName, kanbanProjectDescription]);

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------

    const changeZoom = (newLevel: number): void => {
        if (newLevel === zoomLevel) {
            return;
        }
        const previous = zoomLevel;
        setZoomLevel(newLevel);
        setZoom(zoomKeysFor(newLevel));
        // Crossing into zoom > 2 needs attachments/tasks fetched.
        if (newLevel > 2 && previous <= 2) {
            void reloadUserstories(newLevel);
        }
    };

    const changeQ = (query: string): void => {
        setFilterQ(query);
        filterQRef.current = query;
        // QA-FUNC-09: persist the search query alongside the active filter
        // selection so it survives a reload (mirrors the AngularJS filtersMixin
        // which stored `q` as part of the applied filters). Persisting is
        // immediate; only the board reload below is debounced.
        saveKanbanFilters(resolvedId, {
            q: query,
            selected: selectedFiltersRef.current,
        });
        if (searchTimer.current !== null) {
            clearTimeout(searchTimer.current);
        }
        searchTimer.current = setTimeout(() => {
            searchTimer.current = null;
            void reloadUserstories(undefined, query);
        }, SEARCH_DEBOUNCE_MS);
    };

    const [bulkStatusId, setBulkStatusId] = useState<number | null>(null);

    // React-native create/edit/assign lightbox state (QA finding — the migrated
    // `kanban.jade` removed the Angular `tg-lb-create-edit` host, so the previous
    // `genericform:*` broadcasts were silent no-ops). `open` toggles the reveal
    // class; `mode` selects create vs edit; `us` is the edit target; `statusId`
    // seeds a CREATE with the clicked column; `focusAssignee` lands focus on the
    // assignee control for the card "Assign to" affordance.
    const [usLightbox, setUsLightbox] = useState<{
        open: boolean;
        mode: "create" | "edit";
        us: UserStoryModel | null;
        statusId: number | null;
        focusAssignee: boolean;
    }>({
        open: false,
        mode: "create",
        us: null,
        statusId: null,
        focusAssignee: false,
    });

    // [KAN-03] Dedicated "Select assigned user" picker state. The card action
    // "Assign to" must open the lightweight member picker (a search box + an
    // avatar member list + role-group rows + an ADD button) — the React port of
    // `changeUsAssignedUsers` (kanban/main.coffee L339) → `tg-lb-select-user` —
    // NOT the full story-edit form. `us` is the assignment target (its raw
    // `assigned_users`/`assigned_to` seed the picker's current selection).
    const [assignLightbox, setAssignLightbox] = useState<{
        open: boolean;
        us: UserStoryModel | null;
    }>({
        open: false,
        us: null,
    });

    /**
     * F1: creation now honors the requested `type` (mirrors `addNewUs`,
     * kanban/main.coffee L266-L276).
     *  - "standard" → open the React-native create form (QA finding — the Angular
     *    `tg-lb-create-edit` host was removed by the migration, so the old
     *    `genericform:new` broadcast reached no receiver). Seeded with the target
     *    `statusId` so the new story lands in the clicked column.
     *  - "bulk"     → open the React bulk lightbox (many stories from newline
     *    text via `bulk_create`).
     */
    const addNewUs = (type: "standard" | "bulk", statusId: number): void => {
        if (type === "standard") {
            setUsLightbox({
                open: true,
                mode: "create",
                us: null,
                statusId,
                focusAssignee: false,
            });
            return;
        }
        setBulkError(null);
        setBulkStatusId(statusId);
    };

    const submitBulk = (
        subjects: string,
        statusId: number,
        swimlaneId: number | null,
        position: "top" | "bottom",
    ): void => {
        // The lightbox has already validated `subjects` (QA-FUNC-07); this guard
        // is defensive only.
        if (!subjects.trim()) {
            return;
        }
        // Double-submit prevention: the lightbox now stays OPEN until the request
        // succeeds (QA-FUNC-06), so a second click while a submit is in flight
        // must be ignored (previously the synchronous close guarded this).
        if (bulkSubmittingRef.current) {
            return;
        }
        // QA-FUNC-04 "on top": capture the target column's current first story
        // BEFORE creating (the new stories are not yet in state) so the created
        // ids can be ordered ahead of it — mirrors AngularJS `moveUsToTop`
        // (kanban/main.coffee L160). Only needed for the non-default "top" case.
        const beforeFirstId =
            position === "top"
                ? firstUsInColumn(kanban.state, statusId, swimlaneId)
                : null;
        bulkSubmittingRef.current = true;
        setBulkSubmitting(true);
        setBulkError(null);
        // Use the RESOLVED project id (whether it came from the prop or the
        // by-slug lookup) for the bulk-create + reorder writes (QA finding —
        // blank Kanban board).
        const id = resolvedIdRef.current;
        // QA-FUNC-05: pass the SELECTED swimlane (defaulting to the project
        // default_swimlane on a swimlane board) instead of the previously
        // hardcoded `null`, so bulk-created stories land in the chosen swimlane.
        void bulkCreate(id, statusId, subjects, swimlaneId)
            .then((response) => {
                if (position !== "top" || beforeFirstId === null) {
                    return undefined;
                }
                const createdIds = (response.data ?? []).map((us) => us.id);
                if (createdIds.length === 0) {
                    return undefined;
                }
                // Reorder the freshly-created stories to the TOP of the column,
                // ahead of the previously-first story (mirrors moveUsToTop).
                return bulkUpdateKanbanOrder(
                    id,
                    statusId,
                    swimlaneId,
                    null,
                    beforeFirstId,
                    createdIds,
                ).then(() => undefined);
            })
            .then(() => {
                bulkSubmittingRef.current = false;
                if (!aliveRef.current) {
                    return;
                }
                setBulkSubmitting(false);
                // Close the lightbox ONLY on success, then refresh the board.
                setBulkStatusId(null);
                setBulkError(null);
                void reloadUserstories();
            })
            .catch((err: unknown) => {
                // QA-FUNC-06: on failure keep the lightbox open (do NOT clear
                // `bulkStatusId`) so the typed text is retained, and surface an
                // inline error so the user can correct and retry. Mirrors the
                // AngularJS bulk-create error handling that left the form open.
                bulkSubmittingRef.current = false;
                if (!aliveRef.current) {
                    return;
                }
                setBulkSubmitting(false);
                // [N02] Distinct error types: a rejected `fetch` with no HTTP
                // response is an offline/network failure; anything else is a
                // server rejection. Show the matching message rather than one
                // collapsed string.
                setBulkError(
                    err instanceof HttpError
                        ? BULK_SERVER_ERROR_MESSAGE
                        : BULK_OFFLINE_ERROR_MESSAGE,
                );
            });
    };

    /**
     * F3: open the React-native edit form for a single story (mirrors `editUs`,
     * kanban/main.coffee). The row model is looked up from the board state and
     * seeded into the lightbox for immediate open; the lightbox then hydrates the
     * full story detail (description via `fetchDetail`) that the light board
     * serializer omits, so a subject-only save cannot erase the stored
     * description (D-1). QA finding — the previous `genericform:edit` broadcast
     * targeted the removed Angular `tg-lb-create-edit` host and was a silent
     * no-op.
     */
    const onEditUs = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        if (!view) {
            return;
        }
        setUsLightbox({
            open: true,
            mode: "edit",
            us: view.model,
            statusId: null,
            focusAssignee: false,
        });
    };

    /**
     * [KAN-03] F3: the card's "Assign to" affordance. Ports
     * `KanbanController.changeUsAssignedUsers` (kanban/main.coffee L339), which
     * opened the `tg-lb-select-user` lightbox — a dedicated "Select assigned
     * user" picker (search box + avatar member list + role-group rows + ADD),
     * NOT the full story-edit form. The migration had temporarily routed this to
     * the edit form focused on the assignee field; this restores the dedicated
     * picker so the card action behaves and looks exactly like the AngularJS
     * baseline. The chosen ids are persisted by {@link onConfirmAssignedUsers}.
     */
    const onAssignUs = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        if (!view) {
            return;
        }
        setAssignLightbox({ open: true, us: view.model });
    };

    /**
     * [KAN-03] Persist the assignment chosen in {@link SelectUserLightbox}.
     * Ports the `changeUsAssignedUsers` `onClose(assignedUsersIds)` contract
     * (kanban/main.coffee L339-L349) exactly:
     *   - `assigned_users` becomes the chosen id set;
     *   - if the current `assigned_to` is not among them (and the set is
     *     non-empty), `assigned_to` becomes the first chosen id;
     *   - if the set is empty, `assigned_to` becomes `null`.
     * The write targets the frozen `PATCH /userstories/{id}` endpoint (carrying
     * the story `version` for optimistic-concurrency parity with every other
     * board edit), then reloads. `onConfirm` is invoked fire-and-forget by the
     * picker, so this handler never rethrows — a version conflict reconciles via
     * a reload, mirroring the legacy `patch`/409 recovery.
     */
    const onConfirmAssignedUsers = async (
        assignedUserIds: number[],
    ): Promise<void> => {
        const target = assignLightbox.us;
        // Close optimistically (the directive closed the lightbox on ADD); a
        // failed write is reconciled by the reload below.
        setAssignLightbox({ open: false, us: null });
        if (!target) {
            return;
        }
        let assignedTo: number | null =
            (target.assigned_to as number | null | undefined) ?? null;
        if (assignedUserIds.length === 0) {
            assignedTo = null;
        } else if (assignedTo == null || !assignedUserIds.includes(assignedTo)) {
            assignedTo = assignedUserIds[0];
        }
        try {
            await httpPatch(`/userstories/${target.id}`, {
                assigned_users: assignedUserIds,
                assigned_to: assignedTo,
                version: (target as { version?: number }).version,
            });
            if (!aliveRef.current) {
                return;
            }
            await reloadUserstories();
        } catch (err) {
            // A version conflict means the server advanced past our `version`;
            // reload to reconcile (the only recovery the legacy save performed).
            // The FROZEN backend signals this as HTTP 400 with a `version` body
            // (not 409), so discriminate via `isVersionConflict`. Any other error
            // leaves the board as-is.
            if (isVersionConflict(err) && aliveRef.current) {
                await reloadUserstories();
            }
        }
    };

    /**
     * [#2] Persist a NEW single story from {@link UserStoryEditLightbox}. Ports
     * the generic-form `mode == 'new'` branch, which issued ONE ATOMIC
     * `$repo.create('userstories', obj)` carrying the WHOLE form object
     * (common/lightboxes.coffee L786-790). This is a single `POST /userstories`
     * with subject + status (+ the swimlane on a swimlane board, defaulting to
     * the project `default_swimlane`) AND points/assignee/description/tags/etc.
     * all in one request — never a create followed by a separate PATCH.
     *
     * [#5] The prior `bulk_create` + follow-up `PATCH` flow left an ORPHAN story
     * persisted whenever the PATCH failed (e.g. an invalid assignee): the row was
     * already created, yet the form reported failure. The atomic create validates
     * every field before persisting anything, so a rejected create leaves NO row.
     *
     * When the user chose "on top", the created id is ordered ahead of the
     * column's current first story via `bulk_update_kanban_order` (mirrors
     * `moveUsToTop`). Then the board is re-read. Rejects on failure so the
     * lightbox keeps itself open and surfaces the error.
     */
    const onCreateUs = async (fields: UserStoryCreateFields): Promise<void> => {
        const id = resolvedIdRef.current;
        // A swimlane board seeds the project default swimlane (the single-story
        // form has no swimlane selector; the column header spans swimlanes).
        const swimlaneId =
            kanban.state.swimlanesList.length > 0
                ? projectRef.current?.default_swimlane ?? null
                : null;
        // Capture the target column's current first story BEFORE creating so a
        // "top" placement can be ordered ahead of it (mirrors moveUsToTop).
        const beforeFirstId =
            fields.position === "top"
                ? firstUsInColumn(kanban.state, fields.statusId, swimlaneId)
                : null;
        // [#5] ATOMIC single-story create — ports the generic new-story lightbox
        // `$repo.create('userstories', obj)` (common/lightboxes.coffee L786-790),
        // where the WHOLE form object is sent in ONE `POST /userstories`. The
        // previous `bulk_create` + follow-up `PATCH` flow left an ORPHAN story
        // persisted whenever the PATCH failed (e.g. an invalid assignee), because
        // the row already existed. A single create validates and applies every
        // field in one transaction, so a rejected create persists NOTHING and the
        // lightbox stays open on the error (no orphan, no spurious success toast).
        const response = await createUserstory({
            project: id,
            subject: fields.subject,
            status: fields.statusId,
            swimlane: swimlaneId,
            points: fields.points,
            assigned_to: fields.assignedTo,
            description: fields.description,
            tags: fields.tags,
            due_date: fields.due_date,
            is_blocked: fields.is_blocked,
            blocked_note: fields.blocked_note,
            team_requirement: fields.team_requirement,
            client_requirement: fields.client_requirement,
        });
        const created = response.data;
        // A "top" placement orders the freshly-created story ahead of the
        // column's previous first story (mirrors moveUsToTop). The kanban_order is
        // applied by a follow-up bulk-order call — a purely positional operation
        // that leaves the (already valid) story untouched even if it fails.
        if (fields.position === "top" && beforeFirstId !== null) {
            await bulkUpdateKanbanOrder(
                id,
                fields.statusId,
                swimlaneId,
                null,
                beforeFirstId,
                [created.id],
            );
        }
        // Upload any chosen files against the freshly-created story (ports
        // `createAttachments(data)`), then re-read the board.
        await createAttachments(created.id, fields.attachmentsToAdd);
        if (!aliveRef.current) {
            return;
        }
        await reloadUserstories();
    };

    /**
     * [#2] Persist EDITS to an existing story from {@link UserStoryEditLightbox}.
     * Ports the generic-form `mode == 'edit'` branch: `PATCH userstories/{id}`
     * with the changed fields + `version` for optimistic concurrency, then re-read
     * the board. A version conflict (the FROZEN backend signals it as HTTP 400
     * with a `version` body, not 409) reloads to pick up fresh versions; the
     * error is rethrown so the lightbox keeps itself open and surfaces the failure.
     */
    const onSaveUsEdit = async (
        target: UserStoryModel,
        changes: UserStoryEditChanges,
    ): Promise<void> => {
        try {
            await httpPatch(`/userstories/${target.id}`, {
                subject: changes.subject,
                status: changes.status,
                points: changes.points,
                assigned_to: changes.assigned_to,
                // D-1: include `description` ONLY when the lightbox marked it
                // authoritative (loaded from detail / row) or user-edited. When
                // `undefined`, omit it entirely so a subject-only edit cannot
                // overwrite the stored description with an empty string.
                ...(changes.description !== undefined
                    ? { description: changes.description }
                    : {}),
                tags: changes.tags,
                due_date: changes.due_date,
                is_blocked: changes.is_blocked,
                blocked_note: changes.blocked_note,
                team_requirement: changes.team_requirement,
                client_requirement: changes.client_requirement,
                version: (target as { version?: number }).version,
            });
            // Reproduce the CoffeeScript submit order: save → deleteAttachments →
            // createAttachments. Deletions first so a delete+re-add of the same
            // file name cannot race.
            await deleteAttachments(changes.attachmentsToDelete);
            await createAttachments(target.id, changes.attachmentsToAdd);
            if (!aliveRef.current) {
                return;
            }
            await reloadUserstories();
        } catch (err) {
            if (isVersionConflict(err)) {
                await reloadUserstories();
            }
            throw err;
        }
    };

    /**
     * Upload each pending file as an attachment of user story `objectId`, against
     * the frozen `/userstories/attachments` endpoint (ports `createAttachments`).
     * Sequential to keep ordering deterministic and avoid a burst of parallel
     * multipart uploads.
     */
    const createAttachments = async (
        objectId: number,
        files: File[],
    ): Promise<void> => {
        const projectId = resolvedIdRef.current;
        for (const file of files) {
            await uploadUserstoryAttachment(file, objectId, projectId);
        }
    };

    /** Delete each queued attachment id (ports `deleteAttachments`). */
    const deleteAttachments = async (ids: number[]): Promise<void> => {
        for (const attachmentId of ids) {
            await deleteUserstoryAttachment(attachmentId);
        }
    };

    /**
     * Hydrate a story's existing attachments for the edit form. The board list
     * endpoint omits the attachments array, so the lightbox calls this on open
     * (against the frozen `/userstories/attachments` list endpoint).
     */
    const fetchUsAttachments = async (
        usId: number,
    ): Promise<UserStoryAttachment[]> => {
        const response = await listUserstoryAttachments(
            usId,
            resolvedIdRef.current,
        );
        return response.data ?? [];
    };

    /**
     * D-1: hydrate a story's FULL detail for the edit form. The board LIST
     * endpoint uses a light serializer that OMITS `description`, so the lightbox
     * calls this on edit-open (against the frozen `GET /userstories/{id}`) to
     * populate the Description field and make a subject-only save safe. Ports the
     * AngularJS `editUs` re-fetch (kanban/main.coffee).
     */
    const fetchUsDetail = async (usId: number): Promise<UserStoryModel> => {
        const response = await getUserstory(usId);
        return response.data as unknown as UserStoryModel;
    };

    /**
     * F2: append the chosen option to the active selection (deduped), reflect it
     * immediately, then reload the board (filtered) and regenerate the category
     * counts with the fresh selection. Mirrors `addFilter` (kanban/main.coffee).
     */
    const addFilter = (
        category: KanbanFilterCategory,
        option: KanbanFilterOption,
    ): void => {
        const current = selectedFiltersRef.current;
        const exists = current.some(
            (f) => f.dataType === category.dataType && String(f.id) === String(option.id),
        );
        if (exists) {
            return;
        }
        const added: KanbanSelectedFilter = {
            id: option.id,
            name: option.name,
            dataType: category.dataType,
            // KAN-04: attach the current include/exclude mode so the selection
            // round-trips to the correct `<dataType>` / `exclude_<dataType>` param.
            mode: filterModeRef.current,
            ...(option.color !== undefined ? { color: option.color } : {}),
        };
        const next = [...current, added];
        selectedFiltersRef.current = next;
        setSelectedFilters(next);
        // A manual selection clears the applied saved-filter highlight (parity
        // with filter.controller.coffee `selectFilter` → activeCustomFilter = null).
        setActiveCustomFilter(null);
        // QA-FUNC-09: persist the updated filter selection (with the current
        // search query) so it survives a reload (port of `storeFilters`).
        saveKanbanFilters(resolvedId, { q: filterQRef.current, selected: next });
        void reloadUserstories();
        void loadFilters(next);
    };

    /** F2: drop a selected filter and reload. Mirrors `removeFilter`. */
    const removeFilter = (filter: KanbanSelectedFilter): void => {
        const current = selectedFiltersRef.current;
        const next = current.filter(
            (f) => !(f.dataType === filter.dataType && String(f.id) === String(filter.id)),
        );
        selectedFiltersRef.current = next;
        setSelectedFilters(next);
        setActiveCustomFilter(null);
        // QA-FUNC-09: persist the reduced filter selection (port of
        // `storeFilters`).
        saveKanbanFilters(resolvedId, { q: filterQRef.current, selected: next });
        void reloadUserstories();
        void loadFilters(next);
    };

    /* -- Custom (saved) filters — KAN-04 ----------------------------------- */

    /**
     * Port of `saveCustomFilter` (controllerMixins.coffee L201-L214): snapshot
     * the current selection into a param map, merge it under `name`, and persist
     * the whole map back to `/user-storage` under the kanban suffix.
     */
    const saveCustomFilter = (name: string): void => {
        const id = resolvedIdRef.current;
        if (!Number.isInteger(id) || id <= 0) {
            return;
        }
        const paramMap = selectedToStoredMap(selectedFiltersRef.current);
        void (async (): Promise<void> => {
            try {
                const existing = await userStorageApi.getFilters(
                    id,
                    KANBAN_CUSTOM_FILTERS_SUFFIX,
                );
                const nextStore: StoredCustomFilters = { ...existing, [name]: paramMap };
                await userStorageApi.storeFilters(
                    id,
                    nextStore,
                    KANBAN_CUSTOM_FILTERS_SUFFIX,
                );
                if (!aliveRef.current) {
                    return;
                }
                setCustomFilters(storedToKanbanCustomFilters(nextStore));
            } catch (err) {
                if (typeof console !== "undefined") {
                    // eslint-disable-next-line no-console
                    console.error("[taiga-react] saveCustomFilter failed", err);
                }
            }
        })();
    };

    /**
     * Port of `selectCustomFilter` (controllerMixins.coffee L197-L200): replace
     * the whole selection with the saved filter's stored params, then reload.
     */
    const selectCustomFilter = (filter: KanbanCustomFilter): void => {
        const nextSelected = reconstructSelectedFromParamMap(
            filter.filter ?? {},
            filters,
        );
        selectedFiltersRef.current = nextSelected;
        setSelectedFilters(nextSelected);
        setActiveCustomFilter(filter.id);
        saveKanbanFilters(resolvedId, {
            q: filterQRef.current,
            selected: nextSelected,
        });
        void reloadUserstories();
        void loadFilters(nextSelected);
    };

    /**
     * Port of `removeCustomFilter` (controllerMixins.coffee L216-L221): drop the
     * saved filter from the stored map and persist (DELETE when it becomes
     * empty). The current selection is left untouched.
     */
    const removeCustomFilter = (filter: KanbanCustomFilter): void => {
        const id = resolvedIdRef.current;
        if (!Number.isInteger(id) || id <= 0) {
            return;
        }
        void (async (): Promise<void> => {
            try {
                const existing = await userStorageApi.getFilters(
                    id,
                    KANBAN_CUSTOM_FILTERS_SUFFIX,
                );
                const nextStore: StoredCustomFilters = { ...existing };
                delete nextStore[String(filter.id)];
                await userStorageApi.storeFilters(
                    id,
                    nextStore,
                    KANBAN_CUSTOM_FILTERS_SUFFIX,
                );
                if (!aliveRef.current) {
                    return;
                }
                setActiveCustomFilter((prev) => (prev === filter.id ? null : prev));
                setCustomFilters(storedToKanbanCustomFilters(nextStore));
            } catch (err) {
                if (typeof console !== "undefined") {
                    // eslint-disable-next-line no-console
                    console.error("[taiga-react] removeCustomFilter failed", err);
                }
            }
        })();
    };

    const foldStatus = (status: Status): void => {
        const nextFolded = !folds[status.id];
        const next = { ...folds, [status.id]: nextFolded };
        setFolds(next);
        // QA-FUNC-03: persist the column fold modes so the squish/unfold state
        // survives a reload (port of `storeStatusColumnModes`).
        saveColumnFolds(resolvedId, next);
        setUnfold(nextFolded ? null : status.id);

        // F-KANBAN-ARCHIVED-NO-LOAD: an ARCHIVED column loads its stories lazily
        // on unfold and drops them on fold. The base board request keeps
        // `status__is_archived:false`, so without this the archived column would
        // stay permanently empty. Live (non-archived) columns are unaffected —
        // their stories are always present from the base load, so folding/
        // unfolding them is a pure view toggle.
        if (status.is_archived) {
            if (nextFolded) {
                // Folding: forget this archived status's stories and recompose
                // the board so its cards disappear (mirrors the legacy re-hide).
                if (shownArchivedRef.current[status.id] !== undefined) {
                    delete shownArchivedRef.current[status.id];
                    kanban.setUserstories(composeBoardUserstories());
                }
            } else {
                // Unfolding: fetch this archived status's stories and merge them.
                void loadArchivedStatus(status.id);
            }
        }
    };

    const toggleSwimlane = (swimlaneId: number): void => {
        const next = {
            ...foldedSwimlane,
            [swimlaneId]: !foldedSwimlane[swimlaneId],
        };
        setFoldedSwimlane(next);
        // QA-FUNC-03: persist the swimlane fold modes (port of
        // `storeSwimlanesModes`).
        saveSwimlaneFolds(resolvedId, next);
    };

    /**
     * [M-12] OPEN (unfold) a folded swimlane during a drag-hover, and persist
     * the change. Wired to `KanbanBoard.onRequestOpenSwimlane`, which the
     * `Swimlane` invokes after ~1s of hovering a FOLDED swimlane title while a
     * card is being dragged — the port of `mouseoverSwimlane`'s
     * `$timeout(... ctrl.toggleSwimlane(swimlaneId), 1000)` (kanban/main.coffee
     * L1173-L1179). Unlike {@link toggleSwimlane} this ONLY opens (never folds),
     * so a spurious repeat hover cannot re-close a swimlane the user just opened;
     * it is a no-op when the swimlane is already open. The fold modes are
     * persisted through the same `saveSwimlaneFolds` path as a manual toggle.
     */
    const openSwimlane = (swimlaneId: number): void => {
        if (!foldedSwimlane[swimlaneId]) {
            // Already open — nothing to do (no state churn, no persist).
            return;
        }
        const next = { ...foldedSwimlane, [swimlaneId]: false };
        setFoldedSwimlane(next);
        saveSwimlaneFolds(resolvedId, next);
    };

    const handleToggleFold = (usId: number): void => {
        kanban.toggleFold(usId);
    };

    /**
     * [N-03] The ACTUAL deletion, extracted from the old `handleDeleteUs` body so
     * the themed {@link ConfirmDialog} can drive it. Ports the AngularJS
     * `deleteUserStory` success/error branches (kanban/main.coffee L308-314):
     * `DELETE /userstories/{id}` then reload on success; on failure surface the
     * error notification and SKIP the reload so the (still-present) card stays on
     * the board (QA-FUNC-14). Never rethrows, so the dialog always closes after.
     */
    const performDeleteUs = async (usId: number): Promise<void> => {
        try {
            await httpDelete(`/userstories/${usId}`);
            if (!aliveRef.current) {
                return;
            }
            await reloadUserstories();
        } catch {
            // QA-FUNC-14: mirror the AngularJS `deleteUserStory` error branch
            // (`promise.then null, -> @confirm.notify("error")`,
            // kanban/main.coffee L313-314). Surface an error notification and
            // SKIP the reload so the (still-present) card stays on the board.
            if (!aliveRef.current) {
                return;
            }
            setErrorNotice(NOTIFY_ERROR_MESSAGE);
        }
    };

    /**
     * [N-03] Card "delete" action: open the themed confirmation dialog instead
     * of the browser-native `window.confirm`. Ports `$tgConfirm.askOnDelete(...)`
     * (common/confirm.coffee L122). The subject is read from the board state so
     * the dialog message can name the story being deleted.
     */
    const handleDeleteUs = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        const subject = view?.model.subject ?? "";
        setDeleteConfirm({ open: true, us: { id: usId, subject }, busy: false });
    };

    /** [N-03] Confirm handler for the delete dialog: run the delete, then close. */
    const handleConfirmDelete = async (): Promise<void> => {
        const target = deleteConfirm.us;
        if (!target) {
            return;
        }
        setDeleteConfirm((s) => ({ ...s, busy: true }));
        await performDeleteUs(target.id);
        if (aliveRef.current) {
            setDeleteConfirm({ open: false, us: null, busy: false });
        }
    };

    /** [N-03] Cancel handler for the delete dialog: close without deleting. */
    const handleCancelDelete = (): void => {
        setDeleteConfirm({ open: false, us: null, busy: false });
    };

    const isArchivedHidden = (usId: number): boolean => {
        const state = kanban.state;
        const view = state.usMap[usId];
        if (!view) {
            return false;
        }
        const statusId = view.model.status;
        return (
            state.archivedStatus.indexOf(statusId) !== -1 &&
            state.statusHide.indexOf(statusId) !== -1
        );
    };

    const showPlaceholder = (statusId: number, swimlaneId: number | null): boolean => {
        const project = projectRef.current;
        const statuses = (project?.us_statuses as Status[] | undefined) ?? [];
        if (!statuses.length) {
            return false;
        }
        const firstStatus =
            statuses[0].id === statusId &&
            kanban.state.userstoriesRaw.length === 0;
        if (swimlaneId !== null && kanban.state.swimlanesList.length) {
            return firstStatus && kanban.state.swimlanesList[0].id === swimlaneId;
        }
        return firstStatus;
    };

    // -----------------------------------------------------------------------
    // Multi-select (QA-FUNC-01)
    // -----------------------------------------------------------------------

    // Toggle a single card's membership in the selection (ctrl/meta-click),
    // mirroring `toggleSelectedUs` (main.coffee L109-110). A deselected card is
    // removed from the map so it only ever holds truthy entries.
    const toggleSelectedUs = (usId: number): void => {
        setSelectedUss((previous) => {
            const next = { ...previous };
            if (next[usId]) {
                delete next[usId];
            } else {
                next[usId] = true;
            }
            return next;
        });
    };

    // The active selection as an id list (map keys with a truthy value), handed
    // to `resolveKanbanDrop` so a drag of any selected card moves the whole group.
    const selectedIdList = Object.keys(selectedUss)
        .filter((key) => selectedUss[Number(key)])
        .map(Number);

    // -----------------------------------------------------------------------
    // Drag and drop
    // -----------------------------------------------------------------------

    const resolveDrop = (event: NormalizedDragEnd): ResolvedDrop | null =>
        resolveKanbanDrop(kanban.state, event, selectedIdList);

    const persist = (
        resolved: ResolvedDrop,
        neighbors: DropNeighbors,
    ): Promise<void> => {
        // Multi-select group drag (QA-FUNC-01): clear the card selection on EVERY
        // drop, mirroring legacy `moveUs` which called `cleanSelectedUss()` as its
        // first line (kanban/main.coffee L597) — before persistence and regardless
        // of success/failure. `resolved.draggedIds` was already captured upstream
        // (resolveDrop -> resolveKanbanDrop) from the pre-clear `selectedIdList`,
        // so clearing here cannot shrink the group being moved; it simply ensures
        // the highlight/selection does not outlive the drag. On a rollback the
        // stories return to their prior positions but the selection stays cleared,
        // exactly as the legacy board behaved.
        setSelectedUss({});
        const { statusId, swimlaneId } = parseContainerKey(
            resolved.target.containerKey,
        );
        const apiSwimlane =
            swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : swimlaneId;

        // M-05: snapshot the board BEFORE the optimistic mutation. `kanban.state`
        // is an immer-frozen immutable value, so holding the reference captures
        // the exact pre-move board to restore if persistence fails.
        const snapshot = kanban.state;

        // Optimistic local reorder (immer producer).
        kanban.move(
            resolved.draggedIds,
            statusId,
            apiSwimlane,
            neighbors.previous,
            neighbors.next,
        );
        setMovedUs(resolved.draggedIds);
        // N-05: a single highlight timer — clear any prior one before scheduling
        // the replacement so rapid successive moves cannot leave competing timers
        // racing to blank `movedUs`.
        if (highlightTimerRef.current !== null) {
            clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
            highlightTimerRef.current = null;
            setMovedUs([]);
        }, MOVED_HIGHLIGHT_MS);

        // Persist to the frozen REST contract, keyed off the RESOLVED project id
        // (whether it came from the prop or the by-slug lookup).
        return bulkUpdateKanbanOrder(
            resolvedIdRef.current,
            statusId,
            apiSwimlane,
            neighbors.previous,
            neighbors.next,
            resolved.draggedIds,
        )
            .then(() => undefined)
            .catch(() => {
                // M-05: on rejection, roll the board back to the snapshot, clear
                // the transient highlight (and its timer), and surface the shared
                // error toast — mirroring the AngularJS drag failure path that
                // reverted the optimistic move and called `$tgConfirm.notify`.
                // Resolve (do not rethrow) so the fire-and-forget drag handler
                // never produces an unhandled rejection (aligns with M-03).
                if (!aliveRef.current) {
                    return;
                }
                kanban.restore(snapshot);
                if (highlightTimerRef.current !== null) {
                    clearTimeout(highlightTimerRef.current);
                    highlightTimerRef.current = null;
                }
                setMovedUs([]);
                setErrorNotice(NOTIFY_ERROR_MESSAGE);
            });
    };

    /**
     * [M-13] Move a card to the TOP of its column — port of the legacy
     * `moveToTopDropdown` -> `moveUsToTop` -> `moveUs(null, [us], status,
     * swimlane, 0, null, nextUsId)` chain (kanban/main.coffee L157-L185).
     *
     * The legacy code found the FIRST card currently in the column
     * (`userstories.get(0)`) and reordered the moved card to sit before it, via
     * the same `bulk_update_kanban_order` endpoint the drag path uses. Here the
     * ordered container lists come from {@link buildContainerIndex}. Two guards
     * implement the finding's "first-card / no-op gating": if the card is not on
     * the board, or is already at index 0 of its column (so there is no distinct
     * "first" card to move before), the action is a no-op — no optimistic
     * mutation and no network call. Otherwise the move is applied optimistically
     * and rolled back with the shared error toast on persistence failure,
     * exactly like {@link persist} (M-05).
     */
    const handleMoveToTop = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        if (!view) {
            return;
        }
        const containerIndex = buildContainerIndex(kanban.state);
        const location = containerIndex.containerOf[usId];
        if (!location || location.index === 0) {
            // Card is unknown, or already the first in its column -> no-op.
            return;
        }
        const orderedIds = containerIndex.listOf[location.key] ?? [];
        const firstId = orderedIds.length > 0 ? orderedIds[0] : null;
        if (firstId === null || firstId === usId) {
            return;
        }
        const { statusId, swimlaneId } = parseContainerKey(location.key);
        const apiSwimlane =
            swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : swimlaneId;

        // Multi-select group drag (QA-FUNC-01): the move-to-top action routes
        // through the same legacy `moveUs` path (`moveUsToTop -> moveUs`,
        // main.coffee L157-185/L596), which cleared the selection first. Clear it
        // here too so the two reorder paths behave identically.
        setSelectedUss({});

        // M-05-style snapshot for rollback (immer-frozen immutable reference).
        const snapshot = kanban.state;

        // Optimistic reorder: move `usId` to the top, i.e. BEFORE the current
        // first card (previousCard = null, nextCard = firstId), matching
        // `moveUs(..., 0, null, nextUsId)`.
        kanban.move([usId], statusId, apiSwimlane, null, firstId);
        setMovedUs([usId]);
        if (highlightTimerRef.current !== null) {
            clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
            highlightTimerRef.current = null;
            setMovedUs([]);
        }, MOVED_HIGHLIGHT_MS);

        void bulkUpdateKanbanOrder(
            resolvedIdRef.current,
            statusId,
            apiSwimlane,
            null,
            firstId,
            [usId],
        )
            .then(() => undefined)
            .catch(() => {
                if (!aliveRef.current) {
                    return;
                }
                kanban.restore(snapshot);
                if (highlightTimerRef.current !== null) {
                    clearTimeout(highlightTimerRef.current);
                    highlightTimerRef.current = null;
                }
                setMovedUs([]);
                setErrorNotice(NOTIFY_ERROR_MESSAGE);
            });
    };

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    if (permissionDenied) {
        // QA-FUNC-10: render a VISIBLE explanatory message (title + text) rather
        // than an empty section. Uses a dedicated, className-driven wrapper that
        // — like the (QA-praised) `.kanban-load-error` message — renders legibly
        // with default browser styling (React-owned class, no injected <style>).
        // A DISTINCT class (not `.kanban-load-error`) keeps the permission-denied
        // state cleanly separable from the generic 500 load-error state.
        return (
            <main className="main kanban permission-denied">
                <div className="kanban-permission-denied-message" role="alert">
                    <h1>{PERMISSION_DENIED_TITLE}</h1>
                    <p>{PERMISSION_DENIED_TEXT}</p>
                </div>
            </main>
        );
    }

    const project = projectLoaded;
    const swimlaneMode = kanban.state.swimlanesList.length > 0;
    // QA-FUNC-11: mirror AngularJS `projectService.canEdit(add_us)` — which is
    // `!isArchived() && hasPermission()` (project.service.coffee L108-110). An
    // archived project (truthy `archived_code`) disables the add-us affordances,
    // exactly like the `tg-check-permission="add_us"` directive (common.coffee
    // L87-90 -> canEdit) that gated the AngularJS add buttons.
    const canAddUs =
        !!project &&
        !project.archived_code &&
        Array.isArray(project.my_permissions) &&
        project.my_permissions.indexOf("add_us") !== -1;

    // [#2] Assignable users for the create/edit lightbox's assignee control,
    // derived from the already-loaded `userstories-filters` "assigned_users"
    // category (id = user id, name = display name). This reuses the AAP-enumerated
    // filters endpoint rather than introducing a new members request. The
    // synthetic "Unassigned" entry (id === null / "null") is dropped — the
    // lightbox offers its own "Not assigned" option.
    const assignableUsers: AssignableUser[] = (() => {
        const category = filters.find((c) => c.dataType === "assigned_users");
        if (!category) {
            return [];
        }
        return category.content
            .filter((option) => option.id !== null && String(option.id) !== "null")
            .map((option) => ({ id: Number(option.id), name: option.name }))
            .filter((user) => Number.isInteger(user.id));
    })();

    // [KAN-03] The "Select assigned user" picker needs the FULL member records
    // (avatar seed + role) that the filter-derived `assignableUsers` above lacks.
    // Port `fillUsersAndRoles` (controllerMixins.coffee L22-L24): the active
    // members sorted by display name. Roles are all `project.roles` (id + name);
    // the picker itself hides any role that contributes no member, matching the
    // Jade `ng-if="item.type != 'role' || item.userIds.length"`.
    const assignActiveUsers: BaseUser[] = ((project?.members ?? []) as BaseUser[])
        .filter((member) => member.is_active)
        .slice()
        .sort((a, b) =>
            (a.full_name_display || "").localeCompare(b.full_name_display || ""),
        );
    const assignRoles: SelectUserRole[] = (
        (project?.roles ?? []) as Array<{ id: number; name: string }>
    ).map((role) => ({ id: role.id, name: role.name }));

    return (
        <main className={"main kanban" + (swimlaneMode ? " swimlane" : "")}>
            <div className="kanban-header">
                <header>
                    <h1>
                        <span>{SECTION_NAME}</span>
                    </h1>
                </header>
                <div className="taskboard-actions">
                    <div className="kanban-table-options-start">
                        <button
                            type="button"
                            className={
                                "btn-filter e2e-open-filter" +
                                (openFilter ? " active" : "")
                            }
                            onClick={() => setOpenFilter(!openFilter)}
                        >
                            <Icon name="icon-filters" />
                            <span className="text">
                                {openFilter ? "Hide filters" : "Filters"}
                            </span>
                            {/* KAN-04: active-filter count badge (parity with the
                              * Backlog toggle's `.selected-filters`). */}
                            {selectedFilters.length > 0 ? (
                                <span className="selected-filters">
                                    {selectedFilters.length}
                                </span>
                            ) : null}
                        </button>
                        {/*
                          * tg-input-search: a real custom element (styled by tag
                          * name in input-search.component.scss — position:relative
                          * host with an absolutely-positioned magnifier). Rendered
                          * via createElement so we don't augment JSX.IntrinsicElements
                          * (matching the Icon/Svg precedent). No `class` is needed on
                          * the host — the SCSS targets the tag — so the React-18
                          * className->class caveat for custom elements does not apply.
                          */}
                        {createElement(
                            "tg-input-search",
                            null,
                            <input
                                key="search-input"
                                id={SEARCH_INPUT_ID}
                                name={SEARCH_INPUT_NAME}
                                className="kanban-search e2e-search"
                                type="search"
                                value={filterQ}
                                placeholder={SEARCH_PLACEHOLDER}
                                aria-label={SEARCH_ARIA_LABEL}
                                onChange={(event) => changeQ(event.target.value)}
                            />,
                            <Icon key="search-icon" name="icon-search" />,
                        )}
                    </div>
                    <div className="kanban-table-options-end">
                        <div className="board-zoom">
                            <div className="board-zoom-title">{ZOOM_TITLE}</div>
                            {[0, 1, 2, 3].map((level) => (
                                <label
                                    key={level}
                                    className="zoom-radio"
                                    title={ZOOM_LABELS[level]}
                                >
                                    <input
                                        type="radio"
                                        name="kanban-board-zoom"
                                        value={level}
                                        checked={zoomLevel === level}
                                        onChange={() => changeZoom(level)}
                                    />
                                    <div className="checkmark">
                                        <span>{ZOOM_LABELS[level]}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className={"kanban-manager" + (!openFilter ? " expanded" : "")}>
                {openFilter ? (
                    <KanbanFilterPanel
                        filters={filters}
                        selectedFilters={selectedFilters}
                        customFilters={customFilters}
                        activeCustomFilter={activeCustomFilter}
                        filterMode={filterMode}
                        onSetFilterMode={setFilterMode}
                        onAddFilter={addFilter}
                        onRemoveFilter={removeFilter}
                        onSaveCustomFilter={saveCustomFilter}
                        onSelectCustomFilter={selectCustomFilter}
                        onRemoveCustomFilter={removeCustomFilter}
                    />
                ) : null}

                {loadError ? (
                    // [N10] Explicit, recoverable load-error surface. The message
                    // itself was already QA-praised; the added Retry button turns
                    // the previous dead-end "no-action" state into a recoverable
                    // one that re-runs the initial load (which clears `loadError`
                    // on entry) rather than forcing a full browser reload.
                    <div className="kanban-load-error" role="alert">
                        <p>{LOAD_ERROR_TEXT}</p>
                        <button
                            type="button"
                            className="button button-green"
                            onClick={() => void loadInitialData()}
                        >
                            {RETRY_LABEL}
                        </button>
                    </div>
                ) : null}

                {/* [N10] Initial load still in flight — no project resolved yet and
                    no load error. Render an in-board loading indicator instead of a
                    blank board region, matching the global `tgLoader` spinner the
                    AngularJS Kanban showed during initial load. */}
                {!project && !loadError ? (
                    <div className="loading-spinner" role="status" aria-live="polite" />
                ) : null}

                {errorNotice ? (
                    <KanbanNotification
                        message={errorNotice}
                        onClose={() => setErrorNotice(null)}
                    />
                ) : null}

                {project ? (
                    <KanbanBoard
                        state={kanban.state}
                        project={project}
                        zoom={zoom}
                        zoomLevel={zoomLevel}
                        folds={folds}
                        unfold={unfold}
                        foldedSwimlane={foldedSwimlane}
                        movedUs={movedUs}
                        selectedUss={selectedUss}
                        canAddUs={canAddUs}
                        isArchivedHidden={isArchivedHidden}
                        showPlaceholder={showPlaceholder}
                        notFound={notFound}
                        resolveDrop={resolveDrop}
                        persist={persist}
                        onAddUs={addNewUs}
                        onFoldStatus={foldStatus}
                        onToggleSwimlane={toggleSwimlane}
                        onRequestOpenSwimlane={openSwimlane}
                        onToggleFold={handleToggleFold}
                        onClickEdit={onEditUs}
                        onClickAssignedTo={onAssignUs}
                        onClickDelete={handleDeleteUs}
                        onClickMoveToTop={handleMoveToTop}
                        onToggleSelect={toggleSelectedUs}
                    />
                ) : null}
            </div>

            {bulkStatusId !== null && project ? (
                <BulkLightbox
                    statuses={project.us_statuses ?? []}
                    initialStatusId={bulkStatusId}
                    swimlanes={kanban.state.swimlanesList}
                    defaultSwimlaneId={project.default_swimlane ?? null}
                    swimlaneMode={
                        !!project.is_kanban_activated &&
                        kanban.state.swimlanesList.length > 0
                    }
                    hasUnclassified={hasUnclassifiedStories(kanban.state)}
                    onSubmit={submitBulk}
                    onClose={() => {
                        setBulkStatusId(null);
                        setBulkError(null);
                    }}
                    error={bulkError}
                    submitting={bulkSubmitting}
                />
            ) : null}

            {/*
              * [#2] React-native single-story create/edit/assign form. Mounted
              * only while open — matching the sibling `BulkLightbox` mount pattern
              * above (so a closed form never leaves a hidden subject field in the
              * DOM nor an `autoFocus` that could steal focus on board load). The
              * `open` class still drives the SCSS reveal. Persistence is delegated
              * to `onCreateUs` / `onSaveUsEdit`, which talk only to the frozen
              * `/api/v1/` endpoints (`bulk_create` + `PATCH`).
              */}
            {usLightbox.open && project ? (
                <UserStoryEditLightbox
                    open={usLightbox.open}
                    mode={usLightbox.mode}
                    project={project}
                    us={usLightbox.us}
                    initialStatusId={usLightbox.statusId}
                    focusAssignee={usLightbox.focusAssignee}
                    assignableUsers={assignableUsers}
                    onCreate={onCreateUs}
                    onEdit={onSaveUsEdit}
                    fetchAttachments={fetchUsAttachments}
                    fetchDetail={fetchUsDetail}
                    onClose={() =>
                        setUsLightbox((prev) => ({ ...prev, open: false }))
                    }
                />
            ) : null}

            {/* [KAN-03] The dedicated "Select assigned user" picker opened by the
                card "Assign to" action. `currentUsers` seeds the selection from
                the target story's `assigned_users` ∪ `assigned_to` (the
                CoffeeScript `_.compact(_.union(item.assigned_users,
                [item.assigned_to]))`, kanban/main.coffee L341). Mounted only
                while open AND a project is loaded (so member/role props are
                populated), mirroring the edit-lightbox guard above. */}
            {assignLightbox.open && project ? (
                <SelectUserLightbox
                    open={assignLightbox.open}
                    activeUsers={assignActiveUsers}
                    roles={assignRoles}
                    currentUsers={
                        assignLightbox.us
                            ? Array.from(
                                  new Set([
                                      ...(((
                                          assignLightbox.us
                                              .assigned_users as
                                              | number[]
                                              | undefined
                                      ) ?? []) as number[]),
                                      ...(assignLightbox.us.assigned_to != null
                                          ? [
                                                assignLightbox.us
                                                    .assigned_to as number,
                                            ]
                                          : []),
                                  ]),
                              )
                            : []
                    }
                    onConfirm={onConfirmAssignedUsers}
                    onCancel={() =>
                        setAssignLightbox({ open: false, us: null })
                    }
                />
            ) : null}

            {/* [N-03] Themed delete-confirmation dialog, replacing the native
                window.confirm. Ports `$tgConfirm.askOnDelete(...)`:
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
