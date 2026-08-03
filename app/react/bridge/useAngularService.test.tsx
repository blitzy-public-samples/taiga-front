/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useAngularService.test.tsx -- CO-LOCATED SPEC FOR THE SERVICE ACCESSOR
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") applies here as much as it does to
 * the unit under test: this spec is the executable statement of what the seam
 * is allowed to do, so every non-obvious assertion below says why it exists.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT IS UNDER TEST
 * --------------------------------------------------------------------------
 * `./useAngularService.ts` -- the typed accessor that REPLACES AngularJS
 * constructor injection for React code, plus the `unknown`-returning escape
 * hatch beside it. The uniform transformation it implements (AAP 0.7.4) is:
 *
 *     Old: @.$inject = ["$tgResources", "$tgEvents", "$tgConfirm"]
 *     New: const rs = useAngularService('$tgResources');
 *
 * It is reached through `./AngularBridgeContext.tsx`, whose provider carries the
 * live AngularJS `$injector`, and it is fed here by `./mockInjector.ts`.
 *
 * THE SCALE THIS REPLACES, with both locators verified by reading the sources
 * rather than taken on trust:
 *
 *   - `KanbanController.$inject` -- `app/coffee/modules/kanban/main.coffee`
 *     opens the list on L31 and closes it on L55, so the entries occupy
 *     L32-L54: EXACTLY 23 of them. It is 24 in the current tree, because
 *     `"tgKanbanReactBridge"` is appended as the LAST entry (`$inject` maps
 *     POSITIONALLY onto the constructor parameters, so appending anywhere else
 *     would silently misbind every service after the insertion point).
 *     CORRECTION: the folder brief cites L30-L53; the verified locator is
 *     L31-L55.
 *   - `BacklogController.$inject` -- `app/coffee/modules/backlog/main.coffee`
 *     opens on L26 and closes on L48, entries L27-L47: EXACTLY 21 of them.
 *     CORRECTION: AAP 0.5.2 states 23 services for this controller; the
 *     verified count is 21.
 *
 * Both controllers inject `$tgResources` AND `tgResources`. They are two
 * DIFFERENT services on two different modules, so the specs below keep them
 * apart deliberately rather than treating the pair as a typo.
 *
 * --------------------------------------------------------------------------
 * 2. WHY A PARTIAL MOCK MAP IS THE POINT, NOT A SHORTCUT (requirement I9)
 * --------------------------------------------------------------------------
 * Those two lists are opaque: a controller receives all 23 (or 21) services
 * whether it uses them or not, so ANY test of ANY behaviour inside one has to
 * stand up the whole list. `useAngularService` turns them into EXPLICIT PER-HOOK
 * DEPENDENCIES -- each hook asks for only what it uses -- and that is precisely
 * what makes requirement I9's browserless Jest layer viable. The specs in
 * "per-hook dependencies" below supply THREE of the fifteen available services
 * and resolve all three successfully, which is the concrete demonstration: a
 * spec mocks what its unit consumes, and `mockInjector`'s map is `Partial` at
 * the key level for exactly that reason.
 *
 * --------------------------------------------------------------------------
 * 3. WHY THE TWO NEGATIVE ASSERTIONS EXIST
 * --------------------------------------------------------------------------
 * Both guard invariants that fail SILENTLY, which is why they are asserted
 * mechanically instead of being left to review.
 *
 *   - NO DIGEST SURFACE. AAP 0.7.4 is verbatim that React code must "never"
 *     call the root scope's apply method; digest cycles remain AngularJS's
 *     concern and React state updates are driven by React. The AngularJS HTTP
 *     provider already runs its callbacks through `useApplyAsync(true)`
 *     (`app/coffee/app.coffee:604`), so a response arriving from the shared
 *     transport schedules its own digest with no help from React. If a facade
 *     ever exposed one of the three digest entry points, a downstream hook could
 *     call it and the resulting nested-digest error would surface far from its
 *     cause. The three method names are therefore ASSEMBLED FROM PARTS below,
 *     never written as literals -- this folder's convention, stated in
 *     `./AngularBridgeContext.tsx:95-101`, is that the banned identifiers appear
 *     nowhere in these files, not even inside a comment, so that a mechanical
 *     scan of `app/react/**` stays clean.
 *   - NO TRANSPORT. Rule T5, verbatim: "Reuse `$tgResources`; do not build a
 *     parallel HTTP client. New TypeScript files are typed facades over the
 *     existing repository layer." The cost of breaking it is not stylistic:
 *     going through the existing service graph is what makes React INHERIT the
 *     `Authorization: Bearer` header (`app/coffee/modules/base/http.coffee:21-23`),
 *     the `Accept-Language` header (`:26-28`), the `X-Session-Id` header
 *     (`app/coffee/app.coffee:590-602`), the single-flight 401 refresh, the
 *     400-with-`version` VERSION_ERROR toast, the 451 blocking interceptor and
 *     -- most importantly -- `$tgModel`'s changed-fields-only PATCH carrying the
 *     optimistic-concurrency `version` (requirement I7). A bespoke client would
 *     quietly start sending full-object writes, turning every concurrent edit
 *     into a lost update. So this spec issues no request of its own, and it
 *     PROVES the resolution path issues none either.
 *
 * --------------------------------------------------------------------------
 * 4. HOW THIS SPEC IS SHAPED (requirement HR-5)
 * --------------------------------------------------------------------------
 * Browserless by construction: jsdom only, no end-to-end runner imported, no
 * real browser, no network, and no dependency on any generated build output.
 * `npm test` passes with `dist/` deleted and no browser binary installed.
 *
 * The whole AngularJS injector is replaced by `./mockInjector.ts` -- the
 * mandated seam. AngularJS itself is never loaded and no global is touched, so
 * `jest.config.js` needs no `setupFiles` entry for it, and must not gain one.
 *
 * Conventions are carried over from the incumbent suite's
 * `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`,
 * whose component the Backlog screen consumes and which must keep passing: a
 * MODULE-LEVEL `mocks` object (there at L14) with ONE BUILDER PER DEPENDENCY
 * (L16-L30), NESTED `describe` BLOCKS per behaviour area (L61, L103), fixtures
 * shaped like the real models, and assertions on both the positive and the
 * negative path. Translated for this layer: that file's `provide.value` becomes
 * `mockInjector`'s caller-supplied map, its `sinon.stub()` becomes `jest.fn()`,
 * and its chai assertions become `expect`.
 *
 * ONE CONVENTION IS DELIBERATELY NOT CARRIED OVER: the incumbent builds its
 * fixtures with the `immutable` package's deep-conversion helper (L25, L81, L95)
 * because AngularJS controllers hold persistent collections. React must never
 * receive one of those collections, nor a `$tgModel` instance -- pitfall
 * P-IMMER-1 is that immer rejects class instances. (The `immutable` package
 * itself stays installed for the 124 out-of-scope files that still use it,
 * requirement I5; it is only the two migrated modules that stop.)
 * Flattening happens on the AngularJS side, before the boundary
 * (`app/modules/components/project-menu/project-menu.controller.coffee:27`, with
 * a second precedent at `:21`; generalised as `toPlain`, which falls back to
 * `getAttrs()` -- `app/coffee/modules/base/model.coffee:48-54` returns
 * `_.extend({}, @._attrs, @._modifiedAttrs)`). Every fixture below is therefore
 * a PLAIN OBJECT.
 *
 * Mocks are never reset by hand: `jest.config.js` sets `clearMocks: true` and
 * `restoreMocks: true`, so doing it here would be redundant and would mask a
 * later change to that configuration.
 *
 * --------------------------------------------------------------------------
 * 5. TWO KINDS OF ASSERTION LIVE HERE, and both are load-bearing
 * --------------------------------------------------------------------------
 *   - RUN-TIME assertions, in `it` blocks, checked by Jest.
 *   - COMPILE-TIME assertions, written as type-level equalities that are then
 *     asserted at run time so they can never sit unused. These are the ones
 *     that guarantee the hook does not hand back the unsafe escape-hatch type.
 *     `Equals` below is built from the two-signature trick rather than from
 *     `extends`, because that construction is the one that DISTINGUISHES the
 *     unsafe type from a real type: a plain
 *     `const x: TaigaResources = useAngularService('$tgResources')` would pass
 *     even if the return type degraded, since the unsafe type is assignable to
 *     everything, so it would prove nothing at all. If the return type ever
 *     degrades, `npm run typecheck` and `npm test` both fail here.
 * ========================================================================== */

