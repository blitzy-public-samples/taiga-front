/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lightbox } from "./Lightbox";
import { ConfirmAskLightbox } from "./ConfirmAskLightbox";
import { t } from "../i18n/translate";
import {
    createEmptyStoryValues,
    isStoryFormDirty,
    isStoryFormValid,
    validateStoryForm,
    SUBJECT_MAX_LENGTH,
    type StoryFormValues,
} from "./storyForm";
import type { Attachment, Point, ProjectMember, Role, Status, Swimlane, Tag } from "../types";

/**
 * Shared create/edit user-story lightbox reproducing the legacy
 * `lb-create-edit.jade` (+ `lb-create-edit-us.jade`) DOM and behaviour, closing
 * finding C2 (complete, source-compatible story form) and reused by BOTH
 * migrated screens (finding C7). Finding M1 completes the previously-omitted
 * fields and widgets so the form is at full legacy parity:
 *
 *   - tag autocomplete + colour management (`tg-tag-line-common` +
 *     `tg-tags-dropdown` + `tg-color-selector`),
 *   - due-date control (`tg-due-date-popover`, `format="button"`),
 *   - team-requirement / client-requirement toggles (`lb-create-edit-us.jade`),
 *   - attachment add/delete lifecycle (`tg-attachments-simple` +
 *     `attachmentsService`), applied AFTER save by the owning hook,
 *   - a localized, themed dirty-close confirmation (`$confirm.ask(
 *     "LIGHTBOX.CREATE_EDIT.CONFIRM_CLOSE")` → `.lightbox-generic-ask`),
 *     replacing the previous English `window.confirm` substitute.
 *
 * It stays framework-agnostic: all data and the persistence callback are
 * injected, and i18n goes through the shared `t()` mechanism (finding M7). The
 * form BODY mounts only while the lightbox is open (via {@link Lightbox}), so
 * its state resets on each open exactly like the legacy `form(ng-if=
 * "lightboxOpen")`.
 *
 * `is_iocaine` is intentionally ABSENT: it exists ONLY in the legacy TASK form
 * (`lb-create-edit-task.jade`), never the user-story form — the legacy US
 * template renders no `.iocaine` control (D1: the legacy source is the contract).
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
    /**
     * Project tag palette (`project.tags_colors`) as a `name -> color` map, used
     * for tag autocomplete suggestions and to auto-assign a known tag's colour
     * (finding M1, mirroring `TagLineCommonController.addNewTag`). Optional; when
     * absent the tag input still works (new tags get the picked/none colour).
     */
    projectTagsColors?: Record<string, string | null>;
    /** Prefill (edit) / target (create) values. */
    initialValues?: Partial<StoryFormValues>;
    /** True while the persistence call is in flight (disables submit). */
    saving: boolean;
    /** Sanitized, user-facing error text from the last failed submit. */
    errorMessage: string | null;
    /** Permission gate (`add_us` on create, `modify_us` on edit). */
    canSubmit: boolean;
}

/** Internal props for the mounted-while-open body (adds the dirty bridge). */
interface StoryFormBodyProps extends StoryFormLightboxProps {
    /** Reports the body's dirty state up so the parent can guard the close (M1). */
    onDirtyChange: (dirty: boolean) => void;
}

const TITLE_ID = "lb-create-edit-us-title";

/**
 * Default tag colour palette — the legacy `taiga.getDefaulColorList()`
 * (`app/coffee/utils.coffee` `DEFAULT_COLOR_LIST`), reproduced verbatim so the
 * new-tag colour selector offers the identical swatches (finding M1).
 */
const DEFAULT_COLOR_LIST: string[] = [
    "#D35163", "#D351CF", "#AC51D3", "#8151D3", "#5551D3", "#5178D3", "#78D351",
    "#51D355", "#51D381", "#51D3AC", "#51CFD3", "#51A3D3", "#A3D350", "#CFD350",
    "#D3AC50", "#D38050", "#D35450", "#E44057", "#4C566A", "#70728F", "#A9AABC",
];

