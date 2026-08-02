/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useWipLimit — decides WHETHER one Kanban status column draws the
 * work-in-progress rule and, if so, WHICH card the rule sits after.
 *
 * ===========================================================================
 * 1. WHAT THIS REPLACES (transformation rule T9)
 * ===========================================================================
 * The incumbent is `KanbanWipLimitDirective`, declared at
 * app/coffee/modules/kanban/main.coffee L815-L851 before the migration and
 * retained verbatim in that same file at L1069-L1105, under the retirement note
 * at L1032, as the authoritative behavioural reference. It was attached to EVERY
 * status column of the board — `tg-kanban-wip-limit="s"` on
 * `div.kanban-uses-box.taskboard-column` at
 * app/partials/includes/modules/kanban-table.jade L118 in swimlane mode and
 * L194 in flat mode — so one instance of this hook corresponds to one instance
 * of that directive: one column, in one swimlane.
 *
 * The directive did four things, and this hook does exactly those four:
 *
 *   a. it subscribed to four broadcast events, and only when the status was
 *      present and not archived (main.coffee L842-L846);
 *   b. on each of them it deferred a tick with `$timeout(…, 0, false)`
 *      (L819-L840) and counted the cards the column had actually committed to
 *      the DOM (L821);
 *   c. it ran a three-branch ladder over that count to pick a class and an
 *      anchor card (L826-L834), keeping nothing when no branch matched or when
 *      the anchor addressed no element (L838);
 *   d. it deleted whatever marker it had injected before and injected a fresh
 *      one after the anchor (L836, L839).
 *
 * ===========================================================================
 * 2. THE DIVISION OF LABOUR — three files, one behaviour
 * ===========================================================================
 * The directive fused measurement, arithmetic and markup into one function.
 * The port splits them so that each part is assertable on its own without a
 * browser (requirement I9), and this hook owns only the first:
 *
 *   - THIS FILE measures the column and schedules the measurement. It is the
 *     only one of the three that touches the DOM, a timer or an event.
 *   - app/react/kanban/WipLimitMarker.tsx owns the arithmetic and the markup.
 *     `resolveWipLimitState` and `resolveWipLimitIndex` are imported from there
 *     and called; the ladder is deliberately NOT rewritten here, because two
 *     copies of it are two things to keep in step. The marker component owns
 *     the class names and the literal, untranslated "WIP Limit" label
 *     (Drift Register entry D5).
 *   - `StatusColumn` renders `<WipLimitMarker state={placement.state} />`
 *     immediately after the card at `placement.index`. This hook identifies the
 *     anchor by INDEX, never by mutating or measuring the visual position of a
 *     card, so the column keeps sole ownership of its own child order.
 *
 * ===========================================================================
 * 3. THE COUNT IS A DOM MEASUREMENT, AND IT IS BY ELEMENT NAME
 * ===========================================================================
 * `$el.find("tg-card")` (main.coffee L821) counts by ELEMENT NAME, across all
 * descendants of the column. Three properties follow from that, and all three
 * are preserved here by using `column.querySelectorAll('tg-card')`:
 *
 *   - It counts RENDERED CARDS, not model entries. A card the board has not
 *     committed yet is not counted; the deferral in section 6 exists precisely
 *     so the measurement happens after the commit.
 *   - It is INDIFFERENT TO VIRTUALISATION (risk R-DND-3). Card virtualisation
 *     hides the card's INNER content — `vm.inViewPort` gates `.card-inner`, see
 *     app/react/shared/useInViewport.ts — while the outer `tg-card` element is
 *     always rendered. So the count never varied with scroll position, and it
 *     must not start doing so now: nothing here filters on visibility,
 *     `offsetParent`, computed display, observer state or a viewport latch.
 *   - It is INDIFFERENT TO SELECTION AND STATE CLASSES. The query is on the tag
 *     name, so `.card`, `.card-inner`, `.kanban-task-selected`,
 *     `.ui-multisortable-multiple` and the drag mirror classes are all
 *     irrelevant to it. Counting `.card` instead would agree today and diverge
 *     the moment any other element in the column carried that class.
 *
 * The element name survives into the React markup for an unrelated but
 * reinforcing reason: `app/styles/modules/kanban/kanban-table.scss` selects on
 * `tg-card` at L65 and L76, so app/react/kanban/KanbanCard.tsx has to emit the
 * tag anyway (rule T1). See app/react/jsx-intrinsic-elements.d.ts.
 *
 * ===========================================================================
 * 4. THE THREE ANCHORS, AND WHY A MATCHED BRANCH CAN STILL DRAW NOTHING
 * ===========================================================================
 * From main.coffee L826-L834, reproduced by the two imported helpers rather
 * than by code in this file:
 *
 *   cardCount + 1 === wip_limit  ->  'one-left'   after cards[cardCount - 1]
 *   cardCount     === wip_limit  ->  'reached'    after cards[cardCount - 1]
 *   cardCount      >  wip_limit  ->  'exceeded'   after cards[wip_limit - 1]
 *
 * ⚠ `exceeded` USES A DIFFERENT INDEX. It attaches after the last PERMITTED
 * card, not the last card, so the surplus cards fall below the rule. Five cards
 * against a limit of three anchor at index 2, not index 4.
 *
 * The directive's final guard is `if element` (L838), NOT `if wipLimitClass`, so
 * a branch could match and still inject nothing whenever the computed index
 * addressed no card. That guard is reproduced here as an element lookup, and it
 * is load-bearing rather than defensive — it is what makes every awkward input
 * resolve without inventing a rule:
 *
 *   wip_limit null,   any count  ->  no marker.
 *   wip_limit 0,      count 0    ->  'reached' matched, index -1, no element.
 *   wip_limit 0,      count >= 1 ->  'exceeded' matched, index -1, no element.
 *   wip_limit 1,      count 0    ->  'one-left' matched, index -1, no element.
 *
 * So a zero limit draws no marker at any card count. That is the TRUTHINESS
 * semantics of the incumbent — `status.wip_limit` of 0 behaved as "no limit
 * configured" throughout the board, and the counter beside the marker renders a
 * bare count for it too — and it is preserved exactly. Zero is never rewritten
 * to null, never promoted to 1, and never treated as an unlimited sentinel. The
 * negative index is never clamped, normalised or substituted either: it is the
 * mechanism, not a bug to be tidied.
 *
 * ===========================================================================
 * 5. REMOVE-FIRST-THEN-INSERT BECOMES ONE DECLARATIVE PLACEMENT (rule T9)
 * ===========================================================================
 * main.coffee L836 is `$el.find(".kanban-wip-limit").remove()`, executed
 * unconditionally before the optional insertion at L839. Imperatively it had to
 * be: re-running an injection without it would accumulate one marker per
 * redraw.
 *
 * The React translation keeps the NET INVARIANT of those two lines — at most one
 * current marker in a column, and never a stale one after a recompute — and
 * drops the mechanism. The invariant is expressed as a single state value: one
 * `WipLimitPlacement | null` per column, replaced or cleared atomically on every
 * recompute, with React reconciliation performing the removal and the insertion.
 * No DOM node is ever deleted from here. Deleting a React-rendered marker
 * imperatively would corrupt React's view of its own tree, which is why the
 * removal step has no counterpart and none is written.
 *
 * The replacement is also IDEMPOTENT: a recompute that resolves the same state
 * and the same index returns the previous value, so the placement keeps its
 * reference identity and no render is provoked. That matters for two reasons —
 * it lets `StatusColumn` memoise on the placement, and it makes a redraw that
 * changes nothing genuinely free, which is the common case for the four events
 * below.
 *
 * ===========================================================================
 * 6. THE FOUR EVENTS AND THE TWO DELAYS
 * ===========================================================================
 * Exactly four events, taken verbatim from main.coffee L843-L846 and listed once
 * in {@link WIP_LIMIT_REDRAW_EVENTS}: `redraw:wip`, `kanban:us:move`,
 * `usform:new:success` and `usform:bulk:success`. No fifth event is invented —
 * there is deliberately no edit, delete, realtime, resize or mutation trigger,
 * because the directive had none. `usform:edit:success` and `kanban:us:deleted`
 * exist on the controller (main.coffee L290 and L305 in the retained file) and
 * were pointedly NOT subscribed to; adding them would be a behaviour change
 * (rule T10).
 *
 * Two distinct delays, and they must not collapse into one:
 *
 *   - 0 ms, per event. Every handler defers the measurement by a tick, which is
 *     `$timeout(…, 0, false)` at L819-L840. The trailing `false` is
 *     `invokeApply: false` — do not run a digest — and a native
 *     `window.setTimeout` reproduces both halves of that: the tick, and the
 *     absence of any digest. React state updates never enter an AngularJS
 *     digest, so nothing here calls `$apply`, `$applyAsync`, `$digest` or
 *     `$timeout`.
 *   - 100 ms, after a swimlane is folded or unfolded. `toggleSwimlane`
 *     (main.coffee L328-L334, retained at L424-L429) waits 100 ms with the same
 *     `invokeApply: false` and THEN broadcasts `redraw:wip`, giving the
 *     swimlane's own `0.5s linear` `max-height` transition
 *     (app/styles/modules/kanban/kanban-table.scss L549-L575) time to start
 *     moving the cards this column is about to measure.
 *     {@link UseWipLimitResult.scheduleAfterSwimlaneToggle} recomputes after
 *     exactly that 100 ms.
 *
 *     Why the 100 ms path does NOT also carry the zero-delay leg, even though
 *     the incumbent broadcast landed on it: the trailing tick existed solely so
 *     the measurement observed a DOM that AngularJS had already committed, and
 *     100 ms of elapsed time gives that guarantee many times over. Keeping a
 *     second, nested timer would add a macrotask that changes no outcome while
 *     making "recompute 100 ms after the toggle" untrue by one tick — measurably
 *     so under fake timers, where a timer created inside a timer callback is not
 *     serviced by the advance that created it. The two DELAYS nevertheless stay
 *     strictly separate, which is what must not collapse: the four events keep
 *     {@link RECOMPUTE_DELAY_MS}, the swimlane toggle keeps
 *     {@link SWIMLANE_TOGGLE_REDRAW_DELAY_MS}, and neither value is ever used
 *     for the other path. A container that genuinely wants the event semantics
 *     after a toggle can call {@link UseWipLimitResult.scheduleRecompute}
 *     instead.
 *
 * Each event occurrence schedules its OWN timer. They are not debounced,
 * coalesced or replaced, because the directive queued one `$timeout` per
 * broadcast, and a move followed closely by a form success must produce two
 * measurements rather than one. Idempotence (section 5) is what keeps that
 * cheap, not throttling.
 *
 * The initial placement is scheduled once when the column becomes eligible,
 * through the same zero-delay path. It corresponds to the incumbent's
 * post-render broadcast: the render batch completes and broadcasts `redraw:wip`
 * at main.coffee L396-L397 (retained at L491-L493), which is how a freshly drawn
 * board acquired its markers. It is a one-shot, not observation — there is no
 * `MutationObserver`, no `ResizeObserver` and no polling anywhere in this file.
 *
 * ===========================================================================
 * 7. THE ANGULARJS SEAM (rule T9)
 * ===========================================================================
 * This hook resolves no AngularJS anything. It never touches `$scope`,
 * `$rootScope`, `$injector` or the bridge's `useAngularService`. Event
 * registration arrives as a plain injected function —
 * {@link WipLimitEventRegistrar}, `(eventName, handler) => deregister` — supplied
 * by the board or the bridge, and every deregistration it returns is called on
 * cleanup. That keeps the hook a pure function of its options, testable with a
 * two-line stub, and confines the framework seam to the container.
 *
 * The registrar's contract mirrors `$scope.$on`, which returns its own
 * deregistration function; see the `AngularLifecycleScope` declaration in
 * app/react/bridge/useAngularService.ts. Payload arguments are ignored on
 * purpose: `kanban:us:move` carries six of them —
 * `finalUsList, newStatus, newSwimlane, index, previousCard, nextCard`, broadcast
 * from app/coffee/modules/kanban/sortable.coffee L150 before the migration and
 * retained at L341, and re-emitted with the same six arguments by
 * app/react/kanban/hooks/useCardDrag.ts — and the directive read none of them.
 * It only ever re-measured the DOM, and so does this.
 *
 * ===========================================================================
 * 8. WHAT THIS HOOK DELIBERATELY DOES NOT DO
 * ===========================================================================
 *   - It NEVER PERSISTS ANYTHING. It reads `status.wip_limit` and writes
 *     nothing. Editing a limit is an administration action reached from the
 *     column header, and it is not this hook's concern: there is no
 *     `editStatus` callback, no API facade import, no request of any kind.
 *   - It authors NO STYLING. All three appearances are already declared in the
 *     unedited `app/styles/modules/kanban/kanban-table.scss` L264-L299, and a
 *     folded column hides the marker through `.vfold .kanban-wip-limit` at
 *     L79-L81 — which is why there is no `folded` option and no conditional for
 *     it (rules T1, G-DS-3, G-DS-4).
 *   - It emits NO COPY and NO COLOUR. The label belongs to the marker component
 *     and is an untranslated literal by fidelity (Drift Register entry D5);
 *     status colour stays data-bound to `status.color` at its own render site
 *     (rule T2).
 *   - It renders NOTHING. No JSX, no `createElement`, no HTML string, no
 *     `innerHTML`, no `dangerouslySetInnerHTML`, no shadow root.
 *
 * ===========================================================================
 * 9. FIDELITY EVIDENCE (Figma node 1:7, file B0XlGp5ZYFOfeARVceUVRE)
 * ===========================================================================
 * The linked frame is a flattened screenshot of the live AngularJS board, and
 * the committed raster `design-reference/kanban-screen.png` at the parent
 * repository root is its byte-verified equivalent. It contains two live markers,
 * both in the NEW column, and both corroborate this hook's output rather than
 * the marker's appearance alone: swimlane "autem quas" reads "2 / 3" on its
 * counter and draws `one-left`, swimlane "hic ut" reads "2 / 2" and draws
 * `reached`. In each case the rule is the LAST element in the column cell,
 * directly below the final card — exactly what an anchor index of `cardCount - 1`
 * produces. Columns reading "1 / 4" and "0 / 2" draw no rule at all, matching
 * the ladder's silence outside its three branches. `exceeded` appears nowhere in
 * the frame; per Drift Register entry D4 a state absent from the frame is built
 * from the source markup, never inferred from the image.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveWipLimitIndex, resolveWipLimitState } from '../WipLimitMarker';
