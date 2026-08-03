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
 *     useBacklogRealtime(projectId, {
 *         onUserStoriesChanged: reloadStoriesAndSprints,
 *         onMilestonesChanged: reloadSprintsAndStats,
 *     });
 *
 * AAP 0.5.1 places it at `app/react/backlog/hooks/useBacklogRealtime.ts`
 * beside `useBacklogData.ts`, `useStoryDrag.ts` and `useSprints.ts`, and AAP
 * 0.6.2 sources it from `app/coffee/modules/backlog/main.coffee`.
 *
 * IT COMPOSES THE GENERIC PRIMITIVE `../../bridge/useRealtime`; it does not
 * replace it, wrap it in a second abstraction, or reimplement it. That
 * division is deliberate and load-bearing:
 *
 *   - the PRIMITIVE owns the mechanics of one subscription -- resolving
 *     `$tgEvents` through the typed accessor, passing the literal `null`
 *     scope, holding the handler in a ref, and tearing the subscription down
 *     in its own effect cleanup;
 *   - THIS HOOK owns the Backlog screen's frozen realtime CONTRACT -- which
 *     resources it listens to, which wire options each subscription carries,
 *     and which of the caller's reload actions each message drives.
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
 * with the same wire options, driving the same reloads. Reproduced exactly:
 *
 *   (1) EXACTLY TWO SUBSCRIPTIONS, for the `userstories` resource and the
 *       `milestones` resource. Section 4 explains why that is a pair rather
 *       than the triple the AAP's goal statement lists.
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
 *       from the outgoing command entirely when nothing was supplied. Passing
 *       the object to both subscriptions, or dropping it from the second,
 *       silently changes which pushes the server delivers -- a breach of goal
 *       G2 and of rule T10.
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
 * 5. WHY TEARDOWN IS OURS: THE NULL SCOPE (AAP 0.6.3, ITEM 8)
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
 * automatic teardown ONLY when a scope was supplied, which is why the
 * surviving controller at `:271` and `:276` can subscribe and forget -- it
 * hands over its own scope. React has no scope and must never be given one,
 * so the primitive passes the literal `null`, the guard is false, and NOTHING
 * unsubscribes on its own. The primitive's effect cleanup is the only teardown
 * that exists.
 *
 * Subscribing with a null scope is established house style rather than a novel
 * usage: the service itself does it at `app/coffee/modules/events.coffee:73`
 * (announcements), `:83` (desktop notifications) and `:115` (web
 * notifications). Each of those is a process-lifetime subscription that is
 * never torn down, which is exactly why none of them had to solve the problem
 * this seam solves.
 *
 * "Silent" is the operative word, and it is why this file is written the way
 * it is. A leaked subscription throws nothing, logs nothing, and passes every
 * test that mounts a screen once. It surfaces as a Backlog that reloads twice,
 * then three times, then four, as a user walks between Backlog and Kanban --
 * attributed, when someone finally notices, to the reload code rather than to
 * the subscription that was never released.
 *
 * --------------------------------------------------------------------------
 * 6. HAZARD H1 -- UNSUBSCRIBING DOES NOT FORGET THE CALLBACK
 * --------------------------------------------------------------------------
 * `unsubscribe` (`app/coffee/modules/events.coffee:219-230`) does exactly one
 * thing: it sends `{"cmd": "unsubscribe", "routing_key": routingKey}`. It
 * never removes the local registry entry written at `:214`. A message already
 * in flight -- or one the server dispatches before it has processed the
 * command -- therefore still finds that entry at `:180`, still reaches `:190`,
 * and still invokes the stored callback AFTER React's cleanup has run.
 *
 * THIS DEFECT IS PRESERVED, NOT PATCHED. `app/coffee/modules/events.coffee` is
 * reference-only in this migration: it is a service the whole application
 * shares, and adding a registry deletion there would change behaviour for
 * every AngularJS consumer of it. The Minimal Change Clause forbids that, so
 * the mitigation belongs on the React side of the seam, which is here.
 *
 * Two guards answer it, at two different levels, and both are wanted:
 *
 *   - THE PRIMITIVE'S PER-SUBSCRIPTION FLAG. Each of its effect runs owns a
 *     private boolean that its cleanup sets BEFORE calling `unsubscribe`, so a
 *     late delivery on that one subscription becomes a no-op.
 *   - THIS HOOK'S OWN LIFECYCLE GUARD. A ref, armed on mount and set in a
 *     cleanup that React runs BEFORE either subscription is torn down --
 *     because cleanups run in the order their effects were created, and the
 *     guard's effect is created before both `useRealtime` calls below. While
 *     it is set, neither deliverer touches the caller's handlers at all.
 *
 * The second guard is not redundant. It is what makes the invariant "the
 * caller's handlers are never invoked after this hook unmounts" a property of
 * THIS file, provable by its own co-located spec, instead of a property
 * inherited from another file's internals.
 *
 * --------------------------------------------------------------------------
 * 7. DELIVERY RUNS WITH NO DIGEST CYCLE AROUND IT
 * --------------------------------------------------------------------------
 * A correction to a common misreading of this seam, recorded so it is not
 * re-introduced. `processMessage`
 * (`app/coffee/modules/events.coffee:177-190`) branches on the stored scope:
 *
 *     if subscription.scope             # :185
 *         subscription.scope.$apply ->  # :186  <- AngularJS consumers
 *             subscription.callback(data.data)
 *     else                              # :189
 *         subscription.callback(data.data)  # :190  <- this seam's callback
 *
 * With a null scope, delivery takes the `:189-190` branch, so the handlers
 * this hook drives run OUTSIDE the AngularJS digest -- they are NOT already
 * inside one, as the shape of `:186` might suggest at a glance.
 *
 * That changes nothing about what this file does. It sets React state through
 * the caller's handlers, React schedules its own render, and React 18's
 * automatic batching coalesces the updates. Digest cycles remain AngularJS's
 * concern and are never forced from React code (AAP 0.7.4 makes that a
 * prohibition, not a preference); the formal reason none is needed is that the
 * AngularJS HTTP provider is configured with `useApplyAsync(true)` at
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
 * So "one live consumer per key" is an INVARIANT THIS HOOK UPHOLDS rather
 * than a problem it engineers around: it creates EXACTLY ONE subscription per
 * resource, never two, and it is mounted once per Backlog screen. The Kanban
 * screen subscribes to a `userstories` key built the same way, but the two
 * screens are separate routes (`app/coffee/app.coffee:228` and `:237`) and
 * never mount together, so that overlap is not a practical conflict. It is
 * likewise preserved rather than "fixed" -- deduplicating subscriptions across
 * screens would be new behaviour, which rule T10 forbids.
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
 * opt-outs, plus `noUnusedLocals`, `noUnusedParameters` and
 * `isolatedModules`. There is no `baseUrl` and no `paths`, so both imports
 * below are relative; the options type is IMPORTED from the primitive rather
 * than redeclared, because the primitive declares it as a type alias
 * deliberately -- an interface would not satisfy the open-record parameter
 * that `$tgEvents.subscribe` types its fourth argument as.
 * ========================================================================== */

