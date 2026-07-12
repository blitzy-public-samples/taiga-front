/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type {
    MountContext,
    UserStory,
    Milestone,
    SprintListResult,
    Status,
} from "../types";
import { resolveUrl, buildUrl, type EndpointKey, type QueryParams } from "./urls";
import { httpGet, httpPost, httpPatch, request, parseHeaderInt } from "./http";

/** A single {us_id, order} pair used by the milestone/move bulk payloads. */
export interface BulkStoryOrder {
    us_id: number;
    order: number;
}

/** Minimal shape required to run the dirty-field PATCH save. */
export interface SavableEntity {
    id: number;
    version?: number;
    [key: string]: unknown;
}

/**
 * Thin call-through facade over the frozen `/api/v1/` REST surface. Mirrors the
 * request-shaping of `resources/{userstories,sprints}.coffee` +
 * `base/{repository,http,urls,model}.coffee` over the wire only (no AngularJS import).
 */
export const createApiClient = (context: MountContext) => {
    const resolve = (key: EndpointKey, ...ids: ReadonlyArray<string | number>): string =>
        resolveUrl(context.apiUrl, key, ...ids);

    return {
        /** Slug -> numeric project id (mirrors base/repository.coffee `resolve`). */
        resolveProject: async (slug: string): Promise<number> => {
            const url = buildUrl(resolve("resolver"), { project: slug });
            const response = await httpGet<{ project: number }>(context, url);
            return response.data.project;
        },

        getUserStory: async (
            projectId: number,
            usId: number,
            extraParams: QueryParams = {},
        ): Promise<UserStory> => {
            const url = buildUrl(`${resolve("userstories")}/${usId}`, { project: projectId, ...extraParams });
            const response = await httpGet<UserStory>(context, url);
            return response.data;
        },

        getUserStoryByRef: async (
            projectId: number,
            ref: number,
            extraParams: QueryParams = {},
        ): Promise<UserStory> => {
            const url = buildUrl(`${resolve("userstories")}/by_ref`, { project: projectId, ref, ...extraParams });
            const response = await httpGet<UserStory>(context, url);
            return response.data;
        },

        getUserStoriesFilters: async (params: QueryParams = {}): Promise<unknown> => {
            const url = buildUrl(resolve("userstories-filters"), params);
            const response = await httpGet<unknown>(context, url);
            return response.data;
        },

        listUserStories: async (filters: QueryParams = {}): Promise<UserStory[]> => {
            const url = buildUrl(resolve("userstories"), filters);
            const response = await httpGet<UserStory[]>(context, url);
            return response.data;
        },

        bulkCreateUserStories: async (
            projectId: number,
            statusId: number | null,
            bulkStories: string,
            swimlaneId: number | null,
        ): Promise<UserStory[]> => {
            const body = {
                project_id: projectId,
                status_id: statusId,
                bulk_stories: bulkStories,
                swimlane_id: swimlaneId,
            };
            const response = await httpPost<UserStory[]>(context, resolve("bulk-create-us"), body);
            return response.data;
        },

        /** The single call issued on a kanban drop. */
        bulkUpdateKanbanOrder: async (
            projectId: number,
            statusId: number,
            swimlaneId: number | null,
            afterUserStoryId: number | null,
            beforeUserStoryId: number | null,
            bulkUserStories: number[],
        ): Promise<UserStory[]> => {
            const body: Record<string, unknown> = {
                project_id: projectId,
                status_id: statusId,
                bulk_userstories: bulkUserStories,
            };
            if (afterUserStoryId) {
                body.after_userstory_id = afterUserStoryId;
            } else if (beforeUserStoryId) {
                body.before_userstory_id = beforeUserStoryId;
            }
            if (swimlaneId) {
                body.swimlane_id = swimlaneId;
            }
            const response = await httpPost<UserStory[]>(context, resolve("bulk-update-us-kanban-order"), body);
            return response.data;
        },

        bulkUpdateBacklogOrder: async (
            projectId: number,
            milestoneId: number | null,
            afterUserStoryId: number | null,
            beforeUserStoryId: number | null,
            bulkUserStories: number[],
        ): Promise<UserStory[]> => {
            const body: Record<string, unknown> = {
                project_id: projectId,
                bulk_userstories: bulkUserStories,
            };
            if (milestoneId) {
                body.milestone_id = milestoneId;
            }
            if (afterUserStoryId) {
                body.after_userstory_id = afterUserStoryId;
            } else if (beforeUserStoryId) {
                body.before_userstory_id = beforeUserStoryId;
            }
            const response = await httpPost<UserStory[]>(context, resolve("bulk-update-us-backlog-order"), body);
            return response.data;
        },

        bulkUpdateMilestone: async (
            projectId: number,
            milestoneId: number | null,
            bulkStories: BulkStoryOrder[],
        ): Promise<UserStory[]> => {
            const body = { project_id: projectId, milestone_id: milestoneId, bulk_stories: bulkStories };
            const response = await httpPost<UserStory[]>(context, resolve("bulk-update-us-milestone"), body);
            return response.data;
        },

        moveUserStoriesToMilestone: async (
            currentMilestoneId: number,
            projectId: number,
            milestoneId: number,
            bulkStories: BulkStoryOrder[],
        ): Promise<void> => {
            const url = resolve("move-userstories-to-milestone", currentMilestoneId);
            const body = { project_id: projectId, milestone_id: milestoneId, bulk_stories: bulkStories };
            await httpPost(context, url, body);
        },

        /** PATCH a status' WIP limit (mirrors UserstoriesResource.editStatus). */
        editStatus: async (statusId: number, wipLimit: number | null): Promise<Status> => {
            const url = `${resolve("userstory-statuses")}/${statusId}`;
            const response = await httpPatch<Status>(context, url, { wip_limit: wipLimit });
            return response.data;
        },

        upvoteUserStory: async (usId: number): Promise<void> => {
            await httpPost(context, resolve("userstory-upvote", usId));
        },

        downvoteUserStory: async (usId: number): Promise<void> => {
            await httpPost(context, resolve("userstory-downvote", usId));
        },

        watchUserStory: async (usId: number): Promise<void> => {
            await httpPost(context, resolve("userstory-watch", usId));
        },

        unwatchUserStory: async (usId: number): Promise<void> => {
            await httpPost(context, resolve("userstory-unwatch", usId));
        },

        getMilestone: async (sprintId: number): Promise<Milestone> => {
            const url = `${resolve("milestones")}/${sprintId}`;
            const response = await httpGet<Milestone>(context, url);
            return response.data;
        },

        getMilestoneStats: async (sprintId: number): Promise<unknown> => {
            const url = `${resolve("milestones")}/${sprintId}/stats`;
            const response = await httpGet<unknown>(context, url);
            return response.data;
        },

        /** List sprints + parse the Taiga-Info total headers (mirrors SprintsResource.list). */
        listMilestones: async (projectId: number, filters: QueryParams = {}): Promise<SprintListResult> => {
            const url = buildUrl(resolve("milestones"), { project: projectId, ...filters });
            const response = await httpGet<Milestone[]>(context, url);
            return {
                milestones: response.data,
                closed: parseHeaderInt(response.headers, "Taiga-Info-Total-Closed-Milestones"),
                open: parseHeaderInt(response.headers, "Taiga-Info-Total-Opened-Milestones"),
            };
        },

        /** Create a resource (mirrors base/repository.coffee `create`). */
        create: async <T>(name: EndpointKey, data: Record<string, unknown>): Promise<T> => {
            const response = await httpPost<T>(context, resolve(name), data);
            return response.data;
        },

        /**
         * Dirty-field PATCH with optimistic concurrency (mirrors repository.save +
         * model.getAttrs): skip the request entirely when nothing is modified;
         * PATCH sends only the changed attrs and ALWAYS includes `version`; PUT sends all.
         * The response body replaces local attrs (incl. the new `version`).
         */
        save: async <T extends SavableEntity>(
            name: EndpointKey,
            entity: T,
            modifiedAttrs: Record<string, unknown>,
            patch = true,
        ): Promise<T> => {
            if (patch && Object.keys(modifiedAttrs).length === 0) {
                return entity;
            }

            const url = `${resolve(name)}/${entity.id}`;

            let payload: Record<string, unknown>;
            if (patch) {
                payload = { ...modifiedAttrs };
                if (entity.version !== undefined && entity.version !== null) {
                    payload.version = entity.version;
                }
            } else {
                payload = { ...entity };
            }

            const response = await request<Record<string, unknown>>(
                context,
                patch ? "PATCH" : "PUT",
                url,
                { body: payload },
            );

            return { ...entity, ...response.data } as T;
        },

        /** DELETE a resource (mirrors base/repository.coffee `remove`). */
        remove: async (name: EndpointKey, id: number): Promise<void> => {
            await request<null>(context, "DELETE", `${resolve(name)}/${id}`, {});
        },
    };
};

/** The facade instance type, derived from the factory to avoid signature drift. */
export type ApiClient = ReturnType<typeof createApiClient>;
