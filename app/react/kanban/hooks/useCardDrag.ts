/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useCardDrag — the board's drag ORCHESTRATOR.
 *
 * ===========================================================================
 * 1. WHAT THIS FILE IS A PORT OF
 * ===========================================================================
 * `app/coffee/modules/kanban/sortable.coffee` L25-L183 — the whole of
 * `KanbanSortableDirective`, which is retired by this migration. That file is a
 * READ-ONLY REFERENCE and is NEVER imported: it is CoffeeScript, `tsconfig.json`
 * enables no `allowJs`, and no ambient declaration was added for it, so it is not
 * part of this program at all. Every behaviour below was reimplemented by reading
 * it line by line, and every locator in this file is written `KANBAN:NN`, meaning
 * line NN of that 193-line file as it stood before the migration.
 *
 * The same applies to `app/js/dragula-drag-multiple.js` and `app/js/boards.js`:
 * behavioural references, never imports. The drag library they belong to
 * (`dragula` + `dom-autoscroller`) STAYS INSTALLED — requirement I3, because
 * `wiki/nav.coffee`, `admin/project-values.coffee` and `taskboard/sortable.coffee`
 * are out of scope and still use it — but nothing in `app/react` may reach for it.
 *
 * ===========================================================================
 * 2. THE SCOPE SPLIT, STATED BEFORE ANY CODE
 * ===========================================================================
 * Four shared modules already own the parts of the gesture that both screens
 * share. This hook owns only the Kanban-specific remainder, and duplicating any
 * of theirs would be a defect rather than a safety net:
 *
 *   `../../shared/dnd/useSortableList`  EVERY index and neighbour computation.
 *       Named risk R-DND-2: only the core drag package is pinned, so ordering is
 *       computed manually, and combined with a POSITION-RELATIVE write API an
 *       off-by-one SILENTLY PERSISTS A WRONG ORDER with no error surface. That is
 *       why this file computes no index, scans no sibling and derives no anchor.
 *   `../../shared/dnd/multiDrag`        the multi-selection, the ghost stack, the
 *       hidden originals and their restoration (named risk R-DND-1: the adopted
 *       library has no multi-item drag at all).
 *   `../../shared/dnd/DndProvider`      the drag context, the sensors, the
 *       `gu-transit` / `gu-mirror` classes, the autoscroll loop, and calling the
 *       multi-drag controller's `start()` / `stop()` / `destroy()` exactly once.
 *   `../../shared/useInViewport`        the write-once visibility latch.
 *
 * THIS HOOK OWNS: the Kanban selectors, the two permission gates, re-entrant
 * container registration, the `target-drop` class, the Kanban lifecycle wiring,
 * the `new` class with its `animationend` removal, native element removal, and the
 * exact six-argument move emission.
 *
 * ===========================================================================
 * 3. THE CLASS-OWNERSHIP MAP — AND WHY GETTING IT WRONG IS INVISIBLE (T9)
 * ===========================================================================
 * ⚠️ The adopted drag library emits NONE of the retired library's classes. Every
 * one of them is selected on by stylesheets this migration does not edit
 * (transformation rule T1), so a missing integration removes the visual with NO
 * exception, NO console warning and NO build failure — the board simply stops
 * showing what it used to show. The complete map:
 *
 *   `gu-transit`               `./DndProvider`  on the source node at drag start.
 *   `gu-mirror`                `./DndProvider`  on the drag overlay.
 *   `gu-transit-multi`         `./multiDrag`    reveals `.card-transit-multi`.
 *   `multiple-drag-mirror`     `./multiDrag`    on each ghost clone — the port of
 *                                              KANBAN:89-L90's `cloned` handler.
 *   `tg-multiple-drag-mirror`  `./multiDrag`    its own clone bookkeeping.
 *   `tg-multiple-drag-dragging` `./multiDrag`   its own hidden-original bookkeeping.
 *   `main-drag-item`           `./multiDrag`    the primary of a multi selection.
 *   `target-drop`              ⭐ THIS HOOK     KANBAN:69 / KANBAN:73.
 *   `new`                      ⭐ THIS HOOK     KANBAN:128-L131.
 *   `ui-multisortable-multiple` THE SCREEN      `KanbanCard` renders it from
 *       `selectedUss` (`kanban-table.jade` L154 and L230). This hook READS it
 *       through `./multiDrag` and never adds or removes it.
 *
 * The ghost markup itself is the screen's too: `card.jade` L45-L55 renders
 * `.card-transit-multi` with EXACTLY TWO `.fake-us` blocks and `KanbanCard`
 * reproduces that count verbatim. This hook injects no markup and infers no
 * count; it only guarantees the shared class lifecycle runs so the existing ghost
 * is revealed.
 *
 * ===========================================================================
 * 4. THE FROZEN EMISSION — SIX POSITIONAL ARGUMENTS, ONE EVENT NAME
 * ===========================================================================
 * KANBAN:153 ends every persisted drag with
 *
 *     $rootscope.$broadcast("kanban:us:move", finalUsList, newStatus,
 *                           newSwimlane, index, previousCard, nextCard)
 *
 * and `main.coffee` L226 (`@scope.$on("kanban:us:move", @.moveUs)`) is the
 * RETAINED listener that consumes it. The controller then issues the
 * position-relative bulk write itself (`main.coffee` L618-L625), so this hook
 * calls no API, opens no transport and dispatches no reducer action.
 *
 * The typed bridge deliberately exposes no `$rootScope`, so the emission travels
 * through a REQUIRED seam adapter — {@link KanbanMoveEmitter} — which receives the
 * literal event name plus those six arguments in that order. The AngularJS
 * bridge/container owns the actual broadcast. This hook never resolves
 * `$rootScope`, `$scope`, the injector or AngularJS in any form, and never asks
 * for a digest.
 *
 * ===========================================================================
 * 5. THE ONE STRUCTURAL DIFFERENCE BETWEEN THE TWO LIBRARIES
 * ===========================================================================
 * The retired library MOVED THE DRAGGED NODE, in the real DOM, before its `drop`
 * and `dragend` handlers ran. Three of the ported expressions depend on that and
 * cannot be reproduced without it:
 *
 *   KANBAN:98-L99   the neighbour scan reads the dragged card's NEW siblings.
 *   KANBAN:110      `parentEl = item.parentNode` is the DESTINATION column.
 *   KANBAN:120      the drop index is measured INSIDE that destination.
 *
 * The adopted library never moves a node. So {@link placeDraggedItem} below
 * performs that move, once per change of drop target — and it is written as an
 * IDEMPOTENT reconciliation rather than an unconditional insert, so that a screen
 * which projects the arrangement into its own state and re-renders (the
 * alternative `recordNeighbours` explicitly allows: "the DOM, OR THE PROJECTION
 * THE SCREEN KEEPS OF IT") finds the element already where it belongs and nothing
 * is mutated at all. Both wirings therefore work, and neither double-moves.
 *
 * A gesture abandoned with Escape, or a subtree unmounted mid-drag, restores the
 * element to the anchor captured at drag start, so a cancelled drag leaves the
 * board exactly as it found it.
 *
 * ===========================================================================
 * 6. R-DND-3 — REGISTRATION IS NEVER GATED ON VISIBILITY
 * ===========================================================================
 * The board virtualises cards, and `card.jade` L8-L13 puts the viewport guard on
 * the INNER wrapper: `.card-inner(ng-if="vm.inViewPort")`. The OUTER custom
 * element carrying `data-id` ALWAYS renders (`kanban-table.jade` L150 in swimlane
 * mode, L226 in flat mode). Nothing here filters a container or a card by
 * visibility, by computed display, by an offset parent or by a viewport flag —
 * filtering would make a drag toward a scrolled-away region find no drop target,
 * which, once again, fails silently. `../../shared/useInViewport` latches
 * visibility monotonically, so there is no "left the viewport" transition to
 * react to and no reason to unregister anything.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { DndAutoScrollConfig, DndProviderProps } from '../../shared/dnd/DndProvider';
import { createMultiDrag } from '../../shared/dnd/multiDrag';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
import { useSortableList } from '../../shared/dnd/useSortableList';
import type {
    SortableItemSelector,
    UseSortableListConfig,
} from '../../shared/dnd/useSortableList';
import type { InViewportApi } from '../../shared/useInViewport';
import { UNCLASSIFIED_SWIMLANE_ID } from '../state/boardReducer';
import type { CardUserStoryVm } from '../state/types';

/* ==========================================================================
 * CONSTANTS — every literal below is a CONTRACT, spelled verbatim (rule T1)
 * ========================================================================== */

/**
 * The sortable item, as an ELEMENT NAME rather than a class.
 *
 * KANBAN:60's `moves` predicate is `$(item).is('tg-card')`, and the two index
 * expressions at KANBAN:85 and KANBAN:120 both use `find('tg-card')`. The board's
 * cards are custom elements (`kanban-table.jade` L150 and L226 render
 * `tg-card.card.ng-animate-disabled(data-id="{{ usId }}")`), so the tag is the
 * stable handle: `.card` is also on other things, and a `data-id` probe would
 * match the rows of a different screen.
 */
const CARD_ELEMENT_NAME = 'tg-card';

/** The same value, as the selector the shared arithmetic is configured with. */
const CARD_ITEM_SELECTOR: SortableItemSelector = CARD_ELEMENT_NAME;

/**
 * The drop container. KANBAN:31 and KANBAN:172 both name it, and it is the element
 * that carries `data-status` and `data-swimlane`
 * (`kanban-table.jade` L112-L121 and L189-L197).
 */
const TASKBOARD_COLUMN_SELECTOR = '.taskboard-column';

/** One swimlane's wrapper, keyed by its id — the prefix of KANBAN:31's selector. */
const SWIMLANE_SELECTOR_PREFIX = '.kanban-swimlane[data-swimlane="';

/** The suffix of KANBAN:31's selector, kept split so the whole is unmistakable. */
const SWIMLANE_SELECTOR_SUFFIX = '"] ';

/**
 * How KANBAN:165 asks "is this board in swimlane mode?" — and it is NOT the
 * swimlane wrapper class.
 *
 * ⚠️ `.swimlane` is applied by the RETAINED AngularJS shell to
 * `section.main.kanban`, at `app/partials/kanban/kanban.jade` L16
 * (`ng-class="{ 'swimlane': swimlanesList.size }"`), which is an ANCESTOR of the
 * board root this hook is given. KANBAN:165 reads it with a document-wide
 * `$('.swimlane')`, so {@link resolveSwimlaneMode} must query the OWNER DOCUMENT
 * rather than the root — scoping it to the root would find nothing, and flat-mode
 * bootstrap would then register swimlane-mode columns a second time. The two
 * other selectors above ARE root-scoped, because the elements they match live
 * inside the board.
 */
const SWIMLANE_MODE_SELECTOR = '.swimlane';

/**
 * The hovered-column highlight, added at KANBAN:69 and removed at KANBAN:73.
 *
 * Declared by `app/styles/modules/kanban/kanban-table.scss` L247, which this
 * migration leaves at ZERO EDITS. No CSS is authored here.
 *
 * ⚠️ THE COMPILED RULE IS ANCESTOR-SCOPED, and the board's markup has to honour
 * that. Read out of the live stylesheet, the two rules are
 * `.kanban-table-body .taskboard-column.target-drop { background-color: #D8DEE9 }`
 * and `.taskboard-table-body .taskboard-column.target-drop { … #ECEFF4 }` — a
 * DIFFERENT fill for the out-of-scope taskboard. So the class this hook writes only
 * paints when the column still sits inside a `.kanban-table-body`, which is the
 * screen's markup responsibility (`kanban-table.jade` L107 and L184), not this
 * hook's. Emit the class on the wrong ancestor and the highlight silently renders
 * in the taskboard's colour, or not at all.
 */
const TARGET_DROP_CLASS = 'target-drop';

/**
 * The destination-changed flash, added at KANBAN:128 and removed at KANBAN:131.
 *
 * Declared by the same stylesheet at L241 and L244, and — verified against the
 * compiled output — it is PURELY AN ANIMATION TRIGGER with no static declaration:
 * `.kanban-table-body .taskboard-column.new { animation: .5s ease-in 1
 * new-us-status-blink }`, and `…vfold.new { … 2 new-us-status-blink-folded-column }`
 * for a folded column. Two consequences:
 *
 *   - The class MUST be added transiently. Left on, it never blinks again; never
 *     added, nothing blinks at all.
 *   - Because the removal is driven by the animation's own end event, no timer and
 *     no animation library is involved. That also makes the spelling load-bearing:
 *     a class with no matching rule starts no animation, the end event never
 *     arrives, and the class would stay on the column for ever.
 *
 * The same `.kanban-table-body` ancestor requirement applies here as for
 * {@link TARGET_DROP_CLASS}.
 */
const NEW_COLUMN_CLASS = 'new';

/** The event that removes {@link NEW_COLUMN_CLASS} — KANBAN:130's `one(...)`. */
const ANIMATION_END_EVENT = 'animationend';

/**
 * The permission KANBAN:37 tests. Read from the project's RAW `my_permissions`
 * array, exactly as the `tg-check-permission` directives do; React forms no
 * independent notion of what the user may do.
 */
const MODIFY_US_PERMISSION = 'modify_us';

/**
 * The board's autoscroll band, in pixels — KANBAN:156.
 *
 * ⚠️ THE TWO SCREENS DIVERGE AND MUST NOT BE UNIFIED. The board passes
 * `{ margin: 100, scrollWhenOutside: true }` over the COLUMN CONTAINERS; the story
 * list passes `{ margin: 20, pixels: 30 }` over `[window]`. See
 * {@link KANBAN_AUTOSCROLL} for the rest of that note.
 */
const KANBAN_AUTOSCROLL_MARGIN = 100;

/* ==========================================================================
 * THE FROZEN MOVE CONTRACT
 * ========================================================================== */

/**
 * The event name of KANBAN:153, as a literal type so a typo cannot compile.
 *
 * The retained controller subscribes to this exact string at `main.coffee` L226,
 * and `useWipLimit` redraws its marker on it as well, so it is observed in two
 * places and renaming it would break both silently.
 */
export type KanbanMoveEventName = 'kanban:us:move';

/** The value of {@link KanbanMoveEventName}. */
export const KANBAN_US_MOVE_EVENT: KanbanMoveEventName = 'kanban:us:move';

/**
 * One entry of the emission's first argument, built at KANBAN:136-L141.
 *
 * ⭐ `oldSwimlaneId` CARRIES NO FALLBACK, and that is KANBAN:140 verbatim:
 *
 *     oldSwimlaneId: item.getIn(['model', 'swimlane'])
 *
 * Seven lines later, KANBAN:146 builds THE SAME VALUE WITH `|| -1` for its own
 * comparison. The inconsistency is the incumbent's; it is reproduced rather than
 * tidied, because rule T10 forbids changing behaviour and the two values travel to
 * different places — this one to the retained controller, that one only into a
 * local sameness test. See {@link UNCLASSIFIED_SWIMLANE_ID} at the point of use.
 */
export interface KanbanMovedUserStory {
    /** `item.get('id')` — KANBAN:138. */
    readonly id: number;

    /** `item.getIn(['model', 'status'])` — KANBAN:139. */
    readonly oldStatusId: number;

    /** `item.getIn(['model', 'swimlane'])` — KANBAN:140, unmodified. */
    readonly oldSwimlaneId: number | null;
}

/**
 * The AngularJS seam this hook emits through — REQUIRED, with no default.
 *
 * The six arguments after the event name are KANBAN:153's, in KANBAN:153's order.
 * They are deliberately NOT collapsed into an object: the retained listener is
 * `@.moveUs`, whose signature is positional
 * (`ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard`), and
 * the write it performs is position-relative, so a reordering here would persist a
 * wrong order with no error surface.
 *
 * `newSwimlane` is typed `number` and CAN BE `NaN`. See
 * {@link readColumnSwimlaneId} for why that is correct rather than an oversight.
 */
export type KanbanMoveEmitter = (
    eventName: KanbanMoveEventName,
    finalUsList: readonly KanbanMovedUserStory[],
    newStatus: number,
    newSwimlane: number,
    index: number,
    previousCard: number | null,
    nextCard: number | null,
) => void;

/* ==========================================================================
 * THE OPTIONS AND RESULT SURFACES
 * ========================================================================== */

/**
 * The two project fields the gates read, and nothing else.
 *
 * Shaped to match `CardProject` in `../KanbanCard`, which declares
 * `archived_code?: string | null` for the same field, so a container can pass one
 * object to both without adapting it.
 */
export interface KanbanDragProject {
    /**
     * The RAW permission list. KANBAN:37 tests it with `indexOf(...) > -1`, and
     * {@link useCardDrag} reproduces that test rather than deriving a permission
     * model of its own.
     */
    readonly my_permissions: readonly string[];

    /**
     * Truthy when the project is archived — KANBAN:40. Its VALUE is never read,
     * only its truthiness, which is how the incumbent reads it everywhere
     * (`related-tasks.coffee` L64, `wiki/main.coffee` L108, `estimation.coffee`
     * L144, and KANBAN:40 itself).
     */
    readonly archived_code?: string | null;
}

/**
 * A ref to the board root — `$el` of KANBAN:26, the element carrying
 * `div.kanban-table` (`kanban-table.jade` L8).
 *
 * Declared structurally rather than as `RefObject` so a container may pass an
 * object it owns, and so a browserless specification can pass `{ current: node }`.
 */
export interface KanbanBoardRootRef {
    readonly current: HTMLElement | null;
}

/**
 * What the board puts on a card's draggable `data`, produced by
 * {@link UseCardDragResult.getDraggableData}.
 *
 * `./DndProvider` reads both fields off `active.data.current`: `sourceNode` is the
 * element that STAYS IN PLACE and receives `gu-transit`, and
 * `multiDragContainer` is the container set the multi-selection is collected from.
 * Supplying the FULL registered container list is KANBAN:87 verbatim
 * (`window.dragMultiple.start(item, containers)`), and it is what lets a card
 * selected in one column and dragged from another be picked up.
 */
export interface KanbanDraggableData {
    readonly sourceNode: HTMLElement;

    readonly multiDragContainer: readonly HTMLElement[];
}

/**
 * What the board puts on a droppable's `data`, produced by
 * {@link UseCardDragResult.getDroppableData}.
 *
 * A column droppable yields `containerNode` alone; a card droppable yields
 * `itemNode` plus the column it sits in, which is what lets this hook reproduce
 * the retired library's insert-before-the-hovered-item placement.
 */
export interface KanbanDroppableData {
    readonly containerNode?: HTMLElement | undefined;

    readonly itemNode?: HTMLElement | undefined;
}

/** How the board asks this hook for a story it already holds. */
export type KanbanCardLookup = (id: number) => CardUserStoryVm | undefined;

export interface UseCardDragOptions {
    /** The permission source for the two gates of KANBAN:37-L41. */
    readonly project: KanbanDragProject;

    /** `$el` — the board root every container query is scoped to. */
    readonly rootRef: KanbanBoardRootRef;

    /**
     * `$scope.isTableLoaded` (`main.coffee` L688 and L696) — the value KANBAN:162
     * watches to bootstrap a FLAT board.
     */
    readonly isTableLoaded: boolean;

    /**
     * The story map, as a lookup. Replaces
     * `kanbanUserstoriesService.usMap.get(...)` at KANBAN:134, and doubles as the
     * membership check the shared arithmetic requires: an id that passes the format
     * check but names no story this board holds is refused rather than written.
     */
    readonly getCard: KanbanCardLookup;

    /** The frozen emission seam of section 4. Required. */
    readonly emitMove: KanbanMoveEmitter;

    /**
     * The board's viewport latch. Its registrations are re-exposed on the result
     * so that the "always register, never gate on visibility" rule of section 6
     * lives in ONE place.
     */
    readonly inViewport: InViewportApi;

    /**
     * The multi-selection controller. Optional: when absent this hook creates one
     * and hands it to the provider, which then owns its `start()`, `stop()` and
     * `destroy()`. Accepting an injected one keeps a browserless specification able
     * to observe those calls without reaching into the provider.
     */
    readonly multiDrag?: MultiDragController | undefined;

    /**
     * The drag overlay's content renderer, forwarded to the provider untouched.
     *
     * ⚠️ NOT COSMETIC — this is the seam KANBAN:89-L90's `cloned` handler became. The
     * provider arms the multi-drag gesture only once the overlay node is committed to
     * the document, and it is `./multiDrag` that then stacks the ghost clones against
     * that node and puts `multiple-drag-mirror` on each of them. So WITHOUT AN OVERLAY
     * RENDERER THE GHOST STACK NEVER APPEARS and that class is never applied — no
     * error, no warning, just a multi-card drag that shows one card. The overlay
     * content is a rendered card, which is the screen's concern, so it is passed in
     * rather than invented here; a second overlay or a hand-rolled clone would fight
     * the shared one for the same nodes.
     */
    readonly renderOverlay?: DndProviderProps['renderOverlay'] | undefined;

    /** The collision strategy, forwarded to the provider untouched. */
    readonly collisionDetection?: DndProviderProps['collisionDetection'] | undefined;
}

/**
 * The props to spread onto `./DndProvider`, minus its children.
 *
 * Exposed as one object so a board cannot forget the autoscroll config, the
 * permission gate, the multi-drag controller, the call order or any of the five
 * lifecycle callbacks — forgetting any one of them removes behaviour silently.
 */
export type KanbanDndProviderProps = Omit<DndProviderProps, 'children'>;

export interface UseCardDragResult {
    /** Spread onto `./DndProvider`. */
    readonly dndProviderProps: KanbanDndProviderProps;

    /**
     * `$scope.openSwimlane(id)` — KANBAN:30-L34. Call it when a swimlane's body has
     * loaded, which is what `main.coffee` L690-L694 does.
     */
    readonly openSwimlane: (swimlaneId: number) => void;

    /** The registered containers, in registration order. */
    readonly getContainers: () => readonly HTMLElement[];

    /**
     * KANBAN:59-L60's `moves` predicate — `$(item).is('tg-card')`.
     *
     * Exposed because the incumbent's predicate stopped a gesture BEFORE it began,
     * which on this side is the board's `useDraggable` call and nothing else can reach.
     * The hook applies the same test to every gesture it is told about, so a
     * non-card subject is never tracked either way; using this to gate the draggable
     * as well is what reproduces the incumbent's "the drag never starts" exactly.
     */
    readonly canMove: (candidate: unknown) => candidate is HTMLElement;

    /** Build a card's draggable `data`. See {@link KanbanDraggableData}. */
    readonly getDraggableData: (sourceNode: HTMLElement) => KanbanDraggableData;

    /** Build a droppable's `data`. See {@link KanbanDroppableData}. */
    readonly getDroppableData: (node: HTMLElement) => KanbanDroppableData;

    /** `taskColumnLoaded` — `main.coffee` L679-L681. */
    readonly registerColumn: (
        column: HTMLElement | null,
        statusId: number,
        swimlaneId?: number | null,
    ) => void;

    /** `cardLoaded` — `main.coffee` L683-L684. */
    readonly registerCard: (
        card: HTMLElement | null,
        statusId: number,
        swimlaneId?: number | null,
    ) => void;

    /**
     * `$scope.usCardVisibility` — `main.coffee` L670-L675. A write-once latch: an
     * id present here is present for the rest of the board's life.
     */
    readonly visibleIds: Readonly<Record<number, true>>;
}

/* ==========================================================================
 * THE PROVIDER'S EVENT SHAPES, DERIVED RATHER THAN IMPORTED
 * ========================================================================== */

/*
 * The drag library's own event types are reached THROUGH `./DndProvider`'s props
 * instead of being imported from the package, so this file's import graph is
 * exactly `react` plus six relative modules. That is not tidiness: `Parameters<>`
 * of the very props this hook fills in cannot drift from them, whereas a second
 * import of the package's types could be updated in one place and not the other.
 */
type DragStartEventArg = Parameters<NonNullable<DndProviderProps['onDragStart']>>[0];

type DragOverEventArg = Parameters<NonNullable<DndProviderProps['onDragOver']>>[0];

type DragActive = DragStartEventArg['active'];

type DragOverTarget = DragOverEventArg['over'];

/* ==========================================================================
 * MODULE-PRIVATE DOM HELPERS
 * ========================================================================== */

/** The `data` keys this hook reads back off a draggable or a droppable. */
type ElementDataField = 'sourceNode' | 'containerNode' | 'itemNode';

/**
 * Narrows one field of an untyped `data` object to an element, or to `null`.
 *
 * The drag library types a draggable's `data` loosely on purpose — a screen puts
 * its own domain values on the same object — so every field is validated at run
 * time rather than trusted. The shape of this helper mirrors `readField` in
 * `./DndProvider`, which does the same job for the same reason.
 */
function readElementField(source: unknown, field: ElementDataField): HTMLElement | null {
    if (source === null || typeof source !== 'object') {
        return null;
    }

    const candidate: unknown = (source as Record<string, unknown>)[field];

    return candidate instanceof HTMLElement ? candidate : null;
}

/** Collects a live node list into elements, dropping anything that is not one. */
function toHtmlElements(nodes: Iterable<Element>): HTMLElement[] {
    const elements: HTMLElement[] = [];

    for (const node of nodes) {
        if (node instanceof HTMLElement) {
            elements.push(node);
        }
    }

    return elements;
}

/**
 * KANBAN:59-L60's `moves` predicate — `$(item).is('tg-card')`.
 *
 * ELEMENT NAME, deliberately: not `.card`, not a role, not "anything carrying a
 * `data-id`". `localName` is always lower case for an element in an HTML document,
 * and a hyphenated unknown name is still an `HTMLElement`, so the test needs no
 * case folding and holds whether or not the custom element has been upgraded.
 */
function isCardElement(candidate: unknown): candidate is HTMLElement {
    return candidate instanceof HTMLElement && candidate.localName === CARD_ELEMENT_NAME;
}

/**
 * KANBAN:110's `item.parentNode`, resolved as the nearest enclosing column.
 *
 * The incumbent could read the parent directly because the retired library had
 * already moved the node INTO the column and the template renders cards as direct
 * children (`kanban-table.jade` L150 and L226). `closest` gives the same answer for
 * that arrangement and a correct one for any other, so it is the safer spelling of
 * the same intent.
 */
function resolveColumn(element: HTMLElement): HTMLElement | null {
    const column = element.closest(TASKBOARD_COLUMN_SELECTOR);

    return column instanceof HTMLElement ? column : null;
}

/** KANBAN:121 — `Number(parentEl.dataset.status)`. */
function readColumnStatusId(column: HTMLElement): number {
    return Number(column.dataset.status);
}

/**
 * KANBAN:122 — `Number(parentEl.dataset.swimlane)`, WITH NO DEFAULT.
 *
 * ⚠️ A FLAT-MODE COLUMN CARRIES NO `data-swimlane` AT ALL:
 * `kanban-table.jade` L189-L197 renders `data-status` and nothing else, while the
 * swimlane-mode column at L112-L121 renders both. So this returns `NaN` on a flat
 * board, `NaN` equals nothing — not even itself — and the per-item sameness test at
 * KANBAN:147 therefore reports "container changed" for EVERY dragged item, whose
 * consequence is that every dragged element is removed from the DOM (KANBAN:149-151)
 * and re-rendered from state.
 *
 * That is incumbent behaviour and it is preserved deliberately under rule T10. Two
 * specific ways of "improving" it are forbidden:
 *
 *   - Defaulting the absent value to `0`, `-1` or `null` would make two different
 *     flat columns compare EQUAL, so the guard would start firing where the
 *     incumbent never lets it fire.
 *   - Reading the attribute with `getAttribute` instead of the dataset map would do
 *     the same by accident: it reports `null` for an absent attribute, and
 *     `Number(null)` is ZERO.
 *
 * The shared configuration note in `../../shared/dnd/useSortableList` records the
 * same quirk from its own side. The emission's `newSwimlane` argument is therefore
 * typed `number` and documented as possibly `NaN`; the retained controller and the
 * api facade already gate the swimlane on truthiness
 * (`resources/userstories.coffee` L126-L127), which is why a not-a-number value
 * never reaches the wire as a swimlane id.
 */
function readColumnSwimlaneId(column: HTMLElement): number {
    return Number(column.dataset.swimlane);
}

/**
 * KANBAN:165's `$('.swimlane').length`, as a boolean.
 *
 * DOCUMENT-SCOPED ON PURPOSE — see {@link SWIMLANE_MODE_SELECTOR}. The class sits
 * on an ancestor of the board root, so this is the one query in the file that is
 * not scoped to the root.
 */
function resolveSwimlaneMode(root: HTMLElement): boolean {
    return root.ownerDocument.querySelectorAll(SWIMLANE_MODE_SELECTOR).length > 0;
}

/**
 * Finds a card by its positional attribute within the registered containers.
 *
 * The fallback for a board that identifies its droppables by story id rather than
 * by handing the node over in `data`. It compares dataset VALUES rather than
 * building a selector, so an unusual identifier can neither break the selector nor
 * inject into it — the same approach, for the same reason, as
 * `findNodeByActiveId` in `./DndProvider`.
 */
function findCardByDatasetId(
    id: string,
    containers: readonly HTMLElement[],
): HTMLElement | null {
    for (const container of containers) {
        for (const candidate of container.querySelectorAll(CARD_ELEMENT_NAME)) {
            if (candidate instanceof HTMLElement && candidate.dataset.id === id) {
                return candidate;
            }
        }
    }

    return null;
}

/** One resolved drop position: the column, and the card to insert in front of. */
interface KanbanDropTarget {
    readonly container: HTMLElement;

    readonly reference: HTMLElement | null;
}

/**
 * Turns the library's "what is under the pointer" report into a column and an
 * insertion reference.
 *
 * Three sources, in order of trustworthiness: the container node the board handed
 * over, the card node it handed over, and — for a board that supplies neither — a
 * probe for a card whose positional attribute matches the droppable's id. A
 * reference that is not a direct child of the resolved column cannot order
 * anything inside it, so it is discarded rather than used.
 */
function resolveDropTarget(
    over: DragOverTarget,
    containers: readonly HTMLElement[],
): KanbanDropTarget | null {
    if (over === null) {
        return null;
    }

    const data: unknown = over.data.current;
    const containerNode = readElementField(data, 'containerNode');
    const itemNode = readElementField(data, 'itemNode');

    let reference = itemNode;

    if (reference === null && containerNode === null) {
        reference = findCardByDatasetId(String(over.id), containers);
    }

    const container = containerNode ?? (reference === null ? null : resolveColumn(reference));

    if (container === null) {
        return null;
    }

    if (reference !== null && reference.parentElement !== container) {
        return { container, reference: null };
    }

    return { container, reference };
}

/**
 * Resolves the element the gesture is about — the `item` argument every incumbent
 * handler receives.
 *
 * The board nominates it through {@link KanbanDraggableData}; when it has not, the
 * positional-attribute probe answers instead.
 */
function resolveDraggedItem(
    active: DragActive,
    containers: readonly HTMLElement[],
): HTMLElement | null {
    const nominated = readElementField(active.data.current, 'sourceNode');

    if (nominated !== null) {
        return nominated;
    }

    return findCardByDatasetId(String(active.id), containers);
}

/** Where the dragged element stood when the gesture began. */
interface KanbanOriginAnchor {
    readonly parent: HTMLElement;

    readonly nextSibling: Node | null;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * Wires the Kanban drag gesture onto the shared adapters.
 *
 * Everything it holds lives in refs rather than in state, for the reason
 * `../../shared/dnd/useSortableList` gives for the same choice: a pointer gesture
 * must not re-render on every movement, and the callbacks handed to the drag
 * provider must be reference-stable so that attaching them cannot tear the gesture
 * down and rebuild it mid-drag. The latest options are reachable from those
 * callbacks through one ref assigned during render, which keeps them from going
 * stale without making them change identity.
 */
export function useCardDrag(options: UseCardDragOptions): UseCardDragResult {
    const optionsRef = useRef<UseCardDragOptions>(options);
    optionsRef.current = options;

    const { collisionDetection, inViewport, isTableLoaded, project, renderOverlay, rootRef } =
        options;

    /*
     * ONE multi-selection controller for the whole screen, handed to the provider
     * through its `multiDrag` prop so that the provider's `start()` / `stop()` /
     * `destroy()` act on the very object this hook queries. Creating a second one
     * would mean two DnD systems disagreeing about which cards are selected.
     *
     * An injected controller wins, which is how a browserless specification observes
     * the call order without reaching inside the provider.
     */
    const ownedMultiDragRef = useRef<MultiDragController | null>(null);
    let controller: MultiDragController | null = options.multiDrag ?? ownedMultiDragRef.current;

    if (controller === null) {
        controller = createMultiDrag();
        ownedMultiDragRef.current = controller;
    }

    const multiDrag: MultiDragController = controller;
    const multiDragRef = useRef<MultiDragController>(multiDrag);
    multiDragRef.current = multiDrag;

    /* ----------------------------------------------------------------------
     * PER-SCREEN AND PER-GESTURE STATE
     * -------------------------------------------------------------------- */

    /** The registered drop containers — the incumbent's `drake.containers`. */
    const containersRef = useRef<HTMLElement[]>([]);

    /**
     * The truthiness of KANBAN:43's `drake`: whether the drag system has been
     * initialised at least once. See {@link registerContainers} for why the two
     * branches it selects between still both register.
     */
    const initialisedRef = useRef<boolean>(false);

    /** KANBAN:170's `unwatch()` — the flat bootstrap runs at most once. */
    const flatBootstrapDoneRef = useRef<boolean>(false);

    /**
     * KANBAN:63 / KANBAN:66-L67 / KANBAN:86 — the FIRST container hovered during the
     * current gesture, which the retired library reported for the source column
     * immediately after the drag began. Not the drag source: KANBAN:86 clears it at
     * drag start and the first over event fills it in.
     *
     * It is deliberately NOT cleared at drag end. The incumbent clears it only at
     * drag start, so it survives between gestures, and reproducing that is what
     * keeps the guard's meaning identical.
     */
    const initialContainerRef = useRef<HTMLElement | null>(null);

    /** Every container currently carrying `target-drop`, so teardown finds them all. */
    const decoratedRef = useRef<Set<HTMLElement>>(new Set<HTMLElement>());

    /** Every column currently carrying `new`, with the listener that removes it. */
    const pendingNewRef = useRef<Map<HTMLElement, () => void>>(new Map<HTMLElement, () => void>());

    /** The container the previous over event reported — the incumbent's implicit pairing. */
    const lastOverContainerRef = useRef<HTMLElement | null>(null);

    /** The `item` of every incumbent handler. */
    const draggedItemRef = useRef<HTMLElement | null>(null);

    /**
     * KANBAN:111's `dragMultipleItems`, i.e. what `stop()` reported.
     *
     * The selection read at DRAG START is deliberately not kept: the incumbent uses it
     * only to measure the start index (KANBAN:82-L85) and then re-reads the set from
     * `stop()` at drag end (KANBAN:111), so holding the earlier list would create a
     * second source of truth for "what moved" that could disagree with this one.
     */
    const stoppedElementsRef = useRef<readonly HTMLElement[]>([]);

    /** Where to put the element back if the gesture is abandoned (header section 5). */
    const originAnchorRef = useRef<KanbanOriginAnchor | null>(null);

    /** Whether THIS hook moved the element, so only its own move is ever undone. */
    const movedByHookRef = useRef<boolean>(false);

    /* ----------------------------------------------------------------------
     * PERMISSIONS — TWO CHECKS, KEPT APART
     * -------------------------------------------------------------------- */

    /*
     * KANBAN:37-L41 is TWO gates with TWO returns, in this order:
     *
     *     if not (project.my_permissions.indexOf("modify_us") > -1)
     *         return
     *     if project.archived_code
     *         return
     *
     * ⚠️ THEY ARE NOT ONE CONDITION, and the story list's single combined condition
     * (`… and !project.archived_code`, whose precedence differs) is NOT this screen's.
     * React cannot call a hook conditionally, so the two returns live inside
     * {@link registerContainers} below — the registration body, which is the
     * incumbent's `init` — while the two named predicates here derive the stable flag
     * the provider's sensor gate needs. Nothing is collapsed and no new permission
     * model is derived: the raw `my_permissions` array is tested exactly as the
     * `tg-check-permission` directives test it.
     *
     * Card-level `modify_task` is a DIFFERENT, per-card gate
     * (`kanban-table.jade` L155's `tg-class-permission="{'readonly': '!modify_task'}"`,
     * evaluated by `../KanbanCard`) and is none of this hook's business.
     */
    const hasModifyUsPermission = project.my_permissions.indexOf(MODIFY_US_PERMISSION) > -1;
    const isProjectArchived = Boolean(project.archived_code);
    const disabled = !hasModifyUsPermission || isProjectArchived;

    /* ----------------------------------------------------------------------
     * THE SHARED ORDERING ARITHMETIC, CONFIGURED FOR THE BOARD
     * -------------------------------------------------------------------- */

    /**
     * The board measures CONTAINER-SCOPED indices, so `indexSelector` is left
     * absent: KANBAN:85 and KANBAN:120 are both
     * `$(parentEl).find('tg-card').index(firstElement)`.
     */
    const resolveContainerIdentity = useCallback((container: HTMLElement): HTMLElement => {
        return container;
    }, []);

    /**
     * KANBAN:124's guard compares CONTAINER ELEMENT IDENTITY —
     * `initialContainer == parentEl` — not a status/swimlane pair, so the identity
     * resolved above is the element itself and sameness is an identity test.
     *
     * The origin the shared hook captured at drag start is deliberately ignored: it
     * is the dragged card's PARENT, whereas the incumbent compares against the FIRST
     * HOVERED container. The two coincide in practice, and reproducing the
     * incumbent's own reading is what makes the guard mean what it meant. When no
     * over event ever fired, `initialContainerRef` is `null`, which equals no real
     * column — exactly as the incumbent's `null` did.
     *
     * The OTHER sameness test in the incumbent, at KANBAN:147, is not this one: it
     * compares a story's own model against the destination's status and swimlane, and
     * it lives in the drag-end body below.
     */
    const isSameContainer = useCallback(
        (_origin: HTMLElement, destination: HTMLElement): boolean => {
            return initialContainerRef.current === destination;
        },
        [],
    );

    /**
     * Membership, which the shared configuration requires: an id may look canonical
     * and still name no story this board holds, and the ordering endpoint is
     * position-relative, so it would be written without complaint.
     */
    const isKnownItemId = useCallback((id: number): boolean => {
        return optionsRef.current.getCard(id) !== undefined;
    }, []);

    const sortableConfig = useMemo<UseSortableListConfig<HTMLElement>>(
        () => ({
            itemSelector: CARD_ITEM_SELECTOR,
            resolveContainer: resolveContainerIdentity,
            isSameContainer,
            isKnownItemId,
        }),
        [resolveContainerIdentity, isSameContainer, isKnownItemId],
    );

    const sortable = useSortableList<HTMLElement>(sortableConfig);

    /* ----------------------------------------------------------------------
     * CONTAINER REGISTRATION — RE-ENTRANT BY DESIGN
     * -------------------------------------------------------------------- */

    /**
     * Adds containers to the ONE registered set, in the order given, skipping any
     * that is already there.
     *
     * ORDER IS PRESERVED AND NEVER RESORTED, because the incumbent's
     * `drake.containers.push(container)` appends. Each batch arrives in document
     * order — `querySelectorAll` guarantees it — so the set is in DOM order within a
     * batch, and swimlanes appear in the order the user opened them, exactly as the
     * incumbent recorded them. The set is what the autoscroll targets and the
     * multi-selection scope are both read from, so a duplicate entry would make the
     * selection query visit a container twice.
     */
    const appendContainers = useCallback((containers: readonly HTMLElement[]): void => {
        const registered = containersRef.current;

        for (const container of containers) {
            if (!registered.includes(container)) {
                registered.push(container);
            }
        }
    }, []);

    /**
     * KANBAN:36-L47's `init`, in full.
     *
     * The two permission returns are here rather than at the top of the hook because
     * a hook cannot return early — see the note above {@link disabled}. The
     * re-entrancy branch is KANBAN:43-L47: once initialised, newly opened containers
     * are APPENDED to the existing registration instead of standing up a second drag
     * system. In React the drag system is the mounted provider, so "already
     * initialised" no longer selects between creating and appending; both branches
     * are kept and labelled anyway, because the flag is what proves no second system
     * is ever created and because the incumbent's own structure is the thing being
     * ported.
     */
    const registerContainers = useCallback(
        (containers: readonly HTMLElement[]): void => {
            const { project: currentProject } = optionsRef.current;

            // GATE 1 — KANBAN:37-L38. Return unless the member may modify stories.
            if (!(currentProject.my_permissions.indexOf(MODIFY_US_PERMISSION) > -1)) {
                return;
            }

            // GATE 2 — KANBAN:40-L41. Then return if the project is archived.
            if (currentProject.archived_code) {
                return;
            }

            // KANBAN:43-L47 — append to the existing registration and stop.
            if (initialisedRef.current) {
                appendContainers(containers);

                return;
            }

            // KANBAN:56 — the one and only initialisation of the drag system.
            initialisedRef.current = true;
            appendContainers(containers);
        },
        [appendContainers],
    );

    /**
     * `$scope.openSwimlane(id)` — KANBAN:30-L34.
     *
     * The selector is KANBAN:31's, character for character:
     * `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column`. It is composed from
     * a NUMBER, and a non-finite one is refused before composition, so nothing
     * user-authored ever reaches the selector string. The query is scoped to the
     * board root because every `.kanban-swimlane` is a descendant of it
     * (`kanban-table.jade` L73-L121), which keeps the board from ever registering a
     * container belonging to some other screen.
     *
     * Selection is by MARKUP, never by visibility (header section 6): a swimlane's
     * columns are registered the moment its body has rendered, whether or not any of
     * its cards is on screen.
     */
    const openSwimlane = useCallback(
        (swimlaneId: number): void => {
            const root = optionsRef.current.rootRef.current;

            if (root === null || !Number.isFinite(swimlaneId)) {
                return;
            }

            const selector =
                SWIMLANE_SELECTOR_PREFIX +
                String(swimlaneId) +
                SWIMLANE_SELECTOR_SUFFIX +
                TASKBOARD_COLUMN_SELECTOR;

            registerContainers(toHtmlElements(root.querySelectorAll(selector)));
        },
        [registerContainers],
    );

    /*
     * KANBAN:162-L175 — the FLAT-BOARD bootstrap, and only the flat board.
     *
     * The incumbent watches `isTableLoaded` and, on the first truthy value, checks
     * whether the screen is in swimlane mode. IN SWIMLANE MODE IT RETURNS WITHOUT
     * UNWATCHING (KANBAN:168), because every swimlane registers its own columns
     * through `openSwimlane` as it opens; the watch therefore stays live in case the
     * project stops having swimlanes. Only the flat path calls `unwatch()`
     * (KANBAN:170), and it calls it BEFORE `init`, so a member without permission
     * does not leave the watch armed. All three behaviours are reproduced, including
     * the order of the last two.
     *
     * Reading the root from a ref inside an effect keyed on the loaded flag is safe
     * for the same reason the incumbent's `$el` was: the board raises that flag from
     * its table-body loaded callback (`main.coffee` L690-L696), which cannot run
     * before the root is in the document.
     */
    useEffect(() => {
        // KANBAN:163.
        if (!isTableLoaded) {
            return;
        }

        // KANBAN:170's `unwatch()`, honoured on every later run.
        if (flatBootstrapDoneRef.current) {
            return;
        }

        const root = rootRef.current;

        if (root === null) {
            return;
        }

        // KANBAN:165-L168 — swimlane mode registers itself, one swimlane at a time.
        if (resolveSwimlaneMode(root)) {
            return;
        }

        flatBootstrapDoneRef.current = true;

        // KANBAN:172-L175.
        registerContainers(toHtmlElements(root.querySelectorAll(TASKBOARD_COLUMN_SELECTOR)));
    }, [isTableLoaded, registerContainers, rootRef]);

    /* ----------------------------------------------------------------------
     * THE TWO CLASSES THIS HOOK OWNS
     * -------------------------------------------------------------------- */

    /**
     * Strips `target-drop` from every container still carrying it.
     *
     * This is the port of a detail that is easy to miss: the retired library emitted
     * a FINAL `out` for its last drop target from inside its own cleanup, BEFORE the
     * drag-end handler ran, so the highlight was always gone by then. The adopted
     * library emits no such event, so the sweep is explicit — and it is a sweep over
     * a tracked set rather than a query, so it cannot touch a container this hook did
     * not decorate.
     */
    const clearTargetDrop = useCallback((): void => {
        for (const container of decoratedRef.current) {
            container.classList.remove(TARGET_DROP_CLASS);
        }

        decoratedRef.current.clear();
        lastOverContainerRef.current = null;
    }, []);

    /** Undoes one column's `new` decoration, listener first. A no-op for anything else. */
    const releaseColumnNew = useCallback((element: HTMLElement): void => {
        const listener = pendingNewRef.current.get(element);

        if (listener === undefined) {
            return;
        }

        pendingNewRef.current.delete(element);
        element.removeEventListener(ANIMATION_END_EVENT, listener);
        element.classList.remove(NEW_COLUMN_CLASS);
    }, []);

    /** Undoes every outstanding `new` decoration. */
    const clearPendingNew = useCallback((): void => {
        for (const [column, listener] of pendingNewRef.current) {
            column.removeEventListener(ANIMATION_END_EVENT, listener);
            column.classList.remove(NEW_COLUMN_CLASS);
        }

        pendingNewRef.current.clear();
    }, []);

    /**
     * KANBAN:128-L131 — flash the destination column once.
     *
     *     $(parentEl).addClass('new')
     *     $(parentEl).one 'animationend', () -> $(parentEl).removeClass('new')
     *
     * `one` means EXACTLY ONCE, so the listener detaches itself, and the removal is
     * driven by the animation the stylesheet already declares
     * (`kanban-table.scss` L241 and L244) — no timer, no animation library, and no
     * duration duplicated on this side where it could drift out of step with the CSS.
     *
     * A column re-flashed before its previous animation finished is released first, so
     * the class is re-added rather than left permanently on, and only one listener is
     * ever attached per column.
     */
    const markColumnNew = useCallback(
        (column: HTMLElement): void => {
            releaseColumnNew(column);

            const listener = (): void => {
                pendingNewRef.current.delete(column);
                column.removeEventListener(ANIMATION_END_EVENT, listener);
                column.classList.remove(NEW_COLUMN_CLASS);
            };

            column.classList.add(NEW_COLUMN_CLASS);
            column.addEventListener(ANIMATION_END_EVENT, listener);
            pendingNewRef.current.set(column, listener);
        },
        [releaseColumnNew],
    );

    /* ----------------------------------------------------------------------
     * PLACEMENT — WHAT THE RETIRED LIBRARY USED TO DO FOR US
     * -------------------------------------------------------------------- */

    /**
     * Puts the dragged element where the pointer says it belongs, ONCE.
     *
     * See header section 5 for why this exists at all. Two properties matter more
     * than the three lines that do the work:
     *
     *   IT IS IDEMPOTENT. When the element is already the container's last child (for
     *   an append) or already immediately before the reference (for an insert),
     *   NOTHING is touched. A screen that projects the arrangement into its own state
     *   and re-renders therefore never has its DOM written to, and a repeated over
     *   event for an unchanged target costs nothing.
     *
     *   IT RECORDS WHETHER IT ACTED. Only a move this hook performed is ever undone
     *   (see {@link restoreDraggedItem}), so an abandoned gesture cannot disturb a
     *   position the screen itself established.
     *
     * A card is never ordered against itself, which is what the reference test in the
     * first line rules out.
     */
    const placeDraggedItem = useCallback(
        (item: HTMLElement, container: HTMLElement, reference: HTMLElement | null): void => {
            const anchor = reference === item ? null : reference;

            if (anchor === null) {
                if (item.parentElement === container && item.nextElementSibling === null) {
                    return;
                }

                container.appendChild(item);
            } else {
                if (item.parentElement === container && item.nextElementSibling === anchor) {
                    return;
                }

                container.insertBefore(item, anchor);
            }

            movedByHookRef.current = true;
        },
        [],
    );

    /**
     * Returns the dragged element to the anchor captured at drag start.
     *
     * Runs for an abandoned gesture, for a drop the shared arithmetic refuses, and for
     * an unmount mid-drag — every case in which NOTHING is persisted, so the board's
     * state is unchanged and a displaced element would be showing an order the state
     * does not have. It restores only what this hook moved.
     *
     * The remembered sibling may itself have been removed in the meantime, and
     * inserting before a node that is no longer a child would throw, so it is
     * re-verified and degraded to an append.
     */
    const restoreDraggedItem = useCallback((): void => {
        if (!movedByHookRef.current) {
            return;
        }

        movedByHookRef.current = false;

        const item = draggedItemRef.current;
        const anchor = originAnchorRef.current;

        if (item === null || anchor === null) {
            return;
        }

        const { nextSibling, parent } = anchor;
        const reference =
            nextSibling !== null && nextSibling.parentNode === parent ? nextSibling : null;

        parent.insertBefore(item, reference);
    }, []);

    /** Forgets the current gesture. `initialContainerRef` survives — see its note. */
    const resetGesture = useCallback((): void => {
        draggedItemRef.current = null;
        stoppedElementsRef.current = [];
        originAnchorRef.current = null;
        movedByHookRef.current = false;
        lastOverContainerRef.current = null;
    }, []);

    /* ----------------------------------------------------------------------
     * THE LIFECYCLE — KANBAN:65 THROUGH KANBAN:153
     * -------------------------------------------------------------------- */

    /**
     * KANBAN:75-L87's `drag` handler.
     *
     * ⚠️ THE CALL ORDER IS THE BOARD'S, AND IT IS THE REVERSE OF THE STORY LIST'S.
     * The board READS THE SELECTION FIRST (KANBAN:76) and arms the gesture LAST
     * (KANBAN:87); the story list arms first and reads afterwards. That is why
     * `multiDragCallOrder` is stated explicitly below as `'elements-then-start'`
     * rather than left to a default, and why the read here happens in the drag-start
     * callback: the selection has to be known before the start index is measured, and
     * before anything can move.
     *
     * Reading it here is safe and cannot double-count. The selection query is
     * document-wide for the selection class, and a ghost clone COPIES that class — but
     * no ghost can exist yet, because the provider has not called `start()` and
     * `start()` itself defers its preparation to the first pointer movement.
     *
     * The element-name predicate of KANBAN:59-L60 is applied here as well: a gesture
     * whose subject is not a card is not tracked, so nothing is measured, nothing is
     * moved and no move is ever emitted for it.
     */
    const handleDragStart = useCallback(
        (event: DragStartEventArg): void => {
            const item = resolveDraggedItem(event.active, containersRef.current);

            if (!isCardElement(item)) {
                resetGesture();

                return;
            }

            // KANBAN:76-L80 — the selection, then the single-item fallback.
            const selected = multiDragRef.current.getElements();
            const dragged: readonly HTMLElement[] = selected.length > 0 ? selected : [item];

            draggedItemRef.current = item;
            stoppedElementsRef.current = [];

            /*
             * KANBAN:82-L85 — the start index, measured for `dragMultipleItems[0]`
             * inside the GRABBED card's column. Both halves of that are the shared
             * arithmetic's job: it applies the same single-item fallback, it picks the
             * first element as the primary, and it owns the container-scoped
             * measurement. Nothing here re-derives an index.
             */
            sortable.beginDrag(item, dragged);

            // KANBAN:86 — cleared AFTER the index is captured, never before.
            initialContainerRef.current = null;
            lastOverContainerRef.current = null;

            const parent = item.parentElement;

            originAnchorRef.current =
                parent === null ? null : { parent, nextSibling: item.nextSibling };
            movedByHookRef.current = false;
        },
        [resetGesture, sortable],
    );

    /**
     * KANBAN:65-L73's `over` and `out` handlers, plus KANBAN:95-L107's `drop`.
     *
     * The retired library emitted `out` for the container being left and `over` for
     * the one being entered, as a pair, whenever the drop target changed. The adopted
     * library reports one target change per notification, so the pair is reconstructed
     * from that transition — including the case where the pointer leaves every
     * container, which is an `out` with no matching `over`.
     *
     * `target-drop` goes on a container ONLY when it differs from the first one
     * hovered (KANBAN:68), so the column a drag started in is never highlighted as its
     * own drop target, and the removal carries the same test (KANBAN:72).
     *
     * The anchors are then recomputed for the arrangement that now stands — reset and
     * derived in one place, exactly as the incumbent's `drop` handler did
     * (KANBAN:96-L107), and delegated in full: the nearest-first sibling scans, the
     * guarded identifier read and the previous-wins exclusivity all live in
     * `../../shared/dnd/useSortableList`, where R-DND-2 says they must. Recomputing
     * them here would be the duplicated arithmetic that risk exists to forbid.
     */
    const handleDragOver = useCallback(
        (event: DragOverEventArg): void => {
            const item = draggedItemRef.current;

            if (item === null) {
                return;
            }

            const target = resolveDropTarget(event.over, containersRef.current);
            const container = target === null ? null : target.container;
            const previous = lastOverContainerRef.current;

            // KANBAN:71-L73 — `out`, for the container being left.
            if (previous !== null && previous !== container) {
                if (previous !== initialContainerRef.current) {
                    previous.classList.remove(TARGET_DROP_CLASS);
                }

                decoratedRef.current.delete(previous);
            }

            lastOverContainerRef.current = container;

            if (target === null || container === null) {
                return;
            }

            // KANBAN:65-L70 — `over`, for the container being entered.
            if (initialContainerRef.current === null) {
                initialContainerRef.current = container;
            } else if (container !== initialContainerRef.current) {
                container.classList.add(TARGET_DROP_CLASS);
                decoratedRef.current.add(container);
            }

            placeDraggedItem(item, container, target.reference);

            // KANBAN:95-L107, in one delegated call.
            sortable.recordNeighbours(item);
        },
        [placeDraggedItem, sortable],
    );

    /**
     * KANBAN:111's `window.dragMultiple.stop()` — whose result is captured, not
     * requested.
     *
     * The provider calls `stop()` itself, exactly once, on the controller this hook
     * handed it, for a completed drag AND for an abandoned one; this callback is how
     * the returned elements arrive. Calling `stop()` here as well would tear the
     * ghosts down twice and, worse, would report an empty second result that the
     * single-item fallback would silently accept.
     */
    const handleMultiDragEnd = useCallback((elements: readonly HTMLElement[]): void => {
        stoppedElementsRef.current = elements;
    }, []);

    /**
     * KANBAN:52-L54's `deleteElement`, natively.
     *
     *     deleteElement = (itemEl) ->
     *         itemEl.off()
     *         itemEl.remove()
     *
     * `itemEl.off()` detached every jQuery handler on the element. This hook attaches
     * NO handler to a card — the only listener it ever attaches is the one-shot
     * animation listener on a COLUMN — so the faithful native equivalent is to release
     * this hook's own bookkeeping for the element and then remove it. Anything else
     * on that node belongs to React, which drops its own listeners when the element
     * leaves the tree.
     *
     * ⛔ AND THERE IS NO `scope().$destroy()` HERE. The story list's equivalent
     * destroys the row's scope; the board's does not, and adding it would be inventing
     * behaviour for this screen. There is no AngularJS scope on this side of the seam
     * to destroy in any case.
     */
    const deleteElement = useCallback(
        (element: HTMLElement): void => {
            decoratedRef.current.delete(element);
            releaseColumnNew(element);

            element.remove();
        },
        [releaseColumnNew],
    );

    /**
     * Looks every dragged id up in the board's own story map — KANBAN:133-L134.
     *
     * ALL OR NOTHING. A missing story means the board's state and its DOM disagree,
     * which the shared arithmetic has already refused a drop over (its membership
     * check is this same lookup), so reaching this is an invariant violation rather
     * than an expected case. Returning `null` rather than a shorter list is what keeps
     * a multi-card move from being half-applied: the position-relative write would
     * reorder the board around whichever cards survived the filter, with no error
     * anywhere. On the happy path the output is identical to the incumbent's.
     */
    const resolveCards = useCallback(
        (ids: readonly number[]): readonly CardUserStoryVm[] | null => {
            const { getCard } = optionsRef.current;
            const cards: CardUserStoryVm[] = [];

            for (const id of ids) {
                const card = getCard(id);

                if (card === undefined) {
                    return null;
                }

                cards.push(card);
            }

            return cards;
        },
        [],
    );

    /**
     * KANBAN:109-L153's `dragend` handler — the whole of it, in the incumbent's order.
     *
     * Nothing is persisted before the lifecycle has been settled and the data
     * extracted, and nothing at all is persisted when the guard fires. The drag-end
     * event of the adopted library carries no argument this handler needs: the subject
     * and the selection were captured at drag start and by the multi-drag callback
     * above, which is also why the two cannot disagree about what moved.
     */
    const handleDragEnd = useCallback((): void => {
        // The retired library's final `out`, which fired before its `dragend`.
        clearTargetDrop();

        const item = draggedItemRef.current;

        if (item === null) {
            resetGesture();

            return;
        }

        // KANBAN:111-L118 — what `stop()` reported, or the single dragged element.
        const stopped = stoppedElementsRef.current;
        const dragged: readonly HTMLElement[] = stopped.length > 0 ? stopped : [item];

        // KANBAN:110 — the DESTINATION column, which is where the element now sits.
        const parentEl = resolveColumn(item);

        if (parentEl === null) {
            restoreDraggedItem();
            resetGesture();

            return;
        }

        /*
         * KANBAN:120 and KANBAN:124-L125 — the drop index and the guard, both from the
         * shared arithmetic. `null` is its way of saying "persist nothing": the
         * incumbent's bare `return` for an unchanged drop, and additionally a refusal
         * when a dragged element carries no canonical positional id or names a story
         * this board does not hold. All three reach the same place, so no extra branch
         * is needed and an untrustworthy drop is simply not written.
         */
        const result = sortable.endDrag(item, dragged, parentEl);

        if (result === null) {
            restoreDraggedItem();
            resetGesture();

            return;
        }

        // KANBAN:121-L122.
        const newStatus = readColumnStatusId(parentEl);
        const newSwimlane = readColumnSwimlaneId(parentEl);

        // KANBAN:127-L131.
        if (initialContainerRef.current !== parentEl) {
            markColumnNew(parentEl);
        }

        // KANBAN:133-L134, using the ids the shared arithmetic already validated.
        const cards = resolveCards(result.ids);

        if (cards === null) {
            restoreDraggedItem();
            resetGesture();

            return;
        }

        /*
         * KANBAN:136-L141. `oldSwimlaneId` is `model.swimlane` with NO fallback, which
         * is KANBAN:140 exactly — and is deliberately NOT the value the comparison
         * below builds seven lines later in the incumbent. See
         * {@link KanbanMovedUserStory}.
         */
        const finalUsList: readonly KanbanMovedUserStory[] = cards.map(
            (card): KanbanMovedUserStory => ({
                id: card.id,
                oldStatusId: card.model.status,
                oldSwimlaneId: card.model.swimlane,
            }),
        );

        /*
         * KANBAN:144-L151. The incumbent wraps this loop and the emission below in
         * `$scope.$apply`; React drives its own updates, so the wrapper is dropped and
         * NOTHING asks AngularJS for a digest — but the ORDER inside it is preserved:
         * the elements that changed container are removed first, and only then is the
         * move emitted.
         *
         * ⭐ THIS comparison uses `|| UNCLASSIFIED_SWIMLANE_ID` — KANBAN:146's `|| -1`
         * — while the payload above uses no fallback at all. The sentinel is imported
         * from `../state/boardReducer` rather than written as a bare `-1` so the two
         * sides of the screen cannot drift apart. Note it is a FALSY test, so a
         * swimlane id of `0` also collapses to the sentinel; swimlane ids are positive
         * and the synthetic one is `-1`, so the branch is unreachable, and it is
         * reproduced verbatim regardless.
         */
        cards.forEach((card, key): void => {
            const oldStatus = card.model.status;
            const oldSwimlaneId = card.model.swimlane || UNCLASSIFIED_SWIMLANE_ID;
            const sameContainer = newStatus === oldStatus && newSwimlane === oldSwimlaneId;

            if (!sameContainer) {
                const element = dragged[key];

                if (element !== undefined) {
                    deleteElement(element);
                }
            }
        });

        /*
         * KANBAN:153 — the frozen emission. Six positional arguments, in this order,
         * behind the exact event name. The retained controller listens for it
         * (`main.coffee` L226) and issues the position-relative bulk write itself
         * (`main.coffee` L618-L625), so this hook performs no write of its own.
         */
        optionsRef.current.emitMove(
            KANBAN_US_MOVE_EVENT,
            finalUsList,
            newStatus,
            newSwimlane,
            result.index,
            result.previousId,
            result.nextId,
        );

        resetGesture();
    }, [
        clearTargetDrop,
        deleteElement,
        markColumnNew,
        resetGesture,
        resolveCards,
        restoreDraggedItem,
        sortable,
    ]);

    /**
     * An abandoned gesture — which the retired library had no way to report.
     *
     * It routed a cancelled drag through the same `dragend` handler, where the
     * unchanged-drop guard absorbed it. The adopted library reports cancellation
     * properly, so the gesture is discarded explicitly: the captured index, origin and
     * anchors are cleared, the classes this hook owns are stripped, and any move it
     * made is undone. NOTHING is emitted, which is the same observable outcome the
     * incumbent's guard produced.
     */
    const handleDragCancel = useCallback((): void => {
        clearTargetDrop();
        clearPendingNew();
        restoreDraggedItem();
        sortable.cancelDrag();
        resetGesture();
    }, [clearPendingNew, clearTargetDrop, resetGesture, restoreDraggedItem, sortable]);

    /*
     * KANBAN:177-L181 — `$el.off()` then `drake.destroy()`, natively and in that
     * order: this hook's own listeners and classes first, then the drag system.
     *
     * A subtree torn down MID-DRAG produces no drag-end event, so everything the
     * gesture owns has to be undone here or it is never undone at all. After this runs
     * there is no ghost, no hidden original, no transit or mirror class, no
     * destination class, no displaced element and no listener left behind.
     *
     * ⛔ The multi-selection controller and the drag context are NOT destroyed here.
     * `./DndProvider` destroys the controller it was given, exactly once, in its own
     * cleanup; a second teardown of someone else's object is how a shared adapter ends
     * up half torn down.
     */
    useEffect(() => {
        return (): void => {
            clearTargetDrop();
            clearPendingNew();
            restoreDraggedItem();
            sortable.cancelDrag();
            resetGesture();

            containersRef.current = [];
            initialisedRef.current = false;
            flatBootstrapDoneRef.current = false;
            initialContainerRef.current = null;
        };
    }, [clearPendingNew, clearTargetDrop, resetGesture, restoreDraggedItem, sortable]);

    /* ----------------------------------------------------------------------
     * AUTOSCROLL — THE BOARD'S NUMBERS, AND ONLY THE BOARD'S
     * -------------------------------------------------------------------- */

    /**
     * The registered containers, live. A GETTER rather than a captured array because
     * the board's columns do not exist until they have rendered and the set grows as
     * swimlanes open, so anything captured at mount would be empty or stale.
     */
    const getContainers = useCallback((): readonly HTMLElement[] => {
        return containersRef.current;
    }, []);

    /**
     * KANBAN:155-L160, exactly:
     *
     *     autoScroll(containers, { margin: 100, scrollWhenOutside: true,
     *                              autoScroll: -> this.down && drake.dragging })
     *
     * ⚠️ THE TWO SCREENS DIVERGE AND MUST NOT BE UNIFIED — the annotated story-list
     * reference says so outright. The story list passes `[window]` with
     * `{ margin: 20, pixels: 30 }`; the board passes ITS COLUMN CONTAINERS with
     * `margin: 100` AND NO `pixels` AT ALL. Both differences are load-bearing:
     *
     *   - `pixels` is absent here because the incumbent board never passed it. (The
     *     shared config accepts the field only so that the story list's copy of it is
     *     visibly accounted for; the installed library never read it, so implementing
     *     it would speed the story list up seven and a half fold — a functional change
     *     dressed as a bug fix.)
     *   - The targets are the columns, not the window, because the board scrolls its
     *     own columns. Handing it `[window]` would scroll the page while the pointer
     *     sat inside a column that never moved.
     *
     * The incumbent's fourth option — the `this.down && drake.dragging` predicate — has
     * no counterpart because the shared provider supplies it structurally: it arms the
     * loop at drag start and disarms it at drag end or cancel, so it cannot scroll the
     * board on plain hover.
     *
     * One stable object, so a re-render neither re-creates the loop nor restarts it
     * mid-gesture.
     */
    const autoScroll = useMemo<DndAutoScrollConfig>(
        () => ({
            enabled: true,
            margin: KANBAN_AUTOSCROLL_MARGIN,
            scrollWhenOutside: true,
            getTargets: getContainers,
        }),
        [getContainers],
    );

    /* ----------------------------------------------------------------------
     * THE DATA CONTRACTS THE BOARD FILLS IN
     * -------------------------------------------------------------------- */

    /**
     * A card's draggable `data`. See {@link KanbanDraggableData}.
     *
     * The container set is the FULL registered list, which is KANBAN:87's second
     * argument. Narrowing it to the card's own column would break multi-select across
     * columns: the selection is collected from the containers it is given.
     */
    const getDraggableData = useCallback(
        (sourceNode: HTMLElement): KanbanDraggableData => ({
            sourceNode,
            multiDragContainer: containersRef.current,
        }),
        [],
    );

    /**
     * A droppable's `data`. See {@link KanbanDroppableData}.
     *
     * One function for both kinds of droppable: given a column it yields the column,
     * and given a card it yields the card together with the column it sits in, which is
     * what lets a drop be positioned WITHIN a column rather than only appended to it.
     */
    const getDroppableData = useCallback((node: HTMLElement): KanbanDroppableData => {
        if (node.matches(TASKBOARD_COLUMN_SELECTOR)) {
            return { containerNode: node };
        }

        return { containerNode: resolveColumn(node) ?? undefined, itemNode: node };
    }, []);

    /* ----------------------------------------------------------------------
     * VIEWPORT REGISTRATION — R-DND-3
     * -------------------------------------------------------------------- */

    /**
     * `$scope.taskColumnLoaded` — `main.coffee` L679-L681.
     *
     * Registration is UNCONDITIONAL on visibility, by design (header section 6). The
     * only thing refused is a null ref, which is what React hands over as an element
     * leaves the tree.
     */
    const registerColumn = useCallback(
        (column: HTMLElement | null, statusId: number, swimlaneId?: number | null): void => {
            if (column === null) {
                return;
            }

            optionsRef.current.inViewport.registerColumn(column, statusId, swimlaneId);
        },
        [],
    );

    /**
     * `$scope.cardLoaded` — `main.coffee` L683-L684.
     *
     * ⭐ THE OUTER CARD ELEMENT ALWAYS EXISTS. `card.jade` L8-L13 guards the INNER
     * wrapper on the viewport flag, so the element carrying the positional attribute
     * renders whether or not the card is on screen — which is what makes an off-screen
     * card a legitimate drop neighbour. Nothing here consults visibility, computed
     * display, an offset parent or the presence of the inner wrapper, and NOTHING EVER
     * UNREGISTERS A CARD FOR LEAVING THE VIEWPORT: the shared latch is write-once, so
     * there is no such transition to react to.
     */
    const registerCard = useCallback(
        (card: HTMLElement | null, statusId: number, swimlaneId?: number | null): void => {
            if (card === null) {
                return;
            }

            optionsRef.current.inViewport.registerCard(card, statusId, swimlaneId);
        },
        [],
    );

    /* ----------------------------------------------------------------------
     * THE RESULT
     * -------------------------------------------------------------------- */

    /**
     * Everything the provider needs, in one object.
     *
     * `multiDragCallOrder` is stated rather than defaulted: it is the board's
     * getElements-before-start inversion (see {@link handleDragStart}), and a screen
     * that leaves it implicit is one library upgrade away from silently acquiring the
     * story list's order.
     */
    const dndProviderProps = useMemo<KanbanDndProviderProps>(
        () => ({
            autoScroll,
            collisionDetection,
            disabled,
            multiDrag,
            multiDragCallOrder: 'elements-then-start',
            renderOverlay,
            onDragStart: handleDragStart,
            onDragOver: handleDragOver,
            onDragEnd: handleDragEnd,
            onDragCancel: handleDragCancel,
            onMultiDragEnd: handleMultiDragEnd,
        }),
        [
            autoScroll,
            collisionDetection,
            disabled,
            handleDragCancel,
            handleDragEnd,
            handleDragOver,
            handleDragStart,
            handleMultiDragEnd,
            multiDrag,
            renderOverlay,
        ],
    );

    return useMemo<UseCardDragResult>(
        () => ({
            dndProviderProps,
            openSwimlane,
            getContainers,
            canMove: isCardElement,
            getDraggableData,
            getDroppableData,
            registerColumn,
            registerCard,
            visibleIds: inViewport.visibleIds,
        }),
        [
            dndProviderProps,
            getContainers,
            getDraggableData,
            getDroppableData,
            inViewport.visibleIds,
            openSwimlane,
            registerCard,
            registerColumn,
        ],
    );
}
