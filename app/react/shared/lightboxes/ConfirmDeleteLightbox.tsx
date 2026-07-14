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
 * Localized delete-confirmation modal reproducing the legacy
 * `$confirm.askOnDelete` → `askDelete(".lightbox-generic-delete")` dialog
 * (finding C7). The DOM mirrors the authoritative
 * `app/partials/includes/modules/lightbox-generic-delete.jade`:
 *
 *   form
 *     h2.title
 *     p > span.subtitle + span.message
 *     .options
 *       button.btn-link.btn-cancel.js-cancel   → COMMON.CANCEL
 *       button.btn-small.btn-confirm.js-confirm → icon-trash + COMMON.DELETE
 *
 * so the preserved theme styles it unchanged. It uses the shared {@link Lightbox}
 * shell for the `.open` visibility toggle, focus trap, `Escape`-to-cancel and
 * dialog ARIA.
 *
 * Only legacy catalogue strings are rendered:
 *   - title:    `US.TITLE_DELETE_ACTION`  ("Delete user story")
 *   - subtitle: `NOTIFICATION.ASK_DELETE` ("Are you sure you want to delete?")
 *   - message:  the story subject, as an ESCAPED React text node — never
 *     `dangerouslySetInnerHTML` (AAP XSS rule). The legacy `askDelete` set
 *     `.title/.subtitle/.message` via jQuery `.text()`, i.e. escaped text, so
 *     this is faithful: the Kanban controller passed the bare subject as the
 *     message, which is exactly what renders here.
 */
export interface ConfirmDeleteLightboxProps {
    /** Whether the confirmation modal is open. */
    open: boolean;
    /** The subject/name of the item to delete (rendered escaped in `.message`). */
    subject: string;
    /** `true` while the confirmed delete runs (disables both buttons). */
    busy?: boolean;
    /** The user confirmed the deletion (`.js-confirm`). */
    onConfirm: () => void;
    /** The user dismissed the modal without deleting (`.js-cancel`/Escape/close). */
    onCancel: () => void;
}

const TITLE_ID = "tg-confirm-delete-title";

export function ConfirmDeleteLightbox(
    props: ConfirmDeleteLightboxProps,
): React.ReactElement {
    const { open, subject, busy = false, onConfirm, onCancel } = props;

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
            className="lightbox-generic-delete"
            markerAttr="tg-lb-generic-delete"
            labelledById={TITLE_ID}
            initialFocusSelector=".js-cancel"
        >
            <form onSubmit={(event): void => event.preventDefault()}>
                <h2 id={TITLE_ID} className="title">
                    {t("US.TITLE_DELETE_ACTION")}
                </h2>
                <p>
                    <span className="subtitle">{t("NOTIFICATION.ASK_DELETE")}</span>
                    <span className="message">{subject}</span>
                </p>

                <div className="options">
                    <button
                        type="button"
                        className="btn-link btn-cancel js-cancel e2e-cancel-delete"
                        disabled={busy}
                        onClick={handleCancel}
                    >
                        <span>{t("COMMON.CANCEL")}</span>
                    </button>

                    <button
                        type="button"
                        className="btn-small btn-confirm js-confirm e2e-confirm-delete"
                        disabled={busy}
                        onClick={handleConfirm}
                    >
                        <svg className="icon icon-trash">
                            <use xlinkHref="#icon-trash" />
                        </svg>
                        <span>{t("COMMON.DELETE")}</span>
                    </button>
                </div>
            </form>
        </Lightbox>
    );
}
