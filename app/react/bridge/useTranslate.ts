/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useTranslate.ts -- THE REACT WRAPPER OVER ANGULARJS `$translate.instant`
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file, so every
 * statement below is factual, locator-dense and load-bearing. Locators are
 * `path:line` against this repository; a bare `:line` continues the path named
 * immediately before it.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS
 * --------------------------------------------------------------------------
 * Two things, deliberately fused into one hook because neither is correct
 * without the other:
 *
 *   a. A typed wrapper over the incumbent translation service, so React reads
 *      exactly the strings AngularJS reads:
 *
 *          const t = useTranslate();
 *          t('US.ADD');
 *
 *      That is the verbatim transformation rule of AAP section 0.7.4
 *      (`$translate.instant("US.ADD")` becomes `const t = useTranslate();
 *      t("US.ADD");`). `$translate` is reached through the sibling
 *      `useAngularService` hook -- never off a global, never through a second
 *      i18n library, and never through a network call of this file's own
 *      making (rule T5, see 9 below).
 *
 *   b. A guarded `$translateChangeEnd` subscription that RE-RENDERS the calling
 *      subtree when the active language actually changes. Without it, a
 *      language switch would leave every already-rendered React string stale
 *      until something unrelated happened to re-render it: `instant` is a
 *      synchronous lookup with no change notification of its own, so a
 *      component that called it once would keep displaying the strings of the
 *      previous language indefinitely. AngularJS does not have this problem,
 *      because the `translate` directive and filter are re-evaluated by the
 *      digest; React has no digest, so the notification has to be explicit.
 *
 * --------------------------------------------------------------------------
 * 2. THE AUTHORITATIVE HANDLER SIGNATURE -- TWO ARGUMENTS, LANGUAGE SECOND
 * --------------------------------------------------------------------------
 * The authoritative incumbent listener is `app/coffee/app.coffee:967`, read
 * verbatim together with the `lang` it closes over at `:965`:
 *
 *     lang = null                                                     # :965
 *
 *     $rootscope.$on "$translateChangeEnd", (e, ctx) ->               # :967
 *         if lang != ctx.language                                     # :968
 *             lang = ctx.language                                     # :969
 *
 * TWO details of that are reproduced here exactly, and getting either wrong is
 * silent rather than loud:
 *
 *   - THE SIGNATURE IS `(e, ctx)`. AngularJS passes the event object FIRST and
 *     the payload SECOND, so the language lives at `ctx.language` -- the
 *     SECOND parameter. A handler written as `(ctx) => ctx.language` reads the
 *     EVENT OBJECT, whose `language` property does not exist, so it silently
 *     never observes a language and the subtree silently never re-renders.
 *     ⚠ `app/coffee/modules/common/components.coffee:57` writes exactly that
 *     single-argument form (`unbind = $rootscope.$on "$translateChangeEnd",
 *     (ctx) => …`) and gets away with it ONLY because it ignores its parameter
 *     entirely and re-initialises a date picker unconditionally. It is NOT the
 *     shape to copy. `app.coffee:967` is authoritative. Do not "fix" the
 *     handler below back to one parameter.
 *   - THE `lang !== ctx.language` GUARD IS MANDATORY. angular-translate emits
 *     `$translateChangeEnd` on every completed `use()` -- including a `use()`
 *     that resolves to the language already active, and including its own
 *     internal re-emissions (`node_modules/angular-translate/dist/
 *     angular-translate.js:1641` and `:2332`). Without the guard, every such
 *     emission would bump state and re-render the whole subtree for no visible
 *     change. The last-seen language is therefore held in a ref and compared,
 *     exactly as `:965`-`:969` holds it in a closure variable and compares it.
 *     The ref starts as `null` for the same reason `:965` starts as `null`:
 *     "no language seen yet" must not compare equal to any real language tag,
 *     so the first genuine notification always gets through.
 *
 * --------------------------------------------------------------------------
 * 3. DEREGISTRATION IS NOT OPTIONAL
 * --------------------------------------------------------------------------
 * `$on` returns AngularJS's own deregistration function. The house precedent
 * captures it and calls it on teardown --
 * `app/coffee/modules/common/components.coffee:57` (`unbind = $rootscope.$on
 * …`) paired with `:70`-`:73` (`$scope.$on "$destroy", -> $el.off(); unbind();
 * $el.picker.destroy()`) -- and this file does the same in its `useEffect`
 * cleanup, which is React's equivalent of that `$destroy` listener.
 *
 * This matters more here than it looks. `$rootScope` outlives every React
 * root: it is created once at bootstrap and is never torn down while the
 * application is open, so a listener left registered against it survives the
 * unmount of the component that added it, keeps a closure over that
 * component's `setState` alive for the rest of the session, and accumulates
 * one more dead listener on every navigation into and out of the screen. The
 * leak is silent -- no error, no warning, just an ever-growing listener array
 * and React's "update on an unmounted component" class of bug.
 *
 * --------------------------------------------------------------------------
 * 4. WHAT THIS FILE DELIBERATELY DOES NOT REPRODUCE
 * --------------------------------------------------------------------------
 * The incumbent handler continues past its guard by locating the prebuilt
 * legacy custom element in the document and assigning a `translations` object
 * onto it -- a two-key object pairing the whole translation table for the new
 * language with the language tag itself (`app/coffee/app.coffee:975`-`:979`;
 * read those five lines there rather than here, because quoting the property
 * names verbatim in this file would make the compliance greps of the folder
 * brief report a hit on a comment).
 *
 * NONE of that is reproduced, for three separate reasons:
 *
 *   - ⛔ THE PAYLOAD SHAPE IS NOT OURS. It exists to push a translation table
 *     into the PREBUILT Angular 2+ legacy Web Component, which cannot call
 *     `$translate` itself. React can, and does, so it needs no table hand-off.
 *     (Recorded for the record only: the tag's key is spelled `lan`, three
 *     letters, not `lang`. That typo is part of the prebuilt component's
 *     contract, so the AngularJS side must keep it -- and this file must not
 *     propagate it.)
 *   - ⛔ NO DOM OUTSIDE THE REACT ROOT IS TOUCHED. This file queries the
 *     document for nothing at all. Reaching out of the root to mutate an
 *     element AngularJS owns is precisely the coupling the custom-element seam
 *     exists to prevent, and `:975`-`:976` does not even null-guard the element
 *     it found -- a second reason not to model on it.
 *   - ⛔ NEITHER THE `i18nInit` CALL (`:970`) NOR THE RTL FLAG (`:972`-`:973`)
 *     IS DUPLICATED. Both are application-wide side effects that the
 *     AngularJS listener still performs, once, for the whole document. Doing
 *     them again from React would run them once PER MOUNTED COMPONENT and
 *     would be a functional change (rule T10). This hook only observes.
 *
 * --------------------------------------------------------------------------
 * 5. REACT NEVER TOUCHES THE DIGEST
 * --------------------------------------------------------------------------
 * ⛔ NONE of the AngularJS scope methods that drive a digest cycle -- the
 * synchronous apply, the async-apply, or the digest itself -- is called from
 * this file or from any other under `app/react/**`. AAP section 0.7.4 is
 * verbatim that React code must "never" call the root scope's apply method.
 * (Those three method names are described rather than spelled out here, so that
 * the compliance greps of the folder brief stay clean over comments as well as
 * over code.) It is also unnecessary in BOTH directions:
 *
 *   - AngularJS to React: `$translateChangeEnd` is emitted from INSIDE a
 *     digest, so the handler below already runs in one. Calling `setState`
 *     there is safe -- React 18 batches it and schedules its own render -- and
 *     needs no digest nudge.
 *   - React to AngularJS: the shared transport already schedules digests for
 *     its own responses, because `$httpProvider.useApplyAsync(true)` is set at
 *     `app/coffee/app.coffee:604`.
 *
 * --------------------------------------------------------------------------
 * 6. HOW `$rootScope` IS REACHED -- THE SINGLE SANCTIONED TOUCH POINT
 * --------------------------------------------------------------------------
 * `$rootScope` is deliberately ABSENT from the `AngularServices` map of the
 * sibling `./useAngularService.ts` (its section 6, `:208`-`:260`): React must
 * not hold a scope, because holding one invites the one call section 5
 * forbids. But this hook genuinely has to hear a `$rootScope` notification,
 * so the resolution order of the folder brief was worked through in full and
 * is recorded here with the evidence, because the conclusion is not the
 * obvious one.
 *
 * OPTION 1, the bridge `events.onAngularEvent(eventName, handler)` callback,
 * WAS EVALUATED AND IS NOT USABLE FOR THIS EVENT. It is the sanctioned answer
 * in general and stays that way for every event the AngularJS side
 * `$broadcast`s, but it cannot carry `$translateChangeEnd`:
 *
 *   - ⭐ angular-translate 2.18.3 fires the event with `$rootScope.$emit`, NOT
 *     `$broadcast` -- `node_modules/angular-translate/dist/
 *     angular-translate.js:1641` and `:2332` both read
 *     `$rootScope.$emit('$translateChangeEnd', {language : key})`. `$emit`
 *     propagates UPWARDS from the scope that raised it; raised on the root,
 *     which has no parent, it reaches the ROOT'S OWN LISTENERS AND NOTHING
 *     ELSE. A listener registered on a child scope is never called.
 *   - `onAngularEvent` registers on the CONTROLLER'S scope, which is a child:
 *     `app/coffee/modules/backlog/react-bridge.coffee:459` is
 *     `onAngularEvent: (eventName, handler) => $scope.$on(eventName, handler)`.
 *     Subscribing through it would therefore compile, run, leak nothing, and
 *     SILENTLY never fire -- the worst available failure mode.
 *   - Corroboration that root registration is the only working form: the
 *     library's own listener is `$rootScope.$on` (`:2770`), and so is every
 *     listener in this repository -- `app/coffee/app.coffee:967`,
 *     `app/coffee/modules/common/components.coffee:57`,
 *     `app/coffee/modules/admin/project-values.coffee:466` and `:1290`.
 *     Nothing in `app/` re-broadcasts the event.
 *   - Independently, the callback is published by the BACKLOG bridge only
 *     (`:459`); `app/coffee/modules/kanban/react-bridge.coffee` does not
 *     publish it, and no context or prop channel plumbs it to this hook. So
 *     even for a `$broadcast`-ed event the precondition of option 1 ("if the
 *     hosting screen passes `events.onAngularEvent` down") is unmet here.
 *
 * OPTION 2, the narrowly-scoped injector fallback, IS THEREFORE TAKEN, using
 * the escape hatch the sibling file provides for exactly this case rather than
 * by editing it:
 *
 *     const rootScopeCandidate = useUntypedAngularService('$rootScope');
 *
 * `useUntypedAngularService` returns `unknown`, so the value cannot be used
 * before it is narrowed, and `./useAngularService.ts:255`-`:260` states in
 * terms that the exclusions of its section 6 "cannot force a downstream file
 * into the unsafe escape-hatch type or into editing this file, because
 * `useUntypedAngularService` provides an explicit, greppable, `unknown`-typed
 * escape for exactly this case". Adding a sixteenth key to `AngularServices`
 * instead was ruled out on measured grounds as well as stylistic ones: its
 * co-located spec pins the map exhaustively -- `useAngularService.test.tsx:132`
 * (`satisfies readonly (keyof AngularServices)[]`), `:182`
 * (`Exclude<keyof AngularServices, …>` must be `never`) and `:186`
 * (`toHaveLength(15)`) -- so a new key would break both the type gate and a
 * passing spec of a file this one is only allowed to consume.
 *
 * ⭐ THE NARROWING BELOW IS THE SINGLE SANCTIONED `$rootScope` TOUCH POINT IN
 * THE ENTIRE REACT TREE, and it is sanctioned only because of how narrow it
 * is. The local {@link BroadcastListenerHost} type exposes `$on` AND NOTHING
 * ELSE -- not the apply/async-apply/digest trio of section 5, not the two event
 * raisers, not child-scope creation, not watch registration -- the value is
 * never stored in state, never returned, never placed on a ref and never handed
 * to another module, and it is used for exactly two calls: registering the
 * listener and invoking the deregistration function that registration returned.
 * A broadcast listener with deterministic teardown is not digest participation;
 * anything broader than `$on` would be.
 *
 * --------------------------------------------------------------------------
 * 7. WHY `t` KEEPS A STABLE IDENTITY BETWEEN LANGUAGE CHANGES
 * --------------------------------------------------------------------------
 * `t` is memoised with `useCallback` keyed on the resolved service and on a
 * "language epoch" counter that the guarded handler bumps. So:
 *
 *   - across ordinary re-renders, and across guard-suppressed notifications,
 *     `t` is THE SAME FUNCTION REFERENCE;
 *   - when the language really changes, it is a NEW reference.
 *
 * Both halves are load-bearing. A `t` that changed identity on every render
 * would defeat `React.memo` on every downstream component that takes it as a
 * prop and would invalidate every `useCallback`/`useMemo`/`useEffect`
 * dependency array containing it -- the presentational components of this
 * migration are memoised pure functions of their props, so that would turn
 * one language subscription into a whole-screen re-render per render. A `t`
 * that NEVER changed identity would be worse in the other direction: a
 * memoised child holding the old reference would keep rendering the previous
 * language's strings after a switch. The epoch is what draws that line
 * exactly where the incumbent guard draws it.
 *
 * The counter is also the reason there is NO polling here: no `setInterval`,
 * no `setTimeout` retry, no `MutationObserver`. The emission described in 2 is
 * the only trigger, and it is sufficient.
 *
 * --------------------------------------------------------------------------
 * 8. ALL COPY FLOWS THROUGH THIS HOOK -- WITH THREE DOCUMENTED EXCEPTIONS
 * --------------------------------------------------------------------------
 * AAP section 0.5.5 requires that all copy flow through `useTranslate` and
 * that no string be hardcoded. Three strings in the two migrated screens are
 * NOT translated in the incumbent, and reproducing them verbatim -- untouched
 * by this hook -- is REQUIRED by rule T10 ("No functional or feature change of
 * any kind"). They are listed here so no downstream agent "fixes" them into
 * translation keys and thereby changes behaviour:
 *
 *   - ⭐ `"WIP Limit"` -- DRIFT REGISTER ENTRY D5. Hardcoded, untranslated,
 *     inside the markup string the incumbent WIP directive injects:
 *     `app/coffee/modules/kanban/main.coffee:839` in the pre-migration source
 *     (`:1093` in the current, commented file). `../kanban/WipLimitMarker.tsx`
 *     emits the literal verbatim and calls no translation hook, which its own
 *     header records at `:343`-`:344`.
 *   - `h2 Backlog` -- `app/partials/backlog/backlog.jade:37`. Reproduced as-is.
 *   - `span Add` -- `app/partials/includes/modules/sprints.jade:23`.
 *     Reproduced as-is.
 *
 * For contrast, the search-input placeholder on BOTH screens reads "subject or
 * reference" (singular) and DOES come from a translation key,
 * `COMMON.FILTERS.INPUT_PLACEHOLDER`, so it must go through `t`.
 *
 * No new key is invented here, none is renamed, and no "missing translation"
 * fallback behaviour is added: `instant` already returns the key itself when a
 * key is absent, and changing that would be a functional change (rule T10).
 *
 * --------------------------------------------------------------------------
 * 9. RULE T5 -- NO PARALLEL TRANSPORT
 * --------------------------------------------------------------------------
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP
 * client. New TypeScript files are typed facades over the existing repository
 * layer." Accordingly this file constructs no transport of any kind: not the
 * browser's own request API, not the older request object it replaced, not a
 * third-party HTTP client, and not AngularJS's own HTTP service. (Named
 * descriptively for the same grep-hygiene reason as section 5.) Translation
 * tables are loaded by angular-translate
 * through the AngularJS transport, whose `Accept-Language` header is itself
 * derived from this very service (`app/coffee/modules/base/http.coffee:26`
 * reads `@translate.preferredLanguage()`), so React reading `$translate` sees
 * exactly the language the transport is sending.
 *
 * --------------------------------------------------------------------------
 * NOTE ON THE IMPORTS BELOW
 * --------------------------------------------------------------------------
 * There is deliberately no default `react` import. `tsconfig.json:9` sets
 * `jsx: "react-jsx"` (the automatic runtime, which the esbuild task must
 * mirror with `jsx: "automatic"` -- the two MUST agree or the bundle throws
 * "React is not defined" at run time), so the default import is unnecessary
 * and `noUnusedLocals: true` (`tsconfig.json:21`) would make it a compile
 * error. Imports are relative because `tsconfig.json` declares no `baseUrl`
 * and no `paths`. The AngularJS type-definition package is NOT installed and
 * must not be added (HR-2 keeps the dependency set closed), so every AngularJS
 * shape used here is a hand-written minimal structural type, and `any` appears
 * nowhere in this file.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAngularService, useUntypedAngularService } from './useAngularService';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The AngularJS event name, spelled exactly as angular-translate raises it
 * (`node_modules/angular-translate/dist/angular-translate.js:1641`) and exactly
 * as the incumbent listener spells it (`app/coffee/app.coffee:967`).
 *
 * A constant rather than an inline string because it is written twice -- once
 * to register and once in the diagnostic below -- and a typo in either would
 * fail silently: AngularJS registers listeners for unknown event names quite
 * happily and simply never calls them.
 */
