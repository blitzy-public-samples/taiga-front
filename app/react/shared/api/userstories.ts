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
    HttpHeadersGetter,
    ResourceParams,
    TaigaModel,
    UserStoryValueCollection,
} from '../../bridge/useAngularService';
import type { Status } from '../types/status';
import type { UserStory } from '../types/userStory';

type UserstoriesResource = AngularServices['$tgResources']['userstories'];

/* ==========================================================================
 * THE MEMBER VIEWS THE TRANSPORT-BACKED FACADES CONSUME
 *
 * ⭐ T9 -- WHY A VIEW RATHER THAN THE MEMBER ITSELF. Every transport-backed
 * member of the frozen namespace is GENERIC over the shape it hands back:
 * `getByRef<TAttrs>` yields a model of whatever attribute shape the caller asks
 * for, `filtersData<TFilters>` yields whatever body shape the caller declares,
 * and the four writes yield whatever result shape the caller declares. A facade
 * settles exactly one of those type arguments and then needs nothing else from
 * the member, so each view below:
 *
 *   - takes its PARAMETER LIST straight from the bridge's declaration, via
 *     `Parameters<>` of the frozen member, so a signature change in the bridge
 *     still breaks compilation here rather than drifting silently; and
 *   - pins the RETURN to the single instantiation the facade uses.
 *
 * The frozen generic member satisfies its view -- a generic signature is
 * assignable to every instantiation of itself -- so passing the live namespace
 * still type-checks at every real call site. Pinning the return additionally
 * keeps each view inhabitable by an ORDINARY, non-generic function, which is
 * what lets the unit tests hand in a structural recording double with no escape
 * hatch: no `unknown`-to-target conversion, no suppression comment. Nothing here
 * changes a single value that reaches the wire; these are descriptions of the
 * frozen surface, narrowed to the slice each facade touches.
 * ========================================================================== */

/** `:27-37` as {@link getUserStoryByRef} uses it: one story, as a model. */
interface GetByRefMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['getByRef']>): AngularPromise<TaigaModel<TAttrs>>;
}

interface ListAllMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['listAll']>): AngularPromise<
        Array<TaigaModel<TAttrs>>
    >;
}

interface ListUnassignedMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['listUnassigned']>): AngularPromise<
        [Array<TaigaModel<TAttrs>>, HttpHeadersGetter]
    >;
}

interface FiltersDataMember<TFilters> {
    (...args: Parameters<UserstoriesResource['filtersData']>): AngularPromise<TFilters>;
}

interface BulkCreateMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkCreate']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

interface BulkUpdateBacklogOrderMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateBacklogOrder']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

interface BulkUpdateKanbanOrderMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateKanbanOrder']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

interface BulkUpdateMilestoneMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateMilestone']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

interface ListValuesMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['listValues']>): AngularPromise<
        Array<TaigaModel<TAttrs>>
    >;
}

/* ==========================================================================
 * THE FROZEN PAYLOAD SHAPES
 *
 * Each hazardous body key is written down EXACTLY ONCE, in this section, and
 * every declared member is then forwarded by the facade that owns it -- so
 * these are load-bearing descriptions of the wire contract, not decoration.
 * ========================================================================== */

/**
 * One estimation-point value, as the points collection returns it.
 *
 * A type alias rather than an interface so it carries an implicit index
 * signature and stays assignable to the generic parameter bag the resource layer
 * forwards. Shape taken from the project payload the two screens already read
 * (`app/coffee/modules/kanban/main.coffee` sorts `project.points` by `order`).
 */
type PointValue = {
    readonly id: number;
    readonly name: string;
    readonly value: number | null;
    readonly order: number;
};

interface OrderNeighbourBody {
    readonly after_userstory_id?: number;

    readonly before_userstory_id?: number;
}

interface BulkOrderRequestBody extends OrderNeighbourBody {
    readonly project_id: number;

    readonly bulk_userstories: number[];
}

interface BulkUpdateBacklogOrderRequestBody extends BulkOrderRequestBody {
    readonly milestone_id?: number;
}

interface BulkUpdateKanbanOrderRequestBody extends BulkOrderRequestBody {
    readonly status_id: number;

    readonly swimlane_id?: number;
}

type BulkCreateRequestBody = {
    readonly project_id: number;
    readonly status_id: number;
    readonly bulk_stories: string;
    readonly swimlane_id: number | null;
};

