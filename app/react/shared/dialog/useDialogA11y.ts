/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useDialogA11y — the single shared modal-accessibility primitive for the React
 * screens (QA finding M-09).
 *
 * The migrated lightboxes (kanban/backlog `UserStoryEditLightbox`,
 * `BulkUserStoriesLightbox`, `SprintEditLightbox`) and the shared
 * {@link ConfirmDialog} each render a bespoke `div.lightbox…` root whose class
 * names the compiled SCSS themes (visual parity by construction — AAP §0.3.4),
 * so a wrapper component that reshaped the DOM would break theming. This hook
 * instead layers the COMPLETE modal-dialog behavior onto whatever element the
 * caller already renders, giving every dialog identical semantics:
 *
 *  - `role="dialog"` + `aria-modal="true"` (returned in {@link dialogProps});
 *    the caller supplies the accessible NAME (`aria-labelledby` → the title, or
 *    `aria-label`).
 *  - Focus ENTRY on open — focus moves to `initialFocusRef` when supplied, else
 *    the first focusable descendant, else the dialog root itself (made
 *    programmatically focusable with `tabindex="-1"`).
 *  - Focus TRAP — Tab / Shift+Tab cycle within the dialog (via
 *    {@link dialogProps.onKeyDown}); focus can never reach the inert background.
 *  - Focus RETURN — the element focused before the dialog opened is restored
 *    when it closes/unmounts.
 *  - Background INERT — every ancestor-sibling of the dialog is marked
 *    `inert` + `aria-hidden="true"` while the dialog is open (prior state saved
 *    and restored), so assistive tech and pointer/tab focus cannot reach the
 *    backdrop. `aria-modal="true"` is the ARIA-level signal; this is the
 *    physical enforcement.
 *  - Nested-dialog Escape POLICY — a module-level stack tracks open dialogs so a
 *    single Escape closes ONLY the topmost one (e.g. the delete-confirm nested
 *    inside `SprintEditLightbox` closes without also dismissing the sprint
 *    form). `closeOnEscape` gates it (callers pass `!submitting` / `!busy`).
 *
 * The hook is framework-idiomatic (hooks + refs), owns no rendering, and is
 * jsdom-safe (no reliance on layout APIs such as `offsetParent`, which jsdom
 * does not compute), so it is fully unit-testable.
 */

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

/* -------------------------------------------------------------------------- */
/* Module-level open-dialog stack (topmost = last)                            */
/* -------------------------------------------------------------------------- */

/**
 * Ordered stack of tokens for the dialogs currently open, oldest first. The
 * last entry is the topmost dialog — the only one that reacts to Escape. Shared
 * across every consumer of this hook so nested dialogs (from different files)
 * coordinate a single, coherent Escape policy.
 */
const openDialogStack: symbol[] = [];

/* -------------------------------------------------------------------------- */
/* Focusable-descendant discovery                                             */
/* -------------------------------------------------------------------------- */

/** Selector for the natively focusable / explicitly tabbable elements. */
const FOCUSABLE_SELECTOR = [
    "a[href]",
    "area[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "button:not([disabled])",
    "iframe",
    "object",
    "embed",
    "[contenteditable]",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * The focusable descendants of `root`, in DOM order. Excludes disabled,
 * `aria-hidden`, and `tabindex="-1"` elements. Deliberately does NOT use
 * `offsetParent`/`getClientRects` visibility checks so it behaves correctly
 * under jsdom (where those always report "hidden").
 */
function getFocusable(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) =>
            !el.hasAttribute("disabled") &&
            el.getAttribute("aria-hidden") !== "true" &&
            el.tabIndex !== -1,
    );
}

/* -------------------------------------------------------------------------- */
/* Background inert (hide every ancestor-sibling of the dialog)               */
/* -------------------------------------------------------------------------- */

/** Records prior a11y state so background inert is fully reversible. */
interface InertRecord {
    el: HTMLElement;
    hadAriaHidden: boolean;
    prevAriaHidden: string | null;
    hadInert: boolean;
}

/**
 * Mark every ancestor-sibling of `dialogRoot` (up to, but not including,
 * `document.body`'s content root) as `inert` + `aria-hidden="true"`, saving
 * each element's prior state. Returns a cleanup that restores it exactly.
 * Script/style/link nodes are skipped (they carry no interactive/AT content).
 */
function applyBackgroundInert(dialogRoot: HTMLElement | null): () => void {
    if (!dialogRoot) {
        return () => undefined;
    }
    const changed: InertRecord[] = [];
    let node: HTMLElement | null = dialogRoot;
    while (node && node.parentElement) {
        const parent: HTMLElement = node.parentElement;
        for (const child of Array.from(parent.children)) {
            if (child === node) {
                continue;
            }
            const el = child as HTMLElement;
            const tag = el.tagName;
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") {
                continue;
            }
            changed.push({
                el,
                hadAriaHidden: el.hasAttribute("aria-hidden"),
                prevAriaHidden: el.getAttribute("aria-hidden"),
                hadInert: el.hasAttribute("inert"),
            });
            el.setAttribute("aria-hidden", "true");
            el.setAttribute("inert", "");
        }
        if (parent === document.body) {
            break;
        }
        node = parent;
    }
    return () => {
        for (const rec of changed) {
            if (rec.hadAriaHidden) {
                rec.el.setAttribute("aria-hidden", rec.prevAriaHidden ?? "");
            } else {
                rec.el.removeAttribute("aria-hidden");
            }
            if (!rec.hadInert) {
                rec.el.removeAttribute("inert");
            }
        }
    };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Options accepted by {@link useDialogA11y}. */
