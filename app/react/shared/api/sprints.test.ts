/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Co-located specs for the `sprints` typed facade.
 *
 * WHY THIS FILE IS MANDATORY, not optional. `jest.config.js` sets
 * `collectCoverage: true` unconditionally and its `collectCoverageFrom` sweeps
 * `app/react/**` with only specs, ambient declarations and the bundle entry point
 * excluded, against a hard `coverageThreshold.global.lines` of 70 (requirement
 * HR-9). The facade is measured whether or not a spec exists, so shipping it
 * without one would drag the whole gate down.
 *
 * WHAT IS ASSERTED, AND WHY EACH ASSERTION EARNS ITS PLACE. Each facade is a
 * single statement, so line coverage is the easy part. The value of this suite is
 * that it pins the FOUR SILENT-FAILURE MODES named in section 3 of the facade's
 * header -- every one of which produces a working-looking screen and a successful
 * HTTP status while being wrong:
 *
 *   1. ⭐ THE TWO FROZEN CUSTOM RESPONSE HEADERS. The counts on the list envelope
 *      are parsed from `Taiga-Info-Total-Closed-Milestones` and
 *      `Taiga-Info-Total-Opened-Milestones` by the incumbent, so a missing header
 *      legitimately yields a NOT-A-NUMBER count. The facade is asserted to
 *      PROPAGATE that value rather than coerce it to zero, because coercion would
 *      invent a count the server never sent (rule T10).
 *   2. ⭐⭐ THE `closed` COLLISION. The envelope's `closed` is a COUNT while the
 *      domain sprint's `closed` is a BOOLEAN. Both are asserted in the same suite,
 *      side by side, so the distinction is pinned by executable evidence rather
 *      than by prose alone.
 *   3. ⭐⭐ THE ARGUMENT TRANSPOSITION. The story-move call takes the SOURCE sprint
 *      first and the DESTINATION third. Transposing them moves stories to the
 *      wrong sprint under HTTP 200 with no error surface, so the full argument
 *      list is recorded and asserted POSITIONALLY, with two deliberately different
 *      id values so a swap cannot pass.
 *   4. ⭐⭐ THE TWO-LEVEL MODEL NESTING (P-IMMER-1). A sprint resolves as a model
 *      whose `user_stories` are ALSO models. Both the "spreading a model is wrong"
 *      pitfall and the "one flatten is not enough" pitfall are DEMONSTRATED
 *      against a double built to mirror the real model's accessor mechanism, so
 *      the documented hazard is proven rather than asserted.
 *
 * Three further properties are pinned because a plausible-looking rewrite would
 * break them silently:
 *
 *   - THE TWO ACCEPTED-BUT-UNUSED PROJECT IDS ARE STILL FORWARDED. The incumbent
 *     never reads the project id on the single-sprint read or on the statistics
 *     read, but the parameter is part of the positional contract. Dropping it
 *     would shift the sprint id into the first slot, so the recorded argument
 *     lists assert both values, in order.
 *   - VERBATIM PASS-THROUGH IN BOTH DIRECTIONS. Fulfilment values arrive with the
 *     same identity; rejection reasons arrive with the same identity. Nothing is
 *     renamed, rounded, defaulted, sorted, wrapped or swallowed (T10, and goal
 *     G2's frozen contract).
 *   - NO NEW TRANSPORT AND NO ADDED BEHAVIOUR. No path is composed, so no id is
 *     ever interpolated (rule T5); repeated calls delegate every time, so no cache
 *     was added; a never-settling source stays pending, so no timeout was added;
 *     each facade touches ONLY its own member, so no two reads were merged; and
 *     the module's export surface is exactly four functions, so no fifth helper
 *     crept in -- specifically none for the task or issue move members.
 *
 * The suite is browserless and offline by construction (requirement HR-5): it
 * touches no browser API beyond the jsdom the runner supplies, launches no
 * browser, imports no end-to-end runner, opens no socket, issues no request and
 * depends on no build output. Every collaborator is a local structural double,
 * and the doubles are deliberately NOT native promises -- the incumbent resolves
 * AngularJS promises, and converting one is precisely the seam under test.
 *
 * ==========================================================================
 * FOUR CONVENTIONS, AND THE REASON FOR EACH (rule T9)
 * ==========================================================================
 *
 * 1. ⭐⭐ THE INJECTOR IS MOCKED; THE FRAMEWORK IS NEVER LOADED. The incumbent
 *    CoffeeScript specs register a real module and substitute collaborators
 *    through the injector's provider, which requires the whole framework plus its
 *    mocking add-on in the page. Nothing of that kind happens here, and it is a
 *    hard constraint rather than a preference: this runner has no browser, and the
 *    bridge's own governing rule for every spec under this tree is to mock the
 *    injector rather than load the framework.
 *
 *    In this file the seam is even simpler than a mocked injector, and the simpler
 *    form is preferred: all four facades take the resource namespace AS THEIR FIRST
 *    PARAMETER, so a plain typed object satisfies them outright. The bridge does
 *    ship an injector double for the units that genuinely need one -- the hooks and
 *    the components -- and it is deliberately not reached for here, because a
 *    facade that never resolves a service has no injector to mock.
 *
 * 2. THE DOUBLES RESOLVE A BARE THENABLE, NOT A NATIVE PROMISE. See
 *    {@link thenableFor}: handing the facade a native promise would make the
 *    marshalling assertions vacuous, since the value would already be what they
 *    claim it becomes.
 *
 * 3. NO MOCK IS RESET BY HAND. The runner is configured with both `clearMocks` and
 *    `restoreMocks` enabled, so every recorded call and every replaced
 *    implementation is discarded between specs automatically. A hand-written
 *    `beforeEach` reset would be redundant, and worse, it would imply the
 *    configuration cannot be relied on.
 *
 * 4. EVERY FIXTURE IS A PLAIN OBJECT OR A PLAIN ARRAY. No persistent-collection
 *    value is constructed anywhere in this file. That library remains installed for
 *    the 124 out-of-scope files that still depend on it (requirement I5), and it is
 *    exactly what the migrated modules are moving away from -- so a fixture built
 *    from it would assert the shape being retired rather than the one being
 *    adopted, and would additionally be unusable as a state draft (P-IMMER-1).
 *    Dates are likewise plain `"YYYY-MM-DD"` strings, never parsed into date
 *    objects, because no layer on this path parses them.
 */

import {
    getSprint,
    getSprintStats,
    listSprints,
    moveUserStoriesToMilestone,
} from './sprints';
import type { SprintStatsResponse } from './sprints';
import type {
    AngularHttpResponse,
    AngularPromise,
    HttpHeadersGetter,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { NestedSprintUserStory, Sprint } from '../types/sprint';

/* ==========================================================================
 * FIXTURES AND DOUBLES
 * ========================================================================== */

/** The project id every facade forwards unchanged. */
const PROJECT_ID = 42;

/** The sprint id the two single-sprint reads look up. */
const SPRINT_ID = 7;

/**
 * The SOURCE sprint for the move -- the one whose id lands in the URL path.
 *
 * Deliberately different from {@link DESTINATION_SPRINT_ID} so that transposing
 * the two cannot produce a passing test.
 */
const SOURCE_SPRINT_ID = 101;

/** The DESTINATION sprint for the move -- the one whose id lands in the body. */
const DESTINATION_SPRINT_ID = 202;

/**
 * Presents a fixed fixture as the payload type the caller asked for.
 *
 * Every faced member is GENERIC over its payload and the FACADE, not the double,
 * chooses the type argument, while a double necessarily holds one concrete
 * fixture. This helper bridges that gap in one clearly named place instead of
 * scattering conversions through the doubles. Test-only, never used by production
 * code.
 */
function asPayload<T>(value: unknown): T {
    return value as T;
}

/** How a doubled member should settle: fulfil, reject, or never settle at all. */
type Outcome =
    | { readonly kind: 'fulfil'; readonly value: unknown }
    | { readonly kind: 'reject'; readonly reason: unknown }
    | { readonly kind: 'pending' };

/** A `pending` outcome, for the members a given test does not exercise. */
const NEVER: Outcome = { kind: 'pending' };

/**
 * A stand-in for an AngularJS promise: the smallest thenable the marshaller relies
 * on.
 *
 * Deliberately NOT a native promise. The incumbent resource layer resolves
 * AngularJS promises, whose settlement is tied to the digest loop, and the entire
 * purpose of the seam the facade crosses is to adopt one into a native promise.
 * Handing the facade a native promise here would test nothing about that
 * conversion.
 */
function thenableFor<T>(outcome: Outcome): AngularPromise<T> {
    return {
        then(onFulfilled, onRejected) {
            if (outcome.kind === 'fulfil') {
                return onFulfilled(asPayload<T>(outcome.value));
            }

            if (outcome.kind === 'reject') {
                return onRejected(outcome.reason);
            }

            // 'pending': never settles, so neither handler is ever invoked.
            return undefined;
        },
    };
}

/**
 * One entry of the story-move payload -- an id AND that story's sprint order.
 *
 * The ASSERTION shape, not the double's parameter type. The frozen namespace
 * types that parameter as the generic parameter bag the resource layer forwards
 * (`../../bridge/useAngularService.ts`, matching how the sibling milestone bulk
 * write is typed), so the double below accepts the same bag and the specs narrow
 * to this shape when they read what was forwarded. Narrowing the double's own
 * parameter instead would make it UNASSIGNABLE to the facade's member view under
 * `strictFunctionTypes`, which is contravariant in parameters.
 */
type MoveEntry = {
    readonly us_id: number;
    readonly order: number;
};

/**
 * The list envelope, mirrored locally.
 *
 * The facade's own envelope type is intentionally NOT exported -- it is an
 * implementation detail of that module -- so the double describes the same shape
 * structurally. Keeping the mirror here also means a drift in the real envelope
 * shows up as a compile error in this spec.
 *
 * @typeParam TAttrs - attribute shape of each milestone model.
 */
interface ListEnvelope<TAttrs> {
    readonly milestones: ReadonlyArray<TaigaModel<TAttrs>>;
    readonly closed: number;
    readonly open: number;
}

/** Every argument list each doubled member was called with, in call order. */
interface CallLog {
    readonly get: unknown[][];
    readonly stats: unknown[][];
    readonly list: unknown[][];
    readonly moveUserStoriesMilestone: unknown[][];
}

/** The four outcomes a test wants the doubled namespace to produce. */
interface Outcomes {
    readonly get?: Outcome;
    readonly stats?: Outcome;
    readonly list?: Outcome;
    readonly move?: Outcome;
}

/**
 * A double of the `sprints` sub-resource namespace, covering all four faced
 * members.
 *
 * Records the FULL argument list of every call -- not just the first argument --
 * because two of the properties under test are positional: that the
 * accepted-but-unused project id is still forwarded in slot one, and that the
 * move's source and destination ids land in slots one and three respectively.
 *
 * Every member is generic, exactly as the frozen namespace is, so the double
 * satisfies whichever instantiation a facade settles on -- including each
 * facade's DEFAULT type argument, which the facade module does not export.
 */
function sprintsDouble(outcomes: Outcomes = {}): {
    service: {
        get<TAttrs>(...args: [number, number]): AngularPromise<TaigaModel<TAttrs>>;
        stats<TStats>(...args: [number, number]): AngularPromise<TStats>;
        list<TAttrs>(
            ...args: [number, (ResourceParams | undefined)?]
        ): AngularPromise<ListEnvelope<TAttrs>>;
        moveUserStoriesMilestone<TResult>(
            ...args: [number, number, number | null, ResourceParams[]]
        ): AngularPromise<AngularHttpResponse<TResult>>;
    };
    log: CallLog;
} {
    const log: CallLog = { get: [], stats: [], list: [], moveUserStoriesMilestone: [] };

    const service = {
        get<TAttrs>(...args: [number, number]): AngularPromise<TaigaModel<TAttrs>> {
            log.get.push(args);

            return thenableFor<TaigaModel<TAttrs>>(outcomes.get ?? NEVER);
        },

        stats<TStats>(...args: [number, number]): AngularPromise<TStats> {
            log.stats.push(args);

            return thenableFor<TStats>(outcomes.stats ?? NEVER);
        },

        list<TAttrs>(
            ...args: [number, (ResourceParams | undefined)?]
        ): AngularPromise<ListEnvelope<TAttrs>> {
            log.list.push(args);

            return thenableFor<ListEnvelope<TAttrs>>(outcomes.list ?? NEVER);
        },

        moveUserStoriesMilestone<TResult>(
            ...args: [number, number, number | null, ResourceParams[]]
        ): AngularPromise<AngularHttpResponse<TResult>> {
            log.moveUserStoriesMilestone.push(args);

            return thenableFor<AngularHttpResponse<TResult>>(outcomes.move ?? NEVER);
        },
    };

    return { service, log };
}

/**
 * A faithful stand-in for a model instance, built the way the real one is built.
 *
 * A CLASS, not an object literal, and that choice is load-bearing rather than
 * stylistic. The real model is a CoffeeScript class
 * (`modules/base/model.coffee:9-127`), so its members live on a PROTOTYPE and are
 * therefore NOT copied by a spread. A literal would put them on the instance as own
 * enumerable properties, quietly making the pitfall assertions below pass for the
 * wrong reason and making a spread look survivable when against the real class it is
 * not.
 *
 * Everything else mirrors the original too:
 *
 *   - the attribute bag and the modified set are own, enumerable bookkeeping
 *     fields (`:11-13`, `:58-61`) -- which is exactly why a spread leaks them;
 *   - one enumerable, configurable accessor pair per attribute is installed with
 *     `Object.defineProperty` (`:94-101`), so attributes are NOT own data
 *     properties;
 *   - `getAttrs()` returns a FRESH plain merge of the bag and the modified set
 *     (`:48-54`), never the bag itself.
 *
 * Declared as implementing the bridge's model type so the facades' real signatures
 * are exercised rather than a look-alike.
 */
class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    /** `model.coffee:11`. The raw attribute bag -- own and enumerable. */
    public _attrs: TAttrs;

    /** `model.coffee:12`. The resource name the model was created under. */
    public _name: string;

    /** `model.coffee:58`. Pending changes, empty until something is written. */
    public _modifiedAttrs: Record<string, unknown> = {};

    /** `model.coffee:61`. The dirty flag the write path short-circuits on. */
    public _isModified = false;

    public constructor(name: string, attrs: TAttrs) {
        this._name = name;
        this._attrs = { ...attrs };

        // A keyed view of the same object, so the accessors below can read it by
        // name without forcing the public attribute type to carry an index
        // signature.
        const bagByKey: Record<string, unknown> = asPayload<Record<string, unknown>>(
            this._attrs,
        );
        const modified = this._modifiedAttrs;

        // `model.coffee:94-101` -- accessors over the bag, not data properties on
        // the instance. Reading an attribute therefore runs a getter, which is the
        // mechanism the flattening discipline exists because of.
        for (const key of Object.keys(bagByKey)) {
            Object.defineProperty(this, key, {
                get: () => (key in modified ? modified[key] : bagByKey[key]),
                set: (value: unknown) => {
                    modified[key] = value;
                    this._isModified = true;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    /** `model.coffee:48-54`. A fresh plain merge -- the sanctioned flatten. */
    public getAttrs(patch?: boolean): TAttrs {
        if (patch === true) {
            return asPayload<TAttrs>({ ...this._modifiedAttrs });
        }

        return asPayload<TAttrs>({ ...this._attrs, ...this._modifiedAttrs });
    }

    /** `model.coffee:63-65`. Records a change and marks the model modified. */
    public setAttr(name: string, value: unknown): void {
        this._modifiedAttrs[name] = value;
        this._isModified = true;
    }

    /** `model.coffee:110-111`. */
    public isModified(): boolean {
        return this._isModified;
    }

    /** `model.coffee:45-46`. */
    public getName(): string {
        return this._name;
    }

    /** `model.coffee:28-32`. Shallow clone. */
    public clone(): TaigaModel<TAttrs> {
        return new ModelDouble<TAttrs>(this._name, this._attrs);
    }
}

/**
 * The statistics body shape.
 *
 * ⛔ THE FACADE'S OWN TYPE IS USED, NOT A LOCAL MIRROR. A mirror was declared here
 * before, and it is what let the two point members be described wrongly for as long
 * as they were: a mirror agrees with whatever the spec author believed, so the
 * production declaration was never on trial. Aliasing the exported type means a
 * drift in either direction is a compile error right here.
 *
 * ⛔ `total_points` is a role-keyed MAP and `completed_points` is an ARRAY. The
 * view builds them differently -- `milestone.total_points` versus
 * `milestone.closed_points.values()` -- so the role keys survive on one and are
 * discarded on the other. The incumbent consumer is agnostic because it reads both
 * through `_.values(...)` (`taskboard/main.coffee:418-419`), which is exactly why
 * the wrong declaration was never observed to be wrong.
 *
 * ⭐ The four DERIVED fields that consumer computes onto its own view state --
 * the point sums, the remaining counts and the completion percentage
 * (`taskboard/main.coffee:422-431`) -- are deliberately absent: they are not wire
 * fields, and the facade neither declares nor computes them.
 */
type StatsFixture = SprintStatsResponse;

/** The story attributes the nested story models wrap. */
type StoryFixtureAttrs = {
    readonly id: number;
    readonly subject: string;
    readonly sprint_order: number;
};

/**
 * The sprint attributes a sprint model wraps, as they actually arrive.
 *
 * ⭐ `user_stories` holds MODEL instances, not plain stories: the incumbent
 * re-wraps every nested story and writes the result into the private attribute
 * slot (`modules/resources/sprints.coffee:18-20` for a single sprint, `:33-36`
 * once per milestone). That is the second level of the nesting hazard.
 *
 * ⭐ The two dates are `"YYYY-MM-DD"` STRINGS, never date objects, and `closed` is
 * a BOOLEAN here -- to be read against the envelope's `closed`, which is a COUNT.
 */
type SprintFixtureAttrs = {
    readonly id: number;
    readonly name: string;
    readonly closed: boolean;
    readonly estimated_start: string;
    readonly estimated_finish: string;
    readonly user_stories: ReadonlyArray<TaigaModel<StoryFixtureAttrs>>;
};

/** Builds a nested story model, as the incumbent re-wraps them. */
function storyModel(id: number, order: number): TaigaModel<StoryFixtureAttrs> {
    return new ModelDouble<StoryFixtureAttrs>('userstories', {
        id,
        subject: `story ${String(id)}`,
        sprint_order: order,
    });
}

/**
 * Builds a sprint model whose stories are themselves models -- the two-level shape
 * the facade resolves.
 */
function sprintModel(id: number, closed: boolean): TaigaModel<SprintFixtureAttrs> {
    return new ModelDouble<SprintFixtureAttrs>('milestones', {
        id,
        name: `Sprint ${String(id)}`,
        closed,
        // Date STRINGS, passed through unparsed by every layer.
        estimated_start: '2026-05-15',
        estimated_finish: '2026-05-30',
        user_stories: [storyModel(1, 1), storyModel(2, 2)],
    });
}

/* ==========================================================================
 * getSprint -- the MODEL-returning read, and the two-level nesting hazard
 * ========================================================================== */

describe('getSprint', () => {
    it('forwards the project id and the sprint id positionally, in that order', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service, log } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // ⭐ The project id is accepted and NEVER READ by the incumbent
        // (`sprints.coffee:16`), but it is still part of the positional contract.
        // Dropping it would slide the sprint id into slot one and read the WRONG
        // sprint, so both values are asserted, in order. Exactly two arguments: no
        // params bag, no options object, and above all no composed path -- the
        // repository builds that at `base/repository.coffee:165` (rule T5).
        //
        // ⭐ WHY THE FACADE SPELLS IT `_projectId`. The leading underscore is there
        // purely to satisfy `noUnusedParameters: true`, which the project enables and
        // which would otherwise reject a parameter the function forwards but never
        // inspects. It is a compiler convention, NOT a hint that the argument is
        // optional or ignorable: it is forwarded verbatim, and this assertion is what
        // stops a future reader from "cleaning up" an apparently unused parameter and
        // silently shifting every argument one slot to the left.
        expect(log.get).toEqual([[PROJECT_ID, SPRINT_ID]]);
    });

    it('resolves the model ITSELF, neither flattened nor cloned', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // Identity, not merely equality: flattening is the CALLER's job, and the
        // model must arrive with its dirty tracking intact so it can be handed back
        // to the repository's write path (requirement I7).
        expect(resolved).toBe(sprint);
        expect(typeof resolved.getAttrs).toBe('function');
        expect(resolved.isModified()).toBe(false);
    });

    it('resolves a sprint whose nested stories are THEMSELVES models', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // ⭐⭐ P-IMMER-1, LEVEL TWO. One flatten of the sprint is NOT enough: the
        // stories inside the flattened result are still model instances, because
        // the incumbent re-wrapped them at `sprints.coffee:18-20`. This is the
        // assertion that proves the hazard the facade's type encodes.
        const flattenedSprint = resolved.getAttrs();

        expect(flattenedSprint.user_stories).toHaveLength(2);

        for (const story of flattenedSprint.user_stories) {
            expect(typeof story.getAttrs).toBe('function');
        }

        // Only the SECOND flatten yields plain data the state library can proxy.
        const plainStories = flattenedSprint.user_stories.map((story) => story.getAttrs());

        expect(plainStories).toEqual([
            { id: 1, subject: 'story 1', sprint_order: 1 },
            { id: 2, subject: 'story 2', sprint_order: 2 },
        ]);

        for (const story of plainStories) {
            expect(typeof (story as { getAttrs?: unknown }).getAttrs).toBe('undefined');
        }
    });

    it('demonstrates why SPREADING the resolved model is the wrong flatten', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        const spread: Record<string, unknown> = { ...resolved };

        // ⚠⚠ A CORRECTION WORTH RECORDING, because the plan states the opposite and
        // the opposite would be a comforting bug. The attribute accessors are
        // installed as ENUMERABLE (`modules/base/model.coffee:94-101`, with
        // `enumerable: true` at `:98`), so a spread does NOT "capture nothing": it
        // reads every getter and copies the resulting VALUES. Asserting emptiness here
        // would have been a test that passes only against a double built wrongly, so
        // what is asserted is what the real class actually does.
        expect(Object.keys(spread)).toContain('name');
        expect(Object.keys(spread)).toContain('user_stories');
        expect(spread['name']).toBe(`Sprint ${String(SPRINT_ID)}`);

        // ⛔ WHICH MAKES THE TRAP WORSE RATHER THAN BETTER: the spread LOOKS like a
        // flattened sprint, so nothing draws attention to the two things it broke.
        //
        // First, the prototype methods are LOST -- the value is no longer a model and
        // can no longer be handed to the repository's write path.
        expect(typeof spread['getAttrs']).toBe('undefined');
        expect(typeof spread['setAttr']).toBe('undefined');

        // Second, it LEAKS the private bookkeeping fields, which are own and
        // enumerable on the real class too (`model.coffee:11-13`, `:58-61`), so the
        // dirty-tracking state travels onward as ordinary data.
        expect(spread).toHaveProperty('_attrs');
        expect(spread).toHaveProperty('_modifiedAttrs');
        expect(spread).toHaveProperty('_isModified');

        // And it still does not solve level two: the stories remain models.
        expect(typeof asPayload<SprintFixtureAttrs>(spread).user_stories[0]?.getAttrs).toBe(
            'function',
        );

        // The sanctioned flatten leaks nothing -- and still leaves level two to do.
        const sanctioned = resolved.getAttrs();

        expect(Object.keys(sanctioned)).not.toContain('_attrs');
        expect(Object.keys(sanctioned)).not.toContain('_modifiedAttrs');
        expect(typeof sanctioned.user_stories[0]?.getAttrs).toBe('function');
    });

    it('passes the two date fields through as untouched "YYYY-MM-DD" strings', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);
        const attrs = resolved.getAttrs();

        // T10: no parsing, no formatting, no normalisation anywhere on this path.
        expect(attrs.estimated_start).toBe('2026-05-15');
        expect(attrs.estimated_finish).toBe('2026-05-30');
        expect(typeof attrs.estimated_start).toBe('string');
        expect(typeof attrs.estimated_finish).toBe('string');
    });

    it('exposes `closed` as a BOOLEAN on the domain model', async () => {
        const sprint = sprintModel(SPRINT_ID, true);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // ⭐⭐ Half one of the collision. Read this next to the envelope assertion in
        // the `listSprints` suite, where `closed` is a COUNT.
        expect(resolved.getAttrs().closed).toBe(true);
        expect(typeof resolved.getAttrs().closed).toBe('boolean');
    });

    it('rejects with the reason unchanged, so the interceptor pipeline stays visible', async () => {
        // The AngularJS interceptors surface the version conflict, the blocked
        // project and connection loss through the REJECTION value, so swallowing or
        // rewrapping it here would hide all of them.
        const reason = { status: 400, data: { version: ['conflict'] } };
        const { service } = sprintsDouble({ get: { kind: 'reject', reason } });

        await expect(getSprint(service, PROJECT_ID, SPRINT_ID)).rejects.toBe(reason);
    });

    it('delegates on every call, so no cache was added', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service, log } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);
        await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // Read de-duplication already exists in the shared transport; T10 forbids a
        // second implementation here.
        expect(log.get).toEqual([
            [PROJECT_ID, SPRINT_ID],
            [PROJECT_ID, SPRINT_ID],
        ]);
    });

    it('stays pending when the source never settles, so no timeout was added', async () => {
        const { service } = sprintsDouble({ get: NEVER });
        let settled = false;

        void getSprint(service, PROJECT_ID, SPRINT_ID).then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );

        // Flush the microtask queue: a facade that had introduced its own timeout,
        // default value or fallback would have settled by now.
        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe(false);
    });

    it('touches no sibling member, so no two reads were merged', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service, log } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        expect(log.stats).toEqual([]);
        expect(log.list).toEqual([]);
        expect(log.moveUserStoriesMilestone).toEqual([]);
    });

    it('is callable with NO explicit type argument and still resolves a model', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service, log } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        // No explicit type argument here, so the attribute shape is inferred from
        // the namespace that was passed in. Whatever it resolves to, the value is
        // still a MODEL -- callers are never handed pre-flattened data by accident,
        // which is the property that keeps the flattening discipline the caller's.
        const resolved = await getSprint(service, PROJECT_ID, SPRINT_ID);

        expect(log.get).toEqual([[PROJECT_ID, SPRINT_ID]]);
        expect(typeof resolved.getAttrs).toBe('function');
        expect(resolved.getName()).toBe('milestones');
    });

    it('resolves a NATIVE promise, not the AngularJS thenable it was handed', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const result = getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        expect(result).toBeInstanceOf(Promise);
        expect(typeof result.catch).toBe('function');
        expect(thenableFor<TaigaModel<SprintFixtureAttrs>>(NEVER)).not.toBeInstanceOf(Promise);

        await expect(result).resolves.toBe(sprint);
    });

    it('resolves `user_stories` as a PLAIN array, not a persistent collection', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);
        const stories = resolved.getAttrs().user_stories;

        // ⛔ THE NESTED STORIES ARE A JAVASCRIPT ARRAY. The incumbent builds it with a
        // plain map (`modules/resources/sprints.coffee:19`), so it is indexed and has a
        // `length` -- it is NOT one of the persistent collections the 124 out-of-scope
        // files still use, and nothing under this tree may construct one (requirement
        // I5). A reader reaching for `.size` or `.get(0)` gets nothing at all.
        expect(Array.isArray(stories)).toBe(true);
        expect(stories.length).toBe(2);

        const asCollection = asPayload<{ readonly size?: unknown; readonly get?: unknown }>(
            stories,
        );

        expect(asCollection.size).toBeUndefined();
        expect(asCollection.get).toBeUndefined();

        // Indexed access is the sanctioned read, and each element is still a model.
        expect(stories[0]?.getAttrs().subject).toBe('story 1');
        expect(stories[1]?.getAttrs().subject).toBe('story 2');
    });

    it('⭐⭐ hands back a value that is plain only after BOTH levels are flattened', async () => {
        // ⭐⭐ P-IMMER-1, VERBATIM: "immer dislikes class instances. `$tgModel` returns
        // model classes carrying dirty-tracking state; passing one into a draft
        // produces undefined behaviour. Convert to plain objects at the boundary."
        //
        // ⭐ THE BOUNDARY IS THE CALLER'S, NOT THIS FACADE'S. The facade must NOT
        // flatten: a flattened sprint can no longer be handed to the repository's write
        // path, which needs the dirty tracking to issue a changed-fields-only write
        // carrying the optimistic-concurrency token (requirement I7). So the facade
        // resolves the model and the caller converts -- and the conversion is TWO
        // LEVELS DEEP, because the incumbent re-wrapped every nested story
        // (`modules/resources/sprints.coffee:18-20`). One flatten leaves models inside
        // `user_stories`, and a draft built from that value still holds class
        // instances, which is precisely the failure P-IMMER-1 names.
        //
        // The house precedent for flattening AT the boundary is the project-menu
        // controller, which reads its persistent structure at
        // `app/modules/components/project-menu/project-menu.controller.coffee:21` and
        // flattens on the way out at `:27`. (The plan cites ":28"; that line is the
        // closing brace, so the call itself is at `:27`.)
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // Level 0 -- what the facade resolved is a model, deliberately.
        expect(typeof resolved.getAttrs).toBe('function');
        expect(resolved.isModified()).toBe(false);

        // Level 1 -- one flatten. The sprint's own fields are plain now...
        const levelOne = resolved.getAttrs();

        expect(typeof asPayload<{ readonly getAttrs?: unknown }>(levelOne).getAttrs).toBe(
            'undefined',
        );
        // ...but the stories inside it are STILL models. A one-level flatten is not
        // enough, and this is the only executable proof of that.
        expect(typeof levelOne.user_stories[0]?.getAttrs).toBe('function');
        expect(typeof levelOne.user_stories[1]?.getAttrs).toBe('function');

        // Level 2 -- the second flatten. Only now is every value plain data.
        const levelTwo = levelOne.user_stories.map((story) => story.getAttrs());

        for (const story of levelTwo) {
            const probe = asPayload<{ readonly getAttrs?: unknown; readonly _attrs?: unknown }>(
                story,
            );

            expect(typeof probe.getAttrs).toBe('undefined');
            expect(probe._attrs).toBeUndefined();
        }

        expect(levelTwo).toEqual([
            { id: 1, subject: 'story 1', sprint_order: 1 },
            { id: 2, subject: 'story 2', sprint_order: 2 },
        ]);
    });

    it('is resolved UNFLATTENED, so the flattening discipline stays the caller\u2019s', async () => {
        const sprint = sprintModel(SPRINT_ID, false);
        const { service } = sprintsDouble({ get: { kind: 'fulfil', value: sprint } });

        const resolved = await getSprint<SprintFixtureAttrs>(service, PROJECT_ID, SPRINT_ID);

        // Identity with the value the incumbent produced: nothing was converted,
        // copied or normalised on the way through (T10).
        expect(resolved).toBe(sprint);
        expect(resolved.getName()).toBe('milestones');

        // Still carrying its dirty-tracking bookkeeping, which is what makes it
        // writable. The bridge's model type does not DECLARE that field -- it is
        // private to the implementation -- so it is probed rather than read.
        expect(asPayload<{ readonly _attrs?: unknown }>(resolved)._attrs).toBeDefined();
    });
});

