/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/** Vertical midpoint of an element's live bounding rect. */
function midpointY(el: Element): number {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
}

/** Parse the numeric `data-id` off a `tg-card`, or `NaN` if absent/invalid. */
function cardId(el: Element): number {
    return Number(el.getAttribute("data-id"));
}

/**
 * Whether a card participates in drag geometry (M6). A card inside a FOLDED
 * status column is collapsed by the theme (`.vfold tg-card { display: none }`)
 * yet is still mounted in the DOM (StatusColumn always renders its cards so the
 * fold e2e checks the class, not card removal). Such hidden cards must NOT
 * pollute the document-order multi-drag scan or the insertion-index geometry —
 * they have no visible position to measure or to count against.
 *
 * The check is CLASS-BASED (`closest(".vfold")`), not layout-based, so it is
 * deterministic under jsdom (which performs no layout and reports every rect as
 * zero) exactly as it is in the browser.
 */
function isCardGeometryVisible(el: Element): boolean {
    return el.closest(".vfold") === null;
}

/**
 * Locate the droppable column element for a status column / swimlane cell.
 * - swimlane mode (swimlaneId !== null, incl. -1): match BOTH data attributes,
 *   since each swimlane x status cell carries `data-status` AND `data-swimlane`.
 * - non-swimlane mode (swimlaneId === null): match `data-status` and require the
 *   ABSENCE of `data-swimlane` (`:not([data-swimlane])`) so a swimlane cell is
 *   never mistaken for the flat column.
 * Values are quoted in the selector so numeric/negative ids (e.g. "-1") are valid.
 */
export function findColumnElement(statusId: number, swimlaneId: number | null): Element | null {
    if (swimlaneId === null || swimlaneId === undefined) {
        return document.querySelector(
            '.taskboard-column[data-status="' + statusId + '"]:not([data-swimlane])',
        );
    }
    return document.querySelector(
        '.taskboard-column[data-status="' + statusId + '"][data-swimlane="' + swimlaneId + '"]',
    );
}

/** Ordered `data-id`s of the `tg-card`s inside one column element (DOM order). */
export function readColumnOrderedIds(columnEl: Element): number[] {
    const cards = Array.from(columnEl.querySelectorAll("tg-card[data-id]"));
    return cards.map(cardId).filter((id) => !Number.isNaN(id));
}

/**
 * All `tg-card` `data-id`s on the board in DOM DOCUMENT ORDER. Mirrors the
 * legacy `window.dragMultiple.getElements()` = `$('.ui-multisortable-multiple')`
 * ordering; the caller filters this by the current selection to build the
 * ordered multi-move set.
 */
export function readCardIdsInDomOrder(): number[] {
    // Only VISIBLE cards (M6): cards inside a folded (`.vfold`) column are
    // collapsed and must not appear in the multi-drag document-order set.
    const cards = Array.from(document.querySelectorAll("tg-card[data-id]")).filter(
        isCardGeometryVisible,
    );
    return cards.map(cardId).filter((id) => !Number.isNaN(id));
}

/**
 * Live vertical midpoint of a specific card, or `null` when the card element is
 * not in the DOM.
 */
export function getCardMidpointY(usId: number): number | null {
    const el = document.querySelector('tg-card[data-id="' + usId + '"]');
    return el ? midpointY(el) : null;
}

/**
 * Final pointer Y for the drop. NULL-RECT WORKAROUND: the dragged card stays at
 * its origin position in the DOM during the drag (no transform is applied), so
 * its live midpoint + the total drag delta.y equals the drop Y — independent of
 * the (null) `event.active.rect`. If the card element cannot be found, return
 * +Infinity so the insertion index becomes "end of column" (append) and a
 * cross-column move still registers.
 */
export function computeDropPointerY(activeId: number, deltaY: number): number {
    const originMid = getCardMidpointY(activeId);
    if (originMid === null) {
        return Number.POSITIVE_INFINITY;
    }
    return originMid + deltaY;
}

/**
 * Insertion index of the drop within a target column: the count of NON-moved
 * cards whose midpoint is above `pointerY`. Excluding the moved ids mirrors the
 * legacy `:not(.gu-transit)` filter, so the index is expressed among the
 * "remaining" cards (matching `resolveKanbanDrop`).
 */
export function computeInsertionIndex(columnEl: Element, pointerY: number, movedIds: number[]): number {
    const cards = Array.from(columnEl.querySelectorAll("tg-card[data-id]"));
    let index = 0;
    for (const card of cards) {
        const id = cardId(card);
        // Skip moved cards (legacy `:not(.gu-transit)`) AND cards collapsed by a
        // folded column (M6): a `display:none` card has no measurable position.
        if (Number.isNaN(id) || movedIds.indexOf(id) !== -1 || !isCardGeometryVisible(card)) {
            continue;
        }
        if (midpointY(card) < pointerY) {
            index += 1;
        }
    }
    return index;
}
