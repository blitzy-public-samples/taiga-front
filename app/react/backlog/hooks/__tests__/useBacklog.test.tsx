/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link useBacklog} — the effectful/data-layer hook that
 * reproduces the AngularJS `BacklogController` (`app/coffee/modules/backlog/
 * main.coffee`) on React. These are the specs "counted toward the 70% line
 * coverage gate" for the hook (AAP 0.7 / 0.2.1).
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): fully browserless — Jest + jsdom + React
 * Testing Library ONLY. NO Playwright, NO real browser, NO network. Every
 * side-effecting dependency (the `/api/v1/` REST adapters, the WebSocket events
 * client, and the config accessor) is `jest.mock`-ed; the PURE reducer
 * (`../state/backlogReducer`) is kept REAL so the hook<->reducer integration is
 * exercised end-to-end.
 *
 * The assertions target the load-bearing parity behaviors the hook owns:
 *  - HTTP response-header parsing -> `SET_USERSTORIES` opts (hasNext -> page++,
 *    total, no-swimlane), which the pure reducer never sees;
 *  - the two DISTINCT bulk paths: DRAG (optimistic `applyDrag`, NO API) vs the
 *    toolbar "move to sprint" (owns `bulkUpdateMilestone` with the `sprints[0].id`
 *    quirk and the `{ us_id, order }` payload);
 *  - the WebSocket subscriptions: milestones WITH `{ selfNotification: true }`,
 *    userstories WITHOUT, with unsubscribe + disconnect on cleanup.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import httpClient from '../../../shared/api/httpClient';
import userstories from '../../../shared/api/userstories';
import milestones from '../../../shared/api/milestones';
import { createEventsClient } from '../../../shared/events/eventsClient';
import { getEventsUrl } from '../../../shared/config';

import { useBacklog } from '../useBacklog';
import type { UseBacklogParams, BacklogDragResult } from '../useBacklog';

// ---------------------------------------------------------------------------
// Mock the globals-only interop layer; keep the reducer REAL.
// ---------------------------------------------------------------------------
jest.mock('../../../shared/api/httpClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), getWithHeaders: jest.fn() },
}));
jest.mock('../../../shared/api/userstories', () => ({
  __esModule: true,
  default: { bulkUpdateMilestone: jest.fn() },
}));
jest.mock('../../../shared/api/milestones', () => ({
  __esModule: true,
  default: { list: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() },
}));
jest.mock('../../../shared/events/eventsClient', () => ({
  __esModule: true,
  createEventsClient: jest.fn(),
  routingKeys: {
    userstories: (id: number | string): string => `changes.project.${id}.userstories`,
    milestones: (id: number | string): string => `changes.project.${id}.milestones`,
    projects: (id: number | string): string => `changes.project.${id}.projects`,
  },
}));
jest.mock('../../../shared/config', () => ({
  __esModule: true,
  getEventsUrl: jest.fn(),
}));

// Strict-safe typed handles onto the mocked members the hook actually uses.
const http = httpClient as unknown as { get: jest.Mock; getWithHeaders: jest.Mock };
const us = userstories as unknown as { bulkUpdateMilestone: jest.Mock };
const ms = milestones as unknown as {
  list: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
};
const createEvents = createEventsClient as unknown as jest.Mock;
const eventsUrl = getEventsUrl as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures (plain runtime objects; the mocks are untyped so no friction).
// ---------------------------------------------------------------------------
function makeSprint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    name: 'Sprint 1',
    project: 7,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-14',
    closed: false,
    total_points: 5,
    user_stories: [{ id: 1, ref: 1, sprint_order: 0, total_points: 2 }],
    ...over,
  };
}
function makeUserStory(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 10, ref: 10, backlog_order: 0, sprint_order: 0, total_points: 3, ...over };
}
function makeStats(): Record<string, unknown> {
  return { total_points: 20, defined_points: 20, closed_points: 5, total_milestones: 2 };
}
/** Build a `Headers` with the pagination/total/no-swimlane values (overridable). */
function makeHeaders(over: Record<string, string | null> = {}): Headers {
  const base: Record<string, string | null> = {
    'x-pagination-next': 'http://api/next',
    'Taiga-Info-Backlog-Total-Userstories': '42',
    'Taiga-Info-Userstories-Without-Swimlane': '3',
    ...over,
  };
  const h = new Headers();
  Object.entries(base).forEach(([k, v]) => {
    if (v != null) {
      h.set(k, v);
    }
  });
  return h;
}

