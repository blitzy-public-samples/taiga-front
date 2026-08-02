/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * userstories.ts -- THE TYPED FACADE OVER THE `userstories` RESOURCE NAMESPACE
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file. Every statement
 * below is factual and carries the locator that proves it.
 *
 * --------------------------------------------------------------------------
 * 0. WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------------------------------------------------
 * Fifteen plain exported functions -- NINE backed by the shared transport and
 * SIX backed by browser storage -- each of which takes the live `userstories`
 * sub-resource service as its FIRST parameter and forwards to it.
 *
 * It holds NO React hook, NO component, NO module-level state and NO transport
 * of its own. The whole value of the file is that it is the ONE place where the
 * frozen wire contract of `app/coffee/modules/resources/userstories.coffee` is
 * written down in types, so that a mistake in that contract becomes a compile
 * error or a failing unit assertion here instead of silently wrong persisted
 * data in the browser.
 *
 * The service instance is passed IN rather than resolved here on purpose. The
 * screens' hooks (`../../kanban/hooks/useKanbanData.ts`, `useCardDrag.ts`,
 * `../../backlog/hooks/useBacklogData.ts`, `useStoryDrag.ts`) own the single
 * `useAngularService('$tgResources')` call and hand `rs.userstories` down.
 * Requirement I9, verbatim: "The >=70% coverage gate forces a
 * presentational/container split. Jest runs browserless in jsdom with no
 * `dist/` dependency, so data-fetching and drag effects must be isolated in
 * hooks and containers, leaving pure components independently testable."
 * A module of plain functions over an injected service is exactly what that
 * split needs: every function below is exercised with a two-line test double
 * and no injector, no provider and no browser.
 *
 * --------------------------------------------------------------------------
 * 1. THE GOVERNING CONSTRAINTS
 * --------------------------------------------------------------------------
 * T5, verbatim and the strongest of them: "Reuse `$tgResources`; do not build a
 * parallel HTTP client. New TypeScript files are typed facades over the
 * existing repository layer."
 *
 * G2 freezes the backend contract: `bulk-update-us-kanban-order`,
 * `bulk-update-us-backlog-order`, `bulk-update-us-milestone`, `bulk-create-us`,
 * `milestones` and `userstories-filters` are reused EXACTLY as resolved today
 * through the URL registry service. No endpoint, no URL, no request shape, no
 * query parameter, no body key and no response contract changes -- not one.
 * This file therefore never resolves a URL and never touches the URL registry
 * service; it delegates to the resource methods that already do.
 *
 * I7 explains why that matters beyond tidiness. Because every call keeps going
 * through the resource layer, React INHERITS rather than re-derives the
 * `Authorization` and `Accept-Language` headers
 * (`app/coffee/modules/base/http.coffee:17-30`, merged at `:33`, where the
 * service's own headers win over per-call ones), the session header applied to
 * delete/patch/post/put and the session-only header on GET
 * (`app/coffee/app.coffee:590-602`), the single-flight token refresh on 401, the
 * 400-carrying-`version` conflict toast shown for 10,000 ms, the 451 blocking
 * interceptor, the status-0 connection-error page, and the GET response cache
 * that de-duplicates concurrent identical reads (`http.coffee:42-45`). It also
 * inherits the dirty-tracking write path: the repository's `save()` PATCHes only
 * the changed fields plus the optimistic-concurrency `version`
 * (`base/model.coffee:48-54`, `base/repository.coffee:57-63`). A bespoke client
 * would serialise whole objects, turning every edit into a possible silent lost
 * update -- two users editing different fields of one story overwriting each
 * other with no error, no toast and no console warning.
 *
 * T10 admits NO functional and NO feature change of ANY kind. Concretely, and
 * these are prohibitions rather than preferences: no retry, no timeout, no
 * added caching, no request cancellation, no optimistic local write, no
 * response normalisation beyond typing, no id stringification, no sorting, no
 * "fixing" of a zero id into a sent key, no "cleaning up" of the literal
 * `"null"` string into a null, no collapsing of the pagination tuple, and no
 * sixteenth function.
 *
 * T8 keeps this file inside `app/react/**`. HR-11 and the Minimal Change Clause
 * keep it from touching a single line outside itself.
 *
 * --------------------------------------------------------------------------
 * 2. THE FROZEN URL REGISTRY -- QUOTED FOR TRACEABILITY, NEVER CONSTRUCTED
 * --------------------------------------------------------------------------
 * From `app/coffee/modules/resources.coffee`, so a reader can audit each
 * facade below against the endpoint it ultimately reaches:
 *
 *     :107  "userstories"                   -> /userstories
 *     :108  "bulk-create-us"                -> /userstories/bulk_create
 *     :109  "bulk-update-us-backlog-order"  -> /userstories/bulk_update_backlog_order
 *     :110  "bulk-update-us-milestone"      -> /userstories/bulk_update_milestone
 *     :111  "bulk-update-us-miles-order"    -> /userstories/bulk_update_sprint_order
 *     :112  "bulk-update-us-kanban-order"   -> /userstories/bulk_update_kanban_order
 *     :113  "userstories-filters"           -> /userstories/filters_data
 *     :77   "userstory-statuses"            -> /userstory-statuses
 *     :80   "points"                        -> /points
 *
 * The sprint-order entry at `:111` is listed only so its ABSENCE from this file
 * is visibly deliberate: neither in-scope screen calls it.
 *
 * These strings appear here, in a comment, and NOWHERE else in the file. They
 * are never concatenated, never interpolated and never passed to a call.
 *
 * --------------------------------------------------------------------------
 * 3. THE FOUR SILENT-FAILURE MODES THIS FILE EXISTS TO CONTAIN
 * --------------------------------------------------------------------------
 * All four fail COMPLETELY SILENTLY -- no exception, no toast, no console
 * warning -- and surface only on the next page load, as wrong persisted data.
 * Each one is therefore encoded in EXACTLY ONE place below and asserted
 * directly by the co-located spec.
 *
 * TRAP 1 -- `bulk_userstories` and `bulk_stories` are TWO DIFFERENT BODY KEYS.
 *   `bulk_userstories` belongs to the two ORDER endpoints
 *   (`resources/userstories.coffee:94` and `:117`).
 *   `bulk_stories` belongs to bulk creation (`:68`) and to the milestone move
 *   (`:109`).
 *   Conflating them is an HTTP 400 that the generic failure path swallows.
 *   Encoded once each: `bulk_userstories` in {@link buildBulkOrderRequestBody},
 *   `bulk_stories` once per endpoint that uses it.
 *
 * TRAP 2 -- the neighbour keys are an XOR in which AFTER WINS. The frozen shape
 *   is `if afterUserstoryId ... else if beforeUserstoryId ...`
 *   (`:99-103` for the backlog order, `:120-124` for the board order, byte-wise
 *   identical logic). BOTH supplied means ONLY `after_userstory_id` is sent;
 *   NEITHER supplied means NEITHER key appears. These endpoints are
 *   POSITION-RELATIVE, not index-based. Risk R-DND-2 spells out the cost: only
 *   the drag-and-drop core package is pinned and not its sortable companion, so
 *   ordering is computed manually from collision data, and combined with the
 *   position-relative write contract an off-by-one in that computation
 *   SILENTLY PERSISTS A WRONG ORDER behind an HTTP 200. Encoded once, in
 *   {@link buildBulkOrderRequestBody}.
 *
 * TRAP 3 -- the conditional keys test TRUTHINESS, not nullishness.
 *   `params.milestone_id = milestoneId if milestoneId` (`:96-97`) and
 *   `params.swimlane_id = swimlaneId if swimlaneId` (`:126-127`).
 *   A ZERO id therefore OMITS THE KEY ENTIRELY, and that is reproduced here
 *   rather than "improved" into a null check. By contrast `status_id` is ALWAYS
 *   sent by the board order endpoint (`:116`), `project_id` is ALWAYS sent by
 *   both order endpoints (`:94`, `:115`), and `swimlane_id` is ALWAYS sent by
 *   bulk creation (`:69`) -- three asymmetries that look like inconsistencies
 *   and are the frozen contract.
 *
 * TRAP 4 -- `milestone: "null"` is the literal STRING, not a null. Fetching the
 *   backlog sends `{"project": projectId, "milestone": "null"}` (`:46`), and the
 *   by-reference read DELETES BOTH `milestone` AND `no-milestone` when it sees
 *   that string (`:33-35`). The same string reaches the filters endpoint,
 *   because the backlog asks for its filters with that milestone value
 *   (`app/coffee/modules/controllerMixins.coffee:243-246`). It is a
 *   query-parameter convention owned by this folder -- never a domain value.
 *   The sibling domain type says so explicitly at
 *   `../types/userStory.ts` on its `milestone` member. Both behaviours are the
 *   resource layer's, reached by delegation, and neither is re-implemented
 *   here: the facades forward their parameters untouched precisely so the
 *   convention cannot drift.
 *
 * --------------------------------------------------------------------------
 * 4. THE ONE ASYMMETRY IN THIS FILE, AND WHY IT IS CORRECT
 * --------------------------------------------------------------------------
 * NINE facades are asynchronous and marshal their result through
 * `toNativePromise`. SIX are SYNCHRONOUS and must never become `async`.
 *
 * The resource layer's storage members are backed by a service whose reads and
 * writes are plain, immediate calls: `base/storage.coffee:17-25` returns the
 * parsed value directly and `:27-32` returns nothing. Two live call sites
 * depend on that being immediate rather than a promise:
 *
 *     app/coffee/modules/backlog/main.coffee:150   if @rs.userstories.getShowTags(...)
 *     app/coffee/modules/backlog/main.coffee:540   if @rs.userstories.getShowTags(...) == false
 *
 * A promise is ALWAYS truthy, so the first would stop discriminating; and a
 * promise is never loosely equal to `false`, so the second would never match.
 * Wrapping these six would be a behaviour change (T10), which is why the
 * asymmetry is deliberate and is documented at the point of change.
 *
 * --------------------------------------------------------------------------
 * 5. MODEL INSTANCES, PLAIN JSON, AND PITFALL P-IMMER-1
 * --------------------------------------------------------------------------
 * The facades resolve THREE different kinds of value, and the difference is
 * load-bearing:
 *
 *   - MODEL INSTANCES -- the by-reference read, both list reads and the values
 *     read. The repository wraps each row (`base/repository.coffee:143`, `:171`).
 *   - PLAIN PARSED JSON -- the filters read, because the repository's raw query
 *     returns the body itself (`base/repository.coffee:180`).
 *   - A FULL RESPONSE -- the four writes, because they post directly and their
 *     callers read `result.data` (`backlog/main.coffee:689`,
 *     `common/lightboxes.coffee:373`).
 *
 * P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns model
 * classes carrying dirty-tracking state; passing one into a draft produces
 * undefined behaviour. Convert to plain objects at the boundary."
 *
 * FLATTENING IS THE CALLER'S JOB, NOT THIS FACADE'S (T10). A model's attributes
 * are accessor properties installed over a private attribute bag
 * (`base/model.coffee` `initialize()`), and its dirty state lives in two further
 * private members that a shallow copy does not carry -- so a spread yields
 * something that looks like the data, has lost the change tracking, and can no
 * longer be handed back to the repository for a changed-fields-only write. The
 * sanctioned flattening step is `getAttrs()`, mirroring the house precedent at
 * `app/modules/components/project-menu/project-menu.controller.coffee:27` (the
 * AAP cites `:28`, which is that object literal's closing brace; a second
 * precedent sits at `:21`). Every model-returning facade below repeats this
 * warning at its own signature.
 *
 * The persistent-collection library is NEVER imported here (requirement I5: it
 * stays installed for its 124 out-of-scope consumers, and only 18 references
 * convert). Nothing below exposes a keyed getter or a size member; this file
 * lives firmly on the plain-object side of that boundary.
 *
 * --------------------------------------------------------------------------
 * 6. BEHAVIOUR THAT DELIBERATELY LIVES ELSEWHERE
 * --------------------------------------------------------------------------
 * THIS FACADE IS STATELESS. It holds no queue, no in-flight flag, no
 * de-duplication, no retry, no reconciliation and no broadcast.
 *
 * The drag serialisation queue is the highest-risk behaviour in the whole
 * migration and it belongs to the backlog side, not here:
 * `backlog/main.coffee` initialises `pendingDrag` in its constructor, enqueues
 * on a real user drag, guards re-entrancy with
 * `if ctx && @.pendingDrag.length > 1 then return` so a drag arriving while one
 * is in flight is QUEUED BUT NOT SENT, issues only the head of the queue,
 * reconciles the authoritative `milestone` and `backlog_order` from the
 * response back onto the local models, dequeues, re-drives the queue with a
 * null context so the re-drive neither re-enqueues nor trips the guard, and
 * otherwise broadcasts; when realtime is disconnected it reloads instead
 * (`main.coffee:676-712`). The React owners of that behaviour are
 * `../../backlog/state/backlogReducer.ts` and
 * `../../backlog/hooks/useStoryDrag.ts`. Implementing one line of it here would
 * double-implement the guard and violate T10.
 *
 * A NAME INVERSION worth knowing when reading the backlog controller against
 * this file: its `previousUs` is this file's `afterUserstoryId`, its `nextUs` is
 * `beforeUserstoryId`, and its `currentSprintId` is `milestoneId`.
 *
 * Permission gates are likewise READ, never recomputed. React reads the same
 * permission array the AngularJS permission directives read -- screen-level
 * board and backlog activation, action-level story and milestone rights, plus
 * the blocked and archived state restrictions -- so this file exposes no
 * permission helper and derives no policy of its own.
 *
 * --------------------------------------------------------------------------
 * 7. THE FIVE MEMBERS DELIBERATELY NOT FACADED
 * --------------------------------------------------------------------------
 * Recorded so that no later reader "completes" the facade and, in doing so,
 * introduces a request the incumbent never makes:
 *
 *   - `editStatus` -- a PATCH onto a status row on the ADMIN path
 *     (`resources/userstories.coffee:141-147`). Neither in-scope screen calls
 *     it. A sibling brief notes that its request shape "belongs to
 *     `app/react/shared/api/`"; that is a boundary marker meaning "not in the
 *     types folder", NOT a mandate that the facade exist.
 *   - `get` -- the story DETAIL read by id (`:19-25`). Both screens use the
 *     by-reference read instead (`kanban/main.coffee:379`, `:397`,
 *     `backlog/main.coffee:735`), and the detail screen is out of scope.
 *   - `listInAllProjects` -- the cross-project dashboard read (`:39-40`), out of
 *     scope.
 *   - `upvote`, `downvote`, `watch`, `unwatch` -- story DETAIL actions
 *     (`:76-90`), out of scope.
 *   - `createDefaultValues` -- an admin path (`:136-139`), out of scope.
 *
 * Adding either of these would breach the Minimal Change Clause.
 *
 * --------------------------------------------------------------------------
 * 8. THREE MEMBERS THE BRIDGE TYPE OMITS, AND HOW THAT IS HANDLED
 * --------------------------------------------------------------------------
 * `../../bridge/useAngularService.ts` types the resource namespace under a
 * MEMBERSHIP RULE -- a member is declared only when one of the two in-scope
 * modules calls it, or when it resolves one of the six frozen endpoints -- and
 * its own header records the members it therefore leaves out. Three of them are
 * ones this file is required to facade: the values read, the stored
 * query-parameter read and the stored backlog read.
 *
 * They exist at run time: the resource provider installs all fifteen members on
 * ONE object literal (`resources/userstories.coffee:131-134`, `:154-157`,
 * `:164-167`), which the run block then grafts onto the aggregate service. The
 * bridge is not this file's to edit, and widening its type is not this file's
 * call either, so the three are declared locally in
 * {@link UserstoriesResourceUndeclaredMembers} with this explanation attached.
 *
 * That is also why every parameter below is typed as the NARROWEST structural
 * slice the function actually touches rather than as one wide service type: a
 * caller holding the bridge's narrower resource type stays assignable to the
 * twelve facades whose members the bridge does declare. The three that need a
 * locally declared member are, not coincidentally, exactly the three with zero
 * in-scope callers today -- which is precisely why the bridge omitted them.
 *
 * --------------------------------------------------------------------------
 * 9. NOTES ON THE IMPORTS
 * --------------------------------------------------------------------------
 * There is no React import: this module contains no hook and no component, and
 * `noUnusedLocals: true` would reject one. Imports are relative because
 * `tsconfig.json` declares no base URL and no path aliases. `allowJs` is off,
 * so nothing under the untyped legacy script folder is reachable from here.
 *
 * The sibling tag and epic domain types are NOT imported. They reach this
 * module only transitively, as members of the story type
 * (`../types/userStory.ts` declares `tags` and `epics`), and
 * `noUnusedLocals: true` makes an unused import a COMPILE ERROR -- so importing
 * them "for completeness" would fail the type gate. The co-located spec does
 * import both, because its story fixtures construct those members explicitly.
 *
 * No colour literal appears anywhere in this file. Rule T2: status, tag and
 * epic colours are DATA, bound from the payload, and the values visible in the
 * design frames are seeded-sample artefacts that must never be hardcoded.
 * ========================================================================== */

import { toNativePromise } from '../../bridge/toNativePromise';
import type {
    AngularHttpResponse,
    AngularPromise,
    AngularServices,
    HttpHeadersGetter,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { Status } from '../types/status';
import type { UserStory } from '../types/userStory';

/* ==========================================================================
 * THE SERVICE SURFACE
 *
 * Derived from the bridge's own map rather than redeclared, so a rename there
 * breaks compilation here instead of letting two definitions drift apart.
 * ========================================================================== */

/**
 * The `userstories` sub-resource, as the bridge types it.
 *
 * Obtained by INDEXING the imported service map, which is what keeps this file
 * from owning a second, divergent description of the same object. The bridge
 * owns that map; this file only reads it.
 */
type UserstoriesResource = AngularServices['$tgResources']['userstories'];

/**
 * The three members the bridge's membership rule deliberately leaves out.
 *
 * See section 8 of the file header for the full argument. In short: all three
 * exist at run time -- the provider installs them on the same object literal as
 * every other member (`app/coffee/modules/resources/userstories.coffee:131-134`,
 * `:154-157`, `:164-167`) -- but no in-scope AngularJS module calls them, so the
 * bridge's "declare it only when a screen uses it" rule excludes them, and
 * `app/react/bridge/**` is not this file's to edit.
 *
 * Declared here so the three required facades stay fully typed with no escape
 * hatch, and kept to exactly those three members so nothing else can creep in.
 */
interface UserstoriesResourceUndeclaredMembers {
    /**
     * `:131-134`. Stores the query parameters, then lists a project-value
     * collection through the repository. See {@link listUserstoryValues} for why
     * this has no caller today.
     */
    listValues<TAttrs = Record<string, unknown>>(
        projectId: number,
        type: UserstoryValueCollection,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;

    /**
     * `:154-157`. SYNCHRONOUS read of the stored query parameters, defaulting to
     * an empty object when nothing has been stored.
     */
    getQueryParams(projectId: number): ResourceParams;

    /**
     * `:164-167`. SYNCHRONOUS read of the stored backlog ordering, defaulting to
     * an empty array when nothing has been stored.
     */
    getBacklog(projectId: number): number[];
}

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

/** `:57-62` as {@link listAllUserstories} uses it: a BARE array of models. */
interface ListAllMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['listAll']>): AngularPromise<
        Array<TaigaModel<TAttrs>>
    >;
}

/**
 * `:45-55` as {@link listUnassignedUserstories} uses it: the TWO-ELEMENT TUPLE
 * `[models, headersGetter]`, never a bare array -- pagination reads the second
 * element, so collapsing the tuple would remove infinite scroll outright.
 */
interface ListUnassignedMember<TAttrs> {
    (...args: Parameters<UserstoriesResource['listUnassigned']>): AngularPromise<
        [Array<TaigaModel<TAttrs>>, HttpHeadersGetter]
    >;
}

/** `:42-43` as {@link getUserstoriesFiltersData} uses it: PLAIN parsed data. */
interface FiltersDataMember<TFilters> {
    (...args: Parameters<UserstoriesResource['filtersData']>): AngularPromise<TFilters>;
}

/** `:64-74` as {@link bulkCreateUserstories} uses it: a full HTTP response. */
interface BulkCreateMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkCreate']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

/** `:92-105` as {@link bulkUpdateBacklogOrder} uses it. */
interface BulkUpdateBacklogOrderMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateBacklogOrder']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

/** `:112-129` as {@link bulkUpdateKanbanOrder} uses it. */
interface BulkUpdateKanbanOrderMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateKanbanOrder']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

/** `:107-110` as {@link bulkUpdateMilestone} uses it. */
interface BulkUpdateMilestoneMember<TResult> {
    (...args: Parameters<UserstoriesResource['bulkUpdateMilestone']>): AngularPromise<
        AngularHttpResponse<TResult>
    >;
}

/**
 * `:131-134` as {@link listUserstoryValues} uses it. Built over the locally
 * declared member rather than the bridge's map, because the bridge's membership
 * rule leaves this one out -- see section 8 of the file header.
 */
interface ListValuesMember<TAttrs> {
    (
        ...args: Parameters<UserstoriesResourceUndeclaredMembers['listValues']>
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;
}

/* ==========================================================================
 * THE FROZEN PAYLOAD SHAPES
 *
 * Each hazardous body key is written down EXACTLY ONCE, in this section, and
 * every declared member is then forwarded by the facade that owns it -- so
 * these are load-bearing descriptions of the wire contract, not decoration.
 * ========================================================================== */

/**
 * The project-value collections the values read accepts.
 *
 * Frozen registry entries `:77` and `:80` of
 * `app/coffee/modules/resources.coffee`. Narrowed to a union rather than left as
 * a bare string so a typo becomes a compile error at the call site.
 */
type UserstoryValueCollection = 'points' | 'userstory-statuses';

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

/**
 * The mutually exclusive neighbour half of an ordering request body.
 *
 * ⭐ TRAP 2, ENCODED HERE AND NOWHERE ELSE. Both members are optional because
 * the frozen contract sends AT MOST ONE of them, and sends NEITHER when the
 * caller supplies neither neighbour. See {@link buildBulkOrderRequestBody} for
 * the resolution rule and the reason it must not be duplicated.
 */
interface OrderNeighbourBody {
    /** Sent when the drop has a preceding neighbour. Wins over the other. */
    readonly after_userstory_id?: number;

    /** Sent ONLY when there is no preceding neighbour. */
    readonly before_userstory_id?: number;
}

/**
 * The part of an ordering request body that both order endpoints share.
 *
 * ⭐ TRAP 1, HALF ONE: `bulk_userstories` -- the key belonging to the TWO ORDER
 * endpoints (`resources/userstories.coffee:94`, `:117`) -- is written down here
 * and nowhere else in this file. Its sibling key `bulk_stories` belongs to two
 * DIFFERENT endpoints and is declared separately below; conflating the two is an
 * HTTP 400 that the generic failure path swallows into an opaque error.
 */
interface BulkOrderRequestBody extends OrderNeighbourBody {
    /** Always sent by both order endpoints (`:94`, `:115`). */
    readonly project_id: number;

    /** The stories being repositioned, in their new relative order. */
    readonly bulk_userstories: number[];
}

/**
 * The complete frozen backlog-ordering body
 * (`app/coffee/modules/resources/userstories.coffee:94-103`).
 *
 * ⭐ TRAP 3: `milestone_id` is OPTIONAL because the frozen code adds it only when
 * the value is TRUTHY (`:96-97`) -- so a ZERO milestone id produces a body with
 * no such key at all. The optionality in this type is that behaviour made
 * visible, and {@link bulkUpdateBacklogOrder} is the single place it is applied.
 */
interface BulkUpdateBacklogOrderRequestBody extends BulkOrderRequestBody {
    /** Present ONLY when the caller's milestone id is truthy. */
    readonly milestone_id?: number;
}

/**
 * The complete frozen board-ordering body
 * (`app/coffee/modules/resources/userstories.coffee:114-127`).
 *
 * ⭐ TRAP 3, both halves at one endpoint, and the asymmetry is the whole point:
 * `status_id` is REQUIRED here because the frozen code always sends it (`:116`),
 * while `swimlane_id` is OPTIONAL because the frozen code adds it only when the
 * value is TRUTHY (`:126-127`) -- so a ZERO swimlane id produces a body with no
 * such key. {@link bulkUpdateKanbanOrder} is the single place that is applied.
 */
interface BulkUpdateKanbanOrderRequestBody extends BulkOrderRequestBody {
    /** Always sent -- a board move always names its target column. */
    readonly status_id: number;

    /** Present ONLY when the caller's swimlane id is truthy. */
    readonly swimlane_id?: number;
}

/**
 * The frozen bulk-creation body (`resources/userstories.coffee:65-70`).
 *
 * ⭐ TRAP 1, HALF TWO: `bulk_stories`, encoded once for this endpoint. Note that
 * `swimlane_id` here is UNCONDITIONAL -- it is sent even when nullish -- which is
 * the opposite of the board-order endpoint's truthiness test. That asymmetry is
 * the frozen contract, not an oversight.
 */
type BulkCreateRequestBody = {
    readonly project_id: number;
    readonly status_id: number;
    readonly bulk_stories: string;
    readonly swimlane_id: number | null;
};

/**
 * One entry of a milestone-move body, as the backlog builds them
 * (`app/coffee/modules/backlog/main.coffee:552`, whose helper maps each selected
 * story to its id and its order field).
 *
 * A type alias rather than an interface, for the implicit index signature that
 * keeps it assignable to the generic parameter bag the frozen signature declares.
 */
type BulkMilestoneEntry = {
    readonly us_id: number;
    readonly order: number;
};

/**
 * The frozen milestone-move body (`resources/userstories.coffee:109`).
 *
 * ⭐ TRAP 1, HALF TWO again: `bulk_stories`, encoded once for this endpoint.
 * Unlike the order endpoints, `milestone_id` here is UNCONDITIONAL.
 */
type BulkUpdateMilestoneRequestBody = {
    readonly project_id: number;
    readonly milestone_id: number | null;
    readonly bulk_stories: BulkMilestoneEntry[];
};

/**
 * One row of the response both order endpoints return.
 *
 * The backlog's drag reconciliation reads exactly these three members off
 * `result.data` and copies the last two back onto its local models
 * (`app/coffee/modules/backlog/main.coffee:689-695`) -- the server, not the
 * client, decides a story's final milestone and backlog order. Declared so that
 * reconciliation code cannot mistake the shape; performing the reconciliation is
 * NOT this file's job (see section 6 of the file header).
 */
interface BulkOrderedUserStoryRow {
    readonly id: number;
    readonly milestone: number | null;
    readonly backlog_order: number;
}

/**
 * One selectable entry of the filters payload, before the AngularJS filter mixin
 * normalises it.
 *
 * Typed FAITHFULLY TO THE WIRE (T10): ids stay numeric, or null for the
 * "unassigned" bucket, and no member is renamed. The mixin stringifies those ids
 * IN PLACE afterwards (`app/coffee/modules/controllerMixins.coffee:253`, and
 * `:256` where a tag's id becomes its name) -- THAT MUTATION IS THE MIXIN'S, NOT
 * THIS FILE'S, and pre-applying it here would be a normalisation T10 forbids.
 * The filter panel itself stays AngularJS, so the mixin keeps running unchanged.
 */
interface UserstoriesFilterOption {
    readonly id: number | null;
    readonly name?: string;
    readonly full_name?: string;
    readonly ref?: number;
    readonly subject?: string;
    readonly color?: string;
    readonly count: number;
}

/**
 * The parsed filters body, as the raw repository query resolves it.
 *
 * PLAIN JSON, not models -- see {@link getUserstoriesFiltersData}. The seven
 * members are exactly the ones the AngularJS filter mixin reads
 * (`app/coffee/modules/controllerMixins.coffee:252-302`), each left with the
 * name the wire uses.
 */
interface UserstoriesFiltersData {
    readonly statuses: readonly UserstoriesFilterOption[];
    readonly tags: readonly UserstoriesFilterOption[];
    readonly assigned_users: readonly UserstoriesFilterOption[];
    readonly assigned_to: readonly UserstoriesFilterOption[];
    readonly roles: readonly UserstoriesFilterOption[];
    readonly owners: readonly UserstoriesFilterOption[];
    readonly epics: readonly UserstoriesFilterOption[];
}

/* ==========================================================================
 * THE ONE SHARED ORDERING HELPER
 * ========================================================================== */

/**
 * Builds the shared half of an ordering request body, resolving the neighbour
 * XOR exactly once for both order endpoints.
 *
 * ⭐⭐ THIS FUNCTION IS THE SINGLE ENCODING SITE FOR TRAP 2, AND IT IS WHY
 * NEITHER ORDER FACADE CONTAINS THE NEIGHBOUR LOGIC ITSELF.
 *
 * The frozen rule, from `app/coffee/modules/resources/userstories.coffee:99-103`
 * (backlog order) and `:120-124` (board order), which are byte-wise identical:
 *
 *     if afterUserstoryId          -> after_userstory_id
 *     else if beforeUserstoryId    -> before_userstory_id
 *
 * Three consequences, all of them observable and all asserted by the co-located
 * spec:
 *
 *   1. BOTH neighbours supplied  -> ONLY `after_userstory_id` is sent. AFTER WINS.
 *   2. NEITHER supplied          -> NEITHER key appears in the body at all.
 *   3. The test is TRUTHINESS, so a ZERO neighbour id counts as absent, exactly
 *      as the frozen code does.
 *
 * These endpoints are POSITION-RELATIVE, never index-based, which is what makes
 * getting this wrong so expensive: risk R-DND-2 records that only the
 * drag-and-drop core package is pinned and not its sortable companion, so
 * ordering is computed manually from collision data, and an off-by-one in that
 * computation SILENTLY PERSISTS A WRONG ORDER behind an HTTP 200 -- no
 * exception, no toast, no console warning, visible only on the next page load.
 * Keeping the rule in one unit-tested function is the containment.
 *
 * The returned body is not sent from here. Each order facade PROJECTS it back
 * onto the frozen positional signature of the resource method, which rebuilds
 * the identical body itself -- so this helper decides what crosses the wire
 * while the resource layer stays the only thing that talks to it (T5).
 *
 * @param projectId - owning project; always sent.
 * @param bulkUserstories - the repositioned story ids, in their new order.
 *   Accepted as a readonly array because immer's `autoFreeze` (kept on per
 *   P-IMMER-4) hands out frozen arrays from React state; copied once into the
 *   mutable array the frozen signature declares, which is invisible on the wire.
 * @param afterUserstoryId - preceding neighbour, or nullish at the list head.
 * @param beforeUserstoryId - following neighbour, or nullish at the list tail.
 * @returns the shared half of the frozen ordering body.
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

    // Truthiness, and `else if`, both reproduced verbatim. Do NOT rewrite either
    // as a nullish test: that would start sending a zero neighbour id, and a
    // zero id is how the frozen contract spells "no neighbour on this side".
    if (afterUserstoryId) {
        return { ...shared, after_userstory_id: afterUserstoryId };
    }

    if (beforeUserstoryId) {
        return { ...shared, before_userstory_id: beforeUserstoryId };
    }

    return shared;
}

/* ==========================================================================
 * THE NINE TRANSPORT-BACKED FACADES
 *
 * Every one of them marshals its result through `toNativePromise`. Every one of
 * them takes the narrowest structural slice of the resource it touches.
 * ========================================================================== */

/**
 * Reads one story by its per-project reference number.
 *
 * ⭐ T9 -- THE PROMISE MARSHALLING SEAM. This is the first of the nine places
 * where an AngularJS promise becomes a native one. The resource layer returns
 * promises created by the AngularJS deferred service, NOT native promises: they
 * resolve on the digest cycle and they are typed here as bare thenables so that
 * no call site can `await` one directly and silently inherit AngularJS
 * scheduling. `toNativePromise` adopts the thenable and hands back a real
 * promise, which is what makes `async`/`await` legitimate in React code. The type
 * argument is passed EXPLICITLY at each of the nine boundaries so inference can
 * never quietly widen a result.
 *
 * Two behaviours of the frozen implementation
 * (`app/coffee/modules/resources/userstories.coffee:27-37`) that callers must
 * know about, because this facade forwards rather than reimplements them:
 *
 *   - The stored query parameters are merged in FIRST (`:28`), then the project
 *     and the reference, then `extraParams` -- so `extraParams` wins over
 *     anything previously stored for this project.
 *   - ⭐ TRAP 4: when the merged milestone parameter is the LITERAL STRING
 *     `"null"`, the resource DELETES BOTH `milestone` AND `no-milestone`
 *     (`:33-35`). That is a documented performance workaround in the incumbent,
 *     and it is reached by delegation so it cannot drift.
 *
 * ⭐ P-IMMER-1: this resolves a MODEL INSTANCE, never plain data. Flatten it with
 * `getAttrs()` before it enters React state or an immer draft -- immer rejects
 * class instances, and a spread would drop the dirty-tracking state that makes
 * the changed-fields-only write possible. Flattening is the CALLER's job (T10).
 *
 * @typeParam TAttrs - attribute shape of the resolved model; the story type by
 *   default.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project.
 * @param ref - the story's per-project reference number.
 * @param extraParams - merged last, overriding the stored query parameters.
 *   Defaults to an empty object, matching the frozen default at `:27`.
 * @returns the story, as a model instance.
 */
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

/**
 * Lists every story of a project -- the KANBAN board's read.
 *
 * ⭐ T9 -- SIDE EFFECT THE CALLER MUST EXPECT: the frozen implementation calls
 * the stored-query-parameter WRITE UNCONDITIONALLY
 * (`app/coffee/modules/resources/userstories.coffee:60`), with no `store` flag to
 * suppress it, unlike the backlog read below. Every board refresh therefore
 * overwrites this project's stored filter state as a side effect of reading.
 * That is the incumbent's behaviour at `kanban/main.coffee:546`, `:568` and
 * `:627`, and it is preserved exactly.
 *
 * Returns a BARE ARRAY. Only the backlog read is paginated, so only that one
 * resolves a tuple.
 *
 * ⭐ P-IMMER-1: every element is a MODEL INSTANCE. Flatten with `getAttrs()` at
 * the caller before the values reach React state or an immer draft.
 *
 * @typeParam TAttrs - attribute shape of each resolved model.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; sent as the `project` query parameter.
 * @param filters - merged over the project parameter. Explicitly nullable
 *   because the frozen code coalesces a falsy value to an empty object (`:59`),
 *   so passing null is a supported way of saying "no filters".
 * @returns every matching story, as model instances.
 */
export async function listAllUserstories<TAttrs = UserStory>(
    userstories: { readonly listAll: ListAllMember<TAttrs> },
    projectId: number,
    filters: ResourceParams | null,
): Promise<Array<TaigaModel<TAttrs>>> {
    return toNativePromise<Array<TaigaModel<TAttrs>>>(
        userstories.listAll(projectId, filters ?? undefined),
    );
}

/**
 * Lists the stories that belong to no sprint -- the BACKLOG's read.
 *
 * ⭐ T9 -- FOUR THINGS ABOUT THIS ONE CALL, each of which matters:
 *
 *   1. ⭐ TRAP 4. The frozen implementation sends
 *      `{"project": projectId, "milestone": "null"}` (`:46`) where `"null"` is
 *      the LITERAL FOUR-CHARACTER STRING, not a null. That string IS the
 *      definition of "the backlog" for this endpoint. "Cleaning it up" to a real
 *      null would silently return a different set of stories -- HTTP 200, wrong
 *      data. This facade never rebuilds those parameters, precisely so the
 *      convention has one home.
 *   2. IT RESOLVES A TWO-ELEMENT TUPLE, `[models, headersGetter]`, because the
 *      frozen call passes the repository's `headers` flag
 *      (`base/repository.coffee:145-146`). The second element is a FUNCTION, and
 *      it is HOW INFINITE-SCROLL PAGINATION WORKS: the backlog calls it with a
 *      next-page header name to decide whether to keep loading
 *      (`backlog/main.coffee:177`). Collapsing the tuple to a bare array would
 *      remove pagination, so it is typed explicitly (T10).
 *   3. IT IS THE ONLY IN-SCOPE CALL THAT ENABLES PAGINATION (`:54`), and
 *      therefore the ONLY one for which the repository does NOT send the
 *      disable-pagination header (`base/repository.coffee:139-140`).
 *   4. `store` DEFAULTS TO TRUE in the frozen signature (`:45`), and the stored
 *      parameters are written BEFORE the page size is merged in (`:48-52`), so
 *      the page size is never stored. One in-scope caller passes FALSE on
 *      purpose -- the reference-collecting pass at `backlog/main.coffee:170`,
 *      which must not clobber the stored filter state -- while the visible-page
 *      load at `:405` takes the default. The frozen code also mutates its own
 *      parameter object in place at `:51`; that stays the resource layer's
 *      business.
 *
 * ⭐ P-IMMER-1: the first tuple element holds MODEL INSTANCES. Flatten with
 * `getAttrs()` before they reach React state or an immer draft.
 *
 * @typeParam TAttrs - attribute shape of each resolved model.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project.
 * @param filters - merged over the project and milestone parameters; nullable,
 *   because the frozen code coalesces a falsy value to an empty object (`:47`).
 * @param pageSize - required rather than optional: every in-scope caller supplies
 *   it, and omitting it would silently send no page size and change the request.
 * @param store - whether to overwrite this project's stored query parameters.
 *   Defaults to true, matching the frozen default exactly.
 * @returns a tuple of the page's stories and the response-header accessor.
 */
export async function listUnassignedUserstories<TAttrs = UserStory>(
    userstories: { readonly listUnassigned: ListUnassignedMember<TAttrs> },
    projectId: number,
    filters: ResourceParams | null,
    pageSize: number,
    store: boolean = true,
): Promise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]> {
    return toNativePromise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]>(
        userstories.listUnassigned(projectId, filters ?? undefined, pageSize, store),
    );
}

