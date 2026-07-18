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

import { useState, useEffect, useRef } from 'react';

import moment from 'moment';

import type { Milestone, UserStory, SprintFormValues } from '../../shared/types';
import { validateSprintForm, formatSprintDate } from '../../shared/validation';
import { createMilestone, saveMilestone } from '../../shared/api/milestones';

/*
 * The lightbox markup uses Taiga's `<tg-svg>` web component to render inline
 * SVG sprites (so CSS selectors such as `tg-svg svg.icon` keep matching). It is
 * not a standard HTML element, so we widen the JSX intrinsic-element table
 * locally. Typed `any` because the element is opaque to React/TS and is
 * resolved by the existing sprite runtime at render time. (The same local
 * declaration exists in the sibling components; duplicate ambient merges are
 * harmless.)
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
 * classes the SCSS targets, and `<use>` references the sprite by id.
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
   * Prefill on open, reproducing the directive's `sprintform:create` /
   * `sprintform:edit` handlers. Only runs while `open` is true.
   *   - create: name cleared; start = lastSprint.estimated_finish || now;
   *     finish = start + 2 weeks (cloned moment so `start` is not mutated).
   *   - edit:   name + dates seeded from the sprint (dates reformatted from the
   *     'YYYY-MM-DD' wire values to the 'DD MMM YYYY' display format).
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === 'create') {
      setName('');
      const base = lastSprint?.estimated_finish
        ? moment(lastSprint.estimated_finish)
        : moment();
      setEstimatedStart(base.format(PICKER_DATE_FORMAT));
      // estimated_finish = start + 2 weeks (directive parity). Clone so the
      // `.add` mutation does not affect the already-formatted start value.
      setEstimatedFinish(base.clone().add(2, 'weeks').format(PICKER_DATE_FORMAT));
      setErrors({});
      setGeneralError(null);
      setHasErrors(false);
    } else if (sprint) {
      setName(sprint.name);
      setEstimatedStart(moment(sprint.estimated_start).format(PICKER_DATE_FORMAT));
      setEstimatedFinish(moment(sprint.estimated_finish).format(PICKER_DATE_FORMAT));
      setErrors({});
      setGeneralError(null);
      setHasErrors(false);
    }
  }, [open, mode, sprint, lastSprint]);

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
        // Spread the existing sprint first (mirrors `newSprint =
        // $scope.newSprint.realClone()` so version + other fields ride along),
        // then override id + name + the formatted dates.
        const milestone = await saveMilestone({
          ...sprint,
          id: sprint.id,
          name,
          estimated_start: start,
          estimated_finish: finish,
        });
        onSaved(milestone);
        onClose();
      }
    } catch (err) {
      // Reproduce `form.setErrors(data)` + the `_error_message`/`__all__`
      // notifications INLINE (React has no `$confirm.notify` toast). Backend
      // error fields are not on the Milestone type, so access them defensively
      // via a `Record<string, unknown>` view guarded for non-object errors.
      const data: Record<string, unknown> =
        err && typeof err === 'object' ? (err as Record<string, unknown>) : {};

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
    // i18n: LIGHTBOX.DELETE_SPRINT.TITLE = 'Delete sprint' ; message = sprint.name
    const confirmed = window.confirm(`Delete sprint: ${sprint.name}`);
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
    <div className={`lightbox lightbox-sprint-add-edit${open ? ' open' : ''}`}>
      {/* Close control — replaces the `tg-lightbox-close` directive. */}
      <a
        className="close"
        href=""
        title="Close" /* i18n: COMMON.CLOSE */
        onClick={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        {svgIcon('icon-close')}
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
          <h2 className="title">{mode === 'create' ? 'New sprint' : 'Edit Sprint'}</h2>

          {/* General (non-field) error, from `_error_message` / `__all__`. */}
          {generalError && <div className="checksley-error-list">{generalError}</div>}

          <fieldset>
            <input
              className={`sprint-name e2e-sprint-name${errors.name ? ' checksley-error' : ''}`}
              type="text"
              name="name"
              maxLength={500}
              placeholder="sprint name" /* i18n: LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME */
              value={name}
              ref={nameInputRef}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && (
              <ul className="checksley-error-list">
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
                placeholder="Estimated Start" /* i18n: LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START */
                value={estimatedStart}
                onChange={(e) => setEstimatedStart(e.target.value)}
              />
              {errors.estimated_start && (
                <ul className="checksley-error-list">
                  <li>{errors.estimated_start}</li>
                </ul>
              )}
            </div>
            <div>
              <input
                className={`date-end${errors.estimated_finish ? ' checksley-error' : ''}`}
                type="text"
                name="estimated_finish"
                placeholder="Estimated End" /* i18n: LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END */
                value={estimatedFinish}
                onChange={(e) => setEstimatedFinish(e.target.value)}
              />
              {errors.estimated_finish && (
                <ul className="checksley-error-list">
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
              title="Save" /* i18n: COMMON.SAVE */
              disabled={submitting}
            >
              Save
            </button>

            {/* Delete — edit mode only, gated on the delete_milestone permission. */}
            {mode === 'edit' && canDeleteMilestone && (
              <button
                className="btn-link delete-sprint"
                type="button"
                title="delete sprint" /* i18n: LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT */
                onClick={(e) => {
                  e.preventDefault();
                  handleRemove();
                }}
              >
                {svgIcon('icon-trash')}
                <span className="delete-sprint-text">Do you want to delete this sprint?</span>
                {/* i18n: LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT */}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
