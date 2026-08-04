/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specs for `useKanbanData`.
 *
 * Browserless by construction: jsdom only. No network, no AngularJS bootstrap, no
 * browser-automation runner, no snapshot, no persistent-structure fixture, and no
 * dependency on the built distribution. Every AngularJS service is a structural
 * double supplied through `mockInjector`, which THROWS for any name the spec did not
 * supply — so "this hook resolves nothing else" is asserted by the doubles that are
 * ABSENT rather than by prose.
 *
 * ===========================================================================
 * WHAT EACH LAYER OF THE HARNESS EXISTS TO CATCH
 * ===========================================================================
 * The hook is a data SEAM, so almost every way it can break is a boundary that still
 * type-checks. Each layer below is aimed at one of those:
 *
 *   - A RECORDING INJECTOR (`renderKanbanData`) counts the service names resolved, so
 *     "the resource bag is resolved exactly once per render" is counted rather than
 *     inferred, and a fourth resolution throws instead of being tolerated.
 *   - FACADE SPIES (`spyOnFacades`) observe the one mistake the request itself cannot
 *     show: handing a facade the WRONG SUB-RESOURCE of `$tgResources`. They also
 *     observe the frozen order write's argument COUNT, which is seven rather than six
 *     because the service comes first. `jest.spyOn` passes through, so the real
 *     facade still runs.
 *   - MODEL DOUBLES with NON-ENUMERABLE ACCESSOR attributes reproduce `$tgModel`'s own
 *     shape, so an implementation that spread a model instead of calling `getAttrs()`
 *     fails these specs rather than passing by accident.
 *   - A PLAIN-DATA WALK (`nonPlainDataFindings`) refuses any wrapper, thenable, DOM
 *     node or non-plain prototype in the values React receives, and self-tests
 *     against each of those so it cannot pass vacuously.
 *   - OBSERVER STUBS installed and removed per test keep this file's footprint on the
 *     shared jsdom global exactly zero.
 *
 * The gates that no run-time call can express — "never imports a transport", "never
 * touches a digest" — are covered by a source scan of the unit WITH COMMENTS
 * STRIPPED, so documentation prose can neither satisfy nor violate a prohibition. The
 * one deliberate exception reads the prose on purpose, and says why.
 *
 * Mock state needs no hand-written teardown: `clearMocks` and `restoreMocks` are set
 * in jest.config.js, so no whole-registry clear, reset or restore call appears
 * anywhere in this file — every double is cleared, and every spy restored, between
 * tests by the runner.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, renderHook } from '@testing-library/react';

import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import type {
    AngularHttpResponse,
    AngularPromise,
    ErrorHandlingService,
    HttpHeadersGetter,
    PersistentStructure,
    ProjectService,
    ResourceParams,
    TaigaModel,
    TaigaResources,
} from '../../bridge/useAngularService';
import * as kanbanStorageApi from '../../shared/api/kanbanStorage';
import * as projectsApi from '../../shared/api/projects';
import * as swimlanesApi from '../../shared/api/swimlanes';
import * as userstoriesApi from '../../shared/api/userstories';
import type { UserStory } from '../../shared/types/userStory';
import { UNCLASSIFIED_SWIMLANE_ID } from '../state/boardReducer';
import {
    KANBAN_VALID_QUERY_PARAMS,
    KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA,
    useKanbanData,
} from './useKanbanData';
import type { KanbanDataApi, KanbanFoldModes } from './useKanbanData';

/* ==========================================================================
 * THE INCUMBENT VALUES THIS SPEC PINS
 * ========================================================================== */

/**
 * `KanbanController.validQueryParams`, re-typed from
 * app/coffee/modules/kanban/main.coffee:59-70 rather than imported, so the two
 * lists are compared instead of being one list looked at twice.
 */
const INCUMBENT_VALID_QUERY_PARAMS: readonly string[] = [
    'exclude_tags',
    'tags',
    'exclude_assigned_users',
    'assigned_users',
    'exclude_role',
    'role',
    'exclude_epic',
    'epic',
    'exclude_owner',
    'owner',
];

const PROJECT_ID = 42;

/* ==========================================================================
 * THE BROWSERLESS ENVIRONMENT
 *
 * jsdom implements neither observer API, and this hook instantiates neither: it
 * performs no measurement and mounts no element. The stubs are installed anyway,
 * for two reasons that outlive the current implementation.
 *
 *   1. The board's virtualisation seam (`../../shared/useInViewport`) is an
 *      `IntersectionObserver` consumer, and the container that renders this hook
 *      renders that one. If a future edit moved an observer behind this data seam,
 *      the failure without a stub is `IntersectionObserver is not defined` thrown
 *      from inside a React render — which names the environment rather than the
 *      regression.
 *   2. An absent global is a LEAK RISK IN REVERSE: a spec that installed one and
 *      forgot to remove it would hand the next file in the same worker a global the
 *      browser would not have. Installing and removing per test keeps this file's
 *      environmental footprint exactly zero, which is what makes the suite's file
 *      order irrelevant.
 *
 * Both are structural implementations of the DOM interfaces rather than casts, so
 * a signature change in the lib types is a compile error here.
 * ========================================================================== */

class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '0px';

    readonly thresholds: readonly number[] = [0];

    constructor(_callback: IntersectionObserverCallback, _init?: IntersectionObserverInit) {}

    observe(): void {}

    unobserve(): void {}

    disconnect(): void {}

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

class ResizeObserverStub implements ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}

    observe(): void {}

    unobserve(): void {}

    disconnect(): void {}
}

/**
 * Whatever the environment provided before this file ran, captured once at module
 * scope so the restore is to the ORIGINAL value rather than to a guess. `undefined`
 * is the expected reading under jsdom, and it is why the teardown deletes rather
 * than assigns in that case — assigning `undefined` would leave a defined global
 * holding nothing, which is a third state neither jsdom nor a browser has.
 */
const nativeIntersectionObserver: typeof IntersectionObserver | undefined =
    globalThis.IntersectionObserver;

const nativeResizeObserver: typeof ResizeObserver | undefined = globalThis.ResizeObserver;

beforeEach(() => {
    globalThis.IntersectionObserver = IntersectionObserverStub;
    globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
    if (nativeIntersectionObserver === undefined) {
        // `Reflect.deleteProperty` rather than `delete`, because the lib declares the
        // global as required and a non-optional operand is a compile error.
        Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    } else {
        globalThis.IntersectionObserver = nativeIntersectionObserver;
    }

    if (nativeResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } else {
        globalThis.ResizeObserver = nativeResizeObserver;
    }
});

/* ==========================================================================
 * DOUBLES
 * ========================================================================== */

/** A `$q` promise that fulfils, invoked the way `$q` invokes its callbacks. */
function angularPromiseOf<T>(value: T): AngularPromise<T> {
    return {
        then(onFulfilled: (resolved: T) => unknown, _onRejected: (reason: unknown) => unknown) {
            return onFulfilled(value);
        },
    };
}

/** A `$q` promise that rejects with `reason`, passed through untouched. */
function angularRejectionOf<T>(reason: unknown): AngularPromise<T> {
    return {
        then(_onFulfilled: (resolved: T) => unknown, onRejected: (rejected: unknown) => unknown) {
            return onRejected(reason);
        },
    };
}

type GetAttrsMock<TAttrs> = jest.Mock<TAttrs, []>;

interface ModelDouble<TAttrs> {
    readonly model: TaigaModel<TAttrs>;
    readonly getAttrs: GetAttrsMock<TAttrs>;
    readonly attrs: TAttrs;
}

/**
 * A live-model stand-in whose ONLY own ENUMERABLE members are its methods, and
 * whose attributes are NON-ENUMERABLE ACCESSORS.
 *
 * ⭐ THE SHAPE IS THE ASSERTION. `$tgModel` installs one accessor pair per
 * attribute with `Object.defineProperty` (app/coffee/modules/base/model.coffee:
 * 67-101), and a property defined that way is non-enumerable by default — so
 * `{...model}` on a real model yields the prototype-free husk of whatever WAS
 * enumerable and NONE of the data. Reproducing that here is what makes every
 * "flattens" expectation below fail for a spread implementation instead of passing
 * by accident: a spread produces an object of functions, `model.id` still reads
 * correctly (so nothing looks broken while writing the code), and only the
 * assertions catch it.
 *
 * `getAttrs` hands back a FRESH shallow copy, exactly as `_.extend({}, @._attrs,
 * @._modifiedAttrs)` does at `:48-54`.
 */
function modelDoubleOf<TAttrs extends object>(
    name: string,
    attrs: TAttrs,
): ModelDouble<TAttrs> {
    const getAttrs: GetAttrsMock<TAttrs> = jest.fn(() => ({ ...attrs }));

    const model: TaigaModel<TAttrs> = {
        getAttrs,
        setAttr: jest.fn(),
        isModified: jest.fn(() => false),
        getName: jest.fn(() => name),
        clone: jest.fn(() => model),
    };

    for (const attribute of Object.keys(attrs)) {
        // `Reflect.get` rather than an index read, because the attribute shape is a
        // type parameter and has no index signature to read through.
        const value: unknown = Reflect.get(attrs, attribute);

        Object.defineProperty(model, attribute, {
            get: (): unknown => value,
            enumerable: false,
            configurable: true,
        });
    }

    return { model, getAttrs, attrs };
}

/**
 * Every reason a value would be unfit for React state or an immer draft, as a list
 * of located findings rather than a boolean.
 *
 * ⛔ WHAT THIS CLOSES, AND WHY A `toEqual` ON THE HAPPY PATH DOES NOT. Jest's
 * structural matchers compare the members they find: a live `$tgModel` whose
 * attributes are non-enumerable accessors, an AngularJS `$q` promise, a callback
 * left on a payload, a detached DOM node — every one of those can sit inside a value
 * that still satisfies `toEqual` against the attributes it wraps. Each is also a
 * concrete hazard rather than an aesthetic one: immer refuses to draft a class
 * instance (pitfall P-IMMER-1), `autoFreeze` would freeze a structure AngularJS
 * still holds (P-IMMER-4), and a thenable in a state slot makes every property read
 * on it `undefined`.
 *
 * The walk is recursive, reports the PATH of each finding so a failure names the
 * member rather than the object, and treats only `Object.prototype`,
 * `Array.prototype` and a null prototype as plain — which is exactly the set immer
 * drafts.
 *
 * @param value - the value the hook handed back.
 * @param path - the location of `value` within the original result, for the message.
 * @returns one description per finding; an empty array means the value is plain.
 */