/**
 * Reads the available filter values for a project's stories.
 *
 * ⭐ T9 -- WHY THIS ONE IS SHAPED DIFFERENTLY FROM EVERY OTHER READ:
 *
 *   - The frozen implementation passes NULL as the id to the repository's raw
 *     query (`app/coffee/modules/resources/userstories.coffee:43`). The
 *     repository appends an id segment ONLY when the id is truthy
 *     (`base/repository.coffee:175`), so a null id means the BARE frozen
 *     endpoint `userstories-filters` is hit rather than a per-row URL.
 *   - The raw query returns THE PARSED BODY ITSELF, not a model
 *     (`base/repository.coffee:180`). So there is no model here, no
 *     `getAttrs()`, and P-IMMER-1 does not apply -- this value is already plain
 *     data and is safe to place in React state as-is.
 *   - The AngularJS filter mixin MUTATES that body IN PLACE afterwards,
 *     stringifying ids and substituting names
 *     (`app/coffee/modules/controllerMixins.coffee:253`, `:256`). THAT MUTATION
 *     IS THE MIXIN'S, NOT THIS FILE'S. The shape below is the wire shape, with
 *     numeric ids intact; pre-applying the mixin's normalisation here would
 *     breach T10, and the mixin is out of scope anyway -- it is shared with the
 *     taskboard and the issues screen, and the filter panel itself stays
 *     AngularJS.
 *   - ⭐ TRAP 4 reaches this endpoint too: the backlog asks for its filters with
 *     the milestone parameter set to the literal `"null"` string
 *     (`controllerMixins.coffee:243-246`), so the caller's parameter bag may
 *     legitimately carry that string. It is forwarded untouched.
 *
 * @typeParam TFilters - shape of the parsed body; the wire shape by default.
 * @param userstories - the live resource namespace.
 * @param params - the filter parameters to evaluate against, forwarded verbatim.
 * @returns the parsed filters body, as plain data.
 */
