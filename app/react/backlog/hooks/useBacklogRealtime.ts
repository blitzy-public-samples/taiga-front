/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useBacklogRealtime.ts -- THE BACKLOG SCREEN'S TWO REALTIME SUBSCRIPTIONS
 * ==========================================================================
 *
 * Transformation rule T9 ("Comment every technology-specific change at the
 * point of change, especially at the AngularJS/React seam") governs this file.
 * It sits directly on that seam, so every statement below was verified by
 * reading the cited source in this checkout rather than assumed, and every
 * locator is quoted.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS, AND -- JUST AS IMPORTANT -- WHAT IT IS NOT
 * --------------------------------------------------------------------------
 * The Backlog / Sprint-Planning screen's realtime wiring, and nothing else:
 *
 *     useBacklogRealtime(events.onAngularEvent, {
 *         onUserStoriesChanged: reloadStoriesAndSprints,
 *         onMilestonesChanged: reloadSprintsAndStats,
 *     });
 *
 * AAP 0.5.1 places it at `app/react/backlog/hooks/useBacklogRealtime.ts`
 * beside `useBacklogData.ts`, `useStoryDrag.ts` and `useSprints.ts`, and AAP
 * 0.6.2 sources it from `app/coffee/modules/backlog/main.coffee`.
 *
 * IT OPENS NO SUBSCRIPTION. The RETAINED `BacklogController` is the sole
 * `$tgEvents` owner of both of this screen's routing keys -- section 8 carries
 * the measured reason that is an invariant rather than a preference -- and it
 * re-publishes each RAW payload on its own scope. This hook LISTENS to those
 * two scope events through a registrar the container injects, normally
 * `events.onAngularEvent` from
 * `app/coffee/modules/backlog/react-bridge.coffee`, which is a direct
 * `$scope.$on`. That division is deliberate and load-bearing:
 *
 *   - the RETAINED CONTROLLER owns the mechanics of the two subscriptions --
 *     the routing keys, the wire options, its own reloads, and the automatic
 *     teardown it gets by handing `$tgEvents` a real scope;
 *   - THIS HOOK owns the REACT side of the Backlog screen's realtime contract
 *     -- which two events it listens to, which of the caller's reload actions
 *     each message drives, and the guarantee that neither runs after unmount.
 *
 * `../../bridge/useRealtime.ts` is NOT used here, and that is the whole point
 * of section 8: it remains the sanctioned primitive for a routing key React
 * ever owns OUTRIGHT, and neither migrated screen has one.
 *
 * It performs NO input or output of its own. It opens no connection, sends no
 * request, reads no store and holds no screen state. Every reload is executed
 * by a handler the caller supplies, which is what keeps requirement I7
 * satisfied here: the loads ultimately run through the existing
 * `$tgRepo`/`$tgModel` repository layer, so writes stay dirty-tracked and
 * PATCH only changed fields, and no parallel client is introduced anywhere
 * near this file (rule T5).
 *
 * --------------------------------------------------------------------------
 * 2. THE AUTHORITATIVE SOURCE, QUOTED
 * --------------------------------------------------------------------------
 * `BacklogController.initializeSubscription`, invoked from `loadInitialData`
 * (`app/coffee/modules/backlog/main.coffee:538`), is the complete
 * specification of what this hook subscribes to. Verified verbatim at
 * `app/coffee/modules/backlog/main.coffee:269-280`:
 *
 *     269    initializeSubscription: ->
 *     270        routingKey1 = "<key naming the `userstories` resource>"
 *     271        @events.subscribe @scope, routingKey1, (message) =>
 *     272            @.loadAllPaginatedUserstories()
 *     273            @.loadSprints()
 *     274
 *     275        routingKey2 = "<key naming the `milestones` resource>"
 *     276        @events.subscribe @scope, routingKey2, (message) =>
 *     277            @.loadSprints()
 *     278            @.loadClosedSprints()
 *     279            @.loadProjectStats()
 *     280        , { selfNotification: true }
 *
 * THE TWO KEY EXPRESSIONS ARE ELIDED ABOVE RATHER THAN REPRODUCED, and that is
 * deliberate. Each is a template literal interpolating `@scope.projectId`
 * between two leading literal segments and the resource name -- spelled out
 * once, as fact (5) of section 3, in prose. Eliding them here matches the
 * discipline of `../../bridge/useRealtime.ts`, which spells out no key at all,
 * and it buys a standing audit property: a search of this file for a composed
 * key returns EXACTLY the two constructions in the code below, so "this screen
 * holds two subscriptions and not three" is verifiable mechanically rather
 * than by reading prose.
 *
 * LOCATOR NOTE, so both readings of the repository resolve: this block was at
 * `:223-234` before commit `c221a3d82` ("Retire the AngularJS backlog view
 * layer and its Protractor coverage") shifted it downwards. The AAP and some
 * briefs quote the older numbering. The code is byte-identical under both; the
 * current numbering is used throughout this file because it is what a reader
 * of this checkout will find, and the already-landed sibling
 * `../../bridge/useRealtime.ts` cites it the same way.
 *
 * --------------------------------------------------------------------------
 * 3. THE FIVE FROZEN FACTS (GOAL G2)
 * --------------------------------------------------------------------------
 * Goal G2 freezes the realtime contract: the same resources are subscribed,
 * with the same wire options, driving the same reloads. All five facts survive
 * because the subscriptions themselves are UNCHANGED -- they are still the
 * retained controller's, exactly as quoted above. This hook is held to facts
 * (1), (2) and (3), and facts (4) and (5) are now purely the controller's
 * business:
 *
 *   (1) EXACTLY TWO STREAMS, the `userstories` resource and the `milestones`
 *       resource, so exactly two listeners here. Section 4 explains why that is
 *       a pair rather than the triple the AAP's goal statement lists.
 *   (2) THE `userstories` MESSAGE DRIVES TWO RELOADS -- the paginated story
 *       reload at `:272` (`loadAllPaginatedUserstories`, defined `:381`) then
 *       the open-sprint reload at `:273` (`loadSprints`, defined `:350`).
 *   (3) THE `milestones` MESSAGE DRIVES THREE RELOADS, IN THIS ORDER -- open
 *       sprints at `:277`, closed sprints at `:278` (`loadClosedSprints`,
 *       defined `:327`) and project statistics at `:279` (`loadProjectStats`,
 *       defined `:302`).
 *   (4) `{ selfNotification: true }` IS SUPPLIED TO THE SECOND SUBSCRIPTION
 *       ONLY, as the fourth argument at `:280`. The first subscription at
 *       `:271` passes no options object whatsoever, and the difference is
 *       observable on the wire: the service branches on truthiness at
 *       `app/coffee/modules/events.coffee:211` and omits the `options` member
 *       from the outgoing command entirely when nothing was supplied. Because
 *       the controller still performs both subscribes, this option is inherited
 *       here rather than restated: there is no options object anywhere in this
 *       file, and there must not be one, because a React subscribe is exactly
 *       what section 8 forbids.
 *   (5) EACH KEY IS BUILT FROM FOUR DOT-SEPARATED SEGMENTS -- the literal
 *       `changes`, the literal `project`, the numeric project id, and the
 *       resource name -- interpolated from the live id exactly as `:270` and
 *       `:275` interpolate `@scope.projectId`. No trailing separator, no extra
 *       segment, and no coercion of the id beyond the interpolation itself.
 *
 * The FOUR RELOAD FUNCTIONS ARE NOT THIS HOOK'S CONCERN. They belong to the
 * caller (`useBacklogData.ts` and `useSprints.ts` own the loading), which is
 * why the signature in section 6 takes them as arguments. Two handlers are
 * accepted rather than five callbacks because the grouping IS the contract:
 * the incumbent fires those reloads together, from one callback, per message.
 *
 * --------------------------------------------------------------------------
 * 4. WHY THE RESOURCE SET IS A PAIR, AND WHY THE THIRD ONE IS ABSENT
 * --------------------------------------------------------------------------
 * Goal G2 names three resources -- `userstories`, `milestones` and
 * `projects`. THAT TRIPLE IS THE UNION OF BOTH MIGRATED SCREENS AND NEITHER
 * SCREEN'S OWN SET. Verified per screen, first-hand:
 *
 *   BACKLOG -- `app/coffee/modules/backlog/main.coffee:269`
 *     - `userstories`, key `:270`, subscribed `:271`, no options
 *     - `milestones`, key `:275`, subscribed `:276`, WITH the options object
 *       at `:280`
 *     - the project-attributes resource is NOT subscribed.
 *
 *   KANBAN -- `app/coffee/modules/kanban/main.coffee:341`
 *     - `userstories`, key `:345`, subscribed `:346`
 *     - the project-attributes resource, key `:350`, subscribed `:351`
 *     - `milestones` is NOT subscribed
 *     - both of its callbacks are wrapped in a leading-edge debounce over a
 *       random 700-1000 ms interval seeded at `:342`. THAT DEBOUNCE BELONGS TO
 *       THE KANBAN CALLER, never to a shared hook: debouncing here would
 *       silently retime delivery for the Backlog too.
 *
 * So adding a third subscription to this hook would create a subscription the
 * incumbent never makes. It would generate server traffic no Backlog session
 * generates today and -- by hazard H2, section 8 -- would silently steal the
 * Kanban screen's project-attributes stream the moment both screens ever
 * mounted together. It is a feature addition, which rule T10 forbids
 * outright, and it is not added.
 *
 * --------------------------------------------------------------------------
 * 5. WHY TEARDOWN IS STILL OURS, EVEN THOUGH THE SUBSCRIPTION IS NOT
 *    (AAP 0.6.3, ITEM 8)
 * --------------------------------------------------------------------------
 * AAP 0.6.3 item 8, verbatim:
 *
 *     "Realtime subscription cleanup. `useRealtime` passes a null scope and
 *      calls `unsubscribe(routingKey)` in its `useEffect` cleanup. This is the
 *      single easiest place in the migration to leak, and the leak is silent
 *      -- it manifests only as duplicate refreshes after navigating away and
 *      back."
 *
 * The proof is one line. `subscribe` ends with
 * `app/coffee/modules/events.coffee:217`:
 *
 *     scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope
 *
 * The trailing `if scope` guard is the whole argument. AngularJS registers its
 * automatic teardown ONLY when a scope was supplied, which is exactly why the
 * retained controller at `:271` and `:276` can subscribe and forget -- it hands
 * over its own scope, and its subscriptions die with it. React has no scope and
 * must never be given one, which is the second reason this hook listens rather
 * than subscribes: what it holds is not a subscription but two scope listeners,
 * and `$scope.$on` hands back a deregistration function.
 *
 * "Silent" is the operative word, and it is why this file is written the way it
 * is. A leaked LISTENER throws nothing, logs nothing, and passes every test that
 * mounts a screen once. It surfaces as a Backlog that reloads twice, then three
 * times, then four, as a user walks between Backlog and Kanban -- attributed,
 * when someone finally notices, to the reload code rather than to the listener
 * that was never released. So the effect below calls BOTH deregistration
 * functions unconditionally, and its co-located spec asserts that it does.
 *
 * --------------------------------------------------------------------------
 * 6. HAZARD H1 -- A DELIVERY CAN STILL ARRIVE DURING TEARDOWN
 * --------------------------------------------------------------------------
 * `unsubscribe` (`app/coffee/modules/events.coffee:219-230`) does exactly one
 * thing: it sends `{"cmd": "unsubscribe", "routing_key": routingKey}`. It never
 * removes the local registry entry written at `:214`, so a message already in
 * flight -- or one the server dispatches before it has processed the command --
 * still finds that entry at `:180` and still reaches `:190`. That is the
 * controller's exposure now, and it is PRESERVED, NOT PATCHED:
 * `app/coffee/modules/events.coffee` is reference-only in this migration, a
 * service the whole application shares, and adding a registry deletion there
 * would change behaviour for every AngularJS consumer of it.
 *
 * The React-side consequence is narrower but real: a broadcast can be delivered
 * to a listener in the same digest in which React is unmounting, and a caller's
 * handler must never run after this hook has torn down. THE LIFECYCLE GUARD
 * answers that -- a ref, armed on mount and set in a cleanup that React runs
 * BEFORE the listeners are released, because cleanups run in the order their
 * effects were created and the guard's effect is created first. While it is set,
 * neither deliverer touches the caller's handlers at all.
 *
 * The guard is not redundant with deregistration. It is what makes the invariant
 * "the caller's handlers are never invoked after this hook unmounts" a property
 * of THIS file, provable by its own co-located spec, instead of a property
 * inherited from AngularJS's listener bookkeeping.
 *
 * --------------------------------------------------------------------------
 * 7. DELIVERY ARRIVES INSIDE A DIGEST, AND NOTHING HERE DRIVES ONE
 * --------------------------------------------------------------------------
 * `processMessage` (`app/coffee/modules/events.coffee:177-190`) branches on the
 * stored scope:
 *
 *     if subscription.scope             # :185
 *         subscription.scope.$apply ->  # :186  <- the retained controller
 *             subscription.callback(data.data)
 *     else                              # :189
 *         subscription.callback(data.data)  # :190  <- a null-scope consumer
 *
 * The controller supplies a real scope, so delivery takes the `:185-187` branch
 * and its callback -- including the re-publishing broadcast this hook listens
 * for -- runs INSIDE a digest. A React state update made from there is
 * perfectly ordinary: React schedules its own render and React 18's automatic
 * batching coalesces the updates.
 *
 * What must NOT happen is React driving a digest of its own. AAP 0.7.4 makes
 * that a prohibition rather than a preference, and nothing in this file calls
 * any digest driver: the payload reaches it as two plain callback arguments. The
 * formal reason none is needed elsewhere either is that the AngularJS HTTP
 * provider is configured with `useApplyAsync(true)` at
 * `app/coffee/app.coffee:604`, so responses arriving on the shared transport
 * schedule their own. Where a caller's handler ultimately calls into an
 * AngularJS function, that function manages its own digest.
 *
 * --------------------------------------------------------------------------
 * 8. HAZARD H2 -- ONE LIVE CONSUMER PER RESOURCE KEY
 * --------------------------------------------------------------------------
 * `subscribe` stores its subscription into `@.subscriptions[routingKey]` at
 * `app/coffee/modules/events.coffee:214` -- ONE flat map keyed by the routing
 * key across the entire application. Two consequences follow:
 *
 *   - a second subscribe to the same key SILENTLY CLOBBERS the first
 *     callback, and the first consumer simply stops receiving messages;
 *   - either consumer's `unsubscribe` kills the server-side subscription for
 *     BOTH, because the wire command carries only the key.
 *
 * ⭐ THAT IS WHY THIS HOOK SUBSCRIBES TO NOTHING. The retained
 * `BacklogController` already owns both of this screen's keys, and it is not
 * going anywhere: it is still the data, permission and write layer that feeds
 * this screen. A React subscription to `…userstories` or `…milestones` would
 * OVERWRITE the controller's callback -- the screen would silently stop
 * reloading -- and whichever side unmounted first would take the shared
 * server-side subscription down with it. Neither failure raises anything.
 *
 * The resolution is the one the seam already provides: the controller
 * re-publishes each raw payload on its scope and React LISTENS. One `$tgEvents`
 * subscription per key, one AngularJS owner, and as many React listeners as the
 * screen needs -- scope listeners are an array push, so several are cheap and
 * none can displace another.
 *
 * The Kanban screen owns a `userstories` key built the same way, through its own
 * retained controller. The two screens are separate routes
 * (`app/coffee/app.coffee:228` and `:237`) and never mount together, so that
 * overlap is not a practical conflict; it is preserved rather than "fixed",
 * because deduplicating subscriptions across screens would be new behaviour,
 * which rule T10 forbids.
 *
 * --------------------------------------------------------------------------
 * 9. WHAT THIS HOOK DELIBERATELY DOES NOT DO (RULE T10)
 * --------------------------------------------------------------------------
 *   - NO CONNECTION LIFECYCLE. No transport is constructed, no heartbeat is
 *     scheduled, no timer is started, and no retry is attempted. All of it
 *     lives in `app/coffee/modules/events.coffee` and stays there.
 *   - NO RE-SUBSCRIPTION AFTER A DROPPED CONNECTION. `onOpen`
 *     (`app/coffee/modules/events.coffee:235-250`) marks the service up at
 *     `:236` and restores only the auth message, the heartbeat and the three
 *     global subscriptions at `:248-250`; it does NOT restore project-scoped
 *     keys. Both commands this hook's subscriptions send are nonetheless
 *     buffered while the connection is down and flushed when it returns,
 *     because `sendMessage` (`:165-176`) queues into `@.pendingMessages`.
 *     Adding key restoration here would be a new feature.
 *   - NO READ OF THE SERVICE'S `connected` FLAG (declared
 *     `app/coffee/modules/events.coffee:23`, set `:236`, cleared `:274`). It
 *     is read at exactly ONE site in the whole repository, and that site is
 *     not this one: `app/coffee/modules/backlog/main.coffee:715` guards the
 *     post-drag fallback that reloads open sprints (`:716`), closed sprints
 *     (`:717`) and project statistics (`:718`) when realtime is down. That
 *     belongs to `./useStoryDrag.ts`, because it is a consequence of
 *     completing a drag rather than of subscribing. Should a caller ever need
 *     the flag, it must be read AT CALL TIME through
 *     `useAngularService('$tgEvents').connected` -- never captured at render,
 *     never mirrored into React state, and never placed in a dependency
 *     array, because a stale read makes the fallback fire on the wrong
 *     information.
 *   - NO DEBOUNCE, NO THROTTLE, NO DEDUPLICATION, NO RETRY on realtime
 *     refreshes. The incumbent Backlog applies none (contrast the Kanban
 *     caller's own debounce at `app/coffee/modules/kanban/main.coffee:342`),
 *     so applying one here would change refresh timing that users and the
 *     server both observe.
 *   - NO RETURN VALUE. There is no handle worth exposing: each subscription's
 *     lifetime is its effect's.
 *
 * --------------------------------------------------------------------------
 * 10. CONSTRAINTS THIS FILE IS HELD TO
 * --------------------------------------------------------------------------
 * Rule T5 -- reuse the existing repository layer; build no parallel HTTP
 * client. This file constructs no transport whatsoever and issues no request:
 * it delegates every load to the caller's handlers.
 *
 * Rule T8 -- new code is isolated under `app/react/**`. This task adds this
 * module and its co-located spec, and edits nothing else, inside this folder
 * or outside it. No barrel module is introduced; consumers import by path.
 *
 * Requirement I9 -- realtime lives in a hook precisely so the browserless
 * jsdom suite can exercise it. Handlers are injected as arguments rather than
 * resolved internally, which keeps this module free of a dependency on
 * `./useBacklogData.ts`, rules out an import cycle between them, and makes
 * the whole contract assertable with two test doubles and no browser. That is
 * what makes goal G4's coverage gate reachable here rather than aspirational.
 *
 * Strict typing -- `tsconfig.json` sets `strict: true` with no per-flag
 * opt-outs, plus `noUnusedLocals`, `noUnusedParameters` and `isolatedModules`.
 * The only import below is `react` itself: this hook resolves no service, holds
 * no transport type and therefore needs nothing from the bridge folder. The
 * registrar's shape is declared here, structurally, so any `$scope.$on`-shaped
 * function satisfies it -- the bridge payload's `events.onAngularEvent` in the
 * browser, a recording stub in the browserless suite.
 * ========================================================================== */

import { useCallback, useEffect, useRef } from 'react';

/* --------------------------------------------------------------------------
 * Public constants
 * -------------------------------------------------------------------------- */

/**
 * The AngularJS scope event on which the retained controller re-publishes every
 * RAW payload delivered on this screen's `userstories` routing key.
 *
 * Broadcast by `initializeSubscription` in
 * `app/coffee/modules/backlog/main.coffee`, immediately AFTER the controller's
 * own two reloads, so the ordering the incumbent guarantees between them is
 * untouched.
 */
export const BACKLOG_REALTIME_USERSTORIES_EVENT = 'backlog:realtime:userstories';

/**
 * The AngularJS scope event on which the retained controller re-publishes every
 * RAW payload delivered on this screen's `milestones` routing key -- the
 * subscription that carries `{ selfNotification: true }`, which is inherited
 * here rather than restated (section 3, fact 4).
 */
export const BACKLOG_REALTIME_MILESTONES_EVENT = 'backlog:realtime:milestones';

/* --------------------------------------------------------------------------
 * Public types
 * -------------------------------------------------------------------------- */

/** One of the two scope events the retained controller re-publishes on. */
export type BacklogRealtimeEventName =
    | typeof BACKLOG_REALTIME_USERSTORIES_EVENT
    | typeof BACKLOG_REALTIME_MILESTONES_EVENT;

/**
 * The teardown function a registration hands back.
 *
 * `$scope.$on` returns exactly this, and the effect below calls both of the ones
 * it holds on cleanup. Section 5 explains why leaving one uncalled leaks
 * silently.
 */
export type BacklogRealtimeEventDeregistrar = () => void;

/**
 * Registers a listener for one of the two controller-published events and
 * returns its deregistration function.
 *
 * This is the whole of the AngularJS seam, injected by the container rather than
 * resolved here, so this hook touches no injector, no `$scope` and no service.
 * The natural implementation is the bridge payload's own
 * `events.onAngularEvent`, which is a direct `$scope.$on` on the retained
 * controller's scope; a spec satisfies it with a stub that records the handler.
 *
 * ⭐ THE LISTENER IS PAYLOAD-ONLY, AND THAT IS THE BRIDGE'S CONTRACT RATHER THAN
 * A SIMPLIFICATION OF IT. `$scope.$on` does invoke its own listener as
 * `(event, payloadArgs…)`, but the bridge does not hand a React handler to
 * `$scope.$on` directly -- it wraps it, DROPS the AngularJS event object and
 * forwards only the payload arguments
 * (`app/coffee/modules/backlog/react-bridge.coffee`, `registerAngularEvent`).
 * Dropping the event object is deliberate and load-bearing: that object carries
 * `targetScope` and `currentScope`, so forwarding it would put a live `$scope` on
 * the React side of the seam.
 *
 * The payload therefore arrives as ARGUMENT 1. Declaring `(event, message)` here
 * would be a two-position lie, and a costly one PRECISELY BECAUSE neither
 * deliverer in this file reads an argument today (section 3): nothing would break
 * now, and the contract would quietly direct the first consumer that DOES need a
 * payload to read argument 2 and find `undefined` on every message. The type is
 * spelled payload-only so the compiler makes that mistake unexpressible.
 */
export type BacklogRealtimeEventRegistrar = (
    eventName: BacklogRealtimeEventName,
    handler: (message: unknown) => void,
) => BacklogRealtimeEventDeregistrar;

/**
 * What the caller must do when each of the Backlog's two realtime resources
 * reports a change.
 *
 * TWO MEMBERS, NOT FIVE, because the grouping IS the frozen contract: the
 * incumbent fires its reloads together, from one callback, per message
 * (`app/coffee/modules/backlog/main.coffee:271-273` and `:276-279`). Splitting
 * them into one callback per reload would let a caller wire up three of the
 * five reloads and still type-check, while grouping them makes a partial
 * wiring impossible to express.
 *
 * Both members are synchronous `void` returns. A handler that starts an
 * asynchronous reload simply does not return its promise -- exactly as the
 * incumbent callbacks discard the promises returned by their loaders -- because
 * nothing in the realtime path awaits, retries or reports a rejected reload.
 * Preserving that means preserving error handling too: a failed reload surfaces
 * through the existing repository-layer interceptors, not through this seam.
 */
export interface BacklogRealtimeHandlers {
    /**
     * Invoked for each message on the `userstories` resource.
     *
     * ⚠ IT MUST NOT REPEAT THE INCUMBENT'S RELOADS. The retained controller has
     * ALREADY issued both of them, in order, in the same digest -- the paginated
     * story reload at `app/coffee/modules/backlog/main.coffee:272`
     * (`loadAllPaginatedUserstories`, defined `:381`) followed by the open-sprint
     * reload at `:273` (`loadSprints`, defined `:350`) -- and only then does it
     * broadcast the event this handler is invoked from. Sprints are reloaded
     * alongside the stories because a story that moved into or out of a sprint
     * changes that sprint's own totals. Calling either loader again through the
     * bridge would double every realtime refresh, which is server traffic no
     * session generates today (rule T10).
     *
     * What it IS for: bringing the React tree into step with the controller's
     * refreshed state. Those reloads are asynchronous, so a container that needs
     * the settled data reads it when the controller announces it -- the same
     * registrar also carries `userstories:loaded`
     * (`app/coffee/modules/backlog/main.coffee:317`, `:468`) and
     * `sprints:loaded` (`:389`) -- while this event is the earliest possible
     * signal that a change arrived at all.
     */
    readonly onUserStoriesChanged: () => void;

    /**
     * Invoked for each message on the `milestones` resource.
     *
     * ⚠ Same prohibition, same reason. The retained controller has already
     * issued all THREE reloads, in order: open sprints at
     * `app/coffee/modules/backlog/main.coffee:277`, closed sprints at `:278`
     * (`loadClosedSprints`, defined `:327`) and project statistics at `:279`
     * (`loadProjectStats`, defined `:302`, which also recomputes the completed
     * percentage and the velocity forecast). The completion announcements a
     * container can read instead are `sprints:loaded` (`:389`) and
     * `closed-sprints:reloaded` (`:342`, `:358`).
     */
    readonly onMilestonesChanged: () => void;
}

/* --------------------------------------------------------------------------
 * The hook
 * -------------------------------------------------------------------------- */

/**
 * Keeps the React Backlog / Sprint-Planning screen in step with its two realtime
 * streams for as long as the calling component is mounted, and releases both
 * listeners when it unmounts.
 *
 * The React half of `BacklogController.initializeSubscription`
 * (`app/coffee/modules/backlog/main.coffee:269-280`); the subscribing half stays
 * in that controller, which owns both routing keys (section 8):
 *
 * ```ts
 * // AngularJS: @events.subscribe @scope, routingKey1, (message) => ...
 * //            ... then @scope.$broadcast("backlog:realtime:userstories", message)
 * // React:
 * useBacklogRealtime(events.onAngularEvent, {
 *     onUserStoriesChanged: syncStoriesAndSprints,
 *     onMilestonesChanged: syncSprintsAndStats,
 * });
 * ```
 *
 * Behavioural contract:
 *
 * - **EXACTLY TWO SUBSCRIPTIONS**, for the `userstories` and `milestones`
 *   resources (section 3 of the file header). The project-attributes resource
 *   belongs to the Kanban screen and is deliberately absent (section 4).
 * - **IT SUBSCRIBES TO NOTHING.** The retained controller is the sole
 *   `$tgEvents` owner of both routing keys, and there is deliberately no
 *   `projectId` parameter: the keys are composed and owned there (section 8).
 * - **THE LATEST HANDLERS ALWAYS WIN, WITHOUT RE-REGISTERING.** A caller may
 *   pass a fresh object literal on every render; it is read through a ref, so
 *   the two listeners are untouched by the caller's rendering (section 6).
 * - **AFTER UNMOUNT, NEITHER HANDLER IS EVER INVOKED AGAIN**, even for a
 *   delivery already in flight (hazard H1, section 6).
 * - **BOTH LISTENERS ARE RELEASED ON CLEANUP** (section 5).
 * - **NOTHING IS RETURNED, AND NOTHING IS LOADED HERE** (sections 1 and 9).
 *
 * Safe under React 18 StrictMode: its development-only mount / unmount / remount
 * cycle releases and retakes the same two listeners in order, re-arming the
 * lifecycle guard on the way back in, and leaves exactly one live listener per
 * stream.
 *
 * @param registerAngularEvent - how to register a listener on the retained
 *                    controller's scope; normally `events.onAngularEvent` from
 *                    the bridge payload.
 * @param handlers - what to do when each stream reports a change. May be a fresh
 *                   object on every render.
 */
export function useBacklogRealtime(
    registerAngularEvent: BacklogRealtimeEventRegistrar,
    handlers: BacklogRealtimeHandlers,
): void {
    // A message can arrive after this screen has gone: the handlers reload the backlog, so
    // delivering one post-unmount would fetch into a dead component. The cancellation flag is
    // checked at delivery, and the handlers themselves are held in a ref so that a parent
    // re-rendering with fresh closures does not resubscribe and lose queued messages.
    const cancelledRef = useRef<boolean>(false);

    useEffect(() => {
        cancelledRef.current = false;

        return () => {
            cancelledRef.current = true;
        };
    }, []);

    const handlersRef = useRef<BacklogRealtimeHandlers>(handlers);

    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    const deliverUserStoriesChange = useCallback((): void => {
        if (cancelledRef.current) {
            return;
        }

        handlersRef.current.onUserStoriesChanged();
    }, []);

    const deliverMilestonesChange = useCallback((): void => {
        if (cancelledRef.current) {
            return;
        }

        handlersRef.current.onMilestonesChanged();
    }, []);

    // ------------------------------------------------------------------
    // THE SEAM ITSELF (section 8), and the only place this file touches
    // AngularJS: two listeners on the retained controller's scope, and the two
    // deregistration functions it handed back, called on cleanup.
    //
    // Registration is a single effect rather than one per stream, because the two
    // listeners share one lifetime exactly: they are taken together, released
    // together, and there is no key, id or option that could ever move one
    // without moving the other. Its dependency list is the registrar and the two
    // stable deliverers, so an ordinary re-render never touches either listener.
    //
    // Neither listener DECLARES an argument, because neither deliverer consults
    // one (see above) and a zero-argument function satisfies the registrar's
    // one-argument listener type. The type itself spells that one argument out as
    // the PAYLOAD, because the bridge strips AngularJS's event object before
    // calling back, so a future listener which does need the payload reads it from
    // the first position and gets the real thing.
    // ------------------------------------------------------------------
    useEffect(() => {
        const deregisterUserStories = registerAngularEvent(
            BACKLOG_REALTIME_USERSTORIES_EVENT,
            (): void => {
                deliverUserStoriesChange();
            },
        );

        const deregisterMilestones = registerAngularEvent(
            BACKLOG_REALTIME_MILESTONES_EVENT,
            (): void => {
                deliverMilestonesChange();
            },
        );

        return () => {
            deregisterUserStories();
            deregisterMilestones();
        };
    }, [registerAngularEvent, deliverUserStoriesChange, deliverMilestonesChange]);
}
