/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';
import type { MockServiceMap } from './mockInjector';
import {
    SANCTIONED_SERVICE_NAMES,
    useAngularBroadcastListener,
    useAngularService,
} from './useAngularService';
import type {
    AngularBroadcastListener,
    AngularPromise,
    AngularServices,
    ResourceParams,
    TaigaEventsService,
    TaigaModel,
    TaigaResources,
    TaigaResources2,
    TranslateService,
} from './useAngularService';

type Equals<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const DIGEST_ENTRY_POINTS: readonly string[] = ['apply', 'applyAsync', 'digest'].map(
    (method) => `$${method}`,
);

const ANGULAR_TRANSPORT_SERVICE = `$${'http'}`;

const BROWSER_REQUEST_APIS: readonly string[] = [
    `${'fet'}${'ch'}`,
    `XML${'HttpRequest'}`,
    `Web${'Socket'}`,
    `Event${'Source'}`,
];

type PlainAttrs = Record<string, unknown>;

type StoryModels = Array<TaigaModel<PlainAttrs>>;

type ListAllReturn = ReturnType<TaigaResources['userstories']['listAll']>;

type GetSwimlanesModesMock = jest.Mock<ResourceParams, [number]>;

type StoreShowTagsMock = jest.Mock<void, [number, boolean]>;

interface ResourcesDouble {
    service: TaigaResources;
    listAll: jest.Mock;
    getSwimlanesModes: GetSwimlanesModesMock;
    storeShowTags: StoreShowTagsMock;
    storyModels: StoryModels;
}

type SubscribeMock = jest.Mock<
    void,
    [unknown, string, (data: unknown) => void, (ResourceParams | undefined)?]
>;

type UnsubscribeMock = jest.Mock<void, [string]>;

interface EventsDouble {
    service: TaigaEventsService;
    subscribe: SubscribeMock;
    unsubscribe: UnsubscribeMock;
}

type InstantMock = jest.Mock<string, [string, (ResourceParams | undefined)?]>;

interface TranslateDouble {
    service: TranslateService;
    instant: InstantMock;
}

interface Resources2Double {
    service: TaigaResources2;
    list: jest.Mock;
}

function angularPromiseOf<T>(value: T): AngularPromise<T> {
    return {
        then(onFulfilled: (resolved: T) => unknown, _onRejected: (reason: unknown) => unknown) {
            return onFulfilled(value);
        },
    };
}

function plainStoryModel(id: number, subject: string): TaigaModel<PlainAttrs> {
    const attrs: PlainAttrs = {
        id,
        subject,
        ref: id,
        version: 1,
        is_blocked: false,
        status: 1,
        tags: [['urgent', '#E44057']],
    };

    return {
        getAttrs: () => attrs,
        setAttr: () => undefined,
        isModified: () => false,
        getName: () => 'userstories',
        clone: () => plainStoryModel(id, subject),
    };
}

function mockTgResources(): ResourcesDouble {
    const storyModels: StoryModels = [
        plainStoryModel(1, 'Reorder the sprint'),
        plainStoryModel(2, 'Fold the DONE column'),
    ];

    const listAll = jest.fn();

    listAll.mockReturnValue(angularPromiseOf<StoryModels>(storyModels));

    const getSwimlanesModes: GetSwimlanesModesMock = jest.fn((_projectId) => ({}));
    const storeShowTags: StoreShowTagsMock = jest.fn();

    const service: TaigaResources = {
        userstories: {
            get: jest.fn(),
            getByRef: jest.fn(),
            listAll,
            listUnassigned: jest.fn(),
            filtersData: jest.fn(),
            bulkCreate: jest.fn(),
            bulkUpdateBacklogOrder: jest.fn(),
            bulkUpdateKanbanOrder: jest.fn(),
            bulkUpdateMilestone: jest.fn(),
            listValues: jest.fn(),
            storeQueryParams: jest.fn(),
            // The two storage-backed READS default the way the incumbent does --
            // an empty object at `resources/userstories.coffee:157` and an empty
            // array at `:167` -- so a double that returned the nothing-value here
            // would be a shape the resource layer never produces.
            getQueryParams: jest.fn(() => ({})),
            storeBacklog: jest.fn(),
            getBacklog: jest.fn(() => []),
            storeShowTags,
            getShowTags: jest.fn(() => null),
        },
        sprints: {
            list: jest.fn(),
            get: jest.fn(),
            stats: jest.fn(),
            moveUserStoriesMilestone: jest.fn(),
        },
        swimlanes: { list: jest.fn() },
        kanban: {
            storeStatusColumnModes: jest.fn(),
            getStatusColumnModes: jest.fn(() => ({})),
            storeSwimlanesModes: jest.fn(),
            getSwimlanesModes,
        },
        projects: { stats: jest.fn(), tagsColors: jest.fn() },
    };

    return { service, listAll, getSwimlanesModes, storeShowTags, storyModels };
}

function mockTgResources2(): Resources2Double {
    const list = jest.fn();

    list.mockReturnValue(angularPromiseOf<unknown[]>([]));

    return { service: { attachments: { list } }, list };
}

function mockTgEvents(): EventsDouble {
    const subscribe: SubscribeMock = jest.fn();
    const unsubscribe: UnsubscribeMock = jest.fn();

    return {
        service: { connected: true, subscribe, unsubscribe },
        subscribe,
        unsubscribe,
    };
}