export async function getUserstoriesFiltersData<TFilters = UserstoriesFiltersData>(
    userstories: { readonly filtersData: FiltersDataMember<TFilters> },
    params: ResourceParams,
): Promise<TFilters> {
    return toNativePromise<TFilters>(userstories.filtersData(params));
}

/**
 * Creates several stories at once from a block of text.
 *
 * Frozen endpoint `bulk-create-us`. The body is described once by
 * {@link BulkCreateRequestBody} and then projected onto the frozen positional
 * signature, so the key `bulk_stories` -- ⭐ TRAP 1, the key that is NOT
 * `bulk_userstories` -- has exactly one home for this endpoint.
 *
 * ⭐ T9: `swimlane_id` is sent UNCONDITIONALLY here (`:69`), including when it is
 * null. The board-ordering endpoint tests the same value for truthiness instead.
 * Both behaviours are the frozen contract and neither is normalised.
 *
 * The sole in-scope caller is the retained shared bulk-create lightbox
 * (`app/coffee/modules/common/lightboxes.coffee:371`), which reads `result.data`
 * and wraps each row in a model itself (`:373`) -- which is why the default
 * result type is the raw story attribute rows rather than models.
 *
 * @typeParam TResult - parsed response body; the created story rows by default.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project.
 * @param statusId - status every created story starts in.
 * @param bulk - the raw multi-line text the user typed, forwarded verbatim. It
 *   is user-authored content and stays a plain string: nothing here treats it as
 *   markup, and React escapes text by default.
 * @param swimlaneId - target swimlane, or null; sent either way.
 * @returns the full response, whose `data` holds the created rows.
 */
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
 * Repositions stories within the backlog, and optionally moves them into a
 * sprint.
 *
 * Frozen endpoint `bulk-update-us-backlog-order`. POSITION-RELATIVE: the server
 * is told which story the moved block now follows or precedes, never an index.
 *
 * ⭐ TRAP 2 is resolved by {@link buildBulkOrderRequestBody} and NOT here, which
 * is the whole point of that helper: the neighbour rule exists in one place for
 * both order endpoints, so the two cannot drift apart. AFTER WINS when both
 * neighbours are supplied, and neither key is sent when neither is.
 *
 * ⭐ TRAP 3: `milestone_id` is sent ONLY WHEN TRUTHY (`:96-97`), so a ZERO
 * milestone id OMITS THE KEY -- which is how the frozen contract spells "leave
 * the sprint assignment alone". A nullish test here would start sending a zero
 * and silently move stories to the wrong place. The nullish coalescing below
 * converts an absent value to null before forwarding; the frozen code's own
 * truthiness test then omits the key, so a zero behaves identically to a null.
 *
 * ⭐ THE QUEUE IS NOT HERE. The caller must serialise consecutive drags itself:
 * `backlog/main.coffee` keeps a first-in-first-out queue, sends only its head,
 * and reconciles the authoritative values from the response. Section 6 of the
 * file header records the full behaviour and names its React owners. A second
 * drag issued while one is in flight computes its neighbours from an ordering
 * the server has not yet acknowledged, and the persisted order then diverges
 * from what the user sees -- with no error surface at all. This facade is
 * STATELESS on purpose; implementing the guard twice would be worse than not
 * implementing it here at all.
 *
 * NAME INVERSION: the backlog controller's `previousUs` is `afterUserstoryId`
 * here, its `nextUs` is `beforeUserstoryId`, and its `currentSprintId` is
 * `milestoneId` (`backlog/main.coffee:682-688`).
 *
 * @typeParam TResult - parsed response body; the reconciliation rows by default.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; always sent.
 * @param milestoneId - target sprint, or nullish to leave it unchanged. Sent only
 *   when truthy.
 * @param afterUserstoryId - the story the block now follows, or nullish.
 * @param beforeUserstoryId - the story the block now precedes, or nullish.
 * @param bulkUserstories - the moved story ids in their new relative order;
 *   accepted readonly for frozen React state and copied once by the builder.
 * @returns the full response, whose `data` holds the authoritative rows.
 */
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
        // ⭐ TRAP 3, applied here and nowhere else for this endpoint. TRUTHINESS,
        // deliberately not a nullish test: a zero milestone id must leave the key
        // out of the body entirely, exactly as `:96-97` does.
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
 * Repositions cards on the board, across statuses and swimlanes.
 *
 * Frozen endpoint `bulk-update-us-kanban-order`. POSITION-RELATIVE, with exactly
 * the same neighbour rule as the backlog order endpoint -- which is why ⭐ TRAP 2
 * is resolved by the shared {@link buildBulkOrderRequestBody} and appears in
 * neither of the two facades.
 *
 * ⭐ TRAP 3, both halves of it, at one endpoint:
 *
 *   - `status_id` is sent ALWAYS (`:116`). The board move always names its
 *     target column.
 *   - `swimlane_id` is sent ONLY WHEN TRUTHY (`:126-127`), so a ZERO swimlane id
 *     OMITS THE KEY. Reproduced rather than "improved": sending a zero would
 *     silently file cards under the wrong swimlane, behind an HTTP 200.
 *
 * Note also the ORDER of the frozen body construction: the neighbour keys are
 * added BEFORE the swimlane key (`:120-127`). Key order carries no meaning in a
 * serialised object, so nothing depends on it, and the projection below leaves
 * the frozen code to assemble the body regardless.
 *
 * A NULL swimlane is a real board state, not a missing value -- unclassified
 * stories genuinely have none. The board's own synthetic identifier for that
 * bucket is a client-side convention of the React board state and never reaches
 * this facade; the caller resolves it before calling
 * (`kanban/main.coffee:714-721` passes an already-resolved value).
 *
 * @typeParam TResult - parsed response body; the reconciliation rows by default.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; always sent.
 * @param statusId - target status; always sent.
 * @param swimlaneId - target swimlane, or nullish; sent only when truthy.
 * @param afterUserstoryId - the card the block now follows, or nullish.
 * @param beforeUserstoryId - the card the block now precedes, or nullish.
 * @param bulkUserstories - the moved card ids in their new relative order;
 *   accepted readonly for frozen React state and copied once by the builder.
 * @returns the full response.
 */
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
        // ALWAYS sent (`:116`) -- no condition, because a board move always names
        // the column it lands in.
        status_id: statusId,
        // ⭐ TRAP 3, applied here and nowhere else for this endpoint. TRUTHINESS,
        // deliberately not a nullish test: a zero swimlane id must leave the key
        // out of the body entirely, exactly as `:126-127` does. Sending a zero
        // would file cards under the wrong swimlane behind an HTTP 200.
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
 * Moves a set of stories into a sprint in one request.
 *
 * Frozen endpoint `bulk-update-us-milestone`. The body is described once by
 * {@link BulkUpdateMilestoneRequestBody} and then projected onto the frozen
 * positional signature, so `bulk_stories` -- ⭐ TRAP 1 again, and emphatically
 * NOT `bulk_userstories`, even though this endpoint also carries an `order` per
 * entry -- has exactly one home for this endpoint. Sending the order endpoints'
 * key here would be an HTTP 400 swallowed into a generic failure.
 *
 * ⭐ T9: unlike the two order endpoints, `milestone_id` here is UNCONDITIONAL
 * (`:109`) -- there is no truthiness test, because naming the destination sprint
 * is the entire purpose of the call.
 *
 * The sole in-scope caller is the move-to-sprint action
 * (`backlog/main.coffee:880`), which ignores the response body and reloads
 * instead.
 *
 * @typeParam TResult - parsed response body.
 * @param userstories - the live resource namespace.
 * @param projectId - owning project.
 * @param milestoneId - destination sprint; always sent.
 * @param data - one entry per story, each naming the story and its order within
 *   the sprint; accepted readonly for frozen React state and copied once.
 * @returns the full response.
 */
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

