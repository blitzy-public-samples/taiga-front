/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Swimlane — one Kanban swimlane row (render-only).
 *
 * React 18 + TypeScript port of the `div.kanban-swimlane` repeat block of the
 * AngularJS partial `app/partials/includes/modules/kanban-table.jade`
 * (lines ~73-182) together with the swimlane-level behaviour of the legacy
 * CoffeeScript Kanban module `app/coffee/modules/kanban/main.coffee`
 * (`KanbanSwimlaneDirective` / `tgKanbanSwimlane` and
 * `KanbanController.toggleSwimlane`). This is the in-place AngularJS 1.5.10 ->
 * React 18 migration of the Kanban board, executed under a strict Minimal Change
 * Clause: the DOM structure, class names, data attributes, icon ids and every
 * conditional guard reproduce the original Jade EXACTLY, so the unchanged SCSS
 * (`app/styles/modules/kanban/kanban-table.scss`, `app/styles/layout/kanban.scss`)
 * keeps matching for pixel fidelity. Zero feature change.
 *
 * WHAT THIS COMPONENT RENDERS (mirrors the Jade child order EXACTLY)
 *   1. `button.kanban-swimlane-title` — the swimlane header bar. It carries the
 *      `unclassified-swimlane` modifier for the synthetic "unclassified" row
 *      (`swimlane.id === -1`) and the `folded` modifier while the row is folded.
 *      Inside it:
 *        - the fold/unfold sprite icon (`icon-unfolded-swimlane` when open,
 *          `icon-folded-swimlane` when folded — the two are mutually exclusive by
 *          `folded`, exactly as the legacy `ng-if`/`ng-if` pair);
 *        - `h2.title-name` with the swimlane name (plus `unclassified-us-title`
 *          for the unclassified row);
 *        - `.unclassified-us-info` help tooltip, shown ONLY for the unclassified
 *          row (`swimlane.id === -1`);
 *        - `.default-swimlane` star badge, shown ONLY when this swimlane is the
 *          project's default AND the project has more than one swimlane.
 *   2. `div.kanban-table-body > div.kanban-table-inner` — the row of status
 *      columns, rendered ONLY while the swimlane is NOT folded (the legacy
 *      `ng-if="!ctrl.foldedSwimlane.get(...)"`). Each column is delegated to
 *      `<TaskboardColumn>` in SWIMLANE MODE (`swimlaneId={swimlane.id}` supplied),
 *      which makes the column emit `data-swimlane` and wire the `kanban-moved`
 *      class + move-to-top action — the drag-and-drop contract read by
 *      `../dnd/KanbanDndContext.tsx`.
 *
 * `SwimlaneAddLink` (exported separately below) reproduces the SIBLING
 * `a.kanban-swimlane-add` anchor. In the source Jade that anchor is a single
 * sibling of the swimlane repeat (rendered ONCE, not per swimlane), so it is a
 * separate component that `../KanbanApp.tsx` renders once after mapping
 * `swimlanesList` to `<Swimlane>`.
 *
 * STATE / SIDE-EFFECT SPLIT (HARD presentational constraint)
 *   The `foldedSwimlane` state, its persistence (`storeSwimlanesModes`) and the
 *   `redraw:wip` broadcast that `KanbanController.toggleSwimlane` performed are
 *   CONTAINER concerns (`../KanbanApp.tsx` / `../state/useKanbanBoard.ts`); WIP
 *   recomputes automatically on re-render in React, so `redraw:wip` is NOT ported.
 *   The drag-hover "auto-unfold a folded swimlane after ~1s of hovering while
 *   dragging" (`KanbanSwimlaneDirective`'s `mouseoverSwimlane`/`mouseleaveSwimlane`)
 *   is a DRAG-AND-DROP concern owned by `../dnd/KanbanDndContext.tsx`. F-CQ-07: it
 *   is now INTEGRATED here by consuming the DnD-layer `useSwimlaneAutoUnfold` hook
 *   (exactly as `TaskboardColumn` consumes `DraggableCard`/`DroppableColumn`): the
 *   timer, the `pending-to-open` class toggle, the `isDragging` gate and the
 *   `onRequestUnfoldSwimlane` dispatch all live INSIDE that hook, so this component
 *   holds no timer/state of its own — it only forwards the title-bar element to the
 *   hook on hover. The `foldedSwimlane` STATE, its persistence and the actual
 *   unfold on request stay CONTAINER concerns (`../KanbanApp.tsx`), which wires the
 *   hook end-to-end via the provider's `onRequestUnfoldSwimlane` prop. The
 *   sticky-title-on-scroll behaviour is handled natively by the unchanged SCSS
 *   (`.kanban-swimlane-title { position: sticky; top: 36px }`), so no imperative
 *   scroll transform is reintroduced. The optional `onMouseOverSwimlane` /
 *   `onMouseLeaveSwimlane` prop callbacks (id-based) are still emitted for any
 *   external listener, unchanged.
 *
 * PRESENTATIONAL ONLY ("props down, events up")
 *   No data fetching, no API/WebSocket access, no immer/reducer work, no direct
 *   jQuery/Angular DOM manipulation, and no browser-storage reads. Every value
 *   arrives through props and every user intent is emitted through an `on*`
 *   callback prop. The component holds no local state — the render is a pure
 *   function of its props, which keeps it trivially jsdom-testable.
 *
 * Compiled under `jsx: "react-jsx"` (automatic runtime), so there is deliberately
 * NO `import React`. All domain imports are type-only because the project is
 * compiled with `strict` + `isolatedModules`; the domain `Swimlane` type is
 * aliased to `SwimlaneModel` to avoid colliding with this component's name. Kept
 * Node v16.19.1 / TypeScript 5.4.5 / React 18.2.0 compatible.
 */

