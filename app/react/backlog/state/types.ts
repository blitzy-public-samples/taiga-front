/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { UserStory } from '../../shared/types/userStory';

// Hyphenated and snake_case members are the wire spelling and are quoted rather than
// renamed: these objects are handed to the chart and to the API untranslated, so a
// camelCase alias would simply not be found at either end.
export interface BurndownMilestone {
    readonly name: string;
    readonly optimal: number;
    readonly evolution: number | null;
    readonly 'team-increment': number;
    readonly 'client-increment': number;
}

export interface ProjectStats {
    readonly assigned_points: number;
    readonly closed_points: number;
    readonly completedPercentage: number;
    readonly defined_points: number;
    readonly milestones: readonly BurndownMilestone[];
    readonly speed: number;
    readonly total_milestones: number | null;
    readonly total_points: number | null;
}

export type BacklogUserStory = UserStory & { readonly sprint_order?: number };

export interface ProjectRole {
    readonly id: number;
    readonly name: string;
    readonly computable: boolean;
}

export interface ProjectPoint {
    readonly id: number;
    readonly name: string;
    readonly value: number | null;
}

export type PointsById = Readonly<Record<number, ProjectPoint | undefined>>;

/**
 * One entry of a `bulk-update-us-milestone` / `move_userstories_to_sprint` body.
 *
 * ⛔ BOTH MEMBERS ARE REQUIRED INTEGERS, because the backend validator says so:
 * `_UserStoryMilestoneBulkValidator` declares `us_id = IntegerField()` and
 * `order = IntegerField()`, neither with `required=False`, so an absent or
 * `undefined` order is an HTTP 400 for the whole request rather than a defaulted
 * value.
 *
 * ⭐ The incumbent CAN emit `{us_id, order: undefined}` --
 * `app/coffee/modules/backlog/main.coffee:513` reads a dynamic order member and
 * `:831` reads `us.sprint_order`, which a story outside every sprint does not
 * have -- and `angular.toJson` then drops the key, producing exactly the request
 * the validator rejects. That is a latent defect in the incumbent, not a contract
 * to reproduce: typing `order` as optional would let the compiler bless a call
 * that cannot succeed. Producers compute or narrow the order first.
 */
export interface BulkMilestoneItem {
    readonly us_id: number;
    readonly order: number;
}

export type SelectedRoleId = string | number | null;