import type { WipLimitState } from '../WipLimitMarker';
import type { Status } from '../../shared/types/status';

/* ==========================================================================
 * Constants
 *
 * Immutable primitives and one frozen-by-type tuple. Nothing in this module is
 * mutable at module scope: every piece of per-column bookkeeping lives inside
 * the hook, in a ref, so two columns on one board never share state.
 * ========================================================================== */

/**
 * The element name the column is measured by.
 *
 * Named rather than inlined so that the ONE selector this file uses is
 * impossible to mistake for a class selector. It is `$el.find("tg-card")` from
 * app/coffee/modules/kanban/main.coffee L821 (retained L1075): a tag name, not
 * `.card`, not `.card-inner`, and not a state class. See header section 3.
 */
const TG_CARD_ELEMENT_NAME = 'tg-card';

/**
 * Delay applied to every event-driven recompute, in milliseconds.
 *
 * Zero, matching `$timeout(…, 0, false)` at main.coffee L819-L840 (retained
 * L1073-L1094). The delay is not arbitrary: the measurement must observe the
 * committed DOM, so it is deferred by exactly one tick and no more.
 */
const RECOMPUTE_DELAY_MS = 0;

/**
 * Delay applied after a swimlane is folded or unfolded, in milliseconds.
 *
 * One hundred, matching `toggleSwimlane` at main.coffee L328-L334 (retained
 * L424-L429), which waits that long before broadcasting `redraw:wip`. Measured
 * from the toggle, and never interchangeable with {@link RECOMPUTE_DELAY_MS}:
 * the two paths keep their own delays, which is the "no 0/100 collapse" the
 * migration requires. See header section 6.
 */
