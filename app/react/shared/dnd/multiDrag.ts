/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * multiDrag — the hand-built multi-select drag machinery shared by the two
 * migrated screens: the Kanban board and the Backlog / Sprint-Planning story
 * table. It reproduces, in framework-free TypeScript, the whole of the global
 * helper the AngularJS screens reached through `window.dragMultiple`.
 *
 * Planned by the migration specification at section 0.5.1, which lists this file
 * as "multiDrag.ts — Hand-built multi-select drag replacing window.dragMultiple",
 * and at section 0.6.2, which records its source as
 * `app/js/dragula-drag-multiple.js` and its obligation as "Hand-built
 * multi-select replacing window.dragMultiple (L223), including the
 * .card-transit-multi / .fake-us ghost blocks". It is the mitigation for named
 * risk R-DND-1: the drag library adopted by the React tree, `@dnd-kit/core`,
 * has no multi-item drag of its own, so everything the retired helper did has to
 * be rebuilt rather than configured.
 *
 * ===========================================================================
 * LOCATOR SHORTHAND USED THROUGHOUT THIS FILE
 * ===========================================================================
 * `INCUMBENT:NNN` means line NNN of the behavioural source,
 * `app/js/dragula-drag-multiple.js` (224 lines). That file is a READ-ONLY
 * reference and is NEVER imported: the TypeScript configuration at
 * `taiga-front/tsconfig.json` enables no `allowJs`, so nothing under `app/js/`
 * is part of this program at all, and no ambient declaration was added for it
 * either. Every behaviour below was reimplemented from reading it.
 *
 * This module has NO import statements whatsoever — not one internal, not one
 * external. It touches the DOM and nothing else: no framework, no drag library,
 * no HTTP, no I/O, no state that outlives a single drag gesture.
 *
 * ===========================================================================
 * THE PUBLISHED CONTRACT, AND WHO CONSUMES IT
 * ===========================================================================
 * Two consumers are planned and neither exists yet, so the exported surface of
 * this file IS their contract rather than a reflection of it:
 *
 *   - `app/react/kanban/hooks/useCardDrag.ts`   — the board-side consumer,
 *     porting the `drag` and `dragend` handlers originally at
 *     `app/coffee/modules/kanban/sortable.coffee` L75-L87 and L109-L120
 *     (retained, unregistered, at :184-:196 and :242-:251 of that same file).
 *   - `app/react/backlog/hooks/useStoryDrag.ts` — the list-side consumer,
 *     porting `app/coffee/modules/backlog/sortable.coffee` L65-L81 and
 *     L94-L112 (retained at :110-:126 and :139-:158 of that same file).
 *
 * Both of those AngularJS handlers use exactly two properties of whatever the
 * helper returns — `.length` and `[0]` — which is why the return type here is a
 * plain `readonly HTMLElement[]` in document order rather than a collection
 * object. See hazard H4 below.
 *
 * ===========================================================================
 * SCOPE SPLIT — WHAT THIS FILE OWNS AND WHAT IT MUST NOT TOUCH
 * ===========================================================================
 * OWNED HERE: the multi-drag ghost and mirror machinery, and therefore the five
 * runtime class names listed in the "OWNED" table below, which this module both
 * applies and removes.
 *
 * OWNED ELSEWHERE, and only ever READ here: `ui-multisortable-multiple` (the
 * screens' own selection state), `gu-mirror` and `gu-transit` (applied by
 * `app/react/shared/dnd/DndProvider.tsx` to the drag overlay and the drag
 * source respectively).
 *
 * NOT THIS FILE'S BUSINESS AT ALL: `target-drop`, `drag-active`, `doom-line`,
 * `sprint-table` and `new`; container registration; the permission gate; the
 * ordering arithmetic (that is `useSortableList.ts`); the serialised
 * `pendingDrag` queue with its re-entrancy guard and its server-value
 * reconciliation (that is `app/react/backlog/state/backlogReducer.ts` together
 * with `useStoryDrag.ts`, ported from `app/coffee/modules/backlog/main.coffee`
 * L84, L539-L546, L600-L601, L603-L618, L620-L629, L630-L631 and L633-L635);
 * and every write to the REST API. This module is stateless with respect to
 * server writes: it holds no queue, no in-flight flag beyond `inProgress`, no
 * de-duplication, no retry, no reconciliation and no broadcast.
 *
 * It also creates NO markup. In particular it never builds or injects the
 * `.card-transit-multi` ghost block; that markup is rendered by
 * `app/react/kanban/KanbanCard.tsx`, reproduced from
 * `app/modules/components/card/card.jade` L45-L55 — a file shared with the
 * out-of-scope taskboard and therefore read-only.
 *
 * ===========================================================================
 * WHY THIS FILE APPLIES CSS CLASS NAMES AT ALL (transformation rules T1 and T9)
 * ===========================================================================
 * Transformation rule T1 is: "Preserve every CSS class name. The in-scope Sass
 * is a pass-through asset, not a rewrite target. React markup must emit the same
 * classes in the same nesting so the existing stylesheets apply verbatim." All
 * six in-scope stylesheets are consequently kept at ZERO edits.
 *
 * Those stylesheets style the RUNTIME class names that the retired drag library
 * used to add and remove by itself. `@dnd-kit/core` emits none of them. So if
 * this module did not apply them explicitly, at the same lifecycle moments, the
 * drag visuals would simply stop appearing — with no error, no warning, no
 * failing build and nothing in the console. That silent-failure mode is the
 * single most important thing to know about this file, and it is why every
 * class add and remove below carries the exact stylesheet locator that depends
 * on it.
 *
 * OWNED BY THIS MODULE — applied and removed here:
 *
 *   gu-transit-multi           added in `drag()` (INCUMBENT:32) to every element
 *                              already carrying `gu-transit`; removed by step 9
 *                              of `stop()` (INCUMBENT:64).
 *                              Consumed by
 *                              `app/styles/modules/kanban/kanban-table.scss:305`
 *                              and :358-:364.
 *   multiple-drag-mirror       added to each clone in `prepare()`
 *                              (INCUMBENT:173); removed by step 7 of `stop()`
 *                              (INCUMBENT:58). Consumed by
 *                              `app/styles/layout/backlog.scss:154` and
 *                              `app/styles/modules/backlog/backlog-table.scss:295`.
 *   tg-multiple-drag-mirror    added to each clone in `prepare()`
 *                              (INCUMBENT:174); the clones themselves are
 *                              DELETED from the document by step 6 of `stop()`
 *                              (INCUMBENT:57). Consumed by
 *                              `app/modules/components/card/card.scss:29`
 *                              (T4-PROTECTED — read only).
 *   main-drag-item             added to the primary element in `prepare()`
 *                              (INCUMBENT:161); removed by step 5 of `stop()`
 *                              (INCUMBENT:56). No stylesheet rule — behavioural
 *                              marker only, but load-bearing: `prepare()` uses
 *                              it to filter the primary element out of the set
 *                              it clones (INCUMBENT:163-165).
 *   tg-multiple-drag-dragging  added to each hidden original in `prepare()`
 *                              (INCUMBENT:187); removed, and the element
 *                              re-shown, by step 8 of `stop()`
 *                              (INCUMBENT:60-62). No stylesheet rule —
 *                              behavioural marker only.
 *
 * Two consequences of the `gu-transit-multi` rules are worth spelling out,
 * because getting the timing wrong changes two visuals at once:
 *
 *   1. `.card-transit-multi` is permanently present in the card markup and is
 *      `display: none` by default
 *      (`app/styles/modules/kanban/kanban-table.scss:320`). It becomes
 *      `display: block` only under `.card.gu-transit-multi` (:358-:364), a rule
 *      that simultaneously hides `.card-inner`. Toggling this one class is
 *      therefore the entire job; the ghost stack is revealed, never built.
 *   2. The same class SUPPRESSES the multi-select ring, because
 *      `kanban-table.scss:305` reads `&.card:not(.gu-transit-multi)`. Add it
 *      late and the ring lingers through the drag; remove it late and the ghost
 *      stack outlives the gesture.
 *
 * ===========================================================================
 * FOUR PORTING HAZARDS FOUND IN THE BEHAVIOURAL SOURCE (rule T9)
 * ===========================================================================
 * H1 — `reset()` IS DEAD CODE UPSTREAM, AND IS DELIBERATELY LEFT DEAD HERE.
 *      Ported for API parity with `window.dragMultiple`; the incumbent defines
 *      this at `app/js/dragula-drag-multiple.js:15-22` and never calls it (zero
 *      call sites). Deliberately not wired into `start`/`drag`/`stop`. Rule T10
 *      forbids functional change of every kind, and quietly promoting an unused
 *      routine into a live lifecycle step would be exactly that.
 *
 * H2 — THE CLONE VARIABLE UPSTREAM IS AN IMPLICIT GLOBAL. At INCUMBENT:170 the
 *      clone is assigned without a declaration keyword, so it leaks onto the
 *      global object on every iteration — a latent defect of the original, not a
 *      behaviour to reproduce. The port below uses a properly scoped `const`
 *      inside the loop body.
 *
 * H3 — THE SELF-REFERENCING LISTENER UPSTREAM IS ILLEGAL IN STRICT MODE. At
 *      INCUMBENT:206 the move handler remembers itself through the deprecated
 *      self-reference property of the `arguments` object, which throws in strict
 *      mode; TypeScript ES modules are implicitly strict, so a named reference
 *      held in closure state is the only option. Two consequences are carried
 *      over deliberately:
 *        - Upstream, that reference stays unset until the FIRST movement, so a
 *          `stop()` with no prior movement removes nothing and returns an empty
 *          collection. The observable outcome is preserved exactly here: the
 *          public `stop()` is a no-op returning `[]` whenever no drag is in
 *          progress, and the listener stays attached, just as it does upstream.
 *        - Upstream, every `start()` attaches a NEW anonymous listener while
 *          only the last one is remembered, so listeners accumulate and a stale
 *          one can re-enter `prepare()` with the previous gesture's arguments.
 *          This port attaches EXACTLY ONE listener per drag and removes exactly
 *          that one, by detaching whatever is still attached before attaching
 *          the next. This is a faithfulness-preserving correction forced by ES
 *          module strictness; in the supported sequence it changes nothing a
 *          user can see.
 *
 * H4 — THE UPSTREAM RETURN SHAPE IS A COLLECTION OBJECT OR A BARE ARRAY.
 *      `getElements()` always returns a query collection (INCUMBENT:219-221),
 *      while the public `stop()` returns a bare `[]` when idle and a query
 *      collection otherwise (INCUMBENT:211-217). Both AngularJS call sites read
 *      only `.length` and `[0]`, so the contract published here is
 *      `readonly HTMLElement[]` in DOCUMENT ORDER, where `[0]` is the FIRST
 *      SELECTED element and `.length === 0` means "this is not a multi-drag".
 *      Both consumers then port mechanically, keeping their existing
 *      `if (!items.length) items = [item]` fallback intact.
 *
 * ===========================================================================
 * jQuery TO PLAIN DOM SUBSTITUTIONS (rule T9)
 * ===========================================================================
 * The behavioural source is written against jQuery, which is never imported
 * into the React tree. Each substitution below is exact rather than
 * approximate, and each one is repeated at its point of use:
 *
 *   `.data(key, value)`        -> a `WeakMap` keyed by element. Programmatic
 *                                 jQuery data writes go to an internal cache and
 *                                 NOT to a `data-*` attribute, so a `WeakMap` is
 *                                 the faithful equivalent; it also guarantees
 *                                 that this module writes no DOM attribute that
 *                                 could disturb the T1 class contract. The
 *                                 element `dataset` is never touched.
 *   `.position()`              -> `getBoundingClientRect()`. jQuery itself
 *                                 special-cases fixed positioning and reads that
 *                                 same rectangle, and the clones are
 *                                 `position: fixed` children of the document
 *                                 body, so viewport coordinates are correct.
 *   `.outerWidth()` /
 *   `.outerHeight()`           -> `offsetWidth` / `offsetHeight`, the border-box
 *                                 metrics jQuery reports when called without its
 *                                 margin argument.
 *   `.hide()` / `.show()`      -> record the element's current INLINE display in
 *                                 a `WeakMap`, set it to `none`, and later put
 *                                 the recorded value back, removing the property
 *                                 outright when there was none before. jQuery
 *                                 restores the pre-hide inline value, which a
 *                                 bare reset to the empty string does not
 *                                 reproduce.
 *   `.clone(true)`             -> `cloneNode(true)`, plus an explicit copy of the
 *                                 recorded index (see `prepare()`).
 *                                 `cloneNode` does not copy event listeners;
 *                                 that difference is accepted rather than worked
 *                                 around, because the clones are inert
 *                                 `position: fixed` ghosts that are deleted again
 *                                 by `stop()` and are never interacted with.
 *   `$('.x')`                  -> `querySelectorAll` on the owner document,
 *                                 preserving the DOCUMENT-WIDE scope that steps
 *                                 5 to 9 of `stop()` and `getElements()` rely on.
 *   `$(container).find('.x')`  -> `container.querySelectorAll('.x')`, a
 *                                 descendant search rather than a children-only
 *                                 one.
 *   `.insertAfter()` /
 *   `.insertBefore()`          -> `parentNode.insertBefore(node, reference)` with
 *                                 the reference's next sibling, guarded against a
 *                                 detached reference.
 *
 * ===========================================================================
 * WHY A FACTORY INSTEAD OF A GLOBAL (rule T9)
 * ===========================================================================
 * Upstream, the helper is published as a single mutable global at
 * INCUMBENT:223. `createMultiDrag()` replaces it with an injected controller
 * whose whole state lives in one closure. That keeps this module free of shared
 * mutable state, so a browserless specification receives a clean instance for
 * each case instead of inheriting whatever the previous one left behind — the
 * test runner clears mocks between cases but cannot reset module state. Only one
 * drag gesture can be in progress at a time, and the two screens are never
 * mounted simultaneously, so one controller per screen is equivalent to the
 * single global it replaces. The drag provider owns exactly one instance.
 */

