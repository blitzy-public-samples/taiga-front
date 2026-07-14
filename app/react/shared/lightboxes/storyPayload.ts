/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * storyPayload
 * ------------
 * SHARED story-form request builders used by BOTH migrated screens' hooks
 * (`kanban/hooks/useKanbanStories.ts` and `backlog/hooks/useBacklogStories.ts`).
 * They turn the values collected by the shared `StoryFormLightbox` into the
 * exact request bodies the frozen `/api/v1/userstories` endpoints expect:
 *
 *   - {@link buildCreateStoryPayload} — the POST body for a create-story request
 *     (only defined/non-empty fields; `us_position` is a client-side ordering
 *     hint the legacy form applied AFTER success, never a POST field —
 *     `common/lightboxes.coffee` L785).
 *   - {@link diffStoryValues} — the DIRTY subset changed by an edit form relative
 *     to the current story (mirrors `base/repository.save` + `model.getAttrs`),
 *     so a PATCH stays minimal and never clobbers untouched fields (finding M1/M2).
 *
 * Extracting these into one module is the concrete "story-form strategy shared
 * with Kanban" the review requires (finding C7): the Backlog screen reuses the
 * SAME components AND the SAME request-shaping the Kanban screen already uses,
 * rather than duplicating (or, previously, dispatching events into the void).
 */

import type { StoryFormValues } from "./storyForm";
import type { UserStory, Tag } from "../types";

/**
 * `save<T extends SavableEntity>` requires an index signature; the frozen model
 * types intentionally do NOT carry one. This bridge keeps the strong `UserStory`
 * shape at the call sites while satisfying the client generic.
 */
export type Savable<T> = T & { [key: string]: unknown };

/** Drop role-ids whose estimate is null/undefined (an unset "?" point). */
function pickDefinedPoints(points: Record<string, number | null>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of Object.keys(points)) {
        const value = points[key];
        if (value !== null && value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}

/** Order-insensitive equality of two numeric id lists (e.g. `assigned_users`). */
function sameNumberSet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const sortedA = [...a].sort((x, y) => x - y);
    const sortedB = [...b].sort((x, y) => x - y);
    return sortedA.every((value, index) => value === sortedB[index]);
}

/** Order-insensitive equality of two tag lists (compared by tag name). */
function sameTags(a: Tag[], b: Tag[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const namesA = a.map((tag) => tag[0]).sort();
    const namesB = b.map((tag) => tag[0]).sort();
    return namesA.every((name, index) => name === namesB[index]);
}

/** Equality of two defined-point maps (role-id -> point-id). */
function samePoints(a: Record<string, number>, b: Record<string, number>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
        return false;
    }
    return keysA.every((key) => a[key] === b[key]);
}

/**
 * Build the POST body for a create-story request from the collected form values.
 * Only defined/non-empty fields are included (the backend assigns the rest), and
 * `us_position` is intentionally OMITTED — it is a client-side ordering hint the
 * legacy form applied after success, never a POST field.
 */
export function buildCreateStoryPayload(
    projectId: number | null,
    statusId: number,
    values: StoryFormValues,
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        project: projectId,
        status: values.status ?? statusId,
        subject: values.subject,
    };
    if (values.description.trim().length > 0) {
        payload.description = values.description;
    }
    if (values.tags.length > 0) {
        payload.tags = values.tags;
    }
    if (values.assigned_users.length > 0) {
        payload.assigned_users = values.assigned_users;
    }
    if (values.assigned_to !== null) {
        payload.assigned_to = values.assigned_to;
    }
    const definedPoints = pickDefinedPoints(values.points);
    if (Object.keys(definedPoints).length > 0) {
        payload.points = definedPoints;
    }
    if (values.swimlane !== null) {
        payload.swimlane = values.swimlane;
    }
    if (values.is_blocked) {
        payload.is_blocked = true;
        if (values.blocked_note.length > 0) {
            payload.blocked_note = values.blocked_note;
        }
    }
    // Finding M1: due date + team/client requirement flags. Included only when
    // set/true (the backend defaults an omitted flag to false and an omitted
    // due_date to null), matching the "defined/non-empty fields only" convention
    // used above for is_blocked.
    if (values.due_date) {
        payload.due_date = values.due_date;
    }
    if (values.team_requirement) {
        payload.team_requirement = true;
    }
    if (values.client_requirement) {
        payload.client_requirement = true;
    }
    return payload;
}

