/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardData — Kanban card statistics / metadata sub-component.
 *
 * React 18 + TypeScript port of the AngularJS `card-data` card template
 * (`app/modules/components/card/card-templates/card-data.jade`) and the
 * `CardDataDirective` controller (`app/coffee/modules/kanban/main.coffee`,
 * lines ~937-1015). This is a PRESENTATIONAL, render-only component: every
 * value arrives through props; there is no data fetching, no state, no
 * DOM/jQuery access, no WebSocket, and no event callbacks (card-data is
 * display-only in the original directive).
 *
 * Migration notes (strict Minimal Change Clause — zero feature change):
 *  - The DOM structure, class names, icon ids, `title` attributes and every
 *    conditional guard reproduce the original Jade EXACTLY, so the unchanged
 *    SCSS (`app/modules/components/card/card.scss`,
 *    `app/styles/modules/kanban/kanban-table.scss`) keeps matching for pixel
 *    fidelity. No new class names are introduced and no styles are imported.
 *  - The due-date colour/title logic is ported verbatim from
 *    `app/modules/components/due-date/due-date.service.coffee`.
 *  - The Immutable.js reads of the legacy code (`.getIn(...)`, `.size`) become
 *    plain property/array access here; `tasks` and `watchers` are plain arrays
 *    in the REST payload, so `.size` maps to `.length`.
 *  - i18n: there is no React i18n layer in scope, so the default English
 *    strings from `app/locales/taiga/locale-en.json` are inlined as literals,
 *    each annotated with its original translation key.
 */

import type { BoardCard, Project } from '../../shared/types';
// F-PERF-01: use the shell's already-loaded global Moment (see shared/moment.ts) so
// esbuild does not bundle a second ~60 KB copy of Moment into react.js.
import moment from '../../shared/moment';
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

/**
 * Props for {@link CardData}.
 *
 * Card fields live under `item.model` (a `UserStory`); `project` supplies the
 * per-project due-date configuration (`project['us_duedates']`); `zoom` is the
 * list of enabled card sections and drives visibility; `zoomLevel` mirrors the
 * AngularJS directive's `zoomLevel` scope binding (0..3) and is accepted for
 * API parity with the sibling card sub-components. Kanban cards are always
 * user stories, so `type` defaults to `'us'`.
 */
export interface CardDataProps {
    item: BoardCard;
    project: Project;
    zoom: string[];
    zoomLevel: number;
    type?: 'us';
}

/* -------------------------------------------------------------------------- *
 * Due-date appearance configuration + resolution algorithm.
 * Ported verbatim from `due-date.service.coffee`.
 * -------------------------------------------------------------------------- */

/** A single due-date appearance rule (mirrors the CoffeeScript config objects). */
interface DueDateAppearance {
    color: string;
    name: string;
    days_to_due: number | null;
    by_default: boolean;
}

/**
 * Default due-date appearance config, identical to
 * `DueDateService.defaultConfig` (`due-date.service.coffee:18-22`). Used when
 * the project does not define its own `<objType>_duedates` config.
 */
const DUE_DATE_DEFAULT_CONFIG: DueDateAppearance[] = [
    { color: '#93C45D', name: 'normal due', days_to_due: null, by_default: true },
    { color: '#EA7B4B', name: 'due soon', days_to_due: 14, by_default: false },
    { color: '#E44057', name: 'past due', days_to_due: 0, by_default: false },
];

/**
 * Display format for the due-date title. Value of the `COMMON.PICKERDATE.FORMAT`
 * locale token in `locale-en.json`, used directly as the moment format string.
 */
const PICKERDATE_FORMAT = 'DD MMM YYYY';

/**
 * Resolve the current due-date appearance, mirroring `getStatus` +
 * `_getDefaultAppearance` + `_getAppearance` in `due-date.service.coffee`.
 * Returns `null` only when there is no due date (or when a custom project
 * config has no default and nothing matches — same as the original).
 */