function nonPlainDataFindings(value: unknown, path: string = 'result'): readonly string[] {
    if (value === null || typeof value !== 'object') {
        return typeof value === 'function' ? [`${path} is a function`] : [];
    }

    if (value instanceof Promise) {
        return [`${path} is a native promise`];
    }

    const then: unknown = Reflect.get(value, 'then');

    if (typeof then === 'function') {
        return [`${path} is a thenable, e.g. an AngularJS $q promise`];
    }

    if (value instanceof Node) {
        return [`${path} is a DOM node`];
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    if (
        prototype !== Object.prototype &&
        prototype !== Array.prototype &&
        prototype !== null
    ) {
        return [`${path} has a non-plain prototype, e.g. a $tgModel or a persistent structure`];
    }

    if (Array.isArray(value)) {
        return value.flatMap((entry: unknown, index: number) =>
            nonPlainDataFindings(entry, `${path}[${index}]`),
        );
    }

    return Object.keys(value).flatMap((key) =>
        nonPlainDataFindings(Reflect.get(value, key), `${path}.${key}`),
    );
}

type StoryAttrs = Pick<UserStory, 'id' | 'ref' | 'subject' | 'status' | 'version'> & {
    readonly swimlane: number | null;
};

function storyModelOf(id: number, subject: string, version: number): ModelDouble<StoryAttrs> {
    return modelDoubleOf<StoryAttrs>('userstories', {
        id,
        ref: id + 100,
        subject,
        status: 1,
        swimlane: null,
        version,
    });
}

interface SwimlaneAttrsDouble {
    readonly id: number;
    readonly name: string;
}

function swimlaneModelOf(id: number, name: string): ModelDouble<SwimlaneAttrsDouble> {
    return modelDoubleOf<SwimlaneAttrsDouble>('swimlanes', { id, name });
}

type TagsColorsAttrs = Readonly<Record<string, string | null>>;

/**
 * A response-headers getter, in the overloaded form the bridge declares.
 *
 * Written as a function declaration with both signatures because
 * `HttpHeadersGetter` is genuinely overloaded — no-argument yields the whole map,
 * one argument yields a single value or nothing — and a single arrow returning the
 * union satisfies neither signature on its own.
 */
function headersGetterOf(headers: Record<string, string>): HttpHeadersGetter {
    function getter(): Record<string, string>;
    function getter(name: string): string | null;
    function getter(name?: string): Record<string, string> | string | null {
        if (name === undefined) {
            return headers;
        }

        return headers[name] ?? null;
    }

    return getter;
}

/** One HTTP response envelope, as the repository's raw write path resolves it. */
function httpResponseOf<TData>(data: TData): AngularHttpResponse<TData> {
    return { data, status: 200, headers: headersGetterOf({}) };
}

/**
 * A double for one of the resource layer's GENERIC transport members.
 *
 * ⭐ WHY THESE ARE NOT NARROWLY TYPED, and why that is sound rather than lazy.
 * Every transport member of `$tgResources` is generic over the shape it hands back
 * — `listAll<TAttrs>`, `filtersData<TFilters>`, `bulkUpdateKanbanOrder<TResult>` —
 * so NO concrete function can satisfy one: a mock resolving a story model is not a
 * mock resolving `TAttrs` for an arbitrary `TAttrs`. The narrow structural views
 * the facades declare exist precisely so a spec CAN hand them a concrete double,
 * but this spec supplies the whole live namespace through the injector instead,
 * because that is what the hook resolves. Arguments are therefore read back through
 * {@link callArgsOf}, which hands them over as `unknown` and keeps every assertion
 * below type-checked.
 */
type TransportMock = jest.Mock;

type FoldModesReadMock = jest.Mock<ResourceParams, [number]>;

type FoldModesWriteMock = jest.Mock<void, [number, ResourceParams]>;

/**
 * Anything that records its calls: a plain `jest.fn` double or a `jest.spyOn` spy.
 *
 * Declared structurally because the two are unrelated types — `jest.Mock` is
 * callable, `jest.SpyInstance` is not — and every reader below needs only the
 * recorded argument lists.
 */
interface CallRecorder {
    readonly mock: { readonly calls: readonly (readonly unknown[])[] };
}

/** The recorded arguments of one call, narrowed from jest's untyped record. */
function callArgsOf(recorder: CallRecorder, callIndex: number = 0): readonly unknown[] {
    return recorder.mock.calls[callIndex] ?? [];
}

/** Anything that records what its calls returned. Structural, for the same reason. */
interface ResultRecorder {
    readonly mock: { readonly results: readonly { readonly value: unknown }[] };
}

/** What one recorded call returned, as `unknown` so every assertion stays checked. */
function callResultOf(recorder: ResultRecorder, callIndex: number = 0): unknown {
    return recorder.mock.results[callIndex]?.value;
}

interface ResourcesDouble {
    readonly service: TaigaResources;
    readonly listAll: TransportMock;
    readonly getByRef: TransportMock;
    readonly filtersData: TransportMock;
    readonly bulkUpdateKanbanOrder: TransportMock;
    readonly listValues: TransportMock;
    readonly swimlanesList: TransportMock;
    readonly tagsColors: TransportMock;
    readonly getStatusColumnModes: FoldModesReadMock;
    readonly storeStatusColumnModes: FoldModesWriteMock;
    readonly getSwimlanesModes: FoldModesReadMock;
    readonly storeSwimlanesModes: FoldModesWriteMock;
}

/**
 * Every member of the frozen namespace, so a call to an unexercised member would
 * be visible rather than crashing on `undefined`. The two storage-backed readers
 * default the way the incumbent does — `{}` at
 * app/coffee/modules/resources/kanban.coffee:27 and :37.
 */
function resourcesDouble(): ResourcesDouble {
    const listAll: TransportMock = jest.fn(() =>
        angularPromiseOf<ReadonlyArray<TaigaModel<StoryAttrs>>>([]),
    );
    const getByRef: TransportMock = jest.fn(() =>
        angularPromiseOf(storyModelOf(1, 'unused', 1).model),
    );
    const filtersData: TransportMock = jest.fn(() => angularPromiseOf<unknown>({}));
    const bulkUpdateKanbanOrder: TransportMock = jest.fn(() =>
        angularPromiseOf<AngularHttpResponse<unknown>>(httpResponseOf<unknown>([])),
    );
    const listValues: TransportMock = jest.fn();
    const swimlanesList: TransportMock = jest.fn(() =>
        angularPromiseOf<ReadonlyArray<TaigaModel<SwimlaneAttrsDouble>>>([]),
    );
    const tagsColors: TransportMock = jest.fn(() =>
        angularPromiseOf(modelDoubleOf<TagsColorsAttrs>('projects', {}).model),
    );
    const getStatusColumnModes: FoldModesReadMock = jest.fn(
        (_projectId: number): ResourceParams => ({}),
    );
    const storeStatusColumnModes: FoldModesWriteMock = jest.fn();
    const getSwimlanesModes: FoldModesReadMock = jest.fn(
        (_projectId: number): ResourceParams => ({}),
    );
    const storeSwimlanesModes: FoldModesWriteMock = jest.fn();

    const service: TaigaResources = {
        userstories: {
            get: jest.fn(),
            getByRef,
            listAll,
            listUnassigned: jest.fn(),
            filtersData,
            bulkCreate: jest.fn(),
            bulkUpdateBacklogOrder: jest.fn(),
            bulkUpdateKanbanOrder,
            bulkUpdateMilestone: jest.fn(),
            listValues,
            storeQueryParams: jest.fn(),
            getQueryParams: jest.fn(() => ({})),
            storeBacklog: jest.fn(),
            getBacklog: jest.fn(() => []),
            storeShowTags: jest.fn(),
            getShowTags: jest.fn(() => null),
        },
        sprints: {
            get: jest.fn(),
            stats: jest.fn(),
            list: jest.fn(),
            moveUserStoriesMilestone: jest.fn(),
        },
        swimlanes: { list: swimlanesList },
        kanban: {
            storeStatusColumnModes,
            getStatusColumnModes,
            storeSwimlanesModes,
            getSwimlanesModes,
        },
        projects: { stats: jest.fn(), tagsColors },
    };

    return {
        service,
        listAll,
        getByRef,
        filtersData,
        bulkUpdateKanbanOrder,
        listValues,
        swimlanesList,
        tagsColors,
        getStatusColumnModes,
        storeStatusColumnModes,
        getSwimlanesModes,
        storeSwimlanesModes,
    };
}

interface ProjectServiceDouble {
    readonly service: ProjectService;
    readonly toJS: jest.Mock<Record<string, unknown>, []>;
    readonly get: jest.Mock;
    readonly fetchProject: jest.Mock<AngularPromise<void> | undefined, []>;
}

function projectServiceDouble(options: {
    readonly payload?: Record<string, unknown> | null;
    readonly fetchResult?: AngularPromise<void> | undefined;
}): ProjectServiceDouble {
    const payload = options.payload === undefined ? {} : options.payload;

    const toJS: jest.Mock<Record<string, unknown>, []> = jest.fn(() => payload ?? {});
    const get = jest.fn();
    const fetchProject: jest.Mock<AngularPromise<void> | undefined, []> = jest.fn(
        () => options.fetchResult,
    );

    const structure: PersistentStructure = { get, toJS };

    const service: ProjectService = {
        project: payload === null ? null : structure,
        fetchProject,
        hasPermission: jest.fn(() => true),
        canEdit: jest.fn(() => true),
    };

    return { service, toJS, get, fetchProject };
}

interface ErrorHandlingDouble {
    readonly service: ErrorHandlingService;
    readonly permissionDenied: jest.Mock<void, []>;
}

function errorHandlingDouble(): ErrorHandlingDouble {
    const permissionDenied: jest.Mock<void, []> = jest.fn();

    return { service: { permissionDenied }, permissionDenied };
}

interface Harness {
    readonly api: KanbanDataApi;
    readonly resources: ResourcesDouble;
    readonly projectService: ProjectServiceDouble;

    /** Every service name the hook asked the injector for, in call order. */
    readonly resolvedNames: readonly string[];

    readonly errorHandling: ErrorHandlingDouble;
    readonly rerender: () => void;
    readonly currentApi: () => KanbanDataApi;
}

/**
 * Mounts the hook with the three services it is allowed to resolve AND NOTHING
 * ELSE. `mockInjector` throws for an unsupplied name, so a fourth resolution — a
 * scope, the promise service, a raw transport, `tgResources` — would fail every spec
 * in this file.
 *
 * The injector is `mockInjector`'s, reached through a recording `get` that keeps the
 * generic signature the bridge declares. A `jest.fn` cannot inhabit `<T>(name:
 * string) => T` without a cast, and a cast in the harness would be the one place a
 * spec could quietly stop describing the real contract — so the recorder is an
 * ordinary generic method that appends the name and delegates.
 */
function renderKanbanData(options: {
    readonly payload?: Record<string, unknown> | null;
    readonly fetchResult?: AngularPromise<void> | undefined;
} = {}): Harness {
    const resources = resourcesDouble();
    const projectService = projectServiceDouble(options);
    const errorHandling = errorHandlingDouble();
    const resolvedNames: string[] = [];

    const supplied = mockInjector({
        $tgResources: resources.service,
        tgProjectService: projectService.service,
        tgErrorHandlingService: errorHandling.service,
    });

    const injector: AngularInjector = {
        get<TService>(name: string): TService {
            resolvedNames.push(name);

            return supplied.get<TService>(name);
        },
    };

    const rendered = renderHook(() => useKanbanData(), {
        wrapper: withMockInjector(injector),
    });

    return {
        api: rendered.result.current,
        resources,
        projectService,
        resolvedNames,
        errorHandling,
        rerender: () => rendered.rerender(),
        currentApi: () => rendered.result.current,
    };
}

/* ==========================================================================
 * FACADE SPIES
 *
 * ⭐ WHY SPY ON THE FACADES AT ALL, when the resource doubles already record every
 * request. Because ONE routing mistake is invisible at the resource layer: handing a
 * facade the WRONG SUB-RESOURCE. `$tgResources.userstories`, `.swimlanes`,
 * `.projects` and `.kanban` are four distinct objects behind one bag, and each facade
 * takes its own as an argument.
 *
 * Passing an outright sibling — `listSwimlanes(resources.userstories, …)` — is a
 * compile error, because the member sets differ. What the compiler CANNOT see is a
 * value that satisfies the same structural view without BEING the live namespace: a
 * spread, a clone, a re-wrapped bag or a memoised copy. Every one of those type-checks
 * and every one of them silently detaches the resource from the state the AngularJS
 * layer keeps on it. Spying on the facade is the only place the IDENTITY of that first
 * argument is observable.
 *
 * It is also the only place the frozen order write's argument COUNT is observable:
 * the endpoint takes six values, the facade takes seven because the service comes
 * first, and four of those values are consecutive numbers that transpose silently.
 *
 * `jest.spyOn` PASSES THROUGH to the real implementation by default, so every
 * behavioural expectation in this file still exercises the genuine facade rather
 * than a stand-in, and `restoreMocks` in jest.config.js removes each spy after its
 * test with no hand-written teardown.
 * ========================================================================== */

function spyOnFacades(): {
    readonly listAllUserstories: jest.SpyInstance;
    readonly getUserStoryByRef: jest.SpyInstance;
    readonly getUserstoriesFiltersData: jest.SpyInstance;
    readonly bulkUpdateKanbanOrder: jest.SpyInstance;
    readonly listSwimlanes: jest.SpyInstance;
    readonly getProjectTagsColors: jest.SpyInstance;
    readonly getStatusColumnModes: jest.SpyInstance;
    readonly storeStatusColumnModes: jest.SpyInstance;
    readonly getSwimlanesModes: jest.SpyInstance;
    readonly storeSwimlanesModes: jest.SpyInstance;
} {
    return {
        listAllUserstories: jest.spyOn(userstoriesApi, 'listAllUserstories'),
        getUserStoryByRef: jest.spyOn(userstoriesApi, 'getUserStoryByRef'),
        getUserstoriesFiltersData: jest.spyOn(userstoriesApi, 'getUserstoriesFiltersData'),
        bulkUpdateKanbanOrder: jest.spyOn(userstoriesApi, 'bulkUpdateKanbanOrder'),
        listSwimlanes: jest.spyOn(swimlanesApi, 'listSwimlanes'),
        getProjectTagsColors: jest.spyOn(projectsApi, 'getProjectTagsColors'),
        getStatusColumnModes: jest.spyOn(kanbanStorageApi, 'getStatusColumnModes'),
        storeStatusColumnModes: jest.spyOn(kanbanStorageApi, 'storeStatusColumnModes'),
        getSwimlanesModes: jest.spyOn(kanbanStorageApi, 'getSwimlanesModes'),
        storeSwimlanesModes: jest.spyOn(kanbanStorageApi, 'storeSwimlanesModes'),
    };
}

/** The first argument of one facade call: the sub-resource it was handed. */
function facadeServiceOf(spy: CallRecorder): unknown {
    return callArgsOf(spy)[0];
}

/** A project payload with both taxonomies, as the serializer sends them. */
function projectPayload(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        id: PROJECT_ID,
        is_kanban_activated: true,
        points: [
            { id: 3, name: '1', value: 1, order: 20 },
            { id: 2, name: '?', value: null, order: 10 },
        ],
        us_statuses: [
            {
                id: 7,
                name: 'DONE',
                color: '#A8E440',
                wip_limit: null,
                is_archived: false,
                order: 50,
            },
            { id: 5, name: 'NEW', color: '#70728F', wip_limit: 4, is_archived: false, order: 10 },
        ],
        ...overrides,
    };
}

