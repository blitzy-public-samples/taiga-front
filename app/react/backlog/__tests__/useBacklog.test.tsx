/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklog.test.tsx — browserless Jest (jsdom) unit spec for the EFFECTFUL
 * Backlog state hook (`../state/useBacklog.ts`).
 *
 * WHAT IS ASSERTED
 *   The hook's EFFECTS and their behavioural parity with the (deleted) AngularJS
 *   `BacklogController` (`app/coffee/modules/backlog/main.coffee`) and
 *   `sortable.coffee`:
 *     - the initial-load ORDER and shape: load project → subscribe to live
 *       changes → parallel [stats, sprints, userstories] → filters data →
 *       clear the loading flag, plus unsubscribe-on-unmount;
 *     - the pending-drag QUEUE semantics of `moveUs` (optimistic dispatch +
 *       enqueue + single-in-flight gate + shift/recurse drain + the
 *       `!events.connected` fallback reload) and — the CRITICAL lock — the
 *       byte-for-byte WIRE FORMAT of `bulkUpdateBacklogOrder`
 *       (`(projectId, currentSprintId, previousUs, nextUs, number[])` where the
 *       5th argument is an ARRAY OF USER-STORY ID NUMBERS, main.coffee L535-537),
 *       including the `currentSprintId = newSprintId !== oldSprintId ?
 *       newSprintId : oldSprintId` rule (main.coffee L533) proven for the
 *       reorder / backlog→sprint / sprint→backlog cases;
 *     - server reconciliation (`reconcileMoveResult`, main.coffee L611-617);
 *     - `moveToSprint` posting the CONTRASTING `{ us_id, order }[]` shape via
 *       `bulkUpdateMilestone` (main.coffee L794-799);
 *     - the sprint CRUD thunks (`createSprint`/`saveSprint`/`removeSprint`), the
 *       optimistic `bulkCreateUs`/`addUsOptimistic`/`removeUsOptimistic`, the
 *       filter/toggle/reload passthroughs, and the WebSocket
 *       `onUserstories`/`onMilestones` handlers.
 *
 * RECONCILED-AGAINST-ACTUAL
 *   Every mock, call assertion, and argument tuple below is aligned to the
 *   AUTHORED `../state/useBacklog.ts` (not merely to the recorded spec). Notably:
 *   the authored `bulkCreateUs` does NOT call the `bulkCreate` API — the
 *   `BulkCreateUsLightbox` owns that call — so this spec asserts the AUTHORED
 *   form (optimistic insert + stats reload; `bulkCreate` NOT called).
 *
 * TEST-LAYER ISOLATION (hard requirement)
 *   No network, no real WebSocket, no browser engine, no AngularJS. EVERY
 *   effectful shared module is mocked at the top level (hoisted): the transport
 *   `../../shared/api/client`, the `../../shared/api/userstories` and
 *   `../../shared/api/milestones` wrappers, the `../../shared/events` bridge and
 *   the `../../shared/session` accessors. The PURE `../state/backlogReducer` and
 *   `moment` are deliberately NOT mocked, so real reducer state makes the
 *   assertions meaningful. Jest globals (`describe`/`it`/`expect`/`jest`/
 *   `beforeEach`/`afterEach`) and the jest-dom matchers come from the runner
 *   configuration (root `jest.config.js` + `tsconfig.json` `types`), so nothing
 *   is imported for them. React's automatic JSX runtime means there is NO
 *   `import React`.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import { useBacklog } from '../state/useBacklog';
import { api, ApiError } from '../../shared/api/client';
import {
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    bulkCreate,
    filtersData,
} from '../../shared/api/userstories';
import { listMilestones, createMilestone, saveMilestone } from '../../shared/api/milestones';
import { subscribeProjectChanges, isEventsConnected } from '../../shared/events';
import { getEventsUrl } from '../../shared/session';
import type { Project, UserStory, Milestone, FiltersData } from '../../shared/types';
import { makeProject, makeUserStory, makeMilestone, makeFiltersData } from './factories';

/* ========================================================================== *
 * Module mocks — ALL effectful shared modules (hoisted above the imports by
 * jest). The factories reference no out-of-scope bindings, so they are safe
 * under jest's mock hoisting.
 * ========================================================================== */

// Transport adapter: a path-routing `api` double. The hook uses `api.get`,
// `api.request` and `api.del` directly; the verb helpers are all provided.
jest.mock('../../shared/api/client', () => ({
    __esModule: true,
    api: {
        request: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        del: jest.fn(),
    },
    // Faithful to the real `ApiError` (client.ts) so the hook's
    // `describeReorderError` body-parsing path (F-AAP-03) is genuinely
    // exercised: it sets `status`/`body` and the `ApiError` name.
    ApiError: class ApiError extends Error {
        status: number;
        body: unknown;
        constructor(status: number, body: unknown, message?: string) {
            super(message ?? `Request failed with status ${status}`);
            this.name = 'ApiError';
            this.status = status;
            this.body = body;
        }
    },
}));

// User-story bulk wrappers: mocked resolved fns. `bulkCreate` is mocked too
// (per the folder contract) even though the AUTHORED hook does not call it — we
// assert that it stays uncalled.
jest.mock('../../shared/api/userstories', () => ({
    __esModule: true,
    bulkUpdateBacklogOrder: jest.fn(),
    bulkUpdateMilestone: jest.fn(),
    bulkCreate: jest.fn(),
    filtersData: jest.fn(),
}));

// Milestone (sprint) wrappers: mocked resolved fns.
jest.mock('../../shared/api/milestones', () => ({
    __esModule: true,
    listMilestones: jest.fn(),
    createMilestone: jest.fn(),
    saveMilestone: jest.fn(),
}));

// Events bridge: `subscribeProjectChanges` returns an unsubscribe spy, and
// `isEventsConnected` reports the REAL socket state consulted by the hook's
// post-drag `eventsConnected()` gate (F-AAP-03).
jest.mock('../../shared/events', () => ({
    __esModule: true,
    subscribeProjectChanges: jest.fn(),
    isEventsConnected: jest.fn(),
}));

// Session accessors. Only `getEventsUrl` is consumed by the hook (it gates the
// post-drag `eventsConnected()` fallback reload); the rest are provided as
// harmless jest.fn()s for completeness.
jest.mock('../../shared/session', () => ({
    __esModule: true,
    getEventsUrl: jest.fn(),
    getConfig: jest.fn(),
    getApiUrl: jest.fn(),
    getAuthToken: jest.fn(),
    getSessionId: jest.fn(),
}));

/* ========================================================================== *
 * Typed handles onto the mocked functions
 * ========================================================================== */

