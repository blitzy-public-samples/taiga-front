/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * userstories.ts — typed async wrappers over the `/api/v1/userstories/…` bulk
 * endpoints consumed by the migrated React Kanban and Backlog screens.
 *
 * WHAT THIS IS
 *   The React-side equivalent of the AngularJS user-story data service
 *   `app/coffee/modules/resources/userstories.coffee`. Every function here
 *   reproduces the EXACT request body its CoffeeScript counterpart sent so the
 *   Django REST backend cannot distinguish React traffic from AngularJS traffic
 *   (AAP §0.1.1, §0.6.1, §0.6.5, §0.7.1). The endpoint paths are taken verbatim
 *   from the AngularJS URL map (`app/coffee/modules/resources.coffee:106-113`);
 *   they are never invented here.
 *
 * WHAT THIS IS NOT
 *   - It NEVER imports `resources.coffee`, `$tgHttp`, `$tgUrls`, or any other
 *     AngularJS service, and it pulls in NONE of the globally-loaded libraries
 *     that the migration replaces internally (Immutable.js, dragula,
 *     dom-autoscroller, checksley).
 *   - It owns NO transport concerns. URL joining, `Authorization: Bearer <jwt>`
 *     / `X-Session-Id` header attachment, JSON encoding, query-string
 *     serialization and error handling are ALL delegated to the shared `api`
 *     adapter from `./client`, which already prefixes `getApiUrl()`. Callers
 *     therefore pass only endpoint paths beginning with `/userstories/…`.
 *
 * FIDELITY NOTES (see the per-function docs for line references)
 *   - The backend `bulk_stories` field is OVERLOADED: for {@link bulkCreate} it
 *     is a newline-separated STRING of subjects; for {@link bulkUpdateMilestone}
 *     it is an ARRAY of {@link BulkUserStoryOrder}. The two are typed distinctly
 *     below.
 *   - The `after_userstory_id` / `before_userstory_id` pair is mutually
 *     exclusive with `after` winning when both are truthy, mirroring the coffee
 *     `if … else if …` blocks exactly.
 *   - `milestone_id` (backlog/sprint order) and `swimlane_id` (kanban order) are
 *     included only when truthy, reproducing the coffee `if milestoneId` /
 *     `if swimlaneId` guards. {@link bulkCreate} and {@link bulkUpdateMilestone}
 *     are the deliberate exceptions: they always include `swimlane_id` /
 *     `milestone_id` respectively because the coffee passes them unconditionally.
 *
 * Toolchain: pure TypeScript 5.4.5 under `strict` (no React/JSX here), Node
 * v16.19.1 compatible, bundled by esbuild into `dist/js/react.js`.
 */

import { api } from './client';
import type { UserStory, FiltersData } from '../types';

/**
 * A single entry in a bulk-order payload: the user-story id together with its
 * new position within the target list.
 *
 * This mirrors the object the AngularJS backlog controller built when it mapped
 * a list of stories to `{ us_id: x.id, order: x[field] }`
 * (`app/coffee/modules/backlog/main.coffee:504-505`). `../types` has no
 * equivalent, and this type is intentionally declared HERE so the `api/` layer
 * stays self-contained (the sibling `types.ts` is not edited).
 */
export interface BulkUserStoryOrder {
    /** The id of the user story being (re)ordered. */
    us_id: number;
    /** The story's new zero-based position within its target list. */
    order: number;
}

/**
 * Bulk-create user stories under a status (and optional swimlane).
 *
 * Reproduces `service.bulkCreate`
 * (`app/coffee/modules/resources/userstories.coffee:64-74`) →
 * `POST /userstories/bulk_create`.
 *
 * @param projectId   The target project id (`project_id`).
 * @param statusId    The status the new stories are created under (`status_id`).
 * @param bulkStories A newline-separated STRING of subjects — one story per
 *                    line — mirroring the AngularJS `bulk` argument
 *                    (`bulk_stories`).
 * @param swimlaneId  The target swimlane id, or `null`. ALWAYS included in the
 *                    body (even when `null`), exactly as the coffee did
 *                    (`swimlane_id`).
 * @returns The list of created {@link UserStory} objects.
 */
