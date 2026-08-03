/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Draft } from 'immer';
import type {
    KanbanBoardAction,
    KanbanBoardHydration,
    KanbanBoardState,
} from './types';
import type { UserStory } from '../../shared/types/userStory';
import type { Status } from '../../shared/types/status';

type BoardDraft = Draft<KanbanBoardState>;

type StoryDraft = BoardDraft['storiesById'][number];

// The synthetic swimlane that collects stories belonging to none. It is a legitimate
// grouping key — the rendered swimlane list starts with it and it owns a full status set —
// but it must never reach a story: `UserStory.swimlane` spells unclassified as `null`, and
// persisting `-1` would create a swimlane reference the project does not have.
export const UNCLASSIFIED_SWIMLANE_ID = -1;

function toDraft<T>(value: T): Draft<T> {
    return value as Draft<T>;
}

function readOrder(order: BoardDraft['order'], id: number): number {
    const value = order[id];

    return Number.isFinite(value) ? value : 0;
}

function sortStoriesByOrder(
    stories: readonly StoryDraft[],
    order: BoardDraft['order'],
): StoryDraft[] {
    return [...stories].sort(
        (left, right) => readOrder(order, left.id) - readOrder(order, right.id),
    );
}

// A falsy swimlane id matches every swimlane rather than only the unclassified one, which
// is how a board configured without swimlanes reuses this path unchanged.
function selectStatusStories(
    draft: BoardDraft,
    statusId: number,
    swimlaneId: number | null,
): StoryDraft[] {
    return Object.values(draft.storiesById).filter(
        (story) =>
            story.status === statusId &&
            (!swimlaneId || story.swimlane === swimlaneId),
    );
}

function buildOrderFromKanbanOrder(
    stories: readonly { readonly id: number; readonly kanban_order: number }[],
): Record<number, number> {
    const order: Record<number, number> = {};

    for (const story of stories) {
        order[story.id] = story.kanban_order;
    }

    return order;
}

function buildStoriesById(
    stories: readonly UserStory[],
): Record<number, UserStory> {
    const storiesById: Record<number, UserStory> = {};

    for (const story of stories) {
        storiesById[story.id] = story;
    }

    return storiesById;
}

function sortByKanbanOrder(stories: readonly UserStory[]): UserStory[] {
    return [...stories].sort(
        (left, right) => left.kanban_order - right.kanban_order,
    );
}

function buildNumericFolds(
    stored: Readonly<Record<string, boolean>>,
): Record<number, boolean> {
    const folds: Record<number, boolean> = {};

    Object.entries(stored).forEach(([key, value]) => {
        folds[Number(key)] = value;
    });

    return folds;
}

function buildSwimlanesStatuses(
    source: Readonly<Record<number, readonly Status[]>>,
): Record<number, Status[]> {
    const swimlanesStatuses: Record<number, Status[]> = {};

    Object.entries(source).forEach(([swimlaneId, statuses]) => {
        swimlanesStatuses[Number(swimlaneId)] = [...statuses];
    });

    return swimlanesStatuses;
}

function forceFoldArchivedStatuses(draft: BoardDraft): void {
    draft.usStatusList
        .filter((status) => status.is_archived)
        .forEach((status) => {
            draft.folds[status.id] = true;
        });
}

// Ordering is anchored on the card the drop landed AFTER, not on an absolute index, because
// that is what the server is told and what it recomputes from. The arithmetic must be
// reproduced exactly: the block starts one past the anchor's order, and the untouched tail
// is renumbered from one beyond the block so the moved cards have somewhere to sit. Dropping
// at the head leaves both the anchor order and the anchor index at zero, which places the
// block first and pushes the whole column down. Any drift here reorders the column silently
// — no request fails, and the wrong order simply becomes the persisted one.
function applyMoveCard(
    draft: BoardDraft,
    action: Extract<KanbanBoardAction, { type: 'MOVE_CARD' }>,
): void {
    const { statusId, usList, previousCard } = action;

    const swimlaneId =
        action.swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : action.swimlaneId;

    const sortedColumn = sortStoriesByOrder(
        selectStatusStories(draft, statusId, swimlaneId),
        draft.order,
    );

    let previousUsOrder = 0;
    let previousUsIndex = 0;

    if (previousCard) {
        previousUsOrder = readOrder(draft.order, previousCard) + 1;
        previousUsIndex =
            sortedColumn.findIndex((story) => story.id === previousCard) + 1;
    }

    const movedIds = new Set<number>(usList);
    const columnWithoutMoved = sortedColumn.filter(
        (story) => !movedIds.has(story.id),
    );

    const afterDestination = columnWithoutMoved.slice(previousUsIndex);

    const initialLength = usList.length + 1;

    afterDestination.forEach((story, key) => {
        draft.order[story.id] = previousUsOrder + initialLength + key;
    });

    usList.forEach((storyId, key) => {
        const story = draft.storiesById[storyId];

        if (!story) {
            return;
        }

        story.status = statusId;
        story.swimlane = swimlaneId;
        draft.order[storyId] = previousUsOrder + key;
    });

}

