/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the bulk user-story adapters
 * (`app/react/shared/api/userstories.ts`).
 *
 * These specs pin the request URL, HTTP verb, and request-body shape of every
 * adapter to the AngularJS `$tgUserstoriesResourcesProvider`
 * (`app/coffee/modules/resources/userstories.coffee:64-147`) so the FROZEN
 * `/api/v1/` bulk-ordering contract is preserved byte-for-byte. Any key rename,
 * added field, or reordering-precedence drift would silently corrupt
 * server-side ordering, so each branch is asserted explicitly:
 *
 *   - bulk_create ............. all four keys always present (swimlane_id may be null);
 *   - bulk_update_backlog_order  milestone_id independent of after/before; after wins;
 *   - bulk_update_milestone ... exact { project_id, milestone_id, bulk_stories };
 *   - bulk_update_kanban_order   after wins over before; swimlane_id appended AFTER the branch;
 *   - editStatus .............. PATCH userstory-statuses/{id} with { wip_limit }.
 *
 * The suite is hermetic: it mocks the sibling `../httpClient` entirely, so no
 * `fetch`, network, browser, AngularJS/CoffeeScript import, or Playwright is
 * involved. It runs headlessly and counts toward the >=70% line-coverage gate
 * over `app/react/**`.
 *
 * `describe`/`it`/`expect`/`beforeEach`/`jest` are provided globally by
 * `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

// Replace the sibling HTTP client with a fully-mocked default export whose
// `post`/`patch` are jest mock functions. The factory is hoisted above the
// imports by ts-jest, so it must be self-contained (references only `jest`).
jest.mock('../httpClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

import httpClient from '../httpClient';
import {
  bulkCreate,
  bulkUpdateBacklogOrder,
  bulkUpdateMilestone,
  bulkUpdateKanbanOrder,
  editStatus,
  userstories,
} from '../userstories';
import type {
  BulkOrderItem,
  BulkCreatePayload,
  BulkUpdateBacklogOrderPayload,
  BulkUpdateMilestonePayload,
  BulkUpdateKanbanOrderPayload,
} from '../userstories';

/** The mocked `httpClient.post`, typed for call inspection. */
const postMock = (): jest.Mock => httpClient.post as unknown as jest.Mock;
/** The mocked `httpClient.patch`, typed for call inspection. */
const patchMock = (): jest.Mock => httpClient.patch as unknown as jest.Mock;

/** A sentinel resolved value used to prove the adapter returns the client's promise. */
const RESULT = { ok: true } as const;

/**
 * Milestone ordering entries (`{ us_id, order }[]`) — the `bulk_stories` shape
 * of `bulk_update_milestone` ONLY (backlog/main.coffee:794-799).
 */
const ITEMS: BulkOrderItem[] = [
  { us_id: 1, order: 0 },
  { us_id: 2, order: 1 },
];

/**
 * The bulk-ORDER payload for the two order endpoints is a bare array of
 * user-story IDS (`number[]`), NOT `{ us_id, order }` objects
 * (kanban/main.coffee:610 `usList.map((it) => it.id)`; backlog/main.coffee:535
 * `_.map(usList, (it) -> it.id)`). Kept DISTINCT from `ITEMS` so these specs
 * lock the frozen `number[]` contract for `bulk_update_kanban_order` and
 * `bulk_update_backlog_order`.
 */
const IDS: number[] = [1, 2];

beforeEach(() => {
  // `clearMocks: true` (jest.config.js) resets call data before each test; we
  // (re)install the resolved value here so delegation/return-passthrough holds.
  postMock().mockResolvedValue(RESULT);
  patchMock().mockResolvedValue(RESULT);
});

describe('userstories.bulkCreate (userstories.coffee:64-74)', () => {
  it('POSTs to userstories/bulk_create with all four keys always present', async () => {
    const result = await bulkCreate(7, 3, 'Story A\nStory B', 5);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [string, BulkCreatePayload];
    expect(path).toBe('userstories/bulk_create');
    expect(body).toEqual({
      project_id: 7,
      status_id: 3,
      bulk_stories: 'Story A\nStory B',
      swimlane_id: 5,
    });
    // The raw newline-separated subjects string is passed through untouched.
    expect(typeof body.bulk_stories).toBe('string');
    // The adapter returns the client's promise result.
    expect(result).toBe(RESULT);
  });

  it('keeps swimlane_id present even when null', async () => {
    await bulkCreate(7, 3, 'Only one', null);

    const [, body] = postMock().mock.calls[0] as [string, BulkCreatePayload];
    // The key MUST be present (not dropped) with a null value, matching source.
    expect('swimlane_id' in body).toBe(true);
    expect(body.swimlane_id).toBeNull();
  });
});

describe('userstories.bulkUpdateBacklogOrder (userstories.coffee:92-105)', () => {
  it('sends only the base params when milestone/after/before are all falsy', async () => {
    await bulkUpdateBacklogOrder(7, null, null, null, IDS);

    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    expect(path).toBe('userstories/bulk_update_backlog_order');
    expect(body).toEqual({ project_id: 7, bulk_userstories: IDS });
    // None of the optional keys leak in.
    expect('milestone_id' in body).toBe(false);
    expect('after_userstory_id' in body).toBe(false);
    expect('before_userstory_id' in body).toBe(false);
  });

  it('adds milestone_id when truthy, independently of the after/before branch', async () => {
    await bulkUpdateBacklogOrder(7, 42, null, 9, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    // milestone_id present alongside before_userstory_id (separate `if` blocks).
    expect(body.milestone_id).toBe(42);
    expect(body.before_userstory_id).toBe(9);
    expect('after_userstory_id' in body).toBe(false);
  });

  it('prefers after_userstory_id over before_userstory_id (after wins)', async () => {
    await bulkUpdateBacklogOrder(7, null, 11, 22, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    expect(body.after_userstory_id).toBe(11);
    // before is NOT sent when after is truthy (else-if precedence).
    expect('before_userstory_id' in body).toBe(false);
  });

  it('falls back to before_userstory_id when after is falsy', async () => {
    await bulkUpdateBacklogOrder(7, null, null, 22, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    expect(body.before_userstory_id).toBe(22);
    expect('after_userstory_id' in body).toBe(false);
  });
});

describe('userstories.bulkUpdateMilestone (userstories.coffee:107-110)', () => {
  it('POSTs { project_id, milestone_id, bulk_stories } to bulk_update_milestone', async () => {
    const result = await bulkUpdateMilestone(7, 42, ITEMS);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateMilestonePayload,
    ];
    expect(path).toBe('userstories/bulk_update_milestone');
    expect(body).toEqual({ project_id: 7, milestone_id: 42, bulk_stories: ITEMS });
    expect(result).toBe(RESULT);
  });
});

describe('userstories.bulkUpdateKanbanOrder (userstories.coffee:112-129)', () => {
  it('sends only the base params when swimlane/after/before are all falsy', async () => {
    await bulkUpdateKanbanOrder(7, 3, null, null, null, IDS);

    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(path).toBe('userstories/bulk_update_kanban_order');
    expect(body).toEqual({ project_id: 7, status_id: 3, bulk_userstories: IDS });
    expect('after_userstory_id' in body).toBe(false);
    expect('before_userstory_id' in body).toBe(false);
    expect('swimlane_id' in body).toBe(false);
  });

  it('prefers after over before, then appends swimlane_id AFTER the branch', async () => {
    await bulkUpdateKanbanOrder(7, 3, 5, 11, 22, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(body.after_userstory_id).toBe(11);
    expect('before_userstory_id' in body).toBe(false);
    // swimlane_id is added after the after/before branch, present when truthy.
    expect(body.swimlane_id).toBe(5);
  });

  it('falls back to before when after is falsy and still appends swimlane_id', async () => {
    await bulkUpdateKanbanOrder(7, 3, 5, null, 22, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(body.before_userstory_id).toBe(22);
    expect('after_userstory_id' in body).toBe(false);
    expect(body.swimlane_id).toBe(5);
  });

  it('omits swimlane_id when it is falsy even if after/before are set', async () => {
    await bulkUpdateKanbanOrder(7, 3, null, 11, null, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(body.after_userstory_id).toBe(11);
    expect('swimlane_id' in body).toBe(false);
  });
});

describe('userstories.editStatus (userstories.coffee:141-147)', () => {
  it('PATCHes userstory-statuses/{statusId} with { wip_limit }', async () => {
    const result = await editStatus(88, 5);

    expect(patchMock()).toHaveBeenCalledTimes(1);
    const [path, body] = patchMock().mock.calls[0] as [
      string,
      { wip_limit: number | null },
    ];
    expect(path).toBe('userstory-statuses/88');
    expect(body).toEqual({ wip_limit: 5 });
    expect(result).toBe(RESULT);
    // editStatus must NOT touch post.
    expect(postMock()).not.toHaveBeenCalled();
  });

  it('sends wip_limit: null when clearing the limit', async () => {
    await editStatus(88, null);

    const [path, body] = patchMock().mock.calls[0] as [
      string,
      { wip_limit: number | null },
    ];
    expect(path).toBe('userstory-statuses/88');
    expect(body).toEqual({ wip_limit: null });
  });
});

describe('userstories aggregate export', () => {
  it('exposes all five adapters on the default/named aggregate object', () => {
    expect(userstories.bulkCreate).toBe(bulkCreate);
    expect(userstories.bulkUpdateBacklogOrder).toBe(bulkUpdateBacklogOrder);
    expect(userstories.bulkUpdateMilestone).toBe(bulkUpdateMilestone);
    expect(userstories.bulkUpdateKanbanOrder).toBe(bulkUpdateKanbanOrder);
    expect(userstories.editStatus).toBe(editStatus);
  });
});