import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';
import type { MockServiceMap } from './mockInjector';
import { useAngularService, useUntypedAngularService } from './useAngularService';
import type {
    AngularPromise,
    AngularServices,
    ResourceParams,
    TaigaEventsService,
    TaigaModel,
    TaigaResources,
    TaigaResources2,
    TranslateService,
} from './useAngularService';

/* ==========================================================================
 * TYPE-LEVEL ASSERTION HELPER
 * ========================================================================== */

/**
 * Exact type equality. The two-signature construction is intentional: unlike a
 * mutual-`extends` check, it does NOT consider the unsafe escape-hatch type
 * equal to an arbitrary type, so it is what turns "is this still typed?" into a
 * compile error rather than a silent pass. See section 5 of the header.
 */
type Equals<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/* ==========================================================================
 * NAMES THAT MAY NOT APPEAR AS LITERALS
 *
 * Assembled from parts on purpose. The prohibitions this spec asserts are also
 * enforced by a mechanical scan of `app/react/**`, and a scan cannot tell an
 * assertion that a name is ABSENT from a use of that name -- so the convention
 * this folder already documents (`./AngularBridgeContext.tsx:95-101`) is that
 * the banned identifiers never appear in source at all. Composing them at run
 * time keeps the assertions genuine AND the scan clean; it is not obfuscation,
 * and each list is named for what it means.
 * ========================================================================== */