const requestMock = api.request as unknown as jest.Mock;
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const patchMock = api.patch as unknown as jest.Mock;
const putMock = api.put as unknown as jest.Mock;
const delMock = api.del as unknown as jest.Mock;

const bulkBacklogOrderMock = bulkUpdateBacklogOrder as unknown as jest.Mock;
const bulkMilestoneMock = bulkUpdateMilestone as unknown as jest.Mock;
const bulkCreateMock = bulkCreate as unknown as jest.Mock;
const filtersDataMock = filtersData as unknown as jest.Mock;

const listMilestonesMock = listMilestones as unknown as jest.Mock;
const createMilestoneMock = createMilestone as unknown as jest.Mock;
const saveMilestoneMock = saveMilestone as unknown as jest.Mock;

const subscribeMock = subscribeProjectChanges as unknown as jest.Mock;
const getEventsUrlMock = getEventsUrl as unknown as jest.Mock;
const isEventsConnectedMock = isEventsConnected as unknown as jest.Mock;

/** The numeric project id under test (the hook receives a NUMBER). */
const PID = 7;

/* ========================================================================== *
 * Test-only helpers
 * ========================================================================== */

/**
 * A case-insensitive `.get()` header double, standing in for the WHATWG
 * `Headers` the real `api.request` exposes. The hook reads `x-pagination-next`,
 * `Taiga-Info-Backlog-Total-Userstories` and `Taiga-Info-Userstories-Without-
 * Swimlane`, so those names must resolve regardless of casing.
 */
function makeHeaders(map: Record<string, string>): Headers {
    const lower: Record<string, string> = {};
    Object.keys(map).forEach((k) => {
        lower[k.toLowerCase()] = map[k];
    });
    return {
        get: (name: string): string | null => {
            const v = lower[name.toLowerCase()];
            return v === undefined ? null : v;
        },
    } as unknown as Headers;
}

/** A manually-resolvable promise, used to drive the single-in-flight queue test. */
interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}
function deferred<T = unknown>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Shape of a single server-returned reconcile row. */
type MoveRow = { id: number; milestone: number | null; backlog_order?: number };

/* ========================================================================== *
 * Mutable fixtures (reset in beforeEach); the routing closures read them so a
 * test can reassign one BEFORE `renderLoaded()` to change what the load returns.
 * ========================================================================== */

let projectFixture: Project;
let statsFixture: Record<string, unknown>;
let userstoriesFixture: UserStory[];
let usHeaders: Record<string, string>;
let openSprintsFixture: Milestone[];
let closedSprintsFixture: Milestone[];
let openTotals: { open: number; closed: number };
let closedTotals: { open: number; closed: number };
let filtersDataFixture: FiltersData;
let unsubscribeSpy: jest.Mock;

beforeEach(() => {
    // Fully reset every mock (calls + implementations + once-queues) so each
    // test starts from a pristine baseline, then wire fresh implementations.
    [
        requestMock,
        getMock,
        postMock,
        patchMock,
        putMock,
        delMock,
        bulkBacklogOrderMock,
        bulkMilestoneMock,
        bulkCreateMock,
        filtersDataMock,
        listMilestonesMock,
        createMilestoneMock,
        saveMilestoneMock,
        subscribeMock,
        getEventsUrlMock,
        isEventsConnectedMock,
    ].forEach((m) => m.mockReset());

    // F-CQ-09: the hook now persists/rehydrates show-tags in localStorage.
    // Clear it before every test so a persisted value from one test cannot leak
    // into another (which would flip the default `showTags` on mount).
    try {
        window.localStorage.clear();
    } catch {
        /* jsdom storage always present; guard for safety */
    }

    projectFixture = makeProject({ id: PID });
    // total_points || defined_points = 100 basis; completedPercentage =
    // round(100 * 25 / 100) = 25; showGraphPlaceholder = !(100 && 4) = false.
    statsFixture = {
        total_points: 100,
        defined_points: 80,
        closed_points: 25,
        total_milestones: 4,
        speed: 3,
    };
    userstoriesFixture = [
        makeUserStory({ id: 1, ref: 1, project: PID, milestone: null, backlog_order: 1 }),
        makeUserStory({ id: 2, ref: 2, project: PID, milestone: null, backlog_order: 2 }),
    ];
    usHeaders = {
        'Taiga-Info-Backlog-Total-Userstories': '2',
        'Taiga-Info-Userstories-Without-Swimlane': '0',
    };
    openSprintsFixture = [makeMilestone({ id: 10, name: 'Open Sprint' })];
    closedSprintsFixture = [makeMilestone({ id: 90, name: 'Closed Sprint', closed: true })];
    openTotals = { open: 1, closed: 2 };
    closedTotals = { open: 1, closed: 2 };
    filtersDataFixture = makeFiltersData();
    unsubscribeSpy = jest.fn();

    // api.get(path) — resolves to the BODY directly (project + stats routes).
    getMock.mockImplementation((path: string) => {
        if (path === `/projects/${PID}`) {
            return Promise.resolve(projectFixture);
        }
        if (path === `/projects/${PID}/stats`) {
            return Promise.resolve(statsFixture);
        }
        return Promise.reject(new Error(`unexpected api.get path: ${path}`));
    });

    // api.request(method, path, { params }) — the header-exposing userstories path.
    requestMock.mockImplementation((_method: string, path: string) => {
        if (path === '/userstories') {
            return Promise.resolve({
                data: userstoriesFixture,
                status: 200,
                headers: makeHeaders(usHeaders),
            });
        }
        return Promise.reject(new Error(`unexpected api.request path: ${path}`));
    });

    // api.del(path) — resolves empty (204-style).
    delMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue(undefined);
    patchMock.mockResolvedValue(undefined);
    putMock.mockResolvedValue(undefined);

    // listMilestones(projectId, { closed }) — routes open vs closed sprints and
    // returns the { milestones, open, closed } shape the reducer consumes.
    listMilestonesMock.mockImplementation((_pid: number, opts?: { closed?: boolean }) => {
        const isClosed = opts?.closed === true;
        return Promise.resolve({
            milestones: isClosed ? closedSprintsFixture : openSprintsFixture,
            open: isClosed ? closedTotals.open : openTotals.open,
            closed: isClosed ? closedTotals.closed : openTotals.closed,
        });
    });

    filtersDataMock.mockImplementation(() => Promise.resolve(filtersDataFixture));
    createMilestoneMock.mockImplementation((payload: Record<string, unknown>) =>
        Promise.resolve(makeMilestone({ id: 100, ...(payload as Partial<Milestone>) })),
    );
    // saveMilestone(id, changes, version?) — the F-REG-05 minimal-diff contract.
    saveMilestoneMock.mockImplementation(
        (id: number, changes: Partial<Milestone>) =>
            Promise.resolve(makeMilestone({ ...changes, id })),
    );
    bulkBacklogOrderMock.mockResolvedValue([] as MoveRow[]);
    bulkMilestoneMock.mockResolvedValue([]);
    bulkCreateMock.mockResolvedValue([]);

    subscribeMock.mockReturnValue(unsubscribeSpy);
    // Default: a truthy events URL (the bridge is configured for subscriptions).
    getEventsUrlMock.mockReturnValue('ws://localhost:9000/events');
    // Default: the socket is genuinely CONNECTED (F-AAP-03), so the post-drag
    // fallback reload is SUPPRESSED and per-test call counts stay focused. The
    // dedicated 'events-disconnected reload' block overrides this to false.
    isEventsConnectedMock.mockReturnValue(true);
});

