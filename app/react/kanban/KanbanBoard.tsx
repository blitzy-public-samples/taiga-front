/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef, useState } from "react";
import { DndProvider } from "../shared/dnd/DndProvider";
import type {
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "../shared/dnd/DndProvider";
import { ColumnHeader, KanbanColumn } from "./KanbanColumn";
import { Swimlane } from "./Swimlane";
import { Icon } from "../shared/ui/Icon";
import { t } from "../shared/i18n/translate";
import type {
    BaseUser,
    KanbanProject,
    KanbanState,
    Status,
} from "./useKanbanState";

// "Create more swimlanes" affordance label — routed through the shared runtime
// translator [M-06] at render time. Key + English fallback are the authoritative
// catalog entry (`KANBAN.CREATE_SWIMLANE`) used by the legacy kanban-table.jade.
const CREATE_SWIMLANE_KEY = "KANBAN.CREATE_SWIMLANE";
const CREATE_SWIMLANE_FALLBACK = "Create more swimlanes";

export interface KanbanBoardProps {
    state: KanbanState;
    project: KanbanProject;
    zoom: string[];
    zoomLevel: number;
    /** Folded status columns keyed by status id. */
    folds: Record<number, boolean>;
    /** The single status id currently being unfolded (source `unfold`). */
    unfold: number | null;
    /** Folded swimlanes keyed by swimlane id. */
    foldedSwimlane: Record<number, boolean>;
    selectedUss?: Record<number, boolean>;
    movedUs?: number[];
    canAddUs: boolean;
    isArchivedHidden?: (usId: number) => boolean;
    showPlaceholder?: (statusId: number, swimlaneId: number | null) => boolean;
    notFound?: boolean;
    resolveDrop: (event: NormalizedDragEnd) => ResolvedDrop | null;
    persist: (
        resolved: ResolvedDrop,
        neighbors: DropNeighbors,
    ) => void | Promise<void>;
    onAddUs?: (type: "standard" | "bulk", statusId: number) => void;
    onFoldStatus?: (status: Status) => void;
    onToggleSwimlane?: (swimlaneId: number) => void;
    onRequestOpenSwimlane?: (swimlaneId: number) => void;
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

export function KanbanBoard(props: KanbanBoardProps): JSX.Element {
    const {
        state,
        project,
        zoom,
        zoomLevel,
        folds,
        unfold,
        foldedSwimlane,
        selectedUss,
        movedUs,
        canAddUs,
        isArchivedHidden,
        showPlaceholder,
        notFound,
        resolveDrop,
        persist,
        onAddUs,
        onFoldStatus,
        onToggleSwimlane,
        onRequestOpenSwimlane,
        onToggleFold,
        onClickEdit,
        onClickDelete,
        onClickAssignedTo,
        onClickMoveToTop,
        onToggleSelect,
        resolveAvatar,
    } = props;

    // [M-12] Active-drag flag driven by the DndProvider (below). The legacy
    // `mouseoverSwimlane` gated the folded-swimlane hover-open on "a card is
    // being dragged" by probing for dragula's `tg-card.gu-mirror` element
    // (kanban/main.coffee L1172). `@dnd-kit` has no such DOM mirror, so the
    // board owns this boolean and updates it from `onDragActiveChange`; it is
    // then forwarded to every `Swimlane` so hover-open fires ONLY during a drag.
    const [dragging, setDragging] = useState(false);

    // [M-14] Ref to the root `.kanban-table` element. The legacy board attached
    // three imperative DOM behaviors to this element (via the `tgKanban` and
    // `tgKanbanSwimlane` directives, both linked on the SAME root node): the
    // `--kanban-width` ResizeObserver, the no-swimlane header/body horizontal
    // scroll synchronization, and the swimlane-title/add sticky translation.
    // React owns them here through effects with explicit listener cleanup.
    const rootRef = useRef<HTMLDivElement | null>(null);

    const usStatusList: Status[] =
        (project.us_statuses as Status[] | undefined) ?? [];
    const swimlanesList = state.swimlanesList;
    const swimlaneMode = swimlanesList.length > 0;

    // [M-14] Stable dependency for the board-width observer: re-observe only
    // when the header column SET actually changes (add/remove/replace/reorder),
    // never on unrelated re-renders. Deriving a primitive key avoids the churn
    // that would occur if we depended on the `?? []` array identity (a fresh
    // array is produced every render when `us_statuses` is undefined).
    const columnIdsKey = usStatusList.map((s) => s.id).join(",");

    // [M-14] Behavior 1 — board width variable.
    // Port of `KanbanDirective.watchKanbanSize` (kanban/main.coffee L636-663).
    // A `ResizeObserver` watches every header column (`.task-colum-name`); its
    // callback sums each column's `offsetWidth` plus the inter-column margin
    // (read once from the `--kanban-column-margin` custom property — a margin
    // shorthand `0 5px 0 0`, of which the legacy takes the SECOND token) and
    // publishes `--kanban-width` on `document.body` (subtracting one trailing
    // margin, exactly as the source did). Columns detached from the document
    // are unobserved. Cleanup disconnects the observer and clears the body var
    // so a stale width never leaks into another screen after unmount.
    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === "undefined") {
            return undefined;
        }

        const styles = getComputedStyle(root);
        const marginRaw = styles
            .getPropertyValue("--kanban-column-margin")
            .trim();
        // `"0 5px 0 0"` → replace first `px` → `"0 5 0 0"` → split → token[1].
        const columnMargin =
            Number(marginRaw.replace("px", "").split(" ")[1]) || 0;

        const columns = Array.from(
            root.querySelectorAll<HTMLElement>(
                ".kanban-table-header .task-colum-name",
            ),
        );
        if (columns.length === 0) {
            return undefined;
        }

        const observer = new ResizeObserver(() => {
            let width = 0;
            for (const column of columns) {
                if (document.body.contains(column)) {
                    width += column.offsetWidth + columnMargin;
                } else {
                    observer.unobserve(column);
                }
            }
            if (width > 0) {
                document.body.style.setProperty(
                    "--kanban-width",
                    `${width - columnMargin}px`,
                );
            }
        });
        columns.forEach((column) => observer.observe(column));

        return () => {
            observer.disconnect();
            document.body.style.removeProperty("--kanban-width");
        };
        // Re-observe when the header column set changes (stable id key) or when
        // the board switches between swimlane and no-swimlane layout.
    }, [columnIdsKey, swimlaneMode]);

    // [M-14] Behavior 2 — no-swimlane header/body horizontal scroll sync.
    // Port of the `tableBody.on("scroll", …)` handler installed in
    // `kanbanTableLoaded` (kanban/main.coffee L697-700): the sticky header row
    // is absolutely positioned and does NOT share the body's horizontal
    // scrollport, so it is kept aligned by translating `.kanban-table-inner` by
    // the negated `scrollLeft`. Only the no-swimlane `.kanban-table-body` scrolls
    // horizontally (in swimlane mode the whole board scrolls — Behavior 3), so
    // this effect is inert under swimlanes.
    useEffect(() => {
        if (swimlaneMode) {
            return undefined;
        }
        const root = rootRef.current;
        if (!root) {
            return undefined;
        }
        const body = root.querySelector<HTMLElement>(".kanban-table-body");
        const headerInner = root.querySelector<HTMLElement>(
            ".kanban-table-header .kanban-table-inner",
        );
        if (!body || !headerInner) {
            return undefined;
        }
        const onScroll = (): void => {
            const scroll = -1 * body.scrollLeft;
            headerInner.style.transform = `translateX(${scroll}px)`;
        };
        body.addEventListener("scroll", onScroll);
        return () => body.removeEventListener("scroll", onScroll);
    }, [swimlaneMode]);

    // [M-14] Behavior 3 — swimlane sticky-title/add horizontal translation.
    // Port of `KanbanSwimlaneDirective` (kanban/main.coffee L1139-1148), which
    // was linked on the SAME root node. In swimlane mode the whole
    // `.kanban-table-swimlane` root is the scroll container (SCSS
    // `overflow: auto`); its sticky swimlane titles and the "add swimlane"
    // affordance only pin vertically, so each is translated by the root's
    // `scrollLeft` to stay flush with the left edge as the board scrolls right.
    useEffect(() => {
        if (!swimlaneMode) {
            return undefined;
        }
        const root = rootRef.current;
        if (!root) {
            return undefined;
        }
        const onScroll = (): void => {
            const scroll = root.scrollLeft;
            const value = `translateX(${scroll}px)`;
            root
                .querySelectorAll<HTMLElement>(".kanban-swimlane-title")
                .forEach((title) => {
                    title.style.transform = value;
                });
            const add = root.querySelector<HTMLElement>(".kanban-swimlane-add");
            if (add) {
                add.style.transform = value;
            }
        };
        root.addEventListener("scroll", onScroll);
        return () => root.removeEventListener("scroll", onScroll);
    }, [swimlaneMode]);

    let rootClassName = "kanban-table zoom-" + zoomLevel;
    if (swimlaneMode) {
        rootClassName += " kanban-table-swimlane";
    }

    // QA-FUNC-11: "Create swimlane" is an admin editing affordance and must be
    // disabled on an archived project (truthy `archived_code`), consistent with
    // AngularJS `projectService.canEdit` semantics (no editing on archived).
    const swimlaneAddVisible =
        swimlaneMode &&
        !!project.i_am_admin &&
        !project.archived_code &&
        swimlanesList.length <= 1;

    const renderColumns = (swimlaneId: number | null): JSX.Element[] => {
        const statuses: Status[] = swimlaneId === null
            ? usStatusList
            : state.swimlanesStatuses[swimlaneId] ?? [];
        return statuses.map((s) => {
            const cardIds =
                swimlaneId === null
                    ? state.usByStatus[String(s.id)] ?? []
                    : (state.usByStatusSwimlanes[swimlaneId] &&
                          state.usByStatusSwimlanes[swimlaneId][s.id]) ??
                      [];
            return (
                <KanbanColumn
                    key={s.id}
                    status={s}
                    swimlaneId={swimlaneId}
                    project={project}
                    zoom={zoom}
                    zoomLevel={zoomLevel}
                    cardIds={cardIds}
                    usMap={state.usMap}
                    folded={!!folds[s.id]}
                    unfolded={unfold === s.id}
                    selectedUss={selectedUss}
                    movedUs={movedUs}
                    showPlaceholder={
                        showPlaceholder ? showPlaceholder(s.id, swimlaneId) : false
                    }
                    notFound={notFound}
                    isArchivedHidden={isArchivedHidden}
                    onToggleFold={onToggleFold}
                    onClickEdit={onClickEdit}
                    onClickDelete={onClickDelete}
                    onClickAssignedTo={onClickAssignedTo}
                    onClickMoveToTop={onClickMoveToTop}
                    onToggleSelect={onToggleSelect}
                    resolveAvatar={resolveAvatar}
                />
            );
        });
    };

    return (
        <DndProvider
            project={project}
            resolveDrop={resolveDrop}
            persist={persist}
            onDragActiveChange={setDragging}
        >
            <div className={rootClassName} ref={rootRef}>
                <div className="kanban-table-header">
                    <div className="kanban-table-inner">
                        {usStatusList.map((s) => (
                            <ColumnHeader
                                key={s.id}
                                status={s}
                                folded={!!folds[s.id]}
                                canAddUs={canAddUs}
                                onAddUs={onAddUs}
                                onFoldStatus={onFoldStatus}
                            />
                        ))}
                    </div>
                </div>

                {swimlaneMode
                    ? swimlanesList.map((swimlane) => (
                          <Swimlane
                              key={swimlane.id}
                              swimlane={swimlane}
                              project={project}
                              folded={!!foldedSwimlane[swimlane.id]}
                              onToggle={onToggleSwimlane ?? (() => undefined)}
                              dragging={dragging}
                              onRequestOpen={onRequestOpenSwimlane}
                          >
                              {renderColumns(swimlane.id)}
                          </Swimlane>
                      ))
                    : null}

                {swimlaneAddVisible ? (
                    <a
                        className="kanban-swimlane-add"
                        href={`/project/${project.slug ?? ""}/admin/project-values/kanban`}
                    >
                        <Icon name="icon-add" wrapperClass="add-action" />
                        <span>{t(CREATE_SWIMLANE_KEY, CREATE_SWIMLANE_FALLBACK)}</span>
                    </a>
                ) : null}

                {!swimlaneMode ? (
                    <div className="kanban-table-body">
                        <div className="kanban-table-inner">
                            {renderColumns(null)}
                        </div>
                    </div>
                ) : null}
            </div>
        </DndProvider>
    );
}
