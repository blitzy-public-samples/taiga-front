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
     * ⛔⛔ REQUIRED, AND AN INTEGER. The endpoint validates each entry with
     * `_UserStoryMilestoneBulkValidator`, whose `order` is a plain
     * `IntegerField()` with no `required=False`
     * (`taiga/projects/userstories/validators.py` and the identical declaration in
     * `taiga/projects/milestones/validators.py`). An absent or `undefined` order is
     * therefore an HTTP 400 for the WHOLE request, not a defaulted value.
     *
     * ⭐ WHY THIS IS NOT `number | undefined`, EVEN THOUGH THE INCUMBENT CAN EMIT
     * `undefined`. `app/coffee/modules/backlog/main.coffee:513` reads a dynamic
     * order member and `:831` reads `us.sprint_order`, which a story sitting
     * outside every sprint does not have — so the incumbent really can build
     * `{us_id, order: undefined}`, and `angular.toJson` then DROPS the key
     * entirely, producing exactly the request the validator rejects. That is a
     * latent defect in the incumbent, not a contract to preserve: reproducing it in
     * the type would let the compiler bless a call that cannot succeed, which is
     * the opposite of what a typed facade is for. Callers narrow or compute the
     * order before invoking — `BulkMilestoneItem` in
     * `app/react/backlog/state/types.ts` declares the same required member, so the
     * screen's own payload type is still handed to this facade unchanged.
     */
    readonly order: number;
};

type BulkUpdateMilestoneRequestBody = {
    readonly project_id: number;
    /**
     * ⛔ REQUIRED. `UpdateMilestoneBulkValidator.milestone_id` is a mandatory
     * `IntegerField()` and the view resolves it with `get_object_or_error`
     * unconditionally, so `null` is a validation error rather than an "unassign".
     * Not to be confused with `bulkUpdateBacklogOrder`'s `milestone_id`, which
     * genuinely is `required=False`.
     */
    readonly milestone_id: number;
    readonly bulk_stories: BulkMilestoneEntry[];
};

/* --------------------------------------------------------------------------
 * THE THREE ORDER-WRITE RESULT ROWS
 *
 * ⛔⛔ THE TWO ORDER ENDPOINTS RETURN THREE DIFFERENT ROW SHAPES, NOT ONE, and
 * which one arrives depends on the REQUEST rather than on the endpoint alone.
 * Both `bulk_update_backlog_order` and `bulk_update_kanban_order` answer HTTP 200
 * with a list of the rows they renumbered, and each row is built by a distinct
 * generator expression in `taiga/projects/userstories/services.py`:
 *
 *   1. BACKLOG -- `update_userstories_backlog_or_sprint_order_in_bulk` with NO
 *      milestone. `order_param` stays `"backlog_order"`, so the row is
 *      `{id, milestone, backlog_order}` with `milestone` null.
 *   2. SPRINT -- the SAME function WITH a milestone. `order_param` becomes
 *      `"sprint_order"`, so the row is `{id, milestone, sprint_order}` and there
 *      is NO `backlog_order` member at all.
 *   3. KANBAN -- `update_userstories_kanban_order_in_bulk`, whose row is
 *      `{id, swimlane, status, kanban_order}`: no `milestone`, and two members the
 *      other two rows never carry.
 *
 * Describing all three with one type promised every caller a `backlog_order` that
 * is simply absent from two of the three responses, and hid `status`/`swimlane`
 * from the one that does return them. A caller reading `row.backlog_order` after
 * a sprint reorder gets `undefined` behind an HTTP 200 -- no error, no rejection,
 * and the failure surfaces later as an ordering computed from nothing.
 *
 * ⭐ THESE THREE ARE EXPORTED, WHICH IS A DELIBERATE EXCEPTION TO THIS FILE'S
 * "raw response shapes stay private" CONVENTION. The exception is not cosmetic: the
 * frozen resource member is itself generic with `TResult = unknown`, so passing the
 * LIVE namespace makes TypeScript infer `unknown` and the facade's own default is
 * never reached. A caller therefore has to NAME the shape it expects -- and if the
 * only correct names are private, the caller writes its own, which is precisely how
 * three responses came to share one wrong description. Exporting them makes the
 * right name reachable and makes drift a compile error at every call site.
 * -------------------------------------------------------------------------- */

/** Row 1: a backlog reorder, i.e. no milestone in the request. */
export interface BacklogOrderedUserStoryRow {
    readonly id: number;
    readonly milestone: null;
    readonly backlog_order: number;
}

/** Row 2: a sprint reorder, i.e. a milestone WAS supplied. */
export interface SprintOrderedUserStoryRow {
    readonly id: number;
    readonly milestone: number;
    readonly sprint_order: number;
}

/**
 * Rows 1 and 2 as `bulkUpdateBacklogOrder` can actually answer them.
 *
 * A DISCRIMINATED union on `milestone`: a null narrows to the backlog row and a
 * number to the sprint row, so `row.milestone === null ? row.backlog_order :
 * row.sprint_order` type-checks and reading the wrong member does not. This is the
 * honest description for that facade, because one call site sends a milestone and
 * another does not -- so which branch arrives is a property of the REQUEST, and the
 * caller is the only party that knows which one it made.
 */
export type BacklogOrSprintOrderedUserStoryRow =
    | BacklogOrderedUserStoryRow
    | SprintOrderedUserStoryRow;

/** Row 3: a Kanban reorder. Carries `status` and `swimlane`, never `milestone`. */
export interface KanbanOrderedUserStoryRow {
    readonly id: number;
    readonly swimlane: number | null;
    readonly status: number;
    readonly kanban_order: number;
}

