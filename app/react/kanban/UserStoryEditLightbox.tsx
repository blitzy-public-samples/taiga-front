/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UserStoryEditLightbox (Kanban) — React port of the shared AngularJS
 * generic-form create/edit lightbox (`CreateEditUserstoryDirective`,
 * `tg-lb-create-edit`, app/coffee/modules/common/lightboxes.coffee L540-L862)
 * together with its templates
 *   app/partials/common/lightbox/lightbox-create-edit/lb-create-edit.jade and
 *   app/partials/common/lightbox/lightbox-create-edit/lb-create-edit-us.jade,
 * re-implemented INSIDE the React Kanban root.
 *
 * WHY THIS EXISTS (QA finding — create/edit/assign are silent no-ops): the
 * migrated `kanban.jade` removed the Angular `tg-lb-create-edit` generic-form
 * host, but the Kanban board's single-story entry points (column "+ADD", card
 * "Edit", card "Assign to") still broadcast `genericform:new` /
 * `genericform:edit` to that now-absent host — so all three were silent no-ops
 * (only Delete and status-via-DnD worked). Per AAP §0.7.2 the `kanban.jade`
 * shell must NOT be re-modified to re-host an Angular bridge, so the create/edit
 * form is re-owned in React here (the same coexistence strategy the AAP mandates
 * for the board itself).
 *
 * WHY A KANBAN-NATIVE COPY (not a re-use of the Backlog lightbox): the Kanban
 * and Backlog React modules are cleanly decoupled (zero cross-imports), the
 * Kanban root's file schema forbids importing `../backlog/**`, and the Backlog
 * screen is a PASSING surface that must not be perturbed. This component
 * therefore mirrors the Backlog lightbox's DOM/behavior but is typed against the
 * Kanban domain models (`KanbanProject` / `UserStoryModel` / `Status`).
 *
 * Fidelity strategy (AAP §0.3.4): the JSX reproduces the DOM structure and CSS
 * class names emitted by the Jade templates (`.lightbox.lightbox-generic-form
 * .lightbox-create-edit`, `.form-wrapper > .main`, `sidebar.sidebar.ticket-data`,
 * `fieldset.status-button > .status-dropdown.editable`, `ul.pop-status.popover`,
 * `section.creation-position`, `.ticket-assigned-to`, `.ticket-estimation`,
 * `.btn-container > #submitButton.btn-big.add-item`) so the already-compiled SCSS
 * themes it unchanged. No `.scss` is imported; theming is class-driven.
 *
 * Reveal contract: the `.lightbox` SCSS mixin sets base `display:none;opacity:0`
 * and reveals ONLY via `.lightbox.open{display:flex;opacity:1}`. The root
 * therefore toggles the `open` class whenever `open === true` (element stays
 * mounted, mirroring `lightboxService.open/close`). The status popover reveals
 * via inline `display:block` — the `.popover` mixin is likewise base
 * `display:none` with no class-based reveal rule (Angular used a jQuery
 * `fadeIn`).
 *
 * Close-on-Escape: mirrors the shared lightbox behavior (a global Escape closes
 * the top lightbox). A keydown listener is attached while `open` and closes the
 * form when it is not mid-submit, matching the ConfirmDialog / popover pattern
 * already used across the React screens.
 *
 * Field surface (M-10 — the FULL legacy generic-form editable surface, ported
 * for like-for-like parity): subject (required, maxlength 500), status
 * (dropdown), creation position (create only), assignee, estimation points (per
 * computable role), description, tags (add/delete, `add_us`-gated), due date,
 * team-requirement / client-requirement toggles, is-blocked toggle + blocked
 * note, and attachments (list existing + add new + delete). This mirrors
 * lb-create-edit.jade (`.main` = subject/tags/description/attachments;
 * `sidebar.ticket-data` = status/position/assignee/estimation/detail-settings)
 * plus lb-create-edit-us.jade (`.ticket-detail-settings`) and the
 * `tg-blocking-message-input` fieldset, with the generic-form controller
 * behavior (`addTag`/`deleteTag`/`addAttachment`/`deleteAttachment` and the
 * requirement/blocking toggles) re-implemented as local React state.
 *
 * Persistence (AAP §0.4.1 / §0.7.1 — the FROZEN, enumerated `/api/v1/`
 * endpoints): the lightbox is a pure form and DELEGATES persistence to the
 * parent via `onCreate` / `onEdit`. The parent uses the AAP-sanctioned endpoints
 * only — `bulk_create` (+ a follow-up `PATCH userstories/{id}` carrying the
 * non-bulk fields: points, assignee, description, tags, due date,
 * requirement/blocking) for create, and `PATCH userstories/{id}` for edit — then
 * runs the attachment side-effects through the frozen `/userstories/attachments`
 * endpoint (`createAttachments` after create/edit, `deleteAttachments` on edit)
 * and re-reads the board. This reproduces the CoffeeScript submit order
 * (save → deleteAttachments → createAttachments).
 */

import {
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    useId,
} from "react";
import type { FormEvent } from "react";

import type {
    BaseUser,
    KanbanProject,
    Status,
    UserStoryModel,
} from "./useKanbanState";
import { t } from "../shared/i18n/translate";
import { Icon } from "../shared/ui/Icon";
import type { UserStoryAttachment } from "../shared/api/attachments";
import { dueDateColor, dueDateTitle } from "../shared/duedate/dueDate";
import type { DueDateAppearance } from "../shared/duedate/dueDate";
import { useDialogA11y } from "../shared/dialog/useDialogA11y";
import { resolveUserAvatar, unnamedAvatarUrl } from "../shared/ui/avatar";
import { getCurrentUser } from "../shared/session/auth";

/* -------------------------------------------------------------------------- */
/* Local domain shapes                                                        */
/* -------------------------------------------------------------------------- */

/** Numeric id alias — matches the Backlog lightbox's `Id`. */
type Id = number;

/**
 * A computable role and the project point scale. `KanbanProject.roles` /
 * `.points` are typed `unknown[]` on the board model (only the board's own reads
 * are strictly typed there), so the lightbox narrows them to these focused
 * shapes for the estimation control.
 */
interface Role {
    id: Id;
    name: string;
    computable: boolean;
    order?: number;
}

interface Point {
    id: Id;
    name: string;
    order: number;
    /**
     * The numeric weight of the point (null = "unestimated"). Summed across the
     * computable roles to compute the estimation total row (ports the point
     * scale's `value` used by `calculateTotalPoints`).
     */
    value?: number | null;
}

/** A user who can be assigned to a story (id = user id, name = display name). */
export interface AssignableUser {
    id: Id;
    name: string;
}

/* -------------------------------------------------------------------------- */
/* i18n literals — English values pinned from app/locales/taiga/locale-en.json. */
/* Each constant is the ENGLISH FALLBACK routed through the shared catalog at    */
/* its render-time use site via `t(KEY, CONST)` (the key is shown in each         */
/* constant's JSDoc). `t()` returns the fallback under jsdom / when AngularJS is   */
/* absent, so tests and the English locale render unchanged.                      */
/* -------------------------------------------------------------------------- */

/** LIGHTBOX.CREATE_EDIT.NEW_US */
const TITLE_NEW = "New user story";
/** LIGHTBOX.CREATE_EDIT.EDIT_US */
const TITLE_EDIT = "Edit user story";
/** COMMON.FIELDS.SUBJECT */
const PLACEHOLDER_SUBJECT = "Subject";
/** LIGHTBOX.CREATE_EDIT.SELECT_STATUS */
const LABEL_SELECT_STATUS = "Select status";
/** LIGHTBOX.CREATE_EDIT.LOCATION */
const LABEL_LOCATION = "Location";
/** LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM */
const LABEL_CREATE_BOTTOM = "at the bottom";
/** LIGHTBOX.CREATE_EDIT.CREATE_TOP */
const LABEL_CREATE_TOP = "on top";
/** COMMON.FIELDS.POINTS */
const LABEL_POINTS = "Points";
/** Section label for the assignee control. */
const LABEL_ASSIGNED_TO = "Assigned to";
/** COMMON.ASSIGNED_TO.ASSIGN — the "assign" link in the inline assignee widget. */
const LABEL_ASSIGN = "Assign";
/** COMMON.ASSIGNED_TO.SELF — the "assign to me" self-assign link. */
const LABEL_SELF_ASSIGN = "Assign to me";
/** COMMON.OR — the " or " conjunction between Assign and Assign-to-me. */
const LABEL_OR = "or";
/** COMMON.ASSIGNED_TO.TITLE_ACTION_EDIT_ASSIGNMENT — assign-link title. */
const TITLE_EDIT_ASSIGNMENT = "Edit assignment";
/** COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT — remove-user control title. */
const TITLE_DELETE_ASSIGNMENT = "Delete assignment";
/** LIGHTBOX.ASSIGNED_TO.SEARCH — the assignee-picker search placeholder. */
const PLACEHOLDER_SEARCH_USERS = "Search for users";
/** COMMON.ASSIGNED_TO.TOO_MANY — shown when the member list is truncated. */
const LABEL_TOO_MANY_USERS = "...too many users, keep filtering";
/** US.TOTAL_POINTS — the estimation total row label (CSS upper-cases the first letter). */
const LABEL_TOTAL_POINTS = "total points";
/** ATTACHMENT.DROP — the empty-attachments dropzone hint. */
const LABEL_ATTACHMENT_DROP = "Drop attachments here!";
/** COMMON.CREATE — submit label in create mode. */
const LABEL_CREATE = "Create";
/** COMMON.SAVE — submit label in edit mode. */
const LABEL_SAVE = "Save";
/** aria-label for the lightbox close control (ports tg-lightbox-close). */
const CLOSE_ARIA_LABEL = "close";
/** COMMON.FIELDS.DESCRIPTION */
const LABEL_DESCRIPTION = "Description";
/** LIGHTBOX.CREATE_EDIT.US_PLACEHOLDER_DESCRIPTION */
const PLACEHOLDER_DESCRIPTION =
    "Please add descriptive text to help others better understand this user story";
