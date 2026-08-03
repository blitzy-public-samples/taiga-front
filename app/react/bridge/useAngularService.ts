/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useContext } from 'react';

import { AngularBridgeContext } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';

/**
 * The registered name of the AngularJS application root scope.
 *
 * A module constant rather than a literal at the one call site, so the string
 * exists exactly once: it is the ONLY off-map name this file resolves, and
 * {@link useAngularBroadcastListener} hardcodes it precisely so no caller can
 * substitute another. Section 6 of the file header explains why this one name is
 * reachable at all and why only its `$on` member crosses the seam.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/* ==========================================================================
 * STRUCTURAL PRIMITIVES
 *
 * Hand-written because the AngularJS type-definition package is outside the
 * pinned dependency set (HR-2). Each one models the smallest shape that is
 * correct for the call sites the two in-scope screens have.
 * ========================================================================== */

/**
 * Typed facade over the AngularJS services React reaches through the injector.
 *
 * Every shape below is declared locally and structurally, because the AngularJS type
 * package is deliberately not part of the dependency set. Two boundary facts are
 * encoded rather than left to convention:
 *
 * - Anything typed `TaigaModel` is a LIVE model, not plain data. It carries the
 *   dirty tracking that makes the repository PATCH only changed fields together with
 *   the optimistic-concurrency version, so it must be flattened before it reaches
 *   React state and must never be replaced by a hand-rolled request.
 * - Anything typed `PersistentStructure` is a persistent collection and is likewise
 *   flattened at the seam rather than consumed directly.
 *
 * `subscribe` accepts a NULL scope, which is the form React uses: with no scope
 * there is no automatic teardown, so the caller owns `unsubscribe`.
 *
 * This map is also the ownership boundary. A service that is not listed here is not
 * reachable from React through the typed hook; adding one means adding its shape.
 */
interface AngularPromise<T> {
    then(
        onFulfilled: (value: T) => unknown,
        onRejected: (reason: unknown) => unknown,
    ): unknown;
}

interface HttpHeadersGetter {
    (): Record<string, string>;
    (name: string): string | null;
}

interface AngularHttpResponse<TData> {
    data: TData;

    status: number;

    headers: HttpHeadersGetter;
}

interface PersistentStructure<TPlain = Record<string, unknown>> {
    get<TValue>(key: string): TValue;

    toJS(): TPlain;
}

/**
 * What `getAttrs(true)` ACTUALLY hands back: the CHANGED FIELDS ONLY, plus the
 * optimistic-concurrency `version`.
 *
 * ⭐ WHY THIS TYPE EXISTS RATHER THAN REUSING `TAttrs`. `model.coffee:48-54`
 * returns `_.extend({}, @._modifiedAttrs)` when `patch` is truthy -- the
 * modified set, NOT the merged bag -- after copying `@._attrs.version` into that
 * set at `:49-50` when the model carries one. So a patch is a PARTIAL of the
 * attribute shape: every field the caller has not written is absent from it.
 * Typing that as a complete `TAttrs` would let a caller read a required field
 * off a patch and get `undefined` while the compiler insisted it was present --
 * silently, and precisely on the write path where requirement I7 says the
 * changed-fields-only PATCH is a data-integrity guarantee rather than an
 * optimisation.
 *
 * `version` is named explicitly, and optional, because the incumbent copies it
 * in ONLY when the attribute bag has one (`:49`). For an attribute shape that
 * already declares `version`, the intersection collapses to that shape's own
 * member; for one that does not, the member is still visible here because the
 * run-time value carries it.
 *
 * @typeParam TAttrs - the plain attribute shape the model wraps.
 */
type TaigaModelPatch<TAttrs> = Partial<TAttrs> & {
    /** Carried on every patch of a versioned record (`model.coffee:49-50`). */
    readonly version?: number;
};

