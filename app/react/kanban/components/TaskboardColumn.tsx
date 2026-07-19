/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * TaskboardColumn — a single Kanban status column BODY (render-only).
 *
 * React 18 + TypeScript port of the `.kanban-uses-box.taskboard-column` block of
 * the AngularJS partial `app/partials/includes/modules/kanban-table.jade`
 * (swimlane mode ~lines 112-175, no-swimlane mode ~lines 189-250) together with
 * the `KanbanTaskboardColumnDirective` (`tgKanbanTaskboardColumn`) and the
 * column-level `showPlaceHolder` / `isUsInArchivedHiddenStatus` behaviour of the
 * legacy CoffeeScript module `app/coffee/modules/kanban/main.coffee`. This is the
 * in-place AngularJS 1.5.10 -> React 18 migration of the Kanban board, executed
 * under a strict Minimal Change Clause: the DOM structure, class names, `title`
 * attributes, data attributes and every conditional guard reproduce the original
 * Jade EXACTLY, so the unchanged SCSS (`app/styles/modules/kanban/kanban-table.scss`,
 * `app/styles/layout/kanban.scss`) keeps matching for pixel fidelity. Zero feature
 * change.
 *
 * WHAT THIS COMPONENT RENDERS (mirrors the Jade child order EXACTLY)
 *   1. `.kanban-task-counter` — the WIP-aware story counter, shown ONLY while the
 *      column is NOT folded (the legacy `ng-if='!folds[s.id]'`). Its inner markup
 *      reproduces the `tgAnimatedCounter` template
 *      (`animated-counter.directive.coffee`); see the counter note below.
 *   2. `.placeholder-collapsed` — the collapsed-column body, shown ONLY while the
 *      column IS folded. Delegated to `<SquishColumnPlaceholder>`.
 *   3. `.card-placeholder` — the empty-board / not-found skeleton, shown when the
 *      container resolves `showPlaceHolder(...)` to `true`. Reproduces
 *      `app/partials/common/components/kanban-placeholder.jade` verbatim.
 *   4. The ordered `<Card>` list, with a single `<WipLimit>` marker interleaved
 *      immediately after the card the WIP rule points at (see `computeWipLimit`).
 *   5. `.kanban-column-intro` — the archived-column intro spacer, rendered as the
 *      LAST child only for archived columns. Delegated to `<ArchivedStatusIntro>`.
 *
 * SWIMLANE vs. NO-SWIMLANE MODE (the two Jade blocks differ in exactly four ways;
 * all four are reproduced precisely — see the numbered notes on `hasSwimlane`):
 *   1. `data-swimlane` is emitted ONLY in swimlane mode.
 *   2. The ordered card ids come from `usByStatusSwimlanes[swimlane.id][status.id]`
 *      (swimlane mode) or `usByStatus[status.id]` (no-swimlane mode); the already
 *      resolved list arrives via the `cardIds` prop — this component never computes
 *      it.
 *   3. The `kanban-moved` card class and the `on-click-move-to-top` wiring exist
 *      ONLY in swimlane mode; both are suppressed in no-swimlane mode.
 *   4. `.card-placeholder` visibility uses `showPlaceHolder(s.id, swimlane.id)`
 *      (swimlane) or `showPlaceHolder(s.id)` (no-swimlane); the already resolved
 *      boolean arrives via the `showPlaceholder` prop.
 *
 * `data-status` / `data-swimlane` — HARD CROSS-FOLDER CONTRACT
 *   The sibling `../dnd/KanbanDndContext.tsx` reads `data-status` and, in swimlane
 *   mode, `data-swimlane` off the drop-target column to compute `newStatus` /
 *   `newSwimlane` on drop (mirroring `sortable.coffee:120-122`). They MUST be
 *   emitted as strings: `data-status={String(status.id)}` on EVERY column and
 *   `data-swimlane={String(swimlaneId)}` ONLY when a swimlane id is supplied. They
 *   are never renamed, omitted, or numeric-typed.
 *
 * PRESENTATIONAL ONLY ("props down, events up")
 *   The component performs NO data fetching, no API/WebSocket access, no
 *   immer/reducer work, no direct jQuery/Angular DOM manipulation, and reads no
 *   browser storage. Every value arrives through props and every user intent is
 *   emitted through the `on*` callback props. It holds no local state — the render
 *   is a pure function of its props, which keeps it trivially jsdom-testable.
 *
 * Compiled under `jsx: "react-jsx"` (automatic runtime), so there is deliberately
 * NO `import React`. Only `Fragment` is imported (for the keyed card/WIP wrapper);
 * all domain imports are type-only because the project is compiled with `strict` +
 * `isolatedModules`. Kept Node v16.19.1 / TypeScript 5.4.5 / React 18.2.0
 * compatible.
 */

