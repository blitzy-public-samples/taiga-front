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
import {
    createEmptyStoryValues,
    isStoryFormValid,
    validateStoryForm,
    SUBJECT_MAX_LENGTH,
    type StoryFormValues,
} from "./storyForm";
import type { Point, ProjectMember, Role, Status, Swimlane, Tag } from "../types";

/**
 * Shared create/edit user-story lightbox reproducing the legacy
 * `lb-create-edit.jade` (+ `lb-create-edit-us.jade`) DOM and behaviour, closing
 * finding C2 (complete, source-compatible story form) and prepared for reuse by
 * the Backlog screen (finding C7). It is framework-agnostic: all data and the
 * persistence callback are injected, and i18n goes through the shared `t()`
 * mechanism (finding M7). The form BODY mounts only while the lightbox is open
 * (via {@link Lightbox}), so its state resets on each open exactly like the
 * legacy `form(ng-if="lightboxOpen")`.
 */
export interface StoryFormLightboxProps {
    /** Whether the lightbox is open. */
    open: boolean;
    /** `new` (create) vs `edit` — switches the title + submit caption + rules. */
    mode: "create" | "edit";
    /** Close request. */
    onClose: () => void;
    /** Persist the collected values (the owning hook awaits + surfaces errors). */
    onSubmit: (values: StoryFormValues) => void;
    /** Selectable statuses (`project.us_statuses`). */
    statuses: Status[];
    /** Assignable project members (`project.members`). */
    members: ProjectMember[];
    /** Computable/estimable roles (`project.roles`). */
    roles: Role[];
    /** Estimation point options (`project.points`). */
    points: Point[];
    /** Kanban swimlanes (empty on Backlog). */
    swimlanes: Swimlane[];
    /** Project default swimlane id. */
    defaultSwimlaneId: number | null;
    /** Whether to show the kanban-only swimlane selector. */
    isKanban: boolean;
    /** Prefill (edit) / target (create) values. */
    initialValues?: Partial<StoryFormValues>;
    /** True while the persistence call is in flight (disables submit). */
    saving: boolean;
    /** Sanitized, user-facing error text from the last failed submit. */
    errorMessage: string | null;
    /** Permission gate (`add_us` on create, `modify_us` on edit). */
    canSubmit: boolean;
}

const TITLE_ID = "lb-create-edit-us-title";