import type { Project, Status, Swimlane as SwimlaneModel, UsMap } from '../../shared/types';
import { TaskboardColumn } from './TaskboardColumn';
import { useSwimlaneAutoUnfold } from '../dnd/KanbanDndContext';
// F-UI-02: the ONE shared SVG-sprite primitive replaces this component's local
// `tg-svg` host + `svgIcon` helper, so every migrated screen paints icons through
// a single implementation (`<tg-svg><svg class="icon …"><use/></svg></tg-svg>`).
// F-UI-06: `translate` bridges to the AngularJS shell's angular-translate service
// so the hardcoded English literals below localise at render time.
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

/**
 * Id of the synthetic "unclassified" swimlane — the bucket that holds the user
 * stories not assigned to any real swimlane. The board reducer exports the same
 * value as `UNCLASSIFIED_SWIMLANE_ID`; it is hardcoded here (rather than imported
 * from `../state/boardReducer`) to keep this presentational leaf dependency-light,
 * exactly mirroring the legacy template's literal `swimlane.id == -1` guards.
 */
const UNCLASSIFIED_SWIMLANE_ID = -1;

/**
 * Props for {@link Swimlane}.
 *
 * The container (`../KanbanApp.tsx` via `../state/useKanbanBoard.ts`) owns the
 * board state and resolves every derived value below; this component only renders
 * one swimlane. The per-status data getters (`getColumnCardIds`,
 * `showPlaceholderFor`) and the forwarded maps/flags are passed straight through
 * to each `<TaskboardColumn>` — this component neither reads nor mutates board
 * state itself.
 */
