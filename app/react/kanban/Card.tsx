/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useState, useRef, useEffect, useId } from "react";
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "../shared/ui/Icon";
import { t } from "../shared/i18n/translate";
import { projectEpicUrl, projectTaskUrl } from "../shared/nav/urls";
import { isDragEnabled } from "../shared/dnd/DndProvider";
import { dueDateColor, dueDateTitle } from "../shared/duedate/dueDate";
import type { DueDateAppearance } from "../shared/duedate/dueDate";
import type {
    BaseUser,
    EpicRef,
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
const UNCLASSIFIED_SWIMLANE_ID = -1;

// Card labels/titles routed through the shared runtime translator [M-06] at
// RENDER time (never memoized at module load, since the React bundle evaluates
// before `angular.bootstrap`). Keys + English fallbacks mirror the authoritative
// catalog entries used by the legacy card templates
// (app/modules/components/card/card-templates/*.jade and the `tgCardActions`
// menu in app/coffee/modules/kanban/main.coffee): the not-assigned avatar label
// (`COMMON.ASSIGNED_TO.NOT_ASSIGNED`) and the iocaine marker
// (`TASK.FIELDS.IS_IOCAINE`). `COMMON.CARD.ACTIONS` has no legacy catalog entry
// (the AngularJS popup button carried only an icon), so it resolves to its
// fallback while still routing through the translator.
const NOT_ASSIGNED_KEY = "COMMON.ASSIGNED_TO.NOT_ASSIGNED";
const NOT_ASSIGNED_FALLBACK = "Not assigned";
const IS_IOCAINE_KEY = "TASK.FIELDS.IS_IOCAINE";
const IS_IOCAINE_FALLBACK = "Is iocaine";

/**
 * Fallback avatar URL used when a user has no photo, or when a user story has no
 * assignee. Mirrors the AngularJS `AvatarService.getUnnamed()`, which returns
 * `"#{window._version}/images/unnamed.png"`. `window._version` is set by the
 * app-loader in production; when it is absent (jsdom unit tests, or a QA harness
 * whose doc-root already IS the versioned directory) we fall back to the
 * version-less relative path, which resolves to the same served asset.
 */
function unnamedAvatarUrl(): string {
    const version =
        typeof window !== "undefined"
            ? (window as unknown as { _version?: unknown })._version
            : undefined;
    const prefix =
        typeof version === "string" && version.length > 0 ? `${version}/` : "";
    return `${prefix}images/unnamed.png`;
}

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
    /**
     * [M-13] Move the card to the top of its column. Ports the legacy
     * `onClickMoveToTop($scope.vm.item)` card action (kanban/main.coffee
     * L1090-L1097). The parent (`KanbanColumn`) supplies the handler and sets
     * {@link isFirst} so the menu item is hidden for a card already at the top.
     */
    onClickMoveToTop?: (id: number) => void;
    /**
     * [M-13] Whether this card is the first in its column (the AngularJS
     * `is-first="$first"` binding, kanban-table.jade L161,L236). The legacy
     * card gated the "move to top" action on `canEdit(...) && !isFirst`, so the
     * action is hidden for the top card (no-op gating).
     */
    isFirst?: boolean;
    /** ctrl/meta-click multi-select toggle (QA-FUNC-01). */
    onToggleSelect?: (id: number) => void;
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
        onClickMoveToTop,
        isFirst = false,
        onToggleSelect,
        resolveAvatar,
    } = props;

    const model = item.model;
    const [actionsOpen, setActionsOpen] = useState(false);

    // [M-21] Complete ARIA menu pattern for the card actions popup. The trigger
    // advertises `aria-haspopup="menu"` + `aria-controls`, the popup is a
    // `role="menu"` with `role="menuitem"` children, and keyboard users get the
    // expected behavior: focus lands on the first item when the menu opens, the
    // arrow keys (plus Home/End) move a roving focus between items, Escape closes
    // the menu and returns focus to the trigger, and Tab dismisses it.
    const actionsButtonRef = useRef<HTMLButtonElement>(null);
    const actionsMenuRef = useRef<HTMLDivElement>(null);
    const actionsMenuId = useId();

    // Move focus onto the first menu item once the popup is rendered (post-paint).
    useEffect(() => {
        if (!actionsOpen) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            const items = actionsMenuRef.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
            );
            items?.[0]?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [actionsOpen]);

    /** Close the menu; optionally return focus to the trigger (keyboard dismiss). */
    const closeActionsMenu = (returnFocus: boolean): void => {
        setActionsOpen(false);
        if (returnFocus) {
            actionsButtonRef.current?.focus();
        }
    };

    /** Roving-focus + dismiss keyboard handling for the actions menu. */
    const handleActionsMenuKeyDown = (
        event: ReactKeyboardEvent<HTMLDivElement>,
    ): void => {
        const items = Array.from(
            actionsMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
                [],
        );
        if (items.length === 0) {
            return;
        }
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        switch (event.key) {
            case "ArrowDown": {
                event.preventDefault();
                event.stopPropagation();
                const next = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
                items[next].focus();
                break;
            }
            case "ArrowUp": {
                event.preventDefault();
                event.stopPropagation();
                const prev =
                    currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                items[prev].focus();
                break;
            }
            case "Home": {
                event.preventDefault();
                event.stopPropagation();
                items[0].focus();
                break;
            }
            case "End": {
                event.preventDefault();
                event.stopPropagation();
                items[items.length - 1].focus();
                break;
            }
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                closeActionsMenu(true);
                break;
            }
            case "Tab": {
                // Tab dismisses the menu; focus proceeds naturally (no preventDefault).
                closeActionsMenu(false);
                break;
            }
            default:
                break;
        }
    };

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: item.id });

    // QA-A11Y-02: a card is only draggable when the project grants DnD (has
    // `modify_us` and is not archived). Non-draggable cards (read-only or
    // archived projects) must NOT expose the sortable keyboard/ARIA affordances
    // (`tabIndex=0`, `role="button"`, `aria-roledescription="sortable"`) or the
    // drag listeners — otherwise a keyboard user tabs onto a card that cannot be
    // moved. Mirrors the AngularJS board, where dragula is enabled/disabled at
    // the project level (kanban/sortable.coffee L37-41), so cards carry no drag
    // affordance at all when the board is read-only.
    const dragEnabled = isDragEnabled(project);

    // Multi-select group drag (QA-FUNC-01): ctrl/meta-click toggles the card's
    // membership in the selection, mirroring the AngularJS card binding
    // `ng-click="($event.ctrlKey || $event.metaKey) && ctrl.toggleSelectedUs(usId)"`
    // (kanban-table.jade). A plain click is untouched (card navigation / actions
    // behave normally); only a modified click toggles selection, and default
    // navigation is suppressed so ctrl-click does not also open the story.
    const handleCardClick = (event: MouseEvent<HTMLDivElement>): void => {
        if (onToggleSelect && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onToggleSelect(item.id);
        }
    };

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
    // QA-FUNC-11: the AngularJS card-actions template gated both the ⋮ trigger
    // and every action (Edit/Assign/Delete/Move-to-top) on
    // `checkPermission(...) === projectService.canEdit(...)`, which is
    // `!isArchived() && hasPermission()` (main.coffee L1027-1028 + card-actions.jade
    // L1; project.service.coffee L108-110). An archived project (truthy
    // `archived_code`) therefore hides all card edit/delete affordances. We gate
    // on `project.archived_code` (NOT the `archived` prop, which flags the
    // column-archived/hidden state) to reproduce `canEdit` faithfully.
    const permissions = project.my_permissions ?? [];
    const projectArchived = !!project.archived_code;
    const canModify = !projectArchived && permissions.indexOf("modify_us") !== -1;
    const canDelete = !projectArchived && permissions.indexOf("delete_us") !== -1;

    // --- navigation (getNavKey === project-userstories-detail for us) ---
    const detailHref =
        project.slug != null && model.ref != null
            ? `/project/${project.slug}/us/${model.ref}`
            : "";

    // [N-04] baseHref-aware destinations for the card epic/task links (legacy
    // `tg-nav="project-epics-detail:…"` / `project-tasks-detail:…` — see
    // card-templates/card-epics.jade, card-tasks.jade). The epic and its tasks
    // belong to the board's project, so its slug supplies `:project`. When the
    // slug or ref is unavailable the href is omitted (no `href=""`/`"#"`
    // placeholder that would reload the page).
    const epicHref = (epic: EpicRef): string | undefined =>
        project.slug != null && epic.ref != null
            ? projectEpicUrl(project.slug, epic.ref)
            : undefined;
    const taskHref = (task: TaskModel): string | undefined =>
        project.slug != null && task.ref != null
            ? projectTaskUrl(project.slug, task.ref)
            : undefined;

    const avatarSrc = (user: BaseUser): string => {
        const resolved = resolveAvatar
            ? resolveAvatar(user)
            : typeof user.photo === "string"
              ? user.photo
              : "";
        // Mirror AvatarService.getAvatar: fall back to the "unnamed" avatar
        // whenever the user has no resolvable photo, so the <img> never renders
        // broken (QA-VIS-07).
        return resolved && resolved.length > 0 ? resolved : unnamedAvatarUrl();
    };

    // Project-level due-date threshold configuration (`us_duedates`), falling
    // back to the service defaults when the project doesn't define one.
    const dueDateConfig = Array.isArray(project.us_duedates)
        ? (project.us_duedates as DueDateAppearance[])
        : undefined;

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
            onClick={handleCardClick}
            {...(dragEnabled ? attributes : {})}
            {...(dragEnabled ? listeners : {})}
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
                            ref={actionsButtonRef}
                            className={
                                "js-popup-button" + (actionsOpen ? " popover-open" : "")
                            }
                            aria-label={t("COMMON.CARD.ACTIONS", "Actions")}
                            aria-haspopup="menu"
                            aria-expanded={actionsOpen}
                            aria-controls={actionsOpen ? actionsMenuId : undefined}
                            onClick={(event) => {
                                event.stopPropagation();
                                setActionsOpen((open) => !open);
                            }}
                        >
                            <Icon name="icon-more-vertical" />
                        </button>
                        {actionsOpen && (
                            <div
                                className="card-actions-menu"
                                id={actionsMenuId}
                                ref={actionsMenuRef}
                                role="menu"
                                aria-label={t("COMMON.CARD.ACTIONS", "Actions")}
                                onKeyDown={handleActionsMenuKeyDown}
                            >
                                {canModify && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="card-action-edit"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickEdit?.(item.id);
                                        }}
                                    >
                                        {t("COMMON.CARD.EDIT", "Edit card")}
                                    </button>
                                )}
                                {canModify && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="card-action-assigned-to"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickAssignedTo?.(item.id);
                                        }}
                                    >
                                        {t("COMMON.CARD.ASSIGN_TO", "Assign To")}
                                    </button>
                                )}
                                {canDelete && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="card-action-delete"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickDelete?.(item.id);
                                        }}
                                    >
                                        {t("COMMON.CARD.DELETE", "Delete card")}
                                    </button>
                                )}
                                {/* [M-13] "Move to top" — ports the legacy card
                                    action gated on `canEdit(...) && !isFirst`
                                    (kanban/main.coffee L1090-L1097). Localized
                                    label (COMMON.CARD.MOVE_TO_TOP) + the
                                    `icon-move-to-top` glyph, hidden for the card
                                    already at the top of its column. */}
                                {canModify && !isFirst && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="card-action-move-to-top"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActionsOpen(false);
                                            onClickMoveToTop?.(item.id);
                                        }}
                                    >
                                        <Icon name="icon-move-to-top" />
                                        {t("COMMON.CARD.MOVE_TO_TOP", "Move to top")}
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
                                    <a
                                        key={epic.id}
                                        className="card-epic"
                                        href={epicHref(epic)}
                                    >
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
                                    <a
                                        key={epic.id}
                                        className="card-epic"
                                        href={epicHref(epic)}
                                    >
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
                                    <img
                                        src={unnamedAvatarUrl()}
                                        title={t(NOT_ASSIGNED_KEY, NOT_ASSIGNED_FALLBACK)}
                                        alt={t(NOT_ASSIGNED_KEY, NOT_ASSIGNED_FALLBACK)}
                                    />
                                    {visible("assigned_to_extended") && (
                                        <span className="card-not-assigned-title">
                                            {t(NOT_ASSIGNED_KEY, NOT_ASSIGNED_FALLBACK)}
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
                                            <span
                                                className="extra-assigned"
                                                title={t(
                                                    "COMMON.CARD.EXTRA_ASSIGNED_USERS",
                                                    "{{total}} more assigned users",
                                                    { total: item.assigned_users.length - 2 },
                                                )}
                                            >
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
                                            title={t("COMMON.CARD.ESTIMATION", "Estimation")}
                                            data-id={model.id}
                                        >
                                            {t("COMMON.CARD.PTS", "{{pts}} pts", {
                                                pts: model.total_points,
                                            })}
                                        </span>
                                    ) : (
                                        <span className="card-estimation">
                                            {t("COMMON.CARD.NO_PTS", "N/E")}
                                        </span>
                                    )}
                                </span>
                                {model.due_date && (
                                    <div
                                        className="card-due-date"
                                        title={dueDateTitle(model.due_date, dueDateConfig)}
                                    >
                                        <Icon
                                            name="icon-clock"
                                            fill={
                                                dueDateColor(model.due_date, dueDateConfig) ??
                                                undefined
                                            }
                                            title={t(
                                                "COMMON.CARD.DUE_DATE",
                                                "Due date: {{date}}",
                                                {
                                                    date: dueDateTitle(
                                                        model.due_date,
                                                        dueDateConfig,
                                                    ),
                                                },
                                            )}
                                        />
                                    </div>
                                )}
                                {model.is_iocaine && (
                                    <div
                                        className="card-iocaine"
                                        title={t(IS_IOCAINE_KEY, IS_IOCAINE_FALLBACK)}
                                    >
                                        <Icon
                                            name="icon-iocaine"
                                            title={t(IS_IOCAINE_KEY, IS_IOCAINE_FALLBACK)}
                                        />
                                    </div>
                                )}
                                {model.is_blocked && (
                                    <span className="card-lock">
                                        <Icon name="icon-lock" />
                                    </span>
                                )}
                            </div>
                            <div className="card-statistics">
                                {!!model.total_attachments && (
                                    <div
                                        className="statistic card-attachments"
                                        title={t("ATTACHMENT.SECTION_NAME", "Attachments")}
                                    >
                                        <Icon name="icon-paperclip" />
                                        <span>{model.total_attachments}</span>
                                    </div>
                                )}
                                {(model.watchers ?? []).length > 0 && (
                                    <div
                                        className="statistic card-watchers"
                                        title={t("COMMON.WATCHERS.WATCHERS", "Watchers")}
                                    >
                                        <Icon name="icon-eye" />
                                        <span>{(model.watchers ?? []).length}</span>
                                    </div>
                                )}
                                {!!model.total_comments && (
                                    <div
                                        className="statistic card-comments"
                                        title={t("COMMENTS.TITLE", "Comments")}
                                    >
                                        <Icon name="icon-message-square" />
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
                                        title={t(
                                            "COMMON.CARD.TASKS",
                                            "{{completed}} tasks of {{total}} completed",
                                            {
                                                completed: getClosedTasks().length,
                                                total: tasks.length,
                                            },
                                        )}
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
                                        href={taskHref(task)}
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
                    // [M-21] Keyboard-operable fold toggle. The element is kept as a
                    // `div role="button"` (NOT a native <button>) so the exact
                    // `.card-unfold` SCSS — which styles a div — themes it unchanged,
                    // but it now (a) carries an accessible NAME and (b) responds to
                    // Enter/Space, matching the native button activation keys, so it
                    // is no longer a mouse-only control. The Ctrl/Meta guard (which
                    // suppressed the toggle for modified clicks) is preserved on both
                    // the pointer and keyboard paths.
                    <div
                        className="card-unfold ng-animate-disabled"
                        role="button"
                        tabIndex={0}
                        aria-label={t(
                            "KANBAN.CARD.TOGGLE_FOLD",
                            "Expand or collapse user story #{{ref}} {{subject}}",
                            { ref: model.ref ?? "", subject: model.subject ?? "" },
                        )}
                        onClick={(event) => {
                            if (!event.ctrlKey && !event.metaKey) {
                                onToggleFold?.(item.id);
                            }
                        }}
                        onKeyDown={(event) => {
                            if (
                                event.key === "Enter" ||
                                event.key === " " ||
                                event.key === "Spacebar"
                            ) {
                                // Prevent the page from scrolling on Space.
                                event.preventDefault();
                                if (!event.ctrlKey && !event.metaKey) {
                                    onToggleFold?.(item.id);
                                }
                            }
                        }}
                    >
                        <Icon
                            name={
                                zoomLevel === 2
                                    ? item.foldStatusChanged
                                        ? "icon-arrow-up"
                                        : "icon-arrow-down"
                                    : item.foldStatusChanged
                                      ? "icon-arrow-down"
                                      : "icon-arrow-up"
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
