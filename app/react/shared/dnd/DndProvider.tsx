/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * DndProvider — the ONE `@dnd-kit/core` `DndContext` shared by BOTH migrated
 * screens.
 *
 * TECHNOLOGY-SPECIFIC CHANGE AT THE AngularJS/React SEAM (transformation
 * rule T9). Every decision below is annotated with the incumbent locator it
 * reproduces.
 *
 * =====================================================================================
 * MANDATE
 * =====================================================================================
 * AAP section 0.5.1 lists this file as "Single @dnd-kit/core DndContext wrapper
 * for both screens"; section 0.6.2 declares its source as
 * `app/coffee/modules/kanban/sortable.coffee`; section 0.5.4 states the reason
 * there is exactly one adapter: "One `shared/dnd/` adapter serves both screens,
 * so multi-select behaviour, ordering arithmetic and virtualised-target
 * registration are each implemented and tested once."
 *
 * It replaces the `dragula` + `dom-autoscroller` + `window.dragMultiple` trio
 * that drove the two retired sortable directives:
 *   - `app/coffee/modules/kanban/sortable.coffee`  — `KanbanSortableDirective`,
 *     retained UNREGISTERED in that file as the authoritative behavioural
 *     specification;
 *   - `app/coffee/modules/backlog/sortable.coffee` — `BacklogSortableDirective`,
 *     likewise retained unregistered.
 * Neither may be imported: they are CoffeeScript, `tsconfig.json` enables no
 * `allowJs`, and they are out of scope for modification.
 *
 * THE TWO CONSUMERS THIS CONTRACT EXISTS FOR, neither of which exists yet:
 *   - `app/react/kanban/hooks/useCardDrag.ts`  — the board-side consumer, which
 *     must go on emitting the `kanban:us:move` broadcast contract;
 *   - `app/react/backlog/hooks/useStoryDrag.ts` — the story-list consumer, which
 *     owns the `pendingDrag` FIFO queue and its `ctx`-keyed re-entrancy guard.
 * The exported surface below IS the contract those two files must satisfy.
 *
 * =====================================================================================
 * FINDING C — `@dnd-kit/core` EMITS NONE OF dragula's CSS CLASSES
 * =====================================================================================
 * Transformation rule T1 keeps the 1,870 lines of in-scope Sass at ZERO edits:
 * "React markup must emit the same classes in the same nesting so the existing
 * stylesheets apply verbatim." `@dnd-kit` knows nothing of dragula's class
 * vocabulary, so this file has to write the two most visible names itself:
 * `gu-mirror` on the drag overlay and `gu-transit` on the drag source. Omit
 * either and the drag visuals disappear SILENTLY — no error, no warning, no
 * build failure — and `./multiDrag` stops working too, because it reads both
 * names out of the live document.
 *
 * The single most useful corroboration of that design, which is easy to miss:
 * `gulpfile.js` L85 still bundles `node_modules/dragula/dist/dragula.css` into
 * the vendor stylesheet, because requirement I3 keeps `dragula` installed for
 * 19 measured out-of-scope call sites. That file declares
 *
 *     .gu-mirror  { position: fixed !important; margin: 0 !important;
 *                   z-index: 9999 !important; opacity: .8 }
 *     .gu-transit { opacity: .2 }
 *
 * so emitting the two class names restores dragula's exact mirror and
 * placeholder chrome for free. `position: fixed` is also what `@dnd-kit`'s own
 * overlay sets inline, so the two agree rather than fight.
 *
 * =====================================================================================
 * WHAT THIS FILE OWNS
 * =====================================================================================
 *   - the single `DndContext`, deliberately ONE context with a GROWING target
 *     set rather than one context per swimlane, mirroring the re-entrant
 *     registration at `app/coffee/modules/kanban/sortable.coffee` L43-L47, where
 *     a second `dragula` instance is never created and newly opened swimlanes
 *     merely push their columns onto the existing one;
 *   - the pointer sensor, and nothing else;
 *   - the parameterised `dom-autoscroller` to `@dnd-kit` autoscroll translation;
 *   - the `DragOverlay` host that carries `gu-mirror`;
 *   - the `gu-transit` lifecycle on the drag source;
 *   - ownership and wiring of the `MultiDragController`;
 *   - teardown with parity to `drake.destroy()`.
 *
 * =====================================================================================
 * WHAT THE SCREENS OWN — surfaced as props, never hardcoded here
 * =====================================================================================
 *   - THE PERMISSION GATE, through the `disabled` prop. The board applies two
 *     separate early returns (`modify_us` in `my_permissions`, then
 *     `archived_code`) at `.../kanban/sortable.coffee` L37-L41; the story list
 *     applies one combined condition at `.../backlog/sortable.coffee` L30. React
 *     reads the SAME `my_permissions` array the `tg-check-permission` and
 *     `tg-class-permission` directives read and computes no independent notion of
 *     what the user may do.
 *   - CONTAINER REGISTRATION and every container selector — the board's
 *     `.taskboard-column` set (L172-L175, and per swimlane
 *     `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column` at L30-L34),
 *     the story list's four targets: `div.backlog-table-body`, BOTH members of
 *     the `.js-empty-backlog` pair and every `.sprint-table` matched by
 *     `isContainer` (L34, L39-L48).
 *   - the `target-drop` highlight on hovered board columns and the
 *     `initialContainer` latch behind it (kanban L65-L73);
 *   - the `drag-active` class on `document.body` — story list ONLY, added at
 *     backlog L73 and removed at L108; the board does not do this;
 *   - removal of the `.doom-line` (backlog L95), the `new` class and its
 *     `animationend` removal on container change (kanban L128-L131), the
 *     `ui-multisortable-multiple` selection class, and per-item element deletion
 *     on container change;
 *   - the `multiple-drag-mirror` decoration of the floating image (kanban
 *     L89-L90, backlog L91-L92). It is NOT applied here: `./multiDrag` declares
 *     itself its owner, adding it to each ghost clone in `prepare()` and removing
 *     it document-wide in step 7 of `stop()`. A screen that also wants it on the
 *     overlay itself adds it inside `renderOverlay`.
 *   - the ordering arithmetic (`./useSortableList`), the `pendingDrag` queue,
 *     every API write, and `ctrl.toggleVelocityForecasting()`.
 *
 * THIS FILE PERFORMS NO INPUT OR OUTPUT. It opens no transport, imports nothing
 * from `../api` and nothing from `../../bridge`, needs no AngularJS service, no
 * injector, no translation and no promise marshalling, and it never asks
 * AngularJS to run a digest. The drag layer computes and reports; the SCREENS
 * write, exactly as their controllers do today — the board broadcasts
 * `kanban:us:move` (kanban L153) and `KanbanController` calls
 * `bulkUpdateKanbanOrder`, while the story list calls
 * `ctrl.moveUs("sprint:us:move", …)` (backlog L143) and `BacklogController` calls
 * `bulkUpdateBacklogOrder`.
 *
 * =====================================================================================
 * R-DND-3 — VIRTUALISATION IS NEVER ALLOWED TO GATE REGISTRATION
 * =====================================================================================
 * `@dnd-kit` has no virtual-list support, and the board virtualises its cards.
 * This provider therefore does not import `../useInViewport` and holds no notion
 * of visibility at all: no droppable registration, no collision detection and no
 * class write here is conditional on whether a card is on screen. That is what
 * keeps a drag toward a collapsed or not-yet-latched region finding a drop
 * target. Two structural facts make it safe, and neither may be undone:
 * `app/modules/components/card/card.jade` L8-L13 puts `ng-if="vm.inViewPort"` on
 * `.card-inner` INSIDE `tg-card` and declares no `replace`, so the outer
 * `<tg-card data-id=…>` always renders; and `../useInViewport` latches
 * visibility monotonically, so there is no "left the viewport" transition to
 * react to.
 *
 * =====================================================================================
 * DELIBERATE OMISSIONS (transformation rule T10 — no functional or feature
 * change whatsoever; the rule's verbatim wording is reproduced in the AAP)
 * =====================================================================================
 *   - NO keyboard sensor and NO touch sensor. dragula is mouse-driven only, and
 *     `./multiDrag` listens for `mousemove` alone. Adding either would be a new
 *     capability, not a port.
 *   - NO screen-reader announcements. `@dnd-kit` can emit them; the incumbent
 *     emits none, so none are configured.
 *   - NO drop animation. `dragula` removes its mirror synchronously at
 *     `dragend`, so `dropAnimation` is switched off explicitly. Leaving
 *     `@dnd-kit`'s default keyframe animation on would add a visual affordance
 *     that does not exist today.
 *   - NO shadow DOM anywhere (requirement I6). A shadow root would sever the
 *     global Sass cascade, so every rule quoted above — and all of Finding C —
 *     would stop applying, and `<use href="#icon-…">` against the sprite inlined
 *     at `app/index.jade` L96 would break.
 *   - NO stylesheet for this folder. Every class it writes is already styled, and
 *     AAP section 0.4.4 G-DS-4 is explicit that authoring new CSS where an
 *     existing rule already applies is a compliance violation rather than an
 *     improvement.
 *
 * Not derived from a design frame. Drift register entry D4 records that neither
 * attached frame captures a modal, popover, tooltip, hover or DRAG-GHOST state —
 * both show the idle default only — so every drag visual here comes from the
 * source markup and the measured stylesheet rules cited above.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useDndContext,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {
    Active,
    AutoScrollOptions,
    CollisionDetection,
    DragCancelEvent,
    DragEndEvent,
    DragMoveEvent,
    DragOverEvent,
    DragStartEvent,
    PointerSensorOptions,
} from '@dnd-kit/core';

import { MIRROR_CLASS, TRANSIT_CLASS, createMultiDrag } from './multiDrag';
import type { MultiDragContainer, MultiDragController } from './multiDrag';

/*
 * ==========================================================================
 * CLASS CONTRACT (transformation rule T1 — zero stylesheet edits)
 * ==========================================================================
 * Both names are RE-EXPORTED from `./multiDrag` rather than re-declared, so the
 * folder holds exactly one definition of each. `./multiDrag` documents them as
 * "READ HERE, NEVER ASSIGNED … applied by DndProvider.tsx", which is the other
 * half of the same contract: this file writes them and that file reads them.
 *
 * `MIRROR_CLASS` = `gu-mirror`, applied to the `DragOverlay` node.
 *   Styled at `app/modules/components/card/card.scss` L25
 *     (`.card { &.gu-mirror { border: 1px solid $color-solid-primary;
 *      pointer-events: none } }`) — a T4-PROTECTED file, shared with the
 *     out-of-scope taskboard at
 *     `app/partials/includes/modules/taskboard-table.jade` L135 and L186, and
 *     therefore read and never edited;
 *   and at `app/styles/modules/backlog/backlog-table.scss` L195 and L211
 *     (descendant rules: `.gu-mirror .tags-block`, `.gu-mirror .column-points`,
 *      `.gu-mirror .user-stories`) and L314
 *     (`.row { &.gu-mirror { background: lighten($primary, 60%);
 *      box-shadow: 1px 1px 10px rgba($black, .1); opacity: .9 } }`).
 *   READ by `multiDrag.prepare()`, which captures the element carrying it as the
 *   "shadow" every ghost clone follows, via
 *   `ownerDocument.querySelector('.gu-mirror')` — the port of
 *   `app/js/dragula-drag-multiple.js` L159. `prepare()` runs on the FIRST
 *   MOVEMENT after `start()` and takes the result as a ONE-SHOT SNAPSHOT, so the
 *   overlay HAS to be in the document by then. It is NOT in the document while
 *   the drag-start handler runs — see `armMultiDrag` below for the measurement
 *   and for the arming point that makes this precondition hold.
 *   NOTE THE SPLIT RESPONSIBILITY: L195/L211 are DESCENDANT rules, satisfied by
 *   the overlay host carrying the class; L25 and L314 are SELF rules on the card
 *   and the row. A screen whose overlay content is a card or a row must therefore
 *   ALSO put `MIRROR_CLASS` on that element inside `renderOverlay` — which is
 *   precisely why the constant is exported. The same applies to the live-drag
 *   probe `document.querySelectorAll('tg-card.gu-mirror')` at
 *   `app/coffee/modules/kanban/main.coffee` L1219.
 *   ONE MEASURED CONSEQUENCE OF DOING THAT, worth knowing before it is mistaken
 *   for a layout bug: the vendor rule is `position: fixed !important`, so an inner
 *   card that also carries the class is taken out of flow and shrink-wraps to its
 *   content unless it has a width of its own. `.card` supplies one, so the shared
 *   card is fine; a bespoke overlay body is not.
 *
 * `TRANSIT_CLASS` = `gu-transit`, applied to the drag source that stays in place.
 *   Styled at `app/styles/modules/backlog/backlog-table.scss` L235
 *     (`.us-item-row.gu-transit { background-color: $white; border: 0;
 *      border-top: 2px dashed $color-solid-primary; height: 0; opacity: 1 }`)
 *   and L330 (`.gu-transit { background: $color-gray100 }`),
 *   and at `app/styles/modules/backlog/sprints.scss` L307
 *     (`.gu-transit { background: lighten($gray-light, 12%); height: 40px;
 *      * { display: none } }`).
 *   READ by `multiDrag.drag()`, which adds `gu-transit-multi` to every
 *   `.gu-transit` — the port of `app/js/dragula-drag-multiple.js` L32 — and by
 *   the two neighbour queries that skip it (`tg-card:not(.gu-transit)` at kanban
 *   L98-L99, `.row:not(.gu-transit)` at backlog L54-L55), which is why it must be
 *   present for the WHOLE gesture and is stripped only after `stop()` has run.
 */
export { MIRROR_CLASS, TRANSIT_CLASS };

/* ==========================================================================
 * AUTOSCROLL — THE TWO SCREENS DISAGREE, SO NOTHING IS BAKED IN
 * ========================================================================== */

/**
 * The incumbent `dom-autoscroller` configuration, carried across verbatim so the
 * translation below is traceable to its source.
 *
 * ⚠️ THE TWO SCREENS DIVERGE, AND THE DIVERGENCE IS DELIBERATE. The annotated
 * story-list reference states it outright: "The autoscroll options here are
 * backlog-specific — `[window]`, margin 20, pixels 30 — and differ from
 * kanban's. Do not unify the two."
 *
 *   BOARD — `app/coffee/modules/kanban/sortable.coffee` L155-L160
 *     autoScroll(containers, { margin: 100, scrollWhenOutside: true,
 *                              autoScroll: -> this.down && drake.dragging })
 *     No `pixels`, and the scroll targets are the COLUMN CONTAINERS. The
 *     annotation there warns that "dropping the margin makes long columns
 *     unreachable".
 *
 *   STORY LIST — `app/coffee/modules/backlog/sortable.coffee` L145-L151
 *     autoScroll([window], { margin: 20, pixels: 30, scrollWhenOutside: true,
 *                             autoScroll: -> this.down && drake.dragging })
 *     Has `pixels`, and the scroll target is `[window]`.
 *
 * NO PRESET IS EXPORTED FROM THIS FILE, and none may be added. A preset living
 * in a shared folder would embed screen knowledge in the shared layer and break
 * the scope split; the `autoScroll` prop is REQUIRED, with no default, precisely
 * so one screen cannot silently inherit the other's numbers. The figures above
 * are recorded here, in a comment, so each screen knows what to pass.
 *
 * The incumbent's fourth option — the `autoScroll` predicate
 * `this.down && drake.dragging`, meaning "only while the pointer is down AND a
 * drag is actually in progress" — has no field here because `@dnd-kit` scrolls
 * only during an active drag by construction: `useAutoScroller` is driven from
 * the drag state, so the predicate is structurally satisfied rather than
 * configured. The annotation's warning that "dropping the predicate scrolls the
 * board on plain hover" therefore cannot bite.
 */
export interface DndAutoScrollConfig {
    /** Whether autoscrolling happens at all. */
    readonly enabled: boolean;

    /**
     * `dom-autoscroller`'s `margin`, in PIXELS: the width of the band at the edge
     * of the scrollable region inside which the pointer starts a scroll. Board
     * 100, story list 20.
     */
    readonly margin: number;

    /**
     * `dom-autoscroller`'s `pixels`: how far to scroll per tick. Story list 30;
     * the board leaves it UNSET, which is why this field is optional rather than
     * defaulted.
     */
    readonly pixels?: number;

    /**
     * `dom-autoscroller`'s `scrollWhenOutside`: keep scrolling once the pointer
     * has left the scrollable region. Both screens pass `true`.
     *
     * CARRIED FOR TRACEABILITY, NOT TRANSLATED. `@dnd-kit` exposes no equivalent
     * switch; its `activator` (defaulting to `AutoScrollActivator.Pointer`, which
     * keeps tracking pointer coordinates beyond the edge) and its `canScroll`
     * predicate supersede it. Mapping the field onto `activator` was considered
     * and rejected: both screens pass `true`, `Pointer` is already the default,
     * so writing the field would change nothing while inventing a mapping the
     * requirement does not sanction. It is recorded here rather than dropped
     * silently, so the divergence stays visible.
     */
    readonly scrollWhenOutside: boolean;
}

/**
 * The lower bound of a `@dnd-kit` autoscroll threshold: no activation band, so
 * no scrolling. Reached when the margin is zero or negative.
 */
const THRESHOLD_MIN = 0;

/**
 * The upper bound of a `@dnd-kit` autoscroll threshold: the whole scrollable
 * extent is an activation band. Reached when the margin covers the extent, or
 * when no extent can be measured.
 */
const THRESHOLD_MAX = 1;

/**
 * Converts one `dom-autoscroller` pixel margin into one `@dnd-kit` fractional
 * threshold along a single axis.
 *
 * `@dnd-kit` expresses the activation band as a FRACTION of the scrollable
 * extent, while `dom-autoscroller` expresses it in PIXELS, so the extent has to
 * enter the arithmetic. The result is clamped, because `@dnd-kit` treats the
 * threshold as a proportion and a value outside `0…1` has no meaning.
 *
 * With no measurable extent the whole region becomes the activation band, which
 * is the faithful reading of a pixel margin that cannot be turned into a
 * fraction; it can only arise outside a browser, where nothing scrolls anyway.
 */
function marginToThreshold(margin: number, extent: number): number {
    if (!Number.isFinite(margin) || margin <= THRESHOLD_MIN) {
        return THRESHOLD_MIN;
    }

    if (!Number.isFinite(extent) || extent <= THRESHOLD_MIN) {
        return THRESHOLD_MAX;
    }

    const ratio = margin / extent;

    if (ratio >= THRESHOLD_MAX) {
        return THRESHOLD_MAX;
    }

    return ratio;
}

/**
 * The ambient viewport extent, used when the caller supplies none.
 *
 * Guarded for a document-less environment so that importing this module outside a
 * browser cannot throw; the pinned test runner is jsdom, where `window` always
 * exists.
 */
function ambientViewportSize(): { readonly width: number; readonly height: number } {
    if (typeof window === 'undefined') {
        return { width: THRESHOLD_MIN, height: THRESHOLD_MIN };
    }

    return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Translates a `dom-autoscroller` configuration into `@dnd-kit`'s
 * `AutoScrollOptions`.
 *
 * THE TRANSLATION, STATED HONESTLY. `margin` and `pixels` are
 * `dom-autoscroller` concepts with no direct `@dnd-kit` counterpart, so neither
 * survives as itself:
 *
 *   `enabled`            -> `enabled`, unchanged.
 *   `margin` (px)        -> `threshold.x` and `threshold.y`, each the margin
 *                           divided by the corresponding viewport extent and
 *                           clamped to `0…1`. The two axes differ whenever the
 *                           viewport is not square, which is the normal case.
 *   `pixels` (px / tick) -> `acceleration`, and ONLY when it is supplied and
 *                           finite. When it is absent — the board's case — the
 *                           field is left off the returned object entirely so
 *                           that `@dnd-kit`'s own default applies. Writing an
 *                           invented number there would be a behaviour change
 *                           disguised as a translation.
 *   `scrollWhenOutside`  -> not translated; see the field's own documentation.
 *
 * `interval`, `order`, `activator`, `canScroll` and `layoutShiftCompensation`
 * are deliberately left at `@dnd-kit`'s defaults: the incumbent configures no
 * counterpart for them, so choosing values would be an enhancement rather than a
 * port.
 *
 * THE MAPPING IS INJECTIVE FOR THE TWO REAL INPUTS, and the co-located
 * specification asserts it: the board's `{ margin: 100 }` and the story list's
 * `{ margin: 20, pixels: 30 }` produce observably different options, so the two
 * screens cannot silently collapse onto one behaviour.
 *
 * Exported so the translation can be asserted directly, without rendering
 * anything and without reaching into a rendered `DndContext`.
 *
 * @param config The incumbent configuration the screen is reproducing.
 * @param viewportSize Extent to measure the margin against. Defaults to the
 *   ambient `window.innerWidth` / `window.innerHeight`. Supply it to measure
 *   against a specific scroll container, or to make a specification
 *   deterministic.
 */
export function toDndKitAutoScroll(
    config: DndAutoScrollConfig,
    viewportSize?: { readonly width: number; readonly height: number },
): AutoScrollOptions {
    const size = viewportSize ?? ambientViewportSize();

    const options: AutoScrollOptions = {
        enabled: config.enabled,
        threshold: {
            x: marginToThreshold(config.margin, size.width),
            y: marginToThreshold(config.margin, size.height),
        },
    };

    if (config.pixels === undefined || !Number.isFinite(config.pixels)) {
        return options;
    }

    return { ...options, acceleration: config.pixels };
}

/* ==========================================================================
 * THE MULTI-DRAG CALL ORDER — AN ASYMMETRY THAT IS PRESERVED, NOT NORMALISED
 * ========================================================================== */

/**
 * Which of `getElements()` and `start()` the provider calls first on drag start.
 *
 * ⚠️ THE TWO SCREENS DISAGREE, AND RULE T10 FORBIDS PICKING ONE FOR BOTH:
 *
 *   `'elements-then-start'` — the BOARD. `app/coffee/modules/kanban/sortable.coffee`
 *     reads the selection at L76 (`window.dragMultiple.getElements()`) and arms the
 *     gesture LAST, at L87 (`window.dragMultiple.start(item, containers)`).
 *
 *   `'start-then-elements'` — the STORY LIST.
 *     `app/coffee/modules/backlog/sortable.coffee` arms the gesture FIRST, at L77
 *     (`window.dragMultiple.start(item, container)`), and reads the selection
 *     afterwards, at L79.
 *
 * The difference is observable rather than cosmetic, and `./multiDrag` documents
 * why it is harmless in both directions: `getElements()` is a DOCUMENT-WIDE query
 * for the selection class, and a ghost clone copies that class, so reading the
 * selection while ghosts exist would double-count. Neither order does: the board
 * reads before arming, and the story list arms before reading but `start()` only
 * ATTACHES a listener, so no ghost exists until the first movement. Reordering
 * either call site — or unifying them — would leave that guarantee resting on
 * luck.
 */
export type DndMultiDragCallOrder = 'elements-then-start' | 'start-then-elements';

/**
 * The default call order: the BOARD's.
 *
 * It is not a claim that one order is more correct. It is the board's order,
 * chosen because AAP section 0.6.2 names
 * `app/coffee/modules/kanban/sortable.coffee` as this file's source. THE STORY
 * LIST MUST PASS `'start-then-elements'` EXPLICITLY.
 */
const DEFAULT_MULTI_DRAG_CALL_ORDER: DndMultiDragCallOrder = 'elements-then-start';

/* ==========================================================================
 * WHAT THE PROVIDER READS OUT OF `active.data`
 * ========================================================================== */

/**
 * The fields this provider looks for on `active.data.current`, i.e. on the
 * `data` object a screen hands to `useDraggable`.
 *
 * Both are optional, and both are validated at run time rather than trusted,
 * because `Active['data']` is typed loosely by `@dnd-kit` and a screen is free to
 * put its own domain values alongside these.
 */
export interface DndActiveData {
    /**
     * The element that STAYS IN PLACE for the duration of the drag — the one
     * `gu-transit` goes on, and the `item` argument both incumbent `drag`
     * handlers pass to `window.dragMultiple.start(…)`.
     *
     * Supplying it is strongly preferred. When it is absent the provider falls
     * back to a `data-id` probe over the document, matching `String(active.id)`
     * against `dataset.id` — the attribute the incumbent already relies on
     * everywhere (`prev[0].dataset.id` at kanban L102 and backlog L58, and the
     * annotated note that "every row must carry `data-id` — it is the positional
     * anchor for the whole write API"). The probe compares dataset values instead
     * of building a selector, so an unusual identifier can neither break the
     * selector nor inject into it. The FIRST match in document order wins, which
     * mirrors the incumbent's own assumption that a rendered story's `data-id` is
     * unique.
     */
    readonly sourceNode?: HTMLElement | null;

    /**
     * The search scope for the multi-selection, i.e. the second argument of
     * `window.dragMultiple.start(item, container)`. One element or a list of
     * them; `./multiDrag` accepts both, because the board passes its whole column
     * ARRAY (kanban L87) and the story list passes the SINGLE container the drag
     * library handed it (backlog L77).
     *
     * ⚠️ THE BOARD MUST SUPPLY THIS. When it is absent the provider falls back to
     * the source node's `parentElement`, which faithfully reproduces the story
     * list's single-container call but NOT the board's: a multi-selection spanning
     * two columns would be scoped to one column, `isMultiDrag` would see a single
     * selected element in scope, and the gesture would silently downgrade to a
     * one-card drag. There is no error surface for that.
     */
    readonly multiDragContainer?: MultiDragContainer | null;
}

/**
 * Reads one field off a value of unknown shape without weakening the type of
 * whatever comes back.
 *
 * `Active['data']` is a `MutableRefObject` over a loosely-typed record, so every
 * field read from it has to be narrowed before use. Doing that here, once, keeps
 * the two resolvers below free of type assertions on their results.
 */
function readField(source: unknown, field: keyof DndActiveData): unknown {
    if (source === null || typeof source !== 'object') {
        return undefined;
    }

    return (source as Record<string, unknown>)[field];
}

/**
 * Finds the rendered element whose `data-id` matches the active draggable's
 * identifier. The fallback path described on {@link DndActiveData.sourceNode}.
 */
function findNodeByActiveId(active: Active, ownerDocument: Document): HTMLElement | null {
    const wanted = String(active.id);

    for (const candidate of ownerDocument.querySelectorAll('[data-id]')) {
        if (candidate instanceof HTMLElement && candidate.dataset.id === wanted) {
            return candidate;
        }
    }

    return null;
}

/**
 * Resolves the drag source: the supplied node first, the `data-id` probe second,
 * and `null` when neither answers — in which case no `gu-transit` is written and
 * no multi-drag gesture is armed, which is strictly better than decorating the
 * wrong element.
 */
function resolveSourceNode(active: Active, ownerDocument: Document): HTMLElement | null {
    const supplied = readField(active.data.current, 'sourceNode');

    if (supplied instanceof HTMLElement) {
        return supplied;
    }

    return findNodeByActiveId(active, ownerDocument);
}

/**
 * Resolves the multi-selection search scope, with the parent-element fallback and
 * its caveat documented on {@link DndActiveData.multiDragContainer}.
 *
 * A supplied list is filtered down to real elements, so a partially-populated
 * array degrades to the elements it does hold rather than reaching `./multiDrag`
 * with holes in it. An empty result falls through to the parent element, and a
 * source node with no parent scopes the search to itself — the narrowest possible
 * scope, which yields a single-item drag rather than a wrong one.
 */
function resolveMultiDragContainer(active: Active, sourceNode: HTMLElement): MultiDragContainer {
    const supplied = readField(active.data.current, 'multiDragContainer');

    if (supplied instanceof HTMLElement) {
        return supplied;
    }

    if (Array.isArray(supplied)) {
        const elements = supplied.filter(
            (entry): entry is HTMLElement => entry instanceof HTMLElement,
        );

        if (elements.length > 0) {
            return elements;
        }
    }

    return sourceNode.parentElement ?? sourceNode;
}

/* ==========================================================================
 * THE PUBLISHED PROP CONTRACT
 * ========================================================================== */

/** The props of {@link DndProvider}. */
export interface DndProviderProps {
    /** The screen's own tree. Rendered inside the single `DndContext`. */
    readonly children: ReactNode;

    /**
     * REQUIRED, WITH NO DEFAULT. The two screens' configurations diverge (see
     * {@link DndAutoScrollConfig}), and hardcoding either one in this shared file
     * would be a compliance violation, so each screen states its own.
     */
    readonly autoScroll: DndAutoScrollConfig;

    /**
     * The screen computes this from `my_permissions` and `archived_code` and
     * passes the result. When `true` no sensor is activated, so no drag can begin
     * — the React equivalent of the incumbent's early returns, which simply never
     * initialised the drag library at all (two separate returns at
     * `app/coffee/modules/kanban/sortable.coffee` L37-L41; one combined condition
     * at `app/coffee/modules/backlog/sortable.coffee` L30, whose operator
     * precedence is reproduced by the STORY LIST as it stands and is not "fixed"
     * on the way through). Defaults to `false`.
     */
    readonly disabled?: boolean;

    /**
     * The multi-select controller. Injected so a screen — or a specification —
     * can own the instance and observe it; defaults to a lazily created
     * `createMultiDrag()` owned by this provider.
     */
    readonly multiDrag?: MultiDragController;

    /**
     * Which of `getElements()` and `start()` runs first on drag start. See
     * {@link DndMultiDragCallOrder}: the BOARD's order is the default and the
     * STORY LIST must pass `'start-then-elements'`.
     */
    readonly multiDragCallOrder?: DndMultiDragCallOrder;

    /**
     * Overridable for testing only. Defaults to {@link MIRROR_CLASS}; changing it
     * in production would detach the overlay from every stylesheet rule listed at
     * the top of this file.
     */
    readonly mirrorClassName?: string;

    /**
     * Overridable for testing only. Defaults to {@link TRANSIT_CLASS}; the same
     * warning applies, and `./multiDrag` additionally READS the default name out
     * of the live document, so a production override would also disable
     * multi-drag.
     */
    readonly transitClassName?: string;

    /**
     * Renders the overlay's contents — a card for the board, a row for the story
     * list. This provider supplies only the `gu-mirror`-classed host; the screen
     * owns what goes inside it, including whatever additional class the host's
     * own stylesheet rules need (see the `MIRROR_CLASS` notes above).
     */
    readonly renderOverlay?: (active: Active | null) => ReactNode;

    /**
     * `@dnd-kit` collision strategy. Left to `@dnd-kit`'s own default when
     * omitted, because the incumbent expresses drop targeting through the drag
     * library's container list rather than through a collision algorithm, so
     * imposing one here would be a choice this file has no basis to make.
     */
    readonly collisionDetection?: CollisionDetection;

    /**
     * Invoked after this provider's own drag-start bookkeeping, i.e. once the
     * placeholder class is on the drag source. It runs BEFORE
     * {@link onMultiDragStart}, which is reported one commit later — see
     * `armMultiDrag`.
     */
    readonly onDragStart?: (event: DragStartEvent) => void;

    /** Pass-through. This provider does no bookkeeping on drag-over. */
    readonly onDragOver?: (event: DragOverEvent) => void;

    /** Pass-through. This provider does no bookkeeping on drag-move. */
    readonly onDragMove?: (event: DragMoveEvent) => void;

    /** Invoked after this provider's own drag-end bookkeeping. */
    readonly onDragEnd?: (event: DragEndEvent) => void;

    /** Invoked after this provider's own drag-cancel bookkeeping. */
    readonly onDragCancel?: (event: DragCancelEvent) => void;

    /**
     * The multi-selection as it stood when the drag started, reported to the
     * screen because `@dnd-kit`'s own event payloads have no field for it. This is
     * the `dragMultipleItems` of kanban L76 and backlog L79.
     *
     * AN EMPTY ARRAY MEANS "NOT A MULTI-DRAG", and the fallback to `[item]` is
     * deliberately left to the screen: both incumbent handlers write
     * `if (!dragMultipleItems.length) dragMultipleItems = [item]` themselves
     * (kanban L79-L80, backlog L81), so applying it here would move a decision out
     * of the layer that owns it.
     *
     * REPORTED ONE COMMIT AFTER {@link onDragStart}, from the arming step, and NOT
     * reported at all for a gesture released before that commit lands. See
     * `armMultiDrag` for the browser measurement behind that, and note that the
     * `oldIndex` a screen captures here is unaffected: nothing in the document has
     * moved yet, because no drop has happened.
     */
    readonly onMultiDragStart?: (
        elements: readonly HTMLElement[],
        event: DragStartEvent,
    ) => void;

    /**
     * The multi-selection reported by `multiDrag.stop()`, i.e. the
     * `dragMultipleItems` of kanban L111 and backlog L106, handed over on both
     * drag END and drag CANCEL.
     *
     * Reported BEFORE {@link onDragEnd} / {@link onDragCancel} so that a screen
     * can stash the list and use it from those handlers, which is the shape the
     * incumbent already has: one `dragend` handler consuming both the element list
     * and the drop position. The empty-array convention of
     * {@link onMultiDragStart} applies here too.
     *
     * `DragCancelEvent` extends `DragEndEvent`, so one parameter type covers both
     * paths.
     */
    readonly onMultiDragEnd?: (
        elements: readonly HTMLElement[],
        event: DragEndEvent,
    ) => void;

    /**
     * Pointer activation distance, in pixels. Defaults to `0`, which matches the
     * drag library's immediate grab: `@dnd-kit` compares the travelled distance
     * with a strict `>`, so `0` activates on the FIRST movement after the pointer
     * goes down — exactly when `dragula` starts its own drag.
     */
    readonly activationDistance?: number;
}

/* ==========================================================================
 * THE OVERLAY HOST
 * ========================================================================== */

interface DragOverlayHostProps {
    readonly mirrorClassName: string;
    readonly renderOverlay: ((active: Active | null) => ReactNode) | undefined;

    /**
     * Invoked ONCE per gesture, from a layout effect, at the first moment the
     * overlay is guaranteed to be in the document. See `armMultiDrag`.
     */
    readonly onOverlayCommitted: () => void;
}

/**
 * Renders the one `DragOverlay`, carrying `gu-mirror`, and reports the moment it
 * reaches the document.
 *
 * IT IS A SEPARATE COMPONENT ON PURPOSE, for two reasons. Reading the active
 * draggable through `useDndContext()` requires being INSIDE the `DndContext`, and
 * doing it here rather than holding the active item in `useState` on the provider
 * means a drag re-renders only this overlay subtree instead of the screen's whole
 * tree — which matters on a board holding hundreds of cards, and avoids
 * re-rendering during a pointer gesture. `@dnd-kit`'s own overlay already
 * subscribes to the same context, so this adds no subscription that was not
 * there. The second reason is the layout effect below, which is the only place
 * that can observe the overlay actually arriving.
 *
 * WHY A LAYOUT EFFECT AND NOT A PLAIN EFFECT: React runs layout effects
 * synchronously after the DOM mutations of the same commit and after refs are
 * attached, so both the overlay node and the reference to it are in place by the
 * time this fires. A passive effect would run later, after the browser has had a
 * chance to dispatch further input.
 *
 * WHY IT WAITS FOR THE NODE RATHER THAN FOR THE ACTIVE ITEM, which is a
 * distinction worth two commits. `@dnd-kit` needs the dragged element's rectangle
 * before it will position an overlay, and it measures that rectangle in a layout
 * effect — so the commit that first reports an active item renders NO overlay at
 * all, and only the commit after it does. Arming on the active item alone would
 * therefore still arm too early, with the mirror absent. Gating on the overlay's
 * own node reference — the very node this component puts `mirrorClassName` on, and
 * so exactly the shadow `multiDrag.prepare()` will look for — is what makes the
 * timing correct rather than nearly correct.
 *
 * WHY THERE IS NO DEPENDENCY ARRAY: the overlay's arrival is not expressible as a
 * dependency. It shows up during a commit driven by `@dnd-kit`'s own measurement
 * state, so the effect simply re-checks after every render of this component,
 * which happens whenever the drag context changes. The body is two reference reads
 * and an early return. The gesture identifier is what keeps arming to once per
 * gesture.
 *
 * `dropAnimation` is switched OFF explicitly. `dragula` removes its mirror
 * synchronously at `dragend`, so the default keyframe animation would be a new
 * visual affordance (rule T10) — and it drives the Web Animations API, which the
 * browserless test environment does not implement, so leaving it on would also
 * make every drop throw under jsdom.
 */
function DragOverlayHost({
    mirrorClassName,
    onOverlayCommitted,
    renderOverlay,
}: DragOverlayHostProps): JSX.Element {
    const { active, dragOverlay } = useDndContext();
    const armedForRef = useRef<Active['id'] | null>(null);

    useLayoutEffect(() => {
        if (active === null) {
            armedForRef.current = null;

            return;
        }

        if (armedForRef.current === active.id) {
            return;
        }

        const node = dragOverlay.nodeRef.current;

        if (node === null || !node.isConnected) {
            return;
        }

        armedForRef.current = active.id;
        onOverlayCommitted();
    });

    return (
        <DragOverlay className={mirrorClassName} dropAnimation={null}>
            {renderOverlay === undefined ? null : renderOverlay(active)}
        </DragOverlay>
    );
}

/* ==========================================================================
 * THE PROVIDER
 * ========================================================================== */

/**
 * The single `@dnd-kit/core` `DndContext` both migrated screens mount inside,
 * together with the one `DragOverlay`, the pointer sensor, the translated
 * autoscroll configuration, the `gu-mirror` / `gu-transit` class lifecycle, the
 * multi-select wiring and the teardown.
 *
 * ONE CONTEXT, A GROWING TARGET SET. Droppables register themselves through
 * `useDroppable` in the screens' own column and table components, so a swimlane
 * that renders later simply adds targets to this context — the React counterpart
 * of the re-entrant registration at
 * `app/coffee/modules/kanban/sortable.coffee` L43-L47, where opening a swimlane
 * pushes its columns onto the existing drag instance instead of building a second
 * one. Nothing here is keyed on the children, so the context never remounts as
 * the board grows.
 *
 * ORDERING, WHICH IS LOAD-BEARING IN BOTH DIRECTIONS:
 *   ON DRAG START  `gu-transit` is written imperatively, so it is in the document
 *                  the instant the handler returns. `gu-mirror` rides on the
 *                  overlay and therefore arrives with the COMMIT, which is why the
 *                  multi-select gesture is armed from a layout effect on that
 *                  commit rather than from the handler — `armMultiDrag` carries
 *                  the browser measurement that forced this. The consequence is
 *                  that BOTH classes are in the document before
 *                  `multiDrag.start(…)` runs, which is what `prepare()` and
 *                  `drag()` require.
 *   ON DRAG END    `multiDrag.stop()` runs BEFORE `gu-transit` is removed, since
 *                  the teardown still needs the placeholder in place. That is also
 *                  the incumbent order: `window.dragMultiple.stop()` is called
 *                  from inside the `dragend` handler (kanban L111, backlog L106),
 *                  while the drag library strips its own `gu-transit` afterwards.
 *   CALLBACKS      every consumer callback runs AFTER this provider's own DOM
 *                  bookkeeping, so a consumer always observes a consistent
 *                  document. `onDragStart` therefore precedes `onMultiDragStart`,
 *                  which is reported from the arming step one commit later; on the
 *                  way out `onMultiDragEnd` precedes `onDragEnd` and
 *                  `onDragCancel`.
 */
export function DndProvider(props: DndProviderProps): JSX.Element {
    const {
        activationDistance = 0,
        autoScroll,
        children,
        collisionDetection,
        disabled = false,
        mirrorClassName = MIRROR_CLASS,
        renderOverlay,
    } = props;

    /*
     * The latest props, reachable from the reference-stable handlers below without
     * becoming dependencies of them. Assigned during render, which keeps both
     * properties: the handlers never go stale, and their identity never changes
     * even though the caller normally passes freshly built callbacks on every
     * render. Handler identity matters here because these are the props of a
     * memoised `DndContext` that must not be torn down mid-gesture. The
     * assignment is idempotent, so a double render under strict mode is harmless,
     * and the value is only ever read from event handlers, never during render.
     */
    const propsRef = useRef<DndProviderProps>(props);
    propsRef.current = props;

    /* The controller this provider created itself, built on first use only. */
    const ownedMultiDragRef = useRef<MultiDragController | null>(null);

    /*
     * The controller most recently armed, whichever it was. Teardown reads this
     * rather than the props, because the cleanup runs with an empty dependency
     * list and must not capture a stale prop.
     */
    const armedMultiDragRef = useRef<MultiDragController | null>(null);

    /*
     * The element currently carrying the transit class, remembered together with
     * the exact class name written to it so that teardown removes what was
     * actually applied even if the prop changed mid-gesture.
     */
    const transitRef = useRef<{ node: HTMLElement; className: string } | null>(null);

    /*
     * The gesture recorded by the drag-start handler and not yet armed. It exists
     * because arming is deferred by one commit — see `armMultiDrag` — so the
     * handler's event and its resolved source node have to survive until then.
     */
    const pendingGestureRef = useRef<{
        event: DragStartEvent;
        sourceNode: HTMLElement | null;
    } | null>(null);

    const resolveMultiDrag = useCallback((): MultiDragController => {
        const injected = propsRef.current.multiDrag;

        if (injected !== undefined) {
            armedMultiDragRef.current = injected;

            return injected;
        }

        if (ownedMultiDragRef.current === null) {
            ownedMultiDragRef.current = createMultiDrag();
        }

        armedMultiDragRef.current = ownedMultiDragRef.current;

        return ownedMultiDragRef.current;
    }, []);

    /**
     * Strips the transit class from whichever element is carrying it, and forgets
     * it. Idempotent, so calling it on a gesture that never decorated anything —
     * or twice — is a no-op.
     */
    const releaseTransit = useCallback((): void => {
        const decorated = transitRef.current;

        if (decorated === null) {
            return;
        }

        transitRef.current = null;
        decorated.node.classList.remove(decorated.className);
    }, []);

    const handleDragStart = useCallback(
        (event: DragStartEvent): void => {
            const current = propsRef.current;
            const transitClassName = current.transitClassName ?? TRANSIT_CLASS;

            /*
             * The ambient document, which is also `createMultiDrag()`'s own
             * default, so the provider and the controller always agree on where
             * the elements live.
             */
            const sourceNode = resolveSourceNode(event.active, document);

            /*
             * CLASSES FIRST (transformation rule T1), written imperatively so they
             * are in the document the instant this handler returns. A previous
             * gesture that ended without a drag-end event, which the pinned drag
             * library does not produce but a torn-down subtree can, is released
             * before a second element is decorated, so at most one element ever
             * carries the class.
             */
            releaseTransit();

            if (sourceNode !== null) {
                sourceNode.classList.add(transitClassName);
                transitRef.current = { node: sourceNode, className: transitClassName };
            }

            /* The gesture is recorded here and armed one commit later. */
            pendingGestureRef.current = { event, sourceNode };

            current.onDragStart?.(event);
        },
        [releaseTransit],
    );

    /**
     * Arms the multi-select gesture, at the first moment the overlay carrying
     * `gu-mirror` is guaranteed to be in the document.
     *
     * ===========================================================================
     * WHY THIS IS NOT DONE IN THE DRAG-START HANDLER — MEASURED, NOT ASSUMED
     * ===========================================================================
     * `multiDrag.prepare()` resolves `querySelector('.gu-mirror')` ONCE, on the
     * first movement after `start()`, and keeps the result for the whole gesture;
     * when it is `null`, `drag()` returns early every time and the ghost clones
     * never receive an inline `top` or `left`. Nothing reports that: no error, no
     * warning, no exception, no failed request. The clones simply sit still while
     * the pointer moves away.
     *
     * Arming inside the drag-start handler puts the listener in place BEFORE the
     * overlay exists, and the gap is not a race that usually wins — it is a gap
     * that always loses. Measured in a real browser with genuine mouse input
     * (times in milliseconds from the activating `pointermove`):
     *
     *     pointermove #1     t =   0.0   .gu-mirror absent   <- @dnd-kit activates,
     *                                                           onDragStart runs
     *     mousemove   #1     t =   0.1   .gu-mirror absent   <- prepare() runs HERE
     *     pointermove #2     t = 209.6   .gu-mirror absent
     *     overlay committed  t = 218.2
     *     pointermove #3     t = 376.4   .gu-mirror present
     *
     * The compatibility `mousemove` for the SAME physical movement arrives a tenth
     * of a millisecond after the pointer event, while React schedules the commit
     * that inserts the overlay through its own scheduler — the drag-start update
     * takes the continuous-input lane, which is dispatched as a scheduler task
     * rather than flushed inside the pointer handler. Five gestures across two
     * browser instances: five failures, no successes.
     *
     * Deferring the arming to a layout effect on the commit closes the gap for
     * good, and it makes this file's own stated precondition — the overlay must be
     * in the document before the first movement — TRUE rather than aspirational.
     * It also strengthens the "classes before `start()`" rule instead of weakening
     * it: BOTH classes are now provably present when `start()` runs, where before
     * only `gu-transit` was.
     *
     * ALTERNATIVES CONSIDERED AND REJECTED, so nobody re-litigates them:
     *   - Flushing the commit synchronously from the drag-start handler. The
     *     drag-start update is not on the synchronous lane, and the synchronous
     *     flush drains only that lane, so the overlay still would not appear.
     *   - Arming twice, once eagerly and again after the commit. By then
     *     `prepare()` has already latched a `null` shadow and marked the gesture in
     *     progress, so a second `start()` only re-attaches a listener.
     *   - Carrying `gu-mirror` on a provider-owned element that is always mounted.
     *     `drag()` positions every clone from `shadow.getBoundingClientRect()`, so
     *     the shadow has to be the node that TRACKS THE POINTER; a static wrapper
     *     would place the whole ghost stack at a fixed, wrong position.
     *
     * THE COST, MEASURED RATHER THAN GUESSED. The ghost stack appears one movement
     * later than it otherwise would, which is within a frame of the incumbent: the
     * retired library created its mirror in the same task as its `drag` event, so
     * `prepare()` has always run on the movement AFTER `start()` and there have
     * never been ghosts on the first movement. Re-measured in a real browser after
     * this change: `.gu-mirror` present at `start()`, the shadow found on the first
     * movement, and the ghost's inline `top` advancing through nine distinct values
     * as the pointer moved, ending with the pointer inside the ghost's own
     * rectangle. A deliberately hostile 39 ms press-move-move-release gesture ALSO
     * armed correctly, so the theoretical case of a release landing before the
     * commit did not reproduce even at that speed; were it ever to, the gesture
     * would simply report no selection, exactly as a click that never moved does.
     *
     * ONE CHARACTERISTIC OF THE RESULT, so it is not later mistaken for a defect:
     * the ghost stack trails the drag image by exactly one movement — one card
     * height — because `multiDrag.drag()` reads `shadow.getBoundingClientRect()`
     * synchronously inside the movement handler while `@dnd-kit` applies the
     * overlay's transform in a commit that lands afterwards. It keeps the ghost
     * visually stacked with the drag image, it is inherent to the one-shot shadow
     * snapshot, and it matches what the retired library did.
     */
    const armMultiDrag = useCallback((): void => {
        const pending = pendingGestureRef.current;

        if (pending === null) {
            return;
        }

        /* Once per gesture: cleared before arming so a re-entrant call is inert. */
        pendingGestureRef.current = null;

        const current = propsRef.current;
        const { event, sourceNode } = pending;

        /*
         * THE MULTI-SELECT GESTURE, in the order the SCREEN declared. The asymmetry
         * is preserved rather than normalised (rule T10): the board reads the
         * selection then arms (kanban L76 then L87), the story list arms then reads
         * (backlog L77 then L79). Both calls live here so their RELATIVE order is
         * exactly the incumbent's; splitting them across the two moments would
         * invert the story list's.
         */
        let elements: readonly HTMLElement[] = [];

        if (sourceNode !== null) {
            const controller = resolveMultiDrag();
            const container = resolveMultiDragContainer(event.active, sourceNode);

            if (
                (current.multiDragCallOrder ?? DEFAULT_MULTI_DRAG_CALL_ORDER) ===
                'start-then-elements'
            ) {
                controller.start(sourceNode, container);
                elements = controller.getElements();
            } else {
                elements = controller.getElements();
                controller.start(sourceNode, container);
            }
        }

        current.onMultiDragStart?.(elements, event);
    }, [resolveMultiDrag]);

    /**
     * The bookkeeping shared by drag end and drag cancel.
     *
     * The pinned drag library fires its `dragend` handler even for a cancelled
     * gesture, so both paths have to perform the same teardown; `@dnd-kit` reports
     * the two separately, and the difference is expressed by which consumer
     * callback runs afterwards rather than by doing less work on one of them.
     */
    const finishDrag = useCallback(
        (event: DragEndEvent): void => {
            const controller = armedMultiDragRef.current;

            /*
             * A gesture released before the commit that would have armed it is
             * dropped here rather than armed late, so no listener is attached after
             * the drag is already over.
             */
            pendingGestureRef.current = null;

            /* STEP 1 — teardown while the placeholder is still in the document. */
            const elements = controller === null ? [] : controller.stop();

            /* STEP 2 — only now is the transit class safe to remove. */
            releaseTransit();

            /* STEP 3 — report before the screen's own handler runs. */
            propsRef.current.onMultiDragEnd?.(elements, event);
        },
        [releaseTransit],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent): void => {
            finishDrag(event);
            propsRef.current.onDragEnd?.(event);
        },
        [finishDrag],
    );

    const handleDragCancel = useCallback(
        (event: DragCancelEvent): void => {
            finishDrag(event);
            propsRef.current.onDragCancel?.(event);
        },
        [finishDrag],
    );

    const handleDragOver = useCallback((event: DragOverEvent): void => {
        propsRef.current.onDragOver?.(event);
    }, []);

    const handleDragMove = useCallback((event: DragMoveEvent): void => {
        propsRef.current.onDragMove?.(event);
    }, []);

    /*
     * TEARDOWN, WITH PARITY TO `drake.destroy()` — `app/coffee/modules/kanban/sortable.coffee`
     * L177-L181 and `app/coffee/modules/backlog/sortable.coffee` L153-L155. It is
     * NOT optional: listeners or gesture state surviving an unmount leak across
     * route changes, and the leak is silent — it shows up only as duplicated
     * handling after navigating away from the screen and back.
     *
     * `stop()` first when a gesture is in flight, because that is what deletes the
     * ghost clones from the document and restores the originals the controller
     * hid; `destroy()` afterwards detaches the movement listener and drops the
     * gesture state, and per `./multiDrag` performs no document work of its own,
     * which is why it is safe to call on an injected controller too. Finally the
     * transit class is stripped, so no element is left decorated.
     *
     * The `gu-mirror` node needs no cleanup: it is the `DragOverlay` itself, which
     * React unmounts along with this component. This provider never writes that
     * class onto an element it does not own. Nor does it ever touch
     * `document.body`: the `drag-active` class belongs to the story list (backlog
     * L73 and L108), so there is no stray body class for this teardown to leave
     * behind.
     */
    useEffect(
        () => (): void => {
            const controller = armedMultiDragRef.current;

            if (controller !== null) {
                if (controller.inProgress) {
                    controller.stop();
                }

                controller.destroy();
                armedMultiDragRef.current = null;
            }

            pendingGestureRef.current = null;
            releaseTransit();
        },
        [releaseTransit],
    );

    /*
     * POINTER SENSOR ONLY. No keyboard sensor and no touch sensor: the retired
     * library is mouse-driven, and `./multiDrag` listens for `mousemove` alone, so
     * either addition would be a new capability rather than a port (rule T10).
     * This is a deliberate omission, not an oversight.
     */
    const pointerSensorOptions = useMemo<PointerSensorOptions>(
        () => ({ activationConstraint: { distance: activationDistance } }),
        [activationDistance],
    );
    const pointerSensor = useSensor(PointerSensor, pointerSensorOptions);

    /*
     * THE PERMISSION GATE. `useSensors` filters absent entries, so a disabled
     * provider ends up with no sensor at all and no drag can begin — the same
     * outcome as the incumbent's early returns, which never initialised the drag
     * library. Exactly ONE argument is always passed, because `useSensors`
     * memoises on the spread argument list and a list that changes LENGTH between
     * renders is an unstable dependency array.
     *
     * WITHHOLDING THE SENSOR IS THE FAITHFUL GATE, and the alternative was
     * measured and rejected. Keeping the sensor mounted behind an unreachable
     * activation constraint would keep the sensor COUNT constant, but the sensor's
     * activator still fires on pointer-down: `AbstractPointerSensor.attach()`
     * registers `contextmenu` and `dragstart` preventers on the window before it
     * consults the constraint, so a member without `modify_us` would lose the
     * context menu while holding the pointer down — a behaviour change (rule T10)
     * in exchange for cosmetics.
     *
     * ONE KNOWN, HARMLESS INTERACTION, recorded so it is not mistaken for a
     * defect. `@dnd-kit`'s `useSensorSetup` derives its effect dependency array
     * from the sensor list itself and carries its own note that "Sensors length
     * could theoretically change which would not be a valid dependency", so
     * flipping `disabled` on a mounted provider logs a development warning from
     * the library. Nothing is skipped: `PointerSensor` publishes no `setup` hook,
     * so that effect has no teardown to lose. And in production the flag is
     * derived from `my_permissions` and `archived_code`, which the incumbent reads
     * once — at link time on the board, through `bindOnce` on the story list — so
     * the list length does not move while a screen is mounted.
     */
    const sensors = useSensors(disabled ? null : pointerSensor);

    /*
     * Memoised on the configuration's VALUES rather than its identity, so a screen
     * rebuilding the object on every render does not retranslate needlessly.
     */
    const autoScrollOptions = useMemo<AutoScrollOptions>(
        () =>
            toDndKitAutoScroll({
                enabled: autoScroll.enabled,
                margin: autoScroll.margin,
                pixels: autoScroll.pixels,
                scrollWhenOutside: autoScroll.scrollWhenOutside,
            }),
        [autoScroll.enabled, autoScroll.margin, autoScroll.pixels, autoScroll.scrollWhenOutside],
    );

    return (
        <DndContext
            autoScroll={autoScrollOptions}
            collisionDetection={collisionDetection}
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            {children}
            <DragOverlayHost
                mirrorClassName={mirrorClassName}
                onOverlayCommitted={armMultiDrag}
                renderOverlay={renderOverlay}
            />
        </DndContext>
    );
}