const TRANSLATE_CHANGE_END = '$translateChangeEnd';

/**
 * The exact name the AngularJS root scope is registered under in the injector.
 *
 * See section 6 of the file header for why this file -- and only this file --
 * resolves it, and for the measured evidence that no narrower mechanism can
 * observe {@link TRANSLATE_CHANGE_END}.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/**
 * Prefix for the two diagnostics this file can emit, following the house
 * convention established by the sibling error boundary
 * (`./ErrorBoundary.tsx:118`): one greppable prefix that names the bridge and
 * the unit, so a message in a browser console is attributable without a stack
 * trace and survives minification of the bundled IIFE.
 */
const LOG_PREFIX = '[taiga-react-bridge:useTranslate]';

/* ==========================================================================
 * TYPES
 *
 * Every AngularJS shape below is hand-written and minimal. The AngularJS
 * type-definition package is outside the pinned dependency set and must not be
 * added (HR-2), and `any` is not used anywhere in this file: values that arrive
 * untyped arrive as `unknown` and are narrowed by an explicit predicate before
 * they are touched.
 * ========================================================================== */

/**
 * The translate function this hook returns.
 *
 * ```ts
 * const t = useTranslate();
 *
 * t('US.ADD');                                    // no interpolation
 * t('BACKLOG.SPRINTS.TITLE', { name: sprint });   // with interpolation values
 * ```
 *
 * Deliberately the smallest signature that covers every call site the two
 * migrated screens have, and exactly the two parameters of the underlying
 * member (`./useAngularService.ts` `TranslateService.instant`):
 *
 * - `key` is a translation key, e.g. `COMMON.FILTERS.INPUT_PLACEHOLDER`. When
 *   the key is absent from the active table, angular-translate returns the key
 *   itself; that is the incumbent behaviour and this hook does not alter it
 *   (rule T10 -- no invented fallback strings).
 * - `interpolateParams` supplies interpolation values for a key that declares
 *   placeholders. Optional, because most keys declare none.
 *
 * The underlying member also accepts an interpolation id, a forced language and
 * a sanitisation strategy. None of the three is exposed, because neither
 * in-scope module passes them; widening this signature "just in case" would be
 * enhancing beyond the requirements (Minimal Change Clause).
 *
 * Exported so downstream components can type a `t` prop as `TranslateFn`
 * instead of restating the signature and letting the two drift apart.
 */
