/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A pending delete-confirmation request.
 *
 * `subject` is the human-readable label shown in the confirmation modal (the
 * user-story subject); `target` is the opaque payload handed back to the
 * caller's `run` handler when the user confirms.
 */
export interface PendingDelete<T> {
    /** Opaque payload passed to `run` on confirm (e.g. a us id, or the story). */
    target: T;
    /** Escaped label rendered in the confirmation modal. */
    subject: string;
}

/** Controller returned by {@link usePendingDelete}. */
export interface PendingDeleteController<T> {
    /** The in-flight confirmation, or `null` when the modal is closed. */
    pending: PendingDelete<T> | null;
    /** `true` while the confirmed delete is running (gates the confirm button). */
    busy: boolean;
    /** Open the confirmation modal for `target`, labelled with `subject`. */
    request: (target: T, subject: string) => void;
    /** Dismiss the modal WITHOUT deleting (legacy cancel path — a pure no-op). */
    cancel: () => void;
    /** Run the delete for the pending target, then close the modal. */
    confirm: () => void;
}

/**
 * Shared confirm-before-delete controller (finding C7).
 *
 * It reproduces the legacy `$confirm.askOnDelete(...).then(...)` promise flow
 * that both `KanbanController.deleteUs` and `BacklogController.deleteUserStory`
 * relied on: NOTHING is mutated until the user explicitly confirms; `cancel` is
 * a pure no-op (no request is ever issued); and the modal closes once the delete
 * settles — mirroring `askResponse.finish()` on success AND `askResponse.finish(false)`
 * on failure (the legacy dialog closed in both cases and surfaced errors through
 * the separate notification channel, which the feature hooks reproduce via their
 * own optimistic rollback + `reportError`).
 *
 * The caller's `run` OWNS the actual mutation: the optimistic remove, the
 * `DELETE` request, and the rollback + error surfacing on rejection. This hook
 * only sequences the confirmation gate and the busy/open state around it, so the
 * Kanban and Backlog screens share one identical, fully-localized confirmation
 * instead of the previous unconfirmed delete (Kanban) and hard-coded English
 * `window.confirm` (Backlog).
 *
 * `run` is captured through a ref so an unstable inline handler does not
 * recreate `confirm` (which would otherwise churn the consuming VM identity).
 */
export function usePendingDelete<T>(
    run: (target: T) => Promise<void>,
): PendingDeleteController<T> {
    const [pending, setPending] = useState<PendingDelete<T> | null>(null);
    const [busy, setBusy] = useState(false);
    const pendingRef = useRef<PendingDelete<T> | null>(null);
    const busyRef = useRef(false);
    const runRef = useRef(run);

    useEffect(() => {
        runRef.current = run;
    }, [run]);

    const request = useCallback((target: T, subject: string): void => {
        // Never replace a request that is already being deleted (double-click /
        // rapid re-trigger safety); the modal is showing the busy state.
        if (busyRef.current) {
            return;
        }
        const next: PendingDelete<T> = { target, subject };
        pendingRef.current = next;
        setPending(next);
    }, []);

    const cancel = useCallback((): void => {
        // Ignore cancel while a confirmed delete is mid-flight so the optimistic
        // mutation + rollback own the modal lifecycle uninterrupted.
        if (busyRef.current) {
            return;
        }
        pendingRef.current = null;
        setPending(null);
    }, []);

    const confirm = useCallback((): void => {
        const current = pendingRef.current;
        if (!current || busyRef.current) {
            return;
        }
        busyRef.current = true;
        setBusy(true);
        // The caller's `run` performs the optimistic remove + DELETE and OWNS the
        // rollback + error surfacing on rejection. We ALWAYS close afterwards
        // (legacy closed the confirm dialog on both success and error). Wrapping
        // in `Promise.resolve` tolerates a synchronous `run` in tests, and the
        // `catch` guarantees a rejecting `run` can never escape as an unhandled
        // rejection — the caller has already reported it through its own channel.
        void Promise.resolve()
            .then(() => runRef.current(current.target))
            .catch(() => undefined)
            .finally(() => {
                busyRef.current = false;
                setBusy(false);
                pendingRef.current = null;
                setPending(null);
            });
    }, []);

    return { pending, busy, request, cancel, confirm };
}
