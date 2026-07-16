/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement, Fragment } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "./Card";
import { Icon } from "../shared/ui/Icon";
import type {
    BaseUser,
    KanbanProject,
    Status,
    UsView,
} from "./useKanbanState";
import { UNCLASSIFIED_SWIMLANE_ID } from "./useKanbanState";

// ---------------------------------------------------------------------------
// Labels (i18n keys in the AngularJS source; reproduced as plain text here
// since no shared i18n adapter is in scope for the React screens).
// ---------------------------------------------------------------------------

const NUMBER_US_LABEL = "Number of user stories";
const ARCHIVED_LABEL = "Archived";
const ADD_US_TITLE = "Add user story";
const ADD_BULK_TITLE = "Add user stories in bulk";
const FOLD_TITLE = "Fold";
const UNFOLD_TITLE = "Unfold";
const WIP_LIMIT_LABEL = "WIP Limit";

/**
 * Build the drag-and-drop container key for a (status, swimlane) cell.
 *
 * The key is `${statusId}::${swimlaneId}` with the swimlane id kept RAW: -1
 * denotes the unclassified swimlane AND the no-swimlane board (both map to a
 * null `swimlane_id` at the REST boundary via `mapSwimlaneForApi`).
 */
export function buildContainerKey(
    statusId: number,
    swimlaneId: number | null,
): string {
    const swimlane = swimlaneId === null ? UNCLASSIFIED_SWIMLANE_ID : swimlaneId;
    return `${statusId}::${swimlane}`;
}

// ---------------------------------------------------------------------------
// WIP-limit computation — ported verbatim from KanbanWipLimitDirective
// (main.coffee L853). The marker is inserted AFTER the boundary card.
// ---------------------------------------------------------------------------

export interface WipLimitMarker {
    className: string;
    /** Index of the card AFTER which the marker is rendered. */
    afterIndex: number;
}

