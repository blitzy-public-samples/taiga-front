/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `./DndProvider` — the single `@dnd-kit/core` `DndContext`
 * shared by both migrated screens.
 *
 * WHAT THIS SUITE IS FOR. Every behaviour it pins is one that breaks SILENTLY:
 * the class contract of Finding C produces no error when it is missing, the two
 * screens' autoscroll configurations produce no error when they collapse onto one
 * another, the `getElements()` / `start()` ordering produces no error when it is
 * normalised, and a teardown that leaves a listener attached produces no error
 * until a user navigates away from the board and back. There is therefore no
 * assertion here that a compiler or a linter could have made instead.
 *
 * HOW A DRAG IS DRIVEN. The provider mounts a real `DndContext` with a real
 * `PointerSensor`, so the suite drives a REAL gesture rather than calling the
 * provider's handlers directly: pointer down, pointer move to satisfy the
 * activation distance, then pointer up or Escape. Two environment facts make that
 * work under jsdom, and both are handled once at the top of this file:
 *   - jsdom implements no `PointerEvent`, and the sensor's activator rejects an
 *     event whose `isPrimary` is absent, so a minimal constructor is installed;
 *   - the overlay is unmounted by `@dnd-kit`'s animation manager one microtask
 *     after the drop resolves, so every drop and cancel is awaited inside `act`.
 *
 * `jest.config.js` sets `clearMocks` and `restoreMocks`, so this file installs no
 * mock hygiene of its own.
 *
 * BROWSERLESS, per constraint HR-5: jsdom only, no browser binary, no network, no
 * dependency on the built distribution, and nothing from the end-to-end layer.
 *
 * NOT DERIVED FROM A DESIGN FRAME. Drift register entry D4 records that neither
 * attached frame captures a drag-ghost state, so every expected class name here
 * comes from the retired directives and the measured stylesheet rules cited in
 * `./DndProvider`, never from a frame.
 */

import { act, fireEvent, render } from '@testing-library/react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Active, Collision, CollisionDetection } from '@dnd-kit/core';
import type { ReactElement, ReactNode } from 'react';

import {
    DndProvider,
    MIRROR_CLASS,
    TRANSIT_CLASS,
    toDndKitAutoScroll,
} from './DndProvider';
import type { DndAutoScrollConfig, DndMultiDragCallOrder } from './DndProvider';
import {
    MULTIPLE_SORTABLE_CLASS,
    MIRROR_CLASS as MULTI_DRAG_MIRROR_CLASS,
    TRANSIT_CLASS as MULTI_DRAG_TRANSIT_CLASS,
} from './multiDrag';
import type { MultiDragContainer, MultiDragController } from './multiDrag';

/* ==========================================================================
 * ENVIRONMENT
 * ========================================================================== */

/**
 * The smallest `PointerEvent` that satisfies the pinned pointer sensor.
 *
 * `PointerSensor.activators` rejects an event unless `event.isPrimary` is true
 * and `event.button` is zero. jsdom provides no `PointerEvent` at all, and the
 * DOM testing library falls back to the plain `Event` constructor when the
 * expected one is absent — which drops every unknown initialiser key, so
 * `isPrimary` would arrive as `undefined` and no drag would ever start.
 */
class TestPointerEvent extends MouseEvent {
    public readonly pointerId: number;

    public readonly isPrimary: boolean;

    public constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
        this.isPrimary = params.isPrimary ?? true;
    }
}

beforeAll(() => {
    Object.defineProperty(window, 'PointerEvent', {
        configurable: true,
        writable: true,
        value: TestPointerEvent,
    });
});

afterAll(() => {
    Reflect.deleteProperty(window, 'PointerEvent');
});

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/**
 * The board's incumbent autoscroll configuration —
 * `app/coffee/modules/kanban/sortable.coffee` L155-L160. Declared in the SUITE
 * rather than imported, because the provider deliberately exports no preset.
 */
const BOARD_AUTO_SCROLL: DndAutoScrollConfig = {
    enabled: true,
    margin: 100,
    scrollWhenOutside: true,
};

/**
 * The story list's incumbent autoscroll configuration —
 * `app/coffee/modules/backlog/sortable.coffee` L145-L151. Note the `pixels`
 * field, which the board does not have.
 */
const STORY_LIST_AUTO_SCROLL: DndAutoScrollConfig = {
    enabled: true,
    margin: 20,
    pixels: 30,
    scrollWhenOutside: true,
};

/** A deterministic extent, so no assertion depends on jsdom's default viewport. */
const VIEWPORT = { width: 1920, height: 1080 };

/** The identifier the draggable harness uses, and the `data-id` it renders. */
const SOURCE_ID = 7;

/** A second selected element, so a multi-selection can be assembled. */
const SIBLING_ID = 8;

/** The identifier of the drop target the collision fixture resolves to. */
const DROPPABLE_ID = 'column-1';

interface DraggableHarnessProps {
    readonly data?: Record<string, unknown>;

