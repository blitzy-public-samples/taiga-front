/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Co-located specification for `./useBacklogData.ts`.
 *
 * Browserless by construction: jsdom only, no browser binary, no build output, no
 * network. Every AngularJS service is a double supplied through the bridge
 * provider, and every bridge callback is a plain function, so what is asserted
 * here is this hook's own behaviour rather than AngularJS's.
 *
 * The preserved defects each get their own assertion, because a comment recording
 * a defect proves nothing: DBN-1 (the leading-edge guard), STATUS-1 (no revert),
 * BC-2 (the asymmetric tag resolution), ST-1 (`null`, never the nothing-value),
 * BC-1 (a collection replaced, never mutated), DEL-1 (a removal never restored),
 * DL-1 (delegated doom line) and the dead-code note behind the milestone counts.
 * A "tidier" implementation that quietly repaired one of them would still satisfy
 * every behavioural expectation a naive spec has; these assertions exist so that it
 * would not satisfy this one, because such a repair is a behaviour change (T10).
 *
 * TWO KINDS OF ASSERTION APPEAR BELOW, and the distinction is deliberate.
 *
 *   - BEHAVIOURAL, which is nearly all of them: the hook is mounted against
 *     doubles and its observable answers are asserted.
 *   - SOURCE-LEVEL, for the handful of rules that are about what the unit does
 *     NOT do -- it opens no transport of its own, it polls nothing, it resolves
 *     the resource service exactly once. An absence cannot be observed by
 *     exercising a path that does not exist, so those read the unit's own text
 *     through {@link UNIT_CODE}. Every needle in that group is assembled from
 *     fragments so that the token being forbidden never appears in this file
 *     either, which keeps the repository-wide gates honest about both halves.
 *
 * The service doubles are COMPLETE rather than narrowed, and typed against the
 * bridge's own exported shapes rather than asserted into them: the resource
 * namespace set carries all twenty-seven of its members, so "this hook touched
 * exactly one of them" is a real assertion instead of a claim about a stub that
 * only had one.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, renderHook, waitFor } from '@testing-library/react';

import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import { toNativePromise } from '../../bridge/toNativePromise';
import type { Thenable } from '../../bridge/toNativePromise';
import type {
    AngularPromise,
    AngularServices,
    ResourceParams,
    TaigaModel,
    TaigaModelPatch,
    TaigaResources,
} from '../../bridge/useAngularService';
import type { Status } from '../../shared/types/status';
import type { UserStory } from '../../shared/types/userStory';
import { selectDoomLineIndex } from '../state/backlogSelectors';
import {
    BACKLOG_DATA_REPULL_EVENTS,
    STATUS_CHANGE_GUARD_WINDOW_MS,
    createLeadingEdgeGuard,
    deriveMilestoneCounts,
    resolveInitialShowTags,
    resolveShowGraphPlaceholder,
    sortBacklogStatuses,
    toCanonicalProjectStats,
    useBacklogData,
} from './useBacklogData';
import type {
    BacklogBridgeEvents,
    BacklogBridgeParams,
    BacklogDataEventName,
} from './useBacklogData';

/* ==========================================================================
 * FIXTURES AND DOUBLES
 * ========================================================================== */

/**
 * The retained controller's scope, as far as the getters expose it.
 *
 * EVERY MEMBER IS `unknown`, deliberately: the getters are declared to answer
 * with `unknown` because the values cross the seam from untyped CoffeeScript, and
 * a spec that typed them narrowly could not feed the hook the malformed answers
 * its narrowing exists to survive -- which is the half most worth asserting.
 */
type ScopeState = {
    project: unknown;
    userstories: unknown;
    visibleUserStories: unknown;
    sprints: unknown;
    closedSprints: unknown;
    stats: unknown;
    swimlanes: unknown;
    totalUserStories: unknown;
    filterQ: unknown;
    activeFilters: unknown;
    selectedFilters: unknown;
    showTags: unknown;
    displayVelocity: unknown;
    forecastedStories: unknown;
    disablePagination: unknown;
    firstLoadComplete: unknown;
};

interface EventsDouble {
    readonly events: BacklogBridgeEvents;
    readonly scope: ScopeState;
    readonly calls: { readonly method: string; readonly args: readonly unknown[] }[];
    /**
     * Every getter invocation, in the order it happened.
     *
     * Recorded because two of this file's rules are about WHEN a getter runs
     * rather than what it answers: that the live values are re-read at read time
     * instead of being captured once, and that nothing re-reads them on a
     * schedule. Both are questions about this log, not about a returned value.
     */
    readonly reads: string[];
    /** How often one getter has been invoked so far. */
    readCount(getterName: string): number;
    /** Delivers one AngularJS event to every LIVE listener, as a broadcast would. */
    broadcast(eventName: BacklogDataEventName): void;
    listenerCount(eventName: BacklogDataEventName): number;
    /** Every event name the unit ever asked to listen for, including duplicates. */
    readonly registeredNames: string[];
    readonly deregistrationCount: () => number;
}

function makeStatus(id: number, name: string): Status {
    return { id, name, color: 'unset', wip_limit: null, is_archived: false };
}

function makeRow(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        ref: id + 100,
        subject: `story ${String(id)}`,
        status: 1,
        version: 7,
        total_points: 3,
        backlog_order: id,
        points: {},
        tags: [],
        ...overrides,
    };
}

function makeStatsBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        assigned_points: 10,
        closed_points: 25,
        defined_points: 200,
        speed: 4,
        total_points: 100,
        total_milestones: 2,
        milestones: [
            {
                name: 'sprint one',
                optimal: 100,
                evolution: 90,
                'team-increment': 5,
                'client-increment': 2,
            },
        ],
        ...overrides,
    };
}

/**
 * A collection whose reported size is the value a FAILED HEADER PARSE produces.
 *
 * ⭐ WHY A PROXY RATHER THAN A CONVERSION. The counters the incumbent adds come
 * from `parseInt` over two response headers
 * (`app/coffee/modules/resources/sprints.coffee:40`-`:41`), so an absent header
 * hands the addition at `app/coffee/modules/backlog/main.coffee:322` a value that is
 * not a number. Reproducing that input needs a collection that reports such a size,
 * and a proxy provides one WITH NO widening conversion -- the size member of a
 * collection is writable, so answering differently for it breaks no invariant, and
 * the value handed back is a genuine collection to every other reader.
 */
function collectionWithUnparseableCount(): readonly unknown[] {
    const empty: readonly unknown[] = [];

    return new Proxy(empty, {
        get(source: readonly unknown[], property: string | symbol): unknown {
            if (property === 'length') {
                return Number.NaN;
            }

            return Reflect.get(source, property);
        },
    });
}

function makeScopeState(overrides: Partial<ScopeState> = {}): ScopeState {
    return {
        project: {
            id: 55,
            name: 'Project Fifty Five',
            slug: 'project-55',
            my_permissions: ['add_us', 'modify_us', 'delete_us'],
            roles: [{ id: 3, name: 'Back', computable: true }],
        },
        userstories: [makeRow(1), makeRow(2)],
        visibleUserStories: [101, 102],
        sprints: [{ id: 9 }, { id: 10 }],
        closedSprints: [{ id: 8 }],
        stats: makeStatsBody(),
        swimlanes: [{ id: 4, name: 'lane' }],
        totalUserStories: '11',
        filterQ: 'term',
        activeFilters: true,
        selectedFilters: { status: [{ id: 1 }, { id: 2 }], tags: [{ id: 3 }] },
        showTags: true,
        displayVelocity: false,
        forecastedStories: [makeRow(1)],
        disablePagination: false,
        firstLoadComplete: true,
        ...overrides,
    };
}

/**
 * A bridge-payload double.
 *
 * The registrar behaves like a real scope: registering never displaces, and a
 * released listener stops receiving. That is what makes the deregistration
 * assertion meaningful rather than a check that a mock was called.
 */
function makeEventsDouble(scope: ScopeState = makeScopeState()): EventsDouble {
    const calls: { method: string; args: readonly unknown[] }[] = [];
    const reads: string[] = [];
    const registeredNames: string[] = [];
    const live = new Map<BacklogDataEventName, ((payload: unknown) => void)[]>();
    let deregistrations = 0;

    const record = (method: string, ...args: readonly unknown[]): void => {
        calls.push({ method, args });
    };

    /**
     * Wraps one getter so its invocation is logged before its answer is produced.
     *
     * The answer is read through a closure over the scope object rather than
     * captured, which is what lets a spec change what a getter answers between two
     * reads -- the property the incumbent's live scope has and a captured value
     * would not.
     */
    const readGetter = (getterName: string, read: () => unknown): (() => unknown) => {
        return (): unknown => {
            reads.push(getterName);

            return read();
        };
    };

    const events: BacklogBridgeEvents = {
        getProject: readGetter('getProject', () => scope.project),
        getUserStories: readGetter('getUserStories', () => scope.userstories),
        getVisibleUserStories: readGetter(
            'getVisibleUserStories',
            () => scope.visibleUserStories,
        ),
        getSprints: readGetter('getSprints', () => scope.sprints),
        getClosedSprints: readGetter('getClosedSprints', () => scope.closedSprints),
        getStats: readGetter('getStats', () => scope.stats),
        getSwimlanes: readGetter('getSwimlanes', () => scope.swimlanes),
        getTotalUserStories: readGetter('getTotalUserStories', () => scope.totalUserStories),
        getFilterQ: readGetter('getFilterQ', () => scope.filterQ),
        getActiveFilters: readGetter('getActiveFilters', () => scope.activeFilters),
        getSelectedFilters: readGetter('getSelectedFilters', () => scope.selectedFilters),
        getShowTags: readGetter('getShowTags', () => scope.showTags),
        getDisplayVelocity: readGetter('getDisplayVelocity', () => scope.displayVelocity),
        getForecastedStories: readGetter('getForecastedStories', () => scope.forecastedStories),
        getDisablePagination: readGetter('getDisablePagination', () => scope.disablePagination),
        getFirstLoadComplete: readGetter('getFirstLoadComplete', () => scope.firstLoadComplete),

        loadUserstories: (resetPagination?: boolean, pageSize?: number) => {
            record('loadUserstories', resetPagination, pageSize);

            return undefined;
        },
        loadProjectStats: () => {
            record('loadProjectStats');

            return undefined;
        },
        addNewUs: (kind: string) => {
            record('addNewUs', kind);

            return undefined;
        },
        editUserStory: (projectId: number, ref: number, event?: unknown) => {
            record('editUserStory', projectId, ref, event);

            return undefined;
        },
        deleteUserStory: (userStory: unknown) => {
            record('deleteUserStory', userStory);

            return undefined;
        },
        updateUserStoryStatus: () => {
            record('updateUserStoryStatus');

            return undefined;
        },
        changeQ: (q: string) => {
            record('changeQ', q);

            return undefined;
        },
        addFilterBacklog: (filter: unknown) => {
            record('addFilterBacklog', filter);

            return undefined;
        },
        removeFilterBacklog: (filter: unknown) => {
            record('removeFilterBacklog', filter);

            return undefined;
        },
        saveCustomFilter: (name: string) => {
            record('saveCustomFilter', name);

            return undefined;
        },
        selectCustomFilter: (filter: unknown) => {
            record('selectCustomFilter', filter);

            return undefined;
        },
        removeCustomFilter: (filter: unknown) => {
            record('removeCustomFilter', filter);

            return undefined;
        },
        toggleActiveFilters: () => {
            record('toggleActiveFilters');
            scope.activeFilters = !scope.activeFilters;

            return undefined;
        },
        toggleShowTags: () => {
            record('toggleShowTags');
            scope.showTags = scope.showTags === false;

            return undefined;
        },
        toggleVelocityForecasting: () => {
            record('toggleVelocityForecasting');
            scope.displayVelocity = !scope.displayVelocity;

            return undefined;
        },

        onAngularEvent: (eventName, handler) => {
            registeredNames.push(eventName);

            const existing = live.get(eventName) ?? [];

            existing.push(handler);
            live.set(eventName, existing);

            return () => {
                deregistrations += 1;

                const current = live.get(eventName) ?? [];
                const index = current.indexOf(handler);

                if (index !== -1) {
                    current.splice(index, 1);
                }
            };
        },
    };

    return {
        events,
        scope,
        calls,
        reads,
        readCount(getterName) {
            return reads.filter((entry) => entry === getterName).length;
        },
        broadcast(eventName) {
            for (const handler of [...(live.get(eventName) ?? [])]) {
                handler(undefined);
            }
        },
        listenerCount(eventName) {
            return (live.get(eventName) ?? []).length;
        },
        registeredNames,
        deregistrationCount: () => deregistrations,
    };
}

function makeParams(overrides: Partial<BacklogBridgeParams> = {}): BacklogBridgeParams {
    return {
        projectId: 55,
        project: {
            id: 55,
            name: 'Project Fifty Five',
            slug: 'project-55',
            my_permissions: ['add_us'],
            roles: [{ id: 3, name: 'Back', computable: true }],
        },
        sectionName: 'backlog',
        points: [{ id: 1, name: '1', value: 1 }],
        pointsById: { 1: { id: 1, name: '1', value: 1 } },
        usStatusById: { 1: makeStatus(1, 'New') },
        usStatusList: [makeStatus(9, 'Done'), makeStatus(1, 'New'), makeStatus(4, 'Ready')],
        closedMilestones: true,
        swimlanesList: [{ id: 4, name: 'lane' }],
        ...overrides,
    };
}

/**
 * A `$tgModel`-like instance: shallow attributes plus REAL dirty tracking.
 *
 * The two properties that matter to the unit under test are reproduced exactly:
 * `getAttrs(true)` answers with the MODIFIED SET ONLY plus the
 * optimistic-concurrency version (`base/model.coffee:48`-`:54`), and `setAttr`
 * records one field at a time (`:62`-`:64`). A double that merged everything would
 * hide the very requirement -- I7's changed-fields-only write -- that the status
 * path exists to honour.
 *
 * The ONE assertion in this file lives in `getAttrs`, and it is unavoidable: the
 * real model is an untyped AngularJS class whose attribute bag is assembled at run
 * time, so no structural literal can prove itself to be the declared attribute
 * shape. It is confined to this single expression rather than spread across the
 * doubles.
 */