/* ==========================================================================
 * CLASS NAME CONSTANTS
 * ========================================================================== */

/**
 * `ui-multisortable-multiple` — the selection marker. READ HERE, NEVER
 * ASSIGNED: it is owned by each screen's own selection state, exactly as it is
 * today at `app/partials/includes/modules/kanban-table.jade` L154 and L230
 * (`'ui-multisortable-multiple': ctrl.selectedUss[usId]`) and at
 * `app/coffee/modules/backlog/main.coffee` L824, which toggles it on the closest
 * `.us-item-row`. Mirrors INCUMBENT:10. It carries no stylesheet rule of its
 * own; it is a selector used to find the current selection.
 */
export const MULTIPLE_SORTABLE_CLASS = 'ui-multisortable-multiple';

/**
 * `main-drag-item` — marks the one element the pointer actually grabbed.
 * Applied and removed by this module (INCUMBENT:161 and :56). No stylesheet
 * rule: behavioural marker only. It is nevertheless load-bearing, because
 * `prepare()` filters the primary element out of the clone set by testing for
 * it (INCUMBENT:163-165). Mirrors INCUMBENT:11.
 */
export const MAIN_DRAG_CLASS = 'main-drag-item';

/**
 * `gu-mirror` — the floating drag image. READ HERE, NEVER ASSIGNED: it is
 * applied by `app/react/shared/dnd/DndProvider.tsx` to the drag overlay, and
 * `prepare()` merely captures the element carrying it as the "shadow" whose
 * position every ghost clone follows (INCUMBENT:159). Styled at
 * `app/modules/components/card/card.scss:25` — a T4-PROTECTED file, shared with
 * the out-of-scope taskboard (`app/partials/includes/modules/taskboard-table.jade`
 * L135 and L186) and therefore never edited from here — and at
 * `app/styles/modules/backlog/backlog-table.scss:195`, :211 and :314.
 */
