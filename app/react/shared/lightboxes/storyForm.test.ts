/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the pure story-form value model + validation
 * (`shared/lightboxes/storyForm.ts`). These rules reproduce the legacy
 * `lb-create-edit.jade` checksley constraints on the subject field
 * (`data-required="true"`, `data-maxlength="500"`) — finding C2 — and the EDIT
 * projection used by the shared lightbox. The module is framework-free, so this
 * suite needs no DOM.
 */

import {
    SUBJECT_MAX_LENGTH,
    createEmptyStoryValues,
    validateStoryForm,
    isStoryFormValid,
    storyToFormValues,
    type StoryFormValues,
} from "./storyForm";

describe("storyForm — createEmptyStoryValues", () => {
    it("returns a complete, blank value model with a bottom insertion default", () => {
        const values = createEmptyStoryValues();
        expect(values).toEqual({
            subject: "",
            description: "",
            status: null,
            tags: [],
            assigned_users: [],
            assigned_to: null,
            points: {},
            swimlane: null,
            is_blocked: false,
            blocked_note: "",
            us_position: "bottom",
        });
    });

    it("applies overrides on top of the defaults (target status / swimlane)", () => {
        const values = createEmptyStoryValues({ status: 7, swimlane: 3, us_position: "top" });
        expect(values.status).toBe(7);
        expect(values.swimlane).toBe(3);
        expect(values.us_position).toBe("top");
        // Untouched fields keep their defaults.
        expect(values.subject).toBe("");
        expect(values.tags).toEqual([]);
    });
});

describe("storyForm — validateStoryForm / isStoryFormValid", () => {
    it("flags an empty (or whitespace-only) subject as required", () => {
        expect(validateStoryForm(createEmptyStoryValues())).toEqual({ subject: "required" });
        expect(validateStoryForm(createEmptyStoryValues({ subject: "   " }))).toEqual({
            subject: "required",
        });
        expect(isStoryFormValid(createEmptyStoryValues())).toBe(false);
    });

    it("accepts a non-empty subject at or below the max length", () => {
        const ok = createEmptyStoryValues({ subject: "A real subject" });
        expect(validateStoryForm(ok)).toEqual({});
        expect(isStoryFormValid(ok)).toBe(true);

        const atLimit = createEmptyStoryValues({ subject: "x".repeat(SUBJECT_MAX_LENGTH) });
        expect(isStoryFormValid(atLimit)).toBe(true);
    });

    it("flags a subject over the max length", () => {
        const tooLong = createEmptyStoryValues({ subject: "x".repeat(SUBJECT_MAX_LENGTH + 1) });
        expect(validateStoryForm(tooLong)).toEqual({ subject: "maxlength" });
        expect(isStoryFormValid(tooLong)).toBe(false);
    });
});

describe("storyForm — storyToFormValues", () => {
    it("projects a persisted story into the form model", () => {
        const projected = storyToFormValues({
            subject: "Existing",
            description: "Body",
            status: 4,
            tags: [["urgent", "#ff0000"]],
            assigned_users: [1, 2],
            assigned_to: 1,
            points: { "10": 3 },
            swimlane: 8,
            is_blocked: true,
            blocked_note: "waiting",
        });
        expect(projected).toEqual({
            subject: "Existing",
            description: "Body",
            status: 4,
            tags: [["urgent", "#ff0000"]],
            assigned_users: [1, 2],
            assigned_to: 1,
            points: { "10": 3 },
            swimlane: 8,
            is_blocked: true,
            blocked_note: "waiting",
        });
    });

    it("falls back to empty-form defaults for missing/undefined attributes (no undefined leaks)", () => {
        const projected = storyToFormValues({ subject: "Only subject" });
        // Merged onto the empty model, no field is `undefined`.
        const merged: StoryFormValues = createEmptyStoryValues(projected);
        expect(merged.description).toBe("");
        expect(merged.tags).toEqual([]);
        expect(merged.assigned_users).toEqual([]);
        expect(merged.assigned_to).toBeNull();
        expect(merged.points).toEqual({});
        expect(merged.swimlane).toBeNull();
        expect(merged.is_blocked).toBe(false);
        expect(merged.blocked_note).toBe("");
        expect(merged.subject).toBe("Only subject");
    });

    it("coerces a nullish is_blocked to a boolean false", () => {
        expect(storyToFormValues({ subject: "s" }).is_blocked).toBe(false);
        expect(storyToFormValues({ subject: "s", is_blocked: null }).is_blocked).toBe(false);
        expect(storyToFormValues({ subject: "s", is_blocked: true }).is_blocked).toBe(true);
    });
});
