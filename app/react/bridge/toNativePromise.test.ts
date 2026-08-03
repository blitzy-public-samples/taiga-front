/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { toNativePromise } from './toNativePromise';
import type { Thenable } from './toNativePromise';

interface UserStoryPayload {
    readonly id: number;
    readonly ref: number;
    readonly subject: string;
    readonly version: number;
}

interface ResponseLike {
    readonly status: number;
    readonly data: UserStoryPayload;
}

interface RejectionLike {
    readonly status: number;
    readonly data: {
        readonly version?: readonly string[];
        readonly _error_message?: string;
    };
}

interface NonCallableThenMember {
    readonly then: number;
}

type Mutable<T> = { -readonly [Member in keyof T]: T[Member] };

interface FakeDeferred<T> {
    readonly promise: Thenable<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (reason: unknown) => void;
    readonly subscriptionCount: () => number;
}

const userStoryFixture = (): UserStoryPayload => ({
    id: 4211,
    ref: 42,
    subject: 'Reorder the sprint backlog',
    version: 7,
});

const mocks = {
    userStory: userStoryFixture,

    response: (): ResponseLike => ({
        status: 200,
        data: userStoryFixture(),
    }),

    versionConflict: (): RejectionLike => ({
        status: 400,
        data: { version: ['Unable to save: the version of the object is out of date.'] },
    }),

    blockedProject: (): RejectionLike => ({
        status: 451,
        data: { _error_message: 'This project is blocked.' },
    }),

    connectionLost: (): RejectionLike => ({
        status: 0,
        data: {},
    }),

    fulfilling: <T>(value: T): Thenable<T> => ({
        then(onFulfilled) {
            onFulfilled(value);
        },
    }),

    rejecting: <T>(reason: unknown): Thenable<T> => ({
        then(_onFulfilled, onRejected) {
            onRejected(reason);
        },
    }),

    callableThenable: <T>(value: T): Thenable<T> =>
        Object.assign(() => undefined, {
            then(onFulfilled: (fulfilment: T) => unknown): void {
                onFulfilled(value);
            },
        }),

    throwingThenable: <T>(error: Error): Thenable<T> => ({
        then() {
            throw error;
        },
    }),

    nonCallableThenMember: (): NonCallableThenMember => ({ then: 7 }),

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

            expect(Object.is(settled, payload)).toBe(true);
            expect(settled).toBe(payload);
        });

        it('hands back the very same object rather than a snapshot of it', async () => {
            type MutableUserStory = Mutable<UserStoryPayload>;
            const payload: MutableUserStory = mocks.userStory();

            const settled = await toNativePromise<MutableUserStory>(
                mocks.fulfilling<MutableUserStory>(payload),
            );

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

            expect(settled).toBe(envelope);
            expect(settled).not.toBe(envelope.data);
            expect(settled.data).toBe(envelope.data);
            expect(settled.status).toBe(200);
        });
    });

    describe('rejection pass-through', () => {
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

            let caught: unknown = null;

            try {
                await toNativePromise<UserStoryPayload>(
                    mocks.rejecting<UserStoryPayload>(reason),
                );
            } catch (error: unknown) {
                caught = error;
            }

            expect(caught).toBe(reason);

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

            expect(threw).toBe(true);
            expect(caught).toBe(reason);
            expect(onFulfilled).not.toHaveBeenCalled();
        });

        it('neither logs nor swallows the rejection', async () => {
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

            void marshalled.then(observer, observer);

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

            await expect(
                toNativePromise<UserStoryPayload>(Promise.reject(reason)),
            ).rejects.toBe(reason);
        });

        it('⭐ returns an already-native promise AS ITSELF, allocating nothing', () => {
            const payload = mocks.userStory();
            const source = Promise.resolve(payload);

            const marshalled = toNativePromise<UserStoryPayload>(source);

            // IDENTITY, not merely equivalence. `Promise.resolve(p)` returns `p` unchanged
            // when `p` is a native promise built by the same constructor, and this adapter
            // is specified to follow those semantics -- so re-wrapping would add an
            // allocation and a microtask hop the semantics do not have. Asserted with
            // `toBe`, which is the only assertion that can tell the two apart.
            expect(marshalled).toBe(source);
        });

        it('is idempotent when applied to its own output', async () => {
            const payload = mocks.userStory();

            const once = toNativePromise<UserStoryPayload>(
                mocks.fulfilling<UserStoryPayload>(payload),
            );
            const twice = await toNativePromise<UserStoryPayload>(once);

            expect(twice).toBe(payload);
            expect(twice).not.toBeInstanceOf(Promise);
        });

        it('⭐ reads `then` EXACTLY ONCE, so a getter-backed thenable cannot diverge', async () => {
            let reads = 0;
            const payload = mocks.userStory();

            // A thenable whose `then` is an ACCESSOR that hands back a different function on
            // every read -- the second one deliberately never settling. `Promise.resolve`
            // performs exactly one `Get(x, "then")`, so an adapter that probed the property
            // to classify the value and then read it again to call it would subscribe to the
            // WRONG function here and hang forever, while still passing every test written
            // with an ordinary data-property thenable. This is the only assertion that can
            // see that difference.
            const source = {
                get then() {
                    reads += 1;

                    if (reads === 1) {
                        return (onFulfilled: (value: UserStoryPayload) => unknown): unknown =>
                            onFulfilled(payload);
                    }

                    return (): unknown => undefined;
                },
            };

            const settled = await toNativePromise<UserStoryPayload>(
                source as unknown as Thenable<UserStoryPayload>,
            );

            expect(settled).toBe(payload);
            expect(reads).toBe(1);
        });

        it('invokes `then` with the source as its RECEIVER, not detached', async () => {
            const payload = mocks.userStory();
            const receivers: unknown[] = [];

            // A `$q` promise reads its own pending state through `this`, so the adapter must
            // re-supply the receiver it detached when it read the method. Calling a detached
            // `then` would leave `this` undefined and throw inside AngularJS -- from a line
            // that names neither this file nor the call site.
            const source: Thenable<UserStoryPayload> = {
                then(onFulfilled) {
                    // `this` is contextually typed as the object literal under
                    // `noImplicitThis`, so recording it needs no annotation and no cast.
                    receivers.push(this);

                    return onFulfilled(payload);
                },
            };

            const settled = await toNativePromise<UserStoryPayload>(source);

            expect(settled).toBe(payload);
            expect(receivers).toEqual([source]);
        });
    });

    describe('non-thenable input', () => {
        it('resolves with a plain object as-is', async () => {
            const payload = mocks.userStory();

            const settled = await toNativePromise<UserStoryPayload>(payload);

            expect(settled).toBe(payload);
        });

        it('resolves with null rather than throwing on a null probe', async () => {
            await expect(toNativePromise<null>(null)).resolves.toBeNull();
        });

        it('resolves with undefined', async () => {
            await expect(toNativePromise<undefined>(undefined)).resolves.toBeUndefined();
        });

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

            const settled = await toNativePromise<NonCallableThenMember>(value);

            expect(settled).toBe(value);
            expect(settled.then).toBe(7);
        });
    });

    describe('structural contract', () => {
        it('relies on then alone, with no catch and no finally', async () => {
            const payload = mocks.userStory();
            const source = mocks.fulfilling<UserStoryPayload>(payload);

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

            expect(fromThenable).toBeInstanceOf(Promise);
            expect(fromPlainValue).toBeInstanceOf(Promise);
        });
    });
});

describe('toNativePromise, synchronous $q-shaped thenables', () => {
    function fulfilledThenable<T>(value: T): Thenable<T> {
        return {
            then(onFulfilled) {
                onFulfilled(value);

                return undefined;
            },
        };
    }

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
            const payload = { data: [{ id: 1 }], status: 200 };

            await expect(toNativePromise(fulfilledThenable(payload))).resolves.toBe(payload);
        });

        it('rejects with the exact rejection reason, unmodified and by reference', async () => {
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
