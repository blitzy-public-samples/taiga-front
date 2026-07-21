/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BulkUserStoriesLightbox — React port of the shared AngularJS
 * `CreateBulkUserstoriesDirective` (`tgLbCreateBulkUserstories`,
 * app/coffee/modules/common/lightboxes.coffee L315-420) together with its
 * template app/partials/includes/modules/lightbox-us-bulk.jade, re-implemented
 * INSIDE the React Backlog root.
 *
 * Per AAP §0.2.1, `lightbox-us-bulk.jade` is shared by BOTH migrated shells and
 * is retained unmodified on disk, but STOPS being referenced by the Backlog
 * shell once that shell hosts React. Its bulk-create behavior is therefore
 * reproduced here — this is the ONLY bulk-create path for the React Backlog.
 *
 * Fidelity strategy (AAP §0.3.4): the JSX reproduces the EXACT DOM structure and
 * CSS class names emitted by the Jade template so the already-compiled SCSS
 * (app/styles/modules/common/lightbox.scss `.lightbox-generic-bulk`) themes it
 * unchanged. No `.scss` is imported; theming is class-driven at the document
 * root.
 *
 * Behavioral parity with the CoffeeScript directive:
 *  - status selector open/close + "current status" lookup by id
 *    (getCurrentStatus / toggleStatus / setStatus, L320-338)
 *  - creation-position radios seeded to `'bottom'` (usform:bulk seed, L343-349)
 *  - submit validation that REPLACES `checksley` (`data-required` +
 *    `data-linewidth="200"`, jade L72-73) with a hand-written validator
 *  - persistence via the shared `bulkCreate` API adapter, then forwarding the
 *    created stories and the chosen position up to `BacklogApp`, mirroring the
 *    `usform:bulk:success` broadcast (L375) — BacklogApp reloads the backlog and,
 *    when position === "top", runs its move-to-top-of-backlog reorder.
 *  - anti-double-submit guard replacing the CoffeeScript `debounce 2000` (L353).
 *
 * The swimlane fieldset (jade L57-66) IS rendered when the project has swimlanes
 * (BL-01): the shared bulk template gates it on `project.is_kanban_activated`,
 * and a kanban-activated project reachable from the Backlog can define
 * swimlanes, so the SELECT SWIMLANE control is reproduced here (matching the
 * Kanban bulk lightbox) and the chosen `swimlane_id` is sent on create. On a
 * no-swimlane project the control is hidden and `swimlane_id` is `null`.
 */

import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
import type { FormEvent } from "react";

import type { Project, UsStatus, Id, UserStory, Swimlane } from "./types";
import { bulkCreate } from "../shared/api/userstories";
import { t } from "../shared/i18n/translate";
import { Icon } from "../shared/ui/Icon";
import { useDialogA11y } from "../shared/dialog/useDialogA11y";

/* -------------------------------------------------------------------------- */
/* i18n literals — English values pinned from app/locales/taiga/locale-en.json. */
/* Each constant is the ENGLISH FALLBACK, routed through the shared catalog      */
/* ([i18n]) at its render-time use site via `t(KEY, CONST)` (key in each JSDoc). */
/* `t()` MUST be evaluated per-render, never at module load, so these stay plain */
/* string constants used only as the fallback argument.                         */
/* -------------------------------------------------------------------------- */

/** COMMON.NEW_BULK */
const TITLE_NEW_BULK = "New bulk insert";
/** LIGHTBOX.CREATE_EDIT.SELECT_STATUS */
const LABEL_SELECT_STATUS = "Select status";
/** LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE — the bulk swimlane control label (BL-01). */
const LABEL_SELECT_SWIMLANE = "Select swimlane";
/** ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT — suffix on the default swimlane (BL-01). */
const LABEL_SWIMLANE_DEFAULT = "Default";
/** LIGHTBOX.CREATE_EDIT.LOCATION */
const LABEL_LOCATION = "Location";
/** LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM */
const LABEL_CREATE_BOTTOM = "at the bottom";
/** LIGHTBOX.CREATE_EDIT.CREATE_TOP */
const LABEL_CREATE_TOP = "on top";
/** COMMON.ONE_ITEM_LINE */
const PLACEHOLDER_ONE_ITEM_LINE = "One item per line...";
/** COMMON.SAVE */
const LABEL_SAVE = "Save";
/** aria-label for the lightbox close control (ports tg-lightbox-close). */
const CLOSE_ARIA_LABEL = "close";

