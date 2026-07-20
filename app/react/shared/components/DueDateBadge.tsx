/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * DueDateBadge — React 18 port of the AngularJS `tg-due-date` directive rendered
 * in its default ("icon") format.
 *
 * Reproduces `app/modules/components/due-date/due-date-icon.jade`:
 *
 *   tg-svg.due-date-icon(
 *     ng-if="vm.visible()"
 *     svg-icon="icon-clock"
 *     svg-fill="vm.color()"
 *     ng-attr-title="{{ 'COMMON.CARD.DUE_DATE' | translate: { date: vm.title() } }}"
 *   )
 *
 * hosted inside the `tg-due-date.due-date` element from `backlog-row.jade:53`
 * and `sprint.jade:43`:
 *
 *   tg-due-date.due-date(due-date="us.due_date" is-closed="us.is_closed" ng-if="us.due_date" obj-type="us")
 *
 * The badge is a DISPLAY-ONLY clock icon (the backlog/sprint rows never expose
 * the click-to-edit affordance the Kanban card's due-date button does), so the
 * legacy `disabled()`/`setDueDate()` click wiring is intentionally not
 * reproduced — only `visible()` (the `ng-if="us.due_date"` gate, applied by the
 * caller), `color()` and `title()`.
 *
 * The DOM mirrors the compiled AngularJS output exactly — a `tg-due-date`
 * element carrying `class="due-date"`, a `tg-svg` element carrying
 * `class="due-date-icon"`, and an inner `<svg class="icon icon-clock">` whose
 * `fill` is the resolved status colour — so the existing SCSS
 * (`backlog-table.scss:369`, `sprints.scss:243`) styles the React output with
 * zero visual change. `class` (NOT `className`) is passed to the custom-element
 * string tags because React does not apply its `className -> class` mapping to
 * unknown/custom elements; `className` would emit a bogus `classname` attribute
 * and the `.due-date` / `.due-date-icon` selectors would never match.
 */

import { dueDateColor, dueDateTitle } from '../dueDate';
import type { DueDateProject } from '../dueDate';
import { t } from '../i18n';

// Custom-element string tags reproduced as inert hosts (see the file header for
// why `class` is used instead of `className`). Typed as `any` (matching
// `Card.tsx`) so JSX accepts the `class` attribute and element children.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TgDueDate = 'tg-due-date' as unknown as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TgSvg = 'tg-svg' as unknown as any;

export interface DueDateBadgeProps {
  /** The story's `due_date` (ISO string). The caller renders the badge only when set. */
  dueDate: string;
  /**
   * The resolved project (read for the per-type `us_duedates` appearance
   * override). Optional: when absent the default appearance config is used
   * (`DueDateService` falls back to `defaultConfig` the same way).
   */
  project?: DueDateProject;
}

/**
 * Renders the due-date clock badge for a Backlog / sprint user-story row.
 *
 * `fill` is `vm.color()` (the resolved appearance colour: green "normal due",
 * orange "due soon", red "past due"); the `<title>` is
 * `translate('COMMON.CARD.DUE_DATE', { date: vm.title() })` -> e.g.
 * "Due date: 15 Jun 2026 (past due)".
 */
export function DueDateBadge({ dueDate, project }: DueDateBadgeProps) {
  const fill = dueDateColor(project ?? null, dueDate);
  const title = t('COMMON.CARD.DUE_DATE', { date: dueDateTitle(project ?? null, dueDate) });

  return (
    <TgDueDate {...({ class: 'due-date' } as Record<string, unknown>)}>
      <TgSvg {...({ class: 'due-date-icon' } as Record<string, unknown>)}>
        <svg className="icon icon-clock" style={{ fill }}>
          <use
            xlinkHref="#icon-clock"
            {...({ 'attr-href': '#icon-clock' } as Record<string, unknown>)}
          >
            <title>{title}</title>
          </use>
        </svg>
      </TgSvg>
    </TgDueDate>
  );
}