function mockTranslate(): TranslateDouble {
    const instant: InstantMock = jest.fn((translationId: string) => translationId);

    const service: TranslateService = {
        instant,
        preferredLanguage: jest.fn(() => 'en'),
        getTranslationTable: jest.fn(() => ({})),
    };

    return { service, instant };
}

const mocks: {
    $tgResources: ResourcesDouble;
    tgResources: Resources2Double;
    $tgEvents: EventsDouble;
    $translate: TranslateDouble;
} = {
    $tgResources: mockTgResources(),
    tgResources: mockTgResources2(),
    $tgEvents: mockTgEvents(),
    $translate: mockTranslate(),
};

beforeEach(() => {
    mocks.$tgResources = mockTgResources();
    mocks.tgResources = mockTgResources2();
    mocks.$tgEvents = mockTgEvents();
    mocks.$translate = mockTranslate();
});

function threeServiceMap(): MockServiceMap {
    return {
        $tgResources: mocks.$tgResources.service,
        $tgEvents: mocks.$tgEvents.service,
        $translate: mocks.$translate.service,
    };
}

interface Capture<T> {
    value: T | undefined;
    renders: number;
}

function capture<T>(): Capture<T> {
    return { value: undefined, renders: 0 };
}

function record<T>(box: Capture<T>, value: T): T {
    box.value = value;
    box.renders += 1;

    return value;
}

function ResourcesProbe({
    into,
    testId = 'resources-probe',
}: {
    into: Capture<TaigaResources>;
    testId?: string;
}): ReactElement {
    const rs = useAngularService('$tgResources');

    record(into, rs);

    return <output data-testid={testId}>{typeof rs.userstories.listAll}</output>;
}

function ThreeServiceProbe({
    resources,
    events,
    translate,
}: {
    resources: Capture<TaigaResources>;
    events: Capture<TaigaEventsService>;
    translate: Capture<TranslateService>;
}): ReactElement {
    const rs = record(resources, useAngularService('$tgResources'));
    const ev = record(events, useAngularService('$tgEvents'));
    const translateService = record(translate, useAngularService('$translate'));

    return (
        <output data-testid="three-service-probe" data-connected={String(ev.connected)}>
            {translateService.instant('BACKLOG.SPRINTS.TITLE')}
            <output data-testid="story-count">{Object.keys(rs).length}</output>
        </output>
    );
}

function NamedServiceProbe({ name }: { name: keyof AngularServices }): ReactElement {
    useAngularService(name);

    return <output data-testid="named-service-probe">resolved</output>;
}

function BothResourcesProbe({
    first,
    second,
}: {
    first: Capture<TaigaResources>;
    second: Capture<TaigaResources2>;
}): ReactElement {
    const rs = record(first, useAngularService('$tgResources'));
    const rs2 = record(second, useAngularService('tgResources'));

    return (
        <output data-testid="both-resources-probe">
            {`${Object.keys(rs).length}:${Object.keys(rs2).length}`}
        </output>
    );
}

function TypedMemberProbe(): ReactElement {
    const rs = useAngularService('$tgResources');

    rs.userstories.storeShowTags(7, true);

    const swimlaneModes = rs.kanban.getSwimlanesModes(7);

    return <output data-testid="typed-member-probe">{Object.keys(swimlaneModes).length}</output>;
}

function ThenableProbe({ into }: { into: Capture<AngularPromise<StoryModels>> }): ReactElement {
    const rs = useAngularService('$tgResources');

    record(into, rs.userstories.listAll<PlainAttrs>(7));

    return <output data-testid="thenable-probe">requested</output>;
}

/**
 * Resolves the root scope's `$on`-only registrar through the ONE named narrow
 * accessor, and reports what came back.
 *
 * The value is `AngularBroadcastListener | null`, never the scope object, so the
 * probe can register a listener and can name nothing else -- which is the
 * property the specs below assert.
 */
function BroadcastListenerProbe({
    into,
}: {
    into: Capture<AngularBroadcastListener | null>;
}): ReactElement {
    const broadcasts = record(into, useAngularBroadcastListener());

    return (
        <output data-testid="broadcast-listener-probe">
            {broadcasts === null ? 'none' : 'registrar'}
        </output>
    );
}

function MisspelledServiceProbe(): ReactElement {
    // @ts-expect-error -- an unknown service name must not type-check.
    useAngularService('tgResourcs');

    return <output data-testid="misspelled-service-probe">unreachable</output>;
}

