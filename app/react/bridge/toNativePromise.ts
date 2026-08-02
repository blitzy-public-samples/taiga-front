/**
 * toNativePromise — the AngularJS `$q` → native `Promise` marshaller that sits on the
 * AngularJS ↔ React seam.
 *
 * ---------------------------------------------------------------------------------------
 * 1. WHAT THIS FILE IS
 * ---------------------------------------------------------------------------------------
 * This migration is a strangler-fig, in-place coexistence migration: the AngularJS 1.5.10
 * shell survives untouched, `KanbanController` and `BacklogController` survive as thin
 * bridges, and only the *rendering* layer of the Kanban and Backlog screens moves to
 * React 18. React is handed data through the repository's existing custom-element
 * hand-off (`tgLoadElement`, `app/coffee/modules/base/load-element.coffee:17-39`, which is
 * reused verbatim and never modified), and it reaches every service — HTTP, realtime,
 * translation, permissions — through the AngularJS injector rather than reimplementing
 * them.
 *
 * Everything AngularJS returns from that service layer is a `$q` promise. This module is
 * the one place where a `$q` promise becomes a native ES `Promise`, so that every React
 * consumer above it (hooks, containers, typed API facades) is plain modern JavaScript.
 *
 * @example
 * // Old — CoffeeScript controller, constructor injection (AAP §0.7.4):
 * //   @rs.userstories.list(projectId).then (uss) => @scope.userstories = uss
 * // New — React hook, marshalled once at the seam:
 * //   const uss = await toNativePromise(rs.userstories.list(projectId));
 *
 * ---------------------------------------------------------------------------------------
 * 2. WHY IT EXISTS
 * ---------------------------------------------------------------------------------------
 * `$q` resolution is coupled to the AngularJS digest loop: a `$q` promise settles when
 * AngularJS processes it, not when the microtask queue drains. Awaiting one directly from
 * React leaks that coupling into React code and — worse — tempts a caller into forcing a
 * digest to "make the await work". Converting once, here, at the seam, contains the
 * coupling to a single ten-line function and leaves every consumer with an ordinary
 * `Promise` it can `await`, `Promise.all`, or hand to `useEffect`.
 *
 * ---------------------------------------------------------------------------------------
 * 3. PROHIBITION 1 — NEVER TRIGGER AN ANGULARJS DIGEST FROM REACT
 * ---------------------------------------------------------------------------------------
 * AAP §0.7.4 is explicit that React code must never call AngularJS's digest triggers —
 * the rootScope/scope `apply()` and `digest()` family and `applyAsync()`. Digest cycles
 * stay AngularJS's concern. (AngularJS service and provider identifiers are deliberately
 * written throughout these comments without their `$` sigils where the sigilled spelling
 * would collide with a banned token: this folder is scanned for the digest-trigger and
 * transport tokens to catch real calls, and a comment naming them literally would trip a
 * gate that exists for a good reason.)
 *
 * Three verified facts make that prohibition safe to obey rather than a leap of faith:
 *
 *   a. AngularJS's own HTTP provider is already configured with `useApplyAsync(true)` at
 *      `app/coffee/app.coffee:604`. AngularJS itself already schedules HTTP resolution
 *      asynchronously; nothing needs nudging.
 *   b. `$tgEvents` dispatch with a *null* scope runs OUTSIDE any digest —
 *      `app/coffee/modules/events.coffee:185-190` branches on `if subscription.scope`
 *      (line 185) and only then wraps the callback; the else branch at lines 189-190
 *      invokes `subscription.callback(data.data)` directly. React's realtime callbacks,
 *      which subscribe with a null scope, therefore already arrive digest-free.
 *   c. React state is driven by React (`useState` / `useReducer`), never by a digest.
 *
 * If a `$q` promise appears not to settle in a test, the fix belongs in the TEST HARNESS —
 * pump the injected rootScope there — never in production code.
 *
 * ---------------------------------------------------------------------------------------
 * 4. PROHIBITION 2 — NEVER BUILD A PARALLEL HTTP CLIENT
 * ---------------------------------------------------------------------------------------
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP client. New
 * TypeScript files are typed facades over the existing repository layer."
 *
 * No transport of any kind may appear anywhere under `app/react/bridge/`. This module does
 * not open, wrap, configure or reference a transport; it only adapts a promise that
 * AngularJS has already produced. What routing every request through `$tgResources` →
 * `$tgRepo` → `$tgHttp` inherits, and what a hand-rolled client would silently drop
 * (requirement I7):
 *
 *   • `Authorization: Bearer <token>` and `Accept-Language`, built by
 *     `app/coffee/modules/base/http.coffee:17-30` (token read at line 21, header set at
 *     line 23; preferred language read at line 26, header set at line 28) and merged into
 *     every request at line 33 via `_.assign({}, options.headers or {}, @.headers())`.
 *   • `X-Session-Id`, from the `defaultHeaders` literal at `app/coffee/app.coffee:590-594`
 *     (line 593), applied to delete/patch/post/put at lines 596-599, with GET receiving
 *     `X-Session-Id` alone at lines 600-602.
 *   • The interceptor chain, which supplies behaviour no React code may reimplement: the
 *     single-flight 401 refresh (`app/coffee/app.coffee:609-613` holds the shared
 *     in-progress/promise pair, so concurrent requests do not each trigger their own
 *     refresh); the 400-with-`version` VERSION_ERROR toast raised for 10,000 ms
 *     (lines 740-747); the 451 blocked-project interceptor (lines 764, 775); and the
 *     status-0 / status-−1 connection-error path (line 619).
 *
 * ---------------------------------------------------------------------------------------
 * 5. WHY REJECTION VALUES MUST PASS THROUGH UNTOUCHED
 * ---------------------------------------------------------------------------------------
 * The interceptor chain communicates through rejection *values*, not through exception
 * types: `versionCheckHttpIntercept` ends with `return $q.reject(response)` at
 * `app/coffee/app.coffee:750`, so the rejection value IS the AngularJS response object
 * carrying `status` and `data`. The repository layer likewise rejects with the raw server
 * payload — `defered.reject(data)` at `app/coffee/modules/base/repository.coffee:33` and
 * `:83`. Re-wrapping, normalising, logging-and-swallowing, or converting a rejection into
 * a resolution would hide VERSION_ERROR conflicts, 451 blocking and connection loss from
 * the callers whose job it is to surface them. This adapter therefore forwards the
 * rejection value byte-for-byte and adds nothing.
 *
 * Fulfilment values are forwarded with the same discipline. `$tgRepo` resolves with live
 * `$tgModel` instances — `defered.resolve(model)` at `repository.coffee:43`, `:58`, `:80`,
 * `:91` — and occasionally with a `[model, headers()]` tuple (`:78`). Unwrapping
 * `response.data`, cloning, or flattening here would change what every call site receives,
 * which rule T10 ("No functional or feature change of any kind") forbids.
 *
 * ---------------------------------------------------------------------------------------
 * 6. THE `$tgModel` DIRTY-TRACKING GUARANTEE
 * ---------------------------------------------------------------------------------------
 * Preserving those live model instances is a data-integrity requirement, not a stylistic
 * preference. `$tgModel.getAttrs(patch)` at `app/coffee/modules/base/model.coffee:48-54`
 * copies the optimistic-concurrency `version` into the modified-attribute set (lines
 * 49-50) and, when `patch` is true, returns `_.extend({}, @._modifiedAttrs)` (lines
 * 52-53) — ONLY the fields the user actually changed, plus `version`; the non-patch branch
 * at line 54 returns the full `_.extend({}, @._attrs, @._modifiedAttrs)` merge.
 * `$tgRepo.save()` (`repository.coffee:54-85`) sends exactly that as the PATCH body at
 * line 63, and short-circuits entirely when the model is unmodified (lines 57-59).
 *
 * A hand-rolled client would send the whole object instead, turning every edit into a
 * potential silent lost update: two users editing different fields of the same user story
 * would overwrite each other. There is no error, no toast and no console warning — the
 * corruption surfaces only on the next page load. That is the failure this file's
 * "adapt, never replace" contract exists to prevent.
 *
 * ---------------------------------------------------------------------------------------
 * Governing constraints honoured here: T5 (no parallel HTTP client), T8 (all new code
 * isolated under `app/react/**`; this module adds no barrel, helper or constants file),
 * T9 (comment the seam at the point of change), T10 and the Minimal Change Clause (no
 * timeouts, retries, cancellation, logging, unwrapping or error transformation — the
 * incumbent has none of them and adding any would be an enhancement), I7 (React calls the
 * existing `$tgRepo`/`$tgModel` layer), and HR-2 (the dependency set is closed —
 * `@types/angular` is deliberately absent, hence the minimal local `Thenable` type below
 * instead of an imported `ng.IPromise`).
 */

