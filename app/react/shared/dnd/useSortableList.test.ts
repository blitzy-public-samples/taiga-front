/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `useSortableList.ts`, the ONE place the drag ordering
 * arithmetic lives.
 *
 * WHY THIS SPECIFICATION IS SHAPED THE WAY IT IS. Named risk R-DND-2 states that
 * an off-by-one in this arithmetic SILENTLY PERSISTS A WRONG ORDER WITH NO ERROR
 * SURFACE — no exception, no toast, no console warning, no failing request. A
 * suite that only drags one item one step therefore passes against a completely
 * broken implementation, because for a single step "nearest preceding sibling"
 * and "furthest preceding sibling" coincide. So every group below is built to
 * separate the correct rule from its plausible neighbour:
 *
 *   - the FIRST-position and LAST-position cases, which are the two the
 *     previous-wins rule treats asymmetrically;
 *   - the CROSS-CONTAINER cases, which are the ones the guard must NOT absorb;
 *   - fixtures with TWO candidates on the same side, which is the only way to
 *     tell nearest-first from document-order-first apart;
 *   - the three index semantics measured over the SAME element, so conflating
 *     them fails loudly here instead of quietly in production;
 *   - and an equivalence group that asserts the projected-order path agrees with
 *     the DOM path, which is the specification, on every fixture.
 *
 * Browserless by construction: it runs in the jsdom environment configured by
 * `jest.config.js` and needs no browser binary, no built bundle and no network.
 * jsdom implements no layout engine, which does not matter here — nothing in the
 * unit under test measures geometry, and nothing in it may filter by visibility
 * (R-DND-3), which the hidden-original case below asserts directly.
 */
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';

import {
    TRANSIT_CLASS,
    computeNeighbours,
    computeNeighboursFromOrder,
    indexAmongSiblings,
    indexWithinContainer,
    indexWithinSelector,
    isUnchangedDrop,
    readDatasetIds,
    useSortableList,
} from './useSortableList';
import type {
    SortableNeighbours,
    UseSortableListConfig,
} from './useSortableList';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/** The board's item selector — a tag selector, because its items are custom elements. */
const CARD_SELECTOR = 'tg-card';

/** The tables' item selector — a class selector shared by backlog rows and sprint rows. */
const ROW_SELECTOR = '.row';

/** The scoped selector the list measures its document-wide index with (TRAP 6b). */
const BACKLOG_ROW_SELECTOR = '.backlog-table-body .row';

/**
 * The marker the multi-select machinery puts on an original it hid. Spelled here
 * rather than imported so this fixture states plainly that the unit under test
 * neither knows nor cares about it: what matters is that such an element does
 * NOT carry the placeholder class and so remains eligible as a neighbour.
 */
const HIDDEN_ORIGINAL_CLASS = 'tg-multiple-drag-dragging';

interface ItemSpec {
    /** The `data-id` attribute value. Omitted means the attribute is absent. */
    readonly id?: string;
    /** Carries the drag placeholder class, so the neighbour scan must skip it. */
    readonly transit?: boolean;
    /** A multi-drag original the machinery hid: display-suppressed, NO placeholder class. */
    readonly hidden?: boolean;
    /** Overrides the tag, so a fixture can mix element kinds under one selector list. */
    readonly tag?: string;
    /** Extra classes, used to build non-matching siblings and header rows. */
    readonly classNames?: readonly string[];
    /** Renders as a sibling that the item selector does not match. */
    readonly decoy?: boolean;
}

function createElementIn(tag: string, classNames: readonly string[]): HTMLElement {
    const element = document.createElement(tag);

    for (const name of classNames) {
        element.classList.add(name);
    }

    return element;
}

/**
 * Appends one run of items to a container and hands back the created elements in
 * document order, so a case can name the element it drags by position.
 */
function appendItems(
    container: HTMLElement,
    tag: string,
    baseClasses: readonly string[],
    specs: readonly ItemSpec[],
): HTMLElement[] {
    return specs.map((spec) => {
        const element = createElementIn(spec.tag ?? tag, [
            ...(spec.decoy === true ? [] : baseClasses),
            ...(spec.classNames ?? []),
        ]);

        if (spec.transit === true) {
            element.classList.add(TRANSIT_CLASS);
        }

        if (spec.hidden === true) {
            element.classList.add(HIDDEN_ORIGINAL_CLASS);
            element.style.display = 'none';
        }

        if (spec.id !== undefined) {
            element.setAttribute('data-id', spec.id);
        }

        container.appendChild(element);

        return element;
    });
}

/**
 * A board column, reproducing the measured markup of
 * `app/partials/includes/modules/kanban-table.jade` L112-L121: the swimlane-mode
 * column carries both positional attributes.
 */
function buildColumn(
    specs: readonly ItemSpec[],
    attributes: { readonly status?: string; readonly swimlane?: string } = {},
): { readonly column: HTMLElement; readonly cards: HTMLElement[] } {
    const column = createElementIn('div', ['kanban-uses-box', 'taskboard-column']);

    if (attributes.status !== undefined) {
        column.setAttribute('data-status', attributes.status);
    }

    if (attributes.swimlane !== undefined) {
        column.setAttribute('data-swimlane', attributes.swimlane);
    }

    document.body.appendChild(column);

    return { column, cards: appendItems(column, CARD_SELECTOR, ['card'], specs) };
}

/**
 * A backlog table body, reproducing
 * `app/partials/includes/modules/backlog-table.jade` L19 with the rows of
 * `app/partials/includes/components/backlog-row.jade` L8-L13.
 */
