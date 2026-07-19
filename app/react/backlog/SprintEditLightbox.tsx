/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintEditLightbox — the create/edit sprint (milestone) modal for the React
 * Backlog screen.
 *
 * Ports the AngularJS `tgLbCreateEditSprint` directive
 * (app/coffee/modules/backlog/lightboxes.coffee L237, `CreateEditSprint`) and
 * its Jade template app/partials/includes/modules/lightbox-sprint-add-edit.jade
 * (hosted in backlog.jade L201-202 as `div.lightbox.lightbox-sprint-add-edit`).
 *
 * Like-for-like behavior (no redesign), with three deliberate substitutions
 * mandated by the migration plan (AAP §0.1.2, §0.4.1):
 *  - `checksley` (`form.checksley()`, lightboxes.coffee L44,L143) is REPLACED by
 *    the pure `validate()` from `../shared/validation/sprintForm` (required name,
 *    maxlength 200 (frozen backend), valid dates, non-inverted range — range error on finish).
 *  - `$repo.create/save/remove("milestones", ...)` become the frozen-`/api/v1/`
 *    adapter calls in `../shared/api/milestones` (create / save / remove).
 *  - the CoffeeScript `debounce 2000` on submit becomes a `submitting` guard
 *    that disables the submit/delete buttons while a request is in flight.
 *
 * The component is SELF-CONTAINED: it renders the full
 * `div.lightbox.lightbox-sprint-add-edit` wrapper, the close control and the
 * form, reproducing the EXACT DOM structure and CSS class names of the Jade
 * template so the already-compiled SCSS themes it unchanged (visual parity by
 * construction — AAP §0.3.4). It renders `null` when closed.
 *
 * It is intentionally PURE and presentational: `initialValues`,
 * `lastSprintName` and `canDelete` are precomputed by `BacklogApp` (which owns
 * the sprint list + permission matrix), and `onChanged` / `onClose` bubble the
 * outcome back up (porting the `sprintform:*` broadcasts + `lightboxService`
 * open/close). This keeps the component trivially testable.
 *
 * i18n note: the migration renders English literals; the corresponding
 * angular-translate keys are kept inline as comments. The literals are the
 * verified values from app/locales/taiga/locale-en.json.
 */

import { useState, useEffect, useCallback, useRef, useId } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import moment from "moment";

import type { Project, Sprint, Id } from "./types";
import { validate, DATE_FORMAT, NAME_MAX_LENGTH } from "../shared/validation/sprintForm";
import type {
    SprintFormValues,
    SprintFormErrors,
} from "../shared/validation/sprintForm";
import {
    create as createMilestone,
    save as saveMilestone,
    remove as removeMilestone,
} from "../shared/api/milestones";
import type { MilestoneWritable } from "../shared/api/milestones";
import { t } from "../shared/i18n/translate";
import { HttpError } from "../shared/api/httpClient";
import { ConfirmDialog } from "../shared/dialog/ConfirmDialog";
import { useDialogA11y } from "../shared/dialog/useDialogA11y";
import { DatePicker } from "../shared/ui/DatePicker";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Generic save-failure message shown when the server rejects the create/edit
 * without a field-specific reason. Ports the AngularJS `$confirm.notify(...)`
 * toast (lightboxes.coffee L98-101, L117). i18n: COMMON.SAVE_ERROR (generic).
 */
const SAVE_ERROR_MESSAGE = "An error occurred while saving.";

/**
 * Delete-confirmation dialog title. Ports `$confirm.askOnDelete(title, message)`
 * (lightboxes.coffee L104-107) where `title = LIGHTBOX.DELETE_SPRINT.TITLE`.
 * [H] The native `window.confirm` is replaced by the themed {@link ConfirmDialog}
 * (`.lightbox-generic-delete`), matching the AngularJS styled confirm-lightbox.
 * i18n: LIGHTBOX.DELETE_SPRINT.TITLE ("Delete sprint").
 */
