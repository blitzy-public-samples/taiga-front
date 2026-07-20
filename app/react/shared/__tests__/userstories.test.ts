/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the bulk user-story API adapters
 * (`app/react/shared/api/userstories.ts`).
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. This suite
 * PINS the request URL, HTTP verb, and request-body shape of every adapter to
 * the AngularJS `$tgUserstoriesResourcesProvider`
 * (`app/coffee/modules/resources/userstories.coffee:64-147`, endpoint names
 * registered in `app/coffee/modules/resources.coffee:107-118`) so the FROZEN
 * Django `/api/v1/` bulk-ordering contract stays byte-for-byte identical.
 *
 * Any key rename, added/dropped field, or reordering-precedence drift would
 * silently corrupt server-side ordering, so every conditional branch is
 * asserted explicitly — and the mutually-exclusive keys are proven ABSENT with
 * `not.toHaveProperty(...)`, which is the crux of the frozen-contract fidelity:
 *
 *   - bulk_create ............. all FOUR keys always present (swimlane_id may be null);
 *   - bulk_update_backlog_order  milestone_id independent of after/before; after wins;
 *   - bulk_update_milestone ... exact { project_id, milestone_id, bulk_stories };
 *   - bulk_update_kanban_order   after wins over before; swimlane_id appended AFTER the branch;
 *   - editStatus .............. PATCH userstory-statuses/{id} with { wip_limit }.
 *
 * The endpoint strings asserted here are the RELATIVE, no-leading-slash paths
 * the TypeScript adapter passes to `httpClient` (e.g. `'userstories/bulk_create'`);
 * `httpClient` itself joins them onto `getApiUrl()` and trims a leading slash,
 * reproducing the AngularJS `UrlsService.resolve` join, so the wire URL matches
 * the coffee registry's `/userstories/bulk_create` exactly.
 *
 * The suite is HERMETIC (AAP 0.6.2 test-layer isolation): it mocks the sibling
 * `../api/httpClient` module entirely, so NO `fetch`, network, browser,
 * AngularJS/CoffeeScript import, or Playwright is involved. It runs headlessly
 * under jsdom + ts-jest and counts toward the >=70% line-coverage gate over
 * `app/react/**` (jest.config.js `coverageThreshold.global.lines: 70`).
 *
 * `describe`/`it`/`expect`/`beforeEach`/`jest` are provided globally by
 * `@types/jest` + ts-jest; they are deliberately NOT imported.
 */

// ---------------------------------------------------------------------------
// Mock the sibling HTTP client.
//
// `jest.mock` is hoisted above the imports by ts-jest, so the factory must be
// self-contained (it may reference only `jest`). The factory reproduces the
// module's dual export surface (`__esModule: true` + a `default` object) — the
// adapter under test does `import httpClient from './httpClient'` (DEFAULT
// import), so the `default` object is what its calls are routed through. All
// seven verbs are stubbed so the mock is a faithful stand-in even though this
// suite only exercises `post`/`patch`; the write verbs resolve to `{}` by
// default (overridden per-test with the RESULT sentinel in `beforeEach`).
//
// Jest keys module mocks by RESOLVED path, so mocking '../api/httpClient' from
// this spec (at app/react/shared/__tests__/) replaces the SAME module instance
// that `userstories.ts` imports as './httpClient' (app/react/shared/api/).
// ---------------------------------------------------------------------------
jest.mock('../api/httpClient', () => ({
  __esModule: true,
  default: {
    request: jest.fn(),
    get: jest.fn(),
    getWithHeaders: jest.fn(),
    post: jest.fn().mockResolvedValue({}),
    put: jest.fn().mockResolvedValue({}),
    patch: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  },
}));

