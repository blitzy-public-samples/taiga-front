/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// React hook porting KanbanController data-load + WebSocket subscription (main.coffee). Backend access only via ../../shared/api/*.

/**
 * useKanbanBoard.ts — the React 18 orchestration hook for the migrated Kanban
 * board. It owns the immer-driven `./boardReducer` state, performs the initial
 * data fetch (project + user stories + swimlanes + filters data), subscribes to
 * the live WebSocket change streams, and exposes the action callbacks the
 * container (`../KanbanApp`) and drag-and-drop context wire to the UI.
 *
 * PROVENANCE — this is a FAITHFUL BEHAVIOURAL PORT of the AngularJS
 * `KanbanController` (`app/coffee/modules/kanban/main.coffee`). The source is
 * READ-ONLY and NEVER imported; every ported routine cites its source lines
 * inline (e.g. `SOURCE 464-509`). The mapped routines are:
 *   - loadInitialData (582-594)          -> the initial-load effect
 *   - loadProject (564-580)              -> loadProject()
 *   - loadKanban (546-550) / loadUserstories (464-509) -> loadUserstories()
 *   - loadUserstoriesParams (423-436)    -> buildUserstoriesParams()
 *   - loadSwimlanes (552-562)            -> loadSwimlanes()
 *   - loadUserStoriesForStatus (511-535) -> showArchivedStatus()
 *   - eventsLoadUserstories (438-462)    -> handleUserstoriesEvent()
 *   - initializeSubscription (245-264)   -> the subscription effect + handlers
 *   - lightbox handlers (230-237) + refreshAfter… (239-243) -> handleProjectsEvent()
 *   - moveUs (596-632)                   -> move()
 *   - moveUsToTop (160-184)              -> (delegated to the container; move() is the primitive)
 *   - setZoom (127-147)                  -> the filter/search/zoom reload effect
 * The DnD permission/archived gates (`sortable.coffee:37,40`) and the
 * `kanban:us:move` payload (`sortable.coffee:153`) inform move()'s gate and
 * argument order.
 *
 * TECHNOLOGY MAPPING (confined to app/react/**):
 *   - Immutable.js board state -> immer, entirely inside `./boardReducer`; this
 *     hook only DISPATCHES actions and never calls `produce` itself.
 *   - `@events` AngularJS service -> `../../shared/events` bridge (same routing
 *     keys `changes.project.{id}.userstories|projects`, byte-for-byte).
 *   - shared resources services -> `../../shared/api/*` (same `/api/v1/`
 *     contract + `Authorization: Bearer` / `X-Session-Id` headers).
 *
 * SAFETY INVARIANTS:
 *   - Never throws during render or from an effect: every await is wrapped so a
 *     fetch failure clears `loading` and leaves a safe (empty) board.
 *   - `is_kanban_activated === false` degrades gracefully (empty board), rather
 *     than crashing, replacing the AngularJS `errorHandlingService.permissionDenied()`.
 *   - Effects are cancellable and callbacks are stable (`useCallback`) so the
 *     jsdom unit specs are deterministic and free of act() warnings.
 *   - All `localStorage`/`window` access (none required by the core path) would
 *     be guarded by `typeof window !== 'undefined'`.
 *
 * Toolchain: TypeScript 5.4.5 under `strict` + `isolatedModules` (hence
 * `import type` for every type-only symbol), Node v16.19.1 compatible, bundled
 * by esbuild into `dist/js/react.js`.
 */

import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import type { Reducer } from 'react';
import { reducer, initialState, getMovePayload } from './boardReducer';
import type { State, Action } from './boardReducer';
import { api } from '../../shared/api/client';
import { bulkUpdateKanbanOrder, filtersData } from '../../shared/api/userstories';
import type { BulkUserStoryOrder } from '../../shared/api/userstories';
import { subscribeProjectChanges } from '../../shared/events';
import type { ProjectChangeHandlers } from '../../shared/events';
import { isBoardDraggable } from '../../shared/permissions';
import type {
    Project,
    UserStory,
    Swimlane,
    Status,
    AssignedUser,
    FiltersData,
} from '../../shared/types';

