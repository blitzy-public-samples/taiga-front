/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, UIEvent } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import type { Status } from '../shared/types/status';
import type { InViewportApi } from '../shared/useInViewport';
import { ArchivedColumn, ArchivedColumnIntro } from './ArchivedColumn';
import { KanbanCard } from './KanbanCard';
import type { KanbanCardProps } from './KanbanCard';
import type { KanbanBoardState } from './state/types';
import { TaskCounter } from './TaskCounter';
import { WipLimitMarker, resolveWipLimitIndex, resolveWipLimitState } from './WipLimitMarker';
import type { WipLimitState } from './WipLimitMarker';

/* ==========================================================================
 * ONE STATUS COLUMN CELL OF THE KANBAN BOARD
 * ==========================================================================
 *
 * The React replacement for `div.kanban-uses-box.taskboard-column` and everything it
 * hosts -- `app/partials/includes/modules/kanban-table.jade` L112-L175 in SWIMLANE
 * mode and its twin at L189-L250 in FLAT mode. The `ng-repeat` that produced one of
 * these per status (per swimlane) stays with the OWNER, so this file renders exactly
 * ONE cell and takes its status, its card ids and its state as props.
 *
 * The cell is four things at once, which is why a "presentational" component owns two
 * DOM effects:
 *
 *   1. the drop target for card drag-and-drop (`.taskboard-column` is the container
 *      selector the drag layer resolves, and `data-status` / `data-swimlane` are the
 *      keys it reads off it);
 *   2. the IntersectionObserver ROOT for card virtualisation;
 *   3. the scroll host that keeps the task counter pinned as the column scrolls;
 *   4. the host of the cards, the WIP-limit marker, the placeholder and the collapsed
 *      rail.
 *
 * The rendered shape is, verbatim:
 *
 * ```html
 * <div class="kanban-uses-box taskboard-column" id="column-3" data-status="3"
 *      data-swimlane="7">
 *     <div class="kanban-task-counter" title="Number of user stories">
 *         <tg-animated-counter>…</tg-animated-counter>
 *     </div>
 *     <div class="card-placeholder">…</div>
 *     <tg-card class="card ng-animate-disabled" data-id="12">…</tg-card>
 *     <div class="kanban-wip-limit one-left"><span>WIP Limit</span></div>
 *     <div class="kanban-column-intro"></div>
 * </div>
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEAM NOTES (T9) -- every technology-specific decision, at the point of change
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. ⭐⭐ `id="column-<status.id>"` IS EMITTED AND IS DELIBERATELY DUPLICATED.
 *    In swimlane mode the same `id` appears once per swimlane -- five lanes give five
 *    elements all carrying `id="column-3"` -- which is technically invalid HTML. That
 *    is exactly what `kanban-table.jade` L115 produces, and it is reproduced rather
 *    than corrected. ⛔ Suffixing the swimlane id to "fix" it would break anything
 *    reading `#column-<id>`, and a duplicate id is not a rendering fault: the class
 *    and `data-*` contracts are what the stylesheet and the drag layer actually use.
 *    Preserving it is rule T10 -- no functional change of any kind.
 *
 * 2. ⭐⭐ `data-status` AND `data-swimlane` ARE LOAD-BEARING, NOT DECORATION.
 *    The drag layer reads them back as `Number(column.dataset.status)` and
 *    `Number(column.dataset.swimlane)` (`./hooks/useCardDrag`, mirroring
 *    `app/coffee/modules/kanban/sortable.coffee`'s `dragend` handler), and the
 *    virtualisation registry keys columns by the same pair. `data-status` is always
 *    emitted; `data-swimlane` is emitted ONLY in swimlane mode, because the flat-mode
 *    markup at `kanban-table.jade` L189-L197 carries `data-status` alone.
 *    The mechanism is that react-dom OMITS an attribute whose value is `undefined`,
 *    so passing `data-swimlane={swimlaneId}` renders the attribute in swimlane mode
 *    and renders NOTHING in flat mode -- one expression, both source variants, no
 *    conditional spread.
 *
 * 3. ⭐ WHY `swimlaneId` MUST BE `undefined` IN FLAT MODE -- NEVER `0`, NEVER `null`.
 *    Both the virtualisation registry (`../shared/useInViewport`, whose `columnKey`
 *    branches on `swimlaneId ? … : …`) and the incumbent `app/js/boards.js` it ports
 *    discriminate the two modes by TRUTHINESS. A `0` is falsy, so it silently takes
 *    the FLAT path and the card→column registry key goes wrong -- cards register
 *    against a key their column never claims, and virtualisation quietly never fires.
 *    `-1`, the synthetic unclassified swimlane, is TRUTHY and correctly takes the
 *    swimlane path. The prop is therefore typed `swimlaneId?: number` and the flat
 *    caller omits it.
 *
 * 4. ⭐⭐ THE UPSTREAM LOOKUP KEYS ARE ASYMMETRIC AND MUST NOT BE NORMALISED.
 *    Flat mode reads its collection with a STRING key -- `usByStatus.get(s.id.toString())`
 *    (`kanban-table.jade` L204, L211, L229) -- while swimlane mode reads it with a
 *    NUMERIC path -- `usByStatusSwimlanes.getIn([swimlane.id, s.id])` (L128, L135,
 *    L153). That asymmetry lives in `./state`, and conflating the two silently empties
 *    columns. This component deliberately receives the ALREADY-RESOLVED results as a
 *    plain `count: number` and a plain `cardIds: readonly number[]`, so it neither
 *    knows nor can corrupt the key types.
 *
 * 5. ⭐⭐ FLAT MODE HAS NO `kanban-moved` AND NO `on-click-move-to-top`.
 *    Compare the two `ng-class` maps: swimlane mode (L154) ends with
 *    `'kanban-moved': ctrl.movedUs.indexOf(usId) != -1` and the element carries
 *    `on-click-move-to-top="…"` (L160); the flat twin (L230) has NEITHER. So when
 *    `swimlaneId === undefined` this component forces `moved` to `false` and passes NO
 *    `onClickMoveToTop` handler down. Getting this wrong produces a phantom feature in
 *    flat mode -- a move-to-top affordance and a highlight the incumbent never had.
 *
 * 6. `ng-include` → INLINED MARKUP. The placeholder body is pulled in by
 *    `ng-include="'common/components/kanban-placeholder.html'"` (L147 / L223). React
 *    has no include mechanism, so `app/partials/common/components/kanban-placeholder.jade`
 *    L8-L31 is transcribed inline in {@link CardPlaceholder} -- every class name, in
 *    the same order and nesting, so the unedited
 *    `app/styles/components/card-placeholder.scss` applies verbatim (rule T1).
 *
 * 7. ⭐ `<ng-container>` → REACT FRAGMENT. DRIFT REGISTER ENTRY D16.
 *    `ng-container` is not an AngularJS directive, so AngularJS emits it into the DOM
 *    as a literal unknown element. A repository-wide check confirms NO stylesheet
 *    anywhere selects `ng-container`, so replacing it with a fragment removes an
 *    unstyled element that no selector depends on -- and avoids inventing a JSX
 *    intrinsic for it. Named here rather than silently resolved, per rule T6.
 *
 * 8. ⭐ THE STICKY COUNTER USES `scrollTop` AND `translateY`.
 *    `KanbanTaskboardColumnDirective` (`app/coffee/modules/kanban/main.coffee`) is,
 *    verbatim:
 *
 *        $el.on "scroll", (event) ->
 *            scroll = event.currentTarget.scrollTop
 *            taskCounterDom = $el.find(".kanban-task-counter")
 *            taskCounterDom.css("transform", "translateY(#{scroll}px)")
 *        $scope.$on "$destroy", -> $el.off()
 *
 *    Reproduced with a React `onScroll` handler writing the transform through a ref.
 *    ⚠ Do NOT confuse the axes: THIS is the VERTICAL sync of the counter inside one
 *    column (`scrollTop` → `translateY`). The board's HORIZONTAL header sync is a
 *    different mechanism on a different element (`scrollLeft` → `translateX`) and
 *    lives in `KanbanBoard`. The ref is also the reason the document is never queried:
 *    the counter is absent while the column is folded, and a document-wide
 *    `querySelector` would find a SIBLING column's counter, because of seam note 1's
 *    duplicated ids.
 *    React detaches the listener when the element unmounts, which is the equivalent of
 *    the `$destroy → $el.off()` teardown; no cleanup is written by hand.
 *
 * 9. ⭐⭐ FINDING C -- `@dnd-kit/core` EMITS NONE OF THE RETIRED LIBRARY'S CLASSES.
 *    `gu-transit`, `gu-mirror`, `multiple-drag-mirror`, `tg-multiple-drag-mirror`,
 *    `target-drop` and `new` all arrived for free from dragula and now arrive from
 *    nothing. Two of them belong to this element and are applied here declaratively:
 *
 *      - `target-drop` -- dragula added it on `over` and removed it on `out`, BUT ONLY
 *        WHEN `container !== initialContainer`, so the column a drag STARTED in is
 *        never highlighted as its own drop target. Because `initialContainer` is a
 *        single per-drag value, that bookkeeping belongs to `./hooks/useCardDrag` /
 *        `../shared/dnd`; this component receives the already-resolved boolean
 *        {@link StatusColumnProps.isDropTarget} and does nothing but apply the class.
 *        The rule is quoted here so whoever wires the flag cannot get it wrong.
 *      - `new` -- after a real drop, `sortable.coffee`'s `dragend` does
 *        `$(parentEl).addClass('new')` and registers a ONE-SHOT
 *        `$(parentEl).one('animationend', -> $(parentEl).removeClass('new'))`.
 *        Reproduced by {@link StatusColumnProps.justDropped} plus the element's own
 *        `animationend`; see seam note 10.
 *
 *    ⚠ SHARED OWNERSHIP OF THE SAME TWO CLASSES. `./hooks/useCardDrag` also applies
 *    them IMPERATIVELY through `classList` while a gesture is in flight, and React
 *    rewrites `class` wholesale on every render -- so a re-render mid-gesture would
 *    strip a class the drag layer owns. The mitigations are that this component is
 *    wrapped in `React.memo`, and that a drag changes none of its props until the
 *    drop commits. An owner that mirrors the two flags into state gets the
 *    declarative path; an owner that leaves them `false` gets the imperative one.
 *    Both reproduce the incumbent. ⛔ Never add a MutationObserver or a
 *    class-merging effect: either would fight the drag layer for the same attribute.
 *
 * 10. ⭐ THE `new` CLASS IS TRANSIENT BY CONSTRUCTION, AND ITS REMOVAL IS EVENT-DRIVEN.
 *     `kanban-table.scss` declares `.new` as PURELY an animation trigger --
 *     `animation: new-us-status-blink .5s ease-in`, and a two-iteration variant for a
 *     folded column -- with no static declaration at all. Left on, the column never
 *     blinks again; never added, nothing blinks. So the class is added when
 *     `justDropped` RISES and removed on the first `animationend`, exactly once, after
 *     which `onNewAnimationEnd` lets the owner clear its flag.
 *     ⛔ Not a `setTimeout`: duplicating the CSS duration on this side would let the
 *     two drift apart, and the incumbent used the animation's own end event.
 *     Note that `animationend` BUBBLES, so a descendant's animation can end this flash
 *     early -- jQuery's `.one()` on the same element had precisely the same property,
 *     so the behaviour is preserved rather than improved.
 *     ⚠ jsdom never fires `animationend` on its own; the co-located spec dispatches it.
 *
 * 11. ⭐ VIRTUALISATION -- FINDING E: THE REGISTRATION ORDER INVERTS, AND THE HOOK
 *     ALREADY HANDLES IT. AngularJS linked a column's `tg-loaded` BEFORE its cards';
 *     React runs child effects BEFORE the parent's. `../shared/useInViewport` absorbs
 *     the inversion by BUFFERING a card that arrives before its column and flushing it
 *     when the column registers. ⛔ Do not add an ordering workaround here -- just
 *     call the API. Cards are collected with `querySelectorAll('tg-card[data-id]')`,
 *     which is the same element-name idiom the source used (`$el.find("tg-card")`) and
 *     requires no change to the must-not-modify `./KanbanCard`.
 *     ⭐ `visibleIds` is a WRITE-ONCE MONOTONIC LATCH: only intersecting entries are
 *     recorded and an id, once visible, stays visible. ⛔ Never un-set it -- clearing
 *     on scroll-away would blank cards, which is a regression, not an optimisation.
 *     ⛔ `app/js/boards.js` is never imported: the toolchain has no `allowJs` and
 *     `app/js/**` must not be modified. The hook is the only route to that behaviour.
 *
 * 12. ⭐ THE WIP ARITHMETIC IS NOT RE-DERIVED HERE. `./WipLimitMarker` exports the
 *     pure helpers, and they are the single implementation with the single set of
 *     tests. This file only decides WHERE the returned index puts the element, which
 *     is where the incumbent's imperative `angular.element(element).after(…)` put it:
 *     immediately after the anchor card, as a SIBLING.
 *     The count fed to them is the number of cards this component RENDERS, because the
 *     incumbent counted `$el.find("tg-card")` -- the live DOM -- not a model
 *     collection. See {@link StatusColumnProps.count} for why that is not the same
 *     number as the counter's.
 *     ⭐ DRIFT REGISTER ENTRY D5 -- THE MARKER'S LABEL IS AN UNTRANSLATED LITERAL.
 *     Every other string this component renders goes through {@link TranslateFn}, but
 *     the marker's own label does not: `./WipLimitMarker` emits `<span>WIP Limit</span>`
 *     as a hardcoded English literal, faithfully reproducing the incumbent, which built
 *     the same literal into an interpolated HTML string --
 *     `angular.element(element).after("<div class='kanban-wip-limit #{wipLimitClass}'>
 *     <span>WIP Limit</span></div>")` at `app/coffee/modules/kanban/main.coffee` L888.
 *     Locale keys with this text DO exist nearby (`WIP_LIMIT_COLUMN`, `WIP_LIMITS`), so
 *     the omission is visible rather than inevitable -- but wiring one in would alter
 *     rendered copy and add a feature the incumbent lacks, which rule T10 forbids and
 *     which no Figma measurement licenses. Preserved as-is and NAMED here rather than
 *     silently resolved, per rule T6. Not actionable from this file in any case:
 *     `./WipLimitMarker` owns that markup and is must-not-modify.
 *
 * 13. ⭐ CONDITIONAL MOUNTING, NOT CLASS HIDING -- AND NO DUPLICATED HIDING.
 *     All five children are `ng-if` in the source, so each is ABSENT from the DOM
 *     rather than merely invisible, and that is reproduced. Conversely,
 *     `kanban-table.scss`'s `.vfold` block already hides `tg-card`,
 *     `.kanban-wip-limit`, `.card-placeholder` and `.kanban-column-intro` when the
 *     column is folded. ⛔ Do NOT add a `folded` condition to any of those: rendering
 *     what the source renders and letting the stylesheet hide it is the contract, and
 *     authoring behaviour a rule already provides is a compliance violation (G-DS-4).
 *
 * 14. ⚠ THE COLUMN'S APPEARANCE IS ANCESTOR-SCOPED. Every geometry and state rule for
 *     this element is nested under `.kanban-table-body` in the unedited stylesheet --
 *     the 4px radius, the 292px width, the 5px right margin, the scroll overflow, the
 *     `.new` animation and the `.target-drop` fill -- and the out-of-scope taskboard
 *     has a DIFFERENT `.target-drop` fill under `.taskboard-table-body`. The owner
 *     must therefore keep this component inside a `.kanban-table-body`, exactly as
 *     `kanban-table.jade` L107 and L184 do. Emit it elsewhere and the highlight
 *     silently renders in the taskboard's colour, or the column loses its width.
 *
 * 15. NO SERVICE, NO TRANSPORT, NO PERSISTENCE (T5 / I7 / I9). `useAngularService` is
 *     never called, no HTTP client is constructed, no realtime subscription is opened
 *     and `$rootScope.$apply()` is never invoked. Everything arrives as props,
 *     including the translator -- see {@link StatusColumnProps.translate}. That is
 *     what lets the whole cell be asserted in jsdom with no browser and no AngularJS
 *     injector (constraint HR-5).
 *
 * 16. LIGHT DOM ONLY (I6). No `attachShadow` anywhere. A shadow root would sever the
 *     single global stylesheet loaded at `app/index.jade:25` -- so `kanban-table.scss`
 *     and `card-placeholder.scss` would stop applying -- and would break
 *     `<use href="#icon-…">` against the sprite inlined at `app/index.jade:96`.
 *
 * 17. NO CSS IS AUTHORED, ANYWHERE, FOR THIS COMPONENT. Every value the design calls
 *     for is already in the unedited stylesheets: the 292px column and its 5px gutter,
 *     the 4px radius, the 36px folded rail, the counter's absolute top-right 32px box
 *     with its down-and-left shadow, the WIP rule's 260px span and its centred label
 *     knockout, and the 16px card insets. They are component geometry already encoded
 *     (gap G-DS-3), so no token is invented for them and no rule is re-authored
 *     (G-DS-4). There is no `.scss` file beside this one and no inline style in it.
 */

