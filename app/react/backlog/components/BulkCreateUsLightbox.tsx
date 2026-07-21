/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BulkCreateUsLightbox — the React port of the AngularJS "bulk create
 * user-stories" lightbox.
 *
 * React port of the AngularJS `tgLbCreateBulkUserstories` directive
 * (`CreateBulkUserstoriesDirective` in
 * `app/coffee/modules/common/lightboxes.coffee`, original lines ~315-420)
 * together with its template
 * (`app/partials/includes/modules/lightbox-us-bulk.jade`). Both AngularJS
 * sources are DELETE-marked by the migration and are reproduced here
 * byte-for-byte in DOM and behaviour.
 *
 * PRESENTATIONAL + ONE SANCTIONED EXCEPTION. Like the other migrated
 * lightboxes, this component owns ONLY local form/UI state and performs no
 * board data fetching, no WebSocket work and no permission gating. Its single
 * sanctioned side effect is the EXPLICIT submit flow, which calls the shared
 * user-stories API (`../../shared/api/userstories#bulkCreate`) — exactly the
 * AngularJS `$rs.userstories.bulkCreate(...)` call — and then emits the created
 * stories upward through `onSuccess`, mirroring the directive's
 * `$rootscope.$broadcast("usform:bulk:success", result, us_position)`.
 *
 * The directive delegated everything else to its parent scope (project, statuses
 * and swimlanes lived on `$scope.project` / `$scope.swimlanesList`); here those
 * arrive as props from the `BacklogApp` container, and the three actions the
 * directive raised on the root scope become the `onSuccess` / `onClose`
 * callbacks.
 *
 * VISUAL FIDELITY. It reuses the EXACT existing SCSS class names verbatim
 * (`lightbox`, `lightbox-generic-bulk`, `open`, `close`, `title`, `label`,
 * `bulk-status-selector-wrapper`, `bulk-status-selector`,
 * `bulk-status-option-wrapper`, `bulk-status-option`, `selected`,
 * `creation-position`, `creation-position-fields`, `custom-radio`,
 * `radio-control`, `radio-label`, `swimlane-select`, `lb-action-wrapper`,
 * `btn-small`, `js-submit-button`, `checksley-error-list`) so the rendered
 * markup is pixel-identical to the AngularJS lightbox; it neither imports nor
 * rewrites any SCSS.
 *
 * VALIDATION. The AngularJS lightbox used checksley; per the migration rules
 * checksley is NOT used here. The single required field (`bulk`, the textarea)
 * is validated with a small hand-written non-empty check.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement — only the hooks / types actually used are imported.
 */

import { useEffect, useRef, useState, useId, type FormEvent } from 'react';

import type { Status, Swimlane, UserStory } from '../../shared/types';
import { bulkCreate } from '../../shared/api/userstories';
// F-UI-02: the ONE shared SVG-sprite primitive (replaces this file's former
// local `svgIcon`/`tg-svg` declaration — icons used here: `icon-close`,
// `icon-arrow-down`).
import { TgSvg } from '../../shared/icon';
// F-UI-06: the shared translation bridge for the title, section labels, the
// textarea placeholder and the action copy (`COMMON.*`, `LIGHTBOX.CREATE_EDIT.*`).
import { translate } from '../../shared/i18n';
// F-UI-05: shared modal-dialog behaviour (focus trap, Escape-to-close, restore
// focus) applied to the lightbox so it is announced as a modal dialog and is
// fully keyboard-operable — see `useModalDialog`.
import { useModalDialog } from '../../shared/useModalDialog';

/**
 * Props for {@link BulkCreateUsLightbox}. Matches the `BacklogApp` container
 * exactly. `open` toggles the `open` class on the `.lightbox` root (the React
 * equivalent of `lightboxService.open($el)` / `.close($el)`); the remaining
 * props supply the project data the AngularJS directive read off `$scope`.
 */