const DELETE_CONFIRM_TITLE = "Delete sprint";

/**
 * Render the create-mode "last sprint is <strong>{name}</strong>" hint from the
 * shared catalog ([i18n], key LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME). The
 * catalog value embeds a `<strong>` around the interpolated sprint name; rather
 * than losing that emphasis (a flat string cannot carry React elements) OR
 * risking `dangerouslySetInnerHTML`, we split the localized string on the single
 * known `<strong>…</strong>` boundary and render each segment as escaped React
 * text — preserving both the bold emphasis (visual parity) AND localization,
 * with the interpolated name always escaped by React (XSS-safe).
 */
function renderLastSprintHint(name: string): ReactNode {
    const rendered = t(
        "LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME",
        "last sprint is <strong> {{lastSprint}} ;-) </strong>",
        { lastSprint: name },
    );
    const match = rendered.match(/^([\s\S]*?)<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
    if (!match) {
        // No <strong> in this locale's value — render the plain (tag-stripped) text.
        return rendered.replace(/<\/?strong>/g, "");
    }
    return (
        <>
            {match[1]}
            <strong>{match[2]}</strong>
            {match[3]}
        </>
    );
}

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

export interface SprintEditLightboxProps {
    /** BacklogApp-controlled visibility (ports `$scope.createEditOpen`). */
    open: boolean;
    /** Whether the lightbox creates a new sprint or edits an existing one. */
    mode: "create" | "edit";
    /** Current project — supplies `project.id` for the write payload. */
    project: Project;
    /** The sprint being edited; present (non-null) only in `edit` mode. */
    sprint?: Sprint | null;
    /**
     * Precomputed form seed. On create BacklogApp passes
     * `{ name: "", estimated_start: lastSprint.estimated_finish || today,
     * estimated_finish: start + 2 weeks, project: project.id }`; on edit it
     * passes the sprint's `name`/`estimated_start`/`estimated_finish`
     * normalized to `YYYY-MM-DD`.
     */
    initialValues: SprintFormValues;
    /** Name of the most recent open sprint — drives the create-mode hint. */
    lastSprintName?: string | null;
    /** Maps to the `delete_milestone` permission; gates `.delete-sprint`. */
    canDelete: boolean;
    /** Called after a successful create/edit/remove so BacklogApp reloads. */
    onChanged: () => void;
    /** Dismisses the lightbox (ports `lightboxService.close`). */
    onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extract a human-readable message from a server field-error value. DRF returns
 * either a bare string or an array of strings per field; this returns the first
 * string it finds, matching how the legacy `form.setErrors(data)` surfaced the
 * first message per field.
 */
function firstString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
        return value[0];
    }

    return undefined;
}

/**
 * Normalize a date field to the canonical `YYYY-MM-DD` wire format. Strict
 * moment parsing (`moment(value, DATE_FORMAT, true)`) is used so a malformed
 * value is passed through UNCHANGED, letting `validate()` report the date error
 * (rather than silently coercing it). Ports lightboxes.coffee L59-60,L66-67.
 */
