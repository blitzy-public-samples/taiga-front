/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React, { useCallback, useMemo, useState } from "react";
import { Lightbox } from "./Lightbox";
import { t } from "../i18n/translate";
import type { BulkStoryValues } from "./storyForm";
import type { Status, Swimlane } from "../types";

/**
 * Bulk create-user-stories lightbox reproducing the legacy
 * `lightbox-us-bulk.jade` DOM (status selector, creation-position radios, the
 * kanban-only swimlane selector, and the `data-required` textarea — one story
 * per line) and behaviour (finding C2). Shared, framework-agnostic, and driven
 * by the shared `t()` (finding M7); the body mounts only while open.
 */
export interface BulkStoryLightboxProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (values: BulkStoryValues) => void;
    statuses: Status[];
    swimlanes: Swimlane[];
    defaultSwimlaneId: number | null;
    isKanban: boolean;
    /** Target status id the "+" affordance was pressed on. */
    initialStatusId: number | null;
    saving: boolean;
    errorMessage: string | null;
    canSubmit: boolean;
}

const TITLE_ID = "lb-create-bulk-us-title";

function BulkStoryBody(props: BulkStoryLightboxProps): React.ReactElement {
    const {
        onClose,
        onSubmit,
        statuses,
        swimlanes,
        defaultSwimlaneId,
        isKanban,
        initialStatusId,
        saving,
        errorMessage,
        canSubmit,
    } = props;

    const [bulk, setBulk] = useState<string>("");
    const [status, setStatus] = useState<number | null>(initialStatusId ?? statuses[0]?.id ?? null);
    const [swimlane, setSwimlane] = useState<number | null>(defaultSwimlaneId);
    const [position, setPosition] = useState<"top" | "bottom">("bottom");
    const [statusOpen, setStatusOpen] = useState<boolean>(false);
    const [touched, setTouched] = useState<boolean>(false);

    const currentStatus = useMemo<Status | undefined>(
        () => statuses.find((entry) => entry.id === status),
        [statuses, status],
    );
    const hasContent = bulk.trim().length > 0;
    const submittable = canSubmit && !saving && hasContent;

    const handleSubmit = useCallback(
        (event: React.FormEvent): void => {
            event.preventDefault();
            setTouched(true);
            if (!canSubmit || saving || !hasContent) {
                return;
            }
            onSubmit({ bulk, status, swimlane, us_position: position });
        },
        [canSubmit, saving, hasContent, bulk, status, swimlane, position, onSubmit],
    );

    return (
        <form className="lightbox-create-bulk-userstories-form" onSubmit={handleSubmit} noValidate>
            <h2 id={TITLE_ID} className="title">
                {t("COMMON.NEW_BULK")}
            </h2>

            {statuses.length > 0 ? (
                <fieldset>
                    <span className="label">{t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS")}</span>
                    <div className="bulk-status-selector-wrapper">
                        <button
                            type="button"
                            className="bulk-status-selector"
                            style={{ backgroundColor: currentStatus?.color ?? undefined }}
                            aria-haspopup="listbox"
                            aria-expanded={statusOpen ? "true" : "false"}
                            onClick={() => setStatusOpen((prev) => !prev)}
                        >
                            <span>{currentStatus?.name ?? ""}</span>
                            <span className="icon icon-arrow-down" aria-hidden="true" />
                        </button>
                        {statusOpen ? (
                            <div className="bulk-status-option-wrapper" role="listbox">
                                {statuses.map((entry) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        className={`bulk-status-option ${entry.id === status ? "selected" : ""}`}
                                        role="option"
                                        aria-selected={entry.id === status}
                                        onClick={() => {
                                            setStatus(entry.id);
                                            setStatusOpen(false);
                                        }}
                                    >
                                        {entry.name}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </fieldset>
            ) : null}

            <fieldset className="creation-position">
                <span className="label">{t("LIGHTBOX.CREATE_EDIT.LOCATION")}</span>
                <div className="creation-position-fields">
                    <label className="custom-radio">
                        <input
                            type="radio"
                            name="bulk_us_position"
                            value="bottom"
                            checked={position === "bottom"}
                            onChange={() => setPosition("bottom")}
                        />
                        <span className="radio-control" />
                        <span className="radio-label">{t("LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM")}</span>
                    </label>
                    <label className="custom-radio">
                        <input
                            type="radio"
                            name="bulk_us_position"
                            value="top"
                            checked={position === "top"}
                            onChange={() => setPosition("top")}
                        />
                        <span className="radio-control" />
                        <span className="radio-label">{t("LIGHTBOX.CREATE_EDIT.CREATE_TOP")}</span>
                    </label>
                </div>
            </fieldset>

            {isKanban && swimlanes.length > 0 ? (
                <fieldset className="swimlane-select">
                    <span className="label">{t("LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE")}</span>
                    <select
                        className="swimlane-selector"
                        aria-label={t("LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE")}
                        value={swimlane === null ? "" : String(swimlane)}
                        onChange={(event) =>
                            setSwimlane(event.target.value === "" ? null : Number(event.target.value))
                        }
                    >
                        <option value="">{t("KANBAN.UNCLASSIFIED_USER_STORIES")}</option>
                        {swimlanes.map((entry) => (
                            <option key={entry.id} value={String(entry.id)}>
                                {entry.name}
                            </option>
                        ))}
                    </select>
                </fieldset>
            ) : null}

            <fieldset>
                <textarea
                    className="bulk-subjects"
                    name="bulk"
                    wrap="off"
                    aria-required="true"
                    aria-invalid={touched && !hasContent ? "true" : undefined}
                    placeholder={t("COMMON.ONE_ITEM_LINE")}
                    value={bulk}
                    onChange={(event) => setBulk(event.target.value)}
                />
                {touched && !hasContent ? (
                    <span className="checksley-error-list" role="alert">
                        {t("COMMON.FORM_ERRORS.REQUIRED")}
                    </span>
                ) : null}
            </fieldset>

            {errorMessage !== null ? (
                <div className="lightbox-error" role="alert" aria-live="assertive">
                    {errorMessage}
                </div>
            ) : null}

            <div className="lb-action-wrapper">
                <button
                    type="submit"
                    className="btn-small js-submit-button"
                    title={t("COMMON.SAVE")}
                    disabled={!submittable}
                    aria-disabled={submittable ? undefined : "true"}
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

export type { BulkStoryValues } from "./storyForm";

export function BulkStoryLightbox(props: BulkStoryLightboxProps): React.ReactElement {
    return (
        <Lightbox
            open={props.open}
            onClose={props.onClose}
            className="lightbox-generic-bulk"
            markerAttr="tg-lb-create-bulk-userstories"
            labelledById={TITLE_ID}
            initialFocusSelector="textarea[name='bulk']"
        >
            <BulkStoryBody {...props} />
        </Lightbox>
    );
}

export default BulkStoryLightbox;
