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

import type { Tag, Attachment } from "../types";

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
    /**
     * Due date serialised as `YYYY-MM-DD` (`obj.due_date`) or null when unset
     * (finding M1). The legacy edit path reformats a moment to `YYYY-MM-DD`
     * before save; the form stores the already-formatted string.
     */
    due_date: string | null;
    /** "Team requirement" flag (`obj.team_requirement`) — finding M1. */
    team_requirement: boolean;
    /** "Client requirement" flag (`obj.client_requirement`) — finding M1. */
    client_requirement: boolean;
    /**
     * Attachments already persisted on the story (finding M1). Seeded on EDIT
     * from `listUserStoryAttachments`; each carries an `id`. Rendered minus any
     * id queued in {@link attachmentsToDelete}. Empty on CREATE.
     */
    attachments: Attachment[];
    /**
     * New files queued for upload AFTER the story is saved (finding M1), mirroring
     * the legacy `attachmentsToAdd` list + `createAttachments(data)` step. Removing
     * a still-queued file simply drops it from this list (no request).
     */
    attachmentsToAdd: File[];
    /**
     * Ids of persisted attachments queued for deletion AFTER save (finding M1),
     * mirroring the legacy `attachmentsToDelete` list + `deleteAttachments(data)`
     * step. Populated only for attachments that already have a backend id.
     */
    attachmentsToDelete: number[];
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
        due_date: null,
        team_requirement: false,
        client_requirement: false,
        attachments: [],
        attachmentsToAdd: [],
        attachmentsToDelete: [],
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
    due_date?: string | null;
    team_requirement?: boolean | null;
    client_requirement?: boolean | null;
    attachments?: Attachment[] | null;
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
        due_date: story.due_date ?? null,
        team_requirement: Boolean(story.team_requirement),
        client_requirement: Boolean(story.client_requirement),
        // Existing attachments are seeded by the caller AFTER an async fetch
        // (`listUserStoryAttachments`); default to whatever the source carries.
        attachments: story.attachments ?? [],
        // Pending-change queues always start empty on (re)seed.
        attachmentsToAdd: [],
        attachmentsToDelete: [],
    };
}

/** Order-insensitive equality of two numeric id lists (`assigned_users`). */
function sameIdSet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
}

/** Order-insensitive equality of two tag lists by BOTH name and colour. */
function sameTagList(a: Tag[], b: Tag[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const key = (t: Tag): string => `${t[0]}\u0000${t[1] ?? ""}`;
    const sa = a.map(key).sort();
    const sb = b.map(key).sort();
    return sa.every((v, i) => v === sb[i]);
}

/** Equality of two role-id -> point-id maps (null/undefined treated as unset). */
function samePointMap(
    a: Record<string, number | null>,
    b: Record<string, number | null>,
): boolean {
    const norm = (m: Record<string, number | null>): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const k of Object.keys(m)) {
            const v = m[k];
            if (v !== null && v !== undefined) {
                out[k] = v;
            }
        }
        return out;
    };
    const na = norm(a);
    const nb = norm(b);
    const ka = Object.keys(na);
    const kb = Object.keys(nb);
    if (ka.length !== kb.length) {
        return false;
    }
    return ka.every((k) => na[k] === nb[k]);
}

/**
 * Whether the form has unsaved changes relative to its initial seed (finding
 * M1). This drives the dirty-close confirmation, reproducing the legacy
 * `CreateEditDirective.checkClose` gate (`common/lightboxes.coffee` L817): a
 * pristine form closes immediately, a dirty one prompts a localized confirm
 * (replacing the previous English `window.confirm` substitute).
 *
 * Every persisted story field is compared, and — going one step SAFER than the
 * legacy `obj.isModified()` (which tracked only the story model) — a pending
 * attachment add/delete also marks the form dirty, so a queued-but-unsaved
 * attachment can never be discarded without a prompt.
 */
export function isStoryFormDirty(
    current: StoryFormValues,
    initial: StoryFormValues,
): boolean {
    if (current.attachmentsToAdd.length > 0 || current.attachmentsToDelete.length > 0) {
        return true;
    }
    if (
        current.subject !== initial.subject ||
        current.description !== initial.description ||
        current.status !== initial.status ||
        current.assigned_to !== initial.assigned_to ||
        current.swimlane !== initial.swimlane ||
        current.is_blocked !== initial.is_blocked ||
        current.blocked_note !== initial.blocked_note ||
        current.due_date !== initial.due_date ||
        current.team_requirement !== initial.team_requirement ||
        current.client_requirement !== initial.client_requirement ||
        current.us_position !== initial.us_position
    ) {
        return true;
    }
    if (!sameIdSet(current.assigned_users, initial.assigned_users)) {
        return true;
    }
    if (!sameTagList(current.tags, initial.tags)) {
        return true;
    }
    if (!samePointMap(current.points, initial.points)) {
        return true;
    }
    return false;
}
