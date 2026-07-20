/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Typed adapters for the bulk user-story endpoints, reproducing
 * `app/coffee/modules/resources/userstories.coffee` (the AngularJS
 * `$tgUserstoriesResourcesProvider`; endpoint names registered in
 * `app/coffee/modules/resources.coffee:107-118`).
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. These
 * adapters are invoked by the React Kanban board (kanban-order reordering +
 * WIP-limit edit), the React Backlog (backlog-order reordering + milestone move
 * + bulk-create), and the shared `../dnd` drop handlers. Every call is delegated
 * to the sibling `./httpClient`, whose `fetch`-based pipeline re-derives the
 * base URL, JWT, session id, and language from the SAME globals/storage the
 * AngularJS client uses. The request URLs, HTTP verbs, and request-body shapes
 * are BYTE-IDENTICAL to the AngularJS resource provider, so the Django
 * `/api/v1/` contract stays completely FROZEN.
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from `app/coffee/**`,
 * `app/modules/**`, `elements.js`, or `angular`. The ONLY import is the sibling
 * `./httpClient`. All endpoint paths are RELATIVE (no leading slash needed —
 * `httpClient` joins them onto `getApiUrl()` and trims a leading slash).
 *
 * KEY INSIGHT: fidelity of the JSON body keys and the after/before-then-swimlane
 * conditional logic is the whole point. The Django bulk-ordering endpoints are
 * frozen, so any key rename, added field, or reordering-precedence change would
 * silently corrupt server-side ordering. `userstories.coffee:64-147` is
 * reproduced literally below.
 */

// The sole import: the shared fetch-based HTTP client. `httpClient` exposes
// BOTH a named and a default export; the default is imported here for brevity.
// `httpClient.post`/`.patch` accept a RELATIVE path plus a JSON body and return
// the parsed response body (or `null` on `204 No Content`).
import httpClient from './httpClient';

// ---------------------------------------------------------------------------
// Wire-shape types
//
// This API layer OWNS the wire shape of the bulk user-story payloads. Consumers
// (the Kanban/Backlog reducers and the `../dnd` drop handlers) import these
// interfaces from here rather than declaring their own or importing from
// `app/coffee` — keeping the frozen `/api/v1/` contract described in exactly one
// place. Every payload interface is exported and fully typed (TypeScript strict
// mode; no implicit `any`).
// ---------------------------------------------------------------------------

/**
 * A single per-story ordering entry sent inside the `bulk_stories` ARRAY of
 * `POST /userstories/bulk_update_milestone` ONLY.
 *
 * The AngularJS toolbar "move to sprint" flow builds these as `{ us_id, order }`
 * objects (backlog/main.coffee:794-799); the server keys the milestone reorder
 * off `us_id` and `order`. The index signature tolerates any additional
 * per-item fields a caller may include without loosening the two required,
 * typed keys.
 *
 * IMPORTANT (frozen-contract fidelity): this shape does NOT apply to the two
 * bulk-ORDER endpoints. `bulk_update_kanban_order` and
 * `bulk_update_backlog_order` send `bulk_userstories` as a bare `number[]` of
 * user-story ids (kanban/main.coffee:610 `usList.map((it) => it.id)`;
 * backlog/main.coffee:535 `_.map(usList, (it) -> it.id)`) — see
 * `../dnd/types.ts` `BulkUserstoryIds`. Those payloads are typed `number[]`
 * below; do NOT model them as `BulkOrderItem[]`.
 */
export interface BulkOrderItem {
  /** The user-story id being (re)ordered. */
  us_id: number;
  /** The target ordinal position of the story within its list/column. */
  order: number;
  /** Tolerate additional per-item fields the board/backlog may attach. */
  [key: string]: unknown;
}

/**
 * Body of `POST /userstories/bulk_create`. Reproduces the object literal built
 * at `userstories.coffee:65-69`, where all four keys are ALWAYS present.
 */
export interface BulkCreatePayload {
  project_id: number;
  status_id: number;
  /**
   * Newline-separated subjects string. The AngularJS flow passes the raw
   * multi-line textarea value straight through (`userstories.coffee:68`), so it
   * is typed as `string` here — NOT an array.
   */
  bulk_stories: string;
  /** May be `null`; the key is kept present to match the source object. */
  swimlane_id: number | null;
}

