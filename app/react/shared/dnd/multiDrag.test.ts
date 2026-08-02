/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `multiDrag.ts`, the hand-built multi-select drag machinery
 * shared by the two migrated screens — the Kanban board and the Backlog /
 * Sprint-Planning story table.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * `multiDrag.ts` is a line-for-line port of the retired global helper at
 * `app/js/dragula-drag-multiple.js` (224 lines), which `@dnd-kit/core` cannot
 * replace because it has no multi-item drag of its own (risk R-DND-1). The job of
 * this specification is therefore narrower and stricter than "does the unit work":
 * it is to prove the port is FAITHFUL. Every assertion that encodes a behaviour of
 * the retired helper cites it as `INCUMBENT:NNN`, meaning line NNN of that file —
 * which is read as a behavioural reference and never imported, because the
 * TypeScript configuration enables no `allowJs` and nothing under `app/js/` is part
 * of this program.
 *
 * A second, equally important job: this file is the TRIPWIRE for the class-name
 * contract of transformation rule T1. The six in-scope stylesheets are kept at zero
 * edits, so the module has to emit the same runtime class names the retired drag
 * library emitted, at the same lifecycle moments. Get one of them wrong and there is
 * no error, no warning and no failing build — just a drag visual that silently stops
 * appearing. Every class name is therefore asserted literally, with the locator of
 * the stylesheet rule that depends on it, and the classes the module must NEVER
 * apply are asserted too.
 *
 * BROWSERLESS BY CONSTRUCTION
 * ---------------------------
 * It runs in the jsdom environment configured by `jest.config.js` and needs no
 * browser binary, no built bundle, no server and no network. There is no Playwright
 * import here, and the only import at all is the unit under test.
 *
 * Two consequences of jsdom shape the fixtures:
 *
 *   - There is no layout engine, so `offsetWidth`, `offsetHeight` and
 *     `getBoundingClientRect()` report zero for every element unless they are
 *     stubbed. `stubBox` supplies each fixture element with an explicit box, which
 *     is what makes the geometry assertions meaningful rather than vacuous — and it
 *     pins every measurement to the source it must come from: the clone width to the
 *     PRIMARY element, the clone height to the element's OWN box, and the stacking
 *     pitch to the DRAG IMAGE's box. Each of the three is given a different value,
 *     so swapping any two of them fails a test.
 *   - There is no pointer, so the gesture is driven through the module's own API
 *     plus synthetic `mousemove` events dispatched at the document element. What is
 *     asserted is state and class transitions, never visual motion.
 *
 * `jest.config.js` already sets `clearMocks` and `restoreMocks`, so this file
 * installs spies with `jest.spyOn` and never resets them by hand. There are no
 * snapshot tests: every assertion names a specific structural fact — a class, a
 * count, an order, a returned shape — because a snapshot would record a typo as
 * happily as it records the truth.
 *
 * HOW THE CASES ARE ORGANISED
 * ---------------------------
 * The published class-name constants, then the two pure queries (`getMultiDragElements`
 * document-wide, `isMultiDrag` container-scoped — an asymmetry that is deliberate and
 * is asserted), then the controller: arming and preparation, the numbering and
 * stacking arithmetic, the multi-item transit class, the card ghost stack, the
 * container shapes the two screens hand over, the ten-step teardown, listener
 * discipline, the delegating query methods, the injected document, factory isolation,
 * and finally the classes the module must never touch.
 *
 * PROVENANCE OF THE MARKUP FIXTURES — NOT FIGMA
 * --------------------------------------------
 * The card ghost stack asserted here comes from
 * `app/modules/components/card/card.jade` L45-L55 and from the rules at
 * `app/styles/modules/kanban/kanban-table.scss:320`, :330 and :359-:365. It does NOT
 * come from a design frame: neither attached frame captures any drag, hover, ghost
 * or modal state — they show the idle screen only — which is drift-register entry D4.
 * No design tool is consulted by this file.
 */
import {
    MAIN_DRAG_CLASS,
    MIRROR_CLASS,
    MULTIPLE_DRAG_MIRROR_CLASS,
    MULTIPLE_SORTABLE_CLASS,
    TG_MULTIPLE_DRAG_DRAGGING_CLASS,
    TG_MULTIPLE_DRAG_MIRROR_CLASS,
    TRANSIT_CLASS,
    TRANSIT_MULTI_CLASS,
    createMultiDrag,
    getMultiDragElements,
    isMultiDrag,
} from './multiDrag';
import type {
    CreateMultiDragOptions,
    MultiDragContainer,
    MultiDragController,
} from './multiDrag';

/* ==========================================================================
 * TEST SUPPORT
 * ========================================================================== */

interface BoxStub {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Gives one element a fixed box, standing in for the layout engine jsdom does
 * not have. Both the border-box metrics and the client rectangle are stubbed,
 * because the module reads the first for the clone dimensions and the second for
 * the stacking arithmetic.
 */
const stubBox = (element: HTMLElement, box: BoxStub): void => {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, value: box.width });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: box.height });

    const rect: DOMRect = {
        x: box.left,
        y: box.top,
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => box,
    };

    element.getBoundingClientRect = (): DOMRect => rect;
};

const makeRow = (
    ownerDocument: Document,
    id: string,
    selected: boolean,
    box: BoxStub,
): HTMLElement => {
    const row = ownerDocument.createElement('div');

    row.className = selected ? `row ${MULTIPLE_SORTABLE_CLASS}` : 'row';
    row.dataset.id = id;
    stubBox(row, box);

    return row;
};

/** Fires one movement event at the element the controller listens on. */
const move = (ownerDocument: Document): void => {
    ownerDocument.documentElement.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
};

const clonesIn = (ownerDocument: Document): readonly HTMLElement[] =>
    Array.from(ownerDocument.querySelectorAll<HTMLElement>(`.${TG_MULTIPLE_DRAG_MIRROR_CLASS}`));

const idsOf = (elements: readonly HTMLElement[]): readonly (string | undefined)[] =>
    elements.map((element) => element.dataset.id);

const childIdsOf = (parent: HTMLElement): readonly (string | undefined)[] =>
    Array.from(parent.children).map((child) =>
        child instanceof HTMLElement ? child.dataset.id : undefined,
    );

const dataAttributesOf = (element: HTMLElement): readonly string[] =>
    element
        .getAttributeNames()
        .filter((name) => name.startsWith('data-'))
        .sort();

/**
 * The standard fixture: five selected rows with an unselected one wedged between
 * them, plus a drag image and a transit gap. Row "3" is the element the pointer
 * grabs, so the numbering must come out as
 * `1 -> -2`, `2 -> -1`, `3 -> 0`, `4 -> +1`, `6 -> +2`.
 */
interface Fixture {
    readonly container: HTMLElement;
    readonly target: HTMLElement;
    readonly rows: Readonly<Record<string, HTMLElement>>;
    readonly main: HTMLElement;
    readonly mirror: HTMLElement;
    readonly transit: HTMLElement;
}

const MAIN_WIDTH = 250;
const MIRROR_BOX: BoxStub = { top: 100, left: 60, width: 200, height: 40 };

const buildFixture = (): Fixture => {
    const container = document.createElement('div');
    container.className = 'backlog-table-body';

    const rows: Record<string, HTMLElement> = {
        '1': makeRow(document, '1', true, { top: 0, left: 0, width: 10, height: 30 }),
        '2': makeRow(document, '2', true, { top: 0, left: 0, width: 11, height: 31 }),
        '3': makeRow(document, '3', true, { top: 0, left: 0, width: MAIN_WIDTH, height: 44 }),
        '4': makeRow(document, '4', true, { top: 0, left: 0, width: 12, height: 32 }),
        '5': makeRow(document, '5', false, { top: 0, left: 0, width: 13, height: 33 }),
        '6': makeRow(document, '6', true, { top: 0, left: 0, width: 14, height: 34 }),
    };

    for (const key of ['1', '2', '3', '4', '5', '6']) {
        const row = rows[key];

        if (row !== undefined) {
            container.appendChild(row);
        }
    }

    const target = document.createElement('div');
    target.className = 'sprint-table';

    const mirror = document.createElement('div');
    mirror.className = MIRROR_CLASS;
    stubBox(mirror, MIRROR_BOX);

    const transit = document.createElement('div');
    transit.className = `row ${TRANSIT_CLASS}`;

    document.body.append(container, target, mirror, transit);

    const main = rows['3'];

    if (main === undefined) {
        throw new Error('fixture is missing the primary row');
    }

    return { container, target, rows, main, mirror, transit };
};

const rowOf = (fixture: Fixture, id: string): HTMLElement => {
    const row = fixture.rows[id];

    if (row === undefined) {
        throw new Error(`fixture is missing row ${id}`);
    }

    return row;
};

/* --------------------------------------------------------------------------
 * THE MARKUP THE TWO SCREENS ACTUALLY HAND OVER
 * --------------------------------------------------------------------------
 * The fixture above is a deliberately plain list of rows, which is enough for the
 * numbering and teardown arithmetic. The builders below reproduce the real markup
 * of the two migrated screens, because four of this module's obligations are only
 * visible against it:
 *
 *   - the ghost stack inside a board card, which the module REVEALS and must never
 *     BUILD (risk R-DND-1);
 *   - the difference between the swimlane container and the flat-mode container;
 *   - the story-table header row, which shares the `row` class with every story
 *     row but lives outside the sortable body;
 *   - a selected row nested inside a sprint table, which only a DESCENDANT search
 *     finds.
 *
 * Every element is built by the FIXTURE rather than by the unit under test, which
 * is exactly what lets the assertions prove the unit creates no markup at all.
 */

/**
 * The always-present multi-drag ghost stack, reproduced from
 * `app/modules/components/card/card.jade` L45-L55 — a T4-PROTECTED file that this
 * migration reads and never edits.
 *
 * Shape, verbatim: a top-level sibling of `.card-inner` holding EXACTLY TWO
 * `.fake-us` blocks, each one a `.fake-img` beside a `.column` of two `.fake-text`
 * lines. Two blocks, not one and not one per selected card — the stack is a fixed
 * decorative hint that several items are moving, and `kanban-table.scss:330`
 * styles `.fake-us` with a `:last-child` margin reset that assumes exactly that.
 *
 * In production this markup comes from `../../kanban/KanbanCard.tsx`.
 */
