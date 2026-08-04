/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import type { Status } from '../shared/types/status';
/*
 * ⚠ NAME COLLISION, RESOLVED BY ALIAS. The DATA MODEL and this COMPONENT are both
 * called `Swimlane`. The model is aliased on import so the component keeps the name
 * its owner imports it by -- `./KanbanBoard` does `import { Swimlane } from
 * './Swimlane'` -- and so no reader can mistake one for the other inside this file.
 * ⛔ Do NOT rename the component to resolve this; rename the import, as here.
 */
import type { Swimlane as SwimlaneModel } from '../shared/types/swimlane';
import { StatusColumn } from './StatusColumn';
import type { StatusColumnProps } from './StatusColumn';
import { SwimlaneHeader } from './SwimlaneHeader';

/* ==========================================================================
 * ONE SWIMLANE ROW OF THE KANBAN BOARD
 * ==========================================================================
 *
 * The React replacement for `app/partials/includes/modules/kanban-table.jade`
 * L73-L110: one `.kanban-swimlane` row, made of a title bar and a collapsible body
 * of status columns. The `ng-if="swimlanesList.size"` and the
 * `tg-repeat="swimlane in swimlanesList track by swimlane.id"` that produced one of
 * these per swimlane stay with the OWNER (`./KanbanBoard`), so this file renders
 * exactly ONE row and takes its swimlane, its statuses and its state as props.
 *
 * The rendered shape is, verbatim:
 *
 * ```html
 * <div class="kanban-swimlane" data-swimlane="7">
 *     <button class="kanban-swimlane-title">…</button>   <!-- ./SwimlaneHeader -->
 *     <div class="kanban-table-body">                    <!-- conditionally mounted -->
 *         <div class="kanban-table-inner">
 *             <div class="kanban-uses-box taskboard-column" …>…</div>  <!-- ×N -->
 *         </div>
 *     </div>
 * </div>
 * ```
 *
 * ⭐⭐ THIS FILE OWNS THE ngANIMATE CLASS CONTRACT (design-system gap G-DS-1), which
 * is the ONLY AngularJS coupling anywhere in the 1,870 lines of in-scope Sass. Seam
 * note 3 specifies it in full. If it is wrong,
 * `app/styles/modules/kanban/kanban-table.scss` needs edits -- and rule T1 forbids
 * editing it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEAM NOTES (rule T9 -- every technology-specific decision, documented at the point
 * of change; this file carries the folder's highest comment obligation, and the short
 * form of each note is repeated at its call site below)
 *
 * 1. ⭐⭐ THE HEADER AND THE BODY ARE SIBLINGS, NOT NESTED, AND THE ORDER IS FIXED.
 *    `kanban-table.jade` L79 opens `button.kanban-swimlane-title` and L107 opens
 *    `div.kanban-table-body` at the SAME indentation -- both are direct children of
 *    the `.kanban-swimlane` div opened at L73. Three separate things break if the
 *    header is nested inside the body:
 *      (a) the fold animation would animate the header away with the body, so the
 *          swimlane would have nothing left to click to reopen it;
 *      (b) `.kanban-swimlane-title { position: sticky; top: 36px }`
 *          (`kanban-table.scss:414`-`:426`) would become sticky inside a
 *          `max-height`-animated ancestor instead of inside the scrolling board;
 *      (c) `.kanban-swimlane { display: flex; flex-direction: column }` (`:596`-`:598`)
 *          expects exactly two flex children in this order.
 *    Independently measured on the design reference: the swimlane row has exactly two
 *    children, title band then body, with 0 px gap between them and 0 padding around
 *    them -- `band_bottom + 1 == body_top` in all five swimlanes.
 *
 * 2. ⭐ `data-swimlane` IS LOAD-BEARING, NOT DECORATION. The drag layer resolves this
 *    swimlane's drop containers with
 *    `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column`
 *    (`app/coffee/modules/kanban/sortable.coffee:34`, reproduced verbatim by
 *    `./hooks/useCardDrag`'s `openSwimlane`). ⛔ Omitting or renaming the attribute
 *    makes every card in this swimlane undroppable, silently -- there is no error, the
 *    cards simply refuse to accept a drop. The same is true of the class name
 *    `kanban-swimlane`, which is the other half of that selector (rule T1).
 *
 * 3. ⭐⭐⭐ G-DS-1 -- THE ngANIMATE CLASS CONTRACT. THE REASON THIS FILE EXISTS.
 *
 *    In the incumbent, `div.kanban-table-body` is governed by `ng-if`
 *    (`kanban-table.jade` L108), and **ngAnimate** -- registered at
 *    `app/coffee/app.coffee:1098` and bundled at `gulpfile.js:173`, so the animation
 *    is real and library-driven -- adds and removes six classes around that
 *    insertion and removal. React does not participate in that lifecycle at all. The
 *    mandate is therefore to reproduce the CLASS CONTRACT, not the library, so that
 *    `app/styles/modules/kanban/kanban-table.scss` L549-L575 applies VERBATIM and
 *    needs ZERO EDITS.
 *
 *    The contract, quoted from that stylesheet (inside `.kanban-table-swimlane`, so
 *    the two-class selector wins over the one-class base block at `:217`-`:224`):
 *
 *    ```scss
 *    .kanban-table-body { max-height: 56vh; min-height: 180px; overflow: visible; }
 *
 *    &.ng-move, &.ng-enter, &.ng-leave                                { transition: all linear .5s; }
 *    &.ng-leave.ng-leave-active, &.ng-move, &.ng-enter                { max-height: 0; min-height: 0; opacity: 0; }
 *    &.ng-leave, &.ng-move.ng-move-active, &.ng-enter.ng-enter-active { max-height: 524px; min-height: 0; opacity: 1; … }
 *    ```
 *
 *    Read as a state machine, that is: `0.5s linear`, with `max-height` moving
 *    between `0` and `524px`, `opacity` between `0` and `1`, and -- easy to miss and
 *    NOT optional -- `min-height` moving between its `180px` rest value and `0`
 *    WHILE ANIMATING. All three properties are animated; dropping the `min-height`
 *    leg would leave a collapsing body stuck 180 px tall.
 *
 *    ENTER, when the swimlane is unfolded: mount the body carrying `ng-enter`; on the
 *    NEXT ANIMATION FRAME add `ng-enter-active`; after 500 ms remove BOTH, so the
 *    at-rest parent block applies again and the body can grow past 524 px to its
 *    `56vh` bound.
 *
 *    LEAVE, when the swimlane is folded: ⭐⭐ React's natural behaviour is to unmount
 *    the body in the same commit, which would skip the animation ENTIRELY -- the body
 *    would simply vanish. So the body is DELIBERATELY KEPT MOUNTED: it gets
 *    `ng-leave`, then `ng-leave-active` one frame later, and it is unmounted only
 *    after the full 500 ms has elapsed. That deferred unmount is the whole reason
 *    this component holds animation state at all.
 *
 *    CANCELLATION: reopening a swimlane mid-leave cancels the pending unmount and
 *    restarts the enter sequence; folding one mid-enter switches to the leave
 *    sequence. Every timer and frame handle lives in the effect that scheduled it, so
 *    a phase change or an unmount cancels it through ordinary effect cleanup -- no
 *    orphaned timer can ever write a class onto a detached node.
 *
 *    ⭐ WHY THE `-active` CLASS NEEDS A SEPARATE ANIMATION FRAME. Applying both
 *    classes in the same frame produces NO TRANSITION AT ALL: the browser never
 *    computes a style for the pre-transition state, so there is nothing to
 *    interpolate from. That is the classic failure of hand-rolled CSS transitions.
 *    The frame boundary is one half of the fix; the other half is that the frame
 *    callback FORCES A REFLOW on the body before the `-active` class is written --
 *    which is exactly what ngAnimate itself does (`$$forceReflow`), and is what makes
 *    ONE frame sufficient rather than needing a double-frame dance.
 *
 *    ⭐⭐ AND THE FROM-STATE ITSELF MUST NOT ANIMATE -- THE TRANSITION BLOCK. The
 *    class schedule alone is NOT sufficient for fidelity. Because the stylesheet
 *    introduces the transition in the same rule as the from-state, the browser also
 *    transitions the step INTO the from-state, so the body would collapse from its
 *    resting `56vh` ceiling instead of from the declared `524px` -- same duration,
 *    same endpoints, visibly different shape. Runtime capture of the incumbent proves
 *    it snaps instead: `max-height: 524px` ~8 ms after the click, and `261.964px` at
 *    t = 256 ms, exactly half of a 524 -> 0 ramp. ngAnimate suppresses that first step
 *    with a negative `transition-delay` and so does this component, in the same commit
 *    as the from-state class and removed in the same commit as the `-active` class.
 *    See {@link BLOCKED_TRANSITION_STYLE} and {@link resolveBodyStyle}.
 *
 *    ⭐ `ng-animate`, `ng-enter-prepare` and `ng-leave-prepare` ARE NOT REPRODUCED.
 *    The incumbent's observed sequence also carries these three transient ngAnimate
 *    bookkeeping classes (`+ng-leave-prepare`, `+ng-animate`, `-ng-leave-prepare`,
 *    `+ng-leave`, `+ng-leave-active`). They are omitted deliberately, on evidence: the
 *    only two `.ng-animate` selectors in the whole stylesheet set are
 *    `body .master.ng-animate` (`app/styles/core/base.scss:23`) and
 *    `.taskboard-table-body:not(.moving) .ng-animate`
 *    (`app/styles/modules/backlog/taskboard-table.scss:316`) -- the first matches an
 *    ancestor this component never renders, the second is the out-of-scope taskboard's
 *    body, and NEITHER can match `.kanban-table-body`. No rule anywhere selects a
 *    `-prepare` class. So the three are visually inert here, and rule T1's contract is
 *    the FOUR classes this file writes plus the move pair it does not: "nothing
 *    renamed, nothing added, nothing dropped". Emitting library bookkeeping that no
 *    stylesheet reads would be the "added".
 *
 *    ⭐ `ng-move` / `ng-move-active` HAVE NO REACT TRIGGER, AND ARE NEVER APPLIED.
 *    ngAnimate raises that pair when `ngRepeat` REORDERS an existing element. React
 *    reconciles a reorder by `key` and has no move lifecycle to hook, and this UI
 *    never reorders swimlanes anyway. ⛔ No trigger is invented and no move is faked;
 *    the leg is recorded as a drift entry instead (see the Drift Register section
 *    below) rather than silently resolved (rule T6).
 *
 *    ⛔⛔ NO ANIMATION LIBRARY. Not `react-transition-group`, not `framer-motion`,
 *    not `@react-spring`, not any other. Constraint HR-2 freezes the dependency set
 *    at fifteen packages and rule T10 forbids any behaviour change, so the class
 *    sequence is hand-rolled here. ⛔ And NO CSS is authored: every visual value
 *    above already exists in the stylesheet, so this file's entire job is to add and
 *    remove class names on the right schedule (gap G-DS-4).
 *
 *    ⚠ WHY THE SEQUENCE IS TIMER-DRIVEN RATHER THAN `transitionend`-DRIVEN.
 *    Constraint HR-5 requires the unit suite to be browserless, and jsdom runs no
 *    real transitions and fires no `transitionend`. A timer-driven sequence stays
 *    fully assertable with fake timers; a `transitionend`-driven one would be
 *    untestable there AND would hang forever on any element whose transition is
 *    suppressed.
 *
 * 4. ⭐ THE 1000 ms DRAG-HOVER AUTO-OPEN TIMER LIVES HERE, AND ONLY HERE.
 *    `app/coffee/modules/kanban/main.coffee` L1151-L1184: hovering a swimlane that
 *    is FOLDED **while a card is being dragged** marks it `pending-to-open` and, one
 *    second later, removes the mark and calls `ctrl.toggleSwimlane(swimlaneId)` so
 *    the user can drop into a lane that was closed when the gesture began. Leaving
 *    before the deadline cancels it. Hovering a folded lane with NO drag in flight
 *    does nothing at all, and neither does hovering an already-unfolded lane.
 *    `./SwimlaneHeader` is presentational: it takes `pendingToOpen` and forwards
 *    `onMouseOver` / `onMouseLeave`. ⛔ Implementing the timer there as well would
 *    fire `toggleSwimlane` twice per hover.
 *
 *    ⭐ FINDING C -- THE DRAG PROBE CANNOT BE A DOM QUERY ANY MORE. The incumbent
 *    detected the in-flight gesture with
 *    `!!document.querySelectorAll('tg-card.gu-mirror').length` (`main.coffee:1169`),
 *    where `gu-mirror` is a class DRAGULA put on its drag mirror. `@dnd-kit/core`
 *    emits NONE of dragula's classes -- `../shared/dnd/` applies `gu-mirror`,
 *    `gu-transit`, `multiple-drag-mirror`, `tg-multiple-drag-mirror`, `target-drop`
 *    and `new` explicitly, at the lifecycle moments it chooses. Relying on that
 *    timing from here would couple this component to the drag layer's internals, so
 *    the flag arrives as DATA instead, through {@link SwimlaneProps.isDragging},
 *    which `./KanbanBoard` sources from the drag layer. This file never queries the
 *    document for it and never names that class in code.
 *
 * 5. ⭐ THE STICKY TITLE IS A HORIZONTAL PIN, AND IT IS IMPERATIVE IN THE SOURCE TOO.
 *    `main.coffee` L1140-L1148 listens for `scroll` on the BOARD ROOT (the directive
 *    is declared on `div.kanban-table`, `kanban-table.jade` L10) and writes
 *    `transform: translateX(<scrollLeft>px)` onto every `.kanban-swimlane-title`, so
 *    each title stays pinned to the viewport's left edge as the board scrolls
 *    sideways. The VERTICAL half of the same behaviour is already pure CSS --
 *    `.kanban-swimlane-title { position: sticky; top: 36px }`
 *    (`kanban-table.scss:414`-`:426`) -- which is why only the horizontal axis is
 *    driven from script. ⛔ It is therefore NOT replaced with a `position: sticky`
 *    invention: the source manipulates `transform`, so `transform` is what is
 *    reproduced, with the same event, the same measurement and the same sign
 *    (positive). No CSS is authored for it (rule T1) and no scroll-throttling
 *    library is added (constraint HR-2).
 *
 *    In swimlane mode the scrolling element really is the board root, not the body:
 *    `.kanban-table-swimlane { overflow: auto }` (`:530`-`:531`) while the body is
 *    forced to `overflow: visible` (`:547`). The board root is reached from this
 *    component's own root element rather than from the document, and the title is
 *    found INSIDE this component's own subtree -- which is precisely the source's
 *    `$el.find(".kanban-swimlane-title")` idiom, just scoped to one row instead of
 *    all of them. A ref would be tidier still, but `./SwimlaneHeader` is a
 *    `memo()`-wrapped function component that forwards no ref and is must-not-modify.
 *
 *    ⚠ THE SAME SOURCE HANDLER ALSO TRANSLATES `.kanban-swimlane-add`
 *    (`main.coffee:1144`, `:1148`). That element is `a.kanban-swimlane-add` at
 *    `kanban-table.jade` L176-L182 -- a SIBLING of the swimlanes, not a descendant of
 *    one -- so it belongs to `./KanbanBoard` and is deliberately NOT touched from
 *    here (rule T8). Recorded so its absence reads as a boundary, not an omission.
 *
 * 6. ⭐ WHY `onBodyLoaded` MUST FIRE AGAIN AFTER A REMOUNT. The incumbent's
 *    `tg-loaded="kanbanTableLoaded($event, swimlane.id)"` (`kanban-table.jade` L109)
 *    fires when the body renders, and the controller then calls
 *    `openSwimlane(swimlaneId)` and sets `isTableLoaded = true`
 *    (`main.coffee:690`-`:696`). `openSwimlane` re-queries this swimlane's
 *    `.taskboard-column` elements and pushes them into the drag system's container
 *    list (`sortable.coffee:33`-`:37`, `:44`-`:53`). A fold/unfold cycle destroys and
 *    recreates those column elements, so a remount that did NOT re-notify would
 *    leave the drag layer holding detached nodes and the freshly rendered columns
 *    undroppable. The callback therefore fires once per BODY MOUNT -- including every
 *    remount -- exactly as `tg-loaded` does. Re-notifying is safe: the receiver
 *    de-duplicates its container list.
 *
 *    ⛔ This component does NOT register drag containers itself, does not read or
 *    write the drag layer's state, and does not know what the callback does with the
 *    element it hands over. That belongs to `./hooks/useCardDrag` and
 *    `../shared/dnd/` (requirement I9). The element is passed because the receiver
 *    needs it: the incumbent captured this very element to attach the body-scroll
 *    listener that keeps the column-header band aligned (`main.coffee:698`-`:704`).
 *
 * 7. ⭐ `.kanban-table-inner` IS NOT UNIQUE -- THREE OCCURRENCES, THREE OWNERS.
 *    `kanban-table.jade` L17 (inside `div.kanban-table-header`) belongs to
 *    `./KanbanHeader`; L111 (inside the SWIMLANE body) belongs to THIS FILE; L188
 *    (inside the FLAT body) belongs to `./KanbanBoard`. They are styled differently
 *    -- the header variant through `.kanban-table-header .kanban-table-inner`
 *    (`kanban-table.scss:123`-`:128`), the body variants through the bare
 *    `.kanban-table-inner` (`:315`-`:318`) plus, in this file's case,
 *    `.kanban-swimlane .kanban-table-inner` (`:600`-`:614`). A test that queries the
 *    bare class on a fully assembled board will match three elements.
 *
 *    ⭐ AND IT IS NOT AN INERT WRAPPER -- IT PAINTS THE BODY'S SHADING. `:600`-`:613`
 *    gives it `position: relative` and a full-size `::before` carrying
 *    `box-shadow: inset 0 4px 8px rgba($color-gray400, .5)`. The design reference
 *    corroborates this to the pixel: every swimlane body carries a 12-row shading
 *    ramp along its top edge and a 4-row ramp along its bottom edge which CROSS THE
 *    GUTTERS BETWEEN THE COLUMNS -- 400 painted pixels per body that belong to no
 *    column cell -- while every interior column edge is flat. A 4 px vertical offset
 *    with an 8 px blur reaches ~12 px inward at the top and ~4 px at the bottom,
 *    which is exactly the measurement. ⛔ So the body must contain EXACTLY ONE
 *    `.kanban-table-inner` wrapping ALL of its columns. Dropping it, or wrapping the
 *    columns individually, removes that shading and also removes the row's
 *    `display: flex; flex-wrap: nowrap`, collapsing the columns into a stack.
 *
 * 8. THE FOLD FLAG ARRIVES AS A PLAIN BOOLEAN, RESOLVED UPSTREAM. The source reads
 *    `ctrl.foldedSwimlane.get(swimlane.id.toString())` at all four of its sites
 *    (`kanban-table.jade` L82, L86, L90, L108) -- an Immutable `Map` keyed by the
 *    STRING form of the id, written that way by `main.coffee:328`-`:334` because the
 *    map is persisted verbatim through `rs.kanban.storeSwimlanesModes`. That
 *    string-keyed lookup belongs to `./state`; this component receives
 *    {@link SwimlaneProps.folded} and never sees an Immutable structure.
 *    ⛔ The key-type asymmetry across this folder is DELIBERATE and must not be
 *    normalised: `foldedSwimlane` is STRING-keyed, `usByStatus` is
 *    `String(statusId)`-keyed, `usMap` is NUMERIC, and the inner maps of
 *    `usByStatusSwimlanes` are `Number(statusId)`-keyed.
 *
 * 9. THE `ctrl not found` THROW IS REPLACED BY THE TYPE SYSTEM, NOT REPRODUCED.
 *    `main.coffee:1134`-`:1137` does `ctrl = $scope.$parent.ctrl` and throws
 *    `new Error('KanbanSwimlaneDirective ctrl not found')` when the lookup misses,
 *    because a directive reaching into `$scope.$parent` has no compile-time
 *    guarantee that the controller is there. React passes the same dependencies as
 *    props, and every one this component needs is NON-OPTIONAL under `strict`, so the
 *    equivalent failure is a compile error rather than a runtime one. ⛔ No runtime
 *    throw is added: it could only fire on a call site that already failed to
 *    type-check.
 *
 * 10. LIGHT DOM ONLY (requirement I6). Nothing here creates a shadow root. This
 *    file's entire contract is a CSS cascade contract, and a shadow boundary would
 *    sever the single global stylesheet loaded at `app/index.jade:25` -- taking
 *    `kanban-table.scss` L549-L575 with it, so the fold animation would silently
 *    become an instant show/hide -- and would break the children's icon references
 *    against the sprite inlined at `app/index.jade:96`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FIGMA RECONCILIATION -- node `1:7`, file key `B0XlGp5ZYFOfeARVceUVRE` (rule T6 /
 * constraint HR-10). The frame is a single FLATTENED RASTER SCREENSHOT of the live
 * AngularJS output -- zero vector, text, component, variant, Style, Variable or
 * auto-layout nodes -- so design tokens come from `app/themes/taiga/variables.scss`,
 * never from Figma structure, and near-exact agreement is expected: any deviation is
 * more likely a regression introduced in the rebuild than a legitimate design
 * difference. Measured against the byte-verified committed reference render:
 *
 *   * FIVE swimlanes, named top-to-bottom `totam`, `animi`, `autem quas`, `quos`,
 *     `hic ut`. Each row is exactly TWO stacked children -- title band, then body --
 *     spanning the full 1521 px board column with no gap and no padding between them.
 *   * ⭐⭐ THE BODIES SIZE TO CONTENT. Their measured heights are 210 / 309 / 325 /
 *     210 / 292 px, each set by that lane's TALLEST column -- and the tallest column
 *     is a different one in different lanes. Two lanes land on the same 210 px from
 *     DIFFERENT content, which is the floor set by the stylesheet's own
 *     `min-height: 180px`. ⛔ A swimlane body must therefore NEVER be given a fixed
 *     height, and no height rule is authored here: at rest the stylesheet alone
 *     bounds it with `max-height: 56vh; min-height: 180px; overflow: visible`
 *     (`kanban-table.scss:544`-`:547`), and gap G-DS-3 forbids inventing a token for
 *     component geometry that is already encoded.
 *   * Inside every body: five 292 px column cells with exactly 5 px gutters, then the
 *     collapsed ARCHIVED rail at 36 px, closing exactly on the board width
 *     (5 × 292 + 5 × 5 + 36 = 1521). The rail repeats ONCE PER SWIMLANE and is
 *     vertically co-extensive with its body. All of that comes from the archived
 *     status simply being another entry in {@link SwimlaneProps.statuses}, rendered
 *     by `./StatusColumn` like any other -- ⛔ no extra element is appended for it
 *     and no archived filter is applied.
 *   * NOTHING is rendered between two consecutive swimlanes, and NO border, rule,
 *     divider or shadow appears on any side of any title band. The faint edge a
 *     reader may perceive at a lane boundary is the two bodies' own shading ramps
 *     (seam note 7). ⛔ Emitting a divider, spacer or margin here would be a defect.
 *   * All five swimlanes are rendered EXPANDED, with pixel-identical down chevrons.
 *     The frame's rest state is therefore "body mounted, NO animation class applied",
 *     which is this component's settled state.
 *   * No hover, focus, active, pressed, drag-over, drag-ghost, tooltip or popover
 *     appearance exists anywhere in the frame -- it captures the default idle state
 *     only (drift entry D4) -- so none is inferred here (gap G-DS-6). The
 *     `pending-to-open` appearance likewise comes from the stylesheet
 *     (`kanban-table.scss:443`-`:446`), never from the frame.
 *   * Status, tag and epic colours visible in the frame are `sample_data` values
 *     bound to their records, not design tokens (rule T2, drift entry D3). This file
 *     contains no colour literal, no spacing literal, no radius, no shadow and no
 *     stylesheet, and its only inline style is the scroll displacement of seam note 5
 *     -- which is a measurement, not a design value.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DRIFT REGISTER ENTRY D17 -- recorded rather than silently resolved (rule T6). The
 * register file under `e2e-react/artifacts/figma-comparison/` is owned by the
 * `e2e-react/` agent and is deliberately NOT authored here.
 *
 *   * ELEMENT -- `div.kanban-table-body`'s move-animation leg, node `1:7`.
 *   * FIGMA-MEASURED -- nothing. The frame is a single static raster of the idle
 *     state; no animation, transition or reordering is observable in it at all, and
 *     all five swimlane bodies are rendered expanded and settled.
 *   * REPOSITORY-SOURCED -- `[app/styles/modules/kanban/kanban-table.scss:549-575]`
 *     styles a `ng-move` / `ng-move-active` pair alongside the enter and leave pairs.
 *     ngAnimate raised it when `ngRepeat` reordered an existing element.
 *   * IMPLEMENTED -- the enter and leave legs, faithfully and in full. The move leg
 *     is NOT implemented and those two class names are never written to the DOM;
 *     they appear in this file only in prose.
 *   * RATIONALE -- React reconciles a reorder by `key` and exposes no move lifecycle
 *     to hook, and this UI never reorders swimlanes: the repeat is keyed by
 *     `swimlane.id` and the collection's order is server-assigned. Inventing a
 *     trigger would mean animating something the incumbent does not animate, which
 *     rule T10 forbids; faking a move would mean writing classes at moments ngAnimate
 *     never wrote them. The leg is therefore unreachable BY CONSTRUCTION rather than
 *     overlooked, and the stylesheet keeps it at ZERO EDITS either way, since an
 *     unmatched selector costs nothing.
 *
 * A SECOND MEASUREMENT IS RECORDED HERE FOR THE REGISTER'S OWNER, with its number
 * left to that agent. The plan quotes the swimlane title band at 44 px; the reference
 * render measures it at 39 px on the first lane and 40 px on the other four, and the
 * band-to-band pitch is not constant because it tracks the body height. It requires
 * NO action in this file and none is taken: the band's height is produced entirely by
 * `.kanban-swimlane-title { padding: .625rem 1rem }` (`kanban-table.scss:414`-`:426`)
 * on an element owned by `./SwimlaneHeader`, both of which are must-not-modify, and
 * gap G-DS-3 forbids inventing a token for it in either direction.
 * ========================================================================== */

