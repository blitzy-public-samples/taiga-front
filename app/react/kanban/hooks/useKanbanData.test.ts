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
 * Browserless by construction: jsdom, no network, no AngularJS bootstrap, no
 * Playwright, no snapshots, no Immutable fixture. Every AngularJS service is a
 * structural double supplied through `mockInjector`, which THROWS for any name the
 * spec did not supply — so "this hook resolves nothing else" is asserted by the
 * doubles that are absent rather than by prose.
 *
 * The gates that would otherwise be untestable are covered by a source scan of the
 * unit with comments stripped, so documentation prose can neither satisfy nor
 * violate a prohibition.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { renderHook } from '@testing-library/react';

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
 * A live-model stand-in whose ONLY own enumerable members are its methods.
 *
 * That shape is what makes the flattening gate real: a unit that spread the model
 * instead of calling `getAttrs()` would produce an object of functions and no
 * attributes, so every "flattens" expectation below fails for a spread
 * implementation rather than passing by accident. `getAttrs` hands back a FRESH
 * shallow copy, exactly as `_.extend({}, …)` does at
 * app/coffee/modules/base/model.coffee:48-54.
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

    return { model, getAttrs, attrs };
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

/** One `$http` response, as the repository's raw write path resolves it. */
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

/** The recorded arguments of one call, narrowed from jest's untyped record. */
function callArgsOf(mock: jest.Mock, callIndex: number = 0): readonly unknown[] {
    const calls: readonly unknown[][] = mock.mock.calls;

    return calls[callIndex] ?? [];
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
    readonly errorHandling: ErrorHandlingDouble;
    readonly rerender: () => void;
    readonly currentApi: () => KanbanDataApi;
}

/**
 * Mounts the hook with the three services it is allowed to resolve AND NOTHING
 * ELSE. `mockInjector` throws for an unsupplied name, so a fourth resolution — a
 * scope, `$q`, `$http`, `tgResources` — would fail every spec in this file.
 */
function renderKanbanData(options: {
    readonly payload?: Record<string, unknown> | null;
    readonly fetchResult?: AngularPromise<void> | undefined;
} = {}): Harness {
    const resources = resourcesDouble();
    const projectService = projectServiceDouble(options);
    const errorHandling = errorHandlingDouble();

    const injector = mockInjector({
        $tgResources: resources.service,
        tgProjectService: projectService.service,
        tgErrorHandlingService: errorHandling.service,
    });

    const rendered = renderHook(() => useKanbanData(), {
        wrapper: withMockInjector(injector),
    });

    return {
        api: rendered.result.current,
        resources,
        projectService,
        errorHandling,
        rerender: () => rendered.rerender(),
        currentApi: () => rendered.result.current,
    };
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

    it('resolves the dollar-prefixed resource service exactly once', () => {
        const resolutions = Array.from(
            UNIT_CODE.matchAll(/useAngularService\('([^']+)'\)/g),
            (match) => match[1],
        );

        expect(resolutions).toEqual([
            '$tgResources',
            'tgProjectService',
            'tgErrorHandlingService',
        ]);
    });

    it('never resolves the attachments resource service, which is a different service', () => {
        // `'$tgResources'` does not contain `'tgResources'` as a quoted substring, so
        // this gate is exact rather than incidental.
        expect(UNIT_CODE).not.toContain(`${"'tgReso"}${"urces'"}`);
    });

    it('reaches each facade through its own sub-resource', async () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        await harness.api.listUserstories(PROJECT_ID);
        await harness.api.listSwimlanes(PROJECT_ID);
        await harness.api.loadTagsColors(PROJECT_ID);
        harness.api.getStatusColumnModes(PROJECT_ID);

        expect(harness.resources.listAll).toHaveBeenCalledTimes(1);
        expect(harness.resources.swimlanesList).toHaveBeenCalledTimes(1);
        expect(harness.resources.tagsColors).toHaveBeenCalledTimes(1);
        expect(harness.resources.getStatusColumnModes).toHaveBeenCalledTimes(1);
    });

    it('never calls the project-values endpoint, whose statuses are in the project', async () => {
        const harness = renderKanbanData({ payload: projectPayload() });

        harness.api.loadProject();
        await harness.api.listUserstories(PROJECT_ID);

        expect(harness.resources.listValues).not.toHaveBeenCalled();
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

    it('passes a rejection through untouched', async () => {
        const harness = renderKanbanData();
        const reason = { status: 0 };

        harness.resources.filtersData.mockReturnValue(angularRejectionOf(reason));

        await expect(harness.api.loadFiltersData({})).rejects.toBe(reason);
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
    const EXPECTED_MEMBERS: readonly string[] = [
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
            expect(after[member as keyof KanbanDataApi]).toBe(
                before[member as keyof KanbanDataApi],
            );
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
});