const makeCardGhostStack = (): HTMLElement => {
    const stack = document.createElement('div');

    stack.className = 'card-transit-multi';

    for (let block = 0; block < 2; block += 1) {
        const fakeUs = document.createElement('div');
        const fakeImage = document.createElement('div');
        const column = document.createElement('div');
        const firstLine = document.createElement('div');
        const secondLine = document.createElement('div');

        fakeUs.className = 'fake-us';
        fakeImage.className = 'fake-img';
        column.className = 'column';
        firstLine.className = 'fake-text';
        secondLine.className = 'fake-text';

        column.append(firstLine, secondLine);
        fakeUs.append(fakeImage, column);
        stack.appendChild(fakeUs);
    }

    return stack;
};

/**
 * One board card, reproduced from `app/partials/includes/modules/kanban-table.jade`
 * L150-L157: a `tg-card` custom element carrying `card`, `ng-animate-disabled` and
 * `data-id`, plus — from the SAME binding at L154 — both `kanban-task-selected` and
 * `ui-multisortable-multiple` when the screen has it selected. That shared binding
 * is why the multi-select ring and the multi-drag selection always agree.
 *
 * jsdom instantiates a hyphenated unknown tag as a plain `HTMLElement`, so no
 * custom-element registration is needed and none is performed: this suite defines
 * no custom element and attaches no shadow root (implicit requirement I6).
 */
const makeCard = (id: string, selected: boolean, box: BoxStub): HTMLElement => {
    const card = document.createElement('tg-card');
    const inner = document.createElement('div');

    card.className = selected
        ? `card ng-animate-disabled kanban-task-selected ${MULTIPLE_SORTABLE_CLASS}`
        : 'card ng-animate-disabled';
    card.dataset.id = id;

    inner.className = 'card-inner';
    card.append(inner, makeCardGhostStack());
    stubBox(card, box);

    return card;
};

/**
 * One board column. Reproduces `kanban-table.jade` L112-L121 when `swimlaneId` is
 * given — the swimlane shape, carrying BOTH `data-status` and `data-swimlane` — and
 * L189-L197 when it is omitted: the FLAT-MODE shape, which carries `data-status`
 * only. The module reads neither attribute; both shapes exist here so the suite
 * records that it is indifferent to the difference.
 */
const makeColumn = (statusId: string, swimlaneId?: string): HTMLElement => {
    const column = document.createElement('div');

    column.className = 'kanban-uses-box taskboard-column';
    column.id = `column-${statusId}`;
    column.dataset.status = statusId;

    if (swimlaneId !== undefined) {
        column.dataset.swimlane = swimlaneId;
    }

    return column;
};

/** The card box measured for the board at specification section 0.3.2: 260 x 224. */
const CARD_BOX: BoxStub = { top: 0, left: 0, width: 260, height: 224 };

interface BoardFixture {
    readonly column: HTMLElement;
    readonly cards: readonly HTMLElement[];
    readonly main: HTMLElement;
    readonly ghost: HTMLElement;
    readonly mirror: HTMLElement;
}

/**
 * One swimlane column holding three selected cards with an unselected one wedged
 * between them, the middle selected card grabbed, plus a drag image.
 *
 * The grabbed card also carries `gu-transit`, because that is what the drag library
 * puts on the element left behind in the list — and `kanban-table.scss:359` keys the
 * ghost reveal on `.card.gu-transit-multi`, so the card itself has to be the
 * carrier for the reveal to happen at all.
 */
const buildBoardFixture = (): BoardFixture => {
    const column = makeColumn('7', '3');
    const cards = [
        makeCard('101', true, CARD_BOX),
        makeCard('102', true, CARD_BOX),
        makeCard('103', false, CARD_BOX),
        makeCard('104', true, CARD_BOX),
    ];
    const mirror = document.createElement('div');

    for (const card of cards) {
        column.appendChild(card);
    }

    mirror.className = MIRROR_CLASS;
    stubBox(mirror, MIRROR_BOX);
    document.body.append(column, mirror);

    const main = cards[1];

    if (main === undefined) {
        throw new Error('board fixture is missing its grabbed card');
    }

    // Applied by the drag library, read by this module, never written by it.
    main.classList.add(TRANSIT_CLASS);

    const ghost = main.querySelector('.card-transit-multi');

    if (!(ghost instanceof HTMLElement)) {
        throw new Error('board fixture is missing the card ghost stack');
    }

    return { column, cards, main, ghost, mirror };
};

/** The story-row box measured at specification section 0.3.2: 1254 wide, 56 high. */
const STORY_ROW_BOX: BoxStub = { top: 0, left: 0, width: 1254, height: 56 };

/**
 * One story row. `.row.us-item-row` reproduces
 * `app/partials/includes/components/backlog-row.jade` L8 and L13, and
 * `.row.milestone-us-item-row` reproduces `app/partials/backlog/sprint.jade` L17
 * and L20. The selection class is appended by the screen, never by the module.
 */
const makeStoryRow = (id: string, selected: boolean, rowClass: string): HTMLElement => {
    const row = document.createElement('div');

    row.className = selected ? `row ${rowClass} ${MULTIPLE_SORTABLE_CLASS}` : `row ${rowClass}`;
    row.dataset.id = id;
    stubBox(row, STORY_ROW_BOX);

    return row;
};

interface StoryTableFixture {
    readonly header: HTMLElement;
    readonly headerRow: HTMLElement;
    readonly body: HTMLElement;
    readonly bodyRows: readonly HTMLElement[];
    readonly sidebar: HTMLElement;
    readonly sprintTable: HTMLElement;
    readonly sprintRows: readonly HTMLElement[];
    readonly mirror: HTMLElement;
}

/**
 * The backlog screen's own shapes:
 *
 *   - `.backlog-table-header > div.row.backlog-table-title`
 *     (`app/partials/includes/modules/backlog-table.jade` L8-L9) — THE HEADER TRAP.
 *     It carries the class `row`, which is exactly what the drag library's own
 *     `moves` gate keys on (`app/coffee/modules/backlog/sortable.coffee` L44-L47),
 *     yet it sits OUTSIDE the sortable body and must never be mistaken for a story
 *     row;
 *   - `div.backlog-table-body` (L19), the container the library registers;
 *   - a sidebar holding `div.sprint-table` (`sprint.jade` L13), which the library
 *     recognises through `isContainer` at `.../backlog/sortable.coffee` L42, with
 *     its selected rows NESTED two levels down.
 */
const buildStoryTableFixture = (): StoryTableFixture => {
    const header = document.createElement('div');
    const headerRow = document.createElement('div');
    const body = document.createElement('div');
    const sidebar = document.createElement('div');
    const sprintTable = document.createElement('div');
    const mirror = document.createElement('div');

    header.className = 'backlog-table-header';
    headerRow.className = 'row backlog-table-title';
    header.appendChild(headerRow);

    body.className = 'backlog-table-body';

    const bodyRows = [
        makeStoryRow('201', true, 'us-item-row'),
        makeStoryRow('202', true, 'us-item-row'),
        makeStoryRow('203', false, 'us-item-row'),
    ];

    for (const row of bodyRows) {
        body.appendChild(row);
    }

    const sprintRows = [
        makeStoryRow('301', true, 'milestone-us-item-row'),
        makeStoryRow('302', true, 'milestone-us-item-row'),
    ];

    sprintTable.className = 'sprint-table';

    for (const row of sprintRows) {
        sprintTable.appendChild(row);
    }

    sidebar.className = 'sprints';
    sidebar.appendChild(sprintTable);

    mirror.className = MIRROR_CLASS;
    stubBox(mirror, MIRROR_BOX);

    document.body.append(header, body, sidebar, mirror);

    return { header, headerRow, body, bodyRows, sidebar, sprintTable, sprintRows, mirror };
};

/** The first element of a fixture list, with a loud failure when the list is short. */
const at = (elements: readonly HTMLElement[], index: number, what: string): HTMLElement => {
    const element = elements[index];

    if (element === undefined) {
        throw new Error(`fixture is missing ${what} at index ${index}`);
    }

    return element;
};

/** How many elements in the document carry `className`. */
const carriersOf = (className: string): number =>
    document.querySelectorAll(`.${className}`).length;

/**
 * Every controller created by a case is registered here and destroyed afterwards.
 *
 * This is not tidiness for its own sake. A controller dropped while still armed
 * keeps its movement listener on the DOCUMENT ELEMENT, which
 * `document.body.innerHTML = ''` does not touch. That stale listener then fires on
 * the next case's movement and positions the previous case's ghosts against the
 * new case's markup — silently, with no error. It is exactly the leak
 * `MultiDragController.destroy()` exists to close, and exactly why the drag
 * provider has to call it on unmount rather than relying on the drag-end handler
 * alone.
 */
const liveControllers: MultiDragController[] = [];

const makeController = (options?: CreateMultiDragOptions): MultiDragController => {
    const controller: MultiDragController = createMultiDrag(options);

    liveControllers.push(controller);

    return controller;
};

afterEach(() => {
    while (liveControllers.length > 0) {
        liveControllers.pop()?.destroy();
    }

    document.body.innerHTML = '';
});

/* ==========================================================================
 * PUBLISHED CLASS NAME CONSTANTS
 * ========================================================================== */

