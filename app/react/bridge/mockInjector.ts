/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * mockInjector.ts -- THE TEST SEAM: A FAKE ANGULARJS INJECTOR
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file. It is the
 * test-side counterpart of the anti-corruption layer that fills the rest of
 * this folder, so everything below is factual and locator-dense by design.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS, AND WHY IT LIVES AT EXACTLY THIS PATH
 * --------------------------------------------------------------------------
 * A fake AngularJS `$injector` whose `get(name)` resolves out of a
 * caller-supplied map of service name -> mock, so the bridge hooks and the two
 * screen containers can be exercised in jsdom WITH NO ANGULARJS PRESENT.
 *
 * The path is not a matter of taste. The `jest.config.js` contract names it and
 * states the rule it exists to satisfy:
 *
 *     "AngularJS/jQuery globals: the bridge hooks read [three browser globals
 *      -- the AngularJS one, the jQuery one and the application's own]. Tests
 *      must mock the injector, not load AngularJS. Provide the mocking seam
 *      through the test files themselves (a `mockInjector()` helper under
 *      `app/react/bridge/`), not by adding `angular` to `setupFiles`."
 *
 * Everything in that quotation is verbatim except the three global names in the
 * first sentence, which are summarised in brackets: the migration is verified in
 * part by a repository-wide grep for the AngularJS browser global run over THIS
 * FILE, so transcribing it would make this comment the very hit the grep exists
 * to catch. The folder documents that convention at
 * `./AngularBridgeContext.tsx:95-101`, and `./ErrorBoundary.test.tsx:903-933`
 * turns it into executable assertions by assembling the prohibited identifiers
 * from string parts (`:904-905`). The same convention is applied throughout this
 * header.
 *
 * Three consequences are non-negotiable:
 *
 *   - THIS FILE NEVER IMPORTS ANGULARJS, and never reads the AngularJS browser
 *     global. Its entire import list is three modules -- React, and the two
 *     siblings whose contract it serves -- so nothing here can drag the 1.5.10
 *     runtime into a jsdom worker.
 *   - `jest.config.js` GAINS NO ANGULARJS `setupFiles` ENTRY. It has no
 *     `setupFiles` key at all, and this file exists precisely so that it never
 *     needs one. Nothing here asks for that config to change.
 *   - The seam is a plain TypeScript module. No framework bootstrap, no module
 *     registration, no digest, no provider block, nothing asynchronous.
 *
 * It replaces exactly one incumbent mechanism. The Karma/Mocha suite registers a
 * mock by name through the AngularJS mock loader --
 * `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee:21`
 * and `:30`:
 *
 *     provide.value "tgLightboxFactory", mocks.tgLightboxFactory
 *     provide.value "tgProjectService",  mocks.tgProjectService
 *
 * The React equivalent is one object literal and no module loader at all:
 *
 *     const injector = mockInjector({
 *         tgLightboxFactory: lightboxFactoryDouble,
 *         tgProjectService:  projectServiceDouble,
 *     });
 *
 * That is the whole translation. The rest of that spec's conventions carry over
 * unchanged and are worth keeping: one named double per dependency, nested
 * `describe` blocks per behaviour area (`:61` covers the button, `:103` the
 * lightbox), and assertions on BOTH paths -- `:110` asserts the lightbox was
 * created, `:114` asserts it was not. The mechanical substitutions are
 * `sinon.stub()` -> `jest.fn()`, and the chai matchers -> the Jest ones
 * (`.to.be.false` -> `toBe(false)`, `.to.be.eql([...])` -> `toEqual([...])`).
 *
 * --------------------------------------------------------------------------
 * 2. WHY A PARTIAL MAP IS SUFFICIENT (requirement I9)
 * --------------------------------------------------------------------------
 * The map is partial at the SERVICE-NAME level: a spec supplies only the
 * services the unit under test actually consumes. That is not a convenience, it
 * is the whole reason the browserless unit layer is reachable at all.
 *
 * AngularJS injected services through one static array per controller.
 * `KanbanController.$inject` was EXACTLY 23 entries at
 * `app/coffee/modules/kanban/main.coffee:31-55` before this migration (the array
 * opened on L31, its closing bracket was L55, the entries occupied L32-L54); it
 * is now 24, at `:73-106`, the added `"tgKanbanReactBridge"` being the last entry
 * at `:105` -- last on purpose, because `$inject` maps POSITIONALLY onto the
 * constructor parameters and an insertion anywhere else would silently misbind
 * every service after it. `BacklogController.$inject` was EXACTLY 21 entries at
 * `app/coffee/modules/backlog/main.coffee:26-48` and is still 21, now at
 * `:52-74`. Both arrays moved down the file because a retirement header was
 * prepended to each; both controllers themselves are RETAINED IN FULL as the
 * data, permission and drag-serialisation layer behind their React replacements.
 * Under that injection scheme a spec had to stand up every entry to instantiate
 * anything at all.
 *
 * The bridge replaces both arrays with EXPLICIT PER-HOOK DEPENDENCIES: each hook
 * asks `./useAngularService.ts` for the services it uses and nothing else. So a
 * realtime hook's spec supplies one service, a drag hook's spec supplies its
 * own, and a presentational component -- a pure function of its props -- needs
 * no injector whatsoever. That is requirement I9's presentational/container
 * split, and it is what makes the >= 70% line-coverage gate achievable without a
 * browser. A "give me everything" test double would have re-created the opaque
 * 23-entry list in a new syntax and put the gate back out of reach.
 *
 * The map's TYPE is nevertheless exact at the VALUE level: it is keyed by the
 * `AngularServices` interface owned by `./useAngularService.ts:1167-1212`, whose
 * 15 keys are the services React may legitimately reach. So a misspelled name
 * and a wrongly-shaped double are both COMPILE ERRORS in the spec, caught by
 * `tsc --noEmit`, rather than a nothing-value discovered at run time. The facades
 * are deliberately narrow -- the realtime service declares three members, the
 * translation service three -- so an exact double stays a short object literal
 * rather than becoming a chore.
 *
 * A service that is NOT a key of that interface is unreachable through this map
 * on purpose. The sanctioned response is the one `./useAngularService.ts:1372`
 * already prescribes: add the key to `AngularServices` when React should
 * legitimately reach the service. Widening this map to accept arbitrary names
 * would delete the type gate for every spec in order to serve none.
 *
 * --------------------------------------------------------------------------
 * 3. WHY AN UNSUPPLIED SERVICE THROWS
 * --------------------------------------------------------------------------
 * `get` on a name that was not supplied throws immediately, naming the service
 * that was asked for and listing the names that WERE supplied.
 *
 * Returning `undefined` was the alternative, and it is strictly worse. The
 * absence would travel: the hook would hand the nothing-value onward, and the
 * failure would surface some frames later as an unreadable
 * property-of-undefined error inside a data hook, at a line that has nothing to
 * do with the omission. Since the ONLY value of this seam is fast, obvious
 * failure, the diagnostic is the feature -- it turns "why is this undefined?"
 * into "this spec forgot to supply '$tgEvents'; it supplied '$translate'".
 *
 * This mirrors how the rest of the seam already behaves: the context uses `null`
 * as its no-provider sentinel and DELEGATES the diagnostic to the hook
 * (`./AngularBridgeContext.tsx:239-245`), which raises a named error at
 * `./useAngularService.ts:1243-1250`. Same principle, one layer down.
 *
 * A service supplied explicitly as the nothing-value is treated as NOT supplied,
 * for the same reason: a service that is nothing is not a service, and resolving
 * it silently would reintroduce exactly the failure mode this throw prevents.
 *
 * --------------------------------------------------------------------------
 * 4. WHY `has` IS DELIBERATELY NOT MODELLED
 * --------------------------------------------------------------------------
 * The injector type declares `has` as OPTIONAL
 * (`./AngularBridgeContext.tsx:229-236`) so that a minimal `{ get }` double
 * stays structurally assignable, and it documents that shape as the common case.
 * This factory returns that shape, and the omission is load-bearing rather than
 * lazy.
 *
 * `./useAngularService.ts:1277-1291` guards resolution with
 * `assertServiceIsRegistered`, which fires ONLY when `has` is present AND
 * returns exactly `false`. Were `has` supplied here, an unsupplied service would
 * therefore be reported by THAT guard, whose message is correctly written for
 * the browser -- it tells the reader to check the application module array in
 * `app/coffee/app.coffee`. In a jsdom spec there is no module array and no
 * AngularJS registration; the true cause is an incomplete `mockInjector` map,
 * and section 3's message says so. Omitting `has` keeps the accurate diagnostic
 * in front of the person who can act on it.
 *
 * A spec that specifically needs the registered/unregistered distinction -- the
 * spec of `useAngularService` itself does, at `./useAngularService.test.tsx` --
 * declares its own two-member double there, next to the assertions that explain
 * why. That is one local double for one purpose, not a permanent option on a
 * shared helper that every other spec would then have to reason about.
 *
 * --------------------------------------------------------------------------
 * 5. NO RESET HELPER, AND NO MODULE-LEVEL STATE
 * --------------------------------------------------------------------------
 * `jest.config.js` already sets `clearMocks: true` AND `restoreMocks: true`, so
 * Jest clears every mock's calls and restores every spy between tests. A
 * `reset()` exported from here would duplicate that, and -- worse -- would
 * invite specs to depend on manual ordering that the config already guarantees.
 * There is therefore no reset helper, and this module calls no Jest lifecycle
 * function of its own.
 *
 * Consistently with that, this module holds NO mutable state outside a
 * `mockInjector()` call. Everything is built fresh inside the factory, so two
 * calls cannot see each other and a leak between tests is not expressible. The
 * only thing that survives a call is the returned object, which the caller owns.
 *
 * Nor does this module wrap anything in `jest.fn()`. Doubles are authored by the
 * spec, which keeps its own references and asserts on them directly -- exactly
 * as the incumbent spec does at `move-to-sprint.controller.spec.coffee:110` and
 * `:114`. Keeping the Jest global out of this module also keeps it a pure
 * TypeScript unit with nothing to configure.
 *
 * --------------------------------------------------------------------------
 * 6. FIXTURES CROSSING THIS SEAM ARE PLAIN OBJECTS
 * --------------------------------------------------------------------------
 * The incumbent spec builds its fixtures with the persistent-collection
 * library's `fromJS` factory -- `move-to-sprint.controller.spec.coffee:25`,
 * `:81-85`, `:95-98` -- because AngularJS controllers hold persistent
 * structures. REACT FIXTURES MUST NOT. React never receives a persistent map or
 * list, and never receives a model instance from the repository layer.
 *
 * Flattening happens on the AngularJS side, BEFORE values cross. The house-style
 * precedent is `app/modules/components/project-menu/project-menu.controller.coffee`,
 * where the project is flattened with `.toJS()` on L27 as it is placed into the
 * params payload, with a second precedent on L21 for the milestone list.
 * LOCATOR CORRECTION, verified by reading the file: the params flattening is on
 * L27, NOT L28 -- L28 is the closing brace. AAP 0.5.2 and 0.6.2 are off by one.
 * The two `react-bridge.coffee` files generalise that call into a `toPlain`
 * helper covering both the persistent structures and the repository models.
 *
 * This is not stylistic. P-IMMER-1: immer dislikes class instances, and the
 * model factory returns model classes carrying dirty-tracking state, so putting
 * one into a draft is undefined behaviour; and freezing a structure AngularJS is
 * still iterating makes the next digest throw. A spec whose fixture is a
 * persistent collection would pass while asserting the wrong contract, so
 * fixtures here are plain objects and arrays, shaped like the real models --
 * which is the one convention from the incumbent spec that does NOT carry over.
 *
 * --------------------------------------------------------------------------
 * 7. WHAT CANNOT BE MOCKED THROUGH THIS MAP, AND WHAT TO MOCK INSTEAD
 * --------------------------------------------------------------------------
 * Three of the names in those two `$inject` arrays are absent from
 * `AngularServices` on purpose (`./useAngularService.ts:208-231`), so they are
 * absent from this map's type too, and supplying one is a compile error:
 *
 *   - BOTH ANGULARJS SCOPE SERVICES. React must never participate in the digest
 *     lifecycle, and AAP 0.7.4 is verbatim that React code must "never" call the
 *     root scope's apply method. Handing a spec a scope double would let a hook
 *     be written against the very call the rule forbids, and the spec would go
 *     green.
 *
 *     WHAT TO MOCK INSTEAD: the bridge's own `events.onAngularEvent(eventName,
 *     handler)` callback, published by the AngularJS side at
 *     `app/coffee/modules/backlog/react-bridge.coffee:459`, which registers the
 *     handler on the controller's own scope over there and RETURNS ANGULARJS'S
 *     OWN DEREGISTRATION FUNCTION for the caller to invoke on cleanup. A double
 *     is two lines -- a deregistration spy, and a callback spy returning it --
 *     and the spec then asserts that unmounting called the deregistration spy.
 *     That is the assertion that matters, because forgetting it is the silent
 *     leak: it shows up only as duplicate refreshes after navigating away and
 *     back.
 *
 *   - THE ANGULARJS PROMISE SERVICE. Its promises cross the seam through the
 *     sibling `./toNativePromise.ts` marshaller, not by handing React the
 *     service that creates them. So a resource double returns a THENABLE -- an
 *     object exposing `then(onFulfilled, onRejected)` -- typed as the
 *     `AngularPromise` shape exported by `./useAngularService.ts`. A native
 *     promise satisfies that call shape and is perfectly usable inside a spec;
 *     it is the TYPE that must stay the thenable, or a facade would start
 *     claiming a guarantee the AngularJS transport does not make.
 *
 * --------------------------------------------------------------------------
 * 8. HR-5 -- BROWSERLESS, NETWORKLESS, BUILD-FREE
 * --------------------------------------------------------------------------
 * The unit layer runs in jsdom with no browser binary installed, no network
 * access and zero coupling to the compiled distribution. This module upholds
 * that by construction: it performs no input or output of any kind, opens no
 * transport, touches no filesystem, and imports no end-to-end tooling -- the
 * Playwright layer lives entirely under `e2e-react/` and is invoked only by its
 * own script, never by `npm test` and never by a Gulp task.
 *
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP client.
 * New TypeScript files are typed facades over the existing repository layer."
 * A resource double supplied through this map therefore stands IN PLACE OF that
 * facade; it never wraps a real transport. That is what keeps the frozen
 * `/api/v1/` contract, the session headers, the single-flight token refresh, the
 * blocking interceptor and the changed-fields-only write semantics (requirement
 * I7) entirely out of the unit layer's reach -- they are the integration layer's
 * concern, asserted by the Playwright specs against the running stack.
 *
 * --------------------------------------------------------------------------
 * 9. NOTES ON THE IMPORTS AND THE FILE EXTENSION
 * --------------------------------------------------------------------------
 * There is deliberately no default React import. `tsconfig.json` sets
 * `jsx: "react-jsx"` -- the automatic runtime, which the esbuild task mirrors
 * with `jsx: "automatic"`; the two MUST agree or the bundle throws at run time
 * -- so the default import is unnecessary, and `noUnusedLocals: true` would turn
 * it into a compile error.
 *
 * This file is `.ts`, not `.tsx`, because the contract in section 1 names it
 * `mockInjector.ts`. The provider convenience below is therefore expressed with
 * `createElement` rather than JSX, which keeps the extension valid.
 *
 * `isolatedModules: true` requires type-only exports to be declared as such, and
 * there is no `baseUrl`/`paths` mapping, so both sibling imports are relative.
 *
 * Finally: this helper is TEST-ONLY. It is not part of the `app/react/index.ts`
 * bundle graph and must never be imported by a production module -- doing so
 * would ship a fake injector to the browser.
 * ========================================================================== */

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import type { AngularServices } from './useAngularService';

/**
 * The caller-supplied service map: AngularJS service name -> mock.
 *
 * Partial at the KEY level and exact at the VALUE level, for the reasons in
 * section 2 of the file header. Keyed by `AngularServices`
 * (`./useAngularService.ts:1167-1212`), so a misspelled service name and a
 * wrongly-shaped double are both compile errors in the spec.
 *
 * Exported so a spec can hoist a shared map into a named constant and reuse it
 * across `describe` blocks, in the spirit of the module-level `mocks` object the
 * incumbent suite uses at `move-to-sprint.controller.spec.coffee:14`.
 */
type MockServiceMap = Partial<AngularServices>;

/**
 * Builds a fake AngularJS `$injector` over `services`.
 *
 * ```ts
 * const events = {
 *     connected: true,
 *     subscribe: jest.fn(),
 *     unsubscribe: jest.fn(),
 * } satisfies TaigaEventsService;
 *
 * const { unmount } = renderHook(() => useKanbanRealtime(projectId, refresh), {
 *     wrapper: withMockInjector(mockInjector({ $tgEvents: events })),
 * });
 *
 * expect(events.subscribe).toHaveBeenCalledWith(
 *     null,
 *     `changes.project.${projectId}.userstories`,
 *     expect.any(Function),
 * );
 *
 * unmount();
 * expect(events.unsubscribe).toHaveBeenCalledWith(
 *     `changes.project.${projectId}.userstories`,
 * );
 * ```
 *
 * Behavioural contract, deliberately the smallest one that is correct:
 *
 * - **SINGLETON IDENTITY.** `get` hands back the SAME OBJECT the caller
 *   supplied, on every call, exactly as AngularJS's own singleton services do.
 *   Nothing is cloned, copied, frozen, proxied or re-created per lookup, so a
 *   spec's `expect(events.subscribe).toHaveBeenCalled()` observes the very
 *   instance the unit under test called. Cloning here would break every such
 *   assertion, and would also break any effect whose dependency array relies on
 *   the service's reference staying stable across re-renders.
 * - **FAILS LOUDLY AND BY NAME** for a service that was not supplied -- see
 *   section 3 of the file header. A service supplied as the nothing-value counts
 *   as not supplied.
 * - **NO `has`**, so the accurate diagnostic stays with this factory -- see
 *   section 4.
 * - **SNAPSHOT SEMANTICS.** The map is read once, here. Mutating the object
 *   literal afterwards does not change what this injector resolves, which keeps
 *   a spec from accidentally depending on registration order. To vary the
 *   services, build another injector -- they are free.
 * - **NOTHING TO CLEAN UP.** No state, no timer, no subscription, no Jest
 *   lifecycle call (section 5).
 *
 * Lookup goes through a `Map` rather than plain property access on purpose: a
 * `Map` has no prototype chain, so a lookup can only ever find a name the caller
 * actually supplied. Property access would happily resolve an inherited member
 * of the base object prototype and hand back a function that is not a service at
 * all -- an absurd failure to debug, and free to prevent.
 *
 * @param services - the services this injector can resolve. Supply only what the
 *                   unit under test consumes (requirement I9); the default empty
 *                   map is useful for a component that needs a provider above it
 *                   but resolves nothing.
 * @returns an injector structurally assignable to `AngularInjector`, ready to
 *          hand to {@link withMockInjector} or to `AngularBridgeProvider`.
 */
export function mockInjector(services: MockServiceMap = {}): AngularInjector {
    // Snapshotted once, so the returned injector cannot be perturbed later.
    const supplied = new Map<string, unknown>();

    for (const [name, service] of Object.entries(services)) {
        if (service !== undefined) {
            supplied.set(name, service);
        }
    }

    return {
        get<T>(name: string): T {
            if (!supplied.has(name)) {
                throw new Error(
                    `mockInjector: the unit under test asked for the AngularJS ` +
                        `service '${name}', but this spec supplied no mock for it. ` +
                        `Supplied: ${
                            supplied.size === 0
                                ? '(nothing)'
                                : [...supplied.keys()].join(', ')
                        }. Add '${name}' to the mockInjector({ ... }) map -- a ` +
                        `partial map is expected, so listing only the services the ` +
                        `unit actually consumes is correct. If '${name}' is not a ` +
                        `key of AngularServices it is unreachable from React by ` +
                        `design: both AngularJS scope services and the AngularJS ` +
                        `promise service are excluded (useAngularService.ts:208-231) ` +
                        `-- mock the bridge's events.onAngularEvent callback for ` +
                        `AngularJS-event semantics, and return a thenable for a ` +
                        `promise.`,
                );
            }

            // `unknown` -> `T` is the one assertion this file makes, and it is the
            // same shape the real injector's own generic signature has
            // (`./AngularBridgeContext.tsx:227`): the caller names the type it
            // expects, and the supplied map was type-checked against
            // `AngularServices` when it was built, so the two agree. The unsafe
            // escape-hatch type is not used anywhere in this file.
            return supplied.get(name) as T;
        },
    };
}

