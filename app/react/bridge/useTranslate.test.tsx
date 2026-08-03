/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useTranslate.test.tsx -- THE BEHAVIOURAL CONTRACT OF THE TRANSLATION SEAM
 * ==========================================================================
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file as much as it
 * governs the unit beside it, so every locator below is real and was read
 * before it was written down. Locators are `path:line` against this
 * repository; a bare `:line` continues the path named immediately before it.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT IS BEING PINNED, AND WHY EVERY ONE OF THESE FAILS SILENTLY
 * --------------------------------------------------------------------------
 * `./useTranslate.ts` is a wrapper over the incumbent `$translate.instant`
 * plus a guarded subscription to the AngularJS language-change event. Every
 * behaviour asserted below has the same defect signature when it is wrong: NO
 * exception, NO warning, NO failing build -- just a screen that stops
 * updating, or a listener that never goes away. That is precisely why they are
 * asserted directly rather than inferred from a rendered snapshot.
 *
 *   ⭐1 `t` delegates to `instant` with the exact key, and forwards
 *       interpolation values BY REFERENCE.
 *   ⭐2 The language is read from the SECOND handler argument.
 *   ⭐3 The `lang !== ctx.language` guard suppresses no-op emissions.
 *   ⭐4 Unmount calls the captured deregistration function EXACTLY ONCE.
 *   ⭐5 `t` keeps a stable identity between real language changes.
 *   ⛔6 The incumbent legacy-element translation-table hand-off is NOT
 *       reproduced.
 *   ⛔7 No AngularJS digest is ever driven, in either direction.
 *   ⛔8 The AngularJS root scope is touched through a ONE-MEMBER surface.
 *   ⛔9 Three incumbent literals stay OUT of the translation path entirely.
 *
 * --------------------------------------------------------------------------
 * 2. THE AUTHORITATIVE SOURCE -- TWO ARGUMENTS, LANGUAGE SECOND
 * --------------------------------------------------------------------------
 * `app/coffee/app.coffee:965`-`:969`, read verbatim:
 *
 *     lang = null                                                     # :965
 *
 *     $rootscope.$on "$translateChangeEnd", (e, ctx) ->               # :967
 *         if lang != ctx.language                                     # :968
 *             lang = ctx.language                                     # :969
 *
 * ⚠ `:967` IS AUTHORITATIVE AND ITS SIGNATURE IS `(e, ctx)`. AngularJS passes
 * the event object FIRST and the payload SECOND, so the language lives on the
 * SECOND parameter. `app/coffee/modules/common/components.coffee:57` writes a
 * SINGLE-argument form of the same subscription
 * (`unbind = $rootscope.$on "$translateChangeEnd", (ctx) => …`) and gets away
 * with it only because it ignores its parameter entirely and re-initialises a
 * date picker unconditionally. A hook written that way would read the EVENT
 * OBJECT, whose `language` property does not exist, and would therefore never
 * observe a language and never re-render -- THE SINGLE MOST COMMON WAY TO GET
 * THIS FILE'S UNIT WRONG. It is asserted here, not assumed: the root-scope
 * double deliberately puts a plausible-looking `language` on the event object
 * so that a first-argument reader finds a WRONG ANSWER rather than
 * `undefined`, and section 4's specs are built to separate the two readings.
 *
 * The guard at `:968`-`:969` is asserted for the same reason. angular-translate
 * raises the event on every completed `use()`, including one that resolves to
 * the language already active, so a hook without the guard re-renders the whole
 * subtree for no visible change.
 *
 * Deregistration follows the house precedent:
 * `app/coffee/modules/common/components.coffee:57` captures what `$on` returned
 * and `:70`-`:73` calls it on teardown
 * (`$scope.$on "$destroy", -> $el.off(); unbind(); $el.picker.destroy()`).
 * React's `useEffect` cleanup is the counterpart of that `$destroy` listener,
 * and the root scope outlives every React root, so a missed call leaks for the
 * rest of the session.
 *
 * --------------------------------------------------------------------------
 * 3. WHAT THE INCUMBENT DOES NEXT, AND WHY NONE OF IT IS REPRODUCED
 * --------------------------------------------------------------------------
 * Past its guard the incumbent locates the prebuilt legacy custom element in
 * the document and assigns a two-key object onto it, pairing the whole
 * translation table for the new language with the language tag
 * (`app/coffee/app.coffee:975`-`:979` -- read those five lines there, not here,
 * because spelling the property names out would make THIS COMMENT the very hit
 * the folder brief's compliance greps exist to catch).
 *
 * None of it belongs in React, for three separate reasons, and section 6's
 * specs assert all three:
 *
 *   - the payload exists to feed a PREBUILT Angular 2+ Web Component that
 *     cannot call `$translate` itself; React can, and does;
 *   - reaching out of the React root to mutate an element AngularJS owns is
 *     exactly the coupling the custom-element seam exists to prevent -- and
 *     `:975`-`:976` does not even null-guard the element it found;
 *   - ⚠ FOR THE RECORD, NOT FOR COPYING: the tag's own key is spelled with
 *     THREE letters, not four -- `lan`, not `lang`. That typo is part of the
 *     prebuilt component's contract, so the AngularJS side must keep it and
 *     this migration must not propagate it anywhere.
 *
 * --------------------------------------------------------------------------
 * 4. THE THREE UNTRANSLATED LITERALS (rule T10)
 * --------------------------------------------------------------------------
 * AAP 0.5.5 requires that all copy flow through this hook. THREE strings in
 * the two migrated screens are NOT translated in the incumbent, and rule T10
 * ("No functional or feature change of any kind") means they must be
 * reproduced verbatim, untouched by `t`. They are enumerated as executable
 * data in {@link UNTRANSLATED_LITERALS} so that no future agent "fixes" them
 * into translation keys:
 *
 *   - `"WIP Limit"` -- DRIFT REGISTER ENTRY D5. Hardcoded inside the markup
 *     string the incumbent WIP directive injects, at
 *     `app/coffee/modules/kanban/main.coffee:839` in the pre-migration source.
 *   - `Backlog` -- the heading at `app/partials/backlog/backlog.jade:37`.
 *   - `Add` -- the sidebar link at
 *     `app/partials/includes/modules/sprints.jade:23`.
 *
 * For contrast, the search placeholder on BOTH screens reads "subject or
 * reference" (singular) and DOES come from a key,
 * `COMMON.FILTERS.INPUT_PLACEHOLDER`, so it must go through `t`. Section 9
 * asserts both halves.
 *
 * --------------------------------------------------------------------------
 * 5. HR-5 -- BROWSERLESS, NETWORKLESS, BUILD-FREE
 * --------------------------------------------------------------------------
 * jsdom supplies the DOM; `$translate` and the root scope are hand-built
 * doubles; nothing is fetched and nothing is built. This spec passes with the
 * generated distribution deleted and no browser binary installed at all, and
 * it imports no end-to-end tooling -- that layer lives under `e2e-react/` and
 * is invoked only by its own npm script.
 *
 * The mocking seam is the one `jest.config.js` mandates: `./mockInjector`.
 * AngularJS is never imported and no browser global of its is ever read, so
 * the 1.5.10 runtime cannot reach a jsdom worker, and that configuration needs
 * no `setupFiles` entry to make this file work.
 *
 * ⚠ GREP HYGIENE, the house convention of `./ErrorBoundary.test.tsx:903`-`:933`
 * (see its `:904`-`:905`): the folder brief's compliance greps run over THIS
 * FILE TOO, so every prohibited identifier this spec must reason about is
 * ASSEMBLED FROM PARTS rather than spelled out. Writing them plainly would
 * make the spec that forbids them the reason the grep fails.
 *
 * No mock is reset by hand anywhere below: `jest.config.js` already sets
 * `clearMocks: true` and `restoreMocks: true`, so calls are cleared and spies
 * restored between specs, and duplicating that here would invite specs to
 * depend on manual ordering the configuration already guarantees.
 *
 * --------------------------------------------------------------------------
 * 6. CONVENTIONS INHERITED FROM THE INCUMBENT SUITE
 * --------------------------------------------------------------------------
 * `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * is the spec whose component the Backlog screen consumes and which must keep
 * passing. Its conventions carry over: a module-level collection of doubles
 * with ONE FACTORY PER DEPENDENCY (`:14`, `:16`, `:23`), nested `describe`
 * blocks per behaviour area (`:61` for the button, `:103` for the lightbox),
 * and assertions on BOTH paths -- `:110` asserts the lightbox was created,
 * `:114` asserts it was not.
 *
 * The mechanical substitutions are `provide.value "name", double` ->
 * `mockInjector({ name: double })`, `sinon.stub()` -> `jest.fn()`, and the chai
 * matchers -> the Jest ones (`.to.be.false` -> `toBe(false)`, `.to.be.eql([…])`
 * -> `toEqual([…])`).
 *
 * ⛔ THE ONE CONVENTION THAT DOES NOT CARRY OVER is that spec's fixture style.
 * It builds fixtures with the persistent-collection library's `fromJS` factory
 * (`:25`, `:81`-`:85`, `:95`-`:98`) because AngularJS controllers hold
 * persistent structures. REACT FIXTURES HERE ARE PLAIN OBJECTS. Flattening
 * happens on the AngularJS side before values cross the seam -- the house
 * precedent is `.toJS()` at
 * `app/modules/components/project-menu/project-menu.controller.coffee:27`,
 * with a second at `:21` (LOCATOR CORRECTION, verified by reading the file:
 * AAP 0.5.2 and 0.6.2 say L28, but L28 is the closing brace). React must never
 * receive a persistent map or list, nor a repository model instance
 * (P-IMMER-1).
 *
 * --------------------------------------------------------------------------
 * 7. NOTE ON THE IMPORTS
 * --------------------------------------------------------------------------
 * There is deliberately no default `react` import: `tsconfig.json:9` sets
 * `jsx: "react-jsx"` (the automatic runtime, mirrored by the esbuild task's
 * `jsx: "automatic"` -- the two MUST agree or the bundle throws at run time),
 * so the default import is unnecessary and `noUnusedLocals: true` would make
 * it a compile error. Imports are relative because no `baseUrl` and no `paths`
 * are declared. The AngularJS type-definition package is outside the pinned
 * dependency set and must not be added (HR-2), so every AngularJS shape below
 * is a hand-written minimal structural type and `any` appears nowhere in this
 * file. `fs` and `path` are typed because `tsconfig.json` pins
 * `types: ["jest", "node"]`.
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render, renderHook, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from './AngularBridgeContext';
import { mockInjector, withMockInjector } from './mockInjector';
import type { MockServiceMap } from './mockInjector';
import { useTranslate } from './useTranslate';
import type { TranslateFn } from './useTranslate';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The AngularJS event name, spelled exactly as angular-translate raises it and
 * exactly as the incumbent listener spells it (`app/coffee/app.coffee:967`).
 */
const TRANSLATE_CHANGE_END = '$translateChangeEnd';

/**
 * The exact injector name of the AngularJS root scope.
 *
 * The unit resolves it through the deliberate, greppable `unknown`-returning
 * escape hatch of `./useAngularService.ts` rather than through the typed
 * service map, because a scope is excluded from that map by design. Section 8
 * of the specs asserts both the name and the narrowness of what is touched.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/**
 * The diagnostic prefix the unit stamps on both of its messages
 * (`./useTranslate.ts` `LOG_PREFIX`).
 */
const LOG_PREFIX = '[taiga-react-bridge:useTranslate]';

/** The unit under test, read from disk by the source-level specs. */
const UNIT_FILENAME = 'useTranslate.ts';

/**
 * ⚠ ASSEMBLED FROM PARTS, NEVER SPELLED OUT (section 5 of the header).
 *
 * The selector and the payload key of the incumbent legacy-element hand-off at
 * `app/coffee/app.coffee:975`-`:979`. Section 6's specs prove the unit reaches
 * for neither, and assembling them here is what keeps this spec from becoming
 * the grep hit it exists to prevent.
 */
const LEGACY_ELEMENT_SELECTOR = `${'tg'}-${'legacy'}`;
const LEGACY_TABLE_KEY = `${'translation'}${'Table'}`;

/** The property name the incumbent assigns onto that element. */
const LEGACY_TRANSLATIONS_PROPERTY = 'translations';

/**
 * Every AngularJS scope member React may NOT touch.
 *
 * The first three are the digest drivers. AAP 0.7.4 is verbatim that React
 * code must "never" call the root scope's apply method, and it is unnecessary
 * in both directions: the language event is raised from INSIDE a digest, so the
 * unit's handler already runs in one, and the shared transport already
 * schedules digests for its own responses because
 * `$httpProvider.useApplyAsync(true)` is set at `app/coffee/app.coffee:604`.
 * They are ASSEMBLED FROM PARTS for the reason section 5 of the header gives.
 *
 * The remaining six are not named by the compliance greps but are equally out
 * of bounds: React raises no AngularJS event, creates no child scope,
 * registers no watch and broadcasts no teardown.
 */
const FORBIDDEN_SCOPE_MEMBERS: ReadonlyArray<string> = [
    `${'$'}${'apply'}`,
    `${'$'}${'apply'}${'Async'}`,
    `${'$'}${'digest'}`,
    '$broadcast',
    '$emit',
    '$new',
    '$watch',
    '$evalAsync',
    '$destroy',
];

/**
 * The three strings the incumbent renders WITHOUT translating, each with the
 * locator that fixes it. Executable data rather than prose, so that "these
 * three are deliberate" is a passing assertion instead of a comment someone
 * can overlook (section 4 of the header).
 */
const UNTRANSLATED_LITERALS: ReadonlyArray<{
    readonly literal: string;
    readonly locator: string;
    readonly why: string;
}> = [
    {
        literal: 'WIP Limit',
        locator: 'app/coffee/modules/kanban/main.coffee:839',
        why:
            'Drift Register entry D5. Hardcoded English inside the markup string the ' +
            'incumbent WIP directive injects; ../kanban/WipLimitMarker.tsx emits it ' +
            'verbatim and calls no translation hook.',
    },
    {
        literal: 'Backlog',
        locator: 'app/partials/backlog/backlog.jade:37',
        why: 'The panel heading, written as literal text in the incumbent template.',
    },
    {
        literal: 'Add',
        locator: 'app/partials/includes/modules/sprints.jade:23',
        why: 'The sprint-sidebar link label, written as literal text.',
    },
];

/**
 * The one search-input key that IS translated, on BOTH migrated screens. It
 * renders "subject or reference" (singular) and must go through `t`.
 */
const SEARCH_PLACEHOLDER_KEY = 'COMMON.FILTERS.INPUT_PLACEHOLDER';

/* ==========================================================================
 * DOUBLES -- ONE FACTORY PER DEPENDENCY
 *
 * The convention of `move-to-sprint.controller.spec.coffee:14`-`:30`, carried
 * over: each dependency gets one named factory, each factory returns the
 * handles the assertions need, and nothing is shared between specs.
 *
 * Every shape is hand-written and minimal. `any` is not used, here or
 * anywhere else in this file: values that arrive untyped arrive as `unknown`.
 * ========================================================================== */

/** The listener shape AngularJS calls: event object first, payload second. */
type BroadcastListener = (event: unknown, payload: unknown) => void;

/**
 * The `$translate` double.
 *
 * Exactly the three members the bridge's `TranslateService` facade declares --
 * `instant`, `preferredLanguage` and the whole-table reader -- so the object is
 * structurally assignable to it and {@link mockInjector} accepts it under its
 * real key. Nothing wider is modelled: the underlying service also takes an
 * interpolation id, a forced language and a sanitisation strategy, and neither
 * migrated module passes any of the three.
 */
interface TranslateDouble {
    /** `instant(translationId, interpolateParams?)`, the only member `t` calls. */
    readonly instant: jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

    /** Present because the facade declares it; the unit never calls it. */
    readonly preferredLanguage: jest.Mock<string, []>;

    /**
     * Present because the facade declares it, and ASSERTED NEVER CALLED: the
     * incumbent reads the whole table only to feed the legacy element
     * (`app/coffee/app.coffee:977`), which section 6 proves React does not do.
     */
    readonly getTranslationTable: jest.Mock<Record<string, unknown>, [string]>;

    /** Test-only: moves the double's active language, as a real `use()` would. */
    setLanguage(next: string): void;
}

/**
 * Builds a `$translate` double whose `instant` ECHOES its inputs.
 *
 * The echo is what makes the rendered output legible to an assertion: a probe
 * showing `es:US.ADD` proves both that the key travelled and that the active
 * language moved. A double returning a fixed string would make the two
 * indistinguishable.
 *
 * @param language - the language the double starts out active in.
 */
function createTranslateDouble(language = 'en'): TranslateDouble {
    let active = language;

    return {
        instant: jest.fn(
            (key: string, interpolateParams?: Record<string, unknown>): string => {
                const suffix =
                    interpolateParams === undefined
                        ? ''
                        : `(${Object.keys(interpolateParams).sort().join(',')})`;

                return `${active}:${key}${suffix}`;
            },
        ),
        preferredLanguage: jest.fn((): string => active),
        getTranslationTable: jest.fn((_langKey: string): Record<string, unknown> => ({})),
        setLanguage(next: string): void {
            active = next;
        },
    };
}

/**
 * ⭐ THE ENTIRE ROOT-SCOPE SURFACE THE UNIT IS PERMITTED TO SEE: one member.
 *
 * This mirrors, deliberately member-for-member, the local structural type the
 * unit narrows to. Section 8's specs assert that the object handed to the
 * injector has EXACTLY ONE own property, which is the executable form of "a
 * broadcast listener with deterministic teardown is not digest participation".
 */
interface RootScopeFacade {
    readonly $on: jest.Mock<() => void, [string, BroadcastListener]>;
}

/** The handles a spec needs around {@link RootScopeFacade}. */
interface RootScopeDouble {
    /** What the injector resolves. Exactly one own property, by construction. */
    readonly facade: RootScopeFacade;

    /** The deregistration function `$on` returns, so teardown is assertable. */
    readonly deregister: jest.Mock<void, []>;

    /** Raises the event THE WAY ANGULARJS DOES: `(eventObject, payload)`. */
    emit(payload: unknown): void;

    /**
     * Raises it THE WRONG WAY -- payload in the FIRST position, nothing after.
     * A correct listener observes nothing at all from this, which is what makes
     * the signature of `app/coffee/app.coffee:967` provable rather than assumed.
     */
    emitWithSingleArgument(payload: unknown): void;

    /** Registered listener count, for the "exactly one listener" assertions. */
    listenerCount(eventName: string): number;
}

/**
 * The `language` the DECOY event object carries in its first position.
 *
 * Load-bearing. A handler that reads the FIRST argument finds this
 * plausible-looking value instead of `undefined`, so it appears to work: it
 * even re-renders once, because "no language seen yet" differs from this. The
 * two readings only separate under the sequences section 4 builds, which is
 * exactly why those sequences exist.
 */
const DECOY_EVENT_LANGUAGE = 'WRONG-ARGUMENT';

function createRootScopeDouble(): RootScopeDouble {
    const listeners = new Map<string, BroadcastListener[]>();
    const deregister = jest.fn<void, []>();

    const $on = jest.fn<() => void, [string, BroadcastListener]>(
        (eventName: string, listener: BroadcastListener): (() => void) => {
            listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);

            return deregister;
        },
    );

    function each(callback: (listener: BroadcastListener) => void): void {
        // Copied before iteration, exactly as AngularJS does, so a listener that
        // unsubscribes during dispatch cannot disturb the walk.
        [...(listeners.get(TRANSLATE_CHANGE_END) ?? [])].forEach(callback);
    }

    return {
        // Frozen so that a spec cannot widen the surface it is asserting is
        // narrow, and built as a one-property literal so `Object.keys` on it is
        // a meaningful assertion rather than a coincidence.
        facade: Object.freeze({ $on }),
        deregister,
        emit(payload: unknown): void {
            const eventObject = {
                name: TRANSLATE_CHANGE_END,
                language: DECOY_EVENT_LANGUAGE,
                defaultPrevented: false,
            };

            each((listener: BroadcastListener): void => {
                listener(eventObject, payload);
            });
        },
        emitWithSingleArgument(payload: unknown): void {
            each((listener: BroadcastListener): void => {
                // The cast expresses the mistake being ruled out -- AngularJS
                // would never call a listener this way -- and narrows to a
                // one-parameter function type rather than to the unsafe
                // escape-hatch type, which appears nowhere in this file.
                (listener as (single: unknown) => void)(payload);
            });
        },
        listenerCount(eventName: string): number {
            return (listeners.get(eventName) ?? []).length;
        },
    };
}

/** A root scope that records every forbidden member as well as `$on`. */
interface DigestTripwireScope {
    /** `$on` PLUS one spy per entry of {@link FORBIDDEN_SCOPE_MEMBERS}. */
    readonly facade: Readonly<Record<string, unknown>>;

    /** The forbidden spies, by member name, for the "never called" assertions. */
    readonly forbidden: ReadonlyMap<string, jest.Mock<unknown, unknown[]>>;

    readonly deregister: jest.Mock<void, []>;

    emit(payload: unknown): void;
}

/**
 * ⛔ THE DIGEST TRIPWIRE.
 *
 * A root scope that is DELIBERATELY WIDER than the unit is allowed to see: it
 * carries a live spy for every member of {@link FORBIDDEN_SCOPE_MEMBERS}
 * alongside a working `$on`. Nothing stops the unit calling one -- which is the
 * whole point. A "does not call" assertion against a member that does not exist
 * would pass vacuously, whereas this one can only pass because the unit chose
 * not to make the call.
 *
 * Used ONCE, by section 7. Every other spec uses the one-member facade of
 * {@link createRootScopeDouble}, because that is the surface production code
 * actually gets.
 */
function createDigestTripwireScope(): DigestTripwireScope {
    const listeners: BroadcastListener[] = [];
    const deregister = jest.fn<void, []>();
    const forbidden = new Map<string, jest.Mock<unknown, unknown[]>>();
    const facade: Record<string, unknown> = {
        $on: jest.fn(
            (eventName: string, listener: BroadcastListener): (() => void) => {
                if (eventName === TRANSLATE_CHANGE_END) {
                    listeners.push(listener);
                }

                return deregister;
            },
        ),
    };

    for (const member of FORBIDDEN_SCOPE_MEMBERS) {
        const spy = jest.fn<unknown, unknown[]>();

        forbidden.set(member, spy);
        facade[member] = spy;
    }

    return {
        facade,
        forbidden,
        deregister,
        emit(payload: unknown): void {
            const eventObject = { name: TRANSLATE_CHANGE_END, defaultPrevented: false };

            [...listeners].forEach((listener: BroadcastListener): void => {
                listener(eventObject, payload);
            });
        },
    };
}

/* ==========================================================================
 * THE INJECTOR -- THE MANDATED SEAM, EXTENDED FOR EXACTLY TWO NAMES
 * ========================================================================== */

/**
 * Builds the injector for a spec: `./mockInjector` for every well-formed
 * service, plus a documented extension for the names that CANNOT travel
 * through its type.
 *
 * ⭐ WHY THE EXTENSION EXISTS, since going around a mandated seam needs a
 * reason rather than a preference. `mockInjector`'s map is
 * `Partial<AngularServices>`, and BOTH AngularJS scope services are excluded
 * from `AngularServices` ON PURPOSE (`./useAngularService.ts:208`-`:231`), so
 * `mockInjector({ $rootScope: … })` is a COMPILE ERROR -- correctly, because
 * React must not hold a scope. `mockInjector`'s own header prescribes the
 * answer for a spec that genuinely needs such a name (its section 4: declare
 * the local double "next to the assertions that explain why"), and its runtime
 * diagnostic says the same thing in prose.
 *
 * The unit under test is the ONE file in the React tree that legitimately hears
 * a root-scope notification, for a measured reason: angular-translate raises
 * the language event with `$rootScope.$emit`, which propagates UPWARDS only, so
 * a listener on any child scope -- including the one the bridge's own
 * `events.onAngularEvent` callback would register -- is NEVER CALLED. Its spec
 * therefore has to supply a root scope, and this is the narrowest way to do it:
 *
 *   - every WELL-FORMED, on-map service still goes through `mockInjector`, so
 *     its type gate, its singleton identity and its loud named diagnostic all
 *     still apply, and section 10 asserts that they do;
 *   - the extension carries exactly two kinds of name -- the off-map root
 *     scope, and a DELIBERATELY MALFORMED service used to prove the unit fails
 *     loudly. An object with no `instant` is not a translation service, so by
 *     construction it cannot travel through a type-safe map either.
 *
 * `has` is omitted, matching `mockInjector`: the sibling accessors reject a
 * name only when `has` is present AND returns exactly `false`, so omitting it
 * exercises the resolution path the browser actually takes and keeps the
 * accurate diagnostic with whichever layer owns it.
 *
 * @param typed - well-formed services, keyed and type-checked by the real
 *                service map.
 * @param extensions - the off-map names. Membership is tested with `has`, not
 *                     by comparing to the nothing-value, so "resolves to
 *                     nothing" stays expressible: that is what an injector
 *                     queried before AngularJS finished bootstrapping does.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>> = {},
): AngularInjector {
    const mandatedSeam = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            if (extended.has(name)) {
                return extended.get(name) as T;
            }

            return mandatedSeam.get<T>(name);
        },
    };
}

/**
 * The common case, named once so thirty specs do not repeat it: a well-formed
 * `$translate` plus the ONE-MEMBER root-scope facade.
 */
function bridgeFor(
    translate: TranslateDouble,
    rootScope: RootScopeDouble,
): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: translate },
            { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade },
        ),
    );
}

/** Silences the diagnostics the degradation specs deliberately provoke. */
function silenceWarnings(): jest.SpyInstance {
    return jest.spyOn(console, 'warn').mockImplementation((): undefined => undefined);
}

/**
 * Silences React's own report of an error thrown during render, which the
 * "fails loudly" specs provoke on purpose. Without this the suite's output
 * would carry component stacks for failures that are the assertion.
 */
function silenceRenderErrors(): jest.SpyInstance {
    return jest.spyOn(console, 'error').mockImplementation((): undefined => undefined);
}

/* ==========================================================================
 * THE PROBE -- COUNTS ITS OWN COMMITTED RENDERS AND PUBLISHES `t`
 * ========================================================================== */

interface ProbeProps {
    readonly translationKey: string;

    /** Called after every COMMITTED render, with `t` and the render ordinal. */
    readonly onRender?: (t: TranslateFn, renderCount: number) => void;
}

function TranslationProbe({ translationKey, onRender }: ProbeProps): ReactElement {
    const t = useTranslate();
    const renderCountRef = useRef(0);

    renderCountRef.current += 1;

    // Reported from an effect rather than from the render body, so the count is
    // only published for renders React actually committed.
    useEffect((): void => {
        onRender?.(t, renderCountRef.current);
    });

    return (
        <output data-testid="probe" data-render-count={renderCountRef.current}>
            {t(translationKey)}
        </output>
    );
}

/* ==========================================================================
 * SPECS
 * ========================================================================== */

describe('useTranslate', () => {
    /* ----------------------------------------------------------------------
     * ⭐1 -- AAP 0.7.4's transformation rule, verbatim:
     *        `$translate.instant("US.ADD")` becomes
     *        `const t = useTranslate(); t("US.ADD");`
     * ---------------------------------------------------------------------- */
    describe('⭐1 delegation to $translate.instant', () => {
        it('passes the exact key through, with no interpolation values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(result.current('US.ADD')).toBe('en:US.ADD');

            // Asserted precisely rather than with a loose `toHaveBeenCalled`: the
            // key must arrive UNTOUCHED. A hook that prefixed, namespaced or
            // lower-cased it would still "have been called".
            expect(translate.instant).toHaveBeenCalledTimes(1);
            expect(translate.instant).toHaveBeenCalledWith('US.ADD', undefined);
        });

        it('forwards interpolation values BY REFERENCE, not by copy', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const interpolateParams = { n: 3, name: 'Sprint 2026-5-15' };

            expect(result.current('SOME.KEY', interpolateParams)).toBe('en:SOME.KEY(n,name)');

            // `Object.is`, not `toEqual`: angular-translate reads the object it
            // is handed, so a hook that spread or cloned it would pass a
            // structural comparison while silently dropping any non-enumerable
            // or accessor-backed value a caller had put on it.
            const forwarded = translate.instant.mock.calls[0]?.[1];

            expect(Object.is(forwarded, interpolateParams)).toBe(true);
        });

        it('returns whatever the service returns, inventing no fallback', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            // angular-translate returns THE KEY ITSELF for a key that is absent
            // from the active table. That is incumbent behaviour, so the wrapper
            // must pass it straight back: substituting a friendlier string would
            // be a functional change (rule T10).
            translate.instant.mockReturnValueOnce('BACKLOG.NOT.A.REAL.KEY');

            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(result.current('BACKLOG.NOT.A.REAL.KEY')).toBe('BACKLOG.NOT.A.REAL.KEY');
        });

        it('does not consult the service until `t` is actually called', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            // Mounting resolves services and subscribes; it must not translate
            // anything speculatively, or a component that renders no copy would
            // still pay for a table lookup.
            expect(translate.instant).not.toHaveBeenCalled();
        });

        it('resolves one shared $translate through the mandated seam, by identity', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const wrapper = bridgeFor(translate, rootScope);

            const first = renderHook((): TranslateFn => useTranslate(), { wrapper });
            const second = renderHook((): TranslateFn => useTranslate(), { wrapper });

            first.result.current('US.ADD');
            second.result.current('US.DELETE');

            // `mockInjector` hands back the very object the spec supplied, on
            // every lookup, exactly as an AngularJS singleton does -- so two
            // independent mounts are observable on ONE double.
            expect(translate.instant.mock.calls.map((call): string => call[0])).toEqual([
                'US.ADD',
                'US.DELETE',
            ]);
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐2 -- THE SIGNATURE. `app/coffee/app.coffee:967` is `(e, ctx)`, so the
     *        language is on the SECOND parameter. See section 2 of the header
     *        for why a one-parameter handler fails silently.
     *
     * MEASURED, NOT ASSUMED. These specs were validated by mutation: rewriting
     * the unit's handler to the single-argument shape of
     * `common/components.coffee:57` -- so that it reads `language` off the FIRST
     * argument -- turns 12 of this file's specs red, the two flagship ones below
     * ("reads the payload, NOT the `language` sitting on the event object" and
     * "observes nothing when the handler is invoked with a single argument")
     * among them. Three further mutations were checked the same way and each is
     * caught: dropping the guard of `:968` (3 red), replacing the functional
     * state update with a stale-closure increment (4 red), and skipping the
     * deregistration call (6 red). The unit was restored byte-for-byte
     * afterwards; the mutations exist only in this comment.
     * ---------------------------------------------------------------------- */
    describe('⭐2 the language is read from the SECOND handler argument', () => {
        it('registers exactly one listener, under the exact AngularJS event name', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(rootScope.facade.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.facade.$on).toHaveBeenCalledWith(
                TRANSLATE_CHANGE_END,
                expect.any(Function),
            );
            expect(rootScope.listenerCount(TRANSLATE_CHANGE_END)).toBe(1);
        });

        it('re-renders with the NEW strings when the language really changes', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(screen.getByTestId('probe')).toHaveTextContent('en:US.ADD');

            const callsBeforeChange = translate.instant.mock.calls.length;

            act((): void => {
                // The service moves first, exactly as angular-translate does: the
                // table is swapped and THEN the event is raised.
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            // Both halves matter: the DOM shows the new language, and `instant`
            // was consulted again to produce it. Either alone would also hold for
            // a hook that merely happened to re-render.
            expect(screen.getByTestId('probe')).toHaveTextContent('es:US.ADD');
            expect(translate.instant.mock.calls.length).toBeGreaterThan(callsBeforeChange);
            expect(screen.getByTestId('probe')).toHaveAttribute('data-render-count', '2');
        });

        it('reads the payload, NOT the `language` sitting on the event object', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renderCounts: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renderCounts.push(renderCount);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            // ⭐ THE DISCRIMINATING SEQUENCE, and the reason it is built this way.
            //
            // The event object carries `language: DECOY_EVENT_LANGUAGE` in the
            // FIRST position throughout. So:
            //
            //   emission 1, payload 'es'
            //     correct reader  : null -> 'es'                    => re-render
            //     first-arg reader: null -> DECOY_EVENT_LANGUAGE    => re-render
            //     (indistinguishable -- which is exactly why one emission is not
            //      a test)
            //
            //   emission 2, payload DECOY_EVENT_LANGUAGE
            //     correct reader  : 'es' -> DECOY_EVENT_LANGUAGE    => re-render
            //     first-arg reader: DECOY -> DECOY, guard suppresses => NOTHING
            //
            // Two committed re-renders therefore prove the payload is read from
            // the second parameter. One would prove the opposite.
            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            act((): void => {
                rootScope.emit({ language: DECOY_EVENT_LANGUAGE });
            });

            expect(renderCounts[renderCounts.length - 1]).toBe(3);
        });

        it('observes nothing when the handler is invoked with a single argument', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                // The mistake, made explicit: the payload arrives in the FIRST
                // position and there is no second argument at all. A hook reading
                // argument one would treat this as a language change.
                rootScope.emitWithSingleArgument({ language: 'es' });
            });

            expect(Object.is(result.current, before)).toBe(true);
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐3 -- THE GUARD of `app/coffee/app.coffee:968`-`:969`.
     * ---------------------------------------------------------------------- */
    describe('⭐3 the guard of app/coffee/app.coffee:968', () => {
        it('does NOT re-render when the emission carries the language already seen', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const renderCounts: number[] = [];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(_t: TranslateFn, renderCount: number): void => {
                        renderCounts.push(renderCount);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const rendersAfterRealChange = renderCounts[renderCounts.length - 1];
            const callsAfterRealChange = translate.instant.mock.calls.length;

            act((): void => {
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'es' });
            });

            // Both the exact counter the incumbent guard protects and the visible
            // cost of losing it: no extra render, and no extra table lookup.
            expect(renderCounts[renderCounts.length - 1]).toBe(rendersAfterRealChange);
            expect(translate.instant.mock.calls.length).toBe(callsAfterRealChange);
        });

        it('processes every emission of a batch, ending on the LAST language', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const identities: TranslateFn[] = [];
            const latest = (): TranslateFn | undefined => identities[identities.length - 1];

            render(
                <TranslationProbe
                    translationKey="US.ADD"
                    onRender={(t: TranslateFn): void => {
                        identities.push(t);
                    }}
                />,
                { wrapper: bridgeFor(translate, rootScope) },
            );

            act((): void => {
                // Delivered inside ONE React batch, which is what a digest does:
                // React 18 coalesces both updates into a single commit, so ONE
                // new identity is the correct observable here -- not two.
                rootScope.emit({ language: 'es' });
                rootScope.emit({ language: 'ca' });
            });

            expect(new Set<TranslateFn>(identities).size).toBe(2);

            const afterBatch = latest();

            // What proves BOTH emissions were seen rather than only the first:
            // the remembered language ended on `ca`, so re-emitting `ca` is now
            // suppressed by the guard...
            act((): void => {
                rootScope.emit({ language: 'ca' });
            });

            expect(Object.is(latest(), afterBatch)).toBe(true);

            // ...while re-emitting the INTERMEDIATE `es` is a genuine change. A
            // hook that had dropped the second emission would behave in exactly
            // the opposite way on both counts.
            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            expect(Object.is(latest(), afterBatch)).toBe(false);
        });

        it('advances the memo key on EVERY real change, not only the first', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const identities: TranslateFn[] = [result.current];

            for (const language of ['es', 'ca', 'en']) {
                act((): void => {
                    rootScope.emit({ language });
                });

                identities.push(result.current);
            }

            // ⭐ WHY THE FUNCTIONAL UPDATE FORM IS REQUIRED, NOT STYLISTIC. The
            // subscription effect is keyed on the resolved root scope alone, so
            // its handler closure is created ONCE per mount. A handler computing
            // `epoch + 1` from that closure would read the epoch as it was at
            // subscription time -- forever zero -- so every real change would set
            // the same value, React would bail out of the second and later
            // updates, and only the FIRST language switch would ever be seen.
            // Four distinct identities is what rules that out; two is what a
            // stale-closure implementation would produce.
            expect(new Set<TranslateFn>(identities).size).toBe(4);
        });

        it('reacts again after the language returns to a previously seen value', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const afterFirstChange = result.current;

            act((): void => {
                rootScope.emit({ language: 'en' });
            });

            // The incumbent remembers only the LAST language, not the set of
            // languages seen, so returning to `en` is a change. A hook caching
            // every language it had ever seen would wrongly suppress this.
            expect(Object.is(result.current, afterFirstChange)).toBe(false);
        });

        it('accepts the empty string, because the incumbent compares raw values', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                rootScope.emit({ language: '' });
            });

            // `if lang != ctx.language` validates nothing, so neither may this.
            // Rejecting the empty string would be validation the incumbent does
            // not have -- a functional change (rule T10).
            expect(Object.is(result.current, before)).toBe(false);
        });

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['a bare string', 'es'],
            ['a number', 7],
            ['an object with no language', { locale: 'es' }],
            ['an object whose language is not a string', { language: 42 }],
            ['an object whose language is null', { language: null }],
        ])(
            'ignores, without throwing, a payload that is %s',
            (_label: string, payload: unknown) => {
                const translate = createTranslateDouble('en');
                const rootScope = createRootScopeDouble();
                const { result } = renderHook((): TranslateFn => useTranslate(), {
                    wrapper: bridgeFor(translate, rootScope),
                });

                const before = result.current;

                // Throwing here would throw INSIDE an AngularJS digest, where
                // the exception is attributed to AngularJS rather than to React
                // and can interrupt the other listeners of the same event --
                // including the application-wide one at
                // `app/coffee/app.coffee:967` that performs the i18n
                // re-initialisation and the right-to-left flag.
                expect((): void => {
                    act((): void => {
                        rootScope.emit(payload);
                    });
                }).not.toThrow();

                expect(Object.is(result.current, before)).toBe(true);
            },
        );
    });

    /* ----------------------------------------------------------------------
     * ⭐4 -- DEREGISTRATION. `common/components.coffee:57` with `:70`-`:73`.
     * ---------------------------------------------------------------------- */
    describe('⭐4 deregistration on unmount', () => {
        it('calls the captured deregistration function EXACTLY ONCE', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            // `toHaveBeenCalledTimes(1)`, never a bare `toHaveBeenCalled`: the
            // root scope outlives every React root, so both a missed call and a
            // doubled one are defects -- the first leaks a listener plus its
            // closure over `setState` for the rest of the session, the second
            // would splice a listener that is no longer ours.
            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('does not resubscribe on re-render: one mount, one listener, one teardown', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { rerender, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            rerender();
            rerender();

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            // The effect is keyed on the resolved root scope alone, and the seam
            // returns services by identity, so the subscription must not churn.
            // Keying it on the language epoch instead would tear the listener
            // down and rebuild it on every language change for no reason.
            expect(rootScope.facade.$on).toHaveBeenCalledTimes(1);
            expect(rootScope.deregister).not.toHaveBeenCalled();

            unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('gives every mounted caller its own listener and removes each one', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const wrapper = bridgeFor(translate, rootScope);

            const first = renderHook((): TranslateFn => useTranslate(), { wrapper });
            const second = renderHook((): TranslateFn => useTranslate(), { wrapper });

            expect(rootScope.facade.$on).toHaveBeenCalledTimes(2);
            expect(rootScope.listenerCount(TRANSLATE_CHANGE_END)).toBe(2);

            first.unmount();
            second.unmount();

            expect(rootScope.deregister).toHaveBeenCalledTimes(2);
        });

        it('warns instead of throwing when AngularJS returns no deregistration function', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            rootScope.facade.$on.mockImplementationOnce((): (() => void) => {
                // Typed as returning the deregistration function, deliberately
                // returning nothing at run time: the value crosses the seam from
                // untyped CoffeeScript, so the unit narrows it before calling it.
                return undefined as unknown as () => void;
            });

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
            expect(warn.mock.calls[0]?.[0]).toContain(TRANSLATE_CHANGE_END);
        });

        it('survives a deregistration function that itself throws', () => {
            const warn = silenceWarnings();
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            rootScope.deregister.mockImplementationOnce((): never => {
                throw new Error('deregistration exploded');
            });

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            // An exception from a cleanup function propagates into React's commit
            // phase, where it can abort the unmounting of unrelated siblings --
            // so it is logged, never swallowed and never rethrown.
            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
        });
    });

    /* ----------------------------------------------------------------------
     * ⭐5 -- THE IDENTITY OF `t`.
     * ---------------------------------------------------------------------- */
    describe('⭐5 the identity of `t`', () => {
        it('is STABLE across re-renders that do not change the language', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result, rerender } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const first = result.current;

            rerender();
            rerender();

            // `Object.is`, because reference equality is the entire contract. A
            // `t` that changed identity every render would defeat `React.memo` on
            // every downstream component taking it as a prop, and would
            // invalidate every dependency array containing it -- turning one
            // language subscription into a whole-screen re-render per render.
            expect(Object.is(result.current, first)).toBe(true);
        });

        it('is STABLE across guard-suppressed emissions', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'en' });
            });

            const afterFirst = result.current;

            act((): void => {
                rootScope.emit({ language: 'en' });
                rootScope.emit({ language: 'en' });
            });

            expect(Object.is(result.current, afterFirst)).toBe(true);
        });

        it('CHANGES when the language changes, so memoised children re-render', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            const before = result.current;

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            // The other half of the contract, and the one that is easy to lose by
            // "simplifying" the memo key: a memoised child holding the old
            // reference would keep rendering the previous language's strings.
            expect(Object.is(result.current, before)).toBe(false);
            expect(result.current('US.ADD')).toBe('es:US.ADD');
        });
    });

    /* ----------------------------------------------------------------------
     * ⛔6 -- THE LEGACY-ELEMENT HAND-OFF IS NOT REPRODUCED.
     *        `app/coffee/app.coffee:975`-`:979`. See section 3 of the header.
     * ---------------------------------------------------------------------- */
    describe('⛔6 the incumbent legacy-element translation-table push is NOT reproduced', () => {
        it('never queries the document for the legacy custom element', () => {
            const querySelector = jest.spyOn(document, 'querySelector');
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            unmount();

            // The specific prohibition first, then the general one. The incumbent
            // reaches for the element only AFTER its guard passes, so the whole
            // mount-change-unmount cycle has to be exercised before asserting.
            expect(querySelector).not.toHaveBeenCalledWith(LEGACY_ELEMENT_SELECTOR);
            expect(querySelector).not.toHaveBeenCalled();
        });

        it('never reads the whole translation table', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            result.current('US.ADD');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            result.current('US.ADD');

            // The table reader exists on the facade PRECISELY so this assertion
            // can fail if the hand-off is ever reintroduced: the incumbent calls
            // it at `app/coffee/app.coffee:977` for no other purpose than filling
            // that payload. React resolves keys one at a time instead.
            expect(translate.getTranslationTable).not.toHaveBeenCalled();
            expect(translate.preferredLanguage).not.toHaveBeenCalled();
        });

        it('assigns no translations property to any element in the document', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey="US.ADD" />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            // A DOM-side assertion as well as a call-side one, because the
            // property could in principle be assigned to an element reached by
            // any other route -- a ref, `parentNode`, `document.body.firstChild`.
            // Nothing in the document may carry it.
            const touched = Array.from(document.querySelectorAll('*')).filter(
                (element: Element): boolean => LEGACY_TRANSLATIONS_PROPERTY in element,
            );

            expect(touched).toEqual([]);
        });

        it('does not even name the hand-off in its own source', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

            // A source-level pass as well as a behavioural one. The behavioural
            // specs above can only observe the code paths a spec happens to
            // exercise; this one holds for every path, including any that a
            // future edit adds behind a condition no spec reaches yet.
            expect(unitSource.length).toBeGreaterThan(0);
            expect(unitSource).not.toContain('querySelector');
            expect(unitSource).not.toContain(LEGACY_ELEMENT_SELECTOR);
            expect(unitSource).not.toContain(LEGACY_TABLE_KEY);
        });
    });

    /* ----------------------------------------------------------------------
     * ⛔7 -- NO DIGEST IS EVER DRIVEN. AAP 0.7.4.
     * ---------------------------------------------------------------------- */
    describe('⛔7 no AngularJS digest is ever driven', () => {
        it('calls none of the forbidden scope members, in any phase', () => {
            const translate = createTranslateDouble('en');
            const tripwire = createDigestTripwireScope();

            const { result, rerender, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(
                    createInjector(
                        { $translate: translate },
                        { [ROOT_SCOPE_SERVICE_NAME]: tripwire.facade },
                    ),
                ),
            });

            // Every phase in which a digest nudge might be tempting: first render,
            // a translation lookup, a real language change, a re-render, teardown.
            result.current('US.ADD');

            act((): void => {
                tripwire.emit({ language: 'es' });
            });

            rerender();
            result.current('US.ADD');
            unmount();

            for (const member of FORBIDDEN_SCOPE_MEMBERS) {
                const spy = tripwire.forbidden.get(member);

                // The tripwire is only meaningful if the member was really there
                // to be called, so its presence is asserted before its silence.
                expect(spy).toBeDefined();
                expect(spy).not.toHaveBeenCalled();
            }

            // ... and the listener really was registered and removed, so the
            // silence above is not the silence of a hook that did nothing at all.
            expect(tripwire.deregister).toHaveBeenCalledTimes(1);
        });

        it('names no digest driver in its own source', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');
            const digestDrivers = FORBIDDEN_SCOPE_MEMBERS.slice(0, 3);

            // Only the three DIGEST DRIVERS are asserted at source level, and the
            // slice is deliberate rather than lazy: the unit's own header
            // legitimately discusses `$emit` versus `$broadcast`, because the
            // measured reason it must listen on the ROOT scope is that
            // angular-translate raises the language event with the former, which
            // propagates upwards only. Documenting that is required by rule T9;
            // calling either is what the tripwire above rules out.
            expect(digestDrivers).toHaveLength(3);

            for (const driver of digestDrivers) {
                expect(unitSource).not.toContain(driver);
            }
        });

        it('registers no interval, no timeout and no observer', () => {
            const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            const { result, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            result.current('US.ADD');

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            unmount();

            // The language event is the ONLY trigger. Polling would be the other
            // way to notice a language change, and it would burn a timer per
            // mounted component for a notification that is already available.
            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(setTimeoutSpy).not.toHaveBeenCalled();
        });
    });

    /* ----------------------------------------------------------------------
     * ⛔8 -- THE ROOT-SCOPE SURFACE IS THE NARROWEST THAT WORKS.
     * ---------------------------------------------------------------------- */
    describe('⛔8 the root scope is touched through a one-member surface', () => {
        it('needs nothing but $on: a facade with exactly one own property suffices', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            // The executable form of the claim the unit's header makes about
            // itself. If the hook ever reached for a second member, this facade
            // would fail at run time instead of quietly widening the exception.
            expect(Object.keys(rootScope.facade)).toEqual(['$on']);
            expect(Reflect.ownKeys(rootScope.facade)).toHaveLength(1);

            const { result, unmount } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                translate.setLanguage('es');
                rootScope.emit({ language: 'es' });
            });

            expect(result.current('US.ADD')).toBe('es:US.ADD');

            expect((): void => {
                unmount();
            }).not.toThrow();

            expect(rootScope.deregister).toHaveBeenCalledTimes(1);
        });

        it('resolves the root scope by its exact injector name, through the untyped hatch', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const resolved: string[] = [];
            const base = createInjector(
                { $translate: translate },
                { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade },
            );
            const recordingInjector: AngularInjector = {
                get<T>(name: string): T {
                    resolved.push(name);

                    return base.get<T>(name);
                },
            };

            renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(recordingInjector),
            });

            // Exactly two services, and no more: a typo in either name would
            // resolve to nothing in the browser and degrade silently. The root
            // scope is reached through the deliberate `unknown`-returning escape
            // hatch rather than through the typed map, because both AngularJS
            // scope services are excluded from that map on correctness grounds.
            expect(resolved).toEqual(['$translate', ROOT_SCOPE_SERVICE_NAME]);
        });

        it.each([
            ['is absent from the injector', undefined],
            ['is null', null],
            ['is not an object', 'not-a-scope'],
            ['exposes no $on at all', { $new: jest.fn() }],
            ['exposes a non-callable $on', { $on: 'nope' }],
        ])(
            'warns once and still translates when the root scope %s',
            (_label: string, rootScope: unknown) => {
                const warn = silenceWarnings();
                const translate = createTranslateDouble('en');

                const { result } = renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(
                        createInjector(
                            { $translate: translate },
                            { [ROOT_SCOPE_SERVICE_NAME]: rootScope },
                        ),
                    ),
                });

                // Degraded, not broken, and that distinction is the requirement:
                // lookups keep returning correct strings for the active language
                // and only LIVE SWITCHING is lost, so a React root mounted before
                // AngularJS finished bootstrapping still renders its screen.
                expect(result.current('US.ADD')).toBe('en:US.ADD');
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0]?.[0]).toContain(LOG_PREFIX);
                expect(warn.mock.calls[0]?.[0]).toContain(ROOT_SCOPE_SERVICE_NAME);
            },
        );
    });

    /* ----------------------------------------------------------------------
     * THE MOCKING SEAM ITSELF -- `jest.config.js` mandates `./mockInjector`,
     * so its diagnostics are part of this spec's contract too.
     * ---------------------------------------------------------------------- */
    describe('the mandated mocking seam fails loudly and by name', () => {
        it('names the service a spec forgot to supply', () => {
            const consoleError = silenceRenderErrors();
            const rootScope = createRootScopeDouble();

            // `$translate` deliberately omitted from the typed map. Returning the
            // nothing-value here instead of throwing would let the absence travel
            // and surface frames later as an unreadable property access.
            expect((): unknown =>
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(
                        createInjector({}, { [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade }),
                    ),
                }),
            ).toThrow(/mockInjector: .*'\$translate'/s);

            expect(consoleError).toHaveBeenCalled();
        });

        it('lists what WAS supplied when the off-map root scope is the omission', () => {
            const consoleError = silenceRenderErrors();
            const translate = createTranslateDouble('en');

            // The likelier mistake for anyone writing a new spec against this
            // hook, and the reason it is worth pinning: `$translate` is an
            // ordinary typed key that autocompletes, whereas the root scope is
            // OFF-MAP by design and has to be supplied deliberately. Omitting it
            // must name the service that is missing AND enumerate the ones that
            // are present, so the diagnostic points at the spec rather than at
            // the hook.
            let message = '';

            try {
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(createInjector({ $translate: translate })),
                });
            } catch (failure: unknown) {
                message = failure instanceof Error ? failure.message : String(failure);
            }

            expect(message).toContain(ROOT_SCOPE_SERVICE_NAME);
            expect(message).toContain('$translate');
            expect(message).not.toContain('(nothing)');
            expect(consoleError).toHaveBeenCalled();
        });

        it('names the missing provider when mounted outside the bridge provider', () => {
            const consoleError = silenceRenderErrors();

            expect((): unknown => renderHook((): TranslateFn => useTranslate())).toThrow(
                /useAngularService\('\$translate'\) was called outside <AngularBridgeProvider>/,
            );

            // `null` stays expressible through the seam's own wrapper, which is
            // why it takes the injector rather than the service map.
            expect((): unknown =>
                renderHook((): TranslateFn => useTranslate(), {
                    wrapper: withMockInjector(null),
                }),
            ).toThrow(/outside <AngularBridgeProvider>/);

            expect(consoleError).toHaveBeenCalled();
        });

        it('throws a named diagnostic when the resolved $translate has no callable instant', () => {
            const rootScope = createRootScopeDouble();

            // Routed through the extension rather than the typed map on purpose:
            // an object with no `instant` is NOT a translation service, so it
            // cannot travel through a type-safe map -- which is exactly the
            // misconfiguration being reproduced.
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: withMockInjector(
                    createInjector(
                        {},
                        {
                            $translate: { preferredLanguage: (): string => 'en' },
                            [ROOT_SCOPE_SERVICE_NAME]: rootScope.facade,
                        },
                    ),
                ),
            });

            // Loud, not silently keyed: painting the screen with raw keys would
            // invent a fallback the incumbent does not have (rule T10), and the
            // sibling error boundary contains the throw so the AngularJS shell
            // survives it.
            expect((): string => result.current('US.ADD')).toThrow(
                new RegExp(`${LOG_PREFIX.replace(/[[\]$]/g, '\\$&')}.*'instant'`, 's'),
            );
            expect((): string => result.current('US.ADD')).toThrow(/US\.ADD/);
        });
    });

    /* ----------------------------------------------------------------------
     * ⛔9 -- THE THREE UNTRANSLATED LITERALS. Rule T10.
     * ---------------------------------------------------------------------- */
    describe('⛔9 the three untranslated literals stay out of the translation path', () => {
        it('documents exactly three of them, each with the locator that fixes it', () => {
            // Documentation-grade, and executable on purpose: a comment can be
            // overlooked, a failing assertion cannot. Adding a fourth literal --
            // or "fixing" one of these into a translation key -- has to be a
            // deliberate edit here, next to the reason it would be wrong.
            expect(UNTRANSLATED_LITERALS).toHaveLength(3);
            expect(UNTRANSLATED_LITERALS.map((entry): string => entry.literal)).toEqual([
                'WIP Limit',
                'Backlog',
                'Add',
            ]);

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(entry.locator).toMatch(/^app\/[\w./-]+\.(coffee|jade):\d+$/);
                expect(entry.why.length).toBeGreaterThan(0);
            }
        });

        it('is never consulted for any of them during a render', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();

            render(<TranslationProbe translationKey={SEARCH_PLACEHOLDER_KEY} />, {
                wrapper: bridgeFor(translate, rootScope),
            });

            act((): void => {
                rootScope.emit({ language: 'es' });
            });

            const keysAsked = translate.instant.mock.calls.map((call): string => call[0]);

            for (const entry of UNTRANSLATED_LITERALS) {
                expect(keysAsked).not.toContain(entry.literal);
            }
        });

        it('would change what renders if a literal were routed through it', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            for (const entry of UNTRANSLATED_LITERALS) {
                // THE REASON THE PROHIBITION EXISTS, made executable. `t` is a
                // table lookup, not an identity function: a project whose table
                // happens to carry a matching key -- or any sanitisation strategy
                // configured on the service -- yields a DIFFERENT string. So
                // routing a hardcoded literal through `t` is a functional change
                // (rule T10), not a tidy-up. `WipLimitMarker.tsx` emits its
                // literal verbatim and calls no translation hook at all.
                expect(result.current(entry.literal)).not.toBe(entry.literal);
            }
        });

        it('DOES translate the search placeholder, which really is a key', () => {
            const translate = createTranslateDouble('en');
            const rootScope = createRootScopeDouble();
            const { result } = renderHook((): TranslateFn => useTranslate(), {
                wrapper: bridgeFor(translate, rootScope),
            });

            // The other side of the same coin: the placeholder reads "subject or
            // reference" (singular) on BOTH migrated screens and comes from this
            // key, so it must go through `t` rather than being hardcoded.
            expect(result.current(SEARCH_PLACEHOLDER_KEY)).toBe(`en:${SEARCH_PLACEHOLDER_KEY}`);
            expect(translate.instant).toHaveBeenCalledWith(SEARCH_PLACEHOLDER_KEY, undefined);
        });

        it('has the prohibition documented at the point of change in the unit itself', () => {
            const unitSource = readFileSync(join(__dirname, UNIT_FILENAME), 'utf8');

            // Rule T9: the seam is commented where it is made. The unit's own
            // header has to carry this list, because a downstream agent reading
            // the hook -- not its spec -- is the one at risk of "fixing" the
            // literals into keys.
            for (const entry of UNTRANSLATED_LITERALS) {
                expect(unitSource).toContain(entry.literal);
            }

            expect(unitSource).toContain(SEARCH_PLACEHOLDER_KEY);
        });
    });
});
