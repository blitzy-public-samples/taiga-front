/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the SHARED story-form request builders
 * (`shared/lightboxes/storyPayload.ts`): `buildCreateStoryPayload` (POST body),
 * `diffStoryValues` (dirty PATCH subset) and `applyStoryAttachments` (finding M1
 * attachment add/delete lifecycle). Framework-free, so no DOM is needed.
 */

import { createEmptyStoryValues, type StoryFormValues } from "./storyForm";
import {
    buildCreateStoryPayload,
    diffStoryValues,
    applyStoryAttachments,
} from "./storyPayload";
import type { UserStory } from "../types";

describe("storyPayload — buildCreateStoryPayload", () => {
    it("includes only defined/non-empty fields, omitting us_position", () => {
        const values = createEmptyStoryValues({ subject: "New story", status: 5 });
        const payload = buildCreateStoryPayload(7, 5, values);
        expect(payload).toEqual({ project: 7, status: 5, subject: "New story" });
        expect(payload).not.toHaveProperty("us_position");
    });

    it("includes M1 due_date + team/client requirement only when set/true", () => {
        const values = createEmptyStoryValues({
            subject: "S",
            status: 5,
            due_date: "2021-06-15",
            team_requirement: true,
            client_requirement: false,
        });
        const payload = buildCreateStoryPayload(7, 5, values);
        expect(payload.due_date).toBe("2021-06-15");
        expect(payload.team_requirement).toBe(true);
        // client_requirement is false -> omitted (backend defaults false).
        expect(payload).not.toHaveProperty("client_requirement");
    });

    it("omits due_date + both requirement flags when unset/false", () => {
        const values = createEmptyStoryValues({ subject: "S", status: 5 });
        const payload = buildCreateStoryPayload(7, 5, values);
        expect(payload).not.toHaveProperty("due_date");
        expect(payload).not.toHaveProperty("team_requirement");
        expect(payload).not.toHaveProperty("client_requirement");
    });
});

describe("storyPayload — diffStoryValues (M1 fields)", () => {
    const story: UserStory = {
        id: 1,
        status: 5,
        swimlane: null,
        subject: "Existing",
        due_date: null,
        team_requirement: false,
        client_requirement: false,
    };

    function values(overrides: Partial<StoryFormValues>): StoryFormValues {
        return createEmptyStoryValues({ subject: "Existing", status: 5, ...overrides });
    }

    it("emits a changed due_date and leaves it out when unchanged", () => {
        expect(diffStoryValues(story, values({ due_date: "2021-01-02" }))).toEqual({
            due_date: "2021-01-02",
        });
        expect(diffStoryValues(story, values({ due_date: null }))).toEqual({});
    });

    it("emits toggled team_requirement / client_requirement", () => {
        expect(diffStoryValues(story, values({ team_requirement: true }))).toEqual({
            team_requirement: true,
        });
        expect(diffStoryValues(story, values({ client_requirement: true }))).toEqual({
            client_requirement: true,
        });
    });

    it("emits nothing when the M1 fields are untouched", () => {
        expect(diffStoryValues(story, values({}))).toEqual({});
    });
});

describe("storyPayload — applyStoryAttachments (M1 lifecycle)", () => {
    it("deletes queued ids BEFORE uploading queued files, and is a no-op when empty", async () => {
        const order: string[] = [];
        const create = jest.fn(async (): Promise<unknown> => {
            order.push("create");
            return {};
        });
        const del = jest.fn(async (): Promise<void> => {
            order.push("delete");
        });

        // No-op when both queues empty.
        await applyStoryAttachments(createEmptyStoryValues({ subject: "s" }), 7, 1, create, del);
        expect(create).not.toHaveBeenCalled();
        expect(del).not.toHaveBeenCalled();

        const fileA = new File(["a"], "a.txt");
        const fileB = new File(["b"], "b.txt");
        const values = createEmptyStoryValues({
            subject: "s",
            attachmentsToAdd: [fileA, fileB],
            attachmentsToDelete: [10, 11],
        });
        await applyStoryAttachments(values, 7, 99, create, del);

        expect(del).toHaveBeenCalledTimes(2);
        expect(del).toHaveBeenCalledWith(10);
        expect(del).toHaveBeenCalledWith(11);
        expect(create).toHaveBeenCalledTimes(2);
        expect(create).toHaveBeenCalledWith(7, 99, fileA);
        expect(create).toHaveBeenCalledWith(7, 99, fileB);
        // Deletions complete before any upload starts (legacy ordering).
        expect(order.indexOf("create")).toBeGreaterThan(order.lastIndexOf("delete"));
    });
});