import httpClient from '../api/httpClient';
import {
  bulkCreate,
  bulkUpdateBacklogOrder,
  bulkUpdateMilestone,
  bulkUpdateKanbanOrder,
  editStatus,
  userstories,
} from '../api/userstories';
// Type-only imports: the project runs with `isolatedModules`, so symbols used
// solely in type annotations MUST be imported with `import type`.
import type {
  BulkOrderItem,
  BulkCreatePayload,
  BulkUpdateBacklogOrderPayload,
  BulkUpdateMilestonePayload,
  BulkUpdateKanbanOrderPayload,
} from '../api/userstories';

// ---------------------------------------------------------------------------
// Fixtures & typed mock accessors
// ---------------------------------------------------------------------------

/** The mocked `httpClient.post`, cast for call-argument inspection. */
const postMock = (): jest.Mock => httpClient.post as unknown as jest.Mock;
/** The mocked `httpClient.patch`, cast for call-argument inspection. */
const patchMock = (): jest.Mock => httpClient.patch as unknown as jest.Mock;

/**
 * A sentinel resolved value used to prove each adapter RETURNS the client's
 * promise unchanged (i.e. delegates rather than swallowing the result).
 */
const RESULT = { ok: true } as const;

/**
 * Two representative MILESTONE ordering entries. `bulk_stories` for `bulkCreate`
 * is a raw newline-separated subjects STRING (frozen contract); the
 * `bulk_update_milestone` payload's `bulk_stories` is an array of
 * `{ us_id, order }` items — the exported `BulkOrderItem` shape.
 *
 * NOTE: the two bulk-ORDER endpoints are DIFFERENT — their `bulk_userstories`
 * is a bare `number[]` of ids (see `IDS` below), NOT `{ us_id, order }` objects.
 */
const ITEMS: BulkOrderItem[] = [
  { us_id: 1, order: 0 },
  { us_id: 2, order: 1 },
];

/**
 * The bulk-ORDER payload for `bulk_update_kanban_order` /
 * `bulk_update_backlog_order` is a bare array of user-story IDS (`number[]`),
 * NOT `{ us_id, order }` objects (kanban/main.coffee:610; backlog/main.coffee:535).
 * Kept DISTINCT from `ITEMS` so these specs lock the frozen `number[]` contract
 * for the two order endpoints.
 */
const IDS: number[] = [1, 2];

/** Raw multi-line subjects string for `bulkCreate` (passed through untouched). */
const SUBJECTS = 'Story A\nStory B\nStory C';

beforeEach(() => {
  // Deterministic isolation: reset every mock's call history (jest.config.js
  // also sets `clearMocks: true`; this makes the guarantee explicit), then
  // (re)install the RESULT sentinel so return-passthrough assertions hold.
  jest.clearAllMocks();
  postMock().mockResolvedValue(RESULT);
  patchMock().mockResolvedValue(RESULT);
});

// ---------------------------------------------------------------------------
// bulkCreate (userstories.coffee:64-74 -> userstories.ts:150-168)
// ---------------------------------------------------------------------------

describe('userstories.bulkCreate', () => {
  it('POSTs to userstories/bulk_create with all four keys always present (swimlane_id null)', async () => {
    const result = await bulkCreate(10, 5, SUBJECTS, null);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [string, BulkCreatePayload];

    // Exact relative endpoint the adapter passes to httpClient.
    expect(path).toBe('userstories/bulk_create');
    // The whole body is byte-exact, including swimlane_id present with a null.
    expect(body).toEqual({
      project_id: 10,
      status_id: 5,
      bulk_stories: SUBJECTS,
      swimlane_id: null,
    });
    // swimlane_id MUST be present even though it is null (the key is never dropped).
    expect(body).toHaveProperty('swimlane_id');
    expect(body.swimlane_id).toBeNull();
    // The raw newline-separated subjects string is forwarded untouched (a string,
    // not an array) — matching the frozen bulk_create contract.
    expect(typeof body.bulk_stories).toBe('string');
    // The adapter returns the client's promise result unchanged.
    expect(result).toBe(RESULT);
    // bulk_create never touches PATCH.
    expect(patchMock()).not.toHaveBeenCalled();
  });

  it('forwards a truthy swimlane_id while keeping all four keys', async () => {
    await bulkCreate(10, 5, SUBJECTS, 8);

    const [, body] = postMock().mock.calls[0] as [string, BulkCreatePayload];
    expect(body).toEqual({
      project_id: 10,
      status_id: 5,
      bulk_stories: SUBJECTS,
      swimlane_id: 8,
    });
  });
});

