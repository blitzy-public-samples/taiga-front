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
 *     previous-wins rule treats asymmetrically — asserted both within one
 *     container and, by name, at the head and the tail of a DESTINATION;
 *   - the CROSS-CONTAINER cases, which are the ones the guard must NOT absorb,
 *     including three drops whose index is UNCHANGED and whose container is not;
 *   - fixtures with TWO candidates on the same side, and one with THREE, which is
 *     the only way to tell nearest-first from document-order-first apart;
 *   - the three index semantics measured over the SAME element, so conflating
 *     them fails loudly here instead of quietly in production;
 *   - an equivalence group that asserts the projected-order path agrees with
 *     the DOM path, which is the specification, on every fixture;
 *   - the two deliberately inconsistent swimlane readings of KANBAN:140 and
 *     KANBAN:146, proving this layer neither adds nor removes their fallback;
 *   - and a group asserting the layer WRITES NOTHING: no DOM mutation, no
 *     dispatched event, no surface beyond the four operations and one origin.
 *
 * Browserless by construction: it runs in the jsdom environment configured by
 * `jest.config.js` and needs no browser binary, no built bundle and no network.
 * jsdom implements no layout engine, which does not matter here — nothing in the
 * unit under test measures geometry, and nothing in it may filter by visibility
 * (R-DND-3). That is not left to inspection: the hidden-original case asserts it
 * directly, and the R-DND-3 group installs a TRIPWIRE that throws on any layout,
 * rectangle or viewport read and then drives a whole gesture through it.
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
    SortableDropResult,
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

/**
 * BOTH empty-backlog blocks, because there are exactly two of them in the real
 * markup — `backlog.jade` L174 renders `.empty-backlog.js-empty-backlog` and L178
 * renders `.empty-large.js-empty-backlog` — and that is precisely why BACKLOG:34
 * collects the class and BACKLOG:39 registers `emptyBacklog[0]` AND
 * `emptyBacklog[1]` as drop containers. Their children are reproduced too
 * (L175-L176 and L179-L181), so the unfiltered sibling index has something to
 * count and the fixture cannot accidentally flatter the measurement.
 */
function buildEmptyBacklogBlocks(): readonly [HTMLElement, HTMLElement] {
    const noMatch = createElementIn('div', ['empty-backlog', 'js-empty-backlog']);
    const large = createElementIn('div', ['empty-large', 'js-empty-backlog']);

    noMatch.appendChild(createElementIn('p', ['no-match']));
    noMatch.appendChild(createElementIn('p', ['no-match-help']));
    large.appendChild(createElementIn('p', ['title']));
    large.appendChild(createElementIn('button', ['btn-small']));

    document.body.appendChild(noMatch);
    document.body.appendChild(large);

    return [noMatch, large];
}

/**
 * Adds the inner wrapper of `app/modules/components/card/card.jade` L8-L13 to a
 * card, which is where the viewport guard lives. Leaving it off is how a card
 * that is currently scrolled away renders: the OUTER custom element, and the
 * positional attribute it carries, are emitted either way because the card
 * directive declares no element replacement (R-DND-3).
 */
function addCardInner(card: HTMLElement): void {
    card.appendChild(createElementIn('div', ['card-inner']));
}

/**
 * Replaces every layout, rectangle and viewport accessor on an element with a
 * getter that THROWS, so one geometry read anywhere inside the unit under test
 * fails the case by name instead of passing quietly.
 *
 * This is a tripwire rather than an assertion on purpose. jsdom implements no
 * layout engine, so every metric it reports is 0 and every rectangle is empty —
 * which means a geometry-dependent implementation would look perfectly correct
 * here for entirely the wrong reason, and would then fail in a browser the moment
 * a card scrolled out of view (R-DND-3).
 */