/**
 * Lists a project-value collection -- estimation points, or story statuses.
 *
 * ⭐⭐ T9 -- READ THIS BEFORE WIRING IT ANYWHERE: THIS FACADE HAS ZERO CURRENT
 * CONSUMERS, AND IT MUST STAY THAT WAY.
 *
 * A repository-wide search for calls to the underlying member returns nothing.
 * Both in-scope screens take their statuses and points from the ALREADY-LOADED
 * PROJECT OBJECT instead -- the board sorts `project.points` and
 * `project.us_statuses` (`kanban/main.coffee:573-576`), and the backlog does the
 * same (`backlog/main.coffee:479-482`) -- so neither screen issues a request for
 * them at all. Goal G2 does not list either collection among the frozen
 * endpoints, which corroborates that.
 *
 * Wiring this into a component would therefore ADD A NETWORK REQUEST THE
 * INCUMBENT NEVER MAKES, which is exactly the functional change T10 forbids. It
 * is faceted because the file's contract names it, and it is documented as
 * unwired so that its presence is never mistaken for a licence to call it.
 *
 * A related hazard, recorded for awareness only and NOT acted on here: the two
 * screens sort the status list by DIFFERENT keys -- the board by display order
 * (`kanban/main.coffee:576`), the backlog by id (`backlog/main.coffee:482`).
 * Silently unifying them would breach T10. That code is not this file's to
 * touch, and nothing here sorts.
 *
 * ⭐ T9: the underlying member also performs the stored-query-parameter WRITE
 * before reading (`:133`), the same unconditional side effect the board list has.
 *
 * ⭐ P-IMMER-1: resolves MODEL INSTANCES. Flatten with `getAttrs()` at the
 * caller.
 *
 * @typeParam TAttrs - attribute shape of each resolved model; a status or a point
 *   value by default, matching the two collections the type union permits.
 * @param userstories - the live resource namespace, which must expose the member
 *   the bridge's membership rule omits (see section 8 of the file header).
 * @param projectId - owning project.
 * @param type - which frozen collection to read.
 * @returns the collection, as model instances.
 */