export const MIRROR_CLASS = 'gu-mirror';

/**
 * `gu-transit` — the gap left behind in the source list while a drag is under
 * way. READ HERE, NEVER ASSIGNED: applied by `DndProvider.tsx` to the drag
 * source; `drag()` reads it in order to add `gu-transit-multi` alongside
 * (INCUMBENT:32). Styled at
 * `app/styles/modules/backlog/backlog-table.scss:235` and :330, and at
 * `app/styles/modules/backlog/sprints.scss:307`.
 */
export const TRANSIT_CLASS = 'gu-transit';

/**
 * `gu-transit-multi` — the "this gap represents several items" state. OWNED
 * HERE: added by `drag()` (INCUMBENT:32) and removed by step 9 of `stop()`
 * (INCUMBENT:64). Two rules depend on it, and they fire together:
 * `app/styles/modules/kanban/kanban-table.scss:305` withdraws the multi-select
 * ring through `&.card:not(.gu-transit-multi)`, while :358-:364 reveals the
 * always-present `.card-transit-multi` ghost stack with `display: block` and
 * hides `.card-inner`.
 */
export const TRANSIT_MULTI_CLASS = 'gu-transit-multi';

/**
 * `multiple-drag-mirror` — the ghost clone's appearance. OWNED HERE: added to
 * each clone by `prepare()` (INCUMBENT:173) and removed document-wide by step 7
 * of `stop()` (INCUMBENT:58). Styled at `app/styles/layout/backlog.scss:154`
 * (`.multiple-drag-mirror.us-item-row`) and at
 * `app/styles/modules/backlog/backlog-table.scss:295`.
 */
export const MULTIPLE_DRAG_MIRROR_CLASS = 'multiple-drag-mirror';

/**
 * `tg-multiple-drag-mirror` — the marker that identifies a node as one of this
 * module's own clones, so step 6 of `stop()` can delete precisely those nodes
 * from the document (INCUMBENT:57). OWNED HERE: added by `prepare()`
 * (INCUMBENT:174). Styled at `app/modules/components/card/card.scss:29`
 * (`margin: 0`) — a T4-PROTECTED file, shared with the out-of-scope taskboard, so
 * this module reproduces its class contract rather than editing it.
 */
export const TG_MULTIPLE_DRAG_MIRROR_CLASS = 'tg-multiple-drag-mirror';

/**
 * `tg-multiple-drag-dragging` — the marker that identifies an original element
 * this module hid while its clone flies, so step 8 of `stop()` can find it again
 * and restore it (INCUMBENT:187 and :60-:62). OWNED HERE. No stylesheet rule:
 * behavioural marker only.
 */
export const TG_MULTIPLE_DRAG_DRAGGING_CLASS = 'tg-multiple-drag-dragging';

/* ==========================================================================
 * PUBLIC TYPES
 * ========================================================================== */

/**
 * The search scope handed to `start()` and `isMultiple()`.
 *
 * BOTH SHAPES ARE REQUIRED, because the two AngularJS call sites disagree and
 * jQuery quietly absorbed the difference (rule T9):
 *
 *   - the board passes an ARRAY of column elements —
 *     `window.dragMultiple.start(item, containers)` at
 *     `app/coffee/modules/kanban/sortable.coffee` L87 in the pre-migration
 *     source, retained at :196 of the annotated file, where `containers` is
 *     built by mapping over every `.taskboard-column` (L172-L175 / :380-:383);
 *   - the story list passes a SINGLE element —
 *     `window.dragMultiple.start(item, container)` at
 *     `app/coffee/modules/backlog/sortable.coffee` L77 in the pre-migration
 *     source, retained at :122, where `container` is the second argument of the
 *     drag library's own `drag` event.
 *
 * A jQuery wrapper searches a whole collection, so one code path served both.
 * The plain-DOM port therefore normalises to a list and searches ACROSS every
 * scope, de-duplicating the result and returning it in document order.
 */
export type MultiDragContainer = HTMLElement | readonly HTMLElement[];

/**
 * The controller returned by `createMultiDrag()`. Method names and semantics
 * mirror the retired global one for one, so the two hook consumers can port
 * their existing call sequences unchanged.
 */
export interface MultiDragController {
    /**
     * Arms the gesture. Mirrors INCUMBENT:197-209.
     *
     * A no-op unless `isMultiDrag(item, container)` holds. Otherwise it attaches
     * EXACTLY ONE movement listener, which runs `prepare()` on the first
     * movement only and `drag()` on every movement including the first. See
     * hazard H3 in the file header for why the listener is named rather than
     * self-referencing, and why exactly one is attached.
     */
    start(item: HTMLElement, container: MultiDragContainer): void;

    /**
     * Ends the gesture and reports the selection. Mirrors the public
     * INCUMBENT:211-217.
     *
     * Returns an empty array, and does nothing else at all, when no multi-drag
     * is in progress. Otherwise it runs the full ten-step teardown of
     * INCUMBENT:46-67 in the incumbent's exact order and returns the selected
     * elements in document order, `[0]` first.
     */
    stop(): readonly HTMLElement[];

    /**
     * The current selection. Mirrors INCUMBENT:219-221, and is therefore
     * DOCUMENT-WIDE rather than container-scoped — deliberately unlike
     * `isMultiple()` below.
     */
    getElements(): readonly HTMLElement[];

    /**
     * Whether the given element starts a multi-item drag within the given
     * scope. Mirrors INCUMBENT:95-103, and is therefore CONTAINER-SCOPED —
     * deliberately unlike `getElements()` above.
     */
    isMultiple(item: HTMLElement, container: MultiDragContainer): boolean;

    /**
     * Strips this module's own decoration from one element. Mirrors
     * INCUMBENT:15-22.
     *
     * PORTED FOR API PARITY ONLY. It is dead upstream — defined and never
     * called, with zero call sites, and never even exposed on the global — and
     * it is deliberately wired into no lifecycle path here either. See hazard H1
     * in the file header.
     */
    reset(element: HTMLElement): void;

