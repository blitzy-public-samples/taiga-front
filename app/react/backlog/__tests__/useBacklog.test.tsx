/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklog.test.tsx
 * -------------------
 * Browserless Jest + React Testing Library (`renderHook`) unit spec for the
 * React Backlog data hook `../hooks/useBacklog`, authored as part of the
 * AngularJS 1.5.10 -> React 18 coexistence migration. It is the backlog mirror
 * of the kanban gold-standard `app/react/kanban/__tests__/useKanbanBoard.test.tsx`
 * and the second-highest contributor (after the reducer spec) to the >=70%
 * global line-coverage gate over `app/react/**` (AAP 0.2.1 / 0.7.1).
 *
 * The hook is the orchestration/data layer that reproduces the AngularJS
 * `BacklogController` (`app/coffee/modules/backlog/main.coffee`) + sprint
 * fold/lightbox logic (`sprints.coffee` / `lightboxes.coffee`): initial data
 * load, HTTP response-header parsing, pagination, the two DISTINCT bulk paths
 * (optimistic drag vs the toolbar move-to-sprint), the WebSocket subscriptions
 * (milestones WITH `{ selfNotification: true }`, userstories WITHOUT), and the
 * sprint add/edit/remove flows. Every branch here runs the REAL reducer so the
 * hook<->reducer integration is exercised end-to-end (that is what earns the
 * coverage).
 *
 * MOCKING STRATEGY (mirrors the kanban useKanbanBoard spec): mock ONLY the
 * shared BOUNDARY modules the hook imports (`../../shared/api/httpClient`,
 * `../../shared/api/userstories`, `../../shared/api/milestones`,
 * `../../shared/events/eventsClient`, `../../shared/config`) so no `fetch` /
 * `WebSocket` ever fires; keep the PURE reducer (`../state/backlogReducer`) and
 * `moment` / `lodash` REAL. `routingKeys` is kept REAL via `jest.requireActual`
 * so subscription-key assertions use the genuine `changes.project.${id}.*`
 * format.
 *
 * HARD RULES enforced here (AAP 0.6.2 / 0.7):
 *   - Test isolation: Jest + `jest-environment-jsdom` ONLY. NO Playwright, NO
 *     real browser, NO real network, NO real WebSocket. `renderHook` runs in
 *     jsdom and the suite passes headlessly in a bare container.
 *   - Globals-only import boundary: the ONLY project imports are the hook under
 *     test (value + types) and the mocked `../../shared/*` adapters. Nothing is
 *     imported from `app/coffee/**`, `app/partials/**`, `app/styles/**`,
 *     `app/modules/**`, the compiled `elements` bundle, `angular`, `dragula`,
 *     `dom-autoscroller`, `immutable`, `checksley`, or `jquery`.
 *   - `describe`/`it`/`expect`/`beforeEach`/`afterEach`/`jest` are AMBIENT via
 *     `@types/jest` + ts-jest; they are deliberately NOT imported. `React` is
 *     NOT imported (jsx react-jsx automatic runtime). `@testing-library/jest-dom`
 *     is auto-registered via the root `setupFilesAfterEnv` and is NOT imported.
 *   - The reducer (`../state/backlogReducer`) is NEVER mocked; it runs for real.
 *
 * DRIFT NOTES - every assertion below was authored against the ACTUAL
 * `useBacklog.ts` on disk (mandatory Phase A drift guard). Divergences from the
 * generic outline are reproduced faithfully and flagged with
 * `// adjusted per useBacklog.ts on disk`:
 *   - `httpClient.get(path, params?)` resolves the parsed body DIRECTLY (NOT a
 *     `{ data }` wrapper); `getWithHeaders` resolves `{ data, headers, status }`.
 *   - The hook has NO internal debounce / `setTimeout`: WebSocket callbacks
 *     refresh SYNCHRONOUSLY, so message tests invoke the recorded callback and
 *     only flush microtasks (no debounce window to advance).
 *   - The hook does NOT install an `isMounted` guard in its load callbacks; the
 *     real late-refresh protection on unmount is `unsubscribe` + `disconnect`
 *     (the client stops delivering), which is what Phase I asserts.
 *   - `useBacklog` returns `{ state, actions }` (NOT a flattened object), so
 *     assertions read `result.current.state.*` and drive `result.current.actions.*`.
 *   - Fake timers + `jest.setSystemTime` pin "now" to 2021-06-15 so
 *     `findCurrentSprint` deterministically selects Sprint B (id 20) while
 *     `sprints[0]` stays Sprint A (id 10) - the setup that makes the
 *     `bulkUpdateMilestone` `milestone_id = sprints[0].id` quirk provable.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import { useBacklog } from '../hooks/useBacklog';
import type { UseBacklogParams, BacklogDragResult } from '../hooks/useBacklog';

// ---------------------------------------------------------------------------
// Module mocks (hoisted above the value imports by ts-jest). A mock factory may
// only reference out-of-scope variables that are prefixed with `mock`.
// ---------------------------------------------------------------------------