/* ==========================================================================
 * CONSTANTS
 *
 * Every class name below is quoted from the source markup or the stylesheet and is
 * reproduced EXACTLY -- nothing renamed, nothing added, nothing dropped (rule T1).
 * They are named rather than inlined because each one is half of a selector that
 * something else already owns, and a named constant is what makes that visible at the
 * point of use.
 * ========================================================================== */

/** The row's own class -- `kanban-table.jade` L77, and half of the drag selector. */
const ROOT_CLASS = 'kanban-swimlane';

/** The animated body -- `kanban-table.jade` L107, styled at `kanban-table.scss:544`. */
const BODY_CLASS = 'kanban-table-body';

/** The column row -- `kanban-table.jade` L111. Three owners; see seam note 7. */
const INNER_CLASS = 'kanban-table-inner';

/**
 * The four ngAnimate classes this component actually writes (seam note 3).
 *
 * ⭐ The move pair is deliberately ABSENT from this list and from the file's code
 * altogether -- it has no React trigger and is recorded as drift entry D17.
 */
const ENTER_CLASS = 'ng-enter';

const ENTER_ACTIVE_CLASS = 'ng-enter-active';

const LEAVE_CLASS = 'ng-leave';

const LEAVE_ACTIVE_CLASS = 'ng-leave-active';