type TranslateFn = (key: string, interpolateParams?: Record<string, unknown>) => string;

/**
 * The `$translateChangeEnd` payload, narrowed to the ONE property that matters.
 *
 * angular-translate raises the event as
 * `$rootScope.$emit('$translateChangeEnd', {language : key})`
 * (`node_modules/angular-translate/dist/angular-translate.js:1641`, `:2332`),
 * and the incumbent listener reads exactly `ctx.language`
 * (`app/coffee/app.coffee:968`-`:969`). Nothing else on the payload is read
 * here, so nothing else is modelled.
 */
interface TranslateChangeEndPayload {
    /** The language tag that has just become active, e.g. `en`, `es`, `ca`. */
    readonly language: string;
}

/**
 * AngularJS's own deregistration function, as returned by `$on`.
 *
 * Captured and invoked on cleanup exactly as the house precedent does
 * (`app/coffee/modules/common/components.coffee:57` paired with `:70`-`:73`).
 * See section 3 of the file header for why leaving it uncalled leaks silently.
 */
type AngularEventDeregistration = () => void;

/**
 * ⭐ THE ENTIRE `$rootScope` SURFACE THIS FILE IS PERMITTED TO SEE.
 *
 * One member: `$on`. Not the apply/async-apply/digest trio, not the two event
 * raisers, not child-scope creation, not watch registration, not the teardown
 * broadcast. The AngularJS root scope has all of those and React may use NONE
 * of them (section 5 of the file header), so declaring a type that cannot even
 * name them is what keeps the exception of section 6 as narrow as it claims to
 * be: a broadcast listener with deterministic teardown, not digest
 * participation.
 *
 * `$on` is typed as RETURNING `unknown` rather than
 * {@link AngularEventDeregistration}. That is deliberate: the return value is
 * therefore unusable until {@link isDeregistration} has checked it at run time,
 * which is the honest treatment of a value that crosses the seam from untyped
 * CoffeeScript -- and it keeps the lightweight doubles used by the co-located
 * specs, whose `$on` may legitimately return nothing, structurally assignable.
 *
 * The listener parameter carries BOTH AngularJS arguments, in AngularJS's
 * order, so the payload cannot be read out of the wrong position: see section 2
 * of the file header on why that is the classic way to get this file wrong.
 */
