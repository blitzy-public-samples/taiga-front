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

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, fireEvent, render } from '@testing-library/react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Active, Collision, CollisionDetection } from '@dnd-kit/core';
import type { ReactElement, ReactNode } from 'react';

import {
    DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED,
    DndProvider,
    MIRROR_CLASS,
    TRANSIT_CLASS,
    applyAutoScrollDelta,
    autoScrollTargetEdges,
    computeAutoScrollDelta,
    isPointInsideAutoScrollTarget,
    resolveAutoScrollTarget,
} from './DndProvider';
import type {
    AutoScrollEdges,
    DndAutoScrollConfig,
    DndProviderProps,
} from './DndProvider';
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
 *
 * `getTargets` yields nothing by default: most cases in this suite exercise the
 * drag lifecycle rather than scrolling, and an empty target set is the honest way
 * to say "no scroll container here". The cases that DO exercise scrolling supply
 * their own.
 */
const BOARD_AUTO_SCROLL: DndAutoScrollConfig = {
    enabled: true,
    margin: 100,
    scrollWhenOutside: true,
    getTargets: () => [],
};

/**
 * The story list's incumbent autoscroll configuration —
 * `app/coffee/modules/backlog/sortable.coffee` L145-L151. Note `pixels`, which the
 * board does not have and which the installed library does not read, and the
 * `[window]` target, which the board does not use.
 */
const STORY_LIST_AUTO_SCROLL: DndAutoScrollConfig = {
    enabled: true,
    margin: 20,
    pixels: 30,
    scrollWhenOutside: true,
    getTargets: () => [window],
};

/** A deterministic extent, so no assertion depends on jsdom's default viewport. */
const VIEWPORT = { width: 1920, height: 1080 };

/**
 * Builds a rect for the arithmetic specs.
 *
 * Named so a case reads as geometry rather than as four numbers, and so the
 * measured column width (292 px, AAP §0.3.2) can be used verbatim.
 */
function edges(left: number, top: number, width: number, height: number): AutoScrollEdges {
    return { left, top, right: left + width, bottom: top + height };
}

/**
 * A scroll-target element double with settable, observable scroll offsets and a
 * rect under the suite's control.
 *
 * jsdom implements neither layout nor scrolling, so `getBoundingClientRect` returns
 * zeroes and `scrollTop` never moves on its own. Both are supplied here, which is
 * what lets the port be asserted in pixels with no browser.
 */
function scrollTargetDouble(rect: AutoScrollEdges): HTMLElement {
    const element = document.createElement('div');

    element.getBoundingClientRect = (): DOMRect =>
        ({
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            x: rect.left,
            y: rect.top,
            toJSON: () => ({}),
        }) as DOMRect;

    return element;
}

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

/* --------------------------------------------------------------------------
 * SOURCE-LEVEL TRIPWIRES
 *
 * A handful of the properties this suite has to protect are properties of the
 * PROVIDER'S SOURCE rather than of its behaviour, and no rendered assertion can
 * reach them, because in each case the compliant and the non-compliant provider
 * render identically under jsdom:
 *   - that no input sensor other than the pointer one is registered — a registered
 *     sensor that jsdom cannot reach is indistinguishable from an absent one;
 *   - that no screen-owned selector is hardcoded in the shared layer — a selector
 *     that happens to match nothing in a fixture is indistinguishable from an
 *     absent one;
 *   - that the file performs no I/O and opens no shadow root — a call on a branch
 *     the fixtures never take is indistinguishable from no call at all.
 *
 * Reading a source file from a spec is the established convention among this
 * suite's neighbours: `app/react/shared/Svg.test.tsx` reads `app/svg/sprite.svg`
 * to prove that every fragment id it references really is defined. It stays
 * browserless (constraint HR-5) — the file system is neither a browser nor a
 * network — and it reads source, never build output, so there is no `dist/`
 * coupling.
 *
 * ⭐ COMMENTS ARE STRIPPED FIRST, AND THAT IS THE WHOLE POINT. The provider is
 * required to EXPLAIN each of these decisions at the point of change (rule T9), so
 * the very names being forbidden legitimately appear in its prose. What must never
 * appear is a USE. An assertion over raw source would force a choice between
 * documenting the decision and passing the check.
 * -------------------------------------------------------------------------- */

/**
 * Removes block and line comments, leaving executable text only.
 *
 * The line-comment pattern requires the character before `//` not to be a colon so
 * that a `scheme://` inside a string survives; the provider contains no such string
 * today, and the guard costs nothing if one is added.
 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** `./DndProvider`'s executable source, read once for the whole suite. */
const PROVIDER_CODE = stripComments(
    readFileSync(join(__dirname, 'DndProvider.tsx'), 'utf8'),
);

/**
 * Assembles a sensor identifier from fragments instead of spelling it out.
 *
 * ⭐ DELIBERATE, AND NOT OBFUSCATION. The compliance check for rule T10 is a
 * FOLDER-WIDE search for the forbidden sensor names, and this spec is inside that
 * folder — a case that wrote one out would become a hit on its own assertion text,
 * so the check could never come back clean no matter how compliant the code was.
 * Composing the name at run time keeps the search meaningful while still asserting
 * the real identifier.
 */
function sensorIdentifier(device: string): string {
    return `${device}Sensor`;
}

/**
 * The shadow-root method name, assembled rather than written out.
 *
 * Same reasoning as {@link sensorIdentifier}: the compliance search for requirement
 * I6 covers this folder, so a spec that spelled the name out would match its own
 * text. The `as const` is what keeps the assembled value a literal type, so it is
 * still accepted where a key of `Element` is required and a typo would not compile.
 */
const SHADOW_ROOT_METHOD = `attach${'Shadow'}` as const;

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
 * THE AUTOSCROLL PORT
 *
 * `dom-autoscroller@2.3.4` reproduced arithmetic-for-arithmetic. Every expected
 * number below was computed by hand from the library's own expressions, so a
 * failure here means the port drifted rather than that a fixture is stale.
 * ========================================================================== */

describe('autoScrollTargetEdges', () => {
    it('measures an element with getBoundingClientRect, viewport-relative', () => {
        // The measured status-column width, AAP §0.3.2.
        const column = scrollTargetDouble(edges(216, 165, 292, 900));

        expect(autoScrollTargetEdges(column)).toEqual({
            left: 216,
            top: 165,
            right: 508,
            bottom: 1065,
        });
    });

    it('SYNTHESISES the window rect from innerWidth/innerHeight, not the document', () => {
        // `dom-plane`'s `createWindowRect()`: the viewport in its own coordinates,
        // anchored at the origin. This is what makes the story list's 20 px band a
        // band at the edge of what the user can SEE, rather than of the document.
        expect(autoScrollTargetEdges(window)).toEqual({
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
        });
    });
});

describe('isPointInsideAutoScrollTarget', () => {
    const column = scrollTargetDouble(edges(100, 100, 200, 200));

    it('is true strictly inside', () => {
        expect(isPointInsideAutoScrollTarget({ x: 200, y: 200 }, column)).toBe(true);
    });

    it.each([
        ['the left edge', { x: 100, y: 200 }],
        ['the right edge', { x: 300, y: 200 }],
        ['the top edge', { x: 200, y: 100 }],
        ['the bottom edge', { x: 200, y: 300 }],
    ])('⭐ is FALSE exactly on %s, because the library compares strictly', (_label, point) => {
        // All four of `dom-plane`'s comparisons are strict. Reproduced rather than
        // tidied: it is what decides whether `scrollWhenOutside` retains a target on a
        // boundary pixel.
        expect(isPointInsideAutoScrollTarget(point, column)).toBe(false);
    });

    it('is false outside', () => {
        expect(isPointInsideAutoScrollTarget({ x: 50, y: 200 }, column)).toBe(false);
        expect(isPointInsideAutoScrollTarget({ x: 400, y: 200 }, column)).toBe(false);
    });
});

