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
import moment from 'moment';

import {
    backlogReducer,
    initialBacklogState,
    BacklogState,
    BacklogStats,
} from './backlogReducer';
import type { Project, UserStory, Milestone } from '../../shared/types';
import { api } from '../../shared/api/client';
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
import { subscribeProjectChanges } from '../../shared/events';
import { getEventsUrl } from '../../shared/session';

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
 * Proxy for the AngularJS `@events.connected` flag consulted after a drag
 * settles (`main.coffee:634` — `if !@events.connected` → hard-reload). The
 * shared `../../shared/events` bridge exposes no connection flag, so we treat
 * "events are configured" (`getEventsUrl()` truthy) as "live pushes will keep
 * the board fresh" and therefore SKIP the post-drag fallback reload. When events
 * are NOT configured (the disabled-safe path) this returns `false`, so the
 * fallback reload runs instead — exactly matching the source's intent that the
 * board is refreshed one way or the other.
 */
function eventsConnected(): boolean {
    return !!getEventsUrl();
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
             * passed through unchanged to POST /userstories/bulk_update_backlog_order as `bulk_userstories`
             * (resources/userstories.coffee:92-105). The shared helper DECLARES this parameter as BulkUserStoryOrder[],
             * which is a TYPE/WIRE DISCREPANCY. We MUST preserve the original number[] payload byte-for-byte, so we pass
             * `bulkUserstories as unknown as BulkUserStoryOrder[]`. DO NOT rewrite the payload to [{us_id, order}] objects —
             * that would change the request body the backend receives and break parity. Flagged for review.
             */
            const result = await bulkUpdateBacklogOrder(
                projectIdForCall,
                currentSprintId,
                head.previousUs,
                head.nextUs,
                bulkUserstories as unknown as BulkUserStoryOrder[],
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
        } catch {
            // A rejected reorder leaves the optimistic state in place; the drain
            // below (and, when events are disabled, the fallback reload) brings
            // the board back to server truth. Swallowed so the fire-and-forget
            // queue never surfaces an unhandled rejection.
        } finally {
            // main.coffee:618 — pendingDrag.shift() once the round-trip settles.
            pendingDragRef.current.shift();

            if (pendingDragRef.current.length) {
                // main.coffee:620-629 — recurse for the next queued drag (via the
                // stable ref to avoid a self-referential useCallback dependency).
                void processRef.current();
            } else if (!eventsConnected()) {
                // main.coffee:633-637 — when the queue drains AND events are NOT
                // connected, hard-refresh so the UI reflects server truth.
                void reloadSprints();
                void reloadClosedSprints();
                void reloadStats();
            }
        }
    }, [projectId, reloadSprints, reloadClosedSprints, reloadStats]);

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
            usList.forEach((u) => dispatch({ type: 'removeUsOptimistic', usId: u.id }));

            const data: BulkUserStoryOrder[] = usList.map((u) => ({
                us_id: u.id,
                order: u.sprint_order ?? 0,
            }));

            await bulkUpdateMilestone(projectId, targetSprintId, data);
            // main.coffee:800-801 — refresh sprints and stats after the move.
            await Promise.all([reloadSprints(), reloadStats()]);
        },
        [projectId, reloadSprints, reloadStats],
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
     */
    const saveSprint = useCallback(
        async (payload: Partial<Milestone> & { id: number }): Promise<void> => {
            await saveMilestone(payload);
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

    /** Toggle (or explicitly set) tag visibility. Reducer owns the flag flip. */
    const toggleTags = useCallback((showTags?: boolean): void => {
        dispatch({ type: 'toggleTags', showTags });
    }, []);

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
     * The subscription is established BEFORE the parallel loads, exactly as the
     * source calls `initializeSubscription` before its `$q.all`.
     * ---------------------------------------------------------------------- */
    useEffect(() => {
        if (!projectId) {
            return;
        }

        // Guard so late-resolving awaits never dispatch after unmount /
        // projectId change; the cleanup sets this true and unsubscribes.
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;

        const run = async (): Promise<void> => {
            try {
                // 1. Load the project. There is no shared projects API, so use
                //    the low-level client (main.coffee:469-486). The reducer's
                //    `setProject` derives `isBacklogActivated` and seeds
                //    `swimlanesList`; when the backlog is inactive it simply
                //    surfaces the flag (BacklogApp renders the empty state) —
                //    we do NOT throw/redirect (the AngularJS `permissionDenied`
                //    behaviour is out of scope for the in-place React host).
                const project = await api.get<Project>(`/projects/${projectId}`);
                if (cancelled) {
                    return;
                }
                dispatch({ type: 'setProject', project });

                // 2. Subscribe to live changes BEFORE the parallel loads, using
                //    the IDENTICAL routing keys `changes.project.{id}.userstories`
                //    and `changes.project.{id}.milestones` (main.coffee:223-234).
                //    `subscribeProjectChanges` is a disabled-safe no-op (returns
                //    a no-op unsubscribe) when no events URL is configured — in
                //    that case the post-drag fallback reload does the refreshing.
                unsubscribe = subscribeProjectChanges(projectId, {
                    onUserstories: () => {
                        // changes.project.{id}.userstories (main.coffee:224-226).
                        void reloadAllPaginatedUserstories();
                        void reloadSprints();
                    },
                    onMilestones: () => {
                        // changes.project.{id}.milestones, {selfNotification:true}
                        // handled inside the shared bridge (main.coffee:228-234).
                        void reloadSprints();
                        void reloadClosedSprints();
                        void reloadStats();
                    },
                });

                // 3. Parallel loads — mirrors $q.all([loadProjectStats,
                //    loadSprints, loadUserstories]) (main.coffee:411-414).
                await Promise.all([
                    reloadStats(),
                    reloadSprints(),
                    reloadUserstories({ reset: true }),
                ]);
                if (cancelled) {
                    return;
                }

                // 4. Filters data — source `generateFilters` after load
                //    (main.coffee:498).
                await reloadFiltersData();
                if (cancelled) {
                    return;
                }

                // 5. Done — source emits `backlog:loaded` (main.coffee:499).
                dispatch({ type: 'setLoading', loading: false });
            } catch {
                // On any load error still clear the spinner so the screen does
                // not hang. No retry/backoff (Minimal Change Clause).
                if (!cancelled) {
                    dispatch({ type: 'setLoading', loading: false });
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [
        projectId,
        reloadStats,
        reloadSprints,
        reloadClosedSprints,
        reloadUserstories,
        reloadAllPaginatedUserstories,
        reloadFiltersData,
    ]);

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
        }),
        [
            moveUs,
            moveUsToTopOfBacklog,
            moveToSprint,
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
        ],
    );

    return { state, actions };
}
