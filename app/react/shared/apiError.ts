/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared helpers that turn a rejected `/api/v1/` call into an ACTIONABLE,
 * user-facing message — never leaking internal stack details (QA dest#8:
 * "actionable user-facing state without internal details").
 *
 * Extracted so BOTH the Backlog (`useBacklog`) and Kanban (`useKanbanBoard`)
 * drag-and-drop pipelines surface a failed reorder identically. Previously this
 * logic lived privately inside `useBacklog`, so the Kanban `move()` catch could
 * only reconcile the board silently. Centralising it lets Kanban reuse the same
 * wording and envelope-parsing while keeping the message contract in one place.
 */

import { ApiError } from './api/client';

/**
 * Extract a human-readable message from a rejected `/api/v1/` call. Parses the
 * Django REST error envelope (`_error_message` / `__all__`, string or array)
 * carried on {@link ApiError.body}, then falls back to a plain `Error.message`,
 * and finally returns `null` so the caller can supply its own default.
 *
 * Deliberately returns only the server-supplied field message or a plain
 * `Error.message` — never a stack trace or the raw response object — so callers
 * can present it directly to end users.
 */
export function parseApiErrorMessage(err: unknown): string | null {
    if (err instanceof ApiError && err.body !== null && typeof err.body === 'object') {
        const body = err.body as Record<string, unknown>;
        const detail = body._error_message ?? body.__all__;
        if (typeof detail === 'string' && detail.trim() !== '') {
            return detail;
        }
        if (Array.isArray(detail) && typeof detail[0] === 'string' && detail[0].trim() !== '') {
            return detail[0];
        }
    }

    if (err instanceof Error && err.message.trim() !== '') {
        return err.message;
    }

    return null;
}

/**
 * Describe a failed drag-and-drop reorder / move. Prefers the server-supplied
 * message, otherwise the shared fallback that also tells the user the board has
 * been reconciled to server truth (both boards reload-on-error, so the
 * optimistic move is visibly reverted).
 */
export function describeReorderError(err: unknown): string {
    const fallback =
        'The story order could not be saved. The board has been refreshed to the latest server state.';
    return parseApiErrorMessage(err) ?? fallback;
}