interface EventsClientMock {
  connect: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  disconnect: jest.Mock;
}
let eventsClientMock: EventsClientMock;

beforeEach(() => {
  eventsUrl.mockReturnValue('ws://events/');

  http.get.mockImplementation((path: string) => {
    if (path === 'projects/by_slug') {
      return Promise.resolve({ id: 7, slug: 'proj' });
    }
    if (/^projects\/\d+\/stats$/.test(path)) {
      return Promise.resolve(makeStats());
    }
    return Promise.resolve(null);
  });
  http.getWithHeaders.mockResolvedValue({ data: [makeUserStory()], headers: makeHeaders(), status: 200 });

  ms.list.mockResolvedValue({ milestones: [makeSprint()], closed: 1, open: 2 });
  ms.create.mockResolvedValue({ id: 101 });
  ms.save.mockResolvedValue({ id: 100 });
  ms.remove.mockResolvedValue(undefined);

  us.bulkUpdateMilestone.mockResolvedValue(null);

  eventsClientMock = {
    connect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
  };
  createEvents.mockReturnValue(eventsClientMock);

  // Reset the jsdom URL + storage so the Phase 10 URL/localStorage filter
  // hydration starts clean on every spec (the hook now restores filters from
  // `window.location.search` / `localStorage` in its useReducer initializer).
  try {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
  } catch {
    /* jsdom - safe to ignore */
  }
});

/** Render the hook and wait for the initial `loadBacklog` to resolve the project. */
async function renderReady(params: UseBacklogParams = { projectSlug: 'proj', projectId: 7 }) {
  const view = renderHook((p: UseBacklogParams) => useBacklog(p), { initialProps: params });
  await waitFor(() => expect(view.result.current.state.project).not.toBeNull());
  return view;
}

/** Find a subscribe call by routing key (returns the [key, cb, opts?] tuple). */
function subscribeCall(key: string): unknown[] | undefined {
  return eventsClientMock.subscribe.mock.calls.find((c: unknown[]) => c[0] === key);
}

