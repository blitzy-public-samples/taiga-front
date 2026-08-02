/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useAngularService.ts -- THE TYPED REPLACEMENT FOR ANGULARJS CONSTRUCTOR
 *                         INJECTION
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file. It sits in the
 * anti-corruption layer of a strangler-fig coexistence migration, so every
 * statement below is factual, locator-dense, and load-bearing.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS
 * --------------------------------------------------------------------------
 * The single typed accessor by which React code reaches an AngularJS service:
 *
 *     const rs = useAngularService('$tgResources');
 *
 * The migration is incremental coexistence, not a rewrite. AngularJS 1.5.10
 * keeps owning routing, the project rail and every screen outside Kanban and
 * Backlog, and BOTH screen controllers survive intact as the data, permission
 * and drag-serialisation layer behind their React replacements. React is
 * mounted inside that shell through the `tg-react-loader` custom element, fed
 * by the UNMODIFIED `tgLoadElement` directive
 * (`app/coffee/modules/base/load-element.coffee:17-39`, registered on the
 * `taigaBase` module at `:15`).
 *
 * React components cannot use AngularJS's static `$inject` array -- that is a
 * constructor-injection mechanism and React function components have no
 * constructor. This hook is its replacement. It reads the live `$injector`
 * from the sibling `AngularBridgeContext` (`./AngularBridgeContext.tsx:267`,
 * published by `AngularBridgeProvider` at `:281`) and resolves a service by
 * name, returning it UNWRAPPED.
 *
 * --------------------------------------------------------------------------
 * 2. THE TWO `$inject` LISTS THIS REPLACES -- verbatim, with the locator and
 *    count corrections that were verified by reading the files
 * --------------------------------------------------------------------------
 * `KanbanController.$inject` -- `app/coffee/modules/kanban/main.coffee:31-55`
 * (the array opens on L31 and its closing bracket is L55; the entries occupy
 * L32-L54) -- EXACTLY 23 entries, in source order:
 *
 *     "$scope", "$rootScope", "$tgRepo", "$tgConfirm", "$tgResources",
 *     "tgResources", "$routeParams", "$q", "$tgLocation", "tgAppMetaService",
 *     "$tgNavUrls", "$tgEvents", "$tgAnalytics", "$translate",
 *     "tgErrorHandlingService", "$tgModel", "tgKanbanUserstories",
 *     "$tgStorage", "tgFilterRemoteStorageService", "tgProjectService",
 *     "tgLightboxFactory", "tgLoader", "$timeout"
 *
 * It becomes 24 entries once `"tgKanbanReactBridge"` is appended by the
 * AngularJS-side bridge work.
 *
 * CORRECTION 1: the folder brief cites this list at L30-L53. The VERIFIED
 * locator is L31-L55.
 *
 * `BacklogController.$inject` -- `app/coffee/modules/backlog/main.coffee:26-48`
 * (array opens L26, closes L48, entries L27-L47) -- EXACTLY 21 entries, in
 * source order:
 *
 *     "$scope", "$rootScope", "$tgRepo", "$tgConfirm", "$tgResources",
 *     "$routeParams", "$q", "$tgLocation", "tgAppMetaService", "$tgNavUrls",
 *     "$tgEvents", "$tgAnalytics", "$translate", "$tgLoading", "tgResources",
 *     "$tgQueueModelTransformation", "tgErrorHandlingService", "$tgStorage",
 *     "tgFilterRemoteStorageService", "tgProjectService", "tgLoader"
 *
 * CORRECTION 2: AAP 0.5.2 states 23 services for this controller. The VERIFIED
 * count is 21.
 *
 * Both lists are reproduced above as QUOTED HISTORICAL EVIDENCE of what this
 * file replaces -- they are the two arrays whose contents a reader needs in
 * order to audit the map in section 4 against them. Nothing in this file USES
 * any of those names as a value; section 6 records exactly which of them are
 * deliberately absent from the map, and why.
 *
 * The asymmetry between the two lists is REAL and is deliberately not
 * "normalised": Kanban injects `$tgModel`, `tgKanbanUserstories`,
 * `tgLightboxFactory` and a timeout service that Backlog does not, and Backlog
 * injects a loading service and a queued-model-transformation service that
 * Kanban does not. Both inject `$tgResources` AND `tgResources` -- two
 * genuinely DIFFERENT services with confusingly similar names (see 5), never
 * to be collapsed into one key.
 *
 * --------------------------------------------------------------------------
 * 3. THE TRANSFORMATION RULE, AND WHY IT IS SHAPED THIS WAY
 * --------------------------------------------------------------------------
 * AAP 0.7.4, applied uniformly to every file under `app/react/**`:
 *
 *     Old: @.$inject = ["$tgResources", "$tgEvents", "$tgConfirm"]
 *     New: const rs = useAngularService('$tgResources');
 *
 * The consequence is the point, not a side effect: two opaque lists of 23 and
 * 21 services become EXPLICIT PER-HOOK DEPENDENCIES. `useKanbanData` asks for
 * the two or three services it actually uses; `useCardDrag` asks for its own.
 *
 * That is precisely what makes the browserless Jest layer viable (requirement
 * I9 -- "the >=70% coverage gate forces a presentational/container split"): a
 * hook's spec stands up a two-entry test double instead of mocking
 * twenty-three services, and a presentational component that asks for nothing
 * needs no injector at all. A single "give me everything" accessor would have
 * re-created the opaque list in a new syntax and left the coverage gate
 * unreachable.
 *
 * --------------------------------------------------------------------------
 * 4. THE TYPE MAP IS THE WHOLE VALUE OF THIS FILE
 * --------------------------------------------------------------------------
 * `tsconfig.json` sets `strict: true` with NO per-flag opt-outs. An accessor
 * that returned the unsafe escape-hatch type would silently defeat the type
 * gate for the ENTIRE React tree -- every downstream property access, argument
 * and return value would go unchecked, and `tsc --noEmit` would keep passing
 * while saying nothing. That type therefore appears NOWHERE in this file, not
 * even in a comment; the one escape provided (`useUntypedAngularService`)
 * returns `unknown`, which forces the caller to narrow before use.
 *
 * OWNERSHIP BOUNDARY -- this file owns the INJECTOR SURFACE. `../shared/types/**`
 * owns the DOMAIN MODEL (`UserStory`, `Status`, `Swimlane`, `Sprint`, `Epic`).
 * The two are kept separate on purpose: that separation IS the
 * anti-corruption-layer discipline of AAP 0.5.4. Consequently the service
 * interfaces below are generic over their payload shapes rather than importing
 * domain types, so `../shared/api/**` -- the typed facades over this layer --
 * can supply concrete domain types at each call site without this file ever
 * depending on them. Every interface is exported for exactly that purpose.
 *
 * Each interface is also deliberately MINIMAL: it models only the members the
 * two in-scope screens actually touch, measured by grepping
 * `app/coffee/modules/{kanban,backlog}/**`, with the definition locator quoted
 * at each member. Members that exist on the real service but that neither
 * screen uses are named in a note rather than declared, so a future need
 * becomes a deliberate, reviewed edit instead of an accident.
 *
 * The AngularJS type-definition package is NOT part of the pinned dependency
 * set (HR-2 keeps that set closed) and must not be added, so every shape here
 * is hand-written and STRUCTURAL. Structural typing is also what keeps the
 * lightweight test doubles in the co-located specs assignable.
 *
 * --------------------------------------------------------------------------
 * 5. RULE T5 -- NO PARALLEL HTTP CLIENT (verbatim)
 * --------------------------------------------------------------------------
 *     "Reuse `$tgResources`; do not build a parallel HTTP client. New
 *      TypeScript files are typed facades over the existing repository layer."
 *
 * This file IS one of those facades -- the first one, since every other facade
 * reaches its transport through this hook. Because every request keeps going
 * through `$tgResources` -> the repository layer -> the AngularJS HTTP service,
 * React INHERITS rather than re-derives all of the following:
 *
 *   - `Authorization: "Bearer #{token}"`, built from the stored token, and
 *     `Accept-Language`, built from the preferred language --
 *     `app/coffee/modules/base/http.coffee:17-30`, merged into every request at
 *     `:33` via `options.headers = _.assign({}, options.headers or {}, @.headers())`.
 *     (AAP 0.5.2 mentions only `Authorization`; the `Accept-Language` header is
 *     real and verified at `:26-28`.)
 *   - `defaultHeaders = {"Content-Type": "application/json", "Accept-Language":
 *     window.taigaConfig.defaultLanguage || "en", "X-Session-Id":
 *     taiga.sessionId}` -- `app/coffee/app.coffee:590-594` -- applied to
 *     delete/patch/post/put at `:596-599`, while GET receives
 *     `{"X-Session-Id": taiga.sessionId}` only, at `:600-602`.
 *   - The SINGLE-FLIGHT 401 REFRESH interceptor, so concurrent requests do not
 *     each trigger their own token refresh.
 *   - The 400-carrying-`version` VERSION_ERROR toast, shown for 10,000 ms --
 *     this is how an optimistic-concurrency conflict becomes visible to the
 *     user at all.
 *   - The 451 blocking interceptor for blocked projects.
 *   - The status-0 / status-(-1) path, which closes open lightboxes and shows
 *     the full-page connection-error view.
 *
 * A bespoke transport would drop all five behaviours, and the loss would stay
 * invisible until a token expired or two users edited the same story.
 *
 * MOST IMPORTANT OF ALL -- `$tgModel` dirty-tracking is a DATA-INTEGRITY
 * GUARANTEE, not an optimisation. `getAttrs(patch = false)`
 * (`app/coffee/modules/base/model.coffee:48-54`) copies the optimistic-
 * concurrency `version` into the modified-attribute set at `:49-50` and then
 * returns `_.extend({}, @._attrs, @._modifiedAttrs)`; the repository's `save()`
 * (`app/coffee/modules/base/repository.coffee:54-85`) short-circuits an
 * unmodified model at `:57-59` and otherwise PATCHes ONLY THE CHANGED FIELDS
 * plus that `version`. A hand-rolled client would naturally serialise the whole
 * object, turning every edit into a potential SILENT LOST UPDATE: two users
 * editing different fields of the same story would overwrite each other, with
 * no error, no toast and no console warning -- the corruption surfaces only on
 * the next page load (requirement I7).
 *
 * Hence: no browser request API, no browser XHR API, no third-party HTTP
 * client and no direct use of the AngularJS HTTP service anywhere in
 * `app/react/**`. This file exposes no way to reach any of them.
 *
 * Permission gates follow the same "inherit, never re-derive" rule. React reads
 * the same `my_permissions` array the `tg-check-permission` and
 * `tg-class-permission` directives read -- screen-level `is_kanban_activated` /
 * `is_backlog_activated` (routing to `permissionDenied`), action-level
 * `add_us`, `modify_us`, `modify_task`, `view_tasks`, `view_milestones`,
 * `add_milestone`, `delete_milestone`, plus the state-level blocked/archived
 * restrictions. React computes NO independent notion of what the user may do,
 * which is why `tgProjectService` below exposes `hasPermission` and `canEdit`
 * rather than anything that would let React decide for itself.
 *
 * KNOWN WEAKNESS, LEFT NO WORSE: the JWT is persisted in browser local storage
 * through `$tgStorage`. Relocating it is out of scope (AAP 0.8.2) and this file
 * deliberately does not change where it lives.
 *
 * --------------------------------------------------------------------------
 * 6. WHAT THIS HOOK DELIBERATELY WILL NOT RESOLVE
 * --------------------------------------------------------------------------
 * Three of the names quoted verbatim in section 2 are ABSENT from the map on
 * purpose, and their absence is a correctness rule rather than an oversight:
 *
 *   - BOTH ANGULARJS SCOPE SERVICES (the application root scope and a
 *     directive scope). React must never participate in the digest lifecycle:
 *     AAP 0.7.4 is verbatim that React code must "never" call the root scope's
 *     apply method. Digest cycles remain AngularJS's concern, React state
 *     updates are driven by React, and the AngularJS HTTP provider already
 *     runs its callbacks through `useApplyAsync(true)`
 *     (`app/coffee/app.coffee:604`), so a response arriving from the shared
 *     transport schedules its own digest without React's help. Handing React a
 *     scope would only invite the one call the rule forbids.
 *   - THE ANGULARJS PROMISE SERVICE. Its promises cross the seam through the
 *     sibling `toNativePromise.ts` marshaller (see 7), not by handing React a
 *     reference to the service that creates them.
 *
 * When a downstream hook believes it needs the root scope, the sanctioned
 * answer is the `onAngularEvent(eventName, handler)` callback the AngularJS side
 * publishes in the bridge payload
 * (`app/coffee/modules/backlog/react-bridge.coffee:459`), which registers the
 * handler on the controller's own scope there and returns AngularJS's own
 * deregistration function for the caller to invoke on cleanup.
 *
 * Three further services are excluded on measured evidence:
 *
 *   - `tgKanbanUserstories`. Its `usByStatus`, `usMap`, `usByStatusSwimlanes`
 *     and `swimlanesList` are PERSISTENT COLLECTIONS, and
 *     `app/coffee/modules/kanban/react-bridge.coffee` (section 6 of its header)
 *     forbids any persistent collection -- and any `$tgModel` instance --
 *     from crossing the seam, because immer rejects class instances and
 *     freezing a structure AngularJS still iterates makes the next digest
 *     throw. Board data therefore reaches React ALREADY FLATTENED, through the
 *     `params` snapshot and the `events` accessors, flattened there by that
 *     file's `toPlain`. Exposing the service here would hand React the raw
 *     persistent structures and invite exactly the violation the seam exists
 *     to prevent. The AngularJS-side structures are deliberately left alone
 *     because out-of-scope consumers depend on their contracts -- `kanban.jade`
 *     switches a class on `swimlanesList.size`, and the shared card component
 *     the taskboard also renders reads the same property (rule T4).
 *   - The BACKLOG-ONLY loading service and queued-model-transformation
 *     service. Grepping both in-scope modules finds ZERO direct call sites for
 *     either: they are reached only through the shared controller mixins, which
 *     survive untouched on the AngularJS side. Typing them would be
 *     speculative, and the Minimal Change Clause forbids enhancing beyond the
 *     stated requirements.
 *
 * None of those exclusions can force a downstream file into the unsafe
 * escape-hatch type or into editing this file, because
 * `useUntypedAngularService` provides an explicit, greppable, `unknown`-typed
 * escape for exactly this case.
 *
 * --------------------------------------------------------------------------
 * 7. EVERY `$tgResources` PROMISE MUST BE MARSHALLED
 * --------------------------------------------------------------------------
 * The resource methods return ANGULARJS PROMISES, not native ones. They are
 * therefore typed as {@link AngularPromise} -- a minimal `then`-only
 * structural shape, identical to the `Thenable` interface the sibling
 * `toNativePromise.ts` exports -- and NEVER as a native promise type, so no
 * call site can silently `await` one and inherit AngularJS scheduling
 * semantics by accident. Marshal at every call site:
 *
 *     const uss = await toNativePromise(rs.userstories.listAll(projectId));
 *
 * Note that NOT every resource member is asynchronous: the members backed by
 * browser local storage (`kanban.getSwimlanesModes`,
 * `userstories.getQueryParams`, and their `store*` counterparts) return
 * SYNCHRONOUSLY, and are typed accordingly. Typing them as thenables would
 * have been a fiction that produced a promise-of-a-promise at every call site.
 *
 * --------------------------------------------------------------------------
 * NOTE ON THE IMPORTS BELOW
 * --------------------------------------------------------------------------
 * There is deliberately no default `react` import. `tsconfig.json` sets
 * `jsx: "react-jsx"` (the automatic runtime, which esbuild must mirror with
 * `jsx: "automatic"` -- the two MUST agree or the bundle throws
 * "React is not defined" at runtime), so the default import is unnecessary,
 * and `noUnusedLocals: true` would turn it into a compile error. The import is
 * a relative path because `tsconfig.json` declares no `baseUrl` and no `paths`.
 * ========================================================================== */

