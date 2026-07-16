/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement, useEffect, useRef, useState } from "react";
import sortBy from "lodash/sortBy";
import { httpDelete, httpGet, HttpError } from "../shared/api/httpClient";
import type { QueryParams } from "../shared/api/httpClient";
import {
    bulkCreate,
    bulkUpdateKanbanOrder,
    filtersData,
    listUserstories,
} from "../shared/api/userstories";
import { createEventsClient } from "../shared/events/websocket";
import type {
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "../shared/dnd/DndProvider";
import { KanbanBoard } from "./KanbanBoard";
import { Icon } from "../shared/ui/Icon";
import { buildContainerKey } from "./KanbanColumn";
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

// Section title (KANBAN.SECTION_NAME) rendered in the board header — the SCREEN
// name, not the project name (the project name is owned by the surrounding
// AngularJS `tg-project-menu`). Ported from `mainTitle.jade` (header > h1 > span).
const SECTION_NAME = "Kanban";

// Board-zoom control labels (ZOOM.TITLE + ZOOM.ZOOM-1..4), ported from
// `board-zoom.jade` / `board-zoom.scss`. Index === zoom level (0-3).
const ZOOM_TITLE = "Zoom:";
const ZOOM_LABELS: ReadonlyArray<string> = [
    "Compact",
    "Default",
    "Detailed",
    "Expanded",
];

// Search affordance (COMMON.FILTERS.INPUT_PLACEHOLDER), ported from the
// `tgInputSearch` component. `aria-label` is added for accessibility (QA-A11Y-01)
// without altering the visual placeholder text.
const SEARCH_PLACEHOLDER = "subject or reference";
const SEARCH_ARIA_LABEL = "Search by subject or reference";
const SEARCH_INPUT_ID = "kanban-search-input";
const SEARCH_INPUT_NAME = "kanban-search";

// Error-notification copy — ported from the AngularJS `$tgConfirm.notify("error")`
// path (common/confirm.coffee: NOTIFICATION_MSG.error -> NOTIFICATION.WARNING /
// NOTIFICATION.WARNING_TEXT, and NOTIFICATION.CLOSE for the dismiss control).
// The React roots cannot call the Angular `$tgConfirm` service, so the same copy
// is surfaced through an in-board, className-driven banner (no injected <style>).
const NOTIFY_ERROR_TITLE = "Oops, something went wrong...";
const NOTIFY_ERROR_MESSAGE = "Your changes were not saved!";
const NOTIFY_CLOSE_LABEL = "Close notification";

// Permission-denied copy (QA-FUNC-10) — ported verbatim from the AngularJS
// permission-denied page (`app/partials/error/permission-denied.jade`) and the
// locale strings it references: ERROR.PERMISSION_DENIED / ERROR.PERMISSION_DENIED_TEXT
// (locale-en.json L1500-1501). The board renders a VISIBLE message for the
// permission-denied / module-off / 403 / 451 states instead of a blank section,
// mirroring the (QA-praised) `.kanban-load-error` visible-message pattern.
const PERMISSION_DENIED_TITLE = "Permission denied";
const PERMISSION_DENIED_TEXT =
    "You don't have permission to access this page.";

// Bulk-create lightbox copy (QA-FUNC-04) — ported verbatim from
// `lightbox-us-bulk.jade` and the locale strings it references: COMMON.NEW_BULK,
// LIGHTBOX.CREATE_EDIT.{SELECT_STATUS,LOCATION,CREATE_BOTTOM,CREATE_TOP,
// SELECT_SWIMLANE,DEFAULT}, KANBAN.UNCLASSIFIED_USER_STORIES, COMMON.ONE_ITEM_LINE
// and COMMON.SAVE. The lightbox reproduces the same DOM/class names so the
// compiled `lightbox.scss` themes it unchanged (no injected <style>).
const BULK_TITLE = "New bulk insert";
const BULK_SELECT_STATUS = "Select status";
const BULK_LOCATION = "Location";
const BULK_CREATE_BOTTOM = "at the bottom";
const BULK_CREATE_TOP = "on top";
const BULK_SELECT_SWIMLANE = "Select swimlane";
const BULK_DEFAULT_SWIMLANE = "Default";
const BULK_UNCLASSIFIED = "Unclassified user stories";
const BULK_PLACEHOLDER = "One item per line...";
const BULK_SAVE = "Save";

// Bulk-textarea validation (QA-FUNC-07) — the AngularJS lightbox wired two
// `checksley` validators on the textarea: `data-required="true"` and
// `data-linewidth="200"`. The latter is the custom validator registered in
// app.coffee (L907): every line must be strictly shorter than the width, i.e.
// `line.length < 200`. The messages are the exact COMMON.FORM_ERRORS strings.
const BULK_LINE_WIDTH = 200;
const BULK_ERROR_REQUIRED = "This value is required.";
const BULK_ERROR_LINEWIDTH =
    "One or more lines is perhaps too long. Try to keep under " +
    BULK_LINE_WIDTH +
    " characters.";

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
        return BULK_ERROR_REQUIRED;
    }
    const lines = text.split(/\r\n|\r|\n/);
    const anyTooLong = lines.some((line) => line.length >= BULK_LINE_WIDTH);
    if (anyTooLong) {
        return BULK_ERROR_LINEWIDTH;
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
    color?: string;
}

