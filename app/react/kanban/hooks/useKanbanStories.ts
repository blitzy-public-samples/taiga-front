/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanStories — the Kanban board's state / data / real-time hook (F-001).
 *
 * This is the net-new React replacement for the stateful orchestration the
 * legacy AngularJS `KanbanController` (`app/coffee/modules/kanban/main.coffee`)
 * and `KanbanUserstoriesService`
 * (`app/coffee/modules/kanban/kanban-usertories.coffee`) performed. It owns ALL
 * Kanban board state, data loading, WebSocket wiring, localStorage preferences,
 * and the optimistic move -> persist path. It is consumed by
 * `../KanbanBoard.tsx` as `const kb = useKanbanStories(props.context)`.
 *
 * It deliberately does NOT own:
 *   - pointer-drag mechanics (that is `../dnd/`), and
 *   - any DOM / JSX (that is the sibling presentational components).
 *
 * This is a like-for-like, behaviour-preserving migration. The only intentional
 * behavioural ADDITION beyond legacy parity is the mandated optimistic-move
 * ROLLBACK on API failure (AAP 0.6.3): legacy `moveUs` had no rollback.
 *
 * Immutable board state lives in a single {@link KanbanState} object mutated
 * ONLY through the `../../shared/state` immer producers; hook-local presentation
 * state (folds, selection, zoom, filters, lightbox) uses plain `useState`.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { produce } from "immer";
import { createApiClient } from "../../shared/api";
import type { QueryParams } from "../../shared/api";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";
import {
    createInitialKanbanState,
    init,
    set,
    add,
    remove,
    replaceModel,
    move,
    toggleFold as toggleCardFold, // shared/state CARD-fold producer (renamed to avoid clashing with this hook's COLUMN foldStatus).
    resetFolds,
    addArchivedStatus,
    hideStatus,
    showStatus,
    isUsInArchivedHiddenStatus as isUsInArchivedHiddenStatusShared,
    UNCLASSIFIED_SWIMLANE_ID,
} from "../../shared/state";
import type { KanbanState } from "../../shared/state";
import type {
    MountContext,
    Project,
    Status,
    Swimlane,
    UserStory,
    Point,
    Role,
} from "../../shared/types";

/* -------------------------------------------------------------------------- */
/* Public exported types                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Drop descriptor forwarded from the `../dnd/` layer into {@link
 * UseKanbanStoriesResult.handleDragEnd}. Its fields map ONE-TO-ONE onto the
 * `shared/state` `move(state, usList, statusId, swimlaneId, index, previousCard,
 * nextCard)` parameters.
 *
 * `swimlaneId` carries the RAW droppable value: `null` in non-swimlane mode, a
 * real swimlane id in swimlane mode, or `-1` for the synthetic "unclassified"
 * swimlane. The hook maps `-1`/`null` -> `null` before the API call (legacy
 * `KanbanController.moveUs`).
 *
 * NOTE (parallel-development reconciliation): the sibling `../dnd/types.ts`
 * declares its own structurally-identical `KanbanDropArgs` with
 * `swimlaneId: number | null`. This export therefore widens the field to
 * `number | null` (rather than the plain `number` a first reading might
 * suggest) so the two definitions are interchangeable and `kb.handleDragEnd`
 * stays assignable to the dnd layer's `KanbanDragEndContext`.
 */
export interface KanbanDropArgs {
    /** ids of dragged stories (multi-select supported). */
    usList: number[];
    /** target status column. */
    statusId: number;
    /** target swimlane; `-1` (or `null`) = unclassified / non-swimlane. */
    swimlaneId: number | null;
    /** insertion index among the target column's cards. */
    index: number;
    /** id of the nearest PRECEDING card (has priority). */
    previousCard: number | null;
    /** id of the nearest FOLLOWING card (only when `previousCard` is null). */
    nextCard: number | null;
}

/**
 * A project member as rendered on a Kanban card. Structurally identical to
 * `Card.tsx`'s `CardMember`, so `Record<number, KanbanUser>` is assignable to
 * `Record<number, CardMember>` through structural typing (no shared import
 * required and none allowed — `shared/types` is locked).
 */
export interface KanbanUser {
    id: number;
    full_name_display?: string;
    full_name?: string;
    username?: string;
    photo?: string | null;
    big_photo?: string | null;
    color?: string | null;
}

/**
 * The lightbox descriptor the board renders. `statusId` is present for
 * create/bulk (the target column); `usId` for edit/assign (the target story).
 */
export interface KanbanLightboxState {
    type: "create" | "edit" | "bulk" | "assign";
    statusId?: number;
    usId?: number;
}

/**
 * Complete return surface of {@link useKanbanStories}. `KanbanBoard` destructures
 * `kb.*`; every member below MUST be present or the board crashes at runtime.
 */
export interface UseKanbanStoriesResult {
    /* Load state */
    initialLoad: boolean;
    project: Project | null;
    projectId: number | null;
    isAdmin: boolean;
    renderInProgress: boolean;
    notFoundUserstories: boolean;
    error: unknown;

    /* Board data */
    usStatusList: Status[];
    swimlanesList: Swimlane[];
    swimlanesStatuses: Record<number, Status[]>;
    usByStatus: Record<string, number[]>;
    usByStatusSwimlanes: Record<string, Record<string, number[]>>;
    usMap: Record<number, UserStory>;
    usersById: Record<number, KanbanUser>;

    /* Per-item view state */
    folds: Record<number, boolean>;
    foldedSwimlane: Record<number, boolean>;
    foldStatusChanged: Record<number, boolean>;
    unfold: number | null;
    selectedUss: Record<number, boolean>;
    movedUs: number[];
    usCardVisibility: Record<number, boolean>;
    defaultSwimlaneId: number | null;

    /* Zoom */
    zoom: string[];
    zoomLevel: number;
    setZoom: (index: number) => void;

    /* Filters */
    filters: unknown;
    customFilters: unknown[];
    selectedFilters: unknown[];
    filterQ: string;
    changeQ: (q: string) => void;
    addFilter: (f: unknown) => void;
    saveCustomFilter: (name: string) => void;
    selectCustomFilter: (f: unknown) => void;
    removeCustomFilter: (f: unknown) => void;
    removeFilter: (f: unknown) => void;

    /* Actions */
    handleDragEnd: (args: KanbanDropArgs) => void;
    toggleSwimlane: (swimlaneId: number) => void;
    foldStatus: (status: Status) => void;
    toggleFold: (usId: number) => void;
    addNewUs: (type: "standard" | "bulk", statusId: number) => void;
    editUs: (usId: number) => void;
    deleteUs: (usId: number) => void;
    changeUsAssignedUsers: (usId: number) => void;
    moveToTopDropdown: (usId: number) => void;
    toggleSelectedUs: (usId: number, event?: unknown) => void;
    editWipLimit: (statusId: number, wipLimit: number | null) => void;
    showArchivedStatus: (statusId: number) => void;
    setColumnMode: (statusId: number, mode: "max" | "min" | undefined) => void;