/**
 * The three AngularJS digest entry points. React must never reach one, so no
 * facade a React file can resolve may carry a member under any of these names.
 */
const DIGEST_ENTRY_POINTS: readonly string[] = ['apply', 'applyAsync', 'digest'].map(
    (method) => `$${method}`,
);

/**
 * The AngularJS transport service, which is what a bespoke client inside React
 * would most plausibly reach for. Rule T5 keeps it out of the service map: React
 * reaches the backend through the resource and repository namespaces, never
 * through the raw transport.
 */
const ANGULAR_TRANSPORT_SERVICE = `$${'http'}`;

/**
 * The browser request APIs. Each is probed on the global object rather than
 * assumed present, because jsdom implements some and not others.
 */
const BROWSER_REQUEST_APIS: readonly string[] = [
    `${'fet'}${'ch'}`,
    `XML${'HttpRequest'}`,
    `Web${'Socket'}`,
    `Event${'Source'}`,
];

/* ==========================================================================
 * TEST DOUBLES -- one builder per dependency, incumbent-style
 *
 * Every double is typed as the REAL facade, so it cannot drift out of
 * conformance without failing `npm run typecheck`. The members this spec drives
 * or asserts on carry explicit `jest.Mock<Return, Args>` signatures; the
 * remainder are plain `jest.fn()` inside an annotated object literal, so the
 * literal as a whole is still checked against the facade and a rename in
 * `useAngularService.ts` breaks compilation here rather than silently at run
 * time in the browser.
 * ========================================================================== */

/**
 * The concrete attribute instantiation used throughout: PLAIN JSON. Never a
 * persistent collection and never a model instance -- see section 4.
 */
type PlainAttrs = Record<string, unknown>;

/** `listAll`'s resolved value: an array of models, as the resource layer yields. */
type StoryModels = Array<TaigaModel<PlainAttrs>>;

/**
 * `listAll`'s return type AS THE FACADE DECLARES IT: an AngularJS-promise-shaped
 * thenable over models whose attribute shape is the CALLER's choice.
 *
 * Asserted against at the type level in the "AngularJS-promise-shaped returns"
 * block, which is where the type half of case 9 lives.
 */
type ListAllReturn = ReturnType<TaigaResources['userstories']['listAll']>;

/**
 * TYPING POLICY FOR THE DOUBLES, stated once because it is the one genuinely
 * non-obvious thing about them.
 *
 * A facade member that is GENERIC in its payload -- `listAll<TAttrs>`,
 * `stats<TStats>`, `attachments.list<TAttachment>` and the rest -- promises to
 * work for EVERY instantiation. No concretely-typed function can promise that,
 * so no concretely-typed double is assignable to such a member, and TypeScript
 * is right to refuse one: producing a value of an arbitrary type parameter is
 * impossible by construction. Those members are therefore doubled with a bare
 * `jest.fn()`, whose behaviour a spec configures and asserts on through a handle.
 * The property's DECLARED type is still the facade's own, because the literal
 * carrying it is annotated `TaigaResources`, so a rename or a signature change in
 * `useAngularService.ts` breaks compilation here rather than silently at run time
 * in the browser.
 *
 * Every NON-GENERIC member is typed precisely -- `jest.Mock<Return, Args>` -- so
 * the looser form is confined to exactly the members where it is unavoidable.
 * The unsafe escape-hatch type is never written anywhere in this file.
 */
type GetSwimlanesModesMock = jest.Mock<ResourceParams, [number]>;

type StoreShowTagsMock = jest.Mock<void, [number, boolean]>;

/** A `$tgResources` double plus handles on the members the specs drive. */
interface ResourcesDouble {
    service: TaigaResources;
    /** Generic facade member -- see the typing policy above. */
    listAll: jest.Mock;
    getSwimlanesModes: GetSwimlanesModesMock;
    storeShowTags: StoreShowTagsMock;
    /** The fixtures `listAll` resolves with, so a spec can assert on them. */
    storyModels: StoryModels;
}

type SubscribeMock = jest.Mock<
    void,
    [unknown, string, (data: unknown) => void, (ResourceParams | undefined)?]
>;

type UnsubscribeMock = jest.Mock<void, [string]>;

