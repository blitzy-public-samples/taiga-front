/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SquishColumn — Kanban status-column fold/squish (collapse) UI (render-only).
 *
 * React 18 + TypeScript port of the fold/squish presentation the AngularJS
 * Kanban screen produced. It reproduces, pixel-for-pixel, two distinct pieces of
 * the legacy DOM (see the `kanban-table.jade` partial):
 *
 *   1. {@link SquishColumnPlaceholder} — the collapsed column BODY placeholder
 *      (`.placeholder-collapsed`) rendered when a status column is folded.
 *      Consumed by `TaskboardColumn`.
 *   2. {@link SquishColumnToggle} — the board-HEADER fold/unfold buttons (the
 *      `div.options` block, ~lines 47-72 of `kanban-table.jade`): the fold button
 *      plus the NON-archived unfold button.
 *
 * STATE vs. PRESENTATION SPLIT (hard constraint — this file is pure presentation):
 *   The fold-mode STATE — the `folds` map, the "every archived status defaults to
 *   folded" rule, and its browser local-storage persistence under the key
 *   `kanban-statuscolumnmodels` (historically read/written by the board's
 *   `getStatusColumnModes` / `storeStatusColumnModes` helpers) — lives in the
 *   container / hook (`../KanbanApp.tsx` / `../state/useKanbanBoard.ts`), NOT in
 *   this component. The key name above is recorded solely as a REFERENCE for that
 *   container; this component never reads or writes browser storage, which keeps
 *   it side-effect-free and jsdom-testable.
 *
 *   Reference behaviour: the AngularJS `KanbanSquishColumnDirective`
 *   (`main`, ~lines 776-809) exposed `foldStatus(status)`, which flipped
 *   `folds[status.id]`, persisted the fold map, and — for an archived status not
 *   yet hidden — additionally hid that status. In React the container owns all of
 *   that logic; this component merely receives the current `folded` boolean and
 *   emits the user's toggle intent through `onToggleFold` ("props down, events up").
 *
 * The archived-status unfold button (the one carrying the addArchivedStatus /
 * hideStatus behaviour — `ng-if="s.is_archived"` with the
 * `tg-kanban-archived-show-status-header` directive in `kanban-table.jade`) is a
 * SEPARATE component, `ArchivedStatusHeader.tsx`, and is deliberately NOT
 * duplicated here.
 *
 * Visual fidelity: the EXACT existing SCSS class names are reused verbatim
 * (`placeholder-collapsed`, `placeholder-collapsed-wrapper`, `ammount` — the
 * original misspelling is intentionally preserved — `vertical`, `text-holder`,
 * `archived`, `name`, `square-color`, `btn-board`, `option`, `hunfold`, `hidden`,
 * defined in `kanban-table.scss` / `layout/kanban.scss`). No `.scss` file is
 * imported, created, or rewritten.
 *
 * Toolchain: React 18.2.0, TypeScript 5.4.5 under `strict` + `isolatedModules`,
 * JSX automatic runtime (`jsx: "react-jsx"`) — hence there is intentionally no
 * `import React` statement; only type-only imports are used. Kept Node v16.19.1
 * compatible.
 */

import type { ReactElement } from 'react';

import type { Status } from '../../shared/types';
// F-UI-02: the ONE shared SVG-sprite primitive replaces this file's local
// `tg-svg` host + `svgIcon` helper, so every migrated screen paints icons through
// a single implementation. F-UI-06: `translate` bridges the fold/unfold titles and
// the `(Archived)` label to the shell's angular-translate service (English fallback).
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

/**
 * Props for {@link SquishColumnPlaceholder}.
 */
export interface SquishColumnPlaceholderProps {
    /** The status (Kanban column) this collapsed placeholder represents. */
    status: Status;
    /**
     * Number of user stories currently in the column, supplied by the caller
     * (`TaskboardColumn`). Rendered inside the vertical counter for non-archived
     * columns; archived columns hide the counter entirely.
     */
    count: number;
}