describe('useBacklog — initial load & header parsing', () => {
  it('loads stats, sprints, and the first user-story page on mount', async () => {
    const { result } = await renderReady();
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({ project: 7, milestone: 'null', page: 1, q: '' }),
    );
    expect(result.current.state.project?.id).toBe(7);
    // SET_SPRINTS dispatches one microtask after SET_PROJECT (once ms.list
    // resolves), so wait for the sprint list to settle.
    await waitFor(() => expect(result.current.state.sprints).toHaveLength(1));
  });

  it('parses pagination/total/no-swimlane headers into reducer state', async () => {
    const { result } = await renderReady();
    await waitFor(() => expect(result.current.state.totalUserStories).toBe(42));
    // `x-pagination-next` present -> page advanced beyond 1
    expect(result.current.state.page).toBeGreaterThan(1);
    // count "3" -> truthy no-swimlane flag
    expect(result.current.state.noSwimlaneUserStories).toBe(true);
  });

  it('normalizes the no-swimlane header across absent/0/true/false forms', async () => {
    const { result } = await renderReady();

    // absent header -> null -> flag unchanged (stays true from the mount load)
    http.getWithHeaders.mockResolvedValueOnce({
      data: [],
      headers: makeHeaders({ 'Taiga-Info-Userstories-Without-Swimlane': null }),
      status: 200,
    });
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(true);

    // count "0" -> false
    http.getWithHeaders.mockResolvedValueOnce({
      data: [],
      headers: makeHeaders({ 'Taiga-Info-Userstories-Without-Swimlane': '0' }),
      status: 200,
    });
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(false);

    // literal "true" -> true
    http.getWithHeaders.mockResolvedValueOnce({
      data: [],
      headers: makeHeaders({ 'Taiga-Info-Userstories-Without-Swimlane': 'true' }),
      status: 200,
    });
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(true);

    // literal "false" -> false
    http.getWithHeaders.mockResolvedValueOnce({
      data: [],
      headers: makeHeaders({ 'Taiga-Info-Userstories-Without-Swimlane': 'false' }),
      status: 200,
    });
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(result.current.state.noSwimlaneUserStories).toBe(false);
  });

  it('resolves the project id from the slug when projectId is omitted', async () => {
    const { result } = await renderReady({ projectSlug: 'proj' });
    expect(http.get).toHaveBeenCalledWith('projects/by_slug', { slug: 'proj' });
    await waitFor(() => expect(result.current.state.project?.id).toBe(7));
  });

  it('loadUserstories is a no-op when there is no resolvable project', async () => {
    eventsUrl.mockReturnValue(null); // avoid the socket branch
    const { result } = renderHook(() => useBacklog({ projectSlug: '' }));
    await act(async () => {
      await result.current.actions.loadUserstories(true);
    });
    expect(http.getWithHeaders).not.toHaveBeenCalled();
  });
});

