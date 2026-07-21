/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CreateEditSprintLightbox — React port of the AngularJS sprint (milestone)
 * create/edit lightbox.
 *
 * SOURCES (behavioural + DOM reference only — NONE of them is imported):
 *   - DOM template  → `app/partials/includes/modules/lightbox-sprint-add-edit.jade`
 *   - Behaviour     → `app/coffee/modules/backlog/lightboxes.coffee`, the
 *                     `CreateEditSprint` directive (`tgLbCreateEditSprint`).
 *   - Lightbox shell/close → the `tg-lightbox-close` directive + `.lightbox`
 *                     mixin (a `.close` anchor and the `open` state class).
 *
 * WHAT THIS IS
 *   The sprint form rendered inside a Taiga lightbox shell. It is a
 *   PRESENTATIONAL component holding only local form/UI state, WITH THE ONE
 *   sanctioned exception every lightbox shares: it MAY call the shared
 *   `../../shared/api/**` layer for its explicit submit flow (create/save). It
 *   validates with the hand-written `validateSprintForm` (the checksley
 *   replacement) and normalises the two date fields to the backend
 *   `YYYY-MM-DD` wire format with `formatSprintDate` — exactly reproducing the
 *   directive's `moment(value, prettyDate).format("YYYY-MM-DD")` pipeline.
 *
 * WHAT THIS IS NOT
 *   It NEVER imports checksley, Immutable.js, dragula, dom-autoscroller,
 *   jQuery, angular, `@dnd-kit/*`, any `.coffee` module, `resources`, or any
 *   `.scss`. There is deliberately no `import React` (the project uses the
 *   `jsx: "react-jsx"` automatic runtime); only the hooks actually used are
 *   imported. The delete action does NOT call an API itself — it confirms with
 *   the user and delegates the actual remove + reload to the parent via
 *   `onRemoved`, mirroring how the directive delegated to `$repo.remove`.
 *
 * VISUAL FIDELITY
 *   The DOM structure and the EXACT existing SCSS class names from
 *   `lightbox-sprint-add-edit.jade` are reproduced verbatim so the retained
 *   SCSS (`app/styles/...`) styles the React screen with pixel fidelity; no
 *   SCSS is imported or rewritten.
 *
 * Toolchain: TypeScript 5.4.5 under `strict`, React 18.2.0, Node v16.19.1.
 */

import { useState, useEffect, useRef, useId } from 'react';

// F-PERF-01: use the shell's already-loaded global Moment (see shared/moment.ts) so
// esbuild does not bundle a second ~60 KB copy of Moment into react.js.
import moment from '../../shared/moment';

import type { Milestone, UserStory, SprintFormValues } from '../../shared/types';
import { validateSprintForm, formatSprintDate } from '../../shared/validation';
import { createMilestone, saveMilestone } from '../../shared/api/milestones';
import { ApiError } from '../../shared/api/client';
// F-UI-02: the ONE shared SVG-sprite primitive (replaces this file's former
// local `svgIcon`/`tg-svg` declaration — icons used here: `icon-close`,
// `icon-trash`). F-UI-06: the shared translation bridge for the dialog title,
// placeholders and action labels (`LIGHTBOX.ADD_EDIT_SPRINT.*`, `COMMON.*`,
// `BACKLOG.EDIT_SPRINT`).
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';
// F-UI-05: shared modal-dialog behaviour (focus trap, Escape-to-close, restore
// focus) applied to the lightbox so it is announced as a modal dialog and is
// fully keyboard-operable — see `useModalDialog`.
import { useModalDialog } from '../../shared/useModalDialog';

/**
 * The localised picker display format, equivalent to the legacy
 * `COMMON.PICKERDATE.FORMAT` (`$translate.instant("COMMON.PICKERDATE.FORMAT")`).
 * The date inputs hold values in THIS format; `formatSprintDate(value, …)`
 * parses it back to the `YYYY-MM-DD` wire format at submit time.
 */
const PICKER_DATE_FORMAT = 'DD MMM YYYY'; // i18n: COMMON.PICKERDATE.FORMAT