/**
 * The fold animation's duration, in milliseconds.
 *
 * ⭐ EXACTLY the stylesheet's `transition: all linear .5s`
 * (`kanban-table.scss:549`-`:553`). It is the interval after which the enter classes
 * are removed and, on the leave side, after which the body is finally unmounted, so
 * it MUST NOT drift from the CSS: too short and the body disappears mid-animation,
 * too long and a folded swimlane leaves an invisible but still-mounted body behind.
 */
const ANIMATION_DURATION_MS = 500;

/**
 * ⭐⭐ THE TRANSITION-BLOCKING STYLE -- ngAnimate's `blockTransitions`, reproduced.
 *
 * THE PROBLEM IT SOLVES. The stylesheet introduces `transition: all linear .5s` in the
 * SAME rule that introduces the from-state (`kanban-table.scss:549`-`:561`), so the
 * instant `ng-leave` lands, both the transition AND the new `max-height`/`min-height`
 * become active together. Per CSS Transitions Level 1 the `transition-*` longhands are
 * read from the AFTER-change style, so the browser starts a transition for that step
 * too -- and the body then animates from its RESTING ceiling (`max-height: 56vh`,
 * `min-height: 180px`) instead of from the animation's declared start (`524px` / `0`).
 *
 * MEASURED, NOT ASSUMED. Runtime capture of the incumbent board (5 swimlanes, 1920 px
 * viewport, `56vh` = 1064 px) samples the body at `max-height: 524px; min-height: 0px`
 * ~8 ms after the fold click -- an INSTANT snap -- and then a clean unperturbed run
 * reads `261.964px` at t = 256 ms, which is exactly 50 % of a linear 524 -> 0 ramp. A
 * frame-by-frame capture agrees: the box steps 546 -> 528 px on the first frame, then
 * shrinks evenly. Without blocking, the same schedule instead ramps 1064 -> 0, holding
 * the visible box still for the first ~240 ms and then collapsing it in the remainder.
 * Same duration, same endpoints, DIFFERENT SHAPE -- a behaviour change, which rule T10
 * forbids outright.
 *
 * HOW ngAnimate FIXES IT, verbatim from the bundled library
 * (`node_modules/angular-animate/angular-animate.js:338`-`:342`):
 *
 *     // we use a negative delay value since it performs blocking
 *     // yet it doesn't kill any existing transitions running on the
 *     // same element which makes this safe for class-based animations
 *     var value = duration ? '-' + duration + 's' : '';
 *     applyInlineStyle(node, [TRANSITION_DELAY_PROP, value]);
 *
 * A negative `transition-delay` whose magnitude equals the duration starts the
 * transition already finished, so the from-state is applied in one step with no
 * visible interpolation -- exactly the snap the incumbent shows. It is preferred over
 * `transition: none` precisely because it does not cancel transitions already running,
 * which matters when a fold is reversed mid-flight.
 *
 * ⭐ WHY AN INLINE STYLE IS CORRECT HERE, AND WHY IT IS NOT A TOKEN. This is the second
 * and last inline style in the file, and like the sticky-title `translateX` (seam note
 * 5) it is a MECHANISM, not a design value: no colour, no spacing, no size, nothing a
 * theme variable could express, and nothing that survives past the next animation
 * frame. Rule T1's "author no CSS" bars adding rules that duplicate the stylesheet;
 * this adds none -- every animated value still comes from `kanban-table.scss`, and the
 * one number here is derived from {@link ANIMATION_DURATION_MS} rather than written
 * twice. ngAnimate writes the equivalent `-0.5s`; `-500ms` is the same delay expressed
 * in the unit the constant already uses.
 *
 * ⭐ A FROZEN MODULE-LEVEL CONSTANT, not an object literal in the render: a fresh
 * object each render would make React re-diff the style on every commit, and freezing
 * documents that no caller may mutate the shared instance.
 */