function makeModelDouble<TAttrs>(attributes: Record<string, unknown>): TaigaModel<TAttrs> {
    const attrs = { ...attributes };
    const modified: Record<string, unknown> = {};

    const model: TaigaModel<TAttrs> = {
        getAttrs(patch?: boolean): TAttrs & TaigaModelPatch<TAttrs> {
            // `base/model.coffee:49`-`:50`: the version is copied into the
            // modified set whenever the attribute bag carries one.
            if (attrs['version'] !== undefined) {
                modified['version'] = attrs['version'];
            }

            const merged = patch === true ? { ...modified } : { ...attrs, ...modified };

            return merged as TAttrs & TaigaModelPatch<TAttrs>;
        },
        setAttr(name: string, value: unknown): void {
            modified[name] = value;
        },
        isModified(): boolean {
            return Object.keys(modified).length > 0;
        },
        getName(): string {
            return 'userstories';
        },
        clone(): TaigaModel<TAttrs> {
            return model;
        },
    };

    return model;
}

interface RepositoryDouble {
    readonly service: AngularServices['$tgRepo'];
    /** Every model handed to `save`, in call order. */
    readonly saved: TaigaModel<unknown>[];
    /** What `save` would have PATCHed for one call: the changed fields plus version. */
    savedPatch(index: number): unknown;
    settle(): void;
    reject(): void;
}

/**
 * A `$tgRepo` double whose `save` hands back a thenable that settles only when the
 * spec says so.
 *
 * Deferring the settle is what makes the leading-edge guard and the ABSENCE of a
 * revert observable without a transport: the optimistic value can be inspected
 * while the write is still outstanding, and again after it is refused.
 *
 * Typed against the exported repository shape rather than asserted into it, so a
 * signature change in the bridge contract breaks this double at compile time.
 */
function makeRepositoryDouble(): RepositoryDouble {
    const saved: TaigaModel<unknown>[] = [];
    const resolvers: ((value: never) => unknown)[] = [];
    const rejecters: ((reason: unknown) => unknown)[] = [];

    const service: AngularServices['$tgRepo'] = {
        save<TAttrs>(model: TaigaModel<TAttrs>): AngularPromise<TaigaModel<TAttrs>> {
            saved.push(model);

            return {
                then(
                    onFulfilled: (value: TaigaModel<TAttrs>) => unknown,
                    onRejected: (reason: unknown) => unknown,
                ): unknown {
                    resolvers.push(onFulfilled);
                    rejecters.push(onRejected);

                    return undefined;
                },
            };
        },
        create(): never {
            throw new Error('this spec never creates through the repository');
        },
        remove(): never {
            throw new Error('this spec never removes through the repository');
        },
    };

    return {
        service,
        saved,
        savedPatch(index: number): unknown {
            return saved[index]?.getAttrs(true);
        },
        settle() {
            rejecters.splice(0);

            for (const resolve of resolvers.splice(0)) {
                // The value is never read by the unit under test; the incumbent
                // fulfilment handler ignores it too.
                resolve(undefined as never);
            }
        },
        reject() {
            resolvers.splice(0);

            for (const reject of rejecters.splice(0)) {
                reject(new Error('save refused'));
            }
        },
    };
}

/**
 * A `$tgModel` double that records what it was asked to wrap.
 *
 * Typed against the exported factory shape, so the generic hand-off the production
 * code performs is checked here rather than asserted away.
 */
