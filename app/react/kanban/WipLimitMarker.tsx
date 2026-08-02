/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * WipLimitMarker — the horizontal work-in-progress rule, with its centred
 * "WIP Limit" chip, that a Kanban status column draws between its cards once
 * the card count reaches the status's configured limit.
 *
 * ===========================================================================
 * WHAT THIS FILE REPLACES, AND WHY THE SHAPE CHANGED (transformation rule T9)
 * ===========================================================================
 * The incumbent implementation is `KanbanWipLimitDirective`, originally at
 * app/coffee/modules/kanban/main.coffee L815-L853 and retained in that file
 * after its registration was retired, under the retirement note at L1029-L1108,
 * as the authoritative behavioural reference. It was IMPERATIVE: on each of
 * four broadcast events it deferred a tick, counted the cards already committed
 * to the DOM, deleted any marker it had previously injected, and re-injected a
 * fresh one as an HTML string placed after a specific card element.
 *
 * Three technology-specific substitutions follow from moving that to React, and
 * each one is deliberate:
 *
 *  1. THE CARD COUNT IS NOW A PROP, NOT A DOM QUERY.
 *     The directive counted `$el.find("tg-card")` (main.coffee L1075) — by
 *     ELEMENT NAME, so it counted rendered cards rather than model entries.
 *     Two consequences carry over unchanged. Virtualised, off-screen cards are
 *     still rendered elements, so the count never varied with scrolling; and
 *     because the query ran a tick late it always observed the committed DOM.
 *     React owns the card list at render time, so the count is passed in as a
 *     plain number — `resolveWipLimitState` below takes `cardCount` — and the
 *     deferral disappears with the query that needed it. Nothing about the
 *     resulting count differs; only where it is read from does.
 *
 *  2. PLACEMENT IS NOW STRUCTURAL, NOT AN `after()` INJECTION.
 *     The directive computed a card element and inserted the marker after it
 *     (main.coffee L1093), first removing any earlier marker (L1090) precisely
 *     because re-running an injection would otherwise accumulate duplicates.
 *     React renders the marker declaratively at one position in the column's
 *     child list, so the removal step has no React equivalent and none is
 *     written. `resolveWipLimitIndex` exposes the very same insertion arithmetic
 *     so the caller can place it, and there must never be more than one marker
 *     in a column.
 *
 *  3. THE FOUR REDRAW EVENTS ARE GONE, AND THAT IS NOT A BEHAVIOUR CHANGE.
 *     The directive subscribed to `redraw:wip`, `kanban:us:move`,
 *     `usform:new:success` and `usform:bulk:success` (main.coffee L1097-L1100)
 *     only in order to learn that the card count had changed. In React a
 *     changed count is a changed prop, so the recomputation is the render
 *     itself. The `, 0, false` trailing arguments on the deferral — the `false`
 *     meaning "do not trigger a digest" — likewise have no counterpart, because
 *     React state updates never enter an AngularJS digest.
 *
 * ===========================================================================
 * THE THRESHOLD LADDER — REPRODUCED EXACTLY, INCLUDING ITS ORDER
 * ===========================================================================
 * From main.coffee L1080-L1088 (identical to the original L826-L834). The
 * comparison order is load-bearing: `one-left` is tested BEFORE `reached`, and
 * `reached` before `exceeded`, so a column that satisfies more than one reading
 * resolves to the earliest branch.
 *
 *   cardCount + 1 === wipLimit  ->  'one-left'   after the LAST card
 *   cardCount     === wipLimit  ->  'reached'    after the LAST card
 *   cardCount      >  wipLimit  ->  'exceeded'   after the card at wipLimit - 1
 *
 * ⚠ THE `exceeded` INDEX IS DIFFERENT, AND THIS IS THE EASY MISTAKE.
 * `one-left` and `reached` both attach after `cards[cards.length - 1]`, the
 * final card. `exceeded` attaches after `cards[status.wip_limit - 1]` — the
 * last PERMITTED card — so the surplus cards render BELOW the rule and the rule
 * marks the boundary at the limit rather than the end of the list. Getting this
 * wrong produces a correct class name at the wrong position: nothing throws,
 * no test that only inspects the class name notices, and the regression is
 * purely visual. `resolveWipLimitIndex` exists so this arithmetic is written
 * once, in one place, and asserted directly.
 *
 * ===========================================================================
 * WHY A MATCHED BRANCH CAN STILL RENDER NOTHING — and how that settles the
 * `wipLimit` truthiness question (Drift Register entry D13)
 * ===========================================================================
 * The directive's final guard is `if element` (main.coffee L1092), NOT
 * `if wipLimitClass`. So a branch could match, set a class, and still inject
 * nothing at all whenever the computed index addressed no card. That is not an
 * edge case to be tidied away; it IS the observable behaviour, and reproducing
 * it faithfully answers every awkward input without inventing a rule:
 *
 *   wipLimit absent, any count  ->  the loose `>` comparison in the source
 *                                   coerced the absent limit to zero, so the
 *                                   `exceeded` branch matched for a non-empty
 *                                   column, but the index landed at -1 and the
 *                                   guard discarded it. No marker.
 *   wipLimit 0, count >= 1      ->  `exceeded` matched, index 0 - 1 = -1,
 *                                   discarded by the guard. No marker. The
 *                                   arithmetic is surprising; it is also what
 *                                   the application does, and T10 forbids
 *                                   "improving" it.
 *   wipLimit 1, count 0         ->  `one-left` matched, index 0 - 1 = -1,
 *                                   discarded. No marker on an empty column.
 *
 * `resolveWipLimitState` therefore applies the ladder and then checks that a
 * card actually exists at the resolved index, returning `undefined` when it
 * does not. The absent-limit case is short-circuited ahead of the ladder
 * instead of being coerced, because the outcome is provably identical for every
 * count and the type system will not compare a missing limit numerically. The
 * result is the source's behaviour, derived rather than approximated.
 *
 * ===========================================================================
 * THE LABEL IS A HARDCODED ENGLISH LITERAL — Drift Register entry D5
 * ===========================================================================
 * main.coffee L1093 emits the chip text as a plain literal. It never passes
 * through the translation service, and no locale entry matches it: the nearest,
 * `ADMIN.US_STATUS.WIP_LIMIT_COLUMN`, reads "WIP limit" with a lower-case "l".
 * Behavioural equivalence therefore outranks the project-wide guidance that all
 * copy be translated. This component emits the identical literal, capital "L"
 * included. No translation hook is called, no key is invented, and no locale
 * file is touched. Logged as D5 in the Drift Register kept under
 * e2e-react/artifacts/figma-comparison/. Do not "improve" it.
 *
 * ===========================================================================
 * THIS FILE AUTHORS NO STYLING WHATSOEVER (rules T1, T2, G-DS-3, G-DS-4)
 * ===========================================================================
 * Every appearance the three states have is already declared, and stays
 * unedited, in app/styles/modules/kanban/kanban-table.scss L264-L299 — the box
 * geometry and corner radius, the chip's own colours and its centring
 * transform, the top-edge rule shared by `reached` and `one-left`, the reduced
 * strength that makes `one-left` read as a softer tint of the same red, and the
 * second rule along the bottom edge that distinguishes `exceeded`. Emitting the
 * class names is the entire integration; authoring a rule that already exists
 * would be a compliance violation rather than an improvement.
 *
 * The folded-column case needs no logic either. `.vfold .kanban-wip-limit`
 * hides the marker outright at kanban-table.scss L79-L81, so a folded column
 * suppresses it through the cascade. That is why there is deliberately NO
 * `folded` prop and no conditional render for it: adding one would duplicate
 * behaviour the stylesheet already owns.
 *
 * ===========================================================================
 * FIDELITY EVIDENCE (Figma node 1:7, file B0XlGp5ZYFOfeARVceUVRE)
 * ===========================================================================
 * The linked frame is a flattened screenshot of the live AngularJS output, and
 * the committed raster design-reference/kanban-screen.png at the parent
 * repository root is its byte-verified equivalent. Measured off it, the marker
 * appears exactly twice, both in the NEW column, pixel-identical in geometry
 * and differing only in colour: swimlane "autem quas" with counter "2 / 3"
 * renders `one-left` at the softer tint, and swimlane "hic ut" with counter
 * "2 / 2" renders `reached` at full strength. In both cases the marker is the
 * LAST child of its column cell, sitting below the final card — which
 * independently confirms the insertion position this file computes for those
 * two states — and spans the column's inner content width exactly, which is
 * what the stylesheet's existing horizontal spacing already produces.
 *
 * The frame's own counter matrix corroborates the ladder from the other
 * direction: of the five columns that have a limit configured, only those two
 * draw a rule. Columns reading "1 / 4", "0 / 2" and "1 / 4" draw none, and each
 * of those falls outside all three branches below.
 *
 * `exceeded` does NOT appear anywhere in the frame. Per Drift Register entry D4
 * a state absent from the frame is built from the source markup and the
 * existing stylesheet, never inferred from the image — which is precisely what
 * the third branch does. Its appearance is fully declared at
 * kanban-table.scss L295-L298.
 */

