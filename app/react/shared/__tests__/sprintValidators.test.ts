/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * sprintValidators.test.ts
 * ------------------------
 * Browserless Jest + TypeScript unit spec for the pure sprint-form validators
 * in `../validation/sprintValidators.ts`.
 *
 * TECHNOLOGY MIGRATION NOTE (AngularJS 1.5.10 -> React 18 coexistence):
 * The module under test re-implements the `checksley` jQuery validation and the
 * `moment(...).format("YYYY-MM-DD")` serialization that gated the AngularJS
 * sprint add/edit lightbox (`app/coffee/modules/backlog/lightboxes.coffee`).
 * These specs lock in EXACT behavioral parity with that source: `required` is
 * evaluated before `maxlength`, the name limit is 500 characters, values are
 * NOT trimmed, and there is intentionally NO "finish must be after start" rule
 * (the AngularJS source declares none).
 *
 * TEST-LAYER ISOLATION (AAP 0.6.2 hard requirement): this spec is part of the
 * Jest layer that runs via `npm test`. It imports ONLY the module under test
 * (whose single dependency is the real, installed `moment` package — NOT
 * mocked). It performs NO DOM access, opens NO network connection, launches NO
 * browser, and imports NO Playwright and NO AngularJS/CoffeeScript code. The
 * jest globals (`describe`, `it`, `expect`) are ambient via `@types/jest` in the
 * shared tsconfig, so no test-framework import is required.
 */

import {
    validateName,
    validateRequiredDate,
    validateSprint,
    serializeSprintDate,
    SPRINT_VALIDATION_MESSAGES,
    SPRINT_NAME_MAX_LENGTH,
} from '../validation/sprintValidators';

// Convenience aliases for the exact, verbatim messages the validators emit.
// Referencing the exported constant (rather than re-typing the literals in
// every assertion) guarantees these specs track the module's source of truth.
const REQUIRED_MESSAGE = SPRINT_VALIDATION_MESSAGES.required;
const MAX_LENGTH_MESSAGE = SPRINT_VALIDATION_MESSAGES.maxLength(SPRINT_NAME_MAX_LENGTH);

