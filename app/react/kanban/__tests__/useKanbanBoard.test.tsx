/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the EFFECTFUL Kanban board hook
 * (`app/react/kanban/state/useKanbanBoard.ts`).
 *
 * WHAT IS ASSERTED
 *   The hook's data-load / subscription pipeline and its behavioural parity with
 *   the AngularJS `KanbanController` (SOURCE `app/coffee/modules/kanban/main.coffee`,
 *   READ-ONLY, never imported):
 *     - the initial-load sequence (project -> parallel userstories + swimlanes ->
 *       filters -> `initialLoad`) populates the board state and subscribes to the
 *       live WebSocket change stream exactly once;
 *     - `move` maps the synthetic unclassified swimlane `-1` to the API `null`
 *       BOTH before the optimistic reducer dispatch AND before the persistence
 *       call, and wires `bulkUserstories` to `bulkUpdateKanbanOrder` as a PLAIN
 *       `number[]` (the byte-for-byte kanban wire contract, NOT `{us_id, order}`
 *       objects) — the security/contract-critical guarantees;
 *     - `toggleFold` flips a card's fold flag (observable via `usMap`);
 *     - a project with `is_kanban_activated === false` degrades gracefully to an
 *       empty board without throwing, and an active filter that yields zero
 *       stories sets `notFoundUserstories`;
 *     - the WebSocket subscription is torn down (unsubscribe) on unmount so no
 *       socket leaks when AngularJS destroys the hosting view; and
 *     - the public actions (`reload`, `showArchivedStatus`, `hideArchivedStatus`)
 *       and the live-update handlers (`onUserstories` / `onProjects`) behave as
 *       the controller did.
 *
 * TEST-LAYER ISOLATION (hard requirement)
 *   No network, no browser engine, no AngularJS. All three shared backend
 *   modules the hook depends on are MOCKED: the transport adapter
 *   (`../../shared/api/client`), the user-story bulk wrappers
 *   (`../../shared/api/userstories`) and the events bridge
 *   (`../../shared/events`). The real `../../shared/permissions` runs (it has
 *   type-only imports, so it contributes zero runtime dependencies) which is
 *   what enforces the `modify_us` drag gate the `move` suite opts into. Jest
 *   globals (`describe`/`it`/`expect`/`jest`/`beforeEach`) come from the runner
 *   (jsdom env from the root `jest.config.js`); no Jest import is required, and
 *   `@testing-library/jest-dom` is registered globally via `setupFilesAfterEnv`
 *   so it is not imported here. React's automatic JSX runtime means NO
 *   `import React` even though this file is `.tsx` (RTL's `renderHook` may wrap
 *   the hook in a JSX host).
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import { useKanbanBoard } from '../state/useKanbanBoard';
import { api, ApiError } from '../../shared/api/client';
import { bulkUpdateKanbanOrder, filtersData } from '../../shared/api/userstories';
import { subscribeProjectChanges } from '../../shared/events';
import {
    makeProject,
    makeStatus,
    makeSwimlane,
    makeAssignedUser,
    makeUserStory,
} from './factories';
import type { Project, UserStory, Swimlane } from '../../shared/types';

/* ========================================================================== *
 * Module mocks (hoisted above the imports by ts-jest's jest-hoist transform).
 *
 * Each factory references ONLY `jest.fn()` (no out-of-scope binding), so it is
 * safe under jest's mock hoisting. The hook reads `api.get` (project /
 * userstories / swimlanes), `bulkUpdateKanbanOrder` + `filtersData`, and
 * `subscribeProjectChanges`; every one of them is a spy here so the real
 * `fetch` / WebSocket are never touched.
 * ========================================================================== */

jest.mock('../../shared/api/client', () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        del: jest.fn(),
    },
    // Preserve the REAL ApiError class so `describeReorderError` /
    // `parseApiErrorMessage` (shared/apiError.ts) can still do
    // `err instanceof ApiError` and parse the server error envelope
    // (F-AAP-03, dest#8). Only the `api` singleton needs stubbing.
    ApiError: jest.requireActual('../../shared/api/client').ApiError,
}));

