/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
    BaseUser,
    KanbanProject,
    TaskModel,
    UsView,
} from "./useKanbanState";

/**
 * Draggable Kanban card.
 *
 * Ports the shared card component (`app/modules/components/card/card.jade`
 * + `card-templates/*` + `card.controller.coffee`) together with the Kanban
 * board's `tgCardData` / `tgCardAssignedTo` / `tgCardActions` render wrappers
 * (`app/coffee/modules/kanban/main.coffee` L930/L1009/L1121). The DOM structure
 * and CSS class names are reproduced verbatim so the compiled SCSS themes the
 * card unchanged. User-provided text (subject, tags, task subjects) is rendered
 * as escaped plain text — never `dangerouslySetInnerHTML` — for XSS safety.
 */

const DEFAULT_TAG_COLOR = "#A9AABC";
const NOT_ASSIGNED_LABEL = "Not assigned";
const UNCLASSIFIED_SWIMLANE_ID = -1;

export interface CardProps {
    item: UsView;
    project: KanbanProject;
    /** Cumulative visibility keys for the current zoom level. */
    zoom: string[];
    /** Numeric zoom level (0-3). */
    zoomLevel: number;
    archived?: boolean;
    selected?: boolean;
    moved?: boolean;
    onToggleFold?: (id: number) => void;
    onClickEdit?: (id: number) => void;
    onClickDelete?: (id: number) => void;
    onClickAssignedTo?: (id: number) => void;
    /** Resolve an avatar URL for a user (defaults to the user's photo). */
    resolveAvatar?: (user: BaseUser) => string;
}

function userLabel(user: BaseUser | undefined): string {
    if (!user) {
        return "";
    }
    return user.full_name_display || user.username || "";
}