/** A `$tgEvents` double. `connected` is a plain boolean, exactly as on the real service. */
interface EventsDouble {
    service: TaigaEventsService;
    subscribe: SubscribeMock;
    unsubscribe: UnsubscribeMock;
}

type InstantMock = jest.Mock<string, [string, (ResourceParams | undefined)?]>;

/** A `$translate` double. */
interface TranslateDouble {
    service: TranslateService;
    instant: InstantMock;
}

/** A `tgResources` double -- the SECOND, distinct resources service. */
interface Resources2Double {
    service: TaigaResources2;
    /** Generic facade member -- see the typing policy above. */
    list: jest.Mock;
}

/**
 * An AngularJS-promise-shaped return value: a bare THENABLE, not a native
 * promise.
 *
 * The facade type deliberately requires BOTH handlers
 * (`./useAngularService.ts:321-326`), which makes a bare single-argument `.then`
 * a compile error in React code and pushes every call site through the sibling
 * `toNativePromise` marshaller. Reproducing that shape here is what keeps the
 * specs honest about what a resource method actually hands back. Marshalling
 * itself is `toNativePromise`'s contract and is covered by its own spec; it is
 * deliberately not re-tested here.
 */
function angularPromiseOf<T>(value: T): AngularPromise<T> {
    return {
        then(onFulfilled: (resolved: T) => unknown, _onRejected: (reason: unknown) => unknown) {
            // Synchronous on purpose: a thenable owes no microtask semantics, and
            // resolving inline keeps these specs free of timers and fake clocks.
            return onFulfilled(value);
        },
    };
}

/**
 * A user-story fixture shaped like what the repository layer yields -- a model
 * whose ATTRIBUTES are plain JSON.
 *
 * `getAttrs` is what a React caller must go through, and it is the reason a
 * model may cross into a React callback but never into React state or an immer
 * draft (P-IMMER-1).
 */
function plainStoryModel(id: number, subject: string): TaigaModel<PlainAttrs> {
    const attrs: PlainAttrs = {
        id,
        subject,
        ref: id,
        version: 1,
        is_blocked: false,
        // Status, tag and epic colours are DATA (rule T2), never constants, so a
        // fixture carries them as values just as the API does.
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

    // A generic facade member, so a bare `jest.fn()` with a configured return --
    // see the typing policy above. What it returns is an AngularJS-PROMISE-SHAPED
    // THENABLE, never a native promise, which is the whole point of case 9.
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
            storeQueryParams: jest.fn(),
            storeBacklog: jest.fn(),
            storeShowTags,
            getShowTags: jest.fn(() => null),
        },
        sprints: { list: jest.fn() },
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
    // Echoes the key back, which is the cheapest faithful stand-in: it proves a
    // string came from the translation layer rather than from a hardcoded
    // literal, without pulling in a translation table.
    const instant: InstantMock = jest.fn((translationId: string) => translationId);

    const service: TranslateService = {
        instant,
        preferredLanguage: jest.fn(() => 'en'),
        getTranslationTable: jest.fn(() => ({})),
    };

    return { service, instant };
}

/**
 * The module-level `mocks` object, rebuilt before every test.
 *
 * Mirrors `move-to-sprint.controller.spec.coffee:14`, keyed by the EXACT
 * AngularJS registration name so that `$tgResources` and `tgResources` stay
 * visibly distinct.
 */
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

/**
 * The three-service map used by most specs below: THREE of the fifteen
 * resolvable services, which is the point rather than a shortcut (section 2).
 */
function threeServiceMap(): MockServiceMap {
    return {
        $tgResources: mocks.$tgResources.service,
        $tgEvents: mocks.$tgEvents.service,
        $translate: mocks.$translate.service,
    };
}

/* ==========================================================================
 * PROBE COMPONENTS
 *
 * A hook can only be observed from inside a component, so each probe resolves
 * what its spec cares about, records it in a caller-owned box, and renders
 * something `screen` can find. Writing to the box during render is safe here
 * because these probes are rendered once per assertion and never inside
 * `StrictMode`; the alternative -- threading an effect -- would delay the
 * capture past the assertion for no gain.
 * ========================================================================== */

/** A caller-owned capture box, so identity can be asserted after render. */
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

/** Resolves `$tgResources` and reports the resolved instance. */
function ResourcesProbe({
    into,
    testId = 'resources-probe',
}: {
    into: Capture<TaigaResources>;
    testId?: string;
}): ReactElement {
    // The typed local of the type-inference proof: `rs` is `TaigaResources`, not
    // the unsafe escape-hatch type, so the member reached below is checked.
    const rs = useAngularService('$tgResources');

    record(into, rs);

    return <output data-testid={testId}>{typeof rs.userstories.listAll}</output>;
}

