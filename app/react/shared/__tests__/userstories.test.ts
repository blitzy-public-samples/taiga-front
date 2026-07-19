/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the user-story bulk-endpoint wrappers
 * that back the migrated React Kanban and Backlog screens
 * (`app/react/shared/api/userstories.ts`).
 *
 * WHAT IS ASSERTED
 *   Body FIDELITY. Each wrapper must reproduce — byte-for-byte — the request
 *   body the AngularJS `resources/userstories.coffee` service sent, so the
 *   Django REST backend cannot distinguish React traffic from AngularJS traffic
 *   (AAP §0.1.1, §0.6.5, §0.7.1). The spec therefore stubs the shared transport
 *   adapter (`../api/client`'s `api.post` / `api.get`) and asserts the exact
 *   endpoint path and the exact JSON body each function produces, with special
 *   attention to:
 *     - the ENDPOINT-SPECIFIC payload shapes, asserted against the Django
 *       validators byte-for-byte (taiga-back `userstories/validators.py`):
 *         • `bulk_userstories` (backlog + kanban ORDER) is a plain `number[]`
 *           of ids — `ListField(child=IntegerField(min_value=1))`;
 *         • `bulk_stories` for the MILESTONE move is a `BulkUserStoryOrder[]`
 *           (`{ us_id, order }` objects) — `_UserStoryMilestoneBulkValidator`;
 *         • `bulk_stories` for CREATE is a newline-separated STRING —
 *           `serializers.CharField()`;
 *     - the `after_userstory_id` / `before_userstory_id` mutual exclusivity
 *       (with `after` winning when both are truthy);
 *     - the truthy `milestone_id` / `swimlane_id` guards; and
 *     - the deliberate unconditional inclusion of `swimlane_id` (create) and
 *       `milestone_id` (bulkUpdateMilestone).
 *
 *   There is deliberately NO `bulkUpdateSprintOrder` wrapper (and hence no spec
 *   for it): the backend exposes no `bulk_update_sprint_order` route, so it was
 *   removed as dead code (AAP §0.2.1, §0.4.1).
 *
 * TEST-LAYER ISOLATION
 *   No network, no browser, no UI framework. `../api/client` is fully mocked, so
 *   the real `fetch`-based adapter never runs. Jest globals
 *   (`describe`/`it`/`expect`/`jest`) are provided by the runner (jsdom
 *   environment configured in the root `jest.config.js`), so no Jest import is
 *   required.
 */

import { api } from '../api/client';
import {
    bulkCreate,
    bulkUpdateBacklogOrder,
    bulkUpdateMilestone,
    bulkUpdateKanbanOrder,
    filtersData,
} from '../api/userstories';
import type { BulkUserStoryOrder } from '../api/userstories';

// Replace the transport adapter with jest.fn() stubs. The factory references no
// out-of-scope variables, so it is safe under jest's mock hoisting.
jest.mock('../api/client', () => ({
    api: {
        post: jest.fn(),
        get: jest.fn(),
    },
}));

// Typed handles onto the mocked verb methods. Casting through `unknown` avoids
// friction with the generic method signatures on the real `api` object.
const postMock = api.post as unknown as jest.Mock;
const getMock = api.get as unknown as jest.Mock;

// A representative id list reused across the backlog/kanban ORDER assertions.
// These endpoints take a plain `number[]` of user-story ids
// (`bulk_userstories = ListField(child=IntegerField(min_value=1))`), so the
// fixture is typed `number[]` — the compiler now REJECTS passing
// `{ us_id, order }` objects here, statically guaranteeing the fix.
const IDS: number[] = [2, 3];

// A representative `{ us_id, order }` list reused by the MILESTONE-move
// assertion only. Typed with the exported `BulkUserStoryOrder` to prove the
// type is exported/usable and to keep the milestone `bulk_stories` shape
// distinct from the order endpoints' `number[]`.
const ORDER: BulkUserStoryOrder[] = [
    { us_id: 2, order: 0 },
    { us_id: 3, order: 1 },
];

beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    // Default resolutions so every wrapper's returned promise settles.
    postMock.mockResolvedValue(undefined);
    getMock.mockResolvedValue(undefined);
});

/**
 * Convenience: the body (second argument) of the most recent `api.post` call.
 */
function lastPostBody(): Record<string, unknown> {
    return postMock.mock.calls[postMock.mock.calls.length - 1][1] as Record<string, unknown>;
}

describe('bulkCreate', () => {
    it('posts the create body with a STRING bulk_stories and always includes swimlane_id', async () => {
        await bulkCreate(1, 2, 'a\nb', 3);

        expect(postMock).toHaveBeenCalledTimes(1);
        expect(postMock).toHaveBeenCalledWith('/userstories/bulk_create', {
            project_id: 1,
            status_id: 2,
            bulk_stories: 'a\nb',
            swimlane_id: 3,
        });
    });

    it('keeps swimlane_id in the body even when it is null', async () => {
        await bulkCreate(10, 20, 'only-one-line', null);

        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 10,
            status_id: 20,
            bulk_stories: 'only-one-line',
            swimlane_id: null,
        });
        // Explicit: the key is present (not omitted) despite being null.
        expect(body).toHaveProperty('swimlane_id', null);
    });

    it('returns the value the adapter resolves with (typed as UserStory[])', async () => {
        const created = [{ id: 99 }];
        postMock.mockResolvedValueOnce(created);

        await expect(bulkCreate(1, 1, 'x', null)).resolves.toBe(created);
    });
});

