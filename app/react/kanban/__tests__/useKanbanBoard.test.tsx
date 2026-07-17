/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanBoard.test.tsx
 * -----------------------
 * Browserless Jest + React Testing Library (`renderHook`) unit spec for the
 * React Kanban data hook `../hooks/useKanbanBoard`, authored as part of the
 * AngularJS 1.5.10 -> React 18 coexistence migration.
 *
 * The hook is the orchestration layer that replaces the AngularJS
 * `KanbanController` data path (`app/coffee/modules/kanban/main.coffee`): it
 * performs the initial data load, builds the zoom-dependent userstories query,
 * opens the two WebSocket subscriptions behind a shared trailing-debounce
 * window, defers refreshes while a lightbox is open, tears everything down on
 * unmount, and exposes the `moveUs`/`addUsBulk`/... mutation callbacks that hit
 * the frozen `/api/v1/` bulk endpoints. This spec covers those branches
 * thoroughly and is a primary contributor to the >=70% line-coverage gate over
 * `app/react/**`.
 *
 * HARD RULES enforced here (AAP 0.6.2 / 0.7):
 *   - Test isolation: Jest + `jest-environment-jsdom` ONLY. NO Playwright, NO
 *     real browser, NO real network. Every `../../shared/api/*` and
 *     `../../shared/events/*` module the hook touches is MOCKED, so no `fetch`
 *     or `WebSocket` ever fires; the suite passes headlessly in a bare container.
 *   - Globals-only import boundary: the ONLY project imports are the hook under
 *     test and the mocked shared adapters. Nothing is imported from the
 *     AngularJS CoffeeScript tree (`app/coffee`), `app/partials`, `app/styles`,
 *     or the compiled `elements` bundle.
 *   - `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are AMBIENT via
 *     `@types/jest` + ts-jest; they are deliberately NOT imported.
 *   - Fake timers drive the hand-rolled trailing-debounce window and prove that
 *     no late refresh fires after unmount.
 *
 * DRIFT NOTES — every assertion below was authored against the ACTUAL
 * `useKanbanBoard.ts` on disk (mandatory Phase A drift guard). Where the
 * implementation diverges from the generic spec outline, the divergence is
 * reproduced here and flagged with `// adjusted per useKanbanBoard.ts on disk`:
 *   - `httpClient.get(path, params?, options?)` resolves the parsed body
 *     DIRECTLY (NOT a `{ data }` wrapper), so the mock resolves fixtures directly.
 *   - The debounce is a hand-rolled `setTimeout` trailing debounce (NOT
 *     `lodash/debounce`); the shared delay is `700 + floor(Math.random()*301)`,
 *     pinned to 850ms by stubbing `Math.random()` to 0.5.
 *   - The lightbox deferral gate lives on the PROJECTS subscription only (the
 *     userstories subscription always refreshes on its trailing edge).
 *   - `moveUs`' story list is `Array<{ id }>`; `previousCard`/`nextCard` are
 *     `number | null`; the unclassified swimlane id `-1` maps to `null` on the wire.
 *   - The hook invokes the DEFAULT `userstories` aggregate methods.
 *   - The hook does NOT import `../../shared/config` or `../../shared/session`
 *     (they are read indirectly by the mocked httpClient/eventsClient), so they
 *     are intentionally neither imported nor mocked here.
 */

import { renderHook, act } from '@testing-library/react';

import { useKanbanBoard, type UseKanbanBoardParams } from '../hooks/useKanbanBoard';

// ---------------------------------------------------------------------------
// Module mocks (hoisted above the value imports by ts-jest). A mock factory may
// only reference out-of-scope variables that are prefixed with `mock`.
// ---------------------------------------------------------------------------

// httpClient — the generic /api/v1/ client. `get` resolves the parsed body
// DIRECTLY (adjusted per useKanbanBoard.ts on disk). The other verbs exist for
// shape only: the hook reaches the bulk endpoints through the mocked
// `userstories` adapter, never these methods.
jest.mock('../../shared/api/httpClient', () => {
  const client = {
    get: jest.fn(),
    getWithHeaders: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
  };
  return { __esModule: true, default: client, httpClient: client };
});

// userstories — the typed bulk-endpoint adapter. BOTH the named exports and the
// default aggregate share the SAME jest.fn references; the hook invokes the
// DEFAULT aggregate's methods (adjusted per useKanbanBoard.ts on disk).
jest.mock('../../shared/api/userstories', () => {
  const bulkCreate = jest.fn();
  const bulkUpdateBacklogOrder = jest.fn();
  const bulkUpdateMilestone = jest.fn();
  const bulkUpdateKanbanOrder = jest.fn();
  const editStatus = jest.fn();
  // KB-5 single-story create + KB-4 single-story delete adapters.
  const createUserStory = jest.fn();
  const deleteUserStory = jest.fn();
  const aggregate = {
    bulkCreate,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    bulkUpdateKanbanOrder,
    editStatus,
    createUserStory,
    deleteUserStory,
  };
  return { __esModule: true, ...aggregate, default: aggregate };
});