/* ==========================================================================
 * THE UNIT'S SOURCE, FOR THE STATIC GATES
 * ========================================================================== */

const UNIT_FILENAME = 'useKanbanData.ts';

const UNIT_SOURCE = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

/**
 * The unit with comments removed, so prose can neither satisfy nor violate a gate.
 * The `[^:]` guard keeps a `//` inside a URL from being treated as a line comment.
 */
function executableCodeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const UNIT_CODE = executableCodeOf(UNIT_SOURCE);

function importSpecifiersOf(source: string): readonly string[] {
    const withBindings = Array.from(
        source.matchAll(/^[ \t]*import\s[\s\S]*?from\s+'([^']+)';/gm),
        (match) => match[1],
    );
    const sideEffectOnly = Array.from(
        source.matchAll(/^[ \t]*import\s+'([^']+)';/gm),
        (match) => match[1],
    );

    return Array.from(new Set([...withBindings, ...sideEffectOnly])).sort();
}

interface Prohibition {
    readonly description: string;
    readonly needle: string;
}

/**
 * Needles are assembled from fragments so this spec's own source cannot be
 * mistaken for the unit's, and so a grep for the literal finds the unit rather
 * than the list.
 */
const UNIT_PROHIBITIONS: readonly Prohibition[] = [
    { description: 'the modern network API', needle: `${'fet'}${'ch'}(` },
    { description: 'the legacy request object', needle: `${'XML'}${'HttpRequest'}` },
    { description: 'a third-party HTTP client', needle: `${'axi'}${'os'}` },
    { description: 'the framework HTTP service', needle: `${'$h'}${'ttp'}` },
    { description: 'a socket', needle: `${'Web'}${'Socket'}` },
    { description: 'a multipart body', needle: `${'Form'}${'Data'}` },
    { description: 'a digest kick', needle: `${'$ap'}${'ply'}` },
    { description: 'an async digest kick', needle: `${'$appl'}${'yAsync'}` },
    { description: 'a digest', needle: `${'$di'}${'gest'}` },
    { description: 'a framework scope', needle: `${'$sc'}${'ope'}` },
    { description: 'the framework root scope', needle: `${'$root'}${'Scope'}` },
    { description: 'the framework promise service', needle: `${'$q'}${'.'}` },
    { description: 'the injector', needle: `${'$inje'}${'ctor'}` },
    {
        description: 'the unauthorised project-values read',
        needle: `${'listUserstory'}${'Values'}`,
    },
    { description: 'the administration status write', needle: `${'edit'}${'Status'}` },
    { description: 'the legacy structural collection', needle: `${'Immu'}${'table'}` },
    { description: 'a persistent-structure deep read', needle: `${'get'}${'In'}(` },
    { description: 'a persistent-collection length', needle: `${'.si'}${'ze'}` },
    { description: 'the untyped escape hatch', needle: `${'as a'}${'ny'}` },
    { description: 'a compiler suppression', needle: `${'@ts-'}${'ignore'}` },
    { description: 'a compiler expectation', needle: `${'@ts-'}${'expect-error'}` },
    { description: 'a whole-file suppression', needle: `${'@ts-'}${'nocheck'}` },
    { description: 'a lint suppression', needle: `${'eslint-'}${'disable'}` },
    { description: 'a legacy asset import', needle: `${'app/'}${'js/'}` },
    { description: 'a CommonJS escape hatch', needle: `${'requi'}${'re('}` },
    { description: 'a browser local-storage write', needle: `${'local'}${'Storage'}` },
    { description: 'a deferred marker', needle: `${'TO'}${'DO'}` },
    { description: 'a defect marker', needle: `${'FIX'}${'ME'}` },
    { description: 'a synchronous read wrapped in a promise', needle: `${'Promise.'}${'resolve'}` },
    { description: 'a default React import', needle: `${'import Rea'}${'ct from'}` },
    { description: 'the AngularJS global', needle: `${'angu'}${'lar.'}` },
    { description: 'an AngularJS import', needle: `${'from \''}${'angular'}` },
    { description: 'the jQuery global', needle: `${'jQ'}${'uery'}` },
    { description: 'a jQuery import', needle: `${'from \''}${'jquery'}` },
    { description: 'a disabled immer freeze', needle: `${'setAuto'}${'Freeze'}` },
    { description: 'a legacy board script', needle: `${'boards'}${'.js'}` },
    { description: 'a direct DOM write', needle: `${'document.'}${'querySelector'}` },
];

