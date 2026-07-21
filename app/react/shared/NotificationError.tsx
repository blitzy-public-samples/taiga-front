/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * NotificationError — a dismissible, user-facing error toast (render-only).
 *
 * QA dest#8: a failed drag-and-drop mutation previously reconciled the board
 * silently (the `catch` reloaded from the server but surfaced no UI). This
 * component renders the ACTIONABLE error state the checkpoint requires, reusing
 * Taiga's EXISTING global error-toast SCSS (`.notification-message
 * .notification-message-error`, `app/styles/components/notification-message.scss`
 * — the same red slide-down banner the AngularJS `$confirm.notify('error', …)`
 * service used) for visual fidelity. It imports/rewrites no SCSS.
 *
 * Purely presentational: it renders nothing when `message` is falsy, and calls
 * `onClose` when the user clicks the close affordance. It is announced to
 * assistive tech via `role="alert"` + `aria-live="assertive"`.
 *
 * Shared by BOTH `KanbanApp` and `BacklogApp` so a failed reorder is surfaced
 * identically on both migrated screens. Uses the `jsx: "react-jsx"` automatic
 * runtime (no `import React`).
 */

import { TgIcon } from './icon';

/** Props for {@link NotificationError}. */
export interface NotificationErrorProps {
    /** The message to display; when null/empty the toast renders nothing. */
    message: string | null | undefined;
    /** Invoked when the user dismisses the toast (clears the source state). */
    onClose: () => void;
}

/**
 * The error toast. Rendered only while `message` is a non-empty string. The
 * `active` modifier applies the SCSS slide-in transform so the banner animates
 * down from the top exactly as the legacy notification did.
 */
export function NotificationError({ message, onClose }: NotificationErrorProps) {
    if (!message) {
        return null;
    }

    return (
        <div
            className="notification-message notification-message-error active js-move-error"
            role="alert"
            aria-live="assertive"
        >
            <TgIcon name="icon-error" />
            <span className="text">
                <p>{message}</p>
            </span>
            <a
                className="close"
                role="button"
                tabIndex={0}
                aria-label="Dismiss error"
                onClick={onClose}
                onKeyDown={(e) => {
                    // Keyboard-dismiss (Enter / Space) for accessibility parity.
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                    }
                }}
            >
                <TgIcon name="icon-close" />
            </a>
        </div>
    );
}
