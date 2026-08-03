/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Co-located specs for the `projects` typed facade.
 *
 * WHY THIS FILE IS MANDATORY, not optional. `jest.config.js` sets `collectCoverage: true`
 * unconditionally and its `collectCoverageFrom` sweeps `app/react/**` with only specs,
 * ambient declarations and the bundle entry point excluded, against a hard
 * `coverageThreshold.global.lines` of 70 (requirement HR-9). The facade is therefore
 * measured whether or not a spec exists, so shipping it without one would drag the whole
 * gate down.
 *
 * WHAT IS ASSERTED, AND WHY EACH ASSERTION EARNS ITS PLACE. The facade is two statements
 * long, so line coverage is the easy part; the value of this suite is that it pins the
 * three properties a plausible-looking rewrite would break:
 *
 *   1. ⭐ THE ASYMMETRY. `getProjectStats` resolves PLAIN JSON while
 *      `getProjectTagsColors` resolves a `$tgModel` INSTANCE. The model-returning read is
 *      asserted to resolve the model ITSELF — identity, methods intact — and specifically
 *      NOT a flattened dictionary, because flattening is the caller's job (rule T10). The
 *      "spreading a model is wrong" pitfall (P-IMMER-1) is demonstrated against a double
 *      built to mirror the real model's accessor mechanism, so the documented hazard is
 *      proven rather than asserted in prose.
 *   2. VERBATIM PASS-THROUGH, in both directions. Fulfilment values arrive with the same
 *      identity and the same field names — mixed snake_case and camelCase included — and
 *      rejection reasons arrive with the same identity. Nothing is renamed, rounded,
 *      defaulted, wrapped or swallowed (T10, and goal G2's frozen contract).
 *   3. NO NEW TRANSPORT AND NO ADDED BEHAVIOUR. The project id is forwarded unchanged as
 *      the single argument, so no path is composed here (rule T5); repeated calls delegate
 *      every time, so no cache was added; a never-settling source stays pending, so no
 *      timeout was added; and the module's export surface is exactly two functions, so no
 *      third helper crept in.
 *
 * The suite is browserless and offline by construction (requirement HR-5): it touches no
 * DOM, starts no server, imports no end-to-end runner and needs no build output. The
 * incumbent service is replaced by hand-built doubles, which is possible precisely because
 * the facade takes the service as a parameter instead of reaching for the injector
 * (requirement I9).
 *
 * ---------------------------------------------------------------------------------------
 * THE GOVERNING TEST MANDATE: MOCK THE INJECTOR, NEVER LOAD AngularJS (rule T9)
 * ---------------------------------------------------------------------------------------
 * The bridge layer reads framework globals off `window`, so every spec under `app/react/**`
 * is bound by one rule: mock the injector — do NOT load the framework. Nothing here
 * imports the AngularJS runtime, registers a module, opens an injector, or assigns a global;
 * there is no `$provide.value(...)` equivalent and no test module to bootstrap.
 *
 * The incumbent Karma template for this suite
 * (`components/move-to-sprint/move-to-sprint.controller.spec.coffee`) has to stand a
 * controller up inside a real injector and register each dependency with
 * `provide.value("tgLightboxFactory", ...)`. This spec needs none of that, because both
 * faced reads take the `projects` sub-resource AS THEIR FIRST PARAMETER: a PLAIN TYPED
 * OBJECT handed straight in replaces the whole provider dance. That is the direct
 * translation of the incumbent convention — one clearly named double per dependency, built
 * by a helper, asserted on both the positive and the negative path — minus the framework.
 *
 * A `mockInjector()` helper does exist under `app/react/bridge/` for the specs that
 * genuinely need an injector surface (the hooks). This one does not: reaching for it here
 * would add indirection around a two-parameter function call and test the wrong seam.
 *
 * MOCK LIFECYCLE IS THE RUNNER'S JOB. `jest.config.js` sets `clearMocks: true` and
 * `restoreMocks: true`, so call records and every spied implementation are reset before each
 * test automatically. This file therefore contains NO manual reset call whatsoever — adding
 * one would be redundant and would imply the shared configuration cannot be relied upon.
 * Each test also builds its own double, so no state crosses a test boundary at all.
 *
 * FIXTURES ARE PLAIN OBJECTS, NEVER PERSISTENT COLLECTIONS. The AngularJS side of the two
 * screens models board state with the immutable-collection library, and that library stays
 * installed for its 124 out-of-scope consumers (requirement I5) — but it is never imported
 * under `app/react/**`, in production code or in a spec. React state is plain objects with
 * structural sharing supplied by immer, so every fixture below is a plain object literal.
 * A persistent-collection fixture would not merely be off-style: it would assert a shape
 * the facade never sees, since the seam flattens to plain JSON before React is reached.
 *
 * ⭐ AND ONE PRECEDENT THAT MUST NEVER BE COPIED (rule T5). `service.import`
 * (`resources/projects.coffee:182-196`) is the ONLY member of the whole incumbent resource
 * layer that bypasses the shared HTTP service: it assembles a multipart body at `:182-183`
 * and a raw browser upload request at `:185`, then sets the bearer authorization header
 * itself at `:194` — the one place in the layer where a stored credential is read by hand.
 * It exists solely for a multipart FILE UPLOAD, it belongs to the out-of-scope
 * import-export screen, and it REINFORCES T5 rather than licensing an exception to it:
 * "Reuse `$tgResources`; do not build a parallel HTTP client."
 *
 * Accordingly this spec stubs no transport, installs no request-API global, and asserts
 * nothing about one — there is no client to intercept, because the facade has none. Nothing
 * in this file performs I/O whatsoever, and nothing reads or writes a credential:
 * the session token stays where the incumbent keeps it, reached only through the AngularJS
 * storage service, and relocating it is explicitly out of scope (AAP §0.8.2).
 *
 * TEST DATA IS DELIBERATELY SYNTHETIC. Tag-colour fixtures use obviously fake tokens rather
 * than real colour values: colours are per-project DATA (rule T2) and the values visible in
 * the Figma frames are seeded sample data (AAP §0.3.6, drift entry D3). Synthetic fixtures
 * also make the point of the assertion clearer — the facade forwards whatever it is given,
 * whatever that happens to be.
 */

import { getProjectStats, getProjectTagsColors } from './projects';
import type {
    AngularPromise,
    ProjectsResource,
    TaigaModel,
} from '../../bridge/useAngularService';

/* ==========================================================================
 * FIXTURES AND DOUBLES
 * ========================================================================== */

/** A project id fixture. Forwarded unchanged by both facades. */
const PROJECT_ID = 42;

/**
 * Presents a fixed fixture as the payload type the caller asked for.
 *
 * Both faced members are GENERIC over their payload — see
 * `../../bridge/useAngularService.ts:662-679` — and the facade, not the double, chooses the
 * type argument, while a double necessarily holds one concrete fixture. This helper bridges
 * that gap in one clearly named place instead of scattering conversions through the doubles.
 * Test-only, and never used by production code.
 */
function asPayload<T>(value: unknown): T {
    return value as T;
}

/** How a doubled member should settle: fulfil, reject, or never settle at all. */
type Outcome =
    | { readonly kind: 'fulfil'; readonly value: unknown }
    | { readonly kind: 'reject'; readonly reason: unknown }
    | { readonly kind: 'pending' };

/**
 * A stand-in for an AngularJS `$q` promise: the smallest thenable the marshaller relies on.
 *
 * Deliberately NOT a native promise. The incumbent resource layer returns `$q` promises,
 * whose resolution is tied to the AngularJS digest loop, and the whole purpose of the seam
 * the facade crosses is to convert one into a native promise. Handing the facade a native
 * promise here would test nothing about that conversion.
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

/** Every argument list each doubled member was called with, in call order. */
interface CallLog {
    readonly stats: number[][];
    readonly tagsColors: number[][];
}

/**
 * Builds a double of the `projects` sub-resource service.
 *
 * Records the FULL argument list of every call — not just the first argument — because one
 * of the properties under test is that the facade forwards the project id and NOTHING else:
 * no params bag, no options object, no composed path.
 */
function projectsDouble(
    statsOutcome: Outcome,
    tagsColorsOutcome: Outcome,
): { service: ProjectsResource; log: CallLog } {
    const log: CallLog = { stats: [], tagsColors: [] };

    const service: ProjectsResource = {
        stats<TStats>(...args: [number]): AngularPromise<TStats> {
            log.stats.push(args);

            return thenableFor<TStats>(statsOutcome);
        },

        tagsColors<TColors>(...args: [number]): AngularPromise<TaigaModel<TColors>> {
            log.tagsColors.push(args);

            return thenableFor<TaigaModel<TColors>>(tagsColorsOutcome);
        },
    };

    return { service, log };
}

/**
 * A faithful stand-in for a `$tgModel` instance, built the way the real one is built.
 *
 * A CLASS, not an object literal, and that choice is load-bearing rather than stylistic.
 * The real model is a CoffeeScript class (`base/model.coffee:9-127`), so its members live on
 * a PROTOTYPE and are therefore NOT copied by a spread. A literal would put them on the
 * instance as own enumerable properties, quietly making the P-IMMER-1 pitfall assertion
 * below pass for the wrong reason and, worse, making a spread look survivable when against
 * the real class it is not.
 *
 * Everything else mirrors the original too:
 *
 *   - the attribute bag and the modified set are own, enumerable bookkeeping fields
 *     (`:11-13`, `:58-61`) -- which is exactly why a spread leaks them;
 *   - one enumerable, configurable accessor pair per attribute is installed with
 *     `Object.defineProperty` (`:94-101`), so attributes are NOT own data properties;
 *   - `getAttrs()` returns a FRESH plain merge of the bag and the modified set (`:48-54`),
 *     never the bag itself.
 *
 * ⚠ `enumerable: true` IS VERIFIED, NOT ASSUMED, AND MUST NOT BE "CORRECTED" TO FALSE.
 * `Object.defineProperty` defaults `enumerable` to false, which would make a spread of a
 * model capture NOTHING at all -- a tempting and wrong mental model. The real code passes
 * the flag EXPLICITLY: `enumerable: true` at `base/model.coffee:98`, alongside
 * `configurable: true` at `:99`, inside the per-attribute loop at `:94-101`. So a spread of
 * a real model DOES read the attribute values through their getters -- and still fails to be
 * a flattening, because it simultaneously drags the private bookkeeping in and leaves every
 * prototype method behind. That is precisely what the P-IMMER-1 test below demonstrates, and
 * it is a stronger result than "the spread is empty" because the wreckage LOOKS usable.
 * Flipping this double to a non-enumerable accessor would make the suite assert a behaviour
 * the incumbent does not have, which is the one thing a migration spec must never do
 * (rule T10, goal G2: behaviour follows the AngularJS implementation).
 *
 * Declared as implementing the bridge's model type so the facade's real signature is
 * exercised rather than a look-alike.
 */
class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    /** `model.coffee:11`. The raw attribute bag -- own and enumerable, as in the original. */
    public _attrs: TAttrs;

    /** `model.coffee:12`. The resource name the model was created under. */
    public _name = 'projects';

    /** `model.coffee:58`. Pending changes, empty until something is written. */
    public _modifiedAttrs: Record<string, unknown> = {};

    /** `model.coffee:61`. The dirty flag the repository's write path short-circuits on. */
    public _isModified = false;

    public constructor(attrs: TAttrs) {
        this._attrs = { ...attrs };

        // A keyed view of the same object, so the accessors below can read it by name
        // without forcing the public attribute type to carry an index signature.
        const bagByKey: Record<string, unknown> = asPayload<Record<string, unknown>>(
            this._attrs,
        );
        const modified = this._modifiedAttrs;

        // `model.coffee:94-101` -- accessors over the bag, not data properties on the
        // instance. Reading an attribute therefore runs a getter, which is the mechanism
        // the flattening discipline exists because of.
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

    /** `model.coffee:48-54`. A fresh plain merge -- the sanctioned flattening path. */
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
        return new ModelDouble<TAttrs>(this._attrs);
    }
}