/* --------------------------------------------------------------------------
 * Translation keys, verbatim from the templates. Every string this cell shows is
 * resolved through the injected translator; no English is hardcoded and NO KEY IS
 * ADDED to any locale file.
 * -------------------------------------------------------------------------- */

/** `ng-attr-title="{{'KANBAN.NUMBER_US' | translate}}"` -- `kanban-table.jade` L124 / L200. */
const NUMBER_US_TITLE_KEY = 'KANBAN.NUMBER_US';

/** `kanban-placeholder.jade` L25-L26 -- the default, "still loading" placeholder. */
const PLACEHOLDER_CARD_TITLE_KEY = 'KANBAN.PLACEHOLDER_CARD_TITLE';
const PLACEHOLDER_CARD_TEXT_KEY = 'KANBAN.PLACEHOLDER_CARD_TEXT';

/** `kanban-placeholder.jade` L29-L31 -- the "no user stories matched" placeholder. */
const US_NOT_FOUND_TITLE_KEY = 'KANBAN.US_NOT_FOUND_TITLE';
const US_NOT_FOUND_TEXT_P1_KEY = 'KANBAN.US_NOT_FOUND_TEXT_P1';
const US_NOT_FOUND_TEXT_P2_KEY = 'KANBAN.US_NOT_FOUND_TEXT_P2';