function buildBacklogBody(specs: readonly ItemSpec[]): {
    readonly body: HTMLElement;
    readonly rows: HTMLElement[];
} {
    const body = createElementIn('div', ['backlog-table-body']);

    document.body.appendChild(body);

    return { body, rows: appendItems(body, 'div', ['row', 'us-item-row'], specs) };
}

/**
 * A sprint table, reproducing `app/partials/backlog/sprint.jade` L13-L22 —
 * including the empty-state block at L14, which is a SIBLING of the rows and
 * which the unfiltered sibling index therefore counts.
 */
function buildSprintTable(
    specs: readonly ItemSpec[],
    withEmptyState = false,
): { readonly table: HTMLElement; readonly rows: HTMLElement[] } {
    const table = createElementIn('div', ['sprint-table']);

    document.body.appendChild(table);

    if (withEmptyState) {
        table.appendChild(createElementIn('div', ['sprint-empty']));
    }

    return { table, rows: appendItems(table, 'div', ['row', 'milestone-us-item-row'], specs) };
}

function specsFor(ids: readonly number[]): readonly ItemSpec[] {
    return ids.map((id) => ({ id: String(id) }));
}

beforeEach(() => {
    // `indexWithinSelector` searches the whole document, so every case starts
    // from an empty one or the counts would leak between them.
    document.body.innerHTML = '';
});

/* ==========================================================================
 * THE EXCLUSION SELECTOR
 * ========================================================================== */

describe('TRANSIT_CLASS', () => {
    it('spells the drag placeholder class verbatim, as three in-scope rules require', () => {
        // T1. `backlog-table.scss:235` and `:330`, and `sprints.scss:307`, all
        // depend on this exact spelling and all three are kept at zero edits.
        expect(TRANSIT_CLASS).toBe('gu-transit');
    });
});

/* ==========================================================================
 * computeNeighbours — THE SPECIFICATION (TRAPS 1 to 5)
 * ========================================================================== */

