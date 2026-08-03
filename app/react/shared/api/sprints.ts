/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * sprints.ts -- THE TYPED FACADE OVER THE FROZEN `milestones` ENDPOINT
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file, so every claim
 * below carries the `[path:locator]` it was measured from.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS
 * --------------------------------------------------------------------------
 * Four thin typed wrappers over the `sprints` sub-resource of the AngularJS
 * resources service (`app/coffee/modules/resources/sprints.coffee:13-60`), which
 * backs the frozen `milestones` endpoint registered at
 * `app/coffee/modules/resources.coffee:92` as `/milestones`. Goal G2 names
 * `milestones` explicitly among the endpoints that must be reused "exactly as
 * resolved today", so nothing here changes an endpoint, a request shape, a query
 * parameter, a body key, a response field or a response header.
 *
 * The four wrappers correspond one-to-one with the four in-contract members:
 *
 *   {@link getSprint}                  -- `sprints.coffee:16-21`
 *   {@link getSprintStats}             -- `sprints.coffee:23-24`
 *   {@link listSprints}                -- `sprints.coffee:26-42`
 *   {@link moveUserStoriesToMilestone} -- `sprints.coffee:44-47`
 *
 * --------------------------------------------------------------------------
 * 2. RULE T5 -- NO PARALLEL HTTP CLIENT (verbatim)
 * --------------------------------------------------------------------------
 *     "Reuse `$tgResources`; do not build a parallel HTTP client. New
 *      TypeScript files are typed facades over the existing repository layer."
 *
 * So this file contains NO transport of its own: no browser request or XHR API,
 * no third-party HTTP client, no socket API, and no direct use of the AngularJS
 * HTTP service. It never resolves a URL either -- the named-URL registry is read
 * INSIDE the incumbent method (`sprints.coffee:45`), never here, which is why no
 * path is ever composed, concatenated or interpolated in this module. The two
 * frozen registry paths are cited in comments purely as provenance.
 *
 * Because every call keeps flowing through the resources service into the
 * repository layer and on to the shared AngularJS transport, React INHERITS
 * rather than re-derives all of the following (requirement I7):
 *
 *   - the bearer authorization header and the language header, built at
 *     `app/coffee/modules/base/http.coffee:21-23` and `:26-28` and merged into
 *     every request at `:33`, where the service's own header bag WINS over
 *     per-call headers;
 *   - the session header, plus the JSON content type on the write verbs
 *     (`app/coffee/app.coffee:590-599`), while a read receives the session
 *     header alone (`:600-602`);
 *   - the SINGLE-FLIGHT token refresh on 401 (`app/coffee/app.coffee:609-610`),
 *     so concurrent requests do not each trigger their own refresh;
 *   - the 400-carrying-`version` conflict toast, shown for 10,000 ms -- the only
 *     way an optimistic-concurrency conflict becomes visible to the user;
 *   - the 451 blocked-project interceptor;
 *   - the status-0 / status-(-1) path that closes open lightboxes and shows the
 *     full-page connection-error view;
 *   - read de-duplication: the transport installs a shared cache on a read and
 *     clears it once the request settles, so concurrent identical reads collapse
 *     into one round trip. Nothing here reimplements or defeats that.
 *
 * Most important of all, the model layer's dirty tracking is a DATA-INTEGRITY
 * guarantee rather than an optimisation: `getAttrs(true)`
 * (`app/coffee/modules/base/model.coffee:48-54`) copies the optimistic-
 * concurrency `version` into the modified set at `:49-50` and returns ONLY the
 * changed fields, and the repository short-circuits an unmodified model with no
 * request at all (`app/coffee/modules/base/repository.coffee:57-59`). A
 * hand-rolled client would serialise whole objects instead, turning every edit
 * into a potential SILENT LOST UPDATE that surfaces only on the next page load.
 *
 * --------------------------------------------------------------------------
 * 3. THE FOUR SILENT-FAILURE MODES THIS FILE EXISTS TO MAKE IMPOSSIBLE
 * --------------------------------------------------------------------------
 * Four short methods, four distinct ways to break the screen with NO error
 * surface at all. Each is typed explicitly and commented at its point of change:
 *
 *   (a) A MISSPELLED CUSTOM RESPONSE HEADER yields a not-a-number count under a
 *       perfectly successful HTTP 200. See {@link listSprints}.
 *   (b) THE `closed` COLLISION. On the list envelope `closed` is a COUNT; on the
 *       domain model `closed` is a BOOLEAN. Typing one as the other compiles and
 *       then lies. See {@link SprintListEnvelope}.
 *   (c) A TRANSPOSED SOURCE/DESTINATION ARGUMENT moves stories to the wrong
 *       sprint under HTTP 200. See {@link moveUserStoriesToMilestone}.
 *   (d) A SHALLOW FLATTEN of a sprint still leaves model instances nested inside
 *       its stories, which the structural-state library cannot proxy. See
 *       section 6 and {@link SprintModelAttrs}.
 *
 * --------------------------------------------------------------------------
 * 4. WHY THE SERVICE ARRIVES AS A PARAMETER, AND WHY THERE IS NO HOOK HERE
 * --------------------------------------------------------------------------
 * Every function takes the live `sprints` namespace as its FIRST argument. This
 * module deliberately contains no React hook and never reaches for the injector
 * itself; the screen's own hooks own the single service lookup and pass the
 * namespace in.
 *
 * That is requirement I9, verbatim: "The >=70% coverage gate forces a
 * presentational/container split. Jest runs browserless in jsdom with no `dist/`
 * dependency, so data-fetching and drag effects must be isolated in hooks and
 * containers, leaving pure components independently testable." Keeping these
 * four functions parameterised makes them plain async functions, so the
 * co-located spec exercises them with a small structural double and no injector,
 * no provider tree and no browser.
 *
 * Each function's service parameter is NARROWED to the single member it calls,
 * which is what keeps those doubles honest: a spec cannot accidentally satisfy a
 * signature by supplying a look-alike for some OTHER member.
 *
 * --------------------------------------------------------------------------
 * 5. THE BRIDGE'S MEMBERSHIP RULE, AND WHY THREE MEMBERS ARE DECLARED LOCALLY
 * --------------------------------------------------------------------------
 * The injector surface is owned by `../../bridge/useAngularService`, and this
 * file only READS it -- the declared surface is obtained by INDEXING that map so
 * a rename there breaks compilation here instead of letting two descriptions
 * drift apart.
 *
 * That map declares a member only when an IN-SCOPE AngularJS module calls it,
 * and by that rule it declares just `list` for this namespace
 * (`../../bridge/useAngularService.ts:599-618`, whose own comment names the
 * exclusions). The other three members required by this file's contract are
 * excluded because their only callers are OUT OF SCOPE -- measured:
 * `app/coffee/modules/taskboard/main.coffee:417` and `:440`,
 * `app/coffee/modules/tasks/detail.coffee:147`,
 * `app/coffee/modules/issues/detail.coffee:158` and
 * `app/coffee/modules/userstories/detail.coffee:210`.
 *
 * All three exist at run time regardless: the provider installs them on the same
 * object literal as `list` (`sprints.coffee:16`, `:23`, `:44`). Since
 * `app/react/bridge/**` is NOT this file's to edit, they are declared locally in
 * {@link SprintsResourceUndeclaredMembers} -- exactly those three, so nothing
 * else can creep in -- which keeps all four facades fully typed with no escape
 * hatch and no suppression comment. This mirrors the pattern the sibling
 * user-story facade already established for the same reason.
 *
 * --------------------------------------------------------------------------
 * 6. FLATTENING IS THE CALLER'S JOB -- AND IT IS TWO LEVELS DEEP (P-IMMER-1)
 * --------------------------------------------------------------------------
 * `getSprint` and `listSprints` resolve MODEL INSTANCES, and the nesting is TWO
 * LEVELS deep: the incumbent re-wraps each nested user story as its own model
 * and writes the result straight into the private attribute slot -- for one
 * sprint at `sprints.coffee:18-20`, and ONCE PER MILESTONE at `:33-36`.
 *
 * Two consequences, both load-bearing:
 *
 *   - A model's attributes are accessor pairs installed with
 *     `Object.defineProperty` over the private slots
 *     (`app/coffee/modules/base/model.coffee:94-101`), NOT plain data
 *     properties, and its methods live on a prototype. Spreading a model
 *     therefore loses its methods, leaks the private bookkeeping fields, and
 *     silently omits every attribute that was written after construction and so
 *     never got an accessor. `getAttrs()` is the sanctioned flatten.
 *   - Even a correct flatten of the SPRINT leaves `user_stories` holding model
 *     instances, so the stories must be flattened too. That second level is the
 *     easiest thing in this file to miss, which is why it is encoded in the type
 *     itself: see {@link SprintModelAttrs}.
 *
 * This facade performs NEITHER flatten. Doing so would transform a payload the
 * caller may want to hand straight back to the repository's write path with its
 * dirty tracking intact, and unrequested transformation is exactly what T10
 * forbids. The house precedent for flattening AT THE BOUNDARY is
 * `app/modules/components/project-menu/project-menu.controller.coffee:21` and
 * `:27`. (For the record, the plan cites that second call at `:28`; the measured
 * locator is `:27`, and `:28` is the closing brace.)
 *
 * The structural-state library rejects class instances and its automatic
 * freezing would freeze a structure AngularJS still iterates, so a model must
 * never reach React state or a draft unflattened.
 *
 * --------------------------------------------------------------------------
 * 7. WHAT THIS FILE DELIBERATELY DOES NOT DO
 * --------------------------------------------------------------------------
 * T10 -- no functional or feature change whatsoever; the design frames license
 * layout fidelity alone. Concretely, and each one is a deliberate omission:
 *
 *   - NO retry, NO timeout, NO cancellation, NO cache of its own.
 *   - NO coercion of a not-a-number count to zero (see {@link listSprints}).
 *   - NO date parsing, formatting or normalisation. `estimated_start` and
 *     `estimated_finish` are `"YYYY-MM-DD"` STRINGS on the wire and stay
 *     strings, never date objects; they are passed through untouched.
 *   - NO sorting of the returned milestones. The incumbent sorts each sprint's
 *     stories by their sprint order in the CONTROLLER
 *     (`app/coffee/modules/backlog/main.coffee:291-292`, `:317-318`), not in the
 *     resource layer, so sorting here would relocate behaviour.
 *   - NO merging of the list and statistics reads into one round trip.
 *   - NO pagination. The incumbent list passes an empty options object
 *     (`sprints.coffee:29`), so the repository sends the disable-pagination
 *     header (`app/coffee/modules/base/repository.coffee:139-140`) and the FULL
 *     milestone list comes back. Adding pagination would change the request.
 *   - NO fifth function, and specifically no facade for the sibling
 *     `moveTasksMilestone` / `moveIssuesMilestone` members (`sprints.coffee:49-57`):
 *     tasks and issues belong to the out-of-scope taskboard and issues screens.
 *   - NO state of its own. These are stateless functions. The backlog's drag
 *     serialisation -- its first-in-first-out `pendingDrag` queue and the
 *     re-entrancy guard keyed on the drag context
 *     (`app/coffee/modules/backlog/main.coffee:84`, `:539-546`, `:600-601`,
 *     `:603-618`, `:620-629`) -- belongs to the backlog reducer and its drag
 *     hook. Reproducing it here would double-implement the guard.
 *   - NO reload fallback. The disconnected-realtime reload triggered at
 *     `app/coffee/modules/backlog/main.coffee:634` is the hook's business.
 *   - NO permission helper. React reads the same permission array the
 *     AngularJS permission directives read and computes no independent notion of
 *     what the user may do.
 *   - NO token access. The session token stays where the storage service keeps
 *     it; nothing here reads or writes it.
 *
 * One more measured detail, recorded so it is not mistaken for an omission: the
 * provider is constructed with the storage service among its dependencies
 * (`sprints.coffee:13`, `:62-64`) but NEVER USES IT. Unlike the user-story
 * namespace, this one has no storage-backed helpers, so there is nothing
 * synchronous to facade and no local-storage wrapper belongs here.
 *
 * No colour literal appears anywhere in this file: rule T2 keeps status, tag and
 * epic colours DATA, bound from the payload.
 * ========================================================================== */