/* --------------------------------------------------------------------------
 * Class names, verbatim from the templates and the stylesheets. Rule T1: nothing
 * renamed, nothing added, nothing dropped.
 * -------------------------------------------------------------------------- */

/** The two unconditional root classes -- `kanban-table.jade` L112 / L189. */
const ROOT_CLASS = 'kanban-uses-box';
const COLUMN_CLASS = 'taskboard-column';

/** `ng-class='{vfold: folds[s.id], vunfold: unfold == s.id}'` -- L113 / L190. */
const FOLDED_CLASS = 'vfold';
const UNFOLDED_CLASS = 'vunfold';

/** Applied by the retired drag library; now applied here. See seam note 9. */
const DROP_TARGET_CLASS = 'target-drop';
const NEW_CLASS = 'new';

/** The counter host -- L122 / L198. Styled at `kanban-table.scss` L580. */
const TASK_COUNTER_CLASS = 'kanban-task-counter';

/** The placeholder host and its "nothing matched" variant -- L144-L148 / L220-L224. */
const CARD_PLACEHOLDER_CLASS = 'card-placeholder';
const NOT_FOUND_CLASS = 'not-found';

/**
 * The card host tag, as an ELEMENT-NAME selector.
 *
 * ⭐ Deliberately the same idiom the source used -- `$el.find("tg-card")` in
 * `KanbanWipLimitDirective`, and dragula's `$(item).is('tg-card')` eligibility test.
 * `[data-id]` is appended because the virtualisation registry reads
 * `entry.target.dataset.id`, and an element without it yields `NaN`, at which point
 * virtualisation silently never fires. `./KanbanCard` always emits both the tag and
 * the attribute, so this selector matches every rendered card.
 */