interface BroadcastListenerHost {
    $on(
        eventName: string,
        listener: (event: unknown, payload: unknown) => void,
    ): unknown;
}

/* ==========================================================================
 * NARROWING HELPERS
 *
 * Module-scope pure functions, so they are testable in isolation, allocate
 * nothing per render, and keep the hook body itself short enough to read in
 * one pass.
 * ========================================================================== */

/**
 * Narrows the `unknown` the injector escape hatch returns to the `$on`-only
 * surface of {@link BroadcastListenerHost}.
 *
 * Structural, not nominal: it asks only whether the value can register a
 * listener. In the browser the answer is always yes -- `$rootScope` is created
 * during bootstrap and lives as long as the document -- so this predicate earns
 * its keep in two other situations:
 *
 * - a unit test that supplies an injector double with no `$rootScope` entry, in
 *   which case the value is `undefined`;
 * - a React root mounted before AngularJS has finished bootstrapping, in which
 *   case the injector itself may not be publishing services yet.
 *
 * Both degrade to "translations work, language changes are not observed", which
 * is strictly better than throwing: the strings render correctly either way.
 *
 * @param candidate - the value the injector returned for `$rootScope`.
 * @returns whether `candidate` exposes a callable `$on`.
 */
function isBroadcastListenerHost(candidate: unknown): candidate is BroadcastListenerHost {
    if (typeof candidate !== 'object' || candidate === null) {
        return false;
    }

    if (!('$on' in candidate)) {
        return false;
    }

    return typeof candidate.$on === 'function';
}