/** COMMON.TAGS.PLACEHOLDER — the add-tag input placeholder. */
const PLACEHOLDER_TAG = "Enter tag";
/** COMMON.TAGS.ADD — add-tag control label. */
const LABEL_ADD_TAG = "Add tag";
/** COMMON.TAGS.DELETE — per-chip delete control title. */
const LABEL_DELETE_TAG = "Delete tag";
/** ATTACHMENT.SECTION_NAME */
const LABEL_ATTACHMENTS = "Attachments";
/** ATTACHMENT.ADD — has a `{{maxFileSizeMsg}}` param (passed empty here). */
const LABEL_ADD_ATTACHMENT = "Add new attachment. {{maxFileSizeMsg}}";
/** COMMON.DELETE — attachment delete control title. */
const LABEL_DELETE = "Delete";
/** COMMON.FIELDS.DUE_DATE */
const LABEL_DUE_DATE = "Due date";
/** COMMON.CARD.DUE_DATE — due-date tooltip template (param `{{date}}`). */
const DUE_DATE_TOOLTIP = "Due date: {{date}}";
/** LIGHTBOX.SET_DUE_DATE.TITLE_ACTION_DELETE_DUE_DATE — clear-due-date control. */
const LABEL_CLEAR_DUE_DATE = "Delete due date";
/** COMMON.TEAM_REQUIREMENT — team-requirement toggle title/aria-label. */
const TITLE_TEAM_REQUIREMENT =
    "A team requirement is a requirement that must exist in the project but should have no cost for the client";
/** COMMON.CLIENT_REQUIREMENT — client-requirement toggle title/aria-label. */
const TITLE_CLIENT_REQUIREMENT =
    "A client requirement is a new requirement that was not previously expected and is required to be part of the project";
/** COMMON.BLOCK_TITLE — is-blocked toggle title/aria-label. */
const TITLE_BLOCK =
    "Block this item, for example if it has a dependency that can not be satisfied";
/** COMMON.BLOCKED_NOTE — blocked-note textarea placeholder. */
const PLACEHOLDER_BLOCKED_NOTE = "Why is this blocked?";

/* -------------------------------------------------------------------------- */
/* Validation contract (REPLACES checksley `data-required` + `data-maxlength`)  */
/* -------------------------------------------------------------------------- */

/** Legacy `data-maxlength="500"` on the subject input (lb-create-edit.jade L69). */
const SUBJECT_MAX_LENGTH = 500;

/** COMMON.FORM_ERRORS.REQUIRED — legacy checksley `data-required="true"`. */
const REQUIRED_MESSAGE = "This value is required.";

/**
 * COMMON.FORM_ERRORS.MAX_LENGTH — English fallback template. The catalog uses a
 * checksley-style `%s` placeholder (NOT the `{{ }}` form our `t()` interpolates),
 * so the `%s` is substituted locally with `SUBJECT_MAX_LENGTH` at the use site.
 */
const SUBJECT_TOO_LONG_TEMPLATE =
    "This value is too long. It should have %s characters or less.";

/**
 * Generic fallback surfaced on a failed request. Ports the CoffeeScript on-error
 * handler into a single inline slot, since the React lightbox has one error slot
 * rather than per-field checksley annotations.
 */
const GENERIC_ERROR_MESSAGE =
    "The user story could not be saved. Please try again.";

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A user-story tag: a `[value, color]` pair (color may be `null`). Mirrors the
 * CoffeeScript `obj.tags` shape (`[["tag", "#color"], ...]`).
 */
export type UsTag = [string, string | null];

/** The field values collected by the form for a CREATE submission. */
export interface UserStoryCreateFields {
    subject: string;
    statusId: Id;
    /** `roleId` (string key) -> `pointId`; empty when no estimation was set. */
    points: Record<string, Id>;
    assignedTo: Id | null;
    /** Column insertion position (create only), ports `obj.us_position`. */
    position: "top" | "bottom";
    /** Free-text description (`textarea.description`). */
    description: string;
    /** `[value, color]` tag pairs (`obj.tags`). */
    tags: UsTag[];
    /** ISO `YYYY-MM-DD` due date, or `null` when unset (`obj.due_date`). */
    due_date: string | null;
    /** Blocking toggle (`obj.is_blocked`). */
    is_blocked: boolean;
    /** Blocking reason (`obj.blocked_note`); meaningful only when blocked. */
    blocked_note: string;
    /** Team-requirement flag (`obj.team_requirement`). */
    team_requirement: boolean;
    /** Client-requirement flag (`obj.client_requirement`). */
    client_requirement: boolean;
    /** New files to upload after the story is created (`attachmentsToAdd`). */
    attachmentsToAdd: File[];
}

/** The field values collected by the form for an EDIT submission. */
export interface UserStoryEditChanges {
    subject: string;
    status: Id;
    points: Record<string, Id>;
    assigned_to: Id | null;
    /**
     * Free-text description (`textarea.description`). `undefined` means "not
     * authoritative — do NOT send" (D-1): the board LIST omits description, so
     * when the detail was never loaded and the user never edited the field, the
     * value is unknown and the parent must omit it from the PATCH rather than
     * persist an empty string that would erase the stored description.
     */
    description: string | undefined;
    /** `[value, color]` tag pairs (`obj.tags`). */
    tags: UsTag[];
    /** ISO `YYYY-MM-DD` due date, or `null` when unset (`obj.due_date`). */
    due_date: string | null;
    /** Blocking toggle (`obj.is_blocked`). */
    is_blocked: boolean;
    /** Blocking reason (`obj.blocked_note`); meaningful only when blocked. */
    blocked_note: string;
    /** Team-requirement flag (`obj.team_requirement`). */
    team_requirement: boolean;
    /** Client-requirement flag (`obj.client_requirement`). */
    client_requirement: boolean;
    /** New files to upload after the edit persists (`attachmentsToAdd`). */
    attachmentsToAdd: File[];
    /** Ids of existing attachments to delete on save (`attachmentsToDelete`). */
    attachmentsToDelete: number[];
}