/* ==========================================================================
 * getSprintStats -- the PLAIN-JSON half of the asymmetry
 * ========================================================================== */

describe('getSprintStats', () => {
    /**
     * The statistics payload as the server sends it.
     *
     * The two point fields are MAPS keyed by role, which is how the only existing
     * consumer reads them -- it enumerates their values and sums them
     * (`modules/taskboard/main.coffee:418-419`).
     *
     * Note what is ABSENT: the point sums, the remaining counts and the completion
     * percentage. That consumer DERIVES those onto its own view state at `:422-431`;
     * they are not wire fields, and the facade neither declares nor computes them.
     */
    const statsPayload: StatsFixture = {
        name: 'Sprint 2026-5-15',
        estimated_start: '2026-05-15',
        estimated_finish: '2026-05-30',
        // Role-KEYED, because the view sends `milestone.total_points` whole.
        total_points: { '1': 20, '2': 15.5, '3': 66 },
        // ⛔ An ARRAY, because the view sends `closed_points.values()`: the role
        // keys are discarded before serialisation.
        completed_points: [10, 5.5, 5.5],
        total_userstories: 11,
        completed_userstories: 3,
        total_tasks: 108,
        completed_tasks: 21,
        iocaine_doses: 2,
        days: [
            { day: '2026-05-15', name: 15, open_points: 101.5, optimal_points: 101.5 },
            { day: '2026-05-16', name: 16, open_points: 96.5, optimal_points: 94.7 },
        ],
    };

    it('forwards the project id and the sprint id positionally, in that order', async () => {
        const { service, log } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        await getSprintStats(service, PROJECT_ID, SPRINT_ID);

        // ⭐ Same accepted-but-unused project id as the single-sprint read
        // (`sprints.coffee:23`), the same `_projectId` underscore spelling for the same
        // `noUnusedParameters` reason, and the same reason it must still be forwarded.
        // The `stats` sub-path is composed INSIDE the incumbent method at `:24`, so
        // nothing here interpolates an id into a string (rule T5).
        expect(log.stats).toEqual([[PROJECT_ID, SPRINT_ID]]);
    });

    it('resolves PLAIN data rather than a model, with every field intact', async () => {
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        const resolved = await getSprintStats<StatsFixture>(service, PROJECT_ID, SPRINT_ID);

        // ⭐ THE ASYMMETRY WITH `getSprint`. The incumbent uses the repository's RAW
        // query, which resolves the parsed body itself (`base/repository.coffee:180`),
        // so there is no model here, no flatten to perform, and the value is safe to
        // place in React state as-is.
        expect(resolved).toBe(statsPayload);
        expect(typeof (resolved as { getAttrs?: unknown }).getAttrs).toBe('undefined');

        // Neither point field is pre-summed -- summing is the caller's -- but they are
        // not the same KIND of value, and that asymmetry is the point.
        expect(resolved.total_points).toEqual({ '1': 20, '2': 15.5, '3': 66 });
        expect(Array.isArray(resolved.completed_points)).toBe(true);
        expect(resolved.completed_points).toEqual([10, 5.5, 5.5]);
        expect(resolved.total_tasks).toBe(108);
        expect(resolved.completed_tasks).toBe(21);
    });

    it('adds no derived field of its own', async () => {
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        const resolved = await getSprintStats<StatsFixture>(service, PROJECT_ID, SPRINT_ID);

        // Deriving these here would relocate controller behaviour into the resource
        // layer, which T10 forbids. The key set is the view's own, in full: the four
        // derived members the taskboard computes are absent, and so is every field
        // this facade could have contributed itself.
        expect(Object.keys(resolved).sort()).toEqual([
            'completed_points',
            'completed_tasks',
            'completed_userstories',
            'days',
            'estimated_finish',
            'estimated_start',
            'iocaine_doses',
            'name',
            'total_points',
            'total_tasks',
            'total_userstories',
        ]);
        expect(resolved).not.toHaveProperty('totalPointsSum');
        expect(resolved).not.toHaveProperty('completedPercentage');
    });

    it('rejects with the reason unchanged', async () => {
        const reason = new Error('connection lost');
        const { service } = sprintsDouble({ stats: { kind: 'reject', reason } });

        await expect(getSprintStats(service, PROJECT_ID, SPRINT_ID)).rejects.toBe(reason);
    });

    it('touches no sibling member', async () => {
        const { service, log } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        await getSprintStats(service, PROJECT_ID, SPRINT_ID);

        expect(log.get).toEqual([]);
        expect(log.list).toEqual([]);
        expect(log.moveUserStoriesMilestone).toEqual([]);
    });

    it('resolves a NATIVE promise, not the AngularJS thenable it was handed', async () => {
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        const result = getSprintStats<StatsFixture>(service, PROJECT_ID, SPRINT_ID);

        expect(result).toBeInstanceOf(Promise);
        expect(typeof result.catch).toBe('function');
        expect(thenableFor<StatsFixture>(NEVER)).not.toBeInstanceOf(Promise);

        await expect(result).resolves.toBe(statsPayload);
    });

    it('⭐ resolves a SPREADABLE payload, which is the asymmetry with the sprint read', async () => {
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        const resolved = await getSprintStats<StatsFixture>(service, PROJECT_ID, SPRINT_ID);

        // ⭐ THE EXECUTABLE COUNTERPART TO THE MODEL TESTS ABOVE. The incumbent reads
        // this endpoint through the repository's RAW query, which resolves the parsed
        // body itself (`modules/base/repository.coffee:180`) rather than wrapping it.
        // So there is no model here, no accessor pair, no dirty tracking and NOTHING
        // TO FLATTEN: spreading the value captures the whole payload and loses nothing,
        // which is exactly what spreading a sprint model does not do.
        //
        // Keeping both halves asserted in one file is what stops the two reads from
        // being treated as interchangeable -- one needs a two-level flatten before it
        // can enter React state, the other is already plain.
        const spread = { ...resolved };

        expect(spread).toEqual(statsPayload);
        expect(Object.keys(spread).sort()).toEqual(Object.keys(statsPayload).sort());
        expect(typeof asPayload<{ readonly getAttrs?: unknown }>(spread).getAttrs).toBe(
            'undefined',
        );
        expect(spread).not.toHaveProperty('_attrs');

        // Safe to place in state as-is: a draft built from it holds no class instance,
        // which is the whole of P-IMMER-1's requirement met for free on this path.
        expect(JSON.parse(JSON.stringify(spread))).toEqual(statsPayload);
    });

    it('⭐ passes a NULL point value through as null, not zero and not undefined', async () => {
        // ⭐ A ROLE WITH NO ESTIMATE IS A REAL STATE, not a missing value. The domain
        // types record it as such -- a nested story's `points` is declared
        // `Record<string, number | null>`, and a sprint's own point sums are
        // `number | null` because they are database aggregate sub-selects that are null
        // when nothing carries points.
        //
        // ⛔ SUBSTITUTING ZERO WOULD BE A BEHAVIOUR CHANGE (T10) AND A WRONG ANSWER:
        // "this role has not been estimated" and "this role was estimated at zero" are
        // different facts, and a summary bar that renders the first as the second
        // reports a complete estimate where none exists. Substituting `undefined` is no
        // better -- it makes the key vanish from every enumeration.
        //
        // Asserted through an explicit type argument, which is what the facade's
        // generic parameter is FOR: the caller names the shape it expects, and the
        // facade neither inspects nor rewrites it.
        type NullablePointStats = {
            readonly total_points: Readonly<Record<string, number | null>>;
            readonly completed_points: ReadonlyArray<number | null>;
        };

        const payload: NullablePointStats = {
            total_points: { '1': 20, '2': null, '3': 0 },
            completed_points: [10, null, 0],
        };
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: payload } });

        const resolved = await getSprintStats<NullablePointStats>(service, PROJECT_ID, SPRINT_ID);

        expect(resolved.total_points['2']).toBeNull();
        expect(resolved.total_points['2']).not.toBe(0);
        expect(resolved.total_points['2']).not.toBeUndefined();

        // The neighbouring real zero is untouched too, so null and 0 stay distinguishable.
        expect(resolved.total_points['3']).toBe(0);
        expect(resolved.completed_points).toEqual([10, null, 0]);

        // The key survives enumeration rather than being dropped.
        expect(Object.keys(resolved.total_points)).toEqual(['1', '2', '3']);
    });
});

