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
 * Presentational (controlled) component that renders the create/edit sprint
 * lightbox form: the sprint name field, the estimated start/end date fields, a
 * submit button, and (edit-only) a delete button. It is a direct 1:1 port of the
 * AngularJS markup and the `CreateEditSprint` directive.
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
 *    finish = start-base + 2 weeks, both formatted "DD MMM YYYY"; edit: prefill and
 *    reformat the sprint's ISO dates to the display format), the `.last-sprint-name`
 *    `disappear` toggle (hidden when the name is non-empty OR there are errors), and
 *    the submit path (checksley `form.validate()` gate + `moment(...).format(
 *    "YYYY-MM-DD")` serialization), reproduced here via `validateSprint` /
 *    `serializeSprintDate`.
 *
 * PARITY QUIRK (do the RIGHT thing — lightboxes.coffee:183-184,210-211): the
 * AngularJS directive tries to set the submit label with `$el.find(".button-green")
 * .text(...)`, but the button has classes `btn-big button-large button-block` (NO
 * `.button-green`), so that call is a silent no-op and the button keeps its Jade
 * default "Save" translation in BOTH modes — a latent bug. This port implements the
 * directive's clear intent instead: the submit label is "Create" in create mode and
 * "Save" in edit mode.
 *
 * PARITY TRAP (dates): the date fields hold DISPLAY-format strings ("DD MMM YYYY")
 * exactly as the AngularJS `$('.date-start').val()` reads did; they are converted to
 * the frozen `/api/v1/` "YYYY-MM-DD" format ONLY at submit, via `serializeSprintDate`.
 * The inputs are therefore `type="text"` (never `<input type="date">`, which would
 * change the value format and the appearance).
 *
 * PRESENTATIONAL SPLIT (coexistence boundary): this component owns field state,
 * validation, and date serialization, but performs NO `/api/v1/` call. On a valid
 * submit it invokes the injected `onSubmit(serializedValues)`; the parent
 * `BacklogApp` adds the project/id and calls the milestones API. There are no event
 * subscriptions and no direct DOM/config/session access, keeping the Django contract
 * frozen and the component pure/testable.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; the `checksley` jQuery plugin is
 * NOT imported (its rules live in `sprintValidators`).
 */

import { useState, useEffect } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import moment from 'moment';
import {
  validateSprint,
  serializeSprintDate,
  PICKER_DATE_FORMAT,
} from '../../shared/validation/sprintValidators';

/**
 * Props for {@link SprintForm}. The `initialValues`, `lastSprintEndDate`,
 * `lastSprintName` and `canDelete` inputs mirror the `CreateEditSprint` directive's
 * `sprintform:create` / `sprintform:edit` context, while the `onSubmit` / `onClose`
 * / `onDelete` callbacks replace the directive's `$repo` calls and `$rootscope`
 * broadcasts (lightboxes.coffee:62-118) — the parent owns the API/effects.
 */
export interface SprintFormProps {
  /** Whether the lightbox is open (adds the `open` class + renders the form). */
  open: boolean;
  /** 'create' or 'edit' — drives title, submit label, delete visibility, and default dates. */
  mode: 'create' | 'edit';
  /**
   * Edit: current sprint values. `name` plus `estimated_start` / `estimated_finish`
   * as ISO 'YYYY-MM-DD' (reformatted to the display format on prefill).
   *
   * NOTE: the seeding effect depends on this object by reference. If the parent
   * passes a fresh object every render it will clobber in-progress user edits, so
   * `BacklogApp` should memoize `initialValues` or `key` this component by sprint id.
   */
  initialValues?: { name?: string; estimated_start?: string; estimated_finish?: string };
  /** Create: end date of the last open sprint (ISO 'YYYY-MM-DD') used to seed default dates; omit -> today. */
  lastSprintEndDate?: string | null;
  /** Create: name of the last open sprint -> shown in the `.last-sprint-name` label. */
  lastSprintName?: string | null;
  /** Edit + `delete_milestone` permission -> show the delete button. */
  canDelete: boolean;
  /** Called with the SERIALIZED payload (dates as 'YYYY-MM-DD'); parent adds project/id and calls the milestones API. */
  onSubmit: (values: { name: string; estimated_start: string; estimated_finish: string }) => void;
  /** Close the lightbox (tg-lightbox-close / X). */
  onClose: () => void;
  /** Edit: delete this sprint (parent shows the confirm dialog). */
  onDelete?: () => void;
}

/**
 * Module-local reference to the AngularJS `<tg-lightbox-close>` custom-element host
 * (lightbox-sprint-add-edit.jade:8). React owns the entire subtree inside
 * `<tg-react-backlog>`, so it reproduces the host tag and wires the close callback;
 * the visible "X" glyph and its positioning come from the global directive/SCSS.
 *
 * The `as unknown as any` cast lets the custom-element tag be used in JSX without a
 * cross-file `declare global { namespace JSX }` augmentation, matching the pattern
 * already established by the sibling React components.
 */
const TgLightboxClose = 'tg-lightbox-close' as unknown as any;

