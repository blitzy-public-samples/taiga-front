/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef, useState } from "react";
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
import { buildContainerKey } from "./KanbanColumn";
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
 */
export function resolveKanbanDrop(
    state: KanbanState,
    event: NormalizedDragEnd,
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

    const targetList = (listOf[targetKey] ?? []).slice();
    const existing = targetList.indexOf(activeId);
    if (existing !== -1) {
        targetList.splice(existing, 1);
    }

    let insertAt = targetIndexRaw;
    if (existing !== -1 && existing < targetIndexRaw) {
        insertAt = targetIndexRaw - 1;
    }
    if (insertAt < 0) {
        insertAt = 0;
    }
    if (insertAt > targetList.length) {
        insertAt = targetList.length;
    }
    targetList.splice(insertAt, 0, activeId);

    return {
        origin: { containerKey: origin.key, index: origin.index },
        target: { containerKey: targetKey, index: insertAt },
        orderedIds: targetList,
        draggedIds: [activeId],
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
// Bulk create lightbox — reproduces lightbox-us-bulk.jade behavior: a textarea
// of newline-separated subjects submitted to the bulk_create endpoint.
// ---------------------------------------------------------------------------

interface BulkLightboxProps {
    onSubmit: (subjects: string) => void;
    onClose: () => void;
}

function BulkLightbox(props: BulkLightboxProps): JSX.Element {
    const [text, setText] = useState("");
    return (
        <div className="lightbox lightbox-generic-bulk open">
            <div className="lightbox-us-bulk">
                <textarea
                    className="bulk-subjects e2e-bulk-subjects"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                />
                <button
                    type="button"
                    className="btn-submit e2e-bulk-submit"
                    onClick={() => props.onSubmit(text)}
                >
                    Create
                </button>
                <button
                    type="button"
                    className="btn-close e2e-bulk-close"
                    onClick={props.onClose}
                >
                    Close
                </button>
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
    // F5 / multi-select: the AngularJS board supported multi-card selection for
    // group drag (`ui-multisortable-multiple`). That interaction is intentionally
    // NOT reproduced in the React port — it is absent from the AAP §0.1.1
    // functional surface, and no selection affordance exists. The leaf
    // `Card` / `KanbanColumn` / `KanbanBoard` retain an OPTIONAL `selected` prop
    // that simply defaults to `false`, so no inert, always-empty selection map is
    // threaded through the tree (which would imply an unimplemented capability).
    const [movedUs, setMovedUs] = useState<number[]>([]);
    const [notFound, setNotFound] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState<KanbanProject | null>(null);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [loadError, setLoadError] = useState(false);

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
        setBulkStatusId(statusId);
    };

    const submitBulk = (subjects: string): void => {
        const statusId = bulkStatusId;
        setBulkStatusId(null);
        if (statusId === null || !subjects.trim()) {
            return;
        }
        void bulkCreate(projectId, statusId, subjects, null).then(() => {
            if (!aliveRef.current) {
                return;
            }
            void reloadUserstories();
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
        void reloadUserstories();
        void loadFilters(next);
    };

    const foldStatus = (status: Status): void => {
        const nextFolded = !folds[status.id];
        setFolds((previous) => ({ ...previous, [status.id]: nextFolded }));
        setUnfold(nextFolded ? null : status.id);
    };

    const toggleSwimlane = (swimlaneId: number): void => {
        setFoldedSwimlane((previous) => ({
            ...previous,
            [swimlaneId]: !previous[swimlaneId],
        }));
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
        void httpDelete(`/userstories/${usId}`).then(() => {
            if (!aliveRef.current) {
                return;
            }
            void reloadUserstories();
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
    // Drag and drop
    // -----------------------------------------------------------------------

    const resolveDrop = (event: NormalizedDragEnd): ResolvedDrop | null =>
        resolveKanbanDrop(kanban.state, event);

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
        return <section className="main kanban permission-denied" />;
    }

    const project = projectLoaded;
    const swimlaneMode = kanban.state.swimlanesList.length > 0;
    const canAddUs =
        !!project &&
        Array.isArray(project.my_permissions) &&
        project.my_permissions.indexOf("add_us") !== -1;

    return (
        <section className={"main kanban" + (swimlaneMode ? " swimlane" : "")}>
            <div className="kanban-header">
                <div className="main-title">{project ? project.name : ""}</div>
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
                            <span className="icon icon-filters" aria-hidden="true" />
                            <span className="text">
                                {openFilter ? "Hide filters" : "Filters"}
                            </span>
                        </button>
                        <input
                            className="kanban-search e2e-search"
                            type="search"
                            value={filterQ}
                            placeholder="Search"
                            onChange={(event) => changeQ(event.target.value)}
                        />
                    </div>
                    <div className="kanban-table-options-end">
                        <div className="board-zoom">
                            {[0, 1, 2, 3].map((level) => (
                                <button
                                    key={level}
                                    type="button"
                                    className={
                                        "zoom-level" +
                                        (zoomLevel === level ? " active" : "")
                                    }
                                    onClick={() => changeZoom(level)}
                                >
                                    {level}
                                </button>
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
                    />
                ) : null}
            </div>

            {bulkStatusId !== null ? (
                <BulkLightbox
                    onSubmit={submitBulk}
                    onClose={() => setBulkStatusId(null)}
                />
            ) : null}
        </section>
    );
}