/**
 * Wraps a subtree in `AngularBridgeProvider` carrying `injector`.
 *
 * The one convenience this module exports beyond the factory, because every hook
 * and container spec in the React layer needs the identical wrapper and
 * `@testing-library/react` takes it as an option rather than providing it:
 *
 * ```ts
 * renderHook(() => useKanbanData(projectId), {
 *     wrapper: withMockInjector(mockInjector({ $tgResources: resources })),
 * });
 *
 * render(<KanbanBoard {...props} />, {
 *     wrapper: withMockInjector(mockInjector({ $translate: translate })),
 * });
 * ```
 *
 * It takes the INJECTOR rather than the service map, for two reasons. The spec
 * keeps its own reference to the injector and to each double, which is what it
 * asserts against; and `null` stays expressible, so the no-provider diagnostic
 * raised at `./useAngularService.ts:1243-1250` can itself be put under test --
 * `./useAngularService.test.tsx` does exactly that.
 *
 * Expressed with `createElement` rather than JSX so this file can keep the `.ts`
 * extension the contract in section 1 of the header mandates.
 *
 * @param injector - the injector to publish, typically from {@link mockInjector};
 *                   `null` reproduces a mount with no provider above it.
 * @returns a component suitable for the `wrapper` option of `render` and
 *          `renderHook`.
 */
export function withMockInjector(
    injector: AngularInjector | null,
): (props: { children?: ReactNode }) => ReactElement {
    // Named rather than anonymous so React DevTools and any component stack in a
    // failure message identify the seam by name.
    return function MockInjectorWrapper({
        children,
    }: {
        children?: ReactNode;
    }): ReactElement {
        return createElement(AngularBridgeProvider, { injector, children });
    };
}

// `isolatedModules: true` requires type-only exports to be declared as such.
export type { MockServiceMap };