/* ========================================================================== *
 * Public hook API
 * ========================================================================== */

/**
 * Inputs to {@link useKanbanBoard}. `zoomLevel`, `filterQ` and `filterParams`
 * are the resolved filter/search/zoom state the container owns and passes down;
 * a change in any of them re-fetches the board (mirroring `filtersReloadContent`
 * and `setZoom`).
 */
export type UseKanbanBoardParams = {
    /** The project whose Kanban board is rendered. */
    projectId: number;
    /**
     * Board zoom level `0..3`. `>= 2` requests `include_attachments` /
     * `include_tasks` on the user-story list (SOURCE `loadUserstoriesParams`
     * 428-430); crossing `<= 2 -> > 2` forces a reload (SOURCE `setZoom` 142-147).
     */
    zoomLevel?: number;
    /** Free-text search term (SOURCE `@.filterQ`). */
    filterQ?: string;
    /**
     * Resolved `validQueryParams` (tags, assigned_users, role, epic, owner, …),
     * already narrowed by the container (SOURCE `loadUserstoriesParams` 432-433).
     */
    filterParams?: Record<string, string | number | boolean>;
};

/**
 * The board view-model and actions returned by {@link useKanbanBoard}. The
 * collection fields are read straight from the reducer state; the derived
 * config (`project`, `usStatusList`, `swimlanesStatuses`) and the flags are
 * local hook state; the actions encapsulate the full AngularJS controller
 * pipelines so the container never dispatches directly.
 */
export type UseKanbanBoardResult = {
    // Board collections (from reducer state).
    usByStatus: State['usByStatus'];
    usMap: State['usMap'];
    usByStatusSwimlanes: State['usByStatusSwimlanes'];
    swimlanesList: State['swimlanesList'];
    // Derived config.
    /** The owning project, or `null` before load / when kanban is disabled. */
    project: Project | null;
    /** Project user-story statuses, sorted ascending by `order`. */
    usStatusList: Status[];
    /**
     * Swimlane id (string key) -> its statuses; the synthetic unclassified lane
     * key `"-1"` maps to `project.us_statuses` (SOURCE `loadSwimlanes` 557-560).
     */
    swimlanesStatuses: Record<string, Status[]>;
    // Flags.
    /** `true` once the first load resolves (SOURCE `@.initialLoad`). */
    initialLoad: boolean;
    /** `true` while a page/refresh fetch is in flight. */
    loading: boolean;
    /** `true` when an active filter/search produced zero stories. */
    notFoundUserstories: boolean;
    // Actions.
    /**
     * Persist a drag-and-drop move. Optimistically updates the board, then calls
     * `/userstories/bulk_update_kanban_order` (SOURCE `moveUs` 596-632). The
     * synthetic unclassified swimlane `-1` is mapped to the API `null`.
     */
    move: (
        usIds: number[],
        statusId: number,
        swimlaneId: number | null,
        index: number,
        previousCard: number | null,
        nextCard: number | null,
    ) => Promise<void>;
    /** Toggle a card's fold state (SOURCE service `toggleFold` 44-46). */
    toggleFold: (usId: number) => void;
    /** Reopen an archived status column and fetch its stories (SOURCE 511-535). */
    showArchivedStatus: (statusId: number) => void;
    /** Hide an archived status column (SOURCE `hideUserStoriesForStatus`). */
    hideArchivedStatus: (statusId: number) => void;
    /** Re-fetch the board with the current filters/search/zoom. */
    reload: () => void;
};

/* ========================================================================== *
 * Module-internal pure helper
 * ========================================================================== */

/**
 * Stable ascending sort by the numeric `order` field, returning a NEW array
 * (never mutating the input). Reproduces `_.sortBy(collection, "order")`
 * (SOURCE `loadProject` 576) without pulling in lodash. Missing `order` values
 * sort as `0`, matching lodash's `undefined -> 0` coercion for this data.
 */