jest.mock('../../shared/api/userstories', () => ({
    bulkUpdateKanbanOrder: jest.fn(),
    filtersData: jest.fn(),
}));

jest.mock('../../shared/events', () => ({
    subscribeProjectChanges: jest.fn(),
}));

/* ========================================================================== *
 * Typed handles onto the mocked functions
 * ========================================================================== */

const getMock = api.get as unknown as jest.Mock;
const delMock = api.del as unknown as jest.Mock;
const bulkUpdateKanbanOrderMock = bulkUpdateKanbanOrder as unknown as jest.Mock;
const filtersDataMock = filtersData as unknown as jest.Mock;
const subscribeMock = subscribeProjectChanges as unknown as jest.Mock;

/** The project id used by every suite; the literal API path is `/projects/7`. */
const PID = 7;
/** The single user-story status/column id used across the suites. */
const STATUS_ID = 100;

/**
 * QA M-10: every `/userstories` BOARD list (initial load, live reload, filter
 * reload, and archived-column reopen) must disable pagination so the WHOLE
 * board loads — parity with the AngularJS `queryMany` default
 * (`x-disable-pagination: "1"`). The hook passes this as the third `api.get`
 * argument, so the board-list assertions match it explicitly here.
 */
const DISABLE_PAGINATION_ARG = expect.objectContaining({
    headers: expect.objectContaining({ 'x-disable-pagination': '1' }),
});

/* ========================================================================== *
 * Mutable fixtures (reset in beforeEach) that the api.get routing closure reads
 * by reference, so a test may reassign one BEFORE rendering to reshape a load.
 * ========================================================================== */

let projectFixture: Project;
let userstoriesFixture: UserStory[];
let swimlanesFixture: Swimlane[];
let unsubscribeSpy: jest.Mock;

/**
 * Arm `api.get` with a path-routing implementation. The three literal paths are
 * exactly those the hook issues (`loadProject` / `loadUserstories` /
 * `loadSwimlanes`); any other path rejects loudly so a drift in the hook's URLs
 * surfaces as a test failure rather than a silent pass.
 */
function armGet(): void {
    getMock.mockImplementation((path: string) => {
        if (path === `/projects/${PID}`) {
            return Promise.resolve(projectFixture);
        }
        if (path === '/swimlanes') {
            return Promise.resolve(swimlanesFixture);
        }
        if (path === '/userstories') {
            return Promise.resolve(userstoriesFixture);
        }
        return Promise.reject(new Error(`unexpected api.get path: ${path}`));
    });
}

beforeEach(() => {
    // Clear call history, then re-arm the default resolved values so every test
    // is independent (SOURCE-agnostic hygiene mandated by the file spec).
    jest.clearAllMocks();

    projectFixture = makeProject({
        id: PID,
        is_kanban_activated: true,
        us_statuses: [makeStatus({ id: STATUS_ID })],
    });
    userstoriesFixture = [makeUserStory({ id: 1, status: STATUS_ID, kanban_order: 1 })];
    swimlanesFixture = [];
    unsubscribeSpy = jest.fn();

    armGet();
    bulkUpdateKanbanOrderMock.mockResolvedValue(undefined);
    delMock.mockResolvedValue(undefined);
    filtersDataMock.mockResolvedValue({});
    subscribeMock.mockReturnValue(unsubscribeSpy);
});

/* ========================================================================== *
 * Helpers
 * ========================================================================== */

/** The parameter object accepted by the hook, derived from its signature. */
type BoardParams = Parameters<typeof useKanbanBoard>[0];

/**
 * Render the hook and wait until the first load has resolved
 * (`initialLoad === true`). Returns the full RTL handle (`result`, `rerender`,
 * `unmount`). Any fixture reshaping must happen BEFORE calling this.
 */
async function renderLoaded(params: BoardParams = { projectId: PID }) {
    const rendered = renderHook((p: BoardParams) => useKanbanBoard(p), {
        initialProps: params,
    });
    await waitFor(() => expect(rendered.result.current.initialLoad).toBe(true));
    return rendered;
}