describe('sprintValidators', () => {
    // -------------------------------------------------------------------------
    // validateName — reproduces `data-required` + `data-maxlength="500"` on
    // `input.sprint-name`, with `required` checked BEFORE `maxlength`.
    // -------------------------------------------------------------------------
    describe('validateName', () => {
        it('returns the required message for an empty string', () => {
            expect(validateName('')).toBe(REQUIRED_MESSAGE);
        });

        it('returns the required message for undefined (coerced to "")', () => {
            expect(validateName(undefined)).toBe(REQUIRED_MESSAGE);
        });

        it('returns the required message for null (coerced to "")', () => {
            // `null` collapses to '' exactly like `undefined`; this exercises the
            // second half of the `name == null` coercion branch.
            expect(validateName(null)).toBe(REQUIRED_MESSAGE);
        });

        it('returns the max-length message when the name exceeds 500 characters', () => {
            const tooLong = 'a'.repeat(SPRINT_NAME_MAX_LENGTH + 1); // 501 chars
            expect(validateName(tooLong)).toBe(MAX_LENGTH_MESSAGE);
        });

        it('accepts a name of exactly 500 characters (boundary is inclusive)', () => {
            // 500 is NOT greater than the limit, so the boundary value is valid.
            const atLimit = 'a'.repeat(SPRINT_NAME_MAX_LENGTH); // 500 chars
            expect(validateName(atLimit)).toBeNull();
        });

        it('accepts a normal, non-empty name', () => {
            expect(validateName('Sprint 1')).toBeNull();
        });

        it('does NOT trim: a whitespace-only value passes the required check', () => {
            // checksley parity — whitespace-only input has non-zero length, so it
            // is considered present and passes `required` (returns null).
            expect(validateName('   ')).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // validateRequiredDate — reproduces the sole `data-required` rule on both
    // date inputs (no format / range validation, matching the source exactly).
    // -------------------------------------------------------------------------
    describe('validateRequiredDate', () => {
        it('returns the required message for an empty string', () => {
            expect(validateRequiredDate('')).toBe(REQUIRED_MESSAGE);
        });

        it('returns the required message for null', () => {
            expect(validateRequiredDate(null)).toBe(REQUIRED_MESSAGE);
        });

        it('returns the required message for undefined', () => {
            expect(validateRequiredDate(undefined)).toBe(REQUIRED_MESSAGE);
        });

        it('accepts a present (display-format) date string', () => {
            expect(validateRequiredDate('23 Mar 1984')).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // validateSprint — the aggregate gate consumed by the React SprintForm.
    // Blocks submission (valid === false) when ANY field fails, and reports one
    // entry per failing field keyed by the field name.
    // -------------------------------------------------------------------------
    describe('validateSprint', () => {
        it('flags every field when name and both dates are empty', () => {
            const result = validateSprint({
                name: '',
                estimated_start: '',
                estimated_finish: '',
            });

            expect(result.valid).toBe(false);
            // Exactly the three field keys must be present.
            expect(Object.keys(result.errors).sort()).toEqual([
                'estimated_finish',
                'estimated_start',
                'name',
            ]);
            expect(result.errors.name).toBe(REQUIRED_MESSAGE);
            expect(result.errors.estimated_start).toBe(REQUIRED_MESSAGE);
            expect(result.errors.estimated_finish).toBe(REQUIRED_MESSAGE);
        });

        it('returns valid with no errors for a fully valid form', () => {
            const result = validateSprint({
                name: 'S1',
                estimated_start: '23 Mar 1984',
                estimated_finish: '06 Apr 1984',
            });

            expect(result).toEqual({ valid: true, errors: {} });
        });

        it('reports only the name error when the name is too long but dates are valid', () => {
            const result = validateSprint({
                name: 'a'.repeat(SPRINT_NAME_MAX_LENGTH + 1), // 501 chars
                estimated_start: '23 Mar 1984',
                estimated_finish: '06 Apr 1984',
            });

            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(MAX_LENGTH_MESSAGE);
            // No date errors — the valid dates must not populate the errors map.
            expect(Object.keys(result.errors)).toEqual(['name']);
            expect(result.errors).not.toHaveProperty('estimated_start');
            expect(result.errors).not.toHaveProperty('estimated_finish');
        });

        it('reports only the failing date when a single date is missing', () => {
            // Field independence: a missing start date must not spill into the
            // name or finish results.
            const result = validateSprint({
                name: 'S1',
                estimated_start: '',
                estimated_finish: '06 Apr 1984',
            });

            expect(result.valid).toBe(false);
            expect(Object.keys(result.errors)).toEqual(['estimated_start']);
            expect(result.errors.estimated_start).toBe(REQUIRED_MESSAGE);
        });
    });

    // -------------------------------------------------------------------------
    // serializeSprintDate — reproduces `moment(value, prettyDate).format(
    // "YYYY-MM-DD")` from lightboxes.coffee, with a defensive empty/nullish
    // guard and a caller-overridable display format.
    // -------------------------------------------------------------------------
    describe('serializeSprintDate', () => {
        it('serializes a picker string using the default "DD MMM YYYY" format', () => {
            expect(serializeSprintDate('23 Mar 1984')).toBe('1984-03-23');
        });

        it('returns an empty string for an empty input', () => {
            expect(serializeSprintDate('')).toBe('');
        });

        it('returns an empty string for null input', () => {
            expect(serializeSprintDate(null)).toBe('');
        });

        it('returns an empty string for undefined input', () => {
            expect(serializeSprintDate(undefined)).toBe('');
        });

        it('honors a caller-supplied display format', () => {
            expect(serializeSprintDate('1984-03-23', 'YYYY-MM-DD')).toBe('1984-03-23');
        });
    });

    // -------------------------------------------------------------------------
    // Exported message constants — the exact, user-facing strings must match
    // the AngularJS `en` locale verbatim so visual/behavioral parity holds.
    // -------------------------------------------------------------------------
    describe('SPRINT_VALIDATION_MESSAGES / SPRINT_NAME_MAX_LENGTH', () => {
        it('exposes the exact required message', () => {
            expect(SPRINT_VALIDATION_MESSAGES.required).toBe('This value is required.');
        });

        it('builds the exact max-length message for 500 characters', () => {
            expect(SPRINT_VALIDATION_MESSAGES.maxLength(500)).toBe(
                'This value is too long. It should have 500 characters or less.',
            );
        });

        it('pins the sprint name maximum length to 500', () => {
            expect(SPRINT_NAME_MAX_LENGTH).toBe(500);
        });
    });
});
