/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the milestone/sprint CRUD adapters
 * (`app/react/shared/api/milestones.ts`) used by the React Backlog screen.
 *
 * These specs pin the framework-agnostic re-implementation of the AngularJS
 * `$tgSprintsResourcesProvider` (`resources/sprints.coffee`) + `$tgRepo` verbs
 * (`base/repository.coffee`) so the requests the FROZEN `/milestones`
 * `/api/v1/` endpoints see are byte-identical to the incumbent Backlog:
 *
 *   - URL + VERB parity: list -> GET `milestones`, get -> GET `milestones/{id}`,
 *     stats -> GET `milestones/{id}/stats`, create -> POST `milestones`,
 *     save -> PATCH `milestones/{id}`, remove -> DELETE `milestones/{id}`.
 *   - `x-disable-pagination: "1"` on every GET (reproducing the `$repo`
 *     queryMany/queryOne/queryOneRaw defaults, `repository.coffee:139-140/167-168/177-178`).
 *   - `list()` params are `{ project, ...filters }` and the open/closed totals
 *     come from the `Taiga-Info-Total-Opened/Closed-Milestones` RESPONSE
 *     headers, parsed with `parseInt` (so an absent header yields `NaN`,
 *     matching AngularJS — NOT `0`).
 *   - Date serialization: `estimated_start`/`estimated_finish` are formatted
 *     `YYYY-MM-DD` (matching `lightboxes.coffee:59-60/66-67`) ONLY when present,
 *     never invoking `moment(undefined)` (which would default to "now").
 *
 * The suite is hermetic: the sibling `../httpClient` is fully mocked, so there
 * is no `fetch`, no network, no browser, and no AngularJS/CoffeeScript import.
 * It runs headlessly and deterministically and counts toward the >=70%
 * line-coverage gate over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`jest` are provided globally by
 * `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

// Mock the sibling HTTP client BEFORE importing the module under test so the
// adapter's `import httpClient from './httpClient'` binds to the mock. The
// factory returns a default export (matching `export default httpClient`) whose
// verbs are jest mocks; `clearMocks: true` (jest.config.js) resets them per test.
jest.mock('../httpClient', () => ({
  __esModule: true,
  default: {
    getWithHeaders: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import httpClient from '../httpClient';
import milestones, {
  list,
  get,
  stats,
  create,
  save,
  remove,
} from '../milestones';
import type {
  Milestone,
  MilestoneCreatePayload,
  MilestoneListResult,
} from '../milestones';

/** The mocked client, typed so each verb is a jest mock for call inspection. */
const mockHttp = httpClient as jest.Mocked<typeof httpClient>;

/** Builds a real `Headers` object for the `Taiga-Info-Total-*` assertions. */
const headersWith = (entries: Record<string, string>): Headers =>
  new Headers(entries);

beforeEach(() => {
  // Safe defaults so a test that does not care about the return value still
  // gets a well-formed resolution. Individual tests override as needed.
  mockHttp.getWithHeaders.mockResolvedValue({
    data: [],
    headers: headersWith({}),
    status: 200,
  } as never);
  mockHttp.get.mockResolvedValue({} as never);
  mockHttp.post.mockResolvedValue({} as never);
  mockHttp.patch.mockResolvedValue({} as never);
  mockHttp.delete.mockResolvedValue(undefined as never);
});

describe('milestones.list — GET /milestones with header totals (sprints.coffee:26-42)', () => {
  it('calls getWithHeaders with the project param and x-disable-pagination', async () => {
    await list(42);

    expect(mockHttp.getWithHeaders).toHaveBeenCalledTimes(1);
    expect(mockHttp.getWithHeaders).toHaveBeenCalledWith(
      'milestones',
      { project: 42 },
      { headers: { 'x-disable-pagination': '1' } },
    );
  });

  it('merges optional filters over the project param', async () => {
    await list(7, { closed: true, order: 'name' });

    expect(mockHttp.getWithHeaders).toHaveBeenCalledWith(
      'milestones',
      { project: 7, closed: true, order: 'name' },
      { headers: { 'x-disable-pagination': '1' } },
    );
  });

  it('returns the milestone array and the parsed open/closed totals', async () => {
    const rows: Milestone[] = [
      {
        id: 1,
        name: 'Sprint 1',
        project: 7,
        estimated_start: '2021-01-01',
        estimated_finish: '2021-01-14',
      },
    ];
    mockHttp.getWithHeaders.mockResolvedValueOnce({
      data: rows,
      headers: headersWith({
        'Taiga-Info-Total-Closed-Milestones': '3',
        'Taiga-Info-Total-Opened-Milestones': '5',
      }),
      status: 200,
    } as never);

    const result: MilestoneListResult = await list(7);

    expect(result.milestones).toBe(rows);
    expect(result.closed).toBe(3);
    expect(result.open).toBe(5);
  });

  it('reads the total headers case-insensitively', async () => {
    mockHttp.getWithHeaders.mockResolvedValueOnce({
      data: [],
      // Headers.get is case-insensitive; assert the adapter relies on that.
      headers: headersWith({
        'taiga-info-total-closed-milestones': '2',
        'taiga-info-total-opened-milestones': '9',
      }),
      status: 200,
    } as never);

    const result = await list(7);

    expect(result.closed).toBe(2);
    expect(result.open).toBe(9);
  });

  it('yields NaN totals when the headers are absent (matches AngularJS parseInt)', async () => {
    mockHttp.getWithHeaders.mockResolvedValueOnce({
      data: [],
      headers: headersWith({}),
      status: 200,
    } as never);

    const result = await list(7);

    expect(Number.isNaN(result.closed)).toBe(true);
    expect(Number.isNaN(result.open)).toBe(true);
  });

  it('defaults milestones to [] when the body is empty/null', async () => {
    mockHttp.getWithHeaders.mockResolvedValueOnce({
      data: null,
      headers: headersWith({}),
      status: 204,
    } as never);

    const result = await list(7);

    expect(result.milestones).toEqual([]);
  });
});

describe('milestones.get — GET /milestones/{id} (sprints.coffee:16-21)', () => {
  it('requests the single milestone with x-disable-pagination and returns it raw', async () => {
    const sprint = {
      id: 9,
      name: 'S9',
      project: 7,
      estimated_start: '2021-03-01',
      estimated_finish: '2021-03-14',
    };
    mockHttp.get.mockResolvedValueOnce(sprint as never);

    const result = await get(9);

    expect(mockHttp.get).toHaveBeenCalledWith('milestones/9', undefined, {
      headers: { 'x-disable-pagination': '1' },
    });
    expect(result).toBe(sprint);
  });
});

describe('milestones.stats — GET /milestones/{id}/stats (sprints.coffee:23-24)', () => {
  it('requests the stats sub-resource with x-disable-pagination and returns it raw', async () => {
    const statsPayload = { total_points: 40, completed_points: 12 };
    mockHttp.get.mockResolvedValueOnce(statsPayload as never);

    const result = await stats(9);

    expect(mockHttp.get).toHaveBeenCalledWith('milestones/9/stats', undefined, {
      headers: { 'x-disable-pagination': '1' },
    });
    expect(result).toBe(statsPayload);
  });
});

describe('milestones.create — POST /milestones (repository.coffee:24-35)', () => {
  it('POSTs to milestones with the payload, formatting the dates YYYY-MM-DD', async () => {
    const payload: MilestoneCreatePayload = {
      project: 7,
      name: 'New Sprint',
      estimated_start: '2021-01-01',
      estimated_finish: '2021-01-14',
    };

    await create(payload);

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith('milestones', {
      project: 7,
      name: 'New Sprint',
      estimated_start: '2021-01-01',
      estimated_finish: '2021-01-14',
    });
  });

  it('normalizes Date instances to YYYY-MM-DD before POSTing', async () => {
    const payload = {
      project: 7,
      name: 'Date Sprint',
      // TIMEZONE DETERMINISM (F-TZ-1). `serializeDates` formats with LOCAL moment
      // (`moment(value).format('YYYY-MM-DD')`), so a Date must be pinned to the
      // intended calendar day IN LOCAL TIME. A UTC instant such as
      // `new Date('2021-06-15T12:00:00Z')` (noon UTC) day-rolls to Jun 16 under
      // any UTC>=+12 zone (e.g. Pacific/Kiritimati, +13/+14), making the assertion
      // below environment-dependent. `new Date(year, monthIndex, day)` instead
      // constructs LOCAL midnight of that exact calendar day in EVERY timezone, so
      // the formatted output is deterministic. Month index 5 == June.
      estimated_start: new Date(2021, 5, 15),
      estimated_finish: new Date(2021, 5, 29),
    } as unknown as MilestoneCreatePayload;

    await create(payload);

    const body = mockHttp.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.estimated_start).toBe('2021-06-15');
    expect(body.estimated_finish).toBe('2021-06-29');
  });

  it('does not mutate the caller-supplied payload (shallow copy)', async () => {
    const payload: MilestoneCreatePayload = {
      project: 7,
      name: 'Immutable',
      estimated_start: '2021-01-01',
      estimated_finish: '2021-01-14',
    };
    const snapshot = { ...payload };

    await create(payload);

    expect(payload).toEqual(snapshot);
    // The body sent is a distinct object, not the caller's reference.
    expect(mockHttp.post.mock.calls[0][1]).not.toBe(payload);
  });

  it('returns the created milestone JSON from the client', async () => {
    const created = {
      id: 100,
      name: 'New Sprint',
      project: 7,
      estimated_start: '2021-01-01',
      estimated_finish: '2021-01-14',
    };
    mockHttp.post.mockResolvedValueOnce(created as never);

    const result = await create({
      project: 7,
      name: 'New Sprint',
      estimated_start: '2021-01-01',
      estimated_finish: '2021-01-14',
    });

    expect(result).toBe(created);
  });
});

describe('milestones.save — PATCH /milestones/{id} (repository.coffee:54-68)', () => {
  it('PATCHes the milestone by id with the changed attrs, formatting dates', async () => {
    await save(55, {
      name: 'Renamed',
      estimated_start: '2021-02-01',
      estimated_finish: '2021-02-14',
    });

    expect(mockHttp.patch).toHaveBeenCalledTimes(1);
    expect(mockHttp.patch).toHaveBeenCalledWith('milestones/55', {
      name: 'Renamed',
      estimated_start: '2021-02-01',
      estimated_finish: '2021-02-14',
    });
  });

  it('leaves a partial edit without dates untouched (no moment(undefined) -> now)', async () => {
    await save(55, { name: 'Only name changed' });

    const body = mockHttp.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Only name changed' });
    expect('estimated_start' in body).toBe(false);
    expect('estimated_finish' in body).toBe(false);
  });

  it('does not format empty-string dates (guards against the now-default bug)', async () => {
    await save(55, { estimated_start: '', estimated_finish: '' });

    const body = mockHttp.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(body.estimated_start).toBe('');
    expect(body.estimated_finish).toBe('');
  });

  it('returns the updated milestone JSON from the client', async () => {
    const updated = { id: 55, name: 'Renamed', project: 7 };
    mockHttp.patch.mockResolvedValueOnce(updated as never);

    const result = await save(55, { name: 'Renamed' });

    expect(result).toBe(updated);
  });
});

describe('milestones.remove — DELETE /milestones/{id} (repository.coffee:37-48)', () => {
  it('DELETEs the milestone by id and resolves void', async () => {
    const result = await remove(77);

    expect(mockHttp.delete).toHaveBeenCalledTimes(1);
    expect(mockHttp.delete).toHaveBeenCalledWith('milestones/77');
    expect(result).toBeUndefined();
  });
});

describe('milestones — export surface', () => {
  it('exposes the six adapters on the default aggregate', () => {
    expect(typeof milestones.list).toBe('function');
    expect(typeof milestones.get).toBe('function');
    expect(typeof milestones.stats).toBe('function');
    expect(typeof milestones.create).toBe('function');
    expect(typeof milestones.save).toBe('function');
    expect(typeof milestones.remove).toBe('function');
  });

  it('binds the aggregate members to the named exports', () => {
    expect(milestones.list).toBe(list);
    expect(milestones.get).toBe(get);
    expect(milestones.stats).toBe(stats);
    expect(milestones.create).toBe(create);
    expect(milestones.save).toBe(save);
    expect(milestones.remove).toBe(remove);
  });
});