/* ========================================================================== *
 * Initial load
 * ========================================================================== */

describe('initial load', () => {
    it('loads the project, stories and swimlanes, populates the board, and subscribes', async () => {
        const { result } = await renderLoaded();

        // Project detail loaded and surfaced.
        expect(result.current.project?.id).toBe(PID);

        // The board index buckets the loaded story under its status column, and
        // the derived card is present in the id -> card map.
        expect(result.current.usByStatus[String(STATUS_ID)]).toContain(1);
        expect(result.current.usMap[1]).toBeDefined();

        // The three literal endpoints the hook issues, with their exact shapes:
        // project is fetched by path only; userstories + swimlanes carry the
        // project param.
        expect(getMock).toHaveBeenCalledWith(`/projects/${PID}`);
        expect(getMock).toHaveBeenCalledWith(
            '/userstories',
            expect.objectContaining({ project: PID, status__is_archived: false }),
            DISABLE_PAGINATION_ARG,
        );
        expect(getMock).toHaveBeenCalledWith(
            '/swimlanes',
            expect.objectContaining({ project: PID }),
        );

        // The live-update subscription is established exactly once, with the
        // numeric project id and a handlers object exposing the two kanban
        // callbacks (the hook subscribes to userstories + projects only).
        expect(subscribeMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock.mock.calls[0][0]).toBe(PID);
        const handlers = subscribeMock.mock.calls[0][1];
        expect(typeof handlers.onUserstories).toBe('function');
        expect(typeof handlers.onProjects).toBe('function');
    });

    it('clears loading once the initial load settles', async () => {
        const { result } = await renderLoaded();
        expect(result.current.loading).toBe(false);
        expect(result.current.initialLoad).toBe(true);
    });
});

/* ========================================================================== *
 * move — the security/contract-critical drag persistence
 * ========================================================================== */

describe('move — swimlane -1 -> null mapping + number[] wire', () => {
    it('maps the unclassified swimlane -1 to null and posts a plain number[]', async () => {
        // Opt into the drag gate: the real `permissions.isBoardDraggable`
        // requires the `modify_us` permission AND a non-archived project. The
        // default factory omits `modify_us`, so `move` would short-circuit
        // without ever calling the API.
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'modify_us'],
        });

        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });

        expect(bulkUpdateKanbanOrderMock).toHaveBeenCalledTimes(1);

        // bulkUpdateKanbanOrder(projectId, statusId, swimlaneId, afterUserstoryId,
        //                       beforeUserstoryId, bulkUserstories)
        const callArgs = bulkUpdateKanbanOrderMock.mock.calls[0];
        expect(callArgs[0]).toBe(PID);
        expect(callArgs[1]).toBe(STATUS_ID);

        // -1 -> null mapping (index 2): the API must receive null, NEVER -1.
        expect(callArgs[2]).toBeNull();
        expect(callArgs[2]).not.toBe(-1);

        // number[] wire (index 5): a PLAIN array of numeric ids, not
        // `{us_id, order}` objects.
        const bulkArg = callArgs[5];
        expect(Array.isArray(bulkArg)).toBe(true);
        expect(bulkArg).toEqual([1]);
        (bulkArg as unknown[]).forEach((v) => expect(typeof v).toBe('number'));

        // The moved story remains on the board after the optimistic update.
        expect(result.current.usMap[1]).toBeDefined();
    });

    it('does NOT persist when the project lacks the modify_us drag permission', async () => {
        // Default factory permissions = ['view_us'] (no modify_us) -> gate closed.
        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });

        expect(bulkUpdateKanbanOrderMock).not.toHaveBeenCalled();
    });
});

/* ========================================================================== *
 * toggleFold
 * ========================================================================== */

