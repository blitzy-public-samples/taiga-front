/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * THE CROSS-LANGUAGE CONTRACT SPEC FOR THE AngularJS → React SEAM.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every other spec in `app/react` tests one side of the migration seam against a
 * DOUBLE of the other side. That is the right shape for a unit test and it has
 * one blind spot, which is precisely the seam: the CoffeeScript bridge and the
 * React consumers are joined only by DOM properties and callback arity, so
 * nothing — not `tsc --noEmit`, not `coffee -c`, not a React unit test with a
 * hand-written registrar double — can observe a disagreement between them.
 *
 * Four real defects lived in exactly that blind spot, and this file exists so
 * each one fails loudly rather than silently:
 *
 *   1. the bridge's event wrapper called its conversion helper with the wrong
 *      arity, so EVERY realtime payload reached React as `undefined`;
 *   2. the realtime hooks declared `(event, message)` listeners and read argument
 *      2, while the bridge strips the event object and passes the payload as
 *      argument 1 — so even after (1) the payload was still unreachable;
 *   3. the conversion was one level deep, so nested `$tgModel` instances and
 *      nested arrays crossed the seam as live AngularJS-owned objects; and
 *   4. mutable controller state crossed BY REFERENCE, which `immer`'s
 *      `autoFreeze` then freezes — after which the retained AngularJS controller
 *      throws on its own next in-place mutation.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OTHER SPECS
 * ---------------------------------------------
 * The producer is the ACTUAL `react-bridge.coffee` the browser loads, compiled by
 * the project's own CoffeeScript compiler, registered on a real AngularJS module
 * and instantiated by a real `angular.injector`. The event bus is AngularJS's own
 * `$scope.$on`/`$scope.$broadcast`. The consumer is the real registrar type the
 * realtime hooks declare. Only collaborators OUTSIDE the seam are doubled — see
 * `app/react/test-support/angularBridgeHarness.ts` for what and why.
 *
 * It stays browserless and offline (HR-5): jsdom already provides the `window`
 * AngularJS needs, and every module is resolved from `node_modules` or the working
 * tree.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { act, renderHook } from '@testing-library/react';

import {
    DEFAULT_BACKLOG_CONTROLLER_METHODS,
    DEFAULT_KANBAN_CONTROLLER_METHODS,
    ModelDouble,
    loadBacklogBridge,
    loadKanbanBridge,
} from '../test-support/angularBridgeHarness';
import type {
    BacklogRealtimeEventRegistrar,
    BacklogRealtimeHandlers,
} from '../backlog/hooks/useBacklogRealtime';
import {
    BACKLOG_REALTIME_MILESTONES_EVENT,
    BACKLOG_REALTIME_USERSTORIES_EVENT,
    useBacklogRealtime,
} from '../backlog/hooks/useBacklogRealtime';
import type {
    KanbanRealtimeEventRegistrar,
    UseKanbanRealtimeOptions,
} from '../kanban/hooks/useKanbanRealtime';
import {
    KANBAN_PROJECT_REFRESH_MATCHES,
    KANBAN_REALTIME_MAX_DELAY_MS,
    KANBAN_REALTIME_PROJECT_EVENT,
    KANBAN_REALTIME_USERSTORIES_EVENT,
    useKanbanRealtime,
} from '../kanban/hooks/useKanbanRealtime';

/** Repository root, derived from this file rather than from `process.cwd()`. */
const FRONT_ROOT = join(__dirname, '..', '..', '..');

/* --------------------------------------------------------------------------
 * A minimal persistent collection, matching the `.toJS()` probe the bridges use.
 *
 * The real board projections are `Immutable.Map`/`Immutable.List`
 * (`app/coffee/modules/kanban/kanban-usertories.coffee`), and the only thing the
 * seam asks of one is `.toJS()`. Reproducing just that member keeps the spec
 * independent of the immutable.js version while still driving the branch — and,
 * critically, lets the spec assert the MEMOISATION guarantee, because a
 * persistent collection's identity is its version.
 * -------------------------------------------------------------------------- */
class PersistentDouble<TPlain> {
    private readonly plain: TPlain;

    public toJSCalls = 0;

    public constructor(plain: TPlain) {
        this.plain = plain;
    }

    public toJS(): TPlain {
        this.toJSCalls += 1;

        return this.plain;
    }
}

/** The story attributes the kanban board holds per card, flattened. */
interface StoryAttrs {
    readonly id: number;
    readonly status: number;
    readonly swimlane: number | null;
    readonly subject: string;
}

/**
 * Builds the `usMap` shape the retained controller publishes.
 *
 * `usMap` is keyed by NUMERIC id and each value is a card whose `model` member
 * holds the story attributes (`kanban-usertories.coffee:245-257` writes
 * `us.model = usModel.getAttrs()`). The double reproduces `get` and `toJS`,
 * because the bridge reads the map through `get` and flattens it through `toJS`.
 */
function makeUsMap(stories: readonly StoryAttrs[]): {
    get(id: number): unknown;
    toJS(): unknown;
} {
    const cards = new Map<number, { get(key: string): unknown }>();
    const plain: Record<string, unknown> = {};

    for (const story of stories) {
        const model = { ...story };

        cards.set(story.id, {
            get(key: string): unknown {
                return key === 'model' ? model : undefined;
            },
        });

        plain[String(story.id)] = { id: story.id, model };
    }

    return {
        get(id: number): unknown {
            return cards.get(id);
        },
        toJS(): unknown {
            return plain;
        },
    };
}

const STORIES: readonly StoryAttrs[] = [
    { id: 4021, status: 12, swimlane: 7, subject: 'first' },
    { id: 4022, status: 12, swimlane: 7, subject: 'second' },
    { id: 4023, status: 13, swimlane: null, subject: 'third' },
];

