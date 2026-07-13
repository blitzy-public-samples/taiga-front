/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Popover lifecycle hook reproducing the legacy AngularJS `$tgPopover`
 * (`app/coffee/modules/common/popover.coffee`) behaviour that every backlog /
 * sprint row control relied on, closing the gaps flagged by findings M4 and M7:
 *
 *   - GLOBAL single-active: opening ANY popover closes whichever popover was
 *     previously open — anywhere on the screen, across every row and component.
 *     The legacy popover service kept a single open popover; the first React
 *     version used per-row `useState`, so two rows could each hold an open
 *     `.popover.active` at once (M4). A module-level registry restores the
 *     single-active invariant.
 *   - Outside-click: a capture-phase `mousedown` anywhere outside BOTH the
 *     trigger and the popover content closes it (M4/M7).
 *   - Escape: closes the popover and restores focus to the trigger (M4/M7).
 *   - Focus management: on open, focus moves to the first focusable element in
 *     the popover content (M7).
 *
 * Usage: attach `triggerRef` to the control that opens the popover and
 * `contentRef` to the popover container; call `toggle()` from the trigger's
 * click handler and render the content while `open` is `true`.
 */
export interface UsePopoverResult {
    /** Whether this popover is currently open. */
    open: boolean;
    /** Toggle this popover (opening it closes any other open popover). */
    toggle: () => void;
    /** Close this popover. */
    close: () => void;
    /** Attach to the trigger element (click target + focus-restore target). */
    triggerRef: React.MutableRefObject<HTMLElement | null>;
    /** Attach to the popover content container (outside-click + focus scope). */
    contentRef: React.MutableRefObject<HTMLElement | null>;
}

/** Selector matching the focusable elements used for initial focus on open. */
const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * The close callback of the single currently-open popover, shared across every
 * `usePopover` instance so opening one closes the other (global single-active).
 * `null` when no popover is open.
 */
let currentClose: (() => void) | null = null;

/**
 * Reset the module-level open-popover registry. Intended for test isolation so
 * a popover left "open" in one test never leaks its close callback into the
 * next. Not used by production code.
 */
export function __resetPopoverRegistry(): void {
    currentClose = null;
}

export function usePopover(): UsePopoverResult {
    const [open, setOpen] = useState<boolean>(false);
    const triggerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);
    // The content element we last set `display:block` on, so its display can be
    // restored when the popover closes OR its content element is swapped (two-step
    // popovers change the content element WITHOUT toggling `open`).
    const displayedRef = useRef<HTMLElement | null>(null);
    // A stable identity for THIS popover's close callback so the registry can
    // tell whether it still owns the "currently open" slot.
    const closeRef = useRef<() => void>(() => undefined);
    const openRef = useRef<boolean>(false);
    openRef.current = open;

    const close = useCallback((): void => {
        setOpen(false);
        if (currentClose === closeRef.current) {
            currentClose = null;
        }
    }, []);
    closeRef.current = close;

    const toggle = useCallback((): void => {
        if (openRef.current) {
            close();
            return;
        }
        // Opening: close any OTHER popover first, then claim the open slot.
        if (currentClose !== null && currentClose !== closeRef.current) {
            currentClose();
        }
        currentClose = closeRef.current;
        setOpen(true);
    }, [close]);

    // Popover VISIBILITY. The preserved theme defaults every `.popover` / `.pop-*`
    // container to `display:none` and has NO `.active { display:block }` rule (the
    // `.active` class only colors the selected anchor); the legacy `popovers.coffee`
    // service made a popover visible by imperatively setting `display:block` on its
    // container. Reproduce that. This effect runs after EVERY render (no dependency
    // array) so a TWO-STEP popover — which swaps its content element WITHOUT toggling
    // `open` (e.g. the backlog points role->points step) — also shows the newly
    // rendered element. `displayedRef` remembers the element we styled so its display
    // is restored when the popover closes or the element swaps (for consumers that
    // keep the container mounted).
    useEffect(() => {
        const content = contentRef.current;
        if (open && content !== null) {
            if (displayedRef.current !== null && displayedRef.current !== content) {
                displayedRef.current.style.display = "";
            }
            content.style.display = "block";
            displayedRef.current = content;
        } else if (displayedRef.current !== null) {
            displayedRef.current.style.display = "";
            displayedRef.current = null;
        }
    });

    // Outside-click + Escape + initial focus, active only while open.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target === null) {
                return;
            }
            if (
                contentRef.current?.contains(target) === true ||
                triggerRef.current?.contains(target) === true
            ) {
                return;
            }
            close();
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                close();
                triggerRef.current?.focus();
            }
        };

        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);

        // Move focus into the popover (first focusable element), matching the
        // legacy popover which focused its content on open.
        const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        first?.focus();

        return () => {
            document.removeEventListener("mousedown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [open, close]);

    // Release the global slot if this popover unmounts while open.
    useEffect(
        () => () => {
            if (currentClose === closeRef.current) {
                currentClose = null;
            }
        },
        [],
    );

    return { open, toggle, close, triggerRef, contentRef };
}