// httpClient - the generic /api/v1/ client (DEFAULT export). `get` resolves the
// parsed body directly; `getWithHeaders` resolves `{ data, headers, status }`.
// The other verbs exist for shape only (the hook reaches bulk endpoints through
// the mocked `userstories` / `milestones` adapters, never these).
jest.mock('../../shared/api/httpClient', () => ({
  __esModule: true,
  default: {
    request: jest.fn(),
    get: jest.fn(),
    getWithHeaders: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

// userstories - the typed bulk-endpoint adapter. DUAL-EXPORT: the named exports
// and the `default` aggregate share the SAME jest.fn references, so assertions
// work regardless of the hook's import style (it imports the DEFAULT aggregate).
jest.mock('../../shared/api/userstories', () => {
  const bulkUpdateMilestone = jest.fn(() => Promise.resolve({}));
  const bulkUpdateBacklogOrder = jest.fn(() => Promise.resolve({ data: [] }));
  const bulkCreate = jest.fn(() => Promise.resolve({}));
  const bulkUpdateKanbanOrder = jest.fn(() => Promise.resolve({}));
  const editStatus = jest.fn(() => Promise.resolve({}));
  const api = {
    bulkUpdateMilestone,
    bulkUpdateBacklogOrder,
    bulkCreate,
    bulkUpdateKanbanOrder,
    editStatus,
  };
  return { __esModule: true, ...api, userstories: api, default: api };
});

// milestones - the sprint adapter. DUAL-EXPORT (named + `default` aggregate).
// `list` resolves `{ milestones, closed, open }`; the mutations resolve.
jest.mock('../../shared/api/milestones', () => {
  const list = jest.fn(() => Promise.resolve({ milestones: [], closed: 0, open: 0 }));
  const create = jest.fn(() => Promise.resolve({ id: 99 }));
  const save = jest.fn(() => Promise.resolve({}));
  const remove = jest.fn(() => Promise.resolve(undefined));
  const stats = jest.fn(() => Promise.resolve({}));
  const get = jest.fn(() => Promise.resolve({}));
  const api = { list, create, save, remove, stats, get };
  return { __esModule: true, ...api, milestones: api, default: api };
});

// eventsClient - keep `routingKeys` REAL (pure string builders) via
// `jest.requireActual`, so subscription-key assertions use the genuine
// `changes.project.${id}.userstories` / `.milestones` format. `createEventsClient`
// returns a FAKE client (re-created fresh per test in `beforeEach`) whose
// connect/subscribe/unsubscribe/disconnect are spies; tests capture the recorded
// subscription callbacks and invoke them to simulate inbound WS messages.
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

// config - only `getEventsUrl` is read by the hook (to toggle the socket on/off);
// the rest are declared for shape. `httpClient` / `eventsClient` read the other
// config internally, but those are mocked, so config here only gates the socket.
jest.mock('../../shared/config', () => ({
  __esModule: true,
  getEventsUrl: jest.fn(() => 'ws://localhost/events'),
  getApiUrl: jest.fn(() => 'https://host/api/v1'),
  getConfigValue: jest.fn((_k: string, d: unknown) => d),
  getDefaultLanguage: jest.fn(() => 'en'),
  getConfig: jest.fn(() => ({})),
}));

import httpClient from '../../shared/api/httpClient';
import userstories from '../../shared/api/userstories';
import milestones from '../../shared/api/milestones';
import { createEventsClient, routingKeys } from '../../shared/events/eventsClient';
import { getEventsUrl } from '../../shared/config';

// ---------------------------------------------------------------------------
// Typed mock accessors (stable across tests; `clearMocks` in jest.config resets
// call state only, never the fn identities or their implementations).
// ---------------------------------------------------------------------------

const http = httpClient as unknown as { get: jest.Mock; getWithHeaders: jest.Mock; post: jest.Mock };
const us = userstories as unknown as {
  bulkUpdateMilestone: jest.Mock;
  bulkUpdateBacklogOrder: jest.Mock;
  bulkCreate: jest.Mock;
};
const ms = milestones as unknown as {
  list: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  stats: jest.Mock;
  get: jest.Mock;
};
const createEvents = createEventsClient as unknown as jest.Mock;
const eventsUrl = getEventsUrl as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures - factory functions returning FRESH objects on every call, so immer's
// auto-freeze (applied when the REAL reducer stores them) never contaminates a
// later load/refresh that re-reads the same fixture.
//
// SPRINT SEEDING for the `sprints[0].id` quirk: two OPEN sprints are returned in
// array order [A, B]. With "now" pinned to 2021-06-15 (see beforeEach), only
// Sprint B (2021-06-01..2021-06-30) brackets now, so `findCurrentSprint` picks
// B (id 20) while `sprints[0]` stays A (id 10). The move-to-sprint payload MUST
// therefore use milestone_id = 10 (sprints[0].id), NOT 20 (currentSprint.id).
// ---------------------------------------------------------------------------

const PROJECT_ID = 7;

function makeStats(): Record<string, unknown> {
  // total_points=20, closed_points=5 -> completedPercentage=round(100*5/20)=25;
  // both total_points & total_milestones present -> showGraphPlaceholder=false.
  return { total_points: 20, defined_points: 20, closed_points: 5, total_milestones: 2 };
}

function makeSprintA(): Record<string, unknown> {
  return {
    id: 10,
    name: 'Sprint A',
    project: PROJECT_ID,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-14', // does NOT bracket 2021-06-15 -> not current
    closed: false,
    total_points: 5,
    user_stories: [
      { id: 1, ref: 1, milestone: 10, project: PROJECT_ID, sprint_order: 0, backlog_order: 0, total_points: 2 },
    ],
  };
}

function makeSprintB(): Record<string, unknown> {
  return {
    id: 20,
    name: 'Sprint B',
    project: PROJECT_ID,
    estimated_start: '2021-06-01',
    estimated_finish: '2021-06-30', // brackets 2021-06-15 -> current sprint
    closed: false,
    total_points: 3,
    user_stories: [
      { id: 2, ref: 2, milestone: 20, project: PROJECT_ID, sprint_order: 0, backlog_order: 0, total_points: 1 },
    ],
  };
}

function makeClosedSprint(): Record<string, unknown> {
  return {
    id: 30,
    name: 'Closed Sprint',
    project: PROJECT_ID,
    estimated_start: '2020-01-01',
    estimated_finish: '2020-01-14',
    closed: true,
    total_points: 8,
    user_stories: [
      { id: 3, ref: 3, milestone: 30, project: PROJECT_ID, sprint_order: 0, backlog_order: 0, total_points: 8 },
    ],
  };
}

/** A backlog user story (milestone null). `sprint_order` feeds the move payload's `order`. */
function makeUs(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    ref: id,
    milestone: null,
    project: PROJECT_ID,
    backlog_order: 0,
    sprint_order: 0,
    total_points: 3,
    ...over,
  };
}

/**
 * Build a real `Headers` carrying the pagination/total/no-swimlane values the
 * hook parses in `loadUserstories`. Pass `null` for a key to OMIT it (so
 * `Headers.get(name)` returns `null`). Defaults: next-page present, total 20,
 * no-swimlane count 5.
 */
function makeHeaders(over: Record<string, string | null> = {}): Headers {
  const base: Record<string, string | null> = {
    'x-pagination-next': 'http://api/next',
    'Taiga-Info-Backlog-Total-Userstories': '20',
    'Taiga-Info-Userstories-Without-Swimlane': '5',
    ...over,
  };
  const headers = new Headers();
  Object.entries(base).forEach(([key, value]) => {
    if (value != null) {
      headers.set(key, value);
    }
  });
  return headers;
}

/** Shape the `getWithHeaders` resolution the hook consumes: `{ data, headers, status }`. */
function usResponse(
  data: Array<Record<string, unknown>>,
  headerOverrides: Record<string, string | null> = {},
): { data: Array<Record<string, unknown>>; headers: Headers; status: number } {
  return { data, headers: makeHeaders(headerOverrides), status: 200 };
}

// ---------------------------------------------------------------------------
// Async helpers (fake-timer safe). The mocked promises resolve on the microtask
// queue, which fake timers do NOT control, so microtasks are flushed explicitly
// inside `act`. The hook has NO internal timers, so microtask flushing alone
// settles every async chain (project resolve -> loadBacklog -> parallel loads).
// ---------------------------------------------------------------------------

/** Flush `rounds` microtask turns inside `act` (settles chained mocked promises). */
async function flush(rounds = 12): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  });
}