describe('computeNeighbours', () => {
    it('reports the preceding id and no following id for a MIDDLE position', () => {
        const { cards } = buildColumn(specsFor([10, 20, 30]));

        expect(computeNeighbours(cards[1], CARD_SELECTOR)).toEqual({
            previousId: 10,
            nextId: null,
        });
    });

    it('reports the following id and no preceding id at the FIRST position', () => {
        // The asymmetric half of previous-wins: with nothing before it, the
        // anchor has to be the element after it, which the write layer sends as
        // `before_userstory_id`.
        const { cards } = buildColumn(specsFor([10, 20, 30]));

        expect(computeNeighbours(cards[0], CARD_SELECTOR)).toEqual({
            previousId: null,
            nextId: 20,
        });
    });

    it('reports the preceding id at the LAST position', () => {
        const { cards } = buildColumn(specsFor([10, 20, 30]));

        expect(computeNeighbours(cards[2], CARD_SELECTOR)).toEqual({
            previousId: 20,
            nextId: null,
        });
    });

    it('reports neither anchor for the only item in a container', () => {
        const { cards } = buildColumn(specsFor([10]));

        expect(computeNeighbours(cards[0], CARD_SELECTOR)).toEqual({
            previousId: null,
            nextId: null,
        });
    });

    it('reports neither anchor for a detached element', () => {
        const detached = createElementIn(CARD_SELECTOR, ['card']);

        detached.setAttribute('data-id', '10');

        expect(computeNeighbours(detached, CARD_SELECTOR)).toEqual({
            previousId: null,
            nextId: null,
        });
    });

    describe('TRAP 1 — the scans are NEAREST-FIRST, not document-order-first', () => {
        it('chooses the IMMEDIATELY preceding match when two precede it', () => {
            // The single case that separates the correct rule from the wrong one.
            // Collecting preceding matches in document order and taking the first
            // would answer 10 here — the FURTHEST — and no single-step drag test
            // could tell the difference.
            const { cards } = buildColumn(specsFor([10, 20, 30]));

            expect(computeNeighbours(cards[2], CARD_SELECTOR).previousId).toBe(20);
        });

        it('chooses the IMMEDIATELY following match when two follow it', () => {
            const { cards } = buildColumn(specsFor([10, 20, 30]));

            expect(computeNeighbours(cards[0], CARD_SELECTOR).nextId).toBe(20);
        });

        it('steps over siblings the item selector does not match', () => {
            // A real column holds a task counter and a placeholder block among
            // its cards, so the walk has to continue rather than stop.
            const { cards } = buildColumn([
                { id: '10' },
                { decoy: true, tag: 'div', classNames: ['kanban-task-counter'] },
                { id: '20' },
            ]);

            expect(computeNeighbours(cards[2], CARD_SELECTOR).previousId).toBe(10);
        });

        it('steps over text and comment nodes', () => {
            const { column, cards } = buildColumn(specsFor([10, 20]));

            column.insertBefore(document.createTextNode('\n    '), cards[1]);
            column.insertBefore(document.createComment(' interpolation artefact '), cards[1]);

            expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBe(10);
        });
    });

    describe('TRAP 2 and TRAP 3 — previous wins, and the test is FALSY', () => {
        it('never reports both anchors at once for positive ids', () => {
            const { cards } = buildColumn(specsFor([10, 20, 30]));
            const neighbours = computeNeighbours(cards[1], CARD_SELECTOR);

            expect(neighbours.previousId).not.toBeNull();
            expect(neighbours.nextId).toBeNull();
        });

        it('falls through to the following id when the preceding id is 0', () => {
            // `if !previousCard` is falsy-checked upstream, so a preceding id of
            // 0 does NOT stop the following id from being computed. Reproduced
            // verbatim under T10; ids are positive in this application, so the
            // branch is unreachable in practice and is asserted here so nobody
            // "improves" it into a null test.
            const { cards } = buildColumn(specsFor([0, 20, 30]));

            expect(computeNeighbours(cards[1], CARD_SELECTOR)).toEqual({
                previousId: 0,
                nextId: 30,
            });
        });

        it('falls through to the following id when the preceding element carries no id', () => {
            const { cards } = buildColumn([{}, { id: '20' }, { id: '30' }]);

            expect(computeNeighbours(cards[1], CARD_SELECTOR)).toEqual({
                previousId: null,
                nextId: 30,
            });
        });
    });

    describe('TRAP 4 — the id is read only after the attribute is confirmed present', () => {
        it('yields null, never NaN, for an absent attribute', () => {
            const { cards } = buildColumn([{}, { id: '20' }]);

            expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBeNull();
        });

        it('yields null, never NaN, for an empty attribute', () => {
            const { cards } = buildColumn([{ id: '' }, { id: '20' }]);

            expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBeNull();
        });

        it('accepts "0" because it is a non-empty attribute value', () => {
            const { cards } = buildColumn([{ id: '0' }, { id: '20' }]);

            expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBe(0);
        });

        it('preserves the bare numeric conversion for a non-numeric attribute', () => {
            // The incumbent applies a plain conversion, so a malformed attribute
            // produces a not-a-number result there too. Preserved under T10, and
            // asserted so the behaviour is documented rather than accidental.
            const { cards } = buildColumn([{ id: 'not-a-number' }, { id: '20' }, { id: '30' }]);
            const neighbours = computeNeighbours(cards[1], CARD_SELECTOR);

            expect(neighbours.previousId).toBeNaN();
            // ... and because that result is falsy, the following id is computed too.
            expect(neighbours.nextId).toBe(30);
        });
    });

    describe('TRAP 5 — the exclusion covers ONLY the drag placeholder', () => {
        it('skips a placeholder sibling and keeps walking outward', () => {
            const { cards } = buildColumn([
                { id: '10' },
                { id: '99', transit: true },
                { id: '20' },
            ]);

            expect(computeNeighbours(cards[2], CARD_SELECTOR).previousId).toBe(10);
        });

        it('skips a placeholder on the following side as well', () => {
            const { cards } = buildColumn([
                { id: '10' },
                { id: '99', transit: true },
                { id: '20' },
            ]);

            expect(computeNeighbours(cards[0], CARD_SELECTOR).nextId).toBe(20);
        });

        it('STILL chooses a hidden multi-drag original, because it carries no placeholder class', () => {
            // Incumbent behaviour, preserved deliberately (T10) — and the same
            // assertion doubles as the R-DND-3 proof that nothing here filters
            // by visibility or computed display.
            const { cards } = buildColumn([{ id: '10', hidden: true }, { id: '20' }]);

            expect(cards[0].style.display).toBe('none');
            expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBe(10);
        });

        it('excludes a placeholder matching an EARLIER branch of a selector list', () => {
            // The decomposition proof. A composed selector string
            // `'tg-card, .row:not(.gu-transit)'` binds the exclusion to the last
            // branch alone, so it would accept the placeholder card below and
            // answer 99 instead of 10.
            const { cards } = buildColumn([
                { id: '10' },
                { id: '99', transit: true },
                { id: '20', tag: 'div', classNames: ['row'] },
            ]);

            expect(computeNeighbours(cards[2], `${CARD_SELECTOR}, ${ROW_SELECTOR}`).previousId).toBe(
                10,
            );
        });
    });

    describe('the same rule with the tables\u2019 selector', () => {
        it('measures backlog rows by class', () => {
            const { rows } = buildBacklogBody(specsFor([101, 102, 103]));

            expect(computeNeighbours(rows[1], ROW_SELECTOR)).toEqual({
                previousId: 101,
                nextId: null,
            });
        });

        it('measures a sprint row at the first position', () => {
            const { rows } = buildSprintTable(specsFor([201, 202]));

            expect(computeNeighbours(rows[0], ROW_SELECTOR)).toEqual({
                previousId: null,
                nextId: 202,
            });
        });

        it('does not treat a sprint empty-state block as a neighbour', () => {
            const { rows } = buildSprintTable(specsFor([201, 202]), true);

            expect(computeNeighbours(rows[0], ROW_SELECTOR)).toEqual({
                previousId: null,
                nextId: 202,
            });
        });
    });
});

/* ==========================================================================
 * TRAP 6 — THE THREE INDEX SEMANTICS, MEASURED OVER THE SAME ELEMENT
 * ========================================================================== */