/** The scope state the kanban bridge reads, close to what the controller sets. */
function kanbanScopeState(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        sectionName: 'kanban',
        projectId: 55,
        project: { id: 55, my_permissions: ['add_us', 'modify_us', 'delete_us'] },
        points: [],
        pointsById: {},
        usStatusList: [{ id: 12, name: 'New', is_archived: false }],
        usStatusById: {
            12: { id: 12, name: 'New', is_archived: false },
            13: { id: 13, name: 'Ready', is_archived: false },
            14: { id: 14, name: 'Archived', is_archived: true },
        },
        usByStatus: new PersistentDouble({ '12': [4021, 4022] }),
        usByStatusSwimlanes: new PersistentDouble({ '7': { '12': [4021] } }),
        usMap: makeUsMap(STORIES),
        swimlanesList: new PersistentDouble([{ id: 7, name: 'totam' }]),
        swimlanes: [{ id: 7, name: 'totam', statuses: [] }],
        swimlanesStatuses: { 7: [], '-1': [] },
        usCardVisibility: { 4021: true },
        ...overrides,
    };
}

/* ==========================================================================
 * 1. THE EVENT CHANNEL — the defect that made every payload `undefined`
 * ========================================================================== */

describe('the AngularJS → React event channel delivers real payloads', () => {
    it('⭐ delivers a broadcast payload as ARGUMENT 1 of the React handler', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        // Typed as the REAL registrar the realtime hook declares, so this
        // assignment is itself the contract check: a bridge whose `onAngularEvent`
        // did not match the hook's registrar would not compile here.
        const register: KanbanRealtimeEventRegistrar = harness.payload.events[
            'onAngularEvent'
        ] as unknown as KanbanRealtimeEventRegistrar;

        const received: unknown[] = [];
        const deregister = register(KANBAN_REALTIME_USERSTORIES_EVENT, (message) => {
            received.push(message);
        });

        harness.scope.$broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, {
            matches: 'userstories.userstory',
        });

        // The regression this pins: `received[0]` was `undefined` for EVERY event,
        // because the conversion helper was called with one argument instead of two.
        expect(received).toHaveLength(1);
        expect(received[0]).not.toBeUndefined();
        expect(received[0]).toEqual({ matches: 'userstories.userstory' });

        deregister();
    });

    it('⭐ never hands React AngularJS\u2019s event object', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const calls: unknown[][] = [];

        register(KANBAN_REALTIME_PROJECT_EVENT, (...args: unknown[]) => {
            calls.push(args);
        });

        harness.scope.$broadcast(KANBAN_REALTIME_PROJECT_EVENT, { matches: 'projects.project' });

        // Exactly one argument, and it is the payload. An event object would carry
        // `targetScope`/`currentScope` and so would put a live `$scope` on the React
        // side of the seam.
        expect(calls[0]).toHaveLength(1);
        expect(calls[0]?.[0]).toEqual({ matches: 'projects.project' });
        expect(calls[0]?.[0]).not.toHaveProperty('targetScope');
        expect(calls[0]?.[0]).not.toHaveProperty('currentScope');
        expect(calls[0]?.[0]).not.toHaveProperty('defaultPrevented');
    });

    it('delivers every payload argument of a multi-argument broadcast, in order', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const calls: unknown[][] = [];

        register('kanban:userstories:loaded', (...args: unknown[]) => {
            calls.push(args);
        });

        // `moveUs` broadcasts four payload arguments (`kanban/main.coffee:657`), so
        // a one-position shift would corrupt all four rather than only the first.
        harness.scope.$broadcast('kanban:userstories:loaded', [{ id: 4021 }], 13, 7, 0);

        expect(calls[0]).toEqual([[{ id: 4021 }], 13, 7, 0]);
    });

    it('returns AngularJS\u2019s own deregistration function, and it really deregisters', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];
        const deregister = register(KANBAN_REALTIME_USERSTORIES_EVENT, (message: unknown) => {
            received.push(message);
        });

        harness.scope.$broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, 'first');
        deregister();
        harness.scope.$broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, 'second');

        // A leak here is silent — it surfaces only as duplicated work after
        // navigating away and back — so the teardown path is asserted, not assumed.
        expect(received).toEqual(['first']);
    });

    it('the BACKLOG bridge delivers its payload as argument 1 as well', () => {
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: ['modify_us'] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        const register: BacklogRealtimeEventRegistrar = harness.payload.events[
            'onAngularEvent'
        ] as unknown as BacklogRealtimeEventRegistrar;

        const received: unknown[] = [];

        register(BACKLOG_REALTIME_MILESTONES_EVENT, (message) => {
            received.push(message);
        });
        register(BACKLOG_REALTIME_USERSTORIES_EVENT, (message) => {
            received.push(message);
        });

        harness.scope.$broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, { matches: 'milestones' });
        harness.scope.$broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, { matches: 'userstories' });

        expect(received).toEqual([{ matches: 'milestones' }, { matches: 'userstories' }]);
    });

    it('ignores a non-function handler instead of letting AngularJS throw at broadcast time', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: unknown,
        ) => unknown;

        expect(() => register('redraw:wip', null)).not.toThrow();
        expect(() => harness.scope.$broadcast('redraw:wip')).not.toThrow();
    });
});

/* ==========================================================================
 * 2. MODEL BOUNDARY — nothing that is not plain JSON may cross
 * ========================================================================== */

