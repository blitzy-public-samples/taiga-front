/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    validate,
    NAME_MAX_LENGTH,
    REQUIRED_MESSAGE,
    MAXLENGTH_MESSAGE,
    DATE_INVALID_MESSAGE,
    DATE_RANGE_MESSAGE,
} from "./sprintForm";
import type { SprintFormValues } from "./sprintForm";

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

        it("accepts a name of exactly the maximum length", () => {
            const result = validate({ ...validValues, name: "a".repeat(NAME_MAX_LENGTH) });
            expect(result.valid).toBe(true);
            expect(result.errors.name).toBeUndefined();
        });
    });

    describe("name", () => {
        it("is required when an empty string", () => {
            const result = validate({ ...validValues, name: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(REQUIRED_MESSAGE);
        });

        it("is required when whitespace-only", () => {
            const result = validate({ ...validValues, name: "   " });
            expect(result.errors.name).toBe(REQUIRED_MESSAGE);
        });

        it("is required when null", () => {
            const result = validate({ ...validValues, name: null as unknown as string });
            expect(result.errors.name).toBe(REQUIRED_MESSAGE);
        });

        it("rejects a name longer than the maximum length", () => {
            const result = validate({ ...validValues, name: "a".repeat(NAME_MAX_LENGTH + 1) });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(MAXLENGTH_MESSAGE);
        });
    });

    describe("estimated_start", () => {
        it("is required when empty", () => {
            const result = validate({ ...validValues, estimated_start: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.estimated_start).toBe(REQUIRED_MESSAGE);
        });

        it("reports an invalid-date error for an unparseable value", () => {
            const result = validate({ ...validValues, estimated_start: "2021-13-45" });
            expect(result.errors.estimated_start).toBe(DATE_INVALID_MESSAGE);
        });
    });

    describe("estimated_finish", () => {
        it("is required when empty", () => {
            const result = validate({ ...validValues, estimated_finish: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.estimated_finish).toBe(REQUIRED_MESSAGE);
        });

        it("reports an invalid-date error for an unparseable value", () => {
            const result = validate({ ...validValues, estimated_finish: "not-a-date" });
            expect(result.errors.estimated_finish).toBe(DATE_INVALID_MESSAGE);
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
            expect(result.errors.estimated_finish).toBe(DATE_RANGE_MESSAGE);
            expect(result.errors.estimated_start).toBeUndefined();
        });

        it("skips the range check (no crash, required wins) when finish is missing", () => {
            const result = validate({
                ...validValues,
                estimated_start: "2021-05-01",
                estimated_finish: "",
            });
            expect(result.errors.estimated_finish).toBe(REQUIRED_MESSAGE);
        });
    });

    describe("multiple errors", () => {
        it("reports required for all three fields when everything is empty", () => {
            const result = validate({ name: "", estimated_start: "", estimated_finish: "" });
            expect(result.valid).toBe(false);
            expect(result.errors.name).toBe(REQUIRED_MESSAGE);
            expect(result.errors.estimated_start).toBe(REQUIRED_MESSAGE);
            expect(result.errors.estimated_finish).toBe(REQUIRED_MESSAGE);
        });
    });
});
