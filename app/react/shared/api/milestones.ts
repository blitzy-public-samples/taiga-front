/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Milestone/sprint CRUD adapters reproducing
 * `app/coffee/modules/resources/sprints.coffee` + the `$tgRepo` verbs
 * (`app/coffee/modules/base/repository.coffee`) over the FROZEN `/milestones`
 * `/api/v1/` endpoints. Dates are serialized `YYYY-MM-DD` with the retained
 * `moment` dependency, matching `app/coffee/modules/backlog/lightboxes.coffee:59-60`.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. Consumed by
 * the React Backlog screen (sprint list with open/closed totals, sprint stats,
 * and sprint create/edit/delete). Every request is delegated to the sibling
 * `./httpClient`, so the Django REST contract stays byte-identical and FROZEN;
 * this file never hand-builds an absolute API URL and never invents an endpoint.
 *
 * The AngularJS `$tgSprintsResourcesProvider` additionally wraps each sprint's
 * `user_stories` in `$model.make_model("userstories", ...)`
 * (`sprints.coffee:18-20, 33-36`). That modeling step is INTENTIONALLY DROPPED
 * in the React path: these adapters return the raw JSON the backend sends and
 * let the React Backlog components consume it directly.
 *
 * Coexistence boundary (AAP 0.7): this file imports NOTHING from
 * `app/coffee/**`, `app/modules/**`, `app/partials/**`, `elements.js`, or
 * `angular`. The ONLY imports are the sibling `./httpClient` adapter and the
 * retained npm dependency `moment` (AAP 0.5.2 — reused, not replaced).
 *
 * The `/milestones` route key is defined at
 * `app/coffee/modules/resources.coffee:92` (`"milestones": "/milestones"`);
 * `httpClient` joins it onto `getApiUrl()` and trims the slashes.
 */

// Sibling HTTP client. Its default export exposes `get` / `getWithHeaders` /
// `post` / `patch` / `delete`, reproducing the `$tgHttp` + `app.coffee`
// header/verb behavior so the frozen backend cannot tell React from AngularJS.
import httpClient from './httpClient';
// Retained date library (package.json `moment` ^2.15.1). Reused here — exactly
// as `lightboxes.coffee` uses it — to serialize sprint dates to `YYYY-MM-DD`.
import moment from 'moment';

// ---------------------------------------------------------------------------
// Types (all exported for the React Backlog consumers and the unit specs)
// ---------------------------------------------------------------------------

/**
 * A milestone/sprint as returned by `GET /milestones` and `GET /milestones/{id}`.
 *
 * Only the fields the React Backlog relies on are named; the open index
 * signature tolerates the full payload the backend sends (created/modified
 * dates, slug, order, total_points, closed_points, project_extra_info, etc.)
 * without this adapter having to enumerate the entire Django serializer.
 * `user_stories` is left as raw JSON (`unknown[]`) because — unlike the
 * AngularJS provider — the React path does not wrap them in models.
 */
export interface Milestone {
  id: number;
  name: string;
  project: number;
  estimated_start: string; // 'YYYY-MM-DD'
  estimated_finish: string; // 'YYYY-MM-DD'
  closed?: boolean;
  user_stories?: unknown[]; // raw JSON in the React path (not modeled)
  [key: string]: unknown; // tolerate the full milestone payload from the API
}

/**
 * Result of `list()`, reproducing the shape returned by
 * `sprints.coffee:38-42`: the milestone array plus the open/closed totals
 * parsed from the `Taiga-Info-Total-*-Milestones` RESPONSE headers. The
 * Backlog UI renders those two counts next to the sprint list.
 *
 * `closed`/`open` are `parseInt(...)` results, so they are `NaN` when the
 * corresponding header is absent — the exact behavior of the AngularJS source
 * (`parseInt(undefined, 10)` -> `NaN`); callers must not assume `0`.
 */
export interface MilestoneListResult {
  milestones: Milestone[];
  closed: number; // parseInt(Taiga-Info-Total-Closed-Milestones)
  open: number; // parseInt(Taiga-Info-Total-Opened-Milestones)
}

/**
 * Payload for `create()` (and, partially, `save()`), mirroring the sprint
 * object assembled in `lightboxes.coffee:31-36, 57-63`
 * (`{ project, name, estimated_start, estimated_finish }`). The two date
 * fields may be supplied as a `Date` or any `moment`-parseable value;
 * `serializeDates` normalizes them to `YYYY-MM-DD` before the request.
 *
 * Intentionally has NO index signature: `save()` widens it explicitly with
 * `& Record<string, unknown>` for partial edits, so keeping this payload
 * closed documents the exact fields the create form submits.
 */
