/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Backlog sprint-lightbox validation spec.
 *
 * SCOPE (Backlog framing)
 *   Exercises the pure, framework-agnostic sprint-form contract that the
 *   migrated React Backlog screen relies on: `validateSprintForm` and
 *   `formatSprintDate` from `../../shared/validation`. These reproduce the
 *   legacy AngularJS sprint create/edit lightbox rules exactly — `name`,
 *   `estimated_start` and `estimated_finish` are *required*, and the two date
 *   fields are normalised to the backend `YYYY-MM-DD` wire format before a
 *   milestone is POSTed/PATCHed. `project` is populated from context and is
 *   never user-validated, so it is intentionally absent from the error map.
 *
 *   Every assertion below is phrased around the sprint lightbox that the
 *   `CreateEditSprintLightbox` component renders, locking the exact
 *   required-field behaviour and the `YYYY-MM-DD` output that the sprint
 *   create/edit API path depends on.
 *
 * DIVISION OF LABOUR (additive, no conflict)
 *   The sibling `app/react/shared/__tests__/validation.test.ts` owns the
 *   generic coverage of the shared module. This Backlog copy is additive and
 *   deliberately Backlog-specific: it asserts the sprint-lightbox contract
 *   rather than duplicating the generic cases. Both import the very same pure
 *   module, so coverage stacks without collision.
 *
 * PURITY (nothing is stubbed or replaced)
 *   `validateSprintForm` / `formatSprintDate` are pure functions with no DOM,
 *   `window`, network, timer or framework dependency, so the functions are
 *   imported directly and called — no module substitution is used anywhere.
 *   `describe` / `it` / `expect` are Jest globals (never imported); the jsdom
 *   test environment is supplied by `jest.config.js` (no per-file docblock).
 */

import { formatSprintDate, validateSprintForm } from '../../shared/validation';
import type { SprintFormValues } from '../../shared/types';
import { makeSprintFormValues } from './factories';