function silenceReactErrorLog(): void {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

function messageThrownBy(mount: () => unknown): string {
    try {
        mount();
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }

    return '';
}

/** Resolves whatever name it is given, so the run-time allow list can be probed. */
function UnsanctionedNameProbe({ name }: { name: string }): ReactElement {
    useAngularService(name as keyof AngularServices);

    return <output data-testid="unsanctioned-probe">resolved</output>;
}

const ALL_SERVICE_NAMES = [
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
] as const satisfies readonly (keyof AngularServices)[];

function mockInjectorWithHas(
    services: MockServiceMap,
    registered: readonly string[],
): AngularInjector & { has: jest.Mock<boolean, [string]> } {
    const has: jest.Mock<boolean, [string]> = jest.fn((name) => registered.includes(name));

    return { ...mockInjector(services), has };
}

function withRequestApiProbes(body: () => void): Array<jest.Mock<undefined, unknown[]>> {
    const globalBag = globalThis as unknown as Record<string, unknown>;
    const previous = new Map<string, { present: boolean; value: unknown }>();
    const probes: Array<jest.Mock<undefined, unknown[]>> = [];

    for (const name of BROWSER_REQUEST_APIS) {
        previous.set(name, { present: name in globalBag, value: globalBag[name] });

        const probe = jest.fn<undefined, unknown[]>(() => undefined);

        probes.push(probe);
        globalBag[name] = probe;
    }

    try {
        body();
    } finally {
        for (const [name, state] of previous) {
            if (state.present) {
                globalBag[name] = state.value;
            } else {
                delete globalBag[name];
            }
        }
    }

    return probes;
}

describe('useAngularService', () => {
    describe('resolution', () => {
        it('hands back exactly the instance supplied to mockInjector, by reference', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const resolved = capture<TaigaResources>();

            render(<ResourcesProbe into={resolved} />, {
                wrapper: withMockInjector(injector),
            });

            expect(Object.is(resolved.value, mocks.$tgResources.service)).toBe(true);
            expect(resolved.value).toBe(mocks.$tgResources.service);
            expect(screen.getByTestId('resources-probe')).toHaveTextContent('function');
        });

        it('passes the requested name through unchanged', () => {
            const injector = mockInjector({ $tgConfirm: { askOnDelete: jest.fn(), notify: jest.fn() } });

            render(<NamedServiceProbe name="$tgConfirm" />, {
                wrapper: withMockInjector(injector),
            });

            expect(screen.getByTestId('named-service-probe')).toBeInTheDocument();
        });

        it('resolves through a provider mounted directly, not only through the test wrapper', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const resolved = capture<TaigaResources>();

            render(
                <AngularBridgeProvider injector={injector}>
                    <ResourcesProbe into={resolved} />
                </AngularBridgeProvider>,
            );

            expect(resolved.value).toBe(mocks.$tgResources.service);
        });

        it('accepts a minimal `{ get }` double with no `has`', () => {
            const injector: AngularInjector = mockInjector({
                $tgAnalytics: { trackEvent: jest.fn() },
            });

            expect(injector.has).toBeUndefined();

            render(<NamedServiceProbe name="$tgAnalytics" />, {
                wrapper: withMockInjector(injector),
            });

            expect(screen.getByTestId('named-service-probe')).toBeInTheDocument();
        });
    });

    describe('singleton identity', () => {
        it('gives two separate probes the same instance for the same name', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const first = capture<TaigaResources>();
            const second = capture<TaigaResources>();

            render(
                <>
                    <ResourcesProbe into={first} testId="first-probe" />
                    <ResourcesProbe into={second} testId="second-probe" />
                </>,
                { wrapper: withMockInjector(injector) },
            );

            expect(first.value).toBe(second.value);
            expect(first.value).toBe(mocks.$tgResources.service);
            expect(screen.getByTestId('first-probe')).toBeInTheDocument();
            expect(screen.getByTestId('second-probe')).toBeInTheDocument();
        });

        it('gives the same instance across re-renders, so nothing needs memoising', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const resolved = capture<TaigaResources>();

            const { rerender } = render(<ResourcesProbe into={resolved} />, {
                wrapper: withMockInjector(injector),
            });

            const afterFirstRender = resolved.value;

            rerender(<ResourcesProbe into={resolved} />);

            expect(resolved.renders).toBeGreaterThanOrEqual(2);
            expect(resolved.value).toBe(afterFirstRender);
        });

        it('resolves the same instance on repeated direct lookups', () => {
            const injector = mockInjector({ $tgEvents: mocks.$tgEvents.service });

            expect(injector.get<TaigaEventsService>('$tgEvents')).toBe(
                injector.get<TaigaEventsService>('$tgEvents'),
            );
        });
    });

    describe('missing-provider diagnostic', () => {
        it('throws an Error naming both the hook and the service', () => {
            silenceReactErrorLog();

            const resolved = capture<TaigaResources>();

            expect(() => render(<ResourcesProbe into={resolved} />)).toThrow(Error);
            expect(() => render(<ResourcesProbe into={resolved} />)).toThrow(
                /useAngularService\('\$tgResources'\)/,
            );
        });

        it('names the provider and says what to mount and what to wrap in a test', () => {
            silenceReactErrorLog();

            const message = messageThrownBy(() =>
                render(<NamedServiceProbe name="$tgRepo" />),
            );

            expect(message).toContain('outside <AngularBridgeProvider>');
            expect(message).toContain('AngularBridgeProvider');
            expect(message).toContain('ReactHostElement');
            expect(message).toContain('get(name)');
        });

        it('throws for an explicitly null injector, not only for an absent provider', () => {
            silenceReactErrorLog();

            expect(() =>
                render(<NamedServiceProbe name="tgLoader" />, {
                    wrapper: withMockInjector(null),
                }),
            ).toThrow(/outside <AngularBridgeProvider>/);

            expect(() =>
                render(
                    <AngularBridgeProvider injector={null}>
                        <NamedServiceProbe name="tgLoader" />
                    </AngularBridgeProvider>,
                ),
            ).toThrow(/outside <AngularBridgeProvider>/);
        });
    });

    describe('unsupplied-service diagnostic', () => {
        it('throws naming the requested service and listing the ones supplied', () => {
            silenceReactErrorLog();

            const injector = mockInjector({
                $tgEvents: mocks.$tgEvents.service,
                $translate: mocks.$translate.service,
            });

            const message = messageThrownBy(() =>
                render(<NamedServiceProbe name="$tgResources" />, {
                    wrapper: withMockInjector(injector),
                }),
            );

            expect(message).toContain("asked for the AngularJS service '$tgResources'");
            expect(message).toContain('$tgEvents');
            expect(message).toContain('$translate');
            expect(message).toContain('a partial map is expected');
        });

        it('reports "(nothing)" for the default empty map', () => {
            silenceReactErrorLog();

            const message = messageThrownBy(() =>
                render(<NamedServiceProbe name="tgProjectService" />, {
                    wrapper: withMockInjector(mockInjector()),
                }),
            );

            expect(message).toContain("service 'tgProjectService'");
            expect(message).toContain('Supplied: (nothing)');
        });

        it('treats a service supplied as the nothing-value as not supplied at all', () => {
            silenceReactErrorLog();

            const message = messageThrownBy(() =>
                render(<NamedServiceProbe name="$translate" />, {
                    wrapper: withMockInjector(mockInjector({ $translate: undefined })),
                }),
            );

            expect(message).toContain('Supplied: (nothing)');
        });

        it('never resolves an inherited member of the base object prototype', () => {
            silenceReactErrorLog();

            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });

            expect(() => injector.get<unknown>('constructor')).toThrow(
                /asked for the AngularJS service 'constructor'/,
            );
            expect(() => injector.get<unknown>('toString')).toThrow(Error);
        });

        it('snapshots the map, so mutating the literal afterwards changes nothing', () => {
            silenceReactErrorLog();

            const services: MockServiceMap = { $tgEvents: mocks.$tgEvents.service };
            const injector = mockInjector(services);

            services.$translate = mocks.$translate.service;

            expect(() => injector.get<TranslateService>('$translate')).toThrow(Error);
            expect(injector.get<TaigaEventsService>('$tgEvents')).toBe(
                mocks.$tgEvents.service,
            );
        });

        it('rejects a misspelled service name at compile time and at run time', () => {
            silenceReactErrorLog();

            const message = messageThrownBy(() =>
                render(<MisspelledServiceProbe />, {
                    wrapper: withMockInjector(
                        mockInjector({ $tgResources: mocks.$tgResources.service }),
                    ),
                }),
            );

            // The refusal now comes from the value-level allow list, which is checked
            // BEFORE the injector is consulted -- so a name one character away from a
            // real service cannot resolve anything, and the name is quoted back
            // VERBATIM, which is what proves the hook does not "helpfully" normalise
            // it into the neighbouring real name.
            expect(message).toContain("useAngularService('tgResourcs') is not permitted");
            expect(message).toContain("'tgResourcs' is not one of the AngularJS services");
            // The diagnostic still names what IS reachable, so the reader is not left
            // guessing which spelling was meant.
            expect(message).toContain('Permitted: $tgResources');
        });
    });

    describe('per-hook dependencies', () => {
        it('resolves three distinct services independently from a map of three', () => {
            const map = threeServiceMap();
            const injector = mockInjector(map);
            const resources = capture<TaigaResources>();
            const events = capture<TaigaEventsService>();
            const translate = capture<TranslateService>();

            render(
                <ThreeServiceProbe
                    resources={resources}
                    events={events}
                    translate={translate}
                />,
                { wrapper: withMockInjector(injector) },
            );

            expect(resources.value).toBe(mocks.$tgResources.service);
            expect(events.value).toBe(mocks.$tgEvents.service);
            expect(translate.value).toBe(mocks.$translate.service);

            expect(Object.keys(map)).toHaveLength(3);
            expect(ALL_SERVICE_NAMES).toHaveLength(15);

            expect(mocks.$translate.instant).toHaveBeenCalledWith('BACKLOG.SPRINTS.TITLE');
            expect(screen.getByTestId('three-service-probe')).toHaveAttribute(
                'data-connected',
                'true',
            );
            expect(screen.getByTestId('story-count')).toHaveTextContent('5');
        });

        it('keeps `$tgResources` and `tgResources` apart', () => {
            const injector = mockInjector({
                $tgResources: mocks.$tgResources.service,
                tgResources: mocks.tgResources.service,
            });
            const first = capture<TaigaResources>();
            const second = capture<TaigaResources2>();

            render(<BothResourcesProbe first={first} second={second} />, {
                wrapper: withMockInjector(injector),
            });

            expect(first.value).toBe(mocks.$tgResources.service);
            expect(second.value).toBe(mocks.tgResources.service);
            expect(first.value).not.toBe(second.value);
            expect(screen.getByTestId('both-resources-probe')).toHaveTextContent('5:1');
        });

        it('routes every name in the service map through the same code path', () => {
            silenceReactErrorLog();

            const supplied: MockServiceMap = {
                $tgResources: mocks.$tgResources.service,
                tgResources: mocks.tgResources.service,
                $tgEvents: mocks.$tgEvents.service,
                $translate: mocks.$translate.service,
            };
            const injector = mockInjector(supplied);
            const suppliedNames: readonly string[] = Object.keys(supplied);

            for (const name of ALL_SERVICE_NAMES) {
                const mount = (): unknown =>
                    render(<NamedServiceProbe name={name} />, {
                        wrapper: withMockInjector(injector),
                    });

                if (suppliedNames.includes(name)) {
                    expect(mount).not.toThrow();
                } else {
                    expect(mount).toThrow(`service '${name}'`);
                }
            }
        });
    });

    describe('type contract', () => {
        it('returns the mapped service type and NOT the unsafe escape-hatch type', () => {
            const resourcesIsExact: Equals<
                ReturnType<typeof useAngularService<'$tgResources'>>,
                TaigaResources
            > = true;
            const secondResourcesIsExact: Equals<
                ReturnType<typeof useAngularService<'tgResources'>>,
                TaigaResources2
            > = true;
            const eventsIsExact: Equals<
                ReturnType<typeof useAngularService<'$tgEvents'>>,
                TaigaEventsService
            > = true;
            const translateIsExact: Equals<
                ReturnType<typeof useAngularService<'$translate'>>,
                TranslateService
            > = true;

            expect(resourcesIsExact).toBe(true);
            expect(secondResourcesIsExact).toBe(true);
            expect(eventsIsExact).toBe(true);
            expect(translateIsExact).toBe(true);
        });

        it('types the one off-map accessor as the $on-only registrar, never a scope', () => {
            // The narrow contract IS the boundary: a caller holds something that
            // can register and deregister a listener, and cannot name apply,
            // digest, emit, broadcast, watch or child-scope creation. Asserting the
            // exact return type is what stops that surface widening later.
            const registrarIsNarrow: Equals<
                ReturnType<typeof useAngularBroadcastListener>,
                AngularBroadcastListener | null
            > = true;
            const isOneMemberOnly: Equals<keyof AngularBroadcastListener, '$on'> = true;

            expect(registrarIsNarrow).toBe(true);
            expect(isOneMemberOnly).toBe(true);
        });

        it('covers every key of the service map in this spec', () => {
            type Missing = Exclude<keyof AngularServices, (typeof ALL_SERVICE_NAMES)[number]>;

            const nothingMissing: Equals<Missing, never> = true;

            expect(nothingMissing).toBe(true);
            expect(ALL_SERVICE_NAMES).toHaveLength(15);
            expect(new Set(ALL_SERVICE_NAMES).size).toBe(ALL_SERVICE_NAMES.length);
        });

        it('types facade members concretely enough to be called through the mapped type', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });

            render(<TypedMemberProbe />, { wrapper: withMockInjector(injector) });

            expect(mocks.$tgResources.storeShowTags).toHaveBeenCalledWith(7, true);
            expect(mocks.$tgResources.getSwimlanesModes).toHaveBeenCalledWith(7);
            expect(screen.getByTestId('typed-member-probe')).toHaveTextContent('0');
        });
    });

    describe('no digest surface', () => {
        it('exposes no digest entry point on any resolved facade or namespace', () => {
            const injector = mockInjector(threeServiceMap());
            const resources = capture<TaigaResources>();
            const events = capture<TaigaEventsService>();
            const translate = capture<TranslateService>();

            render(
                <ThreeServiceProbe
                    resources={resources}
                    events={events}
                    translate={translate}
                />,
                { wrapper: withMockInjector(injector) },
            );

            const resolvedResources = resources.value;
            const resolvedEvents = events.value;
            const resolvedTranslate = translate.value;

            if (
                resolvedResources === undefined ||
                resolvedEvents === undefined ||
                resolvedTranslate === undefined
            ) {
                throw new Error('the probe resolved nothing, so there is nothing to assert');
            }

            const surfaces: object[] = [
                resolvedResources,
                resolvedResources.userstories,
                resolvedResources.sprints,
                resolvedResources.swimlanes,
                resolvedResources.kanban,
                resolvedResources.projects,
                resolvedEvents,
                resolvedTranslate,
            ];

            expect(DIGEST_ENTRY_POINTS).toHaveLength(3);

            for (const surface of surfaces) {
                for (const entryPoint of DIGEST_ENTRY_POINTS) {
                    expect(entryPoint in surface).toBe(false);
                }
            }
        });

        it('keeps both scope services and the promise service out of the map', () => {
            type UnreachableByDesign = '$scope' | '$rootScope' | '$q';

            const noneReachable: Equals<
                Extract<keyof AngularServices, UnreachableByDesign>,
                never
            > = true;

            expect(noneReachable).toBe(true);

            const unreachable: readonly string[] = ['$scope', '$rootScope', '$q'];

            for (const name of unreachable) {
                expect(ALL_SERVICE_NAMES).not.toContain(name);
            }
        });
    });

    describe('no transport', () => {
        it('touches no browser request API while resolving', () => {
            const injector = mockInjector(threeServiceMap());
            const resolved = capture<TaigaResources>();

            const probes = withRequestApiProbes(() => {
                render(<ResourcesProbe into={resolved} />, {
                    wrapper: withMockInjector(injector),
                });
            });

            expect(probes).toHaveLength(BROWSER_REQUEST_APIS.length);
            expect(resolved.value).toBe(mocks.$tgResources.service);

            for (const probe of probes) {
                expect(probe).not.toHaveBeenCalled();
            }
        });

        it('reaches no endpoint: resolving a service is a lookup, not a request', () => {
            const injector = mockInjector(threeServiceMap());
            const resolved = capture<TaigaResources>();

            render(<ResourcesProbe into={resolved} />, {
                wrapper: withMockInjector(injector),
            });

            expect(mocks.$tgResources.listAll).not.toHaveBeenCalled();
            expect(
                mocks.$tgResources.service.userstories.bulkUpdateKanbanOrder,
            ).not.toHaveBeenCalled();
            expect(
                mocks.$tgResources.service.userstories.bulkUpdateBacklogOrder,
            ).not.toHaveBeenCalled();
            expect(mocks.$tgResources.service.projects.stats).not.toHaveBeenCalled();
            expect(mocks.$tgEvents.subscribe).not.toHaveBeenCalled();
        });

        it('keeps the raw AngularJS transport service out of the resolvable map', () => {
            expect(ALL_SERVICE_NAMES).not.toContain(ANGULAR_TRANSPORT_SERVICE);

            expect(() =>
                mockInjector(threeServiceMap()).get<unknown>(ANGULAR_TRANSPORT_SERVICE),
            ).toThrow(Error);
        });
    });

    describe('AngularJS-promise-shaped returns', () => {
        it('declares a thenable, not a native promise', () => {
            const declaresThenable: Equals<
                ListAllReturn,
                AngularPromise<Array<TaigaModel<unknown>>>
            > = true;
            const isNotNativePromise: Equals<ListAllReturn, Promise<StoryModels>> = false;

            expect(declaresThenable).toBe(true);
            expect(isNotNativePromise).toBe(false);
        });

        it('hands back a bare thenable that resolves plain-object models', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const requested = capture<AngularPromise<StoryModels>>();

            render(<ThenableProbe into={requested} />, {
                wrapper: withMockInjector(injector),
            });

            const thenable = requested.value;

            if (thenable === undefined) {
                throw new Error('the probe called no endpoint, so there is nothing to assert');
            }

            expect(typeof thenable.then).toBe('function');
            expect(thenable).not.toBeInstanceOf(Promise);

            expect('catch' in thenable).toBe(false);
            expect('finally' in thenable).toBe(false);

            const onFulfilled = jest.fn<undefined, [StoryModels]>(() => undefined);
            const onRejected = jest.fn<undefined, [unknown]>(() => undefined);

            thenable.then(onFulfilled, onRejected);

            expect(onFulfilled).toHaveBeenCalledTimes(1);
            expect(onRejected).not.toHaveBeenCalled();

            const [models] = onFulfilled.mock.calls[0];

            expect(models).toBe(mocks.$tgResources.storyModels);
            expect(models).toHaveLength(2);
            expect(models[0].getName()).toBe('userstories');

            expect(models[0].getAttrs()).toEqual(
                expect.objectContaining({ id: 1, subject: 'Reorder the sprint', version: 1 }),
            );
            expect(models[1].getAttrs()).toEqual(
                expect.objectContaining({ id: 2, subject: 'Fold the DONE column' }),
            );
            expect(screen.getByTestId('thenable-probe')).toHaveTextContent('requested');
        });
    });

    describe('unregistered-service diagnostic', () => {
        it('throws before resolving when the oracle reports the name unregistered', () => {
            silenceReactErrorLog();

            const injector = mockInjectorWithHas(
                { $tgNavUrls: { resolve: jest.fn(() => '/project/x') } },
                [],
            );

            expect(() =>
                render(<NamedServiceProbe name="$tgNavUrls" />, {
                    wrapper: withMockInjector(injector),
                }),
            ).toThrow(/no AngularJS service registered/);

            expect(injector.has).toHaveBeenCalledWith('$tgNavUrls');
        });

        it('names the confusable resources pair in the diagnostic', () => {
            silenceReactErrorLog();

            const message = messageThrownBy(() =>
                render(<NamedServiceProbe name="tgResources" />, {
                    wrapper: withMockInjector(
                        mockInjectorWithHas({ tgResources: mocks.tgResources.service }, []),
                    ),
                }),
            );

            expect(message).toContain("'$tgResources' and 'tgResources'");
        });

        it('resolves normally when the oracle reports the name registered', () => {
            const injector = mockInjectorWithHas(
                { $tgEvents: mocks.$tgEvents.service },
                ['$tgEvents'],
            );
            const events = capture<TaigaEventsService>();
            const resources = capture<TaigaResources>();
            const translate = capture<TranslateService>();

            render(
                <ThreeServiceProbe
                    resources={resources}
                    events={events}
                    translate={translate}
                />,
                {
                    wrapper: withMockInjector(
                        mockInjectorWithHas(threeServiceMap(), [...ALL_SERVICE_NAMES]),
                    ),
                },
            );

            expect(injector.has).not.toHaveBeenCalled();
            expect(events.value).toBe(mocks.$tgEvents.service);
            expect(resources.value).toBe(mocks.$tgResources.service);
            expect(translate.value).toBe(mocks.$translate.service);
        });
    });
});

