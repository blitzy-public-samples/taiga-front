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
 *    maxlength 500, valid dates, non-inverted range — range error on finish).
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

import { useState, useEffect, useCallback, useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import moment from "moment";

import type { Project, Sprint, Id } from "./types";
import { validate, DATE_FORMAT } from "../shared/validation/sprintForm";
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
import { HttpError } from "../shared/api/httpClient";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Maximum sprint-name length. Mirrors `data-maxlength="500"` on the sprint-name
 * input (lightbox-sprint-add-edit.jade L19); the same bound is enforced in
 * `validate()`. Kept as a literal here so the rendered `maxLength` attribute
 * matches the legacy markup byte-for-byte.
 */
const NAME_MAX_LENGTH = 500;

/**
 * Generic save-failure message shown when the server rejects the create/edit
 * without a field-specific reason. Ports the AngularJS `$confirm.notify(...)`
 * toast (lightboxes.coffee L98-101, L117). i18n: COMMON.SAVE_ERROR (generic).
 */
const SAVE_ERROR_MESSAGE = "An error occurred while saving.";

/**
 * Delete confirmation prompt. Ports `$confirm.askOnDelete(...)`
 * (lightboxes.coffee L107) with a dependency-free native `window.confirm`.
 * i18n: LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT
 * ("Do you want to delete this sprint?").
 */
const DELETE_CONFIRM_MESSAGE = "Do you want to delete this sprint?";

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

    // Refs to move focus to the first invalid field on a failed validate()
    // (ports the AngularJS focus behavior; keeps the form keyboard-friendly).
    const nameRef = useRef<HTMLInputElement>(null);
    const startRef = useRef<HTMLInputElement>(null);
    const finishRef = useRef<HTMLInputElement>(null);

    // Reset the form whenever the lightbox is (re)opened or its target changes.
    // Ports `resetSprint()` + the `sprintform:create` / `sprintform:edit`
    // handlers (lightboxes.coffee L28-36, L136-215).
    useEffect(() => {
        setValues(initialValues);
        setErrors({});
        setServerError(null);
    }, [open, mode, sprint, initialValues]);

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
                SAVE_ERROR_MESSAGE;
            setServerError(generic);

            return;
        }

        setServerError(SAVE_ERROR_MESSAGE);
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

    // Delete handler (edit + `delete_milestone` only). Ports `remove()` +
    // `$confirm.askOnDelete(...)` (lightboxes.coffee L103-118) using a
    // dependency-free native confirm.
    const handleRemove = useCallback(async (): Promise<void> => {
        if (submitting || !sprint) {
            return;
        }

        if (!window.confirm(DELETE_CONFIRM_MESSAGE)) {
            return;
        }

        setSubmitting(true);
        setServerError(null);

        try {
            const sprintId: Id = sprint.id;
            await removeMilestone(sprintId);
            onChanged();
            onClose();
        } catch (error) {
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

    const handleStartChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
        const next = event.target.value;
        setValues((prev) => ({ ...prev, estimated_start: next }));
    }, []);

    const handleFinishChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
        const next = event.target.value;
        setValues((prev) => ({ ...prev, estimated_finish: next }));
    }, []);

    // Closed: render nothing (cleanest; mirrors the lightbox being hidden).
    if (!open) {
        return null;
    }

    const showLastSprintHint = mode === "create" && Boolean(lastSprintName);

    return (
        <div className="lightbox lightbox-sprint-add-edit">
            {/* Ports tg-lightbox-close (tg-svg svg-icon="icon-close"). i18n COMMON.CLOSE */}
            <button
                className="close"
                type="button"
                onClick={onClose}
                title="close"
                aria-label="close"
            >
                <svg className="icon icon-close" aria-hidden="true" focusable="false">
                    <use xlinkHref="#icon-close" href="#icon-close" />
                </svg>
            </button>

            <form onSubmit={handleSubmit} noValidate>
                <h2 className="title">
                    {/* create: LIGHTBOX.ADD_EDIT_SPRINT.TITLE ; edit: BACKLOG.EDIT_SPRINT */}
                    {mode === "create" ? "New sprint" : "Edit Sprint"}
                </h2>

                <fieldset className={errors.name ? "checksley-error" : undefined}>
                    <input
                        ref={nameRef}
                        className="sprint-name e2e-sprint-name"
                        type="text"
                        name="name"
                        maxLength={NAME_MAX_LENGTH}
                        value={values.name}
                        onChange={handleNameChange}
                        /* i18n LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME */
                        placeholder="sprint name"
                        autoFocus
                    />
                    <label className="last-sprint-name">
                        {/* i18n LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME */}
                        {showLastSprintHint ? (
                            <>
                                last sprint is <strong> {lastSprintName} ;-) </strong>
                            </>
                        ) : (
                            ""
                        )}
                    </label>
                    {errors.name && <span className="checksley-required">{errors.name}</span>}
                </fieldset>

                <fieldset className="dates">
                    <div>
                        <input
                            ref={startRef}
                            className="date-start"
                            type="date"
                            name="estimated_start"
                            value={values.estimated_start}
                            onChange={handleStartChange}
                            /* i18n LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START */
                            aria-label="Estimated Start"
                        />
                        {errors.estimated_start && (
                            <span className="checksley-required">{errors.estimated_start}</span>
                        )}
                    </div>
                    <div>
                        <input
                            ref={finishRef}
                            className="date-end"
                            type="date"
                            name="estimated_finish"
                            value={values.estimated_finish}
                            onChange={handleFinishChange}
                            /* i18n LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END */
                            aria-label="Estimated End"
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
                        title="Save"
                        disabled={submitting}
                    >
                        {/* i18n COMMON.SAVE */}
                        Save
                    </button>

                    {mode === "edit" && canDelete && (
                        <button
                            className="btn-link delete-sprint"
                            type="button"
                            onClick={handleRemove}
                            /* i18n LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT */
                            title="delete sprint"
                            disabled={submitting}
                        >
                            <svg className="icon icon-trash" aria-hidden="true" focusable="false">
                                <use xlinkHref="#icon-trash" href="#icon-trash" />
                            </svg>
                            <span className="delete-sprint-text">
                                {/* i18n LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT */}
                                Do you want to delete this sprint?
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
    );
}
