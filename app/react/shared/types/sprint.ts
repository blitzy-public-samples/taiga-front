/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { UserStory } from './userStory';

/**
 * `user_stories` is the one NESTED case at the AngularJS boundary: the nested stories
 * arrive as their own model instances, and the flattening that unwraps a sprint is
 * shallow, so they have to be flattened in their own right before a sprint typed here
 * is trusted to be plain data.
 *
 * `version` carries the optimistic-concurrency token, so a sprint round-tripped
 * through a write must keep the value the server returned.
 */
export interface Sprint {
    readonly id: number;

    readonly name: string;

    readonly slug: string;

    readonly closed: boolean;

    readonly closed_points: number | null;

    readonly total_points: number | null;

    readonly estimated_start: string;

    readonly estimated_finish: string;

    readonly user_stories: readonly UserStory[];

    readonly version: number;
}