/**
 * A `$tgModel` INSTANCE: the dirty-tracking wrapper the repository layer
 * consumes and produces (`app/coffee/modules/base/model.coffee:9-127`).
 *
 * Modelled so that React can hand a model back to `$tgRepo.save()` intact --
 * that round trip is what preserves the changed-fields-only PATCH described in
 * section 5 of the file header. A model instance must NEVER be placed in React
 * state or in an immer draft (pitfall P-IMMER-1: immer rejects class
 * instances); flatten it with `getAttrs()` first, which is exactly what the
 * AngularJS-side bridge already does before values cross the seam.
 *
 * Deliberately NO index signature: per-attribute access exists at runtime
 * through the accessors installed at `model.coffee:94-101`, but exposing it
 * here would let React read a model as if it were plain data and defeat the
 * flattening discipline. Members present on the real class but untouched by
 * either in-scope screen -- `setAttrs`, `isAttributeModified`, `markSaved`,
 * `revert`, `realClone`, `applyCasts`, `serialize`, `getIdAttrName` -- are
 * named here rather than declared, so needing one becomes a reviewed edit.
 *
 * @typeParam TAttrs - the plain attribute shape this model wraps.
 */
interface TaigaModel<TAttrs = Record<string, unknown>> {
    /**
     * `model.coffee:48-54`. With `patch` falsy, returns every attribute merged
     * with the modified ones; with `patch` truthy, returns ONLY the modified
     * ones. Either way the optimistic-concurrency `version` is carried along,
     * copied into the modified set at `:49-50`.
     *
     * ⭐ OVERLOADED ON THE ARGUMENT, because the two calls return DIFFERENT
     * SHAPES and a single signature could only describe one of them. The
     * no-argument and explicit-`false` forms yield the complete attribute shape
     * (`:54`); the explicit-`true` form yields {@link TaigaModelPatch}, the
     * changed fields plus `version` (`:52-53`). The final signature exists for a
     * caller whose flag is only known at run time and hands back the union, so
     * such a caller must narrow before reading -- which is the honest treatment
     * of a value whose shape genuinely depends on a value.
     */
    getAttrs(): TAttrs;
    getAttrs(patch: false): TAttrs;
    getAttrs(patch: true): TaigaModelPatch<TAttrs>;
    getAttrs(patch?: boolean): TAttrs | TaigaModelPatch<TAttrs>;

    setAttr(name: string, value: unknown): void;

    isModified(): boolean;

    getName(): string;

    clone(): TaigaModel<TAttrs>;
}

type ResourceParams = Record<string, unknown>;

/* ==========================================================================
 * `$tgResources` NAMESPACES
 *
 * `$tgResources` is a `ResourcesService` instance
 * (`app/coffee/modules/resources.coffee:257`) onto which each provider grafts
 * one namespace at run time -- `instance.userstories = service`,
 * `instance.sprints = service`, and so on -- wired by the `module.run` block at
 * `resources.coffee:261-289`.
 *
 * MEMBERSHIP RULE for everything below, applied uniformly: a member is declared
 * if and only if (a) one of the two in-scope modules calls it, measured by
 * grepping `app/coffee/modules/{kanban,backlog}/**`, or (b) it is the method
 * that resolves one of the SIX FROZEN ENDPOINTS goal G2 requires be reused
 * exactly as resolved today -- `bulk-update-us-kanban-order`
 * (`resources.coffee:112`), `bulk-update-us-backlog-order` (`:109`),
 * `bulk-update-us-milestone` (`:110`), `bulk-create-us` (`:108`), `milestones`
 * (`:92`) and `userstories-filters` (`:113`), or (c) a typed facade under
 * `../shared/api/**` faces it, because that facade IS the React-side caller and
 * a member it needs is by definition reachable from React.
 *
 * ⭐ CLAUSE (c) IS LOAD-BEARING, AND IT WAS ADDED BECAUSE ITS ABSENCE HAD A
 * MEASURABLE COST. Without it, six members that exist on the real services --
 * `userstories.listValues`, `userstories.getQueryParams`,
 * `userstories.getBacklog`, `sprints.get`, `sprints.stats` and
 * `sprints.moveUserStoriesMilestone` -- were faced by
 * `../shared/api/userstories.ts` and `../shared/api/sprints.ts` while being
 * absent from this map, so both files had to re-declare them locally. The result
 * was TWO DESCRIPTIONS OF ONE OBJECT, free to drift apart, and a live
 * `useAngularService('$tgResources')` value that could not be handed to those
 * six facades at all. Every member is therefore declared HERE, once, and the
 * facades index this map instead (they already do so for every other member).
 * ========================================================================== */