/**
 * Render the hook and settle the initial load chain until the project resolves
 * and the first sprint/user-story loads land. Uses a deterministic microtask
 * flush-loop (NOT `waitFor`) so it never depends on fake-timer advancement.
 * The return type is inferred as `RenderHookResult<UseBacklogResult, ...>`, so
 * `result.current.state` / `.actions` stay fully typed for the assertions.
 */
async function renderReady(
  params: UseBacklogParams = { projectSlug: 'p', projectId: PROJECT_ID },
) {
  const view = renderHook((props: UseBacklogParams) => useBacklog(props), { initialProps: params });
  // Settle project resolution first, then the parallel loadBacklog fan-out.
  for (let i = 0; i < 25 && view.result.current.state.project == null; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await flush(2);
  }
  await flush();
  return view;
}

/** Find a `subscribe` call by routing key (returns the `[key, cb, opts?]` tuple). */
function subscribeCall(key: string): unknown[] | undefined {
  return mockEventsClient.subscribe.mock.calls.find((call: unknown[]) => call[0] === key);
}

/** Retrieve the subscription callback the hook registered for a routing key. */
function getSubscribedCallback(key: string): () => void {
  const call = subscribeCall(key);
  if (!call) {
    throw new Error(`No subscription registered for routing key: ${key}`);
  }
  return call[1] as () => void;
}

/** Count `httpClient.get` calls issued for a given path (first positional arg). */
function countGet(path: string): number {
  return http.get.mock.calls.filter((call: unknown[]) => call[0] === path).length;
}