/**
 * Body of `POST /userstories/bulk_update_backlog_order`. Reproduces the
 * conditionally-built params object at `userstories.coffee:94-104`: `project_id`
 * and `bulk_userstories` are always present; `milestone_id`,
 * `after_userstory_id`, and `before_userstory_id` are only present when truthy,
 * and at most one of `after_*`/`before_*` is ever sent (after wins).
 */
export interface BulkUpdateBacklogOrderPayload {
  project_id: number;
  /**
   * A bare array of user-story IDS (`number[]`), NOT `{ us_id, order }` objects.
   * Frozen contract: backlog/main.coffee:535 `_.map(usList, (it) -> it.id)`.
   */
  bulk_userstories: number[];
  milestone_id?: number;
  after_userstory_id?: number;
  before_userstory_id?: number;
}

/**
 * Body of `POST /userstories/bulk_update_milestone`. Reproduces the params
 * object at `userstories.coffee:109`. Note `bulk_stories` here is an ARRAY of
 * ordering items (the stories moved to the milestone) — distinct from the
 * `string` `bulk_stories` of `BulkCreatePayload`.
 */
export interface BulkUpdateMilestonePayload {
  project_id: number;
  milestone_id: number;
  bulk_stories: BulkOrderItem[];
}

/**
 * Body of `POST /userstories/bulk_update_kanban_order`. Reproduces the
 * conditionally-built params object at `userstories.coffee:114-127`: `project_id`,
 * `status_id`, and `bulk_userstories` are always present; at most one of
 * `after_userstory_id`/`before_userstory_id` (after wins); and `swimlane_id` is
 * appended LAST, only when truthy, AFTER the after/before branch.
 */
export interface BulkUpdateKanbanOrderPayload {
  project_id: number;
  status_id: number;
  /**
   * A bare array of user-story IDS (`number[]`), NOT `{ us_id, order }` objects.
   * Frozen contract: kanban/main.coffee:610 `usList.map((it) => it.id)`.
   */
  bulk_userstories: number[];
  after_userstory_id?: number;
  before_userstory_id?: number;
  swimlane_id?: number;
}

/**
 * A single option row inside a `GET /userstories/filters_data` category array.
 *
 * The Django `filters_data` endpoint (frozen `/api/v1/`) returns, PER project,
 * one array per filterable dimension. The concrete keys differ slightly per
 * dimension (statuses/roles carry `name`+`color`+`order`; assigned_to/owners
 * carry `full_name`+avatar fields; tags carry `name`+`color` but NO numeric id;
 * epics carry `ref`+`subject`). Every row carries a `count` (the number of
 * stories matching that option). A single tolerant shape models them all; the
 * builder in `../../shared/filters` reads only the fields present per category.
 *
 * `id` is `number | null` — `null` denotes the "Unassigned" pseudo-option for
 * assigned_to/assigned_users/roles and the "Not in an epic" pseudo-option for
 * epics (reproducing `controllerMixins.coffee:263-303`).
 */
export interface FiltersDataOption {
  /** Numeric id, or `null` for the Unassigned / Not-in-an-epic pseudo-option. Absent for tags. */
  id?: number | null;
  /** statuses / roles display name. */
  name?: string;
  /** assigned_to / assigned_users / owners display name. */
  full_name?: string;
  /** epics: referenced story number. */
  ref?: number | null;
  /** epics: referenced epic subject. */
  subject?: string | null;
  /** statuses / tags / roles swatch color. */
  color?: string | null;
  /** statuses / roles / epics ordering hint. */
  order?: number;
  /** The number of stories matching this option (drives count badges + hideEmpty). */
  count: number;
  /** assigned_users / owners avatar url. */
  photo?: string | null;
  /** assigned_users / owners large avatar url. */
  big_photo?: string | null;
  /** assigned_users / owners gravatar id. */
  gravatar_id?: string | null;
  /** Tolerate any additional per-row fields the server may include. */
  [key: string]: unknown;
}