    /**
     * Registers the draggable with NO `data` at all, so `active.data.current` is
     * absent rather than an empty record. A screen is free to do that, and the
     * provider has to fall back to the probe rather than throw.
     */
    readonly omitData?: boolean;
    readonly renderDataId?: boolean;
    readonly selected?: boolean;
}

/**
 * A draggable standing in for a card or a story row.
 *
 * It renders `data-id`, because that attribute is the provider's documented
 * fallback for locating the drag source and is what the incumbent already relies
 * on everywhere, and it can carry the selection class so a multi-selection can be
 * assembled without reaching into `./multiDrag`'s internals.
 */
function DraggableHarness({
    data = {},
    omitData = false,
    renderDataId = true,
    selected = false,
}: DraggableHarnessProps): ReactElement {
    const { attributes, listeners, setNodeRef } = useDraggable(
        omitData ? { id: SOURCE_ID } : { id: SOURCE_ID, data },
    );

    return (
        <div
            ref={setNodeRef}
            data-testid="source"
            data-id={renderDataId ? String(SOURCE_ID) : undefined}
            className={selected ? MULTIPLE_SORTABLE_CLASS : undefined}
            {...listeners}
            {...attributes}
        />
    );
}

/** A drop target, so collision detection has something to consider. */
function DroppableHarness(): ReactElement {
    const { setNodeRef } = useDroppable({ id: DROPPABLE_ID });

    return <div ref={setNodeRef} data-testid="target" />;
}

interface RecordingMultiDrag extends MultiDragController {
    /** Method names in invocation order, which is what the ordering rules need. */
    readonly calls: readonly string[];

    /** The arguments of every `start()` call. */
    readonly startArgs: ReadonlyArray<{
        readonly item: HTMLElement;
        readonly container: MultiDragContainer;
    }>;

    /**
     * What the document looked like at the moment `start()` ran — the only way to
     * assert that the classes really are written FIRST.
     */
    readonly documentAtStart: ReadonlyArray<{
        readonly itemHasTransit: boolean;
        readonly mirrorCount: number;
    }>;

    /**
     * Whether the drag source still carried the transit class when `stop()` ran.
     * `multiDrag.drag()` targets `.gu-transit`, so stripping it before the
     * teardown would break multi-drag.
     */
    readonly transitPresentAtStop: readonly boolean[];

    setInProgress(value: boolean): void;

    setElements(elements: readonly HTMLElement[]): void;
}

/**
 * A `MultiDragController` that records instead of acting.
 *
 * The real controller is specified by its own co-located suite; what matters here
 * is WHICH methods the provider calls, IN WHICH ORDER, WITH WHICH ARGUMENTS and
 * AT WHICH POINT in the class lifecycle — none of which a real controller would
 * report.
 */
function createRecordingMultiDrag(
    transitClassName: string = TRANSIT_CLASS,
): RecordingMultiDrag {
    const calls: string[] = [];
    const startArgs: Array<{ item: HTMLElement; container: MultiDragContainer }> = [];
    const documentAtStart: Array<{ itemHasTransit: boolean; mirrorCount: number }> = [];
    const transitPresentAtStop: boolean[] = [];
    let elements: readonly HTMLElement[] = [];
    let inProgress = false;

    return {
        calls,
        startArgs,
        documentAtStart,
        transitPresentAtStop,

        setInProgress(value: boolean): void {
            inProgress = value;
        },

        setElements(next: readonly HTMLElement[]): void {
            elements = next;
        },

        start(item: HTMLElement, container: MultiDragContainer): void {
            calls.push('start');
            startArgs.push({ item, container });
            documentAtStart.push({
                itemHasTransit: item.classList.contains(transitClassName),
                mirrorCount: document.querySelectorAll(`.${MIRROR_CLASS}`).length,
            });
            inProgress = true;
        },

        stop(): readonly HTMLElement[] {
            calls.push('stop');
            transitPresentAtStop.push(
                document.querySelectorAll(`.${transitClassName}`).length > 0,
            );
            inProgress = false;

            return elements;
        },

        getElements(): readonly HTMLElement[] {
            calls.push('getElements');

            return elements;
        },

        isMultiple(): boolean {
            calls.push('isMultiple');

            return elements.length > 1;
        },

        reset(): void {
            calls.push('reset');
        },

        get inProgress(): boolean {
            return inProgress;
        },

        destroy(): void {
            calls.push('destroy');
            inProgress = false;
        },
    };
}

/** Presses the pointer down on a node without yet moving it. */
function pressOn(node: HTMLElement): void {
    fireEvent.pointerDown(node, { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
}

/** Moves the pointer, which is what satisfies the activation distance. */
function movePointer(distance = 25): void {
    fireEvent.pointerMove(document, { clientX: distance, clientY: distance });
}

/** Presses and moves, i.e. starts a drag. */
function startDrag(node: HTMLElement, distance = 25): void {
    pressOn(node);
    movePointer(distance);
}

/**
 * Releases the pointer and lets the overlay's teardown microtask run, so no state
 * update escapes `act`.
 */
async function dropDrag(distance = 25): Promise<void> {
    await act(async () => {
        fireEvent.pointerUp(document, { clientX: distance, clientY: distance });
    });
}

/** Cancels with Escape, which the pointer sensor listens for on the document. */
async function cancelDrag(): Promise<void> {
    await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });
}

