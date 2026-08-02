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
 * The real model is a CoffeeScript class (`app/coffee/modules/base/model.coffee:9-127`), so
 * its members live on a PROTOTYPE and are therefore NOT copied by a spread. A literal would
 * put them on the instance as own enumerable properties, quietly making the P-IMMER-1
 * pitfall assertion below pass for the wrong reason and, worse, making a spread look
 * survivable when against the real class it is not.
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
     * plus the milestone total read at `app/coffee/modules/backlog/main.coffee:266`.
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
    });

    it('rejects with the incumbent rejection value untouched', async () => {
        // Shaped like a real interceptor rejection: the chain communicates failure through
        // rejection VALUES carrying status and body, which is how a version conflict, a
        // blocked project or connection loss reaches the screen at all.
        const rejection = { status: 400, data: { version: 3 } };
        const { service } = projectsDouble(
            { kind: 'reject', reason: rejection },
            { kind: 'pending' },
        );

        // Identity again: re-wrapping or normalising the reason would hide the very
        // conditions the interceptor chain exists to surface.
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
     * (`app/coffee/modules/resources/projects.coffee:102-109`).
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

        // THE ASYMMETRY, asserted. `queryOne` wraps the body with `make_model`
        // (`repository.coffee:171`), and the facade forwards that wrapper untouched:
        // flattening is the caller's job (T10).
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

        // A spread invokes the enumerable accessors installed at `model.coffee:94-101`, so
        // it does pick the attribute values up -- but it also drags the private bookkeeping
        // along and drops the methods, producing a broken hybrid that looks plausible.
        expect(spread._attrs).toBeDefined();
        expect(spread._modifiedAttrs).toBeDefined();
        expect(spread.getAttrs).toBeUndefined();
        expect(Object.keys(spread)).not.toEqual(Object.keys(tagsColorsAttrs));

        // `getAttrs()` is the correct path and yields exactly the dictionary, with no
        // private field in sight -- which is why the facade documents it and why immer must
        // never be handed the instance (a class instance is not draftable).
        expect(model.getAttrs()).toEqual(tagsColorsAttrs);
        expect('_attrs' in model.getAttrs()).toBe(false);
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