/**
 * Narrows the value `$on` returned to a callable deregistration function.
 *
 * A predicate rather than a type assertion so that the call in the cleanup
 * below needs no cast: `unknown` narrowed by `typeof === 'function'` alone
 * widens to the bare function type, whose call expression is untyped, and this
 * file admits no untyped values.
 *
 * @param candidate - whatever `$on` returned.
 * @returns whether `candidate` can be called to deregister the listener.
 */
function isDeregistration(candidate: unknown): candidate is AngularEventDeregistration {
    return typeof candidate === 'function';
}

/**
 * Reads the language tag out of the SECOND handler argument.
 *
 * The whole point of the file, in six lines. The payload arrives as `unknown`
 * because it crosses the seam from untyped CoffeeScript, and it is read exactly
 * as `app/coffee/app.coffee:968` reads it -- `ctx.language`, from the SECOND
 * parameter, never the first.
 *
 * Any string is accepted, INCLUDING the empty string, because the incumbent
 * compares raw values (`if lang != ctx.language`) and validates nothing.
 * Adding validation the incumbent does not have would be a functional change
 * (rule T10).
 *
 * A malformed payload -- missing, not an object, or with a non-string
 * `language` -- yields `null`, which the handler treats as "nothing to do".
 * That cannot happen with angular-translate 2.18.3, which always supplies
 * `{language : key}`, but a handler that threw on a surprise payload would
 * throw INSIDE an AngularJS digest, where the exception would surface as an
 * `$exceptionHandler` report attributed to AngularJS rather than to React and
 * could interrupt the other listeners of the same event -- including the
 * application-wide one at `app/coffee/app.coffee:967` that performs the
 * `i18nInit` and RTL side effects. Silence is the correct behaviour here, and
 * it is silence about an event that carries no information, not about a failure.
 *
 * @param payload - the second argument AngularJS passed to the listener.
 * @returns the language tag, or `null` when the payload carries none.
 */