/**
 * Props for {@link CreateEditSprintLightbox}. The confirmed core contract is
 * `{ open, mode, sprint, projectId, onCreated, onSaved, onRemoved, onClose }`;
 * the three OPTIONAL props are additive with safe defaults and each supplies a
 * single datum the presentational component cannot derive on its own.
 */
export interface CreateEditSprintLightboxProps {
  /** Toggles the `open` class on the `.lightbox` root (and renders the form). */
  open: boolean;
  /** Create vs edit flow. */
  mode: 'create' | 'edit';
  /** The sprint being edited (null in create mode). */
  sprint: Milestone | null;
  /** Owning project id — used as the `createMilestone` `project` field. */
  projectId: number;
  /**
   * OPTIONAL — parent passes `can(project, 'delete_milestone')`; gates the
   * delete button (edit mode only). Default `false`.
   */
  canDeleteMilestone?: boolean;
  /**
   * OPTIONAL — the most recent OPEN sprint, used ONLY to prefill create-mode
   * dates and the `.last-sprint-name` label. Mirrors the directive's
   * `getLastSprint($scope.sprints)`: the last of the open sprints sorted
   * ascending by `estimated_finish`. If omitted/null, prefill falls back to now.
   */
  lastSprint?: Milestone | null;
  /**
   * OPTIONAL — the user stories the user chose to move into the newly-created
   * sprint. Mirrors the AngularJS `sprintform:create (projectId, uss)` payload
   * and the `create:success(data, ussToAdd)` broadcast. In create mode, echoed
   * back via `onCreated(milestone, ussToMove)`.
   */
  ussToMove?: UserStory[];
  /** Create success → mirrors the `sprintform:create:success` broadcast. */
  onCreated: (milestone: Milestone, ussToMove?: UserStory[]) => void;
  /** Edit success → mirrors the `sprintform:edit:success` broadcast. */
  onSaved: (milestone: Milestone) => void;
  /**
   * Delete confirmed → the parent performs the actual API remove + reload
   * (mirrors the directive's `$repo.remove` + `sprintform:remove:success`).
   */
  onRemoved: (milestone: Milestone) => void;
  /** Close button / after a successful submit. */
  onClose: () => void;
}

/**
 * The sprint create/edit lightbox. Reproduces the `CreateEditSprint` directive:
 * prefill on open, hand-written validation, moment date normalisation, explicit
 * create/save submit, and a confirm-gated delete that delegates upward.
 */