/** Every node currently carrying the mirror class, overlay included. */
function mirrorNodes(className: string = MIRROR_CLASS): readonly Element[] {
    return Array.from(document.querySelectorAll(`.${className}`));
}

/* ==========================================================================
 * THE CLASS CONTRACT (transformation rule T1, Finding C)
 * ========================================================================== */

describe('the exported class contract', () => {
    it('names dragula\u2019s mirror and placeholder classes exactly', () => {
        /*
         * These two strings are the whole of Finding C. `@dnd-kit` emits neither,
         * the existing stylesheets select on both, and nothing fails loudly if
         * they drift: `app/modules/components/card/card.scss` L25,
         * `app/styles/modules/backlog/backlog-table.scss` L195, L211, L235, L314
         * and L330, `app/styles/modules/backlog/sprints.scss` L307, and the
         * vendor `dragula.css` still bundled at `gulpfile.js` L85.
         */
        expect(MIRROR_CLASS).toBe('gu-mirror');
        expect(TRANSIT_CLASS).toBe('gu-transit');
    });

    it('re-exports the single definition held by ./multiDrag', () => {
        /*
         * There must be exactly ONE definition of each name in this folder.
         * `./multiDrag` documents them as read there and written here, so the
         * provider re-exports rather than re-declaring; this assertion is what
         * stops a future edit from introducing a second, drifting copy.
         */
        expect(MIRROR_CLASS).toBe(MULTI_DRAG_MIRROR_CLASS);
        expect(TRANSIT_CLASS).toBe(MULTI_DRAG_TRANSIT_CLASS);
    });
});

/* ==========================================================================
 * THE AUTOSCROLL TRANSLATION
 * ========================================================================== */

describe('toDndKitAutoScroll', () => {
    it('turns the board\u2019s pixel margin into a per-axis fraction', () => {
        const options = toDndKitAutoScroll(BOARD_AUTO_SCROLL, VIEWPORT);

        expect(options.enabled).toBe(true);
        expect(options.threshold).toEqual({
            x: 100 / VIEWPORT.width,
            y: 100 / VIEWPORT.height,
        });
    });

    it('leaves acceleration untouched when the screen supplies no pixel step', () => {
        /*
         * The board configures no `pixels`
         * (`app/coffee/modules/kanban/sortable.coffee` L155-L160), so the field
         * must be ABSENT rather than zero or invented — an absent field is what
         * lets `@dnd-kit`'s own default stand.
         */
        const options = toDndKitAutoScroll(BOARD_AUTO_SCROLL, VIEWPORT);

        expect('acceleration' in options).toBe(false);
        expect(options.acceleration).toBeUndefined();
    });

    it('maps the story list\u2019s pixel step onto acceleration', () => {
        const options = toDndKitAutoScroll(STORY_LIST_AUTO_SCROLL, VIEWPORT);

        expect(options.acceleration).toBe(30);
        expect(options.threshold).toEqual({
            x: 20 / VIEWPORT.width,
            y: 20 / VIEWPORT.height,
        });
    });

    it('keeps the two screens\u2019 configurations observably distinct', () => {
        /*
         * THE POINT OF THE WHOLE FUNCTION. If the translation ever collapses the
         * board's margin of 100 and the story list's margin of 20 onto one output,
         * both screens start scrolling identically and nothing reports it. The
         * annotated story-list reference is explicit: "Do not unify the two."
         */
        const board = toDndKitAutoScroll(BOARD_AUTO_SCROLL, VIEWPORT);
        const storyList = toDndKitAutoScroll(STORY_LIST_AUTO_SCROLL, VIEWPORT);

        expect(board).not.toEqual(storyList);
        expect(board.threshold).not.toEqual(storyList.threshold);
        expect('acceleration' in board).not.toBe('acceleration' in storyList);
    });

    it('produces different thresholds per axis on a non-square viewport', () => {
        const options = toDndKitAutoScroll(BOARD_AUTO_SCROLL, VIEWPORT);

        expect(options.threshold?.x).not.toBe(options.threshold?.y);
    });

    it('carries the enabled flag through unchanged', () => {
        const options = toDndKitAutoScroll(
            { ...BOARD_AUTO_SCROLL, enabled: false },
            VIEWPORT,
        );

        expect(options.enabled).toBe(false);
    });

    it('collapses a non-positive or unusable margin to no activation band', () => {
        for (const margin of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
            const options = toDndKitAutoScroll(
                { ...BOARD_AUTO_SCROLL, margin },
                VIEWPORT,
            );

            expect(options.threshold).toEqual({ x: 0, y: 0 });
        }
    });

    it('clamps a margin that covers the extent to the whole region', () => {
        const options = toDndKitAutoScroll(
            { ...BOARD_AUTO_SCROLL, margin: VIEWPORT.width * 2 },
            VIEWPORT,
        );

        expect(options.threshold).toEqual({ x: 1, y: 1 });
    });

    it('treats an unmeasurable extent as the whole region', () => {
        /*
         * A pixel margin cannot be expressed as a fraction of nothing. Answering
         * with the maximum keeps the field within the range `@dnd-kit` accepts,
         * which a division by zero would not.
         */
        const zero = toDndKitAutoScroll(BOARD_AUTO_SCROLL, { width: 0, height: 0 });
        const unusable = toDndKitAutoScroll(BOARD_AUTO_SCROLL, {
            width: Number.NaN,
            height: Number.NEGATIVE_INFINITY,
        });

        expect(zero.threshold).toEqual({ x: 1, y: 1 });
        expect(unusable.threshold).toEqual({ x: 1, y: 1 });
    });

    it('omits acceleration when the pixel step is not a usable number', () => {
        for (const pixels of [Number.NaN, Number.POSITIVE_INFINITY]) {
            const options = toDndKitAutoScroll(
                { ...STORY_LIST_AUTO_SCROLL, pixels },
                VIEWPORT,
            );

            expect('acceleration' in options).toBe(false);
        }
    });

    it('honours an explicit pixel step of zero', () => {
        /*
         * Zero is a legitimate configuration meaning "do not advance", and it is
         * NOT the same as an absent field, which means "use the library default".
         * Conflating the two would silently re-enable scrolling.
         */
        const options = toDndKitAutoScroll(
            { ...STORY_LIST_AUTO_SCROLL, pixels: 0 },
            VIEWPORT,
        );

        expect(options.acceleration).toBe(0);
    });

    it('measures against the ambient viewport when none is supplied', () => {
        const options = toDndKitAutoScroll(BOARD_AUTO_SCROLL);

        expect(options.threshold).toEqual({
            x: 100 / window.innerWidth,
            y: 100 / window.innerHeight,
        });
    });
});

