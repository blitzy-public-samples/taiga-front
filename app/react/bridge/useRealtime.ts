/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useRealtime.ts -- THE NULL-SCOPE `$tgEvents` SUBSCRIPTION HOOK
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file. It is one of the
 * load-bearing seams of a strangler-fig coexistence migration, so every
 * statement below was verified by reading the cited source rather than assumed,
 * and every locator is quoted.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS, AND WHICH FILE IT WRAPS
 * --------------------------------------------------------------------------
 * The one sanctioned way for React code to receive a realtime push:
 *
 *     useRealtime(routingKey, handler);                        // no options
 *     useRealtime(routingKey, handler, MILESTONE_OPTIONS);     // with options
 *
 * It subscribes a callback to a RabbitMQ routing key over the WebSocket
 * connection that `taiga-events` serves, and -- the entire point of the file --
 * it unsubscribes in its own effect cleanup.
 *
 * PATH CORRECTION, because reading the wrong file produces a plausible-looking
 * and wrong implementation: the realtime service lives at
 * `app/coffee/modules/events.coffee` (306 lines, `angular.module("taigaEvents")`
 * at `:13`, provider registered `module.provider("$tgEvents", EventsProvider)`
 * at `:306`, module listed in the application array at `app/coffee/app.coffee:1056`).
 * There is NO `app/coffee/modules/base/events.coffee`: that directory holds
 * exactly twelve files -- bind, conf, contrib, filters, http, load-element,
 * location, model, navurls, repository, storage, urls -- and none of them is the
 * events service. AAP 0.6.2 cites the non-existent path; the verified one is
 * used throughout this header. Every bare `:NNN` locator below refers to
 * `app/coffee/modules/events.coffee`.
 *
 * That file is REFERENCE ONLY and is not modified by this migration.
 *
 * --------------------------------------------------------------------------
 * 2. WHY THIS FILE IS WRITTEN SO DEFENSIVELY -- AAP 0.6.3, ITEM 8, VERBATIM
 * --------------------------------------------------------------------------
 *     "`useRealtime` passes a null scope and calls `unsubscribe(routingKey)` in
 *      its `useEffect` cleanup. This is the single easiest place in the
 *      migration to leak, and the leak is silent -- it manifests only as
 *      duplicate refreshes after navigating away and back."
 *
 * "Silent" is the operative word. A leaked subscription throws nothing, logs
 * nothing and breaks no test that renders a screen once. It surfaces as a board
 * that reloads twice, then three times, then four, as a user walks between
 * Kanban and Backlog -- attributed, when it is finally noticed, to anything but
 * this hook. The mechanisms in sections 3, 5 and 6 exist for that reason and
 * are mandatory, not defensive extras.
 *
 * --------------------------------------------------------------------------
 * 3. THE FORMAL PROOF THAT A NULL SCOPE OBLIGES REACT TO UNSUBSCRIBE
 * --------------------------------------------------------------------------
 * The last line of `subscribe` (`:217`) is:
 *
 *     scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope
 *
 * The trailing `if scope` guard is the whole argument. AngularJS registers its
 * automatic teardown ONLY when a scope was supplied, which is why both surviving
 * controllers can subscribe and forget: `KanbanController.initializeSubscription`
 * (`app/coffee/modules/kanban/main.coffee:341`) and
 * `BacklogController.initializeSubscription`
 * (`app/coffee/modules/backlog/main.coffee:269`) both pass their own scope.
 *
 * React has no scope and must never be handed one (section 4), so it passes
 * `null`, the guard is false, and NOTHING auto-unsubscribes. Calling
 * `unsubscribe` in the cleanup is therefore the only teardown that exists.
 *
 * Passing `null` is house style rather than a novel usage: the service subscribes
 * with a null scope at `:73` (`notifications`), `:83` (`live_notifications.<id>`)
 * and `:115` (`web_notifications.<id>`). Every one of those is a process-lifetime
 * subscription that is never torn down, which is precisely why none of them had
 * to solve the problem this hook solves.
 *
 * --------------------------------------------------------------------------
 * 4. NULL-SCOPE DISPATCH RUNS OUTSIDE ANY DIGEST -- AND THAT IS WANTED
 * --------------------------------------------------------------------------
 * `processMessage` (`:177-190`) branches on the stored scope:
 *
 *     if subscription.scope                 # :185
 *         subscription.scope.$apply ->      # :186  <- AngularJS consumers
 *             subscription.callback(data.data)
 *     else                                  # :189
 *         subscription.callback(data.data)   # :190  <- this hook's callback
 *
 * With `null`, delivery takes the `:189-190` branch and the callback runs
 * OUTSIDE any digest cycle. That is exactly right for React: the handler sets
 * React state, React schedules its own render, and no AngularJS bookkeeping is
 * involved.
 *
 * It is also the second reason -- after AAP 0.7.4's verbatim rule that React
 * code must "never" call the root scope's apply method -- why this file triggers
 * no digest by hand, and there is nothing here to schedule one with: digest
 * cycles remain AngularJS's concern. Responses arriving on the shared transport
 * already schedule their own, because the AngularJS HTTP provider is configured
 * with `useApplyAsync(true)` at `app/coffee/app.coffee:604`.
 *
 * --------------------------------------------------------------------------
 * 5. HAZARD H1 -- UNSUBSCRIBE DOES NOT REMOVE THE LOCAL SUBSCRIPTION ENTRY
 * --------------------------------------------------------------------------
 * `unsubscribe` (`:219-230`) does exactly one thing: it sends
 * `{"cmd": "unsubscribe", "routing_key": routingKey}` (`:225-230`). Searching all
 * 306 lines for a mutation of the subscription registry finds EXACTLY THREE
 * sites -- the existence check at `:180`, the read at `:183` and the write at
 * `:214` -- and NO `delete` anywhere. The local entry therefore SURVIVES
 * unsubscription.
 *
 * The consequence is precise: a message already in flight, or one the server
 * dispatches before it processes the unsubscribe command, still finds the entry
 * at `:180`, still reaches `:190`, and still invokes the callback AFTER React's
 * cleanup has run. A closure over stale props then writes state into an
 * unmounted tree, with no error and no warning.
 *
 * Two mechanisms answer this, and both are required:
 *
 *   - THE DISPOSED FLAG. Each effect run owns a private `disposed` boolean. The
 *     cleanup sets it BEFORE calling `unsubscribe`, and the subscribed callback
 *     returns immediately while it is set, so a late delivery becomes a no-op
 *     instead of a state write. Ordering matters: setting it after the
 *     `unsubscribe` call would leave a window open.
 *   - THE HANDLER REF (section 6), which additionally guarantees the callback
 *     never closes over a stale render's `handler`.
 *
 * The registry is deliberately left as it is. `events.coffee` is REFERENCE ONLY;
 * adding a `delete` there would change behaviour for every AngularJS consumer of
 * a service used across the whole application, which the Minimal Change Clause
 * forbids. The fix belongs on the React side of the seam, which is here.
 *
 * --------------------------------------------------------------------------
 * 6. HAZARD H2 -- SUBSCRIPTIONS ARE KEYED GLOBALLY: ONE CONSUMER PER KEY
 * --------------------------------------------------------------------------
 * `subscribe` (`:195-217`) stores `{scope, routingKey, callback}` at `:200-204`
 * into `@.subscriptions[routingKey]` at `:214` -- a single flat map keyed by the
 * routing key across the entire application. Two invariants follow:
 *
 *   - A SECOND SUBSCRIBE TO THE SAME KEY SILENTLY CLOBBERS THE FIRST CALLBACK.
 *     The first consumer simply stops receiving messages; nothing reports it.
 *   - EITHER CONSUMER'S `unsubscribe` KILLS THE SERVER-SIDE SUBSCRIPTION FOR
 *     BOTH, because the wire command carries only the key.
 *
 * So "one live consumer per routing key" is an INVARIANT THIS HOOK PROTECTS, not
 * a problem it engineers around -- the two screens are designed with exactly one
 * subscription per key. Concretely: mount one `useRealtime` per key per screen;
 * never call it twice with the same key in the same tree; if two components need
 * the same stream, subscribe once in a shared parent hook and fan out in React.
 *
 * The hook protects the invariant by not resubscribing without cause: the effect
 * re-runs only when the service identity, the routing key, or the VALUE of the
 * options changes. A new `handler` on every render does NOT tear the
 * subscription down and build it up again (section 7).
 *
 * `options` IS A SUBSCRIBE-TIME WIRE CONCERN ONLY. It is not stored on the
 * subscription at `:200-204`; it is attached to the outgoing message at
 * `:211-212` (`if options then message.options = options`). It is therefore read
 * once, when the subscribe command is sent, and never again.
 *
 * --------------------------------------------------------------------------
 * 7. `unsubscribe` TAKES EXACTLY ONE ARGUMENT
 * --------------------------------------------------------------------------
 * `unsubscribe: (routingKey) ->` (`:219`). One parameter. `options` must NEVER be
 * passed to it -- there is no second parameter to receive it, and an extra
 * argument would be silently dropped while suggesting to a reader that the
 * teardown is somehow option-aware. The cleanup below calls it with the routing
 * key and nothing else, and the co-located spec asserts the ARGUMENT COUNT, not
 * merely the first argument.
 *
 * --------------------------------------------------------------------------
 * 8. THE FROZEN ROUTING KEYS (GOAL G2) -- PER SCREEN, AND NOT THE UNION
 * --------------------------------------------------------------------------
 * NO ROUTING KEY IS SPELLED OUT ANYWHERE IN THIS FILE, not even in a comment.
 * Keys are composed by the caller from the live project id and passed in, and a
 * grep of this file for a composed key returns nothing, which is the intended
 * proof of that. The segments are therefore named rather than joined below: each
 * key is built from four dot-separated parts -- the literal `changes`, the
 * literal `project`, the numeric project id, and the resource name -- exactly as
 * the two controllers build them today.
 *
 * Goal G2 quotes three resource names (`userstories`, `milestones`, `projects`),
 * and it is worth being explicit that THAT TRIPLE IS THE UNION OF BOTH SCREENS
 * AND NEITHER SCREEN'S SET. Verified per screen:
 *
 *   KANBAN -- `app/coffee/modules/kanban/main.coffee:341` (`initializeSubscription`)
 *     - resource `userstories` -- key built at `:345`, subscribed at `:346`
 *     - resource `projects`    -- key built at `:350`, subscribed at `:351`
 *     - NOT `milestones`.
 *     - No options argument on either subscription.
 *     - Both callbacks are wrapped in a leading-edge debounce of a random 700-1000 ms
 *       (`:342`). That debounce belongs to the CALLER's handler, never to this
 *       hook: a hook-level debounce would silently change delivery timing for
 *       every consumer.
 *
 *   BACKLOG -- `app/coffee/modules/backlog/main.coffee:269` (`initializeSubscription`)
 *     - resource `userstories` -- key built at `:270`, subscribed at `:271`, NO options
 *     - resource `milestones`  -- key built at `:275`, subscribed at `:276`,
 *       WITH `{ selfNotification: true }` supplied as the fourth argument at `:280`
 *     - NOT `projects`.
 *
 * CORRECTION FOR THE AUTHOR OF `../backlog/hooks/useBacklogRealtime.ts`: the
 * options object belongs to the `milestones` subscription, not the
 * `userstories` one. The folder brief's locator (`:280` in the current file) is
 * right; its prose attributes the object to the wrong key. Read `:269-280`
 * before wiring it. Dropping the object, or attaching it to the wrong key,
 * changes realtime behaviour silently and violates rule T10 ("No functional or
 * feature change of any kind"). Supporting that fourth argument is the entire
 * reason this hook accepts `options` at all.
 *
 * --------------------------------------------------------------------------
 * 9. `connected`, AND WHAT RECONNECTION DOES NOT RESTORE
 * --------------------------------------------------------------------------
 * This hook owns NO connection lifecycle. `events.coffee` owns all of it:
 * `onError` (`:262-270`) retries while `@.errors < @.maxConnectionErrors`;
 * `onClose` (`:272-278`) clears `@.connected` at `:274` and retries;
 * `randomTryInterval` (`:280-284`) jitters between half and one whole
 * `reconnectTryInterval`; `sendMessage` (`:165-176`) queues into
 * `@.pendingMessages` and returns early while disconnected, so both commands
 * this hook sends are buffered and flushed on reconnect. Re-implementing any of
 * that here would violate rule T10 and the Minimal Change Clause. No transport
 * is opened, no socket is constructed, no heartbeat is scheduled.
 *
 * ONE GAP MATTERS TO CONSUMERS, THOUGH: `onOpen` (`:235-250`) sets
 * `@.connected = true` at `:236` and restores ONLY the auth message, the
 * heartbeat and the three global subscriptions (`:248-250`). IT DOES NOT
 * RE-SUBSCRIBE PROJECT-SCOPED KEYS. A subscription made through this hook is
 * re-sent after a reconnect only because the queued command is flushed; a
 * consumer that needs data guaranteed fresh after a dropped connection must
 * reload it explicitly.
 *
 * That is what the disconnected-reload fallback in the Backlog controller does,
 * and it is the ONLY site in the whole repository that reads `connected`
 * (declared `:23`, set `:236`, cleared `:274`):
 * `app/coffee/modules/backlog/main.coffee:715` fires THREE reloads --
 * `loadSprints()` at `:716`, `loadClosedSprints()` at `:717` and
 * `loadProjectStats()` at `:718`. AAP 0.8.3 names only the first; the verified
 * count is three, and all three must be reproduced.
 *
 * This hook deliberately does NOT implement that fallback. It belongs in
 * `../backlog/hooks/useStoryDrag.ts`, gated on the drag queue being empty,
 * because it is a consequence of completing a drag and not of subscribing.
 * `connected` is reachable there through the typed facade --
 * `useAngularService('$tgEvents').connected`
 * (`./useAngularService.ts`, `TaigaEventsService.connected`) -- so nothing needs
 * to be re-exposed here.
 *
 * --------------------------------------------------------------------------
 * 10. WHY `handler` IS DELIBERATELY ABSENT FROM THE EFFECT DEPENDENCY ARRAY
 * --------------------------------------------------------------------------
 * Consumers pass inline arrows -- that is the ergonomic point of the hook:
 *
 *     useRealtime(key, () => { void reload(); });
 *
 * An inline arrow is a NEW FUNCTION IDENTITY ON EVERY RENDER. Listing `handler`
 * in the dependency array would therefore tear down and rebuild the SERVER-SIDE
 * subscription on every single render: an `unsubscribe` command and a
 * `subscribe` command per render, a window in which pushes are lost, and -- by
 * hazard H2 -- a stream of registry overwrites. The obvious "fix" of asking
 * every caller to wrap its handler in `useCallback` is not one: it pushes a
 * correctness requirement onto every call site, where forgetting it is invisible.
 *
 * So the subscribed callback is created ONCE per subscription and reads the
 * handler out of a ref that a separate effect keeps current. The subscription
 * lifetime is decoupled from the handler identity, while dispatch always invokes
 * the LATEST handler -- never a stale closure. The co-located spec asserts both
 * halves: re-rendering with a new inline handler does not resubscribe, and the
 * newest handler is the one that receives the next message.
 *
 * `options` is protected from the same churn for the same reason, by a different
 * means: what enters the dependency array is a normalised STRING derived from the
 * object's contents, not the object. An inline literal therefore cannot churn the
 * subscription, while a genuine VALUE change still resubscribes with the new wire
 * options. The object itself is read straight from the effect's closure -- React
 * always runs the latest render's closure when it re-runs an effect -- so no ref
 * is involved and the behaviour does not depend on the order in which React
 * flushes this file's two effects within one commit. Callers are nevertheless
 * asked to hoist a module-level constant, because that states the intent plainly.
 *
 * --------------------------------------------------------------------------
 * 11. CONSTRAINTS THIS FILE IS HELD TO
 * --------------------------------------------------------------------------
 * Rule T5 -- "Reuse `$tgResources`; do not build a parallel HTTP client. New
 * TypeScript files are typed facades over the existing repository layer." This
 * file constructs no transport of any kind: no browser request API, no browser
 * XHR API, no third-party HTTP client, no socket. Requirement I7 keeps writes on
 * the `$tgRepo`/`$tgModel` path so PATCHes stay dirty-tracked; nothing here
 * writes at all.
 *
 * Rule T8 -- all new code is isolated under `app/react/**`. This hook adds no
 * barrel module: consumers import it by path.
 *
 * Requirement I9 -- realtime lives in a hook precisely so the browserless jsdom
 * suite can exercise it. It is testable with a two-method test double and no
 * browser, which is what makes the coverage gate reachable.
 *
 * Strict typing -- `tsconfig.json` sets `strict: true` with no per-flag opt-outs,
 * plus `noUnusedLocals`, `noUnusedParameters` and `isolatedModules`. The message
 * payload is typed `unknown`, never the unsafe escape-hatch type: `:190` passes
 * `data.data`, whose shape differs per routing key, so the consumer -- which
 * knows its key -- narrows it. There is no `baseUrl` and no `paths`, so the one
 * internal import is relative.
 * ========================================================================== */

import { useEffect, useRef } from 'react';

import { useAngularService } from './useAngularService';

/* --------------------------------------------------------------------------
 * Public types
 * -------------------------------------------------------------------------- */

/**
 * A realtime message handler.
 *
 * The payload is `unknown` on purpose. `app/coffee/modules/events.coffee:190`
 * hands the callback `data.data`, whose shape depends entirely on the routing
 * key -- a user-story change carries different fields from a project-attribute
 * change -- so the consumer, which chose the key, is the only code able to
 * narrow it honestly. Typing it as the unsafe escape-hatch type here would
 * silently disable checking at every call site downstream.
 *
 * Handlers are invoked OUTSIDE any AngularJS digest (see section 4 of the file
 * header), so a handler is free to set React state directly and must never try
 * to schedule a digest.
 */
type RealtimeMessageHandler = (data: unknown) => void;

/**
 * Subscribe-time options forwarded verbatim on the `subscribe` wire message.
 *
 * Narrow by design: `selfNotification` is the ONE option any in-scope screen
 * actually uses -- `app/coffee/modules/backlog/main.coffee:280` supplies
 * `{ selfNotification: true }` for the `milestones` subscription created at
 * `:276`. The type is deliberately not widened to an open record until a second
 * real usage is verified, so an unrecognised option is a compile error at the
 * call site rather than a value the server quietly ignores.
 *
 * Declared as a TYPE ALIAS rather than an interface, and that is load-bearing:
 * `$tgEvents.subscribe` types its fourth parameter as an open record
 * (`./useAngularService.ts`, `ResourceParams`), and TypeScript grants an
 * implicit index signature to object type aliases but NOT to interfaces. An
 * interface here would fail to type-check at the `subscribe` call below.
 *
 * Options are read exactly once, when the subscribe command is sent
 * (`app/coffee/modules/events.coffee:211-212`); they are not stored on the
 * subscription at `:200-204`. Prefer a module-level constant -- see section 10
 * of the file header.
 */
type RealtimeSubscriptionOptions = {
    /**
     * Ask the server to deliver changes that this session itself caused, which
     * it otherwise suppresses.
     */
    selfNotification?: boolean;
};

/* --------------------------------------------------------------------------
 * Internals
 * -------------------------------------------------------------------------- */

/**
 * Reduces `options` to a stable primitive suitable for an effect dependency.
 *
 * Two different objects with equal contents must produce the SAME key, so that
 * an inline object literal -- a new identity on every render -- cannot churn the
 * subscription (hazard H2, section 6 of the file header), while a genuine value
 * change still resubscribes with the new wire options.
 *
 * Property order is normalised through the replacer array so that an object
 * literal whose properties happen to be written in a different order still
 * yields the same key. `undefined` in, `undefined` out: "no options" is
 * distinguishable from "empty options", because the service branches on
 * truthiness at `app/coffee/modules/events.coffee:211` and therefore omits the
 * `options` member from the wire message entirely in the first case.
 *
 * @param options - the caller's options object, or `undefined`.
 * @returns a normalised key, or `undefined` when no options were supplied.
 */
function stableOptionsKey(options: RealtimeSubscriptionOptions | undefined): string | undefined {
    if (options === undefined) {
        return undefined;
    }

    return JSON.stringify(options, Object.keys(options).sort());
}

/* --------------------------------------------------------------------------
 * The hook
 * -------------------------------------------------------------------------- */

/**
 * Subscribes to a realtime routing key for as long as the calling component is
 * mounted, and unsubscribes when it unmounts or when the key changes.
 *
 * The React replacement for the AngularJS transformation rule of AAP 0.7.4:
 *
 * ```ts
 * // AngularJS: @events.subscribe @scope, routingKey, (data) => ...
 * // React:
 * useRealtime(routingKey, (data) => {
 *     // `data` is `unknown`; narrow it for the key you subscribed to.
 *     void refresh();
 * });
 * ```
 *
 * With options, hoisted so the reference is stable (section 10 of the file
 * header):
 *
 * ```ts
 * const MILESTONE_OPTIONS = { selfNotification: true } as const;
 *
 * useRealtime(milestonesKey, onMilestoneChange, MILESTONE_OPTIONS);
 * ```
 *
 * Behavioural contract:
 *
 * - **A FALSY KEY SUBSCRIBES TO NOTHING.** The project id is unknown until the
 *   project resolves, and a key composed from an undefined id would subscribe to
 *   a garbage routing key that never delivers. Callers therefore pass `null`,
 *   `undefined` or `''` while the id is pending and the real key once it lands;
 *   the hook itself is still called unconditionally, as React's rules of hooks
 *   require.
 * - **THE SCOPE ARGUMENT IS ALWAYS `null`.** React neither has nor may be given
 *   an AngularJS scope (section 3), so it owns the teardown outright.
 * - **CLEANUP IS ORDERED: DISPOSE, THEN UNSUBSCRIBE**, and `unsubscribe`
 *   receives the routing key and nothing else (sections 5 and 7).
 * - **ONE LIVE CONSUMER PER ROUTING KEY** (section 6). Subscribing the same key
 *   twice in one tree silently breaks the first subscriber.
 * - **THE LATEST HANDLER ALWAYS WINS, WITHOUT RESUBSCRIBING** (section 10).
 * - **NOTHING IS RETURNED.** The subscription has no handle worth exposing: its
 *   lifetime is the effect's. Connection state is read where it is needed,
 *   through `useAngularService('$tgEvents').connected` (section 9).
 * - **NO DIGEST IS EVER TRIGGERED, AND NO TRANSPORT IS EVER CONSTRUCTED**
 *   (sections 4 and 11).
 *
 * Safe under React 18 StrictMode: the development-only mount/unmount/remount
 * cycle unsubscribes and resubscribes the same key in order, leaving exactly one
 * live subscription carrying the current handler.
 *
 * @param routingKey - the routing key to subscribe to, composed by the caller
 *                     from the live project id. Any falsy value means "not yet".
 * @param handler - invoked with each message payload. May be a new inline
 *                  function on every render; the subscription is unaffected.
 * @param options - optional subscribe-time wire options. Pass a stable
 *                  reference; a value change resubscribes, an identity change
 *                  alone does not.
 */
function useRealtime(
    routingKey: string | null | undefined,
    handler: RealtimeMessageHandler,
    options?: RealtimeSubscriptionOptions,
): void {
    // The realtime service, resolved through the single typed accessor. The
    // service is an AngularJS singleton returned by reference, so its identity
    // is stable across renders and safe to list as a dependency below.
    const events = useAngularService('$tgEvents');

    // The handler is held in a ref so the subscribed callback can read the
    // CURRENT one without the subscription depending on the handler's identity
    // (section 10). Seeded with the first render's handler, so it is already
    // correct before any effect has run.
    const handlerRef = useRef<RealtimeMessageHandler>(handler);

    // Kept current in an effect rather than during render: a render may be
    // discarded or replayed under concurrent rendering, and writing a ref then
    // would publish a value from a render that never committed.
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    // `options` needs no ref. The subscribe effect below closes over it, and
    // React always invokes the LATEST render's effect closure when it decides to
    // re-run an effect, so whenever a resubscription happens the fresh object is
    // the one that is read. Deriving the wire value from the closure rather than
    // from a ref removes any dependence on the relative order in which React
    // flushes the two effects in a single commit.
    //
    // The dependency array is therefore exactly [service identity, routing key,
    // normalised options value]. `handler` is deliberately absent (section 10),
    // and `options` enters only through its normalised value so that an inline
    // literal cannot churn the subscription (section 6).
    const optionsKey = stableOptionsKey(options);

    useEffect(() => {
        // "Not yet": the project id has not resolved, so there is no real key to
        // subscribe to and nothing to clean up.
        if (!routingKey) {
            return undefined;
        }

        // Private to THIS effect run, which is what makes it correct when the
        // routing key changes: the outgoing run's cleanup silences only the
        // outgoing run's callback, and the incoming run starts undisposed.
        let disposed = false;

        // Created once per subscription, so its identity is stable for the
        // subscription's whole lifetime, and reading `handlerRef` on each
        // delivery means it can never invoke a stale handler.
        const deliver = (data: unknown): void => {
            // HAZARD H1 (section 5): `unsubscribe` leaves the local subscription
            // entry in place, so `processMessage` can still route a late or
            // in-flight message here after cleanup has run. Returning silently
            // is the difference between a clean unmount and a state write into
            // an unmounted tree.
            if (disposed) {
                return;
            }

            handlerRef.current(data);
        };

        // `null` is the scope, explicitly and always: it is what makes AngularJS
        // skip its automatic teardown at `events.coffee:217`, which is why the
        // cleanup below is mandatory. The fourth argument is forwarded verbatim
        // and is read once, when this command is sent (`:211-212`).
        events.subscribe(null, routingKey, deliver, options);

        return () => {
            // Order is deliberate: silence deliveries FIRST, so no message can
            // slip through between the unsubscribe command and its effect on the
            // server.
            disposed = true;

            // Exactly one argument -- `unsubscribe(routingKey)` (`:219`) has no
            // second parameter, and `options` must never be passed to it
            // (section 7).
            events.unsubscribe(routingKey);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `handler` and the
        // `options` OBJECT are intentionally excluded, and `optionsKey` is
        // intentionally present although the body never reads it; see section 10
        // of the file header. `handler` is reached through a ref, `options` is
        // read from this closure, and `optionsKey` is what carries the options'
        // VALUE -- rather than its identity -- into the dependency array.
    }, [events, routingKey, optionsKey]);
}

export { useRealtime };
export type { RealtimeMessageHandler, RealtimeSubscriptionOptions };
