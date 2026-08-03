/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Tag } from './tag';
import type { Epic } from './epic';

/**
 * The plain, flattened shape of a user story on the React side of the boundary --
 * never a live model, whose dirty tracking must not be frozen into React state.
 * Field names stay snake_case because they are the wire names.
 *
 * `version` carries the optimistic-concurrency token: a story round-tripped through a
 * write must keep the value the server returned, or the next write is rejected.
 * `new` is a transient client-side flag, which is why it is the one optional field.
 */
export interface UserStory {
    readonly id: number;

    readonly ref: number;

    readonly subject: string;

    readonly status: number;

    readonly swimlane: number | null;

    readonly milestone: number | null;

    readonly project: number;

    readonly is_blocked: boolean;

    readonly blocked_note: string;

    readonly is_closed: boolean;

    readonly is_iocaine: boolean;

    readonly due_date: string | null;

    readonly total_points: number | null;

    readonly points: Readonly<Record<string, number | null>>;

    readonly tags: readonly Tag[];

    readonly epics: readonly Epic[] | null;

    readonly assigned_users: readonly number[];

    readonly assigned_to: number | null;

    readonly kanban_order: number;

    readonly backlog_order: number;

    readonly total_attachments: number;

    readonly total_comments: number;

    readonly attachments: readonly { readonly thumbnail_card_url: string | null }[];

    readonly tasks: readonly { readonly id: number; readonly is_closed: boolean }[];

    readonly watchers: readonly unknown[];

    readonly version: number;

    readonly new?: boolean;
}