describe('the seam flattens recursively, at every depth', () => {
    it('⭐ unwraps models nested inside an ARRAY payload', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];

        register('kanban:userstories:loaded', (payload: unknown) => {
            received.push(payload);
        });

        // `moveUs` broadcasts an array of LIVE MODELS (`kanban/main.coffee:653-657`),
        // which is the exact payload shape a single-level conversion mishandles.
        harness.scope.$broadcast('kanban:userstories:loaded', [
            new ModelDouble('userstories', { id: 4021, status: 12, subject: 'first' }),
            new ModelDouble('userstories', { id: 4022, status: 12, subject: 'second' }),
        ]);

        const delivered = received[0] as unknown[];

        expect(Array.isArray(delivered)).toBe(true);
        expect(delivered).toHaveLength(2);

        for (const story of delivered) {
            expect(story).not.toBeInstanceOf(ModelDouble);
            expect(story).not.toHaveProperty('getAttrs');
            expect(story).not.toHaveProperty('_attrs');
            expect(story).not.toHaveProperty('_modifiedAttrs');
        }

        expect(delivered[0]).toEqual({ id: 4021, status: 12, subject: 'first' });
        expect(delivered[1]).toEqual({ id: 4022, status: 12, subject: 'second' });
    });

    it('⭐ unwraps a model nested inside another model\u2019s attributes', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];

        register('sprints:loaded', (payload: unknown) => {
            received.push(payload);
        });

        // A milestone model whose `user_stories` are themselves models — the shape
        // `resources/sprints.coffee:18-20` and `:33-36` build. `getAttrs()` is one
        // level deep, so only a recursive walk reaches the nested models.
        harness.scope.$broadcast(
            'sprints:loaded',
            new ModelDouble('milestones', {
                id: 8,
                name: 'Sprint 2026-5-15',
                user_stories: [
                    new ModelDouble('userstories', { id: 4021, sprint_order: 1 }),
                    new ModelDouble('userstories', { id: 4022, sprint_order: 2 }),
                ],
            }),
        );

        const sprint = received[0] as { user_stories: unknown[] };

        expect(sprint).not.toHaveProperty('getAttrs');
        expect(sprint.user_stories).toHaveLength(2);

        for (const story of sprint.user_stories) {
            expect(story).not.toBeInstanceOf(ModelDouble);
            expect(story).not.toHaveProperty('getAttrs');
        }

        expect(sprint.user_stories[0]).toEqual({ id: 4021, sprint_order: 1 });
    });

    it('unwraps a persistent collection nested inside a plain object payload', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];

        register('filters:update', (payload: unknown) => {
            received.push(payload);
        });

        harness.scope.$broadcast('filters:update', {
            statuses: new PersistentDouble([{ id: 12, count: 4 }]),
        });

        expect(received[0]).toEqual({ statuses: [{ id: 12, count: 4 }] });
    });

    it('drops AngularJS\u2019s $$ bookkeeping at every depth', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];

        register('usform:new:success', (payload: unknown) => {
            received.push(payload);
        });

        // `ng-repeat` without a `track by` stamps `$$hashKey` onto every object it
        // iterates. React freezing one of those makes the next repeat pass throw.
        harness.scope.$broadcast('usform:new:success', {
            id: 4021,
            $$hashKey: 'object:17',
            nested: { id: 1, $$hashKey: 'object:18' },
            list: [{ id: 2, $$hashKey: 'object:19' }],
        });

        expect(received[0]).toEqual({
            id: 4021,
            nested: { id: 1 },
            list: [{ id: 2 }],
        });
    });

    it('passes scalars through untouched, including the falsy ones', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[][] = [];

        register('redraw:wip', (...args: unknown[]) => {
            received.push(args);
        });

        harness.scope.$broadcast('redraw:wip', 0, false, '', null);

        expect(received[0]).toEqual([0, false, '', null]);
    });
});

/* ==========================================================================
 * 3. STATE ISOLATION — nothing React may freeze is still owned by AngularJS
 * ========================================================================== */

