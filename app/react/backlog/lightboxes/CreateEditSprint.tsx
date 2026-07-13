/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Lightbox } from "../../shared/lightboxes/Lightbox";
import { t } from "../../shared/i18n/translate";
import { sanitizeErrorMessage } from "../../shared/api";
import type { ApiClient, SavableEntity } from "../../shared/api";
import type { Milestone, Project } from "../../shared/types";
import {
    isSprintFormValid,
    SPRINT_NAME_MAX_LENGTH,
    validateSprintForm,
} from "../validation/sprintForm";
import type { SprintFormErrors, SprintFormValues } from "../validation/sprintForm";

/**
 * Create / edit sprint (milestone) modal.
 *
 * Reproduces the legacy `tgLbCreateEditSprint` directive
 * (`app/coffee/modules/backlog/lightboxes.coffee` +
 * `includes/modules/lightbox-sprint-add-edit.jade`) as a React component,
 * closing findings M3, M2 and the modal slice of M7. The full modal LIFECYCLE
 * (`.open` visibility, `role="dialog"`, `aria-modal`, focus capture/restore,
 * Escape, Tab focus-trap, the built-in `.close` control) is delegated to the
 * shared {@link Lightbox} shell so it is implemented in exactly one place;
 * this component only owns the sprint FORM and its submit/delete flows.
 *
 * Behavioural parity with the legacy directive:
 *   - Title text: "New sprint" (create) / "Edit Sprint" (edit) — the legacy
 *     `$el.find(".title").text(...)` override.
 *   - Submit button label: "Save" in BOTH modes — the jade renders
 *     `translate="COMMON.SAVE"` and the coffee's `.button-green` override
 *     matches no element in this lightbox, so it is a no-op.
 *   - Dates are stored/submitted as `YYYY-MM-DD`; a native `<input type="date">`
 *     yields that format directly, so no date library / manual parse is needed.
 *   - Single success path: on create/edit success we call ONLY `onSaved`, and on
 *     delete success ONLY `onDeleted`. The hook's `onSprintSaved`/`onSprintDeleted`
 *     already flip the lightbox closed and reload, so calling `onClose` as well
 *     would be the legacy-absent "double close" flagged by M3. `onClose` is
 *     reserved for USER-initiated cancel (Escape / the close control).
 *   - Errors (M2): every mutation is awaited inside try/catch; on failure the
 *     sanitized message is surfaced in an in-dialog `role="alert"` region, the
 *     entered values are preserved, and the modal stays open for retry. Controls
 *     are disabled while a request is in flight (pending state).
 *   - Delete confirmation: the legacy `$confirm.askOnDelete(title, name)` is
 *     reproduced as an in-dialog confirmation step (no `window.confirm`).
 */
export interface CreateEditSprintProps {
    open: boolean;
    mode: "create" | "edit";
    sprint: Milestone | null;
    lastSprint: Milestone | null;
    project: Project;
    projectId: number;
    apiClient: ApiClient;
    /** User-initiated cancel (Escape / close control). NOT called on success. */
    onClose: () => void;
    /** Create/edit succeeded (the hook closes + reloads). */
    onSaved: () => void;
    /** Delete succeeded (the hook closes + reloads). */
    onDeleted: () => void;
}

const MILESTONES_ENDPOINT = "milestones" as const;
const SPRINT_LENGTH_DAYS = 14;

const TITLE_ID = "sprint-lightbox-title";

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
    const parsed = Date.parse(iso);
    const base = Number.isNaN(parsed) ? new Date() : new Date(parsed);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}

/**
 * Build the "last sprint is <strong>Name</strong> ;-)" hint from the
 * `LAST_SPRINT_NAME` template. The template embeds `<strong>` markup, so we
 * split around the `{{lastSprint}}` placeholder and render the (user-supplied)
 * sprint name as a plain React child — escaped by React's default output
 * encoding — inside a real `<strong>` element, preserving the bold styling
 * WITHOUT `dangerouslySetInnerHTML` (XSS-safe, per the AAP escaping rule).
 */
function buildLastSprintHint(lastSprintName: string): ReactNode {
    const template = t("LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME").replace(
        /<\/?strong>/g,
        "",
    );
    const parts = template.split(/\{\{?\s*lastSprint\s*\}?\}/);
    if (parts.length === 1) {
        return (
            <>
                {template.replace(/\s+/g, " ").trimEnd()} <strong>{lastSprintName}</strong>
            </>
        );
    }
    return (
        <>
            {parts[0].replace(/\s+/g, " ")}
            <strong>{lastSprintName}</strong>
            {parts.slice(1).join("").replace(/\s+/g, " ")}
        </>
    );
}

