/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Pure value-model + validation for the shared create/edit user-story lightbox
 * (`StoryFormLightbox`). Kept framework-free and side-effect-free so it can be
 * unit-tested in isolation and reused verbatim by BOTH migrated screens (Kanban
 * now — finding C2; Backlog in the shared-story-form wiring — finding C7),
 * mirroring the dedicated-validation-module pattern already used by
 * `backlog/validation/sprintForm.ts`.
 *
 * The rules reproduce the legacy `lb-create-edit.jade` checksley constraints on
 * the subject field (`data-required="true"`, `data-maxlength="500"`); no rule is
 * invented beyond what the legacy template declared (finding-driven, no drift).
 */

import type { Tag } from "../types";

/** Maximum subject length — legacy `data-maxlength="500"` on the subject input. */
export const SUBJECT_MAX_LENGTH = 500;

/**
 * The complete, framework-agnostic value model the create/edit lightbox edits.
 * Field names mirror the backend user-story attributes so a producer can spread
 * the changed subset straight into a `create`/dirty-PATCH `save` call.
 */
export interface StoryFormValues {
    /** Story title (`obj.subject`); required, <= 500 chars. */
    subject: string;
    /** Long description (`obj.description`); optional. */
    description: string;
    /** Selected status id (`obj.status`); null only before statuses resolve. */
    status: number | null;
    /** Tag list as the backend serialises it (`[name, color]`). */
    tags: Tag[];
    /** Assigned collaborators (`obj.assigned_users`). */
    assigned_users: number[];
    /** Primary assignee (`obj.assigned_to`); null = unassigned. */
    assigned_to: number | null;
    /** Role-id -> point-id estimation map (`obj.points`). */
    points: Record<string, number | null>;
    /** Swimlane id (kanban only); null = the unclassified swimlane. */
    swimlane: number | null;
    /** Block flag (`obj.is_blocked`). */
    is_blocked: boolean;
    /** Block reason shown when blocked (`obj.blocked_note`). */
    blocked_note: string;
    /** New-story insertion position (`new.us_position`); ignored on edit. */
    us_position: "top" | "bottom";
}

/**
 * Value model for the bulk create-user-stories lightbox. Kept here (with
 * {@link StoryFormValues}) so non-React modules (the screen hooks) can import the
 * shape without depending on the component file.
 */
export interface BulkStoryValues {
    /** Raw textarea contents; one story subject per line. */
    bulk: string;
    /** Target status id. */
    status: number | null;
    /** Target swimlane id (kanban); null = unclassified. */
    swimlane: number | null;
    /** Insertion position. */
    us_position: "top" | "bottom";
}

/** Field-keyed validation errors; a field is present only when it is invalid. */
export interface StoryFormErrors {
    subject?: string;
}

/**
 * Build the initial value model. On CREATE the caller supplies the target status
 * (and, on kanban, the target swimlane); on EDIT the caller spreads the existing
 * story attributes in via {@link storyToFormValues}.
 */
export function createEmptyStoryValues(
    overrides: Partial<StoryFormValues> = {},
): StoryFormValues {
    return {
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
        ...overrides,
    };
}

/**
 * Validate the story form. Returns an errors object; empty (no keys) means the
 * form is submittable. `subjectRequired` message keys are resolved by the caller
 * via `t()` so this module stays i18n-free.
 */
export function validateStoryForm(values: StoryFormValues): StoryFormErrors {
    const errors: StoryFormErrors = {};
    const subject = values.subject.trim();
    if (subject.length === 0) {
        errors.subject = "required";
    } else if (values.subject.length > SUBJECT_MAX_LENGTH) {
        errors.subject = "maxlength";
    }
    return errors;
}

/** True when the form has no validation errors (ready to submit). */
export function isStoryFormValid(values: StoryFormValues): boolean {
    return Object.keys(validateStoryForm(values)).length === 0;
}

/**
 * Structural subset of a persisted user story that the edit form seeds from.
 * Declared here (rather than importing the full `UserStory` model) so this
 * value-model module stays decoupled from the screen types while remaining
 * structurally compatible with `shared/types` `UserStory`.
 */
export interface StorySource {
    subject?: string;
    description?: string;
    status?: number | null;
    tags?: Tag[] | null;
    assigned_users?: number[] | null;
    assigned_to?: number | null;
    points?: Record<string, number | null> | null;
    swimlane?: number | null;
    is_blocked?: boolean | null;
    blocked_note?: string | null;
}

/**
 * Project an existing story into the form's value model for the EDIT path.
 * Returns a `Partial` (the form fills the rest from {@link createEmptyStoryValues}),
 * so a missing/undefined attribute falls back to the empty-form default instead
 * of leaking `undefined` into a controlled input.
 */
export function storyToFormValues(story: StorySource): Partial<StoryFormValues> {
    return {
        subject: story.subject ?? "",
        description: story.description ?? "",
        status: story.status ?? null,
        tags: story.tags ?? [],
        assigned_users: story.assigned_users ?? [],
        assigned_to: story.assigned_to ?? null,
        points: story.points ?? {},
        swimlane: story.swimlane ?? null,
        is_blocked: Boolean(story.is_blocked),
        blocked_note: story.blocked_note ?? "",
    };
}