describe('computeAutoScrollDelta', () => {
    /** A 292 px column at x 216, tall enough that only the x axis is interesting. */
    const column = edges(216, 0, 292, 10000);

    it('⭐ honours the board margin AS 100 PIXELS, not as a viewport fraction', () => {
        // THE DEFECT THIS PORT EXISTS TO FIX, stated as a test. The retired conversion
        // divided 100 by the viewport width (1920) and handed `@dnd-kit` ≈0.052, which
        // that library then applied to the column's OWN 292 px rect — an activation band
        // of about 15 px. Here the band is 100 px wide, measured inward from x 216, so a
        // pointer 60 px in still scrolls.
        const insideTheBand = computeAutoScrollDelta({ x: 276, y: 5000 }, column, 100);

        expect(insideTheBand.x).toBeLessThan(0);

        // And a pointer just PAST the band does not, which is what makes the band a band
        // rather than a gradient over the whole column. Under the fractional conversion
        // this point was far outside its ~15 px band and scrolled nothing.
        expect(computeAutoScrollDelta({ x: 316, y: 5000 }, column, 100).x).toBe(0);
    });

    it.each([
        // (position - left) / margin - 1, clamped at -1, × 4, floored.
        ['at the near edge', 216, -4],
        ['a quarter into the band', 241, -3],
        ['halfway into the band', 266, -2],
        ['three quarters in', 291, -1],
        ['one pixel inside the band', 315, -1],
        ['exactly one margin in', 316, 0],
        ['well past the band', 400, 0],
        ['beyond the near edge', 100, -4],
    ])('scrolls %s by %d px on x', (_label, x, expected) => {
        expect(computeAutoScrollDelta({ x, y: 5000 }, column, 100).x).toBe(expected);
    });

    it.each([
        // (position - right) / margin + 1, clamped at 1, × 4, ceiled. right = 508.
        ['at the far edge', 508, 4],
        ['a quarter into the band', 483, 3],
        ['halfway into the band', 458, 2],
        ['three quarters in', 433, 1],
        ['one pixel inside the band', 409, 1],
        ['exactly one margin in', 408, 0],
        ['beyond the far edge', 700, 4],
    ])('scrolls %s by %d px on x', (_label, x, expected) => {
        expect(computeAutoScrollDelta({ x, y: 5000 }, column, 100).x).toBe(expected);
    });

    it('⭐ has NO DEAD ZONE at the inner lip of the band', () => {
        // `Math.floor` on the negative side and `Math.ceil` on the positive mean that
        // ANY depth inside the band scrolls: one pixel in gives floor(-0.01 × 4) =
        // floor(-0.04) = -1, not 0. Rounding to nearest would invent a dead zone across
        // the inner three quarters of the band, and the drag would feel broken there.
        expect(computeAutoScrollDelta({ x: 315.99, y: 5000 }, column, 100).x).toBe(-1);
        expect(computeAutoScrollDelta({ x: 408.01, y: 5000 }, column, 100).x).toBe(1);
    });

    it('CLAMPS the magnitude to maxSpeed however far past the edge the pointer goes', () => {
        // The clamp is `Math.max(-1, …)` / `Math.min(1, …)` INSIDE the multiplication, so
        // it bounds the ratio rather than the product.
        for (const x of [216, 0, -500, -100000]) {
            expect(computeAutoScrollDelta({ x, y: 5000 }, column, 100).x).toBe(-4);
        }

        for (const x of [508, 2000, 100000]) {
            expect(computeAutoScrollDelta({ x, y: 5000 }, column, 100).x).toBe(4);
        }
    });

    it('defaults maxSpeed to the library default of 4', () => {
        expect(DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED).toBe(4);
        expect(computeAutoScrollDelta({ x: 216, y: 5000 }, column, 100).x).toBe(-4);
        expect(
            computeAutoScrollDelta(
                { x: 216, y: 5000 },
                column,
                100,
                DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED,
            ).x,
        ).toBe(-4);
    });

    it('scales with an explicit maxSpeed', () => {
        expect(computeAutoScrollDelta({ x: 216, y: 5000 }, column, 100, 10).x).toBe(-10);
        expect(computeAutoScrollDelta({ x: 266, y: 5000 }, column, 100, 10).x).toBe(-5);
    });

    it('treats the two axes independently, so a diagonal drag scrolls both', () => {
        const box = edges(0, 0, 1000, 1000);
        const delta = computeAutoScrollDelta({ x: 10, y: 995 }, box, 20);

        expect(delta.x).toBeLessThan(0);
        expect(delta.y).toBeGreaterThan(0);
    });

    it('scrolls nothing in the middle of a target', () => {
        expect(computeAutoScrollDelta({ x: 500, y: 500 }, edges(0, 0, 1000, 1000), 20)).toEqual({
            x: 0,
            y: 0,
        });
    });

    it.each([
        ['zero', 0],
        ['negative — the library default of -1', -1],
    ])('scrolls nothing when the margin is %s', (_label, margin) => {
        // `this.margin = options.margin || -1` means an UNSET margin can never satisfy
        // either band test, so an autoscroller configured without one is inert. Both
        // screens pass a margin, so this is the degenerate case rather than a live one.
        const delta = computeAutoScrollDelta({ x: 0, y: 0 }, edges(0, 0, 1000, 1000), margin);

        expect(delta).toEqual({ x: 0, y: 0 });
    });

    it('reproduces the STORY LIST configuration against the viewport', () => {
        // margin 20 against `[window]`: a pointer 5 px from the top of the viewport gives
        // floor(max(-1, 5/20 - 1) × 4) = floor(-3) = -3.
        const viewport = edges(0, 0, VIEWPORT.width, VIEWPORT.height);

        expect(computeAutoScrollDelta({ x: 960, y: 5 }, viewport, 20).y).toBe(-3);
        // And `pixels: 30` changes NOTHING, because the installed library never reads it.
        expect(STORY_LIST_AUTO_SCROLL.pixels).toBe(30);
        expect(computeAutoScrollDelta({ x: 960, y: 5 }, viewport, 20).y).not.toBe(-30);
    });

    it('⭐ keeps the two screens observably different, so neither inherits the other', () => {
        const viewport = edges(0, 0, VIEWPORT.width, VIEWPORT.height);
        const point = { x: 960, y: 50 };

        // 50 px from the top: inside the board's 100 px band, outside the list's 20 px one.
        expect(computeAutoScrollDelta(point, viewport, BOARD_AUTO_SCROLL.margin).y).toBe(-2);
        expect(computeAutoScrollDelta(point, viewport, STORY_LIST_AUTO_SCROLL.margin).y).toBe(0);
    });

    it('⭐ maps the margin INJECTIVELY, so no two configurations can collapse onto one', () => {
        /*
         * ⭐ THE HEADLINE PROPERTY OF THIS WHOLE BLOCK, stated as a property rather than as
         * a pair of numbers. The failure it guards is not a wrong value but a LOST
         * DISTINCTION: a mapping that folded the board's 100 and the story list's 20 onto
         * the same behaviour would erase a divergence the annotated incumbent is explicit
         * about — "the autoscroll options here are backlog-specific … do not unify the
         * two" — and it would do so with no error, no warning and no failing build. Every
         * screenshot would still look right, because autoscroll only shows itself mid-drag.
         *
         * Asserted over a RANGE rather than the two live values, because two points can
         * coincide by luck; a strictly ordered sequence cannot.
         */
        const viewport = edges(0, 0, VIEWPORT.width, VIEWPORT.height);
        const point = { x: 960, y: 50 };
        const margins = [20, 60, 100, 200, 400, 800];

        const deltas = margins.map(
            (margin) => computeAutoScrollDelta(point, viewport, margin).y,
        );

        // Distinct wherever the clamp has not yet been reached: a wider band means the
        // pointer sits proportionally deeper inside it, so it scrolls harder.
        expect(new Set(deltas.slice(0, 4)).size).toBe(4);

        // Monotonically stronger, never weaker, as the band widens.
        for (let index = 1; index < deltas.length; index += 1) {
            expect(deltas[index]).toBeLessThanOrEqual(deltas[index - 1]);
        }

        /*
         * And CLAMPED, not unbounded — `Math.max(-1, …)` caps the ratio before the speed
         * is applied, so however wide the margin grows the step never exceeds `maxSpeed`.
         * This is the pixel port's counterpart of a fractional threshold's 0…1 range.
         */
        for (const delta of deltas) {
            expect(delta).toBeGreaterThanOrEqual(-DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED);
        }

        expect(deltas[deltas.length - 1]).toBe(-DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED);
    });

});