function getDueDateStatus(
    dueDate: string | undefined,
    objType: string,
    project: Project,
): DueDateAppearance | null {
    // getStatus: `if !options.dueDate then return null`.
    if (!dueDate) {
        return null;
    }

    // `config = project["#{objType}_duedates"]` — read through the Project
    // index signature; fall back to the default config when absent/invalid.
    const projectConfig = (project as Record<string, unknown>)[`${objType}_duedates`];
    const config: DueDateAppearance[] = Array.isArray(projectConfig)
        ? (projectConfig as DueDateAppearance[])
        : DUE_DATE_DEFAULT_CONFIG;

    // _getDefaultAppearance: start from the `by_default: true` appearance.
    let current: DueDateAppearance | null =
        config.find((it) => it.by_default === true) ?? null;

    // _getAppearance: sort a COPY descending by days_to_due (null treated as 0,
    // matching `_.sortBy(config, (o) -> -o.days_to_due)`), so the tightest
    // window ("past due", 0 days) is evaluated last and wins when applicable.
    const sorted = [...config].sort(
        (a, b) => (b.days_to_due ?? 0) - (a.days_to_due ?? 0),
    );

    const now = moment();
    sorted.forEach((appearance) => {
        if (appearance.days_to_due === null) {
            return;
        }
        // Original: `moment(dueDate - moment.duration(days, "days"))`;
        // `moment(dueDate).subtract(days, "days")` is equivalent.
        const limitDate = moment(dueDate).subtract(appearance.days_to_due, 'days');
        if (now.isSameOrAfter(limitDate)) {
            current = appearance;
        }
    });

    return current;
}

/* -------------------------------------------------------------------------- *
 * Local SVG icon helper — reproduces `CardSvgTemplate`
 * (`app/coffee/modules/kanban/main.coffee:855-865`).
 * -------------------------------------------------------------------------- */

/*
 * Icons render through the ONE shared `<TgSvg>` sprite primitive
 * (`app/react/shared/icon.tsx`, F-UI-02), replacing this component's former
 * module-local `svgIcon` helper + `declare global { 'tg-svg' }` block. When a
 * `title` is passed the primitive renders it as an accessible SVG `<title>` and
 * marks the `<svg>` `role="img"` (WCAG-correct accessible name for a standalone
 * meaningful glyph, F-UI-04); decorative icons inside a `title`-bearing wrapper
 * are `aria-hidden`. All user-facing strings resolve through the shared
 * angular-translate bridge (`translate()`, F-UI-06) with the English locale
 * value as the fallback so the labels stay correct when the shell service is
 * unavailable (unit tests).
 */

/* -------------------------------------------------------------------------- *
 * Component
 * -------------------------------------------------------------------------- */

/**
 * Presentational statistics/metadata block for a Kanban card. Renders nothing
 * unless the `extra_info` section is enabled in `zoom`.
 */