/** Convenience constructor for {@link ModelDouble}, so call sites read as fixtures. */
function modelDouble<TAttrs extends object>(attrs: TAttrs): TaigaModel<TAttrs> {
    return new ModelDouble<TAttrs>(attrs);
}

/* ==========================================================================
 * getProjectStats -- the PLAIN JSON half of the asymmetry
 * ========================================================================== */

describe('getProjectStats', () => {
    /**
     * The statistics payload as the server sends it, with the field names the summary bar
     * reads: `app/partials/includes/components/summary.jade:15`, `:18`, `:21` and `:24`,
     * plus the milestone total read at `backlog/main.coffee:266`.
     *
     * Note what is ABSENT: the completion percentage. The incumbent controller derives it
     * at `backlog/main.coffee:262` / `:264` -- it is not a wire field.
     */
    const statsPayload = {
        total_points: 392,
        defined_points: 392.5,
        closed_points: 21,
        speed: 0,
        total_milestones: 5,
    };

    it('forwards the project id unchanged as the only argument', async () => {
        const { service, log } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        await getProjectStats(service, PROJECT_ID);

        // Exactly one delegation, carrying exactly one argument. No params bag, no options
        // object, and above all no composed path: the sub-path is built inside the
        // incumbent repository layer at `repository.coffee:175`, never here (rule T5).
        expect(log.stats).toEqual([[PROJECT_ID]]);
    });

    it('does not touch the sibling tag-colour read', async () => {
        const { service, log } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        await getProjectStats(service, PROJECT_ID);

        // The two reads are never merged into one round trip (rule T10).
        expect(log.tagsColors).toEqual([]);
    });

    it('returns a native promise rather than the AngularJS thenable it was given', () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const result = getProjectStats(service, PROJECT_ID);

        // The seam did its job: what comes back is a real promise, so React code above it
        // can await it with no AngularJS digest involvement whatsoever.
        expect(result).toBeInstanceOf(Promise);

        return expect(result).resolves.toBe(statsPayload);
    });

    it('resolves the parsed body with its identity intact -- no copy, no wrapper', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        // Identity, not deep equality: a clone would satisfy `toEqual` while proving that
        // something in between had rebuilt the payload.
        expect(stats).toBe(statsPayload);
    });

    it('⭐ resolves a PLAIN, SPREADABLE object -- the immer-safe half of the asymmetry', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const spread: Record<string, unknown> = { ...(await getProjectStats(service, PROJECT_ID)) };

        // ⭐ THE MATCHED PAIR to the model-spread assertion in the sibling describe below,
        // and the reason both exist. `service.stats` goes through the repository's RAW query
        // (`resources/projects.coffee:43` -> `base/repository.coffee:173-180`), which
        // resolves `data.data` at `:180` -- the parsed body itself, with no wrapper. So a
        // spread here is LOSSLESS: it reproduces the payload exactly, which is what makes
        // this value safe to place in React state and safe to hand to an immer producer.
        //
        // Read the two assertions together: identical call shape, two-parameter signature,
        // one project id -- and yet spreading THIS result yields the data while spreading
        // the tag-colour result yields a broken hybrid. That difference is structural, not
        // incidental, and pinning it here is what stops a future change from "simplifying"
        // both facades to one return type.
        expect(spread).toEqual(statsPayload);
        // No private bookkeeping field rides along, because there is no wrapper to leak one.
        expect(Object.keys(spread).some((key) => key.startsWith('_'))).toBe(false);
        // A spread is a copy, so identity is deliberately NOT expected here -- the identity
        // of the resolved value itself is asserted by the preceding test.
        expect(spread).not.toBe(statsPayload);
    });

    it('surfaces every field name verbatim, mixed conventions included', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        // snake_case totals and nothing renamed to camelCase: renaming would be a response
        // transformation (T10) and would break the frozen contract (G2).
        expect(Object.keys(stats).sort()).toEqual([
            'closed_points',
            'defined_points',
            'speed',
            'total_milestones',
            'total_points',
        ]);
        expect(stats.total_points).toBe(392);
        expect(stats.defined_points).toBe(392.5);
        expect(stats.closed_points).toBe(21);
        expect(stats.speed).toBe(0);
        expect(stats.total_milestones).toBe(5);
    });

    it('forwards the summary bar payload untransformed, mixed conventions and all', async () => {
        // THE EXACT FIVE VALUES THE DARK SUMMARY BAR RENDERS, in one object:
        // `summary.jade:12` the percentage, `:15` project points, `:18` defined points,
        // `:21` closed points, `:24` points per sprint. Asserted as a whole rather than
        // field by field, because the property under test is that the payload arrives as
        // ONE UNTOUCHED OBJECT.
        //
        // ⚠ THE MIXTURE OF CONVENTIONS IS THE POINT, and it is deliberately NOT tidied:
        // `completedPercentage` is camelCase while every point total is snake_case. That is
        // what the summary bar consumes today, so it is what must survive the seam.
        // Normalising the casing, renaming a field, rounding the percentage, or coercing
        // `speed: 0` into a default would each be a response transformation (rule T10) and
        // would break the frozen backend contract (goal G2). `toEqual` against the identical
        // literal is what makes each of those a failing test rather than a silent change.
        //
        // The percentage is carried here because the screen derives it and writes it onto
        // this very object (`backlog/main.coffee:262`, or `0` at `:264` when there is no
        // denominator) -- a write that is only possible because this half of the asymmetry
        // is plain mutable JSON. What the WIRE sends is asserted separately by the next
        // test, which pins the field's absence and proves the facade substitutes no default.
        const summaryBarPayload = {
            completedPercentage: 5,
            total_points: 392,
            defined_points: 392.5,
            closed_points: 21,
            speed: 0,
        };
        const { service } = projectsDouble(
            { kind: 'fulfil', value: summaryBarPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(stats).toEqual(summaryBarPayload);
        // Field-for-field, so a failure names the offender instead of dumping two objects.
        expect(stats.completedPercentage).toBe(5);
        expect(stats.total_points).toBe(392);
        // A non-integer total survives as a non-integer: nothing is rounded or truncated.
        expect(stats.defined_points).toBe(392.5);
        expect(stats.closed_points).toBe(21);
        // Zero is preserved as zero, not replaced by a fallback and not dropped as falsy.
        expect(stats.speed).toBe(0);
        expect(Object.keys(stats)).toHaveLength(5);
    });

    it('leaves the client-derived completion percentage absent', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        // The facade adds no default and computes nothing (T10). Deriving the percentage
        // stays with the screen, exactly where the incumbent controller does it
        // (`backlog/main.coffee:262` / `:264`).
        expect('completedPercentage' in stats).toBe(false);
        expect(stats.completedPercentage).toBeUndefined();
    });

    it('passes empty nullable totals through as null instead of substituting a zero', async () => {
        // A brand-new project: the incumbent guards these three with existential and truthy
        // checks at `backlog/main.coffee:259`, `:261` and `:266`, and at `summary.jade:14`.
        const emptyProject = {
            total_points: null,
            defined_points: null,
            closed_points: 0,
            speed: 0,
            total_milestones: null,
        };
        const { service } = projectsDouble(
            { kind: 'fulfil', value: emptyProject },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(stats.total_points).toBeNull();
        expect(stats.defined_points).toBeNull();
        expect(stats.total_milestones).toBeNull();
        // Not zero and not undefined: a substituted default would silently turn "unknown"
        // into "none", and the summary bar's own truthy guard at `summary.jade:14` is the
        // incumbent already relying on that distinction.
        expect(stats.total_points).not.toBe(0);
        expect(stats.defined_points).not.toBeUndefined();
    });

    it('coerces nothing, even where the wire disagrees with the declared shape', async () => {
        // Every point total empty, INCLUDING `closed_points` -- which the facade's own
        // response type declares as a plain number because the incumbent reads it unguarded
        // (`backlog/main.coffee:262`, `summary.jade:21`). A static type is a claim about the
        // server, not a runtime coercion, and this facade adds none: whatever the wire sends
        // is what the caller receives.
        //
        // Asserting the pessimistic case matters because the alternative failure is silent.
        // Had the facade "helpfully" defaulted an empty total to zero, a project with
        // unknown progress would render as a project with none, and no test that fed it a
        // well-formed payload would ever notice (rule T10, goal G2).
        const emptyTotals = {
            total_points: null,
            defined_points: null,
            closed_points: null,
            speed: 0,
            total_milestones: null,
        };
        const { service } = projectsDouble(
            { kind: 'fulfil', value: emptyTotals },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(stats.closed_points).toBeNull();
        expect(stats.closed_points).not.toBe(0);
        // The whole payload, unaltered -- no field added, removed, renamed or defaulted.
        expect(stats).toEqual(emptyTotals);
    });

    it('rejects with the incumbent rejection value untouched', async () => {
        // Shaped like a real interceptor rejection: the interceptor pipeline communicates
        // failure through rejection VALUES carrying status and body, which is how a version
        // conflict, a blocked project or connection loss reaches the screen at all.
        const rejection = { status: 400, data: { version: 3 } };
        const { service } = projectsDouble(
            { kind: 'reject', reason: rejection },
            { kind: 'pending' },
        );

        // Identity again: re-wrapping or normalising the reason would hide the very
        // conditions the interceptor pipeline exists to surface.
        await expect(getProjectStats(service, PROJECT_ID)).rejects.toBe(rejection);
    });

    it('delegates on every call, so no cache was introduced', async () => {
        const { service, log } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        await getProjectStats(service, PROJECT_ID);
        await getProjectStats(service, PROJECT_ID);
        await getProjectStats(service, 7);

        // Three calls in, three delegations out. GET de-duplication already exists one
        // layer down in the shared HTTP service; reimplementing it here would be an
        // enhancement (T10) and would defeat it.
        expect(log.stats).toEqual([[PROJECT_ID], [PROJECT_ID], [7]]);
    });

    it('stays pending when the source never settles, so no timeout was introduced', async () => {
        const { service } = projectsDouble({ kind: 'pending' }, { kind: 'pending' });
        const pendingSentinel = 'still-pending';

        const winner = await Promise.race([
            getProjectStats(service, PROJECT_ID).then(() => 'settled'),
            Promise.resolve(pendingSentinel),
        ]);

        // The incumbent has no timeout, retry or cancellation, so neither does the facade.
        expect(winner).toBe(pendingSentinel);
    });
});

/* ==========================================================================
 * getProjectTagsColors -- the `$tgModel` half of the asymmetry
 * ========================================================================== */

describe('getProjectTagsColors', () => {
    /**
     * A tag-name-to-colour dictionary. Synthetic values on purpose (rule T2): colours are
     * per-project data, and one tag deliberately has none, which the incumbent
     * tag-creation path allows by defaulting the colour to null
     * (`resources/projects.coffee:102-109`).
     */
    const tagsColorsAttrs = {
        'needs-review': 'fixture-colour-token-a',
        blocked: 'fixture-colour-token-b',
        untagged: null,
    };

    it('forwards the project id unchanged as the only argument', async () => {
        const { service, log } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        await getProjectTagsColors(service, PROJECT_ID);

        expect(log.tagsColors).toEqual([[PROJECT_ID]]);
    });

    it('does not touch the sibling statistics read', async () => {
        const { service, log } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        await getProjectTagsColors(service, PROJECT_ID);

        expect(log.stats).toEqual([]);
    });

    it('returns a native promise rather than the AngularJS thenable it was given', () => {
        const model = modelDouble(tagsColorsAttrs);
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: model },
        );

        const result = getProjectTagsColors(service, PROJECT_ID);

        expect(result).toBeInstanceOf(Promise);

        return expect(result).resolves.toBe(model);
    });

    it('⭐ resolves the model instance itself, NOT a flattened dictionary', async () => {
        const model = modelDouble(tagsColorsAttrs);
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: model },
        );

        const resolved = await getProjectTagsColors(service, PROJECT_ID);

        // ⭐⭐ THE ASYMMETRY, ASSERTED -- the executable proof that these two
        // identically-shaped facades resolve structurally different kinds of value.
        //
        //   `service.stats`      (`resources/projects.coffee:43`)
        //       -> `base/repository.coffee:173-180`, ending `return data.data` at `:180`
        //       ==> PLAIN JSON. Spreadable, immer-safe. See the spread assertion above.
        //   `service.tagsColors` (`resources/projects.coffee:96`)
        //       -> `base/repository.coffee:163-171`, ending
        //          `return @model.make_model(name, data.data)` at `:171`
        //       ==> A LIVE `$tgModel` INSTANCE. Neither spreadable nor immer-safe.
        //
        // PITFALL P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns
        // model classes carrying dirty-tracking state; passing one into a draft produces
        // undefined behaviour. Convert to plain objects at the boundary."
        //
        // FLATTENING IS THE CALLER'S JOB, NOT THIS FACADE'S (rule T10 -- no unrequested
        // transformation). The facade must hand back exactly what the incumbent resolved,
        // which is what `toBe` pins here; a facade that quietly returned `getAttrs()` would
        // be more convenient and would silently change the contract, breaking the caller's
        // ability to hand the model back to the repository's write path (requirement I7).
        // The established house style at this seam is for the boundary code to flatten,
        // immediately before handing data across:
        // `components/project-menu/project-menu.controller.coffee:27` for the project and
        // `:21` for its milestones. (AAP §0.5.2 cites the first as L28; the verified locator
        // is L27 -- L28 is the closing brace.)
        expect(resolved).toBe(model);
        expect(typeof resolved.getAttrs).toBe('function');
    });

    it('keeps the model usable: getAttrs yields the dictionary with null colours intact', async () => {
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        const model = await getProjectTagsColors(service, PROJECT_ID);
        const attrs = model.getAttrs();

        // The public accessor (`model.coffee:48-54`) is the sanctioned flattening path --
        // the React equivalent of the private-field read the incumbent performs at
        // `kanban/main.coffee:370`.
        expect(attrs).toEqual(tagsColorsAttrs);
        expect(attrs.untagged).toBeNull();
        // A fresh plain merge, not the private bag itself.
        expect(attrs).not.toBe(tagsColorsAttrs);
    });

    it('keeps the rest of the model surface reachable', async () => {
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        const model = await getProjectTagsColors(service, PROJECT_ID);

        // Nothing was stripped in transit: the dirty-tracking surface survives, which is
        // what keeps the changed-fields-only write path intact (requirement I7).
        expect(model.getName()).toBe('projects');
        expect(model.isModified()).toBe(false);
        expect(model.clone().getAttrs()).toEqual(tagsColorsAttrs);
    });

    it('⭐ demonstrates pitfall P-IMMER-1: spreading the model is NOT flattening it', async () => {
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        const model = await getProjectTagsColors(service, PROJECT_ID);
        const spread: Record<string, unknown> = { ...model };

        // ⭐ THE NEGATIVE HALF OF THE MATCHED PAIR. Spreading the statistics payload above
        // reproduced it exactly; spreading THIS resolved value does not, and the assertion
        // below is the whole difference between the two facades made executable.
        //
        // A spread runs the enumerable accessors installed at `base/model.coffee:94-101`
        // (`enumerable: true` at `:98`), so it DOES read the attribute values -- and that is
        // exactly what makes the hazard dangerous rather than obvious. What comes out is not
        // the dictionary but a hybrid: the attributes, PLUS the private bookkeeping fields,
        // MINUS every prototype method. It has the right values in it and is still the wrong
        // object.
        expect(spread).not.toEqual(tagsColorsAttrs);
        // The private bookkeeping leaks in -- fields no tag-colour consumer should ever see,
        // and which immer would happily draft and freeze as if they were data.
        expect(spread._attrs).toBeDefined();
        expect(spread._modifiedAttrs).toBeDefined();
        expect(Object.keys(spread)).toEqual(expect.arrayContaining(['_attrs', '_name']));
        // The behaviour goes missing -- so the value can no longer be handed back to the
        // repository's write path, which is what preserves changed-fields-only PATCH
        // semantics (requirement I7).
        expect(spread.getAttrs).toBeUndefined();
        expect(spread.isModified).toBeUndefined();
        expect(Object.keys(spread)).not.toEqual(Object.keys(tagsColorsAttrs));

        // `getAttrs()` is the correct path and yields exactly the dictionary, with no
        // private field in sight -- which is why the facade documents it and why immer must
        // never be handed the instance (a class instance is not draftable, so mutations to
        // one escape the draft instead of being recorded, and with `autoFreeze` left on --
        // P-IMMER-4 -- freezing a structure AngularJS still holds is its own hazard).
        expect(model.getAttrs()).toEqual(tagsColorsAttrs);
        expect('_attrs' in model.getAttrs()).toBe(false);
        expect('_modifiedAttrs' in model.getAttrs()).toBe(false);
        // And the sanctioned path is a strict improvement on the spread in both directions:
        // exactly the tag names, and nothing else.
        expect(Object.keys(model.getAttrs()).sort()).toEqual(
            Object.keys(tagsColorsAttrs).sort(),
        );
    });

    it('treats every colour as opaque DATA: no validation, no normalisation, no default', async () => {
        // Rule T2, verbatim: "All status, tag, and epic colours remain data-bound. They come
        // from `s.color`, `tag[1]`, and `epic.color`; the values visible in the Figma frames
        // are `sample_data` artefacts and must never be hardcoded."
        //
        // The facade's job is therefore to be INCURIOUS about colour. These fixtures are
        // deliberately not well-formed CSS colours, and one is empty and one is absent
        // entirely: whatever the project database holds is what must arrive. A facade that
        // validated the format, upper-cased the digits, expanded a shorthand or filled a
        // missing colour with a palette default would be inventing design decisions the
        // stylesheets already own (rules T2 and T10, AAP §0.3.6 drift entry D3).
        //
        // No real colour value appears anywhere in this file, in code or in a comment --
        // including none of the per-status values visible in the two Figma frames, which are
        // seeded sample data and would break every real project if they were ever hardcoded.
        const awkwardColours = {
            'tag-with-token': 'fixture-colour-token-c',
            'tag-with-mixed-case': 'FixtureColourTokenD',
            'tag-with-whitespace': '  fixture-colour-token-e  ',
            'tag-with-empty-colour': '',
            'tag-with-no-colour': null,
        };
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(awkwardColours) },
        );

        const attrs = (await getProjectTagsColors(service, PROJECT_ID)).getAttrs();

        expect(attrs).toEqual(awkwardColours);
        // Preserved character for character: not trimmed, not re-cased, not parsed.
        expect(attrs['tag-with-mixed-case']).toBe('FixtureColourTokenD');
        expect(attrs['tag-with-whitespace']).toBe('  fixture-colour-token-e  ');
        // An empty colour stays an empty string and is NOT promoted to null...
        expect(attrs['tag-with-empty-colour']).toBe('');
        // ...and a null colour stays null and is NOT demoted to an empty string. The
        // incumbent tag-creation path establishes null as a legitimate value by defaulting
        // to it (`resources/projects.coffee:102-109`).
        expect(attrs['tag-with-no-colour']).toBeNull();
        // Tag names are data too: dictionary keys arrive exactly as stored, none dropped.
        expect(Object.keys(attrs).sort()).toEqual(Object.keys(awkwardColours).sort());
    });

    it('rejects with the incumbent rejection value untouched', async () => {
        const rejection = { status: 451, data: { _error_message: 'blocked' } };
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'reject', reason: rejection },
        );

        await expect(getProjectTagsColors(service, PROJECT_ID)).rejects.toBe(rejection);
    });

    it('delegates on every call, so no cache was introduced', async () => {
        const { service, log } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        await getProjectTagsColors(service, PROJECT_ID);
        await getProjectTagsColors(service, 7);

        expect(log.tagsColors).toEqual([[PROJECT_ID], [7]]);
    });

    it('stays pending when the source never settles, so no timeout was introduced', async () => {
        const { service } = projectsDouble({ kind: 'pending' }, { kind: 'pending' });
        const pendingSentinel = 'still-pending';

        const winner = await Promise.race([
            getProjectTagsColors(service, PROJECT_ID).then(() => 'settled'),
            Promise.resolve(pendingSentinel),
        ]);

        expect(winner).toBe(pendingSentinel);
    });
});