const SWIMLANE_TOGGLE_REDRAW_DELAY_MS = 100;

/**
 * The four events that redraw the marker, in the order the directive subscribed
 * to them at app/coffee/modules/kanban/main.coffee L843-L846 (retained
 * L1097-L1100).
 *
 * Exported because it is a contract, not an implementation detail: the container
 * that supplies {@link WipLimitEventRegistrar} and the spec that asserts the
 * subscription set both need the same four literals, and a second copy of them
 * is a second thing to get wrong. There are exactly four, and no fifth is
 * inferred — see header section 6 for the two controller events that were
 * deliberately not subscribed to.
 */
export const WIP_LIMIT_REDRAW_EVENTS = [
    'redraw:wip',
    'kanban:us:move',
    'usform:new:success',
    'usform:bulk:success',
] as const;

/* ==========================================================================
 * Public types
 * ========================================================================== */

/**
 * One of the four event names in {@link WIP_LIMIT_REDRAW_EVENTS}.
 *
 * Derived from the tuple rather than written out again, so the union and the
 * runtime list cannot drift apart. Typing the registrar against this union
 * instead of `string` means a mistyped event name — `redraw:whip`, `us:move` —
 * is a compile error rather than a listener that never fires.
 */
export type WipLimitEventName = (typeof WIP_LIMIT_REDRAW_EVENTS)[number];