const BLOCKED_TRANSITION_STYLE: Readonly<CSSProperties> = Object.freeze({
    transitionDelay: `-${ANIMATION_DURATION_MS}ms`,
});

/**
 * The drag-hover auto-open delay, in milliseconds.
 *
 * ⭐ EXACTLY the incumbent's `$timeout(…, 1000)` (`main.coffee:1178`). ⛔ No debounce
 * library, no `requestIdleCallback`, no other duration (rules T10, HR-2).
 */
const HOVER_AUTO_OPEN_DELAY_MS = 1000;

/**
 * The board root, which is the horizontally scrolling element in swimlane mode.
 *
 * The incumbent directive was declared ON this element (`kanban-table.jade` L10) and
 * listened on it directly; this component reaches it from its own root instead, so
 * the lookup stays inside the board and never becomes a document-wide query. See
 * seam note 5.
 */
const BOARD_ROOT_SELECTOR = '.kanban-table';

/**
 * This row's own title element, resolved within this component's subtree -- the
 * source's `$el.find(".kanban-swimlane-title")` (`main.coffee:1142`), narrowed from
 * every row to this one. See seam note 5 for why a ref cannot be used instead.
 */
const SWIMLANE_TITLE_SELECTOR = '.kanban-swimlane-title';

/* ==========================================================================
 * THE ngANIMATE STATE MACHINE (seam note 3, gap G-DS-1)
 * ========================================================================== */

/**
 * Every state the body can be in, and therefore every class combination the
 * stylesheet can be asked to match.
 *
 * Six states rather than a pair of booleans, because the two intermediate states of
 * each direction are exactly what the CSS distinguishes -- `&.ng-enter` alone means
 * "collapsed and invisible", `&.ng-enter.ng-enter-active` means "expanded and
 * visible", and the transition between them is what the browser animates. A boolean
 * pair could not express "mounted, folded, still animating out", which is the state
 * React would otherwise skip entirely.
 *
 *   * `absent`          -- not rendered. The settled state of a folded swimlane.
 *   * `entering`        -- rendered with `ng-enter`: collapsed, invisible, transition armed.
 *   * `entering-active` -- `ng-enter ng-enter-active`: expanding to 524 px, fading in.
 *   * `present`         -- rendered with NO animation class, so the at-rest block applies.
 *                          The settled state of an unfolded swimlane, and what the
 *                          design reference captures.
 *   * `leaving`         -- rendered with `ng-leave`: still expanded and visible, transition armed.
 *   * `leaving-active`  -- `ng-leave ng-leave-active`: collapsing to 0, fading out.
 *                          ⭐ STILL MOUNTED -- the unmount waits for the full 500 ms.
 */
type BodyPhase =
    | 'absent'
    | 'entering'
    | 'entering-active'
    | 'present'
    | 'leaving'
    | 'leaving-active';

/** Whether the body element exists in the DOM in a given phase. */
function isBodyRendered(phase: BodyPhase): boolean {
    return phase !== 'absent';
}

/**
 * The body's `class` attribute for a given phase.
 *
 * `kanban-table-body` is always first and always present -- it carries the element's
 * own geometry -- and the animation classes are appended in the order ngAnimate
 * appended them, which keeps the emitted markup byte-comparable with the incumbent's.
 * Class order does not affect CSS specificity, so this is for comparability, not
 * correctness.
 *
 * ⛔ No `classnames`/`clsx`: the package set is CLOSED at fifteen (constraint HR-2),
 * and an exhaustive switch over six named states is clearer than a conditional list
 * for a value with exactly six legal forms.
 *
 * @param phase - the body's current animation phase.
 * @returns the space-separated class attribute value, never with a stray space.
 */
function resolveBodyClassName(phase: BodyPhase): string {
    switch (phase) {
        case 'entering':
            return `${BODY_CLASS} ${ENTER_CLASS}`;

        case 'entering-active':
            return `${BODY_CLASS} ${ENTER_CLASS} ${ENTER_ACTIVE_CLASS}`;

        case 'leaving':
            return `${BODY_CLASS} ${LEAVE_CLASS}`;

        case 'leaving-active':
            return `${BODY_CLASS} ${LEAVE_CLASS} ${LEAVE_ACTIVE_CLASS}`;

        /*
         * `present` is the settled, unfolded state: the animation classes are gone, so
         * `max-height: 56vh; min-height: 180px; overflow: visible` applies again and the
         * body is free to exceed the 524 px the animation interpolates to.
         *
         * `absent` shares the branch because the element is not rendered in that phase,
         * so the value is never used -- grouping the two keeps the switch exhaustive
         * without a `default` clause that could mask a future state being forgotten.
         */
        case 'present':
        case 'absent':
            return BODY_CLASS;
    }
}

/**
 * The body's inline `style` for a given phase -- the transition block, and nothing else.
 *
 * ⭐ THE BLOCK IS PRESENT IN EXACTLY THE TWO FROM-STATE PHASES and absent everywhere
 * else, which is what makes it correct: React applies `className` and `style` from the
 * same commit, so adding `ng-leave` WITH the block is one style change (the from-state
 * lands instantly), and adding `ng-leave-active` WITHOUT it is the next (the real 500 ms
 * transition runs from there). That is precisely ngAnimate's own order -- it unblocks
 * and adds the `-active` class inside a single step -- see
 * {@link BLOCKED_TRANSITION_STYLE} for the measurements and the library citation.
 *
 * `undefined` rather than an empty object for the unblocked phases: React then clears
 * the property it previously set, leaving a bare `style=""`, which is exactly what the
 * incumbent leaves behind too (ngAnimate unblocks by assigning the empty string).
 *
 * ⭐ On the ENTER leg the block is inert -- a freshly inserted element has no
 * before-change style, so no transition could have started for it to suppress. It is
 * emitted anyway because ngAnimate blocks both legs, and because "inert on one leg" is
 * a far weaker guarantee to rely on than "identical on both".
 *
 * @param phase - the body's current animation phase.
 * @returns the blocking style while a from-state is settling, otherwise `undefined`.
 */