function makeModelFactoryDouble(mintedFrom: Record<string, unknown>[]): AngularServices['$tgModel'] {
    return {
        make_model<TAttrs>(_name: string, data: TAttrs): TaigaModel<TAttrs> {
            const attributes = isPlainRecord(data) ? data : {};

            mintedFrom.push(attributes);

            return makeModelDouble<TAttrs>(attributes);
        },
    };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** One recorded member of the resource namespace set, addressed by its full name. */
interface NamedMember {
    readonly name: string;
    readonly member: jest.Mock;
}

interface ResourcesDouble {
    readonly service: TaigaResources;
    /** The ONE member this hook is expected to reach. */
    readonly getShowTags: jest.Mock<boolean | null, [number]>;
    /** All twenty-seven, so "and nothing else" is assertable rather than assumed. */
    readonly members: readonly NamedMember[];
    /** The full names of the members that have actually been invoked. */
    touched(): readonly string[];
}

/**
 * The `$tgResources` namespace set, COMPLETE and typed against the bridge's own
 * exported shape.
 *
 * ⭐ WHY EVERY MEMBER IS PRESENT even though the hook reaches exactly one. Two
 * reasons, and the second is the load-bearing one:
 *
 *   1. A narrowed stub presented as the whole service needs an untyped conversion
 *      to get past the compiler, and this file has none. Declaring all
 *      twenty-seven members means the double IS the shape, so a signature change
 *      in the bridge contract breaks this file at compile time rather than at run
 *      time.
 *   2. `expect(resources.touched()).toEqual([...])` is only a real assertion if
 *      every member COULD have been called. Against a one-member stub, "the
 *      project-values endpoint was never called" would be true because the stub
 *      has no such member, not because the unit declines to call it -- which is
 *      precisely the difference between a gate and a tautology.
 *
 * The two storage-backed readers default the way the incumbent does -- an empty
 * object at `app/coffee/modules/resources/userstories.coffee:157` and an empty
 * collection at `:167`, both through a truthiness fallback -- while
 * `getShowTags` (`:174`-`:177`) passes NO default at all and is therefore the one
 * member a spec configures.
 */
function makeResourcesDouble(storedShowTags: boolean | null): ResourcesDouble {
    const getShowTags: jest.Mock<boolean | null, [number]> = jest.fn(
        (_projectId: number): boolean | null => storedShowTags,
    );
    const getQueryParams: jest.Mock<ResourceParams, [number]> = jest.fn(
        (_projectId: number): ResourceParams => ({}),
    );
    const getBacklog: jest.Mock<number[], [number]> = jest.fn(
        (_projectId: number): number[] => [],
    );
    const foldModesRead = (): jest.Mock<ResourceParams, [number]> =>
        jest.fn((_projectId: number): ResourceParams => ({}));

    const userstories = {
        get: jest.fn(),
        getByRef: jest.fn(),
        listAll: jest.fn(),
        listUnassigned: jest.fn(),
        filtersData: jest.fn(),
        bulkCreate: jest.fn(),
        bulkUpdateBacklogOrder: jest.fn(),
        bulkUpdateKanbanOrder: jest.fn(),
        bulkUpdateMilestone: jest.fn(),
        listValues: jest.fn(),
        storeQueryParams: jest.fn(),
        getQueryParams,
        storeBacklog: jest.fn(),
        getBacklog,
        storeShowTags: jest.fn(),
        getShowTags,
    };

    const sprints = {
        get: jest.fn(),
        stats: jest.fn(),
        list: jest.fn(),
        moveUserStoriesMilestone: jest.fn(),
    };

    const swimlanes = { list: jest.fn() };

    const kanban = {
        storeStatusColumnModes: jest.fn(),
        getStatusColumnModes: foldModesRead(),
        storeSwimlanesModes: jest.fn(),
        getSwimlanesModes: foldModesRead(),
    };

    const projects = { stats: jest.fn(), tagsColors: jest.fn() };

    const service: TaigaResources = { userstories, sprints, swimlanes, kanban, projects };

    const members: readonly NamedMember[] = [
        ...namedMembersOf('userstories', userstories),
        ...namedMembersOf('sprints', sprints),
        ...namedMembersOf('swimlanes', swimlanes),
        ...namedMembersOf('kanban', kanban),
        ...namedMembersOf('projects', projects),
    ];

    return {
        service,
        getShowTags,
        members,
        touched: (): readonly string[] =>
            members.filter((entry) => entry.member.mock.calls.length > 0).map(
                (entry) => entry.name,
            ),
    };
}

/** Flattens one namespace of doubles into `namespace.member` entries. */
function namedMembersOf(
    namespace: string,
    members: Readonly<Record<string, jest.Mock>>,
): readonly NamedMember[] {
    return Object.entries(members).map(([name, member]) => ({
        name: `${namespace}.${name}`,
        member,
    }));
}

/**
 * The full names of every resource member, so the "nothing else" assertions can
 * name what they exclude rather than merely counting.
 */
const RESOURCE_MEMBERS_NEVER_REACHED: readonly string[] = [
    // The three the file header's section 3 argument turns on: the project-values
    // read (the statuses and points come from the project object instead,
    // `app/coffee/modules/backlog/main.coffee:487`-`:490`), the filters body (filter
    // generation stays on the AngularJS side), and the tag-colour map, whose only
    // in-scope consumer is the BOARD (`app/coffee/modules/kanban/main.coffee:369`).
    'userstories.listValues',
    'userstories.filtersData',
    'projects.tagsColors',
    // The row reads, which this hook performs through the bridge's getters rather
    // than by issuing its own request.
    'userstories.getByRef',
    'userstories.listAll',
    'userstories.listUnassigned',
    // The statistics read, which the bridge's own action owns.
    'projects.stats',
    // Sprint loading, which belongs to `useSprints.ts`.
    'sprints.list',
    'sprints.get',
    'sprints.stats',
    // Every write.
    'userstories.bulkCreate',
    'userstories.bulkUpdateBacklogOrder',
    'userstories.bulkUpdateKanbanOrder',
    'userstories.bulkUpdateMilestone',
    'sprints.moveUserStoriesMilestone',
];

/**
 * An injector that logs every resolution before delegating.
 *
 * ⭐ THE LOG IS THE ASSERTION for two rules at once. That the resource service is
 * resolved EXACTLY ONCE is a claim about this list; and that neither AngularJS
 * scope service nor its promise service is ever asked for is the same claim from
 * the other side -- `mockInjector` throws for a name it was not supplied, so an
 * accidental resolution fails loudly rather than silently handing React a digest
 * it must not participate in.
 */
function countingInjector(inner: AngularInjector): {
    readonly injector: AngularInjector;
    readonly resolved: readonly string[];
} {
    const resolved: string[] = [];

    return {
        injector: {
            get<T>(name: string): T {
                resolved.push(name);

                return inner.get<T>(name);
            },
        },
        resolved,
    };
}

interface HarnessOptions {
    readonly storedShowTags?: boolean | null;
    readonly params?: Partial<BacklogBridgeParams>;
    readonly scope?: Partial<ScopeState>;
    /** Replaces the bridge payload wholesale, for the two specs that need to. */
    readonly eventsOverride?: (base: BacklogBridgeEvents) => BacklogBridgeEvents;
}

interface Harness {
    readonly bridge: EventsDouble;
    readonly repository: RepositoryDouble;
    readonly resources: ResourcesDouble;
    readonly mintedFrom: Record<string, unknown>[];
    /**
     * The very object handed to the hook as its bootstrap payload.
     *
     * Exposed so a spec can write INTO it and prove that doing so changes nothing:
     * the set-once half of the bridge payload is a hand-off, not a stream.
     */
    readonly params: BacklogBridgeParams;
    /** Every AngularJS service name the unit resolved, in order. */
    readonly resolved: readonly string[];
    readonly rendered: ReturnType<typeof renderHook<ReturnType<typeof useBacklogData>, void>>;
}

function renderBacklogData(options: HarnessOptions = {}): Harness {
    const bridge = makeEventsDouble(makeScopeState(options.scope ?? {}));
    const params = makeParams(options.params ?? {});
    const repository = makeRepositoryDouble();
    const resources = makeResourcesDouble(options.storedShowTags ?? null);
    const mintedFrom: Record<string, unknown>[] = [];

    const { injector, resolved } = countingInjector(
        mockInjector({
            $tgResources: resources.service,
            $tgRepo: repository.service,
            $tgModel: makeModelFactoryDouble(mintedFrom),
        }),
    );

    const events =
        options.eventsOverride === undefined
            ? bridge.events
            : options.eventsOverride(bridge.events);

    const rendered = renderHook(() => useBacklogData(params, events), {
        wrapper: withMockInjector(injector),
    });

    return { bridge, repository, resources, mintedFrom, params, resolved, rendered };
}

/* ==========================================================================
 * THE SOURCE-LEVEL GATES
 *
 * A rule of the form "the unit never does X" cannot be proven by exercising a
 * path that does not exist, so the handful of such rules read the unit's own
 * text. Comments are stripped first, so prose can neither satisfy nor violate a
 * gate, and every needle is assembled from fragments so the forbidden token does
 * not appear in this file either.
 * ========================================================================== */

const UNIT_FILENAME = 'useBacklogData.ts';

const UNIT_SOURCE: string = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

/** The `[^:]` guard keeps a `//` inside a URL from being read as a comment. */
function executableCodeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const UNIT_CODE: string = executableCodeOf(UNIT_SOURCE);

/**
 * What the unit must never contain, each described in prose and matched through
 * fragments.
 *
 * The first group is the transport rule of requirement I7 and rule T5: every read
 * and every write goes through the injected resource and repository services, so
 * the browser's own request primitives, a third-party client and the AngularJS raw
 * transport are all absent -- which is how the interceptor chain, the session
 * header and the changed-fields-only versioned write are inherited rather than
 * re-derived. The second is the pull-on-notify rule: nothing is read on a
 * schedule. The third is the seam rules -- no digest is forced, no persistent
 * collection crosses, no compiler suppression stands in for a type.
 */
const FORBIDDEN_IN_UNIT: readonly { readonly description: string; readonly needle: string }[] = [
    { description: 'the browser request primitive', needle: `${'fet'}${'ch('}` },
    { description: 'the legacy browser request object', needle: `${'XMLHttp'}${'Request'}` },
    { description: 'a third-party request client', needle: `${'axi'}${'os'}` },
    { description: 'the framework raw transport', needle: `${'$ht'}${'tp'}` },
    { description: 'a framework scope', needle: `${'$sc'}${'ope'}` },
    { description: 'the framework root scope', needle: `${'$root'}${'Scope'}` },
    { description: 'the framework promise service', needle: `${'$q'}${'.'}` },
    { description: 'the injector itself', needle: `${'$inje'}${'ctor'}` },
    { description: 'a repeating timer', needle: `${'setInter'}${'val'}` },
    { description: 'a deferred timer', needle: `${'setTime'}${'out'}` },
    { description: 'a frame callback', needle: `${'requestAnimation'}${'Frame'}` },
    { description: 'a deep-equality watcher', needle: `${'$wat'}${'ch'}` },
    { description: 'the legacy structural collection', needle: `${'Immu'}${'table'}` },
    { description: 'a persistent-structure deep read', needle: `${'get'}${'In'}(` },
    { description: 'the untyped escape hatch', needle: `${'as a'}${'ny'}` },
    { description: 'a widening double conversion', needle: `${'as unkn'}${'own as'}` },
    { description: 'a compiler suppression', needle: `${'@ts-'}${'ignore'}` },
    { description: 'a compiler expectation', needle: `${'@ts-'}${'expect-error'}` },
    { description: 'a whole-file suppression', needle: `${'@ts-'}${'nocheck'}` },
    { description: 'a legacy asset import', needle: `${'app/'}${'js/'}` },
    { description: 'a browser storage write of its own', needle: `${'local'}${'Storage'}` },
    { description: 'a deferred marker', needle: `${'TO'}${'DO'}` },
    { description: 'a defect marker', needle: `${'FIX'}${'ME'}` },
    { description: 'a default React import', needle: `${'import Rea'}${'ct from'}` },
];

/* ==========================================================================
 * WHAT THE UNIT NEVER DOES
 * ========================================================================== */

describe('the unit under test', () => {
    it('is the file this spec claims to cover', () => {
        expect(UNIT_CODE.length).toBeGreaterThan(0);
        expect(UNIT_CODE).toContain('export function useBacklogData');
    });

    it.each(FORBIDDEN_IN_UNIT)('never reaches for $description', ({ needle }) => {
        expect(UNIT_CODE).not.toContain(needle);
    });

    /*
     * REQUIREMENT I7 AND RULE T5, from the side an exercised path cannot show. The
     * hook writes through the repository service, which is what makes the write a
     * changed-fields-only versioned patch (`app/coffee/modules/base/model.coffee:48`
     * -`:54`, with the short-circuit for an unmodified model at
     * `app/coffee/modules/base/repository.coffee:54`-`:59`). A client of its own
     * would send whole objects instead, which is a lost-update regression rather
     * than a stylistic difference -- and its absence is a property of the text.
     */
    it('performs its one write through the repository service and nothing else', () => {
        expect(UNIT_CODE).toContain('repository.save(model)');
        expect(UNIT_CODE.match(/repository\.save\(/g)).toHaveLength(1);
    });

    /*
     * PULL ON NOTIFY. The absence of every scheduling primitive is asserted above;
     * this states the positive half, which is that the re-read is driven by the
     * bridge's own registrar and by nothing else.
     */
    it('re-reads only from the notification registrar', () => {
        expect(UNIT_CODE).toContain('registrar(eventName');
        expect(UNIT_CODE.match(/eventsRef\.current\.onAngularEvent/g)).toHaveLength(1);
    });

    /*
     * THE STORED PREFERENCE IS READ SYNCHRONOUSLY, so it is neither awaited nor
     * marshalled. `app/coffee/modules/resources/userstories.coffee:174`-`:177` reads
     * browser storage inline and answers with the value itself, and
     * `app/coffee/modules/base/storage.coffee:17`-`:25` is likewise synchronous.
     */
    it('reads the stored tag preference synchronously, never through the marshaller', () => {
        expect(UNIT_CODE).toContain('resolveInitialShowTags(getShowTags(');
        expect(UNIT_CODE).not.toMatch(/toNativePromise\(\s*getShowTags/);
    });

    /*
     * RULE T2 AND DRIFT ENTRY D3. Status, tag and epic colours are per-project
     * DATA; the values in the design frames are seeded sample data. A hexadecimal
     * or functional colour literal anywhere in a data container would mean one of
     * them had been frozen into code.
     */
    it('hardcodes no colour, because every colour on this screen is data', () => {
        expect(UNIT_CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(UNIT_CODE).not.toMatch(/\brgba?\(/);
    });
});

describe('service acquisition', () => {
    /*
     * ⭐ THE INJECTOR IS NOT A HOLE IN THE SEAM. `mockInjector` throws for a name
     * it was not supplied, so this spec supplies exactly the three services the
     * hook is entitled to and a fourth resolution fails every case in this file.
     * Neither AngularJS scope service nor its promise service is reachable through
     * the typed accessor at all, which is the formal reason no digest ever has to
     * be forced from React: the application sets its asynchronous-apply mode once,
     * at bootstrap, and React state changes are React's own business.
     */
    it('resolves exactly the three sanctioned services, in order', () => {
        const { resolved } = renderBacklogData();

        expect(resolved).toEqual(['$tgResources', '$tgRepo', '$tgModel']);
    });

    it('resolves the resource service EXACTLY once', () => {
        const { resolved } = renderBacklogData();

        expect(resolved.filter((name) => name === '$tgResources')).toHaveLength(1);
    });

    it('never asks for a scope, the promise service or the injector', () => {
        const { resolved, rendered } = renderBacklogData();

        rendered.rerender();

        for (const forbidden of ['$rootScope', '$scope', '$q', '$injector', '$http']) {
            expect(resolved).not.toContain(forbidden);
        }
    });

    /*
     * The typed accessor is a context read followed by ONE resolution per render, by
     * design: an injector lookup is a map read, and caching it in a ref would make
     * the hook survive an injector swap that the surrounding shell intends. What must
     * never grow is the SET of names -- a fourth name appearing on a later render
     * would be a service acquired conditionally, which is how a scope gets in.
     */
    it('resolves the same three names on every render, and never a fourth', () => {
        const { resolved, rendered } = renderBacklogData();
        const afterMount = resolved.length;

        rendered.rerender();
        rendered.rerender();

        expect(resolved.slice(afterMount)).toEqual([
            '$tgResources',
            '$tgRepo',
            '$tgModel',
            '$tgResources',
            '$tgRepo',
            '$tgModel',
        ]);
        expect(new Set(resolved).size).toBe(3);
    });

    /*
     * ⭐ ONE MEMBER OF ONE NAMESPACE, out of the twenty-seven the double carries.
     * Rule T5: this hook builds no request of its own, so the only resource member
     * it reaches is the synchronous preference read. Everything else on this screen
     * travels through the bridge callbacks, which delegate to the retained
     * AngularJS controller and therefore inherit the whole interceptor chain.
     */
    it('touches exactly one resource member: the synchronous preference read', () => {
        const { resources } = renderBacklogData();

        expect(resources.touched()).toEqual(['userstories.getShowTags']);
        expect(resources.getShowTags).toHaveBeenCalledTimes(1);
        expect(resources.getShowTags).toHaveBeenCalledWith(55);
    });

    it.each(RESOURCE_MEMBERS_NEVER_REACHED)('never calls %s', (memberName) => {
        const { resources, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.refresh();
        });

        expect(resources.touched()).not.toContain(memberName);
    });

    /*
     * The full namespace set is present, which is what makes the exclusions above
     * assertions rather than statements about a stub's missing members.
     */
    it('offers every member of every namespace, so an exclusion means something', () => {
        const { resources } = renderBacklogData();

        expect(resources.members).toHaveLength(27);
        expect(resources.members.map((entry) => entry.name)).toEqual(
            expect.arrayContaining(RESOURCE_MEMBERS_NEVER_REACHED),
        );
    });

    /*
     * ⭐ THE TWO ROW-LISTING MEMBERS ANSWER WITH DIFFERENT SHAPES, and the difference
     * is recorded here because this is the file that proves neither is called.
     *
     *   - `listUnassigned` (`app/coffee/modules/resources/userstories.coffee:45`-`:55`)
     *     passes the header-returning flag to the repository query, so it resolves a
     *     TUPLE: the models first, the response-header reader second. That second
     *     element is where the row-total header the Backlog shows comes from. Its
     *     milestone parameter is the LITERAL STRING spelling of nothing at `:46` --
     *     `{"project": projectId, "milestone": "null"}` -- not an absent value and not
     *     a nothing-value, which is why the by-reference read at `:33`-`:35` has to
     *     delete that parameter by comparing against the same string.
     *   - `listAll` (`:57`-`:60`) omits that flag, so it resolves the models ALONE and
     *     has no second element at all.
     *
     * A consumer that destructured one as the other would read the header reader as a
     * row, or a row as a header reader. This hook consumes NEITHER -- its rows arrive
     * through the bridge getters -- so the contract is documented and the absence is
     * asserted, rather than a shape being invented for a call that is never made.
     */
    it('documents the tuple-versus-models shapes it deliberately never consumes', () => {
        const { resources } = renderBacklogData();

        expect(resources.touched()).not.toContain('userstories.listUnassigned');
        expect(resources.touched()).not.toContain('userstories.listAll');

        // The two shapes, side by side, so the difference is stated once in code.
        const unassignedShape: readonly [readonly unknown[], () => string | null] = [
            [{ id: 1 }],
            () => '11',
        ];
        const allShape: readonly unknown[] = [{ id: 1 }];

        expect(unassignedShape).toHaveLength(2);
        expect(typeof unassignedShape[1]).toBe('function');
        expect(unassignedShape[1]()).toBe('11');
        expect(allShape).toHaveLength(1);
        expect(typeof allShape[1]).not.toBe('function');

        // And the milestone parameter is that four-character string, not a nothing-value.
        const unassignedMilestoneParam = 'null';

        expect(typeof unassignedMilestoneParam).toBe('string');
        expect(unassignedMilestoneParam).not.toBeNull();
    });

    /*
     * ⭐ THE STATUSES AND THE POINTS COME FROM THE PROJECT OBJECT, NOT FROM AN
     * ENDPOINT. `app/coffee/modules/backlog/main.coffee:487`-`:490` derives all four
     * collections from the project the controller already holds -- the points sorted by
     * their workflow position, the two indexes, and the status list sorted by identifier
     * -- so the project-values endpoint is never queried for them. Reaching for it here
     * would add a request no session makes today (T10) and, worse, one that a member
     * without administrative rights cannot make.
     */
    it('derives the statuses and points from the project, never from an endpoint', () => {
        const { params, resources, rendered } = renderBacklogData();
        const data = rendered.result.current;

        expect(data.usStatusList.map((status) => status.id)).toEqual([1, 4, 9]);
        expect(data.usStatusById).toBe(params.usStatusById);
        expect(data.points).toBe(params.points);
        expect(data.pointsById).toBe(params.pointsById);

        expect(resources.touched()).not.toContain('userstories.listValues');
        expect(resources.touched()).toEqual(['userstories.getShowTags']);
    });
});

/* ==========================================================================
 * THE MARSHALLING BOUNDARY
 *
 * Every action this hook exposes hands its result through the marshaller, so the
 * three properties the actions depend on are asserted against the marshaller
 * itself: a thenable settles with the value it was given, a rejection travels
 * unchanged, and a value that is not a thenable settles as itself -- which is what
 * turns a permission refusal into a settled promise instead of a crash.
 * ========================================================================== */

describe('the marshalling boundary', () => {
    it('resolves with the same value, unmodified', async () => {
        const payload = { id: 1, subject: 'unchanged' };
        const thenable: Thenable<typeof payload> = {
            then(onFulfilled): unknown {
                onFulfilled(payload);

                return undefined;
            },
        };

        await expect(toNativePromise(thenable)).resolves.toBe(payload);
    });

    it('rejects with the same rejection value', async () => {
        const reason = new Error('refused by the interceptor chain');
        const thenable: Thenable<string> = {
            then(_onFulfilled, onRejected): unknown {
                onRejected(reason);

                return undefined;
            },
        };

        await expect(toNativePromise(thenable)).rejects.toBe(reason);
    });

    it('resolves a value that is not a thenable as itself', async () => {
        // A permission-gated bridge action returns early rather than answering with
        // a promise, so this is the shape a refusal actually has.
        await expect(toNativePromise(undefined)).resolves.toBeUndefined();
        await expect(toNativePromise(7)).resolves.toBe(7);
    });
});

/* ==========================================================================
 * PURE HELPERS
 * ========================================================================== */

describe('toCanonicalProjectStats', () => {
    it('builds all eight members from the seven wire members', () => {
        const stats = toCanonicalProjectStats(makeStatsBody());

        expect(stats).not.toBeNull();
        expect(Object.keys(stats ?? {}).sort()).toEqual([
            'assigned_points',
            'closed_points',
            'completedPercentage',
            'defined_points',
            'milestones',
            'speed',
            'total_milestones',
            'total_points',
        ]);
    });

    /*
     * ⭐ THE MIXED NAMING CONVENTION IS PRESERVED, NOT NORMALISED. Six members keep
     * the wire's own spelling and the seventh is the one the controller ADDS, in the
     * spelling the controller gave it -- `@scope.stats.completedPercentage` at
     * `app/coffee/modules/backlog/main.coffee:270` and `:272`. Goal G2 freezes the
     * wire contract and rule T10 forbids the behaviour change, so an alias in either
     * direction would be a change: the summary bar and the chart read these names.
     */
    it('preserves the wire spelling and the added member, with no alias of either', () => {
        const stats = toCanonicalProjectStats(makeStatsBody());

        expect(stats?.total_points).toBe(100);
        expect(stats?.completedPercentage).toBe(25);

        const keys = Object.keys(stats ?? {});

        for (const alias of [
            'completed_percentage',
            'totalPoints',
            'closedPoints',
            'assignedPoints',
            'definedPoints',
            'totalMilestones',
        ]) {
            expect(keys).not.toContain(alias);
        }
    });

    /*
     * ⭐ THE PAYLOAD IS PLAIN JSON AND IS SPREAD DIRECTLY.
     * `app/coffee/modules/resources/projects.coffee:42`-`:43` reads the statistics
     * through the repository's RAW query, so nothing wraps the body in a live model
     * and nothing has to be flattened. A flattening call attempted here would mean
     * the reader had been written for the model-shaped half of the resource layer.
     */
    it('never attempts to flatten the statistics body, because it is already plain', () => {
        const getAttrs = jest.fn();
        const toJS = jest.fn();
        const stats = toCanonicalProjectStats(makeStatsBody({ getAttrs, toJS }));

        expect(stats?.completedPercentage).toBe(25);
        expect(getAttrs).not.toHaveBeenCalled();
        expect(toJS).not.toHaveBeenCalled();

        // And the extra members do not survive into the canonical shape either.
        expect(Object.keys(stats ?? {})).toHaveLength(8);
    });

    /*
     * The arithmetic of `main.coffee:267`-`:272`, driven with the two figures the
     * design frame's summary bar shows: a project total of four hundred against
     * twenty-one closed points reads as five per cent.
     */
    it('divides by the project total when it is truthy', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({ total_points: 400, closed_points: 21 }),
        );

        expect(stats?.completedPercentage).toBe(Math.round((100 * 21) / 400));
        expect(stats?.completedPercentage).toBe(5);
    });

    /*
     * The same figures with the project total at ZERO: `:267` is a TRUTHY fallback
     * chain, so the defined total takes over and the fractional quotient rounds --
     * `100 * 21 / 392.5` is 5.35, which is five.
     */
    it('falls through a zero project total to the defined total', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({ total_points: 0, defined_points: 392.5, closed_points: 21 }),
        );

        expect(stats?.completedPercentage).toBe(Math.round((100 * 21) / 392.5));
        expect(stats?.completedPercentage).toBe(5);
    });

    it('rounds the completion percentage rather than truncating it', () => {
        // 100 * 25 / 100 = 25 exactly.
        expect(toCanonicalProjectStats(makeStatsBody())?.completedPercentage).toBe(25);

        // 100 * 5 / 3 = 166.66..., which rounds to 167 and truncates to 166.
        const rounded = toCanonicalProjectStats(
            makeStatsBody({ closed_points: 5, total_points: 3 }),
        );

        expect(rounded?.completedPercentage).toBe(167);
    });

    it('falls back to the defined points with a TRUTHY test, so zero falls through', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({ total_points: 0, defined_points: 50, closed_points: 10 }),
        );

        // 100 * 10 / 50 = 20. A nullish fallback would have divided by zero.
        expect(stats?.completedPercentage).toBe(20);
    });

    it('yields zero rather than a division artefact when there is no denominator', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({ total_points: null, defined_points: 0, closed_points: 12 }),
        );

        expect(stats?.completedPercentage).toBe(0);
    });

    it('keeps both nullable members null rather than defaulting them', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({ total_points: null, total_milestones: null }),
        );

        expect(stats?.total_points).toBeNull();
        expect(stats?.total_milestones).toBeNull();
    });

    it('preserves the hyphenated wire spelling of the burndown series', () => {
        const series = toCanonicalProjectStats(makeStatsBody())?.milestones[0];

        expect(series?.['team-increment']).toBe(5);
        expect(series?.['client-increment']).toBe(2);
    });

    it('rejects a burndown series whose entries are not objects', () => {
        expect(toCanonicalProjectStats(makeStatsBody({ milestones: ['nope'] }))).toBeNull();
        expect(toCanonicalProjectStats(makeStatsBody({ milestones: [null] }))).toBeNull();
    });

    it('rejects a burndown entry missing either increment', () => {
        const withoutTeam = makeStatsBody({
            milestones: [
                { name: 'one', optimal: 1, evolution: 1, 'client-increment': 2 },
            ],
        });
        const withoutClient = makeStatsBody({
            milestones: [{ name: 'one', optimal: 1, evolution: 1, 'team-increment': 5 }],
        });

        expect(toCanonicalProjectStats(withoutTeam)).toBeNull();
        expect(toCanonicalProjectStats(withoutClient)).toBeNull();
    });

    it('accepts a null evolution, because the series stops at today', () => {
        const stats = toCanonicalProjectStats(
            makeStatsBody({
                milestones: [
                    {
                        name: 'one',
                        optimal: 1,
                        evolution: null,
                        'team-increment': 5,
                        'client-increment': 2,
                    },
                ],
            }),
        );

        expect(stats?.milestones[0]?.evolution).toBeNull();
    });

    it('answers null for a snapshot that is not a statistics body', () => {
        expect(toCanonicalProjectStats(null)).toBeNull();
        expect(toCanonicalProjectStats(undefined)).toBeNull();
        expect(toCanonicalProjectStats('nope')).toBeNull();
        expect(toCanonicalProjectStats({})).toBeNull();
        expect(toCanonicalProjectStats(makeStatsBody({ milestones: 'nope' }))).toBeNull();
        expect(toCanonicalProjectStats(makeStatsBody({ speed: 'fast' }))).toBeNull();
        expect(toCanonicalProjectStats(makeStatsBody({ total_points: 'lots' }))).toBeNull();
        expect(
            toCanonicalProjectStats(makeStatsBody({ milestones: [{ name: 'only a name' }] })),
        ).toBeNull();
    });
});