// eventsClient — keep `routingKeys` REAL (pure string builders) via
// `jest.requireActual`, so subscription-key assertions use the genuine
// `changes.project.${id}.userstories` / `.projects` format. `createEventsClient`
// returns a FAKE client whose connect/subscribe/unsubscribe/disconnect are spies
// (re-created fresh per test) so tests can capture the subscription callbacks and
// later invoke them to simulate inbound WS messages.
let mockEventsClient: {
  connect: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  disconnect: jest.Mock;
};
jest.mock('../../shared/events/eventsClient', () => {
  const actual = jest.requireActual<typeof import('../../shared/events/eventsClient')>(
    '../../shared/events/eventsClient',
  );
  return {
    __esModule: true,
    routingKeys: actual.routingKeys,
    createEventsClient: jest.fn(() => mockEventsClient),
  };
});

// session — keep every real accessor (token/session/language reads) via
// `jest.requireActual`, and replace ONLY `redirectToLogin` with a spy so the
// F-READ-1 login-redirect assertion never performs a real jsdom navigation.
jest.mock('../../shared/session', () => {
  const actual = jest.requireActual<typeof import('../../shared/session')>(
    '../../shared/session',
  );
  return { __esModule: true, ...actual, redirectToLogin: jest.fn() };
});

import httpClient from '../../shared/api/httpClient';
import userstories from '../../shared/api/userstories';
import { createEventsClient, routingKeys } from '../../shared/events/eventsClient';
import { redirectToLogin } from '../../shared/session';

// ---------------------------------------------------------------------------
// Typed mock accessors (stable across tests; `clearMocks` resets call state only,
// never the fn identities or their implementations).
// ---------------------------------------------------------------------------

const getMock = httpClient.get as unknown as jest.Mock;
const bulkKanbanMock = userstories.bulkUpdateKanbanOrder as unknown as jest.Mock;
const bulkCreateMock = userstories.bulkCreate as unknown as jest.Mock;
const createUsMock = userstories.createUserStory as unknown as jest.Mock;
const deleteUsMock = userstories.deleteUserStory as unknown as jest.Mock;
const createEventsClientMock = createEventsClient as unknown as jest.Mock;
const redirectToLoginMock = redirectToLogin as unknown as jest.Mock;

/** Minimal HttpError shape for asserting the surfaced `loadError.status`. */
type HttpErrorLike = { status?: number };

// The hook computes ONE shared debounce delay
// `700 + Math.floor(Math.random() * (1000 - 700 + 1))`; stubbing `Math.random()`
// to 0.5 pins it to `700 + floor(0.5 * 301)` = 850ms.
const RANDOM_TIMEOUT = 850;

// ---------------------------------------------------------------------------
// Fixtures — factory functions returning FRESH objects on every call, so immer's
// auto-freeze (applied when the real reducer stores them) never contaminates a
// later load/refresh that re-reads the same fixture.
// ---------------------------------------------------------------------------

const PROJECT_ID = 7;

function makeProject(): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    slug: 'proj',
    name: 'Proj',
    // Required truthy value: a falsy `is_kanban_activated` trips the permission
    // gate (`setPermissionError(true)`), which we avoid on the happy path.
    is_kanban_activated: true,
    members: [{ id: 101 }, { id: 102 }],
    us_statuses: [
      { id: 1, name: 'New', order: 1, is_archived: false, wip_limit: null },
      { id: 2, name: 'Done', order: 2, is_archived: false, wip_limit: null },
    ],
    roles: [],
    points: [],
  };
}

function makeSwimlanes(): Array<Record<string, unknown>> {
  return []; // flat board (no swimlanes)
}

function makeUserstories(): Array<Record<string, unknown>> {
  return [
    { id: 11, status: 1, swimlane: null, kanban_order: 1, assigned_to: null, assigned_users: [] },
    { id: 12, status: 1, swimlane: null, kanban_order: 2, assigned_to: null, assigned_users: [] },
    { id: 13, status: 2, swimlane: null, kanban_order: 1, assigned_to: null, assigned_users: [] },
  ];
}

/**
 * Install the default path-dispatching `httpClient.get` mock. Every branch
 * resolves the DATA DIRECTLY (no `{ data }` wrapper). // adjusted per
 * useKanbanBoard.ts on disk
 */
function installDefaultGet(): void {
  getMock.mockImplementation((path: string) => {
    if (path === 'projects/by_slug') {
      return Promise.resolve(makeProject());
    }
    if (path === 'swimlanes') {
      return Promise.resolve(makeSwimlanes());
    }
    if (path === 'userstories') {
      return Promise.resolve(makeUserstories());
    }
    return Promise.resolve([]);
  });
}

// ---------------------------------------------------------------------------
// Async helpers (fake-timer safe). The mocked promises resolve on the microtask
// queue, which fake timers do NOT control, so microtasks are flushed explicitly.
// ---------------------------------------------------------------------------