/**
 * What the hook hands the registrar as a listener.
 *
 * It takes NO arguments, which is a deliberate narrowing of the AngularJS
 * contract rather than an oversight. `$scope.$on` supplies an event object and
 * whatever payload the broadcaster sent — six arguments in the case of
 * `kanban:us:move` — and the directive read none of them, because the redraw is
 * a re-measurement of the DOM and not a function of the payload (header
 * section 7). A registrar whose listeners are declared with parameters still
 * satisfies this type: a function that ignores arguments is assignable where one
 * that accepts them is expected.
 */
export type WipLimitEventHandler = () => void;

/**
 * The teardown function a registration hands back.
 *
 * `$scope.$on` returns exactly this, and the hook calls every one it holds when
 * the status changes or the column unmounts. Registering without deregistering
 * is the one silent leak available here: nothing fails, the marker simply
 * redraws twice for every event after a remount.
 */
export type WipLimitEventDeregistrar = () => void;

/**
 * Registers a listener for one of the four redraw events and returns its
 * deregistration function.
 *
 * This is the whole of the AngularJS seam, injected by the container so that the
 * hook itself resolves no injector, no `$scope` and no service (header
 * section 7). The natural implementation forwards to the board's event bus and
 * returns what `$scope.$on` returned; a spec can satisfy it with a stub that
 * records the handler.
 *
 * It SHOULD be referentially stable — wrap it in `useCallback` in the container
 * — because the hook re-registers whenever its identity changes. An unstable
 * one is nonetheless safe rather than merely wasteful: recomputes replace the
 * placement idempotently (header section 5), so a re-registration on every
 * render cannot provoke a render loop.
 */
export type WipLimitEventRegistrar = (
    eventName: WipLimitEventName,
    handler: WipLimitEventHandler,
) => WipLimitEventDeregistrar;

/**
 * The column element, as a ref.
 *
 * Structural on purpose, and minimal on purpose: `useRef<HTMLElement | null>(null)`,
 * `useRef<HTMLDivElement>(null)` and any other React ref object all satisfy it,
 * so the container attaches its own ref to the `.taskboard-column` root and
 * passes it straight in. `current` is read at measurement time — never at render
 * time — which is what keeps the read legal.
 *
 * `null` is expected and handled: it is the state of the ref before the first
 * commit, and it resolves to no marker rather than to an error.
 */