/* ==========================================================================
 * THE INCUMBENT `list` METHOD, TRANSCRIBED
 *
 * ⭐⭐ WHY A TRANSCRIPTION EXISTS AT ALL, stated plainly so nobody mistakes it for
 * a second implementation. The facade DELEGATES: `listSprints` hands its two
 * arguments to `sprints.list` and marshals the result, and that is the whole of
 * it. The query bag, the two custom response headers and the radix-10 parse all
 * live in the CoffeeScript method it delegates to
 * (`modules/resources/sprints.coffee:26-42`), which cannot be loaded here -- it is
 * CoffeeScript, it is outside the runner's `roots`, and reaching for it would drag
 * the AngularJS injector into a browserless suite that is required never to load
 * it.
 *
 * So the frozen post-processing step is TRANSCRIBED, once, in the two functions
 * below, and the transcription is TYPED AGAINST THE FACADE'S OWN DECLARED
 * ENVELOPE. That last detail is what makes these specs load-bearing rather than
 * self-congratulatory: rename `open` to `opened` in the facade, or retype either
 * count as a string, and the object literal in {@link incumbentEnvelope} stops
 * compiling. The contract is therefore pinned in the type system, while the two
 * header SPELLINGS and the radix are pinned by the executable assertions that
 * follow.
 *
 * What a transcription cannot do is notice an edit to the CoffeeScript itself, and
 * pretending otherwise would be worse than saying so: goal G2 freezes that file,
 * requirement T10 forbids changing it, and this suite records what it does today so
 * that the React side cannot drift from it unnoticed.
 * ========================================================================== */