/* ==========================================================================
 * SERVICE ACQUISITION
 * ========================================================================== */

describe('service acquisition', () => {
    it('resolves the resource bag, the project service and the error service only', () => {
        // Rendering at all is the assertion: `mockInjector` throws for any name it
        // was not given, so a fourth resolution fails here.
        expect(() => renderKanbanData()).not.toThrow();
    });

    it('resolves the resource bag exactly once per hook instance, and nothing else', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        // The RUN-TIME half of the single-resolution rule. The injector records every
        // name the hook asked for, so "exactly once" is counted rather than inferred.
        expect(harness.resolvedNames).toEqual([
            '$tgResources',
            'tgProjectService',
            'tgErrorHandlingService',
        ]);
        expect(
            harness.resolvedNames.filter((name) => name === '$tgResources'),
        ).toHaveLength(1);
    });

    it('resolves three DISTINCT services, so the project and error services are not the bag', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        expect(new Set(harness.resolvedNames).size).toBe(3);

        // Distinct names AND distinct objects: the gate reads the project off one
        // service and reports denial through another, and conflating them would make
        // the deactivated-project path unobservable.
        expect(harness.projectService.service).not.toBe(harness.errorHandling.service);
        expect(harness.projectService.service).not.toBe(harness.resources.service);
    });

    it('resolves each service once more on a re-render, and never twice in one render', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        harness.rerender();

        // `useAngularService` reads the injector on every render by design, so the
        // invariant is one resolution PER NAME PER RENDER — never a second bag lookup
        // inside a single render, which is what a stray duplicate hook call would add.
        expect(harness.resolvedNames.filter((name) => name === '$tgResources')).toHaveLength(
            2,
        );
        expect(harness.resolvedNames).toHaveLength(6);
    });

    it('resolves the dollar-prefixed resource service exactly once in the source, too', () => {
        // Quote-agnostic on purpose: single, double and template quoting all reach the
        // same service, so the gate must not be evaded by a formatting change.
        const resolutions = Array.from(
            UNIT_CODE.matchAll(/useAngularService\(\s*['"`]([^'"`]+)['"`]\s*\)/g),
            (match) => match[1],
        );

        expect(resolutions).toEqual([
            '$tgResources',
            'tgProjectService',
            'tgErrorHandlingService',
        ]);
        expect(resolutions.filter((name) => name === '$tgResources')).toHaveLength(1);
    });

    it('never resolves the attachments resource service, which is a different service', () => {
        // `'$tgResources'` does not contain `'tgResources'` as a quoted substring, so
        // this gate is exact rather than incidental.
        expect(UNIT_CODE).not.toContain(`${"'tgReso"}${"urces'"}`);
    });

    it('hands every facade the exact sub-resource it takes, never a sibling', async () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData({ payload: projectPayload() });
        const { userstories, swimlanes, projects, kanban } = harness.resources.service;

        await harness.api.listUserstories(PROJECT_ID);
        await harness.api.getUserstoryByRef(PROJECT_ID, 137);
        await harness.api.loadFiltersData({ project: PROJECT_ID });
        await harness.api.listSwimlanes(PROJECT_ID);
        await harness.api.loadTagsColors(PROJECT_ID);
        harness.api.getStatusColumnModes(PROJECT_ID);
        harness.api.getSwimlanesModes(PROJECT_ID);
        harness.api.storeStatusColumnModes(PROJECT_ID, {});
        harness.api.storeSwimlanesModes(PROJECT_ID, {});

        // IDENTITY, member by member. Four sibling objects live behind one bag, and
        // handing a facade the wrong one is the single routing mistake no assertion on
        // the request itself can see.
        expect(facadeServiceOf(facades.listAllUserstories)).toBe(userstories);
        expect(facadeServiceOf(facades.getUserStoryByRef)).toBe(userstories);
        expect(facadeServiceOf(facades.getUserstoriesFiltersData)).toBe(userstories);
        expect(facadeServiceOf(facades.listSwimlanes)).toBe(swimlanes);
        expect(facadeServiceOf(facades.getProjectTagsColors)).toBe(projects);
        expect(facadeServiceOf(facades.getStatusColumnModes)).toBe(kanban);
        expect(facadeServiceOf(facades.getSwimlanesModes)).toBe(kanban);
        expect(facadeServiceOf(facades.storeStatusColumnModes)).toBe(kanban);
        expect(facadeServiceOf(facades.storeSwimlanesModes)).toBe(kanban);
    });

    it('invokes each resource member AS A MEMBER of its own sub-resource', async () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        await harness.api.listUserstories(PROJECT_ID);
        await harness.api.listSwimlanes(PROJECT_ID);
        await harness.api.loadTagsColors(PROJECT_ID);
        harness.api.getStatusColumnModes(PROJECT_ID);

        expect(harness.resources.listAll).toHaveBeenCalledTimes(1);
        expect(harness.resources.swimlanesList).toHaveBeenCalledTimes(1);
        expect(harness.resources.tagsColors).toHaveBeenCalledTimes(1);
        expect(harness.resources.getStatusColumnModes).toHaveBeenCalledTimes(1);

        // The receiver each member was called on, which is the second, independent
        // proof of the routing above: the AngularJS resource layer reads `@` off its
        // own namespace, so a member invoked detached would break at run time even
        // where the type checker was satisfied.
        expect(harness.resources.listAll.mock.contexts[0]).toBe(
            harness.resources.service.userstories,
        );
        expect(harness.resources.swimlanesList.mock.contexts[0]).toBe(
            harness.resources.service.swimlanes,
        );
        expect(harness.resources.tagsColors.mock.contexts[0]).toBe(
            harness.resources.service.projects,
        );
        expect(harness.resources.getStatusColumnModes.mock.contexts[0]).toBe(
            harness.resources.service.kanban,
        );
    });

    it('never calls the project-values endpoint, whose statuses are in the project', async () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        harness.api.loadProject();
        await harness.api.listUserstories(PROJECT_ID);

        expect(harness.resources.listValues).not.toHaveBeenCalled();
    });

    it('fails loudly, not silently, when a service it needs was not supplied', () => {
        // React logs a render-phase throw through `console.error`; silenced so the
        // expected failure does not read as a suite defect. `restoreMocks` in
        // jest.config.js restores the spy, so there is no hand-written teardown.
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const withoutErrorService = mockInjector({
            $tgResources: resourcesDouble().service,
            tgProjectService: projectServiceDouble({}).service,
        });

        const mount = (): unknown =>
            renderHook(() => useKanbanData(), {
                wrapper: withMockInjector(withoutErrorService),
            });

        // `mockInjector` NAMES the service and lists what was supplied instead of
        // answering `undefined` — an undefined service would surface much later as an
        // unreadable property-of-undefined failure with nothing pointing at the cause.
        expect(mount).toThrow(Error);
        expect(mount).toThrow(/tgErrorHandlingService/);
        expect(mount).toThrow(/supplied no mock for it/i);
    });
});

/* ==========================================================================
 * THE PROJECT ENTRY GATE
 * ========================================================================== */

describe('loadProject', () => {
    it('flattens the persistent project with toJS and never reads it key by key', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        harness.api.loadProject();

        expect(harness.projectService.toJS).toHaveBeenCalledTimes(1);
        expect(harness.projectService.get).not.toHaveBeenCalled();
    });

    it('does not deny permission for an activated project', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        const project = harness.api.loadProject();

        expect(harness.errorHandling.permissionDenied).not.toHaveBeenCalled();
        expect(project?.id).toBe(PROJECT_ID);
        expect(project?.is_kanban_activated).toBe(true);
    });

    it('denies permission for a deactivated project AND STILL returns its data', () => {
        const harness = renderKanbanData({
            payload: projectPayload({ is_kanban_activated: false }),
        });

        const project = harness.api.loadProject();

        expect(harness.errorHandling.permissionDenied).toHaveBeenCalledTimes(1);

        // THE ABSENT EARLY RETURN. The incumbent falls straight through the gate and
        // shapes the project anyway (main.coffee:567-576); the AngularJS error view
        // takes over from the flags the service raised.
        expect(project).not.toBeNull();
        expect(project?.is_kanban_activated).toBe(false);
        expect(project?.usStatusList.map((status) => status.id)).toEqual([5, 7]);
    });

    it('treats an absent activation flag as deactivated, by truthiness', () => {
        const payload = projectPayload();

        delete payload.is_kanban_activated;

        const harness = renderKanbanData({ payload });

        const project = harness.api.loadProject();

        expect(harness.errorHandling.permissionDenied).toHaveBeenCalledTimes(1);
        expect(project?.is_kanban_activated).toBe(false);
    });

    it('answers nothing, and denies nothing, while no project is loaded', () => {
        const harness = renderKanbanData({ payload: null });

        expect(harness.api.loadProject()).toBeNull();
        expect(harness.errorHandling.permissionDenied).not.toHaveBeenCalled();
    });

    it('answers nothing for a payload that cannot address an endpoint', () => {
        const withoutId = projectPayload();

        delete withoutId.id;

        expect(renderKanbanData({ payload: withoutId }).api.loadProject()).toBeNull();

        expect(
            renderKanbanData({ payload: projectPayload({ points: undefined }) })
                .api.loadProject(),
        ).toBeNull();

        expect(
            renderKanbanData({ payload: projectPayload({ us_statuses: null }) })
                .api.loadProject(),
        ).toBeNull();
    });

    it('runs the gate first, so a deactivated malformed project still denies', () => {
        const harness = renderKanbanData({
            payload: { is_kanban_activated: false },
        });

        expect(harness.api.loadProject()).toBeNull();
        expect(harness.errorHandling.permissionDenied).toHaveBeenCalledTimes(1);
    });

    it('sorts both taxonomies ascending by order', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        const project = harness.api.loadProject();

        expect(project?.points.map((point) => point.id)).toEqual([2, 3]);
        expect(project?.usStatusList.map((status) => status.id)).toEqual([5, 7]);
    });

    it('⛔ sorts by ORDER and not by id, which is the backlog key, not the board key', () => {
        // Every id here ASCENDS AS THE ORDER DESCENDS, so sorting by `id` and sorting by
        // `order` cannot agree. That separation is the whole point: the board's column
        // sequence is the administrator's configured `order`
        // (`_.sortBy(project.us_statuses, "order")`, main.coffee:576), while the
        // backlog's status list is keyed differently — and an implementation that
        // sorted by `id` would reorder every board column while still looking sorted.
        const harness = renderKanbanData({
            payload: projectPayload({
                us_statuses: [
                    { id: 11, name: 'NEW', order: 40 },
                    { id: 12, name: 'READY', order: 30 },
                    { id: 13, name: 'IN PROGRESS', order: 20 },
                    { id: 14, name: 'DONE', order: 10 },
                ],
                points: [
                    { id: 21, name: '?', value: null, order: 30 },
                    { id: 22, name: '1', value: 1, order: 20 },
                    { id: 23, name: '2', value: 2, order: 10 },
                ],
            }),
        });

        const project = harness.api.loadProject();

        expect(project?.usStatusList.map((status) => status.id)).toEqual([14, 13, 12, 11]);
        expect(project?.usStatusList.map((status) => status.order)).toEqual([10, 20, 30, 40]);
        expect(project?.points.map((point) => point.id)).toEqual([23, 22, 21]);
        expect(project?.points.map((point) => point.order)).toEqual([10, 20, 30]);
    });

    it('places an entry with no order last, as lodash orders undefined', () => {
        const harness = renderKanbanData({
            payload: projectPayload({
                us_statuses: [
                    { id: 1, order: 30 },
                    { id: 2 },
                    { id: 3, order: 10 },
                ],
            }),
        });

        expect(harness.api.loadProject()?.usStatusList.map((status) => status.id)).toEqual([
            3, 1, 2,
        ]);
    });

    it('keeps payload order among entries that share an order', () => {
        const harness = renderKanbanData({
            payload: projectPayload({
                points: [
                    { id: 9, order: 5 },
                    { id: 8, order: 5 },
                    { id: 7, order: 1 },
                ],
            }),
        });

        expect(harness.api.loadProject()?.points.map((point) => point.id)).toEqual([7, 9, 8]);
    });

    it('sorts COPIES and leaves the payload arrays untouched', () => {
        const statuses = [
            { id: 7, order: 50 },
            { id: 5, order: 10 },
        ];
        const points = [
            { id: 3, order: 20 },
            { id: 2, order: 10 },
        ];

        const harness = renderKanbanData({
            payload: projectPayload({ us_statuses: statuses, points }),
        });

        const project = harness.api.loadProject();

        expect(statuses.map((status) => status.id)).toEqual([7, 5]);
        expect(points.map((point) => point.id)).toEqual([3, 2]);
        expect(project?.usStatusList).not.toBe(statuses);
        expect(project?.points).not.toBe(points);
    });

    it('is synchronous, because the project is already resolved', () => {
        const project = renderKanbanData({ payload: projectPayload() }).api.loadProject();

        expect(project).not.toBeInstanceOf(Promise);
        expect(project?.id).toBe(PROJECT_ID);
    });
});

/* ==========================================================================
 * READS
 * ========================================================================== */

describe('listUserstories', () => {
    it('asks for non-archived stories and forwards the search term unconditionally', async () => {
        const harness = renderKanbanData();

        await harness.api.listUserstories(PROJECT_ID);

        expect(harness.resources.listAll).toHaveBeenCalledWith(PROJECT_ID, {
            status__is_archived: false,
            q: undefined,
        });
    });

    it('asks for attachments and tasks from the extra-data zoom level upwards', async () => {
        const harness = renderKanbanData();

        await harness.api.listUserstories(PROJECT_ID, {
            zoomLevel: KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA,
        });

        expect(harness.resources.listAll).toHaveBeenCalledWith(PROJECT_ID, {
            status__is_archived: false,
            include_attachments: 1,
            include_tasks: 1,
            q: undefined,
        });
    });

    it('asks for neither below that zoom level', async () => {
        const harness = renderKanbanData();

        await harness.api.listUserstories(PROJECT_ID, {
            zoomLevel: KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA - 1,
        });

        const params = callArgsOf(harness.resources.listAll)[1] ?? {};

        expect(params).not.toHaveProperty('include_attachments');
        expect(params).not.toHaveProperty('include_tasks');
    });

    it('forwards only whitelisted query values and drops everything else', async () => {
        const harness = renderKanbanData();

        await harness.api.listUserstories(PROJECT_ID, {
            filterQ: 'doomline',
            queryParams: {
                tags: '3,4',
                exclude_owner: '9',
                // Never forwarded: the board excludes the status filter from its main
                // list (main.coffee:27-29), and a status here would empty four columns.
                status: '5',
                page: '2',
                // `_.merge` ignores an undefined source value, so neither does this.
                role: undefined,
            },
        });

        expect(harness.resources.listAll).toHaveBeenCalledWith(PROJECT_ID, {
            status__is_archived: false,
            tags: '3,4',
            exclude_owner: '9',
            q: 'doomline',
        });
    });

    it('lets the search term win over a q that arrived in the URL snapshot', async () => {
        const harness = renderKanbanData();

        await harness.api.listUserstories(PROJECT_ID, {
            filterQ: 'typed',
            queryParams: { q: 'stale' },
        });

        expect(callArgsOf(harness.resources.listAll)[1]).toMatchObject({ q: 'typed' });
    });

    it('pins the whitelist to the incumbent list', () => {
        expect([...KANBAN_VALID_QUERY_PARAMS]).toEqual(INCUMBENT_VALID_QUERY_PARAMS);
    });

    it('flattens every model and preserves the concurrency version', async () => {
        const harness = renderKanbanData();
        const first = storyModelOf(11, 'Fold the DONE column', 4);
        const second = storyModelOf(12, 'Reorder the sprint', 9);
        const models = [first.model, second.model];

        harness.resources.listAll.mockReturnValue(angularPromiseOf(models));

        const stories = await harness.api.listUserstories(PROJECT_ID);

        expect(first.getAttrs).toHaveBeenCalledTimes(1);
        expect(second.getAttrs).toHaveBeenCalledTimes(1);
        expect(stories).toEqual([first.attrs, second.attrs]);
        expect(stories.map((story) => story.version)).toEqual([4, 9]);
        expect(stories).not.toBe(models);
        expect(stories[0]).not.toBe(first.model);
    });

    it('returns a FRESH plain array carrying none of the model surface', async () => {
        const harness = renderKanbanData();
        const story = storyModelOf(13, 'Expand the archived column', 2);

        harness.resources.listAll.mockReturnValue(angularPromiseOf([story.model]));

        const stories = await harness.api.listUserstories(PROJECT_ID);

        // `version` is REQUIRED downstream: it is the optimistic-concurrency token the
        // changed-fields-only PATCH carries (base/model.coffee:48-54), so losing it in
        // the crossing turns a rejected conflict into a silent overwrite.
        expect(stories[0].version).toBe(2);

        for (const member of ['getAttrs', 'setAttr', 'isModified', 'getName', 'clone']) {
            expect(stories[0]).not.toHaveProperty(member);
        }

        expect(nonPlainDataFindings(stories)).toEqual([]);
    });

    it('⛔ would not have been served by a spread, which is why getAttrs is called', async () => {
        const harness = renderKanbanData();
        const story = storyModelOf(14, 'Collapse the swimlane', 1);

        harness.resources.listAll.mockReturnValue(angularPromiseOf([story.model]));

        const stories = await harness.api.listUserstories(PROJECT_ID);

        // The model's attributes are NON-ENUMERABLE ACCESSORS, exactly as
        // `Object.defineProperty` installs them at base/model.coffee:67-101 — so a
        // spread yields the methods and NONE of the data while `model.id` goes on
        // reading correctly. This is the difference `getAttrs()` makes, asserted rather
        // than described.
        expect({ ...story.model }).not.toHaveProperty('id');
        expect({ ...story.model }).toHaveProperty('getAttrs');
        expect(stories[0]).toHaveProperty('id', 14);
        expect(stories[0]).toEqual(story.attrs);
    });

    it('expects a bare array, never a data envelope or a pagination tuple', async () => {
        const harness = renderKanbanData();

        harness.resources.listAll.mockReturnValue(angularPromiseOf([]));

        await expect(harness.api.listUserstories(PROJECT_ID)).resolves.toEqual([]);
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = { status: 400, data: { version: ['conflict'] } };

        harness.resources.listAll.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.listUserstories(PROJECT_ID)).rejects.toBe(reason);
    });
});

describe('getUserstoryByRef', () => {
    it('forwards the project, the reference and an empty extra bag by default', async () => {
        const harness = renderKanbanData();

        await harness.api.getUserstoryByRef(PROJECT_ID, 137);

        expect(harness.resources.getByRef).toHaveBeenCalledWith(PROJECT_ID, 137, {});
    });

    it('forwards supplied extra parameters untouched', async () => {
        const harness = renderKanbanData();
        const extra: ResourceParams = { include_attachments: 1 };

        await harness.api.getUserstoryByRef(PROJECT_ID, 137, extra);

        expect(harness.resources.getByRef).toHaveBeenCalledWith(PROJECT_ID, 137, extra);
    });

    it('flattens the resolved model', async () => {
        const harness = renderKanbanData();
        const story = storyModelOf(21, 'Squish the archived column', 3);

        harness.resources.getByRef.mockReturnValue(angularPromiseOf(story.model));

        const resolved = await harness.api.getUserstoryByRef(PROJECT_ID, 121);

        expect(story.getAttrs).toHaveBeenCalledTimes(1);
        expect(resolved).toEqual(story.attrs);
        expect(resolved.version).toBe(3);
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = new Error('not found');

        harness.resources.getByRef.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.getUserstoryByRef(PROJECT_ID, 1)).rejects.toBe(reason);
    });
});

describe('listSwimlanes', () => {
    it('forwards the project id and flattens every swimlane model', async () => {
        const harness = renderKanbanData();
        const first = swimlaneModelOf(1, 'totam');
        const second = swimlaneModelOf(2, 'animi');

        harness.resources.swimlanesList.mockReturnValue(
            angularPromiseOf([first.model, second.model]),
        );

        const swimlanes = await harness.api.listSwimlanes(PROJECT_ID);

        expect(harness.resources.swimlanesList).toHaveBeenCalledWith(PROJECT_ID);
        expect(first.getAttrs).toHaveBeenCalledTimes(1);
        expect(swimlanes).toEqual([first.attrs, second.attrs]);
    });

    it('does not group the statuses it did not ask for', async () => {
        const harness = renderKanbanData();
        const swimlane = swimlaneModelOf(1, 'totam');

        harness.resources.swimlanesList.mockReturnValue(
            angularPromiseOf([swimlane.model]),
        );

        const swimlanes = await harness.api.listSwimlanes(PROJECT_ID);

        // The `swimlanesStatuses` map the incumbent built beside this call
        // (main.coffee:555-560) is grouping, and grouping belongs to the reducer.
        expect(swimlanes).toEqual([{ id: 1, name: 'totam' }]);
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = { status: 451 };

        harness.resources.swimlanesList.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.listSwimlanes(PROJECT_ID)).rejects.toBe(reason);
    });
});

describe('loadTagsColors', () => {
    it('flattens the tag-colour model rather than spreading it', async () => {
        const harness = renderKanbanData();
        const colors = modelDoubleOf<TagsColorsAttrs>('projects', {
            urgent: '#E44057',
            uncoloured: null,
        });

        harness.resources.tagsColors.mockReturnValue(angularPromiseOf(colors.model));

        const resolved = await harness.api.loadTagsColors(PROJECT_ID);

        expect(harness.resources.tagsColors).toHaveBeenCalledWith(PROJECT_ID);
        expect(colors.getAttrs).toHaveBeenCalledTimes(1);
        expect(resolved).toEqual({ urgent: '#E44057', uncoloured: null });
        expect(resolved).not.toHaveProperty('getAttrs');
    });

    it('⛔ proves a spread would NOT have produced the dictionary', async () => {
        const harness = renderKanbanData();
        const colors = modelDoubleOf<TagsColorsAttrs>('projects', {
            urgent: '#E44057',
            uncoloured: null,
        });

        harness.resources.tagsColors.mockReturnValue(angularPromiseOf(colors.model));

        const resolved = await harness.api.loadTagsColors(PROJECT_ID);

        // The incumbent read the private slot directly (`tags_colors._attrs` at
        // main.coffee:370) precisely BECAUSE the public surface is not spreadable. A
        // `{...model}` here would hand the board an object of jest mocks and no tags —
        // every pill would render with the default fill and nothing would throw.
        expect(Object.keys({ ...colors.model })).not.toContain('urgent');
        expect(Object.keys(resolved).sort()).toEqual(['uncoloured', 'urgent']);

        // A NULL COLOUR IS DATA, not an absent entry: an uncoloured tag renders with the
        // default pill fill, and dropping the key would make it indistinguishable from a
        // tag the project does not define (rule T2, Drift Register D3).
        expect(resolved.uncoloured).toBeNull();
        expect(resolved).toHaveProperty('uncoloured');
        expect(nonPlainDataFindings(resolved)).toEqual([]);
    });

    it('hardcodes no colour of its own', () => {
        expect(UNIT_CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(UNIT_CODE).not.toMatch(/\brgba?\(/);
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = new Error('offline');

        harness.resources.tagsColors.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.loadTagsColors(PROJECT_ID)).rejects.toBe(reason);
    });
});

describe('loadFiltersData', () => {
    it('forwards the parameters and returns the parsed body UNCHANGED', async () => {
        const harness = renderKanbanData();
        const body = {
            statuses: [{ id: 5, name: 'NEW', color: '#70728F', order: 10, count: 2 }],
            tags: [{ name: 'urgent', color: null, count: 1 }],
            assigned_users: [],
            assigned_to: [],
            roles: [],
            owners: [],
            epics: [],
        };
        const params: ResourceParams = { project: PROJECT_ID, tags: '3' };

        harness.resources.filtersData.mockReturnValue(angularPromiseOf(body));

        const resolved = await harness.api.loadFiltersData(params);

        expect(harness.resources.filtersData).toHaveBeenCalledWith(params);

        // IDENTITY, not equality: the AngularJS filter mixin stringifies these ids and
        // rewrites the tag rows in place (controllerMixins.coffee:249-290). Doing any of
        // it here would give the retained panel a second helping.
        expect(resolved).toBe(body);
        expect(resolved.statuses[0].id).toBe(5);
        expect(resolved.tags[0]).not.toHaveProperty('id');
    });

    it('returns the facade promise ITSELF, so nothing is marshalled a second time', async () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData();

        const returned = harness.api.loadFiltersData({ project: PROJECT_ID });

        /*
         * ⭐ WHY IDENTITY IS THE RIGHT ASSERTION HERE. Every facade under
         * `../../shared/api/**` already marshals its `$q` promise with
         * `toNativePromise`, so a second conversion in the hook would not break anything
         * — it would add a microtask hop and, worse, obscure which values in this file
         * are genuinely raw. The member is written as a straight return of the facade's
         * promise, so the promise the caller receives IS the facade's; a re-wrap, an
         * `async` keyword or a `Promise.resolve` would each replace it with a new object
         * and fail this line.
         */
        expect(returned).toBe(callResultOf(facades.getUserstoriesFiltersData));
        expect(facades.getUserstoriesFiltersData).toHaveBeenCalledTimes(1);

        await expect(returned).resolves.toEqual({});
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = { status: 0 };

        harness.resources.filtersData.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.loadFiltersData({})).rejects.toBe(reason);
    });
});

/* ==========================================================================
 * THE FLATTENING BOUNDARY
 *
 * One place that asks the same question of every read: is what came back safe to put
 * in React state and in an immer draft?
 * ========================================================================== */

describe('the data boundary', () => {
    it('detects each wrapper it exists to exclude, so the gate cannot pass vacuously', () => {
        const element = document.createElement('div');

        expect(nonPlainDataFindings(modelDoubleOf('userstories', { id: 1 }).model)).toEqual([
            'result.getAttrs is a function',
            'result.setAttr is a function',
            'result.isModified is a function',
            'result.getName is a function',
            'result.clone is a function',
        ]);
        expect(nonPlainDataFindings(angularPromiseOf(1))).toEqual([
            'result is a thenable, e.g. an AngularJS $q promise',
        ]);
        expect(nonPlainDataFindings(Promise.resolve(1))).toEqual([
            'result is a native promise',
        ]);
        expect(nonPlainDataFindings(element)).toEqual(['result is a DOM node']);
        expect(nonPlainDataFindings(new Map([['5', true]]))).toEqual([
            'result has a non-plain prototype, e.g. a $tgModel or a persistent structure',
        ]);
        expect(nonPlainDataFindings({ rows: [{ onDrop: (): void => undefined }] })).toEqual([
            'result.rows[0].onDrop is a function',
        ]);
    });

    it('hands back plain data from every read, with no wrapper, promise or node', async () => {
        const harness = renderKanbanData({ payload: projectPayload() });
        const story = storyModelOf(31, 'Move to READY', 6);
        const swimlane = swimlaneModelOf(4, 'quos');
        const colors = modelDoubleOf<TagsColorsAttrs>('projects', { urgent: '#E44057' });

        harness.resources.listAll.mockReturnValue(angularPromiseOf([story.model]));
        harness.resources.getByRef.mockReturnValue(angularPromiseOf(story.model));
        harness.resources.swimlanesList.mockReturnValue(angularPromiseOf([swimlane.model]));
        harness.resources.tagsColors.mockReturnValue(angularPromiseOf(colors.model));

        /*
         * `act` because these settlements happen while a React tree is mounted: it
         * flushes the queued work inside React's batching, so every assertion below reads
         * a settled tree. Nothing here schedules an update today — the hook holds no
         * state of its own — and that is exactly why the flush is cheap insurance rather
         * than a workaround for one.
         */
        await act(async () => {
            expect(
                nonPlainDataFindings(await harness.api.listUserstories(PROJECT_ID)),
            ).toEqual([]);
            expect(
                nonPlainDataFindings(await harness.api.getUserstoryByRef(PROJECT_ID, 131)),
            ).toEqual([]);
            expect(
                nonPlainDataFindings(await harness.api.listSwimlanes(PROJECT_ID)),
            ).toEqual([]);
            expect(
                nonPlainDataFindings(await harness.api.loadTagsColors(PROJECT_ID)),
            ).toEqual([]);
        });

        expect(nonPlainDataFindings(harness.api.loadProject())).toEqual([]);
        expect(nonPlainDataFindings(harness.api.getStatusColumnModes(PROJECT_ID))).toEqual([]);
        expect(nonPlainDataFindings(harness.api.getSwimlanesModes(PROJECT_ID))).toEqual([]);
    });

    it('never lets the persistent project structure itself through', () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        const project = harness.api.loadProject();

        // `.toJS()` is the ONE flattening of the project, and the structure it was read
        // from must not be reachable from the result: `autoFreeze` would otherwise freeze
        // a value AngularJS still holds (pitfalls P-IMMER-1 and P-IMMER-4).
        expect(project).not.toBe(harness.projectService.service.project);
        expect(project).not.toHaveProperty('toJS');
        expect(project).not.toHaveProperty('get');
        expect(Object.getPrototypeOf(project)).toBe(Object.prototype);
    });
});