const CARD_ELEMENT_SELECTOR = 'tg-card[data-id]';

/**
 * A class-list entry: a class name, or `false` where the class is not applied.
 *
 * Hand-written rather than a dependency, because the package set is CLOSED at fifteen
 * (constraint HR-2), so `classnames`/`clsx` are unavailable -- and unnecessary for one
 * call site. The same three-line helper appears in `./StatusColumnHeader` and
 * `./KanbanCard`; each file keeps its own rather than a shared utility being invented
 * for it.
 */
type ClassNameCandidate = string | false;

/**
 * Joins a class list in emission order, dropping every unapplied entry.
 *
 * @param candidates - the class names in emission order, `false` where not applied.
 * @returns a space-separated `class` attribute value, never with a stray space.
 */
function classNames(...candidates: readonly ClassNameCandidate[]): string {
    return candidates
        .filter((candidate): candidate is string => candidate !== false)
        .join(' ');
}

/* ==========================================================================
 * THE CARD CONTRACT, SPLIT THE WAY THE SOURCE SPLITS IT
 * ========================================================================== */

/**
 * The card props whose value differs PER USER STORY, resolved upstream.
 *
 * These are exactly the bindings the AngularJS card DIRECTIVES resolved before their
 * templates ran -- `item="usMap.get(usId)"`, `archived="ctrl.isUsInArchivedHiddenStatus(usId)"`,
 * and the due-date and attachment locals `CardDataDirective` built from
 * `tgDueDateService` -- so one record per card id keeps the mapping one-for-one.
 *
 * Derived from {@link KanbanCardProps} with `Pick` rather than restated, so it cannot
 * drift from the card's own contract and `./KanbanCard` stays unmodified.
 */
type StatusColumnCardDetail = Pick<
    KanbanCardProps,
    'item' | 'archived' | 'dueDateColor' | 'dueDateTitle' | 'totalAttachments'
>;

/**
 * The card props that are the SAME for every card in this column, threaded straight
 * through unchanged: `project`, `zoom`, `zoomLevel`, `type`, `permissions`, the
 * resolved avatar set, the link params, and the `on-*` callbacks.
 *
 * Everything this component computes or overrides itself is removed:
 *
 *   - {@link StatusColumnCardDetail}'s five per-card values;
 *   - `inViewPort`, which comes from the virtualisation latch;
 *   - `isFirst`, which is the repeat's `$first`;
 *   - `selected` and `moved`, which come from the two board-state slices;
 *   - `onClickMoveToTop`, hoisted to its own prop so flat mode can simply not forward
 *     it (seam note 5);
 *   - `translate`, hoisted so there is exactly ONE translator prop on this component
 *     rather than two that could disagree;
 *   - `folded`, which the board's markup NEVER binds -- neither `kanban-table.jade`
 *     call site passes it, so it is removed rather than left available to a caller who
 *     might start passing it and change the card's rest state (rule T10).
 */
type StatusColumnCardProps = Omit<
    KanbanCardProps,
    | keyof StatusColumnCardDetail
    | 'inViewPort'
    | 'isFirst'
    | 'selected'
    | 'moved'
    | 'onClickMoveToTop'
    | 'translate'
    | 'folded'
>;

/** One card that has both an id and a resolved detail record, so it can be rendered. */
interface RenderableCard {
    readonly usId: number;

