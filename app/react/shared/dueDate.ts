/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * dueDate — React 18 port of the AngularJS `tgDueDateService`
 * (`app/modules/components/due-date/due-date.service.coffee`).
 *
 * This is the SINGLE source of truth for the due-date "appearance" logic
 * (colour + tooltip title) shared by every screen that renders a due-date
 * badge: the Kanban card (`kanban/components/Card.tsx`) and the Backlog / sprint
 * rows (`backlog/components/UserStoryRow.tsx`, `Sprint.tsx`, via the shared
 * `components/DueDateBadge.tsx`). It was extracted verbatim from the previously
 * card-local helpers so both screens compute identical colours/titles from the
 * same project configuration — matching the legacy where every `tg-due-date`
 * directive delegated to the one `DueDateService`.
 *
 * Faithful reproduction of `DueDateService`:
 *   - `defaultConfig`      -> DEFAULT_DUE_DATE_CONFIG
 *   - `getStatus`          -> getDueDateStatus  (reads `project["<objType>_duedates"]`,
 *                              falling back to the default config)
 *   - `_getAppearance`     -> the walk inside getDueDateStatus
 *   - `color`              -> dueDateColor
 *   - `_formatTitle`/`title` -> dueDateTitle   (the `vm.title()` value; callers
 *                              wrap it with `COMMON.CARD.DUE_DATE` when they need
 *                              the "Due date: <title>" tooltip)
 *
 * Backlog and sprint rows are always object-type `us`, and the Kanban card is
 * likewise a user story, so the project override key read here is `us_duedates`
 * (matching `project["#{objType}_duedates"]` with `objType === 'us'`).
 */

import moment from 'moment';

/** A structural view of the resolved project — only the due-date override is read. */
export type DueDateProject = Record<string, unknown> | null | undefined;

/** A single due-date appearance rule (mirrors `DueDateService.defaultConfig`). */
export interface DueDateAppearance {
  color: string;
  name: string;
  days_to_due: number | null;
  by_default: boolean;
}

/**
 * Default due-date appearance rules, copied verbatim from
 * `DueDateService.defaultConfig` (due-date.service.coffee). Used when the
 * project does not define per-object-type `*_duedates`.
 */
export const DEFAULT_DUE_DATE_CONFIG: DueDateAppearance[] = [
  { color: '#93C45D', name: 'normal due', days_to_due: null, by_default: true },
  { color: '#EA7B4B', name: 'due soon', days_to_due: 14, by_default: false },
  { color: '#E44057', name: 'past due', days_to_due: 0, by_default: false },
];

/**
 * Date format for the due-date title. The legacy service read the translated
 * `COMMON.PICKERDATE.FORMAT`; the English default (and the format used for the
 * migrated screens) is `DD MMM YYYY`. This affects only the tooltip text, never
 * layout.
 */
export const DUE_DATE_FORMAT = 'DD MMM YYYY';

/** Resolve the active due-date config for the project (per-type override or default). */
export const getDueDateConfig = (project: DueDateProject): DueDateAppearance[] => {
  const cfg = project ? (project as Record<string, unknown>)['us_duedates'] : undefined;
  return Array.isArray(cfg) && cfg.length ? (cfg as DueDateAppearance[]) : DEFAULT_DUE_DATE_CONFIG;
};

/**
 * Reproduce `DueDateService._getAppearance` exactly:
 *   - start from the `by_default` appearance;
 *   - sort the config descending by `days_to_due` (via `_.sortBy(cfg, o => -o.days_to_due)`,
 *     where a `null` key coerces to 0 — matching CoffeeScript's `-null === 0`);
 *   - walk the sorted rules, skipping `days_to_due == null`, and for each rule
 *     compute `limitDate = dueDate - days_to_due days`; when `now >= limitDate`
 *     the rule becomes current (LAST match wins, so "past due" overrides
 *     "due soon").
 */
export const getDueDateStatus = (
  project: DueDateProject,
  dueDate: string | null | undefined,
): DueDateAppearance | null => {
  if (!dueDate) {
    return null;
  }

  const config = getDueDateConfig(project);
  let current: DueDateAppearance | null = config.find((c) => c.by_default) ?? null;

  const sorted = [...config].sort((a, b) => -(a.days_to_due ?? 0) - -(b.days_to_due ?? 0));

  const now = moment().valueOf();
  const due = moment(dueDate);

  for (const appearance of sorted) {
    if (appearance.days_to_due == null) {
      continue;
    }
    const limitDate = due.clone().subtract(appearance.days_to_due, 'days').valueOf();
    if (now >= limitDate) {
      current = appearance;
    }
  }

  return current;
};

/** `color()`: the current appearance colour, or `''` when there is no due date. */
export const dueDateColor = (project: DueDateProject, dueDate: string | null | undefined): string =>
  getDueDateStatus(project, dueDate)?.color ?? '';

/**
 * `title()` / `_formatTitle()`: the formatted date, suffixed with the status
 * name in parentheses when the appearance has a name. This is the raw
 * `vm.title()` value; the backlog/sprint badge wraps it with the
 * `COMMON.CARD.DUE_DATE` ("Due date: {{date}}") message, exactly as the legacy
 * `due-date-icon.jade` did.
 */
export const dueDateTitle = (project: DueDateProject, dueDate: string | null | undefined): string => {
  if (!dueDate) {
    return '';
  }
  const formatted = moment(dueDate).format(DUE_DATE_FORMAT);
  const status = getDueDateStatus(project, dueDate);
  return status?.name ? `${formatted} (${status.name})` : formatted;
};