export async function listUserstoryValues<TAttrs = Status | PointValue>(
    userstories: { readonly listValues: ListValuesMember<TAttrs> },
    projectId: number,
    type: UserstoryValueCollection,
): Promise<Array<TaigaModel<TAttrs>>> {
    return toNativePromise<Array<TaigaModel<TAttrs>>>(
        userstories.listValues(projectId, type),
    );
}

/* ==========================================================================
 * THE SIX STORAGE-BACKED FACADES -- ALL SYNCHRONOUS
 *
 * ⭐⭐ T9 -- THE DELIBERATE ASYMMETRY WITH THE NINE ABOVE. Not one of the six
 * functions in this section is asynchronous, not one returns a promise, and not
 * one goes near the promise marshaller. That looks like an inconsistency next to
 * the nine transport-backed facades and it is not: it is the frozen behaviour.
 *
 * THE PROOF, measured rather than assumed. The underlying storage service is
 * immediate on both paths -- the read parses and returns the stored value
 * directly (`app/coffee/modules/base/storage.coffee:17-25`) and the write returns
 * nothing (`:27-32`) -- and two live call sites read the tags flag as a VALUE:
 *
 *     app/coffee/modules/backlog/main.coffee:150   if @rs.userstories.getShowTags(...)
 *     app/coffee/modules/backlog/main.coffee:540   if @rs.userstories.getShowTags(...) == false
 *
 * A promise is ALWAYS truthy, so the first test would stop discriminating and the
 * tags column would always render. A promise is never loosely equal to false, so
 * the second would never match and an explicit "hide tags" preference would be
 * silently ignored. Turning these six into asynchronous functions would
 * therefore be a behaviour change, which T10 forbids. They stay immediate.
 *
 * ⭐ T9 -- WHAT THE READS RETURN WHEN NOTHING IS STORED. The storage read yields
 * NULL, never undefined, both when the key is absent (`storage.coffee:20`) and
 * when the stored text fails to parse (`:25`). The resource layer then applies
 * its own fallbacks, and they are NOT uniform:
 *
 *     stored query parameters -> falls back to an empty object  (`:157`)
 *     stored backlog order    -> falls back to an empty array   (`:167`)
 *     stored tags flag        -> NO FALLBACK AT ALL             (`:177`)
 *
 * The tags flag therefore has THREE GENUINE STATES -- true, false, and "never
 * chosen on this project" -- and its facade returns a nullable boolean so the
 * third stays distinguishable. Collapsing it to a plain boolean would erase the
 * difference between "the user hid the tags" and "the user has not decided",
 * which is precisely the difference the two call sites above are testing.
 *
 * ⭐ T9 -- KEY DERIVATION IS NOT THIS FILE'S JOB. The resource layer builds a
 * storage key by namespacing the project id with a per-collection suffix and
 * passing the pair through the framework's hash helper
 * (`resources/userstories.coffee:150-151`, `:155-156`, `:160-161`, `:165-166`,
 * `:170-171`, `:175-176`) -- and note that THE PROJECT ID APPEARS TWICE in that
 * pair, once on its own and once inside the namespace string. These facades pass
 * the project id straight through and never derive a key, never touch the hash
 * helper and never touch browser storage directly. Reimplementing the derivation
 * would risk reading a different key from the one the AngularJS side writes, and
 * the two screens coexist against the same stored state.
 *
 * SECURITY, unchanged by design: the session token also lives in browser storage
 * behind the same service. This file never reads or writes it, and relocating it
 * is out of scope.
 * ========================================================================== */

