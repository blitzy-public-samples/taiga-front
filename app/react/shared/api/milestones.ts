/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * milestones.ts — typed async wrappers over the `/api/v1/milestones` (sprints)
 * endpoints for the React Backlog screen: the sprint list, the sprint
 * create/edit lightbox, and the optional burndown stats.
 *
 * WHAT THIS IS
 *   The React-side re-expression of the AngularJS `resources/sprints.coffee`
 *   service together with the `$repo.create` / `$repo.save` calls the backlog
 *   sprint lightbox performs (`backlog/lightboxes.coffee`). Every function
 *   reproduces the EXACT HTTP contract of its AngularJS counterpart — same
 *   verb, same endpoint path, same request body, and (for the list) the same
 *   response-header parsing — so the Django REST backend cannot distinguish
 *   React traffic from AngularJS traffic (AAP §0.1.1, §0.6.1, §0.7.1).
 *
 * SOURCE-OF-TRUTH MAPPING (AngularJS → React)
 *   - list   → `sprints.coffee:26-42`  `$repo.queryMany("milestones", {project, …}, {}, true)`
 *              GET `/milestones?project=…`, reading the two
 *              `Taiga-Info-Total-*-Milestones` response headers.  → listMilestones
 *   - get    → `sprints.coffee:16-21`  `$repo.queryOne("milestones", id)`
 *              GET `/milestones/{id}`.                             → getMilestone
 *   - stats  → `sprints.coffee:23-24`  `$repo.queryOneRaw("milestones", "{id}/stats")`
 *              GET `/milestones/{id}/stats`.                       → getMilestoneStats
 *   - create → `lightboxes.coffee:62`  `$repo.create("milestones", newSprint)`
 *              POST `/milestones`.                                 → createMilestone
 *   - save   → `lightboxes.coffee:69`  `$repo.save(newSprint)`
 *              PATCH `/milestones/{id}` (changed attrs only,
 *              `repository.coffee:54-85`).                         → saveMilestone
 *   The URL key `milestones` resolves to `/milestones` (`resources.coffee:92`).
 *
 * WHAT THIS IS NOT
 *   - It NEVER imports `resources.coffee` (or any AngularJS service) and pulls
 *     in NONE of the globally-loaded libraries (Immutable.js, dragula,
 *     dom-autoscroller, checksley). All transport is delegated to the shared
 *     `api` adapter from `./client`, which already prefixes the API base URL
 *     (`getApiUrl()`) and attaches the `Authorization: Bearer` + `X-Session-Id`
 *     headers. Consequently this module names ONLY `/milestones…` relative
 *     paths and never hardcodes a base URL.
 *   - It is pure TypeScript: no React, no JSX, no `import React`. It is bundled
 *     into `dist/js/react.js` by esbuild.
 *
 * Toolchain: TypeScript 5.4.5 under `strict` (root `tsconfig.json`), Node
 * v16.19.1 compatible.
 */

import { api } from './client';
import type { QueryParams } from './client';
import type { Milestone } from '../types';

/* ========================================================================== *
 * Phase 1 — Result / payload types
 * ========================================================================== */

/**
 * The shape returned by {@link listMilestones}, mirroring the object the
 * AngularJS `sprints.list` service builds (`sprints.coffee:38-42`): the array
 * of milestones plus the closed/open totals parsed from the response headers.
 */
export interface MilestonesListResult {
    /** The milestones (sprints) for the project, in backend order. */
    milestones: Milestone[];
    /** Total CLOSED milestones — from the `Taiga-Info-Total-Closed-Milestones` header. */
    closed: number;
    /** Total OPEN milestones — from the `Taiga-Info-Total-Opened-Milestones` header. */
    open: number;
}

/**
 * The request body for {@link createMilestone}, mirroring the `newSprint`
 * object the backlog lightbox posts (`lightboxes.coffee:31-36`). The dates are
 * already `YYYY-MM-DD` strings prepared by the caller
 * (`shared/validation.formatSprintDate`, `lightboxes.coffee:59-60`); this
 * module posts them verbatim without reshaping.
 */
