/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the milestone (sprint) endpoint
 * wrappers that back the migrated React Backlog screen
 * (`app/react/shared/api/milestones.ts`).
 *
 * WHAT IS ASSERTED
 *   HTTP-contract FIDELITY. Each wrapper must reproduce — byte-for-byte — the
 *   verb, endpoint path and request body its AngularJS counterpart sent
 *   (`resources/sprints.coffee`, `backlog/lightboxes.coffee`,
 *   `base/repository.coffee`) so the Django REST backend cannot tell React
 *   traffic from AngularJS traffic (AAP §0.1.1, §0.6.1, §0.7.1). Special
 *   attention is paid to:
 *     - `listMilestones` reading the open/closed totals from RESPONSE HEADERS
 *       (`Taiga-Info-Total-*-Milestones`), defaulting an absent/NaN header to 0;
 *     - `createMilestone` posting the create payload VERBATIM; and
 *     - `saveMilestone` PATCHing EXACTLY the caller's minimal diff plus
 *       `version` — never the whole model — reproducing `$repo.save` →
 *       `getAttrs(patch=true)` = `_modifiedAttrs` + `version`
 *       (`repository.coffee:53-64`, `model.coffee:48-53`). This is the direct
 *       regression assertion for F-REG-05.
 *
 * TEST-LAYER ISOLATION
 *   No network, no browser, no UI framework. `../api/client` is fully mocked, so
 *   the real `fetch`-based adapter never runs. Jest globals
 *   (`describe`/`it`/`expect`/`jest`/`beforeEach`) come from the runner (jsdom
 *   environment configured in the root `jest.config.js`), so no Jest import is
 *   required.
 */

import { api } from '../api/client';
import {
    listMilestones,
    getMilestone,
    getMilestoneStats,
    createMilestone,
    saveMilestone,
} from '../api/milestones';

// Replace the transport adapter with jest.fn() stubs. The factory references no
// out-of-scope variables, so it is safe under jest's mock hoisting.
jest.mock('../api/client', () => ({
    api: {
        request: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
    },
}));

// Typed handles onto the mocked verb methods.
const requestMock = api.request as unknown as jest.Mock;
const getMock = api.get as unknown as jest.Mock;
const postMock = api.post as unknown as jest.Mock;
const patchMock = api.patch as unknown as jest.Mock;

/** Build a minimal `ApiResponse` with header lookups for listMilestones. */
function makeResponse(
    data: unknown,
    headers: Record<string, string> = {},
): { data: unknown; status: number; headers: { get(name: string): string | null } } {
    return {
        data,
        status: 200,
        headers: {
            get: (name: string): string | null => headers[name] ?? null,
        },
    };
}

beforeEach(() => {
    requestMock.mockReset();
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    // Sensible defaults so each wrapper's returned promise settles.
    requestMock.mockResolvedValue(makeResponse([]));
    getMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue(undefined);
    patchMock.mockResolvedValue(undefined);
});

/** The body (second argument) of the most recent `api.patch` call. */
function lastPatchBody(): Record<string, unknown> {
    return patchMock.mock.calls[patchMock.mock.calls.length - 1][1] as Record<string, unknown>;
}

describe('listMilestones', () => {
    it('GETs /milestones with a project param and parses the open/closed header totals', async () => {
        requestMock.mockResolvedValueOnce(
            makeResponse([{ id: 1 }, { id: 2 }], {
                'Taiga-Info-Total-Closed-Milestones': '3',
                'Taiga-Info-Total-Opened-Milestones': '5',
            }),
        );

        const result = await listMilestones(7);

        expect(requestMock).toHaveBeenCalledWith('GET', '/milestones', { params: { project: 7 } });
        expect(result.milestones).toEqual([{ id: 1 }, { id: 2 }]);
        expect(result.closed).toBe(3);
        expect(result.open).toBe(5);
    });

    it('merges extra filters after project', async () => {
        await listMilestones(7, { closed: false });

        expect(requestMock).toHaveBeenCalledWith('GET', '/milestones', {
            params: { project: 7, closed: false },
        });
    });

    it('defaults an absent/NaN header count to 0 (never surfaces NaN)', async () => {
        // No header values supplied → parseInt('' , 10) === NaN → coerced to 0.
        requestMock.mockResolvedValueOnce(makeResponse([{ id: 1 }]));

        const result = await listMilestones(7);

        expect(result.closed).toBe(0);
        expect(result.open).toBe(0);
    });

    it('tolerates a null data body (defaults to an empty array)', async () => {
        requestMock.mockResolvedValueOnce(makeResponse(null));

        const result = await listMilestones(7);

        expect(result.milestones).toEqual([]);
    });
});

