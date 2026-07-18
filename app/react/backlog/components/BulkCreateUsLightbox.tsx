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

import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { Status, Swimlane, UserStory } from '../../shared/types';
import { bulkCreate } from '../../shared/api/userstories';

/*
 * Taiga renders inline SVG sprites through its `<tg-svg>` web component (so CSS
 * selectors such as `tg-svg svg.icon` keep matching). It is not a standard HTML
 * element, so we widen the JSX intrinsic-element table locally. Typed `any`
 * because the element is opaque to React/TS and is resolved by the existing
 * sprite runtime at render time. The identical local declaration exists in the
 * sibling components; duplicate ambient merges are harmless.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'tg-svg': any;
    }
  }
}

/**
 * Render Taiga's `<tg-svg>` sprite wrapper, mirroring the AngularJS
 * `tg-svg(svg-icon="…")` markup. The inner `<svg>` carries the `icon <name>`
 * classes the SCSS targets, and `<use>` references the sprite by id. `className`
 * is forwarded onto the custom element for parity with the shared convention.
 */
function svgIcon(icon: string, className?: string) {
  return (
    <tg-svg class={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} />
      </svg>
    </tg-svg>
  );
}

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
    <div className={`lightbox lightbox-generic-bulk${open ? ' open' : ''}`}>
      {/*
        Close control — replaces the `tg-lightbox-close` directive
        (`<a class="close" ng-click="onClose()" …>`). `href=""` is preserved from
        the original markup for style parity.
      */}
      <a
        className="close"
        href=""
        title="Close" /* i18n: COMMON.CLOSE */
        onClick={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        {svgIcon('icon-close')}
      </a>

      <form onSubmit={handleSubmit}>
        {/* i18n: COMMON.NEW_BULK */}
        <h2 className="title">New bulk insert</h2>

        {/* General backend error region (no toast in React). */}
        {generalError && (
          <div className="checksley-error-list">{generalError}</div>
        )}

        {/*
          Status selector — rendered only when there are statuses (mirrors
          `ng-if="project.us_statuses"`). Note the jade uses `.label` (a `div`,
          not a `<label>`).
        */}
        {statuses.length > 0 && (
          <fieldset>
            {/* i18n: LIGHTBOX.CREATE_EDIT.SELECT_STATUS */}
            <div className="label">Select status</div>
            <div className="bulk-status-selector-wrapper" ref={statusWrapperRef}>
              <button
                type="button"
                className="bulk-status-selector"
                style={{ backgroundColor: currentStatus?.color }}
                onClick={toggleStatus}
              >
                <span>{currentStatus?.name}</span>
                {svgIcon('icon-arrow-down')}
              </button>
              {displayStatusSelector && (
                <div className="bulk-status-option-wrapper">
                  {statuses.map((status) => (
                    <button
                      key={status.id}
                      type="button"
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
          {/* i18n: LIGHTBOX.CREATE_EDIT.LOCATION */}
          <div className="label">Location</div>
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
              {/* i18n: LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM */}
              <span className="radio-label">at the bottom</span>
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
              {/* i18n: LIGHTBOX.CREATE_EDIT.CREATE_TOP */}
              <span className="radio-label">on top</span>
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
            {/* i18n: LIGHTBOX.CREATE_EDIT.SELECT_SWIMLANE */}
            <div className="label">Select swimlane</div>
            <select
              className="swimlane-select-input"
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
            cols={200}
            wrap="off"
            className={bulkError ? 'checksley-error' : undefined}
            placeholder="One item per line..." /* i18n: COMMON.ONE_ITEM_LINE */
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
          />
          {bulkError && (
            <ul className="checksley-error-list">
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
            title="Save" /* i18n: COMMON.SAVE */
            disabled={submitting}
          >
            {/* i18n: COMMON.SAVE */}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