    /**
     * True from the first movement after `start()` until `stop()` completes.
     * Mirrors the module-level flag at INCUMBENT:12, including the detail that
     * it is `start()` which arms the gesture but the first MOVEMENT which begins
     * it.
     */
    readonly inProgress: boolean;

    /**
     * Detaches whatever movement listener is still attached and drops the
     * gesture state. Intended for the drag provider's unmount cleanup, mirroring
     * the `drake.destroy()` teardown at
     * `app/coffee/modules/kanban/sortable.coffee` L181 in the pre-migration
     * source (retained at :396) and at
     * `app/coffee/modules/backlog/sortable.coffee` L155 (retained at :200).
     *
     * It deliberately performs NO document cleanup: removing the ghost clones
     * and restoring the hidden originals is `stop()`'s ten-step job, and both
     * consumers call `stop()` from their drag-end handler, which always runs
     * before the component unmounts. Duplicating that work here would put a
     * second, differently-ordered teardown into the module.
     */
    destroy(): void;
}

/**
 * Construction options for `createMultiDrag()`. Every field is optional, so
 * `createMultiDrag()` with no argument is the normal call.
 */
export interface CreateMultiDragOptions {
    /**
     * The document to query, to attach the movement listener to, and to append
     * the ghost clones to. Defaults to the ambient document. Injectable so that
     * a browserless specification can drive the controller against a detached
     * document without disturbing the one the test runner shares between cases.
     */
    readonly ownerDocument?: Document;

    /**
     * The movement event to listen for. Defaults to `mousemove`, matching
     * INCUMBENT:199.
     *
     * The type is deliberately a single literal rather than a broad event name:
     * rule T10 forbids functional change, so no pointer, touch or keyboard
     * variant may be introduced here. The option exists to make the listener
     * name explicit at the call site and assertable in a specification, not to
     * widen the gesture surface.
     */
    readonly moveEventName?: 'mousemove';
}

/* ==========================================================================
 * INTERNAL STATE MODEL
 * ========================================================================== */

/**
 * The per-element bookkeeping the incumbent kept in the jQuery data cache.
 *
 * Modelled as one record in one `WeakMap` rather than as `data-*` attributes,
 * for the two reasons given in the file header: programmatic jQuery data writes
 * never reached the DOM either, and writing attributes here could disturb the
 * T1 class and attribute contract that lets the existing stylesheets apply
 * unchanged.
 */
interface MultiDragItemRecord {
    /**
     * Mirrors `dragMultipleIndex`. Zero for the primary element, a positive
     * offset for each selected element that follows it in document order and a
     * negative offset for each one that precedes it. `null` means "cleared",
     * which is the state INCUMBENT:143 writes to every candidate before the
     * numbering is recomputed.
     */
    readonly index: number | null;

    /**
     * Mirrors `dragMultipleActive`. WRITE-ONLY upstream: it is set on the
     * primary element (INCUMBENT:148) and on each clone (INCUMBENT:176), cleared
     * by the dead `reset()` (INCUMBENT:21), and never read by anything. Kept for
     * parity so the port has no silently missing state.
     */
    readonly active: boolean;

    /**
     * Mirrors `dragmultiple:originalPosition`, the viewport position captured
     * before the gesture starts. WRITE-ONLY upstream as well: written for the
     * primary element at INCUMBENT:147 and for each clone at INCUMBENT:175, and
     * never read. Kept for parity, for the same reason.
     */
    readonly originalPosition: { readonly top: number; readonly left: number } | null;

    /**
     * Mirrors `position`. Upstream writes `null` to it at INCUMBENT:142 and
     * nothing ever writes or reads another value, so the type is exactly `null`.
     * Preserved rather than dropped so that the clearing step of `prepare()`
     * remains a visibly complete port of INCUMBENT:140-144.
     */
    readonly position: null;
}

/**
 * The mutable bookkeeping for one controller instance. Held in the factory's
 * closure and threaded explicitly through the helpers below, so that nothing in
 * this module owns state at module scope.
 */
interface MultiDragRecords {
    /** Replaces the jQuery data cache. See `MultiDragItemRecord`. */
    readonly itemState: WeakMap<HTMLElement, MultiDragItemRecord>;

    /**
     * The inline `display` value each hidden original carried before this module
     * hid it, so that the later restore reproduces jQuery's behaviour of putting
     * the PRE-HIDE inline value back rather than merely clearing the property.
     */
    readonly hiddenInlineDisplay: WeakMap<HTMLElement, string>;
}

/**
 * The snapshot of one in-flight gesture, replacing the `dragMultiple.items`
 * object of INCUMBENT:150-153, :159, :167 and :192. `null` between gestures,
 * which is the port of the `items = {}` reset at INCUMBENT:54.
 */
interface ActiveDrag {
    /** The element the pointer grabbed. Upstream `items.elm`. */
    readonly main: HTMLElement;

    /** The normalised search scopes. Upstream `items.container`. */
    readonly containers: readonly HTMLElement[];

    /**
     * The element carrying `gu-mirror`, captured once when the gesture begins.
     * Upstream `items.shadow` (INCUMBENT:159), which is likewise a snapshot and
     * not a live query. `null` when no drag image is present.
     */
    readonly shadow: HTMLElement | null;

    /**
     * Every selected element except the primary one, in document order.
     * Upstream `items.draggedItemsOriginal` (INCUMBENT:167).
     */
    readonly draggedOriginals: readonly HTMLElement[];

    /**
     * The ghost clones appended to the document body, index-aligned with
     * `draggedOriginals`. Upstream `items.draggingItems` (INCUMBENT:192).
     */
    readonly clones: readonly HTMLElement[];
}

/* ==========================================================================
 * DOM UTILITIES
 * ========================================================================== */

/** The record a freshly seen element starts from. */
const EMPTY_RECORD: MultiDragItemRecord = {
    index: null,
    active: false,
    originalPosition: null,
    position: null,
};

/**
 * Narrows a node list to elements, preserving its order.
 *
 * The guard is `instanceof` rather than a type assertion, because assertions are
 * forbidden in this tree: a selector cannot prove at the type level that it
 * matched an HTML element, and silently asserting it would hide the one case
 * that matters — an SVG element matching the same class, which has no
 * `offsetWidth` and no inline `style.display` to record.
 */
const toHtmlElements = (nodes: Iterable<Element>): HTMLElement[] => {
    const elements: HTMLElement[] = [];

    for (const node of nodes) {
        if (node instanceof HTMLElement) {
            elements.push(node);
        }
    }

    return elements;
};

/**
 * Every element carrying `className` beneath `root`, in document order.
 *
 * Replaces the jQuery selector calls of the behavioural source. Where the
 * incumbent wrote `$('.x')` the root here is the owner document, which preserves
 * the DOCUMENT-WIDE scope that steps 5 to 9 of `stop()` depend on: an element may
 * have left its original container by the time the gesture ends, and a
 * container-scoped teardown would leave it decorated for ever.
 */
const queryByClass = (root: ParentNode, className: string): readonly HTMLElement[] =>
    toHtmlElements(root.querySelectorAll(`.${className}`));