/* --------------------------------------------------------------------------
 * THE SEVEN FILTER CATEGORIES
 *
 * ⛔ EACH CATEGORY HAS ITS OWN SHAPE, and three of the differences are load-bearing
 * rather than cosmetic. Every row below is built by a named helper in
 * `taiga/projects/userstories/services.py` and assembled by
 * `get_userstories_filters_data`:
 *
 *   - `tags` rows carry NO `id` at all -- they are keyed by `name`, because a tag
 *     is a name/colour pair on the project rather than a row with a primary key.
 *     Declaring an optional `id` invited a caller to key a list on `tag.id`, which
 *     is `undefined` for every tag and therefore the same key for all of them.
 *   - `epics` includes a SYNTHETIC "no epic" row whose `id`, `ref` AND `subject`
 *     are all null, inserted so the filter can offer "stories with no epic". A
 *     caller that assumed `subject` was a string would render "undefined".
 *   - `roles` always sends `color: null` -- the column is selected as a literal
 *     null, not omitted -- so the member is present and always null.
 *
 * Optionality is therefore expressed per category instead of by one union with
 * everything optional, which described a row no endpoint ever sends.
 *
 * ⭐ EXPORTED for the same reason as the three order rows above: the frozen
 * `filtersData` member is generic with `TFilters = unknown`, so a caller passing the
 * live namespace has to name the shape it expects, and the right name must therefore
 * be reachable.
 * -------------------------------------------------------------------------- */

/** A status row. `color` is `NOT NULL DEFAULT '#999999'` on the model. */
export interface UserstoriesStatusFilterOption {
    readonly id: number;
    readonly name: string;
    readonly color: string;
    readonly order: number;
    readonly count: number;
}

/**
 * A user row, shared by `assigned_to`, `assigned_users` and `owners`.
 *
 * `id` is nullable and `full_name` is `full_name or username or ""`, so it is
 * always a string and is `""` for the unassigned row. `assigned_to` always
 * includes that null row (appended when the query did not produce one); the other
 * two include only rows with a non-zero count, so they may omit it.
 */
export interface UserstoriesUserFilterOption {
    readonly id: number | null;
    readonly full_name: string;
    readonly count: number;
    readonly photo: string | null;
    readonly big_photo: string | null;
    readonly gravatar_id: string | null;
}

/** A tag row. Keyed by `name`; there is deliberately no `id`. */
export interface UserstoriesTagFilterOption {
    readonly name: string;
    readonly color: string | null;
    readonly count: number;
}

/** An epic row. All three identity members are null on the synthetic "no epic" row. */
export interface UserstoriesEpicFilterOption {
    readonly id: number | null;
    readonly ref: number | null;
    readonly subject: string | null;
    readonly order: number;
    readonly count: number;
}

/** A role row. `color` is selected as a literal null. */
export interface UserstoriesRoleFilterOption {
    readonly id: number;
    readonly name: string;
    readonly color: null;
    readonly order: number;
    readonly count: number;
}

export interface UserstoriesFiltersData {
    readonly statuses: readonly UserstoriesStatusFilterOption[];
    readonly tags: readonly UserstoriesTagFilterOption[];
    readonly assigned_users: readonly UserstoriesUserFilterOption[];
    readonly assigned_to: readonly UserstoriesUserFilterOption[];
    readonly roles: readonly UserstoriesRoleFilterOption[];
    readonly owners: readonly UserstoriesUserFilterOption[];
    readonly epics: readonly UserstoriesEpicFilterOption[];
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

/**
 * Reorders stories within the backlog, or within one sprint.
 *
 * ⛔ THE RESULT SHAPE DEPENDS ON `milestoneId`. Supply one and the server
 * renumbers `sprint_order` and answers `{id, milestone, sprint_order}`; omit it and
 * it renumbers `backlog_order` and answers `{id, milestone, backlog_order}`. The
 * default result type is therefore a union DISCRIMINATED on `milestone`, so a
 * caller narrows before reading an order member instead of reading one that is
 * absent. See {@link BacklogOrSprintOrderedUserStoryRow}.
 */
export async function bulkUpdateBacklogOrder<
    TResult = readonly BacklogOrSprintOrderedUserStoryRow[],
>(
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

/**
 * Reorders stories within one status cell of the board.
 *
 * ⛔ ITS RESULT IS A THIRD SHAPE, unrelated to the backlog one:
 * `{id, swimlane, status, kanban_order}`. There is no `milestone` and no
 * `backlog_order`, and the two members it does add — `status` and `swimlane` — are
 * the authoritative destination the server settled on, which is what makes the row
 * worth reading rather than discarding. See {@link KanbanOrderedUserStoryRow}.
 */
export async function bulkUpdateKanbanOrder<TResult = readonly KanbanOrderedUserStoryRow[]>(
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

/**
 * Reassigns a set of stories to ONE sprint, in a single request.
 *
 * ⛔ `milestoneId` IS REQUIRED AND NON-NULL, and every entry's `order` is a
 * required integer — both are mandatory `IntegerField()`s on the endpoint's
 * validator, so a `null` destination or a dropped `order` is an HTTP 400 for the
 * whole request rather than a defaulted value. See {@link BulkMilestoneEntry} for
 * why the incumbent's ability to emit `undefined` is a defect this facade declines
 * to bless.
 */
export async function bulkUpdateMilestone<TResult = unknown>(
    userstories: { readonly bulkUpdateMilestone: BulkUpdateMilestoneMember<TResult> },
    projectId: number,
    milestoneId: number,
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
