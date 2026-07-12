/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * User-story status (a kanban column). Mirrors the backend `userstory-statuses`
 * resource. `wip_limit` is the PATCH target of the legacy
 * `UserstoriesResource.editStatus` and may be `null` (no WIP limit).
 */
export interface Status {
    id: number;
    name: string;
    color?: string;
    order?: number;
    is_closed?: boolean;
    is_archived?: boolean;
    wip_limit?: number | null;
    slug?: string;
    project?: number;
}

/** Domain alias — the AngularJS/back-end layer calls this a "user-story status". */
export type UserStoryStatus = Status;