/* -------------------------------------------------------------------------- */
/* Validation contract (REPLACES checksley `data-required` + `data-linewidth`)  */
/* -------------------------------------------------------------------------- */

/**
 * Legacy `data-linewidth="200"` on the bulk textarea (lightbox-us-bulk.jade L73):
 * every submitted line (one user-story title per line) must be at most this many
 * characters.
 */
const MAX_LINE_LENGTH = 200;

/** COMMON.FORM_ERRORS.REQUIRED — legacy checksley `data-required="true"`. */
const REQUIRED_MESSAGE = "This value is required.";

/**
 * Message for the `data-linewidth="200"` rule. checksley had no user-facing copy
 * for this custom validator, so this pins the React contract.
 */
const LINE_TOO_LONG_MESSAGE = "Each line must be 200 characters or fewer.";

/**
 * Generic fallback surfaced on a failed request. Ports the CoffeeScript on-error
 * handler (form.setErrors + `$confirm.notify` for status/swimlane/_error_message,
 * L378-388) into a single inline message, since the React lightbox has one error
 * slot rather than per-field checksley annotations.
 */
const GENERIC_ERROR_MESSAGE = "The user stories could not be created. Please try again.";

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

export interface BulkUserStoriesLightboxProps {
    /** Whether the lightbox is visible. Ports `lightboxService.open/close`. */
    open: boolean;
    /** The current project (supplies `us_statuses` for the status selector). */
    project: Project;
    /**
     * The status the newly-created stories default to — `project.default_us_status`,
     * carried in the AngularJS `usform:bulk` broadcast payload (L340-349).
     */
    defaultStatusId: Id;
    /**
     * Project swimlanes for the SELECT SWIMLANE control (BL-01). Empty on a
     * no-swimlane project, which hides the control. Fetched by `BacklogApp`.
     */
    swimlanes: Swimlane[];
    /**
     * Project default swimlane id — the swimlane pre-selected on open (BL-01).
     * `null` on a no-swimlane project.
     */
    defaultSwimlaneId: Id | null;
    /**
     * Invoked with the created stories and the chosen position after a successful
     * `bulkCreate`. Mirrors the `usform:bulk:success` broadcast (L375); `BacklogApp`
     * reloads the backlog and, when `position === "top"`, runs its
     * move-to-top-of-backlog reorder (which hits `bulkUpdateBacklogOrder`).
     */
    onCreated: (created: UserStory[], position: "top" | "bottom") => void;
    /** Closes the lightbox. Ports `lightboxService.close($el)`. */
    onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function BulkUserStoriesLightbox(
    props: BulkUserStoriesLightboxProps,
): JSX.Element | null {
    const {
        open,
        project,
        defaultStatusId,
        swimlanes,
        defaultSwimlaneId,
        onCreated,
        onClose,
    } = props;

    // Ports `$scope.new = { statusId, bulk, us_position }` plus the transient
    // `displayStatusSelector` / submit / error UI flags from the directive scope.
    const [statusId, setStatusId] = useState<Id>(defaultStatusId);
    const [bulk, setBulk] = useState<string>("");
    const [usPosition, setUsPosition] = useState<"top" | "bottom">("bottom");
    const [displayStatusSelector, setDisplayStatusSelector] = useState<boolean>(false);
    // BL-01: chosen swimlane (`swimlane_id`) + the styled selector open flag.
    const [swimlaneId, setSwimlaneId] = useState<Id | null>(defaultSwimlaneId);
    const [displaySwimlaneSelector, setDisplaySwimlaneSelector] =
        useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState<boolean>(false);
    // [M11] SYNCHRONOUS single-write latch. The `submitting` STATE above drives
    // the disabled/busy affordance on the Save button, but React state updates
    // asynchronously: a rapid second activation (double-click, or click+Enter)
    // dispatched BEFORE the re-render still observes the stale `submitting ===
    // false` in this callback's closure, so a state-only guard lets a second
    // `bulkCreate` through and persists duplicate stories (QF-M11). A ref mutates
    // synchronously and is shared across renders, so the first submit latches it
    // to `true` before awaiting and every subsequent call sees `true` and bails —
    // the same single-write guarantee the Kanban parent gets from
    // `bulkSubmittingRef` (KanbanApp `submitBulk`).
    const submittingRef = useRef<boolean>(false);

    // Focus target for validation errors (ports checksley focusing the invalid field).
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Re-seed all form state whenever the lightbox opens, mirroring the
    // `usform:bulk` handler that reset the form and rebuilt `$scope.new` (L340-350).
    useEffect(() => {
        if (open) {
            setStatusId(defaultStatusId);
            setBulk("");
            setUsPosition("bottom");
            setDisplayStatusSelector(false);
            // BL-01: pre-select the project default swimlane on (re)open
            // (baseline shows "voluptate (Default)"); fall back to the first
            // swimlane when a swimlane project defines no explicit default.
            setSwimlaneId(defaultSwimlaneId ?? swimlanes[0]?.id ?? null);
            setDisplaySwimlaneSelector(false);
            setError(null);
            setSubmitting(false);
        }
    }, [open, defaultStatusId, defaultSwimlaneId, swimlanes]);

    // [M-09] Complete modal-dialog accessibility (role/aria-modal, focus
    // entry+trap+return, background inert, nested-Escape policy) via the shared
    // primitive. Escape closes the lightbox (equivalent to the ✕ close button)
    // but never while a submit is in flight (`closeOnEscape: !submitting`).
    // Initial focus lands on the bulk textarea. Replaces the former bespoke
    // Escape-only handler.
    const titleId = useId();
    // [N-02] Instance-unique prefix for the crossed `top-backlog`/`bottom-backlog`
    // radio ids the legacy Jade hard-coded, which collided with the other backlog
    // lightboxes mounted (hidden) at the same time. `useId()` yields a stable
    // per-instance prefix.
    const fieldIds = useId();
    const { dialogRef, dialogProps } = useDialogA11y({
        open,
        onClose,
        closeOnEscape: !submitting,
        initialFocusRef: textareaRef,
    });

    // Ports getCurrentStatus(): the status whose id matches the selected statusId.
    const currentStatus = useMemo<UsStatus | undefined>(
        () => project.us_statuses.find((status) => status.id === statusId),
        [project.us_statuses, statusId],
    );

    // BL-01: whether to render the SELECT SWIMLANE control (jade gate
    // `project.is_kanban_activated`, only meaningful when swimlanes exist) and
    // the currently-selected swimlane object for the button label.
    const showSwimlaneSelector = useMemo<boolean>(
        () => project.is_kanban_activated === true && swimlanes.length > 0,
        [project.is_kanban_activated, swimlanes.length],
    );
    const currentSwimlane = useMemo<Swimlane | null>(
        () =>
            swimlaneId === null
                ? null
                : swimlanes.find((swimlane) => swimlane.id === swimlaneId) ?? null,
        [swimlanes, swimlaneId],
    );

    // Ports toggleStatus() — flip the dropdown open/closed.
    const toggleStatus = useCallback(() => {
        setDisplayStatusSelector((visible) => !visible);
    }, []);

    // Ports setStatus(status) — select a status and collapse the dropdown.
    const setStatus = useCallback((id: Id) => {
        setStatusId(id);
        setDisplayStatusSelector(false);
    }, []);

    // Ports the debounced submit handler (L353-388): validate, persist, forward.
    const handleSubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>): Promise<void> => {
            event.preventDefault();

            // [M11] Anti-double-submit guard (replaces the CoffeeScript `debounce
            // 2000`). This MUST read the synchronous ref, not the `submitting`
            // state — a rapid second activation before the re-render would still
            // see the stale state value and slip a duplicate `bulkCreate` through.
            if (submittingRef.current) {
                return;
            }

            // Validation — REPLACES checksley `data-required` + `data-linewidth=200`.
            const trimmed = bulk.trim();
            if (trimmed === "") {
                setError(t("COMMON.FORM_ERRORS.REQUIRED", REQUIRED_MESSAGE));
                textareaRef.current?.focus();
                return;
            }

            const hasTooLongLine = bulk
                .split(/\r?\n/)
                .some((line) => line.length > MAX_LINE_LENGTH);
            if (hasTooLongLine) {
                setError(t("LIGHTBOX.BULK.LINE_TOO_LONG", LINE_TOO_LONG_MESSAGE));
                textareaRef.current?.focus();
                return;
            }

            setError(null);
            // Latch the synchronous guard BEFORE any await so a concurrent second
            // activation dispatched in the same tick observes it immediately.
            submittingRef.current = true;
            setSubmitting(true);
            try {
                // BL-01: create the stories into the chosen swimlane when the
                // project has swimlanes; `null` (no-swimlane project) is sent as
                // the unclassified swimlane, exactly as before.
                const res = await bulkCreate(project.id, statusId, bulk, swimlaneId);
                // The bulk_create endpoint returns full user-story objects; the API
                // adapter types them with the minimal `{ id }` shape, so narrow to the
                // richer domain `UserStory` for the consumer (mirrors the CoffeeScript
                // `_.map(result.data, make_model)` at L373). No `any` is used.
                const created = res.data as UserStory[];
                onCreated(created, usPosition);
                onClose();
            } catch {
                // HttpError (or any request failure): surface the single inline error
                // slot (ports form.setErrors + $confirm.notify, L378-388).
                setError(t("LIGHTBOX.BULK.CREATE_ERROR", GENERIC_ERROR_MESSAGE));
            } finally {
                // Release the synchronous latch and the busy state together so a
                // legitimate retry after an error (the lightbox stays open) is
                // allowed once the in-flight write has settled.
                submittingRef.current = false;
                setSubmitting(false);
            }
        },
        [bulk, project.id, statusId, swimlaneId, usPosition, onCreated, onClose],
    );

    return (
        // Wrapper reproduces the backlog shell's host element
        // `div.lightbox.lightbox-generic-bulk`. [#3] reveal: the `.lightbox` SCSS
        // mixin sets base `display:none;opacity:0` and reveals ONLY via
        // `.lightbox.open{display:flex;opacity:1}`. The previous `style={{display:
        // open ? undefined : "none"}}` left `display` unset when open, so the base
        // `display:none` still applied and the lightbox never appeared. We toggle
        // the `open` class instead (element stays in the DOM either way, mirroring
        // `lightboxService.open/close`).
        <div
            ref={dialogRef}
            {...dialogProps}
            aria-labelledby={titleId}
            className={"lightbox lightbox-generic-bulk" + (open ? " open" : "")}
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
                    {t("COMMON.NEW_BULK", TITLE_NEW_BULK)}
                </h2>

                {/* Status selector — jade `fieldset(ng-if="project.us_statuses")` */}
                {project.us_statuses ? (
                    <fieldset>
                        <span className="label">
                            {t("LIGHTBOX.CREATE_EDIT.SELECT_STATUS", LABEL_SELECT_STATUS)}
                        </span>
                        <div className="bulk-status-selector-wrapper">
                            <button
                                type="button"
                                className="bulk-status-selector"
                                onClick={toggleStatus}
                                // ng-style="{'background-color': currentStatus.color}"
                                style={{ backgroundColor: currentStatus?.color }}
                            >
                                <span>{currentStatus?.name}</span>
                                {/* tg-svg icon-arrow-down (decorative) */}
                                <svg
                                    className="icon icon-arrow-down"
                                    aria-hidden="true"
                                    focusable="false"
                                >
                                    <use xlinkHref="#icon-arrow-down" href="#icon-arrow-down" />
                                </svg>
                            </button>
                            {displayStatusSelector ? (
                                <div className="bulk-status-option-wrapper">
                                    {project.us_statuses.map((status) => (
                                        <button
                                            type="button"
                                            key={status.id}
                                            className={`bulk-status-option${
                                                status.id === statusId ? " selected" : ""
                                            }`}
                                            onClick={() => setStatus(status.id)}
                                        >
                                            {status.name}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </fieldset>
                ) : null}

                {/* Creation position — jade `fieldset.creation-position` */}
                <fieldset className="creation-position">
                    <span className="label">{t("LIGHTBOX.CREATE_EDIT.LOCATION", LABEL_LOCATION)}</span>
                    <div className="creation-position-fields">
                        {/*
                          The source template intentionally CROSSES the id/value pairs:
                          `id="top-backlog"` carries `value="bottom"` and
                          `id="bottom-backlog"` carries `value="top"`. Reproduced verbatim.
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
                </fieldset>

                {/* Swimlane selector — ports lightbox-us-bulk.jade `fieldset.swimlane-select`
                    (tg-swimlane-selector), rendered when the project has swimlanes
                    (BL-01). Reproduces the Kanban bulk `.swimlane-selector`
                    structure — a styled dropdown of the project swimlanes with the
                    default marked "(Default)" — so the compiled SCSS themes it
                    identically. The baseline order is STATUS → LOCATION → SWIMLANE
                    → textarea. */}
                {showSwimlaneSelector ? (
                    <fieldset className="swimlane-select">
                        <span className="label">
                            {t("LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE", LABEL_SELECT_SWIMLANE)}
                        </span>
                        <div className="swimlane-selector">
                            <button
                                type="button"
                                className="select"
                                aria-haspopup="listbox"
                                aria-expanded={displaySwimlaneSelector}
                                onClick={() =>
                                    setDisplaySwimlaneSelector((o) => !o)
                                }
                            >
                                {currentSwimlane ? (
                                    <span className="swimlane-select-text">
                                        <span>{currentSwimlane.name}</span>
                                        {currentSwimlane.id === defaultSwimlaneId &&
                                        swimlanes.length > 1 ? (
                                            <span className="swimlane-default">
                                                {" (" +
                                                    t(
                                                        "ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT",
                                                        LABEL_SWIMLANE_DEFAULT,
                                                    ) +
                                                    ")"}
                                            </span>
                                        ) : null}
                                    </span>
                                ) : (
                                    <span className="swimlane-select-text unclassified">
                                        {swimlanes[0]?.name}
                                    </span>
                                )}
                                <Icon name="icon-arrow-down" />
                            </button>
                            {displaySwimlaneSelector ? (
                                <div className="options" role="listbox">
                                    {swimlanes.map((swimlane) => (
                                        <button
                                            key={swimlane.id}
                                            type="button"
                                            role="option"
                                            aria-selected={swimlane.id === swimlaneId}
                                            className={
                                                "option" +
                                                (swimlane.id === swimlaneId
                                                    ? " selected"
                                                    : "")
                                            }
                                            onClick={() => {
                                                setSwimlaneId(swimlane.id);
                                                setDisplaySwimlaneSelector(false);
                                            }}
                                        >
                                            <span>{swimlane.name}</span>
                                            {defaultSwimlaneId === swimlane.id &&
                                            swimlanes.length > 1 ? (
                                                <span className="swimlane-default">
                                                    {" (" +
                                                        t(
                                                            "ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT",
                                                            LABEL_SWIMLANE_DEFAULT,
                                                        ) +
                                                        ")"}
                                                </span>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </fieldset>
                ) : null}

                <fieldset>
                    <textarea
                        ref={textareaRef}
                        cols={200}
                        wrap="off"
                        value={bulk}
                        onChange={(changeEvent) => setBulk(changeEvent.target.value)}
                        placeholder={t("COMMON.ONE_ITEM_LINE", PLACEHOLDER_ONE_ITEM_LINE)}
                    />
                    {error ? (
                        <span className="checksley-required" role="alert">
                            {error}
                        </span>
                    ) : null}
                </fieldset>

                <div className="lb-action-wrapper">
                    <button
                        className="btn-small js-submit-button"
                        type="submit"
                        disabled={submitting}
                    >
                        {t("COMMON.SAVE", LABEL_SAVE)}
                    </button>
                </div>
            </form>
        </div>
    );
}
