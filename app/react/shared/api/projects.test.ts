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

import { getProjectStats, getProjectTagsColors, toProjectStats } from './projects';
// TYPE-ONLY AND TEST-ONLY, and the direction matters. Production code under
// `shared/api/**` must never import a screen's state module -- transport does not depend on
// domain state, and the facade therefore describes the statistics payload structurally
// instead. The reconciliation spec below imports the canonical type to PROVE the two
// structural descriptions still agree, which is a property only a test can assert.
import type { ProjectStats } from '../../backlog/state/types';
import type {
    AngularPromise,
    ProjectsResource,
    TaigaModel,
} from '../../bridge/useAngularService';

const PROJECT_ID = 42;

function asPayload<T>(value: unknown): T {
    return value as T;
}

type Outcome =
    | { readonly kind: 'fulfil'; readonly value: unknown }
    | { readonly kind: 'reject'; readonly reason: unknown }
    | { readonly kind: 'pending' };

function thenableFor<T>(outcome: Outcome): AngularPromise<T> {
    return {
        then(onFulfilled, onRejected) {
            if (outcome.kind === 'fulfil') {
                return onFulfilled(asPayload<T>(outcome.value));
            }

            if (outcome.kind === 'reject') {
                return onRejected(outcome.reason);
            }

            return undefined;
        },
    };
}

interface CallLog {
    readonly stats: number[][];
    readonly tagsColors: number[][];
}

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

class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    public _attrs: TAttrs;

    public _name = 'projects';

    public _modifiedAttrs: Record<string, unknown> = {};

    public _isModified = false;

    public constructor(attrs: TAttrs) {
        this._attrs = { ...attrs };

        const bagByKey: Record<string, unknown> = asPayload<Record<string, unknown>>(
            this._attrs,
        );
        const modified = this._modifiedAttrs;

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

    public getAttrs(patch?: boolean): TAttrs {
        if (patch === true) {
            return asPayload<TAttrs>({ ...this._modifiedAttrs });
        }

        return asPayload<TAttrs>({ ...this._attrs, ...this._modifiedAttrs });
    }

    public setAttr(name: string, value: unknown): void {
        this._modifiedAttrs[name] = value;
        this._isModified = true;
    }

    public isModified(): boolean {
        return this._isModified;
    }

    public getName(): string {
        return this._name;
    }

    public clone(): TaigaModel<TAttrs> {
        return new ModelDouble<TAttrs>(this._attrs);
    }
}

function modelDouble<TAttrs extends object>(attrs: TAttrs): TaigaModel<TAttrs> {
    return new ModelDouble<TAttrs>(attrs);
}