function resolveBodyStyle(phase: BodyPhase): Readonly<CSSProperties> | undefined {
    switch (phase) {
        case 'entering':
        case 'leaving':
            return BLOCKED_TRANSITION_STYLE;

        /*
         * Both `-active` phases are mid-transition and MUST NOT carry the block, or the
         * animation would complete instantly and nothing would be seen. `present` and
         * `absent` are settled, and `absent` is not rendered at all.
         */
        case 'entering-active':
        case 'leaving-active':
        case 'present':
        case 'absent':
            return undefined;
    }
}

/**
 * Forces the browser to compute layout for the element in its CURRENT class state.
 *
 * ⭐ THIS IS WHAT MAKES ONE ANIMATION FRAME ENOUGH. Adding `ng-enter` and
 * `ng-enter-active` without a computed style in between produces no transition at
 * all, because the browser has no "from" value to interpolate. ngAnimate solves this
 * with `$$forceReflow`, which reads a layout property for exactly this reason, and
 * this is the same trick against the element being animated. Without it, a frame
 * boundary alone is not a guarantee: React can flush a passive effect before the
 * browser paints, so both classes could still land in one style recalculation.
 *
 * A method CALL is used rather than a property read (`element.offsetHeight`) because a
 * bare property-access statement is the kind of expression a bundler may consider
 * side-effect-free and drop, whereas a call never is. `getBoundingClientRect` flushes
 * pending style and layout identically. Its return value is intentionally discarded.
 *
 * jsdom performs no layout, so this is a harmless no-op there -- which is fine,
 * because jsdom runs no transitions either.
 *
 * @param element - the body element, or `null` if it is not currently mounted.
 */
function forceReflow(element: HTMLElement | null): void {
    if (element === null) {
        return;
    }

    element.getBoundingClientRect();
}

/** A cancellable handle on a scheduled animation frame. */
interface FrameHandle {
    readonly cancel: () => void;
}

/**
 * Schedules a callback for the next animation frame.
 *
 * The fallback to a zero-delay timer is not decoration: if `requestAnimationFrame`
 * were missing, an unguarded call would throw from inside an effect, the error
 * boundary would catch it, and the whole board would be replaced by the fallback UI --
 * a total failure caused by an animation detail. A macrotask still yields to the
 * browser between the two class writes, so the sequence degrades to "possibly no
 * visible transition" instead of "no board".
 *
 * Both handles are browser-typed: `window.requestAnimationFrame` and
 * `window.setTimeout` return `number`. ⛔ Never `NodeJS.Timeout` -- this code runs in
 * a browser and in jsdom, never in Node's timer implementation.
 *
 * @param callback - run on the next frame, or on the next macrotask as a fallback.
 * @returns a handle whose `cancel` prevents the callback from running.
 */
function scheduleNextFrame(callback: () => void): FrameHandle {
    if (typeof window.requestAnimationFrame === 'function') {
        const frameId = window.requestAnimationFrame(callback);

        return {
            cancel: (): void => {
                window.cancelAnimationFrame(frameId);
            },
        };
    }

    const timeoutId = window.setTimeout(callback, 0);

    return {
        cancel: (): void => {
            window.clearTimeout(timeoutId);
        },
    };
}

/**
 * The phase a fold state implies once any animation has finished: what the incumbent's
 * `ng-if` would resolve to on its own.
 *
 * @param folded - whether the swimlane is collapsed.
 * @returns `absent` when folded, `present` otherwise.
 */
function resolveSettledPhase(folded: boolean): BodyPhase {
    return folded ? 'absent' : 'present';
}

/**
 * The next phase when the fold state changes, given where the body currently is.
 *
 * The whole of G-DS-1's cancellation behaviour lives in these four lines:
 *
 *   * FOLDING an already-absent body is a no-op -- there is nothing to animate out,
 *     which is also why the first render of a folded swimlane produces no classes and
 *     no timers at all (ngAnimate likewise raises no leave for an element that never
 *     entered).
 *   * FOLDING anything else starts the leave leg, whether the body was settled or
 *     still entering. Restarting from `leaving` is impossible because the guard
 *     returns the same value and React bails out of an identical state update.
 *   * UNFOLDING starts the enter leg only from a phase that is going away or already
 *     gone. ⭐ THIS IS THE MID-FLIGHT CANCEL: reopening a swimlane during its leave
 *     replaces the phase, the leave effect's cleanup cancels its pending unmount, and
 *     the enter sequence begins from a body that never left the DOM -- so no
 *     `ng-leave*` class can be left stranded on it.
 *   * UNFOLDING a body that is already entering or present changes nothing.
 *
 * @param folded - the swimlane's new fold state.
 * @param current - the body's current phase.
 * @returns the phase to move to, or `current` when the change is a no-op.
 */
function resolveNextPhase(folded: boolean, current: BodyPhase): BodyPhase {
    if (folded) {
        return current === 'absent' ? current : 'leaving';
    }

    if (current === 'absent' || current === 'leaving' || current === 'leaving-active') {
        return 'entering';
    }

    return current;
}

/* ==========================================================================
 * THE COLUMN CONTRACT, SPLIT THE WAY THE REPEAT SPLITS IT
 *
 * `kanban-table.jade` L112-L121 binds three kinds of value onto each column: the
 * status from the repeat itself, the values that differ per status, and the values
 * that are identical for every column on the board. Both types below are DERIVED from
 * `./StatusColumn`'s own contract with `Pick` and `Omit` rather than restated, so they
 * cannot drift from it, `./StatusColumn` stays unmodified, and "passed through
 * unchanged" becomes a structural property of the types rather than a promise in a
 * comment.
 * ========================================================================== */

/**
 * The per-status slice: the values that differ from one column to the next.
 *
 * Exactly the bindings the source evaluates per status --
 * `usByStatusSwimlanes.getIn([swimlane.id, s.id])` and its `.size`
 * (`kanban-table.jade` L128, L153), `folds[s.id]` and `unfold == s.id` (L113),
 * `ctrl.showPlaceHolder(s.id, swimlane.id)` (L145) -- plus the two drag-state flags
 * the retired drag library used to write as classes directly.
 *
 * ⚠ NOTE THE NAME CLASH, WHICH IS THE SOURCE'S: `folded` HERE means "this STATUS
 * COLUMN is collapsed" (`folds[s.id]`, the `vfold` class), whereas
 * {@link SwimlaneProps.folded} means "this SWIMLANE is collapsed"
 * (`foldedSwimlane`). They are independent pieces of state -- a folded column stays
 * folded across every swimlane, and a folded swimlane hides all of its columns
 * whatever their own fold state. Keeping both names is rule T1's consequence for
 * props; they never meet, because this one only ever appears inside this object.
 */
type SwimlaneColumnState = Pick<
    StatusColumnProps,
    | 'cardIds'
    | 'count'
    | 'folded'
    | 'unfolded'
    | 'showPlaceholder'
    | 'isDropTarget'
    | 'justDropped'
>;

/**
 * Everything else `./StatusColumn` needs: identical for every column in the row, so
 * it travels as ONE object that is spread unchanged onto each of them.
 *
 * That is `ctrl.renderInProgress` (`kanban-table.jade` L127),
 * `ctrl.notFoundUserstories` (L146), the board's virtualisation API, the owner's
 * translator, the per-card detail records, the shared card props, the two board-state
 * slices `ctrl.selectedUss` and `ctrl.movedUs` (L154), and the three optional
 * callbacks.
 *
 * ⭐ Written as `Omit<…>` of the child's props minus the three groups this component
 * supplies itself, so ADDING a prop to `./StatusColumn` automatically requires the
 * board to supply it here -- it cannot be silently dropped at this seam. `status` and
 * `swimlaneId` are excluded because this component sets them; the per-status slice is
 * excluded because {@link SwimlaneProps.resolveColumnState} provides it.
 */
type SwimlaneColumnProps = Omit<
    StatusColumnProps,
    keyof SwimlaneColumnState | 'status' | 'swimlaneId'
