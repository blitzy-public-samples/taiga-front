/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef, useState } from "react";
import sortBy from "lodash/sortBy";
import { httpDelete, httpGet } from "../shared/api/httpClient";
import type { QueryParams } from "../shared/api/httpClient";
import {
    bulkCreate,
    bulkUpdateKanbanOrder,
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

function buildUserstoriesParams(level: number, query: string): QueryParams {
    const params: QueryParams = { status__is_archived: false };
    if (level >= 2) {
        params.include_attachments = 1;
        params.include_tasks = 1;
    }
    if (query) {
        params.q = query;
    }
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
    const [selectedUss] = useState<Record<number, boolean>>({});
    const [movedUs, setMovedUs] = useState<number[]>([]);
    const [notFound, setNotFound] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState<KanbanProject | null>(null);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const projectRef = useRef<KanbanProject | null>(null);
    const zoomLevelRef = useRef(zoomLevel);
    const filterQRef = useRef(filterQ);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    zoomLevelRef.current = zoomLevel;
    filterQRef.current = filterQ;

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
            listUserstories(projectId, buildUserstoriesParams(level, query)),
            httpGet<Swimlane[]>("/swimlanes", { project: projectId }),
        ]);
        const userstories = (usResponse.data as unknown as UserStoryModel[]) ?? [];
        kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
        kanban.setUserstories(userstories);
        setNotFound(userstories.length === 0 && !!query);
    };

    const loadInitialData = async (): Promise<void> => {
        if (!Number.isFinite(projectId)) {
            return;
        }
        try {
            const projectResponse = await httpGet<KanbanProject>(
                `/projects/${projectId}`,
            );
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
                    buildUserstoriesParams(zoomLevelRef.current, filterQRef.current),
                ),
                httpGet<Swimlane[]>("/swimlanes", { project: projectId }),
            ]);
            const userstories =
                (usResponse.data as unknown as UserStoryModel[]) ?? [];
            kanban.init(project, swimlaneResponse.data ?? [], buildUsersById(project));
            kanban.setUserstories(userstories);
        } catch {
            setLoadError(true);
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
    useEffect(() => {
        if (!Number.isFinite(projectId) || !projectLoaded) {
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
    }, [projectId, projectLoaded]);

    useEffect(() => {
        return () => {
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

    const addNewUs = (_type: "standard" | "bulk", statusId: number): void => {
        // Both single and bulk creation funnel through the bulk_create endpoint
        // (the full generic user-story form is out of the migrated scope).
        setBulkStatusId(statusId);
    };

    const submitBulk = (subjects: string): void => {
        const statusId = bulkStatusId;
        setBulkStatusId(null);
        if (statusId === null || !subjects.trim()) {
            return;
        }
        void bulkCreate(projectId, statusId, subjects, null).then(() => {
            void reloadUserstories();
        });
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
                {openFilter ? <div className="kanban-filter" /> : null}

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
                        selectedUss={selectedUss}
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