describe('useBacklog — move flows', () => {
  it('applyDrag applies the optimistic reorder WITHOUT calling any API', async () => {
    const { result } = await renderReady();
    const drag: BacklogDragResult = {
      movedIds: [10],
      targetSprintId: null,
      index: 0,
      previousUs: null,
      nextUs: null,
      isBacklog: true,
    };
    act(() => {
      result.current.actions.applyDrag(drag);
    });
    expect(us.bulkUpdateMilestone).not.toHaveBeenCalled();
    expect(result.current.state).toBeDefined();
  });

  it('moveToCurrentSprint persists to sprints[0].id with a {us_id, order} payload', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.setSelectedIds([10]);
    });
    await act(async () => {
      await result.current.actions.moveToCurrentSprint();
    });
    expect(us.bulkUpdateMilestone).toHaveBeenCalledTimes(1);
    const [pid, milestoneId, bulk] = us.bulkUpdateMilestone.mock.calls[0];
    expect(pid).toBe(7);
    expect(milestoneId).toBe(100); // sprints[0].id quirk
    expect(bulk).toEqual([{ us_id: 10, order: 0 }]);
  });

  it('moveToLatestSprint accepts explicit usIds and persists to sprints[0].id', async () => {
    const { result } = await renderReady();
    await act(async () => {
      await result.current.actions.moveToLatestSprint([10]);
    });
    expect(us.bulkUpdateMilestone).toHaveBeenCalledWith(7, 100, [{ us_id: 10, order: 0 }]);
  });

  it('moveToCurrentSprint is a no-op when there are no sprints', async () => {
    ms.list.mockResolvedValue({ milestones: [], closed: 0, open: 0 });
    const { result } = await renderReady();
    act(() => {
      result.current.actions.setSelectedIds([10]);
    });
    await act(async () => {
      await result.current.actions.moveToCurrentSprint();
    });
    expect(us.bulkUpdateMilestone).not.toHaveBeenCalled();
  });

  it('reconcileAfterMove reloads sprints, closed sprints, and project stats', async () => {
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

describe('useBacklog — WebSocket subscriptions', () => {
  it('subscribes with the selfNotification parity and cleans up on unmount', async () => {
    const view = await renderReady();
    await waitFor(() => expect(createEvents).toHaveBeenCalled());
    expect(eventsClientMock.connect).toHaveBeenCalled();

    // milestones WITH { selfNotification: true }
    expect(eventsClientMock.subscribe).toHaveBeenCalledWith(
      'changes.project.7.milestones',
      expect.any(Function),
      { selfNotification: true },
    );
    // userstories WITHOUT the option (2-arg call)
    const usCall = subscribeCall('changes.project.7.userstories');
    expect(usCall).toBeDefined();
    expect(usCall && usCall[2]).toBeUndefined();

    view.unmount();
    expect(eventsClientMock.unsubscribe).toHaveBeenCalledWith('changes.project.7.userstories');
    expect(eventsClientMock.unsubscribe).toHaveBeenCalledWith('changes.project.7.milestones');
    expect(eventsClientMock.disconnect).toHaveBeenCalled();
  });

  it('event callbacks trigger the expected reloads', async () => {
    await renderReady();
    await waitFor(() => expect(eventsClientMock.subscribe).toHaveBeenCalledTimes(2));
    const usCb = subscribeCall('changes.project.7.userstories')?.[1] as () => void;
    const msCb = subscribeCall('changes.project.7.milestones')?.[1] as () => void;

    http.getWithHeaders.mockClear();
    await act(async () => {
      usCb();
      await Promise.resolve();
    });
    await waitFor(() => expect(http.getWithHeaders).toHaveBeenCalled());

    ms.list.mockClear();
    await act(async () => {
      msCb();
      await Promise.resolve();
    });
    await waitFor(() => expect(ms.list).toHaveBeenCalled());
  });

  it('does not open a socket when events are disabled', async () => {
    eventsUrl.mockReturnValue(null);
    await renderReady();
    expect(createEvents).not.toHaveBeenCalled();
  });
});

describe('useBacklog — sprint form', () => {
  it('submitSprintForm(create) posts a milestone and reloads', async () => {
    const { result } = await renderReady();
    ms.list.mockClear();
    await act(async () => {
      await result.current.actions.submitSprintForm(
        { project: 7, name: 'New', estimated_start: '2021-02-01', estimated_finish: '2021-02-14' },
        'create',
      );
    });
    expect(ms.create).toHaveBeenCalledWith({
      project: 7,
      name: 'New',
      estimated_start: '2021-02-01',
      estimated_finish: '2021-02-14',
    });
    expect(ms.list).toHaveBeenCalled();
  });

  it('submitSprintForm(edit) saves the milestone by id', async () => {
    const { result } = await renderReady();
    await act(async () => {
      await result.current.actions.submitSprintForm(
        {
          project: 7,
          name: 'Renamed',
          estimated_start: '2021-02-01',
          estimated_finish: '2021-02-14',
          id: 100,
        },
        'edit',
        100,
      );
    });
    expect(ms.save).toHaveBeenCalledWith(100, {
      name: 'Renamed',
      estimated_start: '2021-02-01',
      estimated_finish: '2021-02-14',
    });
  });

  it('removeSprint deletes the milestone and reloads the backlog', async () => {
    const { result } = await renderReady();
    http.getWithHeaders.mockClear();
    await act(async () => {
      await result.current.actions.removeSprint(100);
    });
    expect(ms.remove).toHaveBeenCalledWith(100);
    expect(http.getWithHeaders).toHaveBeenCalled();
  });

  it('openSprintForm(create) opens the form; closeSprintForm resets it', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.openSprintForm('create');
    });
    expect(result.current.state.sprintForm.open).toBe(true);
    expect(result.current.state.sprintForm.mode).toBe('create');
    act(() => {
      result.current.actions.closeSprintForm();
    });
    expect(result.current.state.sprintForm.open).toBe(false);
  });

  it('openSprintForm(edit) opens with the sprint and canDelete=true', async () => {
    const { result } = await renderReady();
    const sprint = result.current.state.sprints[0];
    act(() => {
      result.current.actions.openSprintForm('edit', sprint);
    });
    expect(result.current.state.sprintForm.open).toBe(true);
    expect(result.current.state.sprintForm.mode).toBe('edit');
    expect(result.current.state.sprintForm.canDelete).toBe(true);
  });
});