>;

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface SwimlaneProps {
    /**
     * The swimlane this row renders -- one entry of the source's `swimlanesList`
     * (`kanban-table.jade` L75).
     *
     * Only `id` and `name` are read here and in `./SwimlaneHeader`. ⚠ The model's
     * `statuses` field is OPTIONAL and is deliberately NOT relied on: the resolved,
     * ordered list arrives as {@link SwimlaneProps.statuses} instead, because the
     * synthetic unclassified swimlane has no `statuses` of its own and takes the
     * project's list (see that prop). `../shared/types/swimlane` is must-not-modify
     * and is consumed exactly as declared.
     */
    readonly swimlane: SwimlaneModel;

    /**
     * The statuses whose columns this row renders, IN RENDER ORDER -- the source's
     * `s in ::swimlanesStatuses[swimlane.id]` (`kanban-table.jade` L114).
     *
     * That map is built at `main.coffee:552`-`:562`: one entry per swimlane holding
     * that swimlane's OWN statuses, and -- ⭐ critically -- `swimlanesStatuses[-1] =
     * project.us_statuses` for the synthetic unclassified swimlane, which is why the
     * list cannot be read off the swimlane model. The derivation belongs to
     * `./state`; this component receives the result.
     *
     * ⛔ ALREADY ORDERED. Rendered exactly as received, with no sort of any kind. The
     * Kanban screen orders its statuses by `order` (`main.coffee:576`) while the
     * BACKLOG screen orders its equivalent list by `id` -- a real difference between
     * the two screens, and ⛔ they must never be unified. The synthetic swimlane's
     * entry takes the project's raw collection, so its columns can legitimately differ
     * in order from the header band; that is reproduced, not corrected.
     *
     * ⭐ UNFILTERED. The archived status belongs in this array and renders like any
     * other column -- it is its FOLD STATE, not a different element, that makes it the
     * narrow 36 px rail measured at the right end of every swimlane body. ⛔ Do not
     * filter it out and do not append a second element for it.
     *
     * An unrecognised swimlane id yields an empty list from `./state` rather than
     * `undefined`, so this is walked without a guard -- exactly as the template's own
     * unguarded read did.
     */
    readonly statuses: readonly Status[];

    /**
     * Whether this swimlane is collapsed.
     *
     * A PLAIN BOOLEAN, resolved upstream from a STRING-keyed map -- see seam note 8
     * for why that key type is deliberate and must not be normalised.
     *
     * ⭐ This is the sole driver of the fold animation: every transition of this one
     * prop moves the body through the class sequence of seam note 3.
     */
    readonly folded: boolean;

    /**
     * Whether a card drag is currently in flight anywhere on the board.
     *
     * ⭐ FINDING C -- see seam note 4. This is the replacement for the incumbent's
     * `document.querySelectorAll('tg-card.gu-mirror')` probe, threaded down from
     * `./KanbanBoard` as data because `@dnd-kit/core` emits none of dragula's classes
     * and the substitutes are applied by `../shared/dnd/` on its own schedule.
     *
     * It gates the auto-open timer ONLY. It changes nothing about how the row renders,
     * which is why no drag styling appears in this file -- the design frame captures
     * no drag state at all (drift entry D4).
     */
    readonly isDragging: boolean;

    /**
     * The project's default swimlane id, or `null` when it has none. Forwarded to
     * `./SwimlaneHeader`, which owns the marker and its compound gate; this component
     * neither reads nor compares it.
     */
    readonly defaultSwimlaneId: number | null;

    /**
     * How many swimlanes the project has -- the second half of that same gate
     * (`kanban-table.jade` L102: `project.swimlanes.length > 1`). Forwarded unchanged.
     */
    readonly swimlaneCount: number;

    /**
     * Report that this swimlane should be folded or unfolded --
     * `ng-click="ctrl.toggleSwimlane(swimlane.id)"` (`kanban-table.jade` L83).
     *
     * Called from TWO places, and both are the incumbent's: the header's click, which
     * `./SwimlaneHeader` raises, and the 1000 ms drag-hover auto-open owned here
     * (`main.coffee:1177`). The receiver owns everything that follows -- flipping the
     * string-keyed map, persisting it through `rs.kanban.storeSwimlanesModes` and
     * re-broadcasting `redraw:wip` after 100 ms (`main.coffee:328`-`:334`) -- none of
     * which happens in this file (requirement I9).
     */
    readonly onToggleSwimlane: (swimlaneId: number) => void;

    /**
     * Report that this swimlane's body has mounted, handing over the body element --
     * the source's `tg-loaded="kanbanTableLoaded($event, swimlane.id)"`
     * (`kanban-table.jade` L109).
     *
     * ⭐ FIRES ONCE PER BODY MOUNT, INCLUDING EVERY REMOUNT after a fold/unfold cycle.
     * See seam note 6 for why re-notifying is mandatory rather than merely harmless,
     * and why the element is part of the signature.
     *
     * OPTIONAL because the row renders and animates identically without it -- the
     * receiver's use of it (registering drag containers, wiring the header-band scroll
     * sync) is the board's concern, not the row's -- which also lets a spec mount this
     * component with no callback at all.
     */
    readonly onBodyLoaded?: (swimlaneId: number, bodyEl: HTMLDivElement) => void;

    /**
     * Everything the columns need that does not vary between them, spread onto each
     * one unchanged. See {@link SwimlaneColumnProps}.
     */
    readonly columnProps: SwimlaneColumnProps;

    /**
     * The per-status slice for one column, by status id. See
     * {@link SwimlaneColumnState}.
     *
     * ⭐ A FUNCTION RATHER THAN A RECORD, for two reasons. A record keyed by status id
     * could be missing a key, which would surface as `undefined` props on a column at
     * runtime; a function returning a REQUIRED object cannot. And the board derives
     * these values from selectors that already take `(state, statusId, swimlaneId)`,
     * so a function is what it naturally has -- no intermediate object needs building
     * on every render.
     *
     * ⚠ Keep it referentially stable (`useCallback`) or this component's `memo`
     * boundary is defeated. That is the owner's responsibility; nothing is memoised
     * here on its behalf, because a stale closure would be far worse than a re-render.
     */
    readonly resolveColumnState: (statusId: number) => SwimlaneColumnState;
}

/* ==========================================================================
 * COMPONENT
 * ========================================================================== */

/**
 * One swimlane row. Memoised at the bottom of the file; this is the unmemoised render
 * function.
 *
 * It is presentational apart from FOUR narrowly-scoped effects, each reproducing one
 * documented behaviour of the incumbent and nothing else: the ngAnimate class sequence
 * (seam note 3), the drag-hover auto-open timer (seam note 4), the sticky-title
 * horizontal pin (seam note 5) and the body-mounted notification (seam note 6).
 *
 * ⛔ NOT here, and not to be added (rules T5, I7, I9): no `useAngularService`, no
 * `$tgResources`, no `fetch`, no persistence, no realtime subscription, no
 * `$rootScope.$apply()`. Every value it needs arrives as a prop and every consequence
 * it reports leaves as a callback, which is what keeps the whole row assertable in
 * jsdom with no browser and no network (constraint HR-5).
 *
 * @param props - see {@link SwimlaneProps}.
 * @returns the `div.kanban-swimlane` row: a title bar and, unless folded, a body.
 */
