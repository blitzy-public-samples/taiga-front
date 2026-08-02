/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useSortableList — the ONE place the drag ordering arithmetic lives.
 *
 * ===========================================================================
 * 1. WHY THIS FILE IS THE HIGHEST-RISK FILE IN THIS FOLDER
 * ===========================================================================
 * The migration specification lists this module at section 0.5.1 as
 * "useSortableList.ts — Manual ordering from collision data" and records at
 * section 0.6.2 that the ordering companion package of the adopted drag library
 * is deliberately NOT part of the pinned dependency set. Named risk R-DND-2
 * spells out the consequence:
 *
 *     only the core drag package is pinned. Reordering must be computed
 *     manually from collision data. Combined with the position-relative write
 *     API (previousUs/nextUs -> after_userstory_id/before_userstory_id), AN
 *     OFF-BY-ONE IN THAT COMPUTATION SILENTLY PERSISTS A WRONG ORDER WITH NO
 *     ERROR SURFACE.
 *
 * Read that literally. When this arithmetic is wrong there is no exception, no
 * toast, no console warning and no failing request. The board and the table
 * both look exactly right for the rest of the session, and the corruption
 * appears only on the NEXT page load, to a different person, with nothing in
 * the logs pointing back here. That is why every rule reproduced below carries
 * its incumbent locator, why the neighbour scan and the three index semantics
 * are separate exported functions rather than inlined expressions, and why the
 * co-located specification covers the FIRST-position, LAST-position and
 * CROSS-CONTAINER cases explicitly.
 *
 * The write side confirms the shape from the other end.
 * `app/coffee/modules/resources/userstories.coffee` builds both order payloads
 * with an exclusive chain — `if afterUserstoryId ... else if beforeUserstoryId`
 * at L99-L103 for the backlog and L120-L124 for the board — so when both are
 * supplied ONLY `after_userstory_id` reaches the server, and when neither is
 * supplied neither key is sent at all. The two halves have to agree:
 *
 *     previousCard / previousUs  ->  previousId  ->  after_userstory_id
 *     nextCard     / nextUs      ->  nextId      ->  before_userstory_id
 *
 * ===========================================================================
 * 2. LOCATOR SHORTHAND USED THROUGHOUT THIS FILE
 * ===========================================================================
 *   KANBAN:NN   line NN of `app/coffee/modules/kanban/sortable.coffee` as it
 *               stood before the migration (192 lines). The same code is
 *               retained, unregistered, in the current tree; where the retained
 *               line number differs it is given as "retained :NN".
 *   BACKLOG:NN  line NN of `app/coffee/modules/backlog/sortable.coffee` as it
 *               stood before the migration (159 lines), with the same
 *               "retained :NN" convention.
 *
 * Both of those files are READ-ONLY REFERENCES and are NEVER imported. They are
 * CoffeeScript, `tsconfig.json` enables no `allowJs`, and no ambient
 * declaration was added for them, so they are not part of this program at all.
 * Every behaviour below was reimplemented from reading them line by line.
 *
 * This module has exactly ONE import — three named React hooks. It reaches no
 * service, opens no transport, touches no store and holds no domain model: it
 * deals in DOM element positions and plain numeric ids, and nothing else.
 *
 * ===========================================================================
 * 3. THE PUBLISHED CONTRACT, AND WHO CONSUMES IT
 * ===========================================================================
 * Two consumers are planned and NEITHER EXISTS YET, so the exported surface of
 * this file IS their contract rather than a reflection of it:
 *
 *   - `app/react/kanban/hooks/useCardDrag.ts`   — the board-side consumer,
 *     porting the `drag` handler at KANBAN:75-L87 (retained :184-:196) and the
 *     `drop` / `dragend` handlers at KANBAN:95-L153 (retained :224-:341).
 *   - `app/react/backlog/hooks/useStoryDrag.ts` — the list-side consumer,
 *     porting the `drop` handler at BACKLOG:50-L63 (retained :95-:108) and the
 *     `drag` / `dragend` handlers at BACKLOG:65-L143 (retained :110-:188).
 *
 * Both of those screens ultimately feed the two order endpoints through the
 * typed facades under `app/react/shared/api`, and the backlog controller
 * INVERTS the names on the way: its `previousUs` becomes the facade's
 * `afterUserstoryId`, its `nextUs` becomes `beforeUserstoryId`, and its
 * `currentSprintId` becomes `milestoneId`. That renaming is recorded here so
 * whoever wires `useStoryDrag.ts` does not cross the pair over — crossing them
 * over is precisely the silent corruption described in section 1.
 *
 * ===========================================================================
 * 4. SCOPE SPLIT — WHAT THIS FILE OWNS AND WHAT IT MUST NOT ABSORB
 * ===========================================================================
 * OWNED HERE: the neighbour arithmetic, the three index semantics, the
 * early-return guard, the positional id reader, and the per-drag capture of the
 * start index and the origin container.
 *
 * OWNED BY THE SCREENS, exposed here as configuration or simply left alone —
 * never hardcoded in this file:
 *
 *   - The permission gates. The board returns early on two separate checks (a
 *     `modify_us` membership test, then an archived-project test); the list
 *     combines them into ONE condition whose precedence differs, at BACKLOG:30
 *     (retained :75): `if not (project.my_permissions.indexOf("modify_us") >
 *     -1) and !project.archived_code then return`. That precedence is
 *     reproduced EXACTLY by the screens and is not "fixed" here or there. React
 *     reads the same `my_permissions` array the permission directives read and
 *     forms no independent notion of what the user may do.
 *   - Container registration, and therefore the `.taskboard-column`,
 *     `.sprint-table`, `.backlog-table-body` and `.js-empty-backlog` selectors.
 *     This file is told which selector to use; it never chooses one.
 *   - Every runtime class the drag visuals depend on: `target-drop` on a
 *     hovered board column, `drag-active` on the document body (the LIST only —
 *     the board never does this), the doom-line removal, and the `new` class
 *     with its `animationend` removal. The placeholder class named below is
 *     READ here as an exclusion selector and is applied elsewhere.
 *   - Element deletion when the container changed, the serialised drag queue
 *     with its re-entrancy guard and server-value reconciliation
 *     (`app/coffee/modules/backlog/main.coffee` L84, L539-L546, L600-L601,
 *     L603-L618, L620-L629, L630-L631 and L633-L635), the velocity-forecasting
 *     toggle, and every write to the REST API.
 *
 * So this module issues NO write, NO dispatch, NO broadcast and keeps NO queue.
 * It computes `{ previousId, nextId, index, oldIndex, unchanged, ids }` and
 * reports it, exactly as the incumbent handlers computed those six values and
 * handed them to their controllers — the board through a root-scope broadcast
 * at KANBAN:153 (retained :341), the list through `ctrl.moveUs(...)` at
 * BACKLOG:143 (retained :188).
 *
 * ===========================================================================
 * 5. THE SIX ARITHMETIC TRAPS, IN ONE PLACE
 * ===========================================================================
 * Each is reproduced at its point of use below with its own note. Summarised
 * here so a reviewer can check them off without reading the whole file:
 *
 *   TRAP 1  The sibling scans are NEAREST-FIRST. jQuery `.prevAll(sel)` yields
 *           preceding siblings in REVERSE document order, so `prev[0]` is the
 *           IMMEDIATELY preceding match. Collecting matches in document order
 *           and taking `[0]` picks the FURTHEST one — an off-by-many that no
 *           single-step drag test would ever catch.
 *   TRAP 2  PREVIOUS WINS. `nextId` is computed ONLY when there is no previous.
 *           The pair is mutually exclusive, mirroring the exclusive chain in
 *           the write layer quoted in section 1.
 *   TRAP 3  That check is FALSY, not null. The incumbent writes
 *           `if !previousCard`, so a previous id of 0 falls through and the
 *           next id is computed as well. Ids are positive in this application
 *           so it never fires, and it is reproduced verbatim regardless.
 *   TRAP 4  The id is read only after the attribute is confirmed present and
 *           non-empty, so a missing id yields `null` and never `NaN`.
 *   TRAP 5  The exclusion covers ONLY the drag placeholder. Originals that the
 *           multi-select machinery hid are display-suppressed but do NOT carry
 *           the placeholder class, so they still match and CAN be chosen as
 *           neighbours. That is incumbent behaviour and is preserved.
 *   TRAP 6  There are THREE index semantics and they are NOT interchangeable:
 *           container-scoped, document-scoped and sibling-scoped. Each is its
 *           own exported function below.
 *   TRAP 6b The document-scoped selector must stay SCOPED to the table body.
 *           The backlog table HEADER also carries the row class
 *           (`app/partials/includes/modules/backlog-table.jade` L9 renders
 *           `div.row.backlog-table-title`) but sits in `.backlog-table-header`,
 *           OUTSIDE `div.backlog-table-body` (L19). Drop the scoping and every
 *           backlog index shifts by one.
 *
 * ===========================================================================
 * 6. TWO PATHS TO THE SAME ANSWER, AND THE EQUIVALENCE THEY OWE
 * ===========================================================================
 * The retired library physically moved the dragged node before its `drop`
 * handler ran, so the incumbent arithmetic reads a DOM that already reflects
 * the new arrangement. The adopted library NEVER moves DOM nodes; it reports
 * the active item, the item under the pointer and the collision set. Both
 * situations therefore have to be served:
 *
 *   `computeNeighbours(item, itemSelector)`  — the DOM path, and THE
 *       SPECIFICATION. A literal port of KANBAN:95-L107 and BACKLOG:50-L63.
 *       Use it whenever the DOM already reflects the arrangement.
 *   `computeNeighboursFromOrder(orderedIds, movedIds, targetIndex)` — the
 *       projected-order path, for collision data that describes an arrangement
 *       the DOM has not adopted.
 *
 * The co-located specification asserts the two agree on every fixture,
 * including the first and last positions. WHERE THEY EVER DISAGREE THE DOM PATH
 * IS CORRECT BY DEFINITION.
 *
 * ===========================================================================
 * 7. R-DND-3 — NEVER GATE ORDERING ON VISIBILITY
 * ===========================================================================
 * The adopted drag library has no virtual-list support of its own, and the
 * board virtualises cards through `../useInViewport`. Two structural facts keep
 * that safe, and this file must not undo either:
 *
 *   - `app/modules/components/card/card.jade` L8-L13 puts the viewport guard on
 *     the INNER wrapper, inside the outer custom element, and the card
 *     directive declares no element replacement — so the outer element carrying
 *     the positional attribute ALWAYS renders, whether the card is on screen or
 *     not. Positions are therefore computed against that always-present outer
 *     element.
 *   - `../useInViewport` latches visibility monotonically: an id marked visible
 *     is never marked invisible again. There is no "left the viewport"
 *     transition to react to.
 *
 * Consequently NOTHING in this file filters elements by visibility, by computed
 * display, by an offset parent or by a viewport flag. Filtering here would make
 * a drag toward a scrolled-away region find no drop target — which, once more,
 * fails silently.
 */