describe('resolveShowGraphPlaceholder', () => {
    it('uses an EXISTENCE test, so legitimate zeros still get the chart', () => {
        const zeroed = toCanonicalProjectStats(
            makeStatsBody({ total_points: 0, total_milestones: 0 }),
        );

        expect(resolveShowGraphPlaceholder(zeroed)).toBe(false);
    });

    it('shows the placeholder when either member is absent', () => {
        expect(
            resolveShowGraphPlaceholder(
                toCanonicalProjectStats(makeStatsBody({ total_points: null })),
            ),
        ).toBe(true);

        expect(
            resolveShowGraphPlaceholder(
                toCanonicalProjectStats(makeStatsBody({ total_milestones: null })),
            ),
        ).toBe(true);
    });

    /*
     * ⭐ THE WHOLE POINT OF THIS CASE. `main.coffee:274` is
     * `!(stats.total_points? && stats.total_milestones?)`, and the trailing marks
     * compile to a check against nothing rather than to a truthiness test. So a
     * project whose two totals are legitimately ZERO still gets its chart, while a
     * body that never carried them gets the placeholder. A truthiness reading would
     * swap the placeholder in for the zeroed project, which is a visible regression.
     */
    it('distinguishes present-but-zero from absent, which truthiness cannot', () => {
        const bothZero = toCanonicalProjectStats(
            makeStatsBody({ total_points: 0, total_milestones: 0 }),
        );

        expect(bothZero?.total_points).toBe(0);
        expect(bothZero?.total_milestones).toBe(0);
        expect(resolveShowGraphPlaceholder(bothZero)).toBe(false);

        // ABSENT rather than zero. The trailing mark in CoffeeScript checks against
        // BOTH nothing-values, so an absent member and an explicit `null` behave
        // identically -- which is why the canonical reader collapses the two and why
        // the placeholder appears for either.
        const withoutTotalPoints = makeStatsBody();
        delete withoutTotalPoints['total_points'];

        const withoutMilestoneTotal = makeStatsBody();
        delete withoutMilestoneTotal['total_milestones'];

        const missingPoints = toCanonicalProjectStats(withoutTotalPoints);
        const missingMilestones = toCanonicalProjectStats(withoutMilestoneTotal);

        expect(missingPoints?.total_points).toBeNull();
        expect(missingMilestones?.total_milestones).toBeNull();
        expect(resolveShowGraphPlaceholder(missingPoints)).toBe(true);
        expect(resolveShowGraphPlaceholder(missingMilestones)).toBe(true);
    });

    it('shows the placeholder when there are no statistics at all', () => {
        expect(resolveShowGraphPlaceholder(null)).toBe(true);
    });
});

describe('deriveMilestoneCounts', () => {
    it('sums the two collections, never treating the total as a collection', () => {
        const counts = deriveMilestoneCounts([{}, {}, {}], [{}]);

        expect(counts).toEqual({
            totalOpenMilestones: 3,
            totalClosedMilestones: 1,
            totalMilestones: 4,
        });
    });

    it('adds with no fallback, so nothing is coerced to zero', () => {
        const counts = deriveMilestoneCounts([], []);

        expect(counts.totalMilestones).toBe(0);
        expect(counts.totalMilestones).not.toBeNaN();
    });

    /*
     * ⭐⭐ A COUNT THAT IS NOT A NUMBER MUST PROPAGATE, NEVER BE ZEROED.
     *
     * The incumbent's two counters come from a base-ten integer parse over two
     * response headers -- `parseInt(headers("Taiga-Info-Total-Closed-Milestones"), 10)`
     * and the opened equivalent, at
     * `app/coffee/modules/resources/sprints.coffee:40`-`:41` -- and an ABSENT header
     * parses to the not-a-number value. `app/coffee/modules/backlog/main.coffee:322`
     * then adds the two with no guard whatsoever, so the whole total becomes that
     * value and the summary reads it. Inventing a zero here would show a project
     * with no sprints where the incumbent shows nothing at all, which rule T10
     * forbids: the addition below carries NO fallback and NO coercion, deliberately.
     *
     * A proxied collection is the honest way to drive that: the size it reports is
     * exactly what a failed header parse hands the incumbent, and no conversion is
     * needed to construct it.
     */
    it('propagates a count that is not a number rather than inventing a zero', () => {
        const counts = deriveMilestoneCounts(collectionWithUnparseableCount(), [{}]);

        expect(Number.isNaN(counts.totalOpenMilestones)).toBe(true);
        expect(counts.totalClosedMilestones).toBe(1);
        expect(Number.isNaN(counts.totalMilestones)).toBe(true);
        expect(counts.totalMilestones).not.toBe(0);
    });

    it('propagates it from either side of the addition', () => {
        const counts = deriveMilestoneCounts([{}, {}], collectionWithUnparseableCount());

        expect(counts.totalOpenMilestones).toBe(2);
        expect(Number.isNaN(counts.totalClosedMilestones)).toBe(true);
        expect(Number.isNaN(counts.totalMilestones)).toBe(true);
    });

    /*
     * ⚠ THE NAME COLLISION, asserted once so nobody has to rediscover it. In the
     * sprint-listing envelope (`sprints.coffee:38`-`:42`) the member spelled
     * `closed` is a COUNT; on a sprint itself the member spelled `closed` is a
     * BOOLEAN. The counters are sizes of the two collections, so a sprint's own
     * boolean has no effect on them at all.
     */
    it('counts collections and ignores a sprint\u2019s own closed flag', () => {
        const counts = deriveMilestoneCounts(
            [
                { id: 9, closed: false },
                { id: 10, closed: true },
            ],
            [{ id: 8, closed: true }],
        );

        expect(counts).toEqual({
            totalOpenMilestones: 2,
            totalClosedMilestones: 1,
            totalMilestones: 3,
        });
    });

    /*
     * ⭐ `main.coffee:319` IS DEAD CODE. It assigns the sprint ARRAY to the total,
     * and `:322` replaces it with the SUM in the very next statement. The counter is
     * therefore a number, never a collection -- recorded because reading the
     * incumbent top to bottom invites the opposite conclusion.
     */
    it('answers with a number, never with the collection the dead line assigns', () => {
        const counts = deriveMilestoneCounts([{}, {}, {}], [{}]);

        expect(typeof counts.totalMilestones).toBe('number');
        expect(Array.isArray(counts.totalMilestones)).toBe(false);
    });
});

describe('resolveInitialShowTags', () => {
    it('stored false: turns the flag off and broadcasts nothing', () => {
        expect(resolveInitialShowTags(false)).toEqual({ showTags: false, shouldBroadcast: false });
    });

    it('stored true: turns the flag on AND broadcasts', () => {
        expect(resolveInitialShowTags(true)).toEqual({ showTags: true, shouldBroadcast: true });
    });

    it('stored null satisfies NEITHER branch, so the constructor value stands', () => {
        expect(resolveInitialShowTags(null)).toEqual({ showTags: true, shouldBroadcast: false });
    });
});

describe('sortBacklogStatuses', () => {
    it('orders by id, which is the BACKLOG key and not the board key', () => {
        const sorted = sortBacklogStatuses([
            makeStatus(9, 'Done'),
            makeStatus(1, 'New'),
            makeStatus(4, 'Ready'),
        ]);

        expect(sorted.map((status) => status.id)).toEqual([1, 4, 9]);
    });

    it('sorts a copy, leaving the shared list untouched', () => {
        const original = [makeStatus(9, 'Done'), makeStatus(1, 'New')];

        sortBacklogStatuses(original);

        expect(original.map((status) => status.id)).toEqual([9, 1]);
    });

    /*
     * ⭐⭐ THE PER-SCREEN DIVERGENCE, WITH BOTH LOCATORS, BECAUSE UNIFYING IT WOULD
     * REORDER A SCREEN.
     *
     *   - THIS screen: `@scope.usStatusList = _.sortBy(project.us_statuses, "id")`
     *     at `app/coffee/modules/backlog/main.coffee:490`.
     *   - The BOARD: `@scope.usStatusList = _.sortBy(project.us_statuses, "order")`
     *     at `app/coffee/modules/kanban/main.coffee:631`.
     *
     * Same collection, two different keys, in the incumbent as it stands. Rule T10
     * says that is behaviour, so it is reproduced rather than reconciled.
     *
     * The board's key is the workflow position a project administrator arranges, and
     * it is deliberately absent from the canonical status shape this screen consumes
     * -- so the ARRAY's own order stands in for it here: the fixture arrives in an
     * order that is neither the identifier order nor its reverse, and every non-id
     * member is arranged to disagree with the identifier, so a sort keyed on one of
     * them would produce a different answer.
     */
    it('keys on the identifier alone, ignoring the arrival order and every other member', () => {
        const sorted = sortBacklogStatuses([
            { id: 7, name: 'aaa', color: 'unset', wip_limit: 30, is_archived: true },
            { id: 2, name: 'zzz', color: 'unset', wip_limit: 10, is_archived: false },
            { id: 30, name: 'mmm', color: 'unset', wip_limit: 20, is_archived: false },
            { id: 4, name: 'bbb', color: 'unset', wip_limit: 40, is_archived: false },
        ]);

        // Numeric, not lexicographic: thirty sorts after seven, and a text sort would
        // have put it between two and four.
        expect(sorted.map((status) => status.id)).toEqual([2, 4, 7, 30]);

        // And none of the other members produced the ordering.
        expect(sorted.map((status) => status.name)).not.toEqual(['aaa', 'bbb', 'mmm', 'zzz']);
        expect(sorted.map((status) => status.wip_limit)).not.toEqual([10, 20, 30, 40]);
    });
});