    /* Selectors */
    isMaximized: (statusId: number) => boolean;
    isMinimized: (statusId: number) => boolean;
    isUsInArchivedHiddenStatus: (usId: number) => boolean;
    showPlaceHolder: (statusId: number, swimlaneId?: number | null) => boolean;

    /* Lightbox wiring */
    activeLightbox: KanbanLightboxState | null;
    closeLightbox: () => void;
    submitNewUs: (subject: string) => void;
    submitBulkUs: (bulkText: string) => void;
}

/**
 * Widened runtime view of {@link Project}. The frozen `Project` type omits the
 * fields the shell exposes on `window` (`i_am_admin`, `default_swimlane`,
 * `us_statuses`, `swimlanes`, `members`, `tags_colors`), so the hook reads them
 * through this superset. `points`/`roles` are re-declared to keep the cast local.
 */
type ProjectRuntime = Project & {
    i_am_admin?: boolean;
    default_swimlane?: number | null;
    us_statuses?: Status[];
    swimlanes?: Array<Swimlane & { statuses?: Status[] }>;
    points?: Point[];
    roles?: Role[];
    members?: KanbanUser[];
    tags_colors?: Record<string, string>;
};

/* -------------------------------------------------------------------------- */
/* Module-scope constants                                                      */
/* -------------------------------------------------------------------------- */

/** PRESERVED legacy localStorage key (shared board-zoom preference). */
const ZOOM_STORAGE_KEY = "kanban_zoom";
const DEFAULT_ZOOM_LEVEL = 1;

/**
 * Cumulative zoom feature map (from `kanban-board-zoom.directive.coffee`). The
 * visible feature set for a zoom index is the union of levels `0..index`.
 */
const ZOOM_LEVELS: string[][] = [
    ["assigned_to", "ref"],
    ["subject", "card-data", "assigned_to_extended"],
    ["tags", "extra_info", "unfold"],
    ["related_tasks", "attachments"],
];

/**
 * Recognised URL filter query params (legacy `KanbanController.validQueryParams`).
 * These are merged into the userstory list request from the URL.
 */
const VALID_QUERY_PARAMS: string[] = [
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

/** React-namespaced localStorage keys — the AngularJS kanban is removed and React owns persistence. */
const foldsKey = (projectId: number): string => `taiga.react.kanban.folds.${projectId}`;
const swimlaneFoldsKey = (projectId: number): string => `taiga.react.kanban.swimlanes.${projectId}`;
const columnModesKey = (projectId: number): string => `taiga.react.kanban.columnModes.${projectId}`;

/* -------------------------------------------------------------------------- */
/* Module-scope helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cumulative zoom feature set for a zoom index (union of `ZOOM_LEVELS[0..index]`).
 * The index is capped into `[0, ZOOM_LEVELS.length - 1]` (i.e. 0..3).
 */
function getZoomView(index: number): string[] {
    const capped = Math.min(Math.max(index, 0), ZOOM_LEVELS.length - 1);
    const out: string[] = [];
    for (let i = 0; i <= capped; i++) {
        out.push(...ZOOM_LEVELS[i]);
    }
    return out;
}

/** Safe JSON read from localStorage (may throw in private mode / jsdom edge cases). */
function readJSON<T>(key: string, fallback: T): T {
    try {
        if (typeof localStorage === "undefined") {
            return fallback;
        }
        const raw = localStorage.getItem(key);
        if (raw == null) {
            return fallback;
        }
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/** Safe JSON write to localStorage (swallows quota / private-mode errors). */
function writeJSON(key: string, value: unknown): void {
    try {
        if (typeof localStorage === "undefined") {
            return;
        }
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore */
    }
}

/** Read the persisted zoom level (numeric), defaulting to {@link DEFAULT_ZOOM_LEVEL}. */
function readZoom(): number {
    try {
        if (typeof localStorage === "undefined") {
            return DEFAULT_ZOOM_LEVEL;
        }
        const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
        if (raw == null) {
            return DEFAULT_ZOOM_LEVEL;
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : DEFAULT_ZOOM_LEVEL;
    } catch {
        return DEFAULT_ZOOM_LEVEL;
    }
}

/** Persist the zoom level under the PRESERVED legacy `kanban_zoom` key. */
function writeZoom(n: number): void {
    try {
        if (typeof localStorage === "undefined") {
            return;
        }
        localStorage.setItem(ZOOM_STORAGE_KEY, String(n));
    } catch {
        /* ignore */
    }
}

/**
 * Inclusive random integer in `[start, end]` — EXACT port of `utils.coffee`
 * `randomInt`. Used for the WebSocket debounce window (700..1000 ms).
 */
function randomInt(start: number, end: number): number {
    const interval = end - start;
    return start + Math.floor(Math.random() * (interval + 1));
}

/** A trailing debounce wrapper with an explicit `.cancel()`. */
interface Debounced<A extends unknown[]> {
    (...args: A): void;
    cancel(): void;
}

/**
 * TRAILING debounce — EXACT semantics of `utils.coffee` `debounceLeading`
 * (`_.debounce(func, wait, { leading: false, trailing: true })`). Despite the
 * misleading legacy NAME, it fires ONCE `wait` ms after the LAST call, collapsing
 * bursts. `.cancel()` clears any pending trailing call.
 */
function debounceLeading<A extends unknown[]>(wait: number, fn: (...args: A) => void): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: A | null = null;
    const debounced = ((...args: A): void => {
        lastArgs = args;
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            const a = lastArgs;
            lastArgs = null;
            if (a) {
                fn(...a);
            }
        }, wait);
    }) as Debounced<A>;
    debounced.cancel = (): void => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = null;
        lastArgs = null;
    };
    return debounced;
}

/**
 * THE single intentional cross-framework bridge in the migration: read the
 * runtime project metadata the surviving AngularJS shell exposes on `window`
 * (the frozen REST surface has no project-by-slug endpoint that returns this
 * metadata). Defensive: returns the first candidate that is an object, else null.
 *
 * `context` is accepted for a future slug/id match refinement; it is reserved.
 */
function readRuntimeProject(context: MountContext): ProjectRuntime | null {
    void context; // reserved for slug/id disambiguation; the shell exposes the active project.
    if (typeof window === "undefined") {
        return null;
    }
    const w = window as unknown as {
        taigaConfig?: { project?: unknown };
        _project?: unknown;
        taigaCurrentProject?: unknown;
    };
    const candidates = [w.taigaConfig?.project, w._project, w.taigaCurrentProject];
    for (const c of candidates) {
        if (c && typeof c === "object") {
            return c as ProjectRuntime;
        }
    }
    return null;
}

