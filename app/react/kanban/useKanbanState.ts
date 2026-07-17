/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useState } from "react";
import { castDraft, produce } from "immer";
import sortBy from "lodash/sortBy";

/**
 * Board state for the React Kanban screen.
 *
 * Ported 1:1 from the AngularJS `tgKanbanUserstories` service
 * (`app/coffee/modules/kanban/kanban-usertories.coffee`). The Immutable.js
 * `Map`/`List`/`fromJS` graph is replaced with plain objects updated through
 * `immer` `produce()` (copy-on-write); there is no `immutable` import.
 */

// ---------------------------------------------------------------------------
// Domain types (single source of truth shared across the kanban components)
// ---------------------------------------------------------------------------

export interface ColorizedTag {
    name: string;
    color: string | null;
}

export interface BaseUser {
    id: number;
    username?: string;
    full_name_display?: string;
    photo?: string | null;
    is_active?: boolean;
    [key: string]: unknown;
}

export type UsersById = Record<number, BaseUser>;

export interface Attachment {
    thumbnail_card_url?: string | null;
    [key: string]: unknown;
}

export interface TaskModel {
    id?: number;
    ref?: number;
    subject?: string;
    is_closed?: boolean;
    is_blocked?: boolean;
    [key: string]: unknown;
}

export interface EpicRef {
    id: number;
    ref?: number;
    color?: string;
    subject?: string;
    [key: string]: unknown;
}

/**
 * The user-story attributes as returned by `/api/v1/userstories`. Only the
 * fields the board actually reads are typed explicitly; the index signature
 * keeps the remaining attributes available without loosening strictness.
 */
export interface UserStoryModel {
    id: number;
    status: number;
    swimlane: number | null;
    kanban_order: number;
    ref?: number;
    subject?: string;
    project?: number;
    is_blocked?: boolean;
    assigned_to?: number | null;
    assigned_users?: number[];
    tags?: Array<[string, string | null]> | null;
    attachments?: Attachment[];
    epics?: EpicRef[];
    tasks?: TaskModel[];
    watchers?: number[];
    total_points?: number | null;
    total_attachments?: number | null;
    total_comments?: number | null;
    due_date?: string | null;
    is_iocaine?: boolean;
    is_closed?: boolean;
    blocked_note?: string | null;
    project_extra_info?: { slug?: string; [key: string]: unknown };
    [key: string]: unknown;
}

/** View-model produced by {@link retrieveUserStoryData} and consumed by `Card`. */
export interface UsView {
    foldStatusChanged: boolean | undefined;
    model: UserStoryModel;
    images: Attachment[];
    id: number;
    swimlane: number | null;
    assigned_to: BaseUser | undefined;
    assigned_users: BaseUser[];
    assigned_users_preview: BaseUser[];
    colorized_tags: ColorizedTag[];
}

export interface Status {
    id: number;
    name: string;
    color: string;
    order: number;
    is_archived: boolean;
    wip_limit: number | null;
    [key: string]: unknown;
}

export interface Swimlane {
    id: number;
    name: string;
    kanban_order?: number;
    statuses?: Status[];
    [key: string]: unknown;
}

export interface KanbanProject {
    id: number;
    slug?: string;
    name?: string;
    is_kanban_activated?: boolean;
    my_permissions?: string[];
    us_statuses?: Status[];
    points?: unknown[];
    members?: unknown[];
    roles?: unknown[];
    default_swimlane?: number | null;
    swimlanes?: unknown[];
    archived_code?: string | boolean | null;
    i_am_admin?: boolean;
    [key: string]: unknown;
}

export interface KanbanState {
    project: KanbanProject | null;
    swimlanes: Swimlane[];
    usersById: UsersById;
    userstoriesRaw: UserStoryModel[];
    order: Record<number, number>;
    usByStatus: Record<string, number[]>;
    usMap: Record<number, UsView>;
    swimlanesList: Swimlane[];
    usByStatusSwimlanes: Record<number, Record<number, number[]>>;
    swimlanesStatuses: Record<number, Status[]>;
    archivedStatus: number[];
    statusHide: number[];
    foldStatusChanged: Record<number, boolean>;
}

