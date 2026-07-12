/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + jsdom unit tests for the pure DOM-geometry helpers in
 * {@link ./domGeometry}.
 *
 * These helpers reproduce the DOM reads the legacy dragula wiring performed in
 * `app/coffee/modules/kanban/sortable.coffee` against the board markup emitted
 * by `app/partials/includes/modules/kanban-table.jade`:
 *   - the flat (non-swimlane) column `.taskboard-column[data-status]` with NO
 *     `data-swimlane`,
 *   - the per-swimlane cell `.taskboard-column[data-status][data-swimlane]`
 *     nested in `.kanban-swimlane[data-swimlane]` (the "unclassified" row uses
 *     `data-swimlane="-1"`),
 *   - the ordered `tg-card[data-id]` children of a column,
 *   - `readCardIdsInDomOrder()` mirroring the legacy
 *     `window.dragMultiple.getElements()` document ordering, and
 *   - `computeInsertionIndex(...)` reproducing the legacy `:not(.gu-transit)`
 *     (moved-card) filter used to place the drop.
 *
 * jsdom never lays elements out, so `getBoundingClientRect()` returns an
 * all-zero rect for every node. The midpoint / insertion-index math therefore
 * cannot be exercised against a real layout engine; each test instead STUBS
 * `getBoundingClientRect` on the specific card elements it cares about (via
 * {@link stubRect}) to feed the helpers deterministic `top`/`height` values.
 * This is also what lets us assert the null-rect drop-pointer workaround
 * (`origin midpoint + delta`) and the missing-card `+Infinity` fallback in
 * isolation.
 *
 * Conventions (matching the sibling React specs in this directory):
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`beforeEach`/`afterEach`)
 *     are used directly (provided by `@types/jest`); they are NOT imported.
 *   - The automatic JSX runtime is used, so there is no `import React`. The DOM
 *     is built with `document.body.innerHTML` (not JSX), yet the file keeps the
 *     mandated `.test.tsx` extension so Jest's `testMatch` discovers it.
 *   - The system under test is imported through the `./index` barrel so its
 *     geometry re-export lines are exercised for coverage as well.
 */

import {
    computeDropPointerY,
    computeInsertionIndex,
    findColumnElement,
    getCardMidpointY,
    readCardIdsInDomOrder,
    readColumnOrderedIds,
} from "./index";

/** The subset of a `DOMRect` the geometry helpers actually read. */
type Rect = { top: number; height: number };

/**
 * Assign a deterministic bounding rect to an element for the duration of a
 * test. A full `DOMRect`-shaped object is returned (via a cast) so the
 * assignment type-checks under `strict`; the helpers only consume `top` and
 * `height`, but every `DOMRect` field is populated to keep the stub honest.
 */
const stubRect = (el: Element, rect: Rect): void => {
    (el as HTMLElement).getBoundingClientRect = () =>
        ({
            top: rect.top,
            height: rect.height,
            bottom: rect.top + rect.height,
            left: 0,
            right: 0,
            width: 0,
            x: 0,
            y: rect.top,
            toJSON: () => ({}),
        } as DOMRect);
};

/**
 * Build the Kanban board fixture. Mirrors the three container shapes emitted by
 * `kanban-table.jade`:
 *   - one flat column (status 10, no swimlane) holding cards 1 / 2 / 3,
 *   - one real-swimlane cell (status 10, swimlane 5) holding cards 7 / 8,
 *   - one unclassified-swimlane cell (status 10, swimlane -1) holding card 9.
 *
 * `tg-card` is an unknown element in jsdom, so it upgrades to an
 * `HTMLUnknownElement`; it is still selectable via `tg-card[data-id]`.
 */
const buildBoard = (): void => {
    document.body.innerHTML = `
        <section class="kanban">
            <div class="kanban-uses-box taskboard-column" data-status="10">
                <tg-card data-id="1"></tg-card>
                <tg-card data-id="2"></tg-card>
                <tg-card data-id="3"></tg-card>
            </div>
            <div class="kanban-swimlane" data-swimlane="5">
                <div class="kanban-uses-box taskboard-column" data-status="10" data-swimlane="5">
                    <tg-card data-id="7"></tg-card>
                    <tg-card data-id="8"></tg-card>
                </div>
            </div>
            <div class="kanban-swimlane" data-swimlane="-1">
                <div class="kanban-uses-box taskboard-column" data-status="10" data-swimlane="-1">
                    <tg-card data-id="9"></tg-card>
                </div>
            </div>
        </section>
    `;
};

/** Resolve a fixture card by id, failing loudly if the fixture is malformed. */
const cardEl = (id: number): Element => {
    const el = document.querySelector(`tg-card[data-id="${id}"]`);
    if (el === null) {
        throw new Error(`fixture card ${id} not found`);
    }
    return el;
};

/** Stub the bounding rect of a fixture card, addressed by its `data-id`. */
const stubCardRect = (id: number, rect: Rect): void => {
    stubRect(cardEl(id), rect);
};

/**
 * Resolve the flat (non-swimlane) status-10 column via the SUT itself, failing
 * loudly if absent. Using `findColumnElement` here keeps the fixture lookup and
 * the production selector in lock-step.
 */
