/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { UserStory } from '../../shared/types/userStory';
import type { Status } from '../../shared/types/status';
import type { Swimlane } from '../../shared/types/swimlane';
import type { Tag } from '../../shared/types/tag';

export interface ColorizedTag {
    readonly name: Tag[0];

    readonly color: Tag[1];
}

export interface BoardUser {
    readonly id: number;
}

export type CardZoomFeatures = readonly string[];

export interface CardUserStoryVm {
    readonly id: number;

    readonly model: UserStory;

    readonly swimlane: number | null;

    readonly foldStatusChanged: boolean | undefined;

    readonly images: UserStory['attachments'];

    readonly assigned_to: BoardUser | undefined;

    readonly assigned_users: readonly BoardUser[];

    readonly assigned_users_preview: readonly BoardUser[];

    readonly colorized_tags: readonly ColorizedTag[];

    readonly 'loading-extra'?: boolean;
}

export type UsByStatus = Readonly<Record<string, readonly number[]>>;

export type UsByStatusSwimlanes = Readonly<
    Record<number, Readonly<Record<number, readonly number[]>>>
>;

export type UsMap = Readonly<Record<number, CardUserStoryVm>>;

export type SwimlaneListEntry = Swimlane & { readonly kanban_order?: number };

export interface KanbanBoardState {
    readonly storiesById: Readonly<Record<number, UserStory>>;

    readonly order: Readonly<Record<number, number>>;

    readonly swimlanes: readonly Swimlane[];

    readonly usStatusList: readonly Status[];

    readonly swimlanesStatuses: Readonly<Record<number, readonly Status[]>>;

    readonly usersById: Readonly<Record<number, BoardUser>>;

    readonly foldStatusChanged: Readonly<Record<number, boolean>>;

    readonly statusHide: readonly number[];

    readonly archivedStatus: readonly number[];

    // Column folds are keyed numerically here but arrive string-keyed from persisted
    // storage, so the reducer converts them on hydration. Swimlane folds keep their string
    // keys all the way through, because that record is written back to storage verbatim
    // and rekeying it would drop the user's folded swimlanes on the next load.
    readonly folds: Readonly<Record<number, boolean>>;

    readonly unfold: number | null;

    readonly foldedSwimlane: Readonly<Record<string, boolean>>;

    readonly selectedUss: Readonly<Record<number, boolean>>;

    readonly movedUs: readonly number[];

    readonly zoomLevel: number;

    readonly zoom: CardZoomFeatures;

    readonly zoomLoading: boolean;

    readonly renderInProgress: boolean;

    readonly initialLoad: boolean;

    readonly notFoundUserstories: boolean;
}

export interface KanbanBoardHydration {
    readonly stories?: readonly UserStory[];

    readonly swimlanes?: readonly Swimlane[];

    readonly usStatusList?: readonly Status[];

    readonly swimlanesStatuses?: Readonly<Record<number, readonly Status[]>>;

    readonly usersById?: Readonly<Record<number, BoardUser>>;

    readonly folds?: Readonly<Record<string, boolean>>;

    readonly foldedSwimlane?: Readonly<Record<string, boolean>>;

    readonly zoom?: CardZoomFeatures;

    readonly zoomLevel?: number;
}

export interface KanbanMoveCardAction {
    readonly type: 'MOVE_CARD';

    readonly usList: readonly number[];

    readonly statusId: number;

    // A grouping key, which may be the synthetic unclassified swimlane's id. A story's own
    // `swimlane` field spells unclassified as `null` instead, so the two are not
    // interchangeable and the reducer translates one into the other.
    readonly swimlaneId: number | null;

    readonly index: number;

    readonly previousCard: number | null;

    readonly nextCard: number | null;
}

export type KanbanBoardAction =
    | ({ readonly type: 'HYDRATE' } & KanbanBoardHydration)

    | { readonly type: 'SET_STORIES'; readonly stories: readonly UserStory[] }
    | { readonly type: 'ADD_STORIES'; readonly stories: readonly UserStory[] }
    | { readonly type: 'REMOVE_STORY'; readonly storyId: number }
    | { readonly type: 'REPLACE_STORY'; readonly story: UserStory }

    | KanbanMoveCardAction
    | { readonly type: 'MOVE_TO_END'; readonly storyId: number; readonly statusId: number }

    | { readonly type: 'TOGGLE_FOLD'; readonly storyId: number }
    | { readonly type: 'RESET_FOLDS' }
    | { readonly type: 'TOGGLE_STATUS_COLUMN_FOLD'; readonly statusId: number }
    | { readonly type: 'SET_FOLDS'; readonly folds: Readonly<Record<string, boolean>> }
    | { readonly type: 'TOGGLE_SWIMLANE'; readonly swimlaneId: number }
    | {
          readonly type: 'SET_FOLDED_SWIMLANES';
          readonly foldedSwimlane: Readonly<Record<string, boolean>>;
      }

    | { readonly type: 'TOGGLE_SELECTED_US'; readonly storyId: number }
    | { readonly type: 'CLEAN_SELECTED_USS' }
    | { readonly type: 'MARK_US_MOVED'; readonly storyId: number }
    | { readonly type: 'CLEAR_MOVED_US' }

    | { readonly type: 'SET_ZOOM'; readonly zoomLevel: number; readonly zoom: CardZoomFeatures }
    | { readonly type: 'SET_ZOOM_LOADING'; readonly zoomLoading: boolean }

    | { readonly type: 'SET_RENDER_IN_PROGRESS'; readonly renderInProgress: boolean }
    | { readonly type: 'SET_INITIAL_LOAD'; readonly initialLoad: boolean }
    | { readonly type: 'SET_NOT_FOUND_USERSTORIES'; readonly notFoundUserstories: boolean }

    | { readonly type: 'HIDE_STATUS'; readonly statusId: number }
    | { readonly type: 'SHOW_STATUS'; readonly statusId: number }
    | { readonly type: 'ADD_ARCHIVED_STATUS'; readonly statusId: number }

    | { readonly type: 'SET_SWIMLANES'; readonly swimlanes: readonly Swimlane[] }
    | {
          readonly type: 'SET_SWIMLANES_STATUSES';
          readonly swimlanesStatuses: Readonly<Record<number, readonly Status[]>>;
      }
    | { readonly type: 'SET_US_STATUS_LIST'; readonly usStatusList: readonly Status[] }
    | {
          readonly type: 'SET_USERS_BY_ID';
          readonly usersById: Readonly<Record<number, BoardUser>>;
      };
