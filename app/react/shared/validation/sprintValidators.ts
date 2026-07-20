/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * sprintValidators
 * ----------------
 * Hand-written, pure TypeScript re-implementation of the AngularJS sprint
 * add/edit lightbox validation (`app/coffee/modules/backlog/lightboxes.coffee`)
 * and its `moment` date serialization.
 *
 * TECHNOLOGY MIGRATION NOTE (AngularJS 1.5.10 -> React 18 coexistence):
 * This module REPLACES the `checksley` jQuery plugin that gated submission of
 * the sprint form (`$el.find("form").checksley().validate()` in
 * `CreateEditSprint`), together with the `moment(...).format("YYYY-MM-DD")`
 * serialization performed in the same directive. `checksley` deliberately
 * REMAINS in package.json for the out-of-scope AngularJS screens (AAP
 * 0.2.2 / 0.5.2), but MUST NOT be imported or referenced by any React code.
 *
 * COEXISTENCE BOUNDARY (globals-only): this file has NO AngularJS/CoffeeScript
 * imports, performs NO DOM access, reads NO globals (`window`/`localStorage`),
 * issues NO network calls, and has NO side effects. It is a leaf of pure
 * functions plus constants/types, which makes it trivially unit-testable and
 * reusable by both the sprint create and edit flows. The single permitted
 * dependency is the retained npm package `moment`.
 *
 * Behavioral parity is EXACT: only the three rules declared on the Jade form
 * inputs (`app/partials/includes/modules/lightbox-sprint-add-edit.jade`) are
 * reproduced. No rule is added, removed, or "improved" — in particular there is
 * intentionally NO "finish must be after start" rule, because the AngularJS
 * source declares none.
 */

// `moment` ships its own type definitions, so `@types/moment` is intentionally
// NOT added. The default import relies on `esModuleInterop` /
// `allowSyntheticDefaultImports` in the shared tsconfig.json, which is already
// mandatory across app/react/** (sibling files use `import React from 'react'`,
// and @types/react uses `export =`), so this default import is safe here.
import moment from 'moment';

// i18n is the single source of truth for the user-facing validation messages
// and the picker date format, exactly as the AngularJS source resolved them via
// `$translate.instant(...)` at runtime (lightboxes.coffee:41,147). Sourcing them
// here (rather than inlining English) means a localized catalog installed via
// configureI18n() is honored, and the outgoing date serialization uses the
// active locale's `COMMON.PICKERDATE.FORMAT` — preserving parity with the
// AngularJS non-strict `moment(value, prettyDate)` parse under any locale.
import { t, getDateFormat } from '../i18n';

/**
 * Maximum allowed length of the sprint name. Mirrors `data-maxlength="500"` on
 * the `input.sprint-name` element in the sprint add/edit lightbox template.
 */
export const SPRINT_NAME_MAX_LENGTH = 500;

/**
 * English FALLBACK display date format for the sprint date pickers. Mirrors the
 * `en` value of the translated `COMMON.PICKERDATE.FORMAT` key ("DD MMM YYYY",
 * e.g. "23 Mar 1984").
 *
 * NOTE: this constant is only a fallback. The AUTHORITATIVE picker format is the
 * one resolved from i18n at runtime via `getDateFormat()` (= the active locale's
 * `COMMON.PICKERDATE.FORMAT`), exactly as `lightboxes.coffee` did with
 * `$translate.instant("COMMON.PICKERDATE.FORMAT")` (lightboxes.coffee:41,147).
 * `serializeSprintDate` therefore defaults to `getDateFormat()`, not to this
 * constant, so a localized catalog is honored. The constant is retained for
 * callers that need a static English default (e.g. initial display formatting).
 */
export const PICKER_DATE_FORMAT = 'DD MMM YYYY';

/**
 * Serialized date format sent to the frozen `/api/v1/` milestones endpoints.
 * Reproduces `moment(...).format("YYYY-MM-DD")` from `lightboxes.coffee` so the
 * outgoing milestone payload is byte-identical to the AngularJS request
 * (AAP 0.7 backend-contract-freeze goal).
 */