function normalizeDate(value: string): string {
    const parsed = moment(value, DATE_FORMAT, true);

    return parsed.isValid() ? parsed.format(DATE_FORMAT) : value;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SprintEditLightbox(props: SprintEditLightboxProps): JSX.Element | null {
    const {
        open,
        mode,
        project,
        sprint,
        initialValues,
        lastSprintName,
        canDelete,
        onChanged,
        onClose,
    } = props;

    // Controlled form state. `values` seeds from the precomputed initialValues;
    // `errors` come from validate() or from mapped server field-errors.
    const [values, setValues] = useState<SprintFormValues>(initialValues);
    const [errors, setErrors] = useState<SprintFormErrors>({});
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [serverError, setServerError] = useState<string | null>(null);
    // [H] Visibility of the themed delete-confirm dialog (replaces window.confirm).
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);

    // Refs to move focus to the first invalid field on a failed validate()
    // (ports the AngularJS focus behavior; keeps the form keyboard-friendly).
    const nameRef = useRef<HTMLInputElement>(null);
    const startRef = useRef<HTMLInputElement>(null);
    const finishRef = useRef<HTMLInputElement>(null);

    // [checksley parity] Whether the form has been validated at least once (via a
    // submit attempt). checksley (the replaced library) switches a field to LIVE
    // validation after the first validation run, so once the user has submitted,
    // correcting an invalid field clears its error immediately — WITHOUT needing a
    // second submit. The React port originally cleared errors only on re-submit,
    // a behavioral regression vs. checksley (AAP §0.1.2 "same field rules"). We
    // port the live-after-first-submit behavior: this ref flips true on the first
    // submit, after which the effect below re-runs validate() on every change.
    const hasValidatedOnceRef = useRef<boolean>(false);

    // Reset the form whenever the lightbox is (re)opened or its target changes.
    // Ports `resetSprint()` + the `sprintform:create` / `sprintform:edit`
    // handlers (lightboxes.coffee L28-36, L136-215).
    useEffect(() => {
        setValues(initialValues);
        setErrors({});
        setServerError(null);
        // Back to "not yet validated" so a freshly opened form never shows errors
        // until its first submit (checksley starts each form in on-submit mode).
        hasValidatedOnceRef.current = false;
    }, [open, mode, sprint, initialValues]);

    // [checksley parity] Live re-validation after the first submit. Once
    // hasValidatedOnceRef is set (first submit attempt), re-run validate() on
    // every value change so a corrected field clears its error immediately and an
    // inverted date range surfaces as soon as it becomes invalid — mirroring
    // checksley's post-first-validation live behavior. Guarded by the ref so the
    // form stays quiet until the user first submits.
    useEffect(() => {
        if (!hasValidatedOnceRef.current) {
            return;
        }
        const normalized: SprintFormValues = {
            ...values,
            estimated_start: normalizeDate(values.estimated_start),
            estimated_finish: normalizeDate(values.estimated_finish),
        };
        setErrors(validate(normalized).errors);
    }, [values]);

    // [M-09] Complete modal-dialog accessibility via the shared primitive:
    // role/aria-modal (spread from dialogProps), focus entry onto the sprint
    // name field, focus trap, focus return, background inert, and the shared
    // nested-dialog Escape stack. Escape closes the lightbox (equivalent to the
    // ✕ close button) but never while a submit is in flight
    // (`closeOnEscape: !submitting`). The former `!deleteConfirmOpen` guard is no
    // longer needed: because the nested {@link ConfirmDialog} now registers on
    // the SAME module-level stack, a single Escape dismisses ONLY the topmost
    // dialog — so while the delete-confirm is open it consumes Escape and this
    // lightbox stays put, exactly as before, without any local coordination.
    const titleId = useId();
    const { dialogRef, dialogProps } = useDialogA11y({
        open,
        onClose,
        closeOnEscape: !submitting,
        initialFocusRef: nameRef,
    });

    // Map a thrown adapter error onto the form. Ports `form.setErrors(data)` +
    // the `_error_message` / `__all__` notify branches (lightboxes.coffee
    // L97-101). Non-HttpError (e.g. a network failure) falls back to the
    // generic message.
    const handleApiError = useCallback((error: unknown): void => {
        if (error instanceof HttpError && error.body !== null && typeof error.body === "object") {
            const body = error.body as Record<string, unknown>;

            const nextErrors: SprintFormErrors = {};
            const nameMsg = firstString(body["name"]);
            const startMsg = firstString(body["estimated_start"]);
            const finishMsg = firstString(body["estimated_finish"]);

            if (nameMsg !== undefined) {
                nextErrors.name = nameMsg;
            }
            if (startMsg !== undefined) {
                nextErrors.estimated_start = startMsg;
            }
            if (finishMsg !== undefined) {
                nextErrors.estimated_finish = finishMsg;
            }
            setErrors(nextErrors);

            const generic =
                firstString(body["_error_message"]) ??
                firstString(body["__all__"]) ??
                t("COMMON.SAVE_ERROR", SAVE_ERROR_MESSAGE);
            setServerError(generic);

            return;
        }

        setServerError(t("COMMON.SAVE_ERROR", SAVE_ERROR_MESSAGE));
    }, []);

    // Submit handler. Guards double-submit (replaces `debounce 2000`), normalizes
    // the dates, validates, then persists via the milestones adapter.
    const handleSubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>): Promise<void> => {
            event.preventDefault();

            if (submitting) {
                return;
            }

            // 1. Normalize date field values to YYYY-MM-DD (passthrough if invalid).
            const normalized: SprintFormValues = {
                ...values,
                estimated_start: normalizeDate(values.estimated_start),
                estimated_finish: normalizeDate(values.estimated_finish),
            };

            // 2. Validate. On failure show the errors, focus the first invalid
            //    field, and STOP (never call the API) — ports `form.validate()`.
            // Mark the form as "validated once" so the live-revalidation effect
            // takes over (checksley switches to live validation after first run).
            hasValidatedOnceRef.current = true;
            const result = validate(normalized);
            if (!result.valid) {
                setErrors(result.errors);
                if (result.errors.name !== undefined) {
                    nameRef.current?.focus();
                } else if (result.errors.estimated_start !== undefined) {
                    startRef.current?.focus();
                } else if (result.errors.estimated_finish !== undefined) {
                    finishRef.current?.focus();
                }

                return;
            }

            // 3. Persist. Build the writable milestone payload (only the fields
            //    the frozen adapter contract accepts — no `version`).
            setErrors({});
            setServerError(null);
            setSubmitting(true);

            const payload: MilestoneWritable = {
                project: project.id,
                name: normalized.name.trim(),
                estimated_start: normalized.estimated_start,
                estimated_finish: normalized.estimated_finish,
            };

            try {
                if (mode === "create") {
                    await createMilestone(payload);
                } else if (sprint) {
                    const sprintId: Id = sprint.id;
                    await saveMilestone(sprintId, payload);
                }
                onChanged();
                onClose();
            } catch (error) {
                handleApiError(error);
            } finally {
                setSubmitting(false);
            }
        },
        [submitting, values, mode, sprint, project, onChanged, onClose, handleApiError],
    );

    // Delete handler (edit + `delete_milestone` only). Ports `remove()`
    // (lightboxes.coffee L103-118). [H] Opens the themed {@link ConfirmDialog}
    // instead of the native `window.confirm`; the actual removal runs in
    // `handleConfirmDelete` once the user confirms.
    const handleRemove = useCallback((): void => {
        if (submitting || !sprint) {
            return;
        }
        setDeleteConfirmOpen(true);
    }, [submitting, sprint]);

    // [H] Cancel path — dismiss the confirm dialog without deleting.
    const handleCancelDelete = useCallback((): void => {
        if (submitting) {
            return;
        }
        setDeleteConfirmOpen(false);
    }, [submitting]);

    // [H] Confirm path — perform the milestone removal. Ports the
    // `$confirm.askOnDelete(...).then(onSuccess, onError)` body: on success the
    // parent is notified and both dialogs close; on error the confirm dialog is
    // dismissed and the server error surfaces in the edit lightbox.
    const handleConfirmDelete = useCallback(async (): Promise<void> => {
        if (submitting || !sprint) {
            return;
        }

        setSubmitting(true);
        setServerError(null);

        try {
            const sprintId: Id = sprint.id;
            await removeMilestone(sprintId);
            setDeleteConfirmOpen(false);
            onChanged();
            onClose();
        } catch (error) {
            setDeleteConfirmOpen(false);
            handleApiError(error);
        } finally {
            setSubmitting(false);
        }
    }, [submitting, sprint, onChanged, onClose, handleApiError]);

    // Per-field change handlers. Explicit per-field updates keep the state
    // strictly typed (no computed-key widening) — only the three text fields
    // are user-editable; `project` is carried through untouched.
    const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
        const next = event.target.value;
        setValues((prev) => ({ ...prev, name: next }));
    }, []);

    // [BL-03] The date fields are now the themed {@link DatePicker} (Pikaday-
    // classed), which emits the picked date directly in the `YYYY-MM-DD` wire
    // format — so these handlers take a string, not a change event. The value
    // shape is UNCHANGED (still `YYYY-MM-DD`), leaving validate()/normalize()/
    // payload untouched.
    const handleStartChange = useCallback((next: string): void => {
        setValues((prev) => ({ ...prev, estimated_start: next }));
    }, []);

    const handleFinishChange = useCallback((next: string): void => {
        setValues((prev) => ({ ...prev, estimated_finish: next }));
    }, []);

    // Closed: render nothing (cleanest; mirrors the lightbox being hidden).
    if (!open) {
        return null;
    }

    const showLastSprintHint = mode === "create" && Boolean(lastSprintName);

    return (
        <>
        {/* [#3] reveal: the `.lightbox` SCSS mixin's base is `display:none;opacity:0`
            and it is revealed ONLY by the `.open` class (`.lightbox.open{display:flex}`).
            This component returns `null` when `!open` (see the guard above), so it is
            rendered exclusively in the open state — hence the `open` class is applied
            unconditionally here. */}
        <div
            ref={dialogRef}
            {...dialogProps}
            aria-labelledby={titleId}
            className="lightbox lightbox-sprint-add-edit open"
        >
            {/* Ports tg-lightbox-close (tg-svg svg-icon="icon-close"). i18n COMMON.CLOSE */}
            <button
                className="close"
                type="button"
                onClick={onClose}
                title={t("COMMON.CLOSE", "close")}
                aria-label={t("COMMON.CLOSE", "close")}
            >
                <svg className="icon icon-close" aria-hidden="true" focusable="false">
                    <use xlinkHref="#icon-close" href="#icon-close" />
                </svg>
            </button>

            <form onSubmit={handleSubmit} noValidate>
                <h2 className="title" id={titleId}>
                    {mode === "create"
                        ? t("LIGHTBOX.ADD_EDIT_SPRINT.TITLE", "New sprint")
                        : t("BACKLOG.EDIT_SPRINT", "Edit Sprint")}
                </h2>

                <fieldset>
                    {/* [BL-02] The red invalid-field border comes from the compiled
                        rule `input.checksley-error { border: 2px solid $color-solid-red }`
                        (and `:focus` → `$color-link-red` #E44057) — it targets the
                        INPUT, not the fieldset (which is `border:0`). The port put the
                        class on the <fieldset>, so no border ever showed and a focused
                        field fell back to the teal focus border. The class now lives on
                        the <input>, matching how checksley/parsley flags the failing
                        field, so the border renders red as in the baseline. */}
                    <input
                        ref={nameRef}
                        className={`sprint-name e2e-sprint-name${errors.name ? " checksley-error" : ""}`}
                        type="text"
                        name="name"
                        maxLength={NAME_MAX_LENGTH}
                        value={values.name}
                        onChange={handleNameChange}
                        placeholder={t("LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME", "sprint name")}
                        autoFocus
                    />
                    <label className="last-sprint-name">
                        {showLastSprintHint ? renderLastSprintHint(lastSprintName as string) : ""}
                    </label>
                    {errors.name && <span className="checksley-required">{errors.name}</span>}
                </fieldset>

                {/* [BL-03] The two date fields are the themed {@link DatePicker}
                    reproducing the legacy `tg-date-selector` (Pikaday) control: a
                    read-only text input formatted "DD MMM YYYY" (no native
                    `type=date` mask, no native calendar icon) that opens a
                    Pikaday-classed calendar popover. The value stays `YYYY-MM-DD`.
                    [BL-02] The `checksley-error` class is appended to the field's
                    className on error so the invalid date gets the same red border
                    as the name field. The DatePicker renders as a Fragment (input +
                    popover), so the `.date-start`/`.date-end` input still sits
                    directly inside this `.dates > div` (SCSS anchor + error-span
                    parent relationship preserved). */}
                <fieldset className="dates">
                    <div>
                        <DatePicker
                            ref={startRef}
                            className={`date-start${errors.estimated_start ? " checksley-error" : ""}`}
                            name="estimated_start"
                            value={values.estimated_start}
                            onChange={handleStartChange}
                            disabled={submitting}
                            ariaLabel={t("LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START", "Estimated Start")}
                        />
                        {errors.estimated_start && (
                            <span className="checksley-required">{errors.estimated_start}</span>
                        )}
                    </div>
                    <div>
                        <DatePicker
                            ref={finishRef}
                            className={`date-end${errors.estimated_finish ? " checksley-error" : ""}`}
                            name="estimated_finish"
                            value={values.estimated_finish}
                            onChange={handleFinishChange}
                            disabled={submitting}
                            ariaLabel={t("LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END", "Estimated End")}
                        />
                        {errors.estimated_finish && (
                            <span className="checksley-required">{errors.estimated_finish}</span>
                        )}
                    </div>
                </fieldset>

                <div className="sprint-add-edit-actions">
                    <button
                        className="btn-big button-large button-block"
                        type="submit"
                        title={t("COMMON.SAVE", "Save")}
                        disabled={submitting}
                    >
                        {t("COMMON.SAVE", "Save")}
                    </button>

                    {mode === "edit" && canDelete && (
                        <button
                            className="btn-link delete-sprint"
                            type="button"
                            onClick={handleRemove}
                            title={t("LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT", "delete sprint")}
                            disabled={submitting}
                        >
                            <svg className="icon icon-trash" aria-hidden="true" focusable="false">
                                <use xlinkHref="#icon-trash" href="#icon-trash" />
                            </svg>
                            <span className="delete-sprint-text">
                                {t(
                                    "LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT",
                                    "Do you want to delete this sprint?",
                                )}
                            </span>
                        </button>
                    )}
                </div>

                {serverError && (
                    <div className="error-message" role="alert">
                        {serverError}
                    </div>
                )}
            </form>
        </div>

        {/* [H] Themed delete-confirm dialog (replaces the native window.confirm).
            Ports `$confirm.askOnDelete(LIGHTBOX.DELETE_SPRINT.TITLE, sprint.name)`
            — title + sprint name in the `.lightbox-generic-delete` shell.
            [BL-04] `askOnDelete` (confirm.coffee L122-125) defaults the subtitle to
            `NOTIFICATION.ASK_DELETE` ("Are you sure you want to delete?") when the
            caller passes none; the React port dropped that line, so the confirm
            showed only the sprint name. The subtitle is restored here, rendered in
            the dialog's `span.subtitle` above the `span.message` sprint name. */}
        <ConfirmDialog
            open={deleteConfirmOpen}
            variant="delete"
            title={t("LIGHTBOX.DELETE_SPRINT.TITLE", DELETE_CONFIRM_TITLE)}
            subtitle={t("NOTIFICATION.ASK_DELETE", "Are you sure you want to delete?")}
            message={sprint ? <strong>{sprint.name}</strong> : null}
            confirmLabel={t("COMMON.DELETE", "Delete")}
            cancelLabel={t("COMMON.CANCEL", "Cancel")}
            busy={submitting}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
        />
        </>
    );
}