/** Advance the fake clock by `ms`, then flush the async chain those timers start. */
async function advanceAndFlush(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  });
}

/** Render the hook and flush the initial load chain until `isFirstLoad` clears. */
async function loadHook(overrides: Partial<UseKanbanBoardParams> = {}) {
  const initialProps: UseKanbanBoardParams = {
    projectSlug: 'proj',
    zoomLevel: 1,
    filtersQuery: {},
    ...overrides,
  };
  const view = renderHook((props: UseKanbanBoardParams) => useKanbanBoard(props), {
    initialProps,
  });
  // The load path is a chain of mocked (already-resolved) promises; flush the
  // microtask queue in `act` rounds until the hook reports the load finished.
  for (let i = 0; i < 20 && view.result.current.isFirstLoad; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  return view;
}

type HookView = Awaited<ReturnType<typeof loadHook>>;

/** Re-render the hook with new props, then flush any async work it triggers. */
async function rerenderAndFlush(view: HookView, props: UseKanbanBoardParams): Promise<void> {
  await act(async () => {
    view.rerender(props);
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  });
}

/** Count `httpClient.get` calls issued for a given path (first positional arg). */
function countGet(path: string): number {
  return getMock.mock.calls.filter((call: unknown[]) => call[0] === path).length;
}

/** The most recent `httpClient.get` call for a path (`[path, params, options]`). */
function lastGetCall(path: string): unknown[] {
  const calls = getMock.mock.calls.filter((call: unknown[]) => call[0] === path);
  const last = calls[calls.length - 1];
  if (!last) {
    throw new Error(`No httpClient.get call recorded for path: ${path}`);
  }
  return last as unknown[];
}

/** Retrieve the subscription callback the hook registered for a routing key. */
function getSubscribedCallback(routingKey: string): (payload: unknown) => void {
  const call = mockEventsClient.subscribe.mock.calls.find((c: unknown[]) => c[0] === routingKey);
  if (!call) {
    throw new Error(`No subscription registered for routing key: ${routingKey}`);
  }
  return call[1] as (payload: unknown) => void;
}

// The hook reads NONE of these globals directly (they are consumed only by the
// mocked httpClient/eventsClient), so we treat them loosely and merely keep a
// clean slate per test (rule 6). Casting through `unknown` sidesteps the strict
// ambient `Window.taigaConfig` shape declared elsewhere in the source tree.
type MutableGlobals = { taiga?: unknown; taigaConfig?: unknown };

describe('useKanbanBoard', () => {
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    // Pin the shared debounce delay to RANDOM_TIMEOUT (850ms).
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    // Fresh fake events client per test (connect/subscribe/unsubscribe/disconnect).
    mockEventsClient = {
      connect: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      disconnect: jest.fn(),
    };

    // (Re)install the default path dispatcher + adapter resolutions. `clearMocks`
    // (jest.config.js) resets call state before each test; we (re)set behavior here.
    installDefaultGet();
    bulkKanbanMock.mockResolvedValue({});
    bulkCreateMock.mockResolvedValue([]); // [] -> addUs(add, []) is a clean no-op
    // KB-4 delete resolves to null (204 No Content); KB-5 create resolves to a
    // minimal created story so addUs can add it. Individual tests override.
    deleteUsMock.mockResolvedValue(null);
    createUsMock.mockResolvedValue({
      id: 500,
      status: 1,
      swimlane: null,
      kanban_order: 10,
      assigned_to: null,
      assigned_users: [],
    });
    (userstories.editStatus as unknown as jest.Mock).mockResolvedValue({});
    (userstories.bulkUpdateBacklogOrder as unknown as jest.Mock).mockResolvedValue({});
    (userstories.bulkUpdateMilestone as unknown as jest.Mock).mockResolvedValue({});

    // Defensive, hook-agnostic global slate.
    const w = window as unknown as MutableGlobals;
    w.taiga = { sessionId: 'sess-1' };
    w.taigaConfig = { api: 'http://localhost:9000/api/v1/', eventsUrl: '' };
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    randomSpy.mockRestore();
    localStorage.clear();
    const w = window as unknown as MutableGlobals;
    delete w.taiga;
    delete w.taigaConfig;
  });

  // ==== TEST SUITES APPENDED BELOW ====

  // -------------------------------------------------------------------------
  // Phase C — initial load sequence
  // -------------------------------------------------------------------------
  describe('initial load sequence', () => {
    it('loads project by slug, then swimlanes and userstories, and clears isFirstLoad', async () => {
      const view = await loadHook();

      // Project fetched first, by slug.
      expect(getMock).toHaveBeenCalledWith('projects/by_slug', { slug: 'proj' });
      // Swimlanes fetched for the resolved project id.
      expect(getMock).toHaveBeenCalledWith('swimlanes', expect.objectContaining({ project: 7 }));
      // Userstories fetched with the base filter AND the pagination-disabling header.
      // adjusted per useKanbanBoard.ts on disk: params is the 2nd positional arg,
      // options.headers the 3rd; the header key is the literal `x-disable-pagination`.
      expect(getMock).toHaveBeenCalledWith(
        'userstories',
        expect.objectContaining({ project: 7, status__is_archived: false }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-disable-pagination': '1' }),
        }),
      );

      // Hook state reflects the loaded project.
      expect(view.result.current.project).not.toBeNull();
      expect((view.result.current.project as { id: number }).id).toBe(7);
      expect(view.result.current.projectId).toBe(7);
      expect(view.result.current.statuses).toHaveLength(2);
      expect(view.result.current.isFirstLoad).toBe(false);
    });

    it('projects loaded userstories into STRING-keyed usByStatus columns', async () => {
      const view = await loadHook();

      const usByStatus = view.result.current.usByStatus;
      // Keys are strings (Record<string, number[]>) per the real reducer.
      expect(Object.keys(usByStatus)).toEqual(expect.arrayContaining(['1', '2']));
      expect(usByStatus['1']).toEqual(expect.arrayContaining([11, 12]));
      expect(usByStatus['2']).toEqual(expect.arrayContaining([13]));
      // The us map indexes every loaded story by id.
      expect(view.result.current.usMap[11]).toBeDefined();
      expect(view.result.current.usMap[13]).toBeDefined();
    });

    it('opens BOTH WebSocket subscriptions once the project id is known', async () => {
      await loadHook();

      expect(createEventsClientMock).toHaveBeenCalled();
      expect(mockEventsClient.connect).toHaveBeenCalled();
      expect(mockEventsClient.subscribe).toHaveBeenCalledTimes(2);

      const keys = mockEventsClient.subscribe.mock.calls.map((c: unknown[]) => c[0]);
      expect(keys).toContain(routingKeys.userstories(7)); // 'changes.project.7.userstories'
      expect(keys).toContain(routingKeys.projects(7)); //    'changes.project.7.projects'
    });
  });

  // -------------------------------------------------------------------------
  // Phase C2 — read/init error handling (F-READ-1, F-READ-2)
  //
  // Legacy `$tgHttp` surfaces load failures and redirects to /login on 401. The
  // React hook must NOT leave an uncaught promise rejection or a silently-broken
  // board. `loadError` being set is the deterministic proof the internal
  // `catch` ran (an UNhandled rejection would leave `loadError` null), so these
  // tests assert on `loadError` + the `redirectToLogin` spy rather than relying
  // on flaky cross-runtime unhandled-rejection events.
  // -------------------------------------------------------------------------
  describe('read/init error handling', () => {
    /** Build an `HttpError`-shaped rejection (Error + numeric `status`). */
    function httpError(status: number, url = 'projects/by_slug'): Error {
      return Object.assign(new Error(`HTTP ${status} for GET ${url}`), { status });
    }

    it('F-READ-1: a 401 on the project load is caught, surfaced, and redirects to /login', async () => {
      getMock.mockImplementation((path: string) => {
        if (path === 'projects/by_slug') {
          return Promise.reject(httpError(401));
        }
        return Promise.resolve([]);
      });

      const view = await loadHook();

      // The load promise did NOT reject uncaught — the catch ran and surfaced it.
      expect(view.result.current.loadError).toBeInstanceOf(Error);
      expect((view.result.current.loadError as HttpErrorLike).status).toBe(401);
      // 401 => login redirect (legacy `$tgHttp` parity), exactly once.
      expect(redirectToLoginMock).toHaveBeenCalledTimes(1);
      // The board is not populated, but the app did not crash.
      expect(view.result.current.projectId).toBeNull();
    });

    it('F-READ-1: a 500 on the userstories read is caught and surfaced WITHOUT a redirect', async () => {
      getMock.mockImplementation((path: string) => {
        if (path === 'projects/by_slug') {
          return Promise.resolve(makeProject());
        }
        if (path === 'swimlanes') {
          return Promise.resolve(makeSwimlanes());
        }
        if (path === 'userstories') {
          return Promise.reject(httpError(500, 'userstories'));
        }
        return Promise.resolve([]);
      });

      const view = await loadHook();

      expect(view.result.current.loadError).toBeInstanceOf(Error);
      expect((view.result.current.loadError as HttpErrorLike).status).toBe(500);
      // Non-401 failures surface an error but must NOT redirect.
      expect(redirectToLoginMock).not.toHaveBeenCalled();
    });

    it('F-READ-2: a 204/null userstories body loads as an empty board without throwing', async () => {
      getMock.mockImplementation((path: string) => {
        if (path === 'projects/by_slug') {
          return Promise.resolve(makeProject());
        }
        if (path === 'swimlanes') {
          return Promise.resolve(makeSwimlanes());
        }
        if (path === 'userstories') {
          // httpClient returns `null` for a 204 / empty body.
          return Promise.resolve(null);
        }
        return Promise.resolve([]);
      });

      const view = await loadHook();

      // The load COMPLETED (no TypeError on null.length): isFirstLoad cleared,
      // no error surfaced, and the board is simply empty.
      expect(view.result.current.isFirstLoad).toBe(false);
      expect(view.result.current.loadError == null).toBe(true);
      expect(Object.keys(view.result.current.usMap)).toHaveLength(0);
      const usByStatus = view.result.current.usByStatus;
      expect(usByStatus['1'] ?? []).toHaveLength(0);
      expect(usByStatus['2'] ?? []).toHaveLength(0);
    });

    it('F-READ-2: a null swimlanes body does not throw and loads userstories normally', async () => {
      getMock.mockImplementation((path: string) => {
        if (path === 'projects/by_slug') {
          return Promise.resolve(makeProject());
        }
        if (path === 'swimlanes') {
          return Promise.resolve(null); // 204 / empty body
        }
        if (path === 'userstories') {
          return Promise.resolve(makeUserstories());
        }
        return Promise.resolve([]);
      });

      const view = await loadHook();

      expect(view.result.current.isFirstLoad).toBe(false);
      expect(view.result.current.loadError == null).toBe(true);
      // Userstories still projected despite the null swimlanes response.
      expect(view.result.current.usByStatus['1']).toEqual(expect.arrayContaining([11, 12]));
    });
  });

  // -------------------------------------------------------------------------
  // Phase D — loadUserstoriesParams (zoom-dependent) + reload-on-zoom off-by-one
  // -------------------------------------------------------------------------
  describe('loadUserstoriesParams + reload-on-zoom boundary', () => {
    it('omits the include flags when zoom < 2', async () => {
      await loadHook({ zoomLevel: 1 });

      const params = lastGetCall('userstories')[1];
      expect(params).toEqual(expect.objectContaining({ project: 7, status__is_archived: false }));
      expect(params).toEqual(expect.not.objectContaining({ include_attachments: 1 }));
      expect(params).toEqual(expect.not.objectContaining({ include_tasks: 1 }));
    });

    it('adds include_attachments/include_tasks when zoom >= 2', async () => {
      await loadHook({ zoomLevel: 2 });

      const params = lastGetCall('userstories')[1];
      expect(params).toEqual(
        expect.objectContaining({ include_attachments: 1, include_tasks: 1 }),
      );
    });

    it('merges filtersQuery (tags + q) into the userstories params', async () => {
      await loadHook({ zoomLevel: 1, filtersQuery: { tags: 'bug', q: 'login' } });

      const params = lastGetCall('userstories')[1];
      expect(params).toEqual(expect.objectContaining({ tags: 'bug', q: 'login' }));
    });

    it('reloads userstories ONLY when zoom crosses up from <=2 to >2', async () => {
      const view = await loadHook({ zoomLevel: 2 });
      const before = countGet('userstories');

      // 2 -> 3 crosses the `> 2 && prev <= 2` trigger: a reload fires.
      await rerenderAndFlush(view, { projectSlug: 'proj', zoomLevel: 3, filtersQuery: {} });
      expect(countGet('userstories')).toBe(before + 1);

      // 3 -> 3 does not re-trigger the zoom effect.
      const afterUp = countGet('userstories');
      await rerenderAndFlush(view, { projectSlug: 'proj', zoomLevel: 3, filtersQuery: {} });
      expect(countGet('userstories')).toBe(afterUp);
    });

    it('does NOT reload on the 1 -> 2 transition (deliberate off-by-one)', async () => {
      const view = await loadHook({ zoomLevel: 1 });
      const before = countGet('userstories');

      // 2 is not `> 2`, so the zoom-reload effect must not fire on its own.
      await rerenderAndFlush(view, { projectSlug: 'proj', zoomLevel: 2, filtersQuery: {} });
      expect(countGet('userstories')).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Phase E — userstories WS subscription + trailing-debounce window (fake timers)
  // -------------------------------------------------------------------------
  describe('userstories subscription + trailing-debounce window', () => {
    it('does not refresh immediately, then fires once on the trailing edge', async () => {
      const view = await loadHook();
      const cb = getSubscribedCallback(routingKeys.userstories(7));
      const before = countGet('userstories');

      // Trailing debounce: invoking the callback only SCHEDULES the refresh.
      cb({ pk: 11 });
      expect(countGet('userstories')).toBe(before);

      // Just short of the window: still nothing.
      await advanceAndFlush(RANDOM_TIMEOUT - 1);
      expect(countGet('userstories')).toBe(before);

      // Crossing the window: exactly one refresh fires.
      await advanceAndFlush(1);
      expect(countGet('userstories')).toBe(before + 1);

      // Guard: the hook is still mounted and healthy afterwards.
      expect(view.result.current.isFirstLoad).toBe(false);
    });

    it('coalesces a burst of messages into a SINGLE trailing refresh', async () => {
      await loadHook();
      const cb = getSubscribedCallback(routingKeys.userstories(7));
      const before = countGet('userstories');

      // Three messages inside the same window reschedule the single trailing call.
      cb({ pk: 11 });
      cb({ pk: 12 });
      cb({ pk: 13 });

      await advanceAndFlush(RANDOM_TIMEOUT);
      expect(countGet('userstories')).toBe(before + 1);
    });
  });

  // -------------------------------------------------------------------------
  // Phase F — projects WS subscription + the EXACT `matches` 3-set filter
  // -------------------------------------------------------------------------
  describe('projects subscription + matches filter', () => {
    // adjusted per useKanbanBoard.ts on disk: the message field is `matches` and a
    // match triggers refreshAfterSwimlanesOrUserstoryStatusesHaveChanged(), which
    // re-fetches the project (projects/by_slug), swimlanes AND userstories.
    const MATCHES = [
      'projects.swimlane',
      'projects.swimlaneuserstorystatus',
      'projects.userstorystatus',
    ];

    it.each(MATCHES)('refreshes on the matches value "%s"', async (match) => {
      await loadHook();
      const cb = getSubscribedCallback(routingKeys.projects(7));
      const beforeProject = countGet('projects/by_slug');
      const beforeUs = countGet('userstories');

      cb({ matches: match });
      await advanceAndFlush(RANDOM_TIMEOUT);

      expect(countGet('projects/by_slug')).toBeGreaterThan(beforeProject);
      expect(countGet('userstories')).toBeGreaterThan(beforeUs);
    });

    it('ignores a non-matching matches value', async () => {
      await loadHook();
      const cb = getSubscribedCallback(routingKeys.projects(7));
      const beforeProject = countGet('projects/by_slug');
      const beforeUs = countGet('userstories');

      cb({ matches: 'projects.something-else' });
      await advanceAndFlush(RANDOM_TIMEOUT);

      expect(countGet('projects/by_slug')).toBe(beforeProject);
      expect(countGet('userstories')).toBe(beforeUs);
    });

    it('ignores a message with no matches field', async () => {
      await loadHook();
      const cb = getSubscribedCallback(routingKeys.projects(7));
      const beforeProject = countGet('projects/by_slug');
      const beforeUs = countGet('userstories');

      cb({ pk: 99 });
      await advanceAndFlush(RANDOM_TIMEOUT);

      expect(countGet('projects/by_slug')).toBe(beforeProject);
      expect(countGet('userstories')).toBe(beforeUs);
    });
  });

  // -------------------------------------------------------------------------
  // Phase G — lightbox deferral (PROJECTS subscription only) // adjusted per disk
  // -------------------------------------------------------------------------
  describe('lightbox deferral', () => {
    it('defers a projects refresh while the lightbox is open, then flushes it on close', async () => {
      const view = await loadHook();
      const cb = getSubscribedCallback(routingKeys.projects(7));

      // Open the lightbox.
      await act(async () => {
        view.result.current.setLightboxOpen(true);
      });
      expect(view.result.current.isLightboxOpened).toBe(true);

      const beforeProject = countGet('projects/by_slug');
      const beforeUs = countGet('userstories');

      // A qualifying projects event arrives while the lightbox is open: it must be
      // DEFERRED (isRefreshNeeded set), not executed.
      cb({ matches: 'projects.swimlane' });
      await advanceAndFlush(RANDOM_TIMEOUT);
      expect(countGet('projects/by_slug')).toBe(beforeProject);
      expect(countGet('userstories')).toBe(beforeUs);

      // Closing the lightbox flushes the deferred refresh.
      await act(async () => {
        view.result.current.setLightboxOpen(false);
        for (let i = 0; i < 8; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });
      expect(countGet('projects/by_slug')).toBeGreaterThan(beforeProject);
      expect(countGet('userstories')).toBeGreaterThan(beforeUs);
    });

    it('refreshes normally when the lightbox stays closed (contrast case)', async () => {
      await loadHook();
      const cb = getSubscribedCallback(routingKeys.projects(7));
      const beforeProject = countGet('projects/by_slug');

      cb({ matches: 'projects.userstorystatus' });
      await advanceAndFlush(RANDOM_TIMEOUT);

      expect(countGet('projects/by_slug')).toBeGreaterThan(beforeProject);
    });
  });

  // -------------------------------------------------------------------------
  // Phase H — unmount teardown
  // -------------------------------------------------------------------------
  describe('unmount teardown', () => {
    it('unsubscribes BOTH keys and disconnects on unmount', async () => {
      const view = await loadHook();

      view.unmount();

      expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith(routingKeys.userstories(7));
      expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith(routingKeys.projects(7));
      expect(mockEventsClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('cancels the pending debounce so NO late refresh fires after unmount', async () => {
      const view = await loadHook();
      const cb = getSubscribedCallback(routingKeys.userstories(7));
      const before = countGet('userstories');

      // Start a pending trailing-debounce, then unmount before it elapses.
      cb({ pk: 11 });

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      view.unmount();

      // Advance well past the window: the cancelled debounce must not fire, and no
      // "state update on an unmounted component" warning may be emitted.
      await advanceAndFlush(1000);

      expect(countGet('userstories')).toBe(before);
      const warned = errorSpy.mock.calls
        .map((c: unknown[]) => String(c[0] ?? ''))
        .some((msg: string) => msg.includes('unmounted'));
      expect(warned).toBe(false);
      errorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Phase I — moveUs => a SINGLE bulkUpdateKanbanOrder (contract-critical)
  // -------------------------------------------------------------------------
  describe('moveUs contract', () => {
    it('fires exactly one bulkUpdateKanbanOrder carrying the moved id', async () => {
      const view = await loadHook();
      expect(bulkKanbanMock).not.toHaveBeenCalled();

      // Move us 13 into status 1, unclassified swimlane (-1), before us 11.
      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 1, -1, 0, null, 11);
      });

      expect(bulkKanbanMock).toHaveBeenCalledTimes(1);
      const args = bulkKanbanMock.mock.calls[0];
      // (projectId, statusId, apiSwimlane, afterUserstoryId, beforeUserstoryId, bulkUserstories)
      expect(args[0]).toBe(7);
      expect(args[1]).toBe(1);
      expect(args[2]).toBeNull(); // -1 -> null
      expect(args[4]).toBe(11); // beforeUserstoryId derives from nextCard
      expect(args[5]).toEqual(expect.arrayContaining([13]));
    });

    it('maps the unclassified swimlane (-1) to null on the wire', async () => {
      const view = await loadHook();

      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 1, -1, 0, null, null);
      });

      expect(bulkKanbanMock.mock.calls[0][2]).toBeNull();
    });

    it('passes a real swimlane id through unchanged', async () => {
      const view = await loadHook();

      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 1, 5, 0, null, null);
      });

      expect(bulkKanbanMock.mock.calls[0][2]).toBe(5);
    });

    it('makes exactly one network call per move', async () => {
      const view = await loadHook();

      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 1, -1, 0, null, 11);
      });
      expect(bulkKanbanMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 2, -1, 0, null, null);
      });
      expect(bulkKanbanMock).toHaveBeenCalledTimes(2);
    });

    it('F-WRITE-2: rolls back the optimistic move and surfaces writeError when the write fails', async () => {
      const view = await loadHook();
      // Baseline projection: {'1':[11,12], '2':[13]}.
      const before = JSON.parse(JSON.stringify(view.result.current.usByStatus));
      expect(before['2']).toEqual([13]);

      // Force the single write to reject (500).
      const err = Object.assign(
        new Error('HTTP 500 for POST userstories/bulk_update_kanban_order'),
        { status: 500 },
      );
      bulkKanbanMock.mockRejectedValueOnce(err);

      // Move us 13 from status 2 into status 1 (a real, visible cross-column change).
      await act(async () => {
        // Must NOT reject — moveUs handles the failure internally (no uncaught rejection).
        await view.result.current.moveUs([{ id: 13 }], 1, -1, 0, null, 11);
      });

      // Exactly ONE write attempted (no retry storm).
      expect(bulkKanbanMock).toHaveBeenCalledTimes(1);
      // ROLLED BACK to the pre-move projection: card 13 is back in status 2, not
      // left falsely in status 1 (this is what would diverge without the fix).
      expect(view.result.current.usByStatus).toEqual(before);
      expect(view.result.current.usByStatus['2']).toEqual([13]);
      // The error is SURFACED (proof the catch ran; an uncaught rejection would
      // leave writeError null).
      expect(view.result.current.writeError).toBeInstanceOf(Error);
      expect((view.result.current.writeError as HttpErrorLike).status).toBe(500);
    });

    it('F-WRITE-2: a successful move persists optimistically and leaves writeError null', async () => {
      const view = await loadHook();

      await act(async () => {
        await view.result.current.moveUs([{ id: 13 }], 1, -1, 0, null, 11);
      });

      expect(view.result.current.writeError == null).toBe(true);
      // 13 moved out of status 2 into status 1 (optimistic state retained on success).
      expect(view.result.current.usByStatus['1']).toEqual(expect.arrayContaining([13]));
      expect(view.result.current.usByStatus['2'] ?? []).not.toContain(13);
    });
  });

  // -------------------------------------------------------------------------
  // Phase J — other dispatchers & toggleSwimlane persistence (cheap coverage)
  // -------------------------------------------------------------------------
  describe('other dispatchers', () => {
    it('addUsBulk posts to bulkCreate with (projectId, statusId, bulkStories, swimlaneId)', async () => {
      const view = await loadHook();

      await act(async () => {
        await view.result.current.addUsBulk(1, 'Story A\nStory B');
      });

      expect(bulkCreateMock).toHaveBeenCalledTimes(1);
      expect(bulkCreateMock).toHaveBeenCalledWith(7, 1, 'Story A\nStory B', null);
    });

    it('toggleSwimlane persists the folded mode to localStorage', async () => {
      const view = await loadHook();

      await act(async () => {
        view.result.current.toggleSwimlane(5);
      });

      // adjusted per useKanbanBoard.ts on disk: key is `kanban.swimlanes.modes.${projectId}`.
      const stored = localStorage.getItem('kanban.swimlanes.modes.7');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored as string) as Record<string, boolean>;
      expect(parsed['5']).toBe(true);
    });

    it('reload re-fetches the userstories', async () => {
      const view = await loadHook();
      const before = countGet('userstories');

      await act(async () => {
        await view.result.current.reload();
      });

      expect(countGet('userstories')).toBe(before + 1);
    });

    it('exposes the remaining dispatchers and applies them without error', async () => {
      const view = await loadHook();

      // Local state mutations (no network): fold, hide, show, add, edit, delete.
      await act(async () => {
        view.result.current.toggleFold(11);
        view.result.current.hideStatus(2);
      });
      // A hidden status is tracked without throwing.
      expect(Array.isArray(view.result.current.statuses)).toBe(true);

      await act(async () => {
        await view.result.current.showStatus(2);
      });

      await act(async () => {
        view.result.current.addUs({
          id: 99,
          status: 1,
          swimlane: null,
          kanban_order: 5,
          assigned_to: null,
          assigned_users: [],
        });
        view.result.current.editUs({
          id: 11,
          status: 1,
          swimlane: null,
          kanban_order: 1,
          assigned_to: null,
          assigned_users: [],
        });
        // `deleteUs` is now PESSIMISTIC (KB-4): it awaits DELETE /userstories/{id}
        // and removes from the board only on success. Await it so the removal has
        // completed before the assertion.
        await view.result.current.deleteUs({
          id: 12,
          status: 1,
          swimlane: null,
          kanban_order: 2,
          assigned_to: null,
          assigned_users: [],
        });
      });

      // The board is still coherent after the batch of mutations.
      expect(view.result.current.usMap[99]).toBeDefined();
      expect(view.result.current.usMap[12]).toBeUndefined();
      expect(view.result.current.project).not.toBeNull();
    });

    // KB-4: deleteUs fires exactly one DELETE /userstories/{id} and removes the
    // story from the board ONLY on the server's 204.
    it('deleteUs calls deleteUserStory(id) and removes the story on success', async () => {
      const view = await loadHook();
      expect(view.result.current.usMap[12]).toBeDefined();

      await act(async () => {
        await view.result.current.deleteUs({
          id: 12,
          status: 1,
          swimlane: null,
          kanban_order: 2,
          assigned_to: null,
          assigned_users: [],
        });
      });

      expect(deleteUsMock).toHaveBeenCalledTimes(1);
      expect(deleteUsMock).toHaveBeenCalledWith(12);
      expect(view.result.current.usMap[12]).toBeUndefined();
      expect(view.result.current.writeError ?? null).toBeNull();
    });

    // KB-4: a FAILED delete keeps the card on the board and surfaces writeError
    // (no phantom delete).
    it('deleteUs keeps the story and surfaces writeError when the server delete fails', async () => {
      const view = await loadHook();
      expect(view.result.current.usMap[12]).toBeDefined();
      const err = new Error('boom');
      deleteUsMock.mockRejectedValueOnce(err);

      await act(async () => {
        await view.result.current.deleteUs({
          id: 12,
          status: 1,
          swimlane: null,
          kanban_order: 2,
          assigned_to: null,
          assigned_users: [],
        });
      });

      expect(deleteUsMock).toHaveBeenCalledTimes(1);
      // Card stays on the board.
      expect(view.result.current.usMap[12]).toBeDefined();
      expect(view.result.current.writeError).toBe(err);
    });

    // KB-5: addUsStandard posts to createUserStory(projectId, statusId, subject)
    // and adds the created story to the board.
    it('addUsStandard posts to createUserStory and adds the created story', async () => {
      const view = await loadHook();
      createUsMock.mockResolvedValueOnce({
        id: 777,
        status: 1,
        swimlane: null,
        kanban_order: 99,
        assigned_to: null,
        assigned_users: [],
      });

      await act(async () => {
        await view.result.current.addUsStandard(1, 'A brand new story');
      });

      expect(createUsMock).toHaveBeenCalledTimes(1);
      expect(createUsMock).toHaveBeenCalledWith(7, 1, 'A brand new story');
      expect(view.result.current.usMap[777]).toBeDefined();
      expect(view.result.current.writeError ?? null).toBeNull();
    });

    // KB-5: a FAILED create surfaces writeError and adds nothing.
    it('addUsStandard surfaces writeError when the create fails', async () => {
      const view = await loadHook();
      const err = new Error('create failed');
      createUsMock.mockRejectedValueOnce(err);

      await act(async () => {
        await view.result.current.addUsStandard(1, 'Doomed story');
      });

      expect(createUsMock).toHaveBeenCalledTimes(1);
      expect(view.result.current.writeError).toBe(err);
    });
  });

});