/**
 * Synthetic "unclassified" swimlane. The AngularJS board inserted a row with
 * `id: -1` (label `KANBAN.UNCLASSIFIED_USER_STORIES`) whenever user stories had
 * no swimlane; the literal is kept here so the sentinel renders with a stable
 * name until i18n is wired for React.
 */
export const UNCLASSIFIED_SWIMLANE_ID = -1;
export const UNCLASSIFIED_USER_STORIES_LABEL = "Unclassified user stories";

// ---------------------------------------------------------------------------
// Pure helpers (exported so they can be unit-tested without the hook wrapper)
// ---------------------------------------------------------------------------

export function createInitialState(): KanbanState {
    return {
        project: null,
        swimlanes: [],
        usersById: {},
        userstoriesRaw: [],
        order: {},
        usByStatus: {},
        usMap: {},
        swimlanesList: [],
        usByStatusSwimlanes: {},
        swimlanesStatuses: {},
        archivedStatus: [],
        statusHide: [],
        foldStatusChanged: {},
    };
}

/**
 * Port of `retrieveUserStoryData`. Pure: the caller supplies the plain model,
 * the `usersById` lookup and the fold map, so it never touches an immer draft.
 */
export function retrieveUserStoryData(
    usModel: UserStoryModel,
    usersById: UsersById,
    foldStatusChanged: Record<number, boolean>,
): UsView {
    const model: UserStoryModel = { ...usModel };

    const attachments = model.attachments ?? [];
    const images = attachments.filter((it) => !!it.thumbnail_card_url);

    const assigned_users: BaseUser[] = [];
    const assignedIds = usModel.assigned_users ?? [];
    for (const assignedUserId of assignedIds) {
        const assignedUserData = usersById[assignedUserId];
        if (assignedUserData) {
            assigned_users.push(assignedUserData);
        }
    }

    const tags = model.tags ?? [];
    const colorized_tags: ColorizedTag[] = tags.map((tag) => ({
        name: tag[0],
        color: tag[1],
    }));

    return {
        foldStatusChanged: foldStatusChanged[usModel.id],
        model,
        images,
        id: usModel.id,
        swimlane: usModel.swimlane,
        assigned_to:
            usModel.assigned_to != null ? usersById[usModel.assigned_to] : undefined,
        assigned_users,
        assigned_users_preview: assigned_users.slice(0, 3),
        colorized_tags,
    };
}

function buildOrder(userstories: UserStoryModel[]): Record<number, number> {
    const order: Record<number, number> = {};
    for (const it of userstories) {
        order[it.id] = it.kanban_order;
    }
    return order;
}

interface BoardCollections {
    userstoriesRaw: UserStoryModel[];
    usByStatus: Record<string, number[]>;
    usMap: Record<number, UsView>;
    swimlanesList: Swimlane[];
    usByStatusSwimlanes: Record<number, Record<number, number[]>>;
}

