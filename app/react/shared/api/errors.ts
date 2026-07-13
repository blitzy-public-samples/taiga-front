/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { ApiError } from "./http";

/**
 * Derive a concise, user-safe message from a thrown value (finding M2).
 *
 * The legacy screens surfaced failures with a generic `confirm.notify("error")`
 * toast, preferring the backend's own `_error_message` when present
 * (`backlog/lightboxes.coffee`). The first React implementation instead stashed
 * the RAW thrown value (an `ApiError` carrying the full parsed response body, or
 * an arbitrary `Error`) straight into state — which a view could stringify into
 * the DOM, leaking internal detail and never giving the user a readable message.
 *
 * This sanitizer:
 *   - prefers the backend's `_error_message` string (exactly what Taiga shows);
 *   - otherwise maps the HTTP status onto a short, safe sentence;
 *   - never exposes stack traces, headers, tokens, or the raw JSON body.
 *
 * It is deliberately English-literal (matching the legacy generic toast); the
 * component-level i18n work (finding M7) can key these later without changing
 * the call sites.
 */
export function sanitizeErrorMessage(error: unknown): string {
    const generic = "Something went wrong. Please try again.";

    if (error instanceof ApiError) {
        // Prefer the backend's own user-facing message when it is a plain string.
        const data = error.data;
        if (data && typeof data === "object") {
            const detail = (data as { _error_message?: unknown })._error_message;
            if (typeof detail === "string" && detail.trim().length > 0) {
                return detail.trim();
            }
        } else if (typeof data === "string" && data.trim().length > 0 && data.length <= 300) {
            return data.trim();
        }

        switch (error.status) {
            case 400:
            case 422:
                return "The request was invalid. Please check the values and try again.";
            case 401:
                return "Your session has expired. Please sign in again.";
            case 403:
                return "You don't have permission to perform this action.";
            case 404:
                return "The requested item could not be found.";
            case 409:
                return "This item was changed elsewhere. Please reload and try again.";
            default:
                if (error.status >= 500) {
                    return "The server encountered an error. Please try again later.";
                }
                return generic;
        }
    }

    return generic;
}