import { useCallback, useMemo, useRef } from 'react';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The drag placeholder class — the gap left behind in the source list while a
 * drag is under way — excluded from every neighbour scan.
 *
 * SPELLED VERBATIM (transformation rule T1: "Preserve every CSS class name...
 * so the existing stylesheets apply verbatim"). Three in-scope rules depend on
 * this exact spelling and all three are kept at zero edits:
 * `app/styles/modules/backlog/backlog-table.scss:235` (`.us-item-row.gu-transit`)
 * and `:330`, and `app/styles/modules/backlog/sprints.scss:307`.
 *
 * READ HERE, NEVER ASSIGNED. Applying it to the drag source is the drag
 * provider's job (`./DndProvider`); this file only excludes it, reproducing the
 * `:not(.gu-transit)` clause of KANBAN:98-L99 (retained :227-:228) and
 * BACKLOG:54-L55 (retained :99-:100).
 *
 * The same literal is exported by `./multiDrag` for its own use. It is declared
 * locally here on purpose, so the arithmetic below carries NO module dependency
 * whatsoever and can be exercised by a browserless specification with an empty
 * transitive graph. Both declarations spell the class name identically; that is
 * the point of T1, not a duplication to be factored away.
 */
export const TRANSIT_CLASS = 'gu-transit';

/**
 * The shared "no neighbour on either side" value, which is what an empty
 * container, a detached element and a drag with no selection all resolve to.
 * Frozen so a consumer cannot mutate the value every caller sees.
 */
const NO_NEIGHBOURS: SortableNeighbours = Object.freeze({
    previousId: null,
    nextId: null,
});

/**
 * Reported as `oldIndex` when a drop is resolved without a preceding drag
 * start, and returned by all three index functions when the element is absent
 * from the set being measured. The value is jQuery's own "not found" marker,
 * which is what the incumbent expressions returned in that situation.
 */
const NOT_FOUND = -1;

/* ==========================================================================
 * PUBLIC TYPES
 * ========================================================================== */

/**
 * The CSS selector identifying one sortable item.
 *
 * `'tg-card'` for the board — a tag selector, because the board's items are
 * custom elements (`app/partials/includes/modules/kanban-table.jade` L150 in
 * swimlane mode and L226 in flat mode both render
 * `tg-card.card.ng-animate-disabled(data-id="{{ usId }}")`).
 *
 * `'.row'` for the backlog table and for every sprint table — a class selector
 * (`app/partials/includes/components/backlog-row.jade` L8 renders
 * `.row.us-item-row(... data-id="{{ us.id }}")` and
 * `app/partials/backlog/sprint.jade` L17 renders
 * `div.row.milestone-us-item-row(... data-id="{{ us.id }}")`).
 *
 * Which one applies is the screen's decision, never this file's.
 */
export type SortableItemSelector = string;

/**
 * The position-relative anchors a reorder is expressed with. Exactly one of the
 * two is ever non-null — see TRAP 2 — and the write layer enforces the same
 * exclusivity from its end.
 */
export interface SortableNeighbours {
    /**
     * The `previousCard` of KANBAN:96 and the `previousUs` of BACKLOG:51. Sent
     * as `after_userstory_id`.
     */
    readonly previousId: number | null;

    /**
     * The `nextCard` of KANBAN:97 and the `nextUs` of BACKLOG:52. Sent as
     * `before_userstory_id`. Non-null ONLY when `previousId` is falsy.
     */
    readonly nextId: number | null;
}

/**
 * Everything one resolved drop reports. The six fields are exactly the six
 * values the incumbent `dragend` handlers assembled before handing them to
 * their controllers.
 */
export interface SortableDropResult extends SortableNeighbours {
    /**
     * The index at drop, measured with whichever of the three semantics of
     * TRAP 6 the configuration selected. The `index` of KANBAN:120 (retained
     * :264) and of BACKLOG:115 or BACKLOG:117 (retained :160 or :162).
     */
    readonly index: number;

    /**
     * The index captured at drag start — the `oldIndex` of KANBAN:85 (retained
     * :194) and of BACKLOG:87 or BACKLOG:89 (retained :132 or :134). Reported
     * as `-1` when the drop was resolved without a preceding drag start; see
     * the note on the guard in `endDrag` for why that cannot make the guard
     * misfire.
     */
    readonly oldIndex: number;

    /**
     * Whether the incumbent guard would have returned early, i.e. whether the
     * index is unchanged AND the container is the same. `endDrag` returns
     * `null` instead of a result when that holds, so a result obtained FROM
     * `endDrag` always carries `false` here; the field is part of the shape so
     * a consumer computing a result itself can express the guard, and so a
     * result read from `endDrag` states plainly that the guard did not fire.
     */
    readonly unchanged: boolean;

    /**
     * The positional id of every dragged element, in the order the elements
     * were supplied — which the multi-select machinery already guarantees to be
     * document order with the primary first. `ids[0]` is therefore the primary,
     * the `firstElement` of KANBAN:118 and BACKLOG:112.
     */
    readonly ids: readonly number[];
}

/* ==========================================================================
 * INTERNAL HELPERS
 * ========================================================================== */

/**
 * TRAP 4, in one place. Reads the positional id off one element, guarding the
 * attribute BEFORE converting, exactly as KANBAN:102-L103 (retained :231-:232)
 * and BACKLOG:58-L59 (retained :103-:104) do:
 *
 *     if prev.length && prev[0].dataset.id
 *         previousCard = Number(prev[0].dataset.id)
 *
 * Three details are load-bearing and all three are reproduced:
 *
 *   - The guard is a TRUTHINESS test on the raw attribute value. An absent
 *     attribute and an empty attribute are both falsy, so both leave the result
 *     `null`. `NaN` therefore never reaches a payload through this path — which
 *     matters, because `NaN` in `after_userstory_id` is exactly the kind of
 *     write that fails silently rather than loudly.
 *   - `'0'` is a NON-EMPTY string and so passes the guard, yielding the number
 *     0. That is what makes TRAP 3 reachable at all, and it is preserved.
 *   - The conversion is bare `Number(...)`, so a non-numeric attribute yields
 *     `NaN` here just as it does upstream. Preserved under transformation rule
 *     T10 ("No functional or feature change of whatever kind"); the measured
 *     markup always interpolates a numeric id, so this is a defensive path.
 *
 * The attribute is read with `getAttribute('data-id')` rather than through the
 * dataset map, because `getAttribute` is declared on `Element` — so the sibling
 * walk below needs no type narrowing and can therefore never silently SKIP a
 * matching sibling merely because of its element kind. The dataset map is
 * declared only on the HTML and SVG element interfaces, and skipping a match
 * would move the chosen neighbour by one.
 *
 * THE TWO ACCESSORS ARE INTERCHANGEABLE HERE, AND ONLY HERE, and the reason is
 * worth stating precisely because it does NOT generalise. Whenever the attribute
 * is present both return the identical string. Whenever it is absent they differ
 * — `getAttribute` reports `null` and the dataset map reports `undefined` — but
 * BOTH are falsy, and this function's guard rejects the value before it ever
 * reaches the conversion, so the difference cannot be observed through it. Read
 * an attribute WITHOUT that guard and the difference becomes visible and
 * significant: converting `null` yields ZERO while converting `undefined` yields
 * a not-a-number value. See the warning on `resolveContainer` in
 * `UseSortableListConfig`, where exactly that distinction is load-bearing.
 */
function readPositionalId(element: Element): number | null {
    const raw = element.getAttribute('data-id');

    if (!raw) {
        return null;
    }

    return Number(raw);
}

/**
 * TRAP 5, in one place. Whether one sibling counts as a neighbour candidate:
 * it matches the item selector AND is not the drag placeholder. This is the
 * `'tg-card:not(.gu-transit)'` of KANBAN:98-L99 and the `'.row:not(.gu-transit)'`
 * of BACKLOG:54-L55.
 *
 * THE TEST IS DECOMPOSED ON PURPOSE. Building the string
 * `` `${itemSelector}:not(.${TRANSIT_CLASS})` `` and handing it to `matches`
 * would be wrong for a selector LIST: in `'a, b:not(.gu-transit)'` the
 * exclusion binds to the last branch alone, so a placeholder matching an
 * earlier branch would be accepted as a neighbour. Testing the selector and the
 * class separately is what `:not()` appended to every branch actually means, and
 * it holds for a selector of whichever shape the screens pass in.
 *
 * NO VISIBILITY TEST APPEARS HERE, deliberately (R-DND-3, section 7 of the file
 * header). Originals hidden by the multi-select machinery are display-suppressed
 * but do NOT carry the placeholder class, so they still match and can still be
 * chosen — which is incumbent behaviour, not an oversight to be corrected.
 *
 * An invalid selector makes `matches` throw, and that is left to throw. A loud
 * failure at development time is strictly better than the alternative this whole
 * module exists to prevent: a plausible-looking, quietly wrong order.
 */
function isNeighbourCandidate(sibling: Element, itemSelector: SortableItemSelector): boolean {
    return sibling.matches(itemSelector) && !sibling.classList.contains(TRANSIT_CLASS);
}

/**
 * TRAP 1, in one place. Walks outward from `item` one element sibling at a time
 * and returns the FIRST candidate found, which is the NEAREST one.
 *
 * jQuery `.prevAll(sel)` returns preceding siblings in REVERSE document order,
 * so its `prev[0]` is the immediately preceding match; `.nextAll(sel)` returns
 * following siblings in document order, so its `next[0]` is the immediately
 * following match. Both therefore mean "nearest", and a stepwise walk expresses
 * that directly. The tempting alternative — collect every preceding match in
 * document order, take `[0]` — silently returns the FURTHEST match instead, and
 * a single-step drag test cannot tell the two apart because for a single step
 * they coincide.
 *
 * Element siblings only, matching jQuery's traversal, so text nodes and comment
 * nodes between rows are stepped over rather than ending the walk. A detached
 * element has no siblings and yields `null` in both directions.
 */
function nearestCandidateSibling(
    item: Element,
    itemSelector: SortableItemSelector,
    direction: 'previous' | 'next',
): Element | null {
    let sibling: Element | null =
        direction === 'previous' ? item.previousElementSibling : item.nextElementSibling;

    while (sibling !== null) {
        if (isNeighbourCandidate(sibling, itemSelector)) {
            return sibling;
        }

        sibling =
            direction === 'previous' ? sibling.previousElementSibling : sibling.nextElementSibling;
    }

    return null;
}

/**
 * The multi-select fallback, reproduced from KANBAN:113-L118 —
 *
 *     if !dragMultipleItems.length
 *         dragMultipleItems = [item]
 *     firstElement = dragMultipleItems[0]
 *
 * — and from its one-line equivalent at BACKLOG:81 and BACKLOG:112,
 * `firstElement = if dragMultipleItems.length then dragMultipleItems[0] else item`.
 *
 * A single-item drag reports no selection, and everything downstream then treats
 * the grabbed element as a selection of one. Both screens depend on that, which
 * is why the fallback lives here rather than in each caller.
 */
function resolveDraggedElements(
    item: HTMLElement,
    draggedElements: readonly HTMLElement[],
): readonly HTMLElement[] {
    return draggedElements.length > 0 ? draggedElements : [item];
}

/* ==========================================================================
 * THE ARITHMETIC — PURE FUNCTIONS, NO REACT, NO STATE, NO SERVICES
 * ==========================================================================
 * Everything in this section is a pure function of its arguments and the DOM
 * they point at. That is what makes implicit requirement I9 work — "data
 * fetching and drag effects must be isolated in hooks and containers, leaving
 * pure components independently testable" — and it is what lets the co-located
 * specification drive the whole arithmetic against a plain jsdom fixture with no
 * React, no drag library and no rendering at all.
 * ========================================================================== */

/**
 * THE SPECIFICATION for reorder anchors: a literal port of KANBAN:95-L107
 * (retained :224-:236) and of the identical rule with a different selector at
 * BACKLOG:50-L63 (retained :95-:108).
 *
 *     prev = $(item).prevAll('tg-card:not(.gu-transit)')
 *     next = $(item).nextAll('tg-card:not(.gu-transit)')
 *
 *     previousCard = null
 *     if prev.length && prev[0].dataset.id
 *         previousCard = Number(prev[0].dataset.id)
 *
 *     nextCard = null
 *     if !previousCard && next.length && next[0].dataset.id
 *         nextCard = Number(next[0].dataset.id)
 *
 * Use this whenever the DOM already reflects the arrangement being persisted.
 * Four of the six traps meet here:
 *
 *   TRAP 1 — nearest-first in both directions (`nearestCandidateSibling`).
 *   TRAP 2 — PREVIOUS WINS: the next id is computed only when there is no
 *            previous one, so the pair is mutually exclusive and the write layer
 *            receives `after_userstory_id` OR `before_userstory_id`, never both.
 *   TRAP 3 — that condition is `!previousId`, a FALSY test, NOT `=== null`. A
 *            previous id of 0 falls through and the next id is computed as well.
 *            Ids are positive in this application so the branch is unreachable
 *            in practice; it is reproduced verbatim because rule T10 forbids
 *            changing behaviour, and "improving" it to a null test would be a
 *            change. The same falsy test appears in the projected-order path
 *            below, so the two agree even on this.
 *   TRAP 4 — the guarded read (`readPositionalId`).
 *   TRAP 5 — the placeholder exclusion (`isNeighbourCandidate`).
 *
 * A neighbour that exists but carries no positional id leaves the value `null`,
 * exactly as the incumbent's conjunction does — and because `previousId` is then
 * falsy, the next id is computed in that case too.
 *
 * @param item         The element whose new surroundings are being measured.
 *                     For the board this is the outer custom element that always
 *                     renders regardless of virtualisation (section 7).
 * @param itemSelector `'tg-card'` for the board, `'.row'` for the tables.
 */
export function computeNeighbours(
    item: HTMLElement,
    itemSelector: SortableItemSelector,
): SortableNeighbours {
    const previousSibling = nearestCandidateSibling(item, itemSelector, 'previous');
    const nextSibling = nearestCandidateSibling(item, itemSelector, 'next');

    let previousId: number | null = null;

    if (previousSibling !== null) {
        previousId = readPositionalId(previousSibling);
    }

    let nextId: number | null = null;

    // TRAP 2 and TRAP 3 together: previous wins, and the test is falsy.
    if (!previousId && nextSibling !== null) {
        nextId = readPositionalId(nextSibling);
    }

    return { previousId, nextId };
}

/**
 * TRAP 6, semantics 1 of 3 — CONTAINER-SCOPED.
 *
 * The port of `$(parentEl).find('tg-card').index(firstElement)`, used by the
 * board twice: at drag start, KANBAN:85 (retained :194), and at drop,
 * KANBAN:120 (retained :264). jQuery's `.find(sel)` searches DESCENDANTS at
 * whichever depth, which is what `querySelectorAll` on the container does, and
 * `.index(el)` returns `-1` when the element is not in the collection.
 *
 * THE PLACEHOLDER IS **NOT** EXCLUDED HERE. That asymmetry against
 * `computeNeighbours` is deliberate and is in the incumbent: the neighbour scan
 * carries `:not(.gu-transit)` and this expression does not. Excluding it here
 * would shift the index by one whenever a placeholder sits before the measured
 * element, which is the normal case during a drag.
 *
 * @returns The position, or `-1` when the element is not a descendant match.
 */
export function indexWithinContainer(
    container: HTMLElement,
    itemSelector: SortableItemSelector,
    element: HTMLElement,
): number {
    return Array.from(container.querySelectorAll(itemSelector)).indexOf(element);
}

/**
 * TRAP 6, semantics 2 of 3 — DOCUMENT-SCOPED.
 *
 * The port of `$(firstElement).index(".backlog-table-body .row")`, used by the
 * list twice: at drag start, BACKLOG:87 (retained :132), and at drop,
 * BACKLOG:115 (retained :160). Given a selector STRING, jQuery evaluates
 * `indexOf.call(jQuery(selector), element)` — it builds the match set from the
 * DOCUMENT, not from the element's parent — so the position is taken across
 * every `.backlog-table-body` in the page, and an element outside the match set
 * scores `-1`.
 *
 * TRAP 6b: THE SCOPING IN THAT SELECTOR IS LOAD-BEARING. The backlog table
 * HEADER also carries the row class —
 * `app/partials/includes/modules/backlog-table.jade` L9 renders
 * `div.row.backlog-table-title` — but it sits in `.backlog-table-header`,
 * OUTSIDE `div.backlog-table-body` (L19). Passing the bare row selector would
 * pull the header into the match set and shift every backlog index by one. The
 * selector is supplied by the screen, so the screen must keep it scoped; this
 * note exists so whoever writes `useStoryDrag.ts` knows why.
 *
 * The set is built from `element.ownerDocument`, which is the document the
 * element actually lives in. For every element in the page that is the same
 * document the incumbent searched, and for a detached fixture it is the only
 * correct answer — which is also what lets a browserless specification exercise
 * this function against a second document without disturbing the shared one.
 *
 * @returns The position within the selector's match set, or `-1` when absent.
 */
export function indexWithinSelector(element: HTMLElement, selector: string): number {
    return Array.from(element.ownerDocument.querySelectorAll(selector)).indexOf(element);
}

/**
 * TRAP 6, semantics 3 of 3 — SIBLING-SCOPED.
 *
 * The port of the bare `$(firstElement).index()`, used by the list for a drop
 * outside the backlog table — a sprint table — at BACKLOG:89 (retained :134)
 * and BACKLOG:117 (retained :162). With no argument jQuery evaluates
 *
 *     ( this[0] && this[0].parentNode ) ? this.first().prevAll().length : -1
 *
 * so it counts ALL preceding ELEMENT siblings, filtered by nothing at all —
 * neither by the item selector nor by the placeholder class — and it answers
 * `-1` for an element with no parent. Both of those are reproduced: the count is
 * unfiltered, and a detached element scores `-1` rather than 0.
 *
 * Unfiltered is the point. A sprint table renders an empty-state block as a
 * sibling of its rows (`app/partials/backlog/sprint.jade` L14), and the
 * incumbent counts it. Filtering it out here would move every sprint index.
 *
 * @returns The number of preceding element siblings, or `-1` when detached.
 */
export function indexAmongSiblings(element: HTMLElement): number {
    if (element.parentNode === null) {
        return NOT_FOUND;
    }

    let index = 0;
    let sibling = element.previousElementSibling;

    while (sibling !== null) {
        index += 1;
        sibling = sibling.previousElementSibling;
    }

    return index;
}

/**
 * The early-return guard, reproduced from KANBAN:124-L125 (retained :271-:272)
 *
 *     if index == oldIndex && initialContainer == parentEl
 *         return
 *
 * and from BACKLOG:120-L121 (retained :165-:166)
 *
 *     if index == oldIndex && sameContainer
 *         return
 *
 * A drop that changed neither the position nor the container persists NOTHING:
 * no event is emitted and no request is issued. Both screens depend on that, and
 * it is also what absorbs a cancelled drag — see the note on `recordNeighbours`.
 *
 * The two incumbent conditions differ only in how sameness is established: the
 * board compares container ELEMENT IDENTITY, the list compares a
 * screen-computed predicate. Both are expressed here as one boolean the caller
 * supplies, which is why `UseSortableListConfig` takes `resolveContainer` and
 * `isSameContainer` instead of deciding for itself.
 *
 * CoffeeScript `==` compiles to `===`, so this is a strict comparison.
 */
export function isUnchangedDrop(index: number, oldIndex: number, sameContainer: boolean): boolean {
    return index === oldIndex && sameContainer;
}

/**
 * Reads the positional id off each element, in the order given, with the guarded
 * conversion of TRAP 4.
 *
 * This is the port of `_.map dragMultipleItems, (item) -> ... Number(item.dataset.id)`
 * at KANBAN:133-L134 (retained :277-:278), which the board used to look each
 * dragged card up in its story map, and of the equivalent list-side collection
 * at BACKLOG:125-L128.
 *
 * ORDER IS PRESERVED, NOT RECOMPUTED. The multi-select machinery
 * (`./multiDrag`) already returns its elements in document order with the
 * primary first, so re-sorting here would be redundant work at best and a
 * reordering bug at worst.
 *
 * An element whose positional attribute is absent or empty is OMITTED rather
 * than contributing `NaN`. The return type promises numbers, and a `NaN` inside
 * the bulk payload is precisely the silently-wrong write this module exists to
 * prevent. Every measured item carries the attribute —
 * `app/partials/includes/modules/kanban-table.jade` L151 and L227,
 * `app/partials/includes/components/backlog-row.jade` L12 and
 * `app/partials/backlog/sprint.jade` L20 — so this is a defensive path only.
 */
export function readDatasetIds(elements: readonly HTMLElement[]): readonly number[] {
    const ids: number[] = [];

    for (const element of elements) {
        const id = readPositionalId(element);

        if (id !== null) {
            ids.push(id);
        }
    }

    return ids;
}

/**
 * The projected-order path: the same previous-wins rule applied to an
 * arrangement described as a list of ids rather than as live DOM.
 *
 * WHY IT EXISTS. The retired library moved the dragged node before its `drop`
 * handler ran, so `computeNeighbours` can read the finished arrangement straight
 * off the DOM. The adopted library never moves DOM nodes: it reports the active
 * item, the item under the pointer and the collision set, and the arrangement
 * exists only as an intention until React re-renders. This function computes the
 * anchors from that intention.
 *
 * `computeNeighbours` REMAINS THE SPECIFICATION. The co-located specification
 * asserts the two agree on every fixture — first position, last position, middle
 * and cross-container — by laying the projected order out as real siblings and
 * comparing. Where they ever disagree, the DOM path is correct by definition and
 * this function is the one to fix.
 *
 * The projection is deliberately literal: remove every moved id from the order,
 * insert the primary at the target index, then read off the neighbour on each
 * side — with the SAME falsy `!previousId` test as the DOM path, so TRAP 3
 * behaves identically on both sides.
 *
 * @param orderedIds  The container's current ids, in document order.
 * @param movedIds    The dragged ids, primary first — i.e. `readDatasetIds` of
 *                    the dragged elements. An empty selection yields no anchors.
 * @param targetIndex Where the primary lands, measured in the order that remains
 *                    once the moved ids are taken out. Clamped into range: a
 *                    negative index means the front and an overflowing one means
 *                    the back, rather than being handed to a splice-style
 *                    negative-from-the-end reading that would place the item
 *                    somewhere the caller never asked for.
 */
export function computeNeighboursFromOrder(
    orderedIds: readonly number[],
    movedIds: readonly number[],
    targetIndex: number,
): SortableNeighbours {
    if (movedIds.length === 0) {
        return NO_NEIGHBOURS;
    }

    const primaryId = movedIds[0];
    const moved = new Set<number>(movedIds);
    const remaining = orderedIds.filter((id) => !moved.has(id));
    const insertAt = Math.min(Math.max(targetIndex, 0), remaining.length);

    const projected: number[] = [
        ...remaining.slice(0, insertAt),
        primaryId,
        ...remaining.slice(insertAt),
    ];

    let previousId: number | null = null;

    if (insertAt > 0) {
        previousId = projected[insertAt - 1];
    }

    let nextId: number | null = null;

    // TRAP 2 and TRAP 3, identical to the DOM path above.
    if (!previousId && insertAt + 1 < projected.length) {
        nextId = projected[insertAt + 1];
    }

    return { previousId, nextId };
}

/* ==========================================================================
 * THE HOOK — PER-DRAG CAPTURE, AND NOTHING MORE
 * ========================================================================== */

/**
 * How one screen configures the capture. Every field describes a decision that
 * belongs to the screen rather than to this module (section 4 of the file
 * header): which selector identifies an item, which of the three index semantics
 * applies, and what "the same container" means.
 */
export interface UseSortableListConfig<TContainer> {
    /**
     * `'tg-card'` for the board, `'.row'` for the backlog and sprint tables.
     */
    readonly itemSelector: SortableItemSelector;

    /**
     * Selects the index semantics.
     *
     * PRESENT  — `indexWithinSelector(element, indexSelector)`, the
     *            DOCUMENT-scoped measurement of BACKLOG:87 and BACKLOG:115. The
     *            list passes `'.backlog-table-body .row'`, and TRAP 6b explains
     *            why that scoping cannot be dropped.
     * ABSENT   — `indexWithinContainer(container, itemSelector, element)`, the
     *            CONTAINER-scoped measurement of KANBAN:85 and KANBAN:120, which
     *            is what the board uses.
     */
    readonly indexSelector?: string;

    /**
     * Whether to fall back to `indexAmongSiblings(element)` when the element is
     * not inside the scope `indexSelector` describes.
     *
     * This is the branch at BACKLOG:86-L89 and BACKLOG:114-L118: a row that
     * landed in the backlog table is measured document-scoped, and a row that
     * landed anywhere else — a sprint table — is measured against its own
     * siblings.
     *
     * BOTH OF THE INCUMBENT'S BRANCHES ARE AVAILABLE, and the choice matters for
     * one specific container. The list's `isBacklog` test is true for the two
     * `.js-empty-backlog` blocks as well as for the table body, yet those blocks
     * are SIBLINGS of `section.backlog-table` rather than descendants of
     * `.backlog-table-body` (`app/partials/backlog/backlog.jade` L174 and L178
     * against L142), so the incumbent's document-scoped measurement genuinely
     * answers `-1` for a drop into an empty backlog. Therefore:
     *
     *   omitted or `false` — the document-scoped answer is reported as it stands,
     *                        `-1` included. This reproduces the incumbent
     *                        `isBacklog` branch verbatim.
     *   `true`             — an out-of-scope element is measured against its own
     *                        siblings instead. This reproduces the incumbent's
     *                        other branch for sprint tables.
     *
     * A screen needing to switch per drop can call the three exported index
     * functions directly; they are exported for exactly that reason.
     */
    readonly siblingIndexFallback?: boolean;

    /**
     * Reads the container's identity out of the DOM.
     *
     * The board reads `data-status` and `data-swimlane` off the column element,
     * as at KANBAN:121-L122 (retained :265-:266); the list decides whether the
     * container is the backlog or which sprint it is, as at BACKLOG:99 and
     * BACKLOG:118.
     *
     * NEVER NORMALISE, COERCE OR "FIX" THE IDS THIS RETURNS. Two quirks depend
     * on that, and both are preserved deliberately under rule T10:
     *
     *   - THE UNCLASSIFIED-SWIMLANE SENTINEL IS `-1`. KANBAN:146 (retained :313)
     *     reads the story's swimlane as `... || -1`, and
     *     `../types/swimlane.ts` documents `-1` as the client-side sentinel for
     *     the stories whose own swimlane attribute is null. Emit it unchanged;
     *     never turn it into `null`, `0` or nothing at all. Note also that
     *     KANBAN:140 (retained :299) builds the very same value WITHOUT that
     *     fallback while KANBAN:146 applies it — a deliberate inconsistency in
     *     the incumbent, reproduced rather than tidied.
     *   - THE FLAT-MODE COLUMN CARRIES NO SWIMLANE ATTRIBUTE.
     *     `app/partials/includes/modules/kanban-table.jade` L189-L197 renders
     *     `data-status` but no `data-swimlane`, so KANBAN:122's
     *     `Number(parentEl.dataset.swimlane)` is `NaN`, and `NaN` equals nothing
     *     — not even itself. In flat mode the incumbent therefore treats EVERY
     *     dragged item as having changed container. That is incumbent behaviour;
     *     its consequence (per-item element deletion) is the screen's concern,
     *     not this module's, and it must NOT be "fixed" on the way through.
     *
     *     READ THOSE ATTRIBUTES THROUGH THE DATASET MAP, AS THE INCUMBENT DOES.
     *     For an absent attribute the dataset map reports `undefined`, which
     *     converts to a not-a-number value, whereas `getAttribute` reports
     *     `null`, which converts to ZERO. Reading the flat-mode column with
     *     `getAttribute` would hand it a swimlane of 0 that compares EQUAL to the
     *     next flat column's, so `isSameContainer` would start reporting sameness
     *     in flat mode and the guard below would start firing where the incumbent
     *     never lets it fire — a behaviour change with, once again, no error
     *     surface. The co-located specification pins this distinction.
     *
     * Emit whatever the DOM says. Deciding which keys reach the wire belongs to
     * the api facades, which gate `milestone_id` and `swimlane_id` on truthiness
     * while always sending `status_id`
     * (`app/coffee/modules/resources/userstories.coffee` L94-L96 and L126-L127).
     */
    readonly resolveContainer: (container: HTMLElement) => TContainer;

    /**
     * Whether two container identities are the same container — supplied by the
     * screen, because the two screens define it differently. The board compares
     * status and swimlane (KANBAN:147, retained :314); the list compares a
     * backlog-versus-backlog flag or two sprint ids (BACKLOG:101-L104, retained
     * :146-:149).
     */
    readonly isSameContainer: (from: TContainer, to: TContainer) => boolean;
}

/**
 * The per-drag capture surface. The four methods map onto the drag lifecycle of
 * the adopted library, and the mapping onto the retired one is given for each.
 */
export interface SortableListApi<TContainer> {
    /**
     * Call from the drag-start event. Captures the start index and the origin
     * container — the `oldIndex` of KANBAN:85 / BACKLOG:87-L89, and the
     * `initialContainer` of KANBAN:86 with its list-side counterpart
     * `initIsBacklog` at BACKLOG:71.
     *
     * IT DOES NOT CLEAR THE CAPTURED NEIGHBOURS, on purpose. See
     * `recordNeighbours`.
     */
    beginDrag(item: HTMLElement, draggedElements: readonly HTMLElement[]): void;

    /**
     * Call from the drag-over or drag-move event — whichever moment the DOM, or
     * the projection the screen keeps of it, reflects the arrangement being
     * persisted. This is the `drop` analogue: it resets and recomputes the
     * anchors, exactly as KANBAN:95-L107 and BACKLOG:50-L63 do, and returns them
     * as well as storing them.
     *
     * THE STORED VALUE IS RESET ONLY HERE — reproducing the incumbent protocol
     * rather than tidying it. Three handlers cooperate through one closure
     * upstream: drag-start captures the start index, `drop` derives the anchors,
     * and drag-end consumes both. Because the anchors are reset only inside
     * `drop`, a CANCELLED drag — which never fires `drop` — leaves the previous
     * drop's anchors in place, and the unchanged-drop guard is what absorbs that.
     * Resetting on drag start instead would be a behaviour change, so
     * `beginDrag` above deliberately leaves the stored anchors alone.
     */
    recordNeighbours(item: HTMLElement): SortableNeighbours;

    /**
     * Call from the drag-end event. Measures the index with the configured
     * semantics, resolves the destination container, evaluates sameness through
     * the configured predicate, and applies the guard.
     *
     * RETURNS `null` WHEN THE GUARD FIRES — the incumbent's bare `return` at
     * KANBAN:125 and BACKLOG:121 — meaning there is nothing to persist. It never
     * throws for that case, and it never reports a result whose `unchanged` is
     * `true`.
     */
    endDrag(
        item: HTMLElement,
        draggedElements: readonly HTMLElement[],
        container: HTMLElement,
    ): SortableDropResult | null;

    /**
     * Call from the drag-cancel event, or from cleanup. Clears the captured
     * index, origin and anchors.
     *
     * THIS HAS NO INCUMBENT COUNTERPART, and that is why it is a separate
     * method rather than something `beginDrag` does. The retired library fired
     * its drag-end handler even for a cancelled gesture, so the stale-anchor
     * protocol described on `recordNeighbours` was the only behaviour available
     * there. The adopted library reports a real cancellation, so a screen that
     * wants to discard the gesture can say so explicitly — while a screen that
     * calls `endDrag` after a cancellation still gets the incumbent behaviour,
     * absorbed by the guard.
     */
    cancelDrag(): void;

    /**
     * The origin container captured by the most recent `beginDrag`, or `null`
     * when no drag start was captured. Read live, so the value is current at the
     * moment it is read rather than at the moment this object was built.
     */
    readonly origin: TContainer | null;
}

/**
 * Captures the two per-drag values the ordering arithmetic needs — the start
 * index and the origin container — and resolves one drop into a
 * `SortableDropResult`, or into `null` when the guard says there is nothing to
 * persist.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it issues no write, dispatches no action,
 * broadcasts no event, keeps no queue, holds no domain model, calls no service
 * and never asks AngularJS to run a digest. Digest cycles remain AngularJS's
 * concern and React state updates are driven by React; the screens own the
 * writes and the serialisation, exactly as their controllers do today
 * (section 4 of the file header).
 *
 * STATE LIVES IN REFS, NOT IN `useState`, for two reasons. Capturing a drag start
 * must not re-render — the drag is a pointer gesture, and a render in the middle
 * of it is both pointless and janky — and the four callbacks must be
 * reference-stable so that attaching them to the drag context does not tear the
 * gesture down and rebuild it on every render. All four are created with empty
 * dependency lists and read the latest configuration through a ref, so their
 * identity never changes even when the caller passes a freshly-built
 * configuration object on every render, which is the normal case.
 */
export function useSortableList<TContainer>(
    config: UseSortableListConfig<TContainer>,
): SortableListApi<TContainer> {
    /*
     * The latest configuration, reachable from the reference-stable callbacks
     * below without becoming a dependency of them. Assigning during render is
     * what keeps the two properties compatible: the callbacks never go stale,
     * and their identity never changes. The assignment is idempotent, so a
     * double render under strict mode is harmless, and the value is only ever
     * READ from event handlers — never during render — so no render output
     * depends on it.
     */
    const configRef = useRef<UseSortableListConfig<TContainer>>(config);
    configRef.current = config;

    /*
     * `null` means "no drag start was captured", and it is the initial value on
     * purpose. The incumbent initialises `oldIndex = null` (KANBAN:28,
     * BACKLOG:37) and then compares `index == oldIndex`, which in CoffeeScript
     * is a strict comparison and so is false for every number — the guard simply
     * cannot fire before a drag start. Seeding this with `-1` instead would break
     * that, because `-1` is a value the index functions legitimately return.
     */
    const oldIndexRef = useRef<number | null>(null);
    const originRef = useRef<TContainer | null>(null);
    const neighboursRef = useRef<SortableNeighbours>(NO_NEIGHBOURS);

    /**
     * Measures one element with the configured semantics — TRAP 6, resolved once
     * so that drag start and drag end can never disagree about which of the
     * three applies. That symmetry is the whole reason the guard means anything:
     * comparing an index measured one way against an index measured another way
     * would make the comparison meaningless while still looking plausible.
     */
    const measureIndex = useCallback((element: HTMLElement, container: HTMLElement): number => {
        const { itemSelector, indexSelector, siblingIndexFallback } = configRef.current;

        if (indexSelector === undefined) {
            return indexWithinContainer(container, itemSelector, element);
        }

        const documentScoped = indexWithinSelector(element, indexSelector);

        if (documentScoped !== NOT_FOUND || siblingIndexFallback !== true) {
            return documentScoped;
        }

        return indexAmongSiblings(element);
    }, []);

    const beginDrag = useCallback(
        (item: HTMLElement, draggedElements: readonly HTMLElement[]): void => {
            const primary = resolveDraggedElements(item, draggedElements)[0];

            /*
             * The container is the GRABBED element's parent while the element
             * measured is the FIRST SELECTED one, reproducing KANBAN:84-L85:
             *
             *     parentEl = item.parentNode
             *     oldIndex = $(parentEl).find('tg-card').index(firstElement)
             *
             * For a single-item drag the two are the same element. For a
             * multi-item drag they can differ, and the incumbent measures the
             * first selected card inside the grabbed card's column — which is
             * also why the two arguments below are not interchangeable.
             */
            const container = item.parentElement;

            if (container === null) {
                /*
                 * A detached element has no container to identify, so nothing is
                 * captured and the guard cannot fire later — which matches the
                 * incumbent, where a null initial container never equals a real
                 * parent element.
                 */
                oldIndexRef.current = null;
                originRef.current = null;

                return;
            }

            oldIndexRef.current = measureIndex(primary, container);
            originRef.current = configRef.current.resolveContainer(container);
        },
        [measureIndex],
    );

    const recordNeighbours = useCallback((item: HTMLElement): SortableNeighbours => {
        const neighbours = computeNeighbours(item, configRef.current.itemSelector);

        neighboursRef.current = neighbours;

        return neighbours;
    }, []);

    const endDrag = useCallback(
        (
            item: HTMLElement,
            draggedElements: readonly HTMLElement[],
            container: HTMLElement,
        ): SortableDropResult | null => {
            const dragged = resolveDraggedElements(item, draggedElements);
            const primary = dragged[0];

            const index = measureIndex(primary, container);
            const destination = configRef.current.resolveContainer(container);
            const origin = originRef.current;

            /*
             * With no captured origin there is nothing to compare, so sameness is
             * false and the guard cannot fire. Reproduces the incumbent, where
             * `initialContainer` starts as null (KANBAN:86) and never equals a
             * real parent element.
             */
            const sameContainer =
                origin !== null && configRef.current.isSameContainer(origin, destination);

            const capturedOldIndex = oldIndexRef.current;
            const unchanged =
                capturedOldIndex !== null && isUnchangedDrop(index, capturedOldIndex, sameContainer);

            if (unchanged) {
                // The incumbent's bare `return`: persist nothing at all.
                return null;
            }

            const neighbours = neighboursRef.current;

            return {
                previousId: neighbours.previousId,
                nextId: neighbours.nextId,
                index,
                /*
                 * `-1` reports "no drag start was captured". The guard above was
                 * evaluated from the ref rather than from this number, so
                 * reporting a sentinel here cannot make it misfire.
                 */
                oldIndex: capturedOldIndex ?? NOT_FOUND,
                unchanged,
                ids: readDatasetIds(dragged),
            };
        },
        [measureIndex],
    );

    const cancelDrag = useCallback((): void => {
        oldIndexRef.current = null;
        originRef.current = null;
        neighboursRef.current = NO_NEIGHBOURS;
    }, []);

    /*
     * One stable object. Every callback above has an empty or stable dependency
     * list, so this memo is computed once per hook instance and the identity a
     * consumer holds never changes. `origin` is a getter rather than a captured
     * value, so it reports the CURRENT origin without the object having to be
     * rebuilt when the origin changes — which is what keeps the two requirements,
     * live reads and stable identity, from contradicting each other.
     */
    return useMemo<SortableListApi<TContainer>>(
        () => ({
            beginDrag,
            recordNeighbours,
            endDrag,
            cancelDrag,
            get origin(): TContainer | null {
                return originRef.current;
            },
        }),
        [beginDrag, recordNeighbours, endDrag, cancelDrag],
    );
}
