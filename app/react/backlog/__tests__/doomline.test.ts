/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for `computeDoomlineBreakIndex` ([A] — "Project Scope [Doomline]").
 *
 * Ports the AngularJS `linkDoomLine` logic (backlog/main.coffee L727-765): the
 * doomline is drawn ONLY when velocity is NOT displayed and the project has a
 * non-zero total-points scope; it marks the FIRST user story at which the
 * cumulative committed points (starting from `assigned_points`) exceed the
 * project's `total_points`.
 */

import { computeDoomlineBreakIndex } from "../BacklogTable";
import type { ProjectStats, UserStory } from "../types";

/** Minimal user story carrying only the field the doomline reads. */
function us(total_points: number | null): UserStory {
    return { total_points } as unknown as UserStory;
}

/** Minimal ProjectStats with the two fields the doomline reads. */
function stats(total_points: number | null, assigned_points: number): ProjectStats {
    return { total_points, assigned_points } as unknown as ProjectStats;
}

describe("computeDoomlineBreakIndex", () => {
    it("returns -1 when velocity is displayed (doomline suppressed)", () => {
        expect(
            computeDoomlineBreakIndex([us(200)], stats(100, 0), /* displayVelocity */ true),
        ).toBe(-1);
    });

    it("returns -1 when there are no stats", () => {
        expect(computeDoomlineBreakIndex([us(200)], null, false)).toBe(-1);
    });

    it("returns -1 when total_points is zero or null (no scope)", () => {
        expect(computeDoomlineBreakIndex([us(200)], stats(0, 0), false)).toBe(-1);
        expect(computeDoomlineBreakIndex([us(200)], stats(null, 0), false)).toBe(-1);
    });

    it("marks the first story whose cumulative points exceed total_points", () => {
        // cumulative: 40, 80, 120 -> first > 100 at index 2.
        expect(
            computeDoomlineBreakIndex([us(40), us(40), us(40)], stats(100, 0), false),
        ).toBe(2);
    });

    it("starts the running sum from assigned_points", () => {
        // assigned 90 + [5,5,5] -> 95, 100, 105 -> first > 100 at index 2.
        expect(
            computeDoomlineBreakIndex([us(5), us(5), us(5)], stats(100, 90), false),
        ).toBe(2);
    });

    it("treats a null story total_points as zero", () => {
        // 0 + [null->0, 150] -> 0, 150 -> first > 100 at index 1.
        expect(
            computeDoomlineBreakIndex([us(null), us(150)], stats(100, 0), false),
        ).toBe(1);
    });

    it("returns -1 when the backlog never exceeds the scope", () => {
        expect(
            computeDoomlineBreakIndex([us(10), us(10)], stats(1000, 0), false),
        ).toBe(-1);
    });

    it("returns -1 for an empty backlog", () => {
        expect(computeDoomlineBreakIndex([], stats(100, 0), false)).toBe(-1);
    });
});
