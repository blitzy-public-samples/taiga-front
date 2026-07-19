/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ArchivedStatusHeader — the "unfold" control that sits in a Kanban board
 * column header for an ARCHIVED status (render-only).
 *
 * React port of the AngularJS `tgKanbanArchivedShowStatusHeader` directive
 * (`app/coffee/modules/kanban/main.coffee`, lines 723-748) together with the
 * archived variant of the unfold button in
 * `app/partials/includes/modules/kanban-table.jade` (lines ~55-63):
 *
 *   button.btn-board.option.hunfold(
 *       ng-click='foldStatus(s)'
 *       title="{{'KANBAN.TITLE_ACTION_UNFOLD' | translate}}"
 *       ng-class='{hidden:!folds[s.id]}'
 *       ng-if="s.is_archived"
 *       tg-kanban-archived-show-status-header="s"
 *   )
 *       tg-svg(svg-icon="icon-unfold-column")
 *
 * The original directive did three things for the archived column:
 *   (1) ONCE, after the board's first load, it registered the status as an
 *       archived status and hid it — `addArchivedStatus(status.id)` followed by
 *       `hideStatus(status.id)`;
 *   (2) the hosting button toggled the column fold via the controller's
 *       `foldStatus(s)`; and
 *   (3) ON CLICK, when the status was currently hidden, it asked the board to
 *       load + reveal the archived user stories — broadcasting
 *       `kanban:show-userstories-for-status` and calling `showStatus(status.id)`.
 *
 * STATE / SIDE-EFFECT SPLIT (hard presentational constraint):
 *   `addArchivedStatus`, `hideStatus`, `showStatus`, the `statusHide` set, and
 *   the `kanban:show-userstories-for-status` -> `kanban:shown-userstories-for-status`
 *   round-trip are CONTAINER / state concerns
 *   (`../KanbanApp.tsx` / `../state/useKanbanBoard.ts` / `../state/boardReducer.ts`),
 *   which in turn drive `ArchivedStatusIntro`. This component owns NONE of that
 *   state: it merely emits intent through callback props ("events up") and lets
 *   the container mutate board state. In particular, the container's
 *   `onShowArchived` handler is responsible for reproducing the original
 *   `if statusHide.includes(id)` guard before it broadcasts / reveals — this
 *   component never re-implements that guard because it does not own `statusHide`.
 *
 * PRESENTATIONAL ONLY: no fetch/API/WebSocket/immer/reducer/direct-DOM/jQuery/
 * localStorage access. It reuses the EXACT existing SCSS class names
 * (`btn-board`, `option`, `hunfold`, `hidden`) and icon id (`icon-unfold-column`)
 * for pixel fidelity and does not import or rewrite any `.scss`.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement; only the hooks and types actually used are imported.
 * Kept Node v16.19.1 / TypeScript 5.4.5 / React 18.2.0 compatible.
 */

import { useEffect, useRef } from 'react';
import type { Status } from '../../shared/types';
// F-UI-02: the ONE shared SVG-sprite primitive replaces this file's local
// `tg-svg` host + `svgIcon` helper. F-UI-06: `translate` bridges the button title
// to the shell's angular-translate service (English fallback for shell-less renders).
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

/**
 * Props for {@link ArchivedStatusHeader}. All handlers are optional so the
 * component can be rendered in isolation (e.g. unit tests) without wiring.
 */
export interface ArchivedStatusHeaderProps {
    /**
     * The archived status (Kanban column) this control belongs to. Passed
     * opaquely to the callbacks; the parent only renders this control for
     * statuses where `is_archived` is true (the original `ng-if="s.is_archived"`).
     */
    status: Status;
    /**
     * The container's `folds[status.id]` flag. Drives the `hidden` class exactly
     * like `ng-class='{hidden:!folds[s.id]}'`: the unfold button is `hidden`
     * when the column is NOT folded, and visible once it IS folded.
     */
    folded: boolean;
    /**
     * Fired ONCE after mount — the React equivalent of the directive's one-time
     * (post-initial-load) `addArchivedStatus(status.id)` + `hideStatus(status.id)`.
     * The container performs both state mutations.
     */
    onMountArchived?: (status: Status) => void;
    /**
     * Fired on click — the React equivalent of the directive's click branch
     * (`broadcast('kanban:show-userstories-for-status', id)` + `showStatus(id)`).
     * The container decides, via its own `statusHide` set, whether the status is
     * currently hidden and, if so, loads and reveals the archived user stories.
     */
    onShowArchived?: (status: Status) => void;
    /**
     * Fired on click — the host template's `foldStatus(s)`. This is the same
     * fold handler the (non-archived) fold/unfold controls use, so fold
     * behaviour is identical for the archived column.
     */
    onToggleFold?: (status: Status) => void;
}

/**
 * The archived-status unfold control. Rendered by the parent only for archived
 * statuses; the button shape is kept identical to the source template.
 *
 * Behaviour parity with `main.coffee:723-748`:
 *   - mount            -> `onMountArchived(status)`  (= addArchivedStatus + hideStatus)
 *   - click            -> `onToggleFold(status)`     (= host `foldStatus(s)`)
 *                         `onShowArchived(status)`    (= guarded broadcast + showStatus,
 *                                                        the guard living in the container)
 */
export function ArchivedStatusHeader(props: ArchivedStatusHeaderProps) {
    const { status, folded, onMountArchived, onShowArchived, onToggleFold } = props;

    // Reproduce the directive's "run exactly once after the initial load"
    // semantics. The AngularJS code used `$watch 'ctrl.initialLoad'` + `unwatch()`
    // so the body ran a single time when the board first rendered. Because this
    // React component is only mounted once the board has loaded, a guarded mount
    // effect is the faithful equivalent; the `useRef` guard keeps it to exactly
    // one invocation even under React 18 StrictMode's double-invoked effects.
    const mounted = useRef(false);
    useEffect(() => {
        if (mounted.current) {
            return;
        }
        mounted.current = true;
        onMountArchived?.(status);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <button
            type="button"
            // `hidden` when NOT folded, mirroring `ng-class='{hidden:!folds[s.id]}'`.
            className={`btn-board option hunfold${!folded ? ' hidden' : ''}`}
            // F-UI-06: KANBAN.TITLE_ACTION_UNFOLD -> "Unfold column" (localised via
            // the shell, English fallback here). Matches the legacy
            // `title="{{'KANBAN.TITLE_ACTION_UNFOLD' | translate}}"` on this button.
            title={translate('KANBAN.TITLE_ACTION_UNFOLD', undefined, 'Unfold column')}
            // The source element carried BOTH `ng-click='foldStatus(s)'` AND the
            // directive's own `$el.on('click', …)` show-archived handler, so a
            // single click did both. Order preserved: toggle fold, then show.
            onClick={() => {
                onToggleFold?.(status);
                onShowArchived?.(status);
            }}
        >
            <TgSvg icon="icon-unfold-column" />
        </button>
    );
}
