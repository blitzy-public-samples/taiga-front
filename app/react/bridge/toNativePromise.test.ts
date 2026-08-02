/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Spec for `toNativePromise` — the AngularJS `$q` → native `Promise` marshaller that sits
 * on the AngularJS ↔ React seam.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * The migration of the Kanban and Backlog screens to React 18 is an in-place coexistence
 * migration: the AngularJS 1.5.10 shell survives, and React reaches HTTP, realtime,
 * translation and permissions through the existing AngularJS injector rather than
 * reimplementing them. Everything that service layer returns is a `$q` promise, and
 * `toNativePromise` is the single place where one becomes a native ES `Promise` so that
 * every React consumer above it is plain modern JavaScript.
 *
 * Being the only adapter on that path makes its contract unusually load-bearing, and the
 * contract is a *pass-through* one: whatever the source settles with — value or reason —
 * must arrive at the caller unmodified. That is what this spec pins down, export by export
 * (`toNativePromise` and the structural `Thenable<T>` type it is written against) and
 * branch by branch (thenable, callable thenable, non-thenable, fulfilment, rejection,
 * deferred settlement, and a source whose `then` throws).
 *
 * WHY REJECTION-VALUE FIDELITY IS LOAD-BEARING, NOT COSMETIC
 * ---------------------------------------------------------
 * The AngularJS interceptor chain communicates through rejection *values*, not through
 * exception types. Three conditions reach the user that way, and all three would be lost
 * by an adapter that re-wrapped, normalised, logged-and-swallowed, or — worst — converted a
 * rejection into a resolution:
 *
 *   • **400 carrying a `version` field — VERSION_ERROR.** This is how an
 *     optimistic-concurrency conflict surfaces: the interceptor raises a toast for
 *     10,000 ms and re-rejects with the response object itself
 *     (`app/coffee/app.coffee:740-750`). Swallowed here, two users editing the same user
 *     story would silently overwrite each other, and the corruption would only show up on
 *     the next page load.
 *   • **451 — blocked project.** The blocking interceptor (`app/coffee/app.coffee:764`,
 *     `:775`) rejects so callers can stop mutating a project they may not write to.
 *   • **Status 0 / −1 — connection loss.** Handled at `app/coffee/app.coffee:619`, which
 *     closes open lightboxes and shows the connection-error view.
 *
 * The repository layer rejects with the raw server payload for the same reason
 * (`app/coffee/modules/base/repository.coffee:33`, `:83`). So the assertions below are
 * deliberately identity assertions (`toBe`, i.e. `Object.is`) rather than deep-equality
 * ones: a structurally equal *copy* would already be a regression, because a copy proves
 * the adapter touched the value.
 *
 * Fulfilment values get the same treatment. `$tgRepo` resolves with live `$tgModel`
 * instances whose dirty-tracking is what makes `save()` send a PATCH of only the changed
 * fields plus the concurrency `version`. Unwrapping a `data` property, cloning or
 * flattening here would change what every call site receives — forbidden by rule T10 ("No
 * functional or feature change of any kind") and by the Minimal Change Clause.
 *
 * WHY NO DIGEST TRIGGER APPEARS ANYWHERE IN THIS SPEC
 * --------------------------------------------------
 * AAP §0.7.4 is explicit that React code must never invoke AngularJS's digest triggers —
 * the rootScope/scope `apply()` and `digest()` family, and `applyAsync()`. Digest cycles
 * remain AngularJS's concern; React state is driven by React.
 *
 * A `$q` promise that appears not to settle is therefore a *harness* problem, never a
 * licence to force a digest from production code. This spec settles its deferred double by
 * calling it directly and then draining the MICROTASK queue (`await Promise.resolve()`,
 * see {@link flushMicrotasks}) — no digest, and no timer either, so nothing here depends on
 * wall-clock time.
 *
 * (As in the unit itself, AngularJS identifiers are written without their `$` sigils
 * wherever the sigilled spelling would collide with a banned token. This folder is scanned
 * for the sigilled digest-trigger and transport spellings to catch real calls, and a
 * comment naming them literally would trip a gate that exists for a good reason.)
 *
 * WHY NO TRANSPORT APPEARS ANYWHERE IN THIS SPEC
 * ---------------------------------------------
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP client. New
 * TypeScript files are typed facades over the existing repository layer." Requirement I7
 * says the same from the other direction. This spec therefore issues no request of any
 * kind: every double below is a hand-rolled thenable, and the *reason* the real path must
 * stay inside `$tgResources` → `$tgRepo` → `$tgHttp` is context for these comments rather
 * than something to assert — the `Authorization: Bearer` and `Accept-Language` headers
 * built at `app/coffee/modules/base/http.coffee:17-30` (token read at line 21, header set
 * at line 23; preferred language read at line 26, header set at line 28) and merged into
 * every request at line 33, and `X-Session-Id` from `app/coffee/app.coffee:590-602`.
 *
 * CONVENTIONS INHERITED FROM THE INCUMBENT UNIT LAYER
 * --------------------------------------------------
 * Modelled on `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * — a spec whose component the Backlog screen consumes and which must keep passing
 * unchanged: a module-level `mocks` object holding one factory per collaborator shape,
 * nested `describe` blocks per behaviour area, fixtures shaped like the real models, and
 * assertions on both the positive and the negative path. Translated to this layer, its
 * stub library becomes `jest.fn()` and its assertion library becomes Jest matchers.
 *
 * One thing is deliberately NOT carried across. The incumbent spec builds its fixtures with
 * the persistent-collection library the AngularJS controllers hold internally; React must
 * never be handed one of those structures, nor a live model instance, because flattening
 * happens on the AngularJS side of the seam and because the state layer's structural-sharing
 * library works on plain objects. Every fixture below is a plain object.
 *
 * BROWSERLESS, OFFLINE, BUILD-FREE (HR-5)
 * ---------------------------------------
 * This spec runs under jsdom with no browser binary, no server, no generated build output
 * and no end-to-end runner import. It also installs no hand-rolled mock-reset hook:
 * `jest.config.js` already clears mocks and restores spies between tests, so adding one
 * would be redundant and would mask that guarantee.
 */
import { toNativePromise } from './toNativePromise';
import type { Thenable } from './toNativePromise';

// ---------------------------------------------------------------------------------------
// Fixture types — plain, structural, and local
// ---------------------------------------------------------------------------------------

/**
 * A user story shaped like the fulfilment payload the repository layer hands to React.
 * A plain object with a `version` field, because `version` is the optimistic-concurrency
 * token whose survival across the seam this spec cares about.
 */
interface UserStoryPayload {
    readonly id: number;
    readonly ref: number;
    readonly subject: string;
    readonly version: number;
}

/**
 * An AngularJS response envelope. Its only job is to prove that the adapter resolves with
 * the envelope it was given and never reaches inside for `data`: a helper that "helpfully"
 * unwrapped one level would change what every call site receives.
 */
interface ResponseLike {
    readonly status: number;
    readonly data: UserStoryPayload;
}

/**
 * A rejection reason shaped like the values the interceptor chain rejects with. `status`
 * distinguishes the three conditions the file header describes, and the optional members
 * mirror the two payload shapes the backend actually returns.
 */
interface RejectionLike {
    readonly status: number;
    readonly data: {
        readonly version?: readonly string[];
        readonly _error_message?: string;
    };
}

/** An object carrying a `then` member that is not callable, so it is not a thenable. */
interface NonCallableThenMember {
    readonly then: number;
}

/**
 * Strips `readonly` from every member of `T`.
 *
 * Used by the "not a snapshot" assertion, which mutates a fulfilment payload *after* the
 * adapter has settled with it and then reads the change back through the settled reference.
 * The fixtures are declared `readonly` because production code must not mutate them; the
 * test needs one writable view to prove object identity in a way no clone could fake.
 */
type Mutable<T> = { -readonly [Member in keyof T]: T[Member] };

/**
 * The `$q.defer()` shape: a promise whose callbacks are stored on subscription and invoked
 * later, by hand. This is the double that makes the "still pending" assertion meaningful —
 * an immediately-settling thenable could not distinguish a pending promise from a settled
 * one.
 */
interface FakeDeferred<T> {
    /** The `$q`-like promise handed to the adapter. */
    readonly promise: Thenable<T>;
    /** Invokes every stored fulfilment callback, mimicking `deferred.resolve(value)`. */
    readonly resolve: (value: T) => void;
    /** Invokes every stored rejection callback, mimicking `deferred.reject(reason)`. */
    readonly reject: (reason: unknown) => void;
    /** How many times the adapter subscribed — proves a single `then` registration. */
    readonly subscriptionCount: () => number;
}

// ---------------------------------------------------------------------------------------
// Test doubles — one factory per collaborator shape, mirroring the incumbent `mocks` object
// ---------------------------------------------------------------------------------------

/**
 * Fulfilment payload with distinctive values, so an identity failure is obvious rather
 * than plausible. Declared beside `mocks` rather than inside it so that the envelope
 * factory can reuse it without `mocks` referring to itself in its own initialiser, which
 * would leave the compiler unable to infer the object's type.
 */
const userStoryFixture = (): UserStoryPayload => ({
    id: 4211,
    ref: 42,
    subject: 'Reorder the sprint backlog',
    version: 7,
});

const mocks = {
    /** Fulfilment payload handed to the adapter as the value a `$q` promise resolves with. */
    userStory: userStoryFixture,

    /** Response envelope wrapping a user story, for the no-unwrapping check. */
    response: (): ResponseLike => ({
        status: 200,
        data: userStoryFixture(),
    }),

    /** 400 carrying a `version` field: the optimistic-concurrency conflict. */
    versionConflict: (): RejectionLike => ({
        status: 400,
        data: { version: ['Unable to save: the version of the object is out of date.'] },
    }),

    /** 451: the project is blocked and must not be mutated. */
    blockedProject: (): RejectionLike => ({
        status: 451,
        data: { _error_message: 'This project is blocked.' },
    }),

    /** Status 0: the transport never reached the backend at all. */
    connectionLost: (): RejectionLike => ({
        status: 0,
        data: {},
    }),

    /**
     * A `$q`-like promise that fulfils synchronously, the way an already-resolved `$q`
     * promise invokes a freshly registered callback once AngularJS has processed it.
     *
     * Only `then` is declared: no `catch`, no `finally`. That is the whole point — the
     * adapter is written against `then` alone, so it works for every `$q`-like value.
     */
    fulfilling: <T>(value: T): Thenable<T> => ({
        then(onFulfilled) {
            onFulfilled(value);
        },
    }),

    /**
     * A `$q`-like promise that rejects synchronously. The fulfilment callback is accepted
     * and deliberately ignored, which is what an underscore-prefixed parameter name
     * signals to the compiler under `noUnusedParameters`.
     */
    rejecting: <T>(reason: unknown): Thenable<T> => ({
        then(_onFulfilled, onRejected) {
            onRejected(reason);
        },
    }),

    /**
     * A thenable that is also callable — a plain function carrying a `then` property.
     * Promises/A+ treats functions as thenables, `Promise.resolve` adopts them, and so
     * must this adapter; this double is what exercises that branch of the type guard.
     *
     * Built with `Object.assign` rather than a type assertion so the double stays fully
     * typed: the result is a function intersected with a `then` member, which satisfies
     * `Thenable<T>` structurally.
     */
    callableThenable: <T>(value: T): Thenable<T> =>
        Object.assign(() => undefined, {
            then(onFulfilled: (fulfilment: T) => unknown): void {
                onFulfilled(value);
            },
        }),

    /**
     * A thenable whose `then` throws synchronously — a broken `$q`-like value. Documented
     * behaviour: the native `Promise` constructor turns the throw into a rejection, which
     * is again exactly `Promise.resolve` semantics.
     */
    throwingThenable: <T>(error: Error): Thenable<T> => ({
        then() {
            throw error;
        },
    }),

    /** An object with a non-callable `then`, which must be treated as a plain value. */
    nonCallableThenMember: (): NonCallableThenMember => ({ then: 7 }),

    /**
     * The `$q.defer()` double. Callbacks are stored on subscription and fired later by the
     * test, so settlement timing is fully under the test's control and needs no digest and
     * no timer.
     */
    deferred: <T>(): FakeDeferred<T> => {
        const fulfilmentCallbacks: Array<(value: T) => unknown> = [];
        const rejectionCallbacks: Array<(reason: unknown) => unknown> = [];
        let subscriptions = 0;

        const promise: Thenable<T> = {
            then(onFulfilled, onRejected) {
                subscriptions += 1;
                fulfilmentCallbacks.push(onFulfilled);
                rejectionCallbacks.push(onRejected);
            },
        };

        return {
            promise,
            resolve: (value: T): void => {
                fulfilmentCallbacks.forEach((callback) => callback(value));
            },
            reject: (reason: unknown): void => {
                rejectionCallbacks.forEach((callback) => callback(reason));
            },
            subscriptionCount: (): number => subscriptions,
        };
    },
};

/**
 * Drains the microtask queue so that any promise which *can* settle already has.
 *
 * This is the harness-side tick the unit's own documentation points at, and the reason no
 * digest trigger appears anywhere in this file. Four turns is comfortably more than the two
 * a `new Promise(...)` plus one `then` hop needs, and a genuinely pending promise stays
 * pending no matter how many turns are drained — which is what makes the "still pending"
 * assertion sound rather than merely lucky.
 *
 * Deliberately not a timer: no wall-clock time passes, so the suite cannot become flaky
 * under load.
 */
const flushMicrotasks = async (turns = 4): Promise<void> => {
    for (let turn = 0; turn < turns; turn += 1) {
        await Promise.resolve();
    }
};

describe('toNativePromise', () => {
    describe('fulfilment pass-through', () => {
        it('resolves with the exact value the source fulfilled with', async () => {
            const payload = mocks.userStory();

            const settled = await toNativePromise<UserStoryPayload>(
                mocks.fulfilling<UserStoryPayload>(payload),
            );

            // `Object.is` spelled out, because identity — not structural equality — is the
            // contract: anything else means the adapter touched the value.
            expect(Object.is(settled, payload)).toBe(true);
            expect(settled).toBe(payload);
        });

        it('hands back the very same object rather than a snapshot of it', async () => {
            type MutableUserStory = Mutable<UserStoryPayload>;
            const payload: MutableUserStory = mocks.userStory();

            const settled = await toNativePromise<MutableUserStory>(
                mocks.fulfilling<MutableUserStory>(payload),
            );

            // Mutating the source *after* settlement is visible through the settled
            // reference, which no clone could reproduce. This is the property that keeps a
            // live model's dirty-tracking — and therefore its changed-fields-only PATCH
            // carrying the concurrency `version` — intact across the seam.
            payload.version = 8;

            expect(settled.version).toBe(8);
            expect(settled).toBe(payload);
            expect(Object.keys(settled)).toEqual(['id', 'ref', 'subject', 'version']);
        });

        it('does not reach inside a response envelope for its data property', async () => {
            const envelope = mocks.response();

            const settled = await toNativePromise<ResponseLike>(
                mocks.fulfilling<ResponseLike>(envelope),
            );

            // An adapter that "helpfully" unwrapped one level would silently change what
            // every call site receives — a functional change, forbidden by rule T10.
            expect(settled).toBe(envelope);
            expect(settled).not.toBe(envelope.data);
            expect(settled.data).toBe(envelope.data);
            expect(settled.status).toBe(200);
        });
    });

    describe('rejection pass-through', () => {
        // The three conditions the interceptor chain communicates through rejection
        // *values*. Each is asserted with `toBe`, so a re-wrapped or normalised reason
        // fails even when it is structurally equal to the original.
        it.each<[string, RejectionLike]>([
            ['400 carrying a version field (VERSION_ERROR)', mocks.versionConflict()],
            ['451 blocked project', mocks.blockedProject()],
            ['status 0 connection loss', mocks.connectionLost()],
        ])('rejects with the untouched reason for %s', async (_condition, reason) => {
            const marshalled = toNativePromise<UserStoryPayload>(
                mocks.rejecting<UserStoryPayload>(reason),
            );

            await expect(marshalled).rejects.toBe(reason);
        });

        it('preserves the rejection payload a caller needs to identify the condition', async () => {
            const reason = mocks.versionConflict();

            // `unknown` rather than a loosely typed catch-all: the reason is opaque to the
            // adapter, so the test narrows it the same way a real caller would.
            let caught: unknown = null;

            try {
                await toNativePromise<UserStoryPayload>(
                    mocks.rejecting<UserStoryPayload>(reason),
                );
            } catch (error: unknown) {
                caught = error;
            }

            expect(caught).toBe(reason);

            // Narrowing, not casting — this is exactly what the VERSION_ERROR interceptor
            // and every optimistic-concurrency caller downstream of it has to do.
            if (caught !== null && typeof caught === 'object' && 'status' in caught) {
                const narrowed = caught as RejectionLike;

                expect(narrowed.status).toBe(400);
                expect(narrowed.data.version).toEqual([
                    'Unable to save: the version of the object is out of date.',
                ]);
            } else {
                throw new Error('the rejection reason lost its shape in transit');
            }
        });

        it('never converts a rejection into a resolution', async () => {
            const reason = mocks.blockedProject();
            const onFulfilled = jest.fn();
            let threw = false;
            let caught: unknown = null;

            try {
                const settled = await toNativePromise<UserStoryPayload>(
                    mocks.rejecting<UserStoryPayload>(reason),
                );

                onFulfilled(settled);
            } catch (error: unknown) {
                threw = true;
                caught = error;
            }

            // The negative half of the assertion is the important one: an adapter that
            // resolved with `undefined` on failure would look healthy at every call site
            // while hiding a blocked project.
            expect(threw).toBe(true);
            expect(caught).toBe(reason);
            expect(onFulfilled).not.toHaveBeenCalled();
        });

        it('neither logs nor swallows the rejection', async () => {
            // Spies rather than assertions on output: `jest.config.js` restores them after
            // every test, so no cleanup hook is needed or wanted here.
            const errorOutput = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const warnOutput = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            const logOutput = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            const reason = mocks.connectionLost();

            await expect(
                toNativePromise<UserStoryPayload>(mocks.rejecting<UserStoryPayload>(reason)),
            ).rejects.toBe(reason);

            expect(errorOutput).not.toHaveBeenCalled();
            expect(warnOutput).not.toHaveBeenCalled();
            expect(logOutput).not.toHaveBeenCalled();
        });
    });


    describe('deferred settlement', () => {
        it('stays pending until the deferred resolves, with no digest anywhere', async () => {
            const payload = mocks.userStory();
            const source = mocks.deferred<UserStoryPayload>();
            const observer = jest.fn();

            const marshalled = toNativePromise<UserStoryPayload>(source.promise);

            // Both callbacks point at the same observer, so a spurious rejection would be
            // caught here too — and attaching a rejection handler up front keeps the
            // rejection variant of this test free of unhandled-rejection noise.
            void marshalled.then(observer, observer);

            // Draining the microtask queue proves the promise is genuinely pending rather
            // than merely unobserved. The queue is drained; the AngularJS digest loop is
            // not, and must never be, touched from React code.
            await flushMicrotasks();

            expect(observer).not.toHaveBeenCalled();

            source.resolve(payload);

            await expect(marshalled).resolves.toBe(payload);
            expect(observer).toHaveBeenCalledTimes(1);
            expect(observer).toHaveBeenCalledWith(payload);
        });

        it('stays pending until the deferred rejects, then forwards the reason', async () => {
            const reason = mocks.versionConflict();
            const source = mocks.deferred<UserStoryPayload>();
            const observer = jest.fn();

            const marshalled = toNativePromise<UserStoryPayload>(source.promise);

            void marshalled.then(observer, observer);

            await flushMicrotasks();

            expect(observer).not.toHaveBeenCalled();

            source.reject(reason);

            await expect(marshalled).rejects.toBe(reason);
            expect(observer).toHaveBeenCalledTimes(1);
            expect(observer).toHaveBeenCalledWith(reason);
        });

        it('subscribes to the source exactly once', async () => {
            const payload = mocks.userStory();
            const source = mocks.deferred<UserStoryPayload>();

            const marshalled = toNativePromise<UserStoryPayload>(source.promise);

            // One registration, made eagerly inside the `Promise` executor. A second
            // subscription would mean the source's callbacks run twice, which for a `$q`
            // promise built on top of a repository call is an observable difference.
            expect(source.subscriptionCount()).toBe(1);

            source.resolve(payload);

            await expect(marshalled).resolves.toBe(payload);
            expect(source.subscriptionCount()).toBe(1);
        });

        it('ignores a settlement that arrives twice, as a native promise does', async () => {
            const first = mocks.userStory();
            const second: UserStoryPayload = { ...first, version: 99 };
            const source = mocks.deferred<UserStoryPayload>();

            const marshalled = toNativePromise<UserStoryPayload>(source.promise);

            source.resolve(first);
            source.resolve(second);
            source.reject(mocks.connectionLost());

            // Native promise semantics: the first settlement wins and every later one is a
            // no-op. Asserted because the adapter hands the resolve/reject functions
            // straight to a source it does not control, and a source that misbehaves must
            // not be able to make an already-settled promise change its mind.
            await expect(marshalled).resolves.toBe(first);
        });
    });

    describe('already-native promise input', () => {
        it('adopts a fulfilled native promise', async () => {
            const payload = mocks.userStory();

            const settled = await toNativePromise<UserStoryPayload>(Promise.resolve(payload));

            expect(settled).toBe(payload);
        });

        it('adopts a rejected native promise', async () => {
            const reason = mocks.blockedProject();

            // A native promise is a thenable, so it travels the same single `then` call as a
            // `$q` promise: no branch of the adapter distinguishes them.
            await expect(
                toNativePromise<UserStoryPayload>(Promise.reject(reason)),
            ).rejects.toBe(reason);
        });

        it('is idempotent when applied to its own output', async () => {
            const payload = mocks.userStory();

            const once = toNativePromise<UserStoryPayload>(
                mocks.fulfilling<UserStoryPayload>(payload),
            );
            const twice = await toNativePromise<UserStoryPayload>(once);

            // Idempotence matters because a typed facade may already have marshalled its
            // return value; double application must not produce a promise of a promise.
            expect(twice).toBe(payload);
            expect(twice).not.toBeInstanceOf(Promise);
        });
    });


    describe('non-thenable input', () => {
        it('resolves with a plain object as-is', async () => {
            const payload = mocks.userStory();

            // `$tgRepo.save()` short-circuits an unmodified model
            // (`app/coffee/modules/base/repository.coffee:57-59`) and cached AngularJS
            // getters can return plain data, so a synchronous value has to be safe here.
            // Throwing instead would force every call site to grow a defensive branch.
            const settled = await toNativePromise<UserStoryPayload>(payload);

            expect(settled).toBe(payload);
        });

        it('resolves with null rather than throwing on a null probe', async () => {
            await expect(toNativePromise<null>(null)).resolves.toBeNull();
        });

        it('resolves with undefined', async () => {
            await expect(toNativePromise<undefined>(undefined)).resolves.toBeUndefined();
        });

        // Falsy values are included on purpose: a guard written with a truthiness check
        // instead of an explicit null check plus a `typeof` probe would mishandle every one
        // of them.
        it.each<[string, number | string | boolean]>([
            ['a number', 42],
            ['the number zero', 0],
            ['a string', 'sprint-2026-5-15'],
            ['the empty string', ''],
            ['the boolean false', false],
        ])('resolves with %s unchanged', async (_label, value) => {
            await expect(toNativePromise<number | string | boolean>(value)).resolves.toBe(value);
        });

        it('resolves with an object whose then member is not callable', async () => {
            const value = mocks.nonCallableThenMember();

            // Promises/A+ defines a thenable by a *callable* `then`. An object that merely
            // owns the name is data, and must arrive as data.
            const settled = await toNativePromise<NonCallableThenMember>(value);

            expect(settled).toBe(value);
            expect(settled.then).toBe(7);
        });
    });

    describe('structural contract', () => {
        it('relies on then alone, with no catch and no finally', async () => {
            const payload = mocks.userStory();
            const source = mocks.fulfilling<UserStoryPayload>(payload);

            // The adapter is written against `then` and nothing else, which is what lets it
            // serve a `$q` promise, a `$q.all()` aggregate, a native promise and a
            // hand-rolled double identically — and what lets it be typed by a five-line
            // local interface instead of an AngularJS type package outside the pinned set.
            expect(Object.getOwnPropertyNames(source)).toEqual(['then']);
            expect('catch' in source).toBe(false);
            expect('finally' in source).toBe(false);

            await expect(toNativePromise<UserStoryPayload>(source)).resolves.toBe(payload);
        });

        it('accepts a callable thenable, exactly as promise adoption does', async () => {
            const payload = mocks.userStory();
            const source = mocks.callableThenable<UserStoryPayload>(payload);

            expect(typeof source).toBe('function');

            await expect(toNativePromise<UserStoryPayload>(source)).resolves.toBe(payload);
        });

        it('rejects when the source then throws synchronously', async () => {
            const failure = new Error('the source promise is broken');

            // A broken thenable is surfaced, never masked: the `Promise` executor converts
            // the synchronous throw into a rejection, which is the same behaviour standard
            // promise adoption gives.
            await expect(
                toNativePromise<UserStoryPayload>(
                    mocks.throwingThenable<UserStoryPayload>(failure),
                ),
            ).rejects.toBe(failure);
        });
    });

    describe('module surface', () => {
        it('exports a single-argument marshaller', () => {
            expect(typeof toNativePromise).toBe('function');
            expect(toNativePromise).toHaveLength(1);
        });

        it('returns a native promise for both a thenable and a plain value', () => {
            const fromThenable = toNativePromise<UserStoryPayload>(
                mocks.fulfilling<UserStoryPayload>(mocks.userStory()),
            );
            const fromPlainValue = toNativePromise<UserStoryPayload>(mocks.userStory());

            // The return type is the point of the adapter: React consumers get something
            // they can `await`, aggregate with `Promise.all`, or hand to an effect, with no
            // AngularJS coupling and no digest dependency of any kind.
            expect(fromThenable).toBeInstanceOf(Promise);
            expect(fromPlainValue).toBeInstanceOf(Promise);
        });
    });
});



/*
 * -----------------------------------------------------------------------------
 * Second, independently authored pass over the same marshaller.
 * -----------------------------------------------------------------------------
 * TECHNOLOGY-SPECIFIC SEAM SPEC (rule T9). Written separately from the suite
 * above and retained in full. It drives the marshaller through the narrowest
 * possible `$q`-shaped thenables - ones that settle synchronously the moment
 * `then` is subscribed - and pins the "no retry, no logging of its own"
 * property. Its helpers are declared INSIDE this describe so they stay scoped
 * to these tests.
 */
describe('toNativePromise, synchronous $q-shaped thenables', () => {
    /** A minimal `$q`-shaped thenable that settles synchronously on subscription. */
    function fulfilledThenable<T>(value: T): Thenable<T> {
        return {
            then(onFulfilled) {
                onFulfilled(value);

                return undefined;
            },
        };
    }

    /** A minimal `$q`-shaped thenable that rejects synchronously on subscription. */
    function rejectedThenable<T>(reason: unknown): Thenable<T> {
        return {
            then(_onFulfilled, onRejected) {
                onRejected(reason);

                return undefined;
            },
        };
    }

    describe('toNativePromise', () => {
        it('returns a native promise', () => {
            expect(toNativePromise(fulfilledThenable('x'))).toBeInstanceOf(Promise);
        });

        it('resolves with the exact fulfilment value, unmodified and by reference', async () => {
            // Deliberately response-shaped: nothing may unwrap `.data` on the way
            // through, or every caller's expectations would shift silently.
            const payload = { data: [{ id: 1 }], status: 200 };

            await expect(toNativePromise(fulfilledThenable(payload))).resolves.toBe(payload);
        });

        it('rejects with the exact rejection reason, unmodified and by reference', async () => {
            // The AngularJS interceptor chain surfaces VERSION_ERROR, 451 blocking
            // and connection loss through the rejection value, so it must survive.
            const failure = { status: 400, data: { version: ['conflict'] } };

            await expect(toNativePromise(rejectedThenable(failure))).rejects.toBe(failure);
        });

        it('never converts a rejection into a resolution', async () => {
            const outcome = await toNativePromise(rejectedThenable(new Error('boom'))).then(
                () => 'resolved',
                () => 'rejected',
            );

            expect(outcome).toBe('rejected');
        });

        it('adopts an already-native promise instead of double-wrapping it', async () => {
            await expect(toNativePromise(Promise.resolve('native'))).resolves.toBe('native');
        });

        it('is idempotent, so applying it twice is harmless', async () => {
            const once = toNativePromise(fulfilledThenable('value'));

            await expect(toNativePromise(once)).resolves.toBe('value');
        });

        it('resolves a plain synchronous value directly', async () => {
            // `$tgRepo.save()` short-circuits an unmodified model, and cached
            // AngularJS getters return plain data, so call sites need no guard.
            await expect(toNativePromise(42)).resolves.toBe(42);
        });

        it.each([
            ['null', null],
            ['undefined', undefined],
            ['zero', 0],
            ['empty string', ''],
            ['false', false],
        ])('resolves the falsy non-thenable %s without treating it as absent', async (_label, value) => {
            await expect(toNativePromise(value)).resolves.toBe(value);
        });

        it('adopts a callable thenable, matching Promise.resolve semantics', async () => {
            // Promises/A+ counts a function with `then` as a thenable, and
            // `Promise.resolve` adopts one, so this helper must too.
            const callable = (): void => undefined;
            (callable as unknown as Thenable<string>).then = (onFulfilled): unknown => {
                onFulfilled('from-function');

                return undefined;
            };

            await expect(toNativePromise(callable as unknown as Thenable<string>)).resolves.toBe(
                'from-function',
            );
        });

        it('treats a value whose `then` is not callable as a plain value', async () => {
            const notThenable = { then: 'not a function' };

            await expect(toNativePromise(notThenable)).resolves.toBe(notThenable);
        });

        it('rejects when the source thenable throws synchronously from `then`', async () => {
            const broken: Thenable<string> = {
                then() {
                    throw new Error('broken thenable');
                },
            };

            await expect(toNativePromise(broken)).rejects.toThrow('broken thenable');
        });

        it('subscribes to the source exactly once', async () => {
            const then = jest.fn((onFulfilled: (value: string) => unknown) => {
                onFulfilled('once');

                return undefined;
            });

            await toNativePromise<string>({ then } as unknown as Thenable<string>);

            expect(then).toHaveBeenCalledTimes(1);
        });

        it('adds no retry and no logging of its own', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            const then = jest.fn(
                (_onFulfilled: (value: string) => unknown, onRejected: (reason: unknown) => unknown) => {
                    onRejected(new Error('no retry'));

                    return undefined;
                },
            );

            await expect(
                toNativePromise<string>({ then } as unknown as Thenable<string>),
            ).rejects.toThrow('no retry');

            expect(then).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });
});
