/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared due-date service logic
 * (`app/react/shared/dueDate.ts`), a React 18 port of the AngularJS
 * `tgDueDateService` (`app/modules/components/due-date/due-date.service.coffee`).
 *
 * This module is the SINGLE source of truth for the due-date "appearance"
 * (colour + tooltip title) shared by the Kanban card (`Card.tsx`) and the
 * Backlog / sprint rows (`UserStoryRow.tsx`, `Sprint.tsx` via `DueDateBadge`),
 * so the M-11 backlog/sprint due-date badges compute IDENTICAL colours and
 * titles to the Kanban card. This spec pins:
 *   - `getDueDateConfig` (per-project `us_duedates` override vs the default config),
 *   - `getDueDateStatus` (`_getAppearance`: sort-desc-by-days, walk skipping
 *     `null`, last-match-wins so "past due" overrides "due soon"),
 *   - `dueDateColor` (`color()`), and
 *   - `dueDateTitle` (`title()` / `_formatTitle` — "DD MMM YYYY (<status>)").
 *
 * Dates are expressed as offsets from "now" (mirroring Card.test.tsx) so the
 * status boundaries are deterministic regardless of the run date. It counts
 * toward the >=70% line-coverage gate over `app/react/**` and is hermetic.
 */

import {
  DEFAULT_DUE_DATE_CONFIG,
  DUE_DATE_FORMAT,
  getDueDateConfig,
  getDueDateStatus,
  dueDateColor,
  dueDateTitle,
} from '../dueDate';
import type { DueDateAppearance } from '../dueDate';
import moment from 'moment';

/** ISO `YYYY-MM-DD` for a date `offsetDays` from now (negative = past). */
const iso = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

describe('getDueDateConfig — project override vs default', () => {
  it('returns the DEFAULT config when the project is null/undefined', () => {
    expect(getDueDateConfig(null)).toBe(DEFAULT_DUE_DATE_CONFIG);
    expect(getDueDateConfig(undefined)).toBe(DEFAULT_DUE_DATE_CONFIG);
  });

  it('returns the DEFAULT config when the project has no `us_duedates`', () => {
    expect(getDueDateConfig({ id: 1 })).toBe(DEFAULT_DUE_DATE_CONFIG);
  });

  it('returns the DEFAULT config when `us_duedates` is an empty array', () => {
    // Legacy falls back unless the override is a NON-empty array (the `.length` gate).
    expect(getDueDateConfig({ us_duedates: [] })).toBe(DEFAULT_DUE_DATE_CONFIG);
  });

  it('returns the per-project `us_duedates` when present and non-empty', () => {
    const override: DueDateAppearance[] = [
      { color: '#000000', name: 'custom deadline', days_to_due: 0, by_default: true },
    ];
    expect(getDueDateConfig({ us_duedates: override })).toBe(override);
  });
});

describe('getDueDateStatus — `_getAppearance` walk parity', () => {
  it('returns null when there is no due date', () => {
    expect(getDueDateStatus(null, null)).toBeNull();
    expect(getDueDateStatus(null, undefined)).toBeNull();
    expect(getDueDateStatus(null, '')).toBeNull();
  });

  it('is "normal due" (the by_default rule) for a far-future date', () => {
    // Neither the 14-day nor the 0-day limit is reached, so the default wins.
    expect(getDueDateStatus(null, iso(100))?.name).toBe('normal due');
  });

  it('is "due soon" inside the 14-day window (but not yet due)', () => {
    // now >= due-14d (true) but now >= due (false) -> "due soon".
    expect(getDueDateStatus(null, iso(7))?.name).toBe('due soon');
  });

  it('is "past due" once the due date has passed (last match wins over "due soon")', () => {
    // Both the 14-day and 0-day limits are reached; the LATER "past due" wins.
    expect(getDueDateStatus(null, iso(-5))?.name).toBe('past due');
  });

  it('honours a per-project `us_duedates` override', () => {
    const project = {
      us_duedates: [
        { color: '#000000', name: 'custom deadline', days_to_due: 0, by_default: true },
      ],
    };
    expect(getDueDateStatus(project, iso(-2))?.name).toBe('custom deadline');
  });
});

describe('dueDateColor — `color()` parity', () => {
  it('returns an empty string when there is no due date', () => {
    expect(dueDateColor(null, null)).toBe('');
  });

  it('maps each appearance to its configured colour', () => {
    expect(dueDateColor(null, iso(100))).toBe('#93C45D'); // normal due
    expect(dueDateColor(null, iso(7))).toBe('#EA7B4B'); // due soon
    expect(dueDateColor(null, iso(-5))).toBe('#E44057'); // past due
  });
});

describe('dueDateTitle — `title()` / `_formatTitle` parity', () => {
  it('returns an empty string when there is no due date', () => {
    expect(dueDateTitle(null, null)).toBe('');
  });

  it('formats the date as `DD MMM YYYY` and appends the status name in parens', () => {
    // A fixed far-past date is deterministically "past due".
    const title = dueDateTitle(null, '2021-02-01');
    expect(title).toBe(`${moment('2021-02-01').format(DUE_DATE_FORMAT)} (past due)`);
    expect(title).toBe('01 Feb 2021 (past due)');
  });

  it('omits the parenthetical suffix when the resolved status has no name', () => {
    // A custom config whose matching rule has an empty name -> date only.
    const project = {
      us_duedates: [{ color: '#000000', name: '', days_to_due: 0, by_default: true }],
    };
    expect(dueDateTitle(project, '2021-02-01')).toBe('01 Feb 2021');
  });
});