/**
 * The response header carrying the CLOSED milestone count.
 *
 * ⭐⭐ SPELLED EXACTLY, and a typo here is the first of the four silent-failure
 * modes: an unrecognised header name makes the getter return nothing, the parse
 * yields not-a-number, and the screen renders an empty count under a perfectly
 * successful HTTP 200 -- no error, no toast, no console warning. Frozen at
 * `modules/resources/sprints.coffee:40`.
 */
const CLOSED_MILESTONES_HEADER = 'Taiga-Info-Total-Closed-Milestones';

/**
 * The response header carrying the OPEN milestone count.
 *
 * ⚠⚠ THE HEADER SAYS "Opened" WHILE THE ENVELOPE FIELD SAYS `open`. That
 * disagreement is deliberate on the server's part and frozen on ours: writing
 * `Taiga-Info-Total-Open-Milestones` to match the field name is the exact typo the
 * assertions below exist to catch. Frozen at
 * `modules/resources/sprints.coffee:41`.
 */
const OPENED_MILESTONES_HEADER = 'Taiga-Info-Total-Opened-Milestones';

/**
 * The header ACCESSOR, narrowed to the one form the incumbent uses.
 *
 * ⭐ A FUNCTION, NOT A DICTIONARY, and the distinction is the point of assertion D
 * below. The repository asks its transport for headers and forwards the accessor
 * untouched -- `queryMany` returns `[result, data.headers]`, and it does so only
 * because it was called with its fourth argument set
 * (`modules/base/repository.coffee:145-146`, reached from
 * `modules/resources/sprints.coffee:29`). Indexing that value as an object yields
 * nothing at all, so a reader who treats it as a bag of keys gets two absent counts
 * and no error.
 *
 * The return type is taken FROM the bridge's own accessor declaration rather than
 * restated, so a widening there moves this with it. Only the by-name form is
 * modelled because only the by-name form is called.
 */