describe('toggleFold', () => {
    it('flips the fold flag for the target story (observable via usMap)', async () => {
        const { result } = await renderLoaded();

        expect(result.current.usMap[1]).toBeDefined();
        // Initially unset/false.
        expect(result.current.usMap[1].foldStatusChanged).toBeFalsy();

        act(() => {
            result.current.toggleFold(1);
        });
        expect(result.current.usMap[1].foldStatusChanged).toBe(true);

        // Toggling again flips it back — proving it is a genuine toggle.
        act(() => {
            result.current.toggleFold(1);
        });
        expect(result.current.usMap[1].foldStatusChanged).toBe(false);
    });
});

/* ========================================================================== *
 * kanban not activated / not found
 * ========================================================================== */

describe('kanban not activated / not found', () => {
    it('degrades gracefully to an empty board when kanban is disabled', async () => {
        projectFixture = makeProject({ id: PID, is_kanban_activated: false });

        const { result } = await renderLoaded();

        // No throw; the load still resolves (initialLoad true via renderLoaded),
        // the project stays null and the board is empty.
        expect(result.current.project).toBeNull();
        expect(Object.keys(result.current.usByStatus)).toHaveLength(0);
        expect(result.current.notFoundUserstories).toBe(false);
        expect(bulkUpdateKanbanOrderMock).not.toHaveBeenCalled();
    });

    it('sets notFoundUserstories when an active filter yields zero stories', async () => {
        userstoriesFixture = [];

        const { result } = await renderLoaded({ projectId: PID, filterQ: 'zzz' });

        await waitFor(() => expect(result.current.notFoundUserstories).toBe(true));
        // The active-filter search term was forwarded on the query.
        expect(getMock).toHaveBeenCalledWith(
            '/userstories',
            expect.objectContaining({ q: 'zzz' }),
            DISABLE_PAGINATION_ARG,
        );
    });

    it('does NOT flag notFound when zero stories come back WITHOUT an active filter', async () => {
        userstoriesFixture = [];

        const { result } = await renderLoaded();

        expect(result.current.notFoundUserstories).toBe(false);
    });
});

/* ========================================================================== *
 * cleanup unsubscribes
 * ========================================================================== */

describe('cleanup unsubscribes', () => {
    it('calls the unsubscribe function exactly once on unmount', async () => {
        const { unmount } = await renderLoaded();

        expect(subscribeMock).toHaveBeenCalledTimes(1);
        expect(unsubscribeSpy).not.toHaveBeenCalled();

        unmount();

        expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });
});

/* ========================================================================== *
 * Public actions — reload / archived show+hide (coverage of the returned API)
 * ========================================================================== */

describe('reload', () => {
    it('re-fetches the board with the current filters', async () => {
        const { result } = await renderLoaded();
        getMock.mockClear();

        await act(async () => {
            result.current.reload();
        });

        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                '/userstories',
                expect.objectContaining({ project: PID }),
                DISABLE_PAGINATION_ARG,
            ),
        );
    });
});

describe('showArchivedStatus / hideArchivedStatus', () => {
    it('showArchivedStatus fetches the archived column stories with attachments/tasks', async () => {
        const { result } = await renderLoaded();
        getMock.mockClear();

        await act(async () => {
            await result.current.showArchivedStatus(STATUS_ID);
        });

        expect(getMock).toHaveBeenCalledWith(
            '/userstories',
            expect.objectContaining({
                project: PID,
                status: STATUS_ID,
                include_attachments: true,
                include_tasks: true,
            }),
            DISABLE_PAGINATION_ARG,
        );
    });

    it('hideArchivedStatus is a stable action that does not throw', async () => {
        const { result } = await renderLoaded();

        expect(() => {
            act(() => {
                result.current.hideArchivedStatus(STATUS_ID);
            });
        }).not.toThrow();
    });
});

/* ========================================================================== *
 * Live-update handlers (onUserstories / onProjects) delivered to the bridge
 * ========================================================================== */