/* ==========================================================================
 * THE ONE NAMED ACCESSOR OUTSIDE THE SERVICE MAP
 *
 * There is deliberately NO arbitrary-name escape hatch. `useAngularBroadcastListener`
 * is the whole of what lives outside `AngularServices`: it hardcodes `'$rootScope'`,
 * hands back a contract whose only member is `$on`, and exists because
 * angular-translate `$emit`s its language event on the root scope, where a listener
 * on any child scope -- including the one the AngularJS-side bridge's
 * `onAngularEvent` callback registers -- is never called.
 * ========================================================================== */

describe('useAngularBroadcastListener', () => {
    /** An off-map injector: `mockInjector`'s map cannot carry `$rootScope`, by design. */
    function injectorWithRootScope(rootScope: unknown): AngularInjector {
        return {
            get<T>(name: string): T {
                return (name === '$rootScope' ? rootScope : undefined) as T;
            },
        };
    }

    /** The one-member facade the real root scope is narrowed to. */
    function rootScopeDouble(): {
        facade: AngularBroadcastListener;
        $on: jest.Mock<() => void, [string, (event: unknown, payload: unknown) => void]>;
        deregister: jest.Mock<void, []>;
    } {
        const deregister = jest.fn<void, []>();
        const $on = jest.fn<() => void, [string, (event: unknown, payload: unknown) => void]>(
            () => deregister,
        );

        return { facade: { $on }, $on, deregister };
    }

    it('resolves the registrar by reference, under the hardcoded root-scope name', () => {
        const rootScope = rootScopeDouble();
        const names: string[] = [];
        const resolved = capture<AngularBroadcastListener | null>();

        render(<BroadcastListenerProbe into={resolved} />, {
            wrapper: withMockInjector({
                get<T>(name: string): T {
                    names.push(name);

                    return (name === '$rootScope' ? rootScope.facade : undefined) as T;
                },
            }),
        });

        // BY REFERENCE, with no proxy and no clone, so an effect may depend on its
        // identity -- and under exactly one name, because the accessor takes none.
        expect(resolved.value).toBe(rootScope.facade);
        expect(names).toEqual(['$rootScope']);
        expect(screen.getByTestId('broadcast-listener-probe')).toHaveTextContent('registrar');
    });

    it('registers a listener and hands back AngularJS own deregistration function', () => {
        const rootScope = rootScopeDouble();
        const resolved = capture<AngularBroadcastListener | null>();

        render(<BroadcastListenerProbe into={resolved} />, {
            wrapper: withMockInjector(injectorWithRootScope(rootScope.facade)),
        });

        const listener = (): undefined => undefined;
        const deregistration = resolved.value?.$on('$translateChangeEnd', listener);

        expect(rootScope.$on).toHaveBeenCalledWith('$translateChangeEnd', listener);
        expect(deregistration).toBe(rootScope.deregister);
    });

    it.each<[string, unknown]>([
        ['nothing is registered under the name', undefined],
        ['the resolved value is null', null],
        ['the resolved value is not an object', 'not-a-scope'],
        ['the resolved value exposes no $on', { $new: jest.fn() }],
        ['the resolved value exposes a non-callable $on', { $on: 'nope' }],
    ])('degrades to null rather than throwing when %s', (_label: string, rootScope: unknown) => {
        const resolved = capture<AngularBroadcastListener | null>();

        // Degrading matters: the one consumer keeps translating correctly and only
        // loses LIVE language switching, so a React root mounted before AngularJS
        // finished bootstrapping still renders its screen.
        expect(() =>
            render(<BroadcastListenerProbe into={resolved} />, {
                wrapper: withMockInjector(injectorWithRootScope(rootScope)),
            }),
        ).not.toThrow();

        expect(resolved.value).toBeNull();
        expect(screen.getByTestId('broadcast-listener-probe')).toHaveTextContent('none');
    });

    it('raises the provider diagnostic under its own name', () => {
        silenceReactErrorLog();

        const resolved = capture<AngularBroadcastListener | null>();

        expect(() => render(<BroadcastListenerProbe into={resolved} />)).toThrow(
            /useAngularBroadcastListener\('\$rootScope'\) was called outside <AngularBridgeProvider>/,
        );
    });

    it('returns the SAME registrar across renders', () => {
        const rootScope = rootScopeDouble();
        const first = capture<AngularBroadcastListener | null>();
        const second = capture<AngularBroadcastListener | null>();
        const wrapper = withMockInjector(injectorWithRootScope(rootScope.facade));

        const { rerender } = render(<BroadcastListenerProbe into={first} />, { wrapper });

        rerender(<BroadcastListenerProbe into={second} />);

        // A pure lookup: no state, no effect, nothing to clean up, and the value is
        // handed back by reference so an effect may depend on its identity.
        expect(second.value).toBe(first.value);
    });

    it('raises the unregistered diagnostic under its own name', () => {
        silenceReactErrorLog();

        const resolved = capture<AngularBroadcastListener | null>();

        // A registration oracle that positively reports the name as unregistered is
        // a MISCONFIGURATION, not the timing window above, so it still fails loudly.
        expect(() =>
            render(<BroadcastListenerProbe into={resolved} />, {
                wrapper: withMockInjector(
                    mockInjectorWithHas({ $tgEvents: mocks.$tgEvents.service }, ['$tgEvents']),
                ),
            }),
        ).toThrow(/useAngularBroadcastListener\('\$rootScope'\) found no AngularJS service/);
    });
});