/* ==========================================================================
 * THE WRITE
 * ========================================================================== */

describe('submitKanbanOrder', () => {
    it('sends the six frozen arguments in the frozen order', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 3,
            afterUserstoryId: 11,
            beforeUserstoryId: null,
            bulkUserstories: [21, 22],
        });

        expect(harness.resources.bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1);
        expect(harness.resources.bulkUpdateKanbanOrder).toHaveBeenCalledWith(
            PROJECT_ID,
            5,
            3,
            11,
            null,
            [21, 22],
        );
    });

    it('reaches the facade with exactly SEVEN arguments: the service and the six values', async () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData();
        const bulkUserstories = [21, 22];

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 3,
            afterUserstoryId: 11,
            beforeUserstoryId: null,
            bulkUserstories,
        });

        const call = callArgsOf(facades.bulkUpdateKanbanOrder);

        /*
         * ⛔ THE COUNT IS PART OF THE CONTRACT. Four of the six values are consecutive
         * numbers — status, swimlane, after, before — so dropping or transposing one
         * type-checks perfectly and persists a wrong board behind an HTTP 200, visible
         * only on the next page load. Asserting the LENGTH as well as each position
         * catches the argument that is silently absent, which a positional assertion on
         * its own does not: a missing sixth argument would leave the seventh reading
         * `undefined` here and `[]` on the wire.
         */
        expect(call).toHaveLength(7);
        expect(facades.bulkUpdateKanbanOrder.mock.calls[0].length).toBe(7);
        expect(call[0]).toBe(harness.resources.service.userstories);
        expect(call[1]).toBe(PROJECT_ID);
        expect(call[2]).toBe(5);
        expect(call[3]).toBe(3);
        expect(call[4]).toBe(11);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(bulkUserstories);
    });

    it('forwards BOTH neighbours to the facade, which owns the AFTER-wins rule', async () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 3,
            afterUserstoryId: 11,
            beforeUserstoryId: 12,
            bulkUserstories: [21],
        });

        const facadeCall = callArgsOf(facades.bulkUpdateKanbanOrder);

        // The hook does NOT pre-resolve the precedence: it hands both anchors over and
        // the facade drops the loser when it builds the body. Reproducing the rule here
        // as well would give it two homes, and two homes are how it drifts.
        expect(facadeCall[4]).toBe(11);
        expect(facadeCall[5]).toBe(12);

        // …and only one of them survives onto the request.
        expect(callArgsOf(harness.resources.bulkUpdateKanbanOrder)[3]).toBe(11);
        expect(callArgsOf(harness.resources.bulkUpdateKanbanOrder)[4]).toBeNull();
    });

    it('translates the unclassified sentinel BEFORE the facade, on a local only', async () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData();
        const write = {
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [31],
        };

        await harness.api.submitKanbanOrder(write);

        // `-1` is a legitimate GROUPING key and an illegitimate stored reference, so the
        // sentinel is spelled `null` for the API — and the caller's own object still
        // carries `-1`, because the same value may still be travelling to the reducer,
        // which performs its own independent translation.
        expect(callArgsOf(facades.bulkUpdateKanbanOrder)[3]).toBeNull();
        expect(write.swimlaneId).toBe(UNCLASSIFIED_SWIMLANE_ID);
        expect(write.swimlaneId).toBe(-1);
    });

    it('⭐ lets AFTER win when both neighbours are supplied, as the frozen body does', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 3,
            afterUserstoryId: 11,
            beforeUserstoryId: 12,
            bulkUserstories: [21, 22],
        });

        const call = callArgsOf(harness.resources.bulkUpdateKanbanOrder);

        // `if afterUserstoryId … else if beforeUserstoryId` at
        // app/coffee/modules/resources/userstories.coffee:120-124: only ONE neighbour
        // key ever reaches the wire. The hook forwards both and the facade applies the
        // precedence, so this asserts the rule end to end rather than duplicating it.
        expect(call[3]).toBe(11);
        expect(call[4]).toBeNull();
    });

    it('translates the unclassified grouping key into a null swimlane for the API', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [31],
        });

        expect(callArgsOf(harness.resources.bulkUpdateKanbanOrder)[2]).toBeNull();
    });

    it('never mutates the payload, which may still be travelling to the reducer', async () => {
        const harness = renderKanbanData();
        const write = Object.freeze({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [31],
        });

        await harness.api.submitKanbanOrder(write);

        expect(write.swimlaneId).toBe(UNCLASSIFIED_SWIMLANE_ID);
    });

    it('leaves a real swimlane id alone', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 3,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [31],
        });

        expect(callArgsOf(harness.resources.bulkUpdateKanbanOrder)[2]).toBe(3);
    });

    it('⛔ omits a falsy swimlane id, which is the incumbent truthiness rule', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 5,
            swimlaneId: 0,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [31],
        });

        // `if swimlaneId` at app/coffee/modules/resources/userstories.coffee:126 is a
        // TRUTHY check, so a zero id omits `swimlane_id` entirely. The hook translates
        // only the unclassified sentinel and leaves the rest of that rule where it
        // already lives; this pins the composed behaviour so nobody "fixes" the zero
        // case into a null check (T10).
        expect(callArgsOf(harness.resources.bulkUpdateKanbanOrder)[2]).toBeNull();
    });

    it('forwards both neighbours and leaves the precedence to the frozen body', async () => {
        const harness = renderKanbanData();

        await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 7,
            swimlaneId: null,
            afterUserstoryId: null,
            beforeUserstoryId: 41,
            bulkUserstories: [51, 52, 53],
        });

        const call = callArgsOf(harness.resources.bulkUpdateKanbanOrder);

        expect(call[3]).toBeNull();
        expect(call[4]).toBe(41);
        expect(call[5]).toEqual([51, 52, 53]);
    });

    it('resolves with the authoritative rows the server settled on', async () => {
        const harness = renderKanbanData();
        const response = {
            data: [{ id: 51, swimlane: null, status: 7, kanban_order: 3 }],
            status: 200,
            headers: () => ({}),
        };

        harness.resources.bulkUpdateKanbanOrder.mockReturnValue(angularPromiseOf(response));

        const resolved = await harness.api.submitKanbanOrder({
            projectId: PROJECT_ID,
            statusId: 7,
            swimlaneId: null,
            afterUserstoryId: null,
            beforeUserstoryId: null,
            bulkUserstories: [51],
        });

        expect(resolved).toBe(response);
    });

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = { status: 400, data: { version: ['stale'] } };

        harness.resources.bulkUpdateKanbanOrder.mockReturnValue(angularRejectionOf(reason));

        await expect(
            harness.api.submitKanbanOrder({
                projectId: PROJECT_ID,
                statusId: 7,
                swimlaneId: null,
                afterUserstoryId: null,
                beforeUserstoryId: null,
                bulkUserstories: [51],
            }),
        ).rejects.toBe(reason);
    });
});