/**
 * Body of `GET /userstories/filters_data?project=<id>[&milestone=<id>]`.
 *
 * Reproduces the object the AngularJS `$tgResources.userstories.filtersData`
 * resolves (consumed by `UsFiltersMixin.generateFilters`,
 * `controllerMixins.coffee:246-304`). Each field is an array of
 * {@link FiltersDataOption}. The Kanban and Backlog filter sidebars are built
 * ENTIRELY from this payload (Epic category, per-option counts, Unassigned /
 * Not-in-an-epic pseudo-options, and in-use-only tags all derive from here).
 */
export interface FiltersDataResponse {
  statuses: FiltersDataOption[];
  /** Assigned-to rows WITHOUT avatar fields (id may be null => Unassigned). */
  assigned_to: FiltersDataOption[];
  /** Assigned-to rows WITH avatar fields; the category the sidebar renders. */
  assigned_users: FiltersDataOption[];
  /** Story creators (owners); rendered as the "Created by" category. */
  owners: FiltersDataOption[];
  /** All project tags with per-tag story counts (count===0 => not in use). */
  tags: FiltersDataOption[];
  /** Epics with counts (id null => "Not in an epic"). */
  epics: FiltersDataOption[];
  /** Project roles with counts (id null => "Unassigned"). */
  roles: FiltersDataOption[];
  /** Tolerate additional dimensions the server may add without breaking. */
  [key: string]: FiltersDataOption[] | undefined;
}

// ---------------------------------------------------------------------------
// Endpoint adapters
// ---------------------------------------------------------------------------

/**
 * Fetch the per-project filter dimension data used to build the Kanban and
 * Backlog filter sidebars.
 *
 * Reproduces `service.filtersData` (`resources/userstories.coffee`) which the
 * AngularJS `UsFiltersMixin.generateFilters` (`controllerMixins.coffee:245`)
 * calls as `@rs.userstories.filtersData(loadFilters)` — a `GET
 * /userstories/filters_data` with the applied filters + `project` (+ optional
 * `milestone`) as query params. This adapter sends only `project` and, when
 * provided, `milestone` (the loaded-filter cross-population that AngularJS does
 * server-side is not needed to POPULATE the sidebar). The endpoint is a frozen
 * `/api/v1/` read; adding a typed adapter is contract-preserving.
 *
 * @param projectId - Target project id (-> `project`).
 * @param milestone - Optional milestone id to scope counts to a sprint (-> `milestone`).
 */
export function filtersData(projectId: number, milestone?: number | null) {
  const params: Record<string, unknown> = { project: projectId };
  // Only send milestone when truthy (matches the legacy `if milestone` guard,
  // controllerMixins.coffee:243-244); the backlog passes none (project-wide).
  if (milestone) {
    params.milestone = milestone;
  }
  return httpClient.get<FiltersDataResponse>('userstories/filters_data', params);
}

/**
 * Bulk-create user stories from a newline-separated subjects string.
 *
 * Reproduces `service.bulkCreate` (`userstories.coffee:64-74`): builds
 * `{ project_id, status_id, bulk_stories, swimlane_id }` with ALL FOUR keys
 * always present (`swimlane_id` may be `null`) and POSTs to the endpoint
 * registered as `bulk-create-us` (`resources.coffee:108` ->
 * `/userstories/bulk_create`).
 *
 * @param projectId   - Target project id (-> `project_id`).
 * @param statusId    - Status the new stories are created in (-> `status_id`).
 * @param bulkStories - Raw newline-separated subjects string (-> `bulk_stories`).
 * @param swimlaneId  - Optional swimlane id, or `null` (-> `swimlane_id`).
 */
export function bulkCreate(
  projectId: number,
  statusId: number,
  bulkStories: string,
  swimlaneId: number | null,
) {
  const data: BulkCreatePayload = {
    project_id: projectId,
    status_id: statusId,
    // Raw multi-line subjects string, exactly as AngularJS passes it
    // (userstories.coffee:68).
    bulk_stories: bulkStories,
    // Key kept present even when null, matching the source object
    // (userstories.coffee:69).
    swimlane_id: swimlaneId,
  };

  return httpClient.post('userstories/bulk_create', data);
}

