/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAngularBroadcastListener, useAngularService } from './useAngularService';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * Every user-visible string on these screens is looked up through this hook, with
 * four deliberate exceptions that are NOT keys and must not be turned into keys:
 * the literal `WIP Limit` injected by the WIP marker, the `Backlog` panel heading,
 * and the `Add` sprint-sidebar link label are hardcoded English in the markup being
 * reproduced. `COMMON.FILTERS.INPUT_PLACEHOLDER` is the opposite case -- it really
 * is a key, it renders "subject or reference" on both screens, and it must go
 * through the hook rather than being hardcoded.
 */

/**
 * angular-translate raises this on the application root scope, and it emits rather
 * than broadcasts -- the event propagates upwards only -- so the listener has to sit
 * on the ROOT scope to see it at all.
 */
const TRANSLATE_CHANGE_END = '$translateChangeEnd';

/**
 * How the language-event host is named in this file's diagnostics.
 *
 * The NAME the object is registered under in the injector is no longer written
 * here at all: `./useAngularService.ts` holds that string as a module constant
 * and exposes it through the zero-argument {@link useAngularBroadcastListener}
 * accessor, so this file cannot ask the injector for anything else even by
 * accident. What remains here is a label for the two warnings below, which have
 * to be able to tell a reader WHICH AngularJS object failed to behave.
 *
 * See section 6 of the file header for why this file -- and only this file --
 * hears a root-scope notification, and for the measured evidence that no
 * narrower mechanism can observe {@link TRANSLATE_CHANGE_END}.
 */
const LANGUAGE_EVENT_HOST_LABEL = '$rootScope';

const LOG_PREFIX = '[taiga-react-bridge:useTranslate]';

type TranslateFn = (key: string, interpolateParams?: Record<string, unknown>) => string;

interface TranslateChangeEndPayload {
    readonly language: string;
}

type AngularEventDeregistration = () => void;

/* ==========================================================================
 * NARROWING HELPERS
 *
 * Module-scope pure functions, so they are testable in isolation, allocate
 * nothing per render, and keep the hook body itself short enough to read in
 * one pass.
 *
 * There is only ONE of them left. Narrowing the injector's answer to the
 * `$on`-only registrar is no longer this file's job: the sibling accessor
 * `useAngularBroadcastListener` performs it and publishes the narrow contract,
 * so this file receives an already-narrow value or `null` (section 6 of the
 * file header).
 * ========================================================================== */

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

