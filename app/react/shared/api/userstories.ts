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
 *   - PAYLOAD TYPES ARE ENDPOINT-SPECIFIC and are declared distinctly below to
 *     match the Django validators byte-for-byte (taiga-back
 *     `userstories/validators.py`), with NO type-erasing double-casts at any
 *     call site:
 *       • `bulk_userstories` (backlog + kanban order) is a `number[]` — a plain
 *         array of user-story ids: `ListField(child=IntegerField(min_value=1))`.
 *       • `bulk_stories` for {@link bulkUpdateMilestone} is a
 *         `BulkUserStoryOrder[]` (`{ us_id, order }` objects):
 *         `_UserStoryMilestoneBulkValidator(many=True)`.
 *       • `bulk_stories` for {@link bulkCreate} is a newline-separated STRING of
 *         subjects: `serializers.CharField()`.
 *   - There is deliberately NO `bulkUpdateSprintOrder` wrapper: the backend has
 *     no `bulk_update_sprint_order` route (only `bulk_create`,
 *     `bulk_update_milestone`, `bulk_update_backlog_order`,
 *     `bulk_update_kanban_order` exist in `userstories/api.py`), so any such
 *     wrapper would have targeted a non-existent endpoint.
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
 * A single entry in the `bulk_stories` payload of {@link bulkUpdateMilestone}:
 * the user-story id together with its new position within the target sprint.
 *
 * This is used EXCLUSIVELY by the milestone move endpoint, whose backend
 * validator is `_UserStoryMilestoneBulkValidator(many=True)` — i.e. an array of
 * `{ us_id, order }` objects. It mirrors the object the AngularJS backlog
 * controller built when moving selected stories into a sprint,
 * `{ us_id: us.id, order: us.sprint_order }` (`backlog/main.coffee:793-798`).
 *
 * It is intentionally NOT used for the backlog/kanban ORDER endpoints, whose
 * `bulk_userstories` field is a plain `number[]` of ids (see the FIDELITY NOTES
 * above). `../types` has no equivalent, and this type is declared HERE so the
 * `api/` layer stays self-contained (the sibling `types.ts` is not edited).
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
 * The attributes accepted when creating a single user story.
 *
 * Mirrors the `initialData` model the AngularJS COMMON-module create form built
 * for a user story (`app/coffee/modules/common/lightboxes.coffee:552-560`):
 * `{ project, subject, description, tags, points, swimlane, status,
 * is_archived }`. Only `project` and `subject` are required by the backend
 * (`UserStorySerializer`); every other field is optional and, when omitted, the
 * backend applies the project defaults (e.g. `default_us_status`), exactly as it
 * did for the AngularJS create. The optional `status`/`swimlane` are included by
 * the Kanban "+" action so the new story lands in the clicked column (and, when
 * kanban is activated, the project's default swimlane).
 */
export interface CreateUserStoryPayload {
    /** Owning project id (`project`). REQUIRED. */
    project: number;
    /** The new story's title (`subject`). REQUIRED. */
    subject: string;
    /** Target status id (`status`). Omitted → backend default_us_status. */
    status?: number | null;
    /** Target swimlane id (`swimlane`). Omitted → backend default. */
    swimlane?: number | null;
    /** Optional free-text description (`description`). */
    description?: string;
    /** Optional tag list (`tags`). */
    tags?: string[];
    /** Optional archived flag (`is_archived`). */
    is_archived?: boolean;
}

/**
 * Create a single user story.
 *
 * Reproduces the AngularJS COMMON-module generic-create save
 * (`genericform:new` → `model.save()` → `POST /userstories`,
 * `app/coffee/modules/common/lightboxes.coffee:552-560`). The deleted Kanban and
 * Backlog controllers delegated single-story creation to that common lightbox;
 * because the common module is out of scope (AAP §0.2.2) and defines no React
 * component, the two migrated screens call this adapter directly against the
 * SAME `/api/v1/userstories` endpoint, so the backend cannot distinguish the
 * React create from the AngularJS create (the REST contract is unchanged).
 *
 * @param payload The {@link CreateUserStoryPayload} — `project` + `subject`
 *                required; `status`/`swimlane`/etc. optional.
 * @returns The created {@link UserStory} (with server-assigned `id`, `ref`,
 *          `status`, ordering, etc.).
 */
export function createUserStory(
    payload: CreateUserStoryPayload,
): Promise<UserStory> {
    return api.post<UserStory>('/userstories', payload);
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
 * @param bulkUserstories   The ordered user-story ids to persist, as a
 *                          `number[]`. This matches the backend contract
 *                          exactly: `UpdateUserStoriesBacklogOrderBulkValidator`
 *                          declares `bulk_userstories =
 *                          ListField(child=IntegerField(min_value=1))`
 *                          (taiga-back `userstories/validators.py`), and the
 *                          AngularJS caller passed
 *                          `bulkUserstories = _.map(usList, (it) -> it.id)`
 *                          — a plain array of ids (`backlog/main.coffee:535-537`).
 *                          It is NOT the `{ us_id, order }` object array used by
 *                          {@link bulkUpdateMilestone}'s `bulk_stories`.
 */
export function bulkUpdateBacklogOrder(
    projectId: number,
    milestoneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: number[],
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
 * @param bulkUserstories   The ordered user-story ids to persist, as a
 *                          `number[]`. This matches the backend contract
 *                          exactly: `UpdateUserStoriesKanbanOrderBulkValidator`
 *                          declares `bulk_userstories =
 *                          ListField(child=IntegerField(min_value=1))`
 *                          (taiga-back `userstories/validators.py`), and the
 *                          AngularJS board passed a plain array of ids
 *                          (`kanban-usertories.coffee:184-190` returns
 *                          `bulkUserstories: usList` where `usList` is
 *                          `usList.map((it) => it.id)`, `kanban/main.coffee:610`).
 *                          It is NOT the `{ us_id, order }` object array used by
 *                          {@link bulkUpdateMilestone}'s `bulk_stories`.
 */
export function bulkUpdateKanbanOrder(
    projectId: number,
    statusId: number,
    swimlaneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: number[],
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