describe('getProjectStats', () => {
    const statsPayload = {
        assigned_points: 101.5,
        total_points: 392,
        defined_points: 392.5,
        closed_points: 21,
        speed: 0,
        total_milestones: 5,
        milestones: [
            {
                name: 'Sprint 2026-6-8',
                optimal: 392,
                evolution: 392,
                'team-increment': 0,
                'client-increment': 0,
            },
            {
                name: 'Sprint 2026-6-22',
                optimal: 326.7,
                evolution: 371,
                'team-increment': 0,
                'client-increment': 0,
            },
            {
                name: 'Sprint 2026-7-6',
                optimal: 261.3,
                evolution: null,
                'team-increment': 12,
                'client-increment': 5,
            },
            {
                name: 'Sprint 2026-7-20',
                optimal: 196,
                evolution: null,
                'team-increment': 0,
                'client-increment': 0,
            },
            {
                name: 'Sprint 2026-8-3',
                optimal: 130.7,
                evolution: null,
                'team-increment': 0,
                'client-increment': 0,
            },
            {
                name: 'Sprint 2026-8-17',
                optimal: 0.00000000001,
                evolution: null,
                'team-increment': 0,
                'client-increment': 0,
            },
        ],
    };

    it('forwards the project id unchanged as the only argument', async () => {
        const { service, log } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        await getProjectStats(service, PROJECT_ID);

        expect(log.stats).toEqual([[PROJECT_ID]]);
    });

    it('does not touch the sibling tag-colour read', async () => {
        const { service, log } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        await getProjectStats(service, PROJECT_ID);

        expect(log.tagsColors).toEqual([]);
    });

    it('returns a native promise rather than the AngularJS thenable it was given', () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const result = getProjectStats(service, PROJECT_ID);

        expect(result).toBeInstanceOf(Promise);

        return expect(result).resolves.toBe(statsPayload);
    });

    it('resolves the parsed body with its identity intact -- no copy, no wrapper', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(stats).toBe(statsPayload);
    });

    it('⭐ resolves a PLAIN, SPREADABLE object -- the immer-safe half of the asymmetry', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const spread: Record<string, unknown> = { ...(await getProjectStats(service, PROJECT_ID)) };

        expect(spread).toEqual(statsPayload);
        expect(Object.keys(spread).some((key) => key.startsWith('_'))).toBe(false);
        expect(spread).not.toBe(statsPayload);
    });

    it('surfaces every field name verbatim, mixed conventions included', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(Object.keys(stats).sort()).toEqual([
            'assigned_points',
            'closed_points',
            'defined_points',
            'milestones',
            'speed',
            'total_milestones',
            'total_points',
        ]);
        expect(stats.assigned_points).toBe(101.5);
        expect(stats.total_points).toBe(392);
        expect(stats.defined_points).toBe(392.5);
        expect(stats.closed_points).toBe(21);
        expect(stats.speed).toBe(0);
        expect(stats.total_milestones).toBe(5);
        // The series arrives BY IDENTITY and in order: the chart pairs each entry with its
        // index (`backlog/main.coffee:1221`, `:1273`), so a reordering or a copy would both
        // be transformations the facade must not make.
        expect(stats.milestones).toBe(statsPayload.milestones);
        expect(stats.milestones.map((milestone) => milestone.name)).toEqual(
            statsPayload.milestones.map((milestone) => milestone.name),
        );
    });

    it('forwards the payload untransformed, mixed conventions and all', async () => {
        // Asserted as a whole rather than field by field, because the property under test is
        // that the payload arrives as ONE UNTOUCHED OBJECT.
        //
        // ⚠ NOTHING IS TIDIED, and that is the point. Normalising the snake_case casing,
        // renaming a field, rounding a non-integer total, or coercing `speed: 0` into a
        // default would each be a response transformation (rule T10) and would break the
        // frozen backend contract (goal G2). `toEqual` against the fixture is what makes
        // every one of those a failing test rather than a silent change.
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        expect(stats).toEqual(statsPayload);
        // A non-integer total survives as a non-integer: nothing is rounded or truncated.
        expect(stats.defined_points).toBe(392.5);
        // Zero is preserved as zero, not replaced by a fallback and not dropped as falsy.
        expect(stats.speed).toBe(0);
        expect(Object.keys(stats)).toHaveLength(7);
    });

    it('reconciles with the screen canonical state by deriving the one client-side field', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const raw = await getProjectStats(service, PROJECT_ID);

        // ⭐ THE POINT OF THIS TEST IS THAT IT COMPILES. `ProjectStats` is the canonical
        // eight-member state type owned by the Backlog screen, and the facade's response type is
        // deliberately one member short of it: `completedPercentage` is derived on the client,
        // never sent. So the hand-off is a DERIVE-AND-SPREAD, with no assertion, no double cast
        // and no transformation of the seven wire fields -- and it type-checks only because the
        // response is modelled completely and with the same nullability the canonical type
        // declares. Asserting it here is what stops the two structural descriptions drifting
        // apart unnoticed.
        const totalPoints = raw.total_points ? raw.total_points : raw.defined_points;
        const stats: ProjectStats = {
            ...raw,
            completedPercentage: totalPoints
                ? Math.round((100 * raw.closed_points) / totalPoints)
                : 0,
        };

        // The incumbent arithmetic reproduced exactly: 21 of 392 rounds to 5, the value the
        // summary bar renders in the design frame.
        expect(stats.completedPercentage).toBe(5);
        expect(stats.assigned_points).toBe(101.5);
        expect(stats.milestones).toBe(raw.milestones);
        // Every wire field crosses untouched; only the derived member is added.
        expect(Object.keys(stats)).toHaveLength(Object.keys(raw).length + 1);
    });

    it('leaves the client-derived completion percentage absent', async () => {
        const { service } = projectsDouble(
            { kind: 'fulfil', value: statsPayload },
            { kind: 'pending' },
        );

        const stats = await getProjectStats(service, PROJECT_ID);

        // The READ adds no default and computes nothing (T10): the percentage is not a wire
        // field, and this facade does not invent one. Supplying it is `toProjectStats`'s job
        // and is asserted separately below -- keeping the two apart is what stops a consumer
        // from believing a raw response already carries it.
        //
        // Read through a plain-record view rather than off the typed value, because the wire
        // type NO LONGER DECLARES the member at all: its absence is now a compile-time fact
        // as well as a runtime one, and `stats.completedPercentage` would not compile.
        const asRecord: Record<string, unknown> = { ...stats };

        expect('completedPercentage' in asRecord).toBe(false);
        expect(asRecord.completedPercentage).toBeUndefined();
    });

    it('passes empty nullable totals through as null instead of substituting a zero', async () => {
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
        expect(stats.total_points).not.toBe(0);
        expect(stats.defined_points).not.toBeUndefined();
    });

    it('coerces nothing, even where the wire disagrees with the declared shape', async () => {
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
        expect(stats).toEqual(emptyTotals);
    });

    it('rejects with the incumbent rejection value untouched', async () => {
        const rejection = { status: 400, data: { version: 3 } };
        const { service } = projectsDouble(
            { kind: 'reject', reason: rejection },
            { kind: 'pending' },
        );

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

        expect(log.stats).toEqual([[PROJECT_ID], [PROJECT_ID], [7]]);
    });

    it('stays pending when the source never settles, so no timeout was introduced', async () => {
        const { service } = projectsDouble({ kind: 'pending' }, { kind: 'pending' });
        const pendingSentinel = 'still-pending';

        const winner = await Promise.race([
            getProjectStats(service, PROJECT_ID).then(() => 'settled'),
            Promise.resolve(pendingSentinel),
        ]);

        expect(winner).toBe(pendingSentinel);
    });
});

