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
 *   - The two React lightboxes (bulk user stories + sprint add/edit). The
 *     shared generic-form lightbox stays in AngularJS and is reached through
 *     the `broadcastToAngular` bridge.
 *
 * This is the NAMED export consumed by `../index.tsx`
 * (`import { BacklogApp } from "./backlog/BacklogApp"`), which registers the
 * `<tg-react-backlog>` custom element.
 *
 * TRANSIENT-NaN CONTRACT: the host element reads `Number(this.dataset.projectId)`
 * and AngularJS may resolve `data-project-id="{{project.id}}"` AFTER the first
 * `connectedCallback`, so `projectId` can be `NaN` on the first render. EVERY
 * network call and the WebSocket connect are therefore DEFERRED until
 * `Number.isFinite(projectId)` and re-run when a finite id arrives (see the
 * effect in Phase H).
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
import moment from "moment";

import type {
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
import { httpGet, httpPatch, httpDelete, HttpError } from "../shared/api/httpClient";
import type { QueryParams } from "../shared/api/httpClient";
import * as userstoriesApi from "../shared/api/userstories";
import * as milestonesApi from "../shared/api/milestones";
import { createEventsClient } from "../shared/events/websocket";
import {
    DndProvider,
    isDragEnabled,
    createBacklogPersister,
} from "../shared/dnd/DndProvider";
import type { NormalizedDragEnd, ResolvedDrop, DropNeighbors } from "../shared/dnd/DndProvider";

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
 * Legacy localStorage key for the burndown-collapsed flag. The AngularJS key
 * came from `generateHash(["is-burndown-grpahs-collapsed"])`; the misspelling
 * "grpahs" is preserved verbatim for parity (the exact hashing is approximated
 * with a stable, project-agnostic key here).
 */
const BURNDOWN_COLLAPSED_KEY = "is-burndown-grpahs-collapsed";

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

/** Per-project localStorage key for the show-tags preference. */
function showTagsKey(projectId: number): string {
    return `showTags-${projectId}`;
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
            .flatMap((s) => s.user_stories)
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
    categories.push({ title: "Status", dataType: "status", content: status });

    // Tags — `it.id = it.name`.
    const tags: FilterOption[] = asRawItems(data.tags).map((it) => ({
        id: readString(it.name),
        name: readString(it.name),
        color: readColor(it),
        count: readCount(it),
    }));
    categories.push({ title: "Tags", dataType: "tags", content: tags });

    // Assigned to — `it.id ? id.toString() : "null"`, `name = full_name || "Unassigned"`.
    const assigned: FilterOption[] = asRawItems(data.assigned_users).map((it) => ({
        id: it.id != null ? String(it.id) : "null",
        name: readString(it.full_name) || "Unassigned",
        count: readCount(it),
    }));
    categories.push({ title: "Assigned to", dataType: "assigned_users", content: assigned });

    // Role — `it.id ? id.toString() : "null"`, `name = name || "Unassigned"`.
    const role: FilterOption[] = asRawItems(data.roles).map((it) => ({
        id: it.id != null ? String(it.id) : "null",
        name: readString(it.name) || "Unassigned",
        count: readCount(it),
    }));
    categories.push({ title: "Role", dataType: "role", content: role });

    // Created by (owner) — `it.id = id.toString()`, `name = full_name`.
    const owner: FilterOption[] = asRawItems(data.owners).map((it) => ({
        id: String(it.id),
        name: readString(it.full_name),
        count: readCount(it),
    }));
    categories.push({ title: "Created by", dataType: "owner", content: owner });

    // Epic — with-id: `name = "#{ref} {subject}"`; no-id: id "null", "Not in an epic".
    const epic: FilterOption[] = asRawItems(data.epics).map((it) => {
        if (it.id != null) {
            return {
                id: String(it.id),
                name: `#${readString(it.ref, String(it.ref))} ${readString(it.subject)}`.trim(),
                count: readCount(it),
            };
        }
        return { id: "null", name: "Not in an epic", count: readCount(it) };
    });
    categories.push({ title: "Epic", dataType: "epic", content: epic });

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
 * The one unavoidable coupling to AngularJS: dispatch a `$rootScope` broadcast
 * so the surviving generic-form lightbox (single user-story edit / new-standard
 * create) still opens. It is a SAFE NO-OP when Angular / its injector is absent
 * (e.g. under jsdom in unit tests), because the whole body is guarded.
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

/** Diagnostic logger for recoverable failures (never throws). */
function reportError(context: string, error: unknown): void {
    if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.error(`[taiga-react] ${context}`, error);
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

/* -------------------------------------------------------------------------- */
/* BacklogFilterPanel — in-board reimplementation of the shared `tg-filter`    */
/* -------------------------------------------------------------------------- */

interface BacklogFilterPanelProps {
    filters: Filters;
    selectedFilters: SelectedFilter[];
    onAddFilter: (category: FilterCategory, option: FilterOption) => void;
    onRemoveFilter: (filter: SelectedFilter) => void;
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

function BacklogFilterPanel(props: BacklogFilterPanelProps): JSX.Element {
    const { filters, selectedFilters, onAddFilter, onRemoveFilter } = props;

    const isSelected = useCallback(
        (dataType: string, id: Id | string): boolean =>
            selectedFilters.some(
                (f) => f.dataType === dataType && String(f.id) === String(id),
            ),
        [selectedFilters],
    );

    return (
        <div className="backlog-filter" id="backlog-filter">
            {selectedFilters.length > 0 && (
                <div className="filters-applied">
                    {selectedFilters.map((filter) => (
                        <button
                            type="button"
                            key={`${filter.dataType}:${filter.id}`}
                            className={`filter-applied${filter.mode === "exclude" ? " exclude" : ""}`}
                            onClick={() => onRemoveFilter(filter)}
                            title="Remove filter" /* i18n: COMMON.FILTERS.REMOVE */
                        >
                            <span className="name">{filter.name}</span>
                        </button>
                    ))}
                </div>
            )}

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
                                const selected = isSelected(category.dataType, option.id);
                                return (
                                    <li
                                        key={String(option.id)}
                                        className={`single-filter${selected ? " active" : ""}`}
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
                                            {option.color && (
                                                <span
                                                    className="color-bullet"
                                                    style={{ background: option.color }}
                                                />
                                            )}
                                            <span className="name">{option.name}</span>
                                            {typeof option.count === "number" && (
                                                <span className="number">{option.count}</span>
                                            )}
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
        setFilterQ,
        setForecasting,
        applyMovedUserstories,
        removeUserStory,
        restoreUserstories,
        patchUserStory,
        setSelection,
        setNewUs,
        toggleShowTags: bsToggleShowTags,
        toggleActiveFilters: bsToggleActiveFilters,
        toggleVelocityForecasting: bsToggleVelocityForecasting,
    } = bs;

    // Local component state NOT owned by the board-state hook.
    const [project, setProject] = useState<Project | null>(null);
    const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [burndownCollapsed, setBurndownCollapsed] = useState<boolean>(() =>
        readStoredBoolean(BURNDOWN_COLLAPSED_KEY),
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

    // Refs that mirror the latest render values so the memoised async callbacks
    // never read a stale closure (the controller relied on a live `@scope`).
    const aliveRef = useRef<boolean>(true);
    const stateRef = useRef(state);
    stateRef.current = state;
    const projectRef = useRef<Project | null>(project);
    projectRef.current = project;
    const closedVisibleRef = useRef<boolean>(closedSprintsVisible);
    closedVisibleRef.current = closedSprintsVisible;

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

    /* ---------------------------------------------------------------------- */
    /* Phase B — data loaders (ALL guarded by Number.isFinite(projectId))      */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of `loadProject` (main.coffee L469). Resolves the project payload and
     * gates the whole screen: a project without `is_backlog_activated`, or a
     * 403/451 (blocked / archived) response, sets `permissionDenied`. Returns
     * `true` only when the backlog may proceed to load.
     */
    const loadProject = useCallback(async (): Promise<boolean> => {
        if (!Number.isFinite(projectId)) {
            return false;
        }
        try {
            const res = await httpGet<Project>(`projects/${projectId}`);
            if (!aliveRef.current) {
                return false;
            }
            setProject(res.data);
            if (!res.data.is_backlog_activated) {
                // Port `errorHandlingService.permissionDenied()`.
                setPermissionDenied(true);
                return false;
            }
            return true;
        } catch (err) {
            if (!aliveRef.current) {
                return false;
            }
            // Respect blocked / archived responses (403 / 451) as permission-denied.
            if (err instanceof HttpError && (err.status === 403 || err.status === 451)) {
                setPermissionDenied(true);
            } else {
                // i18n: BACKLOG.ERROR_LOADING_BACKLOG (generic load failure).
                setLoadError("The backlog could not be loaded.");
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
        if (!Number.isFinite(projectId)) {
            return;
        }
        try {
            const res = await httpGet<ProjectStats>(`projects/${projectId}/stats`);
            if (!aliveRef.current) {
                return;
            }
            setStats(res.data);
        } catch (err) {
            reportError("loadProjectStats failed", err);
        }
    }, [projectId, setStats]);

    /**
     * Port of `loadSprints` (main.coffee L304): open sprints (`{closed:false}`),
     * `totalMilestones = open + closed`. The hook sorts each sprint's stories by
     * `sprint_order` and derives `currentSprint`.
     */
    const loadSprints = useCallback(async (): Promise<void> => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        try {
            const result = await milestonesApi.list(projectId, { closed: false });
            if (!aliveRef.current) {
                return;
            }
            const open = Number.isNaN(result.open) ? result.milestones.length : result.open;
            const closed = Number.isNaN(result.closed) ? 0 : result.closed;
            setSprints(result.milestones as unknown as Sprint[], open, closed);
        } catch (err) {
            reportError("loadSprints failed", err);
        }
    }, [projectId, setSprints]);

    /** Port of `loadClosedSprints` (main.coffee L281): closed sprints (`{closed:true}`). */
    const loadClosedSprints = useCallback(async (): Promise<void> => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        try {
            const result = await milestonesApi.list(projectId, { closed: true });
            if (!aliveRef.current) {
                return;
            }
            const closed = Number.isNaN(result.closed) ? result.milestones.length : result.closed;
            setClosedSprints(result.milestones as unknown as Sprint[], closed);
        } catch (err) {
            reportError("loadClosedSprints failed", err);
        }
    }, [projectId, setClosedSprints]);

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
            if (!Number.isFinite(projectId)) {
                return;
            }
            const s = stateRef.current;
            const q = opts.q !== undefined ? opts.q : s.filterQ;
            const selected = opts.selected !== undefined ? opts.selected : s.selectedFilters;
            const requestPage = opts.reset ? 1 : pageRef.current;

            setLoadingUserstories(true);

            const params: QueryParams = {
                project: projectId,
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
                if (!aliveRef.current) {
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
                if (!aliveRef.current) {
                    return;
                }
                setLoadingUserstories(false);
                reportError("loadUserstories failed", err);
            }
        },
        [projectId, setLoadingUserstories, appendUserstories],
    );

    /**
     * Port of `generateFilters` (controllerMixins.coffee L229): fetch the
     * filters metadata (scoped to the backlog + current selection) and build the
     * six category widgets. Selected/custom filters are preserved.
     */
    const loadFilters = useCallback(
        async (overrideSelected?: SelectedFilter[]): Promise<void> => {
            if (!Number.isFinite(projectId)) {
                return;
            }
            const s = stateRef.current;
            // Callers that just mutated the selection pass it explicitly so the
            // freshly-computed counts reflect it (state update is async).
            const selected =
                overrideSelected !== undefined ? overrideSelected : s.selectedFilters;
            try {
                const res = await userstoriesApi.filtersData({
                    project: projectId,
                    milestone: "null",
                    ...pickSelectedFilterParams(selected),
                });
                if (!aliveRef.current) {
                    return;
                }
                const categories = buildFilterCategories(res.data);
                setFilters(categories, s.customFilters, selected);
            } catch (err) {
                reportError("loadFilters failed", err);
            }
        },
        [projectId, setFilters],
    );

    /** Port of `loadBacklog` (main.coffee L410): stats + sprints + first US page in parallel. */
    const loadBacklog = useCallback(async (): Promise<void> => {
        await Promise.all([loadProjectStats(), loadSprints(), loadUserstories({ reset: true })]);
    }, [loadProjectStats, loadSprints, loadUserstories]);

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
        if (!Number.isFinite(projectId)) {
            return;
        }
        const client = createEventsClient();
        eventsRef.current = client;
        client.connect();

        client.subscribe(`changes.project.${projectId}.userstories`, () => {
            void loadUserstories({ reset: true });
            void loadSprints();
        });

        client.subscribe(
            `changes.project.${projectId}.milestones`,
            () => {
                void loadSprints();
                void loadClosedSprints();
                void loadProjectStats();
            },
            { selfNotification: true },
        );
    }, [projectId, loadUserstories, loadSprints, loadClosedSprints, loadProjectStats]);

    /**
     * Port of `loadInitialData` (main.coffee L488): project → subscription →
     * backlog → filters, then flag first-load-complete. Restores the persisted
     * show-tags preference before loading (port of the `getShowTags` check).
     */
    const loadInitialData = useCallback(async (): Promise<void> => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        const ok = await loadProject();
        if (!aliveRef.current || !ok) {
            return;
        }

        initializeSubscription();

        // Restore the persisted show-tags preference (port of `getShowTags`).
        try {
            const stored = window.localStorage.getItem(showTagsKey(projectId));
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
        setFirstLoadComplete(true);
    }, [projectId, loadProject, initializeSubscription, loadBacklog, loadFilters, setFirstLoadComplete, bsToggleShowTags]);

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
            // Dropped over another row → land at that row's position.
            const overLoc = locateUs(overId, userstories, sprints, closedSprints);
            if (!overLoc) {
                return null;
            }
            targetKey = overLoc.containerKey;
            const base = overLoc.ids.filter((id) => id !== draggedId);
            const k = base.indexOf(overId);
            dropIndex = k === -1 ? base.length : k;
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
            const persister = createBacklogPersister(projectId);

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
                reportError("drag order persistence failed", err);
            }
        },
        [projectId, applyMovedUserstories, patchUserStory, loadSprints, loadProjectStats, loadClosedSprints],
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
                    projectId,
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
                reportError("move-to-top failed", err);
            }
        },
        [projectId, applyMovedUserstories, patchUserStory, loadSprints, loadProjectStats],
    );

    /* ---------------------------------------------------------------------- */
    /* Phase F — mutation handlers                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Port of `editUserStory` (main.coffee L653) via the generic-form bridge. In
     * AngularJS the controller re-fetched the story by ref + its attachments;
     * here the row `us` is passed through and the shared AngularJS lightbox
     * re-fetches as needed. Safe no-op under jsdom (no Angular).
     */
    const onEditUserStory = useCallback((us: UserStory): void => {
        // i18n bridge event: "genericform:edit".
        broadcastToAngular("genericform:edit", { objType: "us", obj: us, attachments: [] });
    }, []);

    /**
     * Port of `deleteUserStory` (main.coffee L662): confirm, optimistically
     * remove, DELETE, reload stats + sprints; restore on failure.
     */
    const onDeleteUserStory = useCallback(
        async (us: UserStory): Promise<void> => {
            // i18n: US.TITLE_DELETE_MESSAGE {subject}.
            const message = `Delete the user story "${us.subject}"?`;
            if (!window.confirm(message)) {
                return;
            }

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
                reportError("deleteUserStory failed", err);
            }
        },
        [removeUserStory, restoreUserstories, loadProjectStats, loadSprints],
    );

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
                    reportError("changeStatus failed", err);
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
                    reportError("changePoints failed", err);
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
            broadcastToAngular("genericform:new", { objType: "us", project: projectRef.current });
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
                project: projectId,
            },
            lastSprintName: lastSprint ? lastSprint.name : null,
            canDelete: false,
        });
    }, [projectId]);

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
                    project: projectId,
                },
                lastSprintName: null,
                canDelete,
            });
        },
        [projectId],
    );

    /** After a create/edit/delete sprint: close the lightbox and reload. */
    const onSprintChanged = useCallback(async (): Promise<void> => {
        setSprintLightbox((s) => ({ ...s, open: false }));
        await Promise.all([loadSprints(), loadClosedSprints(), loadProjectStats()]);
    }, [loadSprints, loadClosedSprints, loadProjectStats]);

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

            if (position === "top" && created.length) {
                const createdIds = created.map((u) => u.id);
                const existing = stateRef.current.userstories.filter(
                    (u) => !createdIds.includes(u.id),
                );
                const nextUs = existing.length ? existing[0].id : undefined;
                if (nextUs !== undefined) {
                    try {
                        await userstoriesApi.bulkUpdateBacklogOrder(
                            projectId,
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
                        reportError("bulk move-to-top failed", err);
                    }
                }
            }
        },
        [setNewUs, projectId, loadUserstories, loadProjectStats],
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
     * the preference under a per-project key. The exact legacy key came from
     * `generateHash(["showTags", projectId])`; it is approximated here as
     * `showTags-{projectId}` (documented in {@link showTagsKey}).
     */
    const toggleShowTags = useCallback((): void => {
        const next = !stateRef.current.showTags;
        bsToggleShowTags();
        writeStoredBoolean(showTagsKey(projectId), next);
    }, [projectId, bsToggleShowTags]);

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
            const added: SelectedFilter = {
                id: option.id,
                name: option.name,
                dataType: category.dataType,
                ...(option.color !== undefined ? { color: option.color } : {}),
            };
            const nextSelected = [...s.selectedFilters, added];
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
            setFilters(s.filters, s.customFilters, nextSelected);
            void loadUserstories({ reset: true, selected: nextSelected });
            void loadFilters(nextSelected);
        },
        [setFilters, loadUserstories, loadFilters],
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
            if (!Number.isFinite(projectId)) {
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
                await userstoriesApi.bulkUpdateMilestone(projectId, targetSprint.id, bulkStories);
                if (!aliveRef.current) {
                    return;
                }
                await loadBacklog();
                if (!aliveRef.current) {
                    return;
                }
                if (closedVisibleRef.current) {
                    await loadClosedSprints();
                }
            } catch (err) {
                reportError("moveSelectedToSprint failed", err);
            }
        },
        [projectId, loadBacklog, loadClosedSprints],
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
     * Mount / project-change effect. Guards the TRANSIENT-NaN case: on the first
     * render `projectId` may be `NaN` (AngularJS resolves `data-project-id` via
     * `$digest` AFTER the first `connectedCallback`), so NO network / WebSocket
     * work happens until a finite id arrives. `loadInitialData` is stable per
     * `projectId` (it depends only on `projectId` + module-stable setters), so
     * this effect fires exactly once per distinct id — never on every state
     * update. Cleanup disconnects the shared events client and cancels the
     * pending search debounce.
     */
    useEffect(() => {
        aliveRef.current = true;
        if (Number.isFinite(projectId)) {
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

    // Transient-NaN: the project id has not resolved yet (AngularJS fills
    // data-project-id via a later $digest), so no network has run — render a
    // neutral shell, never crash.
    if (!Number.isFinite(projectId)) {
        return <main className="main scrum" />;
    }

    // Port of `permissionDenied` (backlog module disabled, or a 403 / 451
    // blocked/archived response).
    if (permissionDenied) {
        return (
            <main className="main scrum">
                {/* i18n: PERMISSIONS.ERROR / COMMON.PERMISSION_DENIED */}
                <div className="permission-denied">
                    <h1>Permission denied</h1>
                    <p>You don&apos;t have permission to see the backlog.</p>
                </div>
            </main>
        );
    }

    // Initial project load still pending — or it failed with a load error.
    if (project === null) {
        if (loadError) {
            return (
                <main className="main scrum">
                    {/* i18n: BACKLOG.ERROR_LOADING_BACKLOG */}
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
            <DndProvider project={project} resolveDrop={resolveDrop} persist={persist}>
                <section className="backlog">
                    {/* `mainTitle` is an AngularJS component (outer page chrome) and is
                        intentionally NOT rendered by the React root. */}

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
                                        {/* i18n: BACKLOG.TITLE */}
                                        <h2>Backlog</h2>
                                        {hasSelectedFilters ? (
                                            <>
                                                <span className="backlog-stories-number squared">
                                                    {state.userstories.length}
                                                </span>
                                                {/* i18n: BACKLOG.TOTAL_STORIES_FILTERED */}
                                                <span className="backlog-stories-number">
                                                    {state.totalUserStories} total
                                                </span>
                                            </>
                                        ) : (
                                            /* i18n: BACKLOG.TOTAL_STORIES */
                                            <span className="backlog-stories-number">
                                                {state.totalUserStories} total
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
                                                        {/* i18n: US.ADD */}
                                                        <span className="text">Add</span>
                                                    </button>
                                                    <button
                                                        className="btn-icon"
                                                        type="button"
                                                        /* i18n: US.ADD_BULK */
                                                        aria-label="Add user stories in bulk"
                                                        title="Add user stories in bulk"
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
                                                {/* i18n: BACKLOG.FILTERS.HIDE_TITLE / .TITLE */}
                                                {state.activeFilters ? "Hide filters" : "Filters"}
                                            </span>
                                            {hasSelectedFilters && (
                                                <span className="selected-filters">
                                                    {state.selectedFilters.length}
                                                </span>
                                            )}
                                        </button>

                                        {/* Reproduces tg-input-search. i18n: COMMON.SEARCH */}
                                        <input
                                            className="tg-input-search"
                                            type="search"
                                            value={state.filterQ}
                                            placeholder="Search"
                                            aria-label="Search"
                                            onChange={(e) => changeQ(e.target.value)}
                                        />

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
                                                {/* i18n: BACKLOG.TAGS.SHOW */}
                                                <label htmlFor="show-tags-input">Show tags</label>
                                            </div>
                                        )}
                                    </div>

                                    <div className="backlog-table-options-end">
                                        {state.currentSprint ? (
                                            <button
                                                id="move-to-current-sprint"
                                                type="button"
                                                className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                                                /* i18n: BACKLOG.MOVE_US_TO_CURRENT_SPRINT */
                                                title="Move to current sprint"
                                                onClick={() => {
                                                    void moveSelectedToSprint("current");
                                                }}
                                            >
                                                <span className="text">Move to current sprint</span>
                                                <Svg icon="icon-add-to-sprint" />
                                            </button>
                                        ) : (
                                            <button
                                                id="move-to-latest-sprint"
                                                type="button"
                                                className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                                                /* i18n: BACKLOG.MOVE_US_TO_LATEST_SPRINT */
                                                title="Move to latest sprint"
                                                onClick={() => {
                                                    void moveSelectedToSprint("latest");
                                                }}
                                            >
                                                <span className="text">Move to latest sprint</span>
                                                <Svg icon="icon-add-to-sprint" />
                                            </button>
                                        )}

                                        {/* Both forecasting buttons are gated on `add_milestone`
                                            (jade `tg-check-permission="add_milestone"`). */}
                                        {hasStories && state.displayVelocity && canAddMilestone && (
                                            <button
                                                type="button"
                                                className="btn-filter active velocity-forecasting-btn e2e-velocity-forecasting"
                                                /* i18n: BACKLOG.FORECASTING.TITLE */
                                                title="Forecasting"
                                                onClick={toggleVelocityForecasting}
                                            >
                                                <Svg icon="icon-fold-column" />
                                                {/* i18n: BACKLOG.FORECASTING.BACKLOG */}
                                                <span className="text">Forecasting</span>
                                            </button>
                                        )}
                                        {hasStories &&
                                            !state.displayVelocity &&
                                            speed > 0 &&
                                            canAddMilestone && (
                                                <button
                                                    type="button"
                                                    className="btn-filter velocity-forecasting-btn e2e-velocity-forecasting"
                                                    /* i18n: BACKLOG.FORECASTING.BACKLOG */
                                                    title="Forecasting"
                                                    onClick={toggleVelocityForecasting}
                                                >
                                                    {/* i18n: BACKLOG.FORECASTING.TITLE */}
                                                    Forecasting
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
                                        onAddFilter={addFilterBacklog}
                                        onRemoveFilter={removeFilterBacklog}
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
                                            {/* i18n: BACKLOG.FORECASTING.NEW_SPRINT / .CURRENT_SPRINT */}
                                            <span className="forecasting-text">
                                                {state.forecastNewSprint
                                                    ? "New sprint"
                                                    : "Current sprint"}
                                            </span>
                                            <div className="button btn-link">
                                                <Svg icon="icon-add" />
                                                {/* i18n: BACKLOG.FORECASTING.ADD_NEW_SPRINT */}
                                                <button
                                                    className="text"
                                                    type="button"
                                                    onClick={() => addNewSprint()}
                                                >
                                                    Add new sprint
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
                                    {/* i18n: BACKLOG.NO_MATCH */}
                                    <p className="no-match">No matches</p>
                                    {/* i18n: BACKLOG.NO_MATCH_HELP */}
                                    <p className="no-match-help">Try another search</p>
                                </div>

                                <div
                                    className={`empty-large js-empty-backlog${
                                        emptyLargeHidden ? " hidden" : ""
                                    }`}
                                >
                                    {/* i18n: BACKLOG.EMPTY */}
                                    <p className="title">Your backlog is empty</p>
                                    {canAddUs && (
                                        <button
                                            className="btn-small"
                                            type="button"
                                            onClick={() => addNewUs("standard")}
                                        >
                                            <Svg icon="icon-add" />
                                            {/* i18n: BACKLOG.CREATE_NEW_US_EMPTY_HELP */}
                                            <span className="text">Create user story</span>
                                        </button>
                                    )}
                                    <img
                                        src={`${baseHref}images/empty/empty_mex.png`}
                                        alt="Your backlog is empty"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* `sidebar.sidebar` is a child of `main`, a SIBLING of
                    `section.backlog`. Rendered via `createElement` because
                    `sidebar` is not a standard element and augmenting
                    `JSX.IntrinsicElements` would risk cross-module collisions
                    (same rationale as the `tg-svg` host). */}
                {createElement(
                    "sidebar",
                    { className: "sidebar" },
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
                    />,
                )}
            </DndProvider>

            {/* React lightboxes. The shared generic-form (single-US create/edit)
                lightbox stays in the AngularJS Jade shell. */}
            <BulkUserStoriesLightbox
                open={bulkLightbox.open}
                project={project}
                defaultStatusId={project.default_us_status}
                onCreated={onBulkCreated}
                onClose={() => setBulkLightbox({ open: false })}
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
        </main>
    );
}
