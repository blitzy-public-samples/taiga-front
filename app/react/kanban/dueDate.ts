/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import moment from "moment";

/**
 * Due-date appearance helpers ported verbatim from the AngularJS
 * `DueDateService` (`app/modules/components/due-date/due-date.service.coffee`)
 * and surfaced on the shared card via the `dueDateColor()` / `dueDateTitle()`
 * template helpers used by `card-templates/card-data.jade`.
 *
 * A user story's due date is classified against a set of thresholds. Each
 * threshold assigns a color and a human-readable status name once "now" reaches
 * the point "dueDate − days_to_due days". The baseline (`by_default`) entry has
 * `days_to_due: null` and applies when no threshold has been crossed.
 *
 * This module is pure TypeScript: it performs no DOM or network I/O and imports
 * no React, so it is unit-testable in isolation (with an injectable `now`).
 */

/** A single due-date appearance rule (color + status name + threshold). */
export interface DueDateAppearance {
    color: string;
    name: string;
    /** Days before the due date at which this appearance activates; `null` = baseline. */
    days_to_due: number | null;
    by_default: boolean;
}

/**
 * Default user-story due-date thresholds, mirrored 1:1 from
 * `DueDateService.defaultConfig`. Used whenever the project does not define its
 * own `us_duedates` configuration:
 *   - normal due (green)  — baseline, more than 14 days out
 *   - due soon  (orange)  — within 14 days of the due date
 *   - past due  (red)     — on or after the due date
 */
export const DEFAULT_US_DUEDATES: DueDateAppearance[] = [
    { color: "#93C45D", name: "normal due", days_to_due: null, by_default: true },
    { color: "#EA7B4B", name: "due soon", days_to_due: 14, by_default: false },
    { color: "#E44057", name: "past due", days_to_due: 0, by_default: false },
];

/** Moment format for the pretty-printed due date (`COMMON.PICKERDATE.FORMAT`). */
const DUE_DATE_FORMAT = "DD MMM YYYY";

/**
 * Return the baseline appearance (the last entry flagged `by_default`), matching
 * `DueDateService._getDefaultAppearance` (which lets the last match win).
 */
function getDefaultAppearance(
    config: DueDateAppearance[],
): DueDateAppearance | null {
    let defaultAppearance: DueDateAppearance | null = null;
    config.forEach((appearance) => {
        if (appearance.by_default === true) {
            defaultAppearance = appearance;
        }
    });
    return defaultAppearance;
}

/**
 * Resolve the active appearance for a due date, reproducing
 * `DueDateService._getAppearance`:
 *   1. start from the baseline appearance,
 *   2. walk the thresholds in descending `days_to_due` order,
 *   3. apply every threshold whose limit date ("dueDate − days_to_due days") is
 *      on or before "now".
 * Because the thresholds are processed farthest-first, the nearest crossed
 * threshold (e.g. "past due" at 0 days) overrides farther ones (e.g. "due soon"
 * at 14 days).
 *
 * @param dueDate ISO date string (or `null`/`undefined` for no due date).
 * @param config  Threshold set (defaults to {@link DEFAULT_US_DUEDATES}).
 * @param now     Reference "now" moment (injectable for deterministic tests).
 */
export function getDueDateStatus(
    dueDate: string | null | undefined,
    config: DueDateAppearance[] = DEFAULT_US_DUEDATES,
    now: moment.Moment = moment(),
): DueDateAppearance | null {
    if (!dueDate) {
        return null;
    }

    let current = getDefaultAppearance(config);

    // Sort descending by days_to_due (null treated as 0, as in the CoffeeScript
    // `-o.days_to_due` sort key); Array.prototype.sort is stable on Node >= 11.
    const sorted = [...config].sort(
        (a, b) => (b.days_to_due ?? 0) - (a.days_to_due ?? 0),
    );

    const due = moment(dueDate);
    sorted.forEach((appearance) => {
        if (appearance.days_to_due === null) {
            return;
        }
        const limitDate = moment(due).subtract(appearance.days_to_due, "days");
        if (now.isSameOrAfter(limitDate)) {
            current = appearance;
        }
    });

    return current;
}

/**
 * Resolve the fill color for a due date (`DueDateService.color`). Returns `null`
 * when there is no due date, so callers can omit the `fill` style entirely.
 */
export function dueDateColor(
    dueDate: string | null | undefined,
    config: DueDateAppearance[] = DEFAULT_US_DUEDATES,
    now: moment.Moment = moment(),
): string | null {
    return getDueDateStatus(dueDate, config, now)?.color ?? null;
}

/**
 * Resolve the human-readable due-date title (`DueDateService.title` /
 * `_formatTitle`): the date formatted as `DD MMM YYYY`, suffixed with the status
 * name in parentheses (e.g. `"15 Jan 2024 (past due)"`). Returns `""` when there
 * is no due date.
 */
export function dueDateTitle(
    dueDate: string | null | undefined,
    config: DueDateAppearance[] = DEFAULT_US_DUEDATES,
    now: moment.Moment = moment(),
): string {
    if (!dueDate) {
        return "";
    }

    const formattedDate = moment(dueDate).format(DUE_DATE_FORMAT);
    const status = getDueDateStatus(dueDate, config, now);
    if (status?.name) {
        return `${formattedDate} (${status.name})`;
    }
    return formattedDate;
}
