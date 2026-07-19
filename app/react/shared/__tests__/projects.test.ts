/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the `getProjectBySlug` adapter (`app/react/shared/api/projects.ts`).
 *
 * The adapter reproduces the AngularJS `service.bySlug(slug)` →
 * `GET /projects/by_slug?slug=<slug>`, the same endpoint the shell uses to
 * resolve the current project. `../api/client` is fully mocked so no real
 * `/api/v1/` transport, session reader, or network call is loaded — the mapping
 * from arguments to the HTTP verb + path + query params is verified in isolation.
 */

import { api } from '../api/client';
import { getProjectBySlug } from '../api/projects';
import type { Project } from '../types';

// Replace the transport adapter with jest.fn() stubs. The factory references no
// out-of-scope variables, so it is safe under jest's mock hoisting.
jest.mock('../api/client', () => ({
    api: {
        get: jest.fn(),
    },
}));

const getMock = api.get as unknown as jest.Mock;

beforeEach(() => {
    getMock.mockReset();
});

describe('getProjectBySlug', () => {
    it('issues GET /projects/by_slug with the slug as a query parameter', async () => {
        const project = { id: 7, slug: 'proj-7', my_permissions: [], archived_code: null } as Project;
        getMock.mockResolvedValue(project);

        const result = await getProjectBySlug('proj-7');

        expect(getMock).toHaveBeenCalledTimes(1);
        expect(getMock).toHaveBeenCalledWith('/projects/by_slug', { slug: 'proj-7' });
        expect(result).toBe(project);
    });

    it('forwards the resolved project id to the caller', async () => {
        getMock.mockResolvedValue({ id: 42, slug: 'x', my_permissions: [], archived_code: null } as Project);

        const result = await getProjectBySlug('x');

        expect(result.id).toBe(42);
    });

    it('propagates a transport rejection (the caller decides how to degrade)', async () => {
        getMock.mockRejectedValue(new Error('404'));

        await expect(getProjectBySlug('missing')).rejects.toThrow('404');
    });
});