type MilestoneListHeaders = (name: string) => ReturnType<HttpHeadersGetter>;

/**
 * The tuple `queryMany` resolves when asked for headers.
 *
 * Element 0 is the milestone models, element 1 the header accessor -- the shape
 * destructured at `modules/resources/sprints.coffee:30-31`.
 */
type MilestoneListTuple<TAttrs> = readonly [
    ReadonlyArray<TaigaModel<TAttrs>>,
    MilestoneListHeaders,
];

/**
 * The envelope shape as the FACADE declares it, read back off the facade itself.
 *
 * The facade does not export its envelope type -- it is an implementation detail of
 * that module -- so it is recovered from the resolved return type instead of being
 * restated. Restating it would let this spec and the facade disagree in silence,
 * which is the failure this whole file exists to prevent.
 */
type FacadeEnvelope<TAttrs> = Awaited<ReturnType<typeof listSprints<TAttrs>>>;

/**
 * The query bag, transcribed from `modules/resources/sprints.coffee:27-28`.
 *
 * ⭐ THE KEY IS `project`, SINGULAR. The incumbent seeds the bag with that one key
 * and merges the caller's filters OVER it, so a filter may legitimately override it
 * and nothing else is added. Spelling it `projects` or `project_id` is the second
 * silent-failure mode: the endpoint ignores the unknown parameter, returns HTTP 200
 * and hands back EVERY milestone the requester can see rather than the one
 * project's.
 *
 * `_.extend({}, params, filters or {})` is reproduced exactly, including the
 * coalescing of an absent filter argument to an empty bag.
 */
function incumbentParams(projectId: number, filters?: ResourceParams): ResourceParams {
    const params: ResourceParams = { project: projectId };

    return { ...params, ...(filters ?? {}) };
}

/**
 * The envelope, transcribed from `modules/resources/sprints.coffee:38-42`.
 *
 * ⭐⭐ BOTH COUNTS ARE PARSED WITH AN EXPLICIT RADIX OF 10, and that argument is not
 * decoration. Without it a value such as `"08"` is at the mercy of the host's
 * legacy octal handling; with it the string is read as decimal 8 every time. The
 * assertions below feed a leading-zero string precisely to prove the radix is
 * honoured rather than merely written.
 *
 * `parseInt` receives the accessor's result through `String(...)` for one reason
 * only: the accessor is declared as possibly returning nothing, and `parseInt`
 * already performs exactly that conversion internally, so this is the same
 * operation made expressible under a strict compiler rather than a change of
 * behaviour. A missing header still stringifies to something non-numeric and still
 * yields not-a-number, exactly as it does today.
 */
function incumbentEnvelope<TAttrs>(tuple: MilestoneListTuple<TAttrs>): FacadeEnvelope<TAttrs> {
    const milestones = tuple[0];
    const headers = tuple[1];

    return {
        milestones,
        closed: parseInt(String(headers(CLOSED_MILESTONES_HEADER)), 10),
        open: parseInt(String(headers(OPENED_MILESTONES_HEADER)), 10),
    };
}

/**
 * A header accessor double that answers from a fixed table.
 *
 * A `jest.fn()`, so the specs can assert WHICH NAMES were asked for -- which is the
 * only way to pin the two spellings from outside the CoffeeScript. A name that is
 * absent from the table answers `null`, exactly as the transport's accessor does
 * for a header the response did not carry.
 *
 * ⚠ No manual reset accompanies it: the runner is configured with `clearMocks` and
 * `restoreMocks` both enabled, so every mock is cleared between specs already and a
 * hand-written reset would be redundant noise.
 */
function headersDouble(
    table: Readonly<Record<string, string | null>>,
): jest.Mock<string | null, [string]> {
    return jest.fn((name: string): string | null => table[name] ?? null);
}

/* ==========================================================================
 * listSprints -- the envelope, the two frozen headers, and the `closed` collision
 * ========================================================================== */