function forbidLayoutReads(element: HTMLElement): void {
    const forbidden: readonly string[] = [
        'offsetParent',
        'offsetHeight',
        'offsetWidth',
        'offsetTop',
        'offsetLeft',
        'clientHeight',
        'clientWidth',
        'getBoundingClientRect',
        'getClientRects',
        // Not a DOM property at all — the virtualisation flag the board binds on
        // its cards. Named here so the tripwire also covers an implementation
        // that reached for it directly.
        'inViewPort',
    ];

    for (const name of forbidden) {
        Object.defineProperty(element, name, {
            configurable: true,
            get(): never {
                throw new Error(
                    `useSortableList read "${name}", which R-DND-3 forbids: ordering must ` +
                        'never depend on visibility or geometry.',
                );
            },
        });
    }
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
        // Both anchors null is a MEANINGFUL answer rather than a missing one: the
        // write layer builds its order payload with an exclusive chain
        // (`resources/userstories.coffee` L99-L103 for the backlog, L120-L124 for
        // the board), so a pair of nulls sends NEITHER `after_userstory_id` NOR
        // `before_userstory_id` and the server places the story by index alone.
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

        it('chooses the THIRD of FIVE items when the FOURTH is dragged, never the first', () => {
            // The five-item fixture, because three items only separate "nearest"
            // from "furthest" — with three matches ahead of the dragged one the
            // three plausible implementations answer differently, and only the
            // incumbent's answer is correct:
            //
            //   nearest-first (correct, upstream)      -> 30
            //   document-order-first (the classic slip) -> 10
            //   "whatever the query returned last"      -> 10
            //
            // Upstream reads `prevAll(sel)[0]`, and that collection arrives in
            // REVERSE document order, so index 0 is the IMMEDIATELY preceding
            // match. Rebuilding the same scan with a document-order query and
            // taking `[0]` is an off-by-MANY that persists silently (R-DND-2).
            const { cards } = buildColumn(specsFor([10, 20, 30, 40, 50]));

            expect(computeNeighbours(cards[3], CARD_SELECTOR)).toEqual({
                previousId: 30,
                nextId: null,
            });
        });

        it('chooses the SECOND of FIVE items when the FIRST is dragged, never the last', () => {
            // The symmetric half: `nextAll(sel)[0]` is the IMMEDIATELY following
            // match, so with four matches behind it the answer is the nearest one
            // and not the tail of the column.
            const { cards } = buildColumn(specsFor([10, 20, 30, 40, 50]));

            expect(computeNeighbours(cards[0], CARD_SELECTOR)).toEqual({
                previousId: null,
                nextId: 20,
            });
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

        it('steps over a backlog sibling the row selector does not match', () => {
            // The selector-filtering rule again, on the LIST's selector, because
            // the table body is not a homogeneous run of rows: `backlog-table.jade`
            // L27-L28 renders a loading block among them and it carries no row
            // class, so the scan has to continue past it instead of stopping and
            // reporting no neighbour.
            const { rows } = buildBacklogBody([
                { id: '101' },
                { decoy: true, tag: 'div', classNames: ['loading'] },
                { id: '102' },
            ]);

            expect(computeNeighbours(rows[2], ROW_SELECTOR)).toEqual({
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

/* ==========================================================================
 * CROSS-CONTAINER DROPS — THE CASES THE GUARD MUST NOT ABSORB
 * ==========================================================================
 * A cross-container drop is the half of the arithmetic that a same-container
 * suite cannot reach, and it is where the silent corruption of R-DND-2 hides for
 * two compounding reasons.
 *
 * FIRST, the guard compares an index against an index. Position 1 of one column
 * is a completely different place from position 1 of another, so a guard that
 * ignored the container would discard a real move and report success — the user
 * sees the card in its new column, the server never hears about it, and the next
 * page load puts it back. Every case below that pairs an UNCHANGED index with a
 * CHANGED container exists to pin that down.
 *
 * SECOND, the anchors are read from the DESTINATION, which the dragged element
 * has already joined. So the head of the destination and its tail are the two
 * positions whose anchors come out asymmetrically, and they are asserted here by
 * name.
 * ========================================================================== */

describe('useSortableList — CROSS-CONTAINER drops on the board', () => {
    it('resolves a CROSS-CONTAINER drop between two COLUMNS of the same swimlane', () => {
        // KANBAN:121-L122 reads the pair fresh from the destination's attributes,
        // and KANBAN:147 compares both halves, so a status change alone is enough
        // to make the containers differ.
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '3' });
        const destination = buildColumn(specsFor([201, 202]), { status: '9', swimlane: '3' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);

        expect(result.current.origin).toEqual({ status: 7, swimlane: 3 });

        relocate(origin.cards[0], destination.column, 1);
        result.current.recordNeighbours(origin.cards[0]);

        expect(result.current.endDrag(origin.cards[0], [], destination.column)).toEqual({
            previousId: 201,
            nextId: null,
            index: 1,
            oldIndex: 0,
            unchanged: false,
            ids: [101],
        });
    });

    it('reads the destination identity from the DESTINATION container’s own attributes', () => {
        // The identity is a function of the container's attributes and of NOTHING
        // else — not of element identity, not of anything captured at drag start.
        // Two DIFFERENT columns carrying the SAME pair therefore resolve alike,
        // which is exactly the behaviour of KANBAN:121-L122 reading
        // `parentEl.dataset` afresh on every drop. Recording the resolutions also
        // proves the destination is resolved from the container the drop is
        // reported against, not from the dragged element's own ancestry.
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '3' });
        const twin = buildColumn([], { status: '7', swimlane: '3' });
        const resolved: ColumnIdentity[] = [];
        const recordingConfig: UseSortableListConfig<ColumnIdentity> = {
            ...boardConfig,
            resolveContainer: (container) => {
                const identity = boardConfig.resolveContainer(container);

                resolved.push(identity);

                return identity;
            },
        };
        const { result } = renderHook(() => useSortableList(recordingConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], twin.column, 0);

        // Same pair, different element, same index: indistinguishable from a
        // no-op reorder, so the guard fires.
        expect(result.current.endDrag(origin.cards[0], [], twin.column)).toBeNull();
        expect(resolved).toEqual([
            { status: 7, swimlane: 3 },
            { status: 7, swimlane: 3 },
        ]);
    });

    it('resolves a CROSS-CONTAINER drop between two SWIMLANES of the same status', () => {
        // The other half of KANBAN:147. A card can move down the board without
        // changing status at all, and the swimlane half of the pair is the only
        // thing that says so.
        const origin = buildColumn(specsFor([101]), { status: '7', swimlane: '3' });
        const destination = buildColumn(specsFor([201]), { status: '7', swimlane: '5' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], destination.column, 1);
        result.current.recordNeighbours(origin.cards[0]);

        expect(result.current.endDrag(origin.cards[0], [], destination.column)).toEqual({
            previousId: 201,
            nextId: null,
            index: 1,
            oldIndex: 0,
            unchanged: false,
            ids: [101],
        });
    });

    it('carries the -1 swimlane sentinel through untouched, never null, 0 or not-a-number', () => {
        // `-1` IS A LEGITIMATE IDENTITY VALUE, not an error code. KANBAN:146 reads
        // `item.getIn(['model','swimlane']) || -1`, and `../types/swimlane.ts`
        // documents the same `-1` as the client-side "unclassified" swimlane that
        // holds the stories whose own `swimlane` attribute is null
        // (`kanban-usertories.coffee` L295-L300 and L312-L313). Nothing in this
        // layer may substitute anything else for it.
        //
        // The case is also a second index-equals-old-index cross-container drop:
        // position 1 in the origin and position 1 in the destination, which the
        // guard must NOT absorb.
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '-1' });
        const destination = buildColumn(specsFor([201]), { status: '9', swimlane: '-1' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[1], []);

        expect(result.current.origin).toEqual({ status: 7, swimlane: -1 });
        expect(result.current.origin?.swimlane).not.toBeNull();
        expect(result.current.origin?.swimlane).not.toBeNaN();
        expect(result.current.origin?.swimlane).not.toBe(0);

        relocate(origin.cards[1], destination.column, 1);
        result.current.recordNeighbours(origin.cards[1]);

        expect(result.current.endDrag(origin.cards[1], [], destination.column)).toEqual({
            previousId: 201,
            nextId: null,
            index: 1,
            oldIndex: 1,
            unchanged: false,
            ids: [102],
        });
    });

    it('recognises the -1 sentinel as an identity that COMPARES EQUAL to itself', () => {
        // The contrast that gives the sentinel its meaning: `-1` equals `-1`, so
        // two unclassified columns of one status ARE the same container and the
        // guard fires there. The absent flat-mode attribute below behaves the
        // opposite way, and the difference is deliberate.
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '-1' });
        const twin = buildColumn(specsFor([201]), { status: '7', swimlane: '-1' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[1], []);
        relocate(origin.cards[1], twin.column, 1);
        result.current.recordNeighbours(origin.cards[1]);

        expect(result.current.endDrag(origin.cards[1], [], twin.column)).toBeNull();
    });

    it('emits an id of 0 as 0, dropping nothing and coercing nothing', () => {
        // Which key eventually reaches the wire is the api layer's decision, not
        // this layer's: `resources/userstories.coffee` adds `milestone_id` (L96)
        // and `swimlane_id` (L126) only when truthy while `status_id` is ALWAYS
        // sent. So every id has to arrive up here exactly as the attribute spelled
        // it, with no filtering of falsy values on the way.
        const origin = buildColumn([{ id: '0' }, { id: '102' }], {
            status: '7',
            swimlane: '3',
        });
        const destination = buildColumn(specsFor([201]), { status: '9', swimlane: '3' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], destination.column, 0);
        result.current.recordNeighbours(origin.cards[0]);

        const dropped = result.current.endDrag(origin.cards[0], [], destination.column);

        expect(dropped?.ids).toEqual([0]);
        expect(dropped?.ids[0]).toBe(0);
        expect(dropped?.nextId).toBe(201);
    });

    it('anchors on the destination’s FIRST id when a cross-container drop lands at the HEAD', () => {
        // The mandated combination: cross-container AND head of list. This is
        // where an off-by-one most often hides, because the head is the one
        // position with no preceding sibling to fall back on, so it is the only
        // position whose anchor is the FOLLOWING id — the `before_userstory_id`
        // half of the write contract.
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '3' });
        const destination = buildColumn(specsFor([201, 202]), { status: '9', swimlane: '3' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[1], []);
        relocate(origin.cards[1], destination.column, 0);
        result.current.recordNeighbours(origin.cards[1]);

        expect(result.current.endDrag(origin.cards[1], [], destination.column)).toEqual({
            previousId: null,
            nextId: 201,
            index: 0,
            oldIndex: 1,
            unchanged: false,
            ids: [102],
        });
    });

    it('anchors on the destination’s LAST id when a cross-container drop lands at the TAIL', () => {
        const origin = buildColumn(specsFor([101, 102]), { status: '7', swimlane: '3' });
        const destination = buildColumn(specsFor([201, 202]), { status: '9', swimlane: '3' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], destination.column, 2);
        result.current.recordNeighbours(origin.cards[0]);

        expect(result.current.endDrag(origin.cards[0], [], destination.column)).toEqual({
            previousId: 202,
            nextId: null,
            index: 2,
            oldIndex: 0,
            unchanged: false,
            ids: [101],
        });
    });

    it('reports neither anchor and index 0 for a drop into an EMPTY container', () => {
        // An empty column is a normal board state, not an edge case — every
        // status starts empty. Both anchors null and index 0 is the answer that
        // sends neither order key and lets the server place the story.
        const origin = buildColumn(specsFor([101]), { status: '7', swimlane: '3' });
        const destination = buildColumn([], { status: '9', swimlane: '3' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(origin.cards[0], []);
        relocate(origin.cards[0], destination.column, 0);
        result.current.recordNeighbours(origin.cards[0]);

        expect(result.current.endDrag(origin.cards[0], [], destination.column)).toEqual({
            previousId: null,
            nextId: null,
            index: 0,
            oldIndex: 0,
            unchanged: false,
            ids: [101],
        });
    });
});

describe('useSortableList — CROSS-CONTAINER drops between the backlog and the sprints', () => {
    it('resolves a CROSS-CONTAINER drop from the BACKLOG into a SPRINT', () => {
        // BACKLOG:101-L102: when EITHER side is the backlog the comparison is
        // backlog-versus-backlog, so this drop is a container change however the
        // sprint is identified. Note the index: 1 in the backlog and 1 in the
        // sprint, which the guard must not read as "nothing happened".
        const backlog = buildBacklogBody(specsFor([101, 102]));
        const sprint = buildSprintTable(specsFor([201]));

        sprint.table.setAttribute('data-sprint', '9');

        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(backlog.rows[1], []);
        relocate(backlog.rows[1], sprint.table, 1);
        result.current.recordNeighbours(backlog.rows[1]);

        expect(result.current.endDrag(backlog.rows[1], [], sprint.table)).toEqual({
            previousId: 201,
            nextId: null,
            // BACKLOG:117 — outside the table body the row is measured against
            // its own siblings.
            index: 1,
            // BACKLOG:87 — inside it, against every row of every table body.
            oldIndex: 1,
            unchanged: false,
            ids: [102],
        });
    });

    it('resolves a CROSS-CONTAINER drop from a SPRINT back into the BACKLOG', () => {
        const sprint = buildSprintTable(specsFor([201, 202]));

        sprint.table.setAttribute('data-sprint', '9');

        const backlog = buildBacklogBody(specsFor([101]));
        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(sprint.rows[0], []);
        relocate(sprint.rows[0], backlog.body, 1);
        result.current.recordNeighbours(sprint.rows[0]);

        expect(result.current.endDrag(sprint.rows[0], [], backlog.body)).toEqual({
            previousId: 101,
            nextId: null,
            index: 1,
            oldIndex: 0,
            unchanged: false,
            ids: [201],
        });
    });

    it('fires the guard for a reorder that changed nothing WITHIN ONE sprint', () => {
        // The second branch of BACKLOG:101-L104: with neither side the backlog the
        // sprint ids are compared, and two references to the SAME sprint are the
        // same container — so an unmoved row is absorbed exactly as it is in the
        // backlog. The companion case, two DIFFERENT sprints at the same
        // position, is asserted above and must stay distinguishable from this one.
        const sprint = buildSprintTable(specsFor([201, 202]));

        sprint.table.setAttribute('data-sprint', '9');

        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(sprint.rows[1], []);
        result.current.recordNeighbours(sprint.rows[1]);

        expect(result.current.endDrag(sprint.rows[1], [], sprint.table)).toBeNull();
    });

    it('treats the FIRST empty-backlog block as the backlog itself', () => {
        // BACKLOG:99 — `.backlog-table-body` OR `.js-empty-backlog`. Dropping the
        // only visible row into the no-match block has not left the backlog, so
        // with the position unchanged the guard fires and nothing is persisted.
        const backlog = buildBacklogBody(specsFor([101, 102]));
        const [noMatchBlock] = buildEmptyBacklogBlocks();
        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(backlog.rows[0], []);
        relocate(backlog.rows[0], noMatchBlock, 0);
        result.current.recordNeighbours(backlog.rows[0]);

        expect(noMatchBlock.classList.contains('js-empty-backlog')).toBe(true);
        expect(result.current.endDrag(backlog.rows[0], [], noMatchBlock)).toBeNull();
    });

    it('treats the SECOND empty-backlog block identically, which is why BOTH are registered', () => {
        // `backlog.jade` L178 renders the second block, BACKLOG:39 registers it as
        // `emptyBacklog[1]`, and BACKLOG:99 matches it on the same class. A
        // fixture that rendered only the first block would let an implementation
        // that recognised only `emptyBacklog[0]` pass.
        const backlog = buildBacklogBody(specsFor([101, 102]));
        const [, emptyLargeBlock] = buildEmptyBacklogBlocks();
        const { result } = renderHook(() => useSortableList(buildListConfig(true)));

        result.current.beginDrag(backlog.rows[0], []);
        relocate(backlog.rows[0], emptyLargeBlock, 0);
        result.current.recordNeighbours(backlog.rows[0]);

        expect(emptyLargeBlock.classList.contains('js-empty-backlog')).toBe(true);
        expect(result.current.endDrag(backlog.rows[0], [], emptyLargeBlock)).toBeNull();
    });
});

/* ==========================================================================
 * THE TWO SWIMLANE READINGS, DELIBERATELY INCONSISTENT UPSTREAM
 * ==========================================================================
 * KANBAN:140 builds the value it REPORTS with `item.getIn(['model','swimlane'])`
 * and no fallback at all, while KANBAN:146 builds the value it COMPARES with
 * `item.getIn(['model','swimlane']) || -1`. Six lines apart, two different
 * readings of one attribute.
 *
 * That is incumbent behaviour and T10 forbids harmonising it ("No functional or
 * feature change of any kind"). What this group asserts is that the unit under
 * test is AGNOSTIC: it neither adds the fallback where upstream omits it nor
 * strips it where upstream applies it. The reading belongs to the screen's
 * configuration, and the two readings produce two different — and both correct —
 * outcomes for the very same gesture.
 * ========================================================================== */

describe('useSortableList — the raw and the fallback swimlane readings', () => {
    /** The `-1` of KANBAN:146, named so the substitution below is unmistakable. */
    const UNCLASSIFIED_SWIMLANE = -1;

    /**
     * KANBAN:146 semantics: the compared value carries the `|| -1` fallback, so an
     * absent attribute becomes the unclassified sentinel BEFORE the comparison.
     */
    const fallbackConfig: UseSortableListConfig<ColumnIdentity> = {
        itemSelector: CARD_SELECTOR,
        resolveContainer: (container) => {
            const raw = Number(container.dataset.swimlane);

            return {
                status: Number(container.dataset.status),
                swimlane: Number.isNaN(raw) ? UNCLASSIFIED_SWIMLANE : raw,
            };
        },
        isSameContainer: (from, to) => from.status === to.status && from.swimlane === to.swimlane,
    };

    it('reports a flat-mode no-op reorder as a CHANGE under the raw reading', () => {
        // `kanban-table.jade` L189-L197 renders no swimlane attribute in flat
        // mode. Read raw, the identity holds a not-a-number swimlane, which
        // compares equal to nothing — not even to itself — so the flat-mode board
        // never reports sameness and the guard never fires there.
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[1], []);

        const dropped = result.current.endDrag(cards[1], [], column);

        expect(dropped).not.toBeNull();
        expect(dropped?.index).toBe(1);
        expect(dropped?.oldIndex).toBe(1);
    });

    it('reports the SAME flat-mode reorder as UNCHANGED under the fallback reading', () => {
        // The same gesture, the same unit, the other reading. The fallback turns
        // the absent attribute into `-1`, `-1` equals `-1`, and the guard fires.
        // Both outcomes are upstream behaviour; which one a screen gets is the
        // screen's decision, taken in its own `resolveContainer`.
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5' });
        const { result } = renderHook(() => useSortableList(fallbackConfig));

        result.current.beginDrag(cards[1], []);

        expect(result.current.origin).toEqual({ status: 5, swimlane: UNCLASSIFIED_SWIMLANE });
        expect(result.current.endDrag(cards[1], [], column)).toBeNull();
    });

    it('substitutes nothing of its own for the absent flat-mode attribute', () => {
        // The unit stores and reports whatever the configuration resolved, so the
        // captured origin still holds the raw not-a-number value: NOT -1, NOT 0
        // and NOT null. Coercing it here would silently hand flat mode the
        // swimlane-mode guard.
        const { column, cards } = buildColumn(specsFor([10, 20]), { status: '5' });
        const { result } = renderHook(() => useSortableList(boardConfig));

        result.current.beginDrag(cards[1], []);

        const origin = result.current.origin;

        expect(origin).not.toBeNull();
        expect(origin?.swimlane).toBeNaN();
        expect(origin?.swimlane).not.toBe(UNCLASSIFIED_SWIMLANE);
        expect(origin?.swimlane).not.toBe(0);
        expect(origin?.swimlane).not.toBeNull();
        // And the observable consequence, asserted rather than inferred: the
        // position is identical on both sides and the drop is STILL resolved.
        expect(result.current.endDrag(cards[1], [], column)).not.toBeNull();
    });
});

/* ==========================================================================
 * R-DND-3 — ORDERING NEVER DEPENDS ON VISIBILITY OR GEOMETRY
 * ==========================================================================
 * The adopted drag library brings no virtual-list support of its own, and the
 * board virtualises its cards. Two structural facts keep that safe:
 *
 *   - `app/modules/components/card/card.jade` L8-L13 puts the viewport guard on
 *     `.card-inner`, INSIDE the outer custom element, and the card directive
 *     declares no element replacement — so the outer element carrying `data-id`
 *     is emitted whether the card is on screen or not. A card that is scrolled
 *     away is an EMPTY outer element, not an absent one.
 *   - `../useInViewport` latches visibility MONOTONICALLY: an id marked visible
 *     is never marked invisible again (`kanban/main.coffee` L577 and L666-L677).
 *     There is no "left the viewport" transition to react to, so there is nothing
 *     for this layer to react to even in principle.
 *
 * Filter on visibility here and a drag toward a scrolled-away region finds no
 * drop target — one more failure with no error surface.
 * ========================================================================== */

describe('useSortableList — R-DND-3: no dependence on visibility or geometry', () => {
    /**
     * Three cards of which the MIDDLE one is currently virtualised out: it has no
     * inner wrapper, exactly as `ng-if="vm.inViewPort"` leaves it.
     */
    function buildVirtualisedColumn(): {
        readonly column: HTMLElement;
        readonly cards: HTMLElement[];
    } {
        const built = buildColumn(specsFor([10, 20, 30]), { status: '7', swimlane: '3' });

        addCardInner(built.cards[0]);
        addCardInner(built.cards[2]);

        return built;
    }

    it('keeps a VIRTUALISED-OUT card in the neighbour scan', () => {
        const { cards } = buildVirtualisedColumn();

        // The fixture's premise: the middle card renders nothing inside itself.
        expect(cards[1].children).toHaveLength(0);

        expect(computeNeighbours(cards[2], CARD_SELECTOR).previousId).toBe(20);
        expect(computeNeighbours(cards[0], CARD_SELECTOR).nextId).toBe(20);
    });

    it('keeps a VIRTUALISED-OUT card in all three index measurements', () => {
        const { column, cards } = buildVirtualisedColumn();

        expect(indexWithinContainer(column, CARD_SELECTOR, cards[1])).toBe(1);
        expect(indexWithinSelector(cards[1], CARD_SELECTOR)).toBe(1);
        expect(indexAmongSiblings(cards[1])).toBe(1);

        // And the cards after it still score correctly, which is the failure a
        // visibility filter would cause: an off-by-one for every card below the
        // fold.
        expect(indexWithinContainer(column, CARD_SELECTOR, cards[2])).toBe(2);
        expect(indexWithinSelector(cards[2], CARD_SELECTOR)).toBe(2);
        expect(indexAmongSiblings(cards[2])).toBe(2);
    });

    it('does not exclude a card whose display is suppressed', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '7',
            swimlane: '3',
        });

        cards[1].style.display = 'none';

        expect(computeNeighbours(cards[2], CARD_SELECTOR).previousId).toBe(20);
        expect(indexWithinContainer(column, CARD_SELECTOR, cards[2])).toBe(2);
    });

    it('reads no layout metric and no viewport flag during a whole gesture', () => {
        // The tripwire: every geometry accessor on the fixture throws, so a single
        // read fails this case by name. Asserting on the metrics instead would
        // prove nothing, because jsdom reports 0 for all of them.
        const { column, cards } = buildVirtualisedColumn();

        forbidLayoutReads(column);

        for (const card of cards) {
            forbidLayoutReads(card);
        }

        const { result } = renderHook(() => useSortableList(boardConfig));
        const outcome: { dropped: SortableDropResult | null } = { dropped: null };

        expect(() => {
            result.current.beginDrag(cards[2], []);
            relocate(cards[2], column, 0);
            result.current.recordNeighbours(cards[2]);
            outcome.dropped = result.current.endDrag(cards[2], [], column);
        }).not.toThrow();

        expect(outcome.dropped).toEqual({
            previousId: null,
            nextId: 10,
            index: 0,
            oldIndex: 2,
            unchanged: false,
            ids: [30],
        });
    });

    it('would be indistinguishable from a geometry-dependent implementation without that tripwire', () => {
        // Recorded so the tripwire above is understood as necessary rather than
        // decorative: under jsdom every metric is 0 and every rectangle is empty,
        // so an implementation that ranked cards by their vertical offset would
        // agree with the correct one on every fixture in this file and disagree
        // with it in a browser.
        const { cards } = buildColumn(specsFor([10, 20]));

        expect(cards[0].offsetHeight).toBe(0);
        expect(cards[1].offsetTop).toBe(0);
        expect(cards[0].getBoundingClientRect().height).toBe(0);

        expect(computeNeighbours(cards[1], CARD_SELECTOR).previousId).toBe(10);
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

/* ==========================================================================
 * THIS LAYER COMPUTES AND REPORTS, AND DOES NOTHING ELSE
 * ==========================================================================
 * Everything the incumbent handlers did BESIDES the arithmetic belongs to the
 * screens, and the specification's scope split says so explicitly. The class
 * toggle and its `animationend` removal (KANBAN:128-L131), the per-item element
 * deletion (KANBAN:149-L151, BACKLOG:123-L134), the doom-line removal
 * (BACKLOG:95), the `drag-active` body class (BACKLOG:73 and L108), the
 * serialised drag queue with its re-entrancy guard, and both hand-offs — the
 * root-scope broadcast at KANBAN:153 and `ctrl.moveUs(...)` at BACKLOG:143 — are
 * all somebody else's job.
 *
 * A drift here would not fail loudly either: a hook that quietly mutated the DOM
 * or dispatched an event would work in one screen and double-apply in the other.
 * ========================================================================== */

describe('useSortableList — performs no write of any kind', () => {
    it('leaves the document untouched and dispatches nothing across a whole gesture', () => {
        const { column, cards } = buildColumn(specsFor([10, 20, 30]), {
            status: '7',
            swimlane: '3',
        });
        // The two configured collaborators, wrapped so the case can assert they
        // are the ONLY collaboration and that both are read-only: one is asked for
        // an identity, the other for a comparison. Neither is handed a way to
        // write anything.
        const resolveContainer = jest.fn(boardConfig.resolveContainer);
        const isSameContainer = jest.fn(boardConfig.isSameContainer);
        const { result } = renderHook(() =>
            useSortableList({ itemSelector: CARD_SELECTOR, resolveContainer, isSameContainer }),
        );

        const beforeBeginDrag = document.body.innerHTML;

        result.current.beginDrag(cards[2], []);

        expect(document.body.innerHTML).toBe(beforeBeginDrag);

        // The move itself is the drag library's, not the hook's — upstream the
        // node was already in its new place before the `drop` handler ran.
        relocate(cards[2], column, 0);

        const dispatchEvent = jest.spyOn(EventTarget.prototype, 'dispatchEvent');
        const afterRelocate = document.body.innerHTML;

        result.current.recordNeighbours(cards[2]);

        const dropped = result.current.endDrag(cards[2], [], column);

        result.current.cancelDrag();

        expect(document.body.innerHTML).toBe(afterRelocate);
        expect(dispatchEvent).not.toHaveBeenCalled();
        expect(resolveContainer).toHaveBeenCalled();
        expect(isSameContainer).toHaveBeenCalled();

        // The drop is reported as plain data: no callable travels with it, so a
        // consumer cannot be handed a hidden write disguised as a result.
        expect(dropped).not.toBeNull();
        expect(Object.values(dropped ?? {}).every((value) => typeof value !== 'function')).toBe(
            true,
        );
    });

    it('publishes exactly four operations and one origin, and nothing that persists', () => {
        // The whole surface, enumerated. A `save`, `commit`, `dispatch` or
        // `persist` member appearing here later would mean the write moved into
        // the wrong layer.
        const { result } = renderHook(() => useSortableList(boardConfig));

        expect(Object.keys(result.current).sort()).toEqual([
            'beginDrag',
            'cancelDrag',
            'endDrag',
            'origin',
            'recordNeighbours',
        ]);
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

        // A SECOND re-render, because identity has to hold across the whole life
        // of the gesture rather than for one render only: a handler registered on
        // a pointer event at drag start is still the handler that has to run at
        // drop, however many times the screen re-rendered in between.
        rerender({ ...boardConfig, itemSelector: CARD_SELECTOR });

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