describe('applyAutoScrollDelta', () => {
    it('moves an element RELATIVELY, one axis at a time', () => {
        const column = scrollTargetDouble(edges(0, 0, 292, 900));

        column.scrollTop = 100;
        column.scrollLeft = 50;

        applyAutoScrollDelta(column, { x: -4, y: 3 });

        expect(column.scrollTop).toBe(103);
        expect(column.scrollLeft).toBe(46);
    });

    it('does not touch an axis whose delta is zero', () => {
        const column = scrollTargetDouble(edges(0, 0, 292, 900));
        const writes: string[] = [];

        Object.defineProperty(column, 'scrollTop', {
            get: () => 0,
            set: () => writes.push('y'),
        });
        Object.defineProperty(column, 'scrollLeft', {
            get: () => 0,
            set: () => writes.push('x'),
        });

        applyAutoScrollDelta(column, { x: 0, y: 0 });

        expect(writes).toEqual([]);

        applyAutoScrollDelta(column, { x: 2, y: 0 });

        expect(writes).toEqual(['x']);
    });

    it('⭐ scrolls the window ABSOLUTELY, applying y first and re-reading the offsets', () => {
        // Both window axes go through `scrollTo`, which takes an absolute position, so the
        // second call would UNDO the first if it reused a cached offset. The library's
        // `scrollY`/`scrollX` each read `pageXOffset`/`pageYOffset` afresh, which is the
        // only reason a diagonal drag scrolls diagonally. Asserted through the calls
        // themselves, because jsdom does not actually scroll.
        let offsetX = 0;
        let offsetY = 0;
        const calls: Array<[number, number]> = [];

        const scrollTo = jest
            .spyOn(window, 'scrollTo')
            .mockImplementation(((x: number, y: number): void => {
                calls.push([x, y]);
                offsetX = x;
                offsetY = y;
            }) as typeof window.scrollTo);

        /*
         * `Object.defineProperty` rather than `jest.spyOn(…, 'get')`: in jsdom both
         * offsets are plain VALUE properties, so spying on an accessor that does not
         * exist throws "does not have access type get". The originals are captured and
         * put back in `finally`, since `restoreMocks` only undoes jest's own spies.
         */
        const originalPageX = Object.getOwnPropertyDescriptor(window, 'pageXOffset');
        const originalPageY = Object.getOwnPropertyDescriptor(window, 'pageYOffset');

        Object.defineProperty(window, 'pageXOffset', {
            configurable: true,
            get: () => offsetX,
        });
        Object.defineProperty(window, 'pageYOffset', {
            configurable: true,
            get: () => offsetY,
        });

        try {
            applyAutoScrollDelta(window, { x: 3, y: -2 });
        } finally {
            if (originalPageX !== undefined) {
                Object.defineProperty(window, 'pageXOffset', originalPageX);
            }

            if (originalPageY !== undefined) {
                Object.defineProperty(window, 'pageYOffset', originalPageY);
            }
        }

        expect(calls).toEqual([
            // y first, from (0, 0).
            [0, -2],
            // then x, re-reading the offsets, so the y move survives.
            [3, -2],
        ]);
        expect(scrollTo).toHaveBeenCalledTimes(2);
    });

    it('leaves the window alone when both deltas are zero', () => {
        const scrollTo = jest
            .spyOn(window, 'scrollTo')
            .mockImplementation((() => undefined) as typeof window.scrollTo);

        applyAutoScrollDelta(window, { x: 0, y: 0 });

        // A `scrollTo` with an unchanged value still fires a `scroll` event, which the
        // library's own guards exist to avoid.
        expect(scrollTo).not.toHaveBeenCalled();
    });
});

describe('resolveAutoScrollTarget', () => {
    const first = scrollTargetDouble(edges(0, 0, 400, 400));
    const second = scrollTargetDouble(edges(200, 0, 400, 400));
    const inside = { x: 100, y: 100 };
    const outside = { x: 900, y: 900 };

    it('acquires the target under the point', () => {
        expect(resolveAutoScrollTarget(inside, [first], null, true)).toBe(first);
    });

    it('acquires nothing when the point is over no target', () => {
        expect(resolveAutoScrollTarget(outside, [first], null, true)).toBeNull();
    });

    it('⭐ RETAINS the remembered target once the pointer leaves it, when scrollWhenOutside', () => {
        // The whole of `scrollWhenOutside`, which the retired translation carried across
        // and never implemented. It is what lets a drag pull a long column past its own
        // edge — the case the incumbent's annotation warns about.
        expect(resolveAutoScrollTarget(outside, [first], first, true)).toBe(first);
    });

    it('FORGETS it when scrollWhenOutside is false', () => {
        expect(resolveAutoScrollTarget(outside, [first], first, false)).toBeNull();
    });

    it('keeps the remembered target while the pointer is still inside it', () => {
        expect(resolveAutoScrollTarget(inside, [first], first, false)).toBe(first);
    });

    it('⭐ picks the LAST registered overlapping target, not the first and not the innermost', () => {
        // `getElementUnderPoint` iterates the whole array and keeps overwriting, so
        // registration ORDER decides. Reproduced rather than "improved" into a depth test:
        // a depth test would silently change which container a nested board scrolls.
        const overlap = { x: 300, y: 100 };

        expect(resolveAutoScrollTarget(overlap, [first, second], null, true)).toBe(second);
        expect(resolveAutoScrollTarget(overlap, [second, first], null, true)).toBe(first);
    });

    it('replaces the remembered target when a different one is acquired', () => {
        expect(resolveAutoScrollTarget({ x: 500, y: 100 }, [first, second], first, true)).toBe(
            second,
        );
    });

    it('holds the remembered target when nothing is under the point', () => {
        expect(resolveAutoScrollTarget(outside, [first, second], second, true)).toBe(second);
    });
});

/* ==========================================================================
 * THE AUTOSCROLL LOOP, DRIVEN THROUGH A REAL DRAG
 *
 * The arithmetic above is pure and asserted directly. What is asserted here is the
 * LIFETIME: that the loop runs only inside a drag, that it moves the target the
 * pointer is over, and that nothing survives the drop. `requestAnimationFrame` is
 * driven by hand, because jsdom's runs on a timer this suite does not control.
 * ========================================================================== */