/* ==========================================================================
 * RENDERING
 * ========================================================================== */

describe('rendering', () => {
    it('renders the screen\u2019s own tree inside the context', () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <div data-testid="board">board</div>
            </DndProvider>,
        );

        expect(getByTestId('board')).toBeInTheDocument();
    });

    it('renders no mirror at all while nothing is being dragged', () => {
        render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                renderOverlay={(): ReactNode => <span data-testid="ghost">ghost</span>}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        expect(mirrorNodes()).toHaveLength(0);
        expect(document.querySelectorAll('[data-testid="ghost"]')).toHaveLength(0);
    });

    it('renders exactly one mirror host during a drag', async () => {
        /*
         * "Exactly one" is the assertion, not "at least one": a second overlay
         * would give `multiDrag.prepare()` a choice of shadows, and it takes the
         * first in document order.
         */
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(mirrorNodes()).toHaveLength(1);

        await dropDrag();
    });

    it('hands the active draggable to the overlay renderer and hosts its output', async () => {
        const seen: Array<Active | null> = [];
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                renderOverlay={(active): ReactNode => {
                    seen.push(active);

                    return <span data-testid="ghost">ghost</span>;
                }}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        const ghost = getByTestId('ghost');

        expect(ghost).toBeInTheDocument();
        expect(ghost.closest(`.${MIRROR_CLASS}`)).not.toBeNull();
        expect(seen.at(-1)?.id).toBe(SOURCE_ID);

        await dropDrag();
    });

    it('accepts an overridden mirror class name', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} mirrorClassName="probe-mirror">
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(mirrorNodes('probe-mirror')).toHaveLength(1);
        expect(mirrorNodes()).toHaveLength(0);

        await dropDrag();
    });
});

/* ==========================================================================
 * DRAG START — THE CLASS LIFECYCLE AND ITS ORDERING
 * ========================================================================== */