import { toNativePromise } from '../../bridge/toNativePromise';
import type {
    AngularHttpResponse,
    AngularPromise,
    AngularServices,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { Sprint } from '../types/sprint';
import type { UserStory } from '../types/userStory';

/* ==========================================================================
 * THE SERVICE SURFACE
 * ========================================================================== */

/**
 * The `sprints` sub-resource, as the bridge types it.
 *
 * Obtained by INDEXING the imported service map rather than redeclared, so this
 * file never owns a second, divergent description of the same object. By the
 * bridge's membership rule this contributes exactly one member, `list`; the
 * other three arrive from {@link SprintsResourceUndeclaredMembers}. Section 5 of
 * the file header explains why the split exists.
 */
type SprintsResource = AngularServices['$tgResources']['sprints'];

/**
 * The three members the bridge's membership rule deliberately leaves out.
 *
 * Every signature below is transcribed from the frozen provider, positional
 * order included, because the positional order IS the contract -- see
 * {@link moveUserStoriesToMilestone} for the argument whose transposition is
 * silent. Kept to exactly these three members.
 */
interface SprintsResourceUndeclaredMembers {
    /**
     * `sprints.coffee:16-21`. One sprint, as a model, with its stories re-wrapped
     * as models in place at `:18-20`.
     *
     * The first parameter is accepted and NEVER READ by the incumbent; it is part
     * of the signature all the same, so it must still be supplied positionally.
     */
    get<TAttrs = Record<string, unknown>>(
        projectId: number,
        sprintId: number,
    ): AngularPromise<TaigaModel<TAttrs>>;

    /**
     * `sprints.coffee:23-24`. The sprint statistics, as PLAIN parsed data rather
     * than a model: the incumbent uses the repository's raw query, which returns
     * the parsed body itself (`app/coffee/modules/base/repository.coffee:180`).
     *
     * The sub-path is composed INSIDE that method (`sprints.coffee:24`), so a
     * caller supplies the sprint id and never a path. The first parameter is
     * again accepted and never read.
     */
    stats<TStats = unknown>(projectId: number, sprintId: number): AngularPromise<TStats>;

    /**
     * `sprints.coffee:44-47`. Moves open user stories from one sprint to another.
     *
     * The FIRST id is the SOURCE and lands in the URL path; the THIRD is the
     * DESTINATION and lands in the request body. See
     * {@link moveUserStoriesToMilestone}.
     */
    moveUserStoriesMilestone<TResult = unknown>(
        currentMilestoneId: number,
        projectId: number,
        milestoneId: number | null,
        data: readonly MoveUserStoriesEntry[],
    ): AngularPromise<AngularHttpResponse<TResult>>;
}

/* ==========================================================================
 * THE FROZEN PAYLOAD SHAPES
 * ========================================================================== */

/**
 * The attribute shape a sprint MODEL wraps, as it actually arrives.
 *
 * ⭐⭐ T9 / P-IMMER-1, ENCODED IN THE TYPE RATHER THAN ONLY IN PROSE. This is the
 * domain sprint with ONE field re-typed: `user_stories` holds MODEL INSTANCES,
 * not plain stories, because the incumbent re-wraps every nested story and writes
 * the result into the private attribute slot (`sprints.coffee:18-20` for a single
 * sprint, `:33-36` once per milestone in the list).
 *
 * So flattening a sprint with `getAttrs()` yields a value whose `user_stories`
 * is STILL an array of models -- the second level of the hazard described in
 * section 6 of the file header. Re-typing the field here means the compiler says
 * so at every call site: a caller that treats an element as a plain story gets a
 * type error instead of a structure the state library cannot proxy.
 *
 * Everything else is the frozen domain shape, `../types/sprint` unchanged --
 * including the two `"YYYY-MM-DD"` date STRINGS, which stay strings.
 */
type SprintModelAttrs = Omit<Sprint, 'user_stories'> & {
    /** Nested stories, each still a model. Flatten each one before use. */
    readonly user_stories: ReadonlyArray<TaigaModel<UserStory>>;
};

/**
 * The envelope {@link listSprints} resolves -- an OBJECT, never a bare array.
 *
 * ⭐⭐ T9 -- THE `closed` COLLISION, THE SINGLE EASIEST MISTAKE IN THIS FILE.
 * `closed` HERE IS A COUNT (a number: how many closed milestones the project
 * has), whereas `closed` on the domain sprint is a BOOLEAN (whether that one
 * sprint is closed) -- `../types/sprint`. The two are unrelated despite sharing a
 * name, which is precisely why this envelope is described by its own type instead
 * of being folded into the domain model. Typing the count as a boolean would
 * compile cleanly and then lie about the project's state.
 *
 * ⭐⭐ T9 -- WHERE THE TWO COUNTS COME FROM, AND WHY THEY MAY BE NOT-A-NUMBER.
 * The incumbent asks the repository for the header accessor by passing its
 * `headers` flag (`sprints.coffee:29`), so the repository resolves the TWO-ELEMENT
 * TUPLE `[models, headersGetter]` rather than a bare array
 * (`app/coffee/modules/base/repository.coffee:145-146`). The second element is a
 * FUNCTION called with a header name, NOT a dictionary to index
 * (`sprints.coffee:31`). The incumbent then reads two CUSTOM RESPONSE HEADERS
 * that are part of the frozen contract (G2) and must be spelled EXACTLY:
 *
 *     closed: parseInt(headers("Taiga-Info-Total-Closed-Milestones"), 10)
 *     open:   parseInt(headers("Taiga-Info-Total-Opened-Milestones"), 10)
 *
 * -- `sprints.coffee:40-41`. Three details in there are load-bearing:
 *
 *   1. The header says "Opened" while THIS FIELD says `open`. The asymmetry is
 *      the contract; correcting either one breaks it.
 *   2. The radix argument `10` is explicit and stays explicit. Substituting a
 *      numeric coercion or a floating-point parse would be a behaviour change.
 *   3. A MISSING header legitimately parses to NOT-A-NUMBER, and that value
 *      PROPAGATES. Defaulting it to zero would invent a count the server never
 *      sent, and would do so under a successful HTTP 200 with nothing logged --
 *      which is exactly why this facade adds no coercion (T10).
 *
 * @typeParam TAttrs - attribute shape of each resolved milestone model.
 */
interface SprintListEnvelope<TAttrs> {
    /** The milestones, as MODEL instances. Flatten both levels before use. */
    readonly milestones: ReadonlyArray<TaigaModel<TAttrs>>;

    /** COUNT of closed milestones -- not a flag. May be not-a-number. */
    readonly closed: number;

    /** COUNT of open milestones -- from the "Opened" header. May be not-a-number. */
    readonly open: number;
}

/**
 * The sprint-statistics body, as PLAIN parsed data.
 *
 * ⭐ T9 -- MEASURED, NOT GUESSED, AND DELIBERATELY INCOMPLETE-LOOKING. These four
 * fields are the ones the only existing consumer actually reads off the response
 * (`app/coffee/modules/taskboard/main.coffee:418-421`). The two point fields are
 * read there as MAPS -- their values are summed after being enumerated -- which is
 * why they are keyed records rather than numbers.
 *
 * What is ABSENT is as deliberate as what is present. That same consumer then
 * writes several further fields onto its own view state at `:422-431` -- the point
 * sums, the remaining counts and the completion percentage. Those are DERIVED BY
 * THE CONTROLLER and are NOT wire fields, so declaring them here would invent
 * response data. Deriving them here would relocate behaviour, which T10 forbids.
 *
 * Declared locally in this file rather than in `../types/**`, because it is a raw
 * response payload rather than a domain model, and because this folder's file
 * list is fixed: no shared types module is added for it.
 */
interface SprintStatsResponse {
    /** Total points, keyed by role. Enumerated and summed by the caller. */
    readonly total_points: Readonly<Record<string, number>>;

    /** Completed points, keyed by role. Enumerated and summed by the caller. */
    readonly completed_points: Readonly<Record<string, number>>;

    /** Total task count for the sprint. */
    readonly total_tasks: number;

    /** Completed task count for the sprint. */
    readonly completed_tasks: number;
}

/**
 * One entry of the story-move payload.
 *
 * ⭐ T9 -- NOT A BARE ID, WHICH A NAME LIKE "story ids" WOULD IMPLY. The
 * incumbent lightbox builds each entry as a story id PLUS that story's sprint
 * order (`app/modules/components/move-to-sprint/move-to-sprint.controller.coffee:57-63`),
 * and its passing spec pins the exact shape
 * (`app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee:73-76`).
 * Dropping the order field would silently discard the ordering the server is
 * being asked to apply.
 *
 * A type alias rather than an interface, for the implicit index signature that
 * keeps it assignable to the generic parameter bag the frozen signature declares.
 */
type MoveUserStoriesEntry = {
    /** The user story to move. */
    readonly us_id: number;

    /** That story's sprint order, carried through untouched. */
    readonly order: number;
};

/* ==========================================================================
 * THE MEMBER VIEWS THE FACADES CONSUME
 *
 * ⭐ T9 -- WHY A VIEW RATHER THAN THE MEMBER ITSELF. Every member of the frozen
 * namespace is GENERIC over the shape it hands back. A facade settles exactly one
 * of those type arguments and then needs nothing else from the member, so each
 * view below takes its PARAMETER LIST straight from the declaration via
 * `Parameters<>` -- so a signature change still breaks compilation here rather
 * than drifting silently -- and pins the RETURN to the single instantiation the
 * facade uses.
 *
 * The generic member satisfies its view, because a generic signature is
 * assignable to every instantiation of itself, so passing the live namespace
 * type-checks at each real call site. Pinning the return additionally keeps each
 * view inhabitable by an ORDINARY, non-generic function, which is what lets the
 * co-located spec hand in a structural recording double with no escape hatch and
 * no suppression comment. Nothing here changes a value that reaches the wire;
 * these are descriptions of the frozen surface, narrowed per facade.
 * ========================================================================== */

/** `sprints.coffee:16-21` as {@link getSprint} uses it: one sprint, as a model. */
interface GetMember<TAttrs> {
    (...args: Parameters<SprintsResourceUndeclaredMembers['get']>): AngularPromise<
        TaigaModel<TAttrs>
    >;
}

/** `sprints.coffee:23-24` as {@link getSprintStats} uses it: PLAIN parsed data. */
interface StatsMember<TStats> {
    (...args: Parameters<SprintsResourceUndeclaredMembers['stats']>): AngularPromise<TStats>;
}

/**
 * `sprints.coffee:26-42` as {@link listSprints} uses it: the header-derived
 * ENVELOPE, never a bare array. Built over the bridge's own declaration, since
 * this is the one member its membership rule does declare.
 */
interface ListMember<TAttrs> {
    (...args: Parameters<SprintsResource['list']>): AngularPromise<SprintListEnvelope<TAttrs>>;
}

/** `sprints.coffee:44-47` as {@link moveUserStoriesToMilestone} uses it. */
interface MoveUserStoriesMilestoneMember<TResult> {
    (
        ...args: Parameters<SprintsResourceUndeclaredMembers['moveUserStoriesMilestone']>
    ): AngularPromise<AngularHttpResponse<TResult>>;
}

/* ==========================================================================
 * THE FACADES
 * ========================================================================== */

/**
 * Reads one sprint, with its user stories.
 *
 * ⭐⭐ T9 -- THE ANGULARJS-TO-REACT SEAM IS THE `toNativePromise` CALL BELOW, and
 * it is the same at all four facades. The resources service resolves AngularJS
 * promises, NOT native ones: they are created by the AngularJS promise service
 * and settle on its digest cycle. The marshaller in `../../bridge/toNativePromise`
 * adopts such a promise into a native one, passing the fulfilment value and the
 * rejection reason through UNTOUCHED -- which is what keeps the interceptor
 * behaviours listed in section 2 of the file header observable to React, since
 * several of them surface as rejection values.
 *
 * Two prohibitions live at this seam. React never triggers an AngularJS digest --
 * digests stay AngularJS's concern and React state updates are driven by React;
 * the transport already schedules its own digest for the response. And the
 * promise service itself is never handed to React: promises cross the boundary
 * through this marshaller alone.
 *
 * ⭐ T9 -- THE FIRST PARAMETER AFTER THE SERVICE IS NEVER READ BY THE INCUMBENT.
 * `sprints.coffee:16` declares a project id and its body never references it: the
 * repository looks the sprint up by id alone at `:17`. It is named with a leading
 * underscore HERE to record that fact for the reader at the point of change, and
 * it is nonetheless FORWARDED POSITIONALLY, because the positional signature is
 * the contract -- omitting it would shift the sprint id into the first slot. It is
 * retained rather than dropped for exactly that signature fidelity (T10).
 *
 * ⭐⭐ P-IMMER-1, TWO LEVELS DEEP: this resolves a MODEL whose `user_stories` are
 * ALSO models (`sprints.coffee:18-20`). Flatten the sprint with `getAttrs()` AND
 * then flatten each story before either reaches React state or a draft. This
 * facade performs neither flatten -- section 6 of the file header explains why the
 * caller owns both. The default attribute type states the hazard: see
 * {@link SprintModelAttrs}.
 *
 * @typeParam TAttrs - attribute shape of the resolved model.
 * @param sprints - the live resource namespace, narrowed to the member used. It
 *   must expose the member the bridge's membership rule omits (section 5).
 * @param _projectId - accepted for signature parity and forwarded unchanged;
 *   never read by the incumbent.
 * @param sprintId - the sprint to read.
 * @returns the sprint, as a model instance, exactly as the incumbent resolved it.
 */
export async function getSprint<TAttrs = SprintModelAttrs>(
    sprints: { readonly get: GetMember<TAttrs> },
    _projectId: number,
    sprintId: number,
): Promise<TaigaModel<TAttrs>> {
    return toNativePromise<TaigaModel<TAttrs>>(sprints.get(_projectId, sprintId));
}

/**
 * Reads one sprint's statistics.
 *
 * ⭐ T9 -- THE ASYMMETRY WITH {@link getSprint}, WHICH IS EASY TO GET BACKWARDS.
 * This member goes through the repository's RAW query, which resolves the parsed
 * body itself rather than wrapping it in a model
 * (`app/coffee/modules/base/repository.coffee:180`). So the resolved value is
 * PLAIN DATA: there is no `getAttrs()` to call, P-IMMER-1 does not apply, and it
 * is safe to place in React state as-is. Its sibling `getSprint` is the opposite
 * on every one of those points.
 *
 * ⭐ T9 -- NO PATH IS BUILT HERE. The `stats` sub-path is composed INSIDE the
 * incumbent method (`sprints.coffee:24`); a caller supplies the sprint id and
 * nothing else (rule T5).
 *
 * ⭐ T9 -- as with {@link getSprint}, the project id is accepted and NEVER READ by
 * the incumbent (`sprints.coffee:23`); it is underscore-named to record that and
 * still forwarded positionally so the signature stays the contract.
 *
 * The default payload type is deliberately narrow and deliberately free of
 * derived fields -- see {@link SprintStatsResponse}.
 *
 * @typeParam TStats - shape of the parsed body; the measured wire shape by default.
 * @param sprints - the live resource namespace, narrowed to the member used. It
 *   must expose the member the bridge's membership rule omits (section 5).
 * @param _projectId - accepted for signature parity and forwarded unchanged;
 *   never read by the incumbent.
 * @param sprintId - the sprint whose statistics to read.
 * @returns the statistics body, as plain data.
 */
export async function getSprintStats<TStats = SprintStatsResponse>(
    sprints: { readonly stats: StatsMember<TStats> },
    _projectId: number,
    sprintId: number,
): Promise<TStats> {
    return toNativePromise<TStats>(sprints.stats(_projectId, sprintId));
}

/**
 * Lists a project's milestones, together with the two header-derived counts.
 *
 * ⭐⭐ T9 -- RESOLVES AN ENVELOPE, NOT AN ARRAY, and the counts inside it come from
 * two custom response headers rather than from the body. The full account of
 * those headers -- their exact spelling, the "Opened"-versus-`open` asymmetry, the
 * explicit radix, and why a missing header must keep propagating as not-a-number
 * -- is on {@link SprintListEnvelope}, which is also where the `closed`-is-a-count
 * collision is recorded. Read it before consuming either count.
 *
 * ⭐ T9 -- THE PARAMETER BAG IS BUILT INSIDE THE INCUMBENT, and this facade does
 * not pre-build it. `sprints.coffee:27` seeds it with the SINGULAR key `project`
 * (not a plural), and `:28` then merges the caller's filters OVER that seed, into
 * a fresh object. Both in-scope callers pass a single closed-state filter --
 * `{closed: true}` at `app/coffee/modules/backlog/main.coffee:282-283` for the
 * closed sprints, and `{closed: false}` at `:305-306` for the open ones -- so the
 * one method serves both lists. Filters are forwarded VERBATIM.
 *
 * The filters argument is optional here because it is optional there: the
 * incumbent coalesces a falsy value to an empty object at `:28`.
 *
 * ⭐ T10 -- the result is NOT paginated and NOT sorted; section 7 of the file
 * header records why adding either would change behaviour.
 *
 * ⭐⭐ P-IMMER-1, TWO LEVELS DEEP AGAIN -- and this is the level the plan's summary
 * omits. The incumbent re-wraps the nested stories ONCE PER MILESTONE at
 * `sprints.coffee:33-36`, so EVERY milestone in the envelope carries models inside
 * models. Flatten both levels at the caller.
 *
 * @typeParam TAttrs - attribute shape of each resolved milestone model.
 * @param sprints - the live resource namespace, narrowed to the member used.
 * @param projectId - owning project; seeds the parameter bag under the singular key.
 * @param filters - merged over that seed and forwarded verbatim. Optional and
 *   nullable, matching the incumbent's own coalescing.
 * @returns the milestones plus the two counts, exactly as the incumbent built them.
 */
export async function listSprints<TAttrs = SprintModelAttrs>(
    sprints: { readonly list: ListMember<TAttrs> },
    projectId: number,
    filters?: ResourceParams | null,
): Promise<SprintListEnvelope<TAttrs>> {
    return toNativePromise<SprintListEnvelope<TAttrs>>(
        sprints.list(projectId, filters ?? undefined),
    );
}

/**
 * Moves open user stories out of one sprint and into another.
 *
 * ⛔⛔ T9 -- THE ARGUMENT-TRANSPOSITION HAZARD. THIS IS THE MOST DANGEROUS CALL IN
 * THE FILE. Two sprint ids sit in the same signature and they are NOT
 * interchangeable:
 *
 *   - `sourceMilestoneId` is the sprint the stories are LEAVING. It is the id the
 *     incumbent feeds to the named-URL registry at `sprints.coffee:45`, so it ends
 *     up IN THE URL PATH -- the frozen registry entry is
 *     `move-userstories-to-milestone`, whose template is
 *     `/milestones/%s/move_userstories_to_sprint`
 *     (`app/coffee/modules/resources.coffee:93`).
 *   - `destinationMilestoneId` is the sprint the stories are ARRIVING at. It goes
 *     IN THE REQUEST BODY, as the milestone id (`sprints.coffee:46`).
 *
 * Swap them and the request still succeeds: the stories are simply moved to the
 * WRONG SPRINT, under HTTP 200, with no error, no toast and no console warning.
 * The parameters are therefore named for their ROLE rather than their position,
 * while the positional order is preserved EXACTLY as the frozen signature declares
 * it. The verified call order is
 * `app/modules/components/move-to-sprint/move-to-sprint-lb/move-to-sprint-lb.controller.coffee:93-98`:
 * source sprint, project, selected destination, then the stories.
 *
 * ⛔ T9 -- THE BODY KEY IS `bulk_stories`, and it is NOT `bulk_userstories`.
 * The latter belongs exclusively to the two story-ORDERING endpoints faceted in
 * the sibling user-story module, and conflating the two is a SILENT HTTP 400. The
 * key is encoded by the incumbent at `sprints.coffee:46`, so this facade forwards
 * positional arguments and never spells a body key itself -- which is also why the
 * key appears exactly once in this file, on the line above, as documentation.
 *
 * ⭐ T9 -- THE SIBLING MOVE MEMBERS ARE DELIBERATELY NOT FACETED. The same
 * provider also exposes `moveTasksMilestone` (`sprints.coffee:49-52`) and
 * `moveIssuesMilestone` (`:54-57`), which differ only in their own body key. Tasks
 * and issues belong to the out-of-scope taskboard and issues screens, so only the
 * user-story variant is faceted here. Needing one of the others would be a
 * reviewed edit, not an accident.
 *
 * ⭐ T9 -- the destination is typed as nullable because the incumbent lightbox
 * initialises it to nothing (`move-to-sprint-lb.controller.coffee:36`) and gates
 * its submit control on the value being set (`move-to-sprint-lb.jade:79`), so the
 * gate lives in the UI. This facade adds NO validation of its own: guarding here
 * would be behaviour the incumbent does not have (T10).
 *
 * ⭐ T10 -- STATELESS, deliberately. Rapid consecutive drags are serialised by the
 * backlog's own queue and re-entrancy guard, not here; section 7 of the file header
 * names the locators. This function neither de-duplicates nor defers.
 *
 * The story entries are copied into a fresh array purely so a readonly input
 * satisfies the frozen signature; their contents are forwarded untouched, order
 * field included ({@link MoveUserStoriesEntry}).
 *
 * @typeParam TResult - parsed response body.
 * @param sprints - the live resource namespace, narrowed to the member used. It
 *   must expose the member the bridge's membership rule omits (section 5).
 * @param sourceMilestoneId - the sprint being moved OUT OF; lands in the URL path.
 * @param projectId - owning project.
 * @param destinationMilestoneId - the sprint being moved INTO; lands in the body.
 * @param userStories - the stories to move, each an id plus its sprint order.
 * @returns the full response, whose `data` holds the server's reply.
 */
export async function moveUserStoriesToMilestone<TResult = unknown>(
    sprints: { readonly moveUserStoriesMilestone: MoveUserStoriesMilestoneMember<TResult> },
    sourceMilestoneId: number,
    projectId: number,
    destinationMilestoneId: number | null,
    userStories: readonly MoveUserStoriesEntry[],
): Promise<AngularHttpResponse<TResult>> {
    return toNativePromise<AngularHttpResponse<TResult>>(
        sprints.moveUserStoriesMilestone(
            sourceMilestoneId,
            projectId,
            destinationMilestoneId,
            [...userStories],
        ),
    );
}
