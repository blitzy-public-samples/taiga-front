/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useRealtime.test.tsx -- THE CO-LOCATED SPEC FOR THE NULL-SCOPE REALTIME HOOK
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file as much as it
 * governs the unit it covers, so every claim below is quoted from a source that
 * was read rather than assumed, and every locator is spelled out.
 *
 * --------------------------------------------------------------------------
 * 1. WHY THIS SPEC EXISTS AT ALL -- IT IS MANDATED BY NAME
 * --------------------------------------------------------------------------
 * The folder requirements name it directly: "a spec proving `useRealtime`
 * cleanup calls `unsubscribe(routingKey)`". The plan explains why that one
 * assertion earned a spec of its own (AAP 0.6.3, item 8, verbatim):
 *
 *     "`useRealtime` passes a null scope and calls `unsubscribe(routingKey)` in
 *      its `useEffect` cleanup. This is the single easiest place in the
 *      migration to leak, and the leak is silent -- it manifests only as
 *      duplicate refreshes after navigating away and back."
 *
 * SILENT is the operative word, and it is what makes an ordinary rendering test
 * worthless here. A leaked subscription throws nothing, logs nothing, and breaks
 * no test that mounts a screen once. It surfaces later as a board that reloads
 * twice, then three times, then four, as a user walks between Kanban and
 * Backlog -- and it is attributed, when someone finally notices, to almost
 * anything except this hook. A test is the only thing that notices at the
 * moment the regression is introduced, which is why the cleanup proof is the
 * FIRST `describe` block below rather than a footnote at the end.
 *
 * --------------------------------------------------------------------------
 * 2. PATH CORRECTION -- WHICH FILE THE ASSERTIONS ENCODE
 * --------------------------------------------------------------------------
 * The realtime service is `app/coffee/modules/events.coffee` (306 lines). There
 * is NO `app/coffee/modules/base/events.coffee`: that directory holds exactly
 * twelve files -- bind, conf, contrib, filters, http, load-element, location,
 * model, navurls, repository, storage, urls -- and none of them is the events
 * service. AAP 0.6.2 cites the non-existent path; the verified one is used here.
 *
 * EVERY BARE `:NNN` LOCATOR IN THIS FILE REFERS TO THAT FILE. It is REFERENCE
 * ONLY: the Minimal Change Clause and the folder's must-not-modify list both
 * forbid editing it, so every accommodation for its behaviour is made on the
 * React side of the seam -- which is the unit under test, and therefore here.
 *
 * --------------------------------------------------------------------------
 * 3. THE FORMAL PROOF THAT THE CLEANUP ASSERTION IS MANDATORY, NOT DEFENSIVE
 * --------------------------------------------------------------------------
 * The last line of `subscribe` is `:217`:
 *
 *     scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope
 *
 * The trailing `if scope` guard is the entire argument. AngularJS registers its
 * automatic teardown ONLY when a scope was supplied. Both surviving controllers
 * do supply one, which is why they may subscribe and forget:
 * `KanbanController.initializeSubscription`
 * (`app/coffee/modules/kanban/main.coffee:341`) subscribes at `:346` and `:351`
 * with `@scope`, and `BacklogController.initializeSubscription`
 * (`app/coffee/modules/backlog/main.coffee:269`) subscribes at `:271` and `:276`
 * with `@scope`.
 *
 * React has no scope and must never be given one, so it passes `null`, the guard
 * is false, and NOTHING auto-unsubscribes. `unsubscribe` in the effect cleanup
 * is the only teardown that exists -- hence the spec asserting the literal
 * `null`, not merely a falsy value: the difference between `null` and a
 * plausible-looking scope object is the difference between a leak and no leak.
 *
 * Null-scope subscription is house style rather than a novel usage. The service
 * itself subscribes with a null scope at `:73` (notifications), `:83` (live
 * notifications) and `:115` (web notifications) -- all three process-lifetime
 * subscriptions that are never torn down, which is exactly why none of them ever
 * had to solve the problem this hook solves.
 *
 * --------------------------------------------------------------------------
 * 4. HAZARD H1 -- `unsubscribe` DOES NOT REMOVE THE LOCAL REGISTRY ENTRY
 * --------------------------------------------------------------------------
 * `unsubscribe` (`:219-230`) does exactly one thing: it sends
 * `{"cmd": "unsubscribe", "routing_key": routingKey}`. Searching all 306 lines
 * for a mutation of the subscription registry finds EXACTLY THREE sites -- the
 * existence check at `:180`, the read at `:183`, the write at `:214` -- and NO
 * `delete` among them. (The file's only `delete` is `delete @.ws` at `:70`,
 * which discards the socket, not a subscription.) THE LOCAL ENTRY SURVIVES
 * UNSUBSCRIPTION.
 *
 * So a message already in flight, or one the server dispatches before it
 * processes the unsubscribe command, still finds the entry at `:180`, still
 * reaches `:190`, and still invokes the callback AFTER React's cleanup has run.
 * A closure over stale props then writes state into an unmounted tree, with no
 * error and no warning.
 *
 * THE TEST DOUBLE IN THIS FILE REPRODUCES THAT HAZARD ON PURPOSE. A convenient
 * double that pruned its registry on `unsubscribe` would make the most important
 * assertion here VACUOUS -- it would pass against a hook with no disposed flag
 * at all. So `unsubscribe` on the double is a pure recording spy that mutates
 * nothing, exactly like `:219-230`, and one spec asserts that the double still
 * routes after unsubscription precisely so the suite cannot quietly rot into
 * testing nothing.
 *
 * --------------------------------------------------------------------------
 * 5. HAZARD H2 -- SUBSCRIPTIONS ARE KEYED GLOBALLY: ONE CONSUMER PER KEY
 * --------------------------------------------------------------------------
 * `subscribe` (`:195-217`) stores `{scope, routingKey, callback}` into
 * `@.subscriptions[routingKey]` at `:214` -- ONE FLAT MAP keyed by routing key
 * for the entire application. Two consequences follow, and both are silent:
 *
 *   - A SECOND SUBSCRIBE TO THE SAME KEY CLOBBERS THE FIRST CALLBACK, because
 *     `:214` assigns unconditionally. The first consumer simply stops receiving
 *     messages and nothing reports it.
 *   - EITHER CONSUMER'S `unsubscribe` KILLS THE SERVER-SIDE SUBSCRIPTION FOR
 *     BOTH, because the wire command carries only the key.
 *
 * "One live consumer per routing key" is therefore AN INVARIANT THIS HOOK
 * PROTECTS, NOT A PROBLEM IT ENGINEERS AROUND. Adding a defensive multiplexing
 * registry to the hook would be an enhancement, forbidden by rule T10 ("No
 * functional or feature change of any kind") and by the Minimal Change Clause.
 * The spec below therefore DEMONSTRATES the clobber rather than defending
 * against it, so the invariant is documented executably: it is the reason a
 * screen mounts one `useRealtime` per key and fans out in React when two
 * components need the same stream.
 *
 * The hook upholds the invariant by not resubscribing without cause -- the
 * effect re-runs only when the service identity, the routing key, or the VALUE
 * of the options changes (section 7).
 *
 * `options` IS A SUBSCRIBE-TIME WIRE CONCERN ONLY. It is not stored on the
 * subscription at `:200-204`; it is attached to the outgoing message at
 * `:211-212` (`if options then message.options = options`). It is read once,
 * when the subscribe command is sent, and never again -- and `unsubscribe`
 * (`:219`) has exactly one parameter, so it must never receive it.
 *
 * --------------------------------------------------------------------------
 * 6. THE FROZEN ROUTING KEYS (GOAL G2) -- PER SCREEN, AND NOT THE UNION
 * --------------------------------------------------------------------------
 * NO COMPOSED ROUTING KEY IS SPELLED OUT ANYWHERE IN THIS FILE, and the fixtures
 * below assemble every key from its four dot-separated SEGMENTS -- the literal
 * `changes`, the literal `project`, the project id and the resource name -- for
 * two reasons. Composing keys is the CALLER's job, never the hook's; and one of
 * the specs at the end of this file asserts by reading its own source that
 * neither the hook nor this spec contains a composed key literal, which writing
 * one out in prose would immediately falsify.
 *
 * Goal G2 quotes three resource names, and it is worth being explicit that THE
 * TRIPLE IS THE UNION OF BOTH SCREENS AND NEITHER SCREEN'S SET:
 *
 *   +--------------------------------------------------------------------------+
 *   | SCREEN  | RESOURCES SUBSCRIBED   | LOCATORS            | FOURTH ARGUMENT |
 *   +---------+------------------------+---------------------+-----------------+
 *   | Kanban  | userstories, projects  | kanban/main.coffee  | none on either  |
 *   |         | -- NOT milestones      | key :345 sub :346   |                 |
 *   |         |                        | key :350 sub :351   |                 |
 *   +---------+------------------------+---------------------+-----------------+
 *   | Backlog | userstories, milestones| backlog/main.coffee | none on         |
 *   |         | -- NOT projects        | key :270 sub :271   | userstories;    |
 *   |         |                        | key :275 sub :276   | {selfNotifica-  |
 *   |         |                        |                     | tion: true} at  |
 *   |         |                        |                     | :280 on         |
 *   |         |                        |                     | milestones      |
 *   +---------+------------------------+---------------------+-----------------+
 *
 * That fourth argument is the ONLY reason the hook accepts `options` at all, so
 * the options specs below use that exact value rather than an invented one.
 *
 * Note also what the Kanban controller wraps around its callbacks: a leading-edge
 * debounce of a random 700-1000 ms, built at `kanban/main.coffee:342`. The
 * debounce belongs to the CALLER's handler and never to this hook -- a
 * hook-level debounce would silently change delivery timing for every consumer,
 * which rule T10 forbids -- so no spec here asserts any timing behaviour.
 *
 * --------------------------------------------------------------------------
 * 7. WHY `handler` IS DELIBERATELY ABSENT FROM THE EFFECT DEPENDENCY ARRAY
 * --------------------------------------------------------------------------
 * Consumers pass inline arrows; that is the ergonomic point of the hook. An
 * inline arrow is A NEW FUNCTION IDENTITY ON EVERY RENDER, so listing `handler`
 * as a dependency would tear down and rebuild the SERVER-SIDE subscription on
 * every single render: one unsubscribe command and one subscribe command per
 * render, a window in which pushes are lost, and -- by hazard H2 -- a stream of
 * registry overwrites. Requiring every caller to wrap its handler in
 * `useCallback` is not a fix either: it pushes a correctness requirement onto
 * every call site, where forgetting it is invisible.
 *
 * The hook therefore creates its subscribed callback ONCE per subscription and
 * reads the handler out of a ref kept current by a separate effect. Both halves
 * of that arrangement are asserted below, because either one alone is a bug:
 * re-rendering with a new inline handler must NOT resubscribe, AND the next
 * message must reach the NEWEST handler rather than a stale closure.
 *
 * `options` is protected from the same churn by a different means -- what enters
 * the dependency array is a normalised STRING derived from the object's
 * contents, so an inline literal cannot churn the subscription while a genuine
 * VALUE change still resubscribes.
 *
 * --------------------------------------------------------------------------
 * 8. WHAT THE CONNECTION LIFECYCLE IS NOT, AND WHERE IT LIVES INSTEAD
 * --------------------------------------------------------------------------
 * No spec here opens a transport, constructs a socket, or exercises reconnection,
 * because the hook owns none of that and must not: `onError` (`:262-270`),
 * `onClose` (`:272-278`, clearing `connected` at `:274`), `randomTryInterval`
 * (`:280-284`) and the `sendMessage` queue (`:165-176`) are all the service's,
 * and re-implementing any of them would violate rule T10. Rule T5 closes the
 * same door from the other side: no HTTP client and no socket may be built in
 * React, so the closing `describe` asserts the absence of both by reading the
 * unit's own source.
 *
 * One gap does matter to consumers and is recorded here so no one looks for it
 * in this file: `onOpen` (`:235-250`) sets `connected = true` at `:236` and
 * restores ONLY the auth message, the heartbeat and the three global
 * subscriptions -- IT DOES NOT RE-SUBSCRIBE PROJECT-SCOPED KEYS. That is why the
 * Backlog controller carries a disconnected-reload fallback at the ONLY site in
 * the whole repository that reads `connected` (declared `:23`, set `:236`,
 * cleared `:274`): `backlog/main.coffee:715` fires THREE reloads --
 * `loadSprints()` at `:716`, `loadClosedSprints()` at `:717` and
 * `loadProjectStats()` at `:718`. AAP 0.8.3 names only the first; the verified
 * count is three. That fallback belongs to the drag hook, not to this one, so it
 * is out of this spec's scope by design rather than by omission.
 *
 * --------------------------------------------------------------------------
 * 9. HOW THIS SPEC IS CONSTRAINED
 * --------------------------------------------------------------------------
 * Requirement HR-5 -- BROWSERLESS BY CONSTRUCTION. jsdom only. No end-to-end
 * runner is imported, no browser is launched, no network is touched, no real
 * socket is constructed, and nothing depends on build output. The entire
 * realtime service is replaced by a three-member double, which is what
 * requirement I9's per-hook dependency style is for.
 *
 * THE MOCKING SEAM IS `./mockInjector`, and that is a binding requirement rather
 * than a preference. The `jest.config.js` contract states it: tests must mock the
 * injector rather than load AngularJS, and the seam is provided "through the test
 * files themselves (a `mockInjector()` helper under `app/react/bridge/`), not by
 * adding `angular` to `setupFiles`". So this file imports no framework, reads no
 * framework browser global, and asks for no configuration change.
 *
 * `clearMocks` and `restoreMocks` are BOTH true in `jest.config.js`, so Jest
 * clears every mock and restores every spy between tests. Nothing here resets
 * mocks by hand: doing so would duplicate the harness and, worse, would suggest
 * to a reader that the configuration cannot be relied upon.
 *
 * Strict typing -- `tsconfig.json` sets `strict: true` with no per-flag opt-outs,
 * plus `noUnusedLocals`, `noUnusedParameters` and `isolatedModules`. The unsafe
 * escape-hatch type appears nowhere, including in the doubles: the service double
 * is declared with an explicit minimal interface, and message payloads are
 * `unknown` because `:190` passes `data.data`, whose shape differs per routing
 * key. There is no `baseUrl` and no `paths`, so every internal import is
 * relative. React is not imported by name: `jsx: "react-jsx"` makes the runtime
 * import automatic, and `noUnusedLocals` would reject an unused default import.
 *
 * Conventions follow the incumbent suite that must keep passing,
 * `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * (115 lines): a module-level `mocks` object (`:14`), one `_mock...` helper per
 * dependency (`:16`, `:23`), nested `describe` blocks per behaviour area (`:61`,
 * `:103`), fixtures shaped like the real models, and assertions on BOTH paths --
 * `:110` asserts a call happened, `:114` asserts it did not. The mechanical
 * substitutions are the AngularJS mock loader's `provide.value` (`:21`, `:30`)
 * -> `mockInjector`'s service map, `sinon.stub()` -> `jest.fn()`, and the chai
 * matchers -> the Jest ones. NO PERSISTENT-COLLECTION FIXTURE APPEARS ANYWHERE:
 * React receives plain objects only, because flattening happens on the AngularJS
 * side of the seam (P-IMMER-1). The library's name is deliberately not written
 * out in this file either -- see the source-level prohibition block at the end,
 * which asserts its absence by reading this very source.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector } from './mockInjector';
import { useRealtime } from './useRealtime';
import type { RealtimeMessageHandler, RealtimeSubscriptionOptions } from './useRealtime';

/* --------------------------------------------------------------------------
 * FIXTURES
 *
 * Shaped like the real values, per the incumbent suite's convention of building
 * fixtures that look like the models under test. Plain objects only -- no
 * persistent collection and no dirty-tracked model instance ever crosses into
 * React (P-IMMER-1).
 * -------------------------------------------------------------------------- */

/**
 * Assembles a routing key from its four dot-separated segments, exactly as the
 * two controllers do (`kanban/main.coffee:345` and `:350`;
 * `backlog/main.coffee:270` and `:275`).
 *
 * Written as a join rather than as a template literal so that no composed key
 * appears as a literal anywhere in this file -- see section 6 of the header, and
 * the source-level prohibition spec at the end that depends on it.
 *
 * @param projectId - the live project id, which is why a caller cannot compose a
 *                    key until the project has resolved.
 * @param resource - the resource name: `userstories`, `milestones` or `projects`.
 * @returns the composed routing key.
 */
function projectRoutingKey(projectId: number, resource: string): string {
    return ['changes', 'project', String(projectId), resource].join('.');
}

/** An arbitrary but fixed project id, so every key below is stable and readable. */
const PROJECT_ID = 3;

/** Subscribed by BOTH screens (`kanban/main.coffee:346`, `backlog/main.coffee:271`). */
const USERSTORIES_KEY = projectRoutingKey(PROJECT_ID, 'userstories');

/** Subscribed by the BACKLOG only (`backlog/main.coffee:276`) -- never by Kanban. */
const MILESTONES_KEY = projectRoutingKey(PROJECT_ID, 'milestones');

/** Subscribed by KANBAN only (`kanban/main.coffee:351`) -- never by the Backlog. */
const PROJECTS_KEY = projectRoutingKey(PROJECT_ID, 'projects');

/**
 * The one options object any in-scope screen actually supplies, hoisted to module
 * scope exactly as the hook's documentation asks callers to hoist it:
 * `backlog/main.coffee:280` passes it as the fourth argument of the `milestones`
 * subscription created at `:276`.
 *
 * Hoisting is what makes the "forwarded BY REFERENCE" assertion meaningful -- the
 * spec can compare identity, not merely contents.
 */
const MILESTONE_OPTIONS: RealtimeSubscriptionOptions = { selfNotification: true };

/**
 * A message payload shaped like one the service really delivers. `:190` hands the
 * callback `data.data`, and a user-story change carries the changed object's
 * identity plus what changed, so that is what this looks like. Its only real job
 * is to be a STABLE OBJECT IDENTITY the delivery specs can compare with
 * `Object.is`, which is the honest way to assert "unmodified".
 */
const USERSTORY_MESSAGE = { matches: 'userstories.userstory', data: { id: 42 } };

/* --------------------------------------------------------------------------
 * DOUBLES
 * -------------------------------------------------------------------------- */

/**
 * The callback the service stores at `:203` and later invokes at `:190`.
 *
 * The payload is `unknown` rather than the unsafe escape-hatch type for the same
 * reason the hook types it that way: `data.data`'s shape depends entirely on the
 * routing key, so only the consumer that chose the key can narrow it honestly.
 */
type RealtimeSubscriber = (data: unknown) => void;

/**
 * `subscribe` as a recording spy, typed to `:195`'s exact four-parameter
 * signature -- `subscribe: (scope, routingKey, callback, options) ->`.
 *
 * The tuple is spelled out with labels so that the positional assertions read as
 * the specification they are: a mistake in argument ORDER is precisely the kind
 * of bug that would still "work" for one screen and silently break the other.
 * The scope slot is typed as the literal `null` because React passes nothing
 * else, ever (section 3 of the header).
 */
type SubscribeSpy = jest.Mock<
    void,
    [
        scope: null,
        routingKey: string,
        callback: RealtimeSubscriber,
        options?: RealtimeSubscriptionOptions,
    ]
>;

/**
 * `unsubscribe` as a recording spy, typed to `:219`'s single-parameter signature
 * -- `unsubscribe: (routingKey) ->`.
 *
 * The one-element tuple is load-bearing: it is what lets the mandated cleanup
 * proof assert the recorded ARGUMENT COUNT with the type checker's agreement
 * rather than against it.
 */
type UnsubscribeSpy = jest.Mock<void, [routingKey: string]>;

/**
 * The minimal explicit `$tgEvents` interface this spec needs -- the three members
 * the typed facade declares, and nothing more.
 *
 * Declared here rather than imported so the spec states its own expectation of
 * the service instead of inheriting it, which is what makes a silent widening of
 * the facade visible. It is nevertheless checked against the real facade for
 * free: `mockInjector`'s service map is keyed by the injectable-service interface,
 * so handing this double in as the realtime service is a COMPILE ERROR under
 * `tsc --noEmit` the moment its shape stops conforming.
 */
interface RealtimeEventsDouble {
    /** `:23`, set at `:236`, cleared at `:274`. Whether the socket is up. */
    connected: boolean;

    /** `:195-217`. */
    subscribe: SubscribeSpy;

    /** `:219-230`. */
    unsubscribe: UnsubscribeSpy;
}

/**
 * The double plus the control surface a spec needs to act like the server.
 *
 * Kept as a separate object from `service` on purpose: the real service exposes
 * no such controls, so folding `dispatch` into the double would misrepresent the
 * contract the hook is written against.
 */
interface RealtimeHarness {
    /** Exactly what the hook resolves from the injector. */
    service: RealtimeEventsDouble;

    /**
     * Delivers a message the way `processMessage` (`:177-190`) does: look the
     * routing key up in the registry, return silently when it is absent
     * (`:180-181`), otherwise invoke the stored callback DIRECTLY -- the
     * null-scope branch at `:189-190`, which runs outside any digest.
     *
     * Wrapped in `act` by the caller when the handler writes React state.
     */
    dispatch(routingKey: string, payload: unknown): void;

    /** Whether the registry still holds a callback for `routingKey`. */
    isRegistered(routingKey: string): boolean;

    /** Registry size, for the hazard-H2 clobber assertions. */
    registrySize(): number;
}

/**
 * Builds the `$tgEvents` double.
 *
 * ONE HELPER PER DEPENDENCY, mirroring `_mockTgLightboxFactory` and
 * `_mockTgProjectService` in the incumbent spec (`:16-21`, `:23-30`), with
 * `sinon.stub()` replaced by `jest.fn()`. The AngularJS mock loader's
 * `provide.value "name", mock` (`:21`, `:30`) becomes `mockInjector`'s service
 * map, which `_mocks()` below assembles.
 *
 * THE DOUBLE REPRODUCES THE SERVICE'S HAZARDS RATHER THAN SMOOTHING THEM OVER:
 *
 *   - `subscribe` overwrites its registry entry unconditionally, because `:214`
 *     does (hazard H2, section 5 of the header).
 *   - `unsubscribe` mutates NOTHING, because `:219-230` sends a wire command and
 *     nothing else (hazard H1, section 4). A double that pruned here would make
 *     the late-delivery specs pass against a hook with no disposed flag at all.
 *   - `connected` starts `true`, the state in which a screen normally mounts.
 *     `sendMessage` (`:165-176`) queues while disconnected, so the connection
 *     state changes nothing this hook can observe -- which is exactly why no spec
 *     below varies it.
 *
 * @returns the double and the control surface over it.
 */
function _mockTgEvents(): RealtimeHarness {
    // Mirrors `@.subscriptions` (`:214`): ONE flat map keyed by routing key for
    // the whole application, and deliberately NEVER pruned.
    const subscriptions = new Map<string, RealtimeSubscriber>();

    const subscribe: SubscribeSpy = jest.fn(
        (_scope: null, routingKey: string, callback: RealtimeSubscriber): void => {
            subscriptions.set(routingKey, callback);
        },
    );

    const unsubscribe: UnsubscribeSpy = jest.fn();

    return {
        service: { connected: true, subscribe, unsubscribe },

        dispatch(routingKey: string, payload: unknown): void {
            const callback = subscriptions.get(routingKey);

            // `:180-181`: an unknown routing key is dropped without comment.
            if (callback === undefined) {
                return;
            }

            callback(payload);
        },

        isRegistered(routingKey: string): boolean {
            return subscriptions.has(routingKey);
        },

        registrySize(): number {
            return subscriptions.size;
        },
    };
}

/**
 * The module-level `mocks` object of the incumbent convention (`:14`), rebuilt
 * before every test.
 *
 * One entry per mocked dependency -- and this unit has exactly ONE, which is
 * requirement I9's point: the AngularJS controllers injected 23 and 21 services
 * respectively through a single positional array, so a spec had to stand up every
 * one of them to instantiate anything. A hook that asks for what it uses needs a
 * one-entry map, and that is what makes the browserless coverage gate reachable.
 */
interface Mocks {
    /** The realtime service double and its control surface. */
    $tgEvents: RealtimeHarness;

    /** The fake injector publishing it, i.e. the `provide.value` replacement. */
    injector: AngularInjector;
}

/**
 * Assembles the mocks, mirroring `_mocks()` in the incumbent spec (`:32-37`).
 *
 * `mockInjector` is handed ONLY the realtime service. Anything else the unit
 * asked for would throw a named diagnostic naming what was missing, which is a
 * far better failure than a nothing-value discovered three assertions later --
 * and it is itself a useful guarantee: it proves this hook reaches for exactly
 * one service.
 *
 * @returns a fresh `mocks` object.
 */
function _mocks(): Mocks {
    const $tgEvents = _mockTgEvents();

    return {
        $tgEvents,
        injector: mockInjector({ $tgEvents: $tgEvents.service }),
    };
}

let mocks: Mocks;

beforeEach(() => {
    mocks = _mocks();
});

/* --------------------------------------------------------------------------
 * HARNESSES
 * -------------------------------------------------------------------------- */

/**
 * Wraps a subtree in the bridge provider carrying `injector`.
 *
 * `AngularBridgeProvider` is used directly, rather than the `withMockInjector`
 * shorthand its sibling exports, so that the seam this whole folder exists to
 * build is VISIBLE in the spec: the provider is the only thing standing between
 * a React tree and an AngularJS injector, and a reader of this file should see it.
 *
 * @param injector - the injector to publish.
 * @returns a component suitable for the `wrapper` option of `render`.
 */
function withInjector(
    injector: AngularInjector,
): (props: { children?: ReactNode }) => ReactElement {
    // Named rather than anonymous so any component stack in a failure message
    // identifies the seam by name.
    return function InjectorWrapper({ children }: { children?: ReactNode }): ReactElement {
        return <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>;
    };
}

/** The props a consumer of the hook is parameterised by. */
interface ConsumerProps {
    /** Any falsy value means "the project has not resolved yet". */
    routingKey: string | null | undefined;

    /** Invoked with each delivered payload. */
    handler: RealtimeMessageHandler;

    /** Optional subscribe-time wire options. */
    options?: RealtimeSubscriptionOptions;
}

/**
 * The plainest possible consumer: it calls the hook and renders nothing of
 * interest.
 *
 * Deliberately stateless, so that a spec asserting "no state was written" is not
 * quietly asserting "this component has no state to write".
 */
function Consumer({ routingKey, handler, options }: ConsumerProps): ReactElement {
    useRealtime(routingKey, handler, options);

    return <output>realtime consumer</output>;
}

/**
 * Renders {@link Consumer} through the provider, with the current `mocks`.
 *
 * @param props - the consumer's props.
 * @returns the render result, whose `rerender` and `unmount` drive the lifecycle
 *          specs.
 */
function renderConsumer(props: ConsumerProps): RenderResult {
    return render(<Consumer {...props} />, { wrapper: withInjector(mocks.injector) });
}

/**
 * A consumer that DOES hold state, for the specs that must prove a delivered
 * message reaches React state -- and, in the late-delivery case, that it does not.
 *
 * The counter is rendered so the assertion reads the DOM rather than an internal,
 * which is how a state write is observed from outside.
 */
function StatefulConsumer({ routingKey }: { routingKey: string }): ReactElement {
    const [received, setReceived] = useState(0);

    // An inline arrow, which is the ergonomic case the handler ref exists to
    // support (section 7 of the header): a new identity on every render.
    useRealtime(routingKey, () => {
        setReceived((previous: number): number => previous + 1);
    });

    return <output data-testid="received">{received}</output>;
}

/**
 * The callback the hook handed to `subscribe` on its Nth call.
 *
 * Reading it out of the recorded call is how the specs that must act as the
 * SERVER -- rather than as the service -- get hold of the delivery entry point.
 *
 * @param callIndex - which `subscribe` call to read, defaulting to the first.
 * @returns the subscribed callback.
 */
function subscribedCallback(callIndex = 0): RealtimeSubscriber {
    const { calls } = mocks.$tgEvents.service.subscribe.mock;

    // A loud failure rather than a nothing-value propagating into an assertion
    // that then passes for the wrong reason.
    if (calls.length <= callIndex) {
        throw new Error(
            `subscribedCallback: no subscribe call at index ${callIndex}; ` +
                `${calls.length} call(s) were recorded.`,
        );
    }

    // Position three, per `:195`: subscribe (scope, routingKey, callback, options).
    return calls[callIndex][2];
}

/* ==========================================================================
 * SPECS
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * ⭐⭐ THE MANDATED CLEANUP PROOF -- FIRST, BECAUSE IT IS WHY THIS FILE EXISTS.
 *
 * Folder requirements: "a spec proving `useRealtime` cleanup calls
 * `unsubscribe(routingKey)`". AAP 0.6.3 item 8 explains the stakes: this is the
 * single easiest place in the migration to leak, and the leak is silent.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- cleanup, the mandated proof', () => {
    it('unsubscribes EXACTLY ONCE on unmount, with the EXACT routing key', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        // The negative half first, in the incumbent suite's style (`:114`): a
        // mounted consumer must NOT have torn its own subscription down.
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();

        unmount();

        // EXACTLY ONCE. Twice would mean the server-side subscription is being
        // cancelled more times than it was created, which under hazard H2 can
        // cancel a DIFFERENT consumer's stream; zero is the silent leak.
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);

        // THE EXACT KEY. `unsubscribe` (`:219-230`) identifies the subscription
        // solely by this string, so a near-miss unsubscribes nothing at all while
        // looking, in every log and every spy, as though it worked.
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
    });

    it('calls unsubscribe with EXACTLY ONE argument, even when options were supplied', () => {
        const handler = jest.fn<void, [unknown]>();

        // Subscribed WITH options, which is the only way this assertion can fail:
        // `options` is in scope in the effect that registers the cleanup, so
        // forwarding it on teardown is a one-character mistake to make.
        const { unmount } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: MILESTONE_OPTIONS,
        });

        unmount();

        const [unsubscribeCall] = mocks.$tgEvents.service.unsubscribe.mock.calls;

        // THE ARGUMENT COUNT, not merely the first argument. `unsubscribe:
        // (routingKey) ->` (`:219`) declares exactly one parameter, so a stray
        // second argument is swallowed in silence -- no error, no warning, and a
        // reader of the call site left believing the teardown is option-aware.
        expect(unsubscribeCall).toHaveLength(1);
        expect(unsubscribeCall[0]).toBe(MILESTONES_KEY);
    });

    it('does not unsubscribe while the consumer stays mounted and merely re-renders', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        rerender(
            <Consumer
                routingKey={USERSTORIES_KEY}
                handler={jest.fn<void, [unknown]>()}
            />,
        );

        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('unsubscribes nothing when it never subscribed', () => {
        const handler = jest.fn<void, [unknown]>();

        // No project id yet, so no key, so no subscription -- and therefore
        // nothing to cancel. An unconditional `unsubscribe(undefined)` in the
        // cleanup would send a garbage wire command on every unmount of a
        // still-loading screen.
        const { unmount } = renderConsumer({ routingKey: undefined, handler });

        unmount();

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * THE SUBSCRIBE CALL, ARGUMENT BY ARGUMENT, AGAINST `:195`:
 *     subscribe: (scope, routingKey, callback, options) ->
 * -------------------------------------------------------------------------- */
describe('useRealtime -- the subscribe call', () => {
    it('subscribes exactly once on mount', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('passes the LITERAL null as the scope, which is what makes teardown ours', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        // `toBeNull`, not `toBeFalsy`. The service's last line is
        // `scope.$on("$destroy", => @.unsubscribe(routingKey)) if scope` (`:217`),
        // so ANY truthy scope silently hands teardown back to AngularJS while
        // React keeps its own cleanup -- two unsubscribes for one subscribe. And a
        // scope-shaped object that is not a real scope would make the guard true
        // while registering a listener nothing ever fires. Only the literal `null`
        // gives the documented behaviour, so only the literal is accepted here.
        expect(subscribeCall[0]).toBeNull();
    });

    it('passes the routing key SECOND and a callback function THIRD', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: PROJECTS_KEY, handler });

        const [, routingKey, callback] = mocks.$tgEvents.service.subscribe.mock.calls[0];

        // Positional, because `:195` is positional. Swapping arguments two and
        // three would register a string as a callback and a function as a routing
        // key: the registry write at `:214` would succeed, and the subscription
        // would simply never deliver anything.
        expect(routingKey).toBe(PROJECTS_KEY);
        expect(typeof callback).toBe('function');

        // The callback the hook subscribes is its OWN, not the caller's handler.
        // That indirection is the handler ref (section 7 of the header), and it is
        // what lets the subscription outlive a changing handler identity.
        expect(callback).not.toBe(handler);
    });

    it('resolves the realtime service and asks the injector for nothing else', () => {
        const handler = jest.fn<void, [unknown]>();

        // The injector in `mocks` carries ONE service. `mockInjector` throws a
        // named diagnostic for any other name, so this render completing at all
        // is the assertion: the hook's dependency surface is exactly one service
        // (requirement I9's per-hook dependency style, replacing the 23- and
        // 21-entry positional injection arrays of the two controllers).
        expect(() => {
            renderConsumer({ routingKey: USERSTORIES_KEY, handler });
        }).not.toThrow();

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('fails loudly and BY NAME when the realtime service is not registered', () => {
        const handler = jest.fn<void, [unknown]>();

        // React logs a caught render error of its own before rethrowing, so the
        // channel is silenced to keep the suite's output honest about what failed.
        // `restoreMocks` puts it back; nothing is reset by hand.
        jest.spyOn(console, 'error').mockImplementation((): void => undefined);

        // An injector carrying nothing at all -- the shape a spec that forgot the
        // realtime service would build, and the shape the real seam has before
        // AngularJS has finished bootstrapping.
        const emptyInjector = mockInjector();

        // The complement of the previous spec, and the reason that one is meaningful:
        // the hook really does reach for `$tgEvents`, and reaching for a service that
        // is absent produces a diagnostic NAMING it rather than a nothing-value that
        // fails three lines later as an unreadable "cannot read property of
        // undefined". Which service a hook depends on is exactly the fact that the
        // 23- and 21-entry positional injection arrays of the two AngularJS
        // controllers made unknowable without reading the whole file.
        expect(() => {
            render(<Consumer routingKey={USERSTORIES_KEY} handler={handler} />, {
                wrapper: withInjector(emptyInjector),
            });
        }).toThrow(/\$tgEvents/);

        // And nothing was subscribed on the way out.
        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * OPTIONS -- A SUBSCRIBE-TIME WIRE CONCERN ONLY.
 *
 * Not stored on the subscription at `:200-204`; attached to the outgoing message
 * at `:211-212` (`if options then message.options = options`).
 * -------------------------------------------------------------------------- */
describe('useRealtime -- options', () => {
    it('forwards the options object BY REFERENCE as the FOURTH argument', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: MILESTONE_OPTIONS,
        });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        // Position four, and the SAME object -- not a copy, not a normalisation,
        // not a re-derived literal. `:211-212` puts whatever it is handed straight
        // onto the wire message, so anything the hook did to it on the way would
        // be a functional change (rule T10). This is the real value the Backlog
        // supplies for its milestones subscription (`backlog/main.coffee:280`).
        expect(subscribeCall[3]).toBe(MILESTONE_OPTIONS);
        expect(subscribeCall[3]).toEqual({ selfNotification: true });
    });

    it('omits options entirely when the caller supplies none', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const [subscribeCall] = mocks.$tgEvents.service.subscribe.mock.calls;

        // `undefined`, NOT an empty object. `:211` branches on truthiness, so an
        // empty object would add an `options` member to the wire message where
        // today there is none -- a change to the subscribe command that both
        // screens' unadorned subscriptions rely on not happening
        // (`kanban/main.coffee:346`, `:351`; `backlog/main.coffee:271`).
        expect(subscribeCall[3]).toBeUndefined();
    });

    it('does NOT resubscribe when an equal options object arrives with a new identity', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: { selfNotification: true },
        });

        // A fresh literal with identical contents -- what an inline `{ ... }` at a
        // call site produces on every render.
        rerender(
            <Consumer
                routingKey={MILESTONES_KEY}
                handler={handler}
                options={{ selfNotification: true }}
            />,
        );

        // One subscribe, no unsubscribe: the dependency array carries the options'
        // VALUE, not its identity, so identity churn cannot cycle the server-side
        // subscription (which under hazard H2 would also churn the registry).
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('resubscribes when the options VALUE changes', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({
            routingKey: MILESTONES_KEY,
            handler,
            options: { selfNotification: true },
        });

        rerender(
            <Consumer
                routingKey={MILESTONES_KEY}
                handler={handler}
                options={{ selfNotification: false }}
            />,
        );

        // A genuine value change MUST reach the wire, because the option changes
        // what the server sends. Ignoring it would be a silent behavioural change
        // in the other direction.
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(2);
        expect(mocks.$tgEvents.service.subscribe.mock.calls[1][3]).toEqual({
            selfNotification: false,
        });
    });
});