export function bulkCreate(
    projectId: number,
    statusId: number,
    bulkStories: string,
    swimlaneId: number | null,
): Promise<UserStory[]> {
    return api.post<UserStory[]>('/userstories/bulk_create', {
        project_id: projectId,
        status_id: statusId,
        bulk_stories: bulkStories,
        swimlane_id: swimlaneId,
    });
}

/**
 * Reorder stories within the backlog, optionally moving them into a milestone
 * and anchoring the move after/before a sibling story.
 *
 * Reproduces `service.bulkUpdateBacklogOrder`
 * (`app/coffee/modules/resources/userstories.coffee:92-105`) →
 * `POST /userstories/bulk_update_backlog_order`.
 *
 * Body construction preserves the coffee logic EXACTLY:
 *   - `project_id` and `bulk_userstories` are always present;
 *   - `milestone_id` is added only when `milestoneId` is truthy
 *     (coffee `if milestoneId`);
 *   - `after_userstory_id` and `before_userstory_id` are MUTUALLY EXCLUSIVE and
 *     `after_userstory_id` wins when both are truthy (coffee `if … else if …`).
 *
 * @param projectId         The target project id (`project_id`).
 * @param milestoneId       Destination milestone id, or `null` to leave the
 *                          milestone unchanged. Included only when truthy.
 * @param afterUserstoryId  Anchor: place the moved stories AFTER this story.
 *                          Takes precedence over `beforeUserstoryId`.
 * @param beforeUserstoryId Anchor: place the moved stories BEFORE this story.
 *                          Used only when `afterUserstoryId` is falsy.
 * @param bulkUserstories   The ordered `{ us_id, order }` entries to persist.
 */
export function bulkUpdateBacklogOrder(
    projectId: number,
    milestoneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: BulkUserStoryOrder[],
): Promise<unknown> {
    const params: Record<string, unknown> = {
        project_id: projectId,
        bulk_userstories: bulkUserstories,
    };

    // coffee: `if milestoneId` — include only when truthy.
    if (milestoneId) {
        params.milestone_id = milestoneId;
    }

    // coffee: `if afterUserstoryId … else if beforeUserstoryId` — exactly one of
    // the two anchors, with `after` taking precedence.
    if (afterUserstoryId) {
        params.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        params.before_userstory_id = beforeUserstoryId;
    }

    return api.post('/userstories/bulk_update_backlog_order', params);
}

/**
 * Move a set of stories into (or out of) a milestone/sprint. This is the
 * "drop a story into a sprint" call used by the backlog drag-and-drop
 * (AAP §0.6.5).
 *
 * Reproduces `service.bulkUpdateMilestone`
 * (`app/coffee/modules/resources/userstories.coffee:107-110`) →
 * `POST /userstories/bulk_update_milestone`.
 *
 * The body ALWAYS includes `milestone_id` (even when `null`) because the coffee
 * passed it unconditionally. Note the field name is `bulk_stories`, but here it
 * carries the ARRAY of {@link BulkUserStoryOrder} (per
 * `app/coffee/modules/backlog/main.coffee:796-799`) — NOT the newline string
 * used by {@link bulkCreate}.
 *
 * @param projectId   The target project id (`project_id`).
 * @param milestoneId Destination milestone id, or `null` to unset the milestone.
 *                    Always included (`milestone_id`).
 * @param bulkStories The ordered `{ us_id, order }` entries (`bulk_stories`).
 */
export function bulkUpdateMilestone(
    projectId: number,
    milestoneId: number | null,
    bulkStories: BulkUserStoryOrder[],
): Promise<unknown> {
    return api.post('/userstories/bulk_update_milestone', {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: bulkStories,
    });
}