import { Fragment } from 'react';

import type { Project, Status, UsMap } from '../../shared/types';
import { canMutate } from '../../shared/permissions';
import { DroppableColumn, DraggableCard } from '../dnd/KanbanDndContext';
import { Card } from './Card';
import { WipLimit, computeWipLimit } from './WipLimit';
import { SquishColumnPlaceholder } from './SquishColumn';
import { ArchivedStatusIntro } from './ArchivedStatusIntro';
// F-UI-06: bridge the counter title and empty/not-found placeholder copy to the
// AngularJS shell's angular-translate service (English fallback keeps unit tests
// and shell-less renders correct). Mirrors the legacy `| translate` filters and
// `translate="…"` directives in `kanban-table.jade` / `kanban-placeholder.jade`.
import { translate } from '../../shared/i18n';

/**
 * Props for {@link TaskboardColumn}.
 *
 * The container (`../KanbanApp.tsx` via `../state/useKanbanBoard.ts`) owns the
 * board state and resolves every derived value below; this component only renders.
 * `swimlaneId` is the single switch between the two board modes: when it is a
 * number the column renders in swimlane mode (emits `data-swimlane`, wires the
 * `kanban-moved` class and the move-to-top action); when it is `undefined` / `null`
 * the column renders in no-swimlane mode (all three are suppressed).
 */
export interface TaskboardColumnProps {
    /** The user-story status this column represents (drives id, WIP, archived). */
    status: Status;
    /**
     * Swimlane id for swimlane mode; `undefined` / `null` selects no-swimlane mode.
     * Its presence gates `data-swimlane`, the `kanban-moved` card class and the
     * move-to-top wiring.
     */
    swimlaneId?: number | null;
    /** Ordered user-story ids for this column (already resolved by the container). */
    cardIds: number[];
    /** Board index: user-story id -> its derived `BoardCard`. */
    usMap: UsMap;
    /** The owning project — drives the `readonly` permission gate and card nav. */
    project: Project;
    /** Enabled card sections (drives each card's `visible(name)` membership tests). */
    zoom: string[];
    /** Numeric board zoom level (0..3). */
    zoomLevel: number;
    /** `folds[status.id]` -> `vfold` class + collapsed placeholder instead of counter. */
    folded: boolean;
    /** `unfold === status.id` -> `vunfold` class. */
    unfolded: boolean;
    /** Container's `showPlaceHolder(statusId[, swimlaneId])` result. */
    showPlaceholder: boolean;
    /** `ctrl.notFoundUserstories` -> `not-found` placeholder variant. */
    notFoundUserstories: boolean;
    /** `ctrl.selectedUss` -> per-card `kanban-task-selected` selection state. */
    selectedUss: Record<number, boolean>;
    /** `ctrl.movedUs` -> per-card `kanban-moved` flag (swimlane mode only). */
    movedUs: number[];
    /** `usCardVisibility` -> per-card viewport gate for the card's inner content. */
    inViewPort: Record<number, boolean>;
    /** `isUsInArchivedHiddenStatus(usId)` -> the card's `archived` flag. */
    isUsArchivedHidden: (usId: number) => boolean;
    /** Fired with a user-story id when a card's fold control is toggled. */
    onToggleFold: (id: number) => void;
    /** Fired with a user-story id when "Edit card" is chosen. */
    onClickEdit: (id: number) => void;
    /** Fired with a user-story id when "Delete card" is chosen. */
    onClickDelete: (id: number) => void;
    /** Fired with a user-story id when an avatar / "Assign To" is chosen. */
    onClickAssignedTo: (id: number) => void;
    /** Fired with a user-story id when "Move to top" is chosen (swimlane mode only). */
    onClickMoveToTop: (id: number) => void;
    /** Fired with a user-story id on ctrl/meta click (board multi-select). */
    onToggleSelectedUs: (id: number) => void;
}