/**
 * Sorts elements into document order.
 *
 * Needed because a multi-scope search visits its scopes in the order the caller
 * listed them, which is not necessarily document order, whereas a jQuery
 * collection built from one wrapper always came out in document order. `[0]` has
 * to be the FIRST SELECTED element for both consumers (hazard H4), so the
 * ordering is restored explicitly.
 *
 * `DOCUMENT_POSITION_CONTAINED_BY` also sets `DOCUMENT_POSITION_FOLLOWING`, so a
 * nested element correctly sorts after its ancestor.
 */
const sortInDocumentOrder = (elements: HTMLElement[]): HTMLElement[] =>
    elements.sort((left, right) => {
        if (left === right) {
            return 0;
        }

        const relation = left.compareDocumentPosition(right);

        if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
            return -1;
        }

        if ((relation & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
            return 1;
        }

        return 0;
    });

/**
 * Normalises the asymmetric container argument documented on
 * `MultiDragContainer` into a list of search scopes.
 *
 * The guard is `instanceof HTMLElement` rather than an array check because the
 * union's array branch is read-only, and narrowing a read-only array against a
 * mutable one is not sound; testing the element branch narrows both sides
 * cleanly and needs no assertion.
 */
const normaliseContainers = (container: MultiDragContainer): readonly HTMLElement[] =>
    container instanceof HTMLElement ? [container] : container;

/**
 * Every selected element inside the given scope or scopes, de-duplicated and in
 * document order.
 *
 * This is the port of `$(container).find('.' + multipleSortableClass)` —
 * INCUMBENT:96 and :138. `querySelectorAll` is a DESCENDANT search, matching
 * jQuery's, so a selected row nested inside a sprint table is found from the
 * table just as it was before. De-duplication matters because the board passes
 * an array of columns and a future nested scope would otherwise yield the same
 * element twice, which would inflate the "more than one is selected" test.
 */
const collectSelection = (container: MultiDragContainer): readonly HTMLElement[] => {
    const unique = new Set<HTMLElement>();

    for (const scope of normaliseContainers(container)) {
        for (const element of queryByClass(scope, MULTIPLE_SORTABLE_CLASS)) {
            unique.add(element);
        }
    }

    return sortInDocumentOrder([...unique]);
};

/** Reads the bookkeeping record for one element, or the empty record. */
const readRecord = (records: MultiDragRecords, element: HTMLElement): MultiDragItemRecord =>
    records.itemState.get(element) ?? EMPTY_RECORD;

/** Merges a patch into the bookkeeping record for one element. */
const writeRecord = (
    records: MultiDragRecords,
    element: HTMLElement,
    patch: Partial<MultiDragItemRecord>,
): void => {
    records.itemState.set(element, { ...readRecord(records, element), ...patch });
};

/**
 * Captures a viewport position, replacing jQuery's `.position()`.
 *
 * jQuery reads this very rectangle for fixed-position elements, and every
 * element this is called on is either the primary element of a gesture already
 * lifted by the drag library or one about to become a `position: fixed` child of
 * the document body, so the substitution is exact rather than approximate.
 */
const readViewportPosition = (
    element: HTMLElement,
): { readonly top: number; readonly left: number } => {
    const rect = element.getBoundingClientRect();

    return { top: rect.top, left: rect.left };
};

/**
 * Hides an element the way jQuery's `.hide()` does, recording enough to undo it
 * exactly. The pre-hide INLINE value is what gets recorded, because that is what
 * jQuery's `.show()` restores; clearing the property instead would drop a
 * legitimate inline display that the markup had set.
 */
const hideElement = (records: MultiDragRecords, element: HTMLElement): void => {
    records.hiddenInlineDisplay.set(element, element.style.display);
    element.style.display = 'none';
};

/**
 * Restores an element hidden by `hideElement`, replacing jQuery's `.show()`.
 * When there was no inline display before — the overwhelmingly common case, and
 * also the case for an element this module never hid — the property is removed
 * outright rather than set to the empty string, so the element's computed
 * display returns to whatever the stylesheets say.
 */
const showElement = (records: MultiDragRecords, element: HTMLElement): void => {
    const previous = records.hiddenInlineDisplay.get(element);

    if (previous === undefined || previous === '') {
        element.style.removeProperty('display');
    } else {
        element.style.display = previous;
    }

    records.hiddenInlineDisplay.delete(element);
};

/** Inserts `node` immediately after `reference`, replacing `.insertAfter()`. */
const insertAfter = (node: HTMLElement, reference: HTMLElement): void => {
    const parent = reference.parentNode;

    if (parent === null) {
        return;
    }

    parent.insertBefore(node, reference.nextSibling);
};

/** Inserts `node` immediately before `reference`, replacing `.insertBefore()`. */
const insertBeforeReference = (node: HTMLElement, reference: HTMLElement): void => {
    const parent = reference.parentNode;

    if (parent === null) {
        return;
    }

    parent.insertBefore(node, reference);
};

/* ==========================================================================
 * PURE HELPERS — EXPORTED SO THEY CAN BE EXERCISED WITHOUT A CONTROLLER
 * ==========================================================================
 * Both functions below are standalone as well as being controller methods. That
 * is a requirement, not a convenience: the coverage gate is met by keeping drag
 * effects out of pure logic so the pure logic stays independently testable
 * (implicit requirement I9), and both of these are pure queries over the
 * document with no state and no side effect.
 */

/**
 * Every currently selected element, in document order.
 *
 * DOCUMENT-WIDE by design, mirroring INCUMBENT:219-221, which queries the whole
 * document and not the container. That asymmetry with `isMultiDrag()` is
 * deliberate and is depended upon: the board reads the selection at drag start
 * before it knows which column will receive the cards
 * (`app/coffee/modules/kanban/sortable.coffee` L76, retained at :185), and the
 * story list reads it after the elements may already have moved between the
 * backlog body and a sprint table (`.../backlog/sortable.coffee` L79, retained
 * at :124).
 *
 * Returns `readonly HTMLElement[]` rather than a collection object, per hazard
 * H4: `[0]` is the first selected element and an empty result means "not a
 * multi-drag", which is exactly what both call sites test with
 * `if (!items.length) items = [item]`.
 *
 * ONE SHARED SUBTLETY, CALLED OUT RATHER THAN "FIXED"
 * --------------------------------------------------
 * A deep clone copies class names, so each ghost clone carries the selection
 * class too — upstream just as much as here, since jQuery's `.clone(true)` copies
 * the whole class attribute. While ghosts are in the document this query would
 * therefore report each selected element twice. That never happens in the
 * supported sequence, and both call orders prove it: the board reads the
 * selection BEFORE arming the gesture (`getElements()` then `start()`, at
 * `app/coffee/modules/kanban/sortable.coffee` :185 then :196), the story list
 * arms it before reading but `start()` only ATTACHES a listener so no ghost
 * exists until the first movement (`.../backlog/sortable.coffee` :122 then :124),
 * and `stop()` deletes every ghost at step 6 before reporting at step 10.
 * Consumers must keep that ordering and must not read the selection mid-gesture;
 * the behaviour is documented rather than defended against, because filtering the
 * ghosts out here would deviate from the incumbent (rule T10).
 *
 * @param root Search root. Defaults to the ambient document, so the bare call
 *   reproduces the incumbent exactly; a controller passes its own document.
 */
export function getMultiDragElements(root: ParentNode = document): readonly HTMLElement[] {
    return queryByClass(root, MULTIPLE_SORTABLE_CLASS);
}

