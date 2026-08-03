/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanRealtime — the Kanban board's TWO realtime streams, their trailing
 * debounce, and the lightbox deferral that decides WHEN a project attribute
 * change is allowed to rebuild the board.
 *
 * It opens NO subscription of its own. The retained AngularJS controller is the
 * sole owner of both routing keys and re-publishes each raw payload on its own
 * scope; this hook listens to those two scope events. Section 4 carries the
 * measured reason that is an invariant rather than a preference.
 *
 * ===========================================================================
 * 1. WHAT THIS REPLACES (transformation rule T9)
 * ===========================================================================
 * `KanbanController.initializeSubscription`, at
 * app/coffee/modules/kanban/main.coffee L341-L360, together with the two scope
 * listeners it cooperates with at L326-L333 and the two flags they drive,
 * declared at L136-L137. That method is nine executable lines long and every
 * one of them is reproduced here:
 *
 *     initializeSubscription: ->                                      # :341
 *         randomTimeout = taiga.randomInt(700, 1000)                  # :342
 *
 *         routingKeyUserstories = "changes.project.#{...}.userstories" # :345
 *         @events.subscribe @scope, routingKeyUserstories,             # :346
 *             debounceLeading randomTimeout, (message) =>
 *                 @.eventsLoadUserstories(message)                     # :347
 *
 *         routingKeyProject = "changes.project.#{...}.projects"        # :350
 *         @events.subscribe @scope, routingKeyProject,                 # :351
 *             debounceLeading randomTimeout, (message) =>
 *                 if message.matches in [ ...three values... ]         # :352-356
 *                     if @.isLightboxOpened                            # :357
 *                         @.isRefreshNeeded = true                     # :358
 *                     else
 *                         @.refreshAfter…HaveChanged()                 # :360
 *
 * The incumbent method survives in that file as the authoritative behavioural
 * reference AND as the LIVE OWNER of both routing keys; it is emphatically not
 * this hook's job to delete it, and this hook does not import from it.
 * Requirement I1 keeps the `taigaKanban` module itself alive regardless, so both
 * the reference and the owner stay reachable. What this hook reproduces is the
 * SCHEDULING half of that method — the wait, the narrowing, the deferral — over
 * the raw payloads the same method re-publishes.
 *
 * ===========================================================================
 * 2. THE DIVISION OF LABOUR — three files, one behaviour
 * ===========================================================================
 * a. THE RETAINED CONTROLLER owns the AngularJS/React seam for realtime, and it
 *    owns the two `$tgEvents` subscriptions OUTRIGHT — see section 4, which is
 *    the whole reason this file subscribes to nothing. `initializeSubscription`
 *    re-publishes each RAW payload on its own scope with
 *    `@scope.$broadcast("kanban:realtime:userstories", message)` and
 *    `@scope.$broadcast("kanban:realtime:projects", message)`, and
 *    `app/coffee/modules/kanban/react-bridge.coffee` hands React a registrar,
 *    `events.onAngularEvent(name, handler) -> deregister`, that is a direct
 *    `$scope.$on` on that same scope.
 * b. THIS FILE owns everything Kanban-specific and nothing else: which two
 *    events, how long the debounce waits, which project messages matter, and
 *    when a deferred refresh is released.
 * c. The board container owns the EFFECTS. `onUserStoriesChanged` and
 *    `onProjectAttributesChanged` are supplied by the caller, so the loader,
 *    the project re-fetch and the data reload that `main.coffee` L335-L339
 *    performs — `tgLoader.start()` then `projectService.fetchProject()` then
 *    `loadInitialData()` — stay out of this file entirely. The container also
 *    supplies `registerAngularEvent`, normally straight from the bridge payload,
 *    so this hook resolves no injector and no service of any kind.
 *
 * The split is what requirement I9 asks for: this hook is a pure scheduler over
 * two injected callbacks, so the browserless jsdom suite can drive it with fake
 * timers and no browser, no socket and no network.
 *
 * ===========================================================================
 * 3. THE TWO STREAMS ARE FROZEN, AND THE TRIPLE IN GOAL G2 IS NOT THIS
 *    SCREEN'S SET
 * ===========================================================================
 * Kanban's realtime surface is EXACTLY TWO resources — `…userstories`
 * (`main.coffee:345`) and `…projects` (`:350`) — and NO OTHERS. Goal G2 of the
 * plan names three resources (`userstories`, `milestones`, `projects`); that
 * triple is the UNION of both migrated screens and neither screen's own set:
 *
 *   - Kanban  = { userstories, projects }   — verified `main.coffee:341-360`
 *   - Backlog = { userstories, milestones } — verified
 *               app/coffee/modules/backlog/main.coffee:269-280
 *
 * So `.milestones` must never appear here, and neither must the
 * `{ selfNotification: true }` subscribe option, which belongs exclusively to
 * the Backlog `milestones` subscription (`backlog/main.coffee:280`) and is in
 * any case the retained controller's business now, not this hook's. Adding
 * either would change realtime behaviour silently, violating rule T10 ("No
 * functional or feature change of any kind").
 *
 * The two names this hook listens for are the ones the controller broadcasts,
 * exported below as {@link KANBAN_REALTIME_USERSTORIES_EVENT} and
 * {@link KANBAN_REALTIME_PROJECT_EVENT}. They are a two-ended contract with
 * `initializeSubscription`: renaming one end leaves the other listening for an
 * event nobody raises, and AngularJS registers listeners for unknown names
 * quite happily, so the failure is silent at both ends.
 *
 * ===========================================================================
 * 4. TRANSFORMATION RULE T9 — HAZARD H2: SUBSCRIPTIONS ARE KEYED GLOBALLY, SO
 *    THERE MAY BE EXACTLY ONE OWNER PER KEY — AND IT IS THE CONTROLLER
 * ===========================================================================
 * `$tgEvents.subscribe` stores its subscription in ONE flat map keyed by the
 * routing key for the whole application — `@.subscriptions[routingKey] =
 * subscription` at app/coffee/modules/events.coffee L214. Two consequences,
 * both silent:
 *
 *   - a second subscribe to the same key OVERWRITES the first callback, and the
 *     first consumer simply stops receiving messages;
 *   - either consumer's `unsubscribe` kills the server-side subscription for
 *     both, because the wire command carries only the key (`:219-230`).
 *
 * "One live owner per routing key" is therefore an ARCHITECTURAL INVARIANT, and
 * the owner of both Kanban keys is the RETAINED `KanbanController`, which
 * subscribes with its own `@scope` at `main.coffee:341-360` and is not going
 * anywhere: it is still the data, permission and write layer that feeds this
 * board. So this hook does NOT subscribe. It cannot: a React subscription to
 * either key would clobber the controller's callback, the board would silently
 * stop refreshing, and whichever side unmounted first would take the shared
 * server-side subscription down with it.
 *
 * ⭐ THE RESOLUTION, and the reason `../../bridge/useRealtime.ts` is not used
 * here even though it exists: the controller re-publishes each raw payload on
 * its own scope, and this hook LISTENS. One `$tgEvents` subscription per key,
 * one AngularJS owner, and as many React listeners as the screen needs — scope
 * listeners are an array push, so several are cheap and none can displace
 * another. `useRealtime` remains the sanctioned primitive for a key React ever
 * owns OUTRIGHT; neither migrated screen has one.
 *
 * No defensive global registry is added here to police the invariant — a
 * registry would be module-level mutable state shared across every board
 * instance and every test, which is worse than the problem: it cannot see the
 * AngularJS owner that shares the same map, so it would give false assurance
 * while making the module stateful.
 *
 * ===========================================================================
 * 5. TRANSFORMATION RULE T9 — THE CLEANUP SEAM
 * ===========================================================================
 * On the AngularJS side teardown is automatic: the last line of `subscribe` is
 * `scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope`
 * (`events.coffee:217`), and the controller DOES supply a scope, so its two
 * subscriptions are released with its scope. React has no scope and must never
 * be given one, which is exactly why the React side listens rather than
 * subscribes: what this hook holds is not a subscription but two scope
 * listeners, and `$scope.$on` hands back a deregistration function that the
 * effect cleanup below calls unconditionally.
 *
 * Leaving a listener registered is the one silent leak available here. Nothing
 * fails; the board simply does its realtime work twice, then three times, as a
 * user walks between Kanban and Backlog (AAP 0.6.3 item 8). Two further
 * guarantees close the remaining gaps:
 *
 *   - a debounce timer can outlive its listener by up to one full wait, so the
 *     `disposed` flag below refuses to deliver anything once torn down and
 *     every pending timer is cancelled on cleanup;
 *   - the consumer's callbacks are read from refs at fire time, so a queued
 *     timer can never invoke a closure from an earlier render.
 *
 * The controller's callbacks run inside a digest (`events.coffee:186-187`
 * wraps a scoped delivery in `$apply`), so a broadcast reaches this hook inside
 * that digest and React schedules its own render from there. Nothing here calls
 * a digest driver of any kind, and AAP 0.7.4 forbids it outright.
 *
 * ===========================================================================
 * 6. TRANSFORMATION RULE T9 — `debounceLeading` IS A MISNOMER: THE INCUMBENT
 *    DEBOUNCE IS TRAILING-ONLY
 * ===========================================================================
 * `main.coffee:346` and `:351` wrap both callbacks in `debounceLeading`, whose
 * name says leading edge and whose implementation says the opposite:
 *
 *     debounceLeading = (wait, func) ->                    # app/coffee/utils.coffee:121
 *         return _.debounce(func, wait, {leading: false, trailing: true})   # :122
 *
 * Compare the sibling it is named against, which really is leading-edge:
 *
 *     debounce = (wait, func) ->                                            # :117
 *         return _.debounce(func, wait, {leading: true, trailing: false})   # :118
 *
 * So the reproduced behaviour is TRAILING-ONLY, and reading the name instead of
 * the body would inverse it: the first message of a burst would fire
 * immediately and the last would be dropped, which is the opposite of what the
 * board does today. Concretely, what is reproduced below is:
 *
 *   - NOTHING fires on the leading edge;
 *   - every message inside the wait RESETS that key's timer;
 *   - exactly ONE invocation happens after the quiet period, carrying the LAST
 *     message of the burst — lodash keeps only the most recent arguments.
 *
 * The last point has a consequence for the project key that is easy to miss:
 * the `matches` test at `main.coffee:352-356` sits INSIDE the debounced
 * function, so it runs against the LAST message only. A matching message
 * followed within the wait by a non-matching one therefore triggers NO refresh
 * today. The order below is the same — debounce first, then narrow, then route
 * — because inverting it would make the board refresh in a case where it
 * currently does not.
 *
 * The wait itself is ONE random integer, computed ONCE at `:342` by
 * `taiga.randomInt(700, 1000)` and SHARED by both debounced callbacks. The
 * jitter exists to spread the reload burst of many browsers watching one
 * project; the sharing means both keys settle together. Both properties are
 * preserved: one value per mounted hook instance, used by both timers.
 *
 * ===========================================================================
 * 7. TRANSFORMATION RULE T9 — THE LIGHTBOX COALESCING BOUNDARY
 * ===========================================================================
 * A swimlane or user-story-status change rebuilds the whole board, which would
 * yank the ground out from under an open lightbox. `main.coffee` guards against
 * that with two booleans (`:136-137`) and defers instead:
 *
 *     $on "lightbox:opened":  isLightboxOpened = true                  # :326-327
 *     $on "lightbox:closed":  isLightboxOpened = false                 # :330
 *                             if isRefreshNeeded                       # :331
 *                                 refreshAfter…HaveChanged()           # :332
 *                                 isRefreshNeeded = false              # :333
 *
 * Four properties of that shape are load-bearing and are reproduced exactly:
 *
 *   a. ONLY the project key is deferred. The user-story key keeps firing while
 *      a lightbox is open — `:346-347` has no lightbox test at all — because
 *      restacking cards does not disturb an open form.
 *   b. MANY DEFERRED MESSAGES COALESCE INTO ONE REFRESH. `isRefreshNeeded` is a
 *      boolean, not a counter or a queue, so ten matching messages while a
 *      lightbox is open produce exactly one refresh on close.
 *   c. THE ORDER ON CLOSE IS: observe the closed state, refresh if needed,
 *      clear the flag LAST. The clear is deliberately after the call, so a
 *      refresh that throws leaves the flag set and the work still pending.
 *   d. CLOSING WITH NOTHING PENDING IS A NO-OP.
 *
 * The one thing added rather than translated is a reentrancy guard: `:332`
 * calls the refresh while the flag is still set, so a refresh that synchronously
 * caused another close notification could flush twice. AngularJS never does
 * that in practice — the refresh is asynchronous there — but a React callback
 * is ordinary code and might, and a double refresh is a visible double board
 * rebuild. The guard makes the flush exactly-once without changing the ordering
 * of (c).
 *
 * React has no `lightbox:closed` event to listen to, and this hook is
 * deliberately not given one: the board container already knows whether a
 * lightbox is open, so it passes that as a boolean and this hook watches for
 * the true -> false EDGE. Edge-triggering, rather than level-triggering, is
 * what makes property (d) hold on the first render and on every re-render that
 * merely repeats `false`.
 *
 * ===========================================================================
 * 8. CONSTRAINTS THIS FILE IS HELD TO
 * ===========================================================================
 * Rule T5 and requirement I7 — no transport of any kind is constructed here: no
 * request API, no socket, no third-party client. Reads and writes belong to the
 * container's callbacks, which reach `$tgResources` through the bridge, so the
 * `Authorization` and `X-Session-Id` headers, the single-flight 401 refresh and
 * `$tgModel`'s changed-fields-only PATCH semantics are all inherited.
 *
 * Rule T8 — the file is isolated under `app/react/**` and adds no barrel: its
 * one internal import is a relative path to the bridge hook.
 *
 * Rule T10 and the Minimal Change Clause — nothing here is an enhancement.
 * Every value, every threshold and every ordering decision is traced to a
 * locator above.
 *
 * HR-1, HR-2 — no package is added. `react` and the bridge hook are the whole
 * dependency surface, and both are already pinned.
 *
 * Strict typing — `tsconfig.json` sets `strict` with no opt-outs plus
 * `noUnusedLocals`, `noUnusedParameters` and `isolatedModules`. Message
 * payloads stay `unknown` and are narrowed before use; there is no unsafe
 * escape-hatch type and no suppression comment in this file. Timer handles are
 * taken from `window.setTimeout`, which the DOM library types as `number`,
 * rather than from the global overload that the ambient Node types would
 * resolve to a platform-specific handle object.
 */