export interface BulkCreateUsLightboxProps {
  /** Toggles the `open` class on the `.lightbox` root (visibility). */
  open: boolean;
  /** Owning project id — `project_id` sent to the bulk-create endpoint. */
  projectId: number;
  /** `project.default_us_status` — the initially selected status. */
  defaultStatusId: number;
  /** `project.us_statuses` — the status options for the selector. */
  statuses: Status[];
  /** Swimlane options — only used/shown when `isKanbanActivated`. */
  swimlanes?: Swimlane[];
  /** `project.is_kanban_activated` — gates the swimlane fieldset + resolution. */
  isKanbanActivated?: boolean;
  /** `project.default_swimlane` — the fallback swimlane on submit. */
  defaultSwimlane?: number | null;
  /**
   * Fired after a successful bulk create with the created stories and the
   * chosen insert position — the React equivalent of
   * `$rootscope.$broadcast("usform:bulk:success", result, us_position)`.
   */
  onSuccess: (result: UserStory[], position: 'top' | 'bottom') => void;
  /** Closes the lightbox — the React equivalent of `lightboxService.close`. */
  onClose: () => void;
}

/**
 * The bulk create user-stories lightbox.
 *
 * Behaviour reproduced from `CreateBulkUserstoriesDirective`:
 *  - On open (`open` → `true`) the form is reset to the `usform:bulk` initial
 *    state: status = `defaultStatusId`, empty textarea, swimlane =
 *    `defaultSwimlane`, position = `'bottom'`, dropdown closed, errors cleared.
 *  - The status selector toggles a dropdown (`toggleStatus`) and picking an
 *    option sets the status and closes the dropdown (`setStatus`). An outside
 *    click closes the dropdown only — mirroring the directive's document click
 *    handler that called `hideStatus()` unless the click was inside
 *    `.bulk-status-selector-wrapper`.
 *  - Submit validates the required `bulk` textarea, resolves the swimlane
 *    exactly as the directive did, calls `bulkCreate`, then fires `onSuccess`
 *    and `onClose`. Backend field errors are surfaced inline (there is no
 *    `$confirm.notify` toast in React). The `debounce 2000` guard becomes the
 *    `submitting` flag (the submit button is disabled while a request is in
 *    flight).
 */