describe('the seam never hands React a live AngularJS-owned value', () => {
    /**
     * Reproduces what `immer` does to anything entering React state with
     * `autoFreeze` on (`P-IMMER-4`): a deep freeze. If the frozen graph is still
     * AngularJS's, the controller's next in-place mutation throws — in strict
     * mode, which every ES module and every compiled TypeScript module is.
     */
    function deepFreeze(value: unknown): void {
        if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
            return;
        }

        Object.freeze(value);

        for (const member of Object.values(value as Record<string, unknown>)) {
            deepFreeze(member);
        }
    }

    it('⭐ detaches usCardVisibility, so freezing it cannot break the controller', () => {
        const visibility: Record<string, boolean> = { 4021: true };
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState({ usCardVisibility: visibility }),
        });

        const handed = harness.payload.events['getUsCardVisibility']?.() as Record<
            string,
            boolean
        >;

        expect(handed).toEqual({ 4021: true });
        expect(handed).not.toBe(visibility);

        deepFreeze(handed);

        // The controller keys this object per card as cards scroll into view
        // (`kanban/main.coffee:757`); it must still be able to.
        expect(() => {
            visibility['4022'] = true;
        }).not.toThrow();
        expect(visibility['4022']).toBe(true);
    });

    it('⭐ detaches movedUs, which the controller pushes into and empties on a timer', () => {
        const movedUs: number[] = [4021];
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            controllerState: { movedUs },
        });

        const handed = harness.payload.events['getMovedUs']?.() as number[];

        expect(handed).toEqual([4021]);
        expect(handed).not.toBe(movedUs);

        deepFreeze(handed);

        expect(() => movedUs.push(4022)).not.toThrow();
        expect(movedUs).toEqual([4021, 4022]);
    });

    it('⭐ detaches selectedUss, which the selection toggle mutates in place', () => {
        const selectedUss: Record<string, unknown> = { 4021: { id: 4021 } };
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            controllerState: { selectedUss },
        });

        const handed = harness.payload.events['getSelectedUss']?.() as Record<string, unknown>;

        expect(handed).toEqual({ 4021: { id: 4021 } });
        expect(handed).not.toBe(selectedUss);
        expect(handed['4021']).not.toBe(selectedUss['4021']);

        deepFreeze(handed);

        expect(() => {
            delete selectedUss['4021'];
        }).not.toThrow();
        expect(selectedUss).toEqual({});
    });

    it('⭐ detaches the zoom feature list, which is an ARRAY and not a scalar', () => {
        const zoom = ['assigned_to', 'ref'];
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            controllerState: { zoom, zoomLevel: 1 },
        });

        // Easy to mistake for a scalar because it sits between two numbers in the
        // payload, but the shared zoom component reduces its four tiers into one
        // list (`kanban-board-zoom.directive.coffee:31-39`).
        expect(harness.payload.params['zoom']).toEqual(zoom);
        expect(harness.payload.params['zoom']).not.toBe(zoom);
        expect(harness.payload.events['getZoom']?.()).toEqual(zoom);
        expect(harness.payload.events['getZoom']?.()).not.toBe(zoom);

        // The number beside it is passed through untouched, including level 0.
        expect(harness.payload.params['zoomLevel']).toBe(1);
    });

    it('⭐ detaches the two filter arrays, in params AND through the accessors', () => {
        const selectedFilters: unknown[] = [{ id: 12, type: 'status' }];
        const customFilters: unknown[] = [{ id: 1, name: 'mine' }];

        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            controllerState: { selectedFilters, customFilters },
        });

        for (const [handed, live] of [
            [harness.payload.params['selectedFilters'], selectedFilters],
            [harness.payload.params['customFilters'], customFilters],
            [harness.payload.events['getSelectedFilters']?.(), selectedFilters],
            [harness.payload.events['getCustomFilters']?.(), customFilters],
        ] as Array<[unknown, unknown[]]>) {
            expect(handed).toEqual(live);
            expect(handed).not.toBe(live);
        }

        deepFreeze(harness.payload.params['selectedFilters']);
        deepFreeze(harness.payload.events['getSelectedFilters']?.());

        // The retained filter mixin splices and replaces these in place.
        expect(() => selectedFilters.push({ id: 13, type: 'status' })).not.toThrow();
        expect(selectedFilters).toHaveLength(2);
    });

    it('⭐ BACKLOG: detaches the plain project, stats, filter and translation reads', () => {
        const stats = { total_points: 392, milestones: [{ name: 'a', optimal: 1 }] };
        const project = { id: 55, my_permissions: ['modify_us'] };
        const filters = { statuses: [{ id: 12, count: 4 }] };
        const translationData = { totalUserStories: 11 };
        const activeFilters = [{ id: 12 }];

        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project,
                stats,
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                visibleUserStories: [4021],
                noSwimlaneUserStories: [4022],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
            controllerState: { filters, translationData, activeFilters },
        });

        for (const [accessor, live] of [
            ['getProject', project],
            ['getStats', stats],
            ['getFilters', filters],
            ['getTranslationData', translationData],
            ['getActiveFilters', activeFilters],
        ] as Array<[string, object]>) {
            const handed = harness.payload.events[accessor]?.();

            expect(handed).toEqual(live);
            expect(handed).not.toBe(live);
        }

        expect(harness.payload.params['project']).not.toBe(project);

        deepFreeze(harness.payload.events['getStats']?.());

        // `loadProjectStats` reassigns and reads through `$scope.stats`.
        expect(() => {
            stats.milestones.push({ name: 'b', optimal: 2 });
        }).not.toThrow();
    });

    it('⭐ BACKLOG: flattens a sprint\u2019s nested story models two levels down', () => {
        const sprintModel = new ModelDouble('milestones', {
            id: 8,
            name: 'Sprint 2026-5-15',
            closed: false,
            user_stories: [
                new ModelDouble('userstories', { id: 4021, sprint_order: 1 }),
                new ModelDouble('userstories', { id: 4022, sprint_order: 2 }),
            ],
        });

        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: ['modify_us'] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [sprintModel],
                closedSprints: [],
                sprintsById: { 8: sprintModel },
                closedSprintsById: {},
            },
        });

        for (const source of [
            (harness.payload.events['getSprints']?.() as unknown[])[0],
            (harness.payload.events['getSprintsById']?.() as Record<string, unknown>)['8'],
        ]) {
            const sprint = source as { id: number; user_stories: unknown[] };

            expect(sprint).not.toHaveProperty('getAttrs');
            expect(sprint.id).toBe(8);
            expect(sprint.user_stories).toHaveLength(2);

            for (const story of sprint.user_stories) {
                expect(story).not.toBeInstanceOf(ModelDouble);
                expect(story).not.toHaveProperty('getAttrs');
            }

            expect(sprint.user_stories[0]).toEqual({ id: 4021, sprint_order: 1 });
        }
    });

    it('BACKLOG: normalises an absent current sprint to null rather than undefined', () => {
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: ['modify_us'] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
            controllerOverrides: { findCurrentSprint: () => undefined },
        });

        expect(harness.payload.events['findCurrentSprint']?.()).toBeNull();
    });

    it('⭐ a LATER in-place mutation of the source model cannot reach React', () => {
        const storyModel = new ModelDouble('userstories', {
            id: 4021,
            subject: 'before',
            tags: [['urgent', '#111111']],
        });

        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const register = harness.payload.events['onAngularEvent'] as (
            name: string,
            handler: (...args: unknown[]) => void,
        ) => () => void;

        const received: unknown[] = [];

        register('usform:edit:success', (payload: unknown) => {
            received.push(payload);
        });

        harness.scope.$broadcast('usform:edit:success', storyModel);

        // The other direction of the same isolation guarantee: not "can React
        // freeze AngularJS's object" but "can AngularJS change React's". A shared
        // reference would show `after` here, and React would render a value it was
        // never told about.
        storyModel.mutate('subject', 'after');

        expect(received[0]).toEqual({
            id: 4021,
            subject: 'before',
            tags: [['urgent', '#111111']],
        });
    });

    it('keeps a memoised identity for an UNCHANGED persistent projection', () => {
        const scopeState = kanbanScopeState();
        const harness = loadKanbanBridge({ scopeState });

        const first = harness.payload.events['getUsByStatus']?.();
        const second = harness.payload.events['getUsByStatus']?.();

        // Structural sharing is what replaces immutable.js change detection
        // (`P-IMMER-4`), and a fresh identity per read would throw it away. Sound
        // for this branch alone: a persistent collection is never mutated in place,
        // so its identity IS its version.
        expect(second).toBe(first);
        expect((scopeState['usByStatus'] as PersistentDouble<unknown>).toJSCalls).toBe(1);
    });

    it('treats a REPLACED persistent projection as a cache miss', () => {
        const scopeState = kanbanScopeState();
        const harness = loadKanbanBridge({ scopeState });

        const before = harness.payload.events['getUsByStatus']?.();

        harness.scope['usByStatus'] = new PersistentDouble({ '13': [4023] });

        const after = harness.payload.events['getUsByStatus']?.();

        expect(after).not.toBe(before);
        expect(after).toEqual({ '13': [4023] });
    });
});

