/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/useModalDialog.ts — reusable modal-dialog keyboard/focus behaviour
 * (F-UI-05).
 *
 * WHY:
 *   The AngularJS lightboxes were opened by the `lightboxService`/`$suirмодal`
 *   helpers and the global `lightbox-service` handled Escape, the backdrop, and
 *   returning focus to the opener. The React ports (`CreateEditSprintLightbox`,
 *   `BulkCreateUsLightbox`) reimplemented the visuals but were plain `<div>`s
 *   with NO dialog role, NO focus trap, NO Escape handler and NO focus
 *   restoration — so a keyboard/screen-reader user could Tab out of the modal
 *   into the page behind it and had no way to dismiss it. F-UI-05 requires the
 *   two lightboxes to be real, accessible modal dialogs.
 *
 * WHAT this hook provides, attached to whatever element receives the returned
 * ref (the element the component also marks `role="dialog" aria-modal="true"`):
 *   1. FOCUS TRAP — Tab / Shift+Tab cycle only through the focusable descendants
 *      of the dialog; focus can never leave it while it is open.
 *   2. ESCAPE — pressing Escape invokes `onClose` (matching the legacy
 *      lightbox-service Escape binding). The keydown listener is installed on
 *      `document` (not on the dialog element) so Escape still dismisses the
 *      dialog after focus has left it — e.g. after a backdrop click returns
 *      focus to <body>. See the N-10 FIX comment at the listener registration.
 *   3. INITIAL FOCUS — when the dialog opens, if focus is not already inside it,
 *      the first focusable descendant is focused (a component may instead focus
 *      a specific field first; this only acts as a fallback).
 *   4. FOCUS RESTORATION — when the dialog closes/unmounts, focus returns to the
 *      element that was focused before it opened (the trigger).
 *
 * It is behaviour-only: it renders nothing and imposes no markup or styling, so
 * it does not affect visual fidelity. Consumers keep their existing SCSS-faithful
 * DOM and simply spread the ref plus the ARIA attributes onto the shell element.
 *
 * Toolchain: React 18.2.0 / TypeScript 5.4.5 (`strict`, `jsx: "react-jsx"`),
 * jsdom-only (no browser/network) — safe under `npm test`.
 */

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

/**
 * CSS selector matching the elements considered focusable for the trap. Mirrors
 * the widely-used focus-trap selector set: links with an href, non-disabled form
 * controls, and anything with a non-negative explicit `tabindex`.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Install modal-dialog keyboard/focus behaviour on a container element.
 *
 * @typeParam T - the concrete element type the ref is attached to (defaults to
 *   `HTMLElement`); e.g. `HTMLDivElement` for a `<div role="dialog">`.
 * @param open - whether the dialog is currently open. All behaviour is inert
 *   while `false`, and enabling/disabling toggles the listeners + focus
 *   management.
 * @param onClose - invoked when the user presses Escape. Kept in a ref so a new
 *   closure each render does not re-install the listeners.
 * @returns a ref to spread onto the dialog container element.
 */
export function useModalDialog<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void,
): MutableRefObject<T | null> {
  const dialogRef = useRef<T | null>(null);
  // Keep the latest `onClose` without re-running the effect when the parent
  // passes a fresh closure every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The element focused immediately before the dialog opened, restored on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // Remember the opener so focus can return to it when the dialog closes.
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    /** All focusable descendants, in DOM order. */
    const getFocusable = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Fallback initial focus: only if focus is not already inside the dialog
    // (a consumer may have focused a specific field first — do not fight it).
    if (!dialog.contains(document.activeElement)) {
      const focusable = getFocusable();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        // Nothing focusable yet — focus the dialog itself so Escape/Tab work.
        dialog.focus();
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = getFocusable();
      if (focusable.length === 0) {
        // No focusable targets — keep focus on the dialog, block Tab escaping.
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        // Shift+Tab off the first element (or from outside) wraps to the last.
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        // Tab off the last element (or from outside) wraps to the first.
        event.preventDefault();
        first.focus();
      }
    };

    // N-10 FIX: bind the keydown listener on `document`, NOT on the dialog
    // element. When the listener was scoped to `dialog`, Escape only worked
    // while focus was physically inside the dialog; a backdrop click (or any
    // interaction that moved focus back to <body>) left the dialog with focus
    // trapping still visually active but Escape silently dead, because the
    // keydown never reached the dialog node. Listening on `document` mirrors the
    // legacy AngularJS lightbox-service (which bound Escape globally) so Escape
    // dismisses the dialog regardless of where focus currently sits. The Tab
    // branch below already guards every focus decision with
    // `dialog.contains(active)`, so it remains correct at document scope.
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Restore focus to the opener (if it is still focusable/attached).
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  return dialogRef;
}