describe('drag start', () => {
    it('marks the drag source with the placeholder class', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(source).toHaveClass(TRANSIT_CLASS);

        await dropDrag();
    });

    it('accepts an overridden placeholder class name', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} transitClassName="probe-transit">
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(source).toHaveClass('probe-transit');
        expect(source).not.toHaveClass(TRANSIT_CLASS);

        await dropDrag();
    });

    it('locates the source through the node supplied on active.data', async () => {
        /*
         * The preferred path. A node reference on `active.data` removes every
         * guess: no probe, no selector, no reliance on identifier shape.
         */
        const nominated = document.createElement('div');

        document.body.appendChild(nominated);

        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness data={{ sourceNode: nominated }} renderDataId={false} />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(nominated).toHaveClass(TRANSIT_CLASS);
        expect(getByTestId('source')).not.toHaveClass(TRANSIT_CLASS);

        await dropDrag();

        nominated.remove();
    });

    it('falls back to the data-id probe when no node is supplied', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(getByTestId('source')).toHaveClass(TRANSIT_CLASS);

        await dropDrag();
    });

    it('still resolves the source when the screen registers no data at all', async () => {
        /*
         * `useDraggable` without a `data` argument leaves `active.data.current`
         * absent. Reading a field off nothing must simply answer "absent" and let
         * the probe take over, rather than throwing inside a pointer gesture.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <div data-testid="column">
                    <DraggableHarness omitData />
                </div>
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(source).toHaveClass(TRANSIT_CLASS);
        expect(controller.startArgs[0]?.item).toBe(source);
        expect(controller.startArgs[0]?.container).toBe(getByTestId('column'));

        await dropDrag();
    });

    it('decorates nothing and arms nothing when the source cannot be found', async () => {
        /*
         * Better to do nothing than to decorate the wrong element: a stray
         * `gu-transit` would hide a story the user can still see, with no way to
         * get it back short of a reload.
         */
        const controller = createRecordingMultiDrag();
        const onDragStart = jest.fn();
        const onMultiDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onDragStart={onDragStart}
                onMultiDragStart={onMultiDragStart}
            >
                <DraggableHarness renderDataId={false} />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(document.querySelectorAll(`.${TRANSIT_CLASS}`)).toHaveLength(0);
        expect(controller.calls).toHaveLength(0);
        expect(onMultiDragStart).toHaveBeenCalledWith([], expect.anything());
        expect(onDragStart).toHaveBeenCalledTimes(1);

        await dropDrag();
    });

    it('writes BOTH classes BEFORE arming the multi-select gesture', async () => {
        /*
         * THE FIRST ORDERING DEPENDENCY, ASSERTED FROM INSIDE `start()` — the only
         * vantage point from which it can be asserted at all.
         *
         * `multiDrag.prepare()` resolves `querySelector('.gu-mirror')` ONCE, on the
         * first movement after `start()`, and `multiDrag.drag()` targets
         * `.gu-transit`. Both classes therefore have to be in the document by the
         * time the gesture is armed. Neither omission produces an error: the ghost
         * clones simply stop following the pointer, and the gap stops being marked.
         *
         * A REAL BROWSER PROVED THIS ASSERTION NECESSARY. Arming inside the
         * drag-start handler observed `.gu-mirror` ABSENT on every one of five
         * measured gestures, because the overlay arrives with the commit rather
         * than with the handler. Arming from a layout effect on that commit is what
         * makes the mirror count below equal one — see `armMultiDrag` in
         * `./DndProvider` for the measurement.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(controller.documentAtStart).toEqual([{ itemHasTransit: true, mirrorCount: 1 }]);

        await dropDrag();
    });

    it('has the mirror host in the document before a following movement is seen', async () => {
        /*
         * THE SECOND ORDERING DEPENDENCY, ASSERTED FROM `prepare()`'S OWN VANTAGE
         * POINT rather than from inside `start()`.
         *
         * The mirror class is DECLARATIVE — it rides on the overlay React renders —
         * so it lands when the overlay is committed, which is AFTER the batch that
         * invokes the drag-start handler. What actually has to hold is therefore not
         * "the mirror exists when `start()` runs" but "the mirror exists when the
         * gesture's own movement listener first fires", because that is when
         * `multiDrag.prepare()` runs `querySelector('.gu-mirror')` to latch the
         * shadow every ghost clone follows — once, for the whole gesture.
         *
         * This observes from exactly the node `./multiDrag` listens on
         * (`documentElement`) and exactly the event it listens for (`mousemove`).
         */
        const observed: number[] = [];
        const probe = (): void => {
            observed.push(mirrorNodes().length);
        };

        document.documentElement.addEventListener('mousemove', probe);

        try {
            const { getByTestId } = render(
                <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                    <DraggableHarness />
                </DndProvider>,
            );

            startDrag(getByTestId('source'));
            fireEvent.mouseMove(document.documentElement, { clientX: 40, clientY: 40 });

            expect(observed).toEqual([1]);

            await dropDrag();
        } finally {
            document.documentElement.removeEventListener('mousemove', probe);
        }
    });

    it('arms the gesture with the resolved source node', async () => {
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(controller.startArgs).toHaveLength(1);
        expect(controller.startArgs[0]?.item).toBe(source);

        await dropDrag();
    });

    it('reports the selection the gesture started with', async () => {
        const controller = createRecordingMultiDrag();
        const selection = [document.createElement('div'), document.createElement('div')];

        controller.setElements(selection);

        const onMultiDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onMultiDragStart={onMultiDragStart}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(onMultiDragStart).toHaveBeenCalledTimes(1);
        expect(onMultiDragStart.mock.calls[0]?.[0]).toEqual(selection);

        await dropDrag();
    });

    it('lets the consumer observe a document that is already consistent', async () => {
        /*
         * Every consumer callback runs AFTER the provider's own bookkeeping, so a
         * screen reading the DOM from `onDragStart` never sees a half-decorated
         * document: the placeholder class is already on the drag source.
         *
         * The declared callback ORDER on the way in is `onDragStart` first and
         * `onMultiDragStart` one commit later, because the selection cannot be read
         * until the overlay exists. That order is part of the published contract, so
         * it is asserted rather than left implicit.
         */
        const sequence: string[] = [];
        let transitCountAtDragStart = -1;
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                onMultiDragStart={(): void => {
                    sequence.push('multi-start');
                }}
                onDragStart={(): void => {
                    sequence.push('start');
                    transitCountAtDragStart = document.querySelectorAll(
                        `.${TRANSIT_CLASS}`,
                    ).length;
                }}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(transitCountAtDragStart).toBe(1);
        expect(sequence).toEqual(['start', 'multi-start']);
        expect(mirrorNodes()).toHaveLength(1);

        await dropDrag();
    });

    it('never leaves two elements decorated across consecutive gestures', async () => {
        const nominated = document.createElement('div');

        document.body.appendChild(nominated);

        const { getByTestId, rerender } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(document.querySelectorAll(`.${TRANSIT_CLASS}`)).toHaveLength(1);

        /* A second gesture whose source resolves elsewhere, with no drop between. */
        rerender(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness data={{ sourceNode: nominated }} />
            </DndProvider>,
        );
        startDrag(getByTestId('source'));

        expect(document.querySelectorAll(`.${TRANSIT_CLASS}`)).toHaveLength(1);

        await dropDrag();
        nominated.remove();
    });

    it('honours a wider activation distance before starting', async () => {
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                activationDistance={40}
                onDragStart={onDragStart}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        pressOn(source);
        movePointer(5);

        expect(onDragStart).not.toHaveBeenCalled();
        expect(source).not.toHaveClass(TRANSIT_CLASS);

        movePointer(120);

        expect(onDragStart).toHaveBeenCalledTimes(1);
        expect(source).toHaveClass(TRANSIT_CLASS);

        await dropDrag(120);
    });
});