describe('indexWithinContainer', () => {
    it('counts matching descendants of the container', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]));

        expect(indexWithinContainer(column, CARD_SELECTOR, cards[0])).toBe(0);
        expect(indexWithinContainer(column, CARD_SELECTOR, cards[2])).toBe(2);
    });

    it('reaches descendants at whichever depth, as the incumbent traversal does', () => {
        const column = createElementIn('div', ['taskboard-column']);
        const inner = createElementIn('div', ['kanban-table-inner']);

        document.body.appendChild(column);
        column.appendChild(inner);

        const cards = appendItems(inner, CARD_SELECTOR, ['card'], specsFor([10, 20]));

        expect(indexWithinContainer(column, CARD_SELECTOR, cards[1])).toBe(1);
    });

    it('does NOT exclude the placeholder, unlike the neighbour scan', () => {
        // The asymmetry is in the incumbent: the neighbour scan carries the
        // exclusion and this measurement does not. Excluding it here would shift
        // the index by one for the normal mid-drag case.
        const { column, cards } = buildColumn([
            { id: '10' },
            { id: '99', transit: true },
            { id: '20' },
        ]);

        expect(indexWithinContainer(column, CARD_SELECTOR, cards[2])).toBe(2);
    });

    it('ignores descendants the selector does not match', () => {
        const { column, cards } = buildColumn([
            { decoy: true, tag: 'div', classNames: ['kanban-task-counter'] },
            { id: '10' },
        ]);

        expect(indexWithinContainer(column, CARD_SELECTOR, cards[1])).toBe(0);
    });

    it('returns -1 for an element outside the container', () => {
        const { column } = buildColumn(specsFor([10]));
        const { cards: otherCards } = buildColumn(specsFor([20]));

        expect(indexWithinContainer(column, CARD_SELECTOR, otherCards[0])).toBe(-1);
    });
});

describe('indexWithinSelector', () => {
    it('counts across EVERY match in the document, not within the parent', () => {
        const first = buildBacklogBody(specsFor([101, 102]));
        const second = buildBacklogBody(specsFor([103, 104]));

        expect(indexWithinSelector(first.rows[0], BACKLOG_ROW_SELECTOR)).toBe(0);
        expect(indexWithinSelector(second.rows[0], BACKLOG_ROW_SELECTOR)).toBe(2);
        expect(indexWithinSelector(second.rows[1], BACKLOG_ROW_SELECTOR)).toBe(3);
    });

    describe('TRAP 6b — the scoping in the selector is load-bearing', () => {
        it('excludes the backlog table HEADER, which also carries the row class', () => {
            // `backlog-table.jade` L9 renders `div.row.backlog-table-title` inside
            // `.backlog-table-header`, OUTSIDE `div.backlog-table-body` (L19).
            const header = createElementIn('div', ['backlog-table-header']);

            document.body.appendChild(header);
            appendItems(header, 'div', ['row', 'backlog-table-title'], [{}]);

            const { rows } = buildBacklogBody(specsFor([101, 102]));

            expect(indexWithinSelector(rows[0], BACKLOG_ROW_SELECTOR)).toBe(0);
        });

        it('shifts every index by one once the scoping is dropped', () => {
            // The failure this scoping prevents, asserted directly: the same row
            // measured with the bare class selector scores one higher, and that
            // one is the silent corruption R-DND-2 warns about.
            const header = createElementIn('div', ['backlog-table-header']);

            document.body.appendChild(header);
            appendItems(header, 'div', ['row', 'backlog-table-title'], [{}]);

            const { rows } = buildBacklogBody(specsFor([101, 102]));

            expect(indexWithinSelector(rows[0], ROW_SELECTOR)).toBe(1);
        });
    });

    it('returns -1 for an element outside the selector\u2019s scope', () => {
        // Which is exactly what the incumbent answers for a drop into an empty
        // backlog: the two empty-backlog blocks are siblings of the table
        // section, not descendants of the table body.
        const empty = createElementIn('div', ['empty-backlog', 'js-empty-backlog']);

        document.body.appendChild(empty);

        const orphanRows = appendItems(empty, 'div', ['row', 'us-item-row'], specsFor([101]));

        buildBacklogBody(specsFor([102]));

        expect(indexWithinSelector(orphanRows[0], BACKLOG_ROW_SELECTOR)).toBe(-1);
    });

    it('returns -1 for a detached element', () => {
        const detached = createElementIn('div', ['row']);

        expect(indexWithinSelector(detached, BACKLOG_ROW_SELECTOR)).toBe(-1);
    });
});

describe('indexAmongSiblings', () => {
    it('counts every preceding element sibling, filtered by nothing at all', () => {
        // Unfiltered is the point: the sprint empty-state block is a sibling of
        // the rows and the incumbent counts it, so the first row scores 1.
        const { rows } = buildSprintTable(specsFor([201, 202]), true);

        expect(indexAmongSiblings(rows[0])).toBe(1);
        expect(indexAmongSiblings(rows[1])).toBe(2);
    });

    it('counts a placeholder sibling too', () => {
        const { rows } = buildSprintTable([{ id: '99', transit: true }, { id: '201' }]);

        expect(indexAmongSiblings(rows[1])).toBe(1);
    });

    it('scores 0 for a first child', () => {
        const { rows } = buildSprintTable(specsFor([201]));

        expect(indexAmongSiblings(rows[0])).toBe(0);
    });

    it('returns -1 for an element with no parent, as jQuery does', () => {
        const detached = createElementIn('div', ['row']);

        expect(indexAmongSiblings(detached)).toBe(-1);
    });

    it('differs from the container-scoped and document-scoped answers for the same element', () => {
        // The proof that the three are not interchangeable. One element, three
        // measurements, three different numbers.
        const header = createElementIn('div', ['backlog-table-header']);

        document.body.appendChild(header);
        appendItems(header, 'div', ['row', 'backlog-table-title'], [{}]);

        const { body, rows } = buildBacklogBody(specsFor([101, 102]));

        body.insertBefore(createElementIn('div', ['loading']), rows[0]);

        expect(indexWithinContainer(body, ROW_SELECTOR, rows[1])).toBe(1);
        expect(indexWithinSelector(rows[1], ROW_SELECTOR)).toBe(2);
        expect(indexAmongSiblings(rows[1])).toBe(2);
        expect(indexWithinSelector(rows[1], BACKLOG_ROW_SELECTOR)).toBe(1);
    });
});