/**
 * The minimal structural contract this adapter needs from an AngularJS `$q` promise.
 *
 * `$q` promises are Promises/A-compatible in the one way that matters here: they expose
 * `then(onFulfilled, onRejected)`. Some AngularJS call sites additionally use `catch()`
 * and `finally()`, but this adapter deliberately relies on `then` and nothing else, so it
 * works for any `$q`-like value — a `$q` promise, a `$q.all()` aggregate, a native
 * `Promise`, or a hand-rolled thenable in a unit test — without importing a type package.
 *
 * Declared locally and structurally on purpose: `@types/angular` is not part of the
 * pinned dependency set (HR-2) and must not be added.
 *
 * @typeParam T - the value the thenable fulfils with, forwarded unchanged.
 */
export interface Thenable<T> {
    then(
        onFulfilled: (value: T) => unknown,
        onRejected: (reason: unknown) => unknown,
    ): unknown;
}

/**
 * Narrows an arbitrary value to {@link Thenable} using the Promises/A+ definition of a
 * thenable: a non-null object *or function* exposing a callable `then`. Functions are
 * included because `Promise.resolve()` adopts them too, and this helper is specified to
 * follow `Promise.resolve(thenable)` semantics.
 *
 * A type predicate rather than a cast to a permissive type: the parameter is `unknown`, so
 * the structural probe below needs no escape hatch and the whole module stays free of
 * loosely typed values.
 *
 * @typeParam T - the value the thenable is expected to fulfil with.
 * @param value - candidate value, of entirely unknown shape.
 * @returns `true` when `value` exposes a callable `then`.
 */