function useTranslate(): TranslateFn {
    // The typed accessor. A pure lookup, so it is safe at the top of the hook,
    // and it raises the named diagnostic for a missing provider on our behalf
    // (`./useAngularService.ts:1535`).
    const translate = useAngularService('$translate');

    // ⭐ The single sanctioned root-scope touch point in the entire React tree.
    //
    // TECHNOLOGY SEAM (rule T9). What comes back is NOT the AngularJS root
    // scope: it is `AngularBroadcastListener | null`, a contract whose only
    // member is `$on`, so the apply/async-apply/digest trio, both event raisers,
    // child-scope creation and watch registration are unnameable here rather
    // than merely discouraged. The service name is hardcoded inside the accessor
    // (`./useAngularService.ts`), so this file names no AngularJS service at all
    // and no arbitrary-name injector escape exists to be reached for. Section 6
    // of this file's header carries the full argument, including the measured
    // evidence that the `events.onAngularEvent` bridge callback cannot observe
    // this particular event because angular-translate `$emit`s it on the root.
    //
    // `null` is a supported, expected answer -- see the degradation branch in
    // the effect below.
    const broadcasts = useAngularBroadcastListener();

    // ⭐ THE DISPOSED LATCH -- the second half of section 3's guarantee, and the
    // half that does not depend on AngularJS cooperating.
    //
    // Calling the deregistration function is the primary teardown, but it can
    // fail to happen: AngularJS may return something that is not callable, or a
    // substituted double or a future reimplementation may throw from it. In
    // either case the listener STAYS REGISTERED on an object that outlives every
    // React root, holding a closure over this component's state setter for the
    // rest of the session -- a listener that keeps firing after unmount, which is
    // React's "update on an unmounted component" defect and an unbounded
    // accumulation across navigations.
    //
    // This ref makes that residue INERT rather than merely warned about: cleanup
    // sets it before attempting deregistration, and the handler returns
    // immediately when it is set. So a listener that could not be removed does no
    // work, touches no state and observes nothing. A ref, not state, because
    // writing it must not schedule a render and it must be readable from a
    // closure that has already been detached from the tree.
    //
    // It is reset to `false` when the effect re-subscribes, so a re-subscription
    // (the effect's dependency changing) is not mistaken for a teardown.
    const disposedRef = useRef<boolean>(false);

    const lastLanguageRef = useRef<string | null>(null);

    const [languageEpoch, setLanguageEpoch] = useState<number>(0);

    useEffect((): AngularEventDeregistration | undefined => {
        // Live again. Set here rather than in the cleanup's counterpart position
        // so that a re-subscription re-arms the handler, while an unmount -- which
        // runs the cleanup and never re-runs the effect -- leaves it latched.
        disposedRef.current = false;

        if (broadcasts === null) {
            // Degraded, not broken: `t` keeps returning correct strings for the
            // language that is active, and only live switching is lost. Warned
            // once per mount rather than thrown, because throwing here would
            // take down a subtree that is otherwise perfectly renderable -- and
            // warned rather than swallowed, because a silent loss of language
            // switching is exactly the kind of defect that reaches production.
            console.warn(
                `${LOG_PREFIX} The AngularJS '${LANGUAGE_EVENT_HOST_LABEL}' resolved by the ` +
                    'bridge injector exposes no callable $on, so ' +
                    `'${TRANSLATE_CHANGE_END}' cannot be observed and translated strings ` +
                    'will not refresh on a language change. Translation lookups themselves ' +
                    'are unaffected.',
            );

            return undefined;
        }

        const handleTranslateChangeEnd = (_event: unknown, ctx: unknown): void => {
            // ⭐ FIRST, BEFORE ANYTHING ELSE. If teardown has run, this listener
            // is residue that AngularJS refused to remove (see the latch above),
            // and residue must do nothing at all: no payload read, no ref write,
            // no state update on an unmounted component. Checked first so the
            // guarantee does not depend on the order of the checks below.
            if (disposedRef.current) {
                return;
            }

            const language = readLanguage(ctx);

            if (language === null) {
                return;
            }

            // The event fires on every language SET, including a set to the language
            // already in force. Re-rendering on those would invalidate the memoised
            // translator for no change at all, so only a real change counts.
            if (lastLanguageRef.current === language) {
                return;
            }

            lastLanguageRef.current = language;

            setLanguageEpoch((previousEpoch: number): number => previousEpoch + 1);
        };

        const deregistration = broadcasts.$on(TRANSLATE_CHANGE_END, handleTranslateChangeEnd);

        return (): void => {
            // ⭐ LATCH FIRST, DEREGISTER SECOND -- the order is the whole point.
            // Everything below can fail; this cannot. Setting the latch before
            // the first fallible statement means that however deregistration
            // goes, any listener still attached to an object that outlives this
            // root is already inert by the time it could next fire.
            disposedRef.current = true;

            if (!isDeregistration(deregistration)) {
                console.warn(
                    `${LOG_PREFIX} AngularJS returned no deregistration function for ` +
                        `'${TRANSLATE_CHANGE_END}', so the listener could not be removed. ` +
                        'It will stay registered on the application root scope for the rest ' +
                        'of the session, but it has been latched inert and will do nothing ' +
                        'when it fires.',
                );

                return;
            }

            try {
                deregistration();
            } catch (teardownFailure: unknown) {
                console.warn(
                    `${LOG_PREFIX} Deregistering the '${TRANSLATE_CHANGE_END}' listener ` +
                        'threw; the listener may still be registered on the application ' +
                        'root scope, but it has been latched inert and will do nothing when ' +
                        'it fires.',
                    teardownFailure,
                );
            }
        };
        // Keyed on the resolved registrar alone. AngularJS services are
        // singletons and the accessor hands the value back by reference with no
        // wrapper, so this is one stable value for the lifetime of the
        // application: the effect subscribes once per mount and never churns.
        // `lastLanguageRef` is a ref and `setLanguageEpoch` is
        // state-setter-stable, so neither belongs here; including the epoch would
        // tear the subscription down and rebuild it on every language change for
        // no reason at all.
    }, [broadcasts]);

    return useCallback<TranslateFn>(
        (key: string, interpolateParams?: Record<string, unknown>): string => {
            if (typeof translate.instant !== 'function') {
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
        // `languageEpoch` is not read in the body above; it is an identity-invalidation
        // key. Without it, memoised children keep rendering the previous language's
        // strings after a change.
        [translate, languageEpoch],
    );
}

export { useTranslate };
export type { TranslateFn };