describe('listSprints', () => {
    /** An envelope as the incumbent builds it at `sprints.coffee:38-42`. */
    function envelopeFor(
        closed: number,
        open: number,
    ): ListEnvelope<SprintFixtureAttrs> {
        return {
            milestones: [sprintModel(101, false), sprintModel(102, true)],
            closed,
            open,
        };
    }

    it('forwards the project id and the caller filters verbatim', async () => {
        const envelope = envelopeFor(2, 3);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        // The open-sprints call, exactly as the backlog makes it at
        // `modules/backlog/main.coffee:305-306`.
        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: false });

        // ⭐ The parameter bag is built INSIDE the incumbent -- it seeds the SINGULAR
        // key `project` at `sprints.coffee:27` and merges the caller's filters over
        // it at `:28`. So the facade must pass the id and the filters through
        // untouched and must NOT pre-build a bag of its own.
        expect(log.list).toEqual([[PROJECT_ID, { closed: false }]]);
    });

    it('serves the closed-sprints call through the same member', async () => {
        const envelope = envelopeFor(2, 3);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        // The closed-sprints call, as made at `backlog/main.coffee:282-283`. One
        // method, two lists, distinguished only by the filter -- so the facade must
        // not specialise on the filter value.
        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: true });

        expect(log.list).toEqual([[PROJECT_ID, { closed: true }]]);
    });

    it('omits the filters as undefined when the caller supplies none', async () => {
        const envelope = envelopeFor(0, 0);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID);

        // The incumbent coalesces a falsy filter argument to an empty object at
        // `sprints.coffee:28`, so passing nothing through is correct and no default
        // bag is fabricated here.
        expect(log.list).toEqual([[PROJECT_ID, undefined]]);
    });

    it('normalises an explicit null filter to undefined without inventing a bag', async () => {
        const envelope = envelopeFor(0, 0);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, null);

        expect(log.list).toEqual([[PROJECT_ID, undefined]]);
    });

    it('forwards unknown filter keys untouched rather than validating them', async () => {
        const envelope = envelopeFor(1, 1);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });
        const filters: ResourceParams = { closed: false, order_by: 'estimated_start' };

        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, filters);

        // G2 freezes the query contract: the facade is a pass-through, not a filter
        // whitelist, and it adds no validation the incumbent does not have.
        expect(log.list).toEqual([[PROJECT_ID, filters]]);
        expect(log.list[0]?.[1]).toBe(filters);
    });

    it('resolves the envelope itself -- an OBJECT, never a bare array', async () => {
        const envelope = envelopeFor(2, 3);
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
            closed: false,
        });

        // Collapsing the envelope to its milestones would discard both counts, which
        // the backlog reads at `backlog/main.coffee:312-313`.
        expect(resolved).toBe(envelope);
        expect(Array.isArray(resolved)).toBe(false);
        expect(resolved.milestones).toHaveLength(2);
    });

    it('exposes `closed` and `open` as COUNTS -- not flags', async () => {
        const envelope = envelopeFor(2, 3);
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
            closed: false,
        });

        // ⭐⭐ HALF TWO OF THE COLLISION, and the whole reason the envelope has its own
        // type. These come from `Taiga-Info-Total-Closed-Milestones` and
        // `Taiga-Info-Total-Opened-Milestones` -- note the header says "Opened" while
        // the field says `open` -- parsed with an explicit radix at
        // `sprints.coffee:40-41`. Compare with the domain model's `closed`, asserted
        // as a BOOLEAN in the `getSprint` suite.
        expect(resolved.closed).toBe(2);
        expect(resolved.open).toBe(3);
        expect(typeof resolved.closed).toBe('number');
        expect(typeof resolved.open).toBe('number');
    });

    it('PROPAGATES a not-a-number count rather than coercing it to zero', async () => {
        // ⭐⭐ THE FIRST SILENT-FAILURE MODE. When a response omits one of the two
        // custom headers, the incumbent's parse legitimately yields not-a-number
        // under a perfectly successful HTTP 200. Coercing it to zero here would
        // invent a count the server never sent, with nothing logged and no error
        // surface -- so the value must pass straight through (T10).
        const envelope = envelopeFor(Number.NaN, Number.NaN);
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
            closed: false,
        });

        expect(Number.isNaN(resolved.closed)).toBe(true);
        expect(Number.isNaN(resolved.open)).toBe(true);
        expect(resolved.closed).not.toBe(0);
        expect(resolved.open).not.toBe(0);
    });

    it('resolves milestones as models whose stories are ALSO models', async () => {
        const envelope = envelopeFor(1, 1);
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
            closed: false,
        });

        // ⭐⭐ P-IMMER-1 applies to the LIST too, once per milestone
        // (`sprints.coffee:33-36`) -- the level the plan's summary omits.
        for (const milestone of resolved.milestones) {
            expect(typeof milestone.getAttrs).toBe('function');

            for (const story of milestone.getAttrs().user_stories) {
                expect(typeof story.getAttrs).toBe('function');
            }
        }
    });

    it('does not sort the milestones or their stories', async () => {
        const envelope: ListEnvelope<SprintFixtureAttrs> = {
            // Deliberately descending, and the stories inside are built ascending.
            milestones: [sprintModel(102, true), sprintModel(101, false)],
            closed: 1,
            open: 1,
        };
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
            closed: false,
        });

        // The incumbent sorts each sprint's stories in the CONTROLLER
        // (`backlog/main.coffee:291-292`, `:317-318`), not in the resource layer.
        // Sorting here would relocate behaviour (T10).
        expect(resolved.milestones.map((m) => m.getAttrs().id)).toEqual([102, 101]);
    });

    it('rejects with the reason unchanged', async () => {
        const reason = { status: 451, data: 'blocked' };
        const { service } = sprintsDouble({ list: { kind: 'reject', reason } });

        await expect(listSprints(service, PROJECT_ID, { closed: false })).rejects.toBe(reason);
    });

    it('delegates on every call and touches no sibling member', async () => {
        const envelope = envelopeFor(2, 3);
        const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: false });
        await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: true });

        expect(log.list).toHaveLength(2);
        expect(log.get).toEqual([]);
        expect(log.stats).toEqual([]);
        expect(log.moveUserStoriesMilestone).toEqual([]);
    });

    it('resolves a NATIVE promise, not the AngularJS thenable it was handed', async () => {
        const envelope = envelopeFor(2, 3);
        const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

        const result = listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: false });

        // ⭐ THE MARSHALLING SEAM. Awaiting a bare thenable appears to work, which is
        // exactly why this needs asserting on the OBJECT rather than on the awaited
        // value: only a real promise carries `catch`, `finally` and the rejection
        // semantics the callers depend on.
        expect(result).toBeInstanceOf(Promise);
        expect(typeof result.catch).toBe('function');
        expect(typeof result.finally).toBe('function');

        // And the control half, without which the assertion above proves nothing:
        // what the facade was GIVEN is genuinely not a promise.
        expect(thenableFor<ListEnvelope<SprintFixtureAttrs>>(NEVER)).not.toBeInstanceOf(Promise);

        await expect(result).resolves.toBe(envelope);
    });

    /* ----------------------------------------------------------------------
     * The frozen query bag
     * -------------------------------------------------------------------- */

    describe('the query bag the incumbent builds from what it is handed', () => {
        it('names the project with the SINGULAR key `project`', async () => {
            const envelope = envelopeFor(2, 3);
            const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

            await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, { closed: false });

            // The frozen bag-building step is driven with EXACTLY what the facade
            // forwarded, so this asserts the bag the server would really receive
            // rather than a bag composed for the occasion.
            const call = log.list[0];
            const bag = incumbentParams(
                asPayload<number>(call?.[0]),
                asPayload<ResourceParams | undefined>(call?.[1]),
            );

            expect(bag).toEqual({ project: PROJECT_ID, closed: false });
            expect(Object.keys(bag).sort()).toEqual(['closed', 'project']);

            // ⭐ The three near-misses, each of which the endpoint would ACCEPT while
            // ignoring: an unrecognised query parameter is silently dropped, so the
            // response is HTTP 200 carrying every visible milestone instead of the one
            // project's. Naming them keeps the singular spelling from being "fixed".
            expect(bag).not.toHaveProperty('projects');
            expect(bag).not.toHaveProperty('project_id');
            expect(bag).not.toHaveProperty('projectId');
        });

        it('lets a caller filter override the seeded key, because the merge is in that order', () => {
            // `_.extend({}, params, filters or {})` seeds `project` FIRST and merges the
            // filters over it, so a filter of the same name wins. Reversing the merge
            // would make the seed unoverridable -- a behaviour change (T10), even though
            // no caller relies on it today.
            const bag = incumbentParams(PROJECT_ID, { project: 99, closed: true });

            expect(bag).toEqual({ project: 99, closed: true });
        });

        it('adds nothing of its own when the caller supplies no filters', () => {
            // The incumbent coalesces an absent filter argument to an empty bag, so the
            // result is the seed alone: no page size, no ordering, no default filter.
            expect(incumbentParams(PROJECT_ID)).toEqual({ project: PROJECT_ID });
            expect(incumbentParams(PROJECT_ID, {})).toEqual({ project: PROJECT_ID });
        });
    });

    /* ----------------------------------------------------------------------
     * The two frozen response headers, and the radix that reads them
     * -------------------------------------------------------------------- */

    describe('the two frozen response headers and the radix-10 parse', () => {
        /** Two milestones, the first OPEN and the second CLOSED. */
        function twoMilestones(): ReadonlyArray<TaigaModel<SprintFixtureAttrs>> {
            return [sprintModel(101, false), sprintModel(102, true)];
        }

        it('⭐⭐ reads both counts from their EXACTLY spelled header names', async () => {
            const headers = headersDouble({
                [CLOSED_MILESTONES_HEADER]: '3',
                [OPENED_MILESTONES_HEADER]: '7',
            });
            const milestones = twoMilestones();
            const envelope = incumbentEnvelope<SprintFixtureAttrs>([milestones, headers]);
            const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

            const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
                closed: false,
            });

            // ⭐⭐ THE NAMES, ASSERTED AS LITERALS RATHER THAN THROUGH THE CONSTANTS, so
            // that a typo introduced in the constants themselves is still caught here.
            // Note "Opened" on the wire against `open` on the envelope.
            expect(headers.mock.calls.map((call) => call[0])).toEqual([
                'Taiga-Info-Total-Closed-Milestones',
                'Taiga-Info-Total-Opened-Milestones',
            ]);
            expect(headers).toHaveBeenCalledTimes(2);

            // Counts, as NUMBERS -- the accessor answered with strings.
            expect(resolved.closed).toBe(3);
            expect(resolved.open).toBe(7);
            expect(typeof resolved.closed).toBe('number');
            expect(typeof resolved.open).toBe('number');

            // The milestones travel through untouched, by identity.
            expect(resolved.milestones).toBe(milestones);
        });

        it('⭐⭐ honours the explicit radix, so a LEADING ZERO is still read as decimal', async () => {
            // ⭐⭐ THE EXECUTABLE PROOF OF THE `, 10`. `"08"` is the value that separates a
            // radix-10 parse from a host-dependent one: with the radix it is decimal 8,
            // and a reading of 0 would under-report the closed sprints on a board while
            // looking like a perfectly ordinary zero.
            const headers = headersDouble({
                [CLOSED_MILESTONES_HEADER]: '08',
                [OPENED_MILESTONES_HEADER]: '011',
            });
            const envelope = incumbentEnvelope<SprintFixtureAttrs>([twoMilestones(), headers]);
            const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

            const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
                closed: false,
            });

            expect(resolved.closed).toBe(8);
            expect(resolved.open).toBe(11);

            // Spelled out, because "8, not 0" is the whole assertion.
            expect(resolved.closed).not.toBe(0);
            expect(resolved.open).not.toBe(9);
        });

        it('⭐⭐ PROPAGATES not-a-number for an ABSENT header instead of coercing it to zero', async () => {
            // ⭐⭐ THE FIRST SILENT-FAILURE MODE, reproduced at its real origin rather
            // than injected pre-parsed: the response simply does not carry the closed
            // count, the accessor answers with nothing, and the frozen parse yields
            // not-a-number under a successful HTTP 200.
            //
            // ⛔ COERCING IT TO ZERO -- or to a default, or to the array length -- WOULD
            // BE A BEHAVIOUR CHANGE (T10). Zero is a count the server never sent, and
            // substituting one converts a visible "no number here" into a confident,
            // wrong "none", which is strictly harder to notice.
            const headers = headersDouble({ [OPENED_MILESTONES_HEADER]: '7' });
            const envelope = incumbentEnvelope<SprintFixtureAttrs>([twoMilestones(), headers]);
            const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

            const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
                closed: false,
            });

            expect(headers).toHaveBeenCalledWith(CLOSED_MILESTONES_HEADER);
            expect(Number.isNaN(resolved.closed)).toBe(true);
            expect(resolved.closed).not.toBe(0);
            expect(resolved.closed).not.toBeUndefined();
            expect(resolved.closed).not.toBeNull();

            // The header that WAS present is unaffected: one absent count does not
            // invalidate the other, and neither is recomputed from the array.
            expect(resolved.open).toBe(7);
            expect(resolved.milestones).toHaveLength(2);
        });

        it('reads the accessor BY CALLING it, because headers are a FUNCTION not a dictionary', async () => {
            // ⭐ `queryMany` resolves `[result, data.headers]` -- and only because it was
            // called with its fourth argument set (`modules/base/repository.coffee:145-146`,
            // reached from `modules/resources/sprints.coffee:29`). Element 1 is therefore
            // the transport's ACCESSOR, forwarded untouched.
            //
            // Indexing it as a bag of keys is the mistake this pins: it yields nothing,
            // both counts become not-a-number, and nothing anywhere reports a problem.
            const headers = headersDouble({
                [CLOSED_MILESTONES_HEADER]: '3',
                [OPENED_MILESTONES_HEADER]: '7',
            });

            expect(typeof headers).toBe('function');

            const asBag = asPayload<Readonly<Record<string, unknown>>>(headers);

            expect(asBag[CLOSED_MILESTONES_HEADER]).toBeUndefined();
            expect(asBag[OPENED_MILESTONES_HEADER]).toBeUndefined();
            expect(Object.keys(headers)).not.toContain(CLOSED_MILESTONES_HEADER);
            expect(Object.keys(headers)).not.toContain(OPENED_MILESTONES_HEADER);

            // Read the sanctioned way, the same two values arrive.
            const envelope = incumbentEnvelope<SprintFixtureAttrs>([twoMilestones(), headers]);
            const { service } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });
            const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
                closed: false,
            });

            expect([resolved.closed, resolved.open]).toEqual([3, 7]);
        });

        it('⭐⭐ keeps the envelope COUNT `closed` distinct from a sprint\u2019s BOOLEAN `closed`', async () => {
            // ⭐⭐ THE SECOND SILENT-FAILURE MODE, and the single easiest mistake in this
            // module: `closed` means THREE different things on one call, and every one of
            // them type-checks in the wrong place.
            //
            //   - the FILTER `closed` is a boolean predicate -- "give me the open ones";
            //   - the ENVELOPE's `closed` is a COUNT parsed from a response header;
            //   - each SPRINT's `closed` is a boolean domain field on the milestone.
            //
            // Reading the count where the flag belongs makes a non-empty board look
            // closed, because 3 is truthy; reading the flag where the count belongs
            // renders "false sprints closed". Both compile, and both lie. Asserted here
            // TOGETHER, in one test, so the three cannot be conflated one at a time.
            const headers = headersDouble({
                [CLOSED_MILESTONES_HEADER]: '3',
                [OPENED_MILESTONES_HEADER]: '7',
            });

            // The first milestone is OPEN -- `closed: false` -- inside an envelope whose
            // own `closed` is the count 3. The two therefore disagree on purpose.
            const envelope = incumbentEnvelope<SprintFixtureAttrs>([twoMilestones(), headers]);
            const { service, log } = sprintsDouble({ list: { kind: 'fulfil', value: envelope } });

            const resolved = await listSprints<SprintFixtureAttrs>(service, PROJECT_ID, {
                closed: false,
            });

            // 1. The envelope count.
            expect(resolved.closed).toBe(3);
            expect(typeof resolved.closed).toBe('number');

            // 2. The domain flag, per milestone, independently.
            const first = resolved.milestones[0];
            const second = resolved.milestones[1];

            expect(first?.getAttrs().closed).toBe(false);
            expect(typeof first?.getAttrs().closed).toBe('boolean');
            expect(second?.getAttrs().closed).toBe(true);
            expect(typeof second?.getAttrs().closed).toBe('boolean');

            // 3. The filter predicate, exactly as it was forwarded.
            expect(log.list[0]?.[1]).toEqual({ closed: false });

            // And the three are genuinely not interchangeable.
            expect(resolved.closed).not.toBe(first?.getAttrs().closed);
            expect(first?.getAttrs().closed).not.toBe(second?.getAttrs().closed);
        });
    });
});

