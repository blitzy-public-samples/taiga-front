/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import moment from "moment";
import {
    DEFAULT_US_DUEDATES,
    dueDateColor,
    dueDateTitle,
    getDueDateStatus,
    type DueDateAppearance,
} from "../dueDate";

/**
 * Deterministic tests for the due-date appearance logic ported from
 * `DueDateService` (`app/modules/components/due-date/due-date.service.coffee`).
 * `now` is injected so the classification never depends on the wall clock.
 */
describe("dueDate helpers (ported from DueDateService)", () => {
    const now = moment("2024-01-20");

    it("returns no status/color and an empty title when there is no due date", () => {
        expect(getDueDateStatus(null, DEFAULT_US_DUEDATES, now)).toBeNull();
        expect(dueDateColor(undefined, DEFAULT_US_DUEDATES, now)).toBeNull();
        expect(dueDateTitle("", DEFAULT_US_DUEDATES, now)).toBe("");
    });

    it("classifies a date more than 14 days out as 'normal due' (green)", () => {
        expect(dueDateColor("2024-03-01", DEFAULT_US_DUEDATES, now)).toBe("#93C45D");
        expect(dueDateTitle("2024-03-01", DEFAULT_US_DUEDATES, now)).toBe(
            "01 Mar 2024 (normal due)",
        );
    });

    it("classifies a date within 14 days (not yet past) as 'due soon' (orange)", () => {
        expect(dueDateColor("2024-01-25", DEFAULT_US_DUEDATES, now)).toBe("#EA7B4B");
        expect(dueDateTitle("2024-01-25", DEFAULT_US_DUEDATES, now)).toBe(
            "25 Jan 2024 (due soon)",
        );
    });

    it("classifies a date on or before now as 'past due' (red)", () => {
        expect(dueDateColor("2024-01-15", DEFAULT_US_DUEDATES, now)).toBe("#E44057");
        expect(dueDateTitle("2024-01-15", DEFAULT_US_DUEDATES, now)).toBe(
            "15 Jan 2024 (past due)",
        );
    });

    it("honors a project-provided threshold config over the defaults", () => {
        const cfg: DueDateAppearance[] = [
            { color: "#000000", name: "base", days_to_due: null, by_default: true },
            { color: "#ffffff", name: "soon", days_to_due: 30, by_default: false },
        ];
        // 2024-02-10 is 21 days out -> within the 30-day "soon" window.
        expect(dueDateColor("2024-02-10", cfg, now)).toBe("#ffffff");
        // 2024-03-01 is > 30 days out -> baseline.
        expect(dueDateColor("2024-03-01", cfg, now)).toBe("#000000");
    });
});