import { useCallback, useEffect, useRef } from 'react';

import { useRealtime } from '../../bridge/useRealtime';
import type { RealtimeSubscriptionOptions } from '../../bridge/useRealtime';

/* --------------------------------------------------------------------------
 * Wire options
 * -------------------------------------------------------------------------- */

/**
 * The subscribe-time wire options carried by the `milestones` subscription, and
 * by that subscription ALONE.
 *
 * Reproduces the fourth argument supplied at
 * `app/coffee/modules/backlog/main.coffee:280` (`:234` before the view-layer
 * retirement commit). `selfNotification` asks the server to deliver milestone
 * changes that this very session caused, which it otherwise suppresses -- and
 * the Backlog needs them, because a sprint edit made here has to refresh the
 * closed-sprint list and the project statistics too.
 *
 * HOISTED TO MODULE SCOPE ON PURPOSE, for three reasons:
 *
 *   1. One reference exists for the process's whole lifetime, so the object can
 *      never be the cause of a resubscription. The primitive already guards
 *      against identity churn by deriving a normalised value from the object's
 *      contents rather than depending on the object itself, so an inline
 *      literal would in fact be harmless -- but relying on another module's
 *      internal defence to keep this one correct is exactly the kind of
 *      coupling that breaks quietly later.
 *   2. It states the intent where a reader will look: there is ONE options
 *      object in this screen's contract, and it belongs to ONE subscription.
 *   3. It cannot be recreated by mistake inside a branch, which is how the
 *      object ends up attached to the wrong key.
 *
 * The type is IMPORTED from the primitive rather than redeclared, so a change
 * to the accepted option set is a compile error here instead of a value the
 * server quietly ignores.
 */