/**
 * MANDATORY graceful-degradation fallback when no runtime project is found: the
 * board renders READ-ONLY (`my_permissions: []`) but is NOT blanked
 * (`is_kanban_activated: true`).
 */
function buildFallbackProject(projectId: number, context: MountContext): ProjectRuntime {
    return {
        id: projectId,
        slug: context.projectSlug ?? "",
        name: "",
        my_permissions: [],
        is_kanban_activated: true,
        is_backlog_activated: false,
        archived_code: null,
    };
}

/** The URL query string, from `window.location.search` or the hashbang query. */
function getUrlSearchString(): string {
    if (typeof window === "undefined") {
        return "";
    }
    const { search, hash } = window.location;
    if (search && search.length > 1) {
        return search;
    }
    const qIdx = hash.indexOf("?");
    return qIdx >= 0 ? hash.slice(qIdx) : "";
}

/**
 * Pick the recognised {@link VALID_QUERY_PARAMS} out of the current URL query
 * (mirrors legacy `_.pick(location.search(), validQueryParams)`).
 */
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

/** Whether the current URL carries ANY query params (legacy `Object.keys(location.search()).length`). */
function hasUrlSearch(): boolean {
    return getUrlSearchString().replace(/^[?]/, "").length > 0;
}

/**
 * Parse the status list out of the `getUserStoriesFilters` response and enrich
 * it with `is_archived`/`wip_limit` from the runtime `project.us_statuses`
 * (the filters endpoint may omit those flags). Sorted by `order`.
 */