export const API_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * User-facing validation messages, resolved from i18n at call time so a
 * localized catalog installed via `configureI18n()` is honored (F23). These
 * reproduce the checksley messages the AngularJS form rendered:
 *   - required  -> COMMON.FORM_ERRORS.REQUIRED  ("This value is required.")
 *   - maxLength -> COMMON.FORM_ERRORS.MAX_LENGTH ("... %s characters or less.")
 *
 * checksley substituted the numeric limit into the `%s` placeholder of the
 * MAX_LENGTH string; `maxLength(max)` reproduces that single substitution
 * exactly (only the FIRST `%s` is replaced, matching checksley's behavior), so
 * the rendered English message is byte-identical to the pre-migration output.
 */
export const SPRINT_VALIDATION_MESSAGES = {
    required: (): string => t('COMMON.FORM_ERRORS.REQUIRED'),
    maxLength: (max: number): string =>
        t('COMMON.FORM_ERRORS.MAX_LENGTH').replace('%s', String(max)),
};

/**
 * Raw sprint-form values as held by the picker inputs. The field keys match the
 * `name=` attributes on the Jade form inputs and the `newSprint` object shape
 * in `lightboxes.coffee` (`name`, `estimated_start`, `estimated_finish`).
 *
 * The date fields hold DISPLAY-format strings (e.g. "23 Mar 1984"), exactly as
 * the AngularJS `$('.date-start').val()` / `$('.date-end').val()` reads did.
 */
export interface SprintFormValues {
    name?: string | null;
    estimated_start?: string | null; // display-format string (e.g. "23 Mar 1984")
    estimated_finish?: string | null; // display-format string
}

/**
 * Result of validating a sprint form. `errors` is keyed by field name
 * (`name` | `estimated_start` | `estimated_finish`) and contains an entry only
 * for each failing field, so the React `SprintForm` can render each message
 * exactly where the checksley error appeared, preserving visual parity.
 */
export interface SprintValidationResult {
    valid: boolean;
    errors: Record<string, string>;
}

/**
 * Validate the sprint `name` field. Reproduces the checksley `data-required`
 * and `data-maxlength="500"` rules declared on `input.sprint-name`.
 *
 * Ordering matches checksley: `required` is evaluated BEFORE `maxlength`.
 * Returns the message string on failure, or `null` when the value is valid.
 */
export function validateName(name?: string | null): string | null {
    // Coerce defensively to a string. checksley does NOT trim, so a
    // whitespace-only value passes `required` (parity with AngularJS); null /
    // undefined collapse to '' so the length checks below are uniform.
    const value = name == null ? '' : String(name);

    // data-required="true": invalid only when the value is empty (length 0).
    if (value.length === 0) {
        return SPRINT_VALIDATION_MESSAGES.required();
    }

    // data-maxlength="500": invalid when the value exceeds the limit.
    if (value.length > SPRINT_NAME_MAX_LENGTH) {
        return SPRINT_VALIDATION_MESSAGES.maxLength(SPRINT_NAME_MAX_LENGTH);
    }

    return null;
}

/**
 * Validate a required sprint date field (`estimated_start` / `estimated_finish`).
 * The Jade inputs declare ONLY `data-required="true"` — there is deliberately NO
 * date-format or range validation here, matching the AngularJS source exactly.
 *
 * Returns the `required` message on empty input, or `null` when a value is
 * present.
 */
export function validateRequiredDate(value?: string | null): string | null {
    // Coerce without trimming (checksley parity), identical semantics to the
    // `required` check in validateName.
    const coerced = value == null ? '' : String(value);

    if (coerced.length === 0) {
        return SPRINT_VALIDATION_MESSAGES.required();
    }

    return null;
}

/**
 * Aggregate validator — the contract entry point consumed by the React
 * `SprintForm`. Runs the per-field validators and reproduces the checksley
 * `form.validate()` gate from `lightboxes.coffee:46`: submission is blocked
 * (`valid === false`) when ANY field fails.
 *
 * `errors` holds an entry ONLY for failing fields, keyed by field name, so
 * fully valid input yields `{ valid: true, errors: {} }`.
 */
export function validateSprint(form: SprintFormValues): SprintValidationResult {
    const errors: Record<string, string> = {};

    const nameError = validateName(form.name);
    if (nameError !== null) {
        errors.name = nameError;
    }

    const startError = validateRequiredDate(form.estimated_start);
    if (startError !== null) {
        errors.estimated_start = startError;
    }

    const finishError = validateRequiredDate(form.estimated_finish);
    if (finishError !== null) {
        errors.estimated_finish = finishError;
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors,
    };
}

/**
 * Serialize a single picker date string to the frozen `/api/v1/` format.
 * Reproduces `moment(value, prettyDate).format("YYYY-MM-DD")` from
 * `lightboxes.coffee:59-60` / `:66-67`, where `prettyDate` was resolved at
 * runtime from `$translate.instant("COMMON.PICKERDATE.FORMAT")`.
 *
 * `displayFormat` DEFAULTS to `getDateFormat()` (the active locale's picker
 * format from i18n, F23), so a localized catalog parses the picker input with
 * the same format the picker rendered it in. Callers MAY still pass an explicit
 * format to override. The default is evaluated per-call, so a locale change
 * between calls is honored.
 *
 * The parse is the 2-argument, NON-STRICT `moment(value, displayFormat)` call
 * (matching the AngularJS non-strict call), so lenient picker input is accepted
 * exactly as it was before the migration.
 *
 * Empty / nullish input returns '' defensively: serialization is only reached
 * after `required` passes on the happy path, but this guard prevents emitting
 * moment's "Invalid date" sentinel string into an outgoing milestone payload.
 */
export function serializeSprintDate(
    value: string | null | undefined,
    displayFormat: string = getDateFormat(),
): string {
    if (value == null || value === '') {
        return '';
    }

    return moment(value, displayFormat).format(API_DATE_FORMAT);
}