export function createInitialBoardState(
    params: KanbanBoardHydration = {},
): KanbanBoardState {
    const stories = params.stories ?? [];

    return {
        storiesById: buildStoriesById(stories),
        order: buildOrderFromKanbanOrder(stories),
        swimlanes: params.swimlanes ? [...params.swimlanes] : [],
        usStatusList: params.usStatusList ? [...params.usStatusList] : [],
        swimlanesStatuses: params.swimlanesStatuses
            ? buildSwimlanesStatuses(params.swimlanesStatuses)
            : {},
        usersById: params.usersById ? { ...params.usersById } : {},
        foldStatusChanged: {},
        statusHide: [],
        archivedStatus: [],
        folds: params.folds ? buildNumericFolds(params.folds) : {},
        unfold: null,
        foldedSwimlane: params.foldedSwimlane ? { ...params.foldedSwimlane } : {},
        selectedUss: {},
        movedUs: [],
        zoomLevel: params.zoomLevel === undefined ? -1 : Number(params.zoomLevel),
        zoom: params.zoom ? [...params.zoom] : [],
        zoomLoading: false,
        renderInProgress: false,
        initialLoad: false,
        notFoundUserstories: false,
    };
}

export function kanbanBoardReducer(
    draft: BoardDraft,
    action: KanbanBoardAction,
): void {
    switch (action.type) {

        case 'HYDRATE': {
            if (action.stories) {
                draft.storiesById = toDraft(buildStoriesById(action.stories));
                draft.order = buildOrderFromKanbanOrder(action.stories);
            }

            if (action.swimlanes) {
                draft.swimlanes = toDraft([...action.swimlanes]);
            }

            if (action.usStatusList) {
                draft.usStatusList = [...action.usStatusList];
            }

            if (action.swimlanesStatuses) {
                draft.swimlanesStatuses = buildSwimlanesStatuses(
                    action.swimlanesStatuses,
                );
            }

            if (action.usersById) {
                draft.usersById = { ...action.usersById };
            }

            if (action.folds) {
                draft.folds = buildNumericFolds(action.folds);
            }

            if (action.foldedSwimlane) {
                draft.foldedSwimlane = { ...action.foldedSwimlane };
            }

            if (action.zoom) {
                draft.zoom = [...action.zoom];
            }

            if (action.zoomLevel !== undefined) {
                draft.zoomLevel = Number(action.zoomLevel);
            }

            return;
        }

        case 'SET_STORIES': {
            draft.storiesById = toDraft(buildStoriesById(action.stories));
            draft.order = buildOrderFromKanbanOrder(action.stories);

            return;
        }

        case 'ADD_STORIES': {
            sortByKanbanOrder(action.stories).forEach((story) => {
                draft.storiesById[story.id] = toDraft(story);
            });

            draft.order = buildOrderFromKanbanOrder(
                Object.values(draft.storiesById),
            );

            return;
        }

        case 'REMOVE_STORY': {
            delete draft.storiesById[action.storyId];
            delete draft.order[action.storyId];

            return;
        }

        case 'REPLACE_STORY': {
            draft.storiesById[action.story.id] = toDraft(action.story);

            return;
        }

        case 'MOVE_CARD': {
            applyMoveCard(draft, action);

            return;
        }

        case 'MOVE_TO_END': {
            const story = draft.storiesById[action.storyId];

            if (!story) {
                return;
            }

            // Here `-1` is an ORDER sentinel meaning "append", unrelated to the swimlane
            // sentinel above: the real position is assigned by the server and arrives back
            // with the reloaded story.
            draft.order[action.storyId] = -1;
            story.status = action.statusId;
            story.kanban_order = draft.order[action.storyId];

            return;
        }

        case 'TOGGLE_FOLD': {
            draft.foldStatusChanged[action.storyId] =
                !draft.foldStatusChanged[action.storyId];

            return;
        }

        case 'RESET_FOLDS': {
            draft.foldStatusChanged = {};

            return;
        }

        case 'TOGGLE_STATUS_COLUMN_FOLD': {
            draft.unfold = null;
            draft.folds[action.statusId] = !draft.folds[action.statusId];

            if (!draft.folds[action.statusId]) {
                draft.unfold = action.statusId;
            }

            return;
        }

        case 'SET_FOLDS': {
            draft.folds = buildNumericFolds(action.folds);
            forceFoldArchivedStatuses(draft);

            return;
        }

        case 'TOGGLE_SWIMLANE': {
            const key = String(action.swimlaneId);

            draft.foldedSwimlane[key] = !draft.foldedSwimlane[key];

            return;
        }

        case 'SET_FOLDED_SWIMLANES': {
            draft.foldedSwimlane = { ...action.foldedSwimlane };

            return;
        }

        case 'TOGGLE_SELECTED_US': {
            draft.selectedUss[action.storyId] =
                !draft.selectedUss[action.storyId];

            return;
        }

        case 'CLEAN_SELECTED_USS': {
            Object.keys(draft.selectedUss).forEach((key) => {
                draft.selectedUss[Number(key)] = false;
            });

            return;
        }

        case 'MARK_US_MOVED': {
            draft.movedUs.push(action.storyId);

            return;
        }

        case 'CLEAR_MOVED_US': {
            draft.movedUs = [];

            return;
        }

        case 'SET_ZOOM': {
            const nextZoomLevel = Number(action.zoomLevel);

            if (draft.zoomLevel === nextZoomLevel) {
                return;
            }

            const previousZoomLevel = draft.zoomLevel;

            draft.zoomLevel = nextZoomLevel;
            draft.zoom = [...action.zoom];

            // Only the two largest zoom levels render the extra per-card detail that has to
            // be fetched, so crossing up into them raises the loading flag while zooming
            // back down, or moving between two small levels, needs no fetch at all.
            if (nextZoomLevel > 2 && previousZoomLevel <= 2) {
                draft.zoomLoading = true;
            }

            return;
        }

        case 'SET_ZOOM_LOADING': {
            draft.zoomLoading = action.zoomLoading;

            return;
        }

        case 'SET_RENDER_IN_PROGRESS': {
            draft.renderInProgress = action.renderInProgress;

            return;
        }

        case 'SET_INITIAL_LOAD': {
            draft.initialLoad = action.initialLoad;

            return;
        }

        case 'SET_NOT_FOUND_USERSTORIES': {
            draft.notFoundUserstories = action.notFoundUserstories;

            return;
        }

        case 'HIDE_STATUS': {
            draft.statusHide.push(action.statusId);

            return;
        }

        case 'SHOW_STATUS': {
            draft.statusHide = draft.statusHide.filter(
                (statusId) => statusId !== action.statusId,
            );

            return;
        }

        case 'ADD_ARCHIVED_STATUS': {
            draft.archivedStatus.push(action.statusId);

            return;
        }

        case 'SET_SWIMLANES': {
            draft.swimlanes = toDraft([...action.swimlanes]);

            return;
        }

        case 'SET_SWIMLANES_STATUSES': {
            draft.swimlanesStatuses = buildSwimlanesStatuses(
                action.swimlanesStatuses,
            );

            return;
        }

        case 'SET_US_STATUS_LIST': {
            draft.usStatusList = [...action.usStatusList];

            return;
        }

        case 'SET_USERS_BY_ID': {
            draft.usersById = { ...action.usersById };

            return;
        }

        default: {
            const exhaustive: never = action;
            void exhaustive;

            return;
        }
    }
}
