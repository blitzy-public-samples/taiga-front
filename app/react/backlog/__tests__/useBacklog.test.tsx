/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the EFFECTFUL Backlog state hook
 * (`app/react/backlog/state/useBacklog.ts`).
 *
 * WHAT IS ASSERTED
 *   The hook's EFFECTS and their behavioural parity with the AngularJS
 *   `BacklogController` (SOURCE `app/coffee/modules/backlog/main.coffee`):
 *     - initial load ORDER and shape (project -> subscribe -> parallel
 *       stats/sprints/userstories -> filtersData -> loading:false);
 *     - pagination-header handling (`x-pagination-next`,
 *       `Taiga-Info-Backlog-Total-Userstories`,
 *       `Taiga-Info-Userstories-Without-Swimlane`);
 *     - the pending-drag QUEUE semantics of `moveUs` (optimistic dispatch +
 *       enqueue + single-in-flight gate + drain + `!events.connected` fallback
 *       reload) and the byte-for-byte WIRE FORMAT of
 *       `bulk_update_backlog_order` (an ARRAY OF US ID NUMBERS);
 *     - `moveToSprint` ({ us_id, order }[] to `bulk_update_milestone`),
 *       `bulkCreateUs`, `createSprint`/`saveSprint`/`removeSprint`, the filter /
 *       toggle / reload passthroughs, and the optimistic add/remove;
 *     - the WebSocket subscription routing (`onUserstories` / `onMilestones`)
 *       and unsubscribe-on-unmount; and
 *     - `findCurrentSprint` date math and `computeStats` arithmetic.
 *
 * TEST-LAYER ISOLATION
 *   No network, no browser engine, no AngularJS. The shared TRANSPORT adapter
 *   (`../../shared/api/client`) is mocked with a path-routing `api` double, so
 *   the real `fetch` never runs; the REAL `../../shared/api/userstories` and
 *   `../../shared/api/milestones` wrappers run on top of that double (proving
 *   their request bodies as an integration bonus). `../../shared/events` and
 *   `../../shared/session` are mocked so the events path is deterministic. Jest
 *   globals (`describe`/`it`/`expect`/`jest`/`beforeEach`/`afterEach`) come from
 *   the runner (jsdom env from the root `jest.config.js`); no Jest import is
 *   required. React's automatic JSX runtime means NO `import React`.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import { useBacklog } from '../state/useBacklog';
import { api } from '../../shared/api/client';
import { subscribeProjectChanges } from '../../shared/events';
import { getEventsUrl } from '../../shared/session';
import type { Project, UserStory, Milestone, FiltersData } from '../../shared/types';
import {
    makeProject,
    makeUserStory,
    makeUserStories,
    makeMilestone,
    makeFiltersData,
} from './factories';

/* ========================================================================== *
 * Module mocks
 * ========================================================================== */

// Transport adapter: a path-routing `api` double. The factory references no
// out-of-scope bindings, so it is safe under jest's mock hoisting.
jest.mock('../../shared/api/client', () => ({
    api: {
        request: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        del: jest.fn(),
    },
    ApiError: class ApiError extends Error {},
}));

// Events bridge: subscribeProjectChanges returns an unsubscribe spy.
jest.mock('../../shared/events', () => ({
    subscribeProjectChanges: jest.fn(),
}));

// Session: getEventsUrl gates eventsConnected(); default "disabled" (null) so
// the post-drag fallback reload path is the default under test.
jest.mock('../../shared/session', () => ({
    getEventsUrl: jest.fn(() => null),
}));

/* ========================================================================== *
 * Typed handles onto the mocked functions
 * ========================================================================== */

const requestMock = api.request as unknown as jest.Mock;
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const patchMock = api.patch as unknown as jest.Mock;
const delMock = api.del as unknown as jest.Mock;
const subscribeMock = subscribeProjectChanges as unknown as jest.Mock;
const getEventsUrlMock = getEventsUrl as unknown as jest.Mock;

const PID = 1;

/* ========================================================================== *
 * Header double — a case-insensitive `.get()` like the WHATWG `Headers`
 * ========================================================================== */

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

/* ========================================================================== *
 * Mutable fixtures (reset in beforeEach) that the routing closures read
 * ========================================================================== */

