/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for `niceScale` ([G] — burndown numeric y-axis).
 *
 * The AngularJS burndown got its numeric y-axis for free from Flot; the React
 * chart draws the series itself, so [G] required computing a "nice" enclosing
 * axis + evenly-spaced tick values. We assert the invariants that make the axis
 * correct for the data range (encloses [min,max], evenly spaced, endpoints are
 * the tick bounds) rather than pixel-identical Flot tick values, which is the
 * design contract: numeric labels that correctly bound the plotted data
 * (including the React series' NEGATIVE increments).
 */

import { niceScale } from "../Burndown";
import type { NiceScale } from "../Burndown";

/** Assert a scale encloses [min,max] with evenly-spaced ticks. */
function expectEnclosingEvenScale(scale: NiceScale, min: number, max: number): void {
    // Encloses the requested range.
    expect(scale.niceMin).toBeLessThanOrEqual(min);
    expect(scale.niceMax).toBeGreaterThanOrEqual(max);

    // At least two ticks, ascending, endpoints equal the nice bounds.
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    expect(scale.ticks[0]).toBe(scale.niceMin);
    expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.niceMax);

    // Every tick finite and strictly ascending with a CONSTANT spacing.
    const spacing = scale.ticks[1] - scale.ticks[0];
    expect(spacing).toBeGreaterThan(0);
    for (let i = 0; i < scale.ticks.length; i += 1) {
        expect(Number.isFinite(scale.ticks[i])).toBe(true);
        if (i > 0) {
            // Allow tiny float drift although the impl snaps to the grid.
            expect(scale.ticks[i] - scale.ticks[i - 1]).toBeCloseTo(spacing, 6);
        }
    }
}

describe("niceScale", () => {
    it("produces an enclosing, evenly-spaced axis for a positive range", () => {
        const scale = niceScale(0, 1000);
        expectEnclosingEvenScale(scale, 0, 1000);
        expect(scale.niceMin).toBe(0);
        expect(scale.niceMax).toBeGreaterThanOrEqual(1000);
    });

    it("handles a NEGATIVE-to-positive range (React increments go below zero)", () => {
        const scale = niceScale(-40, 100);
        expectEnclosingEvenScale(scale, -40, 100);
        expect(scale.niceMin).toBeLessThanOrEqual(-40);
    });

    it("returns a safe unit axis for a flat zero series", () => {
        expect(niceScale(0, 0)).toEqual({ niceMin: 0, niceMax: 1, ticks: [0, 1] });
    });

    it("pads a flat non-zero series into a real enclosing range", () => {
        const scale = niceScale(5, 5);
        expect(scale.niceMin).toBeLessThanOrEqual(5);
        expect(scale.niceMax).toBeGreaterThanOrEqual(5);
        expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    });

    it("returns a safe unit axis for non-finite inputs", () => {
        expect(niceScale(Number.NaN, 10)).toEqual({ niceMin: 0, niceMax: 1, ticks: [0, 1] });
        expect(niceScale(0, Number.POSITIVE_INFINITY)).toEqual({
            niceMin: 0,
            niceMax: 1,
            ticks: [0, 1],
        });
    });

    it("respects a smaller requested tick target", () => {
        const scale = niceScale(0, 100, 3);
        expectEnclosingEvenScale(scale, 0, 100);
    });
});
