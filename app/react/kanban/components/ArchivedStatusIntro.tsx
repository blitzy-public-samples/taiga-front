/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ArchivedStatusIntro — archived-column intro spacer (render-only).
 *
 * React 18 port of the AngularJS `tgKanbanArchivedStatusIntro` directive
 * (`KanbanArchivedStatusIntroDirective`, lines 754-770 of the legacy CoffeeScript
 * Kanban module `modules/kanban/main`) and its host element declared in the Jade
 * partial `app/partials/includes/modules/kanban-table.jade`:
 *
 *     div.kanban-column-intro(ng-if="s.is_archived", tg-kanban-archived-status-intro="s")
 *
 * That host is an EMPTY `div.kanban-column-intro` rendered at the bottom of every
 * archived status column — identical in the swimlane board mode (kanban-table.jade
 * lines 172-175) and the no-swimlane board mode (lines 247-250). It has no children
 * of its own; its entire appearance comes from the existing `.kanban-column-intro`
 * rule in `app/styles/modules/kanban/kanban-table.scss`. This component therefore
 * renders exactly that one empty, styled `<div>` and nothing more — a pixel-faithful
 * spacer that reuses the EXACT existing SCSS class name and does NOT import, create,
 * or rewrite any `.scss`.
 *
 * Moved behavior (hard state/side-effect split): the original
 * `tgKanbanArchivedStatusIntro` refreshed the column's user stories on
 * `kanban:shown-userstories-for-status` (deleteStatus + add). That state mutation now
 * lives in `../state/useKanbanBoard.ts` / `../state/boardReducer.ts`; this component
 * only renders the `.kanban-column-intro` spacer that `TaskboardColumn` places at the
 * bottom of an archived column. The full event round-trip — `ArchivedStatusHeader`
 * click → container broadcasts `show-userstories-for-status` → loads the archived
 * stories → dispatches the equivalent of `shown-userstories-for-status` → the reducer
 * deletes + adds for that status — is owned by the container, NOT re-implemented here.
 * Consequently this file performs no fetch/API/WebSocket/reducer/immer/DOM/jQuery/
 * event-bus/web-storage work of any kind: it is purely presentational.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement, and no hooks are used. Kept Node v16.19.1 / TypeScript
 * 5.4.5 / React 18.2.0 compatible.
 */

import type { Status } from '../../shared/types';

/**
 * Props for {@link ArchivedStatusIntro}.
 *
 * `status` is optional and provided only for parity/testing with the original
 * directive, which received the archived status through its
 * `tg-kanban-archived-status-intro="s"` attribute. The rendered DOM does NOT vary by
 * status — the legacy template emitted a single empty `div.kanban-column-intro`
 * regardless of the status — so the value is intentionally not read while rendering.
 */
export interface ArchivedStatusIntroProps {
  /** The archived status this intro spacer sits beneath (parity/testing only). */
  status?: Status;
}

/**
 * Render the empty `.kanban-column-intro` spacer shown at the bottom of an archived
 * Kanban status column. Byte-for-byte equivalent of the legacy host element
 * (`<div class="kanban-column-intro"></div>` with no children), so the existing
 * `kanban-table.scss` styling applies unchanged.
 *
 * The props are intentionally unused while rendering (the DOM is invariant), so the
 * parameter is prefixed with `_` to keep the component clean under strict compilation.
 */
export function ArchivedStatusIntro(_props: ArchivedStatusIntroProps): JSX.Element {
  return <div className="kanban-column-intro" />;
}