/* ==========================================================================
 * toProjectStats -- THE ONE DERIVED MEMBER
 *
 * The adapter closes the gap between the wire shape and the canonical
 * `ProjectStats` the Backlog screen consumes. Exactly one member is derived, and
 * these specs hold the derivation to `app/coffee/modules/backlog/main.coffee:259`
 * -`:264` arithmetic-for-arithmetic -- including the two details that are easy to
 * "improve" into a behaviour change: the fallback is TRUTHY rather than nullish,
 * and the guarded zero case yields 0 rather than NaN.
 * ========================================================================== */

describe('toProjectStats', () => {
    /** The minimum well-formed wire response, parameterised on the point totals. */
    function wireResponse(totals: {
        readonly total_points: number | null;
        readonly defined_points: number;
        readonly closed_points: number;
    }): Parameters<typeof toProjectStats>[0] {
        return {
            assigned_points: 101.5,
            speed: 0,
            total_milestones: 5,
            milestones: [],
            ...totals,
        };
    }

    it('derives the percentage from the project total when it is truthy', () => {
        // `:259` prefers `total_points`; `:262` is `Math.round(100 * closed / total)`.
        // 100 * 21 / 392 = 5.357…, which rounds to 5 -- the value the summary bar shows for
        // the first seeded project.
        const stats = toProjectStats(
            wireResponse({ total_points: 392, defined_points: 392.5, closed_points: 21 }),
        );

        expect(stats.completedPercentage).toBe(5);
    });

    it('falls back to the defined total when the project total is null', () => {
        // 100 * 21 / 392.5 = 5.35…, still 5 -- so the fallback is asserted with a SECOND
        // case below where the two totals give different answers, rather than only here.
        const stats = toProjectStats(
            wireResponse({ total_points: null, defined_points: 392.5, closed_points: 21 }),
        );

        expect(stats.completedPercentage).toBe(5);
    });

    it('uses the defined total, not the project total, when it falls back', () => {
        // Chosen so the two denominators disagree: 50/100 is 50%, 50/200 is 25%. A fallback
        // that silently kept reading `total_points` would report 25 here.
        const stats = toProjectStats(
            wireResponse({ total_points: null, defined_points: 100, closed_points: 50 }),
        );

        expect(stats.completedPercentage).toBe(50);
    });

    it('⭐ treats a project total of ZERO as absent, exactly as the incumbent does', () => {
        // THE TRUTHY-VERSUS-NULLISH DISTINCTION, and the reason this spec is starred.
        // `:259` is a CoffeeScript `if/else` on the bare value, so `0` falls through to the
        // defined total. A nullish fallback (`??`) or a `!= null` test would keep the zero,
        // divide by it, and produce Infinity -- which would render as "Infinity%" in the
        // summary bar rather than failing anywhere a test could see it.
        const stats = toProjectStats(
            wireResponse({ total_points: 0, defined_points: 200, closed_points: 50 }),
        );

        expect(stats.completedPercentage).toBe(25);
        expect(Number.isFinite(stats.completedPercentage)).toBe(true);
    });

    it.each([
        ['both totals zero', { total_points: 0, defined_points: 0, closed_points: 0 }],
        ['project total null and defined zero', {
            total_points: null,
            defined_points: 0,
            closed_points: 0,
        }],
        ['a closed count against no total', {
            total_points: 0,
            defined_points: 0,
            closed_points: 7,
        }],
    ])('yields 0 rather than NaN or Infinity when there is no denominator (%s)', (_label, totals) => {
        // `:264`. A brand-new project has no points at all, so this is the ordinary case
        // rather than an edge case, and an unguarded division would put NaN or Infinity
        // straight into the summary bar and the progress fill.
        const stats = toProjectStats(wireResponse(totals));

        expect(stats.completedPercentage).toBe(0);
    });

    it('ROUNDS, and rounds half up, exactly as Math.round does', () => {
        // 100 * 1 / 8 = 12.5 -> 13. `Math.floor` would give 12 and a fixed-decimal string
        // would give '12.50'; both are visible on screen, because the value is rendered as a
        // percentage at `summary.jade:12` and drives the bar's fill at `:9`.
        const stats = toProjectStats(
            wireResponse({ total_points: 8, defined_points: 8, closed_points: 1 }),
        );

        expect(stats.completedPercentage).toBe(13);
    });

    it('forwards every other member untouched, nulls included', () => {
        const response = {
            assigned_points: 101.5,
            total_points: null,
            defined_points: 392.5,
            closed_points: 21,
            speed: 0,
            total_milestones: null,
            milestones: [
                {
                    name: 'Sprint 2026-6-8',
                    optimal: 392,
                    evolution: null,
                    'team-increment': 0,
                    'client-increment': 0,
                },
            ],
        };

        const stats = toProjectStats(response);

        expect(stats.assigned_points).toBe(101.5);
        expect(stats.defined_points).toBe(392.5);
        expect(stats.closed_points).toBe(21);
        expect(stats.speed).toBe(0);
        // Nulls are FORWARDED, not defaulted: the screen's own existential guard at
        // `backlog/main.coffee:266` depends on being able to tell "unknown" from "none".
        expect(stats.total_points).toBeNull();
        expect(stats.total_milestones).toBeNull();
        // The series crosses by identity and is not copied, so the chart's index pairing is
        // untouched.
        expect(stats.milestones).toBe(response.milestones);
    });

    it('produces the canonical shape: eight members, no more and no fewer', () => {
        const stats = toProjectStats(
            wireResponse({ total_points: 392, defined_points: 392.5, closed_points: 21 }),
        );

        // The seven wire members plus the one derived member. The compiler already proves
        // completeness -- the declared return type is the canonical interface and there is no
        // cast anywhere in the adapter -- so this asserts the other direction: that nothing
        // EXTRA was added, which a type annotation on a return value does not catch.
        expect(Object.keys(stats).sort()).toEqual([
            'assigned_points',
            'closed_points',
            'completedPercentage',
            'defined_points',
            'milestones',
            'speed',
            'total_milestones',
            'total_points',
        ]);
    });

    it('DOES NOT MUTATE the response, unlike the incumbent it reproduces', () => {
        // `backlog/main.coffee:262` assigns the percentage straight onto the resolved
        // response. React cannot: the object is shared, readonly, and bound for an
        // immer-managed store whose `autoFreeze` would reject the write (P-IMMER-4). So the
        // arithmetic is identical and the mutation is gone -- and this asserts the second
        // half, which is the part a reader would otherwise have to take on trust.
        const response = wireResponse({
            total_points: 392,
            defined_points: 392.5,
            closed_points: 21,
        });
        const before = JSON.stringify(response);

        const stats = toProjectStats(response);

        expect(JSON.stringify(response)).toBe(before);
        expect('completedPercentage' in response).toBe(false);
        expect(stats).not.toBe(response);
    });

    it('is pure: the same response yields equal results and touches nothing', () => {
        const response = wireResponse({
            total_points: 392,
            defined_points: 392.5,
            closed_points: 21,
        });

        expect(toProjectStats(response)).toEqual(toProjectStats(response));
        // A fresh object each time, so two consumers cannot share and freeze one another's.
        expect(toProjectStats(response)).not.toBe(toProjectStats(response));
    });
});

