/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef, useState } from "react";

import type { ApiClient, SavableEntity } from "../../shared/api";
import type { Milestone, Project } from "../../shared/types";
import {
    isSprintFormValid,
    SPRINT_NAME_MAX_LENGTH,
    validateSprintForm,
} from "../validation/sprintForm";
import type { SprintFormErrors, SprintFormValues } from "../validation/sprintForm";

export interface CreateEditSprintProps {
    open: boolean;
    mode: "create" | "edit";
    sprint: Milestone | null;
    lastSprint: Milestone | null;
    project: Project;
    projectId: number;
    apiClient: ApiClient;
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
}

const MILESTONES_ENDPOINT = "milestones" as const;
const SPRINT_LENGTH_DAYS = 14;

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
    const parsed = Date.parse(iso);
    const base = Number.isNaN(parsed) ? new Date() : new Date(parsed);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}

export function CreateEditSprint(props: CreateEditSprintProps): JSX.Element | null {
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
    const submittingRef = useRef<boolean>(false);

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
        submittingRef.current = false;
    }, [open, mode, sprint, lastSprint]);

    if (!open) {
        return null;
    }

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

        if (submittingRef.current) {
            return;
        }
        submittingRef.current = true;

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

            onSaved();
            onClose();
        } finally {
            submittingRef.current = false;
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (mode !== "edit" || !sprint) {
            return;
        }

        const confirmed = window.confirm("Do you want to delete this sprint?");
        if (!confirmed) {
            return;
        }

        await apiClient.remove(MILESTONES_ENDPOINT, sprint.id);
        onDeleted();
        onClose();
    };

    const showLastSprintName =
        mode === "create" &&
        name.length === 0 &&
        Boolean(lastSprint?.name) &&
        Object.keys(errors).length === 0;

    const title = mode === "create" ? "New sprint" : (sprint?.name ?? "");

    return (
        <div
            className="lightbox lightbox-sprint-add-edit"
            {...{ "tg-lb-create-edit-sprint": "" }}
            style={{ display: "block" }}
        >
            <a
                className="close"
                href="#"
                title="close"
                onClick={(event) => {
                    event.preventDefault();
                    onClose();
                }}
            >
                <svg className="icon icon-close">
                    <use xlinkHref="#icon-close" />
                </svg>
            </a>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submitForm();
                }}
            >
                <h2 className="title">{title}</h2>

                <fieldset>
                    <input
                        type="text"
                        className="sprint-name e2e-sprint-name"
                        name="name"
                        placeholder="sprint name"
                        maxLength={SPRINT_NAME_MAX_LENGTH}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <label
                        className={
                            showLastSprintName
                                ? "last-sprint-name"
                                : "last-sprint-name disappear"
                        }
                    >
                        {showLastSprintName && lastSprint
                            ? `Last sprint: ${lastSprint.name}`
                            : null}
                    </label>
                    {errors.name ? (
                        <span className="error error-name">{errors.name}</span>
                    ) : null}
                </fieldset>

                <fieldset className="dates">
                    <div>
                        <input
                            type="text"
                            className="date-start"
                            name="estimated_start"
                            placeholder="Estimated Start"
                            value={estimatedStart}
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
                            type="text"
                            className="date-end"
                            name="estimated_finish"
                            placeholder="Estimated End"
                            value={estimatedFinish}
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
                        title="Save"
                    >
                        Save
                    </button>

                    {canDelete ? (
                        <button
                            type="button"
                            className="btn-link delete-sprint"
                            title="delete sprint"
                            onClick={() => {
                                void handleDelete();
                            }}
                        >
                            <svg className="icon icon-trash">
                                <use xlinkHref="#icon-trash" />
                            </svg>
                            <span className="delete-sprint-text">delete sprint</span>
                        </button>
                    ) : null}
                </div>
            </form>
        </div>
    );
}