/** The most recent `getWithHeaders('userstories', params)` params object. */
function lastUserstoriesParams(): Record<string, unknown> {
  const calls = http.getWithHeaders.mock.calls.filter((call: unknown[]) => call[0] === 'userstories');
  const last = calls[calls.length - 1];
  if (!last) {
    throw new Error('No getWithHeaders("userstories", ...) call recorded');
  }
  return last[1] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared setup. Fake timers + a pinned system clock make `findCurrentSprint`
// (Date.now) and the create-form date seeding (moment()) deterministic. Mock
// call state is auto-cleared by `clearMocks: true`; implementations are (re)set
// here so each test starts from the documented happy-path baseline.
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2021-06-15T00:00:00Z'));

  // Events enabled by default (socket branch runs). Overridden to null in the
  // "events disabled" test.
  eventsUrl.mockReturnValue('ws://localhost/events');

  // `httpClient.get`: slug resolution + project stats; anything else -> null.
  http.get.mockImplementation((path: string) => {
    if (path === 'projects/by_slug') {
      return Promise.resolve({ id: PROJECT_ID, slug: 'p' });
    }
    if (/^projects\/\d+\/stats$/.test(path)) {
      return Promise.resolve(makeStats());
    }
    return Promise.resolve(null);
  });

  // Default backlog page: two stories, next-page present (so page advances to 2),
  // total 20, no-swimlane 5.
  http.getWithHeaders.mockResolvedValue(
    usResponse([makeUs(101, { backlog_order: 0 }), makeUs(102, { backlog_order: 1 })]),
  );

  // `milestones.list`: closed filter -> closed sprint; otherwise the two open
  // sprints [A(10), B(20)].
  ms.list.mockImplementation((_pid: number, filters?: { closed?: boolean }) => {
    if (filters && filters.closed) {
      return Promise.resolve({ milestones: [makeClosedSprint()], closed: 1, open: 2 });
    }
    return Promise.resolve({ milestones: [makeSprintA(), makeSprintB()], closed: 1, open: 2 });
  });
  ms.create.mockResolvedValue({ id: 99 });
  ms.save.mockResolvedValue({ id: 100 });
  ms.remove.mockResolvedValue(undefined);

  us.bulkUpdateMilestone.mockResolvedValue(null);
  us.bulkUpdateBacklogOrder.mockResolvedValue({ data: [] });

  // Fresh fake events client per test (connect/subscribe/unsubscribe/disconnect).
  mockEventsClient = {
    connect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
  };
  createEvents.mockReturnValue(mockEventsClient);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ===========================================================================
// Phase C - Initial load sequence (project resolve -> loadBacklog)
// ===========================================================================
describe('useBacklog - initial load & project resolution', () => {
  it('loads stats, open sprints, and the first user-story page on mount (explicit projectId)', async () => {
    const { result } = await renderReady();

    // stats: httpClient.get('projects/7/stats') - EXACT template-literal string.
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
    // open sprints: milestones.list(7, { closed: false }).
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    // backlog stories: getWithHeaders('userstories', { project:7, milestone:'null'(STRING), page:1, q:'' }).
    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({ project: 7, milestone: 'null', page: 1, q: '' }),
    );

    // Reducer state reflects the resolved project + seeded sprints.
    expect(result.current.state.project?.id).toBe(7);
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
  });

  it('seeds sprints[0] = Sprint A (10) while currentSprint = Sprint B (20)', async () => {
    // This is the setup that makes the move-to-sprint `milestone_id = sprints[0].id`
    // quirk provable: the array head (10) differs from the date-current sprint (20).
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    expect(result.current.state.sprints[0].id).toBe(10);
    expect(result.current.state.currentSprint?.id).toBe(20);
  });

  it('milestone param is the literal STRING "null" (not the null value)', async () => {
    await renderReady();
    const params = lastUserstoriesParams();
    expect(params.milestone).toBe('null');
    expect(typeof params.milestone).toBe('string');
  });

  it('resolves the project id from the slug via projects/by_slug when projectId is omitted', async () => {
    const { result } = await renderReady({ projectSlug: 'p' });
    // Slug resolution happens FIRST, then the id-keyed load sequence runs.
    expect(http.get).toHaveBeenCalledWith('projects/by_slug', { slug: 'p' });
    await waitFor(() => expect(result.current.state.project?.id).toBe(7));
    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({ project: 7, milestone: 'null' }),
    );
  });

  it('loadUserstories is a no-op when there is no resolvable project', async () => {
    eventsUrl.mockReturnValue(null); // avoid the socket branch for a clean, empty slate
    const { result } = renderHook(() => useBacklog({ projectSlug: '' }));
    await flush();
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(http.getWithHeaders).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Phase D - loadUserstories header parsing & pagination
// ===========================================================================
describe('useBacklog - header parsing & pagination', () => {
  it('parses total / no-swimlane / next-page headers into reducer state', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.totalUserStories).toBe(20));
    // count "5" -> truthy no-swimlane flag.
    expect(result.current.state.noSwimlaneUserStories).toBe(true);
    // `x-pagination-next` present -> reducer advanced the page beyond 1.
    expect(result.current.state.page).toBe(2);
    // visibleUserStories collects us.ref for the two loaded stories.
    expect(result.current.state.visibleUserStories).toEqual(expect.arrayContaining([101, 102]));
  });

  it('normalizes the no-swimlane header across absent / "0" / "true" / "false"', async () => {
    const { result } = await renderReady();

    // absent header -> null -> flag left UNCHANGED (stays true from the mount load).
    http.getWithHeaders.mockResolvedValueOnce(
      usResponse([], { 'Taiga-Info-Userstories-Without-Swimlane': null }),
    );
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(true);

    // count "0" -> false.
    http.getWithHeaders.mockResolvedValueOnce(
      usResponse([], { 'Taiga-Info-Userstories-Without-Swimlane': '0' }),
    );
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(false);

    // literal "true" -> true.
    http.getWithHeaders.mockResolvedValueOnce(
      usResponse([], { 'Taiga-Info-Userstories-Without-Swimlane': 'true' }),
    );
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(true);

    // literal "false" -> false.
    http.getWithHeaders.mockResolvedValueOnce(
      usResponse([], { 'Taiga-Info-Userstories-Without-Swimlane': 'false' }),
    );
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(false);
  });

  it('loadMoreUserstories requests the incremented page (2) and APPENDS the stories', async () => {
    const { result } = await renderReady();
    // After mount (next-page present) the reducer advanced `page` to 2.
    expect(result.current.state.page).toBe(2);
    const lengthAfterMount = result.current.state.userstories.length;

    http.getWithHeaders.mockClear();
    // Next page carries a fresh story and (this time) NO further next page.
    http.getWithHeaders.mockResolvedValueOnce(
      usResponse([makeUs(103, { backlog_order: 2 })], { 'x-pagination-next': null }),
    );
    await act(async () => {
      await result.current.actions.loadMoreUserstories();
    });

    // The follow-up request used the incremented page (2), NOT a reset to 1.
    expect(lastUserstoriesParams().page).toBe(2);
    // Append (not reset): the new story is added on top of the mount page.
    expect(result.current.state.userstories.length).toBe(lengthAfterMount + 1);
    expect(result.current.state.userstories.some((u) => u.id === 103)).toBe(true);
  });

  it('does not advance the page when the next-page header is absent', async () => {
    const { result } = await renderReady();
    const pageBefore = result.current.state.page; // 2 after mount
    http.getWithHeaders.mockResolvedValueOnce(usResponse([], { 'x-pagination-next': null }));
    await act(async () => {
      await result.current.actions.loadUserstories(false);
    });
    expect(result.current.state.page).toBe(pageBefore);
  });
});

