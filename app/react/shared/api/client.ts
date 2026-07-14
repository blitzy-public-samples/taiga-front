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
    Attachment,
    Milestone,
    SprintListResult,
    Status,
    Project,
    Swimlane,
} from "../types";
import { resolveUrl, buildUrl, type EndpointKey, type QueryParams } from "./urls";
import { httpGet, httpPost, httpPatch, httpDelete, request, parseHeaderInt } from "./http";
import { generateHash } from "../storage/legacyStorage";

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
 * Project statistics returned by `GET /projects/{id}/stats` (mirrors the legacy
 * `ProjectsResource.stats` -> `queryOneRaw`, which returns the raw JSON body).
 * The point/milestone totals below are the fields the Backlog burndown summary and
 * the Kanban stats read; the index signature preserves the remaining backend keys
 * without over-constraining the frozen contract.
 */
export interface ProjectStats {
    total_milestones?: number | null;
    total_points?: number | null;
    closed_points?: number | null;
    defined_points?: number | null;
    assigned_points?: number | null;
    total_userstories?: number | null;
    [key: string]: unknown;
}

/**
 * Tag -> color map returned by `GET /projects/{id}/tags_colors` (mirrors the legacy
 * `ProjectsResource.tagsColors`). Each value is a hex color or null (no color set).
 */
export type TagsColors = Record<string, string | null>;

/**
 * Result of the paginated unassigned-user-story listing, mirroring the legacy
 * `UserstoriesResource.listUnassigned` (`queryMany` with `enablePagination`), which
 * returns the story models plus the `x-pagination-*` headers. The Backlog uses
 * `count` as the "total unassigned points/stories" figure.
 */
export interface UnassignedUserStoriesResult {
    userStories: UserStory[];
    count: number;
    current: number;
    paginatedBy: number;
    /**
     * M2: `true` when the backend advertises a NEXT page via the
     * `X-Pagination-Next` header (legacy `header('x-pagination-next')`), driving
     * the Backlog's page advancement / infinite-scroll "load more".
     */
    hasNext: boolean;
    /**
     * M2: the AUTHORITATIVE backlog total from `Taiga-Info-Backlog-Total-Userstories`
     * (taiga-back sets it ONLY when `milestone=null`, which the backlog list
     * always requests — see `userstories/api.py#_add_taiga_info_headers`).
     * `null` when the header is absent so callers fall back to the page length.
     */
    backlogTotal: number | null;
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

        /**
         * Full project-detail metadata by slug (mirrors ProjectsResource.getBySlug ->
         * `queryOne("projects", "by_slug?slug=…")`): GET /projects/by_slug?slug=<slug>.
         * The response carries activation flags, `my_permissions`, statuses, roles,
         * points, members, and totals that the Kanban/Backlog hooks gate + render on.
         */
        getProjectBySlug: async (slug: string): Promise<Project> => {
            const url = buildUrl(`${resolve("projects")}/by_slug`, { slug });
            const response = await httpGet<Project>(context, url);
            return response.data;
        },

        /** Project stats (mirrors ProjectsResource.stats): GET /projects/{id}/stats. */
        getProjectStats: async (projectId: number): Promise<ProjectStats> => {
            const url = `${resolve("projects")}/${projectId}/stats`;
            const response = await httpGet<ProjectStats>(context, url);
            return response.data;
        },

        /** Tag colors (mirrors ProjectsResource.tagsColors): GET /projects/{id}/tags_colors. */
        getProjectTagsColors: async (projectId: number): Promise<TagsColors> => {
            const url = `${resolve("projects")}/${projectId}/tags_colors`;
            const response = await httpGet<TagsColors>(context, url);
            return response.data;
        },