function readLanguage(payload: unknown): TranslateChangeEndPayload['language'] | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    if (!('language' in payload)) {
        return null;
    }

    const { language } = payload;

    return typeof language === 'string' ? language : null;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * Returns the translate function for the calling subtree, and keeps that
 * subtree in step with the active language.
 *
 * ```tsx
 * function AddUserStoryButton(): ReactElement {
 *     const t = useTranslate();
 *
 *     return <button type="button">{t('US.ADD')}</button>;
 * }
 * ```
 *
 * Behavioural contract, deliberately the smallest one that is correct:
 *
 * - **`t` DELEGATES, IT DOES NOT CACHE.** Every call is a fresh
 *   `$translate.instant` lookup, so a component that renders for any other
 *   reason after a language change already shows the new string without waiting
 *   for this hook's own state update. Memoising results would introduce a
 *   second, staler source of truth.
 * - **`t` IS SAFE TO CALL DURING RENDER.** `instant` is a synchronous table
 *   lookup with no side effect, no promise and no digest interaction.
 * - **`t`'s IDENTITY IS STABLE BETWEEN LANGUAGE CHANGES**, and changes when the
 *   language does. Section 7 of the file header explains why both halves matter.
 * - **ONE LISTENER PER MOUNTED CALLER, REMOVED ON UNMOUNT.** Registering is a
 *   push onto an array inside AngularJS, so several callers are cheap; leaving
 *   one registered is not (section 3).
 * - **NO DIGEST IS EVER TRIGGERED, IN EITHER DIRECTION** (section 5).
 * - **NO TRANSPORT IS EVER CONSTRUCTED** (section 9).
 *
 * @returns the translate function described by {@link TranslateFn}.
 * @throws Error when called outside `AngularBridgeProvider`, when the injector
 *         positively reports `$translate` or `$rootScope` as unregistered --
 *         both raised by the sibling accessors with the service named -- or when
 *         the resolved `$translate` exposes no callable `instant`.
 */
