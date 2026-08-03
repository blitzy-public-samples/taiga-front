/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
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

interface BoxStub {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

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

const CARD_BOX: BoxStub = { top: 0, left: 0, width: 260, height: 224 };

interface BoardFixture {
    readonly column: HTMLElement;
    readonly cards: readonly HTMLElement[];
    readonly main: HTMLElement;
    readonly ghost: HTMLElement;
    readonly mirror: HTMLElement;
}

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

    main.classList.add(TRANSIT_CLASS);

    const ghost = main.querySelector('.card-transit-multi');

    if (!(ghost instanceof HTMLElement)) {
        throw new Error('board fixture is missing the card ghost stack');
    }

    return { column, cards, main, ghost, mirror };
};

const STORY_ROW_BOX: BoxStub = { top: 0, left: 0, width: 1254, height: 56 };

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

const at = (elements: readonly HTMLElement[], index: number, what: string): HTMLElement => {
    const element = elements[index];

    if (element === undefined) {
        throw new Error(`fixture is missing ${what} at index ${index}`);
    }

    return element;
};

const carriersOf = (className: string): number =>
    document.querySelectorAll(`.${className}`).length;

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

describe('class name constants', () => {
    it('publishes the exact strings the existing stylesheets select on', () => {

        expect(MULTIPLE_SORTABLE_CLASS).toBe('ui-multisortable-multiple');

        expect(MAIN_DRAG_CLASS).toBe('main-drag-item');

        expect(MIRROR_CLASS).toBe('gu-mirror');

        expect(TRANSIT_CLASS).toBe('gu-transit');

        expect(TRANSIT_MULTI_CLASS).toBe('gu-transit-multi');

        expect(MULTIPLE_DRAG_MIRROR_CLASS).toBe('multiple-drag-mirror');

        expect(TG_MULTIPLE_DRAG_MIRROR_CLASS).toBe('tg-multiple-drag-mirror');

        expect(TG_MULTIPLE_DRAG_DRAGGING_CLASS).toBe('tg-multiple-drag-dragging');

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

describe('getMultiDragElements', () => {
    it('reports every selected element in document order, from the ambient document', () => {
        const fixture = buildFixture();

        expect(idsOf(getMultiDragElements())).toEqual(['1', '2', '3', '4', '6']);
        expect(fixture.container.children).toHaveLength(6);
    });

    it('is document-wide, not container-scoped', () => {
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
        const fixture = buildFixture();
        const selected = getMultiDragElements();

        expect(Array.isArray(selected)).toBe(true);
        expect(selected.length).toBe(5);
        expect(selected[0]).toBe(rowOf(fixture, '1'));

        const items: readonly HTMLElement[] = selected.length > 0 ? selected : [fixture.main];

        expect(items[0]).toBe(rowOf(fixture, '1'));

        for (const id of ['1', '2', '3', '4', '6']) {
            rowOf(fixture, id).classList.remove(MULTIPLE_SORTABLE_CLASS);
        }

        const emptied = getMultiDragElements();
        const fallback: readonly HTMLElement[] = emptied.length > 0 ? emptied : [fixture.main];

        expect(emptied).toHaveLength(0);
        expect(fallback).toEqual([fixture.main]);
    });
});

describe('isMultiDrag', () => {
    it('is true when the grabbed element is selected and the scope holds more than one', () => {
        const fixture = buildFixture();

        expect(isMultiDrag(fixture.main, fixture.container)).toBe(true);
    });

    it('is false when the grabbed element is not itself selected', () => {
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

        expect(getMultiDragElements()).toHaveLength(5);
        expect(isMultiDrag(fixture.main, fixture.container)).toBe(false);
        expect(isMultiDrag(rowOf(fixture, '1'), outside)).toBe(true);
    });

    it('accepts the board\u2019s array of containers as well as a single element', () => {
        const fixture = buildFixture();
        const second = fixture.target;
        second.appendChild(rowOf(fixture, '6'));

        expect(isMultiDrag(fixture.main, [fixture.container, second])).toBe(true);
        expect(isMultiDrag(rowOf(fixture, '6'), [second])).toBe(false);
        expect(isMultiDrag(rowOf(fixture, '6'), [second, fixture.container])).toBe(true);
    });

    it('ignores elements that are not HTML elements', () => {
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
        const table = buildStoryTableFixture();
        const firstSprintRow = at(table.sprintRows, 0, 'sprint row');

        expect(Array.from(table.sidebar.children)).toEqual([table.sprintTable]);
        expect(isMultiDrag(firstSprintRow, table.sidebar)).toBe(true);

        expect(isMultiDrag(firstSprintRow, table.sprintTable)).toBe(true);
    });

    it('counts a selection split across the board\u2019s array of containers', () => {
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
        const fixture = buildFixture();
        const before = document.body.innerHTML;

        expect(isMultiDrag(fixture.main, fixture.container)).toBe(true);
        expect(isMultiDrag(rowOf(fixture, '5'), fixture.container)).toBe(false);
        expect(isMultiDrag(fixture.main, [fixture.container, fixture.target])).toBe(true);
        expect(getMultiDragElements()).toHaveLength(5);

        expect(document.body.innerHTML).toBe(before);
    });
});

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

        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('sizes every clone from the PRIMARY element\u2019s width and its OWN height', () => {
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
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        for (const id of ['1', '2', '3', '4', '5', '6']) {
            const row = rowOf(fixture, id);

            expect(dataAttributesOf(row)).toEqual(['data-id']);

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

        expect(fixture.container.children).toHaveLength(6);
        expect(fixture.main.parentElement).toBe(fixture.container);
    });
});

describe('createMultiDrag: numbering and stacking', () => {
    it('stacks the ghosts at the DRAG IMAGE\u2019s pitch, nearest-first above the primary', () => {
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

            expect(clone.style.height).not.toBe(`${MIRROR_BOX.height}px`);
        }
    });

    it('follows the drag image on every subsequent movement', () => {
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        stubBox(fixture.mirror, { top: 300, left: 90, width: 200, height: 40 });
        move(document);

        const clones = clonesIn(document);

        expect(clones).toHaveLength(4);

        for (const clone of clones) {
            expect(clone.style.left).toBe('90px');
        }

        expect(clones[0]?.style.top).toBe('220px');
        expect(clones[3]?.style.top).toBe('380px');
    });

    it('numbers relative to the grabbed element, not to the list', () => {
        const fixture = buildFixture();
        const controller = makeController();

        controller.start(rowOf(fixture, '1'), fixture.container);
        move(document);

        const tops = clonesIn(document).map((clone) => clone.style.top);

        expect(idsOf(clonesIn(document))).toEqual(['2', '3', '4', '6']);
        expect(tops).toEqual(['140px', '180px', '220px', '260px']);
    });

    it('restores document order across several containers and de-duplicates overlaps', () => {
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

        const clones = clonesIn(document);

        expect(idsOf(clones)).toEqual(['b', 'c']);
        expect(clones.map((clone) => clone.style.top)).toEqual(['10px', '20px']);
    });
});

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
        const fixture = buildFixture();

        fixture.mirror.remove();
        arm(fixture);

        expect(() => move(document)).not.toThrow();

        expect(clonesIn(document)).toHaveLength(4);
        expect(fixture.transit.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        for (const clone of clonesIn(document)) {
            expect(clone.style.top).toBe('');
        }
    });

    it('removes the multi-item class from every carrier when the gesture ends', () => {
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

describe('the card ghost stack', () => {
    it('holds exactly two ghost blocks, each an image beside two lines of text', () => {
        const board = buildBoardFixture();

        expect(board.main.querySelectorAll('.card-transit-multi')).toHaveLength(1);
        expect(board.main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(2);

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

        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        controller.start(board.main, [board.column]);

        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);

        move(document);

        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(true);
        expect(board.main.classList.contains(TRANSIT_CLASS)).toBe(true);
        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
        expect(board.main.classList.contains('card')).toBe(true);

        controller.stop();

        expect(board.main.classList.contains(TRANSIT_MULTI_CLASS)).toBe(false);
        expect(board.main.classList.contains('kanban-task-selected')).toBe(true);
    });

    it('never creates, moves or removes the ghost markup', () => {
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

            expect(clone.classList.contains(TRANSIT_CLASS)).toBe(false);
            expect(clone.classList.contains(MAIN_DRAG_CLASS)).toBe(false);
        }

        controller.stop();

        expect(clonesIn(document)).toHaveLength(0);
        expect(document.querySelectorAll('.card-transit-multi')).toHaveLength(4);
    });
});

describe('the container shapes the two screens hand over', () => {
    it('treats the swimlane column and the flat-mode column alike', () => {
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

        expect(idsOf(clonesIn(document))).toEqual(['101', '102', '202']);
        expect(dataAttributesOf(swimlaneColumn)).toEqual(['data-status', 'data-swimlane']);
        expect(dataAttributesOf(flatColumn)).toEqual(['data-status']);

        controller.stop();

        expect(dataAttributesOf(swimlaneColumn)).toEqual(['data-status', 'data-swimlane']);
        expect(dataAttributesOf(flatColumn)).toEqual(['data-status']);
    });

    it('never mistakes the story-table header row for a story row', () => {
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

        expect(idsOf(clonesIn(document))).toEqual(['202']);
        expect(table.headerRow.className).toBe('row backlog-table-title');
        expect(table.headerRow.hasAttribute('style')).toBe(false);

        controller.stop();

        expect(table.headerRow.className).toBe('row backlog-table-title');
    });

    it('drags a selection out of a nested sprint table', () => {
        const table = buildStoryTableFixture();
        const firstSprintRow = at(table.sprintRows, 0, 'sprint row');
        const controller = makeController();

        controller.start(firstSprintRow, table.sidebar);
        move(document);

        expect(controller.inProgress).toBe(true);
        expect(idsOf(clonesIn(document))).toEqual(['302']);
        expect(firstSprintRow.classList.contains(MAIN_DRAG_CLASS)).toBe(true);
        expect(at(table.sprintRows, 1, 'sprint row').style.display).toBe('none');

        for (const row of table.bodyRows) {
            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
        }

        expect(idsOf(controller.stop())).toEqual(['201', '202', '301', '302']);
        expect(at(table.sprintRows, 1, 'sprint row').style.display).toBe('');
    });
});

describe('createMultiDrag: stop', () => {
    it('returns an empty list and touches nothing when no gesture is in progress', () => {
        const fixture = buildFixture();
        const controller = makeController();

        expect(controller.stop()).toEqual([]);
        expect(controller.inProgress).toBe(false);
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
    });

    it('disarms the listener when it runs before the first movement', () => {
        // ⭐ THE GESTURE THAT IS ARMED AND RELEASED WITHOUT MOVING — a grab whose
        // drop lands between `start()` and the first `mousemove`.
        //
        // Upstream leaves the listener attached here, but only by accident: its
        // removal at INCUMBENT:51 is unconditional and simply misses, because the
        // reference it removes is assigned INSIDE the handler body
        // (INCUMBENT:206) and is therefore still unset. Reproducing the miss would
        // keep a real defect rather than a behaviour — the next unrelated movement
        // anywhere in the document would run `prepare()` for a gesture that is
        // already over, hiding the originals and appending ghost clones to the body
        // with no drag left to end them, and nothing would report it.
        //
        // So `stop()` disarms on every path (hazard H3). The idle path still
        // returns an empty list and still touches the document not at all; what
        // changes is only that a LATER movement now builds nothing.
        const fixture = buildFixture();
        const controller = arm(fixture);

        expect(controller.stop()).toEqual([]);

        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);

        // Nothing was hidden either: the originals are still exactly where they were.
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '3', '4', '5', '6']);

        for (const row of Object.values(fixture.rows)) {
            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
        }
    });

    it('lets a fresh gesture re-arm normally after an unmoved one was stopped', () => {
        // The other half of the contract: disarming must not make the controller
        // unusable. `start()` re-attaches, and the next gesture behaves exactly as a
        // first one would.
        const fixture = buildFixture();
        const controller = arm(fixture);

        controller.stop();

        controller.start(fixture.main, fixture.container);
        move(document);

        expect(controller.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);

        expect(idsOf(controller.stop())).toEqual(['1', '2', '3', '4', '6']);
    });

    it('reports the selection in document order, with the first selected element first', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        const reported = controller.stop();

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

        for (const ghost of ghosts) {
            expect(ghost.isConnected).toBe(false);
            expect(ghost.parentElement).toBeNull();
        }
        expect(document.querySelectorAll(`.${MAIN_DRAG_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${MULTIPLE_DRAG_MIRROR_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${TG_MULTIPLE_DRAG_DRAGGING_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${TRANSIT_MULTI_CLASS}`)).toHaveLength(0);

        expect(document.querySelectorAll(`.${MULTIPLE_SORTABLE_CLASS}`)).toHaveLength(5);
    });

    it('strips the mirror decoration from a carrier that is NOT one of its ghosts', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        fixture.mirror.classList.add(MULTIPLE_DRAG_MIRROR_CLASS);

        move(document);

        controller.stop();

        expect(fixture.mirror.isConnected).toBe(true);
        expect(fixture.mirror.classList.contains(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);

        expect(fixture.mirror.classList.contains(MIRROR_CLASS)).toBe(true);
    });

    it('restores the exact inline display each hidden element had before', () => {
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

        expect(withFlex.style.display).toBe('flex');
        expect(withInlineBlock.style.display).toBe('inline-block');

        expect(withoutInline.style.display).toBe('');
        expect(withoutInline.style.length).toBe(0);
        expect(withoutInline.getAttribute('style')).toBe('');
    });

    it('puts the hidden elements back around the primary element, in order', () => {
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);
        expect(childIdsOf(fixture.container)).toEqual(['5']);
    });

    it('keeps the order when the primary element is the last selected one', () => {
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
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['1', '2', '3', '4', '6']);

        expect(clonesIn(document)).toHaveLength(0);
        expect(carriersOf(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(0);

        for (const id of ['1', '2', '4', '6']) {
            const row = rowOf(fixture, id);

            expect(row.style.display).toBe('');
            expect(row.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
            expect(row.parentElement).toBe(fixture.target);
        }
    });

    it('is idempotent: a second stop reports nothing and changes nothing', () => {
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
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        controller.reset(fixture.main);
        fixture.target.appendChild(fixture.main);

        controller.stop();

        expect(childIdsOf(fixture.target)).toEqual(['3']);
        expect(childIdsOf(fixture.container)).toEqual(['1', '2', '4', '5', '6']);

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

describe('createMultiDrag: listener discipline', () => {
    it('re-arming replaces the listener, so the NEW element becomes the primary one', () => {
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
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);
        expect(controller.inProgress).toBe(true);

        controller.destroy();

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(4);
        expect(fixture.main.classList.contains(MAIN_DRAG_CLASS)).toBe(true);

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
        const fixture = buildFixture();
        const attach = jest.spyOn(document.documentElement, 'addEventListener');
        const detach = jest.spyOn(document.documentElement, 'removeEventListener');
        const movementCalls = (calls: readonly (readonly unknown[])[]): number =>
            calls.filter((call) => call[0] === 'mousemove').length;
        const controller = makeController();

        controller.start(fixture.main, fixture.container);
        controller.start(fixture.main, fixture.container);
        controller.start(fixture.main, fixture.container);

        expect(movementCalls(attach.mock.calls)).toBe(3);
        expect(movementCalls(detach.mock.calls)).toBe(2);

        move(document);

        expect(clonesIn(document)).toHaveLength(4);

        controller.stop();

        expect(movementCalls(detach.mock.calls)).toBe(3);
        expect(movementCalls(attach.mock.calls)).toBe(3);

        move(document);
        move(document);

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
    });
});

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
        const fixture = buildFixture();
        const controller = arm(fixture);

        move(document);

        const clones = clonesIn(document);
        const abandoned = at(clones, 0, 'ghost clone');
        const survivor = at(clones, 1, 'ghost clone');

        expect(abandoned.style.top).toBe(`${MIRROR_BOX.top - 2 * MIRROR_BOX.height}px`);
        expect(survivor.style.top).toBe(`${MIRROR_BOX.top - MIRROR_BOX.height}px`);

        controller.reset(abandoned);

        expect(abandoned.hasAttribute('style')).toBe(false);
        expect(abandoned.classList.contains(TG_MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);
        expect(abandoned.classList.contains(MULTIPLE_DRAG_MIRROR_CLASS)).toBe(false);

        stubBox(fixture.mirror, { top: 500, left: 200, width: 200, height: 40 });
        move(document);

        expect(survivor.style.top).toBe('460px');
        expect(survivor.style.left).toBe('200px');
        expect(abandoned.hasAttribute('style')).toBe(false);
    });

    it('never calls reset from the gesture lifecycle', () => {
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

describe('createMultiDrag: factory isolation', () => {
    it('gives every controller its own gesture state', () => {
        const fixture = buildFixture();
        const first = makeController();
        const second = makeController();

        first.start(fixture.main, fixture.container);
        move(document);

        expect(first.inProgress).toBe(true);
        expect(second.inProgress).toBe(false);

        expect(second.stop()).toEqual([]);
        expect(first.inProgress).toBe(true);
        expect(clonesIn(document)).toHaveLength(4);

        expect(first.stop()).toHaveLength(5);
        expect(first.inProgress).toBe(false);
        expect(second.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
    });

    it('keeps its own bookkeeping, so a second controller renumbers from scratch', () => {
        const fixture = buildFixture();
        const first = makeController();
        const second = makeController();

        first.start(rowOf(fixture, '1'), fixture.container);
        move(document);
        first.stop();

        second.start(rowOf(fixture, '6'), fixture.container);
        move(document);

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

describe('classes this module must never apply', () => {
    it('reads the selection class and never assigns or clears it', () => {
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