        /** Project swimlanes (mirrors SwimlanesResource.list): GET /swimlanes?project=<id>. */
        listSwimlanes: async (projectId: number): Promise<Swimlane[]> => {
            const url = buildUrl(resolve("swimlanes"), { project: projectId });
            const response = await httpGet<Swimlane[]>(context, url);
            return response.data;
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

        /**
         * List the attachments of a user story (finding C6). Mirrors the legacy
         * attachments resource `list("us", objId, projectId)` -> GET
         * `/userstories/attachments?object_id=<usId>&project=<projectId>`
         * (`resources.coffee` "attachments/us"). Contract-preserving (C-1): the
         * same frozen endpoint and query shape the AngularJS US-detail screen
         * used (`attachments.service` `loadAttachments`). The edit flow fetches
         * these BEFORE opening the form so attachments are seeded on the model
         * rather than silently dropped.
         */
        listUserStoryAttachments: async (
            projectId: number,
            usId: number,
        ): Promise<Attachment[]> => {
            const url = buildUrl(resolve("us-attachments"), { object_id: usId, project: projectId });
            const response = await httpGet<Attachment[]>(context, url);
            return response.data;
        },

        /**
         * Upload one attachment for a user story (finding M1). Mirrors the legacy
         * `attachmentsService.upload(file, objectId, project, "us")` ->
         * `attachments-resource.service` `create`, which POSTs a
         * `multipart/form-data` body of `{project, object_id, attached_file,
         * from_comment}` to `/userstories/attachments`. The `FormData` is handed
         * to the transport via `options.formData` so it is sent unserialized and
         * the browser sets the multipart boundary (see http.ts M1 branch); the
         * bearer / session headers stay merged-last + immutable (M10).
         * Contract-preserving (C-1): identical endpoint, verb, and field names.
         */
        createUserStoryAttachment: async (
            projectId: number,
            usId: number,
            file: File,
        ): Promise<Attachment> => {
            const form = new FormData();
            form.append("project", String(projectId));
            form.append("object_id", String(usId));
            form.append("attached_file", file);
            form.append("from_comment", "false");
            const response = await httpPost<Attachment>(context, resolve("us-attachments"), undefined, {
                formData: form,
            });
            return response.data;
        },

        /**
         * Delete one user-story attachment by id (finding M1). Mirrors the legacy
         * `attachmentsService.delete("us", id)` -> DELETE
         * `/userstories/attachments/{id}`. Contract-preserving (C-1).
         */
        deleteUserStoryAttachment: async (attachmentId: number): Promise<void> => {
            const url = `${resolve("us-attachments")}/${attachmentId}`;
            await httpDelete<null>(context, url);
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

        /**
         * Paginated unassigned-user-story listing (mirrors UserstoriesResource.listUnassigned:
         * `queryMany("userstories", {project, milestone:"null", …, page_size}, {enablePagination:true}, true)`).
         * GET /userstories?project=<id>&milestone=null&page_size=<n> WITHOUT the
         * `x-disable-pagination` header (via `enablePagination`), so the backend paginates
         * and returns the `x-pagination-*` totals the Backlog reads. `current` defaults to
         * 1 when the header is absent, matching `queryPaginated`'s `… or 1` fallback.
         */
        listUnassignedUserStories: async (
            projectId: number,
            filters: QueryParams = {},
            pageSize?: number,
        ): Promise<UnassignedUserStoriesResult> => {
            const url = buildUrl(resolve("userstories"), {
                project: projectId,
                milestone: "null",
                ...filters,
                page_size: pageSize,
            });
            const response = await httpGet<UserStory[]>(context, url, { enablePagination: true });
            const rawCurrent = response.headers.get("x-pagination-current");
            // M2: `X-Pagination-Next` carries the next-page URL when more pages
            // exist; its mere PRESENCE is the "has more" signal (legacy checked
            // `if header('x-pagination-next')`).
            const rawTotal = response.headers.get("Taiga-Info-Backlog-Total-Userstories");
            return {
                userStories: response.data,
                count: parseHeaderInt(response.headers, "x-pagination-count"),
                current: rawCurrent ? parseHeaderInt(response.headers, "x-pagination-current") : 1,
                paginatedBy: parseHeaderInt(response.headers, "x-paginated-by"),
                hasNext: response.headers.get("x-pagination-next") !== null,
                backlogTotal: rawTotal !== null ? parseInt(rawTotal, 10) : null,
            };
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
         * PATCH sends only the changed attrs and ALWAYS includes `version`; PUT
         * sends the full entity MERGED WITH the modified attrs (mirroring
         * `model.getAttrs(patch=false)` = `_.extend({}, attrs, modifiedAttrs)`).
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
                // PUT mirrors the frozen `model.getAttrs(patch=false)` =
                // `_.extend({}, @._attrs, @._modifiedAttrs)`: the full entity merged
                // with the modified attrs (modified taking precedence). Merging
                // `modifiedAttrs` is REQUIRED so the caller's intended change is sent
                // rather than silently dropped by a bare `{ ...entity }` copy.
                payload = { ...entity, ...modifiedAttrs };
            }

            const response = await request<Record<string, unknown>>(
                context,
                patch ? "PATCH" : "PUT",
                url,
                { body: payload },
            );

            return { ...entity, ...response.data } as T;
        },

        /**
         * Read a per-user custom-filter map from `user-storage` (faithful
         * reproduction of `tgFilterRemoteStorageService.getFilters`,
         * filter-remote.service.coffee). The storage entry key is
         * `generateHash([projectId, "<projectId>:<suffix>"])`; the stored blob is
         * `{ key, value }` and the filter map lives under `value`. A missing entry
         * (404) resolves to `{}` — exactly the legacy `deferred.resolve({})` on the
         * error path — so callers never see a rejection for "no filters saved yet".
         */
        getUserFilters: async (
            projectId: number,
            suffix: string,
        ): Promise<Record<string, unknown>> => {
            const hash = generateHash([projectId, `${projectId}:${suffix}`]);
            const url = `${resolve("user-storage")}/${encodeURIComponent(hash)}`;
            try {
                const response = await httpGet<{ value?: unknown }>(context, url);
                const value = response.data?.value;
                return value && typeof value === "object"
                    ? (value as Record<string, unknown>)
                    : {};
            } catch {
                return {};
            }
        },

        /**
         * Persist a per-user custom-filter map to `user-storage` (faithful
         * reproduction of `tgFilterRemoteStorageService.storeFilters`). An empty
         * map DELETEs the entry; otherwise it PUTs `{ key, value }` to the keyed
         * URL, and — when the entry does not exist yet (the PUT 404s) — falls back
         * to POSTing to the collection, mirroring the legacy inner-promise retry.
         */
        storeUserFilters: async (
            projectId: number,
            filters: Record<string, unknown>,
            suffix: string,
        ): Promise<void> => {
            const hash = generateHash([projectId, `${projectId}:${suffix}`]);
            const base = resolve("user-storage");
            const keyedUrl = `${base}/${encodeURIComponent(hash)}`;
            const payload = { key: hash, value: filters };
            if (!filters || Object.keys(filters).length === 0) {
                try {
                    await request<null>(context, "DELETE", keyedUrl, { body: payload });
                } catch {
                    /* already absent — treat as success (legacy resolve()) */
                }
                return;
            }
            try {
                await request<unknown>(context, "PUT", keyedUrl, { body: payload });
            } catch {
                // Entry does not exist yet -> create it on the collection endpoint.
                await httpPost<unknown>(context, base, payload);
            }
        },

        /** DELETE a resource (mirrors base/repository.coffee `remove`). */
        remove: async (name: EndpointKey, id: number): Promise<void> => {
            await request<null>(context, "DELETE", `${resolve(name)}/${id}`, {});
        },
    };
};

/** The facade instance type, derived from the factory to avoid signature drift. */
export type ApiClient = ReturnType<typeof createApiClient>;