export interface WipLimitColumnRef {
    /** The `.taskboard-column` element, or `null` before it is attached. */
    readonly current: HTMLElement | null;
}

/**
 * Where the marker goes, when there is one.
 *
 * The pair is inseparable, which is why it is one value rather than two pieces
 * of state: the incumbent computed a class and an anchor together in one pass
 * (main.coffee L826-L834), and a state without its index cannot be rendered in
 * the right place. Absence of a marker is `null`, never a `WipLimitPlacement`
 * with a sentinel index.
 */
export interface WipLimitPlacement {
    /**
     * Which threshold the column has crossed. Pass it straight to
     * `WipLimitMarker`, which turns it into the second CSS class the unedited
     * stylesheet selects on.
     */
    readonly state: WipLimitState;

    /**
     * Zero-based index of the card the marker is rendered immediately AFTER —
     * exactly what `resolveWipLimitIndex` returns.
     *
     * Always addresses a card that existed at measurement time, because a
     * placement whose index addressed no card is discarded before it is
     * returned (header section 4). It is therefore never negative here, even
     * though the underlying arithmetic can be.
     *
     * ⚠ `'exceeded'` anchors at `wip_limit - 1` while the other two states
     * anchor at `cardCount - 1`, so do NOT assume the marker is the column's
     * last child.
     */
    readonly index: number;
}

/**
 * Everything one column has to supply.
 *
 * Three members, which is the whole of what the directive had: an element to
 * measure (`$el`), the status it was evaluated against (`$attrs.tgKanbanWipLimit`,
 * main.coffee L817) and a way to hear about redraws (`$scope.$on`).
 *
 * There is deliberately NO `cardCount` option, and that is the substantive
 * decision in this interface. A count passed down as a prop would be the count
 * of the MODEL, whereas the directive counted the DOM — and the two differ
 * during the board's batched render, which is precisely the window the redraw
 * events fire in. Measuring keeps the incumbent's timing (header section 3).
 *
 * There is also no `onEditStatus`, no resource, no project and no zoom level.
 * The hook reads one field of one status and persists nothing (header
 * section 8).
 */
export interface UseWipLimitOptions {
    /**
     * Ref to the `.taskboard-column` root — `div.kanban-uses-box.taskboard-column`
     * from app/partials/includes/modules/kanban-table.jade L112 (swimlane mode)
     * and L189 (flat mode), which is the element the directive was attached to
     * and therefore the exact subtree it measured.
     */
    readonly columnRef: WipLimitColumnRef;

    /**
     * The status this column renders, or `null`/`undefined` while the board has
     * not resolved one yet.
     *
     * `wip_limit` and `is_archived` are the only fields read. A missing status
     * and the archived status are both inert: no listener is registered, pending
     * timers are cancelled and any existing placement is cleared, reproducing the
     * gate at main.coffee L842 (retained L1096).
     */
    readonly status: Status | null | undefined;

    /**
     * The AngularJS seam. See {@link WipLimitEventRegistrar}.
     */
    readonly registerEvent: WipLimitEventRegistrar;
}

/**
 * What one column gets back.
 *
 * Deliberately three members. The object identity is stable while its contents
 * are unchanged, and both callbacks keep their identity across renders for as
 * long as the status and the registrar do, so they can be listed in a dependency
 * array or passed to a memoised child without provoking a re-render.
 *
 * There is no synchronous `recompute`, because the incumbent had none: every
 * redraw went through a deferral (header section 6), and offering an immediate
 * variant would invite a measurement taken before the DOM had committed — the
 * one mistake the `$timeout` existed to prevent.
 */
export interface UseWipLimitResult {
    /**
     * The marker to render, or `null` for none.
     *
     * `null` is the common case: a column only draws a rule inside the three
     * bands of the ladder, so most columns on most boards return `null`
     * throughout. Render as
     * `placement !== null && <WipLimitMarker state={placement.state} />`, placed
     * immediately after the card at `placement.index`.
     *
     * It survives until the next recompute, exactly as the injected node did.
     * A card list that changes without any of the four events firing leaves the
     * previous marker in place, which is the incumbent's behaviour and not a
     * staleness bug to be fixed with an observer.
     */
    readonly placement: WipLimitPlacement | null;

    /**
     * Schedules a recompute on the zero-delay path — the equivalent of
     * broadcasting `redraw:wip` at this column.
     *
     * Provided for the container that changes the column's contents itself and
     * has no event to lean on. It is the same path the four events use, so it
     * carries the same one-tick deferral and the same idempotent replacement.
     */
    readonly scheduleRecompute: () => void;