import { useContext } from 'react';

import { AngularBridgeContext } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';

/* ==========================================================================
 * STRUCTURAL PRIMITIVES
 *
 * Hand-written because the AngularJS type-definition package is outside the
 * pinned dependency set (HR-2). Each one models the smallest shape that is
 * correct for the call sites the two in-scope screens have.
 * ========================================================================== */

/**
 * The minimal structural contract of an AngularJS promise.
 *
 * Structurally IDENTICAL to the `Thenable` interface exported by the sibling
 * `toNativePromise.ts`, so any value typed with this interface can be handed
 * to `toNativePromise` with no cast and no adapter. It is redeclared rather
 * than imported because `toNativePromise.ts` is not among this file's declared
 * dependencies; keeping the shape byte-equivalent is what makes the two
 * interchangeable.
 *
 * Only `then` is modelled. AngularJS promises also expose `catch` and
 * `finally`, but the marshaller relies on `then` alone, and requiring both
 * handler arguments is intentional: it makes a bare `promise.then(cb)` in React
 * code a compile error, which pushes every call site through the marshaller as
 * section 7 of the file header requires.
 *
 * @typeParam T - the value the promise fulfils with.
 */
interface AngularPromise<T> {
    then(
        onFulfilled: (value: T) => unknown,
        onRejected: (reason: unknown) => unknown,
    ): unknown;
}