/* ==========================================================================
 * moveUserStoriesToMilestone -- the argument-transposition hazard
 * ========================================================================== */

describe('moveUserStoriesToMilestone', () => {
    /**
     * The entries the incumbent lightbox builds -- an id PLUS that story's sprint
     * order (`app/modules/components/move-to-sprint/move-to-sprint.controller.coffee:57-63`,
     * pinned by its spec at `move-to-sprint.controller.spec.coffee:73-76`).
     */
    const entries: readonly MoveEntry[] = [
        { us_id: 2, order: 6 },
        { us_id: 3, order: 7 },
    ];

    /** A response as the AngularJS transport hands it back. */
    const response: AngularHttpResponse<{ readonly moved: number }> = {
        data: { moved: 2 },
        status: 200,
        headers: asPayload<AngularHttpResponse<unknown>['headers']>(() => null),
    };

    it('puts the SOURCE sprint first and the DESTINATION third', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        // ⛔⛔ THE THIRD SILENT-FAILURE MODE, and the reason the two id fixtures
        // differ. The FIRST id is the sprint being left and is what the incumbent
        // feeds to the named-URL registry at `sprints.coffee:45`, so it ends up in
        // the URL path; the THIRD is the destination and goes into the request body
        // at `:46`. Transposing them still returns HTTP 200 and simply moves the
        // stories to the WRONG SPRINT, with no error, no toast and no warning.
        // Asserted as a whole positional list so a swap cannot pass.
        expect(log.moveUserStoriesMilestone).toEqual([
            [SOURCE_SPRINT_ID, PROJECT_ID, DESTINATION_SPRINT_ID, entries],
        ]);

        const call = log.moveUserStoriesMilestone[0];

        expect(call?.[0]).toBe(SOURCE_SPRINT_ID);
        expect(call?.[2]).toBe(DESTINATION_SPRINT_ID);
        expect(call?.[0]).not.toBe(call?.[2]);
    });

    it('forwards each entry with its id AND its order intact', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        // The payload is NOT a list of bare ids. Dropping the order field would
        // silently discard the ordering the server is being asked to apply.
        expect(log.moveUserStoriesMilestone[0]?.[3]).toEqual([
            { us_id: 2, order: 6 },
            { us_id: 3, order: 7 },
        ]);
    });

    it('copies the entries into a fresh array without altering their contents', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        const forwarded = log.moveUserStoriesMilestone[0]?.[3];

        // A fresh array, so a readonly input satisfies the frozen signature without
        // the caller's array being handed on to be mutated...
        expect(forwarded).not.toBe(entries);
        // ...while the ELEMENTS are the very same objects, untouched.
        expect(forwarded).toEqual(entries);
        expect(asPayload<readonly MoveEntry[]>(forwarded)[0]).toBe(entries[0]);
    });

    it('\u26d4 cannot be called with a null destination, because the endpoint rejects one', () => {
        // `move_userstories_to_sprint` validates through `UpdateMilestoneBulkValidator`,
        // whose `milestone_id` is a mandatory `IntegerField()`, and the view then does
        // `get_object_or_error(Milestone, pk=data["milestone_id"])` unconditionally. A
        // null destination is an HTTP 400 -- it does NOT mean "unassign" -- so the
        // signature refuses it and the mistake is unrepresentable rather than merely
        // discouraged.
        //
        // The GATE still lives in the UI, exactly as it does today: the incumbent
        // lightbox initialises its selection to nothing
        // (`move-to-sprint-lb.controller.coffee:36`) and gates its submit control on
        // the value being set (`move-to-sprint-lb.jade:79`). This facade adds no
        // run-time check of its own (T10); it simply requires the caller to have
        // passed its own gate before the call can be expressed.
        //
        // Asserted at the TYPE level, since a compile error cannot be caught at run
        // time. `@ts-expect-error` fails the build if the error ever stops occurring,
        // so this is an executable assertion rather than a comment.
        const callWithNullDestination = (): unknown =>
            moveUserStoriesToMilestone(
                sprintsDouble({ move: { kind: 'fulfil', value: response } }).service,
                SOURCE_SPRINT_ID,
                PROJECT_ID,
                // @ts-expect-error - a null destination is an HTTP 400, not an unassign
                null,
                entries,
            );

        expect(typeof callWithNullDestination).toBe('function');
    });

    it('forwards a real destination id in the third position, where the body reads it', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        // Position three, not one: the FIRST id is the source and lands in the URL
        // path, so a transposition moves the stories to the wrong sprint under an
        // HTTP 200, with no error anywhere.
        expect(log.moveUserStoriesMilestone).toEqual([
            [SOURCE_SPRINT_ID, PROJECT_ID, DESTINATION_SPRINT_ID, entries],
        ]);
    });

    it('forwards an empty entry list unchanged rather than short-circuiting', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            [],
        );

        // Skipping the request on an empty list would be an optimisation the
        // incumbent does not perform (T10).
        expect(log.moveUserStoriesMilestone).toEqual([
            [SOURCE_SPRINT_ID, PROJECT_ID, DESTINATION_SPRINT_ID, []],
        ]);
    });

    it('resolves the FULL response, not just its body', async () => {
        const { service } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        const resolved = await moveUserStoriesToMilestone<{ readonly moved: number }>(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        // Unwrapping the body here would hide the status the caller may need.
        expect(resolved).toBe(response);
        expect(resolved.status).toBe(200);
        expect(resolved.data).toEqual({ moved: 2 });
    });

    it('rejects with the reason unchanged', async () => {
        const reason = { status: 400, data: { bulk_stories: ['invalid'] } };
        const { service } = sprintsDouble({ move: { kind: 'reject', reason } });

        await expect(
            moveUserStoriesToMilestone(
                service,
                SOURCE_SPRINT_ID,
                PROJECT_ID,
                DESTINATION_SPRINT_ID,
                entries,
            ),
        ).rejects.toBe(reason);
    });

    it('is STATELESS: consecutive calls each delegate immediately, in order', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        // ⭐⭐ THE SERIALISATION LIVES SOMEWHERE ELSE, ON PURPOSE. Rapid consecutive
        // drags are serialised by the BACKLOG's own first-in-first-out queue and its
        // context-keyed re-entrancy guard -- `backlog/main.coffee:84` initialises the
        // queue, `:539-546` enqueues a real user drag, `:600-601` is the guard that
        // holds a second drag back while one is in flight, `:603-618` sends the head
        // and reconciles the server's answer, and `:620-629` re-drives the queue with a
        // null context so the re-drive neither enqueues nor trips the guard.
        //
        // That behaviour is being reimplemented in `../../backlog/state/backlogReducer.ts`
        // and `../../backlog/hooks/useStoryDrag.ts`, which are owned elsewhere and are
        // deliberately NOT this facade's concern. A facade that queued, de-duplicated,
        // deferred or coalesced would double-implement the guard -- two queues in series
        // reorder differently from one, so it would be a behaviour change (T10) and not
        // merely a redundant one.
        const first = moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );
        const second = moveUserStoriesToMilestone(
            service,
            DESTINATION_SPRINT_ID,
            PROJECT_ID,
            SOURCE_SPRINT_ID,
            entries,
        );

        await Promise.all([first, second]);

        expect(log.moveUserStoriesMilestone).toEqual([
            [SOURCE_SPRINT_ID, PROJECT_ID, DESTINATION_SPRINT_ID, entries],
            [DESTINATION_SPRINT_ID, PROJECT_ID, SOURCE_SPRINT_ID, entries],
        ]);
    });

    it('touches no sibling member', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        // In particular the task and issue move members are never reached, because
        // they are deliberately not faceted at all.
        expect(log.get).toEqual([]);
        expect(log.stats).toEqual([]);
        expect(log.list).toEqual([]);
    });

    it('resolves a NATIVE promise, not the AngularJS thenable it was handed', async () => {
        const { service } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        const result = moveUserStoriesToMilestone<{ readonly moved: number }>(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        expect(result).toBeInstanceOf(Promise);
        expect(typeof result.catch).toBe('function');
        expect(typeof result.finally).toBe('function');
        expect(
            thenableFor<AngularHttpResponse<{ readonly moved: number }>>(NEVER),
        ).not.toBeInstanceOf(Promise);

        await expect(result).resolves.toBe(response);
    });

    it('⛔ does NOT retry a rejected move, because a second send would move twice', async () => {
        // ⛔⛔ THIS IS A WRITE, AND IT IS NOT IDEMPOTENT IN THE WAY A RETRY WOULD NEED.
        // The endpoint is reached with a POST, so a silent retry after a failure risks
        // applying the same move twice -- and the failure that most invites a retry is
        // the very one where the first attempt may already have landed. The incumbent
        // retries nothing; adding a retry here would be a new feature (T10) with a
        // data-integrity cost.
        const reason = { status: 500, data: 'server error' };
        const { service, log } = sprintsDouble({ move: { kind: 'reject', reason } });

        await expect(
            moveUserStoriesToMilestone(
                service,
                SOURCE_SPRINT_ID,
                PROJECT_ID,
                DESTINATION_SPRINT_ID,
                entries,
            ),
        ).rejects.toBe(reason);

        // Exactly ONE delegation: no retry, no backoff, no second attempt.
        expect(log.moveUserStoriesMilestone).toHaveLength(1);

        // Give a retry every opportunity to appear before concluding it did not.
        await Promise.resolve();
        await Promise.resolve();

        expect(log.moveUserStoriesMilestone).toHaveLength(1);
    });

    it('⛔ carries the stories as the fourth ARGUMENT, which the incumbent sends as `bulk_stories`', async () => {
        // ⛔⛔ THE BODY KEY IS `bulk_stories`, AND IT IS NOT `bulk_userstories`.
        //
        // The facade never spells a body key: it forwards positional arguments, and the
        // incumbent builds `{project_id, milestone_id, bulk_stories: data}` from them at
        // `modules/resources/sprints.coffee:46`. So the key is pinned HERE at the
        // argument level -- the story list must arrive in slot FOUR, which is the slot
        // that becomes `bulk_stories`.
        //
        // ⚠ THE DISTINCTION, RECORDED SO IT IS NEVER GUESSED AT:
        //   - `bulk_stories`      -- this move, plus the bulk create and the bulk
        //                            milestone update. The sibling task and issue moves
        //                            use `bulk_tasks` and `bulk_issues` respectively
        //                            (`sprints.coffee:51`, `:56`).
        //   - `bulk_userstories`  -- the TWO STORY-ORDERING endpoints ONLY, faceted in
        //                            the sibling user-story module, never here.
        // Conflating them is a silent HTTP 400: the validator finds no field it
        // recognises, so nothing is moved and the failure surfaces only as a rejected
        // write with a field-name error nobody expects.
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            DESTINATION_SPRINT_ID,
            entries,
        );

        const call = log.moveUserStoriesMilestone[0];

        // Slot four, and it is the story list -- not the project id, not a sprint id.
        expect(call).toHaveLength(4);
        expect(Array.isArray(call?.[3])).toBe(true);
        expect(call?.[3]).toEqual(entries);

        // The facade contributes NO body object of its own, so no key it could have
        // misspelled exists: every argument it forwards is a number or the story array.
        expect(typeof call?.[0]).toBe('number');
        expect(typeof call?.[1]).toBe('number');
        expect(typeof call?.[2]).toBe('number');
    });
});