/* --------------------------------------------------------------------------
 * ⭐ HAZARD H1 -- `unsubscribe` (`:219-230`) MUTATES NO REGISTRY, so the service
 * can still route a late or in-flight message to a callback whose React tree is
 * already gone. The hook answers with a per-effect disposed flag; these specs
 * prove it, and the first one proves they are not testing a rigged double.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- hazard H1, delivery after teardown', () => {
    it('leaves the double still routing after unsubscribe, so these specs are not vacuous', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        expect(mocks.$tgEvents.isRegistered(USERSTORIES_KEY)).toBe(true);

        unmount();

        // THE INTEGRITY CHECK FOR THIS WHOLE BLOCK. If a future edit made the
        // double prune on `unsubscribe`, every assertion below would pass against
        // a hook with no disposed flag whatsoever -- the suite would keep its
        // green tick and stop protecting anything. The registry survives here
        // because it survives at `:219-230`, where the only statement is a
        // `sendMessage` and the file's sole `delete` is `delete @.ws` (`:70`).
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.isRegistered(USERSTORIES_KEY)).toBe(true);
    });

    it('is a silent no-op for a message the service dispatches AFTER unmount', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        unmount();

        expect(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        }).not.toThrow();

        // The handler is never reached, so there is no stale closure to write
        // through and nothing to write into an unmounted tree.
        expect(handler).not.toHaveBeenCalled();
    });

    it('is a no-op even when the captured callback is invoked directly', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        // Captured BEFORE teardown, exactly as the real service holds it: the
        // registry entry at `:214` keeps this reference alive past unsubscription,
        // so this is not a contrived call but the very reference `:190` would use.
        const deliver = subscribedCallback();

        unmount();

        expect(() => {
            deliver(USERSTORY_MESSAGE);
        }).not.toThrow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('writes no state and logs no React warning on the late-delivery path', () => {
        // Silenced rather than merely observed, so that a genuine React diagnostic
        // cannot pass unnoticed into the suite's output while still being asserted
        // on. `restoreMocks` is true in `jest.config.js`, so these spies are
        // restored automatically -- nothing is reset by hand anywhere in this file.
        const consoleError = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);

        const { unmount, getByTestId } = render(
            <StatefulConsumer routingKey={USERSTORIES_KEY} />,
            { wrapper: withInjector(mocks.injector) },
        );

        // A live delivery first, to prove the state path really is wired up: an
        // assertion that "no state was written" is worthless if no state could
        // ever have been written.
        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        expect(getByTestId('received').textContent).toBe('1');

        unmount();

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        // React 18 no longer emits the "update on an unmounted component" warning
        // that React 17 did, which is precisely why the load-bearing assertion is
        // the one above -- the handler never runs, so no update is even attempted.
        // These two guard the surrounding behaviour: the late-delivery path is
        // silent, and it stays silent if React ever restores such a diagnostic.
        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('silences only the OUTGOING subscription when the routing key changes', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const staleDeliver = subscribedCallback(0);

        rerender(<Consumer routingKey={MILESTONES_KEY} handler={handler} />);

        // The disposed flag is private to each effect RUN, not shared across the
        // hook, so disposing the outgoing subscription must not deafen the incoming
        // one. A single hook-level flag would silence the live subscription too --
        // and the screen would simply stop updating, with nothing logged.
        staleDeliver(USERSTORY_MESSAGE);
        expect(handler).not.toHaveBeenCalled();

        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('sets the disposed flag BEFORE calling unsubscribe, leaving no window open', () => {
        const handler = jest.fn<void, [unknown]>();

        const { unmount } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const deliver = subscribedCallback();

        // A message racing the unsubscribe command: delivered from inside
        // `unsubscribe` itself, which is the closest a unit test can get to the
        // real race, where the server dispatches before it processes the command.
        mocks.$tgEvents.service.unsubscribe.mockImplementation((): void => {
            deliver(USERSTORY_MESSAGE);
        });

        unmount();

        // Silent, because the cleanup disposes FIRST and unsubscribes SECOND. The
        // obvious reversal -- unsubscribe, then dispose -- leaves exactly this
        // window open, and nothing about it is observable in production.
        expect(handler).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * ⭐ THE HANDLER REF -- why `handler` is absent from the effect dependency array
 * (section 7 of the header). Both halves are asserted, because either alone is a
 * bug: not resubscribing is worthless if the handler goes stale, and a fresh
 * handler is worthless if the subscription is rebuilt to get it.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- the handler ref', () => {
    it('does NOT resubscribe when a new inline handler arrives on every render', () => {
        const { rerender } = renderConsumer({
            routingKey: USERSTORIES_KEY,
            handler: jest.fn<void, [unknown]>(),
        });

        // Three re-renders, each with a brand-new function identity -- what an
        // inline arrow at a call site produces.
        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );
        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );
        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );

        // Still ONE subscribe and ZERO unsubscribes. Listing `handler` as a
        // dependency would have produced four subscribes and three unsubscribes
        // here: three windows in which pushes are lost, and -- by hazard H2 --
        // three registry overwrites.
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).not.toHaveBeenCalled();
    });

    it('keeps the SAME subscribed callback identity across handler changes', () => {
        const { rerender } = renderConsumer({
            routingKey: USERSTORIES_KEY,
            handler: jest.fn<void, [unknown]>(),
        });

        const before = subscribedCallback();

        rerender(
            <Consumer routingKey={USERSTORIES_KEY} handler={jest.fn<void, [unknown]>()} />,
        );

        // The registry at `:214` still holds the very function it was given, which
        // is the structural reason the subscription survives: nothing needed to be
        // re-registered for the handler to change.
        expect(subscribedCallback()).toBe(before);
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
    });

    it('delivers to the LATEST handler, never the mount-time closure', () => {
        const first = jest.fn<void, [unknown]>();
        const second = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler: first });

        rerender(<Consumer routingKey={USERSTORIES_KEY} handler={second} />);

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        // The stale closure is the whole risk of holding a handler in a
        // subscription: the mount-time handler would close over the mount-time
        // props, so a board would keep refreshing against a project the user has
        // already navigated away from.
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith(USERSTORY_MESSAGE);
    });
});

/* --------------------------------------------------------------------------
 * ROUTING-KEY CHANGES, INCLUDING THE "NOT YET" CASE.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- routing-key changes', () => {
    it('unsubscribes the OLD key, then subscribes the NEW one, in that order', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        rerender(<Consumer routingKey={MILESTONES_KEY} handler={handler} />);

        const { subscribe, unsubscribe } = mocks.$tgEvents.service;

        // Exactly one of each: the old key is not left subscribed on the server, and
        // the new one is not subscribed twice.
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(subscribe).toHaveBeenCalledTimes(2);

        // The RIGHT key on each side. Cancelling the NEW key -- the mistake a
        // cleanup that read the current render's key instead of its own effect's key
        // would make -- would kill the subscription just created and leave the old
        // one live: a screen showing another project's pushes.
        expect(unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
        expect(subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);
        expect(subscribe.mock.calls[1][1]).toBe(MILESTONES_KEY);

        // ORDER, read from Jest's global invocation counter so the double stays
        // intact rather than being replaced by a recorder. Teardown must precede
        // setup: `:214` keys the registry globally, so subscribing first and
        // cancelling second would have the cancellation apply to the entry the new
        // subscribe had just written.
        expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
            subscribe.mock.invocationCallOrder[1],
        );
        expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
            unsubscribe.mock.invocationCallOrder[0],
        );
    });

    it('does not subscribe at all while the routing key is falsy', () => {
        const handler = jest.fn<void, [unknown]>();

        // The three shapes a caller can be in before the project resolves. A key
        // composed from an unresolved project id -- `changes`, `project`, the
        // nothing-value, `userstories` -- is a syntactically valid routing key that
        // subscribes to a stream the server will never publish, so it fails exactly
        // like a leak: silently.
        renderConsumer({ routingKey: undefined, handler });
        renderConsumer({ routingKey: null, handler });
        renderConsumer({ routingKey: '', handler });

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();
        expect(mocks.$tgEvents.registrySize()).toBe(0);
    });

    it('subscribes as soon as the key arrives, and unsubscribes if it goes away again', () => {
        const handler = jest.fn<void, [unknown]>();

        const { rerender } = renderConsumer({ routingKey: null, handler });

        expect(mocks.$tgEvents.service.subscribe).not.toHaveBeenCalled();

        rerender(<Consumer routingKey={USERSTORIES_KEY} handler={handler} />);

        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.subscribe.mock.calls[0][1]).toBe(USERSTORIES_KEY);

        rerender(<Consumer routingKey={null} handler={handler} />);

        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.$tgEvents.service.unsubscribe).toHaveBeenCalledWith(USERSTORIES_KEY);
    });
});

/* --------------------------------------------------------------------------
 * PAYLOAD DELIVERY -- the null-scope branch at `:189-190`, which invokes the
 * callback DIRECTLY and therefore outside any digest.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- payload delivery', () => {
    it('hands the handler the dispatched payload UNMODIFIED', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        expect(handler).toHaveBeenCalledTimes(1);

        // IDENTITY, not equality. `:190` passes `data.data` straight through, and
        // the payload's shape varies by routing key -- which is exactly why the
        // hook types it as the unknown-value rather than as the unsafe
        // escape-hatch type, leaving the consumer that chose the key to narrow it.
        // Any copying, normalising or re-wrapping at the seam would be a functional
        // change (rule T10) and would break a consumer narrowing on identity.
        const [delivered] = handler.mock.calls[0];

        expect(Object.is(delivered, USERSTORY_MESSAGE)).toBe(true);
    });

    it('delivers every message, not only the first', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        const second = { matches: 'userstories.userstory', data: { id: 7 } };

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        mocks.$tgEvents.dispatch(USERSTORIES_KEY, second);

        // A one-shot subscription would look correct in every single-message test
        // and would silently stop a board updating after its first push.
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0]).toBe(second);
    });

    it('delivers nothing for a routing key it did not subscribe to', () => {
        const handler = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler });

        // `:180-181` drops an unknown routing key without comment, so a Kanban
        // consumer must not see a Backlog-only stream: the two screens subscribe
        // deliberately different sets (section 6 of the header).
        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);

        expect(handler).not.toHaveBeenCalled();
    });

    it('lets a handler drive React state, because delivery is outside any digest', () => {
        const { getByTestId } = render(<StatefulConsumer routingKey={USERSTORIES_KEY} />, {
            wrapper: withInjector(mocks.injector),
        });

        expect(getByTestId('received').textContent).toBe('0');

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        act(() => {
            mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);
        });

        // Two pushes, two renders, and no framework bookkeeping in between. The
        // null-scope branch at `:189-190` runs the callback directly rather than
        // through the digest wrapper at `:186`, which is why React state is the
        // right place to land a push and why nothing here -- or in the unit --
        // schedules a digest by hand.
        expect(getByTestId('received').textContent).toBe('2');
    });
});

/* --------------------------------------------------------------------------
 * ⭐ HAZARD H2 -- SUBSCRIPTIONS ARE KEYED GLOBALLY AT `:214`.
 *
 * These specs DOCUMENT the invariant rather than defend against it. A defensive
 * multiplexing registry inside the hook would be an enhancement, and rule T10
 * ("No functional or feature change of any kind") together with the Minimal
 * Change Clause forbid one. Written down executably, the invariant is something a
 * screen author can read: mount ONE `useRealtime` per key, and if two components
 * need the same stream, subscribe once in a shared parent and fan out in React.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- hazard H2, one consumer per routing key', () => {
    it('keeps ONE registry entry per key, so a second consumer of the same key clobbers the first', () => {
        const first = jest.fn<void, [unknown]>();
        const second = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler: first });
        renderConsumer({ routingKey: USERSTORIES_KEY, handler: second });

        // Two subscribes, ONE entry -- because `:214` assigns unconditionally into a
        // single flat map. This is the hazard, reproduced rather than papered over.
        expect(mocks.$tgEvents.service.subscribe).toHaveBeenCalledTimes(2);
        expect(mocks.$tgEvents.registrySize()).toBe(1);

        mocks.$tgEvents.dispatch(USERSTORIES_KEY, USERSTORY_MESSAGE);

        // The FIRST consumer has silently stopped receiving anything. Nothing threw,
        // nothing logged, and its component is still mounted and still rendering.
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps distinct keys fully independent, which is why the invariant is workable', () => {
        const onUserstories = jest.fn<void, [unknown]>();
        const onMilestones = jest.fn<void, [unknown]>();

        renderConsumer({ routingKey: USERSTORIES_KEY, handler: onUserstories });
        renderConsumer({
            routingKey: MILESTONES_KEY,
            handler: onMilestones,
            options: MILESTONE_OPTIONS,
        });

        // The Backlog's real arrangement: two hooks, two keys, one of them carrying
        // the options object (`backlog/main.coffee:271` and `:276`/`:280`).
        expect(mocks.$tgEvents.registrySize()).toBe(2);

        mocks.$tgEvents.dispatch(MILESTONES_KEY, USERSTORY_MESSAGE);

        expect(onMilestones).toHaveBeenCalledTimes(1);
        expect(onUserstories).not.toHaveBeenCalled();
    });
});

/* --------------------------------------------------------------------------
 * ⛔ SOURCE-LEVEL PROHIBITIONS -- the executable form of the migration's
 * repository-wide prohibition greps, narrowed to the unit under test and to this
 * spec itself.
 *
 * A grep protects the moment someone runs it; a test protects every run
 * afterwards. None of these prohibitions is reachable through rendering -- a
 * hand-rolled socket on an untaken branch would render perfectly -- so reading the
 * source is the only way to assert them at all.
 *
 * THE PROHIBITED IDENTIFIERS ARE ASSEMBLED FROM STRING PARTS rather than written
 * out, because the same greps run over this file too: spelling them out would make
 * this spec the very hit it exists to prevent. `./ErrorBoundary.test.tsx:903-933`
 * established the convention in this folder, and `./mockInjector.ts` and
 * `./AngularBridgeContext.tsx` document it.
 * -------------------------------------------------------------------------- */