export interface MilestoneCreatePayload {
    /** Owning project id. */
    project: number;
    /** Sprint name (required by the backend). */
    name: string;
    /** Sprint start date, formatted `YYYY-MM-DD`. */
    estimated_start: string;
    /** Sprint finish date, formatted `YYYY-MM-DD`. */
    estimated_finish: string;
}

/**
 * The (raw) sprint-stats payload returned by {@link getMilestoneStats}, used by
 * the burndown consumer. Modelled loosely on purpose: the index signature
 * admits every field the backend returns so partial payloads never break
 * strict consumers, while a few commonly-read fields are typed optionally for
 * convenience. The burndown consumer refines this shape as needed; no field is
 * asserted required here.
 */
export interface MilestoneStats {
    total_points?: number;
    completed_points?: unknown;
    total_userstories?: number;
    completed_userstories?: number;
    [key: string]: unknown;
}

/* ========================================================================== *
 * Phase 2 — listMilestones (GET /milestones?project=… ; reads header counts)
 * ========================================================================== */

/**
 * List the milestones (sprints) for a project together with the total
 * open/closed counts. Reproduces `sprints.coffee:26-42`
 * (`$repo.queryMany("milestones", {project, …filters}, {}, true)`): a GET to
 * `/milestones` with a `project` query parameter (plus any extra `filters`),
 * where the open/closed totals come from RESPONSE HEADERS rather than the body.
 *
 * Because the counts live in the headers, this uses the low-level
 * `api.request(...)` (which exposes `ApiResponse.headers`) instead of the
 * convenience `api.get(...)` (which resolves to the body only) — exactly as the
 * AngularJS helper passed `headers=true` to `queryMany`. The two header names
 * read here — `Taiga-Info-Total-Closed-Milestones` and
 * `Taiga-Info-Total-Opened-Milestones` — are the SAME names the AngularJS
 * `sprints.list` service parsed (`sprints.coffee:40-41`).
 *
 * @param projectId The project whose milestones to list.
 * @param filters   Optional extra query parameters, merged after `project`.
 * @returns `{ milestones, closed, open }`.
 */
export async function listMilestones(
    projectId: number,
    filters?: QueryParams,
): Promise<MilestonesListResult> {
    const params: QueryParams = { project: projectId, ...(filters ?? {}) };

    const res = await api.request<Milestone[]>('GET', '/milestones', { params });

    // The open/closed totals are carried in response headers, matching the
    // AngularJS `queryMany(..., headers=true)` contract (sprints.coffee:40-41).
    // These header names are identical to the ones the AngularJS service read.
    const closedRaw = res.headers.get('Taiga-Info-Total-Closed-Milestones');
    const openRaw = res.headers.get('Taiga-Info-Total-Opened-Milestones');

    const closed = parseInt(closedRaw ?? '', 10);
    const open = parseInt(openRaw ?? '', 10);

    return {
        milestones: res.data ?? [],
        // The header may be absent (e.g. not exposed under CORS): default to 0.
        // Documented deviation — AngularJS would surface NaN here; React
        // returns a safe 0 so strict numeric consumers never receive NaN.
        closed: Number.isNaN(closed) ? 0 : closed,
        open: Number.isNaN(open) ? 0 : open,
    };
}

/* ========================================================================== *
 * Phase 3 — getMilestone (GET /milestones/{id})
 * ========================================================================== */

/**
 * Fetch a single milestone (sprint) by id. Reproduces `sprints.coffee:16-21`
 * (`$repo.queryOne("milestones", sprintId)`) → GET `/milestones/{id}`.
 *
 * The template-literal path is safe: `api` still resolves it against the API
 * base URL from `getApiUrl()`; only the `/milestones/{id}` suffix is named here.
 *
 * @param sprintId The milestone id.
 */
export function getMilestone(sprintId: number): Promise<Milestone> {
    return api.get<Milestone>(`/milestones/${sprintId}`);
}