describe('class name constants', () => {
    it('publishes the exact strings the existing stylesheets select on', () => {
        // Transformation rule T1: these strings are a contract with six
        // stylesheets kept at zero edits. A typo here fails silently in the
        // browser — no error, no warning, no failing build, just a drag visual
        // that stops appearing — so every name is asserted literally rather than
        // derived, and each one carries the locator of the rule that depends on
        // it. THIS TEST IS THE TRIPWIRE for that silent-failure mode.

        // Selection marker. READ by this module, NEVER assigned: the screens own
        // it, bound at `app/partials/includes/modules/kanban-table.jade` L154 (and
        // L230 in flat mode) to `ctrl.selectedUss[usId]`, and toggled at
        // `app/coffee/modules/backlog/main.coffee` L824 on the closest
        // `.us-item-row`. It carries no stylesheet rule of its own; it is the
        // selector the selection is found with. Mirrors INCUMBENT:10.
        expect(MULTIPLE_SORTABLE_CLASS).toBe('ui-multisortable-multiple');

        // The grabbed element. Applied and removed here (INCUMBENT:161 and :56).
        // No stylesheet rule — behavioural marker only — but load-bearing, because
        // `prepare()` filters the primary element out of the clone set by testing
        // for it (INCUMBENT:163-165). Mirrors INCUMBENT:11.
        expect(MAIN_DRAG_CLASS).toBe('main-drag-item');

        // The drag image. READ only; the drag provider applies it to the overlay
        // and `prepare()` merely snapshots the carrier (INCUMBENT:159). Styled at
        // `app/modules/components/card/card.scss:25` — T4-PROTECTED, shared with
        // the out-of-scope taskboard — and at
        // `app/styles/modules/backlog/backlog-table.scss:195`, :211 and :314.
        expect(MIRROR_CLASS).toBe('gu-mirror');

        // The gap left behind in the source list. READ only; `drag()` looks for it
        // in order to add the multi-item class alongside (INCUMBENT:32). Styled at
        // `backlog-table.scss:235` and :330 and at
        // `app/styles/modules/backlog/sprints.scss:307`.
        expect(TRANSIT_CLASS).toBe('gu-transit');

        // OWNED HERE, and the single most consequential name in the file: added by
        // `drag()` (INCUMBENT:32), removed by step 9 of `stop()` (INCUMBENT:64).
        // `app/styles/modules/kanban/kanban-table.scss:359-:365` reveals the
        // always-present `.card-transit-multi` ghost stack and hides `.card-inner`,
        // while :305 withdraws the multi-select ring through
        // `&.card:not(.gu-transit-multi)` — so one class drives TWO visuals.
        expect(TRANSIT_MULTI_CLASS).toBe('gu-transit-multi');

        // OWNED HERE: added to every clone (INCUMBENT:173), removed document-wide
        // by step 7 of `stop()` (INCUMBENT:58). Styled at
        // `app/styles/layout/backlog.scss:154` and `backlog-table.scss:295`.
        expect(MULTIPLE_DRAG_MIRROR_CLASS).toBe('multiple-drag-mirror');

        // OWNED HERE: added to every clone (INCUMBENT:174) and the marker step 6 of
        // `stop()` deletes precisely those nodes with (INCUMBENT:57). Styled at
        // `app/modules/components/card/card.scss:29` — T4-PROTECTED.
        expect(TG_MULTIPLE_DRAG_MIRROR_CLASS).toBe('tg-multiple-drag-mirror');

        // OWNED HERE: added to every hidden original (INCUMBENT:187), removed and
        // re-shown by step 8 of `stop()` (INCUMBENT:60-62). No stylesheet rule —
        // behavioural marker only.
        expect(TG_MULTIPLE_DRAG_DRAGGING_CLASS).toBe('tg-multiple-drag-dragging');

        // Eight DISTINCT names. A copy-paste that pointed two constants at the same
        // string would satisfy every assertion above and still break the teardown,
        // because steps 6 and 7 would then act on the same set.
        expect(
            new Set([
                MULTIPLE_SORTABLE_CLASS,
                MAIN_DRAG_CLASS,
                MIRROR_CLASS,
                TRANSIT_CLASS,
                TRANSIT_MULTI_CLASS,
                MULTIPLE_DRAG_MIRROR_CLASS,
                TG_MULTIPLE_DRAG_MIRROR_CLASS,
                TG_MULTIPLE_DRAG_DRAGGING_CLASS,
            ]).size,
        ).toBe(8);
    });
});

/* ==========================================================================
 * getMultiDragElements — DOCUMENT-WIDE
 * ========================================================================== */

describe('getMultiDragElements', () => {
    it('reports every selected element in document order, from the ambient document', () => {
        const fixture = buildFixture();

        expect(idsOf(getMultiDragElements())).toEqual(['1', '2', '3', '4', '6']);
        expect(fixture.container.children).toHaveLength(6);
    });

    it('is document-wide, not container-scoped', () => {
        // The selection is deliberately split across two unrelated subtrees. A
        // container-scoped query would report only part of it; this one must
        // report all of it, which is what both drag-end handlers depend on after
        // elements have moved between the backlog body and a sprint table.
        const fixture = buildFixture();
        fixture.target.appendChild(rowOf(fixture, '6'));

        expect(idsOf(getMultiDragElements())).toEqual(['1', '2', '3', '4', '6']);
    });

    it('accepts an explicit search root', () => {
        const fixture = buildFixture();
        fixture.target.appendChild(rowOf(fixture, '6'));

        expect(idsOf(getMultiDragElements(fixture.target))).toEqual(['6']);
        expect(idsOf(getMultiDragElements(fixture.container))).toEqual(['1', '2', '3', '4']);
    });

    it('returns an empty list when nothing is selected', () => {
        const lonely = makeRow(document, '9', false, { top: 0, left: 0, width: 1, height: 1 });
        document.body.appendChild(lonely);

        expect(getMultiDragElements()).toHaveLength(0);
    });

    it('returns a plain array whose first entry is the first selected element', () => {
        // Hazard H4. Upstream returned a query collection (INCUMBENT:219-221) and
        // both AngularJS handlers read exactly two things off it — `.length` and
        // `[0]` — at `app/coffee/modules/kanban/sortable.coffee` L76-L79 and
        // L111-L115 and at `app/coffee/modules/backlog/sortable.coffee` L79-L81 and
        // L106-L112. A real array satisfies both, which is why the published
        // contract is `readonly HTMLElement[]` in document order rather than a
        // collection object.
        const fixture = buildFixture();
        const selected = getMultiDragElements();

        expect(Array.isArray(selected)).toBe(true);
        expect(selected.length).toBe(5);
        expect(selected[0]).toBe(rowOf(fixture, '1'));

        // The consumers' single-item fallback, ported line for line from
        // `if !dragMultipleItems.length then dragMultipleItems = [item]`. It has to
        // compile and behave with no adaptation at all — that is the whole point of
        // the array contract.
        const items: readonly HTMLElement[] = selected.length > 0 ? selected : [fixture.main];

        expect(items[0]).toBe(rowOf(fixture, '1'));

        // With the screen's selection cleared the same expression falls through to
        // the grabbed element, which is what makes a single-item drag work.
        for (const id of ['1', '2', '3', '4', '6']) {
            rowOf(fixture, id).classList.remove(MULTIPLE_SORTABLE_CLASS);
        }

        const emptied = getMultiDragElements();
        const fallback: readonly HTMLElement[] = emptied.length > 0 ? emptied : [fixture.main];

        expect(emptied).toHaveLength(0);
        expect(fallback).toEqual([fixture.main]);
    });
});

/* ==========================================================================
 * isMultiDrag — CONTAINER-SCOPED
 * ========================================================================== */

describe('isMultiDrag', () => {
    it('is true when the grabbed element is selected and the scope holds more than one', () => {
        const fixture = buildFixture();

        expect(isMultiDrag(fixture.main, fixture.container)).toBe(true);
    });

    it('is false when the grabbed element is not itself selected', () => {
        // Grabbing an unselected row while others are selected stays a
        // single-item drag, which is the behaviour today.
        const fixture = buildFixture();

        expect(isMultiDrag(rowOf(fixture, '5'), fixture.container)).toBe(false);
    });

    it('is false when only one element is selected in the scope', () => {
        const fixture = buildFixture();

        for (const id of ['1', '2', '4', '6']) {
            rowOf(fixture, id).classList.remove(MULTIPLE_SORTABLE_CLASS);
        }

        expect(isMultiDrag(fixture.main, fixture.container)).toBe(false);
    });

    it('is container-scoped: a selection outside the scope does not count', () => {
        const fixture = buildFixture();
        const outside = fixture.target;

        for (const id of ['1', '2', '4', '6']) {
            outside.appendChild(rowOf(fixture, id));
        }

        // Five elements are selected document-wide, but only one of them lives in
        // the scope, so this is not a multi-drag from that scope.
        expect(getMultiDragElements()).toHaveLength(5);
        expect(isMultiDrag(fixture.main, fixture.container)).toBe(false);
        expect(isMultiDrag(rowOf(fixture, '1'), outside)).toBe(true);
    });

    it('accepts the board\u2019s array of containers as well as a single element', () => {
        // The two call sites disagree on this argument and jQuery absorbed the
        // difference: the board passes an array of columns, the story list passes
        // one element.
        const fixture = buildFixture();
        const second = fixture.target;
        second.appendChild(rowOf(fixture, '6'));

        expect(isMultiDrag(fixture.main, [fixture.container, second])).toBe(true);
        expect(isMultiDrag(rowOf(fixture, '6'), [second])).toBe(false);
        expect(isMultiDrag(rowOf(fixture, '6'), [second, fixture.container])).toBe(true);
    });

    it('ignores elements that are not HTML elements', () => {
        // A namespaced element carrying the same class has no border-box metrics
        // and no inline display to record, so it must never enter the selection.
        const container = document.createElement('div');
        const row = makeRow(document, '1', true, { top: 0, left: 0, width: 10, height: 10 });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

        svg.setAttribute('class', MULTIPLE_SORTABLE_CLASS);
        container.append(row, svg);
        document.body.appendChild(container);

        expect(container.querySelectorAll(`.${MULTIPLE_SORTABLE_CLASS}`)).toHaveLength(2);
        expect(isMultiDrag(row, container)).toBe(false);
    });

    it('searches DESCENDANTS, not direct children only', () => {
        // Upstream this is `$(container).find('.' + multipleSortableClass)`
        // (INCUMBENT:96), and jQuery's `.find()` is a descendant search. The story
        // list depends on it: the sidebar the drag library registers holds
        // `div.sprint-table` (`app/partials/backlog/sprint.jade` L13), and the
        // selected rows sit INSIDE that table (L17), two levels below the scope. A
        // children-only query would report zero selected rows from the sidebar and
        // silently downgrade every sprint drag to a single-item drag.
        const table = buildStoryTableFixture();
        const firstSprintRow = at(table.sprintRows, 0, 'sprint row');

        // Neither selected row is a CHILD of the scope handed over.
        expect(Array.from(table.sidebar.children)).toEqual([table.sprintTable]);
        expect(isMultiDrag(firstSprintRow, table.sidebar)).toBe(true);

        // The same holds one level down, from the table itself.
        expect(isMultiDrag(firstSprintRow, table.sprintTable)).toBe(true);
    });

    it('counts a selection split across the board\u2019s array of containers', () => {
        // The board hands over one scope per column: `containers` is built by
        // mapping every `.taskboard-column` at
        // `app/coffee/modules/kanban/sortable.coffee` L172-L175 and passed at L87.
        // Each column below holds exactly ONE selected card, so the "more than one
        // is selected" test of INCUMBENT:98 can only pass if EVERY scope in the
        // array is searched and the results are summed.
        const left = makeColumn('7', '3');
        const right = makeColumn('8', '3');
        const leftCard = makeCard('101', true, CARD_BOX);
        const rightCard = makeCard('201', true, CARD_BOX);

        left.appendChild(leftCard);
        right.appendChild(rightCard);
        document.body.append(left, right);

        expect(isMultiDrag(leftCard, left)).toBe(false);
        expect(isMultiDrag(leftCard, right)).toBe(false);
        expect(isMultiDrag(leftCard, [left, right])).toBe(true);
        expect(isMultiDrag(rightCard, [left, right])).toBe(true);
    });

    it('never mutates the document', () => {
        // A pure query. It is called from the drag library's `moves`/`drag` path
        // before any gesture state exists, so a stray class or attribute write here
        // would decorate the board before the user has moved the pointer at all.
        // The comparison is a plain string equality on the serialised body, not a
        // stored snapshot.
        const fixture = buildFixture();
        const before = document.body.innerHTML;

        expect(isMultiDrag(fixture.main, fixture.container)).toBe(true);
        expect(isMultiDrag(rowOf(fixture, '5'), fixture.container)).toBe(false);
        expect(isMultiDrag(fixture.main, [fixture.container, fixture.target])).toBe(true);
        expect(getMultiDragElements()).toHaveLength(5);

        expect(document.body.innerHTML).toBe(before);
    });
});

