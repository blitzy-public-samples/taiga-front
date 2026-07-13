/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React, { useCallback, useEffect, useRef } from "react";
import { t } from "../i18n/translate";

/**
 * Reusable modal (lightbox) shell that reproduces the legacy AngularJS lightbox
 * lifecycle and closes the accessibility gaps flagged by findings C2, M2, M3 and
 * M7 in ONE place:
 *
 *   - `.open` class toggling. The preserved theme (`styles/modules/common/
 *     lightbox.scss`) renders every `.lightbox` `display:none; opacity:0` and
 *     ONLY reveals it via `.lightbox.open` (`display:flex; opacity:1`). The
 *     earlier React hosts set an inline `display` and NEVER added `.open`, so
 *     they stayed at `opacity:0` (invisible) — finding C2. This shell drives
 *     visibility solely through the `.open` class, exactly like the legacy
 *     `lightboxService.open/close`.
 *   - Focus management: on open it records the invoking element and moves focus
 *     into the dialog (the `initialFocusSelector` field, else the first
 *     focusable); on close it restores focus to the invoker (M7).
 *   - Keyboard: `Escape` closes; `Tab`/`Shift+Tab` are trapped inside the dialog
 *     (M7).
 *   - Semantics: `role="dialog"`, `aria-modal`, and an accessible name (M7).
 *
 * The host node is ALWAYS mounted (so e2e host selectors and the marker
 * attribute resolve before the opening click), while the CONTENT renders only
 * while open — mirroring the legacy `form(ng-if="lightboxOpen")` so form state
 * resets on each open.
 */
export interface LightboxProps {
    /** Whether the lightbox is open (drives the `.open` class + content mount). */
    open: boolean;
    /** Close request (Escape, the close control, or a completed action). */
    onClose: () => void;
    /** Extra class tokens appended after the base `lightbox` (e.g. variant classes). */
    className?: string;
    /**
     * Legacy directive marker rendered as an inert boolean attribute on the host
     * (e.g. `tg-lb-create-edit-userstory`) so the existing e2e host selectors and
     * any theme attribute selectors still resolve. Applied via a ref so arbitrary
     * hyphenated attribute names do not fight the typed JSX prop surface.
     */
    markerAttr?: string;
    /** Accessible name for the dialog (used when `labelledById` is absent). */
    ariaLabel?: string;
    /** Id of the element (e.g. the title `h2`) naming the dialog. */
    labelledById?: string;
    /** CSS selector (within the dialog) for the field to focus first on open. */
    initialFocusSelector?: string;
    /** Whether to render the built-in `.close` control (legacy `tg-lightbox-close`). */
    showClose?: boolean;
    /** The dialog content; rendered ONLY while open. */
    children?: React.ReactNode;
}

/** Selector matching the tabbable elements used for the focus trap + initial focus. */
const FOCUSABLE_SELECTOR = [
    "a[href]",
    "area[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "button:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Join truthy class tokens (local `ng-class` equivalent; no dependency). */
function cx(...tokens: Array<string | false | null | undefined>): string {
    return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

export function Lightbox(props: LightboxProps): React.ReactElement {
    const {
        open,
        onClose,
        className,
        markerAttr,
        ariaLabel,
        labelledById,
        initialFocusSelector,
        showClose = true,
        children,
    } = props;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const invokerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef<boolean>(false);

    // Apply the legacy directive marker attribute imperatively so arbitrary
    // hyphenated names (e.g. `tg-lb-assignedto`) need no JSX typing gymnastics.
    useEffect(() => {
        const el = rootRef.current;
        if (el !== null && markerAttr !== undefined && markerAttr.length > 0) {
            el.setAttribute(markerAttr, "");
        }
    }, [markerAttr]);

    // Focus lifecycle: capture the invoker + focus into the dialog on open;
    // restore focus to the invoker on close.
    useEffect(() => {
        const el = rootRef.current;
        if (open && !wasOpenRef.current) {
            invokerRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (el !== null) {
                const initial =
                    initialFocusSelector !== undefined
                        ? el.querySelector<HTMLElement>(initialFocusSelector)
                        : null;
                const target =
                    initial ?? el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? el;
                target.focus();
            }
        } else if (!open && wasOpenRef.current) {
            invokerRef.current?.focus();
            invokerRef.current = null;
        }
        wasOpenRef.current = open;
    }, [open, initialFocusSelector]);

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== "Tab") {
                return;
            }
            const el = rootRef.current;
            if (el === null) {
                return;
            }
            const focusables = Array.from(
                el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
            ).filter((node) => node.getAttribute("aria-hidden") !== "true");
            if (focusables.length === 0) {
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        },
        [onClose],
    );

    const handleCloseClick = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            onClose();
        },
        [onClose],
    );

    const closeTitle = t("COMMON.CLOSE");

    return (
        <div
            ref={rootRef}
            className={cx("lightbox", className, open && "open")}
            role="dialog"
            aria-modal="true"
            aria-hidden={open ? undefined : "true"}
            aria-label={labelledById === undefined ? ariaLabel : undefined}
            aria-labelledby={labelledById}
            tabIndex={-1}
            onKeyDown={onKeyDown}
        >
            {open ? (
                <>
                    {showClose ? (
                        <a
                            href="#"
                            className="close"
                            title={closeTitle}
                            aria-label={closeTitle}
                            onClick={handleCloseClick}
                        >
                            <span className="icon icon-close" aria-hidden="true" />
                        </a>
                    ) : null}
                    {children}
                </>
            ) : null}
        </div>
    );
}

export default Lightbox;