export function CreateEditSprintLightbox(props: CreateEditSprintLightboxProps): JSX.Element {
  const {
    open,
    mode,
    sprint,
    projectId,
    canDeleteMilestone = false,
    lastSprint = null,
    ussToMove,
    onCreated,
    onSaved,
    onRemoved,
    onClose,
  } = props;

  // Local form/UI state ONLY. `estimatedStart` / `estimatedFinish` hold the
  // 'DD MMM YYYY' display strings; they are converted to 'YYYY-MM-DD' on submit.
  const [name, setName] = useState('');
  const [estimatedStart, setEstimatedStart] = useState('');
  const [estimatedFinish, setEstimatedFinish] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    estimated_start?: string;
    estimated_finish?: string;
  }>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [hasErrors, setHasErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  /*
   * N-08: live revalidation. Validation errors are surfaced on a failed submit
   * (see `handleSubmit`), exactly as the legacy checksley form did. Previously
   * those messages then persisted verbatim even after the user corrected the
   * offending field, because the input `onChange` handlers only updated the
   * value and never touched `errors`. `clearError` is invoked from each field's
   * `onChange` so that, once a field carries a validation message, giving it a
   * valid (non-blank — the only rule the sprint validator enforces) value clears
   * that field's message immediately. It ONLY ever removes an existing error; it
   * never adds a new one on keystroke, so untouched fields are not prematurely
   * flagged and the submit-time validation contract is unchanged.
   */
  function clearError(
    field: 'name' | 'estimated_start' | 'estimated_finish',
    value: string,
  ): void {
    if (value.trim().length === 0) {
      return;
    }
    setErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      // When the last field error clears, drop the aggregate `hasErrors` flag so
      // create-mode UI gated on it (e.g. the ".last-sprint-name" hint) returns.
      if (Object.keys(next).length === 0) {
        setHasErrors(false);
      }
      return next;
    });
  }

  // F-UI-05: turn the lightbox into a real accessible modal dialog. The
  // returned ref is spread onto the `.lightbox` shell (which also carries
  // `role="dialog"` + `aria-modal="true"`), giving it a focus trap,
  // Escape-to-close and focus restoration to the opener. It is inert while
  // `open` is false. This hook is intentionally called BEFORE the name-focus
  // effect below so that, on open, the component's own field focus runs LAST
  // and wins over the hook's generic first-focusable fallback.
  const dialogRef = useModalDialog<HTMLDivElement>(open, onClose);
  // Stable id linking the dialog to its heading via `aria-labelledby`.
  const titleId = useId();

  /*
   * Latest-value refs for `sprint` / `lastSprint`. The prefill effect below
   * reads the CURRENT prop values through these refs WITHOUT depending on their
   * object identity.
   *
   * Why this matters (QA MAJOR — unsaved edits wiped by a live event): a
   * background `reloadSprints()` in the container rebuilds the `sprints` array,
   * which yields a brand-new `lastSprint` memo object and a brand-new `sprint`
   * object for the very milestone being edited — a different identity carrying
   * the SAME `sprint.id`. If the prefill effect depended on those objects, that
   * identity churn would re-run it and `setName(sprint.name)` would clobber the
   * user's in-progress typing. By keying the effect on the STABLE `sprint?.id`
   * (plus `open`/`mode`) and reading the objects via refs, an identity-only
   * change never re-runs prefill. Assigned during render so the refs are always
   * current before any effect fires.
   */
  const sprintRef = useRef(sprint);
  sprintRef.current = sprint;
  const lastSprintRef = useRef(lastSprint);
  lastSprintRef.current = lastSprint;

  /*
   * Prefill on open, reproducing the directive's `sprintform:create` /
   * `sprintform:edit` handlers. Only runs while `open` is true.
   *   - create: name cleared; start = lastSprint.estimated_finish || now;
   *     finish = start + 2 weeks (cloned moment so `start` is not mutated).
   *   - edit:   name + dates seeded from the sprint (dates reformatted from the
   *     'YYYY-MM-DD' wire values to the 'DD MMM YYYY' display format).
   *
   * Keyed on [open, mode, sprint?.id] ONLY. `sprint` / `lastSprint` are read via
   * refs (see above) so prefill fires exactly on an open-transition, a mode
   * change, or a switch to a different sprint id — never on a background reload
   * that merely replaces the objects' identity while the id is unchanged.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const currentSprint = sprintRef.current;
    const currentLastSprint = lastSprintRef.current;

    if (mode === 'create') {
      setName('');
      const base = currentLastSprint?.estimated_finish
        ? moment(currentLastSprint.estimated_finish)
        : moment();
      setEstimatedStart(base.format(PICKER_DATE_FORMAT));
      // estimated_finish = start + 2 weeks (directive parity). Clone so the
      // `.add` mutation does not affect the already-formatted start value.
      setEstimatedFinish(base.clone().add(2, 'weeks').format(PICKER_DATE_FORMAT));
      setErrors({});
      setGeneralError(null);
      setHasErrors(false);
    } else if (currentSprint) {
      setName(currentSprint.name);
      setEstimatedStart(moment(currentSprint.estimated_start).format(PICKER_DATE_FORMAT));
      setEstimatedFinish(moment(currentSprint.estimated_finish).format(PICKER_DATE_FORMAT));
      setErrors({});
      setGeneralError(null);
      setHasErrors(false);
    }
  }, [open, mode, sprint?.id]);

  /*
   * Focus the name input when the lightbox opens (optional fidelity). In edit
   * mode the existing text is selected. Defensive null-check on the ref.
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const el = nameInputRef.current;
    if (el) {
      el.focus();
      if (mode === 'edit') {
        el.select();
      }
    }
  }, [open, mode]);

  /**
   * Validate → normalise dates → create/save → notify the parent → close.
   * Reproduces the directive's `submit`; the legacy `debounce 2000` becomes the
   * `submitting` guard (which also disables the submit button while in flight).
   */
  async function handleSubmit(): Promise<void> {
    // Debounce equivalent: ignore re-entrant submits while a request is in flight.
    if (submitting) {
      return;
    }

    const values: SprintFormValues = {
      name,
      estimated_start: estimatedStart,
      estimated_finish: estimatedFinish,
      project: projectId,
    };

    const result = validateSprintForm(values);
    if (!result.valid) {
      // The directive also added `.disappear` to `.last-sprint-name` on error;
      // here that is reactive — `showLastSprintName` becomes false once
      // `hasErrors` is true (see below).
      setErrors(result.errors);
      setHasErrors(true);
      return;
    }

    setErrors({});
    setGeneralError(null);
    setHasErrors(false);

    // Convert the 'DD MMM YYYY' display strings to the 'YYYY-MM-DD' wire format,
    // exactly as the directive did via moment(val, prettyDate).format(...).
    const start = formatSprintDate(estimatedStart, PICKER_DATE_FORMAT);
    const finish = formatSprintDate(estimatedFinish, PICKER_DATE_FORMAT);
    if (start === null || finish === null) {
      // Defensive: validation already guaranteed non-blank dates, so this is
      // unreachable in practice. The guard narrows both values to `string`
      // (not `string | null`) for the API payloads below without a non-null
      // assertion, keeping the file `strict`-clean.
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        // NOTE: the field is `project` (a number), NOT `projectId`.
        const milestone = await createMilestone({
          project: projectId,
          name,
          estimated_start: start,
          estimated_finish: finish,
        });
        // Echo `ussToMove` back, reproducing the create:success(data, ussToAdd)
        // branch of the directive.
        onCreated(milestone, ussToMove);
        onClose();
      } else if (sprint) {
        // PATCH parity with `$repo.save` (repository.coffee:53-64): send ONLY
        // the attributes that actually CHANGED versus the original sprint, plus
        // the concurrency `version` — mirroring `getAttrs(patch=true)` =
        // `_modifiedAttrs` + `version`, where a field counts as modified only
        // when its new value differs from the original (model.coffee:84-90).
        // The whole model is deliberately NOT spread, so read-only / computed
        // fields (slug, closed, total_points, created_date, …) are never
        // PATCHed back (regression fix F-REG-05).
        const changes: Partial<Milestone> = {};
        if (name !== sprint.name) {
          changes.name = name;
        }
        if (start !== sprint.estimated_start) {
          changes.estimated_start = start;
        }
        if (finish !== sprint.estimated_finish) {
          changes.estimated_finish = finish;
        }

        // `version` lives under the Milestone index signature (typed unknown);
        // forward it only when it is a real number.
        const version =
          typeof sprint.version === 'number' ? sprint.version : undefined;

        const milestone = await saveMilestone(sprint.id, changes, version);
        onSaved(milestone);
        onClose();
      }
    } catch (err) {
      // Reproduce `form.setErrors(data)` + the `_error_message`/`__all__`
      // notifications INLINE (React has no `$confirm.notify` toast).
      //
      // REGRESSION FIX (F-REG-04): the backend field errors live in the PARSED
      // RESPONSE BODY, which the transport surfaces as `ApiError.body` — NOT on
      // the error object itself. Reading `err` directly picked up the Error's
      // own members instead (e.g. `err.name` === 'ApiError', the class name),
      // so a "name" field error was fabricated on EVERY failure and the real
      // Django `{ name: [...], _error_message, __all__ }` payload was ignored.
      // We therefore read `err.body` when `err` is an ApiError, and fall back to
      // the raw object only for a non-ApiError throw (defensive).
      const data: Record<string, unknown> =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? (err.body as Record<string, unknown>)
          : err && typeof err === 'object' && !(err instanceof ApiError)
            ? (err as Record<string, unknown>)
            : {};

      // Backend field errors are typically string[]; accept a bare string too.
      const pick = (value: unknown): string | undefined => {
        if (Array.isArray(value)) {
          return typeof value[0] === 'string' ? value[0] : undefined;
        }
        return typeof value === 'string' ? value : undefined;
      };

      const nextErrors: {
        name?: string;
        estimated_start?: string;
        estimated_finish?: string;
      } = {};
      const nameErr = pick(data.name);
      const startErr = pick(data.estimated_start);
      const finishErr = pick(data.estimated_finish);
      if (nameErr) {
        nextErrors.name = nameErr;
      }
      if (startErr) {
        nextErrors.estimated_start = startErr;
      }
      if (finishErr) {
        nextErrors.estimated_finish = finishErr;
      }
      setErrors(nextErrors);
      setGeneralError(pick(data._error_message) ?? pick(data.__all__) ?? null);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Confirm-gated delete. Reproduces the directive's `remove()`; React has no
   * `$confirm.askOnDelete`, so a native `window.confirm` stands in. The parent
   * performs the actual API remove + reload via `onRemoved`.
   */
  function handleRemove(): void {
    if (!sprint) {
      return;
    }
    // Reproduces the directive's `$confirm.askOnDelete(title, message)` with
    // title = LIGHTBOX.DELETE_SPRINT.TITLE and message = sprint.name. React has
    // no `$confirm` service, so a native `window.confirm` stands in (the
    // closest 1:1 confirm-gate). The title is localised via the shared bridge;
    // the English fallback ('Delete sprint') keeps the rendered prompt
    // byte-identical to the prior hard-coded string under `npm test`.
    const confirmTitle = translate('LIGHTBOX.DELETE_SPRINT.TITLE', undefined, 'Delete sprint');
    const confirmed = window.confirm(`${confirmTitle}: ${sprint.name}`);
    if (confirmed) {
      onRemoved(sprint);
      onClose();
    }
  }

  // `.last-sprint-name` visibility mirrors the directive's keyup handler: shown
  // in create mode while a last sprint exists, the name field is empty, and
  // there are no validation errors.
  const showLastSprintName =
    mode === 'create' && !!lastSprint?.name && name.length === 0 && !hasErrors;

  // The last-sprint hint label ("last sprint is <strong> {{lastSprint}} ;-)
  // </strong>", i18n key LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME) is rendered
  // further down as JSX CHILDREN rather than through `dangerouslySetInnerHTML`.
  // The only dynamic segment — the sprint name — is emitted as a JSX expression
  // so React auto-escapes it. This reproduces the AngularJS
  // `.useSanitizeValueStrategy('escapeParameters')` behaviour (app.coffee:803),
  // which escaped the `{{lastSprint}}` translation parameter, and keeps a
  // sprint named e.g. `<img src=x onerror=...>` INERT (no live DOM, no handler
  // execution). See the `.last-sprint-name` label in the JSX below.

  return (
    <div
      ref={dialogRef}
      className={`lightbox lightbox-sprint-add-edit${open ? ' open' : ''}`}
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
      {/* Close control — replaces the `tg-lightbox-close` directive. */}
      <a
        className="close"
        href=""
        title={translate('COMMON.CLOSE', undefined, 'close')}
        /* F-UI-04: the control is icon-only, so it needs an accessible name. */
        aria-label={translate('COMMON.CLOSE', undefined, 'close')}
        onClick={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        <TgSvg icon="icon-close" />
      </a>

      {/*
        The form renders ONLY while `open` (mirrors `ng-if="createEditOpen"`;
        the directive set `createEditOpen = true` when opening). preventDefault
        here mirrors the directive's `event.preventDefault()`.
      */}
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          {/*
            The h2 title DOES swap in the legacy directive (its `.title` selector
            matches), so it is driven by `mode`.
            i18n: LIGHTBOX.ADD_EDIT_SPRINT.TITLE = 'New sprint'
            i18n: BACKLOG.EDIT_SPRINT = 'Edit Sprint'
          */}
          <h2 className="title" id={titleId}>
            {mode === 'create'
              ? translate('LIGHTBOX.ADD_EDIT_SPRINT.TITLE', undefined, 'New sprint')
              : translate('BACKLOG.EDIT_SPRINT', undefined, 'Edit Sprint')}
          </h2>

          {/*
            General (non-field) error, from `_error_message` / `__all__`.
            F-UI-05: `role="alert"` (implicit `aria-live="assertive"`) so the
            failure is announced to screen-reader users the moment it appears.
          */}
          {generalError && (
            <div className="checksley-error-list" role="alert">
              {generalError}
            </div>
          )}

          <fieldset>
            <input
              className={`sprint-name e2e-sprint-name${errors.name ? ' checksley-error' : ''}`}
              type="text"
              name="name"
              maxLength={500}
              placeholder={translate(
                'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME',
                undefined,
                'sprint name',
              )}
              value={name}
              ref={nameInputRef}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name', e.target.value);
              }}
            />
            {errors.name && (
              <ul className="checksley-error-list" role="alert">
                <li>{errors.name}</li>
              </ul>
            )}
            {/*
              `.last-sprint-name` label (create mode). Contains <strong> markup,
              so the static text and the <strong> wrapper are written as JSX and
              the sprint name is emitted as a JSX EXPRESSION (`{lastSprint.name}`)
              — React auto-escapes it, so an attacker-controlled name cannot
              inject live DOM (security parity with the AngularJS
              `escapeParameters` strategy). The rendered DOM is byte-identical to
              the previous `dangerouslySetInnerHTML` output for a benign name
              (`last sprint is <strong> {name} ;-) </strong>`), and the
              `disappear` class toggles exactly as the directive's keyup handler
              did. Content is present only in create mode with a last sprint,
              matching the previous conditional HTML string.
            */}
            <label className={`last-sprint-name${showLastSprintName ? '' : ' disappear'}`}>
              {mode === 'create' && lastSprint?.name ? (
                <>last sprint is <strong> {lastSprint.name} ;-) </strong></>
              ) : null}
            </label>
          </fieldset>

          <fieldset className="dates">
            <div>
              {/*
                The legacy `tg-date-selector` jQuery datepicker is replaced by a
                plain text input holding the 'DD MMM YYYY' display string.
                formatSprintDate(value, 'DD MMM YYYY') parses this exact display
                format into 'YYYY-MM-DD' at submit time.
              */}
              <input
                className={`date-start${errors.estimated_start ? ' checksley-error' : ''}`}
                type="text"
                name="estimated_start"
                placeholder={translate(
                  'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START',
                  undefined,
                  'Estimated Start',
                )}
                value={estimatedStart}
                onChange={(e) => {
                  setEstimatedStart(e.target.value);
                  clearError('estimated_start', e.target.value);
                }}
              />
              {errors.estimated_start && (
                <ul className="checksley-error-list" role="alert">
                  <li>{errors.estimated_start}</li>
                </ul>
              )}
            </div>
            <div>
              <input
                className={`date-end${errors.estimated_finish ? ' checksley-error' : ''}`}
                type="text"
                name="estimated_finish"
                placeholder={translate(
                  'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END',
                  undefined,
                  'Estimated End',
                )}
                value={estimatedFinish}
                onChange={(e) => {
                  setEstimatedFinish(e.target.value);
                  clearError('estimated_finish', e.target.value);
                }}
              />
              {errors.estimated_finish && (
                <ul className="checksley-error-list" role="alert">
                  <li>{errors.estimated_finish}</li>
                </ul>
              )}
            </div>
          </fieldset>

          <div className="sprint-add-edit-actions">
            {/*
              Submit button. The jade renders a static `translate="COMMON.SAVE"`,
              and the legacy directive's Create/Save text swap targeted a
              `.button-green` selector that does NOT match this button (class
              list: `btn-big button-large button-block`), so the rendered label
              is ALWAYS 'Save' in BOTH create and edit modes. (The `<h2 .title>`
              above DOES swap, because its `.title` selector matches.)
              i18n: COMMON.SAVE = 'Save'
            */}
            <button
              className="btn-big button-large button-block"
              type="submit"
              title={translate('COMMON.SAVE', undefined, 'Save')}
              disabled={submitting}
            >
              {translate('COMMON.SAVE', undefined, 'Save')}
            </button>

            {/* Delete — edit mode only, gated on the delete_milestone permission. */}
            {mode === 'edit' && canDeleteMilestone && (
              <button
                className="btn-link delete-sprint"
                type="button"
                title={translate(
                  'LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT',
                  undefined,
                  'delete sprint',
                )}
                onClick={(e) => {
                  e.preventDefault();
                  handleRemove();
                }}
              >
                <TgSvg icon="icon-trash" />
                <span className="delete-sprint-text">
                  {translate(
                    'LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT',
                    undefined,
                    'Do you want to delete this sprint?',
                  )}
                </span>
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