/* ==========================================================================
 * 4. THE PAYLOAD SURFACE — the contract `tgLoadElement` assigns
 * ========================================================================== */

describe('the published payload matches what tgLoadElement assigns and React reads', () => {
    it('is assigned by tgLoadElement as DOM PROPERTIES, which is why callbacks survive', () => {
        const loader = readFileSync(
            join(FRONT_ROOT, 'app', 'coffee', 'modules', 'base', 'load-element.coffee'),
            'utf8',
        );

        // Properties, not attributes: an attribute stringifies its value, so a
        // `params` object would arrive as "[object Object]" and every `events`
        // callback would be lost outright. This asserts the mechanism the whole seam
        // rests on is still the one in the tree, and that the reused directive still
        // assigns all three members.
        expect(loader).toContain('el.component = legacyObj.component');
        expect(loader).toContain('el.params = legacyObj.params');
        expect(loader).toContain('el.events = legacyObj.events');
        expect(loader).not.toContain('setAttribute');
    });

    it('the harness\u2019s transcribed bindOnce still matches app/coffee/utils.coffee', () => {
        const utils = readFileSync(join(FRONT_ROOT, 'app', 'coffee', 'utils.coffee'), 'utf8');

        // The backlog bridge's whole body runs inside `bindOnce`, so the harness
        // reproduces it rather than importing a 300-line module that installs itself
        // onto a browser global. That transcription is only trustworthy while the
        // original is unchanged, so the original's shape is asserted here: evaluate
        // the attribute, run immediately when it is already defined, otherwise watch
        // and deregister after the first defined value.
        expect(utils).toContain('bindOnce = (scope, attr, continuation) =>');
        expect(utils).toContain('val = scope.$eval(attr)');
        expect(utils).toContain('return continuation(val)');
        expect(utils).toContain('delBind = scope.$watch attr, (val) ->');
        expect(utils).toContain('delBind() if delBind');
        expect(utils).toContain('taiga.bindOnce = bindOnce');
    });

    it('publishes exactly component, params and events', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        expect(Object.keys(harness.payload).sort()).toEqual(['component', 'events', 'params']);
        expect(harness.payload.component).toBe('kanban-board');
    });

    it('BACKLOG publishes the same three keys under its own component name', () => {
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: [] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        expect(Object.keys(harness.payload).sort()).toEqual(['component', 'events', 'params']);
        expect(harness.payload.component).toBe('backlog-screen');
    });

    it('every events member is a function, so none can stringify across the seam', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        for (const [name, member] of Object.entries(harness.payload.events)) {
            expect(typeof member).toBe(`function`);
            expect(name).not.toBe('');
        }
    });

    it('keeps stable function identities across rebuilds of the same screen', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        // Within one payload the identities are what React memoises against; a
        // rebuild is a re-mount, so only intra-payload stability is asserted.
        const first = harness.payload.events['getUsByStatus'];

        expect(harness.payload.events['getUsByStatus']).toBe(first);
    });

    it('delegates to only controller members that actually exist', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        // Guards against the bridge calling a method the retained controller does
        // not have: the recorder is built from an explicit list, so an unknown
        // member would be `undefined` and the call would throw.
        for (const name of DEFAULT_KANBAN_CONTROLLER_METHODS) {
            expect(typeof harness.controller[name]).toBe('function');
        }
    });

    it('BACKLOG delegates to only controller members that actually exist', () => {
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: [] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        for (const name of DEFAULT_BACKLOG_CONTROLLER_METHODS) {
            expect(typeof harness.controller[name]).toBe('function');
        }
    });

});

/* ==========================================================================
 * 4b. THE AUTHORIZATION SEAM — the gates the payload itself has to keep
 *
 * `.events` is assigned onto the host element as a DOM PROPERTY, so anything
 * holding a reference to that element can invoke any callback on it directly with
 * arguments of its own choosing, and no React code is in the call path. Hiding a
 * control is presentation; these are the gates. Driven against the REAL bridge
 * because a double of the permission service would only prove the double.
 * ========================================================================== */