type KanbanFilters = KanbanFilterCategory[];

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
        const key = filter.dataType;
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
 * The one unavoidable coupling to AngularJS: dispatch a `$rootScope` broadcast
 * so the SURVIVING generic-form lightbox still opens. `common/lightboxes.coffee`
 * handles `genericform:new` (L622) and `genericform:edit` (L638) — those events
 * are owned by a COMMON module that is NOT part of the migrated Kanban
 * controller, so the bridge remains valid. SAFE NO-OP when Angular / its
 * injector is absent (e.g. under jsdom in unit tests) because the whole body is
 * guarded.
 */
function broadcastToAngular(name: string, payload: unknown): void {
    try {
        const ng = (
            window as unknown as {
                angular?: {
                    element: (d: Document) => {
                        injector: () => {
                            get: (s: string) => {
                                $broadcast: (n: string, p: unknown) => void;
                                $applyAsync: () => void;
                            };
                        };
                    };
                };
            }
        ).angular;
        if (!ng) {
            return; // no-op in jsdom / tests
        }
        const rootScope = ng.element(document).injector().get("$rootScope");
        rootScope.$broadcast(name, payload);
        rootScope.$applyAsync();
    } catch {
        /* no-op when Angular / injector is absent */
    }
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
    onAddFilter: (category: KanbanFilterCategory, option: KanbanFilterOption) => void;
    onRemoveFilter: (filter: KanbanSelectedFilter) => void;
}