import type { ReactElement } from 'react';

/**
 * The three WIP threshold states, spelled exactly as the CSS class names they
 * become.
 *
 * The strings are the contract, not an internal enumeration: each one is
 * appended verbatim to `kanban-wip-limit` and is selected by
 * app/styles/modules/kanban/kanban-table.scss L283-L298. Renaming a member
 * would silently unstyle the marker, so the union deliberately mirrors the
 * stylesheet rather than reading as idiomatic TypeScript.
 *
 * There is no fourth member and no "none" member. The absence of a marker is
 * represented by `undefined` from {@link resolveWipLimitState}, mirroring the
 * source, where no matching branch left the injection guard falsy and nothing
 * was added to the column at all.
 */
type WipLimitState = 'one-left' | 'reached' | 'exceeded';

/**
 * Zero-based index of the card AFTER which the marker is rendered.
 *
 * Extracted as its own exported function for one reason: the position is the
 * half of this component's behaviour that a class-name assertion cannot see,
 * and the caller that lays out the column needs the same number this file uses
 * internally. Duplicating the arithmetic at the call site is exactly how the
 * two drift apart.
 *
 * `one-left` and `reached` return `cardCount - 1`, the final card, from
 * app/coffee/modules/kanban/main.coffee L1082 and L1085. `exceeded` returns
 * `wipLimit - 1`, the last permitted card, from L1088 — a DIFFERENT index, so
 * the surplus cards fall below the rule.
 *
 * The result is intentionally allowed to be negative, and callers must treat a
 * negative index as "no card at that position". That is not a defect: it is how
 * the incumbent guard at L1092 discarded a matched branch whose index addressed
 * no element, and {@link resolveWipLimitState} relies on it to return
 * `undefined` for an empty column or a zero limit. See the Drift Register D13
 * discussion in this file's header.
 *
 * @param cardCount Number of cards rendered in the column.
 * @param wipLimit  The status's configured limit. Callers hold a real number
 *                  here; the absent-limit case never reaches this function
 *                  because {@link resolveWipLimitState} rejects it first.
 * @param state     The state already resolved for this column.
 * @returns The zero-based index of the card the marker follows.
 */