/** Mirrors `refreshSwimlanes`, including the `id: -1` sentinel insertion. */
function computeSwimlanes(
    userstoriesRaw: UserStoryModel[],
    usByStatus: Record<string, number[]>,
    usMap: Record<number, UsView>,
    swimlanes: Swimlane[],
): {
    swimlanesList: Swimlane[];
    usByStatusSwimlanes: Record<number, Record<number, number[]>>;
} {
    if (!swimlanes || !swimlanes.length) {
        return { swimlanesList: [], usByStatusSwimlanes: {} };
    }

    const userstoriesNoSwimlane = userstoriesRaw.filter(
        (us) => us.swimlane === null || us.swimlane === undefined,
    );

    const list: Swimlane[] = [];
    for (const swimlane of swimlanes) {
        if (list.indexOf(swimlane) === -1) {
            list.push(swimlane);
        }
    }
    if (userstoriesNoSwimlane.length) {
        list.unshift({
            id: UNCLASSIFIED_SWIMLANE_ID,
            kanban_order: 1,
            name: UNCLASSIFIED_USER_STORIES_LABEL,
        });
    }

    const usByStatusSwimlanes: Record<number, Record<number, number[]>> = {};
    for (const swimlane of list) {
        const swimlaneUsByStatus: Record<number, number[]> = {};
        const target =
            swimlane.id === UNCLASSIFIED_SWIMLANE_ID ? null : swimlane.id;

        for (const statusKey of Object.keys(usByStatus)) {
            swimlaneUsByStatus[Number(statusKey)] = usByStatus[statusKey].filter(
                (usId) => {
                    const view = usMap[usId];
                    const usSwimlane = view ? view.model.swimlane : undefined;
                    return (
                        (usSwimlane === undefined ? null : usSwimlane) === target
                    );
                },
            );
        }
        usByStatusSwimlanes[swimlane.id] = swimlaneUsByStatus;
    }

    return { swimlanesList: list, usByStatusSwimlanes };
}

/**
 * Recompute the derived collections from `userstoriesRaw` + `order`. Mirrors
 * `refresh(refreshUsMap, refreshSwimlanes = true)`: sort by order, group ids by
 * status, (optionally) rebuild the view-model map, then regroup by swimlane.
 * Pure — operates on plain values only, so it is safe to call from a reducer.
 */
function computeBoard(
    rawInput: UserStoryModel[],
    order: Record<number, number>,
    usersById: UsersById,
    foldStatusChanged: Record<number, boolean>,
    previousUsMap: Record<number, UsView>,
    refreshUsMap: boolean,
    swimlanes: Swimlane[],
): BoardCollections {
    const sorted = sortBy(rawInput, (it) => order[it.id]);

    const collection: Record<string, number[]> = {};
    const usMap: Record<number, UsView> = { ...previousUsMap };

    for (const usModel of sorted) {
        const statusKey = String(usModel.status);
        if (!collection[statusKey]) {
            collection[statusKey] = [];
        }
        collection[statusKey] = collection[statusKey].filter(
            (id) => id !== usModel.id,
        );
        collection[statusKey].push(usModel.id);

        if (refreshUsMap) {
            usMap[usModel.id] = retrieveUserStoryData(
                usModel,
                usersById,
                foldStatusChanged,
            );
        }
    }

    const { swimlanesList, usByStatusSwimlanes } = computeSwimlanes(
        sorted,
        collection,
        usMap,
        swimlanes,
    );

    return {
        userstoriesRaw: sorted,
        usByStatus: collection,
        usMap,
        swimlanesList,
        usByStatusSwimlanes,
    };
}

function assignBoard(draft: KanbanState, board: BoardCollections): void {
    draft.userstoriesRaw = castDraft(board.userstoriesRaw);
    draft.usByStatus = castDraft(board.usByStatus);
    draft.usMap = castDraft(board.usMap);
    draft.swimlanesList = castDraft(board.swimlanesList);
    draft.usByStatusSwimlanes = castDraft(board.usByStatusSwimlanes);
}

// ---------------------------------------------------------------------------
// Reducers (pure, immer-based)
// ---------------------------------------------------------------------------

/** Port of `init(project, swimlanes, usersById)` plus `swimlanesStatuses`. */
export function reduceInit(
    state: KanbanState,
    project: KanbanProject,
    swimlanes: Swimlane[],
    usersById: UsersById,
): KanbanState {
    return produce(state, (draft) => {
        draft.project = castDraft(project);
        draft.swimlanes = castDraft(swimlanes);
        draft.usersById = castDraft(usersById);

        const swimlanesStatuses: Record<number, Status[]> = {};
        for (const swimlane of swimlanes) {
            swimlanesStatuses[swimlane.id] = swimlane.statuses ?? [];
        }
        swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID] = project.us_statuses ?? [];
        draft.swimlanesStatuses = castDraft(swimlanesStatuses);
    });
}