describe('useBacklog — filters, toggles, selection, closed sprints', () => {
  it('setFilter updates the query and reloads the user stories', async () => {
    const { result } = await renderReady();
    http.getWithHeaders.mockClear();
    await act(async () => {
      result.current.actions.setFilter({ query: 'bug' });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(http.getWithHeaders).toHaveBeenCalledWith(
        'userstories',
        expect.objectContaining({ q: 'bug' }),
      ),
    );
  });

  it('view toggles and selection update reducer state', async () => {
    const { result } = await renderReady();

    const initTags = result.current.state.showTags;
    act(() => {
      result.current.actions.toggleShowTags();
    });
    expect(result.current.state.showTags).toBe(!initTags);

    act(() => {
      result.current.actions.toggleActiveFilters();
    });
    expect(result.current.state.activeFilters).toBe(true);

    const initVel = result.current.state.displayVelocity;
    act(() => {
      result.current.actions.toggleVelocityForecasting();
    });
    expect(result.current.state.displayVelocity).toBe(!initVel);

    act(() => {
      result.current.actions.setSelectedIds([10, 11]);
    });
    expect(result.current.state.selectedIds).toEqual([10, 11]);

    act(() => {
      result.current.actions.toggleSprintFold(100);
    });
    expect(typeof result.current.state.sprintOpen[100]).toBe('boolean');
  });

  it('toggleClosedSprints loads the closed sprints on first reveal', async () => {
    const { result } = await renderReady();
    ms.list.mockClear();
    await act(async () => {
      await result.current.actions.toggleClosedSprints();
    });
    expect(result.current.state.closedSprintsVisible).toBe(true);
    expect(ms.list).toHaveBeenCalledWith(7, { closed: true });
  });

  it('loadClosedSprints then unloadClosedSprints clears them', async () => {
    const { result } = await renderReady();
    await act(async () => {
      await result.current.actions.loadClosedSprints();
    });
    expect(result.current.state.closedSprints.length).toBeGreaterThan(0);
    act(() => {
      result.current.actions.unloadClosedSprints();
    });
    expect(result.current.state.closedSprints).toEqual([]);
  });

  it('loadMoreUserstories fetches the next page', async () => {
    const { result } = await renderReady();
    http.getWithHeaders.mockClear();
    await act(async () => {
      await result.current.actions.loadMoreUserstories();
    });
    expect(http.getWithHeaders).toHaveBeenCalled();
  });

  it('loadProjectStats and loadSprints can be invoked directly', async () => {
    const { result } = await renderReady();
    http.get.mockClear();
    ms.list.mockClear();
    await act(async () => {
      await result.current.actions.loadProjectStats();
      await result.current.actions.loadSprints();
    });
    expect(http.get).toHaveBeenCalledWith('projects/7/stats');
    expect(ms.list).toHaveBeenCalledWith(7, { closed: false });
  });

  it('exposes a stable (memoized) actions object across renders', async () => {
    const { result, rerender } = await renderReady();
    const first = result.current.actions;
    rerender({ projectSlug: 'proj', projectId: 7 });
    expect(result.current.actions).toBe(first);
  });
});

/* ------------------------------------------------------------------ *
 * Phase 10 — filter restore from the URL / localStorage on mount
 * ------------------------------------------------------------------ *
 * The hook hydrates its filter model in the `useReducer` initializer, so the
 * FIRST `loadBacklog` already issues the restored, filtered `/userstories`
 * query — reproducing `applyStoredFilters` running before `loadInitialData` on
 * the AngularJS side. URL wins over localStorage (the legacy "if
 * _.isEmpty(location.search())" guard).
 */
describe('Phase 10: filter restore on mount', () => {
  it('restores applied filters + q from window.location.search into the initial query', async () => {
    window.history.replaceState(null, '', '/project/proj/backlog?status=13,14&exclude_tags=foo&q=needle');
    const { result } = await renderReady();

    // The initial user-story load carries the hydrated filter params + q.
    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({
        project: 7,
        milestone: 'null',
        status: '13,14',
        exclude_tags: 'foo',
        q: 'needle',
      }),
    );
    // The reducer filter model reflects the restored chips + query.
    const selected = result.current.state.filters.selected as Array<Record<string, unknown>>;
    expect(selected).toEqual([
      { id: '13', name: '13', dataType: 'status', mode: 'include', color: null },
      { id: '14', name: '14', dataType: 'status', mode: 'include', color: null },
      { id: 'foo', name: 'foo', dataType: 'tags', mode: 'exclude', color: null },
    ]);
    expect(result.current.state.filters.query).toBe('needle');
  });

  it('falls back to localStorage when the URL has no managed params', async () => {
    window.localStorage.setItem(
      'proj:backlog-filters',
      JSON.stringify([{ id: '13', name: 'New', dataType: 'status', mode: 'include', color: null }]),
    );
    window.history.replaceState(null, '', '/project/proj/backlog');
    const { result } = await renderReady();

    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({ project: 7, status: '13' }),
    );
    const selected = result.current.state.filters.selected as Array<Record<string, unknown>>;
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ id: '13', dataType: 'status', mode: 'include' });
  });

  it('starts with empty filters when neither the URL nor localStorage carry any', async () => {
    window.history.replaceState(null, '', '/project/proj/backlog');
    const { result } = await renderReady();
    expect(result.current.state.filters.selected).toEqual([]);
    expect(result.current.state.filters.query).toBe('');
    expect(http.getWithHeaders).toHaveBeenCalledWith(
      'userstories',
      expect.objectContaining({ project: 7, q: '' }),
    );
  });
});

