/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Sprint } from '../../shared/types/sprint';
import type { UserStory } from '../../shared/types/userStory';
import type {
    BacklogUserStory,
    PointsById,
    ProjectPoint,
    ProjectRole,
    ProjectStats,
    SelectedRoleId,
} from './types';

type UserStoryPoints = UserStory['points'];

const UNESTIMATED_TOKEN = '?';

// The doom line marks the first story whose points push the running total PAST the project
// total, and the running total starts from the points already committed to sprints — so it
// answers "where does the scope run out", not "where does a sprint end". A project total of
// zero draws no line at all, because everything would be beyond it.
export function selectDoomLineIndex(
    stats: ProjectStats | null | undefined,
    userStories: readonly BacklogUserStory[] | null | undefined,
): number | null {
    if (stats === null || stats === undefined) {
        return null;
    }

    const totalPoints = stats.total_points;
    if (typeof totalPoints !== 'number' || totalPoints === 0) {
        return null;
    }

    if (userStories === null || userStories === undefined) {
        return null;
    }

    let currentSum: number = stats.assigned_points;

    for (let index = 0; index < userStories.length; index += 1) {
        const story = userStories[index];

        currentSum += story.total_points!;

        if (currentSum > totalPoints) {
            return index;
        }
    }

    return null;
}

function resolvePoint(pointsById: PointsById, pointId: number | null | undefined): ProjectPoint | undefined {
    if (typeof pointId !== 'number') {
        return undefined;
    }

    return pointsById[pointId];
}

// An unestimated story yields the token, never `0`: a numeric zero would read as "estimated
// at nothing", and it would also be summed into the doom line above as real committed work.
export function calculateTotalPoints(points: UserStoryPoints, pointsById: PointsById): number | '?' {
    const values = Object.values(points).map((pointId) => resolvePoint(pointsById, pointId)?.value);

    if (values.length === 0) {
        return UNESTIMATED_TOKEN;
    }

    const notNullValues = values.filter((value): value is number => value !== null && value !== undefined);

    if (notNullValues.length === 0) {
        return UNESTIMATED_TOKEN;
    }

    return notNullValues.reduce((accumulator, weight) => accumulator + weight);
}

export interface RolePoints extends ProjectRole {
    readonly points: string;
}

export function calculateRoles(
    roles: readonly ProjectRole[],
    points: UserStoryPoints,
    pointsById: PointsById,
): readonly RolePoints[] {
    const computableRoles = roles.filter((role) => role.computable);

    return computableRoles.map((role) => {
        const point = resolvePoint(pointsById, points[role.id]);

        const pointName = point !== undefined && typeof point.name === 'string' ? point.name : UNESTIMATED_TOKEN;

        return { ...role, points: pointName };
    });
}

export interface PointsDisplayData {
    readonly totalPoints: number | '?';
    readonly roleName: string | null;
    readonly roles: readonly RolePoints[];
    readonly editable: boolean;
    readonly clickable: boolean;
    readonly preselectedRoleId: string | null;
}

function firstPointsMapRoleId(points: UserStoryPoints): string | null {
    const roleIds = Object.keys(points);

    if (roleIds.length === 0) {
        return null;
    }

    return roleIds[0];
}

export function selectPointsDisplay(
    roles: readonly ProjectRole[],
    points: UserStoryPoints,
    pointsById: PointsById,
    selectedRoleId: SelectedRoleId,
    editable: boolean,
): PointsDisplayData {
    const computedRoles = calculateRoles(roles, points, pointsById);

    const totalPoints = calculateTotalPoints(points, pointsById);

    const clickable = computedRoles.length > 0;
    const preselectedRoleId = computedRoles.length === 1 ? firstPointsMapRoleId(points) : null;

    const bareTotal: PointsDisplayData = {
        totalPoints,
        roleName: null,
        roles: computedRoles,
        editable,
        clickable,
        preselectedRoleId,
    };

    if (typeof selectedRoleId !== 'string' && typeof selectedRoleId !== 'number') {
        return bareTotal;
    }

    // With exactly one computable role the bare total is returned even when a role IS
    // selected: naming the only role there is would add nothing, and the row shows the total
    // instead. The role name is therefore only ever resolved for multi-role projects.
    if (computedRoles.length === 1) {
        return bareTotal;
    }

    const point = resolvePoint(pointsById, points[selectedRoleId]);

    const roleName = point!.name;

    return { ...bareTotal, roleName };
}

// The key is a decimal STRING of unix seconds, so sprints are ordered lexicographically;
// that agrees with a numeric ordering only because every key is the same width for the dates
// this application deals with. The two-digit-year correction is needed because constructing a
// date from a year below 100 would otherwise place it in the twentieth century.
function unixSecondsSortKey(estimatedFinish: string): string {
    const parts = estimatedFinish.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const localMidnight = new Date(year, month - 1, day);

    if (year >= 0 && year <= 99 && !Number.isNaN(localMidnight.getTime())) {
        localMidnight.setFullYear(year);
    }

    return String(Math.floor(localMidnight.getTime() / 1000));
}

export function getLastSprint(sprints: readonly Sprint[]): Sprint | undefined {
    const openSprints = sprints.filter((sprint) => !sprint.closed);

    const keyed = openSprints.map((sprint) => ({
        sprint,
        sortKey: unixSecondsSortKey(sprint.estimated_finish),
    }));

    keyed.sort((left, right) => {
        if (left.sortKey < right.sortKey) {
            return -1;
        }

        if (left.sortKey > right.sortKey) {
            return 1;
        }

        return 0;
    });

    if (keyed.length === 0) {
        return undefined;
    }

    return keyed[keyed.length - 1].sprint;
}