type BulkMilestoneEntry = {
    /** The story being moved. `snake_case` because it is the wire key. */
    readonly us_id: number;

    /**
     * That story's order within the destination sprint.
     *
     * ⭐ POSSIBLY UNDEFINED, AND DECLARED AS A UNION RATHER THAN AS AN OPTIONAL
     * MEMBER. Both incumbent construction sites read a member that may be absent --
     * `app/coffee/modules/backlog/main.coffee:505` reads a dynamic order member
     * defaulting to the backlog position, and `:797` reads `us.sprint_order`, which a
     * story sitting outside every sprint simply does not have -- yet BOTH ALWAYS EMIT
     * THE KEY. A union preserves that: a producer must state the absence explicitly
     * instead of silently omitting the key, because a body that dropped it would no
     * longer be the body the incumbent sends (G2). This matches the canonical
     * `BulkMilestoneItem` of `app/react/backlog/state/types.ts` member for member, so
     * the screen's own payload type can be handed to this facade unchanged; requiring
     * a number here made that impossible.
     */
    readonly order: number | undefined;
};

type BulkUpdateMilestoneRequestBody = {
    readonly project_id: number;
    readonly milestone_id: number | null;
    readonly bulk_stories: BulkMilestoneEntry[];
};

interface BulkOrderedUserStoryRow {
    readonly id: number;
    readonly milestone: number | null;
    readonly backlog_order: number;
}

interface UserstoriesFilterOption {
    readonly id: number | null;
    readonly name?: string;
    readonly full_name?: string;
    readonly ref?: number;
    readonly subject?: string;
    readonly color?: string;
    readonly count: number;
}

interface UserstoriesFiltersData {
    readonly statuses: readonly UserstoriesFilterOption[];
    readonly tags: readonly UserstoriesFilterOption[];
    readonly assigned_users: readonly UserstoriesFilterOption[];
    readonly assigned_to: readonly UserstoriesFilterOption[];
    readonly roles: readonly UserstoriesFilterOption[];
    readonly owners: readonly UserstoriesFilterOption[];
    readonly epics: readonly UserstoriesFilterOption[];
}

/**
 * The neighbour keys are an XOR in which AFTER WINS: supplying both sends only
 * `after_userstory_id`, and supplying neither omits both keys. These endpoints are
 * POSITION-RELATIVE rather than index-based, so an off-by-one in whoever computes the
 * neighbours persists a wrong order behind an HTTP 200. Encoded once, here, so the
 * rule cannot drift between the backlog and the board.
 */
function buildBulkOrderRequestBody(
    projectId: number,
    bulkUserstories: readonly number[],
    afterUserstoryId: number | null | undefined,
    beforeUserstoryId: number | null | undefined,
): BulkOrderRequestBody {
    const shared = {
        project_id: projectId,
        bulk_userstories: [...bulkUserstories],
    };

    if (afterUserstoryId) {
        return { ...shared, after_userstory_id: afterUserstoryId };
    }

    if (beforeUserstoryId) {
        return { ...shared, before_userstory_id: beforeUserstoryId };
    }

    return shared;
}

export async function getUserStoryByRef<TAttrs = UserStory>(
    userstories: { readonly getByRef: GetByRefMember<TAttrs> },
    projectId: number,
    ref: number,
    extraParams: ResourceParams = {},
): Promise<TaigaModel<TAttrs>> {
    return toNativePromise<TaigaModel<TAttrs>>(
        userstories.getByRef(projectId, ref, extraParams),
    );
}

export async function listAllUserstories<TAttrs = UserStory>(
    userstories: { readonly listAll: ListAllMember<TAttrs> },
    projectId: number,
    filters?: ResourceParams | null,
): Promise<Array<TaigaModel<TAttrs>>> {
    return toNativePromise<Array<TaigaModel<TAttrs>>>(
        userstories.listAll(projectId, filters ?? undefined),
    );
}

export async function listUnassignedUserstories<TAttrs = UserStory>(
    userstories: { readonly listUnassigned: ListUnassignedMember<TAttrs> },
    projectId: number,
    filters: ResourceParams | null,
    pageSize?: number,
    store: boolean = true,
): Promise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]> {
    return toNativePromise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]>(
        userstories.listUnassigned(projectId, filters ?? undefined, pageSize, store),
    );
}

export async function getUserstoriesFiltersData<TFilters = UserstoriesFiltersData>(
    userstories: { readonly filtersData: FiltersDataMember<TFilters> },
    params: ResourceParams,
): Promise<TFilters> {
    return toNativePromise<TFilters>(userstories.filtersData(params));
}

export async function bulkCreateUserstories<TResult = readonly UserStory[]>(
    userstories: { readonly bulkCreate: BulkCreateMember<TResult> },
    projectId: number,
    statusId: number,
    bulk: string,
    swimlaneId: number | null,
): Promise<AngularHttpResponse<TResult>> {
    const body: BulkCreateRequestBody = {
        project_id: projectId,
        status_id: statusId,
        bulk_stories: bulk,
        swimlane_id: swimlaneId,
    };

    return toNativePromise<AngularHttpResponse<TResult>>(
        userstories.bulkCreate(
            body.project_id,
            body.status_id,
            body.bulk_stories,
            body.swimlane_id,
        ),
    );
}