/**
 * AngularJS's response-header accessor, as handed to a `then` callback.
 *
 * Called with no argument it yields every header; called with a name it yields
 * that one header, or `null` when the response did not carry it. Both forms are
 * live in this codebase: `app/coffee/modules/resources/sprints.coffee:30-40`
 * reads `Taiga-Info-Total-Closed-Milestones` and
 * `Taiga-Info-Total-Opened-Milestones` by name, while
 * `app/coffee/modules/base/repository.coffee:186` takes the whole object.
 */
interface HttpHeadersGetter {
    (): Record<string, string>;
    (name: string): string | null;
}

/**
 * The minimal structural view of an AngularJS HTTP response, as it reaches a
 * `then` callback from the resource methods that post or patch directly
 * instead of going through the repository layer.
 *
 * @typeParam TData - the parsed response body.
 */
interface AngularHttpResponse<TData> {
    /** The parsed response body. */
    data: TData;

    /** The HTTP status code. */
    status: number;

    /** Response-header accessor -- see {@link HttpHeadersGetter}. */
    headers: HttpHeadersGetter;
}

/**
 * A persistent (structurally shared) AngularJS-side structure, modelled by the
 * ONLY two members React is permitted to touch on one.
 *
 * `toJS()` is the boundary-flattening house style
 * (`app/modules/components/project-menu/project-menu.controller.coffee:27` and
 * `:21`): a persistent structure must be flattened to plain JSON BEFORE it
 * enters React state, because immer rejects class instances and its
 * `autoFreeze` would freeze a structure AngularJS still iterates. `get` is
 * offered for a single keyed read that does not warrant flattening the whole
 * structure.
 *
 * No member that would let React mutate or iterate one is declared, and no
 * index signature is declared, so the type itself pushes callers toward
 * `toJS()`.
 *
 * @typeParam TPlain - the plain-JSON shape `toJS()` produces.
 */
interface PersistentStructure<TPlain = Record<string, unknown>> {
    /**
     * Read one key. The type argument is explicit at the call site; left off,
     * it resolves to `unknown` and forces the caller to narrow.
     */
    get<TValue>(key: string): TValue;

    /** Flatten to plain JSON -- do this before the value enters React state. */
    toJS(): TPlain;
}

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
     */
    getAttrs(patch?: boolean): TAttrs;

    /** `model.coffee:63-65`. Records a change, marking the model modified. */
    setAttr(name: string, value: unknown): void;

    /**
     * `model.coffee:110-111`. The repository's `save()` short-circuits an
     * unmodified model at `repository.coffee:57-59` rather than issuing a
     * request.
     */
    isModified(): boolean;

    /** `model.coffee:45-46`. The resource name this model was created under. */
    getName(): string;

    /** `model.coffee:28-32`. Shallow clone that preserves the modified set. */
    clone(): TaigaModel<TAttrs>;
}

/**
 * A bag of query-string parameters or filter values, as the resource layer
 * forwards them to the transport untouched.
 */
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
 * (`:92`) and `userstories-filters` (`:113`). Declaring the frozen six is what
 * stops a facade in `../shared/api/**` from re-deriving one of those URLs.
 * ========================================================================== */