describe('bulkUpdateBacklogOrder', () => {
    it('sends bulk_userstories as a plain number[] and includes milestone_id + after_userstory_id (after wins), OMITTING before_userstory_id', async () => {
        await bulkUpdateBacklogOrder(1, 5, 9, null, [2]);

        expect(postMock).toHaveBeenCalledTimes(1);
        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 1,
            bulk_userstories: [2],
            milestone_id: 5,
            after_userstory_id: 9,
        });
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('uses before_userstory_id and OMITS milestone_id and after_userstory_id when only before is truthy', async () => {
        await bulkUpdateBacklogOrder(1, null, null, 9, [2]);

        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 1,
            bulk_userstories: [2],
            before_userstory_id: 9,
        });
        expect(body).not.toHaveProperty('milestone_id');
        expect(body).not.toHaveProperty('after_userstory_id');
    });

    it('prefers after_userstory_id over before_userstory_id when BOTH are truthy', async () => {
        await bulkUpdateBacklogOrder(1, null, 7, 9, IDS);

        const body = lastPostBody();
        expect(body).toHaveProperty('after_userstory_id', 7);
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('targets the backlog-order endpoint and forwards the id array verbatim', async () => {
        await bulkUpdateBacklogOrder(1, null, null, null, IDS);
        expect(postMock).toHaveBeenCalledWith('/userstories/bulk_update_backlog_order', expect.any(Object));
        // The id array is forwarded unchanged (no `{ us_id, order }` wrapping).
        expect(lastPostBody()).toHaveProperty('bulk_userstories', IDS);
    });
});

describe('bulkUpdateMilestone', () => {
    it('posts {project_id, milestone_id, bulk_stories(ARRAY)} with milestone_id always present', async () => {
        await bulkUpdateMilestone(1, 7, [{ us_id: 2, order: 0 }]);

        expect(postMock).toHaveBeenCalledTimes(1);
        expect(postMock).toHaveBeenCalledWith('/userstories/bulk_update_milestone', {
            project_id: 1,
            milestone_id: 7,
            bulk_stories: [{ us_id: 2, order: 0 }],
        });
    });

    it('includes milestone_id even when it is null (unconditional, matches coffee)', async () => {
        await bulkUpdateMilestone(4, null, ORDER);

        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 4,
            milestone_id: null,
            bulk_stories: ORDER,
        });
        expect(body).toHaveProperty('milestone_id', null);
    });
});

describe('bulkUpdateKanbanOrder', () => {
    it('posts the minimal kanban body (bulk_userstories as number[]) with NO swimlane_id / after / before when all are falsy', async () => {
        await bulkUpdateKanbanOrder(1, 4, null, null, null, [2]);

        expect(postMock).toHaveBeenCalledTimes(1);
        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 1,
            status_id: 4,
            bulk_userstories: [2],
        });
        expect(body).not.toHaveProperty('swimlane_id');
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('includes swimlane_id and after_userstory_id when provided (bulk_userstories stays a number[])', async () => {
        await bulkUpdateKanbanOrder(1, 4, 8, 9, null, [2]);

        const body = lastPostBody();
        expect(body).toEqual({
            project_id: 1,
            status_id: 4,
            bulk_userstories: [2],
            after_userstory_id: 9,
            swimlane_id: 8,
        });
    });

    it('uses before_userstory_id when only before is truthy, and keeps swimlane_id independent', async () => {
        await bulkUpdateKanbanOrder(1, 4, 8, null, 9, IDS);

        const body = lastPostBody();
        expect(body).toHaveProperty('before_userstory_id', 9);
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body).toHaveProperty('swimlane_id', 8);
    });

    it('prefers after over before when both are truthy', async () => {
        await bulkUpdateKanbanOrder(1, 4, null, 7, 9, IDS);

        const body = lastPostBody();
        expect(body).toHaveProperty('after_userstory_id', 7);
        expect(body).not.toHaveProperty('before_userstory_id');
        expect(body).not.toHaveProperty('swimlane_id');
    });

    it('targets the kanban-order endpoint and forwards the id array verbatim', async () => {
        await bulkUpdateKanbanOrder(1, 4, null, null, null, IDS);
        expect(postMock).toHaveBeenCalledWith('/userstories/bulk_update_kanban_order', expect.any(Object));
        expect(lastPostBody()).toHaveProperty('bulk_userstories', IDS);
    });
});

describe('filtersData', () => {
    it('GETs filters_data with project plus extra params', async () => {
        await filtersData(1, { status: '2' });

        expect(getMock).toHaveBeenCalledTimes(1);
        expect(getMock).toHaveBeenCalledWith('/userstories/filters_data', {
            project: 1,
            status: '2',
        });
        // The POST adapter must NOT have been used for a GET-backed facet fetch.
        expect(postMock).not.toHaveBeenCalled();
    });

    it('sends only {project} when no extra params are supplied', async () => {
        await filtersData(42);

        expect(getMock).toHaveBeenCalledWith('/userstories/filters_data', { project: 42 });
    });

    it('returns the adapter payload as FiltersData', async () => {
        const payload = { statuses: [{ id: 1, count: 3 }] };
        getMock.mockResolvedValueOnce(payload);

        await expect(filtersData(1)).resolves.toBe(payload);
    });
});