/* ==========================================================================
 * THE GUARD AND THE ID READER
 * ========================================================================== */

describe('isUnchangedDrop', () => {
    it('holds only when the index is unchanged AND the container is the same', () => {
        expect(isUnchangedDrop(3, 3, true)).toBe(true);
        expect(isUnchangedDrop(3, 3, false)).toBe(false);
        expect(isUnchangedDrop(4, 3, true)).toBe(false);
        expect(isUnchangedDrop(4, 3, false)).toBe(false);
    });

    it('compares strictly, as the compiled incumbent condition does', () => {
        expect(isUnchangedDrop(0, -0, true)).toBe(true);
        expect(isUnchangedDrop(-1, -1, true)).toBe(true);
    });
});

describe('readDatasetIds', () => {
    it('preserves the order it is given, primary first', () => {
        const { cards } = buildColumn(specsFor([10, 20, 30]));

        expect(readDatasetIds([cards[1], cards[0], cards[2]])).toEqual([20, 10, 30]);
    });

    it('includes a zero id', () => {
        const { cards } = buildColumn(specsFor([0, 20]));

        expect(readDatasetIds(cards)).toEqual([0, 20]);
    });

    it('omits elements whose attribute is absent or empty rather than yielding NaN', () => {
        const { cards } = buildColumn([{ id: '10' }, {}, { id: '' }, { id: '30' }]);

        expect(readDatasetIds(cards)).toEqual([10, 30]);
    });

    it('returns an empty list for an empty selection', () => {
        expect(readDatasetIds([])).toEqual([]);
    });
});

/* ==========================================================================
 * computeNeighboursFromOrder — THE PROJECTED-ORDER PATH
 * ========================================================================== */

describe('computeNeighboursFromOrder', () => {
    it('reports the preceding id for a MIDDLE target', () => {
        expect(computeNeighboursFromOrder([10, 20, 30], [20], 1)).toEqual({
            previousId: 10,
            nextId: null,
        });
    });

    it('reports the following id at the FIRST target', () => {
        expect(computeNeighboursFromOrder([10, 20, 30], [20], 0)).toEqual({
            previousId: null,
            nextId: 10,
        });
    });

    it('reports the preceding id at the LAST target', () => {
        expect(computeNeighboursFromOrder([10, 20, 30], [20], 2)).toEqual({
            previousId: 30,
            nextId: null,
        });
    });

    it('reports neither anchor when the destination is empty', () => {
        expect(computeNeighboursFromOrder([], [20], 0)).toEqual({
            previousId: null,
            nextId: null,
        });
    });

    it('reports neither anchor for an empty selection', () => {
        expect(computeNeighboursFromOrder([10, 20, 30], [], 1)).toEqual({
            previousId: null,
            nextId: null,
        });
    });

    it('takes every moved id out before measuring, and anchors on the primary', () => {
        // A two-card selection dropped after 10: the projection is [10, 20, 40],
        // so the anchor is 10 and not the 30 that travelled with it.
        expect(computeNeighboursFromOrder([10, 20, 30, 40], [20, 30], 1)).toEqual({
            previousId: 10,
            nextId: null,
        });
    });

    describe('CROSS-CONTAINER — the moved id is not in the destination order', () => {
        it('anchors on the following id when it lands first', () => {
            expect(computeNeighboursFromOrder([10, 20], [99], 0)).toEqual({
                previousId: null,
                nextId: 10,
            });
        });

        it('anchors on the preceding id when it lands last', () => {
            expect(computeNeighboursFromOrder([10, 20], [99], 2)).toEqual({
                previousId: 20,
                nextId: null,
            });
        });

        it('anchors on the preceding id when it lands in the middle', () => {
            expect(computeNeighboursFromOrder([10, 20], [99], 1)).toEqual({
                previousId: 10,
                nextId: null,
            });
        });

        it('reports neither anchor when it lands in an empty destination', () => {
            expect(computeNeighboursFromOrder([], [99], 0)).toEqual({
                previousId: null,
                nextId: null,
            });
        });
    });

    it('applies the same FALSY previous-wins test as the DOM path', () => {
        expect(computeNeighboursFromOrder([0, 30], [99], 1)).toEqual({
            previousId: 0,
            nextId: 30,
        });
    });

    it('clamps a target index below the range to the front', () => {
        expect(computeNeighboursFromOrder([10, 20], [99], -5)).toEqual({
            previousId: null,
            nextId: 10,
        });
    });

    it('clamps a target index above the range to the back', () => {
        expect(computeNeighboursFromOrder([10, 20], [99], 99)).toEqual({
            previousId: 20,
            nextId: null,
        });
    });
});

/* ==========================================================================
 * THE EQUIVALENCE THE TWO PATHS OWE EACH OTHER
 * ========================================================================== */