/**
 * Reorder stories within a Kanban column (status), optionally within a specific
 * swimlane and anchored after/before a sibling story. This is the Kanban
 * drag-and-drop move endpoint (AAP §0.6.5).
 *
 * Reproduces `service.bulkUpdateKanbanOrder`
 * (`app/coffee/modules/resources/userstories.coffee:112-129`) →
 * `POST /userstories/bulk_update_kanban_order`.
 *
 * Body construction preserves the coffee logic EXACTLY:
 *   - `project_id`, `status_id` and `bulk_userstories` are always present;
 *   - `after_userstory_id` / `before_userstory_id` are MUTUALLY EXCLUSIVE with
 *     `after` winning (coffee `if … else if …`);
 *   - `swimlane_id` is added only when truthy (coffee `if swimlaneId`). The
 *     Kanban board passes `null` when the board is not in swimlane mode
 *     (swimlane `-1`), so a falsy swimlane is correctly omitted.
 *
 * @param projectId         The target project id (`project_id`).
 * @param statusId          The destination Kanban status/column (`status_id`).
 * @param swimlaneId        Destination swimlane id, or `null`. Included only
 *                          when truthy.
 * @param afterUserstoryId  Anchor: place AFTER this story. Wins over `before`.
 * @param beforeUserstoryId Anchor: place BEFORE this story. Used only when
 *                          `afterUserstoryId` is falsy.
 * @param bulkUserstories   The ordered `{ us_id, order }` entries to persist.
 */
export function bulkUpdateKanbanOrder(
    projectId: number,
    statusId: number,
    swimlaneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: BulkUserStoryOrder[],
): Promise<unknown> {
    const params: Record<string, unknown> = {
        project_id: projectId,
        status_id: statusId,
        bulk_userstories: bulkUserstories,
    };

    // coffee: `if afterUserstoryId … else if beforeUserstoryId` — exactly one
    // anchor, `after` first.
    if (afterUserstoryId) {
        params.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        params.before_userstory_id = beforeUserstoryId;
    }

    // coffee: `if swimlaneId` — include only when truthy.
    if (swimlaneId) {
        params.swimlane_id = swimlaneId;
    }

    return api.post('/userstories/bulk_update_kanban_order', params);
}

/**
 * Reorder stories within a sprint/milestone.
 *
 * There is no dedicated method for this in `resources/userstories.coffee`, but
 * the endpoint is present in the AngularJS URL map under the key
 * `bulk-update-us-miles-order` → `/userstories/bulk_update_sprint_order`
 * (`app/coffee/modules/resources.coffee:111`) and is required by the migration
 * (AAP §0.4.1 / §0.6.5). Its payload mirrors the sprint/backlog order contract
 * — `{ project_id, bulk_userstories, [milestone_id] }` — with `milestone_id`
 * included only when truthy, consistent with the backlog-order guard.
 *
 * @param projectId       The target project id (`project_id`).
 * @param milestoneId     The sprint/milestone id, or `null`. Included only when
 *                        truthy.
 * @param bulkUserstories The ordered `{ us_id, order }` entries to persist.
 */
export function bulkUpdateSprintOrder(
    projectId: number,
    milestoneId: number | null,
    bulkUserstories: BulkUserStoryOrder[],
): Promise<unknown> {
    const params: Record<string, unknown> = {
        project_id: projectId,
        bulk_userstories: bulkUserstories,
    };

    // Mirror the backlog-order `if milestoneId` guard.
    if (milestoneId) {
        params.milestone_id = milestoneId;
    }

    return api.post('/userstories/bulk_update_sprint_order', params);
}

/**
 * Fetch the sidebar filter facets (statuses, tags, assignees, owners, epics,
 * roles, …) for a project's user-story list.
 *
 * Reproduces `service.filtersData`
 * (`app/coffee/modules/resources/userstories.coffee:42-43`), which called
 * `$repo.queryOneRaw("userstories-filters", null, params)` → a GET against
 * `/userstories/filters_data` (`app/coffee/modules/resources.coffee:113`).
 * `queryOneRaw` returns the raw response body with no model wrapping, so the
 * parsed body is returned directly as {@link FiltersData}.
 *
 * @param projectId The project whose filter data is requested. Sent as the
 *                  `project` query parameter.
 * @param params    Optional extra filter query parameters, merged after
 *                  `project`. `null` / `undefined` values are dropped by the
 *                  `api` query-string serializer.
 * @returns The `/userstories/filters_data` payload as {@link FiltersData}.
 */
export function filtersData(
    projectId: number,
    params?: Record<string, string | number | boolean | null | undefined>,
): Promise<FiltersData> {
    return api.get<FiltersData>('/userstories/filters_data', {
        project: projectId,
        ...(params ?? {}),
    });
}