describe('the payload keeps its own authorization gates', () => {
    it('refuses every write on an ARCHIVED project, before touching the controller', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            oracle: {
                permissions: ['add_us', 'modify_us', 'delete_us'],
                archived: true,
                projectFlags: { is_kanban_activated: true },
            },
        });

        harness.payload.events['moveUs']?.(null, [4021], 13, 7, 0, null, null);
        harness.payload.events['addNewUs']?.('standard', 12);
        harness.payload.events['deleteUs']?.(4021);

        // The archived gate is the one that CANNOT be left to the server: the bulk
        // backlog-order endpoint enforces `modify_us` and the blocked state but not
        // the archived state, so a member who legitimately retains `modify_us` could
        // still reorder an archived project unless the client refuses.
        expect(harness.controller.calls).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('archived');
    });

    it('FAILS CLOSED when the project has not loaded yet', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            oracle: { permissions: ['modify_us'], projectMissing: true },
        });

        harness.payload.events['moveUs']?.(null, [4021], 13, 7, 0, null, null);

        expect(harness.controller.calls).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('not loaded yet');
    });

    it('refuses writes when the kanban module is disabled for the project', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            oracle: {
                permissions: ['modify_us'],
                projectFlags: { is_kanban_activated: false },
            },
        });

        harness.payload.events['moveUs']?.(null, [4021], 13, 7, 0, null, null);

        // The route-level check governs NAVIGATION only, so a callback invoked
        // directly needs the feature gate again.
        expect(harness.controller.calls).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('kanban module is disabled');
    });

    it('honours delete_us as its OWN permission, not as modify_us', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            oracle: {
                permissions: ['modify_us'],
                projectFlags: { is_kanban_activated: true },
            },
        });

        harness.payload.events['deleteUs']?.(4021);
        harness.payload.events['editUs']?.(4021);

        expect(harness.controller.callsTo('deleteUs')).toHaveLength(0);
        expect(harness.controller.callsTo('editUs')).toHaveLength(1);
    });

    it('refuses adding to an ARCHIVED status while allowing an open one', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['addNewUs']?.('standard', 14);
        expect(harness.controller.callsTo('addNewUs')).toHaveLength(0);

        harness.payload.events['addNewUs']?.('standard', 12);
        expect(harness.controller.callsTo('addNewUs')).toHaveLength(1);
    });

    it('leaves every read ungated, so a read-only member still sees the board', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            oracle: { permissions: [], projectFlags: { is_kanban_activated: true } },
        });

        expect(harness.payload.events['getUsByStatus']?.()).toEqual({ '12': [4021, 4022] });
        expect(harness.payload.events['getProjectId']?.()).toBe(55);
        expect(harness.warnings).toHaveLength(0);

        // The model double reports its resource name the way `$tgModel` does, which
        // is what lets a spec tell a story model from a milestone model when both
        // cross the same seam.
        expect(new ModelDouble('userstories', { id: 1 }).getName()).toBe('userstories');
    });

    it('BACKLOG: builds its payload only once `project` appears on the scope', () => {
        // The directive body runs inside `bindOnce`, so with no project on the scope
        // at link time the payload must be DEFERRED rather than built from nothing —
        // and must then appear on the first defined value and never be rebuilt, since
        // `tgLoadElement` watches it by reference identity.
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        expect(harness.payload).toBeUndefined();

        // A digest with `project` still undefined must build nothing: `bindOnce`
        // skips an undefined value rather than treating the first digest as the
        // arrival of the project.
        harness.scope.$digest();

        expect(
            (harness.controller as unknown as { reactScreen?: unknown }).reactScreen,
        ).toBeUndefined();

        harness.scope['project'] = { id: 55, my_permissions: ['modify_us'] };
        harness.scope.$digest();

        const built = (harness.controller as unknown as { reactScreen?: { component: string } })
            .reactScreen;

        expect(built).toBeDefined();
        expect(built?.component).toBe('backlog-screen');

        harness.scope['project'] = { id: 55, my_permissions: [] };
        harness.scope.$digest();

        expect(
            (harness.controller as unknown as { reactScreen?: unknown }).reactScreen,
        ).toBe(built);
    });
});

/* ==========================================================================
 * 5. THE CONTROLLER SEAM — what the bridge delegates must be usable as-is
 * ========================================================================== */

