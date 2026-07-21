/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the hand-written, framework-agnostic
 * sprint-form validation that REPLACES the legacy AngularJS form validator for
 * the sprint create/edit lightbox of the migrated React Backlog screen
 * (AAP §0.3.3, §0.4.1, §0.4.2, §0.5.2).
 *
 * The module under test — `app/react/shared/validation.ts` — reproduces two
 * behaviours from the legacy lightbox EXACTLY, with no AngularJS, no DOM, no
 * network and no dependency other than `moment`:
 *
 *   1. `validateSprintForm` mirrors the legacy `required` rules that guarded the
 *      `name`, `estimated_start` and `estimated_finish` inputs
 *      (`app/coffee/modules/backlog/lightboxes.coffee:44-49`). `project` is set
 *      from context and is never user-validated (`:31-36,148`), so it is not
 *      asserted here.
 *   2. `formatSprintDate` mirrors the wire-format normalisation applied before
 *      POST/PATCH — `moment(value, prettyDate).format("YYYY-MM-DD")`
 *      (`lightboxes.coffee:59-60,66-67`).
 *
 * TEST-LAYER ISOLATION
 *   These are pure-function assertions. The spec imports ONLY the module under
 *   test — no legacy validator, no end-to-end browser engine, no browser launch,
 *   no network and no UI framework. Jest globals (`describe`/`it`/`expect`) are
 *   provided by the runner (jsdom environment configured globally in the root
 *   `jest.config.js`), so no Jest import is required.
 *
 * ROBUSTNESS
 *   Error message wording is treated as an implementation detail: assertions
 *   check only the PRESENCE or ABSENCE of a per-field error key, never the exact
 *   message text. Date assertions use date-only ISO strings, which format to
 *   `YYYY-MM-DD` deterministically across timezones (no time component to shift).
 */

import { validateSprintForm, formatSprintDate } from '../validation';

describe('validateSprintForm', () => {
    it('flags every required field when the form is empty', () => {
        // Mirrors the initial `newSprint` object (all fields null) that the
        // legacy lightbox built before its validator blocked submit
        // (lightboxes.coffee:31-36,44-49).
        const result = validateSprintForm({
            name: '',
            estimated_start: null,
            estimated_finish: null,
        });

        expect(result.valid).toBe(false);
        // All three required fields must report an error (presence only).
        expect(result.errors.name).toBeDefined();
        expect(result.errors.estimated_start).toBeDefined();
        expect(result.errors.estimated_finish).toBeDefined();
    });

    it('reports no errors when every required field is present', () => {
        const result = validateSprintForm({
            name: 'Sprint 1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
        });

        expect(result.valid).toBe(true);
        // `errors` carries ONLY failing fields, so a valid form yields an empty
        // object (valid === Object.keys(errors).length === 0).
        expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('flags only the single missing field and leaves the provided ones clean', () => {
        // `name` and `estimated_finish` are supplied; only `estimated_start`
        // is missing — the result must isolate that one failing field.
        const result = validateSprintForm({
            name: 'X',
            estimated_start: null,
            estimated_finish: '2021-01-15',
        });

        expect(result.valid).toBe(false);
        expect(result.errors.estimated_start).toBeDefined();
        expect(result.errors.name).toBeUndefined();
        expect(result.errors.estimated_finish).toBeUndefined();
    });

    it('treats a whitespace-only name as blank (proves .trim() is applied)', () => {
        // A `name` of only spaces must fail the required check, proving the
        // validator trims before testing for emptiness (String(v ?? '').trim()).
        const result = validateSprintForm({
            name: '   ',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
        });

        expect(result.valid).toBe(false);
        expect(result.errors.name).toBeDefined();
        // The two valid date fields must remain error-free.
        expect(result.errors.estimated_start).toBeUndefined();
        expect(result.errors.estimated_finish).toBeUndefined();
    });
});

describe('formatSprintDate', () => {
    it('formats a date-only ISO string to the YYYY-MM-DD wire format', () => {
        // Date-only strings have no time component, so the formatted result is
        // stable regardless of the host timezone.
        expect(formatSprintDate('2021-01-05')).toBe('2021-01-05');
    });

    it('returns null for a null value', () => {
        expect(formatSprintDate(null)).toBeNull();
    });

    it('returns null for an undefined value', () => {
        // Falsy input short-circuits to null before moment is invoked.
        expect(formatSprintDate(undefined)).toBeNull();
    });

    it('formats another date-only ISO string deterministically', () => {
        expect(formatSprintDate('2021-12-31')).toBe('2021-12-31');
    });
});