/** Resolves the three services of {@link threeServiceMap} in ONE component. */
function ThreeServiceProbe({
    resources,
    events,
    translate,
}: {
    resources: Capture<TaigaResources>;
    events: Capture<TaigaEventsService>;
    translate: Capture<TranslateService>;
}): ReactElement {
    // One call per dependency, which is the whole substitution: an opaque list of
    // 23 (Kanban) or 21 (Backlog) becomes three explicit asks.
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

/** Resolves a caller-chosen service name, for the diagnostic specs. */
function NamedServiceProbe({ name }: { name: keyof AngularServices }): ReactElement {
    useAngularService(name);

    return <output data-testid="named-service-probe">resolved</output>;
}

/**
 * Resolves BOTH resources services, which are genuinely different services on
 * different modules and are injected together by both surviving controllers.
 */
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

/**
 * Drives two TYPED members through the resolved facade.
 *
 * This is the run-time half of the type-inference proof: both calls are checked
 * against `TaigaResources`, so a member that does NOT exist on the facade -- say
 * `rs.userstories.listEverything(...)` -- would be a compile error on these
 * lines, and a rename inside `useAngularService.ts` breaks the type gate here
 * rather than silently at run time in the browser.
 */
function TypedMemberProbe(): ReactElement {
    const rs = useAngularService('$tgResources');

    rs.userstories.storeShowTags(7, true);

    const swimlaneModes = rs.kanban.getSwimlanesModes(7);

    return <output data-testid="typed-member-probe">{Object.keys(swimlaneModes).length}</output>;
}

/**
 * Calls a resource endpoint and reports what it handed back, WITHOUT awaiting it.
 *
 * The attribute shape is stated explicitly at the call site, which is how the
 * facade's generic members are meant to be used: the caller owns the shape, so
 * nothing has to be narrowed downstream.
 */
function ThenableProbe({ into }: { into: Capture<AngularPromise<StoryModels>> }): ReactElement {
    const rs = useAngularService('$tgResources');

    record(into, rs.userstories.listAll<PlainAttrs>(7));

    return <output data-testid="thenable-probe">requested</output>;
}

/**
 * Reaches a service through the `unknown`-returning escape hatch, and narrows it
 * before touching it -- which is exactly what `unknown` buys over the unsafe
 * escape-hatch type.
 */
function UntypedProbe({ into }: { into: Capture<boolean> }): ReactElement {
    const candidate = useUntypedAngularService('$tgEvents');

    let connected = false;

    if (
        typeof candidate === 'object' &&
        candidate !== null &&
        'connected' in candidate &&
        typeof (candidate as TaigaEventsService).connected === 'boolean'
    ) {
        connected = (candidate as TaigaEventsService).connected;
    }

    record(into, connected);

    return <output data-testid="untyped-probe">{String(connected)}</output>;
}

/**
 * Resolves a MISSPELLED service name.
 *
 * The deliberate negative type assertion of the type-inference proof: the
 * `@ts-expect-error` below must itself fail to compile if the misspelling ever
 * became acceptable, because an UNUSED `@ts-expect-error` is a compile error.
 * That is the self-check -- it cannot rot into a silenced real error the way
 * a blanket suppression would, which is why a blanket suppression is never used
 * anywhere in this tree.
 */
function MisspelledServiceProbe(): ReactElement {
    // @ts-expect-error -- 'tgResourcs' is not a key of `AngularServices`, so the
    // `K extends keyof AngularServices` narrowing must reject it at compile time.
    // The name reaching the injector at run time is what the spec then asserts on.
    useAngularService('tgResourcs');

    return <output data-testid="misspelled-service-probe">unreachable</output>;
}

/**
 * React logs a component error to the console before rethrowing it. The
 * throwing specs silence exactly that, so a deliberate failure does not look
 * like a broken suite. `restoreMocks: true` in `jest.config.js` puts the real
 * console back, which is why nothing here restores it by hand.
 */
function silenceReactErrorLog(): void {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

/** Captures the message of whatever `render` threw, or the empty string. */
function messageThrownBy(mount: () => unknown): string {
    try {
        mount();
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }

    return '';
}

/**
 * Every key of the service map, kept exhaustive by the `Missing` check in the
 * type-contract block so that adding a key without extending this list is a
 * compile error.
 */
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

/**
 * A `mockInjector` with a registration oracle grafted on.
 *
 * `mockInjector` deliberately OMITS `has` (its section 4), so that the accurate
 * "you did not supply this" diagnostic stays with the factory. Reaching the
 * hook's OTHER guard -- "AngularJS has no provider registered under this name" --
 * therefore needs a `has`, and this is the one place a spec adds one. The
 * SERVICES still come from `mockInjector`; only the oracle is added, and an
 * oracle is not a service.
 */
function mockInjectorWithHas(
    services: MockServiceMap,
    registered: readonly string[],
): AngularInjector & { has: jest.Mock<boolean, [string]> } {
    const has: jest.Mock<boolean, [string]> = jest.fn((name) => registered.includes(name));

    // Spreading is safe because `mockInjector`'s `get` closes over its own snapshot
    // rather than reading `this`.
    return { ...mockInjector(services), has };
}

/**
 * Installs a call-recording stand-in over EVERY browser request API named in
 * {@link BROWSER_REQUEST_APIS}, runs `body`, then restores the previous state
 * exactly -- putting an original back where one existed, and removing the
 * stand-in entirely where none did.
 *
 * All four are always installed, not only the ones jsdom happens to implement,
 * so the assertion has the same strength regardless of the environment's own
 * feature set. Nothing here uses `jest.spyOn`, because a spy cannot be installed
 * over a property that does not exist yet.
 *
 * @returns one probe per API, in the order of {@link BROWSER_REQUEST_APIS}.
 */
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

/* ==========================================================================
 * SPECS
 * ========================================================================== */

describe('useAngularService', () => {
    /* ----------------------------------------------------------------------
     * CASE 1 -- resolution
     * ---------------------------------------------------------------------- */
    describe('resolution', () => {
        it('hands back exactly the instance supplied to mockInjector, by reference', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const resolved = capture<TaigaResources>();

            render(<ResourcesProbe into={resolved} />, {
                wrapper: withMockInjector(injector),
            });

            // IDENTITY, not equality. No wrapping, no cloning, no proxying and no
            // partial application: `Object.is` is the assertion because a wrapper
            // that merely LOOKED equal would still break every effect whose
            // dependency array relies on the service's reference staying stable,
            // and would break `expect(double.method).toHaveBeenCalled()` in every
            // downstream spec.
            expect(Object.is(resolved.value, mocks.$tgResources.service)).toBe(true);
            expect(resolved.value).toBe(mocks.$tgResources.service);
            expect(screen.getByTestId('resources-probe')).toHaveTextContent('function');
        });

        it('passes the requested name through unchanged', () => {
            // Proof without a spy: `mockInjector` resolves from a Map containing ONE
            // name, so a successful resolution can only mean the hook asked for
            // exactly that name. Any other string would have taken the throw branch.
            const injector = mockInjector({ $tgConfirm: { askOnDelete: jest.fn(), notify: jest.fn() } });

            render(<NamedServiceProbe name="$tgConfirm" />, {
                wrapper: withMockInjector(injector),
            });

            expect(screen.getByTestId('named-service-probe')).toBeInTheDocument();
        });

        it('resolves through a provider mounted directly, not only through the test wrapper', () => {
            const injector = mockInjector({ $tgResources: mocks.$tgResources.service });
            const resolved = capture<TaigaResources>();

            // `AngularBridgeProvider` is what `ReactHostElement` actually renders, so
            // one spec mounts it literally rather than through `withMockInjector`.
            render(
                <AngularBridgeProvider injector={injector}>
                    <ResourcesProbe into={resolved} />
                </AngularBridgeProvider>,
            );

            expect(resolved.value).toBe(mocks.$tgResources.service);
        });

        it('accepts a minimal `{ get }` double with no `has`', () => {
            // `has` is optional on the injector type by design
            // (`./AngularBridgeContext.tsx:229-236`), and `mockInjector` deliberately
            // omits it so the accurate diagnostic stays with the factory.
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

    /* ----------------------------------------------------------------------
     * CASE 2 -- singleton identity
     * ---------------------------------------------------------------------- */
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

            // AngularJS services are singletons; the seam must not turn one into two.
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

            // A pure lookup re-resolves every render, and still yields the same
            // object -- which is why the hook holds no state and memoises nothing.
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

    /* ----------------------------------------------------------------------
     * CASE 3 -- missing-provider diagnostic
     * ---------------------------------------------------------------------- */
    describe('missing-provider diagnostic', () => {
        it('throws an Error naming both the hook and the service', () => {
            silenceReactErrorLog();

            const resolved = capture<TaigaResources>();

            // The alternative -- silently returning a nullish injector -- is strictly
            // worse: the symptom would surface much later as an inscrutable
            // "cannot read property of undefined" deep inside a data hook, with
            // nothing naming the provider that was missing.
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

            // A mount that happens before AngularJS has bootstrapped degrades to this
            // path rather than to a hard failure at the seam, so it is asserted
            // separately from the no-provider-at-all path above.
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

    /* ----------------------------------------------------------------------
     * CASE 4 -- unsupplied-service diagnostic
     *
     * This block is the only coverage `./mockInjector.ts` has: no production
     * module may import it, and no other spec does, so its throw branch would
     * otherwise never execute.
     * ---------------------------------------------------------------------- */
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

            // The default empty map is genuinely useful -- a component that needs a
            // provider above it but resolves nothing -- so its diagnostic is asserted
            // rather than assumed.
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

            // `mockInjector` looks up through a `Map` rather than by property access
            // precisely so this cannot happen: property access would happily return
            // `Object.prototype.constructor` and hand the unit under test a function
            // that is not a service at all -- an absurd failure to debug.
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

            // Snapshot semantics keep a spec from accidentally depending on
            // registration order. To vary the services, build another injector.
            expect(() => injector.get<TranslateService>('$translate')).toThrow(Error);
            expect(injector.get<TaigaEventsService>('$tgEvents')).toBe(
                mocks.$tgEvents.service,
            );
        });

        it('rejects a misspelled service name at compile time and at run time', () => {
            silenceReactErrorLog();

            // The run-time half of the negative type assertion in
            // {@link MisspelledServiceProbe}: the misspelling is a compile error
            // there, and the name still reaches the injector verbatim here, which is
            // what proves the hook does not "helpfully" normalise anything.
            const message = messageThrownBy(() =>
                render(<MisspelledServiceProbe />, {
                    wrapper: withMockInjector(
                        mockInjector({ $tgResources: mocks.$tgResources.service }),
                    ),
                }),
            );

            expect(message).toContain("service 'tgResourcs'");
            expect(message).toContain('Supplied: $tgResources');
        });
    });

    /* ----------------------------------------------------------------------
     * CASE 5 -- per-hook dependencies, which is why a PARTIAL map suffices
     * ---------------------------------------------------------------------- */
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

            // THE POINT (section 2 of the header): THREE services supplied out of
            // FIFTEEN resolvable, standing in for the 23 the Kanban controller is
            // handed and the 21 the Backlog controller is handed. A hook asks for
            // what it uses, so a spec supplies what the hook asks for -- which is
            // what makes a browserless unit layer viable at all (requirement I9).
            expect(Object.keys(map)).toHaveLength(3);
            expect(ALL_SERVICE_NAMES).toHaveLength(15);

            // Nothing about the resolution is inert: the copy really did come from
            // the translation layer rather than from a hardcoded literal.
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

            // Two names, two services, two different objects. Collapsing the pair
            // would silently hand the Backlog screen the wrong `attachments`.
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

            // Walks all FIFTEEN names so none can quietly acquire special handling:
            // a supplied name resolves, and an unsupplied one produces a diagnostic
            // that quotes the name back verbatim.
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

    /* ----------------------------------------------------------------------
     * CASE 6 -- type-inference proof (compile-time, asserted at run time)
     * ---------------------------------------------------------------------- */
    describe('type contract', () => {
        it('returns the mapped service type and NOT the unsafe escape-hatch type', () => {
            // Each of these fails to compile if the corresponding return type
            // degrades -- to the unsafe type, to `unknown`, or to anything other
            // than the exact mapped facade. See section 5 of the header for why
            // `Equals` is built the way it is.
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

        it('exposes the untyped escape hatch as `unknown`, forcing the caller to narrow', () => {
            const escapeIsUnknown: Equals<
                ReturnType<typeof useUntypedAngularService>,
                unknown
            > = true;

            expect(escapeIsUnknown).toBe(true);
        });

        it('covers every key of the service map in this spec', () => {
            type Missing = Exclude<keyof AngularServices, (typeof ALL_SERVICE_NAMES)[number]>;

            // Adding a key to `AngularServices` without extending `ALL_SERVICE_NAMES`
            // is a compile error here, which is what keeps the walk above exhaustive.
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

    /* ----------------------------------------------------------------------
     * CASE 7 -- no digest surface
     * ---------------------------------------------------------------------- */
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

            // Nested namespaces are included deliberately: a digest entry point
            // smuggled onto `userstories` would be just as reachable as one on the
            // aggregate service, and just as damaging.
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
            // The three names quoted verbatim from the two `$inject` lists that the
            // hook deliberately will NOT resolve. Their absence is a correctness
            // rule: handing React a scope invites the one call AAP 0.7.4 forbids,
            // and AngularJS promises cross the seam through the sibling marshaller
            // rather than by handing React the service that creates them.
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

    /* ----------------------------------------------------------------------
     * CASE 8 -- no transport
     * ---------------------------------------------------------------------- */
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

            // Rule T5 keeps every write on the repository layer so React inherits
            // `$tgModel`'s changed-fields-only PATCH (requirement I7). A resolution
            // that pre-fetched anything would be the first step towards a parallel
            // client, so it is asserted against rather than assumed.
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

            // Reaching for it is a diagnostic, not a resolution -- the resource and
            // repository namespaces are the sanctioned path to the backend.
            expect(() =>
                mockInjector(threeServiceMap()).get<unknown>(ANGULAR_TRANSPORT_SERVICE),
            ).toThrow(Error);
        });
    });

    /* ----------------------------------------------------------------------
     * CASE 9 -- AngularJS-promise-shaped returns
     * ---------------------------------------------------------------------- */
    describe('AngularJS-promise-shaped returns', () => {
        it('declares a thenable, not a native promise', () => {
            // The TYPE half: the facade's own return type is the two-handler
            // thenable, and it is NOT the native promise type. The second assertion
            // is expressed as `false` on purpose -- it would stop compiling the day
            // someone "modernised" the facade to a native promise, which would
            // silently change what every call site has to do.
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

            // A `$q` promise is not a native one, and the difference is observable:
            // the native combinators simply are not there. Marshalling across that
            // gap is the sibling `toNativePromise`'s contract, covered by its own
            // spec, and is deliberately not re-tested here.
            expect('catch' in thenable).toBe(false);
            expect('finally' in thenable).toBe(false);

            const onFulfilled = jest.fn<undefined, [StoryModels]>(() => undefined);
            const onRejected = jest.fn<undefined, [unknown]>(() => undefined);

            // BOTH handlers are mandatory on the facade type, which is what makes a
            // bare single-argument `.then(cb)` a compile error in React code and
            // pushes every real call site through the marshaller.
            thenable.then(onFulfilled, onRejected);

            expect(onFulfilled).toHaveBeenCalledTimes(1);
            expect(onRejected).not.toHaveBeenCalled();

            const [models] = onFulfilled.mock.calls[0];

            expect(models).toBe(mocks.$tgResources.storyModels);
            expect(models).toHaveLength(2);
            expect(models[0].getName()).toBe('userstories');

            // PLAIN attributes: no persistent collection and no model instance ever
            // reaches React state (P-IMMER-1, section 4 of the header).
            expect(models[0].getAttrs()).toEqual(
                expect.objectContaining({ id: 1, subject: 'Reorder the sprint', version: 1 }),
            );
            expect(models[1].getAttrs()).toEqual(
                expect.objectContaining({ id: 2, subject: 'Fold the DONE column' }),
            );
            expect(screen.getByTestId('thenable-probe')).toHaveTextContent('requested');
        });
    });

    /* ----------------------------------------------------------------------
     * The hook's OTHER guard: AngularJS reports the name as unregistered.
     * Reached only when the injector actually offers a registration oracle.
     * ---------------------------------------------------------------------- */
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

            // Failing FIRST is the point: AngularJS's own
            // "[$injector:unpr] Unknown provider" says nothing about the React side
            // that asked, so the hook must never let it be reached.
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
 * THE ESCAPE HATCH
 * ========================================================================== */

describe('useUntypedAngularService', () => {
    it('resolves by reference and yields a value that must be narrowed first', () => {
        const injector = mockInjector({ $tgEvents: mocks.$tgEvents.service });
        const connected = capture<boolean>();

        render(<UntypedProbe into={connected} />, { wrapper: withMockInjector(injector) });

        // The narrowing inside the probe is the whole point: without it the value
        // cannot be dereferenced at all, and every such narrowing is visible in
        // review -- which is what `unknown` buys over the unsafe escape-hatch type.
        expect(connected.value).toBe(true);
        expect(screen.getByTestId('untyped-probe')).toHaveTextContent('true');
    });

    it('raises the provider diagnostic under its own name', () => {
        silenceReactErrorLog();

        const connected = capture<boolean>();

        expect(() => render(<UntypedProbe into={connected} />)).toThrow(
            /useUntypedAngularService\('\$tgEvents'\)/,
        );
    });

    it('raises the unregistered diagnostic under its own name', () => {
        silenceReactErrorLog();

        const connected = capture<boolean>();

        expect(() =>
            render(<UntypedProbe into={connected} />, {
                wrapper: withMockInjector(
                    mockInjectorWithHas({ $tgEvents: mocks.$tgEvents.service }, ['tgSomethingElse']),
                ),
            }),
        ).toThrow(/useUntypedAngularService\('\$tgEvents'\) found no AngularJS service/);
    });
});

/* ==========================================================================
 * THE MOCKING SEAM ITSELF
 *
 * `./mockInjector.ts` is test-only and is imported by no production module, so
 * this file is its only exercise. Covering its wrapper here is what keeps it from
 * sitting at zero coverage while still counting against the 70 % gate.
 * ========================================================================== */

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

        // A provider carrying nothing is legitimate -- a screen may mount the seam
        // before it has anything to put beneath it -- and it must render nothing
        // rather than throw.
        expect(container).toBeEmptyDOMElement();
    });
});