/**
 * Collapsed-column BODY placeholder. `TaskboardColumn` renders this in place of
 * the card list while a column is folded, reproducing the `.placeholder-collapsed`
 * block of `kanban-table.jade` (identical in swimlane and no-swimlane modes).
 *
 * Behaviour parity:
 *   - The `.ammount` counter is shown ONLY for non-archived columns
 *     (`ng-if="!s.is_archived"`). The legacy `tg-animated-counter` is rendered as
 *     a static `<span class="vertical">` — the count animation was cosmetic and
 *     out of scope for the migration.
 *   - The `Archived` label (i18n key `KANBAN.ARCHIVED` → "Archived") is shown ONLY
 *     for archived columns (`ng-if="s.is_archived"`).
 *   - The column name and the colour square are always shown; the square's
 *     background colour is the status colour
 *     (`ng-style="{'background-color':s.color}"`).
 */
export function SquishColumnPlaceholder(props: SquishColumnPlaceholderProps): ReactElement {
    const { status, count } = props;

    return (
        <div className="placeholder-collapsed">
            <div className="placeholder-collapsed-wrapper">
                {!status.is_archived && (
                    <div className="ammount">
                        <span className="vertical">{count}</span>
                    </div>
                )}
                <div className="text-holder">
                    {/* F-UI-06: `KANBAN.ARCHIVED` -> "(Archived)" localises through
                        the shell (English fallback). Matches the legacy
                        `div.archived {{'KANBAN.ARCHIVED' | translate}}`. */}
                    {status.is_archived && (
                        <div className="archived">
                            {translate('KANBAN.ARCHIVED', undefined, '(Archived)')}
                        </div>
                    )}
                    <div className="name">{status.name}</div>
                </div>
                <div className="square-color" style={{ backgroundColor: status.color }} />
            </div>
        </div>
    );
}

/**
 * Props for {@link SquishColumnToggle}.
 */
export interface SquishColumnToggleProps {
    /** The status (Kanban column) whose fold state these buttons toggle. */
    status: Status;
    /** `true` when the column is currently folded (collapsed). */
    folded: boolean;
    /**
     * Toggle-intent callback — the React equivalent of the legacy `foldStatus(s)`.
     * The container flips `folds[status.id]`, persists the fold map, and applies
     * the archived-hide rule; this component only signals the user's intent.
     */
    onToggleFold: (status: Status) => void;
}

/**
 * Board-HEADER fold/unfold buttons, reproducing the `div.options` block
 * (~lines 47-72 of `kanban-table.jade`): the fold button and the NON-archived
 * unfold button.
 *
 * Behaviour parity:
 *   - The fold button is always rendered; it gains the `hidden` class when the
 *     column is already folded (`ng-class='{hidden:folds[s.id]}'`).
 *   - The unfold button (`.hunfold`) is rendered ONLY for non-archived columns
 *     (the original `ng-hide="s.is_archived"`); it gains the `hidden` class when
 *     the column is NOT folded (`ng-class='{hidden:!folds[s.id]}'`). For archived
 *     columns the equivalent button lives in `ArchivedStatusHeader.tsx`, so this
 *     component renders nothing extra for them.
 *   - Both buttons invoke {@link SquishColumnToggleProps.onToggleFold}.
 *
 * Titles come from the same i18n keys the directive used:
 * `KANBAN.TITLE_ACTION_FOLD` → "Fold", `KANBAN.TITLE_ACTION_UNFOLD` → "Unfold".
 * `type="button"` is set explicitly so the buttons never act as implicit form
 * submitters (the legacy markup used an invalid `href` on `<button>`).
 */
export function SquishColumnToggle(props: SquishColumnToggleProps): ReactElement {
    const { status, folded, onToggleFold } = props;

    return (
        <>
            <button
                type="button"
                className={`btn-board option${folded ? ' hidden' : ''}`}
                // F-UI-06: KANBAN.TITLE_ACTION_FOLD -> "Fold column".
                title={translate('KANBAN.TITLE_ACTION_FOLD', undefined, 'Fold column')}
                onClick={() => onToggleFold(status)}
            >
                <TgSvg icon="icon-fold-column" />
            </button>
            {!status.is_archived && (
                <button
                    type="button"
                    className={`btn-board option hunfold${!folded ? ' hidden' : ''}`}
                    // F-UI-06: KANBAN.TITLE_ACTION_UNFOLD -> "Unfold column".
                    title={translate('KANBAN.TITLE_ACTION_UNFOLD', undefined, 'Unfold column')}
                    onClick={() => onToggleFold(status)}
                >
                    <TgSvg icon="icon-unfold-column" />
                </button>
            )}
        </>
    );
}