/**
 * Persists this project's story query parameters.
 *
 * The board list writes these on EVERY read as an unconditional side effect, and
 * the backlog list writes them unless told not to -- see
 * {@link listAllUserstories} and {@link listUnassignedUserstories}. This facade
 * is the explicit path for the one in-scope caller that writes them on its own
 * (`app/coffee/modules/backlog/main.coffee:393`).
 *
 * IMMEDIATE, not asynchronous. Returns nothing, exactly as the frozen write does
 * (`app/coffee/modules/resources/userstories.coffee:149-152`).
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @param params - the parameters to persist, forwarded verbatim.
 */
export function storeUserstoriesQueryParams(
    userstories: Pick<UserstoriesResource, 'storeQueryParams'>,
    projectId: number,
    params: ResourceParams,
): void {
    userstories.storeQueryParams(projectId, params);
}

/**
 * Reads back this project's persisted story query parameters.
 *
 * IMMEDIATE, not asynchronous. The frozen read falls back to an EMPTY OBJECT when
 * nothing is stored (`app/coffee/modules/resources/userstories.coffee:157`), so
 * this never yields null and callers need no null check -- which is why the
 * return type is not nullable, unlike {@link getShowTags}.
 *
 * The by-reference read merges these in before its own parameters, so whatever is
 * stored here silently participates in that request; see
 * {@link getUserStoryByRef}.
 *
 * Uses the member the bridge's membership rule omits -- section 8 of the file
 * header explains why, and records that this member has no in-scope caller today.
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @returns the stored parameters, or an empty object.
 */