// ===========================================================================
// Phase E - moveToCurrentSprint / moveToLatestSprint (bulkUpdateMilestone args)
//
// FROZEN-CONTRACT CRUX (verified main.coffee:799 / reducer applyMoveToSprint):
// the persisted `milestone_id` is ALWAYS `sprints[0].id`, EVEN for "move to
// current sprint" whose OPTIMISTIC target is `currentSprint`. Here sprints[0] is
// Sprint A (10) and currentSprint is Sprint B (20), so the payload MUST carry 10.
// ===========================================================================
describe('useBacklog - move to sprint (bulkUpdateMilestone contract)', () => {
  it('moveToCurrentSprint persists to sprints[0].id (10), NOT currentSprint.id (20)', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    // Sanity: the two ids genuinely differ, so the assertion below is meaningful.
    expect(result.current.state.sprints[0].id).toBe(10);
    expect(result.current.state.currentSprint?.id).toBe(20);

    act(() => {
      result.current.actions.setSelectedIds([101, 102]);
    });

    // Isolate the reconcile re-fetch from the mount loads.
    ms.list.mockClear();
    http.get.mockClear();

    await act(async () => {
      await result.current.actions.moveToCurrentSprint();
    });

    // ONE call, with (projectId, milestoneId=sprints[0].id, [{us_id, order}]).
    expect(us.bulkUpdateMilestone).toHaveBeenCalledTimes(1);
    const [projectId, milestoneId, bulkStories] = us.bulkUpdateMilestone.mock.calls[0];
    expect(projectId).toBe(7);
    expect(milestoneId).toBe(10); // sprints[0].id quirk - NOT currentSprint.id (20)
    // Byte-exact ordering payload: `{ us_id, order }` per story, in backlog order.
    expect(bulkStories).toStrictEqual([
      { us_id: 101, order: 0 },
      { us_id: 102, order: 0 },
    ]);

    // Optimistic reducer update (independent of the API result): the selection is
    // cleared and the moved stories left the backlog list.
    expect(result.current.state.selectedIds).toEqual([]);
    expect(result.current.state.userstories.some((u) => u.id === 101)).toBe(false);
    expect(result.current.state.userstories.some((u) => u.id === 102)).toBe(false);

    // On-success reconcile reload (main.coffee:800-801): sprints + project stats.
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
  });

  it('moveToLatestSprint accepts explicit usIds and also persists to sprints[0].id (10)', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));

    await act(async () => {
      await result.current.actions.moveToLatestSprint([101]);
    });

    expect(us.bulkUpdateMilestone).toHaveBeenCalledWith(7, 10, [{ us_id: 101, order: 0 }]);
  });

  it('is a no-op (no bulkUpdateMilestone) when there are no sprints', async () => {
    ms.list.mockResolvedValue({ milestones: [], closed: 0, open: 0 });
    const { result } = await renderReady();
    act(() => {
      result.current.actions.setSelectedIds([101]);
    });
    await act(async () => {
      await result.current.actions.moveToCurrentSprint();
    });
    expect(us.bulkUpdateMilestone).not.toHaveBeenCalled();
  });

  it('is a no-op when the selection is empty (producer returns null payload)', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    // No setSelectedIds -> selectedIds is [] -> the reducer producer yields a null
    // payload -> the hook returns before hitting the API.
    await act(async () => {
      await result.current.actions.moveToCurrentSprint();
    });
    expect(us.bulkUpdateMilestone).not.toHaveBeenCalled();
  });

  it('reconcileAfterMove reloads open sprints, closed sprints, and project stats', async () => {
    const { result } = await renderReady();
    ms.list.mockClear();
    http.get.mockClear();
    await act(async () => {
      await result.current.actions.reconcileAfterMove();
    });
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(ms.list).toHaveBeenCalledWith(7, { closed: true });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
  });
});