/** Human-readable byte size for a queued upload (legacy `sizeFormat`). */
function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** The mounted-while-open form body; its state initialises fresh on each open. */
function StoryFormBody(props: StoryFormBodyProps): React.ReactElement {
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
        projectTagsColors,
        initialValues,
        saving,
        errorMessage,
        canSubmit,
        onDirtyChange,
    } = props;

    // Seed once (on mount == on open). Create defaults the status to the target
    // (or the first status) and the swimlane to the project default. The same
    // seed is retained as the dirty-comparison baseline (finding M1).
    const initialSeed = useMemo<StoryFormValues>(
        () =>
            createEmptyStoryValues({
                status: statuses[0]?.id ?? null,
                swimlane: defaultSwimlaneId,
                ...initialValues,
            }),
        // Seed ONCE on mount; the body remounts (new key) when the target
        // changes, which re-runs this with the new inputs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );
    const [values, setValues] = useState<StoryFormValues>(() => initialSeed);
    const [subjectTouched, setSubjectTouched] = useState<boolean>(false);
    const [statusOpen, setStatusOpen] = useState<boolean>(false);
    const [tagInputOpen, setTagInputOpen] = useState<boolean>(false);
    const [tagDraft, setTagDraft] = useState<string>("");
    const [tagColor, setTagColor] = useState<string | null>(null);
    const [colorListOpen, setColorListOpen] = useState<boolean>(false);
    const [dueDateOpen, setDueDateOpen] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const errors = validateStoryForm(values);
    const showSubjectError = subjectTouched && errors.subject !== undefined;
    const submittable = canSubmit && !saving && isStoryFormValid(values);

    // Report dirty state up so the parent can gate Escape / close / Cancel.
    const dirty = isStoryFormDirty(values, initialSeed);
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);
    // Reset the reported dirty state when the body unmounts (lightbox closed).
    useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

    const selectedStatus = useMemo<Status | undefined>(
        () => statuses.find((status) => status.id === values.status),
        [statuses, values.status],
    );
    const computableRoles = useMemo<Role[]>(
        () => roles.filter((role) => role.computable === true),
        [roles],
    );

    // Tag autocomplete suggestions: project tags whose name contains the draft
    // (case-insensitive) and are not already added (mirrors `tg-tags-dropdown`).
    const tagSuggestions = useMemo<Tag[]>(() => {
        if (projectTagsColors === undefined) {
            return [];
        }
        const draft = tagDraft.trim().toLowerCase();
        if (draft.length === 0) {
            return [];
        }
        const added = new Set(values.tags.map((tag) => tag[0].toLowerCase()));
        return Object.keys(projectTagsColors)
            .filter((name) => name.toLowerCase().indexOf(draft) !== -1 && !added.has(name.toLowerCase()))
            .map((name) => [name, projectTagsColors[name]] as Tag);
    }, [projectTagsColors, tagDraft, values.tags]);

    const setField = useCallback(
        <K extends keyof StoryFormValues>(key: K, value: StoryFormValues[K]): void => {
            setValues((prev) => ({ ...prev, [key]: value }));
        },
        [],
    );

    // Add a tag with a resolved colour (finding M1): a known project tag keeps
    // its palette colour; otherwise the picked colour (or none) is used. Mirrors
    // `TagLineCommonController.addNewTag`.
    const addTag = useCallback(
        (rawName: string, color: string | null): void => {
            const name = rawName.trim().toLowerCase();
            if (name.length === 0) {
                return;
            }
            const resolvedColor =
                projectTagsColors !== undefined && projectTagsColors[name] !== undefined
                    ? projectTagsColors[name]
                    : color;
            setValues((prev) =>
                prev.tags.some((tag) => tag[0] === name)
                    ? prev
                    : { ...prev, tags: [...prev.tags, [name, resolvedColor] as Tag] },
            );
            setTagDraft("");
            setTagColor(null);
            setColorListOpen(false);
        },
        [projectTagsColors],
    );

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

    // Queue newly selected files for upload AFTER save (legacy attachmentsToAdd).
    const queueAttachments = useCallback((fileList: FileList | null): void => {
        if (fileList === null || fileList.length === 0) {
            return;
        }
        const added = Array.from(fileList);
        setValues((prev) => ({ ...prev, attachmentsToAdd: [...prev.attachmentsToAdd, ...added] }));
    }, []);

    // Remove a still-queued (not-yet-uploaded) file (legacy: drop from add list).
    const removeQueuedAttachment = useCallback((index: number): void => {
        setValues((prev) => ({
            ...prev,
            attachmentsToAdd: prev.attachmentsToAdd.filter((_, i) => i !== index),
        }));
    }, []);

    // Queue a persisted attachment for deletion AFTER save (legacy
    // attachmentsToDelete): hide it now, delete it on submit.
    const deleteExistingAttachment = useCallback((attachment: Attachment): void => {
        if (attachment.id === undefined) {
            return;
        }
        const id = attachment.id;
        setValues((prev) => ({
            ...prev,
            attachments: prev.attachments.filter((a) => a.id !== id),
            attachmentsToDelete: prev.attachmentsToDelete.includes(id)
                ? prev.attachmentsToDelete
                : [...prev.attachmentsToDelete, id],
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

    const attachmentCount = values.attachments.length + values.attachmentsToAdd.length;

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
                            <div className="tags-container">
                                {values.tags.map((tag) => (
                                    <div key={tag[0]} className="tag-wrapper">
                                        <div
                                            className="tag"
                                            style={{ backgroundColor: tag[1] ?? undefined }}
                                        >
                                            <span>{tag[0]}</span>
                                            <button
                                                type="button"
                                                className="icon icon-close e2e-delete-tag"
                                                title={t("COMMON.TAGS.DELETE")}
                                                aria-label={t("COMMON.TAGS.DELETE")}
                                                onClick={() => removeTag(tag[0])}
                                            >
                                                <span className="icon icon-close" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {!tagInputOpen ? (
                                    <button
                                        type="button"
                                        className="btn-filter ng-animate-disabled e2e-show-tag-input"
                                        title={t("COMMON.TAGS.ADD")}
                                        onClick={() => setTagInputOpen(true)}
                                    >
                                        <span className="add-tag-text">{t("COMMON.TAGS.ADD")}</span>
                                        <span className="icon icon-add" aria-hidden="true" />
                                    </button>
                                ) : (
                                    <div className="add-tag-input">
                                        <input
                                            type="text"
                                            className="tag-input e2e-add-tag-input"
                                            placeholder={t("COMMON.TAGS.PLACEHOLDER")}
                                            aria-label={t("COMMON.TAGS.ADD")}
                                            value={tagDraft}
                                            autoFocus
                                            onChange={(event) => setTagDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    addTag(tagDraft, tagColor);
                                                }
                                            }}
                                        />

                                        {tagSuggestions.length > 0 ? (
                                            <ul className="tags-dropdown">
                                                {tagSuggestions.map((suggestion) => (
                                                    <li
                                                        key={suggestion[0]}
                                                        onClick={() => addTag(suggestion[0], suggestion[1])}
                                                    >
                                                        <div className="tags-dropdown-option">
                                                            <span className="tags-dropdown-name">
                                                                {suggestion[0]}
                                                            </span>
                                                            {suggestion[1] ? (
                                                                <span
                                                                    className="tags-dropdown-color"
                                                                    title={suggestion[1] ?? undefined}
                                                                    style={{ background: suggestion[1] ?? undefined }}
                                                                />
                                                            ) : null}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}

                                        <div className="color-selector">
                                            <div
                                                className={`tag-color e2e-open-color-selector${tagColor ? "" : " empty-color"}`}
                                                title={tagColor ?? undefined}
                                                style={{ background: tagColor ?? undefined }}
                                                onClick={() => setColorListOpen((prev) => !prev)}
                                            />
                                            {colorListOpen ? (
                                                <div className="color-selector-dropdown">
                                                    <ul className="color-selector-dropdown-list e2e-color-dropdown">
                                                        {DEFAULT_COLOR_LIST.map((color) => (
                                                            <li
                                                                key={color}
                                                                className="color-selector-option"
                                                                title={color}
                                                                style={{ background: color }}
                                                                onClick={() => {
                                                                    setTagColor(color);
                                                                    setColorListOpen(false);
                                                                }}
                                                            />
                                                        ))}
                                                        <li
                                                            className="empty-color"
                                                            onClick={() => {
                                                                setTagColor(null);
                                                                setColorListOpen(false);
                                                            }}
                                                        />
                                                    </ul>
                                                </div>
                                            ) : null}
                                        </div>

                                        <button
                                            type="button"
                                            className="save icon icon-save"
                                            title={t("COMMON.TAGS.ADD")}
                                            aria-label={t("COMMON.TAGS.ADD")}
                                            onClick={() => addTag(tagDraft, tagColor)}
                                        >
                                            <span className="icon icon-save" aria-hidden="true" />
                                        </button>
                                    </div>
                                )}
                            </div>
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

                    <section className="attachments attachment-simple">
                        <div className="attachments-header">
                            <h3 className="attachments-title">
                                <span className="attachments-num">{attachmentCount}</span>{" "}
                                <span className="attachments-text">{t("ATTACHMENT.SECTION_NAME")}</span>
                            </h3>
                            <div className="add-attach" id="a11y-add-attach" title={t("ATTACHMENT.ADD").replace("{{maxFileSizeMsg}}", "")}>
                                <button
                                    type="button"
                                    className="btn-icon add-attachment-button"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <span className="icon icon-add" aria-hidden="true" />
                                </button>
                                <input
                                    ref={fileInputRef}
                                    aria-label={t("ATTACHMENT.ADD").replace("{{maxFileSizeMsg}}", "")}
                                    id="add-attach"
                                    type="file"
                                    multiple
                                    style={{ display: "none" }}
                                    onChange={(event) => {
                                        queueAttachments(event.target.files);
                                        // Allow re-selecting the same file after a remove.
                                        event.target.value = "";
                                    }}
                                />
                            </div>
                        </div>

                        {attachmentCount === 0 ? (
                            <div className="attachments-empty">
                                <div>{t("ATTACHMENT.DROP")}</div>
                            </div>
                        ) : null}

                        <div className="attachment-body attachment-list">
                            {values.attachments.map((attachment) => (
                                <div key={`existing-${attachment.id}`} className="single-attachment">
                                    <div className="attachment-name">
                                        <span className="icon icon-attachment" aria-hidden="true" />
                                        <span>{attachment.name ?? ""}</span>
                                    </div>
                                    <div className="attachment-size">
                                        <span />
                                    </div>
                                    <div className="attachment-settings">
                                        <button
                                            type="button"
                                            className="settings attachment-delete"
                                            title={t("COMMON.DELETE")}
                                            aria-label={t("COMMON.DELETE")}
                                            onClick={() => deleteExistingAttachment(attachment)}
                                        >
                                            <span className="icon icon-trash" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {values.attachmentsToAdd.map((file, index) => (
                                <div key={`queued-${index}-${file.name}`} className="single-attachment">
                                    <div className="attachment-name">
                                        <span className="icon icon-attachment" aria-hidden="true" />
                                        <span>{file.name}</span>
                                    </div>
                                    <div className="attachment-size">
                                        <span>{formatSize(file.size)}</span>
                                    </div>
                                    <div className="attachment-settings">
                                        <button
                                            type="button"
                                            className="settings attachment-delete"
                                            title={t("COMMON.DELETE")}
                                            aria-label={t("COMMON.DELETE")}
                                            onClick={() => removeQueuedAttachment(index)}
                                        >
                                            <span className="icon icon-trash" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
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
                        <div className="due-date-button-wrapper">
                            <button
                                type="button"
                                className={`btn-icon due-date-button is-editable date-picker-popover-trigger${values.due_date ? " date-set active" : ""}`}
                                title={
                                    values.due_date
                                        ? t("COMMON.CARD.DUE_DATE").replace("{{date}}", values.due_date)
                                        : t("COMMON.DUE_DATE.TITLE_ACTION_SET_DUE_DATE")
                                }
                                aria-label={t("COMMON.DUE_DATE.TITLE_ACTION_SET_DUE_DATE")}
                                aria-expanded={dueDateOpen ? "true" : "false"}
                                onClick={() => setDueDateOpen((prev) => !prev)}
                            >
                                <span className="icon icon-clock" aria-hidden="true" />
                            </button>
                            {dueDateOpen ? (
                                <div className="date-picker-popover" style={{ display: "block" }}>
                                    <div className="date-picker-container">
                                        <input
                                            type="date"
                                            className="due-date"
                                            aria-label={t("COMMON.DUE_DATE.TITLE_ACTION_SET_DUE_DATE")}
                                            value={values.due_date ?? ""}
                                            onChange={(event) =>
                                                setField(
                                                    "due_date",
                                                    event.target.value === "" ? null : event.target.value,
                                                )
                                            }
                                        />
                                    </div>
                                    {values.due_date ? (
                                        <div className="date-picker-popover-footer">
                                            <a
                                                href="#"
                                                className="date-picker-clean"
                                                title={t("LIGHTBOX.SET_DUE_DATE.TITLE_ACTION_DELETE_DUE_DATE")}
                                                aria-label={t("LIGHTBOX.SET_DUE_DATE.TITLE_ACTION_DELETE_DUE_DATE")}
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    setField("due_date", null);
                                                }}
                                            >
                                                <span className="icon icon-trash" aria-hidden="true" />
                                            </a>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        <button
                            type="button"
                            className={`btn-icon team-requirement${values.team_requirement ? " active" : ""}`}
                            aria-label={t("COMMON.TEAM_REQUIREMENT")}
                            aria-pressed={values.team_requirement ? "true" : "false"}
                            title={t("COMMON.TEAM_REQUIREMENT")}
                            onClick={() => setField("team_requirement", !values.team_requirement)}
                        >
                            <span className="icon icon-team-requirement" aria-hidden="true" />
                        </button>

                        <button
                            type="button"
                            className={`btn-icon client-requirement${values.client_requirement ? " active" : ""}`}
                            aria-label={t("COMMON.CLIENT_REQUIREMENT")}
                            aria-pressed={values.client_requirement ? "true" : "false"}
                            title={t("COMMON.CLIENT_REQUIREMENT")}
                            onClick={() => setField("client_requirement", !values.client_requirement)}
                        >
                            <span className="icon icon-client-requirement" aria-hidden="true" />
                        </button>

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
    const { open, onClose } = props;

    // Dirty-close guard (finding M1): the body reports its dirty state here; the
    // close request (Escape / the close control routed through <Lightbox onClose>,
    // and the Cancel button) is intercepted — a pristine form closes immediately,
    // a dirty one opens the localized themed ask dialog, reproducing the legacy
    // `CreateEditDirective.checkClose` → `$confirm.ask(CONFIRM_CLOSE)` flow.
    const dirtyRef = useRef<boolean>(false);
    const [askOpen, setAskOpen] = useState<boolean>(false);

    const handleDirtyChange = useCallback((dirty: boolean): void => {
        dirtyRef.current = dirty;
    }, []);

    const requestClose = useCallback((): void => {
        if (dirtyRef.current) {
            setAskOpen(true);
        } else {
            onClose();
        }
    }, [onClose]);

    const confirmDiscard = useCallback((): void => {
        setAskOpen(false);
        dirtyRef.current = false;
        onClose();
    }, [onClose]);

    const cancelDiscard = useCallback((): void => {
        setAskOpen(false);
    }, []);

    // If the lightbox is closed from outside (e.g. a successful submit sets
    // open=false), drop any pending ask so it never lingers on the next open.
    useEffect(() => {
        if (!open) {
            setAskOpen(false);
        }
    }, [open]);

    // Remount key: the inner form seeds its field state ONCE (on mount), so when
    // the target changes WITHOUT closing the lightbox first (e.g. create -> edit,
    // or editing a different story), the key change forces a remount that re-seeds
    // the fields from the new `initialValues`. It is derived from the mode + the
    // seed values, both stable across the parent's re-renders while the target is
    // unchanged, so ordinary typing never triggers a remount.
    const bodyKey = `${props.mode}:${JSON.stringify(props.initialValues ?? {})}`;
    return (
        <>
            <Lightbox
                open={open}
                onClose={requestClose}
                className="lightbox-generic-form lightbox-create-edit"
                markerAttr="tg-lb-create-edit-userstory"
                labelledById={TITLE_ID}
                initialFocusSelector="input[name='subject']"
            >
                <StoryFormBody
                    key={bodyKey}
                    {...props}
                    onClose={requestClose}
                    onDirtyChange={handleDirtyChange}
                />
            </Lightbox>
            <ConfirmAskLightbox
                open={askOpen}
                title={t("LIGHTBOX.CREATE_EDIT.CONFIRM_CLOSE")}
                onConfirm={confirmDiscard}
                onCancel={cancelDiscard}
            />
        </>
    );
}

export default StoryFormLightbox;