function UnmemoizedSwimlane({
    swimlane,
    statuses,
    folded,
    isDragging,
    defaultSwimlaneId,
    swimlaneCount,
    onToggleSwimlane,
    onBodyLoaded,
    columnProps,
    resolveColumnState,
}: SwimlaneProps): ReactElement {
    /*
     * Read once into a local so that every effect below depends on the NUMBER rather
     * than on the swimlane object's identity: the bridge hands over a fresh object on
     * each refresh, and an effect keyed on the object would re-run -- and re-notify --
     * on every one of them.
     */
    const swimlaneId = swimlane.id;

    /* ----------------------------------------------------------------------
     * The row's own element, and the two elements the effects reach for.
     * -------------------------------------------------------------------- */

    /** The `.kanban-swimlane` root: the scope for both DOM lookups below. */
    const rootRef = useRef<HTMLDivElement | null>(null);

    /** The `.kanban-table-body`, when mounted. Read by the reflow and the notify effect. */
    const bodyRef = useRef<HTMLDivElement | null>(null);

    /**
     * This row's title element, cached across scroll events.
     *
     * The incumbent caches the same lookup for the same reason -- `if
     * !tableHeaderDom.length then tableHeaderDom = $el.find(…)`
     * (`main.coffee:1141`-`:1142`) -- so a scroll gesture does not re-query the DOM on
     * every one of its dozens of events. Cleared when the listener is torn down, so a
     * remount can never write to a detached node.
     */
    const titleElementRef = useRef<HTMLElement | null>(null);

    /* ----------------------------------------------------------------------
     * SEAM NOTE 3 / G-DS-1 -- the ngAnimate class sequence.
     * -------------------------------------------------------------------- */

    /**
     * ⭐ THE FIRST RENDER IS SETTLED, NOT ANIMATED -- AND THAT IS THE FAITHFUL
     * BEHAVIOUR, verified against ngAnimate's own rules rather than assumed.
     *
     * ngAnimate skips a structural animation whose ANCESTOR is already running one,
     * unless that ancestor opts children in with `ng-animate-children`
     * (`areAnimationsAllowed`). On this screen the whole board arrives in a single
     * digest: `loadInitialData` resolves `loadKanban()` -- which includes
     * `loadSwimlanes()` -- and only THEN flips `initialLoad`
     * (`main.coffee:637`-`:646`), so `div.kanban-table(ng-if="ctrl.initialLoad")`
     * enters with its swimlanes and their bodies already in the template. The board
     * root's own enter is the blocking ancestor animation, so the bodies inside it
     * enter WITHOUT any `ng-enter` class. The design reference agrees: all five
     * swimlanes are captured expanded and settled, with no animation state anywhere.
     *
     * So a folded swimlane starts with no body at all, and an unfolded one starts with
     * a body carrying only its own class. Animation begins at the first CHANGE of
     * {@link SwimlaneProps.folded}, which is the user action the incumbent animates.
     * Starting at `entering` instead would fade the whole board in on load AND clamp
     * every body to the animation's 524 px for half a second, clipping any swimlane
     * taller than that before it snapped open -- a visible artefact the incumbent does
     * not have.
     */
    const [bodyPhase, setBodyPhase] = useState<BodyPhase>(() => resolveSettledPhase(folded));

    /*
     * FOLD STATE CHANGED -> pick the next phase. The functional update is what makes
     * this safe to run on every commit: `resolveNextPhase` returns the CURRENT phase
     * whenever the change is a no-op, and React bails out of an identical state
     * update, so the first render and every unrelated re-render cost nothing.
     *
     * ⭐ This is also where mid-flight cancellation happens -- reopening during a leave
     * replaces `leaving`/`leaving-active` with `entering`, which cancels the pending
     * unmount through the next effect's cleanup and leaves no `ng-leave*` class behind.
     */
    useEffect(() => {
        setBodyPhase((current: BodyPhase): BodyPhase => resolveNextPhase(folded, current));
    }, [folded]);

    /*
     * PHASE CHANGED -> schedule the one step that follows it. Two legs:
     *
     *   * `entering` / `leaving` -> next ANIMATION FRAME, force a reflow so the
     *     browser has computed the pre-transition style, then add the `-active` class.
     *     Doing both class writes in one frame produces no transition at all; see
     *     {@link forceReflow} for why the reflow is the other half of the fix.
     *   * `entering-active` / `leaving-active` -> after the stylesheet's full 500 ms,
     *     settle: drop both enter classes so the at-rest block applies again, or --
     *     ⭐ THE DEFERRED UNMOUNT -- finally remove the body from the DOM. React would
     *     have unmounted it 500 ms earlier and skipped the animation entirely.
     *
     * ⭐ EVERY HANDLE IS OWNED BY THE EFFECT THAT CREATED IT, so React's own cleanup
     * cancels it whenever the phase changes or the component unmounts. There is no
     * shared timer ref to leak and no path on which a callback survives its element: a
     * leaked handle that writes a class onto a detached node is silent but real.
     *
     * The guard inside each callback re-checks that the phase is still the one the
     * work was scheduled for. Cleanup already guarantees that, so the guard is a
     * second line of defence rather than the mechanism -- and it makes each step
     * idempotent, which matters under React's development double-invocation.
     */
    useEffect(() => {
        if (bodyPhase === 'entering' || bodyPhase === 'leaving') {
            const activePhase: BodyPhase =
                bodyPhase === 'entering' ? 'entering-active' : 'leaving-active';

            const frame = scheduleNextFrame((): void => {
                forceReflow(bodyRef.current);

                setBodyPhase((current: BodyPhase): BodyPhase =>
                    current === bodyPhase ? activePhase : current,
                );
            });

            return (): void => {
                frame.cancel();
            };
        }

        if (bodyPhase === 'entering-active' || bodyPhase === 'leaving-active') {
            const settledPhase: BodyPhase =
                bodyPhase === 'entering-active' ? 'present' : 'absent';

            const timeoutId = window.setTimeout((): void => {
                setBodyPhase((current: BodyPhase): BodyPhase =>
                    current === bodyPhase ? settledPhase : current,
                );
            }, ANIMATION_DURATION_MS);

            return (): void => {
                window.clearTimeout(timeoutId);
            };
        }

        // `absent` and `present` are settled: nothing is scheduled and nothing pends.
        return undefined;
    }, [bodyPhase]);

    /* ----------------------------------------------------------------------
     * SEAM NOTE 4 -- the 1000 ms drag-hover auto-open state machine.
     * -------------------------------------------------------------------- */

    /**
     * The pending auto-open, or `null` when none is armed.
     *
     * A ref, not state, because the handlers must read the CURRENT value synchronously:
     * `mouseover` fires repeatedly as the pointer travels across the title's children
     * (the event bubbles, exactly as `ng-mouseover` did), and the incumbent's first act
     * is to bail out when this swimlane is already the pending one
     * (`main.coffee:1160`). Reading that from state would race the re-render.
     *
     * ⭐ IT IS NOT CLEARED WHEN THE TIMER FIRES, which mirrors the source exactly --
     * `main.coffee:1175`-`:1178` removes the class and toggles the swimlane but leaves
     * `currentSwimlane` set, so a further hover without an intervening `mouseleave` is
     * a no-op. Cancelling an already-elapsed timeout id is harmless.
     */
    const pendingHoverRef = useRef<{ readonly timeoutId: number } | null>(null);

    /**
     * Whether the `pending-to-open` class is on the title.
     *
     * State rather than a direct DOM write: `./SwimlaneHeader` renders the class from
     * its `pendingToOpen` prop, so the class stays declarative and cannot be stripped
     * by an unrelated re-render -- which is what would happen if this component reached
     * in and called `classList.add` the way the directive did.
     */
    const [pendingToOpen, setPendingToOpen] = useState(false);

    /**
     * `$scope.mouseleaveSwimlane` (`main.coffee:1153`-`:1157`): cancel the pending
     * auto-open and clear the mark.
     *
     * Guarded on there being something pending so that an ordinary hover-and-leave over
     * an unfolded swimlane -- by far the common case -- costs no state update at all.
     */
    const cancelPendingHover = useCallback((): void => {
        const pending = pendingHoverRef.current;

        if (pending === null) {
            return;
        }

        window.clearTimeout(pending.timeoutId);
        pendingHoverRef.current = null;
        setPendingToOpen(false);
    }, []);

    /**
     * `$scope.mouseoverSwimlane` (`main.coffee:1159`-`:1184`), gate for gate.
     *
     * The incumbent's second branch -- cancelling a DIFFERENT swimlane's pending
     * auto-open -- has no counterpart here and needs none: its `currentSwimlane` was a
     * single variable shared by every row because ONE handler on the board's scope
     * served all of them, whereas each React row owns its own pending state. Moving the
     * pointer from one title to another necessarily fires the first title's
     * `mouseleave`, since the two are non-overlapping siblings, and that cancels it
     * through {@link cancelPendingHover}. The observable behaviour is identical.
     */
    const handleMouseOver = useCallback((): void => {
        // `main.coffee:1160` -- already pending for this swimlane: do nothing.
        if (pendingHoverRef.current !== null) {
            return;
        }

        /*
         * `main.coffee:1168` -- the entire body of the handler is inside
         * `if swimlane.classList.contains('folded')`, so hovering an ALREADY-OPEN
         * swimlane does nothing whatsoever. Reading the prop is equivalent to reading
         * that class, which `./SwimlaneHeader` renders from the same boolean.
         */
        if (!folded) {
            return;
        }

        /*
         * `main.coffee:1169`-`:1171` -- and only while a card is actually being
         * dragged. Without this gate merely resting the pointer on a folded swimlane
         * would expand it, which is not the incumbent's behaviour. See seam note 4 /
         * FINDING C for why the flag is a prop rather than a DOM probe.
         */
        if (!isDragging) {
            return;
        }

        setPendingToOpen(true);

        const timeoutId = window.setTimeout((): void => {
            // `main.coffee:1176`-`:1177`, in this order: clear the mark, then toggle.
            setPendingToOpen(false);
            onToggleSwimlane(swimlaneId);
        }, HOVER_AUTO_OPEN_DELAY_MS);

        pendingHoverRef.current = { timeoutId };
    }, [folded, isDragging, onToggleSwimlane, swimlaneId]);

    /*
     * Cancel any pending auto-open on unmount AND whenever the fold state changes
     * underneath it.
     *
     * The unmount half is the important one: the incumbent detaches its handlers on
     * `$destroy` (`main.coffee:1186`-`:1187`), and a surviving timer here would call
     * `onToggleSwimlane` for a row that no longer exists.
     *
     * The fold half fires immediately after a successful auto-open, since the toggle it
     * requested is what changes `folded`. That leaves the machine clean for the next
     * gesture instead of relying on a `mouseleave` that may never come -- a deliberate,
     * strictly-tidier reading of `main.coffee:1175`-`:1184`, which leaves its
     * `currentSwimlane` set. The two differ only if a user manages to re-fold the
     * swimlane by CLICK without the pointer ever leaving the title, and even then both
     * end in the same place: the incumbent's next hover bails on the stale pending
     * entry, this one bails on the `isDragging` or `folded` gate.
     */
    useEffect(() => {
        return (): void => {
            cancelPendingHover();
        };
    }, [folded, cancelPendingHover]);

    /* ----------------------------------------------------------------------
     * SEAM NOTE 5 -- the sticky swimlane title, horizontal axis.
     * -------------------------------------------------------------------- */

    /*
     * `main.coffee:1140`-`:1148`, reproduced mechanism for mechanism: listen for
     * `scroll` on the board root and write `translateX(<scrollLeft>px)` onto this row's
     * title, so the title stays pinned to the viewport's left edge while the board
     * scrolls sideways underneath it. Positive sign, same property, same event, same
     * measurement.
     *
     * ⛔ NOT reimplemented as `position: sticky`. The vertical axis already IS sticky
     * in CSS (`kanban-table.scss:414`-`:426`); the horizontal axis is imperative in the
     * source, and rule T1 forbids authoring the stylesheet change that would be needed
     * to move it. ⛔ No throttling, no `passive` option, no rAF coalescing: none of
     * that is in the source, and rule T10 rules out optimising beyond it.
     *
     * The scroll host is resolved by walking UP from this row's own element to the board
     * root, which is the very element the incumbent directive was declared on. That
     * keeps the lookup inside the board rather than making it a document-wide query,
     * and it is required rather than cosmetic: `scroll` events do not bubble, so a
     * listener on this row would never see the board's scroll.
     *
     * Run once, with no dependencies: neither the root element nor the scroll host
     * changes for the life of the row, and re-subscribing on every render would churn
     * a listener that fires dozens of times per gesture.
     */
    useEffect(() => {
        const root = rootRef.current;

        if (root === null) {
            return undefined;
        }

        const scrollHost = root.closest(BOARD_ROOT_SELECTOR);

        if (scrollHost === null) {
            /*
             * No board root above this row -- which happens when the component is
             * mounted on its own, as a spec does. There is nothing to pin against, so
             * no listener is registered; the row renders and folds identically.
             */
            return undefined;
        }

        const handleScroll = (): void => {
            let title = titleElementRef.current;

            if (title === null) {
                /*
                 * The source's `$el.find(".kanban-swimlane-title")`
                 * (`main.coffee:1142`), narrowed from every row to this one. Scoped to
                 * this component's own subtree, so it can never reach another row's
                 * title. A ref would be preferable, but `./SwimlaneHeader` forwards
                 * none and is must-not-modify.
                 */
                title = root.querySelector<HTMLElement>(SWIMLANE_TITLE_SELECTOR);
                titleElementRef.current = title;
            }

            if (title === null) {
                return;
            }

            /*
             * The ONE inline style in this file, and it is a scroll displacement rather
             * than a design value -- so rule T2 and the no-hardcoded-values rule are
             * untouched: there is no colour, spacing, radius or shadow here, and
             * nothing that a design token could express.
             *
             * `scrollHost` is read from the closure rather than from
             * `event.currentTarget`; they are the same element, and the closure keeps
             * the handler type-safe without a cast.
             */
            title.style.transform = `translateX(${scrollHost.scrollLeft}px)`;
        };

        scrollHost.addEventListener('scroll', handleScroll);

        return (): void => {
            // The equivalent of the source's `$el.off()` on `$destroy` (`:1186`-`:1187`).
            scrollHost.removeEventListener('scroll', handleScroll);
            titleElementRef.current = null;
        };
    }, []);

    /* ----------------------------------------------------------------------
     * SEAM NOTE 6 -- the body-mounted notification.
     * -------------------------------------------------------------------- */

    /**
     * The latest `onBodyLoaded`, held in a ref.
     *
     * ⭐ THIS IS WHAT TIES THE NOTIFICATION TO THE BODY'S MOUNT RATHER THAN TO THE
     * CALLBACK'S IDENTITY, which is precisely `tg-loaded`'s contract: it fires when the
     * element renders, once. Depending on the callback directly would re-notify on every
     * render in which the board passed a fresh closure -- harmless for the drag layer,
     * which de-duplicates, but wrong for anything else the board chooses to do there,
     * and impossible to assert.
     */
    const onBodyLoadedRef = useRef(onBodyLoaded);

    /*
     * Declared BEFORE the notifying effect so that, on a commit where the callback
     * changed AND the body mounted, effect order guarantees the fresh callback is the
     * one invoked. (React runs effects in declaration order.)
     */
    useEffect(() => {
        onBodyLoadedRef.current = onBodyLoaded;
    }, [onBodyLoaded]);

    const bodyRendered = isBodyRendered(bodyPhase);

    /*
     * Fires when the body element appears, and again after every fold/unfold remount --
     * see seam note 6 for why re-notifying is mandatory: `openSwimlane` re-queries this
     * swimlane's `.taskboard-column` elements and pushes them into the drag system's
     * container list, so columns rendered by a remount would otherwise never become
     * droppable.
     *
     * Keyed on the BOOLEAN, not on the phase, so it fires once per mount rather than
     * once per animation step -- `bodyRendered` stays true across `entering`,
     * `entering-active`, `present`, `leaving` and `leaving-active`.
     *
     * ⛔ This effect does not register anything, does not touch the drag layer and does
     * not care what the receiver does with the element (requirement I9).
     */
    useEffect(() => {
        if (!bodyRendered) {
            return;
        }

        const bodyEl = bodyRef.current;

        if (bodyEl === null) {
            return;
        }

        onBodyLoadedRef.current?.(swimlaneId, bodyEl);
    }, [bodyRendered, swimlaneId]);

    /* ----------------------------------------------------------------------
     * RENDER -- `kanban-table.jade` L73-L121.
     * -------------------------------------------------------------------- */

    return (
        /*
         * `div(class="kanban-swimlane" data-swimlane="{{swimlane.id}}")` -- L73-L77.
         *
         * A plain `div`, not a section or a list item: the source emits a `div` and rule
         * T10 forbids inventing semantics it does not have. ⛔ No `role`, no
         * `aria-expanded`, no `aria-labelledby`, no `tabIndex` and no keyboard handler
         * are added -- the fold control is the child `<button>`, which is keyboard
         * operable on its own account. The `ng-if` and the repeat that produced one of
         * these per swimlane stay with the owner.
         *
         * ⭐ Both the class name and `data-swimlane` are halves of the drag layer's
         * container selector, `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column`
         * -- seam note 2. Written as the literal hyphenated attribute exactly as the
         * source declares it (rule T1); React serialises the numeric id into the
         * attribute value, which is what makes `[data-swimlane="7"]` match.
         */
        <div className={ROOT_CLASS} data-swimlane={swimlaneId} ref={rootRef}>
            {/*
              * FIRST of exactly two children -- `button.kanban-swimlane-title`
              * (L79-L106). ⭐ A SIBLING of the body, never its parent: seam note 1.
              *
              * The two mouse callbacks are this file's half of the auto-open state
              * machine; the child renders `pending-to-open` from the boolean and owns no
              * timer (seam note 4). `onToggleSwimlane` is forwarded unchanged, so the
              * child raises it with its own swimlane's id and the two cannot disagree.
              */}
            <SwimlaneHeader
                swimlane={swimlane}
                folded={folded}
                pendingToOpen={pendingToOpen}
                defaultSwimlaneId={defaultSwimlaneId}
                swimlaneCount={swimlaneCount}
                onToggleSwimlane={onToggleSwimlane}
                onMouseOver={handleMouseOver}
                onMouseLeave={cancelPendingHover}
            />

            {/*
              * SECOND of exactly two children -- `div.kanban-table-body`
              * (L107-L110), CONDITIONALLY MOUNTED on not-folded exactly as its `ng-if`
              * is.
              *
              * ⭐ The condition is the ANIMATION PHASE, not the `folded` prop: that one
              * indirection is the whole of the deferred unmount, and therefore the whole
              * reason the fold animation survives the move to React (seam note 3). The
              * class attribute comes from the same phase, so the element's markup and
              * its lifetime can never disagree.
              *
              * ⛔ Nothing else is rendered inside this row -- no spacer, no divider, no
              * rule, no wrapper. The design reference measures zero pixels between the
              * band and the body and zero between consecutive swimlanes; emitting any
              * of them would be a defect.
              */}
            {bodyRendered ? (
                <div
                    className={resolveBodyClassName(bodyPhase)}
                    style={resolveBodyStyle(bodyPhase)}
                    ref={bodyRef}
                >
                    {/*
                      * `div.kanban-table-inner` (L111) -- EXACTLY ONE, wrapping ALL of
                      * the columns. Not an inert wrapper: it is the flex row AND it
                      * paints the body's edge shading through its own `::before`
                      * (seam note 7). One of three occurrences of this class name in
                      * the source, with three different owners.
                      */}
                    <div className={INNER_CLASS}>
                        {/*
                          * `ng-repeat="s in ::swimlanesStatuses[swimlane.id] track by
                          * s.id"` (L114).
                          *
                          * ⭐ `track by s.id` becomes React's `key`: identity follows
                          * the status id, so a column keeps its DOM node -- and with it
                          * anything the drag layer has registered against that node --
                          * across a re-render. ⛔ Never key by index.
                          *
                          * ⛔ Rendered in the received order with no sort, unfiltered,
                          * and with `swimlaneId` always supplied: `undefined` there is
                          * how `./StatusColumn` recognises FLAT mode, which
                          * `./KanbanBoard` renders directly. Every remaining value is
                          * threaded through unchanged -- this component adds no
                          * behaviour to any of them.
                          */}
                        {statuses.map(
                            (status: Status): ReactElement => (
                                <StatusColumn
                                    key={status.id}
                                    {...columnProps}
                                    {...resolveColumnState(status.id)}
                                    status={status}
                                    swimlaneId={swimlaneId}
                                />
                            ),
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/* ==========================================================================
 * EXPORTS
 *
 * Named exports only, matching the rest of `app/react`, and `export type` for the prop
 * types because `isolatedModules` is on and a value-position re-export of a type would
 * not survive compilation. No default export.
 * ========================================================================== */

/*
 * Memoised, and not as an ornament. The board re-renders every row whenever any card
 * moves or any card latches visible, while a row's own appearance changes only when its
 * swimlane, its statuses, its fold state, the drag flag or one of the column props
 * changes. Without the boundary, every card movement anywhere on the board would
 * re-render every column of every swimlane.
 *
 * The default shallow comparison is the correct one: every prop is a primitive, a plain
 * array or object the bridge hands over, or a callback the owner is expected to keep
 * stable -- see the note on {@link SwimlaneProps.resolveColumnState}.
 */
const Swimlane = memo(UnmemoizedSwimlane);
Swimlane.displayName = 'Swimlane';

export { Swimlane };
export type { SwimlaneProps, SwimlaneColumnState, SwimlaneColumnProps };
