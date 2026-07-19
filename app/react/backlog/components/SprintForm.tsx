/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintForm — React port of the AngularJS sprint create/edit lightbox.
 *
 * Controlled component that renders the create/edit sprint lightbox: a close
 * affordance, the sprint-name field, the estimated start/end date fields (each a
 * localized {@link DatePicker}), a submit button, and an edit-only delete button.
 * It is a 1:1 port of the AngularJS markup and the `CreateEditSprint` directive.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - app/partials/includes/modules/lightbox-sprint-add-edit.jade:8-56 — the DOM:
 *    the `tg-lightbox-close` affordance, the `form(ng-if="createEditOpen")`, the
 *    `h2.title`, the `input.sprint-name.e2e-sprint-name` + `label.last-sprint-name`
 *    fieldset, the `fieldset.dates` with `input.date-start` / `input.date-end`,
 *    and the `.sprint-add-edit-actions` submit + `button.btn-link.delete-sprint`
 *    (containing the `icon-trash` svg + `.delete-sprint-text`).
 *  - app/coffee/modules/backlog/lightboxes.coffee:19-221 (CreateEditSprint) — the
 *    create/edit seeding rules (create: start = lastSprint.estimated_finish || today,
 *    finish = base + 2 weeks, both formatted "DD MMM YYYY"; edit: prefill and
 *    reformat the sprint's ISO dates), the `.last-sprint-name` `.html(...)` label
 *    (lightboxes.coffee:172-176) and its `disappear` toggle, and the submit path
 *    (checksley `form.validate()` gate + `moment(...).format("YYYY-MM-DD")`
 *    serialization), reproduced here via `validateSprint` / `serializeSprintDate`.
 *  - app/coffee/modules/common/lightbox.coffee (tgLightboxClose) — the close anchor
 *    template `a.close[href][title=COMMON.CLOSE] > tg-svg(icon-close)`, reproduced
 *    directly in React (F34) because AngularJS never compiles React-created
 *    descendants, so an empty `<tg-lightbox-close>` host would render nothing.
 *
 * PARITY FACT — submit label is ALWAYS "Save" (F36; lightboxes.coffee:183-184,
 * 210-211): the AngularJS directive tries to set the label with
 * `$el.find(".button-green").text(...)`, but the button's classes are
 * `btn-big button-large button-block` (there is NO `.button-green`), so BOTH calls
 * are silent no-ops and the Jade default `translate="COMMON.SAVE"` wins in create
 * AND edit mode. This port reproduces that exact behavior (COMMON.SAVE always) —
 * per the parity mandate, the code is aligned to what the app actually renders, not
 * to the directive's dormant intent. Only the title differs by mode
 * (LIGHTBOX.ADD_EDIT_SPRINT.TITLE vs BACKLOG.EDIT_SPRINT).
 *
 * PARITY TRAP (dates): the date fields hold DISPLAY-format strings ("DD MMM YYYY")
 * exactly as the AngularJS `$('.date-start').val()` reads did; they are converted to
 * the frozen `/api/v1/` "YYYY-MM-DD" format ONLY at submit, via `serializeSprintDate`.
 * The fields are `type="text"` (never `<input type="date">`).
 *
 * Findings addressed here (Backlog sprint lightbox):
 *  - F34: render the REAL close button (not an inert custom-element host).
 *  - F35: real localized calendar via {@link DatePicker} (Pikaday equivalent).
 *  - F36: all copy sourced from the shared i18n runtime; "Save" label preserved.
 *  - F37: deterministic submit lock (validate first; lock only a valid submit;
 *    reset on resolve/reject; disable the submit button while pending).
 *  - F38: accessible dialog — role/aria-modal/aria-labelledby, initial focus,
 *    Escape-to-close, focus trap, focus return, aria-invalid/aria-describedby.
 *  - F48: seed field state ONLY on the open transition or a sprint-identity change
 *    (never on an incidental `initialValues` reference change), and gate the delete
 *    button on edit mode AND the permission.
 *
 * PRESENTATIONAL SPLIT (coexistence boundary): this component owns field state,
 * validation, date serialization, and the dialog lifecycle, but performs NO
 * `/api/v1/` call. On a valid submit it invokes the injected `onSubmit`; the parent
 * `BacklogApp` adds the project/id and calls the milestones API. No event
 * subscriptions and no direct config/session access, keeping the Django contract
 * frozen and the component pure/testable.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; the `checksley` jQuery plugin is
 * NOT imported (its rules live in `sprintValidators`).
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import moment from 'moment';
import {
  validateSprint,
  serializeSprintDate,
  PICKER_DATE_FORMAT,
} from '../../shared/validation/sprintValidators';
import { t } from '../../shared/i18n';
import { escapeHtml } from '../../shared/emojify';
import { DatePicker } from './DatePicker';

/** A sprint identity (matches the backend milestone id shape); used only for F48 sync. */
export type SprintId = string | number;

/**
 * Props for {@link SprintForm}. The `initialValues`, `lastSprintEndDate`,
 * `lastSprintName`, `sprintId` and `canDelete` inputs mirror the `CreateEditSprint`
 * directive's `sprintform:create` / `sprintform:edit` context, while the
 * `onSubmit` / `onClose` / `onDelete` callbacks replace the directive's `$repo`
 * calls and `$rootscope` broadcasts (lightboxes.coffee:62-118) — the parent owns
 * the API/effects.
 */
export interface SprintFormProps {
  /** Whether the lightbox is open (adds the `open` class + renders the form). */
  open: boolean;
  /** 'create' or 'edit' — drives title, delete visibility, and default dates. */
  mode: 'create' | 'edit';
  /**
   * Edit: current sprint values. `name` plus `estimated_start` / `estimated_finish`
   * as ISO 'YYYY-MM-DD' (reformatted to the display format on prefill).
   *
   * F48: the seeding effect reads this via a ref and reseeds ONLY on the open
   * transition or a `sprintId` change, so passing a fresh object every render no
   * longer clobbers in-progress edits.
   */
  initialValues?: { name?: string; estimated_start?: string; estimated_finish?: string };
  /**
   * Identity of the sprint being edited. A change while the lightbox stays open
   * triggers a reseed (F48); omit/keep stable in create mode.
   */
  sprintId?: SprintId;
  /** Create: end date of the last open sprint (ISO 'YYYY-MM-DD') used to seed default dates; omit -> today. */
  lastSprintEndDate?: string | null;
  /** Create: name of the last open sprint -> shown in the `.last-sprint-name` label. */
  lastSprintName?: string | null;
  /** `delete_milestone` permission -> combined with edit mode to show the delete button (F48). */
  canDelete: boolean;
  /**
   * Called with the SERIALIZED payload (dates as 'YYYY-MM-DD'); parent adds
   * project/id and calls the milestones API. May return a promise; the submit lock
   * (F37) is released when it settles (resolve OR reject).
   */
  onSubmit: (values: {
    name: string;
    estimated_start: string;
    estimated_finish: string;
  }) => void | Promise<unknown>;
  /** Close the lightbox (close affordance / Escape / backdrop). */
  onClose: () => void;
  /** Edit: delete this sprint (parent shows the confirm dialog). */
  onDelete?: () => void;
}

/** Focusable-element selector used by the F38 focus trap. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** All tabbable elements currently rendered inside the dialog, in DOM order. */
function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Renders a Taiga sprite icon, reproducing the rendered output of the AngularJS
 * `tgSvg` directive (`tg-svg(svg-icon="...")`). React maps `className` -> `class`;
 * `xlinkHref` renders the SVG 1.1 `xlink:href` attribute while the extra `href`
 * covers SVG 2 / Firefox (the Playwright engine used for the committed evidence).
 */
function Svg({ icon }: { icon: string }) {
  return (
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as Record<string, unknown>)} />
    </svg>
  );
}