/**
 * Persist the backlog ordering after a drag-drop / milestone move.
 *
 * Reproduces `service.bulkUpdateBacklogOrder` (`userstories.coffee:92-105`) and
 * POSTs to `bulk-update-us-backlog-order` (`resources.coffee:109` ->
 * `/userstories/bulk_update_backlog_order`). The base params
 * `{ project_id, bulk_userstories }` are always sent; `milestone_id` is added
 * only when truthy (INDEPENDENT of the after/before branch, matching the
 * separate `if` in the source); and exactly one of
 * `after_userstory_id`/`before_userstory_id` is added, with `after` taking
 * precedence via the `else if` (`userstories.coffee:99-103`).
 *
 * @param projectId         - Target project id (-> `project_id`).
 * @param milestoneId       - Milestone id, or `null`/`0` to omit `milestone_id`.
 * @param afterUserstoryId  - Story to insert AFTER, or `null`/`0` to omit.
 * @param beforeUserstoryId - Story to insert BEFORE (used only when `after` is
 *                            falsy), or `null`/`0` to omit.
 * @param bulkUserstories   - Bare array of moved user-story IDS (-> `bulk_userstories`, a `number[]`).
 */
export function bulkUpdateBacklogOrder(
  projectId: number,
  milestoneId: number | null,
  afterUserstoryId: number | null,
  beforeUserstoryId: number | null,
  bulkUserstories: number[],
) {
  const params: BulkUpdateBacklogOrderPayload = {
    project_id: projectId,
    bulk_userstories: bulkUserstories,
  };

  // Separate `if` in the source (userstories.coffee:96-97): milestone_id is
  // independent of the after/before branch below.
  if (milestoneId) {
    params.milestone_id = milestoneId;
  }

  // after-over-before precedence via else-if (userstories.coffee:99-103):
  // only ONE of after/before is ever sent.
  if (afterUserstoryId) {
    params.after_userstory_id = afterUserstoryId;
  } else if (beforeUserstoryId) {
    params.before_userstory_id = beforeUserstoryId;
  }

  return httpClient.post('userstories/bulk_update_backlog_order', params);
}

/**
 * Move a set of user stories to a milestone (sprint).
 *
 * Reproduces `service.bulkUpdateMilestone` (`userstories.coffee:107-110`):
 * builds `{ project_id, milestone_id, bulk_stories }` and POSTs to
 * `bulk-update-us-milestone` (`resources.coffee:110` ->
 * `/userstories/bulk_update_milestone`). Here `bulk_stories` is the array of
 * ordering items (the source's `data` argument, `userstories.coffee:109`).
 *
 * @param projectId   - Target project id (-> `project_id`).
 * @param milestoneId - Destination milestone id (-> `milestone_id`).
 * @param bulkStories - Per-story ordering entries (-> `bulk_stories`).
 */
export function bulkUpdateMilestone(
  projectId: number,
  milestoneId: number,
  bulkStories: BulkOrderItem[],
) {
  const params: BulkUpdateMilestonePayload = {
    project_id: projectId,
    milestone_id: milestoneId,
    bulk_stories: bulkStories,
  };

  return httpClient.post('userstories/bulk_update_milestone', params);
}

/**
 * Persist the Kanban-column ordering after a drag-drop within/between columns
 * and swimlanes.
 *
 * Reproduces `service.bulkUpdateKanbanOrder` (`userstories.coffee:112-129`) and
 * POSTs to `bulk-update-us-kanban-order` (`resources.coffee:112` ->
 * `/userstories/bulk_update_kanban_order`). The base params
 * `{ project_id, status_id, bulk_userstories }` are always sent; exactly one of
 * `after_userstory_id`/`before_userstory_id` is added with `after` precedence
 * (`userstories.coffee:120-124`); and `swimlane_id` is appended LAST, only when
 * truthy, AFTER the after/before branch (`userstories.coffee:126-127`).
 *
 * NOTE the argument order `(projectId, statusId, swimlaneId, afterUserstoryId,
 * beforeUserstoryId, bulkUserstories)` matches the source signature
 * (`userstories.coffee:112`); the `swimlane_id` assignment happens AFTER the
 * after/before branch, not with the other swimlane-adjacent arguments.
 *
 * @param projectId         - Target project id (-> `project_id`).
 * @param statusId          - Destination column status id (-> `status_id`).
 * @param swimlaneId        - Destination swimlane id, or `null`/`0` to omit.
 * @param afterUserstoryId  - Story to insert AFTER, or `null`/`0` to omit.
 * @param beforeUserstoryId - Story to insert BEFORE (used only when `after` is
 *                            falsy), or `null`/`0` to omit.
 * @param bulkUserstories   - Bare array of moved user-story IDS (-> `bulk_userstories`, a `number[]`).
 */