export interface SwimlaneProps {
    /** The swimlane row this component renders (aliased from the domain `Swimlane`). */
    swimlane: SwimlaneModel;
    /** Ordered statuses for this swimlane (`swimlanesStatuses[swimlane.id]`). */
    statuses: Status[];
    /** The owning project — drives unclassified/default badges + column nav/permissions. */
    project: Project;
    /** `foldedSwimlane[swimlane.id]` — when `true` the columns row is hidden. */
    folded: boolean;
    /** Board index: user-story id -> its derived `BoardCard` (forwarded to columns). */
    usMap: UsMap;
    /** Enabled card sections (drives each card's `visible(name)` membership tests). */
    zoom: string[];
    /** Numeric board zoom level (0..3). */
    zoomLevel: number;
    /**
     * Resolve the ordered user-story ids for a status column in THIS swimlane,
     * i.e. `usByStatusSwimlanes[swimlane.id][statusId]`. Provided by the container
     * so this component never touches board state.
     */
    getColumnCardIds: (statusId: number) => number[];
    /** Per-status column fold map (`folds[statusId]`). */
    statusFolds: Record<number, boolean>;
    /** The currently single-unfolded column id (`unfold`), or `null` if none. */
    unfoldStatusId: number | null;
    /** Container's `showPlaceHolder(statusId, swimlane.id)` result, per status. */
    showPlaceholderFor: (statusId: number) => boolean;
    /** `ctrl.notFoundUserstories` -> `not-found` placeholder variant (forwarded). */
    notFoundUserstories: boolean;
    /** `ctrl.selectedUss` -> per-card selection state (forwarded). */
    selectedUss: Record<number, boolean>;
    /** `ctrl.movedUs` -> per-card `kanban-moved` flag (forwarded; swimlane mode). */
    movedUs: number[];
    /** `usCardVisibility` -> per-card viewport gate (forwarded). */
    inViewPort: Record<number, boolean>;
    /** `isUsInArchivedHiddenStatus(usId)` -> the card's `archived` flag (forwarded). */
    isUsArchivedHidden: (usId: number) => boolean;
    /** Fired with the swimlane id when the title bar is clicked (toggle fold). */
    onToggleSwimlane: (swimlaneId: number) => void;
    /**
     * Optional — fired with the swimlane id on `mouseover` of the title bar. The
     * container/DnD layer uses it to auto-unfold a folded swimlane after ~1s of
     * hovering while dragging (legacy `mouseoverSwimlane`). Optional so the
     * component renders in isolation without DnD wiring.
     */
    onMouseOverSwimlane?: (swimlaneId: number) => void;
    /** Optional — fired with the swimlane id on `mouseleave` of the title bar. */
    onMouseLeaveSwimlane?: (swimlaneId: number) => void;
    /** Fired with a user-story id when a card's fold control is toggled (forwarded). */
    onToggleFold: (id: number) => void;
    /** Fired with a user-story id when "Edit card" is chosen (forwarded). */
    onClickEdit: (id: number) => void;
    /** Fired with a user-story id when "Delete card" is chosen (forwarded). */
    onClickDelete: (id: number) => void;
    /** Fired with a user-story id when an avatar / "Assign To" is chosen (forwarded). */
    onClickAssignedTo: (id: number) => void;
    /** Fired with a user-story id when "Move to top" is chosen (forwarded; swimlane mode). */
    onClickMoveToTop: (id: number) => void;
    /** Fired with a user-story id on ctrl/meta click (board multi-select; forwarded). */
    onToggleSelectedUs: (id: number) => void;
}

/**
 * Render one Kanban swimlane: its title bar plus, when unfolded, its row of
 * status columns. A pure function of its props — see the module header for the
 * state/side-effect split that keeps this component presentational.
 */