function isThenable<T>(value: unknown): value is Thenable<T> {
    if (value === null) {
        return false;
    }

    const kind = typeof value;

    if (kind !== 'object' && kind !== 'function') {
        return false;
    }

    return typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Marshals an AngularJS `$q` promise into a native ES `Promise`.
 *
 * Behavioural contract — deliberately the smallest one that is correct:
 *
 * - **Fulfilment** resolves with the *exact same value*, unmodified: no unwrapping of
 *   `response.data`, no cloning, no flattening. Live `$tgModel` instances therefore reach
 *   React with their dirty-tracking intact (see §6 of the file header).
 * - **Rejection** rejects with the *exact same reason*, unmodified, because the AngularJS
 *   interceptor chain surfaces VERSION_ERROR, 451 blocking and connection loss through
 *   rejection values (see §5 of the file header). Rejections are never swallowed, never
 *   logged, and never converted into resolutions.
 * - **Already-native inputs** are adopted rather than double-wrapped: passing a native
 *   `Promise` (or any other thenable) yields a promise that settles with it, exactly as
 *   `Promise.resolve(thenable)` does — so the helper is idempotent and safe to apply at a
 *   call site whose return type may already have been marshalled.
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
    return new Promise<T>((resolve, reject) => {
        if (isThenable<T>(value)) {
            // A single `then` call, handing the native resolve/reject functions straight
            // to the source promise. Nothing is inspected, copied or re-thrown in
            // between, which is what guarantees the untouched pass-through both branches
            // of the contract above promise.
            value.then(resolve, reject);

            return;
        }

        // Not a thenable: settle with the synchronous value as-is.
        resolve(value);
    });
}