/**
 * Whether grabbing `item` should start a MULTI-item drag within `container`.
 *
 * CONTAINER-SCOPED by design, mirroring INCUMBENT:95-103 — deliberately unlike
 * `getMultiDragElements()` above. Two conditions must both hold, exactly as
 * upstream: the grabbed element must itself be selected, and the scope must hold
 * more than one selected element. Grabbing an unselected card while others are
 * selected is therefore a single-item drag, which is the behaviour today.
 *
 * The selection is collected before the conditions are tested, keeping the
 * evaluation order of INCUMBENT:96-100 rather than short-circuiting on the class
 * test. The result is identical either way; the order is preserved so that the
 * port reads as a transcription.
 *
 * `container` accepts the board's ARRAY and the story list's SINGLE element
 * alike — see `MultiDragContainer` for both locators.
 */
export function isMultiDrag(item: HTMLElement, container: MultiDragContainer): boolean {
    const selection = collectSelection(container);

    if (!item.classList.contains(MULTIPLE_SORTABLE_CLASS) || !(selection.length > 1)) {
        return false;
    }

    return true;
}

/* ==========================================================================
 * THE NUMBERING ALGORITHM
 * ========================================================================== */

/**
 * Numbers every selected element RELATIVE TO the primary one. Transcribes
 * INCUMBENT:105-131.
 *
 * `items` is the FULL selection INCLUDING the primary element, in document
 * order, exactly as upstream passes it at INCUMBENT:157. The primary element is
 * recognised by already carrying index `0` — written immediately before the call
 * at INCUMBENT:155 — and is SKIPPED rather than renumbered (INCUMBENT:110-113).
 *
 * THE SIGN CONVENTION, AND WHY `before` IS REVERSED
 * ------------------------------------------------
 * Elements after the primary one keep document order and receive `+1, +2, +3, …`
 * (INCUMBENT:124-126). Elements before it are collected in document order and
 * then REVERSED (INCUMBENT:122) before receiving `-1, -2, -3, …`
 * (INCUMBENT:128-130), so the numbering runs NEAREST-FIRST: the element
 * immediately above the primary one is `-1`, the one above that `-2`, and so on.
 *
 * That is what makes the ghost stack read correctly. `drag()` positions each
 * clone at `index * shadowHeight` from the drag image, so a nearest-first
 * negative run stacks the clones upwards in the same visual order the list shows,
 * while a document-order negative run would stack them upside down. The reversal
 * is therefore load-bearing, not incidental.
 *
 * Note that the reversal happens HERE, when the numbers are assigned, and NOT
 * again in `refreshOriginal()`; see the comment there.
 */
const setIndex = (items: readonly HTMLElement[], records: MultiDragRecords): void => {
    const before: HTMLElement[] = [];
    const after: HTMLElement[] = [];
    let mainFound = false;

    for (const item of items) {
        if (readRecord(records, item).index === 0) {
            mainFound = true;
            continue;
        }

        if (mainFound) {
            after.push(item);
        } else {
            before.push(item);
        }
    }

    before.reverse();

    after.forEach((item, offset) => {
        writeRecord(records, item, { index: offset + 1 });
    });

    before.forEach((item, offset) => {
        writeRecord(records, item, { index: -offset - 1 });
    });
};

/* ==========================================================================
 * THE CONTROLLER FACTORY
 * ========================================================================== */

/**
 * Creates one multi-drag controller.
 *
 * A factory rather than a module-level singleton, for the reasons set out under
 * "WHY A FACTORY INSTEAD OF A GLOBAL" in the file header: it replaces the mutable
 * global of INCUMBENT:223, leaves this module without shared mutable state, and
 * gives each browserless test case a clean instance. The drag provider owns
 * exactly one instance per screen, which is equivalent to the single global it
 * replaces because only one gesture can ever be in progress.
 *
 * @param options See `CreateMultiDragOptions`. Omit it for the normal case.
 */
