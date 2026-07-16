/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { DndProvider } from "../shared/dnd/DndProvider";
import type {
    DropNeighbors,
    NormalizedDragEnd,
    ResolvedDrop,
} from "../shared/dnd/DndProvider";
import { ColumnHeader, KanbanColumn } from "./KanbanColumn";
import { Swimlane } from "./Swimlane";
import { Icon } from "../shared/ui/Icon";
import type {
    BaseUser,
    KanbanProject,
    KanbanState,
    Status,
} from "./useKanbanState";

const CREATE_SWIMLANE_LABEL = "Create swimlane";

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
    dragging?: boolean;
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
        dragging,
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
        onToggleSelect,
        resolveAvatar,
    } = props;

    const usStatusList: Status[] =
        (project.us_statuses as Status[] | undefined) ?? [];
    const swimlanesList = state.swimlanesList;
    const swimlaneMode = swimlanesList.length > 0;

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
        >
            <div className={rootClassName}>
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
                        <span>{CREATE_SWIMLANE_LABEL}</span>
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