describe('validateSprintForm (backlog sprint lightbox rules)', () => {
    describe('required fields', () => {
        it('rejects a sprint with no name (empty string)', () => {
            const result = validateSprintForm({
                name: '',
                estimated_start: '2021-01-01',
                estimated_finish: '2021-01-15',
            });

            expect(result.valid).toBe(false);
            // The failing field is keyed by name with a non-empty error code.
            expect(result.errors.name).toEqual(expect.any(String));
            expect(result.errors.name).toBeTruthy();
            // Only `name` failed — the two supplied dates stay clean.
            expect(result.errors.estimated_start).toBeUndefined();
            expect(result.errors.estimated_finish).toBeUndefined();
        });

        it('rejects a sprint whose name is null', () => {
            const result = validateSprintForm(makeSprintFormValues({ name: null }));

            expect(result.valid).toBe(false);
            expect(result.errors.name).toEqual(expect.any(String));
            expect(result.errors.name).toBeTruthy();
        });

        it('rejects a sprint whose name is whitespace-only', () => {
            // The required rule trims, so a blank-looking name is still "missing",
            // matching the intent of the legacy required check on the name input.
            const result = validateSprintForm(makeSprintFormValues({ name: '   ' }));

            expect(result.valid).toBe(false);
            expect(result.errors.name).toEqual(expect.any(String));
            expect(result.errors.name).toBeTruthy();
        });

        it('rejects a sprint with no estimated_start', () => {
            const result = validateSprintForm({
                name: 'Sprint 1',
                estimated_start: '',
                estimated_finish: '2021-01-15',
            });

            expect(result.valid).toBe(false);
            expect(result.errors.estimated_start).toEqual(expect.any(String));
            expect(result.errors.estimated_start).toBeTruthy();
            // `name` was provided, so it must not appear in the error map.
            expect(result.errors.name).toBeUndefined();
        });

        it('rejects a sprint whose estimated_start is null', () => {
            const result = validateSprintForm(makeSprintFormValues({ estimated_start: null }));

            expect(result.valid).toBe(false);
            expect(result.errors.estimated_start).toEqual(expect.any(String));
            expect(result.errors.estimated_start).toBeTruthy();
        });

        it('rejects a sprint with no estimated_finish', () => {
            const result = validateSprintForm({
                name: 'Sprint 1',
                estimated_start: '2021-01-01',
                estimated_finish: '',
            });

            expect(result.valid).toBe(false);
            expect(result.errors.estimated_finish).toEqual(expect.any(String));
            expect(result.errors.estimated_finish).toBeTruthy();
            expect(result.errors.name).toBeUndefined();
        });

        it('rejects a sprint whose estimated_finish is null', () => {
            const result = validateSprintForm(makeSprintFormValues({ estimated_finish: null }));

            expect(result.valid).toBe(false);
            expect(result.errors.estimated_finish).toEqual(expect.any(String));
            expect(result.errors.estimated_finish).toBeTruthy();
        });

        it('reports all three required errors when the whole sprint form is blank', () => {
            const result = validateSprintForm({
                name: '',
                estimated_start: '',
                estimated_finish: '',
            });

            expect(result.valid).toBe(false);
            expect(result.errors).toHaveProperty('name');
            expect(result.errors).toHaveProperty('estimated_start');
            expect(result.errors).toHaveProperty('estimated_finish');
            // Exactly the three required sprint fields — `project` is never validated.
            expect(Object.keys(result.errors).sort()).toEqual([
                'estimated_finish',
                'estimated_start',
                'name',
            ]);
        });
    });

    describe('valid input', () => {
        it('accepts a fully-populated sprint form', () => {
            const validSprint: SprintFormValues = {
                name: 'Sprint 1',
                estimated_start: '2021-01-01',
                estimated_finish: '2021-01-15',
            };

            const result = validateSprintForm(validSprint);

            expect(result.valid).toBe(true);
            expect(Object.keys(result.errors)).toHaveLength(0);
        });

        it('treats the makeSprintFormValues() factory defaults as a valid sprint', () => {
            // Cross-checks the factory contract: its defaults MUST pass validation
            // so every other backlog spec can start from a known-valid baseline.
            const result = validateSprintForm(makeSprintFormValues());

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual({});
        });

        it('accepts a sprint when only the optional project is omitted', () => {
            // `project` is assigned from context, never user-validated, so leaving
            // it out must not affect the validity of the sprint form.
            const validSprint: SprintFormValues = {
                name: 'Sprint 2',
                estimated_start: '2021-02-01',
                estimated_finish: '2021-02-14',
            };

            const result = validateSprintForm(validSprint);

            expect(result.valid).toBe(true);
            expect(Object.keys(result.errors)).toHaveLength(0);
        });
    });
});

describe('formatSprintDate — YYYY-MM-DD output', () => {
    // The exact wire format the sprint create/edit milestone API expects.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    it('formats a sprint estimated_start from a picker format to YYYY-MM-DD', () => {
        expect(formatSprintDate('01 Jan 2021', 'DD MMM YYYY')).toBe('2021-01-01');
    });

    it('formats a sprint estimated_finish from a picker format to YYYY-MM-DD', () => {
        expect(formatSprintDate('15 Jan 2021', 'DD MMM YYYY')).toBe('2021-01-15');
    });

    it('passes an already-ISO sprint date through unchanged', () => {
        expect(formatSprintDate('2021-01-15', 'YYYY-MM-DD')).toBe('2021-01-15');
    });

    it('parses an ISO sprint date when no picker format is supplied', () => {
        expect(formatSprintDate('2021-01-01')).toBe('2021-01-01');
    });

    it('returns null for a null sprint date', () => {
        expect(formatSprintDate(null)).toBeNull();
    });

    it('returns null for an empty sprint date', () => {
        expect(formatSprintDate('')).toBeNull();
    });

    it('returns null for an undefined sprint date', () => {
        expect(formatSprintDate(undefined)).toBeNull();
    });

    it('always emits the YYYY-MM-DD wire format the sprint API expects', () => {
        expect(formatSprintDate('01 Jan 2021', 'DD MMM YYYY')).toMatch(ISO_DATE);
        expect(formatSprintDate('2021-01-15', 'YYYY-MM-DD')).toMatch(ISO_DATE);
        expect(formatSprintDate('2021-12-31')).toMatch(ISO_DATE);
    });
});