/** The mounted-while-open form body; its state initialises fresh on each open. */
function StoryFormBody(props: StoryFormLightboxProps): React.ReactElement {
    const {
        mode,
        onClose,
        onSubmit,
        statuses,
        members,
        roles,
        points,
        swimlanes,
        defaultSwimlaneId,
        isKanban,
        initialValues,
        saving,
        errorMessage,
        canSubmit,
    } = props;

    // Seed once (on mount == on open). Create defaults the status to the target
    // (or the first status) and the swimlane to the project default.
    const [values, setValues] = useState<StoryFormValues>(() =>
        createEmptyStoryValues({
            status: statuses[0]?.id ?? null,
            swimlane: defaultSwimlaneId,
            ...initialValues,
        }),
    );
    const [subjectTouched, setSubjectTouched] = useState<boolean>(false);
    const [statusOpen, setStatusOpen] = useState<boolean>(false);
    const [tagDraft, setTagDraft] = useState<string>("");

    const errors = validateStoryForm(values);
    const showSubjectError = subjectTouched && errors.subject !== undefined;
    const submittable = canSubmit && !saving && isStoryFormValid(values);

    const selectedStatus = useMemo<Status | undefined>(
        () => statuses.find((status) => status.id === values.status),
        [statuses, values.status],
    );
    const computableRoles = useMemo<Role[]>(
        () => roles.filter((role) => role.computable === true),
        [roles],
    );

    const setField = useCallback(
        <K extends keyof StoryFormValues>(key: K, value: StoryFormValues[K]): void => {
            setValues((prev) => ({ ...prev, [key]: value }));
        },
        [],
    );

    const addTag = useCallback((): void => {
        const name = tagDraft.trim();
        if (name.length === 0) {
            return;
        }
        setValues((prev) =>
            prev.tags.some((tag) => tag[0] === name)
                ? prev
                : { ...prev, tags: [...prev.tags, [name, null] as Tag] },
        );
        setTagDraft("");
    }, [tagDraft]);

    const removeTag = useCallback((name: string): void => {
        setValues((prev) => ({ ...prev, tags: prev.tags.filter((tag) => tag[0] !== name) }));
    }, []);

    const toggleAssigned = useCallback((memberId: number): void => {
        setValues((prev) => {
            const has = prev.assigned_users.includes(memberId);
            const assigned_users = has
                ? prev.assigned_users.filter((id) => id !== memberId)
                : [...prev.assigned_users, memberId];
            // The primary assignee mirrors the first collaborator (legacy parity).
            const assigned_to = assigned_users.length > 0 ? assigned_users[0] : null;
            return { ...prev, assigned_users, assigned_to };
        });
    }, []);

    const setEstimation = useCallback((roleId: number, pointId: number | null): void => {
        setValues((prev) => ({
            ...prev,
            points: { ...prev.points, [String(roleId)]: pointId },
        }));
    }, []);

    const handleSubmit = useCallback(
        (event: React.FormEvent): void => {
            event.preventDefault();
            setSubjectTouched(true);
            if (!canSubmit || saving || !isStoryFormValid(values)) {
                return;
            }
            onSubmit(values);
        },
        [canSubmit, saving, values, onSubmit],
    );

    return (
        <form
            className="lightbox-create-edit-userstory-form"
            onSubmit={handleSubmit}
            noValidate
            // The shared `.lightbox` overlay is `position:fixed; align-items:center`
            // with no scroll (app/styles/dependencies/mixins/lightbox.scss). The legacy
            // compact two-column create/edit US form fit the viewport, but this
            // reproduction renders the assignee list inline and can exceed 100vh, which
            // would clip the bottom `.btn-container` submit out of reach. Bounding the
            // form to the viewport height and letting it scroll internally keeps the
            // submit reachable without touching the shared SCSS or any class name.
            style={{ maxHeight: "calc(100vh - 4rem)", overflowY: "auto" }}
        >
            <h2 id={TITLE_ID} className="title">
                {mode === "edit"
                    ? t("LIGHTBOX.CREATE_EDIT.EDIT_US")
                    : t("LIGHTBOX.CREATE_EDIT.NEW_US")}
            </h2>

            <div className="form-wrapper">
                <div className="main">
                    <fieldset>
                        <input
                            type="text"
                            name="subject"
                            className="subject"
                            placeholder={t("COMMON.FIELDS.SUBJECT")}
                            maxLength={SUBJECT_MAX_LENGTH}
                            aria-required="true"
                            aria-invalid={showSubjectError ? "true" : undefined}
                            value={values.subject}
                            onChange={(event) => setField("subject", event.target.value)}
                            onBlur={() => setSubjectTouched(true)}
                        />
                        {showSubjectError ? (
                            <span className="checksley-error-list" role="alert">
                                {errors.subject === "maxlength"
                                    ? t("COMMON.FORM_ERRORS.MAX_LENGTH").replace("%s", String(SUBJECT_MAX_LENGTH))
                                    : t("COMMON.FORM_ERRORS.REQUIRED")}
                            </span>
                        ) : null}
                    </fieldset>

                    <fieldset>
                        <div className="tags-block">
                            <ul className="tags-list">
                                {values.tags.map((tag) => (
                                    <li key={tag[0]} className="tag">
                                        <span className="tag-name">{tag[0]}</span>
                                        <button
                                            type="button"
                                            className="tag-remove"
                                            title={t("COMMON.DELETE")}
                                            aria-label={t("COMMON.DELETE")}
                                            onClick={() => removeTag(tag[0])}
                                        >
                                            <span className="icon icon-close" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <input
                                type="text"
                                className="tag-input"
                                placeholder={t("COMMON.TAGS.ADD")}
                                value={tagDraft}
                                onChange={(event) => setTagDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        addTag();
                                    }
                                }}
                            />
                        </div>
                    </fieldset>

                    <fieldset>
                        <textarea
                            className="description"
                            name="description"
                            rows={7}
                            placeholder={t("LIGHTBOX.CREATE_EDIT.US_PLACEHOLDER_DESCRIPTION")}
                            value={values.description}
                            onChange={(event) => setField("description", event.target.value)}
                        />
                    </fieldset>
                </div>

                <div className="sidebar ticket-data">
                    <fieldset className="status-button">
                        <button
                            type="button"
                            className="status-dropdown editable"
                            style={{ backgroundColor: selectedStatus?.color ?? undefined }}
                            aria-haspopup="listbox"
                            aria-expanded={statusOpen ? "true" : "false"}
                            onClick={() => setStatusOpen((prev) => !prev)}
                        >
                            <span className="status-text">
                                {selectedStatus?.name ?? t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS")}
                            </span>
                            <span className="icon icon-arrow-down" aria-hidden="true" />
                        </button>
                        {statusOpen ? (
                            <ul
                                className="pop-status popover active"
                                role="listbox"
                                // Legacy popovers were made visible by inline `display:block`
                                // (the theme defaults `.pop-status` to `display:none` with no
                                // `.active{display:block}` rule); the `<ul>` only renders while
                                // `statusOpen`, so force the visible display here.
                                style={{ display: "block" }}
                            >
                                {statuses.map((status) => (
                                    <li key={status.id} role="option" aria-selected={status.id === values.status}>
                                        <a
                                            href="#"
                                            className="status"
                                            title={status.name}
                                            data-status-id={status.id}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                setField("status", status.id);
                                                setStatusOpen(false);
                                            }}
                                        >
                                            <span className="item-text">{status.name}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </fieldset>

                    {isKanban && swimlanes.length > 0 ? (
                        <fieldset className="swimlane-select">
                            <span className="label">{t("LIGHTBOX.CREATE_EDIT.SWIMLANE")}</span>
                            <select
                                className="swimlane-selector"
                                aria-label={t("LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE")}
                                value={values.swimlane === null ? "" : String(values.swimlane)}
                                onChange={(event) =>
                                    setField(
                                        "swimlane",
                                        event.target.value === "" ? null : Number(event.target.value),
                                    )
                                }
                            >
                                <option value="">{t("KANBAN.UNCLASSIFIED_USER_STORIES")}</option>
                                {swimlanes.map((swimlane) => (
                                    <option key={swimlane.id} value={String(swimlane.id)}>
                                        {swimlane.name}
                                    </option>
                                ))}
                            </select>
                        </fieldset>
                    ) : null}

                    <fieldset className="ticket-assigned-to multiple-assign">
                        <span className="label">{t("COMMON.ASSIGNED_TO.ASSIGN")}</span>
                        <ul className="assigned-list" style={{ maxHeight: "9rem", overflowY: "auto" }}>
                            {members.map((member) => {
                                const checked = values.assigned_users.includes(member.id);
                                const label =
                                    member.full_name_display ??
                                    member.full_name ??
                                    member.username ??
                                    String(member.id);
                                return (
                                    <li key={member.id} className="assigned-list-single">
                                        <label className="assigned-choice">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleAssigned(member.id)}
                                            />
                                            <span className="user-name">{label}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </fieldset>

                    {computableRoles.length > 0 ? (
                        <fieldset className="ticket-estimation">
                            <span className="label">{t("COMMON.CARD.ESTIMATION")}</span>
                            {computableRoles.map((role) => {
                                const current = values.points[String(role.id)] ?? null;
                                return (
                                    <label key={role.id} className="points-per-role">
                                        <span className="role-name">{role.name ?? ""}</span>
                                        <select
                                            className="points-value"
                                            aria-label={role.name ?? String(role.id)}
                                            value={current === null ? "" : String(current)}
                                            onChange={(event) =>
                                                setEstimation(
                                                    role.id,
                                                    event.target.value === ""
                                                        ? null
                                                        : Number(event.target.value),
                                                )
                                            }
                                        >
                                            <option value="">?</option>
                                            {points.map((point) => (
                                                <option key={point.id} value={String(point.id)}>
                                                    {point.name ?? String(point.value ?? "")}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                );
                            })}
                        </fieldset>
                    ) : null}

                    <fieldset className="ticket-detail-settings">
                        <button
                            type="button"
                            className={`btn-icon is-blocked ${values.is_blocked ? "item-unblock" : "item-block"}`}
                            aria-pressed={values.is_blocked ? "true" : "false"}
                            title={t("COMMON.BLOCK_TITLE")}
                            aria-label={t("COMMON.BLOCK_TITLE")}
                            onClick={() => setField("is_blocked", !values.is_blocked)}
                        >
                            <span className="icon icon-lock" aria-hidden="true" />
                        </button>
                        {values.is_blocked ? (
                            <textarea
                                className="blocked-note"
                                name="blocked_note"
                                placeholder={t("COMMON.BLOCKED_NOTE")}
                                value={values.blocked_note}
                                onChange={(event) => setField("blocked_note", event.target.value)}
                            />
                        ) : null}
                    </fieldset>
                </div>
            </div>

            {mode === "create" ? (
                <fieldset className="creation-position">
                    <span className="label">{t("LIGHTBOX.CREATE_EDIT.LOCATION")}</span>
                    <div className="creation-position-fields">
                        <label className="custom-radio">
                            <input
                                type="radio"
                                name="us_position"
                                value="bottom"
                                checked={values.us_position === "bottom"}
                                onChange={() => setField("us_position", "bottom")}
                            />
                            <span className="radio-control" />
                            <span className="radio-label">
                                {t("LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM")}
                            </span>
                        </label>
                        <label className="custom-radio">
                            <input
                                type="radio"
                                name="us_position"
                                value="top"
                                checked={values.us_position === "top"}
                                onChange={() => setField("us_position", "top")}
                            />
                            <span className="radio-control" />
                            <span className="radio-label">
                                {t("LIGHTBOX.CREATE_EDIT.CREATE_TOP")}
                            </span>
                        </label>
                    </div>
                </fieldset>
            ) : null}

            {errorMessage !== null ? (
                <div className="lightbox-error" role="alert" aria-live="assertive">
                    {errorMessage}
                </div>
            ) : null}

            <div className="btn-container">
                <button
                    id="submitButton"
                    type="submit"
                    className="btn-big add-item"
                    disabled={!submittable}
                    aria-disabled={submittable ? undefined : "true"}
                >
                    {mode === "edit" ? t("COMMON.SAVE") : t("COMMON.CREATE")}
                </button>
                <button type="button" className="cancel" onClick={onClose}>
                    {t("COMMON.CANCEL")}
                </button>
            </div>
        </form>
    );
}

export function StoryFormLightbox(props: StoryFormLightboxProps): React.ReactElement {
    // Remount key: the inner form seeds its field state ONCE (on mount), so when
    // the target changes WITHOUT closing the lightbox first (e.g. create -> edit,
    // or editing a different story), the key change forces a remount that re-seeds
    // the fields from the new `initialValues`. It is derived from the mode + the
    // seed values, both stable across the parent's re-renders while the target is
    // unchanged, so ordinary typing never triggers a remount.
    const bodyKey = `${props.mode}:${JSON.stringify(props.initialValues ?? {})}`;
    return (
        <Lightbox
            open={props.open}
            onClose={props.onClose}
            className="lightbox-generic-form lightbox-create-edit"
            markerAttr="tg-lb-create-edit-userstory"
            labelledById={TITLE_ID}
            initialFocusSelector="input[name='subject']"
        >
            <StoryFormBody key={bodyKey} {...props} />
        </Lightbox>
    );
}

export default StoryFormLightbox;
