/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ConfirmDialog — a themed, in-document confirmation modal.
 *
 * Replaces the browser-native `window.confirm()` used by the React Backlog for
 * destructive actions (QA finding [H]). The AngularJS app used a styled
 * confirmation lightbox driven by `$tgConfirm.askOnDelete()`
 * (app/coffee/modules/common/confirm.coffee L122) rendered from
 * `app/partials/includes/modules/lightbox-generic-delete.jade`
 * (wrapper `div.lightbox.lightbox-generic-delete`, app/index.jade L57-58).
 *
 * This component reproduces that EXACT DOM structure and CSS class names so the
 * already-compiled SCSS themes it unchanged (visual parity by construction —
 * AAP §0.3.4), and applies the `.open` reveal contract established in the
 * lightbox fixes (the `.lightbox` SCSS base is `display:none` and is revealed
 * ONLY by the `.open` class). It renders `null` when closed.
 *
 * The component is PURE and presentational: it owns no async work. The caller
 * supplies the copy and the `onConfirm` / `onCancel` handlers and toggles
 * `open` / `busy`, mirroring how `askOnDelete(...)` resolved a promise the
 * caller then acted upon. `message` is a `ReactNode`, so callers can pass rich
 * content (e.g. a `<strong>` subject) which React auto-escapes — no
 * `dangerouslySetInnerHTML`, keeping the XSS-safety posture of the migration.
 *
 * Accessibility (enterprise-standard; no Figma constrains this project): the
 * dialog is exposed as `role="dialog"` + `aria-modal="true"` with an accessible
 * name from the title, focuses the cancel control on open, and closes on
 * `Escape`.
 */

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode, MouseEvent as ReactMouseEvent } from "react";

import { t } from "../i18n/translate";

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface ConfirmDialogProps {
    /** Whether the dialog is visible. When `false` the component renders `null`. */
    open: boolean;
    /**
     * Visual/semantic variant.
     *  - `"delete"` (default): destructive confirm — wrapper
     *    `lightbox-generic-delete`, confirm button carries the trash icon.
     *  - `"ask"`: neutral confirm — wrapper `lightbox-generic-ask`, no icon.
     * Ports the `lightbox-generic-delete` vs `lightbox-generic-ask` split.
     */
    variant?: "delete" | "ask";
    /** Heading text (rendered in `h2.title`). */
    title: string;
    /** Optional secondary line (rendered in `span.subtitle`). */
    subtitle?: string;
    /** Body content (rendered in `span.message`); may contain React nodes. */
    message?: ReactNode;
    /** Confirm button label. Defaults to "Delete" (delete) / "Accept" (ask). */
    confirmLabel?: string;
    /** Cancel button label. Defaults to "Cancel". */
    cancelLabel?: string;
    /**
     * Disables both buttons while the confirmed action is in flight. Ports the
     * `debounce 2000` + loading spinner the AngularJS confirm applied to the
     * accept button so it cannot be double-submitted.
     */
    busy?: boolean;
    /** Invoked when the user confirms the action. */
    onConfirm: () => void;
    /** Invoked when the user cancels (Cancel button, close icon, or Escape). */
    onCancel: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Themed confirmation dialog. See the module docstring for the porting notes.
 */
export function ConfirmDialog({
    open,
    variant = "delete",
    title,
    subtitle,
    message,
    confirmLabel,
    // Default routed through the shared catalog ([i18n]); evaluated per render
    // (call time), not at module load, so `$translate` is available at runtime.
    cancelLabel = t("COMMON.CANCEL", "Cancel"),
    busy = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const cancelRef = useRef<HTMLButtonElement | null>(null);

    // Move focus into the dialog when it opens (a11y: keyboard users land on a
    // safe, non-destructive control). Guarded so it only runs on the open edge.
    useEffect(() => {
        if (open) {
            // Focus after paint so the element exists and is focusable.
            const id = window.setTimeout(() => cancelRef.current?.focus(), 0);
            return () => window.clearTimeout(id);
        }
        return undefined;
    }, [open]);

    // Escape closes the dialog (equivalent to Cancel) — but never while busy.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) {
                event.preventDefault();
                onCancel();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, busy, onCancel]);

    const handleConfirm = useCallback(
        (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            if (!busy) {
                onConfirm();
            }
        },
        [busy, onConfirm],
    );

    const handleCancel = useCallback(
        (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            if (!busy) {
                onCancel();
            }
        },
        [busy, onCancel],
    );

    // Closed: render nothing (mirrors the hidden lightbox).
    if (!open) {
        return null;
    }

    const isDelete = variant === "delete";
    const wrapperClass = isDelete
        ? "lightbox lightbox-generic-delete open"
        : "lightbox lightbox-generic-ask open";
    const resolvedConfirmLabel =
        confirmLabel ?? (isDelete ? t("COMMON.DELETE", "Delete") : t("COMMON.ACCEPT", "Accept"));

    return (
        <div
            className={wrapperClass}
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            {/* Ports tg-lightbox-close (tg-svg svg-icon="icon-close"). i18n COMMON.CLOSE */}
            <button
                className="close"
                type="button"
                onClick={handleCancel}
                title={t("COMMON.CLOSE", "close")}
                aria-label={t("COMMON.CLOSE", "close")}
                disabled={busy}
            >
                <svg className="icon icon-close" aria-hidden="true" focusable="false">
                    <use xlinkHref="#icon-close" href="#icon-close" />
                </svg>
            </button>

            <form onSubmit={(event) => event.preventDefault()}>
                <h2 className="title">{title}</h2>
                <p>
                    {subtitle ? <span className="subtitle">{subtitle}</span> : null}
                    <span className="message">{message}</span>
                </p>

                <div className="options">
                    <button
                        ref={cancelRef}
                        className="btn-link btn-cancel js-cancel"
                        type="button"
                        onClick={handleCancel}
                        disabled={busy}
                    >
                        <span>{cancelLabel}</span>
                    </button>

                    <button
                        className={
                            isDelete
                                ? "btn-small btn-confirm js-confirm"
                                : "btn-small js-confirm"
                        }
                        type="button"
                        onClick={handleConfirm}
                        disabled={busy}
                    >
                        {isDelete && (
                            <svg
                                className="icon icon-trash"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <use xlinkHref="#icon-trash" href="#icon-trash" />
                            </svg>
                        )}
                        <span>{resolvedConfirmLabel}</span>
                    </button>
                </div>
            </form>
        </div>
    );
}

export default ConfirmDialog;