export function CreateEditSprint(props: CreateEditSprintProps): JSX.Element {
    const {
        open,
        mode,
        sprint,
        lastSprint,
        project,
        projectId,
        apiClient,
        onClose,
        onSaved,
        onDeleted,
    } = props;

    const [name, setName] = useState<string>("");
    const [estimatedStart, setEstimatedStart] = useState<string>("");
    const [estimatedFinish, setEstimatedFinish] = useState<string>("");
    const [errors, setErrors] = useState<SprintFormErrors>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [saving, setSaving] = useState<boolean>(false);
    const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
    // Guards against a double submit/delete before `saving` state has flushed.
    const savingRef = useRef<boolean>(false);

    // Seed / reset the form each time the modal opens (legacy `resetSprint` +
    // the `sprintform:create` / `sprintform:edit` handlers).
    useEffect(() => {
        if (!open) {
            return;
        }

        if (mode === "edit" && sprint) {
            setName(sprint.name ?? "");
            setEstimatedStart(sprint.estimated_start ?? "");
            setEstimatedFinish(sprint.estimated_finish ?? "");
        } else {
            const start = lastSprint?.estimated_finish ?? todayISO();
            setName("");
            setEstimatedStart(start);
            setEstimatedFinish(addDaysISO(start, SPRINT_LENGTH_DAYS));
        }

        setErrors({});
        setServerError(null);
        setSaving(false);
        setConfirmingDelete(false);
        savingRef.current = false;
    }, [open, mode, sprint, lastSprint]);

    const canDelete =
        mode === "edit" &&
        project.my_permissions.indexOf("delete_milestone") !== -1;

    const submitForm = async (): Promise<void> => {
        const values: SprintFormValues = {
            name,
            estimated_start: estimatedStart,
            estimated_finish: estimatedFinish,
        };

        const nextErrors = validateSprintForm(values);
        setErrors(nextErrors);

        if (!isSprintFormValid(values)) {
            return;
        }

        if (savingRef.current) {
            return;
        }
        savingRef.current = true;
        setSaving(true);
        setServerError(null);

        try {
            if (mode === "create") {
                await apiClient.create(MILESTONES_ENDPOINT, {
                    project: projectId,
                    name: values.name,
                    estimated_start: values.estimated_start,
                    estimated_finish: values.estimated_finish,
                });
            } else if (sprint) {
                const modifiedAttrs: Record<string, unknown> = {};
                if (values.name !== (sprint.name ?? "")) {
                    modifiedAttrs.name = values.name;
                }
                if (values.estimated_start !== (sprint.estimated_start ?? "")) {
                    modifiedAttrs.estimated_start = values.estimated_start;
                }
                if (values.estimated_finish !== (sprint.estimated_finish ?? "")) {
                    modifiedAttrs.estimated_finish = values.estimated_finish;
                }

                const entity: SavableEntity = { ...sprint, ...modifiedAttrs };
                await apiClient.save(MILESTONES_ENDPOINT, entity, modifiedAttrs, true);
            }

            // SINGLE success path: the hook's onSaved handler closes + reloads.
            onSaved();
        } catch (error) {
            // M2: preserve entered values, keep the modal open, surface a
            // sanitized message for recovery.
            setServerError(sanitizeErrorMessage(error));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const confirmDelete = async (): Promise<void> => {
        if (mode !== "edit" || !sprint) {
            return;
        }
        if (savingRef.current) {
            return;
        }
        savingRef.current = true;
        setSaving(true);
        setServerError(null);

        try {
            await apiClient.remove(MILESTONES_ENDPOINT, sprint.id);
            // SINGLE success path: the hook's onDeleted handler closes + reloads.
            onDeleted();
        } catch (error) {
            setServerError(sanitizeErrorMessage(error));
            setConfirmingDelete(false);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // Legacy: the last-sprint hint shows in CREATE mode only, hides once the
    // name field has content or when there are validation errors.
    const showLastSprintName =
        mode === "create" &&
        name.length === 0 &&
        Boolean(lastSprint?.name) &&
        Object.keys(errors).length === 0;

    const title =
        mode === "create"
            ? t("LIGHTBOX.ADD_EDIT_SPRINT.TITLE")
            : t("BACKLOG.EDIT_SPRINT");
    const saveLabel = t("COMMON.SAVE");

    return (
        <Lightbox
            open={open}
            onClose={onClose}
            className="lightbox-sprint-add-edit"
            markerAttr="tg-lb-create-edit-sprint"
            labelledById={TITLE_ID}
            initialFocusSelector=".sprint-name"
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submitForm();
                }}
            >
                <h2 className="title" id={TITLE_ID}>
                    {title}
                </h2>

                {serverError !== null ? (
                    <div
                        className="sprint-lightbox-error"
                        role="alert"
                        aria-live="assertive"
                    >
                        {serverError}
                    </div>
                ) : null}

                <fieldset>
                    <input
                        type="text"
                        className="sprint-name e2e-sprint-name"
                        name="name"
                        placeholder={t(
                            "LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME",
                        )}
                        maxLength={SPRINT_NAME_MAX_LENGTH}
                        value={name}
                        disabled={saving}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <label
                        className={
                            showLastSprintName
                                ? "last-sprint-name"
                                : "last-sprint-name disappear"
                        }
                    >
                        {showLastSprintName && lastSprint?.name
                            ? buildLastSprintHint(lastSprint.name)
                            : null}
                    </label>
                    {errors.name ? (
                        <span className="error error-name">{errors.name}</span>
                    ) : null}
                </fieldset>

                <fieldset className="dates">
                    <div>
                        <input
                            type="date"
                            className="date-start"
                            name="estimated_start"
                            {...{ "tg-date-selector": "" }}
                            data-required="true"
                            placeholder={t(
                                "LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START",
                            )}
                            value={estimatedStart}
                            disabled={saving}
                            onChange={(event) => setEstimatedStart(event.target.value)}
                        />
                        {errors.estimated_start ? (
                            <span className="error error-estimated-start">
                                {errors.estimated_start}
                            </span>
                        ) : null}
                    </div>
                    <div>
                        <input
                            type="date"
                            className="date-end"
                            name="estimated_finish"
                            {...{ "tg-date-selector": "" }}
                            data-required="true"
                            placeholder={t(
                                "LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END",
                            )}
                            value={estimatedFinish}
                            disabled={saving}
                            onChange={(event) =>
                                setEstimatedFinish(event.target.value)
                            }
                        />
                        {errors.estimated_finish ? (
                            <span className="error error-estimated-finish">
                                {errors.estimated_finish}
                            </span>
                        ) : null}
                    </div>
                </fieldset>

                <div className="sprint-add-edit-actions">
                    <button
                        type="submit"
                        className="btn-big button-large button-block"
                        title={saveLabel}
                        disabled={saving}
                        aria-busy={saving ? true : undefined}
                    >
                        {saveLabel}
                    </button>

                    {canDelete && !confirmingDelete ? (
                        <button
                            type="button"
                            className="btn-link delete-sprint"
                            title={t(
                                "LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT",
                            )}
                            disabled={saving}
                            onClick={() => setConfirmingDelete(true)}
                        >
                            <svg className="icon icon-trash">
                                <use xlinkHref="#icon-trash" />
                            </svg>
                            <span className="delete-sprint-text">
                                {t("LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT")}
                            </span>
                        </button>
                    ) : null}
                </div>

                {canDelete && confirmingDelete ? (
                    <div
                        className="delete-sprint-confirm"
                        role="alertdialog"
                        aria-live="assertive"
                        aria-label={t("LIGHTBOX.DELETE_SPRINT.TITLE")}
                    >
                        <p className="delete-sprint-confirm-title">
                            {t("LIGHTBOX.DELETE_SPRINT.TITLE")}
                        </p>
                        <p className="delete-sprint-confirm-name">
                            {sprint?.name ?? ""}
                        </p>
                        <button
                            type="button"
                            className="btn-big delete-sprint-confirm-accept"
                            disabled={saving}
                            aria-busy={saving ? true : undefined}
                            onClick={() => {
                                void confirmDelete();
                            }}
                        >
                            {t("COMMON.DELETE")}
                        </button>
                        <button
                            type="button"
                            className="btn-link delete-sprint-confirm-cancel"
                            disabled={saving}
                            onClick={() => setConfirmingDelete(false)}
                        >
                            {t("COMMON.CANCEL")}
                        </button>
                    </div>
                ) : null}
            </form>
        </Lightbox>
    );
}