/* ==========================================================================
 * THE CALL-ORDER ASYMMETRY (transformation rule T10)
 * ========================================================================== */

describe('the multi-drag call order', () => {
    async function recordOrder(
        order: DndMultiDragCallOrder | undefined,
    ): Promise<readonly string[]> {
        const controller = createRecordingMultiDrag();
        const { getByTestId, unmount } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                multiDragCallOrder={order}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();
        await act(async () => {
            unmount();
        });

        return [...controller.calls];
    }

    it('reads the selection before arming for the board', async () => {
        /*
         * `app/coffee/modules/kanban/sortable.coffee` L76 then L87:
         * `getElements()` first, `start(item, containers)` last.
         */
        await expect(recordOrder('elements-then-start')).resolves.toEqual([
            'getElements',
            'start',
            'stop',
            'destroy',
        ]);
    });

    it('arms before reading for the story list', async () => {
        /*
         * `app/coffee/modules/backlog/sortable.coffee` L77 then L79:
         * `start(item, container)` first, `getElements()` after. INVERTED relative
         * to the board, and preserved rather than normalised.
         */
        await expect(recordOrder('start-then-elements')).resolves.toEqual([
            'start',
            'getElements',
            'stop',
            'destroy',
        ]);
    });

    it('defaults to the board\u2019s order, which is this file\u2019s declared source', async () => {
        await expect(recordOrder(undefined)).resolves.toEqual([
            'getElements',
            'start',
            'stop',
            'destroy',
        ]);
    });
});

/* ==========================================================================
 * THE MULTI-SELECTION SEARCH SCOPE
 * ========================================================================== */

describe('the multi-drag search scope', () => {
    async function capturedContainer(
        data: Record<string, unknown>,
    ): Promise<MultiDragContainer | undefined> {
        const controller = createRecordingMultiDrag();
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <div data-testid="column">
                    <DraggableHarness data={data} />
                </div>
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();

        const captured = controller.startArgs[0]?.container;

        unmount();

        return captured;
    }

    it('passes a single supplied element straight through', async () => {
        const container = document.createElement('div');

        await expect(capturedContainer({ multiDragContainer: container })).resolves.toBe(
            container,
        );
    });

    it('passes a supplied list through, as the board does', async () => {
        /*
         * The board hands its whole column ARRAY to
         * `window.dragMultiple.start(item, containers)`
         * (`app/coffee/modules/kanban/sortable.coffee` L87), which is why the list
         * shape has to survive the boundary intact.
         */
        const columns = [document.createElement('div'), document.createElement('div')];

        await expect(capturedContainer({ multiDragContainer: columns })).resolves.toEqual(
            columns,
        );
    });

    it('keeps only real elements out of a partially populated list', async () => {
        const column = document.createElement('div');

        await expect(
            capturedContainer({ multiDragContainer: [column, null, 42, undefined] }),
        ).resolves.toEqual([column]);
    });

    it('falls back to the parent element, which is the story list\u2019s own call', async () => {
        /*
         * `app/coffee/modules/backlog/sortable.coffee` L77 passes the SINGLE
         * container the drag library handed it, which is the row's parent. The
         * board must not rely on this fallback: a selection spanning two columns
         * would be scoped to one and silently downgrade to a single-item drag.
         */
        const captured = await capturedContainer({});

        expect(captured).toBeInstanceOf(HTMLElement);
        expect((captured as HTMLElement).dataset.testid).toBe('column');
    });

    it('falls back to the parent element for an empty list too', async () => {
        const captured = await capturedContainer({ multiDragContainer: [] });

        expect((captured as HTMLElement).dataset.testid).toBe('column');
    });

    it('ignores a value of the wrong kind rather than forwarding it', async () => {
        const captured = await capturedContainer({ multiDragContainer: 'column-1' });

        expect(captured).toBeInstanceOf(HTMLElement);
        expect((captured as HTMLElement).dataset.testid).toBe('column');
    });
});