import { useCallback, useEffect, useRef } from 'react';

/* --------------------------------------------------------------------------
 * Public constants
 * -------------------------------------------------------------------------- */

/**
 * The AngularJS scope event on which the retained controller re-publishes every
 * RAW `changes.project.<id>.userstories` payload.
 *
 * Broadcast by `initializeSubscription` in
 * `app/coffee/modules/kanban/main.coffee`, immediately after handing the message
 * to the controller's own debounced handler and therefore BEFORE that wait
 * elapses — which is what lets this hook reproduce the incumbent debounce itself
 * instead of inheriting a second, stacked one.
 */
export const KANBAN_REALTIME_USERSTORIES_EVENT = 'kanban:realtime:userstories';

/**
 * The AngularJS scope event on which the retained controller re-publishes every
 * RAW `changes.project.<id>.projects` payload. Same broadcaster, same timing,
 * same reasoning as {@link KANBAN_REALTIME_USERSTORIES_EVENT}.
 */
export const KANBAN_REALTIME_PROJECT_EVENT = 'kanban:realtime:projects';

/**
 * Inclusive lower bound of the debounce wait, from
 * `taiga.randomInt(700, 1000)` at app/coffee/modules/kanban/main.coffee L342.
 */
export const KANBAN_REALTIME_MIN_DELAY_MS = 700;