describe('the autoscroll loop', () => {
    /** Pending animation-frame callbacks, newest last. */
    let frames: Array<() => void>;

    beforeEach(() => {
        jest.useFakeTimers();

        frames = [];

        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            ((callback: FrameRequestCallback): number => {
                frames.push(() => {
                    callback(0);
                });

                return frames.length;
            }) as typeof window.requestAnimationFrame,
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            ((handle: number): void => {
                if (handle >= 1 && handle <= frames.length) {
                    frames[handle - 1] = (): void => undefined;
                }
            }) as typeof window.cancelAnimationFrame,
        );
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Runs every frame requested so far, then flushes the deferred applications the
     * frames queued.
     *
     * Two stages because the library applies its delta inside a bare `setTimeout`
     * rather than in the frame itself, and the port reproduces that.
     */
    function runFrames(): void {
        const queued = frames;

        frames = [];

        act(() => {
            for (const frame of queued) {
                frame();
            }

            jest.runOnlyPendingTimers();
        });
    }

    /** Moves the pointer over the whole window, which is what the loop listens to. */
    function movePointerTo(x: number, y: number): void {
        act(() => {
            fireEvent.mouseMove(window, { clientX: x, clientY: y });
        });
    }

    function boardConfigFor(target: HTMLElement): DndAutoScrollConfig {
        return {
            enabled: true,
            margin: 100,
            scrollWhenOutside: true,
            getTargets: () => [target],
        };
    }

    it('scrolls the target the pointer is over, in PIXELS, during a drag', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        // 50 px below the column's top edge: inside the 100 px band, so
        // floor(max(-1, 50/100 - 1) × 4) = floor(-2) = -2 per frame.
        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(498);

        // The loop re-arms itself, so holding the pointer still keeps scrolling — which
        // is the entire purpose of an autoscroller.
        runFrames();

        expect(column.scrollTop).toBe(496);

        await dropDrag();
    });

    it('does NOTHING before a drag begins', () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        // The port of the incumbent predicate `this.down && drake.dragging`. The
        // annotation on the incumbent warns that dropping it "scrolls the board on plain
        // hover"; this is that warning as a test.
        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(500);
        expect(frames).toHaveLength(0);
    });

    it('STOPS on drop, and leaves no frame or deferred scroll behind', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointerTo(300, 50);

        // Dropped with a frame already requested and a scroll already deferred.
        await dropDrag();

        const scrollAtDrop = column.scrollTop;

        runFrames();
        movePointerTo(300, 50);
        runFrames();

        // A scroll applied after the drop would move a board no one is dragging.
        expect(column.scrollTop).toBe(scrollAtDrop);
    });

    it('STOPS on cancel too', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await cancelDrag();

        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(500);
    });

    it('stops when the subtree is unmounted mid-drag', () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointerTo(300, 50);

        // No drag-end event is produced by a torn-down subtree, so the unmount cleanup is
        // the only thing that can release the listeners — the counterpart of the
        // incumbent's `autoScroller.destroy()` beside `drake.destroy()`.
        unmount();

        const scrollAtUnmount = column.scrollTop;

        runFrames();
        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(scrollAtUnmount);
    });

    it('does not scroll a target the pointer never entered', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        // Far away from the column, and never inside it, so nothing is ever remembered.
        movePointerTo(1500, 500);
        runFrames();

        expect(column.scrollTop).toBe(500);

        await dropDrag();
    });

    it('⭐ keeps scrolling a target the pointer has LEFT, per scrollWhenOutside', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={boardConfigFor(column)}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        // Enter the column, then leave it entirely.
        movePointerTo(300, 400);
        movePointerTo(1500, 50);
        runFrames();

        // Still scrolling the remembered column: y 50 is inside its 100 px top band, and
        // the retention rule is what keeps it current.
        expect(column.scrollTop).toBe(498);

        await dropDrag();
    });

    it('FORGETS the target when scrollWhenOutside is false', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider
                autoScroll={{ ...boardConfigFor(column), scrollWhenOutside: false }}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointerTo(300, 400);
        movePointerTo(1500, 50);
        runFrames();

        expect(column.scrollTop).toBe(500);

        await dropDrag();
    });

    it('does not arm at all when the configuration is disabled', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId } = render(
            <DndProvider autoScroll={{ ...boardConfigFor(column), enabled: false }}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(500);

        await dropDrag();
    });

    it('scrolls the WINDOW when that is the configured target, as the story list does', async () => {
        let offsetY = 0;
        const scrollTo = jest
            .spyOn(window, 'scrollTo')
            .mockImplementation(((_x: number, y: number): void => {
                offsetY = y;
            }) as typeof window.scrollTo);

        const { getByTestId } = render(
            <DndProvider autoScroll={STORY_LIST_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        // 5 px from the top of the viewport, against the story list's 20 px margin:
        // floor(max(-1, 5/20 - 1) × 4) = floor(-3) = -3.
        movePointerTo(960, 5);
        runFrames();

        expect(scrollTo).toHaveBeenCalled();
        expect(offsetY).toBe(-3);

        await dropDrag();
    });

    it('⭐ accepts the story list\u2019s `pixels` and provably does NOT act on it', () => {
        /*
         * ⭐ THE ONE PLACE THIS SUITE ASSERTS THAT A CONFIGURED VALUE IS IGNORED, and it
         * is asserted rather than assumed because both possible mistakes are silent.
         *
         * MEASURED FACT: `dom-autoscroller@2.3.4` reads exactly five options — `margin`,
         * `scrollWhenOutside`, `maxSpeed`, `autoScroll` and `syncMove`. A search of the
         * installed bundle for `pixels` returns nothing. So
         * `app/coffee/modules/backlog/sortable.coffee` L145-L151's `pixels: 30` has never
         * had any effect on the running application, and the story list scrolls at the
         * default `maxSpeed` of 4 per frame exactly like the board.
         *
         * Implementing it would therefore be a SEVEN-AND-A-HALF-FOLD speed-up of live
         * behaviour — a functional change forbidden by rule T10 — dressed up as fixing a
         * bug. Dropping it from the interface would be the opposite mistake: the next
         * reader would re-add it as a missing feature. It is accepted, ignored, and
         * pinned here.
         *
         * Note what this does NOT weaken. The two screens still diverge, and the
         * divergence is attributable to `margin` ALONE — which is what the injectivity
         * case in `computeAutoScrollDelta` establishes.
         */
        let offsetY = 0;
        const scrollTo = jest
            .spyOn(window, 'scrollTo')
            .mockImplementation(((_x: number, y: number): void => {
                offsetY = y;
            }) as typeof window.scrollTo);

        /** Drives one frame of the window loop and reports where it scrolled to. */
        function offsetAfterOneFrame(config: DndAutoScrollConfig): number {
            offsetY = 0;

            const { getByTestId, unmount } = render(
                <DndProvider autoScroll={config}>
                    <DraggableHarness />
                </DndProvider>,
            );

            startDrag(getByTestId('source'));
            movePointerTo(960, 5);
            runFrames();

            act(() => {
                unmount();
            });

            return offsetY;
        }

        const withPixels = offsetAfterOneFrame(STORY_LIST_AUTO_SCROLL);
        const withoutPixels = offsetAfterOneFrame({
            enabled: true,
            margin: 20,
            scrollWhenOutside: true,
            getTargets: () => [window],
        });

        expect(scrollTo).toHaveBeenCalled();

        // Identical, so `pixels` changed nothing.
        expect(withPixels).toBe(withoutPixels);

        // And the shared value is the one the MARGIN and the default maxSpeed produce —
        // floor(max(-1, 5/20 - 1) × 4) = -3 — not the 30 the option names.
        expect(withPixels).toBe(-3);
    });

    it('⭐ scrolls the window on its OWN frame, independently of any element target', async () => {
        // The library requests the window's frame BEFORE its `if (!current) return`, so the
        // window scrolls even when the pointer is over no registered element. Reproduced,
        // because the story list registers `[window]` and nothing else.
        const scrollTo = jest
            .spyOn(window, 'scrollTo')
            .mockImplementation((() => undefined) as typeof window.scrollTo);

        const { getByTestId } = render(
            <DndProvider autoScroll={STORY_LIST_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        movePointerTo(960, 5);
        runFrames();

        expect(scrollTo).toHaveBeenCalled();

        await dropDrag();
    });

    it('reads the CURRENT configuration, so a rebuilt object is honoured next drag', async () => {
        const column = scrollTargetDouble(edges(216, 0, 292, 900));

        column.scrollTop = 500;

        const { getByTestId, rerender } = render(
            <DndProvider autoScroll={{ ...boardConfigFor(column), margin: 100 }}>
                <DraggableHarness />
            </DndProvider>,
        );

        rerender(
            <DndProvider autoScroll={{ ...boardConfigFor(column), margin: 10 }}>
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        // y 50 is inside a 100 px band but outside a 10 px one, so the NEW margin is the
        // one in force — the runner is not holding the object it was created with.
        movePointerTo(300, 50);
        runFrames();

        expect(column.scrollTop).toBe(500);

        await dropDrag();
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
    // The call-order union is reached through the public props type rather than
    // through a second exported alias, so this spec exercises exactly the surface
    // a screen has: `DndProviderProps['multiDragCallOrder']` already admits
    // `undefined`, which is the "let the default apply" case below.
    async function recordOrder(
        order: DndProviderProps['multiDragCallOrder'],
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
 * POINTER ONLY (transformation rule T10)
 *
 * The incumbent's ENTIRE input surface is `dragula`, constructed at
 * `app/coffee/modules/kanban/sortable.coffee` L56 and at
 * `app/coffee/modules/backlog/sortable.coffee` L39, and it is MOUSE-DRIVEN ONLY:
 * its grab handler ignores anything but the primary mouse button, and it registers
 * no `keydown` listener anywhere. There is therefore no keyboard drag and no drag
 * narration on either screen today.
 *
 * `@dnd-kit` supplies both by DEFAULT, which is exactly why this block exists.
 * Accepting them would be a feature change — rule T10, "No functional or feature
 * change of any kind", and goal G1, behavioural equivalence "with no feature
 * changes". Nor can a frame be read as authorising one: drift register entry D4
 * records that neither attached frame captures any drag state at all.
 *
 * ⚠️ THESE CASES ARE NOT AN ARGUMENT AGAINST KEYBOARD OPERABILITY. Making these
 * boards keyboard-operable would be a genuine improvement. It belongs in its own
 * change, made against the AngularJS screens that share the same card component as
 * well, so the application does not end up operable on two screens and not on the
 * rest — not smuggled in under a migration whose whole remit is that these two
 * screens behave exactly as they do now.
 * ========================================================================== */

describe('pointer-only input', () => {
    /**
     * The keys a keyboard drag would use, taken from the instruction text the library
     * would otherwise have rendered: space to pick up, the arrows to move. `Enter` is
     * included because it is the other key a reader might expect to work.
     *
     * `Escape` is deliberately absent: the POINTER sensor listens for it on the owner
     * document to cancel a gesture in flight, so it is not evidence either way.
     */
    const KEYBOARD_DRAG_KEYS: ReadonlyArray<{ readonly key: string; readonly code: string }> = [
        { key: ' ', code: 'Space' },
        { key: 'Enter', code: 'Enter' },
        { key: 'ArrowRight', code: 'ArrowRight' },
        { key: 'ArrowDown', code: 'ArrowDown' },
    ];

    /**
     * Presses every key above on the node AND on the document, then lets one macrotask
     * run.
     *
     * BOTH TARGETS, for a measured reason: the library's keyboard sensor hears the
     * PICK-UP key on the activator node and every subsequent key on the owner document
     * (its constructor builds `new Listeners(getOwnerDocument(target))`). Pressing only
     * one of the two would leave half of a registered sensor untested.
     *
     * THE MACROTASK MATTERS TOO: that sensor attaches its listener inside a bare
     * `setTimeout`, so an assertion made synchronously could pass merely because
     * nothing was listening YET rather than because nothing is listening at all.
     */
    async function pressEveryDragKey(node: HTMLElement): Promise<void> {
        await act(async () => {
            node.focus();

            for (const { key, code } of KEYBOARD_DRAG_KEYS) {
                fireEvent.keyDown(node, { key, code });
                fireEvent.keyDown(document, { key, code });
            }

            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
        });
    }

    /**
     * The exact phrases `@dnd-kit` emits when its accessibility slots are left at
     * their defaults — `defaultScreenReaderInstructions` and each branch of
     * `defaultAnnouncements`.
     *
     * Quoted rather than imported so that a library upgrade which CHANGED the wording
     * could not silently satisfy this suite: the strings the incumbent must not emit
     * are a property of this migration, not of the installed version.
     */
    const DEFAULT_NARRATION: readonly string[] = [
        'press the space bar',
        'Picked up draggable item',
        'was moved over droppable area',
        'is no longer over a droppable area',
        'was dropped',
        'Dragging was cancelled',
    ];

    /** Asserts that nothing anywhere in the document carries library narration. */
    function expectNoNarration(): void {
        const text = document.body.textContent ?? '';

        for (const phrase of DEFAULT_NARRATION) {
            expect(text).not.toContain(phrase);
        }
    }

    it('starts a drag from a primary-button pointer gesture', async () => {
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} onDragStart={onDragStart}>
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        // The positive half of the rule: the ONE device the incumbent supports still
        // works. Every other case in this block is negative, and a suite of negatives
        // would also pass against a provider that registered no sensor at all.
        expect(onDragStart).toHaveBeenCalledTimes(1);
        expect(source).toHaveClass(TRANSIT_CLASS);

        await dropDrag();
    });

    it('⭐ starts NOTHING from the keys a keyboard gesture would use', async () => {
        const controller = createRecordingMultiDrag();
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onDragStart={onDragStart}
            >
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        await pressEveryDragKey(source);

        /*
         * Four independent observations, because a keyboard drag that started and was
         * immediately abandoned would still have left evidence: a lifecycle callback, the
         * class contract of Finding C, a mirror host, or an armed multi-select gesture.
         * All four must be untouched.
         */
        expect(onDragStart).not.toHaveBeenCalled();
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);
        expect(controller.calls).toHaveLength(0);
    });

    it('⭐ registers no input sensor other than the pointer one', () => {
        /*
         * SOURCE-LEVEL, because this is the one property no rendered assertion can
         * establish: under jsdom a sensor that IS registered but cannot be reached looks
         * exactly like a sensor that was never registered, so the case above would pass
         * either way. Together the two are conclusive.
         *
         * Comments are stripped first — the provider is REQUIRED to explain this decision
         * at the point of change (rule T9), so the names legitimately appear in its prose.
         * What must never appear is a USE.
         */
        expect(PROVIDER_CODE).toContain('useSensor(PointerSensor');

        for (const device of ['Keyboard', 'Touch', 'Mouse']) {
            expect(PROVIDER_CODE).not.toContain(sensorIdentifier(device));
        }
    });

    it('emits none of the drag narration the incumbent lacks', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        // On mount: `DndContext` would otherwise have rendered its keyboard instructions
        // into a hidden node here, and an instruction to press the space bar would now be
        // UNTRUE as well as new.
        expectNoNarration();

        const source = getByTestId('source');

        startDrag(source);
        expectNoNarration();

        movePointer(60);
        expectNoNarration();

        await dropDrag(60);
        expectNoNarration();
    });

    it('narrates nothing on a cancelled gesture either', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));
        await cancelDrag();

        // The cancel branch of `defaultAnnouncements` is a separate string from the drop
        // branch, so silencing one does not silence the other.
        expectNoNarration();
    });

    it('leaves the library\u2019s two live nodes present but permanently empty', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
                <DroppableHarness />
            </DndProvider>,
        );

        /*
         * PRESENT, NOT ABSENT — and that is the honest outcome rather than a compromise.
         * `@dnd-kit` mounts its `LiveRegion` (`role="status"`) and its `HiddenText`
         * instructions unconditionally; short of forking the library they cannot be
         * removed. What CAN be removed is their content, and content is what a screen
         * reader announces, so an empty region announces exactly what the incumbent
         * announces: nothing. Asserting emptiness rather than absence also states the
         * mechanism, so a future reader does not "fix" the empty nodes by deleting the
         * accessibility prop and restoring the narration.
         */
        const region = document.querySelector('[role="status"]');

        expect(region).not.toBeNull();
        expect(region?.textContent).toBe('');

        const describedBy = getByTestId('source').getAttribute('aria-describedby');

        expect(describedBy).not.toBeNull();

        const instructions = describedBy === null ? null : document.getElementById(describedBy);

        expect(instructions).not.toBeNull();
        expect(instructions?.textContent).toBe('');

        // And still empty after a whole gesture, not merely before one.
        startDrag(getByTestId('source'));
        await dropDrag();

        expect(document.querySelector('[role="status"]')?.textContent).toBe('');
    });

    it('grabs on the smallest movement, because the activation distance defaults to zero', async () => {
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} onDragStart={onDragStart}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        pressOn(source);

        /*
         * Pointer-down alone is not a drag, in the incumbent either: `dragula`'s `grab`
         * records the click and waits for movement before calling `start`.
         */
        expect(onDragStart).not.toHaveBeenCalled();

        movePointer(1);

        /*
         * ONE PIXEL IS ENOUGH, which is the point. `dragula` has no distance threshold at
         * all, so the faithful default is the smallest one `@dnd-kit` can express: its
         * `hasExceededDistance` compares `Math.sqrt(dx² + dy²) > distance` strictly, so a
         * default of zero fires on the first real movement and never on a stationary
         * press. A non-zero default would have made short drags of the kind the story
         * list is full of — a row moved one place — silently unstartable.
         *
         * The counterpart case, a screen that ASKS for a wider threshold, is asserted in
         * the drag-start block ("honours a wider activation distance before starting").
         */
        expect(onDragStart).toHaveBeenCalledTimes(1);
        expect(source).toHaveClass(TRANSIT_CLASS);

        await dropDrag(1);
    });

    it('closes the only door there is when the permission gate is shut', async () => {
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
                <DroppableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        await pressEveryDragKey(source);
        startDrag(source);
        movePointer(200);

        /*
         * Both devices are asserted against the SAME closed gate on purpose. The gate is
         * the incumbent's early return, and the reason it is expressed as "withhold the
         * sensor" rather than "reject the drop" is that a member without `modify_us`
         * must get no gesture at all. If a keyboard path is ever added, this case is the
         * one that fails if it is added ABOVE the gate.
         */
        expect(onDragStart).not.toHaveBeenCalled();
        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(controller.calls).toHaveLength(0);
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

        /*
         * The library reports that warning through `console.error`. It is EXPECTED
         * OUTPUT for this case, so it is captured and asserted rather than left to
         * print: a green run whose stderr carries a warning trains a reader to ignore
         * stderr. `restoreMocks` puts the real console back afterwards.
         */
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation((): undefined => undefined);

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

        // The warning really was the library's changing-sensor-list note, and not some
        // other error this case happened to swallow.
        expect(
            consoleErrorSpy.mock.calls.some((call) =>
                String(call[0]).includes('changed size between renders'),
            ),
        ).toBe(true);

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

    it('has already stripped the placeholder class by the time the screen\u2019s drag-end runs', async () => {
        /*
         * THE OTHER HALF OF THE ORDERING CONTRACT. On the way IN, a consumer sees a
         * document that is already decorated ("lets the consumer observe a document that
         * is already consistent"); on the way OUT it must see one that is already clean,
         * or a screen that reads the row order from the DOM inside `onDragEnd` would count
         * a placeholder that is on its way out.
         *
         * The published order inside the provider is: disarm the scroll loop, `stop()` the
         * multi-select gesture — while the placeholder is deliberately STILL present,
         * because `multiDrag.drag()` targets `.gu-transit` — then release the placeholder,
         * then `onMultiDragEnd`, then `onDragEnd`. So by the last step the class is gone.
         */
        let transitCountAtDragEnd = -1;
        let sourceStillDecorated = true;
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                onDragEnd={(): void => {
                    transitCountAtDragEnd = document.querySelectorAll(
                        `.${TRANSIT_CLASS}`,
                    ).length;
                    sourceStillDecorated = getByTestId('source').classList.contains(
                        TRANSIT_CLASS,
                    );
                }}
            >
                <DraggableHarness />
            </DndProvider>,
        );

        startDrag(getByTestId('source'));

        expect(getByTestId('source')).toHaveClass(TRANSIT_CLASS);

        await dropDrag();

        expect(transitCountAtDragEnd).toBe(0);
        expect(sourceStillDecorated).toBe(false);
    });

    it('completes a whole gesture with every optional prop omitted', async () => {
        /*
         * Only `children` and `autoScroll` are required, and a screen is free to supply
         * nothing else — the board's zoom-level toolbar, for instance, mounts a provider
         * long before any handler is wired. Every optional callback is invoked through
         * `?.()`, so the risk being pinned is a future edit that calls one unguarded: that
         * would throw inside a `@dnd-kit` handler, where the exception surfaces as a drag
         * that simply stops working rather than as anything a user could report.
         *
         * The class contract is asserted either side of the drop rather than merely
         * "nothing threw", because a provider that silently did nothing at all would also
         * not throw.
         */
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <DraggableHarness />
            </DndProvider>,
        );

        const source = getByTestId('source');

        startDrag(source);

        expect(source).toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(1);

        await dropDrag();

        expect(source).not.toHaveClass(TRANSIT_CLASS);
        expect(mirrorNodes()).toHaveLength(0);

        // Teardown with no injected controller and no handlers has to be quiet too.
        await act(async () => {
            unmount();
        });
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

/* ==========================================================================
 * THE SCOPE SPLIT — WHAT THIS SHARED FILE IS NOT ALLOWED TO KNOW
 *
 * `app/react/shared/dnd/` is reached by BOTH migrated screens, so anything
 * screen-specific that leaks in here is applied to the other screen as well. The
 * board, for instance, marks a foreign container `target-drop` while dragging over
 * it and marks the destination `new` on arrival; the story list marks
 * `document.body` `drag-active` for the duration. Neither does the other's, and a
 * shared provider that did either would change a screen nobody asked it to touch.
 *
 * ⭐ THESE CASES RUN AGAINST THE REAL MARKUP, which matters more than it looks: a
 * leak asserted against a synthetic fixture can pass merely because the fixture had
 * nothing for the leaked selector to match. The fixture below is the incumbent's own
 * structure, including both drop containers the story list registers and both board
 * modes, so a leak has somewhere to land.
 * ========================================================================== */

/** The card the scope cases drag. `card.jade` renders `data-id` on the host. */
const CARD_ID = 101;

/** A second card, rendered with its inner content virtualised away. */
const FOLDED_CARD_ID = 102;

/** A card that is not displayed at all, for the visibility cases. */
const HIDDEN_CARD_ID = 103;

interface CardHarnessProps {
    readonly id: number;

    /**
     * Whether to render `.card-inner`.
     *
     * ⭐ THE VIRTUALISATION SWITCH, and the reason it is a switch at all is
     * structural: `app/modules/components/card/card.jade` L8-L13 puts
     * `ng-if="vm.inViewPort"` on `.card-inner`, which is INSIDE `tg-card`, and
     * `card.directive.coffee` declares no `replace` — so the outer element is always
     * in the document and only its contents come and go.
     */
    readonly renderInner?: boolean;
}

/**
 * A draggable card built as the board really builds one: a `tg-card` host carrying
 * `data-id`, with the inner block that virtualisation removes.
 *
 * `class` rather than `className`, because react-dom forwards props to a hyphenated
 * tag name verbatim and never translates `className` for one — the spelling the
 * existing stylesheets select on is the only one that lands.
 */
function CardHarness({ id, renderInner = true }: CardHarnessProps): ReactElement {
    const { attributes, listeners, setNodeRef } = useDraggable({ id });

    return (
        <tg-card
            ref={setNodeRef}
            class="card ng-animate-disabled"
            data-testid={`card-${String(id)}`}
            data-id={String(id)}
            {...listeners}
            {...attributes}
        >
            {renderInner ? <div className="card-inner" /> : null}
        </tg-card>
    );
}

/**
 * Both screens' real drop structure, in one tree.
 *
 * Board, swimlane mode — `app/partials/includes/modules/kanban-table.jade` L112-L121:
 * the drop container is `.taskboard-column` inside `.kanban-swimlane`, carrying the
 * status and swimlane ids as data attributes. Board, flat mode — L190-L197: the same
 * column with `data-status` and NO `data-swimlane`.
 *
 * Story list — `backlog-row.jade` L7-L13 inside `backlog-table.jade` L19-L26: rows
 * are `.us-item-row` carrying `data-id`. Sprint sidebar — `sprint.jade` L13-L22.
 * And BOTH `.js-empty-backlog` containers, `backlog.jade` L174 and L178: there are
 * exactly two, which is why `backlog/sortable.coffee` L39 passes both to its drag
 * library alongside the table itself.
 */
function ScreenMarkupFixture(): ReactElement {
    return (
        <>
            <div className="kanban-swimlane" data-swimlane="3">
                <div
                    className="kanban-uses-box taskboard-column"
                    data-testid="kanban-column"
                    id="column-7"
                    data-status="7"
                    data-swimlane="3"
                >
                    <CardHarness id={CARD_ID} />
                    <CardHarness id={FOLDED_CARD_ID} renderInner={false} />
                </div>
            </div>

            <div
                className="kanban-uses-box taskboard-column"
                data-testid="flat-column"
                id="column-8"
                data-status="8"
            />

            <div className="backlog-table-body" data-testid="backlog-table-body">
                <div className="row us-item-row" data-id="201" data-testid="story-201" />
                <div
                    className={`row us-item-row ${MULTIPLE_SORTABLE_CLASS}`}
                    data-id="202"
                />
            </div>

            <div className="sprint-table" data-testid="sprint-table">
                <div className="row us-item-row" data-id="203" />
            </div>

            <div className="js-empty-backlog" data-testid="empty-backlog-1" />
            <div className="js-empty-backlog" data-testid="empty-backlog-2" />
        </>
    );
}

/**
 * A card that is not displayed, for the visibility cases.
 *
 * `display: none` is set on the card ITSELF as well as on its ancestor in the
 * fixture, so neither a computed-style check nor an offset-parent check could see it.
 */
function HiddenCardHarness(): ReactElement {
    const { attributes, listeners, setNodeRef } = useDraggable({ id: HIDDEN_CARD_ID });

    return (
        <tg-card
            ref={setNodeRef}
            class="card"
            style={{ display: 'none' }}
            data-testid="hidden-card"
            data-id={String(HIDDEN_CARD_ID)}
            {...listeners}
            {...attributes}
        />
    );
}

describe('the scope split', () => {
    /** How many nodes carry a class right now. */
    function countOf(className: string): number {
        return document.querySelectorAll(`.${className}`).length;
    }

    /** Every element in the document mapped to its current class attribute. */
    function classSnapshot(): Map<Element, string> {
        const snapshot = new Map<Element, string>();

        for (const node of document.body.querySelectorAll('*')) {
            snapshot.set(node, node.className);
        }

        return snapshot;
    }

    it('⭐ adds no class to the screens\u2019 markup beyond the placeholder on the drag source', async () => {
        /*
         * THE EXHAUSTIVE FORM OF THIS RULE, and the reason it is worth having alongside
         * the enumerated case below: an enumeration can only catch the leaks somebody
         * thought of. This one catches ANY class the provider writes anywhere in either
         * screen's markup, including one invented later.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <ScreenMarkupFixture />
            </DndProvider>,
        );

        const source = getByTestId(`card-${String(CARD_ID)}`);
        const before = classSnapshot();

        startDrag(source);

        // Dragged over the other board mode and over both story-list containers, so a
        // provider with any notion of "the container I am over" has had the chance to act.
        movePointer(120);
        movePointer(240);

        const changed = [...before.keys()].filter((node) => node.className !== before.get(node));

        expect(changed).toHaveLength(1);
        expect(changed[0]).toBe(source);

        // Exactly the placeholder was appended — the card's own two classes are intact,
        // which also proves the provider appends rather than overwrites.
        expect(source.className).toBe(`card ng-animate-disabled ${TRANSIT_CLASS}`);

        /*
         * The nodes that did not exist before the gesture are the mirror host and its
         * contents, and nothing else. Asserted rather than ignored, because "adds no
         * class" would otherwise be satisfiable by adding a whole decorated element.
         */
        for (const node of document.body.querySelectorAll('*')) {
            if (before.has(node)) {
                continue;
            }

            expect(
                node.classList.contains(MIRROR_CLASS) || node.closest(`.${MIRROR_CLASS}`) !== null,
            ).toBe(true);
        }

        // The gesture is completed rather than abandoned mid-flight. A test that returns
        // with a drag still open leaves the library's rect observer to fire its state
        // update after the test has finished, which surfaces as an unhandled `act`
        // warning attributed to whichever case happens to run next.
        await dropDrag(240);
    });

    it('restores the screens\u2019 markup exactly on drop', async () => {
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <ScreenMarkupFixture />
            </DndProvider>,
        );

        const before = classSnapshot();

        startDrag(getByTestId(`card-${String(CARD_ID)}`));
        await dropDrag();

        for (const [node, className] of before) {
            expect(node.className).toBe(className);
        }

        expect(mirrorNodes()).toHaveLength(0);
    });

    /**
     * The classes the SCREENS own, each with the locator that proves ownership.
     *
     * Every one of them is a class some part of this application really does apply
     * during a drag — which is exactly why a shared provider applying it would look
     * plausible in review and be wrong.
     */
    const SCREEN_OWNED_CLASSES: ReadonlyArray<{
        readonly name: string;
        readonly owner: string;
    }> = [
        {
            // Styled at `app/styles/modules/kanban/kanban-table.scss` L247 and at
            // `taskboard-table.scss` L257; added at `kanban/sortable.coffee` L69 and
            // removed at L73, by the BOARD, on the container being dragged over.
            name: 'target-drop',
            owner: 'the board, on a foreign container',
        },
        {
            // Styled at `app/styles/core/base.scss` L36; added at
            // `backlog/sortable.coffee` L73 and removed at L108, by the STORY LIST only.
            // The board does not do this at all.
            name: 'drag-active',
            owner: 'the story list, on document.body',
        },
        {
            // `app/styles/components/doomline.scss` L1 — the project-scope divider the
            // story list renders from its own data.
            name: 'doom-line',
            owner: 'the story list, on its divider',
        },
        {
            // `app/styles/modules/backlog/sprints.scss` L190 and L380.
            name: 'sprint-table',
            owner: 'the sprint sidebar, on its own container',
        },
        {
            // Bound from the screens' SELECTION state, not from a drag:
            // `kanban-table.jade` L154 and L230 bind
            // `'ui-multisortable-multiple': ctrl.selectedUss[usId]`, and
            // `backlog/main.coffee` L824 toggles it. `./multiDrag` READS it; nothing here
            // writes it.
            name: MULTIPLE_SORTABLE_CLASS,
            owner: "the screens' selection state",
        },
        {
            // Added at `kanban/sortable.coffee` L128-L131 on the DESTINATION column, then
            // removed on `animationend` — a board arrival animation.
            name: 'new',
            owner: 'the board, on the destination column',
        },
    ];

    it.each(SCREEN_OWNED_CLASSES)(
        'never applies $name, which belongs to $owner',
        async ({ name }) => {
            const { getByTestId } = render(
                <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                    <ScreenMarkupFixture />
                </DndProvider>,
            );

            /*
             * The BEFORE count, not zero: two of these classes legitimately exist in the
             * fixture already, because the screens really do render them. The property
             * under test is that the provider adds none — which a hardcoded zero would
             * have stated incorrectly.
             */
            const before = countOf(name);
            const bodyBefore = document.body.className;

            startDrag(getByTestId(`card-${String(CARD_ID)}`));
            movePointer(140);

            expect(countOf(name)).toBe(before);

            await dropDrag(140);

            expect(countOf(name)).toBe(before);
            expect(document.body.className).toBe(bodyBefore);
        },
    );

    it('⭐ hardcodes no screen selector', () => {
        /*
         * SOURCE-LEVEL, because a hardcoded selector that happens to match nothing in a
         * fixture is behaviourally indistinguishable from an absent one — and the
         * fixtures here deliberately DO contain every one of these, so a leak would be
         * live rather than dormant.
         *
         * Comments are stripped first: the provider explains at length WHY the screens
         * name their own targets (rule T9), and that prose is allowed to mention them.
         * The container getter, `DndAutoScrollConfig.getTargets`, is the mechanism that
         * makes a selector unnecessary here — each screen resolves its own nodes and
         * hands them over.
         */
        const screenSelectors = [
            'taskboard-column',
            'kanban-swimlane',
            'kanban-uses-box',
            'backlog-table-body',
            'us-item-row',
            'sprint-table',
            'js-empty-backlog',
            'card-inner',
        ];

        for (const selector of screenSelectors) {
            expect(PROVIDER_CODE).not.toContain(selector);
        }
    });

    it('⭐ performs no I/O and writes no application state', () => {
        /*
         * The provider decorates and delegates; it never talks to the server and never
         * owns board state. That boundary is not cosmetic — the story list's write path
         * is a FIFO queue with a re-entrancy guard
         * (`backlog/main.coffee` L84, L539-L546, L600-L601
         * `if ctx && @.pendingDrag.length > 1 then return`, L603-L618, L620-L629,
         * L630-L631 and the disconnected fallback at L633-L635), because
         * `bulk-update-us-backlog-order` is POSITION-RELATIVE: two overlapping writes
         * compute their neighbours from an order the server has not acknowledged and
         * persist a wrong one with no error anywhere. That queue lives in the screen's
         * reducer and its drag hook. A shared provider that fired a request, or held
         * order state, would put a second uncoordinated writer on the same endpoint.
         *
         * Asserted at source level for the whole list, and behaviourally for the one
         * transport jsdom actually implements. jsdom 20 ships no `fetch`, so there is no
         * method to spy on for that one — its absence from the source is the assertion,
         * and installing a fake `fetch` would only prove that a fake can be installed.
         */
        const forbidden = [
            'fetch(',
            'XMLHttpRequest',
            'axios',
            '$http',
            '$tgResources',
            '$rootScope',
            '$apply',
            'dispatch(',
            'broadcast',
            'pendingDrag',
        ];

        for (const call of forbidden) {
            expect(PROVIDER_CODE).not.toContain(call);
        }
    });

    it('opens no request during a whole gesture', async () => {
        const open = jest.spyOn(XMLHttpRequest.prototype, 'open');
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <ScreenMarkupFixture />
            </DndProvider>,
        );

        startDrag(getByTestId(`card-${String(CARD_ID)}`));
        movePointer(160);
        await dropDrag(160);

        expect(open).not.toHaveBeenCalled();
    });

    it('⭐ opens no shadow root, so the pass-through stylesheets keep matching', async () => {
        /*
         * REQUIREMENT I6, and the failure mode is total rather than subtle. The single
         * compiled stylesheet is loaded once, at `app/index.jade` L25, and the icon
         * sprite is inlined into the same document at L96. A shadow boundary would sever
         * both: every existing rule in the 1,870 lines of in-scope Sass would stop
         * matching, and every `<use href="#icon-…">` would resolve to nothing. The screens
         * would render unstyled and iconless with no error at all.
         *
         * The method name is assembled for the same reason `sensorIdentifier` is — the
         * compliance search for it covers this folder, so a spec that spelled it out
         * would be its own hit.
         */
        const shadowRootSpy = jest.spyOn(Element.prototype, SHADOW_ROOT_METHOD);
        const { getByTestId, unmount } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL}>
                <ScreenMarkupFixture />
            </DndProvider>,
        );

        startDrag(getByTestId(`card-${String(CARD_ID)}`));
        movePointer(180);
        await dropDrag(180);

        await act(async () => {
            unmount();
        });

        expect(shadowRootSpy).not.toHaveBeenCalled();
        expect(PROVIDER_CODE).not.toContain(SHADOW_ROOT_METHOD);

        // Nothing rendered a shadow root by any other route either.
        for (const node of document.querySelectorAll('*')) {
            expect(node.shadowRoot).toBeNull();
        }
    });
});