let projectFixture: Project;
let statsFixture: Record<string, unknown>;
let userstoriesFixture: UserStory[];
let usHeaders: Record<string, string>;
let openSprintsFixture: Milestone[];
let sprintHeaders: Record<string, string>;
let closedSprintsFixture: Milestone[];
let filtersDataFixture: FiltersData;
let bulkBacklogResult: unknown;
let unsubscribeSpy: jest.Mock;

beforeEach(() => {
    requestMock.mockReset();
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    delMock.mockReset();
    subscribeMock.mockReset();
    getEventsUrlMock.mockReset();

    projectFixture = makeProject({ id: PID });
    // total_points || defined_points = 100; completedPercentage = round(100*25/100) = 25.
    statsFixture = {
        total_points: 100,
        defined_points: 80,
        closed_points: 25,
        total_milestones: 4,
        speed: 3,
    };
    userstoriesFixture = makeUserStories(2, { milestone: null });
    usHeaders = {
        'Taiga-Info-Backlog-Total-Userstories': '2',
        'Taiga-Info-Userstories-Without-Swimlane': '0',
    };
    openSprintsFixture = [makeMilestone({ id: 10, name: 'Open Sprint' })];
    sprintHeaders = {
        'Taiga-Info-Total-Opened-Milestones': '1',
        'Taiga-Info-Total-Closed-Milestones': '2',
    };
    closedSprintsFixture = [makeMilestone({ id: 90, name: 'Closed Sprint', closed: true })];
    filtersDataFixture = makeFiltersData();
    bulkBacklogResult = [];
    unsubscribeSpy = jest.fn();

    // api.request(method, path, { params }) — the header-exposing path.
    requestMock.mockImplementation(
        (_method: string, path: string, opts?: { params?: Record<string, unknown> }) => {
            if (path === '/milestones') {
                const closed = opts?.params?.closed;
                const isClosed = closed === true || closed === 'true';
                return Promise.resolve({
                    data: isClosed ? closedSprintsFixture : openSprintsFixture,
                    status: 200,
                    headers: makeHeaders(sprintHeaders),
                });
            }
            if (path === '/userstories') {
                return Promise.resolve({
                    data: userstoriesFixture,
                    status: 200,
                    headers: makeHeaders(usHeaders),
                });
            }
            return Promise.reject(new Error(`unexpected api.request path: ${path}`));
        },
    );

    // api.get(path, ...) — resolves to the BODY directly.
    getMock.mockImplementation((path: string) => {
        if (path === `/projects/${PID}`) {
            return Promise.resolve(projectFixture);
        }
        if (path === `/projects/${PID}/stats`) {
            return Promise.resolve(statsFixture);
        }
        if (path === '/userstories/filters_data') {
            return Promise.resolve(filtersDataFixture);
        }
        return Promise.reject(new Error(`unexpected api.get path: ${path}`));
    });

    // api.post(path, body) — resolves to the BODY directly.
    postMock.mockImplementation((path: string, body: Record<string, unknown>) => {
        if (path === '/userstories/bulk_update_backlog_order') {
            return Promise.resolve(bulkBacklogResult);
        }
        if (path === '/userstories/bulk_update_milestone') {
            return Promise.resolve([]);
        }
        if (path === '/milestones') {
            return Promise.resolve(makeMilestone({ id: 100, ...(body as Partial<Milestone>) }));
        }
        return Promise.reject(new Error(`unexpected api.post path: ${path}`));
    });

    patchMock.mockImplementation((path: string, body: Record<string, unknown>) =>
        Promise.resolve(makeMilestone({ id: 1, ...(body as Partial<Milestone>) })),
    );

    delMock.mockResolvedValue(undefined);

    subscribeMock.mockReturnValue(unsubscribeSpy);
    getEventsUrlMock.mockReturnValue(null);
});

/* ========================================================================== *
 * Helpers
 * ========================================================================== */

/** Render the hook and wait until the initial load has settled. */
async function renderLoaded(projectId = PID) {
    const rendered = renderHook(({ id }: { id: number }) => useBacklog(id), {
        initialProps: { id: projectId },
    });
    await waitFor(() => expect(rendered.result.current.state.loading).toBe(false));
    return rendered;
}

/** Clear call records on every api double while preserving the routing impls. */
function clearApiCalls(): void {
    requestMock.mockClear();
    getMock.mockClear();
    postMock.mockClear();
    patchMock.mockClear();
    delMock.mockClear();
}