export function resolveWipLimitIndex(
    cardCount: number,
    wipLimit: number,
    state: WipLimitState,
): number {
    return state === 'exceeded' ? wipLimit - 1 : cardCount - 1;
}

/**
 * Resolves which marker a column should render, or `undefined` for none.
 *
 * A faithful port of `KanbanWipLimitDirective`
 * (app/coffee/modules/kanban/main.coffee L1069-L1105): the archived gate, then
 * the three-branch ladder in its original order, then the guard that discards a
 * matched branch pointing at no card.
 *
 * Pure, synchronous and free of React, so the arithmetic can be asserted on its
 * own and reused by the column that lays the marker out. It reads no service,
 * issues no request and persists nothing — neither did the directive.
 *
 * @param cardCount  Number of cards rendered in the column. Replaces the
 *                   directive's `$el.find("tg-card")` length; see this file's
 *                   header for why the substitution is behaviour-preserving.
 * @param wipLimit   The status's configured limit, or `null` when the status has
 *                   none. A missing limit always yields `undefined`.
 * @param isArchived Whether this is the archived status. Reproduces the gate
 *                   `if status and not status.is_archived` at L1096: the
 *                   archived column never shows a marker.
 * @returns The state whose class name the column should emit, or `undefined`
 *          when the column renders no marker at all.
 */