afterEach(() => {
    jest.clearAllMocks();
});

/** Render the hook and wait until the initial load has settled. */
async function renderLoaded(projectId: number = PID) {
    const rendered = renderHook(({ id }: { id: number }) => useBacklog(id), {
        initialProps: { id: projectId },
    });
    await waitFor(() => expect(rendered.result.current.state.loading).toBe(false));
    return rendered;
}

/** Clear call records on the API doubles while preserving their routing impls. */
function clearApiCalls(): void {
    [
        requestMock,
        getMock,
        postMock,
        patchMock,
        putMock,
        delMock,
        bulkBacklogOrderMock,
        bulkMilestoneMock,
        bulkCreateMock,
        filtersDataMock,
        listMilestonesMock,
        createMilestoneMock,
        saveMilestoneMock,
    ].forEach((m) => m.mockClear());
}

/* ========================================================================== *
 * describe('useBacklog') — the full effect contract
 * ========================================================================== */

describe('useBacklog', () => {
    /* ---------------------------------------------------------------------- *
     * Initial load
     * ---------------------------------------------------------------------- */
    describe('initial load', () => {
        it('loads project, subscribes with both handlers, runs the parallel loads + filters, then clears loading', async () => {
            // Seed the backlog OUT OF ORDER to prove the reducer sorts by backlog_order.
            userstoriesFixture = [
                makeUserStory({ id: 2, ref: 2, project: PID, milestone: null, backlog_order: 2 }),
                makeUserStory({ id: 1, ref: 1, project: PID, milestone: null, backlog_order: 1 }),
            ];

            const { result } = await renderLoaded();

            // Project loaded and backlog activation surfaced.
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}`);
            expect(result.current.state.project?.id).toBe(PID);
            expect(result.current.state.isBacklogActivated).toBe(true);

            // Subscription established once with the numeric projectId + both handlers.
            expect(subscribeMock).toHaveBeenCalledTimes(1);
            expect(subscribeMock).toHaveBeenCalledWith(
                PID,
                expect.objectContaining({
                    onUserstories: expect.any(Function),
                    onMilestones: expect.any(Function),
                }),
            );

            // Parallel loads used the expected shared functions.
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(filtersDataMock).toHaveBeenCalledWith(PID, {});

            // Stats computed by the hook (round(100 * 25 / 100) = 25; placeholder off).
            expect(result.current.state.stats?.completedPercentage).toBe(25);
            expect(result.current.state.stats?.showGraphPlaceholder).toBe(false);

            // Sprints + totals from the list result (open 1 + closed 2 = 3).
            expect(result.current.state.sprints).toHaveLength(1);
            expect(result.current.state.totalMilestones).toBe(3);
            expect(result.current.state.totalClosedMilestones).toBe(2);

            // Userstories sorted ascending by backlog_order, totals from headers.
            expect(result.current.state.userstories.map((u) => u.id)).toEqual([1, 2]);
            expect(result.current.state.totalUserStories).toBe(2);
            expect(result.current.state.noSwimlaneUserStories).toBe(false);

            // Filters populated; the /userstories query used the `milestone=null`
            // backlog sentinel + `project` and carried NO `page_size` on the normal path.
            expect(result.current.state.filtersData).not.toBeNull();
            const usCall = requestMock.mock.calls.find((c) => c[1] === '/userstories');
            expect(usCall).toBeDefined();
            const usParams = (usCall as unknown[])[2] as { params: Record<string, unknown> };
            expect(usParams.params.milestone).toBe('null');
            expect(usParams.params.project).toBe(PID);
            expect('page_size' in usParams.params).toBe(false);
        });

        it('does nothing (no calls, stays loading) when projectId is falsy', async () => {
            const { result } = renderHook(() => useBacklog(0));
            // Let any (erroneously scheduled) microtasks run.
            await act(async () => {
                await Promise.resolve();
            });

            expect(getMock).not.toHaveBeenCalled();
            expect(subscribeMock).not.toHaveBeenCalled();
            expect(result.current.state.loading).toBe(true);
        });

        it('still clears loading when the project load rejects (no hang)', async () => {
            getMock.mockImplementation((path: string) => {
                if (path === `/projects/${PID}`) {
                    return Promise.reject(new Error('boom'));
                }
                return Promise.resolve(statsFixture);
            });

            const { result } = renderHook(() => useBacklog(PID));
            await waitFor(() => expect(result.current.state.loading).toBe(false));

            // The project was never stored (the load short-circuited into the catch).
            expect(result.current.state.project).toBeNull();
        });

        it('unsubscribes on unmount (no listener leak)', async () => {
            const { unmount } = await renderLoaded();

            expect(subscribeMock).toHaveBeenCalledTimes(1);
            expect(unsubscribeSpy).not.toHaveBeenCalled();

            unmount();

            expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
        });
    });

    /* ---------------------------------------------------------------------- *
     * Derived helpers exercised through the load (computeStats / findCurrentSprint)
     * ---------------------------------------------------------------------- */
    describe('derived load helpers', () => {
        it('computeStats yields 0% + graph placeholder when there is no points basis', async () => {
            // No total_points / total_milestones → basis 0 → 0%; placeholder on.
            statsFixture = { closed_points: 10 };

            const { result } = await renderLoaded();

            expect(result.current.state.stats?.completedPercentage).toBe(0);
            expect(result.current.state.stats?.showGraphPlaceholder).toBe(true);
        });

        it('findCurrentSprint selects the OPEN sprint whose date range contains now', async () => {
            const day = 86400000;
            const fmt = (d: Date): string => d.toISOString().slice(0, 10); // YYYY-MM-DD
            const now = Date.now();
            openSprintsFixture = [
                makeMilestone({
                    id: 10,
                    estimated_start: fmt(new Date(now - 5 * day)),
                    estimated_finish: fmt(new Date(now + 5 * day)),
                }),
            ];

            const { result } = await renderLoaded();

            expect(result.current.state.currentSprint?.id).toBe(10);
        });

        it('findCurrentSprint returns null when no open sprint contains now', async () => {
            const day = 86400000;
            const fmt = (d: Date): string => d.toISOString().slice(0, 10);
            const now = Date.now();
            openSprintsFixture = [
                makeMilestone({
                    id: 10,
                    estimated_start: fmt(new Date(now - 30 * day)),
                    estimated_finish: fmt(new Date(now - 20 * day)),
                }),
            ];

            const { result } = await renderLoaded();

            expect(result.current.state.currentSprint).toBeNull();
        });
    });

    /* ---------------------------------------------------------------------- *
     * moveUs thunk — WIRE FORMAT (the critical lock)
     * ---------------------------------------------------------------------- */
    describe('moveUs thunk — wire format', () => {
        it('reorders within the backlog and posts the ARRAY-OF-IDS wire format (currentSprintId null)', async () => {
            const us10 = makeUserStory({ id: 10, ref: 10, project: PID, milestone: null, backlog_order: 1 });
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            const us30 = makeUserStory({ id: 30, ref: 30, project: PID, milestone: null, backlog_order: 3 });
            userstoriesFixture = [us10, us20, us30];
            bulkBacklogOrderMock.mockResolvedValue([{ id: 20, milestone: null, backlog_order: 15 }]);

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUs([us20], 1, null, 10, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            // Reorder within the backlog: newSprintId null === oldSprintId null →
            // currentSprintId === null; 5th arg is the NUMBER array [20].
            expect(bulkBacklogOrderMock).toHaveBeenCalledWith(PID, null, 10, null, [20]);

            const lastCall = bulkBacklogOrderMock.mock.calls[bulkBacklogOrderMock.mock.calls.length - 1];
            expect(Array.isArray(lastCall[4])).toBe(true);
            expect(typeof lastCall[4][0]).toBe('number');
            expect(lastCall[4]).toEqual([20]);
        });

        it('backlog → sprint sets currentSprintId to the destination sprint id', async () => {
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            // Destination sprint id 10 (the open sprint), distinct from PID, so the
            // 2nd argument unambiguously proves currentSprintId = newSprintId.
            await act(async () => {
                result.current.actions.moveUs([us20], 0, 10, null, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            const call = bulkBacklogOrderMock.mock.calls[0];
            expect(call[0]).toBe(PID); // project = usList[0].project
            expect(call[1]).toBe(10); // currentSprintId = newSprintId (10 !== null)
            expect(call[4]).toEqual([20]);
        });

        it('sprint → backlog sends currentSprintId null via the !== rule (NOT ?? oldSprintId)', async () => {
            // A story living in sprint 5, dragged to the backlog (newSprintId null).
            const us40 = makeUserStory({ id: 40, ref: 40, project: PID, milestone: 5 });

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUs([us40], 0, null, null, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            const call = bulkBacklogOrderMock.mock.calls[0];
            // null !== 5 → currentSprintId = null. A `payload.sprint ?? oldSprintId`
            // would have WRONGLY sent 5; this proves the `!==` rule.
            expect(call[1]).toBeNull();
            expect(call[0]).toBe(PID);
            expect(call[4]).toEqual([40]);
        });

        it('moveUsToTopOfBacklog anchors the move before the first backlog story', async () => {
            const first = makeUserStory({ id: 10, ref: 10, project: PID, milestone: null, backlog_order: 1 });
            const mover = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [first, mover];

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUsToTopOfBacklog(mover);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            // moveUsToTopOfBacklog → moveUs([mover], 0, null, null, nextUs=first.id).
            const call = bulkBacklogOrderMock.mock.calls[0];
            expect(call[0]).toBe(PID);
            expect(call[1]).toBeNull(); // currentSprintId (backlog reorder)
            expect(call[2]).toBeNull(); // previousUs
            expect(call[3]).toBe(10); // nextUs = first backlog story id
            expect(call[4]).toEqual([20]);
        });
    });

    /* ---------------------------------------------------------------------- *
     * reconcileMoveResult after the server resolves
     * ---------------------------------------------------------------------- */
    describe('reconcileMoveResult after server resolve', () => {
        it('applies the server-returned backlog_order to the moved story', async () => {
            const us10 = makeUserStory({ id: 10, ref: 10, project: PID, milestone: null, backlog_order: 1 });
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            const us30 = makeUserStory({ id: 30, ref: 30, project: PID, milestone: null, backlog_order: 3 });
            userstoriesFixture = [us10, us20, us30];
            bulkBacklogOrderMock.mockResolvedValue([{ id: 20, milestone: null, backlog_order: 99 }]);

            const { result } = await renderLoaded();

            await act(async () => {
                result.current.actions.moveUs([us20], 1, null, 10, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            await waitFor(() => {
                const found = result.current.state.userstories.find((u) => u.id === 20);
                expect(found?.backlog_order).toBe(99);
            });
        });
    });

    /* ---------------------------------------------------------------------- *
     * pending-drag single-in-flight queue (shift + recurse)
     * ---------------------------------------------------------------------- */
    describe('pending-drag single-in-flight queue', () => {
        it('serialises concurrent drags: one request in flight, the next fires when the first resolves', async () => {
            const us10 = makeUserStory({ id: 10, ref: 10, project: PID, milestone: null, backlog_order: 1 });
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us10, us20];

            const d1 = deferred<MoveRow[]>();
            const d2 = deferred<MoveRow[]>();

            const { result } = await renderLoaded();
            clearApiCalls();

            // First call → d1 (pending), second call → d2 (pending), rest → [].
            bulkBacklogOrderMock.mockReset();
            bulkBacklogOrderMock.mockResolvedValue([] as MoveRow[]);
            bulkBacklogOrderMock.mockReturnValueOnce(d1.promise);
            bulkBacklogOrderMock.mockReturnValueOnce(d2.promise);

            // Fire two drags before resolving anything.
            act(() => {
                result.current.actions.moveUs([us10], 0, null, null, null);
                result.current.actions.moveUs([us20], 1, null, 10, null);
            });

            // Only the FIRST is in flight; the second is queued (single-in-flight gate).
            expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1);

            // Resolve the first → the queue shifts and the second fires (recurse).
            await act(async () => {
                d1.resolve([]);
                await d1.promise;
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(2));

            // Drain the queue.
            await act(async () => {
                d2.resolve([]);
                await d2.promise;
            });
            expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(2);
        });
    });

    /* ---------------------------------------------------------------------- *
     * moveToSprint — CONTRASTING { us_id, order }[] wire shape
     * ---------------------------------------------------------------------- */
    describe('moveToSprint uses bulkUpdateMilestone with { us_id, order }[]', () => {
        it('removes the stories from the backlog and posts the object-array shape', async () => {
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, sprint_order: 3 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                await result.current.actions.moveToSprint([us20], 10);
            });

            expect(bulkMilestoneMock).toHaveBeenCalledTimes(1);
            // (projectId, milestoneId, [{ us_id, order }]) — NOT the backlog-order number[].
            expect(bulkMilestoneMock).toHaveBeenCalledWith(PID, 10, [{ us_id: 20, order: 3 }]);

            const arg = bulkMilestoneMock.mock.calls[0][2];
            expect(Array.isArray(arg)).toBe(true);
            expect(arg[0]).toHaveProperty('us_id');
            expect(arg[0]).toHaveProperty('order');

            // The story was optimistically removed from the backlog list.
            expect(result.current.state.userstories.some((u) => u.id === 20)).toBe(false);
        });
    });

    /* ---------------------------------------------------------------------- *
     * sprint CRUD + bulk-create + filters/toggles/passthroughs
     * ---------------------------------------------------------------------- */
    describe('sprint CRUD & filters actions', () => {
        it('createSprint calls createMilestone then reloads open sprints', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            const payload = {
                project: PID,
                name: 'New Sprint',
                estimated_start: '2021-02-01',
                estimated_finish: '2021-02-14',
            };
            await act(async () => {
                await result.current.actions.createSprint(payload);
            });

            expect(createMilestoneMock).toHaveBeenCalledWith(payload);
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
        });

        it('saveSprint forwards (id, changes, version) to saveMilestone then reloads open + closed sprints', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            // F-REG-05: only the CHANGED attributes + version, never a whole model.
            const changes = {
                name: 'Renamed Sprint',
                estimated_start: '2021-03-01',
                estimated_finish: '2021-03-14',
            };
            await act(async () => {
                await result.current.actions.saveSprint(10, changes, 7);
            });

            // The id is the path segment; the body is the minimal diff + version.
            expect(saveMilestoneMock).toHaveBeenCalledWith(10, changes, 7);
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true });
        });

        it('removeSprint deletes via the low-level api.del then reloads everything', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                await result.current.actions.removeSprint(10);
            });

            expect(delMock).toHaveBeenCalledWith('/milestones/10');
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true });
            expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
        });

        it('bulkCreateUs optimistically inserts the created stories and refreshes stats (authored form — no bulkCreate call)', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            const created = [makeUserStory({ id: 555, ref: 555, project: PID, milestone: null })];
            act(() => {
                result.current.actions.bulkCreateUs(created, 'top');
            });

            // Inserted optimistically...
            expect(result.current.state.userstories.some((u) => u.id === 555)).toBe(true);
            // ...and stats reloaded.
            await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
            // RECONCILE: the authored hook does NOT call the bulkCreate API here
            // (the BulkCreateUsLightbox owns that call).
            expect(bulkCreateMock).not.toHaveBeenCalled();
        });

        it('setFilters stores the filters, flags active, and reloads stories + facets', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            act(() => {
                result.current.actions.setFilters({ status: '1' });
            });

            expect(result.current.state.selectedFilters).toEqual({ status: '1' });
            expect(result.current.state.activeFilters).toBe(true);

            await waitFor(() =>
                expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything()),
            );
            // Facets reload forwards the just-applied filters (synchronous stateRef sync).
            expect(filtersDataMock).toHaveBeenCalledWith(PID, { status: '1' });
        });

        it('toggleTags flips the tag-visibility flag', async () => {
            const { result } = await renderLoaded();

            expect(result.current.state.showTags).toBe(true); // initial default
            act(() => {
                result.current.actions.toggleTags();
            });
            expect(result.current.state.showTags).toBe(false);

            act(() => {
                result.current.actions.toggleTags(true);
            });
            expect(result.current.state.showTags).toBe(true);
        });

        it('toggleVelocity enables the forecast and lazy-loads closed sprints once', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            expect(result.current.state.displayVelocity).toBe(false);
            expect(result.current.state.closedSprints).toHaveLength(0);

            act(() => {
                result.current.actions.toggleVelocity(true);
            });

            expect(result.current.state.displayVelocity).toBe(true);
            await waitFor(() => expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true }));
        });

        it('reload passthroughs each hit their endpoint', async () => {
            const { result } = await renderLoaded();

            clearApiCalls();
            act(() => {
                result.current.actions.reloadUserstories();
            });
            await waitFor(() =>
                expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything()),
            );

            clearApiCalls();
            act(() => {
                result.current.actions.reloadSprints();
            });
            await waitFor(() => expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false }));

            clearApiCalls();
            act(() => {
                result.current.actions.reloadClosedSprints();
            });
            await waitFor(() => expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true }));

            clearApiCalls();
            act(() => {
                result.current.actions.reloadStats();
            });
            await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
        });

        it('addUsOptimistic / removeUsOptimistic mutate the backlog list', async () => {
            const { result } = await renderLoaded();

            const created = makeUserStory({ id: 777, ref: 777, project: PID, milestone: null });
            act(() => {
                result.current.actions.addUsOptimistic([created], 'bottom');
            });
            expect(result.current.state.userstories.some((u) => u.id === 777)).toBe(true);

            act(() => {
                result.current.actions.removeUsOptimistic(777);
            });
            expect(result.current.state.userstories.some((u) => u.id === 777)).toBe(false);
        });
    });

    /* ---------------------------------------------------------------------- *
     * WebSocket handlers + actions stability
     * ---------------------------------------------------------------------- */
    describe('websocket handlers + stability', () => {
        it('onUserstories reloads the paginated stories + open sprints', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            const handlers = subscribeMock.mock.calls[0][1];
            await act(async () => {
                handlers.onUserstories({});
                await Promise.resolve();
            });

            await waitFor(() =>
                expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything()),
            );
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
        });

        it('onMilestones reloads open + closed sprints + stats', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();

            const handlers = subscribeMock.mock.calls[0][1];
            await act(async () => {
                handlers.onMilestones({});
                await Promise.resolve();
            });

            await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true });
        });

        it('exposes the full action contract and a referentially-stable actions object', async () => {
            const { result, rerender } = await renderLoaded();

            const actions = result.current.actions;
            const expected = [
                'moveUs',
                'moveUsToTopOfBacklog',
                'moveToSprint',
                'bulkCreateUs',
                'createSprint',
                'saveSprint',
                'removeSprint',
                'setFilters',
                'toggleTags',
                'toggleVelocity',
                'reloadUserstories',
                'reloadSprints',
                'reloadClosedSprints',
                'reloadStats',
                'addUsOptimistic',
                'removeUsOptimistic',
            ];
            expected.forEach((key) => {
                expect(typeof (actions as unknown as Record<string, unknown>)[key]).toBe('function');
            });

            // Stable across re-renders with the same projectId (all memoized).
            rerender({ id: PID });
            expect(result.current.actions).toBe(actions);
        });
    });

    /* ---------------------------------------------------------------------- *
     * events-disconnected fallback reload after the queue drains
     * ---------------------------------------------------------------------- */
    describe('events-disconnected reload', () => {
        it('hard-refreshes sprints/closed/stats after the queue drains when events are disconnected', async () => {
            isEventsConnectedMock.mockReturnValue(false); // eventsConnected() → false

            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUs([us20], 0, null, null, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            // Queue drained + events NOT connected → fallback reload fires.
            await waitFor(() => expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false }));
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
        });

        it('does NOT hard-refresh after a drag when events are connected', async () => {
            isEventsConnectedMock.mockReturnValue(true); // connected

            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUs([us20], 0, null, null, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));
            await act(async () => {
                await Promise.resolve();
            });

            // No fallback reload while events keep the board fresh.
            expect(listMilestonesMock).not.toHaveBeenCalled();
            expect(getMock).not.toHaveBeenCalled();
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-AAP-03: failed-write reconciliation + surfacing
     * ---------------------------------------------------------------------- */
    describe('failed-write reconciliation (F-AAP-03)', () => {
        it('reconciles to server truth after a FAILED reorder even when events are connected', async () => {
            // Connected: pushes would normally keep the board fresh — but a
            // rejected write emits NO live event, so a reload is mandatory.
            isEventsConnectedMock.mockReturnValue(true);
            bulkBacklogOrderMock.mockRejectedValueOnce(new Error('network down'));

            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                result.current.actions.moveUs([us20], 0, null, null, null);
            });
            await waitFor(() => expect(bulkBacklogOrderMock).toHaveBeenCalledTimes(1));

            // The failed write forces the fallback reload despite being connected.
            await waitFor(() => expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false }));
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: true });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);

            // F-AAP-03 (dest#8) REVERT: a failed reorder ALSO refetches the
            // backlog user-story list to server truth (via the same
            // `reloadAllPaginatedUserstories` loader the live `onUserstories`
            // handler uses) so the rejected optimistic move is visibly reverted
            // rather than left stale beneath the error toast.
            await waitFor(() =>
                expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything()),
            );
        });

        it('surfaces a moveError from the server envelope on a failed reorder, then clears it on the next success', async () => {
            isEventsConnectedMock.mockReturnValue(true);

            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, backlog_order: 2 });
            userstoriesFixture = [us20];

            const { result } = await renderLoaded();
            clearApiCalls();

            // 1) A rejected reorder surfaces the server `_error_message` (not
            //    swallowed, and NOT the raw Error/class name).
            bulkBacklogOrderMock.mockRejectedValueOnce(
                new ApiError(400, { _error_message: 'Server rejected the reorder' }, 'Bad Request'),
            );
            await act(async () => {
                result.current.actions.moveUs([us20], 0, null, null, null);
            });
            await waitFor(() => expect(result.current.state.moveError).toBe('Server rejected the reorder'));

            // 2) A subsequent successful reorder clears the surfaced error
            //    (fresh optimistic move clears it; the reconcile confirms it).
            bulkBacklogOrderMock.mockResolvedValueOnce([{ id: 20, milestone: null, backlog_order: 1 }]);
            await act(async () => {
                result.current.actions.moveUs([us20], 0, null, null, null);
            });
            await waitFor(() => expect(result.current.state.moveError).toBeNull());
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-CQ-05 — guarded load-more pagination
     * ---------------------------------------------------------------------- */
    describe('pagination — guarded load-more (F-CQ-05)', () => {
        const usA = makeUserStory({ id: 1, ref: 1, project: PID, milestone: null, backlog_order: 1 });
        const usB = makeUserStory({ id: 2, ref: 2, project: PID, milestone: null, backlog_order: 2 });

        /**
         * Route `/userstories` by the `page` query param: page 1 optionally
         * carries `x-pagination-next` (more pages remain); page 2 carries no
         * next header (last page → `disablePagination`).
         */
        function wirePages(firstHasNext: boolean): void {
            requestMock.mockImplementation(
                (_m: string, path: string, o?: { params?: Record<string, unknown> }) => {
                    if (path !== '/userstories') {
                        return Promise.reject(new Error(`unexpected path ${path}`));
                    }
                    const page = o?.params?.page;
                    if (page === 1) {
                        return Promise.resolve({
                            data: [usA],
                            status: 200,
                            headers: makeHeaders(firstHasNext ? { 'x-pagination-next': 'true' } : {}),
                        });
                    }
                    if (page === 2) {
                        return Promise.resolve({ data: [usB], status: 200, headers: makeHeaders({}) });
                    }
                    return Promise.resolve({ data: [], status: 200, headers: makeHeaders({}) });
                },
            );
        }

        it('appends the next page, advances the cursor, then locks at the end', async () => {
            wirePages(true);
            const { result } = await renderLoaded();

            // Initial page 1 loaded; more pages remain → pagination NOT disabled.
            expect(result.current.state.userstories.map((u) => u.id)).toEqual([1]);
            expect(result.current.state.disablePagination).toBe(false);

            await act(async () => {
                await result.current.actions.loadMore();
            });

            // Page 2 APPENDED (not reset); no further next → pagination locked;
            // the in-flight spinner is cleared.
            expect(result.current.state.userstories.map((u) => u.id)).toEqual([1, 2]);
            expect(result.current.state.disablePagination).toBe(true);
            expect(result.current.state.loadingUserstories).toBe(false);
        });

        it('is a no-op once the last page is reached (disablePagination guard)', async () => {
            wirePages(false);
            const { result } = await renderLoaded();
            expect(result.current.state.disablePagination).toBe(true);
            clearApiCalls();

            await act(async () => {
                await result.current.actions.loadMore();
            });

            // Guarded out — no further page request fired.
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('guards overlapping load-more calls to a SINGLE in-flight request', async () => {
            wirePages(true);
            const { result } = await renderLoaded();
            clearApiCalls();

            // Hold the next-page request open so both calls overlap.
            const d = deferred<{ data: UserStory[]; status: number; headers: Headers }>();
            requestMock.mockImplementationOnce(() => d.promise);

            await act(async () => {
                const p1 = result.current.actions.loadMore();
                const p2 = result.current.actions.loadMore();
                // The second call is guarded out synchronously by the in-flight ref.
                expect(requestMock).toHaveBeenCalledTimes(1);
                d.resolve({ data: [usB], status: 200, headers: makeHeaders({}) });
                await Promise.all([p1, p2]);
            });

            expect(requestMock).toHaveBeenCalledTimes(1);
            // No DUPLICATE append — the page landed exactly once.
            expect(result.current.state.userstories.map((u) => u.id)).toEqual([1, 2]);
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-REG-06 — moveToSprint rollback + error surfacing
     * ---------------------------------------------------------------------- */
    describe('moveToSprint rollback + error surfacing (F-REG-06)', () => {
        it('on a FAILED move: reconciles to server truth (reload), surfaces moveError, and rethrows', async () => {
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, sprint_order: 3 });
            userstoriesFixture = [us20];
            const { result } = await renderLoaded();
            clearApiCalls();

            bulkMilestoneMock.mockRejectedValueOnce(
                new ApiError(400, { _error_message: 'Cannot move to sprint' }, 'Bad Request'),
            );

            // The thunk REJECTS so the caller can restore the selection.
            await act(async () => {
                await expect(result.current.actions.moveToSprint([us20], 10)).rejects.toBeDefined();
            });

            // moveError surfaced from the server envelope (not swallowed).
            await waitFor(() => expect(result.current.state.moveError).toBe('Cannot move to sprint'));

            // Reconciled to server truth: backlog list + open sprints + stats reloaded.
            expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
            // Rollback proof: the optimistically-removed story is back (the reload
            // re-materialised it from the server).
            expect(result.current.state.userstories.some((u) => u.id === 20)).toBe(true);
        });

        it('on a SUCCESSFUL move: clears moveError and does NOT reload the backlog list', async () => {
            const us20 = makeUserStory({ id: 20, ref: 20, project: PID, milestone: null, sprint_order: 3 });
            userstoriesFixture = [us20];
            const { result } = await renderLoaded();
            clearApiCalls();

            await act(async () => {
                await result.current.actions.moveToSprint([us20], 10);
            });

            expect(result.current.state.moveError).toBeNull();
            expect(bulkMilestoneMock).toHaveBeenCalledWith(PID, 10, [{ us_id: 20, order: 3 }]);
            // Success path reloads sprints + stats but NOT the backlog userstories list.
            expect(requestMock).not.toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            // The story stays removed from the backlog (it now lives in the sprint).
            expect(result.current.state.userstories.some((u) => u.id === 20)).toBe(false);
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-REG-07 — finish sprint creation using the REFRESHED sprint state
     * ---------------------------------------------------------------------- */
    describe('finishSprintCreation uses refreshed sprint state (F-REG-07)', () => {
        it('reloads OPEN sprints FIRST, then moves stories into the refreshed currentSprint || sprints[0]', async () => {
            // Pre-create: the initial open sprint is id 10 (openSprintsFixture default).
            const usToMove = makeUserStory({ id: 30, ref: 30, project: PID, milestone: null, sprint_order: 1 });
            userstoriesFixture = [usToMove];
            const { result } = await renderLoaded();
            clearApiCalls();

            // Simulate the just-created sprint (id 200) entering the REFRESHED list.
            // A stale implementation would move into the pre-create sprint (10);
            // the faithful one moves into the refreshed sprints[0] = 200.
            openSprintsFixture = [makeMilestone({ id: 200, name: 'Brand New Sprint' })];

            await act(async () => {
                await result.current.actions.finishSprintCreation([usToMove]);
            });

            // Reloaded the open sprints BEFORE moving (refreshed state).
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            // Moved into the REFRESHED sprints[0] (id 200) — NOT the stale id 10.
            expect(bulkMilestoneMock).toHaveBeenCalledWith(PID, 200, [{ us_id: 30, order: 1 }]);
        });

        it('with no stories: reloads sprints + stats but moves nothing', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            openSprintsFixture = [makeMilestone({ id: 200 })];

            await act(async () => {
                await result.current.actions.finishSprintCreation();
            });

            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
            expect(bulkMilestoneMock).not.toHaveBeenCalled();
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-AAP-10 — surface load failures (error distinct from empty)
     * ---------------------------------------------------------------------- */
    describe('load-error surfacing (F-AAP-10)', () => {
        it('sets loadError (distinct from empty) when the initial load fails', async () => {
            getMock.mockImplementation((path: string) => {
                if (path === `/projects/${PID}`) {
                    return Promise.reject(new Error('boom'));
                }
                return Promise.resolve(statsFixture);
            });

            const { result } = renderHook(() => useBacklog(PID));
            await waitFor(() => expect(result.current.state.loading).toBe(false));

            // A FAILED load is now reported — NOT rendered as a successful empty
            // backlog. Both flags are observable and DISTINCT.
            expect(result.current.state.loadError).toBe(true);
            expect(result.current.state.userstories).toEqual([]);
            expect(result.current.state.project).toBeNull();
        });

        it('reload() clears loadError and succeeds on retry', async () => {
            let failProject = true;
            getMock.mockImplementation((path: string) => {
                if (path === `/projects/${PID}`) {
                    return failProject
                        ? Promise.reject(new Error('boom'))
                        : Promise.resolve(projectFixture);
                }
                if (path === `/projects/${PID}/stats`) {
                    return Promise.resolve(statsFixture);
                }
                return Promise.reject(new Error(`unexpected api.get path: ${path}`));
            });

            const { result } = renderHook(() => useBacklog(PID));
            await waitFor(() => expect(result.current.state.loading).toBe(false));
            expect(result.current.state.loadError).toBe(true);

            // Repair the backend and retry via the centralized, awaited reload.
            failProject = false;
            await act(async () => {
                await result.current.actions.reload();
            });

            expect(result.current.state.loadError).toBe(false);
            expect(result.current.state.project).not.toBeNull();
        });

        it('surfaces loadError when a live onUserstories refresh fails (not swallowed)', async () => {
            const { result } = await renderLoaded();
            // The handlers passed to subscribeProjectChanges(projectId, handlers).
            const handlers = subscribeMock.mock.calls[0][1] as {
                onUserstories: () => void;
                onMilestones: () => void;
            };
            clearApiCalls();

            // The next paginated reload (inside onUserstories) fails.
            requestMock.mockRejectedValueOnce(new Error('live refresh boom'));

            await act(async () => {
                handlers.onUserstories();
                await Promise.resolve();
            });

            await waitFor(() => expect(result.current.state.loadError).toBe(true));
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-CQ-09 — project-scoped show-tags persistence + rehydration
     * ---------------------------------------------------------------------- */
    describe('show-tags persistence + rehydration (F-CQ-09)', () => {
        const STORAGE_KEY = `taiga.react.backlog.show-tags.${PID}`;

        it('persists the resolved show-tags value per project on toggle', async () => {
            const { result } = await renderLoaded();
            expect(result.current.state.showTags).toBe(true);

            act(() => {
                result.current.actions.toggleTags();
            });
            expect(result.current.state.showTags).toBe(false);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');

            act(() => {
                result.current.actions.toggleTags(true);
            });
            expect(result.current.state.showTags).toBe(true);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
        });

        it('rehydrates a persisted (false) preference on mount', async () => {
            window.localStorage.setItem(STORAGE_KEY, 'false');
            const { result } = await renderLoaded();
            expect(result.current.state.showTags).toBe(false);
        });

        it('defaults to showing tags when nothing is persisted', async () => {
            const { result } = await renderLoaded();
            expect(result.current.state.showTags).toBe(true);
        });
    });

    /* ---------------------------------------------------------------------- *
     * F-CQ-03 — single-story CRUD: delete / status / points
     *
     * The AngularJS backlog owned these three mutations directly (delete via
     * `@repo.remove`, status/points via `@repo.save` = PATCH `/userstories/{id}`
     * with `{ field, version }`), each followed by a stats/sprints reload
     * [orig backlog/main.coffee:646,662-681,1094-1099]. Each React action is
     * optimistic-then-reconcile, mirroring `moveToSprint` (F-REG-06): a
     * successful write keeps the optimistic state and refreshes derived data; a
     * FAILED write surfaces `moveError` and reloads to server truth.
     * ---------------------------------------------------------------------- */
    describe('single-story delete / status / points (F-CQ-03)', () => {
        it('deleteUs: DELETEs /userstories/{id}, prunes optimistically, then reloads sprints + stats', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            await act(async () => {
                await result.current.actions.deleteUs(us);
            });

            // Persisted through the low-level DELETE verb.
            expect(delMock).toHaveBeenCalledWith(`/userstories/${us.id}`);
            // Optimistically pruned from the list.
            expect(result.current.state.userstories.some((u) => u.id === us.id)).toBe(false);
            // Derived data refreshed (sprints + stats), NOT a full backlog re-list.
            expect(listMilestonesMock).toHaveBeenCalledWith(PID, { closed: false });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
            expect(requestMock).not.toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            // A clean delete surfaces no error.
            expect(result.current.state.moveError).toBeNull();
        });

        it('deleteUs: on a FAILED delete surfaces moveError and reconciles to server truth', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            delMock.mockRejectedValueOnce(
                new ApiError(400, { _error_message: 'Cannot delete story' }, 'Bad Request'),
            );

            await act(async () => {
                await result.current.actions.deleteUs(us);
            });

            // The server envelope message is surfaced, not swallowed.
            await waitFor(() =>
                expect(result.current.state.moveError).toBe('Cannot delete story'),
            );
            // Reconciled: the backlog list was re-fetched from the server, which
            // re-materialised the optimistically-removed story.
            expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            expect(result.current.state.userstories.some((u) => u.id === us.id)).toBe(true);
        });

        it('updateUsStatus: PATCHes { status, version }, updates in place, then reloads stats + facets', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0]; // status 1, version 1

            await act(async () => {
                await result.current.actions.updateUsStatus(us, 2);
            });

            // Minimal PATCH body: the changed field + optimistic-concurrency version.
            expect(patchMock).toHaveBeenCalledWith(`/userstories/${us.id}`, {
                status: 2,
                version: us.version,
            });
            // Updated in place (same list position, new status).
            const updated = result.current.state.userstories.find((u) => u.id === us.id);
            expect(updated?.status).toBe(2);
            // Stats + filter facets refreshed (status affects both).
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
            expect(filtersDataMock).toHaveBeenCalled();
            expect(result.current.state.moveError).toBeNull();
        });

        it('updateUsStatus: is a no-op when the status is unchanged', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0]; // status 1

            await act(async () => {
                await result.current.actions.updateUsStatus(us, us.status);
            });

            expect(patchMock).not.toHaveBeenCalled();
        });

        it('updateUsStatus: on a FAILED save surfaces moveError and reconciles to server truth', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            patchMock.mockRejectedValueOnce(
                new ApiError(412, { _error_message: 'stale version' }, 'Precondition Failed'),
            );

            await act(async () => {
                await result.current.actions.updateUsStatus(us, 2);
            });

            await waitFor(() => expect(result.current.state.moveError).toBe('stale version'));
            // Reconciled: the backlog list was re-fetched, restoring the server status.
            expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything());
            const restored = result.current.state.userstories.find((u) => u.id === us.id);
            expect(restored?.status).toBe(1);
        });

        it('updateUsPoints: PATCHes merged { points, version }, updates in place, then reloads stats', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            await act(async () => {
                await result.current.actions.updateUsPoints(us, 1, 11);
            });

            // The points map is MERGED (role 1 → point 11) and sent with the version.
            expect(patchMock).toHaveBeenCalledWith(`/userstories/${us.id}`, {
                points: { '1': 11 },
                version: us.version,
            });
            const updated = result.current.state.userstories.find((u) => u.id === us.id);
            expect(updated?.points).toEqual({ '1': 11 });
            expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
            expect(result.current.state.moveError).toBeNull();
        });

        it('updateUsPoints: preserves other roles when setting one role point', async () => {
            userstoriesFixture = [
                makeUserStory({ id: 1, ref: 1, project: PID, milestone: null, points: { '2': 10 } }),
            ];
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            await act(async () => {
                await result.current.actions.updateUsPoints(us, 1, 11);
            });

            // Role 2's existing point is preserved; role 1 is added.
            expect(patchMock).toHaveBeenCalledWith(`/userstories/${us.id}`, {
                points: { '2': 10, '1': 11 },
                version: us.version,
            });
        });

        it('updateUsPoints: on a FAILED save surfaces moveError and reconciles to server truth', async () => {
            const { result } = await renderLoaded();
            clearApiCalls();
            const us = result.current.state.userstories[0];

            patchMock.mockRejectedValueOnce(
                new ApiError(400, { _error_message: 'points rejected' }, 'Bad Request'),
            );

            await act(async () => {
                await result.current.actions.updateUsPoints(us, 1, 11);
            });

            await waitFor(() => expect(result.current.state.moveError).toBe('points rejected'));
            expect(requestMock).toHaveBeenCalledWith('GET', '/userstories', expect.anything());
        });
    });
});
