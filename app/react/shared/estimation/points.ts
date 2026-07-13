/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Point, Project, Role } from "../types";
import type { UserStory } from "../types";

/**
 * Estimation helpers reproducing `EstimationProcess`
 * (`app/coffee/modules/common/estimation.coffee`) — the total-points and
 * per-role-points computation the backlog points column renders. Extracted as
 * pure functions so both `BacklogRow` and the tests can use them directly
 * (finding M4: null/unestimated points must render the legacy `?`, not `0`).
 */

/** Sentinel the legacy UI renders for an unestimated story / role (`"?"`). */
export const UNESTIMATED = "?";

/** Build a `pointId -> Point` lookup from `project.points` (legacy `pointsById`). */
export function buildPointsById(project: Project): Map<number, Point> {
    const map = new Map<number, Point>();
    for (const point of project.points ?? []) {
        map.set(point.id, point);
    }
    return map;
}

/** The `computable` roles that participate in estimation (legacy filter). */
export function computableRoles(project: Project): Role[] {
    return (project.roles ?? []).filter((role) => role.computable !== false);
}

/**
 * Total story points, reproducing `EstimationProcess.calculateTotalPoints`:
 *   - no per-role points at all            -> `"?"`
 *   - all assigned point values are null   -> `"?"`
 *   - otherwise                            -> the numeric sum of the non-null values
 *
 * @param us - The user story.
 * @param pointsById - `pointId -> Point` lookup (see {@link buildPointsById}).
 */
export function calculateTotalPoints(
    us: UserStory,
    pointsById: Map<number, Point>,
): number | typeof UNESTIMATED {
    const points = us.points;
    if (points === undefined || points === null) {
        return UNESTIMATED;
    }
    const roleIds = Object.keys(points);
    if (roleIds.length === 0) {
        return UNESTIMATED;
    }

    const values: number[] = [];
    for (const roleId of roleIds) {
        const pointId = points[roleId];
        if (pointId === null || pointId === undefined) {
            continue;
        }
        const value = pointsById.get(pointId)?.value;
        if (typeof value === "number") {
            values.push(value);
        }
    }
    if (values.length === 0) {
        return UNESTIMATED;
    }
    return values.reduce((acc, value) => acc + value, 0);
}

/**
 * The point NAME assigned to a role for a story, or `"?"` when unestimated,
 * reproducing `EstimationProcess.calculateRoles` (`role.points`). Used to render
 * each entry of the per-row role popover as `"{roleName} ({points})"`.
 *
 * @param us - The user story.
 * @param roleId - The role id.
 * @param pointsById - `pointId -> Point` lookup.
 */
export function roleDisplayPoints(
    us: UserStory,
    roleId: number,
    pointsById: Map<number, Point>,
): string {
    const pointId = us.points?.[String(roleId)];
    if (pointId === null || pointId === undefined) {
        return UNESTIMATED;
    }
    const point = pointsById.get(pointId);
    return point?.name ?? UNESTIMATED;
}
