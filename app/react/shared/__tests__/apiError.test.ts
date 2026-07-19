/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/apiError.ts` — the
 * shared helpers that turn a rejected `/api/v1/` call into an ACTIONABLE,
 * user-facing message (QA dest#8) WITHOUT leaking internal stack details.
 *
 * Both the Kanban (`useKanbanBoard.move`) and Backlog (`useBacklog`) drag-and-
 * drop pipelines depend on this to surface a failed reorder identically, so the
 * envelope-parsing and fallback wording are pinned here.
 */

import { parseApiErrorMessage, describeReorderError } from '../apiError';
import { ApiError } from '../api/client';

describe('parseApiErrorMessage', () => {
    it('extracts the Django REST `_error_message` string from an ApiError body', () => {
        const err = new ApiError(400, { _error_message: 'You cannot move this story.' });
        expect(parseApiErrorMessage(err)).toBe('You cannot move this story.');
    });

    it('extracts the first `__all__` array entry when `_error_message` is absent', () => {
        const err = new ApiError(400, { __all__: ['Order is stale, refresh first.', 'ignored'] });
        expect(parseApiErrorMessage(err)).toBe('Order is stale, refresh first.');
    });

    it('prefers `_error_message` over `__all__` when both are present', () => {
        const err = new ApiError(400, {
            _error_message: 'primary detail',
            __all__: ['secondary detail'],
        });
        expect(parseApiErrorMessage(err)).toBe('primary detail');
    });

    it('ignores a blank/whitespace envelope detail and falls back to the ApiError generic message', () => {
        // ApiError extends Error, so a blank `_error_message` is skipped and the
        // generic (non-leaking) status message is surfaced instead of null.
        const err = new ApiError(500, { _error_message: '   ' });
        expect(parseApiErrorMessage(err)).toBe('Request failed with status 500');
    });

    it('returns null for a plain (non-Error) object whose only envelope detail is blank', () => {
        // Not an ApiError and not an Error -> no usable message at all -> null.
        expect(parseApiErrorMessage({ _error_message: '   ' })).toBeNull();
    });

    it('falls back to a plain Error.message for a non-ApiError rejection', () => {
        expect(parseApiErrorMessage(new Error('Network request failed'))).toBe(
            'Network request failed',
        );
    });

    it('surfaces the generic status message (never the raw body) for an ApiError with a non-object body', () => {
        const err = new ApiError(503, 'Service Unavailable');
        // The generic Error.message ("Request failed with status 503") is still
        // a plain message, so it is surfaced — but never the raw body object.
        expect(parseApiErrorMessage(err)).toBe('Request failed with status 503');
    });

    it('returns null when there is no message and no usable envelope', () => {
        expect(parseApiErrorMessage({ anything: true })).toBeNull();
        expect(parseApiErrorMessage(null)).toBeNull();
        expect(parseApiErrorMessage(undefined)).toBeNull();
    });

    it('never leaks a stack trace (returns only the message string)', () => {
        const err = new Error('boom');
        const msg = parseApiErrorMessage(err);
        expect(msg).toBe('boom');
        expect(msg).not.toContain('at ');
    });
});

describe('describeReorderError', () => {
    const FALLBACK =
        'The story order could not be saved. The board has been refreshed to the latest server state.';

    it('surfaces the server-supplied message when present', () => {
        const err = new ApiError(400, { _error_message: 'Sprint is closed.' });
        expect(describeReorderError(err)).toBe('Sprint is closed.');
    });

    it('falls back to the generic reconcile sentence when no server detail exists', () => {
        expect(describeReorderError({ weird: 'shape' })).toBe(FALLBACK);
        expect(describeReorderError(null)).toBe(FALLBACK);
    });

    it('uses a plain Error.message when that is all that is available', () => {
        expect(describeReorderError(new Error('Failed to fetch'))).toBe('Failed to fetch');
    });
});