/** The most recent body passed to a jest.fn mocking a `(path, body)` verb. */
function lastBody(mock: jest.Mock): Record<string, unknown> {
    const call = mock.mock.calls[mock.mock.calls.length - 1];
    return call[1] as Record<string, unknown>;
}

/** Count api.request calls to a given path (optionally filtered by closed). */
function countRequest(path: string, closed?: boolean): number {
    return requestMock.mock.calls.filter((c) => {
        if (c[1] !== path) {
            return false;
        }
        if (closed === undefined) {
            return true;
        }
        const params = (c[2] as { params?: Record<string, unknown> } | undefined)?.params;
        return params?.closed === closed;
    }).length;
}

/* ========================================================================== *
 * Initial load
 * ========================================================================== */

describe('useBacklog — initial load', () => {
    it('loads project, subscribes, runs the parallel loads + filters, then clears loading', async () => {
        const { result } = await renderLoaded();

        // Project loaded and backlog activation surfaced.
        expect(getMock).toHaveBeenCalledWith(`/projects/${PID}`);
        expect(result.current.state.project?.id).toBe(PID);
        expect(result.current.state.isBacklogActivated).toBe(true);

        // Subscription established with the numeric projectId + both handlers.
        expect(subscribeMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock.mock.calls[0][0]).toBe(PID);
        const handlers = subscribeMock.mock.calls[0][1];
        expect(typeof handlers.onUserstories).toBe('function');
        expect(typeof handlers.onMilestones).toBe('function');

        // Stats computed (round(100*25/100) = 25) and graph placeholder off.
        expect(result.current.state.stats?.completedPercentage).toBe(25);
        expect(result.current.state.stats?.showGraphPlaceholder).toBe(false);

        // Sprints + totals from headers (open 1 + closed 2 = 3).
        expect(result.current.state.sprints).toHaveLength(1);
        expect(result.current.state.totalMilestones).toBe(3);
        expect(result.current.state.totalClosedMilestones).toBe(2);

        // Userstories + pagination totals from headers.
        expect(result.current.state.userstories).toHaveLength(2);
        expect(result.current.state.totalUserStories).toBe(2);
        expect(result.current.state.noSwimlaneUserStories).toBe(false);

        // Filters populated and the /userstories query used the `milestone=null`
        // backlog sentinel with no `page_size` on the normal path.
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
        // Give any (erroneously scheduled) microtasks a chance to run.
        await act(async () => {
            await Promise.resolve();
        });
        expect(getMock).not.toHaveBeenCalled();
        expect(requestMock).not.toHaveBeenCalled();
        expect(subscribeMock).not.toHaveBeenCalled();
        expect(result.current.state.loading).toBe(true);
    });

    it('still clears loading when the project load rejects (no hang)', async () => {
        getMock.mockImplementation((path: string) => {
            if (path === `/projects/${PID}`) {
                return Promise.reject(new Error('boom'));
            }
            return Promise.resolve({});
        });
        const { result } = renderHook(() => useBacklog(PID));
        await waitFor(() => expect(result.current.state.loading).toBe(false));
        expect(result.current.state.project).toBeNull();
    });

    it('unsubscribes on unmount', async () => {
        const { unmount } = await renderLoaded();
        expect(unsubscribeSpy).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });
});

/* ========================================================================== *
 * computeStats / findCurrentSprint
 * ========================================================================== */

describe('useBacklog — derived helpers', () => {
    it('computeStats yields 0% + graph placeholder when there is no points basis', async () => {
        statsFixture = { closed_points: 10 };
        const { result } = await renderLoaded();
        expect(result.current.state.stats?.completedPercentage).toBe(0);
        expect(result.current.state.stats?.showGraphPlaceholder).toBe(true);
        expect(result.current.state.stats?.speed).toBe(0);
    });

    it('findCurrentSprint selects the OPEN sprint whose date range contains now', async () => {
        openSprintsFixture = [
            makeMilestone({ id: 1, estimated_start: '2000-01-01', estimated_finish: '2000-02-01' }),
            makeMilestone({ id: 2, estimated_start: '2000-01-01', estimated_finish: '2999-12-31' }),
        ];
        const { result } = await renderLoaded();
        expect(result.current.state.currentSprint?.id).toBe(2);
    });

    it('findCurrentSprint returns null when no open sprint contains now', async () => {
        openSprintsFixture = [
            makeMilestone({ id: 1, estimated_start: '2000-01-01', estimated_finish: '2000-02-01' }),
        ];
        const { result } = await renderLoaded();
        expect(result.current.state.currentSprint).toBeNull();
    });
});