    readonly detail: StatusColumnCardDetail;
}

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface StatusColumnProps {
    /**
     * The user-story status this cell belongs to.
     *
     * ⚠ ONE `Status` shape serves all three roles this board needs -- column, header
     * and swimlane cell -- so there is deliberately no `ColumnStatus` variant, and the
     * must-not-modify `../shared/types/status` is consumed unchanged.
     *
     * ⭐ `wip_limit` is `number | null` and a `0` is FALSY. It is passed through
     * UNCHANGED, so `./TaskCounter` renders a bare count with no `wip-amount` class
     * (drift entry D13) and the WIP helpers see the real value. Coercing `0` to `null`
     * -- or to `1` -- would change what the counter shows.
     */
    readonly status: Status;

    /**
     * The swimlane this cell belongs to, or `undefined` in FLAT mode.
     *
     * ⭐ MUST be `undefined` in flat mode -- never `0` and never `null`. See seam
     * note 3: the registry discriminates the two modes by truthiness, and `-1` (the
     * synthetic unclassified swimlane) is truthy and correctly takes the swimlane path.
     */
    readonly swimlaneId?: number;

    /**
     * The ids of the cards in this cell, in render order.
     *
     * Resolved upstream from `usByStatus` (flat, STRING key) or `usByStatusSwimlanes`
     * (swimlane, NUMERIC path) -- see seam note 4.
     */
    readonly cardIds: readonly number[];

    /**
     * The size of that same collection, as the counter displays it.
     *
     * ⭐ NOT INTERCHANGEABLE WITH `cardIds.length`, and deliberately a separate prop.
     * The source binds the counter to the collection's `.size` (`kanban-table.jade`
     * L128 / L204) while the WIP marker counts the RENDERED elements with
     * `$el.find("tg-card")`. The two agree in every real projection, but they are
     * different measurements of different things, and substituting one for the other
     * is how the "DO NOT NORMALISE" rule in seam note 4 gets broken by accident.
     */
    readonly count: number;

    /** `folds[status.id]` -- whether this status's column is folded. */
    readonly folded: boolean;

    /**
     * `unfold === status.id` -- whether this status is the most recently UNFOLDED one.
     *
     * ⭐ `unfold` holds AT MOST ONE status id: `foldStatus` resets it to `null` on
     * every toggle and only then sets it, for the unfold direction alone
     * (`app/coffee/modules/kanban/main.coffee`, `KanbanSquishColumnDirective`). The
     * resulting `vunfold` class drives the one-shot unfold animation, which is why it
     * must not be sticky.
     */
    readonly unfolded: boolean;

    /**
     * `ctrl.renderInProgress` -- suppresses the counter's roll animation during a bulk
     * re-render (`kanban-table.jade` L127 / L203). Forwarded to `./TaskCounter` as
     * `disabled`.
     */
    readonly renderInProgress: boolean;

    /**
     * `ctrl.showPlaceHolder(s.id[, swimlane.id])` -- already evaluated.
     *
     * The predicate is "this is the FIRST status and there are no user stories at all",
     * plus "and this is the FIRST swimlane" in swimlane mode. Its arity differs between
     * the two modes, which is one of the five flat-vs-swimlane differences; it is
     * resolved upstream so this component takes one boolean either way.
     */
    readonly showPlaceholder: boolean;

    /**
     * `ctrl.notFoundUserstories` -- selects the placeholder's second, mutually
     * exclusive branch AND adds `not-found` to the placeholder host. ONE flag drives
     * both, exactly as in the source.
     */
    readonly notFound: boolean;

    /**
     * Whether a drag is currently hovering this column as a DIFFERENT container from
     * the one it started in. Applies `target-drop`. See seam note 9 for the
     * `container !== initialContainer` rule that decides it, which is resolved
     * upstream because it needs the single per-drag `initialContainer`.
     */
    readonly isDropTarget: boolean;

    /**
     * Whether a drop just landed in this column, having started elsewhere. Raising it
     * adds the transient `new` class; the element's own `animationend` removes it once
     * and reports back through {@link StatusColumnProps.onNewAnimationEnd}. See seam
     * note 10.
     */
    readonly justDropped: boolean;

    /**
     * Reports that the `new` flash has finished, so the owner can clear its
     * `justDropped` flag. Optional: an owner that never sets `justDropped` never needs
     * it, and the imperative drag path does its own bookkeeping.
     */
    readonly onNewAnimationEnd?: () => void;

    /**
     * The BOARD'S virtualisation API, created once by `../shared/useInViewport` at the
     * board level and threaded down. This cell registers itself as an observer root
     * and registers its rendered cards as targets. See seam note 11.
     */
    readonly inViewport: InViewportApi;

    /**
     * The OWNER'S translator, used for the counter's title and the placeholder's five
     * strings.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE, AND REQUIRED. Calling `useTranslate()` in this
     * file would resolve `$translate` through the bridge injector and THROW wherever no
     * `AngularBridgeProvider` is mounted above it, giving the board's most-repeated
     * container a latent AngularJS provider requirement and destroying the
     * presentational/container split that requirement I9's coverage gate depends on.
     * Every leaf on these screens already follows this pattern -- `./ArchivedColumn`
     * and `./StatusColumnHeader` (required), `../shared/Svg` (optional, because an icon
     * title is optional). It is also the only coherent reading of the card contract:
     * `./KanbanCard` REQUIRES a translator of its own, so resolving a second one here
     * would put two translators on one subtree.
     *
     * REQUIRED rather than optional because a raw key leaking into a tooltip or a
     * placeholder paragraph is a silent regression, whereas a missing required prop is
     * a compile error the owner cannot ignore.
     */
    readonly translate: TranslateFn;

    /**
     * The per-card values, keyed by user-story id. A card id with no entry is NOT
     * rendered -- see {@link UnmemoizedStatusColumn}'s renderable-card note.
     */
    readonly cardDetails: Readonly<Record<number, StatusColumnCardDetail | undefined>>;

    /** Everything else the cards need, threaded straight through unchanged. */
    readonly cardProps: StatusColumnCardProps;

    /**
     * `ctrl.selectedUss` -- drives `kanban-task-selected` and
     * `ui-multisortable-multiple` on each card.
     *
     * Typed by indexed access on the reducer's own state so it can never drift from
     * `./state`, which is what produces it.
     */
    readonly selectedUss: KanbanBoardState['selectedUss'];

    /**
     * `ctrl.movedUs` -- drives `kanban-moved`.
     *
     * ⭐ SWIMLANE MODE ONLY. In flat mode this component forces the card's `moved` to
     * `false` regardless of what is passed, because the flat markup has no
     * `kanban-moved` binding at all (seam note 5).
     */
    readonly movedUs: KanbanBoardState['movedUs'];

    /**
     * `on-click-move-to-top="ctrl.moveToTopDropdown(usMap.get(usId))"` -- SWIMLANE MODE
     * ONLY (`kanban-table.jade` L160; the flat twin omits it). Hoisted out of
     * {@link StatusColumnCardProps} precisely so that flat mode can decline to forward
     * it without the owner having to remember to.
     */
    readonly onClickMoveToTop?: (id: number) => void;

    /**
     * Forwarded to `./ArchivedColumnIntro`, which reports the archived status whose
     * intro has mounted -- the React form of the listener
     * `tg-kanban-archived-status-intro="s"` registered (`kanban-table.jade` L174).
     */
    readonly onIntroShown?: (statusId: number) => void;
}

