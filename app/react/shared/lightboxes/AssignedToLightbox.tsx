/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React, { useCallback, useState } from "react";
import { Lightbox } from "./Lightbox";
import { t } from "../i18n/translate";
import type { ProjectMember } from "../types";

/**
 * Assigned-users lightbox. The earlier host rendered a NON-selectable member
 * list with no submit path (finding C2); this reproduction makes each member a
 * real toggle and adds a commit that calls back into the owning hook's
 * `submitAssignedUsers` (dirty-PATCH of `assigned_users`/`assigned_to`). Shared,
 * framework-agnostic, i18n via `t()` (finding M7); the body mounts only while
 * open so the selection re-seeds from the story on each open.
 */
export interface AssignedToLightboxProps {
    open: boolean;
    onClose: () => void;
    /** Persist the new assignment (owning hook awaits + surfaces errors). */
    onSubmit: (assignedUsers: number[], assignedTo: number | null) => void;
    members: ProjectMember[];
    /** The story's current collaborators (seeds the selection). */
    initialAssignedUsers: number[];
    saving: boolean;
    errorMessage: string | null;
    canSubmit: boolean;
}

const TITLE_ID = "lb-assignedto-title";

function AssignedToBody(props: AssignedToLightboxProps): React.ReactElement {
    const { onClose, onSubmit, members, initialAssignedUsers, saving, errorMessage, canSubmit } =
        props;

    const [selected, setSelected] = useState<number[]>(() => [...initialAssignedUsers]);

    const toggle = useCallback((memberId: number): void => {
        setSelected((prev) =>
            prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
        );
    }, []);

    const handleSubmit = useCallback(
        (event: React.FormEvent): void => {
            event.preventDefault();
            if (!canSubmit || saving) {
                return;
            }
            onSubmit(selected, selected.length > 0 ? selected[0] : null);
        },
        [canSubmit, saving, selected, onSubmit],
    );

    return (
        <form className="assigned-to" onSubmit={handleSubmit}>
            <h2 id={TITLE_ID} className="title">
                {t("COMMON.ASSIGNED_TO.TITLE_ACTION_EDIT_ASSIGNMENT")}
            </h2>
            <ul className="user-list">
                {members.map((member) => {
                    const checked = selected.includes(member.id);
                    const label =
                        member.full_name_display ??
                        member.full_name ??
                        member.username ??
                        String(member.id);
                    // The ENTIRE row is the selection toggle, mirroring the legacy
                    // `lb-select-user.jade` (`ng-click="addItem(item)"` on the whole
                    // user row). Toggling only via the inner checkbox left the bare
                    // row area inert, so a row-level click did not select the user
                    // (the assignment then persisted empty). The checkbox is kept as
                    // a non-interactive visual indicator (`readOnly`, `aria-hidden`,
                    // `pointer-events:none`) so clicks fall through to the row and it
                    // never double-toggles; the row itself is the accessible control.
                    return (
                        <li
                            key={member.id}
                            className={`user-list-single ${checked ? "selected" : ""}`}
                            role="button"
                            tabIndex={0}
                            aria-pressed={checked}
                            onClick={() => toggle(member.id)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    toggle(member.id);
                                }
                            }}
                        >
                            <span className="assigned-choice">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    readOnly
                                    tabIndex={-1}
                                    aria-hidden="true"
                                    style={{ pointerEvents: "none" }}
                                />
                                <span className="user-name">{label}</span>
                            </span>
                        </li>
                    );
                })}
            </ul>

            {errorMessage !== null ? (
                <div className="lightbox-error" role="alert" aria-live="assertive">
                    {errorMessage}
                </div>
            ) : null}

            <div className="lb-action-wrapper">
                <button
                    type="submit"
                    className="btn-small js-submit-button"
                    disabled={!canSubmit || saving}
                    aria-disabled={!canSubmit || saving ? "true" : undefined}
                >
                    {t("COMMON.SAVE")}
                </button>
                <button type="button" className="cancel" onClick={onClose}>
                    {t("COMMON.CANCEL")}
                </button>
            </div>
        </form>
    );
}

export function AssignedToLightbox(props: AssignedToLightboxProps): React.ReactElement {
    return (
        <Lightbox
            open={props.open}
            onClose={props.onClose}
            className="lightbox-assigned-to"
            markerAttr="tg-lb-assignedto"
            labelledById={TITLE_ID}
            initialFocusSelector=".user-list-single"
        >
            <AssignedToBody {...props} />
        </Lightbox>
    );
}

export default AssignedToLightbox;