    /**
     * Schedules a recompute for 100 ms after a swimlane fold or unfold.
     *
     * Call it from the handler that toggles a swimlane. It reproduces
     * `toggleSwimlane` at main.coffee L328-L334 (retained L424-L429): that method
     * persisted the fold state and waited 100 ms before broadcasting
     * `redraw:wip`, giving the swimlane's own animation — `0.5s linear` on
     * `max-height`, app/styles/modules/kanban/kanban-table.scss L549-L575 — time
     * to move the cards this column is about to measure.
     *
     * The delay is 100 ms and nothing else. It is deliberately NOT the
     * zero-delay path with a longer number, and the zero-delay path is
     * deliberately not 100 ms; see header section 6 for why the incumbent's
     * trailing tick has no counterpart on this route and for what "no 0/100
     * collapse" means here.
     */
    readonly scheduleAfterSwimlaneToggle: () => void;
}

/* ==========================================================================
 * Private pure helpers
 *
 * Module-private on purpose: the hook is the API. Each one is exercised through
 * it, and none holds state.
 * ========================================================================== */

/**
 * The subscription gate from app/coffee/modules/kanban/main.coffee L842 (retained
 * L1096): `if status and not status.is_archived`.
 *
 * A type predicate, so a successful gate also narrows `Status | null | undefined`
 * to `Status` for the caller and no non-null assertion is needed anywhere below.
 *
 * The archived check appears twice in this port, in two different roles, exactly
 * as it does in the source. Here it decides whether to LISTEN at all; inside
 * `resolveWipLimitState` it decides whether a listening column would resolve a
 * state. Collapsing them would lose the first, which is what keeps the archived
 * column free of subscriptions and timers altogether.
 */
function isWipLimitEligible(status: Status | null | undefined): status is Status {
    return status !== null && status !== undefined && !status.is_archived;
}

/**
 * Measures one column and resolves its placement, or `null` for no marker.
 *
 * The whole of the directive's deferred body (main.coffee L819-L839, retained
 * L1073-L1093) minus the two DOM mutations, in the source's order: count, resolve
 * the state, resolve the index, then require an anchor element.
 *
 * Pure with respect to React — it reads the DOM and returns a value, touching no
 * state and no timer — which is what lets the hook apply the result idempotently.
 *
 * @param column The `.taskboard-column` element, or `null` before it is attached.
 * @param status The status this column renders, if the board has one.
 * @returns The placement to render, or `null` when this column draws no marker.
 */
function resolveColumnPlacement(
    column: HTMLElement | null,
    status: Status | null | undefined,
): WipLimitPlacement | null {
    // The gate, first and before any measurement: a missing or archived status
    // draws nothing whatever the card count is.
    if (!isWipLimitEligible(status)) {
        return null;
    }

    // Nothing to measure before the ref is attached. The incumbent could not
    // reach this state — a directive always had its element — so this is a React
    // lifecycle addition, and `null` is the only answer consistent with the
    // guard at main.coffee L838: with no column there is no anchor card either.
    if (column === null) {
        return null;
    }

    // TECHNOLOGY-SPECIFIC CHANGE (rule T9): `$el.find("tg-card")` at main.coffee
    // L821 becomes `querySelectorAll` scoped to the column. Same semantics —
    // descendants only, matched BY ELEMENT NAME — and the same three properties
    // documented in header section 3: it counts rendered cards, it is unaffected
    // by virtualisation (R-DND-3), and it is unaffected by every class the cards
    // carry. Nothing filters this list; a hidden or virtualised `tg-card` counts.
    const cards: NodeListOf<Element> = column.querySelectorAll(TG_CARD_ELEMENT_NAME);
    const cardCount = cards.length;

    // A status with no configured limit draws nothing. Returned here so that the
    // limit is a plain `number` from this point on, which is what
    // `resolveWipLimitIndex` requires. The outcome is identical to the null
    // short-circuit `resolveWipLimitState` performs itself (WipLimitMarker.tsx
    // L264-L266), so this narrowing changes no behaviour.
    const wipLimit = status.wip_limit;

    if (wipLimit === null) {
        return null;
    }

    // HELPER REUSE (rule T9): the three-branch ladder lives in
    // app/react/kanban/WipLimitMarker.tsx and is CALLED, never re-implemented.
    // Two copies of `cardCount + 1 === wipLimit` would be two copies to keep in
    // step, and the `exceeded` index is the one that silently diverges.
    const state = resolveWipLimitState(cardCount, wipLimit, status.is_archived);

    if (state === undefined) {
        return null;
    }

    // 'one-left' and 'reached' -> cardCount - 1 (the last card);
    // 'exceeded'               -> wipLimit - 1 (the last PERMITTED card).
    const index = resolveWipLimitIndex(cardCount, wipLimit, state);

    // THE `if element` GUARD (main.coffee L838, retained L1092), reproduced as an
    // element lookup rather than as arithmetic. A matched branch whose index
    // addresses no card injected nothing, and that is what makes a zero limit and
    // an empty column silent at every count (header section 4). The index is
    // never clamped or substituted to force a marker into existence.
    //
    // `NodeListOf<T>.item()` is declared in lib.dom.d.ts as returning `T`, but the
    // DOM specification returns null for an out-of-range index — including the
    // negative index that `exceeded` against a zero limit produces. The
    // annotation restores the nullability the runtime genuinely has; nothing is
    // cast away and no assertion is used.
    const anchorCard: Element | null = cards.item(index);

    if (anchorCard === null) {
        return null;
    }

    return { state, index };
}

