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
    isStoryFormDirty,
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
            // Finding M1 additions:
            due_date: null,
            team_requirement: false,
            client_requirement: false,
            attachments: [],
            attachmentsToAdd: [],
            attachmentsToDelete: [],
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
            due_date: "2021-05-01",
            team_requirement: true,
            client_requirement: false,
            attachments: [{ id: 9, name: "spec.pdf" }],
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
            // Finding M1: due date + requirement flags projected through; the
            // existing attachments are seeded, while the pending-change queues
            // always start empty on (re)seed.
            due_date: "2021-05-01",
            team_requirement: true,
            client_requirement: false,
            attachments: [{ id: 9, name: "spec.pdf" }],
            attachmentsToAdd: [],
            attachmentsToDelete: [],
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


describe("storyForm — isStoryFormDirty (M1 dirty-close guard)", () => {
    const base = createEmptyStoryValues({ status: 1, subject: "Seed" });

    it("is false when nothing changed relative to the seed", () => {
        expect(isStoryFormDirty(base, base)).toBe(false);
        expect(isStoryFormDirty({ ...base }, base)).toBe(false);
    });

    it("flags scalar edits (subject, description, due_date, blocked_note)", () => {
        expect(isStoryFormDirty({ ...base, subject: "Changed" }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, description: "x" }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, due_date: "2021-01-01" }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, blocked_note: "n" }, base)).toBe(true);
    });

    it("flags the team/client requirement + is_blocked toggles", () => {
        expect(isStoryFormDirty({ ...base, team_requirement: true }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, client_requirement: true }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, is_blocked: true }, base)).toBe(true);
    });

    it("flags tag changes by name AND colour (order-insensitive)", () => {
        const withTag = { ...base, tags: [["urgent", "#ff0000"]] as StoryFormValues["tags"] };
        expect(isStoryFormDirty(withTag, base)).toBe(true);
        // Same tag names but a different colour still counts as dirty.
        const recolored = { ...withTag, tags: [["urgent", "#00ff00"]] as StoryFormValues["tags"] };
        expect(isStoryFormDirty(recolored, withTag)).toBe(true);
        // Re-ordered identical tags are NOT dirty.
        const seed = {
            ...base,
            tags: [["a", null], ["b", "#111"]] as StoryFormValues["tags"],
        };
        const reordered = {
            ...base,
            tags: [["b", "#111"], ["a", null]] as StoryFormValues["tags"],
        };
        expect(isStoryFormDirty(reordered, seed)).toBe(false);
    });

    it("flags assignee-set and estimation-map changes (order-insensitive sets)", () => {
        expect(isStoryFormDirty({ ...base, assigned_users: [1] }, base)).toBe(true);
        const seed = { ...base, assigned_users: [1, 2] };
        const reordered = { ...base, assigned_users: [2, 1] };
        expect(isStoryFormDirty(reordered, seed)).toBe(false);
        expect(isStoryFormDirty({ ...base, points: { "1": 3 } }, base)).toBe(true);
    });

    it("flags a pending attachment add or delete (safer than legacy isModified)", () => {
        const file = new File(["x"], "a.txt", { type: "text/plain" });
        expect(isStoryFormDirty({ ...base, attachmentsToAdd: [file] }, base)).toBe(true);
        expect(isStoryFormDirty({ ...base, attachmentsToDelete: [7] }, base)).toBe(true);
    });
});
