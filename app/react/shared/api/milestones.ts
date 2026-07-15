/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Milestone (sprint) API functions hitting the FROZEN Django `/api/v1/milestones`
 * endpoints. Ported VERBATIM from the AngularJS resource + repository layers:
 *   - list/get/stats/move: app/coffee/modules/resources/sprints.coffee
 *   - CRUD verb mapping:    app/coffee/modules/base/repository.coffee
 *                           (create -> POST, save(patch) -> PATCH, remove -> DELETE)
 *   - CRUD call sites:      app/coffee/modules/backlog/lightboxes.coffee
 *   - path map:             app/coffee/modules/resources.coffee (L92-L93)
 *
 * No route is invented; `/api/v1/` is frozen and the backend pytest suite is the
 * authoritative contract guard.
 */

import { httpDelete, httpGet, httpPatch, httpPost } from "./httpClient";
import type { HttpResponse, QueryParams } from "./httpClient";

/** Minimal structural milestone shape. */
export interface Milestone {
    id: number;
    [key: string]: unknown;
}

/** Writable milestone fields sent on create/edit (backlog/lightboxes.coffee sprint object). */
export interface MilestoneWritable {
    project: number;
    name: string;
    /** `"YYYY-MM-DD"` (formatted with moment in the AngularJS lightbox). */
    estimated_start: string;
    /** `"YYYY-MM-DD"`. */
    estimated_finish: string;
}

/** Milestone stats payload (`GET /milestones/{id}/stats`). */
export type MilestoneStats = Record<string, unknown>;

/** Result of {@link list}: the milestones plus the open/closed totals from response headers. */
export interface MilestoneListResult {
    milestones: Milestone[];
    open: number;
    closed: number;
}

/** Request body for `POST /milestones/{id}/move_userstories_to_sprint`. */
interface MoveUserStoriesBody {
    project_id: number;
    milestone_id: number;
    bulk_stories: number[];
}

/**
 * `x-disable-pagination: "1"` on read requests, mirroring the AngularJS
 * repository (repository.coffee L138-L140, L166-L179). Writes do NOT send it.
 */
const DISABLE_PAGINATION: Record<string, string> = { "x-disable-pagination": "1" };

/** Total-closed count header returned by the milestones list endpoint. */
const CLOSED_HEADER = "Taiga-Info-Total-Closed-Milestones";
/** Total-opened count header returned by the milestones list endpoint. */
const OPENED_HEADER = "Taiga-Info-Total-Opened-Milestones";

/**
 * Parse an integer count header the same way as AngularJS
 * (`parseInt(headers("..."), 10)` in sprints.coffee L38-L39): returns `NaN`
 * when the header is absent, exactly like the source.
 */
function parseCountHeader(headers: Headers, name: string): number {
    const value = headers.get(name);

    return value === null ? NaN : parseInt(value, 10);
}

/**
 * `GET /milestones?project=<id>&...` — list milestones for a project and read
 * the open/closed totals from the `Taiga-Info-Total-*-Milestones` response
 * headers. Mirrors `sprints.list` (sprints.coffee L26-L42).
 */
export async function list(
    projectId: number,
    filters?: QueryParams,
): Promise<MilestoneListResult> {
    const params: QueryParams = { project: projectId, ...(filters ?? {}) };
    const response = await httpGet<Milestone[]>("/milestones", params, DISABLE_PAGINATION);

    return {
        milestones: response.data,
        closed: parseCountHeader(response.headers, CLOSED_HEADER),
        open: parseCountHeader(response.headers, OPENED_HEADER),
    };
}

/** `GET /milestones/{id}` — fetch a single milestone (sprints.coffee L16-L21 via queryOne). */
export function get(milestoneId: number): Promise<HttpResponse<Milestone>> {
    return httpGet<Milestone>(`/milestones/${milestoneId}`, undefined, DISABLE_PAGINATION);
}

/** `GET /milestones/{id}/stats` — milestone statistics (sprints.coffee L23-L24 via queryOneRaw). */
export function stats(milestoneId: number): Promise<HttpResponse<MilestoneStats>> {
    return httpGet<MilestoneStats>(`/milestones/${milestoneId}/stats`, undefined, DISABLE_PAGINATION);
}

/**
 * `POST /milestones` — create a milestone. Body is the writable sprint object
 * (`$repo.create("milestones", {...})` in backlog/lightboxes.coffee).
 */
export function create(payload: MilestoneWritable): Promise<HttpResponse<Milestone>> {
    return httpPost<Milestone>("/milestones", payload);
}

/**
 * `PATCH /milestones/{id}` — edit a milestone. Mirrors `$repo.save(model)`
 * (patch=true -> PATCH; repository.coffee L54-L85) sending only changed fields.
 */
export function save(
    milestoneId: number,
    changes: Partial<MilestoneWritable>,
): Promise<HttpResponse<Milestone>> {
    return httpPatch<Milestone>(`/milestones/${milestoneId}`, changes);
}

/** `DELETE /milestones/{id}` — remove a milestone (`$repo.remove`; repository.coffee L37-L48). */
export function remove(milestoneId: number): Promise<HttpResponse<unknown>> {
    return httpDelete<unknown>(`/milestones/${milestoneId}`);
}

/**
 * `POST /milestones/{currentMilestoneId}/move_userstories_to_sprint` — move
 * stories into another sprint. Body `{ project_id, milestone_id, bulk_stories }`
 * (sprints.coffee `moveUserStoriesMilestone` L44-L47).
 */
export function moveUserStoriesToSprint(
    currentMilestoneId: number,
    projectId: number,
    milestoneId: number,
    bulkStories: number[],
): Promise<HttpResponse<unknown>> {
    const body: MoveUserStoriesBody = {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: bulkStories,
    };

    return httpPost<unknown>(
        `/milestones/${currentMilestoneId}/move_userstories_to_sprint`,
        body,
    );
}