describe('websocket handlers', () => {
    it('onUserstories re-lists the board user stories', async () => {
        await renderLoaded();
        const handlers = subscribeMock.mock.calls[0][1];
        getMock.mockClear();

        await act(async () => {
            handlers.onUserstories();
            await Promise.resolve();
        });

        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                '/userstories',
                expect.objectContaining({ project: PID }),
                DISABLE_PAGINATION_ARG,
            ),
        );
    });

    it('onProjects ignores non-structural frames without touching the board', async () => {
        const { result } = await renderLoaded();
        const handlers = subscribeMock.mock.calls[0][1];
        getMock.mockClear();

        await act(async () => {
            handlers.onProjects({ matches: 'projects.name' });
            await Promise.resolve();
        });

        expect(getMock).not.toHaveBeenCalled();
        expect(result.current.project?.id).toBe(PID);
    });

    it('onProjects reloads the project + board on a structural swimlane change', async () => {
        await renderLoaded();
        const handlers = subscribeMock.mock.calls[0][1];
        getMock.mockClear();

        await act(async () => {
            handlers.onProjects({ matches: 'projects.swimlane' });
            await Promise.resolve();
        });

        await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}`));
    });

    it('onProjects structural change is a no-op once the project is no longer kanban-activated', async () => {
        await renderLoaded();
        const handlers = subscribeMock.mock.calls[0][1];

        // Kanban was disabled server-side; the reload's loadProject now returns
        // null, so the board reload is skipped (no /userstories re-fetch).
        projectFixture = makeProject({ id: PID, is_kanban_activated: false });
        getMock.mockClear();

        await act(async () => {
            handlers.onProjects({ matches: 'projects.swimlane' });
            await Promise.resolve();
        });

        await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}`));
        expect(getMock).not.toHaveBeenCalledWith('/userstories', expect.anything());
    });
});

/* ========================================================================== *
 * Filter / zoom reload effect
 * ========================================================================== */

describe('filter / zoom reload', () => {
    it('re-fetches when the filter query changes after the initial load', async () => {
        const { rerender } = await renderLoaded({ projectId: PID });
        getMock.mockClear();

        await act(async () => {
            rerender({ projectId: PID, filterQ: 'abc' });
            await Promise.resolve();
        });

        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                '/userstories',
                expect.objectContaining({ q: 'abc' }),
                DISABLE_PAGINATION_ARG,
            ),
        );
    });
});


/* ========================================================================== *
 * Load variants — zoom params, member resolution, swimlane indexing
 * ========================================================================== */

describe('load variants', () => {
    it('requests attachments + tasks on the userstories query at zoom level >= 2', async () => {
        await renderLoaded({ projectId: PID, zoomLevel: 2 });

        expect(getMock).toHaveBeenCalledWith(
            '/userstories',
            expect.objectContaining({
                project: PID,
                include_attachments: 1,
                include_tasks: 1,
            }),
            DISABLE_PAGINATION_ARG,
        );
    });

    it('resolves assigned members onto the derived board card', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            members: [makeAssignedUser({ id: 5, full_name_display: 'Assignee Five' })],
        });
        userstoriesFixture = [
            makeUserStory({ id: 1, status: STATUS_ID, assigned_to: 5, assigned_users: [5] }),
        ];

        const { result } = await renderLoaded();

        // loadProject built usersById from members; retrieveUserStoryData resolved
        // the ids into member objects on the card.
        expect(result.current.usMap[1].assigned_to?.id).toBe(5);
        expect(result.current.usMap[1].assigned_users.map((u) => u.id)).toContain(5);
    });

    it('indexes each swimlane\u2019s statuses and maps the unclassified lane to project statuses', async () => {
        swimlanesFixture = [
            makeSwimlane({ id: 10, statuses: [makeStatus({ id: STATUS_ID })] }),
        ];

        const { result } = await renderLoaded();

        // A concrete swimlane id is indexed, and the synthetic unclassified lane
        // ("-1") maps to the project's us_statuses.
        expect(result.current.swimlanesStatuses['10']).toBeDefined();
        expect(result.current.swimlanesStatuses['-1']).toBeDefined();
    });
});

/* ========================================================================== *
 * move — server reconciliation on persistence failure
 * ========================================================================== */