export const KANBAN_REALTIME_MAX_DELAY_MS = 1000;

export const KANBAN_PROJECT_REFRESH_MATCHES = [
    'projects.swimlane',
    'projects.swimlaneuserstorystatus',
    'projects.userstorystatus',
] as const;

export type KanbanProjectRefreshMatch = (typeof KANBAN_PROJECT_REFRESH_MATCHES)[number];

export type KanbanUserStoriesMessageHandler = (message: unknown) => void;

export type KanbanProjectRefreshHandler = () => void;

/** One of the two scope events the retained controller re-publishes on. */
export type KanbanRealtimeEventName =
    | typeof KANBAN_REALTIME_USERSTORIES_EVENT
    | typeof KANBAN_REALTIME_PROJECT_EVENT;

/**
 * The teardown function a registration hands back.
 *
 * `$scope.$on` returns exactly this, and the effect below calls both of the ones
 * it holds on cleanup. Section 5 of the file header explains why leaving one
 * uncalled leaks silently.
 */
export type KanbanRealtimeEventDeregistrar = () => void;

/**
 * Registers a listener for one of the two controller-published events and
 * returns its deregistration function.
 *
 * This is the whole of the AngularJS seam, injected by the container rather than
 * resolved here, so the hook itself touches no injector, no `$scope` and no
 * service (section 2c). The natural implementation is the bridge payload's own
 * `events.onAngularEvent`, which is a direct `$scope.$on` on the retained
 * controller's scope; a spec satisfies it with a stub that records the handler.
 *
 * The listener signature carries BOTH AngularJS arguments in AngularJS's order —
 * the event object first, the payload second — because reading the payload out
 * of the wrong position is the classic way to get a `$scope.$on` consumer wrong.
 *
 * It SHOULD be referentially stable (wrap it in `useCallback`, or take it
 * straight from the bridge payload, whose function identities never change),
 * because the hook re-registers whenever its identity changes. An unstable one
 * is nonetheless safe rather than merely wasteful: re-registration deregisters
 * the previous listener first, so no duplicate can accumulate.
 */