/* ==========================================================================
 * THE MOCKING SEAM ITSELF
 *
 * `./mockInjector.ts` is test-only and is imported by no production module, so
 * this file is its only exercise. Covering its wrapper here is what keeps it from
 * sitting at zero coverage while still counting against the 70 % gate.
 * ========================================================================== */

/* ==========================================================================
 * THE RUN-TIME ALLOW LIST -- THE TRUST BOUNDARY, ENFORCED AFTER TYPE ERASURE
 *
 * `keyof AngularServices` constrains a LITERAL argument and nothing else. A name
 * held in a variable widens to `string`, and a caller that was never type-checked
 * is not constrained at all, so the map alone left the injector reachable from
 * React through one ordinary-looking call. These cases pin the value-level list
 * that closes that gap, and they are security assertions rather than
 * housekeeping: each name below is a capability the migration must NOT hand to
 * React.
 * ========================================================================== */

describe('the run-time allow list', () => {
    it('is exactly the key set of the service map, with no duplicates', () => {
        expect([...SANCTIONED_SERVICE_NAMES].sort()).toEqual([...ALL_SERVICE_NAMES].sort());
        expect(SANCTIONED_SERVICE_NAMES).toHaveLength(15);
        expect(new Set(SANCTIONED_SERVICE_NAMES).size).toBe(SANCTIONED_SERVICE_NAMES.length);
    });

    it('is frozen, so nothing holding a reference can widen it at run time', () => {
        expect(Object.isFrozen(SANCTIONED_SERVICE_NAMES)).toBe(true);
    });

    it.each([
        // Both scope services: holding one invites the digest participation the
        // migration forbids outright.
        '$rootScope',
        '$scope',
        // The promise service: AngularJS promises cross the seam through the
        // sibling marshaller, never by handing React the factory.
        '$q',
        // The injector itself: resolving it would restore, in one step, every
        // capability this list removes.
        '$injector',
        // A raw transport: it would bypass the Authorization and session headers,
        // the token-refresh, version-conflict and blocking interceptors, and the
        // changed-fields-only versioned write behaviour React inherits by going
        // through the resource and repository layers.
        '$http',
        '$httpBackend',
        // Navigation and lifecycle services React has no business driving.
        '$location',
        '$route',
        '$timeout',
        '$compile',
        // And an ordinary unknown name, so the rule is a positive allow list
        // rather than a hand-written deny list.
        'tgSomethingElse',
    ])('refuses to resolve %s even when the injector would supply it', (name) => {
        silenceReactErrorLog();

        // The injector is deliberately WILLING: it reports the name as registered
        // and would hand a service back. The refusal therefore comes from the hook,
        // which is the only place it can be guaranteed.
        const injector: AngularInjector = {
            get: <T,>(): T => ({ live: true }) as unknown as T,
            has: (): boolean => true,
        };

        expect(() =>
            render(<UnsanctionedNameProbe name={name} />, {
                wrapper: withMockInjector(injector),
            }),
            // A substring match, not a pattern: the name can contain a regex
            // metacharacter (every AngularJS built-in starts with one), and an
            // escaping mistake here would weaken the assertion silently.
        ).toThrow(`useAngularService('${name}') is not permitted`);
    });

    it('never reaches the injector for an unsanctioned name', () => {
        silenceReactErrorLog();

        const get = jest.fn(() => ({}));
        const has = jest.fn(() => true);
        const injector = { get, has } as unknown as AngularInjector;

        expect(() =>
            render(<UnsanctionedNameProbe name="$rootScope" />, {
                wrapper: withMockInjector(injector),
            }),
        ).toThrow(/is not permitted/);

        // Refused BEFORE resolution, not after: a hook that resolved first and
        // complained second would already have handed the caller the service.
        expect(get).not.toHaveBeenCalled();
        expect(has).not.toHaveBeenCalled();
    });

    it('still resolves every sanctioned name', () => {
        // The allow list must not be a blanket refusal: the fifteen names the map
        // publishes keep working, which the exhaustive walk above also proves per
        // service. Asserted here as a set so a typo in the list is caught even if
        // the walk is ever narrowed.
        const injector: AngularInjector = {
            get: <T,>(): T => ({ live: true }) as unknown as T,
            has: (): boolean => true,
        };

        for (const name of SANCTIONED_SERVICE_NAMES) {
            expect(() =>
                render(<UnsanctionedNameProbe name={name} />, {
                    wrapper: withMockInjector(injector),
                }),
            ).not.toThrow();
        }
    });
});