describe('what the bridge delegates is what the retained controller can consume', () => {
    /**
     * Reproduces the FIRST TWO LINES of `KanbanController.moveUs`
     * (`app/coffee/modules/kanban/main.coffee:651-655`):
     *
     *     usList = _.map usList, (us) => @kanbanUserstoriesService.getUsModel(us.id)
     *     …
     *     usList.map((it) => it.id)
     *
     * `getUsModel` is `_.find(userstoriesRaw, (us) -> us.id == id)`, so a NUMERIC
     * element makes `us.id` undefined, the lookup misses, and the write dies on
     * `it.id` of `undefined`. Running the real reads is what turns "the bridge
     * handed over the right shape" into an executable claim instead of a shape
     * comparison against a guess.
     */
    function resolveLikeController(usList: readonly unknown[]): number[] {
        return usList
            .map((us) => (us as { id?: number }).id)
            .map((id) => STORIES.find((story) => story.id === id))
            .map((story) => {
                if (!story) {
                    throw new TypeError(
                        'getUsModel returned undefined: the bridge handed over a value ' +
                            'whose `.id` the controller cannot read',
                    );
                }

                return story.id;
            });
    }

    it('⭐ moveUs receives values whose `.id` the controller can read', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState(),
            controllerOverrides: {
                moveUs: (
                    _ctx: unknown,
                    usList: readonly unknown[],
                ) => resolveLikeController(usList),
            },
        });

        // React holds NUMERIC ids: `useSortableList` produces them and the board's
        // action shape carries them.
        harness.payload.events['moveUs']?.(null, [4021, 4022], 13, 7, 0, null, 4023);

        const call = harness.controller.callsTo('moveUs')[0];

        expect(call).toBeDefined();

        const forwarded = call?.args[1] as readonly unknown[];

        // Not numbers any more, and not models either: the plain story attributes
        // `usMap` already holds, which is exactly what `moveToTopDropdown` forwards.
        expect(forwarded).toHaveLength(2);
        expect(resolveLikeController(forwarded)).toEqual([4021, 4022]);

        for (const story of forwarded) {
            expect(typeof story).toBe('object');
            expect(story).toHaveProperty('id');
        }
    });

    it('⭐ moveUsToTop receives `id`, `status` AND `swimlane`, which it reads', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUsToTop']?.([4021]);

        const forwarded = (harness.controller.argsOf('moveUsToTop')[0] as readonly unknown[])[0] as {
            id: number;
            status: number;
            swimlane: number | null;
        };

        // `moveUsToTop` reads all three (`kanban/main.coffee:175-199`) before it
        // reaches `moveUs`, so a bare id breaks it one frame earlier.
        expect(forwarded.id).toBe(4021);
        expect(forwarded.status).toBe(12);
        expect(forwarded.swimlane).toBe(7);
    });

    it('accepts an object carrying an id as well, so no call site can get it wrong', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [{ id: 4021 }], 13, null, 0, null, null);

        const forwarded = harness.controller.argsOf('moveUs')[1] as readonly unknown[];

        expect((forwarded[0] as { id: number }).id).toBe(4021);
        expect((forwarded[0] as { status: number }).status).toBe(12);
    });

    it('preserves the leading ctx argument verbatim, because the queue keys on it', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });
        const ctx = { name: 'kanban:us:move' };

        harness.payload.events['moveUs']?.(ctx, [4021], 13, 7, 0, null, null);

        expect(harness.controller.argsOf('moveUs')[0]).toBe(ctx);
    });

    it('refuses a story that is not on this board, and does not delegate', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [999_999], 13, 7, 0, null, null);

        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('not on this board');
    });

    it('refuses the WHOLE list when one entry of a multi-card move is unknown', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021, 999_999], 13, 7, 0, null, null);

        // All-or-nothing, because the write is position-relative: persisting the
        // valid subset would reorder the board in a way nobody asked for, behind an
        // HTTP 200.
        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
    });

    it('resolves moveToTopDropdown through the same board attributes', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        // React holds the ALREADY-flattened card, so the retained wrapper's
        // `us.toJS().model` cannot be used; the card's `model` member is unwrapped
        // here instead. A stale `status` on the caller's copy must not survive.
        harness.payload.events['moveToTopDropdown']?.({
            id: 4021,
            model: { id: 4021, status: 99, swimlane: 7 },
        });

        const forwarded = harness.controller.argsOf('moveUsToTop')[0] as {
            id: number;
            status: number;
        };

        expect(forwarded.id).toBe(4021);
        expect(forwarded.status).toBe(12);
    });

    /* ------------------------------------------------------------------
     * F10 — the destination swimlane
     *
     * `moveUs` mutates the board OPTIMISTICALLY and has no rollback
     * (`kanban/main.coffee:665` → `kanban-usertories.coffee:182-187`), so a
     * swimlane the backend will reject still moves every dragged card on screen
     * first and leaves the board wrong until a full reload.
     * ------------------------------------------------------------------ */

    it('⭐ accepts a real swimlane id and forwards it unchanged', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, 7, 0, null, null);

        expect(harness.controller.argsOf('moveUs')[3]).toBe(7);
    });

    it('⭐ accepts the synthetic UNCLASSIFIED swimlane -1 and forwards it VERBATIM', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, -1, 0, null, null);

        // `-1` is the swimlane the service inserts when some stories have none
        // (`kanban-usertories.coffee:315-321`). The CONTROLLER maps it to null for
        // the API (`main.coffee:659-661`); rewriting it here would destroy the
        // distinction its local mutation still needs.
        expect(harness.controller.argsOf('moveUs')[3]).toBe(-1);
    });

    it('⭐ canonicalises an absent swimlane to null rather than passing undefined on', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, undefined, 0, null, null);

        expect(harness.controller.argsOf('moveUs')[3]).toBeNull();
    });

    it('⭐ REFUSES a swimlane belonging to another project, before any local mutation', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, 9_999, 0, null, null);

        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain(
            'that swimlane does not belong to this project',
        );
    });

    it('⭐ REFUSES a malformed swimlane value', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, 'unclassified', 0, null, null);

        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('the swimlane id is not a number');
    });

    it('⭐ REFUSES a real-looking swimlane id when the board has no swimlanes yet', () => {
        const harness = loadKanbanBridge({
            scopeState: kanbanScopeState({ swimlanes: undefined }),
        });

        harness.payload.events['moveUs']?.(null, [4021], 12, 7, 0, null, null);

        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain('no swimlanes yet');
    });

    it('still refuses an anchor that is not on this board', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 12, 7, 0, 999_999, null);
        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);

        harness.payload.events['moveUs']?.(null, [4021], 12, 7, 0, null, 999_999);
        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);

        // A real anchor still goes through, and still as an ID: that is what the
        // ordering arithmetic and the request body take.
        harness.payload.events['moveUs']?.(null, [4021], 12, 7, 0, null, 4023);
        expect(harness.controller.argsOf('moveUs')[6]).toBe(4023);
    });

    it('refuses a status that does not belong to this project', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        harness.payload.events['moveUs']?.(null, [4021], 9_999, 7, 0, null, null);

        expect(harness.controller.callsTo('moveUs')).toHaveLength(0);
        expect(harness.warnings.join('\n')).toContain(
            'that status does not belong to this project',
        );
    });

    it('⭐ BACKLOG: moveUs receives LIVE models, which the drag queue mutates', () => {
        const storyModel = new ModelDouble('userstories', { id: 4021, sprint_order: 1 });

        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: ['modify_us'] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [storyModel],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        harness.payload.events['moveUs']?.('sprint:us:move', [4021], 0, null, null, null);

        const forwarded = harness.controller.argsOf('moveUs')[1] as readonly unknown[];

        // Deliberately asymmetric with the board: the backlog queue splices and
        // reconciles LIVE `$tgModel`s (`backlog/main.coffee:601-602`, `:643`,
        // `:648-649`, `:670`, `:689-695`), so re-hydration to the model is required
        // rather than optional here.
        expect(forwarded[0]).toBe(storyModel);
    });
});