/* ==========================================================================
 * DRAG END AND DRAG CANCEL
 * ========================================================================== */

describe('drag end', () => {
    it('tears the gesture down and strips the placeholder class', async () => {
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);
        await dropDrag();

        expect(controller.calls).toContain('stop');
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);
    });

    it('calls stop() while the placeholder class is STILL in the document', async () => {
        /*
         * THE SECOND ORDERING DEPENDENCY, asserted from inside `stop()`.
         * `multiDrag.drag()` adds `gu-transit-multi` to every `.gu-transit`, and
         * the incumbent calls `window.dragMultiple.stop()` from within its
         * `dragend` handler (kanban L111, backlog L106) while the drag library
         * strips its own placeholder afterwards. Removing the class first would
         * quietly break multi-drag teardown.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();

        expect(controller.transitPresentAtStop).toEqual([true]);
    });

    it('reports the selection stop() returned, before the screen\u2019s own handler', async () => {
        const controller = createRecordingMultiDrag();
        const selection = [document.createElement('div'), document.createElement('div')];

        controller.setElements(selection);

        const sequence: string[] = [];
        const onMultiDragEnd = jest.fn((elements: readonly HTMLElement[]) => {
            sequence.push(`multi:${elements.length}`);
        });
        const onDragEnd = jest.fn(() => {
            sequence.push('end');
        });
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onMultiDragEnd={onMultiDragEnd}
                onDragEnd={onDragEnd}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();

        expect(onMultiDragEnd.mock.calls[0]?.[0]).toEqual(selection);
        expect(sequence).toEqual(['multi:2', 'end']);
    });

    it('reports an empty selection when the gesture was a single-item drag', async () => {
        /*
         * The empty array is the contract: `./multiDrag` returns it when no
         * multi-drag is in progress, and BOTH incumbent handlers apply the
         * `[item]` fallback themselves (kanban L114-L115, backlog L112), so the
         * provider must not apply it on their behalf.
         */
        const onMultiDragEnd = jest.fn();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} onMultiDragEnd={onMultiDragEnd}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();

        expect(onMultiDragEnd).toHaveBeenCalledWith([], expect.anything());
    });
});

describe('drag cancel', () => {
    it('performs the same teardown as a drop', async () => {
        /*
         * The retired drag library fired `dragend` even for a cancelled gesture, so
         * a cancellation cannot do less work: the ghost clones and the placeholder
         * class have to go either way.
         */
        const controller = createRecordingMultiDrag();
        const onDragCancel = jest.fn();
        const onMultiDragEnd = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onDragCancel={onDragCancel}
                onMultiDragEnd={onMultiDragEnd}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);
        await cancelDrag();

        expect(onDragCancel).toHaveBeenCalledTimes(1);
        expect(onMultiDragEnd).toHaveBeenCalledTimes(1);
        expect(controller.calls).toContain('stop');
        expect(controller.transitPresentAtStop).toEqual([true]);
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);
    });
});

/* ==========================================================================
 * THE PERMISSION GATE
 * ========================================================================== */

describe('the permission gate', () => {
    it('activates no sensor at all when disabled', async () => {
        /*
         * The incumbent's gates are early RETURNS — the drag library is never
         * initialised, so a member without `modify_us`, or a member on an archived
         * project, gets NO drag rather than a rejected drop
         * (`app/coffee/modules/kanban/sortable.coffee` L37-L41 and
         * `app/coffee/modules/backlog/sortable.coffee` L30). Withholding the sensor
         * reproduces that exactly.
         */
        const controller = createRecordingMultiDrag();
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                disabled
                multiDrag={controller}
                onDragStart={onDragStart}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);
        movePointer(200);

        expect(onDragStart).not.toHaveBeenCalled();
        expect(controller.calls).toHaveLength(0);
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);
    });

    it('drags again once the gate opens', async () => {
        /*
         * EXPECT A DEVELOPMENT WARNING FROM THE LIBRARY HERE, and do not "fix" it by
         * deleting this case. `@dnd-kit`'s `useSensorSetup` builds its effect
         * dependency array out of the sensor list, and its own source notes that
         * "Sensors length could theoretically change which would not be a valid
         * dependency". Withholding the sensor is nevertheless the faithful gate —
         * see the reasoning beside `useSensors` in `./DndProvider` — and nothing is
         * skipped, because `PointerSensor` publishes no `setup` hook. The gate has
         * to be shown to reopen, which is what this case establishes.
         */
        const onDragStart = jest.fn();
        const { getByTestId, rerender } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} disabled onDragStart={onDragStart}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(onDragStart).not.toHaveBeenCalled();

        rerender(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                disabled={false}
                onDragStart={onDragStart}
            >
                <DraggableHarness />
            </DndProvider>,
        );
        startDrag(getByTestId('source'));

        expect(onDragStart).toHaveBeenCalledTimes(1);

        await dropDrag();
    });
});