const flatColumn = (): Element => {
    const el = findColumnElement(10, null);
    if (el === null) {
        throw new Error("flat column (status 10, no swimlane) not found");
    }
    return el;
};

beforeEach(() => {
    buildBoard();
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("domGeometry", () => {
    describe("findColumnElement", () => {
        it("(status, null) resolves the FLAT column (no data-swimlane), never a swimlane cell", () => {
            const result = findColumnElement(10, null);

            expect(result).not.toBeNull();
            // The flat column owns cards 1/2/3; a swimlane cell would yield 7/8 or 9.
            expect(readColumnOrderedIds(result as Element)).toEqual([1, 2, 3]);
        });

        it("(status, realSwimlane) resolves that swimlane's cell", () => {
            const result = findColumnElement(10, 5);

            expect(result).not.toBeNull();
            expect(readColumnOrderedIds(result as Element)).toEqual([7, 8]);
        });

        it("(status, -1) resolves the unclassified swimlane cell (quoted negative id)", () => {
            const result = findColumnElement(10, -1);

            expect(result).not.toBeNull();
            expect(readColumnOrderedIds(result as Element)).toEqual([9]);
        });

        it("returns null when no column matches the status", () => {
            expect(findColumnElement(999, null)).toBeNull();
        });
    });

    describe("readCardIdsInDomOrder / readColumnOrderedIds", () => {
        it("readCardIdsInDomOrder returns every board card id in DOM document order", () => {
            expect(readCardIdsInDomOrder()).toEqual([1, 2, 3, 7, 8, 9]);
        });

        it("readColumnOrderedIds returns a single column's ids in DOM order", () => {
            expect(readColumnOrderedIds(flatColumn())).toEqual([1, 2, 3]);
        });

        it("filters out cards whose data-id is missing or non-numeric (NaN excluded)", () => {
            const column = flatColumn();

            // A card with a NON-NUMERIC data-id is matched by the `[data-id]`
            // selector but rejected by the `!Number.isNaN` guard in the helper.
            const nonNumeric = document.createElement("tg-card");
            nonNumeric.setAttribute("data-id", "not-a-number");
            column.appendChild(nonNumeric);

            // A card with NO data-id attribute is never matched by the selector.
            column.appendChild(document.createElement("tg-card"));

            expect(readColumnOrderedIds(column)).toEqual([1, 2, 3]);
            // The same NaN guard applies to the document-wide read.
            expect(readCardIdsInDomOrder()).toEqual([1, 2, 3, 7, 8, 9]);
        });
    });

    describe("getCardMidpointY", () => {
        it("returns top + height / 2 for a present card", () => {
            stubCardRect(1, { top: 100, height: 40 });

            expect(getCardMidpointY(1)).toBe(120);
        });

        it("returns null for an absent card", () => {
            expect(getCardMidpointY(4242)).toBeNull();
        });
    });

    describe("computeDropPointerY (null-rect workaround)", () => {
        it("returns origin midpoint + delta for a positive drag delta", () => {
            stubCardRect(2, { top: 50, height: 20 }); // midpoint 60

            expect(computeDropPointerY(2, 15)).toBe(75);
        });

        it("returns origin midpoint + delta for a negative drag delta", () => {
            stubCardRect(2, { top: 50, height: 20 }); // midpoint 60

            expect(computeDropPointerY(2, -30)).toBe(30);
        });

        it("returns +Infinity when the active card is absent (drop appends, cross-column move still registers)", () => {
            expect(computeDropPointerY(4242, 10)).toBe(Number.POSITIVE_INFINITY);
        });
    });

    describe("computeInsertionIndex", () => {
        // Flat-column cards 1/2/3 at tops 0/40/80 (height 20) => midpoints 10/50/90.
        const stubFlatColumnRects = (): void => {
            stubCardRect(1, { top: 0, height: 20 });
            stubCardRect(2, { top: 40, height: 20 });
            stubCardRect(3, { top: 80, height: 20 });
        };

        it("counts only cards whose midpoint is above the pointer (mid-column drop)", () => {
            stubFlatColumnRects();

            // Only card 1 (midpoint 10) sits above pointer 45.
            expect(computeInsertionIndex(flatColumn(), 45, [])).toBe(1);
        });

        it("appends (index === count) when the pointer is below every card", () => {
            stubFlatColumnRects();

            expect(computeInsertionIndex(flatColumn(), 100, [])).toBe(3);
        });

        it("inserts at the front (index 0) when the pointer is above every card", () => {
            stubFlatColumnRects();

            expect(computeInsertionIndex(flatColumn(), 5, [])).toBe(0);
        });

        it("skips moved ids so the index is expressed among the REMAINING cards", () => {
            stubFlatColumnRects();

            // Pointer below all cards; card 2 is being moved -> only 1 and 3 counted.
            expect(computeInsertionIndex(flatColumn(), 100, [2])).toBe(2);
        });

        it("with the +Infinity fallback pointer, counts every non-moved card", () => {
            stubFlatColumnRects();

            expect(computeInsertionIndex(flatColumn(), Number.POSITIVE_INFINITY, [])).toBe(3);
        });
    });
});
