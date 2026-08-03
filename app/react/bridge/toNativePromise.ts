/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

export interface Thenable<T> {
    then(
        onFulfilled: (value: T) => unknown,
        onRejected: (reason: unknown) => unknown,
    ): unknown;
}

/**
 * The `then` method of a {@link Thenable}, detached from its receiver.
 *
 * Named so that {@link readThenOnce} can hand back the method it read WITHOUT having read
 * it twice, and so the call below can be written as an explicit `.call(source, …)` — which
 * is what re-supplies the receiver that detaching removed.
 *
 * @typeParam T - the value the thenable fulfils with.
 */
type ThenMethod<T> = Thenable<T>['then'];

/**
 * Reads `then` off a candidate value EXACTLY ONCE and hands it back when it is callable.
 *
 * ⭐⭐ THE SINGLE-READ GUARANTEE, AND WHY IT IS NOT PEDANTRY. Promises/A+ defines a
 * thenable as a non-null object *or function* exposing a callable `then`, and
 * `Promise.resolve` performs exactly ONE `Get(x, "then")` before invoking it. An adapter
 * that probed `then` to decide whether the value is thenable and then read it AGAIN to
 * call it would observe the property twice — so a getter-backed or otherwise stateful
 * `then` could return one function to the probe and a different one (or nothing) to the
 * call, and the adapter's behaviour would silently diverge from the native semantics it
 * claims to follow. Reading once removes that class of divergence rather than documenting
 * it. Functions are accepted as well as objects, because `Promise.resolve` adopts a
 * callable thenable too.
 *
 * The result is a discriminating read rather than a type predicate: a predicate would have
 * to be handed the property it had already read to stay honest about the single access,
 * whereas returning the method itself makes "found a callable `then`" and "here is the
 * exact function to call" one indivisible answer. `null` means "not a thenable".
 *
 * @typeParam T - the value the thenable is expected to fulfil with.
 * @param value - candidate value, of entirely unknown shape.
 * @returns the callable `then` that was read, or `null` when `value` is not a thenable.
 */
function readThenOnce<T>(value: unknown): ThenMethod<T> | null {
    if (value === null) {
        return null;
    }

    const kind = typeof value;

    if (kind !== 'object' && kind !== 'function') {
        return null;
    }

    // THE ONE AND ONLY READ of `then` in this module.
    const then: unknown = (value as { then?: unknown }).then;

    return typeof then === 'function' ? (then as ThenMethod<T>) : null;
}

/**
 * Recognises a value that is ALREADY a native `Promise`.
 *
 * A type predicate whose body is a single `instanceof` check, so it introduces no cast. It
 * exists to make the identity branch below expressible without one: `Promise.resolve`
 * returns its argument UNCHANGED when that argument is a native promise built by the same
 * constructor, and reproducing that is what makes this adapter genuinely idempotent rather
 * than merely idempotent-in-value.
 *
 * @typeParam T - the value the promise fulfils with.
 * @param value - candidate value, of entirely unknown shape.
 * @returns whether `value` is a native `Promise`.
 */
function isNativePromise<T>(value: unknown): value is Promise<T> {
    return value instanceof Promise;
}

/**
 * Marshals an AngularJS `$q` promise into a native `Promise`.
 *
 * Fulfilment and rejection both pass through UNTOUCHED. Nothing is unwrapped,
 * cloned or flattened, so a live model reaches the caller with its dirty tracking
 * intact; and nothing is swallowed or converted, because the interceptor chain
 * surfaces version conflicts, blocked projects and connection loss as rejection
 * values. There is deliberately no timeout, retry, cancellation or logging: the
 * AngularJS code being bridged has none.
 *
 * - **Fulfilment** resolves with the *exact same value*, unmodified: no unwrapping of
 *   `response.data`, no cloning, no flattening. Live `$tgModel` instances therefore reach
 *   React with their dirty-tracking intact (see §6 of the file header).
 * - **Rejection** rejects with the *exact same reason*, unmodified, because the AngularJS
 *   interceptor chain surfaces VERSION_ERROR, 451 blocking and connection loss through
 *   rejection values (see §5 of the file header). Rejections are never swallowed, never
 *   logged, and never converted into resolutions.
 * - **Already-native inputs are returned AS THEMSELVES**, not re-wrapped: a native
 *   `Promise` is handed straight back, exactly as `Promise.resolve(promise)` does. Any
 *   other thenable is adopted instead. Either way the helper is idempotent and safe to
 *   apply at a call site whose return type may already have been marshalled, and applying
 *   it twice allocates nothing the second time.
 * - **`then` IS READ EXACTLY ONCE**, and invoked with the source as its receiver, which is
 *   again precisely what `Promise.resolve` does. See {@link readThenOnce} for why a second
 *   read would let a getter-backed thenable diverge from native semantics.
 * - **Non-thenable inputs** resolve directly instead of throwing, so call sites that may
 *   return a synchronous value — `$tgRepo.save()` short-circuits an unmodified model at
 *   `app/coffee/modules/base/repository.coffee:57-59`, and cached AngularJS getters can
 *   return plain data — need no defensive branch of their own.
 * - **No timeouts, no retries, no cancellation, no logging.** The incumbent AngularJS code
 *   has none of these; adding any would be a functional change (T10, Minimal Change
 *   Clause).
 * - **No digest is triggered.** See §3 of the file header for the prohibition and the
 *   three facts that make honouring it safe.
 *
 * If `then` itself throws synchronously — a broken thenable — the native `Promise`
 * constructor rejects with that error, which is again exactly `Promise.resolve` semantics
 * and requires no extra handling here.
 *
 * @typeParam T - the value the source promise fulfils with.
 * @param value - a `$q` promise, any other thenable, or a plain synchronous value.
 * @returns a native `Promise` settling with the source's fulfilment or rejection value,
 *          passed through untouched.
 */
export function toNativePromise<T>(value: Thenable<T> | T): Promise<T> {
    if (isNativePromise<T>(value)) {
        // ALREADY NATIVE: hand it straight back. `Promise.resolve` returns its argument
        // unchanged in exactly this case, so re-wrapping would add an allocation and a
        // microtask hop that the semantics this module claims to follow do not have.
        return value;
    }

    // THE ONE READ of `then`, taken BEFORE the executor runs so that detection and
    // invocation cannot observe the property twice (see `readThenOnce`).
    const then = readThenOnce<T>(value);

    return new Promise<T>((resolve, reject) => {
        if (then === null) {
            // Not a thenable: settle with the synchronous value as-is. `readThenOnce`
            // returning nothing is precisely the negative of the union's thenable half,
            // so the remaining value is the plain one.
            resolve(value as T);

            return;
        }

        // A single `then` INVOCATION of the function already read, with `value` re-supplied
        // as the receiver — `then` was detached from it, and a `$q` promise's `then` reads
        // its own state through `this`. The native resolve/reject functions are handed
        // straight over: nothing is inspected, copied or re-thrown in between, which is
        // what guarantees the untouched pass-through both branches of the contract above
        // promise. Called EAGERLY inside the executor rather than deferred to a microtask,
        // which keeps the subscription timing the incumbent call sites already have.
        then.call(value, resolve, reject);
    });
}