/**
 * Whether two placements describe the same marker in the same position.
 *
 * Used to make the replacement in header section 5 idempotent: a recompute that
 * resolves what is already rendered keeps the previous object, so the placement
 * holds its reference identity and provokes no render. Both `null` counts as
 * equal, which is the far commonest case — most columns have no marker and every
 * redraw event confirms it.
 */
function isSamePlacement(
    previous: WipLimitPlacement | null,
    next: WipLimitPlacement | null,
): boolean {
    if (previous === null || next === null) {
        return previous === next;
    }

    return previous.state === next.state && previous.index === next.index;
}

/* ==========================================================================
 * The hook
 * ========================================================================== */

/**
 * WIP-limit placement for ONE Kanban status column.
 *
 * Mount it inside the component that renders the column, one instance per
 * column per swimlane, which is how `tg-kanban-wip-limit` was attached
 * (app/partials/includes/modules/kanban-table.jade L118 and L194). Every timer
 * and every subscription it creates belongs to that instance and is released
 * when the status changes or the column unmounts.
 *
 * @param options The column element, its status and the event seam. See
 *                {@link UseWipLimitOptions}.
 * @returns The placement to render plus the two schedulers. See
 *          {@link UseWipLimitResult}.
 *
 * @example
 * const columnRef = useRef<HTMLDivElement>(null);
 * const { placement, scheduleAfterSwimlaneToggle } = useWipLimit({
 *     columnRef,
 *     status,
 *     registerEvent,
 * });
 *
 * return (
 *     <div ref={columnRef} className="kanban-uses-box taskboard-column">
 *         {cards.map((card, cardIndex) => (
 *             <Fragment key={card.id}>
 *                 <KanbanCard userStory={card} />
 *                 {placement !== null && placement.index === cardIndex && (
 *                     <WipLimitMarker state={placement.state} />
 *                 )}
 *             </Fragment>
 *         ))}
 *     </div>
 * );
 */