export function createMultiDrag(options?: CreateMultiDragOptions): MultiDragController {
    const ownerDocument: Document = options?.ownerDocument ?? document;
    const moveEventName: 'mousemove' = options?.moveEventName ?? 'mousemove';

    // Replaces the jQuery data cache and jQuery's hide/show bookkeeping. Both are
    // WeakMaps keyed by element, so an element removed from the document — which
    // the board does to cards that changed column, at
    // `app/coffee/modules/kanban/sortable.coffee` L151 (retained at :318) — takes
    // its bookkeeping with it and cannot leak.
    const records: MultiDragRecords = {
        itemState: new WeakMap<HTMLElement, MultiDragItemRecord>(),
        hiddenInlineDisplay: new WeakMap<HTMLElement, string>(),
    };

    // Ports the two module-level variables at INCUMBENT:12-13 into closure state.
    let inProgress = false;
    let activeDrag: ActiveDrag | null = null;
    let moveListener: ((event: MouseEvent) => void) | null = null;

    /**
     * Detaches the movement listener if one is attached. Ports INCUMBENT:51,
     * where the reference is the deprecated self-reference of hazard H3; here it
     * is a named closure variable, which is the only strict-mode-legal option.
     */
    const detachMoveListener = (): void => {
        if (moveListener === null) {
            return;
        }

        ownerDocument.documentElement.removeEventListener(moveEventName, moveListener);
        moveListener = null;
    };

    /**
     * Builds the gesture: numbers the selection, marks the primary element, and
     * clones every other selected element into a floating ghost. Transcribes
     * INCUMBENT:135-195, step for step, in the upstream order.
     */
    const prepare = (main: HTMLElement, container: MultiDragContainer): void => {
        // INCUMBENT:136 — the gesture is live from here, which is what makes the
        // movement listener run `prepare()` once and `drag()` on every movement.
        inProgress = true;

        // INCUMBENT:138 — the descendant search across every scope.
        const selection = collectSelection(container);

        // INCUMBENT:140-144 — clear the numbering on EVERY candidate first, so a
        // previous gesture's numbers can never survive into this one.
        for (const element of selection) {
            writeRecord(records, element, { position: null, index: null });
        }

        // INCUMBENT:146-148 — both of these are write-only upstream; see
        // `MultiDragItemRecord`.
        writeRecord(records, main, {
            originalPosition: readViewportPosition(main),
            active: true,
        });

        // INCUMBENT:155 — the primary element is index 0, and that is precisely
        // how `setIndex` recognises and skips it.
        writeRecord(records, main, { index: 0 });

        // INCUMBENT:157 — called with the FULL selection, the primary element
        // included.
        setIndex(selection, records);

        // INCUMBENT:159 — a SNAPSHOT, not a live query, exactly as upstream: the
        // element carrying `gu-mirror` at this instant becomes the shadow every
        // ghost follows. It may legitimately be absent, in which case `drag()`
        // returns without moving anything rather than throwing the way upstream
        // would; the drag provider is responsible for putting `gu-mirror` on the
        // drag overlay before the first movement.
        const shadow = ownerDocument.querySelector(`.${MIRROR_CLASS}`);

        // INCUMBENT:161 — see `MAIN_DRAG_CLASS`: behavioural marker, no
        // stylesheet rule, but it is how the primary element is excluded next.
        main.classList.add(MAIN_DRAG_CLASS);

        // INCUMBENT:163-165 — everything except the primary element gets cloned.
        const draggedOriginals = selection.filter(
            (element) => !element.classList.contains(MAIN_DRAG_CLASS),
        );

        // INCUMBENT:181 — the clone width comes from the PRIMARY element, so the
        // whole ghost stack is as wide as the card being dragged rather than each
        // ghost keeping its own width. Read once, before the loop, because the
        // primary element is never hidden and so cannot change size inside it.
        // jQuery's `.outerWidth()` is the border-box width, which is
        // `offsetWidth`.
        const mainWidth = main.offsetWidth;

        const clones: HTMLElement[] = [];

        for (const original of draggedOriginals) {
            // INCUMBENT:170 — hazard H2: upstream assigns this without a
            // declaration keyword, leaking a global on every iteration. Scoped
            // properly here.
            const clone = original.cloneNode(true);

            if (!(clone instanceof HTMLElement)) {
                // Unreachable in practice, since cloning an HTML element yields
                // an HTML element. The guard exists because the DOM typings
                // declare `cloneNode` as returning a bare node and type
                // assertions are not permitted in this tree.
                continue;
            }

            // INCUMBENT:173 — styled at `app/styles/layout/backlog.scss:154` and
            // `app/styles/modules/backlog/backlog-table.scss:295`.
            clone.classList.add(MULTIPLE_DRAG_MIRROR_CLASS);

            // INCUMBENT:174 — styled at
            // `app/modules/components/card/card.scss:29`, and the marker step 6
            // of `stop()` uses to delete exactly these nodes again.
            clone.classList.add(TG_MULTIPLE_DRAG_MIRROR_CLASS);

            // THE CLONE MUST INHERIT THE NUMBER, and this is the one place the
            // port cannot simply mirror the upstream call: jQuery's
            // `.clone(true)` copies the data cache with the node, so upstream the
            // clone silently arrived carrying its original's index, and `drag()`
            // reads the index OFF THE CLONE (INCUMBENT:35). `cloneNode` copies no
            // WeakMap entry, so the number is copied across explicitly. Without
            // this line every ghost would report no index, stack at offset zero
            // and collapse the whole stack into one position.
            const originalRecord = readRecord(records, original);

            writeRecord(records, clone, {
                index: originalRecord.index,
                position: originalRecord.position,
                // INCUMBENT:175-176 — write-only upstream, kept for parity.
                originalPosition: readViewportPosition(original),
                active: true,
            });

            // INCUMBENT:177-183. The ghost is lifted out of the layout entirely
            // and pinned to the viewport, which is what makes the viewport
            // coordinates `drag()` computes correct.
            clone.style.zIndex = '9999';
            clone.style.opacity = '0.8';
            clone.style.position = 'fixed';
            clone.style.width = `${mainWidth}px`;

            // Each ghost keeps its OWN height — upstream reads the item, not the
            // primary element — and the measurement happens here, while the
            // original is still visible, because the hide below would collapse it
            // to zero. jQuery's `.outerHeight()` is the border-box height, which
            // is `offsetHeight`.
            clone.style.height = `${original.offsetHeight}px`;

            // INCUMBENT:185-187 — the ORIGINAL, and only the original, is hidden
            // and marked; its ghost flies in its place. The pre-hide inline
            // display is recorded so step 8 of `stop()` can put back exactly what
            // was there. The clone deliberately does NOT receive this marker:
            // upstream applies it to the item, and step 8 restores every element
            // carrying it, so marking the clone as well would put a deleted node
            // through the restore path.
            hideElement(records, original);
            original.classList.add(TG_MULTIPLE_DRAG_DRAGGING_CLASS);

            clones.push(clone);
        }

        // INCUMBENT:150-153, :159, :167 and :192 assign these one at a time onto
        // a shared object; nothing reads that object during `prepare()`, so the
        // port assigns the finished snapshot once, which also keeps the gesture
        // state immutable for its whole lifetime.
        activeDrag = {
            main,
            containers: normaliseContainers(container),
            shadow: shadow instanceof HTMLElement ? shadow : null,
            draggedOriginals,
            clones,
        };

        // INCUMBENT:194 — the ghosts live on the document body, outside every
        // scroll container, because they are `position: fixed`.
        for (const clone of clones) {
            ownerDocument.body.appendChild(clone);
        }
    };

    /**
     * Moves the ghost stack to follow the drag image, and marks the gap left
     * behind as a multi-item gap. Transcribes INCUMBENT:24-44.
     */
    const drag = (): void => {
        const gesture = activeDrag;

        if (gesture === null || gesture.shadow === null) {
            // Upstream this situation raises a type error, because it calls a
            // jQuery reader on an empty collection (INCUMBENT:28). Returning
            // quietly is the behaviour asked for by this file's brief and cannot
            // mask a real problem in the supported sequence, where the drag
            // provider has already applied `gu-mirror` to the drag overlay before
            // the first movement arrives.
            return;
        }

        // INCUMBENT:28-30. One rectangle read serves all three values, and it is
        // the same rectangle jQuery reads for a fixed-position element.
        const rect = gesture.shadow.getBoundingClientRect();
        const currentLeft = rect.left;
        const currentTop = rect.top;

        // THE STACKING STEP IS THE SHADOW'S HEIGHT, NOT THE CLONE'S
        // (INCUMBENT:30). Every ghost is offset by a multiple of the DRAG IMAGE's
        // height, which is what keeps the stack evenly pitched even when the
        // selected rows have different heights — and each clone still keeps its
        // own height, set in `prepare()`. Using each clone's height here instead
        // would make the stack drift apart as soon as two selected rows differed.
        const height = rect.height;

        // INCUMBENT:32 — DOCUMENT-WIDE, and owned by this module. See
        // `TRANSIT_MULTI_CLASS`: this single class both reveals the always-present
        // `.card-transit-multi` ghost stack
        // (`app/styles/modules/kanban/kanban-table.scss:358-364`, which also hides
        // `.card-inner`) and withdraws the multi-select ring (:305, through
        // `&.card:not(.gu-transit-multi)`). It is added on every movement, exactly
        // as upstream, which is idempotent and is what makes it correct even when
        // the drag library replaces the transit element mid-gesture.
        for (const transit of queryByClass(ownerDocument, TRANSIT_CLASS)) {
            transit.classList.add(TRANSIT_MULTI_CLASS);
        }

        // INCUMBENT:34-43 — the index is read off the CLONE, which is why
        // `prepare()` copies it there.
        for (const clone of gesture.clones) {
            const index = readRecord(records, clone).index;

            if (index === null) {
                continue;
            }

            clone.style.top = `${currentTop + index * height}px`;
            clone.style.left = `${currentLeft}px`;
        }
    };

    /**
     * Puts the hidden originals back around the primary element, in their
     * original relative order. Transcribes INCUMBENT:69-92.
     *
     * WHY ONLY `after` IS REVERSED HERE
     * ---------------------------------
     * Each `insertAfter` places its element IMMEDIATELY after the primary one, so
     * the last element inserted ends up closest to it. Walking `after` backwards
     * (INCUMBENT:83) therefore leaves it in ascending order. `insertBefore`
     * places its element immediately BEFORE the primary one, so the last one
     * inserted is again closest, and the document-ordered list already satisfies
     * that — which is why upstream does NOT reverse `before` here
     * (INCUMBENT:89-91). The reversal that `before` does need happened earlier, in
     * `setIndex`, where it produced the nearest-first negative numbering.
     * Reversing it a second time here would silently invert the order of every
     * element above the grabbed one.
     */
    const refreshOriginal = (): void => {
        const gesture = activeDrag;

        if (gesture === null) {
            return;
        }

        // INCUMBENT:70 — in practice always 0, since `prepare()` sets it, but read
        // rather than assumed, exactly as upstream reads it.
        const mainIndex = readRecord(records, gesture.main).index;

        if (mainIndex === null) {
            return;
        }

        const after: HTMLElement[] = [];
        const before: HTMLElement[] = [];

        // INCUMBENT:75-81. An element with no number falls into `before`, which is
        // what upstream does too: its parse of a missing value yields a
        // not-a-number, and the greater-than test against it is false.
        for (const original of gesture.draggedOriginals) {
            const index = readRecord(records, original).index;

            if (index !== null && index > mainIndex) {
                after.push(original);
            } else {
                before.push(original);
            }
        }

        after.reverse();

        for (const element of after) {
            insertAfter(element, gesture.main);
        }

        for (const element of before) {
            insertBeforeReference(element, gesture.main);
        }
    };

    /**
     * The ten-step teardown. Transcribes INCUMBENT:46-67 in the upstream ORDER,
     * which matters: the document reordering of step 2 needs the gesture snapshot
     * that step 4 discards, and the class sweeps of steps 5 to 9 are
     * document-wide precisely because they must reach elements that have since
     * left their original container.
     */
    const teardown = (): readonly HTMLElement[] => {
        // 1. INCUMBENT:47.
        inProgress = false;

        // 2. INCUMBENT:49 — before the snapshot is dropped.
        refreshOriginal();

        // 3. INCUMBENT:51 — hazard H3: exactly the one listener this controller
        //    attached, by name.
        detachMoveListener();

        // 4. INCUMBENT:54 — the port of `items = {}`.
        activeDrag = null;

        // 5. INCUMBENT:56 — behavioural marker, no stylesheet rule.
        for (const element of queryByClass(ownerDocument, MAIN_DRAG_CLASS)) {
            element.classList.remove(MAIN_DRAG_CLASS);
        }

        // 6. INCUMBENT:57 — the ghosts are DELETED from the document, not merely
        //    undecorated. This is the only step that removes nodes, and it is why
        //    `prepare()` marks every clone with `tg-multiple-drag-mirror`
        //    (`app/modules/components/card/card.scss:29`).
        for (const element of queryByClass(ownerDocument, TG_MULTIPLE_DRAG_MIRROR_CLASS)) {
            element.remove();
        }

        // 7. INCUMBENT:58 — runs after step 6 has already removed this module's
        //    own ghosts, and is kept in place regardless because the drag library
        //    also applies this class to its own mirror: both AngularJS screens do
        //    exactly that from their `cloned` handler
        //    (`app/coffee/modules/kanban/sortable.coffee` L89-L90, retained at
        //    :203-:204, and `.../backlog/sortable.coffee` L91-L92, retained at
        //    :136-:137), and that element is not one of this module's clones.
        //    Styled at `app/styles/layout/backlog.scss:154`.
        for (const element of queryByClass(ownerDocument, MULTIPLE_DRAG_MIRROR_CLASS)) {
            element.classList.remove(MULTIPLE_DRAG_MIRROR_CLASS);
        }

        // 8. INCUMBENT:60-62 — undecorate AND re-show, restoring the exact inline
        //    display recorded before the hide.
        for (const element of queryByClass(ownerDocument, TG_MULTIPLE_DRAG_DRAGGING_CLASS)) {
            element.classList.remove(TG_MULTIPLE_DRAG_DRAGGING_CLASS);
            showElement(records, element);
        }

        // 9. INCUMBENT:64 — the ghost stack is hidden again and the multi-select
        //    ring comes back, both through
        //    `app/styles/modules/kanban/kanban-table.scss:305` and :358-364.
        for (const element of queryByClass(ownerDocument, TRANSIT_MULTI_CLASS)) {
            element.classList.remove(TRANSIT_MULTI_CLASS);
        }

        // 10. INCUMBENT:66 — the selection is REPORTED, not cleared: the class
        //     that defines it belongs to the screens, and both drag-end handlers
        //     consume this list to build the payload of their move broadcast.
        return getMultiDragElements(ownerDocument);
    };

    return {
        start(item: HTMLElement, container: MultiDragContainer): void {
            // INCUMBENT:198 — the whole gesture is gated on the container-scoped
            // test, so a single-item drag never reaches this machinery.
            if (!isMultiDrag(item, container)) {
                return;
            }

            // Hazard H3, second consequence: upstream adds a fresh anonymous
            // listener here on every call and remembers only the last, so they
            // accumulate and a stale one can re-enter `prepare()` carrying the
            // PREVIOUS gesture's element and scope. Detaching first guarantees
            // exactly one listener exists at every moment, and `stop()` removes
            // exactly that one.
            detachMoveListener();

            const listener = (): void => {
                // INCUMBENT:200-204 — `prepare()` on the first movement only,
                // `drag()` on every movement including the first. Arming in
                // `start()` but building on first movement is what keeps a click
                // that never moves from producing ghosts at all.
                if (!inProgress) {
                    prepare(item, container);
                }

                drag();
            };

            moveListener = listener;
            ownerDocument.documentElement.addEventListener(moveEventName, listener);
        },

        stop(): readonly HTMLElement[] {
            // INCUMBENT:211-217. When no gesture is in progress this returns an
            // empty array and does NOTHING else — in particular it leaves the
            // armed listener attached, which is precisely the upstream outcome:
            // upstream's listener reference is still unset at that point, so its
            // removal call is a no-op as well. Both consumers rely on the empty
            // result, falling back to `[item]` for a single-item drag.
            if (inProgress) {
                return teardown();
            }

            return [];
        },

        getElements(): readonly HTMLElement[] {
            // INCUMBENT:219-221 — document-wide, not container-scoped.
            return getMultiDragElements(ownerDocument);
        },

        isMultiple(item: HTMLElement, container: MultiDragContainer): boolean {
            // INCUMBENT:95-103 — container-scoped, not document-wide.
            return isMultiDrag(item, container);
        },

        reset(element: HTMLElement): void {
            // Hazard H1. Transcribes INCUMBENT:15-22 for API parity and is
            // deliberately called from nowhere: upstream defines it, never calls
            // it, and never even exposes it on the global. Rule T10 forbids
            // functional change, so it stays inert here too. The order matches
            // upstream: drop the inline style wholesale, then the two mirror
            // classes, then the bookkeeping.
            element.removeAttribute('style');
            element.classList.remove(TG_MULTIPLE_DRAG_MIRROR_CLASS);
            element.classList.remove(MULTIPLE_DRAG_MIRROR_CLASS);
            writeRecord(records, element, { index: null, active: false });
        },

        get inProgress(): boolean {
            // A getter, not a captured value, so the flag always reflects live
            // state — the port of reading the module-level variable at
            // INCUMBENT:12 directly.
            return inProgress;
        },

        destroy(): void {
            // Parity with the `drake.destroy()` teardown at
            // `app/coffee/modules/kanban/sortable.coffee` L181 (retained at :396)
            // and `.../backlog/sortable.coffee` L155 (retained at :200). It
            // detaches the listener and drops the gesture state, and deliberately
            // does no document cleanup — see `MultiDragController.destroy`.
            detachMoveListener();
            activeDrag = null;
            inProgress = false;
        },
    };
}