/* ==========================================================================
 * MODULE SURFACE
 * ========================================================================== */

describe('the projects facade module surface', () => {
    it('exports exactly the two faced reads and nothing else', async () => {
        const facade: Record<string, unknown> = await import('./projects');
        const exported = Object.keys(facade)
            .filter((key) => key !== '__esModule')
            .sort();

        // Only two of the incumbent service's members are reachable from either in-scope
        // screen, so only two are faced. The remaining members belong to the admin,
        // project-profile, import-export, timeline and discover screens, all placed out of
        // scope by AAP §0.2.2 -- adding one would violate the Minimal Change Clause.
        expect(exported).toEqual(['getProjectStats', 'getProjectTagsColors']);
    });

    it('has not grown a facade for an out-of-scope service member', async () => {
        const facade: Record<string, unknown> = await import('./projects');

        // ⭐ THE PERMANENT SCOPE-CREEP GUARD, and the reason it names members explicitly
        // rather than relying on the exact-equality assertion above: a name that is spelled
        // out here fails LOUDLY and self-describingly the day someone adds it, and the
        // failure message says which out-of-scope screen it belongs to.
        //
        // The incumbent service declares 28 members
        // (`resources/projects.coffee:16-221`). Exactly two are read by the Kanban or
        // Backlog screen. Every name below is a real member of the incumbent surface --
        // verified, not invented -- and every one belongs to a screen AAP §0.2.2 places out
        // of scope: "Every `taiga-front` screen other than Kanban and Backlog: epics,
        // issues, wiki, admin, auth, user profile, search, team, discover, project home,
        // taskboard".
        const outOfScopeMembers = [
            // Admin tag administration -- `:122`.
            'mixTags',
            // Import/export -- `:126` and `:130-198`. The second is also the raw-upload
            // non-precedent described in the file header: never to be replicated (rule T5).
            'export',
            'import',
            // Project profile branding -- `:200` and `:221`.
            'changeLogo',
            'removeLogo',
            // Project ordering, the `bulk-update-projects-order` endpoint of AAP §0.7.5 --
            // `:45`, resolving the registry entry at `resources.coffee:63`. Note the two
            // bulk-ordering endpoints the Kanban and Backlog screens DO use are user-story
            // ordering and live on the `userstories` namespace, not this one.
            'bulkUpdateOrder',
            'bulkUpdateProjectsOrder',
            // CSV export uuid administration -- `:49-86`, eight members in total.
            'regenerate_epics_csv_uuid',
            'regenerate_userstories_csv_uuid',
            'regenerate_tasks_csv_uuid',
            'regenerate_issues_csv_uuid',
            // Admin membership and swimlane administration -- `:88`, `:92`, `:77`.
            'leave',
            'memberStats',
            'patch_default_swimlane',
            // Admin tag editing -- `:98`, `:102`, `:111`.
            'deleteTag',
            'createTag',
            'editTag',
            // Project listing and lookup, used by discover and project home -- `:16-40`.
            'get',
            'getBySlug',
            'list',
            'listByMember',
            'templates',
            'usersList',
            'rolesList',
            // Neighbouring out-of-scope surfaces, named because they are the ones most
            // likely to be reached for next: the profile/project timeline reads, and the
            // project-transfer family, which lives on the sibling project-resource service
            // (`app/modules/resources/projects-resource.service.coffee:147-174`) rather than
            // on this namespace at all.
            'getTimeline',
            'transferStart',
            'transferValidateToken',
            'transferAccept',
            'transferReject',
        ];

        for (const member of outOfScopeMembers) {
            expect(facade[member]).toBeUndefined();
            expect(member in facade).toBe(false);
        }

        // Nor a barrel, a default export, a shared client object or a config hook: there is
        // no second place for surface to accumulate in this folder.
        expect(facade.default).toBeUndefined();
        expect(Object.keys(facade).filter((key) => key !== '__esModule')).toHaveLength(2);
    });

    it('exposes both reads as plain two-parameter functions, not hooks', () => {
        // Service first, id second: the calling hook owns the single injector lookup and
        // passes the sub-resource in, which is what makes this module testable with no
        // React renderer and no provider (requirement I9).
        expect(typeof getProjectStats).toBe('function');
        expect(typeof getProjectTagsColors).toBe('function');
        expect(getProjectStats).toHaveLength(2);
        expect(getProjectTagsColors).toHaveLength(2);
    });
});
