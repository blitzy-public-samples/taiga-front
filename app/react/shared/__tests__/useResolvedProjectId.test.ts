/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for `useResolvedProjectId` (F-REG-01 — the blank-board fix).
 *
 * The hook gives the Kanban / Backlog containers a VALID numeric project id,
 * resolving it from the URL slug when the hosting custom element carries an
 * empty `project-id` (the production case, because the deleted controllers no
 * longer populate the AngularJS `project` scope var). These specs cover:
 *   - the FAST PATH (a valid `project-id` attribute is used directly, no lookup);
 *   - resolution from the `project-slug` prop and from `window.location`;
 *   - the `resolving` window and the settled invalid state;
 *   - rejection of empty / unresolved-interpolation slugs; and
 *   - a swallowed lookup failure.
 *
 * `./api/projects` (`getProjectBySlug`) is mocked so NO real `/api/v1/` client,
 * session reader, or network call is loaded — the hook logic is tested in
 * isolation, browserless, under jsdom.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

import { useResolvedProjectId } from '../useResolvedProjectId';
import { getProjectBySlug } from '../api/projects';
import type { Project } from '../types';

jest.mock('../api/projects', () => ({
    __esModule: true,
    getProjectBySlug: jest.fn(),
}));

const mockGetProjectBySlug = getProjectBySlug as jest.MockedFunction<typeof getProjectBySlug>;

/** Build a minimal `Project` (only `id` is read by the hook). */
function projectWithId(id: number): Project {
    return { id, slug: `slug-${id}`, my_permissions: [], archived_code: null } as Project;
}

/** Reset the jsdom URL to the origin root between tests. */
function resetLocation(): void {
    window.history.pushState({}, '', '/');
}

beforeEach(() => {
    mockGetProjectBySlug.mockReset();
    resetLocation();
});

afterEach(() => {
    resetLocation();
});

describe('useResolvedProjectId', () => {
    describe('fast path — a valid project-id attribute', () => {
        it('uses a positive-integer project-id directly with NO by_slug lookup', async () => {
            const { result } = renderHook(() => useResolvedProjectId({ projectId: '7' }));

            // Synchronously valid — no loading window, no network call.
            expect(result.current.projectId).toBe(7);
            expect(result.current.projectIdValid).toBe(true);
            expect(result.current.resolving).toBe(false);

            // Let the mount effect run; it must still not call the lookup.
            await act(async () => {
                await Promise.resolve();
            });
            expect(mockGetProjectBySlug).not.toHaveBeenCalled();
        });

        it('honors a valid project-id even when a slug is also present', async () => {
            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '12', projectSlug: 'ignored' }),
            );

            expect(result.current.projectId).toBe(12);
            expect(result.current.projectIdValid).toBe(true);
            await act(async () => {
                await Promise.resolve();
            });
            expect(mockGetProjectBySlug).not.toHaveBeenCalled();
        });
    });

    describe('slow path — resolve via the project-slug prop', () => {
        it('starts resolving and settles to the id returned by by_slug', async () => {
            mockGetProjectBySlug.mockResolvedValue(projectWithId(42));

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: 'proj-42' }),
            );

            // Initially resolving (empty id) — the container renders a loading shell.
            expect(result.current.projectIdValid).toBe(false);
            expect(result.current.resolving).toBe(true);

            await waitFor(() => expect(result.current.projectIdValid).toBe(true));
            expect(result.current.projectId).toBe(42);
            expect(result.current.resolving).toBe(false);
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('proj-42');
        });

        it('trims a padded slug before the lookup', async () => {
            mockGetProjectBySlug.mockResolvedValue(projectWithId(5));

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: '  spaced  ' }),
            );

            await waitFor(() => expect(result.current.projectId).toBe(5));
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('spaced');
        });
    });

    describe('slow path — resolve the slug from the URL', () => {
        it('parses /project/<slug>/kanban from the pathname and resolves it', async () => {
            window.history.pushState({}, '', '/project/url-slug/kanban');
            mockGetProjectBySlug.mockResolvedValue(projectWithId(99));

            const { result } = renderHook(() => useResolvedProjectId({ projectId: '' }));

            await waitFor(() => expect(result.current.projectId).toBe(99));
            expect(result.current.projectIdValid).toBe(true);
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('url-slug');
        });

        it('parses /project/<slug>/backlog from the pathname', async () => {
            window.history.pushState({}, '', '/project/another-slug/backlog');
            mockGetProjectBySlug.mockResolvedValue(projectWithId(3));

            const { result } = renderHook(() => useResolvedProjectId({ projectId: undefined }));

            await waitFor(() => expect(result.current.projectId).toBe(3));
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('another-slug');
        });

        it('prefers the project-slug prop over the URL when both are present', async () => {
            window.history.pushState({}, '', '/project/from-url/kanban');
            mockGetProjectBySlug.mockResolvedValue(projectWithId(7));

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: 'from-prop' }),
            );

            await waitFor(() => expect(result.current.projectId).toBe(7));
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('from-prop');
        });
    });

    describe('unresolvable / invalid inputs', () => {
        it('settles to an invalid, non-resolving state when no slug is available', async () => {
            // URL is the origin root ("/") and there is no slug prop.
            const { result } = renderHook(() => useResolvedProjectId({ projectId: '' }));

            await waitFor(() => expect(result.current.resolving).toBe(false));
            expect(result.current.projectId).toBe(0);
            expect(result.current.projectIdValid).toBe(false);
            expect(mockGetProjectBySlug).not.toHaveBeenCalled();
        });

        it('rejects the unresolved AngularJS interpolation literal slug and falls back to the URL', async () => {
            window.history.pushState({}, '', '/project/real-slug/kanban');
            mockGetProjectBySlug.mockResolvedValue(projectWithId(8));

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: '{{project.slug}}' }),
            );

            await waitFor(() => expect(result.current.projectId).toBe(8));
            // The literal was rejected; the URL slug was used instead.
            expect(mockGetProjectBySlug).toHaveBeenCalledWith('real-slug');
        });

        it('swallows a by_slug lookup failure and settles to an invalid state', async () => {
            mockGetProjectBySlug.mockRejectedValue(new Error('boom'));

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: 'proj-x' }),
            );

            await waitFor(() => expect(result.current.resolving).toBe(false));
            expect(result.current.projectId).toBe(0);
            expect(result.current.projectIdValid).toBe(false);
        });

        it('ignores a by_slug result that lacks a valid id', async () => {
            mockGetProjectBySlug.mockResolvedValue({ id: 0 } as Project);

            const { result } = renderHook(() =>
                useResolvedProjectId({ projectId: '', projectSlug: 'proj-zero' }),
            );

            await waitFor(() => expect(result.current.resolving).toBe(false));
            expect(result.current.projectIdValid).toBe(false);
        });
    });

    describe('reacting to a later valid attribute', () => {
        it('adopts a real project-id delivered after mount (attributeChangedCallback)', async () => {
            // Simulates AngularJS writing the resolved id onto the attribute AFTER
            // the element first connected with an empty value.
            const { result, rerender } = renderHook(
                (props: { projectId?: string }) => useResolvedProjectId(props),
                { initialProps: { projectId: '' } },
            );

            await waitFor(() => expect(result.current.resolving).toBe(false));
            expect(result.current.projectIdValid).toBe(false);

            rerender({ projectId: '15' });

            await waitFor(() => expect(result.current.projectIdValid).toBe(true));
            expect(result.current.projectId).toBe(15);
            expect(result.current.resolving).toBe(false);
        });
    });
});