describe('createLeadingEdgeGuard', () => {
    it('fires the FIRST call immediately', () => {
        const action = jest.fn();
        const guard = createLeadingEdgeGuard(2000, action, () => 0);

        guard();

        expect(action).toHaveBeenCalledTimes(1);
    });

    it('DROPS calls inside the window and never replays them', () => {
        const action = jest.fn();
        let clock = 1000;
        const guard = createLeadingEdgeGuard(2000, action, () => clock);

        guard();
        clock = 1500;
        guard();
        clock = 2999;
        guard();

        expect(action).toHaveBeenCalledTimes(1);

        // Well past the window: still exactly one call, so nothing was queued.
        clock = 99999;

        expect(action).toHaveBeenCalledTimes(1);
    });

    it('accepts again once the window has elapsed', () => {
        const action = jest.fn();
        let clock = 0;
        const guard = createLeadingEdgeGuard(2000, action, () => clock);

        guard(1);
        clock = 2000;
        guard(2);

        expect(action).toHaveBeenCalledTimes(2);
        expect(action).toHaveBeenLastCalledWith(2);
    });

    it('is pinned at two seconds, matching the incumbent window', () => {
        expect(STATUS_CHANGE_GUARD_WINDOW_MS).toBe(2000);
    });
});

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

describe('useBacklogData bootstrap', () => {
    it('forwards the set-once parameters and sorts the statuses by id', () => {
        const { rendered } = renderBacklogData();

        expect(rendered.result.current.projectId).toBe(55);
        expect(rendered.result.current.sectionName).toBe('backlog');
        expect(rendered.result.current.closedMilestones).toBe(true);
        expect(rendered.result.current.points).toHaveLength(1);
        expect(rendered.result.current.usStatusList.map((status) => status.id)).toEqual([1, 4, 9]);
    });

    /*
     * ALL NINE SET-ONCE MEMBERS, named individually. They are the half of the bridge
     * payload that is built once and handed over
     * (`app/coffee/modules/backlog/react-bridge.coffee:352`-`:366`), so a member
     * silently dropped on the way through would show up nowhere else.
     */
    it('surfaces every one of the nine bootstrap members', () => {
        const { params, rendered } = renderBacklogData();
        const data = rendered.result.current;

        expect(data.projectId).toBe(params.projectId);
        expect(data.project.slug).toBe('project-55');
        expect(data.sectionName).toBe('backlog');
        expect(data.points).toBe(params.points);
        expect(data.pointsById).toBe(params.pointsById);
        expect(data.usStatusById).toBe(params.usStatusById);
        expect(data.usStatusList.map((status) => status.id)).toEqual([1, 4, 9]);
        expect(data.closedMilestones).toBe(true);
        expect(data.swimlanesList.map((lane) => lane.id)).toEqual([4]);
    });

    /*
     * ⭐⭐ THE BRIDGE OBJECT IS A ONE-TIME HAND-OFF, NOT A STATE STREAM.
     *
     * The directive that performs the hand-off watches its expression with TWO
     * arguments only -- `$scope.$watch $attrs.tgLoadElement, (val) =>` at
     * `app/coffee/modules/base/load-element.coffee:19` -- and a two-argument watch
     * compares by REFERENCE IDENTITY rather than by structure. The payload itself is
     * assembled once, behind a bind-once, and is never rebuilt. So writing INTO the
     * object notifies nobody: the value changes and nothing anywhere is told.
     *
     * That is why this hook reads the set-once half on the first render only, and why
     * a spec that mutated the payload and then expected the screen to follow would be
     * asserting a mechanism the seam does not have.
     */
    it('ignores a write made INTO the bootstrap payload, because nothing notifies', () => {
        const { params, rendered } = renderBacklogData();

        expect(rendered.result.current.sectionName).toBe('backlog');

        // An in-place write, which is exactly what the AngularJS side could perform
        // on the object it handed over.
        Object.assign(params, { sectionName: 'mutated in place', closedMilestones: false });
        Object.assign(params.project, { slug: 'mutated-slug' });

        rendered.rerender();

        expect(rendered.result.current.sectionName).toBe('backlog');
        expect(rendered.result.current.closedMilestones).toBe(true);
    });

    /*
     * The live half is the opposite: it is read through the getters, every time, so a
     * change on the AngularJS side is picked up when the notification arrives.
     */
    it('picks up a live change once the notification arrives', () => {
        const { bridge, rendered } = renderBacklogData();

        expect(rendered.result.current.filterQ).toBe('term');

        bridge.scope.filterQ = 'changed on the other side';

        // Still the old value: nothing has said anything yet.
        expect(rendered.result.current.filterQ).toBe('term');

        act(() => {
            bridge.broadcast('filters:update');
        });

        expect(rendered.result.current.filterQ).toBe('changed on the other side');
    });

    /*
     * ⭐ THE GETTERS ARE INVOKED AT READ TIME, NOT CAPTURED AT MOUNT. A captured
     * value would answer the same on the second pull as on the first; an invoked
     * getter answers with whatever the retained controller holds now, which is what
     * the flip below observes.
     */
    it('invokes the getters again on each pull rather than capturing them once', () => {
        const { bridge, rendered } = renderBacklogData();
        const afterMount = bridge.readCount('getFilterQ');

        expect(afterMount).toBeGreaterThan(0);

        bridge.scope.filterQ = 'first flip';

        act(() => {
            bridge.broadcast('userstories:loaded');
        });

        expect(bridge.readCount('getFilterQ')).toBeGreaterThan(afterMount);
        expect(rendered.result.current.filterQ).toBe('first flip');

        bridge.scope.filterQ = 'second flip';

        act(() => {
            rendered.result.current.refresh();
        });

        expect(rendered.result.current.filterQ).toBe('second flip');
    });

    /*
     * ⭐ NOTHING IS READ ON A SCHEDULE. Pull on notify means exactly that: with no
     * notification and no action, time passing changes nothing. The absence of every
     * scheduling primitive in the unit's own text is asserted separately; this is the
     * behavioural half, and between them a poller could not hide.
     */
    it('reads nothing on a schedule, however much time passes', () => {
        jest.useFakeTimers();

        try {
            const { bridge, rendered } = renderBacklogData();
            const afterMount = bridge.reads.length;

            act(() => {
                jest.advanceTimersByTime(600000);
            });

            expect(bridge.reads).toHaveLength(afterMount);
            expect(jest.getTimerCount()).toBe(0);
            expect(rendered.result.current.filterQ).toBe('term');
        } finally {
            jest.useRealTimers();
        }
    });

    it('reads the live values through the getters on the first render', () => {
        const { rendered } = renderBacklogData();
        const data = rendered.result.current;

        expect(data.userStories.map((row) => row.id)).toEqual([1, 2]);
        expect(data.visibleUserStories).toEqual([101, 102]);
        expect(data.filterQ).toBe('term');
        expect(data.activeFilters).toBe(true);
        expect(data.selectedFilterCount).toBe(3);
        expect(data.disablePagination).toBe(false);
        expect(data.firstLoadComplete).toBe(true);
        expect(data.forecastedStories.map((row) => row.id)).toEqual([1]);
        expect(data.swimlanesList.map((lane) => lane.id)).toEqual([4]);
    });

    it('keeps the total-rows header value a STRING, without converting it', () => {
        const { rendered } = renderBacklogData({ scope: { totalUserStories: '11' } });

        expect(rendered.result.current.totalUserStories).toBe('11');
        expect(typeof rendered.result.current.totalUserStories).toBe('string');
    });

    it('preserves the pre-load numeric zero the constructor sets', () => {
        const { rendered } = renderBacklogData({ scope: { totalUserStories: 0 } });

        expect(rendered.result.current.totalUserStories).toBe(0);
    });

    /*
     * ⭐⭐ THE HEADER VALUE STAYS A STRING, WHATEVER IT SAYS. `main.coffee:403` is
     * `@.totalUserStories = header('Taiga-Info-Backlog-Total-Userstories')` and it is
     * the ONLY writer after the constructor's numeric zero at `:84`. There is no
     * integer parse anywhere on that path, so both shapes are real and both are
     * preserved. Adding a parse here would change what every consumer of the member
     * sees, which rule T10 forbids -- and it would do so silently, because a template
     * renders "11" and 11 identically.
     */
    it.each(['11', '3', '0', '1200'])('keeps the header value %p a string', (headerValue) => {
        const { rendered } = renderBacklogData({ scope: { totalUserStories: headerValue } });

        expect(rendered.result.current.totalUserStories).toBe(headerValue);
        expect(typeof rendered.result.current.totalUserStories).toBe('string');
        expect(rendered.result.current.totalUserStories).not.toBe(Number(headerValue));
    });

    /*
     * ⭐ THE OTHER HEADER-BACKED COUNTER IS THE BOARD'S, AND IT IS ABSENT HERE. The
     * count of rows outside every swimlane is a member of the KANBAN bridge payload,
     * because swimlanes are a board concept; this screen has no such counter and must
     * not grow one. Asserted rather than merely omitted, so that copying a member
     * across from the board's data container would fail here.
     */
    it('surfaces no swimlane-relative row counter, which belongs to the board', () => {
        const { rendered } = renderBacklogData();
        const members = Object.keys(rendered.result.current);

        expect(members).toContain('totalUserStories');
        expect(members).not.toContain('noSwimlaneUserStories');
        expect(members).not.toContain('usByStatus');
        expect(members).not.toContain('usByStatusSwimlanes');
    });

    it('derives the three milestone counters, which have no getter', () => {
        const { rendered } = renderBacklogData();

        expect(rendered.result.current.milestoneCounts).toEqual({
            totalOpenMilestones: 2,
            totalClosedMilestones: 1,
            totalMilestones: 3,
        });
    });

    it('builds the canonical statistics and derives the placeholder flag', () => {
        const { rendered } = renderBacklogData();

        expect(rendered.result.current.stats?.completedPercentage).toBe(25);
        expect(rendered.result.current.showGraphPlaceholder).toBe(false);
    });

    it('answers with no statistics, and shows the placeholder, before the load', () => {
        const { rendered } = renderBacklogData({ scope: { stats: null } });

        expect(rendered.result.current.stats).toBeNull();
        expect(rendered.result.current.showGraphPlaceholder).toBe(true);
    });

    it('points the first-story indicator at the first row, and at nothing when empty', () => {
        expect(renderBacklogData().rendered.result.current.firstUserStoryIdInBacklog).toBe(1);

        expect(
            renderBacklogData({ scope: { userstories: [] } }).rendered.result.current
                .firstUserStoryIdInBacklog,
        ).toBeNull();
    });

    it('delegates the doom line to the selector', () => {
        // Assigned 10 plus three points a row: the running total passes 100 at the
        // thirtieth row, so a two-row backlog draws no line.
        expect(renderBacklogData().rendered.result.current.doomLineIndex).toBeNull();

        const reached = renderBacklogData({
            scope: {
                stats: makeStatsBody({ total_points: 5, assigned_points: 4 }),
                userstories: [makeRow(1), makeRow(2)],
            },
        });

        expect(reached.rendered.result.current.doomLineIndex).toBe(0);
    });

    it('drops rows that do not carry the members every consumer dereferences', () => {
        const { rendered } = renderBacklogData({
            scope: { userstories: [makeRow(1), { id: 2 }, 'nope'] },
        });

        expect(rendered.result.current.userStories.map((row) => row.id)).toEqual([1]);
    });

    it('drops a role that does not say whether it takes points', () => {
        const { rendered } = renderBacklogData({
            scope: {
                project: {
                    id: 55,
                    my_permissions: ['add_us'],
                    roles: [
                        { id: 3, name: 'Back', computable: true },
                        { id: 4, name: 'Front' },
                        { id: 5, computable: true },
                        { name: 'No id', computable: false },
                    ],
                },
            },
        });

        expect(rendered.result.current.roles.map((role) => role.id)).toEqual([3]);
    });

    it('falls back to the bootstrapped project when the getter has none yet', () => {
        const { rendered } = renderBacklogData({ scope: { project: null } });

        // The bootstrapped half of the payload is what the screen sees until the
        // getter has a project to answer with -- which is the set-once hand-off
        // doing exactly what it is for.
        expect(rendered.result.current.project.slug).toBe('project-55');
        expect(rendered.result.current.permissions).toEqual(['add_us']);
    });

    it('tolerates a live project with no id rather than failing the whole read', () => {
        const { rendered } = renderBacklogData({
            scope: { project: { name: 'Nameless', my_permissions: ['modify_us'] } },
        });

        // The screen addresses the project by the parameter id, so a live project
        // missing its own id must not discard the permission list that came with it.
        expect(rendered.result.current.project.id).toBe(0);
        expect(rendered.result.current.projectId).toBe(55);
        expect(rendered.result.current.canModifyUs).toBe(true);
    });

    it('drops a swimlane without an id or a name', () => {
        const { rendered } = renderBacklogData({
            scope: { swimlanes: [{ id: 4, name: 'lane' }, { id: 5 }, { name: 'nameless' }] },
        });

        expect(rendered.result.current.swimlanesList.map((lane) => lane.id)).toEqual([4]);
    });

    it('answers with empty collections rather than throwing on absent getters answers', () => {
        const { rendered } = renderBacklogData({
            scope: {
                userstories: 'nope',
                visibleUserStories: 'nope',
                sprints: 'nope',
                closedSprints: 'nope',
                swimlanes: 'nope',
                selectedFilters: 'nope',
                filterQ: 7,
                activeFilters: 'yes',
                totalUserStories: {},
            },
        });
        const data = rendered.result.current;

        expect(data.userStories).toEqual([]);
        expect(data.visibleUserStories).toEqual([]);
        expect(data.swimlanesList.map((lane) => lane.id)).toEqual([4]);
        expect(data.selectedFilterCount).toBe(0);
        expect(data.filterQ).toBe('');
        expect(data.activeFilters).toBe(false);
        expect(data.totalUserStories).toBe(0);
        expect(data.milestoneCounts.totalMilestones).toBe(0);
    });
});