export function getUserstoriesQueryParams(
    userstories: Pick<UserstoriesResourceUndeclaredMembers, 'getQueryParams'>,
    projectId: number,
): ResourceParams {
    return userstories.getQueryParams(projectId);
}

/**
 * Persists the backlog's ordering for this project.
 *
 * ⭐ T9 -- THE STORED VALUES ARE REFERENCE NUMBERS, NOT DATABASE IDS. Both
 * in-scope writers collect `us.ref` (`app/coffee/modules/backlog/main.coffee:174`
 * and `:182`), and the frozen signature merely names its parameter "ids". The
 * distinction matters because the two are different numbers on the same story:
 * feeding database ids in here would produce an ordering that matches nothing the
 * screen renders. The parameter is named for what it actually holds.
 *
 * IMMEDIATE, not asynchronous. Returns nothing
 * (`app/coffee/modules/resources/userstories.coffee:159-162`).
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @param refs - the story reference numbers in backlog order; accepted readonly
 *   for frozen React state and copied once into the array the frozen signature
 *   declares, which is invisible to the stored result.
 */
export function storeBacklogIds(
    userstories: Pick<UserstoriesResource, 'storeBacklog'>,
    projectId: number,
    refs: readonly number[],
): void {
    userstories.storeBacklog(projectId, [...refs]);
}