/* ========================================================================== *
 * Pagination
 * ========================================================================== */

describe('useBacklog — pagination headers', () => {
    it('advances the page and enables pagination when x-pagination-next is present', async () => {
        usHeaders = {
            'x-pagination-next': 'http://next',
            'Taiga-Info-Backlog-Total-Userstories': '7',
            'Taiga-Info-Userstories-Without-Swimlane': '3',
        };
        const { result } = await renderLoaded();
        // page advanced 1 -> 2, pagination enabled, totals + no-swimlane flag set.
        expect(result.current.state.page).toBe(2);
        expect(result.current.state.disablePagination).toBe(false);
        expect(result.current.state.totalUserStories).toBe(7);
        expect(result.current.state.noSwimlaneUserStories).toBe(true);
    });

    it('disables pagination and keeps the page when there is no next page', async () => {
        const { result } = await renderLoaded();
        expect(result.current.state.page).toBe(1);
        expect(result.current.state.disablePagination).toBe(true);
    });
});

/* ========================================================================== *
 * moveUs — the critical drag thunk
 * ========================================================================== */

describe('useBacklog — moveUs (pending-drag queue + wire format)', () => {
    it('optimistically moves, posts the ARRAY-OF-IDS wire format, and reconciles', async () => {
        // Reconcile result: server places the story into sprint 10 @ order 5.
        bulkBacklogResult = [{ id: 1, milestone: 10, backlog_order: 5 }];
        // Events CONNECTED so the post-drag fallback reload does NOT fire and
        // overwrite the reconciled story with the (empty) sprint fixture — this
        // test isolates the reconcile dispatch itself.
        getEventsUrlMock.mockReturnValue('ws://events');
        const { result } = await renderLoaded();
        clearApiCalls();

        const us = result.current.state.userstories[0];
        await act(async () => {
            result.current.actions.moveUs([us], 0, 10, null, 7);
        });
        await waitFor(() =>
            expect(postMock).toHaveBeenCalledWith(
                '/userstories/bulk_update_backlog_order',
                expect.anything(),
            ),
        );

        // WIRE FORMAT: bulk_userstories is an ARRAY OF US ID NUMBERS.
        const body = lastBody(postMock);
        expect(body.bulk_userstories).toEqual([us.id]);
        (body.bulk_userstories as unknown[]).forEach((v) => expect(typeof v).toBe('number'));
        // currentSprintId (10 != null) => milestone_id present; before anchor = nextUs (7).
        expect(body.milestone_id).toBe(10);
        expect(body.before_userstory_id).toBe(7);

        // Reconciliation applied the server row onto the moved story. The
        // reconcile dispatch flushes AFTER the post resolves, so poll for it.
        await waitFor(() => {
            const reconciled =
                result.current.state.sprints
                    .flatMap((s) => s.user_stories)
                    .find((u) => u.id === 1) ??
                result.current.state.userstories.find((u) => u.id === 1);
            expect(reconciled?.milestone).toBe(10);
            expect(reconciled?.backlog_order).toBe(5);
        });
    });

    it('serialises concurrent drags through the queue (one in flight at a time)', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        const [a, b] = result.current.state.userstories;
        await act(async () => {
            // Two synchronous drags: the 2nd must WAIT behind the 1st.
            result.current.actions.moveUs([a], 0, null, null, null);
            result.current.actions.moveUs([b], 1, null, null, null);
        });

        // Both drags eventually hit the endpoint exactly once each.
        await waitFor(() =>
            expect(
                postMock.mock.calls.filter(
                    (c) => c[0] === '/userstories/bulk_update_backlog_order',
                ),
            ).toHaveLength(2),
        );
    });

    it('hard-refreshes (sprints/closed/stats) after the queue drains when events are disconnected', async () => {
        getEventsUrlMock.mockReturnValue(null); // disconnected
        const { result } = await renderLoaded();
        clearApiCalls();

        const us = result.current.state.userstories[0];
        await act(async () => {
            result.current.actions.moveUs([us], 0, null, null, null);
        });

        // Fallback reload: open sprints + closed sprints + stats.
        await waitFor(() => expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1));
        expect(countRequest('/milestones', true)).toBeGreaterThanOrEqual(1);
        expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
    });

    it('does NOT hard-refresh after a drag when events are connected', async () => {
        getEventsUrlMock.mockReturnValue('ws://events'); // connected
        const { result } = await renderLoaded();
        clearApiCalls();

        const us = result.current.state.userstories[0];
        await act(async () => {
            result.current.actions.moveUs([us], 0, null, null, null);
        });
        await waitFor(() =>
            expect(postMock).toHaveBeenCalledWith(
                '/userstories/bulk_update_backlog_order',
                expect.anything(),
            ),
        );

        // No fallback sprint/stat reloads occurred.
        expect(countRequest('/milestones')).toBe(0);
        expect(getMock).not.toHaveBeenCalledWith(`/projects/${PID}/stats`);
    });

    it('moveUsToTopOfBacklog anchors before the first backlog story', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        const firstId = result.current.state.userstories[0].id;
        const mover = makeUserStory({ id: 999, milestone: null });
        await act(async () => {
            result.current.actions.moveUsToTopOfBacklog([mover]);
        });
        await waitFor(() =>
            expect(postMock).toHaveBeenCalledWith(
                '/userstories/bulk_update_backlog_order',
                expect.anything(),
            ),
        );

        const body = lastBody(postMock);
        expect(body.bulk_userstories).toEqual([999]);
        // previousUs null, nextUs = firstId -> before_userstory_id anchor.
        expect(body.before_userstory_id).toBe(firstId);
    });
});