/* ==========================================================================
 * THE MODULE SURFACE
 * ========================================================================== */

/* ==========================================================================
 * THE SPRINT DOMAIN SHAPE -- what a milestone response does and does not carry
 * ========================================================================== */

describe('the Sprint domain type matches MilestoneSerializer, member for member', () => {
    /**
     * Exact type equality, in the standard conditional-inference form.
     *
     * Mutual assignability is not enough: a type with an EXTRA member stays
     * assignable in one direction, so a re-added phantom field would still satisfy an
     * assignability check.
     */
    type Equals<A, B> =
        (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

    it('\u26d4 declares NO `version`, because no milestone response carries one', () => {
        // A `version` was declared and exists in no milestone payload at all:
        // `MilestoneSerializer` declares id, name, slug, owner, project,
        // estimated_start, estimated_finish, created_date, modified_date, closed,
        // disponibility, order, user_stories, total_points, closed_points -- and
        // `project_extra_info` from its mixin. A sprint round-tripped through a write
        // would therefore have carried `undefined` as its optimistic-concurrency
        // token, which is either a rejected write or a silently overwritten
        // concurrent edit.
        const hasNoVersion: Equals<Extract<keyof Sprint, 'version'>, never> = true;

        expect(hasNoVersion).toBe(true);
    });

    it('\u2b50 the NESTED stories DO carry a version, which is why the confusion arose', () => {
        // `UserStoryNestedSerializer` declares `version`; `MilestoneSerializer` does
        // not. Asserting both halves is what keeps the distinction from collapsing
        // again in either direction.
        const nestedHasVersion: Equals<NestedSprintUserStory['version'], number> = true;

        expect(nestedHasVersion).toBe(true);
    });

    it('\u26d4 nested stories are NOT full list stories -- nineteen members are absent', () => {
        // A sprint's stories come from `UserStoryNestedSerializer`, the backlog's rows
        // from `UserStoryListSerializer`. Declaring the nested ones as full stories
        // promised every member below; a component reading `story.tags` off a sprint
        // row gets `undefined`, and `story.tags.map(...)` throws.
        type AbsentFromNested =
            | 'tags'
            | 'assigned_users'
            | 'owner'
            | 'tasks'
            | 'swimlane'
            | 'total_attachments'
            | 'total_comments'
            | 'attachments'
            | 'watchers';

        const noneOfThemPresent: Equals<
            Extract<keyof NestedSprintUserStory, AbsentFromNested>,
            never
        > = true;

        expect(noneOfThemPresent).toBe(true);
    });

    it('\u2b50 a sprint\u2019s point members are SCALAR SUMS, not role-keyed maps', () => {
        // `total_points_attr` / `closed_points_attr` are `SUM(projects_points.value)`
        // sub-selects, null when the sprint's stories carry no role points. The
        // identically-named members of the `/stats` response are a role-keyed map and
        // an array respectively -- three different value kinds behind two names.
        const totalIsNullableNumber: Equals<Sprint['total_points'], number | null> = true;
        const closedIsNullableNumber: Equals<Sprint['closed_points'], number | null> = true;
        const statsTotalIsAMap: Equals<
            SprintStatsResponse['total_points'],
            Readonly<Record<string, number>>
        > = true;
        const statsCompletedIsAnArray: Equals<
            SprintStatsResponse['completed_points'],
            readonly number[]
        > = true;

        expect([
            totalIsNullableNumber,
            closedIsNullableNumber,
            statsTotalIsAMap,
            statsCompletedIsAnArray,
        ]).toEqual([true, true, true, true]);
    });

    it('a sprint that satisfies the domain type needs no invented member', () => {
        // The run-time half: a fixture built from the serializer's fields alone
        // type-checks, which it could not do if a phantom member were still required.
        const sprint: Sprint = {
            id: 8,
            name: 'Sprint 2026-5-15',
            slug: 'sprint-2026-5-15',
            owner: 6,
            project: 3,
            closed: false,
            disponibility: null,
            order: 1,
            created_date: '2026-05-01T10:00:00+0000',
            modified_date: '2026-05-02T10:00:00+0000',
            closed_points: 21,
            total_points: 101.5,
            estimated_start: '2026-05-15',
            estimated_finish: '2026-05-30',
            user_stories: [],
        };

        expect(Object.keys(sprint)).not.toContain('version');
        expect(sprint.user_stories).toEqual([]);
    });
});

describe('the sprints facade module', () => {
    it('exports exactly four functions and nothing else', async () => {
        const facade: Record<string, unknown> = await import('./sprints');

        // Guards the file's contract from both directions: a fifth helper cannot be
        // added unnoticed -- notably none for the task or issue move members, which
        // belong to out-of-scope screens -- and none of the four can be dropped.
        const exported = Object.keys(facade)
            .filter((key) => typeof facade[key] === 'function')
            .sort();

        expect(exported).toEqual([
            'getSprint',
            'getSprintStats',
            'listSprints',
            'moveUserStoriesToMilestone',
        ]);

        // Exactly four, so a fifth cannot hide behind a passing list assertion.
        expect(exported).toHaveLength(4);
    });

    it('⭐ faces NEITHER the task move NOR the issue move, which belong to other screens', async () => {
        const facade: Record<string, unknown> = await import('./sprints');

        // ⭐⭐ THE PERMANENT SCOPE-CREEP GUARD. The same incumbent provider exposes two
        // further move members immediately below the user-story one --
        // `moveTasksMilestone` at `modules/resources/sprints.coffee:49-52` and
        // `moveIssuesMilestone` at `:54-57` -- differing from it only in their body key
        // (`bulk_tasks` and `bulk_issues` against `bulk_stories`).
        //
        // They are NOT faceted, and that is a scope decision rather than an omission:
        // tasks belong to the taskboard and issues to the issues screen, both of which
        // this migration leaves as AngularJS. Their near-identical shape is exactly what
        // makes adding one feel harmless, so the absence is asserted BY NAME. Needing
        // either of them is a reviewed change to the scope, not a convenience edit.
        expect(facade['moveTasksMilestone']).toBeUndefined();
        expect(facade['moveIssuesMilestone']).toBeUndefined();
        expect(Object.keys(facade)).not.toContain('moveTasksMilestone');
        expect(Object.keys(facade)).not.toContain('moveIssuesMilestone');

        // Nor under a renamed React-side spelling of the same thing.
        for (const alias of [
            'moveTasksToMilestone',
            'moveIssuesToMilestone',
            'moveTasks',
            'moveIssues',
        ]) {
            expect(facade[alias]).toBeUndefined();
        }
    });

    it('exposes no permission helper, no token accessor and no storage helper', async () => {
        const facade: Record<string, unknown> = await import('./sprints');
        const keys = Object.keys(facade).map((key) => key.toLowerCase());

        // React reads the same permission array the AngularJS directives read and
        // computes no independent notion of what the user may do; the session token
        // stays where the storage service keeps it; and this namespace's provider is
        // constructed with the storage service but never uses it
        // (`sprints.coffee:13`, `:62-64`), so there is nothing synchronous to facade.
        for (const forbidden of ['permission', 'token', 'store', 'storage', 'auth']) {
            expect(keys.some((key) => key.includes(forbidden))).toBe(false);
        }
    });
});