const MILESTONES_SUBSCRIBE_OPTIONS: RealtimeSubscriptionOptions = {
    selfNotification: true,
};

/* --------------------------------------------------------------------------
 * Public types
 * -------------------------------------------------------------------------- */

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
     * Must drive the incumbent's TWO reloads, in order: the paginated story
     * reload at `app/coffee/modules/backlog/main.coffee:272`
     * (`loadAllPaginatedUserstories`, defined `:381`) followed by the
     * open-sprint reload at `:273` (`loadSprints`, defined `:350`). Sprints are
     * reloaded alongside the stories because a story that moved into or out of
     * a sprint changes that sprint's own totals.
     */
    readonly onUserStoriesChanged: () => void;

    /**
     * Invoked for each message on the `milestones` resource.
     *
     * Must drive the incumbent's THREE reloads, in order: open sprints at
     * `app/coffee/modules/backlog/main.coffee:277`, closed sprints at `:278`
     * (`loadClosedSprints`, defined `:327`) and project statistics at `:279`
     * (`loadProjectStats`, defined `:302`, which also recomputes the completed
     * percentage and the velocity forecast).
     */
    readonly onMilestonesChanged: () => void;
}

/* --------------------------------------------------------------------------
 * The hook
 * -------------------------------------------------------------------------- */

/**
 * Subscribes the Backlog / Sprint-Planning screen to its two realtime
 * resources for as long as the calling component is mounted, and releases both
 * when it unmounts or when the project changes.
 *
 * The React replacement for `BacklogController.initializeSubscription`
 * (`app/coffee/modules/backlog/main.coffee:269-280`), and the whole of it:
 *
 * ```ts
 * // AngularJS: @events.subscribe @scope, routingKey1, (message) => ...
 * // React:
 * useBacklogRealtime(projectId, {
 *     onUserStoriesChanged: reloadStoriesAndSprints,
 *     onMilestonesChanged: reloadSprintsAndStats,
 * });
 * ```
 *
 * Behavioural contract:
 *
 * - **EXACTLY TWO SUBSCRIPTIONS**, for the `userstories` and `milestones`
 *   resources, with the options object on the second alone (section 3 of the
 *   file header). The project-attributes resource belongs to the Kanban screen
 *   and is deliberately absent (section 4).
 * - **A FALSY `projectId` SUBSCRIBES TO NOTHING.** The id is unknown until the
 *   project resolves, and a key built from an unresolved id would name a
 *   routing key that never delivers. Both `useRealtime` calls are still made
 *   unconditionally, as React's rules of hooks require; the primitive's own
 *   early return does the rest. This truthiness test is behavioural parity, not
 *   a stylistic choice -- the incumbent loader guards itself the same way, with
 *   `return null if !@scope.projectId` at
 *   `app/coffee/modules/backlog/main.coffee:388`.
 * - **CHANGING `projectId` MOVES BOTH SUBSCRIPTIONS**, releasing the old keys
 *   before taking the new ones.
 * - **THE LATEST HANDLERS ALWAYS WIN, WITHOUT RESUBSCRIBING.** A caller may
 *   pass a fresh object literal on every render; it is read through a ref, so
 *   the subscriptions are untouched by the caller's rendering (section 6).
 * - **AFTER UNMOUNT, NEITHER HANDLER IS EVER INVOKED AGAIN**, even though the
 *   service keeps its registry entry after unsubscribing (hazard H1,
 *   section 6).
 * - **NOTHING IS RETURNED, AND NOTHING IS LOADED HERE** (sections 1 and 9).
 *
 * Safe under React 18 StrictMode: its development-only mount / unmount /
 * remount cycle releases and retakes the same two keys in order, re-arming the
 * lifecycle guard on the way back in, and leaves exactly one live subscription
 * per resource.
 *
 * @param projectId - the live project id. A falsy value means "not resolved
 *                    yet" and subscribes to nothing.
 * @param handlers - the reload actions each resource's messages drive. May be a
 *                   fresh object on every render.
 */