/**
 * Compute the DIRTY subset of attributes changed by the edit form relative to
 * the current story (mirrors `model.getAttrs()` dirty tracking). Returns only
 * changed keys so the PATCH stays minimal and never clobbers fields the user did
 * not touch (finding M1/M2).
 */
export function diffStoryValues(
    story: UserStory,
    values: StoryFormValues,
): Record<string, unknown> {
    const modified: Record<string, unknown> = {};
    if (values.subject !== (story.subject ?? "")) {
        modified.subject = values.subject;
    }
    if (values.description !== (story.description ?? "")) {
        modified.description = values.description;
    }
    if (values.status !== null && values.status !== story.status) {
        modified.status = values.status;
    }
    if (!sameTags(values.tags, story.tags ?? [])) {
        modified.tags = values.tags;
    }
    if (!sameNumberSet(values.assigned_users, story.assigned_users ?? [])) {
        modified.assigned_users = values.assigned_users;
    }
    if (values.assigned_to !== (story.assigned_to ?? null)) {
        modified.assigned_to = values.assigned_to;
    }
    const nextPoints = pickDefinedPoints(values.points);
    if (!samePoints(nextPoints, pickDefinedPoints(story.points ?? {}))) {
        modified.points = nextPoints;
    }
    if (values.swimlane !== (story.swimlane ?? null)) {
        modified.swimlane = values.swimlane;
    }
    if (values.is_blocked !== Boolean(story.is_blocked)) {
        modified.is_blocked = values.is_blocked;
    }
    if (values.is_blocked && values.blocked_note !== (story.blocked_note ?? "")) {
        modified.blocked_note = values.blocked_note;
    }
    // Finding M1: due date is already stored formatted as `YYYY-MM-DD` (or null),
    // mirroring the legacy `moment(obj.due_date).format("YYYY-MM-DD")` reshape
    // applied before save; pass the changed value straight through.
    if (values.due_date !== (story.due_date ?? null)) {
        modified.due_date = values.due_date;
    }
    if (values.team_requirement !== Boolean(story.team_requirement)) {
        modified.team_requirement = values.team_requirement;
    }
    if (values.client_requirement !== Boolean(story.client_requirement)) {
        modified.client_requirement = values.client_requirement;
    }
    return modified;
}


/**
 * Run the attachment add/delete lifecycle for a saved story (finding M1),
 * reproducing the legacy `CreateEditDirective` submit tail
 * (`common/lightboxes.coffee` L790): `deleteAttachments(data).then(->
 * createAttachments(data))`. Deletions complete BEFORE uploads start; within
 * each phase the requests run in parallel (legacy `$q.all`). Both phases are
 * no-ops when their queue is empty, so an ordinary attachment-free create/edit
 * incurs no extra request.
 *
 * The two persistence functions are injected (the screen hooks pass
 * `apiClient.createUserStoryAttachment` / `.deleteUserStoryAttachment`) so this
 * module stays framework- and client-agnostic like the rest of the file.
 */
export async function applyStoryAttachments(
    values: StoryFormValues,
    projectId: number,
    userStoryId: number,
    createAttachment: (projectId: number, userStoryId: number, file: File) => Promise<unknown>,
    deleteAttachment: (attachmentId: number) => Promise<void>,
): Promise<void> {
    if (values.attachmentsToDelete.length > 0) {
        await Promise.all(values.attachmentsToDelete.map((id) => deleteAttachment(id)));
    }
    if (values.attachmentsToAdd.length > 0) {
        await Promise.all(
            values.attachmentsToAdd.map((file) => createAttachment(projectId, userStoryId, file)),
        );
    }
}
