/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `multiDrag.ts`, the hand-built multi-select drag machinery.
 *
 * Browserless by construction: it runs in the jsdom environment configured by
 * `jest.config.js`, needs no browser binary, no built bundle and no network.
 * Because jsdom implements no layout engine — `offsetWidth`, `offsetHeight` and
 * `getBoundingClientRect()` all report zero for every element — each fixture
 * element is given an explicit stub box. That is what makes the geometry
 * assertions below meaningful rather than vacuous, and it also pins each
 * measurement to the source it must come from: the clone width to the PRIMARY
 * element, the clone height to the element's OWN box, and the stacking pitch to
 * the DRAG IMAGE's box.
 *
 * The cases are grouped to follow the module's own structure, and the fidelity
 * assertions name the behaviour of the retired global they preserve.
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
        // browser, so it is asserted literally rather than derived.
        expect(MULTIPLE_SORTABLE_CLASS).toBe('ui-multisortable-multiple');
        expect(MAIN_DRAG_CLASS).toBe('main-drag-item');
        expect(MIRROR_CLASS).toBe('gu-mirror');
        expect(TRANSIT_CLASS).toBe('gu-transit');
        expect(TRANSIT_MULTI_CLASS).toBe('gu-transit-multi');
        expect(MULTIPLE_DRAG_MIRROR_CLASS).toBe('multiple-drag-mirror');
        expect(TG_MULTIPLE_DRAG_MIRROR_CLASS).toBe('tg-multiple-drag-mirror');
        expect(TG_MULTIPLE_DRAG_DRAGGING_CLASS).toBe('tg-multiple-drag-dragging');
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
        const fixture = buildFixture();

        arm(fixture);
        move(document);

        for (const id of ['1', '2', '3', '4', '5', '6']) {
            expect(dataAttributesOf(rowOf(fixture, id))).toEqual(['data-id']);
        }

        for (const clone of clonesIn(document)) {
            expect(dataAttributesOf(clone)).toEqual(['data-id']);
        }
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
        // Upstream the listener reference is still unset at that point, so its
        // removal is a no-op and the listener survives. The observable outcome is
        // preserved: a later movement still builds the gesture.
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
        expect(clonesIn(document)).toHaveLength(4);

        controller.stop();

        expect(controller.inProgress).toBe(false);
        expect(clonesIn(document)).toHaveLength(0);
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
        const fixture = buildFixture();
        const withInline = rowOf(fixture, '1');
        const withoutInline = rowOf(fixture, '2');

        withInline.style.display = 'inline-block';

        const controller = arm(fixture);

        move(document);
        expect(withInline.style.display).toBe('none');
        expect(withoutInline.style.display).toBe('none');

        controller.stop();

        // A naive reset to the empty string would lose the first value entirely.
        expect(withInline.style.display).toBe('inline-block');
        expect(withoutInline.style.display).toBe('');
        expect(withoutInline.style.length).toBe(0);
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
        const controller = makeController();
        const element = document.createElement('div');

        element.className = `row ${MULTIPLE_DRAG_MIRROR_CLASS} ${TG_MULTIPLE_DRAG_MIRROR_CLASS}`;
        element.setAttribute('style', 'position: fixed; top: 5px;');
        document.body.appendChild(element);

        controller.reset(element);

        expect(element.hasAttribute('style')).toBe(false);
        expect(element.className).toBe('row');
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
