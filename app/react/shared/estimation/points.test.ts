/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared estimation helpers (`./points.ts`).
 *
 * These pure functions reproduce the legacy `EstimationProcess`
 * (`app/coffee/modules/common/estimation.coffee`) point maths that the Backlog
 * points editor depends on. The parity rules under test:
 *   - an unestimated story (empty `points` map, or every role's point value
 *     null) totals to the literal `"?"` sentinel — NEVER a fabricated `0`;
 *   - `calculateTotalPoints` sums only the non-null point VALUES;
 *   - `computableRoles` keeps only roles whose `computable` flag is not false;
 *   - `roleDisplayPoints` yields a role's point NAME (or `"?"`).
 */

import {
    UNESTIMATED,
    buildPointsById,
    calculateTotalPoints,
    computableRoles,
    roleDisplayPoints,
} from "./points";
import type { Project, UserStory } from "../types";

const project: Project = {
    id: 1,
    slug: "p",
    name: "P",
    my_permissions: [],
    is_kanban_activated: true,
    is_backlog_activated: true,
    roles: [
        { id: 5, name: "Design", computable: true },
        { id: 6, name: "Front", computable: true },
        { id: 7, name: "Stakeholder", computable: false },
    ],
    points: [
        { id: 30, name: "S", value: 1 },
        { id: 31, name: "L", value: 8 },
        { id: 32, name: "?", value: null },
    ],
} as unknown as Project;

function story(points: Record<string, number | null>): UserStory {
    return { id: 1, ref: 1, points } as unknown as UserStory;
}

describe("buildPointsById", () => {
    it("maps every project point by its id", () => {
        const map = buildPointsById(project);
        expect(map.size).toBe(3);
        expect(map.get(31)!.name).toBe("L");
        expect(map.get(32)!.value).toBeNull();
    });

    it("returns an empty map when the project defines no points", () => {
        expect(buildPointsById({ ...project, points: undefined } as unknown as Project).size).toBe(
            0,
        );
    });
});

describe("computableRoles", () => {
    it("keeps only roles whose computable flag is not false", () => {
        const roles = computableRoles(project);
        expect(roles.map((r) => r.id)).toEqual([5, 6]);
    });

    it("treats a missing computable flag as computable", () => {
        const roles = computableRoles({
            ...project,
            roles: [{ id: 9, name: "R" }],
        } as unknown as Project);
        expect(roles).toHaveLength(1);
    });
});

describe("calculateTotalPoints", () => {
    const pointsById = buildPointsById(project);

    it("returns '?' for an empty points map", () => {
        expect(calculateTotalPoints(story({}), pointsById)).toBe(UNESTIMATED);
    });

    it("returns '?' when the points field is absent", () => {
        expect(calculateTotalPoints({ id: 1 } as unknown as UserStory, pointsById)).toBe(
            UNESTIMATED,
        );
    });

    it("returns '?' when every assigned point has a null value", () => {
        // Role 5 -> point 32 (value null) -> no numeric contribution.
        expect(calculateTotalPoints(story({ "5": 32 }), pointsById)).toBe(UNESTIMATED);
    });

    it("sums the non-null point values across roles", () => {
        // Design -> L (8) + Front -> S (1) = 9.
        expect(calculateTotalPoints(story({ "5": 31, "6": 30 }), pointsById)).toBe(9);
    });

    it("ignores a null-valued role while summing the rest", () => {
        // Design -> L (8), Front -> ? (null) => 8.
        expect(calculateTotalPoints(story({ "5": 31, "6": 32 }), pointsById)).toBe(8);
    });
});

describe("roleDisplayPoints", () => {
    const pointsById = buildPointsById(project);

    it("returns the assigned point NAME for a role", () => {
        expect(roleDisplayPoints(story({ "5": 31 }), 5, pointsById)).toBe("L");
    });

    it("returns '?' when the role has no assigned point", () => {
        expect(roleDisplayPoints(story({ "5": 31 }), 6, pointsById)).toBe(UNESTIMATED);
    });

    it("returns '?' when the assigned point id is unknown", () => {
        expect(roleDisplayPoints(story({ "5": 999 }), 5, pointsById)).toBe(UNESTIMATED);
    });
});