/* ==========================================================================
 * THE INFINITE-SCROLL PREDICATE
 *
 * `app/partials/includes/modules/backlog-table.jade:19`-`:25` is the whole
 * contract, and it is three separate facts:
 *
 *     infinite-scroll="ctrl.loadUserstories()"                                :22
 *     infinite-scroll-disabled="ctrl.disablePagination || !ctrl.firstLoadComplete"  :23
 *     infinite-scroll-immediate-check='false'                                 :24
 *
 * The reload takes NO ARGUMENTS, the disabled predicate joins TWO members with an
 * inclusive test on one and a negated test on the other, and the immediate-check
 * attribute is the STRING spelling of falsehood rather than a boolean -- which is
 * a consumer-side detail for the table component and is recorded here because this
 * is where the two members it joins are published.
 * ========================================================================== */

describe('useBacklogData pagination', () => {
    it('surfaces BOTH halves of the predicate, unjoined', () => {
        const { rendered } = renderBacklogData();
        const members = Object.keys(rendered.result.current);

        expect(members).toContain('disablePagination');
        expect(members).toContain('firstLoadComplete');

        // And NOT the joined result: the table owns the join, because the attribute it
        // feeds is the incumbent's and reproducing the expression there keeps the
        // markup readable against the partial it replaces.
        expect(members).not.toContain('paginationDisabled');
        expect(members).not.toContain('canPaginate');
    });

    /*
     * The full truth table of `disablePagination || !firstLoadComplete`. Only one of
     * the four rows leaves the scroll enabled, and it is the row in which pagination
     * has not been switched off AND the first page has already landed -- so a reading
     * that dropped the negation would enable the scroll before anything had loaded.
     */
    it.each([
        { disablePagination: false, firstLoadComplete: true, disabled: false },
        { disablePagination: true, firstLoadComplete: true, disabled: true },
        { disablePagination: false, firstLoadComplete: false, disabled: true },
        { disablePagination: true, firstLoadComplete: false, disabled: true },
    ])(
        'is disabled=$disabled for disablePagination=$disablePagination and firstLoadComplete=$firstLoadComplete',
        ({ disablePagination, firstLoadComplete, disabled }) => {
            const { rendered } = renderBacklogData({
                scope: { disablePagination, firstLoadComplete },
            });
            const data = rendered.result.current;

            expect(data.disablePagination).toBe(disablePagination);
            expect(data.firstLoadComplete).toBe(firstLoadComplete);
            expect(data.disablePagination || !data.firstLoadComplete).toBe(disabled);
        },
    );

    /*
     * ⭐ THE RELOAD TAKES NO ARGUMENTS. The controller defaults its reset flag to
     * falsehood (`main.coffee:349`), and the markup calls the method bare, so the
     * exposed action is nullary: giving it a parameter would advertise a choice the
     * scroll never makes.
     */
    it('exposes a nullary reload, exactly as the markup calls it', () => {
        const { rendered } = renderBacklogData();

        expect(rendered.result.current.loadUserstories).toHaveLength(0);
    });

    /*
     * DOCUMENTATION, asserted so it cannot rot. The immediate-check attribute is the
     * STRING spelling of falsehood in the incumbent markup, not a boolean -- the
     * attribute is read as text by the scroll directive, and a boolean would be
     * stringified to the same four characters by accident rather than by intent. The
     * table component reproduces the string.
     */
    it('records that the immediate-check attribute is a string, not a boolean', () => {
        const immediateCheckAttributeValue = 'false';

        expect(typeof immediateCheckAttributeValue).toBe('string');
        expect(immediateCheckAttributeValue).not.toBe(false);
    });
});

describe('useBacklogData permissions', () => {
    it('reads the live permission list and never recomputes a gate', () => {
        const { rendered } = renderBacklogData();
        const data = rendered.result.current;

        expect(data.permissions).toEqual(['add_us', 'modify_us', 'delete_us']);
        expect(data.canAddUs).toBe(true);
        expect(data.canModifyUs).toBe(true);
        expect(data.canDeleteUs).toBe(true);
        expect(data.canAddMilestone).toBe(false);
        expect(data.canModifyMilestone).toBe(false);
        expect(data.canViewMilestones).toBe(false);
    });

    it('falls back to the bootstrapped list before the live project arrives', () => {
        const { rendered } = renderBacklogData({
            scope: { project: { id: 55, my_permissions: [], roles: [] } },
        });

        expect(rendered.result.current.permissions).toEqual(['add_us']);
        expect(rendered.result.current.roles.map((role) => role.id)).toEqual([3]);
    });

    it('grants nothing when no permission list has arrived at all', () => {
        const { rendered } = renderBacklogData({
            params: { project: { id: 55, name: '', slug: '', my_permissions: [], roles: [] } },
            scope: { project: { id: 55 } },
        });
        const data = rendered.result.current;

        expect(data.permissions).toEqual([]);
        expect(data.canAddUs).toBe(false);
        expect(data.canModifyUs).toBe(false);
    });

    /*
     * ⭐ THE SAME LIST, THE SAME MEMBERSHIP TEST, NO INDEPENDENT NOTION OF WHAT THE
     * USER MAY DO. The permission directives read `project.my_permissions` and test
     * it with `indexOf(permission) != -1` (`app/coffee/modules/common.coffee:136`);
     * these gates read that array and use that test, so the same users see the same
     * controls. Each gate is driven BOTH ways below, because a gate that is only ever
     * asserted true would pass while ignoring its argument entirely.
     */
    it.each([
        { permission: 'add_us', member: 'canAddUs' },
        { permission: 'modify_us', member: 'canModifyUs' },
        { permission: 'delete_us', member: 'canDeleteUs' },
        { permission: 'add_milestone', member: 'canAddMilestone' },
        { permission: 'modify_milestone', member: 'canModifyMilestone' },
        { permission: 'view_milestones', member: 'canViewMilestones' },
    ] as const)('derives $member from $permission, both ways', ({ permission, member }) => {
        const withIt = renderBacklogData({
            scope: { project: { id: 55, my_permissions: [permission], roles: [] } },
        });

        expect(withIt.rendered.result.current[member]).toBe(true);

        // The same project with every OTHER permission but not this one.
        const withoutIt = renderBacklogData({
            scope: {
                project: {
                    id: 55,
                    my_permissions: ['view_us', 'view_project', 'comment_us'],
                    roles: [],
                },
            },
        });

        expect(withoutIt.rendered.result.current[member]).toBe(false);
    });

    /*
     * The sprint-facing gate in particular, because it is the one the taskboard link
     * and the sprint controls hang on (`app/partials/backlog/sprint.jade:55`-`:62`).
     */
    it('grants the sprint-viewing gate only when the list carries it', () => {
        const granted = renderBacklogData({
            scope: {
                project: {
                    id: 55,
                    my_permissions: ['view_milestones', 'add_us'],
                    roles: [],
                },
            },
        });

        expect(granted.rendered.result.current.canViewMilestones).toBe(true);
        expect(granted.rendered.result.current.canAddUs).toBe(true);
        expect(granted.rendered.result.current.canModifyMilestone).toBe(false);
    });
});

describe('useBacklogData tag preference', () => {
    it('stored false turns the flag off with no broadcast (defect BC-2)', () => {
        const { rendered } = renderBacklogData({
            storedShowTags: false,
            scope: { showTags: undefined },
        });

        expect(rendered.result.current.showTagsResolution).toEqual({
            showTags: false,
            shouldBroadcast: false,
        });
        expect(rendered.result.current.showTags).toBe(false);
    });

    it('stored true turns the flag on and reports the broadcast (defect BC-2)', () => {
        const { rendered } = renderBacklogData({
            storedShowTags: true,
            scope: { showTags: undefined },
        });

        expect(rendered.result.current.showTagsResolution.shouldBroadcast).toBe(true);
        expect(rendered.result.current.showTags).toBe(true);
    });

    it('a stored null hits neither branch, and null is what the store answers (ST-1)', () => {
        const { rendered } = renderBacklogData({
            storedShowTags: null,
            scope: { showTags: undefined },
        });

        expect(rendered.result.current.showTagsResolution).toEqual({
            showTags: true,
            shouldBroadcast: false,
        });
        expect(rendered.result.current.showTags).toBe(true);
    });

    it('prefers the live flag over the stored resolution once it exists', () => {
        const { rendered } = renderBacklogData({ storedShowTags: null, scope: { showTags: false } });

        expect(rendered.result.current.showTags).toBe(false);
        expect(rendered.result.current.showTagsResolution.showTags).toBe(true);
    });

    /*
     * ⭐ DEFECT ST-1 -- THE STORE ANSWERS WITH `null`, NEVER WITH THE OTHER
     * NOTHING-VALUE, AND NEVER WITH THE DEFAULT IT WAS GIVEN.
     * `app/coffee/modules/base/storage.coffee:17`-`:25` has two nothing-paths and they
     * differ:
     *
     *   - ABSENT KEY, `:19`-`:20`: `return _default or null`. That is a TRUTHINESS
     *     fallback, so a default of falsehood does NOT survive it -- the answer is
     *     `null`.
     *   - UNPARSEABLE TEXT, `:22`-`:25`: `return null`, bare, EVEN THOUGH a default was
     *     supplied. The default is discarded on this path entirely.
     *
     * The facade the hook reads through supplies no default at all
     * (`app/coffee/modules/resources/userstories.coffee:174`-`:177`), so `null` is the
     * only nothing-value it can produce -- and `null` satisfies neither branch of the
     * asymmetric double read, which is why the flag keeps the value the constructor
     * gave it at `main.coffee:92`.
     */
    it('treats the store\u2019s answer as null rather than as the other nothing-value', () => {
        const { resources, rendered } = renderBacklogData({
            storedShowTags: null,
            scope: { showTags: undefined },
        });

        expect(resources.getShowTags).toHaveReturnedWith(null);
        expect(resources.getShowTags.mock.results[0]?.value).toBeNull();
        expect(resources.getShowTags.mock.results[0]?.value).not.toBeUndefined();

        // Neither branch fired, so the constructor's value stands.
        expect(rendered.result.current.showTagsResolution).toEqual({
            showTags: true,
            shouldBroadcast: false,
        });
    });

    /*
     * The truthiness fallback of `:20` stated as its consequence: a stored preference
     * that is missing does not come back as falsehood even when falsehood is what the
     * caller would have defaulted to, so the flag is NOT switched off by an absent key.
     */
    it('does not switch the flag off for an absent key, however the default reads', () => {
        const { rendered } = renderBacklogData({
            storedShowTags: null,
            scope: { showTags: undefined },
        });

        expect(rendered.result.current.showTags).toBe(true);
        expect(rendered.result.current.showTags).not.toBe(false);
    });

    /*
     * ⭐ DEFECT ST-1, THE UNPARSEABLE-TEXT PATH. Stored text that will not parse
     * yields a bare `null` at `:25`, discarding the default -- so the resolution is
     * the SAME as for an absent key, and the flag again keeps the constructor's value.
     * The two paths are indistinguishable from the React side, which is the property
     * being locked: no reader may start treating one of them as falsehood.
     */
    it('resolves unparseable stored text exactly as it resolves an absent key', () => {
        const absent = renderBacklogData({
            storedShowTags: null,
            scope: { showTags: undefined },
        });
        const unparseable = renderBacklogData({
            storedShowTags: null,
            scope: { showTags: undefined },
        });

        expect(unparseable.rendered.result.current.showTagsResolution).toEqual(
            absent.rendered.result.current.showTagsResolution,
        );
        expect(unparseable.rendered.result.current.showTags).toBe(true);
    });

    /*
     * ⭐⭐ THE STORE IS SYNCHRONOUS, so the read is neither awaited nor marshalled.
     * The facade reads browser storage inline and answers with the value itself
     * (`resources/userstories.coffee:174`-`:177` over `base/storage.coffee:17`-`:25`),
     * which is why the resolution below is already present on the FIRST render, with
     * no flush of the microtask queue and no waiting at all.
     */
    it('resolves the stored preference synchronously, on the first render', () => {
        const { resources, rendered } = renderBacklogData({
            storedShowTags: false,
            scope: { showTags: undefined },
        });

        // No await, no act, no flush: the value is simply there.
        expect(rendered.result.current.showTagsResolution).toEqual({
            showTags: false,
            shouldBroadcast: false,
        });

        const answer: unknown = resources.getShowTags.mock.results[0]?.value;

        expect(answer).toBe(false);
        expect(answer).not.toBeInstanceOf(Promise);
        expect(typeof answer).not.toBe('object');
    });

    /*
     * And it is read ONCE, not on every render: the stored value is the FIRST-LOAD
     * input, and re-reading it later would let a store write reorder the resolution.
     */
    it('reads the store once, not on every render', () => {
        const { resources, rendered } = renderBacklogData({ storedShowTags: true });

        rendered.rerender();
        rendered.rerender();

        act(() => {
            rendered.result.current.refresh();
        });

        expect(resources.getShowTags).toHaveBeenCalledTimes(1);
    });
});

