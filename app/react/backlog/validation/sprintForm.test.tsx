/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
  isSprintFormValid,
  SPRINT_NAME_MAX_LENGTH,
  validateSprintForm,
} from "./sprintForm";
import type { SprintFormValues } from "./sprintForm";

/** Build a valid baseline set of form values, overriding selected fields. */
function makeValues(overrides: Partial<SprintFormValues> = {}): SprintFormValues {
  return {
    name: "Sprint 1",
    estimated_start: "2020-01-10",
    estimated_finish: "2020-01-24",
    ...overrides,
  };
}

describe("validateSprintForm", () => {
  it("returns no errors for fully valid input", () => {
    const values = makeValues();
    expect(validateSprintForm(values)).toEqual({});
    expect(isSprintFormValid(values)).toBe(true);
  });

  it("flags an empty name as required", () => {
    const errors = validateSprintForm(makeValues({ name: "" }));
    expect(errors.name).toBe("Name is required");
    expect(isSprintFormValid(makeValues({ name: "" }))).toBe(false);
  });

  it("flags a whitespace-only name as required", () => {
    const errors = validateSprintForm(makeValues({ name: "    " }));
    expect(errors.name).toBe("Name is required");
  });

  it("flags a name longer than 500 characters", () => {
    const errors = validateSprintForm(makeValues({ name: "a".repeat(501) }));
    expect(errors.name).toBe("Name is too long");
  });

  it("accepts a name of exactly 500 characters", () => {
    const errors = validateSprintForm(makeValues({ name: "a".repeat(SPRINT_NAME_MAX_LENGTH) }));
    expect(errors.name).toBeUndefined();
  });

  it("flags a missing estimated_start as required", () => {
    const errors = validateSprintForm(makeValues({ estimated_start: "" }));
    expect(errors.estimated_start).toBe("Estimated start is required");
  });

  it("flags a missing estimated_finish as required", () => {
    const errors = validateSprintForm(makeValues({ estimated_finish: "" }));
    expect(errors.estimated_finish).toBe("Estimated finish is required");
  });

  it("flags estimated_finish earlier than estimated_start", () => {
    const errors = validateSprintForm(
      makeValues({ estimated_start: "2020-01-24", estimated_finish: "2020-01-10" }),
    );
    expect(errors.estimated_finish).toBe("Estimated finish must be after estimated start");
    expect(errors.estimated_start).toBeUndefined();
  });

  it("accepts estimated_finish equal to estimated_start", () => {
    const errors = validateSprintForm(
      makeValues({ estimated_start: "2020-01-10", estimated_finish: "2020-01-10" }),
    );
    expect(errors.estimated_finish).toBeUndefined();
  });

  it("accepts estimated_finish later than estimated_start", () => {
    const errors = validateSprintForm(
      makeValues({ estimated_start: "2020-01-10", estimated_finish: "2020-02-01" }),
    );
    expect(errors.estimated_finish).toBeUndefined();
  });

  it("returns multiple simultaneous errors together", () => {
    const errors = validateSprintForm({ name: "", estimated_start: "", estimated_finish: "" });
    expect(errors.name).toBe("Name is required");
    expect(errors.estimated_start).toBe("Estimated start is required");
    expect(errors.estimated_finish).toBe("Estimated finish is required");
    expect(Object.keys(errors).length).toBe(3);
  });
});

describe("isSprintFormValid", () => {
  it("is true when there are no validation errors", () => {
    expect(isSprintFormValid(makeValues())).toBe(true);
  });

  it("is false when any field is invalid", () => {
    expect(isSprintFormValid(makeValues({ name: "" }))).toBe(false);
    expect(isSprintFormValid(makeValues({ estimated_finish: "" }))).toBe(false);
  });
});