export type KanbanRealtimeEventRegistrar = (
    eventName: KanbanRealtimeEventName,
    handler: (event: unknown, message: unknown) => void,
) => KanbanRealtimeEventDeregistrar;

/**
 * Options for {@link useKanbanRealtime}.
 *
 * Readonly throughout: this hook only ever reads them, and a readonly contract
 * says so at every call site.
 */
export interface UseKanbanRealtimeOptions {
    /**
     * How to register a listener on the retained controller's scope — normally
     * `events.onAngularEvent` from the bridge payload.
     *
     * There is deliberately no `projectId` here. The routing keys are composed
     * and owned by `initializeSubscription` (section 4), so a React hook that
     * accepted a project id would be advertising an authority it does not have.
     * A container that has not resolved its project yet simply has nothing to
     * render, and the events it would hear carry the project the controller is
     * subscribed to by construction.
     */
    readonly registerAngularEvent: KanbanRealtimeEventRegistrar;

    readonly isLightboxOpen: boolean;

    readonly onUserStoriesChanged: KanbanUserStoriesMessageHandler;

    readonly onProjectAttributesChanged: KanbanProjectRefreshHandler;
}

function randomIntInclusive(start: number, end: number): number {
    const interval = end - start;

    return start + Math.floor(Math.random() * (interval + 1));
}