export function resolveWipLimitState(
    cardCount: number,
    wipLimit: number | null,
    isArchived: boolean,
): WipLimitState | undefined {
    // main.coffee L1096: the archived status subscribed to no redraw event, so
    // it never acquired a marker. Checked first, before any arithmetic, because
    // no limit value can override it.
    if (isArchived) {
        return undefined;
    }

    // A status with no configured limit renders no marker for any card count.
    // Short-circuited rather than coerced: the source's loose `>` comparison
    // treated the missing limit as zero and so entered the `exceeded` branch for
    // a non-empty column, but the index it then computed addressed no card and
    // the guard at L1092 threw the result away. The outcome is `undefined` for
    // every count either way, and returning here keeps the comparisons below
    // strictly numeric.
    if (wipLimit === null) {
        return undefined;
    }

    // main.coffee L1080-L1088, in the source's exact order. `one-left` is tested
    // before `reached`, and `reached` before `exceeded`.
    let state: WipLimitState | undefined = undefined;

    if (cardCount + 1 === wipLimit) {
        state = 'one-left';
    } else if (cardCount === wipLimit) {
        state = 'reached';
    } else if (cardCount > wipLimit) {
        state = 'exceeded';
    }

    if (state === undefined) {
        return undefined;
    }

    // main.coffee L1092 is `if element`, not `if wipLimitClass`. A matched branch
    // whose index addresses no card injected nothing, which is what makes an
    // empty column and a zero limit render nothing. Reproduced here as a bounds
    // check against the same index the caller will position the marker at.
    const cardIndex = resolveWipLimitIndex(cardCount, wipLimit, state);

    if (cardIndex < 0 || cardIndex >= cardCount) {
        return undefined;
    }

    return state;
}

/**
 * Props for {@link WipLimitMarker}.
 *
 * Exactly one member, because the incumbent markup carried exactly one variable:
 * the state class. The label is fixed (Drift Register entry D5), the appearance
 * comes wholly from the unedited stylesheet, and the position is the caller's
 * concern — computed with {@link resolveWipLimitIndex} — so nothing else has a
 * counterpart in the source.
 *
 * There is deliberately no `label`, no `className`, no `onClick`, no `children`
 * and no `folded` member. The marker is not interactive, is never relabelled,
 * and is hidden on a folded column by the cascade (kanban-table.scss L79-L81),
 * so each of those would add a capability the application does not have — a
 * feature change, which rule T10 forbids outright.
 *
 * `readonly` because board state lives in a structurally shared, frozen tree;
 * a write through props would be a mistake worth catching at compile time.
 */
interface WipLimitMarkerProps {
    /**
     * Which of the three thresholds the column has crossed. Obtain it from
     * {@link resolveWipLimitState} and render this component only when that
     * function returned a state — passing one it did not resolve would show a
     * marker the application would not have shown.
     */
    readonly state: WipLimitState;
}

/**
 * Renders the WIP-limit rule and its centred "WIP Limit" chip.
 *
 * The emitted markup is byte-equivalent to the string the incumbent directive
 * injected at app/coffee/modules/kanban/main.coffee L1093:
 *
 *     <div class="kanban-wip-limit one-left|reached|exceeded">
 *         <span>WIP Limit</span>
 *     </div>
 *
 * Every detail of that is a contract with the unedited stylesheet, and each is
 * held to deliberately:
 *
 *  - `kanban-wip-limit` comes FIRST, the state class second, matching the source
 *    string's order (rule T1 — preserve every CSS class name).
 *  - Exactly ONE child, a bare `<span>`. kanban-table.scss L270-L281 selects it
 *    as a plain descendant `span` with no class of its own, so an extra wrapper
 *    or a class on the span would leave the chip unstyled.
 *  - The text is the literal "WIP Limit", capital "L". No translation hook is
 *    called; see Drift Register entry D5 in this file's header.
 *  - No icon, no title attribute and no ARIA attribute, because the source
 *    emitted none. Adding any would be a feature change (rule T10). The marker
 *    is decorative reinforcement of the numeric counter that the column already
 *    renders beside it, so the information is not carried by this element alone.
 *  - `className` is correct here, unlike on the `tg-svg` and `tg-card` elements
 *    declared in app/react/jsx-intrinsic-elements.d.ts: `div` and `span` are
 *    stock elements, for which react-dom does translate `className` into the
 *    `class` attribute.
 *
 * A pure function of its single prop, with no hook of any kind, no state and no
 * effect — which is what lets it be asserted without a browser (rule I9).
 * Rendered into light DOM like every other component in this migration; a shadow
 * root would sever the global stylesheet cascade and is never created (rule I6).
 *
 * @example
 * const state = resolveWipLimitState(cards.length, status.wip_limit, status.is_archived);
 * // Place it after card index `resolveWipLimitIndex(cards.length, limit, state)`.
 * {state !== undefined && <WipLimitMarker state={state} />}
 */
export function WipLimitMarker({ state }: WipLimitMarkerProps): ReactElement {
    return (
        <div className={`kanban-wip-limit ${state}`}>
            <span>WIP Limit</span>
        </div>
    );
}

// `isolatedModules: true` requires type-only exports to be declared as such.
export type { WipLimitState, WipLimitMarkerProps };
