/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * User-story API functions hitting the FROZEN Django `/api/v1/userstories`
 * endpoints. Endpoint paths and request bodies are ported VERBATIM from the
 * AngularJS resource layer:
 *   - paths:  app/coffee/modules/resources.coffee (L107-L113)
 *   - bodies: app/coffee/modules/resources/userstories.coffee (L64-L129)
 *   - kanban drop call site: app/coffee/modules/kanban/main.coffee (L604-L625)
 *   - backlog drop call site: app/coffee/modules/backlog/main.coffee (L536-L608)
 *
 * Argument order mirrors the CoffeeScript service methods exactly so callers
 * translate 1:1. No route is invented; `/api/v1/` is frozen and the backend
 * pytest suite is the authoritative contract guard.
 */

import { httpGet, httpPost } from "./httpClient";
import type { HttpResponse, QueryParams } from "./httpClient";

/** An id that may be absent (e.g. no "after"/"before" neighbor, or backlog with no milestone). */
export type OptionalId = number | null | undefined;

/** Minimal structural user-story shape returned by the list/bulk endpoints. */
export interface UserStory {
    id: number;
    [key: string]: unknown;
}

/** One entry of the `bulk_stories` payload for `bulk_update_milestone` (see backlog/main.coffee L793-799). */
export interface BulkMilestoneStory {
    us_id: number;
    order: number;
}

/** Response of `GET /userstories/filters_data`. */
export type FiltersData = Record<string, unknown>;

/** Request body for `POST /userstories/bulk_create`. */
interface BulkCreateBody {
    project_id: number;
    status_id: number;
    /** Newline-separated user-story titles (see common/lightboxes.coffee `$scope.new.bulk`). */
    bulk_stories: string;
    swimlane_id: number | null;
}

/** Request body for `POST /userstories/bulk_update_backlog_order`. */
interface BulkUpdateOrderBody {
    project_id: number;
    bulk_userstories: number[];
    milestone_id?: number;
    after_userstory_id?: number;
    before_userstory_id?: number;
}

/** Request body for `POST /userstories/bulk_update_kanban_order`. */
interface BulkUpdateKanbanOrderBody {
    project_id: number;
    status_id: number;
    bulk_userstories: number[];
    after_userstory_id?: number;
    before_userstory_id?: number;
    swimlane_id?: number;
}

/** Request body for `POST /userstories/bulk_update_milestone`. */
interface BulkUpdateMilestoneBody {
    project_id: number;
    milestone_id: number;
    bulk_stories: BulkMilestoneStory[];
}

/**
 * The AngularJS repository sends `x-disable-pagination: "1"` on read requests
 * whenever pagination is not explicitly enabled (repository.coffee L138-L140,
 * L166-L168). Reproduced here so list/filter reads return the full result set.
 */
const DISABLE_PAGINATION: Record<string, string> = { "x-disable-pagination": "1" };

/**
 * `GET /userstories?project=<id>&...` — list user stories for a project.
 * Mirrors `userstories.listAll` (userstories.coffee L56-L62).
 */
export function listUserstories(
    projectId: number,
    filters?: QueryParams,
): Promise<HttpResponse<UserStory[]>> {
    const params: QueryParams = { project: projectId, ...(filters ?? {}) };

    return httpGet<UserStory[]>("/userstories", params, DISABLE_PAGINATION);
}

/**
 * `GET /userstories/filters_data` — filters metadata for the sidebar.
 * Mirrors `userstories.filtersData` (userstories.coffee L41-L42 via queryOneRaw).
 */
export function filtersData(params?: QueryParams): Promise<HttpResponse<FiltersData>> {
    return httpGet<FiltersData>("/userstories/filters_data", params, DISABLE_PAGINATION);
}

/**
 * `POST /userstories/bulk_create` — create many stories from newline-separated text.
 * Body `{ project_id, status_id, bulk_stories, swimlane_id }`; `swimlane_id` is
 * ALWAYS included (userstories.coffee L64-L74).
 */
export function bulkCreate(
    projectId: number,
    statusId: number,
    bulkStories: string,
    swimlaneId: number | null,
): Promise<HttpResponse<UserStory[]>> {
    const body: BulkCreateBody = {
        project_id: projectId,
        status_id: statusId,
        bulk_stories: bulkStories,
        swimlane_id: swimlaneId,
    };

    return httpPost<UserStory[]>("/userstories/bulk_create", body);
}

/**
 * `POST /userstories/bulk_update_backlog_order` — persist backlog drag order.
 * Body `{ project_id, bulk_userstories }` plus optional `milestone_id`, and
 * `after_userstory_id` XOR `before_userstory_id` (userstories.coffee L92-L105).
 */
export function bulkUpdateBacklogOrder(
    projectId: number,
    milestoneId: OptionalId,
    afterUserstoryId: OptionalId,
    beforeUserstoryId: OptionalId,
    bulkUserstories: number[],
): Promise<HttpResponse<UserStory[]>> {
    const body: BulkUpdateOrderBody = {
        project_id: projectId,
        bulk_userstories: bulkUserstories,
    };

    if (milestoneId) {
        body.milestone_id = milestoneId;
    }

    if (afterUserstoryId) {
        body.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        body.before_userstory_id = beforeUserstoryId;
    }

    return httpPost<UserStory[]>("/userstories/bulk_update_backlog_order", body);
}

/**
 * `POST /userstories/bulk_update_milestone` — move stories to a milestone.
 * Body `{ project_id, milestone_id, bulk_stories }` where `bulk_stories` is an
 * array of `{ us_id, order }` (userstories.coffee L107-L110; backlog/main.coffee L793-799).
 *
 * The frozen backend responds `204 No Content` with an EMPTY body, so
 * `HttpResponse.data` resolves to `undefined` at runtime; the return type is
 * therefore `HttpResponse<void>` rather than `HttpResponse<UserStory[]>`.
 */
export function bulkUpdateMilestone(
    projectId: number,
    milestoneId: number,
    bulkStories: BulkMilestoneStory[],
): Promise<HttpResponse<void>> {
    const body: BulkUpdateMilestoneBody = {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: bulkStories,
    };

    return httpPost<void>("/userstories/bulk_update_milestone", body);
}

/**
 * `POST /userstories/bulk_update_kanban_order` — persist kanban drag order.
 * Body `{ project_id, status_id, bulk_userstories }` plus `after_userstory_id`
 * XOR `before_userstory_id`, and `swimlane_id` ONLY when truthy
 * (userstories.coffee L112-L129).
 *
 * The caller is responsible for mapping swimlane `-1 -> null` before calling
 * (kanban/main.coffee L604-L607); passing `null`/`0` here omits `swimlane_id`.
 */
export function bulkUpdateKanbanOrder(
    projectId: number,
    statusId: number,
    swimlaneId: number | null,
    afterUserstoryId: OptionalId,
    beforeUserstoryId: OptionalId,
    bulkUserstories: number[],
): Promise<HttpResponse<UserStory[]>> {
    const body: BulkUpdateKanbanOrderBody = {
        project_id: projectId,
        status_id: statusId,
        bulk_userstories: bulkUserstories,
    };

    if (afterUserstoryId) {
        body.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        body.before_userstory_id = beforeUserstoryId;
    }

    if (swimlaneId) {
        body.swimlane_id = swimlaneId;
    }

    return httpPost<UserStory[]>("/userstories/bulk_update_kanban_order", body);
}