export interface UserStoryEditLightboxProps {
    /** Whether the lightbox is visible. Ports `lightboxService.open/close`. */
    open: boolean;
    /** `"create"` opens a blank form; `"edit"` seeds from {@link us}. */
    mode: "create" | "edit";
    /** The current project (supplies statuses, computable roles, point scale). */
    project: KanbanProject;
    /** The story being edited (edit mode only); ignored in create mode. */
    us?: UserStoryModel | null;
    /**
     * The status to seed a CREATE with — the column the "+" was clicked in. When
     * absent, falls back to the project `default_us_status`, then the first
     * status. Ignored in edit mode (the story's own status wins).
     */
    initialStatusId?: Id | null;
    /**
     * When `true`, focus the assignee control on open (the card "Assign to"
     * affordance opens this same edit form focused on the assignee, mirroring how
     * the Backlog root routes every story-field edit through the generic form).
     */
    focusAssignee?: boolean;
    /**
     * Assignable users for the assignee control. Derived by the parent from the
     * already-loaded `userstories-filters` "assigned_users" category, so no new
     * endpoint is introduced. May be empty (the control then offers only
     * "Not assigned").
     */
    assignableUsers: AssignableUser[];
    /**
     * Persist a new story. MUST resolve on success and REJECT on failure so the
     * lightbox can keep itself open and surface the error. The parent uses
     * `bulk_create` (+ a follow-up `PATCH` for points/assignee) and re-reads.
     */
    onCreate: (fields: UserStoryCreateFields) => Promise<void>;
    /**
     * Persist edits to an existing story. Same resolve/reject contract as
     * {@link onCreate}. The parent uses `PATCH userstories/{id}` (with `version`
     * for optimistic concurrency) and re-reads.
     */
    onEdit: (us: UserStoryModel, changes: UserStoryEditChanges) => Promise<void>;
    /** Closes the lightbox. Ports `lightboxService.close($el)`. */
    onClose: () => void;
    /**
     * Optional loader for the story's existing attachments (edit mode). The board
     * list endpoint may omit the attachments array, so the parent can wire this to
     * `listUserstoryAttachments(usId, projectId)` to hydrate the attachment list
     * on open. When absent, the form falls back to `us.attachments` (if present).
     */
    fetchAttachments?: (usId: number) => Promise<UserStoryAttachment[]>;
    /**
     * Optional loader for the story's FULL detail (edit mode). The board list
     * endpoint uses a light serializer that OMITS `description`, so the parent
     * wires this to `getUserstory(usId)` to hydrate the Description field (and
     * any other detail-only field) on open. Ports the AngularJS controllers'
     * "re-fetch the story before editing" behavior (kanban/main.coffee `editUs`).
     * When absent, the form falls back to `us.description` (if present).
     */
    fetchDetail?: (usId: number) => Promise<UserStoryModel>;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function UserStoryEditLightbox(
    props: UserStoryEditLightboxProps,
): JSX.Element {
    const {
        open,
        mode,
        project,
        us,
        initialStatusId,
        focusAssignee,
        assignableUsers,
        onCreate,
        onEdit,
        onClose,
        fetchAttachments,
        fetchDetail,
    } = props;

    // Ports `computableRoles = _.filter(project.roles, "computable")`, sorted by
    // order; `pointsList = _.sortBy(project.points, "order")`; and the sorted
    // status list. `KanbanProject.roles`/`.points` are `unknown[]`, so narrow.
    const statusList = useMemo<Status[]>(
        () => [...(project.us_statuses ?? [])].sort((a, b) => a.order - b.order),
        [project.us_statuses],
    );
    const computableRoles = useMemo<Role[]>(
        () =>
            ((project.roles ?? []) as Role[])
                .filter((role) => role.computable)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        [project.roles],
    );
    const pointsList = useMemo<Point[]>(
        () => [...((project.points ?? []) as Point[])].sort((a, b) => a.order - b.order),
        [project.points],
    );

    // The status a fresh CREATE defaults to: the clicked column, else the
    // project default, else the first status.
    const defaultCreateStatus = useMemo<Id>(() => {
        if (initialStatusId != null) {
            return initialStatusId;
        }
        const projectDefault = (project as { default_us_status?: Id })
            .default_us_status;
        if (projectDefault != null) {
            return projectDefault;
        }
        return statusList.length > 0 ? statusList[0].id : 0;
    }, [initialStatusId, project, statusList]);

    // Ports the generic-form `$scope.obj` fields the enumerated contract needs,
    // plus the transient dropdown/submit/error UI flags from the directive scope.
    const [subject, setSubject] = useState<string>("");
    const [statusId, setStatusId] = useState<Id>(defaultCreateStatus);
    const [points, setPoints] = useState<Record<string, Id>>({});
    const [assignedTo, setAssignedTo] = useState<Id | null>(null);
    const [usPosition, setUsPosition] = useState<"top" | "bottom">("bottom");
    const [statusOpen, setStatusOpen] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState<boolean>(false);

    // D-1 — description-erasure guard. `descriptionLoaded` is true once the
    // description value is AUTHORITATIVE (create mode, or the board row already
    // carried a string description, or the detail hydration below succeeded).
    // `descriptionDirty` is true once the user has typed in the textarea. A
    // subject-only edit must NOT send `description` unless it is authoritative or
    // dirty — otherwise the light-serializer's missing description would be
    // persisted as an empty string, silently erasing the stored value.
    const [descriptionLoaded, setDescriptionLoaded] = useState<boolean>(false);
    const [descriptionDirty, setDescriptionDirty] = useState<boolean>(false);
    // D-1: mirror `descriptionDirty` into a ref so the async detail-hydration
    // `.then` (below) can read the CURRENT dirty state without a stale closure.
    // If the user starts typing while the fetch is in flight, the resolved
    // hydration must NOT clobber their edit.
    const descriptionDirtyRef = useRef<boolean>(false);
    // M-10 — the secondary generic-form fields (`.main` description/tags/
    // attachments + sidebar `.ticket-detail-settings` + blocked-note).
    const [description, setDescription] = useState<string>("");
    const [tags, setTags] = useState<UsTag[]>([]);
    const [tagInput, setTagInput] = useState<string>("");
    // Ports `vm.addTag` (tag-line-common controller): the tag input is hidden
    // behind an "Add tag +" button and only revealed on click.
    const [addTagOpen, setAddTagOpen] = useState<boolean>(false);
    const [dueDate, setDueDate] = useState<string>("");
    const [teamRequirement, setTeamRequirement] = useState<boolean>(false);
    const [clientRequirement, setClientRequirement] = useState<boolean>(false);
    const [isBlocked, setIsBlocked] = useState<boolean>(false);
    const [blockedNote, setBlockedNote] = useState<string>("");
    // Attachment intents: the existing list (shown with a delete control), the
    // pending files to upload, and the ids to delete on save. Ports the
    // CoffeeScript `attachments` / `attachmentsToAdd` / `attachmentsToDelete`.
    const [existingAttachments, setExistingAttachments] = useState<
        UserStoryAttachment[]
    >([]);
    const [attachmentsToAdd, setAttachmentsToAdd] = useState<File[]>([]);
    const [attachmentsToDelete, setAttachmentsToDelete] = useState<number[]>([]);

    // Inline-widget UI state (KAN-02): the assignee picker popover
    // (`.pop-users.popover`) open flag + its search term, the estimation
    // per-role points popover (`.pop-points-open`) open role id, and the
    // due-date popover (`.date-picker-popover`) open flag. Each mirrors the
    // transient open/close scope of its AngularJS directive; none is persisted.
    const [assigneePopoverOpen, setAssigneePopoverOpen] = useState<boolean>(false);
    const [assigneeSearch, setAssigneeSearch] = useState<string>("");
    const [pointsPopoverRoleId, setPointsPopoverRoleId] = useState<Id | null>(null);
    const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState<boolean>(false);

    /** `add_us` gates the add/delete-tag controls (`permissions="add_us"`). */
    const canAddTags = useMemo<boolean>(
        () => (project.my_permissions ?? []).includes("add_us"),
        [project.my_permissions],
    );

    // Focus targets: the subject (create / edit) and the assignee select (the
    // "Assign to" affordance requests focus there).
    const subjectRef = useRef<HTMLInputElement>(null);
    // Focus target for the card "Assign to" affordance — now the inline
    // "Assign" link in the assigned-users widget (was the native select).
    const assigneeRef = useRef<HTMLAnchorElement>(null);
    // Hidden file input, triggered by the attachments "+" (add-attachment-button).
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Autofocus target for the add-tag input once the "Add tag +" button reveals it.
    const tagInputRef = useRef<HTMLInputElement>(null);

    // Re-seed the form whenever it opens, mirroring `mount()`: create →
    // schema.initialData defaults (seeded with the clicked column); edit → the
    // row model.
    useEffect(() => {
        if (!open) {
            return;
        }
        if (mode === "edit" && us) {
            setSubject(us.subject ?? "");
            setStatusId(us.status);
            // Clone the points map so edits never mutate the row object in place.
            setPoints({ ...((us.points as Record<string, Id> | undefined) ?? {}) });
            setAssignedTo(us.assigned_to ?? null);
            setDescription(
                typeof us.description === "string" ? us.description : "",
            );
            // D-1: the description is authoritative only if the row already
            // carried a string value; otherwise the hydration effect below must
            // load it before a save may include it.
            setDescriptionLoaded(typeof us.description === "string");
            setDescriptionDirty(false);
            descriptionDirtyRef.current = false;
            // Clone the tag pairs so edits never mutate the row object in place.
            setTags(
                Array.isArray(us.tags)
                    ? (us.tags as UsTag[]).map((tag) => [tag[0], tag[1] ?? null])
                    : [],
            );
            // The API stores due_date as `YYYY-MM-DD`; slice defensively in case a
            // datetime ever arrives, since `<input type="date">` needs `YYYY-MM-DD`.
            setDueDate(
                typeof us.due_date === "string" ? us.due_date.slice(0, 10) : "",
            );
            setTeamRequirement(us.team_requirement === true);
            setClientRequirement(us.client_requirement === true);
            setIsBlocked(us.is_blocked === true);
            setBlockedNote(
                typeof us.blocked_note === "string" ? us.blocked_note : "",
            );
            setExistingAttachments(
                Array.isArray(us.attachments)
                    ? (us.attachments as UserStoryAttachment[])
                    : [],
            );
        } else {
            setSubject("");
            setStatusId(defaultCreateStatus);
            setPoints({});
            setAssignedTo(null);
            setDescription("");
            // Create mode: the empty description IS authoritative (nothing to lose).
            setDescriptionLoaded(true);
            setDescriptionDirty(false);
            descriptionDirtyRef.current = false;
            setTags([]);
            setDueDate("");
            setTeamRequirement(false);
            setClientRequirement(false);
            setIsBlocked(false);
            setBlockedNote("");
            setExistingAttachments([]);
        }
        setUsPosition("bottom");
        setStatusOpen(false);
        setError(null);
        setSubmitting(false);
        // Attachment intents always reset on (re)open (ports `resetAttachments`).
        setTagInput("");
        setAttachmentsToAdd([]);
        setAttachmentsToDelete([]);
        // Transient inline-widget popovers always start closed on (re)open.
        setAddTagOpen(false);
        setAssigneePopoverOpen(false);
        setAssigneeSearch("");
        setPointsPopoverRoleId(null);
        setDueDatePopoverOpen(false);
    }, [open, mode, us, defaultCreateStatus]);

    // Hydrate the existing-attachment list from the loader (edit mode) when the
    // board model did not carry an `attachments` array. Ports the fact that the
    // generic form receives `params.attachments` separately from the row model.
    // Skip the network entirely when the array is already present (the board
    // loaded it — zoomed-in `include_attachments`) or when the story has no
    // attachments (`total_attachments` is 0/absent) — an attachment-free story
    // needs no GET.
    useEffect(() => {
        if (!open || mode !== "edit" || !us?.id || !fetchAttachments) {
            return undefined;
        }
        const alreadyLoaded = Array.isArray(us.attachments);
        const hasAttachments = (us.total_attachments ?? 0) > 0;
        if (alreadyLoaded || !hasAttachments) {
            return undefined;
        }
        let alive = true;
        fetchAttachments(us.id)
            .then((list) => {
                if (alive) {
                    setExistingAttachments(list);
                }
            })
            .catch(() => {
                // A failed attachment fetch must not break the form; the user can
                // still edit every other field and the seeded list (if any) stays.
            });
        return () => {
            alive = false;
        };
    }, [open, mode, us, fetchAttachments]);

    // D-1: hydrate the Description from the full story detail on edit-open. The
    // board LIST endpoint uses a light serializer that OMITS `description`, so a
    // board-row seed leaves the field empty and a subject-only save would erase
    // the stored value. This mirrors the AngularJS controllers, which re-fetched
    // the story before editing (kanban/main.coffee `editUs`). Skip the network
    // when the row already carried a string description (already authoritative)
    // or when no detail loader is wired. On success the field shows the real
    // description AND `descriptionLoaded` unlocks the save; on failure the field
    // stays empty and `descriptionLoaded` stays false, so a subject-only save
    // omits `description` entirely (never erases).
    useEffect(() => {
        if (!open || mode !== "edit" || !us?.id || !fetchDetail) {
            return undefined;
        }
        if (typeof us.description === "string") {
            // The board row already carried it — no fetch needed.
            return undefined;
        }
        let alive = true;
        fetchDetail(us.id)
            .then((detail) => {
                if (!alive || descriptionDirtyRef.current) {
                    // Unmounted/re-opened, OR the user already started editing the
                    // description while the fetch was in flight — do NOT clobber
                    // their in-progress edit with the hydrated value.
                    return;
                }
                setDescription(
                    typeof detail.description === "string" ? detail.description : "",
                );
                // The description is now authoritative and safe to persist.
                setDescriptionLoaded(true);
            })
            .catch(() => {
                // A failed detail fetch must not break the form; the user can
                // still edit every other field. `descriptionLoaded` stays false,
                // so a subject-only save will NOT send (and therefore cannot
                // erase) the description.
            });
        return () => {
            alive = false;
        };
    }, [open, mode, us, fetchDetail]);

    // When the form opens for the "Assign to" affordance, focus the assignee
    // control so the user lands directly on it (ports the quick-assign focus).
    useEffect(() => {
        if (open && focusAssignee) {
            assigneeRef.current?.focus();
        }
    }, [open, focusAssignee]);

    // Autofocus the add-tag input the moment the "Add tag +" button reveals it
    // (ports the `tg-autofocus` directive on the add-tag input).
    useEffect(() => {
        if (open && addTagOpen) {
            tagInputRef.current?.focus();
        }
    }, [open, addTagOpen]);

    // [M-09] Complete modal-dialog semantics via the shared primitive: role +
    // aria-modal, focus entry/trap/return, background inert, and the
    // nested-dialog Escape policy (Escape ignored mid-submit so a pending
    // request is never abandoned). Initial focus honors the quick-assign path
    // (assignee control) and otherwise lands on the subject field, matching the
    // legacy behavior. Replaces the former bespoke Escape-only handler.
    const titleId = useId();
    // [N-02] Instance-unique prefix for the form control ids that the legacy
    // Jade hard-coded (`top-backlog`, `bottom-backlog`, `submitButton`,
    // `add-attach`). Several lightboxes are mounted (hidden) simultaneously on
    // the backlog screen, so static ids collided and made label/`getElementById`
    // resolution ambiguous. `useId()` yields a stable per-instance prefix.
    const fieldIds = useId();
    const { dialogRef, dialogProps } = useDialogA11y({
        open,
        onClose,
        closeOnEscape: !submitting,
        initialFocusRef: focusAssignee ? assigneeRef : subjectRef,
    });

    // Ports getCurrentStatus(): the status whose id matches the selected statusId.
    const currentStatus = useMemo<Status | undefined>(
        () => statusList.find((status) => status.id === statusId),
        [statusList, statusId],
    );

    // Ports toggleStatus() — flip the status dropdown open/closed.
    const toggleStatus = useCallback(() => {
        setStatusOpen((visible) => !visible);
    }, []);

    // Ports setStatus(status) — select a status and collapse the dropdown.
    const setStatus = useCallback((id: Id) => {
        setStatusId(id);
        setStatusOpen(false);
    }, []);

    // Ports onSelectedPointForRole: set (or clear) the point for a computable
    // role in the `roleId -> pointId` map.
    const setPointForRole = useCallback((roleId: Id, pointId: Id | null) => {
        setPoints((prev) => {
            const next = { ...prev };
            if (pointId === null) {
                delete next[String(roleId)];
            } else {
                next[String(roleId)] = pointId;
            }
            return next;
        });
    }, []);

    // Ports `addTag(tag, color)`: normalize to a trimmed, lower-cased value; skip
    // duplicates; default the color from the project's `tags_colors` map (as the
    // CoffeeScript did) so a re-added known tag keeps its color.
    const addTag = useCallback(
        (name: string) => {
            const value = name.trim().toLowerCase();
            if (value === "") {
                return;
            }
            setTags((prev) => {
                if (prev.some((tag) => tag[0] === value)) {
                    return prev;
                }
                const colors =
                    (project.tags_colors as
                        | Record<string, string | null>
                        | undefined) ?? {};
                const color = colors[value] ?? null;
                return [...prev, [value, color]];
            });
            setTagInput("");
        },
        [project.tags_colors],
    );

    // Ports `deleteTag(tag)`: drop the pair whose value matches (case-insensitive).
    const deleteTag = useCallback((tag: UsTag) => {
        const value = tag[0].trim().toLowerCase();
        setTags((prev) => prev.filter((it) => it[0] !== value));
    }, []);

    // Ports `addAttachment` for a set of chosen files: append to the pending list.
    const addAttachments = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) {
            return;
        }
        const chosen = Array.from(files);
        setAttachmentsToAdd((prev) => [...prev, ...chosen]);
    }, []);

    // Ports `deleteAttachment` for a NOT-yet-uploaded (pending) file: drop it from
    // the add list only (nothing to delete server-side).
    const removePendingAttachment = useCallback((file: File) => {
        setAttachmentsToAdd((prev) => prev.filter((it) => it !== file));
    }, []);

    // Ports `deleteAttachment` for an EXISTING attachment: remove it from the
    // visible list and queue its id for deletion on save.
    const removeExistingAttachment = useCallback((att: UserStoryAttachment) => {
        setExistingAttachments((prev) => prev.filter((it) => it.id !== att.id));
        if (typeof att.id === "number") {
            const id = att.id;
            setAttachmentsToDelete((prev) =>
                prev.includes(id) ? prev : [...prev, id],
            );
        }
    }, []);

    // Ports the `.team-requirement` / `.client-requirement` / `.is-blocked`
    // click handlers — each a plain boolean negation on `obj`.
    const toggleTeamRequirement = useCallback(() => {
        setTeamRequirement((value) => !value);
    }, []);
    const toggleClientRequirement = useCallback(() => {
        setClientRequirement((value) => !value);
    }, []);
    const toggleBlocked = useCallback(() => {
        setIsBlocked((value) => !value);
    }, []);

    // The due-date config (project `us_duedates`) — reused to color/format the
    // due-date affordance exactly as the board Card / rows do (M-08 helper).
    const dueDateConfig = useMemo<DueDateAppearance[] | undefined>(
        () =>
            Array.isArray(project.us_duedates)
                ? (project.us_duedates as DueDateAppearance[])
                : undefined,
        [project.us_duedates],
    );

    /* ---------------------------------------------------------------------- */
    /* KAN-02 inline-assignee widget support (ports tg-assigned-users-inline)  */
    /* ---------------------------------------------------------------------- */

    // The current user id, read once from the shared session cache (ports
    // `$currentUserService.getUser().get('id')`); drives "Assign to me".
    const currentUserId = useMemo<Id | null>(() => {
        const user = getCurrentUser();
        return user ? user.id : null;
    }, []);

    // Active project members enriched with a resolved avatar and sorted by
    // display name — the assignee picker's candidate list. Ports the AngularJS
    // `fillUsersAndRoles` active-user filter + `$userListService` avatars.
    const assigneeMembers = useMemo<
        Array<{ user: BaseUser; avatar: { url: string; bg?: string } }>
    >(() => {
        return ((project.members ?? []) as BaseUser[])
            .filter((member) => member.is_active !== false)
            .map((member) => ({ user: member, avatar: resolveUserAvatar(member) }))
            .sort((a, b) =>
                (a.user.full_name_display ?? "").localeCompare(
                    b.user.full_name_display ?? "",
                ),
            );
    }, [project.members]);

    // The currently-assigned member (for its avatar + display name). Falls back
    // to the filter-derived {id,name} when the assignee is not in the active
    // members list (e.g. an inactive member still referenced by the story).
    const assignedMember = useMemo<{
        user: BaseUser;
        avatar: { url: string; bg?: string };
    } | null>(() => {
        if (assignedTo == null) {
            return null;
        }
        const found = assigneeMembers.find((m) => m.user.id === assignedTo);
        if (found) {
            return found;
        }
        const fallbackName =
            assignableUsers.find((u) => u.id === assignedTo)?.name ?? "";
        return {
            user: { id: assignedTo, full_name_display: fallbackName } as BaseUser,
            avatar: { url: unnamedAvatarUrl() },
        };
    }, [assignedTo, assigneeMembers, assignableUsers]);

    // Picker list filtered by the search term and excluding the current
    // assignee (single-assignee model). Ports getFilteredUsers.
    const filteredAssigneeMembers = useMemo(() => {
        const term = assigneeSearch.trim().toLowerCase();
        return assigneeMembers.filter((m) => {
            if (m.user.id === assignedTo) {
                return false;
            }
            if (term === "") {
                return true;
            }
            const name = (m.user.full_name_display ?? "").toLowerCase();
            const uname = (m.user.username ?? "").toLowerCase();
            return name.includes(term) || uname.includes(term);
        });
    }, [assigneeMembers, assigneeSearch, assignedTo]);

    // Assign a user (single-assignee): set the assignee and close the picker.
    const assignUser = useCallback((id: Id) => {
        setAssignedTo(id);
        setAssigneePopoverOpen(false);
        setAssigneeSearch("");
    }, []);

    // "Assign to me": assign the current user (ports selfAssign()).
    const selfAssign = useCallback(() => {
        if (currentUserId != null) {
            setAssignedTo(currentUserId);
        }
        setAssigneePopoverOpen(false);
    }, [currentUserId]);

    // Remove the assignment (ports unassign()).
    const unassignUser = useCallback(() => {
        setAssignedTo(null);
        setAssigneePopoverOpen(false);
    }, []);

    /* ---------------------------------------------------------------------- */
    /* KAN-02 estimation total + per-role display (ports tg-lb-us-estimation)  */
    /* ---------------------------------------------------------------------- */

    // Point id -> Point, for O(1) name/value lookup.
    const pointsById = useMemo<Record<string, Point>>(() => {
        const map: Record<string, Point> = {};
        for (const point of pointsList) {
            map[String(point.id)] = point;
        }
        return map;
    }, [pointsList]);

    // Ports calculateTotalPoints(): sum the selected point VALUES across the
    // computable roles; "?" when nothing (numeric) is selected.
    const totalPoints = useMemo<string>(() => {
        const values: number[] = [];
        for (const role of computableRoles) {
            const pid = points[String(role.id)];
            if (pid == null) {
                continue;
            }
            const point = pointsById[String(pid)];
            if (point && typeof point.value === "number") {
                values.push(point.value);
            }
        }
        if (values.length === 0) {
            return "?";
        }
        return String(values.reduce((acc, num) => acc + num, 0));
    }, [computableRoles, points, pointsById]);

    // The selected point's display NAME for a role ("?" when unset). Ports
    // calculateRoles() -> role.points.
    const rolePointName = useCallback(
        (roleId: Id): string => {
            const pid = points[String(roleId)];
            if (pid == null) {
                return "?";
            }
            return pointsById[String(pid)]?.name ?? "?";
        },
        [points, pointsById],
    );

    // Ports the debounced submit handler: validate, persist through the parent,
    // close on success, surface errors on failure.
    const handleSubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>): Promise<void> => {
            event.preventDefault();

            // Anti-double-submit guard (replaces the CoffeeScript `debounce 2000`).
            if (submitting) {
                return;
            }

            // Validation — REPLACES checksley `data-required` + `data-maxlength=500`.
            const trimmed = subject.trim();
            if (trimmed === "") {
                setError(t("COMMON.FORM_ERRORS.REQUIRED", REQUIRED_MESSAGE));
                subjectRef.current?.focus();
                return;
            }
            if (subject.length > SUBJECT_MAX_LENGTH) {
                setError(
                    t(
                        "COMMON.FORM_ERRORS.MAX_LENGTH",
                        SUBJECT_TOO_LONG_TEMPLATE,
                    ).replace("%s", String(SUBJECT_MAX_LENGTH)),
                );
                subjectRef.current?.focus();
                return;
            }

            setError(null);
            setSubmitting(true);
            try {
                if (mode === "edit" && us) {
                    await onEdit(us, {
                        subject: trimmed,
                        status: statusId,
                        points,
                        assigned_to: assignedTo,
                        // D-1: only send the description when it is authoritative
                        // (loaded from detail / row) or the user edited it. When
                        // neither is true, send `undefined` so the parent omits it
                        // from the PATCH and cannot erase the stored value.
                        description:
                            descriptionLoaded || descriptionDirty
                                ? description
                                : undefined,
                        tags,
                        due_date: dueDate || null,
                        is_blocked: isBlocked,
                        blocked_note: blockedNote,
                        team_requirement: teamRequirement,
                        client_requirement: clientRequirement,
                        attachmentsToAdd,
                        attachmentsToDelete,
                    });
                } else {
                    await onCreate({
                        subject: trimmed,
                        statusId,
                        points,
                        assignedTo,
                        position: usPosition,
                        description,
                        tags,
                        due_date: dueDate || null,
                        is_blocked: isBlocked,
                        blocked_note: blockedNote,
                        team_requirement: teamRequirement,
                        client_requirement: clientRequirement,
                        attachmentsToAdd,
                    });
                }
                onClose();
            } catch {
                // HttpError (or any request failure): surface the single inline
                // error slot and KEEP the lightbox open so the user can retry.
                setError(t("LIGHTBOX.CREATE_EDIT.SAVE_ERROR", GENERIC_ERROR_MESSAGE));
            } finally {
                setSubmitting(false);
            }
        },
        [
            submitting,
            subject,
            mode,
            us,
            statusId,
            points,
            assignedTo,
            usPosition,
            description,
            descriptionLoaded,
            descriptionDirty,
            tags,
            dueDate,
            isBlocked,
            blockedNote,
            teamRequirement,
            clientRequirement,
            attachmentsToAdd,
            attachmentsToDelete,
            onCreate,
            onEdit,
            onClose,
        ],
    );

    return (
        // Root reproduces the Jade host `div.lightbox.lightbox-generic-form
        // .lightbox-create-edit`. Reveal: toggle the `open` class so the
        // `.lightbox.open{display:flex}` rule wins over the base `display:none`.
        <div
            ref={dialogRef}
            {...dialogProps}
            aria-labelledby={titleId}
            className={
                "lightbox lightbox-generic-form lightbox-create-edit" +
                (open ? " open" : "")
            }
        >
            {/* tg-lightbox-close */}
            <button
                className="close"
                type="button"
                onClick={onClose}
                aria-label={t("COMMON.CLOSE", CLOSE_ARIA_LABEL)}
            >
                ✕
            </button>

            <form onSubmit={handleSubmit} noValidate>
                <h2 className="title" id={titleId}>
                    {mode === "edit"
                        ? t("LIGHTBOX.CREATE_EDIT.EDIT_US", TITLE_EDIT)
                        : t("LIGHTBOX.CREATE_EDIT.NEW_US", TITLE_NEW)}
                </h2>

                <div className="form-wrapper">
                    <div className="main">
                        <fieldset>
                            <input
                                ref={subjectRef}
                                type="text"
                                name="subject"
                                value={subject}
                                maxLength={SUBJECT_MAX_LENGTH}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder={t("COMMON.FIELDS.SUBJECT", PLACEHOLDER_SUBJECT)}
                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                autoFocus={!focusAssignee}
                            />
                            {error ? (
                                <span className="checksley-required" role="alert">
                                    {error}
                                </span>
                            ) : null}
                        </fieldset>

                        {/* Tags — ports `tg-tag-line-common.tags-block`
                            (add/delete gated on `add_us`). Each chip reproduces
                            `.tag[background-color] > span + close icon`; the
                            add-tag input adds on Enter (ports `addNewTag`). */}
                        <fieldset>
                            <div className="tags-block">
                                <div className="tags-container">
                                    {tags.map((tag) => (
                                        <div className="tag-wrapper" key={tag[0]}>
                                            <div
                                                className="tag"
                                                style={
                                                    tag[1]
                                                        ? { backgroundColor: tag[1] }
                                                        : undefined
                                                }
                                            >
                                                <span>{tag[0]}</span>
                                                {canAddTags ? (
                                                    <button
                                                        type="button"
                                                        className="icon-close e2e-delete-tag"
                                                        aria-label={t(
                                                            "COMMON.TAGS.DELETE",
                                                            LABEL_DELETE_TAG,
                                                        )}
                                                        title={t(
                                                            "COMMON.TAGS.DELETE",
                                                            LABEL_DELETE_TAG,
                                                        )}
                                                        onClick={() => deleteTag(tag)}
                                                    >
                                                        <Icon name="icon-close" />
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))}
                                    {/* "Add tag +" button (ports add-tag-button.jade,
                                        `.add-tag-button` teal link + icon-add). Shown
                                        only while the input is hidden. */}
                                    {canAddTags && !addTagOpen ? (
                                        <button
                                            type="button"
                                            className="add-tag-button e2e-show-tag-input"
                                            title={t("COMMON.TAGS.ADD", LABEL_ADD_TAG)}
                                            onClick={() => setAddTagOpen(true)}
                                        >
                                            <span className="add-tag-text">
                                                {t("COMMON.TAGS.ADD", LABEL_ADD_TAG)}
                                            </span>
                                            <Icon name="icon-add" />
                                        </button>
                                    ) : null}
                                    {/* Add-tag input (ports add-tag-input.jade), revealed
                                        by the button; a `.save` icon appears once text is
                                        typed (ports `tg-svg.save ng-show=name.length`). */}
                                    {canAddTags && addTagOpen ? (
                                        <div className="add-tag-input">
                                            <input
                                                ref={tagInputRef}
                                                type="text"
                                                className="tag-input e2e-add-tag-input"
                                                value={tagInput}
                                                placeholder={t(
                                                    "COMMON.TAGS.PLACEHOLDER",
                                                    PLACEHOLDER_TAG,
                                                )}
                                                aria-label={t(
                                                    "COMMON.TAGS.ADD",
                                                    LABEL_ADD_TAG,
                                                )}
                                                onChange={(e) =>
                                                    setTagInput(e.target.value)
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        addTag(tagInput);
                                                    } else if (e.key === "Escape") {
                                                        // Close the add-tag input on Escape
                                                        // WITHOUT closing the whole lightbox.
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setAddTagOpen(false);
                                                        setTagInput("");
                                                    }
                                                }}
                                            />
                                            {tagInput.length > 0 ? (
                                                <button
                                                    type="button"
                                                    className="save"
                                                    title={t(
                                                        "COMMON.TAGS.ADD",
                                                        LABEL_ADD_TAG,
                                                    )}
                                                    aria-label={t(
                                                        "COMMON.TAGS.ADD",
                                                        LABEL_ADD_TAG,
                                                    )}
                                                    onClick={() => addTag(tagInput)}
                                                >
                                                    <Icon name="icon-save" />
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </fieldset>

                        {/* Description — ports `textarea.description`. */}
                        <fieldset>
                            <textarea
                                className="description"
                                name="description"
                                rows={7}
                                value={description}
                                placeholder={t(
                                    "LIGHTBOX.CREATE_EDIT.US_PLACEHOLDER_DESCRIPTION",
                                    PLACEHOLDER_DESCRIPTION,
                                )}
                                aria-label={t(
                                    "COMMON.FIELDS.DESCRIPTION",
                                    LABEL_DESCRIPTION,
                                )}
                                onChange={(e) => {
                                    setDescription(e.target.value);
                                    // D-1: a user edit makes the description
                                    // authoritative even if detail hydration is
                                    // still pending / failed.
                                    setDescriptionDirty(true);
                                    descriptionDirtyRef.current = true;
                                }}
                            />
                        </fieldset>

                        {/* Attachments — ports `tg-attachments-simple`: an
                            existing/pending list plus a file picker. Uploads and
                            deletions are DEFERRED to save (the parent runs them
                            against `/userstories/attachments`). */}
                        <fieldset>
                            <section
                                className="attachments attachment-simple"
                                // Ports `tg-attachments-drop`: accept files dropped
                                // anywhere on the section.
                                onDragOver={(e) => {
                                    e.preventDefault();
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    addAttachments(e.dataTransfer?.files ?? null);
                                }}
                            >
                                <div className="attachments-header">
                                    <h3 className="attachments-title">
                                        <span className="attachments-num">
                                            {existingAttachments.length +
                                                attachmentsToAdd.length}
                                        </span>{" "}
                                        <span className="attachments-text">
                                            {t(
                                                "ATTACHMENT.SECTION_NAME",
                                                LABEL_ATTACHMENTS,
                                            )}
                                        </span>
                                    </h3>
                                    {/* Ports attachments-simple.jade `.add-attach`:
                                        a `.btn-icon.add-attachment-button` "+" that
                                        triggers a visually-hidden file input (the raw
                                        native file button is never shown). */}
                                    <div className="add-attach" id={`${fieldIds}-add-attach`}>
                                        <button
                                            type="button"
                                            className="btn-icon add-attachment-button"
                                            aria-label={t(
                                                "ATTACHMENT.ADD",
                                                LABEL_ADD_ATTACHMENT,
                                                { maxFileSizeMsg: "" },
                                            )}
                                            title={t(
                                                "ATTACHMENT.ADD",
                                                LABEL_ADD_ATTACHMENT,
                                                { maxFileSizeMsg: "" },
                                            )}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Icon name="icon-add" />
                                        </button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            style={{ display: "none" }}
                                            aria-hidden="true"
                                            tabIndex={-1}
                                            onChange={(e) => {
                                                addAttachments(e.target.files);
                                                // Allow re-selecting the same file.
                                                e.target.value = "";
                                            }}
                                        />
                                    </div>
                                </div>
                                {/* Empty-state dropzone (ports `.attachments-empty`):
                                    shown only when there are no attachments. */}
                                {existingAttachments.length +
                                    attachmentsToAdd.length ===
                                0 ? (
                                    <div className="attachments-empty">
                                        <div>
                                            {t(
                                                "ATTACHMENT.DROP",
                                                LABEL_ATTACHMENT_DROP,
                                            )}
                                        </div>
                                    </div>
                                ) : null}
                                <div className="attachment-body attachment-list">
                                    {existingAttachments.map((att) => (
                                        <div
                                            className="single-attachment"
                                            key={`existing-${String(att.id)}`}
                                        >
                                            <div className="attachment-name">
                                                <Icon name="icon-attachment" />
                                                <span>{att.name}</span>
                                            </div>
                                            <div className="attachment-settings">
                                                <button
                                                    type="button"
                                                    className="settings attachment-delete"
                                                    aria-label={t(
                                                        "COMMON.DELETE",
                                                        LABEL_DELETE,
                                                    )}
                                                    title={t(
                                                        "COMMON.DELETE",
                                                        LABEL_DELETE,
                                                    )}
                                                    onClick={() =>
                                                        removeExistingAttachment(att)
                                                    }
                                                >
                                                    <Icon name="icon-trash" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {attachmentsToAdd.map((file, index) => (
                                        <div
                                            className="single-attachment pending"
                                            key={`pending-${String(index)}-${file.name}`}
                                        >
                                            <div className="attachment-name">
                                                <Icon name="icon-attachment" />
                                                <span>{file.name}</span>
                                            </div>
                                            <div className="attachment-settings">
                                                <button
                                                    type="button"
                                                    className="settings attachment-delete"
                                                    aria-label={t(
                                                        "COMMON.DELETE",
                                                        LABEL_DELETE,
                                                    )}
                                                    title={t(
                                                        "COMMON.DELETE",
                                                        LABEL_DELETE,
                                                    )}
                                                    onClick={() =>
                                                        removePendingAttachment(file)
                                                    }
                                                >
                                                    <Icon name="icon-trash" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </fieldset>
                    </div>

                    {/* sidebar.sidebar.ticket-data — status + position + assignee
                        + points. Emitted as a semantic <aside> landmark (which
                        React recognizes, so it raises no "unrecognized tag"
                        warning) while keeping the `sidebar ticket-data` classes
                        so the compiled `.sidebar` SCSS themes it unchanged
                        (mirrors how the board sidebar is rendered). */}
                    <aside className="sidebar ticket-data">
                        <fieldset className="status-button">
                            <span className="label">
                                {t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS", LABEL_SELECT_STATUS)}
                            </span>
                            <div
                                className="status-dropdown editable"
                                role="button"
                                tabIndex={0}
                                aria-label={t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS", LABEL_SELECT_STATUS)}
                                onClick={toggleStatus}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        toggleStatus();
                                    }
                                }}
                                // ng-style="{'background-color': selectedStatus.color}"
                                style={{ backgroundColor: currentStatus?.color }}
                            >
                                <span className="status-text">{currentStatus?.name}</span>
                                <svg
                                    className="icon icon-arrow-down"
                                    aria-hidden="true"
                                    focusable="false"
                                >
                                    <use
                                        xlinkHref="#icon-arrow-down"
                                        href="#icon-arrow-down"
                                    />
                                </svg>
                            </div>

                            {/* reveal: `.popover` base is display:none with no
                                class-based reveal rule, so reveal via inline
                                display:block when the dropdown is open. */}
                            {statusOpen ? (
                                <ul
                                    className="pop-status popover"
                                    style={{ display: "block" }}
                                >
                                    {statusList.map((s) => (
                                        <li key={s.id}>
                                            <a
                                                className="status"
                                                role="button"
                                                tabIndex={0}
                                                title={s.name}
                                                data-status-id={s.id}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setStatus(s.id);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault();
                                                        setStatus(s.id);
                                                    }
                                                }}
                                            >
                                                <span className="item-text">{s.name}</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </fieldset>

                        {/* Creation position — jade `section.creation-position(ng-if="mode == 'new'")` */}
                        {mode === "create" ? (
                            <section className="creation-position">
                                <span className="label">
                                    {t("LIGHTBOX.CREATE_EDIT.LOCATION", LABEL_LOCATION)}
                                </span>
                                <div className="creation-position-fields">
                                    {/*
                                      The source template CROSSES id/value pairs:
                                      `id="top-backlog"` carries `value="bottom"` and
                                      `id="bottom-backlog"` carries `value="top"`.
                                      Reproduced verbatim.
                                    */}
                                    <label className="custom-radio">
                                        <input
                                            id={`${fieldIds}-top-backlog`}
                                            type="radio"
                                            name="us_position"
                                            value="bottom"
                                            checked={usPosition === "bottom"}
                                            onChange={() => setUsPosition("bottom")}
                                        />
                                        <span className="radio-control" />
                                        <span className="radio-label">
                                            {t("LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM", LABEL_CREATE_BOTTOM)}
                                        </span>
                                    </label>

                                    <label className="custom-radio">
                                        <input
                                            id={`${fieldIds}-bottom-backlog`}
                                            type="radio"
                                            name="us_position"
                                            value="top"
                                            checked={usPosition === "top"}
                                            onChange={() => setUsPosition("top")}
                                        />
                                        <span className="radio-control" />
                                        <span className="radio-label">
                                            {t("LIGHTBOX.CREATE_EDIT.CREATE_TOP", LABEL_CREATE_TOP)}
                                        </span>
                                    </label>
                                </div>
                            </section>
                        ) : null}

                        {/* Assignee — ports section.ticket-assigned-to +
                            tg-assigned-users-inline (`.assigned-inline`): an
                            avatar-based widget with "Assign / Assign to me" when
                            unassigned, and avatar + name + remove when assigned.
                            The picker (`.pop-users.popover`) opens inline. Single
                            assignee (the story's `assigned_to`). */}
                        <section className="ticket-assigned-to multiple-assign">
                            <span className="label">
                                {t("COMMON.FIELDS.ASSIGNED_TO", LABEL_ASSIGNED_TO)}
                            </span>
                            <div className="assigned-inline">
                                {assignedMember ? (
                                    // Assigned state — avatar + name + remove-user ×.
                                    <div className="ticket-user-list">
                                        <div className="user-list-single">
                                            <div className="user-list-avatar">
                                                <img
                                                    src={assignedMember.avatar.url}
                                                    style={
                                                        assignedMember.avatar.bg
                                                            ? {
                                                                  background:
                                                                      assignedMember
                                                                          .avatar.bg,
                                                              }
                                                            : undefined
                                                    }
                                                    title={
                                                        assignedMember.user
                                                            .full_name_display ?? ""
                                                    }
                                                    alt={
                                                        assignedMember.user
                                                            .full_name_display ?? ""
                                                    }
                                                />
                                            </div>
                                            <div className="user-list-name">
                                                <a
                                                    ref={assigneeRef}
                                                    className="users-dropdown user-assigned"
                                                    role="button"
                                                    tabIndex={0}
                                                    title={t(
                                                        "COMMON.ASSIGNED_TO.TITLE_ACTION_EDIT_ASSIGNMENT",
                                                        TITLE_EDIT_ASSIGNMENT,
                                                    )}
                                                    onClick={() =>
                                                        setAssigneePopoverOpen(
                                                            (v) => !v,
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            setAssigneePopoverOpen(
                                                                (v) => !v,
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <span>
                                                        {
                                                            assignedMember.user
                                                                .full_name_display
                                                        }
                                                    </span>
                                                </a>
                                            </div>
                                            <span
                                                className="remove-user"
                                                role="button"
                                                tabIndex={0}
                                                title={t(
                                                    "COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT",
                                                    TITLE_DELETE_ASSIGNMENT,
                                                )}
                                                aria-label={t(
                                                    "COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT",
                                                    TITLE_DELETE_ASSIGNMENT,
                                                )}
                                                onClick={unassignUser}
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.key === "Enter" ||
                                                        e.key === " "
                                                    ) {
                                                        e.preventDefault();
                                                        unassignUser();
                                                    }
                                                }}
                                            >
                                                <Icon name="icon-close" />
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    // Unassigned state — default avatar + Assign / Assign to me.
                                    <div className="ticket-user-list">
                                        <div className="user-list-single">
                                            <div className="user-list-avatar">
                                                <img
                                                    src={unnamedAvatarUrl()}
                                                    alt={t(
                                                        "COMMON.ASSIGNED_TO.ASSIGN",
                                                        LABEL_ASSIGN,
                                                    )}
                                                />
                                            </div>
                                            <div className="user-list-name">
                                                <a
                                                    ref={assigneeRef}
                                                    className="users-dropdown user-assigned"
                                                    role="button"
                                                    tabIndex={0}
                                                    title={t(
                                                        "COMMON.ASSIGNED_TO.TITLE_ACTION_EDIT_ASSIGNMENT",
                                                        TITLE_EDIT_ASSIGNMENT,
                                                    )}
                                                    onClick={() =>
                                                        setAssigneePopoverOpen(
                                                            (v) => !v,
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            setAssigneePopoverOpen(
                                                                (v) => !v,
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <span className="assigned-name">
                                                        {t(
                                                            "COMMON.ASSIGNED_TO.ASSIGN",
                                                            LABEL_ASSIGN,
                                                        )}
                                                    </span>
                                                </a>
                                                {"\u00a0"}
                                                <span className="read-only">
                                                    {t("COMMON.OR", LABEL_OR)}
                                                </span>
                                                {"\u00a0"}
                                                <a
                                                    className="self-assign"
                                                    role="button"
                                                    tabIndex={0}
                                                    title={t(
                                                        "COMMON.ASSIGNED_TO.SELF",
                                                        LABEL_SELF_ASSIGN,
                                                    )}
                                                    onClick={selfAssign}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            selfAssign();
                                                        }
                                                    }}
                                                >
                                                    <span>
                                                        {t(
                                                            "COMMON.ASSIGNED_TO.SELF",
                                                            LABEL_SELF_ASSIGN,
                                                        )}
                                                    </span>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Picker popover (ports `.pop-users.popover`):
                                    search + member list. Single-click assigns.
                                    Reveal via inline display (the `.popover` mixin
                                    base is display:none). */}
                                {assigneePopoverOpen ? (
                                    <div
                                        className="pop-users popover"
                                        style={{ display: "block" }}
                                    >
                                        <input
                                            type="text"
                                            className="users-search"
                                            placeholder={t(
                                                "LIGHTBOX.ASSIGNED_TO.SEARCH",
                                                PLACEHOLDER_SEARCH_USERS,
                                            )}
                                            aria-label={t(
                                                "LIGHTBOX.ASSIGNED_TO.SEARCH",
                                                PLACEHOLDER_SEARCH_USERS,
                                            )}
                                            value={assigneeSearch}
                                            onChange={(e) =>
                                                setAssigneeSearch(e.target.value)
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setAssigneePopoverOpen(false);
                                                }
                                            }}
                                        />
                                        {filteredAssigneeMembers.map((m) => (
                                            <a
                                                key={m.user.id}
                                                className="user-list-single"
                                                role="button"
                                                tabIndex={0}
                                                data-user-id={m.user.id}
                                                title={
                                                    m.user.full_name_display ?? ""
                                                }
                                                onClick={() =>
                                                    assignUser(m.user.id)
                                                }
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.key === "Enter" ||
                                                        e.key === " "
                                                    ) {
                                                        e.preventDefault();
                                                        assignUser(m.user.id);
                                                    }
                                                }}
                                            >
                                                <img
                                                    className="user-list-avatar"
                                                    src={m.avatar.url}
                                                    style={
                                                        m.avatar.bg
                                                            ? {
                                                                  background:
                                                                      m.avatar.bg,
                                                              }
                                                            : undefined
                                                    }
                                                    alt={
                                                        m.user.full_name_display ??
                                                        ""
                                                    }
                                                />
                                                <span
                                                    className="user-list-name"
                                                    title={
                                                        m.user
                                                            .full_name_display ?? ""
                                                    }
                                                >
                                                    {m.user.full_name_display}
                                                </span>
                                            </a>
                                        ))}
                                        {filteredAssigneeMembers.length === 0 ? (
                                            <div className="show-more">
                                                <span>
                                                    {t(
                                                        "COMMON.ASSIGNED_TO.TOO_MANY",
                                                        LABEL_TOO_MANY_USERS,
                                                    )}
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        {/* Estimation — ports .ticket-estimation (tg-lb-us-estimation)
                            + us-estimation-points-per-role.jade: a striped
                            `ul.points-per-role` of `li.ticket-role-points.total`
                            rows (one per computable role, showing the selected
                            point name) capped by a "total points" row. Clicking a
                            role row opens the `ul.popover.pop-points-open` point
                            selector (ports EstimationProcess.renderPointsSelector);
                            the chosen point carries `.active` (matches
                            us-estimation-points.jade's inverted `selected` flag). */}
                        {computableRoles.length > 0 ? (
                            <div className="ticket-estimation">
                                <div className="ticket-section-label">
                                    <span>
                                        {t("COMMON.FIELDS.POINTS", LABEL_POINTS)}
                                    </span>
                                </div>
                                <ul className="points-per-role">
                                    {computableRoles.map((role) => (
                                        <li
                                            className="ticket-role-points total clickable"
                                            key={role.id}
                                            data-role-id={role.id}
                                            title={role.name}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`${t("COMMON.FIELDS.POINTS", LABEL_POINTS)} — ${role.name}`}
                                            onClick={() =>
                                                setPointsPopoverRoleId((cur) =>
                                                    cur === role.id ? null : role.id,
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === "Enter" ||
                                                    e.key === " "
                                                ) {
                                                    e.preventDefault();
                                                    setPointsPopoverRoleId((cur) =>
                                                        cur === role.id
                                                            ? null
                                                            : role.id,
                                                    );
                                                }
                                            }}
                                        >
                                            <span className="role">{role.name}</span>
                                            <span className="points">
                                                {rolePointName(role.id)}
                                            </span>
                                            {pointsPopoverRoleId === role.id ? (
                                                <ul
                                                    className="popover pop-points-open"
                                                    style={{ display: "block" }}
                                                >
                                                    {pointsList.map((p) => {
                                                        const isChosen =
                                                            points[
                                                                String(role.id)
                                                            ] === p.id;
                                                        return (
                                                            <li key={p.id}>
                                                                <a
                                                                    className={
                                                                        "point" +
                                                                        (isChosen
                                                                            ? " active"
                                                                            : "")
                                                                    }
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    title={p.name}
                                                                    data-point-id={
                                                                        p.id
                                                                    }
                                                                    data-role-id={
                                                                        role.id
                                                                    }
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setPointForRole(
                                                                            role.id,
                                                                            p.id,
                                                                        );
                                                                        setPointsPopoverRoleId(
                                                                            null,
                                                                        );
                                                                    }}
                                                                    onKeyDown={(
                                                                        e,
                                                                    ) => {
                                                                        if (
                                                                            e.key ===
                                                                                "Enter" ||
                                                                            e.key ===
                                                                                " "
                                                                        ) {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            setPointForRole(
                                                                                role.id,
                                                                                p.id,
                                                                            );
                                                                            setPointsPopoverRoleId(
                                                                                null,
                                                                            );
                                                                        }
                                                                    }}
                                                                >
                                                                    <span className="item-text">
                                                                        {p.name}
                                                                    </span>
                                                                </a>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            ) : null}
                                        </li>
                                    ))}
                                    <li className="ticket-role-points total">
                                        <span className="role">
                                            {t(
                                                "US.TOTAL_POINTS",
                                                LABEL_TOTAL_POINTS,
                                            )}
                                        </span>
                                        <span className="points">
                                            {totalPoints}
                                        </span>
                                    </li>
                                </ul>
                            </div>
                        ) : null}

                        {/* Detail settings — ports lb-create-edit-us.jade
                            `.ticket-detail-settings`: due date, team/client
                            requirement toggles, and the blocking toggle. */}
                        <div className="ticket-detail-settings">
                            {/* Due date — ports due-date-popover.jade: a
                                `.btn-icon.due-date-button` clock trigger (colored
                                by the due-date state, matching the board Card /
                                rows) that opens a `.date-picker-popover` for
                                picking / clearing the date. Replaces the always-
                                visible native date input (KAN-02), so the resting
                                form shows an icon button alongside the
                                team/client/block toggles. */}
                            <div className="due-date-button-wrapper">
                                <button
                                    type="button"
                                    className={
                                        "btn-icon due-date-button is-editable date-picker-popover-trigger" +
                                        (dueDate ? " date-set active" : "")
                                    }
                                    style={
                                        dueDate
                                            ? {
                                                  background:
                                                      dueDateColor(
                                                          dueDate,
                                                          dueDateConfig,
                                                      ) ?? undefined,
                                              }
                                            : undefined
                                    }
                                    aria-label={t(
                                        "COMMON.FIELDS.DUE_DATE",
                                        LABEL_DUE_DATE,
                                    )}
                                    aria-expanded={dueDatePopoverOpen}
                                    title={
                                        dueDate
                                            ? t(
                                                  "COMMON.CARD.DUE_DATE",
                                                  DUE_DATE_TOOLTIP,
                                                  {
                                                      date: dueDateTitle(
                                                          dueDate,
                                                          dueDateConfig,
                                                      ),
                                                  },
                                              )
                                            : t(
                                                  "COMMON.FIELDS.DUE_DATE",
                                                  LABEL_DUE_DATE,
                                              )
                                    }
                                    onClick={() =>
                                        setDueDatePopoverOpen((v) => !v)
                                    }
                                >
                                    <Icon name="icon-clock" />
                                </button>
                                {dueDatePopoverOpen ? (
                                    <div
                                        className="date-picker-popover"
                                        style={{ display: "block" }}
                                    >
                                        <div className="date-picker-container">
                                            <input
                                                type="date"
                                                className="due-date-input"
                                                name="due_date"
                                                value={dueDate}
                                                aria-label={t(
                                                    "COMMON.FIELDS.DUE_DATE",
                                                    LABEL_DUE_DATE,
                                                )}
                                                onChange={(e) =>
                                                    setDueDate(e.target.value)
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Escape") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setDueDatePopoverOpen(
                                                            false,
                                                        );
                                                    }
                                                }}
                                            />
                                        </div>
                                        {dueDate ? (
                                            <div className="date-picker-popover-footer">
                                                <a
                                                    className="date-picker-clean"
                                                    role="button"
                                                    tabIndex={0}
                                                    title={t(
                                                        "LIGHTBOX.SET_DUE_DATE.TITLE_ACTION_DELETE_DUE_DATE",
                                                        LABEL_CLEAR_DUE_DATE,
                                                    )}
                                                    aria-label={t(
                                                        "LIGHTBOX.SET_DUE_DATE.TITLE_ACTION_DELETE_DUE_DATE",
                                                        LABEL_CLEAR_DUE_DATE,
                                                    )}
                                                    onClick={() => {
                                                        setDueDate("");
                                                        setDueDatePopoverOpen(
                                                            false,
                                                        );
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            setDueDate("");
                                                            setDueDatePopoverOpen(
                                                                false,
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <Icon name="icon-trash" />
                                                </a>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            <button
                                type="button"
                                className={
                                    "btn-icon team-requirement" +
                                    (teamRequirement ? " active" : "")
                                }
                                aria-label={t(
                                    "COMMON.TEAM_REQUIREMENT",
                                    TITLE_TEAM_REQUIREMENT,
                                )}
                                aria-pressed={teamRequirement}
                                title={t(
                                    "COMMON.TEAM_REQUIREMENT",
                                    TITLE_TEAM_REQUIREMENT,
                                )}
                                onClick={toggleTeamRequirement}
                            >
                                <Icon name="icon-team-requirement" />
                            </button>

                            <button
                                type="button"
                                className={
                                    "btn-icon client-requirement" +
                                    (clientRequirement ? " active" : "")
                                }
                                aria-label={t(
                                    "COMMON.CLIENT_REQUIREMENT",
                                    TITLE_CLIENT_REQUIREMENT,
                                )}
                                aria-pressed={clientRequirement}
                                title={t(
                                    "COMMON.CLIENT_REQUIREMENT",
                                    TITLE_CLIENT_REQUIREMENT,
                                )}
                                onClick={toggleClientRequirement}
                            >
                                <Icon name="icon-client-requirement" />
                            </button>

                            <button
                                type="button"
                                className={
                                    "btn-icon is-blocked" +
                                    (isBlocked ? " item-unblock" : " item-block")
                                }
                                aria-label={t("COMMON.BLOCK_TITLE", TITLE_BLOCK)}
                                aria-pressed={isBlocked}
                                title={t("COMMON.BLOCK_TITLE", TITLE_BLOCK)}
                                onClick={toggleBlocked}
                            >
                                <Icon name="icon-lock" />
                            </button>
                        </div>

                        {/* Blocking reason — ports `tg-blocking-message-input`
                            (`fieldset.blocked-note`), shown only when blocked. */}
                        <fieldset
                            className={
                                "blocked-note" + (isBlocked ? "" : " hidden")
                            }
                        >
                            <input
                                type="text"
                                name="blocked_note"
                                value={blockedNote}
                                placeholder={t(
                                    "COMMON.BLOCKED_NOTE",
                                    PLACEHOLDER_BLOCKED_NOTE,
                                )}
                                onChange={(e) => setBlockedNote(e.target.value)}
                            />
                        </fieldset>
                    </aside>
                </div>

                <div className="btn-container">
                    <button
                        id={`${fieldIds}-submitButton`}
                        className="btn-big add-item js-submit-button"
                        type="submit"
                        disabled={submitting}
                    >
                        {mode === "edit"
                            ? t("COMMON.SAVE", LABEL_SAVE)
                            : t("COMMON.CREATE", LABEL_CREATE)}
                    </button>
                </div>
            </form>
        </div>
    );
}