describe('useBacklog — optimistic-move rollback + save-failure (QA BL-1/BL-2)', () => {
  const drag: BacklogDragResult = {
    movedIds: [10],
    targetSprintId: null,
    index: 0,
    previousUs: null,
    nextUs: null,
    isBacklog: true,
  };

  it('starts with a null writeError', async () => {
    const { result } = await renderReady();
    expect(result.current.writeError).toBeNull();
  });

  it('onDragError surfaces the failure and clearWriteError dismisses it', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.onDragError(new Error('save failed'));
    });
    expect(result.current.writeError).toBeInstanceOf(Error);
    expect(result.current.writeError?.message).toBe('save failed');
    act(() => {
      result.current.actions.clearWriteError();
    });
    expect(result.current.writeError).toBeNull();
  });

  it('onDragError wraps a non-Error rejection value in an Error', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.onDragError('boom');
    });
    expect(result.current.writeError).toBeInstanceOf(Error);
    expect(result.current.writeError?.message).toBe('boom');
  });

  it('applyDrag clears a stale writeError at the start of a fresh move', async () => {
    const { result } = await renderReady();
    act(() => {
      result.current.actions.onDragError(new Error('previous failure'));
    });
    expect(result.current.writeError).not.toBeNull();
    act(() => {
      result.current.actions.applyDrag(drag);
    });
    expect(result.current.writeError).toBeNull();
  });

  it('onDragError after applyDrag restores the pre-move snapshot (rollback)', async () => {
    const { result } = await renderReady();
    const before = result.current.state;
    act(() => {
      result.current.actions.applyDrag(drag);
    });
    act(() => {
      result.current.actions.onDragError(new Error('bulk_update_backlog_order 400'));
    });
    // RESTORE_STATE returns the exact pre-move snapshot captured by applyDrag,
    // so the board reconverges with the unchanged server state.
    expect(result.current.state).toEqual(before);
    expect(result.current.writeError).toBeInstanceOf(Error);
  });
});