/* ==========================================================================
 * THE FOUR SYNCHRONOUS STORAGE MEMBERS
 * ========================================================================== */

describe('the persisted fold maps', () => {
    it('reads both maps synchronously, with no promise anywhere', () => {
        const harness = renderKanbanData();

        harness.resources.getStatusColumnModes.mockReturnValue({ '5': true });
        harness.resources.getSwimlanesModes.mockReturnValue({ '2': true });

        const columns = harness.api.getStatusColumnModes(PROJECT_ID);
        const swimlanes = harness.api.getSwimlanesModes(PROJECT_ID);

        // Called ALREADY, without an await: that is the synchronicity proof.
        expect(harness.resources.getStatusColumnModes).toHaveBeenCalledWith(PROJECT_ID);
        expect(harness.resources.getSwimlanesModes).toHaveBeenCalledWith(PROJECT_ID);

        expect(columns).not.toBeInstanceOf(Promise);
        expect(swimlanes).not.toBeInstanceOf(Promise);
        expect(columns).not.toHaveProperty('then');
        expect(swimlanes).not.toHaveProperty('then');
        expect(columns).toEqual({ '5': true });
        expect(swimlanes).toEqual({ '2': true });
    });

    it('⛔ would silently lose every fold if either reader returned a promise', () => {
        const harness = renderKanbanData();

        harness.resources.getStatusColumnModes.mockReturnValue({ '5': true, '7': false });
        harness.resources.getSwimlanesModes.mockReturnValue({ '2': true });

        const columns = harness.api.getStatusColumnModes(PROJECT_ID);
        const swimlanes = harness.api.getSwimlanesModes(PROJECT_ID);

        /*
         * THE REGRESSION THIS TEST EXISTS TO MAKE LOUD, stated once so nobody has to
         * rediscover it: both maps are consumed BY TRUTHINESS PER ID — `if
         * !$scope.folds[status.id]` at main.coffee:785 and
         * `!@.foldedSwimlane.get(id.toString())` at :329. A `Promise` in that slot is a
         * truthy object whose every id lookup is `undefined`, so nothing throws, no
         * request fails, and every column and swimlane simply renders UNFOLDED — the
         * user's folds are gone after a reload with no symptom pointing at the cause. A
         * promise-wrapped getter therefore looks superficially valid and is a data loss.
         *
         * The assertions below are the per-id lookups themselves, not just a type check,
         * because the lookup is the behaviour that breaks.
         */
        expect(columns['5']).toBe(true);
        expect(columns['7']).toBe(false);
        expect(swimlanes['2']).toBe(true);
        expect(columns).not.toBeInstanceOf(Promise);
        expect(Reflect.get(columns, 'then')).toBeUndefined();
        expect(Reflect.get(swimlanes, 'then')).toBeUndefined();
    });

    it('keeps STRING keys, which is what the incumbent looks up with', () => {
        const harness = renderKanbanData();

        harness.resources.getStatusColumnModes.mockReturnValue({ 5: true, 12: false });
        harness.resources.getSwimlanesModes.mockReturnValue({ 2: true });

        const columns = harness.api.getStatusColumnModes(PROJECT_ID);

        // `id.toString()` at main.coffee:329 is the incumbent's own lookup, so the key
        // space is strings and a numeric id must find its entry through `String(id)`.
        expect(Object.keys(columns)).toEqual(['5', '12']);
        expect(Object.keys(columns).every((key) => typeof key === 'string')).toBe(true);
        expect(columns[String(12)]).toBe(false);
        expect(Object.keys(harness.api.getSwimlanesModes(PROJECT_ID))).toEqual(['2']);
    });

    it('never answers nothing, because the incumbent readers default to an empty map', () => {
        const harness = renderKanbanData();

        expect(harness.api.getStatusColumnModes(PROJECT_ID)).toEqual({});
        expect(harness.api.getSwimlanesModes(PROJECT_ID)).toEqual({});
    });

    it('writes both maps synchronously and forwards them verbatim', () => {
        const harness = renderKanbanData();
        const columns: KanbanFoldModes = { '5': true, '7': false };
        const swimlanes: KanbanFoldModes = { '2': true };

        harness.api.storeStatusColumnModes(PROJECT_ID, columns);
        harness.api.storeSwimlanesModes(PROJECT_ID, swimlanes);

        expect(harness.resources.storeStatusColumnModes).toHaveBeenCalledWith(
            PROJECT_ID,
            columns,
        );
        expect(harness.resources.storeSwimlanesModes).toHaveBeenCalledWith(
            PROJECT_ID,
            swimlanes,
        );

        // IDENTITY, not equality. Whole-map replacement is the persisted semantics the
        // incumbent has, so the writer must forward the caller's object rather than a
        // merge, a clone or a filtered copy — each of which would satisfy `toEqual` here
        // while changing what lands in storage.
        expect(callArgsOf(harness.resources.storeStatusColumnModes)[1]).toBe(columns);
        expect(callArgsOf(harness.resources.storeSwimlanesModes)[1]).toBe(swimlanes);
    });

    it('hands the storage facades the caller value untouched, all the way down', () => {
        const facades = spyOnFacades();
        const harness = renderKanbanData();
        const columns: KanbanFoldModes = { '5': true };

        harness.api.storeStatusColumnModes(PROJECT_ID, columns);

        expect(callArgsOf(facades.storeStatusColumnModes)).toHaveLength(3);
        expect(callArgsOf(facades.storeStatusColumnModes)[1]).toBe(PROJECT_ID);
        expect(callArgsOf(facades.storeStatusColumnModes)[2]).toBe(columns);
    });

    it('returns synchronously from all four members, with no await anywhere', () => {
        const harness = renderKanbanData();

        // Every one of the four is called and read in the same expression: if any of them
        // were promise-returning, the reads below would be reading a promise rather than a
        // map, and the two writes would be scheduling rather than storing.
        const before = harness.api.getStatusColumnModes(PROJECT_ID);

        harness.api.storeStatusColumnModes(PROJECT_ID, { ...before, '5': true });
        harness.api.storeSwimlanesModes(PROJECT_ID, { '2': true });

        expect(harness.resources.storeStatusColumnModes).toHaveBeenCalledTimes(1);
        expect(harness.resources.storeSwimlanesModes).toHaveBeenCalledTimes(1);
        expect(harness.api.getSwimlanesModes(PROJECT_ID)).not.toBeInstanceOf(Promise);
        expect(harness.api.storeSwimlanesModes(PROJECT_ID, {})).toBeUndefined();
    });

    it('declares none of the four wrappers async', () => {
        expect(UNIT_CODE).not.toMatch(
            /(read|write)(StatusColumnModes|SwimlanesModes)\s*=\s*useCallback\(\s*async/,
        );
    });
});

/* ==========================================================================
 * THE ONE MARSHALLED THENABLE
 * ========================================================================== */

describe('refreshProject', () => {
    it('marshals the raw framework thenable into a native promise', async () => {
        const harness = renderKanbanData({
            payload: projectPayload(),
            fetchResult: angularPromiseOf<void>(undefined),
        });

        const refreshed = harness.api.refreshProject();

        expect(refreshed).toBeInstanceOf(Promise);
        await expect(refreshed).resolves.toBeUndefined();
        expect(harness.projectService.fetchProject).toHaveBeenCalledTimes(1);
    });

    it('settles even when the service holds no project and returns nothing', async () => {
        const harness = renderKanbanData({
            payload: projectPayload(),
            fetchResult: undefined,
        });

        await expect(harness.api.refreshProject()).resolves.toBeUndefined();
    });

    it('passes a rejection through untouched', async () => {
        const reason = { status: 0 };
        const harness = renderKanbanData({
            payload: projectPayload(),
            fetchResult: angularRejectionOf<void>(reason),
        });

        await expect(harness.api.refreshProject()).rejects.toBe(reason);
    });

    it('is the only marshalling site, because every other read goes through a facade', () => {
        expect(UNIT_CODE.match(/toNativePromise</g)).toHaveLength(1);
    });
});

/* ==========================================================================
 * API SHAPE AND STABILITY
 * ========================================================================== */

describe('the returned API', () => {
    /*
     * Typed against the API rather than as bare strings, so a renamed member is a
     * COMPILE error here instead of a run-time expectation mismatch -- and so the two
     * indexed reads below need no type assertion.
     */
    const EXPECTED_MEMBERS: readonly (keyof KanbanDataApi)[] = [
        'loadProject',
        'listUserstories',
        'getUserstoryByRef',
        'listSwimlanes',
        'loadTagsColors',
        'loadFiltersData',
        'submitKanbanOrder',
        'getStatusColumnModes',
        'storeStatusColumnModes',
        'getSwimlanesModes',
        'storeSwimlanesModes',
        'refreshProject',
    ];

    it('exposes exactly the twelve members the board needs, all callable', () => {
        const { api } = renderKanbanData();

        expect(Object.keys(api).sort()).toEqual([...EXPECTED_MEMBERS].sort());

        for (const member of Object.values(api)) {
            expect(typeof member).toBe('function');
        }
    });

    it('keeps one identity across re-renders, members included', () => {
        const harness = renderKanbanData({ payload: projectPayload() });
        const before = harness.currentApi();

        harness.rerender();

        const after = harness.currentApi();

        expect(after).toBe(before);

        for (const member of EXPECTED_MEMBERS) {
            expect(after[member]).toBe(before[member]);
        }
    });
});

/* ==========================================================================
 * STATIC GATES
 * ========================================================================== */

describe('the unit source', () => {
    it('has executable code to scan', () => {
        expect(UNIT_CODE.length).toBeGreaterThan(0);
        expect(UNIT_CODE).toContain('export function useKanbanData');
    });

    it.each(UNIT_PROHIBITIONS)('excludes $description', ({ needle }) => {
        expect(UNIT_CODE).not.toContain(needle);
    });

    it('declares no untyped value', () => {
        expect(UNIT_CODE).not.toMatch(/:\s*any\b/);
        expect(UNIT_CODE).not.toMatch(/<\s*any\s*[,>]/);
    });

    it('imports only from the bridge, the shared layer and the board state', () => {
        expect(importSpecifiersOf(UNIT_SOURCE)).toEqual([
            '../../bridge/toNativePromise',
            '../../bridge/useAngularService',
            '../../shared/api/kanbanStorage',
            '../../shared/api/projects',
            '../../shared/api/swimlanes',
            '../../shared/api/userstories',
            '../../shared/types/status',
            '../../shared/types/swimlane',
            '../../shared/types/userStory',
            '../state/boardReducer',
            'react',
        ]);
    });

    it('imports only named React hooks', () => {
        expect(UNIT_CODE).toContain("import { useCallback, useMemo } from 'react';");
    });

    it('exports the hook by name and nothing by default', () => {
        expect(UNIT_CODE).toContain('export function useKanbanData(): KanbanDataApi');
        expect(UNIT_CODE).not.toMatch(/export\s+default/);
    });

    it('sends exactly six business arguments to the frozen order write', () => {
        const call = /bulkUpdateKanbanOrder\(\s*resources\.userstories,([\s\S]*?)\n {12}\);/.exec(
            UNIT_CODE,
        );

        expect(call).not.toBeNull();

        const args = (call?.[1] ?? '')
            .split(',')
            .map((argument) => argument.trim())
            .filter((argument) => argument.length > 0);

        expect(args).toEqual([
            'write.projectId',
            'write.statusId',
            'apiSwimlaneId',
            'write.afterUserstoryId',
            'write.beforeUserstoryId',
            'write.bulkUserstories',
        ]);
    });

    it('derives the write parameter types from the facade instead of restating them', () => {
        expect(UNIT_CODE).toContain('Parameters<typeof bulkUpdateKanbanOrder>');
    });

    it('documents the sync/async seam at the point of the seam', () => {
        /*
         * The one gate that reads the PROSE rather than the code, and deliberately so.
         * Which members are promise-returning and which are synchronous is invisible at a
         * call site — that is the whole hazard of section 3 — so the file is required to
         * say it, in the file header and again beside the four wrappers. A future edit
         * that made a fold getter `async` would have to delete this documentation to pass,
         * which is a reviewable act rather than an accident.
         */
        expect(UNIT_SOURCE).toContain('SYNC/ASYNC');
        expect(UNIT_SOURCE).toContain('SYNCHRONOUS');
        expect(UNIT_SOURCE).toContain('UNFOLDED');

        // The declared type carries the asymmetry too, so a consumer sees it without
        // reading the prose: the four storage members return a map, never a promise.
        expect(UNIT_SOURCE).toMatch(
            /getStatusColumnModes:\s*\(projectId:\s*number\)\s*=>\s*KanbanFoldModes/,
        );
        expect(UNIT_SOURCE).toMatch(
            /getSwimlanesModes:\s*\(projectId:\s*number\)\s*=>\s*KanbanFoldModes/,
        );
    });

    it('names every legacy locator it reproduces, so the parity is checkable', () => {
        // Behaviour this file copies is cited at the line it was copied from; without the
        // citations, "is this still what AngularJS does?" is unanswerable and the parity
        // silently rots. These four are the load-bearing ones.
        for (const locator of [
            'main.coffee:423-436',
            'main.coffee:564-580',
            'base/model.coffee:48-54',
            'controllerMixins.coffee:249-290',
        ]) {
            expect(UNIT_SOURCE).toContain(locator);
        }
    });
});