/** Port of `set(userstories)` = `refreshRawOrder` + `refresh()`. */
export function reduceSetUserstories(
    state: KanbanState,
    userstories: UserStoryModel[],
): KanbanState {
    const order = buildOrder(userstories);
    const board = computeBoard(
        userstories,
        order,
        state.usersById,
        state.foldStatusChanged,
        state.usMap,
        true,
        state.swimlanes,
    );
    return produce(state, (draft) => {
        draft.order = order;
        assignBoard(draft, board);
    });
}

/**
 * Port of `move(usList, statusId, swimlaneId, index, previousCard, nextCard)`.
 * `swimlaneId` is the API value (the caller maps the `-1` sentinel to `null`
 * before calling, exactly like `moveUs` does with `apiNewSwimlaneId`). The
 * `index` argument is intentionally omitted because the source never used it.
 */
export function reduceMove(
    state: KanbanState,
    usList: number[],
    statusId: number,
    swimlaneId: number | null,
    previousCard: number | null,
    nextCard: number | null,
): KanbanState {
    const order: Record<number, number> = { ...state.order };

    let usByStatus = state.userstoriesRaw.filter(
        (it) =>
            it.status === statusId && (!swimlaneId || it.swimlane === swimlaneId),
    );
    usByStatus = sortBy(usByStatus, (it) => order[it.id]);

    let previousUsOrder: number;
    let previousUsIndex: number;
    if (previousCard) {
        previousUsOrder = order[previousCard] + 1;
        previousUsIndex = usByStatus.findIndex((it) => it.id === previousCard) + 1;
    } else {
        previousUsOrder = 0;
        previousUsIndex = 0;
    }

    const usByStatusWithoutMoved = usByStatus.filter(
        (listIt) => usList.indexOf(listIt.id) === -1,
    );
    const afterDestination = usByStatusWithoutMoved.slice(previousUsIndex);
    const initialLength = usList.length + 1;

    for (let key = 0; key < afterDestination.length; key++) {
        order[afterDestination[key].id] = previousUsOrder + initialLength + key;
    }
    for (let key = 0; key < usList.length; key++) {
        order[usList[key]] = previousUsOrder + key;
    }

    const newRaw = state.userstoriesRaw.map((model) =>
        usList.indexOf(model.id) !== -1
            ? { ...model, status: statusId, swimlane: swimlaneId }
            : model,
    );

    const board = computeBoard(
        newRaw,
        order,
        state.usersById,
        state.foldStatusChanged,
        state.usMap,
        true,
        state.swimlanes,
    );

    return produce(state, (draft) => {
        draft.order = order;
        assignBoard(draft, board);
    });
}

/**
 * Persist payload for a Kanban drag-and-drop, matching the object returned by
 * the source `move()` and consumed by `bulk_update_kanban_order`.
 */
export interface KanbanMoveResult {
    statusId: number;
    swimlaneId: number | null;
    afterUserstoryId: number | null;
    beforeUserstoryId: number | null;
    bulkUserstories: number[];
}

/** Build the persist payload for a move (mirrors the `move()` return value). */
export function buildMoveResult(
    usList: number[],
    statusId: number,
    swimlaneId: number | null,
    previousCard: number | null,
    nextCard: number | null,
): KanbanMoveResult {
    return {
        statusId,
        swimlaneId,
        afterUserstoryId: previousCard,
        beforeUserstoryId: nextCard,
        bulkUserstories: usList,
    };
}

/** Port of `toggleFold(usId)` = flip fold flag + `refreshUserStory(usId)`. */
export function reduceToggleFold(state: KanbanState, usId: number): KanbanState {
    return produce(state, (draft) => {
        draft.foldStatusChanged[usId] = !draft.foldStatusChanged[usId];

        const model = state.userstoriesRaw.find((it) => it.id === usId);
        if (model) {
            const nextFold = {
                ...state.foldStatusChanged,
                [usId]: !state.foldStatusChanged[usId],
            };
            draft.usMap[usId] = castDraft(
                retrieveUserStoryData(model, state.usersById, nextFold),
            );
        }
    });
}