export function useBacklogRealtime(
    projectId: number | null | undefined,
    handlers: BacklogRealtimeHandlers,
): void {
    // ------------------------------------------------------------------
    // The lifecycle guard -- hazard H1 (section 6 of the file header).
    //
    // Declared FIRST, before the two `useRealtime` calls at the end of this
    // hook, and that ordering is the mechanism rather than a formatting
    // preference: React runs a component's effect cleanups in the order their
    // effects were created, so this cleanup is guaranteed to have run before
    // either subscription is released. A message the service dispatches into a
    // stale registry entry after teardown therefore finds both deliverers
    // already silenced.
    // ------------------------------------------------------------------
    const cancelledRef = useRef<boolean>(false);

    useEffect(() => {
        // Re-armed on every mount rather than only at initialisation: React 18
        // StrictMode remounts a component onto the SAME ref object in
        // development, so a guard that was set during the first cleanup would
        // otherwise stay set and silently swallow every message of the second
        // mount -- a failure that appears only in development and looks exactly
        // like a broken server.
        cancelledRef.current = false;

        return () => {
            cancelledRef.current = true;
        };
    }, []);

    // ------------------------------------------------------------------
    // The handlers ref.
    //
    // Callers pass an object literal, which is a new identity on every render.
    // Holding it in a ref decouples the subscriptions' lifetime from the
    // caller's rendering entirely, so no call site has to remember to memoise
    // anything for the subscriptions to stay put -- forgetting that would be
    // invisible, and by hazard H2 (section 8) a resubscription storm is
    // destructive rather than merely wasteful.
    //
    // Seeded with the first render's value so it is already correct before the
    // effects run, and republished from an effect rather than during render:
    // under concurrent rendering a render may be discarded or replayed, and
    // writing a ref then would publish a value from a render that never
    // committed.
    // ------------------------------------------------------------------
    const handlersRef = useRef<BacklogRealtimeHandlers>(handlers);

    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    // ------------------------------------------------------------------
    // The two deliverers.
    //
    // Stable for the component's whole lifetime -- empty dependency lists, and
    // every varying value reached through a ref. Each reads the CURRENT
    // handlers, so it can never invoke a stale closure.
    //
    // Neither declares a parameter. The service hands the callback the message
    // payload (`app/coffee/modules/events.coffee:190`), and the incumbent
    // callbacks name it and then never consult it -- the arrival of a message
    // is the entire signal, and both reloads re-read the resource from the
    // repository layer instead of trusting the push. Declaring no parameter
    // reproduces that faithfully and keeps the contract honest: this hook
    // cannot narrow a payload whose shape it does not inspect.
    // ------------------------------------------------------------------
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
    // The two routing keys, composed here because composing them is the
    // CALLER's job as far as the primitive is concerned -- it hardcodes none.
    //
    // Four dot-separated segments each, interpolating the live id exactly as
    // `app/coffee/modules/backlog/main.coffee:270` and `:275` interpolate
    // `@scope.projectId`. Recomputed on every render and compared by value
    // inside the primitive, so an unchanged id produces an unchanged key and
    // leaves both subscriptions alone.
    //
    // `null` while the id is unresolved, which the primitive reads as "not
    // yet" and skips.
    // ------------------------------------------------------------------
    const userStoriesRoutingKey = projectId
        ? `changes.project.${projectId}.userstories`
        : null;

    const milestonesRoutingKey = projectId
        ? `changes.project.${projectId}.milestones`
        : null;

    // ------------------------------------------------------------------
    // EXACTLY TWO SUBSCRIPTIONS, both unconditional and both at the top level
    // of this hook -- never inside a branch, a loop or a conditional
    // expression, which React's rules of hooks forbid and which a "loop over an
    // array of keys" refactor would introduce. Conditionality lives in the KEYS
    // above, never in whether the hook is called.
    //
    // The options object goes to the SECOND call alone, mirroring
    // `app/coffee/modules/backlog/main.coffee:280`. The first call passes no
    // third argument at all, so the primitive forwards `undefined` and the
    // service omits the `options` member from the outgoing command entirely
    // (`app/coffee/modules/events.coffee:211-212`) -- which is a different wire
    // message from one carrying an empty object.
    // ------------------------------------------------------------------
    useRealtime(userStoriesRoutingKey, deliverUserStoriesChange);

    useRealtime(milestonesRoutingKey, deliverMilestonesChange, MILESTONES_SUBSCRIBE_OPTIONS);
}
