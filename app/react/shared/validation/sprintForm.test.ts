/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Unit spec for the pure sprint-form validator that replaces `checksley`.
//
// TEST-INDEPENDENCE CONTRACT (code review MI-08):
// This spec deliberately does NOT import the module's max-length or message
// constants to use as its own oracle. Importing them made the test tautological
// — a wrong max value or wrong copy in the implementation would still pass
// because both sides referenced the same symbol. Instead, the expected boundary
// (500) and the expected user-facing copy are pinned here as INDEPENDENT
// literals sourced from the authoritative contracts below, so that any
// unintended drift in `sprintForm.ts` is caught by a failing assertion:
//   • Name max length 500 — legacy checksley `data-maxlength="500"` on the
//     sprint-name input (app/partials/includes/modules/lightbox-sprint-add-edit.jade L19).
//   • REQUIRED / MAX_LENGTH copy — COMMON.FORM_ERRORS.* translation contract
//     (app/locales/taiga/locale-en.json: REQUIRED; MAX_LENGTH rendered with %s = 500).
//   • Invalid-date / date-range copy — the React-added strict-date + non-inverted
//     range rules mandated by AAP §0.1.2/§0.4.1 ("valid date range"); the legacy
//     sprint form had no checksley date message, so these pin the React contract.
import { validate } from "./sprintForm";
import type { SprintFormValues } from "./sprintForm";

// --- Independent expectations (intentionally NOT imported from the module under test) ---

/** Authoritative sprint-name max length: legacy `data-maxlength="500"`. */
const MAX_NAME_LENGTH = 500;

/** COMMON.FORM_ERRORS.REQUIRED */
const EXPECTED_REQUIRED_MESSAGE = "This value is required.";
/** COMMON.FORM_ERRORS.MAX_LENGTH rendered with %s = 500 */
const EXPECTED_MAXLENGTH_MESSAGE =
    "This value is too long. It should have 500 characters or less.";
/** React-added strict-date guard (AAP §0.1.2/§0.4.1). */
const EXPECTED_DATE_INVALID_MESSAGE = "This value should be a valid date.";
/** React-added non-inverted date-range rule (AAP §0.1.2/§0.4.1). */
const EXPECTED_DATE_RANGE_MESSAGE =
    "The start date must be on or before the finish date.";

const validValues: SprintFormValues = {
    project: 1,
    name: "Sprint 1",
    estimated_start: "2021-01-01",
    estimated_finish: "2021-01-15",
};

describe("sprintForm.validate", () => {
    describe("happy path", () => {
        it("returns valid with an empty errors object when all fields are valid", () => {
            const result = validate(validValues);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual({});
        });

        it("treats equal start and finish dates as valid (range is non-inverted, equal allowed)", () => {
            const result = validate({
                ...validValues,
                estimated_start: "2021-01-15",
                estimated_finish: "2021-01-15",
            });
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual({});
        });
    });

    describe("name", () => {
        it("is required when an empty string", () => {
            const result = validate({ ...validValues, name: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(EXPECTED_REQUIRED_MESSAGE);
        });

        it("is required when whitespace-only", () => {
            const result = validate({ ...validValues, name: "   " });
            expect(result.errors.name).toBe(EXPECTED_REQUIRED_MESSAGE);
        });

        it("is required when null", () => {
            const result = validate({ ...validValues, name: null as unknown as string });
            expect(result.errors.name).toBe(EXPECTED_REQUIRED_MESSAGE);
        });

        // --- Independent 500 / 501 max-length boundary (code review MI-08) ---
        it("accepts a name of exactly 500 characters (upper boundary, inclusive)", () => {
            const result = validate({ ...validValues, name: "a".repeat(MAX_NAME_LENGTH) });
            expect(result.valid).toBe(true);
            expect(result.errors.name).toBeUndefined();
        });

        it("rejects a name of 501 characters (one over the boundary)", () => {
            const result = validate({ ...validValues, name: "a".repeat(MAX_NAME_LENGTH + 1) });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(EXPECTED_MAXLENGTH_MESSAGE);
        });
    });

    describe("estimated_start", () => {
        it("is required when empty", () => {
            const result = validate({ ...validValues, estimated_start: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.estimated_start).toBe(EXPECTED_REQUIRED_MESSAGE);
        });

        it("reports an invalid-date error for an unparseable value", () => {
            const result = validate({ ...validValues, estimated_start: "2021-13-45" });
            expect(result.errors.estimated_start).toBe(EXPECTED_DATE_INVALID_MESSAGE);
        });
    });

    describe("estimated_finish", () => {
        it("is required when empty", () => {
            const result = validate({ ...validValues, estimated_finish: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.estimated_finish).toBe(EXPECTED_REQUIRED_MESSAGE);
        });

        it("reports an invalid-date error for an unparseable value", () => {
            const result = validate({ ...validValues, estimated_finish: "not-a-date" });
            expect(result.errors.estimated_finish).toBe(EXPECTED_DATE_INVALID_MESSAGE);
        });
    });

    describe("date range (non-inverted)", () => {
        it("attaches the range error to estimated_finish when start is after finish", () => {
            const result = validate({
                ...validValues,
                estimated_start: "2021-02-01",
                estimated_finish: "2021-01-15",
            });
            expect(result.valid).toBe(false);
            expect(result.errors.estimated_finish).toBe(EXPECTED_DATE_RANGE_MESSAGE);
            expect(result.errors.estimated_start).toBeUndefined();
        });

        it("skips the range check (no crash, required wins) when finish is missing", () => {
            const result = validate({
                ...validValues,
                estimated_start: "2021-05-01",
                estimated_finish: "",
            });
            expect(result.errors.estimated_finish).toBe(EXPECTED_REQUIRED_MESSAGE);
        });
    });

    describe("multiple errors", () => {
        it("reports required for all three fields when everything is empty", () => {
            const result = validate({ name: "", estimated_start: "", estimated_finish: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(EXPECTED_REQUIRED_MESSAGE);
            expect(result.errors.estimated_start).toBe(EXPECTED_REQUIRED_MESSAGE);
            expect(result.errors.estimated_finish).toBe(EXPECTED_REQUIRED_MESSAGE);
        });
    });
});