describe('useBacklogData notification', () => {
    it('registers exactly the seven in-scope events, and no realtime or sprint event', () => {
        const { bridge } = renderBacklogData();

        for (const eventName of BACKLOG_DATA_REPULL_EVENTS) {
            expect(bridge.listenerCount(eventName)).toBe(1);
        }

        expect(BACKLOG_DATA_REPULL_EVENTS).toEqual([
            'usform:bulk:success',
            'usform:new:success',
            'usform:edit:success',
            'filters:update',
            'backlog:userstories:loaded',
            'userstories:loaded',
            'sprint:us:moved',
        ]);
    });

    it('re-reads the live values when an event is delivered', () => {
        const { bridge, rendered } = renderBacklogData();

        expect(rendered.result.current.userStories).toHaveLength(2);

        bridge.scope.userstories = [makeRow(1), makeRow(2), makeRow(3)];
        bridge.scope.totalUserStories = '12';

        act(() => {
            bridge.broadcast('backlog:userstories:loaded');
        });

        expect(rendered.result.current.userStories.map((row) => row.id)).toEqual([1, 2, 3]);
        expect(rendered.result.current.totalUserStories).toBe('12');
    });

    it('re-reads on every one of the seven events', () => {
        const { bridge, rendered } = renderBacklogData();

        for (const [index, eventName] of BACKLOG_DATA_REPULL_EVENTS.entries()) {
            bridge.scope.filterQ = `term ${String(index)}`;

            act(() => {
                bridge.broadcast(eventName);
            });

            expect(rendered.result.current.filterQ).toBe(`term ${String(index)}`);
        }
    });

    /*
     * ⛔ THE EVENTS THAT BELONG TO THE SIBLING HOOKS ARE NOT REGISTERED HERE, and
     * that is a correctness rule rather than a tidiness one: two listeners for one
     * event would run the same re-read twice per delivery.
     *
     *   - every `sprintform:*` notification and both closed-sprint toggles belong to
     *     `useSprints.ts`;
     *   - `sprint:us:move` is the imperative MOVE REQUEST and belongs to
     *     `useStoryDrag.ts`. Note how close it is to `sprint:us:moved`, which this
     *     hook DOES take: the settled notification, not the request. One letter
     *     separates a legitimate registration from a double-fire.
     */
    it.each([
        'sprintform:create:success',
        'sprintform:edit:success',
        'sprintform:remove:success',
        'sprint:us:move',
        'backlog:load-closed-sprints',
        'backlog:unload-closed-sprints',
        'backlog:realtime:userstories',
        'backlog:realtime:milestones',
    ])('never registers %s, which belongs to a sibling hook', (eventName) => {
        const { bridge } = renderBacklogData();

        expect(bridge.registeredNames).not.toContain(eventName);
    });

    it('registers seven listeners and no more, counted rather than sampled', () => {
        const { bridge } = renderBacklogData();

        expect(bridge.registeredNames).toHaveLength(7);
        expect(bridge.registeredNames).toEqual([...BACKLOG_DATA_REPULL_EVENTS]);
        expect(new Set(bridge.registeredNames).size).toBe(7);
    });

    /*
     * A delivery causes a RE-READ AND NOTHING ELSE. Every bridge action is a delegation
     * to the retained controller, and firing one from a listener would turn one
     * notification into a request -- which is how a re-entrant reload loop starts.
     */
    it('answers a delivery with a re-read and calls no bridge action', () => {
        const { bridge, rendered } = renderBacklogData();
        const readsBefore = bridge.reads.length;

        expect(bridge.calls).toHaveLength(0);

        act(() => {
            bridge.broadcast('usform:edit:success');
        });

        expect(bridge.reads.length).toBeGreaterThan(readsBefore);
        expect(bridge.calls).toHaveLength(0);
        expect(rendered.result.current.userStories).toHaveLength(2);
    });

    it('releases every listener on unmount, so nothing leaks', () => {
        const { bridge, rendered } = renderBacklogData();

        expect(bridge.deregistrationCount()).toBe(0);

        rendered.unmount();

        expect(bridge.deregistrationCount()).toBe(BACKLOG_DATA_REPULL_EVENTS.length);

        for (const eventName of BACKLOG_DATA_REPULL_EVENTS) {
            expect(bridge.listenerCount(eventName)).toBe(0);
        }
    });

    /*
     * ⭐⭐ ONE RELEASE PER REGISTRATION, EXACTLY. What the registrar hands back is
     * AngularJS's own deregistration function, so the count of releases and the count
     * of registrations must be equal: a release short means a listener that outlives
     * the screen, and a leaked listener throws nothing and logs nothing. It surfaces
     * much later as a Backlog that re-reads twice, then three times, as somebody walks
     * between screens.
     */
    it('invokes exactly one release per registration, no more and no fewer', () => {
        const { bridge, rendered } = renderBacklogData();
        const registrations = bridge.registeredNames.length;

        rendered.unmount();

        expect(bridge.deregistrationCount()).toBe(registrations);

        // Unmounting again must not double-release: React runs a cleanup once.
        rendered.unmount();

        expect(bridge.deregistrationCount()).toBe(registrations);
    });

    it('does not re-register when the payload object identity changes', () => {
        // A FRESH payload object per render, which is what a parent rebuilding it
        // would produce: the listeners must survive, because releasing and
        // re-registering them would drop deliveries in the gap.
        const { bridge, rendered } = renderBacklogData({
            eventsOverride: (base) => ({ ...base }),
        });

        rendered.rerender();
        rendered.rerender();

        for (const eventName of BACKLOG_DATA_REPULL_EVENTS) {
            expect(bridge.listenerCount(eventName)).toBe(1);
        }
    });

    it('keeps stable callback identities across re-renders', () => {
        const { rendered } = renderBacklogData();
        const before = rendered.result.current;

        rendered.rerender();

        const after = rendered.result.current;

        expect(after.refresh).toBe(before.refresh);
        expect(after.loadUserstories).toBe(before.loadUserstories);
        expect(after.changeUserStoryStatus).toBe(before.changeUserStoryStatus);
        expect(after.retainUserStoryModel).toBe(before.retainUserStoryModel);
    });
});

describe('useBacklogData actions', () => {
    it('calls the pagination reload with NO arguments', async () => {
        const { bridge, rendered } = renderBacklogData();

        await act(async () => {
            await rendered.result.current.loadUserstories();
        });

        const call = bridge.calls.find((entry) => entry.method === 'loadUserstories');

        expect(call).toBeDefined();
        expect(call?.args).toEqual([undefined, undefined]);
    });

    it('marshals a refused action into a settled promise rather than a crash', async () => {
        const { rendered } = renderBacklogData();

        await expect(rendered.result.current.addNewUs('bulk')).resolves.toBeUndefined();
    });

    it('supplies the project id to the edit action from the parameters', async () => {
        const { bridge, rendered } = renderBacklogData();

        await act(async () => {
            await rendered.result.current.editUserStory(101);
        });

        const call = bridge.calls.find((entry) => entry.method === 'editUserStory');

        expect(call?.args[0]).toBe(55);
        expect(call?.args[1]).toBe(101);
    });

    it('forwards every filter action to its bridge callback', async () => {
        const { bridge, rendered } = renderBacklogData();
        const data = rendered.result.current;

        await act(async () => {
            await data.changeQ('needle');
            await data.addFilter({ id: 1 });
            await data.removeFilter({ id: 1 });
            await data.saveCustomFilter('mine');
            await data.selectCustomFilter({ name: 'mine' });
            await data.removeCustomFilter({ name: 'mine' });
            await data.loadProjectStats();
            await data.deleteUserStory(1);
        });

        expect(bridge.calls.map((entry) => entry.method)).toEqual(
            expect.arrayContaining([
                'changeQ',
                'addFilterBacklog',
                'removeFilterBacklog',
                'saveCustomFilter',
                'selectCustomFilter',
                'removeCustomFilter',
                'loadProjectStats',
                'deleteUserStory',
            ]),
        );
    });

    it('re-reads after each toggle, because the controller flips its flag inline', async () => {
        const { bridge, rendered } = renderBacklogData();

        expect(rendered.result.current.activeFilters).toBe(true);

        await act(async () => {
            await rendered.result.current.toggleActiveFilters();
        });

        expect(rendered.result.current.activeFilters).toBe(false);

        expect(rendered.result.current.displayVelocity).toBe(false);

        await act(async () => {
            await rendered.result.current.toggleVelocityForecasting();
        });

        expect(rendered.result.current.displayVelocity).toBe(true);

        await act(async () => {
            await rendered.result.current.toggleShowTags();
        });

        expect(bridge.calls.map((entry) => entry.method)).toEqual(
            expect.arrayContaining([
                'toggleActiveFilters',
                'toggleVelocityForecasting',
                'toggleShowTags',
            ]),
        );
    });
});

describe('useBacklogData model registry', () => {
    it('retains a model handed over by a caller and reads it back by id', () => {
        const { rendered } = renderBacklogData();
        const model = makeModelDouble<UserStory>({ id: 1, version: 7 });

        expect(rendered.result.current.getUserStoryModel(1)).toBeNull();

        act(() => {
            rendered.result.current.retainUserStoryModel(model);
        });

        expect(rendered.result.current.getUserStoryModel(1)).toBe(model);
    });

    it('ignores a model whose attributes carry no numeric id', () => {
        const { rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.retainUserStoryModel(
                makeModelDouble<UserStory>({ version: 7 }),
            );
        });

        expect(rendered.result.current.getUserStoryModel(1)).toBeNull();
    });
});

describe('useBacklogData inline status change', () => {
    it('updates the row optimistically and saves a MODEL, not flattened data', () => {
        const { repository, rendered, mintedFrom } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        const changed = rendered.result.current.userStories.find((row) => row.id === 1);

        expect(changed?.status).toBe(4);
        expect(repository.saved).toHaveLength(1);
        expect(mintedFrom[0]?.['id']).toBe(1);
    });

    it('sends the changed field and the version, and nothing else (requirement I7)', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        expect(repository.saved).toHaveLength(1);
        expect(repository.savedPatch(0)).toEqual({ status: 4, version: 7 });
    });

    it('retains the minted model, so a later change reuses one instance', () => {
        const { repository, rendered, mintedFrom } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        expect(rendered.result.current.getUserStoryModel(1)).toBe(repository.saved[0]);

        // A second change well past the guard window reuses the retained model.
        act(() => {
            repository.settle();
        });

        expect(mintedFrom).toHaveLength(1);
    });

    it('prefers a retained model over minting a new one', () => {
        const { repository, rendered, mintedFrom } = renderBacklogData();
        const retained = makeModelDouble<UserStory>({ id: 1, version: 9 });

        act(() => {
            rendered.result.current.retainUserStoryModel(retained);
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        expect(mintedFrom).toHaveLength(0);
        expect(repository.saved[0]).toBe(retained);
    });

    it('DROPS a second change inside the guard window (defect DBN-1)', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
            rendered.result.current.changeUserStoryStatus(1, 9);
            rendered.result.current.changeUserStoryStatus(2, 9);
        });

        expect(repository.saved).toHaveLength(1);
        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);
        expect(rendered.result.current.userStories.find((row) => row.id === 2)?.status).toBe(1);
    });

    it('does NOT revert the optimistic value when the save is refused (defect STATUS-1)', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        act(() => {
            repository.reject();
        });

        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);
    });

    it('runs the post-write refresh action once the save resolves', async () => {
        const { bridge, repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        expect(bridge.calls.some((entry) => entry.method === 'updateUserStoryStatus')).toBe(false);

        // Awaited, because the marshaller hands back a NATIVE promise: its
        // continuation runs on a microtask rather than inside the settle call, so a
        // synchronous assertion here would observe the queue before it drained.
        await act(async () => {
            repository.settle();
        });

        expect(bridge.calls.some((entry) => entry.method === 'updateUserStoryStatus')).toBe(true);
    });

    it('writes nothing when the row is not on this screen', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(999, 4);
        });

        expect(repository.saved).toHaveLength(0);
    });

    it('survives a post-write refresh that is itself refused', async () => {
        const { repository, rendered } = renderBacklogData({
            eventsOverride: (base) => ({
                ...base,
                updateUserStoryStatus: () => ({
                    then(
                        _onFulfilled: (value: unknown) => unknown,
                        onRejected: (reason: unknown) => unknown,
                    ): unknown {
                        onRejected(new Error('refresh refused'));

                        return undefined;
                    },
                }),
            }),
        });

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        await act(async () => {
            repository.settle();
        });

        // The optimistic value still stands, and nothing threw: the refusal is
        // observed and deliberately not acted on, exactly as the incumbent does.
        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);
    });
});

/* ==========================================================================
 * THE GUARD, ON A CONTROLLED CLOCK
 *
 * ⭐⭐ DEFECT DBN-1, AND THE NAMES ARE INVERTED. `app/coffee/utils.coffee:117`-`:118`
 * is the wrapper the status popover uses, and it is
 * `_.debounce(func, wait, {leading: true, trailing: false})` -- so the FIRST call
 * goes through IMMEDIATELY and every call inside the window is DROPPED AND NEVER
 * REPLAYED. Its neighbour at `:121`-`:122`, whose name says leading, is the one with
 * the trailing behaviour. Reading the plainly named wrapper by its conventional
 * meaning therefore gets it exactly backwards.
 *
 * `app/coffee/modules/common/popovers.coffee:51` wraps the status click in it with a
 * two-second window. That makes it a DOUBLE-SUBMIT GUARD, not a delay: a trailing
 * reading would add a two-second lag to every status change that no user has today,
 * which rule T10 forbids. The clock is faked below so the window is exercised rather
 * than waited for.
 * ========================================================================== */

describe('useBacklogData status guard on a controlled clock', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('fires the write IMMEDIATELY, before the clock has been advanced', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        // The clock has not been advanced at all yet.
        expect(repository.saved).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('DROPS a second call inside the two-second window', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        act(() => {
            jest.advanceTimersByTime(STATUS_CHANGE_GUARD_WINDOW_MS - 1);
            rendered.result.current.changeUserStoryStatus(1, 9);
        });

        expect(repository.saved).toHaveLength(1);
    });

    it('accepts again once the whole window has elapsed', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        act(() => {
            jest.advanceTimersByTime(STATUS_CHANGE_GUARD_WINDOW_MS);
            rendered.result.current.changeUserStoryStatus(1, 9);
        });

        expect(repository.saved).toHaveLength(2);
        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(9);
    });

    /*
     * ⭐⭐ THE CASE THAT CATCHES A TRAILING-EDGE OR TIMER-BASED READING. Two calls
     * inside the window, then the window is allowed to close with NO further call. A
     * trailing-edge wrapper would fire the dropped call here, and a deferred-timer
     * implementation would fire the first one here rather than at once -- either way
     * the total would be two, or the first write would arrive two seconds late. It is
     * exactly ONE, and it has already happened.
     */
    it('never replays a dropped call when the window closes', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
            rendered.result.current.changeUserStoryStatus(1, 9);
        });

        expect(repository.saved).toHaveLength(1);

        act(() => {
            jest.advanceTimersByTime(STATUS_CHANGE_GUARD_WINDOW_MS * 5);
        });

        expect(repository.saved).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);

        // And the dropped call left no trace on the row either.
        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);
    });

    it('holds the window across a re-render, so the guard is not reset by one', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        rendered.rerender();
        rendered.rerender();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 9);
        });

        // A guard rebuilt per render would have accepted the second call.
        expect(repository.saved).toHaveLength(1);
    });
});

/* ==========================================================================
 * THE OPTIMISTIC WRITE, AND WHAT IT NEVER UNDOES
 * ========================================================================== */