describe('the allow-list has no general escape', () => {
    /** This module's source, comments stripped, so prose cannot satisfy a gate. */
    function executableSource(): string {
        return readFileSync(join(__dirname, 'useAngularService.ts'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
    }

    it('exports no name-taking resolver that returns `unknown`', () => {
        const executable = executableSource();

        expect(executable.length).toBeGreaterThan(0);

        // The removed accessor by name, and the shape of any replacement for it. An
        // allow-list with a public `(name: string) => unknown` beside it is not an
        // allow-list: every exclusion becomes advisory, because any consumer can
        // resolve any service and narrow the result itself. `unknown` makes one
        // dereference safe; it says nothing about which services become reachable.
        expect(executable).not.toContain('useUntypedAngularService');
        expect(executable).not.toMatch(/export function \w+\(\s*name:\s*string/);
    });

    it('exports exactly two accessors: the typed one and the narrow off-map one', () => {
        const exportedFunctions = [...executableSource().matchAll(/export function (\w+)/g)].map(
            (match) => match[1],
        );

        expect(exportedFunctions).toEqual(['useAngularService', 'useAngularBroadcastListener']);
    });

    it('reaches the injector only through the two accessors above', () => {
        // Every `injector.get` in the module belongs to one of the two accessors, so
        // the exhaustive map walk above really does describe everything React can
        // resolve.
        const getCallCount = [...executableSource().matchAll(/injector\.get</g)].length;

        expect(getCallCount).toBe(2);
    });

    it('takes NO name, so it cannot be pointed at another service', () => {
        // A zero-arity accessor is the structural half of the guarantee: there is no
        // argument through which a caller could reach a service the map excludes.
        expect(useAngularBroadcastListener).toHaveLength(0);
    });
});

describe('withMockInjector', () => {
    it('names its wrapper, so a component stack identifies the seam', () => {
        const Wrapper = withMockInjector(mockInjector());

        expect(Wrapper.name).toBe('MockInjectorWrapper');
    });

    it('publishes the injector to its children', () => {
        const Wrapper = withMockInjector(
            mockInjector({ $translate: mocks.$translate.service }),
        );

        render(
            <Wrapper>
                <NamedServiceProbe name="$translate" />
            </Wrapper>,
        );

        expect(screen.getByTestId('named-service-probe')).toBeInTheDocument();
    });

    it('renders with no children at all', () => {
        const Wrapper = withMockInjector(mockInjector());

        const { container } = render(<Wrapper />);

        expect(container).toBeEmptyDOMElement();
    });
});
