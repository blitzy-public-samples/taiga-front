/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Pure, framework-agnostic validation for the sprint (milestone) create/edit
 * form. Reproduces the AngularJS `checksley` rules that were declared as
 * `data-*` attributes on `app/partials/includes/modules/lightbox-sprint-add-edit.jade`
 * and enforced by `app/coffee/modules/backlog/lightboxes.coffee` (L44, L237):
 *
 *   - name             -> data-required="true", data-maxlength="500"
 *   - estimated_start  -> data-required="true"
 *   - estimated_finish -> data-required="true"
 *
 * These are the ONLY rules the legacy form enforced. In particular there is NO
 * cross-field `finish >= start` rule: the recovered legacy template
 * (`lightbox-sprint-add-edit.jade`) declares only `data-required` on both date
 * inputs, and `lightboxes.coffee` runs `form.checksley().validate()` with no
 * custom comparator. An earlier React version added a `finish >= start` check
 * that the legacy checksley does not prove; per finding M3 (and the Minimal
 * Change Clause) it has been REMOVED so validation matches the authoritative
 * contract exactly.
 *
 * NO React, NO AngularJS, NO DOM, NO date library. Pure & deterministic
 * (never reads `Date.now()`): every result depends solely on the inputs.
 */

/** Maximum allowed length for the sprint name (checksley `data-maxlength="500"`). */
export const SPRINT_NAME_MAX_LENGTH = 500;

/** Raw values collected from the sprint create/edit form. */
export interface SprintFormValues {
  name: string;
  estimated_start: string; // "YYYY-MM-DD" (empty string = unset)
  estimated_finish: string; // "YYYY-MM-DD" (empty string = unset)
}

/** Per-field validation messages. An absent key means that field is valid. */
export interface SprintFormErrors {
  name?: string;
  estimated_start?: string;
  estimated_finish?: string;
}

/** Coerce a possibly-nullish form value into a string (defensive, pure). */
function asString(value: string | null | undefined): string {
  return value == null ? "" : value;
}

/**
 * Validate the sprint form values, returning ONLY the keys that have errors.
 * An empty object (`{}`) means the form is valid.
 */
export function validateSprintForm(values: SprintFormValues): SprintFormErrors {
  const errors: SprintFormErrors = {};

  const name: string = asString(values.name);
  const startTrimmed: string = asString(values.estimated_start).trim();
  const finishTrimmed: string = asString(values.estimated_finish).trim();

  // name: required (non-empty after trim), then max length 500.
  if (name.trim().length === 0) {
    errors.name = "Name is required";
  } else if (name.length > SPRINT_NAME_MAX_LENGTH) {
    errors.name = "Name is too long";
  }

  // estimated_start: required.
  if (startTrimmed.length === 0) {
    errors.estimated_start = "Estimated start is required";
  }

  // estimated_finish: required. (No cross-field finish>=start rule — the legacy
  // checksley only declared `data-required`; see the module note above, M3.)
  if (finishTrimmed.length === 0) {
    errors.estimated_finish = "Estimated finish is required";
  }

  return errors;
}

/** Convenience predicate: `true` when the form has no validation errors. */
export function isSprintFormValid(values: SprintFormValues): boolean {
  return Object.keys(validateSprintForm(values)).length === 0;
}
