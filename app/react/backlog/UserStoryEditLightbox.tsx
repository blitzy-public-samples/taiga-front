/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UserStoryEditLightbox — React port of the shared AngularJS generic-form
 * create/edit lightbox (`CreateEditUserstoryDirective`, `tg-lb-create-edit`,
 * app/coffee/modules/common/lightboxes.coffee L540-L862) together with its
 * templates
 *   app/partials/common/lightbox/lightbox-create-edit/lb-create-edit.jade and
 *   app/partials/common/lightbox/lightbox-create-edit/lb-create-edit-us.jade,
 * re-implemented INSIDE the React Backlog root.
 *
 * WHY THIS EXISTS (QA finding #2): the migrated `backlog.jade` removed the
 * Angular `tg-lb-create-edit` generic-form host, but the three single-story
 * entry points (header "+ADD", row kebab "Edit", empty-state "Create") still
 * broadcast `genericform:new` / `genericform:edit` to that now-absent host — so
 * all three were silent no-ops. Per AAP §0.7.2 the `backlog.jade` shell must NOT
 * be re-modified to re-host an Angular bridge, so the create/edit form is
 * re-owned in React here (the same coexistence strategy the AAP mandates for the
 * board itself).
 *
 * Fidelity strategy (AAP §0.3.4): the JSX reproduces the DOM structure and CSS
 * class names emitted by the Jade templates (`.lightbox.lightbox-generic-form
 * .lightbox-create-edit`, `.form-wrapper > .main`, `sidebar.sidebar.ticket-data`,
 * `fieldset.status-button > .status-dropdown.editable`, `ul.pop-status.popover`,
 * `section.creation-position`, `.ticket-assigned-to`, `.ticket-estimation`,
 * `.btn-container > #submitButton.btn-big.add-item`) so the already-compiled SCSS
 * themes it unchanged. No `.scss` is imported; theming is class-driven.
 *
 * Reveal contract (QA finding #3 — the SAME systemic bug fixed for the other
 * lightboxes): the `.lightbox` SCSS mixin sets base `display:none;opacity:0` and
 * reveals ONLY via `.lightbox.open{display:flex;opacity:1}`. The root therefore
 * toggles the `open` class whenever `open === true` (element stays mounted,
 * mirroring `lightboxService.open/close`). The status popover reveals via inline
 * `display:block` — the `.popover` mixin is likewise base `display:none` with no
 * class-based reveal rule (Angular used a jQuery `fadeIn`).
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
 * userstories/{id}` for edit — then re-reads the board (matching the finding's
 * "Save persists; readback shows the new/edited story"). Keeping the API +
 * optimistic-concurrency (`version`) + 409-conflict handling in the parent
 * mirrors the existing `onChangeStatus` / `onChangePoints` / `onBulkCreated`
 * handlers, so there is exactly one place that talks to the userstories API.
 */

import { createElement, useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { FormEvent, ReactNode } from "react";

import type { Project, UsStatus, Role, Point, Id, UserStory } from "./types";
import { t } from "../shared/i18n/translate";

/* -------------------------------------------------------------------------- */
/* i18n literals — English values pinned from app/locales/taiga/locale-en.json. */
/* Each constant is the ENGLISH FALLBACK; it is routed through the shared        */
/* catalog ([i18n]) at its render-time use site via `t(KEY, CONST)` (the key is  */
/* shown in each constant's JSDoc). `t()` MUST be called at render time — never   */
/* at module load — so these remain plain string constants used only as the      */
/* fallback argument, and the actual catalog lookup happens per-render.           */
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
/**
 * Section label for the assignee control. The generic-form template renders the
 * multi-assign inline widget (which supplies its own chrome) rather than a
 * labelled field, so this pins a plain English label for the focused
 * single-assignee select used here.
 */
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
 * so the `%s` is substituted locally with `SUBJECT_MAX_LENGTH` at the use site
 * (works identically whether the string came from the catalog or this fallback).
 */
const SUBJECT_TOO_LONG_TEMPLATE = "This value is too long. It should have %s characters or less.";

/**
 * Generic fallback surfaced on a failed request. Ports the CoffeeScript on-error
 * handler (form.setErrors + `$confirm.notify` for status/_error_message,
 * lightboxes.coffee L811-820) into a single inline slot, since the React
 * lightbox has one error slot rather than per-field checksley annotations.
 */
const GENERIC_ERROR_MESSAGE = "The user story could not be saved. Please try again.";

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

/** A user who can be assigned to a story (id = user id, name = display name). */
export interface AssignableUser {
    id: Id;
    name: string;
}

/** The field values collected by the form for a CREATE submission. */
export interface UserStoryCreateFields {
    subject: string;
    statusId: Id;
    /** `roleId` (string key) -> `pointId`; empty when no estimation was set. */
    points: Record<string, Id>;
    assignedTo: Id | null;
    /** Backlog insertion position (create only), ports `obj.us_position`. */
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
    project: Project;
    /** The story being edited (edit mode only); ignored in create mode. */
    us?: UserStory | null;
    /**
     * Assignable users for the assignee control. Derived by the parent from the
     * already-loaded `userstories-filters` "assigned_users" category, so no new
     * endpoint is introduced. May be empty (the control then offers only
     * "Not assigned").
     */
    assignableUsers: AssignableUser[];
    /**
     * Persist a new story. MUST resolve on success and REJECT on failure so the
     * lightbox can keep itself open and surface the error (mirrors the
     * CoffeeScript submit promise). The parent uses `bulk_create` (+ a follow-up
     * `PATCH` for points/assignee) and re-reads the board.
     */
    onCreate: (fields: UserStoryCreateFields) => Promise<void>;
    /**
     * Persist edits to an existing story. Same resolve/reject contract as
     * {@link onCreate}. The parent uses `PATCH userstories/{id}` (with `version`
     * for optimistic concurrency) and re-reads.
     */
    onEdit: (us: UserStory, changes: UserStoryEditChanges) => Promise<void>;
    /** Closes the lightbox. Ports `lightboxService.close($el)`. */
    onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function UserStoryEditLightbox(
    props: UserStoryEditLightboxProps,
): JSX.Element {
    const { open, mode, project, us, assignableUsers, onCreate, onEdit, onClose } = props;

    // Ports the generic-form `$scope.obj` fields the enumerated contract needs,
    // plus the transient dropdown/submit/error UI flags from the directive scope.
    const [subject, setSubject] = useState<string>("");
    const [statusId, setStatusId] = useState<Id>(project.default_us_status);
    const [points, setPoints] = useState<Record<string, Id>>({});
    const [assignedTo, setAssignedTo] = useState<Id | null>(null);
    const [usPosition, setUsPosition] = useState<"top" | "bottom">("bottom");
    const [statusOpen, setStatusOpen] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState<boolean>(false);

    // Focus target for the required-subject error (ports checksley focusing the
    // invalid field).
    const subjectRef = useRef<HTMLInputElement>(null);

    // Re-seed the form whenever it opens, mirroring `mount()` (lightboxes.coffee
    // L651-673): create → schema.initialData defaults; edit → the row `obj`.
    useEffect(() => {
        if (!open) {
            return;
        }
        if (mode === "edit" && us) {
            setSubject(us.subject);
            setStatusId(us.status);
            // Clone the points map so edits never mutate the row object in place.
            setPoints({ ...(us.points ?? {}) });
            setAssignedTo(us.assigned_to);
        } else {
            setSubject("");
            setStatusId(project.default_us_status);
            setPoints({});
            setAssignedTo(null);
        }
        setUsPosition("bottom");
        setStatusOpen(false);
        setError(null);
        setSubmitting(false);
    }, [open, mode, us, project.default_us_status]);

    // Ports getCurrentStatus(): the status whose id matches the selected statusId.
    const currentStatus = useMemo<UsStatus | undefined>(
        () => project.us_statuses.find((status) => status.id === statusId),
        [project.us_statuses, statusId],
    );

    // Ports `statusList = _.sortBy(project.us_statuses, "order")`.
    const statusList = useMemo<UsStatus[]>(
        () => [...project.us_statuses].sort((a, b) => a.order - b.order),
        [project.us_statuses],
    );

    // Ports `computableRoles = _.filter(project.roles, "computable")`, sorted by
    // order (controllerMixins.coffee L31-35).
    const computableRoles = useMemo<Role[]>(
        () =>
            project.roles
                .filter((role) => role.computable)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        [project.roles],
    );

    // Ports `pointsList = _.sortBy(project.points, "order")`.
    const pointsList = useMemo<Point[]>(
        () => [...project.points].sort((a, b) => a.order - b.order),
        [project.points],
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

    // Ports the debounced submit handler (lightboxes.coffee L773-820): validate,
    // persist through the parent, close on success, surface errors on failure.
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
                    t("COMMON.FORM_ERRORS.MAX_LENGTH", SUBJECT_TOO_LONG_TEMPLATE).replace(
                        "%s",
                        String(SUBJECT_MAX_LENGTH),
                    ),
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
        // .lightbox-create-edit`. [#3] reveal: toggle the `open` class so the
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
                                autoFocus
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
                        how BacklogApp renders the board sidebar). */}
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

                            {/* [S] reveal: `.popover` base is display:none with no
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
