/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { toNativePromise } from '../../bridge/toNativePromise';
import type {
    AngularHttpResponse,
    AngularPromise,
    AngularServices,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { Sprint } from '../types/sprint';
import type { UserStory } from '../types/userStory';

/* ==========================================================================
 * THE SERVICE SURFACE
 * ========================================================================== */

/**
 * The `sprints` sub-resource, as the bridge types it.
 *
 * Obtained by INDEXING the imported service map rather than redeclared, so this
 * file never owns a second, divergent description of the same object. All four
 * members the facades below use -- `list`, `get`, `stats` and
 * `moveUserStoriesMilestone` -- arrive through this one alias. Section 5 of the
 * file header records why three of them once lived here instead, and why that was
 * a defect rather than a style choice.
 */
type SprintsResource = AngularServices['$tgResources']['sprints'];

/* ==========================================================================
 * THE FROZEN PAYLOAD SHAPES
 * ========================================================================== */

/**
 * The attribute shape a sprint MODEL wraps, as it actually arrives.
 *
 * ⭐⭐ T9 / P-IMMER-1, ENCODED IN THE TYPE RATHER THAN ONLY IN PROSE. This is the
 * domain sprint with ONE field re-typed: `user_stories` holds MODEL INSTANCES,
 * not plain stories, because the incumbent re-wraps every nested story and writes
 * the result into the private attribute slot (`sprints.coffee:18-20` for a single
 * sprint, `:33-36` once per milestone in the list).
 *
 * So flattening a sprint with `getAttrs()` yields a value whose `user_stories`
 * is STILL an array of models -- the second level of the hazard described in
 * section 6 of the file header. Re-typing the field here means the compiler says
 * so at every call site: a caller that treats an element as a plain story gets a
 * type error instead of a structure the state library cannot proxy.
 *
 * Everything else is the frozen domain shape, `../types/sprint` unchanged --
 * including the two `"YYYY-MM-DD"` date STRINGS, which stay strings.
 */
type SprintModelAttrs = Omit<Sprint, 'user_stories'> & {
    readonly user_stories: ReadonlyArray<TaigaModel<UserStory>>;
};

interface SprintListEnvelope<TAttrs> {
    readonly milestones: ReadonlyArray<TaigaModel<TAttrs>>;

    readonly closed: number;

    readonly open: number;
}

interface SprintStatsResponse {
    readonly total_points: Readonly<Record<string, number>>;

    readonly completed_points: Readonly<Record<string, number>>;

    readonly total_tasks: number;

    readonly completed_tasks: number;
}

type MoveUserStoriesEntry = {
    readonly us_id: number;

    readonly order: number;
};

interface GetMember<TAttrs> {
    (...args: Parameters<SprintsResource['get']>): AngularPromise<TaigaModel<TAttrs>>;
}

interface StatsMember<TStats> {
    (...args: Parameters<SprintsResource['stats']>): AngularPromise<TStats>;
}

interface ListMember<TAttrs> {
    (...args: Parameters<SprintsResource['list']>): AngularPromise<SprintListEnvelope<TAttrs>>;
}

interface MoveUserStoriesMilestoneMember<TResult> {
    (
        ...args: Parameters<SprintsResource['moveUserStoriesMilestone']>
    ): AngularPromise<AngularHttpResponse<TResult>>;
}

export async function getSprint<TAttrs = SprintModelAttrs>(
    sprints: { readonly get: GetMember<TAttrs> },
    _projectId: number,
    sprintId: number,
): Promise<TaigaModel<TAttrs>> {
    return toNativePromise<TaigaModel<TAttrs>>(sprints.get(_projectId, sprintId));
}

export async function getSprintStats<TStats = SprintStatsResponse>(
    sprints: { readonly stats: StatsMember<TStats> },
    _projectId: number,
    sprintId: number,
): Promise<TStats> {
    return toNativePromise<TStats>(sprints.stats(_projectId, sprintId));
}

/**
 * Resolves to an ENVELOPE, not a bare list: the milestones arrive alongside the open
 * and closed counts, and each milestone's `user_stories` are themselves models, so a
 * sprint needs flattening in two levels before it is plain data.
 */
export async function listSprints<TAttrs = SprintModelAttrs>(
    sprints: { readonly list: ListMember<TAttrs> },
    projectId: number,
    filters?: ResourceParams | null,
): Promise<SprintListEnvelope<TAttrs>> {
    return toNativePromise<SprintListEnvelope<TAttrs>>(
        sprints.list(projectId, filters ?? undefined),
    );
}

/**
 * Moves open user stories out of one sprint and into another.
 *
 * ⛔⛔ T9 -- THE ARGUMENT-TRANSPOSITION HAZARD. THIS IS THE MOST DANGEROUS CALL IN
 * THE FILE. Two sprint ids sit in the same signature and they are NOT
 * interchangeable:
 *
 *   - `sourceMilestoneId` is the sprint the stories are LEAVING. It is the id the
 *     incumbent feeds to the named-URL registry at `sprints.coffee:45`, so it ends
 *     up IN THE URL PATH -- the frozen registry entry is
 *     `move-userstories-to-milestone`, whose template is
 *     `/milestones/%s/move_userstories_to_sprint`
 *     (`app/coffee/modules/resources.coffee:93`).
 *   - `destinationMilestoneId` is the sprint the stories are ARRIVING at. It goes
 *     IN THE REQUEST BODY, as the milestone id (`sprints.coffee:46`).
 *
 * Swap them and the request still succeeds: the stories are simply moved to the
 * WRONG SPRINT, under HTTP 200, with no error, no toast and no console warning.
 * The parameters are therefore named for their ROLE rather than their position,
 * while the positional order is preserved EXACTLY as the frozen signature declares
 * it. The verified call order is
 * `app/modules/components/move-to-sprint/move-to-sprint-lb/move-to-sprint-lb.controller.coffee:93-98`:
 * source sprint, project, selected destination, then the stories.
 *
 * ⛔ T9 -- THE BODY KEY IS `bulk_stories`, and it is NOT `bulk_userstories`.
 * The latter belongs exclusively to the two story-ORDERING endpoints faceted in
 * the sibling user-story module, and conflating the two is a SILENT HTTP 400. The
 * key is encoded by the incumbent at `sprints.coffee:46`, so this facade forwards
 * positional arguments and never spells a body key itself -- which is also why the
 * key appears exactly once in this file, on the line above, as documentation.
 *
 * ⭐ T9 -- THE SIBLING MOVE MEMBERS ARE DELIBERATELY NOT FACETED. The same
 * provider also exposes `moveTasksMilestone` (`sprints.coffee:49-52`) and
 * `moveIssuesMilestone` (`:54-57`), which differ only in their own body key. Tasks
 * and issues belong to the out-of-scope taskboard and issues screens, so only the
 * user-story variant is faceted here. Needing one of the others would be a
 * reviewed edit, not an accident.
 *
 * ⭐ T9 -- the destination is typed as nullable because the incumbent lightbox
 * initialises it to nothing (`move-to-sprint-lb.controller.coffee:36`) and gates
 * its submit control on the value being set (`move-to-sprint-lb.jade:79`), so the
 * gate lives in the UI. This facade adds NO validation of its own: guarding here
 * would be behaviour the incumbent does not have (T10).
 *
 * ⭐ T10 -- STATELESS, deliberately. Rapid consecutive drags are serialised by the
 * backlog's own queue and re-entrancy guard, not here; section 7 of the file header
 * names the locators. This function neither de-duplicates nor defers.
 *
 * The story entries are copied into a fresh array purely so a readonly input
 * satisfies the frozen signature; their contents are forwarded untouched, order
 * field included ({@link MoveUserStoriesEntry}).
 *
 * @typeParam TResult - parsed response body.
 * @param sprints - the live resource namespace, narrowed to the member used. It
 *   the bridge declares it (section 5).
 * @param sourceMilestoneId - the sprint being moved OUT OF; lands in the URL path.
 * @param projectId - owning project.
 * @param destinationMilestoneId - the sprint being moved INTO; lands in the body.
 * @param userStories - the stories to move, each an id plus its sprint order.
 * @returns the full response, whose `data` holds the server's reply.
 */
export async function moveUserStoriesToMilestone<TResult = unknown>(
    sprints: { readonly moveUserStoriesMilestone: MoveUserStoriesMilestoneMember<TResult> },
    sourceMilestoneId: number,
    projectId: number,
    destinationMilestoneId: number | null,
    userStories: readonly MoveUserStoriesEntry[],
): Promise<AngularHttpResponse<TResult>> {
    return toNativePromise<AngularHttpResponse<TResult>>(
        sprints.moveUserStoriesMilestone(
            sourceMilestoneId,
            projectId,
            destinationMilestoneId,
            [...userStories],
        ),
    );
}