export function BulkCreateUsLightbox({
  open,
  projectId,
  defaultStatusId,
  statuses,
  swimlanes,
  isKanbanActivated,
  defaultSwimlane,
  onSuccess,
  onClose,
}: BulkCreateUsLightboxProps): JSX.Element {
  // Local form/UI state ONLY (the directive kept this on `$scope.new` + a few
  // flags). Initial values mirror the `usform:bulk` handler's `$scope.new`.
  const [statusId, setStatusId] = useState<number>(defaultStatusId);
  const [bulk, setBulk] = useState('');
  const [swimlaneId, setSwimlaneId] = useState<number | null>(
    defaultSwimlane ?? null,
  );
  const [usPosition, setUsPosition] = useState<'top' | 'bottom'>('bottom');
  const [displayStatusSelector, setDisplayStatusSelector] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `.bulk-status-selector-wrapper` element, used for the outside-click
  // containment check — the React equivalent of the directive inspecting the
  // clicked node's parents for the `bulk-status-selector-wrapper` class.
  const statusWrapperRef = useRef<HTMLDivElement | null>(null);

  // F-UI-05: turn the lightbox into a real accessible modal dialog — focus
  // trap, Escape-to-close and focus restoration to the opener. The returned ref
  // is spread onto the `.lightbox` shell (which also carries `role="dialog"` +
  // `aria-modal="true"`); it is inert while `open` is false. With no dedicated
  // field-focus effect here, the hook's fallback focuses the first focusable
  // control (the close affordance) on open.
  const dialogRef = useModalDialog<HTMLDivElement>(open, onClose);
  // Stable id linking the dialog to its heading via `aria-labelledby`.
  const titleId = useId();

  // Derived current status — mirrors `getCurrentStatus`
  // (`project.us_statuses.filter(s => s.id === statusId).pop()`).
  const currentStatus = statuses.find((status) => status.id === statusId);

  // Reset to the initial `usform:bulk` state whenever the lightbox opens. Guard
  // on `open` so a closed lightbox is never mutated; re-syncing to the latest
  // defaults while open is a harmless no-op when they are unchanged.
  useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId);
      setBulk('');
      setSwimlaneId(defaultSwimlane ?? null);
      setUsPosition('bottom');
      setDisplayStatusSelector(false);
      setBulkError(null);
      setGeneralError(null);
    }
  }, [open, defaultStatusId, defaultSwimlane]);

  // Outside-click closes the status dropdown ONLY (mirrors the directive's
  // `$el.on "click"` → `hideStatus()` unless the click was inside
  // `.bulk-status-selector-wrapper`). Gated on `displayStatusSelector` so the
  // listener exists only while the dropdown is open, and cleaned up on close /
  // unmount (parity with the directive's `$scope.$on("$destroy", -> $el.off())`).
  useEffect(() => {
    if (!displayStatusSelector) {
      return;
    }

    const onDocumentMouseDown = (event: MouseEvent) => {
      const wrapper = statusWrapperRef.current;
      if (wrapper && !wrapper.contains(event.target as Node)) {
        setDisplayStatusSelector(false);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [displayStatusSelector]);

  // `toggleStatus` — mirrors `$scope.toggleStatus`.
  const toggleStatus = () => setDisplayStatusSelector((visible) => !visible);

  // `setStatus` — mirrors `$scope.setStatus`: select the status and close the
  // dropdown.
  const setStatus = (status: Status) => {
    setStatusId(status.id);
    setDisplayStatusSelector(false);
  };

  /**
   * Submit handler — reproduces the directive's `submit` (the `debounce 2000`
   * becomes the `submitting` guard).
   */
  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    // `debounce 2000` equivalent: ignore re-entrant submits while a request is
    // already in flight.
    if (submitting) {
      return;
    }

    // Hand-written validation (checksley replacement): the ONLY required field
    // is the `bulk` textarea. An empty value blocks submit, shows an inline
    // error and never reaches the API.
    if (bulk.trim().length === 0) {
      setBulkError('This value is required.'); // i18n: checksley 'required' default
      return;
    }
    setBulkError(null);

    setGeneralError(null);
    setSubmitting(true);

    // Resolve the swimlane EXACTLY as the directive did: `null` unless kanban is
    // activated; otherwise the chosen swimlane, falling back to the project
    // default when none was chosen.
    let resolvedSwimlane: number | null = null;
    if (isKanbanActivated) {
      resolvedSwimlane = swimlaneId ?? defaultSwimlane ?? null;
    }

    try {
      // `bulkCreate` returns `UserStory[]` directly — the adapter already
      // performs the `result.data` unwrap + model mapping the directive did with
      // `_.map(result.data, …)`, so there is no `.data` to re-map here.
      const result = await bulkCreate(projectId, statusId, bulk, resolvedSwimlane);
      onSuccess(result, usPosition);
      onClose();
    } catch (err) {
      // Reproduce the directive's error branch inline (no `$confirm.notify`
      // toast). The shared `ApiError` carries the parsed Django payload on
      // `.body` (older/other shapes may use `.data`); the DRF field errors
      // (`status`, `swimlane_id`) and `_error_message` live INSIDE that payload.
      // We deliberately do NOT read the top-level `.status`, which on `ApiError`
      // is the numeric HTTP code — treating it as a field error would misfire on
      // every failed request.
      const errorObj = (err && typeof err === 'object' ? err : {}) as Record<
        string,
        any
      >;
      const payloadRaw = errorObj.body ?? errorObj.data;
      const payload = (
        payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {}
      ) as Record<string, any>;

      const messages: string[] = [];
      if (payload.status) {
        // i18n: LIGHTBOX.CREATE_EDIT.ERROR_STATUS
        messages.push(
          'Changes cannot be saved because there is a problem with the selected status.',
        );
      }
      if (payload.swimlane_id) {
        // i18n: LIGHTBOX.CREATE_EDIT.ERROR_SWIMLANE
        messages.push(
          'Changes cannot be saved because there is a problem with the selected swimlane.',
        );
      }
      const errorMessage = payload._error_message ?? errorObj._error_message;
      if (errorMessage) {
        messages.push(String(errorMessage));
      }

      // Surface the combined backend message(s) inline. Defensive fallback: if
      // the failure carried none of the recognised fields, still tell the user
      // the create did not succeed (the AngularJS path relied on checksley's
      // `form.setErrors` here, which React does not have).
      setGeneralError(
        messages.length > 0
          ? messages.join(' ')
          : 'The user stories could not be created.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className={`lightbox lightbox-generic-bulk${open ? ' open' : ''}`}
      /*
        F-UI-05: dialog semantics. `.lightbox` is `display:none` until the
        `open` class is applied (see the `lightbox` SCSS mixin), so assistive
        tech only sees the dialog while it is actually open; `aria-labelledby`
        names it from the `<h2 .title>` heading and `aria-busy` reflects the
        in-flight submit.
      */
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={submitting}
    >
      {/*
        Close control — replaces the `tg-lightbox-close` directive
        (`<a class="close" ng-click="onClose()" …>`). `href=""` is preserved from
        the original markup for style parity.
      */}
      <a
        className="close"
        href=""
        title={translate('COMMON.CLOSE', undefined, 'close')}
        /* F-UI-04: the control is icon-only, so it needs an accessible name. */
        aria-label={translate('COMMON.CLOSE', undefined, 'close')}
        onClick={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <TgSvg icon="icon-close" />
      </a>

      <form onSubmit={handleSubmit}>
        <h2 className="title" id={titleId}>
          {translate('COMMON.NEW_BULK', undefined, 'New bulk insert')}
        </h2>

        {/*
          General backend error region (no toast in React). F-UI-05:
          `role="alert"` (implicit `aria-live="assertive"`) announces the
          failure to screen-reader users the moment it appears.
        */}
        {generalError && (
          <div className="checksley-error-list" role="alert">
            {generalError}
          </div>
        )}

        {/*
          Status selector — rendered only when there are statuses (mirrors
          `ng-if="project.us_statuses"`). Note the jade uses `.label` (a `div`,
          not a `<label>`).
        */}
        {statuses.length > 0 && (
          <fieldset>
            <div className="label">
              {translate('LIGHTBOX.CREATE_EDIT.SELECT_STATUS', undefined, 'Select status')}
            </div>
            <div className="bulk-status-selector-wrapper" ref={statusWrapperRef}>
              <button
                type="button"
                className="bulk-status-selector"
                style={{ backgroundColor: currentStatus?.color }}
                /*
                  F-UI-04: expose the collapsible status menu to assistive tech.
                  `aria-haspopup="menu"` + `aria-expanded` track the dropdown,
                  and the trigger is named from the current status.
                */
                aria-haspopup="menu"
                aria-expanded={displayStatusSelector}
                aria-label={translate(
                  'LIGHTBOX.CREATE_EDIT.SELECT_STATUS',
                  undefined,
                  'Select status',
                )}
                onClick={toggleStatus}
              >
                <span>{currentStatus?.name}</span>
                <TgSvg icon="icon-arrow-down" />
              </button>
              {displayStatusSelector && (
                <div
                  className="bulk-status-option-wrapper"
                  role="menu"
                  aria-label={translate(
                    'LIGHTBOX.CREATE_EDIT.SELECT_STATUS',
                    undefined,
                    'Select status',
                  )}
                >
                  {statuses.map((status) => (
                    <button
                      key={status.id}
                      type="button"
                      role="menuitem"
                      aria-current={status.id === statusId}
                      className={`bulk-status-option${
                        status.id === statusId ? ' selected' : ''
                      }`}
                      onClick={() => setStatus(status)}
                    >
                      {status.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/*
          Creation position radios. The id/value inversion below is reproduced
          VERBATIM from the jade (do NOT "fix" it): `#top-backlog` carries
          value="bottom" and is the default, `#bottom-backlog` carries
          value="top". The ids are relied on by SCSS/e2e and both radios share
          one group `name`.
        */}
        <fieldset className="creation-position">
          <div className="label">
            {translate('LIGHTBOX.CREATE_EDIT.LOCATION', undefined, 'Location')}
          </div>
          <div className="creation-position-fields">
            <label className="custom-radio">
              <input
                id="top-backlog"
                type="radio"
                name="us_position"
                value="bottom"
                checked={usPosition === 'bottom'}
                onChange={() => setUsPosition('bottom')}
              />
              <span className="radio-control" />
              <span className="radio-label">
                {translate('LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM', undefined, 'at the bottom')}
              </span>
            </label>
            <label className="custom-radio">
              <input
                id="bottom-backlog"
                type="radio"
                name="us_position"
                value="top"
                checked={usPosition === 'top'}
                onChange={() => setUsPosition('top')}
              />
              <span className="radio-control" />
              <span className="radio-label">
                {translate('LIGHTBOX.CREATE_EDIT.CREATE_TOP', undefined, 'on top')}
              </span>
            </label>
          </div>
        </fieldset>

        {/*
          Swimlane selector — rendered only when kanban is activated and there
          are swimlanes (mirrors
          `ng-if="project.is_kanban_activated && swimlanesList.size"`). The
          AngularJS `tg-swimlane-selector` widget is replaced with a native
          `<select>` render-only stand-in; the container/label classes are kept
          for style parity.
        */}
        {isKanbanActivated && swimlanes && swimlanes.length > 0 && (
          <fieldset className="swimlane-select">
            <div className="label" id={`${titleId}-swimlane-label`}>
              {translate('LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE', undefined, 'Select swimlane')}
            </div>
            <select
              id="bulk-create-swimlane"
              name="bulk-create-swimlane"
              className="swimlane-select-input"
              /* F-UI-04: the native select is named by its section label. */
              aria-labelledby={`${titleId}-swimlane-label`}
              value={swimlaneId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setSwimlaneId(value === '' ? null : Number(value));
              }}
            >
              {swimlanes.map((swimlane) => (
                <option key={swimlane.id} value={swimlane.id}>
                  {swimlane.name}
                </option>
              ))}
            </select>
          </fieldset>
        )}

        {/* Bulk textarea — the single required field. */}
        <fieldset>
          <textarea
            id="bulk-create-userstories"
            name="bulk-create-userstories"
            cols={200}
            wrap="off"
            className={bulkError ? 'checksley-error' : undefined}
            placeholder={translate('COMMON.ONE_ITEM_LINE', undefined, 'One item per line...')}
            aria-label={translate('COMMON.ONE_ITEM_LINE', undefined, 'One item per line...')}
            aria-invalid={bulkError ? true : undefined}
            value={bulk}
            onChange={(event) => {
              const value = event.target.value;
              setBulk(value);
              // N-08: the "This value is required." message is surfaced on a
              // failed submit (see handleSubmit). Previously it persisted even
              // after the user started typing, because this handler only updated
              // the value. Clear it as soon as the textarea holds a non-blank
              // value so a corrected field stops showing a stale message. Only
              // ever clears an existing error — never adds one on keystroke.
              if (bulkError && value.trim().length > 0) {
                setBulkError(null);
              }
            }}
          />
          {bulkError && (
            <ul className="checksley-error-list" role="alert">
              <li>{bulkError}</li>
            </ul>
          )}
        </fieldset>

        {/*
          Actions. BOTH classes `btn-small` and `js-submit-button` are preserved
          (the latter is required by e2e and was the AngularJS `$loading` target).
          Disabled while a request is in flight (the `debounce 2000` equivalent).
        */}
        <div className="lb-action-wrapper">
          <button
            className="btn-small js-submit-button"
            type="submit"
            title={translate('COMMON.SAVE', undefined, 'Save')}
            disabled={submitting}
          >
            {translate('COMMON.SAVE', undefined, 'Save')}
          </button>
        </div>
      </form>
    </div>
  );
}