/* ==========================================================================
 * getProjectTagsColors -- the `$tgModel` half of the asymmetry
 * ========================================================================== */

describe('getProjectTagsColors', () => {
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

        expect(attrs).toEqual(tagsColorsAttrs);
        expect(attrs.untagged).toBeNull();
        expect(attrs).not.toBe(tagsColorsAttrs);
    });

    it('keeps the rest of the model surface reachable', async () => {
        const { service } = projectsDouble(
            { kind: 'pending' },
            { kind: 'fulfil', value: modelDouble(tagsColorsAttrs) },
        );

        const model = await getProjectTagsColors(service, PROJECT_ID);

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

        expect(spread).not.toEqual(tagsColorsAttrs);
        expect(spread._attrs).toBeDefined();
        expect(spread._modifiedAttrs).toBeDefined();
        expect(Object.keys(spread)).toEqual(expect.arrayContaining(['_attrs', '_name']));
        expect(spread.getAttrs).toBeUndefined();
        expect(spread.isModified).toBeUndefined();
        expect(Object.keys(spread)).not.toEqual(Object.keys(tagsColorsAttrs));

        expect(model.getAttrs()).toEqual(tagsColorsAttrs);
        expect('_attrs' in model.getAttrs()).toBe(false);
        expect('_modifiedAttrs' in model.getAttrs()).toBe(false);
        expect(Object.keys(model.getAttrs()).sort()).toEqual(
            Object.keys(tagsColorsAttrs).sort(),
        );
    });

    it('treats every colour as opaque DATA: no validation, no normalisation, no default', async () => {
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
        expect(attrs['tag-with-mixed-case']).toBe('FixtureColourTokenD');
        expect(attrs['tag-with-whitespace']).toBe('  fixture-colour-token-e  ');
        expect(attrs['tag-with-empty-colour']).toBe('');
        expect(attrs['tag-with-no-colour']).toBeNull();
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

describe('the projects facade module surface', () => {
    it('exports exactly the two faced reads and nothing else', async () => {
        const facade: Record<string, unknown> = await import('./projects');
        const exported = Object.keys(facade)
            .filter((key) => key !== '__esModule')
            .sort();

        // Only two of the incumbent service's members are reachable from either in-scope
        // screen, so only two are FACED. The remaining members belong to the admin,
        // project-profile, import-export, timeline and discover screens, all placed out of
        // scope by AAP §0.2.2 -- adding one would violate the Minimal Change Clause.
        //
        // `toProjectStats` is the third export and is NOT a faced read: it performs no I/O,
        // touches no service and reaches no endpoint. It is the pure adapter that supplies
        // the one member of the canonical `ProjectStats` contract the server does not send,
        // and it lives here because this is the module that owns the wire shape. Counting it
        // among the reads would be the mistake; leaving it out of this assertion would let
        // an actual fourth export slip in unnoticed.
        expect(exported).toEqual(['getProjectStats', 'getProjectTagsColors', 'toProjectStats']);
    });

    it('has not grown a facade for an out-of-scope service member', async () => {
        const facade: Record<string, unknown> = await import('./projects');

        const outOfScopeMembers = [
            'mixTags',
            'export',
            'import',
            'changeLogo',
            'removeLogo',
            'bulkUpdateOrder',
            'bulkUpdateProjectsOrder',
            'regenerate_epics_csv_uuid',
            'regenerate_userstories_csv_uuid',
            'regenerate_tasks_csv_uuid',
            'regenerate_issues_csv_uuid',
            'leave',
            'memberStats',
            'patch_default_swimlane',
            'deleteTag',
            'createTag',
            'editTag',
            'get',
            'getBySlug',
            'list',
            'listByMember',
            'templates',
            'usersList',
            'rolesList',
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

        expect(facade.default).toBeUndefined();
        expect(Object.keys(facade).filter((key) => key !== '__esModule')).toHaveLength(3);
    });

    it('exposes both reads as plain two-parameter functions, not hooks', () => {
        expect(typeof getProjectStats).toBe('function');
        expect(typeof getProjectTagsColors).toBe('function');
        expect(getProjectStats).toHaveLength(2);
        expect(getProjectTagsColors).toHaveLength(2);
    });

    it('exposes the adapter as a plain one-parameter function that needs no service', () => {
        // One parameter, and it is the response -- not a service, not an id, not a hook. That
        // signature is what lets the derivation be asserted directly, with no promise, no
        // injector double and no renderer.
        expect(typeof toProjectStats).toBe('function');
        expect(toProjectStats).toHaveLength(1);
    });
});