/**
 * The `userstories` namespace --
 * `app/coffee/modules/resources/userstories.coffee:15-177`.
 *
 * Members present on the real service but excluded by the membership rule:
 * `listInAllProjects`, `upvote`, `downvote`, `watch`, `unwatch`, `listValues`,
 * `createDefaultValues`, `editStatus`, `getQueryParams` and `getBacklog`.
 */
interface UserStoriesResource {
    /** `:19-25`. One story by id, through the repository -> a model. */
    get<TAttrs = Record<string, unknown>>(
        projectId: number,
        usId: number,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /** `:27-37`. One story by its per-project `ref`. */
    getByRef<TAttrs = Record<string, unknown>>(
        projectId: number,
        ref: number,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /** `:57-62`. Every story of a project, as models. */
    listAll<TAttrs = Record<string, unknown>>(
        projectId: number,
        filters?: ResourceParams,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;

    /**
     * `:45-55`. The backlog page -- stories with no milestone, paginated.
     *
     * Resolves a TWO-ELEMENT TUPLE, not an array of models: the repository is
     * called with its `headers` flag set, so it resolves
     * `[models, headersGetter]` (`repository.coffee:135-148`). The pagination
     * totals the backlog reads come from that getter, which is why the tuple
     * shape is modelled explicitly instead of being flattened away.
     */
    listUnassigned<TAttrs = Record<string, unknown>>(
        projectId: number,
        filters?: ResourceParams,
        pageSize?: number,
        store?: boolean,
    ): AngularPromise<[Array<TaigaModel<TAttrs>>, HttpHeadersGetter]>;

    /**
     * `:42-43`. Frozen endpoint `userstories-filters`. Goes through the
     * repository's RAW query, so it resolves the parsed body itself rather than
     * a model.
     */
    filtersData<TFilters = unknown>(params: ResourceParams): AngularPromise<TFilters>;

    /**
     * `:64-74`. Frozen endpoint `bulk-create-us`. Posts directly, so it
     * resolves a full HTTP response.
     */
    bulkCreate<TResult = unknown>(
        projectId: number,
        status: number,
        bulk: string,
        swimlane: number | null,
    ): AngularPromise<AngularHttpResponse<TResult>>;

    /**
     * `:92-105`. Frozen endpoint `bulk-update-us-backlog-order`.
     *
     * POSITION-RELATIVE, not index-based: `afterUserstoryId` and
     * `beforeUserstoryId` are serialised as `after_userstory_id` (`:100`) and
     * `before_userstory_id` (`:103`), and only ONE of the two is sent -- the
     * `else if` at `:102` makes "after" win when both are supplied. Both are
     * nullable because a drop at either end of the list has only one neighbour.
     * An off-by-one in the caller's neighbour arithmetic persists a WRONG ORDER
     * with no error surface, which is why the ordering computation lives in one
     * unit-tested place rather than at each call site.
     */
    bulkUpdateBacklogOrder<TResult = unknown>(
        projectId: number,
        milestoneId: number | null,
        afterUserstoryId: number | null,
        beforeUserstoryId: number | null,
        bulkUserstories: number[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    /**
     * `:112-129`. Frozen endpoint `bulk-update-us-kanban-order`. Same
     * position-relative neighbour contract as `bulkUpdateBacklogOrder`, plus the
     * target status (`:116`) and an optional swimlane (`:126-127`).
     */
    bulkUpdateKanbanOrder<TResult = unknown>(
        projectId: number,
        statusId: number,
        swimlaneId: number | null,
        afterUserstoryId: number | null,
        beforeUserstoryId: number | null,
        bulkUserstories: number[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    /**
     * `:107-110`. Frozen endpoint `bulk-update-us-milestone`; `data` becomes
     * `bulk_stories` at `:109`. Called from
     * `app/coffee/modules/backlog/main.coffee:880`.
     */
    bulkUpdateMilestone<TResult = unknown>(
        projectId: number,
        milestoneId: number | null,
        data: ResourceParams[],
    ): AngularPromise<AngularHttpResponse<TResult>>;

    /**
     * `:149-152`. SYNCHRONOUS -- writes to browser local storage under a hash
     * of the project id, and returns nothing. Not a promise; see section 7 of
     * the file header.
     */
    storeQueryParams(projectId: number, params: ResourceParams): void;

    /** `:159-162`. SYNCHRONOUS local-storage write of the backlog id order. */
    storeBacklog(projectId: number, ids: number[]): void;

    /** `:169-172`. SYNCHRONOUS local-storage write of the tags-visible flag. */
    storeShowTags(projectId: number, params: boolean): void;

    /**
     * `:174-177`. SYNCHRONOUS local-storage read of the tags-visible flag.
     * `null` when the user has never toggled it on this project.
     */
    getShowTags(projectId: number): boolean | null;
}

/**
 * The `sprints` namespace --
 * `app/coffee/modules/resources/sprints.coffee:15-57`. Backs the frozen
 * `milestones` endpoint (`resources.coffee:92`).
 *
 * Members excluded by the membership rule: `get`, `stats`,
 * `moveUserStoriesMilestone`, `moveTasksMilestone`, `moveIssuesMilestone`.
 */
interface SprintsResource {
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
}

/**
 * The `swimlanes` namespace --
 * `app/coffee/modules/resources/swimlanes.coffee:14-60`.
 *
 * Members excluded by the membership rule: `create`, `edit`, `bulkUpdateOrder`,
 * `wipLimitUpdate`, `delete`. The Kanban screen reads swimlanes; it mutates
 * them only through the retained AngularJS controller.
 */
interface SwimlanesResource {
    /** `:16-18`. Every swimlane of a project, as models. */
    list<TAttrs = Record<string, unknown>>(
        projectId: number,
    ): AngularPromise<Array<TaigaModel<TAttrs>>>;
}

/**
 * The `kanban` namespace --
 * `app/coffee/modules/resources/kanban.coffee:15-40`.
 *
 * EVERY member here is SYNCHRONOUS: the namespace is a thin typed wrapper over
 * browser local storage and touches no transport at all. The two readers
 * default to `{}` when nothing has been stored (`:26`, `:39`), so neither
 * returns `null`.
 */
interface KanbanResource {
    /** `:19-22`. Persists the per-status folded/unfolded column modes. */
    storeStatusColumnModes(projectId: number, params: ResourceParams): void;

    /** `:24-27`. Reads them back, defaulting to `{}`. */
    getStatusColumnModes(projectId: number): ResourceParams;

    /** `:29-32`. Persists the per-swimlane collapsed modes. */
    storeSwimlanesModes(projectId: number, params: ResourceParams): void;

    /** `:34-37`. Reads them back, defaulting to `{}`. */
    getSwimlanesModes(projectId: number): ResourceParams;
}

/**
 * The `projects` namespace, narrowed to the two members the Backlog and Kanban
 * screens read -- `app/coffee/modules/resources/projects.coffee`.
 */
interface ProjectsResource {
    /**
     * `:42-43`. The project statistics behind the Backlog summary bar --
     * total, defined and closed points, and the completion percentage. A RAW
     * repository query, so it resolves the parsed body rather than a model.
     */
    stats<TStats = unknown>(projectId: number): AngularPromise<TStats>;

    /**
     * `:95-96`. The project's tag-to-colour map, which is what keeps every tag
     * pill DATA-COLOURED (rule T2) instead of hardcoded. Goes through the
     * repository's model query, so the map arrives wrapped in a model and must
     * be read with `getAttrs()`.
     */
    tagsColors<TColors = Record<string, string>>(
        projectId: number,
    ): AngularPromise<TaigaModel<TColors>>;
}

/**
 * `$tgResources` -- the aggregate service both controllers inject, narrowed to
 * the five namespaces the two in-scope screens use.
 *
 * NOT to be confused with `tgResources` ({@link TaigaResources2}), which both
 * controllers ALSO inject. They are different services on different modules;
 * section 2 of the file header records why the pair must stay distinct.
 */
interface TaigaResources {
    /** User-story reads, writes and the two bulk-ordering endpoints. */
    userstories: UserStoriesResource;

    /** Sprint/milestone listing. */
    sprints: SprintsResource;

    /** Swimlane listing. */
    swimlanes: SwimlanesResource;

    /** Local-storage-backed board view modes. */
    kanban: KanbanResource;

    /** Project statistics and tag colours. */
    projects: ProjectsResource;
}

/**
 * The `attachments` namespace of `tgResources`, narrowed to its one in-scope
 * member -- `app/modules/services/attachments.service.coffee:58`.
 */
interface AttachmentsResource {
    /**
     * `:58`. Attachments of one object. Called with `"us"` as the type from
     * `app/coffee/modules/kanban/main.coffee:381` and
     * `app/coffee/modules/backlog/main.coffee:736`.
     */
    list<TAttachment = unknown>(
        type: string,
        objId: number,
        projectId: number,
    ): AngularPromise<TAttachment[]>;
}

/**
 * `tgResources` -- the SECOND, distinct resources service, registered on the
 * `taigaResources2` module at `app/modules/resources/resources.coffee:45`. It
 * aggregates sixteen newer resource services by copying their properties onto
 * itself (`:28-40`), warning on any collision at `:36`.
 *
 * Narrowed to `attachments`, the only namespace either in-scope module reaches
 * through it -- `@rs2.attachments.list(...)`, twice in the whole of both
 * modules.
 */
interface TaigaResources2 {
    /** Attachment listing for a user story. */
    attachments: AttachmentsResource;
}

/* ==========================================================================
 * THE REPOSITORY AND MODEL LAYER
 * ========================================================================== */

/**
 * `$tgRepo` -- the repository service
 * (`app/coffee/modules/base/repository.coffee:11-224`, registered at `:224`).
 *
 * This is the layer requirement I7 names explicitly: React calls it rather than
 * a bespoke transport, so the changed-fields-only PATCH described in section 5
 * of the file header is preserved rather than re-derived.
 *
 * Narrowed to the three members the two in-scope modules use -- `save`,
 * `create` and `remove`. Members excluded by the membership rule: `saveAll`,
 * `saveAttribute`, `refresh`, `queryMany`, `queryOne`, `queryOneRaw`,
 * `queryOneAttribute`, `queryPaginated`, `queryOnePaginatedRaw`, `resolve`,
 * `resolveUrlForModel` and `resolveUrlForAttributeModel`. The resource
 * namespaces above already wrap the query members, which is why React reaches
 * reads through them and not through the repository directly.
 */
interface TaigaRepository {
    /**
     * `:54-85`. PATCHes the model when `patch` is truthy (the default), PUTs it
     * otherwise, and SHORT-CIRCUITS an unmodified model without any request at
     * `:57-59`. On success the server's authoritative attributes are merged back
     * onto the same instance (`:71-75`), so the resolved model is the one that
     * was passed in.
     *
     * The service also accepts a fifth `returnHeaders` argument (`:54`) which,
     * when truthy, resolves `[model, headers]` instead (`:79-82`). Neither
     * in-scope screen uses it, so that form is not declared here -- adding it is
     * a deliberate, reviewed edit.
     */
    save<TAttrs = Record<string, unknown>>(
        model: TaigaModel<TAttrs>,
        patch?: boolean,
        params?: ResourceParams,
        options?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /**
     * `:24-36`. POSTs `data` to the resource named `name` and resolves a NEW
     * model built from the server's response (`:30`), not from the input.
     */
    create<TAttrs = Record<string, unknown>>(
        name: string,
        data: TAttrs,
        dataTypes?: Record<string, string>,
        extraParams?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /**
     * `:37-49`. DELETEs the model's own URL. Resolves WITH THE MODEL on success
     * (`:43`) and rejects WITH THE MODEL on failure (`:46`) -- the failure value
     * is the model, not the server payload, so a caller must not read an error
     * body off it.
     */
    remove<TAttrs = Record<string, unknown>>(
        model: TaigaModel<TAttrs>,
        params?: ResourceParams,
    ): AngularPromise<TaigaModel<TAttrs>>;
}

/**
 * `$tgModel` -- the model FACTORY, not a model
 * (`app/coffee/modules/base/model.coffee:139-160`, registered as a factory at
 * `:162`). Injected by the Kanban controller and not by the Backlog one.
 *
 * Narrowed to `make_model`. The factory also exposes `cls` (the model class
 * itself) and `casts` (the integer and float attribute casts at `:146-153`);
 * both are internal plumbing for the resource providers, neither is reached from
 * React, and exposing the class would invite subclassing at the seam.
 *
 * Reminder from section 6 of the file header: a model instance produced here
 * must never enter React state or an immer draft (pitfall P-IMMER-1) --
 * flatten it with `getAttrs()` first.
 */
interface TaigaModelFactory {
    /**
     * `:141-142`. Wraps a plain attribute object in a dirty-tracking model, so
     * a React-side edit can be handed to `$tgRepo.save()` and PATCH only what
     * changed. The third parameter selects the model class and the fourth
     * declares attribute casts; both default inside the factory, so both are
     * omitted here.
     */
    make_model<TAttrs = Record<string, unknown>>(
        name: string,
        data: TAttrs,
    ): TaigaModel<TAttrs>;
}

/* ==========================================================================
 * REALTIME, TRANSLATION AND UI SERVICES
 * ========================================================================== */

/**
 * The narrow slice of an AngularJS scope that `$tgEvents.subscribe` uses: a
 * single lifecycle listener registration.
 *
 * Declared ONLY so the `scope` parameter below can be typed honestly. React
 * never obtains one of these -- see section 6 of the file header -- and always
 * passes `null`.
 */
interface AngularLifecycleScope {
    /**
     * Registers a listener for a broadcast/emitted AngularJS event and returns
     * its deregistration function.
     */
    $on(eventName: string, listener: () => void): () => void;
}

/**
 * `$tgEvents` -- the realtime service
 * (`app/coffee/modules/events.coffee`), which multiplexes the WebSocket
 * connection to `taiga-events` and its RabbitMQ routing keys. Requirement G2
 * freezes the routing-key contract: `changes.project.{id}.userstories`,
 * `.milestones` and `.projects` are subscribed exactly as they are today.
 */
interface TaigaEventsService {
    /**
     * `:23`, also set at `:236` and cleared at `:274`. Whether the WebSocket is
     * currently up.
     *
     * The Backlog controller reads this at exactly ONE site in the whole
     * repository, as the disconnected-reload fallback: when realtime is down
     * after a drag completes, sprints are reloaded explicitly because no push
     * will arrive. Preserving that read is behavioural parity, not a nicety.
     */
    connected: boolean;

    /**
     * `:195-217`. Subscribes `callback` to `routingKey`.
     *
     * `scope` is NULLABLE, and React always passes `null`. That is safe by
     * construction rather than by convention: the implementation's last line
     * (`:217`) is `scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope`,
     * so with `null` NO automatic teardown is registered and the caller owns
     * unsubscription. The React contract therefore MUST call `unsubscribe` in
     * its effect cleanup -- this is the single easiest place in the migration to
     * leak, and the leak is silent: it shows up only as duplicate refreshes
     * after navigating away and back.
     *
     * Subscribing while the service is in its error state is a no-op (`:196-197`).
     */
    subscribe(
        scope: AngularLifecycleScope | null,
        routingKey: string,
        callback: (data: unknown) => void,
        options?: ResourceParams,
    ): void;

    /** `:219-229`. Unsubscribes from `routingKey`. Also a no-op while in error. */
    unsubscribe(routingKey: string): void;
}

/**
 * `$translate` -- angular-translate, narrowed to the three members the bridge
 * needs. All user-visible copy flows through it; no string is ever hardcoded in
 * React.
 */
interface TranslateService {
    /**
     * Synchronous lookup with optional interpolation values. The only member
     * either in-scope module calls, and the one the sibling `useTranslate` hook
     * wraps.
     */
    instant(translationId: string, interpolateParams?: ResourceParams): string;

    /**
     * The active language tag. Consumed by
     * `app/coffee/modules/base/http.coffee:26` to build the `Accept-Language`
     * header, so React reading it sees exactly what the transport sends.
     */
    preferredLanguage(): string;

    /**
     * The whole translation table for one language, for the rare case that a
     * key must be probed before use rather than resolved.
     */
    getTranslationTable(langKey: string): Record<string, unknown>;
}

/**
 * `$tgConfirm` -- the confirmation and notification service
 * (`app/coffee/modules/common/confirm.coffee`, registered at `:321`), narrowed
 * to the two members the two in-scope modules call.
 *
 * Members excluded by the membership rule: `ask`, `askDelete`, `askChoice`,
 * `error`, `success`, `loader` and `hide`.
 */
interface ConfirmService {
    /**
     * `:118-121`. The delete confirmation. Supplies the default subtitle from
     * the `NOTIFICATION.ASK_DELETE` key when `subtitle` is omitted (`:119-120`),
     * then delegates to `askDelete`. Resolves when the user confirms.
     */
    askOnDelete<TResult = unknown>(
        title: string,
        message: string,
        subtitle?: string,
    ): AngularPromise<TResult>;

    /**
     * `:271`. The toast. `type` selects the notification stylesheet class --
     * `error`, `success` or `light-error` per the note at `:272-274` -- and
     * `time` overrides the default dismissal delay in milliseconds.
     */
    notify(type: string, message?: string, title?: string, time?: number): void;
}

/**
 * `tgErrorHandlingService` -- the full-page error surface
 * (`app/modules/services/error-handling.service.coffee`, registered at `:37`).
 *
 * `permissionDenied` is the only member either in-scope module calls, and it is
 * the screen-level gate: a project with the Kanban or the Backlog module
 * deactivated routes here rather than rendering. `notfound`, `error` and `block`
 * exist on the service and are excluded by the membership rule; `init` is called
 * once at application start and must not be called from React.
 */
interface ErrorHandlingService {
    /** Shows the permission-denied view for the whole page. */
    permissionDenied(): void;
}

/**
 * `tgProjectService` -- the shared current-project service
 * (`app/modules/services/project.service.coffee`, registered at `:115`).
 *
 * The permission members are the reason this service is in the map at all:
 * React must read the SAME `my_permissions` array the `tg-check-permission` and
 * `tg-class-permission` directives read, and must compute no independent notion
 * of what the user may do (section 5 of the file header).
 */
interface ProjectService {
    /**
     * The current project as a PERSISTENT structure -- flatten it with `toJS()`
     * before it enters React state, following the house precedent at
     * `app/modules/components/project-menu/project-menu.controller.coffee:27`.
     * `null` before a project has been set.
     *
     * In practice React receives the project ALREADY FLATTENED through the
     * bridge payload, so reading it here is the exception rather than the rule.
     */
    project: PersistentStructure | null;

    /**
     * `:95-100`. Re-fetches the current project by its slug and re-publishes it.
     * Resolves once the refreshed project has been set; a no-op returning
     * `undefined` when no project is set yet (`:96`).
     */
    fetchProject(): AngularPromise<void> | undefined;

    /**
     * `:102-103`. Membership test against the project's `my_permissions` array
     * -- `add_us`, `modify_us`, `view_milestones` and the rest.
     */
    hasPermission(permission: string): boolean;

    /**
     * `:108-110`. `hasPermission` AND not archived. This is the correct gate for
     * anything that WRITES, because an archived project denies every edit
     * regardless of role (`:105-106`).
     */
    canEdit(permission: string): boolean;
}

/**
 * `$tgStorage` -- the browser local-storage wrapper
 * (`app/coffee/modules/base/storage.coffee:11-42`, registered at `:46`), which
 * JSON-serialises on write and parses on read, yielding `null` on malformed
 * data (`:23-24`).
 *
 * Narrowed to `get` and `set`, the two members the in-scope screens use -- the
 * burndown-collapsed flag is persisted under the hash of the key
 * `"is-burndown-grpahs-collapsed"` (`app/coffee/modules/backlog/main.coffee:1290`;
 * the misspelling is PRESERVED because it is a persisted key and correcting it
 * would silently reset every user's preference). `contains`, `remove` and
 * `clear` are excluded by the membership rule.
 *
 * This is also where the JWT lives. Section 5 of the file header records that as
 * a known weakness deliberately left NO WORSE.
 */
interface StorageService {
    /**
     * `:17-25`. Reads and parses. Returns `_default` when the key is absent, and
     * `null` when no default was supplied or the stored value will not parse.
     */
    get<TValue>(key: string, _default?: TValue): TValue | null;

    /**
     * `:27-32`. Writes one key, or -- when passed an object -- every key of that
     * object, recursing per entry (`:28-30`).
     */
    set(key: string, val: unknown): void;
}

/**
 * `tgLightboxFactory` -- compiles a lightbox directive into the document body on
 * demand (`app/modules/services/lightbox-factory.service.coffee:13-31`,
 * registered at `:33`). Injected by the Kanban controller only.
 *
 * React TRIGGERS the retained AngularJS lightboxes through this factory and does
 * not reimplement them: the bulk-create-user-stories lightbox and the
 * create/edit lightbox stay AngularJS, which is why the shared
 * `lightbox-us-bulk` partial remains in both surviving Jade shells.
 */
interface LightboxFactoryService {
    /**
     * `:13-31`. Builds `<div [name] tg-bind-scope class="remove-on-close">`,
     * merges `scopeAttrs` onto a fresh child scope (`:16`), compiles it and
     * appends it to the document body. Returns NOTHING (`:31`) -- there is no
     * handle to close it with; the lightbox removes itself on close via the
     * class added at `:26`.
     */
    create(name: string, attrs?: ResourceParams, scopeAttrs?: ResourceParams): void;
}

/**
 * `tgLoader` -- the page-load indicator
 * (`app/coffee/modules/common/loader.coffee:78-85`, registered as a factory at
 * `:102`). Narrowed to the two members the in-scope screens call; `onStart` is
 * excluded by the membership rule.
 */
interface LoaderService {
    /**
     * `:80-83`. Starts the indicator. The `auto` flag defers the start to the
     * service's own automatic handling rather than starting immediately.
     */
    start(auto?: boolean): void;

    /**
     * `:78`, implemented at `:44-60`. Ends it. `force` skips the minimum-display
     * window, which otherwise keeps the indicator visible long enough to avoid a
     * flash on a fast load.
     */
    pageLoaded(force?: boolean): void;
}

/**
 * `$tgNavUrls` -- the named-route resolver
 * (`app/coffee/modules/base/navurls.coffee:39-46`, registered at `:47`).
 *
 * React resolves the SAME named routes the `tg-nav` directive resolves, so the
 * "SPRINT TASKBOARD" button keeps pointing at
 * `project-taskboard:project=...,sprint=...` and a card title keeps pointing at
 * the user-story detail screen -- both destinations stay AngularJS and stay out
 * of scope.
 */
interface NavigationUrlsService {
    /**
     * `:39-46`. Resolves a route name, interpolating `ctx` when given, and
     * strips the leading slash (`:43-45`). Returns `""` for an unknown name
     * (`:35`) rather than throwing.
     */
    resolve(name: string, ctx?: ResourceParams): string;
}

/**
 * `tgFilterRemoteStorageService` -- server-side persistence of a user's custom
 * filters, via the `user-storage` endpoint
 * (`app/modules/components/filter/filter-remote.service.coffee`, registered at
 * `:57`).
 *
 * Reached by the two controllers through their shared filters mixin rather than
 * directly, but declared because the custom-filter flows of both React toolbars
 * depend on it.
 */
interface FilterRemoteStorageService {
    /**
     * `:20-41`. Persists the filter set. Note the three-way behaviour: an EMPTY
     * set DELETEs the entry (`:24-27`), a non-empty set PUTs it, and a failed PUT
     * falls back to a POST (`:35-40`) because the entry may not exist yet.
     * Resolves with no value.
     */
    storeFilters(
        projectId: number,
        myFilters: ResourceParams,
        filtersHashSuffix: string,
    ): AngularPromise<void>;

    /**
     * `:43-55`. Reads the filter set back. NEVER REJECTS: a failed read resolves
     * `{}` (`:52-53`), so a first-time user is indistinguishable from a
     * transport failure here by design.
     */
    getFilters<TFilters = ResourceParams>(
        projectId: number,
        filtersHashSuffix: string,
    ): AngularPromise<TFilters>;
}

/**
 * `$tgAnalytics` -- event tracking
 * (`app/coffee/modules/common/analytics.coffee:72`, registered at `:181`).
 *
 * Declared so the four existing in-scope events keep firing with IDENTICAL
 * arguments -- creating and bulk-creating a user story on the Kanban board
 * (`kanban/main.coffee:277`, `:288`) and bulk-creating a story and creating a
 * sprint on the Backlog (`backlog/main.coffee:206`, `:214`). Rule T10 forbids
 * adding, removing or renaming any of them.
 */
interface AnalyticsService {
    /** `:72`. Category, action, label and numeric value, in that order. */
    trackEvent(category: string, action: string, label: string, value: number): void;
}

/* ==========================================================================
 * THE SERVICE MAP
 * ========================================================================== */

/**
 * Every AngularJS service React may resolve, keyed by the EXACT name the
 * service is registered under, mapped to its typed facade.
 *
 * This map is the contract of the whole bridge. Its keys are what make
 * `useAngularService('$tgResources')` return a typed value instead of an
 * unchecked one, and a name that is not a key here is a COMPILE ERROR at the
 * call site rather than a run-time `[$injector:unpr] Unknown provider` in the
 * browser. The fifteen keys are the intersection of "injected by a surviving
 * in-scope controller" and "legitimately reachable from React": the six names
 * quoted verbatim in section 2 that are absent -- both scope services, the
 * promise service, the route-params service, the location service, the timeout
 * service, the page-metadata service, `tgKanbanUserstories`, and the two
 * backlog-only services -- are absent for the reasons section 6 gives.
 *
 * Exported because `../shared/api/**` builds its typed facades on these shapes,
 * and because the co-located specs assert against them.
 */
export interface AngularServices {
    /** Aggregate resources service. See {@link TaigaResources}. */
    $tgResources: TaigaResources;

    /** The SECOND, distinct resources service. See {@link TaigaResources2}. */
    tgResources: TaigaResources2;

    /** Repository layer -- the only sanctioned write path. */
    $tgRepo: TaigaRepository;

    /** Model factory (Kanban controller only). */
    $tgModel: TaigaModelFactory;

    /** Realtime subscriptions over the frozen routing keys. */
    $tgEvents: TaigaEventsService;

    /** Translation -- every user-visible string. */
    $translate: TranslateService;

    /** Confirmations and toasts. */
    $tgConfirm: ConfirmService;

    /** Full-page error surface, including the screen-level permission gate. */
    tgErrorHandlingService: ErrorHandlingService;

    /** Current project and its permission gates. */
    tgProjectService: ProjectService;

    /** Browser local storage, JSON-wrapped. */
    $tgStorage: StorageService;

    /** On-demand lightbox compilation (Kanban controller only). */
    tgLightboxFactory: LightboxFactoryService;

    /** Page-load indicator. */
    tgLoader: LoaderService;

    /** Named-route resolution. */
    $tgNavUrls: NavigationUrlsService;

    /** Server-side custom-filter persistence. */
    tgFilterRemoteStorageService: FilterRemoteStorageService;

    /** Event tracking. */
    $tgAnalytics: AnalyticsService;
}

/* ==========================================================================
 * THE HOOKS
 * ========================================================================== */

/**
 * Reads the AngularJS injector out of the bridge context, or throws a
 * diagnostic that names both the hook and the service that was asked for.
 *
 * The sibling context uses `null` as its no-provider sentinel and DELEGATES the
 * diagnostic to this file on purpose (`./AngularBridgeContext.tsx:239-245`): a
 * throw at that module's scope would break the bundle for every screen,
 * including the out-of-scope AngularJS ones, whereas here the failure is scoped
 * to the one React subtree that is mis-mounted and is contained by the sibling
 * `ErrorBoundary` so the surrounding AngularJS shell survives it.
 *
 * Silently returning a nullish injector was the alternative and is strictly
 * worse: the symptom would surface much later, as an unreadable
 * property-of-undefined failure deep inside a data hook, with nothing naming
 * the missing provider.
 *
 * @param hookName - the public hook that was called, quoted back to the reader.
 * @param serviceName - the service that was asked for, quoted back to the reader.
 * @returns the live injector.
 * @throws Error when no provider is mounted above the caller.
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

/**
 * Fails loudly when the injector knows it has no provider registered under
 * `serviceName`.
 *
 * `has` is OPTIONAL on the injector type by deliberate design
 * (`./AngularBridgeContext.tsx:229-236`): it exists so this check can tell
 * "no provider registered" apart from "no provider found", while keeping the
 * lightweight `{ get }` doubles used throughout the co-located specs
 * structurally assignable. The check therefore fires ONLY when `has` is present
 * AND returns exactly `false`; a double that omits it is left alone, and the
 * resolution below proceeds exactly as it would in the browser.
 *
 * Without this, a missing AngularJS module registration surfaces as the raw
 * `[$injector:unpr] Unknown provider: <name>Provider` thrown from inside
 * AngularJS, which says nothing about the React side that asked.
 *
 * @param injector - the live injector.
 * @param hookName - the public hook that was called.
 * @param serviceName - the service that was asked for.
 * @throws Error when the injector positively reports the name as unregistered.
 */
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

/**
 * Resolves one AngularJS service, typed.
 *
 * The replacement for AngularJS constructor injection, and the ONLY sanctioned
 * way for React code to reach an AngularJS service:
 *
 * ```ts
 * const rs = useAngularService('$tgResources');
 * const events = useAngularService('$tgEvents');
 *
 * // AngularJS promises are marshalled at the call site, never awaited raw:
 * const stories = await toNativePromise(rs.userstories.listAll(projectId));
 * ```
 *
 * Behavioural contract, deliberately the smallest one that is correct:
 *
 * - **A PURE LOOKUP.** No state, no effect, no subscription, no timer, nothing
 *   to clean up. It is therefore safe to call unconditionally at the top of any
 *   component or hook, which is exactly what React's rules of hooks require.
 * - **RETURNED UNWRAPPED.** The service instance is handed back BY REFERENCE,
 *   with no proxy, no clone, no partial application and no memoisation.
 *   AngularJS services are singletons and `injector.get` is a cheap map lookup,
 *   so there is nothing to cache; a `useMemo` here would add a dependency array
 *   and buy nothing, while a wrapper would change the identity of a value whose
 *   stability every consuming effect's dependency array relies on.
 * - **NO DIGEST IS EVER TRIGGERED.** Digest cycles remain AngularJS's concern
 *   (section 6 of the file header).
 * - **NO TRANSPORT IS EVER CONSTRUCTED.** Rule T5, quoted verbatim in section 5.
 * - **FAILS LOUDLY, EARLY AND BY NAME** when the provider is missing or the
 *   service is unregistered.
 *
 * @typeParam K - a key of {@link AngularServices}; anything else is a compile
 *                error at the call site, which is the point.
 * @param name - the exact registered name of the service.
 * @returns the live service instance, typed as {@link AngularServices}`[K]`.
 * @throws Error when called outside `AngularBridgeProvider`, or when the
 *         injector positively reports `name` as unregistered.
 */
export function useAngularService<K extends keyof AngularServices>(
    name: K,
): AngularServices[K] {
    const injector = useAngularInjector('useAngularService', name);

    assertServiceIsRegistered(injector, 'useAngularService', name);

    // The type argument is what keeps the return precisely typed: the injector's
    // own `get` is generic (`./AngularBridgeContext.tsx:227`) specifically so
    // this mapped indexed access can be layered on top of it.
    return injector.get<AngularServices[K]>(name);
}

/**
 * Resolves a service NOT present in {@link AngularServices}, returning
 * `unknown`.
 *
 * The deliberate, greppable escape hatch. Section 6 of the file header excludes
 * several genuinely-injected services from the map on correctness grounds, and
 * without an escape a downstream file needing one would be forced either to
 * reach for the unsafe escape-hatch type or to edit this file. Both are worse
 * than one narrow, obvious, `unknown`-returning function.
 *
 * `unknown` -- never the unsafe escape-hatch type -- so the caller cannot touch
 * the value without narrowing it first, and every such narrowing is visible in
 * review:
 *
 * ```ts
 * const candidate = useUntypedAngularService('tgSomeOtherService');
 *
 * if (typeof candidate === 'object' && candidate !== null && 'reset' in candidate) {
 *     // narrowed -- safe to use
 * }
 * ```
 *
 * Kept as a SEPARATE named export rather than an overload of
 * {@link useAngularService} on purpose: an overload accepting `string` would be
 * selected silently whenever a caller passed a non-literal name, so an ordinary
 * typo in a variable-driven lookup would quietly lose its typing. A distinct
 * name cannot be reached by accident and shows up in one grep.
 *
 * Prefer adding a key to {@link AngularServices} whenever the service is one
 * React should legitimately reach; use this only when section 6 explains why it
 * is not.
 *
 * @param name - the exact registered name of the service.
 * @returns the live service instance, typed `unknown`.
 * @throws Error when called outside `AngularBridgeProvider`, or when the
 *         injector positively reports `name` as unregistered.
 */
export function useUntypedAngularService(name: string): unknown {
    const injector = useAngularInjector('useUntypedAngularService', name);

    assertServiceIsRegistered(injector, 'useUntypedAngularService', name);

    return injector.get<unknown>(name);
}

/* ==========================================================================
 * TYPE EXPORTS
 *
 * `isolatedModules: true` requires type-only exports to be declared as such.
 * Every structural interface is exported so `../shared/api/**` can build its
 * typed facades on these shapes -- and so a facade never has to redeclare one
 * and let the two definitions drift apart.
 * ========================================================================== */

export type {
    // Structural primitives
    AngularPromise,
    HttpHeadersGetter,
    AngularHttpResponse,
    PersistentStructure,
    TaigaModel,
    ResourceParams,
    // `$tgResources` namespaces
    UserStoriesResource,
    SprintsResource,
    SwimlanesResource,
    KanbanResource,
    ProjectsResource,
    TaigaResources,
    // `tgResources`
    AttachmentsResource,
    TaigaResources2,
    // Repository and model layer
    TaigaRepository,
    TaigaModelFactory,
    // Realtime, translation and UI services
    AngularLifecycleScope,
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