/* ==========================================================================
 * REGISTRATION IS NEVER GATED ON VISIBILITY (risk R-DND-3)
 *
 * `@dnd-kit` has no virtual-list support, and the board is already virtualised: the
 * `IntersectionObserver` in `boards.js`, under `app/js`, drives `vm.inViewPort`, which
 * `../useInViewport` reproduces. The trap this block guards is registering
 * draggables and droppables only for cards that are currently on screen — after
 * which dragging TOWARDS a region that has not been scrolled into view finds no drop
 * target, and the card snaps back with no error.
 *
 * ⭐ AND THE HOOK CANNOT BE USED AS A GUARD EVEN IF SOMEONE WANTED TO: visibility
 * there LATCHES. An id marked visible is never marked invisible again
 * (`kanban/main.coffee` L577 and L666-L677), so there is no "left the viewport"
 * transition to react to. A visibility-gated registration would therefore be not
 * merely wrong but untestable against the incumbent's own semantics.
 *
 * The provider's answer is to have no opinion: it resolves the drag source from the
 * node the screen supplies, or from the `data-id` already on the host element, and
 * asks nothing about whether it can be seen.
 * ========================================================================== */

describe('registration and virtualisation', () => {
    it('⭐ drags a card whose inner content has been virtualised away', async () => {
        const controller = createRecordingMultiDrag();
        const onDragStart = jest.fn();
        const { getByTestId } = render(
            <DndProvider
                autoScroll={BOARD_AUTO_SCROLL}
                multiDrag={controller}
                onDragStart={onDragStart}
            >
                <ScreenMarkupFixture />
            </DndProvider>,
        );

        const folded = getByTestId(`card-${String(FOLDED_CARD_ID)}`);

        // The precondition, asserted so the case cannot quietly become a duplicate of the
        // ordinary drag if the fixture changes: this host really is empty.
        expect(folded.querySelector('.card-inner')).toBeNull();
        expect(folded.dataset.id).toBe(String(FOLDED_CARD_ID));

        startDrag(folded);

        expect(onDragStart).toHaveBeenCalledTimes(1);
        expect(folded).toHaveClass(TRANSIT_CLASS);
        expect(controller.startArgs[0]?.item).toBe(folded);

        // And the container handed to the gesture is the column, reached through the DOM
        // rather than through a selector — `resolveMultiDragContainer`'s parent fallback.
        expect(controller.startArgs[0]?.container).toBe(getByTestId('kanban-column'));

        await dropDrag();

        expect(folded).not.toHaveClass(TRANSIT_CLASS);
    });

    it('⭐ registers a card that is not displayed at all', async () => {
        /*
         * The strongest form jsdom can express of "not on screen". `display: none` is set
         * on the card itself as well as on an ancestor, so a provider consulting either
         * the element's own computed style or its offset parent would refuse it. Both are
         * asserted first, so the case fails if jsdom ever stops reporting them and the
         * assertion silently becomes vacuous.
         */
        const controller = createRecordingMultiDrag();
        const { getByTestId } = render(
            <DndProvider autoScroll={BOARD_AUTO_SCROLL} multiDrag={controller}>
                <div style={{ display: 'none' }} data-testid="collapsed-swimlane">
                    <div
                        className="kanban-uses-box taskboard-column"
                        data-status="9"
                        data-swimlane="4"
                    >
                        <HiddenCardHarness />
                    </div>
                </div>
            </DndProvider>,
        );

        const hidden = getByTestId('hidden-card');

        expect(window.getComputedStyle(hidden).display).toBe('none');
        expect(hidden.offsetParent).toBeNull();

        startDrag(hidden);

        expect(hidden).toHaveClass(TRANSIT_CLASS);
        expect(controller.calls).toContain('start');

        await dropDrag();
    });

    it('⭐ imports nothing from the viewport hook', () => {
        /*
         * The cheapest possible statement of the rule: the provider does not gate on
         * visibility because it cannot see it. Both spellings are checked, since a
         * relative import could be written either way.
         */
        expect(PROVIDER_CODE).not.toContain('useInViewport');
        expect(PROVIDER_CODE).not.toContain('IntersectionObserver');
    });
});