export function CardData(props: CardDataProps) {
    const { item, project, zoom } = props;
    // `vm.type` defaults to 'us' for Kanban cards.
    const type = props.type ?? 'us';

    // Port of `vm.visible(name)` — a section renders only when enabled by zoom.
    const visible = (name: string): boolean => zoom.includes(name);

    // The entire template is guarded by `<% if (vm.visible('extra_info')) %>`.
    if (!visible('extra_info')) {
        return null;
    }

    // `item.model` is a typed `UserStory`; `total_points`, `is_closed` and `id`
    // are typed on it, while the remaining card-data fields arrive through the
    // `[key: string]: unknown` index signature and are read via explicit,
    // narrowing casts so the component stays strict-clean.
    const model = item.model;

    const totalPoints = model.total_points; // number | null | undefined (typed)
    const dueDate = model.due_date as string | undefined;
    const isIocaine = model.is_iocaine as boolean | undefined;
    const isBlocked = model.is_blocked as boolean | undefined;
    const watchers = model.watchers as unknown[] | undefined;
    const totalComments = model.total_comments as number | undefined;
    const tasks = model.tasks as Array<{ is_closed?: boolean }> | undefined;

    // `totalAttachments()` for a `us` card = model.total_attachments (a number).
    const totalAttachments = model.total_attachments as number | undefined;

    // `emptyTask()` = `!tasks || !tasks.size` → plain-array length in React.
    const emptyTasks = !tasks || tasks.length === 0;

    // `vm.getClosedTasks().size` / `tasks.size` (card.controller.coffee:64).
    const totalTasks = tasks ? tasks.length : 0;
    const closedTasks = tasks ? tasks.filter((task) => task.is_closed).length : 0;
    const allClosed = closedTasks === totalTasks;

    // `model.watchers.size` in the original; guard against an absent array.
    const watchersCount = watchers ? watchers.length : 0;

    // Due-date colour/title (only meaningful when a due date exists).
    const dueDateStatus = getDueDateStatus(dueDate, type, project);
    const dueDateColor = dueDateStatus?.color ?? null;
    const dueDateTitle = dueDate
        ? `${moment(dueDate).format(PICKERDATE_FORMAT)}${
              dueDateStatus?.name ? ` (${dueDateStatus.name})` : ''
          }`
        : '';

    return (
        <div className={`card-data${emptyTasks ? ' empty-tasks' : ''}`}>
            <div className="card-statistics-init">
                {/* estimation — only for user-story cards (`vm.type == 'us'`) */}
                {type === 'us' ? (
                    <span>
                        {totalPoints ? (
                            <span
                                className="card-estimation"
                                title={translate('COMMON.CARD.ESTIMATION', undefined, 'Estimation')}
                                data-id={model.id}
                            >
                                {translate('COMMON.CARD.PTS', { pts: totalPoints }, `${totalPoints} pts`)}
                            </span>
                        ) : (
                            <span className="card-estimation">
                                {translate('COMMON.CARD.NO_PTS', undefined, 'N/E')}
                            </span>
                        )}
                    </span>
                ) : null}

                {/* due date — icon title is COMMON.CARD.DUE_DATE ("Due date: {{date}}") */}
                {dueDate ? (
                    <div className="card-due-date" title={dueDateTitle}>
                        <TgSvg
                            icon="icon-clock"
                            title={translate(
                                'COMMON.CARD.DUE_DATE',
                                { date: dueDateTitle },
                                `Due date: ${dueDateTitle}`,
                            )}
                            fill={dueDateColor ?? undefined}
                        />
                    </div>
                ) : null}

                {/* iocaine — TASK.FIELDS.IS_IOCAINE */}
                {isIocaine ? (
                    <div
                        className="card-iocaine"
                        title={translate('TASK.FIELDS.IS_IOCAINE', undefined, 'Is iocaine')}
                    >
                        <TgSvg
                            icon="icon-iocaine"
                            title={translate('TASK.FIELDS.IS_IOCAINE', undefined, 'Is iocaine')}
                        />
                    </div>
                ) : null}

                {/* blocked lock */}
                {isBlocked ? (
                    <span className="card-lock">
                        <TgSvg icon="icon-lock" />
                    </span>
                ) : null}
            </div>

            <div className="card-statistics">
                {/* attachments — ATTACHMENT.SECTION_NAME */}
                {totalAttachments ? (
                    <div
                        className="statistic card-attachments"
                        title={translate('ATTACHMENT.SECTION_NAME', undefined, 'Attachments')}
                    >
                        <TgSvg icon="icon-paperclip" />
                        <span>{totalAttachments}</span>
                    </div>
                ) : null}

                {/* watchers — COMMON.WATCHERS.WATCHERS */}
                {watchersCount ? (
                    <div
                        className="statistic card-watchers"
                        title={translate('COMMON.WATCHERS.WATCHERS', undefined, 'Watchers')}
                    >
                        <TgSvg icon="icon-eye" />
                        <span>{watchersCount}</span>
                    </div>
                ) : null}

                {/* comments — COMMENTS.TITLE */}
                {totalComments ? (
                    <div
                        className="statistic card-comments"
                        title={translate('COMMENTS.TITLE', undefined, 'Comments')}
                    >
                        <TgSvg icon="icon-message-square" />
                        <span>{totalComments}</span>
                    </div>
                ) : null}

                {/* completed tasks — COMMON.CARD.TASKS ("{{completed}} tasks of {{total}} completed") */}
                {tasks && tasks.length ? (
                    <div
                        className={`statistic card-completed-tasks${
                            allClosed ? ' completed' : ''
                        }`}
                        title={translate(
                            'COMMON.CARD.TASKS',
                            { completed: closedTasks, total: totalTasks },
                            `${closedTasks} tasks of ${totalTasks} completed`,
                        )}
                    >
                        {`${closedTasks} / ${totalTasks}`}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