export function bulkUpdateKanbanOrder(
  projectId: number,
  statusId: number,
  swimlaneId: number | null,
  afterUserstoryId: number | null,
  beforeUserstoryId: number | null,
  bulkUserstories: number[],
) {
  const params: BulkUpdateKanbanOrderPayload = {
    project_id: projectId,
    status_id: statusId,
    bulk_userstories: bulkUserstories,
  };

  // after-over-before precedence via else-if (userstories.coffee:120-124):
  // only ONE of after/before is ever sent.
  if (afterUserstoryId) {
    params.after_userstory_id = afterUserstoryId;
  } else if (beforeUserstoryId) {
    params.before_userstory_id = beforeUserstoryId;
  }

  // swimlane_id is added LAST, AFTER the after/before branch, only when truthy
  // (userstories.coffee:126-127).
  if (swimlaneId) {
    params.swimlane_id = swimlaneId;
  }

  return httpClient.post('userstories/bulk_update_kanban_order', params);
}

/**
 * Edit a user-story status, used by the Kanban WIP-limit editor.
 *
 * Reproduces `service.editStatus` (`userstories.coffee:141-147`): resolves the
 * `userstory-statuses` collection (`resources.coffee:77` ->
 * `/userstory-statuses`), appends `/{statusId}`, and PATCHes `{ wip_limit }`.
 * The wire key stays `wip_limit` (matching the source's shorthand
 * `{ wip_limit }` at `userstories.coffee:145`); `wipLimit` may be `null` to
 * clear the limit.
 *
 * @param statusId - Id of the user-story status to edit (path segment).
 * @param wipLimit - New WIP limit, or `null` to clear it (-> `wip_limit`).
 */
export function editStatus(statusId: number, wipLimit: number | null) {
  return httpClient.patch(`userstory-statuses/${statusId}`, {
    wip_limit: wipLimit,
  });
}

/**
 * Body of `POST /userstories` (the STANDARD single-story create). Reproduces the
 * model-create payload the AngularJS generic form posts through `repo.create`
 * (the `$tgResources.userstories.create` -> `POST /userstories` path registered
 * at `resources.coffee:107`). The Django endpoint is backed by the model
 * `UserStoryValidator` (`userstories/validators.py:48`, `model = UserStory`),
 * so the wire keys are the MODEL FK/field names — `project`, `subject`,
 * `status` — NOT the `*_id` suffixed keys used by the bulk validators. `ref`
 * and `kanban_order` are server-assigned (`read_only_fields`), so they are
 * never sent.
 */
export interface CreatePayload {
  /** Target project id (model FK `project`). */
  project: number;
  /** The new story subject line (single line, no newline splitting). */
  subject: string;
  /**
   * Target user-story status id (model FK `status`). Sent so the story lands in
   * the column the "+" was clicked in; the server defaults it to the project's
   * default US status only when omitted.
   */
  status: number;
  /**
   * OPTIONAL extra model fields reproduced from the AngularJS new-US generic
   * form (`common/lightboxes.coffee`), so the Kanban "standard" create can set
   * the same core fields the legacy form did instead of subject-only (finding
   * #7). Each key is a real writable `UserStory` model attribute on the frozen
   * `POST /userstories` contract — only sent when the caller supplies it, so the
   * server keeps applying its own defaults for anything omitted.
   */
  description?: string;
  tags?: Array<string | [string, string | null]>;
  is_blocked?: boolean;
  blocked_note?: string;
  due_date?: string | null;
  /**
   * Points-per-role estimation map (`{ "<roleId>": <pointId> }`). This is the
   * same `points` model attribute the AngularJS generic new-US form posted
   * (`common/lightboxes.coffee` -> `repo.create("userstories", data)`), so the
   * React Kanban create/edit lightbox can set an estimation on creation instead
   * of leaving every role at "?" (finding D#2 -- missing points estimation).
   * Contract-preserving: `points` is an existing writable `UserStory` field on
   * the frozen `POST /userstories` endpoint; only sent when supplied.
   */
  points?: Record<string, number>;
  /**
   * Team/client-requirement flags -- the same writable `team_requirement` /
   * `client_requirement` boolean model attributes the legacy generic form's
   * requirement toggles posted (finding D#2 -- missing requirement toggles).
   * Only sent when supplied.
   */
  team_requirement?: boolean;
  client_requirement?: boolean;
  /**
   * Assigned member ids (`assigned_users` model attribute), so the create
   * lightbox's assignee control persists on creation exactly as the legacy
   * generic form did. Only sent when supplied.
   */
  assigned_users?: number[];
}

