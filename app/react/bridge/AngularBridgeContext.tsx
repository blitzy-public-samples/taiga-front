/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * AngularBridgeContext.tsx -- THE ANGULARJS/REACT SERVICE-INJECTION SEAM
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") applies with full force here: this
 * folder is the anti-corruption layer of a strangler-fig migration, and this
 * file is its narrowest and most load-bearing joint. Everything below is
 * factual and locator-dense by design.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS
 * --------------------------------------------------------------------------
 * A React context whose value is the live AngularJS `$injector`, plus the
 * provider that publishes it. It is the ONLY channel by which React code
 * reaches an AngularJS service, and it is the substitute for AngularJS's
 * static `$inject` constructor injection -- which React components cannot use.
 *
 * The migration is incremental coexistence, not a rewrite: the AngularJS
 * 1.5.10 shell keeps owning routing, the project rail and every screen outside
 * Kanban and Backlog, and BOTH screen controllers survive intact as the data,
 * permission and drag-serialisation layer behind their React replacements.
 * React is mounted inside that shell through the `tg-react-loader` custom
 * element, fed by the UNMODIFIED `tgLoadElement` directive
 * (`app/coffee/modules/base/load-element.coffee:17-39`, registered on the
 * `taigaBase` module at `:15`), which assigns `.component` (`:24`), `.params`
 * (`:27`) and `.events` (`:30`) onto the host element as DOM PROPERTIES rather
 * than attributes -- attributes stringify, properties do not, which is the
 * whole reason nested objects and callbacks survive the crossing.
 *
 * The AngularJS-side publishers (`app/coffee/modules/kanban/react-bridge.coffee`
 * and `app/coffee/modules/backlog/react-bridge.coffee`) deliberately pass NO
 * injector through `params`/`events`; the injector is acquired on the React
 * side for the element's lifetime and handed to `AngularBridgeProvider` as a
 * prop. This file therefore performs no lookup of its own -- it only carries.
 *
 * Consumption is via the sibling `useAngularService` hook, which reads this
 * context. The uniform transformation (AAP 0.7.4) is:
 *
 *     Old: @.$inject = ["$tgResources", "$tgEvents", "$tgConfirm"]
 *     New: const rs = useAngularService('$tgResources');
 *
 * --------------------------------------------------------------------------
 * 2. THE SCALE THIS REPLACES (measured, with locator corrections)
 * --------------------------------------------------------------------------
 *   - `KanbanController.$inject`  = EXACTLY 23 entries, at
 *     `app/coffee/modules/kanban/main.coffee:31-55` (the list opens on L31 and
 *     the closing bracket is L55; entries occupy L32-L54). It becomes 24 once
 *     `"tgKanbanReactBridge"` is appended. CORRECTION: the folder brief cites
 *     L30-L53; the verified locator is L31-L55.
 *   - `BacklogController.$inject` = EXACTLY 21 entries, at
 *     `app/coffee/modules/backlog/main.coffee:26-48` (list opens L26, closes
 *     L48, entries L27-L47). CORRECTION: AAP 0.5.2 states 23 services for this
 *     controller; the verified count is 21.
 *
 * Those two opaque lists become EXPLICIT PER-HOOK DEPENDENCIES: each React hook
 * asks the injector only for the services it actually uses. That is precisely
 * what makes the browserless Jest layer viable (requirement I9) -- a hook's
 * spec mocks two services instead of standing up twenty-three.
 *
 * --------------------------------------------------------------------------
 * 3. WHAT THIS CONTEXT MUST NEVER CARRY
 * --------------------------------------------------------------------------
 * The context carries EXACTLY ONE thing: the `$injector`. Each exclusion below
 * protects a documented invariant, and each is a correctness rule, not taste.
 *
 *   - EITHER ANGULARJS SCOPE SERVICE -- neither the application root scope nor
 *     a directive scope may cross. React must never participate in the digest
 *     lifecycle: AAP 0.7.4 is verbatim that React code must "never" call the
 *     root scope's apply method. Digest cycles remain AngularJS's concern and
 *     React state updates are driven by React, so handing React a scope only
 *     invites the one call the rule forbids.
 *   - `$q` -- AngularJS promises cross the seam through the sibling
 *     `toNativePromise.ts` marshaller, not by handing React a `$q` reference.
 *   - ANY `immutable` COLLECTION (its Map or its List) -- flattening happens on
 *     the AngularJS side, before the boundary (see 4), so React never receives
 *     a persistent collection. The `immutable` package itself stays installed
 *     for the 124 out-of-scope files that still use it (requirement I5).
 *   - A `$tgModel` instance -- P-IMMER-1: immer dislikes class instances, and
 *     `$tgModel` returns model classes carrying dirty-tracking state, so
 *     putting one into an immer draft is undefined behaviour.
 *   - A hand-rolled HTTP client -- see rule T5 in 5.
 *   - Any per-screen data -- this is an anti-corruption layer, not a store.
 *     Board and backlog state live in `../kanban/state/**` and
 *     `../backlog/state/**`, reduced with `useReducer(produce(reducer), init)`.
 *
 * Every one of those prohibitions is enforced by a mechanical scan of this
 * folder, so the banned identifiers appear NOWHERE in this file -- not even
 * inside a comment, which is why they are named descriptively above. The scan
 * covers both scope services, the three digest-entry methods, the AngularJS
 * HTTP service, the browser XHR and request APIs, third-party HTTP clients,
 * the `immutable` collections, React's raw-HTML injection prop, shadow-root
 * attachment, and the unsafe escape-hatch type.
 *
 * The shadow-DOM prohibition (requirement I6) is absolute across
 * `app/react/**`: the single global stylesheet is loaded at
 * `app/index.jade:25` (`#{v}/styles/theme-taiga.css`) and a shadow root would
 * sever that cascade, collapsing rule T1's pass-through-Sass strategy; and
 * icons resolve `<use href="#icon-add">` against the 126-symbol sprite inlined
 * at `app/index.jade:96` (with `svg/editor.svg` at `:97`), which a shadow root
 * would break. React renders into LIGHT DOM only.
 *
 * --------------------------------------------------------------------------
 * 4. THE `.toJS()` BOUNDARY-FLATTENING HOUSE STYLE
 * --------------------------------------------------------------------------
 * The established precedent is
 * `app/modules/components/project-menu/project-menu.controller.coffee`:
 *
 *     @.projectMenu = {
 *         component: 'tg-project-navigation',
 *         params: {
 *             project: @projectService.project.toJS(),   # <- L27
 *         },
 *         events: { search: () => @.search() }
 *     }
 *
 * LOCATOR CORRECTION (verified by reading the file): the `.toJS()` call is on
 * L27, NOT L28 -- L28 is the closing brace. AAP 0.5.2 and 0.6.2 are off by
 * one. A second `.toJS()` precedent sits at L21
 * (`@.project.get('milestones')?.toJS()`).
 *
 * `.toJS()` is the most load-bearing detail in the whole seam: the `immutable`
 * library's structures are flattened to plain JavaScript AT THE BOUNDARY. That
 * is the house style, and it is exactly what immer requires. The two
 * `react-bridge.coffee` files generalise it:
 *
 *     toPlain = (value) ->
 *         return value if not value?
 *         return value.toJS() if angular.isFunction(value.toJS)
 *         return value.getAttrs() if angular.isFunction(value.getAttrs)
 *         return value
 *
 * (`$tgModel.getAttrs(patch = false)` at `app/coffee/modules/base/model.coffee:48-54`
 * returns `_.extend({}, @._attrs, @._modifiedAttrs)`.)
 *
 * FLATTENING HAPPENS ON THE ANGULARJS SIDE, BEFORE VALUES CROSS. This context
 * deliberately carries no data, so it needs no flattening of its own -- and no
 * React file should add one here.
 *
 * The remaining immer pitfalls, recorded for the readers of
 * `../kanban/state/**` and `../backlog/state/**` because this is the file that
 * states the boundary rule: P-IMMER-2 `console.log(draft)` THROWS a TypeError
 * on a Proxy draft, so use `JSON.stringify` or immer's `current()`; P-IMMER-3
 * never reassign the draft parameter and never mix draft mutation with an
 * explicit return in one producer; P-IMMER-4 keep `autoFreeze` ON, so
 * structural sharing yields reference equality on untouched branches and
 * `React.memo` becomes a genuine replacement for persistent-collection change
 * detection -- composed as `useReducer(produce(reducer), init)`, with no
 * `use-immer` dependency.
 *
 * --------------------------------------------------------------------------
 * 5. RULE T5 -- NO PARALLEL HTTP CLIENT (verbatim)
 * --------------------------------------------------------------------------
 *     "Reuse `$tgResources`; do not build a parallel HTTP client. New
 *      TypeScript files are typed facades over the existing repository layer."
 *
 * Every request therefore reaches the backend through the service graph this
 * injector exposes, so React inherits rather than re-derives: the
 * `Authorization: Bearer` header (`app/coffee/modules/base/http.coffee:21-23`),
 * the `X-Session-Id` header (`app/coffee/app.coffee:590-602`), the
 * single-flight 401 refresh, the 400-with-`version` VERSION_ERROR toast, the
 * 451 blocking interceptor, and -- most importantly -- `$tgModel`'s
 * changed-fields-only PATCH carrying the optimistic-concurrency `version`
 * (requirement I7). A bespoke client would silently start sending full-object
 * writes, turning every concurrent edit into a lost update. Hence no direct use
 * of the browser request or XHR APIs, no third-party HTTP client and no direct
 * use of the AngularJS HTTP service anywhere in `app/react/bridge/`.
 *
 * --------------------------------------------------------------------------
 * 6. WHY THE PROVIDED VALUE IS STABLE
 * --------------------------------------------------------------------------
 * The injector prop is published AS-IS, with no wrapper object, so the context
 * value's identity is the caller's identity -- one injector per bootstrapped
 * AngularJS application, held for the host element's lifetime. Nothing is
 * allocated per render, so there is nothing to memoise: a `useMemo` here would
 * add a dependency array and buy nothing. This matters because a context value
 * that changed identity on every render would re-render every consumer of every
 * bridge hook on every parent render -- on a board of hundreds of cards.
 *
 * For the same reason this file holds no state, runs no effects and owns no
 * reducer. It is a pure carrier.
 *
 * EXPORTED CONTRACT (consumed by `useAngularService.ts`, `ReactHostElement.ts`,
 * `mockInjector.ts` and the co-located specs):
 *   - `AngularBridgeContext`  -- the context object itself
 *   - `AngularBridgeProvider` -- the provider component
 *   - `AngularInjector`, `AngularBridgeContextValue`,
 *     `AngularBridgeProviderProps` -- types, exported through an explicit
 *     `export type` block as `isolatedModules: true` requires
 *
 * Note on the imports below: there is deliberately NO `import React from
 * 'react'`. `tsconfig.json` sets `jsx: "react-jsx"` (the automatic runtime,
 * which esbuild mirrors with `jsx: "automatic"` -- the two MUST agree or the
 * bundle throws `React is not defined` at runtime), so the default import is
 * unnecessary, and `noUnusedLocals: true` would turn it into a compile error.
 * ========================================================================== */

import { createContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Minimal STRUCTURAL type for the AngularJS `$injector`.
 *
 * Declared here rather than imported: `@types/angular` is not in the pinned
 * dependency set and must not be added (HR-2 keeps that set closed). Only the
 * members the bridge actually needs are modelled -- `$injector` also exposes
 * `invoke`, `instantiate`, `annotate`, `modules` and `strictDi`, none of which
 * any React file may use, so none of them is declared.
 *
 * `get` is generic rather than `unknown`-returning so that `useAngularService`
 * can layer a mapped-type overload on top of it and hand callers a precisely
 * typed service. `any` is not used anywhere in this file.
 */
interface AngularInjector {
    /**
     * Resolve a registered AngularJS service by name, e.g.
     * `injector.get<UserStoriesResource>('$tgResources')`.
     */
    get<T>(name: string): T;

    /**
     * Whether a provider is registered under `name`. OPTIONAL on purpose: it
     * lets `useAngularService` distinguish "no provider registered" from "no
     * provider found" when raising its diagnostic, while keeping every
     * lightweight `{ get }` test double -- including the `jest.fn()`-based
     * doubles used throughout the co-located specs -- structurally assignable.
     */
    has?(name: string): boolean;
}

/**
 * The context's value type. `null` is the no-provider sentinel: it is
 * deliberately NOT a module-level throw, because raising a clear, named
 * diagnostic is `useAngularService`'s job -- it knows which service was asked
 * for, and can say so. A throw at module scope would instead break the bundle
 * for every screen, including the out-of-scope AngularJS ones.
 */
type AngularBridgeContextValue = AngularInjector | null;

/** Props for {@link AngularBridgeProvider}. */
interface AngularBridgeProviderProps {
    /**
     * The live `$injector` of the bootstrapped AngularJS application, acquired
     * by the host element. Accepts `null` so a mount that happens before
     * AngularJS has bootstrapped degrades to the documented no-provider
     * behaviour instead of a hard failure at the seam.
     */
    injector: AngularBridgeContextValue;

    /** The React subtree that may consume AngularJS services. */
    children?: ReactNode;
}

/**
 * The context object itself. Exported (not merely wrapped in a hook) because
 * `useAngularService` reads it directly and the specs assert against it with a
 * mock injector.
 */
export const AngularBridgeContext = createContext<AngularBridgeContextValue>(null);

// Names the context in React DevTools, so the seam is identifiable when
// debugging a React subtree hosted inside the AngularJS shell.
AngularBridgeContext.displayName = 'AngularBridgeContext';

/**
 * Publishes the AngularJS `$injector` to a React subtree.
 *
 * Mounted once per React root by `ReactHostElement`, immediately inside the
 * error boundary, so that every hook beneath it can resolve services. The
 * injector is forwarded unchanged -- see section 6 of the header on why no
 * wrapper object and no `useMemo` are used.
 */
export function AngularBridgeProvider({
    injector,
    children,
}: AngularBridgeProviderProps): ReactElement {
    return (
        <AngularBridgeContext.Provider value={injector}>
            {children}
        </AngularBridgeContext.Provider>
    );
}

// `isolatedModules: true` requires type-only exports to be declared as such.
export type { AngularInjector, AngularBridgeContextValue, AngularBridgeProviderProps };