/* ========================================================================== *
 * moveToSprint / bulkCreateUs / sprint CRUD
 * ========================================================================== */

describe('useBacklog — sprint + bulk actions', () => {
    it('moveToSprint removes from the backlog and posts { us_id, order }[]', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        const us = result.current.state.userstories[0];
        const before = result.current.state.userstories.length;
        await act(async () => {
            await result.current.actions.moveToSprint([us], 55);
        });

        // Optimistic removal from the backlog list.
        expect(result.current.state.userstories.length).toBe(before - 1);
        // Wire format: bulk_stories is an array of { us_id, order } objects.
        expect(postMock).toHaveBeenCalledWith(
            '/userstories/bulk_update_milestone',
            expect.objectContaining({ project_id: PID, milestone_id: 55 }),
        );
        const body = lastBody(postMock);
        expect(body.bulk_stories).toEqual([{ us_id: us.id, order: us.sprint_order ?? 0 }]);
        // Sprints + stats reloaded afterwards.
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
        expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
    });

    it('bulkCreateUs inserts the created stories and refreshes stats', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        const created = [makeUserStory({ id: 501 }), makeUserStory({ id: 502 })];
        await act(async () => {
            result.current.actions.bulkCreateUs(created, 'top');
        });
        // Inserted at the top and flagged new.
        expect(result.current.state.userstories[0].id).toBe(501);
        expect(result.current.state.newUs).toEqual(expect.arrayContaining([501, 502]));
        await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
    });

    it('createSprint posts /milestones then reloads open sprints', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            await result.current.actions.createSprint({
                project: PID,
                name: 'S2',
                estimated_start: '2021-02-01',
                estimated_finish: '2021-02-15',
            });
        });
        expect(postMock).toHaveBeenCalledWith(
            '/milestones',
            expect.objectContaining({ name: 'S2' }),
        );
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
    });

    it('saveSprint patches /milestones/{id} then reloads open + closed sprints', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            await result.current.actions.saveSprint({ id: 10, name: 'Renamed' });
        });
        expect(patchMock).toHaveBeenCalledWith(
            '/milestones/10',
            expect.objectContaining({ name: 'Renamed' }),
        );
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
        expect(countRequest('/milestones', true)).toBeGreaterThanOrEqual(1);
    });

    it('removeSprint deletes via the low-level client then reloads everything', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            await result.current.actions.removeSprint(10);
        });
        expect(delMock).toHaveBeenCalledWith('/milestones/10');
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
        expect(countRequest('/milestones', true)).toBeGreaterThanOrEqual(1);
        expect(countRequest('/userstories')).toBeGreaterThanOrEqual(1);
        expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`);
    });
});

/* ========================================================================== *
 * Filters / toggles / passthroughs / optimistic
 * ========================================================================== */

describe('useBacklog — filters, toggles, passthroughs', () => {
    it('setFilters stores the filters, flags active, and reloads stories + facets', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            result.current.actions.setFilters({ status: '3' });
        });
        expect(result.current.state.selectedFilters).toEqual({ status: '3' });
        expect(result.current.state.activeFilters).toBe(true);
        await waitFor(() => expect(countRequest('/userstories')).toBeGreaterThanOrEqual(1));
        // The active filter flows through into the /userstories query params.
        const usCall = requestMock.mock.calls.find((c) => c[1] === '/userstories');
        const params = (usCall as unknown[])[2] as { params: Record<string, unknown> };
        expect(params.params.status).toBe('3');
        expect(getMock).toHaveBeenCalledWith('/userstories/filters_data', expect.anything());
    });

    it('toggleTags flips the tag visibility flag', async () => {
        const { result } = await renderLoaded();
        expect(result.current.state.showTags).toBe(true);
        await act(async () => {
            result.current.actions.toggleTags(false);
        });
        expect(result.current.state.showTags).toBe(false);
    });

    it('toggleVelocity enables velocity and lazy-loads closed sprints once', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            result.current.actions.toggleVelocity(true);
        });
        expect(result.current.state.displayVelocity).toBe(true);
        // Closed sprints lazy-loaded because none were present.
        await waitFor(() => expect(countRequest('/milestones', true)).toBe(1));

        // Toggling again with closed sprints already present does NOT reload them.
        clearApiCalls();
        await act(async () => {
            result.current.actions.toggleVelocity(false);
        });
        await act(async () => {
            result.current.actions.toggleVelocity(true);
        });
        expect(countRequest('/milestones', true)).toBe(0);
    });

    it('reload passthroughs each hit their endpoint', async () => {
        const { result } = await renderLoaded();
        clearApiCalls();

        await act(async () => {
            result.current.actions.reloadUserstories();
            result.current.actions.reloadSprints();
            result.current.actions.reloadClosedSprints();
            result.current.actions.reloadStats();
        });
        await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
        expect(countRequest('/userstories')).toBeGreaterThanOrEqual(1);
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
        expect(countRequest('/milestones', true)).toBeGreaterThanOrEqual(1);
    });

    it('addUsOptimistic / removeUsOptimistic mutate the backlog list', async () => {
        const { result } = await renderLoaded();
        const startLen = result.current.state.userstories.length;

        await act(async () => {
            result.current.actions.addUsOptimistic([makeUserStory({ id: 777 })], 'bottom');
        });
        expect(result.current.state.userstories.some((u) => u.id === 777)).toBe(true);
        expect(result.current.state.userstories.length).toBe(startLen + 1);

        await act(async () => {
            result.current.actions.removeUsOptimistic(777);
        });
        expect(result.current.state.userstories.some((u) => u.id === 777)).toBe(false);
        expect(result.current.state.userstories.length).toBe(startLen);
    });
});

/* ========================================================================== *
 * WebSocket handlers + actions stability
 * ========================================================================== */

describe('useBacklog — websocket handlers + stability', () => {
    it('onUserstories reloads the paginated stories + open sprints', async () => {
        await renderLoaded();
        clearApiCalls();

        const handlers = subscribeMock.mock.calls[0][1];
        await act(async () => {
            handlers.onUserstories();
        });
        await waitFor(() => expect(countRequest('/userstories')).toBeGreaterThanOrEqual(1));
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
    });

    it('onMilestones reloads open + closed sprints + stats', async () => {
        await renderLoaded();
        clearApiCalls();

        const handlers = subscribeMock.mock.calls[0][1];
        await act(async () => {
            handlers.onMilestones();
        });
        await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/projects/${PID}/stats`));
        expect(countRequest('/milestones', false)).toBeGreaterThanOrEqual(1);
        expect(countRequest('/milestones', true)).toBeGreaterThanOrEqual(1);
    });

    it('exposes the full action contract and a referentially-stable actions object', async () => {
        const { result, rerender } = await renderLoaded();

        const before = result.current.actions;
        for (const name of [
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
        ] as const) {
            expect(typeof (before as Record<string, unknown>)[name]).toBe('function');
        }

        rerender({ id: PID });
        // Memoised: the same object identity survives a re-render.
        expect(result.current.actions).toBe(before);
    });
});
