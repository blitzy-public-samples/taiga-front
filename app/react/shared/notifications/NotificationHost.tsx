/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Renders the non-blocking user notifications emitted onto the shared bus
 * (`notificationCenter`). QA finding [ERR-1]: recoverable failures on the React
 * Backlog/Kanban screens were routed to `console.error` only, leaving the user
 * with NO feedback. This host subscribes to the bus and renders each
 * notification, then auto-dismisses it.
 *
 * FIDELITY: the DOM reproduces the class names the AngularJS notification
 * component emits (`app/partials/includes/components/notification-message.jade`)
 * so the already-compiled `styles/components/notification-message.scss` themes
 * it unchanged:
 *   - error  → `.notification-message.notification-message-error.active`
 *              (top full-width red banner, dismissible)
 *   - success/info → `.notification-message.notification-message-success.active`
 *              (top-right slide-in card)
 * The `.active` modifier is what the SCSS keys the reveal animation / opacity on
 * (the base `.notification-message` rule is `opacity:0`), mirroring how
 * `confirm.coffee` toggled the class in AngularJS.
 *
 * ACCESSIBILITY: errors use `role="alert"` (assertive) and success/info use
 * `role="status"` (polite) so assistive tech announces them.
 */

import { useEffect, useState } from "react";

import type { AppNotification } from "./notificationCenter";
import { subscribeNotifications } from "./notificationCenter";
import { t } from "../i18n/translate";

/** How long (ms) a notification stays before auto-dismiss, per level. */
const AUTO_DISMISS_MS: Record<AppNotification["level"], number> = {
    // Errors linger longer (the user may need to react) but still auto-clear so
    // the banner never wedges the board; both remain manually dismissible.
    error: 8000,
    success: 4000,
    info: 4000,
};

/**
 * Title shown in the notification `h4.warning`, per level. Routed through the
 * shared catalog ([i18n]) at render time (NOT module load, which runs before
 * `angular.bootstrap`); the English string is the fallback for the default
 * language and for jsdom. `NOTIFICATION.ERROR/SUCCESS/NOTICE` are not yet in the
 * catalog, so today they resolve to the English fallback everywhere.
 */
const TITLE_I18N: Record<AppNotification["level"], { key: string; fallback: string }> = {
    error: { key: "NOTIFICATION.ERROR", fallback: "Error" },
    success: { key: "NOTIFICATION.SUCCESS", fallback: "Success" },
    info: { key: "NOTIFICATION.NOTICE", fallback: "Notice" },
};

/** Map a bus level to the AngularJS notification style suffix. */
function variantOf(level: AppNotification["level"]): "error" | "success" {
    return level === "error" ? "error" : "success";
}

/**
 * Subscribe to the notification bus and render the active notifications. Renders
 * nothing (returns `null`) when the queue is empty, so it is inert on the happy
 * path. Safe to mount once per React root.
 */
export function NotificationHost(): JSX.Element | null {
    const [items, setItems] = useState<AppNotification[]>([]);

    useEffect(() => {
        const unsubscribe = subscribeNotifications((notification) => {
            setItems((current) => [...current, notification]);
        });
        return unsubscribe;
    }, []);

    // Per-notification auto-dismiss timer, cleared on unmount / queue change so a
    // late timer can never fire against an unmounted tree (no act() warnings).
    useEffect(() => {
        if (items.length === 0) {
            return undefined;
        }

        const timers = items.map((notification) =>
            window.setTimeout(() => {
                setItems((current) => current.filter((n) => n.id !== notification.id));
            }, AUTO_DISMISS_MS[notification.level]),
        );

        return () => {
            for (const timer of timers) {
                window.clearTimeout(timer);
            }
        };
    }, [items]);

    if (items.length === 0) {
        return null;
    }

    const dismiss = (id: number): void => {
        setItems((current) => current.filter((n) => n.id !== id));
    };

    return (
        <div className="notification-messages" data-testid="notification-host">
            {items.map((notification) => {
                const variant = variantOf(notification.level);
                return (
                    <div
                        key={notification.id}
                        className={`notification-message notification-message-${variant} active`}
                        role={variant === "error" ? "alert" : "status"}
                    >
                        {variant === "error" ? (
                            <span className="icon icon-error" aria-hidden="true" />
                        ) : null}
                        <div className="text">
                            <h4 className="warning">
                                {t(
                                    TITLE_I18N[notification.level].key,
                                    TITLE_I18N[notification.level].fallback,
                                )}
                            </h4>
                            <p>{notification.message}</p>
                        </div>
                        <button
                            type="button"
                            className="close"
                            aria-label={t("NOTIFICATION.CLOSE", "Close notification")}
                            onClick={() => {
                                dismiss(notification.id);
                            }}
                        >
                            <span className="icon icon-close" aria-hidden="true" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