export function useWipLimit(options: UseWipLimitOptions): UseWipLimitResult {
    const { columnRef, status, registerEvent } = options;

    /**
     * The single piece of state, and the declarative stand-in for the injected
     * node: one placement, or none.
     *
     * Replacing it replaces the marker and clearing it removes the marker, which
     * together carry the whole of `remove()`-then-`after()` (header section 5).
     */
    const [placement, setPlacement] = useState<WipLimitPlacement | null>(null);

    /**
     * Every timer this column has outstanding, keyed by the id
     * `window.setTimeout` returns.
     *
     * A SET rather than a single slot, because the incumbent queued one
     * `$timeout` per broadcast and never cancelled an earlier one. A slot would
     * silently coalesce a move and a form success into a single measurement,
     * which is the close succession the migration is explicitly required not to
     * lose (header section 6).
     *
     * Bookkeeping, so a ref and never state: adding a timer must not render.
     */
    const pendingTimersRef = useRef<Set<number>>(new Set());

    /**
     * `true` once this instance has been torn down.
     *
     * Guards every scheduled callback, so nothing measures or sets state after
     * unmount. Reset on mount as well as set on unmount, because React 18's
     * StrictMode deliberately mounts, unmounts and remounts a component in
     * development, and an instance that came back has not been disposed of.
     */
    const disposedRef = useRef<boolean>(false);

    /**
     * Cancels and forgets every outstanding timer.
     *
     * TECHNOLOGY-SPECIFIC CHANGE (rule T9): the incumbent teardown is
     * `$scope.$on "$destroy", -> $el.off()` at main.coffee L848-L849 (retained
     * L1102-L1103), which released the directive's handlers and left AngularJS to
     * discard the `$timeout`s with the scope. React has no scope to piggyback on,
     * so the timers are tracked explicitly and cleared here, and the listeners are
     * released through the deregistration functions the registrar returned.
     */
    const clearPendingTimers = useCallback((): void => {
        for (const timerId of pendingTimersRef.current) {
            window.clearTimeout(timerId);
        }

        pendingTimersRef.current.clear();
    }, []);

    /**
     * Measures the column now and applies the result idempotently.
     *
     * Identity changes only with `status`, so the effect below re-subscribes
     * exactly when the gate or the limit could have changed, and not on every
     * render.
     */
    const recompute = useCallback((): void => {
        const next = resolveColumnPlacement(columnRef.current, status);

        // Replace, or keep the previous object when nothing moved. Reference
        // stability is what makes a no-op redraw free (header section 5).
        setPlacement((previous) => (isSamePlacement(previous, next) ? previous : next));
    }, [columnRef, status]);

    /**
     * Defers `task` by `delayMs` and remembers the timer so it can be cancelled.
     *
     * TECHNOLOGY-SPECIFIC CHANGE (rule T9): this is `$timeout(task, delayMs, false)`.
     * The trailing `false` — `invokeApply: false`, "do not run a digest" — needs no
     * counterpart, because a native timer runs outside AngularJS entirely and
     * React state updates never enter a digest. Nothing in this file calls
     * `$apply`, `$applyAsync`, `$digest` or `$timeout`.
     *
     * `window.setTimeout` is used rather than the bare global so the id is typed
     * as the browser's `number` and not as Node's `Timeout` object — the same
     * convention as app/react/kanban/TaskCounter.tsx.
     */
    const schedule = useCallback((delayMs: number, task: () => void): void => {
        const timerId: number = window.setTimeout(() => {
            pendingTimersRef.current.delete(timerId);

            // Disposed between scheduling and firing: do nothing at all.
            if (disposedRef.current) {
                return;
            }

            task();
        }, delayMs);

        pendingTimersRef.current.add(timerId);
    }, []);

    /**
     * The zero-delay path every one of the four events takes, and the one the
     * container can trigger itself.
     */
    const scheduleRecompute = useCallback((): void => {
        schedule(RECOMPUTE_DELAY_MS, recompute);
    }, [schedule, recompute]);

    /**
     * The 100 ms path.
     *
     * TECHNOLOGY-SPECIFIC CHANGE (rule T9): `toggleSwimlane` waited 100 ms and
     * then BROADCAST `redraw:wip` (main.coffee L328-L334, retained L424-L429),
     * and that broadcast landed on the directive's own zero-delay deferral. The
     * 100 ms is reproduced exactly; the trailing tick is not, because it existed
     * only to let AngularJS commit the DOM and 100 ms already guarantees that
     * (header section 6). The two delay CONSTANTS remain strictly separate —
     * `SWIMLANE_TOGGLE_REDRAW_DELAY_MS` is never used for an event and
     * `RECOMPUTE_DELAY_MS` is never used for a toggle.
     */
    const scheduleAfterSwimlaneToggle = useCallback((): void => {
        schedule(SWIMLANE_TOGGLE_REDRAW_DELAY_MS, recompute);
    }, [schedule, recompute]);

    /**
     * Lifecycle bracket for the disposal flag.
     *
     * Separate from the subscription effect below precisely because that one
     * re-runs whenever the status changes, and a re-run must not be mistaken for
     * a teardown. This one runs once per mount: `clearPendingTimers` is stable.
     */
    useEffect(() => {
        disposedRef.current = false;

        return () => {
            disposedRef.current = true;
            clearPendingTimers();
        };
    }, [clearPendingTimers]);

    /**
     * The gate, the four subscriptions and the initial measurement.
     *
     * Reproduces main.coffee L842-L846 (retained L1096-L1100) together with the
     * teardown at L848-L849 (retained L1102-L1103).
     */
    useEffect(() => {
        // THE GATE (main.coffee L842): a missing or archived status subscribes to
        // nothing. It also cancels anything already in flight and clears the
        // marker, so a column whose status is replaced by the archived one does
        // not keep a rule it is no longer entitled to draw.
        if (!isWipLimitEligible(status)) {
            clearPendingTimers();
            setPlacement((previous) => (previous === null ? previous : null));

            return undefined;
        }

        // The initial measurement, once. It stands in for the incumbent's
        // post-render broadcast — the render batch finished and broadcast
        // `redraw:wip` at main.coffee L396-L397 (retained L491-L493) — and it goes
        // through the ordinary zero-delay path, so a freshly mounted column
        // acquires its marker exactly as a freshly rendered board did. One shot,
        // not observation: there is no MutationObserver and no ResizeObserver
        // anywhere in this file.
        scheduleRecompute();

        // THE EVENT SEAM (rule T9): `$scope.$on(name, redrawWipLimit)` becomes a
        // call through the injected registrar, and the deregistration function it
        // returns is kept for cleanup. Exactly the four names of
        // WIP_LIMIT_REDRAW_EVENTS, in the source's order, each bound to the same
        // zero-delay recompute. Payload arguments are ignored by contract.
        const deregistrations: readonly WipLimitEventDeregistrar[] = WIP_LIMIT_REDRAW_EVENTS.map(
            (eventName) => registerEvent(eventName, scheduleRecompute),
        );

        return () => {
            for (const deregister of deregistrations) {
                deregister();
            }

            // Cancel measurements queued against the status that is going away.
            // The effect re-runs immediately with the new status and schedules a
            // fresh one, so nothing is lost by discarding these.
            clearPendingTimers();
        };
    }, [status, registerEvent, scheduleRecompute, clearPendingTimers]);

    return useMemo(
        () => ({ placement, scheduleRecompute, scheduleAfterSwimlaneToggle }),
        [placement, scheduleRecompute, scheduleAfterSwimlaneToggle],
    );
}