function sortByOrder<T extends { order?: number }>(arr: T[]): T[] {
    return [...(arr ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/* ========================================================================== *
 * Hook
 * ========================================================================== */

/**
 * Orchestrate the Kanban board for a project: own the reducer state, load the
 * initial data, subscribe to live updates, and expose the board view-model plus
 * the move / fold / archived-show-hide / reload actions.
 *
 * @param params See {@link UseKanbanBoardParams}.
 * @returns See {@link UseKanbanBoardResult}.
 */
export function useKanbanBoard(params: UseKanbanBoardParams): UseKanbanBoardResult {
    const { projectId, zoomLevel, filterQ, filterParams } = params;

    // Board state. Lazy-initialised via the `initialState` factory. `boardReducer`
    // is typed `Reducer<State, Action>` so both the state and the dispatch action
    // union are explicit at the call site (SOURCE: the AngularJS
    // `KanbanUserstoriesService` instance the reducer ports).
    const boardReducer: Reducer<State, Action> = reducer;
    const [state, dispatch] = useReducer(boardReducer, undefined, initialState);

    // Flags / derived config (mirror the AngularJS scope fields).
    const [initialLoad, setInitialLoad] = useState(false);
    const [loading, setLoading] = useState(false);
    const [notFoundUserstories, setNotFoundUserstories] = useState(false);
    const [project, setProject] = useState<Project | null>(null);
    const [usStatusList, setUsStatusList] = useState<Status[]>([]);
    const [swimlanesStatuses, setSwimlanesStatuses] = useState<Record<string, Status[]>>({});

    // Subscription / request bookkeeping refs (never trigger a re-render, and
    // keep the WebSocket effect from re-subscribing on every filter change).
    // SOURCE 230-237, 261-264: defer a structural refresh while a lightbox is open.
    const isLightboxOpenedRef = useRef(false);
    const isRefreshNeededRef = useRef(false);
    // SOURCE 467-468, 487: guard against out-of-order search responses.
    const lastSearchRef = useRef<string | undefined>(undefined);
    // Member id -> resolved member, built in loadProject (SOURCE `fillUsersAndRoles` 587).
    const usersByIdRef = useRef<Record<number, AssignedUser>>({});
    // Sidebar filter facets fetched for parity (SOURCE `generateFilters` 594). Held
    // for the container's benefit; not part of the returned view-model.
    const filtersDataRef = useRef<FiltersData | null>(null);

    /* ---------------------------------------------------------------------- *
     * Data-loading closures (recreated when their filter/zoom inputs change)
     * ---------------------------------------------------------------------- */

    /**
     * Build the `/userstories` query params. SOURCE `loadUserstoriesParams`
     * 423-436: `status__is_archived: false` always; attachments/tasks at zoom
     * `>= 2`; the resolved `validQueryParams`; and `q` when a search is active.
     * `project` is included because React calls the endpoint directly (the
     * AngularJS `listAll(projectId, params)` injected it for us).
     */
    const buildUserstoriesParams = useCallback((): Record<string, string | number | boolean> => {
        const p: Record<string, string | number | boolean> = {
            project: projectId,
            status__is_archived: false,
        };

        if ((zoomLevel ?? 0) >= 2) {
            p.include_attachments = 1;
            p.include_tasks = 1;
        }

        Object.assign(p, filterParams ?? {});

        if (filterQ) {
            p.q = filterQ;
        }

        return p;
    }, [projectId, zoomLevel, filterQ, filterParams]);

    /**
     * Fetch the project detail and derive the board config. SOURCE `loadProject`
     * 564-580.
     *
     * DEVIATION (documented): the AngularJS source calls
     * `errorHandlingService.permissionDenied()` when the project has kanban
     * disabled (567-568). In React we degrade gracefully instead — we keep an
     * empty board (`project` stays `null`) and never throw or navigate, so the
     * hook can never crash the host during render/effect.
     */
    const loadProject = useCallback(async (): Promise<Project | null> => {
        // `/projects/{id}` (resources/projects.coffee:16 queryOne). The detail
        // payload carries `us_statuses`, `members`, `is_kanban_activated`, which
        // reach us through the `Project` index signature (typed `unknown`).
        const proj = await api.get<Project>('/projects/' + projectId);

        if (!proj || !proj.is_kanban_activated) {
            setProject(null);
            setUsStatusList([]);
            usersByIdRef.current = {};
            return null;
        }

        setProject(proj);

        // SOURCE 576: usStatusList = _.sortBy(project.us_statuses, "order").
        const usStatuses = (proj.us_statuses as Status[] | undefined) ?? [];
        setUsStatusList(sortByOrder(usStatuses));

        // SOURCE 587: build usersById from members. taiga `groupBy`
        // (utils.coffee:80-85) yields a SINGLE-VALUE map (last wins), NOT arrays.
        const members = (proj.members as AssignedUser[] | undefined) ?? [];
        const usersById: Record<number, AssignedUser> = {};
        for (const m of members) {
            usersById[m.id] = m;
        }
        usersByIdRef.current = usersById;

        return proj;
    }, [projectId]);

    /**
     * Fetch the project's swimlanes and index each lane's statuses. SOURCE
     * `loadSwimlanes` 552-562: `swimlanesStatuses[swimlane.id] = swimlane.statuses`
     * and `swimlanesStatuses[-1] = project.us_statuses` for the unclassified lane.
     */
    const loadSwimlanes = useCallback(
        async (proj: Project): Promise<Swimlane[]> => {
            const swimlanes = await api.get<Swimlane[]>('/swimlanes', { project: projectId });

            const map: Record<string, Status[]> = {};
            for (const s of swimlanes) {
                // `statuses` reaches us via the `Swimlane` index signature (unknown).
                map[String(s.id)] = (s.statuses as Status[] | undefined) ?? [];
            }
            map['-1'] = (proj.us_statuses as Status[] | undefined) ?? [];

            setSwimlanesStatuses(map);
            return swimlanes;
        },
        [projectId],
    );

    /**
     * Load the board's user stories (and swimlanes) and render them. SOURCE
     * `loadUserstories` 464-509 + `loadKanban` 546-550.
     *
     * Ordering and side effects are preserved exactly: build params -> capture
     * the search term for the stale-response guard -> fetch stories + swimlanes
     * in parallel -> drop a stale response -> reset(false,false,false) -> init ->
     * compute notFound -> set (the reducer sorts by order internally). The
     * archived-status extra fetches (SOURCE 476-484) are deferred to
     * {@link useKanbanBoard}'s `showArchivedStatus`, keeping the initial load to
     * the non-archived stories.
     */
    const loadUserstories = useCallback(
        async (proj: Project): Promise<void> => {
            const p = buildUserstoriesParams();

            // SOURCE 467-468: remember the search term of this request.
            lastSearchRef.current = filterQ;
            const thisSearch = filterQ;

            // SOURCE 471-474: stories + swimlanes in parallel.
            const [userstories, swimlanes] = await Promise.all([
                api.get<UserStory[]>('/userstories', p),
                loadSwimlanes(proj),
            ]);

            // SOURCE 487-488: a newer search superseded this one — drop the result.
            if (thisSearch !== lastSearchRef.current) {
                return;
            }

            // SOURCE 490: reset(false,false,false) — keep swimlanesList / archived
            // / hidden status collections across a refresh.
            dispatch({
                type: 'RESET',
                resetSwimlanesList: false,
                resetArchivedStatus: false,
                resetHideStatud: false,
            });

            // SOURCE 503: init(project, swimlanes, usersById).
            dispatch({
                type: 'INIT',
                project: proj,
                swimlanes,
                usersById: usersByIdRef.current,
            });

            // SOURCE 498-501: notFound when an active filter/search yields nothing.
            const hasActiveFilter =
                (!!filterQ && filterQ.length > 0) || Object.keys(filterParams ?? {}).length > 0;
            setNotFoundUserstories(userstories.length === 0 && hasActiveFilter);

            // SOURCE 505 renderUserStories -> service.set: the reducer sorts the
            // raw list by `order` internally after refreshing the order snapshot.
            dispatch({ type: 'SET', userstories });
        },
        [buildUserstoriesParams, loadSwimlanes, filterQ, filterParams],
    );


    /* ---------------------------------------------------------------------- *
     * Latest-closure refs
     *
     * The WebSocket subscription and the initial-load effect key on `projectId`
     * ONLY, so they never re-subscribe / re-run on a mere filter change. To let
     * those long-lived effects still call the freshest logic (which closes over
     * the current filters/zoom), we mirror the latest closures + project into
     * refs that update on every render. Effects then read `<ref>.current`.
     * ---------------------------------------------------------------------- */
    const projectRef = useRef<Project | null>(null);
    const loadProjectRef = useRef(loadProject);
    const loadUserstoriesRef = useRef(loadUserstories);
    const buildParamsRef = useRef(buildUserstoriesParams);

    useEffect(() => {
        projectRef.current = project;
        loadProjectRef.current = loadProject;
        loadUserstoriesRef.current = loadUserstories;
        buildParamsRef.current = buildUserstoriesParams;
    });

    /* ---------------------------------------------------------------------- *
     * WebSocket event handlers (stable; read fresh logic through refs)
     * ---------------------------------------------------------------------- */

    /**
     * Handle a `changes.project.{id}.userstories` frame. SOURCE
     * `eventsLoadUserstories` 438-462: re-list with the current params, then let
     * the reducer merge modified/new stories and refresh. Best-effort — a
     * transient failure is swallowed so a dropped frame never crashes the board.
     */
    const handleUserstoriesEvent = useCallback(async (): Promise<void> => {
        try {
            const p = buildParamsRef.current();
            const userstories = await api.get<UserStory[]>('/userstories', p);
            dispatch({ type: 'EVENTS_LOAD', userstories });
        } catch {
            /* live refresh is best-effort; ignore transient failures */
        }
    }, []);

    /**
     * Handle a `changes.project.{id}.projects` frame. SOURCE
     * `initializeSubscription` 256-264: only the swimlane/status structural
     * changes trigger a full re-init, and the refresh is DEFERRED while a
     * lightbox is open. Both in-scope lightboxes are now React-owned, so no
     * public "lightbox opened" setter is exposed (the return shape is fixed);
     * `isLightboxOpenedRef` stays `false` by default, which faithfully preserves
     * the AngularJS "refresh immediately" path (SOURCE 261-264 with the flag
     * false). The `isRefreshNeededRef` deferral scaffolding is retained per the
     * source so a sibling can wire the flags later without a behaviour change.
     * The full reload mirrors
     * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged` 239-243
     * (fetch project, then reload the board).
     *
     * `message` is the frame payload (`data.data`) from the events bridge; it is
     * narrowed defensively before its `matches` discriminator is read.
     */
    const handleProjectsEvent = useCallback(async (message: unknown): Promise<void> => {
        const matches =
            message && typeof message === 'object'
                ? (message as { matches?: unknown }).matches
                : undefined;

        if (
            matches !== 'projects.swimlane' &&
            matches !== 'projects.swimlaneuserstorystatus' &&
            matches !== 'projects.userstorystatus'
        ) {
            return;
        }

        // SOURCE 261-262: defer while a lightbox is open.
        if (isLightboxOpenedRef.current) {
            isRefreshNeededRef.current = true;
            return;
        }

        try {
            const proj = await loadProjectRef.current();
            if (!proj) {
                return;
            }
            await loadUserstoriesRef.current(proj);
        } catch {
            /* ignore transient failures */
        }
    }, []);

    /* ---------------------------------------------------------------------- *
     * Action callbacks (returned to the container / DnD context)
     * ---------------------------------------------------------------------- */

    /**
     * Persist a drag-and-drop move — the full pipeline of `moveUs` 596-632.
     * Because `dispatch` is private to this hook, the container cannot dispatch
     * directly; this callback owns the whole sequence:
     *   1. map the synthetic unclassified swimlane `-1` to the API `null`
     *      (SOURCE 606-608) BEFORE both the optimistic dispatch and the payload;
     *   2. optimistically update the board (reducer MOVE);
     *   3. compute the wire payload and persist via the shared api;
     *   4. on failure, reconcile the board with the server.
     */
    const move = useCallback(
        async (
            usIds: number[],
            statusId: number,
            swimlaneId: number | null,
            index: number,
            previousCard: number | null,
            nextCard: number | null,
        ): Promise<void> => {
            // Defensive parity gate. The PRIMARY gate lives in the DnD sibling
            // (`dnd/KanbanDndContext.tsx`, SOURCE sortable.coffee:37 `modify_us`,
            // :40 `archived_code`); this secondary guard preserves the same
            // security invariant if move() is ever invoked programmatically
            // (e.g. keyboard DnD, move-to-top). It does not relocate the primary gate.
            if (!isBoardDraggable(projectRef.current)) {
                return;
            }

            // SOURCE 606-608: the synthetic unclassified swimlane (-1) is the API `null`.
            const apiSwimlaneId = swimlaneId === -1 ? null : swimlaneId;

            // (2) Optimistic local update; the reducer receives the API swimlane.
            dispatch({
                type: 'MOVE',
                usIds,
                statusId,
                swimlaneId: apiSwimlaneId,
                index,
                previousCard,
                nextCard,
            });

            // (3) Pure echo of the request body (SOURCE 184-190 in the service).
            const payload = getMovePayload(usIds, statusId, apiSwimlaneId, previousCard, nextCard);

            try {
                // CRITICAL kanban wire contract: `bulkUserstories` is a PLAIN
                // `number[]` of ids — NOT `{us_id, order}` objects. The kanban
                // endpoint posts the id array as-is
                // (resources/userstories.coffee:112-129; main.coffee:609-625). The
                // sibling types the last param `BulkUserStoryOrder[]`, so we forward
                // the id array through a documented double-cast (no runtime change).
                await bulkUpdateKanbanOrder(
                    projectId,
                    statusId,
                    apiSwimlaneId,
                    payload.afterUserstoryId,
                    payload.beforeUserstoryId,
                    payload.bulkUserstories as unknown as BulkUserStoryOrder[],
                );
            } catch {
                // On persistence failure, reconcile the board with the server so
                // the optimistic update cannot leave the UI out of sync.
                const proj = projectRef.current;
                if (proj) {
                    void loadUserstoriesRef.current(proj);
                }
            }
        },
        [projectId],
    );

    /**
     * Toggle a card's fold state. SOURCE service `toggleFold` 44-46 — a pure
     * dispatch (the localStorage fold persistence in resources/kanban.coffee is
     * OPTIONAL parity and intentionally not reproduced here to avoid overbuild).
     */
    const toggleFold = useCallback((usId: number): void => {
        dispatch({ type: 'TOGGLE_FOLD', usId });
    }, []);

    /**
     * Reopen an archived status column and fetch its stories. SOURCE
     * `addArchivedStatus` + `loadUserStoriesForStatus` 511-535: mark the status
     * archived + shown, then fetch its (attachment/task-inclusive) stories and
     * add them to the board. Best-effort; a fetch failure leaves the column open
     * but empty rather than throwing.
     */
    const showArchivedStatus = useCallback(
        async (statusId: number): Promise<void> => {
            dispatch({ type: 'ADD_ARCHIVED_STATUS', statusId });
            dispatch({ type: 'SHOW_STATUS', statusId });

            try {
                const p: Record<string, string | number | boolean> = {
                    project: projectId,
                    status: statusId,
                    include_attachments: true,
                    include_tasks: true,
                };
                if (filterQ) {
                    p.q = filterQ;
                }
                const stories = await api.get<UserStory[]>('/userstories', p);
                dispatch({ type: 'ADD', usList: stories });
            } catch {
                /* reopening an archived column is best-effort */
            }
        },
        [projectId, filterQ],
    );

    /**
     * Hide an archived status column. SOURCE `hideUserStoriesForStatus` /
     * service `hideStatus` 123-125 — a pure dispatch.
     */
    const hideArchivedStatus = useCallback((statusId: number): void => {
        dispatch({ type: 'HIDE_STATUS', statusId });
    }, []);

    /**
     * Re-fetch the board with the current filters/search/zoom. Used by the
     * container on an explicit refresh (SOURCE `filtersReloadContent` 149-155).
     * Stable across renders; reads the freshest project + loader through refs.
     */
    const reload = useCallback((): void => {
        const proj = projectRef.current;
        if (proj) {
            void loadUserstoriesRef.current(proj);
        }
    }, []);

    /* ---------------------------------------------------------------------- *
     * Effects
     * ---------------------------------------------------------------------- */

    // (1) Initial load — SOURCE `loadInitialData` 582-594. Runs once per project:
    // loadProject -> loadUserstories (parallel list + swimlanes) -> filtersData
    // -> initialLoad = true. Cancellable, and wrapped so it never throws from the
    // effect (a failure clears `loading` and leaves the safe empty board).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        void (async () => {
            try {
                const proj = await loadProjectRef.current();
                if (cancelled || !proj) {
                    return;
                }
                await loadUserstoriesRef.current(proj);
                if (cancelled) {
                    return;
                }
                // SOURCE 594 generateFilters — non-critical; stored for the container.
                try {
                    const fd = await filtersData(projectId, buildParamsRef.current());
                    if (!cancelled) {
                        filtersDataRef.current = fd;
                    }
                } catch {
                    /* filters are non-critical; ignore */
                }
            } catch {
                /* never throw from an effect; keep the safe empty board */
            } finally {
                if (!cancelled) {
                    setInitialLoad(true);
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [projectId]);

    // (2) Live-update subscription — SOURCE `initializeSubscription` 245-264.
    // Subscribes on mount / projectId change; the returned unsubscribe IS the
    // effect cleanup. The events bridge is disabled-safe, so this is a no-op when
    // live updates are unavailable. The handlers are stable (deps []), so this
    // effect never re-subscribes on a filter change — matching the source, which
    // subscribes exactly once.
    useEffect(() => {
        const handlers: ProjectChangeHandlers = {
            onUserstories: () => {
                void handleUserstoriesEvent();
            },
            onProjects: (message) => {
                void handleProjectsEvent(message);
            },
        };
        const unsubscribe = subscribeProjectChanges(projectId, handlers);
        return unsubscribe;
    }, [projectId, handleUserstoriesEvent, handleProjectsEvent]);

    // (3) Filter / search / zoom reload — SOURCE `filtersReloadContent` 149-155
    // and `setZoom` 142-147 (a reload is required when crossing zoom `<= 2 -> > 2`
    // to fetch include_attachments/include_tasks). The FIRST run is skipped
    // because the initial-load effect already fetched with these inputs; every
    // subsequent change re-fetches with the freshest loader.
    const filtersKey = JSON.stringify({
        q: filterQ ?? '',
        params: filterParams ?? {},
        zoom: zoomLevel ?? 0,
    });
    const filtersInitializedRef = useRef(false);
    useEffect(() => {
        if (!filtersInitializedRef.current) {
            filtersInitializedRef.current = true;
            return;
        }
        const proj = projectRef.current;
        if (!proj) {
            return;
        }
        void loadUserstoriesRef.current(proj);
    }, [filtersKey]);

    /* ---------------------------------------------------------------------- *
     * Returned view-model + actions (exact key set)
     * ---------------------------------------------------------------------- */
    return {
        usByStatus: state.usByStatus,
        usMap: state.usMap,
        usByStatusSwimlanes: state.usByStatusSwimlanes,
        swimlanesList: state.swimlanesList,
        project,
        usStatusList,
        swimlanesStatuses,
        initialLoad,
        loading,
        notFoundUserstories,
        move,
        toggleFold,
        showArchivedStatus,
        hideArchivedStatus,
        reload,
    };
}