/* ==========================================================================
 * THE CONTROLLER — ARMING AND PREPARATION
 * ========================================================================== */

/** Creates a controller and arms the standard fixture's primary row. */
const arm = (
    fixture: Fixture,
    container: MultiDragContainer = fixture.container,
    options?: CreateMultiDragOptions,
): MultiDragController => {
    const controller: MultiDragController = makeController(options);

    controller.start(fixture.main, container);

    return controller;
};

describe('createMultiDrag: arming and preparation', () => {
    it('does nothing at all when the gesture is not a multi-drag', () => {
        const fixture = buildFixture();
        const controller = makeController();

        controller.start(rowOf(fixture, '5'), fixture.container);
        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
        expect(controller.stop()).toHaveLength(0);
    });

    it('arms on start but only builds the gesture on the first movement', () => {
        // Upstream, `start` merely attaches the listener; the preparation runs
        // inside it. A click that never moves therefore produces no ghosts at all,
        // and that is the behaviour preserved here.
        const fixture = buildFixture();
        const controller = arm(fixture);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);

        move(document);

        expect(controller.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);
    });

    it('marks the primary element and hides every other selected element', () => {
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        expect(fixture.main.classList.contains(MAIN_DRAG_CLASS)).toBe(true);
        expect(fixture.main.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
        expect(fixture.main.style.display).toBe('');

        for (const id of ['1', '2', '4', '6']) {
            const row = rowOf(fixture, id);

            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(true);
            expect(row.style.display).toBe('none');
            expect(row.classList.contains(MAIN_DRAG_CLASS)).toBe(false);
        }

        // The unselected row is untouched throughout.
        expect(rowOf(fixture, '5').style.display).toBe('');
        expect(rowOf(fixture, '5').className).toBe('row');
    });

    it('decorates every clone with both mirror classes and leaves the original undeleted', () => {
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        const clones = clonesIn(document);

        expect(idsOf(clones)).toEqual(['1', '2', '4', '6']);

        for (const clone of clones) {
            expect(clone.classList.contains(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(true);
            expect(clone.classList.contains(TG_MULTIPLE_DRAG_MIRROR_CLASS)).toBe(true);
            expect(clone.parentElement).toBe(document.body);
        }

        // The clones are copies; the originals stay where they were.
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('sizes every clone from the PRIMARY element\u2019s width and its OWN height', () => {
        // Upstream reads the width off the primary element and the height off each
        // item, so the stack is as wide as the card being dragged while each ghost
        // keeps its own height. Mixing those two sources up is invisible until two
        // selected rows differ in size.
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        const expectedHeights: Readonly<Record<string, string>> = {
            '1': '30px',
            '2': '31px',
            '4': '32px',
            '6': '34px',
        };

        for (const clone of clonesIn(document)) {
            const id = clone.dataset.id ?? '';

            expect(clone.style.width).toBe(`${MAIN_WIDTH}px`);
            expect(clone.style.height).toBe(expectedHeights[id]);
            expect(clone.style.position).toBe('fixed');
            expect(clone.style.zIndex).toBe('9999');
            expect(clone.style.opacity).toBe('0.8');
        }
    });

    it('writes no data attribute on to the document, using weak maps instead', () => {
        // jQuery's programmatic `.data()` writes went to an internal cache and never
        // to a `data-*` attribute (INCUMBENT:142-143, :148, :155, :175-:176), so the
        // faithful port is a WeakMap. This also keeps the T1 attribute contract
        // intact: `data-id` is the screens' own, and it is the ONLY data attribute
        // any of these elements may carry.
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        for (const id of ['1', '2', '3', '4', '5', '6']) {
            const row = rowOf(fixture, id);

            expect(dataAttributesOf(row)).toEqual(['data-id']);

            // Named literally, because these are the two spellings a port that
            // reached for `dataset` instead of a WeakMap would produce.
            expect(row.hasAttribute('data-drag-multiple-index')).toBe(false);
            expect(row.dataset.dragMultipleIndex).toBeUndefined();
            expect(row.dataset.dragMultipleActive).toBeUndefined();
        }

        for (const clone of clonesIn(document)) {
            expect(dataAttributesOf(clone)).toEqual(['data-id']);
            expect(clone.hasAttribute('data-drag-multiple-index')).toBe(false);
            expect(clone.dataset.dragMultipleIndex).toBeUndefined();
        }
    });

    it('excludes the primary element from the clone set and appends the ghosts to the body', () => {
        // INCUMBENT:163-165 filters the clone set by `main-drag-item`, so the
        // grabbed element is never cloned — it is the element the drag library is
        // already flying. INCUMBENT:194 then appends every ghost to the document
        // BODY rather than to the container: the ghosts are `position: fixed`, so
        // living inside a scrolled column would offset them by the scroll position
        // and, on the board, clip them at the column's overflow boundary.
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        const clones = clonesIn(document);

        expect(clones).toHaveLength(4);
        expect(clones.some((clone) => clone === fixture.main)).toBe(false);
        expect(clones.some((clone) => clone.dataset.id === '3')).toBe(false);

        for (const clone of clones) {
            expect(clone.classList.contains(MAIN_DRAG_CLASS)).toBe(false);
            expect(clone.parentElement).toBe(document.body);
            expect(fixture.container.contains(clone)).toBe(false);
        }

        // The container still holds its own six rows and nothing more.
        expect(fixture.container.children).toHaveLength(6);
        expect(fixture.main.parentElement).toBe(fixture.container);
    });
});

/* ==========================================================================
 * THE NUMBERING AND THE STACKING ARITHMETIC
 * ========================================================================== */

describe('createMultiDrag: numbering and stacking', () => {
    it('stacks the ghosts at the DRAG IMAGE\u2019s pitch, nearest-first above the primary', () => {
        // Numbering for the fixture: 1 -> -2, 2 -> -1, 3 -> 0, 4 -> +1, 6 -> +2.
        // Offsets are therefore mirrorTop + index * mirrorHeight, using the drag
        // image's height and NOT each clone's own height, and mirrorLeft for all.
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        const tops: Readonly<Record<string, string>> = {
            '1': `${MIRROR_BOX.top - 2 * MIRROR_BOX.height}px`,
            '2': `${MIRROR_BOX.top - MIRROR_BOX.height}px`,
            '4': `${MIRROR_BOX.top + MIRROR_BOX.height}px`,
            '6': `${MIRROR_BOX.top + 2 * MIRROR_BOX.height}px`,
        };

        expect(tops).toEqual({ '1': '20px', '2': '60px', '4': '140px', '6': '180px' });

        for (const clone of clonesIn(document)) {
            const id = clone.dataset.id ?? '';

            expect(clone.style.top).toBe(tops[id]);
            expect(clone.style.left).toBe(`${MIRROR_BOX.left}px`);

            // The pitch is the DRAG IMAGE's height and not this ghost's own, and
            // the fixture proves it: every ghost was given a different height, none
            // of them the drag image's. A port that stepped by each ghost's own
            // height would put all four in different places from the four above.
            expect(clone.style.height).not.toBe(`${MIRROR_BOX.height}px`);
        }
    });

    it('follows the drag image on every subsequent movement', () => {
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        stubBox(fixture.mirror, { top: 300, left: 90, width: 200, height: 40 });
        move(document);

        // Still four clones: the preparation runs once, the positioning every time.
        const clones = clonesIn(document);

        expect(clones).toHaveLength(4);

        for (const clone of clones) {
            expect(clone.style.left).toBe('90px');
        }

        expect(clones[0]?.style.top).toBe('220px');
        expect(clones[3]?.style.top).toBe('380px');
    });

    it('numbers relative to the grabbed element, not to the list', () => {
        // Grabbing the FIRST selected row leaves nothing above it, so every offset
        // must be positive and ascending.
        const fixture = buildFixture();
        const controller = makeController();

        controller.start(rowOf(fixture, '1'), fixture.container);
        move(document);

        const tops = clonesIn(document).map((clone) => clone.style.top);

        expect(idsOf(clonesIn(document))).toEqual(['2', '3', '4', '6']);
        expect(tops).toEqual(['140px', '180px', '220px', '260px']);
    });

    it('restores document order across several containers and de-duplicates overlaps', () => {
        // The scopes are passed OUT of document order and the inner one is nested
        // inside the outer one, so its selected child is found twice. If either the
        // de-duplication or the re-ordering were missing, the numbering below would
        // come out differently.
        const outer = document.createElement('div');
        const inner = document.createElement('div');
        const first = makeRow(document, 'a', true, { top: 0, left: 0, width: 90, height: 20 });
        const second = makeRow(document, 'b', true, { top: 0, left: 0, width: 91, height: 21 });
        const third = makeRow(document, 'c', true, { top: 0, left: 0, width: 92, height: 22 });
        const mirror = document.createElement('div');

        mirror.className = MIRROR_CLASS;
        stubBox(mirror, { top: 0, left: 0, width: 10, height: 10 });

        inner.appendChild(second);
        outer.append(first, inner, third);
        document.body.append(outer, mirror);

        const controller = makeController();

        controller.start(first, [inner, outer]);
        move(document);

        // `first` is the primary element, so `b` must be +1 and `c` must be +2.
        const clones = clonesIn(document);

        expect(idsOf(clones)).toEqual(['b', 'c']);
        expect(clones.map((clone) => clone.style.top)).toEqual(['10px', '20px']);
    });
});

/* ==========================================================================
 * THE TRANSIT CLASS — FINDING C, THE SILENT-FAILURE CLASS
 * ========================================================================== */

describe('createMultiDrag: the multi-item transit class', () => {
    it('marks every transit gap as a multi-item gap, document-wide', () => {
        const fixture = buildFixture();
        const secondTransit = document.createElement('div');

        secondTransit.className = TRANSIT_CLASS;
        fixture.target.appendChild(secondTransit);

        arm(fixture);
        move(document);

        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);
        expect(secondTransit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);
    });

    it('marks a transit gap that only appears part-way through the gesture', () => {
        // The class is re-applied on every movement, which is what keeps it correct
        // when the drag library replaces the transit element mid-gesture.
        const fixture = buildFixture();

        fixture.transit.classList.remove(TRANSIT_CLASS);
        arm(fixture);
        move(document);

        expect(document.querySelectorAll(`.${TRANSIT_MULTI_CLASS}`)).toHaveLength(0);

        fixture.transit.classList.add(TRANSIT_CLASS);
        move(document);

        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);
    });

    it('does not throw and moves nothing when there is no drag image', () => {
        // Upstream this raises a type error, because INCUMBENT:28 calls a jQuery
        // reader on an empty collection. Returning quietly is what this module's
        // brief asks for, and it is a defensive requirement rather than a
        // behavioural change: the drag provider may not have mounted its overlay by
        // the time the first movement arrives.
        const fixture = buildFixture();

        fixture.mirror.remove();
        arm(fixture);

        expect(() => move(document)).not.toThrow();

        // The gesture is live and the ghosts exist, but nothing was positioned.
        expect(clonesIn(document)).toHaveLength(4);
        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        for (const clone of clonesIn(document)) {
            expect(clone.style.top).toBe('');
        }
    });

    it('removes the multi-item class from every carrier when the gesture ends', () => {
        // Step 9 of the teardown (INCUMBENT:64) is document-wide, and it has to be:
        // by the time a drag ends, the transit gap may sit in a container the
        // gesture never started from. Left behind, the class would keep
        // `.card-inner` hidden and the multi-select ring suppressed for good
        // (`app/styles/modules/kanban/kanban-table.scss:305` and :359-:365).
        const fixture = buildFixture();
        const secondTransit = document.createElement('div');
        const controller = arm(fixture);

        secondTransit.className = TRANSIT_CLASS;
        fixture.target.appendChild(secondTransit);

        move(document);

        expect(carriersOf(TRANSIT_MULTI_CLASS)).toBe(2);

        controller.stop();

        expect(carriersOf(TRANSIT_MULTI_CLASS)).toBe(0);
        expect(fixture.transit.classList.contains(TRANSIT_CLASS)).toBe(true);
        expect(secondTransit.classList.contains(TRANSIT_CLASS)).toBe(true);
    });
});

/* ==========================================================================
 * THE CARD GHOST STACK — THE ONE CONTRACT WITH TWO VISUALS ON IT
 * ==========================================================================
 * `.card-transit-multi` is a permanent part of the card markup and is
 * `display: none` by default (`app/styles/modules/kanban/kanban-table.scss:320`).
 * The ONLY thing that reveals it is `.card.gu-transit-multi`, at :359-:365, which
 * simultaneously hides `.card-inner`; and the very same class withdraws the
 * multi-select ring at :305 through `&.card:not(.gu-transit-multi)`. So this single
 * class drives TWO visuals, and getting its timing wrong breaks both at once:
 * added late, the ring lingers through the drag and the ghost stack never appears;
 * removed late, the stack outlives the gesture and the card stays blank.
 *
 * Reproduced here against the real card markup, because that is the only place the
 * contract is observable. Note the provenance: the ghost shape comes from
 * `app/modules/components/card/card.jade` L45-L55 and the stylesheet, NEVER from a
 * Figma frame — neither attached frame captures any drag state at all (drift
 * register entry D4).
 */

describe('the card ghost stack', () => {
    it('holds exactly two ghost blocks, each an image beside two lines of text', () => {
        // Risk R-DND-1, spelled out: TWO `.fake-us` blocks. Not one, and not one per
        // selected card — the stack is a fixed decorative hint, and
        // `kanban-table.scss:330` styles `.fake-us` with a `:last-child` margin
        // reset that assumes exactly two.
        const board = buildBoardFixture();

        expect(board.main.querySelectorAll('.card-transit-multi')).toHaveLength(1);
        expect(board.main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(2);

        // It is a TOP-LEVEL SIBLING of `.card-inner`, not a child of it: the reveal
        // rule hides `.card-inner` while showing the stack, so nesting the stack
        // inside it would hide the stack too.
        expect(board.ghost.parentElement).toBe(board.main);
        expect(board.main.querySelector('.card-inner')?.contains(board.ghost)).toBe(false);

        for (const fakeUs of Array.from(
            board.main.querySelectorAll('.card-transit-multi > .fake-us'),
        )) {
            expect(fakeUs.querySelectorAll('.fake-img')).toHaveLength(1);
            expect(fakeUs.querySelectorAll('.column')).toHaveLength(1);
            expect(fakeUs.querySelectorAll('.column > .fake-text')).toHaveLength(2);
        }
    });

    it('reveals the stack for the duration of the gesture and no longer', () => {
        const board = buildBoardFixture();
        const controller = makeController();

        // Before: the card is selected and the ring is showing, because the card
        // does not yet carry the multi-item class.
        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        controller.start(board.main, [board.column]);

        // Arming alone reveals nothing: the class is applied by `drag()`, on the
        // first movement (INCUMBENT:32).
        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        move(document);

        // During: the stack is revealed and the ring is withdrawn, both by this one
        // class, and both without the module touching the screen's own classes.
        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);
        expect(board.main.classList.contains(TRANSIT_CLASS)).toBe(true);
        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
        expect(board.main.classList.contains('card')).toBe(true);

        controller.stop();

        // After: back to the idle appearance, with the stack hidden again and the
        // ring restored.
        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);
        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
    });

    it('never creates, moves or removes the ghost markup', () => {
        // The module's job is to toggle one class. The markup belongs to
        // `../../kanban/KanbanCard.tsx`, reproduced from the T4-PROTECTED
        // `card.jade` L45-L55, and a module that built its own copy would double the
        // stack on every gesture.
        const board = buildBoardFixture();
        const controller = makeController();
        const markupBefore = board.ghost.outerHTML;

        controller.start(board.main, [board.column]);
        move(document);
        move(document);

        expect(board.main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(2);
        expect(board.ghost.outerHTML).toBe(markupBefore);
        expect(board.ghost.parentElement).toBe(board.main);

        controller.stop();

        expect(board.main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(2);
        expect(board.ghost.outerHTML).toBe(markupBefore);
        expect(board.ghost.isConnected).toBe(true);
    });

    it('carries the stack into every ghost clone, because the clone is deep', () => {
        // `cloneNode(true)` ports jQuery's `.clone(true)` (INCUMBENT:170), so each
        // flying ghost is a complete card including its own hidden stack. The clones
        // are the elements the user actually sees during a multi-drag, so this is
        // what makes them look like cards rather than empty boxes.
        const board = buildBoardFixture();
        const controller = makeController();

        controller.start(board.main, [board.column]);
        move(document);

        const clones = clonesIn(document);

        expect(idsOf(clones)).toEqual(['101', '104']);

        for (const clone of clones) {
            expect(clone.tagName.toLowerCase()).toBe('tg-card');
            expect(clone.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(2);
            expect(clone.querySelectorAll('.card-inner')).toHaveLength(1);

            // The clone is a copy of a card that was NOT the transit gap, so it
            // carries neither the transit class nor the primary marker.
            expect(clone.classList.contains(TRANSIT_CLASS)).toBe(false);
            expect(clone.classList.contains(MAIN_DRAG_CLASS)).toBe(false);
        }

        controller.stop();

        // Step 6 deletes the clones outright, stacks and all.
        expect(clonesIn(document)).toHaveLength(0);
        expect(document.querySelectorAll('.card-transit-multi')).toHaveLength(4);
    });
});

/* ==========================================================================
 * THE CONTAINER SHAPES THE TWO SCREENS HAND OVER
 * ==========================================================================
 * The two AngularJS call sites disagree about the container argument, and the
 * markup on either side of them differs too. Neither difference may reach this
 * module as a special case: it normalises the argument and searches descendants,
 * and that is all.
 */

describe('the container shapes the two screens hand over', () => {
    it('treats the swimlane column and the flat-mode column alike', () => {
        // `app/partials/includes/modules/kanban-table.jade` L112-L121 renders the
        // swimlane container with BOTH `data-status` and `data-swimlane`; L189-L197
        // renders the flat-mode container with `data-status` ONLY. The module reads
        // neither, so both must behave identically — and the attributes must survive
        // the gesture untouched, since the board's own handlers read them.
        const swimlaneColumn = makeColumn('7', '3');
        const flatColumn = makeColumn('9');
        const swimlaneCards = [makeCard('101', true, CARD_BOX), makeCard('102', true, CARD_BOX)];
        const flatCards = [makeCard('201', true, CARD_BOX), makeCard('202', true, CARD_BOX)];
        const mirror = document.createElement('div');

        for (const card of swimlaneCards) {
            swimlaneColumn.appendChild(card);
        }

        for (const card of flatCards) {
            flatColumn.appendChild(card);
        }

        mirror.className = MIRROR_CLASS;
        stubBox(mirror, MIRROR_BOX);
        document.body.append(swimlaneColumn, flatColumn, mirror);

        expect(swimlaneColumn.dataset.swimlane).toBe('3');
        expect(flatColumn.dataset.swimlane).toBeUndefined();
        expect(flatColumn.dataset.status).toBe('9');

        const swimlaneMain = at(swimlaneCards, 0, 'swimlane card');
        const flatMain = at(flatCards, 0, 'flat-mode card');

        expect(isMultiDrag(swimlaneMain, swimlaneColumn)).toBe(true);
        expect(isMultiDrag(flatMain, flatColumn)).toBe(true);

        const controller = makeController();

        controller.start(flatMain, [swimlaneColumn, flatColumn]);
        move(document);

        // One ghost per selected card except the grabbed one, drawn from BOTH
        // columns, and the columns' own attributes are untouched.
        expect(idsOf(clonesIn(document))).toEqual(['101', '102', '202']);
        expect(dataAttributesOf(swimlaneColumn)).toEqual(['data-status', 'data-swimlane']);
        expect(dataAttributesOf(flatColumn)).toEqual(['data-status']);

        controller.stop();

        expect(dataAttributesOf(swimlaneColumn)).toEqual(['data-status', 'data-swimlane']);
        expect(dataAttributesOf(flatColumn)).toEqual(['data-status']);
    });

    it('never mistakes the story-table header row for a story row', () => {
        // THE HEADER TRAP: `app/partials/includes/modules/backlog-table.jade` L8-L9
        // renders `div.row.backlog-table-title`, which carries the class `row` —
        // exactly what the drag library's own `moves` gate keys on at
        // `app/coffee/modules/backlog/sortable.coffee` L44-L47 — while sitting in
        // `.backlog-table-header`, OUTSIDE the `.backlog-table-body` registered as
        // the container at L19. Selection is keyed on `ui-multisortable-multiple`,
        // which the header never carries, so it can never join a selection.
        const table = buildStoryTableFixture();
        const firstRow = at(table.bodyRows, 0, 'story row');
        const controller = makeController();

        expect(table.headerRow.classList.contains('row')).toBe(true);
        expect(table.header.contains(table.headerRow)).toBe(true);
        expect(table.body.contains(table.headerRow)).toBe(false);

        expect(idsOf(getMultiDragElements())).toEqual(['201', '202', '301', '302']);
        expect(isMultiDrag(firstRow, table.body)).toBe(true);
        expect(isMultiDrag(table.headerRow, table.body)).toBe(false);

        controller.start(firstRow, table.body);
        move(document);

        // Only the second selected body row is cloned, and the header row is left
        // exactly as the screen rendered it.
        expect(idsOf(clonesIn(document))).toEqual(['202']);
        expect(table.headerRow.className).toBe('row backlog-table-title');
        expect(table.headerRow.hasAttribute('style')).toBe(false);

        controller.stop();

        expect(table.headerRow.className).toBe('row backlog-table-title');
    });

    it('drags a selection out of a nested sprint table', () => {
        // `app/partials/backlog/sprint.jade` L13 and L17: the selected rows sit
        // inside `div.sprint-table`, which the drag library recognises through
        // `isContainer` at `.../backlog/sortable.coffee` L42 and hands over as a
        // SINGLE element (L77). The rows are two levels below the sidebar.
        const table = buildStoryTableFixture();
        const firstSprintRow = at(table.sprintRows, 0, 'sprint row');
        const controller = makeController();

        controller.start(firstSprintRow, table.sidebar);
        move(document);

        expect(controller.inProgress).toBe(true);
        expect(idsOf(clonesIn(document))).toEqual(['302']);
        expect(firstSprintRow.classList.contains(MAIN_DRAG_CLASS)).toBe(true);
        expect(at(table.sprintRows, 1, 'sprint row').style.display).toBe('none');

        // The rows of the OTHER table are untouched: the scope was the sidebar.
        for (const row of table.bodyRows) {
            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
        }

        // The report at step 10 is document-wide, so it spans both tables.
        expect(idsOf(controller.stop())).toEqual(['201', '202', '301', '302']);
        expect(at(table.sprintRows, 1, 'sprint row').style.display).toBe('');
    });
});

/* ==========================================================================
 * THE TEN-STEP TEARDOWN
 * ========================================================================== */

describe('createMultiDrag: stop', () => {
    it('returns an empty list and touches nothing when no gesture is in progress', () => {
        const fixture = buildFixture();
        const controller = makeController();

        expect(controller.stop()).toEqual([]);
        expect(controller.inProgress).toBe(false);
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
    });

    it('leaves the armed listener in place when it runs before the first movement', () => {
        // Upstream the listener reference is still unset at that point, because it is
        // only assigned INSIDE the handler (INCUMBENT:206), so the removal at
        // INCUMBENT:51 is a no-op and the listener survives. The observable outcome is
        // preserved exactly: a later movement still builds the gesture.
        //
        // This is deliberately NOT "a stop always disarms": rule T10 forbids
        // functional change, and disarming here would be one. The inert-after-stop
        // behaviour applies once a gesture has actually begun, which is asserted
        // separately by "removes the movement listener, so a later movement rebuilds
        // nothing" and counted by "holds exactly ONE movement listener at a time".
        const fixture = buildFixture();
        const controller = arm(fixture);

        expect(controller.stop()).toEqual([]);

        move(document);

        expect(controller.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);
    });

    it('reports the selection in document order, with the first selected element first', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        const reported = controller.stop();

        // Hazard H4: both consumers read only `.length` and `[0]`.
        expect(idsOf(reported)).toEqual(['1', '2', '3', '4', '6']);
        expect(reported[0]).toBe(rowOf(fixture, '1'));
        expect(reported).toHaveLength(5);
    });

    it('undoes every decoration it applied, and deletes the ghosts outright', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        const ghosts = clonesIn(document);

        expect(ghosts).toHaveLength(4);

        controller.stop();

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);

        // Step 6 (INCUMBENT:57) DELETES the nodes; it does not merely take the class
        // off them. Holding the references and checking that each one has left the
        // document is the difference between the two, and it matters: an undecorated
        // but still-attached `position: fixed` ghost would sit on the board for ever.
        for (const ghost of ghosts) {
            expect(ghost.isConnected).toBe(false);
            expect(ghost.parentElement).toBeNull();
        }
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${MULTIPLE_DRAG_MIRROR_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${TG_MULTIPLE_DRAG_DRAGGING_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${TRANSIT_MULTI_CLASS}`)).toHaveLength(0);

        // The selection itself is REPORTED, never cleared: that class belongs to
        // the screens.
        expect(document.querySelectorAll(`.${MULTIPLE_SORTABLE_CLASS}`)).toHaveLength(5);
    });

    it('strips the mirror decoration from a carrier that is NOT one of its ghosts', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        // The backlog screen's own drag handler decorates the DRAG MIRROR with
        // `multiple-drag-mirror` (`app/coffee/modules/backlog/sortable.coffee`
        // L91-L92, retained at `../../backlog/hooks/useStoryDrag.ts:136-:137`), and
        // that element is not one of this module's ghosts. Step 7 of the teardown is
        // therefore document-wide and genuinely distinct from step 6: step 6 deletes
        // the ghosts, step 7 cleans every OTHER carrier. Were step 7 scoped to the
        // ghosts, the mirror would keep the class — and `.multiple-drag-mirror` is a
        // live rule at `app/styles/layout/backlog.scss:154`, so the stale decoration
        // would be visible.
        fixture.mirror.classList.add(MULTIPLE_DRAG_MIRROR_CLASS);

        move(document);

        controller.stop();

        expect(fixture.mirror.isConnected).toBe(true);
        expect(fixture.mirror.classList.contains(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);

        // ... and it still carries the drag-image class, which this module only ever
        // reads.
        expect(fixture.mirror.classList.contains(MIRROR_CLASS)).toBe(true);
    });

    it('restores the exact inline display each hidden element had before', () => {
        // Step 8 of the teardown ends in jQuery's `.show()` (INCUMBENT:62), which
        // puts back the PRE-HIDE inline value rather than clearing the property. A
        // story row laid out as a flex row is the case that makes the difference
        // visible: reset to the empty string and it falls back to whatever the
        // stylesheet says, which is not necessarily what the markup had set.
        const fixture = buildFixture();
        const withFlex = rowOf(fixture, '1');
        const withInlineBlock = rowOf(fixture, '2');
        const withoutInline = rowOf(fixture, '4');

        withFlex.style.display = 'flex';
        withInlineBlock.style.display = 'inline-block';

        const controller = arm(fixture);

        move(document);
        expect(withFlex.style.display).toBe('none');
        expect(withInlineBlock.style.display).toBe('none');
        expect(withoutInline.style.display).toBe('none');

        controller.stop();

        // A naive reset to the empty string would lose both declared values.
        expect(withFlex.style.display).toBe('flex');
        expect(withInlineBlock.style.display).toBe('inline-block');

        // The row that had no inline display keeps none: the property is removed
        // outright, so the element declares nothing and falls back to the
        // stylesheet. (The now-empty `style` attribute itself is left behind by the
        // DOM, not by this module — removing a property does not remove the
        // attribute.)
        expect(withoutInline.style.display).toBe('');
        expect(withoutInline.style.length).toBe(0);
        expect(withoutInline.getAttribute('style')).toBe('');
    });

    it('puts the hidden elements back around the primary element, in order', () => {
        // Simulates the drop: the primary element lands in a different container
        // and every companion has to follow it, keeping the relative order of the
        // list it came from.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);
        expect(childIdsOf(fixture.container)).toEqual(['5']);
    });

    it('keeps the order when the primary element is the last selected one', () => {
        // Nothing follows the grabbed element, so every companion must be inserted
        // before it and the nearest-first negative numbering is what keeps them in
        // list order rather than reversed.
        const fixture = buildFixture();
        const main = rowOf(fixture, '6');
        const controller = makeController();

        controller.start(main, fixture.container);
        move(document);
        fixture.target.appendChild(main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);
        expect(childIdsOf(fixture.container)).toEqual(['5']);
    });

    it('keeps the order when the primary element is the FIRST selected one', () => {
        // The mirror image of the case above, and the one that discriminates the
        // `after.reverse()` of INCUMBENT:83. Nothing precedes the grabbed element,
        // so all four companions are inserted AFTER it, each landing immediately
        // after it — which means the LAST one inserted ends up nearest. Walking the
        // list backwards is therefore the only thing that leaves it ascending:
        // without the reversal these four would land as 6, 4, 3, 2, a silent
        // inversion with no error and no visual clue until the next page load
        // reveals the persisted order.
        const fixture = buildFixture();
        const main = rowOf(fixture, '1');
        const controller = makeController();

        controller.start(main, fixture.container);
        move(document);
        fixture.target.appendChild(main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);
        expect(childIdsOf(fixture.container)).toEqual(['5']);
    });

    it('reorders from the gesture snapshot, then deletes the ghosts and re-shows the rows', () => {
        // The ten steps are ORDER-SENSITIVE, and this asserts the consequences of
        // that order in one place. Step 2 reorders (INCUMBENT:49) using the gesture
        // snapshot that step 4 discards (INCUMBENT:54), step 6 deletes the ghosts
        // (INCUMBENT:57) and step 8 re-shows the originals (INCUMBENT:60-62). A
        // teardown that dropped the snapshot before reordering would leave the
        // companions behind in the source container, and one that re-showed before
        // reordering would flash them in the wrong place.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        // Reordered...
        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);

        // ...ghosts gone...
        expect(clonesIn(document)).toHaveLength(0);
        expect(carriersOf(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(0);

        // ...and every companion visible again, in its new home.
        for (const id of ['1', '2', '4', '6']) {
            const row = rowOf(fixture, id);

            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
            expect(row.parentElement).toBe(fixture.target);
        }
    });

    it('is idempotent: a second stop reports nothing and changes nothing', () => {
        // The board calls `stop()` from `dragend`
        // (`app/coffee/modules/kanban/sortable.coffee` L111) and the story list from
        // its own (`.../backlog/sortable.coffee` L106). A cancelled drag can deliver
        // that event more than once, and the second call must be inert rather than
        // half-undoing a teardown that already ran.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        expect(controller.stop()).toHaveLength(5);

        const settled = document.body.innerHTML;

        expect(() => controller.stop()).not.toThrow();
        expect(controller.stop()).toEqual([]);
        expect(controller.inProgress).toBe(false);
        expect(document.body.innerHTML).toBe(settled);
    });

    it('walks away from the reorder when the primary element has lost its number', () => {
        // INCUMBENT:70 READS the grabbed element's own number rather than assuming the
        // `0` that INCUMBENT:155 wrote, and the port keeps that read. The only thing
        // that can erase it is a consumer calling `reset` on the grabbed element while
        // the gesture is live, and the honest answer then is to measure nothing rather
        // than to guess an origin: an assumed `0` against a stale snapshot would
        // reinsert the companions around the wrong anchor and persist a wrong order
        // with no error to show for it (the position-relative write API turns a
        // client-side ordering mistake straight into bad data, AAP 0.8.3).
        //
        // The reorder alone opts out. Steps 3 to 10 of the teardown still run in full,
        // which is what the second half of this case pins down.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        controller.reset(fixture.main);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        // Nothing followed the primary element: every companion stayed put.
        expect(childIdsOf(fixture.target)).toEqual(['3']);
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '4', '5', '6']);

        // ...and yet the gesture is fully wound down: no ghosts, no leftover classes,
        // every hidden row visible again, nothing left in progress.
        expect(clonesIn(document)).toHaveLength(0);
        expect(carriersOf(MAIN_DRAG_CLASS)).toBe(0);
        expect(carriersOf(TRANSIT_MULTI_CLASS)).toBe(0);
        expect(controller.inProgress).toBe(false);

        for (const id of ['1', '2', '4', '6']) {
            const row = rowOf(fixture, id);

            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
        }
    });

    it('completes without throwing when the primary element has left the document', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        fixture.main.remove();

        expect(() => controller.stop()).not.toThrow();

        expect(clonesIn(document)).toHaveLength(0);
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '4', '5', '6']);
        expect(rowOf(fixture, '1').style.display).toBe('');
    });

    it('removes the movement listener, so a later movement rebuilds nothing', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        controller.stop();

        move(document);
        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
    });

    it('leaves the class contract untouched on a second, independent gesture', () => {
        const fixture = buildFixture();
        const first = arm(fixture);

        move(document);
        first.stop();

        const second = makeController();

        second.start(fixture.main, fixture.container);
        move(document);

        expect(clonesIn(document)).toHaveLength(4);
        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);

        second.stop();

        expect(clonesIn(document)).toHaveLength(0);
        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);
    });
});

/* ==========================================================================
 * EXACTLY ONE MOVEMENT LISTENER — HAZARD H3
 * ========================================================================== */

describe('createMultiDrag: listener discipline', () => {
    it('re-arming replaces the listener, so the NEW element becomes the primary one', () => {
        // This is the discriminating assertion for hazard H3. Upstream, arming
        // twice leaves two listeners attached and only remembers the last, so the
        // stale one runs first and prepares the PREVIOUS gesture's element. With
        // exactly one listener the new element wins, every time.
        const fixture = buildFixture();
        const controller = makeController();

        controller.start(rowOf(fixture, '1'), fixture.container);
        expect(controller.stop()).toEqual([]);

        controller.start(rowOf(fixture, '6'), fixture.container);
        move(document);

        expect(rowOf(fixture, '6').classList.contains(MAIN_DRAG_CLASS)).toBe(true);
        expect(rowOf(fixture, '1').classList.contains(MAIN_DRAG_CLASS)).toBe(false);
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(1);
    });

    it('destroy detaches the listener before the gesture ever begins', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        controller.destroy();
        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
    });

    it('destroy drops the gesture state and does no document cleanup', () => {
        // The documented division of labour: the ten-step teardown belongs to
        // `stop()`, which both consumers call from their drag-end handler before
        // the component unmounts. `destroy()` is the listener safety net.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        expect(controller.inProgress).toBe(true);

        controller.destroy();

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(4);
        expect(fixture.main.classList.contains(MAIN_DRAG_CLASS)).toBe(true);

        // With the state dropped, a subsequent stop is inert rather than partial.
        expect(controller.stop()).toEqual([]);
    });

    it('accepts the movement event name explicitly', () => {
        const fixture = buildFixture();
        const controller = arm(fixture, fixture.container, { moveEventName: 'mousemove' });

        move(document);

        expect(controller.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);
    });

    it('holds exactly ONE movement listener at a time, however often it is armed', () => {
        // Hazard H3, counted rather than inferred. Upstream attaches a fresh
        // anonymous listener on every `start()` (INCUMBENT:199) and remembers only
        // the last of them through the self-reference at INCUMBENT:206, so they
        // accumulate for the lifetime of the page and a stale one can re-enter
        // `prepare()` with a previous gesture's element and scope. Counting the
        // registrations on the element the module listens on is the direct proof
        // that this port attaches one and detaches exactly that one.
        //
        // The spies are installed with `jest.spyOn`, which `restoreMocks` in
        // `jest.config.js` puts back after the case — this file never calls
        // `jest.restoreAllMocks()` itself.
        const fixture = buildFixture();
        const attach = jest.spyOn(document.documentElement, 'addEventListener');
        const detach = jest.spyOn(document.documentElement, 'removeEventListener');
        const movementCalls = (calls: readonly (readonly unknown[])[]): number =>
            calls.filter((call) => call[0] === 'mousemove').length;
        const controller = makeController();

        controller.start(fixture.main, fixture.container);
        controller.start(fixture.main, fixture.container);
        controller.start(fixture.main, fixture.container);

        // Three arms: three attachments and two detachments, so exactly one listener
        // is live at every moment.
        expect(movementCalls(attach.mock.calls)).toBe(3);
        expect(movementCalls(detach.mock.calls)).toBe(2);

        move(document);

        // One listener means one preparation: four ghosts, not eight and not twelve.
        expect(clonesIn(document)).toHaveLength(4);

        controller.stop();

        // Step 3 of the teardown detaches the third and last one.
        expect(movementCalls(detach.mock.calls)).toBe(3);
        expect(movementCalls(attach.mock.calls)).toBe(3);

        move(document);
        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
    });
});

/* ==========================================================================
 * THE DELEGATING CONTROLLER METHODS
 * ========================================================================== */

describe('createMultiDrag: query methods', () => {
    it('getElements is document-wide and isMultiple is container-scoped', () => {
        const fixture = buildFixture();
        const controller = makeController();

        fixture.target.appendChild(rowOf(fixture, '6'));

        expect(idsOf(controller.getElements())).toEqual(['1', '2', '3', '4', '6']);
        expect(controller.isMultiple(fixture.main, fixture.container)).toBe(true);
        expect(controller.isMultiple(rowOf(fixture, '6'), fixture.target)).toBe(false);
    });

    it('reset strips this module\u2019s own decoration from one element', () => {
        // Transcribes INCUMBENT:15-22 in its order: the whole inline style
        // attribute, then `tg-multiple-drag-mirror`, then `multiple-drag-mirror`.
        // Note that it removes the ATTRIBUTE rather than clearing properties, so
        // nothing inline survives.
        const controller = makeController();
        const element = document.createElement('div');

        element.className = `row ${MULTIPLE_DRAG_MIRROR_CLASS} ${TG_MULTIPLE_DRAG_MIRROR_CLASS}`;
        element.setAttribute('style', 'position: fixed; top: 5px;');
        document.body.appendChild(element);

        controller.reset(element);

        expect(element.hasAttribute('style')).toBe(false);
        expect(element.className).toBe('row');
    });

    it('reset also clears the recorded numbering, not just the visible decoration', () => {
        // INCUMBENT:20-21 clears `dragMultipleIndex` and `dragMultipleActive`
        // alongside the style and the two classes. That bookkeeping lives in a
        // WeakMap rather than in an attribute — jQuery's programmatic `.data()`
        // wrote no attribute either — so it is asserted through the only thing that
        // reads it: `drag()` reads the index off the CLONE (INCUMBENT:35) and skips a
        // ghost that has none, so a reset ghost stops following the drag image while
        // its siblings carry on.
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        const clones = clonesIn(document);
        const abandoned = at(clones, 0, 'ghost clone');
        const survivor = at(clones, 1, 'ghost clone');

        // Numbering for the fixture: row 1 is -2 and row 2 is -1.
        expect(abandoned.style.top).toBe(`${MIRROR_BOX.top - 2 * MIRROR_BOX.height}px`);
        expect(survivor.style.top).toBe(`${MIRROR_BOX.top - MIRROR_BOX.height}px`);

        controller.reset(abandoned);

        expect(abandoned.hasAttribute('style')).toBe(false);
        expect(abandoned.classList.contains(TG_MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);
        expect(abandoned.classList.contains(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);

        // Move the drag image and let the gesture follow it.
        stubBox(fixture.mirror, { top: 500, left: 200, width: 200, height: 40 });
        move(document);

        // The survivor followed; the reset ghost has no number left to follow with,
        // so nothing was written back on to it at all.
        expect(survivor.style.top).toBe('460px');
        expect(survivor.style.left).toBe('200px');
        expect(abandoned.hasAttribute('style')).toBe(false);
    });

    it('never calls reset from the gesture lifecycle', () => {
        // Hazard H1: `reset` is dead upstream and stays dead here. If it were wired
        // into the lifecycle, the inline styles below would have been stripped and
        // the hidden originals would have reappeared mid-gesture.
        const fixture = buildFixture();

        arm(fixture);
        move(document);
        move(document);

        for (const clone of clonesIn(document)) {
            expect(clone.hasAttribute('style')).toBe(true);
            expect(clone.classList.contains(TG_MULTIPLE_DRAG_MIRROR_CLASS)).toBe(true);
        }

        for (const id of ['1', '2', '4', '6']) {
            expect(rowOf(fixture, id).style.display).toBe('none');
        }
    });

    it('reports inProgress live, across the whole gesture', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        expect(controller.inProgress).toBe(false);

        move(document);
        expect(controller.inProgress).toBe(true);

        move(document);
        expect(controller.inProgress).toBe(true);

        controller.stop();
        expect(controller.inProgress).toBe(false);
    });
});

/* ==========================================================================
 * THE INJECTED DOCUMENT
 * ========================================================================== */

describe('createMultiDrag: injected owner document', () => {
    it('queries, listens and appends entirely within the document it was given', () => {
        const other = document.implementation.createHTMLDocument('multi-drag-spec');
        const container = other.createElement('div');
        const rows = ['1', '2', '3'].map((id) =>
            makeRow(other, id, true, { top: 0, left: 0, width: 20, height: 20 }),
        );
        const mirror = other.createElement('div');

        mirror.className = MIRROR_CLASS;
        stubBox(mirror, { top: 50, left: 5, width: 20, height: 20 });

        for (const row of rows) {
            container.appendChild(row);
        }

        other.body.append(container, mirror);

        const main = rows[0];

        if (main === undefined) {
            throw new Error('detached fixture is missing its primary row');
        }

        stubBox(main, { top: 0, left: 0, width: 123, height: 20 });

        const controller = makeController({ ownerDocument: other });

        controller.start(main, container);
        other.documentElement.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

        // Everything happened over there, and nothing at all over here.
        expect(clonesIn(other)).toHaveLength(2);
        expect(clonesIn(document)).toHaveLength(0);
        expect(idsOf(getMultiDragElements(other))).toEqual(['1', '2', '3', '2', '3']);

        for (const clone of clonesIn(other)) {
            expect(clone.ownerDocument).toBe(other);
            expect(clone.parentElement).toBe(other.body);
            expect(clone.style.width).toBe('123px');
        }

        expect(idsOf(controller.stop())).toEqual(['1', '2', '3']);
        expect(clonesIn(other)).toHaveLength(0);
    });
});

/* ==========================================================================
 * ONE CONTROLLER PER SCREEN, WITH NO SHARED STATE
 * ==========================================================================
 * Upstream the helper is a single mutable global (INCUMBENT:223), so its
 * `inProgress` flag and its `items` snapshot were process-wide. The factory
 * replaces that with closure state, which is what lets each screen own an instance
 * and each specification case start from a clean one.
 */

describe('createMultiDrag: factory isolation', () => {
    it('gives every controller its own gesture state', () => {
        const fixture = buildFixture();
        const first = makeController();
        const second = makeController();

        first.start(fixture.main, fixture.container);
        move(document);

        // The gesture belongs to the controller that armed it, and only to it.
        expect(first.inProgress).toBe(true);
        expect(second.inProgress).toBe(false);

        // The idle controller's `stop()` is a no-op — it neither reports the other
        // controller's selection nor dismantles its gesture.
        expect(second.stop()).toEqual([]);
        expect(first.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);

        expect(first.stop()).toHaveLength(5);
        expect(first.inProgress).toBe(false);
        expect(second.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
    });

    it('keeps its own bookkeeping, so a second controller renumbers from scratch', () => {
        // Each instance owns its own WeakMaps. A controller that inherited another's
        // numbering would stack the ghosts against the wrong element, which is
        // exactly the class of bug a process-wide global invites.
        const fixture = buildFixture();
        const first = makeController();
        const second = makeController();

        first.start(rowOf(fixture, '1'), fixture.container);
        move(document);
        first.stop();

        second.start(rowOf(fixture, '6'), fixture.container);
        move(document);

        // Row 6 is now the primary element, so every companion is ABOVE it and the
        // offsets run nearest-first upwards: 4 is -1, 3 is -2, 2 is -3, 1 is -4.
        const tops = clonesIn(document).map((clone) => clone.style.top);

        expect(idsOf(clonesIn(document))).toEqual(['1', '2', '3', '4']);
        expect(tops).toEqual([
            `${MIRROR_BOX.top - 4 * MIRROR_BOX.height}px`,
            `${MIRROR_BOX.top - 3 * MIRROR_BOX.height}px`,
            `${MIRROR_BOX.top - 2 * MIRROR_BOX.height}px`,
            `${MIRROR_BOX.top - MIRROR_BOX.height}px`,
        ]);
    });
});

/* ==========================================================================
 * THE CLASSES THIS MODULE MUST NEVER TOUCH
 * ==========================================================================
 * Transformation rule T1 cuts both ways. This module has to APPLY the five class
 * names it owns, at the right moments, or the drag visuals silently disappear — and
 * it must never apply the ones it does not own, or a screen's own state is
 * fabricated behind its back. Both halves fail silently, so both are asserted.
 */

describe('classes this module must never apply', () => {
    it('reads the selection class and never assigns or clears it', () => {
        // `ui-multisortable-multiple` is the SCREENS' state. The board binds it at
        // `app/partials/includes/modules/kanban-table.jade` L154 (and L230 in flat
        // mode) to `ctrl.selectedUss[usId]`, and the story list toggles it at
        // `app/coffee/modules/backlog/main.coffee` L824 on the closest
        // `.us-item-row`. Step 10 of the teardown REPORTS the selection
        // (INCUMBENT:66); it does not clear it, because clearing it would silently
        // deselect every card the moment a drag ended.
        const fixture = buildFixture();
        const unselected = rowOf(fixture, '5');
        const controller = arm(fixture);

        move(document);

        for (const id of ['1', '2', '3', '4', '6']) {
            expect(rowOf(fixture, id).classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(true);
        }

        expect(unselected.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(false);

        controller.stop();

        for (const id of ['1', '2', '3', '4', '6']) {
            expect(rowOf(fixture, id).classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(true);
        }

        expect(unselected.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(false);
        expect(carriersOf(MULTIPLE_SORTABLE_CLASS)).toBe(5);
    });

    it('never applies a class owned by a screen or by the drag library', () => {
        // Each of these has an owner elsewhere and a live rule that would fire if
        // this module applied it:
        //
        //   target-drop  the board's drop highlight, applied and removed at
        //                `app/coffee/modules/kanban/sortable.coffee` L67-L73 and
        //                styled at `.../kanban/kanban-table.scss:247`;
        //   drag-active  put on the BODY by the story list at
        //                `.../backlog/sortable.coffee` L73 and taken off at L108,
        //                styled at `app/styles/core/base.scss:36`;
        //   doom-line    the sprint doom line the story list removes at
        //                `.../backlog/sortable.coffee` L95, styled at
        //                `app/styles/components/doomline.scss:1`;
        //   sprint-table the CONTAINER marker the drag library tests through
        //                `isContainer` at `.../backlog/sortable.coffee` L42;
        //   new          a row lifecycle class bound at
        //                `app/partials/includes/components/backlog-row.jade` L11.
        //
        // Counting carriers before, during and after is what makes this robust: the
        // fixture legitimately owns one `.sprint-table`, and the assertion is that
        // the module changes NOTHING, not that the document is empty of these names.
        const forbidden = ['target-drop', 'drag-active', 'doom-line', 'sprint-table', 'new'];
        const table = buildStoryTableFixture();
        const firstRow = at(table.bodyRows, 0, 'story row');
        const controller = makeController();
        const before = forbidden.map(carriersOf);

        expect(before).toEqual([0, 0, 0, 1, 0]);

        controller.start(firstRow, table.body);
        move(document);
        move(document);

        expect(forbidden.map(carriersOf)).toEqual(before);
        expect(document.body.classList.contains('drag-active')).toBe(false);

        controller.stop();

        expect(forbidden.map(carriersOf)).toEqual(before);
        expect(document.body.classList.contains('drag-active')).toBe(false);

        // The five names it DOES own are all back to zero carriers, which is the
        // other half of the same contract.
        for (const owned of [
            MAIN_DRAG_CLASS,
            MULTIPLE_DRAG_MIRROR_CLASS,
            TG_MULTIPLE_DRAG_MIRROR_CLASS,
            TG_MULTIPLE_DRAG_DRAGGING_CLASS,
            TRANSIT_MULTI_CLASS,
        ]) {
            expect(carriersOf(owned)).toBe(0);
        }
    });
});