/**
 * OPTIONAL extra fields a caller may pass to {@link createUserStory} beyond the
 * mandatory subject/status. Mirrors the writable core fields of the legacy
 * new-US generic form (finding #7 + finding D#2). All are optional; omitted keys
 * are not sent, so a subject-only create still posts a byte-identical body.
 */
export type CreateExtra = Pick<
  CreatePayload,
  | 'description'
  | 'tags'
  | 'is_blocked'
  | 'blocked_note'
  | 'due_date'
  | 'points'
  | 'team_requirement'
  | 'client_requirement'
  | 'assigned_users'
>;

/**
 * Create a SINGLE user story, used by the Kanban column "+" (standard, non-bulk)
 * create flow (KB-5).
 *
 * This is the frozen `POST /userstories` model-create endpoint the AngularJS
 * client already uses via `repo.create("userstories", data)`; adding a typed
 * adapter is contract-preserving (no new/changed backend contract). The created
 * user-story object is returned (parsed JSON body) so the caller can add it to
 * the board with its server-assigned `id`/`ref`/`kanban_order`.
 *
 * @param projectId - Target project id (-> `project`).
 * @param statusId  - Target status id the story is created in (-> `status`).
 * @param subject   - The new story subject (-> `subject`).
 * @param extra     - OPTIONAL core fields (description/tags/is_blocked/
 *                    blocked_note/due_date) from the legacy new-US form (finding
 *                    #7). Only keys that are provided (not `undefined`) are sent,
 *                    so the server keeps its defaults for anything omitted.
 */
export function createUserStory(
  projectId: number,
  statusId: number,
  subject: string,
  extra?: CreateExtra,
) {
  const data: CreatePayload = {
    project: projectId,
    subject,
    status: statusId,
  };

  // Merge only the extra keys the caller actually supplied. Sending `undefined`
  // would serialise to nothing anyway, but filtering keeps the POST body minimal
  // and identical to subject-only when no extra fields are set.
  if (extra) {
    const bag = data as unknown as Record<string, unknown>;
    (Object.keys(extra) as Array<keyof CreateExtra>).forEach((key) => {
      const value = extra[key];
      if (value !== undefined) {
        bag[key] = value;
      }
    });
  }

  return httpClient.post('userstories', data);
}

/**
 * Delete a SINGLE user story by id, used by the Kanban card "Delete" action
 * (KB-4).
 *
 * Reproduces the AngularJS delete flow's server call `repo.remove(us)` ->
 * `DELETE /userstories/{id}` (the `$tgResources.userstories` collection
 * registered at `resources.coffee:107`; legacy `kanban/main.coffee:297-314`
 * confirm-then-remove). The endpoint answers `204 No Content`, so `httpClient`
 * resolves to `null`; the promise REJECTS (via `httpClient`'s error path) on any
 * non-2xx, letting the caller keep the card on the board and surface the error.
 * Adding a typed adapter is contract-preserving (existing frozen endpoint).
 *
 * @param usId - Id of the user story to delete (path segment).
 */
export function deleteUserStory(usId: number) {
  return httpClient.delete(`userstories/${usId}`);
}