describe('useRealtime -- source-level prohibitions', () => {
    /** The unit under test, read from disk beside this spec. */
    const unitSource = readFileSync(join(__dirname, 'useRealtime.ts'), 'utf8');

    /** This spec, so the prohibitions apply to the test layer as well. */
    const specSource = readFileSync(join(__dirname, 'useRealtime.test.tsx'), 'utf8');

    /**
     * Strips comments, leaving what actually executes.
     *
     * Documenting a prohibited construct is not committing it -- the unit QUOTES
     * the service's digest-wrapped dispatch branch (`:186`) in its header
     * precisely so a reader understands why the null-scope branch is the one that
     * matters. So the assertions below run against executable source, which is
     * both the honest reading of "never calls" and stricter than a plain grep:
     * a construct hidden behind a trailing comment would still be caught.
     *
     * @param source - the file's text.
     * @returns the same text with block and line comments removed.
     */
    function executableSourceOf(source: string): string {
        return source
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:/])\/\/.*$/gm, '$1');
    }

    /** Every module specifier the file imports from, in source order. */
    function importSpecifiersOf(source: string): string[] {
        const specifiers: string[] = [];
        const pattern = /(?:^|\n)\s*import\s[^;]*?from\s*'([^']+)'/g;
        let match = pattern.exec(source);

        while (match !== null) {
            specifiers.push(match[1]);
            match = pattern.exec(source);
        }

        return specifiers;
    }

    const unitCode = executableSourceOf(unitSource);
    const specCode = executableSourceOf(specSource);

    // Assembled, never written out. See the block comment above.
    const DIGEST_CALLS = [
        `${'$'}${'apply'}`,
        `${'$'}${'applyAsync'}`,
        `${'$'}${'digest'}`,
    ];
    const SOCKET_CONSTRUCTION = `new ${'Web'}${'Socket'}`;
    const SHADOW_ROOT_CALL = `${'attach'}${'Shadow'}`;
    const COMPOSED_KEY_PREFIX = `${['changes', 'project'].join('.')}.`;
    const END_TO_END_RUNNER = `@${'playwright'}/test`;

    it('reads a non-empty unit and a non-empty spec, so the assertions below can fail', () => {
        // Without this, a bad path would turn every `not.toContain` into a
        // guaranteed pass -- the classic way a source-inspection suite rots.
        expect(unitSource.length).toBeGreaterThan(0);
        expect(specSource.length).toBeGreaterThan(0);
        expect(unitCode).toContain('useRealtime');
        expect(specCode).toContain('useRealtime');
    });

    it('never triggers an AngularJS digest, in the unit or in this spec', () => {
        // AAP 0.7.4 is verbatim that React code must "never" call the root scope's
        // apply method. Digest cycles remain AngularJS's concern: the null-scope
        // dispatch branch at `:189-190` already runs outside one, and the shared
        // HTTP provider is configured to schedule its own
        // (`app/coffee/app.coffee:604`).
        DIGEST_CALLS.forEach((call: string): void => {
            expect(unitCode).not.toContain(call);
            expect(specCode).not.toContain(call);
        });
    });

    it('never constructs a realtime transport of its own', () => {
        // Rule T5 and requirement I7: the connection belongs to the service, whose
        // `onError` (`:262-270`), `onClose` (`:272-278`) and `randomTryInterval`
        // (`:280-284`) own reconnection, and whose `sendMessage` (`:165-176`) queues
        // while disconnected. A second socket would double every push and reconnect
        // on its own schedule.
        expect(unitCode).not.toContain(SOCKET_CONSTRUCTION);
        expect(specCode).not.toContain(SOCKET_CONSTRUCTION);
    });

    it('never creates a shadow root', () => {
        // Requirement I6: light DOM only. A shadow boundary would sever the single
        // global stylesheet's cascade and break every sprite reference, unstyling
        // both migrated screens and blanking their icons.
        expect(unitCode).not.toContain(SHADOW_ROOT_CALL);
        expect(specCode).not.toContain(SHADOW_ROOT_CALL);
    });

    it('imports no end-to-end runner, keeping the unit layer browserless', () => {
        // Requirement HR-5: `npm test` must pass in jsdom with no browser binary
        // installed. One import of the end-to-end runner would drag a browser
        // launcher into the unit layer.
        expect(specSource).not.toContain(END_TO_END_RUNNER);
        expect(unitSource).not.toContain(END_TO_END_RUNNER);
    });

    it('hardcodes NO routing key -- keys are composed by the caller', () => {
        // Goal G2 freezes the routing keys, and the callers own them: the Kanban and
        // Backlog realtime hooks compose them from the live project id, which is not
        // known until the project resolves. A key literal inside the hook would make
        // it a Kanban hook or a Backlog hook rather than the shared seam it is -- and
        // the two screens subscribe deliberately different sets.
        //
        // Asserted on the RAW source, comments included, because the prohibition is
        // documentary as much as behavioural: a key spelled out in a comment invites
        // the next reader to copy it into code. This spec obeys the same rule, which
        // is why every fixture above goes through `projectRoutingKey`.
        expect(unitSource).not.toContain(COMPOSED_KEY_PREFIX);
        expect(specSource).not.toContain(COMPOSED_KEY_PREFIX);

        // ...and the fixtures really do compose real keys, so the two assertions
        // above are not passing for want of any key at all. Compared segment by
        // segment, because comparing against a composed literal would itself put
        // one in this file and falsify the assertions above.
        expect(USERSTORIES_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'userstories',
        ]);
        expect(MILESTONES_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'milestones',
        ]);
        expect(PROJECTS_KEY.split('.')).toEqual([
            'changes',
            'project',
            String(PROJECT_ID),
            'projects',
        ]);
    });

    it('imports nothing but React and the typed service accessor', () => {
        // One assertion, three constraints. No transport client of any kind (rule
        // T5). No stylesheet, so rule T1's pass-through Sass stays untouched and no
        // new class name can appear. And no package outside the closed pinned set
        // (requirement HR-2) -- notably no realtime or socket-mocking library, which
        // a three-member double makes unnecessary.
        expect(importSpecifiersOf(unitSource)).toEqual(['react', './useAngularService']);
    });

    it('imports only the whitelisted bridge modules and the pinned test libraries', () => {
        // This spec's own dependency surface, kept deliberately small: two Node
        // built-ins for this source-inspection block, React and the pinned testing
        // library, and the three sibling bridge modules it is written against --
        // including `./mockInjector`, the mandated mocking seam, which is why no
        // framework is loaded and `jest.config.js` needs no `setupFiles` entry.
        //
        // De-duplicated, because a value import and a type-only import from the same
        // module are two statements and one dependency.
        expect([...new Set(importSpecifiersOf(specSource))]).toEqual([
            'fs',
            'path',
            '@testing-library/react',
            'react',
            './AngularBridgeContext',
            './mockInjector',
            './useRealtime',
        ]);
    });

    it('resets no mock by hand, because jest.config.js already does', () => {
        // `clearMocks` and `restoreMocks` are both true. Hand-resetting would
        // duplicate that and, worse, would imply to a reader that the configuration
        // cannot be trusted -- after which someone removes the config keys and every
        // spec that forgot the manual reset starts leaking mock state.
        expect(specCode).not.toContain(`${'clear'}AllMocks`);
        expect(specCode).not.toContain(`${'restore'}AllMocks`);
        expect(specCode).not.toContain(`${'reset'}AllMocks`);
    });

    it('builds no persistent-collection fixture: React receives plain objects only', () => {
        // P-IMMER-1: flattening happens on the AngularJS side of the seam
        // (`app/modules/components/project-menu/project-menu.controller.coffee:27`),
        // so no persistent collection and no dirty-tracked model instance ever
        // reaches a React prop -- unlike the incumbent Karma specs, which build them
        // throughout (`move-to-sprint.controller.spec.coffee:25`, `:81-85`, `:95-98`).
        // The library's name is assembled from parts for the reason given at the top
        // of this block: the migration's greps run over this file too.
        expect(specSource).not.toContain(`${'Immut'}${'able'}`);
        expect(unitSource).not.toContain(`${'Immut'}${'able'}`);
    });
});