/**
 * Renders a Taiga sprite icon, reproducing the rendered output of the AngularJS
 * `tgSvg` directive used by `tg-svg(svg-icon="icon-trash")` in the Jade source.
 * React maps `className` -> `class`; `xlinkHref` renders the SVG 1.1 `xlink:href`
 * attribute while the extra `href` covers SVG 2 / Firefox (the Playwright engine
 * used for the committed visual evidence).
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

  // Seed the fields whenever the lightbox opens, reproducing the create/edit
  // `openFn` logic (lightboxes.coffee:136-215). Guard on `open` so the effect only
  // seeds when the lightbox is shown (mirrors the `createEditOpen` gate).
  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === 'edit') {
      // EDIT (lightboxes.coffee:190-215): prefill from the sprint and reformat the
      // ISO dates to the display format via `moment(value).format(prettyDate)`.
      const startIso = initialValues?.estimated_start;
      const finishIso = initialValues?.estimated_finish;
      setName(initialValues?.name ?? '');
      setEstimatedStart(startIso ? moment(startIso).format(PICKER_DATE_FORMAT) : '');
      setEstimatedFinish(finishIso ? moment(finishIso).format(PICKER_DATE_FORMAT) : '');
    } else {
      // CREATE (lightboxes.coffee:136-170): start defaults to the last open sprint's
      // finish date (or today when there is none); finish defaults to that base plus
      // two weeks. Both are formatted with the "DD MMM YYYY" display pattern.
      setName(initialValues?.name ?? '');
      const startBase = lastSprintEndDate ? moment(lastSprintEndDate) : moment();
      const finishBase = (lastSprintEndDate ? moment(lastSprintEndDate) : moment()).add(2, 'weeks');
      setEstimatedStart(startBase.format(PICKER_DATE_FORMAT));
      setEstimatedFinish(finishBase.format(PICKER_DATE_FORMAT));
    }

    setErrors({});
    setHasErrors(false);
    // `initialValues` is intentionally a dependency; see the SprintFormProps note
    // about memoizing it in the parent to avoid clobbering in-progress edits.
  }, [open, mode, initialValues, lastSprintEndDate]);

  // Submit: validate -> serialize -> onSubmit. Reproduces the checksley
  // `form.validate()` gate (lightboxes.coffee:46-49): on failure record the field
  // errors, flag `hasErrors` (which hides the `.last-sprint-name` label), and abort
  // without invoking the injected API callback.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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
    onSubmit({
      name,
      estimated_start: serializeSprintDate(estimatedStart),
      estimated_finish: serializeSprintDate(estimatedFinish),
    });
  };

  // Delete: the parent owns the confirm dialog + `$repo.remove` (lightboxes.coffee:
  // 103-118). `type="button"` on the element already prevents form submission; the
  // explicit preventDefault mirrors the directive's `event.preventDefault()`.
  const handleDelete = (event: MouseEvent) => {
    event.preventDefault();
    onDelete?.();
  };

  const handleClose = (event: MouseEvent) => {
    event.preventDefault();
    onClose();
  };

  // Title + submit label by mode. The submit label OVERRIDES the AngularJS
  // `.button-green` no-op (see the module doc comment): "Create" vs "Save".
  const title = mode === 'create' ? 'New sprint' : 'Edit Sprint';
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  // `.last-sprint-name` visibility (lightboxes.coffee:188,215,217-221): shown only in
  // create mode when a last sprint exists, the name field is empty, and there are no
  // errors; otherwise the `disappear` class hides it.
  const lastSprintVisible =
    mode === 'create' && Boolean(lastSprintName) && name.length === 0 && !hasErrors;

  return (
    <div className={`lightbox lightbox-sprint-add-edit${open ? ' open' : ''}`}>
      <TgLightboxClose onClick={handleClose} />
      {open ? (
        <form onSubmit={handleSubmit}>
          <h2 className="title">{title}</h2>

          <fieldset>
            <input
              className={`sprint-name e2e-sprint-name${errors.name ? ' checksley-error' : ''}`}
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sprint name"
            />
            <label className={`last-sprint-name${lastSprintVisible ? '' : ' disappear'}`}>
              {mode === 'create' && lastSprintName ? (
                <>
                  last sprint is <strong> {lastSprintName} ;-) </strong>
                </>
              ) : null}
            </label>
            {errors.name ? (
              <ul className="checksley-error-list">
                <li>{errors.name}</li>
              </ul>
            ) : null}
          </fieldset>

          <fieldset className="dates">
            <div>
              <input
                className={`date-start${errors.estimated_start ? ' checksley-error' : ''}`}
                type="text"
                name="estimated_start"
                value={estimatedStart}
                onChange={(e) => setEstimatedStart(e.target.value)}
                placeholder="Estimated Start"
              />
            </div>
            <div>
              <input
                className={`date-end${errors.estimated_finish ? ' checksley-error' : ''}`}
                type="text"
                name="estimated_finish"
                value={estimatedFinish}
                onChange={(e) => setEstimatedFinish(e.target.value)}
                placeholder="Estimated End"
              />
            </div>
            {errors.estimated_start ? (
              <ul className="checksley-error-list">
                <li>{errors.estimated_start}</li>
              </ul>
            ) : null}
            {errors.estimated_finish ? (
              <ul className="checksley-error-list">
                <li>{errors.estimated_finish}</li>
              </ul>
            ) : null}
          </fieldset>

          <div className="sprint-add-edit-actions">
            <button className="btn-big button-large button-block" type="submit" title={submitLabel}>
              {submitLabel}
            </button>
            {canDelete ? (
              <button
                className="btn-link delete-sprint"
                type="button"
                title="delete sprint"
                onClick={handleDelete}
              >
                <Svg icon="icon-trash" />
                <span className="delete-sprint-text">Do you want to delete this sprint?</span>
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
