/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import moment from "moment";

/**
 * Maximum allowed length of a sprint name.
 *
 * This is bounded by the FROZEN Django contract: the milestone `name` column is
 * `models.CharField(max_length=200)` (taiga-back
 * `taiga/projects/milestones/models.py` L25), and the serializer applies no
 * override — a name longer than 200 characters is rejected by the backend with
 * an HTTP 400. Per AAP §0.7.1 the client conforms to the frozen backend, so the
 * form validates at 200 to surface the limit up-front rather than round-tripping
 * to a server error.
 *
 * (The legacy checksley input carried a looser client-only `data-maxlength="500"`
 * in app/partials/includes/modules/lightbox-sprint-add-edit.jade L19, but any
 * name in 201–500 was still rejected by the backend; validating at 200 is the
 * contract-correct, user-friendly behavior.)
 */
export const NAME_MAX_LENGTH = 200;

/**
 * Canonical wire/storage date format for sprint dates. The AngularJS lightbox
 * normalized picker values to this format before submit
 * (moment(value, prettyDate).format("YYYY-MM-DD"), lightboxes.coffee L59-60),
 * and the React SprintEditLightbox passes already-normalized "YYYY-MM-DD"
 * strings into validate(). Dates are therefore parsed with this format only.
 */
export const DATE_FORMAT = "YYYY-MM-DD";

// Validation messages. These mirror the checksley/parsley English defaults so
// the rendered copy matches the legacy UI. Exported so SprintEditLightbox and
// the unit tests can reference them without duplicating string literals.
export const REQUIRED_MESSAGE = "This value is required.";
export const MAXLENGTH_MESSAGE =
    "This value is too long. It should have 200 characters or less.";
export const DATE_INVALID_MESSAGE = "This value should be a valid date.";
export const DATE_RANGE_MESSAGE =
    "The start date must be on or before the finish date.";

/**
 * Shape of the sprint (milestone) create/edit form. Dates are "YYYY-MM-DD"
 * strings. `project` is carried through for the create payload but is not
 * validated here (it is supplied programmatically, never by the user).
 */
export interface SprintFormValues {
    name: string;
    estimated_start: string;
    estimated_finish: string;
    project?: number | null;
}

/** Per-field validation error messages. A field key is present iff invalid. */
export interface SprintFormErrors {
    name?: string;
    estimated_start?: string;
    estimated_finish?: string;
}

/** Result of {@link validate}: `valid` is true iff `errors` has no keys. */
export interface SprintFormValidationResult {
    valid: boolean;
    errors: SprintFormErrors;
}

/** True when a value is null/undefined or trims to an empty string. */
const isBlank = (value: unknown): boolean =>
    value === null || value === undefined || String(value).trim().length === 0;

/**
 * Validate the sprint create/edit form. Pure function — no DOM, no network,
 * no React, no side effects.
 *
 * Rules (ported from the checksley data-* attributes + AAP §0.1.1/§0.3.2):
 *  - name: required (whitespace-only counts as empty) and <= NAME_MAX_LENGTH.
 *  - estimated_start: required.
 *  - estimated_finish: required.
 *  - date range: non-inverted (estimated_start <= estimated_finish). An
 *    unparseable/invalid date is an error on its own field; when both dates
 *    parse and start > finish the range error is attached to estimated_finish.
 */
export function validate(values: SprintFormValues): SprintFormValidationResult {
    const errors: SprintFormErrors = {};

    // name: required + maxlength (data-required + the frozen backend's 200-char limit)
    const name = values.name;
    if (isBlank(name)) {
        errors.name = REQUIRED_MESSAGE;
    } else if (name.length > NAME_MAX_LENGTH) {
        errors.name = MAXLENGTH_MESSAGE;
    }

    // estimated_start / estimated_finish: required (mirrors data-required)
    const startBlank = isBlank(values.estimated_start);
    const finishBlank = isBlank(values.estimated_finish);

    if (startBlank) {
        errors.estimated_start = REQUIRED_MESSAGE;
    }
    if (finishBlank) {
        errors.estimated_finish = REQUIRED_MESSAGE;
    }

    // Strict-parse present dates. moment(..., true) rejects malformed strings.
    const start = startBlank
        ? null
        : moment(values.estimated_start, DATE_FORMAT, true);
    const finish = finishBlank
        ? null
        : moment(values.estimated_finish, DATE_FORMAT, true);

    if (start !== null && !start.isValid()) {
        errors.estimated_start = DATE_INVALID_MESSAGE;
    }
    if (finish !== null && !finish.isValid()) {
        errors.estimated_finish = DATE_INVALID_MESSAGE;
    }

    // Non-inverted range: estimated_start <= estimated_finish. Equal is valid
    // (isAfter is false for equal moments). Error attaches to estimated_finish.
    if (
        start !== null &&
        finish !== null &&
        start.isValid() &&
        finish.isValid() &&
        start.isAfter(finish)
    ) {
        errors.estimated_finish = DATE_RANGE_MESSAGE;
    }

    return { valid: Object.keys(errors).length === 0, errors };
}