/** Port of `addArchivedStatus(statusId)` (deduplicated for safety). */
export function reduceAddArchivedStatus(
    state: KanbanState,
    statusId: number,
): KanbanState {
    return produce(state, (draft) => {
        if (draft.archivedStatus.indexOf(statusId) === -1) {
            draft.archivedStatus.push(statusId);
        }
    });
}

// ---------------------------------------------------------------------------
// Selectors (pure)
// ---------------------------------------------------------------------------

export function getUs(state: KanbanState, id: number): UsView | undefined {
    return state.usMap[id];
}

export function getUsModel(
    state: KanbanState,
    id: number,
): UserStoryModel | undefined {
    return state.userstoriesRaw.find((us) => us.id === id);
}

/** Port of `isUsInArchivedHiddenStatus(usId)`. */
export function isUsInArchivedHiddenStatus(
    state: KanbanState,
    usId: number,
): boolean {
    const us = state.usMap[usId];
    const status = us ? us.model.status : undefined;
    if (status === undefined) {
        return false;
    }
    return (
        state.archivedStatus.indexOf(status) !== -1 &&
        state.statusHide.indexOf(status) !== -1
    );
}

/**
 * Ordered user-story ids for a board column. In swimlane mode the ids come from
 * `usByStatusSwimlanes[swimlaneId][statusId]`; otherwise from
 * `usByStatus[statusId]`.
 */
export function getContainerIds(
    state: KanbanState,
    statusId: number,
    swimlaneId?: number | null,
): number[] {
    if (state.swimlanesList.length && swimlaneId != null) {
        const inner = state.usByStatusSwimlanes[swimlaneId];
        return (inner && inner[statusId]) || [];
    }
    return state.usByStatus[String(statusId)] || [];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseKanbanState {
    state: KanbanState;
    init: (
        project: KanbanProject,
        swimlanes: Swimlane[],
        usersById: UsersById,
    ) => void;
    setUserstories: (userstories: UserStoryModel[]) => void;
    move: (
        usList: number[],
        statusId: number,
        swimlaneId: number | null,
        previousCard: number | null,
        nextCard: number | null,
    ) => void;
    toggleFold: (usId: number) => void;
    addArchivedStatus: (statusId: number) => void;
    /**
     * Replace the entire board with a previously captured snapshot. Used for
     * optimistic-move rollback (M-05): a drag applies `move` immediately, and if
     * the bulk-order persistence rejects, the caller restores the pre-move
     * snapshot it captured from {@link state}. The snapshot is an immer-frozen
     * immutable value, so restoring it is a pure reference swap.
     */
    restore: (snapshot: KanbanState) => void;
}

export function useKanbanState(): UseKanbanState {
    const [state, setState] = useState<KanbanState>(createInitialState);

    const init = useCallback(
        (project: KanbanProject, swimlanes: Swimlane[], usersById: UsersById) => {
            setState((prev) => reduceInit(prev, project, swimlanes, usersById));
        },
        [],
    );

    const setUserstories = useCallback((userstories: UserStoryModel[]) => {
        setState((prev) => reduceSetUserstories(prev, userstories));
    }, []);

    const move = useCallback(
        (
            usList: number[],
            statusId: number,
            swimlaneId: number | null,
            previousCard: number | null,
            nextCard: number | null,
        ) => {
            setState((prev) =>
                reduceMove(prev, usList, statusId, swimlaneId, previousCard, nextCard),
            );
        },
        [],
    );

    const toggleFold = useCallback((usId: number) => {
        setState((prev) => reduceToggleFold(prev, usId));
    }, []);

    const addArchivedStatus = useCallback((statusId: number) => {
        setState((prev) => reduceAddArchivedStatus(prev, statusId));
    }, []);

    const restore = useCallback((snapshot: KanbanState) => {
        setState(() => snapshot);
    }, []);

    return {
        state,
        init,
        setUserstories,
        move,
        toggleFold,
        addArchivedStatus,
        restore,
    };
}
