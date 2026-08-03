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
 */

import {
    getSprint,
    getSprintStats,
    listSprints,
    moveUserStoriesToMilestone,
} from './sprints';
import type {
    AngularHttpResponse,
    AngularPromise,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';

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
 * (`app/coffee/modules/base/model.coffee:9-127`), so its members live on a
 * PROTOTYPE and are therefore NOT copied by a spread. A literal would put them on
 * the instance as own enumerable properties, quietly making the pitfall assertions
 * below pass for the wrong reason and making a spread look survivable when against
 * the real class it is not.
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
 * The statistics body shape, mirrored locally.
 *
 * The facade's own payload type is intentionally NOT exported -- it describes a raw
 * response rather than a domain model -- so the spec mirrors it structurally and
 * passes it explicitly. Mirroring it here also means a drift in the real shape
 * shows up as a compile error in this spec.
 *
 * ⭐ The two point fields are MAPS keyed by role, and the four DERIVED fields the
 * incumbent consumer computes onto its own view state are deliberately absent.
 */
type StatsFixture = {
    readonly total_points: Readonly<Record<string, number>>;
    readonly completed_points: Readonly<Record<string, number>>;
    readonly total_tasks: number;
    readonly completed_tasks: number;
};

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
 * slot (`app/coffee/modules/resources/sprints.coffee:18-20` for a single sprint,
 * `:33-36` once per milestone). That is the second level of the nesting hazard.
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

        // A spread copies own enumerable properties only, so the prototype methods
        // are LOST -- the value is no longer a model and can no longer be saved.
        expect(typeof spread['getAttrs']).toBe('undefined');

        // It also LEAKS the private bookkeeping fields, which are own and
        // enumerable on the real class too (`model.coffee:11-13`, `:58-61`).
        expect(spread).toHaveProperty('_attrs');
        expect(spread).toHaveProperty('_modifiedAttrs');

        // And it still does not solve level two: the stories remain models.
        const sanctioned = resolved.getAttrs();

        expect(Object.keys(sanctioned)).not.toContain('_attrs');
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

    it('rejects with the reason unchanged, so the interceptor chain stays visible', async () => {
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
     * (`app/coffee/modules/taskboard/main.coffee:418-419`).
     *
     * Note what is ABSENT: the point sums, the remaining counts and the completion
     * percentage. That consumer DERIVES those onto its own view state at `:422-431`;
     * they are not wire fields, and the facade neither declares nor computes them.
     */
    const statsPayload: StatsFixture = {
        total_points: { UX: 20, Design: 15.5, Front: 66 },
        completed_points: { UX: 10, Design: 5.5, Front: 5.5 },
        total_tasks: 108,
        completed_tasks: 21,
    };

    it('forwards the project id and the sprint id positionally, in that order', async () => {
        const { service, log } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        await getSprintStats(service, PROJECT_ID, SPRINT_ID);

        // ⭐ Same accepted-but-unused project id as the single-sprint read
        // (`sprints.coffee:23`), and the same reason it must still be forwarded.
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

        // The point fields stay MAPS -- not pre-summed. Summing is the caller's.
        expect(resolved.total_points).toEqual({ UX: 20, Design: 15.5, Front: 66 });
        expect(resolved.completed_points).toEqual({ UX: 10, Design: 5.5, Front: 5.5 });
        expect(resolved.total_tasks).toBe(108);
        expect(resolved.completed_tasks).toBe(21);
    });

    it('adds no derived field of its own', async () => {
        const { service } = sprintsDouble({ stats: { kind: 'fulfil', value: statsPayload } });

        const resolved = await getSprintStats<StatsFixture>(service, PROJECT_ID, SPRINT_ID);

        // Deriving these here would relocate controller behaviour into the resource
        // layer, which T10 forbids.
        expect(Object.keys(resolved).sort()).toEqual([
            'completed_points',
            'completed_tasks',
            'total_points',
            'total_tasks',
        ]);
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
});

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
        // `app/coffee/modules/backlog/main.coffee:305-306`.
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

    it('accepts a null destination without adding a guard of its own', async () => {
        const { service, log } = sprintsDouble({ move: { kind: 'fulfil', value: response } });

        // The incumbent lightbox initialises its selection to nothing
        // (`move-to-sprint-lb.controller.coffee:36`) and gates its submit control on
        // the value being set (`move-to-sprint-lb.jade:79`), so the gate lives in the
        // UI. Validating here would be behaviour the incumbent does not have (T10).
        await moveUserStoriesToMilestone(
            service,
            SOURCE_SPRINT_ID,
            PROJECT_ID,
            null,
            entries,
        );

        expect(log.moveUserStoriesMilestone).toEqual([
            [SOURCE_SPRINT_ID, PROJECT_ID, null, entries],
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

        // ⭐ Rapid consecutive moves are serialised by the BACKLOG's own queue and
        // its re-entrancy guard (`backlog/main.coffee:84`, `:539-546`, `:600-601`),
        // never here. A facade that queued, de-duplicated or deferred would
        // double-implement that guard and change behaviour (T10).
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
});

/* ==========================================================================
 * THE MODULE SURFACE
 * ========================================================================== */

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