export interface MilestoneCreatePayload {
  project: number;
  name: string;
  estimated_start: string; // 'YYYY-MM-DD' (or a value moment can parse; serializeDates normalizes)
  estimated_finish: string;
}

/**
 * Raw payload of `GET /milestones/{id}/stats` (`sprints.coffee:23-24` via
 * `$repo.queryOneRaw`). The endpoint returns burndown/points totals; it is
 * passed through untyped because the React Backlog reads it dynamically and
 * the Django contract is frozen (no need to mirror the full serializer here).
 */
export interface MilestoneStats {
  [key: string]: unknown; // /milestones/{id}/stats raw payload (burndown/points totals, etc.)
}

// ---------------------------------------------------------------------------
// Date serialization — reproduce `lightboxes.coffee:59-60 / 66-67`
// ---------------------------------------------------------------------------

/**
 * Serializes the sprint date fields to `YYYY-MM-DD`, reproducing
 * `lightboxes.coffee:59-60` (create) and `:66-67` (edit), which both run
 * `moment(value).format("YYYY-MM-DD")` on `estimated_start` /
 * `estimated_finish`. Formatting is applied ONLY when the field is present and
 * non-empty; this guards against `moment(undefined)` silently defaulting to
 * the CURRENT date (a subtle but real bug), so absent/empty dates pass through
 * untouched (e.g. a partial PATCH that does not change the dates).
 *
 * `moment` accepts either a `Date` or an ISO `'YYYY-MM-DD'` string, and the
 * format is idempotent for the latter — so re-serializing an already-formatted
 * value is a no-op.
 *
 * The generic bound is `object` (not `Record<string, unknown>`) purely so the
 * closed `MilestoneCreatePayload` interface satisfies it under TypeScript
 * strict mode; the body operates through a `Record<string, unknown>` view and
 * casts the shallow copy back to `T`, so the public payload interfaces and all
 * call sites keep their exact declared types.
 *
 * @typeParam T - The payload type; returned unchanged in shape.
 * @param data  - The milestone payload (create or partial-edit attrs).
 * @returns A shallow copy with any present date fields normalized to `YYYY-MM-DD`.
 */
function serializeDates<T extends object>(data: T): T {
  // Shallow copy through a `Record` view so property read/write is well-typed
  // under strict mode without widening the caller's payload interface.
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };

  for (const key of ['estimated_start', 'estimated_finish'] as const) {
    const v = out[key];
    // Only format present/truthy values — never call moment(undefined|null|'')
    // (which would default to "now"). Mirrors the source, which always has a
    // concrete date string from the picker before formatting.
    if (v !== undefined && v !== null && v !== '') {
      // moment accepts a Date or an ISO 'YYYY-MM-DD' string; format is
      // idempotent for the latter.
      out[key] = moment(v as moment.MomentInput).format('YYYY-MM-DD');
    }
  }

  return out as T;
}

// ---------------------------------------------------------------------------
// CRUD adapters — reproduce `$tgSprintsResourcesProvider` + `$tgRepo` verbs
// ---------------------------------------------------------------------------

/**
 * Lists a project's milestones with the open/closed totals.
 *
 * Reproduces `sprints.coffee:26-42` via `$repo.queryMany("milestones", params,
 * {}, true)` (`repository.coffee:135-148`): the query params are
 * `{ project: projectId, ...filters }`, the request carries
 * `x-disable-pagination: "1"` (set by `queryMany` when `options.enablePagination`
 * is falsy — `repository.coffee:139-140`), and the RESPONSE headers
 * `Taiga-Info-Total-Closed-Milestones` / `Taiga-Info-Total-Opened-Milestones`
 * are parsed for the `closed` / `open` counts. `getWithHeaders` is used because
 * those headers are the correctness-critical part of this call.
 *
 * The AngularJS provider additionally models each `user_stories` entry
 * (`sprints.coffee:33-36`); the React path deliberately returns the RAW JSON
 * array instead.
 *
 * @param projectId - The project whose milestones to fetch (the `project` param).
 * @param filters   - Optional extra query params merged over `{ project }`.
 * @returns The raw milestone array plus the parsed `closed` / `open` totals
 *          (`NaN` when a total header is absent, matching AngularJS `parseInt`).
 */
