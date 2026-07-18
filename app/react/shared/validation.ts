/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Hand-written, framework-agnostic validation for the sprint (milestone)
 * create/edit lightbox of the migrated React Backlog screen.
 *
 * WHY THIS EXISTS
 *   The legacy AngularJS lightbox validated its form with **checksley**
 *   (`app/coffee/modules/backlog/lightboxes.coffee:44-49`): it built the empty
 *   `newSprint = { project, name, estimated_start, estimated_finish }` object
 *   (`:31-36`, all fields initialised `null`) and blocked submit unless the
 *   checksley form validated, with the `name`, `estimated_start` and
 *   `estimated_finish` inputs marked *required* (`project` is populated from
 *   context and is never user-validated — `:148`). On submit the two date
 *   fields were normalised to the backend `YYYY-MM-DD` wire format with
 *   `moment(value, prettyDate).format("YYYY-MM-DD")` (`:59-60,66-67`), where
 *   `prettyDate` is the localised picker format
 *   (`$translate.instant("COMMON.PICKERDATE.FORMAT")`).
 *
 *   checksley stays installed for the 14 out-of-scope AngularJS screens, but it
 *   MUST NOT be imported by the React screens. This module is the
 *   React-internal replacement: pure functions that reproduce the checksley
 *   *required* rules and the moment date normalisation EXACTLY, with no
 *   AngularJS, no DOM, no `window`, and no external dependency other than
 *   `moment` (a retained dependency used here solely for date formatting).
 *
 *   Consumed by `../backlog/components/CreateEditSprintLightbox.tsx`.
 *
 * PARITY NOTE (behaviour must not change)
 *   The AngularJS form enforced *required* and nothing else — it never checked
 *   that `estimated_finish` fell on or after `estimated_start`. To preserve
 *   exact behavioural parity (the migration adds no behaviour), NO date-ordering
 *   rule is implemented here; only the three required-field checks are
 *   reproduced. A whitespace-only value is treated as blank, matching the intent
 *   of a *required* field.
 */

import moment from 'moment';

import type { SprintFormValues } from './types';

/**
 * The neutral, machine-readable error code emitted for a failed *required*
 * check. Kept intentionally short and display-agnostic: the presentation layer
 * (the lightbox component) maps this code to the user-facing, translated
 * message, exactly as checksley's messages were supplied by the template rather
 * than by the validator itself.
 */
const REQUIRED_ERROR = 'required';

/**
 * `true` when `value` is absent or contains only whitespace once coerced to a
 * string. This is the single source of truth for the *required* rule and mirrors
 * the AngularJS `name` check (`String(values.name ?? '').trim()` must be
 * non-empty); it is applied uniformly to the three required sprint fields.
 *
 * @param value An arbitrary field value (`string | null` in practice).
 * @returns `true` when the coerced, trimmed value is empty.
 */
function isBlank(value: unknown): boolean {
    return String(value ?? '').trim().length === 0;
}

/**
 * Per-field validation errors for the sprint form. A field key is present ONLY
 * when that field failed validation; its value is a neutral error code (see
 * {@link REQUIRED_ERROR}). `project` is intentionally absent because it is set
 * from context and never user-validated (`lightboxes.coffee:31-36,148`).
 */
export interface SprintFormErrors {
    /** Present with a neutral code when `name` failed the *required* check. */
    name?: string;
    /** Present with a neutral code when `estimated_start` failed *required*. */
    estimated_start?: string;
    /** Present with a neutral code when `estimated_finish` failed *required*. */
    estimated_finish?: string;
}

/**
 * The result of validating a sprint form: `valid` is `true` only when there are
 * no field errors, and `errors` carries the per-field codes for the fields that
 * failed (an empty object when `valid` is `true`).
 */
export interface SprintValidationResult {
    /** `true` when every required field is present. */
    valid: boolean;
    /** The failing fields; empty when `valid` is `true`. */
    errors: SprintFormErrors;
}

/**
 * Validate the sprint create/edit form, reproducing the legacy checksley
 * *required* rules exactly (`lightboxes.coffee:44-49`).
 *
 * `name`, `estimated_start` and `estimated_finish` are required (blank or
 * whitespace-only values fail); `project` is not validated because it is
 * assigned from context. No date-ordering constraint is applied — the AngularJS
 * form did not enforce one, and this migration preserves behaviour exactly.
 *
 * The function is pure: it neither reads nor mutates any external state and only
 * builds error entries for the fields that actually fail.
 *
 * @param values The current editable sprint form values.
 * @returns A {@link SprintValidationResult}: the overall `valid` flag plus the
 *          per-field {@link SprintFormErrors} (containing only failing fields).
 */
export function validateSprintForm(values: SprintFormValues): SprintValidationResult {
    const errors: SprintFormErrors = {};

    if (isBlank(values.name)) {
        errors.name = REQUIRED_ERROR;
    }

    if (isBlank(values.estimated_start)) {
        errors.estimated_start = REQUIRED_ERROR;
    }

    if (isBlank(values.estimated_finish)) {
        errors.estimated_finish = REQUIRED_ERROR;
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors,
    };
}

/**
 * Normalise a picker date value to the backend `YYYY-MM-DD` wire format, exactly
 * as the AngularJS lightbox did before POST/PATCH
 * (`lightboxes.coffee:59-60,66-67`: `moment(value, prettyDate).format("YYYY-MM-DD")`).
 *
 * @param value       The raw date value from the picker. A `string` in the
 *                    localised picker format is the case the AngularJS code
 *                    exercised; `Date` is additionally accepted for React
 *                    callers that hold a native date. Falsy values
 *                    (`null` / `undefined` / empty string) yield `null`.
 * @param inputFormat The localised picker format used to parse a `string`
 *                    value, equivalent to the legacy `prettyDate`
 *                    (`$translate.instant("COMMON.PICKERDATE.FORMAT")`). When
 *                    omitted, moment falls back to its default (ISO-8601)
 *                    parsing.
 * @returns The date formatted as `YYYY-MM-DD`, or `null` when `value` is falsy.
 */
export function formatSprintDate(
    value: string | Date | null | undefined,
    inputFormat?: string,
): string | null {
    return value ? moment(value, inputFormat).format('YYYY-MM-DD') : null;
}