export function Swimlane(props: SwimlaneProps): JSX.Element {
    const {
        swimlane,
        statuses,
        project,
        folded,
        usMap,
        zoom,
        zoomLevel,
        getColumnCardIds,
        statusFolds,
        unfoldStatusId,
        showPlaceholderFor,
        notFoundUserstories,
        selectedUss,
        movedUs,
        inViewPort,
        isUsArchivedHidden,
        onToggleSwimlane,
        onMouseOverSwimlane,
        onMouseLeaveSwimlane,
        onToggleFold,
        onClickEdit,
        onClickDelete,
        onClickAssignedTo,
        onClickMoveToTop,
        onToggleSelectedUs,
    } = props;

    // F-CQ-07: consume the DnD-layer auto-unfold hook. It reads `isDragging` +
    // `onRequestUnfoldSwimlane` off `KanbanDndContext`'s internal context, so it is
    // a safe NO-OP when this component is rendered without a provider (e.g. isolated
    // jsdom specs): `onMouseOverSwimlane` returns early with no timer and no class.
    // Inside the board it adds `pending-to-open` to the hovered title bar and, after
    // ~1s of hovering a FOLDED swimlane during a drag, requests the unfold.
    const autoUnfold = useSwimlaneAutoUnfold(swimlane.id, folded);

    // The synthetic "unclassified" row (id === -1) gets the `unclassified-*`
    // treatment: the `unclassified-swimlane` button modifier, the
    // `unclassified-us-title` heading modifier, and the help tooltip. Mirrors the
    // legacy `swimlane.id == -1` guards.
    const isUnclassified = swimlane.id === UNCLASSIFIED_SWIMLANE_ID;

    // `.default-swimlane` star: shown only when this row is the project default
    // AND the project has more than one swimlane (legacy
    // `ng-if="swimlane.id == project.default_swimlane && project.swimlanes.length > 1"`).
    // `swimlanes` is not a first-class field on the shared `Project` type (it
    // arrives via the `[key: string]: unknown` index signature), so it is read
    // through a cast, exactly as sibling components do (e.g. `Card.tsx`).
    const swimlaneCount = ((project as any).swimlanes?.length ?? 0) as number;
    const isDefaultSwimlane =
        swimlane.id === (project.default_swimlane ?? null) && swimlaneCount > 1;

    return (
        <div className="kanban-swimlane" data-swimlane={String(swimlane.id)}>
            <button
                type="button"
                className={
                    'kanban-swimlane-title' +
                    (isUnclassified ? ' unclassified-swimlane' : '') +
                    (folded ? ' folded' : '')
                }
                onClick={() => onToggleSwimlane(swimlane.id)}
                // F-CQ-07: drive the auto-unfold hook with the REAL title-bar element
                // (`e.currentTarget`) so `pending-to-open` lands on the exact
                // `.kanban-swimlane-title` node the SCSS targets, then still emit the
                // optional id-based prop callbacks for any external listener.
                onMouseOver={(e) => {
                    autoUnfold.onMouseOverSwimlane(e.currentTarget);
                    onMouseOverSwimlane?.(swimlane.id);
                }}
                onMouseLeave={() => {
                    autoUnfold.onMouseLeaveSwimlane();
                    onMouseLeaveSwimlane?.(swimlane.id);
                }}
            >
                {/* Fold/unfold sprite icon — mutually exclusive by `folded`, the
                    React equivalent of the legacy `ng-if="!folded"` /
                    `ng-if="folded"` pair. The modifier class rides on the
                    `<tg-svg>` host to match `tg-svg.unfold-action` /
                    `tg-svg.fold-action`. */}
                {!folded && (
                    <TgSvg icon="icon-unfolded-swimlane" className="unfold-action" />
                )}
                {folded && (
                    <TgSvg icon="icon-folded-swimlane" className="fold-action" />
                )}

                <h2
                    className={
                        'title-name' + (isUnclassified ? ' unclassified-us-title' : '')
                    }
                >
                    {swimlane.name}
                </h2>

                {/* Help tooltip, shown ONLY for the synthetic unclassified row.
                    F-UI-06: `KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP` localises
                    through the shell, falling back to the shipped English. */}
                {isUnclassified && (
                    <div className="unclassified-us-info">
                        <TgSvg icon="icon-help-circle" />
                        <div className="tooltip pop-help">
                            {translate(
                                'KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP',
                                undefined,
                                'The user stories that are not part of any swimlane are here.',
                            )}
                        </div>
                    </div>
                )}

                {/* Default-swimlane star badge. F-UI-06:
                    `ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT` localises through the
                    shell, falling back to the shipped English. */}
                {isDefaultSwimlane && (
                    <div className="default-swimlane">
                        <TgSvg icon="icon-star" className="default-swimlane-icon" />
                        <span className="default-text">
                            {translate(
                                'ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT',
                                undefined,
                                'Default',
                            )}
                        </span>
                    </div>
                )}
            </button>

            {/* Row of status columns — rendered ONLY while the swimlane is open
                (legacy `ng-if="!ctrl.foldedSwimlane.get(...)"`). Each column is a
                `<TaskboardColumn>` in SWIMLANE MODE: passing `swimlaneId` makes it
                emit `data-swimlane` and wire the `kanban-moved` class + move-to-top
                action (the DnD contract). The container resolves the ordered card
                ids per status via `getColumnCardIds`
                (i.e. `usByStatusSwimlanes[swimlane.id][status.id]`). */}
            {!folded && (
                <div className="kanban-table-body">
                    <div className="kanban-table-inner">
                        {statuses.map((status) => (
                            <TaskboardColumn
                                key={status.id}
                                status={status}
                                swimlaneId={swimlane.id}
                                cardIds={getColumnCardIds(status.id)}
                                usMap={usMap}
                                project={project}
                                zoom={zoom}
                                zoomLevel={zoomLevel}
                                folded={!!statusFolds[status.id]}
                                unfolded={unfoldStatusId === status.id}
                                showPlaceholder={showPlaceholderFor(status.id)}
                                notFoundUserstories={notFoundUserstories}
                                selectedUss={selectedUss}
                                movedUs={movedUs}
                                inViewPort={inViewPort}
                                isUsArchivedHidden={isUsArchivedHidden}
                                onToggleFold={onToggleFold}
                                onClickEdit={onClickEdit}
                                onClickDelete={onClickDelete}
                                onClickAssignedTo={onClickAssignedTo}
                                onClickMoveToTop={onClickMoveToTop}
                                onToggleSelectedUs={onToggleSelectedUs}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Props for {@link SwimlaneAddLink}.
 */
interface SwimlaneAddLinkProps {
    /** The owning project — drives the admin gate and the target slug. */
    project: Project;
    /** Number of swimlanes on the board (`swimlanesList.size` in the source). */
    swimlaneCount: number;
}

/**
 * `SwimlaneAddLink` — the "create more swimlanes" admin anchor.
 *
 * Reproduces the SIBLING `a.kanban-swimlane-add` from `kanban-table.jade`
 * (lines 176-182). In the source that anchor is a SINGLE sibling of the swimlane
 * repeat, so `KanbanApp` renders `<SwimlaneAddLink>` ONCE, after mapping
 * `swimlanesList` to `<Swimlane>`; it is intentionally NOT part of the
 * per-swimlane `<Swimlane>` component (the source `a.kanban-swimlane-add` is a
 * single sibling of the swimlane repeat).
 *
 * Visible only to project admins while the board still has at most one swimlane
 * (the legacy `ng-if="swimlanesList.size && project.i_am_admin && swimlanesList.size <= 1"`)
 * — it nudges admins to add swimlanes when none/one exist; returns `null`
 * otherwise.
 */
export function SwimlaneAddLink({
    project,
    swimlaneCount,
}: SwimlaneAddLinkProps): JSX.Element | null {
    // Gate reproduced verbatim from the source `ng-if`:
    //   swimlanesList.size && project.i_am_admin && swimlanesList.size <= 1
    // `i_am_admin` arrives via the `Project` index signature, so it is read
    // through a cast (as sibling components do).
    const iAmAdmin = Boolean((project as any).i_am_admin);
    if (!(swimlaneCount > 0 && iAmAdmin && swimlaneCount <= 1)) {
        return null;
    }

    // Href built from the `base.coffee:99` nav route
    // `project-admin-project-values-kanban-power-ups` ->
    // `/project/:project/admin/project-values/kanban-power-ups`, with `:project`
    // resolved to `project.slug` (the source used `tg-nav`).
    const href = `/project/${project.slug}/admin/project-values/kanban-power-ups`;

    return (
        <a className="kanban-swimlane-add" href={href}>
            <TgSvg icon="icon-add" className="add-action" />
            {/* F-UI-06: `KANBAN.CREATE_SWIMLANE` localises through the shell,
                falling back to the shipped English. */}
            <span>
                {translate('KANBAN.CREATE_SWIMLANE', undefined, 'Create more swimlanes')}
            </span>
        </a>
    );
}