/**
 * Partially UPDATE a single user story (a `$repo.save(us)` equivalent).
 *
 * Reproduces the AngularJS `$repo.save(model)` call (`repository.coffee:54-68`,
 * default `patch = true`) that every inline Backlog row control ultimately
 * invokes: the status widget (`common/popovers.coffee:66` -> `$repo.save(us)`),
 * the per-role points editor (`estimation.coffee:165` -> `$repo.save(@us)`), and
 * the generic edit form. Verb = **PATCH** `userstories/{id}`, body = the CHANGED
 * attributes PLUS the concurrency `version` the server requires for optimistic
 * locking (a stale `version` yields HTTP 400 and the legacy client reverts).
 *
 * The caller is responsible for including `version` in `data` (read from the
 * current user story) so the write is version-checked exactly as the legacy
 * model transform did. The updated user-story object is returned (parsed JSON),
 * carrying the server-incremented `version` and any recomputed fields
 * (e.g. `total_points`) so the caller can replace the row in local state.
 *
 * Adding a typed adapter over the existing frozen `PATCH /userstories/{id}`
 * endpoint is contract-preserving (no new/changed backend contract).
 *
 * @param usId - Id of the user story to update (path segment).
 * @param data - The changed attributes plus `version` (e.g. `{ status, version }`
 *               or `{ points, version }`).
 * @returns The updated user-story JSON.
 */
export function save(
  usId: number,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return httpClient.patch(`userstories/${usId}`, data);
}

/**
 * The full single-user-story DETAIL payload returned by `GET /userstories/{id}`.
 *
 * Only the fields the React create/edit lightbox prefills from are typed; the
 * index signature preserves every other attribute the server returns. CRITICAL
 * (finding D#1): the Kanban LIST endpoint (`GET /userstories?project=...`)
 * OMITS the heavy `description` / `description_html` fields for payload size,
 * whereas the DETAIL endpoint INCLUDES them. Seeding the edit form from the
 * in-memory LIST model therefore left `description` empty and a subsequent PATCH
 * WIPED the persisted description. This detail read is what lets the edit form
 * prefill the REAL description (and the authoritative `version`) before saving.
 */
export interface UserStoryDetail {
  id: number;
  ref?: number;
  subject?: string;
  description?: string | null;
  status?: number;
  points?: Record<string, number>;
  tags?: Array<[string, string | null]>;
  assigned_users?: number[];
  assigned_to?: number | null;
  total_points?: number | null;
  is_blocked?: boolean;
  blocked_note?: string | null;
  team_requirement?: boolean;
  client_requirement?: boolean;
  /** Optimistic-concurrency token; MUST be echoed back on the edit PATCH. */
  version?: number;
  [key: string]: unknown;
}

/**
 * Fetch a SINGLE user story by id (the full DETAIL payload).
 *
 * Reproduces the AngularJS edit precondition: `KanbanController.editUs`
 * (`kanban/main.coffee:278-291`) fetches the FULL story via
 * `rs.userstories.getByRef(project, ref)` BEFORE opening the generic edit form,
 * so the form is seeded with the complete model (including `description` and the
 * per-role `points`, which the Kanban board LIST omits). React mirrors that: the
 * card Edit action awaits `getUserStory(id)` and prefills the lightbox from the
 * returned detail, so editing NO LONGER wipes the description (finding D#1).
 *
 * This is a plain READ of the existing frozen `GET /userstories/{id}` REST
 * detail endpoint (the same collection registered at `resources.coffee:107`), so
 * adding a typed adapter is contract-preserving -- no new or changed backend
 * contract.
 *
 * @param usId - Id of the user story to fetch (path segment).
 * @returns The full user-story detail JSON.
 */
export function getUserStory(usId: number): Promise<UserStoryDetail> {
  return httpClient.get<UserStoryDetail>(`userstories/${usId}`);
}

// ---------------------------------------------------------------------------
// Export surface
//
// Each function is exported as a NAMED export above. The aggregate object below
// is also provided as BOTH a named (`userstories`) and the DEFAULT export, so
// callers may use whichever import style reads best:
//   import { bulkUpdateKanbanOrder } from '.../userstories';
//   import userstories from '.../userstories'; userstories.bulkUpdateKanbanOrder(...);
// ---------------------------------------------------------------------------

export const userstories = {
  bulkCreate,
  bulkUpdateBacklogOrder,
  bulkUpdateMilestone,
  bulkUpdateKanbanOrder,
  editStatus,
  createUserStory,
  deleteUserStory,
  save,
  getUserStory,
  filtersData,
};

export default userstories;
