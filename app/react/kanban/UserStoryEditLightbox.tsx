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
 * Field surface (the like-for-like subset the finding enumerates — "required
 * subject, status, points, assignment"): subject (required, maxlength 500),
 * status (dropdown), estimation points (per computable role), and assignee. The
 * secondary generic-form fields (description, tags, attachments, due-date,
 * requirement/blocking toggles) are intentionally out of this focused port — the
 * finding does not exercise them and they are not part of the enumerated
 * contract.
 *
 * Persistence (AAP §0.4.1 / §0.7.1 — the FROZEN, enumerated `/api/v1/`
 * endpoints): the lightbox is a pure form and DELEGATES persistence to the
 * parent via `onCreate` / `onEdit`, which the parent implements with the two
 * AAP-sanctioned endpoints only — `bulk_create` (+ a follow-up `PATCH
 * userstories/{id}` when points/assignee are set) for create, and `PATCH
 * userstories/{id}` for edit — then re-reads the board.
 */

import {
    createElement,
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
} from "react";
import type { FormEvent, ReactNode } from "react";

import type { KanbanProject, Status, UserStoryModel } from "./useKanbanState";
import { t } from "../shared/i18n/translate";

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
/** COMMON.ASSIGNED_TO.NOT_ASSIGNED — the "no assignee" option. */
const LABEL_NOT_ASSIGNED = "Not assigned";
/** COMMON.FIELDS.POINTS */
const LABEL_POINTS = "Points";
/** Section label for the assignee control. */
const LABEL_ASSIGNED_TO = "Assigned to";
/** COMMON.CREATE — submit label in create mode. */
const LABEL_CREATE = "Create";
/** COMMON.SAVE — submit label in edit mode. */
const LABEL_SAVE = "Save";
/** aria-label for the lightbox close control (ports tg-lightbox-close). */
const CLOSE_ARIA_LABEL = "close";

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

/** The field values collected by the form for a CREATE submission. */
export interface UserStoryCreateFields {
    subject: string;
    statusId: Id;
    /** `roleId` (string key) -> `pointId`; empty when no estimation was set. */
    points: Record<string, Id>;
    assignedTo: Id | null;
    /** Column insertion position (create only), ports `obj.us_position`. */
    position: "top" | "bottom";
}

/** The field values collected by the form for an EDIT submission. */
export interface UserStoryEditChanges {
    subject: string;
    status: Id;
    points: Record<string, Id>;
    assigned_to: Id | null;
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

    // Focus targets: the subject (create / edit) and the assignee select (the
    // "Assign to" affordance requests focus there).
    const subjectRef = useRef<HTMLInputElement>(null);
    const assigneeRef = useRef<HTMLSelectElement>(null);

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
        } else {
            setSubject("");
            setStatusId(defaultCreateStatus);
            setPoints({});
            setAssignedTo(null);
        }
        setUsPosition("bottom");
        setStatusOpen(false);
        setError(null);
        setSubmitting(false);
    }, [open, mode, us, defaultCreateStatus]);

    // When the form opens for the "Assign to" affordance, focus the assignee
    // control so the user lands directly on it (ports the quick-assign focus).
    useEffect(() => {
        if (open && focusAssignee) {
            assigneeRef.current?.focus();
        }
    }, [open, focusAssignee]);

    // Close-on-Escape: attach only while open; ignore while mid-submit so a
    // pending request is never abandoned by a stray keypress. Mirrors the
    // ConfirmDialog / popover Escape handling used elsewhere in the React screens.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape" && !submitting) {
                event.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open, submitting, onClose]);

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
                    });
                } else {
                    await onCreate({
                        subject: trimmed,
                        statusId,
                        points,
                        assignedTo,
                        position: usPosition,
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
                <h2 className="title">
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
                    </div>

                    {/* sidebar.sidebar.ticket-data — status + position + assignee
                        + points. Rendered via `createElement` because `sidebar`
                        is not a standard element and augmenting
                        `JSX.IntrinsicElements` globally is undesirable (mirrors
                        how the board sidebar is rendered). */}
                    {createElement(
                        "sidebar",
                        { className: "sidebar ticket-data" },
                        (
                            <>
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
                                            id="top-backlog"
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
                                            id="bottom-backlog"
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

                        {/* Assignee — ports section.ticket-assigned-to (a focused
                            single-assignee select rather than the multi-assign
                            inline widget). */}
                        <section className="ticket-assigned-to">
                            <span className="label">
                                {t("COMMON.FIELDS.ASSIGNED_TO", LABEL_ASSIGNED_TO)}
                            </span>
                            <select
                                ref={assigneeRef}
                                className="assigned-to-select"
                                aria-label={t("COMMON.FIELDS.ASSIGNED_TO", LABEL_ASSIGNED_TO)}
                                value={assignedTo === null ? "" : String(assignedTo)}
                                onChange={(e) =>
                                    setAssignedTo(
                                        e.target.value === "" ? null : Number(e.target.value),
                                    )
                                }
                            >
                                <option value="">
                                    {t("COMMON.ASSIGNED_TO.NOT_ASSIGNED", LABEL_NOT_ASSIGNED)}
                                </option>
                                {assignableUsers.map((u) => (
                                    <option key={u.id} value={String(u.id)}>
                                        {u.name}
                                    </option>
                                ))}
                            </select>
                        </section>

                        {/* Estimation — ports .ticket-estimation (tg-lb-us-estimation):
                            one point selector per computable role. */}
                        {computableRoles.length > 0 ? (
                            <div className="ticket-estimation">
                                <span className="label">{t("COMMON.FIELDS.POINTS", LABEL_POINTS)}</span>
                                {computableRoles.map((role) => (
                                    <div className="points-per-role" key={role.id}>
                                        <span className="role-name">{role.name}</span>
                                        <select
                                            className="points-select"
                                            aria-label={`${t("COMMON.FIELDS.POINTS", LABEL_POINTS)} — ${role.name}`}
                                            value={
                                                points[String(role.id)] === undefined
                                                    ? ""
                                                    : String(points[String(role.id)])
                                            }
                                            onChange={(e) =>
                                                setPointForRole(
                                                    role.id,
                                                    e.target.value === ""
                                                        ? null
                                                        : Number(e.target.value),
                                                )
                                            }
                                        >
                                            <option value="">?</option>
                                            {pointsList.map((p) => (
                                                <option key={p.id} value={String(p.id)}>
                                                    {p.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                            </>
                        ) as ReactNode,
                    )}
                </div>

                <div className="btn-container">
                    <button
                        id="submitButton"
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