function KanbanFilterPanel(props: KanbanFilterPanelProps): JSX.Element {
    const { filters, selectedFilters, onAddFilter, onRemoveFilter } = props;
    const isSelected = (dataType: string, id: string): boolean =>
        selectedFilters.some(
            (f) => f.dataType === dataType && String(f.id) === String(id),
        );

    return (
        <div className="kanban-filter" id="kanban-filter">
            {selectedFilters.length > 0 ? (
                <div className="filters-applied">
                    {selectedFilters.map((filter) => (
                        <button
                            type="button"
                            key={`${filter.dataType}:${filter.id}`}
                            className="filter-applied"
                            onClick={() => onRemoveFilter(filter)}
                            title="Remove filter"
                        >
                            <span className="name">{filter.name}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="filters-cats">
                {filters.map((category) => (
                    <div
                        className="filter-category"
                        key={category.dataType}
                        data-type={category.dataType}
                    >
                        <h4 className="filters-title">{category.title}</h4>
                        <ul className="filter-list">
                            {category.content.map((option) => {
                                const selected = isSelected(
                                    category.dataType,
                                    option.id,
                                );
                                return (
                                    <li
                                        key={String(option.id)}
                                        className={
                                            "single-filter" +
                                            (selected ? " active" : "")
                                        }
                                    >
                                        <button
                                            type="button"
                                            className="filter-name"
                                            onClick={() =>
                                                selected
                                                    ? onRemoveFilter({
                                                          id: option.id,
                                                          name: option.name,
                                                          dataType: category.dataType,
                                                          color: option.color,
                                                      })
                                                    : onAddFilter(category, option)
                                            }
                                        >
                                            {option.color ? (
                                                <span
                                                    className="color-bullet"
                                                    style={{ background: option.color }}
                                                />
                                            ) : null}
                                            <span className="name">{option.name}</span>
                                            {typeof option.count === "number" ? (
                                                <span className="number">
                                                    {option.count}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
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

    const currentStatus =
        statuses.find((status) => status.id === statusId) ?? statuses[0];
    const currentSwimlane =
        swimlaneId === null
            ? null
            : swimlanes.find((swimlane) => swimlane.id === swimlaneId) ?? null;
    const showSwimlaneSelector = swimlaneMode && swimlanes.length > 0;
    const shownError = validationError ?? error ?? null;

    const handleSubmit = (): void => {
        const message = validateBulkText(text);
        if (message !== null) {
            setValidationError(message);
            return;
        }
        setValidationError(null);
        onSubmit(text, statusId, swimlaneId, position);
    };

    return (
        <div className="lightbox lightbox-generic-bulk open">
            <div className="lightbox-us-bulk">
                <button
                    type="button"
                    className="close lightbox-close e2e-bulk-close"
                    aria-label={NOTIFY_CLOSE_LABEL}
                    title={NOTIFY_CLOSE_LABEL}
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
                    <h2 className="title">{BULK_TITLE}</h2>

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
                            className="btn-small js-submit-button e2e-bulk-submit"
                            title={BULK_SAVE}
                        >
                            {BULK_SAVE}
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

    // Sidebar filter state (F2). `filters` are the five category widgets built
    // from `filters_data`; `selectedFilters` are the user's active choices and
    // feed every `listUserstories` request via `pickSelectedFilterParams`.
    const [filters, setFilters] = useState<KanbanFilters>([]);
    const [selectedFilters, setSelectedFilters] = useState<KanbanSelectedFilter[]>(
        [],
    );

    const projectRef = useRef<KanbanProject | null>(null);
    const zoomLevelRef = useRef(zoomLevel);
    const filterQRef = useRef(filterQ);
    const selectedFiltersRef = useRef(selectedFilters);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // In-flight guard for the bulk-create submit — preserves the double-submit
    // prevention (QA verified PASS) now that the lightbox closes only on success
    // (QA-FUNC-06), not synchronously at submit time.
    const bulkSubmittingRef = useRef<boolean>(false);
    // Unmount guard: async resolvers must not `setState` after the root has been
    // unmounted (F-C). Mirrors the Backlog root's `aliveRef` pattern.
    const aliveRef = useRef<boolean>(true);
    zoomLevelRef.current = zoomLevel;
    filterQRef.current = filterQ;
    selectedFiltersRef.current = selectedFilters;

    // -----------------------------------------------------------------------
    // Data loading (deferred until projectId is finite)
    // -----------------------------------------------------------------------

    const reloadUserstories = async (
        levelOverride?: number,
        queryOverride?: string,
    ): Promise<void> => {
        const project = projectRef.current;
        if (!Number.isFinite(projectId) || !project) {
            return;
        }
        const level = levelOverride ?? zoomLevelRef.current;
        const query = queryOverride ?? filterQRef.current;
        const [usResponse, swimlaneResponse] = await Promise.all([
            listUserstories(
                projectId,
                buildUserstoriesParams(level, query, selectedFiltersRef.current),
            ),
            httpGet<Swimlane[]>("/swimlanes", { project: projectId }),
        ]);
        if (!aliveRef.current) {
            return;
        }
        const userstories = (usResponse.data as unknown as UserStoryModel[]) ?? [];
        kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
        kanban.setUserstories(userstories);
        // Multi-select group drag (QA-FUNC-01): clear the card selection whenever
        // the board reloads, mirroring `cleanSelectedUss` (main.coffee L597) so a
        // stale selection cannot outlive the cards it referenced.
        setSelectedUss({});
        setNotFound(userstories.length === 0 && !!query);
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
        if (!Number.isFinite(projectId)) {
            return;
        }
        const selected = overrideSelected ?? selectedFiltersRef.current;
        try {
            const response = await filtersData({
                project: projectId,
                ...pickSelectedFilterParams(selected),
            });
            if (!aliveRef.current) {
                return;
            }
            setFilters(buildKanbanFilterCategories(response.data));
        } catch {
            /* filters are auxiliary; a failure must not blank the board */
        }
    };

    const loadInitialData = async (): Promise<void> => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        // QA-FUNC-09: restore the persisted sidebar filters + search query
        // BEFORE the first userstories/filters fetch so the board loads already
        // filtered (mirrors the AngularJS filtersMixin `applyStoredFilters`,
        // storeFiltersName "kanban-filters"). Writing the refs SYNCHRONOUSLY
        // guarantees the initial `listUserstories` and `filtersData` requests
        // (which read `selectedFiltersRef` / `filterQRef`) honor the restored
        // selection; the matching `setState` calls refresh the visible filter
        // chips + search box on the next render.
        const storedFilters = loadKanbanFilters<KanbanSelectedFilter>(projectId);
        if (storedFilters) {
            selectedFiltersRef.current = storedFilters.selected;
            filterQRef.current = storedFilters.q;
            setSelectedFilters(storedFilters.selected);
            setFilterQ(storedFilters.q);
        }
        // QA-FUNC-03: restore the persisted swimlane fold modes now, and capture
        // the persisted column fold modes for the archived-override merge below
        // (port of `getSwimlanesModes` / `getStatusColumnModes`).
        const storedColumnFolds = loadColumnFolds(projectId);
        const storedSwimlaneFolds = loadSwimlaneFolds(projectId);
        if (storedSwimlaneFolds) {
            setFoldedSwimlane(storedSwimlaneFolds);
        }
        try {
            const projectResponse = await httpGet<KanbanProject>(
                `/projects/${projectId}`,
            );
            if (!aliveRef.current) {
                return;
            }
            const project = projectResponse.data;
            // Module gate — mirrors loadProject's is_kanban_activated check.
            if (!project.is_kanban_activated) {
                setPermissionDenied(true);
                return;
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
                    projectId,
                    buildUserstoriesParams(
                        zoomLevelRef.current,
                        filterQRef.current,
                        selectedFiltersRef.current,
                    ),
                ),
                httpGet<Swimlane[]>("/swimlanes", { project: projectId }),
            ]);
            if (!aliveRef.current) {
                return;
            }
            const userstories =
                (usResponse.data as unknown as UserStoryModel[]) ?? [];
            kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
            kanban.setUserstories(userstories);

            // Load the sidebar filter categories (auxiliary; never blocks the board).
            void loadFilters();
        } catch (err) {
            if (!aliveRef.current) {
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

    useEffect(() => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        void loadInitialData();
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
        if (!Number.isFinite(projectId) || !projectReady) {
            return undefined;
        }
        const client = createEventsClient();
        client.connect();
        const userstoriesKey = `changes.project.${projectId}.userstories`;
        const projectsKey = `changes.project.${projectId}.projects`;
        client.subscribe(userstoriesKey, () => {
            reloadRef.current();
        });
        client.subscribe(projectsKey, (data) => {
            const matches = (data as { matches?: string }).matches;
            if (
                matches === "projects.swimlane" ||
                matches === "projects.swimlaneuserstorystatus" ||
                matches === "projects.userstorystatus"
            ) {
                refreshAllRef.current();
            }
        });
        return () => {
            client.unsubscribe(userstoriesKey);
            client.unsubscribe(projectsKey);
            client.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, projectReady]);

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
        };
    }, []);

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
        saveKanbanFilters(projectId, {
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

    /**
     * F1: creation now honors the requested `type` (mirrors `addNewUs`,
     * kanban/main.coffee L266-L276).
     *  - "standard" → dispatch `genericform:new` so the SURVIVING generic
     *    user-story form opens (handled by `common/lightboxes.coffee` L622),
     *    seeded with the target `statusId` (and `project`) so the new story
     *    lands in the clicked column.
     *  - "bulk"     → open the React bulk lightbox (many stories from newline
     *    text via `bulk_create`).
     */
    const addNewUs = (type: "standard" | "bulk", statusId: number): void => {
        if (type === "standard") {
            broadcastToAngular("genericform:new", {
                objType: "us",
                project: projectRef.current,
                statusId,
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
        setBulkError(null);
        // QA-FUNC-05: pass the SELECTED swimlane (defaulting to the project
        // default_swimlane on a swimlane board) instead of the previously
        // hardcoded `null`, so bulk-created stories land in the chosen swimlane.
        void bulkCreate(projectId, statusId, subjects, swimlaneId)
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
                    projectId,
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
                // Close the lightbox ONLY on success, then refresh the board.
                setBulkStatusId(null);
                setBulkError(null);
                void reloadUserstories();
            })
            .catch(() => {
                // QA-FUNC-06: on failure keep the lightbox open (do NOT clear
                // `bulkStatusId`) so the typed text is retained, and surface an
                // inline error so the user can correct and retry. Mirrors the
                // AngularJS bulk-create error handling that left the form open.
                bulkSubmittingRef.current = false;
                if (!aliveRef.current) {
                    return;
                }
                setBulkError(NOTIFY_ERROR_MESSAGE);
            });
    };

    /**
     * F3: open the SURVIVING generic edit form for a single story (mirrors
     * `editUs`, kanban/main.coffee). The row model is looked up from the board
     * state and handed to the AngularJS lightbox via `genericform:edit`
     * (handled by `common/lightboxes.coffee` L638).
     */
    const onEditUs = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        if (!view) {
            return;
        }
        const project = projectRef.current;
        broadcastToAngular("genericform:edit", {
            objType: "us",
            obj: view.model,
            statusList: (project?.us_statuses as Status[] | undefined) ?? [],
            attachments: [],
        });
    };

    /**
     * F3: the card's "Assign to" affordance. The AngularJS quick-assign picker
     * was bound to the now-deleted controller (`changeUsAssignedUsers` via
     * `lightboxFactory`) and has no surviving broadcast bridge, so — consistent
     * with the Backlog root, which routes every story-field edit through the
     * generic form — assignment opens the same generic edit form, focused on the
     * assignee field. `focusField` is an inert hint for the AngularJS side
     * (unknown payload keys are ignored by `genericform` `getSchema`).
     */
    const onAssignUs = (usId: number): void => {
        const view = kanban.state.usMap[usId];
        if (!view) {
            return;
        }
        const project = projectRef.current;
        broadcastToAngular("genericform:edit", {
            objType: "us",
            obj: view.model,
            statusList: (project?.us_statuses as Status[] | undefined) ?? [],
            attachments: [],
            focusField: "assigned_to",
        });
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
            ...(option.color !== undefined ? { color: option.color } : {}),
        };
        const next = [...current, added];
        selectedFiltersRef.current = next;
        setSelectedFilters(next);
        // QA-FUNC-09: persist the updated filter selection (with the current
        // search query) so it survives a reload (port of `storeFilters`).
        saveKanbanFilters(projectId, { q: filterQRef.current, selected: next });
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
        // QA-FUNC-09: persist the reduced filter selection (port of
        // `storeFilters`).
        saveKanbanFilters(projectId, { q: filterQRef.current, selected: next });
        void reloadUserstories();
        void loadFilters(next);
    };

    const foldStatus = (status: Status): void => {
        const nextFolded = !folds[status.id];
        const next = { ...folds, [status.id]: nextFolded };
        setFolds(next);
        // QA-FUNC-03: persist the column fold modes so the squish/unfold state
        // survives a reload (port of `storeStatusColumnModes`).
        saveColumnFolds(projectId, next);
        setUnfold(nextFolded ? null : status.id);
    };

    const toggleSwimlane = (swimlaneId: number): void => {
        const next = {
            ...foldedSwimlane,
            [swimlaneId]: !foldedSwimlane[swimlaneId],
        };
        setFoldedSwimlane(next);
        // QA-FUNC-03: persist the swimlane fold modes (port of
        // `storeSwimlanesModes`).
        saveSwimlaneFolds(projectId, next);
    };

    const handleToggleFold = (usId: number): void => {
        kanban.toggleFold(usId);
    };

    const handleDeleteUs = (usId: number): void => {
        if (
            typeof window !== "undefined" &&
            typeof window.confirm === "function" &&
            !window.confirm("Delete this user story?")
        ) {
            return;
        }
        void httpDelete(`/userstories/${usId}`)
            .then(() => {
                if (!aliveRef.current) {
                    return;
                }
                void reloadUserstories();
            })
            .catch(() => {
                // QA-FUNC-14: mirror the AngularJS `deleteUserStory` error branch
                // (`promise.then null, -> @confirm.notify("error")`,
                // kanban/main.coffee L313-314). Surface an error notification and
                // SKIP the reload so the (still-present) card stays on the board.
                if (!aliveRef.current) {
                    return;
                }
                setErrorNotice(NOTIFY_ERROR_MESSAGE);
            });
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
        const { statusId, swimlaneId } = parseContainerKey(
            resolved.target.containerKey,
        );
        const apiSwimlane =
            swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : swimlaneId;

        // Optimistic local reorder (immer producer).
        kanban.move(
            resolved.draggedIds,
            statusId,
            apiSwimlane,
            neighbors.previous,
            neighbors.next,
        );
        setMovedUs(resolved.draggedIds);
        window.setTimeout(() => setMovedUs([]), MOVED_HIGHLIGHT_MS);

        // Persist to the frozen REST contract.
        return bulkUpdateKanbanOrder(
            projectId,
            statusId,
            apiSwimlane,
            neighbors.previous,
            neighbors.next,
            resolved.draggedIds,
        ).then(() => undefined);
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
            <section className="main kanban permission-denied">
                <div className="kanban-permission-denied-message" role="alert">
                    <h1>{PERMISSION_DENIED_TITLE}</h1>
                    <p>{PERMISSION_DENIED_TEXT}</p>
                </div>
            </section>
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

    return (
        <section className={"main kanban" + (swimlaneMode ? " swimlane" : "")}>
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
                        onAddFilter={addFilter}
                        onRemoveFilter={removeFilter}
                    />
                ) : null}

                {loadError ? (
                    <div className="kanban-load-error">Unable to load the board.</div>
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
                        onToggleFold={handleToggleFold}
                        onClickEdit={onEditUs}
                        onClickAssignedTo={onAssignUs}
                        onClickDelete={handleDeleteUs}
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
                />
            ) : null}
        </section>
    );
}
