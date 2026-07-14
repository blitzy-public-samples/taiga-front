/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React from "react";
import { Lightbox } from "./Lightbox";
import { t } from "../i18n/translate";

/**
 * Localized generic confirmation ("ask") modal reproducing the legacy
 * `$confirm.ask(title, subtitle, message)` dialog (`common/confirm.coffee` L40)
 * rendered into `.lightbox-generic-ask`. The DOM mirrors the authoritative
 * `app/partials/includes/modules/lightbox-generic-ask.jade`:
 *
 *   form
 *     h2.title
 *     p > span.subtitle + span.message
 *     .options
 *       button.btn-link.btn-cancel.js-cancel  → COMMON.CANCEL
 *       button.btn-small.js-confirm           → COMMON.ACCEPT
 *
 * so the preserved theme styles it unchanged. It uses the shared {@link Lightbox}
 * shell for the `.open` visibility toggle, focus trap, `Escape`-to-cancel and
 * dialog ARIA.
 *
 * Finding M1: the shared create/edit story form uses this to reproduce the
 * legacy `CreateEditDirective.checkClose` dirty-close confirmation
 * (`common/lightboxes.coffee` L818 — `$confirm.ask("LIGHTBOX.CREATE_EDIT.
 * CONFIRM_CLOSE")`), replacing the previous English `window.confirm` substitute
 * with a localized, themed dialog. `title` / `subtitle` / `message` are rendered
 * as ESCAPED React text nodes (never `dangerouslySetInnerHTML`), matching the
 * legacy `.text(...)` writes and the AAP XSS rule.
 */
export interface ConfirmAskLightboxProps {
    /** Whether the confirmation modal is open. */
    open: boolean;
    /** Primary prompt (legacy `.title`); the only field the dirty-close ask sets. */
    title: string;
    /** Optional secondary line (legacy `.subtitle`). */
    subtitle?: string;
    /** Optional detail line (legacy `.message`). */
    message?: string;
    /** `true` while the confirmed action runs (disables both buttons). */
    busy?: boolean;
    /** The user accepted (`.js-confirm`). */
    onConfirm: () => void;
    /** The user dismissed without accepting (`.js-cancel`/Escape/close). */
    onCancel: () => void;
}

const TITLE_ID = "tg-confirm-ask-title";

export function ConfirmAskLightbox(
    props: ConfirmAskLightboxProps,
): React.ReactElement {
    const { open, title, subtitle = "", message = "", busy = false, onConfirm, onCancel } = props;

    const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        if (busy) {
            return;
        }
        onConfirm();
    };

    const handleCancel = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        if (busy) {
            return;
        }
        onCancel();
    };

    return (
        <Lightbox
            open={open}
            onClose={onCancel}
            className="lightbox-generic-ask"
            markerAttr="tg-lb-generic-ask"
            labelledById={TITLE_ID}
            initialFocusSelector=".js-cancel"
        >
            <form onSubmit={(event): void => event.preventDefault()}>
                <h2 id={TITLE_ID} className="title">
                    {title}
                </h2>
                <p>
                    <span className="subtitle">{subtitle}</span>
                    <span className="message">{message}</span>
                </p>

                <div className="options">
                    <button
                        type="button"
                        className="btn-link btn-cancel js-cancel"
                        disabled={busy}
                        onClick={handleCancel}
                    >
                        <span>{t("COMMON.CANCEL")}</span>
                    </button>

                    <button
                        type="button"
                        className="btn-small js-confirm"
                        disabled={busy}
                        onClick={handleConfirm}
                    >
                        <span>{t("COMMON.ACCEPT")}</span>
                    </button>
                </div>
            </form>
        </Lightbox>
    );
}

export default ConfirmAskLightbox;