describe('computeNeighboursFromOrder agrees with computeNeighbours', () => {
    interface EquivalenceCase {
        readonly name: string;
        readonly orderedIds: readonly number[];
        readonly movedIds: readonly number[];
        readonly targetIndex: number;
    }

    /**
     * Lays the projection out as real siblings and measures it with the DOM
     * path, which is the specification. Where the two ever disagree the DOM path
     * is correct by definition and the projected-order path is the one to fix.
     */
    function neighboursFromRenderedProjection(testCase: EquivalenceCase): SortableNeighbours {
        const moved = new Set<number>(testCase.movedIds);
        const remaining = testCase.orderedIds.filter((id) => !moved.has(id));
        const insertAt = Math.min(Math.max(testCase.targetIndex, 0), remaining.length);
        const projection = [
            ...remaining.slice(0, insertAt),
            testCase.movedIds[0],
            ...remaining.slice(insertAt),
        ];

        const { cards } = buildColumn(specsFor(projection));

        return computeNeighbours(cards[insertAt], CARD_SELECTOR);
    }

    const cases: readonly EquivalenceCase[] = [
        { name: 'FIRST position, same container', orderedIds: [10, 20, 30], movedIds: [20], targetIndex: 0 },
        { name: 'MIDDLE position, same container', orderedIds: [10, 20, 30], movedIds: [30], targetIndex: 1 },
        { name: 'LAST position, same container', orderedIds: [10, 20, 30], movedIds: [10], targetIndex: 2 },
        { name: 'only item, same container', orderedIds: [10], movedIds: [10], targetIndex: 0 },
        { name: 'CROSS-CONTAINER, landing first', orderedIds: [10, 20], movedIds: [99], targetIndex: 0 },
        { name: 'CROSS-CONTAINER, landing middle', orderedIds: [10, 20], movedIds: [99], targetIndex: 1 },
        { name: 'CROSS-CONTAINER, landing last', orderedIds: [10, 20], movedIds: [99], targetIndex: 2 },
        { name: 'CROSS-CONTAINER, empty destination', orderedIds: [], movedIds: [99], targetIndex: 0 },
        { name: 'multi-item selection', orderedIds: [10, 20, 30, 40], movedIds: [20, 30], targetIndex: 1 },
        { name: 'multi-item selection landing first', orderedIds: [10, 20, 30], movedIds: [20, 30], targetIndex: 0 },
        { name: 'a zero id immediately before the target', orderedIds: [0, 30], movedIds: [99], targetIndex: 1 },
        { name: 'target index clamped to the front', orderedIds: [10, 20], movedIds: [99], targetIndex: -3 },
        { name: 'target index clamped to the back', orderedIds: [10, 20], movedIds: [99], targetIndex: 12 },
    ];

    it.each(cases)('agrees for $name', (testCase) => {
        expect(
            computeNeighboursFromOrder(
                testCase.orderedIds,
                testCase.movedIds,
                testCase.targetIndex,
            ),
        ).toEqual(neighboursFromRenderedProjection(testCase));
    });
});

/* ==========================================================================
 * THE HOOK
 * ==========================================================================
 * Two configurations are exercised, because the two screens configure the index
 * semantics differently and the guard means nothing unless drag start and drag
 * end agree about which semantics apply.
 * ========================================================================== */

/** The board's container identity: the two positional attributes of its column. */
interface ColumnIdentity {
    readonly status: number;
    readonly swimlane: number;
}

/**
 * The board configuration. `resolveContainer` reads the attributes exactly as
 * KANBAN:121-L122 does — THROUGH THE DATASET MAP — and normalises nothing, which
 * is what lets the flat-mode case below observe the preserved not-a-number quirk.
 *
 * THE ACCESSOR MATTERS HERE, and it is the one thing about this fixture worth
 * copying into the real screen. For an ABSENT attribute the dataset map reports
 * `undefined`, which converts to a not-a-number value, whereas `getAttribute`
 * reports `null`, which converts to ZERO. Reading the flat-mode column with
 * `getAttribute` would therefore give it a swimlane of 0 that compares EQUAL to
 * the next flat column's, letting the unchanged-drop guard fire in flat mode
 * where the incumbent never lets it fire — a behaviour change with no error
 * surface.
 */
const boardConfig: UseSortableListConfig<ColumnIdentity> = {
    itemSelector: CARD_SELECTOR,
    resolveContainer: (container) => ({
        status: Number(container.dataset.status),
        swimlane: Number(container.dataset.swimlane),
    }),
    isSameContainer: (from, to) => from.status === to.status && from.swimlane === to.swimlane,
};

/** The list's container identity: whether it is the backlog, and which sprint otherwise. */
interface TableIdentity {
    readonly isBacklog: boolean;
    readonly sprintId: number | null;
}

function resolveTableIdentity(container: HTMLElement): TableIdentity {
    // BACKLOG:99, verbatim: the backlog table body OR either empty-backlog block.
    const isBacklog =
        container.classList.contains('backlog-table-body') ||
        container.classList.contains('js-empty-backlog');

    return {
        isBacklog,
        sprintId: isBacklog ? null : Number(container.dataset.sprint),
    };
}

function buildListConfig(siblingIndexFallback: boolean): UseSortableListConfig<TableIdentity> {
    return {
        itemSelector: ROW_SELECTOR,
        indexSelector: BACKLOG_ROW_SELECTOR,
        siblingIndexFallback,
        resolveContainer: resolveTableIdentity,
        // BACKLOG:101-L104: backlog-versus-backlog, otherwise sprint against sprint.
        isSameContainer: (from, to) =>
            from.isBacklog || to.isBacklog
                ? from.isBacklog === to.isBacklog
                : from.sprintId === to.sprintId,
    };
}

/**
 * Moves an element to a container at a given position, as the retired library did
 * before its `drop` handler ran.
 *
 * The element is detached FIRST, so `position` means "position among the children
 * that remain" — the same reading `computeNeighboursFromOrder` gives its target
 * index, and the only reading under which a move within one container behaves the
 * way a person dragging it would expect.
 */