/* ==========================================================================
 * 6. END TO END — the real React hook, driven by the real AngularJS broadcast
 *
 * ⭐⭐ THIS IS THE SECTION THE REVIEW'S COVERAGE GAP NAMED. Everything above
 * asserts the bridge's OUTPUT; this asserts that the two shipped consumers
 * actually receive it. Producer: the compiled `react-bridge.coffee`. Transport:
 * AngularJS's own `$scope.$broadcast`. Consumer: `useKanbanRealtime` /
 * `useBacklogRealtime` themselves, mounted in React, with no registrar double
 * anywhere in the path. A wrong arity on either side fails here, at run time,
 * whichever side introduced it.
 * ========================================================================== */

describe('end to end: an AngularJS broadcast reaches the shipped React hook', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** Advances past the longest debounce wait the kanban hook can have drawn. */
    function runOutTheWait(): void {
        act(() => {
            jest.advanceTimersByTime(KANBAN_REALTIME_MAX_DELAY_MS + 1);
        });
    }

    it('⭐ useKanbanRealtime receives the userstories payload and reloads with it', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        // Taken straight off the payload and typed as the hook's own option, so the
        // assignment is a compile-time contract check and the run is a run-time one.
        const registerAngularEvent = harness.payload.events[
            'onAngularEvent'
        ] as unknown as KanbanRealtimeEventRegistrar;

        const onUserStoriesChanged = jest.fn<void, [unknown]>();
        const onProjectAttributesChanged = jest.fn<void, []>();

        renderHook(() => {
            const options: UseKanbanRealtimeOptions = {
                registerAngularEvent,
                isLightboxOpen: false,
                onUserStoriesChanged,
                onProjectAttributesChanged,
            };

            useKanbanRealtime(options);
        });

        act(() => {
            harness.scope.$broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, {
                matches: 'userstories.userstory',
            });
        });

        runOutTheWait();

        // The exact regression pair F1+F2 produced: one call, with `undefined`.
        expect(onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(onUserStoriesChanged).toHaveBeenCalledWith({
            matches: 'userstories.userstory',
        });
        expect(onUserStoriesChanged.mock.calls[0]?.[0]).not.toBeUndefined();
    });

    it('⭐ useKanbanRealtime rebuilds only for a project match it can actually read', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        const registerAngularEvent = harness.payload.events[
            'onAngularEvent'
        ] as unknown as KanbanRealtimeEventRegistrar;

        const onProjectAttributesChanged = jest.fn<void, []>();

        renderHook(() => {
            const options: UseKanbanRealtimeOptions = {
                registerAngularEvent,
                isLightboxOpen: false,
                onUserStoriesChanged: jest.fn<void, [unknown]>(),
                onProjectAttributesChanged,
            };

            useKanbanRealtime(options);
        });

        // An unrelated match must be IGNORED, which is only observable if the hook
        // can read `matches` at all: an `undefined` payload would be ignored too, so
        // the pair of assertions is what distinguishes "filtered" from "never
        // arrived".
        act(() => {
            harness.scope.$broadcast(KANBAN_REALTIME_PROJECT_EVENT, { matches: 'projects.tag' });
        });
        runOutTheWait();

        expect(onProjectAttributesChanged).not.toHaveBeenCalled();

        act(() => {
            harness.scope.$broadcast(KANBAN_REALTIME_PROJECT_EVENT, {
                matches: KANBAN_PROJECT_REFRESH_MATCHES[0],
            });
        });
        runOutTheWait();

        expect(onProjectAttributesChanged).toHaveBeenCalledTimes(1);
    });

    it('⭐ useKanbanRealtime stops hearing broadcasts once React unmounts it', () => {
        const harness = loadKanbanBridge({ scopeState: kanbanScopeState() });

        const registerAngularEvent = harness.payload.events[
            'onAngularEvent'
        ] as unknown as KanbanRealtimeEventRegistrar;

        const onUserStoriesChanged = jest.fn<void, [unknown]>();

        const { unmount } = renderHook(() => {
            const options: UseKanbanRealtimeOptions = {
                registerAngularEvent,
                isLightboxOpen: false,
                onUserStoriesChanged,
                onProjectAttributesChanged: jest.fn<void, []>(),
            };

            useKanbanRealtime(options);
        });

        unmount();

        act(() => {
            harness.scope.$broadcast(KANBAN_REALTIME_USERSTORIES_EVENT, { matches: 'x' });
        });
        runOutTheWait();

        // The deregistration function the bridge hands back is AngularJS's own, and
        // a leak here is silent — it shows up only as duplicated reloads after
        // navigating away and back.
        expect(onUserStoriesChanged).not.toHaveBeenCalled();
    });

    it('⭐ useBacklogRealtime is driven by both of its real broadcasts', () => {
        const harness = loadBacklogBridge({
            scopeState: {
                projectId: 55,
                project: { id: 55, my_permissions: ['modify_us'] },
                points: [],
                pointsById: {},
                usStatusById: {},
                usStatusList: [],
                userstories: [],
                sprints: [],
                closedSprints: [],
                sprintsById: {},
                closedSprintsById: {},
            },
        });

        const registerAngularEvent = harness.payload.events[
            'onAngularEvent'
        ] as unknown as BacklogRealtimeEventRegistrar;

        const handlers: BacklogRealtimeHandlers = {
            onUserStoriesChanged: jest.fn<void, []>(),
            onMilestonesChanged: jest.fn<void, []>(),
        };

        const { unmount } = renderHook(() => {
            useBacklogRealtime(registerAngularEvent, handlers);
        });

        act(() => {
            harness.scope.$broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, { matches: 'us' });
            harness.scope.$broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, { matches: 'ms' });
        });

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);

        unmount();

        act(() => {
            harness.scope.$broadcast(BACKLOG_REALTIME_USERSTORIES_EVENT, { matches: 'us' });
            harness.scope.$broadcast(BACKLOG_REALTIME_MILESTONES_EVENT, { matches: 'ms' });
        });

        expect(handlers.onUserStoriesChanged).toHaveBeenCalledTimes(1);
        expect(handlers.onMilestonesChanged).toHaveBeenCalledTimes(1);
    });
});