export function computeWipLimit(
    cardCount: number,
    wipLimit: number | null | undefined,
): WipLimitMarker | null {
    if (wipLimit == null) {
        return null;
    }
    if (cardCount + 1 === wipLimit) {
        return { className: "one-left", afterIndex: cardCount - 1 };
    }
    if (cardCount === wipLimit) {
        return { className: "reached", afterIndex: cardCount - 1 };
    }
    if (cardCount > wipLimit) {
        return { className: "exceeded", afterIndex: wipLimit - 1 };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Animated counter — faithful static port of the `tgAnimatedCounter` directive
// (animated-counter.directive.coffee). It renders the same DOM the Jade emits
// (`tg-animated-counter > .animated-counter-inner > .counter-translator >
// .result > .current`) so the existing SCSS themes it unchanged, INCLUDING the
// WIP feedback: `.wip-amount .current{green}` and `.limit-over .current{red}`.
//
// Two behaviours are reproduced:
//   1. WIP denominator (QA-VIS-06): when `wip` is set, the visible frame shows
//      `count / wip` (matching the directive's `<span ng-if="…wip"> / {{…}}</span>`).
//   2. Three stacked `.result` frames (nextUp / renderCount / nextDown): the
//      SCSS `.counter-translator` is offset `translateY(-14px)` over a 14px-tall
//      `overflow:hidden` inner, so the MIDDLE frame is the visible one. On a
//      static (non-animating) render only the middle frame carries the count —
//      exactly as the directive renders when `nextUp`/`nextDown` are undefined.
// ---------------------------------------------------------------------------

export interface AnimatedCounterProps {
    count: number;
    wip: number | null | undefined;
    /** `vertical` variant used inside the folded `.ammount` cell. */
    vertical?: boolean;
}

export function AnimatedCounter(props: AnimatedCounterProps): JSX.Element {
    const { count, wip, vertical } = props;
    const hasWip = wip != null;
    // Mirrors the directive's `ng-class`: wip-amount when a limit exists,
    // limit-over when the count exceeds it.
    const innerClass =
        "animated-counter-inner" +
        (hasWip ? " wip-amount" : "") +
        (hasWip && count > (wip as number) ? " limit-over" : "");

    const result = (current: number, withWip: boolean): JSX.Element => (
        <div className="result">
            <span className="current">{current || 0}</span>
            {withWip ? <span> / {wip}</span> : null}
        </div>
    );

    // `<tg-animated-counter>` is a custom element and the `vertical` variant is a
    // class ON the host (SCSS `tg-animated-counter.vertical`). React 18 does NOT
    // map className -> class on custom elements, so pass `class` explicitly.
    return createElement(
        "tg-animated-counter",
        vertical ? { class: "vertical" } : null,
        <div className={innerClass}>
            <div className="counter-translator">
                {/* nextUp frame — empty on a static render (no wip denominator) */}
                {result(0, false)}
                {/* renderCount frame — the visible one; carries count (+ wip) */}
                {result(count, hasWip)}
                {/* nextDown frame — empty on a static render */}
                {result(0, false)}
            </div>
        </div>,
    );
}

// ---------------------------------------------------------------------------
// Column header cell — the `h2.task-colum-name` rendered in the sticky
// `.kanban-table-header` row (kanban-table.jade L18-72). Kept in this file
// because it owns the fold/squish (`button.btn-board.option.hunfold`) affordance.
// ---------------------------------------------------------------------------

export interface ColumnHeaderProps {
    status: Status;
    folded: boolean;
    canAddUs: boolean;
    onAddUs?: (type: "standard" | "bulk", statusId: number) => void;
    onFoldStatus?: (status: Status) => void;
}

export function ColumnHeader(props: ColumnHeaderProps): JSX.Element {
    const { status, folded, canAddUs, onAddUs, onFoldStatus } = props;

    return (
        <h2
            className={"task-colum-name" + (folded ? " vfold" : "")}
            title={status.name}
        >
            <div
                className={"deco-square" + (folded ? " hidden" : "")}
                style={{ backgroundColor: status.color }}
            />
            <div className="title">
                <div className="name">{status.name}</div>
            </div>
            <div className="options">
                {canAddUs && !status.is_archived ? (
                    <button
                        type="button"
                        className="btn-board option"
                        title={ADD_US_TITLE}
                        aria-label={ADD_US_TITLE}
                        onClick={() => onAddUs?.("standard", status.id)}
                    >
                        <Icon name="icon-add" wrapperClass="add-action" />
                    </button>
                ) : null}

                {canAddUs && !status.is_archived ? (
                    <button
                        type="button"
                        className="btn-board option"
                        title={ADD_BULK_TITLE}
                        aria-label={ADD_BULK_TITLE}
                        onClick={() => onAddUs?.("bulk", status.id)}
                    >
                        <Icon name="icon-bulk" wrapperClass="bulk-action" />
                    </button>
                ) : null}

                <button
                    type="button"
                    className={"btn-board option" + (folded ? " hidden" : "")}
                    title={FOLD_TITLE}
                    aria-label={FOLD_TITLE}
                    onClick={() => onFoldStatus?.(status)}
                >
                    <Icon name="icon-fold-column" />
                </button>

                <button
                    type="button"
                    className={"btn-board option hunfold" + (!folded ? " hidden" : "")}
                    title={UNFOLD_TITLE}
                    aria-label={UNFOLD_TITLE}
                    onClick={() => onFoldStatus?.(status)}
                >
                    <Icon name="icon-unfold-column" />
                </button>
            </div>
        </h2>
    );
}

// ---------------------------------------------------------------------------
// Column body cell — the droppable `.kanban-uses-box.taskboard-column`
// (kanban-table.jade L112-175 swimlane mode / L189-250 no-swimlane mode).
// ---------------------------------------------------------------------------

export interface KanbanColumnProps {
    status: Status;
    /**
     * Raw swimlane id; -1 = unclassified swimlane. `null` means the board has
     * no swimlanes at all (the `data-swimlane` attribute is then omitted, as in
     * the no-swimlane Jade branch).
     */
    swimlaneId: number | null;
    project: KanbanProject;
    zoom: string[];
    zoomLevel: number;
    cardIds: number[];
    usMap: Record<number, UsView>;
    folded: boolean;
    unfolded?: boolean;
    selectedUss?: Record<number, boolean>;
    movedUs?: number[];
    showPlaceholder?: boolean;
    notFound?: boolean;
    isArchivedHidden?: (usId: number) => boolean;
    onToggleFold?: (id: number) => void;
    onClickEdit?: (id: number) => void;
    onClickDelete?: (id: number) => void;
    onClickAssignedTo?: (id: number) => void;
    /** ctrl/meta-click multi-select toggle (QA-FUNC-01). */
    onToggleSelect?: (id: number) => void;
    resolveAvatar?: (user: BaseUser) => string;
}

export function KanbanColumn(props: KanbanColumnProps): JSX.Element {
    const {
        status,
        swimlaneId,
        project,
        zoom,
        zoomLevel,
        cardIds,
        usMap,
        folded,
        unfolded,
        selectedUss,
        movedUs,
        showPlaceholder,
        notFound,
        isArchivedHidden,
        onToggleFold,
        onClickEdit,
        onClickDelete,
        onClickAssignedTo,
        onToggleSelect,
        resolveAvatar,
    } = props;

    const containerKey = buildContainerKey(status.id, swimlaneId);
    const { setNodeRef } = useDroppable({
        id: containerKey,
        data: {
            statusId: status.id,
            swimlaneId: swimlaneId === null ? UNCLASSIFIED_SWIMLANE_ID : swimlaneId,
        },
    });

    // WIP-limit markers are never drawn for archived statuses (source gate:
    // `if status and not status.is_archived`).
    const wip = status.is_archived
        ? null
        : computeWipLimit(cardIds.length, status.wip_limit);

    let className = "kanban-uses-box taskboard-column";
    if (folded) {
        className += " vfold";
    }
    if (unfolded) {
        className += " vunfold";
    }

    return (
        <div
            ref={setNodeRef}
            id={`column-${status.id}`}
            className={className}
            data-status={status.id}
            data-swimlane={swimlaneId === null ? undefined : swimlaneId}
        >
            {!folded ? (
                <div className="kanban-task-counter" title={NUMBER_US_LABEL}>
                    <AnimatedCounter
                        count={cardIds.length}
                        wip={status.wip_limit}
                    />
                </div>
            ) : null}

            {folded ? (
                <div className="placeholder-collapsed">
                    <div className="placeholder-collapsed-wrapper">
                        {!status.is_archived ? (
                            <div className="ammount">
                                <AnimatedCounter
                                    count={cardIds.length}
                                    wip={status.wip_limit}
                                    vertical
                                />
                            </div>
                        ) : null}
                        <div className="text-holder">
                            {status.is_archived ? (
                                <div className="archived">{ARCHIVED_LABEL}</div>
                            ) : null}
                            <div className="name">{status.name}</div>
                        </div>
                        <div
                            className="square-color"
                            style={{ backgroundColor: status.color }}
                        />
                    </div>
                </div>
            ) : null}

            {showPlaceholder ? (
                <div
                    className={"card-placeholder" + (notFound ? " not-found" : "")}
                />
            ) : null}

            <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
                {cardIds.map((usId, index) => {
                    const item = usMap[usId];
                    if (!item) {
                        return null;
                    }
                    const renderWip =
                        wip !== null &&
                        wip.afterIndex === index &&
                        wip.afterIndex >= 0 &&
                        wip.afterIndex < cardIds.length;
                    return (
                        <Fragment key={usId}>
                            <Card
                                item={item}
                                project={project}
                                zoom={zoom}
                                zoomLevel={zoomLevel}
                                archived={
                                    isArchivedHidden ? isArchivedHidden(usId) : false
                                }
                                selected={selectedUss ? !!selectedUss[usId] : false}
                                moved={movedUs ? movedUs.indexOf(usId) !== -1 : false}
                                onToggleFold={onToggleFold}
                                onClickEdit={onClickEdit}
                                onClickDelete={onClickDelete}
                                onClickAssignedTo={onClickAssignedTo}
                                onToggleSelect={onToggleSelect}
                                resolveAvatar={resolveAvatar}
                            />
                            {renderWip ? (
                                <div className={"kanban-wip-limit " + wip.className}>
                                    <span>{WIP_LIMIT_LABEL}</span>
                                </div>
                            ) : null}
                        </Fragment>
                    );
                })}
            </SortableContext>

            {status.is_archived ? <div className="kanban-column-intro" /> : null}
        </div>
    );
}