describe('move — reconcile on persistence failure', () => {
    it('re-fetches the board when bulkUpdateKanbanOrder rejects', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'modify_us'],
        });
        bulkUpdateKanbanOrderMock.mockRejectedValueOnce(new Error('server rejected the move'));

        const { result } = await renderLoaded();
        getMock.mockClear();

        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });

        // The optimistic move is reconciled with the server by reloading the
        // board (SOURCE moveUs failure path) — proving the failure never throws
        // out of move() and leaves the UI consistent.
        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                '/userstories',
                expect.objectContaining({ project: PID }),
                DISABLE_PAGINATION_ARG,
            ),
        );
        expect(result.current.usMap[1]).toBeDefined();
        // F-AAP-03 (dest#8): the failure is no longer silent — a user-facing
        // moveError is surfaced (the plain Error.message here).
        await waitFor(() =>
            expect(result.current.moveError).toBe('server rejected the move'),
        );
    });

    it('reverts the board IN-PLACE to the pre-move arrangement when BOTH the persist call AND the server re-fetch fail (offline) — Issue 3', async () => {
        const STATUS_A = 100;
        const STATUS_B = 200;
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_A }), makeStatus({ id: STATUS_B })],
            my_permissions: ['view_us', 'modify_us'],
        });
        // A single story that starts in column A.
        userstoriesFixture = [makeUserStory({ id: 1, status: STATUS_A, kanban_order: 1 })];

        const { result } = await renderLoaded();

        // Sanity: the story starts in column A, not column B.
        expect(result.current.usByStatus[String(STATUS_A)]).toContain(1);
        expect(result.current.usByStatus[String(STATUS_B)] ?? []).not.toContain(1);

        // Simulate the client going OFFLINE: the persist call rejects AND every
        // subsequent server re-fetch of the board also rejects — so the failure
        // path CANNOT lean on the server to undo the optimistic move. The only
        // thing that can restore the board is the local in-place snapshot revert.
        bulkUpdateKanbanOrderMock.mockRejectedValueOnce(new Error('offline'));
        getMock.mockImplementation((path: string) => {
            if (path === `/projects/${PID}`) {
                return Promise.resolve(projectFixture);
            }
            if (path === '/swimlanes') {
                return Promise.resolve(swimlanesFixture);
            }
            if (path === '/userstories') {
                return Promise.reject(new Error('offline'));
            }
            return Promise.reject(new Error(`unexpected api.get path: ${path}`));
        });

        // Move the story from column A to column B (optimistic), then both the
        // persist and the reconciliation re-fetch fail.
        await act(async () => {
            await result.current.move([1], STATUS_B, -1, 0, null, null);
        });

        // The optimistic move is undone IN-PLACE by the captured snapshot — NOT
        // by a server re-fetch (which failed). The story is back in column A and
        // absent from column B, proving the revert does not depend on the server.
        await waitFor(() =>
            expect(result.current.usByStatus[String(STATUS_A)]).toContain(1),
        );
        expect(result.current.usByStatus[String(STATUS_B)] ?? []).not.toContain(1);
        // The card itself is preserved (not lost by the revert).
        expect(result.current.usMap[1]).toBeDefined();
        // The failure is still surfaced to the user (toast), exactly as before.
        await waitFor(() => expect(result.current.moveError).toBe('offline'));
    });

    it('surfaces the server envelope message and clears moveError on the next successful move (F-AAP-03, dest#8)', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'modify_us'],
        });
        // First move rejects with a Django REST error envelope; the shared
        // `describeReorderError` must surface `_error_message` verbatim.
        bulkUpdateKanbanOrderMock.mockRejectedValueOnce(
            new ApiError(400, { _error_message: 'Story is blocked' }),
        );

        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });
        await waitFor(() => expect(result.current.moveError).toBe('Story is blocked'));

        // The next move succeeds (default mock resolves) and must clear the error.
        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });
        await waitFor(() => expect(result.current.moveError).toBeNull());
    });

    it('clearMoveError() dismisses a surfaced error (F-AAP-03, dest#8)', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'modify_us'],
        });
        bulkUpdateKanbanOrderMock.mockRejectedValueOnce(new Error('nope'));

        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.move([1], STATUS_ID, -1, 0, null, null);
        });
        await waitFor(() => expect(result.current.moveError).toBe('nope'));

        act(() => {
            result.current.clearMoveError();
        });
        expect(result.current.moveError).toBeNull();
    });
});