function parseStatuses(filtersData: unknown, runtime: ProjectRuntime | null): Status[] {
    const fd = (filtersData ?? {}) as { statuses?: Array<Record<string, unknown>> };
    const raw = Array.isArray(fd.statuses) ? fd.statuses : [];
    const runtimeById: Record<number, Status> = {};
    for (const s of runtime?.us_statuses ?? []) {
        runtimeById[s.id] = s;
    }
    const parsed: Status[] = raw.map((r) => {
        const id = Number(r.id);
        const rt = runtimeById[id];
        const rColor = typeof r.color === "string" ? r.color : rt?.color;
        const rOrder = typeof r.order === "number" ? r.order : rt?.order;
        const rArchived =
            typeof r.is_archived === "boolean" ? r.is_archived : rt?.is_archived;
        const rWip =
            typeof r.wip_limit === "number" || r.wip_limit === null
                ? (r.wip_limit as number | null)
                : rt?.wip_limit ?? null;
        return {
            id,
            name: String(r.name ?? rt?.name ?? ""),
            color: rColor,
            order: rOrder,
            is_closed: rt?.is_closed,
            is_archived: rArchived,
            wip_limit: rWip,
            slug: rt?.slug,
            project: rt?.project,
        };
    });
    const list = parsed.length ? parsed : runtime?.us_statuses ?? [];
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Normalise the filter categories from the `getUserStoriesFilters` response. */
function buildFilters(filtersData: unknown): unknown {
    const fd = (filtersData ?? {}) as Record<string, unknown>;
    return {
        statuses: fd.statuses ?? [],
        tags: fd.tags ?? [],
        assigned_to: fd.assigned_to ?? [],
        owner: fd.owners ?? fd.owner ?? [],
        epic: fd.epics ?? fd.epic ?? [],
        role: fd.roles ?? fd.role ?? [],
    };
}

/* -------------------------------------------------------------------------- */
/* The hook                                                                    */
/* -------------------------------------------------------------------------- */

export function useKanbanStories(context: MountContext): UseKanbanStoriesResult {
    /* ---------------------------------------------------------------------- */
    /* KanbanState — mutated ONLY through the shared/state producers.          */
    /* ---------------------------------------------------------------------- */
    const [state, setState] = useState<KanbanState>(() => createInitialKanbanState());

    /* ---------------------------------------------------------------------- */
    /* Hook-local presentation state (NOT part of KanbanState).                */
    /* ---------------------------------------------------------------------- */
    const [project, setProject] = useState<ProjectRuntime | null>(null);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [defaultSwimlaneId, setDefaultSwimlaneId] = useState<number | null>(null);
    const [usStatusList, setUsStatusList] = useState<Status[]>([]);
    const [swimlanesStatuses, setSwimlanesStatuses] = useState<Record<number, Status[]>>({});
    const [usersById, setUsersById] = useState<Record<number, KanbanUser>>({});
    const [folds, setFolds] = useState<Record<number, boolean>>({});
    const [foldedSwimlane, setFoldedSwimlane] = useState<Record<number, boolean>>({});
    const [unfold, setUnfold] = useState<number | null>(null);
    const [selectedUss, setSelectedUss] = useState<Record<number, boolean>>({});
    const [movedUs, setMovedUs] = useState<number[]>([]);
    // usCardVisibility mirrors the legacy `@scope.usCardVisibility = {}`; it is a
    // read-only projection for the board and is never mutated by this hook.
    const [usCardVisibility] = useState<Record<number, boolean>>({});
    const [columnModes, setColumnModes] = useState<Record<number, "max" | "min" | undefined>>({});
    const [zoomLevel, setZoomLevel] = useState<number>(() => readZoom());
    const [zoom, setZoomState] = useState<string[]>(() => getZoomView(readZoom()));
    const [filters, setFilters] = useState<unknown>(null);
    const [customFilters, setCustomFilters] = useState<unknown[]>([]);
    const [selectedFilters, setSelectedFilters] = useState<unknown[]>([]);
    const [filterQ, setFilterQ] = useState<string>("");
    const [activeLightbox, setActiveLightbox] = useState<KanbanLightboxState | null>(null);
    const [initialLoad, setInitialLoad] = useState<boolean>(false);
    const [renderInProgress, setRenderInProgress] = useState<boolean>(false);
    const [notFoundUserstories, setNotFoundUserstories] = useState<boolean>(false);
    const [error, setError] = useState<unknown>(null);

    /* ---------------------------------------------------------------------- */
    /* Refs — the "latest value" pattern for async callbacks (no re-render).   */
    /* ---------------------------------------------------------------------- */
    // API client: created once, recreated only if the mount context identity changes.
    const api = useMemo(() => createApiClient(context), [context]);
    const apiRef = useRef(api);
    useEffect(() => {
        apiRef.current = api;
    }, [api]);

    const stateRef = useRef(state);
    const zoomLevelRef = useRef(zoomLevel);
    const filterQRef = useRef(filterQ);
    const projectIdRef = useRef<number | null>(projectId);
    const projectRef = useRef<ProjectRuntime | null>(project);
    const usStatusListRef = useRef<Status[]>(usStatusList);
    const selectedFiltersRef = useRef<unknown[]>(selectedFilters);
    const activeLightboxRef = useRef<KanbanLightboxState | null>(activeLightbox);
    const foldsRef = useRef<Record<number, boolean>>(folds);
    const foldedSwimlaneRef = useRef<Record<number, boolean>>(foldedSwimlane);
    const columnModesRef = useRef<Record<number, "max" | "min" | undefined>>(columnModes);
    const isFirstLoadRef = useRef<boolean>(true);
    const pendingProjectRefreshRef = useRef<boolean>(false);

    // Keep the refs in sync with committed state (backstop; some handlers also
    // update the relevant ref synchronously before an immediate async read).
    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    useEffect(() => {
        zoomLevelRef.current = zoomLevel;
    }, [zoomLevel]);
    useEffect(() => {
        filterQRef.current = filterQ;
    }, [filterQ]);
    useEffect(() => {
        projectIdRef.current = projectId;
    }, [projectId]);
    useEffect(() => {
        projectRef.current = project;
    }, [project]);
    useEffect(() => {
        usStatusListRef.current = usStatusList;
    }, [usStatusList]);
    useEffect(() => {
        selectedFiltersRef.current = selectedFilters;
    }, [selectedFilters]);
    useEffect(() => {
        activeLightboxRef.current = activeLightbox;
    }, [activeLightbox]);
    useEffect(() => {
        foldsRef.current = folds;
    }, [folds]);
    useEffect(() => {
        foldedSwimlaneRef.current = foldedSwimlane;
    }, [foldedSwimlane]);
    useEffect(() => {
        columnModesRef.current = columnModes;
    }, [columnModes]);

    /* ---------------------------------------------------------------------- */
    /* Data loading                                                            */
    /* ---------------------------------------------------------------------- */

    /**
     * Build the userstory list request params (mirror `loadUserstoriesParams`
     * L423-436). PRESERVED zoom asymmetry: includes are added at
     * `zoomLevel >= 2`, but `setZoom` only RELOADS when crossing into index 3.
     */
    const loadUserstoriesParams = useCallback((): QueryParams => {
        const params: QueryParams = { status__is_archived: false };
        if (zoomLevelRef.current >= 2) {
            params.include_attachments = 1;
            params.include_tasks = 1;
        }
        // URL filter params (validQueryParams).
        Object.assign(params, parseUrlQueryParams());
        // Selected filter chips -> grouped query params (category -> comma-joined ids).
        const grouped: Record<string, Array<string | number>> = {};
        for (const f of selectedFiltersRef.current) {
            const ff = f as { category?: unknown; id?: unknown };
            if (
                typeof ff.category === "string" &&
                (typeof ff.id === "string" || typeof ff.id === "number")
            ) {
                if (!grouped[ff.category]) {
                    grouped[ff.category] = [];
                }
                grouped[ff.category].push(ff.id);
            }
        }
        for (const key of Object.keys(grouped)) {
            params[key] = grouped[key].join(",");
        }
        params.q = filterQRef.current;
        return params;
    }, []);

    /**
     * Fetch the userstory list and rebuild every projection via `set` (mirror
     * `loadUserstories` L464). `set` alone is sufficient because it does NOT
     * clear `archivedStatus`/`statusHide`/`foldStatusChanged`. Because `set`
     * rebuilds ALL columns (including hidden/archived ones), the "hidden"
     * invariant is re-applied afterwards so a reload never re-shows a hidden
     * archived column (legacy parity).
     */
    const loadUserstories = useCallback(async (): Promise<UserStory[]> => {
        setRenderInProgress(true);
        try {
            const params = loadUserstoriesParams();
            const stories = await apiRef.current.listUserStories(params);
            setState((prev) => {
                const built = set(prev, stories);
                if (built.statusHide.length === 0) {
                    return built;
                }
                return produce(built, (draft) => {
                    for (const sid of draft.statusHide) {
                        if (draft.usByStatus[String(sid)]) {
                            delete draft.usByStatus[String(sid)];
                        }
                    }
                });
            });
            setNotFoundUserstories(
                stories.length === 0 && (Boolean(filterQRef.current) || hasUrlSearch()),
            );
            return stories;
        } finally {
            setRenderInProgress(false);
        }
    }, [loadUserstoriesParams]);

    /**
     * Seed `swimlanesStatuses` + `state.swimlanesList` from the runtime project
     * (mirror `loadSwimlanes` L552 — there is NO swimlanes endpoint in React).
     * Graceful degradation: no `project.swimlanes` => empty list => non-swimlane
     * mode.
     */
    const applyLoadSwimlanes = useCallback(
        (rt: ProjectRuntime | null, statuses: Status[]): void => {
            const swMap: Record<number, Status[]> = {};
            const runtimeSwimlanes: Swimlane[] = [];
            for (const sw of rt?.swimlanes ?? []) {
                swMap[sw.id] = sw.statuses && sw.statuses.length ? sw.statuses : statuses;
                runtimeSwimlanes.push({
                    id: sw.id,
                    name: sw.name,
                    order: sw.order,
                    kanban_order: sw.kanban_order,
                    project: sw.project,
                });
            }
            swMap[UNCLASSIFIED_SWIMLANE_ID] = statuses;
            setSwimlanesStatuses(swMap);
            setState((prev) => init(prev, runtimeSwimlanes));
        },
        [],
    );

    /**
     * Re-load statuses + swimlanes and re-apply the archived-status init when a
     * `projects.*` real-time event indicates the project's swimlanes / statuses
     * changed (mirror `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged`). The
     * archived re-application is idempotent via `indexOf` guards.
     */
    const refreshStatusesAndSwimlanes = useCallback(async (): Promise<void> => {
        try {
            const rt = projectRef.current;
            const filtersData = await apiRef.current.getUserStoriesFilters(loadUserstoriesParams());
            const statuses = parseStatuses(filtersData, rt);
            usStatusListRef.current = statuses;
            setUsStatusList(statuses);
            setFilters(buildFilters(filtersData));
            applyLoadSwimlanes(rt, statuses);
            const archived = statuses.filter((s) => s.is_archived === true);
            if (archived.length) {
                setState((prev) => {
                    let next = prev;
                    for (const s of archived) {
                        if (next.archivedStatus.indexOf(s.id) === -1) {
                            next = addArchivedStatus(next, s.id);
                        }
                        if (next.statusHide.indexOf(s.id) === -1) {
                            next = hideStatus(next, s.id);
                        }
                    }
                    return next;
                });
            }
        } catch (e) {
            setError(e);
        }
    }, [loadUserstoriesParams, applyLoadSwimlanes]);


    /* ---------------------------------------------------------------------- */
    /* Mount effect — firstLoad (mirror `loadInitialData` order L582-594).      */
    /* ---------------------------------------------------------------------- */
    useEffect(() => {
        let cancelled = false;

        const firstLoad = async (): Promise<void> => {
            try {
                // 1. Resolve the numeric project id from the slug.
                const pid = await apiRef.current.resolveProject(context.projectSlug ?? "");
                if (cancelled) {
                    return;
                }
                projectIdRef.current = pid;
                setProjectId(pid);

                // 2. loadProject — read the runtime project from the shell bridge,
                //    with mandatory graceful degradation to a safe read-only default.
                const rt = readRuntimeProject(context) ?? buildFallbackProject(pid, context);
                projectRef.current = rt;
                setProject(rt);
                setIsAdmin(Boolean(rt.i_am_admin));
                setDefaultSwimlaneId(rt.default_swimlane ?? null);

                // usersById from the runtime members list.
                const members: Record<number, KanbanUser> = {};
                for (const m of rt.members ?? []) {
                    if (m && typeof m.id === "number") {
                        members[m.id] = m;
                    }
                }
                setUsersById(members);

                // Hydrate fold/swimlane-fold/column-mode preferences from localStorage.
                const hydratedFolds = readJSON<Record<number, boolean>>(foldsKey(pid), {});
                const hydratedSwimlaneFolds = readJSON<Record<number, boolean>>(
                    swimlaneFoldsKey(pid),
                    {},
                );
                const hydratedColumnModes = readJSON<Record<number, "max" | "min" | undefined>>(
                    columnModesKey(pid),
                    {},
                );
                foldsRef.current = hydratedFolds;
                foldedSwimlaneRef.current = hydratedSwimlaneFolds;
                columnModesRef.current = hydratedColumnModes;
                setFolds(hydratedFolds);
                setFoldedSwimlane(hydratedSwimlaneFolds);
                setColumnModes(hydratedColumnModes);

                // Module-activation gate (VIEW gate only — never an authz gate).
                // Still complete initialLoad so the board can render its
                // "module disabled" placeholder rather than a perpetual blank.
                if (!rt.is_kanban_activated) {
                    if (!cancelled) {
                        setInitialLoad(true);
                        isFirstLoadRef.current = false;
                    }
                    return;
                }

                // 3. Statuses + filter categories (from getUserStoriesFilters).
                const filtersData = await apiRef.current.getUserStoriesFilters(
                    loadUserstoriesParams(),
                );
                if (cancelled) {
                    return;
                }
                const statuses = parseStatuses(filtersData, rt);
                usStatusListRef.current = statuses;
                setUsStatusList(statuses);
                setFilters(buildFilters(filtersData));

                // 4. Swimlanes (from the runtime project).
                applyLoadSwimlanes(rt, statuses);

                // 5. Userstories.
                await loadUserstories();
                if (cancelled) {
                    return;
                }

                // 6. Archived-status init (mirror L723-770): archived columns are
                //    added to BOTH archivedStatus AND statusHide (start hidden), and
                //    default their column fold to true.
                const archived = statuses.filter((s) => s.is_archived === true);
                if (archived.length) {
                    setState((prev) => {
                        let next = prev;
                        for (const s of archived) {
                            if (next.archivedStatus.indexOf(s.id) === -1) {
                                next = addArchivedStatus(next, s.id);
                            }
                            if (next.statusHide.indexOf(s.id) === -1) {
                                next = hideStatus(next, s.id);
                            }
                        }
                        return next;
                    });
                    const withArchivedFolds = produce(foldsRef.current, (draft) => {
                        for (const s of archived) {
                            draft[s.id] = true;
                        }
                    });
                    foldsRef.current = withArchivedFolds;
                    setFolds(withArchivedFolds);
                }

                // 7. resetFolds — clear the transient card-fold change flags.
                setState((prev) => resetFolds(prev));

                // 8. Done.
                if (!cancelled) {
                    setInitialLoad(true);
                    isFirstLoadRef.current = false;
                }
            } catch (e) {
                // Never leave the board perpetually blank on a rejected promise.
                if (!cancelled) {
                    setError(e);
                    setInitialLoad(true);
                    isFirstLoadRef.current = false;
                }
            }
        };

        void firstLoad();

        return () => {
            cancelled = true;
        };
        // Keyed on the project slug: a slug change is a full board reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context.projectSlug]);


    /* ---------------------------------------------------------------------- */
    /* Real-time (WebSocket) — KANBAN-only keys; consumer owns the debounce.    */
    /* ---------------------------------------------------------------------- */

    /**
     * `changes.project.{id}.userstories` handler (mirror `eventsLoadUserstories`
     * L438-462): authoritatively refetch the userstory list, then diff each
     * story into state (existing => `replaceModel`, new => `add`). `data.pk`
     * is the changed-id hint; the authoritative refetch makes explicit use of
     * it optional.
     */
    const onUserStoriesRaw = useCallback(async (): Promise<void> => {
        try {
            const stories = await apiRef.current.listUserStories(loadUserstoriesParams());
            setState((prev) => {
                let next = prev;
                for (const us of stories) {
                    next = next.usMap[us.id] ? replaceModel(next, us) : add(next, us);
                }
                if (next.statusHide.length === 0) {
                    return next;
                }
                return produce(next, (draft) => {
                    for (const sid of draft.statusHide) {
                        if (draft.usByStatus[String(sid)]) {
                            delete draft.usByStatus[String(sid)];
                        }
                    }
                });
            });
        } catch (e) {
            setError(e);
        }
    }, [loadUserstoriesParams]);

    /**
     * `changes.project.{id}.projects` handler (mirror `initializeSubscription`
     * L245-264): when the event indicates the project's swimlanes / statuses
     * changed, refresh them — but DEFER while a lightbox is open (the refresh is
     * flushed by `closeLightbox`).
     */
    const onProjectsRaw = useCallback(
        (data: unknown): void => {
            const matches = (data as { matches?: string }).matches;
            const relevant =
                matches === "projects.swimlane" ||
                matches === "projects.swimlaneuserstorystatus" ||
                matches === "projects.userstorystatus";
            if (!relevant) {
                return;
            }
            if (activeLightboxRef.current != null) {
                pendingProjectRefreshRef.current = true;
            } else {
                void refreshStatusesAndSwimlanes();
            }
        },
        [refreshStatusesAndSwimlanes],
    );

    // Stable refs to the WS handlers so the subscription effect only re-runs on
    // projectId change (not on every handler identity change).
    const onUserStoriesRawRef = useRef(onUserStoriesRaw);
    const onProjectsRawRef = useRef(onProjectsRaw);
    useEffect(() => {
        onUserStoriesRawRef.current = onUserStoriesRaw;
    }, [onUserStoriesRaw]);
    useEffect(() => {
        onProjectsRawRef.current = onProjectsRaw;
    }, [onProjectsRaw]);

    useEffect(() => {
        if (projectId == null) {
            return;
        }
        const client = createEventsClient(context);
        // Consumer owns the debounce + the legacy random window (700-1000ms).
        const debOnUS = debounceLeading(randomInt(700, 1000), () => {
            void onUserStoriesRawRef.current();
        });
        const debOnProj = debounceLeading(randomInt(700, 1000), (data: unknown) => {
            onProjectsRawRef.current(data);
        });
        const cleanup = subscribeToProject(client, projectId, {
            onUserStories: debOnUS,
            onProjects: debOnProj,
        });
        client.setupConnection();
        return () => {
            debOnUS.cancel();
            debOnProj.cancel();
            cleanup();
            client.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);


    /* ---------------------------------------------------------------------- */
    /* Optimistic move -> single bulk call + MANDATED rollback                 */
    /* (mirror `moveUs` L596-632; rollback is the one behavioral ADDITION).    */
    /* ---------------------------------------------------------------------- */

    /**
     * Shared move engine used by BOTH `handleDragEnd` and `moveToTopDropdown`.
     * Applies the move optimistically through the shared `move` producer, issues
     * EXACTLY ONE `bulkUpdateKanbanOrder` call, and ROLLS BACK to the pre-move
     * snapshot if the request rejects. Multi-card moves are collapsed into the
     * single call because the producer returns a `bulkUserstories` array
     * covering every dragged id.
     */
    const applyMoveAndPersist = useCallback(
        async (
            usList: number[],
            statusId: number,
            apiSwimlaneId: number | null,
            index: number,
            previousCard: number | null,
            nextCard: number | null,
        ): Promise<void> => {
            const snapshot = stateRef.current; // pre-move KanbanState (for rollback)
            const { state: next, result } = move(
                snapshot,
                usList,
                statusId,
                apiSwimlaneId,
                index,
                previousCard,
                nextCard,
            );
            // Optimistic apply.
            stateRef.current = next;
            setState(next);
            setSelectedUss({}); // cleanSelectedUss()
            setMovedUs(usList); // drives the .kanban-moved animation
            try {
                await apiRef.current.bulkUpdateKanbanOrder(
                    projectIdRef.current as number,
                    result.statusId,
                    result.swimlaneId, // already null for unclassified
                    result.afterUserstoryId,
                    result.beforeUserstoryId,
                    result.bulkUserstories,
                );
                // Success: WIP counters derive from usByStatus lengths (already
                // updated). Clear the moved highlight (parity with redraw:wip).
                window.setTimeout(() => setMovedUs([]), 300);
            } catch (e) {
                // ROLLBACK (mandated by AAP §0.6.3 — legacy had none).
                stateRef.current = snapshot;
                setState(snapshot);
                setMovedUs([]);
                setError(e);
            }
        },
        [],
    );

    /**
     * Drag-drop entry point invoked by the sibling `../dnd/` module. Maps the
     * unclassified swimlane sentinel (-1) or a null swimlane to the `null` the
     * API client expects (it omits `swimlane_id` when falsy), then defers to
     * `applyMoveAndPersist` for exactly one optimistic bulk call.
     */
    const handleDragEnd = useCallback(
        (args: KanbanDropArgs): void => {
            const apiSwimlaneId =
                args.swimlaneId === UNCLASSIFIED_SWIMLANE_ID || args.swimlaneId == null
                    ? null
                    : args.swimlaneId;
            void applyMoveAndPersist(
                args.usList,
                args.statusId,
                apiSwimlaneId,
                args.index,
                args.previousCard,
                args.nextCard,
            );
        },
        [applyMoveAndPersist],
    );

    /**
     * "Move to top" dropdown action (mirror legacy `moveUsToTop`): moves the
     * story to index 0 of its CURRENT column, placing it before that column's
     * current first card. Reuses the optimistic + rollback + single-bulk path.
     */
    const moveToTopDropdown = useCallback(
        (usId: number): void => {
            const snapshot = stateRef.current;
            const us = snapshot.usMap[usId];
            if (!us) {
                return;
            }
            const statusId = us.status;
            const swimlaneId = us.swimlane ?? null;
            // Determine the current column's first card id.
            const list =
                swimlaneId != null
                    ? snapshot.usByStatusSwimlanes[String(swimlaneId)]?.[String(statusId)]
                    : snapshot.usByStatus[String(statusId)];
            if (!list || list.length === 0) {
                return;
            }
            const firstCardId = list[0];
            if (firstCardId === usId) {
                // Already at the top — nothing to do.
                return;
            }
            void applyMoveAndPersist([usId], statusId, swimlaneId, 0, null, firstCardId);
        },
        [applyMoveAndPersist],
    );


    /* ---------------------------------------------------------------------- */
    /* Zoom (mirror `setZoom` L127-147; the hook OWNS the cumulative map).      */
    /* ---------------------------------------------------------------------- */
    const setZoom = useCallback(
        (index: number): void => {
            const idx = Number(index);
            if (Number.isNaN(idx)) {
                return;
            }
            if (idx === zoomLevelRef.current) {
                return; // unchanged -> no-op
            }
            const prev = zoomLevelRef.current;
            zoomLevelRef.current = idx;
            setZoomLevel(idx);
            setZoomState(getZoomView(idx));
            writeZoom(idx);
            // PRESERVED asymmetry: reload the userstory list ONLY when crossing
            // INTO index 3 (idx > 2 && prev <= 2). During the very first load the
            // mount effect already fetches the list, so guard against a double
            // fetch. Do NOT "fix" this asymmetry — it is intentional legacy
            // behavior (includes are added at zoomLevel >= 2 in the params, but a
            // reload only happens crossing > 2).
            if (isFirstLoadRef.current) {
                return;
            }
            if (idx > 2 && prev <= 2) {
                void (async () => {
                    setRenderInProgress(true);
                    try {
                        await loadUserstories();
                        setState((p) => resetFolds(p));
                    } catch (e) {
                        setError(e);
                    } finally {
                        setRenderInProgress(false);
                    }
                })();
            }
        },
        [loadUserstories],
    );

    /* ---------------------------------------------------------------------- */
    /* Column fold / card fold / swimlane fold                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * Toggle a status COLUMN's fold (mirror `foldStatus` L778-793). Persists the
     * fold map, tracks the last-unfolded column via `unfold`, and — when an
     * archived column is unfolded — hides it (archived columns are only ever
     * visible while unfolded through the archived-status affordance).
     */
    const foldStatus = useCallback((status: Status): void => {
        const sid = status.id;
        const nextFolds = produce(foldsRef.current, (draft) => {
            draft[sid] = !draft[sid];
        });
        foldsRef.current = nextFolds;
        setFolds(nextFolds);
        writeJSON(foldsKey(projectIdRef.current ?? 0), nextFolds);
        // If the column is now UNFOLDED, remember it as the active unfold target.
        if (nextFolds[sid]) {
            setUnfold(null);
        } else {
            setUnfold(sid);
        }
        setState((prev) => {
            if (prev.archivedStatus.indexOf(sid) !== -1 && prev.statusHide.indexOf(sid) === -1) {
                return hideStatus(prev, sid);
            }
            return prev;
        });
    }, []);

    /** Toggle a single card's fold (CARD fold -> `state.foldStatusChanged`). */
    const toggleFold = useCallback((usId: number): void => {
        setState((prev) => toggleCardFold(prev, usId));
    }, []);

    /** Toggle a swimlane's collapsed state; persist the map. */
    const toggleSwimlane = useCallback((swimlaneId: number): void => {
        const next = produce(foldedSwimlaneRef.current, (draft) => {
            draft[swimlaneId] = !draft[swimlaneId];
        });
        foldedSwimlaneRef.current = next;
        setFoldedSwimlane(next);
        writeJSON(swimlaneFoldsKey(projectIdRef.current ?? 0), next);
    }, []);

    /**
     * Reveal an archived, hidden status column (mirror the archived "show"
     * affordance). Removes the column from `statusHide` and fetches that
     * status's stories (the main load excludes archived stories via
     * `status__is_archived: false`, so they must be fetched explicitly here).
     */
    const showArchivedStatus = useCallback(
        async (statusId: number): Promise<void> => {
            setState((prev) => showStatus(prev, statusId));
            try {
                const params: QueryParams = { status: statusId };
                if (zoomLevelRef.current >= 2) {
                    params.include_attachments = 1;
                    params.include_tasks = 1;
                }
                const stories = await apiRef.current.listUserStories(params);
                setState((prev) => {
                    let next = prev;
                    for (const us of stories) {
                        next = next.usMap[us.id] ? replaceModel(next, us) : add(next, us);
                    }
                    return next;
                });
            } catch (e) {
                setError(e);
            }
        },
        [],
    );

    /**
     * Edit a status's WIP limit optimistically, persisting through the API and
     * rolling back the `usStatusList` snapshot on failure.
     */
    const editWipLimit = useCallback(
        async (statusId: number, wipLimit: number | null): Promise<void> => {
            const snapshot = usStatusListRef.current;
            const optimistic = snapshot.map((s) =>
                s.id === statusId ? { ...s, wip_limit: wipLimit } : s,
            );
            usStatusListRef.current = optimistic;
            setUsStatusList(optimistic);
            try {
                await apiRef.current.editStatus(statusId, wipLimit);
            } catch (e) {
                usStatusListRef.current = snapshot;
                setUsStatusList(snapshot);
                setError(e);
            }
        },
        [],
    );

    /** Persist and set a column display mode (squish/maximize parity). */
    const applyColumnMode = useCallback(
        (statusId: number, mode: "max" | "min" | undefined): void => {
            const next = produce(columnModesRef.current, (draft) => {
                if (mode === undefined) {
                    delete draft[statusId];
                } else {
                    draft[statusId] = mode;
                }
            });
            columnModesRef.current = next;
            setColumnModes(next);
            writeJSON(columnModesKey(projectIdRef.current ?? 0), next);
        },
        [],
    );


    /* ---------------------------------------------------------------------- */
    /* Lightbox wiring + userstory CRUD                                        */
    /* ---------------------------------------------------------------------- */

    /** Open the create / bulk-create lightbox for a target status column. */
    const addNewUs = useCallback((type: "standard" | "bulk", statusId: number): void => {
        setActiveLightbox({ type: type === "bulk" ? "bulk" : "create", statusId });
    }, []);

    /** Open the userstory edit lightbox. */
    const editUs = useCallback((usId: number): void => {
        setActiveLightbox({ type: "edit", usId });
    }, []);

    /** Open the assigned-users lightbox for a story. */
    const changeUsAssignedUsers = useCallback((usId: number): void => {
        setActiveLightbox({ type: "assign", usId });
    }, []);

    /**
     * Close the active lightbox. If a `projects.*` real-time refresh was
     * deferred while the lightbox was open, flush it now.
     */
    const closeLightbox = useCallback((): void => {
        setActiveLightbox(null);
        activeLightboxRef.current = null;
        if (pendingProjectRefreshRef.current) {
            pendingProjectRefreshRef.current = false;
            void refreshStatusesAndSwimlanes();
        }
    }, [refreshStatusesAndSwimlanes]);

    /** Create a single userstory in the lightbox's target status. */
    const submitNewUs = useCallback(
        async (subject: string): Promise<void> => {
            const lb = activeLightboxRef.current;
            if (!lb || lb.type !== "create" || lb.statusId == null) {
                return;
            }
            try {
                const created = await apiRef.current.create<UserStory>("userstories", {
                    project: projectIdRef.current,
                    status: lb.statusId,
                    subject,
                });
                setState((prev) => add(prev, created));
                closeLightbox();
            } catch (e) {
                setError(e);
            }
        },
        [closeLightbox],
    );

    /** Bulk-create userstories (one per line) in the lightbox's target status. */
    const submitBulkUs = useCallback(
        async (bulkText: string): Promise<void> => {
            const lb = activeLightboxRef.current;
            if (!lb || lb.type !== "bulk" || lb.statusId == null) {
                return;
            }
            try {
                const created = await apiRef.current.bulkCreateUserStories(
                    projectIdRef.current as number,
                    lb.statusId,
                    bulkText,
                    null,
                );
                setState((prev) => add(prev, created));
                closeLightbox();
            } catch (e) {
                setError(e);
            }
        },
        [closeLightbox],
    );

    /** Delete a userstory optimistically, rolling back the state on failure. */
    const deleteUs = useCallback(async (usId: number): Promise<void> => {
        const snapshot = stateRef.current;
        const us = snapshot.usMap[usId];
        if (!us) {
            return;
        }
        const nextState = remove(snapshot, { id: usId, status: us.status });
        stateRef.current = nextState;
        setState(nextState);
        try {
            await apiRef.current.remove("userstories", usId);
        } catch (e) {
            stateRef.current = snapshot;
            setState(snapshot);
            setError(e);
        }
    }, []);

    /**
     * Toggle a story's multi-select membership. The board gates on ctrl/meta;
     * the hook just toggles. `event` is accepted for signature compatibility
     * with the board and is intentionally ignored here.
     */
    const toggleSelectedUs = useCallback((usId: number, _event?: unknown): void => {
        void _event;
        setSelectedUss((prev) =>
            produce(prev, (draft) => {
                if (draft[usId]) {
                    delete draft[usId];
                } else {
                    draft[usId] = true;
                }
            }),
        );
    }, []);


    /* ---------------------------------------------------------------------- */
    /* Filters + search                                                        */
    /* ---------------------------------------------------------------------- */

    // Stable ref to the (stable) loadUserstories so the debounced reload always
    // calls the latest implementation without re-creating its timer.
    const loadUserstoriesRef = useRef(loadUserstories);
    useEffect(() => {
        loadUserstoriesRef.current = loadUserstories;
    }, [loadUserstories]);

    // `filtersReloadContent` — a single, stable trailing-debounced reload
    // (mirror legacy `filtersReloadContent`, 100ms) so bursts of filter/search
    // changes collapse into one refetch.
    const filtersReloadContent = useMemo(
        () =>
            debounceLeading(100, () => {
                void loadUserstoriesRef.current();
            }),
        [],
    );
    useEffect(() => {
        return () => {
            filtersReloadContent.cancel();
        };
    }, [filtersReloadContent]);

    /** Update the search text immediately, then debounce-reload the list. */
    const changeQ = useCallback(
        (q: string): void => {
            filterQRef.current = q;
            setFilterQ(q);
            filtersReloadContent();
        },
        [filtersReloadContent],
    );

    /** Append a selected filter chip, then reload. */
    const addFilter = useCallback(
        (f: unknown): void => {
            setSelectedFilters((prev) => {
                const next = [...prev, f];
                selectedFiltersRef.current = next;
                return next;
            });
            filtersReloadContent();
        },
        [filtersReloadContent],
    );

    /** Remove a selected filter chip, then reload. */
    const removeFilter = useCallback(
        (f: unknown): void => {
            setSelectedFilters((prev) => {
                const next = prev.filter((x) => x !== f);
                selectedFiltersRef.current = next;
                return next;
            });
            filtersReloadContent();
        },
        [filtersReloadContent],
    );

    // Custom filters: the frozen API surface exposes NO custom-filter endpoint,
    // so these operate purely on local state for this POC (documented deviation).
    // They MUST exist (KanbanBoard destructures them) and must never throw.

    /** Persist the current selected filters under a name (local-only). */
    const saveCustomFilter = useCallback((name: string): void => {
        const snapshot = selectedFiltersRef.current;
        setCustomFilters((prev) => [...prev, { name, filters: snapshot }]);
    }, []);

    /** Apply a previously-saved custom filter, then reload. */
    const selectCustomFilter = useCallback(
        (f: unknown): void => {
            const cf = f as { filters?: unknown[] };
            const next = Array.isArray(cf.filters) ? [...cf.filters] : [];
            selectedFiltersRef.current = next;
            setSelectedFilters(next);
            filtersReloadContent();
        },
        [filtersReloadContent],
    );

    /** Remove a saved custom filter (local-only). */
    const removeCustomFilter = useCallback((f: unknown): void => {
        setCustomFilters((prev) => prev.filter((x) => x !== f));
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Selectors                                                               */
    /* ---------------------------------------------------------------------- */

    /** A status column is displayed maximized. */
    const isMaximized = useCallback(
        (statusId: number): boolean => columnModes[statusId] === "max",
        [columnModes],
    );

    /** A status column is displayed minimized. */
    const isMinimized = useCallback(
        (statusId: number): boolean => columnModes[statusId] === "min",
        [columnModes],
    );

    /**
     * Whether a story's status is BOTH archived AND currently hidden. Wraps the
     * shared two-arg selector to the single-arg shape KanbanBoard expects.
     * Reads the current `state` directly (not a ref) to avoid a one-render lag.
     */
    const isUsInArchivedHiddenStatus = useCallback(
        (usId: number): boolean => isUsInArchivedHiddenStatusShared(state, usId),
        [state],
    );

    /**
     * Whether a target column is empty (renders the drop placeholder). Looks up
     * the swimlane bucket when a swimlane id is supplied, else the flat
     * status bucket.
     */
    const showPlaceHolder = useCallback(
        (statusId: number, swimlaneId?: number | null): boolean => {
            const list =
                swimlaneId != null
                    ? state.usByStatusSwimlanes[String(swimlaneId)]?.[String(statusId)]
                    : state.usByStatus[String(statusId)];
            return (list?.length ?? 0) === 0;
        },
        [state],
    );


    /* ---------------------------------------------------------------------- */
    /* Return surface — MUST contain EVERY member of UseKanbanStoriesResult.   */
    /* KanbanBoard destructures `kb.*`; a missing member is a runtime crash.    */
    /* ---------------------------------------------------------------------- */
    return {
        /* Load state */
        initialLoad,
        // ProjectRuntime is a structural superset of Project; the consumer only
        // needs the frozen Project surface, so this upcast is safe.
        project,
        projectId,
        isAdmin,
        renderInProgress,
        notFoundUserstories,
        error,

        /* Board data */
        usStatusList,
        swimlanesList: state.swimlanesList,
        swimlanesStatuses,
        usByStatus: state.usByStatus,
        usByStatusSwimlanes: state.usByStatusSwimlanes,
        usMap: state.usMap,
        usersById,

        /* Per-item view state */
        folds,
        foldedSwimlane,
        foldStatusChanged: state.foldStatusChanged,
        unfold,
        selectedUss,
        movedUs,
        usCardVisibility,
        defaultSwimlaneId,

        /* Zoom */
        zoom,
        zoomLevel,
        setZoom,

        /* Filters */
        filters,
        customFilters,
        selectedFilters,
        filterQ,
        changeQ,
        addFilter,
        saveCustomFilter,
        selectCustomFilter,
        removeCustomFilter,
        removeFilter,

        /* Actions */
        handleDragEnd,
        toggleSwimlane,
        foldStatus,
        toggleFold,
        addNewUs,
        editUs,
        deleteUs,
        changeUsAssignedUsers,
        moveToTopDropdown,
        toggleSelectedUs,
        editWipLimit,
        showArchivedStatus,
        setColumnMode: applyColumnMode,

        /* Selectors */
        isMaximized,
        isMinimized,
        isUsInArchivedHiddenStatus,
        showPlaceHolder,

        /* Lightbox wiring */
        activeLightbox,
        closeLightbox,
        submitNewUs,
        submitBulkUs,
    };
}