/* ==========================================================================
 * THE PLACEHOLDER
 * ========================================================================== */

/**
 * `div.card-placeholder` and the body `ng-include` pulled into it.
 *
 * Module-local and not exported: it is a sub-block of the cell, never mounted on its
 * own, and the in-repo precedent for a sub-block is exactly that (`ArchivedLabel` in
 * `./ArchivedColumn`).
 *
 * The host element comes from `kanban-table.jade` L144-L148 (swimlane) and L220-L224
 * (flat), which are byte-identical apart from `showPlaceHolder`'s arity. The body is
 * `app/partials/common/components/kanban-placeholder.jade` L8-L31, transcribed inline
 * because React has no include mechanism -- seam note 6.
 *
 * ⭐ TWO MUTUALLY EXCLUSIVE BRANCHES, ONE FLAG. The source declares them as two
 * sibling `ng-container(ng-if=…)` blocks on `!ctrl.notFoundUserstories` and
 * `ctrl.notFoundUserstories`, and they are written the same way here -- two gated
 * siblings rather than a ternary -- so the transliteration stays line-for-line
 * checkable against the source. Each `ng-container` becomes a FRAGMENT: drift entry
 * D16, seam note 7.
 *
 * The skeleton divs are intentionally empty. They are pure shape -- every dimension,
 * fill and radius is already declared by the unedited
 * `app/styles/components/card-placeholder.scss`, so there is nothing to put inside
 * them and nothing to author for them.
 */
function CardPlaceholder({
    notFound,
    translate,
}: {
    readonly notFound: boolean;
    readonly translate: TranslateFn;
}): ReactElement {
    return (
        <div className={classNames(CARD_PLACEHOLDER_CLASS, notFound && NOT_FOUND_CLASS)}>
            {!notFound ? (
                <>
                    <div className="placeholder-board-card">
                        <div className="placeholder-board-row">
                            <div className="placeholder-board-text small" />
                            <div className="placeholder-board-text big" />
                        </div>
                        <div className="placeholder-board-row">
                            <div className="placeholder-board-text" />
                        </div>
                        <div className="placeholder-board-row avatar">
                            <div className="placeholder-board-avatar" />
                            <div className="placeholder-board-user" />
                        </div>
                    </div>
                    <div className="placeholder-titles">
                        <div className="text-small" />
                        <div className="text-large" />
                    </div>
                    <div className="placeholder-avatar">
                        <div className="image" />
                        <div className="text" />
                    </div>

                    <p className="title">{translate(PLACEHOLDER_CARD_TITLE_KEY)}</p>
                    <p>{translate(PLACEHOLDER_CARD_TEXT_KEY)}</p>
                </>
            ) : null}

            {notFound ? (
                <>
                    <p className="title">{translate(US_NOT_FOUND_TITLE_KEY)}</p>
                    <p>{translate(US_NOT_FOUND_TEXT_P1_KEY)}</p>
                    <p>{translate(US_NOT_FOUND_TEXT_P2_KEY)}</p>
                </>
            ) : null}
        </div>
    );
}

/* ==========================================================================
 * THE CELL
 * ========================================================================== */

/**
 * One Kanban status column cell. Memoised at the bottom of the file; this is the
 * unmemoised render function.
 *
 * A pure function of its props except for two narrowly-scoped DOM effects -- the
 * sticky counter (seam note 8) and the virtualisation registration (seam note 11) --
 * plus the one-shot `new` flash (seam note 10). No service, no transport, no
 * persistence, no realtime (seam note 15).
 */