/**
 * The sprint create/edit lightbox form. See the module doc comment for the full
 * source mapping (lightbox-sprint-add-edit.jade:8-56 + lightboxes.coffee:19-221).
 */
export function SprintForm(props: SprintFormProps) {
  const {
    open,
    mode,
    initialValues,
    sprintId,
    lastSprintEndDate,
    lastSprintName,
    canDelete,
    onSubmit,
    onClose,
    onDelete,
  } = props;

  // Field state. The date fields hold DISPLAY-format strings ("DD MMM YYYY").
  const [name, setName] = useState('');
  const [estimatedStart, setEstimatedStart] = useState('');
  const [estimatedFinish, setEstimatedFinish] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasErrors, setHasErrors] = useState(false);
  // F37: submit lock. `submitting` drives the disabled UI; `submittingRef` gives a
  // synchronous guard so a rapid second click in the same tick is also ignored.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Stable ids for the dialog label + error descriptions (F38).
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameErrId = `${baseId}-name-err`;
  const startErrId = `${baseId}-start-err`;
  const finishErrId = `${baseId}-finish-err`;

  // Refs for the F38 focus lifecycle and the F48 reseed guards.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // F48: read the volatile create/edit inputs through refs so the seeding effect
  // does NOT depend on their object identity (only on `open` / `sprintId` / `mode`).
  const initialValuesRef = useRef(initialValues);
  initialValuesRef.current = initialValues;
  const lastSprintEndDateRef = useRef(lastSprintEndDate);
  lastSprintEndDateRef.current = lastSprintEndDate;

  // Previous-value trackers that decide whether a reseed is warranted (F48).
  const prevOpenRef = useRef(false);
  const prevSprintIdRef = useRef<SprintId | undefined>(undefined);
  const prevModeRef = useRef<'create' | 'edit' | undefined>(undefined);

  // Seed the fields ONLY when the lightbox opens (false -> true) or the sprint
  // identity/mode changes while open — never on an incidental `initialValues`
  // reference change (F48; reproduces the create/edit `openFn`,
  // lightboxes.coffee:136-215).
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }

    const justOpened = !prevOpenRef.current;
    const sprintChanged = sprintId !== prevSprintIdRef.current;
    const modeChanged = mode !== prevModeRef.current;

    prevOpenRef.current = true;
    prevSprintIdRef.current = sprintId;
    prevModeRef.current = mode;

    if (!justOpened && !sprintChanged && !modeChanged) {
      return;
    }

    const seed = initialValuesRef.current;

    if (mode === 'edit') {
      // EDIT (lightboxes.coffee:190-215): prefill from the sprint and reformat the
      // ISO dates to the display format via `moment(value).format(prettyDate)`.
      setName(seed?.name ?? '');
      setEstimatedStart(seed?.estimated_start ? moment(seed.estimated_start).format(PICKER_DATE_FORMAT) : '');
      setEstimatedFinish(
        seed?.estimated_finish ? moment(seed.estimated_finish).format(PICKER_DATE_FORMAT) : '',
      );
    } else {
      // CREATE (lightboxes.coffee:136-170): start defaults to the last open sprint's
      // finish date (or today when there is none); finish defaults to that base plus
      // two weeks. Both are formatted with the "DD MMM YYYY" display pattern.
      const lastEnd = lastSprintEndDateRef.current;
      setName(seed?.name ?? '');
      const startBase = lastEnd ? moment(lastEnd) : moment();
      const finishBase = (lastEnd ? moment(lastEnd) : moment()).add(2, 'weeks');
      setEstimatedStart(startBase.format(PICKER_DATE_FORMAT));
      setEstimatedFinish(finishBase.format(PICKER_DATE_FORMAT));
    }

    setErrors({});
    setHasErrors(false);
  }, [open, sprintId, mode]);

  // F38: manage focus around the open/close transition. On open, remember the
  // previously-focused element and move focus to the name field. On close, restore
  // focus to where it was.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      nameInputRef.current?.focus();
    } else if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus();
      previouslyFocusedRef.current = null;
    }
  }, [open]);

  // Submit: validate FIRST (a failed validation must NOT lock the form), then lock
  // and serialize. Reproduces the checksley `form.validate()` gate
  // (lightboxes.coffee:46-49): on failure record field errors, flag `hasErrors`
  // (which hides the `.last-sprint-name` label), and abort without the API call.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // F37: ignore duplicate submits while one is in flight (synchronous guard).
    if (submittingRef.current) {
      return;
    }

    const result = validateSprint({
      name,
      estimated_start: estimatedStart,
      estimated_finish: estimatedFinish,
    });

    if (!result.valid) {
      setErrors(result.errors);
      setHasErrors(true);
      return;
    }

    setErrors({});
    setHasErrors(false);

    // F37: lock only a VALID submit. `onSubmit` is invoked SYNCHRONOUSLY (matching
    // the legacy `$repo.save(...)` call in the submit handler); only the lock
    // RELEASE is deferred to when the returned promise settles. When `onSubmit`
    // returns a non-thenable (synchronous/void), the lock is released immediately
    // in the same batched update so no pending state lingers.
    submittingRef.current = true;
    setSubmitting(true);

    const releaseLock = () => {
      submittingRef.current = false;
      setSubmitting(false);
    };

    let submission: unknown;
    try {
      submission = onSubmit({
        name,
        estimated_start: serializeSprintDate(estimatedStart),
        estimated_finish: serializeSprintDate(estimatedFinish),
      });
    } catch {
      // A synchronous throw from the parent must not leave the form locked; the
      // parent surfaces the error itself, so it is swallowed here (parity with the
      // async-rejection handling below).
      releaseLock();
      return;
    }

    if (submission != null && typeof (submission as { then?: unknown }).then === 'function') {
      // Async submit: keep the button disabled until the parent's promise settles,
      // releasing on resolve OR reject. The rejection is swallowed (the parent owns
      // error surfacing) so no unhandled rejection escapes while the lock releases.
      Promise.resolve(submission)
        .catch(() => undefined)
        .finally(releaseLock);
    } else {
      // Synchronous completion: nothing to await, release now.
      releaseLock();
    }
  };

  // Delete: the parent owns the confirm dialog + `$repo.remove` (lightboxes.coffee:
  // 103-118). `type="button"` already prevents form submission; the explicit
  // preventDefault mirrors the directive's `event.preventDefault()`.
  const handleDelete = (event: MouseEvent) => {
    event.preventDefault();
    onDelete?.();
  };

  const handleClose = (event: MouseEvent) => {
    event.preventDefault();
    onClose();
  };

  // F38: Escape closes the dialog; Tab is trapped within it. A DatePicker whose
  // calendar is open stops Escape from reaching here (so Escape closes the calendar
  // first), matching native date-field behavior.
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Title by mode (F36). Submit label is ALWAYS COMMON.SAVE — see the PARITY FACT
  // in the module doc comment (the legacy `.button-green` relabel is a no-op).
  const title = mode === 'create' ? t('LIGHTBOX.ADD_EDIT_SPRINT.TITLE') : t('BACKLOG.EDIT_SPRINT');
  const submitLabel = t('COMMON.SAVE');
  const closeLabel = t('COMMON.CLOSE');
  const placeholderName = t('LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME');
  const placeholderStart = t('LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START');
  const placeholderEnd = t('LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END');

  // F48: delete is shown only in edit mode AND with the permission.
  const deleteVisible = mode === 'edit' && canDelete;

  // `.last-sprint-name` content (lightboxes.coffee:172-176 used `.html(...)`): the
  // interpolated catalog string carries `<strong>` markup, so it is injected as
  // HTML. The interpolated sprint name is HTML-escaped first (React's
  // dangerouslySetInnerHTML has no sanitizer) so a crafted name cannot inject
  // markup — a safety improvement that leaves legitimate names rendering identically.
  const lastSprintHtml =
    mode === 'create' && lastSprintName
      ? t('LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME', { lastSprint: escapeHtml(lastSprintName) })
      : '';

  // `.last-sprint-name` visibility (lightboxes.coffee:188,215,217-221): shown only
  // in create mode when a last sprint exists, the name field is empty, and there are
  // no errors; otherwise the `disappear` class hides it (content is retained).
  const lastSprintVisible =
    mode === 'create' && Boolean(lastSprintName) && name.length === 0 && !hasErrors;

  return (
    <div
      ref={containerRef}
      /*
       * PARITY (Gap 18): the AngularJS backlog.jade hosted this lightbox as
       * `div.lightbox.lightbox-sprint-add-edit(tg-lb-create-edit-sprint)`
       * (pre-migration backlog.jade). The `tg-lb-create-edit-sprint` directive
       * attribute is part of the reproduced DOM contract - the e2e suite selects
       * the sprint lightbox by `[tg-lb-create-edit-sprint].open`, exactly as it
       * selects the bulk lightbox by `[tg-lb-create-bulk-userstories]`. AngularJS
       * 1.x directives cannot `$compile` inside a React tree, so the attribute is
       * rendered as an inert DOM marker for structural parity only.
       */
      {...{ 'tg-lb-create-edit-sprint': '' }}
      className={`lightbox lightbox-sprint-add-edit${open ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={open ? titleId : undefined}
      aria-hidden={open ? undefined : true}
      onKeyDown={handleDialogKeyDown}
    >
      {/* F34: the REAL close button (tgLightboxClose template), not an inert host. */}
      <a
        className="close"
        href=""
        title={closeLabel}
        aria-label={closeLabel}
        onClick={handleClose}
      >
        <Svg icon="icon-close" />
      </a>
      {open ? (
        <form onSubmit={handleSubmit} noValidate>
          <h2 className="title" id={titleId}>
            {title}
          </h2>

          <fieldset>
            <input
              ref={nameInputRef}
              className={`sprint-name e2e-sprint-name${errors.name ? ' checksley-error' : ''}`}
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholderName}
              aria-label={placeholderName}
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? nameErrId : undefined}
            />
            {/* Content set as HTML (matching `.html(...)`); visibility via `disappear`. */}
            <label
              className={`last-sprint-name${lastSprintVisible ? '' : ' disappear'}`}
              dangerouslySetInnerHTML={{ __html: lastSprintHtml }}
            />
            {errors.name ? (
              <ul className="checksley-error-list" id={nameErrId}>
                <li>{errors.name}</li>
              </ul>
            ) : null}
          </fieldset>

          <fieldset className="dates">
            <DatePicker
              className={`date-start${errors.estimated_start ? ' checksley-error' : ''}`}
              name="estimated_start"
              value={estimatedStart}
              onChange={setEstimatedStart}
              placeholder={placeholderStart}
              ariaLabel={placeholderStart}
              ariaRequired
              ariaInvalid={Boolean(errors.estimated_start)}
              ariaDescribedBy={errors.estimated_start ? startErrId : undefined}
            />
            <DatePicker
              className={`date-end${errors.estimated_finish ? ' checksley-error' : ''}`}
              name="estimated_finish"
              value={estimatedFinish}
              onChange={setEstimatedFinish}
              placeholder={placeholderEnd}
              ariaLabel={placeholderEnd}
              ariaRequired
              ariaInvalid={Boolean(errors.estimated_finish)}
              ariaDescribedBy={errors.estimated_finish ? finishErrId : undefined}
            />
            {errors.estimated_start ? (
              <ul className="checksley-error-list" id={startErrId}>
                <li>{errors.estimated_start}</li>
              </ul>
            ) : null}
            {errors.estimated_finish ? (
              <ul className="checksley-error-list" id={finishErrId}>
                <li>{errors.estimated_finish}</li>
              </ul>
            ) : null}
          </fieldset>

          <div className="sprint-add-edit-actions">
            <button
              className="btn-big button-large button-block"
              type="submit"
              title={submitLabel}
              disabled={submitting}
              aria-disabled={submitting || undefined}
            >
              {submitLabel}
            </button>
            {deleteVisible ? (
              <button
                className="btn-link delete-sprint"
                type="button"
                title={t('LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT')}
                onClick={handleDelete}
              >
                <Svg icon="icon-trash" />
                <span className="delete-sprint-text">
                  {t('LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT')}
                </span>
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