/* ========================================================================== *
 * showArchivedStatus — active-filter search term is forwarded
 * ========================================================================== */

describe('showArchivedStatus with an active filter', () => {
    it('forwards the search term on the archived-column fetch', async () => {
        const { result } = await renderLoaded({ projectId: PID, filterQ: 'needle' });
        getMock.mockClear();

        await act(async () => {
            await result.current.showArchivedStatus(STATUS_ID);
        });

        expect(getMock).toHaveBeenCalledWith(
            '/userstories',
            expect.objectContaining({
                project: PID,
                status: STATUS_ID,
                include_attachments: true,
                include_tasks: true,
                q: 'needle',
            }),
            DISABLE_PAGINATION_ARG,
        );
    });
});

/* ========================================================================== *
 * deleteUserStory — F-CQ-02 (SOURCE `deleteUserStory` 289-304)
 *
 * The ONE Kanban CRUD control the legacy `KanbanController` OWNED directly:
 * `@repo.remove(model)` (a `/api/v1/` DELETE) followed by the `kanban:us:deleted`
 * board prune. The confirm dialog lives in the CONTAINER; the hook action owns
 * the archive-aware gate, the `api.del` persistence, the optimistic `REMOVE`,
 * and the reload-on-error reconciliation.
 * ========================================================================== */

describe('deleteUserStory', () => {
    it('persists via DELETE /userstories/{id} and optimistically prunes the board when GRANTED', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'delete_us'],
        });

        const { result } = await renderLoaded();
        // Precondition: story 1 is on the board.
        expect(result.current.usMap[1]).toBeDefined();

        await act(async () => {
            await result.current.deleteUserStory(1);
        });

        // The same `/api/v1/` DELETE the AngularJS `@repo.remove(model)` issued.
        expect(delMock).toHaveBeenCalledTimes(1);
        expect(delMock).toHaveBeenCalledWith('/userstories/1');

        // Optimistic `REMOVE` prunes the story from the board index.
        expect(result.current.usMap[1]).toBeUndefined();
    });

    it('does NOT delete when the project lacks the delete_us permission', async () => {
        // Default factory permissions = ['view_us'] (no delete_us) -> gate closed.
        const { result } = await renderLoaded();

        await act(async () => {
            await result.current.deleteUserStory(1);
        });

        expect(delMock).not.toHaveBeenCalled();
        // The story remains on the board — the gate short-circuited before any
        // optimistic prune.
        expect(result.current.usMap[1]).toBeDefined();
    });

    it('is a no-op for an unknown story id (nothing to remove)', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'delete_us'],
        });

        const { result } = await renderLoaded();

        await act(async () => {
            // id 999 is not on the board -> the missing-card guard returns early.
            await result.current.deleteUserStory(999);
        });

        expect(delMock).not.toHaveBeenCalled();
        // The real story is untouched.
        expect(result.current.usMap[1]).toBeDefined();
    });

    it('reconciles with the server (re-fetch) when the DELETE rejects', async () => {
        projectFixture = makeProject({
            id: PID,
            is_kanban_activated: true,
            us_statuses: [makeStatus({ id: STATUS_ID })],
            my_permissions: ['view_us', 'delete_us'],
        });
        delMock.mockRejectedValueOnce(new Error('server rejected the delete'));

        const { result } = await renderLoaded();
        getMock.mockClear();

        await act(async () => {
            await result.current.deleteUserStory(1);
        });

        // The optimistic prune is reconciled with the server by reloading the
        // board — proving the failure never throws out of deleteUserStory and
        // leaves the UI consistent (mirrors the move() failure path).
        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                '/userstories',
                expect.objectContaining({ project: PID }),
                DISABLE_PAGINATION_ARG,
            ),
        );
    });
});

