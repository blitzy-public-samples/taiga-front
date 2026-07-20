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
import { bulkUpdateKanbanOrder } from '../../shared/api/userstories';
import { describeReorderError } from '../../shared/apiError';
import { subscribeProjectChanges } from '../../shared/events';
import type { ProjectChangeHandlers } from '../../shared/events';
import { isBoardDraggable, canMutate } from '../../shared/permissions';
import type {
    Project,
    UserStory,
    Swimlane,
    Status,
    AssignedUser,
    UsMap,
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
    /**
     * F-AAP-10: `true` when the LAST initial load (or live/reload refresh)
     * FAILED. Deliberately DISTINCT from "loaded but empty": the first React cut
     * swallowed the initial-load error in the effect `catch` and merely set
     * `initialLoad = true`, so a failed load rendered IDENTICALLY to a
     * legitimately empty Kanban board. The container can now tell them apart and
     * offer a retry (`reload`). Cleared at the start of every (re)load; set
     * `true` when a load/refresh rejects. Init `false`.
     */
    loadError: boolean;
    /** `true` when an active filter/search produced zero stories. */
    notFoundUserstories: boolean;
    /**
     * F-AAP-03 (dest#8): user-facing message set when a drag-and-drop reorder
     * write (`bulk_update_kanban_order`) is REJECTED. Previously the `move()`
     * catch reconciled the board silently, so a failed move produced NO
     * feedback. `null` when there is no error. Rendered by `KanbanApp` as a
     * dismissible <NotificationError> toast; the board is already reconciled to
     * server truth (reload-on-error), so this only tells the user WHY it reverted.
     */
    moveError: string | null;
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
    /**
     * Delete a single user story (SOURCE `deleteUserStory` 289-304): archive-aware
     * `delete_us` gate, optimistic `REMOVE`, `DELETE /userstories/{id}`, and
     * reload-on-error reconciliation. The confirm dialog is owned by the container.
     */
    deleteUserStory: (usId: number) => Promise<void>;
    /**
     * F-AAP-03 (dest#8): dismiss the drag-and-drop error toast, clearing
     * `moveError` back to `null`. The board was already reconciled to server
     * truth at failure time, so this only removes the user-facing message.
     */
    clearMoveError: () => void;
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
    // F-AAP-10: initial/refresh load-failure flag (distinct from empty).
    const [loadError, setLoadError] = useState(false);
    const [notFoundUserstories, setNotFoundUserstories] = useState(false);
    // F-AAP-03 (dest#8): user-facing drag-and-drop reorder error. Set when
    // `bulk_update_kanban_order` rejects; cleared at the start of each move()
    // and when the user dismisses the toast.
    const [moveError, setMoveError] = useState<string | null>(null);
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
    // F-CQ-02: latest board index so the stable `deleteUserStory` action can
    // resolve a story's model (id + status) without a stale closure.
    const usMapRef = useRef<UsMap>({});
    // Issue 3 (offline in-place revert): latest raw board so the stable `move`
    // action can capture an immutable pre-move snapshot without a stale closure.
    const userstoriesRawRef = useRef<UserStory[]>([]);

    useEffect(() => {
        projectRef.current = project;
        loadProjectRef.current = loadProject;
        loadUserstoriesRef.current = loadUserstories;
        buildParamsRef.current = buildUserstoriesParams;
        usMapRef.current = state.usMap;
        userstoriesRawRef.current = state.userstoriesRaw;
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

            // F-AAP-03: clear any stale error from a previous failed move so the
            // toast reflects only the outcome of THIS attempt.
            setMoveError(null);

            // SOURCE 606-608: the synthetic unclassified swimlane (-1) is the API `null`.
            // F-AAP-09 (data integrity): also coerce a NaN swimlane to `null`. The
            // primary normalization lives at the DnD boundary, but move() may be
            // invoked programmatically (keyboard DnD / move-to-top) with a raw
            // value, so this secondary guard ensures neither the optimistic reducer
            // dispatch nor the API body can ever receive NaN.
            const apiSwimlaneId =
                swimlaneId === -1 || (typeof swimlaneId === 'number' && Number.isNaN(swimlaneId))
                    ? null
                    : swimlaneId;

            // Issue 3 (offline in-place revert): capture the pre-move board
            // snapshot BEFORE the optimistic dispatch. The reducer runs under
            // immer, which froze these `userstoriesRaw` objects and produces NEW
            // objects for the moved stories — so this array reference stays the
            // untouched, immutable pre-move arrangement even after MOVE mutates
            // the draft. It is a safe snapshot to revert to on failure.
            const preMove = userstoriesRawRef.current;

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
                // endpoint posts the id array as-is (kanban/main.coffee:609-625;
                // backend validator `bulk_userstories =
                // ListField(child=IntegerField(min_value=1))`). `getMovePayload`
                // already yields `number[]` and `bulkUpdateKanbanOrder` now types
                // its last param `number[]`, so the id array is forwarded directly
                // with NO cast — the request body is byte-for-byte identical.
                await bulkUpdateKanbanOrder(
                    projectId,
                    statusId,
                    apiSwimlaneId,
                    payload.afterUserstoryId,
                    payload.beforeUserstoryId,
                    payload.bulkUserstories,
                );
            } catch (err) {
                // F-AAP-03 (dest#8): surface an ACTIONABLE, user-facing error
                // (no internal details) so a rejected move is no longer silent.
                setMoveError(describeReorderError(err));
                // Issue 3 (offline in-place revert): FIRST undo the optimistic
                // move LOCALLY by restoring the captured pre-move snapshot. `SET`
                // rebuilds every derived structure (order + swimlanes + usMap)
                // from the snapshot, so the card visibly snaps back to its exact
                // prior position IMMEDIATELY — even when the client is offline and
                // the server reconciliation below cannot run. This removes the
                // sole dependency on a successful re-fetch to undo a failed move.
                dispatch({ type: 'SET', userstories: preMove });
                // Then STILL reconcile with the server: when the network is
                // available a successful re-fetch simply overwrites the reverted
                // snapshot with authoritative server state; when it also fails
                // (offline), the correct in-place revert above is left intact.
                // This reconciliation is BEST-EFFORT — its rejection is swallowed
                // so an offline re-fetch cannot surface as an unhandled promise
                // rejection (the board is already correctly reverted above).
                const proj = projectRef.current;
                if (proj) {
                    void loadUserstoriesRef.current(proj).catch(() => {
                        /* offline / transient — in-place revert already applied */
                    });
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
        if (!proj) {
            return;
        }
        // F-AAP-10: centralize the retry — clear the failure flag, re-fetch, and
        // SURFACE a fresh failure rather than swallowing it. The previous
        // `void loadUserstories()` discarded the rejection, so a failed refresh
        // was invisible. `reload` stays fire-and-forget for the container, but
        // the outcome is now observable through `loadError`.
        setLoadError(false);
        void (async () => {
            try {
                await loadUserstoriesRef.current(proj);
            } catch {
                setLoadError(true);
            }
        })();
    }, []);

    /**
     * Delete a single user story. This is the ONE Kanban CRUD control the legacy
     * `KanbanController` OWNED directly rather than delegating to the common
     * module: `deleteUserStory` (SOURCE main.coffee 289-304) called
     * `@confirm.askOnDelete(...)` and, on confirmation, `@repo.remove(model)`
     * followed by `$scope.$broadcast("kanban:us:deleted", model)` which the
     * board's `kanban:us:deleted` handler (SOURCE 216-224) reacted to by pruning
     * the story from the board state.
     *
     * F-CQ-02 faithful port:
     *   - The confirm dialog (`$confirm.askOnDelete`) has no React equivalent in
     *     the AAP §0.4.1 manifest, so we reuse the established `window.confirm`
     *     stand-in already used by `CreateEditSprintLightbox` (documented pattern).
     *   - The removal is persisted directly via `api.del('/userstories/{id}')`
     *     (the same `/api/v1/` DELETE the AngularJS `@repo.remove` issued).
     *   - The optimistic board prune reproduces the `kanban:us:deleted` handler
     *     through the reducer's `REMOVE` action (mirrors the service `remove`).
     *   - Defense-in-depth permission gate via `canMutate(project, 'delete_us')`
     *     (archive-aware, F-REG-03); the container gates the affordance too.
     *   - On persistence failure the board is reconciled with the server so an
     *     optimistic prune can never leave the UI out of sync (mirrors move()).
     *
     * Stable across renders; reads the freshest project + board index via refs.
     */
    const deleteUserStory = useCallback(
        async (usId: number): Promise<void> => {
            const proj = projectRef.current;
            // Defense-in-depth: archive-aware `delete_us` gate. The container
            // gates the affordance, but this guard preserves the invariant if
            // deleteUserStory is ever invoked programmatically.
            if (!canMutate(proj, 'delete_us')) {
                return;
            }
            // Resolve the story's model (id + status) from the freshest board
            // index so the optimistic `REMOVE` can prune the correct column.
            const card = usMapRef.current[usId];
            if (!card) {
                return;
            }
            const usModel = card.model;

            // (1) Optimistic prune — mirrors the `kanban:us:deleted` handler.
            dispatch({ type: 'REMOVE', usModel });

            try {
                // (2) Persist the deletion via the same `/api/v1/` DELETE the
                // AngularJS `@repo.remove(model)` issued.
                await api.del(`/userstories/${usId}`);
            } catch {
                // (3) On failure, reconcile the board with the server so the
                // optimistic prune cannot leave the UI out of sync.
                if (proj) {
                    void loadUserstoriesRef.current(proj);
                }
            }
        },
        [],
    );

    /* ---------------------------------------------------------------------- *
     * Effects
     * ---------------------------------------------------------------------- */

    // (1) Initial load — SOURCE `loadInitialData` 582-594. Runs once per project:
    // loadProject -> loadUserstories (parallel list + swimlanes)
    // -> initialLoad = true. Cancellable, and wrapped so it never throws from the
    // effect (a failure clears `loading` and leaves the safe empty board).
    useEffect(() => {
        // A2 (F-REG-02): do NOT fetch with an invalid/placeholder project id.
        // While `useResolvedProjectId` resolves (projectId === 0), or if the id is
        // otherwise not a positive integer, skip the load entirely so NO
        // `GET /projects/0` (or `/projects/NaN`) probe is ever issued — aligning
        // Kanban with the Backlog hook's existing `if (!projectId) return` guard.
        // The effect re-runs (dep `[projectId]`) the moment a real id resolves, at
        // which point the full load below fires against the correct project.
        if (!Number.isInteger(projectId) || projectId <= 0) {
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        // F-AAP-10: clear any prior failure at the start of a fresh load so the
        // error state does not persist across a successful reload.
        setLoadError(false);

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
                // Sidebar filters-data is fetched by the container (KanbanApp) for
                // the sidebar facets; the hook no longer duplicates that request.
            } catch {
                // F-AAP-10: SURFACE the failure instead of silently leaving a
                // "successful empty board". Guarded by `cancelled` so a
                // superseded load (unmount / projectId change) cannot flip the
                // flag of a newer one. Still never THROWS from the effect.
                if (!cancelled) {
                    setLoadError(true);
                }
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
        // A2 (F-REG-02): never subscribe with an invalid/placeholder project id —
        // a `subscribeProjectChanges(0, …)` would register bogus
        // `changes.project.0.*` routing keys. Skip while resolving (projectId ===
        // 0) or when the id is not a positive integer; the effect re-runs and
        // subscribes with the correct id once it resolves (mirrors the Backlog
        // hook's `if (!projectId) return` subscribe guard).
        if (!Number.isInteger(projectId) || projectId <= 0) {
            return undefined;
        }

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

    /**
     * F-AAP-03 (dest#8): dismiss the drag-and-drop error toast, clearing
     * `moveError` back to `null`. The board was already reconciled to server
     * truth at failure time, so this only removes the user-facing message.
     */
    const clearMoveError = useCallback((): void => {
        setMoveError(null);
    }, []);

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
        loadError,
        notFoundUserstories,
        moveError,
        move,
        toggleFold,
        showArchivedStatus,
        hideArchivedStatus,
        reload,
        deleteUserStory,
        clearMoveError,
    };
}