export async function list(
  projectId: number,
  filters?: Record<string, unknown>,
): Promise<MilestoneListResult> {
  const params = { project: projectId, ...(filters ?? {}) };
  const res = await httpClient.getWithHeaders<Milestone[]>('milestones', params, {
    headers: { 'x-disable-pagination': '1' }, // reproduces repository.coffee:139-140 queryMany default
  });

  return {
    // Empty/`204` bodies resolve to `null` in httpClient; default to `[]`.
    // Resilience guard (finding M-04): also coerce a non-array (malformed 200)
    // body to `[]`. `setSprints`/`setClosedSprints` map over this list with
    // NATIVE `Array.prototype.map` (backlogReducer.ts), which would throw on a
    // non-array and collapse the sprints panel; the legacy consumed milestones
    // through lodash and degraded gracefully. Array bodies pass through
    // unchanged, so the frozen-contract behavior is identical.
    milestones: Array.isArray(res.data) ? res.data : [],
    // `Headers.get` is case-insensitive and returns `null` when absent;
    // `parseInt(null ?? '', 10)` -> `NaN`, matching the AngularJS behavior.
    closed: parseInt(res.headers.get('Taiga-Info-Total-Closed-Milestones') ?? '', 10),
    open: parseInt(res.headers.get('Taiga-Info-Total-Opened-Milestones') ?? '', 10),
  };
}

/**
 * Fetches a single milestone by id.
 *
 * Reproduces `sprints.coffee:16-21` via `$repo.queryOne("milestones", sprintId)`
 * (`repository.coffee:163-171`): `GET milestones/{id}` with
 * `x-disable-pagination: "1"` (`repository.coffee:167-168`). AngularJS wraps
 * `user_stories` in models; React returns the raw JSON.
 *
 * @param sprintId - The milestone/sprint id.
 * @returns The milestone JSON.
 */
export async function get(sprintId: number): Promise<Milestone> {
  return httpClient.get<Milestone>(`milestones/${sprintId}`, undefined, {
    headers: { 'x-disable-pagination': '1' }, // reproduces repository.coffee:167-168 queryOne default
  });
}

/**
 * Fetches a milestone's stats (burndown/points totals).
 *
 * Reproduces `sprints.coffee:23-24` via
 * `$repo.queryOneRaw("milestones", "#{sprintId}/stats")`
 * (`repository.coffee:173-180`): `GET milestones/{id}/stats` with
 * `x-disable-pagination: "1"` (`repository.coffee:177-178`), returning the raw
 * JSON payload unmodeled.
 *
 * @param sprintId - The milestone/sprint id.
 * @returns The raw stats payload.
 */
export async function stats(sprintId: number): Promise<MilestoneStats> {
  return httpClient.get<MilestoneStats>(`milestones/${sprintId}/stats`, undefined, {
    headers: { 'x-disable-pagination': '1' }, // reproduces repository.coffee:177-178 queryOneRaw default
  });
}

/**
 * Creates a milestone.
 *
 * Reproduces `$repo.create("milestones", data)` (`repository.coffee:24-35`):
 * verb = **POST** `milestones`, body = the milestone object. The create form
 * (`lightboxes.coffee:57-63`) submits `{ project, name, estimated_start,
 * estimated_finish }` with the two dates formatted `YYYY-MM-DD` — that
 * formatting is centralized here in `serializeDates`.
 *
 * @param data - The new milestone payload.
 * @returns The created milestone JSON.
 */
export async function create(data: MilestoneCreatePayload): Promise<Milestone> {
  return httpClient.post<Milestone>('milestones', serializeDates(data));
}

/**
 * Updates a milestone (partial edit).
 *
 * Reproduces `$repo.save(model)` with the default `patch = true`
 * (`repository.coffee:54-68`): verb = **PATCH** `milestones/{id}`, body = the
 * changed attrs. The edit form (`lightboxes.coffee:64-69`) formats the two
 * dates `YYYY-MM-DD` — centralized here in `serializeDates`.
 *
 * @param id   - The milestone/sprint id to update.
 * @param data - The changed attributes (any subset, plus arbitrary fields).
 * @returns The updated milestone JSON.
 */
export async function save(
  id: number,
  data: Partial<MilestoneCreatePayload> & Record<string, unknown>,
): Promise<Milestone> {
  return httpClient.patch<Milestone>(`milestones/${id}`, serializeDates(data));
}

/**
 * Deletes a milestone.
 *
 * Reproduces `$repo.remove(model)` (`repository.coffee:37-48`): verb =
 * **DELETE** `milestones/{id}`. The endpoint answers `204 No Content`, so
 * nothing is returned.
 *
 * @param id - The milestone/sprint id to delete.
 */
export async function remove(id: number): Promise<void> {
  await httpClient.delete<void>(`milestones/${id}`);
}

// ---------------------------------------------------------------------------
// Export surface
// ---------------------------------------------------------------------------

/**
 * Aggregate of every milestone adapter, mirroring the AngularJS
 * `service.{list,get,stats,...}` object shape (`sprints.coffee`). Importers may
 * use the named exports above or this aggregate:
 *   `import milestones from './milestones'` -> `milestones.list(...)`.
 */
export const milestones = { list, get, stats, create, save, remove };

export default milestones;