// ===========================================================================
// Phase F - applyDrag is a PURE dispatch (no API from the hook)
//
// The hook's applyDrag only dispatches APPLY_DRAG; the persistence call
// (userstories.bulkUpdateBacklogOrder) is owned by shared/dnd's drag-end
// handler, NOT the hook. Running the REAL reducer proves the move happened
// while the hook stayed out of the network.
// ===========================================================================
describe('useBacklog - applyDrag (dispatch-only boundary)', () => {
  it('moves a backlog story into a sprint via the real reducer, WITHOUT bulkUpdateBacklogOrder', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    expect(result.current.state.userstories.some((u) => u.id === 101)).toBe(true);

    const drag: BacklogDragResult = {
      movedIds: [101],
      targetSprintId: 10, // Sprint A (sprints[0])
      index: 0,
      previousUs: null,
      nextUs: null,
      isBacklog: false,
    };
    act(() => {
      result.current.actions.applyDrag(drag);
    });

    // Real reducer ran: 101 left the backlog and joined Sprint A (id 10).
    expect(result.current.state.userstories.some((u) => u.id === 101)).toBe(false);
    const sprintA = result.current.state.sprints.find((s) => s.id === 10);
    expect(sprintA?.user_stories.some((u) => u.id === 101)).toBe(true);

    // hook applyDrag = dispatch APPLY_DRAG only; bulkUpdateBacklogOrder owned by shared/dnd
    expect(us.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
  });

  it('reorders within the backlog (same-container) with no API call', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.userstories).toHaveLength(2));
    expect(result.current.state.userstories.map((u) => u.id)).toEqual([101, 102]);

    // Drag 102 to the head of the backlog (previousUs null, nextUs 101).
    const drag: BacklogDragResult = {
      movedIds: [102],
      targetSprintId: null, // backlog
      index: 0,
      previousUs: null,
      nextUs: 101,
      isBacklog: true,
    };
    act(() => {
      result.current.actions.applyDrag(drag);
    });

    // Both stories stay in the backlog, now [102, 101] (head insert per source).
    expect(result.current.state.userstories.map((u) => u.id)).toEqual([102, 101]);
    // hook applyDrag = dispatch APPLY_DRAG only; bulkUpdateBacklogOrder owned by shared/dnd
    expect(us.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Phase G - sprint form open / close / submit-create / submit-edit / remove
//
// The hook seeds CREATE-mode dates via the real reducer's
// `buildCreateSprintDefaults` (base = last open sprint's finish, else today;
// +2 weeks). `submitSprintForm` maps to milestones.create / milestones.save;
// `removeSprint` maps to milestones.remove and reloads (+closed only when the
// removed sprint was closed). Date seeding is deterministic via the pinned
// system clock (2021-06-15).
// ===========================================================================
describe('useBacklog - sprint form', () => {
  it('openSprintForm("create") seeds defaults from the last open sprint (Sprint B finish + 2 weeks)', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));

    act(() => {
      result.current.actions.openSprintForm('create');
    });

    const form = result.current.state.sprintForm;
    expect(form.open).toBe(true);
    expect(form.mode).toBe('create');
    expect(form.values.project).toBe(7);
    expect(form.values.name).toBeNull();
    // base = last OPEN sprint's estimated_finish (Sprint B = 2021-06-30); +2 weeks.
    expect(form.values.estimated_start).toBe('2021-06-30');
    expect(form.values.estimated_finish).toBe('2021-07-14');
    expect(form.lastSprintName).toBe('Sprint B');
    expect(form.canDelete).toBe(false);
  });

  it('openSprintForm("create") with NO sprints seeds from today (pinned 2021-06-15) + 2 weeks', async () => {
    ms.list.mockResolvedValue({ milestones: [], closed: 0, open: 0 });
    const { result } = await renderReady();

    act(() => {
      result.current.actions.openSprintForm('create');
    });

    const form = result.current.state.sprintForm;
    expect(form.values.estimated_start).toBe('2021-06-15'); // moment().format(YYYY-MM-DD)
    expect(form.values.estimated_finish).toBe('2021-06-29'); // + 2 weeks
    expect(form.lastSprintName).toBeNull();
  });

  it('openSprintForm("edit", sprint) opens edit mode with canDelete=true and the sprint values', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    const sprintToEdit = result.current.state.sprints[0]; // Sprint A (typed Sprint)

    act(() => {
      result.current.actions.openSprintForm('edit', sprintToEdit);
    });

    const form = result.current.state.sprintForm;
    expect(form.open).toBe(true);
    expect(form.mode).toBe('edit');
    expect(form.values.id).toBe(10);
    expect(form.values.name).toBe('Sprint A');
    expect(form.values.estimated_start).toBe('2021-01-01');
    expect(form.values.estimated_finish).toBe('2021-01-14');
    expect(form.canDelete).toBe(true);
  });

  it('closeSprintForm resets the form to closed/default', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.openSprintForm('create');
    });
    expect(result.current.state.sprintForm.open).toBe(true);
    act(() => {
      result.current.actions.closeSprintForm();
    });
    expect(result.current.state.sprintForm.open).toBe(false);
    expect(result.current.state.sprintForm.values.name).toBeNull();
  });

  it('submitSprintForm(create) calls milestones.create, closes the form, and reloads', async () => {
    const { result } = await renderReady();
    ms.list.mockClear();
    http.get.mockClear();

    const values = {
      project: 7,
      name: 'New Sprint',
      estimated_start: '2021-07-01',
      estimated_finish: '2021-07-15',
    };
    await act(async () => {
      await result.current.actions.submitSprintForm(values, 'create');
    });

    // project comes from the resolved id ref, not the form value.
    expect(ms.create).toHaveBeenCalledWith({
      project: 7,
      name: 'New Sprint',
      estimated_start: '2021-07-01',
      estimated_finish: '2021-07-15',
    });
    expect(result.current.state.sprintForm.open).toBe(false);
    // Post-success reload (sprints + project stats).
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
  });

  it('submitSprintForm(edit, id) calls milestones.save(id, {name, dates}) WITHOUT project', async () => {
    const { result } = await renderReady();

    const values = {
      project: 7,
      name: 'Edited Sprint',
      estimated_start: '2021-06-01',
      estimated_finish: '2021-06-30',
      id: 20,
    };
    await act(async () => {
      await result.current.actions.submitSprintForm(values, 'edit', 20);
    });

    expect(ms.save).toHaveBeenCalledWith(20, {
      name: 'Edited Sprint',
      estimated_start: '2021-06-01',
      estimated_finish: '2021-06-30',
    });
    expect(result.current.state.sprintForm.open).toBe(false);
  });

  it('removeSprint(openId) removes then reloads sprints + stats + userstories (NOT closed)', async () => {
    const { result } = await renderReady();
    ms.remove.mockClear();
    ms.list.mockClear();
    http.get.mockClear();
    http.getWithHeaders.mockClear();

    await act(async () => {
      await result.current.actions.removeSprint(20); // Sprint B - open
    });

    expect(ms.remove).toHaveBeenCalledWith(20);
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
    expect(http.getWithHeaders).toHaveBeenCalledWith('userstories', expect.objectContaining({ project: 7 }));
    // wasClosed=false -> closed sprints are NOT reloaded.
    expect(ms.list).not.toHaveBeenCalledWith(7, { closed: true });
  });

  it('removeSprint(closedId) ALSO reloads closed sprints (wasClosed=true)', async () => {
    const { result } = await renderReady();
    // Make the closed sprint (id 30) visible/loaded so `wasClosed` is true.
    await act(async () => {
      await result.current.actions.toggleClosedSprints();
    });
    await waitFor(() => expect(result.current.state.closedSprints.length).toBe(1));
    ms.remove.mockClear();
    ms.list.mockClear();

    await act(async () => {
      await result.current.actions.removeSprint(30); // Closed Sprint
    });

    expect(ms.remove).toHaveBeenCalledWith(30);
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(ms.list).toHaveBeenCalledWith(7, { closed: true }); // wasClosed -> reload closed
  });
});

