/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklog.ts — the EFFECTFUL state hook for the migrated React
 * Backlog / Sprint-planning screen.
 *
 * WHAT THIS IS
 *   This hook wraps the PURE `./backlogReducer.ts` with `useReducer` and owns
 *   everything the pure reducer must NOT do: the initial data load, the live
 *   WebSocket subscription, and every thunk-style action (the `/api/v1/` calls
 *   plus the optimistic-drag pending queue). It is the React re-expression of
 *   the AngularJS `BacklogController` EFFECTS
 *   (`app/coffee/modules/backlog/main.coffee` —
 *   `loadProject`/`loadBacklog`/`loadInitialData`/`loadProjectStats`/
 *   `loadSprints`/`loadClosedSprints`/`loadUserstories`/
 *   `loadAllPaginatedUserstories`/`initializeSubscription`/`moveUs`/
 *   `moveToSprint`/`findCurrentSprint`) together with the drag payload shape
 *   from `sortable.coffee`.
 *
 * BEHAVIOURAL PARITY (hard requirement — AAP §0.1.1, §0.7.1)
 *   Every effect reproduces the AngularJS behaviour EXACTLY (zero feature
 *   change): the same `/api/v1/` REST contract, the same WebSocket routing keys
 *   (`changes.project.{id}.userstories|milestones`), and the same request
 *   bodies. Source line references are cited inline throughout.
 *
 * SEPARATION OF CONCERNS
 *   - The PURE optimistic-move math, the reconciliation math and all derived
 *     board fields live in `./backlogReducer.ts`; this hook merely DISPATCHES
 *     the corresponding actions and never re-implements that math.
 *   - All backend / session / events access flows exclusively through
 *     `../../shared/**`; this file imports NO AngularJS module, NO
 *     `resources.coffee`, and NONE of the globally-loaded libraries the
 *     migration replaces (Immutable.js, dragula, dom-autoscroller, checksley).
 *     `immer` is NOT used here (it belongs to the reducer). `moment` IS used
 *     here — but ONLY for the `findCurrentSprint` date math (it must not leak
 *     into the pure reducer).
 *
 * CONSUMER CONTRACT
 *   `const { state, actions } = useBacklog(projectId)` where `projectId` is
 *   ALREADY a number (the sibling `../BacklogApp.tsx` calls
 *   `Number(props.projectId)`). Returns `{ state: BacklogState, actions }` where
 *   `actions` is a referentially-stable, memoized object exposing every thunk
 *   the Backlog UI needs.
 *
 * Toolchain: TypeScript 5.4.5 under `strict`, `jsx: "react-jsx"` (NO
 * `import React`), Node v16.19.1 compatible. Bundled by esbuild into
 * `dist/js/react.js`.
 */

import { useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
// F-PERF-01: use the shell's already-loaded global Moment (see shared/moment.ts) so
// esbuild does not bundle a second ~60 KB copy of Moment into react.js.
import moment from '../../shared/moment';

import {
    backlogReducer,
    initialBacklogState,
    BacklogState,
    BacklogStats,
} from './backlogReducer';
import type { Project, UserStory, Milestone } from '../../shared/types';
import { api } from '../../shared/api/client';
import { parseApiErrorMessage, describeReorderError } from '../../shared/apiError';
import {
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    filtersData as fetchFiltersData,
    BulkUserStoryOrder,
} from '../../shared/api/userstories';
import {
    listMilestones,
    createMilestone,
    saveMilestone,
    MilestoneCreatePayload,
} from '../../shared/api/milestones';
import { subscribeProjectChanges, isEventsConnected } from '../../shared/events';

/* ========================================================================== *
 * Phase 1 — Module constants & helpers
 * ========================================================================== */

/**
 * The page size sent on a NORMAL (initial / reset / paginated) backlog load.
 *
 * FIDELITY: the AngularJS source loads the backlog via
 * `listUnassigned(projectId, params, pageSize)` with `pageSize` UNDEFINED on
 * every normal load (`main.coffee:335-339,341-359` via `loadBacklog`), so the
 * backend applies its OWN default page size and the request carries no
 * `page_size` parameter (`resources/userstories.coffee:45-55`). Only
 * `reloadAllPaginatedUserstories` (below) passes an explicit page size.
 * Modelled as `undefined` so the `page_size` param is only ever attached when a
 * concrete size is supplied — never on the normal path.
 */
const PAGE_SIZE_DEFAULT: number | undefined = undefined;

/**
 * Return the OPEN sprint whose `[estimated_start, estimated_finish]` date range
 * contains "now", or `null` when none does. Reproduces `findCurrentSprint`
 * (`main.coffee:696-703`) EXACTLY.
 *
 * The AngularJS source compared `new Date().getTime()` (a NUMBER, ms epoch)
 * against `moment(date, 'YYYY-MM-DD').format('x')` (a STRING, ms epoch); the
 * `number <= string` comparison coerced the strings to numbers. We coerce all
 * three values with `Number(...)` so the comparison is unambiguously numeric
 * (behaviour-preserving) rather than accidentally lexicographic. Only OPEN
 * sprints are passed in (the source ran this over `@scope.sprints`).
 */
function findCurrentSprint(sprints: Milestone[]): Milestone | null {
    const now = Number(moment().format('x')); // ms epoch, matching `new Date().getTime()`
    const found = sprints.find((sprint) => {
        const start = Number(moment(sprint.estimated_start, 'YYYY-MM-DD').format('x'));
        const finish = Number(moment(sprint.estimated_finish, 'YYYY-MM-DD').format('x'));
        return start <= now && now <= finish;
    });
    return found ?? null;
}

/**
 * Derive the two view fields the AngularJS controller stored alongside the raw
 * `/projects/{id}/stats` payload, reproducing `loadProjectStats`
 * (`main.coffee:256-268`):
 *   - `completedPercentage = round(100 * closed_points / (total_points ||
 *     defined_points))`, or `0` when the basis is falsy;
 *   - `showGraphPlaceholder = !(total_points? && total_milestones?)`.
 *
 * The `total_points || defined_points` basis and the `Math.round` are preserved
 * byte-for-byte. The raw payload is spread through unchanged (its index
 * signature carries every other backend key), and `speed` defaults to `0` so
 * the reducer's forecasting loop always has a numeric velocity.
 */
function computeStats(raw: Record<string, unknown>): BacklogStats {
    const total_points = raw.total_points as number | undefined;
    const defined_points = raw.defined_points as number | undefined;
    const closed_points = (raw.closed_points as number | undefined) ?? 0;
    const total_milestones = raw.total_milestones as number | undefined;

    // Source `if stats.total_points then stats.total_points else stats.defined_points`.
    const totalPointsBasis = (total_points ?? 0) || (defined_points ?? 0);
    const completedPercentage = totalPointsBasis
        ? Math.round((100 * closed_points) / totalPointsBasis)
        : 0;

    // Source `!(stats.total_points? && stats.total_milestones?)`.
    const showGraphPlaceholder = !(total_points != null && total_milestones != null);

    return {
        ...(raw as BacklogStats),
        completedPercentage,
        showGraphPlaceholder,
        speed: (raw.speed as number | undefined) ?? 0,
    };
}

/**
 * The AngularJS `@events.connected` flag consulted after a drag settles
 * (`main.coffee:634` — `if !@events.connected` → hard-reload).
 *
 * F-AAP-03: this now reports the REAL socket state via
 * {@link isEventsConnected}, not merely whether an events URL is CONFIGURED.
 * The previous implementation returned `!!getEventsUrl()`, so a configured-but-
 * disconnected socket (still connecting, in reconnect backoff, errored, or torn
 * down) was wrongly treated as "connected", causing the post-drag reconcile
 * reload to be skipped and leaving the board stale. Reading the live flag means
 * the fallback reload runs whenever pushes will NOT actually refresh the board:
 *   - events disabled (bridge never created) → `false` → reload (unchanged);
 *   - configured but socket not open        → `false` → reload (the fix);
 *   - socket genuinely open                  → `true`  → skip (pushes refresh).
 */
function eventsConnected(): boolean {
    return isEventsConnected();
}

/**
 * F-CQ-03 — describe a failed single-story mutation (delete / status / points).
 *
 * Surfaces the backend field error when present (via the shared
 * {@link parseApiErrorMessage}, which parses the Django REST `_error_message` /
 * `__all__` envelope without leaking internal details), otherwise the supplied
 * operation-specific fallback. Reorder / move failures use the shared
 * {@link describeReorderError} directly; this local wrapper only exists to thread
 * a per-operation fallback sentence.
 */
function describeUsMutationError(err: unknown, fallback: string): string {
    return parseApiErrorMessage(err) ?? fallback;
}

/* ========================================================================== *
 * F-CQ-09 — project-scoped "show tags" persistence
 *
 * The AngularJS Backlog persisted the tag-visibility preference PER PROJECT via
 * `rs.userstories.storeShowTags(projectId, value)` and rehydrated it on load
 * via `getShowTags(projectId)` (`main.coffee:236-239,501-502`,
 * `resources/userstories.coffee:169-177`, which wrote `$storage` keyed by a
 * per-project hash). The first React cut left a reducer comment claiming the
 * hook persisted this, but the hook did NOT — an ownership/behaviour mismatch
 * (F-CQ-09). These helpers make the claim TRUE: the hook now writes on every
 * toggle and reads back on mount per `projectId`.
 *
 * The legacy AngularJS Backlog screen is REMOVED, so sharing its exact
 * `hex_sha1` storage key is unnecessary (nothing else reads it); a clear,
 * stable, project-scoped key is used instead. All access is wrapped so a
 * storage-less / privacy-mode environment (or jsdom without a backing store)
 * degrades gracefully to "not persisted" rather than throwing.
 * ========================================================================== */

const SHOW_TAGS_STORAGE_PREFIX = 'taiga.react.backlog.show-tags.';

/**
 * Read the persisted show-tags preference for a project, or `null` when none
 * was stored (or storage is unavailable). Reproduces `getShowTags`.
 */
function readStoredShowTags(projectId: number): boolean | null {
    try {
        const raw = window.localStorage.getItem(`${SHOW_TAGS_STORAGE_PREFIX}${projectId}`);
        if (raw === null) {
            return null;
        }
        return raw === 'true';
    } catch {
        // Storage unavailable (privacy mode / sandbox) — treat as "not stored".
        return null;
    }
}

/**
 * Persist the show-tags preference for a project. Reproduces `storeShowTags`.
 * Failures are swallowed (persistence is a convenience, never load-critical).
 */
function writeStoredShowTags(projectId: number, value: boolean): void {
    try {
        window.localStorage.setItem(
            `${SHOW_TAGS_STORAGE_PREFIX}${projectId}`,
            value ? 'true' : 'false',
        );
    } catch {
        /* storage unavailable — non-critical, silently skip persistence */
    }
}

/* ========================================================================== *
 * Phase 2 — The hook: skeleton, refs and the reducer
 * ========================================================================== */

/**
 * A single queued drag operation — the React mirror of an entry in the
 * AngularJS `@scope.pendingDrag` array (`main.coffee:540-546`).
 */
interface PendingDrag {
    usList: UserStory[];
    newUsIndex: number;
    newSprintId: number | null;
    previousUs: number | null;
    nextUs: number | null;
}

/**
 * The effectful Backlog state hook. See the file header for the full contract.
 *
 * @param projectId The project whose backlog to load (ALREADY a number — the
 *                  `BacklogApp` container coerces `props.projectId`).
 * @returns `{ state, actions }` — the live `BacklogState` plus the memoized,
 *          referentially-stable thunk object.
 */
export function useBacklog(projectId: number) {
    const [state, dispatch] = useReducer(backlogReducer, initialBacklogState);

    // Fresh-state ref so async thunks read CURRENT values without stale
    // closures. Every long-lived callback reads `stateRef.current`, never the
    // `state` variable captured at definition time.
    const stateRef = useRef<BacklogState>(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Pending-drag queue. MUST be a mutable ref (never React state): it must be
    // synchronously mutable and must NOT trigger re-renders, exactly mirroring
    // the AngularJS `@scope.pendingDrag` array (`main.coffee:75, 540-642`).
    const pendingDragRef = useRef<PendingDrag[]>([]);

    // F-AAP-03: latch set by the queue processor whenever ANY reorder write in
    // the current batch is rejected. When the queue drains, a truthy latch
    // forces a reconcile reload to server truth EVEN IF live events are
    // connected — a failed write emits no change event, so pushes would never
    // correct the rejected optimistic state. Reset each time the queue drains.
    const moveFailedRef = useRef<boolean>(false);

    // F-CQ-05: synchronous in-flight guard for the "load more" page fetch. A
    // ref (not reducer state) so a burst of IntersectionObserver callbacks
    // cannot fire two overlapping page requests before the first re-render.
    const loadingMoreRef = useRef<boolean>(false);

    // F-AAP-10: monotonic load "generation". Every full/initial (re)load bumps
    // it and captures its own `myGen`; a dispatch is applied only while
    // `myGen === loadGenRef.current`, so a late-resolving await from a
    // superseded load (unmount, projectId change, or a newer retry) can never
    // clobber current state. Replaces the per-effect `cancelled` boolean so the
    // SAME guard protects both the mount effect and the `reload` retry action.
    const loadGenRef = useRef<number>(0);

    // Stable indirection used to break the `moveUs` ⇄ queue-processor cycle
    // without a use-before-declaration in a `useCallback` dependency array. The
    // real processor is assigned into this ref right after it is defined; both
    // `moveUs` and the recursive drain call it via `processRef.current()`.
    const processRef = useRef<() => Promise<void>>(async () => {
        /* replaced by processQueueHead once defined */
    });

    /* ---------------------------------------------------------------------- *
     * Phase 4 — Loader thunks (declared BEFORE the thunks that call them so the
     * `useCallback` dependency graph resolves top-down; each reads mutable
     * values via `stateRef.current` and therefore depends only on `projectId`).
     * ---------------------------------------------------------------------- */

    /**
     * Reload the project statistics and recompute the velocity forecast.
     * Reproduces `loadProjectStats` (`main.coffee:256-268`) → GET
     * `/projects/{id}/stats`. The derived view fields are computed by
     * {@link computeStats}; the reducer's `setStats` runs `calculateForecasting`.
     */
    const reloadStats = useCallback(async (): Promise<void> => {
        const raw = await api.get<Record<string, unknown>>(`/projects/${projectId}/stats`);
        dispatch({ type: 'setStats', stats: computeStats(raw) });
    }, [projectId]);

    /**
     * Reload the OPEN sprints and recompute the current sprint. Reproduces
     * `loadSprints` (`main.coffee:304-330`) → GET `/milestones?closed=false`.
     * The reducer sorts each sprint's stories by `sprint_order`, builds
     * `sprintsById` / `milestonesOrder`, and sets `totalMilestones = open +
     * closed`; the current sprint is computed here (moment date math) and handed
     * over via `setCurrentSprint`.
     */
    const reloadSprints = useCallback(async (): Promise<void> => {
        const res = await listMilestones(projectId, { closed: false });
        dispatch({ type: 'setSprints', sprints: res.milestones, open: res.open, closed: res.closed });
        dispatch({ type: 'setCurrentSprint', sprint: findCurrentSprint(res.milestones) });
    }, [projectId]);

    /**
     * Reload the CLOSED sprints. Reproduces `loadClosedSprints`
     * (`main.coffee:281-296`) → GET `/milestones?closed=true`.
     */
    const reloadClosedSprints = useCallback(async (): Promise<void> => {
        const res = await listMilestones(projectId, { closed: true });
        dispatch({ type: 'setClosedSprints', sprints: res.milestones, closed: res.closed });
    }, [projectId]);

    /**
     * Reload the backlog (unassigned) user stories. Reproduces `loadUserstories`
     * + `parseLoadUserstoriesResponse` (`main.coffee:341-408`). The shared
     * `api/userstories.ts` has no list function, so the LOW-LEVEL `api.request`
     * is used directly — it is the only client method that exposes response
     * `headers`, which are REQUIRED for the pagination contract.
     *
     * @param opts.reset When `true` (default) replaces the list and resets the
     *                   page cursor to 1; when `false` appends the next page.
     */
    const reloadUserstories = useCallback(
        async (opts?: { reset?: boolean }): Promise<void> => {
            const reset = opts?.reset ?? true;
            const s = stateRef.current;
            const page = reset ? 1 : s.page;

            const params: Record<string, string | number> = {
                project: projectId,
                // String 'null' — the backend sentinel for "no milestone"
                // (`resources/userstories.coffee:46`).
                milestone: 'null',
                page,
                // Whitelisted filter query params (exclude_status / status / tags /
                // assigned_users / role / epic / owner + optional q).
                ...s.selectedFilters,
            };

            // FIDELITY: normal loads send NO `page_size` — the backend applies
            // its own default (`main.coffee:335-339,341-359`,
            // `resources/userstories.coffee:45-55`). `PAGE_SIZE_DEFAULT` is
            // `undefined`, so this guard never attaches the param on the normal
            // path; only `reloadAllPaginatedUserstories` sends an explicit size.
            if (PAGE_SIZE_DEFAULT !== undefined) {
                params.page_size = PAGE_SIZE_DEFAULT;
            }

            const res = await api.request<UserStory[]>('GET', '/userstories', { params });

            // `Headers.get` is case-insensitive, so the `Taiga-Info-*` casing is
            // irrelevant. `x-pagination-next` drives page++/disablePagination.
            const hasNext = !!res.headers.get('x-pagination-next');
            const totalHeader = res.headers.get('Taiga-Info-Backlog-Total-Userstories');
            const noSwimHeader = res.headers.get('Taiga-Info-Userstories-Without-Swimlane');

            if (reset) {
                dispatch({ type: 'setUserstories', userstories: res.data });
            } else {
                dispatch({ type: 'appendUserstories', userstories: res.data });
            }

            dispatch({
                type: 'setPagination',
                // Source: `if header('x-pagination-next') → @.page++` (main.coffee:390-392).
                page: hasNext ? page + 1 : page,
                disablePagination: !hasNext,
                totalUserStories: totalHeader != null ? Number(totalHeader) : s.totalUserStories,
                noSwimlaneUserStories:
                    noSwimHeader != null ? Number(noSwimHeader) > 0 : s.noSwimlaneUserStories,
            });
        },
        [projectId],
    );

    /**
     * Reload ALL currently-visible stories in a SINGLE page while preserving the
     * page cursor. Reproduces `loadAllPaginatedUserstories`
     * (`main.coffee:335-339`): `page = @.page; loadUserstories(true,
     * userstories.length).then(() => @.page = page)`. Because the normal loader
     * sends no `page_size`, this variant explicitly requests
     * `page_size = current userstories length`, replaces the list, then restores
     * the saved cursor. This is the loader the `onUserstories` WebSocket handler
     * invokes.
     */
    const reloadAllPaginatedUserstories = useCallback(async (): Promise<void> => {
        const s = stateRef.current;
        const savedPage = s.page;
        const pageSize = s.userstories.length || undefined;

        const params: Record<string, string | number> = {
            project: projectId,
            milestone: 'null',
            page: 1,
            ...s.selectedFilters,
        };
        if (pageSize) {
            params.page_size = pageSize;
        }

        const res = await api.request<UserStory[]>('GET', '/userstories', { params });

        // Reset + replace (the source reloads with resetPagination=true).
        dispatch({ type: 'setUserstories', userstories: res.data });

        const hasNext = !!res.headers.get('x-pagination-next');
        const totalHeader = res.headers.get('Taiga-Info-Backlog-Total-Userstories');
        const noSwimHeader = res.headers.get('Taiga-Info-Userstories-Without-Swimlane');

        dispatch({
            type: 'setPagination',
            // Restore the cursor (source `@.page = page`).
            page: savedPage,
            disablePagination: !hasNext,
            totalUserStories: totalHeader != null ? Number(totalHeader) : s.totalUserStories,
            noSwimlaneUserStories:
                noSwimHeader != null ? Number(noSwimHeader) > 0 : s.noSwimlaneUserStories,
        });
    }, [projectId]);

    /**
     * Reload the sidebar filter facets. Reproduces `generateFilters` → the
     * shared `filtersData` helper → GET `/userstories/filters_data`. The current
     * selected filters are forwarded so the facet counts reflect the active
     * query.
     */
    const reloadFiltersData = useCallback(async (): Promise<void> => {
        const fd = await fetchFiltersData(projectId, stateRef.current.selectedFilters);
        dispatch({ type: 'setFiltersData', filtersData: fd });
    }, [projectId]);

    /* ---------------------------------------------------------------------- *
     * Phase 6a — The pending-drag queue processor
     *
     * Reproduces the API + reconcile + drain logic of `moveUs`
     * (`main.coffee:533-642`). This owns ONLY the server round-trip and the
     * queue draining; the OPTIMISTIC in-memory move is performed by the reducer
     * (dispatched once, at enqueue time, by the `moveUs` thunk below), never
     * here — exactly like the source, whose queued re-processing calls
     * `moveUs(null, …)` with `ctx = null` so no optimistic move is re-applied.
     * ---------------------------------------------------------------------- */
    const processQueueHead = useCallback(async (): Promise<void> => {
        const head = pendingDragRef.current[0];
        if (!head) {
            return;
        }

        // oldSprintId = usList[0].milestone (main.coffee:524); a backlog story => null.
        const oldSprintId = head.usList[0]?.milestone ?? null;
        // project = usList[0].project (main.coffee:525); fall back to the hook's projectId.
        const projectIdForCall = head.usList[0]?.project ?? projectId;
        // currentSprintId = (newSprintId != oldSprintId) ? newSprintId : oldSprintId (main.coffee:533).
        const currentSprintId = head.newSprintId !== oldSprintId ? head.newSprintId : oldSprintId;
        // bulkUserstories = usList.map(it => it.id) → an ARRAY OF US ID NUMBERS (main.coffee:535-537).
        const bulkUserstories = head.usList.map((u) => u.id);

        try {
            /*
             * WIRE-FORMAT FIDELITY (AAP §0.1.1 / §0.7.1 — keep /api/v1/ byte-for-byte):
             * The AngularJS source calls:
             *   rs.userstories.bulkUpdateBacklogOrder(project, currentSprintId, previousUs, nextUs, bulkUserstories)
             * where bulkUserstories = usList.map(it => it.id)  → an ARRAY OF USER-STORY ID NUMBERS (main.coffee:535-537),
             * passed through unchanged to POST /userstories/bulk_update_backlog_order as `bulk_userstories`.
             * The backend validator declares `bulk_userstories = ListField(child=IntegerField(min_value=1))`
             * (taiga-back userstories/validators.py), i.e. a plain number[]. The shared helper's
             * `bulkUpdateBacklogOrder` now types this parameter as `number[]`, so the id array is passed
             * DIRECTLY with no cast — the request body is byte-for-byte identical to AngularJS.
             */
            const result = await bulkUpdateBacklogOrder(
                projectIdForCall,
                currentSprintId,
                head.previousUs,
                head.nextUs,
                bulkUserstories,
            );

            // `result` is the response BODY directly (an array of updated rows) —
            // NOT `result.data`. The AngularJS source read `result.data` only
            // because Angular's `$http` wraps the body; the shared `api` client
            // resolves verb helpers to the parsed body itself (main.coffee:611-617).
            const updatedRows = (
                result as Array<{ id: number; milestone: number | null; backlog_order?: number }>
            ).map((r) => ({
                id: r.id,
                milestone: r.milestone,
                backlog_order: r.backlog_order,
            }));
            dispatch({ type: 'reconcileMoveResult', updatedRows });
        } catch (err) {
            // F-AAP-03: a rejected reorder must NOT be silently swallowed.
            //   1. SURFACE it — record a user-facing message in state so the UI
            //      can report that the move did not persist.
            //   2. FORCE reconciliation — latch `moveFailedRef` so the drain
            //      below reloads server truth even when live events are
            //      connected. A failed write emits no change event, so pushes
            //      would otherwise never correct the rejected optimistic state,
            //      leaving the board stale (the exact defect flagged).
            moveFailedRef.current = true;
            dispatch({ type: 'setMoveError', message: describeReorderError(err) });
        } finally {
            // main.coffee:618 — pendingDrag.shift() once the round-trip settles.
            pendingDragRef.current.shift();

            if (pendingDragRef.current.length) {
                // main.coffee:620-629 — recurse for the next queued drag (via the
                // stable ref to avoid a self-referential useCallback dependency).
                void processRef.current();
            } else {
                // Queue drained. Reconcile to server truth when EITHER a write in
                // this batch failed (F-AAP-03 — a failed write emits no live
                // event, so the optimistic state must be reloaded) OR live events
                // are not actually connected (main.coffee:633-637, now using the
                // REAL socket state via `eventsConnected()`). Reset the failure
                // latch for the next batch before deciding.
                const moveFailed = moveFailedRef.current;
                const reconcileNeeded = moveFailed || !eventsConnected();
                moveFailedRef.current = false;

                if (reconcileNeeded) {
                    void reloadSprints();
                    void reloadClosedSprints();
                    void reloadStats();

                    // F-AAP-03 (dest#8) — REVERT the rejected optimistic reorder.
                    // The reloads above cover the sprint sidebar + stats
                    // (main.coffee:633-637 parity), but the DRAGGED backlog
                    // user-story keeps its optimistic position because a failed
                    // write emits no live `userstories` event to correct it —
                    // leaving the list visibly stale beneath the error toast,
                    // contradicting this block's own reconciliation intent.
                    // ONLY on an actual failure (never on the events-disconnected
                    // success path, which stays byte-for-byte AngularJS-faithful)
                    // do we additionally refetch the backlog list to server truth
                    // via the SAME loader the live `onUserstories` handler uses,
                    // so the optimistic move is visibly reverted (matching the
                    // Kanban screen's board-reload revert). This keeps the
                    // Suggested Fix's "reconcile the optimistic state visibly".
                    if (moveFailed) {
                        void reloadAllPaginatedUserstories();
                    }
                }
            }
        }
    }, [
        projectId,
        reloadSprints,
        reloadClosedSprints,
        reloadStats,
        reloadAllPaginatedUserstories,
    ]);

    // Keep the stable ref pointed at the latest processor so `moveUs` and the
    // recursive drain can invoke it without a use-before-declaration cycle.
    useEffect(() => {
        processRef.current = processQueueHead;
    }, [processQueueHead]);

    /* ---------------------------------------------------------------------- *
     * Phase 6b — Thunk-style actions
     * ---------------------------------------------------------------------- */

    /**
     * THE critical drag thunk. Reproduces `moveUs` (`main.coffee:523-642`),
     * split between this hook (queue + API + reconcile + reloads) and the pure
     * reducer (the optimistic in-memory move). Canonical positional signature —
     * also the contract `../dnd/BacklogDndContext.tsx` (via `BacklogApp`) calls:
     *
     *   moveUs(usList, newUsIndex, newSprintId, previousUs, nextUs)
     *
     * Steps (source parity):
     *   1. OPTIMISTIC dispatch — the reducer performs the in-memory move
     *      (`main.coffee` `if ctx` branch). Applied for EVERY real drag, once.
     *   2. ENQUEUE the operation onto the pending-drag queue.
     *   3. QUEUE GATE (`main.coffee:540/600-601`): if a drag is already in
     *      flight, this one waits — its optimistic mutation has ALREADY been
     *      applied at step 1, matching the source.
     *   4. Otherwise start processing the queue head.
     */
    const moveUs = useCallback(
        (
            usList: UserStory[],
            newUsIndex: number,
            newSprintId: number | null,
            previousUs: number | null,
            nextUs: number | null,
        ): void => {
            // 1. Optimistic in-memory move (reducer owns the math).
            dispatch({ type: 'moveUs', usList, newUsIndex, newSprintId, previousUs, nextUs });

            // 2. Enqueue (mirrors `@scope.pendingDrag.push({...})`, main.coffee:540-546).
            pendingDragRef.current.push({ usList, newUsIndex, newSprintId, previousUs, nextUs });

            // 3. Queue gate: a drag is already in flight (main.coffee:600-601).
            if (pendingDragRef.current.length > 1) {
                return;
            }

            // 4. Start processing the head of the queue.
            void processRef.current();
        },
        [],
    );

    /**
     * Move one or more stories to the TOP of the backlog. Reproduces
     * `moveUsToTopOfBacklog` (`main.coffee:511-521`): if the backlog is
     * non-empty, anchor the move BEFORE the first story
     * (`nextUs = userstories[0].id`), then delegate to {@link moveUs} with
     * `newSprintId = null` (the backlog) and `previousUs = null`.
     */
    const moveUsToTopOfBacklog = useCallback(
        (usList: UserStory[] | UserStory): void => {
            const uss = Array.isArray(usList) ? usList : [usList];
            const first = stateRef.current.userstories[0];
            const nextUs = first ? first.id : null;
            moveUs(uss, 0, null, null, nextUs);
        },
        [moveUs],
    );

    /**
     * Toolbar "move to sprint" action. Reproduces `moveUssToSprint`
     * (`main.coffee:779-803`): optimistically remove the stories from the
     * backlog list, then POST `/userstories/bulk_update_milestone` and reload
     * the sprints + stats.
     *
     * NOTE the contrast with `bulkUpdateBacklogOrder`: this endpoint genuinely
     * takes an ARRAY OF `{ us_id, order }` objects (`main.coffee:794-799`), which
     * matches the shared `BulkUserStoryOrder[]` type exactly — so NO cast is
     * needed here. The `?? 0` guard defends `sprint_order` (nullable in the
     * shared type) under strict TS and is behaviour-preserving when present.
     */
    const moveToSprint = useCallback(
        async (usList: UserStory[], targetSprintId: number): Promise<void> => {
            // Clear any stale reorder error before starting a fresh move.
            dispatch({ type: 'setMoveError', message: null });

            // Optimistically remove the chosen stories from the backlog list.
            usList.forEach((u) => dispatch({ type: 'removeUsOptimistic', usId: u.id }));

            const data: BulkUserStoryOrder[] = usList.map((u) => ({
                us_id: u.id,
                order: u.sprint_order ?? 0,
            }));

            try {
                await bulkUpdateMilestone(projectId, targetSprintId, data);
                // main.coffee:800-801 — refresh sprints and stats after the move.
                await Promise.all([reloadSprints(), reloadStats()]);
            } catch (err) {
                // F-REG-06: the previous version had NO catch, so a rejected
                // `bulk_update_milestone` left the stories optimistically REMOVED
                // from the backlog forever (they vanished) while the promise
                // rejection was discarded by the fire-and-forget caller. Now:
                //   1. surface WHY the move failed (same envelope parser as the
                //      drag reorder path, F-AAP-03);
                //   2. reconcile to SERVER TRUTH by reloading the backlog, sprints
                //      and stats — this re-materialises the stories that were
                //      optimistically removed (a "reload" rollback, which the
                //      finding explicitly sanctions);
                //   3. rethrow so the toolbar caller keeps the selection intact
                //      and can let the user retry (it clears the selection ONLY
                //      on success).
                dispatch({ type: 'setMoveError', message: describeReorderError(err) });
                await Promise.all([
                    reloadUserstories({ reset: true }),
                    reloadSprints(),
                    reloadStats(),
                ]);
                throw err;
            }
        },
        [projectId, reloadSprints, reloadStats, reloadUserstories],
    );

    /**
     * F-CQ-03 — delete a single user story.
     *
     * Reproduces `deleteUserStory` (`main.coffee:662-681`): the AngularJS
     * controller OWNED this mutation — after `@confirm.askOnDelete` it removed
     * the story from the backlog list optimistically
     * (`@scope.userstories = _.without(...)`), issued `@repo.remove(us)`
     * (a `DELETE /userstories/{id}`), and on success reloaded stats + sprints;
     * on failure it notified an error. The confirm dialog is owned by the
     * CONTAINER (`window.confirm`, the established stand-in); this action owns the
     * optimistic removal, the persistence and the reconcile.
     *
     * The previous React cut only dispatched `removeUsOptimistic` (a LOCAL list
     * removal with NO backend DELETE) — the "delete is local-only" bug. This
     * action adds the real `api.del` persistence and reload-on-error rollback.
     */
    const deleteUs = useCallback(
        async (us: UserStory): Promise<void> => {
            dispatch({ type: 'setMoveError', message: null });
            // Optimistic removal (main.coffee:669 `_.without`).
            dispatch({ type: 'removeUsOptimistic', usId: us.id });
            try {
                await api.del(`/userstories/${us.id}`);
                // main.coffee:674-678 — refresh sprints + stats after removal.
                await Promise.all([reloadSprints(), reloadStats()]);
            } catch (err) {
                // Reconcile to server truth: reload the backlog (re-materialising
                // the optimistically-removed story), sprints and stats, and
                // surface why the delete failed. Does NOT rethrow — the row
                // affordance has no selection to preserve.
                dispatch({
                    type: 'setMoveError',
                    message: describeUsMutationError(
                        err,
                        'The user story could not be deleted. The backlog has been refreshed to the latest server state.',
                    ),
                });
                await Promise.all([
                    reloadUserstories({ reset: true }),
                    reloadSprints(),
                    reloadStats(),
                ]);
            }
        },
        [reloadSprints, reloadStats, reloadUserstories],
    );

    /**
     * F-CQ-03 — persist an inline single-story STATUS change.
     *
     * The backlog row's status popover reproduces the common `tgUsStatus`
     * directive; selecting a status mutated `us.status` and `@repo.save(us)`
     * (a `PATCH /userstories/{id}` carrying the changed field + `version`), then
     * regenerated filters and reloaded stats (`updateUserStoryStatus`,
     * `main.coffee:646-651`). This action optimistically replaces the story in
     * place, PATCHes the minimal `{ status, version }` body, then refreshes
     * stats + filter facets; on failure it reconciles to server truth.
     */
    const updateUsStatus = useCallback(
        async (us: UserStory, newStatusId: number): Promise<void> => {
            if (us.status === newStatusId) {
                return;
            }
            dispatch({ type: 'setMoveError', message: null });
            // Optimistic in-place replacement.
            dispatch({ type: 'replaceUs', us: { ...us, status: newStatusId } });
            try {
                // Minimal PATCH body (parity with F-REG-05: send only the changed
                // field plus the optimistic-concurrency `version`).
                await api.patch(`/userstories/${us.id}`, {
                    status: newStatusId,
                    version: us.version,
                });
                // main.coffee:646-651 — reload stats + regenerate filter facets.
                await Promise.all([reloadStats(), reloadFiltersData()]);
            } catch (err) {
                dispatch({
                    type: 'setMoveError',
                    message: describeUsMutationError(
                        err,
                        'The status could not be saved. The backlog has been refreshed to the latest server state.',
                    ),
                });
                await Promise.all([reloadUserstories({ reset: true }), reloadStats()]);
            }
        },
        [reloadStats, reloadFiltersData, reloadUserstories],
    );

    /**
     * F-CQ-03 — persist an inline single-story POINTS change for one role.
     *
     * Reproduces the estimation edit (`tgBacklogUsPoints` →
     * `estimationProcess.onSelectedPointForRole`, `main.coffee:1094-1099`): it set
     * `us.points[roleId] = pointId` and `@repo.save(us)` (a
     * `PATCH /userstories/{id}` carrying the changed `points` map + `version`),
     * then `loadProjectStats()`. This action optimistically replaces the story
     * with the merged `points` map, PATCHes the minimal `{ points, version }`
     * body and reloads stats; on failure it reconciles to server truth. The
     * point VALUES come from in-scope `project.points`, so no estimation service
     * is required.
     */
    const updateUsPoints = useCallback(
        async (us: UserStory, roleId: number, pointId: number): Promise<void> => {
            const nextPoints = { ...(us.points ?? {}), [roleId]: pointId };
            dispatch({ type: 'setMoveError', message: null });
            dispatch({ type: 'replaceUs', us: { ...us, points: nextPoints } });
            try {
                await api.patch(`/userstories/${us.id}`, {
                    points: nextPoints,
                    version: us.version,
                });
                // main.coffee:1098 — refresh project stats after an estimate change.
                await reloadStats();
            } catch (err) {
                dispatch({
                    type: 'setMoveError',
                    message: describeUsMutationError(
                        err,
                        'The points could not be saved. The backlog has been refreshed to the latest server state.',
                    ),
                });
                await Promise.all([reloadUserstories({ reset: true }), reloadStats()]);
            }
        },
        [reloadStats, reloadUserstories],
    );

    /**
     * F-CQ-05 — the guarded "load more" (next page) action.
     *
     * The pagination machinery already existed end-to-end (the loader appends
     * when called with `{ reset: false }` and advances the cursor; `BacklogTable`
     * renders an `IntersectionObserver` sentinel when handed an `onLoadMore`),
     * but NOTHING wired it: production only ever called the loader with
     * `{ reset: true }`, the container never supplied `onLoadMore`, and
     * `loadingUserstories` was write-only-`false` (never a real in-flight flag).
     *
     * This action closes the gap. It is GUARDED twice:
     *   - `disablePagination` — the last page's response had no
     *     `x-pagination-next`, so there is nothing more to fetch (mirrors the
     *     AngularJS `@.disablePagination` gate on `loadUserstories`);
     *   - `loadingMoreRef` — a synchronous in-flight latch so a burst of
     *     sentinel-intersection callbacks cannot fire overlapping requests.
     * On success `appendUserstories` clears the spinner; on failure the spinner
     * is cleared here so a later scroll can retry (a failed APPEND is additive,
     * not a full-load failure, so it deliberately does NOT trip `loadError`).
     */
    const loadMore = useCallback(async (): Promise<void> => {
        const s = stateRef.current;
        if (s.disablePagination || loadingMoreRef.current) {
            return;
        }
        loadingMoreRef.current = true;
        dispatch({ type: 'setLoadingUserstories', loading: true });
        try {
            await reloadUserstories({ reset: false });
        } catch {
            // The append never landed; clear the spinner so the sentinel can
            // retry on the next scroll. (loadError is reserved for full/initial
            // + live-refresh failures — F-AAP-10.)
            dispatch({ type: 'setLoadingUserstories', loading: false });
        } finally {
            loadingMoreRef.current = false;
        }
    }, [reloadUserstories]);

    /**
     * F-REG-07 — finish a sprint creation FAITHFULLY.
     *
     * The sibling `CreateEditSprintLightbox` has ALREADY persisted the new
     * milestone; this thunk reproduces `sprintform:create:success`
     * (`main.coffee:170-176`) + `sprintform:create:success:callback` →
     * `moveToCurrentSprint` (`main.coffee:807-817`): reload the OPEN sprints
     * FIRST, then — only if the user chose stories to move into the new sprint —
     * move them into `currentSprint || sprints[0]` computed from the REFRESHED
     * sprint list.
     *
     * The first React cut fired `reloadSprints()` WITHOUT awaiting it and then
     * computed the target from STALE pre-create props (`currentSprint ??
     * sprints[0]` captured at creation time), so the stories were sent to the
     * OLD sprint and the just-created milestone was ignored. Awaiting the reload
     * and deriving the target from the fresh fetch result restores exact parity.
     * Errors are surfaced (loadError) rather than rejected, so the container's
     * fire-and-forget call never produces an unhandled rejection.
     */
    const finishSprintCreation = useCallback(
        async (ussToMove?: UserStory[]): Promise<void> => {
            try {
                const res = await listMilestones(projectId, { closed: false });
                dispatch({
                    type: 'setSprints',
                    sprints: res.milestones,
                    open: res.open,
                    closed: res.closed,
                });
                const current = findCurrentSprint(res.milestones);
                dispatch({ type: 'setCurrentSprint', sprint: current });
                await reloadStats();

                if (ussToMove && ussToMove.length > 0) {
                    const target = current ?? res.milestones[0];
                    if (target) {
                        try {
                            await moveToSprint(ussToMove, target.id);
                        } catch {
                            // moveToSprint already surfaced `moveError` and
                            // reconciled the board; swallow so this thunk never
                            // rejects into the fire-and-forget container caller.
                        }
                    }
                }
            } catch {
                // A failed sprint reload after create must not vanish silently.
                dispatch({ type: 'setLoadError', error: true });
            }
        },
        [projectId, reloadStats, moveToSprint],
    );

    /**
     * Insert stories created by the sibling `BulkCreateUsLightbox` (which owns
     * the actual `bulkCreate` API call + validation) at the top/bottom of the
     * backlog and refresh the stats. The reducer highlights the inserted rows as
     * `new` (`main.coffee:158-166`).
     */
    const bulkCreateUs = useCallback(
        (createdStories: UserStory[], position: 'top' | 'bottom'): void => {
            dispatch({ type: 'addUsOptimistic', userstories: createdStories, position });
            void reloadStats();
        },
        [reloadStats],
    );

    /**
     * Create a sprint. The sibling `CreateEditSprintLightbox` owns date
     * formatting + validation (via `../../shared/validation`), so this thunk
     * receives an ALREADY-formatted payload. Source `$repo.create('milestones',
     * newSprint)` (`lightboxes.coffee:62`).
     */
    const createSprint = useCallback(
        async (payload: MilestoneCreatePayload): Promise<void> => {
            await createMilestone(payload);
            await reloadSprints();
        },
        [reloadSprints],
    );

    /**
     * Save edits to an existing sprint. Source `$repo.save(newSprint)`
     * (`lightboxes.coffee:69`). Reload open AND closed sprints so an edit that
     * flips the closed flag is reflected in both lists.
     *
     * Mirrors the `saveMilestone(id, changes, version?)` contract (F-REG-05):
     * the caller supplies the milestone `id`, the MINIMAL set of changed
     * attributes, and the optimistic-concurrency `version`, so the PATCH body is
     * exactly the modified attributes + version — never the whole model.
     */
    const saveSprint = useCallback(
        async (
            id: number,
            changes: Partial<Milestone>,
            version?: number,
        ): Promise<void> => {
            await saveMilestone(id, changes, version);
            await reloadSprints();
            await reloadClosedSprints();
        },
        [reloadSprints, reloadClosedSprints],
    );

    /**
     * Remove a sprint. Source `$repo.remove(sprint)` → DELETE `/milestones/{id}`.
     * The shared `milestones.ts` exposes NO remove function, so the LOW-LEVEL
     * `api.del` is used directly — a deliberate, documented deviation. After
     * removal, reloading the userstories reflects the sprint's stories falling
     * back into the backlog.
     */
    const removeSprint = useCallback(
        async (sprintId: number): Promise<void> => {
            await api.del(`/milestones/${sprintId}`);
            await Promise.all([
                reloadSprints(),
                reloadClosedSprints(),
                reloadUserstories({ reset: true }),
                reloadStats(),
            ]);
        },
        [reloadSprints, reloadClosedSprints, reloadUserstories, reloadStats],
    );

    /**
     * Apply the whitelisted selected filters, toggle the "active filters"
     * indicator, and reload the backlog (filters reset pagination — source
     * `loadUserstories(true)`) plus the filter facets.
     */
    const setFilters = useCallback(
        (filters: Record<string, string>): void => {
            dispatch({ type: 'setSelectedFilters', filters });
            dispatch({ type: 'toggleActiveFilters', activeFilters: Object.keys(filters).length > 0 });
            // Keep `stateRef` in sync SYNCHRONOUSLY so the immediate reloads below
            // read the just-applied filters. A dispatch only updates `state` on the
            // next render, and `stateRef` is re-synced by a post-render effect, so
            // without this the reloads would send the STALE (pre-change) filters —
            // whereas the AngularJS source issued `loadUserstories(true)` against
            // the filters it had just set on the synchronous `$scope`
            // (`main.coffee` filter-change handler). The post-render effect will
            // overwrite this with the reducer's state on the next tick.
            stateRef.current = { ...stateRef.current, selectedFilters: filters };
            void reloadUserstories({ reset: true });
            void reloadFiltersData();
        },
        [reloadUserstories, reloadFiltersData],
    );

    /**
     * Toggle (or explicitly set) tag visibility. The reducer owns the in-memory
     * flag flip; the hook owns PERSISTENCE (F-CQ-09). We resolve the NEXT value
     * here (from `stateRef` when toggling) so we can both dispatch it explicitly
     * AND write it to project-scoped storage, reproducing the AngularJS
     * `storeShowTags(projectId, value)` call (`main.coffee:501-502`).
     */
    const toggleTags = useCallback(
        (showTags?: boolean): void => {
            const next = showTags !== undefined ? showTags : !stateRef.current.showTags;
            dispatch({ type: 'toggleTags', showTags: next });
            writeStoredShowTags(projectId, next);
        },
        [projectId],
    );

    /**
     * Toggle (or explicitly set) the velocity-forecasting view. The velocity
     * view needs closed sprints for context, so lazy-load them once when
     * enabling the view and none are present yet (source loads closed sprints on
     * demand).
     */
    const toggleVelocity = useCallback(
        (displayVelocity?: boolean): void => {
            dispatch({ type: 'toggleVelocity', displayVelocity });
            const willDisplay = displayVelocity ?? !stateRef.current.displayVelocity;
            if (willDisplay && stateRef.current.closedSprints.length === 0) {
                void reloadClosedSprints();
            }
        },
        [reloadClosedSprints],
    );

    /* Fire-and-forget reload passthroughs exposed on the actions object. */
    const reloadUserstoriesAction = useCallback((): void => {
        void reloadUserstories({ reset: true });
    }, [reloadUserstories]);

    const reloadSprintsAction = useCallback((): void => {
        void reloadSprints();
    }, [reloadSprints]);

    const reloadClosedSprintsAction = useCallback((): void => {
        void reloadClosedSprints();
    }, [reloadClosedSprints]);

    const reloadStatsAction = useCallback((): void => {
        void reloadStats();
    }, [reloadStats]);

    /** Optimistically insert created stories (no API call — caller owns that). */
    const addUsOptimistic = useCallback(
        (userstories: UserStory[], position: 'top' | 'bottom'): void => {
            dispatch({ type: 'addUsOptimistic', userstories, position });
        },
        [],
    );

    /** Optimistically remove a story from the backlog list (deleteUserStory). */
    const removeUsOptimistic = useCallback((usId: number): void => {
        dispatch({ type: 'removeUsOptimistic', usId });
    }, []);

    /* ---------------------------------------------------------------------- *
     * Phase 3 + 5 — Initial data load + WebSocket subscription
     *
     * Reproduces the load ORDER of `loadInitialData` (`main.coffee:488-499`) →
     * `loadBacklog` (`main.coffee:410-415`):
     *   loadProject → initializeSubscription → $q.all(stats, sprints,
     *   userstories) → generateFilters → emit backlog:loaded.
     * ---------------------------------------------------------------------- */

    /**
     * F-AAP-10 — the CENTRALIZED full/initial data load, shared by the mount
     * effect AND the `reload` retry action so there is a single, awaited entry
     * point for (re)loading the backlog.
     *
     * Behavioural change vs the first React cut: that version buried the load in
     * the effect closure and its `catch` merely cleared the spinner, so a failed
     * initial load rendered as a SUCCESSFUL EMPTY backlog. This version SURFACES
     * the failure by setting `loadError` (distinct from "loaded but empty"), and
     * a monotonic `loadGenRef` "generation" prevents a superseded load (unmount,
     * projectId change, or a newer retry) from clobbering current state with a
     * late-resolving await.
     *
     * The subscription is NOT established here (it belongs to the effect, once
     * per projectId); this thunk owns only the DATA (project + stats + sprints +
     * userstories + filters), so a `reload()` retry never double-subscribes.
     */
    const loadBacklogData = useCallback(async (): Promise<void> => {
        const myGen = ++loadGenRef.current;
        dispatch({ type: 'setLoading', loading: true });
        dispatch({ type: 'setLoadError', error: false });

        try {
            // 1. Load the project (low-level client; main.coffee:469-486). The
            //    reducer's `setProject` derives `isBacklogActivated`; an inactive
            //    backlog surfaces the flag (BacklogApp renders the empty state).
            const project = await api.get<Project>(`/projects/${projectId}`);
            if (myGen !== loadGenRef.current) {
                return;
            }
            dispatch({ type: 'setProject', project });

            // 2. Parallel loads — $q.all([loadProjectStats, loadSprints,
            //    loadUserstories]) (main.coffee:411-414).
            await Promise.all([
                reloadStats(),
                reloadSprints(),
                reloadUserstories({ reset: true }),
            ]);
            if (myGen !== loadGenRef.current) {
                return;
            }

            // 3. Filters data — `generateFilters` after load (main.coffee:498).
            await reloadFiltersData();
            if (myGen !== loadGenRef.current) {
                return;
            }

            // 4. Done — source emits `backlog:loaded` (main.coffee:499).
            dispatch({ type: 'setLoading', loading: false });
        } catch {
            // F-AAP-10: SURFACE the failure instead of rendering a successful
            // empty screen. Generation-guarded so a superseded load cannot flip
            // the flags of a newer one.
            if (myGen === loadGenRef.current) {
                dispatch({ type: 'setLoading', loading: false });
                dispatch({ type: 'setLoadError', error: true });
            }
        }
    }, [projectId, reloadStats, reloadSprints, reloadUserstories, reloadFiltersData]);

    useEffect(() => {
        if (!projectId) {
            return;
        }

        // Subscribe to live changes using the IDENTICAL routing keys
        // `changes.project.{id}.userstories|milestones` (main.coffee:223-234).
        // Established once per projectId; a `reload()` retry re-runs only the
        // DATA load, never re-subscribes. `subscribeProjectChanges` is a
        // disabled-safe no-op (returns a no-op unsubscribe) when no events URL is
        // configured — in that case the post-drag fallback reload refreshes.
        //
        // F-AAP-10: the handlers now AWAIT + `catch` so a failed LIVE refresh is
        // SURFACED via `loadError` rather than swallowed as an unhandled
        // rejection (the source's `$q` refreshes could not fail silently the way
        // a bare `void promise` does).
        const unsubscribe = subscribeProjectChanges(projectId, {
            onUserstories: () => {
                // changes.project.{id}.userstories (main.coffee:224-226).
                void (async () => {
                    try {
                        await reloadAllPaginatedUserstories();
                        await reloadSprints();
                    } catch {
                        dispatch({ type: 'setLoadError', error: true });
                    }
                })();
            },
            onMilestones: () => {
                // changes.project.{id}.milestones, {selfNotification:true}
                // handled inside the shared bridge (main.coffee:228-234).
                void (async () => {
                    try {
                        await Promise.all([reloadSprints(), reloadClosedSprints(), reloadStats()]);
                    } catch {
                        dispatch({ type: 'setLoadError', error: true });
                    }
                })();
            },
        });

        void loadBacklogData();

        return () => {
            // Invalidate any in-flight load (F-AAP-10 generation guard) and
            // detach the subscription.
            loadGenRef.current += 1;
            unsubscribe();
        };
    }, [
        projectId,
        loadBacklogData,
        reloadAllPaginatedUserstories,
        reloadSprints,
        reloadClosedSprints,
        reloadStats,
    ]);

    /**
     * F-CQ-09 — rehydrate the project-scoped show-tags preference on mount /
     * projectId change, reproducing the AngularJS `getShowTags(projectId)` read
     * (`main.coffee:501-502`, `resources/userstories.coffee:174-177`). When a
     * value was persisted we apply it; otherwise the reducer default (`true`)
     * stands. Kept in its OWN effect so it is independent of the data load.
     */
    useEffect(() => {
        if (!projectId) {
            return;
        }
        const stored = readStoredShowTags(projectId);
        if (stored !== null) {
            dispatch({ type: 'toggleTags', showTags: stored });
        }
    }, [projectId]);

    /**
     * F-AAP-10 — the centralized, awaitable RETRY. Re-runs the full data load
     * (resetting `loadError`), so the container's error state can offer a "try
     * again" affordance that genuinely re-fetches. Does NOT re-subscribe.
     */
    const reload = useCallback((): Promise<void> => loadBacklogData(), [loadBacklogData]);

    /**
     * F-AAP-03 — dismiss the drag-and-drop / mutation error banner.
     *
     * Clears `state.moveError` back to `null` so the `NotificationError` toast
     * rendered by `BacklogApp` disappears. The board itself was already
     * reconciled to server truth at failure time (each mutation reloads on
     * error), so this only removes the user-facing message.
     */
    const clearMoveError = useCallback((): void => {
        dispatch({ type: 'setMoveError', message: null });
    }, []);

    /* ---------------------------------------------------------------------- *
     * Phase 6c — The memoized `actions` object
     *
     * Referentially stable across renders (every member is a stable
     * `useCallback`), so consumers can pass it to child components / effect
     * dependency arrays without churn. Exposes EXACTLY the consumer contract
     * enumerated by `BacklogApp.tsx` + the folder spec.
     * ---------------------------------------------------------------------- */
    const actions = useMemo(
        () => ({
            moveUs,
            moveUsToTopOfBacklog,
            moveToSprint,
            loadMore,
            finishSprintCreation,
            reload,
            bulkCreateUs,
            createSprint,
            saveSprint,
            removeSprint,
            setFilters,
            toggleTags,
            toggleVelocity,
            reloadUserstories: reloadUserstoriesAction,
            reloadSprints: reloadSprintsAction,
            reloadClosedSprints: reloadClosedSprintsAction,
            reloadStats: reloadStatsAction,
            addUsOptimistic,
            removeUsOptimistic,
            deleteUs,
            updateUsStatus,
            updateUsPoints,
            clearMoveError,
        }),
        [
            moveUs,
            moveUsToTopOfBacklog,
            moveToSprint,
            loadMore,
            finishSprintCreation,
            reload,
            bulkCreateUs,
            createSprint,
            saveSprint,
            removeSprint,
            setFilters,
            toggleTags,
            toggleVelocity,
            reloadUserstoriesAction,
            reloadSprintsAction,
            reloadClosedSprintsAction,
            reloadStatsAction,
            addUsOptimistic,
            removeUsOptimistic,
            deleteUs,
            updateUsStatus,
            updateUsPoints,
            clearMoveError,
        ],
    );

    return { state, actions };
}