function useTranslate(): TranslateFn {
    // The typed accessor. A pure lookup, so it is safe at the top of the hook,
    // and it raises the named diagnostic for a missing provider on our behalf
    // (`./useAngularService.ts:1331`).
    const translate = useAngularService('$translate');

    // ⭐ The single sanctioned `$rootScope` touch point in the entire React
    // tree, and the reason it is `unknown` here: the deliberate, greppable
    // escape hatch of `./useAngularService.ts:1381` is used INSTEAD of adding a
    // sixteenth key to that file's service map, both because the root scope is
    // excluded from that map on correctness grounds (its section 6) and because
    // its co-located spec pins the map to exactly fifteen keys
    // (`./useAngularService.test.tsx:182`, `:186`). Section 6 of this file's
    // header carries the full argument, including the measured evidence that
    // the `events.onAngularEvent` bridge callback cannot observe this
    // particular event because angular-translate `$emit`s it on the root.
    const rootScopeCandidate = useUntypedAngularService(ROOT_SCOPE_SERVICE_NAME);

    // The last language actually observed, held in a ref rather than in state
    // because writing it must NOT itself schedule a render -- the epoch below is
    // what does that, and only when the guard passes. `null` means "no language
    // seen yet" and is the direct counterpart of `lang = null` at
    // `app/coffee/app.coffee:965`: it cannot compare equal to any real tag, so
    // the first genuine notification always gets through.
    const lastLanguageRef = useRef<string | null>(null);

    // The language epoch. Its VALUE is never read or rendered; only its
    // identity-invalidating effect on the memoised `t` below matters, which is
    // why a monotonically increasing counter is the whole state this hook needs.
    const [languageEpoch, setLanguageEpoch] = useState<number>(0);

    useEffect((): AngularEventDeregistration | undefined => {
        if (!isBroadcastListenerHost(rootScopeCandidate)) {
            // Degraded, not broken: `t` keeps returning correct strings for the
            // language that is active, and only live switching is lost. Warned
            // once per mount rather than thrown, because throwing here would
            // take down a subtree that is otherwise perfectly renderable -- and
            // warned rather than swallowed, because a silent loss of language
            // switching is exactly the kind of defect that reaches production.
            console.warn(
                `${LOG_PREFIX} The AngularJS '${ROOT_SCOPE_SERVICE_NAME}' resolved by the ` +
                    'bridge injector exposes no callable $on, so ' +
                    `'${TRANSLATE_CHANGE_END}' cannot be observed and translated strings ` +
                    'will not refresh on a language change. Translation lookups themselves ' +
                    'are unaffected.',
            );

            return undefined;
        }

        /**
         * The listener, in AngularJS's OWN argument order.
         *
         * `_event` is the AngularJS event object. It is never read -- the
         * incumbent at `app/coffee/app.coffee:967` never reads it either -- but
         * it MUST be declared, because the payload is the SECOND argument and
         * there is no other way to reach it. The leading underscore is what
         * keeps `noUnusedParameters: true` (`tsconfig.json:22`) satisfied
         * without disabling the check.
         */
        const handleTranslateChangeEnd = (_event: unknown, ctx: unknown): void => {
            const language = readLanguage(ctx);

            if (language === null) {
                return;
            }

            // The guard of `app/coffee/app.coffee:968`, reproduced exactly:
            // an emission that does not change the language changes nothing
            // here either, so no render is scheduled.
            if (lastLanguageRef.current === language) {
                return;
            }

            // `:969`, reproduced: remember first, then act.
            lastLanguageRef.current = language;

            // The functional update form is required, not stylistic: several
            // emissions can be delivered inside one digest, and React 18
            // batches the resulting updates, so reading `languageEpoch` from
            // this closure could count two changes as one.
            //
            // Nothing accompanies this call: no scope apply, no async-apply, no
            // manual digest. The event is emitted from inside a digest, so this
            // handler already runs in one, and React schedules its own render
            // (section 5).
            setLanguageEpoch((previousEpoch: number): number => previousEpoch + 1);
        };

        const deregistration = rootScopeCandidate.$on(
            TRANSLATE_CHANGE_END,
            handleTranslateChangeEnd,
        );

        // React's cleanup is the counterpart of the `$destroy` listener the
        // house precedent uses (`app/coffee/modules/common/components.coffee:70`
        // -`:73`). It runs on unmount and before any re-subscription.
        return (): void => {
            if (!isDeregistration(deregistration)) {
                console.warn(
                    `${LOG_PREFIX} AngularJS returned no deregistration function for ` +
                        `'${TRANSLATE_CHANGE_END}', so the listener could not be removed. ` +
                        'It will stay registered on the application root scope for the rest ' +
                        'of the session.',
                );

                return;
            }

            try {
                deregistration();
            } catch (teardownFailure: unknown) {
                // A broken deregistration must not take down the unmount that
                // called it: an exception thrown from a cleanup function
                // propagates into React's commit phase, where it can abort the
                // unmounting of unrelated siblings. Logged, never swallowed --
                // the same treatment the sibling error boundary gives a
                // reporting callback that throws (`./ErrorBoundary.tsx:236`
                // -`:241`). AngularJS's own deregistration cannot reach here
                // (it only splices an array), so this guards against a
                // substituted double or a future reimplementation.
                console.warn(
                    `${LOG_PREFIX} Deregistering the '${TRANSLATE_CHANGE_END}' listener ` +
                        'threw; the listener may still be registered on the application ' +
                        'root scope.',
                    teardownFailure,
                );
            }
        };
        // Keyed on the resolved root scope alone. AngularJS services are
        // singletons and the escape hatch returns them by reference, so this is
        // one stable value for the lifetime of the application: the effect
        // subscribes once per mount and never churns. `lastLanguageRef` is a ref
        // and `setLanguageEpoch` is state-setter-stable, so neither belongs
        // here; including the epoch would tear the subscription down and rebuild
        // it on every language change for no reason at all.
    }, [rootScopeCandidate]);

    return useCallback<TranslateFn>(
        (key: string, interpolateParams?: Record<string, unknown>): string => {
            if (typeof translate.instant !== 'function') {
                // Loud and named, in the house style of the sibling accessors:
                // a `$translate` without `instant` is a misconfigured injector,
                // not a missing translation, and returning the key instead would
                // silently paint the screen with raw keys while inventing a
                // fallback the incumbent does not have (rule T10). The sibling
                // error boundary contains this so the AngularJS shell survives.
                throw new Error(
                    `${LOG_PREFIX} The AngularJS '$translate' resolved by the bridge ` +
                        "injector exposes no callable 'instant', so the key " +
                        `'${key}' cannot be translated. Check that angular-translate is ` +
                        'configured on the application module, and that a unit test double ' +
                        'for $translate provides instant(translationId, interpolateParams).',
                );
            }

            return translate.instant(key, interpolateParams);
        },
        // `languageEpoch` is intentionally not read in the body above: it is an
        // IDENTITY-INVALIDATION KEY, nothing more. Section 7 of the file header
        // explains why `t` must be a new reference after a real language change
        // and the same reference otherwise. Removing it from this array would
        // leave memoised children rendering the previous language's strings.
        [translate, languageEpoch],
    );
}

/* ==========================================================================
 * EXPORTS
 *
 * The public surface is exactly the hook and the type of what it returns.
 * `isolatedModules: true` (`tsconfig.json:19`) requires the type-only export to
 * be declared as such. The narrowing helpers and the AngularJS structural
 * shapes stay module-private on purpose: they model the seam, and nothing
 * outside this file needs to reach the root scope (section 6).
 * ========================================================================== */

export { useTranslate };
export type { TranslateFn };