function UnmemoizedStatusColumn(props: StatusColumnProps): ReactElement {
    const {
        status,
        swimlaneId,
        cardIds,
        count,
        folded,
        unfolded,
        renderInProgress,
        showPlaceholder,
        notFound,
        isDropTarget,
        justDropped,
        onNewAnimationEnd,
        inViewport,
        translate,
        cardDetails,
        cardProps,
        selectedUss,
        movedUs,
        onClickMoveToTop,
        onIntroShown,
    } = props;

    const statusId: number = status.id;

    /*
     * ⭐ THE MODE DISCRIMINATOR, IN ONE PLACE. Everything that differs between the two
     * source variants keys off this: the `data-swimlane` attribute, the `kanban-moved`
     * class and the move-to-top handler. Seam notes 2, 3 and 5.
     */
    const isSwimlaneMode: boolean = swimlaneId !== undefined;

    /** The scroll host and the observer root -- both are this element. */
    const columnRef = useRef<HTMLDivElement | null>(null);

    /** The sticky counter, absent while the column is folded. */
    const counterRef = useRef<HTMLDivElement | null>(null);

    /*
     * The virtualisation callbacks are destructured so the effects below depend on the
     * STABLE functions rather than on the API object, whose identity changes every time
     * a card latches visible. Depending on the object would tear down and re-establish
     * every registration on each latch.
     */
    const { visibleIds, registerColumn, unregisterColumn, registerCard, unregisterCard } =
        inViewport;

    /* ----------------------------------------------------------------------
     * The cards this cell will actually render
     * -------------------------------------------------------------------- */

    /**
     * ⭐ A CARD ID WITH NO RESOLVED DETAIL IS SKIPPED, and that is deliberate.
     *
     * The source's `item="usMap.get(usId)"` tolerated a miss: AngularJS expressions are
     * null-safe, so a card whose model had not arrived rendered as a mostly-empty
     * element. `./KanbanCard` requires `item`, so the equivalent here is to not render
     * that card at all rather than to throw and take the board down with it. The two
     * lists are identical whenever the upstream projection is consistent -- `cardIds`
     * and `cardDetails` are built from the same collection -- so this is a defensive
     * guard, not a behaviour.
     *
     * It also gives the WIP arithmetic the right number: the incumbent counted
     * `$el.find("tg-card")`, i.e. the cards actually in the DOM, so the count must be
     * the length of THIS list and not of `cardIds`. Seam note 12.
     */
    const renderableCards: readonly RenderableCard[] = useMemo(
        (): readonly RenderableCard[] =>
            cardIds
                .map((usId: number): RenderableCard | null => {
                    const detail: StatusColumnCardDetail | undefined = cardDetails[usId];

                    return detail === undefined ? null : { usId, detail };
                })
                .filter((entry): entry is RenderableCard => entry !== null),
        [cardIds, cardDetails],
    );

    /**
     * A primitive identity for the rendered card list, so the registration effect
     * re-runs when the cards change and not merely when the owner re-renders with a
     * fresh array.
     */
    const cardIdsKey: string = useMemo(
        (): string => renderableCards.map((entry: RenderableCard): number => entry.usId).join(','),
        [renderableCards],
    );

    /* ----------------------------------------------------------------------
     * WIP-limit marker placement -- seam note 12
     * -------------------------------------------------------------------- */

    const cardCount: number = renderableCards.length;
    const wipLimit: number | null = status.wip_limit;

    /*
     * The helper owns the whole ladder AND both gates -- the archived-status gate
     * (`if status and not status.is_archived` in the retired directive) and the
     * null-limit gate -- and it also validates that the resolved anchor addresses a
     * card that exists, so a limit of zero or an empty column resolves to no marker.
     * ⛔ Never re-derive any of that here: one implementation, one set of tests.
     */
    const wipState: WipLimitState | undefined = resolveWipLimitState(
        cardCount,
        wipLimit,
        status.is_archived,
    );

    /*
     * `-1` means "no marker", which no card index can equal, so the render below needs
     * no second condition. When a state resolved, the limit is necessarily non-null --
     * the narrowing is written out rather than asserted, because `strict` is on and a
     * non-null assertion would hide a real contract change if the helper ever altered
     * its gates.
     */
    const wipMarkerIndex: number =
        wipState !== undefined && wipLimit !== null
            ? resolveWipLimitIndex(cardCount, wipLimit, wipState)
            : -1;

    /* ----------------------------------------------------------------------
     * The transient `new` flash -- seam notes 9 and 10
     * -------------------------------------------------------------------- */

    const [isFlashingNew, setIsFlashingNew] = useState<boolean>(false);

    /*
     * A ref mirror of the flag above, so `handleAnimationEnd` can enforce "exactly
     * once" -- jQuery's `.one()` -- while staying referentially stable. Reading the
     * state variable instead would rebuild the handler on every flash.
     */
    const isFlashingNewRef = useRef<boolean>(false);

    /*
     * The callback is held in a ref for the same reason `./ArchivedColumnIntro` holds
     * its own: the handler must not be rebuilt when a parent re-renders with a fresh
     * closure, and capturing the first closure for ever would call a stale one.
     */
    const onNewAnimationEndRef = useRef<StatusColumnProps['onNewAnimationEnd']>(onNewAnimationEnd);

    useEffect((): void => {
        onNewAnimationEndRef.current = onNewAnimationEnd;
    }, [onNewAnimationEnd]);

    /*
     * EDGE-TRIGGERED, not level-triggered. The class is added when `justDropped` RISES;
     * because the dependency list is the flag itself, a re-render while it stays raised
     * does not re-add the class after the animation has already ended. That is what
     * makes the flash happen once per drop rather than once per render.
     */
    useEffect((): void => {
        if (!justDropped) {
            return;
        }

        isFlashingNewRef.current = true;
        setIsFlashingNew(true);
    }, [justDropped]);

    const handleAnimationEnd = useCallback((): void => {
        if (!isFlashingNewRef.current) {
            return;
        }

        isFlashingNewRef.current = false;
        setIsFlashingNew(false);
        onNewAnimationEndRef.current?.();
    }, []);

    /* ----------------------------------------------------------------------
     * The sticky task counter -- seam note 8
     * -------------------------------------------------------------------- */

    const handleScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
        const counter: HTMLDivElement | null = counterRef.current;

        /*
         * Absent while the column is folded, in which case the incumbent's
         * `$el.find(".kanban-task-counter")` matched nothing and `.css()` was a no-op on
         * an empty jQuery set. Same outcome, without querying the document -- which
         * would find a sibling column's counter, because the ids are duplicated
         * (seam note 1).
         */
        if (counter === null) {
            return;
        }

        counter.style.transform = `translateY(${event.currentTarget.scrollTop}px)`;
    }, []);

    /* ----------------------------------------------------------------------
     * Virtualisation registration -- seam note 11
     * -------------------------------------------------------------------- */

    /** `taskColumnLoaded($event, s.id[, swimlane.id])` → `board.addSwimlane(column, …)`. */
    useEffect((): (() => void) | undefined => {
        const column: HTMLDivElement | null = columnRef.current;

        if (column === null) {
            return undefined;
        }

        registerColumn(column, statusId, swimlaneId);

        return (): void => {
            unregisterColumn(statusId, swimlaneId);
        };
    }, [registerColumn, unregisterColumn, statusId, swimlaneId]);

    /**
     * `cardLoaded($event, s.id[, swimlane.id])` → `board.addCard(card, …)`.
     *
     * The elements are collected from the DOM rather than reported by the cards, which
     * is both the source's own idiom and the reason `./KanbanCard` needs no change:
     * adding a callback-ref prop to it would edit a must-not-modify file for no gain.
     * The captured list is what the cleanup unregisters, so a card removed from the
     * board is always unregistered with the node that was actually observed.
     */
    useEffect((): (() => void) | undefined => {
        const column: HTMLDivElement | null = columnRef.current;

        if (column === null) {
            return undefined;
        }

        const cards: readonly HTMLElement[] = Array.from(
            column.querySelectorAll<HTMLElement>(CARD_ELEMENT_SELECTOR),
        );

        cards.forEach((card: HTMLElement): void => {
            registerCard(card, statusId, swimlaneId);
        });

        return (): void => {
            cards.forEach((card: HTMLElement): void => {
                unregisterCard(card, statusId, swimlaneId);
            });
        };
        // `cardIdsKey` is the primitive identity of the rendered card list; the elements
        // themselves are read from the DOM inside the effect.
    }, [registerCard, unregisterCard, statusId, swimlaneId, cardIdsKey]);

    /* ----------------------------------------------------------------------
     * Render
     * -------------------------------------------------------------------- */

    /*
     * `ng-class='{vfold: folds[s.id], vunfold: unfold == s.id}'` plus the two classes
     * the retired drag library used to apply (seam note 9), in emission order.
     */
    const rootClassName: string = classNames(
        ROOT_CLASS,
        COLUMN_CLASS,
        folded && FOLDED_CLASS,
        unfolded && UNFOLDED_CLASS,
        isDropTarget && DROP_TARGET_CLASS,
        isFlashingNew && NEW_CLASS,
    );

    return (
        <div
            ref={columnRef}
            className={rootClassName}
            /*
             * Duplicated across swimlanes on purpose -- seam note 1.
             */
            id={`column-${statusId}`}
            data-status={statusId}
            /*
             * Swimlane mode only: react-dom omits an attribute whose value is
             * `undefined`, so flat mode emits no `data-swimlane` at all -- seam note 2.
             */
            data-swimlane={swimlaneId}
            onScroll={handleScroll}
            onAnimationEnd={handleAnimationEnd}
        >
            {/*
             * 1. The task counter -- `kanban-table.jade` L122-L129 / L198-L205.
             * Mounted only while the column is UNFOLDED, exactly as `ng-if='!folds[s.id]'`
             * does; the folded column shows the collapsed rail instead.
             */}
            {!folded ? (
                <div
                    ref={counterRef}
                    className={TASK_COUNTER_CLASS}
                    title={translate(NUMBER_US_TITLE_KEY)}
                >
                    <TaskCounter
                        count={count}
                        wip={status.wip_limit}
                        disabled={renderInProgress}
                    />
                </div>
            ) : null}

            {/*
             * 2. The collapsed rail -- L130-L142 / L206-L218.
             * ⭐ Gated on the FOLD, NOT on `is_archived`: it renders for ANY folded
             * column, and the archived-versus-ordinary split (the vertical counter and
             * the "archived" label) happens INSIDE `./ArchivedColumn`.
             */}
            {folded ? (
                <ArchivedColumn status={status} count={count} translate={translate} />
            ) : null}

            {/*
             * 3. The placeholder -- L144-L148 / L220-L224.
             */}
            {showPlaceholder ? (
                <CardPlaceholder notFound={notFound} translate={translate} />
            ) : null}

            {/*
             * 4. The cards, with the WIP-limit marker interleaved as a SIBLING
             * immediately after the anchor card -- L150-L170 / L226-L245, and seam
             * note 12 for the placement.
             *
             * Keyed by user-story id, never by array index: the ids are what
             * `track by` used, and an index key would make React reuse the wrong card's
             * DOM node when a card is inserted or moved -- which, because the drag layer
             * decorates those nodes imperatively, would carry a stale drag class onto a
             * different story.
             */}
            {renderableCards.map(
                ({ usId, detail }: RenderableCard, index: number): ReactElement => (
                    <Fragment key={usId}>
                        <KanbanCard
                            {...cardProps}
                            {...detail}
                            translate={translate}
                            isFirst={index === 0}
                            selected={Boolean(selectedUss[usId])}
                            /*
                             * `kanban-moved` is SWIMLANE MODE ONLY -- seam note 5. In flat
                             * mode this is `false` however the owner populates `movedUs`.
                             */
                            moved={isSwimlaneMode && movedUs.includes(usId)}
                            /*
                             * The write-once visibility latch -- seam note 11. Coerced
                             * because the record only ever holds `true`, so a missing id
                             * reads as `undefined` where the card wants a boolean.
                             */
                            inViewPort={Boolean(visibleIds[usId])}
                            /*
                             * Swimlane mode only -- seam note 5. Passing `undefined` is
                             * how the flat call site's omission is expressed: the prop is
                             * optional on the card and reaching it is the popover's job,
                             * so there is nothing for an absent handler to break.
                             */
                            onClickMoveToTop={isSwimlaneMode ? onClickMoveToTop : undefined}
                        />

                        {index === wipMarkerIndex && wipState !== undefined ? (
                            <WipLimitMarker state={wipState} />
                        ) : null}
                    </Fragment>
                ),
            )}

            {/*
             * 5. The archived-status intro -- L172-L175 / L247-L250. ALWAYS LAST.
             * The gate is reproduced at this call site because that is where the source
             * declares it (`ng-if="s.is_archived"`); `./ArchivedColumnIntro` reproduces
             * the same gate internally, and the two agree because they are the same
             * condition.
             * ⛔ The gate is on `is_archived` ALONE and must never grow a folded
             * condition: `.vfold .kanban-column-intro { display: none }` already hides
             * it through CSS (seam note 13).
             */}
            {status.is_archived ? (
                <ArchivedColumnIntro status={status} onIntroShown={onIntroShown} />
            ) : null}
        </div>
    );
}

/*
 * Memoised, and NOT as a performance ornament.
 *
 * The board re-renders every cell whenever any card moves or any id latches visible,
 * and `../shared/dnd` decorates this very element imperatively while a gesture is in
 * flight (seam note 9). The memo boundary, fed the props the board already holds, is
 * what keeps an in-flight column from re-rendering and stripping a class the drag layer
 * owns. The default shallow comparison is the correct one: every prop is a primitive,
 * a frozen state slice, a plain object the bridge hands over, or a callback the owner
 * is expected to keep stable.
 */
const StatusColumn = memo(UnmemoizedStatusColumn);
StatusColumn.displayName = 'StatusColumn';

export { StatusColumn };

// `isolatedModules` requires `export type` for a type-only export.
export type { StatusColumnProps, StatusColumnCardProps, StatusColumnCardDetail };