// ---------------------------------------------------------------------------
// bulkUpdateBacklogOrder (userstories.coffee:92-105 -> userstories.ts:189-216)
// ---------------------------------------------------------------------------

describe('userstories.bulkUpdateBacklogOrder', () => {
  it('adds after_userstory_id + milestone_id and OMITS before_userstory_id when after AND before are truthy', async () => {
    // after (7) AND before (9) both truthy, milestone (4) truthy.
    await bulkUpdateBacklogOrder(10, 4, 7, 9, IDS);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    expect(path).toBe('userstories/bulk_update_backlog_order');
    // Base params always present.
    expect(body.project_id).toBe(10);
    expect(body.bulk_userstories).toEqual(IDS);
    // milestone_id added by its own independent `if`.
    expect(body.milestone_id).toBe(4);
    // after wins over before via the else-if.
    expect(body.after_userstory_id).toBe(7);
    // before_userstory_id must be truly ABSENT (never both).
    expect(body).not.toHaveProperty('before_userstory_id');
  });

  it('falls back to before_userstory_id and OMITS milestone_id + after_userstory_id when after is falsy, before truthy, milestone falsy', async () => {
    // after falsy (null), before (9) truthy, milestone falsy (null).
    await bulkUpdateBacklogOrder(10, null, null, 9, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    // The full body is exactly the base params plus before_userstory_id.
    expect(body).toEqual({
      project_id: 10,
      bulk_userstories: IDS,
      before_userstory_id: 9,
    });
    expect(body.before_userstory_id).toBe(9);
    // Neither the (falsy) milestone nor the (falsy) after leak in.
    expect(body).not.toHaveProperty('milestone_id');
    expect(body).not.toHaveProperty('after_userstory_id');
  });

  it('sends ONLY the base params when milestone/after/before are all falsy', async () => {
    await bulkUpdateBacklogOrder(10, null, null, null, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateBacklogOrderPayload,
    ];
    expect(body).toEqual({ project_id: 10, bulk_userstories: IDS });
    // None of the optional keys leak in.
    expect(body).not.toHaveProperty('milestone_id');
    expect(body).not.toHaveProperty('after_userstory_id');
    expect(body).not.toHaveProperty('before_userstory_id');
  });
});

// ---------------------------------------------------------------------------
// bulkUpdateMilestone (userstories.coffee:107-110 -> userstories.ts:231-243)
// ---------------------------------------------------------------------------

describe('userstories.bulkUpdateMilestone', () => {
  it('POSTs exactly { project_id, milestone_id, bulk_stories } to bulk_update_milestone', async () => {
    const result = await bulkUpdateMilestone(10, 4, ITEMS);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateMilestonePayload,
    ];
    expect(path).toBe('userstories/bulk_update_milestone');
    expect(body).toEqual({ project_id: 10, milestone_id: 4, bulk_stories: ITEMS });
    // Here bulk_stories is the ARRAY of ordering items (distinct from bulkCreate's string).
    expect(Array.isArray(body.bulk_stories)).toBe(true);
    expect(result).toBe(RESULT);
  });
});

// ---------------------------------------------------------------------------
// bulkUpdateKanbanOrder (userstories.coffee:112-129 -> userstories.ts:270-299)
// ---------------------------------------------------------------------------