export async function bulkUpdateBacklogOrder<TResult = readonly BulkOrderedUserStoryRow[]>(
    userstories: { readonly bulkUpdateBacklogOrder: BulkUpdateBacklogOrderMember<TResult> },
    projectId: number,
    milestoneId: number | null | undefined,
    afterUserstoryId: number | null | undefined,
    beforeUserstoryId: number | null | undefined,
    bulkUserstories: readonly number[],
): Promise<AngularHttpResponse<TResult>> {
    const body: BulkUpdateBacklogOrderRequestBody = {
        ...buildBulkOrderRequestBody(
            projectId,
            bulkUserstories,
            afterUserstoryId,
            beforeUserstoryId,
        ),
        // Truthiness, not nullishness: a zero id OMITS the key entirely, which is the
        // frozen contract rather than an oversight to "improve" into a null check.
        ...(milestoneId ? { milestone_id: milestoneId } : {}),
    };

    return toNativePromise<AngularHttpResponse<TResult>>(
        userstories.bulkUpdateBacklogOrder(
            body.project_id,
            body.milestone_id ?? null,
            body.after_userstory_id ?? null,
            body.before_userstory_id ?? null,
            body.bulk_userstories,
        ),
    );
}

export async function bulkUpdateKanbanOrder<TResult = readonly BulkOrderedUserStoryRow[]>(
    userstories: { readonly bulkUpdateKanbanOrder: BulkUpdateKanbanOrderMember<TResult> },
    projectId: number,
    statusId: number,
    swimlaneId: number | null | undefined,
    afterUserstoryId: number | null | undefined,
    beforeUserstoryId: number | null | undefined,
    bulkUserstories: readonly number[],
): Promise<AngularHttpResponse<TResult>> {
    const body: BulkUpdateKanbanOrderRequestBody = {
        ...buildBulkOrderRequestBody(
            projectId,
            bulkUserstories,
            afterUserstoryId,
            beforeUserstoryId,
        ),
        status_id: statusId,
        ...(swimlaneId ? { swimlane_id: swimlaneId } : {}),
    };

    return toNativePromise<AngularHttpResponse<TResult>>(
        userstories.bulkUpdateKanbanOrder(
            body.project_id,
            body.status_id,
            body.swimlane_id ?? null,
            body.after_userstory_id ?? null,
            body.before_userstory_id ?? null,
            body.bulk_userstories,
        ),
    );
}

export async function bulkUpdateMilestone<TResult = unknown>(
    userstories: { readonly bulkUpdateMilestone: BulkUpdateMilestoneMember<TResult> },
    projectId: number,
    milestoneId: number | null,
    data: readonly BulkMilestoneEntry[],
): Promise<AngularHttpResponse<TResult>> {
    const body: BulkUpdateMilestoneRequestBody = {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: [...data],
    };

    return toNativePromise<AngularHttpResponse<TResult>>(
        userstories.bulkUpdateMilestone(
            body.project_id,
            body.milestone_id,
            body.bulk_stories,
        ),
    );
}

export async function listUserstoryValues<TAttrs = Status | PointValue>(
    userstories: { readonly listValues: ListValuesMember<TAttrs> },
    projectId: number,
    type: UserStoryValueCollection,
): Promise<Array<TaigaModel<TAttrs>>> {
    return toNativePromise<Array<TaigaModel<TAttrs>>>(
        userstories.listValues(projectId, type),
    );
}

/**
 * From here down the facades are SYNCHRONOUS: the underlying members read and write
 * local storage and return directly, so nothing is awaited or marshalled.
 */
export function storeUserstoriesQueryParams(
    userstories: Pick<UserstoriesResource, 'storeQueryParams'>,
    projectId: number,
    params: ResourceParams,
): void {
    userstories.storeQueryParams(projectId, params);
}

export function getUserstoriesQueryParams(
    userstories: Pick<UserstoriesResource, 'getQueryParams'>,
    projectId: number,
): ResourceParams {
    return userstories.getQueryParams(projectId);
}

export function storeBacklogIds(
    userstories: Pick<UserstoriesResource, 'storeBacklog'>,
    projectId: number,
    refs: readonly number[],
): void {
    userstories.storeBacklog(projectId, [...refs]);
}

export function getBacklogIds(
    userstories: Pick<UserstoriesResource, 'getBacklog'>,
    projectId: number,
): readonly number[] {
    return userstories.getBacklog(projectId);
}

export function storeShowTags(
    userstories: Pick<UserstoriesResource, 'storeShowTags'>,
    projectId: number,
    showTags: boolean,
): void {
    userstories.storeShowTags(projectId, showTags);
}

export function getShowTags(
    userstories: Pick<UserstoriesResource, 'getShowTags'>,
    projectId: number,
): boolean | null {
    return userstories.getShowTags(projectId);
}