/**
 * The project-value collections `userstories.listValues` accepts.
 *
 * FROZEN REGISTRY ENTRIES `app/coffee/modules/resources.coffee:77` (`points`)
 * and `:80` (`userstory-statuses`). The value is used by the incumbent as the
 * REGISTRY KEY it queries (`resources/userstories.coffee:134` passes `type`
 * straight to the repository), so a typo would resolve a different URL -- hence a
 * union rather than a bare string, which turns that typo into a compile error at
 * the call site.
 *
 * Declared here rather than in the facade so that the parameter type and the
 * member that consumes it have ONE home: the facade derives its own parameter
 * list from this member with `Parameters<>`, and under `strictFunctionTypes` a
 * widened parameter here would make every narrow test double unassignable.
 */
type UserStoryValueCollection = 'points' | 'userstory-statuses';

/**
 * The `userstories` namespace --
 * `app/coffee/modules/resources/userstories.coffee:15-177`.
 *
 * Members present on the real service but excluded by the membership rule:
 * `listInAllProjects`, `upvote`, `downvote`, `watch`, `unwatch`,
 * `createDefaultValues` and `editStatus`.
 */
interface UserStoriesResource {
    get<TAttrs = Record<string, unknown>>(
        projectId: number,
        usId: number,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    getByRef<TAttrs = Record<string, unknown>>(
        projectId: number,
        ref: number,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    listAll<TAttrs = Record<string, unknown>>(
        projectId: number,
        filters?: ResourceParams,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;

    listUnassigned<TAttrs = Record<string, unknown>>(
        projectId: number,
        filters?: ResourceParams,
        pageSize?: number,
        store?: boolean,
    ): AngularPromise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]>;

    filtersData<TFilters = unknown>(params: ResourceParams): AngularPromise<TFilters>;

    bulkCreate<TResult = unknown>(
        projectId: number,
        status: number,
        bulk: string,
        swimlane: number | null,
    ): AngularPromise<AngularHttpResponse<TResult>>;

    bulkUpdateBacklogOrder<TResult = unknown>(
        projectId: number,
        milestoneId: number | null,
        afterUserstoryId: number | null,
        beforeUserstoryId: number | null,
        bulkUserstories: number[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    bulkUpdateKanbanOrder<TResult = unknown>(
        projectId: number,
        statusId: number,
        swimlaneId: number | null,
        afterUserstoryId: number | null,
        beforeUserstoryId: number | null,
        bulkUserstories: number[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    bulkUpdateMilestone<TResult = unknown>(
        projectId: number,
        milestoneId: number | null,
        data: ResourceParams[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    /**
     * `:131-134`. Lists one project-value collection -- estimation points or
     * story statuses -- as models, through the repository's model query.
     *
     * Performs the stored-query-parameter WRITE before reading (`:133`), the
     * same unconditional side effect `listAll` has.
     */
    listValues<TAttrs = Record<string, unknown>>(
        projectId: number,
        type: UserStoryValueCollection,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;

    /**
     * `:149-152`. SYNCHRONOUS -- writes to browser local storage under a hash
     * of the project id, and returns nothing. Not a promise; see section 7 of
     * the file header.
     */
    storeQueryParams(projectId: number, params: ResourceParams): void;

    /**
     * `:154-157`. SYNCHRONOUS local-storage read of the stored query
     * parameters, defaulting to an empty object when nothing has been stored
     * (`:157`), so it never resolves to nothing.
     */
    getQueryParams(projectId: number): ResourceParams;

    /** `:159-162`. SYNCHRONOUS local-storage write of the backlog id order. */
    storeBacklog(projectId: number, ids: number[]): void;

    /**
     * `:164-167`. SYNCHRONOUS local-storage read of the stored backlog
     * ordering, defaulting to an empty array (`:167`).
     */
    getBacklog(projectId: number): number[];

    /** `:169-172`. SYNCHRONOUS local-storage write of the tags-visible flag. */
    storeShowTags(projectId: number, params: boolean): void;

    getShowTags(projectId: number): boolean | null;
}

/**
 * The `sprints` namespace --
 * `app/coffee/modules/resources/sprints.coffee:15-57`. Backs the frozen
 * `milestones` endpoint (`resources.coffee:92`).
 *
 * Members excluded by the membership rule: `moveTasksMilestone` and
 * `moveIssuesMilestone` -- the task and issue variants, which belong to the
 * out-of-scope taskboard.
 */
interface SprintsResource {
    /**
     * `:16-21`. One sprint, as a model, with its nested `user_stories` re-wrapped
     * as models IN PLACE on the private attribute slot (`:18-20`).
     *
     * ⭐ THE FIRST PARAMETER IS ACCEPTED AND NEVER READ by the incumbent (`:16`
     * takes it; `:17` queries by sprint id alone). It is part of the positional
     * signature all the same, so it must still be supplied.
     */
    get<TAttrs = Record<string, unknown>>(
        projectId: number,
        sprintId: number,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /**
     * `:23-24`. One sprint's statistics, as PLAIN PARSED DATA rather than a
     * model: this one goes through the repository's RAW query, which resolves the
     * parsed body itself (`app/coffee/modules/base/repository.coffee:180`).
     *
     * The `<id>/stats` sub-path is composed INSIDE the member (`:24`), so a
     * caller supplies the sprint id and never a path. The first parameter is
     * again accepted and never read.
     */
    stats<TStats = unknown>(projectId: number, sprintId: number): AngularPromise<TStats>;
    /**
     * `:26-42`. Frozen endpoint `milestones`.
     *
     * Resolves an OBJECT, not an array: the provider reads
     * `Taiga-Info-Total-Closed-Milestones` and
     * `Taiga-Info-Total-Opened-Milestones` off the response headers and returns
     * `{milestones, closed, open}` (`:38-42`). It also replaces each
     * milestone's `user_stories` with an array of models in place (`:34-36`), so
     * the nested stories are models too.
     */
    list<TAttrs = Record<string, unknown>>(
        projectId: number,
        filters?: ResourceParams,
    ): AngularPromise<{
        milestones: Array<TaigaModel<TAttrs>>;
        closed: number;
        open: number;
    }>;

    /**
     * `:44-47`. Moves open user stories out of one sprint and into another.
     *
     * ⭐ THE POSITIONAL ORDER IS THE CONTRACT, and transposing the two sprint ids
     * is silent: the FIRST id is the SOURCE and lands in the URL path (`:45`),
     * while the THIRD is the DESTINATION and lands in the request body as
     * `milestone_id` (`:46`). `data` becomes `bulk_stories` on the same line --
     * NOT `bulk_userstories`, which belongs to the two order endpoints.
     */
    moveUserStoriesMilestone<TResult = unknown>(
        currentMilestoneId: number,
        projectId: number,
        milestoneId: number | null,
        data: ResourceParams[],
    ): AngularPromise<AngularHttpResponse<TResult>>;
}

interface SwimlanesResource {
    list<TAttrs = Record<string, unknown>>(
        projectId: number,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;
}

interface KanbanResource {
    storeStatusColumnModes(projectId: number, params: ResourceParams): void;

    getStatusColumnModes(projectId: number): ResourceParams;

    storeSwimlanesModes(projectId: number, params: ResourceParams): void;

    getSwimlanesModes(projectId: number): ResourceParams;
}

interface ProjectsResource {
    stats<TStats = unknown>(projectId: number): AngularPromise<TStats>;

    tagsColors<TColors = Record<string, string>>(
        projectId: number,
    ): AngularPromise<TaigaModel<TColors>>;
}

interface TaigaResources {
    userstories: UserStoriesResource;

    sprints: SprintsResource;

    swimlanes: SwimlanesResource;

    kanban: KanbanResource;

    projects: ProjectsResource;
}

interface AttachmentsResource {
    list<TAttachment = unknown>(
        type: string,
        objId: number,
        projectId: number,
    ): AngularPromise<PersistentStructure<readonly TAttachment[]>>;
}

interface TaigaResources2 {
    attachments: AttachmentsResource;
}

interface TaigaRepository {
    save<TAttrs = Record<string, unknown>>(
        model: TaigaModel<TAttrs>,
        patch?: boolean,
        params?: ResourceParams,
        options?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    create<TAttrs = Record<string, unknown>>(
        name: string,
        data: TAttrs,
        dataTypes?: Record<string, string>,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    remove<TAttrs = Record<string, unknown>>(
        model: TaigaModel<TAttrs>,
        params?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;
}

interface TaigaModelFactory {
    make_model<TAttrs = Record<string, unknown>>(
        name: string,
        data: TAttrs,
    ): TaigaModel<TAttrs>;
}

interface AngularLifecycleScope {
    $on(eventName: string, listener: () => void): () => void;
}

/**
 * ⭐ THE ENTIRE SURFACE OF THE ANGULARJS ROOT SCOPE THAT REACT MAY EVER SEE.
 *
 * ONE MEMBER: `$on`. Not the apply/async-apply/digest trio, not `$emit`, not
 * `$broadcast`, not `$new`, not `$watch`, not `$destroy`. The real root scope has
 * all of those and React may use NONE of them (section 5 of the file header), so
 * the narrow contract is what keeps the exception in section 6 as narrow as it
 * claims to be: a broadcast listener with deterministic teardown, never digest
 * participation. Because {@link useAngularBroadcastListener} hands back THIS
 * type rather than the service object, the forbidden members are not merely
 * discouraged -- they are unnameable.
 *
 * `$on` RETURNS `unknown` deliberately. AngularJS returns a deregistration
 * function, but the value crosses the seam from untyped CoffeeScript, so it is
 * unusable until the caller has checked it at run time -- which is the honest
 * treatment, and it keeps the lightweight doubles used by the co-located specs
 * (whose `$on` may legitimately return nothing) structurally assignable.
 *
 * The listener parameter carries BOTH AngularJS arguments in AngularJS's own
 * order -- the event object FIRST, the payload second -- so a listener cannot
 * read the payload out of the wrong position, which is the classic way to get an
 * AngularJS event listener wrong.
 */
interface AngularBroadcastListener {
    /**
     * Registers `listener` for `eventName` and returns AngularJS's own
     * deregistration function, which the caller MUST invoke on cleanup.
     */
    $on(eventName: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

/**
 * `$tgEvents` -- the realtime service
 * (`app/coffee/modules/events.coffee`), which multiplexes the WebSocket
 * connection to `taiga-events` and its RabbitMQ routing keys. Requirement G2
 * freezes the routing-key contract: `changes.project.{id}.userstories`,
 * `.milestones` and `.projects` are subscribed exactly as they are today.
 */
interface TaigaEventsService {
    connected: boolean;

    subscribe(
        scope: AngularLifecycleScope | null,
        routingKey: string,
        callback: (data: unknown) => void,
        options?: ResourceParams,
    ): void;

    unsubscribe(routingKey: string): void;
}

interface TranslateService {
    instant(translationId: string, interpolateParams?: ResourceParams): string;

    preferredLanguage(): string;

    getTranslationTable(langKey: string): Record<string, unknown>;
}

interface ConfirmService {
    askOnDelete<TResult = unknown>(
        title: string,
        message: string,
        subtitle?: string,
    ): AngularPromise<TResult>;

    notify(type: string, message?: string, title?: string, time?: number): void;
}

interface ErrorHandlingService {
    permissionDenied(): void;
}

interface ProjectService {
    project: PersistentStructure | null;

    fetchProject(): AngularPromise<void> | undefined;

    hasPermission(permission: string): boolean;

    canEdit(permission: string): boolean;
}

interface StorageService {
    get<TValue>(key: string, _default?: TValue): TValue | null;

    set(key: string, val: unknown): void;
}

interface LightboxFactoryService {
    create(name: string, attrs?: ResourceParams, scopeAttrs?: ResourceParams): void;
}

interface LoaderService {
    start(auto?: boolean): void;

    pageLoaded(force?: boolean): void;
}

interface NavigationUrlsService {
    resolve(name: string, ctx?: ResourceParams): string;
}

interface FilterRemoteStorageService {
    storeFilters(
        projectId: number,
        myFilters: ResourceParams,
        filtersHashSuffix: string,
    ): AngularPromise<void>;

    getFilters<TFilters = ResourceParams>(
        projectId: number,
        filtersHashSuffix: string,
    ): AngularPromise<TFilters>;
}

interface AnalyticsService {
    trackEvent(category: string, action: string, label: string, value: number): void;
}

export interface AngularServices {
    $tgResources: TaigaResources;

    tgResources: TaigaResources2;

    $tgRepo: TaigaRepository;

    $tgModel: TaigaModelFactory;

    $tgEvents: TaigaEventsService;

    $translate: TranslateService;

    $tgConfirm: ConfirmService;

    tgErrorHandlingService: ErrorHandlingService;

    tgProjectService: ProjectService;

    $tgStorage: StorageService;

    tgLightboxFactory: LightboxFactoryService;

    tgLoader: LoaderService;

    $tgNavUrls: NavigationUrlsService;

    tgFilterRemoteStorageService: FilterRemoteStorageService;

    $tgAnalytics: AnalyticsService;
}

/* ==========================================================================
 * THE RUN-TIME ALLOW LIST
 * ========================================================================== */

/**
 * The names React is permitted to resolve, as VALUES rather than as types.
 *
 * Exactly the keys of {@link AngularServices}, restated once so the constraint
 * survives erasure. `keyof AngularServices` disappears at compile time, and it
 * only ever constrained a LITERAL argument in the first place: a name held in a
 * variable widens to `string`, and a caller that was never type-checked -- a
 * spec, a bundled consumer, anything reached through the bridge payload --
 * was never constrained at all. Without this list the hook below is an
 * injector-shaped hole in the seam: hand it `'$rootScope'` and React holds a
 * scope, hand it `'$injector'` and React holds the whole container, hand it
 * `'$http'` and React holds a transport that bypasses every interceptor the
 * migration exists to inherit.
 *
 * The two halves cannot drift apart: {@link assertServiceIsSanctioned} is typed
 * against `keyof AngularServices`, so removing a key from the interface without
 * removing it here (or the reverse) fails the type gate, and the co-located
 * spec asserts the two sets are equal.
 *
 * `as const` plus `Object.freeze` for the same reason the array is a module
 * constant at all: the list must not be extendable at run time by anything that
 * happens to hold a reference to it.
 */
export const SANCTIONED_SERVICE_NAMES: readonly (keyof AngularServices)[] = Object.freeze([
    '$tgResources',
    'tgResources',
    '$tgRepo',
    '$tgModel',
    '$tgEvents',
    '$translate',
    '$tgConfirm',
    'tgErrorHandlingService',
    'tgProjectService',
    '$tgStorage',
    'tgLightboxFactory',
    'tgLoader',
    '$tgNavUrls',
    'tgFilterRemoteStorageService',
    '$tgAnalytics',
] as const);

/**
 * Refuses any name that is not on {@link SANCTIONED_SERVICE_NAMES}.
 *
 * A THROW, never a warning and never a silent `undefined`. An unsanctioned
 * resolution that merely warned would still hand the caller the service, which
 * is the entire problem; and returning nothing would surface much later as an
 * unreadable property-of-undefined failure with nothing naming the cause.
 * Throwing is contained by the sibling `ErrorBoundary`, so the surrounding
 * AngularJS shell survives it (section 1 of that file).
 *
 * @param serviceName - the name the caller asked for, whatever its type says.
 * @throws Error when `serviceName` is not one of the sanctioned names.
 */
function assertServiceIsSanctioned(serviceName: string): void {
    if (SANCTIONED_SERVICE_NAMES.includes(serviceName as keyof AngularServices)) {
        return;
    }

    throw new Error(
        `useAngularService('${serviceName}') is not permitted: '${serviceName}' is not one ` +
            'of the AngularJS services React may resolve. Both AngularJS scope services, ' +
            'the promise service, the injector itself and the raw HTTP service are ' +
            'unreachable from React BY DESIGN -- a scope would invite the digest ' +
            'participation the migration forbids, and a raw transport would bypass the ' +
            'Authorization and session headers, the token-refresh, version-conflict and ' +
            'blocking interceptors, and the changed-fields-only versioned write behaviour ' +
            'that React inherits by going through the resource and repository layers. ' +
            'For AngularJS-event semantics use the bridge payload\'s onAngularEvent ' +
            'callback, which registers on the controller\'s own scope and returns its ' +
            'deregistration function. If the service genuinely belongs in React, add it to ' +
            `the AngularServices map in this file. Permitted: ${SANCTIONED_SERVICE_NAMES.join(', ')}.`,
    );
}

/* ==========================================================================
 * THE HOOKS
 * ========================================================================== */

/**
 * Both diagnostics exist because the alternative failures are opaque. Without a
 * provider the context is `null` and `get` would throw on `undefined`; and asking the
 * injector for an unregistered name throws AngularJS's own unresolved-provider error,
 * which names the provider rather than the caller. The messages below name the hook,
 * the service and the fix instead.
 */
function useAngularInjector(hookName: string, serviceName: string): AngularInjector {
    const injector = useContext(AngularBridgeContext);

    if (injector === null || injector === undefined) {
        throw new Error(
            `${hookName}('${serviceName}') was called outside <AngularBridgeProvider>. ` +
                'Every React subtree that resolves an AngularJS service must be ' +
                'mounted beneath AngularBridgeProvider, which ReactHostElement ' +
                'renders with the live AngularJS injector. In a unit test, wrap the ' +
                'component or hook under test in <AngularBridgeProvider injector={...}> ' +
                'with a stub exposing get(name).',
        );
    }

    return injector;
}

function assertServiceIsRegistered(
    injector: AngularInjector,
    hookName: string,
    serviceName: string,
): void {
    if (injector.has !== undefined && injector.has(serviceName) === false) {
        throw new Error(
            `${hookName}('${serviceName}') found no AngularJS service registered ` +
                `under that name. Check that the module declaring '${serviceName}' is ` +
                'listed in the application module array in app/coffee/app.coffee, and ' +
                'that the name matches its registration exactly -- note that ' +
                "'$tgResources' and 'tgResources' are two different services.",
        );
    }
}

export function useAngularService<K extends keyof AngularServices>(
    name: K,
): AngularServices[K] {
    // The run-time half of the map (see section 4). Checked BEFORE the injector
    // is even read, so an unsanctioned name cannot reach `get` on any path --
    // including from a caller that was never type-checked.
    assertServiceIsSanctioned(name);

    const injector = useAngularInjector('useAngularService', name);

    assertServiceIsRegistered(injector, 'useAngularService', name);

    return injector.get<AngularServices[K]>(name);
}

/* ==========================================================================
 * THE ONE NARROW OFF-MAP SEAM: A ROOT-SCOPE LISTENER REGISTRAR
 *
 * There is deliberately NO general-purpose, name-taking, `unknown`-returning
 * resolver in this module. One existed, and it was removed: a public
 * `(name: string) => unknown` accessor is an OPEN DOOR PAST THE ALLOW-LIST, and
 * an allow-list with an open door beside it is not an allow-list. It let any
 * downstream file resolve any service -- including both scope services and the
 * promise service that section 6 of the file header excludes on correctness
 * grounds -- while the type gate above went on advertising that React can only
 * reach fifteen reviewed names. `unknown` made each individual use safe to
 * dereference; it did nothing about WHICH services became reachable, which was
 * the actual guarantee.
 *
 * What replaces it is the narrowest thing that satisfies the one measured need:
 * a hook that resolves `$rootScope` and hands back its `$on` MEMBER SURFACE
 * ONLY. It takes no name, so it cannot be pointed at anything else; it returns a
 * typed one-member host, so no caller narrows an `unknown`; and it is a single
 * greppable symbol, so "who listens on the root scope?" is one search with a
 * complete answer.
 * ========================================================================== */

/**
 * Narrows an arbitrary injector answer to the `$on`-only surface of
 * {@link AngularBroadcastListener}.
 *
 * Structural, not nominal: it asks only whether the value can register a
 * listener. In the browser the answer is always yes -- the root scope is created
 * during bootstrap and lives as long as the document -- so the predicate earns
 * its keep in the two situations where the answer is no:
 *
 * - a unit test whose injector double carries no root scope, where the value is
 *   the nothing-value;
 * - a React root mounted before AngularJS has finished bootstrapping, where the
 *   injector may not be publishing services yet.
 *
 * @param candidate - whatever the injector returned.
 * @returns whether `candidate` exposes a callable `$on`.
 */
function isBroadcastListener(candidate: unknown): candidate is AngularBroadcastListener {
    if (typeof candidate !== 'object' || candidate === null) {
        return false;
    }

    if (!('$on' in candidate)) {
        return false;
    }

    return typeof candidate.$on === 'function';
}

/**
 * Resolves the ONE member of the AngularJS root scope React is permitted to
 * use: its event-listener registrar.
 *
 * @returns the `$on`-only registrar, or `null` when the injector has no usable
 *          root scope.
 * @throws Error when called outside `AngularBridgeProvider`, or when the
 *         injector positively reports `$rootScope` as unregistered.
 */
export function useAngularBroadcastListener(): AngularBroadcastListener | null {
    const injector = useAngularInjector('useAngularBroadcastListener', ROOT_SCOPE_SERVICE_NAME);

    assertServiceIsRegistered(
        injector,
        'useAngularBroadcastListener',
        ROOT_SCOPE_SERVICE_NAME,
    );

    const candidate = injector.get<unknown>(ROOT_SCOPE_SERVICE_NAME);

    return isBroadcastListener(candidate) ? candidate : null;
}

export type {
    AngularPromise,
    HttpHeadersGetter,
    AngularHttpResponse,
    PersistentStructure,
    TaigaModel,
    TaigaModelPatch,
    ResourceParams,
    // `$tgResources` namespaces
    UserStoryValueCollection,
    UserStoriesResource,
    SprintsResource,
    SwimlanesResource,
    KanbanResource,
    ProjectsResource,
    TaigaResources,
    AttachmentsResource,
    TaigaResources2,
    TaigaRepository,
    TaigaModelFactory,
    AngularLifecycleScope,
    AngularBroadcastListener,
    TaigaEventsService,
    TranslateService,
    ConfirmService,
    ErrorHandlingService,
    ProjectService,
    StorageService,
    LightboxFactoryService,
    LoaderService,
    NavigationUrlsService,
    FilterRemoteStorageService,
    AnalyticsService,
};