export interface UseDialogA11yOptions {
    /** Whether the dialog is currently open/visible. */
    open: boolean;
    /** Invoked when the topmost dialog is dismissed via Escape. */
    onClose: () => void;
    /**
     * Gates Escape-to-close. Callers pass `!submitting` / `!busy` so a dialog
     * cannot be dismissed mid-operation. Defaults to `true`.
     */
    closeOnEscape?: boolean;
    /**
     * Element to receive focus when the dialog opens. When omitted the first
     * focusable descendant (else the dialog root) is focused.
     */
    initialFocusRef?: RefObject<HTMLElement>;
}

/** Props the caller spreads onto the dialog root (plus its accessible name). */
export interface DialogRootProps {
    role: "dialog";
    "aria-modal": true;
    onKeyDown: (event: ReactKeyboardEvent) => void;
}

/** Return shape of {@link useDialogA11y}. */
export interface UseDialogA11yResult {
    /** Ref to attach to the dialog root element. */
    dialogRef: RefObject<HTMLDivElement>;
    /** Static a11y props + the Tab-trap handler to spread onto the root. */
    dialogProps: DialogRootProps;
}

/**
 * Apply complete modal-dialog accessibility to a caller-rendered root element.
 * See the module docstring for the full behavior contract.
 */
export function useDialogA11y({
    open,
    onClose,
    closeOnEscape = true,
    initialFocusRef,
}: UseDialogA11yOptions): UseDialogA11yResult {
    const dialogRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const tokenRef = useRef<symbol | null>(null);

    // Latest-value refs so the (open-gated) effects need not resubscribe when
    // the caller passes fresh closures/flags each render.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const closeOnEscapeRef = useRef(closeOnEscape);
    closeOnEscapeRef.current = closeOnEscape;
    const initialFocusRefRef = useRef(initialFocusRef);
    initialFocusRefRef.current = initialFocusRef;

    // Open lifecycle: stack registration, background inert, focus entry, and —
    // on cleanup — inert restoration, stack removal, and focus return.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const token = Symbol("dialog");
        tokenRef.current = token;
        openDialogStack.push(token);

        // Remember where focus was so it can be returned on close.
        const active = document.activeElement;
        restoreFocusRef.current =
            active instanceof HTMLElement ? active : null;

        // Blur the outgoing focus BEFORE neutralizing the backdrop, but ONLY
        // when it lives OUTSIDE the dialog (i.e. the trigger in the
        // soon-to-be-inert background). The element to restore on close is
        // already captured above, and focus is moved into the dialog on the
        // next tick below. Without this step the still-focused trigger can
        // momentarily sit beneath a freshly `aria-hidden` ancestor (e.g. a
        // Kanban column trigger inside its `.kanban-manager` wrapper), which
        // browsers refuse and report as "Blocked aria-hidden on an element
        // because its descendant retained focus". The in-dialog guard is
        // essential: a caller effect may have already moved focus into the
        // dialog (e.g. onto an assignee field) before this effect runs, and
        // that focus must be preserved. [F-KANBAN-BULK-MODAL]
        const dialogRoot = dialogRef.current;
        if (
            active instanceof HTMLElement &&
            typeof active.blur === "function" &&
            (!dialogRoot || !dialogRoot.contains(active))
        ) {
            active.blur();
        }

        // Physically neutralize the backdrop.
        const cleanupInert = applyBackgroundInert(dialogRoot);

        // Move focus into the dialog after paint (elements exist + are focusable).
        const focusTimer = window.setTimeout(() => {
            const root = dialogRef.current;
            if (!root) {
                return;
            }
            const preferred = initialFocusRefRef.current?.current ?? null;
            const target: HTMLElement = preferred ?? getFocusable(root)[0] ?? root;
            if (target === root && !root.hasAttribute("tabindex")) {
                root.setAttribute("tabindex", "-1");
            }
            target.focus();
        }, 0);

        return () => {
            window.clearTimeout(focusTimer);
            cleanupInert();
            const idx = openDialogStack.indexOf(token);
            if (idx !== -1) {
                openDialogStack.splice(idx, 1);
            }
            const toRestore = restoreFocusRef.current;
            if (toRestore && typeof toRestore.focus === "function") {
                toRestore.focus();
            }
        };
        // Only the open edge drives this lifecycle; the latest-value refs above
        // keep the closures current without re-running it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Escape closes ONLY the topmost dialog (nested-dialog policy).
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handler = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || !closeOnEscapeRef.current) {
                return;
            }
            if (openDialogStack[openDialogStack.length - 1] !== tokenRef.current) {
                return;
            }
            event.preventDefault();
            onCloseRef.current();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open]);

    // Tab trap — keep focus within the dialog.
    const onKeyDown = (event: ReactKeyboardEvent): void => {
        if (event.key !== "Tab") {
            return;
        }
        const root = dialogRef.current;
        if (!root) {
            return;
        }
        const focusables = getFocusable(root);
        if (focusables.length === 0) {
            event.preventDefault();
            if (!root.hasAttribute("tabindex")) {
                root.setAttribute("tabindex", "-1");
            }
            root.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
            if (active === first || !root.contains(active)) {
                event.preventDefault();
                last.focus();
            }
        } else if (active === last || !root.contains(active)) {
            event.preventDefault();
            first.focus();
        }
    };

    return {
        dialogRef,
        dialogProps: { role: "dialog", "aria-modal": true, onKeyDown },
    };
}

export default useDialogA11y;