/**
 * Reads back the persisted backlog ordering for this project.
 *
 * IMMEDIATE, not asynchronous. The frozen read falls back to an EMPTY ARRAY when
 * nothing is stored (`app/coffee/modules/resources/userstories.coffee:167`), so
 * this never yields null. As with the write, the numbers are story REFERENCE
 * numbers rather than database ids -- see {@link storeBacklogIds}.
 *
 * Returned readonly so a caller cannot mutate the array in place and expect the
 * stored value to follow; persisting a change means calling the write.
 *
 * Uses the member the bridge's membership rule omits -- section 8 of the file
 * header explains why, and records that this member has no in-scope caller today.
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @returns the stored reference numbers in backlog order, or an empty array.
 */
export function getBacklogIds(
    userstories: Pick<UserstoriesResourceUndeclaredMembers, 'getBacklog'>,
    projectId: number,
): readonly number[] {
    return userstories.getBacklog(projectId);
}

/**
 * Persists whether tag pills are shown on the backlog rows of this project.
 *
 * IMMEDIATE, not asynchronous. Returns nothing
 * (`app/coffee/modules/resources/userstories.coffee:169-172`). The two in-scope
 * writers are the initial load and the toggle
 * (`app/coffee/modules/backlog/main.coffee:285` and `:548`).
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @param showTags - the user's choice, persisted as given.
 */
export function storeShowTags(
    userstories: Pick<UserstoriesResource, 'storeShowTags'>,
    projectId: number,
    showTags: boolean,
): void {
    userstories.storeShowTags(projectId, showTags);
}

/**
 * Reads back whether tag pills are shown on the backlog rows of this project.
 *
 * ⭐⭐ THE ONE STORAGE READ WITH NO FALLBACK, AND THEREFORE THREE STATES.
 * The frozen read returns the stored value as-is
 * (`app/coffee/modules/resources/userstories.coffee:174-177`), with none of the
 * coalescing its two siblings apply, and the underlying storage read yields NULL
 * when nothing is stored (`base/storage.coffee:20`) or when the stored text fails
 * to parse (`:25`). So:
 *
 *     true   -> the user chose to show tags
 *     false  -> the user chose to HIDE tags
 *     null   -> the user has never chosen on this project
 *
 * Both in-scope readers depend on that third state being distinguishable, and
 * they read it in OPPOSITE directions -- the initial load turns tags ON only for
 * a truthy value (`backlog/main.coffee:150`) while the reload turns them OFF only
 * for an explicit `== false` (`:540`). Under null, neither branch fires and the
 * screen keeps its default. Collapsing the null into a boolean would make one of
 * those two branches fire when it must not.
 *
 * IMMEDIATE, not asynchronous -- these two call sites are the measured proof, and
 * the section comment above spells out how a promise would break each of them.
 *
 * @param userstories - the live resource namespace.
 * @param projectId - owning project; forwarded, never hashed here.
 * @returns the stored choice, or null when the user has never made one.
 */
export function getShowTags(
    userstories: Pick<UserstoriesResource, 'getShowTags'>,
    projectId: number,
): boolean | null {
    return userstories.getShowTags(projectId);
}
