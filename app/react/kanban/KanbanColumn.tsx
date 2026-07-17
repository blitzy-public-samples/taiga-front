/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement, Fragment, useCallback, useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "./Card";
import { Icon } from "../shared/ui/Icon";
import { t } from "../shared/i18n/translate";
import type {
    BaseUser,
    KanbanProject,
    Status,
    UsView,
} from "./useKanbanState";
import { UNCLASSIFIED_SWIMLANE_ID } from "./useKanbanState";

// ---------------------------------------------------------------------------
// Labels — routed through the shared runtime translator [M-06] so the React
// board uses the SAME angular-translate catalog (and the SAME ~30 locales) as
// the surrounding AngularJS shell. Each key is the authoritative catalog key
// from the legacy Jade markup (app/partials/includes/modules/kanban-table.jade)
// and its English fallback is the exact catalog value from
// app/locales/taiga/locale-en.json, so the English locale and jsdom render the
// verbatim legacy copy. The translator is invoked at RENDER time (inline in the
// components below, never memoized at module load) because the React bundle is
// evaluated by `loadJS(react-app.js)` BEFORE `angular.bootstrap`, so the live
// `$translate` service only becomes reachable once a component actually renders
// inside the mounted custom element. `KANBAN.WIP_LIMIT` had NO catalog key in
// the legacy directive (kanban/main.coffee L839 emits a hardcoded
// `<span>WIP Limit</span>`), so it resolves to the fallback — preserving the
// exact legacy literal while still routing through the translator per M-06.
// ---------------------------------------------------------------------------

const NUMBER_US_KEY = "KANBAN.NUMBER_US";
const NUMBER_US_FALLBACK = "Number of US";
const ARCHIVED_KEY = "KANBAN.ARCHIVED";
const ARCHIVED_FALLBACK = "(Archived)";
const ADD_US_KEY = "KANBAN.TITLE_ACTION_ADD_US";
const ADD_US_FALLBACK = "Add new user story";
const ADD_BULK_KEY = "KANBAN.TITLE_ACTION_ADD_BULK";
const ADD_BULK_FALLBACK = "Add new bulk";
const FOLD_KEY = "KANBAN.TITLE_ACTION_FOLD";
const FOLD_FALLBACK = "Fold column";
const UNFOLD_KEY = "KANBAN.TITLE_ACTION_UNFOLD";
const UNFOLD_FALLBACK = "Unfold column";
const WIP_LIMIT_KEY = "KANBAN.WIP_LIMIT";
const WIP_LIMIT_FALLBACK = "WIP Limit";

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
                        title={t(ADD_US_KEY, ADD_US_FALLBACK)}
                        aria-label={t(ADD_US_KEY, ADD_US_FALLBACK)}
                        onClick={() => onAddUs?.("standard", status.id)}
                    >
                        <Icon name="icon-add" wrapperClass="add-action" />
                    </button>
                ) : null}

                {canAddUs && !status.is_archived ? (
                    <button
                        type="button"
                        className="btn-board option"
                        title={t(ADD_BULK_KEY, ADD_BULK_FALLBACK)}
                        aria-label={t(ADD_BULK_KEY, ADD_BULK_FALLBACK)}
                        onClick={() => onAddUs?.("bulk", status.id)}
                    >
                        <Icon name="icon-bulk" wrapperClass="bulk-action" />
                    </button>
                ) : null}

                <button
                    type="button"
                    className={"btn-board option" + (folded ? " hidden" : "")}
                    title={t(FOLD_KEY, FOLD_FALLBACK)}
                    aria-label={t(FOLD_KEY, FOLD_FALLBACK)}
                    onClick={() => onFoldStatus?.(status)}
                >
                    <Icon name="icon-fold-column" />
                </button>

                <button
                    type="button"
                    className={"btn-board option hunfold" + (!folded ? " hidden" : "")}
                    title={t(UNFOLD_KEY, UNFOLD_FALLBACK)}
                    aria-label={t(UNFOLD_KEY, UNFOLD_FALLBACK)}
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
    /** [M-13] Move a card to the top of its column (drilled through to Card). */
    onClickMoveToTop?: (id: number) => void;
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
        onClickMoveToTop,
        onToggleSelect,
        resolveAvatar,
    } = props;

    const containerKey = buildContainerKey(status.id, swimlaneId);
    // C-06: a column DOM id must be unique across the whole board. In swimlane
    // mode the SAME status is rendered once per swimlane, so `column-${status.id}`
    // alone (as the legacy Jade emitted, `id="column-{{s.id}}"`) collides once
    // per swimlane — invalid HTML and ambiguous for `getElementById`/selectors.
    // Compose the id from status AND swimlane identity, using the stable
    // `UNCLASSIFIED_SWIMLANE_ID` (-1) sentinel for the no-swimlane / unclassified
    // board so the id is deterministic even when `swimlaneId` is null.
    const swimlaneSentinel =
        swimlaneId === null ? UNCLASSIFIED_SWIMLANE_ID : swimlaneId;
    const columnDomId = `column-${status.id}-${swimlaneSentinel}`;
    const { setNodeRef } = useDroppable({
        id: containerKey,
        data: {
            statusId: status.id,
            swimlaneId: swimlaneSentinel,
        },
    });

    // [M-14] Behavior 4 — sticky task-counter translation.
    // Port of `KanbanTaskboardColumnDirective` (kanban/main.coffee L1197-1204).
    // The column body scrolls its cards vertically (SCSS `.taskboard-column`
    // `overflow-y: auto`); the absolutely-positioned `.kanban-task-counter`
    // (top-right) is translated DOWN by the column's `scrollTop` so it stays
    // pinned to the visible top edge while the cards scroll beneath it. The
    // counter is absent while the column is folded, so the handler no-ops then.
    // We compose dnd-kit's droppable `setNodeRef` with a local ref so the same
    // node backs both the drop target and this scroll listener.
    const columnRef = useRef<HTMLDivElement | null>(null);
    const setRefs = useCallback(
        (node: HTMLDivElement | null) => {
            setNodeRef(node);
            columnRef.current = node;
        },
        [setNodeRef],
    );
    useEffect(() => {
        const el = columnRef.current;
        if (!el) {
            return undefined;
        }
        const onScroll = (): void => {
            const counter = el.querySelector<HTMLElement>(".kanban-task-counter");
            if (counter) {
                counter.style.transform = `translateY(${el.scrollTop}px)`;
            }
        };
        el.addEventListener("scroll", onScroll);
        return () => el.removeEventListener("scroll", onScroll);
    }, []);

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
            ref={setRefs}
            id={columnDomId}
            className={className}
            data-status={status.id}
            data-swimlane={swimlaneId === null ? undefined : swimlaneId}
        >
            {!folded ? (
                <div className="kanban-task-counter" title={t(NUMBER_US_KEY, NUMBER_US_FALLBACK)}>
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
                                <div className="archived">{t(ARCHIVED_KEY, ARCHIVED_FALLBACK)}</div>
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
                                onClickMoveToTop={onClickMoveToTop}
                                isFirst={index === 0}
                                onToggleSelect={onToggleSelect}
                                resolveAvatar={resolveAvatar}
                            />
                            {renderWip ? (
                                <div className={"kanban-wip-limit " + wip.className}>
                                    <span>{t(WIP_LIMIT_KEY, WIP_LIMIT_FALLBACK)}</span>
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
