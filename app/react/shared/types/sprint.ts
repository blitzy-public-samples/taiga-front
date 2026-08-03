/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Epic } from './epic';

/**
 * A story as it arrives NESTED INSIDE a sprint, which is a strictly smaller shape
 * than a story from the story list.
 *
 * ⛔⛔ THIS IS NOT A `UserStory`, AND TREATING IT AS ONE IS THE DEFECT THIS TYPE
 * EXISTS TO CLOSE. A sprint's `user_stories` are rendered by
 * `UserStoryNestedSerializer`, while the backlog's own rows come from
 * `UserStoryListSerializer`. The nested serializer OMITS, among others:
 *
 *     tags · assigned_users · owner · tasks · swimlane · total_attachments
 *     total_comments · attachments · watchers · epic_order · milestone_slug
 *     milestone_name · generated_from_issue · generated_from_task · from_task_ref
 *     tribe_gig · comment · origin_issue · origin_task
 *
 * Every one of those is REQUIRED on `UserStory`, so declaring the nested stories as
 * full stories promised nineteen members that are simply absent from the response.
 * A component reading `story.tags` off a sprint row gets `undefined` and renders
 * nothing — no error, no warning — and `story.tags.map(...)` throws instead.
 *
 * The members below are exactly the nested serializer's, in its own order:
 * its own declared fields, then its three method fields, then the four mixins it
 * composes (project / status / assigned-to extra info, and the due-date trio).
 */
export interface NestedSprintUserStory {
    readonly id: number;

    readonly ref: number;

    /** `attr="milestone_id"`. Always this sprint's id when nested inside one. */
    readonly milestone: number | null;

    /** `attr="project_id"`, from the project extra-info mixin. */
    readonly project: number;

    readonly project_extra_info: {
        readonly id: number;
        readonly name: string;
        readonly slug: string;
        readonly logo_small_url: string | null;
    } | null;

    readonly is_closed: boolean;

    readonly created_date: string;

    readonly modified_date: string;

    readonly finish_date: string | null;

    readonly subject: string;

    readonly client_requirement: boolean;

    readonly team_requirement: boolean;

    readonly external_reference: readonly string[] | null;

    /**
     * The optimistic-concurrency token. Present on the NESTED story even though it
     * is absent from the milestone that carries it, which is why the two must not
     * share one notion of "has a version".
     */
    readonly version: number;

    readonly is_blocked: boolean;

    readonly blocked_note: string;

    readonly backlog_order: number;

    readonly sprint_order: number;

    readonly kanban_order: number;

    /** `epics_attr`: null when the story belongs to no epic. */
    readonly epics: readonly Epic[] | null;

    /** `role_points_attr`, keyed by role id; `{}` when there are none. */
    readonly points: Readonly<Record<string, number | null>>;

    /** `total_points_attr`: a SUM, null when no role points are set. */
    readonly total_points: number | null;

    /** `attr="status_id"`, from the status extra-info mixin. */
    readonly status: number;

    readonly status_extra_info: {
        readonly name: string;
        readonly color: string;
        readonly is_closed: boolean;
    } | null;

    /** `attr="assigned_to_id"`, from the assigned-to extra-info mixin. */
    readonly assigned_to: number | null;

    readonly assigned_to_extra_info: {
        readonly id: number;
        readonly username: string;
        readonly full_name_display: string;
        readonly photo: string | null;
        readonly big_photo: string | null;
        readonly gravatar_id: string | null;
        readonly is_active: boolean;
    } | null;

    /** The three members of the due-date mixin, which travel together. */
    readonly due_date: string | null;

    readonly due_date_reason: string;

    readonly due_date_status:
        | 'not_set'
        | 'no_longer_applicable'
        | 'past_due'
        | 'due_soon'
        | 'set';
}

/**
 * A sprint (a "milestone" on the wire) as `MilestoneSerializer` renders it.
 *
 * ⛔ THERE IS NO `version`. The milestone serializer declares exactly: `id`, `name`,
 * `slug`, `owner`, `project`, `estimated_start`, `estimated_finish`,
 * `created_date`, `modified_date`, `closed`, `disponibility`, `order`,
 * `user_stories`, `total_points`, `closed_points`, plus `project_extra_info` from
 * its mixin. A `version` was declared here and does not exist in any response, so
 * a sprint round-tripped through a write would have carried `undefined` as its
 * optimistic-concurrency token — and the write would have been rejected or, worse,
 * have overwritten a concurrent edit. The nested STORIES do carry a `version`
 * ({@link NestedSprintUserStory}), which is exactly why the confusion was possible.
 *
 * ⭐ `user_stories` is the one NESTED case at the AngularJS boundary: the nested
 * stories arrive as their own model instances and the flattening that unwraps a
 * sprint is shallow, so they have to be flattened in their own right before a
 * sprint typed here is trusted to be plain data.
 *
 * ⭐ `total_points` and `closed_points` are SCALAR SUMS here, not role-keyed maps.
 * They come from `total_points_attr` / `closed_points_attr`, which are
 * `SUM(projects_points.value)` sub-selects, and are null when the sprint's stories
 * carry no role points. The identically-named members of the `/stats` response are
 * a different thing entirely — see `getSprintStats` in `../api/sprints`.
 */
export interface Sprint {
    readonly id: number;

    readonly name: string;

    readonly slug: string;

    readonly owner: number | null;

    readonly project: number;

    readonly closed: boolean;

    readonly disponibility: number | null;

    readonly order: number;

    readonly created_date: string;

    readonly modified_date: string;

    readonly closed_points: number | null;

    readonly total_points: number | null;

    readonly estimated_start: string;

    readonly estimated_finish: string;

    readonly user_stories: readonly NestedSprintUserStory[];
}
