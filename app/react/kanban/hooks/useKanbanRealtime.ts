/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanRealtime — the Kanban board's TWO realtime subscriptions, their
 * trailing debounce, and the lightbox deferral that decides WHEN a project
 * attribute change is allowed to rebuild the board.
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
 * reference; it is not this hook's job to delete it, and this hook does not
 * import from it. Requirement I1 keeps the `taigaKanban` module itself alive
 * regardless, so the reference stays reachable.
 *
 * ===========================================================================
 * 2. THE DIVISION OF LABOUR — three files, one behaviour
 * ===========================================================================
 * a. `../../bridge/useRealtime.ts` owns the AngularJS/React seam: it resolves
 *    `$tgEvents` through the typed accessor, subscribes with a literal `null`
 *    scope, keeps the caller's handler in a ref so a new handler identity never
 *    resubscribes, and — the entire reason it exists — calls
 *    `unsubscribe(routingKey)` in its own effect cleanup.
 * b. THIS FILE owns everything Kanban-specific and nothing else: which two
 *    routing keys, how long the debounce waits, which project messages matter,
 *    and when a deferred refresh is released.
 * c. The board container owns the EFFECTS. `onUserStoriesChanged` and
 *    `onProjectAttributesChanged` are supplied by the caller, so the loader,
 *    the project re-fetch and the data reload that `main.coffee` L335-L339
 *    performs — `tgLoader.start()` then `projectService.fetchProject()` then
 *    `loadInitialData()` — stay out of this file entirely.
 *
 * The split is what requirement I9 asks for: this hook is a pure scheduler over
 * two injected callbacks, so the browserless jsdom suite can drive it with fake
 * timers and no browser, no socket and no network.
 *
 * ===========================================================================
 * 3. THE TWO ROUTING KEYS ARE FROZEN, AND THE TRIPLE IN GOAL G2 IS NOT THIS
 *    SCREEN'S SET
 * ===========================================================================
 * Kanban subscribes to EXACTLY TWO keys — `…userstories` (`main.coffee:345`)
 * and `…projects` (`:350`) — and to NO OTHERS. Goal G2 of the plan names three
 * resources (`userstories`, `milestones`, `projects`); that triple is the UNION
 * of both migrated screens and neither screen's own set:
 *
 *   - Kanban  = { userstories, projects }   — verified `main.coffee:341-360`
 *   - Backlog = { userstories, milestones } — verified
 *               app/coffee/modules/backlog/main.coffee:269-280
 *
 * So `.milestones` must never appear here, and neither must the
 * `{ selfNotification: true }` fourth argument, which belongs exclusively to
 * the Backlog `milestones` subscription (`backlog/main.coffee:280`). Adding
 * either would change realtime behaviour silently, violating rule T10 ("No
 * functional or feature change of any kind"). Both `useRealtime` calls below
 * therefore pass TWO arguments and no options object.
 *
 * ===========================================================================
 * 4. TRANSFORMATION RULE T9 — HAZARD H2: SUBSCRIPTIONS ARE KEYED GLOBALLY, SO
 *    THERE MAY BE EXACTLY ONE CONSUMER PER KEY
 * ===========================================================================
 * `$tgEvents.subscribe` stores its subscription in ONE flat map keyed by the
 * routing key for the whole application — `@.subscriptions[routingKey] =
 * subscription` at app/coffee/modules/events.coffee L214. Two consequences,
 * both silent:
 *
 *   - a second subscribe to the same key OVERWRITES the first callback, and the
 *     first consumer simply stops receiving messages;
 *   - either consumer's `unsubscribe` kills the server-side subscription for
 *     both, because the wire command carries only the key (`:225-230`).
 *
 * "One live consumer per routing key" is therefore an ARCHITECTURAL INVARIANT,
 * and this hook is written to be that single consumer for both Kanban keys:
 * mount it ONCE, in the board container, and never a second time in the same
 * tree. No defensive global registry is added here to police it — a registry
 * would be module-level mutable state shared across every board instance and
 * every test, which is worse than the problem: it cannot see the AngularJS
 * consumers that share the same map, so it would give false assurance while
 * making the module stateful.
 *
 * ===========================================================================
 * 5. TRANSFORMATION RULE T9 — THE NULL-SCOPE CLEANUP SEAM, AND WHY THIS FILE
 *    MUST NOT SUBSCRIBE FOR ITSELF
 * ===========================================================================
 * The last line of `subscribe` is
 * `scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope`
 * (`events.coffee:217`). The trailing guard is the whole argument: AngularJS
 * installs its automatic teardown ONLY when a scope was supplied. React has no
 * scope and must never be given one, so it passes `null`, the guard is false,
 * and NOTHING auto-unsubscribes.
 *
 * That is precisely why every subscription in this file goes through
 * `useRealtime` rather than through `$tgEvents` directly: `useRealtime` is the
 * one place that calls `unsubscribe(routingKey)` on effect cleanup, in the
 * order "silence deliveries, then unsubscribe". Subscribing here would
 * reintroduce the leak the bridge exists to close, and the leak is SILENT — it
 * surfaces only as a board that reloads twice, then three times, as a user
 * walks between Kanban and Backlog (AAP 0.6.3 item 8).
 *
 * This file also must not DEFEAT that mechanism, which is why:
 *
 *   - hazard H1: `unsubscribe` never deletes the local registry entry
 *     (`:219-230` sends the wire command and nothing else), so a message
 *     already in flight can still reach a handler AFTER cleanup. The bridge's
 *     `disposed` flag answers that for the subscription; the `disposed` flag
 *     here answers it for the debounce timers, which can outlive an unmount by
 *     up to one full wait;
 *   - the consumer's callbacks are read from refs at fire time, so a queued
 *     timer can never invoke a closure from an earlier render.
 *
 * Dispatch with a null scope takes the `else` branch of `processMessage`
 * (`:189-190`) and runs OUTSIDE any digest. That is correct for React and is
 * left exactly as it is: nothing here calls `$apply`, `$applyAsync` or
 * `$digest`, and AAP 0.7.4 forbids it outright.
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

import { useRealtime } from '../../bridge/useRealtime';

/* --------------------------------------------------------------------------
 * Public constants
 * -------------------------------------------------------------------------- */

/**
 * Inclusive lower bound of the debounce wait, from
 * `taiga.randomInt(700, 1000)` at app/coffee/modules/kanban/main.coffee L342.
 */
export const KANBAN_REALTIME_MIN_DELAY_MS = 700;

/**
 * Inclusive upper bound of the debounce wait, from the same call. `randomInt`
 * is inclusive at BOTH ends — `start + Math.floor(Math.random() * (interval +
 * 1))` with `interval = end - start`, app/coffee/utils.coffee L253-L254 — so
 * 1000 is a reachable value and not an exclusive limit.
 */
export const KANBAN_REALTIME_MAX_DELAY_MS = 1000;

/**
 * The EXHAUSTIVE set of `matches` values on the `…projects` key that rebuild
 * the Kanban board, from app/coffee/modules/kanban/main.coffee L353-L355.
 *
 * Frozen in both senses: the list is closed — every other project message, and
 * every malformed one, is ignored — and it is `as const`, so
 * {@link KanbanProjectRefreshMatch} is derived from it rather than restated
 * beside it, and the two can never drift apart.
 *
 * The three values correspond to the project attributes the board's structure
 * is built from: its swimlanes, its user-story statuses, and the join between
 * them. A change to any of them means the columns or the rows of the board are
 * no longer the ones on screen.
 */
export const KANBAN_PROJECT_REFRESH_MATCHES = [
    'projects.swimlane',
    'projects.swimlaneuserstorystatus',
    'projects.userstorystatus',
] as const;

/* --------------------------------------------------------------------------
 * Public types
 * -------------------------------------------------------------------------- */

/** One of the three project `matches` values that rebuild the board. */
export type KanbanProjectRefreshMatch = (typeof KANBAN_PROJECT_REFRESH_MATCHES)[number];

/**
 * Invoked with the LAST user-story message of a debounced burst.
 *
 * The payload stays `unknown` and is handed over UNTOUCHED — not cloned, not
 * reshaped, not parsed. The incumbent consumer reads `data.pk`, which may be a
 * single id or an array of them (`main.coffee:534-541`), so the caller is the
 * code that knows the shape and the code that must narrow it. Anything else
 * here would either lose fields or lie about their types.
 */
export type KanbanUserStoriesMessageHandler = (message: unknown) => void;

/**
 * Invoked when the board's structure must be rebuilt because a swimlane or a
 * user-story status changed — the React stand-in for
 * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged`
 * (`main.coffee:335-339`).
 *
 * It takes no argument on purpose: the incumbent ignores the message entirely
 * and simply re-fetches, so passing the payload would invite a caller to
 * differentiate on it and quietly diverge. Everything that method does — start
 * the loader, re-fetch the project, reload the board data — belongs to the
 * caller, which owns those services.
 *
 * It is called AT MOST ONCE per lightbox-open window, however many matching
 * messages arrived in it (section 7b of the file header).
 */
export type KanbanProjectRefreshHandler = () => void;

/**
 * Options for {@link useKanbanRealtime}.
 *
 * Readonly throughout: this hook only ever reads them, and a readonly contract
 * says so at every call site.
 */
export interface UseKanbanRealtimeOptions {
    /**
     * The live project id, or `null`/`undefined` while the project has not
     * resolved yet.
     *
     * The AngularJS controller could interpolate its id unconditionally because
     * `initializeSubscription` runs after the project is loaded. A React hook
     * cannot be called conditionally, so "not yet" has to be representable: any
     * non-numeric or non-finite value composes NO routing key, and
     * `useRealtime` then subscribes to nothing at all rather than to a garbage
     * key that never delivers.
     */
    readonly projectId: number | null | undefined;

    /**
     * Whether a lightbox is open RIGHT NOW — the React stand-in for
     * `ctrl.isLightboxOpened` (`main.coffee:136`, set at `:327` and `:330`).
     *
     * While it is `true`, a matching project message is remembered instead of
     * acted on. The deferred refresh is released on the true -> false edge, so
     * the container may re-render with an unchanged `false` as often as it likes
     * without triggering anything.
     */
    readonly isLightboxOpen: boolean;

    /**
     * Latest handler for the `…userstories` key. May be a new function on every
     * render: it is read from a ref at fire time, so its identity never
     * resubscribes and a queued timer never invokes an earlier render's
     * closure.
     */
    readonly onUserStoriesChanged: KanbanUserStoriesMessageHandler;

    /**
     * Latest handler for a board-structure rebuild. Same identity guarantees as
     * {@link onUserStoriesChanged}.
     */
    readonly onProjectAttributesChanged: KanbanProjectRefreshHandler;
}

/* --------------------------------------------------------------------------
 * Internals
 * -------------------------------------------------------------------------- */

/**
 * `taiga.randomInt`, reproduced arithmetic-for-arithmetic from
 * app/coffee/utils.coffee L253-L254:
 *
 *     randomInt = (start, end) ->
 *         interval = end - start
 *         return start + Math.floor(Math.random() * (interval + 1))
 *
 * The `+ 1` is what makes `end` reachable, so the range is inclusive at both
 * ends. It is reimplemented rather than imported because `utils.coffee` is
 * CoffeeScript that publishes onto a global at run time (`taiga.randomInt =
 * randomInt`, `:307`): importing it is impossible from a TypeScript module, and
 * declaring the global would put an untyped, build-order-dependent dependency
 * into the type program for the sake of two lines of arithmetic.
 *
 * @param start - inclusive lower bound.
 * @param end - inclusive upper bound; must not be below `start`.
 * @returns an integer in `[start, end]`.
 */
function randomIntInclusive(start: number, end: number): number {
    const interval = end - start;

    return start + Math.floor(Math.random() * (interval + 1));
}

/**
 * Composes one of the two frozen Kanban routing keys, or `null` when the
 * project id is not usable yet.
 *
 * The four dot-separated segments are exactly the ones
 * `app/coffee/modules/kanban/main.coffee` builds at `:345` and `:350`: the
 * literal `changes`, the literal `project`, the project id, and the resource
 * name.
 *
 * `null` is returned for anything that is not a finite number — `null`,
 * `undefined` and `NaN` all reach this hook while a project resolves — because
 * interpolating such a value would compose a syntactically valid key that no
 * publisher will ever match, and `useRealtime` treats a falsy key as "not yet"
 * and subscribes to nothing. Presence rather than truthiness decides, so an id
 * of `0` still composes a key: this hook does not get to invent a rule about
 * which ids the backend may issue.
 *
 * @param projectId - the live project id, or a nullish/NaN placeholder.
 * @param resource - `'userstories'` or `'projects'`; see the two call sites.
 * @returns the routing key, or `null` when no key can be composed.
 */
function buildKanbanRoutingKey(
    projectId: number | null | undefined,
    resource: string,
): string | null {
    if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
        return null;
    }

    return `changes.project.${projectId}.${resource}`;
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

/**
 * The mutable state of ONE trailing-edge debounce.
 *
 * `latestMessage` and `hasLatestMessage` are kept apart on purpose: `undefined`
 * is a legitimate payload — nothing stops a publisher sending it — so "there is
 * a pending message" cannot be inferred from the value alone.
 *
 * `timerId` is typed `number` because every handle stored in it comes from
 * `window.setTimeout`, which the DOM library types as `number`. The global
 * `setTimeout` would resolve to the ambient Node declaration instead
 * (`tsconfig.json` lists `node` in `types`) and yield a platform-specific
 * handle object, which is wrong for code that only ever runs in a browser.
 */
interface TrailingDebounceSlot {
    timerId: number | null;
    latestMessage: unknown;
    hasLatestMessage: boolean;
}

/**
 * The two INDEPENDENT debounces, one per routing key.
 *
 * Independence is the point, and it is what `main.coffee:346` and `:351` give
 * today: each `debounceLeading` call returns its own closure with its own
 * pending timer, so a burst of user-story messages cannot postpone a project
 * message that is already waiting, or the other way round. They share only the
 * wait, never a timer.
 */
interface KanbanDebounceSlots {
    readonly userStories: TrailingDebounceSlot;
    readonly project: TrailingDebounceSlot;
}

/** A fresh, idle debounce slot. */
function createTrailingDebounceSlot(): TrailingDebounceSlot {
    return { timerId: null, latestMessage: undefined, hasLatestMessage: false };
}

/**
 * Cancels a slot's pending invocation and forgets its queued payload.
 *
 * Idempotent, so it is safe to call on an idle slot and safe to call twice.
 * Dropping the payload matters as much as clearing the timer: a payload kept
 * alive would pin whatever the message references until the hook unmounts.
 *
 * @param slot - the slot to return to its idle state.
 */
function cancelTrailingDebounceSlot(slot: TrailingDebounceSlot): void {
    if (slot.timerId !== null) {
        window.clearTimeout(slot.timerId);
        slot.timerId = null;
    }

    slot.hasLatestMessage = false;
    slot.latestMessage = undefined;
}

/* --------------------------------------------------------------------------
 * The hook
 * -------------------------------------------------------------------------- */

/**
 * Keeps the React Kanban board in step with the two realtime streams it
 * depends on, for as long as the board is mounted.
 *
 * ```tsx
 * useKanbanRealtime({
 *     projectId,
 *     isLightboxOpen,
 *     onUserStoriesChanged: (message) => { void reloadUserStories(message); },
 *     onProjectAttributesChanged: () => { void rebuildBoard(); },
 * });
 * ```
 *
 * Behavioural contract, every clause traced in the file header:
 *
 * - **EXACTLY TWO SUBSCRIPTIONS**, `…userstories` and `…projects`, and never
 *   `…milestones` (section 3). Neither passes subscribe-time options.
 * - **CALL IT ONCE PER BOARD.** Subscriptions are keyed globally, so a second
 *   consumer of either key silently breaks the first (section 4).
 * - **NOTHING IS SUBSCRIBED UNTIL `projectId` IS A FINITE NUMBER**, and the
 *   hook is still called unconditionally, as the rules of hooks require.
 * - **TEARDOWN IS THE BRIDGE'S**, because a null AngularJS scope installs no
 *   automatic unsubscribe (section 5). This hook adds only what the bridge
 *   cannot see: cancelling debounce timers that could otherwise fire up to one
 *   whole wait after an unmount.
 * - **BOTH STREAMS ARE TRAILING-DEBOUNCED** by one shared random wait in
 *   `[700, 1000]` ms, on two independent timers, delivering only the last
 *   message of a burst (section 6).
 * - **USER-STORY MESSAGES ARE NEVER DEFERRED**, not even while a lightbox is
 *   open (section 7a).
 * - **A MATCHING PROJECT MESSAGE REBUILDS THE BOARD IMMEDIATELY WHEN NO
 *   LIGHTBOX IS OPEN, AND IS OTHERWISE COALESCED INTO ONE REBUILD RELEASED ON
 *   CLOSE** (section 7).
 * - **NOTHING IS RETURNED.** There is no subscription handle worth exposing and
 *   no transport to hand out; the hook's whole output is the two callbacks it
 *   invokes.
 *
 * Safe under React 18 StrictMode: the development-only mount/unmount/remount
 * cycle cancels the timers and re-arms them, leaving exactly one live
 * subscription per key carrying the current handlers.
 *
 * @param options - see {@link UseKanbanRealtimeOptions}.
 */
export function useKanbanRealtime(options: UseKanbanRealtimeOptions): void {
    const { projectId, isLightboxOpen, onUserStoriesChanged, onProjectAttributesChanged } = options;

    // The consumer's callbacks, read at FIRE time rather than captured when a
    // timer is scheduled. A board that re-renders between a message arriving and
    // its debounce elapsing must be served by the newest callbacks, and the
    // callbacks must never enter a dependency array where a new identity could
    // rebuild a subscription (hazard H2, section 4 of the file header).
    const onUserStoriesChangedRef = useRef<KanbanUserStoriesMessageHandler>(onUserStoriesChanged);
    const onProjectAttributesChangedRef =
        useRef<KanbanProjectRefreshHandler>(onProjectAttributesChanged);

    // Written in an effect, not during render: a render may be discarded or
    // replayed under concurrent rendering, and a ref written then would publish
    // a value from a render that never committed.
    useEffect(() => {
        onUserStoriesChangedRef.current = onUserStoriesChanged;
        onProjectAttributesChangedRef.current = onProjectAttributesChanged;
    }, [onUserStoriesChanged, onProjectAttributesChanged]);

    // `ctrl.isLightboxOpened` (`main.coffee:136`) as a ref, so the debounced
    // project handler can test the CURRENT value at fire time.
    const isLightboxOpenRef = useRef<boolean>(isLightboxOpen);

    // `ctrl.isRefreshNeeded` (`main.coffee:137`). A boolean, deliberately not a
    // counter and not a queue: that is what coalesces many deferred messages
    // into exactly one refresh (section 7b).
    const isRefreshNeededRef = useRef<boolean>(false);

    // Reentrancy guard for the release path only (section 7, closing note). Not
    // a translation of anything in the incumbent: it exists because the flag is
    // cleared AFTER the callback runs, and a React callback is ordinary code
    // that could re-enter this hook synchronously.
    const isFlushingRef = useRef<boolean>(false);

    // Hazard H1 (section 5): `unsubscribe` leaves the service's registry entry
    // in place, and a debounce timer can outlive an unmount by up to one whole
    // wait. Both are answered by refusing to do anything once disposed.
    const disposedRef = useRef<boolean>(false);

    // ONE wait for BOTH streams, drawn ONCE per mounted hook instance, exactly
    // as `randomTimeout` is drawn once at `main.coffee:342` and then used at both
    // `:346` and `:351`.
    //
    // Lazily initialised through a ref rather than memoised, because this must be
    // a guarantee and not an optimisation: a memo is free to be discarded and
    // recomputed, which would re-roll the jitter mid-session and could stretch or
    // shrink a wait a message is already sitting in.
    const debounceDelayRef = useRef<number | null>(null);

    if (debounceDelayRef.current === null) {
        debounceDelayRef.current = randomIntInclusive(
            KANBAN_REALTIME_MIN_DELAY_MS,
            KANBAN_REALTIME_MAX_DELAY_MS,
        );
    }

    const debounceDelayMs = debounceDelayRef.current;

    // The two independent timers, created once and owned by THIS hook instance.
    // Nothing is stored at module level: two boards mounted in one page (or two
    // specs in one file) must not be able to cancel each other's work.
    const slotsRef = useRef<KanbanDebounceSlots | null>(null);

    if (slotsRef.current === null) {
        slotsRef.current = {
            userStories: createTrailingDebounceSlot(),
            project: createTrailingDebounceSlot(),
        };
    }

    const slots = slotsRef.current;

    /**
     * The trailing-edge debounce itself — `_.debounce(fn, wait, {leading:
     * false, trailing: true})` (`utils.coffee:122`) reduced to what these two
     * call sites actually need.
     *
     * Nothing runs on the leading edge; each message overwrites the slot's
     * pending payload and RESETS its timer; one invocation follows the quiet
     * period, carrying the last payload only.
     */
    const scheduleTrailing = useCallback(
        (slot: TrailingDebounceSlot, message: unknown, run: (latest: unknown) => void): void => {
            if (disposedRef.current) {
                return;
            }

            // Last message wins, which is lodash's behaviour: a trailing
            // invocation is made with the most recent arguments.
            slot.latestMessage = message;
            slot.hasLatestMessage = true;

            if (slot.timerId !== null) {
                window.clearTimeout(slot.timerId);
            }

            slot.timerId = window.setTimeout(() => {
                slot.timerId = null;

                // Disposal can happen inside the wait; see hazard H1.
                if (disposedRef.current || !slot.hasLatestMessage) {
                    return;
                }

                const latest = slot.latestMessage;

                // Consumed before the callback runs, so a callback that
                // re-enters this hook starts from an empty slot instead of
                // seeing its own message still queued.
                slot.hasLatestMessage = false;
                slot.latestMessage = undefined;

                run(latest);
            }, debounceDelayMs);
        },
        [debounceDelayMs],
    );

    /**
     * Releases a deferred board rebuild, at most once.
     *
     * The ordering of `main.coffee:331-333` is preserved exactly — test the
     * flag, call the refresh, clear the flag LAST — so a refresh that throws
     * leaves the work pending rather than silently dropping it. The reentrancy
     * guard is what makes "at most once" true despite that ordering.
     */
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

    /**
     * `…userstories` handler — `main.coffee:346-347`.
     *
     * Debounced, then handed straight on. There is no lightbox test here
     * because there is none there (section 7a), and the payload crosses
     * untouched because the consumer reads fields off it (`:534-541`).
     */
    const handleUserStoriesMessage = useCallback(
        (message: unknown): void => {
            scheduleTrailing(slots.userStories, message, (latest) => {
                onUserStoriesChangedRef.current(latest);
            });
        },
        [scheduleTrailing, slots],
    );

    /**
     * `…projects` handler — `main.coffee:351-360`.
     *
     * Debounce FIRST, then narrow, then route. That order is not cosmetic: the
     * incumbent's `matches` test lives inside the debounced function, so it
     * runs against the last message of a burst only, and a matching message
     * followed by a non-matching one inside the wait refreshes nothing today
     * (section 6). Testing before the debounce would add a refresh the board
     * does not currently perform.
     */
    const handleProjectMessage = useCallback(
        (message: unknown): void => {
            scheduleTrailing(slots.project, message, (latest) => {
                if (!isProjectRefreshMessage(latest)) {
                    return;
                }

                if (isLightboxOpenRef.current) {
                    // `:357-358`. Remembered, not acted on, and remembered
                    // idempotently: this is the coalescing boundary.
                    isRefreshNeededRef.current = true;

                    return;
                }

                // `:360`. No lightbox in the way, so rebuild now.
                onProjectAttributesChangedRef.current();
            });
        },
        [scheduleTrailing, slots],
    );

    // The React stand-in for the two scope listeners at `main.coffee:326-333`.
    //
    // EDGE-TRIGGERED, not level-triggered: the release happens only on the
    // true -> false transition, which is what makes a first render with
    // `isLightboxOpen === false`, and every re-render that merely repeats
    // `false`, a no-op (section 7d). The new state is observed BEFORE the
    // release is attempted, mirroring `:330` assigning the flag before `:331`
    // tests the pending one.
    useEffect(() => {
        const wasLightboxOpen = isLightboxOpenRef.current;

        isLightboxOpenRef.current = isLightboxOpen;

        if (wasLightboxOpen && !isLightboxOpen) {
            releaseDeferredRefresh();
        }
    }, [isLightboxOpen, releaseDeferredRefresh]);

    // The two frozen keys (section 3), composed from the live project id. Both
    // are `null` together while the project is unresolved, and `useRealtime`
    // then subscribes to nothing.
    const userStoriesRoutingKey = buildKanbanRoutingKey(projectId, 'userstories');
    const projectRoutingKey = buildKanbanRoutingKey(projectId, 'projects');

    // Timer lifecycle, keyed on the routing keys as well as on mounting.
    //
    // Re-arming on every run is REQUIRED, not defensive: StrictMode's
    // development-only mount/unmount/remount reuses these very refs, so a
    // `disposed` flag left set by the simulated unmount would silence the board
    // for the rest of the session.
    //
    // Cancelling on a KEY CHANGE matters too. A payload queued for the previous
    // project describes a board that is no longer on screen, and a deferred
    // rebuild belonged to that project's swimlanes and statuses; the incumbent
    // discards both by construction, because a project change destroys the
    // controller and its debounced closures with it.
    useEffect(() => {
        disposedRef.current = false;

        return () => {
            disposedRef.current = true;

            cancelTrailingDebounceSlot(slots.userStories);
            cancelTrailingDebounceSlot(slots.project);

            isRefreshNeededRef.current = false;
        };
    }, [slots, userStoriesRoutingKey, projectRoutingKey]);

    // The seam itself, and the ONLY way this file reaches the realtime service:
    // one call per key, two arguments each, no subscribe-time options (section
    // 3). `useRealtime` owns `subscribe(null, …)` and the matching
    // `unsubscribe(routingKey)` in its cleanup (section 5); neither is ever
    // called from here, and `$tgEvents` is never resolved here.
    useRealtime(userStoriesRoutingKey, handleUserStoriesMessage);
    useRealtime(projectRoutingKey, handleProjectMessage);
}