/**
 * Safely narrows a `…projects` payload to "a matching project message".
 *
 * The payload arrives as `unknown` — `events.coffee:190` hands over
 * `data.data`, whose shape depends on the routing key — and a realtime message
 * is remote input, so it may be malformed, `null`, a primitive, or an object
 * whose `matches` is not a string. Every one of those cases must be IGNORED
 * rather than thrown on: an exception here would escape a timer callback as an
 * unhandled error and would abort a refresh the board legitimately owed.
 *
 * Narrowing is done with `typeof`, the `in` operator and a `typeof` test on the
 * extracted value, so no assertion is needed anywhere: `in` contributes the
 * property with type `unknown`, and the string test does the rest. The
 * membership test uses `some` rather than `includes` because `includes` on a
 * readonly tuple of literals rejects a `string` argument at compile time, and
 * widening the tuple to satisfy it would be an assertion for no gain.
 *
 * @param message - the raw payload delivered on the `…projects` key.
 * @returns `true` only for an object whose `matches` is one of
 *          {@link KANBAN_PROJECT_REFRESH_MATCHES}.
 */
function isProjectRefreshMessage(
    message: unknown,
): message is { readonly matches: KanbanProjectRefreshMatch } {
    if (typeof message !== 'object' || message === null) {
        return false;
    }

    if (!('matches' in message)) {
        return false;
    }

    const { matches } = message;

    return (
        typeof matches === 'string' &&
        KANBAN_PROJECT_REFRESH_MATCHES.some((candidate) => candidate === matches)
    );
}