/**
 * Render one Kanban status column body for either board mode.
 *
 * Mode is decided by `hasSwimlane` (a swimlane id was supplied). All four
 * documented swimlane/no-swimlane differences hang off this single flag, exactly
 * as the two nearly-identical Jade blocks did.
 */
export function TaskboardColumn(props: TaskboardColumnProps): JSX.Element {
    const {
        status,
        swimlaneId,
        cardIds,
        usMap,
        project,
        zoom,
        zoomLevel,
        folded,
        unfolded,
        showPlaceholder,
        notFoundUserstories,
        selectedUss,
        movedUs,
        inViewPort,
        isUsArchivedHidden,
        onToggleFold,
        onClickEdit,
        onClickDelete,
        onClickAssignedTo,
        onClickMoveToTop,
        onToggleSelectedUs,
    } = props;

    /* ---------------------------------------------------------------------- *
     * Phase 1 — mode switch. `hasSwimlane` reproduces the difference between the
     * two Jade blocks: it gates `data-swimlane`, the `kanban-moved` card class,
     * and the move-to-top wiring. `null` and `undefined` both mean no-swimlane.
     * ---------------------------------------------------------------------- */
    const hasSwimlane = swimlaneId !== undefined && swimlaneId !== null;

    /* ---------------------------------------------------------------------- *
     * Phase 5 (computed once) — the `readonly` parity class. The legacy template
     * carried `tg-class-permission="{'readonly': '!modify_task'}"`; a user who
     * cannot `modify_task` on the project sees the column/cards in the read-only
     * visual state. Reproduced verbatim via the shared `can` gate.
     * ---------------------------------------------------------------------- */
    // F-REG-03: task editing is a mutation, so an archived project forces
    // read-only even when the user holds `modify_task`.
    const readonly = !canMutate(project, 'modify_task');

    /* ---------------------------------------------------------------------- *
     * Phase 5 (computed once) — where, if anywhere, the WIP-limit marker sits.
     * `computeWipLimit` returns `null` for archived columns and columns without a
     * positive `wip_limit`; otherwise `{ className, afterIndex }`. The marker is
     * rendered immediately AFTER the card whose index === `afterIndex`.
     * ---------------------------------------------------------------------- */
    const wip = computeWipLimit(status, cardIds.length);

    /* ---------------------------------------------------------------------- *
     * Phase 2 — root class + data attributes.
     *
     * NOTE (Phase 7 — sticky counter): the legacy `tgKanbanTaskboardColumn`
     * directive made `.kanban-task-counter` visually "sticky" by imperatively
     * setting a `translateY` transform on the table body's scroll event. Under the
     * presentational constraint (no direct DOM access here) that imperative offset
     * is intentionally NOT reimplemented in this component: it changes no served
     * DOM structure or class and is a pure visual polish, so the existing
     * `.kanban-task-counter` CSS (the class is retained verbatim) governs its
     * appearance. This is an accepted, documented minor deviation with no effect on
     * behaviour semantics.
     *
     * `tg-kanban-taskboard-column` / `tg-kanban-wip-limit` / `tg-loaded` /
     * `tg-repeat` were AngularJS directives, not DOM: their behaviour is reproduced
     * in React (WIP via `computeWipLimit`, rendering natively), so they are NOT
     * ported as attributes.
     * ---------------------------------------------------------------------- */
    const rootClass =
        'kanban-uses-box taskboard-column' +
        (folded ? ' vfold' : '') +
        (unfolded ? ' vunfold' : '') +
        (readonly ? ' readonly' : '');

    // `data-swimlane` is spread ONLY in swimlane mode (difference #1); it is
    // absent entirely in no-swimlane mode. Emitted as a string per the DnD
    // cross-folder contract.
    const swimlaneAttr = hasSwimlane ? { 'data-swimlane': String(swimlaneId) } : {};

    // F-CQ-01: the column body is a @dnd-kit DROPPABLE (id === its columnKey), so
    // a card can be dropped onto it — including onto an EMPTY column. `setNodeRef`
    // attaches the droppable to the real `.kanban-uses-box` node the DnD layer
    // reads card order from (`readOrderedCardIds`), and `isTarget` reproduces the
    // legacy over/out highlight (`sortable.coffee:65-73`): the `target-drop` class
    // appears ONLY on a container different from the drag source. On a read-only /
    // archived board the wrapper is disabled by the internal context, so this adds
    // no drag affordance there (F-REG-03 parity is preserved by `isBoardDraggable`).
    return (
        <DroppableColumn statusId={status.id} swimlaneId={swimlaneId ?? null}>
            {({ setNodeRef, isTarget }): JSX.Element => (
        <div
            ref={setNodeRef}
            className={rootClass + (isTarget ? ' target-drop' : '')}
            id={`column-${status.id}`}
            data-status={String(status.id)}
            {...swimlaneAttr}
        >
            {/* Phase 3 — counter (not folded) XOR collapsed placeholder (folded).
                The two are mutually exclusive by `folded`, exactly as the legacy
                `ng-if='!folds[s.id]'` / `ng-if='folds[s.id]'` pair. */}
            {!folded && (
                <div
                    className="kanban-task-counter"
                    title={translate('KANBAN.NUMBER_US', undefined, 'Number of US')}
                >
                    {/* Reproduces the `tgAnimatedCounter` template
                        (`animated-counter.directive.coffee`). The original rendered
                        three `.result` rows (previous/current/next) purely to drive a
                        CSS slide animation; the count animation is cosmetic and out of
                        scope for the migration, so only the single visible `.result`
                        is rendered here. `wip-amount` / `limit-over` reproduce the
                        directive's `ng-class` (a positive `wip_limit` shows the limit;
                        exceeding it flags `limit-over`). */}
                    <div
                        className={
                            'animated-counter-inner' +
                            (status.wip_limit ? ' wip-amount' : '') +
                            (status.wip_limit && cardIds.length > status.wip_limit
                                ? ' limit-over'
                                : '')
                        }
                    >
                        <div className="counter-translator">
                            <div className="result">
                                <span className="current">{cardIds.length}</span>
                                {status.wip_limit ? <span> / {status.wip_limit}</span> : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {folded && <SquishColumnPlaceholder status={status} count={cardIds.length} />}

            {/* Phase 4 — empty-board / not-found skeleton. Reproduces
                `kanban-placeholder.jade`; the two `ng-container` branches emit no
                wrapper element, so React Fragments are used. Rendered BEFORE the card
                list, matching template order (the placeholder only appears in the
                first column of the first swimlane when the board is empty). */}
            {showPlaceholder && (
                <div className={`card-placeholder${notFoundUserstories ? ' not-found' : ''}`}>
                    {!notFoundUserstories ? (
                        <>
                            <div className="placeholder-board-card">
                                <div className="placeholder-board-row">
                                    <div className="placeholder-board-text small" />
                                    <div className="placeholder-board-text big" />
                                </div>
                                <div className="placeholder-board-row">
                                    <div className="placeholder-board-text" />
                                </div>
                                <div className="placeholder-board-row avatar">
                                    <div className="placeholder-board-avatar" />
                                    <div className="placeholder-board-user" />
                                </div>
                            </div>
                            <div className="placeholder-titles">
                                <div className="text-small" />
                                <div className="text-large" />
                            </div>
                            <div className="placeholder-avatar">
                                <div className="image" />
                                <div className="text" />
                            </div>
                            <p className="title">
                                {translate(
                                    'KANBAN.PLACEHOLDER_CARD_TITLE',
                                    undefined,
                                    'This could be a user story',
                                )}
                            </p>
                            <p>
                                {translate(
                                    'KANBAN.PLACEHOLDER_CARD_TEXT',
                                    undefined,
                                    'Create user stories here and change their status to track their progress.',
                                )}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="title">
                                {translate(
                                    'KANBAN.US_NOT_FOUND_TITLE',
                                    undefined,
                                    'No matching results found',
                                )}
                            </p>
                            <p>
                                {translate(
                                    'KANBAN.US_NOT_FOUND_TEXT_P1',
                                    undefined,
                                    'Try again using more general search terms or disabled some filters.',
                                )}
                            </p>
                            {/* F-UI-06: `KANBAN.US_NOT_FOUND_TEXT_P2` ships with a
                                `<strong>` in its value; the legacy `translate="…"`
                                attribute directive rendered it as HTML. The value comes
                                from the trusted, developer-controlled locale bundle (no
                                user input flows in), so reproducing that behaviour via
                                `dangerouslySetInnerHTML` is safe and faithful. */}
                            <p
                                dangerouslySetInnerHTML={{
                                    __html: translate(
                                        'KANBAN.US_NOT_FOUND_TEXT_P2',
                                        undefined,
                                        '<strong>Archived stories</strong> are not loaded by default. Unfold the archived statuses to expand your search.',
                                    ),
                                }}
                            />
                        </>
                    )}
                </div>
            )}

            {/* Phase 5 — the ordered card list with the single WIP-limit marker
                interleaved immediately after the card at `wip.afterIndex`. Cards
                whose `usMap` entry is momentarily missing (e.g. mid WebSocket
                update) are skipped to avoid a render crash. */}
            {cardIds.map((usId, i) => {
                const item = usMap[usId];

                // Guard against incremental WebSocket updates that reference an id
                // whose card has not yet landed in `usMap`.
                if (!item) {
                    return null;
                }

                return (
                    <Fragment key={usId}>
                        {/* F-CQ-01: every card is a @dnd-kit DRAGGABLE (and card-level
                            droppable, for precise neighbour/index detection). The render
                            prop hands the drag `ref` (`setNodeRef`), the pointer/keyboard
                            `listeners` and the ARIA `attributes` straight onto the
                            @dnd-kit-free `Card` via its `forwardRef` + `...rest` contract,
                            so a drag can START (pointer/keyboard) and the board can
                            resolve which card the pointer is over. `data-id` is preserved
                            because the DnD layer reads DOM card order from it. On a
                            read-only/archived board the wrapper is disabled (internal
                            context), so no listeners are attached — parity with the old
                            `modify_us`/`archived_code` gate. */}
                        <DraggableCard
                            id={usId}
                            statusId={status.id}
                            swimlaneId={swimlaneId ?? null}
                        >
                            {({ setNodeRef, listeners, attributes }): JSX.Element => (
                                <Card
                                    ref={setNodeRef}
                                    {...attributes}
                                    {...(listeners ?? {})}
                                    data-id={String(usId)}
                                    item={item}
                                    project={project}
                                    zoom={zoom}
                                    zoomLevel={zoomLevel}
                                    type="us"
                                    archived={isUsArchivedHidden(usId)}
                                    inViewPort={inViewPort[usId] ?? false}
                                    isFirst={i === 0}
                                    selected={!!selectedUss[usId]}
                                    // Difference #3: `kanban-moved` only in swimlane mode.
                                    moved={hasSwimlane ? movedUs.indexOf(usId) !== -1 : false}
                                    onToggleFold={onToggleFold}
                                    onClickEdit={onClickEdit}
                                    onClickDelete={onClickDelete}
                                    onClickAssignedTo={onClickAssignedTo}
                                    // Difference #3: move-to-top wired only in swimlane mode.
                                    onClickMoveToTop={hasSwimlane ? onClickMoveToTop : undefined}
                                    onToggleSelected={onToggleSelectedUs}
                                />
                            )}
                        </DraggableCard>
                        {wip && wip.afterIndex === i ? <WipLimit className={wip.className} /> : null}
                    </Fragment>
                );
            })}

            {/* Phase 6 — archived-column intro spacer, rendered as the LAST child of
                an archived column (legacy `div.kanban-column-intro(ng-if="s.is_archived")`). */}
            {status.is_archived && <ArchivedStatusIntro status={status} />}
        </div>
            )}
        </DroppableColumn>
    );
}