export function Card(props: CardProps): JSX.Element {
    const {
        item,
        project,
        zoom,
        zoomLevel,
        archived = false,
        selected = false,
        moved = false,
        onToggleFold,
        onClickEdit,
        onClickDelete,
        onClickAssignedTo,
        resolveAvatar,
    } = props;

    const model = item.model;
    const [actionsOpen, setActionsOpen] = useState(false);

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: item.id });

    // --- view-model helpers (ported from card.controller.coffee) ---
    const visible = (name: string): boolean => zoom.indexOf(name) !== -1;
    const getTagColor = (color: string | null): string => color || DEFAULT_TAG_COLOR;
    const tasks: TaskModel[] = model.tasks ?? [];
    const hasTasks = (): boolean => tasks.length > 0;
    const hasVisibleAttachments = (): boolean => item.images.length > 0;
    const getClosedTasks = (): TaskModel[] => tasks.filter((task) => !!task.is_closed);

    const setVisibility = (): { related: boolean; slides: boolean } => {
        let related = visible("related_tasks");
        let slides = visible("attachments");

        if (item.foldStatusChanged !== undefined && visible("unfold")) {
            if (zoomLevel === 2) {
                related = !!item.foldStatusChanged;
                slides = !!item.foldStatusChanged;
            } else {
                related = !item.foldStatusChanged;
                slides = !item.foldStatusChanged;
            }
        }
        if (!tasks.length) {
            related = false;
        }
        if (!item.images.length) {
            slides = false;
        }
        return { related, slides };
    };
    const isRelatedTasksVisible = (): boolean => setVisibility().related;

    // --- permissions (getModifyPermisionKey/getDeletePermisionKey === us) ---
    const permissions = project.my_permissions ?? [];
    const canModify = permissions.indexOf("modify_us") !== -1;
    const canDelete = permissions.indexOf("delete_us") !== -1;

    // --- navigation (getNavKey === project-userstories-detail for us) ---
    const detailHref =
        project.slug != null && model.ref != null
            ? `/project/${project.slug}/us/${model.ref}`
            : "";

    const avatarSrc = (user: BaseUser): string => {
        if (resolveAvatar) {
            return resolveAvatar(user);
        }
        return typeof user.photo === "string" ? user.photo : "";
    };

    const rootClassName =
        `card ng-animate-disabled` +
        (selected ? " kanban-task-selected ui-multisortable-multiple" : "") +
        (moved ? " kanban-moved" : "") +
        (isDragging ? " kanban-task-dragging" : "");

    const innerClassName =
        `zoom-${zoomLevel} type-us` +
        (model.is_blocked ? " card-blocked" : "") +
        (archived ? " archived" : "") +
        (item.assigned_users.length ? " with-assigned-user" : "") +
        (visible("unfold") && (hasTasks() || hasVisibleAttachments())
            ? " with-fold-action"
            : "");

    const style: Record<string, string | undefined> = {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
    };

    const showAssignedTo = visible("assigned_to") && !project.archived_code;
    const showCardData = visible("card-data") && visible("extra_info");
    const showUnfold =
        visible("unfold") && (hasTasks() || hasVisibleAttachments());

    return (
        <div
            ref={setNodeRef}
            className={rootClassName}
            style={style}
            data-id={item.id}
            data-status={model.status}
            data-swimlane={model.swimlane == null ? UNCLASSIFIED_SWIMLANE_ID : model.swimlane}
            {...attributes}
            {...listeners}
        >
            <div className={innerClassName}>
                {/* card-tags */}
                {visible("tags") && item.colorized_tags.length > 0 && (
                    <div className="card-tags">
                        {item.colorized_tags.map((tag, index) => (
                            <span
                                key={`${tag.name}-${index}`}
                                className="card-tag"
                                style={{ backgroundColor: getTagColor(tag.color) }}
                                title={tag.name}
                            >
                                {zoomLevel === 3 ? tag.name : ""}
                            </span>
                        ))}
                    </div>
                )}

                {/* card-actions */}
                {zoomLevel > 0 && (canModify || canDelete) && (
                    <div className="card-actions">
                        <button
                            type="button"
                            className={
                                "js-popup-button" + (actionsOpen ? " popover-open" : "")
                            }
                            onClick={(event) => {
                                event.stopPropagation();
                                setActionsOpen((open) => !open);
                            }}
                        >
                            <span className="icon icon-more-vertical" aria-hidden="true" />
                        </button>
                        {actionsOpen && (
                            <div className="card-actions-menu">
                                {canModify && (
                                    <button
                                        type="button"
                                        className="card-action-edit"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickEdit?.(item.id);
                                        }}
                                    >
                                        Edit
                                    </button>
                                )}
                                {canModify && (
                                    <button
                                        type="button"
                                        className="card-action-assigned-to"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickAssignedTo?.(item.id);
                                        }}
                                    >
                                        Assign to
                                    </button>
                                )}
                                {canDelete && (
                                    <button
                                        type="button"
                                        className="card-action-delete"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickDelete?.(item.id);
                                        }}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* card-epics (expanded, zoom > 0) */}
                {zoomLevel > 0 && (
                    <div>
                        {(model.epics ?? []).length > 0 && (
                            <div className="card-epics">
                                {(model.epics ?? []).map((epic) => (
                                    <a key={epic.id} className="card-epic">
                                        <span
                                            className="epic-color"
                                            style={{ backgroundColor: epic.color }}
                                            title={epic.subject}
                                        />
                                        <span className="epic-name" title={epic.subject}>
                                            {epic.subject}
                                        </span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* card-title */}
                <h2 className="card-title">
                    <a href={detailHref}>
                        {visible("ref") && (
                            <span className="card-ref">{`#${model.ref ?? ""}`}</span>
                        )}
                        {visible("subject") && (
                            <span className="card-subject e2e-title">{model.subject}</span>
                        )}
                    </a>
                    {zoomLevel === 0 && (model.epics ?? []).length > 0 && (
                        <div className="card-compact-epics">
                            <div className="card-epics">
                                {(model.epics ?? []).map((epic) => (
                                    <a key={epic.id} className="card-epic">
                                        <span
                                            className="epic-color"
                                            style={{ backgroundColor: epic.color }}
                                            title={epic.subject}
                                        />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </h2>

                <div className="wrapper-assigned-to-data">
                    {/* card-assigned-to */}
                    {showAssignedTo && (
                        <div
                            className={
                                "card-assigned-to" + (model.is_iocaine ? " is_iocaine" : "")
                            }
                        >
                            {!item.assigned_to && !item.assigned_users.length && (
                                <div className="card-user-avatar card-not-assigned">
                                    <img title={NOT_ASSIGNED_LABEL} alt={NOT_ASSIGNED_LABEL} />
                                    {visible("assigned_to_extended") && (
                                        <span className="card-not-assigned-title">
                                            {NOT_ASSIGNED_LABEL}
                                        </span>
                                    )}
                                </div>
                            )}
                            {(item.assigned_to || item.assigned_users.length > 0) &&
                                item.assigned_users_preview.map((assignedUser, index) => (
                                    <div className="card-user-avatar" key={assignedUser.id}>
                                        {(index < 2 || item.assigned_users.length === 3) && (
                                            <img
                                                src={avatarSrc(assignedUser)}
                                                title={userLabel(assignedUser)}
                                                alt={userLabel(assignedUser)}
                                            />
                                        )}
                                        {index === 2 && item.assigned_users.length > 3 && (
                                            <span className="extra-assigned">
                                                {`${item.assigned_users.length - 2}+`}
                                            </span>
                                        )}
                                    </div>
                                ))}
                        </div>
                    )}

                    {/* card-data */}
                    {showCardData && (
                        <div
                            className={"card-data" + (!tasks.length ? " empty-tasks" : "")}
                        >
                            <div className="card-statistics-init">
                                <span>
                                    {model.total_points ? (
                                        <span
                                            className="card-estimation"
                                            title="Estimation"
                                            data-id={model.id}
                                        >
                                            {model.total_points}
                                        </span>
                                    ) : (
                                        <span className="card-estimation">No pts</span>
                                    )}
                                </span>
                                {model.is_blocked && (
                                    <span className="card-lock">
                                        <span className="icon icon-lock" aria-hidden="true" />
                                    </span>
                                )}
                            </div>
                            <div className="card-statistics">
                                {!!model.total_attachments && (
                                    <div className="statistic card-attachments" title="Attachments">
                                        <span>{model.total_attachments}</span>
                                    </div>
                                )}
                                {(model.watchers ?? []).length > 0 && (
                                    <div className="statistic card-watchers" title="Watchers">
                                        <span>{(model.watchers ?? []).length}</span>
                                    </div>
                                )}
                                {!!model.total_comments && (
                                    <div className="statistic card-comments" title="Comments">
                                        <span>{model.total_comments}</span>
                                    </div>
                                )}
                                {tasks.length > 0 && (
                                    <div
                                        className={
                                            "statistic card-completed-tasks" +
                                            (getClosedTasks().length === tasks.length
                                                ? " completed"
                                                : "")
                                        }
                                        title="Tasks"
                                    >
                                        {`${getClosedTasks().length} / ${tasks.length}`}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* card-tasks */}
                {isRelatedTasksVisible() && (
                    <div className="card-tasks">
                        <ul>
                            {tasks.map((task) => (
                                <li className="card-task" key={task.id ?? task.ref}>
                                    <a
                                        href="#"
                                        className={
                                            (task.is_closed ? "closed-task" : "") +
                                            (task.is_blocked ? " blocked-task" : "")
                                        }
                                    >
                                        <span className="card-task-ref">{`#${task.ref ?? ""}`}</span>
                                        <span className="card-task-subject">{task.subject}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* card-unfold */}
                {showUnfold && (
                    <div
                        className="card-unfold ng-animate-disabled"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                            if (!event.ctrlKey && !event.metaKey) {
                                onToggleFold?.(item.id);
                            }
                        }}
                    >
                        <span
                            className={
                                "icon " +
                                (zoomLevel === 2
                                    ? item.foldStatusChanged
                                        ? "icon-arrow-up"
                                        : "icon-arrow-down"
                                    : item.foldStatusChanged
                                      ? "icon-arrow-down"
                                      : "icon-arrow-up")
                            }
                            aria-hidden="true"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