/* ==========================================================================
 * PASS-THROUGHS
 * ========================================================================== */

describe('pass-throughs', () => {
    it('forwards drag-move to the screen', async () => {
        const onDragMove = jest.fn();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} onDragMove={onDragMove}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointer(60);

        expect(onDragMove).toHaveBeenCalled();

        await dropDrag(60);
    });

    it('forwards a collision strategy, and the drag-over it produces', async () => {
        /*
         * The strategy has to be supplied for this to be observable at all: a
         * browserless document measures every rectangle as empty, so the library's
         * own default finds no intersection, `over` stays absent and drag-over never
         * fires. Returning a collision for the registered target exercises the
         * forwarding of BOTH props in one pass.
         */
        const collisionDetection = jest.fn<Collision[], Parameters<CollisionDetection>>(() => [
            { id: DROPPABLE_ID },
        ]);
        const onDragOver = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                collisionDetection={collisionDetection}
                onDragOver={onDragOver}
            >
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointer(60);

        expect(collisionDetection).toHaveBeenCalled();
        expect(onDragOver).toHaveBeenCalled();

        await dropDrag(60);
    });
});

/* ==========================================================================
 * TEARDOWN — PARITY WITH `drake.destroy()`
 * ========================================================================== */

describe('teardown', () => {
    it('stops an in-flight gesture and then destroys the controller', async () => {
        /*
         * `app/coffee/modules/kanban/sortable.coffee` L177-L181 and
         * `app/coffee/modules/backlog/sortable.coffee` L153-L155. Unmounting in the
         * middle of a drag must leave no ghost clone in the document, no hidden
         * original and no decorated element — and `stop()` has to precede
         * `destroy()`, because it is `stop()` that performs the document work.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(source).toHaveClass(TRANSIT_CLASS);

        await act(async () => {
            unmount();
        });

        expect(controller.calls).toEqual(['getElements', 'start', 'stop', 'destroy']);
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);
    });

    it('destroys without stopping when no gesture is in flight', async () => {
        const controller = createRecordingMultiDrag();
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await dropDrag();

        expect(controller.calls).toEqual(['getElements', 'start', 'stop']);

        await act(async () => {
            unmount();
        });

        expect(controller.calls).toEqual(['getElements', 'start', 'stop', 'destroy']);
    });

    it('unmounts cleanly when no drag ever happened', () => {
        const controller = createRecordingMultiDrag();
        const { unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <DraggableHarness />
            </DndProvider>,
        );

        expect(() => {
            unmount();
        }).not.toThrow();
        expect(controller.calls).toHaveLength(0);
        expect(document.querySelectorAll(`.${TRANSIT_CLASS}`)).toHaveLength(0);
    });

    it('never writes the drag-active body class, which the story list owns', async () => {
        /*
         * `document.body.classList` is deliberately untouched here. `drag-active` is
         * added at `app/coffee/modules/backlog/sortable.coffee` L73 and removed at
         * L108 — by the STORY LIST only; the board does not do it at all. A shared
         * provider adding it would apply one screen's behaviour to both.
         */
        const before = document.body.className;
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(document.body.className).toBe(before);

        await dropDrag();

        await act(async () => {
            unmount();
        });

        expect(document.body.className).toBe(before);
    });
});

/* ==========================================================================
 * THE DEFAULT CONTROLLER
 * ========================================================================== */

describe('the default multi-select controller', () => {
    it('creates one when the screen injects none, and reports a real selection', async () => {
        /*
         * Drives the REAL `createMultiDrag()` rather than the recorder, so the
         * default path is exercised end to end: two elements carrying the selection
         * class make `isMultiDrag` hold, and the document-wide `getElements()` query
         * reports both.
         */
        const onMultiDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} onMultiDragStart={onMultiDragStart}>
                <div data-testid="column">
                    <DraggableHarness selected />
                    <div data-id={String(SIBLING_ID)} className={MULTIPLE_SORTABLE_CLASS} />
                </div>
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(onMultiDragStart.mock.calls[0]?.[0]).toHaveLength(2);

        await dropDrag();
    });

    it('reuses the same controller across gestures', async () => {
        /*
         * One controller for the life of the provider, mirroring the single drag
         * instance the incumbent keeps and extends
         * (`app/coffee/modules/kanban/sortable.coffee` L43-L47) rather than
         * rebuilding per gesture.
         */
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <div data-testid="column">
                    <DraggableHarness selected />
                    <div data-id={String(SIBLING_ID)} className={MULTIPLE_SORTABLE_CLASS} />
                </div>
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);
        await dropDrag();
        startDrag(source);

        expect(source).toHaveClass(TRANSIT_CLASS);

        await dropDrag();

        expect(source).not.toHaveClass(TRANSIT_CLASS);
    });
});