// ===========================================================================
// Phase H - WebSocket subscribe / unsubscribe (selfNotification parity - CRITICAL)
//
// FROZEN-CONTRACT CRUX #2 (verified main.coffee:234): the MILESTONES subscription
// carries `{ selfNotification: true }`, while the USERSTORIES subscription carries
// NO options. Both routing keys use the real `changes.project.{id}.*` builders.
// The hook has NO debounce (grep confirms zero setTimeout/setInterval), so WS
// callbacks refresh SYNCHRONOUSLY - the tests invoke the recorded callback and
// flush microtasks (there is no timer window to advance).
// ===========================================================================
describe('useBacklog - WebSocket subscriptions', () => {
  it('connects and subscribes: userstories (no options) + milestones ({selfNotification:true})', async () => {
    await renderReady();

    expect(createEvents).toHaveBeenCalledTimes(1);
    expect(mockEventsClient.connect).toHaveBeenCalledTimes(1);

    // Real routing keys (requireActual) - byte-exact format.
    expect(routingKeys.userstories(7)).toBe('changes.project.7.userstories');
    expect(routingKeys.milestones(7)).toBe('changes.project.7.milestones');

    const usCall = subscribeCall('changes.project.7.userstories');
    const msCall = subscribeCall('changes.project.7.milestones');
    expect(usCall).toBeDefined();
    expect(msCall).toBeDefined();

    // userstories sub: NO selfNotification (third arg absent).
    expect(usCall?.[2]).toBeUndefined();
    // milestones sub: EXACTLY { selfNotification: true } (main.coffee:234).
    expect(msCall?.[2]).toStrictEqual({ selfNotification: true });
  });

  it('userstories WS message reloads userstories + open sprints (synchronous, no debounce)', async () => {
    await renderReady();
    http.getWithHeaders.mockClear();
    ms.list.mockClear();

    const cb = getSubscribedCallback('changes.project.7.userstories');
    // adjusted per useBacklog.ts on disk: WS callbacks refresh synchronously (no debounce)
    await act(async () => {
      cb();
      await Promise.resolve();
    });
    await flush();

    expect(http.getWithHeaders).toHaveBeenCalledWith('userstories', expect.objectContaining({ project: 7 }));
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
  });

  it('milestones WS message reloads open sprints + closed sprints + project stats', async () => {
    await renderReady();
    ms.list.mockClear();
    http.get.mockClear();

    const cb = getSubscribedCallback('changes.project.7.milestones');
    await act(async () => {
      cb();
      await Promise.resolve();
    });
    await flush();

    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(ms.list).toHaveBeenCalledWith(7, { closed: true });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
  });

  it('does NOT open a socket when events are disabled (getEventsUrl null)', async () => {
    eventsUrl.mockReturnValue(null);
    // getEventsUrl null -> events disabled, no socket
    await renderReady();
    expect(createEvents).not.toHaveBeenCalled();
    expect(mockEventsClient.subscribe).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Phase I - unmount teardown (no leaks) + state dispatchers (coverage)
// ===========================================================================
describe('useBacklog - unmount teardown', () => {
  it('unsubscribes both routing keys and disconnects exactly once on unmount', async () => {
    const { unmount } = await renderReady();
    expect(mockEventsClient.subscribe).toHaveBeenCalledTimes(2);

    act(() => {
      unmount();
    });

    // unmount -> unsubscribe x2 + disconnect (route change / disconnectedCallback parity)
    expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith('changes.project.7.userstories');
    expect(mockEventsClient.unsubscribe).toHaveBeenCalledWith('changes.project.7.milestones');
    expect(mockEventsClient.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('useBacklog - toggles, filters & selection dispatchers', () => {
  it('setFilter dispatches SET_FILTERS and reloads userstories from page 1 with q', async () => {
    const { result } = await renderReady();
    http.getWithHeaders.mockClear();

    act(() => {
      result.current.actions.setFilter({ query: 'bug' });
    });
    await flush();

    expect(result.current.state.filters.query).toBe('bug');
    const params = lastUserstoriesParams();
    expect(params.page).toBe(1);
    expect(params.q).toBe('bug');
  });

  it('toggleShowTags flips showTags (default true -> false)', async () => {
    const { result } = await renderReady();
    expect(result.current.state.showTags).toBe(true);
    act(() => {
      result.current.actions.toggleShowTags();
    });
    expect(result.current.state.showTags).toBe(false);
  });

  it('toggleActiveFilters flips activeFilters (default false -> true)', async () => {
    const { result } = await renderReady();
    expect(result.current.state.activeFilters).toBe(false);
    act(() => {
      result.current.actions.toggleActiveFilters();
    });
    expect(result.current.state.activeFilters).toBe(true);
  });

  it('toggleVelocityForecasting flips displayVelocity (default false -> true)', async () => {
    const { result } = await renderReady();
    expect(result.current.state.displayVelocity).toBe(false);
    act(() => {
      result.current.actions.toggleVelocityForecasting();
    });
    expect(result.current.state.displayVelocity).toBe(true);
  });

  it('setSelectedIds updates the multi-selection set', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.setSelectedIds([101, 102]);
    });
    expect(result.current.state.selectedIds).toEqual([101, 102]);
  });

  it('toggleSprintFold flips the per-sprint fold flag (sprintOpen map)', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(2));
    const before = result.current.state.sprintOpen[10];
    act(() => {
      result.current.actions.toggleSprintFold(10);
    });
    expect(result.current.state.sprintOpen[10]).toBe(!before);
  });

  it('toggleClosedSprints lazily loads closed sprints on first reveal, unload clears them', async () => {
    const { result } = await renderReady();
    expect(result.current.state.closedSprintsVisible).toBe(false);
    expect(result.current.state.closedSprints).toHaveLength(0);

    await act(async () => {
      await result.current.actions.toggleClosedSprints();
    });
    await waitFor(() => expect(result.current.state.closedSprints).toHaveLength(1));
    expect(result.current.state.closedSprintsVisible).toBe(true);
    expect(ms.list).toHaveBeenCalledWith(7, { closed: true });

    act(() => {
      result.current.actions.unloadClosedSprints();
    });
    expect(result.current.state.closedSprints).toHaveLength(0);
  });
});