describe('userstories.bulkUpdateKanbanOrder', () => {
  it('adds after_userstory_id + swimlane_id and OMITS before_userstory_id when swimlane truthy and after+before set', async () => {
    // swimlane (2) truthy, after (7) AND before (9) both truthy.
    await bulkUpdateKanbanOrder(10, 5, 2, 7, 9, IDS);

    expect(postMock()).toHaveBeenCalledTimes(1);
    const [path, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(path).toBe('userstories/bulk_update_kanban_order');
    // Base params always present.
    expect(body.project_id).toBe(10);
    expect(body.status_id).toBe(5);
    expect(body.bulk_userstories).toEqual(IDS);
    // after wins over before.
    expect(body.after_userstory_id).toBe(7);
    expect(body).not.toHaveProperty('before_userstory_id');
    // swimlane_id appended AFTER the after/before branch, present because truthy.
    expect(body.swimlane_id).toBe(2);
  });

  it('falls back to before_userstory_id and OMITS swimlane_id + after_userstory_id when swimlane falsy, after falsy, before truthy', async () => {
    // swimlane falsy (null), after falsy (null), before (9) truthy.
    await bulkUpdateKanbanOrder(10, 5, null, null, 9, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(body).toEqual({
      project_id: 10,
      status_id: 5,
      bulk_userstories: IDS,
      before_userstory_id: 9,
    });
    expect(body.before_userstory_id).toBe(9);
    // The (falsy) swimlane and (falsy) after are truly absent.
    expect(body).not.toHaveProperty('swimlane_id');
    expect(body).not.toHaveProperty('after_userstory_id');
  });

  it('sends ONLY the base params when swimlane/after/before are all falsy', async () => {
    await bulkUpdateKanbanOrder(10, 5, null, null, null, IDS);

    const [, body] = postMock().mock.calls[0] as [
      string,
      BulkUpdateKanbanOrderPayload,
    ];
    expect(body).toEqual({ project_id: 10, status_id: 5, bulk_userstories: IDS });
    expect(body).not.toHaveProperty('after_userstory_id');
    expect(body).not.toHaveProperty('before_userstory_id');
    expect(body).not.toHaveProperty('swimlane_id');
  });
});

// ---------------------------------------------------------------------------
// editStatus (userstories.coffee:141-147 -> userstories.ts:314-318)
// ---------------------------------------------------------------------------

describe('userstories.editStatus', () => {
  it('PATCHes userstory-statuses/{statusId} with { wip_limit }', async () => {
    const result = await editStatus(42, 3);

    expect(patchMock()).toHaveBeenCalledTimes(1);
    const [path, body] = patchMock().mock.calls[0] as [
      string,
      { wip_limit: number | null },
    ];
    // Status id is interpolated into the path segment.
    expect(path).toBe('userstory-statuses/42');
    expect(body).toEqual({ wip_limit: 3 });
    expect(result).toBe(RESULT);
    // editStatus is a PATCH; it must NOT touch POST.
    expect(postMock()).not.toHaveBeenCalled();
  });

  it('sends wip_limit: null when clearing the limit', async () => {
    await editStatus(42, null);

    const [path, body] = patchMock().mock.calls[0] as [
      string,
      { wip_limit: number | null },
    ];
    expect(path).toBe('userstory-statuses/42');
    expect(body).toEqual({ wip_limit: null });
    // The key is present with an explicit null (limit cleared, not omitted).
    expect(body).toHaveProperty('wip_limit');
    expect(body.wip_limit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aggregate export surface (userstories.ts:330-338)
// ---------------------------------------------------------------------------

describe('userstories aggregate export', () => {
  it('exposes all five adapters on the default/named aggregate object', () => {
    expect(userstories.bulkCreate).toBe(bulkCreate);
    expect(userstories.bulkUpdateBacklogOrder).toBe(bulkUpdateBacklogOrder);
    expect(userstories.bulkUpdateMilestone).toBe(bulkUpdateMilestone);
    expect(userstories.bulkUpdateKanbanOrder).toBe(bulkUpdateKanbanOrder);
    expect(userstories.editStatus).toBe(editStatus);
  });
});