interface TrailingDebounceSlot {
    timerId: number | null;
    latestMessage: unknown;
    hasLatestMessage: boolean;
}

interface KanbanDebounceSlots {
    readonly userStories: TrailingDebounceSlot;
    readonly project: TrailingDebounceSlot;
}

function createTrailingDebounceSlot(): TrailingDebounceSlot {
    return { timerId: null, latestMessage: undefined, hasLatestMessage: false };
}

function cancelTrailingDebounceSlot(slot: TrailingDebounceSlot): void {
    if (slot.timerId !== null) {
        window.clearTimeout(slot.timerId);
        slot.timerId = null;
    }

    slot.hasLatestMessage = false;
    slot.latestMessage = undefined;
}

export function useKanbanRealtime(options: UseKanbanRealtimeOptions): void {
    const {
        registerAngularEvent,
        isLightboxOpen,
        onUserStoriesChanged,
        onProjectAttributesChanged,
    } = options;

    const onUserStoriesChangedRef = useRef<KanbanUserStoriesMessageHandler>(onUserStoriesChanged);
    const onProjectAttributesChangedRef =
        useRef<KanbanProjectRefreshHandler>(onProjectAttributesChanged);

    useEffect(() => {
        onUserStoriesChangedRef.current = onUserStoriesChanged;
        onProjectAttributesChangedRef.current = onProjectAttributesChanged;
    }, [onUserStoriesChanged, onProjectAttributesChanged]);

    const isLightboxOpenRef = useRef<boolean>(isLightboxOpen);

    const isRefreshNeededRef = useRef<boolean>(false);

    const isFlushingRef = useRef<boolean>(false);

    const disposedRef = useRef<boolean>(false);

    const debounceDelayRef = useRef<number | null>(null);

    if (debounceDelayRef.current === null) {
        debounceDelayRef.current = randomIntInclusive(
            KANBAN_REALTIME_MIN_DELAY_MS,
            KANBAN_REALTIME_MAX_DELAY_MS,
        );
    }

    const debounceDelayMs = debounceDelayRef.current;

    const slotsRef = useRef<KanbanDebounceSlots | null>(null);

    if (slotsRef.current === null) {
        slotsRef.current = {
            userStories: createTrailingDebounceSlot(),
            project: createTrailingDebounceSlot(),
        };
    }

    const slots = slotsRef.current;

    const scheduleTrailing = useCallback(
        (slot: TrailingDebounceSlot, message: unknown, run: (latest: unknown) => void): void => {
            if (disposedRef.current) {
                return;
            }

            slot.latestMessage = message;
            slot.hasLatestMessage = true;

            if (slot.timerId !== null) {
                window.clearTimeout(slot.timerId);
            }

            slot.timerId = window.setTimeout(() => {
                slot.timerId = null;

                if (disposedRef.current || !slot.hasLatestMessage) {
                    return;
                }

                const latest = slot.latestMessage;

                slot.hasLatestMessage = false;
                slot.latestMessage = undefined;

                run(latest);
            }, debounceDelayMs);
        },
        [debounceDelayMs],
    );

    // Reloading the board's statuses and swimlanes while a lightbox is open would rebuild
    // the form's own inputs underneath the user, so the refresh is remembered and released
    // when the lightbox closes. Only ONE deferred refresh is ever pending — a boolean, not
    // a queue — because the reload always fetches current state. The re-entrancy flag
    // exists because releasing can itself close another lightbox.
    const releaseDeferredRefresh = useCallback((): void => {
        if (!isRefreshNeededRef.current || isFlushingRef.current) {
            return;
        }

        isFlushingRef.current = true;

        try {
            onProjectAttributesChangedRef.current();
            isRefreshNeededRef.current = false;
        } finally {
            isFlushingRef.current = false;
        }
    }, []);

    const handleUserStoriesMessage = useCallback(
        (message: unknown): void => {
            scheduleTrailing(slots.userStories, message, (latest) => {
                onUserStoriesChangedRef.current(latest);
            });
        },
        [scheduleTrailing, slots],
    );

    const handleProjectMessage = useCallback(
        (message: unknown): void => {
            scheduleTrailing(slots.project, message, (latest) => {
                if (!isProjectRefreshMessage(latest)) {
                    return;
                }

                if (isLightboxOpenRef.current) {
                    isRefreshNeededRef.current = true;

                    return;
                }

                onProjectAttributesChangedRef.current();
            });
        },
        [scheduleTrailing, slots],
    );

    useEffect(() => {
        const wasLightboxOpen = isLightboxOpenRef.current;

        isLightboxOpenRef.current = isLightboxOpen;

        if (wasLightboxOpen && !isLightboxOpen) {
            releaseDeferredRefresh();
        }
    }, [isLightboxOpen, releaseDeferredRefresh]);

    // THE SEAM ITSELF (section 4), and the only place this file touches
    // AngularJS: two listeners on the retained controller's scope, and the two
    // deregistration functions it handed back, called on cleanup.
    //
    // The disposal flag is armed and re-armed HERE rather than in an effect of
    // its own, so that "listening" and "willing to deliver" are one lifetime and
    // cannot drift apart. Re-arming on every run is REQUIRED, not defensive:
    // StrictMode's development-only mount/unmount/remount reuses these very
    // refs, so a `disposed` flag left set by the simulated unmount would silence
    // the board for the rest of the session.
    //
    // Cleanup also cancels both debounce timers, because a payload queued when
    // the board went away describes a board that is no longer on screen, and
    // drops any deferred rebuild for the same reason. The incumbent discards
    // both by construction: a project change destroys the controller and its
    // debounced closures with it.
    //
    // The listener signature takes AngularJS's event object first and the
    // payload second. The event object is never read — `main.coffee` never reads
    // one either — but it must be declared, because the payload is the SECOND
    // argument and there is no other way to reach it.
    useEffect(() => {
        disposedRef.current = false;

        const deregisterUserStories = registerAngularEvent(
            KANBAN_REALTIME_USERSTORIES_EVENT,
            (_event: unknown, message: unknown) => {
                handleUserStoriesMessage(message);
            },
        );

        const deregisterProject = registerAngularEvent(
            KANBAN_REALTIME_PROJECT_EVENT,
            (_event: unknown, message: unknown) => {
                handleProjectMessage(message);
            },
        );

        return () => {
            disposedRef.current = true;

            deregisterUserStories();
            deregisterProject();

            cancelTrailingDebounceSlot(slots.userStories);
            cancelTrailingDebounceSlot(slots.project);

            isRefreshNeededRef.current = false;
        };
    }, [registerAngularEvent, handleUserStoriesMessage, handleProjectMessage, slots]);
}