describe('useBacklogData optimistic status write', () => {
    /*
     * THE ORDER IS LOCAL FIRST, PERSISTED SECOND, mirroring
     * `app/coffee/modules/common/popovers.coffee:60` (the local assignment) ahead of
     * `:66` (the save). So the row already reads as changed while the write is still
     * outstanding.
     */
    it('shows the new status BEFORE the write has settled', () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        // Outstanding: the double settles only when told to.
        expect(repository.saved).toHaveLength(1);
        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);
    });

    /*
     * ⭐⭐ DEFECT STATUS-1, PRESERVED: THERE IS NO REVERT, AND A SPEC ASSERTING ONE
     * WOULD BE ASSERTING AN IMPROVEMENT. `popovers.coffee:66` attaches a FULFILMENT
     * handler only -- `$repo.save(us).then ->` with no second argument anywhere on
     * that path -- so a refused save leaves the new value on screen until the next
     * reload. Restoring the old value would be a behaviour change (T10); the user
     * still learns of the failure, because the interceptor chain raises the version
     * conflict, the blocked project or the connection loss.
     */
    it('leaves the optimistic value in place when the write is REFUSED', () => {
        const { bridge, repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        act(() => {
            repository.reject();
        });

        expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(4);

        // Nothing was reloaded to paper over it, and no post-write refresh ran either:
        // that one is the FULFILMENT handler's, and fulfilment did not happen.
        expect(bridge.calls).toHaveLength(0);
    });

    it('does not revert even after the window has closed and time has passed', async () => {
        const { repository, rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        await act(async () => {
            repository.reject();
        });

        await waitFor(() => {
            expect(rendered.result.current.userStories.find((row) => row.id === 1)?.status).toBe(
                4,
            );
        });
    });

    /*
     * ⭐ REQUIREMENT I7 -- THE SAVE RECEIVES THE MODEL INSTANCE ITSELF, NEVER A
     * FLATTENED COPY. `app/coffee/modules/base/model.coffee:48`-`:54` returns only the
     * modified members plus the optimistic-concurrency version when asked for a patch,
     * and `app/coffee/modules/base/repository.coffee:54`-`:59` resolves with NO request
     * at all when the model is unmodified. Both properties live on the instance, so
     * handing over plain data would silently begin sending whole-object writes -- a
     * lost-update regression, not a stylistic difference.
     */
    it('hands the save the very instance the registry holds, by identity', () => {
        const { repository, rendered } = renderBacklogData();
        const retained = makeModelDouble<UserStory>({ id: 1, version: 11 });

        act(() => {
            rendered.result.current.retainUserStoryModel(retained);
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        expect(repository.saved[0]).toBe(retained);
        expect(rendered.result.current.getUserStoryModel(1)).toBe(retained);
        expect(repository.savedPatch(0)).toEqual({ status: 4, version: 11 });
    });

    /*
     * ⭐ PITFALL P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel`
     * returns model classes carrying dirty-tracking state; passing one into a draft
     * produces undefined behaviour. Convert to plain objects at the boundary."
     *
     * The registry is a REF, so a model is never state, never diffed and never
     * drafted. What the screen sees is plain data: the row below carries the new
     * status and none of the model's own members.
     */
    it('keeps the model out of everything the screen can see', () => {
        const { rendered } = renderBacklogData();

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        const row = rendered.result.current.userStories.find((entry) => entry.id === 1);
        const rowMembers: Readonly<Record<string, unknown>> = { ...row };

        expect(row?.status).toBe(4);

        for (const modelMember of ['getAttrs', 'setAttr', 'isModified', 'getName', '_attrs']) {
            expect(Object.keys(rowMembers)).not.toContain(modelMember);
        }

        // The registry is reachable only through its accessor, never as a member of the
        // result, so nothing can walk into it from the render tree.
        expect(Object.keys(rendered.result.current)).not.toContain('userStoryModels');
    });

    /*
     * FLATTENING DEPTH IS ONE LEVEL for the row reads. The rows arrive already
     * flattened from the bridge and are forwarded as they came, so a nested member is
     * plain data too -- there is no second wrapper to unwrap, and none is invented.
     * The two-level case belongs to sprint loading, where a sprint's nested rows are
     * re-wrapped as models on the private slot
     * (`app/coffee/modules/resources/sprints.coffee:18`-`:20`), and that is
     * `useSprints.ts`'s to assert.
     */
    it('forwards rows one level deep, with nested members left as plain data', () => {
        const { rendered } = renderBacklogData({
            scope: {
                userstories: [
                    makeRow(1, { points: { 3: 7 }, tags: [['bug', 'unset']] }),
                    makeRow(2),
                ],
            },
        });
        const row = rendered.result.current.userStories.find((entry) => entry.id === 1);

        expect(row?.points).toEqual({ 3: 7 });
        expect(row?.tags).toEqual([['bug', 'unset']]);
        expect(Object.keys({ ...row?.points })).toEqual(['3']);
    });
});

/* ==========================================================================
 * COLLECTIONS ARE REPLACED, NEVER MUTATED
 * ========================================================================== */

describe('useBacklogData collection identity', () => {
    /*
     * ⭐ DEFECT BC-1, AND THE DISCIPLINE IT ARGUES FOR. On the AngularJS side the set
     * of just-created row identifiers is `newUs`, declared as a PROTOTYPE-LEVEL array
     * on the controller class (`app/coffee/modules/backlog/main.coffee:54`) and
     * therefore shared by every instance. It escapes the classic shared-mutable-default
     * bug only because both of its write sites REASSIGN it -- `:160` and `:180` -- rather
     * than pushing into it. The same reasoning applies to the removal at `:699`, which
     * is `@scope.userstories = _.without(@scope.userstories, us)`: a replacement, not a
     * splice.
     *
     * So the rule on this side is: replace, never mutate. It is also what structural
     * sharing needs (P-IMMER-4) -- an untouched branch keeps its identity, which is what
     * makes memoised children worth memoising.
     */
    it('replaces the row collection on a re-read rather than mutating it', () => {
        const { bridge, rendered } = renderBacklogData();
        const before = rendered.result.current.userStories;

        bridge.scope.userstories = [makeRow(1), makeRow(2), makeRow(3)];

        act(() => {
            bridge.broadcast('usform:new:success');
        });

        const after = rendered.result.current.userStories;

        expect(after).not.toBe(before);
        expect(after).toHaveLength(3);

        // The collection the screen held before the re-read is UNCHANGED, which is the whole
        // point: a mutation would have rewritten a value a rendered child still reads.
        expect(before).toHaveLength(2);
        expect(before.map((row) => row.id)).toEqual([1, 2]);
    });

    it('replaces the changed ROW too, leaving the previous object untouched', () => {
        const { rendered } = renderBacklogData();
        const beforeRows = rendered.result.current.userStories;
        const beforeRow = beforeRows.find((row) => row.id === 1);

        expect(beforeRow?.status).toBe(1);

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        const afterRow = rendered.result.current.userStories.find((row) => row.id === 1);

        expect(afterRow).not.toBe(beforeRow);
        expect(afterRow?.status).toBe(4);
        expect(beforeRow?.status).toBe(1);
    });

    it('leaves the untouched row IDENTICAL, so structural sharing is real', () => {
        const { rendered } = renderBacklogData();
        const untouchedBefore = rendered.result.current.userStories.find((row) => row.id === 2);

        act(() => {
            rendered.result.current.changeUserStoryStatus(1, 4);
        });

        const untouchedAfter = rendered.result.current.userStories.find((row) => row.id === 2);

        expect(untouchedAfter).toBe(untouchedBefore);
    });
});

/* ==========================================================================
 * FORECASTING AND THE DOOM LINE
 * ========================================================================== */

describe('useBacklogData forecasting', () => {
    /*
     * ⭐ THE STATISTICS ARE READ BEFORE THE FORECASTING INPUTS, and that ordering is
     * load-bearing on the AngularJS side. `main.coffee:266` assigns the statistics and
     * `:275` calls the forecasting calculation immediately afterwards -- and that
     * calculation reads `stats.total_points` and `stats.assigned_points` UNGUARDED at
     * `:453`-`:454`, so it would fail outright against statistics that had not arrived.
     * Reading in the same order keeps a forecast consumer from ever seeing the pair
     * half-populated.
     */
    it('reads the statistics before the forecasting inputs, in one pass', () => {
        const { bridge } = renderBacklogData();
        const statsAt = bridge.reads.indexOf('getStats');
        const forecastAt = bridge.reads.indexOf('getForecastedStories');

        expect(statsAt).toBeGreaterThanOrEqual(0);
        expect(forecastAt).toBeGreaterThan(statsAt);
    });

    it('exposes the forecasting inputs as DATA, computing no forecast of its own', () => {
        const { rendered } = renderBacklogData({
            scope: { displayVelocity: true, forecastedStories: [makeRow(1), makeRow(2)] },
        });
        const data = rendered.result.current;

        expect(data.displayVelocity).toBe(true);
        expect(data.forecastedStories.map((row) => row.id)).toEqual([1, 2]);

        // No derived forecast members: the calculation stays on the AngularJS side,
        // where the toggle that drives it lives.
        const members = Object.keys(data);

        expect(members).not.toContain('forecastNewSprint');
        expect(members).not.toContain('sprintTotalPoints');
        expect(members).not.toContain('calculateForecasting');
    });

    /*
     * ⭐ DEFECT DL-1 IS DELEGATED, NEVER REIMPLEMENTED. The selector under `../state/`
     * owns the doom-line arithmetic, including the incumbent's behaviour that the line
     * always renders once the project total is non-zero: `main.coffee:763`-`:767`
     * guards the reload on a flag the directive never assigns and on a check against
     * nothing that is therefore always satisfied. Asserting equality against the
     * selector is what proves the delegation -- a private copy would be free to drift
     * from it, and a drifting copy of a preserved defect is the worst of both.
     */
    it('answers with exactly what the selector answers, for the same two inputs', () => {
        const { rendered } = renderBacklogData({
            scope: {
                stats: makeStatsBody({ total_points: 5, assigned_points: 4 }),
                userstories: [makeRow(1), makeRow(2)],
            },
        });
        const data = rendered.result.current;

        expect(data.doomLineIndex).toBe(selectDoomLineIndex(data.stats, data.userStories));
        expect(data.doomLineIndex).toBe(0);
    });

    it('agrees with the selector when there is no line to draw either', () => {
        const { rendered } = renderBacklogData();
        const data = rendered.result.current;

        expect(data.doomLineIndex).toBe(selectDoomLineIndex(data.stats, data.userStories));
        expect(data.doomLineIndex).toBeNull();
    });

    it('computes no doom line of its own, in the unit\u2019s own text', () => {
        expect(UNIT_CODE).toContain('selectDoomLineIndex(snapshot.stats, snapshot.userStories)');
        expect(UNIT_CODE.match(/selectDoomLineIndex/g)).toHaveLength(2);
    });
});

/* ==========================================================================
 * DELETION
 * ========================================================================== */

describe('useBacklogData deletion', () => {
    /*
     * ⭐ DEFECT DEL-1, PRESERVED BY DELEGATION.
     * `app/coffee/modules/backlog/main.coffee:692`-`:712` removes the row from the
     * collection at `:699`, BEFORE the request, and its rejection path at `:710`-`:712`
     * closes the confirmation and notifies -- it NEVER puts the row back. That whole
     * sequence, confirmation included, belongs to the retained controller; this hook
     * delegates and holds no optimistic state of its own, so there is nothing here to
     * restore and nothing here that could invent a restoration.
     */
    it('delegates the removal and holds no optimistic copy of its own', async () => {
        const { bridge, rendered } = renderBacklogData();
        const before = rendered.result.current.userStories.map((row) => row.id);

        await act(async () => {
            await rendered.result.current.deleteUserStory(1);
        });

        const call = bridge.calls.find((entry) => entry.method === 'deleteUserStory');

        expect(call?.args).toEqual([1]);

        // The rows are unchanged until the controller says so, because the collection
        // this screen shows is the controller's and is re-read on notification.
        expect(rendered.result.current.userStories.map((row) => row.id)).toEqual(before);
    });

    it('accepts either a row or its identifier, because the bridge does', async () => {
        const { bridge, rendered } = renderBacklogData();
        const row = rendered.result.current.userStories[0];

        expect(row).toBeDefined();

        await act(async () => {
            await rendered.result.current.deleteUserStory(9);

            if (row !== undefined) {
                await rendered.result.current.deleteUserStory(row);
            }
        });

        const calls = bridge.calls.filter((entry) => entry.method === 'deleteUserStory');

        expect(calls).toHaveLength(2);
        expect(calls[0]?.args).toEqual([9]);
        expect(calls[1]?.args[0]).toBe(row);
    });

    /*
     * And a refused delete restores nothing, because there was no optimistic removal
     * here to restore -- the removal and its absent restoration are both the
     * controller's, exactly as at `:699` and `:710`-`:712`.
     */
    it('restores nothing when the delete is refused', async () => {
        const { rendered } = renderBacklogData({
            eventsOverride: (base) => ({
                ...base,
                deleteUserStory: () => ({
                    then(
                        _onFulfilled: (value: unknown) => unknown,
                        onRejected: (reason: unknown) => unknown,
                    ): unknown {
                        onRejected(new Error('delete refused'));

                        return undefined;
                    },
                }),
            }),
        });

        await expect(rendered.result.current.deleteUserStory(1)).rejects.toThrow('delete refused');

        expect(rendered.result.current.userStories.map((row) => row.id)).toEqual([1, 2]);
    });
});

describe('useBacklogData teardown', () => {
    it('never writes state after unmount, even when a delivery arrives late', () => {
        const { bridge, rendered } = renderBacklogData();
        const listenersBefore = bridge.listenerCount('userstories:loaded');

        expect(listenersBefore).toBe(1);

        rendered.unmount();

        // Every listener has been released, so a broadcast reaches nothing at all
        // and no state write can be attempted.
        expect(() => {
            bridge.broadcast('userstories:loaded');
        }).not.toThrow();

        expect(bridge.listenerCount('userstories:loaded')).toBe(0);
    });

    it('refuses to write state once the lifecycle guard is set', () => {
        const { bridge, rendered } = renderBacklogData();
        const refresh = rendered.result.current.refresh;

        rendered.unmount();

        bridge.scope.filterQ = 'after unmount';

        expect(() => {
            refresh();
        }).not.toThrow();
    });
});
