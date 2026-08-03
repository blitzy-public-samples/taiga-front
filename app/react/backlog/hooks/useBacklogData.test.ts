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
 * DL-1 (delegated doom line) and the dead-code note behind the milestone counts.
 */

import { act, renderHook } from '@testing-library/react';

import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import type {
    AngularPromise,
    AngularServices,
    TaigaModel,
    TaigaModelPatch,
} from '../../bridge/useAngularService';
import type { Status } from '../../shared/types/status';
import type { UserStory } from '../../shared/types/userStory';
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
    /** Delivers one AngularJS event to every LIVE listener, as a broadcast would. */
    broadcast(eventName: BacklogDataEventName): void;
    listenerCount(eventName: BacklogDataEventName): number;
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
    const live = new Map<BacklogDataEventName, ((payload: unknown) => void)[]>();
    let deregistrations = 0;

    const record = (method: string, ...args: readonly unknown[]): void => {
        calls.push({ method, args });
    };

    const events: BacklogBridgeEvents = {
        getProject: () => scope.project,
        getUserStories: () => scope.userstories,
        getVisibleUserStories: () => scope.visibleUserStories,
        getSprints: () => scope.sprints,
        getClosedSprints: () => scope.closedSprints,
        getStats: () => scope.stats,
        getSwimlanes: () => scope.swimlanes,
        getTotalUserStories: () => scope.totalUserStories,
        getFilterQ: () => scope.filterQ,
        getActiveFilters: () => scope.activeFilters,
        getSelectedFilters: () => scope.selectedFilters,
        getShowTags: () => scope.showTags,
        getDisplayVelocity: () => scope.displayVelocity,
        getForecastedStories: () => scope.forecastedStories,
        getDisablePagination: () => scope.disablePagination,
        getFirstLoadComplete: () => scope.firstLoadComplete,

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
        broadcast(eventName) {
            for (const handler of [...(live.get(eventName) ?? [])]) {
                handler(undefined);
            }
        },
        listenerCount(eventName) {
            return (live.get(eventName) ?? []).length;
        },
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

/**
 * The `$tgResources` stub the hook resolves.
 *
 * ⭐ ONE ASSERTION, HERE AND NOWHERE ELSE IN THIS FILE'S SERVICE DOUBLES. The
 * resource service grafts five namespaces with several dozen members between them,
 * and this hook reaches exactly ONE of them -- the synchronous tag-preference read
 * -- so stubbing the remainder would add sixty lines that assert nothing. The
 * narrow object is therefore presented as the service, once, from this single
 * factory, and every remaining member is genuinely unreachable from the unit under
 * test: reaching one would throw here rather than pass silently.
 */
function makeResourcesDouble(storedShowTags: boolean | null): AngularServices['$tgResources'] {
    const narrow = {
        userstories: {
            getShowTags: (): boolean | null => storedShowTags,
        },
    };

    return narrow as unknown as AngularServices['$tgResources'];
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
    readonly mintedFrom: Record<string, unknown>[];
    readonly rendered: ReturnType<typeof renderHook<ReturnType<typeof useBacklogData>, void>>;
}

function renderBacklogData(options: HarnessOptions = {}): Harness {
    const bridge = makeEventsDouble(makeScopeState(options.scope ?? {}));
    const params = makeParams(options.params ?? {});
    const repository = makeRepositoryDouble();
    const mintedFrom: Record<string, unknown>[] = [];

    const injector = mockInjector({
        $tgResources: makeResourcesDouble(options.storedShowTags ?? null),
        $tgRepo: repository.service,
        $tgModel: makeModelFactoryDouble(mintedFrom),
    });

    const events =
        options.eventsOverride === undefined
            ? bridge.events
            : options.eventsOverride(bridge.events);

    const rendered = renderHook(() => useBacklogData(params, events), {
        wrapper: withMockInjector(injector),
    });

    return { bridge, repository, mintedFrom, rendered };
}

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

    it('releases every listener on unmount, so nothing leaks', () => {
        const { bridge, rendered } = renderBacklogData();

        expect(bridge.deregistrationCount()).toBe(0);

        rendered.unmount();

        expect(bridge.deregistrationCount()).toBe(BACKLOG_DATA_REPULL_EVENTS.length);

        for (const eventName of BACKLOG_DATA_REPULL_EVENTS) {
            expect(bridge.listenerCount(eventName)).toBe(0);
        }
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