/* ========================================================================== *
 * Phase 4 — getMilestoneStats (GET /milestones/{id}/stats)
 * ========================================================================== */

/**
 * Fetch the raw sprint stats consumed by the burndown chart. Reproduces
 * `sprints.coffee:23-24` (`$repo.queryOneRaw("milestones", "{id}/stats")`) →
 * GET `/milestones/{id}/stats`. The body is returned as-is (loosely typed via
 * {@link MilestoneStats}).
 *
 * @param sprintId The milestone id.
 */
export function getMilestoneStats(sprintId: number): Promise<MilestoneStats> {
    return api.get<MilestoneStats>(`/milestones/${sprintId}/stats`);
}

/* ========================================================================== *
 * Phase 5 — createMilestone (POST /milestones)
 * ========================================================================== */

/**
 * Create a new milestone (sprint). Reproduces `lightboxes.coffee:62`
 * (`$repo.create("milestones", newSprint)`) → POST `/milestones` with the
 * sprint object as the JSON body, resolving to the created milestone.
 *
 * The payload is posted VERBATIM — its keys (`project`, `name`,
 * `estimated_start`, `estimated_finish`) are neither reshaped nor renamed, and
 * the dates must already be `YYYY-MM-DD` (the backlog lightbox formats them via
 * moment before calling, `lightboxes.coffee:59-60`).
 *
 * @param sprint The new-sprint payload.
 */
export function createMilestone(sprint: MilestoneCreatePayload): Promise<Milestone> {
    return api.post<Milestone>('/milestones', sprint);
}

/* ========================================================================== *
 * Phase 6 — saveMilestone (PATCH /milestones/{id} with changed attributes)
 * ========================================================================== */

/**
 * Persist edits to an existing milestone (sprint). Reproduces
 * `lightboxes.coffee:69` (`$repo.save(newSprint)`) → `repository.coffee:53-64`,
 * which PATCHes to `/milestones/{id}` a body of EXACTLY the modified attributes
 * plus `version` — `getAttrs(patch=true)` returns `_modifiedAttrs` extended with
 * `_attrs.version` (`model.coffee:48-53`), where an attribute is "modified" only
 * when its new value DIFFERS from the original (`model.coffee:84-90`).
 *
 * REGRESSION FIX (F-REG-05)
 *   The previous signature accepted a whole `Milestone` and PATCHed every
 *   remaining field, so read-only / server-computed attributes (`slug`,
 *   `closed`, `total_points`, `created_date`, `owner`, …) were sent back on
 *   every edit — an overbroad payload that diverged from the AngularJS
 *   "changed attributes only" contract and risked the backend rejecting or
 *   mis-handling read-only fields. This signature now takes ONLY the caller's
 *   computed minimal diff plus the concurrency `version`, so the PATCH body is
 *   byte-for-byte what `$repo.save` sent.
 *
 * @param id      The milestone id (the `{id}` path segment; never in the body).
 * @param changes The minimal set of CHANGED attributes to persist (e.g. any of
 *                `name` / `estimated_start` / `estimated_finish`). An empty diff
 *                yields a body of just `version` (a harmless backend no-op),
 *                mirroring that `$repo.save` still rides `version` on a PATCH.
 *                Dates must already be `YYYY-MM-DD`
 *                (`shared/validation.formatSprintDate`, `lightboxes.coffee:66-67`).
 * @param version The optimistic-concurrency token from the original milestone
 *                (`model.getAttrs(patch).version`). Included in the body when
 *                provided so a stale edit is rejected exactly as under AngularJS;
 *                omitted only when the caller has no version to send.
 */
export function saveMilestone(
    id: number,
    changes: Partial<Milestone>,
    version?: number,
): Promise<Milestone> {
    // Only the changed attributes ride in the body (never the whole model).
    const body: Record<string, unknown> = { ...changes };

    // Optimistic-concurrency parity: getAttrs(patch=true) always extends the
    // modified attributes with `version` (model.coffee:49-53).
    if (version !== undefined) {
        body.version = version;
    }

    return api.patch<Milestone>(`/milestones/${id}`, body);
}
