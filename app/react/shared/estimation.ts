/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * estimation.ts — pure, framework-free port of the AngularJS estimation service
 * (`app/coffee/modules/common/estimation.coffee`) used by the Backlog per-role
 * user-story points editor.
 *
 * The Backlog row's points cell (`div.points(tg-backlog-us-points="us")`,
 * `backlog-row.jade:66`) is driven by the `tgBacklogUsPoints` directive
 * (`backlog/main.coffee:1057`), which delegates the per-role math to
 * `$tgEstimationsService` (`estimation.coffee`). This module reproduces the two
 * numeric routines that directive relies on so the React points widget can
 * display and edit points with EXACT legacy semantics:
 *
 *   - {@link calculateTotalPoints} reproduces `EstimationProcess.calculateTotalPoints`
 *     (`estimation.coffee:169-179`): map each role's selected point id to the
 *     point's numeric `value`, DROP null values, and sum. Returns the literal
 *     string `"?"` when there are no points or every value is null — matching the
 *     legacy sentinel the template renders.
 *
 *   - {@link calculateRoles} reproduces `EstimationProcess.calculateRoles`
 *     (`estimation.coffee:181-191`): for every COMPUTABLE role, resolve the
 *     currently-selected point NAME (or `"?"` when unset) so the per-role popover
 *     and the "view per role" header can label each role.
 *
 * These are pure functions over plain data (no `$repo`, no DOM), so they are
 * unit-testable in the browserless Jest environment (AAP 0.5 test-layer
 * isolation) and carry ZERO framework coupling. The actual PATCH persistence
 * (`$repo.save(@us)`, `estimation.coffee:165`) lives in the `userstories.save`
 * adapter + the `useBacklog` hook; this module is math only.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Reference-only sources are never imported.
 */

/**
 * A project estimation point. Mirrors the objects in `project.points`
 * (`GET /projects/{id}` -> `points: [{ id, name, value, order, project_id }]`).
 * `value` is `null` for the "?" point (unestimated) and a number otherwise.
 */
export interface EstimationPoint {
  /** Point id (the value stored per-role in `us.points[roleId]`). */
  id: number;
  /** Display label (e.g. `"?"`, `"0"`, `"1/2"`, `"1"`, `"2"`). */
  name: string;
  /** Numeric weight summed into the total; `null` for the "?" point. */
  value: number | null;
  /** Sort order (ascending) as returned by the API. */
  order?: number;
  [key: string]: unknown;
}

/**
 * A project role. Mirrors the objects in `project.roles`
 * (`{ id, name, computable, order, ... }`). Only COMPUTABLE roles participate in
 * points estimation (`estimation.coffee:182` filters on `"computable"`).
 */
export interface EstimationRole {
  /** Role id (key into `us.points`). */
  id: number;
  /** Role display name (e.g. `"UX"`, `"Front"`, `"Back"`). */
  name: string;
  /** Whether this role participates in points estimation. */
  computable?: boolean;
  /** Sort order (ascending) as returned by the API. */
  order?: number;
  [key: string]: unknown;
}

/**
 * A computable role annotated with its currently-selected point label, as
 * produced by {@link calculateRoles}. Reproduces the legacy `role.points` field
 * the per-role popover/header rendered (`estimation.coffee:187`).
 */
export interface RoleWithPoints extends EstimationRole {
  /** The selected point's NAME for this role, or `"?"` when unset. */
  points: string;
}

/** A user story's per-role points map: `{ [roleId]: pointId }`. */
export type UsPoints = Record<string, number | null | undefined>;

/**
 * Build a `pointId -> EstimationPoint` lookup from the project's point list.
 * Reproduces `groupBy(project.points, (x) -> x.id)` (`backlog/main.coffee:480`,
 * `estimation.coffee:148`). Last-wins on duplicate ids (there are none in
 * practice; the API returns a unique-id set).
 */
export function buildPointsById(
  points: readonly EstimationPoint[],
): Record<number, EstimationPoint> {
  const map: Record<number, EstimationPoint> = {};
  for (const p of points) {
    map[p.id] = p;
  }
  return map;
}

/**
 * Sum the numeric point value selected for every role of a user story.
 *
 * EXACT port of `EstimationProcess.calculateTotalPoints`
 * (`estimation.coffee:169-179`):
 *   1. Map every value of `us.points` (a `{roleId: pointId}` map) to
 *      `pointsById[pointId]?.value`.
 *   2. If the map is EMPTY -> return `"?"`.
 *   3. Filter out `null`/`undefined` values; if NONE remain -> return `"?"`.
 *   4. Otherwise reduce (sum) the remaining numeric values and return the number.
 *
 * The mixed `number | string` return type is intentional and matches the legacy
 * template, which renders either the numeric total or the literal `"?"` sentinel.
 *
 * @param usPoints  - The story's `{roleId: pointId}` map (may be undefined/empty).
 * @param pointsById - `pointId -> EstimationPoint` lookup (see {@link buildPointsById}).
 */
export function calculateTotalPoints(
  usPoints: UsPoints | null | undefined,
  pointsById: Record<number, EstimationPoint>,
): number | string {
  // `_.map(@us.points, (v) => @pointsById[v]?.value)` — iterate the map VALUES
  // (the selected point ids) and resolve each to its numeric point value.
  const values: Array<number | null | undefined> = [];
  if (usPoints) {
    for (const key of Object.keys(usPoints)) {
      const pointId = usPoints[key];
      const point = pointId != null ? pointsById[pointId] : undefined;
      values.push(point ? point.value : undefined);
    }
  }

  // `if values.length == 0 -> "?"` (no roles have an entry at all).
  if (values.length === 0) {
    return '?';
  }

  // `notNullValues = _.filter(values, (v) -> v?)` — drop null/undefined.
  const notNull = values.filter((v): v is number => v != null);

  // `if notNullValues.length == 0 -> "?"` (every selected point is the "?" point).
  if (notNull.length === 0) {
    return '?';
  }

  // `_.reduce(notNullValues, (acc, num) -> acc + num)` — sum the remaining values.
  return notNull.reduce((acc, num) => acc + num, 0);
}

/**
 * For every COMPUTABLE role, resolve the selected point NAME (or `"?"`).
 *
 * EXACT port of `EstimationProcess.calculateRoles`
 * (`estimation.coffee:181-191`): filter `project.roles` to `computable`, then for
 * each role look up `pointsById[us.points[role.id]]` and set `role.points` to that
 * point's `name`, falling back to `"?"` when the role has no selection (or the
 * point/name is missing). Returns fresh objects (legacy `_.clone`) so callers may
 * annotate without mutating the project roles.
 *
 * @param roles     - The project's roles (only `computable` ones are returned).
 * @param usPoints  - The story's `{roleId: pointId}` map.
 * @param pointsById - `pointId -> EstimationPoint` lookup.
 */
export function calculateRoles(
  roles: readonly EstimationRole[],
  usPoints: UsPoints | null | undefined,
  pointsById: Record<number, EstimationPoint>,
): RoleWithPoints[] {
  const computable = roles.filter((r) => Boolean(r.computable));
  return computable.map((role) => {
    const pointId = usPoints ? usPoints[role.id] : undefined;
    const pointObj = pointId != null ? pointsById[pointId] : undefined;
    const pointsName = pointObj && pointObj.name != null ? pointObj.name : '?';
    return { ...role, points: pointsName };
  });
}