describe('getMilestone / getMilestoneStats', () => {
    it('getMilestone GETs /milestones/{id}', async () => {
        await getMilestone(42);
        expect(getMock).toHaveBeenCalledWith('/milestones/42');
    });

    it('getMilestoneStats GETs /milestones/{id}/stats', async () => {
        await getMilestoneStats(42);
        expect(getMock).toHaveBeenCalledWith('/milestones/42/stats');
    });

    it('getMilestone resolves with the adapter payload', async () => {
        const milestone = { id: 42, name: 'S' };
        getMock.mockResolvedValueOnce(milestone);
        await expect(getMilestone(42)).resolves.toBe(milestone);
    });
});

describe('createMilestone', () => {
    it('POSTs /milestones with the create payload verbatim', async () => {
        const payload = {
            project: 7,
            name: 'Sprint 1',
            estimated_start: '2021-03-01',
            estimated_finish: '2021-03-14',
        };

        await createMilestone(payload);

        expect(postMock).toHaveBeenCalledTimes(1);
        expect(postMock).toHaveBeenCalledWith('/milestones', payload);
    });
});

describe('saveMilestone — minimal-diff PATCH parity (F-REG-05)', () => {
    it('PATCHes /milestones/{id} with EXACTLY the changed attributes + version', async () => {
        await saveMilestone(99, { name: 'Renamed' }, 4);

        expect(patchMock).toHaveBeenCalledTimes(1);
        const [url, body] = patchMock.mock.calls[0];
        expect(url).toBe('/milestones/99');
        // Only the changed `name` and the concurrency `version` — nothing else.
        expect(body).toEqual({ name: 'Renamed', version: 4 });
    });

    it('sends multiple changed fields together, still with version', async () => {
        await saveMilestone(5, { estimated_start: '2021-04-01', estimated_finish: '2021-04-14' }, 9);

        expect(lastPatchBody()).toEqual({
            estimated_start: '2021-04-01',
            estimated_finish: '2021-04-14',
            version: 9,
        });
    });

    it('omits version entirely when the caller has none to send', async () => {
        await saveMilestone(5, { name: 'X' });

        const body = lastPatchBody();
        expect(body).toEqual({ name: 'X' });
        expect(body).not.toHaveProperty('version');
    });

    it('never PATCHes whole-model / read-only fields — the body is only what was passed', async () => {
        // Even if a caller were to pass an over-broad object, the wrapper still
        // sends only those keys (plus version); this asserts the wrapper adds no
        // model fields of its own. The lightbox computes the true minimal diff.
        await saveMilestone(1, { name: 'Only' }, 2);

        const body = lastPatchBody();
        expect(Object.keys(body).sort()).toEqual(['name', 'version']);
        // Explicitly assert none of the classic read-only fields leaked in.
        expect(body).not.toHaveProperty('slug');
        expect(body).not.toHaveProperty('closed');
        expect(body).not.toHaveProperty('total_points');
        expect(body).not.toHaveProperty('created_date');
    });

    it('an empty diff yields a body of just version (a harmless backend no-op)', async () => {
        await saveMilestone(1, {}, 3);
        expect(lastPatchBody()).toEqual({ version: 3 });
    });
});