function relocate(element: HTMLElement, container: HTMLElement, position: number): void {
    element.remove();

    container.insertBefore(element, container.children.item(position));
}

describe('useSortableList — board configuration (container-scoped index)', () => {
    it('captures the origin container at drag start and reports it live', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '5',
            swimlane: '7',
        });
        const { result } = renderHook(() => useSortableList(boardConfig));

        expect(result.current.origin).toBeNull();

        result.current.beginDrag(cards[1], []);

        expect(result.current.origin).toEqual({ status: 5, swimlane: 7 });
        // Same container, same index: the guard fires and nothing is persisted.
        expect(result.current.endDrag(cards[1], [], column)).toBeNull();
    });

    it('reports the six values of a resolved drop within one container', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '5',
            swimlane: '7',
        });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[2], []);
        relocate(cards[2], column, 0);
        result.current.recordNeighbours(cards[2]);

        expect(result.current.endDrag(cards[2], [], column)).toEqual({
            previousId: null,
            nextId: 10,
            index: 0,
            oldIndex: 2,
            unchanged: false,
            ids: [30],
        });
    });

    it('resolves a CROSS-CONTAINER drop even when the index is unchanged', () => {
        // The case the guard must NOT absorb: position 0 in one column is not
        // position 0 in another, and treating it as unchanged would silently drop
        // the move.
        const origin = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const destination = buildColumn(specsFor([30]), { status: '6', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], destination.column, 0);
        result.current.recordNeighbours(origin.cards[0]);

        expect(result.current.endDrag(origin.cards[0], [], destination.column)).toEqual({
            previousId: null,
            nextId: 30,
            index: 0,
            oldIndex: 0,
            unchanged: false,
            ids: [10],
        });
    });

    it('treats every flat-mode drop as a container change, preserving the incumbent quirk', () => {
        // `kanban-table.jade` L189-L197 renders no swimlane attribute in flat
        // mode, so the resolved identity holds a not-a-number swimlane, which
        // equals nothing — not even itself. The incumbent therefore never reports
        // sameness in flat mode, and the guard consequently never fires there.
        // Preserved under T10; the consequence is the screen's concern.
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[1], []);

        const origin = result.current.origin;

        expect(origin).not.toBeNull();
        expect(origin?.swimlane).toBeNaN();

        const dropped = result.current.endDrag(cards[1], [], column);

        expect(dropped).not.toBeNull();
        expect(dropped?.index).toBe(1);
        expect(dropped?.oldIndex).toBe(1);
        expect(dropped?.unchanged).toBe(false);
    });

    it('measures the FIRST SELECTED element inside the GRABBED element\u2019s container', () => {
        // KANBAN:84-L85 pairs `item.parentNode` with `firstElement`, so the two
        // arguments are not interchangeable for a multi-item drag.
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '5',
            swimlane: '7',
        });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[2], [cards[0], cards[2]]);
        relocate(cards[0], column, 2);
        result.current.recordNeighbours(cards[0]);

        const dropped = result.current.endDrag(cards[2], [cards[0], cards[2]], column);

        expect(dropped?.oldIndex).toBe(0);
        expect(dropped?.index).toBe(2);
        expect(dropped?.ids).toEqual([10, 30]);
    });

    it('falls back to the grabbed element when no selection is supplied', () => {
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[1], []);
        relocate(cards[1], column, 0);

        expect(result.current.endDrag(cards[1], [], column)?.ids).toEqual([20]);
    });

    it('captures nothing for a detached element, so the guard cannot fire', () => {
        const { column } = buildColumn(specsFor([10]), { status: '5', swimlane: '7' });
        const detached = createElementIn(CARD_SELECTOR, ['card']);

        detached.setAttribute('data-id', '20');

        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(detached, []);

        expect(result.current.origin).toBeNull();

        const dropped = result.current.endDrag(detached, [], column);

        expect(dropped).not.toBeNull();
        expect(dropped?.oldIndex).toBe(-1);
    });

    it('reports -1 for the start index when no drag start was captured', () => {
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        const dropped = result.current.endDrag(cards[0], [], column);

        expect(dropped).not.toBeNull();
        expect(dropped?.oldIndex).toBe(-1);
        expect(dropped?.index).toBe(0);
    });
});

describe('useSortableList — list configuration (document-scoped index)', () => {
    it('measures the index across every backlog table body in the document', () => {
        const first = buildBacklogBody(specsFor([101, 102]));
        const second = buildBacklogBody(specsFor([103, 104]));
        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(second.rows[1], []);
        relocate(second.rows[1], first.body, 0);
        result.current.recordNeighbours(second.rows[1]);

        expect(result.current.endDrag(second.rows[1], [], first.body)).toEqual({
            previousId: null,
            nextId: 101,
            index: 0,
            oldIndex: 3,
            unchanged: false,
            ids: [104],
        });
    });

    it('falls back to the sibling index for a sprint table when the fallback is enabled', () => {
        // BACKLOG:114-L118: a row that landed outside the backlog table is
        // measured against its own siblings.
        const backlog = buildBacklogBody(specsFor([101, 102]));
        const sprint = buildSprintTable(specsFor([201, 202]), true);

        sprint.table.setAttribute('data-sprint', '9');

        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(backlog.rows[0], []);
        relocate(backlog.rows[0], sprint.table, 2);
        result.current.recordNeighbours(backlog.rows[0]);

        expect(result.current.endDrag(backlog.rows[0], [], sprint.table)).toEqual({
            previousId: 201,
            nextId: null,
            // One empty-state block plus one preceding row: unfiltered, so 2.
            index: 2,
            oldIndex: 0,
            unchanged: false,
            ids: [101],
        });
    });

    it('reports the document-scoped -1 for an out-of-scope container when the fallback is off', () => {
        // Which reproduces the incumbent `isBacklog` branch verbatim, including
        // the answer it gives for a drop into an empty backlog.
        const backlog = buildBacklogBody(specsFor([101]));
        const empty = createElementIn('div', ['empty-backlog', 'js-empty-backlog']);

        document.body.appendChild(empty);

        const { result } = renderHook(() => useSortableList(buildListConfig(false)));

        result.current.beginDrag(backlog.rows[0], []);
        relocate(backlog.rows[0], empty, 0);

        expect(result.current.endDrag(backlog.rows[0], [], empty)?.index).toBe(-1);
    });

    it('fires the guard for a backlog reorder that changed nothing', () => {
        const backlog = buildBacklogBody(specsFor([101, 102]));
        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(backlog.rows[1], []);
        result.current.recordNeighbours(backlog.rows[1]);

        expect(result.current.endDrag(backlog.rows[1], [], backlog.body)).toBeNull();
    });

    it('does NOT fire the guard between two different sprints at the same position', () => {
        const from = buildSprintTable(specsFor([201]));
        const to = buildSprintTable(specsFor([301]));

        from.table.setAttribute('data-sprint', '9');
        to.table.setAttribute('data-sprint', '11');

        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(from.rows[0], []);
        relocate(from.rows[0], to.table, 0);
        result.current.recordNeighbours(from.rows[0]);

        const dropped = result.current.endDrag(from.rows[0], [], to.table);

        expect(dropped?.index).toBe(0);
        expect(dropped?.oldIndex).toBe(0);
        expect(dropped?.nextId).toBe(301);
    });
});

describe('useSortableList — the anchor protocol and cleanup', () => {
    it('resets and recomputes the anchors on every recordNeighbours call', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '5',
            swimlane: '7',
        });
        const { result } = renderHook(() => useSortableList(boardConfig));

        expect(result.current.recordNeighbours(cards[0])).toEqual({
            previousId: null,
            nextId: 20,
        });

        relocate(cards[0], column, 2);

        expect(result.current.recordNeighbours(cards[0])).toEqual({
            previousId: 30,
            nextId: null,
        });
    });

    it('keeps the previous anchors across a drag start, reproducing the incumbent protocol', () => {
        // Upstream the anchors are reset only inside the `drop` handler, so a
        // cancelled drag — which never fires `drop` — leaves the previous ones in
        // place and the unchanged-drop guard absorbs it. Resetting them at drag
        // start would be a behaviour change, so `beginDrag` must not do it.
        const origin = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const destination = buildColumn(specsFor([30]), { status: '6', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.recordNeighbours(origin.cards[0]);

        // A second gesture begins without a drop ever having been recorded for it.
        result.current.beginDrag(origin.cards[1], []);
        relocate(origin.cards[1], destination.column, 1);

        const dropped = result.current.endDrag(origin.cards[1], [], destination.column);

        expect(dropped?.nextId).toBe(20);
        expect(dropped?.previousId).toBeNull();
    });

    it('clears the captured index, origin and anchors on cancelDrag', () => {
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[1], []);
        result.current.recordNeighbours(cards[1]);
        result.current.cancelDrag();

        expect(result.current.origin).toBeNull();

        const dropped = result.current.endDrag(cards[1], [], column);

        expect(dropped).toEqual({
            previousId: null,
            nextId: null,
            index: 1,
            oldIndex: -1,
            unchanged: false,
            ids: [20],
        });
    });
});

describe('useSortableList — stability and configuration freshness', () => {
    it('keeps one stable object and four stable callbacks across renders', () => {
        const { result, rerender } = renderHook(
            (props: UseSortableListConfig<ColumnIdentity>) => useSortableList(props),
            { initialProps: boardConfig },
        );

        const first = result.current;

        // A freshly-built configuration object on every render is the normal case
        // for a consumer, and it must not tear the gesture handlers down.
        rerender({ ...boardConfig });

        expect(result.current).toBe(first);
        expect(result.current.beginDrag).toBe(first.beginDrag);
        expect(result.current.recordNeighbours).toBe(first.recordNeighbours);
        expect(result.current.endDrag).toBe(first.endDrag);
        expect(result.current.cancelDrag).toBe(first.cancelDrag);
    });

    it('honours the latest configuration through the stable callbacks', () => {
        const { column } = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const rowsInColumn = appendItems(column, 'div', ['row'], specsFor([777]));
        const { result, rerender } = renderHook(
            (props: UseSortableListConfig<ColumnIdentity>) => useSortableList(props),
            { initialProps: boardConfig },
        );

        expect(result.current.recordNeighbours(rowsInColumn[0]).previousId).toBe(20);

        rerender({ ...boardConfig, itemSelector: ROW_SELECTOR });

        // The same callback identity, the new selector: nothing before the row
        // matches `.row`, so the anchors change.
        expect(result.current.recordNeighbours(rowsInColumn[0])).toEqual({
            previousId: null,
            nextId: null,
        });
    });

    it('behaves identically under the double render of strict mode', () => {
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5', swimlane: '7' });
        const { result } = renderHook(() => useSortableList(boardConfig), { wrapper: StrictMode });

        result.current.beginDrag(cards[1], []);

        expect(result.current.origin).toEqual({ status: 5, swimlane: 7 });
        expect(result.current.endDrag(cards[1], [], column)).toBeNull();
    });
});
